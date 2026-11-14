#!/usr/bin/env node
// =============================================================================
// tests/exhibits-client.mjs — 한옥 전시 · 집 구경 도감 · 움직이는 그림 (CONTRACT §16.6)
//
//   node tests/exhibits-client.mjs                       builds a private page (tools/build.mjs --out <tmp>) and tests it
//   node tests/exhibits-client.mjs --file /abs/page.html test an already built page (parts A + B)
//   options: --keep (leave the temp build) · --json (machine-readable result) · --headed · --timeout <ms>
//            --ui-timeout <ms> (one UI step, default 30000: software WebGL on a busy machine can stall for seconds)
//            --no-phone (skip the two phone viewports) · --no-server (skip part C) · --port <n> (php -S port for part C)
//            --assets (build with the asset pack: the artwork cards are checked against the real pictures)
//            --shots <dir> (save screenshots of the card, the 도감 and the player)
//   One browser at a time is used; on a shared machine run it through the browser slot wrapper.
//
// Part A — bare Node, no browser: 48-interior-data.js evaluates without window / document / THREE; every exhibit has
//   its fields (place, anchor, title, emoji, kid line ≤ 40 characters, detail, sources with https addresses), a
//   medium-confidence fact says "~래요", nothing about health or prices, 까치호랑이 and 일월오봉도 are text only, every
//   room has 8 or more exhibits with different anchors, the ten motions have 4–8 steps with a caption and a voice
//   line; the 집 구경 quests / achievements have ids and reward shapes the server accepts.
// Part B — the file:// page (local mode): state default + sanitize · every exhibit card opens with all its fields,
//   sources as text; links only outside 쉬운 모드 (none in it) · attach() with a fake anchor through the real
//   interaction path · stamps, the first-stamp note in the 알림함, a room's celebration · place visits never counted
//   twice · every motion steps to its end (also under reduce-motion), captions and voice lines match the data,
//   auto-advance, ≤ 30 fps, paused while the page is hidden, cleaned up on close, no flash above 3 Hz (measured on
//   sampled frames) · board(): ≤ 512×288, 8–12 Hz and only while update() is called, a still poster under
//   reduce-motion / low quality · the 도감, its menu tiles, quests and achievements · demo() records nothing ·
//   a reload keeps the 도감 · phone viewports 390×844 and 844×390.
// Part C — a private server copy (php -S, throw-away data dir): register, look around, claim the 집 구경 quests, one
//   real save (no VALIDATION_FAILED), a reload brings the 도감 back, a counter that runs ahead of its map is refused.
// Exit 0 = all passed, 1 = a check failed, 2 = could not run.
// =============================================================================
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { spawn, spawnSync } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); }
catch {
  try { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
  catch { console.error('playwright 가 필요해요 (npm install)'); process.exit(2); }
}
const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n, d = null) => { const i = args.indexOf(n); return i >= 0 && i + 1 < args.length ? args[i + 1] : d; };
const TIMEOUT = Number(opt('--timeout', '300000'));
const T_UI = Number(opt('--ui-timeout', '30000'));
const jsonOut = flag('--json');
const SHOTS = opt('--shots');
const log = (...a) => { if (!jsonOut) console.log(...a); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail: String(detail ?? '').slice(0, 500) }); log(`${ok ? '  ✔' : '  ✖'} ${name}${detail !== '' && detail != null ? ` — ${String(detail).slice(0, 260)}` : ''}`); };
const finish = (code) => {
  const failed = results.filter((r) => !r.ok);
  if (jsonOut) console.log(JSON.stringify({ passed: results.length - failed.length, failed: failed.length, results }, null, 2));
  else console.log(`\n${failed.length ? '✖' : '✔'} exhibits-client: ${results.length - failed.length}/${results.length} passed`);
  process.exit(code != null ? code : failed.length ? 1 : 0);
};

// ============================================================================= part A — the data, in bare Node
log('🏠 exhibits — part A: data (bare Node)');
const ID_RE = /^[A-Za-z0-9_\-]{1,48}$/;                      // the server's id rule (SaveValidator::ID_RE)
const HEDGE = /(래요|대요|라고 해요|다고 해요)/;
const len = (s) => [...String(s)].length;
let DATA = null;
try {
  const G = { data: {} };
  // no window, no document, no THREE: the fragment must be pure data
  const bare = vm.createContext({ G, Math, JSON, Object, Array, Number, String, Date });
  vm.runInContext(`(function(){'use strict';\n${fs.readFileSync(path.join(ROOT, 'src/game/48-interior-data.js'), 'utf8')}\n})()`, bare, { timeout: 3000 });
  DATA = G.data;
  check('48-interior-data.js evaluates without window / document / THREE', !!DATA.exhibits && !!DATA.motions && Array.isArray(DATA.exhibitRooms));
} catch (e) { check('48-interior-data.js evaluates without window / document / THREE', false, e.message); }
let GAME = null;
try {
  const G = { data: {} };
  const ctx = vm.createContext({ G, window: {}, console, Math, JSON, Object, Array, Number, String, Date });   // like tools/build.mjs exportGameData()
  vm.runInContext(`(function(){'use strict';\n${fs.readFileSync(path.join(ROOT, 'src/game/01-data.js'), 'utf8')}\n})()`, ctx, { timeout: 3000 });
  GAME = G.data;
  check('01-data.js still evaluates in Node (the server export)', !!GAME.quests && !!GAME.achievements);
} catch (e) { check('01-data.js still evaluates in Node (the server export)', false, e.message); }

if (DATA) {
  const X = DATA.exhibits, M = DATA.motions, R = DATA.exhibitRooms;
  const ids = Object.keys(X), bad = [], byPlace = {};
  for (const id of ids) {
    const e = X[id];
    if (e.id !== id || !/^HX_[A-Z0-9_]{2,40}$/.test(id) || !ID_RE.test(id)) bad.push(`${id}: id`);
    if (!R.some((r) => r.id === e.place)) bad.push(`${id}: place ${e.place}`);
    if (!/^[a-z][a-z0-9_]{1,23}$/.test(String(e.anchor))) bad.push(`${id}: anchor ${e.anchor}`);
    (byPlace[e.place] = byPlace[e.place] || []).push(e);
    for (const k of ['title', 'emoji', 'kid', 'detail']) if (typeof e[k] !== 'string' || !e[k].trim()) bad.push(`${id}: ${k}`);
    if (len(e.kid) > 40) bad.push(`${id}: kid line ${len(e.kid)} characters`);
    if (/[㐀-䶿一-鿿]/.test(e.kid + e.title)) bad.push(`${id}: hanja in the kid line / title`);
    if (!Array.isArray(e.sources) || !e.sources.length) bad.push(`${id}: no source`);
    for (const s of e.sources || []) if (!s || typeof s.label !== 'string' || !s.label.trim() || !/^https?:\/\/[^\s"'<>]+$/.test(String(s.url))) bad.push(`${id}: source ${JSON.stringify(s).slice(0, 80)}`);
    if (!['high', 'medium'].includes(e.confidence)) bad.push(`${id}: confidence ${e.confidence}`);
    if (e.confidence === 'medium' && !(HEDGE.test(e.kid) && HEDGE.test(e.detail))) bad.push(`${id}: a medium-confidence fact without "~래요"`);
    if (e.motion && !M[e.motion]) bad.push(`${id}: unknown motion ${e.motion}`);
    if (e.art && (!/^art\/[a-z0-9_]+$/.test(e.art) || !e.credit || !e.titleEn || !e.period)) bad.push(`${id}: artwork fields`);
    if (e.textOnly && e.art) bad.push(`${id}: a text-only exhibit with a picture`);
    if (/건강|면역|항암|다이어트|효능|치료|예방|몸에 좋/.test(e.kid + e.detail)) bad.push(`${id}: health wording`);
    if (/만 원|\d\s?원[^가-힣]|\d원$|가격|값이 싸|비싸/.test(e.kid + e.detail)) bad.push(`${id}: price wording`);
  }
  check(`every exhibit has its fields (${ids.length} exhibits)`, bad.length === 0, bad.slice(0, 6).join(' · '));
  const arts = ids.filter((i) => X[i].art);
  check('57 facts or more, one card per pack artwork, the allotment office cards', ids.length >= 75 && arts.length === 12 && ids.filter((i) => X[i].place === 'PL_OFFICE').length >= 8, `${ids.length} exhibits · ${arts.length} artworks`);
  check('까치호랑이 and 일월오봉도 are text only (never a stand-in picture)', ['HX_KKACHI', 'HX_IRWOROBONG'].every((i) => X[i] && X[i].textOnly === true && !X[i].art));
  const thin = Object.entries(byPlace).filter(([, l]) => l.length < 8).map(([p, l]) => `${p} ${l.length}`);
  const dup = Object.entries(byPlace).filter(([, l]) => new Set(l.map((e) => e.anchor)).size !== l.length).map(([p]) => p);
  check('every room has 8 or more exhibits, each on its own anchor', R.length === 7 && R.every((r) => (byPlace[r.id] || []).length >= 8) && !thin.length && !dup.length, `${R.map((r) => `${r.name} ${(byPlace[r.id] || []).length}`).join(' · ')}${dup.length ? ' · duplicate anchors: ' + dup.join(',') : ''}`);
  // the artworks are the pack's (names and accession numbers agree with assets/pack/MANIFEST.json)
  try {
    const man = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets/pack/MANIFEST.json'), 'utf8'));
    const files = new Map((man.files || []).map((f) => [f.name, f]));
    const wrong = arts.filter((i) => { const f = files.get(X[i].art); const acc = (/accession ([0-9A-Za-z.]+)/.exec(f?.credit || '') || [])[1]; return !f || !/CC0/.test(String(f.license)) || !acc || !X[i].credit.includes(acc); });
    const unused = [...files.keys()].filter((n) => n.startsWith('art/') && !arts.some((i) => X[i].art === n));
    check('every artwork card names a CC0 picture of the pack with the same accession number; no pack artwork is left out', wrong.length === 0 && unused.length === 0, [...wrong, ...unused].join(', '));
  } catch (e) { check('artworks against assets/pack/MANIFEST.json', false, e.message); }
  const mbad = [];
  for (const [id, m] of Object.entries(M)) {
    if (m.id !== id || !/^MG_[A-Z_]{2,40}$/.test(id) || !ID_RE.test(id)) mbad.push(`${id}: id`);
    if (!m.title || !m.emoji || !R.some((r) => r.id === m.place)) mbad.push(`${id}: title / emoji / place`);
    if (!Array.isArray(m.steps) || m.steps.length < 4 || m.steps.length > 8) { mbad.push(`${id}: ${m.steps?.length} steps`); continue; }
    if (!Array.isArray(m.poster) || !(m.poster[0] >= 0 && m.poster[0] < m.steps.length)) mbad.push(`${id}: poster`);
    m.steps.forEach((s, i) => { if (!s.caption || !s.say || len(s.caption) > 34 || /[㐀-䶿一-鿿]/.test(s.caption + s.say)) mbad.push(`${id}#${i + 1}: caption / voice line`); });
  }
  for (const r of R) for (const m of r.motions || []) if (!M[m]) mbad.push(`${r.id}: board ${m}`);
  check(`ten motions, 4–8 steps each, every step with a caption and a voice line (${Object.values(M).reduce((a, m) => a + m.steps.length, 0)} steps)`, Object.keys(M).length === 10 && mbad.length === 0, mbad.slice(0, 6).join(' · '));
  if (GAME) {
    const Q = GAME.quests, A = GAME.achievements;
    const qs = ['Q_HOUSE_ROOMS', 'Q_HOUSE_EXHIBITS', 'Q_HOUSE_MOTION', 'Q_HOUSE_BOOK'], as = ['ACH_HOUSE_FIRST', 'ACH_HOUSE_ALL', 'ACH_EXHIBIT10', 'ACH_EXHIBIT40', 'ACH_ROOMBOOK1', 'ACH_ROOMBOOK_ALL', 'ACH_MOTION5'];
    const RK = new Set(['coin', 'exp', 'edu', 'items', 'title']);
    const okReward = (r) => r && Object.keys(r).every((k) => RK.has(k)) && Object.entries(r).every(([k, v]) => (k === 'title' ? typeof v === 'string' && v.length <= 20 : k === 'items' ? true : Number.isInteger(v) && v > 0 && v <= 5000));
    const qbad = qs.filter((id) => { const q = Q[id]; return !q || !ID_RE.test(id) || !q.autoAccept || !q.easyDesc || !okReward(q.reward) || q.objectives.length !== 1 || q.objectives[0].type !== 'interact' || !['place', 'heritage', 'motion', 'roombook'].includes(q.objectives[0].kind) || !q.objectives[0].easyText; });
    const abad = as.filter((id) => { const a = A[id]; return !a || !ID_RE.test(id) || !okReward(a.reward) || !['placesSeen', 'exhibitsSeen', 'exhibitRooms', 'motionsSeen'].includes(a.condition?.stat) || !(a.condition.gte > 0); });
    const reach = A.ACH_ROOMBOOK_ALL?.condition.gte === R.length && A.ACH_EXHIBIT40?.condition.gte <= ids.length && A.ACH_MOTION5?.condition.gte <= Object.keys(M).length && Q.Q_HOUSE_EXHIBITS?.objectives[0].count <= ids.length && Q.Q_HOUSE_MOTION?.objectives[0].count <= Object.keys(M).length;
    check('집 구경 quests / achievements: ids, objective kinds, reward shapes the server accepts, goals within reach', qbad.length === 0 && abad.length === 0 && reach, [...qbad, ...abad].join(', ') + (reach ? '' : ' goal out of reach'));
  }
}
if (!DATA) finish(1);

// ============================================================================= the page under test
let file = opt('--file');
let tmpDir = null;
if (!file) {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tfm-exhibits-'));
  file = path.join(tmpDir, 'index.html');
  const bargs = [path.join(ROOT, 'tools/build.mjs'), '--no-font', '--quiet', '--strict', '--out', file];
  if (!flag('--assets')) bargs.push('--no-assets');
  const b = spawnSync(process.execPath, bargs, { encoding: 'utf8' });
  if (b.status !== 0) { console.error(b.stderr || b.stdout); process.exit(2); }
}
if (!fs.existsSync(file)) { console.error(`page not found: ${file}`); process.exit(2); }
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });

const browser = await chromium.launch({ headless: !flag('--headed'), args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--autoplay-policy=no-user-gesture-required'] });
const pageErrors = [];
const watch = (page, tag) => page.on('pageerror', (e) => pageErrors.push(`${tag}: ${String(e?.message || e).slice(0, 300)}`));
const shot = async (page, name) => { if (!SHOTS) return; try { await page.screenshot({ path: path.join(SHOTS, name), timeout: 240000 }); } catch (e) { log(`  (screenshot ${name} failed: ${String(e.message || e).slice(0, 80)})`); } };
/** a dialog's entrance animation starts fully transparent: wait until it has finished before looking at pixels */
const settled = (page, sel) => page.waitForFunction((s) => { const el = document.querySelector(s); return !!el && !el.classList.contains('is-entering') && el.getAnimations().every((a) => a.playState === 'finished'); }, sel, { timeout: T_UI, polling: 100 }).catch(() => null);
const url = `${pathToFileURL(file).href}?autostart=1&notutorial=1&quality=low`;
async function boot(page, u = url) {
  await page.goto(u, { waitUntil: 'load', timeout: TIMEOUT });
  await page.waitForFunction(() => window.G && window.G.ready === true && !!window.G.state && !!window.G.sys?.exhibits, null, { timeout: TIMEOUT, polling: 250 });
  await page.evaluate(() => { G.ui.modal.closeAll(); });
}

let phpProc = null, srvTmp = null;
try {
  // =========================================================================== part B — the file:// page, local mode
  log(`🏠 exhibits — part B: the page in local mode — ${file}`);
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
  const page = await context.newPage();
  const outside = [];
  await page.route('**/*', (route) => { const u = route.request().url(); if (/^(file|data|blob):/.test(u)) return route.continue(); outside.push(u.slice(0, 120)); return route.abort(); });
  watch(page, 'local');
  await boot(page);

  const sys = await page.evaluate(() => {
    const E = G.sys.exhibits, p = G.state.places, s = G.state.stats;
    const api = ['open', 'motion', 'board', 'attach', 'mount', 'forPlace', 'openBook', 'demo', 'seen', 'watched', 'progress', 'motions', 'player', 'frame', 'stage', 'stats'];
    return {
      ok: !!E && !E._failed, missing: api.filter((k) => typeof E?.[k] !== 'function'), mode: G.net.mode, frag: G.__fragmentErrors.length,
      places: JSON.stringify(p), stats: [s.exhibitsSeen, s.placesSeen, s.exhibitRooms, s.motionsSeen], drawn: E.motions().length,
      pack: (G.pack?.names?.('art/') || []).length, quests: ['Q_HOUSE_ROOMS', 'Q_HOUSE_EXHIBITS', 'Q_HOUSE_MOTION', 'Q_HOUSE_BOOK'].map((id) => G.sys.quest?.status?.(id)),
    };
  });
  check('G.sys.exhibits is registered with its API; no fragment failed', sys.ok && sys.missing.length === 0 && sys.frag === 0, sys.missing.join(','));
  check('a new save starts with places = {visits, seen, motions} and four counters at 0', sys.places === '{"visits":{},"seen":{},"motions":{}}' && sys.stats.join() === '0,0,0,0', `${sys.places} ${sys.stats}`);
  check('all ten motions have a drawing', sys.drawn === 10, sys.drawn);
  check('the four 집 구경 quests are accepted by themselves', sys.quests.every((s) => s === 'accepted' || s === 'progress'), sys.quests.join(','));
  log(`  (pack artworks in this page: ${sys.pack})`);

  // ---------------------------------------------------------------- sanitize: an older save, a damaged save
  const san = await page.evaluate(() => {
    const N = G.save.normalize;
    const old = N({ version: 1, stats: { level: 3, coin: 55 }, inventory: {}, flags: { a: true } }, { id: 't' });
    const bad = N({ version: 1, stats: { exhibitsSeen: 50, placesSeen: 9, motionsSeen: 9, exhibitRooms: 7 },
      places: { visits: { PL_ANBANG: 3, PL_BUEOK: '2', 'PL bad': 1, PL_SARANG: -1, '__proto__': 5 }, seen: { HX_ONDOL: 1, HX_NOT_THERE: 1, '<b>': 1, HX_BORYO: true }, motions: { MG_GUDEUL: 1, MG_NONE: 1 }, extra: 1 } }, { id: 't' });
    const junk = N({ version: 1, places: 'x' }, { id: 't' });
    return { old: JSON.stringify(old.places) + old.stats.coin + old.flags.a + old.stats.exhibitsSeen, bad: bad.places, bstats: [bad.stats.exhibitsSeen, bad.stats.placesSeen, bad.stats.motionsSeen, bad.stats.exhibitRooms], junk: JSON.stringify(junk.places) };
  });
  check('an older save gets the empty maps and keeps everything else', san.old === '{"visits":{},"seen":{},"motions":{}}55true0', san.old);
  check('sanitize keeps known ids only (bad keys, unknown exhibits and motions, wrong counts are dropped)', JSON.stringify(san.bad) === '{"visits":{"PL_ANBANG":3,"PL_BUEOK":2},"seen":{"HX_ONDOL":1,"HX_BORYO":1},"motions":{"MG_GUDEUL":1}}' && san.junk === '{"visits":{},"seen":{},"motions":{}}', JSON.stringify(san.bad));
  check('sanitize never leaves a counter ahead of its map', san.bstats.join() === '2,2,1,2', san.bstats.join());

  // ---------------------------------------------------------------- every card, with all its fields (preview: no stamp)
  const cardScan = (easy) => page.evaluate(async (easy) => {
    G.setSetting('easyMode', easy);
    await new Promise((r) => setTimeout(r, 60));
    const E = G.sys.exhibits, X = G.data.exhibits, R = G.data.exhibitRooms, M = G.data.motions, bad = [];
    let links = 0, srcRows = 0, inputs = 0, arts = 0, posters = 0, speak = 0;
    const hasPack = (G.pack?.names?.('art/') || []).length > 0;
    for (const id of Object.keys(X)) {
      const ex = X[id], m = E.open(id, { preview: true });
      const el = document.querySelector('.xh-card-modal');
      const why = (w) => bad.push(`${id}: ${w}`);
      if (!m || !el) { why('did not open'); continue; }
      if (!el.querySelector('.modal-head h2')?.textContent.includes(ex.title)) why('title');
      if (el.querySelector('.xh-kid-t')?.textContent !== ex.kid) why('kid line');
      if (el.querySelector('.xh-detail')?.textContent !== ex.detail) why('detail');
      const rows = [...el.querySelectorAll('.xh-sources .xh-src')];
      srcRows += rows.length;
      if (rows.length !== ex.sources.length) why('source count');
      rows.forEach((li, i) => {
        const s = ex.sources[i], u = li.querySelector('.xh-src-url');
        if (li.querySelector('.xh-src-label')?.textContent !== s.label || u?.textContent !== s.url) why('source text');
        if (easy ? u?.tagName !== 'SPAN' : !(u?.tagName === 'A' && u.getAttribute('href') === s.url && u.target === '_blank' && /noopener/.test(u.rel) && /noreferrer/.test(u.rel))) why('source element');
      });
      links += el.querySelectorAll('a[href]').length;
      inputs += el.querySelectorAll('input, textarea, select, [contenteditable]').length;
      if (!el.querySelector('.xh-where')?.textContent.includes(R.find((r) => r.id === ex.place).name)) why('room chip');
      if ((ex.confidence === 'medium') !== [...el.querySelectorAll('.xh-note')].some((n) => /래요/.test(n.textContent))) why('how-sure note');
      if (!!ex.textOnly !== [...el.querySelectorAll('.xh-note')].some((n) => /글로만/.test(n.textContent))) why('text-only note');
      if (ex.textOnly && el.querySelector('canvas, img')) why('a text-only card shows a picture');
      if (ex.art) {
        if (el.querySelector('.xh-credit')?.textContent !== ex.credit) why('credit');
        if (hasPack ? !el.querySelector('canvas.xh-art') : !!el.querySelector('canvas.xh-art') || !el.querySelector('.xh-pic-emoji')) why('artwork picture');
        arts++;
      }
      const hasMotion = !!(ex.motion && M[ex.motion]);
      if (hasMotion !== !!el.querySelector('.xh-motion-btn')) why('motion button');
      if (hasMotion && !ex.art) { const c = el.querySelector('canvas.xh-poster'); if (!c || !c.width) why('motion poster'); else posters++; }
      if (el.querySelector('img[src^="http"], iframe, script')) why('outside content');
      if (easy && el.querySelector('.easy-speak')) speak++;
      m.close({ instant: true });
    }
    return { n: Object.keys(X).length, bad, links, srcRows, inputs, arts, posters, speak, seen: Object.keys(G.state.places.seen).length, stages: E.stats().stages, open: !!G.ui.modal.top() };
  }, easy);
  const cN = await cardScan(false);
  check(`normal mode: all ${cN.n} cards open with title, kid line, detail, room, notes, picture and sources`, cN.bad.length === 0, cN.bad.slice(0, 6).join(' · '));
  check('normal mode: every source is label + address; the address is a link that opens outside (noopener noreferrer)', cN.links === cN.srcRows && cN.srcRows >= cN.n, `${cN.links} links / ${cN.srcRows} sources`);
  const cE = await cardScan(true);
  check(`쉬운 모드: all ${cE.n} cards open with the same fields`, cE.bad.length === 0, cE.bad.slice(0, 6).join(' · '));
  check('쉬운 모드: sources are plain text — not one link in any card, and nothing to type into', cE.links === 0 && cE.srcRows === cN.srcRows && cE.inputs === 0 && cN.inputs === 0, `${cE.links} links · ${cE.inputs} inputs`);
  check('쉬운 모드: every card can be read aloud (🔊)', cE.speak === cE.n, `${cE.speak}/${cE.n}`);
  check('a preview records nothing and leaves no drawing surface behind', cN.seen === 0 && cE.seen === 0 && cE.stages === 0 && !cE.open, `seen ${cE.seen} · stages ${cE.stages}`);
  check(`cards with a motion show its poster frame (${cE.posters}); artwork cards carry the museum credit (${cE.arts})`, cE.posters >= 20 && cE.arts === 12);

  // a card on the screen: tap sizes in 쉬운 모드, a screenshot
  await page.evaluate(() => { G.sys.exhibits.open('HX_ONDOL', { preview: true }); });
  await settled(page, '.xh-card-modal');
  const tap = await page.evaluate(() => {
    const el = document.querySelector('.xh-card-modal');
    const vis = [...el.querySelectorAll('button, summary')].filter((b) => b.offsetWidth > 0 && b.offsetHeight > 0);
    const small = vis.filter((b) => Math.min(b.offsetWidth, b.offsetHeight) < 56).map((b) => `${b.className.split(' ')[0] || b.tagName}:${b.offsetWidth}x${b.offsetHeight}`);
    const r = el.getBoundingClientRect();
    return { n: vis.length, small, fits: r.left >= 0 && r.right <= innerWidth + 1 && r.top >= 0 && r.bottom <= innerHeight + 1, font: Math.min(...[...el.querySelectorAll('.xh-kid-t, .xh-chip, .xh-adult-sum')].map((x) => parseFloat(getComputedStyle(x).fontSize))) };
  });
  check('쉬운 모드 card: every button is 56 px or more, text 16 px or more, the card fits the screen', tap.small.length === 0 && tap.font >= 16 && tap.fits, `${tap.n} tap targets · smallest font ${tap.font}px ${tap.small.join(' ')}`);
  await shot(page, 'card-easy.png');
  await page.evaluate(() => { G.ui.modal.closeAll(); });

  // ---------------------------------------------------------------- attach() with fake anchors + the real interaction path
  const att = await page.evaluate(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const E = G.sys.exhibits, out = {};
    const ev = [], rooms = [], opened = [];
    window.__xh = { ev, rooms };
    G.bus.on('interact', (p) => ev.push(`${p.kind}:${p.id}`));
    G.bus.on('exhibit:room-complete', (p) => rooms.push(p.place));
    G.bus.on('exhibit:open', (p) => opened.push(`${p.id}:${p.first}`));
    const list = E.forPlace('PL_BUEOK');
    out.forPlace = list.length === Object.values(G.data.exhibits).filter((e) => e.place === 'PL_BUEOK').length && list.every((e) => e.id && e.anchor && e.title && e.emoji && e.kid && e.seen === false);
    out.anchors = E.anchors('PL_BUEOK').join(',');
    out.missingKeys = E.missing('PL_BUEOK', ['agungi', 'gamasot']).length;
    // the room builder's side: one Object3D per anchor key (the last one is left out on purpose)
    const anchors = new Map();
    list.forEach((e, i) => { const o = new THREE.Object3D(); o.position.set(40 + i * 3, 1.1, 2000); o.updateMatrixWorld(true); anchors.set(e.anchor, o); });
    const lost = list[list.length - 1];
    anchors.delete(lost.anchor);
    const mt = E.mount('PL_BUEOK', anchors);
    out.mounted = mt.attached.length === list.length - 1 && mt.missing.join() === lost.id;
    const hPlain = E.attach(lost.id, { x: 70, y: 1, z: 2000 });       // a plain spot works too
    out.plain = !!hPlain && E.stats().attached === list.length;
    const en = G.interact.get(list[0].id);
    const pos = typeof en?.position === 'function' ? en.position() : en?.position;
    out.entry = !!en && en.kind === 'heritage' && Math.abs(pos.x - 40) < 1e-6 && Math.abs(pos.z - 2000) < 1e-6 && G.interact.promptOf(en).text.includes(list[0].title);
    // a second registration of the same id replaces the first; the old handle must not take the new one away
    const o2 = new THREE.Object3D(); o2.position.set(40, 1.1, 2003); o2.updateMatrixWorld(true);
    const h2 = E.attach(list[0].id, o2);
    mt.dispose();
    out.guard = !!G.interact.get(list[0].id) && E.stats().attached === 2;
    const extra = list.slice(1, -1).map((e) => E.attach(e.id, anchors.get(e.anchor)));
    out.all = extra.every(Boolean) && E.stats().attached === list.length;
    out.before = { seen: Object.keys(G.state.places.seen).length, noti: G.sys.engagement.notifications().filter((n) => n.key === 'exhibit-book-first').length };
    // the player presses E / taps each exhibit: the interaction system runs onInteract and emits 'interact' itself
    for (const e of list) {
      G.interact._lastTrigger = 0;
      if (!G.interact._do(G.interact.get(e.id), 'test')) { out.failedAt = e.id; break; }
      const card = G.ui.modal.get('exhibit-card');
      if (!card || card._exhibit !== e.id) { out.noCard = e.id; break; }
      card.close({ instant: true });
    }
    for (let i = 0; i < 80 && !rooms.length; i++) await wait(50);     // the celebration follows the last card
    out.heritage = ev.filter((x) => x.startsWith('heritage:')).length;
    out.once = new Set(ev.filter((x) => x.startsWith('heritage:'))).size === list.length;
    out.first = opened.filter((x) => x.endsWith(':true')).length;
    out.seen = list.every((e) => E.seen(e.id)) && Object.keys(G.state.places.seen).length === list.length;
    out.rooms = rooms.join(); out.roombook = ev.filter((x) => x === 'roombook:PL_BUEOK').length;
    out.stats = [G.state.stats.exhibitsSeen, G.state.stats.exhibitRooms];
    const noti = G.sys.engagement.notifications();
    out.noti = { first: noti.filter((n) => n.key === 'exhibit-book-first').length, room: noti.filter((n) => n.key === 'exhibit-room-PL_BUEOK').length, text: noti.find((n) => n.key === 'exhibit-book-first')?.text || '' };
    // seeing it again: no new stamp, no second celebration
    G.interact._lastTrigger = 0; G.interact._do(G.interact.get(list[2].id), 'test'); G.ui.modal.get('exhibit-card')?.close({ instant: true });
    await wait(500);
    out.again = Object.keys(G.state.places.seen).length === list.length && rooms.length === 1 && opened[opened.length - 1].endsWith(':false');
    hPlain.unregister(); h2.unregister();
    for (const hd of extra) hd.unregister();
    out.clean = E.stats().attached === 0 && list.every((e) => !G.interact.get(e.id));
    out.n = list.length;
    return out;
  });
  check('forPlace() lists a room\'s exhibits with their anchor keys; missing() names the ones without an anchor', att.forPlace && att.anchors === 'agungi,gamasot,siru,salgang,soban,jori,ki,maetdol' && att.missingKeys === att.n - 2, att.anchors);
  check('mount() attaches one interactable per anchor (Object3D), reports the missing one; attach() takes a plain spot too', att.mounted && att.plain && att.entry);
  check('an old handle never unregisters a newer registration of the same exhibit; unregister() frees every entry', att.guard && att.all && att.clean);
  check('the real interaction path opens the card and records the stamp: one "heritage" event per exhibit', !att.failedAt && !att.noCard && att.heritage === att.n && att.once && att.first === att.n && att.seen, `${att.heritage} events for ${att.n} exhibits ${att.failedAt || att.noCard || ''}`);
  check('the first stamp leaves a note in the 알림함 that says where the 도감 is', att.before.noti === 0 && att.noti.first === 1 && /집 구경 도감/.test(att.noti.text) && /메뉴/.test(att.noti.text), att.noti.text);
  check('a complete room: exhibit:room-complete once, "roombook" once, a note, exhibitRooms = 1', att.rooms === 'PL_BUEOK' && att.roombook === 1 && att.noti.room === 1 && att.stats.join() === `${att.n},1`, `${att.rooms} · stats ${att.stats}`);
  check('seeing an exhibit again adds nothing', att.again);

  // ---------------------------------------------------------------- place visits (place:enter from 18-places.js)
  const vis = await page.evaluate(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const p = G.state.places, ev = window.__xh.ev;
    G.bus.emit('place:enter', { id: 'PL_BUEOK', prev: null });                   // nobody counted it: this module does
    await wait(80);
    p.visits.PL_ANBANG = (p.visits.PL_ANBANG | 0) + 1;                           // the place system counted this one itself…
    G.bus.emit('place:enter', { id: 'PL_ANBANG', prev: 'PL_BUEOK' });            // …so it is not counted again
    await wait(80);
    G.bus.emit('place:enter', { id: 'PL_BUEOK', prev: 'PL_ANBANG' });
    G.bus.emit('place:enter', { id: 'not a place' });
    G.bus.emit('place:enter', {});
    await wait(120);
    return { visits: JSON.stringify(p.visits), stat: G.state.stats.placesSeen, ev: ev.filter((x) => x.startsWith('place:')).join() };
  });
  check('a visit is counted once (also when the place system counted it itself); odd ids are ignored', vis.visits === '{"PL_BUEOK":2,"PL_ANBANG":1}' && vis.stat === 2 && vis.ev === 'place:PL_BUEOK,place:PL_ANBANG,place:PL_BUEOK', `${vis.visits} · ${vis.ev}`);

  // ---------------------------------------------------------------- the 도감
  await page.evaluate(() => { G.setSetting('easyMode', true); });
  await page.evaluate(() => { G.sys.exhibits.openBook({ place: 'PL_BUEOK' }); });
  await settled(page, '.xh-book-modal');
  const book = await page.evaluate(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const E = G.sys.exhibits, X = G.data.exhibits, R = G.data.exhibitRooms, out = {};
    const el = () => document.querySelector('.xh-book-modal');
    const count = (pl) => Object.values(X).filter((e) => e.place === pl).length;
    out.rooms = [...el().querySelectorAll('.xh-room')].map((b) => `${b.dataset.room}:${b.querySelector('.xh-room-c').textContent}`).join(' ');
    out.wantRooms = R.map((r) => `${r.id}:${r.id === 'PL_BUEOK' ? count(r.id) : 0}/${count(r.id)}`).join(' ');
    out.stamps = el().querySelectorAll('.xh-stamp').length === count('PL_BUEOK') && el().querySelectorAll('.xh-stamp.is-seen').length === count('PL_BUEOK');
    out.done = el().querySelector('.xh-room.is-on').classList.contains('is-done') && /모두 모았어요/.test(el().querySelector('.xh-room-intro').textContent);
    out.total = el().querySelector('.xh-book-total').getAttribute('aria-label');
    const vis = [...el().querySelectorAll('button')].filter((b) => b.offsetWidth > 0 && b.offsetHeight > 0);
    out.small = vis.filter((b) => Math.min(b.offsetWidth, b.offsetHeight) < 56).map((b) => `${b.className.split(' ')[0]}:${b.offsetWidth}x${b.offsetHeight}`);
    out.inputs = el().querySelectorAll('input, textarea, select, a[href]').length;
    // a collected stamp opens its card again
    el().querySelector('.xh-stamp.is-seen').click();
    out.reopen = G.ui.modal.get('exhibit-card')?._exhibit === el().querySelector('.xh-stamp.is-seen').dataset.exhibit;
    G.ui.modal.get('exhibit-card')?.close({ instant: true });
    // a room the player can walk into (the place exists): an unseen stamp only gives a hint
    const P = G.sys.places, def0 = P.def;
    P.def = (id) => (id === 'PL_GOTGAN' ? { id } : null);
    try {
      el().querySelector('.xh-room[data-room="PL_GOTGAN"]').click();
      out.walk = el().querySelector('.xh-stamps').dataset.walk;
      const seen0 = Object.keys(G.state.places.seen).length;
      el().querySelector('.xh-stamp').click();
      out.hint = !G.ui.modal.get('exhibit-card') && Object.keys(G.state.places.seen).length === seen0 && !G.state.places.visits.PL_GOTGAN;
      out.locked = [...el().querySelectorAll('.xh-mo-btn')].every((b) => b.classList.contains('is-locked')) && el().querySelectorAll('.xh-mo-btn').length === 3;
      el().querySelector('.xh-mo-btn').click();
      out.lockedStays = !E.player();
      // a room that is not in this build / the 2D-only mode: the book itself is the exhibition
      el().querySelector('.xh-room[data-room="PL_SARANG"]').click();
      out.noWalk = el().querySelector('.xh-stamps').dataset.walk;
      const ev0 = window.__xh.ev.length;
      const st = el().querySelector('.xh-stamp');
      st.click();
      const card = G.ui.modal.get('exhibit-card');
      out.fromBook = !!card && card._exhibit === st.dataset.exhibit && E.seen(st.dataset.exhibit) && G.state.places.visits.PL_SARANG === 1;
      out.fromBookEv = window.__xh.ev.slice(ev0).sort().join();
      card?.close({ instant: true });
      await wait(60);
      out.refreshed = el().querySelectorAll('.xh-stamp.is-seen').length === 1 && /1\/12/.test(el().querySelector('.xh-room.is-on .xh-room-c').textContent);
      out.unlocked = [...el().querySelectorAll('.xh-mo-btn')].every((b) => !b.classList.contains('is-locked'));
    } finally { P.def = def0; }
    return out;
  });
  check('도감: seven rooms with their counts, the complete room is marked', book.rooms === book.wantRooms && book.stamps && book.done, book.rooms);
  check('도감 in 쉬운 모드: every button 56 px or more, nothing to type, no link; a stamp opens its card again', book.small.length === 0 && book.inputs === 0 && book.reopen, book.small.slice(0, 4).join(' '));
  check('a room you can walk into: an unseen stamp only tells where to look; its motions wait for the visit', book.walk === '1' && book.hint && book.locked && book.lockedStays);
  check('a room you cannot walk into (not in this build / 2D-only): the stamp opens from the book, the room counts as visited', book.noWalk === '0' && book.fromBook && book.fromBookEv === `heritage:${Object.keys(DATA.exhibits).find((i) => DATA.exhibits[i].place === 'PL_SARANG')},place:PL_SARANG` && book.refreshed && book.unlocked, book.fromBookEv);
  await page.evaluate(() => { document.querySelector('.xh-room[data-room="PL_BUEOK"]')?.click(); });
  await shot(page, 'book-easy.png');
  await page.evaluate(() => { G.ui.modal.closeAll(); });

  // ---------------------------------------------------------------- the motion player: every motion, every step
  const motionScan = (still) => page.evaluate(async (still) => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    G.setSetting('reduceMotion', still);
    await wait(60);
    const E = G.sys.exhibits, M = G.data.motions, bad = [], out = { n: 0, steps: 0, small: [], events: 0, notes: 0 };
    const done = [];
    const off = G.bus.on('exhibit:motion', (p) => { if (p.done) done.push(p.id); });
    const base = E.stats().stages;
    // a signature of the whole picture (every third pixel of every third row): a changed label is enough to change it
    const sig = (cv) => { const w = cv.width, h = cv.height, d = cv.getContext('2d').getImageData(0, 0, w, h).data; let s = 0; for (let y = 0; y < h; y += 3) for (let x = y % 2; x < w; x += 3) { const i = (y * w + x) * 4; s = (s * 31 + d[i] * 3 + d[i + 1] * 5 + d[i + 2] * 7) % 1000000007; } return s; };
    for (const id of Object.keys(M)) {
      const def = M[id], why = (w) => bad.push(`${id}: ${w}`);
      const m = E.motion(id, { from: {} });
      const ctl = E.player();
      const el = document.querySelector('.xh-motion-modal');
      if (!m || !ctl || !el) { why('did not open'); continue; }
      if (ctl.still !== still) why(`still = ${ctl.still}`);
      if (still ? ctl.playing || ctl.raf : !ctl.playing) why('playing state at start');
      if (still && el.querySelector('.xh-still-note')) out.notes++;
      ctl.pause();
      const cv = el.querySelector('canvas.xh-canvas');
      if (!cv.width || cv.width > 1280 || Math.abs(cv.width / cv.height - 16 / 9) > 0.02) why(`canvas ${cv.width}x${cv.height}`);
      const btns = [...el.querySelectorAll('.xh-ctl .xh-btn')];
      if (btns.length !== 3) why('buttons');
      for (const b of btns) if (Math.min(b.offsetWidth, b.offsetHeight) < 56) out.small.push(`${id} ${b.className}:${b.offsetWidth}x${b.offsetHeight}`);
      const sigs = [];
      for (let i = 0; i < def.steps.length; i++) {
        ctl.go(i);
        const cap = el.querySelector('.xh-cap');
        if (el.querySelector('.xh-cap-t').textContent !== def.steps[i].caption) why(`caption ${i + 1}`);
        if (cap.dataset.say !== def.steps[i].say) why(`voice line ${i + 1}`);
        if (el.querySelector('.xh-step-chip').textContent !== `${i + 1} / ${def.steps.length}`) why(`step chip ${i + 1}`);
        if (el.querySelectorAll('.xh-dots i').length !== def.steps.length || !el.querySelectorAll('.xh-dots i')[i].classList.contains('on')) why(`dots ${i + 1}`);
        sigs.push(sig(cv));
        out.steps++;
      }
      if (new Set(sigs).size !== sigs.length) why('two steps draw the same picture');
      // ⏮ ⏭ like a child would: back to the start, then forward to the very end
      ctl.go(0);
      if (!btns[0].disabled) why('⏮ is not disabled on the first step');
      for (let i = 0; i < def.steps.length; i++) btns[2].click();
      if (!ctl.done || ctl.step !== def.steps.length - 1) why(`did not reach the end (step ${ctl.step + 1}, done ${ctl.done})`);
      if (!E.watched(id)) why('not recorded as watched');
      if (!btns[2].disabled) why('⏭ is not disabled at the end');
      btns[0].click();
      if (ctl.step !== def.steps.length - 2) why('⏮ does not go back');
      const frames = ctl.stage.frames;
      m.close({ instant: true });
      if (E.player() !== null || E.stats().stages !== base || cv.width !== 0) why('not cleaned up on close');
      if (!(frames > def.steps.length)) why('no frames painted');
      out.n++;
    }
    off && off();
    out.bad = bad; out.done = new Set(done).size; out.stat = G.state.stats.motionsSeen; out.motions = Object.keys(G.state.places.motions).length;
    out.ev = window.__xh.ev.filter((x) => x.startsWith('motion:')).length;
    G.setSetting('reduceMotion', false);
    return out;
  }, still);
  await page.evaluate(() => { G.setSetting('easyMode', true); });
  const moA = await motionScan(false);
  check(`all ten motions step to their end; captions, voice lines, step chip and dots follow the data (${moA.steps} steps)`, moA.n === 10 && moA.bad.length === 0, moA.bad.slice(0, 6).join(' · '));
  check('each motion is recorded once when it was watched to the end ("motion" event, motionsSeen = 10)', moA.done === 10 && moA.stat === 10 && moA.motions === 10 && moA.ev === 10, `done ${moA.done} · stat ${moA.stat} · events ${moA.ev}`);
  check('쉬운 모드: ⏮ ▶ ⏭ are 56 px or more on every motion', moA.small.length === 0, moA.small.slice(0, 4).join(' · '));
  const moS = await motionScan(true);
  check('움직임 줄이기: every motion is a row of still pictures that still steps to its end (a note says so)', moS.n === 10 && moS.bad.length === 0 && moS.notes === 10, moS.bad.slice(0, 6).join(' · '));
  // the media query alone (the device setting) gives stills too
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const mq = await page.evaluate(() => { const E = G.sys.exhibits; const m = E.motion('MG_CHEOMA', { from: {} }); const c = E.player(); const r = { still: c.still, playing: c.playing, raf: c.raf }; m.close({ instant: true }); return r; });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  check('prefers-reduced-motion (the device setting) gives stills as well', mq.still === true && mq.playing === false && mq.raf === 0, JSON.stringify(mq));

  // ≤ 30 fps: a simulated 120 Hz display for two seconds (requestAnimationFrame and the clock are driven by hand inside
  // one synchronous stretch, then put back) — this machine's own frame rate is far too low to show the cap
  await page.evaluate(() => { G.setSetting('easyMode', false); });
  const cap = await page.evaluate(() => {
    const E = G.sys.exhibits, raf0 = window.requestAnimationFrame, now0 = performance.now, q = [];
    let fake = now0.call(performance), id = 1e9, out = null, m = null;
    window.requestAnimationFrame = (fn) => { q.push(fn); return ++id; };
    performance.now = () => fake;
    try {
      m = E.motion('MG_GUDEUL', { from: { preview: true } });
      const c = E.player(), f0 = c.stage.frames, s0 = c.step;
      let ticks = 0;
      for (let i = 0; i < 240; i++) { fake += 1000 / 120; const run = q.splice(0); for (const fn of run) { try { fn(fake); } catch (e) { /* a foreign callback */ } } ticks++; }
      const twoSec = c.stage.frames - f0;
      // the same driver for up to two more simulated minutes (a step waits a little longer for a voice line that
      // never reports back): the story walks through its steps and stops at the end
      for (let i = 0; i < 14400 && !c.done; i++) { fake += 1000 / 120; const run = q.splice(0); for (const fn of run) { try { fn(fake); } catch (e) { /* a foreign callback */ } } }
      out = { twoSec, ticks, start: s0, end: c.step, done: c.done, playing: c.playing, steps: G.data.motions.MG_GUDEUL.steps.length, recorded: false };
    } finally { window.requestAnimationFrame = raf0; delete performance.now; if (performance.now !== now0) performance.now = now0; }
    m?.close({ instant: true });
    return out;
  });
  check(`the player never paints faster than 30 frames a second (${cap.twoSec} paints in 2 s on a simulated 120 Hz display)`, cap.twoSec >= 50 && cap.twoSec <= 61, JSON.stringify(cap));
  check('left alone it walks through all its steps and stops at the end', cap.done === true && cap.end === cap.steps - 1 && cap.playing === false, JSON.stringify(cap));

  // in real time: it paints, goes on by itself, and waits while the page is hidden (patient: software WebGL is slow)
  await page.evaluate(() => { window.__m = G.sys.exhibits.motion('MG_CHEOMA', { from: {} }); window.__f0 = G.sys.exhibits.player().stage.frames; });
  await settled(page, '.xh-motion-modal');
  const paints = await page.waitForFunction(() => { const c = G.sys.exhibits.player(); return !!c && c.playing && c.stage.frames > window.__f0; }, null, { timeout: 120000, polling: 250 }).then(() => true, () => false);
  check('the player paints while it plays (real time)', paints);
  const adv = await page.waitForFunction(() => G.sys.exhibits.player()?.step >= 1, null, { timeout: 180000, polling: 250 }).then(() => true, () => false);
  check('it goes on to the next step by itself (real time)', adv);
  const hid = await page.evaluate(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const c = G.sys.exhibits.player();
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
    const f0 = c.stage.frames, s0 = c.step, raf0 = c.raf;
    await wait(1500);
    const paused = { raf: raf0, frames: c.stage.frames - f0, step: c.step - s0 };
    delete document.hidden;
    document.dispatchEvent(new Event('visibilitychange'));
    window.__f1 = c.stage.frames;
    return { paused, loop: c.raf !== 0 };
  });
  const resumed = await page.waitForFunction(() => G.sys.exhibits.player().stage.frames > window.__f1, null, { timeout: 120000, polling: 250 }).then(() => true, () => false);
  check('while the page is hidden nothing is painted and no step passes; it goes on when the page is back', hid.paused.raf === 0 && hid.paused.frames === 0 && hid.paused.step === 0 && hid.loop && resumed, JSON.stringify(hid));
  const keys = await page.evaluate(() => {
    const c = G.sys.exhibits.player(), el = document.querySelector('.xh-motion-modal');
    el.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    const keyPause = c.playing === false;
    const s1 = c.step, n = G.data.motions[c.id].steps.length;
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    const keyNext = c.step === Math.min(s1 + 1, n - 1);
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    return { keyPause, keyNext, keyPrev: c.step === Math.max(0, Math.min(s1 + 1, n - 1) - 1) };
  });
  check('keyboard: space pauses, → and ← step', keys.keyPause && keys.keyNext && keys.keyPrev, JSON.stringify(keys));
  await shot(page, 'player.png');
  await page.evaluate(() => { G.ui.modal.closeAll(); });

  // ---------------------------------------------------------------- no flash above 3 Hz (measured on sampled frames)
  const flash = await page.evaluate(() => {
    // every step of every motion at 30 frames a second for its animation + 1 s of the hold; relative luminance of the
    // whole picture and of a 4×3 grid of regions; a flash = a pair of opposing changes of 10 % or more (WCAG 2.3.1)
    const E = G.sys.exhibits, lut = new Float32Array(256);
    for (let i = 0; i < 256; i++) { const c = i / 255; lut[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
    const GX = 4, GY = 3, out = { frames: 0, worst: 0, at: '', blank: [], moving: 0, steps: 0 };
    for (const id of E.motions()) {
      const st = E.stage(id, 96), cv = st.canvas, c = cv.getContext('2d', { willReadFrequently: true }), W = cv.width, H = cv.height;
      for (let s = 0; s < st.steps; s++) {
        const dur = st.anim(s) + 1, n = Math.ceil(dur * 30), series = Array.from({ length: GX * GY + 1 }, () => new Float32Array(n));
        let first = null, moved = false;
        for (let f = 0; f < n; f++) {
          const tau = f / 30;
          st.render(s, Math.min(1, tau / st.anim(s)), 20 * s + tau, {});
          const d = c.getImageData(0, 0, W, H).data, sum = new Float32Array(GX * GY), cnt = new Float32Array(GX * GY);
          let all = 0, hash = 0;
          for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
            const i = (y * W + x) * 4, L = 0.2126 * lut[d[i]] + 0.7152 * lut[d[i + 1]] + 0.0722 * lut[d[i + 2]];
            const g = Math.min(GY - 1, Math.floor(y * GY / H)) * GX + Math.min(GX - 1, Math.floor(x * GX / W));
            sum[g] += L; cnt[g]++; all += L;
            if ((x + y * 7) % 13 === 0) hash = (hash * 31 + d[i] + d[i + 1] * 3 + d[i + 2] * 5) % 1000000007;
          }
          for (let g = 0; g < GX * GY; g++) series[g][f] = sum[g] / cnt[g];
          series[GX * GY][f] = all / (W * H);
          if (f === 0) { first = hash; if (all / (W * H) < 0.01 || all / (W * H) > 0.99) out.blank.push(`${id}#${s + 1}`); } else if (hash !== first) moved = true;
          out.frames++;
        }
        if (moved) out.moving++;
        out.steps++;
        for (const ser of series) {
          // opposing changes of ≥ 0.1 between successive extremes, with their frame index
          const turns = [];
          let ext = ser[0], dir = 0;
          for (let f = 1; f < n; f++) {
            const v = ser[f];
            if (dir >= 0 && v > ext) { ext = v; continue; }
            if (dir <= 0 && v < ext) { ext = v; continue; }
            if (Math.abs(v - ext) >= 0.1) { turns.push(f); dir = v > ext ? 1 : -1; ext = v; }
          }
          // the most opposing changes inside any one second (30 frames); two of them make one flash
          for (let a = 0; a < turns.length; a++) { let k = a; while (k < turns.length && turns[k] - turns[a] < 30) k++; const fl = Math.floor((k - a) / 2); if (fl > out.worst) { out.worst = fl; out.at = `${id}#${s + 1}`; } }
        }
      }
      st.dispose();
    }
    out.left = E.stats().stages;
    return out;
  });
  check(`no flash above 3 Hz: ${flash.frames} sampled frames, at most ${flash.worst} flash(es) in any second of any region`, flash.worst <= 3 && flash.frames > 3000 && flash.left === 0, flash.at);
  check(`the motions are animation, not slides: something moves in ${flash.moving} of ${flash.steps} steps; no step is blank`, flash.moving === flash.steps && flash.blank.length === 0, flash.blank.join(','));

  // ---------------------------------------------------------------- board(): the same drawing for an in-world panel
  const board = await page.evaluate(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const E = G.sys.exhibits, eng = G.sys.engine, q0 = eng.quality, out = {};
    const run = (b, secs) => { const r0 = b.redraws; for (let i = 0; i < Math.round(secs * 60); i++) b.update(1 / 60); return b.redraws - r0; };
    // this page runs at quality `low`: a board is one still poster there
    const low = E.board('MG_GUDEUL', { w: 512, h: 288 });
    out.low = { tex: !!low.texture?.isTexture, size: `${low.canvas.width}x${low.canvas.height}`, still: low.still, redraws: run(low, 2), step: low.step, poster: G.data.motions.MG_GUDEUL.poster[0] };
    low.dispose();
    // the engine reports `medium` only inside synchronous stretches (a plain property, put back before every await)
    let b = null;
    eng.quality = 'medium';
    try { b = E.board('MG_GUDEUL', { w: 4096, h: 4096 }); out.cap = `${b.canvas.width}x${b.canvas.height}`; out.hz = run(b, 2) / 2; } finally { eng.quality = q0; }
    await Promise.resolve(); await Promise.resolve();   // (a new board is drawn once more when the font is ready)
    const r1 = b.redraws;
    await wait(700);                                    // nobody calls update(): nothing may be drawn
    out.idle = b.redraws - r1;
    const rm0 = G.settings.reduceMotion;
    eng.quality = 'medium';
    try {
      const s0 = b.step; run(b, 14); out.stepped = b.step !== s0;
      const c = b.canvas.getContext('2d'), band = c.getImageData(b.canvas.width >> 1, b.canvas.height - 6, 1, 1).data;
      out.band = band[0] < 110 && band[3] === 255;      // the caption band at the bottom
      G.settings.reduceMotion = true;                   // the setting itself (no event: only the board is looked at)
      out.rm = { changed: b.update(1 / 60), still: b.still, more: run(b, 2) };
      G.settings.reduceMotion = rm0;
      out.back = run(b, 1) > 0 && b.still === false;
      out.count = E.stats().boards;
      b.dispose();
      out.after = { boards: E.stats().boards, stages: E.stats().stages, upd: b.update(1) };
      out.unknown = E.board('MG_NOPE') === null;
    } finally { eng.quality = q0; G.settings.reduceMotion = rm0; }
    out.restored = eng.quality === q0;
    return out;
  });
  check('board(): a THREE texture on a canvas no larger than 512×288 (also when more is asked for)', board.low.tex && board.low.size === '512x288' && board.cap === '512x288', `${board.low.size} / ${board.cap}`);
  check('board() at low quality: one still poster frame, never redrawn', board.low.still === true && board.low.redraws === 0 && board.low.step === board.low.poster);
  check(`board() otherwise: redrawn 8–12 times a second, and only while update() is called (measured ${board.hz} Hz)`, board.hz >= 8 && board.hz <= 12 && board.idle === 0 && board.stepped && board.band, `idle redraws ${board.idle}`);
  check('board() under 움직임 줄이기: freezes on the poster, runs again afterwards; dispose() frees it', board.rm.still === true && board.rm.more === 0 && board.back && board.count === 1 && board.after.boards === 0 && board.after.stages === 0 && board.after.upd === false && board.unknown && board.restored, JSON.stringify(board.rm));

  // ---------------------------------------------------------------- menu tiles (kid + adult)
  const tiles = await page.evaluate(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const out = {};
    G.setSetting('easyMode', true); await wait(120);
    G.ui.triggerAction('menu'); await wait(120);
    const k = document.querySelector('.kid-menu-modal [data-km="housebook"]');
    out.kid = !!k && /집 구경 도감/.test(k.textContent) && Math.min(k.offsetWidth, k.offsetHeight) >= 56;
    k?.click(); await wait(250);
    out.kidOpens = !!G.ui.modal.get('exhibit-book');
    G.ui.modal.closeAll();
    G.setSetting('easyMode', false); await wait(120);
    G.ui.triggerAction('menu'); await wait(120);
    const a = document.querySelector('.app-menu-modal [data-mm="housebook"]');
    out.adult = !!a && /집 구경 도감/.test(a.textContent);
    a?.click(); await wait(250);
    out.adultOpens = !!G.ui.modal.get('exhibit-book');
    out.foot = !!document.querySelector('.xh-book-modal .xh-book-foot');
    G.ui.modal.closeAll();
    return out;
  });
  check('menu: a 🏠 집 구경 도감 tile in the kid menu and in the adult menu; both open the 도감', tiles.kid && tiles.kidOpens && tiles.adult && tiles.adultOpens && tiles.foot, JSON.stringify(tiles));

  // ---------------------------------------------------------------- quests and achievements (the existing systems)
  const quest = await page.evaluate(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const E = G.sys.exhibits, Q = G.sys.quest, out = {};
    const pr = (id) => `${Q.status(id)}:${G.state.quests[id]?.progress?.[0] || 0}`;
    out.before = ['Q_HOUSE_ROOMS', 'Q_HOUSE_EXHIBITS', 'Q_HOUSE_MOTION', 'Q_HOUSE_BOOK'].map(pr).join(' ');
    // one more place and one more exhibit bring the two open quests to their goals (3 different rooms, 10 different exhibits)
    G.bus.emit('place:enter', { id: 'PL_DAECHEONG', prev: null });
    E.seen('HX_GIDAN', true);
    await wait(200);
    out.after = ['Q_HOUSE_ROOMS', 'Q_HOUSE_EXHIBITS', 'Q_HOUSE_MOTION', 'Q_HOUSE_BOOK'].map(pr).join(' ');
    const coin0 = G.state.stats.coin;
    out.claimed = ['Q_HOUSE_ROOMS', 'Q_HOUSE_EXHIBITS', 'Q_HOUSE_MOTION', 'Q_HOUSE_BOOK'].map((id) => !!Q.claim(id)).join();
    await wait(300);
    G.ui.modal.closeAll();
    const want = ['Q_HOUSE_ROOMS', 'Q_HOUSE_EXHIBITS', 'Q_HOUSE_MOTION', 'Q_HOUSE_BOOK'].reduce((a, id) => a + G.data.quests[id].reward.coin, 0);
    const ach = ['ACH_HOUSE_FIRST', 'ACH_EXHIBIT10', 'ACH_ROOMBOOK1', 'ACH_MOTION5'], not = ['ACH_HOUSE_ALL', 'ACH_EXHIBIT40', 'ACH_ROOMBOOK_ALL'];
    out.status = ['Q_HOUSE_ROOMS', 'Q_HOUSE_EXHIBITS', 'Q_HOUSE_MOTION', 'Q_HOUSE_BOOK'].map((id) => Q.status(id)).join();
    out.ach = ach.every((id) => !!G.state.achievements[id]) && not.every((id) => !G.state.achievements[id]);
    out.coin = `${G.state.stats.coin - coin0}`; out.wantCoin = `${want}`;
    out.title = (G.state.profile.titles || []).includes('집 구경 박사');
    out.stats = [G.state.stats.exhibitsSeen, G.state.stats.placesSeen, G.state.stats.exhibitRooms, G.state.stats.motionsSeen].join();
    out.interacts = G.state.stats.interacts;
    return out;
  });
  check('quest progress comes through the existing quest system: three rooms, exhibits 9 then 10 of 10, three motions, one room\'s 도감', quest.before === 'completed:3 progress:9 completed:3 completed:1' && quest.after === 'completed:3 completed:10 completed:3 completed:1', `${quest.before} → ${quest.after}`);
  check('the four quests can be claimed (coin and the title 집 구경 박사)', quest.claimed === 'true,true,true,true' && quest.status === 'claimed,claimed,claimed,claimed' && Number(quest.coin) >= Number(quest.wantCoin) && quest.title, `coin +${quest.coin} (quest rewards ${quest.wantCoin})`);
  check('achievements follow the counters: first room, 10 exhibits, one room\'s 도감, 5 motions — not the ones still ahead', quest.ach && quest.stats === '10,4,1,10', quest.stats);

  // ---------------------------------------------------------------- demo(): the developer tour records nothing
  const demo = await page.evaluate(async () => {
    const E = G.sys.exhibits, before = JSON.stringify(G.state.places) + JSON.stringify(G.state.quests.Q_HOUSE_EXHIBITS) + G.state.stats.coin;
    const r = await E.demo({ ms: 40, exhibits: ['HX_KKACHI', 'HX_ART_TIGER', 'HX_MEJU', 'HX_NOPE'], motions: ['MG_CHEOMA', 'MG_JEOLGI'] });
    return { r, same: before === JSON.stringify(G.state.places) + JSON.stringify(G.state.quests.Q_HOUSE_EXHIBITS) + G.state.stats.coin, stages: E.stats().stages, open: !!G.ui.modal.top() };
  });
  check('demo() opens the cards and every step of the motions in turn and records nothing', demo.r.exhibits === 3 && demo.r.motions === 2 && demo.r.steps === 11 && demo.r.errors.length === 1 && demo.same && demo.stages === 0 && !demo.open, JSON.stringify(demo.r));

  // the tour is a developer tool: only the developer center calls it (its 🎬 연출 미리보기 button), behind that screen's own access rule
  const callers = fs.readdirSync(path.join(ROOT, 'src/game')).filter((f) => f.endsWith('.js') && f !== '49-exhibits.js' && /exhibits\??\.demo\b/.test(fs.readFileSync(path.join(ROOT, 'src/game', f), 'utf8')));
  const cheat = await page.evaluate(async () => {
    const before = JSON.stringify(G.state.places);
    const r = G.sys.devcenter.cheat('xDemo');
    if (!r.ok) return { ok: false, msg: r.msg, same: before === JSON.stringify(G.state.places) };
    await new Promise((res) => setTimeout(res, 300));
    const running = !!G.ui.modal.get('exhibit-card') || !!G.ui.modal.get('exhibit-motion');
    const end = await G.sys.exhibits.demo();                    // a second call stops the tour
    G.ui.modal.closeAll();
    return { ok: true, running, stopped: end.stopped === true, same: before === JSON.stringify(G.state.places) };
  });
  check('demo() is reachable from the developer center only (its xDemo button) and still records nothing', callers.join() === '80-devcenter.js' && cheat.same && (cheat.ok ? cheat.running && cheat.stopped : /권한/.test(cheat.msg || '')), JSON.stringify(cheat));

  // ---------------------------------------------------------------- a reload keeps the 도감
  const before = await page.evaluate(async () => { const ok = await G.save.save({ reason: 'test' }); return { ok, places: JSON.stringify(G.state.places), stats: [G.state.stats.exhibitsSeen, G.state.stats.placesSeen, G.state.stats.exhibitRooms, G.state.stats.motionsSeen].join(), quests: ['Q_HOUSE_ROOMS', 'Q_HOUSE_EXHIBITS', 'Q_HOUSE_MOTION', 'Q_HOUSE_BOOK'].map((id) => G.sys.quest.status(id)).join(), ach: Object.keys(G.state.achievements).filter((k) => /HOUSE|EXHIBIT|ROOMBOOK|MOTION/.test(k)).sort().join() }; });
  await boot(page);
  const after = await page.evaluate(async () => {
    const o = { places: JSON.stringify(G.state.places), stats: [G.state.stats.exhibitsSeen, G.state.stats.placesSeen, G.state.stats.exhibitRooms, G.state.stats.motionsSeen].join(), quests: ['Q_HOUSE_ROOMS', 'Q_HOUSE_EXHIBITS', 'Q_HOUSE_MOTION', 'Q_HOUSE_BOOK'].map((id) => G.sys.quest.status(id)).join(), ach: Object.keys(G.state.achievements).filter((k) => /HOUSE|EXHIBIT|ROOMBOOK|MOTION/.test(k)).sort().join() };
    G.sys.exhibits.openBook({ place: 'PL_BUEOK' });
    const el = document.querySelector('.xh-book-modal');
    o.book = `${el.querySelectorAll('.xh-stamp.is-seen').length}/${el.querySelectorAll('.xh-stamp').length} ${el.querySelector('.xh-book-total').getAttribute('aria-label')} ${el.querySelector('.xh-book-mo').getAttribute('aria-label')}`;
    o.noRepeat = G.sys.engagement.notifications().filter((n) => n.key === 'exhibit-book-first').length;
    G.ui.modal.closeAll();
    return o;
  });
  check('a reload keeps stamps, visits, watched motions, counters, claimed quests and achievements', before.ok && before.places === after.places && before.stats === after.stats && before.quests === after.quests && before.ach === after.ach && before.stats === '10,4,1,10', `${after.stats} · ${after.quests}`);
  check('the 도감 shows them again after the reload', after.book === `8/8 도장 10개, 모두 ${Object.keys(DATA.exhibits).length}개 움직이는 그림 10편, 모두 10편` && after.noRepeat <= 1, after.book);
  check('local part: no request left the page, no page error', outside.length === 0 && pageErrors.length === 0, [...outside, ...pageErrors].slice(0, 3).join(' | '));
  await context.close();

  // ---------------------------------------------------------------- phone viewports (touch, DPR 2)
  if (!flag('--no-phone')) {
    log('🏠 exhibits — part B: phone viewports');
    const ctxM = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
    const pm = await ctxM.newPage();
    await pm.route('**/*', (route) => (/^(file|data|blob):/.test(route.request().url()) ? route.continue() : route.abort()));
    watch(pm, 'phone');
    await boot(pm);
    const measure = (which) => pm.evaluate((which) => {
      const sel = { card: '.xh-card-modal', book: '.xh-book-modal', motion: '.xh-motion-modal' }[which];
      const el = document.querySelector(sel);
      if (!el) return { none: true };
      const r = el.getBoundingClientRect(), W = innerWidth, H = innerHeight;
      const vis = [...el.querySelectorAll('button, summary')].filter((b) => b.offsetWidth > 0 && b.offsetHeight > 0);
      const small = vis.filter((b) => Math.min(b.offsetWidth, b.offsetHeight) < 56).map((b) => `${b.className.split(' ')[0] || b.tagName}:${b.offsetWidth}x${b.offsetHeight}`);
      const out = { fits: r.left >= -1 && r.right <= W + 1 && r.top >= -1 && r.bottom <= H + 1, noHScroll: document.documentElement.scrollWidth <= W + 1 && el.querySelector('.modal-body').scrollWidth <= el.querySelector('.modal-body').clientWidth + 1, small, vp: `${W}x${H}`, easy: G.easy.on };
      const inView = (x) => { if (!x) return false; const q = x.getBoundingClientRect(); return q.width > 0 && q.left >= -1 && q.right <= W + 1 && q.top >= -1 && q.bottom <= H + 1; };
      if (which === 'motion') { out.canvas = inView(el.querySelector('.xh-canvas')); out.ctl = [...el.querySelectorAll('.xh-ctl .xh-btn')].every(inView); out.cap = inView(el.querySelector('.xh-cap')); const cv = el.querySelector('.xh-canvas'); out.cw = Math.round(cv.getBoundingClientRect().width); }
      if (which === 'card') { out.kid = inView(el.querySelector('.xh-kid')); out.pic = inView(el.querySelector('.xh-pic')); }
      if (which === 'book') { out.tabs = el.querySelectorAll('.xh-room').length; out.firstStamp = inView(el.querySelector('.xh-stamp')); }
      return out;
    }, which);
    for (const [w, h, name] of [[390, 844, 'portrait'], [844, 390, 'landscape']]) {
      await pm.setViewportSize({ width: w, height: h });
      await pm.evaluate(() => { G.ui.modal.closeAll(); G.setSetting('easyMode', true); });
      await pm.waitForTimeout(300);
      await pm.evaluate(() => { G.sys.exhibits.open('HX_ONDOL', { preview: true }); });
      await settled(pm, '.xh-card-modal');
      const c = await measure('card');
      await shot(pm, `phone-${name}-card.png`);
      await pm.evaluate(() => { G.ui.modal.closeAll(); G.sys.exhibits.openBook({ place: 'PL_ANBANG' }); });
      await settled(pm, '.xh-book-modal');
      const b = await measure('book');
      await shot(pm, `phone-${name}-book.png`);
      await pm.evaluate(() => { G.ui.modal.closeAll(); G.sys.exhibits.motion('MG_GUDEUL', { from: { preview: true } }); G.sys.exhibits.player().pause(); G.sys.exhibits.player().go(3); });
      await settled(pm, '.xh-motion-modal');
      const m = await measure('motion');
      await shot(pm, `phone-${name}-player.png`);
      await pm.evaluate(() => { G.ui.modal.closeAll(); });
      check(`phone ${w}×${h}: the card fits, no sideways scrolling, kid line and picture on the screen, buttons 56 px or more`, c.easy && c.fits && c.noHScroll && c.kid && c.pic && c.small.length === 0, JSON.stringify(c));
      check(`phone ${w}×${h}: the 도감 fits with its seven rooms and stamps, buttons 56 px or more`, b.fits && b.noHScroll && b.tabs === 7 && b.firstStamp && b.small.length === 0, JSON.stringify(b));
      check(`phone ${w}×${h}: the player shows the picture, the words and ⏮ ▶ ⏭ at once (picture ${m.cw} px wide)`, m.fits && m.noHScroll && m.canvas && m.cap && m.ctl && m.small.length === 0 && m.cw >= 240, JSON.stringify(m));
    }
    check('phone part: no page error', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));
    await ctxM.close();
  }

  // =========================================================================== part C — one real server-mode save
  const phpOk = !flag('--no-server') && spawnSync('php', ['-v'], { encoding: 'utf8' }).status === 0;
  if (flag('--no-server')) log('🏠 exhibits — part C skipped (--no-server)');
  else if (!phpOk) check('part C: php is available for the private server copy', false, 'php not found — run with --no-server to skip this part');
  else {
    log('🏠 exhibits — part C: a private server copy');
    srvTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tfm-exhibits-srv-'));
    const docroot = path.join(srvTmp, 'docroot'), dataDir = path.join(srvTmp, 'data');
    fs.mkdirSync(dataDir, { recursive: true });
    // the server files without anybody's local settings, stored data or uploads
    const skip = (rel) => /(^|[\\/])config\.local\.php$/.test(rel) || /^(data|uploads)[\\/].+/.test(rel);
    fs.cpSync(path.join(ROOT, 'server'), docroot, { recursive: true, filter: (src) => !skip(path.relative(path.join(ROOT, 'server'), src)) });
    fs.mkdirSync(path.join(docroot, 'data'), { recursive: true });
    const b = spawnSync(process.execPath, [path.join(ROOT, 'tools/build.mjs'), '--no-font', '--quiet', '--strict', '--no-assets', '--out', path.join(docroot, 'index.html'), '--data-out', path.join(docroot, 'data/game-data.json')], { encoding: 'utf8' });
    if (b.status !== 0) throw new Error(`server page build failed: ${(b.stderr || b.stdout).slice(0, 300)}`);
    const gd = JSON.parse(fs.readFileSync(path.join(docroot, 'data/game-data.json'), 'utf8'));
    check('the build exports the 집 구경 quests, achievements (with their counter conditions) and titles for the server', !!gd.quests.Q_HOUSE_BOOK?.reward?.coin && gd.achievements.ACH_ROOMBOOK_ALL?.condition?.stat === 'exhibitRooms' && gd.achievements.ACH_EXHIBIT10?.condition?.gte === 10 && gd.titles.includes('집 구경 박사') && gd.titles.includes('한옥 도감 지킴이'));
    const freePort = () => new Promise((res, rej) => { const s = net.createServer(); s.on('error', rej); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
    const port = Number(opt('--port', '0')) || await freePort();
    phpProc = spawn('php', ['-S', `127.0.0.1:${port}`, '-t', docroot], { env: { ...process.env, TFM_DATA_DIR: dataDir, TFM_UPLOAD_DIR: path.join(srvTmp, 'uploads'), TFM_TOSS_MOCK: '1' }, stdio: ['ignore', 'ignore', 'ignore'] });
    const BASE = `http://127.0.0.1:${port}/`;
    let up = false;
    for (let i = 0; i < 100 && !up; i++) { try { const r = await fetch(BASE + 'api/ping.php'); up = r.ok; } catch { /* not yet */ } if (!up) await sleep(100); }
    if (!up) throw new Error('the private php server did not start');
    const ctxS = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
    const ps = await ctxS.newPage();
    const other = [], saves = [];
    await ps.route('**/*', (route) => { const u = route.request().url(); if (u.startsWith(BASE) || /^(data|blob):/.test(u)) return route.continue(); other.push(u.slice(0, 120)); return route.abort(); });
    ps.on('response', async (r) => { if (/\/api\/player\/save\.php/.test(r.url())) { let body = ''; try { body = await r.text(); } catch { /* gone */ } saves.push({ status: r.status(), body: body.slice(0, 400) }); } });
    watch(ps, 'server');
    const openTitle = async () => {
      await ps.goto(`${BASE}index.html?notutorial=1&quality=low`, { waitUntil: 'load', timeout: TIMEOUT });
      await ps.waitForFunction(() => window.G && G.net && G.net.mode === 'server' && G.app && G.app._booted === true && G.app._booting === false && !!G.sys?.exhibits, null, { timeout: TIMEOUT, polling: 250 });
    };
    await openTitle();
    const rid = Math.random().toString(16).slice(2, 8);
    const account = { email: `xh${rid}@example.com`, nickname: `Xh${rid}`, password: `Hanok-${rid}-2026ok` };
    const entered = await ps.evaluate(async (a) => {
      try {
        const prof = await G.auth.register({ email: a.email, nickname: a.nickname, password: a.password, confirm: a.password, agree: true, easy: false });
        const ok = await G.app.enterGame(prof);
        return { ok, kind: prof?.kind, mode: G.net.mode, adapter: G.save.adapter?.name };
      } catch (e) { return { ok: false, err: `${e?.code || ''} ${e?.message || e}` }; }
    }, account);
    check('server mode: a new account enters the 체험관', entered.ok === true && entered.kind === 'server' && entered.adapter === 'server', JSON.stringify(entered));
    if (entered.ok) {
      await ps.waitForFunction(() => G.ready === true && !!G.state, null, { timeout: TIMEOUT, polling: 250 });
      const played = await ps.evaluate(async () => {
        const wait = (ms) => new Promise((r) => setTimeout(r, ms));
        G.ui.modal.closeAll();
        const E = G.sys.exhibits, Q = G.sys.quest, X = G.data.exhibits, M = G.data.motions;
        // look at a whole room and two more exhibits, walk into three rooms, watch five motions to the end
        const ids = [...Object.keys(X).filter((i) => X[i].place === 'PL_BUEOK'), 'HX_ONDOL', 'HX_GIDAN'];
        for (const id of ids) { const m = E.open(id); m.close({ instant: true }); }
        for (const id of ['PL_BUEOK', 'PL_ANBANG', 'PL_DAECHEONG']) { G.bus.emit('place:enter', { id, prev: null }); await wait(40); }
        for (const id of Object.keys(M).slice(0, 5)) { const m = E.motion(id, { from: {} }); const c = E.player(); c.pause(); for (let i = 0; i < M[id].steps.length; i++) c.next(); m.close({ instant: true }); }
        await wait(700);
        const qs = ['Q_HOUSE_ROOMS', 'Q_HOUSE_EXHIBITS', 'Q_HOUSE_MOTION', 'Q_HOUSE_BOOK'];
        const done = qs.map((id) => Q.status(id)).join();
        const claimed = qs.map((id) => !!Q.claim(id)).join();
        await wait(400);
        G.ui.modal.closeAll();
        const ok = await G.save.save({ reason: 'test' });
        return { done, claimed, ok, coin: G.state.stats.coin, stats: [G.state.stats.exhibitsSeen, G.state.stats.placesSeen, G.state.stats.exhibitRooms, G.state.stats.motionsSeen].join(), ach: Object.keys(G.state.achievements).filter((k) => /HOUSE|EXHIBIT|ROOMBOOK|MOTION/.test(k)).sort().join(), places: JSON.stringify(G.state.places), titles: (G.state.profile.titles || []).join() };
      });
      await sleep(600);
      const good = saves.filter((s) => s.status === 200);
      const refused = saves.filter((s) => s.status !== 200);
      check('server mode: the quests complete and are claimed', played.done === 'completed,completed,completed,completed' && played.claimed === 'true,true,true,true', `${played.done} · ${played.claimed}`);
      check('server mode: the save with places, counters, claimed quests and achievements is accepted (no VALIDATION_FAILED)', played.ok === true && good.length >= 1 && refused.length === 0 && played.stats === '10,3,1,5', `${saves.map((s) => s.status).join()} ${refused[0]?.body || ''}`);
      await openTitle();
      const back = await ps.evaluate(async () => {
        const u = G.auth.serverUser;
        if (!u) return { ok: false, err: 'no session after the reload' };
        const ok = await G.app.enterGame(G.auth._setCurrent(u));
        return { ok };
      });
      if (back.ok) await ps.waitForFunction(() => G.ready === true && !!G.state, null, { timeout: TIMEOUT, polling: 250 });
      const again = back.ok ? await ps.evaluate(() => ({ coin: G.state.stats.coin, stats: [G.state.stats.exhibitsSeen, G.state.stats.placesSeen, G.state.stats.exhibitRooms, G.state.stats.motionsSeen].join(), ach: Object.keys(G.state.achievements).filter((k) => /HOUSE|EXHIBIT|ROOMBOOK|MOTION/.test(k)).sort().join(), places: JSON.stringify(G.state.places), titles: (G.state.profile.titles || []).join(), quests: ['Q_HOUSE_ROOMS', 'Q_HOUSE_EXHIBITS', 'Q_HOUSE_MOTION', 'Q_HOUSE_BOOK'].map((id) => G.sys.quest.status(id)).join() })) : {};
      check('server mode: after a reload the server\'s copy brings the 도감, the counters, the rewards and the title back', back.ok && again.places === played.places && again.stats === played.stats && again.ach === played.ach && again.coin === played.coin && again.quests === 'claimed,claimed,claimed,claimed' && /집 구경 박사/.test(again.titles), `${again.stats} · coin ${again.coin} (was ${played.coin}) ${back.err || ''}`);
      check('server mode: the achievements were unlocked from the counters', played.ach === 'ACH_EXHIBIT10,ACH_HOUSE_FIRST,ACH_MOTION5,ACH_ROOMBOOK1', played.ach);
      if (back.ok) {
        // a counter that runs ahead of its map (a tampered client): the server refuses the save
        const n0 = saves.length;
        const tam = await ps.evaluate(async () => { G.state.stats.exhibitsSeen = 60; G.state.stats.exhibitRooms = 7; const ok = await G.save.save({ reason: 'test' }); return { ok }; });
        await sleep(600);
        const last = saves.slice(n0);
        check('server mode: a counter ahead of the stamps is refused (409 VALIDATION_FAILED · PLACES_BAD_SHAPE)', tam.ok !== true && last.length >= 1 && last[0].status === 409 && /VALIDATION_FAILED/.test(last[0].body), `${last.map((s) => s.status).join()} ${last[0]?.body.slice(0, 160) || ''}`);
      }
    }
    check('server part: every request stayed on the private server; no page error', other.length === 0 && pageErrors.length === 0, [...other, ...pageErrors].slice(0, 3).join(' | '));
    await ctxS.close();
  }
} catch (e) {
  check('test run', false, String(e?.stack || e));
} finally {
  try { await browser.close(); } catch { /* already closed */ }
  if (phpProc) { try { phpProc.kill(); } catch { /* gone */ } }
  if (!flag('--keep')) for (const d of [tmpDir, srvTmp]) { if (d) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ } } }
}
finish();
