#!/usr/bin/env node
// =============================================================================
// tests/complex-landscape.mjs — the landscape of 만장대 단지 (src/game/57-complex-landscape.js, track complex-landscape).
//
// Part 1 (plain Node, always): the fragment's pure planners are evaluated in node:vm beside the master plan
//   (33-complex-plan.js) with a stub G and NO THREE (they must stay pure):
//   land() equals C.height inside the bounds and joins it at the seam, is finite out to 1,200 m, the valley opens up- and
//   downstream (the axes are lower than the ridges beside them); 2,000 sampled trees (every preset) stand on no road,
//   path, pad, ring, field, building, water or the deck's view corridor; counts per preset (low a few hundred); every
//   garden pine of the plan is planted; cars stand on the plan's bays (no two on one bay, ≈ 30, ≥ 5 paints), two coaches
//   and the shuttle at the plan's bus stop; determinism.
// Part 2 (browser, with --file <page> or --build): the part builds in a throwaway outdoor place on low / medium / high
//   without a warning or console error; draw calls and triangles of the part inside its budget (high ≤ 45 calls,
//   ≤ 1.2 M triangles, forest ≤ 0.9 M; medium ≈ half; low: a few hundred trees, no texture maps, no alpha); dispose
//   frees everything (renderer.info.memory geometries / textures back to the value before the build); bus() works.
//
// Usage: node tests/complex-landscape.mjs [--file page.html | --build] [--only node|browser] [--json] [--timeout ms]
// Exit 0 = all passed, 1 = a check failed, 2 = could not run.
// =============================================================================
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n, d = null) => { const i = args.indexOf(n); return i >= 0 && i + 1 < args.length ? args[i + 1] : d; };
const jsonOut = flag('--json');
const ONLY = opt('--only');
const TIMEOUT = Number(opt('--timeout', '600000'));
const log = (...a) => { if (!jsonOut) console.log(...a); };
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail: String(detail ?? '').slice(0, 600) }); log(`${ok ? '  ✔' : '  ✖'} ${name}${detail !== '' && detail != null ? ` — ${String(detail).slice(0, 260)}` : ''}`); };
const numbers = {};

// =============================================================================================== part 1: Node
function load() {
  const plan = fs.readFileSync(path.join(ROOT, 'src/game/33-complex-plan.js'), 'utf8');
  const land = fs.readFileSync(path.join(ROOT, 'src/game/57-complex-landscape.js'), 'utf8');
  const G = { data: {}, log: { warn() {} } };
  const ctx = vm.createContext({ G, Math, JSON, Object, Array, Number, String, Map, Set, WeakMap, Error, Float32Array, Float64Array, Int32Array, Int16Array, Uint8Array, Uint16Array, Infinity, NaN, isFinite, parseInt });
  vm.runInContext(`(function(){'use strict';\n${plan}\n})()`, ctx, { filename: '33-complex-plan.js' });
  vm.runInContext(`(function(){'use strict';\n${land}\n})()`, ctx, { filename: '57-complex-landscape.js' });
  return G;
}
function nodePart() {
  log('🏞️  complex-landscape — pure planners (Node)');
  let G;
  try { G = load(); } catch (e) { check('the fragment evaluates without THREE (pure planners at load time)', false, e.stack || e); return; }
  const C = G.data.complex, L = G.complexLandscape, P = L && L.plan;
  check('the fragment evaluates without THREE and registers the part (order 10)', !!P && G.complexParts && G.complexParts.list.some((p) => p.name === 'landscape' && p.order === 10),
    G.complexParts ? G.complexParts.list.map((p) => `${p.name}:${p.order}`).join(' ') : 'no registry');
  if (!P) return;
  const B = C.bounds;
  // ---- land(): the plan inside, joined at the seam, finite far away, valleys open
  {
    let maxIn = 0, maxSeam = 0, bad = 0, n = 0;
    for (let i = 0; i < 400; i++) { const x = B.minX + (B.maxX - B.minX) * ((i * 0.618) % 1), z = B.minZ + (B.maxZ - B.minZ) * ((i * 0.382) % 1); maxIn = Math.max(maxIn, Math.abs(P.land(C, x, z) - C.height(x, z))); }
    for (let i = 0; i <= 200; i++) {
      const t = i / 200;
      for (const [x, z, dx, dz] of [[B.minX + (B.maxX - B.minX) * t, B.minZ, 0, -1], [B.minX + (B.maxX - B.minX) * t, B.maxZ, 0, 1], [B.minX, B.minZ + (B.maxZ - B.minZ) * t, -1, 0], [B.maxX, B.minZ + (B.maxZ - B.minZ) * t, 1, 0]]) {
        maxSeam = Math.max(maxSeam, Math.abs(P.land(C, x + dx * 0.5, z + dz * 0.5) - C.height(x + dx * 0.5, z + dz * 0.5)));
      }
    }
    for (let x = -1150; x <= 1150; x += 50) for (let z = -1150; z <= 1150; z += 50) { n++; if (!Number.isFinite(P.land(C, x, z))) bad++; }
    check('land() = C.height inside the bounds', maxIn < 1e-9, `max |Δ| ${maxIn.toExponential(2)}`);
    check('land() continues C.height across the seam (0.5 m outside the bounds)', maxSeam < 0.05, `max |Δ| ${maxSeam.toFixed(3)} m`);
    check('land() is finite out to ±1,150 m', bad === 0, `${n - bad}/${n} finite`);
    const ax = P.axes(C), out = [];
    let ok = true;
    for (const A of ax) {
      const p = A.pts[Math.min(A.pts.length - 1, 3)], q = A.pts[Math.min(A.pts.length - 1, 2)];
      const dx = p[0] - q[0], dz = p[1] - q[1], l = Math.hypot(dx, dz), nx = -dz / l, nz = dx / l;
      const floor = P.land(C, p[0], p[1]), side = Math.max(P.land(C, p[0] + nx * 260, p[1] + nz * 260), P.land(C, p[0] - nx * 260, p[1] - nz * 260));
      out.push(`${A.id} floor ${floor.toFixed(0)} m · sides ${side.toFixed(0)} m`);
      if (!(side - floor > 50)) ok = false;
    }
    check('the valleys open where the river comes from / leaves and where the road leaves (axis ≥ 50 m below the ridges)', ok, out.join(' · '));
    let peak = -Infinity; for (let x = -1100; x <= 1100; x += 25) for (const z of [-1100, -900, 900, 1100]) peak = Math.max(peak, P.land(C, x, z));
    check('ridges close the horizon far away (peaks ≥ 250 m beyond 900 m)', peak >= 250, `highest sampled ${peak.toFixed(0)} m`);
  }
  // ---- trees
  const TT = {};
  for (const q of ['low', 'medium', 'high']) {
    const t0 = performance.now();
    TT[q] = P.trees(C, q);
    numbers[`trees_${q}`] = TT[q].list.length; numbers[`trees_${q}_ms`] = Math.round(performance.now() - t0);
  }
  check('tree counts per preset (low a few hundred, medium < high)', TT.low.list.length >= 150 && TT.low.list.length <= 700 && TT.medium.list.length < TT.high.list.length && TT.high.list.length >= 2000,
    `low ${TT.low.list.length} · medium ${TT.medium.list.length} · high ${TT.high.list.length}`);
  {
    const gd = C.byId('GARDEN');
    const planted = (gd.pines || []).every((p) => TT.high.list.some((t) => t.src === 'garden' && Math.abs(t.x - p.x) < 1e-6 && Math.abs(t.z - p.z) < 1e-6 && t.kind === 'pine_sculpted'));
    check("every sculpted pine of the plan's roundabout garden is planted", planted, `${(gd.pines || []).length} pines`);
    const gate = TT.high.list.filter((t) => t.src === 'gate').length, street = TT.high.list.filter((t) => t.src === 'street').length;
    check('sculpted pines by the main gate and street trees along the roads', gate >= 3 && street >= 20, `gate ${gate} · street ${street} · plaza ${TT.high.list.filter((t) => t.src === 'plaza').length}`);
  }
  for (const q of ['low', 'high']) {
    const list = TT[q].list, N = Math.min(2000, list.length), step = list.length / N, bad = [];
    const deckClear = (C.elements.find((e) => e.id === 'FO_S') || {}).clear || [];
    const rings = C.elements.filter((e) => e.type === 'jarcircle' || e.type === 'amphitheatre');
    const fields = C.elements.filter((e) => e.type === 'field' && e.poly);
    const rects = C.elements.filter((e) => ['parking', 'busbay', 'deck', 'storeyard'].includes(e.type) && Number.isFinite(e.x0));
    const inPoly = (x, z, poly) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const a = poly[i], b = poly[j]; if ((a[1] > z) !== (b[1] > z) && x < ((b[0] - a[0]) * (z - a[1])) / (b[1] - a[1]) + a[0]) c = !c; } return c; };
    const inB = (x, z) => x > B.minX && x < B.maxX && z > B.minZ && z < B.maxZ;
    for (let k = 0; k < N; k++) {
      const t = list[Math.floor(k * step)], x = t.x, z = t.z;
      if (C.waterY(x, z) > -Infinity) { bad.push(`${t.src} in water (${x.toFixed(1)}, ${z.toFixed(1)})`); continue; }
      if (inB(x, z)) {
        const pd = C.pathDistance(x, z);
        if (pd.d < 0.5 && !(pd.path && pd.path.kind === 'plaza' && (t.src === 'plaza' || t.src === 'gate' || t.src === 'street'))) { bad.push(`${t.src} on ${pd.path && pd.path.kind} ${pd.path && pd.path.id} (${x.toFixed(1)}, ${z.toFixed(1)})`); continue; }
        if (!C.walkable(x, z) && t.src !== 'garden') { bad.push(`${t.src} on a building / wall / unit (${x.toFixed(1)}, ${z.toFixed(1)})`); continue; }
      }
      const road = C.elements.find((e) => e.type === 'road' && P.polyNear(x, z, e.pts).d < e.w / 2 + 1);
      if (road) { bad.push(`${t.src} on road ${road.id}`); continue; }
      if (rings.some((r) => Math.hypot(x - r.cx, z - r.cz) < r.wallR + 1 && (r.type === 'jarcircle' || z < r.cz + 1))) { bad.push(`${t.src} inside a jar ring wall`); continue; }
      if (fields.some((f) => inPoly(x, z, f.poly))) { bad.push(`${t.src} on a field`); continue; }
      if (rects.some((r) => x > Math.min(r.x0, r.x1) && x < Math.max(r.x0, r.x1) && z > Math.min(r.z0, r.z1) && z < Math.max(r.z0, r.z1))) { bad.push(`${t.src} on a pad`); continue; }
      if (t.src === 'forest' && deckClear.some((c) => P.clearHit(c, x, z, -0.01, t.y + 17 * 1.2 * (t.s || 1)))) { bad.push('forest tree in the deck view corridor'); continue; }
      if (!Number.isFinite(t.y)) bad.push('y not finite');
    }
    check(`${q}: ${N} sampled trees stand on no road / path / pad / ring / field / building / water / view corridor`, bad.length === 0, bad.slice(0, 6).join(' · ') || `${N} checked`);
  }
  {
    const a = JSON.stringify(P.trees(C, 'medium').list.slice(0, 300)), b = JSON.stringify(P.trees(C, 'medium').list.slice(0, 300));
    check('trees are deterministic (same input → same list)', a === b, `${a.length} chars`);
  }
  // ---- [complex-look] the closed canopy: one crown per tree on the near slopes — counts, clear ground, determinism
  {
    const cn = { high: P.canopy(C, 'high'), medium: P.canopy(C, 'medium'), low: P.canopy(C, 'low') };
    numbers.canopy = { high: cn.high.list.length, medium: cn.medium.list.length, kinds: cn.high.counts };
    check('canopy: crowns on every near slope (high ≥ 2 × medium, medium ≥ 2,500, none on low, ≤ 26,000)',
      cn.low.list.length === 0 && cn.medium.list.length >= 2500 && cn.high.list.length >= cn.medium.list.length * 2 && cn.high.list.length <= 26000,
      `high ${cn.high.list.length} [${cn.high.counts}] · medium ${cn.medium.list.length} · low ${cn.low.list.length}`);
    const roads = C.elements.filter((e) => e.type === 'road'), clear = [];
    for (const e of C.elements) if (e.type === 'forest') for (const c of e.clear || []) clear.push(c);
    let bad = 0, seen = 0, firs = 0;
    for (let i = 0; i < cn.high.list.length; i += 5) {
      const c = cn.high.list[i]; seen++;
      if (c.kind === 2) firs++;
      const inB = P.outside(c.x, c.z, B) < 1e-9;
      if (!(c.s > 1 && c.s < 9) || !Number.isFinite(c.y)) { bad++; continue; }
      if (C.waterY(c.x, c.z) > -1e6 && C.inWater(c.x, c.z)) { bad++; continue; }
      if (roads.some((r) => P.polyNear(c.x, c.z, r.pts).d < r.w / 2 + 1)) { bad++; continue; }
      if (inB && C.pathDistance(c.x, c.z).d < 2) { bad++; continue; }
      if (clear.some((o) => P.clearHit(o, c.x, c.z, -0.01, c.y + 3.6 * c.s))) { bad++; continue; }
    }
    check(`canopy: ${seen} sampled crowns stand on no water, road or path and keep the lookout's lines of sight free; firs among them`, bad === 0 && firs > seen * 0.08, `bad ${bad} · firs ${firs}`);
    check('canopy is deterministic', JSON.stringify(P.canopy(C, 'medium').list.slice(0, 80)) === JSON.stringify(cn.medium.list.slice(0, 80)), '');
  }

  // ---- vehicles
  {
    const V = P.cars(C), park = C.byId('PARKING'), bus = C.busStop;
    const onBay = V.cars.every((c) => park.bays.some((b) => Math.abs(b.x - c.x) < 0.35 && Math.abs(b.z - c.z) < 0.35));
    const keys = new Set(V.cars.map((c) => `${Math.round(c.x)},${Math.round(c.z * 2)}`));
    const paints = new Set(V.cars.map((c) => c.paint));
    check('≈ 30 parked cars on the plan\'s bays, one per bay, ≥ 5 paints', V.cars.length >= 24 && V.cars.length <= 40 && onBay && keys.size === V.cars.length && paints.size >= 5,
      `${V.cars.length} cars · ${paints.size} paints · on bays ${onBay}`);
    const coachClear = V.coaches.every((co) => V.cars.every((c) => Math.abs(c.x - co.x) > 2 || Math.abs(c.z - co.z) > 7));
    check('two tour coaches in the parking (no car under them) and the shuttle at the plan\'s bus stop', V.coaches.length === 2 && coachClear && V.shuttle && Math.abs(V.shuttle.x - bus.x) < 1e-6 && Math.abs(V.shuttle.z - bus.z) < 1e-6,
      `coaches ${V.coaches.map((c) => `(${c.x}, ${c.z})`).join(' ')} · shuttle (${V.shuttle && V.shuttle.x}, ${V.shuttle && V.shuttle.z})`);
  }
  {
    const code = fs.readFileSync(path.join(ROOT, 'src/game/57-complex-landscape.js'), 'utf8');
    const forb = String.fromCharCode(0xac8c, 0xc784);
    check('no forbidden word, no Math.random, no eval / new Function in the fragment', !code.includes(forb) && !/Math\.random|\beval\(|new Function/.test(code), 'clean');
  }
}

// =============================================================================================== part 2: browser
async function browserPart() {
  let file = opt('--file');
  if (!file && flag('--build')) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tfm-cxl-'));
    file = path.join(dir, 'index.html');
    const b = spawnSync(process.execPath, [path.join(ROOT, 'tools/build.mjs'), '--no-font', '--quiet', '--out', file], { encoding: 'utf8' });
    if (b.status !== 0) { check('build for the browser part', false, (b.stderr || b.stdout).slice(0, 400)); return; }
  }
  if (!file) { log('  (browser part skipped: pass --file <page> or --build)'); return; }
  const require = createRequire(import.meta.url);
  let chromium;
  try { ({ chromium } = require('playwright')); } catch { try { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); } catch { check('playwright', false, 'not installed'); return; } }
  log('🏞️  complex-landscape — the part in the browser');
  const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
  try {
    for (const q of ['low', 'medium', 'high']) {
      const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
      const errors = [], warns = [];
      page.on('console', (m) => { const t = m.text(); if (m.type() === 'error') errors.push(t); if (m.type() === 'warning' && /landscape|COMPLEX|cxl/i.test(t)) warns.push(t); });
      page.on('pageerror', (e) => errors.push(String(e)));
      await page.route('**/*', (route) => (/^(file|data|blob):/.test(route.request().url()) ? route.continue() : route.abort()));
      await page.goto(pathToFileURL(file).href + `?autostart=1&notutorial=1&quality=${q}`, { timeout: TIMEOUT });
      await page.waitForFunction(() => window.G && window.G.ready && window.G.sys && window.G.sys.places && window.G.sys.engine && window.G.sys.engine.renderer, null, { timeout: TIMEOUT });
      const r = await page.evaluate(async () => {
        const G = window.G, C = G.data.complex, E = G.sys.engine;
        const part = (G.complexParts.list || []).find((p) => p.name === 'landscape');
        if (!part) return { error: 'no part' };
        const grp = new THREE.Group(); grp.position.set(0, 0, 2600); E.scene.add(grp);
        const ctx = { group: grp, quality: E.preset.name, low: E.preset.name === 'low', preset: E.preset, id: 'PL_CXLTEST' };
        const cam = E.camera, v = C.viewpoints.find((x) => x.id === 'aerial');
        const sav = { p: cam.position.clone(), q: cam.quaternion.clone(), fov: cam.fov, far: cam.far };
        cam.position.set(v.x, v.y, v.z + 2600); cam.lookAt(v.look.x, v.look.y, v.look.z + 2600); cam.fov = v.fov; cam.far = 2600; cam.updateProjectionMatrix();
        const mem0 = { ...E.renderer.info.memory };
        const warn0 = (G.log._buf || []).length;
        const t0 = performance.now();
        let res, err = null;
        try { res = part.fn(ctx, C); } catch (e) { err = String(e && e.stack || e); }
        const ms = Math.round(performance.now() - t0);
        if (res && res.update) res.update(0.016, 0);
        E.render && E.render({ force: true });
        const L = G.complexLandscape, meas = L.measure ? L.measure() : null;
        // maps / alpha on low
        let maps = 0, alpha = 0;
        L.root.traverse((o) => { if (o.material) { const m = o.material; if (m.map || m.normalMap || m.roughnessMap || m.alphaMap) maps++; if (m.alphaTest > 0 || (m.transparent && m.map)) alpha++; } });
        const busG = L.bus({ kind: 'shuttle' }); const busOk = busG && busG.isObject3D && busG.children.length >= 1; busG.userData.dispose && busG.userData.dispose();
        const stats = JSON.parse(JSON.stringify(L.stats));
        const mem1 = { ...E.renderer.info.memory };
        if (res && res.dispose) res.dispose();
        E.scene.remove(grp);
        E.render && E.render({ force: true });
        const mem2 = { ...E.renderer.info.memory };
        // a second cycle: everything this part makes must be freed again (pack textures stay cached by G.pack: cycle 2)
        const memA = { ...E.renderer.info.memory };
        const grp2 = new THREE.Group(); grp2.position.set(0, 0, 2600); E.scene.add(grp2);
        const res2 = part.fn(Object.assign({}, ctx, { group: grp2 }), C);
        E.render && E.render({ force: true });
        res2.dispose(); E.scene.remove(grp2);
        E.render && E.render({ force: true });
        const memB = { ...E.renderer.info.memory };
        // [finisher] a third cycle: the shared caches the part draws from (G.vehicles' car bodies, also used by the valley's
        // fleet; the nature grove templates) are created and first uploaded in cycles 1–2 and stay by design — a part
        // that leaks still grows here, every cycle
        const grp3 = new THREE.Group(); grp3.position.set(0, 0, 2600); E.scene.add(grp3);
        const res3 = part.fn(Object.assign({}, ctx, { group: grp3 }), C);
        E.render && E.render({ force: true });
        res3.dispose(); E.scene.remove(grp3);
        E.render && E.render({ force: true });
        const memC = { ...E.renderer.info.memory };
        cam.position.copy(sav.p); cam.quaternion.copy(sav.q); cam.fov = sav.fov; cam.far = sav.far; cam.updateProjectionMatrix();
        return { err, ms, meas, maps, alpha, busOk, stats, mem0, mem1, mem2, memA, memB, memC, warns: (G.log._buf || []).slice(warn0).filter((w) => /landscape|cxl/i.test(JSON.stringify(w))).length };
      });
      await page.close();
      if (r.error || r.err) { check(`${q}: the part builds`, false, r.error || r.err); continue; }
      const m = r.meas, fam = m.families, forest = ['tree', 'crowns'].reduce((a, k) => a + (fam[k] ? fam[k].tris : 0), 0);
      numbers[`${q}`] = { ms: r.ms, calls: m.calls, tris: m.tris, forest, counts: r.stats.counts, msParts: r.stats.ms };
      check(`${q}: builds without a console error or warning (${r.ms} ms)`, !errors.length && !warns.length && !r.warns, errors.concat(warns).slice(0, 3).join(' | ') || `trees ${r.stats.counts.trees} · crowns ${r.stats.counts.crowns}`);
      const lim = { high: [45, 1.2e6, 0.9e6], medium: [45, 0.65e6, 0.5e6], low: [30, 0.12e6, 0.08e6] }[q];
      check(`${q}: draw calls ≤ ${lim[0]} and triangles ≤ ${(lim[1] / 1e6).toFixed(2)} M (forest ≤ ${(lim[2] / 1e6).toFixed(2)} M)`, m.calls <= lim[0] && m.tris <= lim[1] && forest <= lim[2],
        `${m.calls} calls · ${(m.tris / 1e6).toFixed(3)} M triangles · forest ${(forest / 1e6).toFixed(3)} M · ${Object.entries(fam).map(([k, v]) => `${k} ${v.calls}/${Math.round(v.tris / 1000)}k`).join(' ')}`);
      if (q === 'low') {
        check('low: no texture maps, no alpha, a few hundred simple trees (the frozen-low rule)', r.maps === 0 && r.alpha === 0 && r.stats.counts.trees <= 700, `maps ${r.maps} · alpha ${r.alpha} · trees ${r.stats.counts.trees}`);
      }
      check(`${q}: dispose frees every geometry and texture of the part (renderer.info.memory back to before)`, r.memC.geometries === r.memB.geometries && r.memC.textures === r.memB.textures && r.mem2.geometries - r.mem0.geometries <= 8 && r.memB.geometries - r.memA.geometries <= 8,
        `cycle 1 ${r.mem0.geometries}→${r.mem1.geometries}→${r.mem2.geometries} geo · cycle 2 ${r.memA.geometries}→${r.memB.geometries} geo, ${r.memA.textures}→${r.memB.textures} tex · cycle 3 ${r.memB.geometries}→${r.memC.geometries} geo, ${r.memB.textures}→${r.memC.textures} tex`);
      check(`${q}: G.complexLandscape.bus() makes the shuttle`, r.busOk, '');
    }
  } finally { await browser.close(); }
}

if (ONLY !== 'browser') nodePart();
if (ONLY !== 'node') await browserPart();
const failed = results.filter((r) => !r.ok);
if (jsonOut) console.log(JSON.stringify({ ok: !failed.length, passed: results.length - failed.length, failed: failed.length, results, numbers }, null, 1));
else log(`\n${failed.length ? '✖' : '✔'} ${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
