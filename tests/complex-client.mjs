#!/usr/bin/env node
// =============================================================================
// tests/complex-client.mjs — 만장대 단지 (PL_ALLOT, CONTRACT §16.8; track complex-ground), LOCAL mode, file:// page.
//
//   node tests/complex-client.mjs                        builds a private page (tools/build.mjs --no-assets --out <tmp>)
//   node tests/complex-client.mjs --file /abs/page.html  test an already built page
//   options: --keep · --json · --headed · --timeout <ms> · --ui-timeout <ms> · --skip-medium · --skip-phone · --high
//            (also measure on high) · --shots <dir>
//   Run it through the shared browser lock (at most two browsers on the build machine).
//
// Checks: the place and its door at the valley's shuttle stop · in through the stop · standing on the ground · the part
// registry (every registered part built; a part that throws is skipped with a warning, the rest still builds) · the main
// routes walked on foot (spawn → gate → centre plaza → amphitheatre top → pavilion knoll → village terrace → storehouse
// yard → the lookout 만장대 over its stair flights): never below the ground, never stuck · the minimap draws the plan · out by the bus (the exit
// door) and by the chip · in by travel() (the 가기 path) · a save made inside resumes at the valley stop · a quality change
// inside · draw calls and triangles per preset at the `aerial` view (colour pass of the district ≤ 250 on high) · the phone
// 390 × 844.
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
const TIMEOUT = Number(opt('--timeout', '400000'));
const T_UI = Number(opt('--ui-timeout', '60000'));
const BUDGET = { high: 250 };                         // §16.0 / addendum 3: the district's colour pass on high
const jsonOut = flag('--json');
const shotDir = opt('--shots');
const log = (...a) => { if (!jsonOut) console.log(...a); };

let file = opt('--file');
let tmpDir = null;
if (!file) {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tfm-complex-'));
  file = path.join(tmpDir, 'index.html');
  const b = spawnSync(process.execPath, [path.join(ROOT, 'tools/build.mjs'), '--no-font', '--quiet', '--no-assets', '--out', file], { encoding: 'utf8' });
  if (b.status !== 0) { console.error(b.stderr || b.stdout); process.exit(2); }
}
if (!fs.existsSync(file)) { console.error(`page not found: ${file}`); process.exit(2); }
if (shotDir) fs.mkdirSync(shotDir, { recursive: true });

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail: String(detail ?? '').slice(0, 500) }); log(`${ok ? '  ✔' : '  ✖'} ${name}${detail !== '' && detail != null ? ` — ${String(detail).slice(0, 360)}` : ''}`); };

const browser = await chromium.launch({ headless: !flag('--headed'), args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--autoplay-policy=no-user-gesture-required'] });
const pageErrors = [], consoleErrors = [];
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
const settled = (page, id, t = T_UI) => page.waitForFunction((id) => { const P = G.sys.places; return P.current === id && !P.busy; }, id, { timeout: t, polling: 200 }).then(() => true, () => false);
const where = (page) => page.evaluate(() => {
  const P = G.sys.places, pl = G.sys.player, C = G.data.complex, d = P.def('PL_ALLOT');
  const chip = document.getElementById('place-chip'), btn = chip && chip.querySelector('.pc-exit');
  const r = btn ? btn.getBoundingClientRect() : null;
  const lx = pl.position.x - d.origin.x, lz = pl.position.z - d.origin.z;
  return { cur: P.current, busy: P.busy, x: +pl.position.x.toFixed(2), y: +pl.position.y.toFixed(2), z: +pl.position.z.toFixed(2), ground: P.current === 'PL_ALLOT' ? +C.height(lx, lz).toFixed(2) : null,
    zone: G.world.zoneAt(pl.position.x, pl.position.z)?.id || null, bounds: [G.world.bounds.minX, G.world.bounds.maxX, G.world.bounds.minZ, G.world.bounds.maxZ],
    chip: !!chip && !chip.hidden, btn: r ? { w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.left), y: Math.round(r.top), r: Math.round(r.right), b: Math.round(r.bottom) } : null, vw: innerWidth, vh: innerHeight };
});

let exitCode = 0;
try {
  // ================================================================ low: definitions, doors, in / out, routes, saves
  const { page, context } = await open('low');
  await boot(page, 'low');
  const def = await page.evaluate(() => {
    const P = G.sys.places, d = P.def('PL_ALLOT'), C = G.data.complex;
    if (!d) return null;
    const door = (G.interact.list('door') || []).find((e) => e.id === 'DOOR_PL_ALLOT');
    return { origin: d.origin, bounds: d.bounds, plan: C.bounds, indoor: d.indoor, keepAlive: d.keepAlive, far: d.far, spawn: d.spawn, exit: d.exit, door: d.door,
      doorI: door ? { radius: door.radius, label: door.label, kid: door.kidLabel } : null, listed: P.list().some((p) => p.id === 'PL_ALLOT'), parts: (G.complexParts?.list || []).map((p) => p.name),
      stop: G.sys.complexSite?.busStop || null, shuttleRoot: !!G.sys.engine.scene.getObjectByName('complex-shuttle') };
  });
  check('PL_ALLOT is defined (outdoor, keepAlive, far ≥ 2200, in the 가기 list)', !!def && def.indoor === false && def.keepAlive && def.far >= 2200 && def.listed, JSON.stringify(def && { indoor: def.indoor, keepAlive: def.keepAlive, far: def.far }));
  if (!def) throw new Error('no PL_ALLOT');
  check('origin (0, 2600); the bounds are the plan bounds (not centred on the origin)', def.origin.x === 0 && def.origin.z === 2600 && def.bounds.minX === def.plan.minX && def.bounds.maxX === def.plan.maxX && def.bounds.minZ === 2600 + def.plan.minZ && def.bounds.maxZ === 2600 + def.plan.maxZ, JSON.stringify(def.bounds));
  check('the door is the valley shuttle stop (🚌 label, radius ≥ 3) and the stop is built', !!def.doorI && def.doorI.radius >= 3 && /🚌/.test(def.doorI.kid) && /🚌/.test(def.doorI.label) && def.shuttleRoot, JSON.stringify(def.doorI));
  check('the part registry holds the ground part', def.parts.includes('ground'), def.parts.join(', '));

  // ---- in through the stop
  await page.evaluate((e) => G.sys.player.teleport(e.x, e.z, e.rotY, { fade: false, silent: true }), def.exit);
  await page.waitForTimeout(600);
  const act = await page.evaluate(() => G.interact.activate('DOOR_PL_ALLOT'));
  const inOk = act && await settled(page, 'PL_ALLOT', TIMEOUT);
  check('the bus stop in the valley takes you in', inOk, `activate ${act}`);
  await page.waitForTimeout(1200);
  let s = await where(page);
  check('inside: own bounds and zone, standing on the ground at the spawn', s.cur === 'PL_ALLOT' && s.zone === 'ZONE_PL_ALLOT' && Math.abs(s.y - s.ground) < 0.35 && Math.hypot(s.x - def.spawn.x, s.z - 2600 - def.spawn.z) < 2.5, JSON.stringify(s));
  check('the HUD chip with a big way back (≥ 56 px)', s.chip && s.btn && s.btn.w >= 56 && s.btn.h >= 56, JSON.stringify(s.btn));
  const run = await page.evaluate(() => ({ parts: G.sys.complexSite.parts(), failed: G.sys.complexSite.failed(), want: G.complexParts.list.map((p) => p.name), stats: G.sys.complexSite.stats() }));
  check('every registered part built, none threw', !run.failed.length && run.want.every((n) => run.parts.includes(n)), JSON.stringify(run));
  // ---- the minimap plan
  const mm = await page.evaluate(() => {
    const d = G.sys.places.def('PL_ALLOT'), cv = document.createElement('canvas'); cv.width = 200; cv.height = 200;
    const c = cv.getContext('2d'); c.fillStyle = '#000'; c.fillRect(0, 0, 200, 200);
    const S = 0.5, X = (x) => x * S + 100, Y = (z) => (z - 10) * S + 100;
    d.minimap(c, { X, Y, S, W: 200, H: 200, dpr: 1, t: 0, w: d.size.w, d: d.size.d, easy: true });
    const px = c.getImageData(0, 0, 200, 200).data; let lit = 0; const colors = new Set();
    for (let i = 0; i < px.length; i += 4 * 37) { if (px[i] + px[i + 1] + px[i + 2] > 60) lit++; colors.add((px[i] >> 4) * 256 + (px[i + 1] >> 4) * 16 + (px[i + 2] >> 4)); }
    return { lit, n: Math.floor(px.length / (4 * 37)), colors: colors.size };
  });
  check('the minimap draws the site plan', mm.lit > mm.n * 0.8 && mm.colors > 12, JSON.stringify(mm));

  // ---- the main routes on foot (never below the ground, never stuck)
  // [name, x, z, via]: via = stair waypoints walked in a straight line after the planner reaches the first one
  // every target is read from the master plan (plan v2 moved all of them); the lookout is climbed over its six flights
  const ROUTE = await page.evaluate(() => {
    const C = G.data.complex, gc = C.rings.GC, am = C.rings.AM, kn = C.byId('KNOLL'), gp = C.byId('PLAZA_GATE'), L = C.lookout, sy = C.byId('B_SH1'), sy2 = C.byId('B_SH2');
    const via = [];
    for (const e of C.elements) if (e.type === 'stair' && !e.natural) for (const p of e.pts) { const q = via[via.length - 1]; if (!q || Math.hypot(q[0] - p[0], q[1] - p[1]) > 0.3) via.push([p[0], p[1]]); }
    const h1 = C.byId('B_VH01'), h6 = C.byId('B_VH06');
    return [['gate', (gp.x0 + gp.x1) / 2, (gp.z0 + gp.z1) / 2], ['centre plaza', gc.cx, gc.cz - 2], ['amphitheatre top', am.cx, am.cz - (C.K.WALL_R - 4)], ['pavilion knoll', kn.cx, kn.cz + 3],
      ['village terrace', (h1.x + h6.x) / 2, (h1.z + h6.z) / 2], ['storehouse yard', sy.x + 5.6, (sy.z + sy2.z) / 2 + 0.4], ['the lookout', L.stand.x, L.stand.z, via]];
  });
  for (const [name, x, z, via] of ROUTE) {
    // the player's own movement code driven with a fixed step (the page draws ~1 frame/s on a loaded software-GL machine)
    const r = await page.evaluate(async ([x, z, via]) => {
      const G = window.G, pl = G.sys.player, C = G.data.complex, O = G.sys.places.def('PL_ALLOT').origin;
      let minDy = Infinity, res = null, lastProg = 0, best = Infinity, it = 0;
      const legs = (via || []).concat([[x, z]]);
      let li = 0;
      const go = () => {
        const [tx, tz] = legs[li], straight = li > 0 && !!via;
        const ok = pl.walkTo({ x: O.x + tx, z: O.z + tz }, { stopDistance: li < legs.length - 1 ? 0.5 : 1.2, path: !straight, rescue: false, trail: false,
          onArrive: () => { if (++li < legs.length) { res = null; lastProg = it; best = Infinity; go(); } else res = 'arrived'; }, onFail: (w) => { res = 'fail:' + w + '@' + li; } });
        if (!ok) res = 'refused@' + li;
      };
      go();
      const t0 = G.time.elapsed;
      while (!res && it < 24000) {
        for (let k = 0; k < 400 && !res; k++, it++) {
          pl.update(1 / 30, t0 + it / 30);
          const g = C.height(pl.position.x - O.x, pl.position.z - O.z);
          minDy = Math.min(minDy, pl.position.y - g);
          const cl = legs[Math.min(li, legs.length - 1)], d = Math.hypot(pl.position.x - O.x - cl[0], pl.position.z - O.z - cl[1]);
          if (d < best - 0.5) { best = d; lastProg = it; }
          if (it - lastProg > 900) res = 'stuck';      // 30 s of simulated walking without getting 0.5 m closer
        }
        await new Promise((r) => setTimeout(r, 0));
      }
      if (!res) res = 'timeout';
      try { pl.cancelWalk?.('test'); } catch (e) { /* */ }
      const d = Math.hypot(pl.position.x - O.x - x, pl.position.z - O.z - z);
      return { res, d: +d.toFixed(2), minDy: +minDy.toFixed(2), simSeconds: Math.round(it / 30), cur: G.sys.places.current, at: [+(pl.position.x - O.x).toFixed(1), +pl.position.y.toFixed(2), +(pl.position.z - O.z).toFixed(1)] };
    }, [x, z, via || null]);
    check(`route → ${name}: arrived on foot, never below the ground`, r.cur === 'PL_ALLOT' && (r.res === 'arrived' || r.d < 3) && r.minDy > -0.35, JSON.stringify(r));
  }
  if (shotDir) await page.screenshot({ path: path.join(shotDir, 'complex-deck-low.png'), timeout: 300000 });

  // ---- a save made inside resumes at the valley stop
  const sv = await page.evaluate(() => { const P = G.sys.places, sp = P.saveSpot(); try { G.sys.player._writeState?.(); } catch (e) { /* */ } const p = G.state.player || {}; return { sp, x: p.x, z: p.z, ex: P.def('PL_ALLOT').exit }; });
  check('a save made inside stores the valley stop (a load resumes outside)', !!sv.sp && Math.hypot(sv.sp.x - sv.ex.x, sv.sp.z - sv.ex.z) < 0.01 && (sv.x == null || Math.hypot(sv.x - sv.ex.x, sv.z - sv.ex.z) < 1.5), JSON.stringify(sv));

  // ---- out by the bus (the exit door at the complex stop)
  await page.evaluate(() => { const C = G.data.complex; return G.sys.player.teleport(C.busStop.x + 2, 2600 + C.busStop.z, 0, { fade: false, silent: true }); });
  await page.waitForTimeout(600);
  const actOut = await page.evaluate(() => G.interact.activate('EXIT_PL_ALLOT'));
  const outOk = actOut && await settled(page, null);
  s = await where(page);
  check('the bus stop inside takes you back to the valley stop', outOk && s.cur === null && Math.hypot(s.x - def.exit.x, s.z - def.exit.z) < 2.2, JSON.stringify({ act: actOut, s }));

  // ---- in by travel() (the 가기 path), out by the chip
  const tr = await page.evaluate(() => G.sys.places.travel('PL_ALLOT'));
  check('travel() (가기) enters the complex', tr && await settled(page, 'PL_ALLOT'), String(tr));
  await page.waitForTimeout(800);
  await page.click('#place-chip .pc-exit', { timeout: T_UI });
  const out2 = await settled(page, null);
  s = await where(page);
  check('the chip button leaves to the valley stop', out2 && s.cur === null && Math.hypot(s.x - def.exit.x, s.z - def.exit.z) < 2.2, JSON.stringify(s));

  // ---- the registry survives a part that throws (rebuild by a quality change inside)
  await page.evaluate(() => G.sys.places.enter('PL_ALLOT', { fade: false, quiet: true }));
  const qc = await page.evaluate(async () => {
    G.complexParts.add('test-throws', () => { throw new Error('a broken part (test)'); }, 15);
    G.sys.engine.setQuality ? G.sys.engine.setQuality('medium') : G.settings && (G.settings.quality = 'medium');
    const t0 = performance.now();
    while (performance.now() - t0 < 120000) { await new Promise((r) => setTimeout(r, 300)); const b = G.sys.places.built().find((x) => x.id === 'PL_ALLOT'); if (b && b.quality === 'medium' && !G.sys.places.busy) break; }
    const r = { cur: G.sys.places.current, q: (G.sys.places.built().find((x) => x.id === 'PL_ALLOT') || {}).quality, parts: G.sys.complexSite.parts(), failed: G.sys.complexSite.failed() };
    G.complexParts.list = G.complexParts.list.filter((p) => p.name !== 'test-throws');
    return r;
  });
  check('a quality change inside rebuilds the complex; a part that throws is skipped, the rest builds', qc.cur === 'PL_ALLOT' && qc.q === 'medium' && qc.failed.includes('test-throws') && qc.parts.includes('ground'), JSON.stringify(qc));
  await page.evaluate(() => G.sys.places.exit({ fade: false, quiet: true }));
  await context.close();

  // ================================================================ the first visit (?start=complex forces the deck start)
  {
    const { page: pf, context: cf } = await open('first');
    await boot(pf, 'low', '&start=complex');
    const inDeck = await settled(pf, 'PL_ALLOT', TIMEOUT);
    const card = await pf.waitForSelector('.cx-welcome .cxw-go', { timeout: T_UI }).then(() => true, () => false);
    const fv = await pf.evaluate(() => {
      const pl = G.sys.player, d = G.sys.places.def('PL_ALLOT'), C = G.data.complex, v = C.viewpoints.find((p) => p.id === 'deck');
      const b = document.querySelector('.cx-welcome .cxw-go'), r = b ? b.getBoundingClientRect() : null;
      return { cur: G.sys.places.current, d: +Math.hypot(pl.position.x - d.origin.x - v.stand.x, pl.position.z - d.origin.z - v.stand.z).toFixed(2), y: +pl.position.y.toFixed(2), btn: r ? { w: Math.round(r.width), h: Math.round(r.height) } : null, say: document.querySelector('.cx-welcome [data-say]')?.getAttribute('data-say') || '' };
    });
    check('first visit (start=complex): starts on the viewpoint deck with one calm welcome line', inDeck && card && fv.d < 2.5 && fv.y > 20 && !!fv.say, JSON.stringify(fv));
    check('first visit: the big "🚌 마을로 가요" button (≥ 56 px)', !!fv.btn && fv.btn.w >= 56 && fv.btn.h >= 56, JSON.stringify(fv.btn));
    if (shotDir) await pf.screenshot({ path: path.join(shotDir, 'complex-first-visit.png'), timeout: 300000 });
    await pf.click('.cx-welcome .cxw-go', { timeout: T_UI });
    const back = await settled(pf, null);
    const pos = await where(pf);
    check('first visit: the button takes the child to the valley (the shuttle stop)', back && Math.hypot(pos.x - def.exit.x, pos.z - def.exit.z) < 2.5, JSON.stringify(pos));
    await cf.close();
    const { page: pv, context: cv } = await open('village');
    await boot(pv, 'low');
    await pv.waitForTimeout(2500);
    const vcur = await pv.evaluate(() => G.sys.places.current);
    check('under browser automation (and autostart) the start stays in the valley', vcur === null, String(vcur));
    await cv.close();
  }

  // ================================================================ draw calls / triangles at the aerial view
  const presets = flag('--skip-medium') ? [] : ['medium', ...(flag('--high') ? ['high'] : [])];
  for (const q of ['low', ...presets]) {
    const { page: p2, context: c2 } = await open(q, { viewport: { width: 960, height: 540 } });
    await boot(p2, q);
    const m = await p2.evaluate(async () => {
      const P = G.sys.places, C = G.data.complex, cam = G.sys.camera;
      await P.enter('PL_ALLOT', { fade: false, quiet: true });
      const v = C.viewpoints.find((x) => x.id === 'aerial');
      try { G.ui.setHudVisible(false); } catch (e) { /* */ }
      cam.shot({ x: v.x, y: v.y, z: 2600 + v.z }, { x: v.look.x, y: v.look.y, z: 2600 + v.look.z }, { fov: v.fov, duration: 0 });
      await new Promise((r) => setTimeout(r, 6000));
      const i = G.sys.engine.frameInfo;
      let groundTris = 0, groundMeshes = 0;
      P._root.traverse((o) => { if (o.isMesh && /^cx[-:]/.test(o.name) && o.visible) { groundMeshes++; groundTris += o.geometry.index ? o.geometry.index.count / 3 : o.geometry.attributes.position.count / 3; } });
      return { q: G.sys.engine.quality, scene: i.scene, calls: i.calls, tris: i.triangles, groundMeshes, groundTris: Math.round(groundTris), stats: G.sys.complexSite.stats() };
    });
    if (shotDir) await p2.screenshot({ path: path.join(shotDir, `complex-aerial-${q}.png`), timeout: 300000 });
    check(`${q}: the aerial view draws (colour pass ${m.scene} calls, ${Math.round(m.tris / 1000)}k triangles); ground ${m.groundMeshes} meshes, ${Math.round(m.groundTris / 1000)}k triangles`,
      m.scene > 0 && m.groundMeshes <= 45 && m.groundTris <= (q === 'high' ? 500000 : q === 'medium' ? 300000 : 160000) && (!BUDGET[q] || m.scene <= BUDGET[q]), JSON.stringify(m));
    await c2.close();
  }

  // ================================================================ the phone (390 × 844)
  if (!flag('--skip-phone')) {
    const { page: p3, context: c3 } = await open('phone', { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await boot(p3, 'low');
    await p3.evaluate(() => G.sys.places.enter('PL_ALLOT', { fade: false }));
    await settled(p3, 'PL_ALLOT');
    await p3.waitForTimeout(800);
    const ph = await where(p3);
    check('phone 390×844: the chip fits on screen, the way back ≥ 56 px', ph.chip && ph.btn && ph.btn.w >= 56 && ph.btn.h >= 56 && ph.btn.x >= 0 && ph.btn.r <= ph.vw, JSON.stringify(ph.btn));
    await p3.tap('#place-chip .pc-exit', { timeout: T_UI });
    check('phone: a tap on the chip leaves', await settled(p3, null));
    await c3.close();
  }
} catch (e) {
  check('the suite ran to the end', false, String(e && e.stack || e).slice(0, 400));
}
check('no page errors / console errors', !pageErrors.length && !consoleErrors.length, [...pageErrors, ...consoleErrors].slice(0, 4).join(' | '));
await browser.close();
if (tmpDir && !flag('--keep')) { try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) { /* */ } }
const failed = results.filter((r) => !r.ok);
if (jsonOut) console.log(JSON.stringify({ passed: results.length - failed.length, failed: failed.length, results }, null, 1));
else log(`\n${results.length - failed.length}/${results.length} passed`);
exitCode = failed.length ? 1 : 0;
process.exit(exitCode);
