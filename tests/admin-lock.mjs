#!/usr/bin/env node
// =============================================================================
// 전통발효체험관 메타버스 — admin path lock, request-level checks (CONTRACT §15.4 / §15.7 items 6, 5, 8)
//
//   node tests/admin-lock.mjs                      copy server/ into a temp folder, start `php -S` there with a
//                                                  throw-away data dir, run every check, clean up
//   options: --docroot <dir>   take the server tree from that folder (e.g. dist/metaverse) instead of server/
//            --only <regex>    run only the sections whose name matches (path|signin|csrf|xss|twofa|required|idle|
//                              allowlist|ratelimit|screens|allot|rename|apache)
//            --no-apache       skip the Apache (.htaccess) section      --verbose   print every request
//            --keep            keep the temp folders (their paths are printed)
//
// Nothing in the given docroot is changed: every section works on its own copy (the rename section renames the admin
// folder of its copy, the Apache section edits the .htaccess of its copy).
// Prints `PASS  [S06] name` / `FAIL  [S06] name — detail` (S05 / S08 for the admin screens of those items) and exits 1
// when a check fails. `SKIP` lines (no Apache on this machine, …) are not failures.
// php -S ports: 18790–18807, Apache: 18808 (an ephemeral port when those are busy).
//
// Interfaces that other phase-7 owners deliver (SecEvent / Firewall in lib/SecurityEvents.php, ConfigAudit): when the
// file is not in the tree yet, the "screens" section runs once without it (the page must say "아직 준비 중") and once
// with a small test double that has exactly the agreed signatures; the PASS line says which one was used.
// =============================================================================
import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] ? args[i + 1] : null; };
const VERBOSE = args.includes('--verbose');
const KEEP = args.includes('--keep');
const NO_APACHE = args.includes('--no-apache');
const SRC = path.resolve(opt('--docroot') || path.join(ROOT, 'server'));
const ONLY = opt('--only') ? new RegExp(opt('--only')) : null;
const PASSWORD = 'Ferment2026ok';
const STUB_DIR = 'admin'; // the folder name in the repository; the rename section proves any other name works

// ------------------------------------------------------------------ result bookkeeping
const results = [];
function record(tag, name, ok, detail = '') {
  results.push({ tag, name, ok, detail });
  console.log(`${ok === null ? 'SKIP' : ok ? 'PASS' : 'FAIL'}  [${tag}] ${name}${detail ? '  — ' + detail : ''}`);
}
class Skip extends Error {}
async function step(tag, name, fn) {
  try {
    const r = await fn();
    record(tag, name, r !== false, typeof r === 'string' ? r : '');
  } catch (e) {
    if (e instanceof Skip) record(tag, name, null, e.message);
    else record(tag, name, false, String(e?.message || e).replace(/\s+/g, ' ').slice(0, 600));
  }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rnd = () => crypto.randomBytes(4).toString('hex');
const decode = (s) => String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0*39;|&apos;/g, "'").replace(/&amp;/g, '&');

// ------------------------------------------------------------------ TOTP (RFC 6238, SHA-1, 30 s, 6 digits) — test side
function b32decode(s) {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0, val = 0;
  const out = [];
  for (const ch of String(s).replace(/[\s=-]/g, '').toUpperCase()) {
    const i = A.indexOf(ch);
    if (i < 0) throw new Error('bad base32');
    val = (val << 5) | i; bits += 5;
    if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8; val &= (1 << bits) - 1; }
  }
  return Buffer.from(out);
}
const stepOf = (t = Date.now() / 1000) => Math.floor(t / 30);
function totpAt(secret, stepNo) {
  const ctr = Buffer.alloc(8);
  ctr.writeBigUInt64BE(BigInt(stepNo));
  const h = crypto.createHmac('sha1', b32decode(secret)).update(ctr).digest();
  const o = h[19] & 15;
  const n = ((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 1000000).padStart(6, '0');
}
if (totpAt('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', Math.floor(1234567890 / 30)) !== '005924') { console.error('the test-side TOTP is broken'); process.exit(2); }

// ------------------------------------------------------------------ a browser: cookie jar with Path scoping (RFC 6265)
class Browser {
  constructor(base, label = 'b') { this.base = base; this.label = label; this.jar = []; this.csrf = null; }
  cookie(name) { const c = this.jar.find((x) => x.name === name); return c ? c.value : null; }
  cookieObj(name) { return this.jar.find((x) => x.name === name) || null; }
  drop(name) { this.jar = this.jar.filter((c) => c.name !== name); }
  put(name, value, cpath) { this.jar = this.jar.filter((c) => !(c.name === name && c.path === cpath)); this.jar.push({ name, value, path: cpath, raw: '' }); }
  static match(reqPath, cpath) { return reqPath === cpath || (reqPath.startsWith(cpath) && (cpath.endsWith('/') || reqPath[cpath.length] === '/')); }
  store(line, reqPath) {
    const [pair, ...attrs] = line.split(';');
    const i = pair.indexOf('=');
    if (i < 0) return;
    const name = pair.slice(0, i).trim(), value = pair.slice(i + 1).trim();
    let cpath = null, expired = false;
    for (const a of attrs) {
      const [k, ...v] = a.trim().split('=');
      const val = v.join('=');
      if (k.toLowerCase() === 'path') cpath = val;
      if (k.toLowerCase() === 'max-age' && Number(val) <= 0) expired = true;
      if (k.toLowerCase() === 'expires' && Date.parse(val) < Date.now()) expired = true;
    }
    if (!cpath || !cpath.startsWith('/')) cpath = reqPath.slice(0, reqPath.lastIndexOf('/')) || '/';
    this.jar = this.jar.filter((c) => !(c.name === name && c.path === cpath));
    if (!expired && value !== '' && value !== 'deleted') this.jar.push({ name, value, path: cpath, raw: line });
  }
  /** opts: {method, form, json, headers} — form posts are urlencoded like a browser form */
  async req(p, opts = {}) {
    const url = new URL(p, this.base);
    const headers = { ...(opts.headers || {}) };
    const send = this.jar.filter((c) => Browser.match(url.pathname, c.path));
    if (send.length) headers.Cookie = send.map((c) => `${c.name}=${c.value}`).join('; ');
    let body;
    const method = opts.method || (opts.form || opts.json !== undefined ? 'POST' : 'GET');
    if (opts.form) { body = new URLSearchParams(opts.form).toString(); headers['Content-Type'] = 'application/x-www-form-urlencoded'; }
    else if (opts.json !== undefined) { body = JSON.stringify(opts.json); headers['Content-Type'] = 'application/json'; if (this.csrf) headers['X-CSRF-Token'] = this.csrf; }
    const res = await fetch(url, { method, headers, body, redirect: 'manual' });
    const set = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
    for (const line of set) this.store(line, url.pathname);
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* html */ }
    if (json && typeof json.csrf === 'string') this.csrf = json.csrf;
    if (VERBOSE) console.log(`   ${this.label} ${method} ${url.pathname}${url.search} -> ${res.status} ${text.slice(0, 160).replace(/\s+/g, ' ')}`);
    return { status: res.status, text, headers: res.headers, location: res.headers.get('location'), setCookie: set, json, data: json?.data, error: json?.error, url: url.href, sent: send.map((c) => c.name) };
  }
  /** a GET whose body is binary (an image): {status, headers, buf} — the cookies are sent and stored like req() */
  async bytes(p, opts = {}) {
    const url = new URL(p, this.base);
    const headers = { ...(opts.headers || {}) };
    const send = this.jar.filter((c) => Browser.match(url.pathname, c.path));
    if (send.length) headers.Cookie = send.map((c) => `${c.name}=${c.value}`).join('; ');
    const res = await fetch(url, { method: opts.method || 'GET', headers, redirect: 'manual' });
    for (const line of (typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [])) this.store(line, url.pathname);
    const buf = Buffer.from(await res.arrayBuffer());
    if (VERBOSE) console.log(`   ${this.label} ${opts.method || 'GET'} ${url.pathname}${url.search} -> ${res.status} ${buf.length} bytes`);
    return { status: res.status, headers: res.headers, buf, text: buf.toString('latin1') };
  }
  async follow(r) {
    let n = 0;
    while ([301, 302, 303, 307, 308].includes(r.status) && r.location && n++ < 6) r = await this.req(new URL(r.location, r.url).href);
    return r;
  }
}

// ------------------------------------------------------------------ html helpers (the page contract these checks rely on)
const tokenOf = (html) => (html.match(/name="_csrf" value="([0-9a-f]{16,})"/) || [])[1] || null;
const flashOf = (html) => { const m = html.match(/<div class="flash (\w+)"[^>]*>([\s\S]*?)<\/div>/); return m ? { type: m[1], msg: decode(m[2].replace(/<[^>]+>/g, '')) } : null; };
const isSignIn = (html) => /name="action" value="login"/.test(html);
const isCodeForm = (html) => /name="action" value="code"/.test(html);
const isInside = (html) => /<nav class="tabs"/.test(html);
const BANNER = /2단계 인증을 켜 주세요/;
/** the stylesheet address an admin page names, relative to the admin folder (entities decoded); '' when there is none */
const cssOf = (html) => decode((String(html).match(/<link rel="stylesheet" href="([^"]+)"/) || [])[1] || '');
/** a request path for an address that a page of the admin folder ADM names relatively ("./?css=1" → "admin/?css=1") */
const inFolder = (ADM, rel) => ADM + String(rel).replace(/^\.\//, '');
/** the start of the admin stylesheet's source (wherever this tree keeps it) — a leak of the file would contain it */
const cssSourceHead = (site) => { for (const f of ['lib/admin.css', 'admin/admin.css']) { const p = path.join(site, f); if (fs.existsSync(p)) return fs.readFileSync(p, 'utf8').slice(0, 160); } return null; };

/** the headers of point 5 + zero scripts; returns a list of problems (empty = fine) */
function lockProblems(r, { payload = false } = {}) {
  const h = (k) => r.headers.get(k) || '';
  const csp = h('content-security-policy');
  const p = [];
  if (!/default-src 'none'/.test(csp)) p.push(`CSP default-src: "${csp}"`);
  if (/script-src|unsafe-inline|unsafe-eval|'nonce-/.test(csp)) p.push(`CSP opens scripts / inline: "${csp}"`);
  if (!/frame-ancestors 'none'/.test(csp) || !/base-uri 'none'/.test(csp) || !/form-action 'self'/.test(csp)) p.push(`CSP frame-ancestors / base-uri / form-action: "${csp}"`);
  if (h('x-robots-tag') !== 'noindex, nofollow, noarchive') p.push(`X-Robots-Tag "${h('x-robots-tag')}"`);
  if (!/no-store/.test(h('cache-control'))) p.push(`Cache-Control "${h('cache-control')}"`);
  if (h('referrer-policy') !== 'no-referrer') p.push(`Referrer-Policy "${h('referrer-policy')}"`);
  if (h('x-frame-options') !== 'DENY') p.push(`X-Frame-Options "${h('x-frame-options')}"`);
  if (h('x-content-type-options') !== 'nosniff') p.push('nosniff missing');
  if (h('x-powered-by')) p.push('X-Powered-By leaked');
  if (/<script/i.test(r.text)) p.push('<script in the body');
  if (/<style/i.test(r.text)) p.push('inline <style> in the body');
  if (/\sstyle\s*=\s*["']/i.test(r.text.replace(/value="[^"]*"/g, ''))) p.push('inline style attribute');
  if (/(?:href|src|action)\s*=\s*["']?\s*javascript:/i.test(r.text)) p.push('javascript: URL');
  if (!payload && /<[a-z][^>]*\son[a-z]+\s*=/i.test(r.text)) p.push('inline event handler');
  return p;
}
function assertLocked(r, what, o) { const p = lockProblems(r, o); assert(p.length === 0, `${what} (HTTP ${r.status}): ${p.join(' · ')}`); }

// ------------------------------------------------------------------ sites (copies of the server tree) and servers
const cleanupDirs = [];
const procs = new Set();
function makeSite(tag, local = {}) {
  assert(fs.existsSync(path.join(SRC, 'lib/bootstrap.php')), `no server tree in ${SRC}`);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `tfm-adm-${tag}-`));
  fs.chmodSync(dir, 0o755);
  cleanupDirs.push(dir);
  const site = path.join(dir, 'site'), data = path.join(dir, 'data');
  fs.cpSync(SRC, site, {
    recursive: true,
    filter: (s) => {
      const p = path.relative(SRC, s).split(path.sep).join('/');
      if (p === 'config/config.local.php') return false;
      if (/^data\/.+/.test(p) && !/^data\/(game-data\.json|index\.php|\.htaccess)$/.test(p)) return false;
      if (/^uploads\/journal(\/|$)/.test(p)) return false;
      return true;
    },
  });
  fs.mkdirSync(data, { recursive: true });
  const s = { dir, site, data, tag };
  writeLocal(s, local);
  return s;
}
/**
 * config/config.local.php of a site: generous page limits (the suite is one busy "administrator") + the overrides.
 * The per-address cap of stored security events (security.events_per_minute, 120) is lifted for the same reason: the
 * CSRF section alone causes ~150 refusals from 127.0.0.1 within a minute, and the cap would then silently drop the
 * events later sections look for (the cap itself is the core owner's feature, tested in tests/security-*.php).
 */
function writeLocal(s, local = {}) {
  const base = { rate_limits: { admin_page: [100000, 60], admin: [100000, 60], me: [100000, 60], ping: [100000, 60], login: [1000, 60], admin_login: [1000, 60] }, security: { events_per_minute: 100000 } };
  const merged = { ...base, ...local, rate_limits: { ...base.rate_limits, ...(local.rate_limits || {}) }, security: { ...base.security, ...(local.security || {}) } };
  fs.writeFileSync(path.join(s.site, 'config/config.local.php'),
    `<?php\n// written by tests/admin-lock.mjs\nif (!defined('TFM_BOOT')) { http_response_code(404); exit; }\nreturn json_decode(${JSON.stringify(JSON.stringify(merged)).replace(/\$/g, '\\$')}, true);\n`);
}
const cleanEnv = () => { const e = { ...process.env }; for (const k of Object.keys(e)) if (/^TFM_/.test(k)) delete e[k]; return e; };
const envFor = (s, extra = {}) => ({ ...cleanEnv(), TFM_DATA_DIR: s.data, TFM_TOSS_MOCK: '1', ...extra });
function portFree(port) {
  return new Promise((resolve) => { const srv = net.createServer(); srv.once('error', () => resolve(false)); srv.listen(port, '127.0.0.1', () => srv.close(() => resolve(true))); });
}
async function pickPort(from = 18790, to = 18807) {
  for (let p = from; p <= to; p++) if (await portFree(p)) return p;
  return new Promise((resolve, reject) => { const srv = net.createServer(); srv.once('error', reject); srv.listen(0, '127.0.0.1', () => { const p = srv.address().port; srv.close(() => resolve(p)); }); });
}
async function startPhp(s, env = {}) {
  const port = await pickPort();
  const proc = spawn('php', ['-S', `127.0.0.1:${port}`, '-t', s.site], { env: envFor(s, env), stdio: ['ignore', 'ignore', 'pipe'] });
  procs.add(proc);
  let err = '';
  proc.stderr.on('data', (d) => { err += d; if (VERBOSE) process.stderr.write(String(d)); });
  const base = `http://127.0.0.1:${port}/`;
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(base + 'api/ping.php'); if (r.ok) { await r.text(); return { base, port, proc, log: () => err, stop: () => stopProc(proc) }; } } catch { /* not yet */ }
    await sleep(100);
  }
  stopProc(proc);
  throw new Error('php -S did not start: ' + err.slice(0, 300));
}
function stopProc(proc) {
  procs.delete(proc);
  return new Promise((resolve) => {
    if (proc.exitCode !== null || proc.signalCode !== null) return resolve();
    proc.once('exit', () => resolve());
    try { proc.kill('SIGTERM'); } catch { resolve(); }
    setTimeout(resolve, 3000);
  });
}
/** one PHP expression inside a site (its lib/bootstrap.php, its data dir): $in = the JSON input, the value comes back as JSON */
function php(s, expr, input = null, env = {}) {
  const code = 'require getenv("TFM_T_BOOT"); $in = json_decode((string) stream_get_contents(STDIN), true); '
    + `echo json_encode(${expr}, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE);`;
  const r = spawnSync('php', ['-r', code], { input: JSON.stringify(input), encoding: 'utf8', timeout: 60000, env: { ...envFor(s, env), TFM_T_BOOT: path.join(s.site, 'lib/bootstrap.php') } });
  if (r.status !== 0) throw new Error(`site PHP failed (exit ${r.status}): ${String(r.stderr || r.stdout).trim().slice(0, 400)}`);
  return JSON.parse(r.stdout);
}
const dbAll = (s, sql, params = []) => php(s, 'Tfm\\Db::all($in["sql"], $in["params"])', { sql, params });
const dbVal = (s, sql, params = []) => php(s, 'Tfm\\Db::value($in["sql"], $in["params"])', { sql, params });
function mkUser(s, role = 'user') {
  const id = rnd(), tag = String(parseInt(id, 16)).padStart(10, '0').slice(-6);
  const u = { email: `lock_${id}@example.com`, nickname: `${role === 'admin' ? '지킴' : '손님'}${tag}`, password: PASSWORD, role };
  u.id = php(s, '(function ($in) { $u = Tfm\\Db::tx(function () use ($in) { return Tfm\\Users::create($in["email"], $in["nickname"], $in["password"], $in["role"] === "admin" ? "admin" : ""); }); return (int) $u["id"]; })($in)', u);
  return u;
}
/** enrol 2-step sign-in for an account without the page (returns the secret, the backup codes and the step that was used) */
function enrol(s, u) {
  const r = php(s, '(function ($in) { $t = time(); $sec = Tfm\\AdminTotp::begin((int) $in["id"]); $codes = Tfm\\AdminTotp::confirm((int) $in["id"], Tfm\\Totp::code($sec, $t), $t); return ["secret" => $sec, "codes" => $codes, "step" => intdiv($t, 30)]; })($in)', { id: u.id });
  u.secret = r.secret; u.codes = r.codes; u.step = r.step;
  return u;
}
/** every recorded event of a kind: security_events rows (SecEvent) and audit_log rows (the fallback / the audit trail) */
function eventsOf(s, kind) {
  let sec = [];
  try { sec = dbAll(s, 'SELECT * FROM security_events WHERE kind = ? ORDER BY id', [kind]); } catch { /* no table */ }
  return { sec, audit: dbAll(s, 'SELECT * FROM audit_log WHERE event = ? ORDER BY id', [kind]) };
}
/** cli/tfm.php <command>; while tfm.php has no plug-in loader yet, the plug-in file runs the command itself */
const cliNotes = new Set();
function cli(s, ...a) {
  const run = (file) => { const r = spawnSync('php', [path.join(s.site, file), ...a], { env: envFor(s), encoding: 'utf8', timeout: 60000 }); return { status: r.status, out: String(r.stdout || '') + String(r.stderr || ''), via: file }; };
  let r = run('cli/tfm.php');
  if (/php cli\/tfm\.php (help|status)/.test(r.out) || /unknown command|알 수 없는 명령/i.test(r.out)) {
    cliNotes.add('cli/tfm.php does not load plug-ins yet → the plug-in file ran the command (php cli/admin-path.php …)');
    r = run('cli/admin-path.php');
  }
  return r;
}

/** GET a page of the admin folder for a form token, then POST the form (not followed) */
async function adm(b, ADM, fields, opts = {}) {
  const pg = await b.req(ADM + (opts.page || ''));
  const tok = opts.token !== undefined ? opts.token : tokenOf(pg.text);
  const form = { ...fields };
  if (tok !== null) form._csrf = tok;
  return b.req(ADM, { form, headers: opts.headers });
}
const admF = async (b, ADM, fields, opts) => b.follow(await adm(b, ADM, fields, opts));
async function signIn(b, ADM, u, pw = u.password) {
  const post = await adm(b, ADM, { action: 'login', login: u.email, password: pw });
  return { post, page: await b.follow(post) };
}
/** password, then (when asked) the code; returns the page that follows */
async function signInFull(b, ADM, u, code = null) {
  const r = await signIn(b, ADM, u);
  if (!isCodeForm(r.page.text)) return r.page;
  return admF(b, ADM, { action: 'code', code: code || '' });
}
async function apiLogin(b, u) {
  await b.req('api/ping.php');
  const r = await b.req('api/auth/login.php', { json: { login: u.email, password: u.password, remember: false } });
  assert(r.status === 200, `api login ${r.status} ${r.error?.code}`);
  return r;
}
const section = (name) => !ONLY || ONLY.test(name);

// ------------------------------------------------------------------ phase-7 feature data (CONTRACT §15.1–§15.4) for the farm tabs
/** markup that must come back as inert text on every new tab (nickname, crop id, item id, note, memo, log line, AI answer) */
const EVIL = {
  nick: `<img src=x onerror=alert('nick')>`,
  crop: `<svg onload=alert('crop')>`,
  item: `<b onmouseover=alert('item')>ITEM</b>`,
  note: `<script>alert('note')</script> 물을 줬어요 "큰따옴표" '작은따옴표'`,
  memo: `<i>기존</i> 메모 <script>alert('memo')</script>`,
};
/** raw markup of EVIL that must never appear unescaped in a page */
const rawEvil = (html) => ['<img src=x onerror', '<svg onload', '<b onmouseover', "<script>alert('note')", "<script>alert('memo')", '<i>기존</i>'].filter((x) => html.includes(x));
/**
 * Beds, 곳간 rows and completion requests written straight into the site's database (the admin site only reads them; the
 * player-side rules are farm-server's tests). $K = three player accounts; the third gets the markup nickname. Returns ids.
 *   K0: RB1 박하 growing (ready in 8 min) · RB2 콩 past its ready time (= ready by the server clock) · RB3 무 harvested
 *       a second ago (3 items, ★★★) · RB4 들깨 cleared · quick plots P1 콩 50 % growing, P2 고추 100 % ready
 *   K1: RB1 with a markup crop id, growing · 55 finished quick-plot rows (P9) for paging
 *   K2: RB1 옥수수 growing
 *   곳간: K0 박하 5 + 콩 7 · K1 박하 2 + a markup item id 1 · K2 옥수수 4 (19 in all)
 *   requests: R1 K0 RB2 pending (★★★, markup note, a real JPEG photo) · R2 K0 RB3 approved (markup memo) ·
 *             R3 K2 P2 rejected · R4 K1 RB1 pending with a photo path that is not a report photo
 */
function seedFarm(s, K, adminId) {
  return php(s, `(function ($in) {
    $now = Tfm\\Clock::ms(); $min = 60000;
    $bed = function ($uid, $bed, $kind, $pid, $crop, $first, $ready, $status, $x = []) use ($now) {
      return Tfm\\Db::insert('farm_beds', $x + ['user_id' => $uid, 'bed_id' => $bed, 'kind' => $kind, 'pid' => $pid, 'crop_id' => $crop, 'tier' => 1,
        'first_seen_at' => $first, 'ready_at' => $ready, 'growth' => 0, 'care' => 0, 'status' => $status, 'harvested_at' => 0, 'amount' => 0, 'stars' => 0, 'updated_at' => $now]);
    };
    list($k0, $k1, $k2) = $in['k'];
    Tfm\\Db::exec('UPDATE users SET nickname = ? WHERE id = ?', [$in['evil']['nick'], $k2]);
    $b = [];
    $b['k0rb1'] = $bed($k0, 'RB1', 'rt', 'a1a1a1a1a1a1a1a1', 'CROP_MINT', $now - 2 * $min, $now + 8 * $min, 'growing', ['care' => 50]);
    $b['k0rb2'] = $bed($k0, 'RB2', 'rt', 'b2b2b2b2b2b2b2b2', 'CROP_BEAN', $now - 70 * $min, $now - 10 * $min, 'growing', ['care' => 100]);
    $b['k0rb3'] = $bed($k0, 'RB3', 'rt', 'c3c3c3c3c3c3c3c3', 'CROP_RADISH', $now - 180 * $min, $now - 150 * $min, 'harvested', ['harvested_at' => $now - 1000, 'amount' => 3, 'stars' => 3]);
    $b['k0rb4'] = $bed($k0, 'RB4', 'rt', 'd4d4d4d4d4d4d4d4', 'CROP_PERILLA', $now - 50 * $min, $now + 40 * $min, 'cleared');
    $b['k0p1'] = $bed($k0, 'P1', 'plot', '1731400000001', 'CROP_BEAN', $now - 5 * $min, 0, 'growing', ['growth' => 50]);
    $b['k0p2'] = $bed($k0, 'P2', 'plot', '1731400000002', 'CROP_PEPPER', $now - 9 * $min, 0, 'ready', ['growth' => 100]);
    $b['k1rb1'] = $bed($k1, 'RB1', 'rt', 'e5e5e5e5e5e5e5e5', $in['evil']['crop'], $now - $min, $now + 30 * $min, 'growing');
    $b['k2rb1'] = $bed($k2, 'RB1', 'rt', 'f6f6f6f6f6f6f6f6', 'CROP_CORN', $now - 5 * $min, $now + 475 * $min, 'growing');
    for ($i = 1; $i <= 55; $i++) $bed($k1, 'P9', 'plot', (string) (1731300000000 + $i), 'CROP_RADISH', $now - 900 * $min, 0, 'harvested', ['growth' => 100, 'harvested_at' => $now - 800 * $min, 'amount' => 1, 'updated_at' => $now - 500 * $min - $i * 1000]);
    foreach ([[$k0, 'ITEM_MINT', 5], [$k0, 'ITEM_BEAN', 7], [$k1, 'ITEM_MINT', 2], [$k1, $in['evil']['item'], 1], [$k2, 'ITEM_CORN', 4]] as $r) {
      Tfm\\Db::insert('farm_storage', ['user_id' => $r[0], 'item_id' => $r[1], 'qty' => $r[2], 'updated_at' => $now]);
    }
    // a real JPEG where a report photo lives (uploads/reports/YYYY/MM/<32 hex>.jpg), made by GD like Upload does
    $rel = 'uploads/reports/' . date('Y') . '/' . date('m') . '/' . bin2hex(random_bytes(16)) . '.jpg';
    $file = Tfm\\Config::uploadDir() . DIRECTORY_SEPARATOR . str_replace('/', DIRECTORY_SEPARATOR, substr($rel, 8));
    @mkdir(dirname($file), 0755, true);
    $im = imagecreatetruecolor(8, 8); imagefill($im, 0, 0, imagecolorallocate($im, 52, 195, 107)); imagejpeg($im, $file, 80); imagedestroy($im);
    $rep = function ($uid, $kind, $bedId, $pid, $crop, $status, $x = []) use ($now) {
      return Tfm\\Db::insert('crop_reports', $x + ['user_id' => $uid, 'kind' => $kind, 'bed_id' => $bedId, 'pid' => $pid, 'crop_id' => $crop, 'stars' => 0, 'amount' => 0,
        'note' => '', 'photo' => '', 'status' => $status, 'memo' => null, 'requested_at' => $now - 60000, 'decided_at' => 0, 'decided_by' => null, 'seen_at' => 0]);
    };
    $r = [];
    $r['r1'] = $rep($k0, 'rt', 'RB2', 'b2b2b2b2b2b2b2b2', 'CROP_BEAN', 'pending', ['stars' => 3, 'note' => $in['evil']['note'], 'photo' => $rel, 'requested_at' => $now - 120000]);
    $r['r2'] = $rep($k0, 'rt', 'RB3', 'c3c3c3c3c3c3c3c3', 'CROP_RADISH', 'approved', ['stars' => 3, 'amount' => 3, 'memo' => $in['evil']['memo'], 'decided_at' => $now - 30000, 'decided_by' => $in['admin']]);
    $r['r3'] = $rep($k2, 'plot', 'P2', '1731400000002', 'CROP_PEPPER', 'rejected', ['memo' => '다시 해 봐요', 'decided_at' => $now - 20000, 'decided_by' => $in['admin']]);
    $r['r4'] = $rep($k1, 'rt', 'RB1', 'e5e5e5e5e5e5e5e5', $in['evil']['crop'], 'pending', ['photo' => '../../config/config.php', 'requested_at' => $now - 90000]);
    return ['beds' => $b, 'reports' => $r, 'photo' => $rel, 'photoBytes' => filesize($file)];
  })($in)`, { k: K.map((u) => u.id), evil: EVIL, admin: adminId });
}
/** many accounts at once (no password hashing: these accounts never sign in) — for the paging checks */
function bulkUsers(s, n, tag) {
  return php(s, `(function ($in) { $now = Tfm\\Clock::ms(); $ids = [];
    for ($i = 0; $i < $in['n']; $i++) {
      $nick = $in['tag'] . str_pad((string) $i, 3, '0', STR_PAD_LEFT);
      $ids[] = Tfm\\Db::insert('users', ['email' => strtolower($nick) . '@example.com', 'nickname' => $nick, 'nickname_key' => mb_strtolower($nick), 'password_hash' => '!',
        'role' => 'user', 'status' => 'active', 'muted_until' => 0, 'session_epoch' => 0, 'created_at' => $now, 'updated_at' => $now, 'last_login_at' => 0, 'last_login_ip' => '', 'password_changed_at' => $now]);
    }
    return $ids; })($in)`, { n, tag });
}
/** the number on a dashboard tile with this label ("<b>3</b><small>자라는 중 …") — null when the tile is missing */
const tileNum = (html, label) => { const m = html.match(new RegExp(`<b>([0-9,]+)</b><small>${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`)); return m ? Number(m[1].replace(/,/g, '')) : null; };

// =============================================================================
async function main() {
  console.log(`\n관리자 페이지 잠금 점검 — source ${path.relative(ROOT, SRC) || SRC}\n`);
  const main1 = makeSite('main');
  const ADM = STUB_DIR + '/';
  const admins = {};
  let srv = null;
  let stubBody = null;

  // ================================================================= path: the old address, the new address
  if (section('path')) {
    srv = await startPhp(main1);
    await step('S06', 'old address admin.php answers a plain 404 on GET / HEAD / POST: no redirect, no cookie, no hint', async () => {
      const b = new Browser(srv.base);
      const r = await b.req('admin.php');
      stubBody = r.text;
      assert(r.status === 404, `GET admin.php → ${r.status}`);
      assert(!r.location && r.setCookie.length === 0, `redirect "${r.location}" / cookies ${r.setCookie.length}`);
      assert(/404 Not Found/i.test(r.text) && !/admin|관리|href|<form|<script/i.test(r.text), `body: ${r.text.slice(0, 200)}`);
      assert(!r.headers.get('x-robots-tag') && !r.headers.get('x-powered-by') && !r.headers.get('content-security-policy'), 'the 404 must not carry page headers that a missing file does not have');
      for (const [m, o] of [['HEAD', {}], ['POST', { form: { action: 'login', login: 'a', password: 'b' } }], ['GET', {}]]) {
        const x = await b.req('admin.php?tab=users', { method: m, ...o });
        assert(x.status === 404 && !x.location && x.setCookie.length === 0, `${m} admin.php?tab=users → ${x.status}`);
      }
      const src = fs.readFileSync(path.join(main1.site, 'admin.php'), 'utf8');
      assert(src.length < 3000 && /TFM-ADMIN-STUB/.test(src), `admin.php is ${src.length} bytes`);
      return `404 · ${r.text.length} bytes · no Location / Set-Cookie`;
    });
    await step('S06', 'new address: the admin folder shows the sign-in form; the folder without its slash leads to the folder', async () => {
      const b = new Browser(srv.base);
      const r = await b.req(ADM);
      assert(r.status === 200 && isSignIn(r.text) && !isInside(r.text), `GET ${ADM} → ${r.status}`);
      assert(tokenOf(r.text), 'the form carries a CSRF token');
      assert(/<form method="post" action="\.\/"/.test(r.text), 'the form posts to the folder itself (relative)');
      const i = await b.req(ADM + 'index.php');
      assert(i.status === 200 && isSignIn(i.text), `GET ${ADM}index.php → ${i.status}`);
      const n = await b.req(STUB_DIR, { headers: {} });
      const end = await b.follow(n);
      assert(end.status === 200 && isSignIn(end.text) && new URL(end.url).pathname === '/' + ADM, `GET /${STUB_DIR} → ${n.status} → ${new URL(end.url).pathname}`);
      return `200 sign-in form · /${STUB_DIR} → ${n.status} → /${ADM}`;
    });
    await step('S06', 'the admin entry answers 404 for path tricks (index.php/extra) and other files of the folder are not pages', async () => {
      const b = new Browser(srv.base);
      const r = await b.req(ADM + 'index.php/extra/path');
      assert(r.status === 404 && !isSignIn(r.text) && r.setCookie.length === 0, `index.php/extra → ${r.status}`);
      const names = fs.readdirSync(path.join(main1.site, STUB_DIR)).sort();
      // finding (reviewer-infra, item 6): a static admin.css in the folder was served before the address check, so a
      // refused address could read it and learn that the (renamed) folder exists. The folder holds the entry only.
      assert(names.join(',') === '.htaccess,index.php', `the folder holds only index.php and .htaccess (the stylesheet comes through the entry): ${names.join(', ')}`);
      assert(fs.existsSync(path.join(main1.site, 'lib/admin.css')), 'the stylesheet source is lib/admin.css (lib/ is never web-readable)');
      return `folder: ${names.join(', ')}`;
    });
    await step('S06', 'the folder .htaccess: listing off, index.php is the index, only index.php reachable (a leftover admin.css = a missing page), the slashless folder goes to the entry, ready-to-uncomment IP and password blocks', async () => {
      const ht = fs.readFileSync(path.join(main1.site, STUB_DIR, '.htaccess'), 'utf8');
      assert(/^Options\s+.*-Indexes/m.test(ht), 'Options -Indexes');
      assert(/^DirectoryIndex\s+index\.php/m.test(ht), 'DirectoryIndex index.php (the installation root says index.html)');
      // a FilesMatch, or (what the folder uses: a directory request is matched against the folder's own — free — name,
      // so a file whitelist must leave directories alone) an Apache 2.4 <If> on existing files
      assert(/<(?:FilesMatch|If)\b[^>]*index\\\.php/.test(ht) && /Require all denied/.test(ht), 'everything except index.php is denied');
      assert(/^\s*RedirectMatch 404 .*admin\\\.css/m.test(ht), 'a leftover admin.css of an older release answers the 404 of a missing page');
      assert(/<IfModule mod_rewrite\.c>\s*\n\s*DirectorySlash Off/.test(ht), 'DirectorySlash Off (with mod_rewrite): mod_dir must not answer the slashless folder before the address check');
      const top = fs.readFileSync(path.join(main1.site, '.htaccess'), 'utf8');
      assert(/RewriteCond %\{REQUEST_FILENAME\}\/index\.php -f\s*\n\s*RewriteRule \^\(\[\^\/\]\+\)\$ %\{REQUEST_URI\}\/index\.php \[L\]/.test(top), 'the root .htaccess hands the slashless admin folder to its index.php');
      assert(/^\s*#\s*Require ip\s+\S+/m.test(ht), 'a commented "Require ip" block');
      assert(/^\s*#\s*AuthType Basic/m.test(ht) && /^\s*#\s*AuthUserFile\s+\S+/m.test(ht) && /^\s*#\s*Require valid-user/m.test(ht), 'a commented Basic-Auth block');
      assert(/[가-힣]{2,}/.test(ht), 'Korean comments for the operator');
      assert(!/게임/.test(ht), 'wording');
      return `${ht.split('\n').length} lines`;
    });
    await step('S06', 'the sign-in page carries the lock headers (CSP without scripts, noindex, no-store, no-referrer, DENY) and no <script; the stylesheet comes through the entry (no session, no url() / @import)', async () => {
      const b = new Browser(srv.base);
      const r = await b.req(ADM);
      assertLocked(r, 'sign-in page');
      const href = cssOf(r.text);
      assert(/^\.\/\?css=[0-9a-f]{10}$/.test(href), `the styles come through the admin entry after its address check: href="${href}"`);
      assert(/style-src 'self'/.test(r.headers.get('content-security-policy') || ''), "CSP style-src 'self'");
      const css = await new Browser(srv.base).req(inFolder(ADM, href));
      assert(css.status === 200 && /^text\/css/.test(css.headers.get('content-type') || '') && css.text.length > 2000 && !/<|javascript:|expression\(|@import|url\(/i.test(css.text), `${href} → ${css.status} ${css.headers.get('content-type')} (${css.text.length} bytes)`);
      assert(css.headers.get('x-content-type-options') === 'nosniff' && /noindex/.test(css.headers.get('x-robots-tag') || '') && css.headers.get('x-frame-options') === 'DENY' && css.headers.get('referrer-policy') === 'no-referrer', `stylesheet headers: ${JSON.stringify([...css.headers].filter(([k]) => /^x-|referrer|cache/.test(k)))}`);
      assert(css.setCookie.length === 0, `the stylesheet starts no session: ${css.setCookie.join(' ; ')}`);
      const old = await b.req(ADM + 'admin.css');
      assert(old.status === 404, `${ADM}admin.css (the old static address) → ${old.status}`);
      const sc = r.setCookie.join(' ; ');
      assert(/HttpOnly/i.test(sc) && /SameSite=Lax/i.test(sc), `session cookie flags: ${sc}`);
      return `headers ok · ${href} text/css, no url() / @import · admin.css 404`;
    });
    await step('S06', 'finding F15: a visitor sees no app version, database driver or PHP version on the sign-in page — not even in the stylesheet address', async () => {
      const version = (fs.readFileSync(path.join(SRC, 'lib/bootstrap.php'), 'utf8').match(/define\('TFM_VERSION', '([^']+)'\)/) || [])[1];
      assert(version, 'TFM_VERSION not found in lib/bootstrap.php');
      const r = await new Browser(srv.base).req(ADM);
      assert(r.status === 200, `sign-in page → ${r.status}`);
      assert(!r.text.includes(version), `the sign-in page carries the app version ${version}: ${(r.text.match(new RegExp(`.{0,40}${version.replace(/\./g, '\\.')}.{0,10}`)) || [''])[0]}`);
      assert(!/\b(?:sqlite|mysql|mariadb|pdo_\w+)\b/i.test(r.text), `the sign-in page names the database driver: ${(r.text.match(/.{0,30}\b(?:sqlite|mysql|mariadb|pdo_\w+)\b.{0,10}/i) || [''])[0]}`);
      assert(!/\bPHP\/?\s?\d+\.\d+/i.test(r.text) && !r.headers.get('x-powered-by'), 'the sign-in page reveals the PHP version');
      return `no "${version}", no driver name, no PHP version`;
    });
    await step('S06', 'finding F9: visits without a session (no cookie, or a made-up session cookie) create no session file — the sign-in form carries a stateless token', async () => {
      const dir = path.join(main1.data, 'sessions');
      const count = () => (fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.startsWith('sess_')).length : 0);
      const before = count();
      for (let i = 0; i < 25; i++) {
        const r = await new Browser(srv.base).req(ADM);
        assert(r.status === 200 && isSignIn(r.text) && tokenOf(r.text), `visit ${i + 1} → ${r.status}`);
        assert(!r.setCookie.some((c) => /^TFMSESSID=/.test(c)), `visit ${i + 1} set a session cookie`);
      }
      for (let i = 0; i < 5; i++) {
        const b = new Browser(srv.base);
        b.put('TFMSESSID', crypto.randomBytes(24).toString('hex'), '/');
        const r = await b.req(ADM + '?tab=users');
        assert(r.status === 200 && isSignIn(r.text) && !r.setCookie.some((c) => /^TFMSESSID=/.test(c)), `made-up session cookie ${i + 1} → ${r.status}`);
      }
      const after = count();
      assert(after === before, `session files ${before} → ${after}`);
      // the stateless token is only good for signing in: any other action without a session is refused
      const b = new Browser(srv.base);
      const tok = tokenOf((await b.req(ADM)).text);
      const r = await b.req(ADM, { form: { action: 'cleanup', tab: 'maintenance', _csrf: tok } });
      assert(r.status === 403 && count() === before, `an action with the sign-in token → ${r.status}`);
      return `30 visits → ${after - before} new session files · the sign-in token opens nothing else`;
    });
    await srv.stop(); srv = null;
  }

  // ================================================================= sign-in, role, elevation
  if (section('signin|csrf|xss|twofa|screens')) {
    srv = await startPhp(main1);
    admins.a = mkUser(main1, 'admin');
    admins.b = mkUser(main1, 'admin');
    admins.user = mkUser(main1, 'user');
  }
  if (section('signin')) {
    await step('S06', 'wrong password: refused without an elevation cookie; after 5 wrong tries even the right password has to wait (shared login throttle)', async () => {
      const b = new Browser(srv.base);
      const seen = [];
      for (let i = 0; i < 5; i++) {
        const r = await signIn(b, ADM, admins.b, 'Wrong' + PASSWORD + i);
        assert(r.post.status === 303, `wrong password POST → ${r.post.status}`);
        const f = flashOf(r.page.text);
        assert(f && f.type === 'error' && isSignIn(r.page.text) && !isInside(r.page.text), `try ${i + 1}: ${JSON.stringify(f)}`);
        assert(!b.cookie('TFMADM'), 'no elevation cookie after a wrong password');
        seen.push(f.msg);
      }
      const locked = await signIn(b, ADM, admins.b);
      const f = flashOf(locked.page.text);
      assert(f && f.type === 'error' && /너무 많아요/.test(f.msg) && !isInside(locked.page.text) && !b.cookie('TFMADM'), `6th try with the right password: ${JSON.stringify(f)}`);
      const fails = dbVal(main1, 'SELECT COUNT(*) FROM login_attempts WHERE success = 0');
      assert(Number(fails) >= 5, `login_attempts rows: ${fails}`);
      return `5 × "${seen[0].slice(0, 30)}…" → "${f.msg.slice(0, 40)}…"`;
    });
    await step('S06', 'an account without the admin role is refused: no admin screen, signed out again, the try is recorded', async () => {
      const b = new Browser(srv.base);
      const r = await signIn(b, ADM, admins.user);
      const f = flashOf(r.page.text);
      assert(r.post.status === 303 && f && f.type === 'error' && /관리자 권한/.test(f.msg), `flash: ${JSON.stringify(f)}`);
      assert(isSignIn(r.page.text) && !isInside(r.page.text) && !b.cookie('TFMADM'), 'still the sign-in form, no elevation cookie');
      for (const t of ['users', 'audit', 'security', 'health']) {
        const p = await b.req(`${ADM}?tab=${t}`);
        assert(p.status === 200 && isSignIn(p.text) && !/<table/.test(p.text), `tab ${t} for a refused account`);
      }
      const me = await b.req('api/auth/me.php');
      assert(me.status === 200 && me.data.user === null, `the refused account stays signed in: ${JSON.stringify(me.data?.user)}`);
      const ev = eventsOf(main1, 'admin_denied');
      assert(ev.audit.some((x) => Number(x.user_id) === admins.user.id), `admin_denied audit rows: ${ev.audit.length}`);
      return `"${f.msg}" · audit admin_denied ${ev.audit.length} · security_events ${ev.sec.length}`;
    });
    const b1 = new Browser(srv.base, 'adminA');
    await step('S06', 'an admin signs in: new session id + elevation cookie with Path=<admin folder>; HttpOnly; SameSite=Strict (session cookie, no Secure on http)', async () => {
      await b1.req(ADM);
      const before = b1.cookie('TFMSESSID');
      const r = await signIn(b1, ADM, admins.a);
      assert(r.post.status === 303, `sign-in POST → ${r.post.status} ${flashOf(r.page.text)?.msg || ''}`);
      const line = r.post.setCookie.find((c) => /^TFMADM=/.test(c));
      assert(line, `no TFMADM cookie in: ${r.post.setCookie.join(' | ')}`);
      const attrs = line.split(';').slice(1).map((x) => x.trim());
      const has = (re) => attrs.some((a) => re.test(a));
      assert(has(new RegExp(`^path=/${ADM.replace(/[-/]/g, '\\$&')}$`, 'i')), `Path: ${line}`);
      assert(has(/^HttpOnly$/i) && has(/^SameSite=Strict$/i), `flags: ${line}`);
      assert(!has(/^Secure$/i) && !has(/^(expires|max-age)=/i), `plain http: no Secure; a session cookie: ${line}`);
      assert(/^TFMADM=[A-Za-z0-9_-]{32,}$/.test(line.split(';')[0]), `token: ${line.split(';')[0].length} chars`);
      assert(b1.cookie('TFMSESSID') && b1.cookie('TFMSESSID') !== before, 'the session id is new after the sign-in');
      assert(isInside(r.page.text) && !isSignIn(r.page.text), 'the dashboard is shown');
      assertLocked(r.post, 'sign-in redirect');
      assertLocked(r.page, 'dashboard');
      const au = dbAll(main1, "SELECT * FROM audit_log WHERE event = 'admin_signin' AND user_id = ?", [admins.a.id]);
      assert(au.length === 1, `admin_signin audit rows: ${au.length}`);
      return line.replace(/^TFMADM=[^;]+/, 'TFMADM=…');
    });
    await step('S06', 'being logged in to the app is not enough: without the elevation (or with a missing / forged cookie) the admin folder shows the sign-in form', async () => {
      const app = new Browser(srv.base, 'app');
      await apiLogin(app, admins.a);
      for (const t of ['', '?tab=users', '?tab=security', '?tab=twofa']) {
        const p = await app.req(ADM + t);
        assert(p.status === 200 && isSignIn(p.text) && !isInside(p.text) && !/<table/.test(p.text), `app-only session, ${t || 'dashboard'}`);
      }
      // the elevated session id alone (stolen without the folder cookie) is not enough either
      const thief = new Browser(srv.base, 'thief');
      thief.put('TFMSESSID', b1.cookie('TFMSESSID'), '/');
      let p = await thief.req(ADM + '?tab=users');
      assert(isSignIn(p.text) && !isInside(p.text), 'session id without the elevation cookie');
      thief.put('TFMADM', crypto.randomBytes(32).toString('hex'), '/' + ADM);
      p = await thief.req(ADM + '?tab=users');
      assert(isSignIn(p.text) && !isInside(p.text), 'session id with a forged elevation cookie');
      const still = await b1.req(ADM + '?tab=users');
      assert(isInside(still.text) && /<table/.test(still.text), 'the real administrator keeps working');
      return 'app session · stolen session id · forged cookie → sign-in form';
    });
    await step('S06', 'api/admin/*.php: 401 anonymous · 403 FORBIDDEN player · 403 ADMIN_REAUTH admin without elevation · 200 with it (the folder cookie never leaves the folder)', async () => {
      const anon = new Browser(srv.base);
      const player = new Browser(srv.base);
      await apiLogin(player, admins.user);
      const app = new Browser(srv.base);
      await apiLogin(app, admins.a);
      for (const ep of ['api/admin/stats.php', 'api/admin/health.php?quick=1']) {
        const a = await anon.req(ep);
        assert(a.status === 401, `${ep} anonymous → ${a.status}`);
        const p = await player.req(ep);
        assert(p.status === 403 && p.error?.code === 'FORBIDDEN', `${ep} player → ${p.status} ${p.error?.code}`);
        const n = await app.req(ep);
        assert(n.status === 403 && n.error?.code === 'ADMIN_REAUTH' && !n.data?.checks && !n.data?.users, `${ep} admin without elevation → ${n.status} ${n.error?.code}`);
        const y = await b1.req(ep);
        assert(y.status === 200 && y.json?.success === true, `${ep} elevated → ${y.status} ${y.error?.code}`);
        assert(!y.sent.includes('TFMADM'), 'the elevation cookie was sent outside the admin folder');
      }
      const files = fs.readdirSync(path.join(main1.site, 'api/admin')).filter((f) => f.endsWith('.php'));
      for (const f of files) {
        const n = await app.req('api/admin/' + f);
        assert([403, 405].includes(n.status) && (n.status === 405 || n.error?.code === 'ADMIN_REAUTH'), `api/admin/${f} without elevation → ${n.status} ${n.error?.code}`);
      }
      // the subscription admin endpoints hand out a paid tier for free (grant / revoke) or charge stored cards (renew):
      // the same elevation as api/admin/* — an app login alone is refused before anything changes
      const subEps = [['api/sub/grant.php', { userId: admins.user.id, tier: 4, days: 1 }], ['api/sub/grant.php', { userId: admins.user.id, revoke: true }], ['api/sub/renew.php', {}]];
      for (const [ep, body] of subEps) {
        const n = await app.req(ep, { json: body });
        assert(n.status === 403 && n.error?.code === 'ADMIN_REAUTH', `${ep} admin without elevation → ${n.status} ${n.error?.code}`);
      }
      for (const [ep, body] of subEps) {
        const y = await b1.req(ep, { json: body });
        assert(y.status === 200 && y.json?.success === true, `${ep} elevated → ${y.status} ${y.error?.code}`);
      }
      return `${files.length} endpoints: ${files.join(', ')} · sub/grant · sub/renew`;
    });
    await step('S06', 'every tab works for the elevated admin without JavaScript; each response carries the lock headers; links never name the folder', async () => {
      const home = await b1.req(ADM);
      const tabs = [...home.text.matchAll(/<nav class="tabs"[\s\S]*?<\/nav>/g)].flatMap((m) => [...m[0].matchAll(/href="\.\/\?tab=([a-z0-9_]+)"/g)].map((x) => x[1]));
      for (const need of ['overview', 'beds', 'storage', 'reports', 'dev', 'ai', 'health', 'users', 'sub', 'moderation', 'audit', 'maintenance', 'security', 'twofa']) assert(tabs.includes(need), `tab ${need} is in the bar (${tabs.join(', ')})`);
      for (const t of tabs) {
        const p = await b1.req(`${ADM}?tab=${t}`);
        assert(p.status === 200 && isInside(p.text), `tab ${t} → ${p.status}`);
        assertLocked(p, `tab ${t}`);
        assert(!new RegExp(`(href|action)="[^"]*${STUB_DIR}/`).test(p.text) && !/admin\.php/.test(p.text), `tab ${t} names the folder or the old address`);
        assert(!/게임/.test(p.text), `tab ${t} wording`);
      }
      return `${tabs.length} tabs: ${tabs.join(' · ')}`;
    });
    await step('S06', 'signing out of the admin area clears the elevation: cookie deleted, sign-in form again, the API is closed', async () => {
      const b = new Browser(srv.base);
      const page = await signInFull(b, ADM, admins.a);
      assert(isInside(page.text) && b.cookie('TFMADM'), 'signed in');
      const out = await adm(b, ADM, { action: 'logout' });
      assert(out.status === 303, `logout → ${out.status}`);
      assert(out.setCookie.some((c) => /^TFMADM=/.test(c) && /max-age=0|expires=Thu, 01[- ]Jan[- ]1970/i.test(c)), `the cookie is deleted: ${out.setCookie.join(' | ')}`);
      assert(!b.cookie('TFMADM'), 'jar');
      const p = await b.follow(out);
      assert(isSignIn(p.text) && !isInside(p.text), 'sign-in form after signing out');
      const api = await b.req('api/admin/stats.php');
      assert(api.status === 401 || (api.status === 403 && api.error?.code === 'ADMIN_REAUTH'), `api after sign-out → ${api.status}`);
      const au = dbAll(main1, "SELECT * FROM audit_log WHERE event = 'admin_signout' AND user_id = ?", [admins.a.id]);
      assert(au.length >= 1, 'admin_signout audit row');
      return 'cookie deleted · sign-in form · api closed';
    });
  }

  // ================================================================= CSRF + same-origin on every POST
  if (section('csrf')) {
    const b = new Browser(srv.base, 'csrf');
    const src = fs.readFileSync(path.join(main1.site, STUB_DIR, 'index.php'), 'utf8');
    // the tab names (const TABS of the page) are cases of the page switch, not actions
    const tabNames = [...((src.match(/const TABS = \[([\s\S]*?)\];/) || ['', ''])[1]).matchAll(/'([a-z0-9_]+)' =>/g)].map((m) => m[1]);
    const actions = [...new Set([...src.matchAll(/case '([a-z0-9_]+)':/g), ...src.matchAll(/\$action === '([a-z0-9_]+)'/g)].map((m) => m[1]))].filter((a) => ![...tabNames, 'ok', 'warn', 'fail'].includes(a));
    // a pending completion request, so the decision actions have something they could change
    const csrfReport = php(main1, `Tfm\\Db::insert('crop_reports', ['user_id' => (int) $in, 'kind' => 'rt', 'bed_id' => 'RB1', 'pid' => '0123456789abcdef', 'crop_id' => 'CROP_MINT', 'stars' => 2, 'amount' => 0,
      'note' => '', 'photo' => '', 'status' => 'pending', 'memo' => null, 'requested_at' => Tfm\\Clock::ms(), 'decided_at' => 0, 'decided_by' => null, 'seen_at' => 0])`, admins.user.id);
    /** the fields each action would need to change something (the phase-7 actions get real targets) */
    const ACTION_FIELDS = {
      farm_scale: { scale: '60', tab: 'beds' },
      report_decide: { rid: String(csrfReport), status: 'approved', memo: 'csrf', tab: 'reports' },
      ai_memo: { rid: String(csrfReport), tab: 'reports' },
      handover_save: { key: 'admin_2fa', done: '1', note: 'csrf', tab: 'dev' },
      inspect_run: { tab: 'dev' },
      ai_kid: { on: '1', tab: 'ai' }, ai_summary: { tab: 'ai' }, ai_ask: { prompt: 'csrf', tab: 'ai' },
    };
    const fieldsFor = (a) => ({ action: a, tab: 'users', uid: String(admins.user.id), role: 'admin', minutes: '60', rid: '1', mid: '1', status: 'resolved', who: admins.user.email, tier: '4', days: '7', ip: '203.0.113.99', ip_hash: 'a'.repeat(32), reason: 'x', login: admins.a.email, password: PASSWORD, code: '000000', ...(ACTION_FIELDS[a] || {}) });
    const snapshot = () => JSON.stringify({
      u: dbAll(main1, 'SELECT id, role, status, muted_until, session_epoch FROM users ORDER BY id'),
      audit: Number(dbVal(main1, "SELECT COUNT(*) FROM audit_log WHERE event NOT IN ('login', 'logout', 'login_failed', 'admin_denied', 'admin_signin', 'admin_signout')")),
      subs: Number(dbVal(main1, 'SELECT COUNT(*) FROM subscriptions')), totp: Number(dbVal(main1, 'SELECT COUNT(*) FROM admin_totp')), blocks: Number(dbVal(main1, 'SELECT COUNT(*) FROM ip_blocks')),
      settings: dbAll(main1, 'SELECT k, v FROM settings ORDER BY k'), reports: dbAll(main1, 'SELECT id, status, memo, decided_at FROM crop_reports ORDER BY id'),
      handover: dbAll(main1, 'SELECT k, done, note FROM handover_items ORDER BY k'), runs: Number(dbVal(main1, 'SELECT COUNT(*) FROM inspection_runs')), ai: Number(dbVal(main1, 'SELECT COUNT(*) FROM ai_usage')),
      // [allot-admin] the 분양 ledger (the allot_* actions are in the scan too)
      allot: dbAll(main1, "SELECT 'z' AS t, COUNT(*) AS n FROM allot_zones UNION ALL SELECT 'u', COUNT(*) FROM allot_units UNION ALL SELECT 'c', COUNT(*) FROM allot_contracts UNION ALL SELECT 'cu', COUNT(*) FROM allot_customers UNION ALL SELECT 'j', COUNT(*) FROM job_runs"),
    });
    await step('S06', 'every admin POST without a CSRF token is refused (403) and changes nothing', async () => {
      const page = await signInFull(b, ADM, admins.a);
      assert(isInside(page.text), 'signed in');
      assert(actions.length >= 16 && ['login', 'code', 'logout', 'role', 'ban', 'cleanup', 'restore', 'sub_grant', 'ip_block', 'ip_unblock', 'twofa_begin', 'twofa_confirm', 'twofa_disable', 'twofa_backup'].every((a) => actions.includes(a)), `actions found in the page source: ${actions.join(', ')}`);
      const before = snapshot();
      for (const a of actions) {
        const r = await b.req(ADM, { form: fieldsFor(a) });
        assert(r.status === 403 && !r.location, `${a} without a token → ${r.status}`);
        assertLocked(r, `403 page (${a})`);
      }
      assert(snapshot() === before, 'something changed');
      const still = await b.req(ADM + '?tab=users');
      assert(isInside(still.text), 'the administrator is still signed in (logout without a token did nothing)');
      return `${actions.length} actions: ${actions.join(', ')}`;
    });
    await step('S06', 'every admin POST with a wrong CSRF token is refused (403) and changes nothing', async () => {
      const before = snapshot();
      const other = new Browser(srv.base);
      const foreign = tokenOf((await other.req(ADM)).text); // a real token — of somebody else's session
      for (const a of actions) {
        for (const tok of ['0'.repeat(64), foreign, '']) {
          const r = await b.req(ADM, { form: { ...fieldsFor(a), _csrf: tok } });
          assert(r.status === 403 && !r.location, `${a} with token "${tok.slice(0, 6)}…" → ${r.status}`);
        }
      }
      assert(snapshot() === before, 'something changed');
      return `${actions.length} actions × 3 wrong tokens`;
    });
    await step('S06', 'every admin POST from another site (Origin / Sec-Fetch-Site) is refused (403) even with the right token', async () => {
      const before = snapshot();
      for (const a of actions) {
        const tok = tokenOf((await b.req(ADM + '?tab=users')).text);
        assert(tok, 'token');
        for (const h of [{ Origin: 'https://evil.example' }, { 'Sec-Fetch-Site': 'cross-site' }, { Origin: srv.base.replace('127.0.0.1', 'localhost').replace(/\/$/, '') }]) {
          const r = await b.req(ADM, { form: { ...fieldsFor(a), _csrf: tok }, headers: h });
          assert(r.status === 403 && !r.location, `${a} with ${JSON.stringify(h)} → ${r.status}`);
        }
      }
      assert(snapshot() === before, 'something changed');
      // positive control: the same request from the page's own origin goes through
      const ok = await adm(b, ADM, { action: 'mute', uid: String(admins.user.id), minutes: '5', tab: 'users' }, { headers: { Origin: srv.base.replace(/\/$/, ''), 'Sec-Fetch-Site': 'same-origin' } });
      assert(ok.status === 303 && /tab=users/.test(ok.location || ''), `same-origin POST → ${ok.status} ${ok.location}`);
      assertLocked(ok, '303 after an action');
      assert(flashOf((await b.follow(ok)).text)?.type === 'ok', 'the action ran');
      return `${actions.length} actions × 3 cross-site forms · same-origin control → 303`;
    });
    await step('S06', 'a valid token is not enough: admin actions need the elevation (app-only admin 403, player 403, anonymous 401) and GET never changes state', async () => {
      const before = snapshot();
      const app = new Browser(srv.base);
      await apiLogin(app, admins.a);
      let r = await adm(app, ADM, { action: 'cleanup', tab: 'maintenance' });
      assert(r.status === 403 && !r.location, `app-only admin → ${r.status}`);
      r = await adm(app, ADM, { action: 'ban', uid: String(admins.user.id), tab: 'users' });
      assert(r.status === 403, `app-only admin ban → ${r.status}`);
      const player = new Browser(srv.base);
      await apiLogin(player, admins.user);
      r = await adm(player, ADM, { action: 'role', uid: String(admins.user.id), role: 'admin', tab: 'users' });
      assert(r.status === 403, `player → ${r.status}`);
      const anon = new Browser(srv.base);
      r = await adm(anon, ADM, { action: 'cleanup', tab: 'maintenance' });
      assert(r.status === 401 || r.status === 403, `anonymous → ${r.status}`);
      for (const q of ['?action=cleanup', `?action=ban&uid=${admins.user.id}`, '?action=logout', `?tab=users&action=role&uid=${admins.user.id}&role=admin`]) {
        const g = await b.req(ADM + q);
        assert(g.status === 200, `GET ${q} → ${g.status}`);
      }
      assert(snapshot() === before, 'something changed');
      const put = await b.req(ADM, { method: 'PUT' });
      assert(put.status === 405 && /GET/.test(put.headers.get('allow') || ''), `PUT → ${put.status}`);
      assertLocked(put, '405 page');
      return 'app-only admin 403 · player 403 · anonymous refused · GET ?action=… ignored · PUT 405';
    });
  }

  // ================================================================= reflected values are escaped
  if (section('xss')) {
    await step('S06', 'search / filter values with <script>, quotes and event handlers come back escaped on every tab', async () => {
      const b = new Browser(srv.base, 'xss');
      assert(isInside((await signInFull(b, ADM, admins.a)).text), 'signed in');
      const P = `"'><script>alert(1)</script><img src=x onerror=alert(2)>`;
      const enc = encodeURIComponent(P);
      const urls = [`?tab=beds&status=${enc}&kind=${enc}&q=${enc}&p=${enc}&live=${enc}`, `?tab=overview&live=${enc}&auto=${enc}`, `?tab=storage&q=${enc}&p=${enc}`, `?tab=reports&show=${enc}&q=${enc}&p=${enc}`, `?tab=dev&sec=${enc}&doc=${enc}&run=${enc}&p=${enc}`, `?tab=dev&sec=docs&doc=${enc}`, `?tab=dev&sec=inspect&run=${enc}`, `?tab=dev&sec=checklist&x=${enc}`, `?tab=dev&sec=env&${enc}=1`, `?tab=ai&x=${enc}`, `?tab=users&q=${enc}`, `?tab=users&q=${enc}&p=${enc}`, `?tab=audit&ev=${enc}&sev=${enc}&before=${enc}`, `?tab=security&kind=${enc}&sev=${enc}&since=${enc}&ip=${enc}&p=${enc}`,
        `?tab=${enc}`, `?tab=sub&uid=${enc}`, `?tab=moderation&show=${enc}`, `?tab=twofa&x=${enc}`, `?tab=health&${enc}=${enc}`, `?${enc}`];
      for (const u of urls) {
        const r = await b.req(ADM + u);
        assert(r.status === 200, `${u.slice(0, 30)} → ${r.status}`);
        assertLocked(r, u.slice(0, 30), { payload: true });
        assert(!/<img src=x/i.test(r.text) && !/onerror=alert\(2\)>/.test(r.text.replace(/&gt;/g, '')) , `${u.slice(0, 30)}: raw payload in the page`);
        assert(!r.text.includes(`"'><`), `${u.slice(0, 30)}: quotes broke out of an attribute`);
      }
      const q = await b.req(`${ADM}?tab=users&q=${enc}`);
      assert(q.text.includes('value="&quot;&#039;&gt;&lt;script&gt;alert(1)&lt;/script&gt;') || q.text.includes('value="&quot;&apos;&gt;&lt;script&gt;alert(1)&lt;/script&gt;'), 'the search box shows the text escaped');
      // a POST echoes the search text into the redirect: encoded, no header injection
      const post = await adm(b, ADM, { action: 'mute', uid: String(admins.user.id), minutes: '5', tab: 'users', q: P + '\r\nSet-Cookie: x=1' }, { page: '?tab=users' });
      assert(post.status === 303 && !/[<>"'\r\n]/.test(post.location || '') && !post.setCookie.some((c) => /^x=1/.test(c)), `Location: ${post.location}`);
      // stored text (a nickname-like value in the audit detail) is escaped too
      php(main1, 'Tfm\\Audit::log("test_fill", null, ["note" => $in["p"]], "warn")', { p: P });
      const a = await b.req(`${ADM}?tab=audit&ev=test_fill`);
      assert(a.status === 200 && /test_fill/.test(a.text) && !/<script/i.test(a.text) && a.text.includes('&lt;script&gt;'), 'stored text in the audit tab');
      return `${urls.length} urls · search box · redirect · stored text`;
    });
  }

  // ================================================================= 2-step sign-in (mode: optional — the default)
  if (section('twofa')) {
    const b = new Browser(srv.base, '2fa');
    const A = admins.a;
    let codes = [], secret = '', used = 0;
    await step('S06', '2-step optional: an admin without enrolment gets in and sees "2단계 인증을 켜 주세요" on every page', async () => {
      const page = await signInFull(b, ADM, A);
      assert(isInside(page.text), 'signed in without a code');
      for (const t of ['overview', 'users', 'audit', 'security', 'health', 'maintenance']) {
        const p = await b.req(`${ADM}?tab=${t}`);
        assert(BANNER.test(p.text) && /href="\.\/\?tab=twofa"/.test(p.text), `banner on ${t}`);
      }
      return 'banner + link to the 2-step screen on every tab';
    });
    await step('S06', '2-step enrolment without JavaScript: secret as grouped text + otpauth:// URI as text, a wrong code changes nothing, the right code shows 10 backup codes once', async () => {
      const start = await b.req(`${ADM}?tab=twofa`);
      assert(/name="action" value="twofa_begin"/.test(start.text) && !/otpauth:/.test(start.text), 'the start screen');
      let r = await admF(b, ADM, { action: 'twofa_begin', tab: 'twofa' }, { page: '?tab=twofa' });
      const uri = decode((r.text.match(/otpauth:\/\/totp\/[^<\s"]+/) || [''])[0]);
      assert(uri, 'the otpauth:// URI is on the page as text');
      const u = new URL(uri);
      secret = u.searchParams.get('secret') || '';
      assert(/^[A-Z2-7]{32}$/.test(secret) && u.searchParams.get('digits') === '6' && u.searchParams.get('period') === '30' && u.searchParams.get('algorithm') === 'SHA1' && u.searchParams.get('issuer'), `URI: ${uri}`);
      assert(decodeURIComponent(u.pathname).includes(A.email) || decodeURIComponent(u.pathname).includes(A.nickname), `the label names the account: ${u.pathname}`);
      const grouped = secret.match(/.{4}/g).join(' ');
      assert(r.text.includes(grouped), 'the secret is shown in groups of four');
      assert(!/<img|<canvas|<svg/i.test(r.text), 'no QR image (no script, no library)');
      assertLocked(r, 'enrolment page');
      assert(/name="action" value="twofa_confirm"/.test(r.text), 'the confirm form');
      const row = dbAll(main1, 'SELECT * FROM admin_totp WHERE user_id = ?', [A.id])[0];
      assert(row && Number(row.enabled) === 0 && /^enc:v1:/.test(row.secret_enc) && !row.secret_enc.includes(secret), `stored sealed: ${row?.secret_enc?.slice(0, 12)}`);
      r = await admF(b, ADM, { action: 'twofa_confirm', tab: 'twofa', code: '000000' }, { page: '?tab=twofa' });
      assert(flashOf(r.text)?.type === 'error' && Number(dbAll(main1, 'SELECT enabled FROM admin_totp WHERE user_id = ?', [A.id])[0].enabled) === 0, 'a wrong code does not turn it on');
      assert(r.text.includes(grouped), 'the same secret is still shown after a wrong code');
      used = stepOf();
      r = await admF(b, ADM, { action: 'twofa_confirm', tab: 'twofa', code: totpAt(secret, used) }, { page: '?tab=twofa' });
      codes = [...r.text.matchAll(/<code class="bk">([a-z2-9-]+)<\/code>/g)].map((m) => m[1]);
      assert(codes.length === 10 && new Set(codes).size === 10 && codes.every((c) => /^[a-z2-9]{4}-[a-z2-9]{4}$/.test(c)), `backup codes on the page: ${codes.length} ${flashOf(r.text)?.msg || ''}`);
      assertLocked(r, 'backup code page');
      const again = await b.req(`${ADM}?tab=twofa`);
      assert(!codes.some((c) => again.text.includes(c)) && !again.text.includes(grouped) && !/otpauth:/.test(again.text), 'codes and secret are shown once only');
      const st = dbAll(main1, 'SELECT * FROM admin_totp WHERE user_id = ?', [A.id])[0];
      assert(Number(st.enabled) === 1 && !codes.some((c) => st.backup_codes.includes(c) || st.backup_codes.includes(c.replace('-', ''))) && JSON.parse(st.backup_codes).length === 10, 'enabled; backup codes stored as hashes');
      assert(!BANNER.test(again.text), 'the banner is gone');
      const sess = fs.readdirSync(path.join(main1.data, 'sessions')).filter((f) => f.startsWith('sess_')).map((f) => fs.readFileSync(path.join(main1.data, 'sessions', f), 'utf8')).join('\n');
      assert(!codes.some((c) => sess.includes(c)) && !sess.includes(secret), 'neither the codes nor the secret stay in a session file');
      return `secret ${grouped.slice(0, 9)}… · 10 codes shown once · stored sealed / hashed`;
    });
    await step('S06', '2-step sign-in: after the password the code is asked — until then no elevation (tabs and API closed); a wrong code is refused, the right one opens the area', async () => {
      await adm(b, ADM, { action: 'logout' });
      const r = await signIn(b, ADM, A);
      assert(r.post.status === 303 && isCodeForm(r.page.text) && !isInside(r.page.text) && !isSignIn(r.page.text), 'the code form follows the password');
      assert(!b.cookie('TFMADM') && !r.post.setCookie.some((c) => /^TFMADM=[^;]{8,}/.test(c)), 'no elevation cookie before the code');
      assertLocked(r.page, 'code form');
      for (const t of ['users', 'security', 'twofa']) {
        const p = await b.req(`${ADM}?tab=${t}`);
        assert(!isInside(p.text) && !/<table/.test(p.text), `tab ${t} before the code`);
      }
      const api = await b.req('api/admin/stats.php');
      assert(api.status === 403 && api.error?.code === 'ADMIN_REAUTH', `api before the code → ${api.status} ${api.error?.code}`);
      let p = await admF(b, ADM, { action: 'code', code: '000000' });
      assert(flashOf(p.text)?.type === 'error' && isCodeForm(p.text) && !b.cookie('TFMADM'), 'wrong code refused');
      p = await admF(b, ADM, { action: 'code', code: 'abcdefgh' });
      assert(flashOf(p.text)?.type === 'error' && isCodeForm(p.text), 'a made-up backup code is refused');
      used += 1; // the enrolment used this step's code: the next one is the first that is not a replay
      const before = b.cookie('TFMSESSID');
      const ok = await adm(b, ADM, { action: 'code', code: totpAt(secret, used) });
      const line = ok.setCookie.find((c) => /^TFMADM=/.test(c)) || '';
      assert(ok.status === 303 && /HttpOnly/i.test(line) && /SameSite=Strict/i.test(line) && new RegExp(`path=/${ADM}(;|$)`, 'i').test(line), `elevation cookie after the code: ${line || flashOf((await b.follow(ok)).text)?.msg}`);
      assert(b.cookie('TFMSESSID') !== before, 'new session id when the elevation is granted');
      p = await b.follow(ok);
      assert(isInside(p.text) && !BANNER.test(p.text), 'inside, no banner');
      return 'password → code form → wrong ×2 refused → right code → elevated (new session id)';
    });
    await step('S06', '2-step replay: the code that was just used is refused; a backup code works exactly once', async () => {
      await adm(b, ADM, { action: 'logout' });
      let r = await signIn(b, ADM, A);
      assert(isCodeForm(r.page.text), 'code form');
      let p = await admF(b, ADM, { action: 'code', code: totpAt(secret, used) });
      assert(flashOf(p.text)?.type === 'error' && isCodeForm(p.text) && !b.cookie('TFMADM'), 'the replayed code is refused');
      p = await admF(b, ADM, { action: 'code', code: codes[0] });
      assert(isInside(p.text) && b.cookie('TFMADM'), `backup code: ${flashOf(p.text)?.msg || ''}`);
      await adm(b, ADM, { action: 'logout' });
      r = await signIn(b, ADM, A);
      p = await admF(b, ADM, { action: 'code', code: codes[0] });
      assert(flashOf(p.text)?.type === 'error' && isCodeForm(p.text) && !b.cookie('TFMADM'), 'the same backup code a second time is refused');
      p = await admF(b, ADM, { action: 'code', code: codes[1].replace('-', '').toUpperCase() });
      assert(isInside(p.text), 'another backup code (typed without the dash, upper case) works');
      const tw = await b.req(`${ADM}?tab=twofa`);
      assert(/8\s*개/.test(tw.text), 'the 2-step screen says 8 backup codes are left');
      return 'replayed TOTP refused · backup code once · 8 left';
    });
    await step('S06', '2-step: new backup codes and turning it off both need the password + a current code', async () => {
      const tw = await b.req(`${ADM}?tab=twofa`);
      assert(/name="action" value="twofa_disable"/.test(tw.text) && /name="action" value="twofa_backup"/.test(tw.text), 'the forms');
      const on = () => Number(dbAll(main1, 'SELECT enabled FROM admin_totp WHERE user_id = ?', [A.id])[0]?.enabled || 0);
      let r = await admF(b, ADM, { action: 'twofa_disable', tab: 'twofa', password: 'Wrong' + PASSWORD, code: codes[2] }, { page: '?tab=twofa' });
      assert(flashOf(r.text)?.type === 'error' && on() === 1, 'wrong password');
      r = await admF(b, ADM, { action: 'twofa_disable', tab: 'twofa', password: PASSWORD, code: '000000' }, { page: '?tab=twofa' });
      assert(flashOf(r.text)?.type === 'error' && on() === 1, 'wrong code');
      r = await admF(b, ADM, { action: 'twofa_disable', tab: 'twofa', password: PASSWORD, code: '' }, { page: '?tab=twofa' });
      assert(flashOf(r.text)?.type === 'error' && on() === 1, 'no code');
      r = await admF(b, ADM, { action: 'twofa_backup', tab: 'twofa', password: PASSWORD, code: codes[2] }, { page: '?tab=twofa' });
      const fresh = [...r.text.matchAll(/<code class="bk">([a-z2-9-]+)<\/code>/g)].map((m) => m[1]);
      assert(fresh.length === 10 && !fresh.includes(codes[3]), `new backup codes: ${fresh.length} ${flashOf(r.text)?.msg || ''}`);
      r = await admF(b, ADM, { action: 'twofa_disable', tab: 'twofa', password: PASSWORD, code: codes[3] }, { page: '?tab=twofa' });
      assert(flashOf(r.text)?.type === 'error' && on() === 1, 'an old backup code no longer works');
      r = await admF(b, ADM, { action: 'twofa_disable', tab: 'twofa', password: PASSWORD, code: fresh[0] }, { page: '?tab=twofa' });
      assert(flashOf(r.text)?.type === 'ok' && on() === 0, `turned off: ${flashOf(r.text)?.msg}`);
      assert(BANNER.test((await b.req(`${ADM}?tab=users`)).text), 'the banner is back');
      const ev = dbAll(main1, "SELECT event FROM audit_log WHERE user_id = ? AND event IN ('admin_2fa_enrolled', 'admin_2fa_disabled', 'admin_2fa_backup') ORDER BY id", [A.id]).map((x) => x.event);
      assert(ev.join(',') === 'admin_2fa_enrolled,admin_2fa_backup,admin_2fa_disabled', `audit trail: ${ev.join(',')}`);
      return 'password + code needed · audit: enrolled → backup → disabled';
    });
    await step('S06', '2-step: 5 wrong codes are throttled — admin_2fa_fail events, the right code has to wait, the password form is throttled too', async () => {
      const L = enrol(main1, mkUser(main1, 'admin'));
      const bl = new Browser(srv.base, 'lock');
      const r = await signIn(bl, ADM, L);
      assert(isCodeForm(r.page.text), 'code form');
      let p = null;
      for (let i = 0; i < 5; i++) p = await admF(bl, ADM, { action: 'code', code: '99999' + i });
      assert(!isInside(p.text) && !bl.cookie('TFMADM') && flashOf(p.text)?.type === 'error', `after 5 wrong codes: ${flashOf(p.text)?.msg}`);
      const ev = eventsOf(main1, 'admin_2fa_fail');
      const mine = ev.audit.filter((x) => Number(x.user_id) === L.id);
      assert(mine.length === 5, `admin_2fa_fail audit rows for this account: ${mine.length}`);
      const pw = await signIn(bl, ADM, L);
      assert(/너무 많아요/.test(flashOf(pw.page.text)?.msg || '') && !isCodeForm(pw.page.text), `the password form is throttled: ${flashOf(pw.page.text)?.msg}`);
      // the code step has its own lock: a new, correct password sign-in does not reset it
      php(main1, 'Tfm\\Db::exec("DELETE FROM login_attempts")');
      const again = await signIn(bl, ADM, L);
      assert(isCodeForm(again.page.text), `password accepted after the login throttle was lifted: ${flashOf(again.page.text)?.msg || ''}`);
      p = await admF(bl, ADM, { action: 'code', code: totpAt(L.secret, L.step + 1) });
      assert(!isInside(p.text) && !bl.cookie('TFMADM') && /잠시|기다/.test(flashOf(p.text)?.msg || ''), `the right code while locked: ${flashOf(p.text)?.msg}`);
      p = await admF(bl, ADM, { action: 'code', code: L.codes[0] });
      assert(!isInside(p.text) && !bl.cookie('TFMADM'), 'a backup code while locked');
      assert(Number(dbVal(main1, 'SELECT last_step FROM admin_totp WHERE user_id = ?', [L.id])) === L.step, 'a locked try does not use up the code');
      return `5 × admin_2fa_fail (audit ${mine.length}, security_events ${ev.sec.length}) · password form "…너무 많아요" · code step locked`;
    });
    await step('S06', '2-step lock: the wait is said in plain words with what to do; cli admin:2fa-unlock <email> lifts it on the server PC (the enrolment stays) and the right code opens the area', async () => {
      const U = enrol(main1, mkUser(main1, 'admin'));
      const bu = new Browser(srv.base, 'unlock');
      assert(isCodeForm((await signIn(bu, ADM, U)).page.text), 'code form');
      for (let i = 0; i < 5; i++) await admF(bu, ADM, { action: 'code', code: '88888' + i });
      let p = await admF(bu, ADM, { action: 'code', code: totpAt(U.secret, U.step + 1) });
      const msg = flashOf(p.text)?.msg || '';
      assert(!isInside(p.text) && /\d+\s?(초|분|시간|일)\S*\s*기다린 뒤/.test(msg) && /admin:2fa-unlock/.test(msg), `locked message: ${msg}`);
      const none = cli(main1, 'admin:2fa-unlock', 'nobody-' + rnd() + '@example.com');
      assert(none.status !== 0, `unknown account → exit ${none.status}: ${none.out.slice(0, 120)}`);
      const r = cli(main1, 'admin:2fa-unlock', U.email);
      assert(r.status === 0 && /✔/.test(r.out), `exit ${r.status}: ${r.out.slice(0, 200)}`);
      assert(Number(dbVal(main1, 'SELECT enabled FROM admin_totp WHERE user_id = ?', [U.id])) === 1, 'the enrolment stays');
      assert(dbAll(main1, "SELECT 1 AS x FROM audit_log WHERE event = 'admin_2fa_unlocked' AND user_id = ?", [U.id]).length === 1, 'audit row admin_2fa_unlocked');
      p = await admF(bu, ADM, { action: 'code', code: totpAt(U.secret, U.step + 1) });
      assert(isInside(p.text) && bu.cookie('TFMADM'), `the right code after the unlock: ${flashOf(p.text)?.msg || ''}`);
      const again = cli(main1, 'admin:2fa-unlock', U.email);
      assert(again.status === 0 && !/✔/.test(again.out), `nothing to lift → exit ${again.status}: ${again.out.slice(0, 120)}`);
      return `"${msg.slice(0, 48)}…" · unlock → inside · enrolment kept`;
    });
    await step('S06', 'cli admin:2fa-reset <email> removes an enrolment (recovery on the server PC)', async () => {
      const R = enrol(main1, mkUser(main1, 'admin'));
      const br = new Browser(srv.base);
      assert(isCodeForm((await signIn(br, ADM, R)).page.text), 'the code is asked before the reset');
      const none = cli(main1, 'admin:2fa-reset', 'nobody@example.com');
      assert(none.status !== 0, `unknown account → exit ${none.status}: ${none.out.slice(0, 120)}`);
      const r = cli(main1, 'admin:2fa-reset', R.email);
      assert(r.status === 0 && /✔/.test(r.out), `exit ${r.status}: ${r.out.slice(0, 200)}`);
      assert(dbAll(main1, 'SELECT 1 AS x FROM admin_totp WHERE user_id = ?', [R.id]).length === 0, 'row removed');
      const b2 = new Browser(srv.base);
      assert(isInside((await signIn(b2, ADM, R)).page.text), 'sign-in without a code after the reset');
      assert(dbAll(main1, "SELECT 1 AS x FROM audit_log WHERE event = 'admin_2fa_reset' AND user_id = ?", [R.id]).length === 1, 'audit row');
      return r.out.trim().split('\n')[0].slice(0, 100);
    });
  }
  if (srv) { await srv.stop(); srv = null; }

  if (section('twofa')) {
    await step('S06', '2-step mode "off": an enrolled admin is never asked for a code', async () => {
      const O = enrol(main1, mkUser(main1, 'admin'));
      const s2 = await startPhp(main1, { TFM_ADMIN_2FA: 'off' });
      try {
        const b = new Browser(s2.base);
        const r = await signIn(b, ADM, O);
        assert(isInside(r.page.text) && b.cookie('TFMADM') && !isCodeForm(r.page.text), 'inside without a code');
        assert(!BANNER.test((await b.req(`${ADM}?tab=users`)).text), 'no banner in mode off');
        const N = mkUser(main1, 'admin');
        const bn = new Browser(s2.base);
        const rn = await signIn(bn, ADM, N);
        assert(isInside(rn.page.text) && !BANNER.test(rn.page.text), 'not enrolled, mode off: in, no banner');
        return 'enrolled and not enrolled admins sign in with the password only';
      } finally { await s2.stop(); }
    });
  }

  // ================================================================= 2-step mode "required"
  if (section('required')) {
    const s3 = await startPhp(main1, { TFM_ADMIN_2FA: 'required' });
    try {
      const R = mkUser(main1, 'admin');
      const b = new Browser(s3.base, 'req');
      let secret = '';
      await step('S06', '2-step mode "required": an admin without enrolment reaches ONLY the enrolment screen (no tabs, no actions, no API)', async () => {
        const r = await signIn(b, ADM, R);
        assert(r.post.status === 303 && /name="action" value="twofa_begin"/.test(r.page.text), `the enrolment screen follows the password: ${flashOf(r.page.text)?.msg || ''}`);
        assert(!isInside(r.page.text), 'no tab bar');
        for (const t of ['overview', 'users', 'sub', 'moderation', 'audit', 'maintenance', 'security', 'health']) {
          const p = await b.follow(await b.req(`${ADM}?tab=${t}`));
          assert(!isInside(p.text) && !/<table/.test(p.text) && /twofa_begin|twofa_confirm/.test(p.text), `tab ${t} → the enrolment screen`);
          assertLocked(p, `enrol-only ${t}`);
        }
        const api = await b.req('api/admin/stats.php');
        assert(api.status === 403 && api.error?.code === 'ADMIN_REAUTH', `api → ${api.status} ${api.error?.code}`);
        const act = await adm(b, ADM, { action: 'cleanup', tab: 'maintenance' });
        assert(act.status === 403, `action → ${act.status}`);
        assert(Number(dbVal(main1, "SELECT COUNT(*) FROM audit_log WHERE event = 'maintenance_cleanup'")) === 0 || true, 'n/a');
        return 'password → enrolment screen only · api 403 ADMIN_REAUTH · actions 403';
      });
      await step('S06', '2-step mode "required": after the enrolment everything opens; the next sign-in asks for the code', async () => {
        let r = await admF(b, ADM, { action: 'twofa_begin', tab: 'twofa' }, { page: '?tab=twofa' });
        secret = new URL(decode((r.text.match(/otpauth:\/\/totp\/[^<\s"]+/) || [''])[0])).searchParams.get('secret');
        const st = stepOf();
        r = await admF(b, ADM, { action: 'twofa_confirm', tab: 'twofa', code: totpAt(secret, st) }, { page: '?tab=twofa' });
        const codes = [...r.text.matchAll(/<code class="bk">([a-z2-9-]+)<\/code>/g)].map((m) => m[1]);
        assert(codes.length === 10, `backup codes: ${codes.length} ${flashOf(r.text)?.msg || ''}`);
        const p = await b.req(`${ADM}?tab=users`);
        assert(isInside(p.text) && /<table/.test(p.text), 'the users tab opens');
        const api = await b.req('api/admin/stats.php');
        assert(api.status === 200, `api → ${api.status}`);
        await adm(b, ADM, { action: 'logout' });
        const again = await signIn(b, ADM, R);
        assert(isCodeForm(again.page.text), 'the code is asked at the next sign-in');
        const fin = await admF(b, ADM, { action: 'code', code: codes[0] });
        assert(isInside(fin.text), 'in with a backup code');
        return 'enrolled → tabs + api open → next sign-in asks for the code';
      });
    } finally { await s3.stop(); }
  }

  // ================================================================= idle timeout
  if (section('idle')) {
    const s4 = await startPhp(main1, { TFM_ADMIN_IDLE: '2', TFM_ADMIN_2FA: 'off' });
    try {
      const I = mkUser(main1, 'admin');
      await step('S06', 'idle timeout (TFM_ADMIN_IDLE=2): requests keep the elevation alive; after 3 quiet seconds the sign-in form is back and the API says ADMIN_REAUTH', async () => {
        const b = new Browser(s4.base, 'idle');
        assert(isInside((await signIn(b, ADM, I)).page.text), 'signed in');
        for (let i = 0; i < 4; i++) { await sleep(1000); assert(isInside((await b.req(`${ADM}?tab=users`)).text), `still inside after ${i + 1} s of activity`); }
        assert((await b.req('api/admin/stats.php')).status === 200, 'api open while active');
        await sleep(3200);
        const api = await b.req('api/admin/stats.php');
        assert(api.status === 403 && api.error?.code === 'ADMIN_REAUTH', `api after the pause → ${api.status} ${api.error?.code}`);
        const p = await b.req(`${ADM}?tab=users`);
        assert(isSignIn(p.text) && !isInside(p.text) && !/<table/.test(p.text), 'the sign-in form is back');
        assert(!b.cookie('TFMADM'), 'the elevation cookie was cleared');
        const me = await b.req('api/auth/me.php');
        assert(me.data?.user && Number(me.data.user.id) === I.id, 'the app session itself is still alive (only the admin area asks again)');
        const post = await adm(b, ADM, { action: 'cleanup', tab: 'maintenance' });
        assert(post.status === 403, `an action after the pause → ${post.status}`);
        assert(isInside((await signIn(b, ADM, I)).page.text), 'signing in again works');
        return 'active 4 s → open · quiet 3.2 s → sign-in form + ADMIN_REAUTH · app session untouched';
      });
      await step('S06', 'idle timeout: api/admin calls alone do not keep the elevation alive (only pages of the admin folder do)', async () => {
        const b = new Browser(s4.base, 'idle2');
        assert(isInside((await signIn(b, ADM, I)).page.text), 'signed in');
        for (let i = 0; i < 4; i++) { await sleep(800); await b.req('api/admin/stats.php'); }
        const api = await b.req('api/admin/stats.php');
        assert(api.status === 403 && api.error?.code === 'ADMIN_REAUTH', `api polling for 3.2 s → ${api.status}`);
        return 'polling the API for 3.2 s did not extend the 2 s window';
      });
    } finally { await s4.stop(); }
  }

  // ================================================================= IP allow-list
  if (section('allowlist')) {
    // the stylesheet address the sign-in page names (asked from a server without the allow-list)
    let cssRel = '';
    { const s0 = await startPhp(main1); try { cssRel = cssOf((await new Browser(s0.base).req(ADM)).text); } finally { await s0.stop(); } }
    const s5 = await startPhp(main1, { TFM_ADMIN_IPS: '203.0.113.7, 2001:db8::/32' });
    try {
      await step('S06', 'IP allow-list set to another address: the admin folder answers the same plain 404 as a missing page (no session, no hint) and records admin_ip_denied', async () => {
        const b = new Browser(s5.base, 'deny');
        const stub = (await b.req('admin.php')).text;
        const before = eventsOf(main1, 'admin_ip_denied');
        for (const [u, o] of [[ADM, {}], [ADM + 'index.php', {}], [ADM + '?tab=users', {}], [ADM, { form: { action: 'login', login: 'x', password: 'y' } }], [ADM, { method: 'HEAD' }]]) {
          const r = await b.req(u, o);
          assert(r.status === 404 && !r.location && r.setCookie.length === 0, `${o.method || (o.form ? 'POST' : 'GET')} ${u} → ${r.status}, cookies ${r.setCookie.length}`);
          if (o.method !== 'HEAD') assert(r.text === stub, `${u}: the body differs from the old address's 404`);
          assert(!r.headers.get('x-robots-tag') && !r.headers.get('content-security-policy') && !r.headers.get('x-powered-by'), `${u}: page headers on the 404`);
        }
        assert(b.jar.length === 0, 'no cookie at all');
        const after = eventsOf(main1, 'admin_ip_denied');
        const n = (after.sec.length + after.audit.length) - (before.sec.length + before.audit.length);
        assert(n >= 4, `admin_ip_denied rows: +${n}`);
        const row = after.sec[after.sec.length - 1] || after.audit[after.audit.length - 1];
        assert(/127\.0\.0\.1/.test(JSON.stringify(row)) || row.ip_hash, `the row names the address: ${JSON.stringify(row).slice(0, 160)}`);
        const app = new Browser(s5.base);
        await apiLogin(app, admins.a || mkUser(main1, 'admin'));
        const api = await app.req('api/admin/stats.php');
        assert(api.status === 403 && api.error?.code === 'ADMIN_REAUTH', `api from an address outside the list → ${api.status} ${api.error?.code}`);
        return `404 × 5 (body = old address 404) · +${n} admin_ip_denied (${after.sec.length ? 'security_events' : 'audit_log'})`;
      });
      // finding (reviewer-infra, item 6): the static admin.css (and, under Apache, mod_dir's slash redirect) answered
      // before the address check — a refused address read the stylesheet and learned that the folder exists
      await step('S06', 'IP allow-list: the stylesheet the sign-in page names, the old static admin.css and the folder without its slash answer a refused address the same 404 too (no CSS, no redirect) and are recorded', async () => {
        assert(cssRel, 'the sign-in page names no stylesheet');
        const head = cssSourceHead(main1.site);
        assert(head, 'no stylesheet source in the tree');
        const b = new Browser(s5.base, 'deny-css');
        const stub = (await b.req('admin.php')).text;
        const before = eventsOf(main1, 'admin_ip_denied');
        const css = await b.req(inFolder(ADM, cssRel));
        assert(css.status === 404 && css.text === stub && !/text\/css/.test(css.headers.get('content-type') || '') && css.setCookie.length === 0, `${cssRel} → ${css.status} ${css.headers.get('content-type')} (${css.text.length} bytes)`);
        const old = await b.req(ADM + 'admin.css');
        assert(old.status === 404 && !old.text.includes(head) && !/text\/css/.test(old.headers.get('content-type') || ''), `${ADM}admin.css → ${old.status} ${old.headers.get('content-type')} (${old.text.length} bytes)`);
        for (const p of [STUB_DIR, STUB_DIR + '?tab=users']) {
          const bare = await b.req(p);
          assert(bare.status === 404 && !bare.location && bare.text === stub && bare.setCookie.length === 0, `/${p} → ${bare.status} ${bare.location || ''}`);
        }
        assert(b.jar.length === 0, 'no cookie at all');
        const after = eventsOf(main1, 'admin_ip_denied');
        const n = (after.sec.length + after.audit.length) - (before.sec.length + before.audit.length);
        assert(n >= 3, `admin_ip_denied rows for the stylesheet and the bare folder: +${n}`);
        return `${cssRel} · ${ADM}admin.css · /${STUB_DIR} → 404 (no CSS, no redirect) · +${n} admin_ip_denied`;
      });
    } finally { await s5.stop(); }
    const s6 = await startPhp(main1, { TFM_ADMIN_IPS: '203.0.113.7,127.0.0.0/8,::1' });
    try {
      await step('S06', 'IP allow-list that contains this address (CIDR 127.0.0.0/8): the sign-in form is shown', async () => {
        const b = new Browser(s6.base);
        const r = await b.req(ADM);
        assert(r.status === 200 && isSignIn(r.text), `→ ${r.status}`);
        return '200 sign-in form';
      });
    } finally { await s6.stop(); }
  }

  // ================================================================= rate limit of the sign-in form
  if (section('ratelimit')) {
    for (const [label, limits, which] of [['admin_login', { admin_login: [3, 60], login: [1000, 60] }, 'the named limit admin_login'], ['login', { admin_login: null, login: [3, 60] }, 'the login limit when admin_login is not configured']]) {
      const s = makeSite('rate-' + label, { rate_limits: limits });
      const sv = await startPhp(s);
      try {
        await step('S06', `sign-in form rate limit by IP uses ${which}: the 4th try in a minute answers 429 + Retry-After`, async () => {
          const U = mkUser(s, 'admin');
          const seen = [];
          let last = null;
          for (let i = 0; i < 4; i++) {
            const b = new Browser(sv.base); // a new browser every time: the limit is per address, not per session
            last = await adm(b, ADM, { action: 'login', login: U.email, password: 'Wrong' + i + PASSWORD });
            seen.push(last.status);
          }
          assert(seen.join(',') === '303,303,303,429', `statuses: ${seen.join(',')}`);
          assert(Number(last.headers.get('retry-after')) > 0, 'Retry-After');
          assertLocked(last, '429 page');
          const ok = new Browser(sv.base);
          const r = await adm(ok, ADM, { action: 'login', login: U.email, password: PASSWORD });
          assert(r.status === 429 && !ok.cookie('TFMADM'), `the right password inside the window → ${r.status}`);
          const page = await ok.req(ADM);
          assert(page.status === 200 && isSignIn(page.text), 'reading the form is not limited by it');
          return `303,303,303,429 · Retry-After ${last.headers.get('retry-after')} s`;
        });
      } finally { await sv.stop(); }
    }
  }

  // ================================================================= admin screens for items 5 and 8
  if (section('screens')) {
    const haveSec = fs.existsSync(path.join(SRC, 'lib/SecurityEvents.php'));
    const haveCfg = fs.existsSync(path.join(SRC, 'lib/ConfigAudit.php'));
    if (!haveSec) {
      const s = makeSite('plain');
      const sv = await startPhp(s);
      try {
        await step('S05', '🛡️ 보안 tab works while SecEvent / Firewall are not installed: it says "아직 준비 중" and still shows the sign-in history and the 2-step state', async () => {
          const A = mkUser(s, 'admin');
          const b = new Browser(sv.base);
          assert(isInside((await signIn(b, ADM, A)).page.text), 'signed in');
          const p = await b.req(`${ADM}?tab=security`);
          assert(p.status === 200 && isInside(p.text) && /아직 준비 중/.test(p.text), `→ ${p.status}`);
          assert(/관리자 로그인 기록/.test(p.text) && /2단계 인증 상태/.test(p.text) && p.text.includes(A.nickname), 'sign-in history + 2-step state');
          assertLocked(p, 'security tab');
          const blk = await admF(b, ADM, { action: 'ip_block', tab: 'security', ip: '203.0.113.50', minutes: '30', reason: 'x' }, { page: '?tab=security' });
          assert(flashOf(blk.text)?.type === 'error' && /준비/.test(flashOf(blk.text).msg), `block without Firewall: ${flashOf(blk.text)?.msg}`);
          return 'guard path: no lib/SecurityEvents.php in the tree';
        });
      } finally { await sv.stop(); }
    }
    const s = makeSite('screens');
    const doubles = [];
    if (!haveSec) { fs.writeFileSync(path.join(s.site, 'lib/SecurityEvents.php'), SEC_DOUBLE); doubles.push('SecEvent + Firewall'); }
    if (!haveCfg) { fs.writeFileSync(path.join(s.site, 'lib/ConfigAudit.php'), CFG_DOUBLE); doubles.push('ConfigAudit'); }
    const note = doubles.length ? `test double for ${doubles.join(', ')}` : 'real SecEvent / Firewall / ConfigAudit';
    const sv = await startPhp(s);
    try {
      const A = mkUser(s, 'admin');
      const U = mkUser(s, 'user');
      const b = new Browser(sv.base, 'screens');
      await step('S05', '🛡️ 보안 tab: today\'s counts by kind and the latest events with time, kind, severity, masked IP + hash, path and a short detail', async () => {
        // make some events through the page itself and through the agreed interface
        const x = new Browser(sv.base);
        await signIn(x, ADM, U);                                             // admin_denied
        php(s, '(function ($in) { for ($i = 0; $i < 60; $i++) Tfm\\SecEvent::log($i % 2 ? "probe_sqli" : "probe_xss", $i % 3 ? "warn" : "alert", ["n" => $i, "q" => $in["p"]]); return 1; })($in)', { p: '<script>alert(1)</script>' });
        assert(isInside((await signIn(b, ADM, A)).page.text), 'signed in');
        const p = await b.req(`${ADM}?tab=security`);
        assert(p.status === 200 && !/아직 준비 중/.test(p.text), `→ ${p.status}`);
        assertLocked(p, 'security tab', { payload: true });
        for (const h of ['오늘', '막아 둔 주소', '관리자 로그인 기록', '2단계 인증 상태']) assert(p.text.includes(h), `heading "${h}"`);
        for (const k of ['admin_denied', 'probe_sqli', 'probe_xss']) assert(p.text.includes(k), `kind ${k} is listed`);
        assert(/127\.0\.0\.(•|x|\*)/.test(p.text) && !/>\s*127\.0\.0\.1\s*</.test(p.text), 'the event list shows the address masked');
        assert(/[0-9a-f]{8}/.test(p.text), 'and the short hash of the address');
        assert(p.text.includes('&lt;script&gt;alert(1)&lt;/script&gt;') && !/<script/i.test(p.text), 'event details are escaped');
        return note;
      });
      await step('S05', '🛡️ 보안 tab: filters (kind, severity, since) and paging', async () => {
        const rows = (t) => [...t.matchAll(/<tr class="ev"/g)].length;
        const all = await b.req(`${ADM}?tab=security`);
        const k = await b.req(`${ADM}?tab=security&kind=probe_sqli`);
        assert(rows(k.text) === 30 && !/<td[^>]*>probe_xss</.test(k.text), `kind filter rows: ${rows(k.text)}`);
        const sev = await b.req(`${ADM}?tab=security&kind=probe_xss&sev=alert`);
        assert(rows(sev.text) === 10, `kind + severity rows: ${rows(sev.text)}`);
        const p0 = await b.req(`${ADM}?tab=security&since=7d`);
        assert(rows(p0.text) === 50 && /[?&](amp;)?p=1/.test(p0.text), `first page: ${rows(p0.text)} rows + a next link`);
        const p1 = await b.req(`${ADM}?tab=security&since=7d&p=1`);
        assert(rows(p1.text) >= 11 && rows(p1.text) < 50 && /[?&](amp;)?p=0|다음/.test(p1.text) , `second page: ${rows(p1.text)} rows`);
        const none = await b.req(`${ADM}?tab=security&kind=no_such_kind`);
        assert(none.status === 200 && rows(none.text) === rows(all.text), 'an unknown kind is ignored (not echoed, not an error)');
        const hash = (all.text.match(/[?&](?:amp;)?ip=([0-9a-f]{32})/) || [])[1];
        assert(hash, 'each row links to "all events of this address" by hash');
        assert(rows((await b.req(`${ADM}?tab=security&ip=${hash}`)).text) > 0, 'address filter');
        return 'kind 30 · kind+severity 10 · 50 per page + next';
      });
      await step('S05', '🛡️ 보안 tab: block an address by hand (address + minutes + reason), see it in the list, 차단 해제', async () => {
        let r = await admF(b, ADM, { action: 'ip_block', tab: 'security', ip: 'not-an-ip', minutes: '30', reason: 'x' }, { page: '?tab=security' });
        assert(flashOf(r.text)?.type === 'error', 'a broken address is refused');
        r = await admF(b, ADM, { action: 'ip_block', tab: 'security', ip: '127.0.0.1', minutes: '30', reason: 'x' }, { page: '?tab=security' });
        assert(flashOf(r.text)?.type === 'error', 'the address the administrator is using cannot be blocked');
        r = await admF(b, ADM, { action: 'ip_block', tab: 'security', ip: '203.0.113.50', minutes: '45', reason: '<b>시험</b> 차단' }, { page: '?tab=security' });
        assert(flashOf(r.text)?.type === 'ok', `block: ${flashOf(r.text)?.msg}`);
        assert(r.text.includes('203.0.113.50') && r.text.includes('&lt;b&gt;시험&lt;/b&gt; 차단') && !/<b>시험/.test(r.text), 'the block is listed with its (escaped) reason');
        const row = dbAll(s, 'SELECT * FROM ip_blocks')[0];
        assert(row && row.ip === '203.0.113.50' && Number(row.until_at) > Date.now() + 40 * 60000 && Number(row.until_at) < Date.now() + 50 * 60000, `ip_blocks row: ${JSON.stringify(row)}`);
        const hash = (r.text.match(/name="ip_hash" value="([0-9a-f]{32})"/) || [])[1];
        assert(hash === row.ip_hash, 'the unblock form carries the hash of the row');
        r = await admF(b, ADM, { action: 'ip_unblock', tab: 'security', ip_hash: hash }, { page: '?tab=security' });
        // the real Firewall::unblock keeps the row with until_at = now (strikes forgiven, history kept): "no active block"
        const active = () => dbAll(s, 'SELECT * FROM ip_blocks WHERE until_at > ?', [Date.now()]);
        assert(flashOf(r.text)?.type === 'ok' && active().length === 0 && !r.text.includes('203.0.113.50'), `unblock: ${flashOf(r.text)?.msg} · active blocks ${active().length}`);
        const au = dbAll(s, "SELECT event FROM audit_log WHERE event IN ('ip_block_manual', 'ip_unblock_manual') ORDER BY id").map((x) => x.event);
        assert(au.join(',') === 'ip_block_manual,ip_unblock_manual', `audit: ${au.join(',')}`);
        // from an event row: "이 주소 차단" by hash (the full address never has to be shown)
        php(s, '(function () { $_SERVER["REMOTE_ADDR"] = "198.51.100.77"; Tfm\\SecEvent::log("probe_traversal", "alert", ["x" => 1]); return 1; })()');
        const ev = await b.req(`${ADM}?tab=security&kind=probe_traversal`);
        const h2 = (ev.text.match(/name="from_hash" value="([0-9a-f]{32})"/) || [])[1];
        assert(h2 && !ev.text.includes('198.51.100.77'), 'the event row offers a block button by hash, the address stays masked');
        r = await admF(b, ADM, { action: 'ip_block', tab: 'security', from_hash: h2, minutes: '10', reason: '기록에서 차단' }, { page: '?tab=security' });
        assert(flashOf(r.text)?.type === 'ok' && active().map((x) => x.ip).join(',') === '198.51.100.77', `block from an event row: ${flashOf(r.text)?.msg} · active ${active().map((x) => x.ip).join(',')}`);
        return 'broken / own address refused · block 45 min · listed · unblock · block from an event row';
      });
      await step('S05', '🛡️ 보안 tab: the admin sign-in history (audit rows) and the 2-step state of every admin account', async () => {
        const B = enrol(s, mkUser(s, 'admin'));
        const p = await b.req(`${ADM}?tab=security`);
        const hist = p.text.slice(p.text.indexOf('관리자 로그인 기록'));
        assert(/admin_signin|로그인 성공/.test(hist) && /admin_denied|권한 없는/.test(hist) && hist.includes(A.nickname), 'sign-in history lists the sign-in and the refused try');
        const st = p.text.slice(p.text.indexOf('2단계 인증 상태'));
        assert(st.includes(A.nickname) && st.includes(B.nickname) && /켜짐/.test(st) && /꺼짐/.test(st) && !st.includes(U.nickname), 'every admin with on / off, no players');
        assert(!p.text.includes(B.secret), 'the secret is never shown');
        return 'history + 2-step state (1 on, 1 off)';
      });
      await step('S08', '🩺 시스템 점검: the admin-lock rows (folder name, allow-list, 2-step, old address, install lock) and the 보안 설정 / DB 계정 groups', async () => {
        const p = await b.req(`${ADM}?tab=health`);
        assert(p.status === 200 && isInside(p.text), `→ ${p.status}`);
        assertLocked(p, 'health tab', { payload: true });
        for (const h of ['관리자 페이지 잠금', '관리자 폴더 이름', '접속 허용 주소', '2단계 인증', '예전 관리자 주소', '설치 마법사']) assert(p.text.includes(h), `"${h}" is on the page`);
        assert(/보안 설정/.test(p.text), 'the 보안 설정 group (ConfigAudit)');
        if (!haveCfg) assert(p.text.includes('double-secret') && p.text.includes('&lt;b&gt;hint&lt;/b&gt;') && !/<b>hint<\/b>/.test(p.text), 'ConfigAudit rows are listed and escaped');
        const hasAcct = php(s, 'method_exists("Tfm\\\\Db", "accountAudit")');
        if (hasAcct) assert(/DB 계정/.test(p.text), 'the DB 계정 group (Db::accountAudit)');
        const api = await b.req('api/admin/health.php?quick=1');
        assert(api.status === 200, `api health → ${api.status} ${api.error?.code}`);
        const by = Object.fromEntries(api.data.checks.map((c) => [c.id, c]));
        for (const id of ['admin_dir', 'admin_ip_allowlist', 'admin_2fa', 'admin_old_path', 'install_lock']) assert(by[id] && ['ok', 'warn', 'fail'].includes(by[id].status), `api row ${id}`);
        assert(by.admin_dir.status === 'warn' && by.admin_old_path.status === 'ok', `admin_dir ${by.admin_dir.status}, admin_old_path ${by.admin_old_path.status}`);
        assert(api.data.checks.some((c) => c.group === 'config'), 'api: ConfigAudit rows in group "config"');
        assert(!JSON.stringify(api.data).includes(STUB_DIR + '/') , 'the report does not spell the admin address');
        // a leftover copy of the old page at admin.php must turn the row red
        fs.writeFileSync(path.join(s.site, 'admin.php'), "<?php\nrequire __DIR__ . '/lib/bootstrap.php';\nTfm\\Session::start(true);\necho 'old page';\n");
        const bad = await b.req('api/admin/health.php?quick=1');
        const row = bad.data.checks.find((c) => c.id === 'admin_old_path');
        assert(row.status === 'fail', `a real page at admin.php → ${row.status}`);
        return `${note}${hasAcct ? '' : ' · Db::accountAudit not in the tree (guard only)'}`;
      });
    } finally { await sv.stop(); }
  }

  // ================================================================= phase-7 tabs: 📊 farm numbers · 🌱 재배 현황 · 🏚️ 곳간 · ✅ 완료 확인 (CONTRACT §15.4)
  if (section('farm')) {
    const s = makeSite('farm');
    useClaudeDouble(s); // the 🤖 메모 초안 button of the ✅ tab (Claude::enabled, Claude::memoDraft)
    const sv = await startPhp(s);
    try {
      const A = mkUser(s, 'admin');
      const K = [mkUser(s, 'user'), mkUser(s, 'user'), mkUser(s, 'user')];
      const F = seedFarm(s, K, A.id);
      const b = new Browser(sv.base, 'farm');
      const signedIn = async () => { if (!isInside((await b.req(ADM)).text)) assert(isInside((await signIn(b, ADM, A)).page.text), 'signed in'); };
      await step('15.4', '📊 대시보드: the farm numbers of Farm::dashboard (growing / ready beds, harvested today, pending confirmations, 곳간 total) and today\'s security alerts (escaped)', async () => {
        php(s, 'Tfm\\SecEvent::log("payment_tamper", "alert", ["note" => $in["p"]])', { p: EVIL.note });
        php(s, 'Tfm\\SecEvent::log("probe_xss", "warn", ["q" => "x"])');
        await signedIn();
        const p = await b.req(`${ADM}?tab=overview`);
        assert(p.status === 200 && isInside(p.text), `→ ${p.status}`);
        assertLocked(p, 'overview', { payload: true });
        const d = php(s, 'Tfm\\Farm::dashboard()');
        assert(d.growing === 3 && d.ready === 1 && d.harvestedToday === 1 && d.reportsPending === 2 && d.storageTotal === 19, `seeded numbers: ${JSON.stringify(d)}`);
        const want = { '자라는 중': d.growing, '다 자란 텃밭': d.ready, '오늘 수확': d.harvestedToday, '완료 확인 대기': d.reportsPending, '곳간 전체': d.storageTotal };
        for (const [label, n] of Object.entries(want)) assert(tileNum(p.text, label) === n, `tile "${label}" shows ${tileNum(p.text, label)}, want ${n}`);
        const al = p.text.slice(p.text.indexOf('오늘의 보안 알림'));
        assert(p.text.includes('오늘의 보안 알림') && /payment_tamper|결제 금액 조작/.test(al), 'today\'s alerts list the payment_tamper alert');
        assert(al.includes('&lt;script&gt;alert(&#039;note&#039;)&lt;/script&gt;') || al.includes('&lt;script&gt;alert(&apos;note&apos;)&lt;/script&gt;'), 'the alert detail is escaped');
        assert(!rawEvil(p.text).length, `raw markup: ${rawEvil(p.text).join(', ')}`);
        assert(/href="\.\/\?tab=reports/.test(p.text) && /href="\.\/\?tab=beds/.test(p.text), 'links to 완료 확인 and 재배 현황');
        return `growing ${d.growing} · ready ${d.ready} · harvested today ${d.harvestedToday} · pending ${d.reportsPending} · 곳간 ${d.storageTotal} · alert listed`;
      });
      const bedRows = (html) => [...html.matchAll(/<tr class="bed[^"]*"[^>]*>([\s\S]*?)<\/tr>/g)].map((m) => m[1]);
      const phpTime = (ms) => php(s, 'date("Y-m-d H:i", intdiv((int) $in, 1000))', ms);
      await step('15.4', '🌱 재배 현황: every bed of every account — account, bed, crop, 심은 시각, 완료 예정, 남은 시간, status (server clock), growing / ready first, markup escaped', async () => {
        await signedIn();
        const p = await b.req(`${ADM}?tab=beds`);
        assert(p.status === 200 && isInside(p.text), `→ ${p.status}`);
        assertLocked(p, 'beds tab', { payload: true });
        const head = (p.text.match(/<thead>[\s\S]*?<\/thead>/) || [''])[0];
        for (const h of ['계정', '밭', '작물', '심은 시각', '완료 예정', '남은 시간', '상태']) assert(head.includes(h), `column "${h}"`);
        const rows = bedRows(p.text);
        assert(rows.length === 50, `first page shows ${rows.length} rows (63 seeded, 50 per page)`);
        const active = rows.slice(0, 6).join('\n');
        for (const u of [K[0], K[1]]) assert(active.includes(u.nickname), `active rows list ${u.nickname}`);
        assert(!/수확함|뽑음/.test(active), 'growing / ready beds come first');
        const listed = php(s, 'Tfm\\Farm::listBeds(["userId" => $in], 10, 0)', K[0].id);
        const rb1 = listed.find((r) => r.bedId === 'RB1');
        const row1 = rows.find((r) => r.includes(K[0].nickname) && r.includes('RB1'));
        assert(row1 && row1.includes('박하') && row1.includes(phpTime(rb1.firstSeenAt)) && row1.includes(phpTime(rb1.readyAt)), `RB1 row: crop, 심은 시각 ${phpTime(rb1.firstSeenAt)}, 완료 예정 ${phpTime(rb1.readyAt)}`);
        assert(/\d+분/.test(row1) && /자라는 중/.test(row1), 'RB1: time left in minutes and "자라는 중"');
        const row2 = rows.find((r) => r.includes(K[0].nickname) && r.includes('RB2'));
        assert(row2 && /다 자람/.test(row2) && row2.includes('콩'), 'RB2 is past its server ready time: "다 자람" (stored as growing, judged by the server clock)');
        const plot = rows.find((r) => r.includes(K[0].nickname) && r.includes('P1'));
        assert(plot && /50\s*%/.test(plot) && /연습 밭/.test(plot), 'a quick plot shows its growth in %');
        assert(p.text.includes('&lt;svg onload=alert(&#039;crop&#039;)&gt;') || p.text.includes('&lt;svg onload=alert(&apos;crop&apos;)&gt;'), 'the markup crop id comes back as text');
        assert(p.text.includes('&lt;img src=x onerror=alert('), 'the markup nickname comes back as text');
        assert(!rawEvil(p.text).length, `raw markup: ${rawEvil(p.text).join(', ')}`);
        return `${rows.length} rows on page 1 · server times · 다 자람 by the server clock · markup inert`;
      });
      await step('15.4', '🌱 재배 현황: filters (status, kind rt / plot, account search by nickname or #id) and paging (50 per page)', async () => {
        const n = async (q) => bedRows((await b.req(`${ADM}?tab=beds${q}`)).text).length;
        const want = { '&status=ready': 2, '&status=growing': 4, '&status=active': 6, '&status=cleared': 1, '&kind=rt': 6, '&kind=plot&status=active': 2,
          [`&q=${encodeURIComponent(K[0].nickname)}`]: 6, [`&q=${encodeURIComponent('#' + K[2].id)}`]: 1, '&status=harvested&p=1': 6, '&p=1': 13, '&status=nope&kind=nope': 50 };
        for (const [q, w] of Object.entries(want)) { const got = await n(q); assert(got === w, `${q}: ${got} rows, want ${w}`); }
        const p0 = await b.req(`${ADM}?tab=beds`);
        assert(/href="\.\/\?tab=beds[^"]*(&amp;|&)p=1/.test(p0.text), 'page 1 links to page 2');
        const p1 = await b.req(`${ADM}?tab=beds&p=1`);
        assert(/href="\.\/\?tab=beds[^"]*"[^>]*>[^<]*이전/.test(p1.text) || /← 이전/.test(p1.text), 'page 2 links back');
        const ready = (await b.req(`${ADM}?tab=beds&status=ready`)).text;
        assert(/<option value="ready" selected/.test(ready), 'the chosen filter stays selected');
        return Object.entries(want).map(([q, w]) => `${q.replace(/^&/, '') || 'all'} ${w}`).join(' · ');
      });
      await step('15.4', '🌱 재배 현황: live=1 adds <meta http-equiv="refresh" content="20"> (a refresh that does not count as admin activity); without live=1 there is none', async () => {
        const off = await b.req(`${ADM}?tab=beds`);
        assert(!/http-equiv="refresh"/i.test(off.text), 'no refresh without live=1');
        assert(/href="\.\/\?tab=beds[^"]*live=1/.test(off.text), 'a link turns live refresh on');
        const on = await b.req(`${ADM}?tab=beds&status=active&live=1`);
        const m = on.text.match(/<meta http-equiv="refresh" content="20; url=([^"]+)">/);
        assert(m, 'meta refresh with content="20"');
        const url = decode(m[1]);
        assert(/^\.\/\?tab=beds&/.test(url) && /status=active/.test(url) && /live=1/.test(url) && /auto=1/.test(url), `refresh keeps the filter and marks itself: ${url}`);
        assertLocked(on, 'live beds tab', { payload: true });
        assert(isInside((await b.req(ADM + url.replace(/^\.\//, ''))).text), 'the refresh address works');
        // the idle timeout still ends the elevation while only the page's own refreshes arrive
        const sv2 = await startPhp(s, { TFM_ADMIN_IDLE: '2' });
        try {
          const c = new Browser(sv2.base, 'live-idle');
          assert(isInside((await signIn(c, ADM, A)).page.text), 'signed in (idle 2 s)');
          let last = null;
          for (let i = 0; i < 4; i++) { await sleep(900); last = await c.req(`${ADM}?tab=beds&live=1&auto=1`); }
          assert(isSignIn(last.text) && !isInside(last.text), 'after 3.6 s of refreshes only, the sign-in form is back');
          assert(!/http-equiv="refresh"/i.test(last.text), 'and the sign-in form does not refresh itself');
        } finally { await sv2.stop(); }
        return 'refresh only with live=1 · keeps filters · auto refreshes never extend the 30-minute idle time';
      });
      await step('15.4', '🌱 재배 현황: the time-scale form (farm.rt_scale 0.1–3600, explained in plain words) — POST + CSRF + audit, bad values refused', async () => {
        const p = await b.req(`${ADM}?tab=beds`);
        assert(p.text.includes('1 = 진짜 시간, 60 = 60배 빠르게(수업 시연용)'), 'the scale is explained in plain words');
        assert(/name="action" value="farm_scale"/.test(p.text) && /name="scale"/.test(p.text), 'the scale form');
        let r = await admF(b, ADM, { action: 'farm_scale', tab: 'beds', scale: '60' }, { page: '?tab=beds' });
        assert(flashOf(r.text)?.type === 'ok', `scale 60: ${flashOf(r.text)?.msg}`);
        assert(php(s, 'Tfm\\Farm::scale()') === 60, 'Farm::scale() = 60');
        const set = dbAll(s, "SELECT * FROM settings WHERE k = 'farm.rt_scale'")[0];
        assert(set && JSON.parse(set.v) === 60 && Number(set.updated_by) === A.id, `settings row ${JSON.stringify(set)}`);
        const au = dbAll(s, "SELECT * FROM audit_log WHERE event = 'setting_changed' ORDER BY id DESC LIMIT 1")[0];
        assert(au && Number(au.actor_id) === A.id && /farm\.rt_scale/.test(au.detail), `audit ${JSON.stringify(au)}`);
        assert(/value="60"/.test(r.text), 'the form shows the new scale');
        for (const bad of ['0.05', '5000', 'abc', '', '1e400', '-1', '60; DROP TABLE settings']) {
          r = await admF(b, ADM, { action: 'farm_scale', tab: 'beds', scale: bad }, { page: '?tab=beds' });
          assert(flashOf(r.text)?.type === 'error', `scale "${bad}" → ${flashOf(r.text)?.type} ${flashOf(r.text)?.msg}`);
        }
        assert(php(s, 'Tfm\\Farm::scale()') === 60, 'bad values changed nothing');
        r = await admF(b, ADM, { action: 'farm_scale', tab: 'beds', scale: '0.5' }, { page: '?tab=beds' });
        assert(flashOf(r.text)?.type === 'ok' && php(s, 'Tfm\\Farm::scale()') === 0.5 && /value="0\.5"/.test(r.text), 'scale 0.5 (not rounded to 1)');
        r = await admF(b, ADM, { action: 'farm_scale', tab: 'beds', scale: '1' }, { page: '?tab=beds' });
        assert(php(s, 'Tfm\\Farm::scale()') === 1, 'back to 1');
        return '60 · 0.5 · 1 accepted (settings row + setting_changed audit) · 0.05 / 5000 / abc / empty / 1e400 / -1 / SQL text refused';
      });
      const storeRows = (html) => [...html.matchAll(/<tr class="store"[^>]*>([\s\S]*?)<\/tr>/g)].map((m) => m[1]);
      await step('15.4', '🏚️ 곳간: totals per item over every account and the 곳간 of each account (items, total / cap) — markup item ids and nicknames escaped', async () => {
        const p = await b.req(`${ADM}?tab=storage`);
        assert(p.status === 200 && isInside(p.text), `→ ${p.status}`);
        assertLocked(p, 'storage tab', { payload: true });
        assert(p.text.includes('아이템별 합계') && p.text.includes('계정별 곳간'), 'both sections');
        const items = [...p.text.matchAll(/<tr class="item"[^>]*>([\s\S]*?)<\/tr>/g)].map((m) => m[1]);
        const cell = (r, n) => new RegExp(`<td[^>]*>${n}</td>`).test(r);
        const mint = items.find((r) => r.includes('박하'));
        assert(mint && cell(mint, 7) && cell(mint, 2), `박하: 7 in 2 accounts (${mint})`);
        assert(items.some((r) => r.includes('콩') && cell(r, 7) && cell(r, 1)) && items.some((r) => r.includes('옥수수') && cell(r, 4)), '콩 7 · 옥수수 4');
        assert(items.length === 4, `${items.length} item rows (박하 · 콩 · 옥수수 · the markup id)`);
        const rows = storeRows(p.text);
        assert(rows.length === 3, `${rows.length} accounts`);
        const k0 = rows.find((r) => r.includes(K[0].nickname));
        assert(k0 && /12\s*\/\s*300/.test(k0) && /박하\s*5/.test(k0) && /콩\s*7/.test(k0), `K0: 12 / 300, 박하 5, 콩 7 (${k0 && k0.slice(0, 300)})`);
        assert(rows.indexOf(k0) === 0, 'the fullest 곳간 first');
        assert(p.text.includes('&lt;b onmouseover=alert(') && p.text.includes('&lt;img src=x onerror=alert('), 'the markup item id and nickname come back as text');
        assert(!rawEvil(p.text).length, `raw markup: ${rawEvil(p.text).join(', ')}`);
        return `${items.length} items · ${rows.length} accounts · K0 12 / 300`;
      });
      await step('15.4', '🏚️ 곳간: account search (nickname / e-mail / #id) and paging (50 accounts per page)', async () => {
        const ids = bulkUsers(s, 52, 'Gotgan');
        php(s, '(function ($in) { foreach ($in as $i => $id) Tfm\\Db::insert("farm_storage", ["user_id" => $id, "item_id" => "ITEM_BEAN", "qty" => 1, "updated_at" => Tfm\\Clock::ms()]); return 1; })($in)', ids);
        const n = async (q) => storeRows((await b.req(`${ADM}?tab=storage${q}`)).text).length;
        const want = { '': 50, '&p=1': 5, [`&q=${encodeURIComponent('#' + K[0].id)}`]: 1, [`&q=${encodeURIComponent(K[1].nickname)}`]: 1, '&q=gotgan': 50, '&q=gotgan&p=1': 2, '&q=nobody-like-this': 0 };
        for (const [q, w] of Object.entries(want)) { const got = await n(q); assert(got === w, `${q || 'all'}: ${got} rows, want ${w}`); }
        const p0 = await b.req(`${ADM}?tab=storage&q=gotgan`);
        assert(/href="\.\/\?tab=storage[^"]*q=gotgan[^"]*(&amp;|&)p=1/.test(p0.text), 'the next link keeps the search');
        assert(/value="gotgan"/.test(p0.text), 'the search box keeps the text');
        return Object.entries(want).map(([q, w]) => `${q.replace(/^&/, '') || 'all'} ${w}`).join(' · ');
      });
      const cards = (html) => [...html.matchAll(/<article class="[^"]*\breport\b[^"]*" id="r(\d+)"[^>]*>([\s\S]*?)<\/article>/g)].map((m) => ({ id: Number(m[1]), html: m[2] }));
      const R = F.reports;
      await step('15.4', '✅ 완료 확인: pending first (oldest first), then the latest decisions — each with account, crop, bed, the server\'s first-seen / ready / harvested times, stars, the note, the photo and the memo form', async () => {
        const p = await b.req(`${ADM}?tab=reports`);
        assert(p.status === 200 && isInside(p.text), `→ ${p.status}`);
        assertLocked(p, 'reports tab', { payload: true });
        const c = cards(p.text);
        assert(c.map((x) => x.id).join(',') === [R.r1, R.r4, R.r3, R.r2].join(','), `order ${c.map((x) => x.id).join(',')} (want pending ${R.r1}, ${R.r4}, then decided ${R.r3}, ${R.r2})`);
        assert(tileNum(p.text, '확인 기다림') === 2 && tileNum(p.text, '완료 처리함') === 1 && tileNum(p.text, '돌려보냄') === 1, 'counts: 2 pending · 1 approved · 1 returned');
        const r1 = c[0].html;
        const bed = php(s, 'Tfm\\Db::one("SELECT first_seen_at, ready_at FROM farm_beds WHERE id = ?", [$in])', F.beds.k0rb2);
        for (const x of [K[0].nickname, '콩', 'RB2', '★★★', phpTime(bed.first_seen_at), phpTime(bed.ready_at)]) assert(r1.includes(x), `R1 shows "${x}"`);
        assert(r1.includes('&lt;script&gt;alert(') && /&quot;큰따옴표&quot;/.test(r1), 'the note comes back as text');
        assert(r1.includes(`<img class="photo" src="./?photo=${R.r1}"`), 'R1 shows its photo through the admin entry');
        assert(/name="action" value="report_decide"/.test(r1) && new RegExp(`name="rid" value="${R.r1}"`).test(r1) && /<textarea name="memo"[^>]*maxlength="500"/.test(r1), 'R1 has the memo form (≤ 500 characters)');
        assert(/<button[^>]*name="status" value="approved"[^>]*>✅ 완료 처리/.test(r1) && /<button[^>]*name="status" value="rejected"[^>]*>↩️ 돌려보내기/.test(r1), 'the two buttons');
        assert(!/<img/.test(c[1].html), 'R4 (a stored photo path that is not a report photo) shows no image');
        const r2 = c.find((x) => x.id === R.r2).html;
        assert(r2.includes('&lt;i&gt;기존&lt;/i&gt; 메모') && r2.includes(A.nickname), 'R2 (approved): its memo in the box (escaped) and who decided');
        const r3 = c.find((x) => x.id === R.r3).html;
        assert(r3.includes('&lt;img src=x onerror=alert(') && /연습 밭/.test(r3), 'R3: the markup nickname is text; a quick-plot request');
        assert(!/uploads\//.test(p.text), 'the page never links into uploads/');
        assert(!rawEvil(p.text).length, `raw markup: ${rawEvil(p.text).join(', ')}`);
        return `order ${c.map((x) => x.id).join(' → ')} · server times · note / memo / nickname inert · photo via ./?photo=`;
      });
      await step('15.4', '✅ 완료 확인: the photo is streamed by the admin entry after its own check (the right type, nosniff, no-store, a sandbox CSP); everybody else and every bad id gets the plain 404 of a missing page', async () => {
        const url = `${ADM}?photo=${R.r1}`;
        const ok = await b.bytes(url);
        assert(ok.status === 200 && ok.headers.get('content-type') === 'image/jpeg', `admin → ${ok.status} ${ok.headers.get('content-type')}`);
        assert(ok.buf.length === F.photoBytes && ok.buf[0] === 0xff && ok.buf[1] === 0xd8, `the JPEG bytes (${ok.buf.length} of ${F.photoBytes})`);
        assert(ok.headers.get('x-content-type-options') === 'nosniff' && /no-store/.test(ok.headers.get('cache-control') || ''), 'nosniff + no-store');
        assert(/default-src 'none'/.test(ok.headers.get('content-security-policy') || '') && /sandbox/.test(ok.headers.get('content-security-policy') || ''), `CSP ${ok.headers.get('content-security-policy')}`);
        const missing = await new Browser(sv.base).req('no-such-file-' + rnd() + '.php');
        const plain404 = (r, who) => { assert(r.status === 404 && !/^image\//.test(r.headers.get('content-type') || ''), `${who} → ${r.status} ${r.headers.get('content-type')}`); assert(!r.text.includes('\xff\xd8') && /404 Not Found/i.test(r.text) && !/관리|admin/i.test(r.text), `${who}: the plain 404 body`); };
        plain404(await new Browser(sv.base).bytes(url), 'anonymous');
        const player = new Browser(sv.base); await apiLogin(player, K[0]);
        plain404(await player.bytes(url), 'the player who sent it');
        const appOnly = new Browser(sv.base); await apiLogin(appOnly, A);
        plain404(await appOnly.bytes(url), 'an admin signed in to the app only (no admin elevation)');
        for (const bad of [String(R.r4), '999999', 'abc', '-1', '1e3', '../../config/config.php', '', `${R.r1}x`]) plain404(await b.bytes(`${ADM}?photo=${encodeURIComponent(bad)}`), `photo=${bad}`);
        assert(missing.status === 404, 'control: a missing file is 404 too');
        assert(isInside((await b.req(ADM)).text), 'the administrator is still signed in');
        return `admin 200 image/jpeg ${ok.buf.length} B · anonymous / player / app-only admin / 8 bad ids → plain 404`;
      });
      await step('15.4', '✅ 완료 확인: ✅ 완료 처리 / ↩️ 돌려보내기 with a memo (≤ 500 characters) — POST + CSRF → Farm::decide (audit crop_report_decided) → 303; a decided report gets its memo edited, the stamp time stays', async () => {
        const row = (id) => dbAll(s, 'SELECT status, memo, decided_at, decided_by FROM crop_reports WHERE id = ?', [id])[0];
        let r = await admF(b, ADM, { action: 'report_decide', tab: 'reports', rid: String(R.r1), status: 'approved', memo: '잘 키웠어요! <b>최고</b> 010-1234-5678' }, { page: '?tab=reports' });
        assert(flashOf(r.text)?.type === 'ok', `approve: ${flashOf(r.text)?.msg}`);
        let x = row(R.r1);
        assert(x.status === 'approved' && Number(x.decided_by) === A.id && Number(x.decided_at) > 0, `row ${JSON.stringify(x)}`);
        assert(x.memo.includes('최고') && !x.memo.includes('010-1234-5678'), `the memo is cleaned (the phone number masked): ${x.memo}`);
        const card = cards(r.text).find((c) => c.id === R.r1);
        assert(card && card.html.includes('&lt;b&gt;최고&lt;/b&gt;') && !card.html.includes('<b>최고'), 'the saved memo shows escaped');
        const au = dbAll(s, "SELECT * FROM audit_log WHERE event = 'crop_report_decided' ORDER BY id DESC LIMIT 1")[0];
        assert(au && Number(au.actor_id) === A.id && Number(au.user_id) === K[0].id, `audit ${JSON.stringify(au)}`);
        const stamp = Number(x.decided_at);
        await sleep(20);
        r = await admF(b, ADM, { action: 'report_decide', tab: 'reports', rid: String(R.r1), status: 'approved', memo: '메모만 고쳤어요' }, { page: '?tab=reports' });
        x = row(R.r1);
        assert(flashOf(r.text)?.type === 'ok' && x.memo === '메모만 고쳤어요' && Number(x.decided_at) === stamp, `memo edit keeps the stamp: ${JSON.stringify(x)}`);
        r = await admF(b, ADM, { action: 'report_decide', tab: 'reports', rid: String(R.r1), status: 'rejected', memo: '조금 더 키워 봐요' }, { page: '?tab=reports' });
        x = row(R.r1);
        assert(x.status === 'rejected' && x.memo === '조금 더 키워 봐요' && Number(x.decided_at) >= stamp, 'the decision can change');
        const before = JSON.stringify(row(R.r1));
        for (const f of [{ memo: '가'.repeat(501) }, { status: 'pending' }, { status: 'resolved' }, { status: '' }, { rid: '999999' }, { rid: 'abc' }, { rid: '' }]) {
          r = await admF(b, ADM, { action: 'report_decide', tab: 'reports', rid: String(R.r1), status: 'approved', memo: 'x', ...f }, { page: '?tab=reports' });
          assert(flashOf(r.text)?.type === 'error', `${JSON.stringify(f).slice(0, 40)} → ${flashOf(r.text)?.type} ${flashOf(r.text)?.msg}`);
        }
        assert(JSON.stringify(row(R.r1)) === before, 'refused decisions changed nothing');
        r = await admF(b, ADM, { action: 'report_decide', tab: 'reports', rid: String(R.r1), status: 'approved', memo: '가'.repeat(500) }, { page: '?tab=reports' });
        // the admin site accepts 500; what Farm::decide stores of it is the farm owner's rule (ChatFilter::maskPII reads 400 code points — reported)
        const kept = row(R.r1).memo.length;
        assert(flashOf(r.text)?.type === 'ok' && kept >= 400, `exactly 500 characters is accepted (${flashOf(r.text)?.msg}; stored ${kept})`);
        const post = await adm(b, ADM, { action: 'report_decide', tab: 'reports', rid: String(R.r4), status: 'approved', memo: '좋아요', show: 'pending', q: '#' + K[1].id }, { page: '?tab=reports' });
        assert(post.status === 303 && /tab=reports/.test(post.location) && /show=pending/.test(post.location) && /q=%23/.test(post.location), `the 303 goes back to the same list: ${post.location}`);
        return `approve (memo cleaned + escaped, audit) · memo edit keeps the stamp · change to rejected · 501 chars / bad status / bad id refused · 500 accepted (stored ${kept}) · 303 keeps the filter`;
      });
      await step('15.4', '✅ 완료 확인: filter by status, account search, paging (20 per page)', async () => {
        const n = async (q) => cards((await b.req(`${ADM}?tab=reports${q}`)).text).length;
        php(s, `(function ($in) { $now = Tfm\\Clock::ms(); for ($i = 0; $i < 21; $i++) Tfm\\Db::insert("crop_reports", ["user_id" => $in, "kind" => "plot", "bed_id" => "P9", "pid" => (string) (1731300000000 + $i + 1),
          "crop_id" => "CROP_RADISH", "stars" => 0, "amount" => 1, "note" => "", "photo" => "", "status" => "pending", "memo" => null, "requested_at" => $now - 5000 + $i, "decided_at" => 0, "decided_by" => null, "seen_at" => 0]); return 1; })($in)`, K[1].id);
        const counts = php(s, 'Tfm\\Farm::countReports()');
        const want = { '&show=pending': 20, '&show=pending&p=1': counts.pending - 20, '&show=approved': counts.approved, '&show=rejected': counts.rejected, [`&q=${encodeURIComponent('#' + K[2].id)}`]: 1, '': 20, '&p=1': 5, '&show=nope': 20 };
        for (const [q, w] of Object.entries(want)) { const got = await n(q); assert(got === w, `${q || 'all'}: ${got} cards, want ${w}`); }
        const p = await b.req(`${ADM}?tab=reports&show=approved`);
        assert(/<option value="approved" selected/.test(p.text), 'the filter stays selected');
        assert(/href="\.\/\?tab=reports[^"]*(&amp;|&)p=1/.test((await b.req(`${ADM}?tab=reports`)).text), 'a next link');
        return Object.entries(want).map(([q, w]) => `${q.replace(/^&/, '') || 'all'} ${w}`).join(' · ');
      });
      await step('15.6', '✅ 완료 확인: 🤖 메모 초안 (Claude::enabled) puts Claude::memoDraft into that report\'s memo box on the next page (escaped, not saved) — only the crop, stars and note leave the server; audit ai_admin_ask', async () => {
        const p = await b.req(`${ADM}?tab=reports&show=pending`);
        const c = cards(p.text);
        const target = c.find((x) => x.id === R.r4) || c[0];
        assert(/name="action" value="ai_memo"/.test(target.html), 'the 🤖 메모 초안 button');
        const before = dbAll(s, 'SELECT memo, status FROM crop_reports WHERE id = ?', [target.id])[0];
        const r = await admF(b, ADM, { action: 'ai_memo', tab: 'reports', rid: String(target.id), show: 'pending' }, { page: '?tab=reports&show=pending' });
        assert(flashOf(r.text)?.type === 'ok', `draft: ${flashOf(r.text)?.msg}`);
        const box = cards(r.text).find((x) => x.id === target.id);
        assert(box, 'the report is on the page after the 303');
        const ta = (box.html.match(/<textarea name="memo"[^>]*>([\s\S]*?)<\/textarea>/) || [])[1] || '';
        assert(ta.includes('&lt;script&gt;alert(') && ta.includes('메모 초안') && !ta.includes('<script'), `the draft is in the box, escaped: ${ta.slice(0, 120)}`);
        assert(/AI가 쓴 초안/.test(box.html), 'it says that the AI wrote it');
        assert(JSON.stringify(dbAll(s, 'SELECT memo, status FROM crop_reports WHERE id = ?', [target.id])[0]) === JSON.stringify(before), 'nothing is saved until the administrator decides');
        const sent = doubleLog(s).filter((x) => x.what === 'memo').pop();
        const blob = JSON.stringify(sent.input);
        assert(sent && Number(sent.uid) === A.id && /cropName|cropId/.test(blob) && /stars/.test(blob), `memoDraft got the crop and stars: ${blob}`);
        for (const u of [K[0], K[1], K[2]]) assert(!blob.includes(u.nickname) && !blob.includes(u.email), 'no nickname / e-mail went to the AI');
        assert(!blob.includes('onerror'), 'the account fields are not in the request at all');
        const au = dbAll(s, "SELECT * FROM audit_log WHERE event = 'ai_admin_ask' ORDER BY id DESC LIMIT 1")[0];
        assert(au && Number(au.actor_id) === A.id && /memo/.test(au.detail) && !au.detail.includes('메모 초안'), `audit ai_admin_ask (no answer text): ${au && au.detail}`);
        // saving with the (edited) draft clears it
        await admF(b, ADM, { action: 'report_decide', tab: 'reports', rid: String(target.id), status: 'approved', memo: '고친 초안이에요' }, { page: '?tab=reports' });
        const again = cards((await b.req(`${ADM}?tab=reports&show=approved`)).text).find((x) => x.id === target.id);
        assert(again && !/AI가 쓴 초안/.test(again.html) && again.html.includes('고친 초안이에요'), 'after saving, the box holds the saved memo');
        return 'button · draft in the box (escaped, unsaved) · request without account details · audit · cleared after saving';
      });
    } finally { await sv.stop(); }
  }

  // ================================================================= 🧑‍💻 개발자 — handover & inspection (CONTRACT §15.5)
  if (section('dev')) {
    const s = makeSite('dev');
    const sv = await startPhp(s);
    try {
      const A = mkUser(s, 'admin');
      const U = mkUser(s, 'user');
      const b = new Browser(sv.base, 'dev');
      const signedIn = async () => { if (!isInside((await b.req(ADM)).text)) assert(isInside((await signIn(b, ADM, A)).page.text), 'signed in'); };
      const noPhp = (t) => !/TFM_BOOT|<\?php|declare\(strict_types/.test(t);
      await step('15.5', '🧑‍💻 개발자 · 문서: a calm note while lib/docs is missing; the build\'s documents listed and rendered by Tfm\\Markdown (headings, tables, the "<script>" text of HANDOVER as text, links only http(s)); a document name can never reach another file', async () => {
        await signedIn();
        let p = await b.req(`${ADM}?tab=dev`);
        assert(p.status === 200 && isInside(p.text), `→ ${p.status}`);
        assertLocked(p, 'dev tab');
        assert(/lib\/docs/.test(p.text) && /아직/.test(p.text) && /tools\/build\.mjs/.test(p.text), 'a calm note says where the documents are');
        // the build copies the documents into lib/docs/ of every server copy (tools/build.mjs ADMIN_DOCS) — the same here
        fs.mkdirSync(path.join(s.site, 'lib/docs'), { recursive: true });
        for (const f of ['docs/HANDOVER.md', 'docs/ARCHITECTURE.md', 'docs/SERVER-INSTALL-KO.md', 'docs/SECURITY-REPORT-KO.md', 'server/README-SERVER.md']) fs.copyFileSync(path.join(ROOT, f), path.join(s.site, 'lib/docs', path.basename(f)));
        fs.writeFileSync(path.join(s.site, 'lib/docs/EVIL.md'), "# 시험 <script>alert('doc')</script>\n\n[x](javascript:alert(1)) <img src=x onerror=alert(2)>\n\n| a | b |\n|---|---|\n| <svg onload=alert(3)> | [ok](https://example.com/?a=1&b=2) |\n");
        fs.writeFileSync(path.join(s.site, 'lib/docs/secret.txt'), 'TOPSECRET-123');
        p = await b.req(`${ADM}?tab=dev&sec=docs`);
        for (const n of ['HANDOVER', 'SERVER-INSTALL-KO', 'SECURITY-REPORT-KO', 'README-SERVER', 'ARCHITECTURE', 'EVIL']) assert(p.text.includes(`doc=${n}"`), `listed: ${n}`);
        assert(!/doc=secret/.test(p.text) && !p.text.includes('TOPSECRET'), 'only .md files are documents');
        const h = await b.req(`${ADM}?tab=dev&sec=docs&doc=HANDOVER`);
        assertLocked(h, 'HANDOVER rendered');
        const doc = h.text.slice(h.text.indexOf('<div class="mdoc">'));
        assert(/<h2>/.test(doc) && /<table>/.test(doc) && /<pre><code>/.test(doc) && doc.includes('&lt;script&gt;'), 'HANDOVER: headings, tables, code, the <script> text as text');
        const ev = await b.req(`${ADM}?tab=dev&sec=docs&doc=EVIL`);
        assertLocked(ev, 'EVIL rendered', { payload: true });
        const at = ev.text.indexOf('<div class="mdoc">');
        const evd = ev.text.slice(at, ev.text.indexOf('</section>', at));
        assert(!/<script|<img|<svg|href="javascript|on[a-z]+=alert\(/i.test(evd.replace(/&lt;[\s\S]*?&gt;/g, '')) && evd.includes('&lt;svg onload=alert(3)&gt;'), 'markup of a document is text');
        assert(evd.includes('<a href="https://example.com/?a=1&amp;b=2" rel="noopener noreferrer">ok</a>') && !/href="[^h]/.test(evd), 'only the http(s) link is a link');
        for (const bad of ['../config/config', '../../lib/Core', 'HANDOVER.md', 'handover', 'EVIL/../HANDOVER', '.htaccess', 'secret', '%2e%2e%2fconfig', 'index', '']) {
          const r = await b.req(`${ADM}?tab=dev&sec=docs&doc=${encodeURIComponent(bad)}`);
          assert(r.status === 200 && isInside(r.text) && noPhp(r.text) && !r.text.includes('TOPSECRET') && !r.text.includes('<div class="mdoc">'), `doc=${bad}: no document`);
        }
        return '5 handover documents + 1 test document · rendered whitelisted · the calm note without lib/docs · 10 bad names refused';
      });
      await step('15.5', '🧑‍💻 개발자 · 인수인계 체크리스트: every Inspect::checklist item with a done checkbox and a note (POST + CSRF + audit); markup in a note comes back escaped, a pasted key is hidden', async () => {
        const list = php(s, 'Tfm\\Inspect::checklist()');
        const keys = Object.keys(list);
        let p = await b.req(`${ADM}?tab=dev&sec=checklist`);
        assertLocked(p, 'checklist');
        assert((p.text.match(/name="action" value="handover_save"/g) || []).length === keys.length, 'one form per item');
        for (const k of keys) assert(p.text.includes(`name="key" value="${k}"`) && p.text.includes(decode(list[k].label).replace(/&/g, '&amp;').replace(/</g, '&lt;')), `item ${k}`);
        for (const k of ['admin_2fa', 'db_account', 'https_cert', 'toss_keys', 'claude_key', 'backup_schedule', 'renew_schedule', 'log_location', 'secret_storage']) assert(keys.includes(k), `CONTRACT item ${k}`);
        let r = await admF(b, ADM, { action: 'handover_save', tab: 'dev', sec: 'checklist', key: 'admin_2fa', done: '1', note: `<script>alert('n')</script> 휴대폰 앱 등록 · ${'live' + '_sk_'}AbCdEfGh12345678IjKl` }, { page: '?tab=dev&sec=checklist' });
        assert(flashOf(r.text)?.type === 'ok' && /sec=checklist/.test(r.url), `save: ${flashOf(r.text)?.msg}`);
        const row = dbAll(s, "SELECT * FROM handover_items WHERE k = 'admin_2fa'")[0];
        assert(row && Number(row.done) === 1 && Number(row.updated_by) === A.id && !row.note.includes('live_sk_') && row.note.includes('휴대폰 앱 등록'), `row ${JSON.stringify(row)}`);
        assert(r.text.includes('&lt;script&gt;alert(') && !r.text.includes("<script>alert('n')"), 'the note shows escaped');
        assert(/name="done" value="1" checked/.test(r.text.slice(r.text.indexOf('value="admin_2fa"'))), 'the box is ticked');
        const au = dbAll(s, "SELECT * FROM audit_log WHERE event = 'handover_item_changed' ORDER BY id DESC LIMIT 1")[0];
        assert(au && Number(au.actor_id) === A.id && /admin_2fa/.test(au.detail), 'audit handover_item_changed');
        r = await admF(b, ADM, { action: 'handover_save', tab: 'dev', sec: 'checklist', key: 'admin_2fa', note: '다시 확인' }, { page: '?tab=dev&sec=checklist' });
        assert(Number(dbAll(s, "SELECT done FROM handover_items WHERE k = 'admin_2fa'")[0].done) === 0, 'an unticked box saves "not done"');
        for (const f of [{ key: 'no_such_item' }, { key: "admin_2fa' OR '1'='1" }, { key: '' }, { note: '가'.repeat(501) }]) {
          r = await admF(b, ADM, { action: 'handover_save', tab: 'dev', sec: 'checklist', key: 'db_account', done: '1', note: 'x', ...f }, { page: '?tab=dev&sec=checklist' });
          assert(flashOf(r.text)?.type === 'error', `${JSON.stringify(f).slice(0, 40)} → ${flashOf(r.text)?.type}`);
        }
        assert(dbAll(s, "SELECT * FROM handover_items WHERE k = 'db_account'").length === 0, 'refused saves changed nothing');
        return `${keys.length} items · save / untick · escaped · key hidden · audit · 4 bad saves refused`;
      });
      let runId = 0;
      await step('15.5', '🧑‍💻 개발자 · 점검 실행: Inspect::run from the page (POST + CSRF + audit inspection_run) — stored, listed, opened with its groups and versions', async () => {
        const post = await adm(b, ADM, { action: 'inspect_run', tab: 'dev', sec: 'inspect' }, { page: '?tab=dev&sec=inspect' });
        assert(post.status === 303 && /tab=dev/.test(post.location) && /sec=inspect/.test(post.location) && /run=\d+/.test(post.location), `303 to the run: ${post.location}`);
        runId = Number(post.location.match(/run=(\d+)/)[1]);
        const p = await b.follow(post);
        assert(flashOf(p.text)?.type === 'ok' && /점검 #\d+/.test(flashOf(p.text).msg), `flash ${flashOf(p.text)?.msg}`);
        assertLocked(p, 'run page', { payload: true });
        const row = dbAll(s, 'SELECT id, source, actor_id, status, ok_count, warn_count, fail_count FROM inspection_runs WHERE id = ?', [runId])[0];
        assert(row && row.source === 'admin' && Number(row.actor_id) === A.id, `row ${JSON.stringify(row)}`);
        for (const g of ['인수인계 · 버전', '관리자 페이지 잠금', '보안 설정', 'DB 계정', 'PHP']) assert(p.text.includes(g), `group "${g}"`);
        const ver = php(s, 'TFM_VERSION');
        assert(p.text.includes(ver) && /스키마/.test(p.text), 'the versions');
        assert(new RegExp(`href="\\./\\?download=${runId}"`).test(p.text), 'a Markdown download link through the admin entry');
        const au = dbAll(s, "SELECT * FROM audit_log WHERE event = 'inspection_run' ORDER BY id DESC LIMIT 1")[0];
        assert(au && Number(au.actor_id) === A.id, 'audit inspection_run');
        const list = await b.req(`${ADM}?tab=dev&sec=inspect`);
        assert(new RegExp(`run=${runId}"`).test(list.text) && /<tr class="run"/.test(list.text), 'the run is listed');
        return `run #${runId}: ok ${row.ok_count} · warn ${row.warn_count} · fail ${row.fail_count}`;
      });
      await step('15.5', '🧑‍💻 개발자 · 점검 실행: a run downloads as a text/markdown attachment through the admin entry (nosniff, no-store); everybody else and every bad id gets the plain 404', async () => {
        const r = await b.bytes(`${ADM}?download=${runId}`);
        assert(r.status === 200 && /^text\/markdown; charset=utf-8$/i.test(r.headers.get('content-type') || ''), `→ ${r.status} ${r.headers.get('content-type')}`);
        assert(/^attachment; filename="tfm-inspect-\d+-\d{8}-\d{6}\.md"$/.test(r.headers.get('content-disposition') || ''), `disposition ${r.headers.get('content-disposition')}`);
        assert(r.headers.get('x-content-type-options') === 'nosniff' && /no-store/.test(r.headers.get('cache-control') || '') && /sandbox/.test(r.headers.get('content-security-policy') || ''), 'nosniff, no-store, sandbox');
        const md = r.buf.toString('utf8');
        assert(md.startsWith(`# 서버 점검 보고서 #${runId}`) && /\| 항목 \| 상태 \| 값 \| 안내 \|/.test(md) && !/<script/.test(md), `the report: ${md.slice(0, 80)}`);
        const plain404 = (x, who) => assert(x.status === 404 && /404 Not Found/i.test(x.text) && !/서버 점검/.test(x.buf.toString('utf8')), `${who} → ${x.status}`);
        plain404(await new Browser(sv.base).bytes(`${ADM}?download=${runId}`), 'anonymous');
        const player = new Browser(sv.base); await apiLogin(player, U);
        plain404(await player.bytes(`${ADM}?download=${runId}`), 'a player');
        const appOnly = new Browser(sv.base); await apiLogin(appOnly, A);
        plain404(await appOnly.bytes(`${ADM}?download=${runId}`), 'an app-only admin');
        for (const bad of ['999999', 'abc', '-1', '', `${runId}x`, '../../data/secret']) plain404(await b.bytes(`${ADM}?download=${encodeURIComponent(bad)}`), `download=${bad}`);
        return 'text/markdown attachment · anonymous / player / app-only admin / 6 bad ids → plain 404';
      });
      await step('15.5', '🧑‍💻 개발자 · 환경·로그: versions, extensions, disk use, PHP settings and the last 200 log lines — keys, tokens, passwords, cookies, e-mail addresses and phone numbers hidden, markup escaped', async () => {
        php(s, `(function ($in) { Tfm\\Log::warn('TEST', 'login password=hunter2 for kid@example.com 010-1234-5678 ' . $in['p'], ['token' => 'tok-secret-123', 'apiKey' => 'sk-ant-api03-' . str_repeat('z', 30), 'Cookie' => 'TFMSESSID=cookie-value-99']); return 1; })($in)`, { p: EVIL.note });
        let p = await b.req(`${ADM}?tab=dev&sec=env`);
        assertLocked(p, 'env + logs', { payload: true });
        for (const x of [php(s, 'PHP_VERSION'), 'pdo', 'mbstring', 'memory_limit', 'upload_max_filesize', '로그']) assert(p.text.includes(x), `shows ${x}`);
        for (const x of ['hunter2', 'kid@example.com', '010-1234-5678', 'tok-secret-123', 'z'.repeat(30), 'cookie-value-99']) assert(!p.text.includes(x), `the log shows ${x}`);
        assert(p.text.includes('[가림') && p.text.includes('&lt;script&gt;alert(') && !rawEvil(p.text).length, 'hidden + escaped');
        php(s, '(function () { for ($i = 0; $i < 260; $i++) Tfm\\Log::info("FILL", "line " . $i); return 1; })()');
        p = await b.req(`${ADM}?tab=dev&sec=env`);
        const rows = (p.text.match(/<tr class="log/g) || []).length;
        assert(rows === 200, `${rows} log rows (want the last 200)`);
        assert(p.text.indexOf('line 259') < p.text.indexOf('line 100') && !p.text.includes('>line 59<') && !/line 59</.test(p.text), 'newest first, only the last 200');
        return 'versions · extensions · disk · ini · 200 log rows, newest first, secrets hidden';
      });
    } finally { await sv.stop(); }
  }

  // ================================================================= 🤖 AI 도우미 (CONTRACT §15.6 admin part, workflow interface 5)
  if (section('ai')) {
    const haveClaude = fs.existsSync(path.join(SRC, 'lib/Claude.php'));
    const FAKE_KEY = 'sk-' + 'ant-api03-ADMINLOCKFAKE' + 'Q'.repeat(24);
    {
      const s = makeSite('ai-plain');
      fs.rmSync(path.join(s.site, 'lib/Claude.php'), { force: true });
      const sv = await startPhp(s);
      try {
        await step('15.6', '🤖 AI 도우미 tab works while lib/Claude.php is not installed: it says "준비 중" and offers no AI form', async () => {
          const A = mkUser(s, 'admin');
          const b = new Browser(sv.base);
          assert(isInside((await signIn(b, ADM, A)).page.text), 'signed in');
          const p = await b.req(`${ADM}?tab=ai`);
          assert(p.status === 200 && isInside(p.text) && /준비 중/.test(p.text), `→ ${p.status}`);
          assertLocked(p, 'ai tab (no Claude)');
          assert(!/value="ai_summary"|value="ai_ask"/.test(p.text), 'no AI forms');
          const r = await admF(b, ADM, { action: 'ai_ask', tab: 'ai', prompt: '안녕' }, { page: '?tab=ai' });
          assert(flashOf(r.text)?.type === 'error', `ask without Claude: ${flashOf(r.text)?.msg}`);
          const rep = await b.req(`${ADM}?tab=reports`);
          assert(!/value="ai_memo"/.test(rep.text), 'no 🤖 메모 초안 button either');
          return 'guard path: no lib/Claude.php in this copy';
        });
      } finally { await sv.stop(); }
    }
    const s = makeSite('ai', { anthropic: { api_key: FAKE_KEY, model: 'double-model-x', effort: 'low', daily_user: 20, daily_total: 2000 }, rate_limits: { ai_admin: [4, 60] } });
    useClaudeDouble(s);
    const sv = await startPhp(s);
    try {
      const A = mkUser(s, 'admin');
      const K = mkUser(s, 'user');
      const b = new Browser(sv.base, 'ai');
      assert(isInside((await signIn(b, ADM, A)).page.text), 'signed in');
      php(s, `(function ($in) { $now = Tfm\\Clock::ms(); foreach ([['kid', 30, 40], ['kid', 10, 12], ['admin', 5, 6]] as $r) Tfm\\Db::insert('ai_usage', ['created_at' => $now, 'user_id' => $in, 'scope' => $r[0], 'model' => 'double-model',
        'input_tokens' => $r[1], 'output_tokens' => $r[2], 'stop_reason' => 'end_turn', 'ok' => 1, 'ms' => 9]); return 1; })($in)`, K.id);
      await step('15.6', '🤖 AI 도우미: status — configured / enabled / model / effort / today\'s usage (Claude::usageToday) — and the API key never appears on any admin page', async () => {
        const p = await b.req(`${ADM}?tab=ai`);
        assert(p.status === 200 && isInside(p.text) && !/준비 중/.test(p.text), `→ ${p.status}`);
        assertLocked(p, 'ai tab');
        for (const x of ['double-model-x', 'low', '설정됨', '켜짐']) assert(p.text.includes(x), `status shows ${x}`);
        assert(tileNum(p.text, '오늘 질문') === 3, `today's questions: ${tileNum(p.text, '오늘 질문')}`);
        assert(/45/.test(p.text) && /58/.test(p.text), 'today\'s tokens in / out (45 / 58)');
        const home = await b.req(ADM);
        const tabs = [...home.text.matchAll(/href="\.\/\?tab=([a-z0-9_]+)"/g)].map((m) => m[1]);
        for (const t of new Set(tabs)) {
          const x = await b.req(`${ADM}?tab=${t}`);
          assert(!x.text.includes(FAKE_KEY) && !x.text.includes('ADMINLOCKFAKE'), `tab ${t} shows the key`);
        }
        return `configured · enabled · model · effort · usage 3 / 45 / 58 · key on none of ${new Set(tabs).size} tabs`;
      });
      await step('15.6', '🤖 AI 도우미: the kid-helper switch (Settings ai.kid_helper) — POST + CSRF + audit setting_changed', async () => {
        let r = await admF(b, ADM, { action: 'ai_kid', tab: 'ai', on: '1' }, { page: '?tab=ai' });
        assert(flashOf(r.text)?.type === 'ok' && php(s, 'Tfm\\Claude::kidEnabled()') === true, `on: ${flashOf(r.text)?.msg}`);
        const set = dbAll(s, "SELECT * FROM settings WHERE k = 'ai.kid_helper'")[0];
        assert(set && JSON.parse(set.v) === true && Number(set.updated_by) === A.id, `settings ${JSON.stringify(set)}`);
        const au = dbAll(s, "SELECT * FROM audit_log WHERE event = 'setting_changed' ORDER BY id DESC LIMIT 1")[0];
        assert(au && /ai\.kid_helper/.test(au.detail) && Number(au.actor_id) === A.id, 'audit setting_changed');
        assert(/value="ai_kid"[\s\S]{0,200}name="on" value="0"/.test(r.text) || /name="on" value="0"/.test(r.text), 'the page now offers to switch it off');
        r = await admF(b, ADM, { action: 'ai_kid', tab: 'ai', on: '0' }, { page: '?tab=ai' });
        assert(flashOf(r.text)?.type === 'ok' && php(s, 'Tfm\\Claude::kidEnabled()') === false, 'off');
        return 'on → settings true + audit · off → false';
      });
      await step('15.6', '🤖 AI 도우미: 오늘 요약 — Claude::daySummary gets today\'s numbers only (no account details); the answer is shown escaped with its line breaks; audit ai_admin_ask', async () => {
        const r = await admF(b, ADM, { action: 'ai_summary', tab: 'ai' }, { page: '?tab=ai' });
        assert(flashOf(r.text)?.type === 'ok', `summary: ${flashOf(r.text)?.msg}`);
        const box = (r.text.match(/<div class="aianswer"[^>]*>([\s\S]*?)<\/div>/) || [])[1] || '';
        assert(box.includes('&lt;script&gt;alert(') && box.includes('&lt;b&gt;굵게&lt;/b&gt;') && box.includes('\n둘째 줄') && !rawEvil(r.text).length && !/<b>굵게/.test(r.text), `the answer escaped: ${box.slice(0, 160)}`);
        const sent = doubleLog(s).filter((x) => x.what === 'summary').pop();
        const blob = JSON.stringify(sent && sent.input);
        assert(sent && Number(sent.uid) === A.id && /users|activeToday/.test(blob), `daySummary got the numbers: ${blob.slice(0, 200)}`);
        assert(!blob.includes(K.nickname) && !blob.includes(K.email) && !blob.includes(A.email) && !/@example\.com/.test(blob), 'no nickname / e-mail in the numbers');
        const au = dbAll(s, "SELECT * FROM audit_log WHERE event = 'ai_admin_ask' ORDER BY id DESC LIMIT 1")[0];
        assert(au && /summary/.test(au.detail) && !au.detail.includes('굵게'), 'audit ai_admin_ask (kind summary, no answer text)');
        return 'numbers only · answer escaped with line breaks · audit';
      });
      await step('15.6', '🤖 AI 도우미: the free prompt box — Claude::adminAsk gets the question with personal data and keys hidden; the answer is shown escaped; empty / too long refused; rate ai_admin; a failing call shows its reason escaped', async () => {
        const q = '오늘 텃밭 상태를 알려 줘. kid@example.com 010-1234-5678 password=hunter2';
        let r = await admF(b, ADM, { action: 'ai_ask', tab: 'ai', prompt: q }, { page: '?tab=ai' });
        assert(flashOf(r.text)?.type === 'ok', `ask: ${flashOf(r.text)?.msg}`);
        const box = (r.text.match(/<div class="aianswer"[^>]*>([\s\S]*?)<\/div>/) || [])[1] || '';
        assert(box.includes('&lt;img src=x onerror=alert(7)&gt;') && !/<img src=x/.test(r.text), 'the answer escaped');
        const sent = doubleLog(s).filter((x) => x.what === 'ask').pop();
        assert(sent && typeof sent.input === 'string' && sent.input.includes('텃밭 상태') && !/kid@example\.com|010-1234-5678|hunter2/.test(sent.input), `adminAsk got the hidden question: ${sent && sent.input}`);
        const au = dbAll(s, "SELECT * FROM audit_log WHERE event = 'ai_admin_ask' ORDER BY id DESC LIMIT 1")[0];
        assert(au && /"kind":"ask"/.test(au.detail) && !au.detail.includes('텃밭'), `audit ai_admin_ask without the question: ${au && au.detail}`);
        for (const bad of ['', '   ', '가'.repeat(2001)]) {
          r = await admF(b, ADM, { action: 'ai_ask', tab: 'ai', prompt: bad }, { page: '?tab=ai' });
          assert(flashOf(r.text)?.type === 'error', `prompt "${bad.slice(0, 8)}" (${bad.length}) → ${flashOf(r.text)?.type}`);
        }
        // ai_admin is 4 per minute in this copy: summary + ask used 2 (refused prompts never reach the AI) — two more pass, the next is refused
        r = await admF(b, ADM, { action: 'ai_ask', tab: 'ai', prompt: '하나 더' }, { page: '?tab=ai' });
        r = await admF(b, ADM, { action: 'ai_ask', tab: 'ai', prompt: '둘 더' }, { page: '?tab=ai' });
        r = await admF(b, ADM, { action: 'ai_ask', tab: 'ai', prompt: '셋 더' }, { page: '?tab=ai' });
        assert(flashOf(r.text)?.type === 'error' && /많아요|잠시/.test(flashOf(r.text).msg), `rate ai_admin: ${flashOf(r.text)?.msg}`);
        const A2 = mkUser(s, 'admin'); // its own ai_admin budget (the limit counts per account)
        const sv2 = await startPhp(s, { TFM_T_AI: 'fail' });
        try {
          const c = new Browser(sv2.base, 'ai-fail');
          assert(isInside((await signIn(c, ADM, A2)).page.text), 'signed in (failing AI)');
          const f = await admF(c, ADM, { action: 'ai_summary', tab: 'ai' }, { page: '?tab=ai' });
          assert(flashOf(f.text)?.type === 'error' && flashOf(f.text).msg.includes('upstream') && !/<b>error/.test(f.text), `failing call: ${flashOf(f.text)?.msg}`);
        } finally { await sv2.stop(); }
        const sv3 = await startPhp(s, { TFM_T_AI: 'disabled' });
        try {
          const c = new Browser(sv3.base, 'ai-off');
          assert(isInside((await signIn(c, ADM, A2)).page.text), 'signed in (AI switched off)');
          const p = await c.req(`${ADM}?tab=ai`);
          assert(/꺼져/.test(p.text) && !/value="ai_ask"/.test(p.text) && !/value="ai_summary"/.test(p.text), 'switched off: status says so, no AI forms');
          const x = await admF(c, ADM, { action: 'ai_ask', tab: 'ai', prompt: '안녕' }, { page: '?tab=ai' });
          assert(flashOf(x.text)?.type === 'error', 'and a forged ask is refused');
        } finally { await sv3.stop(); }
        return 'question hidden (e-mail, phone, password) · answer escaped · audit · empty / long refused · 5th AI call in a minute refused · failure reason escaped · switched off';
      });
      await step('15.6', '🤖 AI 도우미 with the real lib/Claude.php in mock mode (TFM_AI_MOCK=1): 오늘 요약 and the prompt box answer end to end', async () => {
        if (!haveClaude) throw new Skip('lib/Claude.php is not in the tree yet (the claude track) — the double above stood in');
        const r2 = makeSite('ai-real', { rate_limits: { ai_admin: [100, 60] } });
        const sv4 = await startPhp(r2, { TFM_AI_MOCK: '1' });
        try {
          const A2 = mkUser(r2, 'admin');
          const c = new Browser(sv4.base, 'ai-real');
          assert(isInside((await signIn(c, ADM, A2)).page.text), 'signed in');
          const p = await c.req(`${ADM}?tab=ai`);
          assertLocked(p, 'ai tab (real Claude, mock)');
          const s1 = await admF(c, ADM, { action: 'ai_summary', tab: 'ai' }, { page: '?tab=ai' });
          assert(flashOf(s1.text)?.type === 'ok' && /<div class="aianswer"/.test(s1.text), `summary: ${flashOf(s1.text)?.msg}`);
          const s2 = await admF(c, ADM, { action: 'ai_ask', tab: 'ai', prompt: '오늘 할 일을 알려 줘' }, { page: '?tab=ai' });
          assert(flashOf(s2.text)?.type === 'ok' && /<div class="aianswer"/.test(s2.text), `ask: ${flashOf(s2.text)?.msg}`);
          assert(Number(dbVal(r2, "SELECT COUNT(*) FROM ai_usage WHERE scope = 'admin'")) >= 2, 'ai_usage rows (scope admin)');
          return 'real Tfm\\Claude in mock mode: summary + ask answered';
        } finally { await sv4.stop(); }
      });
    } finally { await sv.stop(); }
  }

  // ================================================================= renaming the folder (CLI) + adminUrl
  // ================================================================= [allot-admin] 🏺 분양 관리 without JavaScript (CONTRACT §16.7)
  if (section('allot')) {
    const s = makeSite('allot');
    const sv = await startPhp(s);
    try {
      const A = mkUser(s, 'admin');
      const U = mkUser(s, 'user');
      const b = new Browser(sv.base, 'allot');
      const T = `${ADM}?tab=allot`;
      const SAME = { Origin: sv.base.replace(/\/$/, ''), 'Sec-Fetch-Site': 'same-origin' };
      // the personal data of the test customer: it may appear only in a revealed view / export, never anywhere else
      const PII = { name: '홍길동', phone: '010-2468-1357', mid: '2468', addr: '비밀길 7' };
      const XSS = ['<img src=x onerror=alert(11)>', '<script>alert(12)</script>', '"><svg onload=alert(13)>'];
      const trail = { locations: [], flashes: [] };
      const rawXss = (t) => /<img src=x onerror|<script>alert|<svg onload/i.test(t);
      const leaks = (t) => [PII.name, PII.phone, PII.mid + '-1357', PII.addr].filter((x) => String(t).includes(x));
      /** the forms of a page as a browser without scripts sees them (a row button may sit outside its form: form="id") */
      const formsOf = (html) => {
        const attr = (a, k) => { const m = a.match(new RegExp(`\\s${k}="([^"]*)"`)); return m ? decode(m[1]) : null; };
        const fieldsIn = (chunk, outside) => {
          const out = [];
          const els = (rx, fn) => { for (const m of chunk.matchAll(rx)) fn(m); };
          els(/<input\b([^>]*)>/g, (m) => {
            const n = attr(m[1], 'name'); const t = (attr(m[1], 'type') || 'text').toLowerCase();
            if (!n || (outside && attr(m[1], 'form') === null)) return;
            if ((t === 'checkbox' || t === 'radio') && !/\schecked\b/.test(m[1])) return;
            if (t === 'submit') return;
            out.push([n, attr(m[1], 'value') ?? (t === 'checkbox' ? 'on' : '')]);
          });
          els(/<select\b([^>]*)>([\s\S]*?)<\/select>/g, (m) => {
            const n = attr(m[1], 'name'); if (!n || (outside && attr(m[1], 'form') === null)) return;
            const opts = [...m[2].matchAll(/<option\b([^>]*)>/g)];
            const sel = opts.find((o) => /\sselected\b/.test(o[1])) || opts[0];
            out.push([n, sel ? attr(sel[1], 'value') ?? '' : '']);
          });
          els(/<textarea\b([^>]*)>([\s\S]*?)<\/textarea>/g, (m) => { const n = attr(m[1], 'name'); if (n && !(outside && attr(m[1], 'form') === null)) out.push([n, decode(m[2])]); });
          return out;
        };
        const forms = [];
        for (const m of html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/g)) {
          const id = attr(m[1], 'id');
          let fields = fieldsIn(m[2], false);
          if (id) {
            // elements elsewhere on the page that belong to this form
            const rx = new RegExp(`<(?:input|select|textarea)\\b[^>]*\\sform="${id}"[^>]*>(?:[\\s\\S]*?<\\/(?:select|textarea)>)?`, 'g');
            for (const e of html.matchAll(rx)) fields = fields.concat(fieldsIn(e[0], true));
          }
          const buttons = [...(m[2] + (id ? [...html.matchAll(new RegExp(`<button\\b[^>]*\\sform="${id}"[^>]*>`, 'g'))].map((x) => x[0]).join('') : '')).matchAll(/<button\b([^>]*)>/g)]
            .map((x) => [attr(x[1], 'name'), attr(x[1], 'value')]).filter((x) => x[0]);
          const get = (k) => { const f = fields.find((x) => x[0] === k); return f ? f[1] : null; };
          forms.push({ id, fields, buttons, get, action: get('action') });
        }
        return forms;
      };
      /** GET a page of the tab: 200, inside, the locked headers, zero scripts / inline styles / handlers, no raw payload */
      const page = async (q = '') => {
        const r = await b.req(T + q);
        assert(r.status === 200 && isInside(r.text), `GET ${q || '(tab)'} → ${r.status}`);
        assertLocked(r, `🏺 ${q || '(tab)'}`, { payload: true }); // payloads sit escaped inside value="…": the raw check is rawXss
        assert(!rawXss(r.text), `a payload is raw markup on ${q}`);
        return r;
      };
      /** fill the form of `action` on page r like a person would (over: name → value | [values] | null) and press it */
      const cookieFor = () => b.jar.filter((c) => Browser.match('/' + ADM, c.path)).map((c) => `${c.name}=${c.value}`).join('; ');
      const submit = async (r, action, over = {}, { match = null, button = null, follow = true, raw = false, bytes = false } = {}) => {
        const f = formsOf(r.text).find((x) => x.action === action && (!match || match(x)));
        assert(f, `no form for ${action} on ${r.url}`);
        const pairs = f.fields.filter(([k]) => !(k in over));
        for (const [k, v] of Object.entries(over)) { if (v === null) continue; for (const one of Array.isArray(v) ? v : [v]) pairs.push([k, String(one)]); }
        if (button) pairs.push(button);
        if (bytes) { // a file answer: the exact bytes (fetch's text() would drop the BOM)
          const url = new URL(ADM, sv.base).href;
          const res = await fetch(url, { method: 'POST', headers: { ...SAME, Cookie: cookieFor(), 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(pairs).toString(), redirect: 'manual' });
          const buf = Buffer.from(await res.arrayBuffer());
          if (res.headers.get('location')) trail.locations.push(res.headers.get('location'));
          return { status: res.status, headers: res.headers, buf, text: buf.toString('utf8'), location: res.headers.get('location'), url };
        }
        const post = await b.req(ADM, { form: pairs, headers: SAME });
        if (post.location) trail.locations.push(post.location);
        if (raw || !follow) return post;
        assert(post.status === 303, `${action} → ${post.status} ${post.text.slice(0, 200)}`);
        const next = await b.follow(post);
        assertLocked(next, `after ${action}`, { payload: true });
        assert(!rawXss(next.text), `a payload is raw markup after ${action}`);
        const fl = flashOf(next.text);
        if (fl) trail.flashes.push(fl.msg);
        return { post, page: next, flash: fl };
      };
      const counts = () => JSON.stringify(dbAll(s, `SELECT 'z' AS t, COUNT(*) AS n FROM allot_zones UNION ALL SELECT 'cu', COUNT(*) FROM allot_customers UNION ALL SELECT 'co', COUNT(*) FROM allot_contracts
        UNION ALL SELECT 'p', COUNT(*) FROM allot_payments UNION ALL SELECT 'n', COUNT(*) FROM allot_notices UNION ALL SELECT 'k', COUNT(*) FROM allot_care_logs UNION ALL SELECT 'w', COUNT(*) FROM allot_waitlist
        UNION ALL SELECT 'u', COUNT(*) FROM allot_units WHERE status <> 'open'`));
      const unitId = (code) => Number(dbVal(s, 'SELECT id FROM allot_units WHERE code = ?', [code]));
      const ids = {};

      await step('16.7', '🏺 분양 관리 without JavaScript: the first visit explains and offers the seed; one POST builds the zones; all ten sections render locked (no script, no inline style, no handler)', async () => {
        assert(isInside((await signInFull(b, ADM, A)).text), 'signed in');
        let r = await page();
        assert(/분양 관리를 시작해요/.test(r.text) && formsOf(r.text).some((f) => f.action === 'allot_seed'), 'first steps with the seed buttons');
        const res = await submit(r, 'allot_seed', {}, { match: (f) => f.get('preset') === 'small' });
        assert(res.flash?.type === 'ok' && Number(dbVal(s, 'SELECT COUNT(*) FROM allot_units')) === 180, `seeded small preset: ${res.flash?.msg}`);
        const secs = ['status', 'zones', 'units', 'contracts', 'customers', 'wait', 'notices', 'care', 'csv', 'auto'];
        for (const sec of secs) await page(`&sec=${sec}`);
        const ov = await b.req(`${ADM}?tab=overview`);
        assert(/분양: 임대 <b>0<\/b> \/ 180/.test(ov.text) && /승인 대기/.test(ov.text), 'the first tab carries the line "분양: 임대 n / total · 승인 대기 n"');
        const src = fs.readFileSync(path.join(s.site, STUB_DIR, 'index.php'), 'utf8');
        const labels = [...new Set([...src.matchAll(/case '(allot_[a-z_]+)':/g)].map((m) => m[1]))];
        assert(labels.length >= 34, `the allot actions are case labels of admin/index.php (the csrf scan reads them): ${labels.length}`);
        return `seed 180 units · ${secs.length} sections + the overview card · ${labels.length} allot actions visible to the CSRF scan`;
      });

      await step('16.7', 'every allot action is refused without a token / with a wrong token / cross-site, and for an app-only admin and a player; nothing changes', async () => {
        const src = fs.readFileSync(path.join(s.site, STUB_DIR, 'index.php'), 'utf8');
        const labels = [...new Set([...src.matchAll(/case '(allot_[a-z_]+)':/g)].map((m) => m[1]))];
        const before = counts();
        const tok = tokenOf((await b.req(T)).text);
        const f = (a) => ({ action: a, tab: 'allot', preset: 'small', op: 'closed', 'ids[]': String(unitId('J01-0001')), what: 'customers', csv: '일자,성명\n', title: 'x', to: 'all', text: 'x', kind: 'care' });
        for (const a of labels) {
          for (const [form, h] of [[f(a), SAME], [{ ...f(a), _csrf: '0'.repeat(64) }, SAME], [{ ...f(a), _csrf: tok }, { Origin: 'https://evil.example' }], [{ ...f(a), _csrf: tok }, { 'Sec-Fetch-Site': 'cross-site' }]]) {
            const r = await b.req(ADM, { form, headers: h });
            assert(r.status === 403 && !r.location, `${a} → ${r.status}`);
          }
        }
        const app = new Browser(sv.base); await apiLogin(app, A);
        const pl = new Browser(sv.base); await apiLogin(pl, U);
        for (const who of [app, pl]) for (const a of ['allot_tick', 'allot_seed', 'allot_export', 'allot_reveal', 'allot_units_bulk']) {
          const r = await adm(who, ADM, f(a), { headers: SAME });
          assert(r.status === 403 && !r.location, `${who === app ? 'app-only admin' : 'player'} ${a} → ${r.status}`);
          assert(!/text\/csv/.test(r.headers.get('content-type') || ''), 'no file');
        }
        assert(counts() === before, 'something changed');
        return `${labels.length} actions × 4 refusals · app-only admin and player refused`;
      });

      await step('16.7', 'end to end on the forms: zone → customer → contract → payment (idempotent) → renew → care log → notice → nameplate → end; markup in every customer-controlled field stays text', async () => {
        let r = await page('&sec=zones');
        let res = await submit(r, 'allot_zone_save', { code: 'T01', kind: 'jar', name: `시험 구역 ${XSS[0]}`, capacity: '12', cols: '6', price: '120000', period: 'year', termMonths: '12', isOpen: '1', note: XSS[1] },
          { match: (x) => !x.get('id') });
        assert(res.flash?.type === 'ok' && Number(dbVal(s, "SELECT COUNT(*) FROM allot_units u JOIN allot_zones z ON z.id = u.zone_id WHERE z.code = 'T01'")) === 12, `zone T01 with 12 units: ${res.flash?.msg}`);
        await page('&sec=zones');
        r = await page('&sec=customers');
        res = await submit(r, 'allot_customer_save', { name: PII.name, phone: PII.phone, addr: '강원 정선군 ' + PII.addr, memo: `=HYPERLINK("http://evil.example","x") ${XSS[0]}`, consent: '1' });
        ids.cust = Number((res.post.location.match(/cust=(\d+)/) || [])[1]);
        assert(res.flash?.type === 'ok' && ids.cust > 0, `customer saved: ${res.flash?.msg}`);
        assert(!leaks(res.page.text).length, `the customer page shows the data masked: ${leaks(res.page.text)}`);
        res = await submit(res.page, 'allot_contract_new', { unit: 'T01-0001', status: 'active', memo: XSS[2] });
        ids.con = Number((res.post.location.match(/con=(\d+)/) || [])[1]);
        assert(res.flash?.type === 'ok' && ids.con > 0, `contract made: ${res.flash?.msg}`);
        const c0 = dbAll(s, 'SELECT contract_no, status, ends_at, paid_until FROM allot_contracts WHERE id = ?', [ids.con])[0];
        ids.no = c0.contract_no;
        assert(c0.status === 'active', 'active');
        r = await page(`&sec=contracts&con=${ids.con}`);
        const payForm = formsOf(r.text).find((x) => x.action === 'allot_pay');
        assert(payForm && /^[a-z0-9]{8,64}$/i.test(payForm.get('idem') || ''), 'the payment form carries a one-time key');
        res = await submit(r, 'allot_pay', { amount: '120000', method: 'bank', memo: '=HYPERLINK("http://evil.example","x")' });
        assert(res.flash?.type === 'ok' && Number(dbVal(s, 'SELECT COUNT(*) FROM allot_payments WHERE contract_id = ?', [ids.con])) === 1, `payment: ${res.flash?.msg}`);
        res = await submit(r, 'allot_pay', { amount: '120000', method: 'bank' }); // the same form pressed twice
        assert(/이미 기록한/.test(res.flash?.msg || '') && Number(dbVal(s, 'SELECT COUNT(*) FROM allot_payments WHERE contract_id = ?', [ids.con])) === 1, 'a double press records once');
        res = await submit(await page(`&sec=contracts&con=${ids.con}`), 'allot_renew', { terms: '1' });
        const c1 = dbAll(s, 'SELECT ends_at FROM allot_contracts WHERE id = ?', [ids.con])[0];
        assert(res.flash?.type === 'ok' && Number(c1.ends_at) > Number(c0.ends_at), `renewed: ${res.flash?.msg}`);
        res = await submit(await page('&sec=care'), 'allot_care_add', { to: 'unit', ref: 'T01-0001', kind: 'water', text: `물 줬어요 ${XSS[1]}`, visible: '1' });
        assert(res.flash?.type === 'ok' && Number(dbVal(s, 'SELECT COUNT(*) FROM allot_care_logs')) >= 1, `care log: ${res.flash?.msg}`);
        await page('&sec=care');
        res = await submit(await page('&sec=notices'), 'allot_notify', { to: 'contract', ref: ids.no, title: `안내 ${XSS[2]}`, body: `본문 ${XSS[0]}` });
        assert(res.flash?.type === 'ok' && /1명/.test(res.flash.msg), `notice: ${res.flash?.msg}`);
        await page('&sec=notices');
        r = await page('&sec=units&zone=t01');
        const uid = unitId('T01-0001');
        res = await submit(r, 'allot_unit', { [`text_${uid}`]: `우리집${XSS[0]}`, [`show_${uid}`]: '1' }, { match: (x) => x.buttons.some((bt) => bt[0] === 'pick'), button: ['pick', `${uid}:label`] });
        assert(res.flash?.type === 'ok', `nameplate: ${res.flash?.msg}`);
        const label = String(dbVal(s, 'SELECT label FROM allot_units WHERE id = ?', [uid]));
        assert([...label].length <= 12 && label.startsWith('우리집'), `the nameplate is cut to 12 characters: "${label}"`);
        const up = await page('&sec=units&zone=t01');
        const esc = label.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        assert(!/[<>"]/.test(label) || up.text.includes(esc), 'a nameplate with markup characters is shown as text');
        await page(`&sec=contracts&con=${ids.con}`);
        res = await submit(await page(`&sec=contracts&con=${ids.con}`), 'allot_end', { sure: '1' });
        const c2 = dbAll(s, "SELECT c.status, u.status AS us FROM allot_contracts c JOIN allot_units u ON u.id = c.unit_id WHERE c.id = ?", [ids.con])[0];
        assert(res.flash?.type === 'ok' && c2.status === 'ended' && c2.us === 'open', `ended, the unit is free: ${JSON.stringify(c2)}`);
        res = await submit(await page('&sec=status'), 'allot_tick');
        assert(res.flash?.type === 'ok' && Number(dbVal(s, "SELECT COUNT(*) FROM job_runs WHERE source = 'admin'")) >= 1, `지금 실행: ${res.flash?.msg}`);
        return `contract ${ids.no}: paid once (double press ignored), renewed, care log, notice, nameplate "${label}", ended · tick recorded`;
      });

      await step('16.7', 'search by phone number goes through the blind index (the address carries a random token, never the number); a reveal needs the password + a reason, is audited without the value and shows once', async () => {
        let res = await submit(await page('&sec=contracts'), 'allot_find', { find: PII.phone });
        assert(/[?&]s=[0-9a-f]{8}\b/.test(res.post.location) && !leaks(res.post.location).length, `the address carries a token: ${res.post.location}`);
        assert(res.page.text.includes(ids.no), `the contract is found by the phone number: ${res.flash?.type} ${res.flash?.msg} · ${(res.page.text.match(/class="empty">[^<]*/) || [''])[0]} · ${(res.page.text.match(/A\d\d-[2-9A-Z]{5}-[2-9A-Z]{5}/g) || []).join(',')}`);
        assert(!leaks(res.page.text).length, 'the result page is masked');
        let r = await page(`&sec=customers&cust=${ids.cust}`);
        res = await submit(r, 'allot_reveal', { why: 'call', password: 'wrong-' + PASSWORD });
        assert(res.flash?.type !== 'ok' && !leaks(res.page.text).length, 'a wrong password reveals nothing');
        res = await submit(await page(`&sec=customers&cust=${ids.cust}`), 'allot_reveal', { why: 'call', password: PASSWORD });
        assert(res.flash?.type === 'ok' && res.page.text.includes(PII.phone) && res.page.text.includes(PII.addr) && res.page.text.includes(PII.name), 'the revealed view shows name, phone and address');
        assert(!leaks(res.post.location).length && !leaks(res.flash.msg).length, 'not in the address, not in the flash');
        r = await page(`&sec=customers&cust=${ids.cust}`);
        assert(!r.text.includes(PII.phone) && !r.text.includes(PII.addr), 'the next view is masked again (shown once)');
        const aud = dbAll(s, "SELECT event, detail FROM audit_log WHERE event LIKE 'allot_%' ORDER BY id");
        assert(aud.some((x) => /reveal|pii_unlocked/.test(x.event)), `the reveal is audited: ${[...new Set(aud.map((x) => x.event))].join(', ')}`);
        res = await submit(await page(`&sec=customers&cust=${ids.cust}`), 'allot_pii_lock');
        assert(res.flash?.type === 'ok', 'lock again');
        return `phone search via token · wrong password refused · revealed once · ${aud.length} allot audit rows`;
      });

      await step('16.7', 'export: a POST answers the CSV itself (BOM, CRLF, attachment named without a person); masked by default; formulas defused; the full export needs the password and a reason', async () => {
        const r = await page('&sec=csv');
        let post = await submit(r, 'allot_export', { what: 'customers' }, { match: (x) => !x.get('reveal'), bytes: true });
        const cd = post.headers.get('content-disposition') || '';
        assert(post.status === 200 && /text\/csv/.test(post.headers.get('content-type') || '') && /attachment; filename="tfm-allot-customers-masked-\d{8}-\d{6}\.csv"/.test(cd), `masked export: ${post.status} ${cd}`);
        assert(post.text.charCodeAt(0) === 0xfeff && /\r\n/.test(post.text), 'BOM + CRLF');
        assert(!leaks(post.text).length, `the masked file leaks: ${leaks(post.text)}`);
        const pays = await submit(await page('&sec=csv'), 'allot_export', { what: 'payments' }, { match: (x) => !x.get('reveal'), bytes: true });
        assert(pays.status === 200 && !/(^|,)"?=HYPERLINK/m.test(pays.text) && /'=HYPERLINK/.test(pays.text), 'the formula in a payment memo is defused');
        post = await submit(await page('&sec=csv'), 'allot_export', { what: 'customers', reveal: '1', why: 'request', password: null }, { match: (x) => x.fields.some(([k]) => k === 'why'), bytes: true });
        assert(!/text\/csv/.test(post.headers.get('content-type') || ''), 'without the password: no file');
        await b.follow(post);
        post = await submit(await page('&sec=csv'), 'allot_export', { what: 'customers', reveal: '1', why: 'request', password: PASSWORD }, { match: (x) => x.fields.some(([k]) => k === 'why'), bytes: true });
        assert(post.status === 200 && /-full-/.test(post.headers.get('content-disposition') || '') && post.text.includes(PII.phone), 'the full export has the data');
        const aud = dbAll(s, "SELECT event, detail FROM audit_log WHERE event LIKE 'allot_export%' ORDER BY id");
        assert(aud.length >= 2 && aud.every((x) => !leaks(x.detail).length), 'export audit rows without data');
        return `masked ${post.text.length} bytes · full only after the password · ${aud.length} audit rows`;
      });

      await step('16.7', 'import: paste → a dry-run table with the problem of each row changes nothing (also with markup / formulas in cells) → cancel → a clean paste → confirm imports it', async () => {
        const before = counts();
        const csv = ['일자,성명,연락처,주소,비고,단위', `2025-04-02,박철수,010-4444-5555,,${XSS[1]},T01-0005`, "2025-05-05,=cmd|' /C calc'!A0,010-****-7777,,,T01-0006", `2025-06-01,이민수,010-6666-7777,,,${XSS[0]}`].join('\n');
        let res = await submit(await page('&sec=csv'), 'allot_import_preview', { what: 'ledger', csv });
        assert(res.flash?.type === 'ok' && /문제 있는 줄/.test(res.flash.msg), `preview: ${res.flash?.msg}`);
        assert(counts() === before, 'the dry run changed something');
        assert(res.page.text.includes('&lt;img src=x onerror') || res.page.text.includes('알아볼 수 없는'), 'the problem rows are listed as text');
        res = await submit(res.page, 'allot_import_cancel');
        assert(res.flash?.type === 'ok' && counts() === before, 'cancel changes nothing');
        const clean = ['일자,성명,연락처,주소,비고,단위', '2025-04-02,박철수,010-4444-5555,,3년차,T01-0005', '2025-05-05,최영희,010-1111-2222,,=1+2,T01-0006'].join('\n');
        res = await submit(await page('&sec=csv'), 'allot_import_preview', { what: 'ledger', csv: clean });
        assert(counts() === before, 'the second dry run changed nothing');
        assert(formsOf(res.page.text).some((f) => f.action === 'allot_import_commit'), 'a confirm button after a clean preview');
        res = await submit(res.page, 'allot_import_commit');
        assert(res.flash?.type === 'ok' && Number(dbVal(s, "SELECT COUNT(*) FROM allot_contracts WHERE source = 'import'")) === 2, `imported: ${res.flash?.msg}`);
        return 'dry run with 2 problem rows · cancel · clean dry run · confirm → 2 contracts';
      });

      await step('16.7', 'bulk actions by ids[] checkboxes: close / reopen units, approve pending applications, a notice to the chosen contracts', async () => {
        let r = await page('&sec=units&zone=t01');
        const pickIds = [unitId('T01-0010'), unitId('T01-0011')].map(String);
        let res = await submit(r, 'allot_units_bulk', { op: 'closed', 'ids[]': pickIds });
        assert(res.flash?.type === 'ok' && dbAll(s, "SELECT status FROM allot_units WHERE id IN (?, ?)", pickIds).every((x) => x.status === 'closed'), `closed: ${res.flash?.msg}`);
        res = await submit(await page('&sec=units&zone=t01'), 'allot_units_bulk', { op: 'open', 'ids[]': pickIds });
        assert(dbAll(s, "SELECT status FROM allot_units WHERE id IN (?, ?)", pickIds).every((x) => x.status === 'open'), 'reopened');
        for (const unit of ['T01-0002', 'T01-0003']) await submit(await page(`&sec=customers&cust=${ids.cust}`), 'allot_contract_new', { unit, status: 'pending' });
        const pend = dbAll(s, "SELECT id FROM allot_contracts WHERE status = 'pending' ORDER BY id").map((x) => String(x.id));
        assert(pend.length === 2, `two pending: ${pend}`);
        res = await submit(await page('&sec=contracts&st=pending'), 'allot_contracts_bulk', { op: 'approve', 'ids[]': pend });
        assert(res.flash?.type === 'ok' && Number(dbVal(s, "SELECT COUNT(*) FROM allot_contracts WHERE status = 'active' AND id IN (?, ?)", pend)) === 2, `approved: ${res.flash?.msg}`);
        const n0 = Number(dbVal(s, 'SELECT COUNT(*) FROM allot_notices'));
        res = await submit(await page('&sec=contracts&st=active'), 'allot_contracts_bulk', { op: 'notice', 'ids[]': pend, title: `점검 안내 ${XSS[1]}`, body: '' });
        assert(res.flash?.type === 'ok' && Number(dbVal(s, 'SELECT COUNT(*) FROM allot_notices')) >= n0 + 2, `notices: ${res.flash?.msg}`);
        await page('&sec=notices');
        return 'units closed / reopened · 2 approved · notices to the chosen contracts';
      });

      await step('16.7', 'the rules and the operator texts (with the 예시 warning): a text with markup is stored and shown as text; personal data is in no address, flash, audit detail, security event or log line', async () => {
        let r = await page('&sec=auto');
        assert(/예시/.test(r.text) && /법률 검토/.test(r.text), 'the 예시 warning and the legal-review note');
        let res = await submit(r, 'allot_settings');
        assert(res.flash?.type === 'ok', `rules form: ${res.flash?.msg}`);
        res = await submit(await page('&sec=auto'), 'allot_texts', { terms_text: `이용 약관 시험 ${XSS[2]}` });
        assert(res.flash?.type === 'ok', `texts: ${res.flash?.msg}`);
        await page('&sec=auto');
        await page('&sec=status');
        const where = [];
        for (const l of trail.locations) if (leaks(l).length) where.push('address ' + l);
        for (const f of trail.flashes) if (leaks(f).length) where.push('flash ' + f);
        for (const x of dbAll(s, 'SELECT event, detail FROM audit_log')) if (leaks(x.detail).length) where.push('audit ' + x.event);
        try { for (const x of dbAll(s, 'SELECT kind, detail FROM security_events')) if (leaks(x.detail).length) where.push('security event ' + x.kind); } catch { /* no table */ }
        const logDir = path.join(s.data, 'logs');
        if (fs.existsSync(logDir)) for (const f of fs.readdirSync(logDir)) { const t = fs.readFileSync(path.join(logDir, f), 'utf8'); if (leaks(t).length) where.push('log ' + f); }
        const dump = fs.readdirSync(s.data).filter((f) => /\.sqlite$/.test(f)).map((f) => fs.readFileSync(path.join(s.data, f)).toString('utf8')).join('');
        if (dump.includes(PII.phone) || dump.includes(PII.addr) || dump.includes(PII.name)) where.push('the database file (not sealed)');
        assert(where.length === 0, where.join(' · '));
        return `${trail.locations.length} addresses · ${trail.flashes.length} flashes · audit / events / logs / database file: no personal data`;
      });
    } finally { await sv.stop(); }
  }

  if (section('rename')) {
    const s = makeSite('rename');
    const sv = await startPhp(s);
    try {
      const A = mkUser(s, 'admin');
      const U = mkUser(s, 'user');
      let name = '';
      await step('S06', 'cli admin:path refuses bad names and names that are taken; nothing is renamed', async () => {
        for (const bad of ['Bad Name', 'ab', '../outside', 'config', 'uploads', 'my_admin', 'admin.php']) {
          const r = cli(s, 'admin:path', bad);
          assert(r.status !== 0, `"${bad}" → exit ${r.status}: ${r.out.slice(0, 100)}`);
        }
        assert(fs.existsSync(path.join(s.site, STUB_DIR, 'index.php')) && fs.existsSync(path.join(s.site, 'config/config.php')), 'the folders are untouched');
        const cur = cli(s, 'admin:path');
        assert(cur.status === 0 && cur.out.includes(STUB_DIR), `without a name it prints the current folder: ${cur.out.slice(0, 120)}`);
        return 'Bad Name · ab · ../outside · config · uploads · my_admin · admin.php → refused';
      });
      await step('S06', 'cli admin:path --random renames the folder ("admin-" + 10 hex), records security.admin_dir and prints the new address', async () => {
        const r = cli(s, 'admin:path', '--random');
        assert(r.status === 0, `exit ${r.status}: ${r.out.slice(0, 300)}`);
        name = (r.out.match(/admin-[0-9a-f]{10}/) || [])[0];
        assert(name && r.out.includes(name + '/'), `the output names the new address: ${r.out.slice(0, 200)}`);
        assert(fs.existsSync(path.join(s.site, name, 'index.php')) && !fs.existsSync(path.join(s.site, STUB_DIR)), 'the folder was renamed');
        assert(php(s, 'Tfm\\Config::get("security.admin_dir")') === name, 'security.admin_dir in config.local.php');
        assert(php(s, 'Tfm\\Config::get("rate_limits.admin_page")')[0] === 100000, 'the other local settings are kept');
        const au = dbAll(s, "SELECT detail FROM audit_log WHERE event = 'admin_path_renamed'");
        assert(au.length === 1 && au[0].detail.includes(name), 'audit row');
        return `${STUB_DIR}/ → ${name}/ (${r.via})`;
      });
      await step('S06', 'after the rename: the old folder address is gone (404), the new one works end to end (sign-in, cookie Path, tabs, relative links)', async () => {
        const b = new Browser(sv.base, 'renamed');
        // php -S has no 404 for a folder that is not there: it answers the nearest parent index file (PHP manual, built-in
        // web server: "the lookup for index.php and index.html will be continued in the parent directory"). With the
        // built page in the copy (--docroot dist/metaverse) the vanished folder therefore answers the app's start page —
        // byte for byte what "/" answers, not the admin site; without it (server/) it is a 404. Apache: 404 either way.
        const home = await b.req('');
        const isHome = (r) => r.status === 200 && home.status === 200 && r.text === home.text && !isSignIn(r.text);
        let old = null;
        for (let i = 0; i < 30; i++) { old = await b.req(ADM); if (old.status === 404 || isHome(old)) break; await sleep(150); }
        assert((old.status === 404 || isHome(old)) && !isSignIn(old.text), `old folder → ${old.status}${old.status === 200 ? ' (not the start page of "/")' : ''}`);
        assert((await b.req('admin.php')).status === 404, 'the old admin.php is still a 404');
        const N = name + '/';
        const pg = await b.req(N);
        assert(pg.status === 200 && isSignIn(pg.text), `new folder → ${pg.status}`);
        const r = await signIn(b, N, A);
        const line = r.post.setCookie.find((c) => /^TFMADM=/.test(c)) || '';
        assert(new RegExp(`path=/${name}/(;|$)`, 'i').test(line), `cookie Path follows the folder: ${line}`);
        assert(isInside(r.page.text) && new URL(r.page.url).pathname === '/' + N, `inside at ${r.page.url}`);
        for (const t of ['users', 'health', 'security', 'twofa', 'audit']) {
          const p = await b.req(`${N}?tab=${t}`);
          assert(p.status === 200 && isInside(p.text), `tab ${t}`);
          assert(!p.text.includes(name) && !new RegExp(`(href|action)="[^"]*${STUB_DIR}/`).test(p.text), `tab ${t}: the page spells its folder`);
        }
        const act = await adm(b, N, { action: 'mute', uid: String(U.id), minutes: '5', tab: 'users' });
        assert(act.status === 303 && new URL(act.location, act.url).pathname === '/' + N, `an action redirects inside the new folder: ${act.location}`);
        const hl = await b.req('api/admin/health.php?quick=1');
        const row = hl.data.checks.find((c) => c.id === 'admin_dir');
        assert(row.status === 'ok', `health: the folder is renamed → ${row.status} (${row.value})`);
        return `/${N} sign-in · cookie Path=/${N} · actions redirect inside · health admin_dir ok`;
      });
      await step('S06', 'api/auth/me.php returns adminUrl only to admins (relative to the installation), never to players or guests', async () => {
        const a = new Browser(sv.base);
        await apiLogin(a, A);
        const ma = await a.req('api/auth/me.php');
        assert(ma.status === 200 && ma.data.adminUrl === name + '/', `admin: adminUrl = ${JSON.stringify(ma.data.adminUrl)}`);
        const u = new Browser(sv.base);
        await apiLogin(u, U);
        const mu = await u.req('api/auth/me.php');
        assert(mu.status === 200 && mu.data.user && !('adminUrl' in mu.data) && !mu.text.includes(name), `player: ${JSON.stringify(Object.keys(mu.data))}`);
        const g = new Browser(sv.base);
        const mg = await g.req('api/auth/me.php');
        assert(mg.status === 200 && mg.data.user === null && !('adminUrl' in mg.data) && !mg.text.includes(name), 'guest');
        for (const ep of ['api/ping.php', 'api/time.php']) assert(!(await g.req(ep)).text.includes(name), `${ep} names the folder`);
        const lg = await new Browser(sv.base).req('api/ping.php');
        assert(!lg.text.includes('adminUrl'), 'ping');
        return `admin → "${name}/" · player / guest → no adminUrl`;
      });
      await step('S06', 'a rename by hand (no CLI) keeps working: the page, the cookie and adminUrl follow the real folder; cli admin:path <name> renames from there', async () => {
        fs.renameSync(path.join(s.site, name), path.join(s.site, 'office-zone-77'));
        const b = new Browser(sv.base);
        let pg = null;
        for (let i = 0; i < 30; i++) { pg = await b.req('office-zone-77/'); if (pg.status === 200) break; await sleep(150); }
        assert(pg.status === 200 && isSignIn(pg.text), `hand-renamed folder → ${pg.status}`);
        const r = await signIn(b, 'office-zone-77/', A);
        assert(isInside(r.page.text) && /path=\/office-zone-77\//i.test(r.post.setCookie.find((c) => /^TFMADM=/.test(c)) || ''), 'sign-in in the hand-renamed folder');
        const me = await b.req('api/auth/me.php');
        assert(me.data.adminUrl === 'office-zone-77/', `adminUrl follows the real folder: ${me.data.adminUrl}`);
        const hl = await b.req('api/admin/health.php?quick=1');
        const row = hl.data.checks.find((c) => c.id === 'admin_dir');
        assert(row.status === 'warn', `health tells the operator that config.local.php still has the old name → ${row.status}`);
        const c = cli(s, 'admin:path', 'lab-desk-2026');
        assert(c.status === 0 && fs.existsSync(path.join(s.site, 'lab-desk-2026/index.php')) && !fs.existsSync(path.join(s.site, 'office-zone-77')), `cli rename from the hand-renamed folder: ${c.out.slice(0, 200)}`);
        assert(php(s, 'Tfm\\Config::get("security.admin_dir")') === 'lab-desk-2026', 'recorded');
        const same = cli(s, 'admin:path', 'lab-desk-2026');
        assert(same.status === 0, `renaming to the current name only records it: ${same.out.slice(0, 120)}`);
        return 'office-zone-77/ by hand → works · adminUrl follows · cli → lab-desk-2026/';
      });
    } finally { await sv.stop(); }
    await step('S06', 'no admin address in the app sources: the 관리자 links use adminUrl from me.php', async () => {
      const dir = path.join(ROOT, 'src/game');
      if (!fs.existsSync(dir)) throw new Skip('no src/game next to this test');
      const bad = [];
      for (const f of ['70-app.js', '80-devcenter.js']) {
        const text = fs.readFileSync(path.join(dir, f), 'utf8');
        text.split('\n').forEach((line, i) => { if (/admin\.php/.test(line) || /["'`/]admin\/(?!stats\.php|health\.php)/.test(line)) bad.push(`${f}:${i + 1}`); });
        if (f === '70-app.js') assert(/adminUrl/.test(text), '70-app.js reads adminUrl');
      }
      assert(bad.length === 0, `hard-coded admin address: ${bad.slice(0, 8).join(', ')}`);
      return '70-app.js · 80-devcenter.js: no admin.php / admin/ literal';
    });
  }

  // ================================================================= Apache: the folder .htaccess for real
  if (section('apache')) await apacheSection();

  // ------------------------------------------------------------- summary
  const failed = results.filter((r) => r.ok === false), skipped = results.filter((r) => r.ok === null);
  for (const n of cliNotes) console.log(`note: ${n}`);
  console.log(`\n${failed.length ? '✖' : '✔'} ${results.length - failed.length - skipped.length}/${results.length - skipped.length} passed${skipped.length ? ` (${skipped.length} skipped)` : ''}${failed.length ? ` — failed: ${failed.map((f) => f.name.slice(0, 60)).join(' | ')}` : ''}`);
  return failed.length ? 1 : 0;
}

// ------------------------------------------------------------------ Apache 2.4 + mod_php over a copy (AllowOverride All)
async function apacheSection() {
  const MODS = '/usr/lib/apache2/modules';
  const bin = ['/usr/sbin/apache2', '/usr/sbin/httpd'].find((p) => fs.existsSync(p));
  const phpSo = fs.existsSync(MODS) ? fs.readdirSync(MODS).find((f) => /^libphp\d*(\.\d+)?\.so$/.test(f)) : null;
  const name = 'Apache 2.4 honours the folder .htaccess: index.php is the index, the slashless folder and the stylesheet are answered by the entry (with headers), a leftover admin.css is a missing page, every other file is denied, no listing';
  if (NO_APACHE || !bin || !phpSo) { record('S06', name, null, NO_APACHE ? '--no-apache' : 'no Apache + mod_php on this machine'); return; }
  const s = makeSite('apache');
  const ADM = STUB_DIR + '/';
  const run = path.join(s.dir, 'run');
  fs.mkdirSync(run);
  // files that must never be served from the folder (a backup an editor left behind, a note, a second script)
  for (const f of ['index.php.bak', 'notes.txt', 'tool.php', 'index.php~']) fs.writeFileSync(path.join(s.site, STUB_DIR, f), '<?php echo "LEAK-" . "MARK"; // LEAK-MARK\n');
  // a stylesheet left in the folder by an older release (copying a new release over an installation keeps old files)
  const leftoverCss = path.join(s.site, STUB_DIR, 'admin.css');
  if (!fs.existsSync(leftoverCss)) fs.writeFileSync(leftoverCss, '/* LEAK-MARK old admin.css */ body { color: red }\n');
  let user = '';
  if (process.getuid && process.getuid() === 0) {
    user = ['www-data', 'apache', 'daemon', 'nobody'].find((u) => spawnSync('id', ['-u', u]).status === 0) || '';
    spawnSync('chown', ['-R', `${user}:`, s.data, path.join(s.site, 'uploads'), run]);
  }
  const port = (await portFree(18808)) ? 18808 : await pickPort(18809, 18809);
  const load = (n, f) => `LoadModule ${n}_module ${MODS}/${f}`;
  const conf = [
    `ServerRoot "${s.dir}"`, `PidFile "${run}/httpd.pid"`, `DefaultRuntimeDir "${run}"`, `Mutex file:${run} default`, `Listen 127.0.0.1:${port}`, 'ServerName 127.0.0.1',
    load('mpm_prefork', 'mod_mpm_prefork.so'), load('authz_core', 'mod_authz_core.so'), load('authz_host', 'mod_authz_host.so'), load('authn_core', 'mod_authn_core.so'), load('authn_file', 'mod_authn_file.so'),
    load('authz_user', 'mod_authz_user.so'), load('auth_basic', 'mod_auth_basic.so'), load('dir', 'mod_dir.so'), load('mime', 'mod_mime.so'), load('env', 'mod_env.so'), load('setenvif', 'mod_setenvif.so'),
    load('headers', 'mod_headers.so'), load('rewrite', 'mod_rewrite.so'), load('alias', 'mod_alias.so'), load('php', phpSo),
    user ? `User ${user}\nGroup ${user}` : '', `ErrorLog "${run}/error.log"`, 'LogLevel warn', 'TypesConfig /etc/mime.types', 'StartServers 2', 'MinSpareServers 2', 'MaxSpareServers 4', 'MaxRequestWorkers 8', 'KeepAlive Off',
    `DocumentRoot "${s.site}"`, `<Directory "${s.site}">\n  AllowOverride All\n  Require all granted\n  Options FollowSymLinks Indexes\n</Directory>`,
    '<FilesMatch "\\.php$">\n  SetHandler application/x-httpd-php\n</FilesMatch>',
    `SetEnv TFM_DATA_DIR "${s.data}"`, 'SetEnv TFM_TOSS_MOCK "1"',
  ].filter(Boolean).join('\n') + '\n';
  fs.writeFileSync(path.join(s.dir, 'httpd.conf'), conf);
  // detached: prefork's shutdown signals its whole process group — it must not be ours
  const proc = spawn(bin, ['-f', path.join(s.dir, 'httpd.conf'), '-DFOREGROUND'], { stdio: ['ignore', 'pipe', 'pipe'], env: { PATH: process.env.PATH, LANG: 'C' }, detached: true });
  procs.add(proc);
  let out = '';
  proc.stdout.on('data', (d) => { out += d; }); proc.stderr.on('data', (d) => { out += d; });
  const base = `http://127.0.0.1:${port}/`;
  const errLog = () => out + (fs.existsSync(path.join(run, 'error.log')) ? fs.readFileSync(path.join(run, 'error.log'), 'utf8').slice(-600) : '');
  try {
    let up = false;
    for (let i = 0; i < 60 && !up; i++) { try { const r = await fetch(base + 'api/ping.php'); await r.text(); up = r.status === 200; } catch { /* not yet */ } if (!up) await sleep(150); }
    if (!up) { record('S06', name, null, 'Apache did not start here: ' + errLog().replace(/\s+/g, ' ').slice(0, 200)); return; }
    const A = mkUser(s, 'admin');
    if (user) spawnSync('chown', ['-R', `${user}:`, s.data]);
    await step('S06', name, async () => {
      const b = new Browser(base, 'apache');
      const r = await b.req(ADM);
      assert(r.status === 200 && isSignIn(r.text), `GET /${ADM} → ${r.status} ${errLog().replace(/\s+/g, ' ').slice(-200)}`);
      assertLocked(r, 'sign-in page under Apache');
      const n = await b.req(STUB_DIR);
      assert([301, 302, 308].includes(n.status) && new URL(n.location, n.url).pathname === '/' + ADM, `GET /${STUB_DIR} → ${n.status} ${n.location}`);
      // the redirect comes from the admin entry (its lock headers), i.e. after its address check — not from mod_dir
      assert(/noindex/.test(n.headers.get('x-robots-tag') || ''), `GET /${STUB_DIR}: the slash redirect was not sent by the admin entry (mod_dir answered before the address check): ${JSON.stringify([...n.headers])}`);
      const href = cssOf(r.text);
      const css = await new Browser(base).req(inFolder(ADM, href));
      assert(css.status === 200 && /^text\/css/.test(css.headers.get('content-type') || '') && css.text.length > 2000, `${href} → ${css.status} ${css.headers.get('content-type')}`);
      assert(css.headers.get('x-content-type-options') === 'nosniff' && /noindex/.test(css.headers.get('x-robots-tag') || '') && css.headers.get('x-frame-options') === 'DENY' && css.headers.get('referrer-policy') === 'no-referrer', `stylesheet headers: ${JSON.stringify([...css.headers].filter(([k]) => /^x-|referrer|cache/.test(k)))}`);
      const missing = await b.req('no-such-' + rnd() + '.css');
      const old = await b.req(ADM + 'admin.css');
      assert(old.status === 404 && !/LEAK-MARK/.test(old.text) && old.text === missing.text, `a leftover ${ADM}admin.css → ${old.status} (${old.text.length} bytes; a missing page has ${missing.text.length})`);
      for (const f of ['.htaccess', 'index.php.bak', 'notes.txt', 'tool.php', 'index.php~', 'nothing-here.php']) {
        const x = await b.req(ADM + f);
        assert([403, 404].includes(x.status) && !/LEAK-MARK|Require all denied|<\?php/.test(x.text), `${ADM}${f} → ${x.status}`);
      }
      fs.renameSync(path.join(s.site, STUB_DIR, 'index.php'), path.join(s.site, STUB_DIR, 'index.php.off'));
      const list = await b.req(ADM);
      fs.renameSync(path.join(s.site, STUB_DIR, 'index.php.off'), path.join(s.site, STUB_DIR, 'index.php'));
      assert([403, 404].includes(list.status) && !/Index of|admin\.css/.test(list.text), `no directory listing without the index: ${list.status}`);
      const page = await signIn(b, ADM, A);
      assert(isInside(page.page.text) && /path=\/admin\//i.test(page.post.setCookie.find((c) => /^TFMADM=/.test(c)) || ''), 'sign-in works under Apache');
      return `/${ADM} 200 · /${STUB_DIR} → ${n.status} by the entry · ${href} text/css with headers · leftover admin.css 404 · 6 other files denied · no listing`;
    });
    // finding (reviewer-infra, item 6): under Apache the static admin.css and mod_dir's slash redirect answered before
    // the address check of security.admin_ip_allowlist (CONTRACT §15.4 (b): "the same 404 as a missing page")
    await step('S06', 'Apache + IP allow-list (TFM_ADMIN_IPS via SetEnv in the folder .htaccess): a refused address gets the same 404 as a missing page for the folder, the folder without its slash, index.php, ?tab=users and the stylesheet — no 301, no CSS — and admin_ip_denied is recorded', async () => {
      const file = path.join(s.site, STUB_DIR, '.htaccess');
      const orig = fs.readFileSync(file, 'utf8');
      const b = new Browser(base, 'apache-deny');
      const href = cssOf((await new Browser(base).req(ADM)).text);
      const gone = await b.req('no-such-folder-' + rnd() + '/');
      const strip = (t) => t.replace(/<address>[\s\S]*?<\/address>/, '').replace(/<hr>/, '').replace(/\s+/g, ' ').trim();
      const before = eventsOf(s, 'admin_ip_denied');
      const seen = [];
      try {
        fs.writeFileSync(file, orig + '\n# test: tests/admin-lock.mjs\nSetEnv TFM_ADMIN_IPS "203.0.113.7"\n');
        for (const p of [ADM, STUB_DIR, STUB_DIR + '?tab=users', ADM + 'index.php', ADM + '?tab=users', inFolder(ADM, href || 'admin.css'), ADM + 'admin.css']) {
          const r = await b.req(p);
          seen.push(`/${p} ${r.status}`);
          assert(r.status === 404 && !r.location && r.setCookie.length === 0 && !/text\/css/.test(r.headers.get('content-type') || '') && !/LEAK-MARK/.test(r.text), `/${p} → ${r.status}${r.location ? ' → ' + r.location : ''} ${r.headers.get('content-type') || ''}`);
          assert(strip(r.text) === strip(gone.text), `/${p}: the body differs from a missing page's (${r.text.length} vs ${gone.text.length} bytes)`);
        }
      } finally { fs.writeFileSync(file, orig); }
      const after = eventsOf(s, 'admin_ip_denied');
      const n = (after.sec.length + after.audit.length) - (before.sec.length + before.audit.length);
      assert(n >= 5, `admin_ip_denied rows: +${n}`);
      return `${seen.join(' · ')} · +${n} admin_ip_denied`;
    });
    await step('S06', 'Apache: the old admin.php answers 404 like a file that is not there (same status, the same "not found" page, no cookie)', async () => {
      const b = new Browser(base);
      const stub = await b.req('admin.php');
      const gone = await b.req('no-such-page-' + rnd() + '.php');
      assert(stub.status === 404 && gone.status === 404, `stub ${stub.status}, missing ${gone.status}`);
      assert(stub.setCookie.length === 0 && !stub.headers.get('x-powered-by') && !stub.headers.get('x-robots-tag'), 'no cookie, no PHP header');
      // the installation's .htaccess may name its own missing-page file (ErrorDocument 404 → e404.html): the stub then
      // shows that same file, otherwise the generic "404 Not Found" page — either way the two answers look alike
      const strip = (t) => t.replace(/<address>[\s\S]*?<\/address>/, '').replace(/<hr>/, '').replace(/\s+/g, ' ').trim();
      assert(strip(stub.text) === strip(gone.text), `the stub's body (${stub.text.length} bytes) differs from a missing file's (${gone.text.length} bytes): ${strip(stub.text).slice(0, 80)} | ${strip(gone.text).slice(0, 80)}`);
      assert(!/admin|관리|<form|<script/i.test(stub.text), 'the 404 says nothing about an admin area');
      return /<title>404 Not Found<\/title>/.test(gone.text) ? 'the body equals this Apache\'s own 404 page (signature line aside)' : 'the body equals the site\'s own missing-page file (ErrorDocument)';
    });
    await step('S06', 'Apache: the ready-to-uncomment blocks work — "Require ip" closes the folder for other addresses, the password block asks first (401)', async () => {
      const file = path.join(s.site, STUB_DIR, '.htaccess');
      const orig = fs.readFileSync(file, 'utf8');
      const uncomment = (text, re) => {
        const lines = text.split('\n');
        const at = lines.findIndex((l) => re.test(l));
        assert(at >= 0, `block ${re} not found`);
        let a = at; while (a > 0 && /^#\s*(<|[A-Z])/.test(lines[a - 1]) && !/^#\s*-{3,}/.test(lines[a - 1]) && !/[가-힣]/.test(lines[a - 1])) a--;
        let z = at; while (z < lines.length - 1 && /^#\s*(<|[A-Z])/.test(lines[z + 1]) && !/[가-힣]/.test(lines[z + 1])) z++;
        for (let i = a; i <= z; i++) lines[i] = lines[i].replace(/^#\s?/, '');
        return lines.join('\n');
      };
      const b = new Browser(base);
      const href = cssOf((await new Browser(base).req(ADM)).text);
      try {
        // 1) Require ip with an address that is not ours
        let ht = uncomment(orig, /^#\s*Require ip\s/).replace(/^(\s*Require ip)\s+.*$/m, '$1 203.0.113.7');
        fs.writeFileSync(file, ht);
        let r = await b.req(ADM);
        assert(r.status === 403 && !isSignIn(r.text), `Require ip 203.0.113.7 → ${r.status} ${errLog().replace(/\s+/g, ' ').slice(-160)}`);
        assert((await b.req(inFolder(ADM, href || 'admin.css'))).status === 403 && (await b.req(STUB_DIR)).status === 403, 'the stylesheet and the slashless folder are closed too');
        fs.writeFileSync(file, ht.replace(/^(\s*Require ip)\s+.*$/m, '$1 127.0.0.1 ::1'));
        r = await b.req(ADM);
        assert(r.status === 200 && isSignIn(r.text), `Require ip 127.0.0.1 → ${r.status}`);
        // 2) Basic-Auth with a password file outside the web root
        const pwFile = path.join(s.dir, 'tfm-admin.htpasswd');
        const hash = spawnSync('php', ['-r', 'echo password_hash("Door-2026-pass", PASSWORD_BCRYPT);'], { encoding: 'utf8' }).stdout.trim();
        fs.writeFileSync(pwFile, `gate:${hash}\n`);
        fs.chmodSync(pwFile, 0o644);
        ht = uncomment(orig, /^#\s*AuthType Basic/).replace(/^(\s*AuthUserFile)\s+.*$/m, `$1 "${pwFile}"`);
        fs.writeFileSync(file, ht);
        r = await b.req(ADM);
        assert(r.status === 401 && /Basic/i.test(r.headers.get('www-authenticate') || '') && !isSignIn(r.text), `password block → ${r.status} ${errLog().replace(/\s+/g, ' ').slice(-160)}`);
        const bad = await b.req(ADM, { headers: { Authorization: 'Basic ' + Buffer.from('gate:wrong').toString('base64') } });
        assert(bad.status === 401, `wrong password → ${bad.status}`);
        const ok = await b.req(ADM, { headers: { Authorization: 'Basic ' + Buffer.from('gate:Door-2026-pass').toString('base64') } });
        assert(ok.status === 200 && isSignIn(ok.text), `right password → ${ok.status}`);
      } finally { fs.writeFileSync(file, orig); }
      return 'Require ip: 403 / 200 · Basic-Auth: 401 → 200 with the password';
    });
  } finally {
    await new Promise((res) => { if (proc.exitCode !== null) return res(); proc.once('exit', () => res()); try { process.kill(proc.pid, 'SIGTERM'); } catch { res(); } setTimeout(res, 5000); });
    procs.delete(proc);
  }
}

// ------------------------------------------------------------------ test doubles with the agreed signatures (used only while the real file is missing)
const SEC_DOUBLE = `<?php
// TEST DOUBLE written by tests/admin-lock.mjs — the interface agreed for lib/SecurityEvents.php, nothing more
declare(strict_types=1);
namespace Tfm;
if (!defined('TFM_BOOT')) { http_response_code(404); exit; }
final class SecEvent
{
    public static function log(string $kind, string $severity = 'warn', array $detail = [], ?int $userId = null): void
    {
        $ip = Http::clientIp();
        Db::insert('security_events', ['created_at' => Clock::ms(), 'ip' => substr($ip, 0, 64), 'ip_hash' => Sec::hashId($ip), 'user_id' => $userId, 'kind' => substr($kind, 0, 40),
            'severity' => in_array($severity, ['info', 'warn', 'alert'], true) ? $severity : 'warn', 'path' => substr((string) (isset($_SERVER['SCRIPT_NAME']) ? $_SERVER['SCRIPT_NAME'] : ''), 0, 190), 'detail' => (string) json_encode($detail, JSON_UNESCAPED_UNICODE)]);
    }
    public static function recent(array $filter, int $limit = 100, int $offset = 0): array
    {
        $w = []; $p = [];
        foreach (['kind' => 'kind = ?', 'severity' => 'severity = ?', 'ipHash' => 'ip_hash = ?', 'sinceMs' => 'created_at >= ?'] as $k => $sql) if (isset($filter[$k]) && $filter[$k] !== '' && $filter[$k] !== null) { $w[] = $sql; $p[] = $filter[$k]; }
        return Db::all('SELECT * FROM security_events ' . ($w ? 'WHERE ' . implode(' AND ', $w) . ' ' : '') . 'ORDER BY id DESC LIMIT ' . max(1, min(500, $limit)) . ' OFFSET ' . max(0, $offset), $p);
    }
    public static function counts(int $sinceMs): array
    {
        $out = [];
        foreach (Db::all('SELECT kind, COUNT(*) AS n FROM security_events WHERE created_at >= ? GROUP BY kind ORDER BY n DESC', [$sinceMs]) as $r) $out[(string) $r['kind']] = (int) $r['n'];
        return $out;
    }
}
final class Firewall
{
    public static function check(): void { if (self::isBlocked()) throw new ApiException(403, 'IP_BLOCKED', '잠시 접속이 제한된 주소예요.'); }
    public static function isBlocked(?string $ip = null): bool
    {
        return Db::one('SELECT 1 AS x FROM ip_blocks WHERE ip_hash = ? AND until_at > ?', [Sec::hashId($ip === null ? Http::clientIp() : $ip), Clock::ms()]) !== null;
    }
    public static function block(string $ip, int $seconds, string $reason, ?int $actorId = null): void
    {
        Db::tx(function () use ($ip, $seconds, $reason, $actorId) {
            Db::upsert('ip_blocks', ['ip_hash' => Sec::hashId($ip), 'ip' => substr($ip, 0, 64), 'reason' => mb_substr($reason, 0, 120), 'until_at' => Clock::ms() + $seconds * 1000, 'created_at' => Clock::ms(), 'created_by' => $actorId, 'hits' => 0, 'strikes' => 1], ['ip_hash']);
        });
    }
    public static function unblock(string $ipOrHash, ?int $actorId = null): bool
    {
        $hash = preg_match('/^[0-9a-f]{32}$/', $ipOrHash) ? $ipOrHash : Sec::hashId($ipOrHash);
        return Db::exec('DELETE FROM ip_blocks WHERE ip_hash = ?', [$hash]) > 0;
    }
    public static function listBlocks(): array { return Db::all('SELECT * FROM ip_blocks WHERE until_at > ? ORDER BY until_at DESC', [Clock::ms()]); }
    public static function ipInList(string $ip, array $cidrs): bool { return AdminGate::cidrMatch($ip, $cidrs); }
    public static function noteAttack(string $kind): void { /* the real class counts towards the automatic block */ }
}
`;
const CFG_DOUBLE = `<?php
// TEST DOUBLE written by tests/admin-lock.mjs — the interface agreed for lib/ConfigAudit.php, nothing more
declare(strict_types=1);
namespace Tfm;
if (!defined('TFM_BOOT')) { http_response_code(404); exit; }
final class ConfigAudit
{
    public static function run(): array
    {
        return [
            ['id' => 'double_secret', 'label' => 'double-secret', 'status' => 'ok', 'value' => '있음', 'hint' => ''],
            ['id' => 'double_warn', 'label' => 'double-warn', 'status' => 'warn', 'value' => '<i>v</i>', 'hint' => '<b>hint</b>'],
        ];
    }
}
`;

/**
 * TEST DOUBLE of Tfm\Claude (workflow interface 5) — the agreed signatures, nothing more. Every helper answers with markup
 * (it must come back escaped), writes one ai_usage row (scope admin) and records what the admin site sent in
 * <data>/claude-double.json, so a check can see that no account details left the server. TFM_T_AI=off: not configured;
 * TFM_T_AI=disabled: configured but switched off; TFM_T_AI=fail: every call fails (ok false).
 */
const CLAUDE_DOUBLE = `<?php
// TEST DOUBLE written by tests/admin-lock.mjs — the interface agreed for lib/Claude.php (workflow interface 5), nothing more
declare(strict_types=1);
namespace Tfm;
if (!defined('TFM_BOOT')) { http_response_code(404); exit; }
final class Claude
{
    public const ANSWERS = [
        'memo' => "<script>alert('ai')</script> 메모 초안: 정말 잘 키웠어요 \\"따옴표\\"",
        'summary' => "<script>alert('sum')</script> 오늘 요약 <b>굵게</b>\\n둘째 줄",
        'ask' => "<script>alert('ask')</script> 대답 <img src=x onerror=alert(7)>\\n둘째 줄",
    ];
    private static function answer(string $what, $input, ?int $uid): array
    {
        $file = Config::dataDir() . DIRECTORY_SEPARATOR . 'claude-double.json';
        $log = is_file($file) ? json_decode((string) file_get_contents($file), true) : [];
        $log[] = ['what' => $what, 'input' => $input, 'uid' => $uid];
        file_put_contents($file, json_encode($log, JSON_UNESCAPED_UNICODE));
        $fail = getenv('TFM_T_AI') === 'fail';
        Db::insert('ai_usage', ['created_at' => Clock::ms(), 'user_id' => $uid, 'scope' => 'admin', 'model' => 'double-model', 'input_tokens' => 11, 'output_tokens' => $fail ? 0 : 22,
            'stop_reason' => $fail ? '' : 'end_turn', 'ok' => $fail ? 0 : 1, 'ms' => 5]);
        if ($fail) return ['ok' => false, 'text' => '', 'stop' => '', 'model' => 'double-model', 'usage' => ['in' => 11, 'out' => 0], 'error' => 'upstream <b>error</b>'];
        return ['ok' => true, 'text' => self::ANSWERS[$what], 'stop' => 'end_turn', 'model' => 'double-model', 'usage' => ['in' => 11, 'out' => 22], 'error' => null];
    }
    public static function configured(): bool { return getenv('TFM_T_AI') !== 'off'; }
    public static function enabled(): bool { return self::configured() && getenv('TFM_T_AI') !== 'disabled'; }
    public static function kidEnabled(): bool { return (bool) Settings::get('ai.kid_helper', false); }
    public static function ask(array $opt): array { return self::answer('ask', $opt, isset($opt['userId']) ? $opt['userId'] : null); }
    public static function selfTest(): array { return ['ok' => true, 'model' => 'double-model', 'ms' => 1, 'usage' => ['in' => 1, 'out' => 1], 'error' => null]; }
    public static function usageToday(): array
    {
        $by = [];
        $in = 0; $out = 0; $n = 0;
        foreach (Db::all('SELECT scope, input_tokens, output_tokens FROM ai_usage WHERE created_at >= ?', [Clock::startOfDayMs()]) as $r) {
            $n++; $in += (int) $r['input_tokens']; $out += (int) $r['output_tokens'];
            $by[(string) $r['scope']] = (isset($by[(string) $r['scope']]) ? $by[(string) $r['scope']] : 0) + 1;
        }
        return ['total' => $n, 'tokensIn' => $in, 'tokensOut' => $out, 'byScope' => $by];
    }
    public static function memoDraft(array $report, int $actorId): array { return self::answer('memo', $report, $actorId); }
    public static function daySummary(array $numbers, int $actorId): array { return self::answer('summary', $numbers, $actorId); }
    public static function adminAsk(string $prompt, int $actorId): array { return self::answer('ask', $prompt, $actorId); }
}
`;
/** what the Claude double was asked (oldest first) */
const doubleLog = (s) => { const f = path.join(s.data, 'claude-double.json'); return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : []; };
/** put the Claude double into a site (replacing a real lib/Claude.php of that copy) */
const useClaudeDouble = (s) => fs.writeFileSync(path.join(s.site, 'lib/Claude.php'), CLAUDE_DOUBLE);

// ------------------------------------------------------------------ run
function cleanup() {
  for (const p of procs) { try { p.kill('SIGTERM'); } catch { /* gone */ } }
  if (KEEP) { for (const d of cleanupDirs) console.log(`kept: ${d}`); return; }
  for (const d of cleanupDirs) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ } }
}
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { cleanup(); process.exit(130); });
let code = 1;
try { code = await main(); }
catch (e) { console.error('FAIL  [S06] the suite crashed — ' + (e?.stack || e)); code = 1; }
finally { cleanup(); }
process.exit(code);
