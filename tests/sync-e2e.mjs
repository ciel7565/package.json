#!/usr/bin/env node
// =============================================================================
// 전통발효체험관 메타버스 — api/sync.php + the waiting room, end to end (CONTRACT §16.9)
//
//   node tests/sync-e2e.mjs [--docroot <dir>] [--only token,queue] [--verbose]
//   env  TFM_SYNC_PORT_BASE=18840 (the suite uses base … base+9) · TFM_DB_DRIVER=mysql TFM_DB_HOST/PORT/USER/PASS/NAME
//
//   Black box: the suite starts its own `php -S` instances over the built server copy (default dist/metaverse), each
//   with a throw-away TFM_DATA_DIR, and talks to them the way browsers do — two and ten simulated clients:
//     features    ping / me advertise features.sync
//     token       the first call issues a token; calls with it are served without session, CSRF look-up or SQL
//     aoi         area of interest by place and distance; compact rows; "st"; names and looks on request
//     channels    ten clients in channels of four: 4 / 4 / 2, stable over refreshes, nobody sees another channel
//     chat        a line sent through api/chat/send.php (ChatFilter, database) reaches the sender's channel by sync
//     moderation  a banned account is taken back and disappears
//     next        the server sets the pace: idle / moving in company / hidden
//     interop     an old page (presence/update.php + chat/list.php) and a new page (sync.php) see each other
//     queue       a full house: 503 QUEUE + Retry-After + ticket, api/queue.php, admission in order, nobody seated is evicted
//     shed        overload: 503 BUSY + Retry-After for newcomers, never for saves and seated players; login metering
//     session     read endpoints do not rewrite the session file; a "remember me" cookie keeps its expiry
//     gzip        answers of 1 KB and more are compressed on request, then without the CSRF token
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
const ONLY = optv('--only') ? new Set(optv('--only').split(',').map((s) => s.trim())) : null;
const DOCROOT = path.resolve(optv('--docroot') || path.join(ROOT, 'dist/metaverse'));
const PORT_BASE = Number(process.env.TFM_SYNC_PORT_BASE) || 18840;
const DRIVER = process.env.TFM_DB_DRIVER === 'mysql' ? 'mysql' : 'sqlite';
const RUN = crypto.randomBytes(3).toString('hex');
const TAG = String(parseInt(RUN, 16) % 100).padStart(2, '0');
const PASSWORD = 'Ferment2026ok';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
if (!fs.existsSync(path.join(DOCROOT, 'api/sync.php'))) { console.error(`✖ ${DOCROOT} has no api/sync.php (build a server copy first)`); process.exit(2); }

const results = [];
const tty = process.stdout.isTTY;
const paint = (n, s) => (tty ? `\x1b[${n}m${s}\x1b[0m` : s);
function assert(cond, msg) { if (!cond) throw new Error(msg); }
async function step(group, name, fn) {
  if (ONLY && !ONLY.has(group)) return;
  try {
    const r = await fn();
    results.push(true);
    console.log(`${paint(32, 'PASS')}  [${group}] ${name}${typeof r === 'string' ? paint(2, '  — ' + r) : ''}`);
  } catch (e) {
    results.push(false);
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
        let text = '';
        try { text = (res.headers['content-encoding'] === 'gzip' ? zlib.gunzipSync(buf) : buf).toString('utf8'); } catch { text = ''; }
        let json = null;
        try { json = JSON.parse(text); } catch { /* not JSON */ }
        resolve({ status: res.statusCode, headers: res.headers, setCookie: res.headers['set-cookie'] || [], wire: buf.length, text, json, data: json && json.data, error: json && json.error });
      });
    });
    req.on('error', reject);
    req.setTimeout(30000, () => req.destroy(new Error('timeout ' + u.href)));
    if (body) req.write(body);
    req.end();
  });
}
let ipSeq = 0;
/** one browser: cookie jar, CSRF token, sync token; o.xff = the address a trusted proxy reports for it */
class Client {
  constructor(srv, o = {}) { this.srv = srv; this.jar = new Map(); this.csrf = null; this.tok = null; this.te = 0; this.xff = o.xff || null; this.cursor = 0; this.rcur = null; this.user = null; }
  cookie() { return [...this.jar].map(([k, v]) => `${k}=${v}`).join('; '); }
  async req(p, o = {}) {
    const headers = { 'User-Agent': 'tfm-sync-e2e/1.0', ...(this.xff ? { 'X-Forwarded-For': this.xff } : {}), ...(o.headers || {}) };
    if (this.jar.size) headers.Cookie = this.cookie();
    let body = o.body;
    if (o.json !== undefined) { body = JSON.stringify(o.json); headers['Content-Type'] = 'application/json'; }
    const method = o.method || (body !== undefined ? 'POST' : 'GET');
    if (method !== 'GET' && this.csrf && !('X-CSRF-Token' in headers)) headers['X-CSRF-Token'] = this.csrf;
    const r = await raw(this.srv.base, p, { method, headers, body });
    for (const line of r.setCookie) {
      const pair = line.split(';')[0];
      const i = pair.indexOf('=');
      const name = pair.slice(0, i).trim(), value = pair.slice(i + 1).trim();
      if (/max-age=0/i.test(line) || value === '' || value === 'deleted') this.jar.delete(name); else this.jar.set(name, value);
    }
    if (r.json && typeof r.json.csrf === 'string') this.csrf = r.json.csrf;
    if (VERBOSE) console.log(paint(2, `   ${this.srv.name} ${method} ${p} → ${r.status} ${r.text.slice(0, 200)}`));
    return r;
  }
  /** one api/sync.php call the way the page makes it: the token when it has one, cursors kept */
  async sync(body = {}, o = {}) {
    const headers = { ...(o.headers || {}) };
    if (this.tok && o.token !== false) headers['X-Sync-Token'] = this.tok;
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
}
async function newUser(srv, prefix = 'Sy', o = {}) {
  const c = new Client(srv, o);
  const ping = await c.req('api/ping.php');
  assert(ping.status === 200 && c.csrf, `ping on ${srv.name} → ${ping.status}`);
  const email = `${prefix.toLowerCase()}${++ipSeq}_${RUN}@example.com`;
  const nick = `${prefix}${TAG}${ipSeq}`.slice(0, 12);
  const r = await c.req('api/auth/register.php', { json: { email, nickname: nick, password: PASSWORD, password_confirm: PASSWORD, agree: true, ...(o.extra || {}) } });
  assert(r.status === 200 && r.data && r.data.user, `register on ${srv.name} → ${r.status} ${(r.error && r.error.code) || ''}`);
  c.user = r.data.user; c.email = email; c.nick = nick;
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
/** a state the save validator accepts for a new account (the same fixture as tests/security-e2e.mjs) */
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
    flags: {}, tutorial: { step: 0, done: false }, activity: [{ t, type: 'login', text: 'sync-e2e' }], settings: {}, blocked: [],
  };
}
const saveBody = (state, base = null) => ({ version: 1, checksum: cyrb53(JSON.stringify(state)), ...(base !== null ? { base } : {}), data: state });
const ids = (r) => (r.data && Array.isArray(r.data.pl) ? r.data.pl.map((row) => row[0]) : []);
const allIds = (r) => [...ids(r), ...((r.data && r.data.st) || [])];

// ------------------------------------------------------------------ servers
const CHILDREN = new Set();
const TMP = new Set();
const DROP = new Set();
const MY = { host: process.env.TFM_DB_HOST || '127.0.0.1', port: Number(process.env.TFM_DB_PORT || 33106), user: process.env.TFM_DB_USER || 'root', pass: process.env.TFM_DB_PASS || '', prefix: process.env.TFM_DB_NAME || 'tfm_sync' };
function mysqlRoot(stmts) {
  const r = spawnSync('php', ['-r', `$p = new PDO('mysql:host=${MY.host};port=${MY.port};charset=utf8mb4', getenv('U'), getenv('P'), [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]); foreach (json_decode(getenv('Q'), true) as $q) $p->exec($q);`], { env: { ...process.env, U: MY.user, P: MY.pass, Q: JSON.stringify(stmts) }, encoding: 'utf8' });
  if (r.status !== 0) throw new Error('MariaDB: ' + String(r.stderr || r.stdout).slice(0, 200));
}
function cleanup() {
  for (const c of CHILDREN) { try { process.kill(c.pid, 'SIGTERM'); } catch { /* gone */ } }
  for (const d of TMP) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ } }
  if (DROP.size) { try { mysqlRoot([...DROP].map((d) => `DROP DATABASE IF EXISTS \`${d}\``)); } catch { /* ignore */ } }
}
process.on('exit', cleanup);
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => { cleanup(); process.exit(130); });
const canConnect = (port) => new Promise((res) => { const c = net.connect(port, '127.0.0.1'); c.once('connect', () => { c.destroy(); res(true); }); c.once('error', () => res(false)); });
let portN = 0;
const SERVERS = new Map();
/** env for the instance; every instance gets its own data folder (and database) */
async function server(name, env = {}) {
  if (SERVERS.has(name)) return SERVERS.get(name);
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), `tfm-sync-${name}-`));
  TMP.add(dataDir);
  const dbEnv = {};
  if (DRIVER === 'mysql') {
    const db = `${MY.prefix}_${name}_${RUN}`;
    mysqlRoot([`DROP DATABASE IF EXISTS \`${db}\``, `CREATE DATABASE \`${db}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`]);
    DROP.add(db);
    Object.assign(dbEnv, { TFM_DB_DRIVER: 'mysql', TFM_DB_HOST: MY.host, TFM_DB_PORT: String(MY.port), TFM_DB_NAME: db, TFM_DB_USER: MY.user, TFM_DB_PASS: MY.pass });
  }
  const clean = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(?:TFM_|ANTHROPIC_)/.test(k)));
  const fullEnv = { ...clean, TFM_DATA_DIR: dataDir, TFM_TOSS_MOCK: '1', TFM_STATS_HEADER: '1', PHP_CLI_SERVER_WORKERS: '4', ...dbEnv, ...env };
  let port = 0, proc = null;
  for (let tries = 0; tries < 10 && !proc; tries++) {
    port = PORT_BASE + (portN++ % 10);
    if (await canConnect(port)) continue;
    proc = spawn('php', ['-S', `127.0.0.1:${port}`, '-t', DOCROOT], { env: fullEnv, stdio: ['ignore', 'ignore', 'pipe'] });
  }
  assert(proc, 'no free port for ' + name);
  CHILDREN.add(proc);
  for (let i = 0; i < 80 && !(await canConnect(port)); i++) await sleep(75);
  const s = { name, base: `http://127.0.0.1:${port}/`, dataDir, env: fullEnv, cli: (...a) => { const r = spawnSync('php', [path.join(DOCROOT, 'cli/tfm.php'), ...a], { env: fullEnv, encoding: 'utf8', timeout: 60000 }); return { status: r.status, out: String(r.stdout || '') + String(r.stderr || '') }; } };
  SERVERS.set(name, s);
  return s;
}
const stats = (r) => Object.fromEntries(String(r.headers['x-tfm-stats'] || '').split(';').filter(Boolean).map((kv) => { const [k, v] = kv.split('='); return [k, Number(v)]; }));
const PROXY = { TFM_TRUSTED_PROXIES: '127.0.0.1', TFM_FORCE_HTTPS: 'off' };
const nextIp = () => `198.51.${100 + (ipSeq >> 8) % 100}.${1 + (ipSeq++ % 250)}`;

// =============================================================================
const main = await server('main');

await step('features', 'api/ping.php and api/auth/me.php advertise features.sync, the waiting room and the save hint', async () => {
  const c = new Client(main);
  const ping = await c.req('api/ping.php');
  const me = await c.req('api/auth/me.php');
  for (const [n, r] of [['ping', ping], ['me', me]]) {
    const f = r.data && r.data.features;
    assert(f && f.sync === 1 && f.queue === 1 && f.saveEvery === 60000, `${n}: features = ${JSON.stringify(f)}`);
  }
  const u = await newUser(main, 'Ft');
  const meIn = await u.req('api/auth/me.php');
  assert(meIn.data.user && meIn.data.features.sync === 1, 'me (logged in): no features');
  return JSON.stringify(ping.data.features);
});

let A, B;
await step('token', 'the first call issues a token; calls with it are answered without a session, a CSRF look-up or SQL', async () => {
  A = await newUser(main, 'Ta');
  B = await newUser(main, 'Tb');
  const guest = await new Client(main).req('api/sync.php', { json: { p: at(0, 0) } });
  assert(guest.status === 401 || guest.status === 403, `a visitor without a login → ${guest.status}`);
  const first = await A.sync({ p: at(1, 1), ap: { hair: 'short', topColor: '#336699' }, f: 1 });
  assert(first.status === 200 && /^s1\.[\w-]+\.[\w-]{22}$/.test(first.data.t) && first.data.te > Date.now() / 1000 + 200, `first call → ${first.status} ${JSON.stringify(first.data).slice(0, 120)}`);
  assert(first.data.ch >= 1 && first.data.n >= 250 && first.data.cn === 1 && Array.isArray(first.data.pl) && first.data.sv >= 60000, `first answer: ${JSON.stringify(first.data).slice(0, 200)}`);
  await sleep(450);
  const hot = await A.sync({ p: at(1, 2) });
  const st = stats(hot);
  assert(hot.status === 200 && hot.data.t === undefined && hot.json.csrf === undefined, `token call → ${hot.status}, new token: ${hot.data && hot.data.t !== undefined}, csrf in the answer: ${hot.json && hot.json.csrf !== undefined}`);
  assert(st.sql === 0 && st.db === 0, `the token call ran SQL: ${hot.headers['x-tfm-stats']}`);
  assert(hot.headers['set-cookie'] === undefined, 'the token call set a cookie');
  await sleep(450);
  const fresh = await A.sync({ p: at(1, 2) }, { token: false });      // a call without the token: checked against the session, a new token
  assert(fresh.status === 200 && typeof fresh.data.t === 'string' && fresh.data.t !== first.data.t && fresh.data.ch === first.data.ch, `refresh → ${fresh.status}, same channel: ${fresh.data && fresh.data.ch === first.data.ch}`);
  return `token ${first.data.t.length} chars, valid ${first.data.te - Math.floor(Date.now() / 1000)} s; hot call: ${hot.headers['x-tfm-stats']}`;
});

await step('aoi', 'two players see each other: compact rows, names and looks on request, an unchanged player only in "st"', async () => {
  const b1 = await B.sync({ p: at(4, 5), ap: { hair: 'long', skin: '#ffddcc' }, f: 1 });
  assert(b1.status === 200 && b1.data.ch === 1 && b1.data.cn === 2, `B joins → ${b1.status} ${JSON.stringify(b1.data).slice(0, 120)}`);
  const rowA = b1.data.pl.find((r) => r[0] === String(A.user.id));
  assert(rowA && rowA.length === 12 && rowA[1] === 1 && rowA[3] === 2 && rowA[6] === 'idle' && rowA[7] === 0 && Number.isInteger(rowA[11]), `B's row of A: ${JSON.stringify(rowA)}`);
  await sleep(450);
  const a2 = await A.sync({ p: at(1, 2), q: [String(B.user.id)], f: 1 });
  const who = a2.data.who && a2.data.who[String(B.user.id)];
  assert(who && who[0] === B.nick && /^[0-9a-f]{8}$/.test(who[1]), `who: ${JSON.stringify(a2.data.who)}`);
  assert(a2.data.ap && JSON.stringify(a2.data.ap[who[1]]) === JSON.stringify({ hair: 'long', skin: '#ffddcc' }), `look: ${JSON.stringify(a2.data.ap)}`);
  assert(a2.data.on === 2 && a2.data.cn === 2, `online ${a2.data.on}, channel ${a2.data.cn}`);
  await sleep(450);
  const a3 = await A.sync({ p: at(1, 2) });
  assert(a3.data.pl.length === 0 && JSON.stringify(a3.data.st) === JSON.stringify([String(B.user.id)]), `unchanged neighbour: pl ${JSON.stringify(a3.data.pl)} st ${JSON.stringify(a3.data.st)}`);
  return `row ${JSON.stringify(rowA)} · ${a3.wire} bytes for a quiet call`;
});

await step('aoi', 'area of interest: a player in a room or far away is not sent; players of the same room see each other', async () => {
  const C = await newUser(main, 'Tc');
  await C.sync({ p: at(2, 2, { zone: 'ZONE_PL_DAECHEONG' }), f: 1 });
  await sleep(450);
  const bFar = await B.sync({ p: at(300, 300), f: 1 });
  assert(!allIds(bFar).includes(String(A.user.id)) && !allIds(bFar).includes(String(C.user.id)), `B at 300,300 still sees ${allIds(bFar)}`);
  await sleep(450);
  const a = await A.sync({ p: at(1, 2), f: 1 });
  assert(allIds(a).length === 0, `A (valley, B far, C in a room) sees ${allIds(a)}`);
  await sleep(450);
  const bRoom = await B.sync({ p: at(3, 3, { zone: 'ZONE_PL_DAECHEONG' }), f: 1 });
  assert(JSON.stringify(allIds(bRoom)) === JSON.stringify([String(C.user.id)]) && bRoom.data.pl[0][7] === 0, `B in the room sees ${JSON.stringify(bRoom.data.pl)}`);
  await sleep(450);
  const back = await B.sync({ p: at(4, 5), f: 1 });
  assert(allIds(back).includes(String(A.user.id)), 'B back in the valley does not see A');
  return 'valley ↔ room ↔ far';
});

await step('next', 'the server sets the pace: idle about 4 s, moving in company about 1 s, a hidden tab 20 s', async () => {
  await sleep(450);
  const idle = await A.sync({ p: at(1, 2) });
  await sleep(450);
  const moving = await A.sync({ p: at(2, 2, { speed: 6, anim: 'run' }) });
  await sleep(450);
  const hidden = await A.sync({ p: at(2, 2), h: 1 });
  await sleep(450);
  const bSees = await B.sync({ p: at(4, 5), f: 1 });
  assert(idle.data.n === 4000 && moving.data.n === 1000 && hidden.data.n === 20000, `next: idle ${idle.data.n}, moving ${moving.data.n}, hidden ${hidden.data.n}`);
  assert(!allIds(bSees).includes(String(A.user.id)), 'a hidden tab is still drawn for others');
  await sleep(450);
  await A.sync({ p: at(1, 2), h: 0 });
  return `idle ${idle.data.n} · moving ${moving.data.n} · hidden ${hidden.data.n} ms`;
});

await step('chat', 'a line sent through api/chat/send.php reaches the other player with the next sync call (filtered); the cursor moves on', async () => {
  const sent = await A.req('api/chat/send.php', { json: { text: `안녕 ${RUN} 내 번호는 010-1234-5678`, channel: 'all' } });
  assert(sent.status === 200 && sent.data.message.id > 0 && sent.data.piiMasked === true, `send → ${sent.status}`);
  await sleep(450);
  const b = await B.sync({ p: at(4, 5) });
  const line = (b.data.m || []).find((m) => m[0] === sent.data.message.id);
  assert(line && line[1] === String(A.user.id) && line[2] === A.nick && line[4] === 0 && line[3].includes('🔒') && !line[3].includes('1234'), `B's chat: ${JSON.stringify(b.data.m)}`);
  assert(b.data.c === sent.data.message.id, `cursor ${b.data.c}`);
  assert(stats(b).sql === 0, `reading chat ran SQL: ${b.headers['x-tfm-stats']}`);
  await sleep(450);
  const quiet = await B.sync({ p: at(4, 5) });
  assert(quiet.data.m === undefined && quiet.data.c === b.data.c, 'the same line came twice');
  await sleep(700);                                                     // one chat line a second per account
  const local = await A.req('api/chat/send.php', { json: { text: `가까이만 ${RUN}`, channel: 'local' } });
  assert(local.status === 200, `local send → ${local.status}`);
  await sleep(450);
  const near = await B.sync({ p: at(4, 5) });
  await sleep(450);
  const farB = await B.sync({ p: at(200, 200) }, { token: false });
  const C2 = await newUser(main, 'Td');
  const far = await C2.sync({ p: at(250, 250), c: 0 });
  assert((near.data.m || []).some((m) => m[0] === local.data.message.id && m[4] === 1), 'the near player did not get the local line');
  assert(!(far.data.m || []).some((m) => m[0] === local.data.message.id), 'a far player got the local line');
  assert((far.data.m || []).some((m) => m[0] === sent.data.message.id), 'a newcomer did not get the recent history');
  await B.sync({ p: at(4, 5) }, { token: false });
  return `masked: ${line[3]}`;
});

await step('interop', 'an old page (presence/update.php, chat/list.php) and a new page (sync.php) see each other; the old endpoints answer from the cache', async () => {
  const old = await newUser(main, 'To');
  const p1 = await old.req('api/presence/update.php', { json: { x: 2, y: 0, z: 3, rotY: 0, anim: 'walk', speed: 2, zoneId: 'ZONE_MAIN', appearance: { hair: 'bun' } } });
  assert(p1.status === 200 && Array.isArray(p1.data.players), `presence/update → ${p1.status}`);
  const seesA = p1.data.players.find((p) => p.id === String(A.user.id));
  assert(seesA && seesA.nickname === A.nick && typeof seesA.x === 'number' && seesA.appearance && seesA.appearance.hair === 'short' && 'age' in seesA && 'zoneId' in seesA, `the old page's row of A: ${JSON.stringify(seesA)}`);
  const p2 = await old.req('api/presence/update.php', { json: { x: 2, y: 0, z: 3, rotY: 0, anim: 'walk', speed: 2, zoneId: 'ZONE_MAIN' } });
  assert(p2.status === 200 && stats(p2).sql === 0, `presence/update (second call) ran SQL: ${p2.headers['x-tfm-stats']}`);
  await sleep(450);
  const a = await A.sync({ p: at(1, 2), f: 1 });
  const rowOld = a.data.pl.find((r) => r[0] === String(old.user.id));
  assert(rowOld && rowOld[1] === 2 && rowOld[3] === 3 && rowOld[6] === 'walk', `the new page's row of the old page: ${JSON.stringify(rowOld)}`);
  const said = await old.req('api/chat/send.php', { json: { text: `옛 화면에서 ${RUN}`, channel: 'all' } });
  await sleep(450);
  const a2 = await A.sync({ p: at(1, 2) });
  assert((a2.data.m || []).some((m) => m[0] === said.data.message.id), 'the new page did not get the old page\'s line');
  const list0 = await old.req('api/chat/list.php?after=0');
  const said2 = await A.req('api/chat/send.php', { json: { text: `새 화면에서 ${RUN}`, channel: 'all' } });
  const list1 = await old.req(`api/chat/list.php?after=${list0.data.lastId}&rafter=${list0.data.retractId}`);
  assert(list1.status === 200 && list1.data.messages.some((m) => m.id === said2.data.message.id && m.userId === String(A.user.id)), `chat/list after the new page spoke: ${JSON.stringify(list1.data.messages)}`);
  assert(stats(list1).sql === 0, `chat/list (ring) ran SQL: ${list1.headers['x-tfm-stats']}`);
  assert(list1.data.online >= 3 && p1.data.online >= 3, `online: list ${list1.data.online}, presence ${p1.data.online}`);
  return `old ↔ new · chat/list: ${list1.headers['x-tfm-stats']}`;
});

await step('moderation', 'a banned account is taken back with the next call: its lines ("rt") and its avatar', async () => {
  const bad = await newUser(main, 'Tx');
  await bad.sync({ p: at(2, 3), f: 1 });
  const line = await bad.req('api/chat/send.php', { json: { text: `지워질 말 ${RUN}`, channel: 'all' } });
  assert(line.status === 200, `send → ${line.status}`);
  await sleep(450);
  const before = await A.sync({ p: at(1, 2), f: 1 });
  assert(allIds(before).includes(String(bad.user.id)) && (before.data.m || []).some((m) => m[0] === line.data.message.id), 'A did not see the account before the ban');
  const ban = main.cli('ban', bad.email);
  assert(ban.status === 0, `cli ban: ${ban.out.slice(0, 120)}`);
  await sleep(450);
  const after = await A.sync({ p: at(1, 2), f: 1 });
  assert(after.data.rt && after.data.rt.u.includes(String(bad.user.id)), `rt: ${JSON.stringify(after.data.rt)}`);
  assert(!allIds(after).includes(String(bad.user.id)), 'the banned account is still drawn');
  const banned = await bad.sync({ p: at(2, 3) });
  assert(banned.status === 401, `the banned account's token call → ${banned.status}`);
  return `rt ${JSON.stringify(after.data.rt)}`;
});

await step('gzip', 'answers of 1 KB and more are gzip-compressed when the browser asks, then without the CSRF token; small answers and other browsers get plain JSON', async () => {
  const u = await newUser(main, 'Tz');
  const plain = await u.req('api/player/get.php');
  const state = await u.req('api/chat/list.php?after=0', { headers: { 'Accept-Encoding': 'gzip, deflate, br' } });
  const small = await u.req('api/time.php', { headers: { 'Accept-Encoding': 'gzip' } });
  const noGz = await u.req('api/chat/list.php?after=0', { headers: { 'Accept-Encoding': 'br;q=1, gzip;q=0' } });
  assert(plain.headers['content-encoding'] === undefined, 'compressed without Accept-Encoding');
  assert(small.headers['content-encoding'] === undefined && small.json.csrf, 'a small answer was compressed');
  assert(noGz.headers['content-encoding'] === undefined && noGz.json.csrf, 'gzip;q=0 was ignored');
  if (state.text.length < 1024) return `chat history is only ${state.text.length} bytes here: nothing to compress`;
  assert(state.headers['content-encoding'] === 'gzip' && /accept-encoding/i.test(String(state.headers.vary)), `headers: ${state.headers['content-encoding']} / ${state.headers.vary}`);
  assert(state.json && state.json.success === true && state.json.csrf === undefined && state.json.serverTime > 0, 'the compressed body is not the envelope without csrf');
  return `${state.text.length} → ${state.wire} bytes on the wire`;
});

await step('session', 'read endpoints do not rewrite the session file; a "로그인 유지" cookie keeps its expiry when a read call has to refresh "last seen"', async () => {
  const s = await server('idle', { TFM_REMEMBER_IDLE: '8' });         // read calls refresh "last seen" every 2 s here
  const u = await newUser(s, 'Ts');
  await u.req('api/auth/logout.php', { json: {} });
  const login = await u.req('api/auth/login.php', { json: { login: u.email, password: PASSWORD, remember: true } });
  const keep = login.setCookie.find((c) => /^TFMSESSID=/.test(c) && /expires=/i.test(c));
  assert(login.status === 200 && keep, `login with remember: ${login.status} ${JSON.stringify(login.setCookie)}`);
  const sid = u.jar.get('TFMSESSID');
  const file = path.join(s.dataDir, 'sessions', 'sess_' + decodeURIComponent(sid));
  assert(fs.existsSync(file), 'no session file');
  const m0 = fs.statSync(file).mtimeMs;
  const cookies = [];
  for (let i = 0; i < 5; i++) { const r = await u.req(i % 2 ? 'api/auth/me.php' : 'api/chat/list.php?after=0'); assert(r.status === 200, `read → ${r.status}`); cookies.push(...r.setCookie); }
  assert(fs.statSync(file).mtimeMs === m0, 'a read call rewrote the session file within the first two seconds');
  await sleep(2300);
  const late = await u.req('api/auth/me.php');
  cookies.push(...late.setCookie);
  assert(late.status === 200 && late.data.user, `after 2.3 s → ${late.status}`);
  assert(fs.statSync(file).mtimeMs > m0, '"last seen" was not written after its interval');
  assert(!cookies.some((c) => /^TFMSESSID=/.test(c)), `a read call sent the session cookie again: ${JSON.stringify(cookies)}`);
  await sleep(2300);
  const post = await u.req('api/presence/update.php', { json: { x: 1, y: 0, z: 1 } });
  assert(post.status === 200 && !post.setCookie.some((c) => /^TFMSESSID=/.test(c)), `a write call → ${post.status} ${JSON.stringify(post.setCookie)}`);
  return 'no rewrite within the interval, one write after it, no cookie re-sent';
});

await step('saves', 'a save carries the save hint; the same checksum at the same revision is the unchanged fast path (nothing judged or written, at most 3 statements, also for a forged body); a wrong checksum, a malformed body, an old base, a body without base and a changed state take the ordinary path', async () => {
  const u = await newUser(main, 'Sv');
  await u.req('api/player/get.php');
  const state = freshState(u.user);
  const first = await u.req('api/player/save.php', { json: saveBody(state) });
  assert(first.status === 200 && first.data.revision === 1 && first.data.unchanged === undefined, `first save → ${first.status} ${JSON.stringify(first.error || first.data).slice(0, 160)}`);
  assert(first.data.saveEvery === 60000 && first.data.rt && typeof first.data.rt === 'object', `first answer: saveEvery ${first.data.saveEvery}, rt ${typeof first.data.rt}`);
  await sleep(1100);
  const same = await u.req('api/player/save.php', { json: saveBody(state, 1) });
  assert(same.status === 200 && same.data.unchanged === true && same.data.revision === 1 && same.data.savedAt === first.data.savedAt && same.data.size === first.data.size,
    `the same body → ${same.status} ${JSON.stringify(same.error || same.data).slice(0, 200)}`);
  assert(same.data.rt === undefined && same.data.saveEvery === 60000 && same.data.sub && same.data.subChanged === first.data.subChanged, `the unchanged answer is not {…, sub, subChanged, saveEvery} without rt: ${JSON.stringify(same.data).slice(0, 200)}`);
  const cost = stats(same), costFirst = stats(first);
  assert(cost.sql <= 3, `the unchanged save ran ${cost.sql} statements`);
  // another state under the stored checksum: nothing is stored (the fast path writes nothing); under any other
  // checksum the body is compared with it first; a body that is not a save is refused before either
  const forged = saveBody(state, 1);
  forged.data = { ...state, stats: { ...state.stats, coin: 999999 } };
  await sleep(1100);
  const claimed = await u.req('api/player/save.php', { json: forged });
  assert(claimed.status === 200 && claimed.data.unchanged === true && claimed.data.revision === 1, `another state under the stored checksum → ${claimed.status} ${JSON.stringify(claimed.error || claimed.data).slice(0, 160)}`);
  const kept = await u.req('api/player/get.php');
  assert(kept.data.save.revision === 1 && kept.data.save.data.stats.coin === 0, 'a state claimed under the stored checksum was stored');
  await sleep(1100);
  const tampered = await u.req('api/player/save.php', { json: { ...forged, checksum: 'f'.repeat(14) } });
  assert(tampered.status === 400 && tampered.error.code === 'CHECKSUM_MISMATCH', `a tampered body with a wrong checksum → ${tampered.status} ${tampered.error && tampered.error.code}`);
  await sleep(1100);
  const shape = await u.req('api/player/save.php', { json: { ...saveBody(state, 1), data: 'not a state' } });
  assert(shape.status === 400 && shape.error.code === 'INVALID_SAVE', `a body that is not a save, with the stored checksum → ${shape.status} ${shape.error && shape.error.code}`);
  // a changed state is judged and written
  const moved = { ...state, savedAt: Date.now(), stats: { ...state.stats, playTime: 3, distance: 4 } };
  await sleep(1100);
  const changed = await u.req('api/player/save.php', { json: saveBody(moved, 1) });
  assert(changed.status === 200 && changed.data.revision === 2 && changed.data.unchanged === undefined && changed.data.rt, `a changed state → ${changed.status} ${JSON.stringify(changed.error || changed.data).slice(0, 200)}`);
  // the first body again with its old base: refused as stale, with the stored copy
  await sleep(1100);
  const stale = await u.req('api/player/save.php', { json: saveBody(state, 1) });
  assert(stale.status === 409 && stale.error.code === 'STALE_SAVE' && stale.data.save.revision === 2, `an old base → ${stale.status} ${stale.error && stale.error.code}`);
  // a page that names no base (older pages) is never answered from the fast path
  await sleep(1100);
  const noBase = await u.req('api/player/save.php', { json: saveBody(moved) });
  assert(noBase.status === 200 && noBase.data.unchanged === undefined && noBase.data.revision === 3, `no base → ${noBase.status} ${JSON.stringify(noBase.error || noBase.data).slice(0, 160)}`);
  const stored = await u.req('api/player/get.php');
  assert(stored.data.save.revision === 3 && stored.data.save.data.stats.playTime === 3 && stored.data.save.data.stats.coin === 0, 'the stored copy is not the last accepted state');
  return `unchanged: ${cost.sql} statements, ${cost.ms} ms · ordinary: ${costFirst.sql} statements, ${costFirst.ms} ms`;
});

await step('channels', 'ten clients in channels of four: 4 / 4 / 2, stable over five rounds and a token refresh; nobody is sent a player of another channel', async () => {
  const s = await server('chan', { TFM_CHANNEL_SIZE: '4', TFM_CHANNEL_HARD: '5' });
  const players = [];
  for (let i = 0; i < 10; i++) players.push(await newUser(s, 'Tn'));
  const ch = [];
  for (const [i, p] of players.entries()) { const r = await p.sync({ p: at(i, i), f: 1 }); assert(r.status === 200, `join ${i} → ${r.status}`); ch.push(r.data.ch); }
  const sizes = Object.values(ch.reduce((m, c) => ({ ...m, [c]: (m[c] || 0) + 1 }), {})).sort((a, b) => b - a);
  assert(JSON.stringify(sizes) === '[4,4,2]', `channel sizes ${JSON.stringify(sizes)} (${ch})`);
  const idToCh = new Map(players.map((p, i) => [String(p.user.id), ch[i]]));
  let rows = 0;
  for (let round = 0; round < 5; round++) {
    await sleep(420);
    for (const [i, p] of players.entries()) {
      const r = await p.sync({ p: at(i + round, i), f: 1 }, round === 3 ? { token: false } : {});
      assert(r.status === 200 && r.data.ch === ch[i], `round ${round}: player ${i} is in channel ${r.data && r.data.ch} (was ${ch[i]}) → ${r.status}`);
      for (const id of allIds(r)) { assert(idToCh.get(id) === ch[i], `player ${i} (channel ${ch[i]}) was sent player ${id} of channel ${idToCh.get(id)}`); rows++; }
      assert(r.data.cn === sizes[[...new Set(ch)].indexOf(ch[i])] || r.data.cn >= 2, `cn ${r.data.cn}`);
      assert(r.data.on === 10, `online ${r.data.on}`);
    }
  }
  assert(rows === 5 * (4 * 3 + 4 * 3 + 2 * 1), `${rows} neighbour rows in 5 rounds (expected ${5 * 26})`);
  const cap = s.cli('capacity');
  assert(cap.status === 0 && /10 \/ 300/.test(cap.out) && /3개/.test(cap.out), `cli capacity: ${cap.out.slice(0, 300)}`);
  return `channels ${ch.join('')} · cli: ${cap.out.split('\n').find((l) => l.includes('seats')).trim()}`;
});

await step('queue', 'a full house (3 seats): the 4th–6th get 503 QUEUE + Retry-After + a ticket; api/queue.php keeps their order; a freed seat goes to the first ticket; nobody seated is evicted', async () => {
  const s = await server('small', { TFM_MAX_ONLINE: '3', ...PROXY });
  const seated = [];
  for (let i = 0; i < 3; i++) { const u = await newUser(s, 'Tq', { xff: nextIp() }); const r = await u.sync({ p: at(i, 0), f: 1 }); assert(r.status === 200, `seat ${i} → ${r.status}`); seated.push(u); }
  const waiting = [];
  for (let i = 0; i < 3; i++) {
    const u = await newUser(s, 'Tw', { xff: nextIp() });
    const r = await u.sync({ p: at(0, 0), f: 1 });
    assert(r.status === 503 && r.error.code === 'QUEUE' && Number(r.headers['retry-after']) >= 1 && r.data.queue && r.data.queue.pos === i + 1 && /^q1\./.test(r.data.queue.t), `newcomer ${i} → ${r.status} ${JSON.stringify(r.data)}`);
    u.ticket = r.data.queue.t;
    waiting.push(u);
  }
  const poll = (u) => raw(s.base, `api/queue.php?t=${encodeURIComponent(u.ticket)}`, { headers: { 'X-Forwarded-For': u.xff } });
  for (let round = 0; round < 2; round++) {
    await sleep(1000);
    for (const [i, u] of seated.entries()) { const r = await u.sync({ p: at(i, round) }); assert(r.status === 200, `a seated player got ${r.status} while the house was full`); }
    for (const [i, u] of waiting.entries()) { const r = await poll(u); assert(r.status === 200 && r.data.go === false && r.data.pos === i + 1 && r.data.next >= 1000, `ticket ${i}: ${r.status} ${JSON.stringify(r.data)}`); assert(stats(r).sql === 0, `api/queue.php ran SQL: ${r.headers['x-tfm-stats']}`); }
  }
  const early = await waiting[1].sync({ p: at(0, 0), qt: waiting[1].ticket });
  assert(early.status === 503 && early.error.code === 'QUEUE', `ticket 2 entered before its turn (${early.status})`);
  assert((await seated[1].req('api/auth/logout.php', { json: {} })).status === 200, 'logout');
  await sleep(1000);
  const p3 = await poll(waiting[2]), p2 = await poll(waiting[1]), p1 = await poll(waiting[0]);
  assert(p1.data.go === true && p2.data.go === false && p2.data.pos === 1 && p3.data.go === false && p3.data.pos === 2, `after one seat was freed: ${JSON.stringify([p1.data, p2.data, p3.data])}`);
  const thief = await waiting[2].sync({ p: at(0, 0), qt: waiting[0].ticket });
  assert(thief.status === 503, `another account entered with ticket 1 (${thief.status})`);
  const enter = await waiting[0].sync({ p: at(5, 5), qt: waiting[0].ticket, f: 1 });
  assert(enter.status === 200 && typeof enter.data.t === 'string', `ticket 1 could not enter: ${enter.status} ${JSON.stringify(enter.error || enter.data).slice(0, 160)}`);
  const late = await newUser(s, 'Tw', { xff: nextIp() });
  const lr = await late.sync({ p: at(0, 0) });
  // tickets so far: 1 (entered), 2, 3, and a 4th that the account trying a foreign ticket was handed: the newcomer is behind all of them
  assert(lr.status === 503 && lr.data.queue.pos === 4, `a newcomer is not behind the line: ${lr.status} ${JSON.stringify(lr.data)}`);
  const bad = await raw(s.base, 'api/queue.php?t=q1.abc.def');
  const none = await raw(s.base, 'api/queue.php');
  assert(bad.status === 400 && bad.error.code === 'QUEUE_TICKET' && none.status === 400, `a bad ticket → ${bad.status}, no ticket → ${none.status}`);
  const cap = s.cli('capacity');
  assert(/3 \/ 3명/.test(cap.out) && /대기실[^\n]*4명/.test(cap.out), `cli capacity: ${cap.out.slice(0, 400)}`);
  return 'order kept: 1 entered, 2 → pos 1, 3 → pos 2, a newcomer → the end of the line';
});

await step('shed', 'overload (shed_rps 20): newcomers get 503 BUSY + Retry-After, a seated player\'s sync and a save do not; the server PC itself is never shed; logins are metered', async () => {
  const s = await server('busy', { TFM_SHED_RPS: '20', TFM_TARGET_RPS: '10', TFM_LOGIN_PER_SEC: '2', ...PROXY });
  const u = await newUser(s, 'Tb', { xff: nextIp() });
  const first = await u.sync({ p: at(0, 0), f: 1 });
  assert(first.status === 200, `seat → ${first.status}`);
  const calm = await raw(s.base, 'api/ranking/top.php', { headers: { 'X-Forwarded-For': nextIp() } });
  assert(calm.status === 200, `before the flood: ${calm.status}`);
  let shed = null, served = 0;
  for (let burst = 0; burst < 6 && !shed; burst++) {
    const rs = await Promise.all(Array.from({ length: 60 }, () => raw(s.base, 'api/time.php', { headers: { 'X-Forwarded-For': nextIp() } })));
    shed = rs.find((r) => r.status === 503) || null;
    served += rs.filter((r) => r.status === 200).length;
  }
  assert(shed && shed.error.code === 'BUSY' && Number(shed.headers['retry-after']) >= 2 && shed.data.retryAfter >= 2, `360 requests in a row and no 503 BUSY (${served} served)`);
  await Promise.all(Array.from({ length: 80 }, () => raw(s.base, 'api/time.php', { headers: { 'X-Forwarded-For': nextIp() } })));
  const [hot, save, visitor] = await Promise.all([
    u.sync({ p: at(1, 0) }),
    u.req('api/player/save.php', { json: { version: 1, checksum: '', data: {} } }),
    raw(s.base, 'api/ranking/top.php', { headers: { 'X-Forwarded-For': nextIp() } }),
  ]);
  assert(hot.status === 200 || hot.status === 429, `a seated player's sync during overload → ${hot.status}`);
  assert(save.status !== 503, `a save was shed (${save.status})`);
  assert(visitor.status === 503, `a new visitor during overload → ${visitor.status}`);
  // the same limits without a proxy in front: every request is the server PC's own browser — never shed
  const own = await server('own', { TFM_SHED_RPS: '20', TFM_TARGET_RPS: '10', TFM_LOGIN_PER_SEC: '2' });
  let ownShed = 0;
  for (let burst = 0; burst < 4; burst++) ownShed += (await Promise.all(Array.from({ length: 60 }, () => raw(own.base, 'api/time.php')))).filter((r) => r.status === 503).length;
  assert(ownShed === 0, `${ownShed} of 240 requests from the server PC itself were shed`);
  if (hot.status === 200) assert(hot.data.n > 1000, `"next" was not stretched under load: ${hot.data.n}`);
  await sleep(2500);
  const logins = await Promise.all(Array.from({ length: 8 }, (_, i) => raw(s.base, 'api/auth/login.php', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': nextIp(), Cookie: u.cookie(), 'X-CSRF-Token': u.csrf }, body: JSON.stringify({ login: `nobody${i}@example.com`, password: 'Wrong2026pw' }) })));
  const busy = logins.filter((r) => r.status === 503 && r.error.code === 'LOGIN_BUSY' && Number(r.headers['retry-after']) >= 1).length;
  assert(busy >= 3, `8 logins at once, login_per_sec 2: ${logins.map((r) => r.status).join(',')}`);
  return `503 BUSY (Retry-After ${shed.headers['retry-after']}s) · seated sync ${hot.status}${hot.status === 200 ? ` next ${hot.data.n} ms` : ''} · save ${save.status} · ${busy}/8 logins metered`;
});

const failed = results.filter((x) => !x).length;
console.log(`\n${failed ? paint(31, '✖') : paint(32, '✔')} sync-e2e: ${results.length - failed}/${results.length} passed (${DRIVER})`);
cleanup();
process.exit(failed ? 1 : 0);
