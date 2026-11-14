#!/usr/bin/env node
// =============================================================================
// tests/complex-plan.mjs — the master plan of 만장대 단지 (src/game/33-complex-plan.js, CONTRACT §16.8) in plain Node.
//
// The fragment is evaluated in node:vm with a stub G (no THREE, no DOM — it must stay pure). Checked:
//   the default preset (= what the server seeds) places exactly 10,000 units; no two units closer than the minimum spacing of
//   their kind (spatial hash); every unit inside the bounds and inside its slot; every unit within 3 m of an aisle or path;
//   unitAt(unit(z, s)) = (z, s) for all 10,000 and null on aisles, ring walks, roads, buildings and water; height() finite
//   everywhere, continuous along every path (no step above 0.5 m except on stair paths), level under buildings and equal to
//   each unit's y; determinism; odd inputs (no zones, 7 units, 25 zones, 5,000 in one zone, unknown kinds); cells cover every
//   unit exactly once; draw() on a recording 2D context; walkable(); timing (layout < 50 ms, 10,000 unit() < 20 ms,
//   100,000 unitAt() < 100 ms — the best of five runs, since other jobs share the machine).
//
// Usage: node tests/complex-plan.mjs [--json out.json] [--quiet]        Exit 0 = all passed, 1 = a check failed, 2 = could not run.
// =============================================================================
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const QUIET = args.includes('--quiet');
const jsonOut = args.includes('--json') ? args[args.indexOf('--json') + 1] : null;
const log = (...a) => { if (!QUIET) console.log(...a); };
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail: String(detail ?? '').slice(0, 500) }); log(`${ok ? '  ✔' : '  ✖'} ${name}${detail !== '' && detail != null ? ` — ${String(detail).slice(0, 300)}` : ''}`); };
const numbers = {};

// ------------------------------------------------------------------ load the fragment in a bare context
const FILE = path.join(ROOT, 'src/game/33-complex-plan.js');
let src;
try { src = fs.readFileSync(FILE, 'utf8'); } catch (e) { console.error('33-complex-plan.js 를 읽지 못했어요:', e.message); process.exit(2); }
function load() {
  const G = { data: {} };
  const ctx = vm.createContext({ G, Math, JSON, Object, Array, Number, String, Map, Set, Error, Float32Array, Float64Array, Int32Array, Int16Array, Uint8Array, Uint16Array, Infinity, NaN, isFinite });
  vm.runInContext(`(function(){'use strict';\n${src}\n})()`, ctx, { timeout: 5000, filename: '33-complex-plan.js' });
  return G.data.complex;
}
let C;
try { C = load(); } catch (e) { console.error('조각을 평가하지 못했어요:', e.stack || e); process.exit(2); }
if (!C || typeof C.layout !== 'function') { console.error('G.data.complex 가 없어요'); process.exit(2); }
log('🗺️  complex-plan — G.data.complex');

// ------------------------------------------------------------------ purity
{
  const code = src.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  const bad = ['THREE', 'document', 'window', 'G.sys', 'localStorage', 'fetch(', 'performance', 'Math.random'].filter((w) => code.includes(w));
  check('pure: no THREE / DOM / G.sys / random at evaluation', !bad.length, bad.length ? bad.join(', ') : 'clean');
}

// ------------------------------------------------------------------ the default preset
const ZD = C.defaultZones();
const L = C.layout(ZD);
const A = L.arrays, N = L.count;
const kindOf = (i) => C.K.KINDS[A.kind[i]];
const codeOf = (i) => L.zones[A.zone[i]].code;
check('default preset = the server seed (J01–J06 × 1,000, P01–P03 × 1,000, S01–S02 × 500)',
  ZD.length === 11 && ZD.filter((z) => z.kind === 'jar').every((z, i) => z.code === `J0${i + 1}` && z.cap === 1000) && ZD.filter((z) => z.kind === 'plot').length === 3 && ZD.filter((z) => z.kind === 'store').every((z) => z.cap === 500),
  ZD.map((z) => `${z.code}:${z.cap}`).join(' '));
check('default preset lays out exactly 10,000 units, none unplaced', N === 10000 && L.unplaced === 0 && L.total === 10000, `${N} placed · ${L.unplaced} unplaced`);
{
  const want = { J01: 'GC_SW', J02: 'GC_NW', J03: 'GC_NE', J04: 'GC_SE', J05: 'AM_W', J06: 'AM_E', P01: 'F_N', P02: 'F_E', P03: 'F_SE', S01: 'SY_A', S02: 'SY_B' };
  const wrong = L.zones.filter((z) => want[z.code] !== z.slot || z.slots.length !== 1);
  check('each default zone fills one slot of its kind (quadrants, amphitheatre halves, field blocks, storehouse rows)', !wrong.length, wrong.length ? wrong.map((z) => `${z.code}→${z.slot}`).join(', ') : L.zones.map((z) => `${z.code}→${z.slot}`).join(' '));
  const full = C.slots.filter((s) => s.kind !== '*' && s.kind !== 'jar').every((s) => L.used[s.id] === s.cap && s.cap === s.limit);
  const jar = C.slots.filter((s) => s.kind === 'jar').every((s) => L.used[s.id] === 1000 && s.limit >= 1000);
  check('the default fills the plan exactly (fields 1,000 · storehouse rows 500 · jar slots 1,000 of their natural room)', full && jar,
    C.slots.map((s) => `${s.id} ${L.used[s.id]}/${s.limit}`).join(' · '));
}

// ------------------------------------------------------------------ spacing (spatial hash)
function spacingCheck(LL) {
  const AA = LL.arrays, cell = 2.0, grid = new Map();
  const key = (cx, cz) => cx * 100003 + cz;
  for (let i = 0; i < LL.count; i++) { const k = key(Math.floor(AA.x[i] / cell), Math.floor(AA.z[i] / cell)); let b = grid.get(k); if (!b) grid.set(k, (b = [])); b.push(i); }
  const minOf = (i) => (LL.zones[AA.zone[i]] && C.slots[AA.slot[i]] && C.slots[AA.slot[i]].id === 'OVER' ? C.K.MIN_SPACING.over : C.K.MIN_SPACING[C.K.KINDS[AA.kind[i]]]);
  let worst = Infinity, bad = 0, sample = '';
  for (let i = 0; i < LL.count; i++) {
    const cx = Math.floor(AA.x[i] / cell), cz = Math.floor(AA.z[i] / cell);
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      const b = grid.get(key(cx + dx, cz + dz)); if (!b) continue;
      for (const j of b) {
        if (j <= i) continue;
        const d = Math.hypot(AA.x[i] - AA.x[j], AA.z[i] - AA.z[j]);
        const need = Math.max(minOf(i), minOf(j));
        if (d < worst) worst = d;
        if (d < need) { bad++; if (!sample) sample = `${LL.zones[AA.zone[i]].code}-${AA.seq[i]} ↔ ${LL.zones[AA.zone[j]].code}-${AA.seq[j]} ${d.toFixed(3)} m < ${need}`; }
      }
    }
  }
  return { bad, worst, sample };
}
{
  const r = spacingCheck(L);
  numbers.minSpacing = +r.worst.toFixed(3);
  check('no two units closer than the minimum spacing of their kind (jar 1.24 · plot 1.39 · store 1.19 m)', r.bad === 0, r.bad ? `${r.bad} pairs, e.g. ${r.sample}` : `closest pair ${r.worst.toFixed(3)} m`);
  const per = {};
  for (let i = 0; i < N; i++) { const k = kindOf(i); per[k] = per[k] || { n: 0 }; per[k].n++; }
  numbers.perKind = Object.fromEntries(Object.entries(per).map(([k, v]) => [k, v.n]));
}

// ------------------------------------------------------------------ bounds and slots
{
  const B = C.unitBounds;
  let out = 0, wrongSlot = 0, sample = '';
  const ringSys = C.rings;
  for (let i = 0; i < N; i++) {
    const x = A.x[i], z = A.z[i];
    if (!(x >= B.minX && x <= B.maxX && z >= B.minZ && z <= B.maxZ)) { out++; continue; }
    const s = C.slots[A.slot[i]];
    let ok = true;
    if (s.type === 'ring') {
      const c = ringSys[s.sys], r = Math.hypot(x - c.cx, z - c.cz), a = ((Math.atan2(z - c.cz, x - c.cx) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
      const sec = Math.min(7, Math.floor(a / (Math.PI / 4)));
      ok = r >= ringSys.rows[0] - 1e-3 && r <= ringSys.rows[ringSys.rows.length - 1] + 1e-3 && s.sectors.includes(sec);
    } else {
      const e = C.byId(s.id === 'OVER' ? 'OVERFLOW' : s.id.startsWith('SY') ? 'STOREYARD' : s.id);
      if (e && e.poly) { const xs = e.poly.map((p) => p[0]), zs = e.poly.map((p) => p[1]); ok = x >= Math.min(...xs) - 1e-3 && x <= Math.max(...xs) + 1e-3 && z >= Math.min(...zs) - 1e-3 && z <= Math.max(...zs) + 1e-3; }
      else if (e) ok = x >= e.x0 && x <= e.x1 && z >= e.z0 && z <= e.z1;
    }
    if (!ok) { wrongSlot++; if (!sample) sample = `${codeOf(i)}-${A.seq[i]} (${x.toFixed(1)}, ${z.toFixed(1)}) not in ${s.id}`; }
  }
  check('every unit inside the bounds (x −190 … 190, z −150 … 150)', out === 0, `${out} outside`);
  check('every unit inside its slot (ring radius + sector, or the block / yard frame)', wrongSlot === 0, wrongSlot ? `${wrongSlot}: ${sample}` : 'all inside');
}

// ------------------------------------------------------------------ reachability: within 3 m of an aisle / path
{
  let far = 0, worst = 0, sample = '';
  const t0 = performance.now();
  for (let i = 0; i < N; i++) {
    const d = C.pathDistance(A.x[i], A.z[i]).d;
    if (d > worst) worst = d;
    if (d > 3) { far++; if (!sample) sample = `${codeOf(i)}-${A.seq[i]} ${d.toFixed(2)} m`; }
  }
  numbers.maxPathDistance = +worst.toFixed(3);
  check('every unit within 3 m of an aisle or path', far === 0, far ? `${far} too far, e.g. ${sample}` : `farthest ${worst.toFixed(2)} m (${(performance.now() - t0).toFixed(0)} ms)`);
  const narrow = C.paths.filter((p) => ['aisle', 'avenue', 'road', 'lane'].includes(p.kind) && p.w < C.K.AVENUE_MIN - 1e-9);
  check('aisles, avenues, roads and lanes are at least 4 m wide', !narrow.length, narrow.map((p) => `${p.id} ${p.w}`).join(', ') || `${C.paths.length} paths`);
}

// ------------------------------------------------------------------ unitAt round trip + misses
{
  let bad = 0, sample = '';
  for (let i = 0; i < N; i++) {
    const u = L.unit(codeOf(i), A.seq[i]);
    const r = u && L.unitAt(u.x, u.z);
    if (!u || !r || r.zone !== codeOf(i) || r.seq !== A.seq[i]) { bad++; if (!sample) sample = `${codeOf(i)}-${A.seq[i]} → ${JSON.stringify(r)}`; }
  }
  check('unitAt(unit(z, s)) returns (z, s) for all 10,000', bad === 0, bad ? `${bad} wrong, e.g. ${sample}` : '10,000 / 10,000');
  // with a pad (map taps): a point 0.3 m beside every 7th unit still answers that unit
  let padBad = 0;
  for (let i = 0; i < N; i += 7) { const r = L.unitAt(A.x[i] + 0.3, A.z[i] - 0.2, 0.4); if (!r || r.zone !== codeOf(i) || r.seq !== A.seq[i]) padBad++; }
  check('unitAt with a 0.4 m pad answers the nearest unit for points beside it', padBad === 0, `${padBad} misses of ${Math.ceil(N / 7)}`);
  // misses: aisle centre lines, ring walks, roads, building centres, water
  const miss = [];
  const ring = C.rings.GC, am = C.rings.AM;
  for (let s = 0; s < 8; s++) for (let r = 12; r < 60; r += 1.3) { const a = s * Math.PI / 4; miss.push(['GC aisle', ring.cx + r * Math.cos(a), ring.cz + r * Math.sin(a)]); }
  for (let s = 4; s <= 8; s++) for (let r = 12; r < 60; r += 1.3) { const a = s * Math.PI / 4; miss.push(['AM aisle', am.cx + r * Math.cos(a), am.cz + r * Math.sin(a)]); }
  for (let k = 0; k < 10; k++) for (let a = 0.05; a < 6.28; a += 0.11) { const r = 11 - 1.2 + 5.6 * k; miss.push(['ring walk', ring.cx + r * Math.cos(a), ring.cz + r * Math.sin(a)]); }
  for (const e of C.elements) {
    if (e.type === 'road') for (let t = 0; t < e.pts.length - 1; t++) for (let q = 0; q <= 4; q++) miss.push(['road', e.pts[t][0] + (e.pts[t + 1][0] - e.pts[t][0]) * q / 4, e.pts[t][1] + (e.pts[t + 1][1] - e.pts[t][1]) * q / 4]);
    if (e.type === 'building' && e.kind !== 'storehouse') miss.push(['building ' + e.id, e.x, e.z]);
    if (e.type === 'river') for (const p of e.pts) miss.push(['water', p[0], p[1]]);
  }
  for (const p of C.paths.filter((q) => q.kind === 'lane')) for (const q of p.pts) miss.push(['store lane', q[0] + (q[0] < -100 ? 4 : -4), q[1]]);
  for (const p of C.paths.filter((q) => /^F_.*_W\d+$/.test(q.id))) { const a = p.pts[0], b = p.pts[1]; for (let t = 0.05; t < 1; t += 0.07) miss.push(['field walk', a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]); }
  const hits = miss.filter(([, x, z]) => L.unitAt(x, z) !== null);
  check('unitAt is null on aisles, ring walks, roads, field walks, store lanes, buildings and water', hits.length === 0, hits.length ? `${hits.length} hits, e.g. ${hits[0][0]} (${hits[0][1].toFixed(1)}, ${hits[0][2].toFixed(1)})` : `${miss.length} points, none hit`);
  check('unit() of an unknown zone / seq is null', L.unit('ZZ9', 1) === null && L.unit('J01', 0) === null && L.unit('J01', 1001) === null && L.unit('J01', 'x') === null, 'null');
}

// ------------------------------------------------------------------ terrain
{
  let nonFinite = 0, lo = Infinity, hi = -Infinity;
  for (let x = -450; x <= 450; x += 5) for (let z = -450; z <= 450; z += 5) { const y = C.height(x, z); if (!Number.isFinite(y)) nonFinite++; else { lo = Math.min(lo, y); hi = Math.max(hi, y); } }
  check('height() is finite everywhere (−450 … 450 m, 5 m grid)', nonFinite === 0, `${nonFinite} bad · range ${lo.toFixed(1)} … ${hi.toFixed(1)} m`);
  numbers.heightRange = [+lo.toFixed(2), +hi.toFixed(2)];
  // continuity along every path
  const stepsBad = [];
  let worstStep = 0;
  for (const p of C.paths) {
    const pts = [];
    if (p.arc) { const a = p.arc, n = Math.ceil((a.a1 - a.a0) * a.r / 0.5); for (let i = 0; i <= n; i++) { const t = a.a0 + (a.a1 - a.a0) * i / n; pts.push([a.cx + a.r * Math.cos(t), a.cz + a.r * Math.sin(t)]); } }
    else for (let i = 0; i < p.pts.length - 1; i++) { const [ax, az] = p.pts[i], [bx, bz] = p.pts[i + 1], n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 0.5)); for (let k = 0; k <= n; k++) pts.push([ax + (bx - ax) * k / n, az + (bz - az) * k / n]); }
    let worst = 0;
    if (p.ys) { // a stair with its own profile: the profile must be continuous (it is linear between vertices)
      for (let i = 0; i < p.ys.length - 1; i++) if (!Number.isFinite(p.ys[i]) || !Number.isFinite(p.ys[i + 1])) worst = Infinity;
    } else for (let i = 1; i < pts.length; i++) worst = Math.max(worst, Math.abs(C.height(pts[i][0], pts[i][1]) - C.height(pts[i - 1][0], pts[i - 1][1])));
    if (p.kind !== 'stair') worstStep = Math.max(worstStep, worst);
    if (worst > C.K.STEP_MAX && p.kind !== 'stair') stepsBad.push(`${p.id} ${worst.toFixed(2)}`);
  }
  numbers.maxPathStep = +worstStep.toFixed(3);
  check('height() continuous along every path (no step above 0.5 m per 0.5 m except on stairs)', !stepsBad.length, stepsBad.length ? stepsBad.slice(0, 6).join(', ') : `largest step ${worstStep.toFixed(3)} m over ${C.paths.length} paths`);
  // level under buildings
  const notLevel = [];
  for (const e of C.elements) if (e.type === 'building') {
    const parts = e.parts || [{ x0: e.x - e.w / 2, z0: e.z - e.d / 2, x1: e.x + e.w / 2, z1: e.z + e.d / 2 }];
    let lo2 = Infinity, hi2 = -Infinity;
    for (const pp of parts) for (let i = 0; i <= 4; i++) for (let j = 0; j <= 4; j++) {
      let lx = pp.x0 + (pp.x1 - pp.x0) * i / 4, lz = pp.z0 + (pp.z1 - pp.z0) * j / 4;
      if (e.rot) { const dx = lx - e.x, dz = lz - e.z, c = Math.cos(e.rot), s = Math.sin(e.rot); lx = e.x + dx * c + dz * s; lz = e.z - dx * s + dz * c; }
      const y = C.height(lx, lz); lo2 = Math.min(lo2, y); hi2 = Math.max(hi2, y);
    }
    if (hi2 - lo2 > 0.05 || Math.abs(lo2 - e.y) > 0.05) notLevel.push(`${e.id} ${lo2.toFixed(2)}…${hi2.toFixed(2)} (y ${e.y})`);
  }
  check('the ground is level under every building and equals its y', !notLevel.length, notLevel.length ? notLevel.slice(0, 5).join(', ') : `${C.elements.filter((e) => e.type === 'building').length} buildings level`);
  let yBad = 0, ySample = '';
  for (let i = 0; i < N; i++) { const d = Math.abs(A.y[i] - C.height(A.x[i], A.z[i])); if (d > 2e-3) { yBad++; if (!ySample) ySample = `${codeOf(i)}-${A.seq[i]} y ${A.y[i]} vs ${C.height(A.x[i], A.z[i]).toFixed(3)}`; } }
  check('every unit stands on the ground (unit.y = height(x, z))', yBad === 0, yBad ? `${yBad}, e.g. ${ySample}` : 'all 10,000');
  const water = C.inWater(C.byId('RIVER').pts[3][0], C.byId('RIVER').pts[3][1]) && Number.isFinite(C.waterY(-188, -30)) && C.height(-188, -30) < C.waterY(-188, -30);
  check('the river: water above its bed, the bed below the banks', water, `water ${C.waterY(-188, -30).toFixed(2)} · bed ${C.height(-188, -30).toFixed(2)}`);
}

// ------------------------------------------------------------------ determinism and odd inputs
{
  const L2 = C.layout(C.defaultZones());
  const same = ['x', 'y', 'z', 'rot', 'kind', 'zone', 'seq', 'variant', 'ring'].every((k) => L2.arrays[k].length === A[k].length && L2.arrays[k].every((v, i) => Object.is(v, A[k][i])))
    && JSON.stringify(L2.zones) === JSON.stringify(L.zones);
  const C2 = load(), L3 = C2.layout(C2.defaultZones());
  const same2 = ['x', 'z', 'seq'].every((k) => L3.arrays[k].every((v, i) => Object.is(v, A[k][i])));
  check('deterministic: two layouts (and a fresh evaluation) are deep-equal', same && same2, same && same2 ? 'identical' : 'differ');
  const v = new Set(); for (let i = 0; i < N; i++) v.add(A.variant[i]);
  check('variant is a small deterministic integer (0 … 7) with variety', [...v].every((q) => q >= 0 && q <= 7) && v.size >= 6, `${v.size} values`);

  const odd = [];
  const tryL = (name, zones, fn) => {
    let LL, err = null;
    try { LL = C.layout(zones); } catch (e) { err = e; }
    if (err) { odd.push(`${name}: threw ${err.message}`); return; }
    const sp = spacingCheck(LL);
    let rt = 0;
    for (let i = 0; i < LL.count; i++) { const z = LL.zones[LL.arrays.zone[i]].code, s = LL.arrays.seq[i], u = LL.unit(z, s), r = u && LL.unitAt(u.x, u.z); if (!r || r.zone !== z || r.seq !== s) rt++; }
    const msg = fn(LL);
    if (sp.bad || rt || msg) odd.push(`${name}: ${sp.bad ? sp.bad + ' overlaps ' : ''}${rt ? rt + ' round-trip errors ' : ''}${msg || ''}`);
    return LL;
  };
  tryL('no zones', [], (LL) => (LL.count === 0 && LL.zones.length === 0 ? '' : 'not empty'));
  tryL('null', null, (LL) => (LL.count === 0 ? '' : 'not empty'));
  const L7 = tryL('one zone of 7', [{ code: 'J01', kind: 'jar', name: '작은 구역', cap: 7 }], (LL) => (LL.count === 7 && LL.zones[0].slot === 'GC_SW' ? '' : `count ${LL.count}`));
  const many = [];
  for (let i = 1; i <= 10; i++) many.push({ code: 'J' + String(i).padStart(2, '0'), kind: 'jar', name: `장독대 ${i}`, cap: 400, sort: i });
  for (let i = 1; i <= 8; i++) many.push({ code: 'P' + String(i).padStart(2, '0'), kind: 'plot', name: `텃밭 ${i}`, cap: 300, sort: 10 + i });
  for (let i = 1; i <= 7; i++) many.push({ code: 'S' + String(i).padStart(2, '0'), kind: 'store', name: `창고 ${i}`, cap: 150, sort: 20 + i });
  const L25 = tryL('25 zones', many, (LL) => (LL.zones.length === 25 && LL.total === 10 * 400 + 8 * 300 + 7 * 150 ? '' : 'wrong totals'));
  const L5k = tryL('a zone of 5,000', [{ code: 'BIG', kind: 'jar', name: '큰 구역', cap: 5000 }], (LL) => (LL.count === 5000 && LL.unplaced === 0 && LL.zones[0].slots.length === 5 ? '' : `placed ${LL.count}, slots ${LL.zones[0].slots.length}`));
  tryL('unknown kinds ignored', [{ code: 'X1', kind: 'pond', cap: 10 }, { code: 'J01', kind: 'jar', cap: 3 }, { code: 'bad code!', kind: 'jar', cap: 3 }, { code: 'J01', kind: 'jar', cap: 9 }, 'junk', null],
    (LL) => (LL.zones.length === 1 && LL.count === 3 ? '' : `zones ${LL.zones.map((z) => z.code)}`));
  const huge = [];
  for (let i = 1; i <= 12; i++) huge.push({ code: 'S' + i, kind: 'store', cap: 5000 });
  tryL('far more than the plan holds (60,000 stores)', huge, (LL) => (LL.unplaced > 0 && LL.count === 1000 + 360 && LL.zones.every((z) => z.placed + z.unplaced === z.count) ? '' : `placed ${LL.count}`));
  tryL('map.php shape (s strings, no sort)', [{ code: 'J01', kind: 'jar', name: '장독대 1구역', cap: 12, cols: 40, open: true, s: 'oohlc'.repeat(2) + 'oo' }, { code: 'P01', kind: 'plot', s: 'ooo' }],
    (LL) => (LL.count === 15 ? '' : `count ${LL.count}`));
  check('odd inputs lay out without exceptions or overlaps (none · null · 7 · 25 zones · 5,000 · unknown kinds · 60,000 · map.php shape)', !odd.length, odd.join(' | ') || `25 zones: ${L25 && L25.count} placed, ${L25 && L25.unplaced} to later room; 5,000 → ${L5k && L5k.zones[0].slots.map((s) => s.slot).join('+')}; 7 → ${L7 && L7.count}`);
}

// ------------------------------------------------------------------ cells
{
  const cl = L.cells(), seen = new Uint8Array(N);
  let dup = 0, wrongKind = 0, outCell = 0, sphereBad = 0;
  for (const c of cl.list) for (const k of ['jar', 'plot', 'store']) for (const i of c.units[k]) {
    if (seen[i]) dup++; seen[i] = 1;
    if (kindOf(i) !== k) wrongKind++;
    if (A.x[i] < c.x0 - 1e-6 || A.x[i] > c.x1 + 1e-6 || A.z[i] < c.z0 - 1e-6 || A.z[i] > c.z1 + 1e-6) outCell++;
    if (Math.hypot(A.x[i] - c.sphere.x, A.y[i] - c.sphere.y, A.z[i] - c.sphere.z) > c.sphere.r + 1e-3) sphereBad++;
  }
  const missing = seen.reduce((a, v) => a + (v ? 0 : 1), 0);
  numbers.cells = cl.list.length;
  check('cells (≈ 44 m) cover every unit exactly once, by kind, with a bounding sphere', !dup && !missing && !wrongKind && !outCell && !sphereBad && cl.size === 44,
    `${cl.list.length} cells · dup ${dup} · missing ${missing} · kind ${wrongKind} · outside ${outCell} · sphere ${sphereBad}`);
  const c0 = cl.list[0], at = cl.at((c0.x0 + c0.x1) / 2, (c0.z0 + c0.z1) / 2);
  check('cells.at(x, z) finds the cell', at === c0 && cl.at(9999, 9999) === null, `cell ${c0.id}`);
}

// ------------------------------------------------------------------ elements, walkable, spawn, viewpoints
{
  const ids = new Set(), dupIds = [];
  for (const e of C.elements) { if (ids.has(e.id)) dupIds.push(e.id); ids.add(e.id); }
  const types = new Set(C.elements.map((e) => e.type));
  const need = ['river', 'bridge', 'road', 'roundabout', 'garden', 'parking', 'busbay', 'plaza', 'building', 'corridor', 'wall', 'stair', 'deck', 'terrace', 'field', 'jarcircle', 'amphitheatre', 'storeyard', 'lamp', 'sign', 'forest', 'knoll', 'kiln'];
  const missingT = need.filter((t) => !types.has(t));
  const kinds = new Set(C.elements.filter((e) => e.type === 'building').map((e) => e.kind));
  const hanok = C.elements.filter((e) => e.kind === 'hanok').length, sh = C.elements.filter((e) => e.kind === 'storehouse').length;
  check('elements: unique ids, every type the 2D map and the 3D builder need', !dupIds.length && !missingT.length && ['main', 'cafe', 'gatehouse', 'pavilion', 'workshop', 'hanok', 'storehouse'].every((k) => kinds.has(k)) && hanok === 12 && sh === 8,
    dupIds.length ? `duplicate ${dupIds.join(', ')}` : missingT.length ? `missing ${missingT.join(', ')}` : `${C.elements.length} elements · ${hanok} hanok · ${sh} storehouses · ${C.byId('LAMPS').list.length} lamps`);
  const doorsBad = C.elements.filter((e) => e.type === 'building' && e.door).filter((e) => {
    const d = e.door; if (e.rot) return false;
    const parts = e.parts || [{ x0: e.x - e.w / 2, z0: e.z - e.d / 2, x1: e.x + e.w / 2, z1: e.z + e.d / 2 }];
    return !parts.some((p) => d.x >= p.x0 - 1.5 && d.x <= p.x1 + 1.5 && d.z >= p.z0 - 1.5 && d.z <= p.z1 + 1.5);
  });
  check('every door lies on its building', !doorsBad.length, doorsBad.map((e) => e.id).join(', ') || 'ok');
  const S = C.spawn, onWalk = C.walkable(S.x, S.z), jarI = L.index('J01', 1);
  const w = {
    spawn: onWalk, jar: !C.walkable(A.x[jarI], A.z[jarI]), river: !C.walkable(-188, -30), main: !C.walkable(C.byId('B_MAIN').x, C.byId('B_MAIN').z),
    gatePassage: C.walkable(C.byId('B_GATE').x, C.byId('B_GATE').z), gateWing: !C.walkable(C.byId('B_GATE').x + 5 * Math.cos(C.byId('B_GATE').rot), C.byId('B_GATE').z - 5 * Math.sin(C.byId('B_GATE').rot)),
    aisle: C.walkable(C.rings.GC.cx + 30, C.rings.GC.cz), outside: !C.walkable(400, 0), wall: !C.walkable(C.rings.GC.cx + 61.6 * Math.cos(0.4), C.rings.GC.cz + 61.6 * Math.sin(0.4)),
  };
  check('walkable(): spawn, aisles and the gate passage yes; jars, river, buildings, walls, outside no', Object.values(w).every(Boolean), Object.entries(w).map(([k, v]) => `${k} ${v ? '✓' : '✗'}`).join(' '));
  const vp = C.viewpoints, vpOk = vp.length >= 4 && vp.every((p) => [p.x, p.y, p.z, p.look.x, p.look.y, p.look.z, p.fov].every(Number.isFinite)) && vp.some((p) => p.id === 'deck') && vp.some((p) => p.id === 'aerial');
  check('spawn by the roundabout, the deck + aerial + photo viewpoints, the bus stop', vpOk && Math.hypot(S.x - C.busStop.x, S.z - C.busStop.z) < 15 && Number.isFinite(S.y),
    `${vp.map((p) => p.id).join(', ')} · spawn (${S.x}, ${S.z})`);
  const deckStairs = C.paths.filter((p) => p.kind === 'stair' && p.ys);
  const deckY = C.byId('DECK').y, top = Math.max(...deckStairs.flatMap((p) => p.ys)), bottom = Math.min(...deckStairs.flatMap((p) => p.ys));
  check('the deck is reached by stair legs from the road (profile from the ground to the deck)', deckStairs.length >= 3 && Math.abs(top - deckY) < 1e-6 && Math.abs(bottom - C.height(-112, 141)) < 0.5,
    `${deckStairs.length} legs ${bottom.toFixed(1)} → ${top.toFixed(1)} m`);
}

// ------------------------------------------------------------------ draw() on a recording context
{
  const calls = { fill: 0, stroke: 0, fillRect: 0, text: 0 };
  const noop = () => {};
  const ctx = new Proxy({ canvas: { width: 640, height: 520 } }, {
    get(t, k) {
      if (k in t) return t[k];
      if (k === 'fill') return () => calls.fill++;
      if (k === 'stroke') return () => calls.stroke++;
      if (k === 'fillRect') return () => calls.fillRect++;
      if (k === 'fillText' || k === 'strokeText') return () => calls.text++;
      return noop;
    },
    set(t, k, v) { t[k] = v; return true; },
  });
  let err = null;
  const t0 = performance.now();
  const colours = new Set();
  try { C.draw(ctx, C.fitView(640, 520, 8), { layout: L, unitStyle: (z, s, k) => { const c = (s % 3 === 0 ? '#c0392b' : k === 'jar' ? '#7a4a2a' : '#5f8f3a'); colours.add(c); return s % 10 === 0 ? null : c; } }); } catch (e) { err = e; }
  const ms = performance.now() - t0;
  numbers.drawMs = +ms.toFixed(1);
  check('draw() paints the site plan (relief, river, roads, buildings, rings, units through unitStyle, Korean labels)', !err && calls.fill > 30 && calls.fillRect > 500 && calls.text > 10 && colours.size >= 2,
    err ? err.message : `${ms.toFixed(0)} ms · fill ${calls.fill} · rects ${calls.fillRect} · text ${calls.text}`);
}

// ------------------------------------------------------------------ timing
{
  const best = (fn, reps = 5) => { let b = Infinity; for (let r = 0; r < reps; r++) { const t = performance.now(); fn(); b = Math.min(b, performance.now() - t); } return b; };
  const zones = C.defaultZones();
  best(() => C.layout(zones), 2);
  const tl = best(() => C.layout(zones));
  const codes = L.zones.map((z) => z.code);
  const tu = best(() => { let s = 0; for (let k = 0; k < 10000; k++) { const u = L.unit(codes[k % codes.length], 1 + (k * 7) % 500); s += u.x; } return s; });
  const xs = new Float64Array(100000), zs = new Float64Array(100000);
  for (let k = 0; k < 100000; k++) { const i = (k * 7919) % N; xs[k] = A.x[i] + ((k % 7) - 3) * 0.3; zs[k] = A.z[i] + ((k % 5) - 2) * 0.2; }
  const ta = best(() => { let h = 0; for (let k = 0; k < 100000; k++) if (L.unitAt(xs[k], zs[k])) h++; return h; });
  Object.assign(numbers, { layoutMs: +tl.toFixed(2), unit10kMs: +tu.toFixed(2), unitAt100kMs: +ta.toFixed(2) });
  check('timing: layout < 50 ms', tl < 50, `${tl.toFixed(1)} ms (best of 5)`);
  check('timing: 10,000 unit() < 20 ms', tu < 20, `${tu.toFixed(1)} ms`);
  check('timing: 100,000 unitAt() < 100 ms', ta < 100, `${ta.toFixed(1)} ms`);
}

// ------------------------------------------------------------------ result
const failed = results.filter((r) => !r.ok);
log(`\n${failed.length ? '✖' : '✔'} complex-plan: ${results.length - failed.length}/${results.length} passed`);
log('numbers', JSON.stringify(numbers));
if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify({ passed: results.length - failed.length, total: results.length, results, numbers }, null, 2));
process.exit(failed.length ? 1 : 0);
