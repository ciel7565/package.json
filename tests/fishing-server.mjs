#!/usr/bin/env node
// =============================================================================
// tests/fishing-server.mjs — the server side of a catch over real HTTP (CONTRACT §18.3, §18.0)
//
//   node tests/fishing-server.mjs --docroot <dir> [--port <n>] [--verbose]
//       <dir> = a private copy of server/ with index.html and data/game-data.json built from this tree:
//         D=<scratch>/docroot-1 && mkdir -p $D && cp -a server/. $D/ && \
//           node tools/build.mjs --no-font --no-assets --quiet --out $D/index.html --data-out $D/data/game-data.json
//   env: TFM_DB_DRIVER=mysql TFM_DB_HOST / PORT / USER / PASS / NAME → the spawned php -S (and the operator's change) use
//        MariaDB; without them a throw-away SQLite file.
//
// The fishing block is made with the page's OWN functions (34-fish-data.js evaluated in Node: emptyState, itemId,
// rollLength, the rules), saved through api/player/save.php like G.save does, and read back:
//   · a save with G.state.fishing, a fish in the bag, the sticker and the counters is accepted and comes back unchanged;
//   · an unknown species, a protected species as an item, a protected fish marked as taken along, a hoard → 409
//     VALIDATION_FAILED with the code and the stored copy (the page restores it);
//   · fishing.enabled / fishing.keep_per_day / fishing.trap_minutes arrive in `site` (api/ping.php, api/auth/me.php,
//     the login answer); an operator's change (the registry call the admin tab ⚙️ 설정 makes) arrives too and moves the
//     `siteV` every save answers with — that is how an open page learns of it.
// Exit 0 = all passed, 1 = a check failed, 2 = could not run.
// =============================================================================
import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (n, d = null) => { const i = args.indexOf(n); return i >= 0 && i + 1 < args.length ? args[i + 1] : d; };
const VERBOSE = args.includes('--verbose');
const DOCROOT = opt('--docroot') ? path.resolve(opt('--docroot')) : null;
if (!DOCROOT || !fs.existsSync(path.join(DOCROOT, 'api/ping.php')) || !fs.existsSync(path.join(DOCROOT, 'data/game-data.json'))) {
  console.error('usage: node tests/fishing-server.mjs --docroot <a private copy of server/ with data/game-data.json>');
  process.exit(2);
}
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? '  ✔' : '  ✖'} ${name}${detail !== '' && detail != null ? ` — ${String(detail).slice(0, 300)}` : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------------ the page's own fish data
const G = { data: {} };
{
  const ctx = vm.createContext({ G, window: {}, console, Math, JSON, Object, Array, Number, String, Date });
  for (const f of ['01-data.js', '02-layout.js', '34-fish-data.js']) vm.runInContext(`(function(){'use strict';\n${fs.readFileSync(path.join(ROOT, 'src/game', f), 'utf8')}\n})()`, ctx, { timeout: 4000, filename: f });
}
const F = G.data.fish;
if (!F || !F.species) { console.error('34-fish-data.js gave no fish table'); process.exit(2); }

// ------------------------------------------------------------------ HTTP client (cookie jar + CSRF), as tests/server-e2e.mjs
let BASE = null;
class Client {
  constructor() { this.jar = new Map(); this.csrf = null; }
  async req(p, opts = {}) {
    const method = opts.method || (opts.json !== undefined ? 'POST' : 'GET');
    const headers = { Accept: 'application/json' };
    if (this.jar.size) headers.Cookie = [...this.jar].map(([k, v]) => `${k}=${v}`).join('; ');
    let body;
    if (opts.json !== undefined) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(opts.json); }
    if (method !== 'GET' && this.csrf) headers['X-CSRF-Token'] = this.csrf;
    const res = await fetch(new URL(p, BASE), { method, headers, body, redirect: 'manual' });
    const list = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
    for (const line of list) { const pair = line.split(';')[0]; const i = pair.indexOf('='); if (i > 0) { const v = pair.slice(i + 1).trim(); if (v === '' || v === 'deleted') this.jar.delete(pair.slice(0, i).trim()); else this.jar.set(pair.slice(0, i).trim(), v); } }
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not json */ }
    if (json && typeof json.csrf === 'string') this.csrf = json.csrf;
    if (VERBOSE) console.log(`     ${method} ${p} -> ${res.status} ${text.slice(0, 260)}`);
    return { status: res.status, json, data: json?.data, error: json?.error };
  }
}
/** cyrb53 — identical to G.util.hash (the page's checksum) */
function cyrb53(str) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0, ch; i < str.length; i++) { ch = str.charCodeAt(i); h1 = Math.imul(h1 ^ ch, 2654435761); h2 = Math.imul(h2 ^ ch, 1597334677); }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0');
}
const saveBody = (state, base) => { const data = JSON.stringify(state); const b = { version: 1, checksum: cyrb53(data), data: state }; if (base != null) b.base = base; return b; };
/** a fresh account's state (the shape of G.save.createDefaultState with the fishing block of the page) */
function freshState(user, t) {
  const plot = () => ({ cropId: null, growth: 0, water: 40, health: 100, plantedAt: 0, lastUpdate: t, lastWaterAt: 0, harvests: 0 });
  const jar = (owned) => ({ owned, recipeId: null, status: 'EMPTY', progress: 0, quality: 0, hygiene: 100, temp: 22, humidity: 60, tempOff: 0, humOff: 0, startedAt: 0, lastUpdate: t, care: {}, completedAt: 0, claimedAt: 0, acc: 0 });
  return {
    version: 1, createdAt: t, savedAt: t,
    profile: { id: String(user.id), nickname: user.nickname, email: user.email, role: user.role, avatar: null, title: '', titles: [] },
    stats: { level: 1, exp: 0, coin: 0, edu: 0, logins: 1, playTime: 0, distance: 0, waters: 0, plants: 0, harvests: 0, harvestedItems: 0, fermentsStarted: 0, fermentsClaimed: 0, fermentChecks: 0, quizCorrect: 0, quizAnswered: 0, eduCompleted: 0, journals: 0, photos: 0, emotes: 0, gestures: 0, chats: 0, talks: 0, crafts: 0, interacts: 0 },
    player: { x: 0, y: 0, z: 9, rotY: Math.PI, zoneId: 'ZONE_MAIN' },
    inventory: { ITEM_SEED_BEAN: 3, ITEM_WATERING_CAN: 1, ITEM_HOMI: 1, ITEM_MEJU: 1, ITEM_SALT: 2, ITEM_GUIDEBOOK: 1 },
    quests: {}, farm: { plots: { P1: plot(), P2: plot() } }, jars: { J1: jar(true), J2: jar(false), J3: jar(false) },
    education: { viewed: {}, completed: {}, quiz: {} },
    journal: [], photos: [], achievements: {}, collection: {}, visited: { ZONE_MAIN: t }, poisVisited: {}, npcsTalked: {}, cropKinds: {},
    flags: {}, tutorial: { step: 0, done: false }, activity: [], settings: {}, blocked: [],
    fishing: F.emptyState(),
  };
}
/** what 35-fishing.js writes when a fish is landed and answered (book, counters, exp / edu, the bag, the sticker) */
function land(s, id, keep, t, rnd) {
  const sp = F.byId[id], f = s.fishing, R = F.rules;
  const mm = F.rollLength(sp, rnd);
  const first = !f.book[id];
  const b = f.book[id] || (f.book[id] = { n: 0, kept: 0, rel: 0, max: 0, first: t });
  b.n++; b.max = Math.max(b.max, mm);
  s.stats.fishCaught = (s.stats.fishCaught || 0) + 1;
  s.stats.exp += (R.expByDifficulty[sp.difficulty] || 6) + (first ? R.firstBonus.exp : 0);
  s.stats.edu += first ? R.firstBonus.edu : 0;
  if (first) s.collection[`COL_FISH_${id}`] = { at: t, zoneId: 'ZONE_MAIN' };
  if (keep) { const k = 20260610; if (f.day.key !== k) { f.day.key = k; f.day.kept = 0; } f.day.kept++; b.kept++; s.stats.fishKept = (s.stats.fishKept || 0) + 1; s.inventory[F.itemId(id)] = (s.inventory[F.itemId(id)] || 0) + 1; }
  else { b.rel++; s.stats.fishReleased = (s.stats.fishReleased || 0) + 1; s.stats.exp += R.releaseBonus.exp; }
  s.stats.fishSpecies = Object.keys(f.book).length;
  s.stats.fishGuarded = Object.keys(f.book).filter((k) => F.byId[k].protected).length;
  return mm;
}
const rng = (seed) => { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };

// ------------------------------------------------------------------ the server
let php = null, tmpData = null;
async function freePort() { return new Promise((resolve, reject) => { const s = net.createServer(); s.once('error', reject); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); }); }
const env = () => ({ ...process.env, TFM_DATA_DIR: tmpData, TFM_TOSS_MOCK: '1' });
/** one PHP expression with the docroot's own bootstrap, data directory and database (as an operator's tool would) */
function srvPhp(expr, input = null) {
  const code = 'require getenv("TFM_FISH_BOOT"); $in = json_decode((string) stream_get_contents(STDIN), true); ' + `echo json_encode(${expr}, JSON_UNESCAPED_UNICODE);`;
  const r = spawnSync('php', ['-r', code], { input: JSON.stringify(input), encoding: 'utf8', timeout: 60000, env: { ...env(), TFM_FISH_BOOT: path.join(DOCROOT, 'lib/bootstrap.php') } });
  if (r.status !== 0) throw new Error(`server PHP failed: ${String(r.stderr || r.stdout).trim().slice(0, 300)}`);
  return JSON.parse(r.stdout);
}
function cleanup() { if (php) { try { php.kill(); } catch { /* gone */ } php = null; } if (tmpData) { try { fs.rmSync(tmpData, { recursive: true, force: true }); } catch { /* leave it */ } tmpData = null; } }
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { cleanup(); process.exit(130); });

try {
  tmpData = fs.mkdtempSync(path.join(os.tmpdir(), 'tfm-fishsrv-'));
  const port = Number(opt('--port')) || await freePort();
  php = spawn('php', ['-S', `127.0.0.1:${port}`, '-t', DOCROOT], { env: env(), stdio: ['ignore', 'ignore', 'pipe'] });
  php.stderr.on('data', (d) => { if (VERBOSE) process.stderr.write(String(d)); });
  BASE = `http://127.0.0.1:${port}/`;
  let up = false;
  for (let i = 0; i < 80 && !up; i++) { try { const r = await fetch(BASE + 'api/ping.php'); up = r.ok; } catch { /* not yet */ } if (!up) await sleep(100); }
  if (!up) throw new Error('php -S did not start');
  const driver = (process.env.TFM_DB_DRIVER || 'sqlite').toLowerCase();
  console.log(`\n낚시 서버 시험 — ${BASE} (${driver})\n`);
  // a clean slate for the three settings (a MariaDB database may have been used before)
  srvPhp('array_map(function ($k) { try { return Tfm\\Settings::clear($k, null); } catch (Throwable $e) { return false; } }, ["fishing.enabled", "fishing.keep_per_day", "fishing.trap_minutes"])');

  const anon = new Client();
  const ping = await anon.req('api/ping.php');
  const s0 = ping.data?.site || {};
  check('api/ping.php gives every visitor `site` with fishing.enabled, fishing.keep_per_day, fishing.trap_minutes (defaults: on, 6, 10)', ping.status === 200 && s0['fishing.enabled'] === true && s0['fishing.keep_per_day'] === 6 && s0['fishing.trap_minutes'] === 10 && typeof ping.data?.siteV === 'string', JSON.stringify({ e: s0['fishing.enabled'], k: s0['fishing.keep_per_day'], t: s0['fishing.trap_minutes'], v: ping.data?.siteV }));

  const A = new Client();
  await A.req('api/ping.php');            // the handshake: the session cookie and the CSRF token
  const id = crypto.randomBytes(4).toString('hex');
  const nick = `낚시${String(parseInt(id, 16) % 100000).padStart(5, '0')}`;
  const reg = await A.req('api/auth/register.php', { json: { email: `fish${id}@example.com`, nickname: nick, password: 'Ferment2026ok', password_confirm: 'Ferment2026ok', agree: true } });
  const me = reg.data?.user;
  check('an account registers; its answer carries `site` with the fishing settings too', reg.status === 200 && !!me && (reg.data?.site ? reg.data.site['fishing.keep_per_day'] === 6 : true), `status ${reg.status} ${reg.error?.code || ''}`);
  if (!me) throw new Error('no account');

  // ---------------------------------------------------------------- saves
  const t0 = Date.now();
  let state = freshState(me, t0);
  let r = await A.req('api/player/save.php', { json: saveBody(state) });
  check('the first save — with an empty fishing block as the page makes it — is accepted', r.status === 200 && r.data?.revision === 1, `status ${r.status} ${r.error?.code || ''} ${JSON.stringify(r.data?.violations || '')}`);
  const siteV0 = r.data?.siteV;
  await sleep(1300);
  const rnd = rng(11);
  const s1 = structuredClone(state);
  const t1 = Date.now();
  const mmK = land(s1, 'SANCHEONEO', true, t1, rnd);       // 산천어: taken along
  const mmP = land(s1, 'EOREUMCHI', false, t1, rnd);       // 어름치 (천연기념물): met and released
  s1.fishing.seen.GAJAE = 1;                               // a clean-water neighbour, looked at
  s1.fishing.traps.FS_V_POOL = { at: t1, bait: 'paste' };  // an 어항 set in the water
  s1.fishing.tut = 1;
  s1.savedAt = t1;
  r = await A.req('api/player/save.php', { json: saveBody(s1, 1) });
  check('a save after two catches — 산천어 in the bag (FISH_SANCHEONEO), 어름치 released, a neighbour seen, an 어항 set, stickers, exp and edu — is accepted', r.status === 200 && r.data?.revision === 2, `status ${r.status} ${r.error?.code || ''} ${JSON.stringify(r.data?.violations || '')} (lengths ${mmK} / ${mmP} mm)`);
  const got = await A.req('api/player/get.php');
  const d = got.data?.save?.data;
  check('… and comes back as it was sent: the 도감, today\'s count, the 어항, the fish in the bag', !!d && JSON.stringify(d.fishing) === JSON.stringify(s1.fishing) && d.inventory.FISH_SANCHEONEO === 1 && d.stats.fishCaught === 2 && d.stats.fishGuarded === 1 && !!d.collection.COL_FISH_SANCHEONEO, d ? JSON.stringify(d.fishing).slice(0, 200) : `status ${got.status}`);
  let stored = d ? structuredClone(d) : s1, rev = 2;
  /** a changed copy of the stored save must be refused with `code`, and the answer must carry the stored copy */
  const refuse = async (name, code, mut) => {
    await sleep(1100);
    const s = structuredClone(stored); s.savedAt = Date.now(); mut(s);
    const x = await A.req('api/player/save.php', { json: saveBody(s, 2) });
    const v = x.json?.data?.violations || [];
    check(`${name} → 409 ${code}; the stored copy comes back for the page to restore`, x.status === 409 && x.error?.code === 'VALIDATION_FAILED' && v.includes(code) && JSON.stringify(x.json?.data?.save?.data?.fishing) === JSON.stringify(stored.fishing) && x.json?.data?.save?.revision === 2, `status ${x.status} ${x.error?.code || ''} ${v.join(',')}`);
  };
  await refuse('an unknown species in the 도감', 'FISH_BAD_SHAPE', (s) => { s.fishing.book.PIRANHA = { n: 1, kept: 0, rel: 1, max: 200, first: Date.now() }; s.stats.fishCaught++; s.stats.fishReleased++; s.stats.fishSpecies++; });
  await refuse('an unknown species as an item (FISH_PIRANHA)', 'FISH_PROTECTED', (s) => { s.inventory.FISH_PIRANHA = 1; });
  await refuse('a protected species as an item (FISH_YEOLMOGEO — 열목어)', 'FISH_PROTECTED', (s) => { s.inventory.FISH_YEOLMOGEO = 1; });
  await refuse('a protected fish marked as taken along (어름치 kept: 1)', 'FISH_PROTECTED', (s) => { s.fishing.book.EOREUMCHI.kept = 1; s.fishing.book.EOREUMCHI.rel = 0; });
  await refuse('a hoard in the bag (41 fish)', 'FISH_KEEP_LIMIT', (s) => { s.inventory.FISH_SANCHEONEO = 41; });
  await refuse('a counter ahead of the 도감 (fishCaught 9)', 'FISH_BAD_SHAPE', (s) => { s.stats.fishCaught = 9; });
  const after = await A.req('api/player/get.php');
  check('after the refused saves the stored save is still the honest one (revision 2)', after.data?.save?.revision === 2 && JSON.stringify(after.data.save.data.fishing) === JSON.stringify(stored.fishing));
  // a full basket as the page allows it
  await sleep(1100);
  {
    const s = structuredClone(stored); s.savedAt = Date.now(); s.inventory.FISH_SANCHEONEO = F.rules.bagMax;
    // the fish were caught over many days: what this save adds is only the number in the bag — the book says so
    s.fishing.book.SANCHEONEO.n = F.rules.bagMax; s.fishing.book.SANCHEONEO.kept = F.rules.bagMax; s.fishing.book.SANCHEONEO.rel = 0;
    const x = await A.req('api/player/save.php', { json: saveBody(s, rev) });
    const v = x.json?.data?.violations || [];
    check(`a full basket of the page (${F.rules.bagMax} fish) is never FISH_KEEP_LIMIT`, !v.includes('FISH_KEEP_LIMIT') && !v.includes('FISH_PROTECTED'), `status ${x.status} ${v.join(',')}`);
    if (x.status === 200) { stored = s; rev = x.data.revision; }
  }

  // ---------------------------------------------------------------- operator settings
  srvPhp('[Tfm\\Settings::set("fishing.keep_per_day", 3, null), Tfm\\Settings::set("fishing.trap_minutes", 25, null), Tfm\\Settings::set("fishing.enabled", false, null)]');
  let s2 = {}, v2 = null, tries = 0;
  for (; tries < 40; tries++) {             // a shared cache may keep the old values for cache.settings_ttl seconds (30)
    const p = await anon.req('api/ping.php');
    s2 = p.data?.site || {}; v2 = p.data?.siteV;
    if (s2['fishing.keep_per_day'] === 3) break;
    await sleep(1000);
  }
  check('an operator\'s change (3 fish a day, 25 minutes, fishing off) reaches every visitor through api/ping.php', s2['fishing.keep_per_day'] === 3 && s2['fishing.trap_minutes'] === 25 && s2['fishing.enabled'] === false && v2 !== ping.data?.siteV, `${JSON.stringify({ e: s2['fishing.enabled'], k: s2['fishing.keep_per_day'], t: s2['fishing.trap_minutes'] })} after ${tries} s`);
  const meR = await A.req('api/auth/me.php');
  check('… and the logged-in page through api/auth/me.php', meR.data?.site?.['fishing.keep_per_day'] === 3 && meR.data?.site?.['fishing.trap_minutes'] === 25 && meR.data?.site?.['fishing.enabled'] === false, JSON.stringify(meR.data?.site?.['fishing.keep_per_day']));
  await sleep(1100);
  {
    const s = structuredClone(stored); s.savedAt = Date.now(); s.stats.playTime += 5;
    const x = await A.req('api/player/save.php', { json: saveBody(s, rev) });
    check('the next save answers with another `siteV`: an open page then asks for `site` again', x.status === 200 && typeof x.data?.siteV === 'string' && x.data.siteV !== siteV0 && x.data.siteV === v2, `status ${x.status} ${x.error?.code || ''} ${siteV0} → ${x.data?.siteV}`);
  }
  srvPhp('array_map(function ($k) { return Tfm\\Settings::clear($k, null); }, ["fishing.enabled", "fishing.keep_per_day", "fishing.trap_minutes"])');
} catch (e) {
  check('the test ran to its end', false, e?.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : String(e));
} finally {
  cleanup();
}
const failed = results.filter((x) => !x.ok);
console.log(`\n${failed.length ? '✖' : '✔'} ${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
