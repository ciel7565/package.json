#!/usr/bin/env node
// =============================================================================
// tests/myroom-client.mjs — 내 방 (CONTRACT §17.4): the catalogue and its rules (Node), the room and its edit mode (browser)
//
//   node tests/myroom-client.mjs                      Node part + browser part on a private page (tools/build.mjs --out <tmp>)
//   node tests/myroom-client.mjs --node               the Node part only (no browser, a second)
//   node tests/myroom-client.mjs --file /abs/page.html   test an already built page
//   options: --keep · --json · --headed · --timeout <ms> · --shots <dir> (pictures of the steps) · --skip-high · --skip-phone
//            --skip-logic (without Node part 2)
//   Run the browser part through the shared browser lock (at most two browsers on the build machine).
//
// NODE, part 2 (tests/myroom-logic.mjs — the REAL room module, hanok kit and catalogue run in Node with three.js; places, UI,
//   engine and server are small stand-ins): every thing can be made and is as big as the catalogue says, the edit mode
//   (API, pointer with real camera rays, keys), what is drawn always agrees with the data, the server side of the app.
// NODE, part 1 (src/game/76-myroom-data.js evaluated like tools/build.mjs does): at least 120 things with unique ids, every one
//   with a known category, placing kind, a sane footprint and a generator that exists in the sources; tops, palettes and
//   lamps fit; the placing rules (outside, the way to the door, walls, posts, windows, tops, overlaps); sanitize() against
//   hostile and broken data; the three ready-made rooms valid thing by thing; the table the server checks against; no Hanja.
// BROWSER (local mode on the file:// page; the server is a faked G.net.request for api/room/*):
//   in by the door outside → the button "방 꾸미기" → the tray of picture tiles → place with the mouse, move by dragging,
//   turn / raise / colour / size / copy / remove with the buttons, undo / redo, the limit, the keep-clear zone before the
//   door, a small thing onto a table, a wall thing onto a wall · the keyboard alone · save → reload → the same room ·
//   the three ready-made rooms · a server account without the right gets the kind card and may look at a ready-made room ·
//   a server account with the right: read, save with the version, a save whose answer is lost, a room changed elsewhere ·
//   easy mode: no typing, every target ≥ 56 px, a voice line on every button · the phone 390 × 844 with touch ·
//   draw calls with 160 things on `high` (walking and decorating) ≤ 200.
// Exit 0 = all passed, 1 = a check failed, 2 = could not run.
// =============================================================================
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n, d = null) => { const i = args.indexOf(n); return i >= 0 && i + 1 < args.length ? args[i + 1] : d; };
const jsonOut = flag('--json');
const log = (...a) => { if (!jsonOut) console.log(...a); };
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail: String(detail ?? '').slice(0, 500) }); log(`${ok ? '  ✔' : '  ✖'} ${name}${detail !== '' && detail != null ? ` — ${String(detail).slice(0, 360)}` : ''}`); };
const finish = (code) => {
  const failed = results.filter((r) => !r.ok);
  if (jsonOut) console.log(JSON.stringify({ passed: results.length - failed.length, failed: failed.length, results }, null, 1));
  else console.log(`\n${failed.length ? '✖' : '✔'} myroom-client: ${results.length - failed.length} passed, ${failed.length} failed`);
  process.exit(code != null ? code : failed.length ? 1 : 0);
};

// =============================================================================================== NODE
const DATA_FILE = path.join(ROOT, 'src/game/76-myroom-data.js');
const G0 = { data: {} };
vm.runInContext(`(function(){'use strict';\n${fs.readFileSync(DATA_FILE, 'utf8')}\n})()`, vm.createContext({ G: G0, Math, JSON, Object, Array, Number, String }));
const D = G0.data.myroom;
const SRC = ['src/game/75-myroom.js', 'src/game/76-myroom-data.js', 'src/styles/75-myroom.css'].map((f) => [f, fs.readFileSync(path.join(ROOT, f), 'utf8')]);
const KIT = fs.readFileSync(path.join(ROOT, 'src/game/19-hanok-kit.js'), 'utf8');
const HANJA = /[㐀-鿿豈-﫿]/;
log('— catalogue (Node)');
{
  const ids = D.order, raw = fs.readFileSync(DATA_FILE, 'utf8');
  const declared = [...raw.matchAll(/^\s*add\('([A-Z0-9_]+)'/gm)].map((m) => m[1]);
  const dup = declared.filter((id, i) => declared.indexOf(id) !== i);
  check('catalogue: at least 120 things, every id once and in the form the server accepts', ids.length >= 120 && new Set(ids).size === ids.length && !dup.length && ids.every((id) => /^[A-Z][A-Z0-9_]{1,23}$/.test(id) && D.items[id].id === id), `${ids.length} things${dup.length ? ' · twice: ' + dup.join(' ') : ''}`);
  const cats = new Set(D.cats.map((c) => c.id)), perCat = {};
  for (const id of ids) perCat[D.items[id].cat] = (perCat[D.items[id].cat] || 0) + 1;
  check('catalogue: twelve categories, each with a picture, a name, a voice line and at least five things', D.cats.length === 12 && D.cats.every((c) => c.emoji && c.name && c.say && perCat[c.id] >= 5) && ids.every((id) => cats.has(D.items[id].cat)), JSON.stringify(perCat));
  const badFp = [], badGen = [], badTop = [], badCol = [], badLamp = [];
  const gen75 = SRC[0][1];
  for (const id of ids) {
    const e = D.items[id], [w, d, h] = e.fp;
    const sane = ['F', 'T', 'R', 'W', 'H'].includes(e.place) && [w, d, h].every((v) => Number.isFinite(v) && v > 0) && w <= 3.4 && d <= 2.2 && h <= 2.3
      && (e.place !== 'R' || h <= 0.06) && (e.place !== 'W' || (d <= 0.4 && h <= D.ROOM.wallV[1] - D.ROOM.wallV[0] && e.yw && e.yw[0] - h / 2 >= D.ROOM.wallV[0] - 1e-9 && e.yw[2] + h / 2 <= D.ROOM.wallV[1] + 1e-9 && e.yw[0] <= e.yw[1] && e.yw[1] <= e.yw[2]))
      && (e.place !== 'H' || h <= 1.3) && (e.place !== 'T' || (w <= 1.8 && h <= 1.3));
    if (!sane) badFp.push(`${id} ${e.place} ${e.fp.join('×')}`);
    // a generator: one of the room module's own table, or a function the hanok kit exports
    const own = new RegExp(`^\\s{4}${e.gen}\\(T`, 'm').test(gen75), kit = new RegExp(`\\bfunction ${e.gen}\\(|\\b${e.gen}\\(T\\b|[{,]\\s*${e.gen}\\s*[,}:]`).test(KIT);
    if (!own && !kit) badGen.push(`${id} → ${e.gen}`);
    if (e.top && !(e.place === 'F' && e.top[0] <= w + 1e-9 && e.top[1] <= d + 1e-9 && e.top[2] >= h - 0.03 - 1e-9 && e.top[2] <= h + 0.02)) badTop.push(`${id} top ${e.top.join('×')} of ${e.fp.join('×')}`);
    if (e.col && !(D.palettes[e.col[0]] && D.palettes[e.col[0]].length >= 6 && typeof e.col[1] === 'string')) badCol.push(id);
    if (e.lamp && !(e.lamp.length === 3 && e.lamp.every(Number.isFinite))) badLamp.push(id);
  }
  check('catalogue: every footprint is sane for its placing kind (floor, small, rug, wall, hanging)', !badFp.length, badFp.slice(0, 8).join(' · '));
  check('catalogue: every generator a thing names exists (the room module\'s own or the hanok kit\'s)', !badGen.length, badGen.join(' · '));
  check('catalogue: a top lies on its table (not wider, at its height), palettes and lamp spots are well-formed', !badTop.length && !badCol.length && !badLamp.length, [...badTop, ...badCol, ...badLamp].slice(0, 6).join(' · '));
  const kinds = {};
  for (const id of ids) kinds[D.items[id].place] = (kinds[D.items[id].place] || 0) + 1;
  check('catalogue: things for the floor, for tables, rugs, walls and the ceiling; colours, sizes and lamps to choose', kinds.F >= 20 && kinds.T >= 40 && kinds.R >= 5 && kinds.W >= 15 && kinds.H >= 4 && ids.filter((id) => D.items[id].col).length >= 30 && ids.filter((id) => D.items[id].sz).length >= 10 && ids.filter((id) => D.items[id].lamp).length >= 5, JSON.stringify(kinds));
  const texts = [...D.cats.flatMap((c) => [c.name, c.say]), ...ids.flatMap((id) => [D.items[id].name, D.items[id].kid]), ...D.presets.flatMap((p) => [p.name, p.say]), ...Object.values(D.styles).flat().flatMap((o) => [o.name, o.say]), ...Object.values(D.palettes).flat().map((p) => p[0])];
  const hanja = texts.filter((t) => HANJA.test(String(t))), empty = texts.filter((t) => !String(t || '').trim());
  check('catalogue: every name and voice line is there, in Hangul (no Hanja)', !hanja.length && !empty.length && texts.length > 350, `${texts.length} texts${hanja.length ? ' · Hanja: ' + hanja.slice(0, 4).join(' ') : ''}`);
  const srcHanja = SRC.filter(([, t]) => HANJA.test(t)).map(([f]) => f);
  check('sources: no Hanja anywhere in the room\'s files, nothing run from text (eval / new Function), no console.error, server data never set as HTML', !srcHanja.length && !/\beval\(|new Function\(/.test(SRC[0][1] + SRC[1][1]) && !/console\.error/.test(SRC[0][1]) && !/innerHTML|insertAdjacentHTML|html:/.test(SRC[0][1]), srcHanja.join(' '));
}
log('— rules (Node)');
{
  const R = D.ROOM, room = D.empty();
  const ok = (it, skip = -1, r = room) => D.check(r, it, skip);
  const why = (it, skip = -1, r = room) => { const x = D.check(r, it, skip); return x.ok ? 'ok' : x.why; };
  check('rules: a thing stands inside the walls — at the pad it is fine, one step further it is outside', why({ i: 'F_SOBAN', x: 6.625, y: 0, z: -5.125, r: 0 }) === 'ok' && why({ i: 'F_SOBAN', x: 6.75, y: 0, z: 0, r: 0 }) === 'out' && why({ i: 'F_SANG', x: 6.125, y: 0, z: 0, r: 3 }) === 'out' && why({ i: 'F_SPACESHIP', x: 0, y: 0, z: 0, r: 0 }) === 'id');
  check('rules: nothing stands in the way to the door (a rug and a hanging thing may be there)', why({ i: 'F_SOBAN', x: 0, y: 0, z: 4, r: 0 }) === 'door' && why({ i: 'F_SOBAN', x: 1.75, y: 0, z: 3, r: 0 }) === 'door' && why({ i: 'F_SOBAN', x: 1.875, y: 0, z: 4, r: 0 }) === 'ok' && why({ i: 'R_HWAMUN', x: 0, y: 0, z: 4, r: 0 }) === 'ok' && why({ i: 'L_CHORONG_H', x: 0, y: 0, z: 4, r: 0 }) === 'ok');
  const fan = (x, z, r, y = 1.6) => ({ i: 'W_FAN', x, y, z, r });
  check('rules: a wall thing hangs on a wall line with that wall\'s turn, inside one bay, between the lowest and the highest height', why(fan(0, -5.5, 0)) === 'ok' && why(fan(0, 0, 0)) === 'wall' && why(fan(0, -5.5, 18)) === 'wall' && why(fan(1.375, -5.5, 0)) === 'post' && why(fan(0, -5.5, 0, 2.45)) === 'wall' && why(fan(0, -5.5, 0, 0.3)) === 'wall' && why(fan(7, 1.375, 18)) === 'window' && why(fan(-7, 1.375, 6)) === 'ok');
  check('rules: nothing hangs over a window or the door; a wall without a window takes it', why(fan(5.625, 5.5, 12)) === 'window' && why(fan(0, 5.5, 12, 1.2)) === 'window' && why(fan(-2.75, 5.5, 12)) === 'ok' && why(fan(7, 1.375, 18), -1, { ...room, style: { ...room.style, win: '0'.repeat(18) } }) === 'ok');
  const withTable = { ...room, items: [{ i: 'F_BANDAJI', x: -3, y: 0, z: -2, r: 0 }] };
  const top = D.items.F_BANDAJI.top[2];
  check('rules: a small thing rests on a table\'s top (its height), not in the air beside it and not inside the table', D.rest(withTable, D.items.J_DANJI, -3, -2, -1).y === top && why({ i: 'J_DANJI', x: -3, y: top, z: -2, r: 0, s: 0 }, -1, withTable) === 'ok' && why({ i: 'J_DANJI', x: -1, y: top, z: -2, r: 0 }, -1, withTable) === 'air' && why({ i: 'J_DANJI', x: -3, y: 0, z: -2, r: 0 }, -1, withTable) === 'hit' && why({ i: 'F_SOBAN', x: -3, y: 0.5, z: 0, r: 0 }, -1, withTable) === 'air');
  check('rules: two things do not overlap — but a rug lies under anything, and a thing does not collide with itself', why({ i: 'F_SOBAN', x: -3, y: 0, z: -2, r: 0 }, -1, withTable) === 'hit' && why({ i: 'R_HWAMUN', x: -3, y: 0, z: -2, r: 0 }, -1, withTable) === 'ok' && why(withTable.items[0], 0, withTable) === 'ok' && why({ i: 'F_SOBAN', x: -3, y: 0, z: -1.25, r: 0 }, -1, withTable) === 'ok');
  // wall geometry round trips
  let rt = true;
  for (const side of D.SIDES) for (const u of [0.5, 2.25, 6.125]) { const s = D.wallSpot(side, u), back = D.wallOf({ x: s.x, z: s.z, r: s.r }); rt = rt && back && back.side === side && Math.abs(back.u - u) < 1e-9; }
  check('rules: a spot on a wall and the wall of a spot agree on all four walls; the default room has its door and windows', rt && D.openings(room.style).S.length === 3 && D.bayKind(room.style, 'S', 2) === 'door' && D.openings(room.style).E.length === 2);
  // sanitize: hostile and broken data
  const hostile = { v: -5, public: 'yes', style: { floor: '<script>', wall: 7, win: 'x'.repeat(18), roof: 'gold', __proto__: { polluted: 1 } }, items: [
    { i: 'F_SOBAN', x: 2, y: 0, z: -1, r: 0, note: '<img onerror=alert(1)>' }, { i: '<svg onload=alert(1)>', x: 0, y: 0, z: 0, r: 0 }, { i: 'F_SOBAN', x: 'NaN', y: 0, z: 0, r: 0 }, { i: 'F_SOBAN', x: Infinity, y: 0, z: 0, r: 0 },
    { i: 'F_SOBAN', x: 900, y: 0, z: 0, r: 0 }, { i: 'F_SOBAN', x: 0, y: 0, z: 4, r: 0 }, { i: 'F_SOBAN', x: 3, y: 0, z: 3, r: 99 }, { i: 'F_SOBAN', x: 3.07, y: 0, z: -3.02, r: 6, s: 2, c: 400 }, null, 'F_SOBAN', [1, 2, 3], { i: 'constructor', x: 0, y: 0, z: 0, r: 0 },
    { i: 'J_DANJI', x: 5, y: 0.81, z: -3, r: 0 }, { i: 'W_FAN', x: 0, y: 9, z: -5.5, r: 0 }, { i: 'W_FAN', x: 2, y: 1.6, z: 2, r: 0 }, { i: 'S_BANGSEOK', x: -2, y: 0, z: 0, r: 23, s: 2, c: 15 },
  ] };
  const clean = D.sanitize(hostile, 200);
  const keysOk = clean.items.every((it) => Object.keys(it).every((k) => ['i', 'x', 'y', 'z', 'r', 's', 'c'].includes(k)) && typeof it.i === 'string' && [it.x, it.y, it.z, it.r].every(Number.isFinite));
  check('sanitize: hostile and broken data becomes a room of known things and numbers only (unknown ids, text, wrong numbers, things outside or before the door are dropped; a small thing in the air comes down)', keysOk && clean.items.length === 4 && clean.v === 0 && clean.public === false && JSON.stringify(clean.style) === JSON.stringify(D.DEFAULT_STYLE) && ({}).polluted === undefined && clean.items.map((it) => it.i).join() === 'F_SOBAN,F_SOBAN,J_DANJI,S_BANGSEOK' && clean.items[1].x === 3.125 && clean.items[1].s === undefined && clean.items[1].c === undefined && clean.items[2].y === 0 && clean.items[3].c === 15, JSON.stringify(clean.items));
  const again = D.sanitize(clean, 200);
  check('sanitize: the same room comes out when it is cleaned again; garbage instead of a room gives an empty room; the limit cuts the list', JSON.stringify(again) === JSON.stringify(clean) && [null, 7, 'room', [], { items: 'x' }].every((g) => D.sanitize(g, 80).items.length === 0) && D.sanitize({ items: Array.from({ length: 500 }, (_, k) => ({ i: 'G_GONGGI', x: -6.5 + (k % 50) * 0.25, y: 0, z: -5 + Math.floor(k / 50) * 0.25, r: 0 })) }, 80).items.length === 80 && D.sanitize({ items: Array.from({ length: 500 }, (_, k) => ({ i: 'G_GONGGI', x: -6.5 + (k % 50) * 0.25, y: 0, z: -5 + Math.floor(k / 50) * 0.25, r: 0 })) }, 100000).items.length === D.LIMITS.hard);
  // the three ready-made rooms
  const bad = [];
  let things = 0;
  for (const p of D.presets) {
    const r0 = D.preset(p.id);
    things += r0.items.length;
    if (r0.items.length !== p.items.length) bad.push(`${p.id}: ${p.items.length - r0.items.length} thing(s) lost in sanitize`);
    r0.items.forEach((it, k) => { const r = D.check(r0, it, k); if (!r.ok) bad.push(`${p.id} #${k} ${it.i} ${r.why}`); });
    if (r0.items.length > D.LIMITS.free || D.bytes(r0) > D.LIMITS.bytes) bad.push(`${p.id}: ${r0.items.length} things, ${D.bytes(r0)} bytes`);
    if (new Set(r0.items.map((it) => D.items[it.i].cat)).size < 6) bad.push(`${p.id}: fewer than six categories`);
  }
  check('ready-made rooms: three of them, every thing allowed where it stands (no overlap, no post, no window, nothing in the air), within the free limit', D.presets.length === 3 && !bad.length && things >= 90, bad.slice(0, 8).join(' · ') || `${things} things`);
  const t = D.serverTable();
  const worst = { v: 99999999, style: D.DEFAULT_STYLE, public: true, items: Array.from({ length: D.LIMITS.hard }, () => ({ i: 'A_SCROLL_OFFICIALS', x: -5.875, y: 1.55, z: -5.375, r: 23, s: 2, c: 15 })) };
  check('server table: every thing as [kind, w, d, h, colours, sizes], the room\'s measures, the limits; the largest room there can be stays under 24 KB', Object.keys(t.items).length === D.order.length && Object.values(t.items).every((r) => r.length === 6 && typeof r[0] === 'string' && r.slice(1).every(Number.isFinite)) && t.room.w === 14 && t.room.d === 11 && t.limits.free === 80 && t.limits.paid === 160 && t.limits.hard === 200 && t.limits.bytes === 24576 && t.styles.winLen === 18 && t.styles.winDoor === 11 && JSON.stringify(worst).length < D.LIMITS.bytes, `${JSON.stringify(t).length} bytes of table · worst room ${JSON.stringify(worst).length} bytes`);
}
// the room itself without a GPU: the real kits, catalogue and room module in Node with three.js (tests/myroom-logic.mjs)
if (!flag('--skip-logic')) { const { roomLogic } = await import('./myroom-logic.mjs'); await roomLogic({ check, log, ROOT }); }
if (flag('--node')) finish();

// =============================================================================================== BROWSER
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); }
catch {
  try { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
  catch { console.error('playwright 가 필요해요 (npm install)'); finish(2); }
}
const TIMEOUT = Number(opt('--timeout', '300000'));
const T_UI = 60000;
const CALL_BUDGET = 200;
const shotDir = opt('--shots');
let file = opt('--file');
let tmpDir = null;
if (!file) {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tfm-myroom-'));
  file = path.join(tmpDir, 'index.html');
  const b = spawnSync(process.execPath, [path.join(ROOT, 'tools/build.mjs'), '--no-font', '--quiet', '--strict', '--no-assets', '--out', file], { encoding: 'utf8' });
  if (b.status !== 0) { console.error(b.stderr || b.stdout); finish(2); }
}
if (!fs.existsSync(file)) { console.error(`page not found: ${file}`); finish(2); }
if (shotDir) fs.mkdirSync(shotDir, { recursive: true });

const browser = await chromium.launch({ headless: !flag('--headed'), args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--autoplay-policy=no-user-gesture-required'] });
const pageErrors = [], consoleErrors = [];
/** a browser context with one page. o.easy === false: the device setting "쉬운 모드 꺼짐" (as tools/smoke.mjs sets it) */
async function open(tag, ctxOpts, o = {}) {
  const context = await browser.newContext({ locale: 'ko-KR', timezoneId: 'Asia/Seoul', ...ctxOpts });
  if (o.easy === false) await context.addInitScript(() => { try { const s = JSON.parse(localStorage.getItem('tfm.v1.settings') || '{}'); s.easyMode = false; s._v = 2; localStorage.setItem('tfm.v1.settings', JSON.stringify(s)); } catch (e) { /* storage blocked */ } });
  const page = await context.newPage();
  page.setDefaultTimeout(90000);   // a click can take 20 s and more while the two browser slots are busy
  await page.route('**/*', (route) => (/^(file|data|blob):/.test(route.request().url()) ? route.continue() : route.abort()));
  page.on('pageerror', (e) => pageErrors.push(`[${tag}] ${String(e?.message || e).slice(0, 300)}`));
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(`[${tag}] ${m.text().slice(0, 300)}`); });
  return { page, context };
}
const tidy = (page) => page.evaluate(() => { try { G.ui.modal.closeAll(); } catch (e) { /* nothing open */ } });
async function boot(page, quality, o = {}) {
  await page.goto(`${pathToFileURL(file).href}?autostart=1&notutorial=1&quality=${quality}`, { waitUntil: 'load', timeout: TIMEOUT });
  await page.waitForFunction(() => window.G && window.G.ready === true && !!window.G.state && !!window.G.sys?.places && !!window.G.sys?.player?._ready && !!window.G.sys?.myroom, null, { timeout: TIMEOUT, polling: 250 });
  // an autostart guest is a new profile in easy mode (03-state: easyMode is a profile key, the device setting does not
  // reach it): the normal-mode parts switch the profile over as a grown-up would
  // (G.easy.set(false) asks the grown-up's gate first: the test sets the profile's setting directly, as the gate would)
  if (o.easy === false) await page.evaluate(() => { G.setSetting('easyMode', false); return G.easy.on; });
  // messages that slide in must not swallow the test's clicks (they are not what is tested here)
  await page.evaluate(() => {
    const root = document.getElementById('toast-root');
    if (!root) return;
    const fix = () => { root.style.pointerEvents = 'none'; for (const el of root.querySelectorAll('*')) el.style.pointerEvents = 'none'; };
    new MutationObserver(fix).observe(root, { childList: true, subtree: true });
    fix();
  });
  await tidy(page);
}
const settled = (page, id, t = T_UI) => page.waitForFunction((id) => { const P = G.sys.places; return P.current === id && !P.busy; }, id, { timeout: t, polling: 150 }).then(() => true, () => false);
const frames = (page, n = 4, ms = 30000) => page.evaluate(async ({ n, ms }) => {
  const info = G.sys.engine?.renderer?.info?.render, f0 = info ? info.frame : 0, t0 = performance.now();
  while (performance.now() - t0 < ms) { await new Promise((r) => requestAnimationFrame(() => r())); if (!info || info.frame - f0 >= n) return true; }
  return false;
}, { n, ms });
const until = (page, fn, arg, t = T_UI) => page.waitForFunction(fn, arg, { timeout: t, polling: 120 }).then(() => true, () => false);
const shot = async (page, name) => { if (!shotDir) return; await frames(page, 3); await page.screenshot({ path: path.join(shotDir, name) }); };
const ev = (page, fn, arg) => page.evaluate(fn, arg);
/** the things of a room written the same way whatever order their keys were made in */
const norm = (items) => JSON.stringify((items || []).map((it) => [it.i, it.x, it.y || 0, it.z, it.r, it.s ?? 1, it.c ?? -1]));
/** the room as the page has it: things, counts, the hand */
const snap = (page) => page.evaluate(() => { const M = G.sys.myroom, r = M.room(); return { st: M.state(), items: r.items, style: r.style, held: M.edit.held, active: M.edit.active, undo: M.edit.undoCount, redo: M.edit.redoCount, hint: document.querySelector('.mr-hint')?.textContent || '' }; });
/** where a point of the room is on the screen */
const at = (page, x, y, z) => page.evaluate(([x, y, z]) => G.sys.myroom.edit.screenOf(x, y, z), [x, y, z]);
/** walk in through the door outside (teleport to the spot in front of it, then use the door) */
async function useDoor(page) {
  const d = await ev(page, () => { const p = G.sys.places.def('PL_MYROOM'); return p && p.door && p.exit ? { exit: p.exit } : null; });
  if (!d) return { act: false, why: 'no door' };
  await ev(page, (e) => { G.sys.player.teleport(e.x, e.z, e.rotY, { fade: false, silent: true }); }, d.exit);
  await page.waitForTimeout(400);
  return { act: !!(await ev(page, () => G.interact.activate('DOOR_PL_MYROOM'))) };
}
async function enterByDoor(page) { const r = await useDoor(page); return { ...r, ok: r.act && await settled(page, 'PL_MYROOM') }; }
/** wait until the view from above stands still (the camera flies in, and a frame can take a second on this machine) */
const steady = (page, ms = 25000) => page.evaluate(async (ms) => {
  const E = G.sys.myroom.edit, t0 = performance.now(), nf = () => new Promise((r) => requestAnimationFrame(() => r()));
  let last = null, same = 0;
  while (performance.now() - t0 < ms) {
    await nf(); await nf();
    const a = E.screenOf(3, 0, -2), b = E.screenOf(-5, 1, 4), now = a && b ? [a.x, a.y, b.x, b.y] : null;
    if (now && last && now.every((v, i) => Math.abs(v - last[i]) < 0.4)) { if (++same >= 2) return true; } else same = 0;
    last = now;
  }
  return false;
}, ms);
const startEdit = async (page) => { const ok = await ev(page, () => G.sys.myroom.edit.start()); await page.waitForTimeout(600); await steady(page); return ok; };
/** one part of the run: what goes wrong in it is one failed check, and the parts after it still run */
async function part(name, fn) { try { await fn(); } catch (e) { check(`${name}: ran to its end`, false, String(e?.stack || e).slice(0, 460)); } }
/** bring the page into the state a part starts from (nothing to do when the part before it went well) */
async function ensure(page, o) {
  await tidy(page);
  let st = await ev(page, () => ({ cur: G.sys.places.current, active: G.sys.myroom.edit.active }));
  if (o.edit === false && st.active) { await ev(page, () => G.sys.myroom.edit.stop({ silent: true })); await page.waitForTimeout(700); }
  if (o.inside === true && st.cur !== 'PL_MYROOM') { await ev(page, () => G.sys.myroom.enter()); await settled(page, 'PL_MYROOM'); await page.waitForTimeout(1200); await tidy(page); }
  if (o.inside === false && st.cur) { await ev(page, () => G.sys.places.exit()); await settled(page, null); }
  if (o.edit === true && !(await ev(page, () => G.sys.myroom.edit.active))) await startEdit(page);
}
const vis = (page, sel) => page.evaluate((sel) => { const el = document.querySelector(sel); if (!el || el.hidden) return null; const r = el.getBoundingClientRect(), cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.display !== 'none' && cs.visibility !== 'hidden' ? { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), r: Math.round(r.right), b: Math.round(r.bottom) } : null; }, sel);
const act = (label) => `.mr-act .mr-btn[aria-label="${label}"]`;

let code = null;
try {
  // ------------------------------------------------------------------------------------------- desktop, medium
  log('— the room and its edit mode (desktop 1280 × 720, medium, mouse, normal mode)');
  const A = await open('desktop', { viewport: { width: 1280, height: 720 } }, { easy: false });
  const page = A.page;
  await boot(page, 'medium', { easy: false });
  let info = null, s = null, p = null;
  await part('the room and its door', async () => {
  info = await ev(page, () => {
    const P = G.sys.places, p = P.def('PL_MYROOM'), d = G.interact.get('DOOR_PL_MYROOM'), M = G.sys.myroom, pl = G.sys.player.position;
    return {
      def: !!p, door: !!d, kid: String((d && d.kidLabel) || ''), radius: d ? Number(d.radius) : 0, st: M.state(), list: P.list().filter((x) => x.id === 'PL_MYROOM').length, easy: G.easy.on, start: { x: pl.x, z: pl.z },
      api: ['can', 'enter', 'doorAt', 'state', 'save', 'refresh', 'explain', 'room', 'stats', 'visit', 'limit'].filter((k) => typeof M[k] !== 'function'),
      editApi: ['start', 'stop', 'pick', 'select', 'next', 'to', 'place', 'cancel', 'turn', 'raise', 'size', 'colour', 'copy', 'remove', 'undo', 'redo', 'preset', 'reset', 'style', 'show', 'view'].filter((k) => typeof M.edit[k] !== 'function'),
    };
  });
  check('the place PL_MYROOM is defined with a door outside (kid words, radius ≥ 3 m) and is on the 집 구경 list; G.sys.myroom has its whole API', info.def && info.door && info.kid.length >= 2 && info.radius >= 3 && info.list === 1 && !info.api.length && !info.editApi.length, JSON.stringify({ kid: info.kid, radius: info.radius, missing: [...info.api, ...info.editApi] }));
  check('local mode: everybody has a 체험용 room kept on this device (can true, limit 80, empty at first)', info.st.can === true && info.st.mode === 'local' && info.st.limit === 80 && info.st.count === 0 && info.st.loaded === true && info.easy === false, JSON.stringify(info.st));
  const inn = await enterByDoor(page);
  check('the door outside lets you in', inn.ok, JSON.stringify(inn));
  await page.waitForTimeout(1500);
  await tidy(page);
  const fab = await vis(page, '#myroom-fab'), chip = await vis(page, '#place-chip .pc-exit');
  check('inside: the button "🎨 방 꾸미기" is there (≥ 44 px) and the way out stays on the place chip', !!fab && fab.h >= 44 && !!chip, JSON.stringify({ fab, chip }));
  await frames(page, 6);
  await shot(page, '01-empty-room.png');
  const calls0 = await ev(page, () => G.sys.engine.frameInfo.calls);
  check(`an empty room is drawn with ≤ ${CALL_BUDGET} draw calls`, calls0 > 0 && calls0 <= CALL_BUDGET, `${calls0} calls`);

  });

  // ---- into the edit mode with the button
  await part('the edit mode opens', async () => {
  await ensure(page, { inside: true, edit: false });
  await page.click('#myroom-fab');
  await until(page, () => G.sys.myroom.edit.active);
  await page.waitForTimeout(600);
  await steady(page);
  const ed = await ev(page, () => ({ active: G.sys.myroom.edit.active, blocking: G.ui.isBlocking(), hud: getComputedStyle(document.getElementById('hud')).display, cam: G.sys.camera.mode, locked: !!document.pointerLockElement, look: !!G.input?.mouseLook?.state?.().locked, cats: document.querySelectorAll('.mr-cat').length, tiles: document.querySelectorAll('.mr-tile').length, inputs: document.querySelectorAll('#myroom-ui input, #myroom-ui textarea, #myroom-ui select, #myroom-ui [contenteditable]').length, done: !!document.querySelector('.mr-done'), fabHidden: document.getElementById('myroom-fab').hidden }));
  check('"방 꾸미기": the edit mode opens — the world\'s keys are blocked, the HUD is away, the pointer is free, the camera looks down into the room', ed.active && ed.blocking && ed.hud === 'none' && ed.cam === 'shot' && !ed.locked && !ed.look && ed.fabHidden, JSON.stringify(ed));
  check('the tray: 13 categories (방 모양 + 12), picture tiles, nothing to type into, and "다 했어요" always there', ed.cats === 13 && ed.tiles >= 5 && ed.inputs === 0 && ed.done, JSON.stringify(ed));
  // the whole floor is in the free part of the screen
  const corners = await ev(page, () => { const E = G.sys.myroom.edit, top = document.querySelector('.mr-top').getBoundingClientRect().bottom, tray = document.querySelector('.mr-tray').getBoundingClientRect().top; return { top, tray, pts: [[-7, 0, -5.5], [7, 0, -5.5], [-7, 0, 5.5], [7, 0, 5.5]].map((p) => E.screenOf(...p)) }; });
  check('the view from above shows the whole floor between the top bar and the tray', corners.pts.every((p) => p.front && p.x >= 0 && p.x <= 1280 && p.y >= corners.top - 4 && p.y <= corners.tray + 4), JSON.stringify({ top: Math.round(corners.top), tray: Math.round(corners.tray), pts: corners.pts.map((p) => [Math.round(p.x), Math.round(p.y)]) }));
  await shot(page, '02-edit-empty.png');

  // ---- a category, its pictures
  await page.click('.mr-cat[data-cat="furn"]');
  await until(page, () => document.querySelectorAll('.mr-tile[data-id]').length >= 15);
  const pics = await until(page, () => document.querySelectorAll('.mr-tile[data-id] canvas.mr-cv').length >= 8, null, 120000);
  const tileInfo = await ev(page, () => ({ n: document.querySelectorAll('.mr-tile[data-id]').length, pics: document.querySelectorAll('.mr-tile[data-id] canvas.mr-cv').length, say: [...document.querySelectorAll('.mr-tile')].every((b) => (b.dataset.say || '').length > 3), thumbs: G.sys.myroom.edit.thumbs() }));
  check('the furniture tray: 20 tiles, each shows the real thing as a small picture (rendered once), each with a voice line', tileInfo.n === 20 && pics && tileInfo.say, JSON.stringify(tileInfo));

  });

  // ---- place with the mouse: a click on a tile, the thing follows the pointer, a click on the floor puts it down
  await part('decorating with the mouse', async () => {
  await ensure(page, { inside: true, edit: true });
  if ((await snap(page)).items.length) { await ev(page, async () => { const E = G.sys.myroom.edit; await E.reset({ force: true }); E.stop({ silent: true }); }); await startEdit(page); }   // (an earlier part left things: start empty, with an empty undo list)
  await ev(page, () => G.sys.myroom.edit.show('furn'));
  await until(page, () => !!document.querySelector('.mr-tile[data-id="F_BANDAJI"]'));
  await steady(page);
  await page.click('.mr-tile[data-id="F_BANDAJI"]');
  const h1 = await ev(page, () => G.sys.myroom.edit.held);
  p = await at(page, -3, 0, -2);
  await page.mouse.move(p.x - 60, p.y - 20); await page.mouse.move(p.x, p.y, { steps: 4 });
  await frames(page, 3);
  const follow = await ev(page, () => ({ held: G.sys.myroom.edit.held, n: G.sys.myroom.room().items.length }));
  await page.mouse.click(p.x, p.y);
  await frames(page, 2);
  s = await snap(page);
  check('mouse: a click on a picture takes the thing, it follows the pointer (not yet in the room), a click on the floor puts it there (on the 0.25 m grid)', h1 && h1.follow && h1.index === -1 && follow.n === 0 && follow.held && Math.abs(follow.held.x + 3) <= 0.26 && s.items.length === 1 && s.items[0].i === 'F_BANDAJI' && Math.abs(s.items[0].x + 3) <= 0.26 && Math.abs(s.items[0].z + 2) <= 0.26 && (s.items[0].x * 4) % 1 === 0 && s.held && s.held.index === 0 && !s.held.follow, JSON.stringify({ h1, follow, item: s.items[0], held: s.held }));
  // ---- move by dragging
  const from = s.items[0];
  p = await at(page, from.x, 0.4, from.z);
  const to = await at(page, 2, 0.4, -3);
  await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.mouse.move((p.x + to.x) / 2, (p.y + to.y) / 2, { steps: 5 }); await page.mouse.move(to.x, to.y, { steps: 5 }); await frames(page, 2); await page.mouse.up();
  await frames(page, 2);
  s = await snap(page);
  check('mouse: dragging a thing moves it (the point it was grabbed at stays under the pointer); one drag is one step to undo', s.items.length === 1 && Math.abs(s.items[0].x - 2) <= 0.5 && Math.abs(s.items[0].z + 3) <= 0.5 && (s.items[0].x !== from.x || s.items[0].z !== from.z) && s.undo === 2, JSON.stringify({ from, now: s.items[0], undo: s.undo }));
  // ---- the buttons of the thing in the hand: turn
  const acts = await ev(page, () => [...document.querySelectorAll('.mr-act .mr-btn')].map((b) => b.getAttribute('aria-label')));
  await page.click(act('오른쪽으로 돌리기'));
  await page.click(act('오른쪽으로 돌리기'));
  await page.click(act('왼쪽으로 돌리기'));
  s = await snap(page);
  check('buttons: 돌리기 turns the thing in 15° steps, both ways; the bar offers turning, colour, one more, remove and put down for a chest', s.items[0].r === 1 && ['왼쪽으로 돌리기', '오른쪽으로 돌리기', '색', '하나 더', '치우기', '놓기'].every((l) => acts.includes(l)) && !acts.includes('위로'), JSON.stringify({ r: s.items[0].r, acts }));
  // ---- colour (the picker of pictures) and copy
  await ev(page, () => G.sys.myroom.edit.turn(-1));
  await page.click(act('색'));
  const picker = await until(page, () => document.querySelectorAll('#modal-root .easy-pick .easy-tile').length === 9);
  await page.click('#modal-root .easy-pick .easy-tile >> nth=3');
  await until(page, () => (G.sys.myroom.room().items[0] || {}).c === 2);
  s = await snap(page);
  check('buttons: 색 opens picture tiles of colours above the editor (its own colours + 8, no typing); the chosen colour is kept', picker && s.items[0].c === 2 && s.held && s.held.index === 0, JSON.stringify(s.items[0]));
  await until(page, () => !document.querySelector('#modal-root .modal'), null, 8000);
  await page.click(act('하나 더'));
  await frames(page, 2);
  s = await snap(page);
  check('buttons: 하나 더 puts a second one beside it — the same thing, turn and colour, on a free spot, and the copy is in the hand', s.items.length === 2 && s.items[1].i === 'F_BANDAJI' && s.items[1].c === 2 && s.items[1].r === s.items[0].r && (s.items[1].x !== s.items[0].x || s.items[1].z !== s.items[0].z) && s.held && s.held.index === 1 && s.held.ok, JSON.stringify(s.items));
  // ---- a small thing onto the table: it follows the pointer onto the table's top
  await ev(page, () => { const E = G.sys.myroom.edit; E.place(); E.show('jar'); });
  await until(page, () => !!document.querySelector('.mr-tile[data-id="J_DANJI"]'));
  await page.click('.mr-tile[data-id="J_DANJI"]');
  const tbl = s.items[0], topY = D.items.F_BANDAJI.top[2];
  p = await at(page, tbl.x, topY, tbl.z);
  await page.mouse.move(p.x, p.y, { steps: 3 }); await frames(page, 3); await page.mouse.click(p.x, p.y); await frames(page, 2);
  s = await snap(page);
  const jar = s.items[2];
  check('a small thing put on a table stands on its top (the height of the table), not inside it', !!jar && jar.i === 'J_DANJI' && Math.abs(jar.y - topY) < 1e-6 && Math.abs(jar.x - tbl.x) <= 0.3 && Math.abs(jar.z - tbl.z) <= 0.3, JSON.stringify({ jar, tbl, topY }));
  // ---- size: 크게 → 작게 → 보통
  await page.click(act('크기'));
  const big = ((await snap(page)).items[2] || {}).s;
  await page.click(act('크기'));
  const small = ((await snap(page)).items[2] || {}).s;
  await page.click(act('크기'));
  s = await snap(page);
  check('buttons: 크기 goes through large → small → normal for a thing that has sizes', big === 2 && small === 0 && s.items[2].s === undefined, JSON.stringify({ big, small, now: s.items[2] }));
  // ---- the table moves: what stands on it comes along
  await ev(page, () => { const E = G.sys.myroom.edit; E.place(); E.select(0); });
  const riders = await ev(page, () => G.sys.myroom.edit.held.riders);
  const movedOk = await ev(page, () => G.sys.myroom.edit.to(-4.5, 1));
  s = await snap(page);
  check('a table that is moved takes along what stands on it', riders === 1 && movedOk === true && s.items[0].x === -4.5 && s.items[0].z === 1 && Math.abs(s.items[2].x + 4.5) <= 0.13 && Math.abs(s.items[2].z - 1) <= 0.13 && Math.abs(s.items[2].y - topY) < 1e-6, JSON.stringify({ riders, table: s.items[0], jar: s.items[2] }));
  // ---- a wall thing: follows the pointer on the far wall, 위로 / 아래로
  await ev(page, () => { const E = G.sys.myroom.edit; E.place(); E.show('wall'); });
  await until(page, () => !!document.querySelector('.mr-tile[data-id="W_FAN"]'));
  await page.click('.mr-tile[data-id="W_FAN"]');
  p = await at(page, 2.75, 1.5, -5.5);
  await page.mouse.move(p.x, p.y, { steps: 3 }); await frames(page, 3); await page.mouse.click(p.x, p.y); await frames(page, 2);
  s = await snap(page);
  const fanIt = s.items[3], wallActs = await ev(page, () => [...document.querySelectorAll('.mr-act .mr-btn')].map((b) => b.getAttribute('aria-label')));
  await page.click(act('위로')); await page.click(act('위로')); await page.click(act('아래로'));
  const s2 = await snap(page);
  check('a wall thing snaps to the wall under the pointer (on the wall line, with the wall\'s turn, at a sensible height); 위로 / 아래로 raise and lower it', !!fanIt && fanIt.i === 'W_FAN' && fanIt.z === -5.5 && fanIt.r === 0 && Math.abs(fanIt.x - 2.75) <= 0.3 && fanIt.y >= 1 && fanIt.y <= 2.2 && wallActs.includes('위로') && wallActs.includes('아래로') && !wallActs.includes('오른쪽으로 돌리기') && Math.abs(s2.items[3].y - (fanIt.y + 0.05)) < 1e-6, JSON.stringify({ fanIt, y2: s2.items[3] && s2.items[3].y, wallActs }));
  // ---- red where it may not stand: the way to the door, another thing, a window — and what letting go does then
  const red = await ev(page, () => {
    const M = G.sys.myroom, E = M.edit, out = {}, hintEl = document.querySelector('.mr-hint');
    E.place();
    out.picked = E.pick('F_SOBAN');                       // no mouse: it stands in the room at once
    out.n = M.room().items.length; out.stood = { ...M.room().items[out.n - 1] };
    out.door = [E.to(0, 4), E.held.ok, E.held.why];
    out.hint = hintEl.textContent; out.bad = hintEl.classList.contains('bad');
    out.hit = [E.to(-4.5, 1), E.held.why];
    out.kept = { ...M.room().items[out.n - 1] };          // the room still has it where it stood
    out.placed = E.place();                               // letting go of a red thing: back where it stood
    out.after = M.room().items.length; out.back = { ...M.room().items[out.n - 1] };
    E.select(out.n - 1);
    out.edge = [E.to(40, 40), E.held.ok, E.held.x, E.held.z];   // never further than the wall
    E.remove();
    // a wall thing: at a post it slides into the bay beside it; over a window it is red and goes back
    E.select(3);
    out.post = [E.to({ side: 'N', u: 2.8, v: 1.5 }), E.held.ok, E.held.x];
    out.window = [E.to({ side: 'E', u: 4.125, v: 1.5 }), E.held.why];
    out.wback = E.place();
    out.fan = { ...M.room().items[3] };
    return out;
  });
  const fanW = D.items.W_FAN.fp[0];
  check('the thing in the hand turns red where it may not stand — before the door, on another thing — with a kind line that says why; the room keeps it where it stood', red.picked === true && red.n === 5 && red.door[0] === false && red.door[1] === false && red.door[2] === 'door' && red.bad && /문 앞/.test(red.hint) && red.hit[1] === 'hit' && norm([red.kept]) === norm([red.stood]), JSON.stringify(red));
  check('letting go of a red thing puts it back where it stood (nothing is lost); pushed past the wall a thing stops at the wall', red.placed === false && red.after === red.n && norm([red.back]) === norm([red.stood]) && red.edge[0] === true && red.edge[1] === true && Math.abs(red.edge[2]) < 7 && Math.abs(red.edge[3]) < 5.5, JSON.stringify({ placed: red.placed, back: red.back, edge: red.edge }));
  check('a wall thing aimed at a post slides into the bay beside it; over a window it is red ("창문") and goes back to where it hung', red.post[0] === true && red.post[1] === true && Math.abs(red.post[2] + 7 - 2.8) >= fanW / 2 - 1e-6 && red.window[0] === false && red.window[1] === 'window' && red.wback === false && red.fan.z === -5.5 && red.fan.x === red.post[2], JSON.stringify({ post: red.post, window: red.window, fan: red.fan }));
  // ---- remove, undo, redo
  const before = (await snap(page)).items;
  await ev(page, () => G.sys.myroom.edit.select(0));
  await page.click(act('치우기'));
  s = await snap(page);
  const afterDel = s.items.map((it) => it.i);
  await page.click('.mr-undo'); const u1 = (await snap(page)).items;
  await page.click('.mr-redo'); const r1 = (await snap(page)).items.map((it) => it.i);
  await page.click('.mr-undo');
  const stack = (await snap(page)).undo;
  for (let k = 0; k < 30; k++) await ev(page, () => G.sys.myroom.edit.undo());
  const zero = await snap(page);
  for (let k = 0; k < 30; k++) await ev(page, () => G.sys.myroom.edit.redo());
  const redone = await snap(page);
  await page.click('.mr-undo');                             // (the last step done again was the 치우기: one back is the room with its table)
  const full = await snap(page);
  check('치우기 removes the thing in the hand and what stands on it; ↩️ brings both back, ↪️ removes them again', afterDel.join() === 'F_BANDAJI,W_FAN' && norm(u1) === norm(before) && r1.join() === 'F_BANDAJI,W_FAN', JSON.stringify({ afterDel, u1: u1.length }));
  check('the last 20 steps can be undone one by one, and every one of them done again: the room comes back thing for thing', stack === 19 && zero.undo === 0 && zero.redo === 20 && zero.items.length < before.length && redone.items.map((it) => it.i).join() === 'F_BANDAJI,W_FAN' && redone.redo === 0 && norm(full.items) === norm(before), JSON.stringify({ stack, zero: zero.items.length, redo: zero.redo, redone: redone.items.length, full: full.items.length }));
  await shot(page, '03-edit-things.png');

  // ---- the limit of things
  const lim = await ev(page, () => {
    const M = G.sys.myroom, E = M.edit, had = G.sys.entitle, prev = had && had.limit;
    const stub = (k) => (k === 'roomItems' ? 5 : (prev ? prev.call(had, k) : undefined));
    if (had) had.limit = stub; else G.sys.entitle = { has: () => true, limit: stub };
    const out = { limit: M.limit(), n0: M.room().items.length };
    E.place(); out.fifth = E.pick('G_GONGGI'); E.place(); out.n1 = M.room().items.length;
    out.sixth = E.pick('G_GONGGI'); out.n2 = M.room().items.length; out.hint = document.querySelector('.mr-hint').textContent; out.count = document.querySelector('.mr-count').textContent; out.full = document.querySelector('.mr-count').classList.contains('full');
    out.copy = (E.select(0), E.copy()); out.n3 = M.room().items.length;
    if (had) had.limit = prev; else delete G.sys.entitle;
    out.back = M.limit(); E.place(); E.select(4); E.remove(); out.n4 = M.room().items.length;
    return out;
  });
  check('the limit: when the room is full a new thing and a copy are refused with a kind line, and the counter says so (5 / 5)', lim.limit === 5 && lim.n0 === 4 && lim.fifth === true && lim.n1 === 5 && lim.sixth === false && lim.n2 === 5 && lim.copy === false && lim.n3 === 5 && /가득/.test(lim.hint) && /5 \/ 5/.test(lim.count) && lim.full && lim.back === 80 && lim.n4 === 4, JSON.stringify(lim));

  });

  // ---- the keyboard alone
  log('— the keyboard alone');
  await part('the keyboard alone', async () => {
  await ensure(page, { inside: true, edit: true });
  await ev(page, () => { G.sys.myroom.edit.place(); G.sys.myroom.edit.show('seat'); document.activeElement?.blur?.(); });
  await page.mouse.move(640, 300);
  const n0 = (await snap(page)).items.length;
  await page.keyboard.press('KeyT');
  const focus1 = await ev(page, () => document.activeElement?.dataset?.id || '');
  await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowLeft');
  const focus2 = await ev(page, () => document.activeElement?.dataset?.id || '');
  await page.keyboard.press('Enter');
  await frames(page, 2);
  const k = await snap(page);
  const placed = k.items[n0];
  await ev(page, () => document.activeElement?.blur?.());
  await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowUp');
  const moved = (await snap(page)).items[n0];
  await page.keyboard.press('KeyR'); await page.keyboard.press('KeyR'); await page.keyboard.press('Shift+KeyR');
  const turned = (await snap(page)).items[n0];
  await page.keyboard.press('Enter');
  const loose = await snap(page);
  await page.keyboard.press('KeyN');
  const first = (await snap(page)).held;
  await page.keyboard.press('Shift+KeyN');
  const last = (await snap(page)).held;
  await page.keyboard.press('Delete');
  const gone = await snap(page);
  await page.keyboard.press('KeyZ');
  const back = await snap(page);
  await page.keyboard.press('KeyY');
  check('keys: T goes to the tray, the arrows walk the tiles, Enter takes the picture — the thing stands in the room at once (no pointer needed)', focus1 === 'S_BANGSEOK' && focus2 === 'S_BANGSEOK_L' && k.items.length === n0 + 1 && placed && placed.i === 'S_BANGSEOK_L' && k.held && k.held.index === n0 && k.held.ok, JSON.stringify({ focus1, focus2, placed, held: k.held }));
  check('keys: the arrows move the thing in the hand one grid step (right, right, away), R / Shift+R turn it, Enter lets go', placed && moved && Math.abs(moved.x - (placed.x + 0.5)) < 1e-6 && Math.abs(moved.z - (placed.z - 0.25)) < 1e-6 && turned.r === (placed.r + 1) % 24 && loose.held === null, JSON.stringify({ placed, moved, r: turned && turned.r, held: loose.held }));
  check('keys: N / Shift+N take the next / the last thing of the room, Delete removes it, Z undoes and Y redoes', first && first.index === 0 && last && last.index === n0 && gone.items.length === n0 && back.items.length === n0 + 1, JSON.stringify({ first: first && first.index, last: last && last.index, gone: gone.items.length, back: back.items.length }));
  const zoom0 = await ev(page, () => G.sys.myroom.edit.view().dist);
  const ls0 = await ev(page, () => JSON.stringify([G.settings.lookSpeed, G.settings.turnSpeed, G.settings.mouseSens]));
  await page.keyboard.press('Equal'); await page.keyboard.press('Equal');
  const zoom1 = await ev(page, () => G.sys.myroom.edit.view().dist);
  await page.keyboard.press('KeyE');
  const yaw1 = await ev(page, () => G.sys.myroom.edit.view().yaw);
  await page.keyboard.press('KeyQ'); await page.keyboard.press('Digit0');
  const view2 = await ev(page, () => ({ v: G.sys.myroom.edit.view(), ls: JSON.stringify([G.settings.lookSpeed, G.settings.turnSpeed, G.settings.mouseSens]) }));
  check('keys: + / − zoom the view (they do not change the turning speed while decorating), E / Q turn the view a quarter, 0 shows the whole room again', zoom1 < zoom0 && Math.abs(Math.abs(yaw1) - Math.PI / 2) < 1e-6 && ls0 === view2.ls && Math.abs(view2.v.yaw) < 1e-6 && Math.abs(view2.v.dist - zoom0) < 1e-6, JSON.stringify({ zoom0, zoom1, yaw1, ls0, view2 }));
  await page.keyboard.press('Escape');
  if (await ev(page, () => G.sys.myroom.edit.active)) await page.keyboard.press('Escape');   // (the first one lets go of a thing in the hand)
  const esc = await until(page, () => !G.sys.myroom.edit.active, null, 8000);
  const afterEsc = await ev(page, () => ({ blocking: G.ui.isBlocking(), blockers: [...(G.ui.blockers || [])].join(' '), hud: getComputedStyle(document.getElementById('hud')).display, cam: G.sys.camera.mode, cur: G.sys.places.current, fab: !document.getElementById('myroom-fab').hidden }));
  check('keys: Escape leaves the edit mode — the HUD, the keys of the world and the button "방 꾸미기" are back, the player is still in the room', esc && !afterEsc.blocking && afterEsc.hud !== 'none' && afterEsc.cam !== 'shot' && afterEsc.cur === 'PL_MYROOM' && afterEsc.fab, JSON.stringify(afterEsc));
  await page.keyboard.press('KeyB');
  const viaB = await until(page, () => G.sys.myroom.edit.active, null, 8000);
  check('keys: B opens the edit mode again', viaB);

  });

  // ---- ready-made rooms, style, reset
  log('— ready-made rooms, the look of the room');
  await part('ready-made rooms and the look of the room', async () => {
  await ensure(page, { inside: true, edit: true });
  await ev(page, () => G.sys.myroom.edit.show('room'));
  const roomTiles = await ev(page, () => [...document.querySelectorAll('.mr-tile')].map((b) => b.dataset.do));
  check('the tab 방 모양: three ready-made rooms, floor, wall, posts, light, windows and 처음으로', ['preset:seonbi', 'preset:anbang', 'preset:janchi', 'style:floor', 'style:wall', 'style:wood', 'style:mood', 'style:win', 'reset'].every((x) => roomTiles.includes(x)), roomTiles.join(' '));
  await page.click('.mr-tile[data-do="preset:anbang"]');
  const asked = await until(page, () => !!document.querySelector('#modal-root .easy-btn-yes'), null, 8000);
  const askText = await ev(page, () => (document.querySelector('#modal-root .easy-confirm')?.textContent || '').replace(/\s+/g, ' ').slice(0, 160));
  await page.click('#modal-root .easy-btn-yes');
  const pre = await until(page, (n) => G.sys.myroom.room().items.length === n && G.sys.myroom.stats().items === n, D.preset('anbang').items.length, 30000);
  await page.waitForTimeout(900); await frames(page, 4);
  s = await snap(page);
  check('a ready-made room asks first (the room is not empty), then replaces the things and the look; one ↩️ would bring the old room back', asked && /바꿀래요/.test(askText) && pre && s.style.wall === 'clay' && s.style.mood === 'warm' && s.undo >= 1, JSON.stringify({ asked, askText, n: s.items.length, style: s.style }));
  await shot(page, '04-preset-anbang-edit.png');
  for (const id of ['seonbi', 'janchi']) {
    const okP = await ev(page, (id) => G.sys.myroom.edit.preset(id, { force: true }), id);
    await page.waitForTimeout(700); await frames(page, 4);
    s = await snap(page);
    const built = await ev(page, () => G.sys.myroom.stats().items);
    check(`ready-made room ${id}: every thing is there and the room is drawn`, okP === true && s.items.length === D.preset(id).items.length && built === s.items.length && JSON.stringify(s.style) === JSON.stringify(D.preset(id).style), `${s.items.length} things`);
    await shot(page, `05-preset-${id}-edit.png`);
  }
  // style: a pick of pictures; windows: the plan of bays
  await page.click('.mr-tile[data-do="style:floor"]');
  const stylePick = await until(page, () => document.querySelectorAll('#modal-root .easy-pick .easy-tile').length === 4, null, 8000);
  await page.click('#modal-root .easy-pick .easy-tile:has-text("박석")');
  const stone = await until(page, () => G.sys.myroom.room().style.floor === 'stone', null, 15000);
  await until(page, () => !document.querySelector('#modal-root .modal'), null, 8000);
  await page.waitForTimeout(700);
  const win0 = (await snap(page)).style.win;
  await page.click('.mr-tile[data-do="style:win"]');
  const plan = await until(page, () => document.querySelectorAll('#modal-root .mr-wplan .mr-wcell').length === 18, null, 8000);
  const cells = await ev(page, () => { const c = [...document.querySelectorAll('.mr-wplan .mr-wcell')]; return { disabled: c.filter((b) => b.disabled).length, min: Math.min(...c.map((b) => Math.min(b.getBoundingClientRect().width, b.getBoundingClientRect().height))), first: c[0].getAttribute('aria-label') }; });
  // the far wall's first bay twice (→ two kinds on), its third bay once
  await page.click('.mr-wplan .mr-wcell >> nth=0'); await page.click('.mr-wplan .mr-wcell >> nth=0'); await page.click('.mr-wplan .mr-wcell >> nth=2');
  await page.click('#modal-root button:has-text("이렇게 할래요")');
  const wantWin = String((Number(win0[0]) + 2) % 7) + win0[1] + String((Number(win0[2]) + 1) % 7) + win0.slice(3);
  const win = await until(page, (w) => G.sys.myroom.room().style.win === w, wantWin, 15000);
  await page.waitForTimeout(900); await frames(page, 4);
  s = await snap(page);
  check('the look of the room: 바닥 is chosen from pictures; 창문 is a plan of 18 bays (the door\'s bay is fixed, every cell ≥ 56 px) and each press turns a bay into the next kind of window', stylePick && stone && plan && cells.disabled === 1 && cells.min >= 56 && /뒤쪽 벽 1번째 칸/.test(cells.first) && win && s.style.floor === 'stone', JSON.stringify({ cells, win0, wantWin, win: s.style.win }));
  // a wall thing over a new window is taken down
  const taken = await ev(page, async () => { const M = G.sys.myroom, E = M.edit; await E.preset('seonbi', { force: true }); const n = M.room().items.length, north = M.room().items.filter((it) => it.z === -5.5).length; await E.style({ win: '666660660100010000' }); const r = M.room(); return { n, north, now: r.items.length, left: r.items.filter((it) => it.z === -5.5).length, hint: document.querySelector('.mr-hint').textContent }; });
  check('a wall that becomes windows gives up what hung there (and says that ↩️ brings it back)', taken.north >= 1 && taken.now === taken.n - taken.north && taken.left === 0 && /창문/.test(taken.hint) && /되돌릴/.test(taken.hint), JSON.stringify(taken));
  await ev(page, () => G.sys.myroom.edit.undo());
  await until(page, (n) => G.sys.myroom.room().items.length === n, taken.n, 15000);
  await page.waitForTimeout(600);
  await page.click('.mr-tile[data-do="reset"]');
  await until(page, () => !!document.querySelector('#modal-root .easy-btn-yes'), null, 8000);
  await page.click('#modal-root .easy-btn-yes');
  const empty = await until(page, () => G.sys.myroom.room().items.length === 0, null, 15000);
  const emptyStyle = (await snap(page)).style;
  await page.waitForTimeout(600);
  await ev(page, () => G.sys.myroom.edit.undo());
  await until(page, (n) => G.sys.myroom.room().items.length === n, taken.n, 15000);
  s = await snap(page);
  check('처음으로 asks, then empties the room and gives it its first look; ↩️ undoes even that', empty && JSON.stringify(emptyStyle) === JSON.stringify(D.DEFAULT_STYLE) && s.items.length === D.preset('seonbi').items.length, `${s.items.length} things after undo`);

  });

  // ---- out of the edit mode: draw calls, walking, solid things, saved, reload
  log('— walking in the decorated room, save and reload');
  await part('walking, save and reload', async () => {
  await ensure(page, { inside: true, edit: true });
  await ev(page, () => G.sys.myroom.edit.preset('janchi', { force: true }));
  await page.waitForTimeout(600);
  await page.click('.mr-done');
  await until(page, () => !G.sys.myroom.edit.active);
  await page.waitForTimeout(1500); await frames(page, 6);
  const walk = await ev(page, () => {
    const M = G.sys.myroom, E = G.sys.engine, pl = G.sys.player, d = G.sys.places.def('PL_MYROOM'), W = G.world, DD = G.data.myroom;
    const hit = (x, z) => { try { return !!W.resolve({ x: d.origin.x + x, y: d.floorY, z: d.origin.z + z }, 0.3, d.floorY); } catch (e) { return String(e.message || e); } };
    const tall = M.room().items.find((it) => { const e = DD.items[it.i]; return e.place === 'F' && e.fp[2] > 0.7 && e.fp[0] >= 0.5 && e.fp[1] >= 0.3; });
    return { calls: E.frameInfo.calls, tris: E.frameInfo.triangles, stats: M.stats(), x: +(pl.position.x - d.origin.x).toFixed(2), z: +(pl.position.z - d.origin.z).toFixed(2), st: M.state(), tall: tall ? tall.i : '', solid: tall ? hit(tall.x, tall.z) : null, free: hit(0, 4), colliders: (G.sys.places.built().find((b) => b.id === 'PL_MYROOM') || {}).colliders };
  });
  check(`a decorated room (${walk.stats.items} things) is drawn with ≤ ${CALL_BUDGET} draw calls — one batch per material, whatever the number of things`, walk.calls > 0 && walk.calls <= CALL_BUDGET && walk.stats.items === D.preset('janchi').items.length, JSON.stringify({ calls: walk.calls, tris: walk.tris, stats: walk.stats }));
  check('after decorating the player stands by the door, in the way that is kept clear (never inside a thing); furniture is solid, the way to the door is free', Math.abs(walk.x) <= 1.6 && walk.z >= 3.1 && walk.z <= 5.5 && walk.solid === true && walk.free === false, JSON.stringify({ x: walk.x, z: walk.z, tall: walk.tall, solid: walk.solid, free: walk.free, colliders: walk.colliders }));
  await shot(page, '06-decorated-walk.png');
  // saved in the device's save; a reload shows the same room
  const want = await ev(page, async () => { await G.save.save({ reason: 'test' }); return G.sys.myroom.room(); });
  await ev(page, () => G.sys.places.exit());
  await settled(page, null);
  const outside = await ev(page, () => { const pl = G.sys.player, d = G.sys.places.def('PL_MYROOM'); return { cur: G.sys.places.current, near: +Math.hypot(pl.position.x - d.exit.x, pl.position.z - d.exit.z).toFixed(1) }; });
  check('🚪 밖으로 leads back to the door outside', outside.cur === null && outside.near <= 4, JSON.stringify(outside));
  await ev(page, () => G.save.save({ reason: 'test' }));
  await boot(page, 'medium', { easy: false });
  const re = await ev(page, () => ({ room: G.sys.myroom.room(), st: G.sys.myroom.state() }));
  check('save → reload: the same room is there, thing for thing, with its look', norm(re.room.items) === norm(want.items) && JSON.stringify(re.room.style) === JSON.stringify(want.style) && re.st.count === D.preset('janchi').items.length, `${re.st.count} things, v ${re.st.v}`);
  const again = await ev(page, () => G.sys.myroom.enter());
  await settled(page, 'PL_MYROOM');
  await page.waitForTimeout(1200); await frames(page, 4);
  const built = await ev(page, () => G.sys.myroom.stats());
  check('G.sys.myroom.enter() goes in directly; the room is built from the save', again === true && built.items === D.preset('janchi').items.length, JSON.stringify(built));
  await ev(page, () => G.sys.places.exit());
  await settled(page, null);

  });

  // ---- a door for other fragments
  await part('a door for other fragments', async () => {
  await ensure(page, { inside: false, edit: false });
  const da = await ev(page, async (start) => {
    const M = G.sys.myroom, P = G.sys.places, pl = G.sys.player, d = P.def('PL_MYROOM'), out = {};
    const wait = async (fn, n = 300) => { for (let i = 0; i < n && !fn(); i++) await new Promise((r) => setTimeout(r, 100)); return !!fn(); };
    out.far = +Math.hypot(start.x - d.exit.x, start.z - d.exit.z).toFixed(1);
    const h = M.doorAt({ x: start.x, z: start.z - 1.4, rotY: 0, id: 'MYROOM_TEST_DOOR' });   // one step in front of it: where the player first stood
    out.handle = !!h && !!G.interact.get('MYROOM_TEST_DOOR');
    out.bad = M.doorAt({ x: 'a', z: 1 }) === null && M.doorAt(null) === null;
    G.interact.get('MYROOM_TEST_DOOR').onInteract();
    out.inside = (await wait(() => P.current === 'PL_MYROOM' && !P.busy)) ? P.current : null;
    await P.exit();
    await wait(() => !P.current && !P.busy);
    out.back = +Math.hypot(pl.position.x - start.x, pl.position.z - start.z).toFixed(1);
    out.hanok = +Math.hypot(pl.position.x - d.exit.x, pl.position.z - d.exit.z).toFixed(1);
    try { h.unregister(); } catch (e) { /* the page is closed soon */ }
    return out;
  }, info.start);
  check('doorAt(): another fragment can put a door to "내 방" anywhere; leaving the room leads back to that door, not to the hanok', da.handle && da.bad && da.inside === 'PL_MYROOM' && da.back <= 3 && (da.far < 8 || da.hanok > 4), JSON.stringify(da));

  });

  // ------------------------------------------------------------------------------------------- a server account (faked api/room/*)
  log('— a server account (api/room/* faked)');
  await part('a server account', async () => {
  await ensure(page, { inside: false, edit: false });
  const srv = (page, patch) => ev(page, (patch) => { Object.assign(window.__room, patch); return true; }, patch);
  await ev(page, () => {
    const orig = G.net.request, real = orig.bind(G.net);
    window.__room = { orig, can: false, limit: 80, room: { v: 0, style: {}, items: [], public: false }, calls: [], offline: 0, gets: 0, loseAnswer: false };
    G.net.request = async (path, o = {}) => {
      if (!/api\/room\//.test(path)) return real(path, o);
      const S = window.__room;
      S.calls.push({ path: path.replace(/^.*api\/room\//, ''), body: o.body ? JSON.parse(JSON.stringify(o.body)) : null });
      if (/get\.php/.test(path)) { S.gets++; return { room: JSON.parse(JSON.stringify(S.room)), mine: true, can: S.can, limit: S.can ? S.limit : 0 }; }
      if (S.offline > 0) { S.offline--; throw Object.assign(new Error('offline'), { code: 'NETWORK_ERROR' }); }
      if (!S.can) throw Object.assign(new Error('no room'), { code: 'ROOM_FORBIDDEN', status: 403 });
      if (o.body.v !== S.room.v) throw Object.assign(new Error('stale'), { code: 'ROOM_STALE', status: 409, data: { v: S.room.v } });
      S.room = { v: S.room.v + 1, style: o.body.style, items: o.body.items, public: !!o.body.public };
      if (S.loseAnswer) { S.loseAnswer = false; throw Object.assign(new Error('timeout'), { code: 'TIMEOUT' }); }
      return { v: S.room.v };
    };
    try { for (const k of Object.keys(localStorage)) if (k.indexOf('tfm.v1.myroomDraft.') === 0) localStorage.removeItem(k); } catch (e) { /* no storage */ }
    G.sys.myroom._server = true;
    G.sys.myroom.onStateLoaded();
  });
  try {
  const st0 = await ev(page, () => G.sys.myroom.state());
  check('server mode: until the server has been asked the room is not known (loaded false) — nothing is assumed', st0.mode === 'server' && st0.loaded === false && st0.can !== true && st0.count === 0, JSON.stringify(st0));
  // no right → the kind card, never a silent "no"
  const d2 = await useDoor(page);
  const card = await until(page, () => !!document.querySelector('#modal-root .mr-explain'), null, 20000);
  const cardInfo = await ev(page, () => { const m = document.querySelector('#modal-root .mr-explain'); return { text: m ? m.textContent.replace(/\s+/g, ' ').slice(0, 220) : '', btns: m ? [...m.querySelectorAll('button')].map((b) => b.textContent.trim()) : [], cur: G.sys.places.current, busy: !!G.sys.places.busy, gets: window.__room.gets, can: G.sys.myroom.can(), inputs: m ? m.querySelectorAll('input, textarea, a[href^="http"]').length : -1 }; });
  check('an account without a room: the door asks the server, stays shut and shows a kind card — what the room is, who gets one — with a ready-made room to look at (no typing, no link out)', d2.act && card && cardInfo.cur === null && cardInfo.gets === 1 && cardInfo.can === false && /분양/.test(cardInfo.text) && cardInfo.btns.some((b) => /구경하기/.test(b)) && cardInfo.btns.some((b) => /닫기/.test(b)) && cardInfo.inputs === 0, JSON.stringify(cardInfo));
  await page.click('#modal-root .mr-explain button:has-text("구경하기")');
  const visiting = await settled(page, 'PL_MYROOM');
  await page.waitForTimeout(1200); await frames(page, 4);
  const vi = await ev(page, () => ({ st: G.sys.myroom.state(), stats: G.sys.myroom.stats(), fab: document.getElementById('myroom-fab').hidden, edit: G.sys.myroom.edit.start(), active: G.sys.myroom.edit.active, chip: !!document.querySelector('#place-chip .pc-exit'), saves: window.__room.calls.filter((c) => /save/.test(c.path)).length }));
  check('구경하기: a ready-made room to walk through — nothing can be changed there (no button, the edit mode stays shut, nothing is saved) and the way out is on the chip', visiting && vi.st.visiting && vi.stats.items === D.preset('anbang').items.length && vi.fab === true && vi.edit === false && vi.active === false && vi.chip && vi.saves === 0, JSON.stringify({ st: vi.st, items: vi.stats.items, edit: vi.edit }));
  await shot(page, '07-visit-sample.png');
  await ev(page, () => { try { G.ui.modal.closeAll(); } catch (e) { /* none */ } return G.sys.places.exit(); });
  await settled(page, null);
  // with the right: the server's room, its limit, a save with the version
  const serverRoom = D.sanitize({ v: 3, style: D.DEFAULT_STYLE, items: [{ i: 'F_SOBAN', x: 2, y: 0, z: -1, r: 0 }, { i: 'W_FAN', x: 0, y: 1.6, z: -5.5, r: 0, c: 4 }], public: false }, 200);
  await srv(page, { can: true, limit: 160, room: serverRoom, calls: [], gets: 0 });
  await ev(page, () => { G.sys.myroom.onStateLoaded(); });
  const entered = await ev(page, () => G.sys.myroom.enter());
  await settled(page, 'PL_MYROOM');
  await page.waitForTimeout(1000);
  const sv = await ev(page, () => ({ st: G.sys.myroom.state(), items: G.sys.myroom.room().items.length, stats: G.sys.myroom.stats(), local: G.state.myroom.items.length, fab: !document.getElementById('myroom-fab').hidden, gets: window.__room.gets }));
  check('an account with a room: the server\'s room is shown (its things, its version, its limit 160) — the device\'s own 체험용 room is left alone', entered === true && sv.st.can === true && sv.st.limit === 160 && sv.st.v === 3 && sv.items === 2 && sv.stats.items === 2 && sv.local === D.preset('janchi').items.length && sv.fab && sv.gets === 1, JSON.stringify(sv));
  await startEdit(page);
  await ev(page, () => { const E = G.sys.myroom.edit; E.pick('J_DANJI'); E.place(); });
  const chipSaving = await ev(page, () => document.querySelector('.mr-save').textContent);
  const saved = await ev(page, async () => { const ok = await G.sys.myroom.save(); const S = window.__room, last = S.calls.filter((c) => /save/.test(c.path)).pop(); return { ok, v: G.sys.myroom.state().v, sent: last && { v: last.body.v, n: last.body.items.length, keys: Object.keys(last.body).sort().join(), itemKeys: [...new Set(last.body.items.flatMap((it) => Object.keys(it)))].sort().join() }, stored: S.room.items.length, save: G.sys.myroom.state().save, dirty: G.sys.myroom.state().dirty, chip: document.querySelector('.mr-save').textContent }; });
  check('a change is sent to api/room/save.php with the version it was made from; the answer\'s version is kept (v 3 → 4) and the body is ids and numbers only; the chip goes from "저장 중" to "저장됨"', saved.ok === true && saved.v === 4 && saved.sent && saved.sent.v === 3 && saved.sent.n === 3 && saved.sent.keys === 'items,public,style,v' && saved.sent.itemKeys === 'c,i,r,x,y,z' && saved.stored === 3 && saved.save === 'ok' && !saved.dirty && /저장 중/.test(chipSaving) && /저장됨/.test(saved.chip), JSON.stringify({ ...saved, chipSaving }));
  // the network is away: the room waits as a draft and is sent later
  await srv(page, { offline: 1 });
  const off = await ev(page, async () => { const E = G.sys.myroom.edit; E.pick('G_GONGGI'); E.place(); const ok = await G.sys.myroom.save(); const st = G.sys.myroom.state(); const draft = Object.keys(localStorage).filter((k) => k.indexOf('tfm.v1.myroomDraft.') === 0).map((k) => JSON.parse(localStorage.getItem(k))); return { ok, save: st.save, dirty: st.dirty, draft: draft.length ? { base: draft[0].base, n: draft[0].room.items.length } : null, chip: document.querySelector('.mr-save').textContent }; });
  const later = await ev(page, async () => { const ok = await G.sys.myroom.save(); return { ok, v: G.sys.myroom.state().v, stored: window.__room.room.items.length, drafts: Object.keys(localStorage).filter((k) => k.indexOf('tfm.v1.myroomDraft.') === 0).length, save: G.sys.myroom.state().save }; });
  check('no network: the save fails quietly, the room waits as a draft on this device ("조금 뒤에 저장") — and is sent when the network is back', off.ok === false && off.save === 'wait' && off.dirty === true && off.draft && off.draft.base === 4 && off.draft.n === 4 && /뒤에 저장/.test(off.chip) && later.ok === true && later.v === 5 && later.stored === 4 && later.drafts === 0 && later.save === 'ok', JSON.stringify({ off, later }));
  // the answer of a save is lost: the server has it already — nothing is thrown away, nothing is asked of the child
  await srv(page, { loseAnswer: true });
  const lost = await ev(page, async () => { const E = G.sys.myroom.edit; E.pick('G_JEGI'); E.place(); const a = await G.sys.myroom.save(); const b = await G.sys.myroom.save(); const st = G.sys.myroom.state(); return { a, b, v: st.v, n: G.sys.myroom.room().items.length, stored: window.__room.room.items.length, sv: window.__room.room.v, save: st.save, active: G.sys.myroom.edit.active, undo: G.sys.myroom.edit.undoCount }; });
  check('a save whose answer is lost: the next try finds the newer version on the server, sees it is its own room and goes on from there (nothing lost, no question, the undo list stays)', lost.a === false && lost.b === true && lost.n === 5 && lost.stored === 5 && lost.v === lost.sv && lost.save === 'ok' && lost.active && lost.undo >= 3, JSON.stringify(lost));
  // the room was changed on another device: that room is the room now
  const other = D.sanitize({ v: 0, style: { ...D.DEFAULT_STYLE, floor: 'maru' }, items: [{ i: 'F_SANG', x: -2, y: 0, z: -2, r: 0 }], public: false }, 200);
  const stale = await ev(page, async (other) => { const S = window.__room; S.room = { ...other, v: S.room.v + 3 }; const E = G.sys.myroom.edit; E.pick('G_TOP'); E.place(); const ok = await G.sys.myroom.save(); await new Promise((r) => setTimeout(r, 900)); const r = G.sys.myroom.room(); return { ok, v: G.sys.myroom.state().v, sv: S.room.v, items: r.items.map((it) => it.i).join(), built: G.sys.myroom.stats().items, floor: r.style.floor, undo: G.sys.myroom.edit.undoCount, active: G.sys.myroom.edit.active, save: G.sys.myroom.state().save, toast: [...document.querySelectorAll('#toast-root *')].some((el) => /바뀌어서|바꾸어서/.test(el.textContent)) }; }, other);
  check('the room was changed somewhere else: the save is refused (409), the newer room is read and shown, the undo list starts afresh, the chip says "저장됨" and a line says what happened', stale.ok === false && stale.v === stale.sv && stale.items === 'F_SANG' && stale.built === 1 && stale.floor === 'maru' && stale.undo === 0 && stale.save === 'ok' && stale.toast, JSON.stringify(stale));
  // the right is taken away while decorating
  await srv(page, { can: false });
  const revoked = await ev(page, async () => { const E = G.sys.myroom.edit; E.pick('G_TOP'); E.place(); const ok = await G.sys.myroom.save(); return { ok, active: G.sys.myroom.edit.active, can: G.sys.myroom.can(), blocking: G.ui.isBlocking(), fab: document.getElementById('myroom-fab').hidden }; });
  check('the right is taken back while decorating: the save is refused, the edit mode closes by itself, the button goes and nothing stays blocked', revoked.ok === false && revoked.active === false && revoked.can === false && revoked.blocking === false && revoked.fab === true, JSON.stringify(revoked));
  } finally {
    // whatever happened above: the page is a local one again
    await ev(page, async () => { try { G.ui.modal.closeAll(); } catch (e) { /* none */ } try { if (G.sys.myroom.edit.active) G.sys.myroom.edit.stop({ silent: true }); } catch (e) { /* closed */ } try { await G.sys.places.exit(); } catch (e) { /* outside */ } G.sys.myroom._server = null; if (window.__room && window.__room.orig) G.net.request = window.__room.orig; G.sys.myroom.onStateLoaded(); }).catch(() => {});
    await settled(page, null);
  }
  const backLocal = await ev(page, () => ({ st: G.sys.myroom.state(), n: G.sys.myroom.room().items.length }));
  check('back in local mode the device\'s own room is untouched', backLocal.st.mode === 'local' && backLocal.st.can === true && backLocal.n === D.preset('janchi').items.length, JSON.stringify(backLocal.st));

  });

  // ------------------------------------------------------------------------------------------- easy mode
  log('— easy mode (쉬운 모드)');
  await part('easy mode', async () => {
  await ensure(page, { inside: false, edit: false });
  await ev(page, () => Promise.race([G.easy.set(true), new Promise((r) => setTimeout(r, 1500))]));
  await page.waitForTimeout(600);
  const easyOn = await ev(page, () => G.easy.on === true && document.body.classList.contains('easy'));
  await ev(page, () => G.sys.myroom.enter());
  await settled(page, 'PL_MYROOM');
  await page.waitForTimeout(1500); await tidy(page);
  const fabE = await vis(page, '#myroom-fab');
  // the app's own child-safety audit (the developer centre's kid tour) on the two screens of the room
  const tour = await ev(page, async () => {
    const dc = G.sys.devcenter;
    if (!dc || typeof dc.kidTour !== 'function') return null;
    const r = await dc.kidTour({ screens: ['myroomedit', 'myroomcard'] });
    return { easy: r.easy, totals: r.totals, rows: r.rows.map((x) => ({ id: x.id, status: x.status, note: x.note, counts: x.audit && x.audit.counts, top: x.audit ? x.audit.items.filter((i) => i.sev !== 'info').slice(0, 6).map((i) => `${i.sev}:${i.kind}:${String(i.text).slice(0, 24)}:${String(i.detail).slice(0, 60)}`) : [] })) };
  });
  check('the app\'s own kid audit (developer centre tour, easy mode) finds nothing critical on "방 꾸미기" and on the card "내 방"', !!tour && tour.easy === true && tour.rows.length === 2 && tour.rows.every((r) => r.status === 'ok' && r.counts && r.counts.critical === 0), JSON.stringify(tour));
  await tidy(page);
  await startEdit(page);
  // (an empty room and one cushion: a turn of an eighth always has room there)
  const pickI = await ev(page, async () => { const E = G.sys.myroom.edit; await E.reset({ force: true }); E.show('seat'); E.pick('S_BANGSEOK'); return E.held ? E.held.index : -1; });
  await page.waitForTimeout(500);
  const easy = await ev(page, () => {
    const q = (sel) => [...document.querySelectorAll(sel)].filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
    const small = [], mute = [];
    for (const el of q('#myroom-ui button')) { const r = el.getBoundingClientRect(); if (Math.min(r.width, r.height) < 55.5) small.push(`${el.className.split(' ').slice(0, 2).join('.')} ${Math.round(r.width)}×${Math.round(r.height)}`); if (!(el.dataset.say || '').trim()) mute.push(el.className); }
    const done = document.querySelector('.mr-done').getBoundingClientRect();
    return { n: q('#myroom-ui button').length, small, mute, inputs: document.querySelectorAll('#myroom-ui input, #myroom-ui textarea, #myroom-ui select, #myroom-ui a[href]').length, acts: q('.mr-act .mr-btn').map((b) => b.getAttribute('aria-label')), done: done.top >= 0 && done.bottom <= innerHeight && done.left >= 0 && done.right <= innerWidth, price: /₩|결제|구독|[0-9][0-9,]*\s*원/.test(document.getElementById('myroom-ui').textContent) };
  });
  check('easy mode: every button of the edit mode is at least 56 px, has a voice line (data-say), nothing is typed, no link leads out, no price is shown, and "다 했어요" is on the screen', easyOn && !!fabE && fabE.h >= 56 && easy.n >= 20 && !easy.small.length && !easy.mute.length && easy.inputs === 0 && easy.done && !easy.price, JSON.stringify({ fab: fabE && fabE.h, n: easy.n, small: easy.small.slice(0, 6), mute: easy.mute.slice(0, 4) }));
  const r0 = (await snap(page)).items[pickI].r;
  await page.click(act('돌리기'));
  const r1e = (await snap(page)).items[pickI].r;
  check('easy mode: one 돌리기 button, each press an eighth of a turn; no left / right pair', pickI >= 0 && easy.acts.includes('돌리기') && !easy.acts.includes('왼쪽으로 돌리기') && !easy.acts.includes('오른쪽으로 돌리기') && r1e === (r0 + 3) % 24, JSON.stringify({ acts: easy.acts, r0, r1e }));
  await shot(page, '08-easy-edit.png');
  await ev(page, () => { G.sys.myroom.edit.undo(); G.sys.myroom.edit.stop(); });
  });
  await A.context.close().catch(() => {});

  // ------------------------------------------------------------------------------------------- the phone
  if (!flag('--skip-phone')) {
    log('— the phone (390 × 844, touch, easy mode as a new device has it)');
    const Ph = await open('phone', { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
    const ph = Ph.page;
    await part('the phone', async () => {
    await boot(ph, 'low');
    const easyP = await ev(ph, () => G.easy.on === true);
    const inP = await enterByDoor(ph);
    await ph.waitForTimeout(1500); await tidy(ph);
    const fabP = await vis(ph, '#myroom-fab');
    check('phone: in through the door; the button "방 꾸미기" fits the screen and is at least 56 px', easyP && inP.ok && !!fabP && fabP.h >= 56 && fabP.x >= 0 && fabP.r <= 390, JSON.stringify({ easyP, inP, fabP }));
    await ph.tap('#myroom-fab');
    await until(ph, () => G.sys.myroom.edit.active);
    await ph.waitForTimeout(600); await steady(ph);
    const lay = await ev(ph, () => {
      const rect = (sel) => { const el = document.querySelector(sel); if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), r: Math.round(r.right), b: Math.round(r.bottom), w: Math.round(r.width), h: Math.round(r.height) }; };
      const small = [...document.querySelectorAll('#myroom-ui button')].filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && Math.min(r.width, r.height) < 55.5; }).map((el) => `${el.className} ${Math.round(el.getBoundingClientRect().width)}×${Math.round(el.getBoundingClientRect().height)}`);
      const top = rect('.mr-top'), tray = rect('.mr-tray');
      return { top, tray, done: rect('.mr-done'), small, scrollX: document.documentElement.scrollWidth > innerWidth + 1, free: +((tray.y - top.b) / innerHeight).toFixed(2), pts: [[-7, 0, -5.5], [7, 0, -5.5], [0, 0, 0]].map((p) => { const s = G.sys.myroom.edit.screenOf(...p); return [Math.round(s.x), Math.round(s.y)]; }) };
    });
    check('phone: the bars fit the width (nothing is cut off, no sideways scrolling), every target is ≥ 56 px, and more than a third of the screen is left for the room', lay.top && lay.top.x >= 0 && lay.top.r <= 390 && lay.tray.x >= 0 && lay.tray.r <= 390 && lay.tray.b <= 844 && lay.done.w >= 56 && lay.done.x >= 0 && lay.done.r <= 390 && !lay.small.length && !lay.scrollX && lay.free >= 0.34 && lay.pts[2][1] > lay.top.b && lay.pts[2][1] < lay.tray.y, JSON.stringify(lay));
    await shot(ph, '09-phone-edit-empty.png');
    await ph.tap('.mr-cat[data-cat="furn"]');
    await until(ph, () => !!document.querySelector('.mr-tile[data-id="F_SOBAN"]'));
    await ev(ph, () => document.querySelector('.mr-tile[data-id="F_SOBAN"]').scrollIntoView({ inline: 'center', block: 'nearest' }));
    await ph.waitForTimeout(300);
    await ph.tap('.mr-tile[data-id="F_SOBAN"]');
    await frames(ph, 3);
    let t = await snap(ph);
    check('phone: a tap on a picture puts the thing into the room at once, in the middle of the view (no pointer to follow on a touch screen)', t.items.length === 1 && t.items[0].i === 'F_SOBAN' && t.held && t.held.index === 0 && !t.held.follow && Math.abs(t.items[0].x) <= 2.5, JSON.stringify(t.items[0]));
    // a touch drag: the finger goes down on the thing, moves, lifts
    const drag = await ev(ph, async () => {
      const E = G.sys.myroom.edit, st = document.querySelector('.mr-stage'), it = G.sys.myroom.room().items[0];
      const a = E.screenOf(it.x, 0.15, it.z), b = E.screenOf(it.x + 2, 0.15, it.z - 1.5);
      const fire = (type, x, y) => st.dispatchEvent(new PointerEvent(type, { pointerId: 7, pointerType: 'touch', isPrimary: true, clientX: x, clientY: y, bubbles: true, cancelable: true, button: 0, buttons: type === 'pointerup' ? 0 : 1 }));
      fire('pointerdown', a.x, a.y);
      for (let k = 1; k <= 8; k++) { fire('pointermove', a.x + ((b.x - a.x) * k) / 8, a.y + ((b.y - a.y) * k) / 8); await new Promise((r) => requestAnimationFrame(r)); }
      fire('pointerup', b.x, b.y);
      const now = G.sys.myroom.room().items[0];
      return { from: [it.x, it.z], now: [now.x, now.z], held: E.held && E.held.ok };
    });
    check('phone: a finger drags the thing across the floor', Math.abs(drag.now[0] - (drag.from[0] + 2)) <= 0.5 && Math.abs(drag.now[1] - (drag.from[1] - 1.5)) <= 0.5 && drag.held === true, JSON.stringify(drag));
    // a tap on an empty spot moves the thing in the hand there (no dragging needed)
    const tapTo = await ev(ph, async () => {
      const E = G.sys.myroom.edit, st = document.querySelector('.mr-stage'), p = E.screenOf(-2, 0, -3);
      const fire = (type) => st.dispatchEvent(new PointerEvent(type, { pointerId: 9, pointerType: 'touch', isPrimary: true, clientX: p.x, clientY: p.y, bubbles: true, cancelable: true, button: 0, buttons: type === 'pointerup' ? 0 : 1 }));
      fire('pointerdown'); fire('pointerup');
      const now = G.sys.myroom.room().items[0];
      return [now.x, now.z];
    });
    check('phone: a tap on a free spot moves the thing in the hand there — dragging is never the only way', Math.abs(tapTo[0] + 2) <= 0.26 && Math.abs(tapTo[1] + 3) <= 0.26, JSON.stringify(tapTo));
    // two fingers: pinch to zoom
    const pinch = await ev(ph, async () => {
      const E = G.sys.myroom.edit, st = document.querySelector('.mr-stage'), d0 = E.view().dist;
      const fire = (type, id, x, y) => st.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: 'touch', isPrimary: id === 11, clientX: x, clientY: y, bubbles: true, cancelable: true, button: 0, buttons: type === 'pointerup' ? 0 : 1 }));
      fire('pointerdown', 11, 150, 300); fire('pointerdown', 12, 240, 300);
      for (let k = 1; k <= 6; k++) { fire('pointermove', 11, 150 - k * 12, 300); fire('pointermove', 12, 240 + k * 12, 300); await new Promise((r) => requestAnimationFrame(r)); }
      fire('pointerup', 11, 78, 300); fire('pointerup', 12, 312, 300);
      const now = G.sys.myroom.room().items[0];
      return { d0, d1: E.view().dist, n: G.sys.myroom.room().items.length, at: [now.x, now.z] };
    });
    check('phone: two fingers moving apart bring the room closer (the thing in the hand stays where it is)', pinch.d1 < pinch.d0 * 0.8 && pinch.n === 1 && pinch.at[0] === tapTo[0] && pinch.at[1] === tapTo[1], JSON.stringify(pinch));
    await shot(ph, '10-phone-edit.png');
    await ph.tap('.mr-done');
    const outP = await until(ph, () => !G.sys.myroom.edit.active, null, 8000);
    await ph.waitForTimeout(1200);
    const chipP = await vis(ph, '#place-chip .pc-exit');
    check('phone: "다 했어요" closes the edit mode; the way out of the room is a button of at least 56 px', outP && !!chipP && chipP.h >= 56 && chipP.r <= 390, JSON.stringify(chipP));
    await shot(ph, '11-phone-room.png');
    });
    await Ph.context.close().catch(() => {});
  }

  // ------------------------------------------------------------------------------------------- 160 things on high
  if (!flag('--skip-high')) {
    log('— 160 things on high (1280 × 720)');
    const Hi = await open('high', { viewport: { width: 1280, height: 720 } }, { easy: false });
    const hp = Hi.page;
    await part('160 things on high', async () => {
    await boot(hp, 'high', { easy: false });
    const fill = await ev(hp, () => {
      // a full room made with the room's own rules: random things on random free spots until there are 160
      const D = G.data.myroom, room = D.empty();
      let seed = 20240917;
      const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
      let guard = 0;
      while (room.items.length < 160 && guard++ < 80000) {
        const id = D.order[Math.floor(rnd() * D.order.length)], e = D.items[id];
        let it;
        if (e.place === 'W') { const side = D.SIDES[Math.floor(rnd() * 4)], sp = D.wallSpot(side, Math.round(rnd() * D.SIDE_LEN[side] * 8) / 8); it = { i: id, x: sp.x, y: e.yw[1], z: sp.z, r: sp.r }; }
        else it = { i: id, x: Math.round((rnd() - 0.5) * 13 * 4) / 4, y: 0, z: Math.round((rnd() - 0.5) * 10 * 4) / 4, r: Math.floor(rnd() * 4) * 6 };
        if (e.sz && e.place !== 'W' && rnd() < 0.3) it.s = rnd() < 0.5 ? 0 : 2;
        if (e.col && rnd() < 0.5) it.c = Math.floor(rnd() * D.palettes[e.col[0]].length);
        if (D.check(room, it, -1).ok) room.items.push(it);
      }
      const had = G.sys.entitle, prev = had && had.limit, stub = (k) => (k === 'roomItems' ? 160 : (prev ? prev.call(had, k) : undefined));
      if (had) had.limit = stub; else G.sys.entitle = { has: () => true, limit: stub };
      G.state.myroom = D.sanitize(room, 200);
      G.sys.myroom.onStateLoaded();
      const kinds = {};
      for (const it of G.state.myroom.items) kinds[D.items[it.i].place] = (kinds[D.items[it.i].place] || 0) + 1;
      return { n: G.state.myroom.items.length, ids: new Set(G.state.myroom.items.map((it) => it.i)).size, kinds, limit: G.sys.myroom.limit(), bytes: D.bytes(G.state.myroom), tries: guard };
    });
    check('a full room: 160 things of many kinds placed by the room\'s own rules, under 24 KB', fill.n === 160 && fill.ids >= 60 && fill.limit === 160 && fill.bytes < D.LIMITS.bytes, JSON.stringify(fill));
    await ev(hp, () => G.sys.myroom.enter());
    await settled(hp, 'PL_MYROOM');
    await hp.waitForTimeout(2500); await tidy(hp); await frames(hp, 8);
    const w160 = await ev(hp, () => ({ calls: G.sys.engine.frameInfo.calls, tris: G.sys.engine.frameInfo.triangles, q: G.sys.engine.quality, stats: G.sys.myroom.stats() }));
    check(`160 things on high, walking: ≤ ${CALL_BUDGET} draw calls`, w160.q === 'high' && w160.stats.items === 160 && w160.calls > 0 && w160.calls <= CALL_BUDGET, JSON.stringify(w160));
    await shot(hp, '12-160-walk-high.png');
    await startEdit(hp);
    await ev(hp, () => { const M = G.sys.myroom, DD = G.data.myroom; M.edit.show('room'); M.edit.select(M.room().items.findIndex((it) => DD.items[it.i].place === 'F')); });
    await until(hp, () => G.sys.myroom.edit.thumbs().waiting === 0, null, 30000);
    await hp.waitForTimeout(800); await frames(hp, 8);
    const e160 = await ev(hp, () => ({ calls: G.sys.engine.frameInfo.calls, tris: G.sys.engine.frameInfo.triangles, held: !!G.sys.myroom.edit.held, stats: G.sys.myroom.stats() }));
    check(`160 things on high, decorating with a thing in the hand: ≤ ${CALL_BUDGET} draw calls`, e160.held && e160.calls > 0 && e160.calls <= CALL_BUDGET, JSON.stringify(e160));
    // moving a thing rewrites its own vertices only: a hundred moves stay fast
    const perf = await ev(hp, () => { const E = G.sys.myroom.edit, t0 = performance.now(); let ok = 0; for (let k = 0; k < 100; k++) { if (E.to(-6 + (k % 20) * 0.5, -4.5 + Math.floor(k / 20))) ok++; } return { ms: +(performance.now() - t0).toFixed(1), ok }; });
    check('moving a thing in a full room is cheap: 100 moves with the rule check and the redraw of the thing in under a second', perf.ms < 1000, JSON.stringify(perf));
    await shot(hp, '13-160-edit-high.png');
    await ev(hp, () => { G.sys.myroom.edit.cancel(); G.sys.myroom.edit.stop(); });
    });
    await Hi.context.close().catch(() => {});
  }

  const mine = (list) => list.filter((m) => !/GL Driver Message|GPU stall|net::ERR_|Failed to load resource/.test(m));
  check('no page error and no console error during the whole run', !mine(pageErrors).length && !mine(consoleErrors).length, [...mine(pageErrors), ...mine(consoleErrors)].slice(0, 5).join(' | '));
} catch (e) {
  check('the test ran to its end', false, String(e?.stack || e).slice(0, 480));
  code = results.some((r) => !r.ok) ? 1 : 2;
} finally {
  await browser.close().catch(() => {});
  if (tmpDir && !flag('--keep')) { try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* left for the OS */ } }
}
finish(code);
