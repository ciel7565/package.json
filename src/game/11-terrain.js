// =============================================================================
// 11-terrain.js — Korean mountain valley: analytic height field baked into height
// grids (exact mesh heights), river & pond carving, flattened campus features,
// vertex-coloured terrain, layered backdrop mountains, roads & paths, world fns.
//
//   G.sys.terrain (order 10)
//     heightAt(x,z)            exact height of the rendered terrain (same triangulation as the mesh)
//     isWater(x,z)             deep water (river / ponds) -> not walkable
//     surfaceAt(x,z)           'road'|'stone'|'dirt'|'wood'|'water'|'sand'|'grass'
//     riverDistance(x,z)       metres to the river centre line
//     pondInfo(x,z)            {pond, d} nearest pond and distance to its shore (negative inside)
//     mountainMask(x,z)        0 valley floor .. 1 mountain slope;  mountainHeight(x,z) raw slope height
//     vegBlocked(x,z,r,kind)   true where vegetation must not stand (kind 'tree'|'shrub')
//     flatWeight(x,z)          1 on flattened campus features;  pathDistance(x,z), inZone(x,z)
//     colorAt(x,z,target?)     ground colour (THREE.Color in the linear working space; getHexString() -> sRGB),
//                              e.g. for the minimap base map
//     ensureFields()           compute the height/feature fields early (pure JS; nature/water call it)
//     riverLine / roadLines / pathLines   smoothed centre lines ([[x,z],...])
//     uniforms + glslTerrain   GPU height / ground colour / grass-mask textures (grass, water)
//     noise2(x,z), fbm2(x,z,oct)  deterministic Perlin noise shared with nature/water
//     manjangdae               정선 만장대 lookout (phase 4): {x, z, r, top, pts (switchback centre line,
//                              top -> foot), s (arc length per point), y (path height per point), len,
//                              pathY(s), nearest(x,z) -> {i, s, d, x, z}, hill(x,z)} | null
// The lookout hill (layout.manjangdae) is added on top of the valley floor after the campus flattening
// (roads / river / buildings keep it away), with a flat paved plateau, a steep north face towards the view,
// a gentler north-west flank carrying the filleted switchback path (carved as a level bench at a constant
// grade) and a forested ridge running out of the valley to the south. It feeds the mountain field (forest
// & ground colours) except inside the view wedge below the deck, and never gets slope colliders (the
// lookout module fences the path and the plateau instead).
// =============================================================================
(function () {
  const L = G.data.layout || {};
  const PI = Math.PI;
  const WATER_Y = L.waterY ?? -1.1;
  const RIVER_HW = ((L.river && L.river.width) || 16) / 2;
  const BED_Y = -2.6;
  const BOX = L.bounds || { minX: -135, maxX: 135, minZ: -135, maxZ: 135 };
  const HALF = (L.worldSize || 1000) / 2;        // terrain extent ±500
  const CORE = 160;                               // high-res core ±160
  const SURF = ['grass', 'road', 'stone', 'dirt', 'wood', 'sand', 'water'];
  const S_GRASS = 0, S_ROAD = 1, S_STONE = 2, S_DIRT = 3, S_WOOD = 4, S_SAND = 5, S_WATER = 6;
  const PATH_SURF = { stone: S_STONE, dirt: S_DIRT, wood: S_WOOD, asphalt: S_ROAD };

  // ---------------------------------------------------------------- deterministic Perlin noise
  function makePerlin(seed) {
    const rnd = G.util.rng(seed);
    const perm = new Uint8Array(256);
    for (let i = 0; i < 256; i++) perm[i] = i;
    for (let i = 255; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const t = perm[i]; perm[i] = perm[j]; perm[j] = t; }
    const p = new Uint8Array(512);
    for (let i = 0; i < 512; i++) p[i] = perm[i & 255];
    const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
    const lerp = (t, a, b) => a + t * (b - a);
    const grad = (h, x, y, z) => {
      h &= 15;
      const u = h < 8 ? x : y;
      const v = h < 4 ? y : (h === 12 || h === 14 ? x : z);
      return ((h & 1) ? -u : u) + ((h & 2) ? -v : v);
    };
    return function n3(x, y, z) {
      let X = Math.floor(x), Y = Math.floor(y), Z = Math.floor(z);
      x -= X; y -= Y; z -= Z;
      X &= 255; Y &= 255; Z &= 255;
      const u = fade(x), v = fade(y), w = fade(z);
      const A = p[X] + Y, AA = p[A] + Z, AB = p[A + 1] + Z, B = p[X + 1] + Y, BA = p[B] + Z, BB = p[B + 1] + Z;
      return lerp(w,
        lerp(v, lerp(u, grad(p[AA], x, y, z), grad(p[BA], x - 1, y, z)), lerp(u, grad(p[AB], x, y - 1, z), grad(p[BB], x - 1, y - 1, z))),
        lerp(v, lerp(u, grad(p[AA + 1], x, y, z - 1), grad(p[BA + 1], x - 1, y, z - 1)), lerp(u, grad(p[AB + 1], x, y - 1, z - 1), grad(p[BB + 1], x - 1, y - 1, z - 1))));
    };
  }
  const N3 = makePerlin(20261006);
  const N2 = (x, z) => N3(x, z, 0.371);
  function fbm2(x, z, oct = 4) {
    let s = 0, a = 0.5, f = 1, n = 0;
    for (let i = 0; i < oct; i++) { s += a * N3(x * f, z * f, 0.371 + i * 7.13); n += a; a *= 0.5; f *= 2.03; }
    return s / n;
  }

  // ---------------------------------------------------------------- small geometry helpers
  const smooth = (a, b, v) => { let t = (v - a) / (b - a); t = t < 0 ? 0 : t > 1 ? 1 : t; return t * t * (3 - 2 * t); };
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  function segDist(px, pz, ax, az, bx, bz) {
    const vx = bx - ax, vz = bz - az, wx = px - ax, wz = pz - az;
    const l2 = vx * vx + vz * vz;
    let t = l2 > 1e-9 ? (wx * vx + wz * vz) / l2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const dx = wx - vx * t, dz = wz - vz * t;
    return Math.sqrt(dx * dx + dz * dz);
  }
  function polyDist(pts, x, z) {
    let best = 1e9;
    for (let i = 0; i < pts.length - 1; i++) {
      const d = segDist(x, z, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]);
      if (d < best) best = d;
    }
    return best;
  }
  function dedupe(pts) {
    const out = [];
    for (const p of pts) { const q = out[out.length - 1]; if (!q || Math.abs(q[0] - p[0]) + Math.abs(q[1] - p[1]) > 0.05) out.push([p[0], p[1]]); }
    return out;
  }
  /** Catmull-Rom (centripetal) smoothing, resampled at ~step metres */
  function smoothLine(pts, step) {
    pts = dedupe(pts);
    if (pts.length < 2) return pts;
    let curvePts;
    if (pts.length === 2) {
      const [a, b] = pts;
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const n = Math.max(1, Math.ceil(len / step));
      curvePts = [];
      for (let i = 0; i <= n; i++) curvePts.push([a[0] + (b[0] - a[0]) * (i / n), a[1] + (b[1] - a[1]) * (i / n)]);
      return curvePts;
    }
    const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(p[0], 0, p[1])), false, 'centripetal');
    const n = Math.max(2, Math.ceil(curve.getLength() / step));
    return curve.getSpacedPoints(n).map((v) => [v.x, v.z]);
  }
  function lineLength(pts) { let s = 0; for (let i = 1; i < pts.length; i++) s += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); return s; }
  /** extend a polyline end beyond `limit` along its end direction */
  function extendEnd(pts, atStart, limitZ) {
    const a = atStart ? pts[0] : pts[pts.length - 1];
    const b = atStart ? pts[1] : pts[pts.length - 2];
    let dx = a[0] - b[0], dz = a[1] - b[1];
    const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
    if (Math.abs(dz) < 0.2) return pts;
    const t = (limitZ - a[1]) / dz;
    if (t <= 0) return pts;
    const mid = [a[0] + dx * t * 0.5, a[1] + dz * t * 0.5], end = [a[0] + dx * t, a[1] + dz * t];
    return atStart ? [end, mid, ...pts] : [...pts, mid, end];
  }

  // ---------------------------------------------------------------- centre lines
  const lines = { river: [], riverCoarse: [], roads: [], roadsCoarse: [], paths: [] };
  function prepareLines() {
    let rp = (L.river?.points || [[100, -500], [100, 500]]).map((p) => [p[0], p[1]]);
    rp = extendEnd(rp, true, -(HALF + 40));
    rp = extendEnd(rp, false, HALF + 40);
    lines.riverCoarse = rp;
    lines.river = smoothLine(rp, 4);
    for (const r of L.roads || []) {
      let pts = r.points.map((p) => [p[0], p[1]]);
      // the main road leaves the valley to the south: continue it to the world edge (visual + flattening only)
      if (r.id === 'ROAD_MAIN' && pts[0][1] > 120) pts = [[18, HALF + 20], [13, 380], [9.5, 265], ...pts];
      const hw = (r.width || 7) / 2;
      lines.roadsCoarse.push({ id: r.id, hw, pts });
      lines.roads.push({ id: r.id, type: r.type || 'asphalt', width: r.width || 7, hw, pts: smoothLine(pts, 1.5), coarse: smoothLine(pts, 3) });
    }
    for (const p of L.paths || []) {
      const hw = (p.width || 2.5) / 2;
      if (p.elevated) {
        // the 만장대 switchback path: filleted hairpins, carved by mdCarve (never flattened to the valley floor)
        const pts = MD ? MD.pts : smoothLine(p.points, 0.7);
        lines.paths.push({ id: p.id, type: p.type || 'stone', width: p.width || 3, hw, pts, coarse: pts.filter((_, i) => i % 3 === 0 || i === pts.length - 1), elevated: true });
        continue;
      }
      lines.paths.push({ type: p.type || 'dirt', width: p.width || 2.5, hw, pts: smoothLine(p.points, 0.7), coarse: smoothLine(p.points, 2.2) });
    }
  }

  // ---------------------------------------------------------------- 정선 만장대 (lookout hill, phase 4)
  let MD = null;
  /** fillet every corner of a polyline with an arc of radius R (hairpins become smooth turns), resampled at `step` */
  function filletLine(pts, R, step) {
    const out = [];
    const push = (x, z) => { const q = out[out.length - 1]; if (!q || Math.hypot(q[0] - x, q[1] - z) > 1e-3) out.push([x, z]); };
    push(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length - 1; i++) {
      const [ax, az] = pts[i - 1], [bx, bz] = pts[i], [cx, cz] = pts[i + 1];
      let ux = bx - ax, uz = bz - az, vx = cx - bx, vz = cz - bz;
      const lu = Math.hypot(ux, uz), lv = Math.hypot(vx, vz);
      if (!(lu > 1e-6) || !(lv > 1e-6)) { push(bx, bz); continue; }
      ux /= lu; uz /= lu; vx /= lv; vz /= lv;
      const cos = clamp(ux * vx + uz * vz, -0.999, 0.999), th = Math.acos(cos);
      if (th < 0.05) { push(bx, bz); continue; }
      let r = R, tl = r * Math.tan(th / 2);
      const lim = Math.min(lu, lv) * 0.45;
      if (tl > lim) { tl = lim; r = tl / Math.tan(th / 2); }
      const p0x = bx - ux * tl, p0z = bz - uz * tl;
      const cross = ux * vz - uz * vx;            // >0: turning one way, <0 the other
      const nx = cross > 0 ? -uz : uz, nz = cross > 0 ? ux : -ux; // towards the arc centre
      const ccx = p0x + nx * r, ccz = p0z + nz * r;
      const a0 = Math.atan2(p0z - ccz, p0x - ccx);
      const sweep = (cross > 0 ? 1 : -1) * th;
      push(p0x, p0z);
      const n = Math.max(2, Math.ceil((Math.abs(sweep) * r) / (step * 0.6)));
      for (let k = 1; k <= n; k++) { const a = a0 + sweep * (k / n); push(ccx + Math.cos(a) * r, ccz + Math.sin(a) * r); }
    }
    push(pts[pts.length - 1][0], pts[pts.length - 1][1]);
    // resample at ~step
    const res = [out[0]];
    for (let i = 1; i < out.length; i++) {
      const [ax, az] = out[i - 1], [bx, bz] = out[i];
      const l = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.ceil(l / step));
      for (let k = 1; k <= n; k++) res.push([ax + (bx - ax) * (k / n), az + (bz - az) * (k / n)]);
    }
    return res;
  }
  function prepareManjangdae() {
    const M = L.manjangdae;
    if (!M || !Array.isArray(M.route) || M.route.length < 2 || ![M.x, M.z, M.r, M.top].every(Number.isFinite)) { MD = null; return; }
    const pts = filletLine(M.route, M.hairpinR || 3.4, 0.8);
    const n = pts.length, sArr = new Float32Array(n), yArr = new Float32Array(n);
    for (let i = 1; i < n; i++) sArr[i] = sArr[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    const len = sArr[n - 1] || 1, top = M.top, foot = Number.isFinite(M.footY) ? M.footY : 0;
    for (let i = 0; i < n; i++) yArr[i] = top + (foot - top) * (sArr[i] / len);
    const a = Number.isFinite(M.gentleBearing) ? M.gentleBearing : -Math.PI * 0.75;
    MD = {
      x: M.x, z: M.z, r: M.r, top, hw: (M.pathWidth || 3) / 2,
      ux: Math.sin(a), uz: Math.cos(a), span: M.gentleSpan || 60, wSteep: M.steepWidth || 20, wGentle: M.gentleWidth || 36,
      ridge: (M.ridge || []).filter((q) => Array.isArray(q) && q.length >= 5 && q.every(Number.isFinite)),
      view: M.view || null, pts, s: sArr, y: yArr, len,
      bx0: Math.min(...pts.map((p) => p[0])) - 6, bx1: Math.max(...pts.map((p) => p[0])) + 6,
      bz0: Math.min(...pts.map((p) => p[1])) - 6, bz1: Math.max(...pts.map((p) => p[1])) + 6,
    };
    // the player's route hint follows exactly this centre line
    for (const nl of L.navLinks || []) if (nl && nl.id === (M.navLink || 'MANJANGDAE')) nl.route = pts.map((p) => [p[0], p[1]]);
  }
  /** soft linear ramp 1 -> 0 over u in [0, 1] with rounded ends */
  function mdRamp(u) {
    if (u <= 0) return 1; if (u >= 1) return 0;
    const e = 0.18;
    if (u < e) return 1 - (u * u) / (2 * e * (1 - e));
    if (u > 1 - e) { const v = 1 - u; return (v * v) / (2 * e * (1 - e)); }
    return 1 - (u - e / 2) / (1 - e);
  }
  /** additive hill height (before protection by roads / river / buildings) */
  function mdHill(x, z) {
    if (!MD) return 0;
    const dx = x - MD.x, dz = z - MD.z, r = Math.sqrt(dx * dx + dz * dz);
    let h;
    if (r <= MD.r) h = MD.top;
    else {
      const ca = (dx * MD.ux + dz * MD.uz) / r;
      const ang = Math.acos(clamp(ca, -1, 1)) * 57.29578;
      const g = 1 - smooth(MD.span * 0.6, MD.span, ang);
      const wf = MD.wSteep + (MD.wGentle - MD.wSteep) * g;
      h = MD.top * mdRamp((r - MD.r) / wf);
    }
    // ridge spine running out of the valley (skips its round start: the dome owns the summit)
    const R = MD.ridge;
    for (let i = 0; i < R.length - 1; i++) {
      const a = R[i], b = R[i + 1];
      const vx = b[0] - a[0], vz = b[1] - a[1], l2 = vx * vx + vz * vz;
      let t = l2 > 1e-9 ? ((x - a[0]) * vx + (z - a[1]) * vz) / l2 : 0;
      if (i === 0 && t <= 0.02) continue;
      t = clamp(t, 0, 1);
      const d = Math.hypot(x - a[0] - vx * t, z - a[1] - vz * t);
      const crest = a[2] + (b[2] - a[2]) * t, w0 = a[3] + (b[3] - a[3]) * t, wf = a[4] + (b[4] - a[4]) * t;
      const hr = crest * (1 - smooth(w0, w0 + wf, d)) * (1 + 0.08 * N2(x / 23 + 4, z / 23 - 2));
      if (hr > h) h = hr;
    }
    return h;
  }
  /** nearest point on the switchback centre line -> {i, s, d, x, z} (reused object) */
  const _mdN = { i: 0, s: 0, d: 1e9, x: 0, z: 0 };
  function mdNearest(x, z) {
    _mdN.d = 1e9;
    if (!MD) return _mdN;
    const P = MD.pts;
    for (let i = 0; i < P.length - 1; i++) {
      const ax = P[i][0], az = P[i][1], vx = P[i + 1][0] - ax, vz = P[i + 1][1] - az;
      const l2 = vx * vx + vz * vz;
      let t = l2 > 1e-9 ? ((x - ax) * vx + (z - az) * vz) / l2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const px = ax + vx * t, pz = az + vz * t, d = Math.hypot(x - px, z - pz);
      if (d < _mdN.d) { _mdN.d = d; _mdN.i = i; _mdN.s = MD.s[i] + (MD.s[i + 1] - MD.s[i]) * t; _mdN.x = px; _mdN.z = pz; }
    }
    return _mdN;
  }
  function mdPathY(s) {
    if (!MD) return 0;
    return MD.top + ((MD.y[MD.y.length - 1]) - MD.top) * clamp(s / MD.len, 0, 1);
  }
  /** 0..1 inside the view wedge below the deck (no forest there, rock & grass instead) */
  function mdView(x, z) {
    const v = MD && MD.view;
    if (!v) return 0;
    const ox = Math.max(0, Math.abs(x - v.x) - v.hw), oz = Math.max(0, Math.abs(z - v.z) - v.hd);
    return 1 - smooth(0, 5, Math.hypot(ox, oz));
  }

  // ---------------------------------------------------------------- feature index (layout -> shapes)
  // shape t: 1 circle {x,z,r}, 2 oriented rect {x,z,hw,hd,rot}, 3 segment {ax,az,bx,bz,hw}
  const K_RIVER = 1, K_ROAD = 2, K_PATH = 3, K_ZONE = 4, K_OTHER = 0;
  const BIN = 10, B0 = -HALF - 80, BN = Math.ceil((2 * HALF + 160) / BIN);
  const bins = new Array(BN * BN);
  const binsLite = new Array(BN * BN);   // only features that matter for surface classes / grass mask
  const feats = [];
  function addF(f) {
    f.flatPad = f.flat ? f.flat[0] : 0; f.flatBlend = f.flat ? f.flat[1] : 0;
    f.protPad = f.prot ? f.prot[0] : 0; f.protBlend = f.prot ? f.prot[1] : 0;
    if (f.t === 2) { f.c = Math.cos(f.rot || 0); f.s = Math.sin(f.rot || 0); }
    let x0, x1, z0, z1;
    if (f.t === 1) { x0 = f.x - f.r; x1 = f.x + f.r; z0 = f.z - f.r; z1 = f.z + f.r; }
    else if (f.t === 2) { const ex = f.hw * Math.abs(f.c) + f.hd * Math.abs(f.s), ez = f.hw * Math.abs(f.s) + f.hd * Math.abs(f.c); x0 = f.x - ex; x1 = f.x + ex; z0 = f.z - ez; z1 = f.z + ez; }
    else { x0 = Math.min(f.ax, f.bx) - f.hw; x1 = Math.max(f.ax, f.bx) + f.hw; z0 = Math.min(f.az, f.bz) - f.hw; z1 = Math.max(f.az, f.bz) + f.hw; }
    const reach = Math.max(f.flatPad + f.flatBlend, f.protPad + f.protBlend, (f.vegT ?? -9) + 6, (f.vegS ?? -9) + 2.5, f.grass ?? 0, f.tintPad || 0, f.reach || 0, 0.5);
    const i0 = clamp(Math.floor((x0 - reach - B0) / BIN), 0, BN - 1), i1 = clamp(Math.floor((x1 + reach - B0) / BIN), 0, BN - 1);
    const j0 = clamp(Math.floor((z0 - reach - B0) / BIN), 0, BN - 1), j1 = clamp(Math.floor((z1 + reach - B0) / BIN), 0, BN - 1);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const k = j * BN + i; (bins[k] || (bins[k] = [])).push(f); }
    // lite index: surfaces, grass exclusion, path/road edge distance, river sand band
    let lite = -1;
    if (f.kind === K_RIVER) lite = RIVER_HW + 7;
    else if (f.kind === K_PATH || f.kind === K_ROAD) lite = 1;
    else if (f.surf) lite = 0.5;
    if (f.grass != null) lite = Math.max(lite, f.grass + 0.5);
    if (lite >= 0) {
      const a0 = clamp(Math.floor((x0 - lite - B0) / BIN), 0, BN - 1), a1 = clamp(Math.floor((x1 + lite - B0) / BIN), 0, BN - 1);
      const b0 = clamp(Math.floor((z0 - lite - B0) / BIN), 0, BN - 1), b1 = clamp(Math.floor((z1 + lite - B0) / BIN), 0, BN - 1);
      for (let j = b0; j <= b1; j++) for (let i = a0; i <= a1; i++) { const k = j * BN + i; (binsLite[k] || (binsLite[k] = [])).push(f); }
    }
    feats.push(f);
    return f;
  }
  function binAt(x, z) {
    const i = Math.floor((x - B0) / BIN), j = Math.floor((z - B0) / BIN);
    if (i < 0 || j < 0 || i >= BN || j >= BN) return null;
    return bins[j * BN + i] || null;
  }
  /** unsigned distance from the shape (0 inside) */
  function fdist(f, x, z) {
    if (f.t === 3) { const d = segDist(x, z, f.ax, f.az, f.bx, f.bz) - f.hw; return d > 0 ? d : 0; }
    const dx = x - f.x, dz = z - f.z;
    if (f.t === 1) { const d = Math.sqrt(dx * dx + dz * dz) - f.r; return d > 0 ? d : 0; }
    // same local frame as G.world (toLocal)
    const lx = dx * f.c - dz * f.s, lz = dx * f.s + dz * f.c;
    const qx = Math.abs(lx) - f.hw, qz = Math.abs(lz) - f.hd;
    if (qx <= 0 && qz <= 0) return 0;
    const ox = qx > 0 ? qx : 0, oz = qz > 0 ? qz : 0;
    return Math.sqrt(ox * ox + oz * oz);
  }
  function addLine(pts, hw, props) {
    for (let i = 0; i < pts.length - 1; i++) addF({ t: 3, ax: pts[i][0], az: pts[i][1], bx: pts[i + 1][0], bz: pts[i + 1][1], hw, ...props });
  }

  const COL = {};
  function buildFeatures() {
    const c = (hex) => new THREE.Color(hex);
    Object.assign(COL, {
      yard: c('#9a8565'), stone: c('#958e82'), soil: c('#4f3b2c'), gravel: c('#7d7a74'), dirt: c('#93795a'),
    });
    // river centre line (distance queries + bank flattening)
    addLine(lines.river, 0, { kind: K_RIVER, flat: [RIVER_HW + 11, 8], vegT: RIVER_HW + 3.2, vegS: RIVER_HW + 0.6, reach: RIVER_HW + 26 });
    // roads
    for (const r of lines.roads) {
      const crossLink = r.id !== 'ROAD_MAIN';
      addLine(r.coarse, r.hw, { kind: K_ROAD, flat: [2.4, 5], prot: [1.2, 2], vegT: 3.0, vegS: 1.0, grass: 0.5, surf: S_ROAD, prio: crossLink ? 6 : 7 });
    }
    // paths
    for (const p of lines.paths) {
      const surf = PATH_SURF[p.type] ?? S_DIRT;
      if (p.elevated) { // carved by mdCarve: no flattening, keeps vegetation & grass off the stone
        addLine(p.coarse, p.hw, { kind: K_PATH, ptype: p.type, vegT: 2.2, vegS: 0.6, grass: 0.1, surf, prio: 4, tint: COL.stone, tintPad: 0.7, tintStr: 0.55 });
        continue;
      }
      addLine(p.coarse, p.hw, { kind: K_PATH, ptype: p.type, flat: [0.8, 2.6], prot: [1.2, 1.6], vegT: 1.7, vegS: 0.45, grass: -0.05, surf, prio: surf === S_WOOD ? 5 : surf === S_STONE ? 4 : 3 });
    }
    // plaza & hall plaza
    if (L.plaza) addF({ t: 1, x: L.plaza.x, z: L.plaza.z, r: L.plaza.r, flat: [1.2, 4], vegT: 3, vegS: 0.7, grass: 0.25, surf: S_STONE, prio: 2, tint: COL.stone, tintPad: 0.8, tintStr: 0.85 });
    if (L.hallPlaza) addF({ t: 2, x: L.hallPlaza.x, z: L.hallPlaza.z, hw: L.hallPlaza.w / 2, hd: L.hallPlaza.d / 2, rot: 0, flat: [1.2, 4], vegT: 3, vegS: 0.6, grass: 0.25, surf: S_STONE, prio: 2, tint: COL.stone, tintPad: 0.8, tintStr: 0.85 });
    // zones: flat slightly inside the circle, trees kept to the rim
    for (const zn of G.data.zones || []) {
      if (zn.elevated) { addF({ t: 1, x: zn.center[0], z: zn.center[1], r: zn.r * 0.82, kind: K_ZONE, vegT: 0 }); continue; } // 만장대: keep the hill
      addF({ t: 1, x: zn.center[0], z: zn.center[1], r: zn.r * 0.82, kind: K_ZONE, flat: [zn.r * 0.08, 6], vegT: 0 });
    }
    // buildings
    for (const b of L.buildings || []) {
      const big = b.type === 'hall';
      addF({ t: 2, x: b.x, z: b.z, hw: b.w / 2, hd: b.d / 2, rot: b.rot || 0, flat: [big ? 5 : 3, 5], prot: [1.5, 2], vegT: big ? 6 : 3.4, vegS: 0.9, grass: 0.35,
        tint: big ? COL.stone : COL.yard, tintPad: big ? 4 : 1.6, tintStr: big ? 0.6 : 0.28 });
    }
    // farm plots
    for (const p of L.farmPlots || []) addF({ t: 2, x: p.x, z: p.z, hw: p.w / 2, hd: p.d / 2, rot: p.rot || 0, flat: [1.6, 3], vegT: 2.6, vegS: 0.7, grass: 0.2, surf: S_DIRT, prio: 1, tint: COL.dirt, tintPad: 0.9, tintStr: 0.6 });
    // jangdokdae platforms
    for (const pl of L.jangdokdae?.platforms || []) {
      if (pl.shape === 'circle') addF({ t: 1, x: pl.x, z: pl.z, r: pl.r, flat: [2, 4], prot: [1.4, 2], vegT: 2.6, vegS: 0.6, grass: 0.15, tint: COL.yard, tintPad: 0.6, tintStr: 0.5 });
      else addF({ t: 2, x: pl.x, z: pl.z, hw: pl.hw, hd: pl.hd, rot: pl.rot || 0, flat: [2, 4], prot: [1.4, 2], vegT: 2.6, vegS: 0.6, grass: 0.15, tint: COL.yard, tintPad: 0.6, tintStr: 0.5 });
    }
    // parking & river deck
    if (L.parking) addF({ t: 2, x: L.parking.x, z: L.parking.z, hw: L.parking.w / 2, hd: L.parking.d / 2, rot: L.parking.rot || 0, flat: [2, 4], vegT: 3, vegS: 0.9, grass: 0.3, surf: S_ROAD, prio: 2, tint: COL.gravel, tintPad: 0.8, tintStr: 0.9 });
    if (L.riverDeck) addF({ t: 2, x: L.riverDeck.x, z: L.riverDeck.z, hw: L.riverDeck.w / 2, hd: L.riverDeck.d / 2, rot: L.riverDeck.rot || 0, flat: [1, 3], prot: [1, 2.5], vegT: 2.2, vegS: 0.6, grass: 0.3, surf: S_WOOD, prio: 5 });
    // flower beds (soil discs; nature plants them)
    for (const fb of L.flowerBeds || []) addF({ t: 1, x: fb.x, z: fb.z, r: fb.r, flat: [0.6, 2], prot: [1.8, 1.5], vegT: 2.2, vegS: 0.35, grass: 0.05, tint: COL.soil, tintPad: 0.25, tintStr: 0.75 });
    // small anchors: keep a clean, flat footprint around interactive props
    const pts = [];
    const push = (o, r = 0.9) => { if (o && Number.isFinite(o.x) && Number.isFinite(o.z)) pts.push([o.x, o.z, r]); };
    (L.signs || []).forEach((o) => push(o, 0.9)); (L.kiosks || []).forEach((o) => push(o, 1.0)); (L.exhibits || []).forEach((o) => push(o, 1.2));
    (L.tools || []).forEach((o) => push(o, 0.9)); (L.jarDisplays || []).forEach((o) => push(o, 1.0)); (L.jars || []).forEach((o) => push(o, 0.8));
    (L.lanterns || []).forEach((o) => push(o, 0.6)); (L.benches || []).forEach((o) => push(o, 1.1));
    push(L.craftTable, 1.4); push(L.shopStall, 3); push(L.hallDoor, 1.5);
    for (const [x, z, r] of pts) addF({ t: 1, x, z, r, flat: [0.8, 1.6], vegT: 2.4, vegS: 0.7, grass: 0.35 });
    if (L.eduBoard) addF({ t: 2, x: L.eduBoard.x, z: L.eduBoard.z, hw: (L.eduBoard.w || 6) / 2, hd: 0.6, rot: L.eduBoard.rot || 0, flat: [1, 2], vegT: 3, vegS: 0.8, grass: 0.3 });
    for (const pz of L.photoZones || []) addF({ t: 1, x: pz.x, z: pz.z, r: pz.r, vegT: 0.8, vegS: 0 });
    for (const lt of L.landmarkTrees || []) addF({ t: 1, x: lt.x, z: lt.z, r: 0.8, flat: [1, 2], vegT: 4.5 * (lt.scale || 1), vegS: 1.4, grass: 0.4 });
    for (const w of L.stoneWalls || []) addF({ t: 3, ax: w[0], az: w[1], bx: w[2], bz: w[3], hw: 0.45, flat: [0.6, 1.5], vegT: 2, vegS: 0.35, grass: 0.1 });
    if (L.spawn) {
      const onHill = MD && Math.hypot(L.spawn.x - MD.x, L.spawn.z - MD.z) < MD.r + 2;
      addF(onHill ? { t: 1, x: L.spawn.x, z: L.spawn.z, r: 2.5, vegT: 3, vegS: 1.2 } : { t: 1, x: L.spawn.x, z: L.spawn.z, r: 2.5, flat: [0.5, 2], vegT: 3, vegS: 1.2 });
    }
    // 정선 만장대: paved plateau (stone surface, no grass / trees), view wedge below the deck (no trees)
    if (MD) {
      addF({ t: 1, x: MD.x, z: MD.z, r: MD.r - 0.1, vegT: 3.2, vegS: 0.4, grass: 0.4, surf: S_STONE, prio: 4, tint: COL.stone, tintPad: 0.6, tintStr: 0.75, reach: 2 });
      const v = MD.view;
      if (v && [v.x, v.z, v.hw, v.hd].every(Number.isFinite)) addF({ t: 2, x: v.x, z: v.z, hw: v.hw, hd: v.hd, rot: 0, vegT: 1.5 });
    }
    // ponds: tree/shrub clearance (carving is analytic, see pondCarve)
    for (const p of L.ponds || []) addF({ t: 1, x: p.x, z: p.z, r: p.r, flat: [3.2, 4], vegT: 2.6, vegS: 0.9, grass: 0.6 });
  }

  // ---------------------------------------------------------------- probe: all feature-derived fields at a point
  const P = { flat: 0, prot: 0, pathD: 1e9, dirtD: 1e9, roadD: 1e9, riverD: 1e9, surf: 0, prio: -1, grassBlock: false, tint: null, tintW: 0, inZone: false };
  function probe(x, z) {
    P.flat = 0; P.prot = 0; P.pathD = 1e9; P.dirtD = 1e9; P.roadD = 1e9; P.riverD = 1e9; P.surf = S_GRASS; P.prio = -1;
    P.grassBlock = false; P.tint = null; P.tintW = 0; P.inZone = false;
    const list = binAt(x, z);
    if (!list) return P;
    for (let i = 0; i < list.length; i++) {
      const f = list[i];
      let d;
      if (f.kind === K_RIVER) {
        d = segDist(x, z, f.ax, f.az, f.bx, f.bz);
        if (d < P.riverD) P.riverD = d;
      } else d = fdist(f, x, z);
      if (f.flatBlend && d < f.flatPad + f.flatBlend) { const w = 1 - smooth(f.flatPad, f.flatPad + f.flatBlend, d); if (w > P.flat) P.flat = w; }
      if (f.protBlend && d < f.protPad + f.protBlend) { const w = 1 - smooth(f.protPad, f.protPad + f.protBlend, d); if (w > P.prot) P.prot = w; }
      if (f.kind === K_PATH) { if (d < P.pathD) P.pathD = d; if (f.surf === S_DIRT && d < P.dirtD) P.dirtD = d; }
      else if (f.kind === K_ROAD) { if (d < P.roadD) P.roadD = d; }
      else if (f.kind === K_ZONE && d <= 0) P.inZone = true;
      if (f.surf && d <= 0 && f.prio > P.prio) { P.surf = f.surf; P.prio = f.prio; }
      if (f.grass != null && d <= f.grass) P.grassBlock = true;
      if (f.tint && d < f.tintPad) { const w = f.tintStr * (1 - smooth(0, f.tintPad, d)); if (w > P.tintW) { P.tintW = w; P.tint = f.tint; } }
    }
    return P;
  }

  /** reduced probe for the 0.5 m surface/grass grid (fills P.surf/prio, grassBlock, pathD, roadD, riverD) */
  function probeLite(x, z) {
    P.pathD = 1e9; P.roadD = 1e9; P.riverD = 1e9; P.surf = S_GRASS; P.prio = -1; P.grassBlock = false;
    const i = Math.floor((x - B0) / BIN), j = Math.floor((z - B0) / BIN);
    const list = (i < 0 || j < 0 || i >= BN || j >= BN) ? null : binsLite[j * BN + i];
    if (!list) return P;
    for (let k = 0; k < list.length; k++) {
      const f = list[k];
      if (f.kind === K_RIVER) { const d = segDist(x, z, f.ax, f.az, f.bx, f.bz); if (d < P.riverD) P.riverD = d; continue; }
      const d = fdist(f, x, z);
      if (f.kind === K_PATH) { if (d < P.pathD) P.pathD = d; }
      else if (f.kind === K_ROAD) { if (d < P.roadD) P.roadD = d; }
      if (f.surf && d <= 0 && f.prio > P.prio) { P.surf = f.surf; P.prio = f.prio; }
      if (f.grass != null && d <= f.grass) P.grassBlock = true;
    }
    return P;
  }

  // ---------------------------------------------------------------- valley shape
  const CAMPUS = { cx: 4, cz: 0, ex: 108, ez: 121, r: 50 };
  function sdCampus(x, z) {
    const qx = Math.abs(x - CAMPUS.cx) - (CAMPUS.ex - CAMPUS.r), qz = Math.abs(z - CAMPUS.cz) - (CAMPUS.ez - CAMPUS.r);
    const ox = qx > 0 ? qx : 0, oz = qz > 0 ? qz : 0;
    return Math.sqrt(ox * ox + oz * oz) + Math.min(Math.max(qx, qz), 0) - CAMPUS.r;
  }
  /** distance (m) outside the flat valley floor (negative inside) */
  function floorDist(x, z) {
    const warp = N2(x / 95 + 3.1, z / 95 - 1.7) * 12 + N2(x / 33, z / 33) * 3.5;
    let d = sdCampus(x, z) + warp;
    const dr = polyDist(lines.riverCoarse, x, z) - (RIVER_HW + 15) + warp * 0.5;
    if (dr < d) d = dr;
    for (const r of lines.roadsCoarse) { const dd = polyDist(r.pts, x, z) - (r.hw + 9); if (dd < d) d = dd; }
    if (z > 90) {
      const cx = 30 + (z - 90) * 0.12, hw = 55 + (z - 90) * 0.08;
      const ds = Math.abs(x - cx) - hw + warp * 0.8;
      if (ds < d) d = ds;
    }
    return d;
  }
  /** mountain height for a point `d` metres beyond the valley floor */
  function mountainHeight(x, z, d) {
    if (d <= 0) return 0;
    const dx = x - 5, dz = z + 5;
    const rr = Math.sqrt(dx * dx + dz * dz) + 1e-6;
    const ca = -dz / rr, sa = dx / rr;           // cos/sin of the bearing (0 = north, +90° = east)
    const c2 = ca * ca - sa * sa;                 // cos(2θ)
    let H = 88 + 34 * ca + 12 * sa - 8 * c2;      // north tall, east steep, south low
    const pk = N2(x / 230 + 11.3, z / 230 - 4.1);
    H *= 0.82 + 0.5 * pk;
    if (H < 26) H = 26;
    let W = (70 + H * 0.62) * (1 - 0.28 * Math.max(sa, 0) * Math.max(0, 1 - Math.abs(ca)));
    const t = d < W ? d / W : 1;
    let h = H * t * t * (3 - 2 * t);
    if (d > W) h += Math.min(d - W, 320) * (0.2 + 0.12 * N2(x / 300 - 2, z / 300 + 5));
    // radial spurs & gullies (seamless: angle fed through the unit circle)
    const k = Math.min(1, d / (0.45 * W));
    const ridgeA = 1 - Math.abs(N3(ca * 4.4, sa * 4.4, rr / 150));
    const ridgeB = 1 - Math.abs(N3(ca * 10.5 + 3, sa * 10.5 - 2, rr / 70 + 9));
    h += (ridgeA * 0.62 + ridgeB * 0.38 - 0.56) * H * 0.46 * k;
    h += N2(x / 58, z / 58) * 7 * t + N2(x / 19, z / 19) * 2.2 * k;
    return h;
  }
  function riverProfile(dr) {
    const a = RIVER_HW - 4.5, b = RIVER_HW + 1, c = RIVER_HW + 8;
    if (dr <= a) return BED_Y;
    if (dr <= b) return BED_Y + (-0.85 - BED_Y) * smooth(a, b, dr);
    if (dr <= c) return -0.85 + 0.85 * smooth(b, c, dr);
    return (dr - c) * 0.35;
  }
  function pondProfile(d, p) {
    const bed = p.bed ?? (p.r > 7 ? -2.5 : -2.3);
    const a = p.r * 0.5, b = p.r + 0.8, c = p.r + 3.4;
    if (d <= a) return bed;
    if (d <= b) return bed + (-0.88 - bed) * smooth(a, b, d);
    if (d <= c) return -0.88 + 0.88 * smooth(b, c, d);
    return (d - c) * 0.35;
  }
  /** waterfall rock mound (hall garden): returns additive height (0 elsewhere) */
  const falls = [];
  function prepareFalls() {
    for (const p of L.ponds || []) {
      if (!p.waterfall) continue;
      const w = p.waterfall;
      let fx = p.x - w.x, fz = p.z - w.z; const l = Math.hypot(fx, fz) || 1; fx /= l; fz /= l;
      // which lateral side faces the closest zone centre (that side is kept narrow)
      let zoneSide = 1, best = 1e9;
      for (const zn of G.data.zones || []) {
        const dx = zn.center[0] - w.x, dz = zn.center[1] - w.z, d = Math.hypot(dx, dz) - zn.r;
        if (d < best) { best = d; zoneSide = (dx * -fz + dz * fx) >= 0 ? 1 : -1; }
      }
      falls.push({ pond: p, x: w.x, z: w.z, h: w.h ?? 3.2, fx, fz, sx: -fz, sz: fx, zoneSide });
    }
  }
  function fallMound(x, z) {
    let best = -1e9;
    for (const f of falls) {
      const dx = x - f.x, dz = z - f.z;
      const lf = dx * f.fx + dz * f.fz, ls = dx * f.sx + dz * f.sz;
      if (lf > 2.5 || lf < -9 || Math.abs(ls) > 8) continue;
      const top = f.h + 0.25;
      const lc = lf + 0.85;                         // cliff face recessed behind the lip so the falling sheet stays clear
      const fb = lc > 0 ? 1 - smooth(-0.1, 1.2, lc) : 1 - smooth(2.0, 7.0, -lc);
      // lateral extent: keep clear of nearby zone circles (side facing the nearest zone stays narrow)
      const lsN = ls * f.zoneSide;
      const fs = lsN > 0 ? 1 - smooth(1.3, 2.9, lsN + N2(x * 0.7, z * 0.7) * 0.3) : 1 - smooth(2.4, 6.6, -lsN + N2(x * 0.7, z * 0.7) * 0.6);
      let h = top * fb * fs + N2(x * 0.9 + 5, z * 0.9) * 0.25 * fs;
      // upper pool hollow on the plateau behind the lip
      const ux = dx + f.fx * 1.9, uz = dz + f.fz * 1.9;
      h -= 0.5 * (1 - smooth(0.3, 1.15, Math.sqrt(ux * ux + uz * uz)));
      if (h > best) best = h;
    }
    return best;
  }

  /** full analytic height at a point (used to bake the grids) */
  const raw = { m: 0, flat: 0 };
  function computeHeight(x, z) {
    const d = floorDist(x, z);
    const m = mountainHeight(x, z, d);
    const out = Math.max(Math.abs(x) - BOX.maxX, Math.abs(z) - BOX.maxZ, 0);
    const A = 0.42 + Math.min(out / 60, 1) * 2.1;
    let h = m + (N2(x / 41, z / 41) * 0.78 + N2(x / 13 + 5, z / 13) * 0.22) * A;
    if (h < -0.45) h = -0.45;
    probe(x, z);
    h *= 1 - P.flat;
    raw.m = m; raw.flat = P.flat;
    // 정선 만장대: hill (kept away from roads / river / buildings by the same flattening weights),
    // switchback bench carved at a constant grade, exactly flat plateau
    if (MD && x > MD.bx0 - 60 && x < MD.bx1 + 80 && z > MD.bz0 - 40 && z < MD.bz1 + 140) {
      const hill = mdHill(x, z) * (1 - P.flat);
      if (hill > 0) {
        h += hill;
        const mv = hill * (1 - mdView(x, z));
        if (mv > raw.m) raw.m = mv;
      }
      if (x > MD.bx0 && x < MD.bx1 && z > MD.bz0 && z < MD.bz1) {
        const nn = mdNearest(x, z);
        const w = 1 - smooth(MD.hw + 0.6, MD.hw + 3.4, nn.d);
        if (w > 0) h += (mdPathY(nn.s) - h) * w;
      }
      const pr = Math.hypot(x - MD.x, z - MD.z);
      // uphill side (the ridge climbs on behind the deck): a cut bank that starts at the balustrade, so the
      // railing never sinks into the slope; faded out before the ridge so the cap never leaves a seam
      if (pr < MD.r + 20) {
        const cap = MD.top + Math.max(0, pr - MD.r - 0.25) * 0.85;
        if (h > cap) h += (cap - h) * (1 - smooth(MD.r + 12, MD.r + 20, pr));
      }
      if (pr < MD.r + 0.3) h += (MD.top - h) * (1 - smooth(MD.r - 0.6, MD.r + 0.3, pr));
    }
    // river channel
    if (P.riverD < RIVER_HW + 12) {
      const dr = P.riverD + N2(x / 37, z / 37) * 1.3;
      const ch = riverProfile(dr) + (dr < RIVER_HW - 3 ? N2(x / 3.1, z / 3.1) * 0.22 : 0);
      if (ch < h) h += (ch - h) * (1 - P.prot);
    }
    // ponds
    for (const p of L.ponds || []) {
      const dx = x - p.x, dz = z - p.z;
      const dd = Math.sqrt(dx * dx + dz * dz);
      if (dd > p.r + 8) continue;
      const pr = pondProfile(dd + N2(x / 6, z / 6) * 0.45, p);
      if (pr < h) h += (pr - h) * (1 - P.prot);
    }
    // waterfall mound
    if (falls.length) {
      const fm = fallMound(x, z);
      if (fm > h) h += (fm - h) * (1 - P.prot);
    }
    return h;
  }

  // ---------------------------------------------------------------- height grids
  function makeGrid(half, step) {
    const n = Math.round((half * 2) / step) + 1;
    return { x0: -half, half, step, inv: 1 / step, n, h: new Float32Array(n * n), m: new Float32Array(n * n) };
  }
  let core = null, outer = null;
  function gridSample(g, x, z) {
    const max = g.n - 1;
    let fx = (x - g.x0) * g.inv, fz = (z - g.x0) * g.inv;
    if (fx < 0) fx = 0; else if (fx > max) fx = max;
    if (fz < 0) fz = 0; else if (fz > max) fz = max;
    let i = fx | 0, j = fz | 0;
    if (i >= max) i = max - 1;
    if (j >= max) j = max - 1;
    const tx = fx - i, tz = fz - j, r = j * g.n + i, H = g.h;
    const h00 = H[r], h10 = H[r + 1], h01 = H[r + g.n], h11 = H[r + g.n + 1];
    // must match the index layout of buildGridGeometry: triangles (00,01,11) and (00,11,10)
    return tz >= tx ? h00 + (h11 - h01) * tx + (h01 - h00) * tz : h00 + (h10 - h00) * tx + (h11 - h10) * tz;
  }
  function gridField(g, arr, x, z) { // bilinear on auxiliary fields
    const max = g.n - 1;
    const fx = clamp((x - g.x0) * g.inv, 0, max - 1e-4), fz = clamp((z - g.x0) * g.inv, 0, max - 1e-4);
    const i = fx | 0, j = fz | 0, tx = fx - i, tz = fz - j, r = j * g.n + i;
    return (arr[r] * (1 - tx) + arr[r + 1] * tx) * (1 - tz) + (arr[r + g.n] * (1 - tx) + arr[r + g.n + 1] * tx) * tz;
  }
  function heightAt(x, z) {
    if (!core) return 0;
    if (x >= -CORE && x <= CORE && z >= -CORE && z <= CORE) return gridSample(core, x, z);
    return gridSample(outer, x, z);
  }
  function fillGrid(g) {
    const n = g.n;
    for (let j = 0; j < n; j++) {
      const z = g.x0 + j * g.step;
      for (let i = 0; i < n; i++) {
        const x = g.x0 + i * g.step;
        const k = j * n + i;
        g.h[k] = computeHeight(x, z);
        g.m[k] = raw.m;
      }
    }
  }
  /** core boundary = linear interpolation of the outer grid -> watertight seam */
  function stitchCore() {
    const n = core.n;
    const fix = (i, j) => { const k = j * n + i; core.h[k] = gridSample(outer, core.x0 + i * core.step, core.x0 + j * core.step); };
    for (let i = 0; i < n; i++) { fix(i, 0); fix(i, n - 1); fix(0, i); fix(n - 1, i); }
  }

  // ---------------------------------------------------------------- ground colours
  const C = {};
  function initColors() {
    const c = (hex) => new THREE.Color(hex);
    Object.assign(C, {
      grassA: c('#6a9440'), grassB: c('#548538'), grassC: c('#457330'), grassDry: c('#8c9f50'),
      forest: c('#28401f'), forestB: c('#1f321a'), canopy: c('#1d3719'), canopyB: c('#284a22'), canopyC: c('#162c14'),
      rock: c('#6f6b62'), rockB: c('#55524b'), rockC: c('#857f74'),
      dirt: c('#957a55'), sand: c('#a89a7e'), pebble: c('#8a867b'), bed: c('#6a6452'), bedDeep: c('#45463b'),
    });
  }
  const _c = new THREE.Color(), _c2 = new THREE.Color();
  /** colour for a vertex with height h, normal y ny, mountain raw height m */
  function groundColor(x, z, h, ny, m, out) {
    const n1 = N2(x / 55, z / 55), n2 = N2(x / 14 + 11, z / 14 - 3), n3 = N2(x / 4.3, z / 4.3);
    out.copy(C.grassA).lerp(C.grassB, smooth(-0.35, 0.4, n1));
    out.lerp(C.grassC, smooth(0.05, 0.6, n2) * 0.55);
    out.lerp(C.grassDry, smooth(0.3, 0.7, N2(x / 30 - 7, z / 30 + 2)) * 0.45);
    // forested mountain floor / canopy mottling (far slopes read as dense forest)
    const mm = smooth(0.6, 10, m);
    if (mm > 0) {
      const cn = N2(x / 9, z / 9) * 0.55 + N2(x / 24 + 3, z / 24) * 0.45;
      _c.copy(C.canopy).lerp(C.canopyB, smooth(-0.25, 0.45, cn)).lerp(C.canopyC, smooth(0.1, 0.5, -n2) * 0.6);
      _c2.copy(C.forest).lerp(C.forestB, smooth(-0.3, 0.3, n1));
      _c.lerp(_c2, 1 - smooth(8, 40, m));
      out.lerp(_c, mm);
    }
    // exposed rock on steep slopes and crags
    const slope = 1 - ny;
    let rk = smooth(0.4, 0.62, slope + n2 * 0.12) * (0.35 + 0.65 * mm);
    if (m > 60) rk = Math.max(rk, smooth(0.55, 0.85, N2(x / 22, z / 22) + (m - 60) / 160) * 0.8);
    if (rk > 0) { _c.copy(C.rock).lerp(C.rockB, smooth(-0.4, 0.4, n2)).lerp(C.rockC, smooth(0.2, 0.7, n3) * 0.5); out.lerp(_c, rk); }
    // banks, river bed
    const pr = P.riverD;
    let shore = 1e9, pondShore = 1e9;
    if (pr < RIVER_HW + 12) shore = pr - RIVER_HW;
    for (const p of L.ponds || []) { const d = Math.hypot(x - p.x, z - p.z) - p.r; if (d < pondShore) pondShore = d; }
    if (h < WATER_Y + 0.15 && Math.min(shore, pondShore) < 6) {
      _c.copy(C.pebble).lerp(C.bed, smooth(WATER_Y + 0.1, WATER_Y - 0.7, h)).lerp(C.bedDeep, smooth(WATER_Y - 0.6, BED_Y, h));
      out.copy(_c);
      out.multiplyScalar(0.9 + n3 * 0.2);
    } else {
      if (shore < 8 && h < 0.6) {
        const sw = (1 - smooth(3.2, 7.5, shore + n3 * 1.4)) * (1 - P.prot * 0.7);
        _c.copy(C.sand).lerp(C.pebble, smooth(-0.2, 0.5, n2));
        out.lerp(_c, sw);
      }
      if (pondShore < 4 && h < 0.8) { // garden ponds: narrow pebble rim fading into moss
        const sw = (1 - smooth(0.6, 2.4, pondShore + n3 * 0.6)) * (1 - P.prot * 0.6);
        _c.copy(C.pebble).lerp(C.forest, smooth(0.2, 1.8, pondShore) * 0.6);
        out.lerp(_c, sw);
      }
    }
    // worn earth along paths and roads
    const pd = Math.min(P.dirtD, P.pathD + 0.4, P.roadD + 0.8);
    if (pd < 2.4) out.lerp(C.dirt, (1 - smooth(0, 2.2, pd + n3 * 0.5)) * (P.dirtD < 2.4 ? 0.62 : 0.4));
    if (P.tint && P.tintW > 0) out.lerp(P.tint, P.tintW);
    if (falls.length && h > 0.3) {
      const fm = fallMound(x, z);
      if (fm > 0.3) { _c.copy(C.rockB).lerp(C.forest, 0.35 + 0.4 * smooth(-0.2, 0.5, n3)).lerp(C.grassC, smooth(0.1, 0.6, n2) * 0.35); out.lerp(_c, smooth(0.3, 1.2, fm) * 0.92); }
    }
    out.multiplyScalar(0.94 + n3 * 0.09);
    return out;
  }

  // ---------------------------------------------------------------- procedural textures
  function tileNoise(size, cells, seed) {
    const r = G.util.rng(seed), g = new Float32Array(cells * cells);
    for (let i = 0; i < g.length; i++) g[i] = r();
    const out = new Float32Array(size * size);
    for (let y = 0; y < size; y++) {
      const fy = (y / size) * cells, j = Math.floor(fy), ty = fy - j, sy = ty * ty * (3 - 2 * ty);
      const j0 = j % cells, j1 = (j + 1) % cells;
      for (let x = 0; x < size; x++) {
        const fx = (x / size) * cells, i = Math.floor(fx), tx = fx - i, sx = tx * tx * (3 - 2 * tx);
        const i0 = i % cells, i1 = (i + 1) % cells;
        const a = g[j0 * cells + i0], b = g[j0 * cells + i1], c = g[j1 * cells + i0], d = g[j1 * cells + i1];
        out[y * size + x] = (a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy;
      }
    }
    return out;
  }
  function tileFbm(size, seed, octs) {
    const out = new Float32Array(size * size);
    let amp = 1, tot = 0;
    for (const cells of octs) {
      const n = tileNoise(size, cells, seed + cells * 31);
      for (let i = 0; i < out.length; i++) out[i] += n[i] * amp;
      tot += amp; amp *= 0.55;
    }
    for (let i = 0; i < out.length; i++) out[i] /= tot;
    return out;
  }
  function wrapDraw(ctx, w, h, x, y, pad, fn) {
    fn(x, y);
    if (x < pad) fn(x + w, y); if (x > w - pad) fn(x - w, y);
    if (y < pad) fn(x, y + h); if (y > h - pad) fn(x, y - h);
  }
  function grassDetailTexture() {
    const S = 512;
    return G.gfx.canvasTexture(S, S, (ctx) => {
      const img = ctx.createImageData(S, S), d = img.data;
      const n = tileFbm(S, 7, [4, 8, 16, 32, 64, 128]);
      for (let i = 0; i < S * S; i++) { const v = 196 + (n[i] - 0.5) * 70; d[i * 4] = v; d[i * 4 + 1] = v; d[i * 4 + 2] = v; d[i * 4 + 3] = 255; }
      ctx.putImageData(img, 0, 0);
      const r = G.util.rng(99);
      for (let i = 0; i < 5200; i++) {
        const x = r() * S, y = r() * S, len = 3 + r() * 8, a = r() * PI * 2, light = r() < 0.5;
        ctx.strokeStyle = light ? `rgba(255,255,255,${0.18 + r() * 0.25})` : `rgba(60,60,60,${0.12 + r() * 0.2})`;
        ctx.lineWidth = 0.8 + r() * 1.3;
        wrapDraw(ctx, S, S, x, y, 12, (px, py) => { ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px + Math.cos(a) * len, py + Math.sin(a) * len); ctx.stroke(); });
      }
    }, { srgb: false, anisotropy: 8 });
  }
  function dirtTexture() {
    const S = 512;
    return G.gfx.canvasTexture(S, S, (ctx) => {
      const img = ctx.createImageData(S, S), d = img.data;
      const n = tileFbm(S, 21, [4, 8, 16, 32, 64, 128]), m = tileFbm(S, 22, [3, 6, 12]);
      for (let i = 0; i < S * S; i++) {
        const v = (n[i] - 0.5) * 60, w = (m[i] - 0.5) * 40;
        d[i * 4] = clamp(184 + v + w, 0, 255); d[i * 4 + 1] = clamp(158 + v * 0.95 + w * 0.9, 0, 255); d[i * 4 + 2] = clamp(118 + v * 0.8 + w * 0.6, 0, 255); d[i * 4 + 3] = 255;
      }
      ctx.putImageData(img, 0, 0);
      const r = G.util.rng(5);
      for (let i = 0; i < 1500; i++) {
        const x = r() * S, y = r() * S, rad = 0.8 + r() * r() * 3.6, g = 105 + r() * 90;
        const col = r() < 0.5 ? `rgb(${g},${g * 0.96},${g * 0.9})` : `rgb(${g * 1.05},${g * 0.85},${g * 0.65})`;
        wrapDraw(ctx, S, S, x, y, 6, (px, py) => {
          ctx.fillStyle = 'rgba(40,30,20,.35)'; ctx.beginPath(); ctx.ellipse(px + 0.7, py + 0.9, rad, rad * 0.8, 0, 0, PI * 2); ctx.fill();
          ctx.fillStyle = col; ctx.beginPath(); ctx.ellipse(px, py, rad, rad * 0.8, 0, 0, PI * 2); ctx.fill();
        });
      }
    }, { anisotropy: 8 });
  }
  function stoneTexture() {
    const S = 512, CELLS = 7;
    return G.gfx.canvasTexture(S, S, (ctx) => {
      const r = G.util.rng(77);
      const pts = [], cols = [];
      const pal = [[176, 170, 158], [190, 182, 166], [160, 154, 143], [198, 190, 172], [150, 146, 138], [182, 172, 152]];
      for (let j = 0; j < CELLS; j++) for (let i = 0; i < CELLS; i++) {
        pts.push([(i + 0.15 + r() * 0.7) / CELLS * S, (j + 0.15 + r() * 0.7) / CELLS * S]);
        const p = pal[Math.floor(r() * pal.length)], k = 0.9 + r() * 0.2;
        cols.push([p[0] * k, p[1] * k, p[2] * k]);
      }
      const n = tileFbm(S, 31, [16, 32, 64, 128]);
      const img = ctx.createImageData(S, S), d = img.data, cs = S / CELLS;
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        const ci = Math.floor(x / cs), cj = Math.floor(y / cs);
        let f1 = 1e9, f2 = 1e9, id = 0;
        for (let oj = -1; oj <= 1; oj++) for (let oi = -1; oi <= 1; oi++) {
          let ii = ci + oi, jj = cj + oj, ox = 0, oy = 0;
          if (ii < 0) { ii += CELLS; ox = -S; } else if (ii >= CELLS) { ii -= CELLS; ox = S; }
          if (jj < 0) { jj += CELLS; oy = -S; } else if (jj >= CELLS) { jj -= CELLS; oy = S; }
          const p = pts[jj * CELLS + ii], dx = p[0] + ox - x, dy = p[1] + oy - y, dd = dx * dx + dy * dy;
          if (dd < f1) { f2 = f1; f1 = dd; id = jj * CELLS + ii; } else if (dd < f2) f2 = dd;
        }
        const edge = Math.sqrt(f2) - Math.sqrt(f1);
        const k = (y * S + x) * 4, nv = (n[y * S + x] - 0.5) * 46;
        if (edge < 3.2) { const g = 92 + nv * 0.6; d[k] = g; d[k + 1] = g * 0.98; d[k + 2] = g * 0.9; }
        else {
          const c = cols[id], bev = edge < 9 ? (edge - 9) * 2.6 : 0;
          d[k] = clamp(c[0] + nv + bev, 0, 255); d[k + 1] = clamp(c[1] + nv + bev, 0, 255); d[k + 2] = clamp(c[2] + nv * 0.9 + bev, 0, 255);
        }
        d[k + 3] = 255;
      }
      ctx.putImageData(img, 0, 0);
    }, { anisotropy: 8 });
  }
  function asphaltTexture() {
    const W = 256, H = 1024;
    return G.gfx.canvasTexture(W, H, (ctx) => {
      const img = ctx.createImageData(W, H), d = img.data, r = G.util.rng(13);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const k = (y * W + x) * 4;
        const u = x / W;
        const wear = Math.exp(-Math.pow((u - 0.27) / 0.06, 2)) + Math.exp(-Math.pow((u - 0.73) / 0.06, 2));
        const v = 82 + (r() - 0.5) * 26 + wear * 9 + (r() < 0.02 ? 30 : 0);
        d[k] = v; d[k + 1] = v * 1.01; d[k + 2] = v * 1.04; d[k + 3] = 255;
      }
      ctx.putImageData(img, 0, 0);
      const paint = (u0, u1, color) => {
        ctx.fillStyle = color; ctx.fillRect(u0 * W, 0, (u1 - u0) * W, H);
        ctx.fillStyle = 'rgba(80,80,80,.18)';
        for (let i = 0; i < 260; i++) ctx.fillRect(u0 * W + r() * (u1 - u0) * W, r() * H, 1 + r() * 2, 1 + r() * 3);
      };
      paint(0.045, 0.072, '#e8e6df'); paint(0.928, 0.955, '#e8e6df');
      paint(0.475, 0.492, '#e7b52f'); paint(0.508, 0.525, '#e7b52f');
      // a few patches / cracks
      for (let i = 0; i < 18; i++) {
        ctx.strokeStyle = 'rgba(40,40,40,.35)'; ctx.lineWidth = 1;
        let x = r() * W, y = r() * H; ctx.beginPath(); ctx.moveTo(x, y);
        for (let s = 0; s < 6; s++) { x += (r() - 0.5) * 16; y += r() * 12; ctx.lineTo(x, y); }
        ctx.stroke();
      }
    }, { repeat: null, anisotropy: 8 });
  }
  function woodTexture() {
    const S = 256;
    return G.gfx.canvasTexture(S, S, (ctx) => {
      const r = G.util.rng(41), boards = 8, bh = S / boards;
      for (let b = 0; b < boards; b++) {
        const base = [128 + r() * 26, 92 + r() * 18, 60 + r() * 12];
        for (let y = 0; y < bh; y++) {
          for (let x = 0; x < S; x += 2) {
            const g = Math.sin(x * 0.045 + y * 0.9 + b * 3 + Math.sin(x * 0.013 + b) * 4) * 10 + (r() - 0.5) * 8;
            ctx.fillStyle = `rgb(${clamp(base[0] + g, 0, 255) | 0},${clamp(base[1] + g * 0.8, 0, 255) | 0},${clamp(base[2] + g * 0.6, 0, 255) | 0})`;
            ctx.fillRect(x, b * bh + y, 2, 1);
          }
        }
        ctx.fillStyle = 'rgba(30,18,10,.85)'; ctx.fillRect(0, b * bh, S, 2);
        ctx.fillStyle = 'rgba(255,230,190,.12)'; ctx.fillRect(0, b * bh + 2, S, 2);
        // nail heads
        ctx.fillStyle = 'rgba(40,36,32,.8)';
        for (const nx of [10, S - 14]) { ctx.fillRect(nx, b * bh + bh * 0.3, 3, 3); ctx.fillRect(nx, b * bh + bh * 0.65, 3, 3); }
      }
    }, { anisotropy: 8 });
  }

  // ---------------------------------------------------------------- shader snippets
  const GLSL_NOISE = `
float tfHash(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float tfNoise(vec2 p){ vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(tfHash(i), tfHash(i + vec2(1.0, 0.0)), u.x), mix(tfHash(i + vec2(0.0, 1.0)), tfHash(i + vec2(1.0, 1.0)), u.x), u.y); }
`;
  const GLSL_TERRAIN = `
uniform sampler2D tTerrCore;
uniform sampler2D tTerrOuter;
uniform vec4 uTerrBox;   // coreMin, coreSize, outerMin, outerSize
uniform vec2 uTerrN;     // core grid n, outer grid n
float terrainH(vec2 p) {
  vec2 uc = (p - uTerrBox.x) / uTerrBox.y;
  if (uc.x >= 0.0 && uc.y >= 0.0 && uc.x <= 1.0 && uc.y <= 1.0) {
    return texture2D(tTerrCore, (uc * (uTerrN.x - 1.0) + 0.5) / uTerrN.x).r;
  }
  vec2 uo = clamp((p - uTerrBox.z) / uTerrBox.w, 0.0, 1.0);
  return texture2D(tTerrOuter, (uo * (uTerrN.y - 1.0) + 0.5) / uTerrN.y).r;
}
`;

  /** path material: world/along UV texture with ragged, rounded edges (discard) */
  function ribbonMaterial(map, { units = 2, rough = 0.95, rag = 0.32, color = 0xffffff, edgeDark = 0 } = {}) {
    const m = new THREE.MeshLambertMaterial({ map, color, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -units });
    m.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec2 aEdge;\nvarying vec2 vEdge;\nvarying vec2 vWXZ;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvEdge = aEdge;\nvWXZ = (modelMatrix * vec4(position, 1.0)).xz;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vEdge;\nvarying vec2 vWXZ;\n' + GLSL_NOISE)
        .replace('#include <alphatest_fragment>', `
          float tfRag = tfNoise(vWXZ * 1.6) * 0.62 + tfNoise(vWXZ * 5.1 + 7.0) * 0.38;
          float tfEd = length(vec2(vEdge.x, 1.0 - clamp(vEdge.y, 0.0, 1.0)));
          if (tfEd + (tfRag - 0.5) * ${rag.toFixed(3)} > 1.0) discard;
          diffuseColor.rgb *= 1.0 - smoothstep(0.82, 1.0, tfEd) * ${edgeDark.toFixed(3)};
        `);
    };
    m.customProgramCacheKey = () => `tf-ribbon-${rag}-${edgeDark}`;
    return m;
  }

  // ---------------------------------------------------------------- ribbon geometry (roads / paths)
  /**
   * pts: dense centre line. opts: {across, y, uv:'world'|'along', uvScale, alongScale, extend, clip(x,z)->bool}
   */
  function ribbonGeometry(pts, hw, opts = {}) {
    const across = opts.across || 2, yOff = opts.y ?? 0.03, ext = opts.extend ?? 0;
    pts = pts.slice();
    if (ext > 0 && pts.length >= 2) {
      const e0 = pts[0], e1 = pts[1], z0 = pts[pts.length - 1], z1 = pts[pts.length - 2];
      let dx = e0[0] - e1[0], dz = e0[1] - e1[1], l = Math.hypot(dx, dz) || 1;
      pts.unshift([e0[0] + dx / l * ext, e0[1] + dz / l * ext]);
      dx = z0[0] - z1[0]; dz = z0[1] - z1[1]; l = Math.hypot(dx, dz) || 1;
      pts.push([z0[0] + dx / l * ext, z0[1] + dz / l * ext]);
    }
    const n = pts.length;
    if (n < 2) return null;
    const cum = [0];
    for (let i = 1; i < n; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    const total = cum[n - 1];
    const cols = across + 1;
    const pos = new Float32Array(n * cols * 3), uv = new Float32Array(n * cols * 2), edge = new Float32Array(n * cols * 2);
    for (let i = 0; i < n; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
      let tx = b[0] - a[0], tz = b[1] - a[1]; const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
      let nx = -tz, nz = tx;
      // miter scale for corners
      let miter = 1;
      if (i > 0 && i < n - 1) {
        const sx = pts[i + 1][0] - pts[i][0], sz = pts[i + 1][1] - pts[i][1], sl = Math.hypot(sx, sz) || 1;
        const dot = nx * (-sz / sl) + nz * (sx / sl);
        miter = 1 / Math.max(0.6, Math.abs(dot));
      }
      const endD = Math.min(cum[i], total - cum[i]);
      for (let k = 0; k < cols; k++) {
        const s = -1 + (2 * k) / across;
        const x = pts[i][0] + nx * s * hw * miter, z = pts[i][1] + nz * s * hw * miter;
        const v = (i * cols + k);
        pos[v * 3] = x; pos[v * 3 + 1] = heightAt(x, z) + yOff; pos[v * 3 + 2] = z;
        if (opts.uv === 'along') { uv[v * 2] = k / across; uv[v * 2 + 1] = cum[i] / (opts.alongScale || 8); }
        else { uv[v * 2] = x / (opts.uvScale || 4); uv[v * 2 + 1] = z / (opts.uvScale || 4); }
        edge[v * 2] = s; edge[v * 2 + 1] = ext > 0 ? endD / Math.max(0.5, hw) : 2;
      }
    }
    const idx = [];
    for (let i = 0; i < n - 1; i++) {
      if (opts.clip && opts.clip(pts[i][0], pts[i][1]) && opts.clip(pts[i + 1][0], pts[i + 1][1])) continue;
      for (let k = 0; k < across; k++) {
        const a = i * cols + k, b = a + 1, c = a + cols, d = c + 1;
        idx.push(a, b, c, b, d, c);
      }
    }
    if (!idx.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setAttribute('aEdge', new THREE.BufferAttribute(edge, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }
  function fixWinding(g) {
    // ensure ribbons face up (normal.y > 0); flip index order if needed
    const nrm = g.attributes.normal;
    let s = 0; for (let i = 0; i < nrm.count; i++) s += nrm.getY(i);
    if (s < 0) {
      const ix = g.index.array;
      for (let i = 0; i < ix.length; i += 3) { const t = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = t; }
      g.index.needsUpdate = true;
      g.computeVertexNormals();
    }
    return g;
  }
  function mergeOrNull(list) {
    const ok = list.filter(Boolean);
    if (!ok.length) return null;
    if (ok.length === 1) return ok[0];
    return ADDONS.BufferGeometryUtils?.mergeGeometries ? ADDONS.BufferGeometryUtils.mergeGeometries(ok, false) : ok[0];
  }

  // ---------------------------------------------------------------- the system
  const T = {
    name: 'terrain', order: 10, label: '지형',
    ready: false,
    SURF,
    waterY: WATER_Y, riverHalfWidth: RIVER_HW, bedY: BED_Y, coreHalf: CORE, half: HALF,
    riverLine: lines.river, roadLines: lines.roads, pathLines: lines.paths,
    meshes: {}, uniforms: null,
    glslTerrain: GLSL_TERRAIN, glslNoise: GLSL_NOISE,
    noise2: N2, noise3: N3, fbm2,
    _fieldsReady: false,
    _classGrid: null, _grassMask: null,
    /** 정선 만장대 geometry (null until ensureFields, or without layout.manjangdae) */
    get manjangdae() {
      if (!MD) return null;
      return {
        x: MD.x, z: MD.z, r: MD.r, top: MD.top, hw: MD.hw, pts: MD.pts, s: MD.s, y: MD.y, len: MD.len,
        pathY: (s) => mdPathY(s),
        nearest: (x, z) => { const n = mdNearest(x, z); return { i: n.i, s: n.s, d: n.d, x: n.x, z: n.z }; },
        hill: (x, z) => mdHill(x, z),
      };
    },

    /** compute all fields & height grids (pure JS; safe to call from other modules) */
    ensureFields() {
      if (this._fieldsReady) return true;
      if (this._fieldsFailed) return false;   // never rebuild half-registered features
      try { return this._computeFields(); } catch (e) { this._fieldsFailed = true; throw e; }
    },
    _computeFields() {
      const t0 = performance.now();
      prepareManjangdae();
      prepareLines();
      this.riverLine = lines.river; this.roadLines = lines.roads; this.pathLines = lines.paths;
      buildFeatures();
      prepareFalls();
      initColors();
      const low = (G.sys.engine?.quality || 'high') === 'low';
      outer = makeGrid(HALF, low ? 10 : 5);
      core = makeGrid(CORE, low ? 2.5 : 1.25);
      fillGrid(outer);
      fillGrid(core);
      stitchCore();
      this.core = core; this.outer = outer;
      this._buildClassGrid();
      this._fieldsReady = true;
      this.fieldsMs = Math.round(performance.now() - t0);
      G.log.info('WORLD', `terrain fields ${this.fieldsMs}ms (core ${core.n}², outer ${outer.n}²)`);
      return true;
    },

    heightAt(x, z) { return heightAt(x, z); },
    riverDistance(x, z) {
      const list = binAt(x, z);
      let best = 1e9;
      if (list) for (const f of list) if (f.kind === K_RIVER) { const d = segDist(x, z, f.ax, f.az, f.bx, f.bz); if (d < best) best = d; }
      return best < 1e8 ? best : polyDist(lines.river, x, z);
    },
    pondInfo(x, z) {
      let best = null, bd = 1e9;
      for (const p of L.ponds || []) { const d = Math.hypot(x - p.x, z - p.z) - p.r; if (d < bd) { bd = d; best = p; } }
      return { pond: best, d: bd };
    },
    isWater(x, z) { return heightAt(x, z) < WATER_Y - 0.32; },
    surfaceAt(x, z) {
      const g = this._classGrid;
      if (g) {
        const i = Math.floor((x + CORE) * 2), j = Math.floor((z + CORE) * 2);
        if (i >= 0 && j >= 0 && i < 640 && j < 640) return SURF[g[j * 640 + i]];
      }
      return SURF[this._classify(x, z)];
    },
    _classify(x, z) {
      probe(x, z);
      const h = heightAt(x, z);
      if (P.prio >= 0) return P.surf;
      if (h < WATER_Y) return S_WATER;
      if (P.riverD < RIVER_HW + 6.2) return S_SAND;
      for (const p of L.ponds || []) if (Math.hypot(x - p.x, z - p.z) < p.r + 0.9) return S_SAND;
      return S_GRASS;
    },
    flatWeight(x, z) { probe(x, z); return P.flat; },
    mountainMask(x, z) {
      if (!core) return 0;
      const g = (Math.abs(x) <= CORE && Math.abs(z) <= CORE) ? core : outer;
      return smooth(0.6, 10, gridField(g, g.m, x, z));
    },
    /** raw mountain height (before flattening) — useful for forest density */
    mountainHeight(x, z) {
      if (!core) return 0;
      const g = (Math.abs(x) <= CORE && Math.abs(z) <= CORE) ? core : outer;
      return gridField(g, g.m, x, z);
    },
    /** true where vegetation must not be placed. kind: 'tree' (trees, big rocks) | 'shrub' (bushes, flowers) */
    vegBlocked(x, z, r = 0, kind = 'tree') {
      const tree = kind === 'tree';
      const list = binAt(x, z);
      if (list) for (let i = 0; i < list.length; i++) {
        const f = list[i];
        const pad = tree ? f.vegT : f.vegS;
        if (pad == null) continue;
        const d = f.kind === K_RIVER ? segDist(x, z, f.ax, f.az, f.bx, f.bz) : fdist(f, x, z);
        if (d < pad + r) return true;
      }
      for (const p of L.ponds || []) if (Math.hypot(x - p.x, z - p.z) < p.r + (tree ? 2.4 : 0.8) + r) return true;
      return false;
    },
    /** distance to the nearest road/path edge (m, 0 on it) */
    pathDistance(x, z) { probe(x, z); return Math.min(P.pathD, P.roadD); },
    inZone(x, z) { probe(x, z); return P.inZone; },
    colorAt(x, z, target) {
      const out = target || new THREE.Color();
      if (!this._colors) return out.set(0x5e8f3a);
      const g = (Math.abs(x) <= CORE && Math.abs(z) <= CORE) ? core : outer;
      const arr = g === core ? this._colors.core : this._colors.outer;
      const max = g.n - 1;
      const i = clamp(Math.round((x - g.x0) * g.inv), 0, max), j = clamp(Math.round((z - g.x0) * g.inv), 0, max);
      const k = (j * g.n + i) * 3;
      return out.setRGB(arr[k], arr[k + 1], arr[k + 2]);
    },

    _buildClassGrid() {
      const N = 640;
      const cls = new Uint8Array(N * N), grass = new Uint8Array(N * N);
      for (let j = 0; j < N; j++) {
        const z = -CORE + (j + 0.5) * 0.5;
        for (let i = 0; i < N; i++) {
          const x = -CORE + (i + 0.5) * 0.5;
          const k = j * N + i;
          probeLite(x, z);
          const h = heightAt(x, z);
          let s;
          if (P.prio >= 0) s = P.surf;
          else if (h < WATER_Y) s = S_WATER;
          else if (P.riverD < RIVER_HW + 6.2) s = S_SAND;
          else {
            s = S_GRASS;
            for (const p of L.ponds || []) { const dx = x - p.x, dz = z - p.z; if (dx * dx + dz * dz < (p.r + 0.9) * (p.r + 0.9)) { s = S_SAND; break; } }
          }
          cls[k] = s;
          let gv = 0;
          if (s === S_GRASS && !P.grassBlock && h > WATER_Y + 0.3) {
            const mn = N2(x / 9.5 + 40, z / 9.5) * 0.6 + N2(x / 3.2, z / 3.2 + 9) * 0.4;
            gv = 0.55 + 0.45 * smooth(-0.45, 0.35, mn);
            const mh = gridField(core, core.m, x, z);
            if (mh > 1) gv *= 1 - 0.55 * smooth(1, 10, mh);
            gv *= smooth(-0.15, 0.7, Math.min(P.pathD, P.roadD));
          }
          grass[k] = Math.round(clamp(gv, 0, 1) * 255);
        }
      }
      this._classGrid = cls; this._grassMask = grass;
    },

    async init() {
      const engine = G.sys.engine;
      const scene = engine?.scene;
      this.ensureFields();
      await G.util.nextFrame();
      // ------------------------------------------------ world functions
      G.world.setTerrain((x, z) => heightAt(x, z));
      G.world.setWaterFn((x, z) => heightAt(x, z) < WATER_Y - 0.32);
      G.world.setSurfaceFn((x, z) => this.surfaceAt(x, z));
      if (!scene) return;

      // ------------------------------------------------ terrain meshes
      this._colors = { core: null, outer: null };
      const detail = grassDetailTexture();
      detail.wrapS = detail.wrapT = THREE.RepeatWrapping;
      const mat = new THREE.MeshLambertMaterial({ vertexColors: true, map: detail });
      mat.onBeforeCompile = (sh) => {
        sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', `
          #ifdef USE_MAP
            vec3 tfA = texture2D(map, vMapUv).rgb;
            vec3 tfB = texture2D(map, vMapUv * 0.231 + vec2(0.37, 0.71)).rgb;
            diffuseColor.rgb *= mix(tfA, tfB, 0.45) * 1.27;
          #endif`);
      };
      mat.customProgramCacheKey = () => 'tf-terrain';
      this.material = mat;
      const coreGeo = this._buildGridGeometry(core, null);
      const outerGeo = this._buildGridGeometry(outer, core);
      const coreMesh = new THREE.Mesh(coreGeo, mat);
      const outerMesh = new THREE.Mesh(outerGeo, mat);
      for (const m of [coreMesh, outerMesh]) { m.receiveShadow = true; m.castShadow = false; m.matrixAutoUpdate = false; m.updateMatrix(); }
      coreMesh.name = 'terrain-core'; outerMesh.name = 'terrain-outer';
      this._installRaycast(coreMesh, true);
      this._installRaycast(outerMesh, false);
      scene.add(coreMesh, outerMesh);
      G.world.groundMeshes.push(coreMesh, outerMesh);
      this.meshes.core = coreMesh; this.meshes.outer = outerMesh;
      await G.util.nextFrame();

      // ------------------------------------------------ GPU data textures (grass / water effects)
      this._buildTextures();
      // ------------------------------------------------ backdrop mountain ring
      this._buildBackdrop(scene);
      // ------------------------------------------------ roads, curbs, paths
      try { this._buildRoads(scene); } catch (e) { G.log.error('WORLD', 'roads failed', e); }
      try { this._buildPaths(scene); } catch (e) { G.log.error('WORLD', 'paths failed', e); }
      // ------------------------------------------------ steep-slope boundary colliders
      this._buildSlopeColliders();
      this.ready = true;
      G.bus.emit('terrain:ready', { terrain: this });
    },

    _buildGridGeometry(g, hole) {
      const n = g.n, step = g.step;
      const pos = new Float32Array(n * n * 3), nor = new Float32Array(n * n * 3), col = new Float32Array(n * n * 3), uv = new Float32Array(n * n * 2);
      const isCore = !hole;
      const e = isCore ? step : g.step;
      const tmp = new THREE.Color();
      for (let j = 0; j < n; j++) {
        const z = g.x0 + j * step;
        for (let i = 0; i < n; i++) {
          const x = g.x0 + i * step, k = j * n + i;
          const h = g.h[k];
          pos[k * 3] = x; pos[k * 3 + 1] = h; pos[k * 3 + 2] = z;
          // normals from the exact surface; seam vertices use the outer spacing on both meshes
          const onSeam = isCore && (i === 0 || j === 0 || i === n - 1 || j === n - 1);
          const ee = onSeam ? outer.step : e;
          const hx0 = heightAt(x - ee, z), hx1 = heightAt(x + ee, z), hz0 = heightAt(x, z - ee), hz1 = heightAt(x, z + ee);
          let nx = (hx0 - hx1) / (2 * ee), nz = (hz0 - hz1) / (2 * ee), ny = 1;
          const il = 1 / Math.sqrt(nx * nx + 1 + nz * nz); nx *= il; ny *= il; nz *= il;
          nor[k * 3] = nx; nor[k * 3 + 1] = ny; nor[k * 3 + 2] = nz;
          probe(x, z);
          groundColor(x, z, h, ny, g.m[k], tmp);
          col[k * 3] = tmp.r; col[k * 3 + 1] = tmp.g; col[k * 3 + 2] = tmp.b;
          uv[k * 2] = x / 4.5; uv[k * 2 + 1] = z / 4.5;
        }
      }
      if (isCore) this._colors.core = col; else this._colors.outer = col;
      const idx = [];
      const hmin = hole ? -hole.half + 1e-3 : 0, hmax = hole ? hole.half - 1e-3 : 0;
      for (let j = 0; j < n - 1; j++) {
        for (let i = 0; i < n - 1; i++) {
          if (hole) {
            const x0 = g.x0 + i * step, x1 = x0 + step, z0 = g.x0 + j * step, z1 = z0 + step;
            if (x0 >= hmin - 1 && x1 <= hmax + 1 && z0 >= hmin - 1 && z1 <= hmax + 1) continue;
          }
          const v00 = j * n + i, v10 = v00 + 1, v01 = v00 + n, v11 = v01 + 1;
          idx.push(v00, v01, v11, v00, v11, v10);
        }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
      geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      geo.setIndex(new THREE.BufferAttribute(n * n > 65535 ? new Uint32Array(idx) : new Uint16Array(idx), 1));
      geo.computeBoundingSphere();
      geo.computeBoundingBox();
      return geo;
    },

    /** cheap exact raycast: ray-march the height function instead of testing 100k+ triangles */
    _installRaycast(mesh, isCore) {
      const p = new THREE.Vector3();
      mesh.raycast = (raycaster, intersects) => {
        const ray = raycaster.ray;
        const far = Math.min(raycaster.far, 1200);
        let t = Math.max(raycaster.near, 0), prevT = t, prevD = null;
        const inRegion = (x, z) => {
          const inCore = Math.abs(x) <= CORE && Math.abs(z) <= CORE;
          return isCore ? inCore : (!inCore && Math.abs(x) <= HALF && Math.abs(z) <= HALF);
        };
        for (let it = 0; it < 600 && t <= far; it++) {
          ray.at(t, p);
          const d = p.y - heightAt(p.x, p.z);
          if (d <= 0 && prevD !== null) {
            let a = prevT, b = t;
            for (let k = 0; k < 18; k++) { const m = (a + b) / 2; ray.at(m, p); if (p.y - heightAt(p.x, p.z) > 0) a = m; else b = m; }
            ray.at(b, p);
            if (!inRegion(p.x, p.z)) return;
            p.y = heightAt(p.x, p.z);
            const e = 0.6;
            const nrm = new THREE.Vector3(heightAt(p.x - e, p.z) - heightAt(p.x + e, p.z), 2 * e, heightAt(p.x, p.z - e) - heightAt(p.x, p.z + e)).normalize();
            intersects.push({ distance: b, point: p.clone(), object: mesh, face: { a: 0, b: 0, c: 0, normal: nrm, materialIndex: 0 }, faceIndex: -1, normal: nrm });
            return;
          }
          if (d <= 0 && prevD === null) return; // ray starts below ground
          prevD = d; prevT = t;
          t += clamp(d * 0.45, 0.25, 12);
        }
      };
    },

    _buildTextures() {
      const toHalf = THREE.DataUtils.toHalfFloat;
      const mk = (g) => {
        const data = new Uint16Array(g.n * g.n);
        for (let i = 0; i < data.length; i++) data[i] = toHalf(g.h[i]);
        const t = new THREE.DataTexture(data, g.n, g.n, THREE.RedFormat, THREE.HalfFloatType);
        t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearFilter; t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
        t.generateMipmaps = false; t.needsUpdate = true;
        return t;
      };
      const tCore = mk(core), tOuter = mk(outer);
      // ground colour (core) for tinting grass to the terrain
      const n = core.n, cdata = new Uint8Array(n * n * 4), cc = this._colors.core;
      for (let i = 0; i < n * n; i++) {
        cdata[i * 4] = clamp(Math.sqrt(cc[i * 3]) * 255, 0, 255); cdata[i * 4 + 1] = clamp(Math.sqrt(cc[i * 3 + 1]) * 255, 0, 255);
        cdata[i * 4 + 2] = clamp(Math.sqrt(cc[i * 3 + 2]) * 255, 0, 255); cdata[i * 4 + 3] = 255;
      }
      const tColor = new THREE.DataTexture(cdata, n, n, THREE.RGBAFormat, THREE.UnsignedByteType);
      tColor.magFilter = THREE.LinearFilter; tColor.minFilter = THREE.LinearFilter; tColor.generateMipmaps = false; tColor.needsUpdate = true;
      const tGrass = new THREE.DataTexture(this._grassMask, 640, 640, THREE.RedFormat, THREE.UnsignedByteType);
      tGrass.magFilter = THREE.LinearFilter; tGrass.minFilter = THREE.LinearFilter; tGrass.generateMipmaps = false; tGrass.needsUpdate = true;
      tGrass.unpackAlignment = 1;
      this.textures = { core: tCore, outer: tOuter, color: tColor, grass: tGrass };
      this.uniforms = {
        tTerrCore: { value: tCore },
        tTerrOuter: { value: tOuter },
        uTerrBox: { value: new THREE.Vector4(-CORE, CORE * 2, -HALF, HALF * 2) },
        uTerrN: { value: new THREE.Vector2(core.n, outer.n) },
        tTerrColor: { value: tColor },      // sqrt-encoded linear colour (square it in the shader)
        tGrassMask: { value: tGrass },      // 640x640 over the core square, 0..1 grass density
      };
    },

    _buildBackdrop(scene) {
      const layers = [
        { r: 700, base: 150, amp: 95, col: '#3c5c36', fog: 0.10, lowSouth: 0.45 },
        { r: 980, base: 210, amp: 130, col: '#4c6a5c', fog: 0.30, lowSouth: 0.75 },
        { r: 1320, base: 280, amp: 170, col: '#7891a3', fog: 0.52, lowSouth: 1.0 },
      ];
      const SEG = 192;
      const prof = [[-280, -18, 0], [-150, 0.32, 1], [-55, 0.84, 1], [0, 1, 1], [80, 0.78, 1], [230, 0.12, 1]];
      const positions = [], colors = [], layerAttr = [], index = [];
      let base = 0;
      layers.forEach((Ly, li) => {
        const col = new THREE.Color(Ly.col);
        for (let s = 0; s <= SEG; s++) {
          const a = (s / SEG) * PI * 2;
          const ca = Math.cos(a), sa = Math.sin(a);  // bearing a: x = sin, z = -cos (0 = north)
          let hN = 0.5 + 0.5 * N3(ca * 2.2 + li * 5, sa * 2.2, li * 3.3);
          const ridge = 1 - Math.abs(N3(ca * 6.5 + li, sa * 6.5, 7.7 + li));
          hN = hN * 0.65 + ridge * 0.35 + N3(ca * 17, sa * 17, li + 1.3) * 0.08;
          // keep the southern valley mouth (and the river gorge) open on the nearest layer
          const south = Math.max(0, -ca);              // 1 due south
          const gorge = Math.exp(-Math.pow((a - 0.25) / 0.12, 2));
          const open = 1 - (1 - Ly.lowSouth) * (Math.pow(south, 2) + gorge * 0.8);
          const H = (Ly.base + Ly.amp * hN) * Math.max(0.25, open);
          for (const [dr, hk, isRel] of prof) {
            const R = Ly.r + dr + N3(ca * 3, sa * 3, li * 9) * 40;
            const y = isRel ? H * hk : hk;
            positions.push(sa * R, y - 6, -ca * R);
            const shade = (0.8 + 0.2 * (isRel ? hk : 0)) * (0.86 + 0.28 * (0.5 + 0.5 * N3(ca * 24 + li, sa * 24, dr * 0.01 + li)));
            colors.push(col.r * shade, col.g * shade, col.b * shade);
            layerAttr.push(li / 2);
          }
        }
        const rows = prof.length;
        for (let s = 0; s < SEG; s++) for (let r = 0; r < rows - 1; r++) {
          const a = base + s * rows + r, b = a + 1, c = a + rows, d = c + 1;
          index.push(a, c, b, b, c, d);
        }
        base += (SEG + 1) * rows;
      });
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geo.setAttribute('aCol', new THREE.Float32BufferAttribute(colors, 3));
      geo.setAttribute('aLayer', new THREE.Float32BufferAttribute(layerAttr, 1));
      geo.setIndex(index);
      geo.computeVertexNormals();
      const mat = new THREE.ShaderMaterial({
        uniforms: {
          uFogColor: { value: new THREE.Color(0xbcd6e8) },
          uFogDensity: { value: 0.0028 },
          uLight: { value: 1 },
          uSunDir: { value: new THREE.Vector3(0.4, 0.8, 0.3) },
        },
        vertexShader: `
          attribute vec3 aCol; attribute float aLayer;
          varying vec3 vCol; varying float vLayer; varying vec3 vN; varying float vDist; varying float vY;
          void main() {
            vCol = aCol; vLayer = aLayer; vN = normalize(mat3(modelMatrix) * normal);
            vec4 wp = modelMatrix * vec4(position, 1.0);
            vDist = distance(wp.xyz, cameraPosition); vY = wp.y;
            gl_Position = projectionMatrix * viewMatrix * wp;
          }`,
        fragmentShader: `
          uniform vec3 uFogColor; uniform float uFogDensity; uniform float uLight; uniform vec3 uSunDir;
          varying vec3 vCol; varying float vLayer; varying vec3 vN; varying float vDist; varying float vY;
          void main() {
            vec3 n = normalize(vN);
            float sh = 0.58 + 0.42 * max(dot(n, normalize(uSunDir)), 0.0);
            vec3 c = vCol * sh * uLight;
            float f = 1.0 - exp(-pow(uFogDensity * vDist * 0.34, 2.0));
            f = clamp(max(f, 0.18 + vLayer * 0.42) + (1.0 - smoothstep(0.0, 90.0, vY)) * 0.18, 0.0, 0.97);
            gl_FragColor = vec4(mix(c, uFogColor, f), 1.0);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
          }`,
        fog: false,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.name = 'terrain-backdrop';
      mesh.frustumCulled = false;
      mesh.matrixAutoUpdate = false;
      mesh.renderOrder = -5;
      mesh.raycast = () => {};
      scene.add(mesh);
      this.meshes.backdrop = mesh;
      this._backdropMat = mat;
    },

    _buildRoads(scene) {
      const tex = asphaltTexture();
      tex.wrapS = THREE.ClampToEdgeWrapping; tex.wrapT = THREE.RepeatWrapping;
      const geos = { main: [], link: [] };
      for (const r of lines.roads) {
        const g = ribbonGeometry(r.pts, r.hw, { across: 4, y: 0.035, uv: 'along', alongScale: 12, extend: 0 });
        if (g) (r.id === 'ROAD_MAIN' ? geos.main : geos.link).push(fixWinding(g));
      }
      const mkMat = (units) => {
        const m = new THREE.MeshLambertMaterial({ map: tex, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -units });
        return m;
      };
      const group = new THREE.Group(); group.name = 'roads';
      const main = mergeOrNull(geos.main), link = mergeOrNull(geos.link);
      if (main) { const m = new THREE.Mesh(main, mkMat(6)); m.receiveShadow = true; group.add(m); }
      if (link) { const m = new THREE.Mesh(link, mkMat(4)); m.receiveShadow = true; group.add(m); }
      // curbs (skip near junctions & the parking entrance)
      const pk = L.parking;
      const skip = (x, z, road) => {
        if (pk && Math.abs(x - pk.x) < pk.w / 2 + 4 && Math.abs(z - pk.z) < pk.d / 2 + 6) return true;
        for (const o of lines.roads) {
          if (o === road) continue;
          if (polyDist([o.pts[0], o.pts[1]], x, z) < o.hw + 3 || polyDist([o.pts[o.pts.length - 2], o.pts[o.pts.length - 1]], x, z) < o.hw + 3) return true;
          if (polyDist(o.coarse, x, z) < o.hw + 1.5) return true;
        }
        for (const p of lines.paths) {
          const a = p.pts[0], b = p.pts[p.pts.length - 1];
          if (Math.hypot(a[0] - x, a[1] - z) < road.hw + p.hw + 2.5 || Math.hypot(b[0] - x, b[1] - z) < road.hw + p.hw + 2.5) return true;
        }
        return Math.abs(x) > HALF - 5 || Math.abs(z) > HALF - 5;
      };
      const curbGeos = [];
      for (const r of lines.roads) {
        for (const side of [-1, 1]) curbGeos.push(this._curbGeometry(r, side, skip));
      }
      const curb = mergeOrNull(curbGeos);
      if (curb) {
        const cm = new THREE.Mesh(curb, G.gfx.material('tf-curb', () => new THREE.MeshLambertMaterial({ color: 0xc9c4b8, vertexColors: true })));
        cm.receiveShadow = true; cm.castShadow = false;
        group.add(cm);
      }
      group.traverse((o) => { if (o.isMesh) { o.matrixAutoUpdate = false; o.updateMatrix(); o.raycast = () => {}; } });
      scene.add(group);
      this.meshes.roads = group;
    },

    _curbGeometry(road, side, skip) {
      const pts = road.pts, n = pts.length;
      const W = 0.26, Hh = 0.13;
      const pos = [], col = [], idx = [];
      let run = -1;
      for (let i = 0; i < n; i++) {
        const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
        let tx = b[0] - a[0], tz = b[1] - a[1]; const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
        const nx = -tz * side, nz = tx * side;
        const x0 = pts[i][0] + nx * road.hw, z0 = pts[i][1] + nz * road.hw;
        const x1 = x0 + nx * W, z1 = z0 + nz * W;
        const off = skip(pts[i][0], pts[i][1], road);
        if (off) { run = -1; continue; }
        const y0 = heightAt(x0, z0), y1 = heightAt(x1, z1);
        const base = pos.length / 3;
        // inner bottom, inner top, outer top, outer bottom
        pos.push(x0, y0 + 0.02, z0, x0, y0 + Hh, z0, x1, y1 + Hh, z1, x1, y1 - 0.04, z1);
        const shade = 0.88 + ((i * 7919) % 13) / 100;
        for (let k = 0; k < 4; k++) col.push(shade, shade, shade);
        if (run >= 0) {
          const p = run;
          for (let k = 0; k < 3; k++) {
            const a0 = p + k, a1 = p + k + 1, b0 = base + k, b1 = base + k + 1;
            if (side > 0) idx.push(a0, a1, b0, a1, b1, b0); else idx.push(a0, b0, a1, a1, b0, b1);
          }
        }
        run = base;
      }
      if (!idx.length) return null;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      g.setIndex(idx);
      g.computeVertexNormals();
      return g;
    },

    _buildPaths(scene) {
      const tex = { stone: stoneTexture(), dirt: dirtTexture(), wood: woodTexture() };
      for (const k in tex) { tex[k].wrapS = tex[k].wrapT = THREE.RepeatWrapping; }
      tex.wood.wrapS = THREE.ClampToEdgeWrapping;
      const plaza = L.plaza, hp = L.hallPlaza;
      const insidePaved = (x, z) => {
        if (plaza && Math.hypot(x - plaza.x, z - plaza.z) < plaza.r - 0.7) return true;
        if (hp && Math.abs(x - hp.x) < hp.w / 2 - 0.7 && Math.abs(z - hp.z) < hp.d / 2 - 0.7) return true;
        return false;
      };
      const by = { stone: [], dirt: [], wood: [] };
      for (const p of lines.paths) {
        const type = by[p.type] ? p.type : 'dirt';
        if (type === 'wood') {
          const g = ribbonGeometry(p.pts, p.hw, { across: 2, y: 0.07, uv: 'along', alongScale: 1.6, extend: 0 });
          if (g) by.wood.push(fixWinding(g));
          continue;
        }
        const g = ribbonGeometry(p.pts, p.hw, { across: type === 'stone' ? 4 : 3, y: type === 'stone' ? 0.04 : 0.03, uv: 'world', uvScale: type === 'stone' ? 5.5 : 6, extend: p.hw * 0.7, clip: insidePaved });
        if (g) by[type].push(fixWinding(g));
      }
      const group = new THREE.Group(); group.name = 'paths';
      const mats = {
        dirt: ribbonMaterial(tex.dirt, { units: 2, rough: 0.98, rag: 0.36 }),
        stone: ribbonMaterial(tex.stone, { units: 3, rough: 0.86, rag: 0.12 }),
        wood: new THREE.MeshLambertMaterial({ map: tex.wood, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4 }),
      };
      for (const k of ['dirt', 'stone', 'wood']) {
        const geo = mergeOrNull(by[k]);
        if (!geo) continue;
        const m = new THREE.Mesh(geo, mats[k]);
        m.receiveShadow = true; m.name = 'path-' + k;
        group.add(m);
      }
      // wooden boardwalk edge beams
      for (const p of lines.paths) {
        if (p.type !== 'wood') continue;
        for (const side of [-1, 1]) {
          const g = this._curbGeometry({ pts: p.pts, hw: p.hw - 0.02 }, side, () => false);
          if (g) { const m = new THREE.Mesh(g, G.gfx.material('tf-beam', () => new THREE.MeshLambertMaterial({ color: 0x6b4a2e, vertexColors: true }))); m.receiveShadow = true; group.add(m); }
        }
      }
      group.traverse((o) => { if (o.isMesh) { o.matrixAutoUpdate = false; o.updateMatrix(); o.raycast = () => {}; } });
      scene.add(group);
      this.meshes.paths = group;
    },

    /** ring of colliders along the contour where the valley floor turns into steep mountain */
    _buildSlopeColliders() {
      const step = 2.5, LIM = 2.2;
      const x0 = BOX.minX - 2, x1 = BOX.maxX + 2, z0 = BOX.minZ - 2, z1 = BOX.maxZ + 2;
      const nx = Math.ceil((x1 - x0) / step) + 1, nz = Math.ceil((z1 - z0) / step) + 1;
      const hi = new Uint8Array(nx * nz);
      for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
        const x = x0 + i * step, z = z0 + j * step;
        hi[j * nx + i] = heightAt(x, z) > LIM ? 1 : 0;
      }
      let count = 0;
      this._slopeColliders = [];
      for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
        if (!hi[j * nx + i]) continue;
        // the 만장대 hill is a walkable landmark (its path & plateau are fenced by the lookout module)
        if (MD && mdHill(x0 + i * step, z0 + j * step) > 0.05) continue;
        const nb = (ii, jj) => (ii < 0 || jj < 0 || ii >= nx || jj >= nz) ? 1 : hi[jj * nx + ii];
        if (nb(i - 1, j) && nb(i + 1, j) && nb(i, j - 1) && nb(i, j + 1)) continue;
        const id = G.world.addCollider({ shape: 'circle', x: x0 + i * step, z: z0 + j * step, r: 1.9, tag: 'terrain' });
        this._slopeColliders.push(id);
        count++;
      }
      G.log.info('WORLD', `terrain boundary colliders: ${count}`);
    },

    update() {
      const mat = this._backdropMat;
      const eng = G.sys.engine;
      if (!mat || !eng) return;
      const u = mat.uniforms, fog = eng.scene.fog;
      if (fog) {
        u.uFogColor.value.copy(fog.color);
        u.uFogDensity.value = fog.isFogExp2 ? fog.density : 2.2 / Math.max(50, fog.far || 1000);
      }
      u.uSunDir.value.copy(eng.sunDir);
      const sunI = eng.sun ? eng.sun.intensity * Math.max(0, eng.sunDir.y) : 1;
      const hemiI = eng.hemi ? eng.hemi.intensity : 0.8;
      u.uLight.value = clamp(0.3 + hemiI * 0.45 + sunI * 0.2, 0.12, 1.25);
    },
  };

  G.register(T);
})();
