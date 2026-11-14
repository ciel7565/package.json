#!/usr/bin/env node
// =============================================================================
// tests/complex-main.mjs — 만장대 본관 (src/game/54-complex-main.js, the complex part 'main', CONTRACT §16.8), LOCAL mode.
//
//   node tests/complex-main.mjs                         builds a private page (tools/build.mjs --no-assets --out <tmp>)
//   node tests/complex-main.mjs --file /abs/page.html   test an already built page
//   options: --presets low,medium,high (default all three) · --assets (embed the pack) · --keep · --json · --headed
//            --timeout <ms> · --shots <dir> (views of the building: aerial, deck, entrance, corner, eaves, night)
//            --shot-quality medium|high (default: the preset under test) · --hour 16.5 · --views a,b (subset of the shots)
//   Run it through the shared browser lock (at most two browsers on the build machine).
//
// Inside PL_ALLOT when it is defined (complex-ground), else inside a throwaway outdoor place of this test (PL_CMTEST at the
// same origin, ground = G.data.complex.height) that runs the registered complex parts the same way PL_ALLOT does.
// Per preset: the part builds without a warning · draw calls / triangles of what the aerial view shows (base + far) within
// the budget (high ≤ 40 calls, ≤ 350 k triangles; low ≤ 12 calls) and the near form within the same budget · the far form
// replaces the near one from the aerial camera and comes back near the entrance · the door spot is free (no collider) and
// stands on the podium, reachable on foot from the plaza by the stairs and by both ramps · a walk round the building on the
// terrace and on the ground never gets stuck · a second build + dispose returns geometries / textures / camera blockers /
// night materials / colliders / walkables to their counts.
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
const TIMEOUT = Number(opt('--timeout', '420000'));
const PRESETS = String(opt('--presets', 'low,medium,high')).split(',').filter(Boolean);
const jsonOut = flag('--json');
const shotDir = opt('--shots');
const HOUR = Number(opt('--hour', '16.5'));
const VIEWS = (opt('--views', '') || '').split(',').filter(Boolean);
const log = (...a) => { if (!jsonOut) console.log(...a); };
let file = opt('--file');
let tmpDir = null;
if (!file) {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tfm-cmain-'));
  file = path.join(tmpDir, 'index.html');
  const b = spawnSync(process.execPath, [path.join(ROOT, 'tools/build.mjs'), '--no-font', '--quiet', ...(flag('--assets') ? [] : ['--no-assets']), '--out', file], { encoding: 'utf8' });
  if (b.status !== 0) { console.error(b.stderr || b.stdout); process.exit(2); }
}
if (!fs.existsSync(file)) { console.error(`page not found: ${file}`); process.exit(2); }
if (shotDir) fs.mkdirSync(shotDir, { recursive: true });
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail: String(detail ?? '').slice(0, 600) }); log(`${ok ? '  ✔' : '  ✖'} ${name}${detail !== '' && detail != null ? ` — ${String(detail).slice(0, 400)}` : ''}`); };
const browser = await chromium.launch({ headless: !flag('--headed'), args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--autoplay-policy=no-user-gesture-required'] });
const pageErrors = [], consoleErrors = [];
const BUDGET = { high: { calls: 40, tris: 350000 }, medium: { calls: 40, tris: 350000 }, low: { calls: 12, tris: 350000 } };

/** in-page: enter the district (PL_ALLOT, or the throwaway PL_CMTEST of this test) and collect the build report */
async function enterDistrict(page) {
  return page.evaluate(async () => {
    const G = window.G, C = G.data.complex, P = G.sys.places;
    const warns = [];
    const ow = G.log.warn;
    G.log.warn = function (...a) { warns.push(a.map((x) => String(x && x.message || x)).join(' ').slice(0, 300)); return ow.apply(this, a); };
    let id = 'PL_ALLOT';
    if (!P.def('PL_ALLOT')) {
      id = 'PL_CMTEST';
      if (!P.def(id)) {
        P.define({
          id, name: '본관 시험', kidName: '본관 시험', emoji: '🏛️', zoneId: 'ZONE_PL_CMTEST', origin: { x: 0, z: 2600 }, size: { w: 380, d: 320, h: 80 },
          floorY: 0, heightAt: (x, z) => C.height(x, z), indoor: false, surface: 'stone', keepAlive: true, far: 3000,
          spawn: { x: -66, z: 30, rotY: Math.PI }, exit: { x: 0, z: 62, rotY: 0 }, camera: { dist: 9, min: 2.5, max: 16, pitch: 0.42 },
          build(ctx) {
            // a plain ground from the plan's height (the real one is complex-ground's)
            const x0 = -190, x1 = 50, z0 = -100, z1 = 125, s = 2.5, nx = Math.round((x1 - x0) / s), nz = Math.round((z1 - z0) / s);
            const g = new THREE.PlaneGeometry(x1 - x0, z1 - z0, nx, nz); g.rotateX(-Math.PI / 2); g.translate((x0 + x1) / 2, 0, (z0 + z1) / 2);
            const p = g.attributes.position, col = new Float32Array(p.count * 3);
            for (let i = 0; i < p.count; i++) {
              const x = p.getX(i), z = p.getZ(i), y = C.height(x, z); p.setY(i, y);
              const pave = (x > -108 && x < -24 && z > -48 && z < 22) || (z > 14 && x > -72 && x < -48);
              const c = pave ? [0.55, 0.53, 0.5] : [0.32, 0.38, 0.2];
              col[i * 3] = c[0]; col[i * 3 + 1] = c[1]; col[i * 3 + 2] = c[2];
            }
            g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.computeVertexNormals();
            const m = ctx.own(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }));
            const mesh = new THREE.Mesh(g, m); mesh.receiveShadow = true; mesh.name = 'cmtest-ground'; ctx.group.add(mesh);
            const runs = [];
            const list = ((G.complexParts && G.complexParts.list) || []).slice().sort((a, b) => a.order - b.order);
            for (const pt of list) {
              try { const r = pt.fn(ctx, C); if (r) runs.push(r); } catch (e) { G.log.warn('WORLD', `complex part ${pt.name} failed`, e && e.message || e); }
            }
            ctx.onUpdate((dt, t) => { for (const r of runs) { try { r.update && r.update(dt, t); } catch (e) { /* keep going */ } } });
            return { dispose() { for (const r of runs) { try { r.dispose && r.dispose(); } catch (e) { /* gone */ } } } };
          },
        });
      }
    }
    const t0 = performance.now();
    let entered = false, err = null;
    try { entered = await P.enter(id, { fade: false, quiet: true }); } catch (e) { err = String(e && e.message || e); }
    const ms = Math.round(performance.now() - t0);
    G.log.warn = ow;
    const M = G.complexMain || {};
    return { id, entered, err, ms, warns, built: !!M.built, stats: M.stats ? M.stats() : null, door: M.door, floors: M.floors, office: M.office };
  });
}

async function runPreset(q) {
  log(`\n── ${q}`);
  const context = await browser.newContext({ locale: 'ko-KR', timezoneId: 'Asia/Seoul', viewport: { width: 960, height: 540 } });
  const page = await context.newPage();
  await page.route('**/*', (route) => (/^(file|data|blob):/.test(route.request().url()) ? route.continue() : route.abort()));
  page.on('pageerror', (e) => pageErrors.push(`[${q}] ${String(e?.message || e).slice(0, 300)}`));
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(`[${q}] ${m.text().slice(0, 300)}`); });
  page.setDefaultTimeout(TIMEOUT);
  await page.goto(`${pathToFileURL(file).href}?autostart=1&notutorial=1&quality=${q}`, { waitUntil: 'load', timeout: TIMEOUT });
  await page.waitForFunction(() => window.G && window.G.ready === true && !!window.G.sys?.places && !!window.G.sys?.player?._ready, null, { timeout: TIMEOUT, polling: 250 });
  await page.evaluate(() => { try { G.ui.modal.closeAll(); } catch (e) { /* nothing open */ } });
  const r = await enterDistrict(page);
  check(`[${q}] the district is entered and the part 'main' is built`, r.entered && r.built, `${r.id} entered=${r.entered} built=${r.built} ${r.err || ''} ${r.ms} ms`);
  const mine = r.warns.filter((w) => /complex-main|"main"|vertex AO|merge failed|material set/i.test(w));
  check(`[${q}] no warning while building`, !mine.length, mine.join(' | ') || `${r.warns.length} warnings in all`);
  if (!r.built) { await context.close(); return; }
  const S = r.stats, B = BUDGET[q];
  const aerial = { calls: S.base.calls + S.far.calls, tris: S.base.tris + S.far.tris };
  const nearF = { calls: S.base.calls + S.near.calls, tris: S.base.tris + S.near.tris };
  check(`[${q}] aerial form (base + far) within ${B.calls} calls / ${B.tris} triangles`, aerial.calls <= B.calls && aerial.tris <= B.tris, JSON.stringify(aerial));
  if (q !== 'low') check(`[${q}] near form (base + near) within ${B.calls} calls / ${B.tris} triangles`, nearF.calls <= B.calls && nearF.tris <= B.tris, JSON.stringify(nearF));
  else check('[low] no near details are built on low', S.near.calls === 0 && S.low === true, JSON.stringify(S.near));

  // LOD: the aerial camera (≈ 234 m away) sees the far form; at the entrance the near form is back
  const lod = await page.evaluate(async () => {
    const G = window.G, C = G.data.complex, d = G.sys.places.def(G.sys.places.current), cam = G.sys.camera, M = G.complexMain;
    const v = C.viewpoints.find((x) => x.id === 'aerial');
    const frames = (n) => new Promise((res) => { let k = 0; const f = () => (++k >= n ? res() : requestAnimationFrame(f)); requestAnimationFrame(f); });
    cam.shot({ x: d.origin.x + v.x, y: v.y, z: d.origin.z + v.z }, { x: d.origin.x + v.look.x, y: v.look.y, z: d.origin.z + v.look.z }, { fov: v.fov, duration: 0 });
    cam.snap && cam.snap();
    await frames(4);
    const far = { lod: M.lod, near: M.groups.near.visible, far: M.groups.far.visible, calls: G.sys.engine.frameInfo?.calls, tris: G.sys.engine.frameInfo?.triangles };
    cam.shot({ x: d.origin.x + M.door.x + 3, y: M.door.y + 3, z: d.origin.z + M.door.z + 12 }, { x: d.origin.x + M.door.x, y: M.door.y + 2, z: d.origin.z + M.door.z }, { fov: 55, duration: 0 });
    cam.snap && cam.snap();
    await frames(4);
    const near = { lod: M.lod, near: M.groups.near.visible, far: M.groups.far.visible };
    cam.setMode('follow', { duration: 0 });
    return { far, near };
  });
  check(`[${q}] from the aerial camera the far form replaces the near one`, lod.far.lod === 'far' && !lod.far.near && lod.far.far, JSON.stringify(lod.far));
  if (q !== 'low') check(`[${q}] near the entrance the near form is back`, lod.near.lod === 'near' && lod.near.near && !lod.near.far, JSON.stringify(lod.near));

  // the door spot, walking (stairs, ramps, round the terrace, round the building on the ground)
  const walk = await page.evaluate(() => {
    const G = window.G, W = G.world, d = G.sys.places.def(G.sys.places.current), M = G.complexMain, ox = d.origin.x, oz = d.origin.z;
    const v = new THREE.Vector3();
    /** a walker (radius 0.35, step 0.62) along a polyline in local metres; stuck = no progress for 40 sub-steps */
    function walkPath(pts, startY) {
      let x = pts[0][0] + ox, z = pts[0][1] + oz, feet = startY != null ? startY : W.heightAt(x, z);
      let worst = 0, steps = 0;
      for (let k = 1; k < pts.length; k++) {
        const tx = pts[k][0] + ox, tz = pts[k][1] + oz;
        let stall = 0, best = Math.hypot(tx - x, tz - z);
        while (Math.hypot(tx - x, tz - z) > 0.3) {
          const L = Math.hypot(tx - x, tz - z), sx = x + ((tx - x) / L) * 0.15, sz = z + ((tz - z) / L) * 0.15;
          v.set(sx, feet, sz); W.resolve(v, 0.35, feet);
          const h = W.heightAt(v.x, v.z, feet);
          if (Number.isFinite(h) && h - feet <= 0.62) { x = v.x; z = v.z; feet = h; }
          steps++;
          const now = Math.hypot(tx - x, tz - z);
          if (now < best - 0.02) { best = now; stall = 0; } else if (++stall > 40) return { ok: false, at: [x - ox, z - oz, feet], leg: k, steps };
          if (steps > 20000) return { ok: false, at: [x - ox, z - oz, feet], leg: k, steps, reason: 'too many steps' };
          worst = Math.max(worst, feet);
        }
      }
      return { ok: true, at: [x - ox, z - oz, feet], steps, top: worst };
    }
    const door = M.door, T = M.terrace, Pd = M.pad, ST = M.stairs, P = M.podiumY;
    // the door spot: no collider there for a walker standing on the podium
    v.set(door.x + ox, P, door.z + oz);
    const pushed = W.resolve(v, 0.35, P);
    const doorFree = !pushed && Math.hypot(v.x - door.x - ox, v.z - door.z - oz) < 0.01;
    const doorY = W.heightAt(door.x + ox, door.z + oz, P + 0.1);
    const viaStairs = walkPath([[door.x, 30], [door.x, ST.z1 + 1], [door.x, door.z]]);
    const viaWest = walkPath([[-110, 14], [-97, 9.4], [-79.5, 9.4], [-76, 9.6], [door.x - 3, door.z]]);
    const viaEast = walkPath([[-24, 14], [-35, 9.4], [-52.5, 9.4], [-56, 9.6], [door.x + 3, door.z]]);
    const onTop = walkPath([[door.x, door.z], [-62, 6.5], [T.x1 - 1.0, 6.5], [T.x1 - 1.0, T.z0 + 1.0], [T.x0 + 1.0, T.z0 + 1.0], [T.x0 + 1.0, 6.5], [door.x - 4, 6.5], [door.x, door.z]], P);
    // west, north and east of the building on the ground (the corridor and the jar circle close the south-east corner)
    const ground = walkPath([[door.x - 12, 24], [-108, 24], [-108, -46], [-27, -46], [-27, -21]]);
    const sideDoor = M.sideDoor;
    v.set(sideDoor.x + ox, P, sideDoor.z + oz);
    const sidePushed = W.resolve(v, 0.35, P);
    return { doorFree, doorY, P, viaStairs, viaWest, viaEast, onTop, ground, sideFree: !sidePushed };
  });
  check(`[${q}] the door spot is free and stands on the podium`, walk.doorFree && Math.abs(walk.doorY - walk.P) < 0.05, `free=${walk.doorFree} y=${walk.doorY?.toFixed?.(2)} P=${walk.P?.toFixed?.(2)}`);
  check(`[${q}] the door is reached on foot from the plaza by the stairs`, walk.viaStairs.ok && Math.abs(walk.viaStairs.at[2] - walk.P) < 0.05, JSON.stringify(walk.viaStairs));
  check(`[${q}] … and by the west and the east ramp`, walk.viaWest.ok && walk.viaEast.ok && Math.abs(walk.viaWest.at[2] - walk.P) < 0.05 && Math.abs(walk.viaEast.at[2] - walk.P) < 0.05, JSON.stringify({ w: walk.viaWest, e: walk.viaEast }));
  check(`[${q}] a walk round the hall on the terrace never gets stuck (and stays up there)`, walk.onTop.ok && Math.abs(walk.onTop.at[2] - walk.P) < 0.05, JSON.stringify(walk.onTop));
  check(`[${q}] a walk round the building on the ground never gets stuck`, walk.ground.ok, JSON.stringify(walk.ground));
  check(`[${q}] the side door to the corridor is free`, walk.sideFree, '');

  // dispose: a second, standalone build of the part, then its dispose → every geometry and every texture / material it made
  // is disposed, camera blockers, night materials, colliders and walkables come back to their counts
  const disp = await page.evaluate(async () => {
    const G = window.G, E = G.sys.engine, W = G.world, C = G.data.complex;
    const part = (G.complexParts.list || []).find((p) => p.name === 'main');
    const cur = G.sys.places.def(G.sys.places.current);
    const keep = G.complexMain;
    const count = () => ({ blockers: W.cameraBlockers.length, night: W.nightMaterials.length, colliders: W.colliders.size, walkables: W.walkables.size });
    const before = count();
    const group = new THREE.Group(); group.position.set(cur.origin.x, 0, cur.origin.z); E.scene.add(group);
    const ids = { c: [], w: [] }, owned = [];
    const ctx = {
      group, quality: E.quality, low: E.quality === 'low', preset: E.preset,
      addCollider: (c) => { const id = W.addCollider({ ...c, x: c.x + cur.origin.x, z: c.z + cur.origin.z }); ids.c.push(id); return id; },
      addWalkable: (w) => { const id = W.addWalkable({ ...w, x: w.x + cur.origin.x, z: w.z + cur.origin.z }); ids.w.push(id); return id; },
      interact: () => null, light: () => ({ set() {} }), onUpdate() {}, own: (x) => { owned.push(x); return x; },
    };
    const r = part.fn(ctx, C);
    E.renderer.render(E.scene, E.camera);
    const M = G.complexMain, geos = new Set(), shared = new Set([G.bkit.Site.unitBox]);
    M.root.traverse((o) => { if (o.isMesh && o.geometry && !shared.has(o.geometry)) geos.add(o.geometry); });
    const texs = new Set();
    for (const x of owned) { if (x.isTexture) texs.add(x); if (x.map && x.map.isTexture) texs.add(x.map); }
    const freed = new Set();
    for (const g of geos) g.addEventListener('dispose', () => freed.add(g));
    for (const t of texs) t.addEventListener('dispose', () => freed.add(t));
    for (const x of owned) if (x.isMaterial) x.addEventListener('dispose', () => freed.add(x));
    const during = count();
    r.dispose();
    for (const id of ids.c) W.removeCollider(id);
    for (const id of ids.w) W.removeWalkable(id);
    E.scene.remove(group);
    G.complexMain = keep;
    const after = count();
    const notFreed = [...geos, ...texs, ...owned.filter((x) => x.isMaterial)].filter((x) => !freed.has(x)).map((x) => x.type || x.name || 'thing');
    return { before, during, after, geometries: geos.size, textures: texs.size, materials: owned.filter((x) => x.isMaterial).length, notFreed, inScene: !!group.parent || M.root.parent === group };
  });
  check(`[${q}] dispose frees every geometry, texture and material the part made`, disp.geometries > 0 && !disp.notFreed.length && !disp.inScene, JSON.stringify(disp));
  const same = (k) => disp.after[k] === disp.before[k];
  check(`[${q}] dispose removes camera blockers and night materials (colliders / walkables by the place)`, same('blockers') && same('night') && disp.during.blockers > disp.before.blockers && same('colliders') && same('walkables'), JSON.stringify({ b: disp.before, a: disp.after }));

  // pictures
  if (shotDir) {
    const views = ['aerial', 'deck', 'entrance', 'corner', 'eaves', 'side', 'night-aerial', 'night-entrance'].filter((v) => !VIEWS.length || VIEWS.includes(v));
    await page.evaluate(() => { try { window.G.ui.setHudVisible(false); } catch (e) { /* older page */ } });
    await page.addStyleTag({ content: '#hud, .hud, .zone-banner, .toast-wrap, .companion-card, .place-chip, [class*="easy-"], [class*="banner"], [class*="coach"], [class*="chip"] { visibility: hidden !important; }' });
    await page.setViewportSize({ width: 1280, height: 720 });
    for (const view of views) {
      const info = await page.evaluate(async ([view, hour]) => {
        const G = window.G, C = G.data.complex, d = G.sys.places.def(G.sys.places.current), cam = G.sys.camera, M = G.complexMain, w = G.sys.weather;
        const night = view.startsWith('night');
        try { w.setLockTime(true); w.setAuto(false); w.setHour(night ? 20.8 : hour); const ids = Object.keys(G.data.weather || {}); const clear = ids.find((i) => /CLEAR|SUNNY|FINE/i.test(i)) || ids[0]; if (clear) w.set(clear, { instant: true }); } catch (e) { /* weather optional */ }
        const ox = d.origin.x, oz = d.origin.z, Dr = M.door, P = M.podiumY;
        const V = {
          aerial: () => { const v = C.viewpoints.find((x) => x.id === 'aerial'); return [[v.x, v.y, v.z], [v.look.x, v.look.y, v.look.z], v.fov]; },
          deck: () => { const v = C.viewpoints.find((x) => x.id === 'deck'); return [[v.x, v.y, v.z], [-62, 12, -14], 40]; },
          entrance: () => [[Dr.x + 2.5, P + 1.65, Dr.z + 10], [Dr.x, P + 4.5, Dr.z - 2], 62],
          corner: () => [[-112, 4.0, 22], [-86, 12, -10], 58],
          eaves: () => [[Dr.x - 11, P + 1.6, Dr.z + 2.2], [Dr.x - 13, P + 9.5, Dr.z - 3.5], 70],
          side: () => [[-12, 6, -2], [-40, 9, -18], 55],
          'night-aerial': () => V.aerial(), 'night-entrance': () => V.entrance(),
        };
        const [p, l, fov] = V[view]();
        cam.shot({ x: ox + p[0], y: p[1], z: oz + p[2] }, { x: ox + l[0], y: l[1], z: oz + l[2] }, { fov, duration: 0 });
        cam.snap && cam.snap();
        const frames = (n) => new Promise((res) => { let k = 0; const f = () => (++k >= n ? res() : requestAnimationFrame(f)); requestAnimationFrame(f); });
        await frames(6);
        return { view, lod: M.lod, calls: G.sys.engine.frameInfo?.calls, tris: G.sys.engine.frameInfo?.triangles, hour: w.hour };
      }, [view, HOUR]);
      await page.waitForTimeout(2500);
      const out = path.join(shotDir, `cm-${q}-${view}.png`);
      await page.screenshot({ path: out, timeout: TIMEOUT });
      log(`  📷 ${out} ${JSON.stringify(info)}`);
    }
  }
  await context.close();
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
else console.log(`\n${failed.length ? '✖' : '✔'} complex-main: ${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
