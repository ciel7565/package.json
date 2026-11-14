#!/usr/bin/env node
// =============================================================================
// 전통발효체험관 메타버스 — attacks on the scale work of CONTRACT §16.9, over HTTP (the independent verification)
//
//   node tests/scale-attack.mjs [--docroot <dir>] [--only token,queue] [--apache] [--apcu-so <file>] [--json <file>] [--keep] [--verbose]
//   env  TFM_SCALE_PORT_BASE=21120 (base … base+14) · TFM_SCALE_APACHE_PORT=21145 · TFM_DB_DRIVER=mysql TFM_DB_HOST/PORT/USER/PASS/NAME
//
//   Black box: private `php -S` instances over a built server copy (default dist/metaverse), each with a throw-away
//   data folder; --apache adds one Apache 2.4 + mod_php instance (.htaccess, an unprivileged account, APCu with
//   --apcu-so). Every step is an attack; it PASSES when the attack fails.
//     token    forged / altered / foreign tokens, replay after logout and a new login, a ban, a demotion and a new
//              password by the operator's command line, a direct database edit (measured), Origin / method / expiry
//     input    NaN / huge / odd bodies, unknown keys, teleport spam
//     aoi      nothing crosses a channel; positions do not cross places; hidden tabs are not sent
//     chat     no chat through sync; the send limits and the filter hold for a player on the token path
//     limits   the budgets of the old endpoints are what they were; the automatic block closes the token path too
//     flood    junk at the login address, refused requests and a class behind one address do not hurt anybody else
//     queue    one place per account, forged and foreign tickets, spent tickets, a dead browser frees its seat
//     saves    a class saving for the first time at the same moment (MariaDB: the deadlock of two first saves)
//     gzip     nothing secret next to other people's text in a compressed answer
//     sql      the token path over HTTP: statements per call, counted over 35 seconds
//     static   (--apache) the precompressed page copies carry the headers of the plain page; cache files are closed;
//              APCu lock files live in the data folder; slow login posts do not hold the login meter
//   Prints PASS / FAIL per step; exit 1 when a step fails.
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
const optv = (n) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : null; };
const VERBOSE = argv.includes('--verbose');
const APACHE = argv.includes('--apache');
const APCU_SO = optv('--apcu-so');
const ONLY = optv('--only') ? new Set(optv('--only').split(',').map((s) => s.trim())) : null;
const DOCROOT = path.resolve(optv('--docroot') || path.join(ROOT, 'dist/metaverse'));
const PORT_BASE = Number(process.env.TFM_SCALE_PORT_BASE) || 21120;
const APACHE_PORT = Number(process.env.TFM_SCALE_APACHE_PORT) || 21145;
const DRIVER = process.env.TFM_DB_DRIVER === 'mysql' ? 'mysql' : 'sqlite';
const RUN = crypto.randomBytes(3).toString('hex');
const TAG = String(parseInt(RUN, 16) % 100).padStart(2, '0');
const PASSWORD = 'Ferment2026ok';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
if (!fs.existsSync(path.join(DOCROOT, 'api/sync.php'))) { console.error(`✖ ${DOCROOT} has no api/sync.php (build a server copy first)`); process.exit(2); }

const results = [];
const measured = {};
const tty = process.stdout.isTTY;
const paint = (n, s) => (tty ? `\x1b[${n}m${s}\x1b[0m` : s);
function assert(cond, msg) { if (!cond) throw new Error(msg); }
class Skip extends Error {}
const skip = (why) => { throw new Skip(why); };
async function step(group, name, fn) {
  if (ONLY && !ONLY.has(group)) return;
  try {
    const r = await fn();
    results.push({ group, name, ok: true, detail: typeof r === 'string' ? r : '' });
    console.log(`${paint(32, 'PASS')}  [${group}] ${name}${typeof r === 'string' ? paint(2, '  — ' + r) : ''}`);
  } catch (e) {
    if (e instanceof Skip) { results.push({ group, name, ok: null, detail: e.message }); console.log(`${paint(33, 'SKIP')}  [${group}] ${name}${paint(2, '  — ' + e.message)}`); return; }
    results.push({ group, name, ok: false, detail: String(e && e.message ? e.message : e) });
    console.log(`${paint(31, 'FAIL')}  [${group}] ${name}${paint(2, '  — ' + (e && e.message ? e.message : e))}`);
    if (VERBOSE) console.error(e);
  }
}

// ------------------------------------------------------------------ HTTP
function raw(base, p, o = {}) {
  const u = new URL(p, base);
  const headers = { Accept: 'application/json', ...(o.headers || {}) };
  let body = o.body;
  if (typeof body === 'string') body = Buffer.from(body, 'utf8');
  if (body) headers['Content-Length'] = String(body.length);
  return new Promise((resolve, reject) => {
    const req = http.request({ host: u.hostname, port: u.port, path: u.pathname + u.search, method: o.method || (body ? 'POST' : 'GET'), headers, agent: false }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        let plain = buf;
        try { if (res.headers['content-encoding'] === 'gzip') plain = zlib.gunzipSync(buf); else if (res.headers['content-encoding'] === 'br') plain = zlib.brotliDecompressSync(buf); } catch { plain = Buffer.alloc(0); }
        const text = o.binary ? '' : plain.toString('utf8');
        let json = null;
        try { json = JSON.parse(text); } catch { /* not JSON */ }
        resolve({ status: res.statusCode, headers: res.headers, setCookie: res.headers['set-cookie'] || [], wire: buf.length, buf, plain, text, json, data: json && json.data, error: json && json.error });
      });
    });
    req.on('error', reject);
    req.setTimeout(o.timeout || 30000, () => req.destroy(new Error('timeout ' + u.href)));
    if (body) req.write(body);
    req.end();
  });
}
let ipSeq = 0;
const nextIp = () => `198.51.${100 + ((ipSeq >> 8) % 100)}.${1 + (ipSeq++ % 250)}`;
const UA = 'tfm-scale-attack/1.0';
/** one browser: cookie jar, CSRF token, sync token; o.xff = the address a trusted proxy reports for it */
class Client {
  constructor(srv, o = {}) { this.srv = srv; this.jar = new Map(); this.csrf = null; this.tok = null; this.te = 0; this.xff = o.xff === undefined ? nextIp() : o.xff; this.cursor = 0; this.rcur = null; this.user = null; }
  cookie() { return [...this.jar].map(([k, v]) => `${k}=${v}`).join('; '); }
  async req(p, o = {}) {
    const headers = { 'User-Agent': UA, ...(this.xff ? { 'X-Forwarded-For': this.xff } : {}), ...(o.headers || {}) };
    if (this.jar.size && !('Cookie' in headers)) headers.Cookie = this.cookie();
    let body = o.body;
    if (o.json !== undefined) { body = JSON.stringify(o.json); headers['Content-Type'] = 'application/json'; }
    const method = o.method || (body !== undefined ? 'POST' : 'GET');
    if (method !== 'GET' && this.csrf && !('X-CSRF-Token' in headers)) headers['X-CSRF-Token'] = this.csrf;
    for (const k of Object.keys(headers)) if (headers[k] === null) delete headers[k];
    const r = await raw(this.srv.base, p, { method, headers, body });
    if (!o.frozen) {
      for (const line of r.setCookie) {
        const pair = line.split(';')[0];
        const i = pair.indexOf('=');
        const name = pair.slice(0, i).trim(), value = pair.slice(i + 1).trim();
        if (/max-age=0/i.test(line) || value === '' || value === 'deleted') this.jar.delete(name); else this.jar.set(name, value);
      }
      if (r.json && typeof r.json.csrf === 'string') this.csrf = r.json.csrf;
    }
    if (VERBOSE) console.log(paint(2, `   ${this.srv.name} ${method} ${p} → ${r.status} ${r.text.slice(0, 200)}`));
    return r;
  }
  /** one api/sync.php call the way the page makes it: the token when it has one, cursors kept */
  async sync(body = {}, o = {}) {
    const headers = { ...(o.headers || {}) };
    if (this.tok && o.token !== false && !('X-Sync-Token' in headers)) headers['X-Sync-Token'] = this.tok;
    const b = { p: [0, 0, 0, 0, 0, 'idle', 'ZONE_MAIN', null, 0], c: this.cursor, ...body };
    if (this.rcur !== null && b.r === undefined) b.r = this.rcur;
    const r = await this.req('api/sync.php', { json: b, headers });
    if (r.status === 200 && r.data) {
      if (typeof r.data.t === 'string') { this.tok = r.data.t; this.te = r.data.te; }
      if (Number.isInteger(r.data.c)) this.cursor = r.data.c;
      if (r.data.rt && Number.isInteger(r.data.rt.r)) this.rcur = r.data.rt.r;
    }
    return r;
  }
  /** the three things a thief would copy out of this browser */
  triple() { return { cookie: this.cookie(), csrf: this.csrf, token: this.tok }; }
}
/** a call that presents a copied cookie + CSRF token + sync token from another machine */
function replay(srv, t, body = {}, o = {}) {
  return raw(srv.base, 'api/sync.php', { method: 'POST', headers: { 'User-Agent': o.ua || UA, 'Content-Type': 'application/json', 'X-Forwarded-For': o.xff || nextIp(), Cookie: t.cookie, 'X-CSRF-Token': t.csrf, ...(t.token ? { 'X-Sync-Token': t.token } : {}), ...(o.headers || {}) }, body: JSON.stringify({ p: [0, 0, 0, 0, 0, 'idle', 'ZONE_MAIN', null, 0], c: 0, ...body }) });
}
let userSeq = 0;
async function newUser(srv, prefix = 'Sa', o = {}) {
  const c = new Client(srv, o);
  const ping = await c.req('api/ping.php');
  assert(ping.status === 200 && c.csrf, `ping on ${srv.name} → ${ping.status}`);
  const n = ++userSeq;
  const email = `${prefix.toLowerCase()}${n}_${RUN}@example.com`;
  const nick = `${prefix}${TAG}${n}`.slice(0, 12);
  const r = await c.req('api/auth/register.php', { json: { email, nickname: nick, password: PASSWORD, password_confirm: PASSWORD, agree: true } });
  assert(r.status === 200 && r.data && r.data.user, `register on ${srv.name} → ${r.status} ${(r.error && r.error.code) || ''}`);
  c.user = r.data.user; c.email = email; c.nick = nick;
  return c;
}
/** a second browser of an existing account */
async function loginAs(srv, email, o = {}) {
  const c = new Client(srv, o);
  await c.req('api/ping.php');
  const r = await c.req('api/auth/login.php', { json: { login: email, password: o.password || PASSWORD } });
  assert(r.status === 200 && r.data && r.data.user, `login on ${srv.name} → ${r.status} ${(r.error && r.error.code) || ''}`);
  c.user = r.data.user; c.email = email;
  return c;
}
const at = (x, z, more = {}) => [x, 0, z, 0, more.speed || 0, more.anim || 'idle', more.zone || 'ZONE_MAIN', null, 0];
/** the page's save checksum (cyrb53 over JSON.stringify(state)) */
function cyrb53(str) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0, ch; i < str.length; i++) { ch = str.charCodeAt(i); h1 = Math.imul(h1 ^ ch, 2654435761); h2 = Math.imul(h2 ^ ch, 1597334677); }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0');
}
/** a state the save validator accepts for a new account (the same fixture as tests/sync-e2e.mjs) */
function freshState(user, t = Date.now()) {
  const crops = { CROP_BEAN: 120, CROP_PEPPER: 150, CROP_CABBAGE: 140, CROP_PERILLA: 130, CROP_CORN: 160, CROP_RADISH: 110, CROP_MINT: 90, CROP_LAVENDER: 150, CROP_LEMONBALM: 100 };
  const pre = [['P1', 'CROP_BEAN', 65], ['P2', 'CROP_PEPPER', 70], ['P3', 'CROP_CABBAGE', 60], ['P4', 'CROP_PERILLA', 79], ['P5', 'CROP_CORN', 50], ['P6', 'CROP_RADISH', 96], ['H1', 'CROP_MINT', 75], ['H2', 'CROP_LAVENDER', 40], ['H3', null, 0], ['H4', 'CROP_LEMONBALM', 90]];
  const plots = {};
  for (const [id, crop, g] of pre) plots[id] = crop ? { cropId: crop, growth: g, water: 60, health: 80, plantedAt: t - Math.round((g / 100) * crops[crop] * 1000), lastUpdate: t, lastWaterAt: 0, harvests: 0 } : { cropId: null, growth: 0, water: 40, health: 100, plantedAt: 0, lastUpdate: t, lastWaterAt: 0, harvests: 0 };
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
    flags: {}, tutorial: { step: 0, done: false }, activity: [{ t, type: 'login', text: 'scale-attack' }], settings: {}, blocked: [],
  };
}
const saveBody = (state, base = null) => ({ version: 1, checksum: cyrb53(JSON.stringify(state)), ...(base !== null ? { base } : {}), data: state });
const ids = (r) => (r.data && Array.isArray(r.data.pl) ? r.data.pl.map((row) => row[0]) : []);
const allIds = (r) => [...ids(r), ...((r.data && r.data.st) || [])];
const rowOf = (r, id) => (r.data && Array.isArray(r.data.pl) ? r.data.pl.find((row) => row[0] === String(id)) : null);
const stats = (r) => Object.fromEntries(String(r.headers['x-tfm-stats'] || '').split(';').filter(Boolean).map((kv) => { const [k, v] = kv.split('='); return [k, Number(v)]; }));
const b64u = (s) => Buffer.from(s).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (s) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');

// ------------------------------------------------------------------ servers
const CHILDREN = new Set();
const TMP = new Set();
const DROP = new Set();
const MY = { host: process.env.TFM_DB_HOST || '127.0.0.1', port: Number(process.env.TFM_DB_PORT || 33106), user: process.env.TFM_DB_USER || 'root', pass: process.env.TFM_DB_PASS || '', prefix: process.env.TFM_DB_NAME || 'tfm_vs_attack' };
function mysqlRoot(stmts, db = null) {
  const r = spawnSync('php', ['-r', `$p = new PDO('mysql:host=${MY.host};port=${MY.port};charset=utf8mb4' . (getenv('D') ? ';dbname=' . getenv('D') : ''), getenv('U'), getenv('P'), [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]); foreach (json_decode(getenv('Q'), true) as $q) $p->exec($q);`], { env: { ...process.env, U: MY.user, P: MY.pass, D: db || '', Q: JSON.stringify(stmts) }, encoding: 'utf8' });
  if (r.status !== 0) throw new Error('MariaDB: ' + String(r.stderr || r.stdout).slice(0, 200));
}
function rmTree(d) {
  // file by file (no shell): the throw-away folders of this run only
  if (!d || !d.includes('tfm-scale-attack-')) return;
  try { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, f.name); if (f.isDirectory() && !f.isSymbolicLink()) rmTree(p); else { try { fs.unlinkSync(p); } catch { /* ignore */ } } } fs.rmdirSync(d); } catch { /* ignore */ }
}
const KEEP = argv.includes('--keep');      // leave the throw-away data folders (their logs) in the temp folder
function cleanup() {
  for (const c of CHILDREN) { try { process.kill(c.pid, 'SIGTERM'); } catch { /* gone */ } }
  if (KEEP) { if (TMP.size) console.log('kept: ' + [...TMP].join(' ')); TMP.clear(); }
  for (const d of TMP) rmTree(d);
  if (DROP.size) { try { mysqlRoot([...DROP].map((d) => `DROP DATABASE IF EXISTS \`${d}\``)); } catch { /* ignore */ } }
}
process.on('exit', cleanup);
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => { cleanup(); process.exit(130); });
const canConnect = (port) => new Promise((res) => { const c = net.connect(port, '127.0.0.1'); c.once('connect', () => { c.destroy(); res(true); }); c.once('error', () => res(false)); });
const mkTmp = (name) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), `tfm-scale-attack-${name}-`)); TMP.add(d); return d; };
let portN = 0;
const SERVERS = new Map();
const PROXY = { TFM_TRUSTED_PROXIES: '127.0.0.1', TFM_FORCE_HTTPS: 'off' };
/** a php -S instance with its own data folder (and database); o.docroot: another copy; o.ini: extra -d settings */
async function server(name, env = {}, o = {}) {
  if (SERVERS.has(name)) return SERVERS.get(name);
  const dataDir = mkTmp(name);
  const dbEnv = {};
  let dbName = null;
  if (DRIVER === 'mysql') {
    dbName = `${MY.prefix}_${name}_${RUN}`;
    mysqlRoot([`DROP DATABASE IF EXISTS \`${dbName}\``, `CREATE DATABASE \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`]);
    DROP.add(dbName);
    Object.assign(dbEnv, { TFM_DB_DRIVER: 'mysql', TFM_DB_HOST: MY.host, TFM_DB_PORT: String(MY.port), TFM_DB_NAME: dbName, TFM_DB_USER: MY.user, TFM_DB_PASS: MY.pass });
  }
  const clean = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(?:TFM_|ANTHROPIC_)/.test(k)));
  const fullEnv = { ...clean, TFM_DATA_DIR: dataDir, TFM_TOSS_MOCK: '1', TFM_STATS_HEADER: '1', PHP_CLI_SERVER_WORKERS: String(o.workers || 6), ...PROXY, ...dbEnv, ...env };
  const docroot = o.docroot || DOCROOT;
  const ini = (o.ini || []).flatMap((kv) => ['-d', kv]);
  let port = 0, proc = null;
  for (let tries = 0; tries < 15 && !proc; tries++) {
    port = PORT_BASE + (portN++ % 15);
    if (await canConnect(port)) continue;
    // php -S writes three lines per request to stderr: a pipe nobody reads fills up after a few hundred requests and the
    // server stops answering — everything is dropped
    proc = spawn('php', [...ini, '-S', `127.0.0.1:${port}`, '-t', docroot], { env: fullEnv, stdio: 'ignore' });
  }
  assert(proc, 'no free port for ' + name);
  CHILDREN.add(proc);
  for (let i = 0; i < 80 && !(await canConnect(port)); i++) await sleep(75);
  const s = {
    name, base: `http://127.0.0.1:${port}/`, dataDir, env: fullEnv, docroot, dbName,
    cli: (args, extraEnv = {}) => { const r = spawnSync('php', [path.join(docroot, 'cli/tfm.php'), ...args], { env: { ...fullEnv, ...extraEnv }, encoding: 'utf8', timeout: 60000 }); return { status: r.status, out: String(r.stdout || '') + String(r.stderr || '') }; },
    /** a statement run on the instance's database behind the application's back (what phpMyAdmin would do) */
    sql: (stmt) => {
      if (DRIVER === 'mysql') { mysqlRoot([stmt], dbName); return; }
      const file = fs.readdirSync(dataDir).find((f) => /\.sqlite$/.test(f));
      assert(file, 'no SQLite file in ' + dataDir);
      const r = spawnSync('php', ['-r', '$p = new PDO("sqlite:" . getenv("F")); $p->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION); $p->exec("PRAGMA busy_timeout = 5000"); $p->exec(getenv("Q"));'], { env: { ...process.env, F: path.join(dataDir, file), Q: stmt }, encoding: 'utf8' });
      assert(r.status === 0, 'SQLite: ' + String(r.stderr || r.stdout).slice(0, 200));
    },
    cacheFiles: () => { let n = 0; const walk = (d) => { for (const f of fs.readdirSync(d, { withFileTypes: true })) { if (f.isDirectory()) walk(path.join(d, f.name)); else if (/^[0-9a-f]{40}\.php$/.test(f.name)) n++; } }; try { walk(path.join(dataDir, 'cache')); } catch { /* none yet */ } return n; },
  };
  SERVERS.set(name, s);
  return s;
}
/** a copy of the server tree with its own config.local.php (settings that have no environment variable) */
function copyWith(name, local) {
  const d = mkTmp('copy-' + name);
  fs.cpSync(DOCROOT, d, { recursive: true, filter: (src) => !/[\\/]data[\\/](?:cache|sessions|logs|backups)(?:[\\/]|$)/.test(src) && !/\.sqlite(?:-wal|-shm)?$/.test(src) });
  fs.writeFileSync(path.join(d, 'config/config.local.php'), "<?php\nif (!defined('TFM_BOOT')) { http_response_code(404); exit; }\nreturn " + local + ";\n");
  return d;
}

// =============================================================================
const main = await server('main');

// ---------------------------------------------------------------------------- token
let A, B, C;
await step('token', 'a forged, an altered and a foreign token never act for another account (the call is checked against the session of the caller)', async () => {
  A = await newUser(main, 'Ta'); B = await newUser(main, 'Tb'); C = await newUser(main, 'Tc');
  for (const [i, u] of [A, B, C].entries()) { const r = await u.sync({ p: at(10 + i, 10), f: 1 }); assert(r.status === 200 && r.data.t, `seat ${i} → ${r.status}`); }
  await sleep(450);
  const [, body, mac] = A.tok.split('.');
  const claims = JSON.parse(unb64u(body));
  const asB = [...claims]; asB[0] = Number(B.user.id);
  const cases = {
    'the payload names another account, the signature is the old one': `s1.${b64u(JSON.stringify(asB))}.${mac}`,
    'a random signature': `s1.${b64u(JSON.stringify(asB))}.${b64u(crypto.randomBytes(16))}`,
    'an empty signature': `s1.${b64u(JSON.stringify(asB))}.`,
    'the expiry moved to next year': `s1.${b64u(JSON.stringify([claims[0], claims[1], claims[2], claims[3] + 31536000, claims[4], claims[5], claims[6]]))}.${mac}`,
    "another player's genuine token": B.tok,
    'not a token': 's1.' + 'A'.repeat(60) + '.' + 'B'.repeat(22),
    'a very long header': 's1.' + 'A'.repeat(4000) + '.' + 'B'.repeat(22),
  };
  let x = 30;
  for (const [what, tok] of Object.entries(cases)) {
    await sleep(380);
    const r = await A.sync({ p: at(x, 30) }, { headers: { 'X-Sync-Token': tok } });
    assert(r.status === 200 && typeof r.data.t === 'string', `${what}: ${r.status} ${JSON.stringify(r.data || r.error).slice(0, 120)} (expected the session check and a new token)`);
    x += 1;
  }
  await sleep(380);
  const seen = await C.sync({ p: at(12, 10), f: 1 });
  const rb = rowOf(seen, B.user.id), ra = rowOf(seen, A.user.id);
  assert(rb && rb[1] === 11 && rb[3] === 10, `B was moved by A's forged calls: ${JSON.stringify(rb)}`);
  assert(ra && ra[1] === x - 1 && ra[3] === 30, `A's own calls did not move A: ${JSON.stringify(ra)}`);
  // B's cookie + CSRF token with A's token: checked as B (the browser of B), never as A
  await sleep(380);
  const mixed = await B.sync({ p: at(11, 10) }, { headers: { 'X-Sync-Token': A.tok } });
  assert(mixed.status === 200 && typeof mixed.data.t === 'string', `B's session with A's token → ${mixed.status}`);
  // A's token + A's CSRF token under B's cookie: the session of B does not know that CSRF token
  const cross = await raw(main.base, 'api/sync.php', { method: 'POST', headers: { 'User-Agent': UA, 'Content-Type': 'application/json', 'X-Forwarded-For': B.xff, Cookie: B.cookie(), 'X-CSRF-Token': A.csrf, 'X-Sync-Token': A.tok }, body: JSON.stringify({ p: at(0, 0) }) });
  assert(cross.status === 403 && cross.error.code === 'CSRF_INVALID', `A's token and CSRF token under B's cookie → ${cross.status} ${(cross.error && cross.error.code) || ''}`);
  return `${Object.keys(cases).length} forgeries → session check + new token; B stayed at (11, 10)`;
});

await step('token', 'a call with a token still needs a same-site POST: another Origin, Sec-Fetch-Site: cross-site and GET are refused', async () => {
  await sleep(400);
  const other = await A.sync({ p: at(1, 1) }, { headers: { Origin: 'https://evil.example' } });
  const cs = await A.sync({ p: at(1, 1) }, { headers: { 'Sec-Fetch-Site': 'cross-site' } });
  const get = await A.req('api/sync.php', { method: 'GET', headers: { 'X-Sync-Token': A.tok } });
  assert(other.status === 403 && cs.status === 403 && get.status === 405, `Origin ${other.status} · cross-site ${cs.status} · GET ${get.status}`);
  return `403 · 403 · 405`;
});

await step('token', 'a copied cookie + CSRF token + sync token is dead after logout — and stays dead when the owner signs in again', async () => {
  const V = await newUser(main, 'Tv');
  const first = await V.sync({ p: at(40, 40), f: 1 });
  assert(first.status === 200 && V.tok, `seat → ${first.status}`);
  const stolen = V.triple();
  await sleep(400);
  const live = await replay(main, stolen, { p: at(41, 40) });
  assert(live.status === 200 && live.data.t === undefined, `the copied triple did not work while the session lived (${live.status}) — nothing to test`);
  assert((await V.req('api/auth/logout.php', { json: {} })).status === 200, 'logout');
  await sleep(400);
  const dead = await replay(main, stolen, { p: at(42, 40) });
  assert(dead.status === 401 || dead.status === 403, `after logout the copied triple → ${dead.status}`);
  // the owner signs in again from the same browser and is seated again
  const V2 = await loginAs(main, V.email, { xff: V.xff });
  const again = await V2.sync({ p: at(43, 40), f: 1 });
  assert(again.status === 200 && V2.tok, `the owner's new session → ${again.status}`);
  await sleep(400);
  const back = await replay(main, stolen, { p: at(44, 44) });
  assert(back.status === 401 || back.status === 403, `the old triple works again once the owner is seated anew: ${back.status} ${JSON.stringify(back.data || back.error).slice(0, 120)}`);
  await sleep(400);
  const own = await V2.sync({ p: at(43, 41) });
  assert(own.status === 200 && own.data.t === undefined, `the owner's own token was hurt (${own.status})`);
  return `while signed in 200 · after logout ${dead.status} · after the new login ${back.status}`;
});

await step('token', 'a copied cookie + CSRF token + sync token presented by another browser (another User-Agent) is not served — the token path is bound to the browser like the session', async () => {
  const V = await newUser(main, 'Tu');
  assert((await V.sync({ p: at(70, 70), f: 1 })).status === 200 && V.tok, 'seat');
  const O = await newUser(main, 'To');
  assert((await O.sync({ p: at(71, 70), f: 1 })).status === 200, 'seat');
  await sleep(400);
  const r = await replay(main, V.triple(), { p: at(75, 75) }, { ua: 'Mozilla/5.0 (somebody with a copy)', xff: nextIp() });
  assert(!(r.status === 200), `the copy was served to another User-Agent: ${r.status} ${JSON.stringify(r.data || r.error).slice(0, 100)}`);
  await sleep(400);
  const seen = await O.sync({ p: at(71, 70), f: 1 });
  const row = rowOf(seen, V.user.id);
  assert(!row || (row[1] === 70 && row[3] === 70), `the copy moved the player: ${JSON.stringify(row)}`);
  return `another User-Agent → ${r.status}; the player was not moved`;
});

await step('token', "a ban, a demotion and a new password from the operator's command line end the token at once (measured)", async () => {
  const out = {};
  // the last admin cannot be demoted: there is another one
  const keeper = await newUser(main, 'Tz');
  assert(main.cli(['promote', keeper.email]).status === 0, 'promote the second admin');
  for (const what of ['ban', 'demote', 'reset-password']) {
    let u = await newUser(main, 'Tk');
    if (what === 'demote') {
      // an admin (the promotion signs every session of the account out: sign in again as admin)
      const p = main.cli(['promote', u.email]);
      assert(p.status === 0, 'promote: ' + p.out.slice(0, 120));
      u = await loginAs(main, u.email, { xff: u.xff });
      assert(u.user.role === 'admin', `role after the promotion: ${u.user.role}`);
    }
    const first = await u.sync({ p: at(50, 50), f: 1 });
    assert(first.status === 200, `seat → ${first.status}`);
    await sleep(400);
    const hot = await u.sync({ p: at(50, 51) });
    assert(hot.status === 200 && hot.data.t === undefined, `token call → ${hot.status}`);
    const stolen = u.triple();
    const t0 = Date.now();
    const cli = main.cli([what, u.email], what === 'reset-password' ? { TFM_NEW_PASSWORD: 'Changed2026pw' } : {});
    assert(cli.status === 0, `${what}: ${cli.out.slice(0, 160)}`);
    const cliMs = Date.now() - t0;
    await sleep(Math.max(0, 400 - cliMs));
    const after = await replay(main, stolen, { p: at(50, 52) }, { xff: u.xff });
    const ms = Date.now() - t0;
    // a ban, a role change and a new password all sign the account out everywhere: the token is gone AND the session
    // behind it no longer exists — nothing is served
    assert(after.status === 401, `after "${what}" the token call → ${after.status} ${JSON.stringify(after.data || after.error).slice(0, 100)}`);
    const me = await u.req('api/auth/me.php');
    assert(me.status === 200 && me.data.user === null, `the session survived "${what}"`);
    if (what === 'demote') {
      const again = await loginAs(main, u.email, { xff: u.xff });
      assert(again.user.role === 'user', `role after the demotion: ${again.user.role}`);
    }
    out[what] = { cliMs, firstCallAfterMs: ms };
  }
  measured.cliRevocation = out;
  return `the command took ${out.ban.cliMs} / ${out.demote.cliMs} / ${out['reset-password'].cliMs} ms (ban / demote / new password); the very next call was refused each time (401)`;
});

await step('token', 'a ban written straight into the database (phpMyAdmin): ordinary calls refuse within cache.user_ttl, the token path within sync.token_ttl (measured with token_ttl 30 s, user_ttl 15 s)', async () => {
  const copy = copyWith('ttl', "['sync' => ['token_ttl' => 30]]");
  const s = await server('ttl', {}, { docroot: copy });
  const u = await newUser(s, 'Td');
  const first = await u.sync({ p: at(1, 1), f: 1 });
  assert(first.status === 200 && first.data.te - Date.now() / 1000 <= 31, `seat → ${first.status}, token life ${first.data && Math.round(first.data.te - Date.now() / 1000)} s`);
  const me0 = await u.req('api/auth/me.php');
  assert(me0.data.user, 'me before the edit');
  const t0 = Date.now();
  s.sql(`UPDATE users SET status = 'banned' WHERE id = ${Number(u.user.id)}`);
  const stolen = u.triple();
  let checkedMs = null, hotMs = null, hotServed = 0;
  for (let i = 0; i < 60 && (checkedMs === null || hotMs === null); i++) {
    await sleep(1000);
    if (hotMs === null) { const h = await replay(s, stolen, { p: at(1, 1 + i) }, { xff: u.xff }); if (h.status === 200 && h.data.t === undefined) hotServed++; else hotMs = Date.now() - t0; }
    if (checkedMs === null) { const m = await raw(s.base, 'api/auth/me.php', { headers: { 'User-Agent': UA, 'X-Forwarded-For': u.xff, Cookie: stolen.cookie } }); if (!(m.data && m.data.user)) checkedMs = Date.now() - t0; }
  }
  measured.directDbEdit = { checkedMs, hotMs, hotServed, tokenTtl: 30, userTtl: 15 };
  assert(checkedMs !== null && checkedMs <= 17000, `an ordinary call still served the banned account after ${checkedMs === null ? '60 s' : Math.round(checkedMs / 1000) + ' s'}`);
  assert(hotMs !== null && hotMs <= 33000, `the token path still served the banned account after ${hotMs === null ? '60 s' : Math.round(hotMs / 1000) + ' s'}`);
  return `ordinary calls refused after ${(checkedMs / 1000).toFixed(1)} s (limit 15), the token path after ${(hotMs / 1000).toFixed(1)} s (limit 30; ${hotServed} calls served meanwhile)`;
});

await step('token', 'after a ban written straight into the database the operator can make it bite at once: php cli/tfm.php cache:forget <account>', async () => {
  const u = await newUser(main, 'Tf');
  assert((await u.sync({ p: at(80, 80), f: 1 })).status === 200, 'seat');
  main.sql(`UPDATE users SET status = 'banned' WHERE id = ${Number(u.user.id)}`);
  await sleep(400);
  const still = await u.sync({ p: at(80, 81) });
  assert(still.status === 200, `right after the edit the token call → ${still.status} (the web server cannot know yet)`);
  const cli = main.cli(['cache:forget', u.email]);
  assert(cli.status === 0, `cache:forget → ${cli.status} ${cli.out.slice(0, 160)}`);
  await sleep(400);
  const after = await replay(main, u.triple(), { p: at(80, 82) }, { xff: u.xff });
  const me = await u.req('api/auth/me.php');
  assert(after.status === 401 && me.data.user === null, `after cache:forget: token call ${after.status}, me ${JSON.stringify(me.data.user)}`);
  const none = main.cli(['cache:forget', 'nobody-here@example.com']);
  assert(none.status === 1, `an unknown account → exit ${none.status}`);
  return 'served until the command ran, refused right after it';
});

// The answer to a leaked key signs everybody out with ONE statement over all accounts — it does not pass the
// per-account revocation. Nothing remembered may survive it: not the account rows, not a seat, not a token.
await step('token', 'a new app key from the command line (secret:rotate --app-key) ends every sync token and every remembered account at once — and the house works again after a new login', async () => {
  const s = await server('rotate');
  const u = await newUser(s, 'Tr'), w = await newUser(s, 'Tw');
  for (const x of [u, w]) assert((await x.sync({ p: at(5, 5), f: 1 })).status === 200, 'seat');
  await sleep(400);
  const hot = await u.sync({ p: at(5, 6) });
  assert(hot.status === 200 && hot.data.t === undefined, `token call → ${hot.status}`);
  const stolen = u.triple();
  const t0 = Date.now();
  const cli = s.cli(['secret:rotate', '--app-key']);
  assert(cli.status === 0, `secret:rotate → ${cli.status} ${cli.out.slice(0, 160)}`);
  const cliMs = Date.now() - t0;
  await sleep(400);
  const after = await replay(s, stolen, { p: at(5, 7) }, { xff: u.xff });
  const ms = Date.now() - t0;
  const other = await w.sync({ p: at(5, 8) });
  const me = await u.req('api/auth/me.php');
  assert(after.status === 401, `after the new key the copied token call → ${after.status} ${JSON.stringify(after.data || after.error).slice(0, 100)}`);
  assert(other.status === 401, `after the new key the other player's token call → ${other.status}`);
  assert(me.status === 200 && me.data.user === null, 'a session survived the new key');
  const again = await loginAs(s, u.email, { xff: u.xff });
  const seat = await again.sync({ p: at(5, 9), f: 1 });
  assert(seat.status === 200 && seat.data.t, `a new login after the new key → sync ${seat.status}`);
  await sleep(400);
  const next = await again.sync({ p: at(5, 10) });
  assert(next.status === 200 && next.data.t === undefined, `the new token → ${next.status}`);
  measured.keyRotation = { cliMs, firstCallAfterMs: ms };
  return `the command took ${cliMs} ms; the next calls of both players were refused (401); a new login is seated and served`;
});

await step('token', 'expiry: a token is served until its "te" and not a second longer (token_ttl 30 s)', async () => {
  const s = SERVERS.get('ttl') || skip('the token_ttl instance did not start');
  const u = await newUser(s, 'Te');
  const first = await u.sync({ p: at(2, 2), f: 1 });
  assert(first.status === 200, `seat → ${first.status}`);
  const te = first.data.te * 1000;
  const old = u.tok;
  await sleep(Math.max(0, te - Date.now() - 2500));
  const before = await u.sync({ p: at(2, 3) });
  assert(before.status === 200 && before.data.t === undefined, `2.5 s before te the token was not served on its own (${before.status}, new token ${before.data && before.data.t !== undefined})`);
  await sleep(Math.max(0, te + 1500 - Date.now()));
  const after = await u.sync({ p: at(2, 4) }, { headers: { 'X-Sync-Token': old } });
  assert(after.status === 200 && typeof after.data.t === 'string', `1.5 s after te the old token was still served on its own (${after.status})`);
  return 'served at te − 2.5 s, session check + new token at te + 1.5 s';
});

// ---------------------------------------------------------------------------- input
await step('input', 'NaN, infinite, huge and odd bodies are refused with 4xx — never a 500, never stored, never shown to others', async () => {
  const W = await newUser(main, 'Iw'), O = await newUser(main, 'Io');
  assert((await W.sync({ p: at(60, 60), f: 1 })).status === 200 && (await O.sync({ p: at(61, 60), f: 1 })).status === 200, 'seats');
  const P = '[60,0,60,0,0,"idle","ZONE_MAIN",null,0]';
  const bodies = {
    'x = 1e999 (infinite)': '{"p":[1e999,0,60,0,0,"idle","ZONE_MAIN",null,0]}',
    'z = -1e999': '{"p":[60,0,-1e999,0,0,"idle","ZONE_MAIN",null,0]}',
    'x = 1e308': '{"p":[1e308,0,60,0,0,"idle","ZONE_MAIN",null,0]}',
    'x = "NaN"': '{"p":["NaN",0,60,0,0,"idle","ZONE_MAIN",null,0]}',
    'x = null': '{"p":[null,0,60,0,0,"idle","ZONE_MAIN",null,0]}',
    'x = true': '{"p":[true,0,60,0,0,"idle","ZONE_MAIN",null,0]}',
    'x = [1]': '{"p":[[1],0,60,0,0,"idle","ZONE_MAIN",null,0]}',
    'x = {}': '{"p":[{},0,60,0,0,"idle","ZONE_MAIN",null,0]}',
    'x = 1001': '{"p":[1001,0,60,0,0,"idle","ZONE_MAIN",null,0]}',
    'rotY = 1e7': '{"p":[60,0,60,1e7,0,"idle","ZONE_MAIN",null,0]}',
    'speed = -1': '{"p":[60,0,60,0,-1,"idle","ZONE_MAIN",null,0]}',
    'speed = 41': '{"p":[60,0,60,0,41,"idle","ZONE_MAIN",null,0]}',
    'anim unknown': '{"p":[60,0,60,0,0,"fly","ZONE_MAIN",null,0]}',
    'zone with markup': '{"p":[60,0,60,0,0,"idle","ZONE_<script>",null,0]}',
    'zone in lower case': '{"p":[60,0,60,0,0,"idle","zone_main",null,0]}',
    'emote free text': '{"p":[60,0,60,0,0,"idle","ZONE_MAIN","hello there",0]}',
    'emoteAt = 1e16': '{"p":[60,0,60,0,0,"idle","ZONE_MAIN","EMO_HI",1e16]}',
    'p with 8 values': '{"p":[60,0,60,0,0,"idle","ZONE_MAIN",null]}',
    'p with 10 values': '{"p":[60,0,60,0,0,"idle","ZONE_MAIN",null,0,0]}',
    'p as an object with names': '{"p":{"x":60,"y":0,"z":60,"rotY":0,"speed":0,"anim":"idle","zoneId":"ZONE_MAIN","emote":null,"emoteAt":0}}',
    'p missing': '{"h":0}',
    'an id of my own choice': `{"p":${P},"id":${Number(O.user.id)}}`,
    'uid': `{"p":${P},"uid":${Number(O.user.id)}}`,
    'a nickname': `{"p":${P},"nickname":"Admin"}`,
    'a channel': `{"p":${P},"ch":2}`,
    'chat text': `{"p":${P},"text":"hello"}`,
    'chat rows': `{"p":${P},"m":[[1,"1","x","hello",0,0]]}`,
    'h = 2': `{"p":${P},"h":2}`,
    'c = -1': `{"p":${P},"c":-1}`,
    'c = 1e30': `{"p":${P},"c":1e30}`,
    'c = "1 OR 1=1"': `{"p":${P},"c":"1 OR 1=1"}`,
    'r = 1.5': `{"p":${P},"r":1.5}`,
    'q with 25 ids': `{"p":${P},"q":[${Array.from({ length: 25 }, (_, i) => `"${i + 1}"`).join(',')}]}`,
    'q with a query': `{"p":${P},"q":["1 OR 1=1"]}`,
    'q = 0': `{"p":${P},"q":["0"]}`,
    'w not hex': `{"p":${P},"w":["zzzzzzzz"]}`,
    'w too long': `{"p":${P},"w":["0123456789abcdef"]}`,
    'w with 25 hashes': `{"p":${P},"w":[${Array.from({ length: 25 }, (_, i) => `"${String(i).padStart(8, '0')}"`).join(',')}]}`,
    'ap as a list': `{"p":${P},"ap":[1,2]}`,
    'ap as text': `{"p":${P},"ap":"<img src=x>"}`,
    'ns = -1': `{"p":${P},"ns":-1}`,
    'qt 201 characters': `{"p":${P},"qt":"${'q'.repeat(201)}"}`,
    'qt as a list': `{"p":${P},"qt":["q1"]}`,
    'forty levels deep': `{"p":${P},"ap":${'{"a":'.repeat(40)}1${'}'.repeat(40)}}`,
    'a list at the root': `[${P}]`,
    'a number at the root': '7',
    'not JSON': 'p=1&x=2',
    'empty': '',
    'five kilobytes': `{"p":${P},"ap":{"hair":"${'a'.repeat(5000)}"}}`,
  };
  const wrong = [];
  for (const [what, body] of Object.entries(bodies)) {
    // without the token: the checked path (no pacing), the same validation
    const r = await W.req('api/sync.php', { body, headers: { 'Content-Type': 'application/json' } });
    if (!(r.status >= 400 && r.status < 500)) wrong.push(`${what} → ${r.status} ${r.text.slice(0, 80)}`);
  }
  assert(wrong.length === 0, wrong.join(' | '));
  // and with the token (the path without a session)
  const hotWrong = [];
  for (const what of ['x = 1e999 (infinite)', 'an id of my own choice', 'chat text', 'p with 8 values']) {
    await sleep(380);
    const r = await W.req('api/sync.php', { body: bodies[what], headers: { 'Content-Type': 'application/json', 'X-Sync-Token': W.tok } });
    if (!(r.status >= 400 && r.status < 500) || r.status === 429) hotWrong.push(`${what} → ${r.status}`);
  }
  assert(hotWrong.length === 0, 'with a token: ' + hotWrong.join(' | '));
  // values beyond the world are clamped, never passed on as they came
  await sleep(380);
  const far = await W.sync({ p: [999, 999, -999, 123456, 40, 'run', 'ZONE_MAIN', null, 0] });
  assert(far.status === 200, `a far position → ${far.status}`);
  await sleep(380);
  const seen = await O.sync({ p: at(399, -399), f: 1 });
  const row = rowOf(seen, W.user.id);
  assert(row && row[1] === 400 && row[3] === -400 && row[2] <= 200 && Math.abs(row[4]) <= 6.3 && row.slice(1, 6).every((v) => typeof v === 'number' && Number.isFinite(v)), `what the neighbour is sent: ${JSON.stringify(row)}`);
  return `${Object.keys(bodies).length} bodies → 4xx; (999, 999, −999) is passed on as (${row[1]}, ${row[2]}, ${row[3]})`;
});

await step('input', 'teleport spam: jumping across the map every call is paced like any other call, breaks nothing and shows no player twice', async () => {
  const J = await newUser(main, 'Ij'), O = await newUser(main, 'Ik');
  assert((await J.sync({ p: at(-300, -300), f: 1 })).status === 200 && (await O.sync({ p: at(300, 300), f: 1 })).status === 200, 'seats');
  const corners = [[390, 390], [-390, -390], [390, -390], [-390, 390]];
  let served = 0, paced = 0, bad = [];
  for (let i = 0; i < 24; i++) {
    const [x, z] = corners[i % 4];
    const r = await J.sync({ p: at(x, z, { speed: 40, anim: 'run' }) });
    if (r.status === 200) served++; else if (r.status === 429 && Number(r.headers['retry-after']) >= 1) paced++; else bad.push(r.status);
    await sleep(i % 2 ? 120 : 380);     // every second call comes too soon
  }
  assert(bad.length === 0, `unexpected answers: ${bad.join(',')}`);
  assert(paced >= 8 && served >= 8, `served ${served}, paced ${paced} of 24 (every second call came 120 ms after the one before)`);
  await sleep(400);
  const seen = await O.sync({ p: at(300, 300), f: 1 });
  const mine = (seen.data.pl || []).filter((row) => row[0] === String(J.user.id));
  assert(mine.length <= 1, `the jumper is listed ${mine.length} times`);
  return `${served} served, ${paced} × 429 + Retry-After`;
});

// ---------------------------------------------------------------------------- aoi
await step('aoi', 'nothing crosses a channel: players, names, looks and chat of another channel cannot be asked for, whatever the body says', async () => {
  const s = await server('chan', { TFM_CHANNEL_SIZE: '2', TFM_CHANNEL_HARD: '2' });
  const u = [];
  for (let i = 0; i < 4; i++) { const c = await newUser(s, 'Ac'); const r = await c.sync({ p: at(5, 5), f: 1, ap: { hair: 'bun', topColor: `#00000${i}` } }); assert(r.status === 200, `seat ${i} → ${r.status}`); c.ch = r.data.ch; u.push(c); }
  const mineCh = u[0].ch;
  const same = u.filter((c) => c.ch === mineCh), other = u.filter((c) => c.ch !== mineCh);
  assert(same.length === 2 && other.length === 2, `channels: ${u.map((c) => c.ch).join('')}`);
  const say = await other[0].req('api/chat/send.php', { json: { text: `only for my channel ${RUN}`, channel: 'all' } });
  assert(say.status === 200, `chat in the other channel → ${say.status}`);
  await sleep(450);
  const r = await u[0].sync({ p: at(5, 5), f: 1, c: 0, q: other.map((c) => String(c.user.id)), w: ['00000000'] });
  assert(r.status === 200, `sync → ${r.status}`);
  const leaked = allIds(r).filter((id) => other.some((c) => String(c.user.id) === id));
  assert(leaked.length === 0, `players of another channel were sent: ${leaked.join(',')}`);
  assert(!r.data.who || !other.some((c) => r.data.who[String(c.user.id)]), `names of another channel were sent: ${JSON.stringify(r.data.who)}`);
  assert(!(r.data.m || []).some((m) => String(m[3]).includes(RUN)), 'a chat line of another channel was sent');
  // the token names the channel; a token altered to the other channel is not a token
  const [, body, mac] = u[0].tok.split('.');
  const claims = JSON.parse(unb64u(body)); claims[1] = other[0].ch;
  await sleep(400);
  const hop = await u[0].sync({ p: at(5, 5), f: 1 }, { headers: { 'X-Sync-Token': `s1.${b64u(JSON.stringify(claims))}.${mac}` } });
  assert(hop.status === 200 && hop.data.ch === mineCh && allIds(hop).every((id) => !other.some((c) => String(c.user.id) === id)), `a token altered to channel ${other[0].ch} → channel ${hop.data && hop.data.ch}`);
  return `channels ${u.map((c) => c.ch).join('')}: no player, name or line of the other channel`;
});

await step('aoi', 'positions do not cross places, a hidden tab is not sent, and a name asked with "q" comes without a position', async () => {
  const V = await newUser(main, 'Av'), R = await newUser(main, 'Ar'), H = await newUser(main, 'Ah');
  assert((await V.sync({ p: at(200, 200), f: 1 })).status === 200, 'seat V');
  assert((await R.sync({ p: at(200, 200, { zone: 'ZONE_PL_DAECHEONG' }), f: 1 })).status === 200, 'seat R');
  assert((await H.sync({ p: at(201, 200), h: 1, f: 1 })).status === 200, 'seat H');
  await sleep(450);
  const r = await V.sync({ p: at(200, 200), f: 1, q: [String(R.user.id), String(H.user.id)] });
  const got = allIds(r);
  assert(!got.includes(String(R.user.id)) && !got.includes(String(H.user.id)), `rows sent: ${got.join(',')}`);
  const text = JSON.stringify(r.data.who || {});
  assert(r.data.who && r.data.who[String(R.user.id)] && r.data.who[String(R.user.id)].length === 2, `who: ${text}`);
  return 'a room at the same coordinates and a hidden tab: no row; "who" = [name, look id] only';
});

// ---------------------------------------------------------------------------- chat
await step('chat', 'the send limits and the filter hold for a player on the token path: two lines a second, a repeated line and a phone number', async () => {
  const S = await newUser(main, 'Cs'), L = await newUser(main, 'Cl');
  assert((await S.sync({ p: at(-100, -100), f: 1 })).status === 200 && (await L.sync({ p: at(-101, -100), f: 1 })).status === 200, 'seats');
  const l1 = await S.req('api/chat/send.php', { json: { text: `내 번호는 010-1234-5678 이야 ${RUN}`, channel: 'all' } });
  const l2 = await S.req('api/chat/send.php', { json: { text: `바로 또 ${RUN}`, channel: 'all' } });
  assert(l1.status === 200 && l1.data.piiMasked === true && !/1234/.test(l1.data.message.text), `line 1 → ${l1.status} ${JSON.stringify(l1.data).slice(0, 120)}`);
  assert(l2.status === 429, `a second line in the same second → ${l2.status}`);
  await sleep(1100);
  const dup = await S.req('api/chat/send.php', { json: { text: `내 번호는 010-1234-5678 이야 ${RUN}`, channel: 'all' } });
  assert(dup.status === 409, `the same line again → ${dup.status}`);
  const noToken = await raw(main.base, 'api/chat/send.php', { method: 'POST', headers: { 'User-Agent': UA, 'Content-Type': 'application/json', 'X-Forwarded-For': S.xff, Cookie: S.cookie(), 'X-Sync-Token': S.tok }, body: JSON.stringify({ text: 'no csrf', channel: 'all' }) });
  assert(noToken.status === 403, `a chat line with the sync token instead of the CSRF token → ${noToken.status}`);
  await sleep(450);
  const got = await L.sync({ p: at(-101, -100), c: 0 });
  const lines = (got.data.m || []).filter((m) => String(m[3]).includes(RUN));
  assert(lines.length === 1 && !/1234|5678/.test(lines[0][3]) && lines[0][3].includes('🔒'), `what the neighbour received: ${JSON.stringify(lines)}`);
  return `one line of three arrived, masked: ${lines[0][3]}`;
});

// ---------------------------------------------------------------------------- limits
await step('limits', 'the budgets of the old polling endpoints are what they were before the cache counted them: presence 90, chat list 90, ping 60 a minute; sync without a token 30', async () => {
  const s = await server('limits');
  const u = await newUser(s, 'Lp');
  const until429 = async (max, fn) => { for (let i = 1; i <= max; i++) { const r = await fn(i); if (r.status === 429) return { n: i, retry: Number(r.headers['retry-after']) }; if (r.status >= 500) return { n: -i, retry: 0 }; } return { n: 0, retry: 0 }; };
  // the windows are whole minutes of the clock: start early in one so a budget is not split over two
  while (new Date().getSeconds() > 25) await sleep(1000);
  const presence = await until429(100, (i) => u.req('api/presence/update.php', { json: { x: i % 5, y: 0, z: 1, rotY: 0, anim: 'idle', speed: 0, zoneId: 'ZONE_MAIN' } }));
  const list = await until429(100, () => u.req('api/chat/list.php?after=0'));
  const issue = await until429(40, (i) => u.sync({ p: at(i % 5, 2) }, { token: false }));
  const g = new Client(s);
  const ping = await until429(70, () => g.req('api/ping.php'));
  // one account in two browsers shares its buckets
  const u2 = await newUser(s, 'Lq');
  const u2b = await loginAs(s, u2.email);
  let n = 0, hit = 0;
  for (let i = 0; i < 100 && !hit; i++) { const r = await (i % 2 ? u2 : u2b).req('api/chat/list.php?after=0'); n++; if (r.status === 429) hit = n; }
  measured.budgets = { presence: presence.n, chatList: list.n, syncIssue: issue.n, ping: ping.n, sharedByTwoBrowsers: hit };
  assert(presence.n === 91 && list.n === 91 && issue.n === 31 && ping.n === 61 && hit === 91, `first 429 at call: presence ${presence.n} (91) · chat list ${list.n} (91) · sync without a token ${issue.n} (31) · ping ${ping.n} (61) · two browsers of one account ${hit} (91)`);
  assert(presence.retry >= 1 && list.retry >= 1 && issue.retry >= 1 && ping.retry >= 1, 'a 429 without Retry-After');
  return 'first 429 + Retry-After at call 91 · 91 · 31 · 61; two browsers of one account share the 90';
});

await step('limits', 'the automatic block still fires — and it closes the token path of the blocked address too', async () => {
  const s = await server('block', { TFM_FORCE_HTTPS: 'off' });
  const bad = await newUser(s, 'Lb', { xff: '203.0.113.200' });
  const good = await newUser(s, 'Lg');
  assert((await bad.sync({ p: at(1, 1), f: 1 })).status === 200 && (await good.sync({ p: at(2, 1), f: 1 })).status === 200, 'seats');
  let blockedAt = 0;
  for (let i = 1; i <= 40 && !blockedAt; i++) {
    const r = await bad.req(`api/ranking/top.php?id=${encodeURIComponent("1' UNION SELECT password_hash FROM users--")}&n=${i}`);
    if (r.status === 403 && r.error && r.error.code === 'IP_BLOCKED') blockedAt = i;
  }
  assert(blockedAt >= 20 && blockedAt <= 30, `blocked at request ${blockedAt} (threshold 25)`);
  await sleep(400);
  const hot = await bad.sync({ p: at(1, 2) });
  assert(hot.status === 403 && hot.error.code === 'IP_BLOCKED', `the blocked address on the token path → ${hot.status} ${(hot.error && hot.error.code) || ''}`);
  const other = await good.sync({ p: at(2, 2) });
  assert(other.status === 200, `another address was hurt: ${other.status}`);
  return `blocked at probe ${blockedAt}; the token call of that address → 403 IP_BLOCKED`;
});

// ---------------------------------------------------------------------------- flood
await step('flood', 'junk posted to the login address (no session) does not keep anybody out: a real login in the middle of 60 posts a second succeeds at once', async () => {
  const s = await server('login', { TFM_LOGIN_PER_SEC: '5', TFM_LOGIN_CONCURRENT: '4' });
  const u = await newUser(s, 'Fl');
  await u.req('api/auth/logout.php', { json: {} });
  const fresh = new Client(s);
  await fresh.req('api/ping.php');
  let stop = false, junk = 0, junkBusy = 0;
  const flood = (async () => {
    while (!stop) {
      const rs = await Promise.all(Array.from({ length: 12 }, () => raw(s.base, 'api/auth/login.php', { method: 'POST', headers: { 'User-Agent': UA, 'Content-Type': 'application/json', 'X-Forwarded-For': '203.0.113.66' }, body: '{"login":"x","password":"y"}' }).catch(() => ({ status: 0 }))));
      junk += rs.length;
      junkBusy += rs.filter((r) => r.status === 503).length;
      await sleep(150);
    }
  })();
  await sleep(1200);
  const tries = [];
  for (let i = 0; i < 3; i++) {
    const c = i === 0 ? fresh : new Client(s);
    if (i > 0) await c.req('api/ping.php');
    const r = await c.req('api/auth/login.php', { json: { login: u.email, password: PASSWORD } });
    tries.push(r.status === 200 ? 200 : `${r.status} ${(r.error && r.error.code) || ''}`);
    await sleep(700);
  }
  stop = true;
  await flood;
  measured.loginFlood = { junk, tries };
  assert(tries.every((t) => t === 200), `real logins during ${junk} junk posts: ${tries.join(' · ')}`);
  return `${junk} junk posts (${junkBusy} of them answered 503); 3 real logins: ${tries.join(', ')}`;
});

// A burst of logins — a class that presses "입장" together, or a list of stolen passwords tried at once — must be
// answered "wrong", "wait" or "a moment please". A server error tells the page nothing and looks like a broken site.
// The meter is opened wide here, so that the password checks (and what they write) really run side by side.
await step('flood', 'sixteen logins at the same moment (unknown accounts, wrong passwords, right passwords), three rounds: every answer is 200 / 401 / 429 / 503 — never a server error', async () => {
  const s = await server('logins', { TFM_LOGIN_PER_SEC: '200', TFM_LOGIN_CONCURRENT: '16' }, { workers: 16 });
  const known = [];
  for (let i = 0; i < 4; i++) { const k = await newUser(s, 'Lg'); await k.req('api/auth/logout.php', { json: {} }); known.push(k); }
  const codes = {};
  for (let round = 0; round < 3; round++) {
    const clients = [];
    for (let i = 0; i < 16; i++) { const c = new Client(s, { xff: nextIp() }); const p = await c.req('api/ping.php'); assert(p.status === 200 && c.csrf, `ping → ${p.status}`); clients.push(c); }
    const rs = await Promise.all(clients.map((c, i) => {
      const k = known[i % 4];
      const body = i < 8 ? { login: `nobody${round}x${i}_${RUN}@example.com`, password: 'Wrong2026pw' } : i < 12 ? { login: k.email, password: 'Wrong2026pw' } : { login: k.email, password: PASSWORD };
      return c.req('api/auth/login.php', { json: body });
    }));
    for (const r of rs) { const k = `${r.status}${r.error && r.error.code ? ' ' + r.error.code : ''}`; codes[k] = (codes[k] || 0) + 1; }
    await sleep(1100);
  }
  measured.loginBurst = codes;
  const bad = Object.keys(codes).filter((k) => !/^(?:200$|401 |429 |503 LOGIN_BUSY)/.test(k));
  assert(bad.length === 0, `48 logins in three bursts: ${JSON.stringify(codes)}`);
  assert((codes['200'] || 0) >= 1, `no right password got in: ${JSON.stringify(codes)}`);
  return `48 logins in three bursts: ${JSON.stringify(codes)}`;
});

await step('flood', 'requests that are refused are not load: 600 calls of one account and one address answered 429 / 401 shed nobody and slow nobody down; a real crowd is still shed', async () =>{
  const s = await server('busy', { TFM_SHED_RPS: '30', TFM_TARGET_RPS: '20' });
  const u = await newUser(s, 'Fb'), other = await newUser(s, 'Fo');
  assert((await u.sync({ p: at(0, 0), f: 1 })).status === 200 && (await other.sync({ p: at(1, 0), f: 1 })).status === 200, 'seats');
  await sleep(1200);
  const codes = {};
  for (let burst = 0; burst < 5; burst++) {
    const rs = await Promise.all([
      ...Array.from({ length: 60 }, () => u.sync({ p: at(0, 0) }).catch(() => ({ status: 0 }))),                                                              // one account, no pacing: 429
      ...Array.from({ length: 60 }, () => raw(s.base, 'api/player/save.php', { method: 'POST', headers: { 'User-Agent': UA, 'X-Forwarded-For': '203.0.113.90', 'Content-Type': 'application/json' }, body: '{}' }).catch(() => ({ status: 0 }))),   // no session: 401
    ]);
    for (const r of rs) codes[r.status] = (codes[r.status] || 0) + 1;
  }
  const visitor = await new Client(s).req('api/ping.php');
  const reg = await new Client(s).req('api/ranking/top.php');
  await sleep(400);
  const hot = await other.sync({ p: at(1, 1) });
  assert(visitor.status === 200 && reg.status === 200, `after 600 refused requests a new visitor got ${visitor.status} / ${reg.status} (${JSON.stringify(codes)})`);
  assert(hot.status === 200 && hot.data.n <= 4000, `another player's next call was stretched to ${hot.data && hot.data.n} ms`);
  // a real crowd: requests that are served, from many addresses
  let shed = null, served = 0;
  for (let burst = 0; burst < 8 && !shed; burst++) {
    const rs = await Promise.all(Array.from({ length: 60 }, () => raw(s.base, 'api/time.php', { headers: { 'X-Forwarded-For': nextIp() } })));
    shed = rs.find((r) => r.status === 503) || null;
    served += rs.filter((r) => r.status === 200).length;
  }
  assert(shed && shed.error.code === 'BUSY' && Number(shed.headers['retry-after']) >= 2, `a crowd of ${served} served requests was never shed`);
  return `refused: ${JSON.stringify(codes)} → a newcomer 200, a neighbour's next call ${hot.data.n} ms; a served crowd → 503 BUSY`;
});

await step('flood', 'a class behind one address can wait together: 12 waiting accounts ask every second and a half (144 questions from one address inside a minute) and none is refused', async () => {
  const s = await server('class', { TFM_MAX_ONLINE: '2' });
  for (let i = 0; i < 2; i++) assert((await (await newUser(s, 'Fs')).sync({ p: at(i, 0), f: 1 })).status === 200, 'seat');
  const school = '203.0.113.33';
  const kids = [];
  for (let i = 0; i < 12; i++) {
    const k = await newUser(s, 'Fk', { xff: nextIp() });      // registered at home …
    k.xff = school;                                            // … and now all behind the school's address
    const r = await k.sync({ p: at(0, 0), f: 1 });
    assert(r.status === 503 && r.data.queue && r.data.queue.pos === i + 1, `kid ${i} → ${r.status} ${JSON.stringify(r.data).slice(0, 100)}`);
    k.ticket = r.data.queue.t;
    k.answered = Date.now();      // the page waits "next" ms after this answer before it asks api/queue.php
    kids.push(k);
  }
  const codes = {};
  for (let round = 0; round < 12; round++) {
    for (const k of kids) {
      // every browser asks about once a second (1.4 s after its last ANSWER: the same ticket asked again within 0.9 s
      // is refused on purpose, and on a loaded machine two answers can come closer together than the questions went out)
      await sleep(Math.max(0, 1400 - (Date.now() - (k.answered || 0))));
      const r = await raw(s.base, `api/queue.php?t=${encodeURIComponent(k.ticket)}`, { headers: { 'X-Forwarded-For': school } });
      k.answered = Date.now();
      const what = r.status === 429 ? `429 ${/천천히/.test((r.error && r.error.message) || '') ? '(asked within 0.9 s)' : '(over the limit)'}` : String(r.status);
      codes[what] = (codes[what] || 0) + 1;
    }
  }
  measured.classQueue = codes;
  assert(Object.keys(codes).join() === '200', `answers to 144 questions from one address: ${JSON.stringify(codes)}`);
  // what is not a ticket is still limited per address (120 a minute)
  let first429 = 0;
  for (let i = 1; i <= 125 && !first429; i++) { const r = await raw(s.base, 'api/queue.php?t=not-a-ticket', { headers: { 'X-Forwarded-For': '203.0.113.34' } }); if (r.status === 429) first429 = i; }
  assert(first429 === 121, `garbage from one address: first 429 at request ${first429} (121)`);
  return `144 × 200; garbage from one address stops at request 121`;
});

// ---------------------------------------------------------------------------- queue
await step('queue', 'one place per account: a reload keeps the place, six calls are one ticket, a forged or foreign ticket is nobody\'s turn, a used ticket is spent', async () => {
  const s = await server('full', { TFM_MAX_ONLINE: '2' });
  const seated = [];
  for (let i = 0; i < 2; i++) { const u = await newUser(s, 'Qs'); assert((await u.sync({ p: at(i, 0), f: 1 })).status === 200, 'seat'); seated.push(u); }
  const X = await newUser(s, 'Qx'), Y = await newUser(s, 'Qy'), Z = await newUser(s, 'Qz');
  const tickets = new Set();
  let pos = [];
  for (let i = 0; i < 6; i++) { const r = await X.sync({ p: at(0, 0) }); assert(r.status === 503 && r.data.queue, `X → ${r.status}`); tickets.add(r.data.queue.t); pos.push(r.data.queue.pos); await sleep(120); }
  const ry = await Y.sync({ p: at(0, 0) });
  assert(tickets.size === 1 && pos.every((p) => p === 1) && ry.status === 503 && ry.data.queue.pos === 2, `six calls of one account: ${tickets.size} tickets, places ${pos.join(',')}; the visitor behind: place ${ry.data.queue && ry.data.queue.pos}`);
  const tx = [...tickets][0], ty = ry.data.queue.t;
  // forged and altered tickets
  const [, body, mac] = tx.split('.');
  const p = JSON.parse(unb64u(body));
  const front = `q1.${b64u(JSON.stringify([1, p[1], p[2], JSON.parse(unb64u(ty.split('.')[1]))[3], p[4]]))}.${mac}`;
  for (const [what, t] of Object.entries({ 'Y\'s mark on X\'s signature': front, 'a random signature': `q1.${body}.${b64u(crypto.randomBytes(16))}`, 'garbage': 'q1.abc.def' })) {
    const r = await raw(s.base, `api/queue.php?t=${encodeURIComponent(t)}`, { headers: { 'X-Forwarded-For': nextIp() } });
    assert(r.status === 400 && r.error.code === 'QUEUE_TICKET', `${what} → ${r.status}`);
  }
  // Y presents X's ticket: it is not Y's turn, Y keeps its own place
  const foreign = await Y.sync({ p: at(0, 0), qt: tx });
  assert(foreign.status === 503 && foreign.data.queue.t === ty && foreign.data.queue.pos === 2, `Y with X's ticket → ${foreign.status} ${JSON.stringify(foreign.data).slice(0, 120)}`);
  // a seat becomes free: X's turn
  assert((await seated[0].req('api/auth/logout.php', { json: {} })).status === 200, 'logout');
  await sleep(1000);
  const go = await raw(s.base, `api/queue.php?t=${encodeURIComponent(tx)}`, { headers: { 'X-Forwarded-For': X.xff } });
  assert(go.status === 200 && go.data.go === true, `X's turn → ${JSON.stringify(go.data || go.error)}`);
  const thief = await Z.sync({ p: at(0, 0), qt: tx });
  assert(thief.status === 503, `Z entered with X's ticket (${thief.status})`);
  const enter = await X.sync({ p: at(3, 3), qt: tx, f: 1 });
  assert(enter.status === 200 && enter.data.t, `X could not enter: ${enter.status}`);
  // the used ticket is spent
  const spent = await raw(s.base, `api/queue.php?t=${encodeURIComponent(tx)}`, { headers: { 'X-Forwarded-For': X.xff } });
  assert(spent.status === 400, `asking with the used ticket → ${spent.status} ${JSON.stringify(spent.data)}`);
  assert((await X.req('api/auth/logout.php', { json: {} })).status === 200, 'X leaves');
  const X2 = await loginAs(s, X.email, { xff: X.xff });
  await sleep(1000);
  const back = await X2.sync({ p: at(0, 0), qt: tx });
  // the seat X left goes to Y (first in line); X with its old ticket is behind Y and Z
  assert(back.status === 503 && back.data.queue.t !== tx && back.data.queue.pos >= 2, `X came back with the used ticket: ${back.status} ${JSON.stringify(back.data).slice(0, 140)}`);
  const yGo = await raw(s.base, `api/queue.php?t=${encodeURIComponent(ty)}`, { headers: { 'X-Forwarded-For': Y.xff } });
  assert(yGo.status === 200 && yGo.data.go === true, `the seat X left did not go to the first in line: ${JSON.stringify(yGo.data || yGo.error)}`);
  return 'six calls = one ticket (place 1); forged / foreign tickets refused; the used ticket: 400, then a new place behind the line';
});

await step('queue', 'never evicted, but a dead browser does not keep its seat for ever: a seated player who stays keeps the seat; one who stops calling frees it after seat_ttl (30 s here)', async () => {
  const s = await server('dead', { TFM_MAX_ONLINE: '2', TFM_SEAT_TTL: '30' });
  const stay = await newUser(s, 'Qa'), dead = await newUser(s, 'Qd'), wait = await newUser(s, 'Qw');
  assert((await stay.sync({ p: at(0, 0), f: 1 })).status === 200 && (await dead.sync({ p: at(1, 0), f: 1 })).status === 200, 'seats');
  const q = await wait.sync({ p: at(0, 0) });
  assert(q.status === 503 && q.data.queue.pos === 1, `the third → ${q.status}`);
  const t0 = Date.now();
  let goAt = 0, evicted = 0;
  for (let i = 0; i < 26 && !goAt; i++) {
    await sleep(3000);
    const r = await stay.sync({ p: at(0, i) });
    if (r.status !== 200) evicted++;
    const p = await raw(s.base, `api/queue.php?t=${encodeURIComponent(q.data.queue.t)}`, { headers: { 'X-Forwarded-For': wait.xff } });
    if (p.status === 200 && p.data.go) goAt = Date.now() - t0;
  }
  measured.deadSeatMs = goAt;
  assert(evicted === 0, `the player who stayed got ${evicted} refusals`);
  assert(goAt >= 27000 && goAt <= 75000, `the seat of the dead browser was handed on after ${Math.round(goAt / 1000)} s (seat_ttl 30)`);
  const enter = await wait.sync({ p: at(2, 2), qt: q.data.queue.t, f: 1 });
  assert(enter.status === 200, `the waiting visitor could not enter: ${enter.status}`);
  return `freed after ${(goAt / 1000).toFixed(0)} s; the player who stayed was served every time`;
});

// ---------------------------------------------------------------------------- saves
await step('saves', 'a class saves for the first time at the same moment: twelve new accounts, four rounds of simultaneous saves — every save is stored, none ends as a server error', async () => {
  const s = await server('saves', {}, { workers: 12 });
  const us = [];
  for (let i = 0; i < 12; i++) us.push(await newUser(s, 'Sv'));
  const codes = {};
  const revs = us.map(() => 0);
  for (let round = 0; round < 4; round++) {
    const rs = await Promise.all(us.map((u, i) => { const st = freshState(u.user); st.stats.playTime = round; return u.req('api/player/save.php', { json: saveBody(st, round === 0 ? null : revs[i]) }); }));
    for (const [i, r] of rs.entries()) { const k = r.status === 200 ? '200' : `${r.status} ${(r.error && r.error.code) || ''}`; codes[k] = (codes[k] || 0) + 1; if (r.status === 200) revs[i] = r.data.revision; }
    if (round === 0) {
      // more first saves in the next rounds: new accounts again
      for (let i = 0; i < 12; i++) { us[i] = await newUser(s, 'Sv'); revs[i] = 0; }
      const again = await Promise.all(us.map((u) => u.req('api/player/save.php', { json: saveBody(freshState(u.user)) })));
      for (const [i, r] of again.entries()) { const k = r.status === 200 ? '200' : `${r.status} ${(r.error && r.error.code) || ''}`; codes[k] = (codes[k] || 0) + 1; if (r.status === 200) revs[i] = r.data.revision; }
    }
    await sleep(300);
  }
  measured.simultaneousSaves = codes;
  assert(Object.keys(codes).every((k) => k === '200'), `simultaneous saves: ${JSON.stringify(codes)}`);
  return `${Object.values(codes).reduce((a, b) => a + b, 0)} saves, all stored`;
});

// The save endpoint lets go of the session lock before it works (§16.9), so two saves of ONE session — two tabs, a
// page-hide beacon next to the minute save — run side by side for the first time. They must still be judged one after
// the other: built on the same revision, one is stored and the others are told they are stale.
await step('saves', 'one account saves eight times at the same moment on the same revision: one copy is stored, seven are told they are stale — no server error, no skipped or doubled revision', async () => {
  const s = await server('saves', {}, { workers: 12 });
  const u = await newUser(s, 'Sw');
  const first = await u.req('api/player/save.php', { json: saveBody(freshState(u.user)) });
  assert(first.status === 200 && first.data.revision === 1, `first save → ${first.status} ${JSON.stringify(first.data || first.error).slice(0, 120)}`);
  const seen = {};
  let rev = 1;
  for (let round = 0; round < 3; round++) {
    // the eight copies differ in where the player stands, so the stored copy shows which round it belongs to
    const rs = await Promise.all(Array.from({ length: 8 }, (_, i) => { const st = freshState(u.user); st.player.x = round * 10 + i; return u.req('api/player/save.php', { json: saveBody(st, rev) }); }));
    const ok = rs.filter((r) => r.status === 200);
    for (const r of rs) { const k = r.status === 200 ? '200' : `${r.status} ${(r.error && r.error.code) || ''}`; seen[k] = (seen[k] || 0) + 1; }
    assert(ok.length === 1, `round ${round}: ${ok.length} of 8 saves on revision ${rev} were stored (${JSON.stringify(seen)})`);
    assert(rs.every((r) => r.status === 200 || (r.status === 409 && r.error && r.error.code === 'STALE_SAVE')), `round ${round}: ${JSON.stringify(seen)}`);
    assert(ok[0].data.revision === rev + 1, `round ${round}: revision ${rev} → ${ok[0].data.revision}`);
    rev = ok[0].data.revision;
    const got = await u.req('api/player/get.php');
    const kept = got.status === 200 && got.data ? got.data.save : null;
    assert(kept && kept.revision === rev, `stored revision ${kept && kept.revision}, expected ${rev}`);
    const x = kept.data && kept.data.player ? Number(kept.data.player.x) : NaN;
    assert(x >= round * 10 && x <= round * 10 + 7, `round ${round}: the stored copy is not one of this round's eight (player.x ${x})`);
    await sleep(200);
  }
  measured.sameAccountSaves = seen;
  return `3 rounds × 8 saves: ${JSON.stringify(seen)}; revision 1 → ${rev}`;
});

// ---------------------------------------------------------------------------- gzip
await step('gzip', 'a compressed answer holds no CSRF token and no session id next to other people\'s text; the sync token in it is new in every such answer and useless without the cookie', async () => {
  const s = await server('gzip');
  const W = await newUser(s, 'Gw'), T = await newUser(s, 'Gt');
  assert((await W.sync({ p: at(0, 0), f: 1 })).status === 200 && (await T.sync({ p: at(1, 0), f: 1 })).status === 200, 'seats');
  for (let i = 0; i < 14; i++) { const r = await T.req('api/chat/send.php', { json: { text: `줄 ${i} ${'가나다라마바사 '.repeat(6)}${RUN}`, channel: 'all' } }); assert(r.status === 200, `line ${i} → ${r.status}`); await sleep(1050); }
  const gz = { 'Accept-Encoding': 'gzip' };
  const sid = [...W.jar.values()][0];
  const seenTokens = new Set();
  const checked = [];
  for (const [what, call] of Object.entries({
    'sync (issue)': () => W.sync({ p: at(0, 0), c: 0, f: 1 }, { token: false, headers: gz }),
    'sync (issue) again': () => W.sync({ p: at(0, 0), c: 0, f: 1 }, { token: false, headers: gz }),
    'sync (token)': async () => { await sleep(400); return W.sync({ p: at(0, 1), c: 0 }, { headers: gz }); },
    'chat/list': () => W.req('api/chat/list.php?after=0', { headers: gz }),
    'ranking': () => W.req('api/ranking/top.php', { headers: gz }),
    'player/get': () => W.req('api/player/get.php', { headers: gz }),
  })) {
    const r = await call();
    assert(r.status === 200, `${what} → ${r.status}`);
    const packed = r.headers['content-encoding'] === 'gzip';
    if (!packed) { checked.push(`${what}: plain`); continue; }
    assert(r.json.csrf === undefined && !r.text.includes(W.csrf), `${what}: the CSRF token is inside a compressed answer`);
    assert(!r.text.includes(sid), `${what}: the session id is inside a compressed answer`);
    if (r.data.t) { assert(!seenTokens.has(r.data.t), `${what}: the same sync token was compressed twice`); seenTokens.add(r.data.t); }
    checked.push(`${what}: gzip ${r.wire} B${r.data.t ? ' (+ a new token)' : ''}`);
  }
  assert(checked.filter((c) => c.includes('gzip')).length >= 3, `too few compressed answers to mean anything: ${checked.join(' · ')}`);
  // the token alone (what a size-guessing attack could at best learn) with another session: not served
  const alone = await replay(s, { cookie: T.cookie(), csrf: T.csrf, token: W.tok }, { p: at(9, 9) }, { xff: T.xff });
  assert(alone.status === 200 && typeof alone.data.t === 'string', `W's token under T's session → ${alone.status}`);
  await sleep(400);
  const where = await T.sync({ p: at(1, 0), f: 1 });
  const row = rowOf(where, W.user.id);
  assert(row && row[1] === 0, `W was moved by its token under another session: ${JSON.stringify(row)}`);
  return checked.join(' · ');
});

// ---------------------------------------------------------------------------- sql
await step('sql', 'the token path over HTTP for 35 seconds (three players, chat, names, looks, a hidden line): statements per call', async () => {
  const s = await server('sql');
  const p = [];
  for (let i = 0; i < 3; i++) { const u = await newUser(s, 'Sq'); assert((await u.sync({ p: at(i, 0), f: 1, ap: { hair: 'bun', topColor: `#11223${i}` } })).status === 200, 'seat'); p.push(u); }
  const t0 = Date.now();
  let calls = 0, withSql = 0, sql = 0, connects = 0, issued = 0, round = 0;
  const bySecond = [];
  while (Date.now() - t0 < 35000) {
    round++;
    if (round % 8 === 3) { const r = await p[0].req('api/chat/send.php', { json: { text: `sql ${round} ${RUN}`, channel: 'all' } }); assert(r.status === 200 || r.status === 429, `chat → ${r.status}`); }
    for (const [i, u] of p.entries()) {
      const r = await u.sync({ p: at(i + (round % 3), round % 7, { speed: 2, anim: 'walk' }), ...(round % 5 === 0 ? { q: p.map((x) => String(x.user.id)) } : {}) });
      if (r.status !== 200) continue;
      if (r.data.t !== undefined) { issued++; continue; }      // a call that had to pass the session check is not the token path
      calls++;
      const st = stats(r);
      if (st.sql > 0 || st.db > 0) { withSql++; sql += st.sql; connects += st.db; bySecond.push(`${((Date.now() - t0) / 1000).toFixed(0)}s:${st.sql}`); }
    }
    await sleep(420);
  }
  measured.hotPathSql = { seconds: 35, calls, callsWithSql: withSql, statements: sql, connects, perCall: calls ? +(sql / calls).toFixed(4) : null, when: bySecond };
  assert(calls >= 120, `only ${calls} token calls in 35 s`);
  // the one thing the token path may ask the database: the list of blocked addresses, once per cache.block_ttl (15 s)
  // for the whole server — at most 3 times in 35 s, one or two statements each (the list, and the schema check that a
  // first database connection of a request makes)
  assert(withSql <= 4 && sql <= 8, `${withSql} of ${calls} token calls ran SQL (${sql} statements): ${bySecond.join(' ')}`);
  return `${calls} token calls: ${calls - withSql} with 0 SQL, ${withSql} with SQL (${sql} statements in all, at ${bySecond.join(' ') || '—'}) = ${(sql / calls).toFixed(3)} per call`;
});

// ---------------------------------------------------------------------------- static (Apache)
const APACHE_MODULES = '/usr/lib/apache2/modules';
let apacheInst = null;
async function apache() {
  if (!APACHE) skip('needs --apache');
  if (apacheInst) return apacheInst.unavailable ? skip(apacheInst.unavailable) : apacheInst;
  const fail = (why) => { apacheInst = { unavailable: why }; skip(why); };
  if (spawnSync('apache2', ['-v'], { encoding: 'utf8' }).status !== 0) fail('apache2 is not installed');
  const phpSo = fs.existsSync(APACHE_MODULES) ? fs.readdirSync(APACHE_MODULES).find((f) => /^libphp[\d.]*\.so$/.test(f)) : null;
  if (!phpSo) fail(`no libphp*.so in ${APACHE_MODULES}`);
  if (await canConnect(APACHE_PORT)) fail(`port ${APACHE_PORT} is in use`);
  const tmp = mkTmp('apache');
  fs.chmodSync(tmp, 0o755);
  const htdocs = path.join(tmp, 'htdocs');
  fs.cpSync(DOCROOT, htdocs, { recursive: true });
  for (const d of ['run', 'logs', 'ini']) fs.mkdirSync(path.join(tmp, d));
  let ini = '';
  try { ini = fs.readFileSync('/etc/php/8.3/apache2/php.ini', 'utf8'); } catch { ini = ''; }
  ini += '\n; tests/scale-attack.mjs\nopcache.enable=1\nmemory_limit=128M\n';
  if (APCU_SO) ini += `extension=${APCU_SO}\napc.enabled=1\napc.shm_size=64M\n`;
  fs.writeFileSync(path.join(tmp, 'ini/php.ini'), ini);
  let user = '';
  if (process.getuid && process.getuid() === 0) {
    user = ['www-data', 'apache', 'daemon', 'nobody'].find((u) => spawnSync('id', ['-u', u]).status === 0) || '';
    if (!user) fail('running as root and no unprivileged account exists');
    spawnSync('chown', ['-R', `${user}:`, path.join(htdocs, 'data'), path.join(htdocs, 'uploads'), path.join(tmp, 'run'), path.join(tmp, 'logs')]);
    // every folder above the copy must let that account pass
    for (let d = tmp; d !== path.dirname(d); d = path.dirname(d)) { try { const m = fs.statSync(d).mode; if ((m & 0o005) !== 0o005) fs.chmodSync(d, (m & 0o7777) | 0o005); } catch { break; } }
  }
  const env = { TFM_TOSS_MOCK: '1', TFM_STATS_HEADER: '1', TFM_TRUSTED_PROXIES: '127.0.0.1', TFM_FORCE_HTTPS: 'off', TFM_LOGIN_PER_SEC: '5', TFM_LOGIN_CONCURRENT: '3', ...(APCU_SO ? { TFM_CACHE_DRIVER: 'apcu' } : {}) };
  let dbName = null;
  if (DRIVER === 'mysql') {
    dbName = `${MY.prefix}_apache_${RUN}`;
    mysqlRoot([`DROP DATABASE IF EXISTS \`${dbName}\``, `CREATE DATABASE \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`]);
    DROP.add(dbName);
    Object.assign(env, { TFM_DB_DRIVER: 'mysql', TFM_DB_HOST: MY.host, TFM_DB_PORT: String(MY.port), TFM_DB_NAME: dbName, TFM_DB_USER: MY.user, TFM_DB_PASS: MY.pass });
  }
  const mod = (id, file) => `LoadModule ${id}_module ${APACHE_MODULES}/${file}`;
  const conf = [
    `ServerRoot "${tmp}"`, `PidFile "${tmp}/run/httpd.pid"`, `DefaultRuntimeDir "${tmp}/run"`, `Mutex file:${tmp}/run default`, `Listen 127.0.0.1:${APACHE_PORT}`, 'ServerName 127.0.0.1',
    mod('mpm_prefork', 'mod_mpm_prefork.so'), mod('authz_core', 'mod_authz_core.so'), mod('authz_host', 'mod_authz_host.so'), mod('dir', 'mod_dir.so'), mod('mime', 'mod_mime.so'),
    mod('env', 'mod_env.so'), mod('setenvif', 'mod_setenvif.so'), mod('headers', 'mod_headers.so'), mod('rewrite', 'mod_rewrite.so'), mod('alias', 'mod_alias.so'), mod('php', phpSo),
    user ? `User ${user}\nGroup ${user}` : '', `ErrorLog "${tmp}/logs/error.log"`, 'LogLevel warn', 'TypesConfig /etc/mime.types', `PHPIniDir "${tmp}/ini"`,
    'StartServers 6', 'MinSpareServers 6', 'MaxSpareServers 16', 'MaxRequestWorkers 16', 'KeepAlive Off', 'Timeout 30',
    `DocumentRoot "${htdocs}"`, `<Directory "${htdocs}">\n  AllowOverride All\n  Require all granted\n  Options FollowSymLinks\n</Directory>`, `Alias /metaverse "${htdocs}"`,
    '<FilesMatch "\\.php$">\n  SetHandler application/x-httpd-php\n</FilesMatch>',
    ...Object.entries(env).map(([k, v]) => `SetEnv ${k} "${v}"`),
  ].filter(Boolean).join('\n') + '\n';
  fs.writeFileSync(path.join(tmp, 'httpd.conf'), conf);
  const proc = spawn('apache2', ['-f', path.join(tmp, 'httpd.conf'), '-DFOREGROUND'], { stdio: ['ignore', 'pipe', 'pipe'], env: { PATH: process.env.PATH, LANG: 'C' }, detached: true });
  CHILDREN.add(proc);
  let out = '';
  proc.stdout.on('data', (d) => { out = (out + d).slice(-2000); });
  proc.stderr.on('data', (d) => { out = (out + d).slice(-2000); });
  let up = false;
  for (let i = 0; i < 80 && !up && proc.exitCode === null; i++) { up = await canConnect(APACHE_PORT); if (!up) await sleep(75); }
  if (!up) fail(`apache2 did not start: ${out.replace(/\s+/g, ' ').slice(0, 200)}`);
  apacheInst = { name: 'apache', base: `http://127.0.0.1:${APACHE_PORT}/`, docroot: htdocs, dataDir: path.join(htdocs, 'data'), tmp, user, env, log: () => { try { return fs.readFileSync(path.join(tmp, 'logs/error.log'), 'utf8'); } catch { return out; } } };
  return apacheInst;
}

await step('static', 'the precompressed copies of the page carry exactly the headers of the plain page (security headers, type, caching) — plus Content-Encoding and Vary; 304, HEAD, q=0 and a sub-folder work', async () => {
  const a = await apache();
  if (!fs.existsSync(path.join(a.docroot, 'index.gz.html')) || !fs.existsSync(path.join(a.docroot, 'index.br.html'))) skip('this server copy has no precompressed page (built with --no-precompress)');
  const get = (p, ae, more = {}) => raw(a.base, p, { binary: true, headers: { Accept: 'text/html', ...(ae === null ? {} : { 'Accept-Encoding': ae }), ...more.headers }, method: more.method });
  const page = fs.readFileSync(path.join(a.docroot, 'index.html'));
  const sha = (b) => crypto.createHash('sha1').update(b).digest('hex');
  const want = sha(page);
  const drop = new Set(['content-encoding', 'content-length', 'last-modified', 'date', 'vary', 'accept-ranges', 'connection', 'keep-alive', 'etag']);
  const shape = (r) => JSON.stringify(Object.entries(r.headers).filter(([k]) => !drop.has(k)).sort());
  const out = [];
  for (const base of ['', 'index.html', 'metaverse/', 'metaverse/index.html']) {
    const plain = await get(base, 'identity'), gz = await get(base, 'gzip, deflate'), br = await get(base, 'gzip, deflate, br'), none = await get(base, null);
    assert(plain.status === 200 && gz.status === 200 && br.status === 200 && none.status === 200, `/${base}: ${plain.status} ${gz.status} ${br.status} ${none.status}`);
    assert(!plain.headers['content-encoding'] && !none.headers['content-encoding'] && gz.headers['content-encoding'] === 'gzip' && br.headers['content-encoding'] === 'br', `/${base}: encodings ${plain.headers['content-encoding']} · ${gz.headers['content-encoding']} · ${br.headers['content-encoding']}`);
    assert(sha(plain.plain) === want && sha(gz.plain) === want && sha(br.plain) === want, `/${base}: a copy does not unpack to index.html`);
    assert(shape(gz) === shape(plain) && shape(br) === shape(plain), `/${base}: headers differ\n plain ${shape(plain)}\n gzip  ${shape(gz)}\n br    ${shape(br)}`);
    for (const [n, r] of [['plain', plain], ['gzip', gz], ['br', br]]) {
      assert(/accept-encoding/i.test(String(r.headers.vary || '')), `/${base} ${n}: no Vary: Accept-Encoding`);
      for (const h of ['x-content-type-options', 'x-frame-options', 'referrer-policy', 'permissions-policy', 'cross-origin-opener-policy', 'content-security-policy', 'cache-control']) assert(r.headers[h], `/${base} ${n}: no ${h}`);
      assert(/^text\/html/.test(r.headers['content-type']), `/${base} ${n}: ${r.headers['content-type']}`);
    }
    out.push(`/${base || ''} ${plain.wire} → gzip ${gz.wire} → br ${br.wire}`);
  }
  const gz = await get('', 'gzip');
  const notMod = await get('', 'gzip', { headers: { 'If-Modified-Since': gz.headers['last-modified'] } });
  assert(notMod.status === 304 && notMod.wire === 0, `If-Modified-Since → ${notMod.status}`);
  const head = await get('', 'gzip', { method: 'HEAD' });
  assert(head.status === 200 && head.headers['content-encoding'] === 'gzip' && head.wire === 0, `HEAD → ${head.status} ${head.headers['content-encoding']}`);
  for (const ae of ['gzip;q=0', 'br;q=0, gzip;q=0.0', 'identity', 'deflate']) { const r = await get('', ae); assert(r.status === 200 && !r.headers['content-encoding'] && sha(r.plain) === want, `Accept-Encoding "${ae}" → ${r.headers['content-encoding']}`); }
  const q = await get('index.html?x=1', 'gzip');
  assert(q.status === 200 && sha(q.plain) === want, `with a query string → ${q.status}`);
  // an error page never claims an encoding
  const missing = await get('index.gz.htm', 'gzip');
  assert(missing.status === 404 && !missing.headers['content-encoding'], `a missing file → ${missing.status} ${missing.headers['content-encoding']}`);
  return out.join(' · ');
});

await step('static', 'nothing of the cache can be fetched: records, lock files, the bust file and temp files under data/cache answer 403 / 404 and show no content', async () => {
  const a = await apache();
  const u = await newUser(a, 'Sc');
  assert((await u.sync({ p: at(1, 1), f: 1, ap: { hair: 'bun' } })).status === 200, 'seat');
  const cli = spawnSync('php', [path.join(a.docroot, 'cli/tfm.php'), 'ban', 'nobody@example.com'], { env: { ...process.env, ...a.env }, encoding: 'utf8' });   // any security change: writes the bust file
  void cli;
  const found = [];
  const walk = (d, rel) => { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const r = rel + '/' + f.name; if (f.isDirectory()) walk(path.join(d, f.name), r); else found.push(r); } };
  try { walk(path.join(a.dataDir, 'cache'), 'data/cache'); } catch { /* none */ }
  for (const extra of ['data/cache/bust', 'data/cache/_l/00.lock', 'data/cache/00/x.123-456.tmp.php']) {
    if (found.includes(extra)) continue;
    const f = path.join(a.docroot, extra);
    const madeDir = !fs.existsSync(path.dirname(f));
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, 'TFMSEC-MARK-cache');
    if (a.user) spawnSync('chown', [`${a.user}:`, f, ...(madeDir ? [path.dirname(f)] : [])]);      // planted by the suite: as the web server would have made it
    found.push(extra);
  }
  assert(found.length >= 4, `only ${found.length} files under data/cache`);
  const open = [];
  for (const rel of found.slice(0, 60)) {
    const r = await raw(a.base, rel, { headers: { Accept: '*/*' } });
    if (![403, 404].includes(r.status) || /TFC1|TFMSEC-MARK|"m":|sy:/.test(r.text)) open.push(`${rel} → ${r.status}`);
  }
  assert(open.length === 0, open.join(' | '));
  const list = await raw(a.base, 'data/cache/', { headers: { Accept: '*/*' } });
  assert([403, 404].includes(list.status), `the folder itself → ${list.status}`);
  return `${Math.min(found.length, 60)} files under data/cache → 403 / 404`;
});

await step('static', 'APCu under an unprivileged web server: its channel updates queue behind lock files in data/cache/_l (the web side reports "locks: file"), nothing is written at the root of the file system', async () => {
  const a = await apache();
  if (!APCU_SO) skip('needs --apcu-so <file>');
  const rootBefore = fs.existsSync('/_l') ? fs.readdirSync('/_l').length : 0;
  const us = [];
  for (let i = 0; i < 4; i++) { const u = await newUser(a, 'Sl'); assert((await u.sync({ p: at(i, 1), f: 1 })).status === 200, 'seat'); us.push(u); }
  for (let round = 0; round < 3; round++) { await sleep(400); for (const u of us) await u.sync({ p: at(round, 2) }); }
  const ping = await new Client(a).req('api/ping.php');
  const gate = (ping.data.stats && ping.data.stats.gate) || {};
  assert(gate.cache === 'apcu', `the web server's cache driver is ${gate.cache}`);
  assert(gate.locks === 'file', `the web server's channel updates use "${gate.locks}" locks (file = queued behind a lock file; flag = polling the shared memory)`);
  const dir = path.join(a.dataDir, 'cache', '_l');
  const mine = (fs.existsSync(dir) ? fs.readdirSync(dir) : []).filter((f) => /^[0-9a-f]{2}\.lock$/.test(f) && (!a.user || spawnSync('stat', ['-c', '%U', path.join(dir, f)], { encoding: 'utf8' }).stdout.trim() === a.user));
  const rootAfter = fs.existsSync('/_l') ? fs.readdirSync('/_l').length : 0;
  assert(mine.length >= 2, `lock files of the web server's account in data/cache/_l: ${mine.length}`);
  assert(rootAfter === rootBefore, `${rootAfter - rootBefore} new files in /_l`);
  return `web side: locks = file; ${mine.length} lock files of ${a.user || 'the web server'} in data/cache/_l; /_l unchanged`;
});

await step('static', "the operator's command line as root and the web server share the cache: after cleanup, capacity, a block and a ban every cache file still belongs to the web server's account and the token path still runs without SQL", async () => {
  const a = await apache();
  if (!a.user) skip('the suite does not run as root: the command line and the web server are the same account');
  const u = await newUser(a, 'So'), v = await newUser(a, 'Sv');
  assert((await u.sync({ p: at(7, 7), f: 1 })).status === 200 && (await v.sync({ p: at(8, 7), f: 1 })).status === 200, 'seats');
  const cli = (...args) => { const r = spawnSync('php', [path.join(a.docroot, 'cli/tfm.php'), ...args], { env: { ...process.env, ...a.env }, encoding: 'utf8', timeout: 60000 }); return { status: r.status, out: String(r.stdout || '') + String(r.stderr || '') }; };
  for (const args of [['capacity'], ['cache:info'], ['cleanup'], ['ip:block', '203.0.113.250', '60', 'scale-attack'], ['ip:unblock', '203.0.113.250'], ['ban', v.email], ['unban', v.email], ['cache:purge']]) {
    const r = cli(...args);
    assert(r.status === 0, `cli ${args.join(' ')} → ${r.status} ${r.out.slice(0, 160)}`);
  }
  // 300 keys that no request has touched yet: the command line is the first to lock their stripes
  const probe = spawnSync('php', ['-r', 'define("TFM_CLI", true); require $argv[1] . "/lib/bootstrap.php"; for ($i = 0; $i < 300; $i++) { Tfm\\Cache::set("probe:" . $i, $i, 60); Tfm\\Cache::mutate("probe:m" . $i, function ($o) { return 1; }, 60); } echo Tfm\\Cache::driver();', a.docroot], { env: { ...process.env, ...a.env }, encoding: 'utf8' });
  assert(probe.status === 0, 'cache probe: ' + String(probe.stderr || probe.stdout).slice(0, 200));
  const foreign = [];
  const walk = (d) => { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, f.name); const o = spawnSync('stat', ['-c', '%U', p], { encoding: 'utf8' }).stdout.trim(); if (o !== a.user) foreign.push(`${path.relative(a.dataDir, p)} (${o})`); if (f.isDirectory()) walk(p); } };
  walk(path.join(a.dataDir, 'cache'));
  assert(foreign.length === 0, `${foreign.length} cache files the web server cannot write: ${foreign.slice(0, 6).join(', ')}`);
  // and the web side still works on them: the token path, without SQL, for players old and new
  const w = await newUser(a, 'Sw');
  assert((await w.sync({ p: at(9, 7), f: 1 })).status === 200, 'a new player after the command line ran');
  let bad = [];
  for (let round = 0; round < 4; round++) {
    await sleep(420);
    for (const p of [u, w]) { const r = await p.sync({ p: at(7 + round, 8) }); const st = stats(r); if (r.status !== 200 || r.data.t !== undefined || st.sql > 1) bad.push(`${r.status}${r.data && r.data.t !== undefined ? ' (new token)' : ''} sql=${st.sql}`); }
  }
  assert(bad.length <= 1, `token calls after the command line ran: ${bad.join(' · ')}`);
  return `8 commands + 600 cache writes as root: every file under data/cache belongs to ${a.user}; token calls still 200 without a new token`;
});

await step('static', 'slow login posts do not hold the login meter: three connections that send half a body and stall, and a real login gets through', async () => {
  const a = await apache();
  const u = await newUser(a, 'Sp');
  await u.req('api/auth/logout.php', { json: {} });
  // three visitors with a session and CSRF token of their own start a login post and never finish the body
  const socks = [];
  for (let i = 0; i < 3; i++) {
    const c = new Client(a);
    await c.req('api/ping.php');
    const body = JSON.stringify({ login: `slow${i}@example.com`, password: 'Slow2026pw' });
    const sock = net.connect(APACHE_PORT, '127.0.0.1');
    await new Promise((res) => sock.once('connect', res));
    sock.write(`POST /api/auth/login.php HTTP/1.1\r\nHost: 127.0.0.1:${APACHE_PORT}\r\nUser-Agent: ${UA}\r\nX-Forwarded-For: ${c.xff}\r\nCookie: ${c.cookie()}\r\nX-CSRF-Token: ${c.csrf}\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(body)}\r\n\r\n${body.slice(0, 10)}`);
    sock.on('error', () => {});
    socks.push(sock);
  }
  await sleep(1500);
  const tries = [];
  for (let i = 0; i < 3; i++) {
    const c = new Client(a);
    await c.req('api/ping.php');
    const r = await c.req('api/auth/login.php', { json: { login: u.email, password: PASSWORD } });
    tries.push(r.status === 200 ? 200 : `${r.status} ${(r.error && r.error.code) || ''}`);
    await sleep(600);
  }
  for (const s of socks) s.destroy();
  assert(tries.every((t) => t === 200), `real logins while three posts stalled (login_concurrent 3): ${tries.join(' · ')}`);
  return `3 stalled posts; real logins: ${tries.join(', ')}`;
});

// =============================================================================
const failed = results.filter((x) => x.ok === false).length;
const skipped = results.filter((x) => x.ok === null).length;
const passed = results.filter((x) => x.ok === true).length;
console.log(`\n${failed ? paint(31, '✖') : paint(32, '✔')} scale-attack: ${passed}/${passed + failed} passed${skipped ? `, ${skipped} skipped` : ''} (${DRIVER}${APACHE ? ' + Apache' : ''}${APCU_SO ? ' + APCu' : ''})`);
if (Object.keys(measured).length) console.log(paint(2, 'measured: ' + JSON.stringify(measured)));
const jsonOut = optv('--json');
if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify({ run: RUN, driver: DRIVER, apache: APACHE, apcu: !!APCU_SO, docroot: DOCROOT, passed, failed, skipped, measured, results }, null, 2));
cleanup();
process.exit(failed ? 1 : 0);
