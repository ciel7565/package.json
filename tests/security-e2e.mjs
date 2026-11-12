#!/usr/bin/env node
// =============================================================================
// 전통발효체험관 메타버스 — black-box security suite (CONTRACT §15.7, items 1–16 and 19)
//
//   node tests/security-e2e.mjs [--apache] [--only S05,S11] [--json out.json] [--verbose] [--docroot <dir>] [--keep]
//
//   Attacks the server from the outside, the way a visitor (or a scanner) would: nothing is included from server/,
//   only the documented API (README-SERVER §6), the HTML pages and — for the checks that need it — the database
//   file / table and the operator's CLI are looked at.
//   The suite spawns its own `php -S 127.0.0.1:<port> -t dist/metaverse` instances (ports 18710–18729), each with a
//   throw-away TFM_DATA_DIR and TFM_TOSS_MOCK=1, one instance per configuration a check needs (TFM_FORCE_HTTPS,
//   TFM_CORS_ORIGINS, TFM_ADMIN_IPS, TFM_ADMIN_2FA, TFM_ADMIN_IDLE, TFM_SESSION_IDLE, TFM_ENV, TFM_TRUSTED_PROXIES …).
//   Their PHP ini is hostile on purpose (display_errors=1, expose_php=1): the application itself has to keep error
//   text and version banners out of every answer.
//   --apache    also starts Apache 2.4 + mod_php on 127.0.0.1:18780 over a private copy of the docroot (AllowOverride
//               All, stock ServerTokens / ServerSignature / TraceEnable, the copy is also mounted as /metaverse/) and
//               runs the .htaccess-dependent checks.
//   --only      comma separated items (S01 … S16, S19)
//   --json      writes [{item, check, status: pass|gap|skipped|info, severity, evidence, fixProposal, contract, mode}]
//   --keep      keep the temp directories (debugging)
//   env         TFM_DB_DRIVER=mysql TFM_DB_HOST/PORT/USER/PASS → every instance runs on MySQL / MariaDB (a fresh
//               database tfm_secbb_<name> each, dropped afterwards). The S01 checks need a MariaDB that answers at
//               TFM_DB_HOST:TFM_DB_PORT (default 127.0.0.1:33106, root without a password); they are skipped otherwise.
//
//   Output: one line per check — "PASS  [S05] name" / "FAIL  [S05] name — detail" ("SKIP" when a precondition is
//   missing, "INFO" for observations that are not judged) — then a per-item summary. Exit code 1 when a check fails.
//   Record a run for the tdd guard:  node tools/tdd-report.mjs tests/security-e2e.mjs -- node tests/security-e2e.mjs
//
//   A check passes only when the protection is observed. Requirements that are not implemented yet FAIL on purpose
//   (they drive the fixes): never relax an assertion to turn a line green.
// =============================================================================
import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const optv = (n) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : null; };
const APACHE = flag('--apache');
const VERBOSE = flag('--verbose');
const KEEP = flag('--keep');
const ONLY = optv('--only') ? new Set(optv('--only').toUpperCase().split(',').map((s) => s.trim()).filter(Boolean)) : null;
const JSON_OUT = optv('--json');
const DOCROOT = path.resolve(optv('--docroot') || path.join(ROOT, 'dist/metaverse'));
// several runs at the same time (parallel agents / CI jobs): give each run its own range
const PORT_BASE = Number(process.env.TFM_SEC_PORT_BASE) || 18710;
const PHP_PORTS = Array.from({ length: 20 }, (_, i) => PORT_BASE + i);
const APACHE_PORT = Number(process.env.TFM_SEC_APACHE_PORT) || 18780;
const APACHE_MODULES = '/usr/lib/apache2/modules';
const DRIVER = process.env.TFM_DB_DRIVER === 'mysql' ? 'mysql' : 'sqlite';
const MY = { host: process.env.TFM_DB_HOST || '127.0.0.1', port: Number(process.env.TFM_DB_PORT || 33106), user: process.env.TFM_DB_USER || 'root', pass: process.env.TFM_DB_PASS || '' };
// databases / accounts of MariaDB mode carry this prefix; parallel runs (one per agent) set their own: TFM_SEC_DB_PREFIX=tfm_data
const DB_PREFIX = /^[a-z][a-z0-9_]{2,20}$/.test(process.env.TFM_SEC_DB_PREFIX || '') ? process.env.TFM_SEC_DB_PREFIX : 'tfm_secbb';
const RUN = crypto.randomBytes(4).toString('hex');
const TAG = String(parseInt(RUN, 16) % 100).padStart(2, '0'); // digits only: random hex can spell words the nickname rules refuse
const PASSWORD = 'Ferment2026ok';
const ADMIN_EMAIL = `secadmin_${RUN}@example.com`;
const ADMIN2_EMAIL = `secadmin2_${RUN}@example.com`;
const ADMINS = `${ADMIN_EMAIL},${ADMIN2_EMAIL}`;
const PUB_HOST = 'play.example.test';
const HTML = { Accept: 'text/html' };
const PHP_VERSION = (() => { try { return String(spawnSync('php', ['-r', 'echo PHP_VERSION;'], { encoding: 'utf8' }).stdout || '').trim(); } catch { return ''; } })();

/** the CONTRACT §15.7 row each item enforces */
const ITEMS = {
  S01: '§15.7 #1 DB locked', S02: '§15.7 #2 HTTPS forced', S03: '§15.7 #3 server-side validation', S04: '§15.7 #4 XSS blocked',
  S05: '§15.7 #5 suspicious activity logged + watched', S06: '§15.7 #6 admin path locked (§15.4)', S07: '§15.7 #7 parameterized queries',
  S08: '§15.7 #8 environment / config safe', S09: '§15.7 #9 rate limits', S10: '§15.7 #10 CORS narrowed', S11: '§15.7 #11 security headers',
  S12: '§15.7 #12 session cookies', S13: '§15.7 #13 CSRF', S14: '§15.7 #14 upload type / size', S15: '§15.7 #15 price / amount checked on the server',
  S16: '§15.7 #16 debug off in production', S19: '§15.7 #19 no exposed files',
};

// ------------------------------------------------------------------ result bookkeeping
const tty = process.stdout.isTTY;
const paint = (n) => (s) => (tty ? `\x1b[${n}m${s}\x1b[0m` : String(s));
const C = { g: paint(32), r: paint(31), y: paint(33), c: paint(36), d: paint(2), b: paint(1) };
const RESULTS = [];
const NAMES = new Set();
class Fail extends Error {}
class Skip { constructor(why) { this.why = why; } }
const skip = (why) => new Skip(why);
function assert(cond, msg) { if (!cond) throw new Fail(msg); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const oneLine = (s, max = 700) => String(s).replace(/\s+/g, ' ').trim().slice(0, max);
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const want = (item) => !ONLY || ONLY.has(item);

function emit(rec) {
  RESULTS.push(rec);
  const tagOf = { pass: C.g('PASS'), gap: C.r('FAIL'), skipped: C.y('SKIP'), info: C.c('INFO') };
  console.log(`${tagOf[rec.status]}  [${rec.item}] ${rec.check}${rec.evidence ? C.d('  — ' + rec.evidence) : ''}`);
}
/**
 * One check = one output line. fn returns a string (evidence for a pass), skip('why'), or throws (the protection was
 * not observed). meta: {sev: severity when it fails, fix: proposal, mode: where it ran}.
 */
async function check(item, name, meta, fn) {
  if (!want(item)) return null;
  if (NAMES.has(name)) throw new Error('duplicate check name: ' + name);
  NAMES.add(name);
  const rec = { item, check: name, status: 'pass', severity: meta.sev || 'medium', evidence: '', fixProposal: meta.fix || '', contract: ITEMS[item] || '', mode: meta.mode || `php -S · ${DRIVER}` };
  try {
    const r = await fn();
    if (r instanceof Skip) { rec.status = 'skipped'; rec.evidence = r.why; } else rec.evidence = typeof r === 'string' ? r : '';
  } catch (e) {
    rec.status = 'gap';
    rec.evidence = e instanceof Fail ? e.message : `${e && e.name ? e.name : 'Error'}: ${e && e.message ? e.message : e}`;
    if (VERBOSE && !(e instanceof Fail)) console.error(e);
  }
  rec.evidence = oneLine(rec.evidence);
  emit(rec);
  return rec;
}
function info(item, text) { if (want(item)) emit({ item, check: text, status: 'info', severity: 'low', evidence: '', fixProposal: '', contract: ITEMS[item] || '', mode: 'information' }); }

// ------------------------------------------------------------------ processes, temp directories, cleanup
const CHILDREN = new Set();
const TMP = new Set();
const UPLOADS = [];            // [docroot, 'uploads/journal/…'] written by upload checks into a docroot that is not a temp copy
const DROP_DBS = new Set();
const DROP_USERS = new Set();
const TMP_PREFIX = path.join(os.tmpdir(), 'tfm-sec-');
function mkTmp(name) { const d = fs.mkdtempSync(TMP_PREFIX + name + '-'); TMP.add(d); return d; }
function rmTmp(d) {
  TMP.delete(d);
  if (KEEP || !d.startsWith(TMP_PREFIX)) return;
  try { fs.rmSync(d, { recursive: true, maxRetries: 2 }); } catch { /* already gone */ }
}
function removeUpload(root, rel) {
  try { fs.unlinkSync(path.join(root, rel)); } catch { /* ignore */ }
  const stop = path.join(root, 'uploads');
  let d = path.dirname(path.join(root, rel));
  while (d.startsWith(stop + path.sep) && d !== stop) { try { fs.rmdirSync(d); } catch { break; } d = path.dirname(d); }
}
let cleaned = false;
function cleanup() {
  if (cleaned) return;
  cleaned = true;
  for (const c of CHILDREN) { try { process.kill(c.pid, 'SIGTERM'); } catch { /* gone */ } }
  for (const [root, rel] of UPLOADS) removeUpload(root, rel);
  for (const d of [...TMP]) rmTmp(d);
  try {
    const stmts = [...DROP_DBS].map((d) => `DROP DATABASE IF EXISTS \`${d}\``).concat([...DROP_USERS].map((u) => `DROP USER IF EXISTS ${u}`));
    if (stmts.length) mysqlRoot(stmts);
  } catch { /* the database server went away */ }
}
process.on('exit', cleanup);
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => { cleanup(); process.exit(130); });

// ------------------------------------------------------------------ HTTP (node:http — full control over Host, methods, raw paths)
function rawRequest(base, p, o = {}) {
  const u = new URL(p, base);
  const headers = { Accept: 'application/json', ...(o.headers || {}) };
  for (const k of Object.keys(headers)) if (headers[k] === null || headers[k] === undefined) delete headers[k];
  let body = o.body;
  if (typeof body === 'string') body = Buffer.from(body, 'utf8');
  if (body && headers['Content-Length'] === undefined) headers['Content-Length'] = String(body.length);
  const method = o.method || (body ? 'POST' : 'GET');
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const req = http.request({ host: u.hostname, port: u.port, path: o.rawPath || (u.pathname + u.search), method, headers, agent: false }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        const text = buf.toString('utf8');
        let json = null;
        try { json = JSON.parse(text); } catch { /* not JSON */ }
        const h = {};
        for (const [k, v] of Object.entries(res.headers)) h[k] = Array.isArray(v) ? v.join(', ') : String(v);
        resolve({ status: res.statusCode, headers: h, setCookie: res.headers['set-cookie'] || [], buf, text, json, data: json && json.data, error: json && json.error, ms: Date.now() - t0, url: u.href, method, path: o.rawPath || (u.pathname + u.search) });
      });
    });
    req.on('error', reject);
    req.setTimeout(o.timeout || 30000, () => req.destroy(new Error(`timeout: ${method} ${u.href}`)));
    if (body) req.write(body);
    req.end();
  });
}

// what every answer of the run is scanned for (the "global" checks at the end read these lists)
const TRAFFIC = { n: 0, jsonRaw: [], noCsp: [], sql: [], secrets: [], docKey: [], debug: [], phpinfo: [] };
// sha256 of the two public payment documentation sample keys (the literals must not live in the tree: CONTRACT §15.7 #8 / #20)
const DOC_KEY_DIGESTS = new Set(['ec1393ef0fce194e6bad234a8445cb7196048b6470bc36636eeba4148aa50030', '587dc23841794a4259bfbab17611c1a37a71e70a8ca2c82237539dc2e38d8bb3']);
const KEY_TOKEN_RX = /(?:test|live)_g?[cs]k_[A-Za-z0-9]{8,}/g;
const SECRET_RX = [
  [/(?:test|live)_g?sk_[A-Za-z0-9]{8,}/, 'a payment secret key'],
  [/sk-ant-[A-Za-z0-9_-]{8,}/, 'an Anthropic API key'],
  [/\$argon2i?d?\$v=\d+\$|\$2[aby]\$\d\d\$[./A-Za-z0-9]{20,}/, 'a password hash'],
  [/-----BEGIN (?:[A-Z]+ )*PRIVATE KEY-----/, 'a private key'],
];
const SQL_ERR_RX = /SQLSTATE\[|PDOException|SQL syntax|syntax error at or near|no such table|no such column|unrecognized token|MariaDB server version|General error: \d|Integrity constraint violation/i;
const DEBUG_RX = [
  [/Stack trace:|#\d+ +\S+\.php\(\d+\)/, 'a stack trace'],
  [/(?:Fatal error|Parse error|Warning|Notice|Deprecated)(?:<\/b>)?: /, 'PHP error text'],
  [/Uncaught \w+|(?:Error|Exception) in \S+\.php/, 'an uncaught exception'],
  [/ on line (?:<b>)?\d+/, 'the file / line of a PHP message'],
];
const PRIVATE_DIR_RX = /^(?:lib|config|data|database|cli)\//;
function serverSecrets(s) {
  if (!s) return [];
  if (!s.secrets || !s.secrets.length) {
    const out = [];
    try {
      const txt = fs.readFileSync(path.join(s.dataDir, 'secret.php'), 'utf8');
      for (const m of txt.matchAll(/'(\w+)'\s*=>\s*'([^']{16,})'/g)) if (!['created', 'db_file'].includes(m[1])) out.push([m[2], `data/secret.php → ${m[1]}`]);
      const dbf = txt.match(/'db_file'\s*=>\s*'([^']+)'/);
      if (dbf) out.push([dbf[1], 'the database file name']);
    } catch { /* not created yet */ }
    if (s.env && s.env.TFM_DB_PASS && s.env.TFM_DB_PASS.length >= 8) out.push([s.env.TFM_DB_PASS, 'the database password']);
    s.secrets = out;
  }
  return s.secrets;
}
function debugLeaks(text, s) {
  const out = [];
  for (const [rx, what] of DEBUG_RX) if (rx.test(text)) out.push(what);
  if (PHP_VERSION && new RegExp(`(?<![\\d.])${PHP_VERSION.replace(/\./g, '\\.')}(?![\\d.])`).test(text)) out.push(`the PHP version ${PHP_VERSION}`);
  for (const p of s ? s.paths : []) if (p && text.includes(p)) out.push(`the server path ${p}`);
  return out;
}
function inspect(res, client, o) {
  TRAFFIC.n++;
  const s = client ? client.srv : null;
  const u = new URL(res.url);
  const rel = s ? u.pathname.slice(new URL(s.base).pathname.length) : u.pathname.replace(/^\//, '');
  const ct = res.headers['content-type'] || '';
  const where = `${res.method} ${s ? s.name + ':' : ''}${rel}${u.search.slice(0, 50)} → ${res.status}`;
  const dynamic = o.dynamic !== undefined ? o.dynamic : (/\.php(?:\/|$)/.test(u.pathname) || (/application\/json/.test(ct) && !/\.json$/.test(u.pathname)));
  const text = dynamic || res.buf.length < 2000000 ? res.text : '';
  if (/phpinfo\(\)|<title>PHP \d+\.\d+|PHP Version \d|Zend Engine v\d/.test(text)) TRAFFIC.phpinfo.push(where);
  if (!dynamic) return;
  const head = JSON.stringify(res.headers);
  if (/application\/json/.test(ct)) {
    const i = text.search(/[<>&']/);
    if (i >= 0) TRAFFIC.jsonRaw.push(`${where}: …${oneLine(text.slice(Math.max(0, i - 30), i + 30), 70)}…`);
  }
  if (!res.headers['content-security-policy'] && ![404, 501].includes(res.status) && !PRIVATE_DIR_RX.test(rel)) TRAFFIC.noCsp.push(where);
  for (const [val, what] of serverSecrets(s)) if (text.includes(val) || head.includes(val)) TRAFFIC.secrets.push(`${where}: ${what}`);
  for (const [rx, what] of SECRET_RX) if (rx.test(text) || rx.test(head)) TRAFFIC.secrets.push(`${where}: ${what}`);
  for (const m of text.matchAll(KEY_TOKEN_RX)) if (DOC_KEY_DIGESTS.has(sha256(m[0]))) { TRAFFIC.docKey.push(where); break; }
  if (SQL_ERR_RX.test(text)) TRAFFIC.sql.push(where);
  // an admin reading the diagnostics, and the installer before it is locked, legitimately show versions
  const diag = o.diag || (client && client.admin && /admin|health|inspect|stats/.test(rel)) || (rel === 'install.php' && res.status === 200);
  if (diag) return;
  for (const what of debugLeaks(text, s)) TRAFFIC.debug.push(`${where}: ${what}`);
  if (res.headers['x-powered-by'] && !PRIVATE_DIR_RX.test(rel)) TRAFFIC.debug.push(`${where}: X-Powered-By: ${res.headers['x-powered-by']}`);
}

const safeDecode = (v) => { try { return decodeURIComponent(v); } catch { return v; } };
const formEncode = (o) => Object.entries(o).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
/** cookie jar + CSRF token + default headers of one browser */
class Client {
  constructor(srv, o = {}) {
    this.srv = srv; this.jar = new Map(); this.csrf = null; this.admin = false; this.user = null;
    this.ua = o.ua || 'tfm-security-e2e/1.0'; this.xff = o.xff || null; this.headers = o.headers || {};
  }
  cookieHeader() { return [...this.jar].map(([k, v]) => `${k}=${v}`).join('; '); }
  /** the session id (decoded), or null */
  sid() { const v = this.jar.get('TFMSESSID'); return v ? safeDecode(v) : null; }
  store(res) {
    for (const lineOf of res.setCookie) {
      const [pair, ...attrs] = lineOf.split(';');
      const i = pair.indexOf('=');
      if (i < 0) continue;
      const name = pair.slice(0, i).trim();
      const value = pair.slice(i + 1).trim();
      if (attrs.some((a) => /^\s*max-age=0/i.test(a)) || value === '' || value === 'deleted') this.jar.delete(name); else this.jar.set(name, value);
    }
  }
  /** o: {method, json, form, multipart:{fields,files}, body, headers, csrf:false|string, rawPath, timeout, diag, dynamic} */
  async req(p, o = {}) {
    const headers = { 'User-Agent': this.ua, ...this.headers, ...(this.xff ? { 'X-Forwarded-For': this.xff } : {}), ...(o.headers || {}) };
    if (this.jar.size && !('Cookie' in headers)) headers.Cookie = this.cookieHeader();
    let body = o.body;
    if (o.json !== undefined) { body = JSON.stringify(o.json); headers['Content-Type'] = 'application/json'; }
    else if (o.form) { body = formEncode(o.form); headers['Content-Type'] = 'application/x-www-form-urlencoded'; }
    else if (o.multipart) { const m = multipart(o.multipart.fields, o.multipart.files); body = m.body; headers['Content-Type'] = m.contentType; }
    const method = o.method || (body !== undefined ? 'POST' : 'GET');
    if (!['GET', 'HEAD', 'OPTIONS', 'TRACE'].includes(method) && o.csrf !== false && !('X-CSRF-Token' in headers)) {
      const tok = typeof o.csrf === 'string' ? o.csrf : this.csrf;
      if (tok) headers['X-CSRF-Token'] = tok;
    }
    const res = await rawRequest(this.srv.base, p, { ...o, method, headers, body });
    this.store(res);
    if (res.json && typeof res.json.csrf === 'string') this.csrf = res.json.csrf;
    inspect(res, this, o);
    if (VERBOSE) console.log(C.d(`   ${this.srv.name} ${method} ${p} → ${res.status} ${oneLine(res.text, 160)}`));
    return res;
  }
  /** POST a JSON body with this browser's CSRF token */
  json(p, body, o = {}) { return this.req(p, { ...o, json: body }); }
}
/** one request without cookies */
function request(srv, p, o = {}) { return new Client(srv, { xff: o.xff }).req(p, o); }
/** follow redirects of an HTML page flow (PRG) */
async function follow(c, res, max = 4) {
  let r = res;
  for (let i = 0; i < max && [301, 302, 303, 307, 308].includes(r.status) && r.headers.location; i++) {
    const u = new URL(r.headers.location, r.url);
    r = await c.req(u.pathname + u.search, { headers: HTML });
  }
  return r;
}

// ------------------------------------------------------------------ fixtures
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(buf) { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function pngChunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
const pngText = (key, value) => pngChunk('tEXt', Buffer.from(`${key}\0${value}`, 'latin1'));
/** a valid w×h PNG; claim = the size written into the header (dimension / pixel bombs) */
function makePng(w = 8, h = 8, extra = [], claim = null) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(claim ? claim[0] : w, 0); ihdr.writeUInt32BE(claim ? claim[1] : h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const rows = [];
  for (let y = 0; y < h; y++) { const r = Buffer.alloc(1 + w * 3); for (let x = 0; x < w; x++) { r[1 + x * 3] = 52; r[2 + x * 3] = 195; r[3 + x * 3] = 107; } rows.push(r); }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), pngChunk('IHDR', ihdr), ...extra, pngChunk('IDAT', zlib.deflateSync(Buffer.concat(rows))), pngChunk('IEND', Buffer.alloc(0))]);
}
function multipart(fields, files) {
  const boundary = '----tfmsec' + crypto.randomBytes(8).toString('hex');
  const parts = [];
  for (const [k, v] of Object.entries(fields || {})) parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  for (const f of files || []) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${f.field || 'photo'}"; filename="${f.name}"\r\nContent-Type: ${f.type || 'image/png'}\r\n\r\n`));
    parts.push(Buffer.isBuffer(f.data) ? f.data : Buffer.from(f.data));
    parts.push(Buffer.from('\r\n'));
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return { body: Buffer.concat(parts), contentType: `multipart/form-data; boundary=${boundary}` };
}
/** a realistic first save (mirrors the client's default state; same fixture as tests/server-e2e.mjs) */
function freshState(user, t = Date.now()) {
  const crops = { CROP_BEAN: 120, CROP_PEPPER: 150, CROP_CABBAGE: 140, CROP_PERILLA: 130, CROP_CORN: 160, CROP_RADISH: 110, CROP_MINT: 90, CROP_LAVENDER: 150, CROP_LEMONBALM: 100 };
  const pre = [['P1', 'CROP_BEAN', 65], ['P2', 'CROP_PEPPER', 70], ['P3', 'CROP_CABBAGE', 60], ['P4', 'CROP_PERILLA', 79], ['P5', 'CROP_CORN', 50], ['P6', 'CROP_RADISH', 96], ['H1', 'CROP_MINT', 75], ['H2', 'CROP_LAVENDER', 40], ['H3', null, 0], ['H4', 'CROP_LEMONBALM', 90]];
  const plots = {};
  for (const [id, crop, g] of pre) {
    plots[id] = crop
      ? { cropId: crop, growth: g, water: 60, health: 80, plantedAt: t - Math.round((g / 100) * crops[crop] * 1000), lastUpdate: t, lastWaterAt: 0, harvests: 0 }
      : { cropId: null, growth: 0, water: 40, health: 100, plantedAt: 0, lastUpdate: t, lastWaterAt: 0, harvests: 0 };
  }
  const jar = (owned, extra = {}) => ({ owned, recipeId: null, status: 'EMPTY', progress: 0, quality: 0, hygiene: 100, temp: 22, humidity: 60, tempOff: 0, humOff: 0, startedAt: 0, lastUpdate: t, care: {}, completedAt: 0, claimedAt: 0, acc: { t: 0, temp: 0, hum: 0, hyg: 0 }, ...extra });
  return {
    version: 1, createdAt: t, savedAt: t,
    profile: { id: String(user.id), nickname: user.nickname, email: user.email, role: user.role, avatar: null, title: '', titles: [] },
    stats: { level: 1, exp: 0, coin: 0, edu: 0, logins: 1, playTime: 0, distance: 0, waters: 0, plants: 0, harvests: 0, harvestedItems: 0, fermentsStarted: 0, fermentsClaimed: 0, fermentChecks: 0, quizCorrect: 0, quizAnswered: 0, eduCompleted: 0, journals: 0, photos: 0, emotes: 0, gestures: 0, chats: 0, talks: 0, crafts: 0, interacts: 0, expTotal: 0 },
    player: { x: 0, y: 0, z: 9, rotY: Math.PI, zoneId: 'ZONE_MAIN' },
    inventory: { ITEM_SEED_BEAN: 3, ITEM_SEED_PEPPER: 2, ITEM_SEED_CABBAGE: 2, ITEM_SEED_MINT: 2, ITEM_WATERING_CAN: 1, ITEM_HOMI: 1, ITEM_MEJU: 1, ITEM_SALT: 2, ITEM_GUIDEBOOK: 1 },
    quests: {}, farm: { plots },
    jars: { J1: jar(true, { recipeId: 'FER001', status: 'FERMENTING', progress: 35, hygiene: 82, startedAt: t - 63000 }), J2: jar(false), J3: jar(false) },
    education: { viewed: {}, completed: {}, quiz: {} },
    journal: [], photos: [], achievements: {}, collection: {}, visited: { ZONE_MAIN: t }, poisVisited: {}, npcsTalked: {}, cropKinds: {},
    flags: {}, tutorial: { step: 0, done: false }, activity: [{ t, type: 'login', text: 'security suite' }], settings: {}, blocked: [],
  };
}
/** cyrb53 — the client's save checksum */
function cyrb53(str) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0, ch; i < str.length; i++) { ch = str.charCodeAt(i); h1 = Math.imul(h1 ^ ch, 2654435761); h2 = Math.imul(h2 ^ ch, 1597334677); }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0');
}
function saveBody(state) { const data = JSON.stringify(state); return { version: 1, checksum: cyrb53(data), data: state }; }
/** RFC 6238 (SHA-1, 30 s, 6 digits) */
function totp(secretBase32, at = Date.now()) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const ch of secretBase32.toUpperCase().replace(/[^A-Z2-7]/g, '')) bits += alphabet.indexOf(ch).toString(2).padStart(5, '0');
  const key = Buffer.from((bits.match(/.{8}/g) || []).map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(Math.floor(at / 30000)));
  const h = crypto.createHmac('sha1', key).update(counter).digest();
  const off = h[h.length - 1] & 0xf;
  return String((h.readUInt32BE(off) & 0x7fffffff) % 1000000).padStart(6, '0');
}
const decodeHtml = (s) => String(s).replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
function parseAttrs(s) {
  const o = {};
  for (const m of s.matchAll(/([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g)) o[m[1].toLowerCase()] = decodeHtml(m[2] !== undefined ? m[2] : m[3] !== undefined ? m[3] : m[4] !== undefined ? m[4] : '');
  return o;
}
/** the forms of an HTML page: [{method, action, fields:[{tag, type, name, value, checked}]}] */
function parseForms(html) {
  const forms = [];
  for (const m of html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/gi)) {
    const a = parseAttrs(m[1]);
    const fields = [];
    for (const t of m[2].matchAll(/<(input|select|textarea|button)\b([^>]*)>/gi)) {
      const fa = parseAttrs(t[2]);
      if (!fa.name) continue;
      const tag = t[1].toLowerCase();
      let value = fa.value !== undefined ? fa.value : '';
      if (tag === 'select') {
        const sel = (m[2].slice(t.index).match(/^[\s\S]*?<\/select>/i) || [''])[0];
        const opt = sel.match(/<option\b[^>]*\bselected\b[^>]*>/i) || sel.match(/<option\b[^>]*>/i);
        value = opt ? (parseAttrs(opt[0]).value || '') : '';
      }
      fields.push({ tag, type: (fa.type || (tag === 'input' ? 'text' : tag)).toLowerCase(), name: fa.name, value, checked: 'checked' in fa });
    }
    forms.push({ method: (a.method || 'get').toLowerCase(), action: a.action || '', fields });
  }
  return forms;
}
/** submit a parsed form like a browser would (o.drop: field names to leave out, o.headers) */
function submitForm(c, pageUrl, form, values = {}, o = {}) {
  const data = {};
  for (const f of form.fields) {
    if (f.tag === 'button' || f.type === 'submit' || f.type === 'button') continue;
    if ((f.type === 'checkbox' || f.type === 'radio') && !f.checked) continue;
    data[f.name] = f.value;
  }
  Object.assign(data, values);
  for (const k of o.drop || []) delete data[k];
  const u = new URL(form.action || pageUrl, pageUrl);
  return c.req(u.pathname + u.search, { form: data, csrf: false, headers: { ...HTML, ...(o.headers || {}) } });
}

// ------------------------------------------------------------------ database access (direct: the SQLite file / the MariaDB table)
const PHP_QUERY = '$in = json_decode((string) stream_get_contents(STDIN), true); $pdo = new PDO($in["dsn"], $in["user"], $in["pass"], [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]); $out = [];'
  + ' foreach ($in["stmts"] as $q) { $st = $pdo->prepare($q[0]); $st->execute($q[1]); $out[] = $st->columnCount() ? $st->fetchAll(PDO::FETCH_ASSOC) : $st->rowCount(); }'
  + ' echo json_encode($out, JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE);';
function pdo(dsn, user, pass, stmts) {
  const r = spawnSync('php', ['-d', 'display_errors=stderr', '-r', PHP_QUERY], { input: JSON.stringify({ dsn, user, pass, stmts }), encoding: 'utf8', timeout: 30000, maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new Fail('database query failed: ' + oneLine(String(r.stderr || r.stdout).replace(/Stack trace[\s\S]*/, '').replace(/^PHP /, ''), 220));
  return JSON.parse(r.stdout);
}
const mysqlDsn = (db) => `mysql:host=${MY.host};port=${MY.port};${db ? `dbname=${db};` : ''}charset=utf8mb4`;
function mysqlRoot(stmts, db = '') { return pdo(mysqlDsn(db), MY.user, MY.pass, stmts.map((q) => [q, []])); }
let mysqlState = null;
function mysqlUp() {
  if (mysqlState === null) { try { mysqlRoot(['SELECT 1']); mysqlState = true; } catch { mysqlState = false; } }
  return mysqlState;
}
function sqliteFile(s) {
  if (!s.dataDir || !fs.existsSync(s.dataDir)) return null;
  const f = fs.readdirSync(s.dataDir).find((n) => /\.sqlite3?$/.test(n));
  return f ? path.join(s.dataDir, f) : null;
}
/** rows of the instance's own database (a copy of the SQLite file, or the MariaDB schema) */
function dbQuery(s, sql, params = []) {
  if (s.db.driver === 'mysql') return pdo(mysqlDsn(s.db.name), MY.user, MY.pass, [[sql, params]])[0];
  const f = sqliteFile(s);
  if (!f) throw new Fail('the instance has not created a database file yet');
  const tmp = mkTmp('dbcopy');
  try {
    for (const ext of ['', '-wal', '-shm']) if (fs.existsSync(f + ext)) fs.copyFileSync(f + ext, path.join(tmp, 'copy.sqlite' + ext));
    return pdo('sqlite:' + path.join(tmp, 'copy.sqlite'), null, null, [[sql, params]])[0];
  } finally { rmTmp(tmp); }
}
/** security_events rows (CONTRACT §15.8), or {error} when the table cannot be read */
function events(s) {
  try { return dbQuery(s, 'SELECT id, kind, ip, severity, path, user_id FROM security_events ORDER BY id'); } catch (e) { return { error: e.message }; }
}

// ------------------------------------------------------------------ server instances
const cleanEnv = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(?:TFM_|ANTHROPIC_)/.test(k)));
const DEFS = {
  main:       { env: { TFM_ADMIN_EMAILS: ADMINS } },                                  // default configuration
  val:        { env: { TFM_ADMIN_EMAILS: ADMINS } },                                  // validation matrix, uploads, payments (own rate budgets)
  rate:       { env: { TFM_ADMIN_EMAILS: ADMINS } },                                  // gets hammered
  fw:         { env: { TFM_ADMIN_EMAILS: ADMINS, TFM_TRUSTED_PROXIES: '127.0.0.1' } }, // attackers arrive through a trusted proxy: one address each
  https:      { env: { TFM_FORCE_HTTPS: 'on' } },
  httpsproxy: { env: { TFM_FORCE_HTTPS: 'on', TFM_TRUSTED_PROXIES: '127.0.0.1' } },
  cors:       { env: { TFM_CORS_ORIGINS: 'https://allowed.test' } },
  adminip:    { env: { TFM_ADMIN_EMAILS: ADMINS, TFM_ADMIN_IPS: '203.0.113.9', TFM_TRUSTED_PROXIES: '127.0.0.1' } },
  admin2fa:   { env: { TFM_ADMIN_EMAILS: ADMINS, TFM_ADMIN_2FA: 'required' } },
  adminidle:  { env: { TFM_ADMIN_EMAILS: ADMINS, TFM_ADMIN_IDLE: '2' } },
  idle:       { env: { TFM_SESSION_IDLE: '2' } },
  life:       { env: { TFM_SESSION_MAX: '3' } },
  prod:       { env: { TFM_ADMIN_EMAILS: ADMINS, TFM_ENV: 'production', TFM_FORCE_HTTPS: 'off' } },
  locked:     { env: {}, files: { 'install.lock': 'installed by tests/security-e2e.mjs\n' } },
  sub:        { env: {}, subfolder: true },                                           // docroot/metaverse/ → dist/metaverse
  broken:     { env: {} },                                                            // its database gets destroyed (S16)
  expo:       { env: {}, copy: true, dataInside: true, leftovers: true },             // private copy, data/ inside the web root (S19)
  inst:       { env: { TFM_TRUSTED_PROXIES: '127.0.0.1' }, copy: true },              // private copy: the installer may write into it (S04 / S16)
};
const SERVERS = new Map();
function srv(name) { if (!SERVERS.has(name)) SERVERS.set(name, startServer(name)); return SERVERS.get(name); }
let portCursor = 0;
async function freePort() {
  for (let i = 0; i < PHP_PORTS.length; i++) {
    const p = PHP_PORTS[(portCursor + i) % PHP_PORTS.length];
    const free = await new Promise((res) => { const t = net.createServer(); t.once('error', () => res(false)); t.listen(p, '127.0.0.1', () => t.close(() => res(true))); });
    if (free) { portCursor = (portCursor + i + 1) % PHP_PORTS.length; return p; }
  }
  throw new Fail('no free port in 18710–18729');
}
const canConnect = (port) => new Promise((res) => { const c = net.connect(port, '127.0.0.1'); c.once('connect', () => { c.destroy(); res(true); }); c.once('error', () => res(false)); });
function copyDocroot(name) {
  const dir = mkTmp('docroot-' + name);
  fs.chmodSync(dir, 0o755);
  fs.cpSync(DOCROOT, dir, { recursive: true });
  return dir;
}
/** typical leftovers of a careless deployment, planted into a private copy: [relative path, marker inside] */
const LEFT_CONTRACT = [
  ['config/config.local.php', "<?php\nif (!defined('TFM_BOOT')) { http_response_code(404); exit; }\nreturn ['db' => ['mysql' => ['password' => 'TFMSEC-MARK-config-local']]];\n"],
  ['.env', 'DB_PASSWORD=TFMSEC-MARK-env\n'], ['config.php.bak', "<?php $pw = 'TFMSEC-MARK-bak';\n"], ['config/config.local.php.bak', 'TFMSEC-MARK-localbak'],
  ['backup.sql', '-- TFMSEC-MARK-sql\n'], ['debug.log', 'TFMSEC-MARK-log\n'], ['NOTES.md', '# TFMSEC-MARK-md\n'], ['composer.lock', '{"TFMSEC-MARK-lock":1}'],
  ['php.ini', '; TFMSEC-MARK-ini\n'], ['dump.sqlite', 'SQLite format 3\0TFMSEC-MARK-sqlite'], ['data/backups/tfm-2026-11-12.sqlite', 'SQLite format 3\0TFMSEC-MARK-backup'],
  ['data/logs/extra.log', 'TFMSEC-MARK-datalog\n'], ['data/install.lock', 'TFMSEC-MARK-installlock\n'], ['lib/docs/HANDOVER.md', '# TFMSEC-MARK-doc\n'], ['index.html.old', 'TFMSEC-MARK-old'],
];
const LEFT_EXTRA = [
  ['.git/config', '[core]\n\tTFMSEC-MARK-git\n'], ['.git/HEAD', 'ref: refs/heads/TFMSEC-MARK-githead\n'], ['.svn/entries', 'TFMSEC-MARK-svn\n'],
  ['backup.zip', 'PK\x03\x04TFMSEC-MARK-zip'], ['site.tar.gz', 'TFMSEC-MARK-targz'], ['install.php~', "<?php // TFMSEC-MARK-tilde\n"], ['admin.php.save', "<?php // TFMSEC-MARK-save\n"],
];
function plantLeftovers(root, withLock) {
  for (const [rel, content] of [...LEFT_CONTRACT, ...LEFT_EXTRA]) {
    if (rel === 'data/install.lock' && !withLock) continue;
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), content);
  }
}
async function startServer(name) {
  if (name === 'apache') return startApache();
  const def = typeof DEFS[name] === 'function' ? await DEFS[name]() : DEFS[name];
  if (!def) throw new Error('unknown server ' + name);
  let docroot = DOCROOT, serveRoot = DOCROOT, prefix = '';
  if (def.copy) { docroot = copyDocroot(name); serveRoot = docroot; }
  if (def.subfolder) { serveRoot = mkTmp('site-' + name); fs.symlinkSync(docroot, path.join(serveRoot, 'metaverse'), 'dir'); prefix = 'metaverse/'; }
  const dataDir = def.dataInside ? path.join(docroot, 'data') : mkTmp('data-' + name);
  for (const [f, content] of Object.entries(def.files || {})) fs.writeFileSync(path.join(dataDir, f), content);
  if (def.leftovers) plantLeftovers(docroot, false);
  const db = def.db || (DRIVER === 'mysql' ? { driver: 'mysql', name: `${DB_PREFIX}_${name}` } : { driver: 'sqlite' });
  const dbEnv = {};
  if (db.driver === 'mysql') {
    if (!def.db) { mysqlRoot([`DROP DATABASE IF EXISTS \`${db.name}\``, `CREATE DATABASE \`${db.name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`]); DROP_DBS.add(db.name); }
    Object.assign(dbEnv, { TFM_DB_DRIVER: 'mysql', TFM_DB_HOST: MY.host, TFM_DB_PORT: String(MY.port), TFM_DB_NAME: db.name, TFM_DB_USER: MY.user, TFM_DB_PASS: MY.pass });
  }
  const env = { ...cleanEnv(), TFM_TOSS_MOCK: '1', ...(def.dataInside ? {} : { TFM_DATA_DIR: dataDir }), ...dbEnv, ...(def.env || {}) };
  const port = await freePort();
  // display_errors / expose_php on: the app has to silence PHP itself; upload limits above the app's own 5 MB cap
  const proc = spawn('php', ['-d', 'display_errors=1', '-d', 'html_errors=1', '-d', 'expose_php=1', '-d', 'upload_max_filesize=6M', '-d', 'post_max_size=8M', '-S', `127.0.0.1:${port}`, '-t', serveRoot], { env, stdio: ['ignore', 'ignore', 'pipe'] });
  const child = { pid: proc.pid };
  CHILDREN.add(child);
  let tail = '';
  proc.stderr.on('data', (d) => { tail = (tail + d).slice(-4000); });
  for (let i = 0; i < 80; i++) {
    if (proc.exitCode !== null) throw new Fail(`php -S for "${name}" exited: ${oneLine(tail, 200)}`);
    if (await canConnect(port)) break;
    await sleep(75);
  }
  let real = docroot;
  try { real = fs.realpathSync(docroot); } catch { /* keep */ }
  return {
    name, kind: 'php', port, base: `http://127.0.0.1:${port}/${prefix}`, docroot, dataDir, env, db, actors: {}, pings: {}, secrets: null,
    paths: [...new Set([real, docroot, dataDir, ROOT])].filter((p) => p && p.length > 6),
    log: () => tail,
    async stop() {
      CHILDREN.delete(child);
      if (proc.exitCode === null) { const gone = new Promise((r) => proc.once('exit', r)); proc.kill(); await Promise.race([gone, sleep(3000)]); }
      if (!def.dataInside) rmTmp(dataDir);
      if (def.copy) rmTmp(docroot);
      if (def.subfolder) { try { fs.unlinkSync(path.join(serveRoot, 'metaverse')); } catch { /* ignore */ } rmTmp(serveRoot); }
      if (db.driver === 'mysql' && !def.db) { try { mysqlRoot([`DROP DATABASE IF EXISTS \`${db.name}\``]); DROP_DBS.delete(db.name); } catch { /* ignore */ } }
    },
  };
}
async function stopServer(name) {
  if (!SERVERS.has(name)) return;
  const p = SERVERS.get(name);
  SERVERS.delete(name);
  try { await (await p).stop(); } catch { /* it never started */ }
}
/** Apache 2.4 + mod_php over a private copy (data/ inside the web root, like an XAMPP folder); null when it cannot start */
async function startApache() {
  if (spawnSync('apache2', ['-v'], { encoding: 'utf8' }).status !== 0) return { unavailable: 'apache2 is not installed' };
  const phpSo = fs.existsSync(APACHE_MODULES) ? fs.readdirSync(APACHE_MODULES).find((f) => /^libphp[\d.]*\.so$/.test(f)) : null;
  if (!phpSo) return { unavailable: `no libphp*.so in ${APACHE_MODULES}` };
  if (!(await new Promise((res) => { const t = net.createServer(); t.once('error', () => res(false)); t.listen(APACHE_PORT, '127.0.0.1', () => t.close(() => res(true))); }))) return { unavailable: `port ${APACHE_PORT} is in use` };
  const tmp = mkTmp('apache');
  fs.chmodSync(tmp, 0o755);
  const htdocs = path.join(tmp, 'htdocs');
  fs.cpSync(DOCROOT, htdocs, { recursive: true });
  for (const d of ['run', 'logs']) fs.mkdirSync(path.join(tmp, d));
  plantLeftovers(htdocs, false);
  fs.writeFileSync(path.join(htdocs, 'sec-probe.css'), 'body{}\n');
  fs.writeFileSync(path.join(htdocs, 'sec-probe.js'), '1;\n');
  let user = '';
  if (process.getuid && process.getuid() === 0) {
    user = ['www-data', 'apache', 'daemon', 'nobody'].find((u) => spawnSync('id', ['-u', u]).status === 0) || '';
    if (!user) return { unavailable: 'running as root and no unprivileged account (www-data / apache / daemon / nobody) exists' };
    spawnSync('chown', ['-R', `${user}:`, path.join(htdocs, 'data'), path.join(htdocs, 'uploads'), path.join(tmp, 'run'), path.join(tmp, 'logs')]);
  }
  const db = DRIVER === 'mysql' ? { driver: 'mysql', name: `${DB_PREFIX}_apache` } : { driver: 'sqlite' };
  const env = { TFM_TOSS_MOCK: '1', TFM_ADMIN_EMAILS: ADMINS };
  if (db.driver === 'mysql') {
    mysqlRoot([`DROP DATABASE IF EXISTS \`${db.name}\``, `CREATE DATABASE \`${db.name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`]);
    DROP_DBS.add(db.name);
    Object.assign(env, { TFM_DB_DRIVER: 'mysql', TFM_DB_HOST: MY.host, TFM_DB_PORT: String(MY.port), TFM_DB_NAME: db.name, TFM_DB_USER: MY.user, TFM_DB_PASS: MY.pass });
  }
  const mod = (id, file) => `LoadModule ${id}_module ${APACHE_MODULES}/${file}`;
  const conf = [
    `ServerRoot "${tmp}"`, `PidFile "${tmp}/run/httpd.pid"`, `DefaultRuntimeDir "${tmp}/run"`, `Mutex file:${tmp}/run default`,
    `Listen 127.0.0.1:${APACHE_PORT}`, 'ServerName 127.0.0.1',
    // a stock distribution setup: whatever the application wants hidden it has to hide itself (.htaccess) or flag (health check)
    'ServerTokens OS', 'ServerSignature On', 'TraceEnable On',
    mod('mpm_prefork', 'mod_mpm_prefork.so'), mod('authz_core', 'mod_authz_core.so'), mod('authz_host', 'mod_authz_host.so'), mod('dir', 'mod_dir.so'), mod('mime', 'mod_mime.so'),
    mod('env', 'mod_env.so'), mod('setenvif', 'mod_setenvif.so'), mod('headers', 'mod_headers.so'), mod('rewrite', 'mod_rewrite.so'), mod('alias', 'mod_alias.so'), mod('php', phpSo),
    user ? `User ${user}\nGroup ${user}` : '',
    `ErrorLog "${tmp}/logs/error.log"`, 'LogLevel warn', 'TypesConfig /etc/mime.types', 'StartServers 2', 'MinSpareServers 2', 'MaxSpareServers 4', 'MaxRequestWorkers 8', 'KeepAlive Off',
    `DocumentRoot "${htdocs}"`, `<Directory "${htdocs}">\n  AllowOverride All\n  Require all granted\n  Options FollowSymLinks\n</Directory>`,
    `Alias /metaverse "${htdocs}"`,
    '<FilesMatch "\\.php$">\n  SetHandler application/x-httpd-php\n</FilesMatch>',
    'php_flag display_errors On', 'php_flag html_errors On', 'php_value upload_max_filesize 6M', 'php_value post_max_size 8M',
    ...Object.entries(env).map(([k, v]) => `SetEnv ${k} "${v}"`),
  ].filter(Boolean).join('\n') + '\n';
  fs.writeFileSync(path.join(tmp, 'httpd.conf'), conf);
  // detached: prefork signals its whole process group when it shuts down — that group must not be ours
  const proc = spawn('apache2', ['-f', path.join(tmp, 'httpd.conf'), '-DFOREGROUND'], { stdio: ['ignore', 'pipe', 'pipe'], env: { PATH: process.env.PATH, LANG: 'C' }, detached: true });
  const child = { pid: proc.pid };
  CHILDREN.add(child);
  let out = '';
  proc.stdout.on('data', (d) => { out = (out + d).slice(-4000); });
  proc.stderr.on('data', (d) => { out = (out + d).slice(-4000); });
  let up = false;
  for (let i = 0; i < 80 && !up; i++) {
    if (proc.exitCode !== null) break;
    up = await canConnect(APACHE_PORT);
    if (!up) await sleep(75);
  }
  if (!up) { CHILDREN.delete(child); try { process.kill(proc.pid, 'SIGTERM'); } catch { /* gone */ } return { unavailable: `apache2 did not start: ${oneLine(out, 200)}` }; }
  const base = `http://127.0.0.1:${APACHE_PORT}/`;
  return {
    name: 'apache', kind: 'apache', port: APACHE_PORT, base, docroot: htdocs, dataDir: path.join(htdocs, 'data'), env, db, actors: {}, pings: {}, secrets: null,
    paths: [htdocs, tmp, ROOT], tmp,
    /** the same copy seen as a sub-folder installation */
    alias() { return { ...this, name: 'apache/metaverse', base: base + 'metaverse/', actors: {}, pings: this.pings }; },
    log: () => { try { return fs.readFileSync(path.join(tmp, 'logs/error.log'), 'utf8'); } catch { return out; } },
    async stop() {
      CHILDREN.delete(child);
      if (proc.exitCode === null) { const gone = new Promise((r) => proc.once('exit', r)); try { process.kill(proc.pid, 'SIGTERM'); } catch { /* gone */ } await Promise.race([gone, sleep(5000)]); }
      rmTmp(tmp);
      if (db.driver === 'mysql') { try { mysqlRoot([`DROP DATABASE IF EXISTS \`${db.name}\``]); DROP_DBS.delete(db.name); } catch { /* ignore */ } }
    },
  };
}
/** the Apache instance, or a Skip for checks that need it */
async function apache() {
  if (!APACHE) return skip('needs --apache');
  const a = await srv('apache');
  return a.unavailable ? skip(a.unavailable) : a;
}
const APACHE_MODE = { mode: `Apache 2.4 + mod_php (.htaccess) · ${DRIVER}` };
/** run the operator CLI of an instance */
function cli(s, ...args) {
  const r = spawnSync('php', [path.join(s.docroot, 'cli/tfm.php'), ...args], { env: s.env, encoding: 'utf8', timeout: 60000 });
  return { status: r.status, out: String(r.stdout || '') + String(r.stderr || '') };
}

// ------------------------------------------------------------------ people
let seq = 0;
const nextEmail = (p = 'u') => `${p}${++seq}_${RUN}@example.com`;
const nextNick = (p = 'Usr') => `${p}${TAG}${++seq}`.slice(0, 12);
/** api/ping.php is limited per address (60 / minute): never let the suite itself trip it */
async function pacePing(s, who = 'local') {
  const list = (s.pings[who] = (s.pings[who] || []).filter((t) => Date.now() - t < 61000));
  if (list.length >= 50) await sleep(Math.max(0, 61500 - (Date.now() - list[0])));
  s.pings[who].push(Date.now());
}
/** a browser with an anonymous session and its CSRF token */
async function anon(s, o = {}) {
  const c = new Client(s, o);
  await pacePing(s, o.xff || 'local');
  const r = await c.req('api/ping.php');
  if (r.status !== 200 || !c.csrf) throw new Fail(`no session on "${s.name}": api/ping.php → ${r.status} ${(r.error && r.error.code) || oneLine(r.text, 80)}`);
  return c;
}
function register(c, email, nickname, extra = {}) { return c.json('api/auth/register.php', { email, nickname, password: PASSWORD, password_confirm: PASSWORD, agree: true, ...extra }); }
function login(c, name, password = PASSWORD, extra = {}) { return c.json('api/auth/login.php', { login: name, password, remember: false, ...extra }); }
/** a freshly registered, logged-in player */
async function newUser(s, prefix = 'Usr', o = {}) {
  const c = await anon(s, o);
  const email = o.email || nextEmail(prefix.toLowerCase());
  const nick = nextNick(prefix);
  const r = await register(c, email, nick);
  if (r.status !== 200 || !r.data || !r.data.user) throw new Fail(`could not register a test account on "${s.name}": ${r.status} ${(r.error && r.error.code) || ''} ${(r.error && r.error.message) || ''}`);
  c.user = r.data.user; c.email = email; c.nick = nick; c.admin = r.data.user.role === 'admin';
  return c;
}
/** a named account of an instance, created once (o.admin: registered with an address of TFM_ADMIN_EMAILS) */
function actor(s, key, o = {}) {
  if (!s.actors[key]) {
    s.actors[key] = (async () => {
      const c = await newUser(s, o.admin ? 'Adm' : 'Usr', o.admin ? { email: key === 'admin2' ? ADMIN2_EMAIL : ADMIN_EMAIL } : {});
      if (o.admin && c.user.role !== 'admin') throw new Fail(`TFM_ADMIN_EMAILS did not make ${c.email} an admin on "${s.name}"`);
      return c;
    })();
  }
  return s.actors[key];
}
const admin = (s) => actor(s, 'admin', { admin: true });

// ------------------------------------------------------------------ the admin page(s)
const isAppShell = (r) => r.buf.length > 400000;                 // php -S answers unknown folder URLs with the big start page
const isSignIn = (r) => r.status === 200 && /text\/html/.test(r.headers['content-type'] || '') && !isAppShell(r) && parseForms(r.text).some((f) => f.method === 'post' && f.fields.some((x) => x.type === 'password'));
const isAdminUi = (r) => r.status === 200 && /text\/html/.test(r.headers['content-type'] || '') && !isAppShell(r) && /[?&;]tab=[a-z_]+/.test(r.text) && !parseForms(r.text).some((f) => f.fields.some((x) => x.type === 'password' && /^(?:password|pw|pass)$/i.test(x.name)) && f.fields.some((x) => /^(?:login|email|id|user)/i.test(x.name)));
const NO_ADMIN_SITE = 'the separate admin site (admin/ — CONTRACT §15.4) does not exist: neither the address api/auth/me.php gives an admin nor /admin/ shows a sign-in page';
/** the admin site of the contract: the address me.php hands to an admin, else admin/ — null when there is none */
async function adminSite(s) {
  if (s.adminSite !== undefined) return s.adminSite;
  const cands = [];
  try { const a = await admin(s); const me = await a.req('api/auth/me.php'); if (me.data && typeof me.data.adminUrl === 'string' && me.data.adminUrl) cands.push(me.data.adminUrl.replace(/^\//, '')); } catch { /* no admin account on this instance */ }
  cands.push('admin/');
  for (const p of cands) {
    const r = await request(s, p, { headers: HTML });
    if (isSignIn(r) || isAdminUi(r)) return (s.adminSite = p);
  }
  return (s.adminSite = null);
}
/** whichever admin page this build has (the contract's folder, else the phase-6 admin.php) — for checks about escaping, SQL and CSRF */
async function adminPage(s) {
  const site = await adminSite(s);
  if (site) return site;
  if (s.oldAdmin === undefined) { const r = await request(s, 'admin.php', { headers: HTML }); s.oldAdmin = isSignIn(r) ? 'admin.php' : null; }
  return s.oldAdmin;
}
/** fill in and send the sign-in form of an admin page; returns the page the browser ends on */
async function adminSignIn(c, entry, name, password) {
  const page = await c.req(entry, { headers: HTML });
  if (isAdminUi(page)) return page;
  const form = parseForms(page.text).find((f) => f.method === 'post' && f.fields.some((x) => x.type === 'password'));
  if (!form) return page;
  const values = {};
  for (const f of form.fields) { if (f.type === 'password') values[f.name] = password; else if (f.tag === 'input' && ['text', 'email'].includes(f.type)) values[f.name] = name; }
  return follow(c, await submitForm(c, page.url, form, values));
}
/** a browser inside the admin UI of this instance (signed in as the admin account) */
async function adminBrowser(s) {
  const entry = await adminPage(s);
  if (!entry) throw new Fail('this build has no admin page (neither admin/ nor admin.php shows a sign-in form)');
  const a = await admin(s);
  const c = new Client(s);
  c.admin = true;
  const page = await adminSignIn(c, entry, a.email, PASSWORD);
  if (!isAdminUi(page)) throw new Fail(`could not sign in to ${entry} as the admin account (status ${page.status})`);
  return { c, entry, page };
}
const tabsOf = (html) => [...new Set([...html.matchAll(/[?&;]tab=([a-z_]+)/g)].map((m) => m[1]))];

// =============================================================================
// S01 — DB locked
// =============================================================================
const DB_ACCOUNT_RX = /db_(?:account|user|priv|grant|root)|root|빈 비밀번호|비밀번호가 (?:없|비어)|전용 계정|DB 계정|global priv|전체 권한/i;
let myFixture;
/** MariaDB: schema imported with the admin connection, plus a SELECT/INSERT/UPDATE/DELETE-only account; null when no server answers */
function mysqlFixture() {
  if (myFixture !== undefined) return myFixture;
  if (!mysqlUp()) return (myFixture = null);
  const db = `${DB_PREFIX}_lp`, user = `${DB_PREFIX}_app`, pass = 'Lp1' + crypto.randomBytes(15).toString('hex');
  const dataDir = mkTmp('data-myfixture');
  mysqlRoot([`DROP DATABASE IF EXISTS \`${db}\``, `CREATE DATABASE \`${db}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`]);
  DROP_DBS.add(db);
  const env = { ...cleanEnv(), TFM_DATA_DIR: dataDir, TFM_DB_DRIVER: 'mysql', TFM_DB_HOST: MY.host, TFM_DB_PORT: String(MY.port), TFM_DB_NAME: db, TFM_DB_USER: MY.user, TFM_DB_PASS: MY.pass };
  const mig = spawnSync('php', [path.join(DOCROOT, 'cli/tfm.php'), 'migrate'], { env, encoding: 'utf8', timeout: 60000 });
  if (mig.status !== 0) return (myFixture = { error: `schema import with the admin connection failed: ${oneLine(String(mig.stdout) + String(mig.stderr), 200)}` });
  for (const h of ['127.0.0.1', 'localhost']) {
    mysqlRoot([`DROP USER IF EXISTS '${user}'@'${h}'`, `CREATE USER '${user}'@'${h}' IDENTIFIED BY '${pass}'`, `GRANT SELECT, INSERT, UPDATE, DELETE ON \`${db}\`.* TO '${user}'@'${h}'`]);
    DROP_USERS.add(`'${user}'@'${h}'`);
  }
  const common = { TFM_ADMIN_EMAILS: ADMINS, TFM_DB_DRIVER: 'mysql', TFM_DB_HOST: MY.host, TFM_DB_PORT: String(MY.port), TFM_DB_NAME: db };
  // both instances share the secret file (IP hashes, sealed columns) and the schema
  DEFS.myapp = { env: { ...common, TFM_DB_USER: user, TFM_DB_PASS: pass, TFM_DB_AUTO_MIGRATE: '0' }, db: { driver: 'mysql', name: db } };
  DEFS.myroot = { env: { ...common, TFM_DB_USER: MY.user, TFM_DB_PASS: MY.pass }, db: { driver: 'mysql', name: db } };
  return (myFixture = { db, user, pass });
}
const needMaria = (my) => (my === null ? skip(`no MariaDB answers at ${MY.host}:${MY.port}`) : my.error ? skip(my.error) : null);

async function S01() {
  if (!want('S01')) return;
  // CONTRACT §15.7 #1 — SQLite: random file name under data/, 0600 where the OS allows
  await check('S01', 'SQLite: the database file has an unguessable name and mode 0600 (no group / other access)', { sev: 'low', fix: 'Db::pdo(): chmod the SQLite file (and -wal / -shm) to 0600; keep data/ at 0700.' }, async () => {
    if (DRIVER !== 'sqlite') return skip('every instance of this run uses MySQL / MariaDB');
    if (process.platform === 'win32') return skip('file modes mean nothing on Windows');
    const s = await srv('main');
    await anon(s);
    const f = sqliteFile(s);
    assert(f, 'no *.sqlite file in the data directory');
    assert(/^db-[0-9a-f]{16,}\.sqlite$/.test(path.basename(f)), `the file name ${path.basename(f)} can be guessed`);
    const mode = fs.statSync(f).mode & 0o777;
    assert((mode & 0o077) === 0, `data/db-<random>.sqlite has mode 0${mode.toString(8)}: the group can read the whole database (expected 0600)`);
    return `db-<24 hex>.sqlite, mode 0${mode.toString(8)}`;
  });
  // CONTRACT §15.7 #1 — subscriptions.billing_key is sealed with Tfm\Crypto (prefix enc:v1:)
  await check('S01', 'billing keys are stored sealed (enc:v1:…), never in the clear', { sev: 'high', fix: 'Subscription: Crypto::seal() the billing key before it is stored, Crypto::open() when charging; seal old plain values on first use.' }, async () => {
    const s = await srv('val');
    const u = await newUser(s, 'Seal');
    const p = await u.json('api/sub/prepare.php', { tier: 2, kind: 'billing' });
    assert(p.status === 200 && p.data && p.data.orderId, `the mock billing flow is not available: prepare → ${p.status} ${(p.error && p.error.code) || ''}`);
    const b = await u.json('api/sub/billing-issue.php', { authKey: 'mock_auth_ok', customerKey: p.data.customerKey, orderId: p.data.orderId });
    assert(b.status === 200, `billing-issue → ${b.status} ${(b.error && b.error.code) || ''}`);
    const key = String((dbQuery(s, 'SELECT billing_key FROM subscriptions WHERE user_id = ?', [u.user.id])[0] || {}).billing_key || '');
    assert(key !== '', 'no billing key was stored');
    assert(key.startsWith('enc:v1:') && !/mock_bk_/.test(key), `subscriptions.billing_key holds the key in the clear ("${key.slice(0, 10)}…")`);
    return `stored as enc:v1:… (${key.length} chars)`;
  });
  const my = mysqlFixture();
  // CONTRACT §15.7 #1 — the runtime account needs SELECT / INSERT / UPDATE / DELETE on the app database only
  await check('S01', 'MariaDB: a least-privilege account (SELECT · INSERT · UPDATE · DELETE on the app database, auto-migrate off) runs register · login · save · chat', { sev: 'high', fix: 'Keep every runtime query DML-only; schema changes only through "php cli/tfm.php migrate" with the admin connection.' }, async () => {
    const no = needMaria(my);
    if (no) return no;
    const s = await srv('myapp');
    const c = await anon(s);
    const email = nextEmail('lp'), nick = nextNick('Lp');
    let r = await register(c, email, nick);
    assert(r.status === 200 && r.data && r.data.user, `register → ${r.status} ${(r.error && r.error.code) || ''}`);
    const user = r.data.user;
    r = await c.json('api/auth/logout.php', {});
    assert(r.status === 200, `logout → ${r.status}`);
    r = await login(c, email);
    assert(r.status === 200 && r.data.user.id === user.id, `login → ${r.status} ${(r.error && r.error.code) || ''}`);
    r = await c.json('api/player/save.php', saveBody(freshState(user)));
    assert(r.status === 200, `save → ${r.status} ${(r.error && r.error.code) || ''}`);
    r = await c.req('api/player/get.php');
    assert(r.status === 200 && r.data.save && r.data.save.revision >= 1, `get → ${r.status}`);
    r = await c.json('api/chat/send.php', { text: '안녕하세요 반가워요', channel: 'all' });
    assert(r.status === 200, `chat → ${r.status} ${(r.error && r.error.code) || ''}`);
    let ddl = '';
    try { pdo(mysqlDsn(my.db), my.user, my.pass, [['CREATE TABLE tfm_sec_probe (id INT)', []]]); } catch (e) { ddl = e.message; }
    assert(ddl !== '', 'fixture problem: the least-privilege account may run DDL');
    return `register · login · save · get · chat work as ${my.user} (CREATE TABLE refused)`;
  });
  // CONTRACT §15.7 #1 — Health: ⛔ when the runtime account is root / has an empty password / has global privileges
  await check('S01', 'MariaDB: the health check flags a root / empty-password runtime account (⛔) and not the least-privilege one', { sev: 'high', fix: 'Health / Inspect: read CURRENT_USER() and SHOW GRANTS; fail for root, an empty password or global privileges, warn for DDL grants.' }, async () => {
    const no = needMaria(my);
    if (no) return no;
    const flagged = async (s) => {
      const a = await admin(s);
      const h = await a.req('api/admin/health.php?quick=1');
      assert(h.status === 200 && h.data && Array.isArray(h.data.checks), `api/admin/health.php → ${h.status} ${(h.error && h.error.code) || ''}`);
      return h.data.checks.filter((k) => k.status === 'fail' && DB_ACCOUNT_RX.test(JSON.stringify(k)));
    };
    const root = await flagged(await srv('myroot'));
    assert(root.length > 0, `the server runs as ${MY.user}@… ${MY.pass === '' ? 'with an empty password' : ''}: api/admin/health.php has no failing entry about the database account`);
    const app = await flagged(await srv('myapp'));
    assert(app.length === 0, `the least-privilege account is flagged as well: ${JSON.stringify(app[0]).slice(0, 160)}`);
    return `root → ⛔ ${root[0].id}; ${my.user} → no ⛔`;
  });
  // CONTRACT §15.7 #1 — install.php / cli install create a dedicated account and write only that one into config.local.php
  await check('S01', 'MariaDB: the installer creates a dedicated account (tfm_<random>, random 32-char password, DML only), keeps the admin account out of config.local.php and turns auto-migrate off', { sev: 'high', fix: 'Installer::run(): CREATE USER tfm_<random> + GRANT SELECT, INSERT, UPDATE, DELETE on the app database, run the schema with the admin connection, write the app account and db.auto_migrate=false into config.local.php.' }, async () => {
    const no = needMaria(my);
    if (no) return no;
    const copy = copyDocroot('instcli'), dataDir = mkTmp('data-instcli'), db = `${DB_PREFIX}_inst`;
    mysqlRoot([`DROP DATABASE IF EXISTS \`${db}\``]);
    DROP_DBS.add(db);
    const created = [];
    try {
      // secrets go through the environment (finding F20: cli/tfm.php refuses passwords as option values — they would sit in
      // the process list and the shell history); the nickname avoids "Inst…", which the kid-safety rule reads as a messenger id
      const r = spawnSync('php', [path.join(copy, 'cli/tfm.php'), 'install', '--driver=mysql', `--host=${MY.host}`, `--port=${MY.port}`, `--db=${db}`, `--user=${MY.user}`, `--admin-email=${ADMIN_EMAIL}`, '--admin-nick=SetupAdmin1', '--mock'], { env: { ...cleanEnv(), TFM_DATA_DIR: dataDir, TFM_DB_ADMIN_PASS: MY.pass, TFM_ADMIN_PASS: PASSWORD }, input: '', encoding: 'utf8', timeout: 90000 });
      assert(r.status === 0, `"php cli/tfm.php install" failed (exit ${r.status}): ${oneLine(String(r.stdout) + String(r.stderr), 200)}`);
      const file = path.join(copy, 'config/config.local.php');
      assert(fs.existsSync(file), 'config/config.local.php was not written');
      const inc = spawnSync('php', ['-r', 'define("TFM_BOOT", true); echo json_encode(include $argv[1]);', file], { encoding: 'utf8' });
      const cfg = JSON.parse(inc.stdout || '{}');
      const m = (cfg.db && cfg.db.mysql) || {};
      // mysql.db keeps the database part of a GRANT as written: a grant for exactly this database escapes the _ wildcard (tfm\_x)
      for (const row of mysqlRoot([`SELECT User, Host FROM mysql.db WHERE REPLACE(Db, '\\\\', '') = '${db}'`])[0]) created.push(`'${row.User}'@'${row.Host}'`);
      assert(m.username && m.username !== MY.user && m.username !== 'root', `config.local.php keeps the admin account "${m.username}" as the runtime account (no dedicated account was created)`);
      assert(/^tfm_[A-Za-z0-9]{6,}$/.test(m.username), `the runtime account "${m.username}" is not a generated tfm_<random> name`);
      assert(typeof m.password === 'string' && m.password.length >= 32, `the generated password has ${String(m.password || '').length} characters (expected ≥ 32)`);
      assert(cfg.db.auto_migrate === false, 'db.auto_migrate is not false in config.local.php');
      const grants = created.filter((u) => u.startsWith(`'${m.username}'`)).map((u) => mysqlRoot([`SHOW GRANTS FOR ${u}`])[0].map((g) => Object.values(g)[0]).join(' | ')).join(' | ');
      assert(grants !== '', `no grants found for ${m.username} on ${db}`);
      assert(!/ALL PRIVILEGES|\bCREATE\b|\bDROP\b|\bALTER\b|GRANT OPTION|\bFILE\b|\bSUPER\b/.test(grants.replace(/GRANT USAGE ON \*\.\* TO [^|]*/g, '')), `the app account can do more than DML: ${grants}`);
      const mode = fs.statSync(file).mode & 0o777;
      assert((mode & 0o007) === 0, `config.local.php is world-readable (0${mode.toString(8)})`);
      return `${m.username} · ${m.password.length}-char password · DML only · auto_migrate off · config.local.php 0${mode.toString(8)}`;
    } finally {
      try { mysqlRoot([`DROP DATABASE IF EXISTS \`${db}\``, ...created.filter((u) => /^'tfm_/.test(u)).map((u) => `DROP USER IF EXISTS ${u}`)]); DROP_DBS.delete(db); } catch { /* ignore */ }
      rmTmp(copy); rmTmp(dataDir);
    }
  });
}

// =============================================================================
// S02 — HTTPS forced
// =============================================================================
async function S02() {
  if (!want('S02')) return;
  const jsonPost = (body = {}) => ({ method: 'POST', headers: { Host: PUB_HOST, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  // CONTRACT §15.7 #2 — plain-HTTP GET → 308 to the https URL
  await check('S02', 'force_https=on: a plain-HTTP GET for a public host is answered 308 → https://…', { sev: 'high', fix: 'Add security.force_https (TFM_FORCE_HTTPS: auto|on|off) and enforce it first in every entry point: GET/HEAD → 308 Location https://<host><uri>.' }, async () => {
    const s = await srv('https');
    const seen = [];
    for (const p of ['api/ping.php', 'api/time.php?x=1', 'api/auth/me.php']) {
      const r = await request(s, p, { headers: { Host: PUB_HOST } });
      assert(r.status === 308, `GET ${p} over http with Host: ${PUB_HOST} → ${r.status} (expected 308)`);
      assert(r.headers.location === `https://${PUB_HOST}/${p}`, `Location: ${r.headers.location} (expected https://${PUB_HOST}/${p})`);
      assert(!r.setCookie.length, 'the plain-HTTP answer set a cookie');
      seen.push(p);
    }
    const spoof = await request(s, 'api/ping.php', { headers: { Host: PUB_HOST, 'X-Forwarded-Proto': 'https' } });
    assert(spoof.status === 308, `X-Forwarded-Proto: https from a peer that is not a trusted proxy → ${spoof.status} (expected 308: the header must be ignored)`);
    return `${seen.join(', ')} → 308; a spoofed X-Forwarded-Proto changes nothing`;
  });
  // CONTRACT §15.7 #2 — any other method over plain HTTP → 403 HTTPS_REQUIRED (credentials are never processed)
  await check('S02', 'force_https=on: a plain-HTTP POST is refused with 403 HTTPS_REQUIRED before credentials are read', { sev: 'high', fix: 'The same guard: every method but GET/HEAD over http → 403 HTTPS_REQUIRED, before the session, CSRF and body are touched (+ https_required event).' }, async () => {
    const s = await srv('https');
    for (const p of ['api/auth/login.php', 'api/auth/register.php', 'api/player/save.php', 'api/sub/webhook.php']) {
      const r = await request(s, p, jsonPost({ login: 'someone@example.com', password: PASSWORD }));
      assert(r.status === 403 && r.error && r.error.code === 'HTTPS_REQUIRED', `POST ${p} over http → ${r.status} ${(r.error && r.error.code) || ''} (expected 403 HTTPS_REQUIRED)`);
      assert(!r.setCookie.length, `POST ${p} over http set a cookie`);
    }
    return 'login · register · save · webhook → 403 HTTPS_REQUIRED, no cookie';
  });
  // CONTRACT §15.7 #2 — X-Forwarded-Proto is honoured only via trusted_proxies
  await check('S02', 'forwarding headers from an untrusted peer never mark a request as https (no HSTS, cookie not Secure)', { sev: 'high', fix: 'Keep Http::isHttps() tied to security.trusted_proxies.' }, async () => {
    const s = await srv('main');
    for (const h of [{ 'X-Forwarded-Proto': 'https' }, { Forwarded: 'proto=https;for=203.0.113.5' }, { 'X-Forwarded-Ssl': 'on', 'Front-End-Https': 'on', 'X-Url-Scheme': 'https' }]) {
      await pacePing(s);
      const r = await request(s, 'api/ping.php', { headers: h });
      assert(r.status === 200, `ping with ${Object.keys(h)[0]} → ${r.status}`);
      assert(!r.headers['strict-transport-security'], `${Object.keys(h)[0]} from an untrusted peer switched HSTS on`);
      assert(r.setCookie.length && !/;\s*secure/i.test(r.setCookie.join(';')), `${Object.keys(h)[0]} from an untrusted peer made the cookie Secure (the server believes it is on https)`);
    }
    return 'X-Forwarded-Proto · Forwarded · X-Forwarded-Ssl ignored';
  });
  // CONTRACT §15.7 #2 — HSTS on every HTTPS response, cookies Secure
  await check('S02', 'https (through a trusted proxy): HSTS on JSON, error and HTML answers; session, remember-me and logout cookies are Secure', { sev: 'high', fix: 'Keep HSTS in Http::securityHeaders() and Secure on every Set-Cookie when Http::isHttps().' }, async () => {
    const s = await srv('fw');
    const tls = { 'X-Forwarded-Proto': 'https', Host: PUB_HOST };
    const c = await anon(s, { xff: '203.0.113.60', headers: tls });
    const seen = [];
    const hsts = (r, what) => { const v = r.headers['strict-transport-security'] || ''; const age = Number((v.match(/max-age=(\d+)/) || [])[1] || 0); assert(age >= 15552000, `${what}: Strict-Transport-Security is "${v || '(missing)'}" (expected max-age ≥ 180 days)`); seen.push(what); };
    const secure = (r, what) => { for (const ck of r.setCookie) assert(/;\s*secure/i.test(ck) && /;\s*httponly/i.test(ck), `${what}: Set-Cookie without Secure / HttpOnly — ${ck}`); };
    hsts(await c.req('api/time.php'), 'JSON');
    hsts(await c.req('api/auth/login.php'), '405 error');
    const page = await adminPage(s);
    if (page) hsts(await c.req(page, { headers: HTML }), 'admin page');
    const email = nextEmail('tls');
    let r = await register(c, email, nextNick('Tls'));
    assert(r.status === 200 && r.setCookie.length, `register over https → ${r.status}`);
    secure(r, 'register');
    r = await c.json('api/auth/logout.php', {});
    assert(r.status === 200 && r.setCookie.length, 'logout sets the fresh anonymous cookie');
    secure(r, 'logout');
    r = await login(c, email, PASSWORD, { remember: true });
    assert(r.status === 200 && r.setCookie.some((x) => /max-age=[1-9]/i.test(x)), `login with remember → ${r.status}, no persistent cookie`);
    secure(r, 'remember-me login');
    return `HSTS on ${seen.join(' · ')}; register / logout / remember-me cookies Secure + HttpOnly`;
  });
  // CONTRACT §15.7 #2 — behind a trusted proxy the redirect follows what the proxy reports
  await check('S02', 'force_https=on behind a trusted proxy: X-Forwarded-Proto http → 308, https → served', { sev: 'medium', fix: 'The https guard must use Http::isHttps() (trusted proxies) for its decision.' }, async () => {
    const s = await srv('httpsproxy');
    const plain = await request(s, 'api/time.php', { headers: { Host: PUB_HOST, 'X-Forwarded-Proto': 'http', 'X-Forwarded-For': '203.0.113.61' } });
    assert(plain.status === 308 && plain.headers.location === `https://${PUB_HOST}/api/time.php`, `http reported by the proxy → ${plain.status} ${plain.headers.location || ''} (expected 308 to https)`);
    const tls = await request(s, 'api/time.php', { headers: { Host: PUB_HOST, 'X-Forwarded-Proto': 'https', 'X-Forwarded-For': '203.0.113.61' } });
    assert(tls.status === 200, `https reported by the proxy → ${tls.status}`);
    return 'http → 308, https → 200';
  });
  // CONTRACT §15.7 #2 — default 'auto': on unless the request is for localhost
  await check('S02', 'force_https=auto (default): localhost keeps working over http, a public host is redirected (GET) and refused (POST)', { sev: 'high', fix: 'Default security.force_https to "auto": enforce unless the request is for localhost / 127.0.0.1 / ::1.' }, async () => {
    const s = await srv('main');
    const local = await request(s, 'api/time.php');
    assert(local.status === 200, `localhost over http → ${local.status}`);
    const g = await request(s, 'api/time.php', { headers: { Host: PUB_HOST } });
    assert(g.status === 308 && g.headers.location === `https://${PUB_HOST}/api/time.php`, `GET with Host: ${PUB_HOST} over http → ${g.status} (expected 308 → https)`);
    const p = await request(s, 'api/auth/login.php', jsonPost());
    assert(p.status === 403 && p.error && p.error.code === 'HTTPS_REQUIRED', `POST → ${p.status} ${(p.error && p.error.code) || ''} (expected 403 HTTPS_REQUIRED)`);
    return 'localhost 200 · public host 308 / 403';
  });
  // CONTRACT §15.7 #2 — Health ⛔ when off on a non-local host
  await check('S02', 'health check: HTTPS switched off on a public host is flagged ⛔', { sev: 'medium', fix: 'Keep the "https" health entry failing for plain http on a non-local host.' }, async () => {
    const s = await srv('prod');
    const a = await admin(s);
    const h = await a.req('api/admin/health.php?quick=1', { headers: { Host: PUB_HOST } });
    assert(h.status === 200 && h.data && Array.isArray(h.data.checks), `api/admin/health.php with Host: ${PUB_HOST} → ${h.status} ${(h.error && h.error.code) || ''}`);
    const k = h.data.checks.find((x) => /https/i.test(x.id));
    assert(k && k.status === 'fail', `the https entry is ${JSON.stringify(k || null).slice(0, 140)}`);
    return `${k.id}: fail`;
  });
  // CONTRACT §15.7 #2 — root .htaccess: the redirect block is active (localhost excluded)
  await check('S02', 'Apache: the root .htaccess sends a public host from http to https (static files too) and leaves localhost alone', { ...APACHE_MODE, sev: 'high', fix: 'Activate the RewriteRule block of the root .htaccess (R=308, localhost / 127.0.0.1 excluded, HTTPS detection via trusted proxy header only when configured).' }, async () => {
    const a = await apache();
    if (a instanceof Skip) return a;
    const local = await request(a, 'index.html', { method: 'HEAD' });
    assert(local.status === 200, `HEAD index.html on localhost → ${local.status}`);
    for (const p of ['index.html', '', 'api/time.php']) {
      const r = await request(a, p, { method: p === 'api/time.php' ? 'GET' : 'HEAD', headers: { Host: PUB_HOST } });
      assert([301, 308].includes(r.status) && r.headers.location === `https://${PUB_HOST}/${p}`, `/${p} with Host: ${PUB_HOST} over http → ${r.status} ${r.headers.location || ''} (expected a permanent redirect to https)`);
    }
    const post = await request(a, 'api/auth/login.php', jsonPost({ login: 'x@example.com', password: PASSWORD }));
    assert((post.status === 403 && post.error && post.error.code === 'HTTPS_REQUIRED') || ([301, 307, 308].includes(post.status) && /^https:/.test(post.headers.location || '')), `POST over http → ${post.status} (expected 403 HTTPS_REQUIRED or a redirect to https — never processed)`);
    return 'index.html · / · api → https; POST not processed';
  });
}

// =============================================================================
// S03 — server-side validation
// =============================================================================
const deepObj = (n) => { let v = 1; for (let i = 0; i < n; i++) v = { a: v }; return v; };
const isCleanError = (r) => r.status >= 400 && r.status < 500 && r.json && r.json.success === false && r.error && typeof r.error.code === 'string' && typeof r.error.message === 'string';
/** the PHP files below api/ of the docroot (the black box's endpoint list) */
function apiFiles(root = DOCROOT) {
  const out = [];
  const walk = (d) => { for (const e of fs.readdirSync(path.join(root, d), { withFileTypes: true })) { const rel = `${d}/${e.name}`; if (e.isDirectory()) walk(rel); else if (/\.php$/.test(e.name)) out.push(rel); } };
  walk('api');
  return out.sort();
}
/** which endpoints take POST: a cookie-less POST answers 405 (Allow without POST) when they do not */
async function postEndpoints(s) {
  if (!s.postEndpoints) {
    const list = [];
    for (const f of apiFiles(s.docroot)) {
      const r = await request(s, f, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      if (!(r.status === 405 && !/POST/i.test(r.headers.allow || ''))) list.push(f);
    }
    s.postEndpoints = list;
  }
  return s.postEndpoints;
}
const WEBHOOK = 'api/sub/webhook.php';   // documented: no session, no CSRF, always 200 (the body is never trusted)
async function S03() {
  if (!want('S03')) return;
  const s = await srv('val');
  const adm = await admin(s);
  const victim = await actor(s, 'victim');
  const eps = await postEndpoints(s);

  // ---- layer 1: malformed bodies on every POST endpoint the build has
  const malformed = (big) => [
    ['array root', '[1,2,3]'], ['string root', '"abc"'], ['null root', 'null'], ['cut off', '{"a":'], ['depth 40', JSON.stringify(deepObj(40))], ['depth 300', JSON.stringify(deepObj(300))],
    ['NaN literal', '{"a":NaN,"amount":NaN,"tier":NaN}'], ['invalid UTF-8', Buffer.from([0x7b, 0x22, 0x61, 0x22, 0x3a, 0x22, 0xff, 0xfe, 0xc0, 0x22, 0x7d])], ['oversize', JSON.stringify({ pad: 'x'.repeat(big) })],
  ];
  for (const ep of eps) {
    // CONTRACT §15.7 #3 — JSON depth ≤ 32, body size caps per endpoint, unknown shapes rejected; never a 500
    await check('S03', `${ep} · malformed bodies (array / scalar root, cut-off, depth 40 and 300, NaN, bad UTF-8, oversize) → 4xx JSON error, never 5xx`, { sev: 'medium', fix: 'Route every body through Http::json() / Tfm\\V with the depth-32 and size caps; answer 400 / 413.' }, async () => {
      let u = await newUser(s, 'Mal');
      const probe = await u.json(ep, {});
      if (probe.status === 403 && probe.error && probe.error.code === 'FORBIDDEN') u = adm;
      const bad = [];
      for (const [label, body] of malformed(ep === 'api/player/save.php' ? 2600000 : 300000)) {
        const r = await u.req(ep, { body, headers: { 'Content-Type': 'application/json' } });
        if (ep === WEBHOOK) { if (r.status >= 500 || (r.status === 200 && !(r.data && r.data.ignored === true))) bad.push(`${label}→${r.status}`); continue; }
        if (r.status === 429) bad.push(`${label}→429 before validation`); else if (!isCleanError(r)) bad.push(`${label}→${r.status}${r.json ? '' : ' (not JSON)'}`);
      }
      assert(!bad.length, bad.join(', '));
      return ep === WEBHOOK ? 'always 200 + ignored (documented webhook behaviour), never 5xx' : '9 malformed bodies → 4xx';
    });
  }

  // ---- layer 2: one field wrong in an otherwise valid request must be refused, not silently coerced
  const STR = [['a number', 12345], ['an array', ['x']], ['an object', { a: 1 }], ['true', true]];
  const INT = [['a digit string', (v) => String(v)], ['a float', (v) => v + 0.5], ['an array', (v) => [v]], ['an object', (v) => ({ v })], ['a word', () => 'abc'], ['true', () => true]];
  const mut = (field, list, base) => list.map(([label, v]) => [`${field} = ${label}`, { ...base, [field]: typeof v === 'function' ? v(base[field]) : v }]);
  /** run the cases; a case is [label, body] or [label, async () => body]; opts.user() gives the browser to use, opts.after(res, c) cleans up after an accepted request */
  const strict = async (ep, cases, opts = {}) => {
    const accepted = [], broken = [];
    let c = opts.user ? await opts.user() : await newUser(s, 'Str');
    let used = 0;
    for (const [label, bodyOf] of cases) {
      if (opts.perUser && used >= opts.perUser) { c = opts.user ? await opts.user() : await newUser(s, 'Str'); used = 0; }
      let body = typeof bodyOf === 'function' ? await bodyOf(c) : bodyOf;
      let r = typeof body === 'string' ? await c.req(ep, { body, headers: { 'Content-Type': 'application/json' } }) : await c.json(ep, body);
      used++;
      if (r.status === 429) { await sleep(1200); r = typeof body === 'string' ? await c.req(ep, { body, headers: { 'Content-Type': 'application/json' } }) : await c.json(ep, body); }
      if (r.status >= 500 || !r.json) broken.push(`${label} → ${r.status}`);
      else if (r.status === 429) broken.push(`${label} → 429 before validation`);
      else if (r.status < 400) { accepted.push(label); if (opts.after) await opts.after(r, c); }
    }
    assert(!broken.length, `server error / unusable answer: ${broken.join(', ')}`);
    assert(!accepted.length, `${accepted.length} of ${cases.length} invalid requests were accepted (2xx): ${accepted.join(' | ')}`);
    return `${cases.length} invalid variants → 4xx`;
  };
  const STRICT_FIX = 'Validate through Tfm\\V (type, length, range, enum): answer 400 INVALID_PARAM instead of coercing or dropping the value.';

  // CONTRACT §15.7 #3 — login: every field typed
  await check('S03', 'api/auth/login.php · wrong field types are refused even with otherwise valid credentials', { sev: 'low', fix: STRICT_FIX }, async () => {
    const acct = await newUser(s, 'Lgn');
    const base = { login: acct.email, password: PASSWORD, remember: false };
    return strict('api/auth/login.php', [...mut('login', STR, base), ...mut('password', STR, base), ['remember = a word', { ...base, remember: 'yes' }], ['remember = a number', { ...base, remember: 1 }], ['remember = an array', { ...base, remember: [true] }]], { user: () => anon(s) });
  });
  // CONTRACT §15.7 #3 — register
  await check('S03', 'api/auth/register.php · wrong field types are refused (no account is created)', { sev: 'low', fix: STRICT_FIX }, async () => {
    const base = () => ({ email: nextEmail('reg'), nickname: nextNick('Reg'), password: PASSWORD, password_confirm: PASSWORD, agree: true, remember: false });
    const cases = [];
    for (const f of ['email', 'nickname', 'password', 'password_confirm']) for (const [label, v] of STR) cases.push([`${f} = ${label}`, () => ({ ...base(), [f]: v })]);
    for (const [label, v] of [['a word', 'true'], ['a number', 1], ['an array', [true]]]) cases.push([`agree = ${label}`, () => ({ ...base(), agree: v })]);
    for (const [label, v] of [['a word', 'yes'], ['a number', 1]]) cases.push([`remember = ${label}`, () => ({ ...base(), remember: v })]);
    return strict('api/auth/register.php', cases, { user: () => anon(s), after: (r, c) => c.json('api/auth/logout.php', {}) });
  });
  // CONTRACT §15.7 #3 — chat/send: text type + length, channel enum
  await check('S03', 'api/chat/send.php · wrong types, an unknown channel and an over-long text are refused', { sev: 'low', fix: STRICT_FIX }, async () => {
    let n = 0;
    const base = () => ({ text: `검증 문장 ${RUN} ${++n}`, channel: 'all' });
    const cases = [];
    for (const [label, v] of STR) cases.push([`text = ${label}`, () => ({ ...base(), text: v })]);
    for (const [label, v] of [['an unknown value ("shout")', 'shout'], ['a number', 5], ['an array', ['all']], ['an object', { a: 'all' }]]) cases.push([`channel = ${label}`, () => ({ ...base(), channel: v })]);
    cases.push(['text = 121 characters', () => ({ ...base(), text: '가'.repeat(121) })]);
    return strict('api/chat/send.php', cases, { perUser: 8, after: () => sleep(1100) });
  });
  // CONTRACT §15.7 #3 — chat/report: reason enum, ids as integers
  await check('S03', 'api/chat/report.php · wrong types, an unknown reason and non-integer ids are refused', { sev: 'low', fix: STRICT_FIX }, async () => {
    const base = () => ({ target: victim.nick, reason: 'spam', memo: '검증 메모' });
    const cases = [];
    for (const [label, v] of STR) cases.push([`target = ${label}`, () => ({ ...base(), target: v })]);
    for (const [label, v] of [['an unknown value', 'zzz_unknown'], ['a number', 5], ['an array', ['spam']]]) cases.push([`reason = ${label}`, () => ({ ...base(), reason: v })]);
    for (const [label, v] of [['a number', 5], ['an array', ['m']]]) cases.push([`memo = ${label}`, () => ({ ...base(), memo: v })]);
    for (const f of ['messageId', 'targetId']) for (const [label, v] of [['a word', 'abc'], ['negative', -1], ['a float', 1.5], ['an array', [1]], ['huge', 1e30]]) cases.push([`${f} = ${label}`, () => ({ ...base(), [f]: v })]);
    return strict('api/chat/report.php', cases, { perUser: 8 });
  });
  // CONTRACT §15.7 #3 — presence/update: numbers in range, enums known
  await check('S03', 'api/presence/update.php · wrong types, out-of-range numbers and unknown animation / zone ids are refused', { sev: 'low', fix: STRICT_FIX + ' (Today the values are replaced by defaults / clamped: decide per field, but a string where a number belongs is an unknown shape.)' }, async () => {
    const base = { x: 1, y: 0, z: 1, rotY: 0, anim: 'idle', speed: 0, zoneId: 'ZONE_MAIN' };
    const cases = [];
    for (const f of ['x', 'y', 'z', 'rotY', 'speed']) for (const [label, v] of [['a word', 'abc'], ['an array', [1]], ['an object', { a: 1 }], ['true', true]]) cases.push([`${f} = ${label}`, { ...base, [f]: v }]);
    cases.push(['x = 1e12 (outside the world)', { ...base, x: 1e12 }], ['z = -1e12', { ...base, z: -1e12 }], ['speed = -5', { ...base, speed: -5 }], ['speed = 1e9', { ...base, speed: 1e9 }], ['x = 1e999 (overflow)', JSON.stringify(base).replace('"x":1', '"x":1e999')]);
    for (const [label, v] of [['an unknown animation', 'fly_hack'], ['a number', 5], ['an array', ['idle']]]) cases.push([`anim = ${label}`, { ...base, anim: v }]);
    for (const [label, v] of [['markup', 'ZONE_<b>'], ['a number', 7]]) cases.push([`zoneId = ${label}`, { ...base, zoneId: v }]);
    return strict('api/presence/update.php', cases);
  });
  // CONTRACT §15.7 #3 — player/save: envelope + state shapes, depth ≤ 32
  await check('S03', 'api/player/save.php · a wrong envelope, wrong value types in the state and a 40-level deep value are refused', { sev: 'medium', fix: 'Decode the save with depth 32 like every other body; keep the shape checks of SaveValidator for every field.' }, async () => {
    const u = await newUser(s, 'Sav');
    const first = await u.json('api/player/save.php', saveBody(freshState(u.user)));
    assert(first.status === 200, `the valid first save was refused: ${first.status} ${(first.error && first.error.code) || ''}`);
    const fresh = () => { const st = freshState(u.user); st.savedAt = Date.now(); return st; };
    const env = (m) => () => ({ ...saveBody(fresh()), ...m });
    const st = (m) => () => { const x = fresh(); m(x); return saveBody(x); };
    const cases = [
      ['version = a word', env({ version: 'one' })], ['version = an array', env({ version: [1] })], ['checksum = a number', env({ checksum: 12345 })], ['checksum = an array', env({ checksum: ['x'] })],
      ['base = a word', env({ base: 'abc' })], ['base = negative', env({ base: -1 })], ['base = a float', env({ base: 1.5 })],
      ['data = a string', env({ data: 'state' })], ['data = an array', env({ data: [1, 2] })], ['data = a number', env({ data: 5 })],
      ['stats.coin = negative', st((x) => { x.stats.coin = -5; })], ['stats.coin = a word', st((x) => { x.stats.coin = 'many'; })], ['stats.level = 0', st((x) => { x.stats.level = 0; })], ['stats.level = 9999', st((x) => { x.stats.level = 9999; })],
      ['stats.exp = 1e30', st((x) => { x.stats.exp = 1e30; })], ['inventory count = negative', st((x) => { x.inventory.ITEM_SALT = -1; })], ['inventory count = a float', st((x) => { x.inventory.ITEM_SALT = 1.5; })],
      ['inventory count = a word', st((x) => { x.inventory.ITEM_SALT = 'two'; })], ['inventory = an array', st((x) => { x.inventory = [1, 2]; })], ['farm.plots = a string', st((x) => { x.farm.plots = 'none'; })],
      ['flags.deep = 40 levels', st((x) => { x.flags = { deep: deepObj(40) }; })],
    ];
    return strict('api/player/save.php', cases, { user: async () => u });
  });
  // CONTRACT §15.7 #3 — sub/prepare: tier integer 2..4, kind enum
  await check('S03', 'api/sub/prepare.php · tier must be the integer 2, 3 or 4 and kind a known word', { sev: 'low', fix: STRICT_FIX }, async () => {
    const base = { tier: 2, kind: 'card' };
    const cases = [...mut('tier', INT, base), ['tier = 0', { ...base, tier: 0 }], ['tier = 1', { ...base, tier: 1 }], ['tier = 5', { ...base, tier: 5 }], ['tier = -2', { ...base, tier: -2 }], ['tier = 1e30', { ...base, tier: 1e30 }], ['tier = null', { ...base, tier: null }],
      ['kind = an unknown value', { ...base, kind: 'crypto' }], ['kind = a number', { ...base, kind: 5 }], ['kind = an array', { ...base, kind: ['card'] }]];
    return strict('api/sub/prepare.php', cases, { perUser: 15 });
  });
  // CONTRACT §15.7 #3 — sub/confirm: strings and an integer amount
  await check('S03', 'api/sub/confirm.php · paymentKey / orderId must be strings and the amount a JSON integer', { sev: 'medium', fix: 'confirm.php: accept the amount only as a JSON integer (V::int); the Toss return page keeps its own string parsing.' }, async () => {
    const order = async (c) => { const p = await c.json('api/sub/prepare.php', { tier: 2, kind: 'card' }); assert(p.status === 200 && p.data, `prepare → ${p.status} ${(p.error && p.error.code) || ''}`); return p.data; };
    const cases = [];
    for (const [label, v] of [['a digit string', (a) => String(a)], ['a float (.5)', (a) => a + 0.5], ['an array', (a) => [a]], ['an object', (a) => ({ a })], ['true', () => true], ['null', () => null]]) cases.push([`amount = ${label}`, async (c) => { const o = await order(c); return { paymentKey: 'mock_' + o.orderId, orderId: o.orderId, amount: v(o.amount) }; }]);
    cases.push(['amount = a float literal (2900.0)', async (c) => { const o = await order(c); return `{"paymentKey":"mock_${o.orderId}","orderId":"${o.orderId}","amount":${o.amount}.0}`; }]);
    for (const [label, v] of STR) cases.push([`paymentKey = ${label}`, async (c) => { const o = await order(c); return { paymentKey: v, orderId: o.orderId, amount: o.amount }; }]);
    for (const [label, v] of STR) cases.push([`orderId = ${label}`, async (c) => { const o = await order(c); return { paymentKey: 'mock_' + o.orderId, orderId: v, amount: o.amount }; }]);
    return strict('api/sub/confirm.php', cases, { perUser: 8 });
  });
  // CONTRACT §15.7 #3 — sub/billing-issue: three strings
  await check('S03', 'api/sub/billing-issue.php · authKey / customerKey / orderId must be strings', { sev: 'low', fix: STRICT_FIX }, async () => {
    const cases = [];
    for (const f of ['authKey', 'customerKey', 'orderId']) for (const [label, v] of STR) cases.push([`${f} = ${label}`, async (c) => {
      const p = await c.json('api/sub/prepare.php', { tier: 2, kind: 'billing' });
      assert(p.status === 200 && p.data, `prepare → ${p.status} ${(p.error && p.error.code) || ''}`);
      return { authKey: 'mock_auth_ok', customerKey: p.data.customerKey, orderId: p.data.orderId, [f]: v };
    }]);
    return strict('api/sub/billing-issue.php', cases, { perUser: 8 });
  });
  // CONTRACT §15.7 #3 — sub/grant (admin): integers in range
  await check('S03', 'api/sub/grant.php · userId, tier and days must be integers in range (admin)', { sev: 'low', fix: STRICT_FIX }, async () => {
    const base = { userId: victim.user.id, tier: 2, days: 1 };
    const cases = [...mut('userId', INT, base), ['userId = 0', { ...base, userId: 0 }], ['userId = -1', { ...base, userId: -1 }], ...mut('tier', INT, base), ['tier = 1', { ...base, tier: 1 }], ['tier = 5', { ...base, tier: 5 }], ['tier = -1', { ...base, tier: -1 }],
      ...mut('days', INT, base), ['days = 0', { ...base, days: 0 }], ['days = -3', { ...base, days: -3 }], ['days = 100000', { ...base, days: 100000 }], ['revoke = a word', { userId: victim.user.id, revoke: 'yes' }], ['revoke = a number', { userId: victim.user.id, revoke: 1 }]];
    return strict('api/sub/grant.php', cases, { user: async () => adm });
  });
  // CONTRACT §15.7 #3 — sub/renew (admin)
  await check('S03', 'api/sub/renew.php · userId must be an integer and force a boolean (admin)', { sev: 'low', fix: STRICT_FIX }, async () => {
    const cases = [['userId = a word', { userId: 'abc' }], ['userId = negative', { userId: -1 }], ['userId = an array', { userId: [1] }], ['userId = a float', { userId: 1.5 }], ['force = a word', { userId: victim.user.id, force: 'yes' }], ['force = a number', { userId: victim.user.id, force: 1 }]];
    return strict('api/sub/renew.php', cases, { user: async () => adm });
  });
  // CONTRACT §15.7 #3 — every POST endpoint has a field-level spec in this suite
  await check('S03', 'every POST endpoint of the build has a field-level validation matrix in this suite', { sev: 'low', fix: 'New endpoint: add its valid body and wrong-type variants to S03() in tests/security-e2e.mjs.' }, async () => {
    const covered = new Set(['api/auth/login.php', 'api/auth/register.php', 'api/chat/send.php', 'api/chat/report.php', 'api/presence/update.php', 'api/player/save.php', 'api/sub/prepare.php', 'api/sub/confirm.php', 'api/sub/billing-issue.php', 'api/sub/grant.php', 'api/sub/renew.php',
      'api/auth/logout.php', 'api/sub/cancel.php', WEBHOOK, 'api/journal/upload.php']);   // the last four have no typed JSON field (upload: S14)
    const missing = eps.filter((e) => !covered.has(e));
    assert(!missing.length, `no matrix for: ${missing.join(', ')}`);
    return `${eps.length} POST endpoints`;
  });
  // CONTRACT §15.7 #3 — $_GET numbers through V::int
  await check('S03', 'GET parameters are validated: non-numeric, negative, zero, huge or array values for after · limit · rafter → 400', { sev: 'low', fix: 'chat/list.php: V::int for after / limit (1..page_size) / rafter; an invalid value is a 400, not a silent default.' }, async () => {
    const u = await newUser(s, 'Get');
    const bad = [];
    for (const q of ['after=-1', 'after=abc', 'after=1%20OR%201=1', 'after[]=1', 'after=99999999999999999999', 'after=1.5', 'limit=-5', 'limit=abc', 'limit=0', 'limit=100000', 'limit[]=5', 'after=1&rafter=abc', "after=1&rafter=1'", 'after=1&rafter=-1', 'after=1&rafter[]=1']) {
      const r = await u.req(`api/chat/list.php?${q}`);
      if (r.status !== 400) bad.push(`${q} → ${r.status}`);
    }
    assert(!bad.length, `not refused: ${bad.join(', ')}`);
    return '15 invalid query strings → 400';
  });
}

// =============================================================================
// S04 — XSS blocked
// =============================================================================
const XSS = [
  ['script tag', '<script>tfmx1()</script>'], ['img onerror', '"><img src=x onerror=tfmx2()>'], ['svg onload', '<svg/onload=tfmx3()>'], ['attribute breakout', 'x" onmouseover="tfmx4()" a="'],
  ['single-quote breakout', "x' onfocus='tfmx5()' autofocus a='"], ['javascript: URL', 'javascript:tfmx6()'], ['closing style', '</style><script>tfmx7()</script>'], ['iframe srcdoc', '<iframe srcdoc="<script>tfmx8()</script>">'],
];
/** does an HTML page carry the payload in an executable form? */
function rawHtmlHit(html, payload) {
  if (/[<"']/.test(payload) && html.includes(payload)) return true;
  if (/^javascript:/i.test(payload) && new RegExp(`(?:href|src|action|formaction)\\s*=\\s*["']?\\s*${payload.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i').test(html)) return true;
  return false;
}
async function S04() {
  if (!want('S04')) return;
  const s = await srv('main');
  const A = await actor(s, 'A'), B = await actor(s, 'B');
  // CONTRACT §15.7 #4 — stored XSS through the nickname
  await check('S04', 'nickname: script / event-handler / SVG / javascript: payloads never become a nickname', { sev: 'high', fix: 'Keep the nickname whitelist (한글·영문·숫자·_) on the server.' }, async () => {
    const c = await anon(s);
    const out = [];
    for (const nick of ['<b>x</b>', '<svg>', '"><i>', "a'b\"c", 'x<y>z', '<a href=x>', '&lt;b&gt;', 'java:x()', '<script>x', 'on=x()']) {
      const r = await register(c, nextEmail('xn'), nick);
      if (r.status === 200) {
        const me = await c.req('api/auth/me.php');
        assert(!/[<>&'"]/.test(me.text), `the nickname ${nick} was accepted and comes back raw`);
        await c.json('api/auth/logout.php', {});
      } else assert(isCleanError(r), `${nick} → ${r.status}`);
      out.push(r.status);
    }
    return `10 payloads → ${[...new Set(out)].join('/')}`;
  });
  // CONTRACT §15.7 #4 — stored XSS through chat: JSON hex-escaped < > & ' "
  await check('S04', 'chat text: payloads are stored and come back inert (JSON-hex escaped in send and list)', { sev: 'high', fix: 'Keep JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT in Api::send().' }, async () => {
    const sent = [];
    for (const [label, p] of XSS.slice(0, 5)) {
      const text = p.slice(0, 100);
      const r = await A.json('api/chat/send.php', { text, channel: 'all' });
      assert(r.status === 200, `${label}: send → ${r.status} ${(r.error && r.error.code) || ''}`);
      assert(!/[<>&']/.test(r.text), `${label}: the send answer contains raw markup characters`);
      assert(r.data.message.text === text || !/[<>]/.test(r.data.message.text), `${label}: text changed into ${r.data.message.text}`);
      sent.push(text);
      await sleep(1100);
    }
    const list = await B.req('api/chat/list.php');
    assert(list.status === 200 && !/[<>&']/.test(list.text), 'the list answer contains raw < > & or \' characters');
    assert(/\\u003Cscript\\u003E/i.test(list.text), 'the list does not carry the payload hex-escaped (\\u003Cscript\\u003E)');
    assert(list.data.messages.some((m) => m.text === sent[0]), 'the stored text does not round-trip as data');
    return `${sent.length} payloads round-trip as \\u003C…\\u003E data`;
  });
  // CONTRACT §15.7 #4 — stored XSS through the report memo: escaped where the admin reads it
  await check('S04', 'report memo / target / quoted text: shown escaped on the admin page (no raw markup, no handler)', { sev: 'high', fix: 'Keep e() on every value of the moderation tab.' }, async () => {
    for (const [, p] of XSS.slice(0, 4)) {
      const r = await B.json('api/chat/report.php', { target: p.slice(0, 40), reason: 'abuse', memo: p, text: p });
      assert(r.status === 200 || isCleanError(r), `report → ${r.status}`);
      assert(!/[<>&']/.test(r.text), 'the report answer contains raw markup characters');
    }
    const { c, entry, page } = await adminBrowser(s);
    const tabs = tabsOf(page.text);
    assert(tabs.length > 0, 'no tabs on the admin page');
    let reportShown = false;
    const hits = [];
    for (const tab of tabs) {
      const r = await c.req(`${entry}?tab=${tab}`, { headers: HTML });
      if (/tfmx\d\(\)/.test(r.text)) reportShown = true;
      for (const [label, p] of XSS) if (rawHtmlHit(r.text, p) || rawHtmlHit(r.text, p.slice(0, 40))) hits.push(`${tab}: ${label}`);
      assert(!/<script\b/i.test(r.text), `tab ${tab} contains a <script> element`);
    }
    assert(!hits.length, `raw payload in the admin HTML — ${hits.join(', ')}`);
    assert(reportShown, 'the reports are not visible on any admin tab (cannot judge the escaping)');
    return `${tabs.length} tabs: payloads only as &lt;…&gt; text`;
  });
  // CONTRACT §15.7 #4 — nothing reflected raw by the admin page
  await check('S04', 'admin page: payloads in every query parameter are never reflected raw', { sev: 'high', fix: 'Keep e() / whitelists for tab, q, p, ev, sev, uid, show, before and every new parameter.' }, async () => {
    const { c, entry, page } = await adminBrowser(s);
    const names = ['q', 'p', 'ev', 'sev', 'uid', 'show', 'before', 'live', 'status', 'sort', 'order', 'filter', 'id', 'page', 'msg', 'error', 'next', 'kind', 'bed', 'user'];
    const tabs = ['', ...tabsOf(page.text)];
    const hits = [];
    for (const tab of tabs) {
      for (const make of [(n) => `"><svg/onload=tfmq_${n}()>`, (n) => `'><script>tfmq_${n}()</script>`]) {
        const qs = names.map((n) => `${n}=${encodeURIComponent(make(n))}`).join('&');
        const r = await c.req(`${entry}?tab=${encodeURIComponent(tab || make('tab'))}&${qs}`, { headers: HTML });
        assert(r.status < 500, `tab ${tab || '(payload)'} → ${r.status}`);
        for (const n of [...names, 'tab']) if (r.text.includes(make(n))) hits.push(`${tab || '(tab)'}: ${n}`);
        for (const n of names) if (r.text.includes(`${n}[`)) hits.push(`${tab}: ${n}[]`);
      }
    }
    const arr = await c.req(`${entry}?tab[]=x&q[]=%3Cscript%3Etfmq_arr()%3C/script%3E&p[a]=1`, { headers: HTML });
    assert(arr.status < 500 && !arr.text.includes('<script>tfmq_arr()'), `array parameters → ${arr.status}`);
    assert(!hits.length, `reflected raw: ${[...new Set(hits)].join(', ')}`);
    return `${tabs.length} tabs × ${names.length + 1} parameters × 2 payloads: nothing reflected raw`;
  });
  // CONTRACT §15.7 #4 — nothing reflected raw by install.php
  await check('S04', 'install.php: payloads in query parameters and in the posted form fields are never reflected raw', { sev: 'medium', fix: 'Keep ie() on every value install.php prints.' }, async () => {
    const names = ['driver', 'host', 'port', 'database', 'username', 'admin_email', 'admin_nickname', 'toss_client', 'step', 'lang', 'error', 'msg'];
    const make = (n) => `"><svg/onload=tfmi_${n}()>`;
    const g = await request(s, `install.php?${names.map((n) => `${n}=${encodeURIComponent(make(n))}`).join('&')}`, { headers: HTML });
    assert(g.status < 500, `GET → ${g.status}`);
    for (const n of names) assert(!g.text.includes(make(n)), `GET: ${n} is reflected raw`);
    const priv = await srv('inst');   // a private copy: a form that slipped through could not touch dist/metaverse
    const c = new Client(priv);
    const page = await c.req('install.php', { headers: HTML });
    const form = parseForms(page.text).find((f) => f.method === 'post');
    if (!form) return `GET: nothing reflected; the installer shows no form (${page.status}) — nothing can be posted`;
    const values = { driver: 'sqlite' };
    for (const f of form.fields) if (['text', 'email'].includes(f.type) && f.tag === 'input') values[f.name] = make(f.name);
    const p = await submitForm(c, page.url, form, values);
    assert(p.status < 500, `POST → ${p.status}`);
    for (const f of form.fields) assert(!p.text.includes(make(f.name)), `POST: the field ${f.name} is printed back raw`);
    assert(!fs.existsSync(path.join(priv.docroot, 'config/config.local.php')), 'the installer ran although the admin e-mail was markup');
    return `GET (${names.length} parameters) and POST (${Object.keys(values).length} fields): escaped`;
  });
  // CONTRACT §15.7 #4 — nothing reflected raw by api/sub/return.php (and no open redirect)
  await check('S04', 'api/sub/return.php: payloads in every query parameter only end percent-encoded in a redirect to the own start page', { sev: 'high', fix: 'Keep the fixed "index.html?sub=…" target with rawurlencode(); never build the Location from request data.' }, async () => {
    const names = ['code', 'message', 'fail', 'kind', 'paymentKey', 'orderId', 'amount', 'authKey', 'customerKey', 'next', 'returnUrl', 'redirect'];
    const variants = [
      Object.fromEntries(names.map((n) => [n, `"><script>tfmr_${n}()</script>`])),
      { code: 'X', message: '<svg/onload=tfmr_m()>' }, { fail: '1', message: 'https://evil.example/' }, { code: 'X', message: '//evil.example/%0d%0aSet-Cookie:%20tfmr=1' },
      { kind: 'card', paymentKey: "x'\"><svg>", orderId: '"><svg/onload=tfmr_o()>', amount: '1' }, { next: '//evil.example', returnUrl: 'https://evil.example', code: 'X' },
    ];
    const basePath = new URL(s.base).pathname;
    for (const v of variants) {
      const r = await A.req(`api/sub/return.php?${formEncode(v)}`, { headers: HTML });
      assert([302, 303].includes(r.status) || r.status === 200, `→ ${r.status}`);
      assert(!/tfmr_\w+\(\)<|<svg|<script>tfmr/.test(r.text), 'the page body reflects a payload');
      if (r.headers.location !== undefined) {
        const loc = r.headers.location;
        assert(loc.startsWith(`${basePath}index.html?`) && !/[<>"'\r\n ]/.test(loc), `Location: ${loc.slice(0, 120)}`);
      }
      assert(!r.setCookie.some((x) => /tfmr/.test(x)) && !r.headers['tfmr'], 'header injection through the message');
    }
    return `${variants.length} requests → 303 ${basePath}index.html?sub=fail&msg=<percent-encoded>`;
  });
  // CONTRACT §15.7 #4 — app: strict hash CSP
  await check('S04', 'index.html ships a strict hash-based CSP (no unsafe-inline / unsafe-eval scripts, object-src none, base-uri none)', { sev: 'high', fix: 'Keep the build-time sha256 hashes in the <meta http-equiv="Content-Security-Policy">.' }, async () => {
    const r = await request(s, 'index.html', { headers: HTML });
    assert(r.status === 200, `index.html → ${r.status}`);
    const csp = decodeHtml((r.text.match(/<meta http-equiv="Content-Security-Policy"\s+content="([^"]+)"/i) || [])[1] || '');
    assert(csp, 'no CSP meta element');
    const dir = Object.fromEntries(csp.split(';').map((d) => d.trim().split(/\s+/)).filter((d) => d[0]).map((d) => [d[0], d.slice(1)]));
    const scripts = dir['script-src'] || dir['default-src'] || [];
    assert((dir['default-src'] || []).join(' ') === "'none'", `default-src is ${(dir['default-src'] || []).join(' ')}`);
    assert(scripts.some((x) => /^'sha(256|384|512)-/.test(x)) && !scripts.some((x) => /unsafe-inline|unsafe-eval|^\*$|^data:|^https?:$/.test(x)), `script-src is ${scripts.join(' ')}`);
    assert((dir['object-src'] || []).join(' ') === "'none'" && /'none'|'self'/.test((dir['base-uri'] || []).join(' ')), 'object-src / base-uri are open');
    return `script-src: ${scripts.filter((x) => /^'sha/.test(x)).length} hashes${scripts.filter((x) => !/^'sha/.test(x)).length ? ' + ' + scripts.filter((x) => !/^'sha/.test(x)).join(' ') : ''}`;
  });
  // CONTRACT §15.7 #4 — user-controlled strings other players receive are whitelisted
  await check('S04', 'presence: appearance, animation, zone and emote values are whitelisted — a payload never reaches another player', { sev: 'medium', fix: 'Keep the appearance / id whitelists of Presence::update().' }, async () => {
    const p = '<img src=x onerror=tfmp()>';
    const r = await A.json('api/presence/update.php', { x: 1, y: 0, z: 1, anim: p, zoneId: p, emote: p, appearance: { hair: p, skin: 'javascript:tfmp()', top: p, evil: p, height: p } });
    assert(r.status === 200 || isCleanError(r), `presence → ${r.status}`);
    const seen = await B.json('api/presence/update.php', { x: 2, y: 0, z: 2 });
    assert(seen.status === 200, `presence (B) → ${seen.status}`);
    assert(!/tfmp/.test(seen.text) && !/[<>&']/.test(seen.text), 'the payload is relayed to another player');
    return 'nothing of the payload in the other player\'s list';
  });
}

// =============================================================================
// S05 — suspicious activity logged + blocked
// =============================================================================
const BAITS = ['.env', 'wp-login.php', 'phpmyadmin/', '.git/config', 'config.php.bak', 'wp-admin/', 'xmlrpc.php', '.aws/credentials', 'vendor/phpunit/phpunit/src/Util/PHP/eval-stdin.php', 'server-status'];
async function S05() {
  if (!want('S05')) return;
  const s = await srv('fw');
  const EV_FIX = 'Add Tfm\\SecEvent::log(kind, severity, detail) → security_events (+ file log) and call it where the request is refused.';
  /** run an attack from its own address and expect a new row of one of the kinds */
  const logged = async (kinds, ip, attack) => {
    const before = events(s);
    assert(!before.error, `security_events cannot be read: ${before.error}`);
    await attack();
    const after = events(s);
    assert(!after.error, `security_events cannot be read: ${after.error}`);
    const fresh = after.slice(before.length);
    const hit = fresh.filter((e) => kinds.includes(e.kind));
    assert(hit.length > 0, `no ${kinds.join(' / ')} row in security_events after the attack (${fresh.length ? 'new rows: ' + [...new Set(fresh.map((e) => e.kind))].join(', ') : 'the table got no new row'})`);
    assert(hit.some((e) => e.ip === ip), `the row does not carry the attacker's address ${ip} (ip = ${hit[0].ip})`);
    return `${hit[0].kind} · ${hit[0].severity} · ${hit[0].path || '(no path)'} · ${hit[0].ip}`;
  };
  // CONTRACT §15.7 #5 — kind csrf_fail
  await check('S05', 'a forged POST (no CSRF token) is written to security_events (csrf_fail)', { sev: 'high', fix: EV_FIX }, async () => {
    const ip = '203.0.113.101';
    const c = await anon(s, { xff: ip });
    return logged(['csrf_fail'], ip, () => c.json('api/auth/login.php', { login: 'x@example.com', password: PASSWORD }, { csrf: false }));
  });
  // CONTRACT §15.7 #5 — kind origin_mismatch
  await check('S05', 'a cross-site POST (foreign Origin) is written to security_events (origin_mismatch)', { sev: 'high', fix: EV_FIX }, async () => {
    const ip = '203.0.113.102';
    const c = await anon(s, { xff: ip });
    return logged(['origin_mismatch'], ip, () => c.json('api/auth/login.php', { login: 'x@example.com', password: PASSWORD }, { headers: { Origin: 'https://evil.example' } }));
  });
  // CONTRACT §15.7 #5 — kinds probe_sqli / probe_xss / probe_traversal
  for (const [kind, label, urls] of [
    ['probe_sqli', 'SQL injection strings', ["api/chat/list.php?after=1%20UNION%20SELECT%201,2,3--", "api/time.php?id=1'%20OR%20'1'='1"]],
    ['probe_xss', 'script payloads', ['api/chat/list.php?after=%3Cscript%3Ealert(1)%3C/script%3E', 'api/time.php?q=%22%3E%3Cimg%20src=x%20onerror=alert(1)%3E']],
    ['probe_traversal', 'path traversal strings', ['api/time.php?file=../../../../etc/passwd', 'api/chat/list.php?after=..%2f..%2f..%2fconfig%2fconfig.local.php']],
  ]) {
    await check('S05', `${label} in a request are written to security_events (${kind})`, { sev: 'medium', fix: EV_FIX + ' A cheap pattern scan of the query string and JSON body in the entry guard is enough.' }, async () => {
      const ip = `203.0.113.${110 + kind.length}`;
      return logged([kind], ip, async () => { for (const u of urls) await request(s, u, { xff: ip }); });
    });
  }
  // CONTRACT §15.7 #5 — kind login_locked
  await check('S05', 'a login lockout (5 wrong passwords) is written to security_events (login_locked)', { sev: 'medium', fix: EV_FIX }, async () => {
    const ip = '203.0.113.120';
    const target = await newUser(s, 'Lck', { xff: '198.51.100.31' });
    const c = await anon(s, { xff: ip });
    return logged(['login_locked'], ip, async () => { for (let i = 0; i < 6; i++) await login(c, target.email, `Wrong${i}pass9`); });
  });
  // CONTRACT §15.7 #5 — kind admin_denied
  await check('S05', 'a player knocking on an admin endpoint is written to security_events (admin_denied)', { sev: 'medium', fix: EV_FIX }, async () => {
    const ip = '203.0.113.121';
    await admin(s);
    const u = await newUser(s, 'Knk', { xff: ip });
    return logged(['admin_denied'], ip, () => u.req('api/admin/stats.php'));
  });
  // CONTRACT §15.7 #5 — kind upload_rejected
  await check('S05', 'a rejected upload (PHP inside a PNG) is written to security_events (upload_rejected)', { sev: 'medium', fix: EV_FIX }, async () => {
    const ip = '203.0.113.122';
    const u = await newUser(s, 'Upl', { xff: ip });
    return logged(['upload_rejected'], ip, () => u.req('api/journal/upload.php', { multipart: { files: [{ name: 'a.png', data: makePng(4, 4, [pngText('Comment', '<?php system($_GET["c"]); ?>')]) }] } }));
  });
  // CONTRACT §15.7 #5 — kind save_rejected
  await check('S05', 'a cheating save (+1,000,000 coins) is written to security_events (save_rejected)', { sev: 'medium', fix: EV_FIX }, async () => {
    const ip = '203.0.113.123';
    const u = await newUser(s, 'Cht', { xff: ip });
    const st = freshState(u.user);
    const first = await u.json('api/player/save.php', saveBody(st));
    assert(first.status === 200, `first save → ${first.status}`);
    return logged(['save_rejected'], ip, async () => { const x = structuredClone(st); x.stats.coin += 1000000; x.savedAt = Date.now(); const r = await u.json('api/player/save.php', saveBody(x)); assert(r.status === 409, `the cheating save was answered ${r.status}`); });
  });
  // CONTRACT §15.7 #5 / #15 — kind payment_tamper
  await check('S05', 'a tampered payment amount is written to security_events (payment_tamper)', { sev: 'high', fix: EV_FIX }, async () => {
    const ip = '203.0.113.124';
    const u = await newUser(s, 'Pay', { xff: ip });
    const o = await u.json('api/sub/prepare.php', { tier: 4, kind: 'card' });
    assert(o.status === 200 && o.data, `prepare → ${o.status} ${(o.error && o.error.code) || ''}`);
    return logged(['payment_tamper'], ip, () => u.json('api/sub/confirm.php', { paymentKey: 'mock_' + o.data.orderId, orderId: o.data.orderId, amount: 100 }));
  });
  // CONTRACT §15.7 #5 — honeypot: scanner bait paths rewritten to api/trap.php
  await check('S05', 'api/trap.php (the target of the bait-path rewrite) answers 403 / 404 and writes a honeypot event', { sev: 'medium', fix: 'Add api/trap.php: Firewall::check(), SecEvent::log("honeypot"), 404 without a body; rewrite the bait paths to it in the root .htaccess.' }, async () => {
    const ip = '203.0.113.125';
    return logged(['honeypot'], ip, async () => { const r = await request(s, 'api/trap.php?p=/.env', { xff: ip }); assert([403, 404].includes(r.status), `api/trap.php → ${r.status}`); });
  });
  // CONTRACT §15.7 #5 — auto-block: ≥ 25 attack-like events from one address within 600 s → 403 IP_BLOCKED
  await check('S05', 'repeated attacks from one address end in 403 IP_BLOCKED (ip_blocks row), other addresses keep working', { sev: 'high', fix: 'Add Tfm\\Firewall::check() first in every entry point (ip_blocks → 403 IP_BLOCKED) and the auto-block (security.block.threshold 25 / window 600 s / duration 1800 s doubling), localhost and security.block.exempt excluded.' }, async () => {
    const bad = '203.0.113.200', good = '198.51.100.7';
    const atk = await anon(s, { xff: bad });
    let at = 0, last = null;
    for (let i = 1; i <= 90 && !at; i++) {
      // what a scanner sends: forged logins, injection strings, bait paths
      const r = i % 3 === 0 ? await atk.req("api/chat/list.php?after=1'%20OR%20'1'='1")
        : i % 3 === 1 ? await atk.json('api/auth/login.php', { login: "admin'--", password: 'x' }, { csrf: false, headers: { Origin: 'https://evil.example' } })
          : await atk.req('api/trap.php?p=/wp-login.php');
      last = r;
      if (r.status === 403 && r.error && r.error.code === 'IP_BLOCKED') at = i;
    }
    assert(at, `90 attack-like requests from ${bad} and no 403 IP_BLOCKED (last answer: ${last.status} ${(last.error && last.error.code) || ''})`);
    const again = await request(s, 'api/time.php', { xff: bad });
    assert(again.status === 403 && again.error && again.error.code === 'IP_BLOCKED', `an ordinary request from the blocked address → ${again.status}`);
    const other = await request(s, 'api/time.php', { xff: good });
    assert(other.status === 200, `another address → ${other.status}`);
    const rows = dbQuery(s, 'SELECT ip, until_at FROM ip_blocks');
    assert(rows.some((r) => r.ip === bad && Number(r.until_at) > Date.now()), `no active ip_blocks row for ${bad}`);
    const ev = events(s);
    assert(!ev.error && ev.some((e) => e.kind === 'ip_blocked'), 'no ip_blocked event');
    return `blocked at request ${at}; ${good} still served`;
  });
  // CONTRACT §15.7 #5 — bait paths inside the install folder are answered 403 / 404
  await check('S05', 'bait paths give nothing away on the built-in server (403 / 404; a folder URL only gets the public start page)', { sev: 'low', fix: 'Nothing to fix while these stay 403 / 404.' }, async () => {
    const m = await srv('main');
    const home = await request(m, 'index.html');
    const out = [];
    for (const p of BAITS) {
      const r = await request(m, p, { headers: { Accept: '*/*' } });
      const shell = r.status === 200 && r.buf.length === home.buf.length;   // php -S serves the nearest index.html for unknown folders
      assert([403, 404].includes(r.status) || shell, `/${p} → ${r.status} (${r.buf.length} bytes)`);
      out.push(shell ? 'start page' : r.status);
    }
    return `${BAITS.length} paths → ${[...new Set(out)].join(' / ')}`;
  });
  // CONTRACT §15.7 #5 — honeypot through the .htaccess rewrite
  await check('S05', 'Apache: bait paths (/.env, /wp-login.php, /phpmyadmin/, /.git/config, /config.php.bak …) are answered 403 / 404', { ...APACHE_MODE, sev: 'medium', fix: 'Keep the FilesMatch denies.' }, async () => {
    const a = await apache();
    if (a instanceof Skip) return a;
    for (const p of BAITS) { const r = await request(a, p, { headers: { Accept: '*/*' } }); assert([403, 404].includes(r.status), `/${p} → ${r.status}`); }
    return `${BAITS.length} paths → 403 / 404`;
  });
  await check('S05', 'Apache: every bait path is rewritten to the trap and logged as a honeypot event (also in a sub-folder installation)', { ...APACHE_MODE, sev: 'medium', fix: 'Root .htaccess: RewriteRule for the scanner paths → api/trap.php (relative, so /metaverse/… works too); trap.php logs kind "honeypot" with the requested path.' }, async () => {
    const a = await apache();
    if (a instanceof Skip) return a;
    const before = events(a);
    assert(!before.error, `security_events cannot be read: ${before.error}`);
    const paths = ['.env', 'wp-login.php', 'phpmyadmin/', '.git/config', 'config.php.bak'];
    for (const p of paths) { await request(a, p); await request(a.alias(), p); }
    const fresh = events(a).slice(before.length).filter((e) => e.kind === 'honeypot');
    assert(fresh.length >= paths.length * 2, `${fresh.length} honeypot rows for ${paths.length * 2} bait requests`);
    return `${fresh.length} honeypot rows`;
  });
  await stopServer('fw');
}

// =============================================================================
// S06 — admin path locked (CONTRACT §15.4)
// =============================================================================
async function S06() {
  if (!want('S06')) return;
  const s = await srv('main');
  const adm = await admin(s);
  const player = await actor(s, 'A');
  const SITE_FIX = 'Build the separate admin site of CONTRACT §15.4 (server/admin/index.php), make server/admin.php a bare 404 and let api/auth/me.php return adminUrl to admins only.';
  // CONTRACT §15.4 — the old server/admin.php answers 404 (no redirect — it must not reveal the new path)
  await check('S06', 'the phase-6 address /admin.php answers 404 (no redirect, no hint)', { sev: 'high', fix: SITE_FIX }, async () => {
    for (const c of [new Client(s), player, adm]) {
      const r = await c.req('admin.php', { headers: HTML });
      assert(r.status === 404, `/admin.php → ${r.status}${isSignIn(r) ? ' (the admin sign-in form is still served at the well-known address)' : ''}`);
      assert(!r.headers.location && !/admin\//.test(r.text), 'the answer points to the new address');
    }
    return 'anonymous · player · admin → 404';
  });
  // CONTRACT §15.4 — location: its own folder; sign-in = shared login + role check
  await check('S06', 'the admin site lives in its own folder: an anonymous visitor only gets a sign-in form', { sev: 'high', fix: SITE_FIX }, async () => {
    const site = await adminSite(s);
    assert(site, NO_ADMIN_SITE);
    const r = await request(s, site, { headers: HTML });
    assert(isSignIn(r), `${site} → ${r.status} without a sign-in form`);
    assert(!r.text.includes(adm.email) && !r.text.includes(player.nick), 'account data is visible before signing in');
    for (const tab of ['users', 'sub', 'security', 'audit']) { const t = await request(s, `${site}?tab=${tab}`, { headers: HTML }); assert(!isAdminUi(t) && !t.text.includes(player.email), `?tab=${tab} is readable without signing in`); }
    return `${site}: sign-in form only`;
  });
  await check('S06', 'the admin site refuses a signed-in player (no admin data)', { sev: 'high', fix: SITE_FIX }, async () => {
    const site = await adminSite(s);
    assert(site, NO_ADMIN_SITE);
    const c = new Client(s);
    const page = await adminSignIn(c, site, player.email, PASSWORD);
    assert(!isAdminUi(page), 'a player account got the admin UI');
    const users = await c.req(`${site}?tab=users`, { headers: HTML });
    assert(!users.text.includes(adm.email), 'the user list is visible to a player');
    return 'a player signs in and sees no admin data';
  });
  await check('S06', 'an admin gets the dashboard; api/auth/me.php hands the admin address to admins only', { sev: 'medium', fix: SITE_FIX }, async () => {
    const site = await adminSite(s);
    assert(site, NO_ADMIN_SITE);
    const c = new Client(s);
    const page = await adminSignIn(c, site, adm.email, PASSWORD);
    assert(isAdminUi(page), `the admin account does not reach the dashboard (status ${page.status})`);
    const meA = await adm.req('api/auth/me.php'), meP = await player.req('api/auth/me.php'), meN = await request(s, 'api/auth/me.php');
    assert(typeof meA.data.adminUrl === 'string' && meA.data.adminUrl, 'me.php gives the admin no adminUrl');
    assert(meP.data.adminUrl === undefined && meN.data.adminUrl === undefined, 'me.php reveals adminUrl to a player / a visitor');
    return `dashboard with ${tabsOf(page.text).length} tabs; adminUrl only for admins`;
  });
  // CONTRACT §15.4 (e) — X-Robots-Tag: noindex, nofollow · Cache-Control: no-store · Referrer-Policy: no-referrer; no JavaScript at all
  await check('S06', 'admin pages: X-Robots-Tag noindex, Cache-Control no-store, Referrer-Policy no-referrer and no JavaScript at all', { sev: 'medium', fix: 'Send X-Robots-Tag: noindex, nofollow on every admin answer (the header, not only the meta element).' }, async () => {
    const { c, entry, page } = await adminBrowser(s);
    const pages = [await request(s, entry, { headers: HTML }), page];
    for (const tab of tabsOf(page.text)) pages.push(await c.req(`${entry}?tab=${tab}`, { headers: HTML }));
    for (const r of pages) {
      const where = new URL(r.url).search || '(sign-in)';
      assert(/noindex/i.test(r.headers['x-robots-tag'] || '') && /nofollow/i.test(r.headers['x-robots-tag'] || ''), `${entry}${where}: X-Robots-Tag is "${r.headers['x-robots-tag'] || '(missing)'}"`);
      assert(/no-store/.test(r.headers['cache-control'] || ''), `${where}: Cache-Control ${r.headers['cache-control']}`);
      assert(r.headers['referrer-policy'] === 'no-referrer', `${where}: Referrer-Policy ${r.headers['referrer-policy']}`);
      assert(!/<script\b/i.test(r.text) && !/\son[a-z]+\s*=\s*["']/i.test(r.text) && !/href\s*=\s*["']\s*javascript:/i.test(r.text), `${where}: the page contains script / inline handlers`);
      assert(!/script-src [^;]*(?:unsafe|\*|https?:)/.test(r.headers['content-security-policy'] || ''), `${where}: the CSP allows scripts`);
    }
    return `${pages.length} pages of ${entry}`;
  });
  // CONTRACT §15.4 (b) — security.admin_ip_allowlist: other addresses get the same 404 as a missing page + admin_ip_denied
  await check('S06', 'IP allow-list (TFM_ADMIN_IPS): other addresses get a plain 404, the listed address gets in', { sev: 'high', fix: 'Admin entry: when security.admin_ip_allowlist is set and Http::clientIp() is not in it → 404 exactly like a missing page + SecEvent admin_ip_denied.' }, async () => {
    const site = await adminSite(s);
    assert(site, NO_ADMIN_SITE + ' — without it a 404 proves nothing');
    const lock = await srv('adminip');
    for (const xff of ['198.51.100.20', null]) {
      for (const p of [site, `${site}?tab=users`, 'admin.php']) {
        const r = await request(lock, p, { headers: HTML, xff });
        assert(r.status === 404 && !/<form|password/i.test(r.text), `${p} from ${xff || '127.0.0.1'} → ${r.status}`);
      }
    }
    const ok = await request(lock, site, { headers: HTML, xff: '203.0.113.9' });
    assert(isSignIn(ok), `the listed address 203.0.113.9 → ${ok.status}`);
    const ev = events(lock);
    assert(!ev.error && ev.some((e) => e.kind === 'admin_ip_denied'), 'no admin_ip_denied event');
    return '198.51.100.20 and 127.0.0.1 → 404 · 203.0.113.9 → sign-in page · event logged';
  });
  // CONTRACT §15.4 (c) — TOTP 2-step (RFC 6238 SHA-1 / 30 s / 6 digits, replay-protected by last_step)
  await check('S06', '2-step sign-in (TFM_ADMIN_2FA=required): the password alone does not open the admin site; a TOTP code does, a wrong or replayed code does not', { sev: 'high', fix: 'Tfm\\Totp + admin_totp table: enrolment page (secret as text + otpauth:// URI), code form, ±1 step, last_step replay guard, 10 hashed backup codes.' }, async () => {
    const s2 = await srv('admin2fa');
    const a2 = await admin(s2);
    const site = await adminSite(s2);
    assert(site, NO_ADMIN_SITE);
    const c = new Client(s2);
    let page = await adminSignIn(c, site, a2.email, PASSWORD);
    assert(!isAdminUi(page), 'the password alone opened the admin site although TFM_ADMIN_2FA=required');
    const deep = await c.req(`${site}?tab=users`, { headers: HTML });
    assert(!isAdminUi(deep) && !deep.text.includes(a2.email + '</'), 'admin tabs are readable before the second step');
    const secret = ((page.text.match(/otpauth:\/\/totp\/[^"'<\s]*[?&](?:amp;)?secret=([A-Z2-7]{16,})/i) || page.text.match(/\b((?:[A-Z2-7]{4}[ -]?){4,})\b/) || [])[1] || '').replace(/[ -]/g, '');
    assert(secret.length >= 16, 'the enrolment page shows no TOTP secret / otpauth:// URI');
    const codeForm = (html) => parseForms(html).find((f) => f.method === 'post' && f.fields.some((x) => /code|otp|totp/i.test(x.name) && !/csrf/i.test(x.name)));
    const fieldOf = (f) => f.fields.find((x) => /code|otp|totp/i.test(x.name) && !/csrf/i.test(x.name)).name;
    let form = codeForm(page.text);
    assert(form, 'no code form on the second-step page');
    const good = totp(secret);
    const wrong = String((Number(good) + 1) % 1000000).padStart(6, '0');
    page = await follow(c, await submitForm(c, page.url, form, { [fieldOf(form)]: wrong }));
    assert(!isAdminUi(page) && !isAdminUi(await c.req(site, { headers: HTML })), 'a wrong code was accepted');
    form = codeForm(page.text) || codeForm((await c.req(site, { headers: HTML })).text);
    assert(form, 'the code form is gone after a wrong code');
    await follow(c, await submitForm(c, page.url, form, { [fieldOf(form)]: totp(secret) }));
    assert(isAdminUi(await c.req(site, { headers: HTML })), 'the correct TOTP code does not open the admin site');
    // replay: a second browser with the password and the very same code of this 30-second step
    const c2 = new Client(s2);
    const p2 = await adminSignIn(c2, site, a2.email, PASSWORD);
    const f2 = codeForm(p2.text);
    assert(f2, 'no code form for a second sign-in');
    await follow(c2, await submitForm(c2, p2.url, f2, { [fieldOf(f2)]: totp(secret) }));
    assert(!isAdminUi(await c2.req(site, { headers: HTML })), 'the same code was accepted twice within its time step (no replay protection)');
    return 'password → code page; wrong code refused; code accepted once; replay refused';
  });
  // CONTRACT §15.4 (d) — admin elevation expires after security.admin_idle without admin requests
  await check('S06', 'admin idle timeout (TFM_ADMIN_IDLE=2): the elevation ends after the idle time while the player session lives on', { sev: 'medium', fix: 'Keep an "admin elevated until" stamp in the session, refreshed by admin requests only; after security.admin_idle seconds ask for the password (+ code) again.' }, async () => {
    const s3 = await srv('adminidle');
    const a3 = await admin(s3);
    const site = await adminSite(s3);
    assert(site, NO_ADMIN_SITE);
    const c = new Client(s3);
    const page = await adminSignIn(c, site, a3.email, PASSWORD);
    assert(isAdminUi(page), `the admin account does not reach the dashboard (status ${page.status})`);
    await sleep(3600);
    const me = await c.req('api/auth/me.php');
    assert(me.data && me.data.user, 'the player session ended as well (only the admin elevation may expire)');
    const later = await c.req(site, { headers: HTML });
    assert(!isAdminUi(later), 'still inside the admin site 3.6 s after the last admin request (TFM_ADMIN_IDLE=2)');
    return 'elevation gone after 3.6 s, player session alive';
  });
  // CONTRACT §15.4 — the admin sees everything, nobody else: admin API needs the role
  await check('S06', 'admin API endpoints need the admin role: anonymous 401, player 403', { sev: 'high', fix: 'Keep \'admin\' => true on every admin endpoint.' }, async () => {
    const list = [...apiFiles(s.docroot).filter((f) => f.startsWith('api/admin/')), 'api/sub/grant.php', 'api/sub/renew.php'];
    const posts = await postEndpoints(s);
    const visitor = await anon(s);
    for (const ep of list) {
      const post = posts.includes(ep);
      const v = post ? await visitor.json(ep, {}) : await visitor.req(ep);
      assert(v.status === 401, `${ep} for a visitor → ${v.status}`);
      const p = post ? await player.json(ep, { userId: player.user.id, tier: 4, days: 30 }) : await player.req(ep);
      assert(p.status === 403 && p.error.code === 'FORBIDDEN', `${ep} for a player → ${p.status} ${(p.error && p.error.code) || ''}`);
    }
    const me = await player.req('api/auth/me.php');
    assert(me.data.sub.tier === 1, 'the player could raise the tier through an admin endpoint');
    return `${list.length} endpoints: 401 / 403`;
  });
  // CONTRACT §15.4 (c) — sign-in = the shared throttled login
  await check('S06', 'admin sign-in is throttled like the player login: after 5 wrong passwords the right one is refused too', { sev: 'high', fix: 'Keep Auth::attemptLogin() as the only sign-in path of the admin site.' }, async () => {
    const entry = await adminPage(s);
    assert(entry, 'this build has no admin page');
    await actor(s, 'admin2', { admin: true });
    const c = new Client(s);
    for (let i = 0; i < 5; i++) assert(!isAdminUi(await adminSignIn(c, entry, ADMIN2_EMAIL, `Wrong${i}pass9`)), `a wrong password opened the admin page (try ${i + 1})`);
    assert(!isAdminUi(await adminSignIn(c, entry, ADMIN2_EMAIL, PASSWORD)), 'the correct password still works after 5 failures (no lockout on the admin page)');
    const api = await login(await anon(s), ADMIN2_EMAIL);
    assert(api.status === 429 && Number(api.headers['retry-after']) > 0, `the API login for the same account → ${api.status}`);
    return `locked after 5 failures (Retry-After ${api.headers['retry-after']}s)`;
  });
  for (const n of ['adminip', 'admin2fa', 'adminidle']) await stopServer(n);
}

// =============================================================================
// S07 — parameterized queries (SQL injection)
// =============================================================================
const SQLI = ["' OR '1'='1", "' OR 1=1-- ", '" OR ""="', "admin'-- ", "') OR ('1'='1", "' OR 1=1 LIMIT 1-- ", "' UNION SELECT 1,2,3,4,5,6,7,8,9,10-- ", "'; DROP TABLE users; -- ", "1; UPDATE users SET role='admin'-- ", "' OR email LIKE '%", "\\' OR 1=1-- ", "%' OR '1'='1"];
const SQLI_SLOW = ["' OR SLEEP(3)-- ", "'; SELECT SLEEP(3); -- ", "' OR IF(1=1,SLEEP(3),0)-- ", "' OR randomblob(300000000) IS NOT NULL-- ", "' UNION SELECT SLEEP(3),2,3-- "];
async function S07() {
  if (!want('S07')) return;
  const s = await srv('main');
  const adm = await admin(s);
  const victim = await actor(s, 'sqlvictim');
  const noSqlText = (r, what) => assert(!SQL_ERR_RX.test(r.text), `${what}: database error text in the answer — ${oneLine(r.text, 120)}`);
  // CONTRACT §15.7 #7 — SQLi payload tests on login
  await check('S07', 'login: classic, boolean, UNION and stacked payloads never authenticate and never surface a database error', { sev: 'high', fix: 'Keep every query on Db::run/one/all with bound parameters.' }, async () => {
    const c = await anon(s);
    for (const p of SQLI) {
      const r = await login(c, p, 'x1234567a');
      assert([400, 401].includes(r.status) && !(r.data && r.data.user), `login "${p}" → ${r.status}`);
      noSqlText(r, `login "${p}"`);
    }
    for (const p of SQLI.slice(0, 4)) {
      const r = await login(c, victim.email, p);
      assert([400, 401].includes(r.status) && !(r.data && r.data.user), `password "${p}" → ${r.status}`);
      noSqlText(r, `password "${p}"`);
    }
    const t = await login(c, `${victim.email}' AND '1'='1`, PASSWORD), f = await login(c, `${victim.email}' AND '1'='2`, PASSWORD);
    assert(t.status === f.status && t.status !== 200 && (t.error && t.error.code) === (f.error && f.error.code), `boolean pair answers differ: ${t.status} vs ${f.status}`);
    assert((await c.req('api/auth/me.php')).data.user === null, 'the browser is logged in after the payloads');
    const ok = await login(await anon(s), victim.email);
    assert(ok.status === 200 && ok.data.user.id === victim.user.id && ok.data.user.role === 'user', `the real account is damaged: login → ${ok.status}`);
    return `${SQLI.length + 6} payloads: 400 / 401, accounts intact`;
  });
  await check('S07', 'login: time-based payloads cause no measurable delay', { sev: 'high', fix: 'Keep bound parameters; never concatenate.' }, async () => {
    const c = await anon(s);
    const base = (await login(c, `nobody_${RUN}@example.com`, 'Wrong1pass9')).ms;
    const out = [];
    for (const p of SQLI_SLOW) {
      const r = await login(c, p, 'Wrong1pass9');
      assert(r.ms < base + 1500, `"${p}" took ${r.ms} ms (baseline ${base} ms)`);
      noSqlText(r, p);
      out.push(r.ms);
    }
    return `baseline ${base} ms, payloads ${Math.min(...out)}–${Math.max(...out)} ms`;
  });
  // CONTRACT §15.7 #7 — nickname / e-mail / chat: stored literally or refused
  await check('S07', 'register and chat: SQL payloads are refused by validation or stored literally (the tables survive)', { sev: 'high', fix: 'Keep bound parameters.' }, async () => {
    const c = await anon(s);
    for (const p of ["x' OR '1'='1", "a'); DROP TABLE users;--", 'x" OR 1=1--']) {
      const r = await register(c, nextEmail('sq'), p);
      assert(isCleanError(r), `nickname "${p}" → ${r.status}`);
      const e = await register(c, `${p}@example.com`, nextNick('Sq'));
      assert(isCleanError(e), `e-mail "${p}@example.com" → ${e.status}`);
      noSqlText(r, 'register'); noSqlText(e, 'register');
    }
    const text = "Robert'); DROP TABLE chat_messages;-- \" OR \"\"=\"";
    const sent = await victim.json('api/chat/send.php', { text, channel: 'all' });
    assert(sent.status === 200 && sent.data.message.text === text, `chat → ${sent.status}`);
    const list = await victim.req('api/chat/list.php');
    assert(list.status === 200 && list.data.messages.some((m) => m.text === text), 'the payload did not round-trip literally');
    return 'refused or stored literally';
  });
  // CONTRACT §15.7 #7 — numeric ids, paging parameters
  await check('S07', 'numeric ids and paging parameters (after, limit, rafter, messageId, targetId, userId, orderId): payloads change nothing', { sev: 'high', fix: 'Keep the digit-only checks before the bound parameter.' }, async () => {
    const u = await newUser(s, 'Idp');
    for (const v of ['1 OR 1=1', '1;DROP TABLE users', '1 UNION SELECT 1,2,3,4,5,6,7,8', "1'", '0x1', '1e1', '-1 OR 1=1', '(SELECT 1)']) {
      for (const k of ['after', 'limit']) {
        const r = await u.req(`api/chat/list.php?${k}=${encodeURIComponent(v)}`);
        assert(r.status === 400, `${k}=${v} → ${r.status}`);
        noSqlText(r, `${k}=${v}`);
      }
      const ra = await u.req(`api/chat/list.php?after=1&rafter=${encodeURIComponent(v)}`);
      assert(ra.status < 500 && ra.ms < 2000, `rafter=${v} → ${ra.status} in ${ra.ms} ms`);
      noSqlText(ra, `rafter=${v}`);
    }
    for (const v of ['1 OR 1=1', "1' OR '1'='1", '1; DROP TABLE chat_messages']) {
      const r = await u.json('api/chat/report.php', { target: victim.nick, reason: 'spam', messageId: v, targetId: v });
      assert(r.status < 500, `report ids "${v}" → ${r.status}`);
      noSqlText(r, 'report');
    }
    const o = await u.json('api/sub/prepare.php', { tier: 2, kind: 'card' });
    assert(o.status === 200, `prepare → ${o.status}`);
    for (const v of ["' OR '1'='1", `${o.data.orderId}' OR '1'='1`, "x' UNION SELECT 1-- "]) {
      const r = await u.json('api/sub/confirm.php', { paymentKey: 'mock_' + o.data.orderId, orderId: v, amount: o.data.amount });
      assert(isCleanError(r), `orderId "${v}" → ${r.status}`);
      const k = await u.json('api/sub/confirm.php', { paymentKey: v, orderId: o.data.orderId, amount: o.data.amount });
      assert(isCleanError(k), `paymentKey "${v}" → ${k.status}`);
      noSqlText(r, 'confirm'); noSqlText(k, 'confirm');
    }
    const g = await adm.json('api/sub/grant.php', { userId: '1 OR 1=1', tier: 2, days: 1 });
    assert(isCleanError(g), `grant userId payload → ${g.status}`);
    assert((await u.req('api/auth/me.php')).data.sub.tier === 1, 'a payload changed the subscription');
    return 'all refused / ignored, no error text, no delay';
  });
  // CONTRACT §15.7 #7 — search, sort / filter parameters of the admin lists
  await check('S07', 'admin search q and list parameters: payloads never widen the result, break the page or delay it', { sev: 'high', fix: 'Keep LIKE ? with escaped wildcards and whitelisted filters.' }, async () => {
    const { c, entry, page } = await adminBrowser(s);
    const tabs = tabsOf(page.text);
    const userTab = tabs.includes('users') ? 'users' : tabs[0];
    for (const p of [...SQLI, ...SQLI_SLOW]) {
      const r = await c.req(`${entry}?tab=${userTab}&q=${encodeURIComponent(p)}`, { headers: HTML });
      assert(r.status === 200 && r.ms < 2500, `q="${p}" → ${r.status} in ${r.ms} ms`);
      noSqlText(r, `q="${p}"`);
      assert(!r.text.includes(victim.email), `q="${p}" lists an account that does not match (${victim.email})`);
    }
    for (const tab of tabs) {
      const r = await c.req(`${entry}?tab=${tab}&p=${encodeURIComponent('1 OR 1=1')}&before=${encodeURIComponent('1 UNION SELECT 1')}&uid=${encodeURIComponent("1' OR '1'='1")}&ev=${encodeURIComponent("x' OR '1'='1")}&sev=${encodeURIComponent("warn' OR 1=1-- ")}&status=${encodeURIComponent("pending' OR 1=1-- ")}&sort=${encodeURIComponent('id; DROP TABLE users')}&order=${encodeURIComponent('ASC, (SELECT 1)')}&show=${encodeURIComponent("all' OR 1=1")}`, { headers: HTML });
      assert(r.status === 200 && r.ms < 2500, `tab ${tab} with payload parameters → ${r.status} in ${r.ms} ms`);
      noSqlText(r, `tab ${tab}`);
    }
    const ok = await c.req(`${entry}?tab=${userTab}&q=${encodeURIComponent(victim.email)}`, { headers: HTML });
    assert(ok.text.includes(victim.email), 'the search itself does not find a real account (the test would prove nothing)');
    return `${SQLI.length + SQLI_SLOW.length} search payloads + ${tabs.length} tabs: normal pages`;
  });
  // CONTRACT §15.7 #1 / #7 — MariaDB: multi-statements off, bound parameters
  await check('S07', 'MariaDB: time-based (SLEEP) and stacked (; DROP …) payloads cause no delay and no damage', { sev: 'high', fix: 'Keep PDO::ATTR_EMULATE_PREPARES=false and MYSQL_ATTR_MULTI_STATEMENTS=false.' }, async () => {
    const my = mysqlFixture();
    const no = needMaria(my);
    if (no) return no;
    const m = await srv('myapp');
    const c = await anon(m);
    const base = (await login(c, `nobody_${RUN}@example.com`, 'Wrong1pass9')).ms;
    for (const p of [...SQLI_SLOW, "'; DROP TABLE chat_messages; -- ", "' OR BENCHMARK(30000000,MD5(1))-- "]) {
      const r = await login(c, p, 'Wrong1pass9');
      assert([400, 401].includes(r.status) && r.ms < base + 1500, `"${p}" → ${r.status} in ${r.ms} ms (baseline ${base} ms)`);
      noSqlText(r, p);
      const q = await c.req(`api/chat/list.php?after=${encodeURIComponent(p)}`);
      assert(q.status === 400 && q.ms < 1500, `after="${p}" → ${q.status} in ${q.ms} ms`);
    }
    assert(mysqlRoot(["SHOW TABLES LIKE 'chat_messages'"], my.db)[0].length === 1, 'chat_messages is gone');
    return `baseline ${base} ms; nothing slower, table intact`;
  });
}

// =============================================================================
// S08 — environment / configuration
// =============================================================================
async function S08() {
  if (!want('S08')) return;
  const s = await srv('main');
  const adm = await admin(s);
  const A = await actor(s, 'A');
  // CONTRACT §15.7 #8 — only the Toss client key may reach a browser
  await check('S08', 'payment keys: only a client key is ever sent to the browser, never a secret key', { sev: 'high', fix: 'Keep the secret key inside Toss.php.' }, async () => {
    const st = await A.req('api/sub/status.php');
    assert(st.status === 200, `status → ${st.status}`);
    const order = await A.json('api/sub/prepare.php', { tier: 2, kind: 'card' });
    const texts = [st.text, order.text, (await A.req('api/auth/me.php')).text, (await adm.req('api/admin/health.php?quick=1')).text, (await adm.req('api/admin/stats.php')).text].join('\n');
    assert(!/(?:test|live)_g?sk_/.test(texts), 'a secret key (…_sk_…) appears in an answer');
    const ck = st.data.clientKey;
    assert(ck === '' || ck === null || typeof ck === 'string' && !/_g?sk_/.test(ck), `clientKey is ${JSON.stringify(ck)}`);
    return `clientKey ${ck ? ck.replace(/(_g?ck_).*/, '$1…') : '(empty: payments not configured)'}`;
  });
  // CONTRACT §15.7 #8 — no secret has a default in the repository: the Toss documentation keys are gone
  await check('S08', 'no documentation default key is served: the public payment sample keys are gone', { sev: 'medium', fix: 'Remove the documentation keys from config.php / Toss.php: empty default → status "unconfigured" unless mock mode is on.' }, async () => {
    const st = await A.req('api/sub/status.php');
    const order = await A.json('api/sub/prepare.php', { tier: 2, kind: 'card' });
    const tokens = [...new Set([...(st.text + order.text).matchAll(KEY_TOKEN_RX)].map((m) => m[0]))];
    const doc = tokens.filter((t) => DOC_KEY_DIGESTS.has(sha256(t)));
    assert(!doc.length, `api/sub/status.php hands out the public documentation sample key ${String(doc[0] || '').slice(0, 10)}… as clientKey (a default that lives in the repository)`); // the message is built before the test: no doc[0] when the key is gone
    return tokens.length ? `key served: ${tokens[0].slice(0, 8)}… (not a sample key)` : 'no key served (unconfigured)';
  });
  // CONTRACT §15.7 #8 — nothing about the environment for visitors
  await check('S08', 'public answers (ping, time, me, status, ranking, chat list, errors) reveal no PHP version, path, driver detail or environment value', { sev: 'medium', fix: 'Keep environment details in the admin health check only.' }, async () => {
    const v = await anon(s);
    const seen = [];
    for (const p of ['api/ping.php', 'api/time.php', 'api/auth/me.php', 'api/sub/status.php', 'api/ranking/top.php', 'api/chat/list.php', 'api/player/get.php', 'api/admin/health.php', 'api/admin/stats.php', 'api/auth/login.php']) {
      const r = await v.req(p);
      const leaks = debugLeaks(r.text + JSON.stringify(r.headers), s);
      assert(!leaks.length, `${p}: ${leaks.join(', ')}`);
      assert(!/"(?:php|phpVersion|os|sapi|docroot|dataDir|env|server_software)"\s*:/i.test(r.text), `${p}: an environment field is public — ${oneLine(r.text, 120)}`);
      seen.push(r.status);
    }
    return `10 endpoints (${[...new Set(seen)].join('/')}): nothing`;
  });
  // CONTRACT §15.7 #8 — the health report is for admins and never prints a secret
  await check('S08', 'the health report is admin-only and prints no secret value (keys only as yes / no)', { sev: 'high', fix: 'Keep Health behind the admin role; print booleans for keys.' }, async () => {
    const v = await request(s, 'api/admin/health.php');
    assert(v.status === 401, `visitor → ${v.status}`);
    const p = await A.req('api/admin/health.php');
    assert(p.status === 403, `player → ${p.status}`);
    const h = await adm.req('api/admin/health.php?quick=1');
    assert(h.status === 200 && Array.isArray(h.data.checks), `admin → ${h.status}`);
    for (const [val, what] of serverSecrets(s)) assert(!h.text.includes(val), `the report contains ${what}`);
    for (const [rx, what] of SECRET_RX) assert(!rx.test(h.text), `the report contains ${what}`);
    return `${h.data.checks.length} entries, no secret`;
  });
  // CONTRACT §15.7 #8 — config.local.php / data/secret.php not world-readable, not world-writable
  await check('S08', 'data/secret.php and the data directory are closed to other system users (no world access)', { sev: 'medium', fix: 'Keep 0640 / 0700 (or tighter) on secret files and data/.' }, async () => {
    if (process.platform === 'win32') return skip('file modes mean nothing on Windows');
    const f = path.join(s.dataDir, 'secret.php');
    assert(fs.existsSync(f), 'data/secret.php does not exist');
    const fm = fs.statSync(f).mode & 0o777, dm = fs.statSync(s.dataDir).mode & 0o777;
    assert((fm & 0o007) === 0, `secret.php is 0${fm.toString(8)}`);
    assert((dm & 0o007) === 0, `data/ is 0${dm.toString(8)}`);
    return `secret.php 0${fm.toString(8)}, data/ 0${dm.toString(8)}`;
  });
}

// =============================================================================
// S09 — rate limits
// =============================================================================
async function S09() {
  if (!want('S09')) return;
  const s = await srv('rate');
  const hammer = async (max, fn) => { for (let i = 1; i <= max; i++) { const r = await fn(i); if (r.status === 429) return { at: i, r }; } return { at: 0 }; };
  const judge = (h, label, max) => {
    assert(h.at, `${label}: ${max} requests in a row and no 429`);
    const ra = Number(h.r.headers['retry-after']);
    assert(Number.isInteger(ra) && ra >= 1, `${label}: 429 without a usable Retry-After header ("${h.r.headers['retry-after']}")`);
    assert(h.r.json && h.r.json.success === false && h.r.error && h.r.error.code, `${label}: the 429 body is not the JSON error envelope`);
    return `429 at request ${h.at} (${h.r.error.code}, Retry-After ${ra}s)`;
  };
  const FIX = 'Keep the named limit of the endpoint in config rate_limits.';
  // CONTRACT §15.7 #9 — the tests hammer login …
  await check('S09', 'login: wrong passwords for one account are locked at the 6th try (429 + Retry-After)', { sev: 'high', fix: FIX }, async () => {
    const target = await newUser(s, 'Brt');
    const c = await anon(s);
    return judge(await hammer(8, (i) => login(c, target.email, `Wrong${i}pass9`)), 'login (one account)', 8);
  });
  await check('S09', 'login: guessing across accounts from one address hits the limit within 61 requests (429 + Retry-After)', { sev: 'high', fix: FIX }, async () => {
    const c = await anon(s);
    return judge(await hammer(64, (i) => login(c, `nobody${i}_${RUN}@example.com`, `Wrong${i}pass9`)), 'login (many accounts)', 64);
  });
  // … register
  await check('S09', 'register: one browser is limited within 21 attempts (429 + Retry-After)', { sev: 'medium', fix: FIX }, async () => {
    const c = await anon(s);
    return judge(await hammer(24, () => c.json('api/auth/register.php', { email: 'not-an-email', nickname: 'x', password: 'y', agree: true })), 'register', 24);
  });
  // … save
  await check('S09', 'player/save: limited within 46 requests a minute (429 + Retry-After)', { sev: 'medium', fix: FIX }, async () => {
    const u = await newUser(s, 'Rsv');
    return judge(await hammer(50, () => u.json('api/player/save.php', { version: 1, checksum: '', data: {} })), 'player/save', 50);
  });
  // … chat
  await check('S09', 'chat/send: a second message within the same second is refused (429 + Retry-After)', { sev: 'medium', fix: FIX }, async () => {
    const u = await newUser(s, 'Rch');
    return judge(await hammer(3, (i) => u.json('api/chat/send.php', { text: `빠른 메시지 ${i} ${RUN}`, channel: 'all' })), 'chat/send', 3);
  });
  // … report
  await check('S09', 'chat/report: limited within 11 reports an hour (429 + Retry-After)', { sev: 'medium', fix: FIX }, async () => {
    const u = await newUser(s, 'Rrp');
    return judge(await hammer(14, (i) => u.json('api/chat/report.php', { target: `someone${i}`, reason: 'spam' })), 'chat/report', 14);
  });
  // CONTRACT §15.7 #9 — every endpoint has a named limit
  await check('S09', 'every other endpoint answers 429 + Retry-After within its documented budget', { sev: 'medium', fix: 'Give every endpoint (also new ones) a \'rate\' => name in Api::run and an entry in config rate_limits.' }, async () => {
    const u = await newUser(s, 'Rev'), adm = await admin(s);
    const tiny = { multipart: { files: [{ name: 'a.png', data: Buffer.from('not an image') }] } };
    // [endpoint, budget + 1, request]: visitors without a cookie share the per-address bucket
    const plan = {
      'api/ping.php': [61, () => request(s, 'api/ping.php')], 'api/time.php': [121, () => request(s, 'api/time.php')], 'api/auth/me.php': [121, () => request(s, 'api/auth/me.php')],
      'api/chat/list.php': [91, () => request(s, 'api/chat/list.php')], 'api/ranking/top.php': [41, () => request(s, 'api/ranking/top.php')], 'api/sub/status.php': [61, () => request(s, 'api/sub/status.php')],
      'api/player/get.php': [61, () => u.req('api/player/get.php')], 'api/presence/update.php': [91, () => u.json('api/presence/update.php', { x: 1, y: 0, z: 1 })],
      'api/sub/prepare.php': [21, () => u.json('api/sub/prepare.php', { tier: 0, kind: 'card' })], 'api/journal/upload.php': [21, () => u.req('api/journal/upload.php', tiny)],
      'api/admin/stats.php': [121, () => adm.req('api/admin/stats.php')], 'api/sub/webhook.php': [121, () => request(s, WEBHOOK, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })],
      'api/sub/return.php': [31, () => request(s, 'api/sub/return.php?fail=1')],
    };
    const shared = { 'api/sub/confirm.php': 'api/sub/prepare.php', 'api/sub/billing-issue.php': 'api/sub/prepare.php', 'api/sub/cancel.php': 'api/sub/prepare.php', 'api/admin/health.php': 'api/admin/stats.php', 'api/sub/grant.php': 'api/admin/stats.php', 'api/sub/renew.php': 'api/admin/stats.php' };
    const done = new Set(['api/auth/login.php', 'api/auth/register.php', 'api/player/save.php', 'api/chat/send.php', 'api/chat/report.php']);
    const posts = await postEndpoints(s);
    const out = [], bad = [];
    const logout = await hammer(760, () => u.json('api/auth/logout.php', {}));   // a new session each time: the per-address ceiling (30 × 25) has to stop it
    if (logout.at) out.push(`logout@${logout.at}`); else bad.push('api/auth/logout.php: 760 requests, no 429');
    done.add('api/auth/logout.php');
    const u2 = await newUser(s, 'Rev');
    for (const f of apiFiles(s.docroot)) {
      if (done.has(f)) continue;
      const [max, fn] = plan[f] || [shared[f] ? 0 : 401, posts.includes(f) ? () => u2.json(f, {}) : () => u2.req(f)];
      if (shared[f]) {   // shares the bucket of an endpoint that is exhausted by now: one more request must be a 429
        const c = /admin|grant|renew/.test(f) ? adm : u;
        const r = posts.includes(f) ? await c.json(f, {}) : await c.req(f);
        if (r.status === 429 && Number(r.headers['retry-after']) >= 1) out.push(`${path.basename(f, '.php')}(shared)`); else bad.push(`${f}: shares the exhausted budget of ${shared[f]} but answered ${r.status}`);
        continue;
      }
      const h = await hammer(max, fn);
      if (h.at && Number(h.r.headers['retry-after']) >= 1) out.push(`${path.basename(f, '.php')}@${h.at}`); else bad.push(`${f}: ${max} requests, ${h.at ? 'a 429 without Retry-After' : 'no 429'}`);
    }
    assert(!bad.length, bad.join('; '));
    return out.join(' ');
  });
  await stopServer('rate');
}

// =============================================================================
// S10 — CORS narrowed
// =============================================================================
const corsHeaders = (r) => Object.entries(r.headers).filter(([k]) => k.startsWith('access-control-')).map(([k, v]) => `${k}: ${v}`);
async function S10() {
  if (!want('S10')) return;
  const PUBLIC_GET = ['api/ping.php', 'api/time.php', 'api/ranking/top.php', 'api/sub/status.php'];
  const preflight = (origin, method = 'POST') => ({ method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Method': method, 'Access-Control-Request-Headers': 'content-type, x-csrf-token' } });
  // CONTRACT §15.7 #10 — default: no Access-Control-* header at all (same-origin only)
  await check('S10', 'default: no Access-Control-* header on any endpoint — GET, POST and preflight from a foreign Origin', { sev: 'high', fix: 'Never add CORS headers unless security.cors_allowed_origins lists the origin.' }, async () => {
    const s = await srv('main');
    const targets = [...apiFiles(s.docroot), 'install.php', 'admin.php', 'admin/'];
    let n = 0;
    for (const p of targets) {
      for (const o of [{ headers: { Origin: 'https://evil.example' } }, preflight('https://evil.example'), { method: 'POST', headers: { Origin: 'https://evil.example', 'Content-Type': 'application/json' }, body: '{}' }, { headers: { Origin: 'null' } }]) {
        if (p === 'api/ping.php') await pacePing(s);
        const r = await request(s, p, o);
        const h = corsHeaders(r);
        assert(!h.length, `${o.method || 'GET'} ${p} → ${h.join(', ')}`);
        if (o.method === 'OPTIONS' && p.startsWith('api/')) assert(r.status >= 400, `preflight ${p} → ${r.status}`);
        n++;
      }
    }
    return `${n} requests to ${targets.length} entry points: none`;
  });
  const s = await srv('cors');
  const OK = 'https://allowed.test';
  const CORS_FIX = 'Add security.cors_allowed_origins (TFM_CORS_ORIGINS): exact origins only; Access-Control-Allow-Origin: <origin> + Vary: Origin on ping, time, ranking/top and sub/status GET answers; nothing else, never credentials.';
  const echoed = async () => { const r = await request(s, 'api/time.php', { headers: { Origin: OK } }); return r.headers['access-control-allow-origin'] === OK; };
  // CONTRACT §15.7 #10 — listed origins get Access-Control-Allow-Origin + Vary: Origin on read-only public GET endpoints
  await check('S10', 'allow-list (TFM_CORS_ORIGINS): the listed origin is echoed exactly, with Vary: Origin, on ping · time · ranking/top · sub/status', { sev: 'medium', fix: CORS_FIX }, async () => {
    for (const p of PUBLIC_GET) {
      const r = await request(s, p, { headers: { Origin: OK } });
      assert(r.status === 200, `${p} → ${r.status}`);
      assert(r.headers['access-control-allow-origin'] === OK, `${p}: Access-Control-Allow-Origin is "${r.headers['access-control-allow-origin'] || '(missing)'}" (the allow-list is not implemented)`);
      assert(/\borigin\b/i.test(r.headers.vary || ''), `${p}: Vary is "${r.headers.vary || '(missing)'}"`);
    }
    return `${PUBLIC_GET.length} endpoints echo ${OK}`;
  });
  await check('S10', 'allow-list: any other origin (look-alike host, other scheme or port, null) gets no CORS header; never "*"', { sev: 'high', fix: CORS_FIX }, async () => {
    assert(await echoed(), 'the allow-list is not implemented (the listed origin itself gets no Access-Control-Allow-Origin): nothing to compare with');
    for (const origin of ['https://evil.example', 'https://allowed.test.evil.example', 'https://evilallowed.test', 'http://allowed.test', 'https://allowed.test:8443', 'https://sub.allowed.test', 'null', 'https://allowed.test%60.evil.example']) {
      for (const p of PUBLIC_GET) {
        const r = await request(s, p, { headers: { Origin: origin } });
        assert(!corsHeaders(r).length, `${p} with Origin ${origin} → ${corsHeaders(r).join(', ')}`);
      }
    }
    return '8 foreign origins × 4 endpoints: no header';
  });
  await check('S10', 'allow-list: never with credentials, and never on POST, private GET endpoints or preflights', { sev: 'high', fix: CORS_FIX + ' Preflight for anything else → 403.' }, async () => {
    assert(await echoed(), 'the allow-list is not implemented (the listed origin itself gets no Access-Control-Allow-Origin): nothing to compare with');
    for (const p of PUBLIC_GET) {
      const r = await request(s, p, { headers: { Origin: OK } });
      assert(r.headers['access-control-allow-credentials'] === undefined && r.headers['access-control-allow-origin'] !== '*', `${p}: ${corsHeaders(r).join(', ')}`);
    }
    const posts = await postEndpoints(s);
    for (const p of apiFiles(s.docroot)) {
      if (!PUBLIC_GET.includes(p)) { const g = await request(s, p, { headers: { Origin: OK } }); assert(!corsHeaders(g).length, `GET ${p} → ${corsHeaders(g).join(', ')}`); }
      if (posts.includes(p)) { const w = await request(s, p, { method: 'POST', headers: { Origin: OK, 'Content-Type': 'application/json' }, body: '{}' }); assert(!corsHeaders(w).length, `POST ${p} → ${corsHeaders(w).join(', ')}`); }
      const pre = await request(s, p, preflight(OK, posts.includes(p) ? 'POST' : 'DELETE'));
      assert(!/POST|PUT|DELETE|PATCH/i.test(pre.headers['access-control-allow-methods'] || '') && pre.headers['access-control-allow-credentials'] === undefined, `preflight ${p} → ${corsHeaders(pre).join(', ')}`);
      if (!PUBLIC_GET.includes(p)) assert(pre.status === 403, `preflight ${p} → ${pre.status} (expected 403)`);
    }
    return 'no credentials, no write methods, private endpoints closed';
  });
  await stopServer('cors');
}

// =============================================================================
// S11 — security headers (matrix over every entry point)
// =============================================================================
/** what is missing from an answer's header set; kind: 'api' | 'page' | 'static' | 'image' */
function headerProblems(r, kind) {
  const h = r.headers, out = [];
  const csp = h['content-security-policy'] || '';
  if (!csp) out.push('no Content-Security-Policy'); else if (kind === 'api' && !/default-src 'none'/.test(csp)) out.push(`CSP "${csp.slice(0, 40)}"`);
  if (h['x-content-type-options'] !== 'nosniff') out.push('no X-Content-Type-Options: nosniff');
  if (!/DENY|SAMEORIGIN/i.test(h['x-frame-options'] || '') && !/frame-ancestors/.test(csp)) out.push('no X-Frame-Options / frame-ancestors');
  if (!/no-referrer|same-origin|strict-origin/.test(h['referrer-policy'] || '')) out.push('no Referrer-Policy');
  if (!h['permissions-policy']) out.push('no Permissions-Policy');
  if (!/same-origin/.test(h['cross-origin-opener-policy'] || '')) out.push('no Cross-Origin-Opener-Policy');
  if (!/same-origin|same-site/.test(h['cross-origin-resource-policy'] || '')) out.push('no Cross-Origin-Resource-Policy');
  if ((kind === 'api' || kind === 'page') && !/no-store/.test(h['cache-control'] || '')) out.push(`Cache-Control "${h['cache-control'] || ''}" without no-store`);
  if (h['x-powered-by']) out.push(`X-Powered-By: ${h['x-powered-by']}`);
  return out;
}
async function S11() {
  if (!want('S11')) return;
  const s = await srv('main');
  const HDR_FIX = 'Send the full set from Http::securityHeaders() on every answer of the entry point.';
  // CONTRACT §15.7 #11 — API: CSP, nosniff, X-Frame-Options, Referrer-Policy, Permissions-Policy, COOP, CORP, no-store, no X-Powered-By
  await check('S11', 'API: every endpoint sends the full header set on normal and on error answers', { sev: 'high', fix: HDR_FIX }, async () => {
    const u = await actor(s, 'A');
    const files = apiFiles(s.docroot);
    const bad = [];
    let n = 0;
    for (const f of files) {
      const kind = f === 'api/sub/return.php' ? 'page' : 'api';
      for (const r of [await request(s, f), await u.req(f), await request(s, f, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{' }), await request(s, f, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: 'x' })]) {
        n++;
        if (kind === 'api' && !/application\/json/.test(r.headers['content-type'] || '') && r.status !== 405) bad.push(`${r.method} ${f} → ${r.status}: Content-Type ${r.headers['content-type']}`);
        const p = headerProblems(r, kind);
        if (p.length) bad.push(`${r.method} ${f} → ${r.status}: ${p.join(', ')}`);
      }
    }
    assert(!bad.length, bad.slice(0, 6).join(' | ') + (bad.length > 6 ? ` (+${bad.length - 6} more)` : ''));
    return `${n} answers of ${files.length} endpoints`;
  });
  // CONTRACT §15.7 #11 — admin
  await check('S11', 'admin page: full header set on the sign-in form and on every tab', { sev: 'high', fix: HDR_FIX }, async () => {
    const { c, entry, page } = await adminBrowser(s);
    const pages = [await request(s, entry, { headers: HTML }), page];
    for (const tab of tabsOf(page.text)) pages.push(await c.req(`${entry}?tab=${tab}`, { headers: HTML }));
    const bad = pages.map((r) => [new URL(r.url).search || '(sign-in)', headerProblems(r, 'page')]).filter(([, p]) => p.length).map(([w, p]) => `${w}: ${p.join(', ')}`);
    assert(!bad.length, bad.slice(0, 5).join(' | '));
    return `${pages.length} pages of ${entry}`;
  });
  // CONTRACT §15.7 #11 — install
  await check('S11', 'install.php: full header set (open and locked)', { sev: 'medium', fix: HDR_FIX }, async () => {
    const bad = [];
    for (const [label, inst] of [['open', s], ['locked', await srv('locked')]]) {
      for (const o of [{ headers: HTML }, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'driver=sqlite' }]) {
        const r = await request(inst, 'install.php', o);
        const p = headerProblems(r, 'page');
        if (p.length) bad.push(`${label} ${r.method} → ${r.status}: ${p.join(', ')}`);
      }
    }
    assert(!bad.length, bad.join(' | '));
    return 'open + locked, GET + POST';
  });
  // CONTRACT §15.7 #11 — no X-Powered-By anywhere
  await check('S11', 'PHP files that are not entry points (lib/, config/, data/, database/, cli/) answer 404 without a body and without X-Powered-By', { sev: 'low', fix: 'Put header_remove(\'X-Powered-By\') in front of the 404 of every direct-access guard (lib/*.php, */index.php, cli/tfm.php), or ship php.ini / .user.ini with expose_php=Off and say so in the health check.' }, async () => {
    const bad = [];
    const list = ['lib/Core.php', 'lib/bootstrap.php', 'lib/Api.php', 'lib/index.php', 'lib/', 'config/config.php', 'config/index.php', 'config/', 'data/index.php', 'data/', 'database/index.php', 'database/', 'cli/tfm.php', 'cli/index.php', 'cli/'];
    for (const p of list) {
      const r = await request(s, p, { headers: { Accept: '*/*' } });
      if (r.status !== 404 || r.buf.length) bad.push(`/${p} → ${r.status} (${r.buf.length} bytes)`);
      else if (r.headers['x-powered-by']) bad.push(`/${p} → X-Powered-By: ${r.headers['x-powered-by']}`);
    }
    assert(!bad.length, `${bad.length} of ${list.length}: ${bad.slice(0, 4).join(' | ')}`);
    return `${list.length} paths → bare 404`;
  });
  // ---- Apache: static files, uploads, error pages, the Server header
  const a = APACHE ? await srv('apache') : null;
  const ap = async () => (a && !a.unavailable ? null : await apache());
  // CONTRACT §15.7 #11 — static (via .htaccess)
  await check('S11', 'Apache: index.html carries the full header set (plus its meta CSP)', { ...APACHE_MODE, sev: 'medium', fix: 'Root .htaccess: add Cross-Origin-Resource-Policy "same-origin" to the static header block.' }, async () => {
    const no = await ap();
    if (no) return no;
    const bad = [];
    for (const p of ['index.html', '']) { const r = await request(a, p, { headers: HTML }); const pr = headerProblems(r, 'static'); if (r.status !== 200 || pr.length) bad.push(`/${p} → ${r.status}: ${pr.join(', ')}`); }
    assert(!bad.length, bad.join(' | '));
    return 'index.html and /';
  });
  await check('S11', 'Apache: other static assets (css, js) carry the full header set', { ...APACHE_MODE, sev: 'low', fix: 'Root .htaccess: set a Content-Security-Policy (default-src \'none\') and CORP for non-HTML static files too.' }, async () => {
    const no = await ap();
    if (no) return no;
    const bad = [];
    for (const p of ['sec-probe.css', 'sec-probe.js']) { const r = await request(a, p, { headers: { Accept: '*/*' } }); const pr = headerProblems(r, 'static'); if (r.status !== 200 || pr.length) bad.push(`/${p} → ${r.status}: ${pr.join(', ')}`); }
    assert(!bad.length, bad.join(' | '));
    return 'css and js';
  });
  await check('S11', 'Apache: an uploaded image is served with nosniff, a sandbox CSP, CORP and an image type', { ...APACHE_MODE, sev: 'high', fix: 'Keep uploads/.htaccess.' }, async () => {
    const no = await ap();
    if (no) return no;
    const u = await actor(a, 'A');
    const up = await u.req('api/journal/upload.php', { multipart: { files: [{ name: 'a.png', data: makePng(8, 8) }] } });
    assert(up.status === 200 && up.data.url, `upload → ${up.status} ${(up.error && up.error.code) || ''}`);
    const r = await request(a, up.data.url, { headers: { Accept: 'image/*' } });
    const pr = headerProblems(r, 'image');
    assert(r.status === 200 && /^image\/(png|jpeg|webp)/.test(r.headers['content-type'] || ''), `${up.data.url} → ${r.status} ${r.headers['content-type']}`);
    assert(!pr.length && /sandbox/.test(r.headers['content-security-policy'] || ''), pr.join(', ') || `CSP "${r.headers['content-security-policy']}" has no sandbox`);
    return `${r.headers['content-type']} · sandbox CSP · nosniff`;
  });
  await check('S11', 'Apache: every API endpoint, the admin page and install.php keep the full header set behind mod_php', { ...APACHE_MODE, sev: 'high', fix: HDR_FIX }, async () => {
    const no = await ap();
    if (no) return no;
    const bad = [];
    const files = apiFiles(a.docroot);
    for (const f of files) { const r = await request(a, f); const pr = headerProblems(r, f === 'api/sub/return.php' ? 'page' : 'api'); if (pr.length) bad.push(`${f} → ${r.status}: ${pr.join(', ')}`); }
    for (const p of [await adminPage(a), 'install.php'].filter(Boolean)) { const r = await request(a, p, { headers: HTML }); const pr = headerProblems(r, 'page'); if (pr.length) bad.push(`${p} → ${r.status}: ${pr.join(', ')}`); }
    assert(!bad.length, bad.slice(0, 5).join(' | '));
    return `${files.length} endpoints + pages`;
  });
  await check('S11', 'Apache: error pages (403 / 404) carry nosniff + a CSP and no server signature', { ...APACHE_MODE, sev: 'low', fix: 'Root .htaccess: "ServerSignature Off" and unconditional "Header always set" lines (outside FilesMatch) for nosniff / CSP / Referrer-Policy so that error documents get them too.' }, async () => {
    const no = await ap();
    if (no) return no;
    const bad = [];
    for (const p of ['no-such-file-' + RUN, 'lib/Core.php', 'data/', '.env', 'uploads/x.php']) {
      const r = await request(a, p, { headers: HTML });
      const miss = [];
      if (r.headers['x-content-type-options'] !== 'nosniff') miss.push('no nosniff');
      if (!r.headers['content-security-policy']) miss.push('no CSP');
      if (/<address>|Apache\/\d|Server at /i.test(r.text)) miss.push(`signature "${oneLine((r.text.match(/<address>([^<]*)/) || [])[1] || 'Apache/x', 50)}"`);
      if (miss.length) bad.push(`/${p} → ${r.status}: ${miss.join(', ')}`);
    }
    assert(!bad.length, bad.slice(0, 3).join(' | '));
    return '5 error pages';
  });
  // CONTRACT §15.7 #11 — no Server version (ServerTokens lives in httpd.conf: the app can only warn the operator)
  await check('S11', 'Apache: the Server header shows no version — or the health check tells the operator to set ServerTokens Prod', { ...APACHE_MODE, sev: 'low', fix: 'ServerTokens cannot be set from .htaccess: add a health / inspect entry (warn) when SERVER_SOFTWARE carries a version, and the httpd.conf line to the install guide.' }, async () => {
    const no = await ap();
    if (no) return no;
    const r = await request(a, 'api/time.php');
    const server = r.headers.server || '';
    if (!/\d/.test(server)) return `Server: ${server || '(none)'}`;
    const h = await (await admin(a)).req('api/admin/health.php?quick=1');
    const warned = h.status === 200 && (h.data.checks || []).some((k) => k.status !== 'ok' && /ServerTokens|서버 버전|server.*version|Server 헤더/i.test(JSON.stringify(k)));
    assert(warned, `Server: ${server} on every answer, and the health check does not mention it`);
    return `Server: ${server} — flagged by the health check`;
  });
  await check('S11', 'Apache: TRACE is refused (no echo of the request headers)', { ...APACHE_MODE, sev: 'low', fix: 'Root .htaccess: RewriteCond %{REQUEST_METHOD} ^(TRACE|TRACK)$ → RewriteRule ^ - [F] (TraceEnable itself is httpd.conf-only).' }, async () => {
    const no = await ap();
    if (no) return no;
    for (const p of ['index.html', 'api/time.php']) {
      const r = await request(a, p, { method: 'TRACE', headers: { 'X-Tfm-Secret': 'tfm-trace-marker' } });
      assert(r.status >= 400 && !r.text.includes('tfm-trace-marker'), `TRACE /${p} → ${r.status}${r.text.includes('tfm-trace-marker') ? ' and the request headers are echoed back' : ''}`);
    }
    return 'TRACE → 4xx';
  });
}

// =============================================================================
// S12 — session cookies
// =============================================================================
function cookieParts(lineOf) {
  const [pair, ...rest] = lineOf.split(';');
  const i = pair.indexOf('=');
  const attrs = {};
  for (const a of rest) { const j = a.indexOf('='); attrs[(j < 0 ? a : a.slice(0, j)).trim().toLowerCase()] = j < 0 ? true : a.slice(j + 1).trim(); }
  return { name: pair.slice(0, i).trim(), value: safeDecode(pair.slice(i + 1).trim()), attrs };
}
async function S12() {
  if (!want('S12')) return;
  const s = await srv('main');
  const sessionCookie = (r) => r.setCookie.map(cookieParts).filter((c) => c.name === 'TFMSESSID');
  // CONTRACT §15.7 #12 — HttpOnly, SameSite=Lax, path = install folder, only cookies
  await check('S12', 'session cookie: HttpOnly, SameSite=Lax, Path = install folder, no Domain, not persistent, a long random id', { sev: 'high', fix: 'Keep Cookie::session().' }, async () => {
    await pacePing(s); await pacePing(s);
    const r1 = await request(s, 'api/ping.php'), r2 = await request(s, 'api/ping.php');
    const [c1] = sessionCookie(r1), [c2] = sessionCookie(r2);
    assert(c1 && c2, 'ping sets no TFMSESSID cookie');
    assert(c1.attrs.httponly === true, 'not HttpOnly');
    assert(/^(lax|strict)$/i.test(String(c1.attrs.samesite)), `SameSite=${c1.attrs.samesite}`);
    assert(c1.attrs.path === new URL(s.base).pathname, `Path=${c1.attrs.path}`);
    assert(c1.attrs.domain === undefined, `Domain=${c1.attrs.domain}`);
    assert(c1.attrs.expires === undefined && c1.attrs['max-age'] === undefined, 'the anonymous cookie is persistent');
    assert(c1.value.length >= 32 && c1.value !== c2.value && new Set(c1.value).size >= 12, `weak id (${c1.value.length} chars)`);
    return `HttpOnly; SameSite=${c1.attrs.samesite}; Path=${c1.attrs.path}; ${c1.value.length}-char id`;
  });
  await check('S12', 'session cookie: Path is the install folder when the app lives in a sub-folder (/metaverse/)', { sev: 'medium', fix: 'Keep Http::basePath().' }, async () => {
    const sub = await srv('sub');
    const c = await anon(sub);
    const first = (await request(sub, 'api/ping.php'));
    const [ck] = sessionCookie(first);
    assert(ck && ck.attrs.path === '/metaverse/', `ping: Path=${ck && ck.attrs.path}`);
    const r = await register(c, nextEmail('sub'), nextNick('Sub'), { remember: true });
    assert(r.status === 200, `register → ${r.status}`);
    for (const x of sessionCookie(r)) assert(x.attrs.path === '/metaverse/', `after login: Path=${x.attrs.path}`);
    await stopServer('sub');
    return 'Path=/metaverse/ before and after login (also the remember-me cookie)';
  });
  await check('S12', 'Apache: the session cookie Path follows the folder (/ and /metaverse/)', { ...APACHE_MODE, sev: 'medium', fix: 'Keep Http::basePath().' }, async () => {
    const a = await apache();
    if (a instanceof Skip) return a;
    await pacePing(a); await pacePing(a);
    const [root] = sessionCookie(await request(a, 'api/ping.php')), [sub] = sessionCookie(await request(a.alias(), 'api/ping.php'));
    assert(root && root.attrs.path === '/' && sub && sub.attrs.path === '/metaverse/', `Path=${root && root.attrs.path} and ${sub && sub.attrs.path}`);
    assert(root.attrs.httponly === true && /lax|strict/i.test(String(root.attrs.samesite)), 'HttpOnly / SameSite missing behind Apache');
    return 'Path=/ and Path=/metaverse/';
  });
  // CONTRACT §15.7 #12 — regenerate on login
  await check('S12', 'the session id changes at register, login and logout; the old id is dead on the server', { sev: 'high', fix: 'Keep session_regenerate_id(true) in Session::login() / logout().' }, async () => {
    const c = await anon(s);
    const ids = [c.sid()];
    const email = nextEmail('rot');
    assert((await register(c, email, nextNick('Rot'))).status === 200, 'register');
    ids.push(c.sid());
    assert((await c.json('api/auth/logout.php', {})).status === 200, 'logout');
    ids.push(c.sid());
    assert((await login(c, email)).status === 200, 'login');
    ids.push(c.sid());
    assert(new Set(ids).size === 4, `ids: ${ids.map((x) => x.slice(0, 6)).join(' → ')}`);
    for (const old of ids.slice(0, 3)) {
      const r = await request(s, 'api/auth/me.php', { headers: { Cookie: `TFMSESSID=${encodeURIComponent(old)}`, 'User-Agent': c.ua } });
      assert(r.data.user === null, `an earlier session id still carries the login (${old.slice(0, 6)}…)`);
    }
    return '4 different ids; earlier ids carry no login';
  });
  // CONTRACT §15.7 #12 — strict mode: tests try fixation
  await check('S12', 'fixation: a session id planted before login is never adopted', { sev: 'high', fix: 'Keep session.use_strict_mode and the regeneration at login.' }, async () => {
    const planted = 'A'.repeat(48);
    const c = new Client(s);
    c.jar.set('TFMSESSID', planted);
    await pacePing(s);
    const p = await c.req('api/ping.php');
    assert(p.status === 200 && c.sid() !== planted, 'the server adopted an id it never issued');
    assert(!fs.existsSync(path.join(s.dataDir, 'sessions', 'sess_' + planted)), 'a session file was created for the planted id');
    // the attacker's own valid anonymous id, handed to the victim's browser
    const attacker = await anon(s);
    const lure = attacker.sid();
    const victimBrowser = new Client(s);
    victimBrowser.jar.set('TFMSESSID', attacker.jar.get('TFMSESSID'));
    victimBrowser.csrf = attacker.csrf;
    const reg = await register(victimBrowser, nextEmail('fix'), nextNick('Fix'));
    assert(reg.status === 200, `register → ${reg.status}`);
    assert(victimBrowser.sid() !== lure, 'the victim keeps the id the attacker knows after logging in');
    const spy = await attacker.req('api/auth/me.php');
    assert(spy.data.user === null, 'the attacker\'s copy of the id is logged in as the victim');
    return 'unknown id replaced; a known anonymous id is dropped at login';
  });
  await check('S12', 'session ids are taken from the cookie only (not from the URL or the body)', { sev: 'high', fix: 'Keep session.use_only_cookies=1, use_trans_sid=0.' }, async () => {
    const u = await newUser(s, 'Url');
    const sid = encodeURIComponent(u.sid());
    for (const p of [`api/auth/me.php?TFMSESSID=${sid}`, `api/auth/me.php?PHPSESSID=${sid}`, `api/auth/me.php;TFMSESSID=${sid}`]) {
      const r = await request(s, p, { headers: { 'User-Agent': u.ua } });
      assert(r.status === 404 || (r.data && r.data.user === null), `${p.replace(sid, '<sid>')} → logged in`);
    }
    const body = await request(s, 'api/player/get.php', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': u.ua }, body: `TFMSESSID=${sid}` });
    assert(body.status !== 200, 'a session id in the body was accepted');
    return 'URL and body ids ignored';
  });
  // CONTRACT §15.7 #12 — idle + absolute timeouts
  await check('S12', 'idle timeout (TFM_SESSION_IDLE=2): the login ends after the idle time', { sev: 'medium', fix: 'Keep Session::checkLifetime().' }, async () => {
    const i = await srv('idle');
    const u = await newUser(i, 'Idl');
    assert((await u.req('api/auth/me.php')).data.user, 'not logged in right after registering');
    await sleep(3300);
    const me = await u.req('api/auth/me.php');
    assert(me.data.user === null, 'still logged in after 3.3 s without a request');
    assert((await u.req('api/player/get.php')).status === 401, 'player/get still answers');
    await stopServer('idle');
    return 'logged out after 3.3 s idle';
  });
  await check('S12', 'absolute lifetime (TFM_SESSION_MAX=3): the login ends although the browser keeps polling', { sev: 'medium', fix: 'Keep the absolute lifetime check.' }, async () => {
    const l = await srv('life');
    const u = await newUser(l, 'Abs');
    let alive = 0;
    for (let n = 0; n < 6; n++) { await sleep(800); if ((await u.req('api/auth/me.php')).data.user) alive = n + 1; }
    assert(alive >= 1 && alive < 6, `logged in for ${alive} of 6 polls (0.8 s apart)`);
    await stopServer('life');
    return `ended after ${((alive + 1) * 0.8).toFixed(1)} s of constant polling`;
  });
  // CONTRACT §15.7 #12 — UA binding
  await check('S12', 'User-Agent binding: a stolen cookie from another browser is not a login', { sev: 'medium', fix: 'Keep session.bind_user_agent.' }, async () => {
    const u = await newUser(s, 'Uab');
    const r = await request(s, 'api/auth/me.php', { headers: { Cookie: u.cookieHeader(), 'User-Agent': 'Mozilla/5.0 (thief)' } });
    assert(r.data.user === null, 'the cookie works from another User-Agent');
    return 'not logged in from another User-Agent';
  });
  // CONTRACT §15.7 #12 — regenerate on role change
  await check('S12', 'role change: promoting an account ends its open sessions (new login needed)', { sev: 'medium', fix: 'Keep the session epoch bump in Users::update() for role / status changes.' }, async () => {
    const u = await newUser(s, 'Rol');
    const r = cli(s, 'promote', u.email);
    assert(r.status === 0, `cli promote failed: ${oneLine(r.out, 120)}`);
    const get = await u.req('api/player/get.php');
    assert(get.status === 401, `the old session still works after the role change (${get.status})`);
    cli(s, 'demote', u.email);
    return 'old session → 401';
  });
  // CONTRACT §15.7 #12 — the admin elevation cookie is SameSite=Strict
  await check('S12', 'admin elevation cookie: SameSite=Strict, HttpOnly and scoped to the admin folder', { sev: 'medium', fix: 'Set a second cookie at admin sign-in: Path=<admin folder>, SameSite=Strict, HttpOnly (+ Secure on https), bound to the elevation flag.' }, async () => {
    const site = await adminSite(s);
    assert(site, NO_ADMIN_SITE);
    const a = await admin(s);
    const c = new Client(s);
    const seen = [];
    const page = await c.req(site, { headers: HTML });
    const form = parseForms(page.text).find((f) => f.method === 'post' && f.fields.some((x) => x.type === 'password'));
    assert(form, 'no sign-in form');
    const values = {};
    for (const f of form.fields) { if (f.type === 'password') values[f.name] = PASSWORD; else if (f.tag === 'input' && ['text', 'email'].includes(f.type)) values[f.name] = a.email; }
    let r = await submitForm(c, page.url, form, values);
    seen.push(...r.setCookie.map(cookieParts));
    r = await follow(c, r);
    seen.push(...r.setCookie.map(cookieParts));
    const strict = seen.filter((x) => /^strict$/i.test(String(x.attrs.samesite)));
    assert(strict.length > 0, `cookies set at admin sign-in: ${seen.map((x) => `${x.name} (SameSite=${x.attrs.samesite}, Path=${x.attrs.path})`).join(', ') || 'none'}`);
    const ck = strict[0];
    assert(ck.attrs.httponly === true && String(ck.attrs.path).replace(/\/$/, '').endsWith(site.replace(/\/$/, '')), `${ck.name}: HttpOnly=${ck.attrs.httponly}, Path=${ck.attrs.path}`);
    return `${ck.name}: SameSite=Strict; HttpOnly; Path=${ck.attrs.path}`;
  });
}

// =============================================================================
// S13 — CSRF
// =============================================================================
async function S13() {
  if (!want('S13')) return;
  const s = await srv('main');
  const u = await newUser(s, 'Csf');
  const other = await anon(s);
  const posts = await postEndpoints(s);
  const real = [];   // endpoints that act on a POST (a honeypot that answers 404 to everything is not one)
  const note = {};
  // classify with a correct token first: an endpoint that always answers 404 has nothing to protect
  for (const ep of posts) {
    if (ep === 'api/auth/logout.php') { real.push(ep); continue; }
    const r = await u.json(ep, {});
    if (r.status === 404) note[ep] = 'always 404'; else real.push(ep);
  }
  const csrfLike = (r) => r.status === 403 && r.error && ['CSRF_INVALID', 'CROSS_SITE_REQUEST'].includes(r.error.code);
  const matrix = async (label, make, accept) => {
    const bad = [];
    for (const ep of real) {
      const r = await make(ep);
      if (ep === WEBHOOK) continue;
      if (!accept(r)) bad.push(`${ep} → ${r.status} ${(r.error && r.error.code) || ''}`);
    }
    assert(!bad.length, `${label}: ${bad.join(', ')}`);
    return `${real.filter((e) => e !== WEBHOOK).length} POST endpoints`;
  };
  const CSRF_FIX = 'Keep the CSRF + Origin check in Api::run for every write (csrf => false only for the documented webhook).';
  // CONTRACT §15.7 #13 — a test walks all POST endpoints without a token …
  await check('S13', 'every POST endpoint refuses a request without a CSRF token (403)', { sev: 'high', fix: CSRF_FIX }, () => matrix('no token', (ep) => u.json(ep, {}, { csrf: false }), (r) => r.status === 403));
  // … with a wrong token …
  await check('S13', 'every POST endpoint refuses a wrong CSRF token (403)', { sev: 'high', fix: CSRF_FIX }, () => matrix('wrong token', (ep) => u.json(ep, {}, { csrf: 'f'.repeat(64) }), (r) => r.status === 403));
  await check('S13', 'every POST endpoint refuses the token of another session (403)', { sev: 'high', fix: CSRF_FIX }, () => matrix('foreign token', (ep) => u.json(ep, {}, { csrf: other.csrf }), (r) => r.status === 403));
  // … and with a cross-site Origin
  await check('S13', 'every POST endpoint refuses a cross-site Origin even with the right token (403)', { sev: 'high', fix: CSRF_FIX }, () => matrix('cross-site Origin', (ep) => u.json(ep, {}, { headers: { Origin: 'https://evil.example' } }), (r) => r.status === 403));
  await check('S13', 'every POST endpoint refuses Sec-Fetch-Site: cross-site even with the right token (403)', { sev: 'high', fix: CSRF_FIX }, () => matrix('Sec-Fetch-Site', (ep) => u.json(ep, {}, { headers: { 'Sec-Fetch-Site': 'cross-site' } }), (r) => r.status === 403));
  await check('S13', 'look-alike origins (other port, host suffix) are cross-site too', { sev: 'medium', fix: CSRF_FIX }, async () => {
    const host = new URL(s.base).host;
    for (const origin of [`http://127.0.0.1:${s.port + 1000}`, `http://${host}.evil.example`, `https://${host}`.replace('127.0.0.1', '127.0.0.2'), 'http://localhost.evil.example']) {
      const r = await u.json('api/presence/update.php', { x: 1, y: 0, z: 1 }, { headers: { Origin: origin } });
      assert(r.status === 403, `Origin ${origin} → ${r.status}`);
    }
    return '4 origins → 403';
  });
  // the documented no-session case: 401 (login-only endpoints) — never an action
  await check('S13', 'a POST without any session cookie is 401 (login-only endpoints) or 403 — never processed', { sev: 'high', fix: CSRF_FIX }, () => matrix('no cookie', (ep) => request(s, ep, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': 'f'.repeat(64) }, body: '{}' }), (r) => r.status === 401 || r.status === 403));
  await check('S13', 'the token is only accepted in the X-CSRF-Token header (query string never; JSON body only for the documented save beacon)', { sev: 'medium', fix: CSRF_FIX }, async () => {
    const bad = [];
    for (const ep of real) {
      if (ep === WEBHOOK) continue;
      const q = await u.json(`${ep}?csrf=${u.csrf}&_csrf=${u.csrf}&X-CSRF-Token=${u.csrf}`, {}, { csrf: false });
      if (q.status !== 403) bad.push(`${ep} (query) → ${q.status}`);
      if (ep === 'api/player/save.php') continue;
      const b = await u.json(ep, { csrf: u.csrf, _csrf: u.csrf }, { csrf: false });
      if (b.status !== 403) bad.push(`${ep} (body) → ${b.status}`);
    }
    assert(!bad.length, bad.join(', '));
    return 'query and body tokens refused';
  });
  // control: the matrix is not green merely because everything answers 403
  await check('S13', 'control: with the right token and origin the same requests pass the CSRF layer; state-changing GET is impossible (405)', { sev: 'medium', fix: 'If this fails the CSRF matrix proves nothing: repair the endpoint first.' }, async () => {
    const bad = [];
    for (const ep of real) {
      const g = await u.req(ep);
      if (g.status !== 405) bad.push(`GET ${ep} → ${g.status}`);
      if (ep === 'api/auth/logout.php') continue;
      const r = await u.json(ep, {}, { headers: { Origin: new URL(s.base).origin, 'Sec-Fetch-Site': 'same-origin' } });
      if (csrfLike(r) || r.status >= 500) bad.push(`POST ${ep} → ${r.status} ${(r.error && r.error.code) || ''}`);
    }
    const out = await (await newUser(s, 'Csf')).json('api/auth/logout.php', {});
    if (out.status !== 200) bad.push(`logout → ${out.status}`);
    assert(!bad.length, bad.join(', '));
    return `${real.length} endpoints reachable with a valid token${Object.keys(note).length ? `; not judged: ${Object.entries(note).map(([k, v]) => `${k} (${v})`).join(', ')}` : ''}`;
  });
  await check('S13', 'the documented exception api/sub/webhook.php (no session, no token) acts on nobody\'s behalf', { sev: 'high', fix: 'Keep the webhook cookie-less and re-verify every event against the gateway.' }, async () => {
    if (!posts.includes(WEBHOOK)) return skip('the build has no webhook endpoint');
    const before = (await u.req('api/auth/me.php')).data;
    const r = await u.json(WEBHOOK, { eventType: 'PAYMENT_STATUS_CHANGED', data: { status: 'DONE', tier: 4, userId: u.user.id } }, { csrf: false, headers: { Origin: 'https://evil.example' } });
    assert(r.status === 200 || r.status === 403, `→ ${r.status}`);
    const after = (await u.req('api/auth/me.php')).data;
    assert(after.user && after.sub.tier === before.sub.tier, 'a cross-site POST to the webhook changed the caller\'s account');
    return `→ ${r.status} ${r.data ? JSON.stringify(r.data).slice(0, 60) : ''}, account unchanged`;
  });
  // CONTRACT §15.7 #13 — admin form posts too (§15.4: every action POST + CSRF + same-origin)
  await check('S13', 'admin page: every form refuses a missing token, a wrong token, a cross-site Origin and Sec-Fetch-Site: cross-site (nothing changes)', { sev: 'high', fix: 'Keep Sec::checkOrigin() + Session::checkCsrf() in front of every admin action.' }, async () => {
    const victim = await actor(s, 'csrfvictim');
    const say = await victim.json('api/chat/send.php', { text: `신고 대상 메시지 ${RUN}`, channel: 'all' });
    if (say.status === 200) await u.json('api/chat/report.php', { target: victim.nick, reason: 'spam', messageId: say.data.message.id });
    const { c, entry, page } = await adminBrowser(s);
    const snap = () => JSON.stringify([
      dbQuery(s, 'SELECT id, role, status, muted_until, session_epoch FROM users ORDER BY id'), dbQuery(s, 'SELECT user_id, tier, status, expires_at, auto_renew FROM subscriptions ORDER BY user_id'),
      dbQuery(s, 'SELECT id, hidden FROM chat_messages ORDER BY id'), dbQuery(s, 'SELECT id, status FROM chat_reports ORDER BY id'), dbQuery(s, 'SELECT k, v FROM settings ORDER BY k'), dbQuery(s, 'SELECT ip_hash, until_at FROM ip_blocks ORDER BY ip_hash'),
    ]);
    const forms = [];
    for (const tab of ['', ...tabsOf(page.text)]) {
      const url = tab ? `${entry}?tab=${tab}&q=${encodeURIComponent(victim.nick)}` : entry;
      const r = await c.req(url, { headers: HTML });
      for (const f of parseForms(r.text)) if (f.method === 'post') forms.push({ url: r.url, f, key: f.fields.map((x) => `${x.name}=${/csrf/i.test(x.name) ? '' : x.value}`).join('&') });
    }
    const unique = [...new Map(forms.map((x) => [x.key.replace(/uid=\d+|rid=\d+|mid=\d+/g, ''), x])).values()];
    assert(unique.length >= 3, `only ${unique.length} POST forms found on the admin page`);
    const tokenField = (f) => (f.fields.find((x) => /csrf|token/i.test(x.name)) || {}).name;
    assert(unique.every((x) => tokenField(x.f)), `a form has no CSRF field: ${unique.filter((x) => !tokenField(x.f)).map((x) => x.key.slice(0, 60)).join(' | ')}`);
    const before = snap();
    let n = 0;
    for (const { url, f } of unique) {
      const tf = tokenField(f);
      for (const [label, values, o] of [['no token', {}, { drop: [tf] }], ['wrong token', { [tf]: 'f'.repeat(64) }, {}], ['cross-site Origin', {}, { headers: { Origin: 'https://evil.example' } }], ['Sec-Fetch-Site', {}, { headers: { 'Sec-Fetch-Site': 'cross-site' } }]]) {
        const r = await submitForm(c, url, f, values, o);
        n++;
        assert([301, 302, 303, 400, 401, 403].includes(r.status), `${label}: ${f.fields.map((x) => x.name).join(',')} → ${r.status}`);
        assert(snap() === before, `${label}: the form "${(f.fields.find((x) => x.name === 'action') || {}).value || f.action}" changed the database`);
      }
      assert(isAdminUi(await c.req(entry, { headers: HTML })), `a refused form (${(f.fields.find((x) => x.name === 'action') || {}).value || f.action}) signed the admin out`);
    }
    const get = await c.req(`${entry}?action=ban&uid=${victim.user.id}&tab=users`, { headers: HTML });
    assert(get.status < 500 && snap() === before, 'an action in a GET request changed the database');
    // control: a harmless form with its own token is accepted
    const harmless = unique.find((x) => /mute/.test(x.key)) || unique.find((x) => /cleanup|report|hide/.test(x.key));
    assert(harmless, 'no harmless form (mute / cleanup / report / hide) to prove that valid posts work');
    const fresh = parseForms((await c.req(harmless.url, { headers: HTML })).text).find((f) => f.method === 'post' && f.fields.map((x) => x.name).join() === harmless.f.fields.map((x) => x.name).join() && (f.fields.find((x) => x.name === 'action') || {}).value === (harmless.f.fields.find((x) => x.name === 'action') || {}).value);
    const ok = await submitForm(c, harmless.url, fresh || harmless.f);
    assert([200, 302, 303].includes(ok.status), `the valid form post → ${ok.status}`);
    return `${unique.length} forms × 4 forged variants (${n} posts): database unchanged, admin still signed in; a valid post → ${ok.status}`;
  });
  await check('S13', 'the CSRF token is replaced at login and logout; the previous token stops working', { sev: 'medium', fix: 'Keep the token rotation in Session::login() / logout().' }, async () => {
    const c = await anon(s);
    const t0 = c.csrf;
    const email = nextEmail('tok');
    assert((await register(c, email, nextNick('Tok'))).status === 200, 'register');
    const t1 = c.csrf;
    assert(t1 !== t0 && t1.length >= 32, 'the token did not change at login');
    assert((await c.json('api/presence/update.php', { x: 1, y: 0, z: 1 }, { csrf: t0 })).status === 403, 'the pre-login token still works');
    assert((await c.json('api/auth/logout.php', {})).status === 200, 'logout');
    assert(c.csrf !== t1, 'the token did not change at logout');
    return '3 different tokens, old ones refused';
  });
}

// =============================================================================
// S14 — upload type / size
// =============================================================================
const uploadOf = (name, data, type = 'image/png', field = 'photo') => ({ multipart: { files: [{ field, name, type, data }] } });
const isStoredImage = (r) => r.status === 200 && r.data && /^uploads\/journal\/\d{4}\/\d{2}\/[a-f0-9]{32}\.(png|jpg|webp)$/.test(r.data.url || '');
async function S14() {
  if (!want('S14')) return;
  const s = await srv('val');
  let up = await newUser(s, 'Upl'), used = 0;
  /** upload with accounts that still have budget (20 uploads an hour each) */
  const send = async (o) => { if (++used > 15) { up = await newUser(s, 'Upl'); used = 1; } const r = await up.req('api/journal/upload.php', o); if (isStoredImage(r) && s.docroot === DOCROOT) UPLOADS.push([s.docroot, r.data.url]); return r; };
  const refused = (r, what) => { assert(r.status >= 400 && r.status < 500 && r.error && r.error.code, `${what} → ${r.status} ${r.data ? JSON.stringify(r.data).slice(0, 80) : ''}`); return `${r.status} ${r.error.code}`; };
  const GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
  const SVG = Buffer.from('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(1)</script></svg>');
  const PDF = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n');
  const PHP = Buffer.from('<?php echo "pwned"; system($_GET["c"]); ?>');
  const FIX = 'Keep the Upload pipeline: finfo MIME whitelist → getimagesize → pixel cap → polyglot scan → GD re-encode → random name + forced extension.';
  // CONTRACT §15.7 #14 — tests: gif / svg / pdf / php / html polyglot / oversize / huge-dimension / double extension
  for (const [label, cases] of [
    ['GIF', [['a.gif', GIF, 'image/gif'], ['a.png', GIF, 'image/png']]],
    ['SVG (with a script)', [['a.svg', SVG, 'image/svg+xml'], ['a.png', SVG, 'image/png']]],
    ['PDF', [['a.pdf', PDF, 'application/pdf'], ['a.png', PDF, 'image/png']]],
    ['PHP source', [['shell.php', PHP, 'application/x-php'], ['shell.png', PHP, 'image/png'], ['shell.php.png', PHP, 'image/png']]],
    ['an HTML polyglot inside a PNG', [['a.png', makePng(4, 4, [pngText('Comment', '<html><body><script>alert(1)</script></body></html>')]), 'image/png'], ['b.png', Buffer.concat([makePng(4, 4), Buffer.from('<script>alert(1)</script>')]), 'image/png']]],
    ['a PHP polyglot inside a PNG', [['a.png', makePng(4, 4, [pngText('Comment', '<?php system($_GET["c"]); ?>')]), 'image/png'], ['b.png', Buffer.concat([makePng(4, 4), Buffer.from('<?php echo 1; ?>')]), 'image/png']]],
    ['a file over 5 MB', [['big.png', Buffer.concat([makePng(4, 4), Buffer.alloc(5 * 1024 * 1024 + 4096, 0x41)]), 'image/png']]],
    ['a huge-dimension PNG (30000 × 30000 claimed) and a pixel bomb (5000 × 5000)', [['huge.png', makePng(4, 4, [], [30000, 30000]), 'image/png'], ['bomb.png', makePng(1, 1, [], [5000, 5000]), 'image/png']]],
    ['an empty file, a text file and a second file field', [['a.png', Buffer.alloc(0), 'image/png'], ['a.png', Buffer.from('hello, I am not an image'), 'image/png'], ['a.png', makePng(), 'image/png', 'file']]],
  ]) {
    await check('S14', `upload: ${label} is rejected`, { sev: 'high', fix: FIX }, async () => {
      const out = [];
      for (const [name, data, type, field] of cases) out.push(refused(await send(uploadOf(name, data, type, field)), `${name} (${type})`));
      return [...new Set(out)].join(' · ');
    });
  }
  // CONTRACT §15.7 #14 — random name + forced extension: a client file name never reaches the disk
  await check('S14', 'upload: double-extension, traversal and NUL file names never reach the disk (rejected, or stored under a random image name)', { sev: 'high', fix: FIX }, async () => {
    const names = ['shell.png.php', 'shell.php.png', '../../../lib/evil.php', '..\\..\\config\\config.local.php', 'a.php\0.png', '.htaccess', 'evil.phtml', '/etc/passwd.png'];
    const out = [];
    for (const name of names) {
      const r = await send(uploadOf(name, makePng(8, 8)));
      if (r.status >= 400 && r.status < 500) { out.push('rejected'); continue; }
      assert(isStoredImage(r), `${JSON.stringify(name)} → ${r.status} ${JSON.stringify(r.data || r.error).slice(0, 100)}`);
      out.push('renamed');
    }
    for (const stray of ['lib/evil.php', 'config/config.local.php', 'uploads/.htaccess.png', 'uploads/journal/shell.png.php', 'uploads/shell.php.png', 'uploads/evil.phtml']) {
      if (stray === 'config/config.local.php' && s.docroot !== DOCROOT) continue;
      assert(!fs.existsSync(path.join(s.docroot, stray)) || stray === 'uploads/.htaccess', `a file appeared at ${stray}`);
    }
    return `${names.length} hostile names → ${[...new Set(out)].join(' / ')} ([a-f0-9]{32}.png inside uploads/journal/YYYY/MM)`;
  });
  // CONTRACT §15.7 #14 — GD re-encode
  await check('S14', 'upload: a valid PNG is accepted and re-encoded (bytes differ, metadata and trailing data gone)', { sev: 'high', fix: FIX }, async () => {
    const original = Buffer.concat([makePng(16, 12, [pngText('Author', 'TFMSEC-GPS-37.5665N-126.9780E'), pngText('Comment', 'tfmsec-meta-marker')]), Buffer.from('TFMSEC-TRAILER')]);
    const r = await send(uploadOf('holiday.png', original));
    assert(isStoredImage(r), `a valid PNG was refused: ${r.status} ${(r.error && r.error.code) || ''}`);
    assert(r.data.width === 16 && r.data.height === 12 && r.data.mime === 'image/png', `stored as ${r.data.width}×${r.data.height} ${r.data.mime}`);
    const g = await request(s, r.data.url, { headers: { Accept: 'image/*' } });
    assert(g.status === 200 && g.buf.subarray(1, 4).toString('latin1') === 'PNG', `GET ${r.data.url} → ${g.status}`);
    assert(!g.buf.equals(original), 'the stored bytes are the uploaded bytes (not re-encoded)');
    assert(!g.buf.includes('TFMSEC-GPS') && !g.buf.includes('tfmsec-meta-marker') && !g.buf.includes('TFMSEC-TRAILER'), 'metadata / trailing data survived');
    return `${original.length} → ${g.buf.length} bytes, 16×12, no markers`;
  });
  await check('S14', 'upload: a visitor without a login cannot upload', { sev: 'high', fix: 'Keep \'auth\' => true.' }, async () => {
    const v = await anon(s);
    const r = await v.req('api/journal/upload.php', uploadOf('a.png', makePng()));
    assert(r.status === 401 || r.status === 403, `→ ${r.status}`);
    return `→ ${r.status}`;
  });
  // CONTRACT §15.7 #14 — any other endpoint that receives multipart/form-data or $_FILES → 400 UPLOAD_NOT_ALLOWED + event
  await check('S14', 'multipart/form-data sent to an endpoint that takes no files is answered 400 UPLOAD_NOT_ALLOWED', { sev: 'medium', fix: 'Api::run: when the endpoint has no \'upload\' => true and the request is multipart/form-data or $_FILES is not empty → 400 UPLOAD_NOT_ALLOWED + SecEvent upload_rejected.' }, async () => {
    const u = await newUser(s, 'Mpf');
    const mp = { multipart: { fields: { text: 'hello', tier: '2', login: 'x' }, files: [{ field: 'photo', name: 'a.png', data: makePng() }] } };
    const bad = [];
    for (const ep of (await postEndpoints(s)).filter((e) => !/upload|report-photo/.test(e) && e !== WEBHOOK && e !== 'api/auth/logout.php')) {
      const r = await u.req(ep, mp);
      if (!(r.status === 400 && r.error && r.error.code === 'UPLOAD_NOT_ALLOWED')) bad.push(`${ep} → ${r.status} ${(r.error && r.error.code) || ''}`);
    }
    assert(!bad.length, bad.join(', '));
    return 'every non-upload endpoint → 400 UPLOAD_NOT_ALLOWED';
  });
  // ---- Apache: uploads/.htaccess
  await check('S14', 'Apache: nothing below uploads/ executes and only [a-f0-9]{32}.(png|jpg|webp) names are served', { ...APACHE_MODE, sev: 'high', fix: 'Keep uploads/.htaccess (php engine off, RemoveHandler, deny all but image names).' }, async () => {
    const a = await apache();
    if (a instanceof Skip) return a;
    const dir = path.join(a.docroot, 'uploads/journal/2026/11');
    fs.mkdirSync(dir, { recursive: true });
    const code = '<?php echo "TFMSEC-EXEC-" . (6 * 7); ?>';
    const planted = { 'evil.php': code, 'evil.phtml': code, 'evil.php.png': code, 'evil.pHp': code, [`${'a'.repeat(32)}.php`]: code, [`${'b'.repeat(32)}.png.php`]: code, [`${'c'.repeat(32)}.phar`]: code, 'x.html': '<script>alert(1)</script>', 'x.svg': '<svg onload="alert(1)"/>', 'note.txt': 'x', [`${'d'.repeat(32)}.png`]: makePng(), [`${'e'.repeat(32)}.png`]: code };
    for (const [n, c] of Object.entries(planted)) fs.writeFileSync(path.join(dir, n), c);
    const out = [];
    for (const n of Object.keys(planted)) {
      const r = await request(a, `uploads/journal/2026/11/${n}`, { headers: { Accept: '*/*' } });
      assert(!r.text.includes('TFMSEC-EXEC-42'), `${n} was executed`);
      if (/^[a-f0-9]{32}\.png$/.test(n)) { assert(r.status === 200 && /^image\/png/.test(r.headers['content-type'] || '') && r.headers['x-content-type-options'] === 'nosniff', `${n} → ${r.status} ${r.headers['content-type']}`); out.push(`${n.slice(0, 4)}….png 200`); }
      else assert([403, 404].includes(r.status), `${n} → ${r.status}`);
    }
    for (const d of ['uploads/', 'uploads/journal/', 'uploads/journal/2026/11/']) { const r = await request(a, d, { headers: HTML }); assert([403, 404].includes(r.status) || (r.status === 200 && r.buf.length === 0), `${d} → ${r.status} (${r.buf.length} bytes)`); }
    return `${Object.keys(planted).length} planted files: scripts and other types 403 / 404, image names as image/png + nosniff`;
  });
  await check('S14', 'Apache: an upload over the size cap is refused through the web server as well', { ...APACHE_MODE, sev: 'medium', fix: 'Root .htaccess / .user.ini: upload_max_filesize 6M, post_max_size 8M, max_file_uploads 2, LimitRequestBody.' }, async () => {
    const a = await apache();
    if (a instanceof Skip) return a;
    const u = await actor(a, 'A');
    const big = await u.req('api/journal/upload.php', uploadOf('big.png', Buffer.concat([makePng(4, 4), Buffer.alloc(5 * 1024 * 1024 + 4096, 0x41)])));
    assert(big.status >= 400 && big.status < 500, `5 MB + → ${big.status}`);
    const huge = await u.req('api/journal/upload.php', uploadOf('huge.png', Buffer.concat([makePng(4, 4), Buffer.alloc(9 * 1024 * 1024, 0x41)])));
    assert(huge.status >= 400 && huge.status < 500, `9 MB → ${huge.status}`);
    return `5 MB+ → ${big.status}, 9 MB → ${huge.status}`;
  });
}

// =============================================================================
// S15 — price / amount checked on the server (mock payments)
// =============================================================================
async function S15() {
  if (!want('S15')) return;
  const s = await srv('val');
  const tierOf = async (c) => (await c.req('api/auth/me.php')).data.sub.tier;
  const order = async (c, tier = 2, kind = 'card') => { const p = await c.json('api/sub/prepare.php', { tier, kind }); assert(p.status === 200 && p.data && p.data.orderId, `prepare → ${p.status} ${(p.error && p.error.code) || ''} (mock payments are needed)`); return p.data; };
  const confirm = (c, o, amount, key = 'mock_' + o.orderId) => c.json('api/sub/confirm.php', { paymentKey: key, orderId: o.orderId, amount });
  const prices = Object.fromEntries(((await request(s, 'api/sub/status.php')).data.tiers || []).map((t) => [t.tier, t.price]));
  const FIX = 'Keep Subscription::confirm(): own order, status created, amount === the stored server amount.';
  // CONTRACT §15.7 #15 — the order amount is created from the server's tier table
  await check('S15', 'prepare: the amount comes from the server\'s tier table — a price sent by the client is ignored or refused', { sev: 'high', fix: FIX }, async () => {
    const u = await newUser(s, 'Prc');
    const r = await u.json('api/sub/prepare.php', { tier: 4, kind: 'card', amount: 1, price: 1, orderName: 'free', customerKey: 'cus_' + 'ab'.repeat(16) });
    if (r.status >= 400 && r.status < 500) return `refused (${r.status} ${r.error.code})`;
    assert(r.status === 200 && r.data.amount === prices[4] && r.data.tier === 4, `order amount ${r.data && r.data.amount} (the tier costs ${prices[4]})`);
    assert(r.data.customerKey !== 'cus_' + 'ab'.repeat(16), 'the client chose the customerKey');
    return `tier 4 → ₩${r.data.amount} (the client's ₩1 is ignored)`;
  });
  // CONTRACT §15.7 #15 — the confirmation must match it exactly
  await check('S15', 'confirm: a tampered amount (lower, 0, negative, higher) is refused and the tier stays 1; the exact amount then works', { sev: 'high', fix: FIX }, async () => {
    const u = await newUser(s, 'Tmp');
    const o = await order(u, 3);
    for (const amount of [o.amount - 100, 1, 0, -o.amount, o.amount + 1, o.amount * 100]) {
      const r = await confirm(u, o, amount);
      assert(isCleanError(r), `amount ${amount} → ${r.status}`);
      assert(await tierOf(u) === 1, `amount ${amount} raised the tier`);
    }
    const ok = await confirm(u, o, o.amount);
    assert(ok.status === 200 && ok.data.sub.tier === 3, `the exact amount → ${ok.status}`);
    return `6 tampered amounts refused; ₩${o.amount} → tier 3`;
  });
  await check('S15', 'confirm: the amount must be a JSON integer — float, exponent, string and array forms are refused', { sev: 'medium', fix: 'confirm.php: is_int($amount) only (V::int); a digit string is a type error.' }, async () => {
    const accepted = [];
    let u = await newUser(s, 'Typ');
    let n = 0;
    for (const [label, body] of [['"<amount>" (string)', (o) => JSON.stringify({ paymentKey: 'mock_' + o.orderId, orderId: o.orderId, amount: String(o.amount) })], ['<amount>.0', (o) => `{"paymentKey":"mock_${o.orderId}","orderId":"${o.orderId}","amount":${o.amount}.0}`],
      ['exponent form', (o) => `{"paymentKey":"mock_${o.orderId}","orderId":"${o.orderId}","amount":${o.amount / 100}e2}`], ['" <amount>" (padded string)', (o) => JSON.stringify({ paymentKey: 'mock_' + o.orderId, orderId: o.orderId, amount: ` ${o.amount}` })],
      ['[<amount>]', (o) => JSON.stringify({ paymentKey: 'mock_' + o.orderId, orderId: o.orderId, amount: [o.amount] })], ['"0x…" (hex string)', (o) => JSON.stringify({ paymentKey: 'mock_' + o.orderId, orderId: o.orderId, amount: '0x' + o.amount.toString(16) })]]) {
      if (++n > 4) { u = await newUser(s, 'Typ'); n = 1; }
      const o = await order(u, 2);
      const r = await u.req('api/sub/confirm.php', { body: body(o), headers: { 'Content-Type': 'application/json' } });
      assert(r.status < 500 && r.json, `${label} → ${r.status}`);
      if (r.status < 400) { accepted.push(label); u = await newUser(s, 'Typ'); n = 0; }
    }
    assert(!accepted.length, `accepted as a payment amount: ${accepted.join(', ')}`);
    return '6 non-integer forms refused';
  });
  // CONTRACT §15.7 #15 — foreign / replayed orders refused
  await check('S15', 'confirm: another account\'s order is refused, the owner can still pay it', { sev: 'high', fix: FIX }, async () => {
    const owner = await newUser(s, 'Own'), thief = await newUser(s, 'Thf');
    const o = await order(owner, 4);
    const r = await confirm(thief, o, o.amount);
    assert([403, 404].includes(r.status), `foreign order → ${r.status}`);
    const b = await thief.json('api/sub/billing-issue.php', { authKey: 'mock_auth_ok', customerKey: o.customerKey, orderId: o.orderId });
    assert(isCleanError(b), `foreign order through billing-issue → ${b.status}`);
    assert(await tierOf(thief) === 1 && await tierOf(owner) === 1, 'a tier changed');
    const ok = await confirm(owner, o, o.amount);
    assert(ok.status === 200 && ok.data.sub.tier === 4, `the owner → ${ok.status}`);
    return `thief ${r.status} / ${b.status}; owner → tier 4`;
  });
  await check('S15', 'confirm: replaying a confirmed order is refused and does not extend the period', { sev: 'high', fix: FIX }, async () => {
    const u = await newUser(s, 'Rpl');
    const o = await order(u, 2);
    const first = await confirm(u, o, o.amount);
    assert(first.status === 200, `confirm → ${first.status}`);
    const exp = first.data.sub.expiresAt;
    for (let i = 0; i < 3; i++) { const r = await confirm(u, o, o.amount); assert(r.status === 409, `replay ${i + 1} → ${r.status}`); }
    const viaReturn = await u.req(`api/sub/return.php?kind=card&paymentKey=mock_${o.orderId}&orderId=${o.orderId}&amount=${o.amount}`, { headers: HTML });
    assert([302, 303].includes(viaReturn.status) && /sub=fail/.test(viaReturn.headers.location || ''), `replay through return.php → ${viaReturn.status} ${viaReturn.headers.location || ''}`);
    const now = (await u.req('api/auth/me.php')).data.sub;
    assert(now.tier === 2 && now.expiresAt === exp, `expiresAt moved from ${exp} to ${now.expiresAt}`);
    return '4 replays refused, expiry unchanged';
  });
  await check('S15', 'prepare: a tier outside 2–4 is refused', { sev: 'high', fix: 'Keep the tier range check.' }, async () => {
    const u = await newUser(s, 'Tir');
    for (const tier of [0, 1, 5, -1, 99, 2.5, null, 'x', [2], { t: 2 }, 1e12]) {
      const r = await u.json('api/sub/prepare.php', { tier, kind: 'card' });
      assert(isCleanError(r), `tier ${JSON.stringify(tier)} → ${r.status}`);
    }
    return '11 values → 4xx';
  });
  await check('S15', 'confirm: a payment key the gateway never issued fails the payment; return.php with a tampered amount fails too', { sev: 'high', fix: FIX }, async () => {
    const u = await newUser(s, 'Key');
    const o = await order(u, 2);
    const r = await confirm(u, o, o.amount, 'forged_' + o.orderId);
    assert([400, 402].includes(r.status), `forged key → ${r.status}`);
    const o2 = await order(u, 3);
    const back = await u.req(`api/sub/return.php?kind=card&paymentKey=mock_${o2.orderId}&orderId=${o2.orderId}&amount=1`, { headers: HTML });
    assert([302, 303].includes(back.status) && /sub=fail/.test(back.headers.location || ''), `return.php with amount=1 → ${back.status} ${back.headers.location || ''}`);
    assert(await tierOf(u) === 1, 'the tier was raised');
    return `forged key ${r.status}; tampered return → sub=fail; tier 1`;
  });
  // CONTRACT §15.7 #15 — webhook re-fetched and never raises a tier
  await check('S15', 'webhook: forged events can never raise a tier', { sev: 'high', fix: 'Keep Subscription::webhook(): verify, record, only downgrade.' }, async () => {
    const u = await newUser(s, 'Whk');
    const o = await order(u, 4);
    const hook = new Client(s);
    for (const body of [
      { eventType: 'PAYMENT_STATUS_CHANGED', data: { paymentKey: 'mock_' + o.orderId, orderId: o.orderId, status: 'DONE', totalAmount: o.amount, tier: 4 } },
      { eventType: 'PAYMENT_STATUS_CHANGED', data: { paymentKey: 'anything', orderId: o.orderId, status: 'DONE' } },
      { eventType: 'BILLING_KEY_ISSUED', data: { customerKey: o.customerKey, billingKey: 'mock_bk_x', tier: 4 } },
      { tier: 4, userId: u.user.id, status: 'active', expiresAt: 9999999999999 },
    ]) {
      const r = await hook.json(WEBHOOK, body, { csrf: false });
      assert(r.status === 200 || isCleanError(r), `webhook → ${r.status}`);
      assert(await tierOf(u) === 1, `the webhook raised the tier: ${JSON.stringify(body).slice(0, 80)}`);
    }
    const paid = await confirm(u, o, o.amount);
    assert(paid.status === 200 && paid.data.sub.tier === 4, `confirm → ${paid.status}`);
    const o2 = await order(await newUser(s, 'Whk'), 2);
    await hook.json(WEBHOOK, { eventType: 'PAYMENT_STATUS_CHANGED', data: { paymentKey: 'mock_' + o2.orderId, orderId: o2.orderId, status: 'DONE' } }, { csrf: false });
    assert(dbQuery(s, 'SELECT status FROM orders WHERE order_id = ?', [o2.orderId])[0].status === 'created', 'a DONE webhook confirmed an unpaid order');
    return '4 forged events: tier stays 1; an unpaid order stays "created"';
  });
  await check('S15', 'save blob: a forged subscription inside the saved state is replaced by the server\'s', { sev: 'high', fix: 'Keep forcing data.sub from the subscriptions table.' }, async () => {
    const u = await newUser(s, 'Fsb');
    const st = freshState(u.user);
    st.sub = { tier: 4, status: 'active', expiresAt: Date.now() + 9e9, autoRenew: true, source: 'local' };
    const r = await u.json('api/player/save.php', saveBody(st));
    assert(r.status === 200 && r.data.sub.tier === 1, `save → ${r.status} sub ${JSON.stringify(r.data && r.data.sub)}`);
    const g = await u.req('api/player/get.php');
    assert(g.data.save.data.sub.tier === 1 && g.data.sub.tier === 1 && await tierOf(u) === 1, 'the forged tier is served back');
    return 'stored and served as tier 1';
  });
}

// =============================================================================
// S16 — debug off in production
// =============================================================================
async function S16() {
  if (!want('S16')) return;
  const s = await srv('main');
  // CONTRACT §15.7 #16 — no stack traces / paths in any response
  await check('S16', 'error answers (malformed JSON, wrong content type, missing fields, unknown methods, hostile cookies and parameters) carry no trace, path, PHP message or version', { sev: 'high', fix: 'Keep Boot::forApi() (errors → exceptions → generic JSON) and display_errors=0 in bootstrap.php.' }, async () => {
    const c = await anon(s);
    const u = await actor(s, 'A');
    const cases = [
      ['malformed JSON', () => c.req('api/auth/login.php', { body: '{"login":', headers: { 'Content-Type': 'application/json' } })], ['wrong content type', () => c.req('api/auth/login.php', { body: 'login=a', headers: { 'Content-Type': 'text/plain' } })],
      ['no content type', () => c.req('api/auth/login.php', { body: '{}' })], ['missing fields', () => c.json('api/auth/login.php', {})], ['XML body', () => c.req('api/chat/send.php', { body: '<?xml version="1.0"?><!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]><x>&e;</x>', headers: { 'Content-Type': 'application/xml' } })],
      ...['PUT', 'DELETE', 'PATCH', 'OPTIONS'].map((m) => [`${m} method`, () => c.req('api/player/save.php', { method: m, body: '{}', headers: { 'Content-Type': 'application/json' } })]),
      ['array parameters', () => u.req('api/chat/list.php?after[]=1&limit[a][b]=2')], ['NUL / bad percent', () => u.req('api/chat/list.php?after=%00%ff%ZZ')], ['a 6 kB URL', () => u.req('api/time.php?' + 'a'.repeat(6000))],
      ['array cookie', () => request(s, 'api/auth/me.php', { headers: { Cookie: 'TFMSESSID[]=x; TFMSESSID[a]=y' } })], ['traversal cookie', () => request(s, 'api/auth/me.php', { headers: { Cookie: 'TFMSESSID=../../../../etc/passwd' } })],
      ['5 kB cookie', () => request(s, 'api/auth/me.php', { headers: { Cookie: 'TFMSESSID=' + 'a'.repeat(5000) } })], ['control characters in a header', () => u.req('api/auth/me.php', { headers: { 'X-CSRF-Token': 'a\tb', 'X-Forwarded-For': '1.2.3.4, <script>' } })],
      ['save without data', () => u.json('api/player/save.php', { version: 1 })], ['report of nothing', () => u.json('api/chat/report.php', {})], ['upload without a file', () => u.req('api/journal/upload.php', { multipart: { fields: { a: 'b' } } })],
      ['return page without a session', () => request(s, 'api/sub/return.php?kind=billing&authKey[]=1&orderId[]=2', { headers: HTML })], ['admin page with array parameters', () => request(s, 'admin.php?tab[]=1&q[]=2', { headers: HTML })],
    ];
    const bad = [];
    for (const [label, run] of cases) {
      const r = await run();
      const leaks = debugLeaks(r.text + JSON.stringify(r.headers), s);
      if (r.status >= 500) bad.push(`${label} → ${r.status}`); else if (leaks.length) bad.push(`${label} → ${r.status}: ${leaks.join(', ')}`);
      else if (r.headers['x-powered-by']) bad.push(`${label}: X-Powered-By ${r.headers['x-powered-by']}`);
    }
    assert(!bad.length, bad.join(' | '));
    return `${cases.length} provoked errors: clean`;
  });
  await check('S16', 'a real server fault (destroyed database) is answered with a generic 500 and a reference id — JSON and HTML pages alike', { sev: 'high', fix: 'Keep Api::fail() and the generic error pages.' }, async () => {
    if (DRIVER !== 'sqlite') return skip('needs a SQLite instance (the database file is overwritten)');
    const b = await srv('broken');
    const u = await newUser(b, 'Brk');
    for (const f of fs.readdirSync(b.dataDir)) { if (/\.sqlite-(?:wal|shm)$/.test(f)) fs.unlinkSync(path.join(b.dataDir, f)); else if (/\.sqlite$/.test(f)) fs.writeFileSync(path.join(b.dataDir, f), 'this is not a database'); }
    const seen = [];
    for (const p of ['api/ranking/top.php', 'api/chat/list.php', 'api/player/get.php', 'api/auth/me.php', 'admin.php', 'install.php', 'api/sub/return.php?kind=card&amount=1&orderId=x&paymentKey=y']) {
      const r = await u.req(p, { headers: /api\//.test(p) && !/return/.test(p) ? {} : HTML });
      const leaks = [...debugLeaks(r.text, b), ...(SQL_ERR_RX.test(r.text) || /not a database|database disk image/i.test(r.text) ? ['database error text'] : [])];
      assert(!leaks.length, `${p} → ${r.status}: ${leaks.join(', ')} — ${oneLine(r.text, 100)}`);
      if (/application\/json/.test(r.headers['content-type'] || '') && r.status === 500) assert(r.error && r.error.code === 'SERVER_ERROR' && /^[0-9a-f]{8,}$/.test(r.error.ref || ''), `${p}: 500 body ${oneLine(r.text, 100)}`);
      seen.push(`${path.basename(p.split('?')[0])} ${r.status}`);
    }
    assert(seen.some((x) => / 500$/.test(x)), `destroying the database caused no error at all (${seen.join(', ')})`);
    await stopServer('broken');
    return seen.join(' · ');
  });
  // CONTRACT §15.7 #16 — install.php answers 404 once locked
  await check('S16', 'install.php answers 404 once data/install.lock exists (GET and POST, nothing about the installation)', { sev: 'medium', fix: 'install.php: when Installer::locked() → http_response_code(404) with an empty body (today: a 403 page that names config.local.php and data/install.lock).' }, async () => {
    const l = await srv('locked');
    for (const o of [{ headers: HTML }, { method: 'POST', headers: { ...HTML, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'driver=sqlite&admin_email=a@b.co' }]) {
      const r = await request(l, 'install.php', o);
      assert(r.status === 404, `${o.method || 'GET'} install.php with the lock file → ${r.status}${/install\.lock|config\.local/.test(r.text) ? ' (the page explains how to unlock the installer)' : ''}`);
      assert(!/install|설치|config\.local|<form/i.test(r.text), 'the 404 body still talks about the installer');
    }
    return 'GET and POST → 404';
  });
  await check('S16', 'install.php cannot be used by a remote visitor on a server that is already in use (accounts exist, no lock file)', { sev: 'high', fix: 'install.php / Installer::run(): refuse (404) when the database already holds an account or config.local.php exists, and allow the open installer only from the server itself (Http::isLocalhost()); health: ⛔ while the installer is open on a public host.' }, async () => {
    const i = await srv('inst');   // private copy of the docroot: the installer may write config.local.php here
    const victim = await newUser(i, 'Vic', { xff: '198.51.100.40' });
    const remote = { xff: '203.0.113.77', headers: { Host: PUB_HOST } };
    const x = new Client(i, remote);
    const page = await x.req('install.php', { headers: HTML });
    const form = parseForms(page.text).find((f) => f.method === 'post');
    const evil = `attacker_${RUN}@evil.example`;
    let posted = 'no form offered';
    if (form) {
      const values = { driver: 'sqlite' };
      for (const f of form.fields) { if (/email/i.test(f.name)) values[f.name] = evil; else if (/nick/i.test(f.name)) values[f.name] = 'Intruder1'; else if (f.type === 'password' && /admin/i.test(f.name)) values[f.name] = 'Intrude2026ok'; }
      posted = String((await submitForm(x, page.url, form, values)).status);
    }
    const took = (await login(await anon(i, { xff: '203.0.113.77' }), evil, 'Intrude2026ok'));
    const wrote = fs.existsSync(path.join(i.docroot, 'config/config.local.php'));
    assert(!(took.status === 200 && took.data.user.role === 'admin'), `a visitor from 203.0.113.77 ran the open installer (POST → ${posted}) and is now admin "${evil}" on a server with existing accounts${wrote ? '; config.local.php was rewritten (database driver under the visitor\'s control)' : ''}`);
    assert(!wrote, 'the visitor made the installer write config/config.local.php');
    assert((await victim.req('api/auth/me.php')).data.user, 'the existing account lost its session');
    return `installer closed to the remote visitor (GET ${page.status}, POST ${posted})`;
  });
  // CONTRACT §15.7 #16 — no phpinfo anywhere
  await check('S16', 'no phpinfo / test script answers anywhere', { sev: 'medium', fix: 'Never ship diagnostic scripts; keep diagnostics behind the admin role.' }, async () => {
    for (const p of ['phpinfo.php', 'info.php', 'test.php', 'i.php', 'php.php', 'pi.php', 'api/phpinfo.php', 'api/info.php', 'api/test.php', 'api/debug.php', 'api/admin/phpinfo.php', 'admin/phpinfo.php', '_profiler/phpinfo', 'server-info', 'api/ping.php?phpinfo=1', 'api/admin/health.php?phpinfo=1&debug=1']) {
      const r = await request(s, p, { headers: HTML });
      assert(!/phpinfo\(\)|PHP Version \d|<title>PHP \d|Zend Engine/.test(r.text), `/${p} → ${r.status} shows phpinfo output`);
      assert(/\?/.test(p) || [403, 404].includes(r.status) || r.buf.length > 400000, `/${p} → ${r.status}`);
    }
    return '16 addresses: nothing';
  });
  // CONTRACT §15.7 #16 — mock payment refused or flagged ⛔ on a non-local host
  await check('S16', 'mock payments are refused for a public host when TFM_ENV=production', { sev: 'high', fix: 'Toss::mock(): false (or prepare / confirm → 403 MOCK_NOT_ALLOWED) when app.env is production and the request is not for localhost.' }, async () => {
    const p = await srv('prod');
    const u = await newUser(p, 'Mck');
    const pub = { headers: { Host: PUB_HOST } };
    const o = await u.json('api/sub/prepare.php', { tier: 4, kind: 'card' }, pub);
    let paid = null;
    if (o.status === 200 && o.data && o.data.orderId) paid = await u.json('api/sub/confirm.php', { paymentKey: 'mock_' + o.data.orderId, orderId: o.data.orderId, amount: o.data.amount }, pub);
    const tier = (await u.req('api/auth/me.php', pub)).data.sub.tier;
    assert(tier === 1, `on ${PUB_HOST} (TFM_ENV=production) the mock gateway handed out tier ${tier} without any payment (prepare ${o.status}, confirm ${paid ? paid.status : '-'})`);
    const st = await u.req('api/sub/status.php', pub);
    assert(st.data.mode !== 'mock', 'api/sub/status.php still announces mode "mock" to a public host');
    return `prepare ${o.status}${paid ? ', confirm ' + paid.status : ''}: tier stays 1`;
  });
  await check('S16', 'health check: mock payments on a public production host are flagged ⛔ (not only ⚠)', { sev: 'medium', fix: 'ConfigAudit / Health: status "fail" for toss.mock, anthropic.mock, save.admin_bypass and a debug log level when the host is not local.' }, async () => {
    const p = await srv('prod');
    const h = await (await admin(p)).req('api/admin/health.php?quick=1', { headers: { Host: PUB_HOST } });
    assert(h.status === 200 && Array.isArray(h.data.checks), `health → ${h.status}`);
    const k = h.data.checks.filter((x) => /mock|toss_mode|모의/i.test(JSON.stringify(x)));
    assert(k.some((x) => x.status === 'fail'), `mock-mode entries: ${k.map((x) => `${x.id}=${x.status}`).join(', ') || 'none'}`);
    return k.filter((x) => x.status === 'fail').map((x) => x.id).join(', ');
  });
  await check('S16', 'app.env defaults to production', { sev: 'low', fix: 'Keep the default.' }, async () => {
    const h = await (await admin(s)).req('api/admin/health.php?quick=1');
    assert(h.status === 200 && h.data.app && h.data.app.env === 'production', `app.env is ${h.data && h.data.app && h.data.app.env}`);
    return 'production';
  });
  // CONTRACT §15.7 #16 — no source maps
  await check('S16', 'the shipped page has no source maps', { sev: 'low', fix: 'Keep the build free of sourceMappingURL comments and *.map files.' }, async () => {
    const r = await request(s, 'index.html', { headers: HTML });
    assert(!/sourceMappingURL=/.test(r.text), 'index.html references a source map');
    for (const p of ['index.html.map', 'app.js.map', 'index.js.map', 'main.js.map']) { const m = await request(s, p); assert(m.status === 404, `/${p} → ${m.status}`); }
    return 'no sourceMappingURL, no *.map';
  });
  await stopServer('prod');
  await stopServer('locked');
  await stopServer('inst');
}

// =============================================================================
// S19 — no exposed files
// =============================================================================
const treeOf = (root) => {
  const files = [], dirs = [];
  const walk = (d) => { for (const e of fs.readdirSync(path.join(root, d), { withFileTypes: true })) { const rel = d ? `${d}/${e.name}` : e.name; if (e.isDirectory()) { dirs.push(rel + '/'); walk(rel); } else files.push(rel); } };
  walk('');
  return { files, dirs };
};
const urlPath = (rel) => rel.split('/').map(encodeURIComponent).join('/');
const SECRET_FILE_RX = /\.(?:sqlite3?|sqlite-wal|sqlite-shm|sql|log|md|lock|ini|env|bak)$|(?:^|\/)(?:config\.local\.php|secret\.php|sess_[^/]+|\.htaccess|\.htpasswd|\.gitignore|\.init\.lock)$|\.log\.php$/i;
const isPrivate = (rel) => PRIVATE_DIR_RX.test(rel) || SECRET_FILE_RX.test(rel);
const isListing = (r) => /<title>Index of|Parent Directory<\/a>|Directory listing for/i.test(r.text);
async function S19() {
  if (!want('S19')) return;
  // CONTRACT §15.7 #19 — "php -S to prove the PHP-level guards"
  const e = await srv('expo');
  await anon(e);                                                                           // creates data/secret.php, the database, a session and a log file
  await newUser(e, 'Exp');
  await check('S19', 'without .htaccess (php -S): no private PHP file gives anything away — lib/, config/, cli/, data/secret.php, logs answer a bare 404', { sev: 'high', fix: 'Keep the TFM_BOOT guard at the top of every non-entry PHP file and the PHP exit line at the top of log files.' }, async () => {
    const { files } = treeOf(e.docroot);
    const php = files.filter((f) => PRIVATE_DIR_RX.test(f) && /\.php$/.test(f));
    assert(php.some((f) => f === 'data/secret.php') && php.some((f) => /^data\/logs\/.*\.log\.php$/.test(f)) && php.some((f) => f === 'config/config.local.php'), 'the fixture lacks secret.php / a log file / config.local.php');
    const bad = [];
    for (const f of php) {
      const r = await request(e, urlPath(f), { headers: { Accept: '*/*' } });
      if (r.status !== 404 || r.buf.length || /TFMSEC-MARK|app_key|<\?php/.test(r.text)) bad.push(`${f} → ${r.status} (${r.buf.length} bytes)`);
    }
    assert(!bad.length, bad.slice(0, 5).join(' | '));
    return `${php.length} PHP files → bare 404`;
  });
  {
    // information, not judged: what a server that ignores .htaccess (php -S, a mis-configured Nginx / AllowOverride None) would hand out
    const { files } = treeOf(e.docroot);
    const served = [];
    for (const f of files.filter((x) => isPrivate(x) && !/\.php$/.test(x))) {
      const r = await request(e, urlPath(f), { headers: { Accept: '*/*' }, dynamic: false });
      if (r.status === 200 && r.buf.length) served.push(f);
    }
    const group = (rx) => served.filter((f) => rx.test(f));
    const short = (list) => list.slice(0, 6).map((f) => f.replace(/[0-9a-f]{16,}|sess_.*/g, (m) => (m.startsWith('sess_') ? 'sess_<id>' : '<random>'))).join(', ') + (list.length > 6 ? ` … (+${list.length - 6})` : '');
    info('S19', `php -S (no .htaccess) serves ${served.length} private non-PHP files as plain downloads`);
    if (group(/\.sqlite/).length) info('S19', `  databases / backups: ${short(group(/\.sqlite/))} — the whole database when the random name is known`);
    if (group(/sess_/).length) info('S19', `  session files: ${short(group(/sess_/))} (names = session ids)`);
    if (group(/\.(sql|md|log|lock|ini|env|bak)$|\.htaccess$|\.gitignore$/).length) info('S19', `  schema / docs / logs / config leftovers: ${short(group(/\.(sql|md|log|lock|ini|env|bak)$|\.htaccess$|\.gitignore$/))}`);
    const rest = served.filter((f) => !/\.sqlite|sess_|\.(sql|md|log|lock|ini|env|bak)$|\.htaccess$|\.gitignore$/.test(f));
    if (rest.length) info('S19', `  other: ${short(rest)}`);
    info('S19', '  → keep TFM_DATA_DIR outside the web root on any server that does not read .htaccess (the health check says so)');
  }
  await stopServer('expo');
  // ---- Apache
  const a = APACHE ? await srv('apache') : null;
  const ap = async () => (a && !a.unavailable ? null : await apache());
  if (a && !a.unavailable) { await anon(a); await actor(a, 'A'); }
  const deny = async (list, base = a) => {
    const bad = [];
    for (const f of list) {
      const r = await request(base, urlPath(f), { headers: { Accept: '*/*' }, dynamic: false });
      if (![403, 404].includes(r.status)) bad.push(`${f.replace(/[0-9a-f]{20,}/, '<random>')} → ${r.status}${/TFMSEC-MARK|SQLite format 3|app_key|CREATE TABLE/.test(r.text) ? ' (content served)' : ''}`);
    }
    return bad;
  };
  const DENY_FIX = 'Extend the FilesMatch of the root .htaccess and keep the per-folder "Require all denied".';
  // CONTRACT §15.7 #19 — anything in lib/ config/ database/ data/ cli/
  await check('S19', 'Apache: every file of lib/, config/, database/, data/ and cli/ is answered 403 / 404', { ...APACHE_MODE, sev: 'high', fix: DENY_FIX }, async () => {
    const no = await ap();
    if (no) return no;
    const list = treeOf(a.docroot).files.filter((f) => PRIVATE_DIR_RX.test(f));
    const bad = await deny(list);
    assert(!bad.length, `${bad.length} of ${list.length}: ${bad.slice(0, 5).join(' | ')}`);
    return `${list.length} files`;
  });
  await check('S19', 'Apache: the live database, secret.php, session files, logs and the lock file cannot be fetched', { ...APACHE_MODE, sev: 'high', fix: DENY_FIX }, async () => {
    const no = await ap();
    if (no) return no;
    const list = treeOf(a.docroot).files.filter((f) => /^data\//.test(f) && /\.sqlite|secret\.php|sess_|\.log|\.lock/.test(f));
    assert(list.some((f) => /sess_/.test(f)) && list.some((f) => /secret\.php/.test(f)) && (DRIVER !== 'sqlite' || list.some((f) => /\.sqlite$/.test(f))), `the runtime files are not there (${list.length} found)`);
    const bad = await deny(list);
    assert(!bad.length, bad.slice(0, 5).join(' | '));
    return `${list.length} runtime files`;
  });
  // CONTRACT §15.7 #19 — any .sqlite .sql .log .md .lock .ini .env .bak, config.local.php, backups
  await check('S19', 'Apache: leftovers of the contract list (.sqlite .sql .log .md .lock .ini .env .bak, config.local.php, backups) are answered 403 / 404 wherever they lie', { ...APACHE_MODE, sev: 'high', fix: DENY_FIX }, async () => {
    const no = await ap();
    if (no) return no;
    const list = [...LEFT_CONTRACT.map(([f]) => f).filter((f) => f !== 'data/install.lock'), ...treeOf(a.docroot).files.filter((f) => SECRET_FILE_RX.test(f) && !PRIVATE_DIR_RX.test(f))];
    const bad = await deny([...new Set(list)]);
    assert(!bad.length, bad.slice(0, 6).join(' | '));
    return `${new Set(list).size} files`;
  });
  await check('S19', 'Apache: the same holds for a sub-folder installation (/metaverse/…) and for path tricks (encoded traversal, case, trailing dot, PATH_INFO)', { ...APACHE_MODE, sev: 'high', fix: DENY_FIX }, async () => {
    const no = await ap();
    if (no) return no;
    const sample = ['lib/Core.php', 'config/config.php', 'config/config.local.php', 'data/secret.php', 'database/schema.sql', 'cli/tfm.php', '.env', 'backup.sql', 'README-SERVER.md', 'data/backups/tfm-2026-11-12.sqlite'];
    const bad = await deny(sample, a.alias());
    for (const raw of ['/api/../lib/Core.php', '/api/%2e%2e/lib/Core.php', '/api/..%2flib/Core.php', '/uploads/..%5cdata%5csecret.php', '/data/SECRET.PHP', '/lib/Core.php.', '/lib/Core.php%20', '/lib/Core.php/', '/data/secret.php/x.png', '/lib/Core.php%00.png', '/config/config.local.php%00.html', '//lib//Core.php', '/./data/./secret.php', '/metaverse/../data/secret.php']) {
      const r = await request(a, 'x', { rawPath: raw, headers: { Accept: '*/*' } });
      if (![400, 403, 404].includes(r.status) || /TFMSEC-MARK|app_key|<\?php/.test(r.text)) bad.push(`${raw} → ${r.status}`);
    }
    assert(!bad.length, bad.slice(0, 6).join(' | '));
    return `${sample.length} files under /metaverse/ + 14 path tricks`;
  });
  // CONTRACT §15.7 #19 — directory listing off
  await check('S19', 'Apache: no directory shows a listing', { ...APACHE_MODE, sev: 'medium', fix: 'Keep Options -Indexes.' }, async () => {
    const no = await ap();
    if (no) return no;
    const dirs = ['', ...treeOf(a.docroot).dirs];
    const bad = [];
    for (const d of dirs) {
      const r = await request(a, urlPath(d.replace(/\/$/, '')) + (d ? '/' : ''), { headers: HTML, dynamic: false });
      if (isListing(r)) bad.push(`/${d} lists its files`);
      else if (r.status === 200 && d !== '' && !/^uploads\/$/.test(d) && r.buf.length > 0 && !isAppShell(r) && !isSignIn(r)) bad.push(`/${d} → 200 (${r.buf.length} bytes)`);
    }
    assert(!bad.length, bad.slice(0, 5).join(' | '));
    return `${dirs.length} directories`;
  });
  // beyond the contract's explicit list: the other leftovers scanners look for first
  await check('S19', 'Apache: other common leftovers are not served either — hidden folders (.git/, .svn/), archives (*.zip, *.tar.gz), editor copies (*.php~, *.save)', { ...APACHE_MODE, sev: 'medium', fix: 'Root .htaccess: RedirectMatch 404 "(^|/)\\.(?!well-known)" for dot-folders, and add zip|tar|gz|tgz|7z|rar|save|~ to the denied suffixes.' }, async () => {
    const no = await ap();
    if (no) return no;
    const bad = await deny(LEFT_EXTRA.map(([f]) => f));
    assert(!bad.length, `${bad.length} of ${LEFT_EXTRA.length} served: ${bad.join(' | ')}`);
    return `${LEFT_EXTRA.length} files`;
  });
}

// =============================================================================
// checks over every answer of the run
// =============================================================================
async function globalScans() {
  const list = (arr, n = 4) => [...new Set(arr)].slice(0, n).join(' | ') + (new Set(arr).size > n ? ` (+${new Set(arr).size - n} more)` : '');
  // CONTRACT §15.7 #4 — API: JSON only, hex-escaped < > & ' "
  await check('S04', 'every JSON answer of this run is free of raw < > & \' characters', { sev: 'high', fix: 'Send every JSON answer through Api::send() (JSON_HEX_* flags).' }, async () => { assert(!TRAFFIC.jsonRaw.length, list(TRAFFIC.jsonRaw)); return `${TRAFFIC.n} answers scanned`; });
  // CONTRACT §15.7 #4 / #11 — CSP on every response
  await check('S04', 'every answer a PHP entry point produced in this run carries a Content-Security-Policy', { sev: 'medium', fix: 'Call Http::securityHeaders() before any output of an entry point (also on early exits).' }, async () => { assert(!TRAFFIC.noCsp.length, list(TRAFFIC.noCsp)); return `${TRAFFIC.n} answers scanned`; });
  // CONTRACT §15.7 #7 — no SQL error text
  await check('S07', 'no answer of this run contains database error text', { sev: 'high', fix: 'Never print a PDOException message; log it and answer the generic 500.' }, async () => { assert(!TRAFFIC.sql.length, list(TRAFFIC.sql)); return `${TRAFFIC.n} answers scanned`; });
  // CONTRACT §15.7 #8 — no secret in any response
  await check('S08', 'no answer of this run contains a secret (app / data keys of secret.php, DB password, payment secret key, password hash, private key)', { sev: 'high', fix: 'Remove the value from the answer; secrets stay in config.local.php / data/secret.php.' }, async () => { assert(!TRAFFIC.secrets.length, list(TRAFFIC.secrets)); return `${TRAFFIC.n} answers scanned`; });
  // CONTRACT §15.7 #16 — no stack traces / paths / PHP version in any response
  await check('S16', 'no answer of this run contains a stack trace, PHP error text, a server path, the PHP version or X-Powered-By', { sev: 'high', fix: 'Find the entry point in the list and route its errors through the generic handler; header_remove(\'X-Powered-By\').' }, async () => { assert(!TRAFFIC.debug.length, list(TRAFFIC.debug)); return `${TRAFFIC.n} answers scanned`; });
  await check('S16', 'no answer of this run is phpinfo() output', { sev: 'medium', fix: 'Remove the script.' }, async () => { assert(!TRAFFIC.phpinfo.length, list(TRAFFIC.phpinfo)); return `${TRAFFIC.n} answers scanned`; });
}

// =============================================================================
async function main() {
  if (!fs.existsSync(path.join(DOCROOT, 'api/ping.php'))) { console.error(`${DOCROOT}/api/ping.php not found — run "node tools/build.mjs --no-font --quiet" first, or pass --docroot.`); process.exit(2); }
  if (DRIVER === 'mysql' && !mysqlUp()) { console.error(`TFM_DB_DRIVER=mysql but no server answers at ${MY.host}:${MY.port}`); process.exit(2); }
  console.log(C.b(`\n전통발효체험관 보안 E2E — ${path.relative(ROOT, DOCROOT) || DOCROOT} · ${DRIVER}${APACHE ? ' · + Apache' : ''}${ONLY ? ' · only ' + [...ONLY].join(',') : ''} · run ${RUN}\n`));
  const t0 = Date.now();
  for (const item of [S01, S02, S03, S04, S05, S06, S07, S08, S09, S10, S11, S12, S13, S14, S15, S16, S19]) {
    try { await item(); } catch (e) {
      // a broken fixture must not hide the rest of the suite: report it as a failed check of that item
      emit({ item: item.name, check: `${item.name}: the checks could not run to the end`, status: 'gap', severity: 'high', evidence: oneLine(e instanceof Fail ? e.message : `${e && e.name}: ${e && e.message}`), fixProposal: '', contract: ITEMS[item.name] || '', mode: 'suite' });
      if (VERBOSE) console.error(e);
    }
  }
  await globalScans();
  for (const name of [...SERVERS.keys()]) await stopServer(name);

  console.log(C.b('\n── per item ──'));
  let failed = 0;
  for (const item of Object.keys(ITEMS)) {
    const rows = RESULTS.filter((r) => r.item === item && r.status !== 'info');
    if (!rows.length) continue;
    const n = (st) => rows.filter((r) => r.status === st).length;
    failed += n('gap');
    console.log(`${item}  ${ITEMS[item].padEnd(46)} ${String(n('pass')).padStart(3)} passed · ${String(n('gap')).padStart(3)} failed${n('skipped') ? ` · ${n('skipped')} skipped` : ''}`);
  }
  const total = RESULTS.filter((r) => r.status !== 'info');
  const passed = total.filter((r) => r.status === 'pass').length, skipped = total.filter((r) => r.status === 'skipped').length;
  console.log(`\n${failed ? C.r('✖') : C.g('✔')} ${passed}/${total.length - skipped} checks passed${skipped ? `, ${skipped} skipped` : ''} · ${TRAFFIC.n} requests · ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  if (JSON_OUT) fs.writeFileSync(JSON_OUT, JSON.stringify(RESULTS, null, 2) + '\n');
  cleanup();
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); cleanup(); process.exit(2); });
