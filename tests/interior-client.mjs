#!/usr/bin/env node
// =============================================================================
// tests/interior-client.mjs — 집 구경: the places system (CONTRACT §16.4) and every room / district that is defined
//                             (§16.5), in LOCAL mode on the file:// page.
//
//   node tests/interior-client.mjs                       builds a private page (tools/build.mjs --no-assets --out <tmp>)
//   node tests/interior-client.mjs --file /abs/page.html test an already built page
//   options: --keep (leave the temp build) · --json · --headed · --timeout <ms> · --ui-timeout <ms> (one step, 45000)
//            --watch <s> (how long the night watch stays inside, default 20) · --skip-medium (no second page on medium)
//            --skip-phone · --context-loss (also lose and restore the GL context inside, medium page)
//            --assets (embed the asset pack in the private build) · --shots <dir> (a picture of each place)
//   Run it through the shared browser lock (at most two browsers on the build machine).
//
// For EVERY defined place: a door interactable with a kid label (radius ≥ 3 m) → walk in through it → the HUD chip with
//   a big way back, the place's own bounds / ground / zone, the valley hidden → out by the chip button, back at the door
//   → in again through the 가기 picture menu (the first place) or travel() → draw calls within the budget, the minimap
//   plan, the next-step card showing the door, presence in place-local metres, the companion inside, no double jump under
//   a ceiling → out by the exit door, position restored.
// Once: a save made inside resumes outside after a reload · 가기 to a far zone from inside leaves first · logout inside ·
//   rain stays outside · night watch (no watchdog trip, never a black block) on low, then on medium with the lamps on ·
//   a quality change inside · the environment texture object survives enter / exit · the phone viewport 390×844 (and the
//   same phone turned on its side): the chip fits, the way back is at least 56 px, a tap leaves.
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
const T_UI = Number(opt('--ui-timeout', '45000'));   // one step: software WebGL on a busy machine can stall for seconds
const WATCH = Math.max(4, Number(opt('--watch', '20'))) * 1000;
const CALL_BUDGET = 200;                              // §16.5: one room ≤ 200 draw calls
const jsonOut = flag('--json');
const shotDir = opt('--shots');
const log = (...a) => { if (!jsonOut) console.log(...a); };

let file = opt('--file');
let tmpDir = null;
if (!file) {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tfm-interior-'));
  file = path.join(tmpDir, 'index.html');
  const b = spawnSync(process.execPath, [path.join(ROOT, 'tools/build.mjs'), '--no-font', '--quiet', '--strict', ...(flag('--assets') ? [] : ['--no-assets']), '--out', file], { encoding: 'utf8' });
  if (b.status !== 0) { console.error(b.stderr || b.stdout); process.exit(2); }
}
if (!fs.existsSync(file)) { console.error(`page not found: ${file}`); process.exit(2); }
if (shotDir) fs.mkdirSync(shotDir, { recursive: true });

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail: String(detail ?? '').slice(0, 400) }); log(`${ok ? '  ✔' : '  ✖'} ${name}${detail !== '' && detail != null ? ` — ${String(detail).slice(0, 300)}` : ''}`); };

const browser = await chromium.launch({ headless: !flag('--headed'), args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--autoplay-policy=no-user-gesture-required'] });
const pageErrors = [], consoleErrors = [];
/** a fresh page: local files only; page errors and console errors are collected with a tag */
async function open(tag, ctxOpts) {
  const context = await browser.newContext({ locale: 'ko-KR', timezoneId: 'Asia/Seoul', ...ctxOpts });
  const page = await context.newPage();
  await page.route('**/*', (route) => (/^(file|data|blob):/.test(route.request().url()) ? route.continue() : route.abort()));
  page.on('pageerror', (e) => pageErrors.push(`[${tag}] ${String(e?.message || e).slice(0, 300)}`));
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(`[${tag}] ${m.text().slice(0, 300)}`); });
  return { page, context };
}
async function boot(page, quality, extra = '') {
  await page.goto(`${pathToFileURL(file).href}?autostart=1&notutorial=1&quality=${quality}${extra}`, { waitUntil: 'load', timeout: TIMEOUT });
  await page.waitForFunction(() => window.G && window.G.ready === true && !!window.G.state && !!window.G.sys?.places && !!window.G.sys?.player?._ready, null, { timeout: TIMEOUT, polling: 250 });
  await page.evaluate(() => { try { G.ui.modal.closeAll(); } catch (e) { /* nothing open */ } });
}
/** wait until the places system is settled in `id` (null = outside) */
const settled = (page, id, t = T_UI) => page.waitForFunction((id) => { const P = G.sys.places; return P.current === id && !P.busy; }, id, { timeout: t, polling: 150 }).then(() => true, () => false);
/** what the page says about where we are */
const where = (page) => page.evaluate(() => {
  const P = G.sys.places, pl = G.sys.player, E = G.sys.engine, W = G.world, cur = P.current, d = cur ? P.def(cur) : null;
  const chip = document.getElementById('place-chip'), btn = chip && chip.querySelector('.pc-exit');
  const vis = (el) => { if (!el || el.hidden) return false; const r = el.getBoundingClientRect(), cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.display !== 'none' && cs.visibility !== 'hidden'; };
  const rect = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), r: Math.round(r.right), b: Math.round(r.bottom) }; };
  const root = (n) => { const o = E.scene.getObjectByName(n); return o ? o.visible : null; };
  let zone = null;
  try { zone = W.zoneAt(pl.position.x, pl.position.z)?.id || null; } catch (e) { zone = 'ERR ' + e.message; }
  return {
    cur, busy: P.busy, indoor: P.indoor, x: +pl.position.x.toFixed(2), y: +pl.position.y.toFixed(2), z: +pl.position.z.toFixed(2), rotY: +pl.rotY.toFixed(2),
    zone, bounds: W.bounds ? [W.bounds.minX, W.bounds.maxX, W.bounds.minZ, W.bounds.maxZ].map((v) => Math.round(v)) : null,
    far: Math.round(E.camera.far), engineIndoor: +E.indoor.toFixed(2), calls: E.frameInfo.calls, tris: E.frameInfo.triangles, quality: E.quality,
    chip: { visible: vis(chip), text: chip ? chip.textContent.replace(/\s+/g, ' ').trim() : '', rect: rect(chip), btn: rect(btn), btnVisible: vis(btn), say: btn ? btn.getAttribute('data-say') : null, label: btn ? (btn.getAttribute('aria-label') || btn.textContent.trim()) : null },
    roots: { buildings: root('buildings'), terrain: root('terrain-core'), nature: root('nature'), npcs: root('npcs') },
    inBounds: d ? Math.abs(pl.position.x - d.origin.x) <= d.size.w / 2 + 2.5 && Math.abs(pl.position.z - d.origin.z) <= d.size.d / 2 + 2.5 : null,
    visits: cur ? (G.state.places?.visits?.[cur] | 0) : null,
    vw: window.innerWidth, vh: window.innerHeight, easy: G.easy?.on === true,
  };
});
/** click a picture tile of the open easy pick by its label; returns the labels seen */
async function pickTile(page, label) {
  await page.waitForFunction((label) => [...document.querySelectorAll('.easy-pick .easy-tile .et-label')].some((e) => e.textContent.trim() === label), label, { timeout: T_UI, polling: 150 });
  const labels = await page.evaluate(() => [...document.querySelectorAll('.easy-pick .easy-tile .et-label')].map((e) => e.textContent.trim()));
  await page.evaluate((label) => { const t = [...document.querySelectorAll('.easy-pick .easy-tile')].find((b) => b.querySelector('.et-label')?.textContent.trim() === label); t.click(); }, label);
  return labels;
}
/** wait until the engine has drawn n more frames (a loaded software-GL page can stall for seconds after a fade: numbers
 *  read before that are the last frame of the valley) */
const frames = (page, n = 4, ms = 30000) => page.evaluate(async ({ n, ms }) => {
  const info = G.sys.engine?.renderer?.info?.render, f0 = info ? info.frame : 0, t0 = performance.now();
  while (performance.now() - t0 < ms) {
    await new Promise((r) => requestAnimationFrame(() => r()));
    if (!info || info.frame - f0 >= n) return true;
  }
  return false;
}, { n, ms });
const near = (a, b, tol) => !!a && !!b && Math.hypot(a.x - b.x, a.z - b.z) <= tol;
const nightIn = (page, hour = 22) => page.evaluate((hour) => {
  const w = G.sys.weather;
  w.setLockTime(true); w.setAuto(false); w.setHour(hour);
  const ids = Object.keys(G.data.weather || {}), clear = ids.find((i) => /CLEAR|SUNNY|FINE/i.test(i)) || ids[0];
  if (clear) w.set(clear, { instant: true });
  return { hour: w.hour ?? hour, night: +(G.world.nightFactor || 0).toFixed(2) };
}, hour);
/** stay inside for WATCH ms and report what the screen watchdog saw */
async function watchInside(page, tag) {
  const before = await page.evaluate(() => { const wd = G.gfx.guard.watchdog; return { probes: wd.probes, anomalies: wd.anomalies }; });
  await page.waitForTimeout(WATCH);
  const r = await page.evaluate(() => {
    const wd = G.gfx.guard.watchdog, E = G.sys.engine;
    try { E.render({ force: true, probe: true }); } catch (e) { /* the regular probes are enough */ }
    const lamps = []; E.scene.traverse((o) => { if (o.isPointLight && o.intensity > 0.01) lamps.push(+o.intensity.toFixed(2)); });
    return { state: wd.state, step: wd.step, probes: wd.probes, anomalies: wd.anomalies, last: wd.last ? { black: +wd.last.black.toFixed(4), white: +wd.last.white.toFixed(4) } : null, enabled: wd.enabled, cur: G.sys.places.current, calls: E.frameInfo.calls, quality: E.quality, night: +(G.world.nightFactor || 0).toFixed(2), lamps: lamps.length, composer: !!E.composer };
  });
  check(`${tag}: ${Math.round(WATCH / 1000)} s inside at night — the screen watchdog stays calm`, r.enabled && r.state === 'watching' && r.step === 0 && r.anomalies === before.anomalies && r.probes > before.probes, JSON.stringify(r));
  check(`${tag}: no black or white block on the screen`, !!r.last && r.last.black < 0.05 && r.last.white < 0.05, JSON.stringify(r.last));
  check(`${tag}: draw calls within the budget (≤ ${CALL_BUDGET})`, r.calls > 0 && r.calls <= CALL_BUDGET, `${r.calls} calls`);
  return r;
}

let exitCode = 0;
try {
  log(`🏠 interior client test — ${file}`);
  // ============================================================================================ page 1: desktop, low
  let { page, context } = await open('low', { viewport: { width: 1280, height: 800 } });
  await boot(page, 'low');
  check('fragments loaded (G.sys.places, G.hanok)', await page.evaluate(() => !!G.sys.places && typeof G.sys.places.enter === 'function' && !!G.hanok && typeof G.hanok.room === 'function'));
  const easy0 = await page.evaluate(() => { if (!G.easy.on) G.easy.set(true); return G.easy.on === true; });
  check('easy mode is on (the kid checks below assume it)', easy0);
  const places = await page.evaluate(() => G.sys.places.list().map((p) => { const d = G.sys.places.def(p.id); return { id: p.id, name: p.name, kidName: p.kidName, emoji: p.emoji, indoor: p.indoor, zoneId: p.zoneId, origin: d.origin, size: d.size, spawn: d.spawn, exit: d.exit ? { x: d.exit.x, z: d.exit.z, rotY: d.exit.rotY } : null, door: d.door ? { x: d.door.x, z: d.door.z } : null, hasMinimap: typeof d.minimap === 'function', keepAlive: !!d.keepAlive }; }));
  check('at least one place is defined', places.length >= 1, places.map((p) => p.id).join(' '));
  const valley = await where(page);
  check('outside to begin with: no chip, the valley is shown', valley.cur === null && !valley.chip.visible && valley.roots.buildings === true && valley.engineIndoor === 0, JSON.stringify({ cur: valley.cur, chip: valley.chip.visible, roots: valley.roots }));

  // ---------------------------------------------------------------- definitions and doors
  const doors = await page.evaluate(() => G.interact.list('door').map((e) => ({ id: e.id, radius: e.radius, label: e.label, kidLabel: e.kidLabel, emoji: e.emoji })));
  const zoneIds = new Set(places.map((p) => p.zoneId));
  check('every place has its own ZONE_PL_* zone id', zoneIds.size === places.length && places.every((p) => /^ZONE_PL_[A-Z0-9_]+$/.test(p.zoneId)), [...zoneIds].join(' '));
  const dangling = doors.filter((d) => /^DOOR_/.test(d.id) && !places.some((p) => d.id === 'DOOR_' + p.id || d.id.indexOf('DOOR_' + p.id + '_') === 0));
  check('no door points at an undefined place', dangling.length === 0, dangling.map((d) => d.id).join(' '));
  for (const p of places) {
    const d = doors.find((x) => x.id === 'DOOR_' + p.id);
    if (!p.door) { check(`${p.id}: no door outside (reached through the 가기 menu only)`, !d, ''); continue; }
    check(`${p.id}: a door interactable with a kid label, 🚪 and a radius of at least 3 m`, !!d && d.radius >= 3 && String(d.kidLabel || '').length >= 2 && d.emoji === '🚪', JSON.stringify(d || null));
    check(`${p.id}: the way out lands outside the room, near its door`, !!p.exit && Math.hypot(p.exit.x - p.door.x, p.exit.z - p.door.z) <= 8 && !(Math.abs(p.exit.x - p.origin.x) <= p.size.w / 2 + 2 && Math.abs(p.exit.z - p.origin.z) <= p.size.d / 2 + 2), JSON.stringify(p.exit));
  }
  const envId = await page.evaluate(() => { const E = G.sys.engine; return E.scene.environment ? E.scene.environment.uuid : null; });

  // ---------------------------------------------------------------- double jump: allowed under the sky (the control)
  const jumpTwice = async () => page.evaluate(async () => {
    const pl = G.sys.player, got = [];
    const off = G.bus.on('player:jump', (e) => got.push(e.n));
    const press = () => { window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', key: ' ', bubbles: true })); window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Space', key: ' ', bubbles: true })); };
    const until = async (f, ms) => { const t0 = performance.now(); while (performance.now() - t0 < ms) { if (f()) return true; await new Promise((r) => setTimeout(r, 30)); } return false; };
    const diag = () => ({ grounded: pl.grounded, enabled: pl.enabled, gameplay: G.input.gameplay(), blocking: !!G.ui?.isBlocking?.(), kbFocus: !!G.input.keyboardFocus?.(), walk: !!pl._walk, focus: document.activeElement?.id || document.activeElement?.tagName });
    const grounded = await until(() => pl.grounded, 4000);
    const before = diag();
    let up = false;
    // a press can fall between two frames of a loaded software-GL page and be eaten by a frame that is not in control
    // yet: up to three tries for the first jump (the rule under test is about the SECOND press, in the air)
    // (a frame that stalls through the whole airtime gives no chance to press in the air either: that try is repeated too)
    for (let i = 0; i < 3 && !up; i++) { press(); up = await until(() => !pl.grounded && pl._airJump, 2500); if (!up) await until(() => pl.grounded, 3000); }
    if (up) press();
    await until(() => got.includes(2), 900);
    await until(() => pl.grounded, 6000);
    if (typeof off === 'function') off();
    return up ? { up, jumps: got } : { up, jumps: got, grounded, before, after: diag() };
  });
  await page.evaluate(() => { try { G.ui.modal.closeAll(); document.activeElement?.blur?.(); } catch (e) { /* */ } });
  const jOut = await jumpTwice();
  check('outside: a second press in the air is a double jump (the control for the rule below)', jOut.up && jOut.jumps.includes(2), JSON.stringify(jOut));

  // ---------------------------------------------------------------- every defined place
  let first = true;
  for (const p of places) {
    log(`— ${p.id} ${p.name}`);
    const exitAt = p.exit;
    // ---- in through the door outside
    if (p.door && exitAt) {
      await page.evaluate((e) => { G.sys.player.teleport(e.x, e.z, e.rotY, { fade: false, silent: true }); }, exitAt);
      await page.waitForTimeout(400);
      const act = await page.evaluate((id) => G.interact.activate('DOOR_' + id), p.id);
      const inOk = act && await settled(page, p.id);
      check(`${p.id}: the door outside lets you in`, inOk, `activate ${act}`);
    } else {
      const ok = await page.evaluate((id) => G.sys.places.enter(id), p.id);
      check(`${p.id}: enter()`, ok && await settled(page, p.id));
    }
    await page.waitForTimeout(700);
    let s = await where(page);
    check(`${p.id}: inside — own bounds, ground and zone`, s.cur === p.id && s.inBounds === true && s.zone === p.zoneId && !!s.bounds && s.bounds[0] <= p.origin.x && s.bounds[1] >= p.origin.x && s.bounds[2] <= p.origin.z && s.bounds[3] >= p.origin.z && (s.bounds[1] - s.bounds[0]) <= p.size.w + 8, JSON.stringify({ zone: s.zone, bounds: s.bounds, pos: [s.x, s.z] }));
    check(`${p.id}: the valley is not drawn from inside`, s.roots.buildings === false && s.roots.terrain === false && s.roots.npcs === false, JSON.stringify(s.roots));
    if (p.indoor) check(`${p.id}: a room — indoor light, a short view distance`, s.indoor === true && s.engineIndoor > 0.9 && s.far <= 400, `indoor ${s.engineIndoor}, far ${s.far}`);
    check(`${p.id}: the HUD chip names the place`, s.chip.visible && (s.chip.text.includes(p.kidName) || s.chip.text.includes(p.name)), s.chip.text);
    check(`${p.id}: the way back on the chip is a big button with a voice line (≥ 56 px in easy mode)`, s.chip.btnVisible && s.chip.btn.w >= 56 && s.chip.btn.h >= 56 && !!s.chip.say, JSON.stringify({ btn: s.chip.btn, say: s.chip.say }));
    check(`${p.id}: the visit is counted`, s.visits >= 1, `visits ${s.visits}`);
    if (shotDir) { await page.waitForTimeout(1500); await page.screenshot({ path: path.join(shotDir, `${p.id}-low.png`), timeout: 120000 }); }

    // ---- out by the chip button
    await page.click('#place-chip .pc-exit', { timeout: T_UI });
    const out1 = await settled(page, null);
    await page.waitForTimeout(500);
    s = await where(page);
    check(`${p.id}: the chip button leads back out`, out1 && s.cur === null && !s.chip.visible && s.roots.buildings === true && s.engineIndoor < 0.6, JSON.stringify({ cur: s.cur, chip: s.chip.visible, indoor: s.engineIndoor }));
    check(`${p.id}: back at the spot outside the door, in the valley's own bounds`, (!exitAt || near(s, exitAt, 2.2)) && JSON.stringify(s.bounds) === JSON.stringify(valley.bounds) && s.far === valley.far, JSON.stringify({ pos: [s.x, s.z], want: exitAt, bounds: s.bounds, far: s.far }));

    // ---- in again: the 가기 picture menu (first place), travel() for the others
    if (first) {
      first = false;
      await page.click('#easy-where', { timeout: T_UI });
      const l1 = await pickTile(page, '집 구경');
      check('가기 menu: a "집 구경" picture', l1.includes('집 구경'), l1.join(' · '));
      const l2 = await pickTile(page, p.kidName);
      check('집 구경 page: one picture per defined place, nothing else', l2.length === places.length && places.every((q) => l2.includes(q.kidName)), l2.join(' · '));
      check(`${p.id}: the 가기 picture brings you in`, await settled(page, p.id, T_UI * 2));
    } else {
      const tr = await page.evaluate((id) => G.sys.places.travel(id), p.id);
      check(`${p.id}: travel() brings you in`, tr !== false && await settled(page, p.id, T_UI * 2), `travel → ${tr}`);
    }
    await page.waitForTimeout(1500);
    await frames(page, 6);
    s = await where(page);
    check(`${p.id}: draw calls within the budget on low (≤ ${CALL_BUDGET})`, s.calls > 0 && s.calls <= CALL_BUDGET, `${s.calls} calls, ${s.tris} triangles`);
    // ---- the helpers other systems lean on (the companion catches up on drawn frames)
    await frames(page, 10);
    const inner = await page.evaluate((id) => {
      const P = G.sys.places, pl = G.sys.player, d = P.def(id), E = G.sys.engine, r = {};
      r.plan = typeof d.minimap === 'function';
      try { G.sys.minimap._draw?.(); r.planDraw = true; } catch (e) { r.planDraw = 'ERR ' + e.message; }
      const far = { x: 0, z: 0 };
      const st = P.stepHint({ key: 'k', emoji: '⭐', text: 't', target: far });
      r.step = { key: st.key, emoji: st.emoji };
      const st2 = P.stepHint({ key: 'k', emoji: '⭐', text: 't', target: { x: pl.position.x, z: pl.position.z } });
      r.stepHere = { key: st2.key, emoji: st2.emoji };
      const ex = P.exitPoint();
      r.exitPoint = ex && Number.isFinite(ex.x) && Number.isFinite(ex.z) ? P.contains(ex.x, ex.z) : null;
      const o = P.presenceOut({ x: pl.position.x, y: pl.position.y, z: pl.position.z });
      r.out = o && { x: +o.x.toFixed(2), z: +o.z.toFixed(2), zoneId: o.zoneId, local: Math.abs(o.x) <= d.size.w / 2 + 2.5 && Math.abs(o.z) <= d.size.d / 2 + 2.5 };
      const back = o && P.presenceIn(o.x, o.y, o.z, o.zoneId);
      r.back = !!back && Math.hypot(back.x - pl.position.x, back.z - pl.position.z) < 0.05;
      r.unknown = P.presenceIn(1, 0, 1, 'ZONE_PL_NOT_DEFINED_ANYWHERE');
      r.valleyRow = P.presenceIn(1, 0, 1, 'ZONE_PLAZA') === undefined;
      r.hideValley = P.remoteHidden('ZONE_PLAZA') === true && P.remoteHidden(d.zoneId) === false;
      r.save = P.saveSpot();
      r.hub = P.hub();
      r.exitDoor = !!G.interact.get?.('EXIT_' + id) || G.interact.list('door').some((e) => e.id === 'EXIT_' + id);
      const c = E.scene.getObjectByName('companion'); let cm = null;
      if (c) c.traverseVisible((o) => { if (!cm && o.isMesh) cm = o; });
      r.companion = cm ? P.contains(cm.matrixWorld.elements[12], cm.matrixWorld.elements[14]) : null;
      r.built = P.built().find((b) => b.id === id) || null;
      r.inputs = document.querySelectorAll('#place-chip input, #place-chip textarea, #place-chip a[href]').length;
      return r;
    }, p.id);
    check(`${p.id}: a floor plan for the minimap, drawn without an error`, inner.plan && inner.planDraw === true, JSON.stringify({ plan: inner.plan, draw: inner.planDraw }));
    check(`${p.id}: a goal elsewhere shows the door on the next-step card; a goal in here is left alone`, inner.step.emoji === '🚪' && inner.step.key === 'k|out' && inner.stepHere.emoji === '⭐' && inner.stepHere.key === 'k', JSON.stringify([inner.step, inner.stepHere]));
    check(`${p.id}: an exit door inside, and guidance points at it`, inner.exitDoor && inner.exitPoint === true, JSON.stringify({ door: inner.exitDoor, point: inner.exitPoint }));
    check(`${p.id}: presence goes out in place-local metres with the place zone and comes back exactly`, !!inner.out && inner.out.zoneId === p.zoneId && inner.out.local && inner.back, JSON.stringify(inner.out));
    check(`${p.id}: an unknown place row is dropped, a valley row is left alone and hidden from inside`, inner.unknown === null && inner.valleyRow && inner.hideValley, JSON.stringify({ unknown: inner.unknown, valleyRow: inner.valleyRow, hide: inner.hideValley }));
    check(`${p.id}: a save from inside holds the spot outside the door`, !!inner.save && (!exitAt || near(inner.save, exitAt, 0.6)), JSON.stringify(inner.save));
    check(`${p.id}: the chip has no text field and no link`, inner.inputs === 0, `${inner.inputs}`);
    if (inner.companion !== null) check(`${p.id}: the companion came along`, inner.companion === true, '');
    if (p.indoor) {
      await page.evaluate(() => { try { G.ui.modal.closeAll(); document.activeElement?.blur?.(); } catch (e) { /* */ } });
      await frames(page, 6);
      const jIn = await jumpTwice();
      check(`${p.id}: no double jump under a ceiling`, jIn.up && !jIn.jumps.includes(2) && jIn.jumps.includes(1), JSON.stringify(jIn));
    }
    // ---- out through the exit door
    const actOut = await page.evaluate((id) => G.interact.activate('EXIT_' + id), p.id);
    const out2 = actOut && await settled(page, null, T_UI * 2);
    await page.waitForTimeout(500);
    s = await where(page);
    check(`${p.id}: the exit door leads back out to the same spot`, out2 && s.cur === null && (!exitAt || near(s, exitAt, 2.2)) && s.roots.buildings === true, JSON.stringify({ act: actOut, cur: s.cur, pos: [s.x, s.z], want: exitAt }));
  }
  const P0 = places.find((p) => p.indoor) || places[0];

  // ---------------------------------------------------------------- rain stays outside; the room has its own hush
  if (P0) {
    await page.evaluate((id) => G.sys.places.enter(id, { fade: false }), P0.id);
    await settled(page, P0.id);
    const rain = await page.evaluate(async () => {
      const w = G.sys.weather, ids = Object.keys(G.data.weather || {}), id = ids.find((i) => /RAIN|STORM/i.test(i));
      if (!id) return { skipped: true };
      w.setAuto(false); w.set(id, { instant: true });
      await new Promise((r) => setTimeout(r, 1500));
      const E = G.sys.engine, o = E.scene.getObjectByName('rain'), sp = E.scene.getObjectByName('rain-splashes');
      const r = { weather: id, rain: o ? o.visible : null, splashes: sp ? sp.visible : null, audioIndoor: G.sys.audio?.A ? G.sys.audio.A.indoor : (G.audio?.A?.indoor ?? null) };
      const clear = ids.find((i) => /CLEAR|SUNNY|FINE/i.test(i)) || ids[0];
      w.set(clear, { instant: true });
      return r;
    });
    if (rain.skipped) check('rain stays outside', true, 'no rainy weather in this build: skipped');
    else check('rain stays outside: no drops and no splashes in the room', rain.rain !== true && rain.splashes !== true, JSON.stringify(rain));

    // ---------------------------------------------------------------- 가기 to a far zone from inside: out first
    const farZone = await page.evaluate((exit) => {
      const zs = (G.data.zones || []).filter((z) => Array.isArray(z.center) && z.r > 0);
      zs.sort((a, b) => Math.hypot(b.center[0] - exit.x, b.center[1] - exit.z) - Math.hypot(a.center[0] - exit.x, a.center[1] - exit.z));
      return zs[0] ? { id: zs[0].id, name: zs[0].short || zs[0].name } : null;
    }, P0.exit || { x: 0, z: 0 });
    if (farZone) {
      const went = await page.evaluate((id) => G.easy.goTo(id).then((v) => v, () => false), farZone.id);
      await settled(page, null, T_UI * 2);
      const arrived = await page.waitForFunction((id) => { try { const pl = G.sys.player; return !G.sys.places.current && G.world.zoneAt(pl.position.x, pl.position.z)?.id === id; } catch (e) { return false; } }, farZone.id, { timeout: T_UI * 2, polling: 250 }).then(() => true, () => false);
      const s = await where(page);
      check(`쉬운 모드 가기: from inside to ${farZone.name} — out through the door first, then there`, arrived && s.cur === null && s.zone === farZone.id && s.roots.buildings === true && JSON.stringify(s.bounds) === JSON.stringify(valley.bounds), JSON.stringify({ went, cur: s.cur, zone: s.zone }));
    }

    // ---------------------------------------------------------------- a save made inside resumes outside
    await page.evaluate((id) => G.sys.places.enter(id, { fade: false }), P0.id);
    await settled(page, P0.id);
    const saved = await page.evaluate(async () => { await G.save.save({ reason: 'test' }); const s = G.state.player; return { x: s.x, z: s.z, cur: G.sys.places.current, visits: G.state.places.visits }; });
    check('a save made inside stores the spot outside the door (never a room coordinate)', saved.cur === P0.id && (!P0.exit || near(saved, P0.exit, 0.6)), JSON.stringify(saved));
    await boot(page, 'low');
    await page.waitForTimeout(800);
    let s = await where(page);
    check('after a reload the player is outside, at the door, with the valley shown', s.cur === null && !s.chip.visible && (!P0.exit || near(s, P0.exit, 3)) && s.roots.buildings === true && s.zone !== P0.zoneId, JSON.stringify({ cur: s.cur, pos: [s.x, s.z], zone: s.zone }));
    check('the visits survive the reload', await page.evaluate((id) => (G.state.places?.visits?.[id] | 0) >= 1, P0.id));

    // ---------------------------------------------------------------- night watch on low
    const n = await nightIn(page);
    await page.evaluate((id) => G.sys.places.enter(id, { fade: false }), P0.id);
    await settled(page, P0.id);
    check('night for the watch', n.night > 0.6 || (await page.evaluate(() => G.world.nightFactor)) > 0.6, JSON.stringify(n));
    await watchInside(page, `low · ${P0.id}`);

    // ---------------------------------------------------------------- logout inside
    const lo = await page.evaluate(async () => {
      const ok = await G.app.logout({ confirm: false, quiet: true });
      await new Promise((r) => setTimeout(r, 800));
      const P = G.sys.places, E = G.sys.engine, W = G.world;
      return { ok, state: G.state == null, cur: P.current, busy: P.busy, chip: !document.getElementById('place-chip') || document.getElementById('place-chip').hidden, bounds: W.bounds ? [W.bounds.minX, W.bounds.maxX, W.bounds.minZ, W.bounds.maxZ].map((v) => Math.round(v)) : null, far: Math.round(E.camera.far), goal: E._indoorGoal | 0, inPlace: document.body.classList.contains('in-place') || document.body.classList.contains('in-room') };
    });
    check('logout inside: the place is left at once — valley bounds, view distance, no chip, no body class', lo.ok && lo.state && lo.cur === null && !lo.busy && lo.chip && JSON.stringify(lo.bounds) === JSON.stringify(valley.bounds) && lo.far === valley.far && !lo.inPlace, JSON.stringify(lo));
    await boot(page, 'low');
    await page.waitForTimeout(600);
    s = await where(page);
    check('playing again after that logout starts outside', s.cur === null && s.roots.buildings === true && s.zone !== P0.zoneId && (!P0.exit || near(s, P0.exit, 3)), JSON.stringify({ cur: s.cur, pos: [s.x, s.z], zone: s.zone }));
  }
  await context.close();

  // ============================================================================================ page 2: medium
  if (!flag('--skip-medium') && P0) {
    log('— medium');
    ({ page, context } = await open('medium', { viewport: { width: 960, height: 540 } }));
    await boot(page, 'medium');
    const q = await page.evaluate(() => G.sys.engine.quality);
    check('medium page: the preset is medium', q === 'medium', q);
    const env0 = await page.evaluate(() => { const E = G.sys.engine; return { uuid: E.scene.environment ? E.scene.environment.uuid : null, same: !!E._envRT && E.scene.environment === E._envRT.texture, shadowR: E.sun.shadow.camera.right, map: E.sun.shadow.mapSize.x }; });
    await nightIn(page);
    const tr = await page.evaluate((id) => G.sys.places.travel(id), P0.id);
    check(`medium: travel() into ${P0.id}`, tr !== false && await settled(page, P0.id, T_UI * 3));
    const w = await watchInside(page, `medium · ${P0.id}`);
    const lampsWanted = await page.evaluate((id) => (G.sys.places.built().find((b) => b.id === id) || {}).lights | 0, P0.id);
    check('medium at night: the room\'s lamps are lit (pooled lights, none added to the scene)', lampsWanted === 0 || (w.lamps >= Math.min(lampsWanted, 7) && w.lamps <= 7), `${w.lamps} lit of ${lampsWanted} asked`);
    const envIn = await page.evaluate(() => { const E = G.sys.engine; return { uuid: E.scene.environment ? E.scene.environment.uuid : null, same: !!E._envRT && E.scene.environment === E._envRT.texture }; });
    check('the room bakes into the SAME environment texture object', !!env0.uuid && envIn.uuid === env0.uuid && envIn.same, JSON.stringify({ before: env0.uuid, inside: envIn.uuid }));
    if (shotDir) await page.screenshot({ path: path.join(shotDir, `${P0.id}-medium-night.png`), timeout: 240000 });

    // ---- a quality change inside: the room is rebuilt for the new preset behind a fade, the player stays inside
    const qc = await page.evaluate(async (id) => {
      const E = G.sys.engine, P = G.sys.places, r = {};
      const wait = async (f, ms) => { const t0 = performance.now(); while (performance.now() - t0 < ms) { if (f()) return true; await new Promise((res) => setTimeout(res, 200)); } return false; };
      E.setQuality('low');
      r.low = await wait(() => !P.busy && P.current === id && (P.built().find((b) => b.id === id) || {}).quality === 'low', 60000);
      r.lowLamps = 0; E.scene.traverse((o) => { if (o.isPointLight && o.intensity > 0.01) r.lowLamps++; });
      E.setQuality('medium');
      r.medium = await wait(() => !P.busy && P.current === id && (P.built().find((b) => b.id === id) || {}).quality === 'medium', 60000);
      await new Promise((res) => setTimeout(res, 2500));
      r.cur = P.current; r.calls = E.frameInfo.calls; r.indoor = +E.indoor.toFixed(2);
      r.env = E.scene.environment ? E.scene.environment.uuid : null;
      return r;
    }, P0.id);
    check('a quality change inside: the room follows the preset (low and back to medium), still inside', qc.low && qc.medium && qc.cur === P0.id && qc.calls > 0 && qc.indoor > 0.9, JSON.stringify(qc));
    check('the environment texture object is still the same after two quality changes', qc.env === env0.uuid, `${qc.env} vs ${env0.uuid}`);

    if (flag('--context-loss')) {
      const lost = await page.evaluate(async () => {
        const R = G.sys.engine.renderer, gl = R.getContext(), ext = gl.getExtension('WEBGL_lose_context');
        if (!ext) return { skipped: true };
        ext.loseContext();
        await new Promise((r) => setTimeout(r, 1500));
        ext.restoreContext();
        const t0 = performance.now();
        while (performance.now() - t0 < 120000) { await new Promise((r) => setTimeout(r, 500)); if (!gl.isContextLost() && !G.sys.engine._isLost()) break; }
        await new Promise((r) => setTimeout(r, 4000));
        const E = G.sys.engine, wd = G.gfx.guard.watchdog;
        return { lost: gl.isContextLost(), cur: G.sys.places.current, calls: E.frameInfo.calls, indoor: +E.indoor.toFixed(2), wd: wd.state + ':' + wd.step };
      });
      if (lost.skipped) check('GL context lost and restored inside', true, 'WEBGL_lose_context is not available: skipped');
      else check('GL context lost and restored inside: still in the room, the frame is drawn again', !lost.lost && lost.cur === P0.id && lost.calls > 0 && lost.indoor > 0.9, JSON.stringify(lost));
    }

    await page.evaluate(() => G.sys.places.exit({ fade: false }));
    await settled(page, null);
    await page.waitForTimeout(1500);
    const envOut = await page.evaluate(() => { const E = G.sys.engine; return { uuid: E.scene.environment ? E.scene.environment.uuid : null, same: !!E._envRT && E.scene.environment === E._envRT.texture, shadowR: E.sun.shadow.camera.right, map: E.sun.shadow.mapSize.x, indoor: +E.indoor.toFixed(2) }; });
    check('outside again: the same environment texture object, the valley\'s shadow frustum and map size back', envOut.uuid === env0.uuid && envOut.same && envOut.shadowR === env0.shadowR && envOut.map === env0.map && envOut.indoor < 0.05, JSON.stringify({ env0, envOut }));
    await context.close();
  }

  // ============================================================================================ page 3: a phone
  if (!flag('--skip-phone') && P0) {
    log('— phone 390×844');
    ({ page, context } = await open('phone', { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }));
    await boot(page, 'low');
    await page.evaluate(() => { if (!G.easy.on) G.easy.set(true); });
    await page.tap('#easy-where', { timeout: T_UI });
    await pickTile(page, '집 구경');
    await pickTile(page, P0.kidName);
    check(`phone: the 가기 pictures bring you into ${P0.id}`, await settled(page, P0.id, T_UI * 2));
    await page.waitForTimeout(1200);
    const fit = async (tag) => {
      const s = await where(page);
      const c = s.chip.rect, b = s.chip.btn;
      const over = await page.evaluate(() => {
        const chip = document.getElementById('place-chip'), r = chip.getBoundingClientRect(), hit = [];
        for (const sel of ['#hud-profile', '#minimap-panel', '#easy-next', '#easy-where', '#hud-left-menu', '#bottom-bar', '#mobile-controls .joystick', '#easy-chat-btn']) {
          for (const el of document.querySelectorAll(sel)) {
            if (el.hidden) continue;
            const q = el.getBoundingClientRect(), cs = getComputedStyle(el);
            if (!(q.width > 0 && q.height > 0) || cs.display === 'none' || cs.visibility === 'hidden') continue;
            const ix = Math.min(r.right, q.right) - Math.max(r.left, q.left), iy = Math.min(r.bottom, q.bottom) - Math.max(r.top, q.top);
            if (ix > 2 && iy > 2) hit.push(`${sel} ${Math.round(ix)}×${Math.round(iy)}`);
          }
        }
        return hit;
      });
      check(`${tag}: the chip is on the screen`, s.chip.visible && !!c && c.x >= 0 && c.y >= 0 && c.r <= s.vw && c.b <= s.vh, JSON.stringify({ chip: c, vw: s.vw, vh: s.vh }));
      check(`${tag}: the way back is at least 56 px`, s.chip.btnVisible && b.w >= 56 && b.h >= 56, JSON.stringify(b));
      check(`${tag}: the chip covers no other button`, over.length === 0, over.join(' · '));
    };
    await fit('phone 390×844');
    if (shotDir) await page.screenshot({ path: path.join(shotDir, `${P0.id}-phone.png`), timeout: 120000 });
    await page.setViewportSize({ width: 844, height: 390 });
    await page.waitForTimeout(1200);
    await fit('phone on its side 844×390');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(800);
    await page.tap('#place-chip .pc-exit', { timeout: T_UI });
    const out = await settled(page, null);
    const s = await where(page);
    check('phone: a tap on the way back leaves the room', out && s.cur === null && !s.chip.visible && s.roots.buildings === true, JSON.stringify({ cur: s.cur }));
    await context.close();
  }

  // ---------------------------------------------------------------- nothing went wrong on the way
  check('no page errors', pageErrors.length === 0, pageErrors.join(' | '));
  const cons = consoleErrors.filter((t) => !/net::ERR_|Failed to load resource/i.test(t));
  check('no console errors', cons.length === 0, cons.slice(0, 5).join(' | '));
} catch (e) {
  check('the suite ran to its end', false, String(e && e.stack || e).slice(0, 380));
  exitCode = 2;
} finally {
  await browser.close().catch(() => {});
  if (tmpDir && !flag('--keep')) { try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) { /* a temp directory */ } }
}
const failed = results.filter((r) => !r.ok);
if (jsonOut) console.log(JSON.stringify({ file, passed: results.length - failed.length, failed: failed.length, results }, null, 1));
else log(`\n${failed.length ? '✖' : '✔'} ${results.length - failed.length} / ${results.length} checks passed${failed.length ? ` — failed: ${failed.map((f) => f.name).join(' · ').slice(0, 600)}` : ''}`);
process.exit(exitCode === 2 ? 2 : failed.length ? 1 : 0);
