#!/usr/bin/env node
// =============================================================================
// tests/complex-buildings.mjs — the buildings of 만장대 단지 (src/game/55-complex-buildings.js, part 'buildings') and their
// insides (src/game/56-complex-office.js: PL_OFFICE, PL_WORKSHOP, PL_CAFE), CONTRACT §16.8 / §17.9, LOCAL mode.
//
//   node tests/complex-buildings.mjs                        builds a private page (tools/build.mjs --no-assets --out <tmp>)
//   node tests/complex-buildings.mjs --file /abs/page.html  test an already built page
//   options: --presets low,medium,high (default all three) · --assets · --keep · --json · --headed · --timeout <ms>
//            --shots <dir> (pictures: aerial, village, corridor, pavilion, gate, store, cafe, workshop — day and night —
//            and the three rooms) · --views a,b (subset) · --shot-preset high (which preset takes the pictures; default
//            the last one run) · --viewport 1280x720 · --no-rooms (skip the room checks)
//   Run it through the shared browser lock (at most two browsers on the build machine).
//
// Per preset: PL_ALLOT builds the part without a warning · everything of the part as the aerial camera sees it (every
// cluster far + the garden trees) within the budget (high / medium ≤ 60 draw calls, ≤ 250 k triangles; low ≤ 30 calls)
// · the aerial camera switches every cluster to its far form by itself, a camera in the village brings the village's
// near form back (not on low) · every door spot is free and reached on foot (the 12 내 방 doors through the yard gates,
// the café over its terrace steps, the workshop) · the corridor is walked on its deck from the main building's side door
// to the pavilion, up its stair to the upper floor and down again, and on the ground under it · every village lane,
// storehouse lane and the gate passage is walked without getting stuck · a second standalone build + dispose returns
// geometries, textures, materials and camera blockers.
// Rooms (once, on the first preset): each of PL_OFFICE / PL_WORKSHOP / PL_CAFE is entered from PL_ALLOT at its door →
// inside: ≥ 8 exhibit cards attached, a lecture screen, ≤ 200 draw calls, a save holds the valley spot, the office's desk
// and live model (G.sys.allot.mapState) → out again lands in PL_ALLOT in front of the same door.
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
try { ({ chromium } = require('playwright')); } catch {
  try { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); } catch { console.error('playwright 가 필요해요 (npm install)'); process.exit(2); }
}
const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n, d = null) => { const i = args.indexOf(n); return i >= 0 && i + 1 < args.length ? args[i + 1] : d; };
const TIMEOUT = Number(opt('--timeout', '480000'));
const PRESETS = String(opt('--presets', 'low,medium,high')).split(',').filter(Boolean);
const jsonOut = flag('--json');
const shotDir = opt('--shots');
const VIEWS = (opt('--views', '') || '').split(',').filter(Boolean);
const SHOT_PRESET = opt('--shot-preset', PRESETS[PRESETS.length - 1]);
const [VW, VH] = String(opt('--viewport', '1280x720')).split('x').map(Number);
const log = (...a) => { if (!jsonOut) console.log(...a); };
let file = opt('--file');
let tmpDir = null;
if (!file) {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tfm-cxb-'));
  file = path.join(tmpDir, 'index.html');
  const b = spawnSync(process.execPath, [path.join(ROOT, 'tools/build.mjs'), '--no-font', '--quiet', ...(flag('--assets') ? [] : ['--no-assets']), '--out', file], { encoding: 'utf8' });
  if (b.status !== 0) { console.error(b.stderr || b.stdout); process.exit(2); }
}
if (!fs.existsSync(file)) { console.error(`page not found: ${file}`); process.exit(2); }
if (shotDir) fs.mkdirSync(shotDir, { recursive: true });
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail: String(detail ?? '').slice(0, 700) }); log(`${ok ? '  ✔' : '  ✖'} ${name}${detail !== '' && detail != null ? ` — ${String(detail).slice(0, 420)}` : ''}`); };
const browser = await chromium.launch({ headless: !flag('--headed'), args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--autoplay-policy=no-user-gesture-required'] });
const pageErrors = [], consoleErrors = [];
const BUDGET = { high: { calls: 60, tris: 250000 }, medium: { calls: 60, tris: 250000 }, low: { calls: 30, tris: 250000 } };
let roomsDone = flag('--no-rooms');

/** in-page helpers, installed once per page: a walker along local polylines, the place origin, frames */
const HELPERS = () => {
  const G = window.G, W = G.world;
  const v = new THREE.Vector3();
  window.__cxb = {
    org() { const d = G.sys.places.def('PL_ALLOT'); return { x: d.origin.x, z: d.origin.z }; },
    /** a walker (radius 0.35, step 0.62) along local points; stuck = no progress for 50 sub-steps */
    walk(pts, startY) {
      const o = this.org();
      let x = pts[0][0] + o.x, z = pts[0][1] + o.z, feet = startY != null ? startY : W.heightAt(x, z);
      let steps = 0, top = -Infinity;
      for (let k = 1; k < pts.length; k++) {
        const tx = pts[k][0] + o.x, tz = pts[k][1] + o.z;
        let stall = 0, best = Math.hypot(tx - x, tz - z), side = 0;
        while (Math.hypot(tx - x, tz - z) > 0.3) {
          // a person steps round a lamp post or a sign: after a few blocked steps the walker leans to one side, then the other
          const L = Math.hypot(tx - x, tz - z), ux = (tx - x) / L, uz = (tz - z) / L, lean = stall > 6 ? (Math.floor(stall / 12) % 2 ? -1 : 1) * 0.8 : 0;
          const sx = x + (ux - uz * lean) * 0.15, sz = z + (uz + ux * lean) * 0.15; void side;
          v.set(sx, feet, sz); W.resolve(v, 0.35, feet);
          const h = W.heightAt(v.x, v.z, feet);
          if (Number.isFinite(h) && h - feet <= 0.62) { x = v.x; z = v.z; feet = h; }
          steps++;
          const now = Math.hypot(tx - x, tz - z);
          if (now < best - 0.02) { best = now; stall = 0; } else if (++stall > 72) return { ok: false, at: [+(x - o.x).toFixed(2), +(z - o.z).toFixed(2), +feet.toFixed(2)], leg: k, steps };
          if (steps > 30000) return { ok: false, at: [x - o.x, z - o.z, feet], leg: k, reason: 'too many steps' };
          top = Math.max(top, feet);
        }
      }
      return { ok: true, at: [+(x - o.x).toFixed(2), +(z - o.z).toFixed(2), +feet.toFixed(3)], steps, top: +top.toFixed(2) };
    },
    free(x, y, z) { const o = this.org(); v.set(x + o.x, y, z + o.z); const pushed = W.resolve(v, 0.35, y); return !pushed && Math.hypot(v.x - x - o.x, v.z - z - o.z) < 0.01; },
    frames(n) { return new Promise((res) => { let k = 0; const f = () => (++k >= n ? res() : requestAnimationFrame(f)); requestAnimationFrame(f); }); },
  };
};

async function boot(q) {
  const context = await browser.newContext({ viewport: { width: 960, height: 540 } });
  const page = await context.newPage();
  page.on('pageerror', (e) => pageErrors.push(`[${q}] ${String(e && e.message || e).slice(0, 300)}`));
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(`[${q}] ${m.text().slice(0, 300)}`); });
  await page.goto(`${pathToFileURL(file).href}?autostart=1&notutorial=1&quality=${q}`, { waitUntil: 'load', timeout: TIMEOUT });
  await page.waitForFunction(() => window.G && window.G.ready === true && !!window.G.sys?.places && !!window.G.sys?.player?._ready, null, { timeout: TIMEOUT, polling: 250 });
  await page.evaluate(() => { try { window.G.ui.modal.closeAll(); } catch (e) { /* nothing open */ } });
  await page.evaluate(HELPERS);
  return { context, page };
}

async function runPreset(q) {
  log(`\n— preset ${q}`);
  const { context, page } = await boot(q);
  page.setDefaultTimeout(TIMEOUT);
  // ---------------------------------------------------------------- enter, build report
  const r = await page.evaluate(async () => {
    const G = window.G, P = G.sys.places;
    const warns = [];
    const ow = G.log.warn;
    G.log.warn = function (...a) { warns.push(a.map((x) => String(x && x.message || x)).join(' ').slice(0, 300)); return ow.apply(this, a); };
    const t0 = performance.now();
    let entered = false, err = null;
    try { entered = await P.enter('PL_ALLOT', { fade: false, quiet: true }); } catch (e) { err = String(e && e.message || e); }
    const B = G.complexBuildings;
    return { entered, err, ms: Math.round(performance.now() - t0), warns, built: !!(B && B.built), failed: G.sys.complexSite?.failed?.() || [], parts: G.sys.complexSite?.parts?.() || null, defs: ['PL_OFFICE', 'PL_WORKSHOP', 'PL_CAFE'].map((id) => !!P.def(id)) };
  });
  check(`[${q}] PL_ALLOT entered and the part 'buildings' built`, r.entered && r.built && !JSON.stringify(r.failed).includes('buildings'), `${r.ms} ms ${r.err || ''} failed=${JSON.stringify(r.failed)}`);
  const mine = r.warns.filter((w) => /complex-buildings|"buildings"|complex-office/i.test(w));
  check(`[${q}] no warning from the buildings while building`, !mine.length, mine.join(' | ') || `${r.warns.length} warnings of other parts`);
  check(`[${q}] the three rooms are defined (PL_OFFICE, PL_WORKSHOP, PL_CAFE)`, r.defs.every(Boolean), JSON.stringify(r.defs));
  if (!r.built) { await context.close(); return; }

  // ---------------------------------------------------------------- budget and levels of detail
  const lod = await page.evaluate(async () => {
    const G = window.G, B = G.complexBuildings, C = G.data.complex, cam = G.sys.camera, o = window.__cxb.org();
    B.setLod('far');
    const far = B.stats();
    B.setLod(null);
    const v = C.viewpoints.find((x) => x.id === 'aerial');
    cam.shot({ x: o.x + v.x, y: v.y, z: o.z + v.z }, { x: o.x + v.look.x, y: v.look.y, z: o.z + v.look.z }, { fov: v.fov || 48, duration: 0 });
    cam.snap && cam.snap();
    await window.__cxb.frames(4); B.update(1); await window.__cxb.frames(2);
    const aerial = B.clusters().map((c) => [c.id, c.lod]);
    const h = B.houses[4] || B.houses[0];
    cam.shot({ x: o.x + h.x + 6, y: h.y + 4, z: o.z + h.z + 14 }, { x: o.x + h.x, y: h.y + 2, z: o.z + h.z }, { fov: 60, duration: 0 });
    cam.snap && cam.snap();
    await window.__cxb.frames(4); B.update(1); await window.__cxb.frames(2);
    const village = B.clusters().find((c) => c.id === 'village');
    cam.setMode && cam.setMode('follow', { duration: 0 });
    return { far, aerial, village: village && { lod: village.lod, near: village.near }, low: B.low, clusters: B.clusters().map((c) => ({ id: c.id, near: c.near, far: c.far })) };
  });
  const Bq = BUDGET[q];
  const tot = { calls: lod.far.calls + (lod.far.trees ? lod.far.trees.calls : 0), tris: lod.far.tris + (lod.far.trees ? lod.far.trees.tris : 0) };
  check(`[${q}] the aerial view of everything of the part (far forms + garden trees) within ${Bq.calls} calls / ${Bq.tris} triangles`, tot.calls > 0 && tot.calls <= Bq.calls && tot.tris <= Bq.tris, JSON.stringify(tot) + ' clusters ' + JSON.stringify(lod.clusters));
  check(`[${q}] from the aerial camera every cluster shows its far form by itself`, lod.aerial.length >= 6 && lod.aerial.every(([, l]) => l === 'far'), JSON.stringify(lod.aerial));
  if (q !== 'low') check(`[${q}] in the village its near form comes back`, lod.village && lod.village.lod === 'near' && lod.village.near.calls > 0, JSON.stringify(lod.village));
  else check('[low] far forms only (flat colours, no near details)', lod.low === true && lod.clusters.every((c) => c.near.calls === 0), JSON.stringify(lod.clusters.map((c) => c.near)));

  // ---------------------------------------------------------------- doors and walking
  const w = await page.evaluate(() => {
    const G = window.G, B = G.complexBuildings, C = G.data.complex, X = window.__cxb, out = {};
    // 내 방 doors: from the lane in front of the yard through the gate onto the veranda
    out.rooms = B.houses.map((h) => {
      const e = C.byId(h.id), W = e.wall, d = h.door;
      const res = X.walk([[d.x, W.z1 + 1.2], [d.x, W.z1 - 0.4], [d.x, d.z + 1.4], [d.x, d.z]]);
      return { id: h.id, free: X.free(d.x, d.y, d.z), ok: res.ok, feet: res.at[2], y: d.y, at: res.at };
    });
    const doorOf = (id) => B.doors.find((x) => x.id === id);
    const cd = doorOf('CX_CAFE_DOOR'), cafe = C.byId('B_CAFE');
    out.cafe = cd ? Object.assign({ free: X.free(cd.x, cd.y, cd.z) }, X.walk([[cd.x, cafe.terrace.z1 + 2.5], [cd.x, cafe.terrace.z1 - 1], [cd.x, cd.z]])) : null;
    const wd = doorOf('CX_WORKSHOP_DOOR');
    out.workshop = wd ? Object.assign({ free: X.free(wd.x, wd.y + 0.1, wd.z) }, X.walk([[wd.x + 1.6, wd.z + 4.5], [wd.x + 1.0, wd.z + 1.2], [wd.x, wd.z]])) : null;
    // the corridor: on the deck from the side door to the pavilion, up the stair, down again; on the ground under it
    const D = B.deck, M = G.complexMain, pv = B.pavilion;
    if (D && pv && M && M.sideDoor) {
      const sd = M.sideDoor, p = D.pts;
      const deckPts = [[sd.x, sd.z], [p[0][0], p[0][1] + 0.6]].concat(p.slice(1).map((q) => [q[0], q[1]]));
      const deck = X.walk(deckPts, M.podiumY);
      const st = pv.stair;
      const rt = pv.route;
      const up = deck.ok ? X.walk([[deck.at[0], deck.at[1]]].concat(rt), deck.at[2]) : { ok: false, reason: 'deck failed' };
      const down = up.ok ? X.walk([[up.at[0], up.at[1]]].concat(rt.slice(0, -1).reverse(), [pv.foot, [pv.x, pv.z - 4.6]]), up.at[2]) : { ok: false };
      const under = X.walk([[p[1][0], p[1][1]], [p[2][0], p[2][1]], [p[3][0], p[3][1]]], C.height(p[1][0], p[1][1]));
      out.corridor = { deck, up, down, under, y0: D.y0, y1: D.y1, upper: pv.upper, floor: pv.floor };
    }
    // village lanes, storehouse lanes
    out.lanes = C.paths.filter((q) => /^VL_/.test(q.id) && q.pts && q.pts.length >= 2).map((q) => Object.assign({ id: q.id }, X.walk(q.pts)));
    out.store = C.paths.filter((q) => /^SY_L/.test(q.id) && q.pts && q.pts.length >= 2).map((q) => Object.assign({ id: q.id }, X.walk(q.pts)));
    // the gate passage, from the forecourt into the circle
    const gt = C.byId('B_GATE');
    if (gt) {
      const s = Math.sin(gt.rot), c = Math.cos(gt.rot), P2 = (lx, lz) => [gt.x + lx * c + lz * s, gt.z - lx * s + lz * c];
      out.gate = X.walk([P2(0, gt.d / 2 + 3), P2(0, 0), P2(0, -gt.d / 2 - 2.5)]);
    }
    return out;
  });
  const roomsBad = w.rooms.filter((x) => !x.free || !x.ok || Math.abs(x.feet - x.y) > 0.45);
  check(`[${q}] the 12 내 방 doors: free spots, reached through the yard gates (feet on the house's platform)`, w.rooms.length === 12 && !roomsBad.length, JSON.stringify(roomsBad.slice(0, 3)) || '');
  check(`[${q}] the café door is free and reached over the terrace steps`, !!w.cafe && w.cafe.free && w.cafe.ok, JSON.stringify(w.cafe));
  check(`[${q}] the workshop door is free and reached`, !!w.workshop && w.workshop.free && w.workshop.ok, JSON.stringify(w.workshop));
  const cw = w.corridor || {};
  check(`[${q}] the corridor is walked on its deck from the side door to the pavilion (never down to the ground)`, !!cw.deck && cw.deck.ok && cw.deck.at[2] >= cw.y1 - 0.4 && Math.abs(cw.deck.at[2] - cw.floor) < 0.4, JSON.stringify(cw.deck));
  check(`[${q}] … up the pavilion's stair to its upper floor and down again`, !!cw.up && cw.up.ok && Math.abs(cw.up.at[2] - cw.upper) < 0.05 && cw.down && cw.down.ok, JSON.stringify({ up: cw.up, down: cw.down }));
  check(`[${q}] … and on the ground under it`, !!cw.under && cw.under.ok && cw.under.top < cw.y0 - 0.5, JSON.stringify(cw.under));
  const laneBad = w.lanes.filter((x) => !x.ok);
  check(`[${q}] every village lane is walked without getting stuck`, w.lanes.length >= 6 && !laneBad.length, laneBad.length ? JSON.stringify(laneBad) : `${w.lanes.length} lanes`);
  const stBad = w.store.filter((x) => !x.ok);
  check(`[${q}] every storehouse lane is walked without getting stuck`, w.store.length >= 8 && !stBad.length, stBad.length ? JSON.stringify(stBad) : `${w.store.length} lanes`);
  check(`[${q}] the gate passage is walked from the forecourt into the circle`, !!w.gate && w.gate.ok, JSON.stringify(w.gate));

  // ---------------------------------------------------------------- a standalone build + dispose returns what it made
  const disp = await page.evaluate(async () => {
    const G = window.G, C = G.data.complex, E = G.sys.engine, W = G.world;
    const part = (G.complexParts.list || []).find((p) => p.name === 'buildings');
    const keep = G.complexBuildings;
    const group = new THREE.Group(); group.position.set(0, 0, 2600); E.scene.add(group); group.updateMatrixWorld(true);
    const ids = { c: [], w: [], i: [] };
    const owned = [];
    const before = { blockers: W.cameraBlockers.length };
    const ctx = {
      id: 'PL_ALLOT', def: G.sys.places.def('PL_ALLOT'), group, quality: E.quality, low: E.quality === 'low', preset: E.preset, own: (x) => { owned.push(x); return x; }, onUpdate() {},
      addCollider: (c) => { const id = W.addCollider(Object.assign({}, c, { x: c.x, z: c.z + 2600 })); ids.c.push(id); return id; },
      addWalkable: (s) => { const id = W.addWalkable(Object.assign({}, s, { x: s.x, z: s.z + 2600 })); ids.w.push(id); return id; },
      interact: () => null, light: () => null,
    };
    let r;
    try { r = part.fn(ctx, C); } catch (e) { G.complexBuildings = keep; E.scene.remove(group); return { err: String(e && e.message || e) }; }
    const geos = new Set(), texs = new Set();
    const trees = new Set(); group.traverse((o) => { if (o.name === 'cxb-grove') o.traverse((t) => trees.add(t)); });
    group.traverse((o) => { if (o.isMesh && o.geometry && o.name !== 'blocker' && !trees.has(o)) geos.add(o.geometry); if (o.material && o.material.map && owned.includes(o.material.map)) texs.add(o.material.map); });
    const freed = new Set();
    for (const g of geos) g.addEventListener('dispose', () => freed.add(g));
    for (const t of texs) t.addEventListener('dispose', () => freed.add(t));
    for (const x of owned) if (x && x.isMaterial) x.addEventListener('dispose', () => freed.add(x));
    const during = { blockers: W.cameraBlockers.length };
    r.dispose();
    for (const id of ids.c) W.removeCollider(id);
    for (const id of ids.w) W.removeWalkable(id);
    E.scene.remove(group);
    G.complexBuildings = keep;
    const notFreed = [...geos, ...texs, ...owned.filter((x) => x && x.isMaterial)].filter((x) => !freed.has(x)).map((x) => x.type || x.name || 'thing');
    // geometries shared by the kit (the blocker box) are not ours to dispose
    return { before, during, after: { blockers: W.cameraBlockers.length }, geometries: geos.size, textures: texs.size, notFreed: notFreed.length, inScene: !!group.parent };
  });
  check(`[${q}] dispose frees every geometry, texture and material the part made`, !disp.err && disp.geometries > 0 && disp.notFreed === 0 && !disp.inScene, JSON.stringify(disp));
  check(`[${q}] dispose removes its camera blockers`, !disp.err && disp.during.blockers > disp.before.blockers && disp.after.blockers === disp.before.blockers, JSON.stringify(disp));

  // ---------------------------------------------------------------- the rooms (once)
  if (!roomsDone) { roomsDone = true; await rooms(page, q); }
  if (shotDir && q === SHOT_PRESET) await shots(page, q);
  await context.close();
}

async function rooms(page, q) {
  for (const id of ['PL_OFFICE', 'PL_WORKSHOP', 'PL_CAFE']) {
    const r = await page.evaluate(async (id) => {
      const G = window.G, P = G.sys.places, X = window.__cxb, B = G.complexBuildings;
      const out = { id };
      if (P.current !== 'PL_ALLOT') await P.enter('PL_ALLOT', { fade: false, quiet: true });
      // stand at the door the way a visitor would, then go in (the place remembers the door)
      const spot = G.sys.complexOffice ? G.sys.complexOffice.doorSpots(id)[0] : null;
      out.spot = spot;
      const o = X.org();
      if (spot) await G.sys.player.teleport(o.x + spot.x, o.z + spot.z, spot.rotY, { fade: false, silent: true });
      const door = id === 'PL_OFFICE' ? G.interact.get('CX_MAIN_DOOR') : G.interact.get(id === 'PL_CAFE' ? 'CX_CAFE_DOOR' : 'CX_WORKSHOP_DOOR');
      out.doorInteract = !!door;
      const t0 = performance.now();
      if (door && typeof door.onInteract === 'function') door.onInteract(); else await P.enter(id, { fade: false });
      for (let k = 0; k < 120 && P.current !== id; k++) await new Promise((res) => setTimeout(res, 250));
      while (P.busy) await new Promise((res) => setTimeout(res, 100));
      out.inside = P.current === id;
      out.ms = Math.round(performance.now() - t0);
      if (!out.inside) return out;
      await X.frames(8);
      const built = P.built().find((b) => b.id === id);
      out.built = built;
      out.cards = (G.sys.exhibits?.forPlace?.(id) || []).length;
      out.anchors = P.anchorsOf(id).length;
      out.calls = G.sys.engine.frameInfo?.calls;
      out.lecture = G.interact.list().filter((i) => String(i.id).startsWith(id + ':') && /lecture/.test(String(i.id))).map((i) => i.id).slice(0, 3);
      out.save = P.saveSpot();
      out.allotExit = P.def('PL_ALLOT').exit;
      if (id === 'PL_OFFICE') {
        out.desk = !!G.interact.get('CX_OFFICE_DESK');
        let map = null, legend = null, year = null;
        G.sys.engine.scene.traverse((o) => { if (o.name === 'office-model-map') map = o; if (o.name === 'office-legend') legend = o; if (o.name === 'office-year') year = o; });
        out.model = { map: !!map, legend: !!legend, year: !!year, mapState: !!G.sys.allot?.mapState?.() };
      }
      // out through the chip's way (P.exit): back into PL_ALLOT at the door
      await P.exit({ fade: false });
      for (let k = 0; k < 120 && P.current !== 'PL_ALLOT'; k++) await new Promise((res) => setTimeout(res, 250));
      while (P.busy) await new Promise((res) => setTimeout(res, 100));
      const pl = G.sys.player.position;
      out.after = { cur: P.current, x: +(pl.x - o.x).toFixed(2), z: +(pl.z - o.z).toFixed(2) };
      out.back = spot ? Math.hypot(pl.x - o.x - spot.x, pl.z - o.z - spot.z) : null;
      return out;
    }, id);
    log(`  · ${id}: ${JSON.stringify({ ms: r.ms, calls: r.calls, cards: r.cards, anchors: r.anchors, built: r.built && { exhibits: r.built.exhibits, lights: r.built.lights } })}`);
    check(`${id}: entered from PL_ALLOT through its door (${r.doorInteract ? 'the door interactable' : 'enter()'})`, r.inside && r.doorInteract, JSON.stringify({ inside: r.inside, door: r.doorInteract, ms: r.ms }));
    if (!r.inside) continue;
    check(`${id}: at least 8 exhibit cards, every one attached at a thing or on the shelf`, r.cards >= 8 && r.built && r.built.exhibits === r.cards, `${r.built && r.built.exhibits} of ${r.cards}`);
    check(`${id}: a lecture screen (🎬 강의 보기)`, r.lecture.length >= 1, JSON.stringify(r.lecture));
    check(`${id}: draw calls within the room budget (≤ 200)`, r.calls > 0 && r.calls <= 200, `${r.calls}`);
    check(`${id}: a save made inside holds the spot outside PL_ALLOT (the valley stop)`, !!r.save && !!r.allotExit && Math.hypot(r.save.x - r.allotExit.x, r.save.z - r.allotExit.z) < 0.6, JSON.stringify({ save: r.save, exit: r.allotExit }));
    if (id === 'PL_OFFICE') check('PL_OFFICE: the 분양 desk, the live table-top model, the counts stand and the allotment year', r.desk && r.model.map && r.model.legend && r.model.year, JSON.stringify(r.model));
    check(`${id}: the way out leads back into PL_ALLOT in front of the same door`, r.after && r.after.cur === 'PL_ALLOT' && r.back != null && r.back < 2.5, JSON.stringify({ after: r.after, back: r.back }));
  }
}

async function shots(page, q) {
  const want = (v) => !VIEWS.length || VIEWS.includes(v);
  await page.setViewportSize({ width: VW, height: VH });
  await page.evaluate(() => { try { window.G.ui.setHudVisible(false); } catch (e) { /* older page */ } });
  await page.addStyleTag({ content: '#hud, .hud, .zone-banner, .toast-wrap, .companion-card, .place-chip, [class*="easy-"], [class*="banner"], [class*="coach"], [class*="chip"] { visibility: hidden !important; }' });
  const outside = ['aerial', 'village', 'corridor', 'pavilion', 'gate', 'store', 'cafe', 'workshop'];
  for (const night of [false, true]) {
    for (const view of outside) {
      const name = (night ? 'night-' : '') + view;
      if (!want(name) && !want(view)) continue;
      const info = await page.evaluate(async ([view, night]) => {
        const G = window.G, P = G.sys.places, C = G.data.complex, B = G.complexBuildings, cam = G.sys.camera, w = G.sys.weather;
        if (P.current !== 'PL_ALLOT') await P.enter('PL_ALLOT', { fade: false, quiet: true });
        try { w.setLockTime(true); w.setAuto(false); w.setHour(night ? 20.8 : 16.5); const ids = Object.keys(G.data.weather || {}); const clear = ids.find((i) => /CLEAR|SUNNY|FINE/i.test(i)) || ids[0]; if (clear) w.set(clear, { instant: true }); } catch (e) { /* weather optional */ }
        const o = window.__cxb.org(), H = (x, z) => C.height(x, z);
        const h = B.houses[5] || B.houses[0], D = B.deck, pv = B.pavilion, gt = C.byId('B_GATE'), cf = C.byId('B_CAFE'), ws = C.byId('B_WORKSHOP'), sh = C.byId('B_SH3');
        const V = {
          aerial: () => { const v = C.viewpoints.find((x) => x.id === 'aerial'); return [[v.x, v.y, v.z], [v.look.x, v.look.y, v.look.z], v.fov]; },
          village: () => [[h.x - 9, h.y + 2.2, h.z + 17], [h.x + 6, h.y + 2.5, h.z - 6], 62],
          corridor: () => { const a = D.at(D.len * 0.35), b = D.at(D.len * 0.8); return [[a.x - 9, a.y + 1.2, a.z + 12], [b.x, b.y + 1.5, b.z], 60]; },
          pavilion: () => [[pv.x + 15, H(pv.x + 15, pv.z + 12) + 3.5, pv.z + 12], [pv.x, pv.y + 5, pv.z], 55],
          gate: () => { const s = Math.sin(gt.rot), c = Math.cos(gt.rot); return [[gt.x + 18 * s - 5 * c, H(gt.x + 18 * s, gt.z + 18 * c) + 2.0, gt.z + 18 * c + 5 * s], [gt.x, gt.y + 3, gt.z], 58]; },
          store: () => [[sh.x - sh.w / 2 - 6, sh.y + 2.0, sh.z + 7.5], [sh.x + 8, sh.y + 2.2, sh.z - 2], 64],
          cafe: () => [[cf.x - 6, H(cf.x - 6, cf.z + 18) + 1.8, cf.z + 18], [cf.x, cf.y + 2.5, cf.z], 62],
          workshop: () => [[ws.x + 13, H(ws.x + 13, ws.z + 10) + 2.5, ws.z + 10], [ws.x - 1, ws.y + 2, ws.z - 7], 64],
        };
        const [p, l, fov] = V[view]();
        cam.shot({ x: o.x + p[0], y: p[1], z: o.z + p[2] }, { x: o.x + l[0], y: l[1], z: o.z + l[2] }, { fov, duration: 0 });
        cam.snap && cam.snap();
        await window.__cxb.frames(4); B.update(1); await window.__cxb.frames(6);
        return { view, calls: G.sys.engine.frameInfo?.calls, tris: G.sys.engine.frameInfo?.triangles, lods: B.clusters().map((c) => c.id[0] + ':' + c.lod[0]).join(' ') };
      }, [view, night]);
      await page.waitForTimeout(3500);
      const out = path.join(shotDir, `cxb-${q}-${name}.png`);
      await page.screenshot({ path: out, timeout: TIMEOUT });
      log(`  📷 ${out} ${JSON.stringify(info)}`);
    }
  }
  for (const night of [false, true]) {
    for (const id of ['PL_OFFICE', 'PL_WORKSHOP', 'PL_CAFE']) {
      const name = (night ? 'night-' : '') + id.slice(3).toLowerCase();
      if (!want(name) && !want('rooms')) continue;
      const info = await page.evaluate(async ([id, night]) => {
        const G = window.G, P = G.sys.places, cam = G.sys.camera, w = G.sys.weather;
        try { w.setLockTime(true); w.setAuto(false); w.setHour(night ? 21 : 14); } catch (e) { /* weather optional */ }
        if (P.current !== id) await P.enter(id, { fade: false, quiet: true });
        const d = P.def(id), sz = d.size;
        const eye = { x: d.origin.x + sz.w * 0.12, y: Math.min(sz.h - 0.6, 3.2), z: d.origin.z + sz.d / 2 - 0.8 };
        const at = { x: d.origin.x - sz.w * 0.05, y: 1.0, z: d.origin.z - sz.d * 0.12 };
        cam.shot(eye, at, { fov: 70, duration: 0 });
        cam.snap && cam.snap();
        await window.__cxb.frames(10);
        return { id, calls: G.sys.engine.frameInfo?.calls, tris: G.sys.engine.frameInfo?.triangles };
      }, [id, night]);
      await page.waitForTimeout(3000);
      const out = path.join(shotDir, `cxb-${q}-${name}.png`);
      await page.screenshot({ path: out, timeout: TIMEOUT });
      log(`  📷 ${out} ${JSON.stringify(info)}`);
    }
  }
  await page.evaluate(async () => { const P = window.G.sys.places; if (P.current) await P.exit({ fade: false, quiet: true }); });
}

try {
  for (const q of PRESETS) await runPreset(q);
} catch (e) {
  check('the run finished', false, String(e && e.stack || e));
}
check('no page errors, no console errors', !pageErrors.length && !consoleErrors.length, pageErrors.concat(consoleErrors).join(' | '));
await browser.close();
if (tmpDir && !flag('--keep')) fs.rmSync(tmpDir, { recursive: true, force: true });
const failed = results.filter((r) => !r.ok);
if (jsonOut) console.log(JSON.stringify({ passed: results.length - failed.length, failed: failed.length, results }, null, 1));
else console.log(`\n${failed.length ? '✖' : '✔'} complex-buildings: ${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
