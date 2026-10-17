#!/usr/bin/env node
// =============================================================================
// 전통발효체험관 메타버스 — PHP server end-to-end test (security + gameplay API)
//
//   node tests/server-e2e.mjs http://127.0.0.1:8099/     test a running server (e.g. php -S 127.0.0.1:8099 -t dist/metaverse)
//   node tests/server-e2e.mjs                            spawn its own `php -S` on a free port over dist/metaverse with a
//                                                        throw-away data dir (TFM_DATA_DIR), then clean up
//   options: --verbose (print every response)
//
// Prints PASS/FAIL per step and exits 1 when any step fails. Each run uses fresh random accounts, so it can be
// repeated against the same server. Note: the brute-force step records 5 failed logins from this IP; the
// per-IP credential-stuffing guard (30 failures / 15 min) therefore allows ~6 runs per 15 minutes.
// =============================================================================
import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { judgeAll, allTexts, allNicks, norm } from './pii-client.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const VERBOSE = args.includes('--verbose');
let BASE = args.find((a) => /^https?:\/\//.test(a)) || null;

// ------------------------------------------------------------------ result bookkeeping
const results = [];
const C = { g: (s) => `\x1b[32m${s}\x1b[0m`, r: (s) => `\x1b[31m${s}\x1b[0m`, d: (s) => `\x1b[2m${s}\x1b[0m`, b: (s) => `\x1b[1m${s}\x1b[0m` };
function record(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? C.g('PASS') : C.r('FAIL')}  ${name}${detail ? C.d('  — ' + detail) : ''}`);
}
async function step(name, fn) {
  try {
    const r = await fn();
    if (r === false) record(name, false);
    else record(name, true, typeof r === 'string' ? r : '');
  } catch (e) {
    record(name, false, e?.message || String(e));
  }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------------ HTTP client with a manual cookie jar
class Client {
  constructor(label) { this.label = label; this.jar = new Map(); this.csrf = null; }
  cookieHeader() { return [...this.jar].map(([k, v]) => `${k}=${v}`).join('; '); }
  sessionCookie() { return this.jar.get('TFMSESSID') || null; }
  storeCookies(res) {
    const list = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : (res.headers.get('set-cookie') ? [res.headers.get('set-cookie')] : []);
    for (const line of list) {
      const [pair, ...attrs] = line.split(';');
      const i = pair.indexOf('=');
      if (i < 0) continue;
      const name = pair.slice(0, i).trim();
      const value = pair.slice(i + 1).trim();
      const expired = attrs.some((a) => /^\s*max-age=0/i.test(a) || (/^\s*expires=/i.test(a) && Date.parse(a.split('=').slice(1).join('=')) < Date.now()));
      if (expired || value === '' || value === 'deleted') this.jar.delete(name); else this.jar.set(name, value);
    }
  }
  /** opts: {method, json, form, raw, headers, csrf:false|string, contentType} */
  async req(p, opts = {}) {
    const method = opts.method || (opts.json !== undefined || opts.form || opts.raw !== undefined ? 'POST' : 'GET');
    const headers = { Accept: 'application/json', ...(opts.headers || {}) };
    if (this.jar.size) headers.Cookie = this.cookieHeader();
    let body;
    if (opts.json !== undefined) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(opts.json); }
    else if (opts.raw !== undefined) { headers['Content-Type'] = opts.contentType || 'application/json'; body = opts.raw; }
    else if (opts.form) body = opts.form;
    if (method !== 'GET' && opts.csrf !== false) {
      const tok = typeof opts.csrf === 'string' ? opts.csrf : this.csrf;
      if (tok) headers['X-CSRF-Token'] = tok;
    }
    const res = await fetch(new URL(p, BASE), { method, headers, body, redirect: 'manual' });
    this.storeCookies(res);
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not json */ }
    if (json && typeof json.csrf === 'string') this.csrf = json.csrf;
    if (VERBOSE) console.log(C.d(`   ${this.label} ${method} ${p} -> ${res.status} ${text.slice(0, 300)}`));
    return { status: res.status, json, text, headers: res.headers, data: json?.data, error: json?.error };
  }
}

// ------------------------------------------------------------------ test fixtures
const rnd = () => crypto.randomBytes(4).toString('hex');
const PASSWORD = 'Ferment2026ok';

/** a realistic fresh client state (mirrors G.save.createDefaultState + farming prefill + starter jar) */
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
    quests: {},
    farm: { plots },
    jars: { J1: jar(true, { recipeId: 'FER001', status: 'FERMENTING', progress: 35, hygiene: 82, startedAt: t - 63000 }), J2: jar(false), J3: jar(false) },
    education: { viewed: {}, completed: {}, quiz: {} },
    journal: [], photos: [], achievements: {}, collection: {}, visited: { ZONE_MAIN: t }, poisVisited: {}, npcsTalked: {}, cropKinds: {},
    flags: {}, tutorial: { step: 0, done: false }, activity: [{ t, type: 'login', text: '입장 — 한글 🎉 테스트' }], settings: {}, blocked: [],
  };
}

/** cyrb53 — identical to G.util.hash (client checksum) */
function cyrb53(str) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0, ch; i < str.length; i++) { ch = str.charCodeAt(i); h1 = Math.imul(h1 ^ ch, 2654435761); h2 = Math.imul(h2 ^ ch, 1597334677); }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0');
}
/** request body exactly like G.save.ServerAdapter.save */
function saveBody(state) { const data = JSON.stringify(state); return { version: 1, checksum: cyrb53(data), data: state }; }

// ------------------------------------------------------------------ tiny PNG builder (valid image, no deps)
const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(buf) { let c = 0xffffffff; for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function makePng(w = 4, h = 4, extraChunks = []) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const rows = [];
  for (let y = 0; y < h; y++) { const r = Buffer.alloc(1 + w * 3); for (let x = 0; x < w; x++) { r[1 + x * 3] = 52; r[2 + x * 3] = 195; r[3 + x * 3] = 107; } rows.push(r); }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), ...extraChunks, chunk('IDAT', zlib.deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))]);
}
function photoForm(buf, name = 'journal.png', type = 'image/png') {
  const f = new FormData();
  f.append('photo', new Blob([buf], { type }), name);
  return f;
}

// ------------------------------------------------------------------ optional: spawn our own php -S
let phpProc = null, tmpData = null;
async function freePort() {
  return new Promise((resolve, reject) => { const s = net.createServer(); s.once('error', reject); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
}
async function startServer() {
  const docroot = path.join(ROOT, 'dist/metaverse');
  if (!fs.existsSync(path.join(docroot, 'api/ping.php'))) {
    console.error('dist/metaverse/api/ping.php not found — run "node tools/build.mjs" first, or pass a server URL.');
    process.exit(2);
  }
  tmpData = fs.mkdtempSync(path.join(os.tmpdir(), 'tfm-e2e-'));
  const port = await freePort();
  phpProc = spawn('php', ['-S', `127.0.0.1:${port}`, '-t', docroot], { env: { ...process.env, TFM_DATA_DIR: tmpData }, stdio: ['ignore', 'ignore', 'pipe'] });
  phpProc.stderr.on('data', (d) => { if (VERBOSE) process.stderr.write(C.d(String(d))); });
  BASE = `http://127.0.0.1:${port}/`;
  for (let i = 0; i < 50; i++) {
    try { const r = await fetch(BASE + 'api/ping.php'); if (r.ok) return; } catch { /* not yet */ }
    await sleep(100);
  }
  throw new Error('php -S did not start');
}
const uploadedFiles = [];
function cleanup() {
  if (phpProc) { try { phpProc.kill(); } catch { /* ignore */ } }
  if (tmpData) { try { fs.rmSync(tmpData, { recursive: true, force: true }); } catch { /* ignore */ } }
  if (phpProc) {
    // remove the photos this run uploaded into dist/metaverse/uploads
    for (const u of uploadedFiles) { try { fs.unlinkSync(path.join(ROOT, 'dist/metaverse', u)); } catch { /* ignore */ } }
    // and the then-empty dated folders (uploads/journal/YYYY/MM), so no test residue ends up in the release zip
    // (rmdirSync only removes empty folders; the server re-creates them on the next upload)
    const base = path.join(ROOT, 'dist/metaverse/uploads');
    for (const u of uploadedFiles) {
      let d = path.dirname(path.join(ROOT, 'dist/metaverse', u));
      while (d.startsWith(base + path.sep) && d !== base) { try { fs.rmdirSync(d); } catch { break; } d = path.dirname(d); }
    }
  }
}

// =============================================================================
async function main() {
  if (!BASE) await startServer();
  if (!BASE.endsWith('/')) BASE += '/';
  console.log(C.b(`\n전통발효체험관 서버 E2E — ${BASE}\n`));

  const A = new Client('A');            // main player
  const B = new Client('B');            // second player (presence / chat / report)
  const anon = new Client('anon');      // never logs in
  const id = rnd();
  const userA = { email: `e2e_${id}@example.com`, nickname: `발효${id.slice(0, 4)}`, password: PASSWORD };
  const userB = { email: `e2e_b${id}@example.com`, nickname: `Tester_${id.slice(0, 4)}`, password: PASSWORD };
  let me = null, stored = null, csrfBefore = null, cookieBefore = null;

  // ------------------------------------------------------------- basics
  await step('ping: server mode handshake + CSRF token', async () => {
    const r = await A.req('api/ping.php');
    assert(r.status === 200 && r.json?.success === true, `status ${r.status}`);
    assert(r.data.app === 'tfm-metaverse', 'app id');
    assert(typeof r.data.csrf === 'string' && r.data.csrf.length >= 32 && r.json.csrf === r.data.csrf, 'csrf in data and top level');
    assert(Number.isFinite(r.json.serverTime) && Math.abs(r.json.serverTime - Date.now()) < 120000, 'serverTime');
    assert(A.sessionCookie(), 'session cookie set');
    return `db=${r.data.db} v${r.data.version}`;
  });
  await step('security headers on JSON responses', async () => {
    const r = await anon.req('api/ping.php');
    const h = (k) => r.headers.get(k) || '';
    assert(/application\/json/.test(h('content-type')), 'content-type json');
    assert(h('x-content-type-options') === 'nosniff', 'nosniff');
    assert(/default-src 'none'/.test(h('content-security-policy')) && /frame-ancestors 'none'/.test(h('content-security-policy')), 'CSP');
    assert(h('x-frame-options') === 'DENY', 'X-Frame-Options');
    assert(h('referrer-policy') === 'no-referrer', 'Referrer-Policy');
    assert(/microphone=\(self\)/.test(h('permissions-policy')), 'Permissions-Policy');
    assert(h('cross-origin-opener-policy') === 'same-origin', 'COOP');
    assert(/no-store/.test(h('cache-control')), 'no-store');
    assert(!h('x-powered-by'), 'X-Powered-By leaked');
    const sc = typeof r.headers.getSetCookie === 'function' ? r.headers.getSetCookie().join(';') : h('set-cookie');
    assert(/HttpOnly/i.test(sc) && /SameSite=Lax/i.test(sc), 'cookie flags HttpOnly + SameSite=Lax');
  });
  await step('method enforcement: GET on a POST endpoint → 405', async () => {
    const r = await anon.req('api/auth/login.php');
    assert(r.status === 405 && r.error?.code === 'METHOD_NOT_ALLOWED' && /POST/.test(r.headers.get('allow') || ''), `status ${r.status}`);
  });
  await step('CSRF: login without token → 403', async () => {
    const r = await anon.req('api/auth/login.php', { json: { login: 'x@example.com', password: 'whatever1' }, csrf: false });
    assert(r.status === 403 && r.error?.code === 'CSRF_INVALID', `status ${r.status} ${r.error?.code}`);
  });
  await step('cross-site Origin is refused even with a valid token → 403', async () => {
    await anon.req('api/ping.php');
    const r = await anon.req('api/auth/login.php', { json: { login: 'x@example.com', password: 'whatever1' }, headers: { Origin: 'https://evil.example' } });
    assert(r.status === 403 && r.error?.code === 'CROSS_SITE_REQUEST', `status ${r.status} ${r.error?.code}`);
  });
  await step('register: validation (weak password, bad email, reserved nickname)', async () => {
    const c = new Client('v'); await c.req('api/ping.php');
    let r = await c.req('api/auth/register.php', { json: { email: `w${id}@example.com`, nickname: `약한${id.slice(0, 3)}`, password: 'abcdefgh', password_confirm: 'abcdefgh', agree: true } });
    assert(r.status === 400 && r.error?.code === 'PASSWORD_WEAK', `weak pw: ${r.status} ${r.error?.code}`);
    r = await c.req('api/auth/register.php', { json: { email: 'not-an-email', nickname: `nick${id.slice(0, 3)}`, password: PASSWORD, password_confirm: PASSWORD, agree: true } });
    assert(r.status === 400 && r.error?.code === 'EMAIL_INVALID', `email: ${r.status} ${r.error?.code}`);
    r = await c.req('api/auth/register.php', { json: { email: `r${id}@example.com`, nickname: '관리자', password: PASSWORD, password_confirm: PASSWORD, agree: true } });
    assert(r.status === 400 && r.error?.code === 'NICKNAME_INVALID', `nick: ${r.status} ${r.error?.code}`);
    r = await c.req('api/auth/register.php', { json: { email: `s${id}@example.com`, nickname: '<b>x</b>', password: PASSWORD, password_confirm: PASSWORD, agree: true } });
    assert(r.status === 400 && r.error?.code === 'NICKNAME_INVALID', `html nick: ${r.status} ${r.error?.code}`);
  });
  await step('register: nicknames that look like personal info are refused (phone · street address · game/SNS id · school · digit words)', async () => {
    const c = new Client('pii-nick'); await c.req('api/ping.php');
    const codes = [];
    for (const nickname of ['kid01012345', '테헤란로123', '로블록스dino12', '제페토dinokid', '해바라기초2학년', '공일공일이삼사']) {
      const r = await c.req('api/auth/register.php', { json: { email: `p${rnd()}@example.com`, nickname, password: PASSWORD, password_confirm: PASSWORD, agree: true } });
      assert(r.status === 400 && r.error?.code === 'NICKNAME_INVALID' && /개인정보/.test(r.error?.message || ''), `${nickname}: ${r.status} ${r.error?.code} ${r.error?.message}`);
      codes.push(`${nickname}→${r.status}`);
    }
    return codes.join(', ');
  });
  await step('register → logged in, session id + CSRF rotated', async () => {
    csrfBefore = A.csrf; cookieBefore = A.sessionCookie();
    const r = await A.req('api/auth/register.php', { json: { email: userA.email, nickname: userA.nickname, password: PASSWORD, password_confirm: PASSWORD, agree: true } });
    assert(r.status === 200 && r.data?.user?.id, `status ${r.status} ${r.error?.code || ''}`);
    me = r.data.user;
    assert(me.nickname === userA.nickname && me.role === 'user' && me.email === userA.email, 'user fields');
    assert(A.csrf && A.csrf !== csrfBefore, 'csrf rotated');
    assert(A.sessionCookie() && A.sessionCookie() !== cookieBefore, 'session id regenerated (fixation defence)');
    return `user #${me.id}`;
  });
  await step('register: duplicate email / nickname → 409', async () => {
    const c = new Client('dup'); await c.req('api/ping.php');
    let r = await c.req('api/auth/register.php', { json: { email: userA.email.toUpperCase(), nickname: `other${id.slice(0, 4)}`, password: PASSWORD, password_confirm: PASSWORD, agree: true } });
    assert(r.status === 409 && r.error?.code === 'EMAIL_TAKEN', `email: ${r.status} ${r.error?.code}`);
    r = await c.req('api/auth/register.php', { json: { email: `x${id}@example.com`, nickname: userA.nickname, password: PASSWORD, password_confirm: PASSWORD, agree: true } });
    assert(r.status === 409 && r.error?.code === 'NICKNAME_TAKEN', `nick: ${r.status} ${r.error?.code}`);
  });
  await step('me → current user', async () => {
    const r = await A.req('api/auth/me.php');
    assert(r.status === 200 && String(r.data?.user?.id) === String(me.id), `status ${r.status}`);
    const a = await anon.req('api/auth/me.php');
    assert(a.status === 200 && a.data?.user === null, 'anonymous me → user:null (200)');
  });

  // ------------------------------------------------------------- saves
  let state = null;
  let savedAtMs = Date.now(); // when the last accepted save reached the server (movement plausibility)
  await step('player/get: new account has no save', async () => {
    const r = await A.req('api/player/get.php');
    assert(r.status === 200 && r.data?.save === null, `status ${r.status} save=${JSON.stringify(r.data?.save)?.slice(0, 40)}`);
  });
  await step('player/save: valid first save accepted', async () => {
    state = freshState(me);
    const r = await A.req('api/player/save.php', { json: saveBody(state) });
    assert(r.status === 200 && Number.isFinite(r.data?.savedAt) && r.data.revision === 1, `status ${r.status} ${r.error?.code || ''} ${JSON.stringify(r.data || '').slice(0, 160)}`);
  });
  await step('player/get: returns the save ({} / [] preserved, profile forced)', async () => {
    const r = await A.req('api/player/get.php');
    const d = r.data?.save?.data;
    assert(r.status === 200 && d, `status ${r.status}`);
    assert(d.inventory.ITEM_SEED_BEAN === 3 && d.jars.J1.recipeId === 'FER001', 'content');
    assert(d.quests && typeof d.quests === 'object' && !Array.isArray(d.quests), 'empty object stays an object');
    assert(Array.isArray(d.journal) && d.journal.length === 0, 'empty array stays an array');
    assert(d.activity[0].text.includes('🎉'), 'unicode round trip');
    assert(d.profile.id === String(me.id) && d.profile.role === 'user', 'profile');
    stored = d;
  });
  await step('player/save: legitimate progress (harvest ripe radish) accepted', async () => {
    await sleep(1200);
    const s = structuredClone(stored);
    const t = Date.now();
    Object.assign(s.farm.plots.P6, { cropId: null, growth: 0, health: 100, plantedAt: 0, lastUpdate: t, harvests: 1 });
    s.inventory.ITEM_RADISH = 4;
    s.stats.harvests = 1; s.stats.harvestedItems = 4; s.stats.coin += 30; s.stats.exp += 35; s.stats.expTotal = 35;
    s.cropKinds = { CROP_RADISH: t };
    s.savedAt = t;
    const r = await A.req('api/player/save.php', { json: saveBody(s) });
    assert(r.status === 200 && r.data?.revision === 2, `status ${r.status} ${r.error?.code || ''} ${JSON.stringify(r.data || '').slice(0, 200)}`);
    stored = s;
  });
  await step('cheating save: +1,000,000 coins → 409 VALIDATION_FAILED with stored save', async () => {
    const s = structuredClone(stored);
    s.stats.coin += 1000000;
    const r = await A.req('api/player/save.php', { json: saveBody(s) });
    assert(r.status === 409 && r.error?.code === 'VALIDATION_FAILED', `status ${r.status} ${r.error?.code}`);
    assert(r.json?.data?.save?.data?.stats?.coin === stored.stats.coin, 'stored copy returned for restore');
    assert((r.json.data.violations || []).some((v) => /VALUE/.test(v)), `violations ${r.json.data.violations}`);
    return (r.json.data.violations || []).join(',');
  });
  await step('cheating save: 999 fermented items (inventory injection) → 409', async () => {
    const s = structuredClone(stored);
    s.inventory.ITEM_GOCHUJANG = 999;
    const r = await A.req('api/player/save.php', { json: saveBody(s) });
    assert(r.status === 409 && r.error?.code === 'VALIDATION_FAILED', `status ${r.status} ${r.error?.code}`);
  });
  await step('cheating save: role escalation profile.role=admin → 409', async () => {
    const s = structuredClone(stored);
    s.profile.role = 'admin';
    const r = await A.req('api/player/save.php', { json: saveBody(s) });
    assert(r.status === 409 && (r.json?.data?.violations || []).includes('PROFILE_ROLE'), `status ${r.status} ${r.json?.data?.violations}`);
  });
  await step('cheating save: instant crop growth (plant + 100% in 1 s) → 409', async () => {
    const s = structuredClone(stored);
    const t = Date.now();
    Object.assign(s.farm.plots.H3, { cropId: 'CROP_CORN', growth: 100, plantedAt: t, lastUpdate: t });
    s.inventory.ITEM_SEED_BEAN -= 1;
    const r = await A.req('api/player/save.php', { json: saveBody(s) });
    assert(r.status === 409 && (r.json?.data?.violations || []).includes('GROWTH_TOO_FAST'), `status ${r.status} ${r.json?.data?.violations}`);
  });
  await step('cheating save: instant fermentation claim → 409', async () => {
    const s = structuredClone(stored);
    const t = Date.now();
    Object.assign(s.jars.J1, { status: 'CLAIMED', progress: 100, claimedAt: t, completedAt: t });
    s.stats.fermentsClaimed = 1; s.inventory.ITEM_DOENJANG = 3; s.stats.coin += 300; s.stats.exp += 100;
    const r = await A.req('api/player/save.php', { json: saveBody(s) });
    assert(r.status === 409 && (r.json?.data?.violations || []).includes('FERMENT_TOO_FAST'), `status ${r.status} ${r.json?.data?.violations}`);
  });
  await step('cheating save: fake crafts without ingredients (+30 meju) → 409', async () => {
    const s = structuredClone(stored);
    s.stats.crafts = 30; s.inventory.ITEM_MEJU = (s.inventory.ITEM_MEJU || 0) + 30; s.stats.exp += 100;
    const r = await A.req('api/player/save.php', { json: saveBody(s) });
    assert(r.status === 409 && (r.json?.data?.violations || []).includes('CRAFT_COUNT'), `status ${r.status} ${r.json?.data?.violations}`);
  });
  await step('integrity: checksum mismatch → 400', async () => {
    const body = saveBody(stored);
    body.checksum = '00000000000000';
    const r = await A.req('api/player/save.php', { json: body });
    assert(r.status === 400 && r.error?.code === 'CHECKSUM_MISMATCH', `status ${r.status} ${r.error?.code}`);
  });
  await step('CSRF: save without token → 403', async () => {
    const r = await A.req('api/player/save.php', { json: saveBody(stored), csrf: false });
    assert(r.status === 403 && r.error?.code === 'CSRF_INVALID', `status ${r.status} ${r.error?.code}`);
  });
  await step('beacon save: CSRF token in the JSON body accepted, wrong token refused', async () => {
    const s = structuredClone(stored);
    s.stats.distance = 12;
    const ok = await A.req('api/player/save.php', { raw: JSON.stringify({ ...saveBody(s), csrf: A.csrf }), csrf: false });
    assert(ok.status === 200, `valid beacon: ${ok.status} ${ok.error?.code}`);
    stored = s;
    savedAtMs = Date.now();
    const bad = await A.req('api/player/save.php', { raw: JSON.stringify({ ...saveBody(s), csrf: 'f'.repeat(64) }), csrf: false });
    assert(bad.status === 403 && bad.error?.code === 'CSRF_INVALID', `forged beacon: ${bad.status}`);
  });
  await step('player/save: 3× speed — running at 18 m/s for the elapsed time is accepted', async () => {
    await sleep(2100);
    const s = structuredClone(stored);
    const elapsed = (Date.now() - savedAtMs) / 1000;
    // RUN = 18 m/s (phase 4) the whole time since the last save, plus the ≤ 5 m the client batches per event
    s.stats.distance = Math.round(s.stats.distance + 18 * elapsed + 5);
    s.stats.playTime = Math.round((s.stats.playTime || 0) + elapsed);
    s.savedAt = Date.now();
    const r = await A.req('api/player/save.php', { json: saveBody(s) });
    assert(r.status === 200, `status ${r.status} ${r.error?.code || ''} ${JSON.stringify(r.json?.data?.violations || '')}`);
    stored = s; savedAtMs = Date.now();
    return `+${Math.round(18 * elapsed + 5)} m in ${elapsed.toFixed(1)} s`;
  });
  await step('cheating save: teleport-sized distance (+10,000,000 m) → 409 DISTANCE_TOO_FAST', async () => {
    const s = structuredClone(stored);
    s.stats.distance += 10000000;
    const r = await A.req('api/player/save.php', { json: saveBody(s) });
    assert(r.status === 409 && (r.json?.data?.violations || []).includes('DISTANCE_TOO_FAST'), `status ${r.status} ${r.json?.data?.violations}`);
  });
  await step('cheating save: 100× the legal speed for a minute of claimed movement (+60 km) → 409 DISTANCE_TOO_FAST', async () => {
    const s = structuredClone(stored);
    s.stats.distance += 60000;
    const r = await A.req('api/player/save.php', { json: saveBody(s) });
    assert(r.status === 409 && (r.json?.data?.violations || []).includes('DISTANCE_TOO_FAST'), `status ${r.status} ${r.json?.data?.violations}`);
  });
  await step('cheating save: play time faster than the clock (+1 day in seconds) → 409 PLAYTIME_TOO_FAST', async () => {
    const s = structuredClone(stored);
    s.stats.playTime = (s.stats.playTime || 0) + 86400;
    const r = await A.req('api/player/save.php', { json: saveBody(s) });
    assert(r.status === 409 && (r.json?.data?.violations || []).includes('PLAYTIME_TOO_FAST'), `status ${r.status} ${r.json?.data?.violations}`);
  });
  await step('cheating save: absurd stat (distance 1e12) → 409 STAT_RANGE', async () => {
    const s = structuredClone(stored);
    s.stats.distance = 1e12;
    const r = await A.req('api/player/save.php', { json: saveBody(s) });
    const v = r.json?.data?.violations || [];
    assert(r.status === 409 && v.includes('STAT_RANGE'), `status ${r.status} violations ${v} ${r.error?.code}`);
    return v.join(',');
  });
  await step('save size limit → 413', async () => {
    const s = structuredClone(stored);
    s.journal = [{ id: 'j1', memo: 'x'.repeat(1600000) }];
    const r = await A.req('api/player/save.php', { json: saveBody(s) });
    assert(r.status === 413, `status ${r.status} ${r.error?.code}`);
  });

  // ------------------------------------------------------------- second account, presence, chat
  await step('second player registers', async () => {
    await B.req('api/ping.php');
    const r = await B.req('api/auth/register.php', { json: { email: userB.email, nickname: userB.nickname, password: PASSWORD, password_confirm: PASSWORD, agree: true } });
    assert(r.status === 200, `status ${r.status} ${r.error?.code}`);
    userB.id = r.data.user.id;
  });
  await step('presence: upsert + list others (nickname from account, appearance whitelisted)', async () => {
    let r = await A.req('api/presence/update.php', { json: { x: 1.5, y: 0, z: 2.5, rotY: 0.5, anim: 'walk', speed: 3, zoneId: 'ZONE_MAIN', emote: null, emoteAt: 0, nickname: 'admin', appearance: { hair: 'bun', topColor: '#2f7d4a', evil: '<script>', skin: 'javascript:alert(1)', height: 9 } } });
    assert(r.status === 200 && Array.isArray(r.data?.players), `A: ${r.status}`);
    r = await B.req('api/presence/update.php', { json: { x: 3, y: 0, z: 2, rotY: 0, anim: 'idle', speed: 0, zoneId: 'ZONE_MAIN' } });
    assert(r.status === 200, `B: ${r.status}`);
    const a = (r.data.players || []).find((p) => p.id === String(me.id));
    assert(a, 'B sees A');
    assert(a.nickname === userA.nickname, 'nickname cannot be spoofed');
    assert(a.anim === 'walk' && a.x === 1.5, 'position/anim');
    assert(a.appearance && a.appearance.hair === 'bun' && !('evil' in a.appearance) && !('skin' in a.appearance) && a.appearance.height === 1.1, `appearance ${JSON.stringify(a.appearance)}`);
    assert(!('email' in a), 'no email leak');
    assert(r.data.online >= 2, 'online count');
    return `online=${r.data.online}`;
  });
  let msgId = null;
  await step('chat: send (bad word masked) + list', async () => {
    let r = await A.req('api/chat/send.php', { json: { text: '안녕하세요 시 발 반가워요 <img src=x onerror=alert(1)>', channel: 'all' } });
    assert(r.status === 200 && r.data?.message?.id, `send ${r.status} ${r.error?.code}`);
    msgId = r.data.message.id;
    assert(r.data.message.text.includes('♡♡') && !/시 발/.test(r.data.message.text), `masking: ${r.data.message.text}`);
    assert(!r.text.includes('<img'), 'JSON escapes < (\\u003C)');
    r = await B.req('api/chat/list.php?after=0');
    const m = (r.data?.messages || []).find((x) => x.id === msgId);
    assert(r.status === 200 && m && m.nickname === userA.nickname && m.userId === String(me.id), 'B receives the message');
    const g = await anon.req(`api/chat/list.php?after=${msgId - 1}`);
    assert(g.status === 200 && (g.data?.messages || []).some((x) => x.id === msgId), 'guests can read');
  });
  await step('chat: 1 msg/s rate limit, repeat spam blocked, guests cannot send', async () => {
    const t1 = await A.req('api/chat/send.php', { json: { text: `빠른 메시지 ${id}`, channel: 'all' } });
    assert(t1.status === 429 && t1.error?.code === 'RATE_LIMITED', `rate: ${t1.status} ${t1.error?.code}`);
    await sleep(1100);
    const ok = await A.req('api/chat/send.php', { json: { text: `반복 ${id}`, channel: 'all' } });
    assert(ok.status === 200, `send: ${ok.status}`);
    await sleep(1100);
    const dup = await A.req('api/chat/send.php', { json: { text: `반복  ${id}!!`, channel: 'all' } });
    assert(dup.status === 409 && dup.error?.code === 'DUPLICATE_MESSAGE', `dup: ${dup.status} ${dup.error?.code}`);
    const g = await anon.req('api/chat/send.php', { json: { text: 'hi', channel: 'all' } });
    assert(g.status === 401 && g.error?.code === 'AUTH_REQUIRED', `guest: ${g.status}`);
    const long = await B.req('api/chat/send.php', { json: { text: 'ㅋ'.repeat(121), channel: 'all' } });
    assert(long.status === 400 && long.error?.code === 'MESSAGE_TOO_LONG', `length: ${long.status}`);
  });
  await step('chat: personal information masked with 🔒 before storing (phone · e-mail · URL · address), innocent text untouched', async () => {
    await sleep(1100);
    const pii = '전화 +82 10 1234 5678, 메일 kid.dino@gmail.com, 집 서울시 강남구 테헤란로 123, 010-9876-5432, https://evil.example.com/x';
    const r = await A.req('api/chat/send.php', { json: { text: pii, channel: 'all' } });
    assert(r.status === 200 && r.data?.message?.id, `send ${r.status} ${r.error?.code}`);
    const t = r.data.message.text;
    assert(r.data.piiMasked === true, 'piiMasked flag for the mascot tip');
    assert(t.includes('🔒') && !/[0-9]{3,}|@|gmail|evil|테헤란로|강남구/.test(t), `masked: ${t}`);
    const l = await B.req(`api/chat/list.php?after=${r.data.message.id - 1}`);
    const m = (l.data?.messages || []).find((x) => x.id === r.data.message.id);
    assert(m && m.text === t && !/1234|5678|kid\.dino/.test(l.text), 'other players only ever see the masked copy');
    await sleep(1100);
    const ok = await A.req('api/chat/send.php', { json: { text: `오늘 콩 3개 심었어요! 레벨 12 됐어요 😊 ${id.slice(0, 2)}`, channel: 'all' } });
    assert(ok.status === 200 && ok.data?.piiMasked === false && ok.data.message.text.startsWith('오늘 콩 3개 심었어요! 레벨 12 됐어요 😊'), `innocent: ${ok.status} ${ok.data?.message?.text}`);
    return t;
  });
  await step('chat: server PII rules are the client rules (node tests/pii-sync.mjs --check)', async () => {
    const r = spawnSync(process.execPath, [path.join(ROOT, 'tests/pii-sync.mjs'), '--check'], { encoding: 'utf8' });
    assert(r.status === 0, `out of sync: ${String(r.stdout + r.stderr).trim().slice(0, 300)}`);
    return String(r.stdout).trim().split('\n').pop();
  });
  await step('chat: shared PII vectors (tests/pii-vectors.json) through the real server filters — whole · partial · keep · leak · nickname, with and without intl', async () => {
    const v = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests/pii-vectors.json'), 'utf8'));
    const texts = allTexts(v), nicks = allNicks(v);
    const notes = [];
    for (const [label, phpArgs] of [['intl', []], ['no-intl', ['-n', '-d', 'extension=mbstring', '-d', 'extension=pdo', '-d', 'extension=pdo_sqlite']]]) {
      const r = spawnSync('php', [...phpArgs, path.join(ROOT, 'tests/pii-server.php')], { input: JSON.stringify({ texts, nicks }), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
      assert(r.status === 0, `${label}: php exit ${r.status}: ${String(r.stderr).slice(0, 200)}`);
      const out = JSON.parse(r.stdout);
      const fails = judgeAll(v, out.mask, out.nick.map((e) => e !== null));
      assert(!fails.length, `${label}: ${fails.length} failure(s): ${fails.slice(0, 3).map((f) => JSON.stringify(f)).join(' | ')}`);
      // the full send.php pipeline (cleanText → maskPII → bad-word mask) must not let a secret through either
      const w = v.whole.length + v.partial.length + v.keep.length;
      const pipeLeak = v.leak.filter((x, k) => x.secrets.some((sec) => norm(out.pipe[w + k]).includes(norm(sec))));
      const pipeWhole = v.whole.filter((t, k) => out.pipe[k] !== '🔒');
      assert(!pipeLeak.length && !pipeWhole.length, `${label} pipeline: ${[...pipeLeak.map((x) => x.id), ...pipeWhole].slice(0, 4).join(' | ')}`);
      assert(out.rules.length >= 30, `${label}: only ${out.rules.length} rules loaded (lib/pii-rules.json missing?)`);
      notes.push(`${label}${out.intl ? '' : '(fallback fold)'} ✓`);
    }
    return `${texts.length} texts + ${nicks.length} nicknames · ${notes.join(' · ')}`;
  });
  await step('chat: disguised phone / e-mail / domain forms are masked by the live API (full-width, / separators, Korean digits, "at … dot")', async () => {
    const cases = ['０１０-１２３４-５６７８', '010/1234/5678', '공일공-일이삼사-오육칠팔', 'dinokid at gmail dot com', 'bad[.]com 와',
      '0\u200b1\u200b0 1\u00ad2\u00ad3\u00ad4 5\u20606\u20607\u20608', '공1공 1234 5678'];
    const outs = [];
    for (const t of cases) {
      await sleep(1100);
      const r = await A.req('api/chat/send.php', { json: { text: `${t} 친구${'가나다라마바사아'[outs.length]}`, channel: 'all' } });
      assert(r.status === 200 && r.data?.piiMasked === true, `${t}: ${r.status} ${r.error?.code} piiMasked=${r.data?.piiMasked}`);
      const m = r.data.message.text;
      assert(m.startsWith('🔒') && !/[0-9０-９]{4}|일이삼사|gmail|bad/.test(m), `${t} → ${m}`);
      outs.push(m);
    }
    return outs.join(' · ');
  });
  await step('chat: the stored repeat-spam key holds no personal information (built from the masked text)', async () => {
    if (!tmpData) return 'skipped (external server: no access to its database)';
    const dbf = fs.readdirSync(tmpData).find((f) => /^db-.*\.sqlite$/.test(f));
    assert(dbf, `sqlite file in ${tmpData}`);
    const q = spawnSync('php', ['-r', '$p = new PDO("sqlite:" . $argv[1]); echo json_encode($p->query("SELECT text, text_key FROM chat_messages")->fetchAll(PDO::FETCH_ASSOC), JSON_UNESCAPED_UNICODE);', path.join(tmpData, dbf)], { encoding: 'utf8' });
    assert(q.status === 0, `php ${q.status} ${String(q.stderr).slice(0, 200)}`);
    const rows = JSON.parse(q.stdout);
    const leak = rows.filter((r) => /[0-9]{9,}|gmail|kiddino|dinokid|evil|테헤란로/.test(String(r.text_key)) || /[0-9]{4}[^0-9]?[0-9]{4}/.test(String(r.text_key)));
    assert(rows.length >= 3 && !leak.length, `leaking keys: ${leak.map((r) => r.text_key).slice(0, 3).join(' | ')}`);
    const sv = spawnSync('php', ['-r', '$p = new PDO("sqlite:" . $argv[1]); echo (int) $p->query("SELECT MAX(version) FROM schema_version")->fetchColumn();', path.join(tmpData, dbf)], { encoding: 'utf8' });
    assert(Number(sv.stdout) >= 2, `schema version ${sv.stdout}`);
    return `${rows.length} rows, keys clean, schema v${sv.stdout}`;
  });
  await step('chat: report', async () => {
    const r = await B.req('api/chat/report.php', { json: { target: userA.nickname, targetId: String(me.id), messageId: msgId, text: 'ignored client copy', reason: 'abuse', memo: '테스트 신고' } });
    assert(r.status === 200 && r.data?.reportId, `status ${r.status} ${r.error?.code}`);
    const again = await B.req('api/chat/report.php', { json: { target: userA.nickname, messageId: msgId, reason: 'abuse' } });
    assert(again.status === 200 && again.data?.duplicate === true, 'duplicate report is idempotent');
    const self = await A.req('api/chat/report.php', { json: { target: userA.nickname, targetId: String(me.id), reason: 'spam' } });
    assert(self.status === 400, 'self report refused');
  });
  await step('chat: a report about an unknown name stores no personal information for the admins', async () => {
    const r = await B.req('api/chat/report.php', { json: { target: '모르는친구 010-2468-1357', reason: 'privacy', memo: '전화번호 공일공 이사육팔 일삼오칠 을 보냈어요' } });
    assert(r.status === 200 && r.data?.reportId, `status ${r.status} ${r.error?.code}`);
    if (!tmpData) return 'stored copy not checked (external server)';
    const dbf = fs.readdirSync(tmpData).find((f) => /^db-.*\.sqlite$/.test(f));
    const q = spawnSync('php', ['-r', '$p = new PDO("sqlite:" . $argv[1]); $s = $p->prepare("SELECT target_name, memo FROM chat_reports WHERE id = ?"); $s->execute([(int) $argv[2]]); echo json_encode($s->fetch(PDO::FETCH_ASSOC), JSON_UNESCAPED_UNICODE);', path.join(tmpData, dbf), String(r.data.reportId)], { encoding: 'utf8' });
    const row = JSON.parse(q.stdout || 'null');
    assert(row && !/2468|1357|이사육팔|일삼오칠/.test(row.target_name + row.memo) && row.target_name.includes('🔒'), `stored ${JSON.stringify(row)}`);
    return `${row.target_name} · ${row.memo}`;
  });
  await step('ranking: top list, nicknames only', async () => {
    const r = await A.req('api/ranking/top.php');
    assert(r.status === 200 && Array.isArray(r.data?.ranking), `status ${r.status}`);
    for (const e of r.data.ranking) assert(!('email' in e) && !('id' in e) && !('user_id' in e) && typeof e.nickname === 'string', 'no ids/emails');
    assert(r.data.me && r.data.me.rank >= 1 && r.data.me.nickname === userA.nickname, 'my rank');
    return `my rank ${r.data.me.rank} of ${r.data.total}`;
  });
  await step('ranking: profile.title from a save is shown only when it is a real game title (no free text)', async () => {
    const titled = async (title) => {
      await sleep(1100);
      const s = structuredClone(stored);
      s.profile.title = title; s.savedAt = Date.now();
      const w = await A.req('api/player/save.php', { json: saveBody(s) });
      assert(w.status === 200, `save ${w.status} ${w.error?.code} ${JSON.stringify(w.json?.data?.violations || '')}`);
      stored = s;
      const r = await A.req('api/ranking/top.php');
      return (r.data?.ranking || []).find((e) => e.me);
    };
    let mine = await titled('내번호 01012345678');
    if (!mine) return 'skipped: this account is not in the top 20 on this server';
    assert(mine.title === '', `free-text title leaked into the ranking: "${mine.title}"`);
    mine = await titled('입문자');
    assert(mine?.title === '입문자', `real title shown: "${mine?.title}"`);
    return 'free text → "", 입문자 → 입문자';
  });
  await step('time.php', async () => {
    const r = await anon.req('api/time.php');
    assert(r.status === 200 && Math.abs(r.data.serverTime - Date.now()) < 120000, `status ${r.status}`);
  });

  // ------------------------------------------------------------- uploads
  await step('upload: tiny PNG accepted, re-encoded, served as an image', async () => {
    const r = await A.req('api/journal/upload.php', { form: photoForm(makePng(6, 4)) });
    assert(r.status === 200 && r.data?.url, `status ${r.status} ${r.error?.code}`);
    assert(/^uploads\/journal\/\d{4}\/\d{2}\/[a-f0-9]{32}\.(png|jpg|webp)$/.test(r.data.url), `url ${r.data.url}`);
    uploadedFiles.push(r.data.url);
    const img = await fetch(new URL(r.data.url, BASE));
    const buf = Buffer.from(await img.arrayBuffer());
    assert(img.status === 200 && buf.subarray(1, 4).toString('latin1') === 'PNG', `fetch ${img.status}`);
    return r.data.url;
  });
  await step('upload: PHP-in-PNG polyglot rejected', async () => {
    const evil = makePng(4, 4, [chunk('tEXt', Buffer.from('Comment\0<?php system($_GET["c"]); ?>', 'latin1'))]);
    let r = await A.req('api/journal/upload.php', { form: photoForm(evil, 'shell.php.png') });
    assert(r.status === 400 && r.error?.code === 'UPLOAD_REJECTED', `tEXt payload: ${r.status} ${r.error?.code}`);
    const appended = Buffer.concat([makePng(4, 4), Buffer.from('<?php echo "pwned"; ?>')]);
    r = await A.req('api/journal/upload.php', { form: photoForm(appended, 'a.png') });
    assert(r.status === 400 && r.error?.code === 'UPLOAD_REJECTED', `appended payload: ${r.status} ${r.error?.code}`);
  });
  await step('upload: non-image disguised as PNG rejected', async () => {
    const r = await A.req('api/journal/upload.php', { form: photoForm(Buffer.from('hello, I am not an image'), 'x.png') });
    assert(r.status === 400 && r.error?.code === 'UPLOAD_TYPE', `status ${r.status} ${r.error?.code}`);
    const g = await anon.req('api/journal/upload.php', { form: photoForm(makePng()) });
    assert(g.status === 401 || g.status === 403, `guest upload ${g.status}`);
  });

  // ------------------------------------------------------------- admin & private files
  await step('admin: stats requires admin (403 for a player)', async () => {
    const r = await A.req('api/admin/stats.php');
    assert(r.status === 403 && r.error?.code === 'FORBIDDEN', `status ${r.status}`);
    const g = await anon.req('api/admin/stats.php');
    assert(g.status === 401, `anonymous ${g.status}`);
  });
  await step('admin: health (localhost bootstrap or admin only)', async () => {
    const r = await A.req('api/admin/health.php?quick=1');
    if (r.status === 403) return 'admin already exists → 403 for non-admins (expected)';
    assert(r.status === 200 && Array.isArray(r.data?.checks) && r.data.db?.ok === true, `status ${r.status}`);
    const fails = r.data.checks.filter((c) => c.status === 'fail').map((c) => c.id);
    for (const id of ['pii_rules', 'pii_filter']) {
      const c = r.data.checks.find((x) => x.id === id);
      assert(c && c.status === 'ok', `${id}: ${JSON.stringify(c)}`);
    }
    return `status=${r.data.status} fail=[${fails.join(',')}] access=${r.data.access} · PII self-check ok`;
  });
  await step('private files are not served (config/lib/data/database/cli)', async () => {
    for (const p of ['config/config.php', 'lib/Core.php', 'lib/bootstrap.php', 'data/secret.php', 'data/', 'database/', 'cli/tfm.php', 'lib/']) {
      const r = await fetch(new URL(p, BASE));
      const t = await r.text();
      assert(r.status === 404 || r.status === 403, `${p} → ${r.status}`);
      assert(!/app_key|password|CREATE TABLE|<\?php/.test(t), `${p} leaked content`);
    }
  });

  // ------------------------------------------------------------- logout / login / restore
  await step('logout → session ended', async () => {
    const before = A.sessionCookie();
    const r = await A.req('api/auth/logout.php', { json: {} });
    assert(r.status === 200 && r.data?.loggedOut === true, `status ${r.status}`);
    assert(A.sessionCookie() !== before, 'new session id after logout');
    const m = await A.req('api/auth/me.php');
    assert(m.status === 200 && m.data.user === null, 'me → null');
    const g = await A.req('api/player/get.php');
    assert(g.status === 401, `get after logout ${g.status}`);
  });
  await step('login (by nickname) → get restores the accepted save', async () => {
    const r = await A.req('api/auth/login.php', { json: { email: userA.nickname, login: userA.nickname, password: PASSWORD, remember: false } });
    assert(r.status === 200 && String(r.data?.user?.id) === String(me.id), `login ${r.status} ${r.error?.code}`);
    const g = await A.req('api/player/get.php');
    const d = g.data?.save?.data;
    assert(g.status === 200 && d, `get ${g.status}`);
    assert(d.stats.coin === stored.stats.coin && d.stats.distance === stored.stats.distance && d.stats.distance > 12 && d.inventory.ITEM_RADISH === 4, `coin ${d.stats.coin} vs ${stored.stats.coin}`);
    return `revision ${g.data.save.revision}`;
  });
  await step('engagement: daily check-in + missions explained once per day (re-claim after un-claiming → 409)', async () => {
    const meB = { id: userB.id, nickname: userB.nickname, email: userB.email, role: 'user' };
    const s0 = freshState(meB);
    let r = await B.req('api/player/save.php', { json: saveBody(s0) });
    assert(r.status === 200, `first save ${r.status} ${r.error?.code}`);
    await sleep(1100);
    const d = new Date();
    const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const daily = (claimed) => ({ day, missions: [0, 1, 2].map((i) => ({ id: `M${i}`, target: 1, progress: 1, done: true, claimed })), bonus: claimed });
    // claim check-in + 3 missions + bonus; 2,090 coins exceeds the per-save allowance (~1,520) unless the claims are explained
    const s1 = structuredClone(s0);
    s1.engagement = { v: 1, checkin: { lastDay: day, streak: 1, best: 1, total: 1, days: [day] }, daily: daily(true), decor: [] };
    s1.stats.coin += 2090; s1.savedAt = Date.now();
    r = await B.req('api/player/save.php', { json: saveBody(s1) });
    assert(r.status === 200, `claim save ${r.status} ${JSON.stringify(r.json?.data?.violations || r.error?.code)}`);
    // un-claim (no value change → accepted), then claim the same day again → the ledger refuses a second explanation
    const s2 = structuredClone(s1);
    s2.engagement.checkin = { lastDay: null, streak: 0, best: 1, total: 1, days: [] }; s2.engagement.daily = daily(false); s2.savedAt = Date.now();
    r = await B.req('api/player/save.php', { json: saveBody(s2) });
    assert(r.status === 200, `un-claim save ${r.status} ${JSON.stringify(r.json?.data?.violations || r.error?.code)}`);
    const s3 = structuredClone(s1);
    s3.stats.coin += 2090; s3.savedAt = Date.now();
    r = await B.req('api/player/save.php', { json: saveBody(s3) });
    assert(r.status === 409 && (r.json?.data?.violations || []).includes('UNEXPLAINED_VALUE'), `replay ${r.status} ${r.json?.data?.violations}`);
    return 'claim accepted, replay refused';
  });
  await step('brute force: lockout after 5 wrong passwords (429, even with the right password)', async () => {
    const c = new Client('brute'); await c.req('api/ping.php');
    const codes = [];
    for (let i = 0; i < 5; i++) {
      const r = await c.req('api/auth/login.php', { json: { login: userB.email, password: `Wrong${i}pass9` } });
      codes.push(r.status);
      assert(r.status === 401 && r.error?.code === 'INVALID_CREDENTIALS', `attempt ${i + 1}: ${r.status} ${r.error?.code}`);
    }
    const locked = await c.req('api/auth/login.php', { json: { login: userB.email, password: PASSWORD } });
    assert(locked.status === 429 && locked.error?.code === 'TOO_MANY_ATTEMPTS' && Number(locked.headers.get('retry-after')) > 0, `6th: ${locked.status} ${locked.error?.code}`);
    return `statuses ${codes.join(',')} → 429 (retry after ${locked.headers.get('retry-after')}s)`;
  });

  // ------------------------------------------------------------- summary
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${failed.length ? C.r('✖') : C.g('✔')} ${results.length - failed.length}/${results.length} passed${failed.length ? ` — failed: ${failed.map((f) => f.name).join(' | ')}` : ''}`);
  return failed.length ? 1 : 0;
}

let code = 1;
try { code = await main(); }
catch (e) { console.error(C.r('E2E crashed:'), e); code = 1; }
finally { cleanup(); }
process.exit(code);
