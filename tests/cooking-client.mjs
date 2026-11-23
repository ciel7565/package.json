#!/usr/bin/env node
// =============================================================================
// tests/cooking-client.mjs — the kitchen in the page (CONTRACT §18.4, lane cooking). LOCAL (file) mode.
//
//   node tests/cooking-client.mjs                        builds a private page (tools/build.mjs --out <tmp>) and tests it
//   node tests/cooking-client.mjs --file /abs/page.html  test an already built page
//   options: --json · --headed · --timeout <ms> · --mode easy|normal (default normal; easy runs the kid checks too) ·
//            --phone (390 × 844 touch, also 844 × 390) · --shots <dir> (evidence pictures at quality=high) · --only a,b
//
// Steps: the 부엌 builds its stations (place:built) with interactables, colliders and the room budget (≤ 200 draw calls
//   with the stations and a cooking dish) · a fish dish from the catch to the table (the real controls: hold, the fire
//   band, taps, the turn window, the seasoning pick) — the food changes (cook level, crust, salt), the fish leaves the
//   bag only when it is served, stars, the 요리 도감, the 소반, quests (interact events), stats · a 정선 dish from the
//   찬장 and the fields (곤드레밥: 누룽지) · a protected fish is never an ingredient · cancel uses nothing up · the 화덕
//   by the river cooks an outdoor dish · easy mode: no text inputs, voice lines, 56 px targets on the cooking card ·
//   reload keeps the 도감 · the phone layout keeps the card on the screen.
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
const jsonOut = flag('--json');
const MODE = opt('--mode', 'normal') === 'easy' ? 'easy' : 'normal';
const PHONE = flag('--phone');
const SHOTS = opt('--shots');
const ONLY = (opt('--only') || '').split(',').filter(Boolean);
const want = (id) => !ONLY.length || ONLY.includes(id);
const log = (...a) => { if (!jsonOut) console.log(...a); };

let file = opt('--file');
if (!file) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tfm-cooking-'));
  file = path.join(tmp, 'index.html');
  const b = spawnSync(process.execPath, [path.join(ROOT, 'tools/build.mjs'), '--no-font', '--quiet', '--out', file], { encoding: 'utf8' });
  if (b.status !== 0) { console.error(b.stderr || b.stdout); process.exit(2); }
}
if (!fs.existsSync(file)) { console.error(`page not found: ${file}`); process.exit(2); }
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail: typeof detail === 'string' ? detail.slice(0, 500) : JSON.stringify(detail).slice(0, 500) }); log(`${ok ? '  ✔' : '  ✖'} ${name}${ok || detail === '' ? '' : ' — ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 500)}`); };

const browser = await chromium.launch({ headless: !flag('--headed'), args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--autoplay-policy=no-user-gesture-required'] });
const vp = PHONE ? { width: 390, height: 844 } : SHOTS ? { width: 1280, height: 720 } : { width: 1280, height: 800 };
const context = await browser.newContext({ viewport: vp, locale: 'ko-KR', timezoneId: 'Asia/Seoul', ...(PHONE ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}) });
if (MODE === 'normal') await context.addInitScript(() => { try { const s = JSON.parse(localStorage.getItem('tfm.v1.settings') || '{}'); s.easyMode = false; s._v = 2; localStorage.setItem('tfm.v1.settings', JSON.stringify(s)); } catch (e) { /* storage blocked */ } });
const page = await context.newPage();
await page.route('**/*', (route) => (/^(file|data|blob):/.test(route.request().url()) ? route.continue() : route.abort()));
const pageErrors = [], consoleErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e?.message || e).slice(0, 300)));
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 300)); });
const quality = SHOTS ? 'high' : 'low';
const url = `${pathToFileURL(file).href}?autostart=1&notutorial=1&quality=${quality}`;
const ev = (fn, a) => page.evaluate(fn, a);
const wait = (ms) => page.waitForTimeout(ms);

async function boot() {
  await page.goto(url, { waitUntil: 'load', timeout: TIMEOUT });
  await page.waitForFunction(() => window.G && window.G.ready === true && !!window.G.sys?.cooking, null, { timeout: TIMEOUT, polling: 250 });
  await ev(() => { G.ui.modal.closeAll(); try { G.sys.weather.setLockTime(true); G.sys.weather.setAuto(false); G.sys.weather.setHour(11); } catch (e) { /* weather optional */ } });
}
async function enterKitchen() {
  await ev(async () => { if (!G.sys.places.is('PL_BUEOK')) await G.sys.places.enter('PL_BUEOK', { fade: false }); });
  await page.waitForFunction(() => !!window.G.sys.cooking.test.room, null, { timeout: 60000, polling: 250 });
}
async function shot(name) {
  if (!SHOTS) return;
  await wait(1200);
  await page.screenshot({ path: path.join(SHOTS, name + '.png'), timeout: 240000 });
  log(`    📸 ${name}.png`);
}
/** drive the current dish until it is served: the kitchen's own autoplay (the same press / release / pick a finger
 *  makes, on the kitchen's clock — this machine draws < 1 frame a second under load); with shots it stops before each
 *  listed action, lets the frames show it and takes a picture */
async function cook(opts = {}) {
  const shotAt = new Set(opts.shotSteps || []);
  const log = [];
  if (opts.shot && shotAt.size) {
    const actions = await ev(() => { const s = window.G.sys.cooking.state; return s ? window.G.data.cooking.dishes[s.dish].steps.map((x) => x.action) : []; });
    for (let i = 0; i < actions.length; i++) {
      if (!shotAt.has(actions[i])) continue;
      shotAt.delete(actions[i]);
      // run up to this step, then into it a little (the food shows the step's change), then the picture
      log.push(...await ev((i) => window.G.sys.cooking.test.autoplay(900, { stopAt: i }), i));
      await ev(() => { const C = window.G.sys.cooking; C.timeScale = 1; const a = C.state?.action; if (C.state?.mode === 'hold' || C.state?.mode === 'fire') C.test.down(); C.test.tick(['grill', 'fry', 'boil', 'steam'].includes(a) ? 7 : a === 'fire' ? 1.8 : 2); });
      await shot(`${opts.shot}-${String(i).padStart(2, '0')}-${actions[i]}`);
    }
  }
  log.push(...await ev((season) => window.G.sys.cooking.test.autoplay(900, season === undefined ? {} : { season }), opts.season));
  return log;
}

let exitCode = 0;
try {
  await boot();
  log(`cooking-client · ${MODE} · ${PHONE ? 'phone 390×844' : `${vp.width}×${vp.height}`} · quality=${quality}`);

  // ------------------------------------------------------------ the kitchen builds its stations
  if (want('room')) {
    await enterKitchen();
    const r = await ev(() => {
      const C = window.G.sys.cooking, R = C.test.room;
      const kit = (window.G.interact.list?.('kitchen') || []).map((e) => e.id);
      return { spots: Object.keys(R.spots), kit, colliders: R.colliders.length, fires: Object.keys(R.fires), stations: C.stations().length };
    });
    check('the 부엌 has its stations (물두멍 · 도마 · 가마솥 · 시루 · 화로 · 솥뚜껑 · 맷돌 · 양념 선반 · 찬장 · 소반)', ['muldumeong', 'doma', 'gamasot', 'siru', 'hwaro', 'sotttukkeong', 'maetdol', 'yangnyeom', 'chanjang', 'soban'].every((k) => r.spots.includes(k)), r.spots);
    check('every station has an interactable of kind kitchen', r.kit.length >= 10, r.kit);
    check('the new furniture has colliders', r.colliders >= 5, r.colliders);
    await wait(1500);
    const dc = await ev(() => { const E = window.G.sys.engine; E.renderer.info.autoReset = true; return new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(() => res({ calls: E.renderer.info.render.calls, tris: E.renderer.info.render.triangles })))); });
    check('the room with its stations stays within 200 draw calls', dc.calls > 0 && dc.calls <= 200, dc);
    await shot('kitchen-day');
  }

  // ------------------------------------------------------------ a fish dish from the catch to the table
  if (want('fish')) {
    await enterKitchen();
    const prep = await ev(() => {
      const G = window.G, C = G.sys.cooking, D = G.data.cooking;
      const trout = D.fishFor('trout');
      const prot = (G.data.fish?.species || []).filter((s) => s.protected).map((s) => 'FISH_' + s.id);
      const id = trout[0]?.itemId;
      const added = id ? G.sys.inventory.add(id, 2, { source: 'fishing' }) : 0;
      G.sys.inventory.add('ITEM_SCALLION', 1, { source: 'test' });
      return { id, added, prot, trout: trout.map((t) => t.id), can: C.can('DISH_SOGEUMGUI') };
    });
    check('a trout-class fish exists and is not protected', !!prep.id && !prep.prot.includes(prep.id), prep);
    check('소금구이 can be cooked with that catch', prep.can.ok, prep.can);
    const started = await ev(() => { const C = window.G.sys.cooking; C.timeScale = 10; return C.start('DISH_SOGEUMGUI'); });
    check('cooking starts in the 부엌', started === true);
    const dock = await ev(() => { const d = document.querySelector('.cook-dock'); const b = d?.querySelector('.cook-big'); const r = b?.getBoundingClientRect(); return d ? { big: r ? [Math.round(r.width), Math.round(r.height)] : null, say: !!d.querySelector('[data-say]'), stop: !!d.querySelector('.cook-stop'), inputs: d.querySelectorAll('input, textarea').length } : null; });
    check('the cooking card is up with a big button, a way out and voice lines, no typing', dock && dock.stop && dock.say && dock.inputs === 0 && dock.big && dock.big[0] >= 56 && dock.big[1] >= 56, dock);
    const ptr = await ev(() => { const b = document.querySelector('.cook-big'); const o = { pointerId: 1, bubbles: true, isPrimary: true }; b.dispatchEvent(new PointerEvent('pointerdown', o)); const down = window.G.sys.cooking.state.hold; window.G.sys.cooking.timeScale = 1; window.G.sys.cooking.test.tick(0.5); const p = window.G.sys.cooking.state.progress; b.dispatchEvent(new PointerEvent('pointerup', o)); return { down, p, up: window.G.sys.cooking.state.hold }; });
    check('the big button holds while pressed and lets go (a real pointer on the card)', ptr.down === true && ptr.up === false && ptr.p > 0, ptr);
    const midFish = await ev(() => window.G.sys.inventory.count(window.G.data.cooking.fishFor('trout')[0].itemId));
    check('the fish stays in the bag while cooking (taken only when served)', midFish === 2, midFish);
    const seen = await cook({ ts: 10, shot: SHOTS ? 'fish' : null, shotSteps: ['wash', 'scale', 'salt', 'fire', 'grill', 'turn', 'serve'] });
    const after = await ev(() => { const G = window.G; const id = G.data.cooking.fishFor('trout')[0].itemId; return { state: G.sys.cooking.state, book: G.state.cooking.book.DISH_SOGEUMGUI, table: G.state.cooking.table.slice(-1)[0], fish: G.sys.inventory.count(id), result: !!document.querySelector('.cook-result'), stats: { c: G.sys.progression.getStat('dishesCooked'), k: G.sys.progression.getStat('dishKinds') }, served: G.sys.cooking.test.room?.servedModels?.length || 0 }; });
    log('    steps: ' + seen.map((x) => `${x.action}:${x.mode}:${x.sec}s`).join(' '));
    check('every step was cooked with the controls (hold · taps · fire · wait · window · tap), slowly (≥ 40 s of the kitchen clock)', seen.filter((x) => x.step != null).length >= 10 && seen.reduce((a, x) => a + (x.sec || 0), 0) >= 40 && ['hold', 'taps', 'fire', 'wait', 'window', 'tap'].every((m) => seen.some((x) => x.mode === m)), seen.map((x) => x.action + ':' + x.mode).join(' '));
    check('the dish is served: no session, the book has it with stars', !after.state && after.book && after.book.n === 1 && after.book.best >= 1, after);
    check('one fish was used up when it was served', after.fish === 1, after.fish);
    check('the dish lies on the 소반 (3D) and in the table list', after.served >= 1 && after.table?.d === 'DISH_SOGEUMGUI', after);
    check('the result card shows', after.result);
    check('stats count it (dishesCooked, dishKinds)', after.stats.c >= 1 && after.stats.k >= 1, after.stats);
    if (SHOTS) await shot('fish-result');
    await ev(() => window.G.ui.modal.closeAll());
    if (SHOTS) { await ev(() => window.G.sys.cooking.test.frame('soban', 1.1)); await shot('fish-table'); await ev(() => window.G.sys.camera.setMode('follow')); }
  }

  // ------------------------------------------------------------ the food changes as it cooks (model checks, no clock)
  if (want('model')) {
    const m = await ev(() => {
      const C = window.G.sys.cooking;
      const out = {};
      for (const id of ['DISH_SOGEUMGUI', 'DISH_MAEUNTANG', 'DISH_GONDEUREBAP', 'DISH_KIMCHIJEON']) {
        const raw = C.model(id, { cook: 0 }), done = C.model(id, { cook: 1 });
        const colour = (x) => { let c = null; x.group.traverse((o) => { if (!c && o.isMesh && o.material && o.material.color && o.name !== 'v') c = o.material.color.getHexString(); }); return c; };
        const fish = done.parts.fish[0];
        out[id] = { meshes: (() => { let n = 0; done.group.traverse((o) => { if (o.isMesh || o.isInstancedMesh || o.isSprite) n++; }); return n; })(), raw: raw.parts.tint.map((t) => t.m.color.getHexString()).join(), done: done.parts.tint.map((t) => t.m.color.getHexString()).join(), crust: done.parts.crust, fishCrust: fish ? fish.group.children[2].material.opacity : null, nurungji: done.parts.nurungji ? done.parts.nurungji.visible : null };
        raw.dispose(); done.dispose();
      }
      return out;
    });
    check('a grilled fish gets its crust (석쇠 marks) when done', m.DISH_SOGEUMGUI.fishCrust > 0.5, m.DISH_SOGEUMGUI);
    check('broth and chunks change colour from raw to cooked', m.DISH_MAEUNTANG.raw !== m.DISH_MAEUNTANG.done, m.DISH_MAEUNTANG);
    check('the rice of 곤드레밥 has its 누룽지 when done', m.DISH_GONDEUREBAP.nurungji === true, m.DISH_GONDEUREBAP);
    check('a dish model stays within 40 meshes (one cooking dish adds few draw calls)', Object.values(m).every((x) => x.meshes <= 40), Object.fromEntries(Object.entries(m).map(([k, v]) => [k, v.meshes])));
  }

  // ------------------------------------------------------------ a 정선 dish from the 찬장 and the fields
  if (want('jeongseon')) {
    await enterKitchen();
    const p = await ev(() => {
      const G = window.G, C = G.sys.cooking;
      G.ui.modal.closeAll();
      C.pantry();
      const tiles = [...document.querySelectorAll('.cook-modal [data-item]')].map((b) => b.dataset.item);
      document.querySelector('.cook-modal [data-item="ITEM_GONDEURE"]')?.click();
      const got = G.sys.inventory.count('ITEM_GONDEURE');
      document.querySelector('.cook-modal [data-item="ITEM_GONDEURE"]')?.click();
      const again = G.sys.inventory.count('ITEM_GONDEURE');
      G.ui.modal.closeAll();
      G.sys.inventory.add('ITEM_GANJANG', 1, { source: 'test' });
      return { tiles, got, again, can: C.can('DISH_GONDEUREBAP') };
    });
    check('the 찬장 lists the kitchen staples', p.tiles.length >= 9, p.tiles);
    check('the 찬장 gives three of a staple once a day (a second tap gives none)', p.got === 3 && p.again === 3, p);
    check('곤드레밥 can be cooked from the 찬장 (rice from the kitchen when the bag has none)', p.can.ok, p.can);
    await ev(() => { const C = window.G.sys.cooking; C.timeScale = 14; C.start('DISH_GONDEUREBAP'); });
    const seen = await cook({ ts: 14, season: undefined });
    const r = await ev(() => ({ book: window.G.state.cooking.book.DISH_GONDEUREBAP, gondeure: window.G.sys.inventory.count('ITEM_GONDEURE'), ganjang: window.G.sys.inventory.count('ITEM_GANJANG') }));
    check('곤드레밥 is served (with my own 간장 as seasoning)', r.book && r.book.n === 1 && r.ganjang === 0 && r.gondeure === 2, { r, steps: seen.length });
    await ev(() => window.G.ui.modal.closeAll());
  }

  // ------------------------------------------------------------ protected fish, cancel, the 도감, quests
  if (want('rules')) {
    const r = await ev(() => {
      const G = window.G, C = G.sys.cooking, D = G.data.cooking;
      const prot = (G.data.fish?.species || []).filter((s) => s.protected).map((s) => s.id);
      const all = ['small', 'trout', 'bottom'].flatMap((c) => D.fishFor(c).map((f) => f.id));
      return { prot: prot.length, leak: all.filter((id) => prot.includes(id)) };
    });
    check('no protected species is ever an ingredient', r.leak.length === 0, r);
    await enterKitchen();
    const c = await ev(async () => {
      const G = window.G, C = G.sys.cooking;
      G.ui.modal.closeAll();
      G.sys.inventory.add('ITEM_POTATO', 2, { source: 'test' });
      const before = G.sys.inventory.count('ITEM_POTATO');
      C.start('DISH_GAMJA');
      const active = !!C.state;
      C.cancel();
      return { active, before, after: G.sys.inventory.count('ITEM_POTATO'), state: C.state, dock: !!document.querySelector('.cook-dock'), blocked: G.ui.isBlocking() };
    });
    check('cancel stops at once and uses nothing up', c.active && !c.state && !c.dock && c.after === c.before && !c.blocked, c);
    const b = await ev(() => { const G = window.G; G.ui.modal.closeAll(); G.sys.cooking.book(); const tiles = document.querySelectorAll('.cook-book [data-dish]').length, made = document.querySelectorAll('.cook-book .cook-tile.made').length; return { tiles, made, title: document.querySelector('.cook-book h2')?.textContent || '' }; });
    check('the 요리 도감 shows every dish and the ones made', b.tiles >= 24 && b.made >= 1, b);
    if (SHOTS) { await wait(4000); await shot('cook-book'); }
    await ev(() => window.G.ui.modal.closeAll());
    const q = await ev(() => { const st = window.G.state.quests || {}; return { first: st.Q_COOK_FIRST?.status, book: st.Q_COOK_BOOK?.progress }; });
    check('the first-dish quest moved on', ['complete', 'completed', 'claimable', 'claimed', 'done'].includes(q.first) || (q.first && q.first !== 'active' && q.first !== 'locked'), q);
  }

  // ------------------------------------------------------------ the 화덕 by the river
  if (want('river')) {
    const r = await ev(async () => {
      const G = window.G, C = G.sys.cooking;
      if (G.sys.places.current) await G.sys.places.exit({ fade: false });
      C.test.buildRiver();
      const R = C.test.river;
      if (!R) return { built: false };
      await G.sys.player.teleport(R.at.x + 1.4, R.at.z + 1.4, -2.4, { fade: false });
      const small = G.data.cooking.fishFor('small');
      G.sys.inventory.add(small[0].itemId, 3, { source: 'fishing' });
      C.timeScale = 14;
      const ok = C.start('DISH_DORIBAENGBAENG', { where: 'river' });
      const refuse = (() => { C.cancel(); return C.start('DISH_GONDEUREBAP', { where: 'river' }); })();
      const ok2 = C.start('DISH_DORIBAENGBAENG', { where: 'river' });
      return { built: true, ok, refuse, ok2, at: R.at };
    });
    check('the 화덕 stands by the river and an outdoor dish starts there', r.built && r.ok && r.ok2, r);
    check('a kitchen-only dish is not cooked at the 화덕', r.refuse === false, r);
    if (SHOTS) await shot('river-hwadeok');
    await cook({ ts: 14 });
    const done = await ev(() => window.G.state.cooking.book.DISH_DORIBAENGBAENG);
    check('도리뱅뱅이 is cooked at the river', done && done.n === 1, done);
    if (SHOTS) { await ev(() => window.G.ui.modal.closeAll()); await shot('river-served'); }
    await ev(() => window.G.ui.modal.closeAll());
  }

  // ------------------------------------------------------------ easy mode, phone layout
  if (want('easy') && MODE === 'easy') {
    await enterKitchen();
    const e = await ev(() => {
      const G = window.G, C = G.sys.cooking;
      G.ui.modal.closeAll();
      G.sys.inventory.add('ITEM_CORN', 2, { source: 'test' });
      C.start('DISH_OKSUSU');
      const d = document.querySelector('.cook-dock');
      const btns = [...d.querySelectorAll('button')].map((b) => { const r = b.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; });
      const r = d.getBoundingClientRect();
      const out = { btns, inView: r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight + 1, note: !!d.querySelector('.cook-note'), say: d.querySelectorAll('[data-say]').length };
      C.cancel();
      return out;
    });
    check('easy: every button on the cooking card is ≥ 56 px', e.btns.every(([w, h]) => w >= 56 && h >= 56), e.btns);
    check('easy: no grown-up note, voice lines on the card', !e.note && e.say >= 2, e);
    check('the cooking card fits the screen', e.inView, e);
  }
  if (PHONE) {
    await enterKitchen();
    const ph = await ev(() => { const G = window.G, C = G.sys.cooking; G.ui.modal.closeAll(); G.sys.inventory.add('ITEM_POTATO', 2, { source: 'test' }); C.start('DISH_GAMJA'); const d = document.querySelector('.cook-dock').getBoundingClientRect(); const b = document.querySelector('.cook-big').getBoundingClientRect(); const o = { d: [d.left, d.right, d.bottom, innerWidth, innerHeight], b: [b.width, b.height] }; return o; });
    check('phone: the cooking card is inside the screen and its button is big', ph.d[0] >= 0 && ph.d[1] <= ph.d[3] && ph.d[2] <= ph.d[4] + 1 && ph.b[0] >= 56 && ph.b[1] >= 56, ph);
    if (SHOTS) await shot('phone-cooking');
    await ev(() => window.G.sys.cooking.cancel());
  }

  // ------------------------------------------------------------ reload keeps the 도감
  if (want('reload')) {
    await ev(async () => { await window.G.save.save({ reason: 'test' }); });
    await boot();
    const k = await ev(() => Object.keys(window.G.state.cooking?.book || {}));
    check('the 요리 도감 is kept after a reload', ONLY.length && !ONLY.includes('fish') ? true : k.includes('DISH_SOGEUMGUI'), k);
  }

  const se = await ev(() => ({ sys: (window.G.__systemErrors || []).filter((x) => x.system === 'cooking').map((x) => x.message.slice(0, 300)), frame: window.G.sys.cooking._lastError || null, n: window.G.sys.cooking.errors || 0 }));
  check('no errors in the kitchen system (init, frames)', !se.sys.length && !se.n, se);
  check('no page errors', pageErrors.length === 0, pageErrors);
  check('no console errors', consoleErrors.length === 0, consoleErrors.slice(0, 5));
} catch (e) {
  check('the run finished', false, String(e?.stack || e).slice(0, 600));
  exitCode = 2;
}
await browser.close();
const failed = results.filter((r) => !r.ok);
if (jsonOut) console.log(JSON.stringify({ ok: failed.length === 0, total: results.length, failed, results }, null, 1));
else log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(exitCode || (failed.length ? 1 : 0));
