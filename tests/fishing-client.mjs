#!/usr/bin/env node
// =============================================================================
// tests/fishing-client.mjs — fishing in a real browser, LOCAL mode (the file:// page, CONTRACT §18.3)
//
//   node tests/fishing-client.mjs                        builds a private page (tools/build.mjs --out <tmp>) and tests it
//   node tests/fishing-client.mjs --file /abs/page.html  test an already built page
//   options: --quality low|medium|high (default low: function; looks are judged at medium / high)
//            --shots <dir>   also save the evidence pictures there (contact sheet, sessions, cards, 도감, phones)
//            --only a,b      steps: fish, rod, gyeonji, net, trap, book, school, easy, phone, complex, reload
//            --keep · --json · --headed · --timeout <ms>
//
// What only a browser can show: the fish are painted (31 different skins, 31 different pictures), the catch card's fish
// turns, the 도감's pictures load, the session's own controls work with the keyboard and with a finger, the float / line
// / rod / net exist in the scene, schools are drawn in at most four draw calls, phones (390×844, 844×390) keep the big
// button inside the screen, the complex's river has its spots, a reload keeps the book. The rules themselves (windows,
// limits, protected fish, the 어항's clock) are tested without a browser in tests/fishing-logic.mjs.
// Exit 0 = all passed, 1 = a check failed, 2 = could not run.
// =============================================================================
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
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
const QUALITY = opt('--quality', 'low');
const SHOTS = opt('--shots');
const ONLY = (opt('--only', 'all') || 'all').split(',').map((s) => s.trim());
const want = (k) => ONLY.includes('all') || ONLY.includes(k);
const jsonOut = flag('--json');
const log = (...a) => { if (!jsonOut) console.log(...a); };

let file = opt('--file');
let tmpDir = null;
if (!file) {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tfm-fishing-'));
  file = path.join(tmpDir, 'index.html');
  const b = spawnSync(process.execPath, [path.join(ROOT, 'tools/build.mjs'), '--no-font', '--quiet', '--out', file], { encoding: 'utf8' });
  if (b.status !== 0) { console.error(b.stderr || b.stdout); process.exit(2); }
}
if (!fs.existsSync(file)) { console.error(`page not found: ${file}`); process.exit(2); }
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail: String(detail ?? '').slice(0, 500) }); log(`${ok ? '  ✔' : '  ✖'} ${name}${detail !== '' && detail != null ? ` — ${String(detail).slice(0, 260)}` : ''}`); };

const browser = await chromium.launch({ headless: !flag('--headed'), args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--autoplay-policy=no-user-gesture-required'] });
const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'ko-KR', timezoneId: 'Asia/Seoul', hasTouch: true });
await context.addInitScript(() => { try { const s = JSON.parse(localStorage.getItem('tfm.v1.settings') || '{}'); if (!('_fishTest' in s)) { s.easyMode = false; s._v = 2; s._fishTest = 1; localStorage.setItem('tfm.v1.settings', JSON.stringify(s)); } } catch (e) { /* first run */ } });
const page = await context.newPage();
await page.route('**/*', (route) => (/^(file|data|blob):/.test(route.request().url()) ? route.continue() : route.abort()));
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e?.message || e).slice(0, 300)));
page.on('console', (m) => { if (m.type() === 'error' && !/net::ERR|Failed to load resource/.test(m.text())) pageErrors.push('console: ' + m.text().slice(0, 300)); });
const url = `${pathToFileURL(file).href}?autostart=1&notutorial=1&quality=${QUALITY}`;
const ev = (fn, arg) => page.evaluate(fn, arg);
const sleep = (ms) => page.waitForTimeout(ms);
const shot = async (name) => { if (!SHOTS) return; try { await page.screenshot({ path: path.join(SHOTS, `${name}-${QUALITY}.png`) }); } catch (e) { log('   (shot failed)', name, e.message); } };
const phase = (n, timeout = 150000) => page.waitForFunction((x) => (Array.isArray(x) ? x : [x]).includes(G.sys.fishing.state.phase), n, { timeout, polling: 50 });
const JUNE = Date.UTC(2026, 5, 9, 22, 0, 0);                // 2026-06-10 07:00 in Korea

async function boot() {
  await page.goto(url, { waitUntil: 'load', timeout: TIMEOUT });
  await page.waitForFunction(() => window.G && window.G.ready === true && !!window.G.sys?.fishing, null, { timeout: TIMEOUT, polling: 250 });
  await ev((june) => {
    G.ui.modal.closeAll();
    const f = G.sys.fishing; f.debug.setNow(june); f.debug.setSeed(11); f.debug.setWeather('CLOUDY');
    // the test's hands: a watcher that slows the short moments down (software WebGL draws a few frames a second) and a
    // careful child that winds, pauses while the fish pulls, and keeps the button down while lifting a stone
    window.__speed = { bite: 0.12, 'net-run': 0.12, land: 0.35, reel: 1, cast: 0.7 }; window.__fast = 4; window.__last = ''; window.__log = []; window.__hands = 0;
    setInterval(() => { const p = f.state.phase; if (p !== window.__last) { window.__last = p; window.__log.push(p); f.debug.speed(window.__speed[p] || window.__fast); } }, 20);
    setInterval(() => { const st = f.state; if (!window.__hands) return; if (st.phase === 'reel') { if (st.tension > 0.72) f.press(false); else if (st.tension < 0.5) f.press(true); } else if (st.phase === 'net-stir') f.press(true); }, 40);
  }, JUNE);
}
const goSpot = (id) => ev(async (sid) => { const s = G.sys.fishing.spots().find((x) => x.id === sid); if (!s || !s.ready) throw new Error('spot not ready: ' + sid); await G.sys.player.teleport(s.x - 1.5, s.z, 0, { fade: false }); return true; }, id);
const tap = () => ev(() => { const f = G.sys.fishing; f.press(true); f.press(false); });
const cardOpen = async () => { await page.waitForFunction(() => !!G.ui.modal.get('fish-card'), null, { timeout: 150000, polling: 100 }); await sleep(SHOTS ? 2600 : 1600); return ev(() => { const el = document.querySelector('.fish-card-modal'); const cv = el.querySelector('.fish-canvas'); let spread = -1; try { const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data; let lo = 255, hi = 0; for (let i = 0; i < d.length; i += 64) { const l = (d[i] + d[i + 1] + d[i + 2]) / 3; if (l < lo) lo = l; if (l > hi) hi = l; } spread = hi - lo; } catch (e) { spread = -2; } return { title: G.ui.modal.get('fish-card').opts?.title || el.querySelector('.modal-title, h2, h3')?.textContent || '', buttons: [...el.querySelectorAll('.fish-card-actions .fish-big')].map((b) => b.textContent.trim()), why: [...el.querySelectorAll('.fish-why')].map((e) => e.textContent).join(' '), canvas: [cv.width, cv.height], spread, stamp: !!el.querySelector('.fish-stamp'), text: el.textContent.slice(0, 300) }; }); };
const clickCard = async (which) => { await ev((w) => { const b = [...document.querySelectorAll('.fish-card-actions .fish-big')]; (w === 'keep' ? b[1] || b[0] : b[0])?.click(); }, which); await sleep(700); };
const step = async (name, fn) => { if (!want(name)) return; const t = Date.now(); log(`\n▶ ${name}`); try { await fn(); } catch (e) { check(`${name}: ran to its end`, false, String(e?.message || e).slice(0, 300)); try { await ev(() => { G.ui.modal.closeAll(); G.sys.fishing.cancel('test'); }); } catch (x) { /* page gone */ } } log(`   (${((Date.now() - t) / 1000).toFixed(1)} s)`); };

try {
  await boot();
  const b0 = await ev(() => { const f = G.sys.fishing; return { spots: f.spots().map((s) => ({ id: s.id, ready: s.ready, river: s.river, x: s.x, y: s.y, z: s.z, water: s.ready ? G.world.isWater(s.x, s.z) : null, ix: !!G.interact.get(s.id), kind: G.interact.get(s.id)?.kind, methods: s.methods })), signs: !!f._signs && f._signs.geometry.attributes.position.count, preset: G.sys.engine.preset?.name, easy: G.easy.on, anchors: f.spots().filter((s) => s.river === 'valley').every((s) => !!G.data.layout.get(s.id)), quests: ['Q_FISH_FIRST', 'Q_FISH_METHODS', 'Q_FISH_GUARD', 'Q_FISH_BOOK'].every((q) => !!G.data.quests[q]), items: Object.keys(G.data.items).filter((k) => /^FISH_/.test(k)).length, cards: Object.keys(G.data.education).filter((k) => /^EDU_FISH_/.test(k)).length, deck: (G.data.lectureDecks || []).some((d) => d.id === 'DECK_FISH') }; });
  const valley = b0.spots.filter((s) => s.river === 'valley');
  check('the page starts with the fishing system; the preset is the asked one', b0.preset === QUALITY && b0.easy === false, `preset ${b0.preset}`);
  check('the valley has four spots on the bank (not in the water), each a registered interactable of kind fishspot with a marker anchor', valley.length === 4 && valley.every((s) => s.ready && s.water === false && s.ix && s.kind === 'fishspot') && b0.anchors, valley.map((s) => `${s.id} ${s.ready ? `${s.x.toFixed(1)},${s.y.toFixed(2)},${s.z.toFixed(1)}` : 'not ready'}`).join(' · '));
  check('the signs of the spots are one merged mesh', b0.signs > 100, `${b0.signs} vertices`);
  check('data reached the game: 4 quests, 16 items FISH_<ID>, 6 learning cards, the slide deck', b0.quests && b0.items === 16 && b0.cards === 6 && b0.deck, JSON.stringify({ items: b0.items, cards: b0.cards, deck: b0.deck }));

  // ---------------------------------------------------------------- the fish themselves
  await step('fish', async () => {
    const t0 = Date.now();
    const F = await ev(async () => {
      const ids = G.data.fish.ids;
      const out = { skins: {}, thumbs: {}, tris: {}, mat: {} };
      for (const id of ids) {
        const cv = G.fishkit.skin(id, { w: 256, h: 128 });
        const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
        const seen = new Set(); let hsh = 0;
        for (let i = 0; i < d.length; i += 4) { const k = ((d[i] >> 4) << 8) | ((d[i + 1] >> 4) << 4) | (d[i + 2] >> 4); seen.add(k); hsh = (hsh * 31 + k) | 0; }
        out.skins[id] = [seen.size, hsh];
        const o = G.fishkit.build(id, {});
        out.tris[id] = o.userData.fish.tris; let maps = 0, kinds = new Set();
        o.traverse((m) => { if (m.isMesh) { kinds.add(m.material.type); if (m.material.map) maps++; } });
        out.mat[id] = [[...kinds].join('+'), maps];
        o.userData.fish.dispose();
      }
      for (const id of ids) {
        const u = await G.fishkit.studio.thumb(id, { w: 160, h: 100 });
        const img = new Image(); img.src = u; await img.decode();
        const c = document.createElement('canvas'); c.width = 32; c.height = 20; const x = c.getContext('2d'); x.drawImage(img, 0, 0, 32, 20);
        out.thumbs[id] = Array.from(x.getImageData(0, 0, 32, 20).data).filter((_, i) => i % 4 !== 3);
      }
      return out;
    });
    const ids = Object.keys(F.skins);
    const hashes = new Set(ids.map((id) => F.skins[id][1]));
    check('every species has its own painted skin (31 different canvases, each with many colours)', ids.length === 31 && hashes.size === 31 && ids.every((id) => F.skins[id][0] >= 12), `fewest colours: ${Math.min(...ids.map((id) => F.skins[id][0]))}`);
    const sd = (a) => { const m = a.reduce((x, y) => x + y, 0) / a.length; return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / a.length); };
    const blank = ids.filter((id) => sd(F.thumbs[id]) < 6);
    let minD = 1e9, pair = '';
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) { const a = F.thumbs[ids[i]], b = F.thumbs[ids[j]]; let d = 0; for (let k = 0; k < a.length; k++) d += Math.abs(a[k] - b[k]); d /= a.length; if (d < minD) { minD = d; pair = `${ids[i]} / ${ids[j]}`; } }
    check('the studio draws every species (no blank picture) and no two species give the same picture', blank.length === 0 && minD > 0.25, `blank: ${blank.join(', ') || 'none'} · closest pair ${pair} (${minD.toFixed(2)})`);
    const low = QUALITY === 'low';
    const m0 = F.mat[ids[0]];
    check(low ? 'low preset: flat colours, no texture maps' : 'medium / high: the skin is a texture on a lit, wet material', low ? ids.every((id) => F.mat[id][1] === 0) : ids.every((id) => F.mat[id][1] >= 1 && /Physical|Standard/.test(F.mat[id][0])), `${m0[0]} · maps ${m0[1]}`);
    const cap = { low: 1400, medium: 3200, high: 6000 }[QUALITY];
    check(`triangles per fish stay under the budget of the preset (${cap})`, ids.every((id) => F.tris[id] > 100 && F.tris[id] <= cap), `largest ${Math.max(...ids.map((id) => F.tris[id]))}`);
    if (SHOTS) {
      const sheet = await ev(async () => { const c = await G.fishkit.studio.sheet({ cols: 6, cellW: 300, cellH: 190 }); return [c.toDataURL('image/png'), c.width, c.height]; });
      fs.writeFileSync(path.join(SHOTS, `sheet-${QUALITY}.png`), Buffer.from(sheet[0].split(',')[1], 'base64'));
      check('the contact sheet of all species is drawn', sheet[1] >= 1800 && sheet[2] >= 1000, `${sheet[1]}×${sheet[2]} · ${((Date.now() - t0) / 1000).toFixed(0)} s`);
    }
  });

  // ---------------------------------------------------------------- 대낚시 with the keyboard, then a protected fish
  await step('rod', async () => {
    await goSpot('FS_V_DECK');
    check('start() begins a session at the spot', await ev(() => { G.sys.fishing.debug.force('SANCHEONEO'); return G.sys.fishing.start('FS_V_DECK', 'rod', { bait: 'worm' }); }) === true);
    await phase('ready'); await sleep(900);
    const ui = await ev(() => { const r = (el) => { const b = el.getBoundingClientRect(); return [Math.round(b.width), Math.round(b.height)]; }; const f = G.sys.fishing; return { shown: !document.getElementById('fishing-ui').hidden, act: r(document.querySelector('.fish-act')), label: document.querySelector('.fish-act').textContent, hint: document.querySelector('.fish-hint').textContent, blocking: G.ui.isBlocking(), cam: G.sys.camera.mode, hudOff: document.body.classList.contains('fishing-on'), rod: !!f._gear?.rod && f._gear.rod.parent === f._gearRoot, dist: Math.hypot(G.sys.player.position.x - f._rec.r.x, G.sys.player.position.z - f._rec.r.z) }; });
    check('the session shows its own controls: one big button, a hint, the rod in the hand; the world\'s input is blocked', ui.shown && ui.act[0] >= 120 && /던져요/.test(ui.label) && ui.hint.length > 5 && ui.blocking && ui.cam === 'shot' && ui.hudOff && ui.rod && ui.dist < 1, JSON.stringify(ui));
    await shot('rod-1-ready');
    await page.keyboard.press('Space');
    await phase(['cast', 'wait']);
    check('Space casts', true);
    await phase('wait'); await sleep(1200);
    const fl = await ev(() => { const f = G.sys.fishing, g = f._gear; return { float: g.float.visible, y: g.float.position.y, wy: f._rec.r.wy, inWater: G.world.isWater(g.float.position.x, g.float.position.z), line: g.line.visible, d: Math.hypot(g.float.position.x - G.sys.player.position.x, g.float.position.z - G.sys.player.position.z) }; });
    check('the float sits on the water in front of the angler, the line runs to it', fl.float && fl.line && fl.inWater && Math.abs(fl.y - fl.wy) < 0.25 && fl.d > 2 && fl.d < 14, JSON.stringify(fl));
    await shot('rod-2-wait');
    await phase('bite');
    const bite = await ev(() => { const f = G.sys.fishing; return { window: f.state.window, label: document.querySelector('.fish-act').textContent, go: document.querySelector('.fish-act').classList.contains('is-go'), y: f._gear.float.position.y, wy: f._rec.r.wy }; });
    await shot('rod-3-bite');
    check('the bite is shown on the button and on the float; the window is ≥ 1.2 s', /당겨요/.test(bite.label) && bite.go && bite.window >= 1.2, JSON.stringify(bite));
    await page.keyboard.press('KeyE');
    await phase('reel');
    check('E hooks the fish; the calm bar appears', await ev(() => !document.querySelector('.fish-bar').hidden));
    await ev(() => { window.__hands = 1; }); await sleep(1300); await shot('rod-4-reel');
    await phase(['land', 'card'], 240000); await sleep(350); await shot('rod-5-land');
    let c = await cardOpen(); await shot('card-SANCHEONEO');
    check('the catch card: the fish drawn on its canvas, length, a first-time stamp, two choices', /산천어/.test(c.title) && c.buttons.length === 2 && c.canvas[0] === 640 && c.spread > 25 && c.stamp && /cm/.test(c.text), JSON.stringify({ title: c.title, buttons: c.buttons, spread: c.spread, stamp: c.stamp }));
    await clickCard('keep');
    await phase(['ready']);
    const s1 = await ev(() => ({ inv: G.sys.inventory.count('FISH_SANCHEONEO'), book: G.state.fishing.book.SANCHEONEO, day: G.state.fishing.day, sticker: !!G.state.collection.COL_FISH_SANCHEONEO, stats: ['fishCaught', 'fishKept', 'fishReleased', 'fishSpecies', 'fishGuarded'].map((k) => G.state.stats[k]), quest: G.state.quests?.Q_FISH_FIRST || null }));
    check('데려가기: the item is in the bag, the book and the sticker book have the fish, the day counts one', s1.inv === 1 && s1.book.n === 1 && s1.book.kept === 1 && s1.day.kept === 1 && s1.sticker && s1.stats.join() === '1,1,0,1,0', JSON.stringify(s1));
    // a protected fish, with the mouse / finger on the button
    await ev(() => { G.sys.fishing.debug.force('EOREUMCHI'); });
    await page.dispatchEvent('.fish-act', 'pointerdown', { pointerId: 1, bubbles: true }); await page.dispatchEvent('.fish-act', 'pointerup', { pointerId: 1, bubbles: true });
    await phase(['cast', 'wait']);
    check('pressing the button with a pointer casts', true);
    await phase('bite');
    await page.dispatchEvent('.fish-act', 'pointerdown', { pointerId: 1, bubbles: true }); await page.dispatchEvent('.fish-act', 'pointerup', { pointerId: 1, bubbles: true });
    await phase(['land', 'card'], 240000);
    c = await cardOpen(); await shot('card-EOREUMCHI');
    check('a protected fish: one choice (놓아주기) and the reason', /어름치/.test(c.title) && c.buttons.length === 1 && /놓아주기/.test(c.buttons[0]) && /천연기념물|멸종위기/.test(c.why), `${c.buttons.join('|')} · ${c.why.slice(0, 80)}`);
    await clickCard('release');
    await phase('ready');
    await page.keyboard.press('Escape'); await sleep(600);
    const end = await ev(() => ({ phase: G.sys.fishing.state.phase, blocking: G.ui.isBlocking(), hudOff: document.body.classList.contains('fishing-on'), ui: document.getElementById('fishing-ui').hidden, cam: G.sys.camera.mode, gear: G.sys.fishing._gearRoot.children.length, inv: G.sys.inventory.count('FISH_EOREUMCHI'), guarded: G.state.stats.fishGuarded }));
    check('Esc ends the session and gives everything back (no gear left in the scene); the protected fish is no item', end.phase === 'idle' && !end.blocking && !end.hudOff && end.ui && end.cam !== 'shot' && end.gear === 0 && end.inv === 0 && end.guarded === 1, JSON.stringify(end));
  });

  await step('gyeonji', async () => {
    const sid = valley.find((s) => s.methods.includes('gyeonji')).id;
    await goSpot(sid);
    await ev((id) => { G.sys.fishing.debug.force('SWIRI'); return G.sys.fishing.start(id, 'gyeonji'); }, sid);
    await phase('ready'); await tap();
    await phase('wait'); await sleep(1500); await shot('gyeonji-wait');
    await phase('bite'); await shot('gyeonji-bite'); await tap();
    await ev(() => { window.__hands = 1; });
    await phase(['land', 'card'], 240000);
    const c = await cardOpen(); await shot('card-SWIRI');
    check('견지낚시 to a catch (the line drifts down the riffle, no float)', /쉬리/.test(c.title) && c.buttons.length === 2 && c.spread > 25, c.title);
    await clickCard('release'); await ev(() => G.sys.fishing.cancel('test'));
  });

  await step('net', async () => {
    const sid = valley.find((s) => s.methods.includes('net')).id;
    await goSpot(sid);
    await ev((id) => { G.sys.fishing.debug.force('DOLGOGI'); window.__hands = 1; return G.sys.fishing.start(id, 'net'); }, sid);
    await phase('net-ready'); await sleep(500); await tap();
    await phase('net-stir'); await sleep(700); await shot('net-stir');
    await phase('net-run'); await sleep(250); await shot('net-run');
    await page.waitForFunction(() => { const st = G.sys.fishing.state; return st.phase !== 'net-run' || st.t >= st.winA + 0.05; }, null, { timeout: 90000, polling: 40 });
    await tap();
    await phase(['land', 'card'], 90000); await sleep(300); await shot('net-land');
    let c = await cardOpen(); await shot('card-DOLGOGI');
    check('족대 to a catch', /돌고기/.test(c.title) && c.buttons.length === 2, c.title);
    await clickCard('release');
    await phase('net-ready');
    await ev(() => { G.sys.fishing.debug.force('GAJAE'); }); await tap();
    await phase('net-run', 90000);
    await page.waitForFunction(() => { const st = G.sys.fishing.state; return st.phase !== 'net-run' || st.t >= st.winA + 0.05; }, null, { timeout: 90000, polling: 40 });
    await tap();
    await page.waitForFunction(() => !!document.querySelector('.fish-neighbour'), null, { timeout: 90000, polling: 100 }); await sleep(700); await shot('card-neighbour');
    const nb = await ev(() => ({ text: document.querySelector('.fish-neighbour').textContent.slice(0, 120), buttons: document.querySelectorAll('.fish-neighbour .fish-big').length, seen: G.state.fishing.seen }));
    check('a clean-water neighbour (가재) is looked at and put back', /가재/.test(nb.text) && nb.buttons === 1 && nb.seen.GAJAE === 1, nb.text);
    await ev(() => { document.querySelector('.fish-neighbour .fish-big').click(); }); await sleep(500);
    await ev(() => G.sys.fishing.cancel('test'));
  });

  await step('trap', async () => {
    const sid = valley.find((s) => s.methods.includes('trap')).id;
    await goSpot(sid);
    await ev((id) => { G.sys.fishing.debug.force(null); return G.sys.fishing.start(id, 'trap'); }, sid);
    await page.waitForFunction(() => G.ui.modal.isOpen(), null, { timeout: 90000, polling: 100 }); await sleep(600); await shot('trap-set');
    const told = await ev(() => document.querySelector('#modal-root').textContent.replace(/\s+/g, ' ').slice(0, 160));
    await ev(() => G.ui.modal.closeAll()); await sleep(900);
    const set = await ev((id) => { const f = G.sys.fishing; return { trap: G.state.fishing.traps[id], info: f.spots().find((s) => s.id === id).trap, phase: f.state.phase, obj: !!f._spots.get(id).trapObj, label: G.interact.get(id).label() }; }, sid);
    check('어항: set in the water in real time (10 minutes), the session ends by itself, the trap is seen in the shallows', !!set.trap && set.info && set.info.ready === false && Math.round(set.info.leftMs / 60000) === 10 && set.phase === 'idle' && set.obj && /10분|조금/.test(told), `${told.slice(0, 90)} · ${JSON.stringify(set.info)}`);
    await sleep(600); await shot('trap-in-water');
    const ready = await ev(([id, june]) => { const f = G.sys.fishing; f.debug.setNow(june + f.trapMinutes() * 60000 + 3000); return { info: f.spots().find((s) => s.id === id).trap, label: G.interact.get(id).label() }; }, [sid, JUNE]);
    check('after its minutes the spot offers "어항 살펴보기"', ready.info.ready === true && /어항 살펴보기/.test(ready.label), ready.label);
    ev((id) => { G.sys.fishing.open(id); }, sid);
    const titles = [];
    for (let i = 0; i < 4; i++) {
      await page.waitForFunction(() => !!G.ui.modal.get('fish-card') || G.sys.fishing.state.phase === 'idle', null, { timeout: 90000, polling: 100 });
      if (!(await ev(() => !!G.ui.modal.get('fish-card')))) break;
      const c = await cardOpen(); titles.push(c.title); if (i === 0) await shot('trap-card');
      await clickCard('release'); await sleep(400);
    }
    const left = await ev((id) => ({ trap: G.state.fishing.traps[id] || null, phase: G.sys.fishing.state.phase, obj: !!G.sys.fishing._spots.get(id).trapObj }), sid);
    check('a ready 어항 gives one to three small fish, a card each; then it is out of the water', titles.length >= 1 && titles.length <= 3 && left.trap === null && left.phase === 'idle' && !left.obj, titles.join(' · '));
    await ev((june) => G.sys.fishing.debug.setNow(june), JUNE);
  });

  await step('book', async () => {
    if (SHOTS) for (const id of ['YEOLMOGEO', 'KKEOKJI', 'GEUMGANGMOCHI', 'TUNGGARI']) { ev((sid) => { G.sys.fishing.preview(sid); }, id); await cardOpen(); await shot(`card-${id}`); await ev(() => G.ui.modal.closeAll()); await sleep(300); }
    await ev(() => { G.sys.fishing.book(); });
    await page.waitForFunction(() => [...document.querySelectorAll('.fish-book-modal .fish-thumb')].filter((i) => i.src.startsWith('data:image')).length >= 31, null, { timeout: 150000, polling: 250 }).catch(() => {});
    await sleep(500); await shot('book-grid');
    const g = await ev(() => ({ tiles: document.querySelectorAll('.fish-book-modal .fish-tile').length, locked: document.querySelectorAll('.fish-book-modal .fish-tile.is-locked').length, thumbs: [...document.querySelectorAll('.fish-book-modal .fish-thumb')].filter((i) => i.src.startsWith('data:image')).length, met: Object.keys(G.state.fishing.book).length, names: [...document.querySelectorAll('.fish-book-modal .fish-tile:not(.is-locked) b')].map((b) => b.textContent) }));
    check('어류 도감: 31 tiles with their pictures; met fish have names, the others are shadows', g.tiles === 31 && g.thumbs === 31 && g.locked === 31 - g.met && g.names.length === g.met, JSON.stringify({ thumbs: g.thumbs, met: g.met, names: g.names.join(',') }));
    await ev(() => { G.sys.fishing.book('SANCHEONEO'); }); await sleep(SHOTS ? 2400 : 1500); await shot('book-detail');
    const d = await ev(() => { const el = document.querySelector('.fish-book-modal'); const cv = el.querySelector('.fish-canvas'); let spread = -1; try { const x = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data; let lo = 255, hi = 0; for (let i = 0; i < x.length; i += 64) { const l = (x[i] + x[i + 1] + x[i + 2]) / 3; if (l < lo) lo = l; if (l > hi) hi = l; } spread = hi - lo; } catch (e) { spread = -2; } return { rows: el.querySelectorAll('.fish-row').length, src: el.querySelector('.fish-src')?.textContent || '', spread, sci: el.querySelector('.fish-sci')?.textContent || '' }; });
    check('a page: the turning fish, the Latin name, twelve or more rows of facts, the sources', d.rows >= 12 && /출처/.test(d.src) && d.spread > 25 && /Oncorhynchus/.test(d.sci), JSON.stringify(d).slice(0, 200));
    await ev(() => { document.querySelector('.fish-book-modal .fish-back').click(); document.querySelectorAll('.fish-book-modal .fish-tab')[1].click(); }); await sleep(400); await shot('book-neighbours');
    const nb = await ev(() => document.querySelectorAll('.fish-book-modal .fish-tile').length);
    await ev(() => { document.querySelectorAll('.fish-book-modal .fish-tab')[2].click(); }); await sleep(400); await shot('book-know');
    const kn = await ev(() => document.querySelectorAll('.fish-book-modal .fish-know-card').length);
    check('… the neighbours of clean water and what to know', nb === 7 && kn === 7, `${nb} · ${kn}`);
    await ev(() => G.ui.modal.closeAll());
    await ev(() => { G.sys.inventory.open?.(); }); await sleep(700); await shot('bag');
    const bag = await ev(() => ({ label: G.sys.inventory.typeLabel('fish'), text: document.querySelector('#modal-root').textContent.includes('산천어') }));
    check('the bag knows the catch (type 물고기)', bag.label === '물고기', JSON.stringify(bag));
    await ev(() => G.ui.modal.closeAll());
  });

  await step('school', async () => {
    const r = await ev(async () => { const f = G.sys.fishing; const s = f._schools.list.find((x) => x.spotId === 'FS_V_POOL') || f._schools.list[0]; const sp = f.spots().find((x) => x.id === s.spotId); await G.sys.player.teleport(sp.x - 5, sp.z + 1, 0, { fade: false }); await new Promise((res) => setTimeout(res, 1500)); const wy = G.data.layout.waterY; G.sys.camera.shot(new THREE.Vector3(s.cx - s.nx * 5 + s.tx * 1.5, wy + 3.4, s.cz - s.nz * 5 + s.tz * 1.5), new THREE.Vector3(s.cx, wy - 0.3, s.cz), { fov: 40, duration: 0 }); return { spot: s.spotId, id: s.id, n: s.fish.length }; });
    await sleep(2200); await shot('school');
    const info = await ev(() => { const i = G.sys.fishing.debug.info(); G.sys.camera.setMode('follow'); return i.schools; });
    check('schools of the spots\' species are in the water: instanced, at most four draw calls', info.fish >= 6 && info.calls >= 1 && info.calls <= 4, `${info.fish} fish · ${info.calls} draw calls · ${[...new Set(info.list)].join(', ')} (looking at ${r.id} by ${r.spot})`);
  });

  await step('easy', async () => {
    await ev(() => { G.setSetting('easyMode', true); }); await sleep(500);
    await goSpot('FS_V_DECK');
    ev(() => { G.sys.fishing.open('FS_V_DECK'); });
    await page.waitForFunction(() => G.ui.modal.isOpen(), null, { timeout: 90000, polling: 100 }); await sleep(900); await shot('easy-pick');
    const pick = await ev(() => ({ inputs: document.querySelectorAll('#modal-root input, #modal-root textarea, #modal-root select').length, tiles: [...document.querySelectorAll('#modal-root .easy-tile')].map((b) => { const r = b.getBoundingClientRect(); return [b.textContent.trim().slice(0, 8), Math.round(Math.min(r.width, r.height))]; }) }));
    check('easy mode: a picture chooser — big tiles (≥ 56 px), no typing', pick.inputs === 0 && pick.tiles.length >= 3 && pick.tiles.every((t) => t[1] >= 56), JSON.stringify(pick.tiles));
    await ev(() => { G.sys.fishing.debug.force('BEODEULCHI'); [...document.querySelectorAll('#modal-root .easy-tile')][0].click(); });
    await phase('ready'); await sleep(900); await shot('easy-ready');
    const ui = await ev(() => { const r = (el) => { const b = el.getBoundingClientRect(); return Math.round(Math.min(b.width, b.height)); }; return { act: r(document.querySelector('.fish-act')), exit: r(document.querySelector('.fish-exit')), book: r(document.querySelectorAll('.fish-top-btn')[1]), hint: document.querySelector('.fish-hint').textContent, method: G.sys.fishing.state.method }; });
    check('easy mode: every control of the session is at least 56 px; the hint is a short sentence', ui.act >= 120 && ui.exit >= 56 && ui.book >= 56 && ui.hint.length <= 40, JSON.stringify(ui));
    await tap(); await phase('bite');
    const win = await ev(() => G.sys.fishing.state.window);
    check('easy mode: the bite window is wide (≥ 1.2 s; here ≥ 2 s)', win >= 2, `${win.toFixed(2)} s`);
    await shot('easy-bite'); await tap(); await ev(() => { window.__hands = 1; });
    await phase(['land', 'card'], 240000);
    const c = await cardOpen(); await shot('easy-card');
    const big = await ev(() => [...document.querySelectorAll('.fish-card-actions .fish-big')].map((b) => Math.round(b.getBoundingClientRect().height)));
    check('easy mode: the card has two big picture buttons', /버들치/.test(c.title) && big.length === 2 && big.every((x) => x >= 56), big.join(' · '));
    await clickCard('release'); await phase('ready');
  });

  await step('phone', async () => {
    if ((await ev(() => G.sys.fishing.state.phase)) === 'idle') { await goSpot('FS_V_DECK'); await ev(() => G.sys.fishing.start('FS_V_DECK', 'rod')); await phase('ready'); }
    const rects = () => ev(() => { const r = (sel) => { const b = document.querySelector(sel).getBoundingClientRect(); return [Math.round(b.left), Math.round(b.top), Math.round(b.right), Math.round(b.bottom)]; }; return { act: r('.fish-act'), top: r('.fish-top'), hint: r('.fish-hint'), exit: r('.fish-exit'), vw: innerWidth, vh: innerHeight }; });
    const inside = (b, p) => b[0] >= 0 && b[1] >= 0 && b[2] <= p.vw && b[3] <= p.vh;
    const apart = (a, b) => a[2] <= b[0] || b[2] <= a[0] || a[3] <= b[1] || b[3] <= a[1];
    await page.setViewportSize({ width: 390, height: 844 }); await sleep(1300); await shot('phone-portrait');
    const p1 = await rects();
    check('phone 390×844: the button, the bar and the hint are inside the screen and do not cover each other', inside(p1.act, p1) && inside(p1.top, p1) && inside(p1.hint, p1) && apart(p1.act, p1.hint) && apart(p1.top, p1.hint) && p1.act[2] - p1.act[0] >= 56 && p1.exit[3] - p1.exit[1] >= 40, JSON.stringify(p1));
    await page.touchscreen.tap((p1.act[0] + p1.act[2]) / 2, (p1.act[1] + p1.act[3]) / 2);
    await phase(['cast', 'wait'], 60000);
    check('a finger on the button casts', true);
    await page.setViewportSize({ width: 844, height: 390 }); await sleep(1300); await shot('phone-landscape');
    const p2 = await rects();
    check('phone on its side 844×390: everything inside the screen, nothing covered', inside(p2.act, p2) && inside(p2.top, p2) && inside(p2.hint, p2) && apart(p2.act, p2.hint) && apart(p2.top, p2.hint), JSON.stringify(p2));
    await ev(() => { G.sys.fishing.book('BEODEULCHI'); }); await sleep(1800); await shot('phone-book');
    const fit = await ev(() => { const m = document.querySelector('.fish-book-modal'); const b = m.getBoundingClientRect(); return [Math.round(b.left), Math.round(b.right), innerWidth, Math.round(b.bottom), innerHeight]; });
    check('the 도감 fits a phone', fit[0] >= 0 && fit[1] <= fit[2] && fit[3] <= fit[4] + 1, fit.join(' '));
    await ev(() => { G.ui.modal.closeAll(); G.sys.fishing.cancel('test'); });
    await page.setViewportSize({ width: 1280, height: 800 }); await sleep(500);
    await ev(() => { G.setSetting('easyMode', false); });
  });

  await step('complex', async () => {
    await ev(async () => { G.sys.fishing.cancel('test'); await G.sys.places.enter('PL_ALLOT', { fade: false }); });
    await page.waitForFunction(() => G.sys.places.is('PL_ALLOT') && G.sys.fishing.spots().some((s) => s.river === 'complex' && s.ready), null, { timeout: TIMEOUT, polling: 250 });
    const sp = await ev(() => { const f = G.sys.fishing; const O = G.sys.places.def('PL_ALLOT').origin; return { spots: f.spots().filter((s) => s.river === 'complex').map((s) => ({ id: s.id, ready: s.ready, x: s.x, z: s.z, water: s.ready ? G.world.isWater(s.x, s.z) : null, ix: !!G.interact.get(s.id), methods: s.methods })), valleyHidden: f._root.visible === false || !f._root.parent?.visible, near: f.nearestSpot()?.id || null, O }; });
    check('the river of 만장대 단지 has its three spots on the bank, registered with the place', sp.spots.length === 3 && sp.spots.every((s) => s.ready && s.water === false && s.ix), sp.spots.map((s) => `${s.id} ${s.ready ? `${(s.x - sp.O.x).toFixed(0)},${(s.z - sp.O.z).toFixed(0)}` : 'not ready'}`).join(' · '));
    check('inside the place the valley\'s signs and schools are not drawn; the nearest spot is one of the place', sp.valleyHidden && /^FS_C_/.test(sp.near || ''), `nearest ${sp.near}`);
    const sid = sp.spots.find((s) => s.methods.includes('rod')).id;
    await goSpot(sid); await sleep(1200); await shot('complex-spot');
    await ev((id) => { G.sys.fishing.debug.force('EUNEO'); window.__hands = 1; return G.sys.fishing.start(id, 'rod'); }, sid);
    await phase('ready'); await sleep(600); await tap();
    await phase('wait'); await sleep(1400); await shot('complex-wait');
    const fl = await ev(() => { const g = G.sys.fishing._gear; return { vis: g.float.visible && G.sys.fishing._gearRoot.visible, water: G.world.isWater(g.float.position.x, g.float.position.z) }; });
    await phase('bite'); await tap();
    await phase(['land', 'card'], 240000);
    const c = await cardOpen(); await shot('card-EUNEO');
    check('a catch at the complex\'s river (은어 in June): the gear is drawn there too, the float is on its water', /은어/.test(c.title) && c.buttons.length === 2 && fl.vis && fl.water, `${c.title} · ${JSON.stringify(fl)}`);
    await clickCard('release'); await ev(() => G.sys.fishing.cancel('test'));
    const cs = await ev(() => G.sys.fishing.debug.info().cxSchools);
    check('the complex\'s river has its own schools (≤ 4 draw calls)', cs && cs.calls <= 4 && cs.list.length >= 3, JSON.stringify(cs).slice(0, 160));
    await ev(async () => { await G.sys.places.exit({ fade: false }); }); await sleep(800);
    check('leaving the place takes its spots away again', await ev(() => G.sys.fishing.spots().filter((s) => s.river === 'complex').every((s) => !s.ready) && !G.interact.get('FS_C_POOL')));
  });

  await step('reload', async () => {
    const before = await ev(async () => { await G.save.save({ reason: 'test' }); const f = G.state.fishing; return { book: Object.keys(f.book).sort().map((k) => [k, f.book[k].n, f.book[k].kept, f.book[k].rel, f.book[k].max]), seen: Object.keys(f.seen).sort(), stats: ['fishCaught', 'fishKept', 'fishReleased', 'fishSpecies', 'fishGuarded'].map((k) => G.state.stats[k]), inv: G.sys.inventory.count('FISH_SANCHEONEO') }; });
    await boot();
    const after = await ev(() => { const f = G.state.fishing; return { book: Object.keys(f.book).sort().map((k) => [k, f.book[k].n, f.book[k].kept, f.book[k].rel, f.book[k].max]), seen: Object.keys(f.seen).sort(), stats: ['fishCaught', 'fishKept', 'fishReleased', 'fishSpecies', 'fishGuarded'].map((k) => G.state.stats[k]), inv: G.sys.inventory.count('FISH_SANCHEONEO') }; });
    check('a reload keeps the 어류 도감, the neighbours, the counters and the fish in the bag', before.book.length >= 1 && JSON.stringify(before) === JSON.stringify(after), `${JSON.stringify(after).slice(0, 220)}`);
  });

  const lint = await ev(() => { try { const dc = G.sys.devcenter || G.devcenter; const r = typeof dc?.lint === 'function' ? dc.lint() : (typeof dc?.dataLint === 'function' ? dc.dataLint() : null); if (!r) return null; const items = Array.isArray(r) ? r : (r.items || r.issues || []); return items.filter((x) => (x.level || x.sev) === 'error').map((x) => `${x.area || x.cat || ''} ${x.msg || x.text || ''} ${x.at || ''}`).filter((t) => /FISH|fish|낚시|물고기|FS_/.test(t)).slice(0, 6); } catch (e) { return ['lint failed: ' + e.message]; } });
  if (lint) check('the developer centre\'s data lint has no error about fishing', lint.length === 0, lint.join(' | '));
  check('no page error', pageErrors.length === 0, pageErrors.slice(0, 4).join(' | '));
} catch (e) {
  check('the test ran to its end', false, String(e?.stack || e).split('\n').slice(0, 3).join(' | '));
} finally {
  await browser.close();
  if (tmpDir && !flag('--keep')) { try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) { /* leave it */ } }
}
const failed = results.filter((r) => !r.ok);
if (jsonOut) console.log(JSON.stringify({ ok: failed.length === 0, passed: results.length - failed.length, failed: failed.length, quality: QUALITY, results }, null, 1));
else log(`\n${failed.length ? '✖' : '✔'} ${results.length - failed.length}/${results.length} checks passed (quality ${QUALITY})`);
process.exit(failed.length ? 1 : 0);
