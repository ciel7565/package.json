const CX = (G.complexParts = G.complexParts || { list: [], add(name, fn, order) { this.list.push({ name, fn, order: order == null ? 100 : order }); } });
// =============================================================================
// 57-complex-landscape.js — the LANDSCAPE of 만장대 단지 (PL_ALLOT, CONTRACT §16.8 / §16.12, track complex-landscape):
// everything natural and everything that stands in the gardens — the mountains round the site, the forest, the river water
// with its boulders and reeds, the far-bank cliffs, the roundabout pine garden with its fountain, street / plaza / village
// trees, hedges, lawn, the parked cars, the tour coaches and THE SHUTTLE BUS, birds over the forest.
// Look target: assets/reference/03-concept-main.webp (≈ 40 % of that picture is steep mixed forest in warm late light,
// ridge behind ridge in haze, a clear rocky river on the left); 04-concept-entrance.webp for the river side (cliffs + pines).
//
// A PART of the complex (registry above, order 10): complex-ground builds the place, the terrain INSIDE C.bounds, roads,
// walls, the bridge and the deck (order 0); this part never builds those. Everything is in PL_ALLOT's LOCAL metres
// (x east, z south, y up; C = G.data.complex). Numbers of the master plan are never copied: river, garden, forests,
// parking bays, bus bay, viewpoints … are read from C.elements / C.byId / C.waterY / C.height / C.pathDistance.
//
// WHAT IS BUILT (draw calls on `high`, aerial view; everything instanced or merged)
//   mountains   one mesh (4 nested rings of 4 / 8 / 16 / 32 m cells out to ≈ 1,190 m; crack-free borders). Inside ≈ 200 m
//               outside the bounds the height is C.height (the seam: the mesh begins 2 m INSIDE the bounds and 0.3 m lower);
//               farther out it blends into a ridge function of its own (ridge behind ridge, 250–420 m peaks) with the valley
//               opening north-west where the river comes from, south where it leaves and east along the road.
//               Shaded as FOREST SKIN: crown-sized domes (cellular noise) with their normal, darker creases, species
//               patches, lighter conifer tips, rock on steep slopes and cliffs, river gravel; flat colours on `low`.
//   forest      the plan's forest polygons inside a ≈ 160 m belt + the groves inside: real instanced trees (pine, round
//               broadleaf for oak / maple, vase zelkova, birch, sculpted garden pine) in three levels of detail with wind;
//               beyond the belt crown clumps on the nearer slopes and along every ridge line, so silhouettes are trees.
//               Uses G.sys.nature.grove(list, opts) for the near trees when the vegetation system offers it (render-nature).
//   river       water surface along the plan's river (and its valley beyond the site), flowing normals, depth colour,
//               sky reflection (scene environment), foam at boulders and riffles, wet dark rims; boulders + gravel; reeds.
//   cliffs      big displaced rock faces on the steep far bank, with pines on top.
//   garden      roundabout island: lawn, clipped hedge ring, sculpted pines, rocks, flower drifts, the FOUNTAIN (stone basin
//               r 4, centre jet + ring of jets as GPU droplets, wet rim; still under reduce-motion); sculpted pines by the
//               gate; street, plaza, village and riverside trees; hedges round the parking.
//   vehicles    ≈ 30 parked cars (7 paints, deterministic, instanced) on the plan's bays, two tour coaches, the shuttle bus
//               ("만장대 셔틀") at the plan's bus bay.
//   shadows     one instanced contact-shadow decal under crowns, cars, buses and rocks (no shadow map needed).
//   birds       (P1) a few flocks circling over the forest; slow wing beat (< 3 Hz), gliding under reduce-motion.
// `low` (frozen-low rule): flat colours, no maps, no alpha, simple cones / blobs (a few hundred trees), flat water.
//
// PUBLIC
//   G.complexLandscape.bus({ kind: 'shuttle'|'coach', label = '만장대 셔틀', low }) → THREE.Group (front = +z, wheels on y 0,
//                     length along z) — complex-ground puts the same shuttle at the valley's bus stop
//   G.complexLandscape.plan  pure planners (no THREE; tests/complex-landscape.mjs runs them in Node):
//       land(C, x, z)          the height of the landscape mesh (C.height near the site, the ridge function far away)
//       trees(C, quality)      { list: [{ x, y, z, sp, s, rot, src }], counts } every tree of the part
//       blocked(C, x, z, r, o) true where nothing may grow (roads, paths, pads, rings, fields, buildings, water …)
//       cars(C)                [{ x, y, z, rot, paint }] + coaches + shuttle spots
//   G.complexLandscape.stats  after a build: { calls, tris, trees, crowns, … } per family (tests / the developer centre)
// =============================================================================
(function () {
  'use strict';
  const PI = Math.PI, TAU = PI * 2;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
  const fin = Number.isFinite;

  // ------------------------------------------------------------------ deterministic noise (pure; Node and browsers agree)
  function hash2(ix, iz, s) {
    let h = (Math.imul(ix | 0, 374761393) + Math.imul(iz | 0, 668265263) + Math.imul(s | 0, 1442695041)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }
  function vnoise(x, z, s) {
    const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz;
    const ux = fx * fx * (3 - 2 * fx), uz = fz * fz * (3 - 2 * fz);
    const a = hash2(ix, iz, s), b = hash2(ix + 1, iz, s), c = hash2(ix, iz + 1, s), d = hash2(ix + 1, iz + 1, s);
    return lerp(lerp(a, b, ux), lerp(c, d, ux), uz);
  }
  /** gradient (Perlin-style) noise in [-1, 1]: no grid-aligned blocks like value noise */
  function gnoise(x, z, s) {
    const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz;
    const g = (i, j, dx, dz) => { const a = hash2(i, j, s) * TAU; return Math.cos(a) * dx + Math.sin(a) * dz; };
    const ux = fx * fx * fx * (fx * (fx * 6 - 15) + 10), uz = fz * fz * fz * (fz * (fz * 6 - 15) + 10);
    return 1.414 * lerp(lerp(g(ix, iz, fx, fz), g(ix + 1, iz, fx - 1, fz), ux), lerp(g(ix, iz + 1, fx, fz - 1), g(ix + 1, iz + 1, fx - 1, fz - 1), ux), uz);
  }
  const fbm3 = (x, z, s) => vnoise(x, z, s) * 0.55 + vnoise(x * 2.03 + 17.1, z * 2.03 - 5.3, s + 1) * 0.3 + vnoise(x * 4.1 - 9.7, z * 4.1 + 3.3, s + 2) * 0.15;
  const ridged = (x, z, s) => { const n = vnoise(x, z, s); return 1 - Math.abs(2 * n - 1); };
  function mulberry(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

  // ------------------------------------------------------------------ geometry helpers (pure)
  function segNear(px, pz, ax, az, bx, bz) {
    const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
    const t = l2 > 0 ? clamp(((px - ax) * dx + (pz - az) * dz) / l2, 0, 1) : 0;
    const qx = ax + dx * t - px, qz = az + dz * t - pz;
    return { d2: qx * qx + qz * qz, t };
  }
  /** nearest point on a polyline [[x, z, (y)], …]: { d, i, t, s (along), y (lerped 3rd value) } */
  function polyNear(px, pz, pts) {
    let best = Infinity, bi = 0, bt = 0, s = 0, bs = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1], len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const r = segNear(px, pz, a[0], a[1], b[0], b[1]);
      if (r.d2 < best) { best = r.d2; bi = i; bt = r.t; bs = s + len * r.t; }
      s += len;
    }
    const a = pts[bi], b = pts[bi + 1] || a;
    return { d: Math.sqrt(best), i: bi, t: bt, s: bs, y: a.length > 2 ? lerp(a[2], b[2], bt) : 0 };
  }
  function pointInPoly(x, z, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i][0], zi = poly[i][1], xj = poly[j][0], zj = poly[j][1];
      if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
    }
    return inside;
  }
  const polyBox = (poly) => { let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity; for (const p of poly) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); z0 = Math.min(z0, p[1]); z1 = Math.max(z1, p[1]); } return { x0, z0, x1, z1 }; };
  /** distance outside an axis-aligned rectangle (0 inside) */
  const outside = (x, z, b) => Math.hypot(Math.max(b.minX - x, 0, x - b.maxX), Math.max(b.minZ - z, 0, z - b.maxZ));

  // =============================================================================================== PURE PLANNING (no THREE)
  // ---------------------------------------------------------------- the land outside the site
  // The plan's height closes the river valley right past the river's ends; the picture shows the valley opening towards
  // the north-west (upstream) and the south (downstream), and the road leaves east through a cut. Valley axes continue the
  // river's own centre line (read from the plan) out to the far ridges; floors climb upstream and fall downstream.
  const AXES_CACHE = new WeakMap();
  function axesOf(C) {
    let A = AXES_CACHE.get(C);
    if (A) return A;
    const river = C.byId && C.byId('RIVER');
    const rp = river ? river.pts : [[-214, -210, 6], [-194, 240, -1.8]];
    const n0 = rp[0], n1 = rp[1], s0 = rp[rp.length - 1], s1 = rp[rp.length - 2];
    const ext = (p, q, steps) => {           // continue from p in the direction q → p, bending by `steps` [[len, turn, dy]]
      let dx = p[0] - q[0], dz = p[1] - q[1];
      const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
      const out = [[p[0], p[1], p[2]]];
      let x = p[0], z = p[1], y = p[2];
      for (const [len, turn, dy] of steps) {
        const c = Math.cos(turn), s = Math.sin(turn), nx = dx * c - dz * s, nz = dx * s + dz * c; dx = nx; dz = nz;
        x += dx * len; z += dz * len; y += dy;
        out.push([x, z, y]);
      }
      return out;
    };
    // north (upstream): bends a little west — the valley opens north-west; the floor climbs
    const north = [[n1[0], n1[1], n1[2]]].concat(ext(n0, n1, [[240, -0.12, 9], [320, -0.1, 12], [360, -0.06, 14], [320, 0, 10]]));
    // south (downstream): the floor falls
    const south = [[s1[0], s1[1], s1[2]]].concat(ext(s0, s1, [[220, 0.05, -2.2], [300, 0.08, -3], [340, 0.04, -3], [300, 0, -2]]));
    // east: the road along the south edge leaves through a saddle
    const road = (C.elements || []).find((e) => e.type === 'road' && e.pts && e.pts[e.pts.length - 1][0] > (C.bounds.maxX - 10));
    const rpE = road ? road.pts : [[60, 134], [200, 134]];
    const e1 = rpE[rpE.length - 1], e0 = rpE[rpE.length - 2];
    const east = [[e0[0], e0[1], 1.5]].concat(ext([e1[0], e1[1], 2], [e0[0], e0[1], 2], [[150, -0.12, 6], [260, -0.08, 12], [340, -0.05, 14], [340, 0, 12]]));
    const seg0 = (pts) => Math.hypot(pts[1][0] - pts[0][0], pts[1][1] - pts[0][1]);
    A = [
      { id: 'N', pts: north, w0: 42, w1: 115, ramp: 70, depth: 1, s0: seg0(north) },
      { id: 'S', pts: south, w0: 38, w1: 105, ramp: 70, depth: 1, s0: seg0(south) },
      { id: 'E', pts: east, w0: 20, w1: 80, ramp: 40, depth: 0.85, s0: seg0(east) },
    ];
    AXES_CACHE.set(C, A);
    return A;
  }
  /** the far ridge function (beyond ≈ 200 m from the bounds): a ridged multifractal over a warped domain — sharp crests
   *  with spurs and gullies, rising to 250–420 m peaks with the distance */
  function ridgeH(x, z, d) {
    const wx = x + 170 * gnoise(x / 610 + 5.1, z / 610 - 2.7, 21), wz = z + 170 * gnoise(x / 610 - 8.3, z / 610 + 1.9, 22);
    let sum = 0, norm = 0, f = 1 / 470, amp = 1, wgt = 1;
    for (let o = 0; o < 5; o++) {
      const c = Math.cos(o * 1.13), sn = Math.sin(o * 1.13);              // each octave turned: no common grid direction
      const u = (wx * c - wz * sn) * f, v = (wx * sn + wz * c) * f;
      let r = 1 - Math.abs(gnoise(u + o * 17.3, v - o * 9.1, 30 + o)); r *= r; r *= wgt;
      wgt = clamp(r * 1.8, 0, 1);
      sum += r * amp; norm += amp; f *= 2.07; amp *= 0.5;
    }
    const mf = sum / norm;
    const rise = 95 + 260 * (1 - Math.exp(-Math.max(0, d - 170) / 360));
    return rise * (0.4 + 1.1 * mf);
  }
  /** valley carving: inside each axis the height falls to a U-shaped valley floor that follows the axis (ramped in from
   *  the end of the plan's own valley, so the plan decides along its river and road) */
  function carve(C, x, z, h) {
    for (const A of axesOf(C)) {
      const n = polyNear(x, z, A.pts);
      const along = n.s - A.s0;
      if (along < -10) continue;
      const W = lerp(A.w0, A.w1, smooth(0, 900, along)) * (0.8 + 0.45 * (0.5 + 0.5 * gnoise(x / 140, z / 140, 41)));
      if (n.d > W * 2.6) continue;
      const floor = n.y + 1.5 + Math.pow(Math.max(0, n.d - 10) / W, 1.8) * W * 0.7 + 3 * (1 + gnoise(x / 60, z / 60, 42)) * smooth(10, 40, n.d);     // a U-shaped valley, sides steepen
      const w = smooth(-10, A.ramp, along) * A.depth * Math.exp(-Math.pow(n.d / (W * 1.9), 4));
      if (floor < h) h = lerp(h, floor, w);
    }
    return h;
  }
  /** height of the landscape mesh at (x, z) (local metres). Near the site exactly C.height; the seam shift (−0.3) is NOT
   *  included here (the mesh adds it). */
  function land(C, x, z) {
    const d = outside(x, z, C.bounds);
    let h;
    if (d < 1e-9) return C.height(x, z);
    if (d <= 180) h = C.height(x, z);
    else if (d >= 430) h = ridgeH(x, z, d);
    else h = lerp(C.height(x, z), ridgeH(x, z, d), smooth(180, 430, d));
    return carve(C, x, z, h);
  }

  // ---------------------------------------------------------------- what may not hold a tree / rock / hedge
  const FOOT_CACHE = new WeakMap();
  function footprints(C) {
    let F = FOOT_CACHE.get(C);
    if (F) return F;
    F = { rects: [], circles: [], polys: [], lines: [], points: [], garden: null };
    for (const e of C.elements || []) {
      switch (e.type) {
        case 'building': {
          const R = Math.hypot(e.w || 0, e.d || 0) / 2;
          if (e.rot) F.circles.push({ x: e.x, z: e.z, r: R + 1.5, id: e.id });
          else if (e.parts) for (const p of e.parts) F.rects.push({ x0: p.x0 - 2, z0: p.z0 - 2, x1: p.x1 + 2, z1: p.z1 + 2, id: e.id });
          else F.rects.push({ x0: e.x - e.w / 2 - 2, z0: e.z - e.d / 2 - 2, x1: e.x + e.w / 2 + 2, z1: e.z + e.d / 2 + 2, id: e.id });
          break;
        }
        case 'parking': case 'busbay': case 'deck': case 'storeyard': case 'plaza':
          if (fin(e.x0)) F.rects.push({ x0: Math.min(e.x0, e.x1) - 1, z0: Math.min(e.z0, e.z1) - 1, x1: Math.max(e.x0, e.x1) + 1, z1: Math.max(e.z0, e.z1) + 1, id: e.id, plaza: e.type === 'plaza' });
          break;
        case 'kiln': if (fin(e.x)) F.rects.push({ x0: e.x - (e.w || 4) / 2 - 1, z0: Math.min(e.z0, e.z1) - 1, x1: e.x + (e.w || 4) / 2 + 1, z1: Math.max(e.z0, e.z1) + 1, id: e.id }); break;
        case 'field': if (e.poly) F.polys.push({ poly: e.poly, box: polyBox(e.poly), id: e.id }); break;
        case 'jarcircle': F.circles.push({ x: e.cx, z: e.cz, r: (e.wallR || 62) + 2.5, id: e.id }); break;
        case 'amphitheatre': F.circles.push({ x: e.cx, z: e.cz, r: (e.wallR || 62) + 2.5, half: e.cz + 6, id: e.id }); break;
        case 'roundabout': F.annuli = (F.annuli || []).concat([{ x: e.cx, z: e.cz, r0: (e.r0 || 19) - 0.3, r1: (e.r1 || 30) + 2.5 }]); break;
        case 'garden': F.garden = e; break;
        case 'corridor': if (e.pts) F.lines.push({ pts: e.pts, w: (e.w || 4.4) / 2 + 2 }); break;
        case 'road': if (e.pts) F.lines.push({ pts: e.pts, w: (e.w || 8) / 2 + 2.5, road: true }); break;
        case 'stair': if (e.pts) F.lines.push({ pts: e.pts.map((p) => [p[0], p[1]]), w: (e.w || 2.4) / 2 + 1.2 }); break;
        case 'bridge': F.lines.push({ pts: [[e.x0, e.z0], [e.x1, e.z1]], w: (e.w || 4) / 2 + 3 }); break;
        case 'wall': break;
        case 'knoll': F.circles.push({ x: e.cx, z: e.cz, r: 5.5, id: e.id }); break;
        case 'lamp': for (const l of e.list || []) F.points.push({ x: l[0], z: l[1], r: 1.6 }); break;
        case 'sign': F.points.push({ x: e.x, z: e.z, r: 1.8 }); break;
        default: break;
      }
    }
    FOOT_CACHE.set(C, F);
    return F;
  }
  /** true where nothing may grow (r = the radius of the thing). o.plaza: trees may stand on plaza paving (street trees);
   *  o.garden: the roundabout island is allowed (its own plants). */
  function blocked(C, x, z, r, o) {
    o = o || {};
    const F = footprints(C);
    const B = C.bounds;
    // water and the wet river bed (+ a bank margin)
    const wy = C.waterY ? C.waterY(x, z) : -Infinity;
    if (wy > -Infinity) return true;
    const river = C.byId && C.byId('RIVER');
    if (river) { const n = polyNear(x, z, river.pts); if (n.d < river.w / 2 + 1.2 + r * 0.6) return true; }
    for (const L of F.lines) { if (polyNear(x, z, L.pts).d < L.w + r * 0.5) return true; }
    const inB = x > B.minX - 6 && x < B.maxX + 6 && z > B.minZ - 6 && z < B.maxZ + 6;
    if (!inB) return false;
    for (const R of F.rects) { if (R.plaza && o.plaza) continue; if (x > R.x0 - r && x < R.x1 + r && z > R.z0 - r && z < R.z1 + r) return true; }
    for (const c of F.circles) { if (c.half != null && z > c.half) continue; if (Math.hypot(x - c.x, z - c.z) < c.r + r) return true; }
    for (const a of F.annuli || []) { const d = Math.hypot(x - a.x, z - a.z); if (d > a.r0 - r && d < a.r1 + r) return true; if (d <= a.r0 && !o.garden) return true; }
    for (const P of F.polys) { const b = P.box; if (x > b.x0 - 3 && x < b.x1 + 3 && z > b.z0 - 3 && z < b.z1 + 3 && (pointInPoly(x, z, P.poly) || polyEdgeD(x, z, P.poly) < 2 + r)) return true; }
    for (const p of F.points) { if (Math.abs(x - p.x) < p.r + r && Math.abs(z - p.z) < p.r + r) return true; }
    if (x > B.minX && x < B.maxX && z > B.minZ && z < B.maxZ) {
      if (C.walkable && !C.walkable(x, z) && !(o.garden && F.garden && Math.hypot(x - F.garden.cx, z - F.garden.cz) < F.garden.r)) return true;
      if (C.pathDistance) {
        const pd = C.pathDistance(x, z);
        if (pd.d < r + 0.8 && !(o.plaza && pd.path && pd.path.kind === 'plaza')) return true;
      }
    }
    return false;
  }
  function polyEdgeD(x, z, poly) { let b = Infinity; for (let i = 0; i < poly.length; i++) { const a = poly[i], c = poly[(i + 1) % poly.length]; b = Math.min(b, segNear(x, z, a[0], a[1], c[0], c[1]).d2); } return Math.sqrt(b); }

  // ---------------------------------------------------------------- trees
  // species ids (geometry families): 0 pine (Korean red pine) · 1 round broadleaf (oak, maple) · 2 vase (zelkova) ·
  // 3 birch · 4 sculpted garden pine.  Colour variants come from the instance colour.
  const SP = { pine: 0, oak: 1, maple: 1, zelkova: 2, birch: 3, pine_sculpted: 4 };
  const SP_NAMES = ['pine', 'round', 'vase', 'birch', 'sculpted'];
  const BELT = 160;
  const QPLAN = { low: { dens: 0.12, belt: 120 }, medium: { dens: 0.6, belt: 150 }, high: { dens: 1.0, belt: BELT } };
  function pickSpecies(shares, u) {
    let acc = 0, last = 'pine';
    for (const k of Object.keys(shares)) { acc += shares[k]; last = k; if (u < acc) return k; }
    return last;
  }
  /** every tree of the part (deterministic). quality scales the density (low: a few hundred). */
  function trees(C, quality, hAt) {
    const Q = QPLAN[quality] || QPLAN.high;
    const H = typeof hAt === 'function' ? hAt : (x, z) => land(C, x, z);
    const list = [], counts = { forest: 0, garden: 0, gate: 0, street: 0, plaza: 0, riverside: 0, rejected: 0 };
    const push = (t) => { list.push(t); counts[t.src] = (counts[t.src] || 0) + 1; };
    const B = C.bounds;
    // forest polygons (the near belt + the small groves inside the site)
    for (const e of C.elements || []) {
      if (e.type !== 'forest' || !e.poly) continue;
      const box = polyBox(e.poly);
      const spacing = Math.sqrt(100 / Math.max(0.05, e.density * Q.dens));
      const x0 = Math.max(box.x0, B.minX - Q.belt), x1 = Math.min(box.x1, B.maxX + Q.belt), z0 = Math.max(box.z0, B.minZ - Q.belt), z1 = Math.min(box.z1, B.maxZ + Q.belt);
      const seed = e.id.split('').reduce((a, c) => a * 31 + c.charCodeAt(0), 7) >>> 0;
      for (let gz = z0, j = 0; gz < z1; gz += spacing, j++) {
        for (let gx = x0, i = 0; gx < x1; gx += spacing, i++) {
          const x = gx + (hash2(i, j, seed) - 0.5) * spacing * 0.9, z = gz + (hash2(i, j, seed + 1) - 0.5) * spacing * 0.9;
          if (!pointInPoly(x, z, e.poly)) continue;
          if (outside(x, z, B) > Q.belt) continue;
          if (e.clear && e.clear.some((c) => Math.hypot(x - c.x, z - c.z) < c.r)) continue;
          const kind = pickSpecies(e.species || { pine: 1 }, hash2(i, j, seed + 2));
          const s = (0.82 + hash2(i, j, seed + 3) * 0.4) * (kind === 'pine_sculpted' ? 0.6 : 1);
          if (blocked(C, x, z, 2.2 * s, {})) { counts.rejected++; continue; }
          const y = H(x, z);
          // too steep for a tree (cliffs carry rocks instead): slope from four probes
          const sl = Math.max(Math.abs(H(x + 2, z) - H(x - 2, z)), Math.abs(H(x, z + 2) - H(x, z - 2))) / 4;
          if (sl > 1.35) { counts.rejected++; continue; }
          push({ x, y, z, sp: SP[kind] ?? 0, kind, s, rot: hash2(i, j, seed + 4) * TAU, src: e.id === 'FO_RIVERSIDE' ? 'riverside' : 'forest', v: hash2(i, j, seed + 5) });
        }
      }
    }
    // the roundabout island: the plan's sculpted pines
    const gd = C.byId && C.byId('GARDEN');
    if (gd) for (const p of gd.pines || []) push({ x: p.x, y: C.height(p.x, p.z), z: p.z, sp: SP.pine_sculpted, kind: 'pine_sculpted', s: p.s || 1, rot: hash2(Math.round(p.x * 10), Math.round(p.z * 10), 71) * TAU, src: 'garden', v: 0.5 });
    // the main gate (bottom centre of the picture): sculpted pines flanking the forecourt
    const gate = (C.elements || []).find((e) => e.type === 'building' && /gate/i.test(e.kind || e.id || ''));
    const gp = (C.elements || []).find((e) => e.type === 'plaza' && /GATE/.test(e.id));
    if (gp) {
      const cand = [[gp.x0 - 2.6, gp.z0 + 3], [gp.x0 - 2.8, (gp.z0 + gp.z1) / 2 + 2], [gp.x0 - 2.4, gp.z1 - 3], [gp.x1 + 2.6, gp.z0 + 6], [gp.x1 + 2.8, gp.z1 - 4]];
      if (gate) cand.push([gate.x - 6.5, gate.z + 8.5], [gate.x + 9, gate.z + 6.5]);
      cand.forEach((c, k) => { if (!blocked(C, c[0], c[1], 1.4, { plaza: true })) push({ x: c[0], y: C.height(c[0], c[1]), z: c[1], sp: SP.pine_sculpted, kind: 'pine_sculpted', s: 0.95 + hash2(k, 3, 91) * 0.35, rot: hash2(k, 4, 91) * TAU, src: 'gate', v: 0.5 }); else counts.rejected++; });
    }
    // street trees (zelkova) along the roads inside the site, both sides, every ≈ 13 m
    for (const e of C.elements || []) {
      if (e.type !== 'road' || !e.pts || (e.w || 8) < 8) continue;
      const pts = e.pts;
      let acc = 0;
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i], b = pts[i + 1], l = Math.hypot(b[0] - a[0], b[1] - a[1]);
        const nx = -(b[1] - a[1]) / l, nz = (b[0] - a[0]) / l;
        for (let s = (13 - (acc % 13)) % 13; s < l; s += 13 / Math.max(0.35, Q.dens)) {
          for (const side of [-1, 1]) {
            const off = e.w / 2 + 4.4;
            const x = a[0] + (b[0] - a[0]) * (s / l) + nx * off * side, z = a[1] + (b[1] - a[1]) * (s / l) + nz * off * side;
            if (outside(x, z, B) > 0 || blocked(C, x, z, 1.6, { plaza: true })) { counts.rejected++; continue; }
            const k = Math.round(x * 3 + z * 7);
            push({ x, y: C.height(x, z), z, sp: SP.zelkova, kind: 'zelkova', s: 0.78 + hash2(k, 1, 33) * 0.2, rot: hash2(k, 2, 33) * TAU, src: 'street', v: hash2(k, 3, 33) });
          }
        }
        acc += l;
      }
    }
    // plaza trees: two rows on the entrance plaza (shade over the benches), checked against signs / lamps / paths
    for (const e of C.elements || []) {
      if (e.type !== 'plaza' || !/ENTRY/.test(e.id)) continue;
      for (const x of [e.x0 + 3.2, e.x1 - 3.2]) for (let z = e.z0 + 6; z < e.z1 - 3; z += 11 / Math.max(0.5, Q.dens)) {
        if (blocked(C, x, z, 1.4, { plaza: true })) { counts.rejected++; continue; }
        const k = Math.round(x * 5 + z * 11);
        push({ x, y: C.height(x, z), z, sp: SP.zelkova, kind: 'zelkova', s: 0.72 + hash2(k, 1, 44) * 0.16, rot: hash2(k, 2, 44) * TAU, src: 'plaza', v: hash2(k, 3, 44) });
      }
    }
    return { list, counts };
  }

  // ---------------------------------------------------------------- vehicles
  const PAINTS = [[0.92, 0.92, 0.9], [0.62, 0.64, 0.66], [0.07, 0.075, 0.08], [0.28, 0.29, 0.31], [0.1, 0.16, 0.32], [0.55, 0.06, 0.06], [0.72, 0.66, 0.55]];
  const PAINT_W = [0.27, 0.2, 0.17, 0.14, 0.09, 0.07, 0.06];
  function cars(C) {
    const P = C.byId && C.byId('PARKING');
    const out = { cars: [], coaches: [], shuttle: null };
    const bus = C.busStop || (C.byId && C.byId('BUSBAY') && C.byId('BUSBAY').stop);
    if (bus) out.shuttle = { x: bus.x, z: bus.z, rot: fin(bus.rot) ? bus.rot : PI, y: C.height(bus.x, bus.z) };
    if (!P || !P.bays || !P.bays.length) return out;
    // two coaches along the westmost column, near the entrance end (they block the bays they cover)
    const colX = Math.min(...P.bays.map((b) => b.x));
    const west = P.bays.filter((b) => Math.abs(b.x - colX) < 0.1).sort((a, b) => b.z - a.z);
    const taken = new Set();
    if (west.length >= 12) {
      for (const k of [0, 1]) {
        const grp = west.slice(1 + k * 6, 1 + k * 6 + 5);
        const zc = grp.reduce((a, b) => a + b.z, 0) / grp.length;
        grp.forEach((b) => taken.add(b));
        out.coaches.push({ x: colX, z: zc, rot: k ? 0 : PI, y: C.height(colX, zc) });
      }
    }
    // ≈ 30 cars on the free bays (more near the entrance end, like a real afternoon)
    const zMax = Math.max(...P.bays.map((b) => b.z)), zMin = Math.min(...P.bays.map((b) => b.z));
    P.bays.forEach((b, i) => {
      if (taken.has(b)) return;
      const near = 1 - (zMax - b.z) / Math.max(1, zMax - zMin);
      if (hash2(i, 17, 5) > 0.25 + 0.4 * near) return;
      let u = hash2(i, 18, 5), paint = 0;
      for (let k = 0, acc = 0; k < PAINT_W.length; k++) { acc += PAINT_W[k]; if (u < acc) { paint = k; break; } }
      const jx = (hash2(i, 19, 5) - 0.5) * 0.3, jr = (hash2(i, 20, 5) - 0.5) * 0.06;
      out.cars.push({ x: b.x + jx * Math.abs(Math.sin(b.rot)), z: b.z + jx * Math.abs(Math.cos(b.rot)), rot: b.rot + jr + (hash2(i, 21, 5) < 0.3 ? PI : 0), y: C.height(b.x, b.z), paint, kind: hash2(i, 22, 5) < 0.3 ? 1 : 0 });
    });
    return out;
  }

  const plan = { land, trees, blocked, cars, ridgeH, carve, axes: axesOf, outside, polyNear, footprints, SP, SP_NAMES, PAINTS };
  G.complexLandscape = Object.assign(G.complexLandscape || {}, { plan, version: 1 });

  // =============================================================================================== 3D (THREE from here on)
  // ------------------------------------------------------------------ GLSL shared by the materials of this part
  const GLSL_COMMON = `
float cxH21(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec2 cxH22(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
float cxN(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(cxH21(i), cxH21(i + vec2(1.0, 0.0)), u.x), mix(cxH21(i + vec2(0.0, 1.0)), cxH21(i + vec2(1.0, 1.0)), u.x), u.y); }
float cxFbm(vec2 p){ return cxN(p) * 0.55 + cxN(p * 2.03 + 7.1) * 0.3 + cxN(p * 4.1 - 3.7) * 0.15; }
float cxN3(vec3 p){ return cxN(p.xz + p.y * vec2(0.71, 1.37)); }
`;
  const GLSL_CELL = `
vec4 cxCell(vec2 p, out vec2 toF){
  vec2 ip = floor(p), fp = fract(p); float f1 = 8.0, f2 = 8.0, id = 0.0; toF = vec2(0.0);
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 g = vec2(float(i), float(j)); vec2 o = cxH22(ip + g); float rad = 0.5 + 0.38 * cxH21(ip + g + 5.7);
    vec2 r = g + o - fp; float d = length(r) / rad;
    if (d < f1) { f2 = f1; f1 = d; id = cxH21(ip + g + 17.3); toF = r / rad; } else if (d < f2) { f2 = d; }
  }
  return vec4(f1, f2, id, 0.0);
}
`;
  /** onBeforeCompile helper: parts = { uniforms, vhead, vbegin (after begin_vertex), vcolor (replaces color_vertex),
   *  vend (after project_vertex), fhead, fcolor (after color_fragment), fnormal (after normal_fragment_maps),
   *  frough (after roughnessmap_fragment), fend (before the output) } */
  function patch(mat, key, P) {
    mat.onBeforeCompile = (sh) => {
      if (P.uniforms) Object.assign(sh.uniforms, P.uniforms);
      let v = sh.vertexShader, f = sh.fragmentShader;
      if (P.vhead) v = v.replace('#include <common>', '#include <common>\n' + P.vhead);
      if (P.vbegin) v = v.replace('#include <begin_vertex>', '#include <begin_vertex>\n' + P.vbegin);
      if (P.vcolor) v = v.replace('#include <color_vertex>', P.vcolor);
      if (P.vend) v = v.replace('#include <project_vertex>', '#include <project_vertex>\n' + P.vend);
      if (P.fhead) f = f.replace('#include <common>', '#include <common>\n' + P.fhead);
      if (P.fcolor) f = f.replace('#include <color_fragment>', '#include <color_fragment>\n' + P.fcolor);
      if (P.fnormal) f = f.replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n' + P.fnormal);
      if (P.frough) f = f.replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n' + P.frough);
      if (P.fend) f = f.replace('#include <opaque_fragment>', P.fend + '\n#include <opaque_fragment>');
      sh.vertexShader = v; sh.fragmentShader = f;
    };
    mat.customProgramCacheKey = () => 'cxl-' + key;
    return mat;
  }
  const WP_VARY = 'varying vec3 vCxWP;';
  const WP_CALC = `{ vec4 cxw = vec4(transformed, 1.0);
#ifdef USE_INSTANCING
  cxw = instanceMatrix * cxw;
#endif
  vCxWP = (modelMatrix * cxw).xyz; }`;
  const motionReduced = () => !!(G.motionReduced ? G.motionReduced() : G.settings && G.settings.reduceMotion);

  // ------------------------------------------------------------------ small geometry kit (vertex colours + extra attributes)
  /** collects pieces: add(geometry, { color: [r, g, b] | fn(x, y, z) → [r, g, b], sway, leaf, paint, matrix }) → one geometry */
  class Kit {
    constructor(extra) { this.parts = []; this.extra = extra || []; }
    add(g, o = {}) {
      g = g.index ? g.toNonIndexed() : g;
      if (o.matrix) g.applyMatrix4(o.matrix);
      if (!g.attributes.normal) g.computeVertexNormals();
      const n = g.attributes.position.count, p = g.attributes.position.array;
      const col = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        const c = typeof o.color === 'function' ? o.color(p[i * 3], p[i * 3 + 1], p[i * 3 + 2]) : (o.color || [1, 1, 1]);
        col[i * 3] = c[0]; col[i * 3 + 1] = c[1]; col[i * 3 + 2] = c[2];
      }
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      for (const name of this.extra) {
        const v = o[name], a = new Float32Array(n);
        for (let i = 0; i < n; i++) a[i] = typeof v === 'function' ? v(p[i * 3], p[i * 3 + 1], p[i * 3 + 2]) : (v || 0);
        g.setAttribute('a' + name[0].toUpperCase() + name.slice(1), new THREE.BufferAttribute(a, 1));
      }
      for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'color', 'uv'].includes(k) && !this.extra.some((e) => 'a' + e[0].toUpperCase() + e.slice(1) === k)) g.deleteAttribute(k);
      if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
      this.parts.push(g);
      return this;
    }
    build() {
      const BGU = ADDONS.BufferGeometryUtils;
      const g = this.parts.length === 1 ? this.parts[0] : BGU.mergeGeometries(this.parts, false);
      for (const p of this.parts) if (p !== g) p.dispose();
      this.parts = [];
      g.computeBoundingSphere(); g.computeBoundingBox();
      return g;
    }
  }
  const M4 = () => new THREE.Matrix4();
  const at = (x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) => M4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz));
  /** a lumpy blob (icosahedron displaced by noise), normals pushed outwards from its centre (soft, round shading) */
  function blob(r, detail, seed, sx = 1, sy = 1, sz = 1, jitter = 0.25) {
    const g = new THREE.IcosahedronGeometry(r, detail).toNonIndexed();
    const p = g.attributes.position.array, n = new Float32Array(p.length);
    for (let i = 0; i < p.length; i += 3) {
      const x = p[i], y = p[i + 1], z = p[i + 2], l = Math.hypot(x, y, z) || 1;
      const k = 1 + jitter * (vnoise(x / r * 1.7 + seed, z / r * 1.7 - seed, 7) * 2 - 1) + jitter * 0.5 * (vnoise(y / r * 2.3 - seed, x / r * 2.3, 8) * 2 - 1);
      p[i] = x * k * sx; p[i + 1] = y * k * sy; p[i + 2] = z * k * sz;
      n[i] = x / l / sx; n[i + 1] = y / l / sy; n[i + 2] = z / l / sz;
      const m = Math.hypot(n[i], n[i + 1], n[i + 2]) || 1; n[i] /= m; n[i + 1] /= m; n[i + 2] /= m;
    }
    g.setAttribute('normal', new THREE.BufferAttribute(n, 3));
    return g;
  }
  /** a tapered tube along points [[x, y, z], …] (radius r0 → r1) */
  function tube(pts, r0, r1, seg) {
    const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(p[0], p[1], p[2])));
    const tg = new THREE.TubeGeometry(curve, Math.max(1, pts.length * 2 - 2), 1, seg, false);
    const p = tg.attributes.position.array, rings = Math.max(1, pts.length * 2 - 2);
    // scale each ring by the taper (TubeGeometry builds (rings + 1) × (seg + 1) vertices)
    const P = curve.getSpacedPoints(rings);
    for (let i = 0; i <= rings; i++) {
      const r = lerp(r0, r1, i / rings), c = P[i];
      for (let j = 0; j <= seg; j++) {
        const k = (i * (seg + 1) + j) * 3;
        p[k] = c.x + (p[k] - c.x) * r; p[k + 1] = c.y + (p[k + 1] - c.y) * r; p[k + 2] = c.z + (p[k + 2] - c.z) * r;
      }
    }
    tg.computeVertexNormals();
    return tg;
  }
  /** x of a river centre line [[x, z, …], …] (monotonic in z) at z */
  function riverXAt(P, z) {
    if (z <= P[0][1]) return P[0][0];
    for (let i = 0; i < P.length - 1; i++) if (z <= P[i + 1][1]) return lerp(P[i][0], P[i + 1][0], (z - P[i][1]) / (P[i + 1][1] - P[i][1]));
    return P[P.length - 1][0];
  }
  /** '#rrggbb' (sRGB) → linear [r, g, b] (pure: also runs where THREE is absent) */
  const lin = (hex) => { const n = parseInt(hex.slice(1), 16), f = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return [f((n >> 16) & 255), f((n >> 8) & 255), f(n & 255)]; };

  // ------------------------------------------------------------------ tree species (geometry per level of detail)
  // aSway: 0 at the foot … 1 at the crown tips (wind) · aLeaf: 1 foliage (takes the instance colour), 0 bark
  const BARK = { pine: lin('#7a4a34'), pineLow: lin('#3e3129'), oak: lin('#4b4036'), zel: lin('#6d665c'), birch: lin('#d9d6cc'), birchDark: lin('#2e2b28') };
  function barkCol(lo, hi, y0, y1) { return (x, y, z) => { const t = smooth(y0, y1, y), v = 0.85 + 0.3 * vnoise(x * 3 + y * 0.7, z * 3, 3); return [lerp(lo[0], hi[0], t) * v, lerp(lo[1], hi[1], t) * v, lerp(lo[2], hi[2], t) * v]; }; }
  const leafCol = (base, top, y0, y1) => (x, y, z) => { const t = smooth(y0, y1, y), v = 0.8 + 0.35 * vnoise(x * 0.9 + 3, z * 0.9 + y * 0.6, 4); return [lerp(base, top, t) * v, lerp(base, top, t) * v, lerp(base, top, t) * v]; };
  const swayFn = (h) => (x, y) => clamp(y / h, 0, 1) ** 1.5;
  /** lod 0 (near, rich) · 1 (middle) · 2 (far / low: a simple form) */
  function treeGeometry(sp, lod) {
    const K = new Kit(['sway', 'leaf']);
    const rnd = mulberry(1000 + sp * 17 + lod);
    const seg = [7, 5, 4][lod], det = [1, 1, 0][lod];
    if (sp === 0) {                                   // Korean red pine: tall, curved, reddish top, layered umbrella pads
      const H = 12.5, lean = [0.8, 0.4];
      const trunk = lod === 2 ? [[0, -0.4, 0], [lean[0], H * 0.8, lean[1]]] : [[0, -0.4, 0], [0.35, 4, 0.1], [lean[0] - 0.3, 8, lean[1] + 0.2], [lean[0], H * 0.82, lean[1]]];
      K.add(tube(trunk, 0.34, 0.12, seg), { color: barkCol(BARK.pineLow, BARK.pine, 1.5, 8), sway: swayFn(H), leaf: 0 });
      const pads = [[lean[0], H * 0.88, lean[1], 2.5, 0.5]];
      const np = [5, 3, 1][lod];
      for (let i = 0; i < np; i++) {
        const a = i / np * TAU + rnd() * 0.8, y = H * (0.6 + 0.22 * rnd()), t = y / H, L = 1.8 + rnd() * 1.4;
        const bx = lean[0] * t, bz = lean[1] * t, ex = bx + Math.sin(a) * L, ez = bz + Math.cos(a) * L;
        if (lod === 0) K.add(tube([[bx, y - 0.5, bz], [(bx + ex) / 2, y, (bz + ez) / 2], [ex, y + 0.2, ez]], 0.09, 0.04, 4), { color: BARK.pine, sway: swayFn(H), leaf: 0 });
        pads.push([ex, y + 0.35, ez, 1.5 + rnd() * 0.7, 0.42 + rnd() * 0.1]);
      }
      for (const p of pads) {
        K.add(blob(p[3], det, rnd() * 9, 1.25, p[4], 1.25, 0.3), { matrix: at(p[0], p[1], p[2]), color: leafCol(0.62, 1.05, p[1] - 1, p[1] + 1), sway: swayFn(H), leaf: 1 });
        if (lod === 0) K.add(blob(p[3] * 0.6, 0, rnd() * 9, 1.2, p[4] * 0.9, 1.2, 0.25), { matrix: at(p[0] + rnd() - 0.5, p[1] + p[3] * 0.3, p[2] + rnd() - 0.5), color: leafCol(0.8, 1.1, p[1], p[1] + 1.5), sway: swayFn(H), leaf: 1 });
      }
    } else if (sp === 1 || sp === 2) {                // round broadleaf (oak, maple) · vase (zelkova)
      const vase = sp === 2, H = vase ? 10.5 : 9.0;
      if (vase && lod < 2) {
        K.add(tube([[0, -0.4, 0], [0, 2.6, 0]], 0.36, 0.26, seg), { color: barkCol(BARK.zel, BARK.zel, 0, 3), sway: swayFn(H), leaf: 0 });
        for (let i = 0; i < 3; i++) { const a = i / 3 * TAU + 0.4; K.add(tube([[0, 2.4, 0], [Math.sin(a) * 1.0, 4.6, Math.cos(a) * 1.0], [Math.sin(a) * 2.1, 6.8, Math.cos(a) * 2.1]], 0.2, 0.08, Math.max(4, seg - 2)), { color: BARK.zel, sway: swayFn(H), leaf: 0 }); }
      } else K.add(tube([[0, -0.4, 0], [0.15, H * 0.35, 0.05], [0, H * 0.6, 0]], 0.36, 0.16, seg), { color: barkCol(BARK.oak, BARK.oak, 0, 3), sway: swayFn(H), leaf: 0 });
      const crownY = vase ? 7.6 : 6.4, R = vase ? 3.8 : 3.4;
      const nb = [7, 4, 1][lod];
      if (lod === 2) K.add(blob(R * 1.05, det, 3, vase ? 1.15 : 1, vase ? 0.72 : 0.85, vase ? 1.15 : 1, 0.22), { matrix: at(0, crownY, 0), color: leafCol(0.7, 1.0, crownY - R, crownY + R), sway: swayFn(H), leaf: 1 });
      else {
        K.add(blob(R * 0.8, det, 1, 1.05, vase ? 0.7 : 0.85, 1.05, 0.25), { matrix: at(0, crownY, 0), color: leafCol(0.66, 0.95, crownY - R, crownY + R), sway: swayFn(H), leaf: 1 });
        for (let i = 0; i < nb; i++) {
          const a = i / nb * TAU + rnd() * 0.6, rr = R * (0.55 + rnd() * 0.25), y = crownY + (rnd() - 0.35) * R * (vase ? 0.5 : 0.8);
          K.add(blob(R * (0.42 + rnd() * 0.2), det, rnd() * 9, 1.1, 0.85, 1.1, 0.3), { matrix: at(Math.sin(a) * rr * (vase ? 1.2 : 1), y, Math.cos(a) * rr * (vase ? 1.2 : 1)), color: leafCol(0.7, 1.08, crownY - R, crownY + R), sway: swayFn(H), leaf: 1 });
        }
      }
    } else if (sp === 3) {                            // birch: slender white trunk with dark marks, narrow oval crown
      const H = 10;
      K.add(tube([[0, -0.4, 0], [0.2, 5, 0.1], [0.1, H * 0.85, 0]], 0.16, 0.06, seg), { color: (x, y, z) => (vnoise(y * 2.2, x * 9 + z * 9, 5) > 0.72 ? BARK.birchDark : BARK.birch), sway: swayFn(H), leaf: 0 });
      const nb = [5, 3, 1][lod];
      for (let i = 0; i < nb; i++) { const y = 5.6 + i * (3.6 / Math.max(1, nb - 1)) * (lod === 2 ? 0 : 1); K.add(blob(lod === 2 ? 1.9 : 1.35 - i * 0.08, det, rnd() * 9, 1, lod === 2 ? 1.8 : 1.15, 1, 0.3), { matrix: at((rnd() - 0.5) * 0.7, lod === 2 ? 7.4 : y, (rnd() - 0.5) * 0.7), color: leafCol(0.78, 1.1, 5, 10), sway: swayFn(H), leaf: 1 }); }
    } else {                                          // sculpted garden pine: low curved trunk, horizontal cloud pads
      const H = 5.2;
      K.add(tube([[0, -0.3, 0], [0.5, 1.4, 0.2], [0.2, 2.8, 0.5], [0.9, 4.2, 0.3]], 0.3, 0.12, seg), { color: barkCol(BARK.pineLow, BARK.pine, 0.5, 4), sway: swayFn(H), leaf: 0 });
      const pads = [[1.0, 4.6, 0.3, 1.5], [-0.9, 3.2, 0.6, 1.25], [1.7, 2.5, -0.6, 1.1], [0.1, 3.7, -1.1, 1.0], [-0.2, 2.1, 1.4, 0.9], [1.9, 3.6, 1.0, 0.85]];
      for (let i = 0; i < pads.length - (lod === 2 ? 4 : lod === 1 ? 1 : 0); i++) {
        const p = pads[i];
        if (lod === 0) K.add(tube([[0.4, p[1] - 0.6, 0.3], [p[0], p[1] - 0.15, p[2]]], 0.07, 0.04, 4), { color: BARK.pine, sway: swayFn(H), leaf: 0 });
        K.add(blob(p[3], det, i * 1.7, 1.35, 0.42, 1.35, 0.18), { matrix: at(p[0], p[1], p[2]), color: leafCol(0.72, 1.05, p[1] - 0.4, p[1] + 0.5), sway: swayFn(H), leaf: 1 });
      }
    }
    return K.build();
  }
  /** a crown clump of the far forest skin (several crowns, one instance): kind 0 conifer, 1 broadleaf; footprint ≈ 1 × 1 */
  function clumpGeometry(kind, lod) {
    const K = new Kit(['leaf']);
    const rnd = mulberry(77 + kind * 5 + lod * 11);
    const n = lod ? 3 : 5;
    for (let i = 0; i < n; i++) {
      const x = (rnd() - 0.5) * 0.7, z = (rnd() - 0.5) * 0.7, s = 0.24 + rnd() * 0.12;
      if (kind === 0) { const g = new THREE.ConeGeometry(s, s * 2.6, lod ? 5 : 6, 1); K.add(g, { matrix: at(x, s * 1.3 + 0.08, z, 0, rnd() * 3), color: (px, py) => { const t = clamp(py / (s * 2.6) + 0.5, 0, 1); return [0.7 + 0.35 * t, 0.7 + 0.35 * t, 0.7 + 0.35 * t]; }, leaf: 1 }); }
      else K.add(blob(s * 1.15, 0, rnd() * 9, 1, 0.8, 1, 0.25), { matrix: at(x, s * 0.95, z), color: (px, py) => { const t = clamp(py / s, 0, 1); return [0.72 + 0.32 * t, 0.72 + 0.32 * t, 0.72 + 0.32 * t]; }, leaf: 1 });
    }
    return K.build();
  }
  /** a displaced boulder, centre on the ground, radius ≈ 1, a little flattened */
  function rockGeometry(seed, detail) {
    const g = blob(1, detail, seed, 1, 0.66, 1, 0.32);
    const p = g.attributes.position.array, uv = new Float32Array(p.length / 3 * 2);
    for (let i = 0; i < p.length / 3; i++) { uv[i * 2] = p[i * 3] * 0.8 + p[i * 3 + 2] * 0.4; uv[i * 2 + 1] = p[i * 3 + 1] * 0.8 + p[i * 3 + 2] * 0.3; }
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    const col = new Float32Array(p.length);
    for (let i = 0; i < p.length; i += 3) { const v = 0.75 + 0.4 * vnoise(p[i] * 2 + seed, p[i + 2] * 2 + p[i + 1], 9) + 0.12 * smooth(0.2, 0.6, p[i + 1]); col[i] = v * 0.98; col[i + 1] = v * 0.96; col[i + 2] = v * 0.9; }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.translate(0, 0.12, 0);
    return g;
  }
  // ------------------------------------------------------------------ the mountain mesh (4 nested rings, crack-free)
  const RINGS = {
    high: [4, 8, 16, 32], medium: [4, 16, 32, 64], low: [8, 32, 64, 128],
    rects: [{ x0: -224, z0: -192, x1: 224, z1: 224 }, { x0: -384, z0: -384, x1: 384, z1: 384 }, { x0: -768, z0: -768, x1: 768, z1: 768 }, { x0: -1152, z0: -1152, x1: 1152, z1: 1152 }],
  };
  const SEAM_DROP = 0.3;                  // the landscape begins 2 m inside the bounds and this much lower (CONTRACT, Addendum 3)
  /** builds the lattice heights + the mesh data. Returns { geo, sample(x, z) → y | NaN, lattices: [{ c, x0, z0, nx, nz, h }] } */
  function mountainData(C, q) {
    const cs = RINGS[q] || RINGS.high, B = C.bounds;
    const cache = new Map();
    const H = (x, z) => { const k = x * 65536 + z; let v = cache.get(k); if (v === undefined) { v = land(C, x, z); cache.set(k, v); } return v; };
    // the hole of the first ring: the lattice-aligned rectangle at least 2 m inside the bounds
    const R1 = RINGS.rects[0], c1 = cs[0];
    const hole0 = { x0: R1.x0 + Math.ceil((B.minX + 2 - R1.x0) / c1) * c1, x1: R1.x1 - Math.ceil((R1.x1 - (B.maxX - 2)) / c1) * c1,
      z0: R1.z0 + Math.ceil((B.minZ + 2 - R1.z0) / c1) * c1, z1: R1.z1 - Math.ceil((R1.z1 - (B.maxZ - 2)) / c1) * c1 };
    const pos = [], idx = [], lattices = [];
    let base = 0;
    for (let k = 0; k < 4; k++) {
      const c = cs[k], R = RINGS.rects[k], hole = k === 0 ? hole0 : RINGS.rects[k - 1], next = k < 3 ? cs[k + 1] : 0;
      const nx = Math.round((R.x1 - R.x0) / c), nz = Math.round((R.z1 - R.z0) / c);
      const vid = new Int32Array((nx + 1) * (nz + 1)).fill(-1);
      const hl = new Float32Array((nx + 1) * (nz + 1)).fill(NaN);
      const inHole = (i, j) => { const x = R.x0 + (i + 0.5) * c, z = R.z0 + (j + 0.5) * c; return x > hole.x0 && x < hole.x1 && z > hole.z0 && z < hole.z1; };
      const vert = (i, j) => {
        const o = j * (nx + 1) + i;
        if (vid[o] >= 0) return vid[o];
        const x = R.x0 + i * c, z = R.z0 + j * c;
        let y;
        const onX = i === 0 || i === nx, onZ = j === 0 || j === nz;
        if (next && (onX || onZ)) {                    // outer border: lie on the coarser ring's edge (no T-junction cracks)
          if (onZ && !onX && ((x % next) + next) % next !== 0) { const xa = Math.floor(x / next) * next; y = lerp(H(xa, z), H(xa + next, z), (x - xa) / next); }
          else if (onX && !onZ && ((z % next) + next) % next !== 0) { const za = Math.floor(z / next) * next; y = lerp(H(x, za), H(x, za + next), (z - za) / next); }
          else y = H(x, z);
        } else y = H(x, z);
        hl[o] = y;
        vid[o] = base++;
        pos.push(x, y - SEAM_DROP, z);
        return vid[o];
      };
      for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
        if (inHole(i, j)) continue;
        const a = vert(i, j), b = vert(i + 1, j), d = vert(i, j + 1), e = vert(i + 1, j + 1);
        // split along the shorter diagonal of the heights (less folding on ridges)
        if (Math.abs(hl[j * (nx + 1) + i] - hl[(j + 1) * (nx + 1) + i + 1]) < Math.abs(hl[j * (nx + 1) + i + 1] - hl[(j + 1) * (nx + 1) + i])) idx.push(a, d, e, a, e, b);
        else idx.push(a, d, b, b, d, e);
      }
      lattices.push({ c, x0: R.x0, z0: R.z0, nx, nz, h: hl, hole });
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
    geo.computeVertexNormals();
    // the finest lattice that holds (x, z) answers with a bilinear sample (NaN where none: inside the site)
    const sample = (x, z) => {
      for (const L of lattices) {
        const fx = (x - L.x0) / L.c, fz = (z - L.z0) / L.c;
        if (fx < 0 || fz < 0 || fx >= L.nx || fz >= L.nz) continue;
        const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j, w = L.nx + 1;
        const a = L.h[j * w + i], b = L.h[j * w + i + 1], d = L.h[(j + 1) * w + i], e = L.h[(j + 1) * w + i + 1];
        if (a !== a || b !== b || d !== d || e !== e) continue;
        return lerp(lerp(a, b, u), lerp(d, e, u), v);
      }
      return NaN;
    };
    return { geo, sample, lattices, calls: cache.size };
  }
  /** per-vertex shading inputs (aMix: rock, gravel, cover, conifer) + flat colours (low) */
  function mountainShading(C, geo, low) {
    const p = geo.attributes.position.array, n = geo.attributes.normal.array, N = p.length / 3;
    const mix = new Float32Array(N * 4), col = new Float32Array(N * 3);
    const river = C.byId && C.byId('RIVER');
    const forests = (C.elements || []).filter((e) => e.type === 'forest' && e.poly).map((e) => ({ e, box: polyBox(e.poly) }));
    const axes = axesOf(C);
    const roads = (C.elements || []).filter((e) => e.type === 'road' && e.pts);
    const cF = lin('#2f4a1e'), cC = lin('#203519'), cR = lin('#6b6457'), cG = lin('#8f8a78'), cM = lin('#55673a');
    for (let i = 0; i < N; i++) {
      const x = p[i * 3], y = p[i * 3 + 1], z = p[i * 3 + 2], ny = n[i * 3 + 1];
      const slope = 1 - ny;
      let gravel = 0, cover = 0.95, conif = 0.42, rock = 0;
      if (river) { const r = polyNear(x, z, river.pts); gravel = Math.max(gravel, 1 - smooth(river.w / 2 + 1, river.w / 2 + 7, r.d)); cover = Math.min(cover, smooth(river.w / 2 + 4, river.w / 2 + 16, r.d)); }
      for (const A of axes) {
        if (A.id === 'E') continue;
        const r = polyNear(x, z, A.pts);
        if (r.s < A.s0) continue;
        gravel = Math.max(gravel, 1 - smooth(9, 16, r.d));
        cover = Math.min(cover, 0.15 + 0.85 * smooth(16, 46, r.d));
      }
      for (const R of roads) { const r = polyNear(x, z, R.pts); if (r.d < 14) cover = Math.min(cover, smooth(6, 14, r.d)); }
      for (const F of forests) {
        const b = F.box;
        if (x < b.x0 || x > b.x1 || z < b.z0 || z > b.z1) continue;
        if (pointInPoly(x, z, F.e.poly)) { const sp = F.e.species || {}; conif = (sp.pine || 0) + (sp.pine_sculpted || 0) * 0.5 + 0.1; if (F.e.cliffs) rock = Math.max(rock, smooth(0.32, 0.55, slope)); break; }
      }
      conif = clamp(conif + smooth(140, 360, y) * 0.25 + (fbm3(x / 110, z / 110, 61) - 0.5) * 0.5, 0, 1);
      if (outside(x, z, C.bounds) < 1e-9) cover *= 0.0;                      // inside the site the ground is complex-ground's
      mix[i * 4] = rock; mix[i * 4 + 1] = gravel; mix[i * 4 + 2] = cover; mix[i * 4 + 3] = conif;
      if (low) {
        const f = [lerp(cF[0], cC[0], conif), lerp(cF[1], cC[1], conif), lerp(cF[2], cC[2], conif)];
        const g = [lerp(cM[0], cG[0], gravel), lerp(cM[1], cG[1], gravel), lerp(cM[2], cG[2], gravel)];
        const rk = clamp(rock + smooth(0.5, 0.75, slope), 0, 1) * (1 - cover * 0.5);
        const v = 0.85 + 0.3 * vnoise(x / 23, z / 23, 62);
        for (let c = 0; c < 3; c++) col[i * 3 + c] = lerp(lerp(g[c], f[c], cover), cR[c], rk) * v;
      } else { col[i * 3] = 1; col[i * 3 + 1] = 1; col[i * 3 + 2] = 1; }
    }
    geo.setAttribute('aMix', new THREE.BufferAttribute(mix, 4));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  }
  function mountainMaterial(low, U) {
    if (low) return new THREE.MeshLambertMaterial({ vertexColors: true });
    const m = new THREE.MeshStandardMaterial({ vertexColors: false, roughness: 0.93, metalness: 0, envMapIntensity: 0.55 });
    return patch(m, 'mountain', {
      uniforms: U,
      vhead: 'attribute vec4 aMix; varying vec4 vMix; varying vec3 vCxWN; ' + WP_VARY,
      vbegin: 'vMix = aMix; vCxWN = normalize(mat3(modelMatrix) * objectNormal);',
      vend: WP_CALC,
      fhead: 'varying vec4 vMix; varying vec3 vCxWN; ' + WP_VARY + GLSL_COMMON + GLSL_CELL + 'float cxDome; float cxCover; vec2 cxToF; float cxDet;',
      fcolor: `{
        vec3 Nw = normalize(vCxWN); float slope = 1.0 - Nw.y;
        vec2 cp = vCxWP.xz / 5.2 + vec2(cxN(vCxWP.xz / 13.0), cxN(vCxWP.zx / 13.0 + 4.0)) * 0.9;
        vec4 c = cxCell(cp, cxToF);
        float fw = length(fwidth(cp));
        cxDet = 1.0 - smoothstep(0.25, 0.9, fw);
        cxDome = 1.0 - clamp(c.x * c.x, 0.0, 1.0);
        float gap = smoothstep(0.0, 0.32, c.y - c.x) * (1.0 - smoothstep(0.85, 1.15, c.x));
        cxCover = vMix.z * (1.0 - smoothstep(0.55, 0.8, slope));
        float patchN = cxFbm(vCxWP.xz / 85.0);
        float conif = clamp(vMix.w + (patchN - 0.5) * 0.5, 0.0, 1.0);
        float isCon = step(c.z, conif);
        float hue = fract(c.z * 13.7);
        float clus = cxFbm(vCxWP.xz / 38.0);
        vec3 broad = mix(vec3(0.058, 0.094, 0.024), vec3(0.1, 0.136, 0.036), hue) * mix(0.78, 1.15, clus);
        vec3 con = mix(vec3(0.03, 0.054, 0.022), vec3(0.048, 0.076, 0.03), fract(hue * 7.3)) * mix(0.85, 1.1, clus);
        vec3 crown = mix(broad, con, isCon);
        crown *= mix(0.48, 1.1, cxDome);
        crown += isCon * vec3(0.02, 0.028, 0.007) * smoothstep(0.75, 1.0, cxDome);
        crown *= mix(0.38, 1.0, gap);
        vec3 avg = mix(mix(vec3(0.058, 0.094, 0.024), vec3(0.1, 0.136, 0.036), 0.5), vec3(0.039, 0.065, 0.026), conif) * mix(0.66, 0.8, clus);
        crown = mix(avg, crown, cxDet);
        vec3 rock = vec3(0.15, 0.135, 0.112) * (0.7 + 0.55 * cxFbm(vCxWP.xz / 7.0 + vCxWP.y / 5.0));
        rock *= 0.82 + 0.36 * cxN(vec2(vCxWP.y * 0.9, (vCxWP.x + vCxWP.z) * 0.04));
        vec3 gravel = vec3(0.34, 0.32, 0.28) * (0.75 + 0.45 * cxN(vCxWP.xz * 1.3));
        vec3 meadow = vec3(0.11, 0.135, 0.045) * (0.8 + 0.4 * cxFbm(vCxWP.xz / 5.0));
        vec3 ground = mix(meadow, gravel, vMix.y);
        float rockW = clamp(vMix.x + smoothstep(0.42, 0.7, slope), 0.0, 1.0) * (1.0 - cxCover * 0.55);
        vec3 col = mix(mix(ground, crown, cxCover), rock, rockW);
        diffuseColor.rgb = col;
      }`,
      fnormal: `{
        float k = 1.25 * cxCover * cxDet;
        vec3 Nw = normalize(vCxWN);
        vec3 nW = normalize(Nw + vec3(-cxToF.x, 0.0, -cxToF.y) * k * (0.35 + cxDome));
        normal = normalize((viewMatrix * vec4(nW, 0.0)).xyz);
      }`,
    });
  }

  // ------------------------------------------------------------------ instanced trees with levels of detail
  const SP_COL = {           // foliage colours (linear) by plan species; the instance colour multiplies the vertex shades
    pine: [0.068, 0.098, 0.044], oak: [0.08, 0.124, 0.038], maple: [0.105, 0.15, 0.044], zelkova: [0.09, 0.138, 0.05],
    birch: [0.118, 0.168, 0.06], pine_sculpted: [0.05, 0.084, 0.04],
  };
  function treeMaterial(low, U, kind) {
    if (low) return new THREE.MeshLambertMaterial({ vertexColors: true });
    const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.86, metalness: 0, envMapIntensity: 0.5 });
    return patch(m, 'tree-' + kind, {
      uniforms: U,
      vhead: 'attribute float aSway; attribute float aLeaf; varying float vLeaf; uniform float uTime; uniform vec2 uWind; uniform float uWindAmp; ' + WP_VARY,
      vbegin: `{
        vec3 ip = vec3(0.0);
#ifdef USE_INSTANCING
        ip = instanceMatrix[3].xyz;
#endif
        float ph = dot(ip.xz, vec2(0.131, 0.173));
        float w = (sin(uTime * 1.05 + ph) * 0.6 + sin(uTime * 1.83 + ph * 1.7) * 0.3 + sin(uTime * 3.1 + ph * 2.3) * 0.1 * aLeaf) * uWindAmp;
        transformed.xz += uWind * (w * 0.22 * aSway);
        vLeaf = aLeaf;
      }`,
      vcolor: `
#if defined( USE_COLOR ) || defined( USE_INSTANCING_COLOR )
  vColor = vec3( 1.0 );
#endif
#ifdef USE_COLOR
  vColor *= color;
#endif
#ifdef USE_INSTANCING_COLOR
  vColor.xyz *= mix(vec3(1.0), instanceColor.xyz, aLeaf);
#endif`,
      vend: WP_CALC,
      fhead: 'varying float vLeaf; ' + WP_VARY + GLSL_COMMON,
      fcolor: `{
        float n1 = cxN3(vCxWP * 1.7), n2 = cxN3(vCxWP * 4.3 + 7.0);
        float leafy = mix(1.0, 0.62 + 0.55 * n1 * (0.7 + 0.6 * n2), vLeaf);
        diffuseColor.rgb *= leafy;
        diffuseColor.rgb += vLeaf * vec3(0.012, 0.016, 0.0) * smoothstep(0.6, 0.95, n1);
      }`,
    });
  }
  /** a family of instanced trees: per species × level an InstancedMesh; assign() re-buckets by camera distance */
  class TreeSet {
    constructor(root, list, opt) {
      this.root = root; this.list = list; this.opt = opt; this.meshes = []; this.last = null; this.dist = opt.dist;
      const n = list.length;
      this.mats = new Float32Array(n * 16); this.cols = new Float32Array(n * 3);
      const m = new THREE.Matrix4(), qt = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), s = new THREE.Vector3();
      list.forEach((t, i) => {
        e.set((hash2(i, 1, 9) - 0.5) * 0.06, t.rot, (hash2(i, 2, 9) - 0.5) * 0.06);
        qt.setFromEuler(e); v.set(t.x, t.y - 0.15, t.z); const sc = t.s * (opt.scale || 1); s.set(sc, sc * (0.92 + 0.16 * hash2(i, 3, 9)), sc);
        m.compose(v, qt, s); m.toArray(this.mats, i * 16);
        const c = SP_COL[t.kind] || SP_COL.pine, k = 0.85 + 0.3 * (t.v != null ? t.v : 0.5), hs = (hash2(i, 4, 9) - 0.5) * 0.12;
        this.cols[i * 3] = c[0] * k * (1 + hs); this.cols[i * 3 + 1] = c[1] * k; this.cols[i * 3 + 2] = c[2] * k * (1 - hs);
      });
      this.bySp = new Map();
      list.forEach((t, i) => { let a = this.bySp.get(t.sp); if (!a) { a = []; this.bySp.set(t.sp, a); } a.push(i); });
      const lods = opt.lods;
      for (const [sp, ids] of this.bySp) {
        const row = [];
        for (const lod of lods) {
          const geo = opt.geometry(sp, lod);
          const mesh = new THREE.InstancedMesh(geo, opt.material, ids.length);
          mesh.name = `cxl-tree-${SP_NAMES[sp]}-${lod}`;
          mesh.count = 0; mesh.frustumCulled = false;
          mesh.castShadow = lod < 2 && !opt.low; mesh.receiveShadow = !opt.low;
          mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
          mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(ids.length * 3), 3);
          mesh.userData.tris = (geo.index ? geo.index.count : geo.attributes.position.count) / 3;
          root.add(mesh);
          row.push(mesh); this.meshes.push(mesh);
        }
        this.bySp.set(sp, { ids, row });
      }
    }
    /** re-bucket by distance to the camera (local coordinates); only when the camera moved > 3 m */
    assign(cx, cz, force) {
      if (!force && this.last && Math.hypot(cx - this.last[0], cz - this.last[1]) < 3) return;
      this.last = [cx, cz];
      const d0 = this.dist[0] * this.dist[0], d1 = this.dist[1] * this.dist[1], L = this.opt.lods.length;
      for (const { ids, row } of this.bySp.values()) {
        const cnt = new Int32Array(L);
        for (const i of ids) {
          const t = this.list[i], dx = t.x - cx, dz = t.z - cz, d2 = dx * dx + dz * dz;
          let l = L === 1 ? 0 : d2 < d0 ? 0 : d2 < d1 || L === 2 ? 1 : 2;
          if (l >= L) l = L - 1;
          const mesh = row[l], k = cnt[l]++;
          mesh.instanceMatrix.array.set(this.mats.subarray(i * 16, i * 16 + 16), k * 16);
          mesh.instanceColor.array.set(this.cols.subarray(i * 3, i * 3 + 3), k * 3);
        }
        row.forEach((m, l) => { m.count = cnt[l]; m.instanceMatrix.needsUpdate = true; m.instanceColor.needsUpdate = true; });
      }
    }
    dispose() { for (const m of this.meshes) { m.geometry.dispose(); m.dispose && m.dispose(); m.removeFromParent(); } this.meshes = []; }
  }
  // ------------------------------------------------------------------ water (the river + the fountain basin share one mesh)
  /** the river centre line: the plan's river, continued along the valley axes beyond the site ([[x, z, waterY], …]) */
  function riverLine(C) {
    const river = C.byId && C.byId('RIVER');
    if (!river) return null;
    const A = axesOf(C), N = A.find((a) => a.id === 'N'), S = A.find((a) => a.id === 'S');
    const head = N ? N.pts.slice(2).reverse().map((p) => [p[0], p[1], p[2]]) : [];
    const tail = S ? S.pts.slice(2).map((p) => [p[0], p[1], p[2]]) : [];
    return { w: river.w, pts: head.concat(river.pts.map((p) => [p[0], p[1], p[2]]), tail), rocks: river.rocks || [] };
  }
  /** riffles (small rapids) along the river line: every 55–95 m (deterministic) — { s, x, z, nx, nz, k } */
  function riffles(RL) {
    const out = [], P = RL.pts;
    let acc = 0, next = 40, n = 0;
    for (let i = 0; i < P.length - 1; i++) {
      const a = P[i], b = P[i + 1], l = Math.hypot(b[0] - a[0], b[1] - a[1]);
      while (next < acc + l) {
        const t = (next - acc) / l;
        out.push({ s: next, x: lerp(a[0], b[0], t), z: lerp(a[1], b[1], t), y: lerp(a[2], b[2], t), nx: -(b[1] - a[1]) / l, nz: (b[0] - a[0]) / l, k: 0.6 + 0.4 * hash2(n, 1, 707) });
        next += 55 + hash2(n++, 2, 707) * 40;
      }
      acc += l;
    }
    return out;
  }
  function waterMaterial(low, U) {
    if (low) return new THREE.MeshLambertMaterial({ color: new THREE.Color('#4d6f6a'), vertexColors: false });
    const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.06, metalness: 0, transparent: true, envMapIntensity: 1.15, depthWrite: true });
    return patch(m, 'water', {
      uniforms: U,
      vhead: 'attribute vec2 aFlow; attribute float aDepth; attribute float aFoam; varying vec2 vFlow; varying float vDepth; varying float vFoam; ' + WP_VARY,
      vbegin: 'vFlow = aFlow; vDepth = aDepth; vFoam = aFoam;',
      vend: WP_CALC,
      fhead: 'uniform float uTime; varying vec2 vFlow; varying float vDepth; varying float vFoam; ' + WP_VARY + GLSL_COMMON + 'vec2 cxQ; vec2 cxDir; vec2 cxSide; float cxSpd; float cxFoamV;',
      fcolor: `{
        cxSpd = length(vFlow); cxDir = cxSpd > 1e-4 ? vFlow / cxSpd : vec2(0.0, 1.0); cxSide = vec2(-cxDir.y, cxDir.x);
        cxQ = vec2(dot(vCxWP.xz, cxDir), dot(vCxWP.xz, cxSide));
        float t = uTime;
        float d = max(vDepth, 0.0);
        vec3 shallow = vec3(0.24, 0.235, 0.17), mid = vec3(0.045, 0.12, 0.1), deep = vec3(0.012, 0.05, 0.052);
        vec3 col = mix(deep, mid, exp(-d * 0.9));
        col = mix(col, shallow * (0.8 + 0.4 * cxN(vCxWP.xz * 0.9)), exp(-d * 2.6));
        float s1 = cxN(vec2(cxQ.x * 0.22 - t * cxSpd * 1.1, cxQ.y * 2.4));
        float s2 = cxN(vec2(cxQ.x * 0.7 - t * cxSpd * 1.9, cxQ.y * 5.0) + 3.1);
        cxFoamV = smoothstep(0.55, 0.9, s1 * 0.7 + s2 * 0.5 + vFoam * 0.55 - 0.15) * clamp(vFoam * 1.6, 0.0, 1.0);
        col = mix(col, vec3(0.78, 0.8, 0.79), cxFoamV);
        diffuseColor.rgb = col;
        diffuseColor.a = clamp(mix(0.42, 0.93, smoothstep(0.03, 1.3, d)) + cxFoamV * 0.4, 0.0, 1.0);
      }`,
      fnormal: `{
        float t = uTime, e = 0.12;
        vec2 q1 = cxQ * vec2(0.5, 0.85) - vec2(t * cxSpd * 0.9, 0.0);
        vec2 q2 = cxQ * vec2(1.35, 1.8) - vec2(t * cxSpd * 1.6, t * 0.04);
        float h1 = cxN(q1), h2 = cxN(q2);
        vec2 g = vec2(cxN(q1 + vec2(e, 0.0)) - h1, cxN(q1 + vec2(0.0, e)) - h1) / e * 0.3 + vec2(cxN(q2 + vec2(e, 0.0)) - h2, cxN(q2 + vec2(0.0, e)) - h2) / e * 0.16;
        g *= (0.45 + 0.9 * clamp(cxSpd, 0.0, 1.4)) * (1.0 - cxFoamV * 0.5);
        vec2 gW = g.x * cxDir + g.y * cxSide;
        vec3 nW = normalize(vec3(-gW.x, 1.0, -gW.y));
        normal = normalize((viewMatrix * vec4(nW, 0.0)).xyz);
      }`,
      frough: 'roughnessFactor = mix(0.05, 0.55, cxFoamV);',
    });
  }
  /** ribbon along the river line + the fountain disc; attributes aFlow (dir × speed), aDepth, aFoam */
  function waterGeometry(C, q, hAt, rocks, fountain) {
    const RL = riverLine(C);
    const pos = [], flow = [], depth = [], foam = [], idx = [];
    if (RL) {
      const step = q === 'high' ? 3 : q === 'medium' ? 5 : 10, across = q === 'low' ? 3 : 9;
      const P = RL.pts, hw = RL.w / 2 + 1.0;
      // resample by arc length
      const S = [];
      for (let i = 0; i < P.length - 1; i++) {
        const a = P[i], b = P[i + 1], l = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.round(l / step));
        for (let k = 0; k < n; k++) { const t = k / n; S.push([lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t), (b[0] - a[0]) / l, (b[1] - a[1]) / l, (a[2] - b[2]) / l]); }
      }
      const L = P[P.length - 1], L2 = P[P.length - 2], ll = Math.hypot(L[0] - L2[0], L[1] - L2[1]);
      S.push([L[0], L[1], L[2], (L[0] - L2[0]) / ll, (L[1] - L2[1]) / ll, (L2[2] - L[2]) / ll]);
      // smooth the tangents (no kinks at the joints); riffles: faster, white water across the river
      const inWater = rocks.filter((r) => r.wet);
      const RF = riffles(RL);
      let along = 0;
      S.forEach((s, i) => {
        if (i) along += Math.hypot(s[0] - S[i - 1][0], s[1] - S[i - 1][1]);
        let rif = 0;
        for (const r of RF) { const d = along - r.s; if (Math.abs(d) < 14) rif = Math.max(rif, r.k * Math.exp(-(d * d) / 18)); }
        const a = S[Math.max(0, i - 2)], b = S[Math.min(S.length - 1, i + 2)];
        let dx = b[0] - a[0], dz = b[1] - a[1]; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
        const nx = -dz, nz = dx;
        const fall = s[5];
        for (let j = 0; j < across; j++) {
          const u = j / (across - 1) * 2 - 1, x = s[0] + nx * u * hw, z = s[1] + nz * u * hw;
          const y = s[2];
          pos.push(x, y, z);
          const bed = hAt(x, z);
          const dep = fin(bed) ? y - bed : 1.2;
          depth.push(dep);
          const spd = (0.5 + 4 * fall + 0.9 * rif) * (1 - 0.55 * u * u);
          flow.push(dx * spd, dz * spd);
          let f = rif * (0.75 + 0.25 * vnoise(u * 3 + i * 0.3, i * 0.21, 708)) + (1 - smooth(0.05, 0.45, dep)) * 0.45 + smooth(0.75, 1, Math.abs(u)) * 0.2;
          for (const r of inWater) { const dd = Math.hypot(x - r.x, z - r.z) - r.r; if (dd < 2.6) f = Math.max(f, 1 - dd / 2.6 + (dd < 0 ? 0.2 : 0)); }
          foam.push(clamp(f, 0, 1.2));
        }
      });
      for (let i = 0; i < S.length - 1; i++) for (let j = 0; j < across - 1; j++) {
        const a = i * across + j, b = a + 1, c = a + across, d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
    }
    if (fountain) {                                     // the fountain basin: a disc with a slow outward flow
      const base = pos.length / 3, F = fountain, rings = 6, segs = q === 'low' ? 16 : 40;
      pos.push(F.x, F.y, F.z); flow.push(0, 0); depth.push(0.35); foam.push(0.9);
      for (let r = 1; r <= rings; r++) for (let s = 0; s < segs; s++) {
        const a = s / segs * TAU, rr = F.r * r / rings, x = F.x + Math.cos(a) * rr, z = F.z + Math.sin(a) * rr;
        pos.push(x, F.y, z); flow.push(Math.cos(a) * 0.12, Math.sin(a) * 0.12); depth.push(0.32);
        const jet = Math.abs(rr - F.jetR) < 0.5 || rr < 0.9 ? 0.9 : 0.15; foam.push(jet);
      }
      for (let s = 0; s < segs; s++) idx.push(base, base + 1 + (s + 1) % segs, base + 1 + s);
      for (let r = 1; r < rings; r++) for (let s = 0; s < segs; s++) {
        const a = base + 1 + (r - 1) * segs + s, b = base + 1 + (r - 1) * segs + (s + 1) % segs, c = a + segs, d = b + segs;
        idx.push(a, d, c, a, b, d);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array(pos.length).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
    g.setAttribute('aFlow', new THREE.Float32BufferAttribute(flow, 2));
    g.setAttribute('aDepth', new THREE.Float32BufferAttribute(depth, 1));
    g.setAttribute('aFoam', new THREE.Float32BufferAttribute(foam, 1));
    g.setIndex(pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
    g.computeBoundingSphere(); g.computeBoundingBox();
    return g;
  }
  function rockMaterial(low, U) {
    if (low) return new THREE.MeshLambertMaterial({ vertexColors: true, color: new THREE.Color('#8d877b') });
    const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0, color: 0xffffff });
    if (G.mat && G.mat.apply) { try { G.mat.apply(m, 'granite_stone', { tile: [2.2, 2.2], look: [150, 146, 136] }); } catch (e) { /* no pack: plain colour */ } }
    return patch(m, 'rock', {
      uniforms: U,
      vhead: 'attribute float aWY; varying float vWY; ' + WP_VARY,
      vbegin: 'vWY = aWY;',
      vend: WP_CALC,
      fhead: 'varying float vWY; ' + WP_VARY + GLSL_COMMON + 'float cxWet;',
      fcolor: `{
        float moss = smoothstep(0.55, 0.9, normalize(cross(dFdx(vCxWP), dFdy(vCxWP))).y) * smoothstep(0.45, 0.75, cxFbm(vCxWP.xz * 0.6));
        cxWet = smoothstep(vWY + 0.5, vWY + 0.04, vCxWP.y);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.06, 0.08, 0.03), moss * 0.6 * (1.0 - cxWet));
        diffuseColor.rgb *= mix(1.0, 0.42, cxWet);
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.7, 0.85, 0.8), smoothstep(vWY + 0.02, vWY - 0.3, vCxWP.y));
      }`,
      frough: 'roughnessFactor = mix(roughnessFactor, 0.16, cxWet);',
    });
  }

  // ------------------------------------------------------------------ the bus (also used by complex-ground in the valley)
  function labelTexture(text, sub) {
    const draw = (g, w, h) => {
      g.clearRect(0, 0, w, h);
      g.fillStyle = 'rgba(255,255,255,0)'; g.fillRect(0, 0, w, h);
      g.font = `700 ${Math.round(h * 0.5)}px "Pretendard", "Noto Sans KR", "Apple SD Gothic Neo", sans-serif`;
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.lineWidth = h * 0.08; g.strokeStyle = 'rgba(255,255,255,0.95)'; g.strokeText(text, w / 2, h * 0.43);
      g.fillStyle = '#1f5132'; g.fillText(text, w / 2, h * 0.43);
      if (sub) { g.font = `600 ${Math.round(h * 0.2)}px sans-serif`; g.fillStyle = '#2f6b45'; g.fillText(sub, w / 2, h * 0.84); }
    };
    if (G.gfx && G.gfx.canvasTexture) return G.gfx.canvasTexture(512, 128, draw, { srgb: true });
    if (typeof document === 'undefined') return null;
    const cv = document.createElement('canvas'); cv.width = 512; cv.height = 128; const g = cv.getContext('2d'); if (!g) return null; draw(g, 512, 128);
    const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
  }
  const RB = (w, h, d, r, seg = 2) => (ADDONS.RoundedBoxGeometry ? new ADDONS.RoundedBoxGeometry(w, h, d, seg, Math.min(r, w / 2 - 0.01, h / 2 - 0.01, d / 2 - 0.01)) : new THREE.BoxGeometry(w, h, d));
  /** the bus body as one geometry (vertex colours + aPaint = 0); kind 'shuttle' (9 m, friendly two-tone) | 'coach' (12 m) */
  function busGeometry(kind, low) {
    const K = new Kit(['paint']);
    const coach = kind === 'coach', Lg = coach ? 12 : 9, W = coach ? 2.5 : 2.4, Hb = coach ? 3.4 : 3.0;
    const body = coach ? lin('#f2f1ec') : lin('#f6efdc'), lower = coach ? lin('#2f4f7a') : lin('#2f7a4a'), glass = lin('#1b262d'), dark = lin('#141414'), rim = lin('#b7b7b2');
    const seg = low ? 1 : 3;
    K.add(RB(W, Hb - 0.55, Lg, coach ? 0.25 : 0.42, seg), { matrix: at(0, 0.55 + (Hb - 0.55) / 2, 0), color: (x, y) => (y < 1.25 ? lower : body) });
    // window band (slightly proud of the body), windscreen, rear window
    K.add(new THREE.BoxGeometry(W + 0.04, coach ? 1.05 : 1.0, Lg * 0.78), { matrix: at(0, coach ? 2.35 : 2.05, -Lg * 0.06), color: glass });
    K.add(new THREE.BoxGeometry(W * 0.9, coach ? 1.3 : 1.15, 0.06), { matrix: at(0, coach ? 2.25 : 1.95, Lg / 2 + 0.01, -0.12, 0, 0), color: glass });
    K.add(new THREE.BoxGeometry(W * 0.8, 0.8, 0.05), { matrix: at(0, 2.2, -Lg / 2 - 0.01), color: glass });
    // door (right side, front), headlights ("friendly eyes" on the shuttle), bumpers, roof unit
    K.add(new THREE.BoxGeometry(0.04, 2.1, 1.1), { matrix: at(W / 2 + 0.02, 1.55, Lg / 2 - 1.6), color: glass });
    for (const s of [-1, 1]) K.add(new THREE.CylinderGeometry(coach ? 0.13 : 0.2, coach ? 0.13 : 0.2, 0.06, low ? 6 : 14), { matrix: at(s * W * 0.33, 1.0, Lg / 2 + 0.03, PI / 2, 0, 0), color: lin('#fff6d8') });
    for (const s of [-1, 1]) K.add(new THREE.BoxGeometry(0.28, 0.16, 0.05), { matrix: at(s * W * 0.36, 1.05, -Lg / 2 - 0.03), color: lin('#c0221c') });
    K.add(RB(W + 0.08, 0.32, 0.3, 0.1, 1), { matrix: at(0, 0.62, Lg / 2 + 0.05), color: dark });
    K.add(RB(W + 0.08, 0.32, 0.3, 0.1, 1), { matrix: at(0, 0.62, -Lg / 2 - 0.05), color: dark });
    K.add(RB(W * 0.6, 0.28, Lg * 0.3, 0.1, 1), { matrix: at(0, Hb + 0.12, -Lg * 0.1), color: lin('#d9d8d2') });
    // wheels
    const wz = coach ? [Lg / 2 - 2.4, -Lg / 2 + 2.6, -Lg / 2 + 3.9] : [Lg / 2 - 1.9, -Lg / 2 + 2.0];
    for (const z of wz) for (const s of [-1, 1]) {
      K.add(new THREE.CylinderGeometry(0.5, 0.5, 0.32, low ? 8 : 18), { matrix: at(s * (W / 2 - 0.12), 0.5, z, 0, 0, PI / 2), color: dark });
      K.add(new THREE.CylinderGeometry(0.28, 0.28, 0.34, low ? 6 : 12), { matrix: at(s * (W / 2 - 0.1), 0.5, z, 0, 0, PI / 2), color: rim });
    }
    return K.build();
  }
  const SHARED = { busMat: null, users: 0 };
  function busMaterial(low) {
    if (low) return new THREE.MeshLambertMaterial({ vertexColors: true });
    return new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.34, metalness: 0.2, envMapIntensity: 0.9 });
  }
  /** public: a bus model. opts { kind: 'shuttle'|'coach', label, low } → THREE.Group (front +z, wheels on y 0). The group
   *  owns its geometry / material / texture: group.userData.dispose() frees them. */
  function bus(opts = {}) {
    const kind = opts.kind === 'coach' ? 'coach' : 'shuttle';
    const low = opts.low != null ? !!opts.low : (G.sys && G.sys.engine && G.sys.engine.preset && G.sys.engine.preset.name === 'low');
    const grp = new THREE.Group(); grp.name = 'cxl-bus-' + kind;
    const geo = busGeometry(kind, low), mat = busMaterial(low);
    const body = new THREE.Mesh(geo, mat); body.name = 'cxl-bus-body'; body.castShadow = !low; body.receiveShadow = !low;
    grp.add(body);
    const owned = [geo, mat];
    const text = opts.label != null ? String(opts.label) : (kind === 'shuttle' ? '만장대 셔틀' : '');
    if (text && !low) {
      const tex = labelTexture(text, kind === 'shuttle' ? '🏺 마을 ↔ 만장대 단지' : '');
      if (tex) {
        const L = kind === 'coach' ? 12 : 9, W = kind === 'coach' ? 2.5 : 2.4;
        const lm = new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.5, metalness: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
        const lg = new THREE.PlaneGeometry(L * 0.62, L * 0.62 / 4);
        for (const s of [-1, 1]) {
          const p = new THREE.Mesh(lg, lm); p.name = 'cxl-bus-label';
          p.position.set(s * (W / 2 + 0.035), 1.1, -L * 0.08); p.rotation.y = s * PI / 2;
          grp.add(p);
        }
        owned.push(tex, lm, lg);
      }
    }
    grp.userData.dispose = () => { for (const o of owned) if (o.dispose && !(o.isTexture && o.userData && o.userData.blank)) o.dispose(); };
    grp.userData.kind = kind;
    return grp;
  }

  // ------------------------------------------------------------------ cars (one instanced mesh per body style)
  function carGeometry(suv, low) {
    const K = new Kit(['paint']);
    const L = suv ? 4.6 : 4.5, W = 1.82, seg = low ? 1 : 2;
    const glass = lin('#151c22'), dark = lin('#121212'), rim = lin('#a9aaa6'), trim = lin('#2a2a2a');
    K.add(RB(W, suv ? 0.85 : 0.72, L, 0.2, seg), { matrix: at(0, (suv ? 0.85 : 0.72) / 2 + 0.3, 0), color: [1, 1, 1], paint: 1 });
    const ch = suv ? 0.72 : 0.6, cl = suv ? 2.7 : 2.3;
    K.add(RB(W * 0.86, ch, cl, 0.18, seg), { matrix: at(0, (suv ? 1.15 : 1.02) + ch / 2 - 0.02, suv ? -0.25 : -0.15), color: [1, 1, 1], paint: 1 });
    K.add(new THREE.BoxGeometry(W * 0.875, ch * 0.62, cl * 0.92), { matrix: at(0, (suv ? 1.15 : 1.02) + ch * 0.45, suv ? -0.25 : -0.15), color: glass, paint: 0 });
    for (const s of [-1, 1]) K.add(new THREE.BoxGeometry(0.34, 0.12, 0.05), { matrix: at(s * 0.6, 0.78, L / 2 + 0.005), color: lin('#f1efe2'), paint: 0 });
    for (const s of [-1, 1]) K.add(new THREE.BoxGeometry(0.34, 0.12, 0.05), { matrix: at(s * 0.62, 0.84, -L / 2 - 0.005), color: lin('#9a1712'), paint: 0 });
    K.add(new THREE.BoxGeometry(W + 0.02, 0.18, 0.14), { matrix: at(0, 0.38, L / 2 + 0.01), color: trim, paint: 0 });
    K.add(new THREE.BoxGeometry(W + 0.02, 0.18, 0.14), { matrix: at(0, 0.38, -L / 2 - 0.01), color: trim, paint: 0 });
    for (const z of [L / 2 - 0.85, -L / 2 + 0.85]) for (const s of [-1, 1]) {
      K.add(new THREE.CylinderGeometry(0.33, 0.33, 0.24, low ? 8 : 14), { matrix: at(s * (W / 2 - 0.1), 0.33, z, 0, 0, PI / 2), color: dark, paint: 0 });
      K.add(new THREE.CylinderGeometry(0.19, 0.19, 0.26, low ? 6 : 10), { matrix: at(s * (W / 2 - 0.09), 0.33, z, 0, 0, PI / 2), color: rim, paint: 0 });
    }
    return K.build();
  }
  function carMaterial(low) {
    if (low) return patch(new THREE.MeshLambertMaterial({ vertexColors: true }), 'car-low', { vhead: 'attribute float aPaint;', vcolor: CAR_VCOLOR });
    const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.3, metalness: 0.35, envMapIntensity: 1.0 });
    return patch(m, 'car', { vhead: 'attribute float aPaint;', vcolor: CAR_VCOLOR });
  }
  const CAR_VCOLOR = `
#if defined( USE_COLOR ) || defined( USE_INSTANCING_COLOR )
  vColor = vec3( 1.0 );
#endif
#ifdef USE_COLOR
  vColor *= color;
#endif
#ifdef USE_INSTANCING_COLOR
  vColor.xyz *= mix(vec3(1.0), instanceColor.xyz, aPaint);
#endif`;

  // ------------------------------------------------------------------ contact shadows (one instanced soft disc; no texture)
  function shadowGeometry() {
    const segs = 20, pos = [0, 0, 0], col = [0, 0, 0, 1], idx = [];
    for (let r = 1; r <= 2; r++) for (let s = 0; s < segs; s++) { const a = s / segs * TAU, rr = r === 1 ? 0.55 : 1; pos.push(Math.cos(a) * rr, 0, Math.sin(a) * rr); col.push(0, 0, 0, r === 1 ? 0.7 : 0); }
    for (let s = 0; s < segs; s++) { const a = 1 + s, b = 1 + (s + 1) % segs; idx.push(0, b, a); idx.push(a, b, b + segs, a, b + segs, a + segs); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
    g.setIndex(idx);
    return g;
  }
  // ------------------------------------------------------------------ garden pieces
  /** a clipped hedge along a polyline (closed for the ring); profile ≈ 0.8 × 0.95 m with a lumpy top */
  function hedgeGeometry(lines, hAt, w = 0.8, h = 0.95) {
    const prof = [[-0.5, 0], [-0.53, 0.55], [-0.4, 0.9], [-0.12, 1.0], [0.12, 1.0], [0.4, 0.9], [0.53, 0.55], [0.5, 0]];
    const pos = [], col = [], idx = [];
    for (const L of lines) {
      const pts = L.pts, closed = !!L.closed, n = pts.length;
      const base = pos.length / 3;
      for (let i = 0; i < n; i++) {
        const a = pts[(i - 1 + n) % n], b = pts[(i + 1) % n], p = pts[i];
        let dx = (closed || (i > 0 && i < n - 1)) ? b[0] - a[0] : i === 0 ? pts[1][0] - p[0] : p[0] - pts[n - 2][0];
        let dz = (closed || (i > 0 && i < n - 1)) ? b[1] - a[1] : i === 0 ? pts[1][1] - p[1] : p[1] - pts[n - 2][1];
        const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
        const nx = -dz, nz = dx, y0 = hAt(p[0], p[1]) - 0.08;
        for (const [u, v] of prof) {
          const k = 1 + 0.12 * (vnoise(p[0] * 0.9 + u * 3, p[1] * 0.9 + v * 3, 71) - 0.5) * 2;
          pos.push(p[0] + nx * u * w * k, y0 + v * h * (0.94 + 0.12 * vnoise(p[0] * 0.6, p[1] * 0.6, 72)), p[1] + nz * u * w * k);
          const sh = 0.72 + 0.35 * v; col.push(sh, sh, sh);
        }
      }
      const P = prof.length, segs = closed ? n : n - 1;
      for (let i = 0; i < segs; i++) for (let j = 0; j < P - 1; j++) {
        const a = base + i * P + j, b = base + ((i + 1) % n) * P + j;
        idx.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setAttribute('aSway', new THREE.Float32BufferAttribute(new Float32Array(pos.length / 3), 1));
    g.setAttribute('aLeaf', new THREE.Float32BufferAttribute(new Float32Array(pos.length / 3).fill(1), 1));
    g.setIndex(idx); g.computeVertexNormals();
    return g;
  }
  /** a polar lawn / paving disc conforming to the ground: r0 … r1, lifted by `lift` (+ a gentle mound) */
  function discGeometry(cx, cz, r0, r1, hAt, lift, mound, segs, rings) {
    const pos = [], uv = [], idx = [];
    for (let r = 0; r <= rings; r++) for (let s = 0; s <= segs; s++) {
      const rr = lerp(r0, r1, r / rings), a = s / segs * TAU, x = cx + Math.cos(a) * rr, z = cz + Math.sin(a) * rr;
      pos.push(x, hAt(x, z) + lift + mound * (1 - (rr / r1) ** 2), z); uv.push(x / 2, z / 2);
    }
    for (let r = 0; r < rings; r++) for (let s = 0; s < segs; s++) { const a = r * (segs + 1) + s, b = a + 1, c = a + segs + 1, d = c + 1; idx.push(a, c, b, b, c, d); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(pos.length).fill(1), 3));      // white: vertex-coloured materials
    g.setAttribute('aWet', new THREE.Float32BufferAttribute(new Float32Array(pos.length / 3).fill(0.15), 1));
    g.setIndex(idx); g.computeVertexNormals();
    return g;
  }
  /** the fountain basin (lathe), the centre pedestal and bowl, the ring nozzles — one geometry */
  function fountainGeometry(F, low) {
    const r = F.r, segs = low ? 20 : 56;
    const lathe = (pts) => new THREE.LatheGeometry(pts.map((p) => new THREE.Vector2(p[0], p[1])), segs);
    const K = new Kit(['wet']);
    K.add(lathe([[0.01, 0.06], [r - 0.34, 0.06], [r - 0.34, 0.5], [r - 0.3, 0.6], [r - 0.08, 0.66], [r + 0.08, 0.62], [r + 0.14, 0.52], [r + 0.14, -0.25]]), { color: lin('#b9b4aa'), wet: (x, y) => (y > 0.3 ? 1 : 0.6) });
    K.add(lathe([[0.01, 1.14], [0.95, 1.14], [1.08, 1.24], [1.0, 1.32], [0.62, 1.12], [0.34, 0.98], [0.3, 0.06]]), { color: lin('#c3beb4'), wet: 1 });
    K.add(lathe([[0.01, 1.42], [0.16, 1.4], [0.13, 1.14]]), { color: lin('#8d8a84'), wet: 1 });
    for (let i = 0; i < F.jets; i++) {
      const a = i / F.jets * TAU;
      K.add(new THREE.CylinderGeometry(0.1, 0.16, 0.55, low ? 6 : 10), { matrix: at(Math.cos(a) * F.jetR, 0.3, Math.sin(a) * F.jetR), color: lin('#a9a49a'), wet: 1 });
    }
    return K.build();
  }
  function fountainStoneMaterial(low, U) {
    if (low) return new THREE.MeshLambertMaterial({ vertexColors: true });
    const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0 });
    if (G.mat && G.mat.apply) { try { G.mat.apply(m, 'granite_stone', { tile: [1.6, 1.6], look: [176, 171, 160] }); } catch (e) { /* plain */ } }
    return patch(m, 'fountain-stone', {
      vhead: 'attribute float aWet; varying float vWet;', vbegin: 'vWet = aWet;',
      fhead: 'varying float vWet;',
      fcolor: 'diffuseColor.rgb *= mix(1.0, 0.62, vWet);',
      frough: 'roughnessFactor = mix(roughnessFactor, 0.22, vWet);',
    });
  }
  /** droplet streams of the fountain: an instanced geometry whose positions are computed on the GPU (no CPU per frame) */
  function jetGeometry(F, n, low) {
    const base = new THREE.IcosahedronGeometry(0.055, 0);
    const g = new THREE.InstancedBufferGeometry();
    g.index = base.index; g.attributes.position = base.attributes.position; g.attributes.normal = base.attributes.normal;
    const O = new Float32Array(n * 3), V = new Float32Array(n * 3), P = new Float32Array(n * 2);
    const rnd = mulberry(4242);
    const centre = Math.round(n * 0.4);
    for (let i = 0; i < n; i++) {
      if (i < centre) {                                   // the centre jet: 3 m up, a soft crown on the way down
        O.set([0, 1.42, 0], i * 3);
        const a = rnd() * TAU, h = 0.12 + rnd() * 0.32;
        V.set([Math.cos(a) * h, 7.2 + rnd() * 0.5, Math.sin(a) * h], i * 3);
      } else {                                            // the ring jets arc in towards the centre bowl
        const k = (i - centre) % F.jets, a = k / F.jets * TAU, rr = F.jetR;
        O.set([Math.cos(a) * rr, 0.6, Math.sin(a) * rr], i * 3);
        const vh = 1.2 + rnd() * 0.25, vy = 4.6 + rnd() * 0.4;
        V.set([-Math.cos(a) * vh + (rnd() - 0.5) * 0.08, vy, -Math.sin(a) * vh + (rnd() - 0.5) * 0.08], i * 3);
      }
      P[i * 2] = rnd(); P[i * 2 + 1] = 0.7 + rnd() * 0.6;
    }
    g.setAttribute('aO', new THREE.InstancedBufferAttribute(O, 3));
    g.setAttribute('aV', new THREE.InstancedBufferAttribute(V, 3));
    g.setAttribute('aP', new THREE.InstancedBufferAttribute(P, 2));
    g.instanceCount = n;
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 2, 0), 6);
    g.userData.base = base;
    return g;
  }
  function jetMaterial(U) {
    const m = new THREE.MeshStandardMaterial({ color: new THREE.Color('#e9f3f4'), roughness: 0.12, metalness: 0, transparent: true, opacity: 0.72, depthWrite: false, envMapIntensity: 1.2 });
    return patch(m, 'jets', {
      uniforms: U,
      vhead: 'attribute vec3 aO; attribute vec3 aV; attribute vec2 aP; uniform float uJetT; uniform float uWaterY;',
      vbegin: `{
        float T = 2.0 * aV.y / 9.81 * 1.12;
        float t = fract(uJetT / T + aP.x) * T;
        vec3 p = aO + aV * t + vec3(0.0, -4.905, 0.0) * t * t;
        float life = t / T;
        float s = aP.y * (0.7 + 0.9 * life) * step(uWaterY, p.y);
        transformed = transformed * s * vec3(1.0, 1.0 + 1.4 * clamp(abs(aV.y - 9.81 * t) * 0.2, 0.0, 1.5), 1.0) + p;
      }`,
    });
  }
  /** birds: an instanced flock geometry; positions, heading and wing beat on the GPU */
  function birdGeometry(flocks) {
    const base = new THREE.BufferGeometry();
    const P = [0, 0, 0.45, -0.1, 0, -0.35, 0.1, 0, -0.35, 0, 0, 0.1, -0.85, 0.05, -0.1, 0, 0, -0.2, 0, 0, 0.1, 0, 0, -0.2, 0.85, 0.05, -0.1];
    const Wg = [0, 0, 0, -1, -1, -1, 1, 1, 1];
    base.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    base.setAttribute('aWing', new THREE.Float32BufferAttribute(Wg.map((w, i) => (i % 3 === 1 && w ? w : w)), 1));
    base.computeVertexNormals();
    const g = new THREE.InstancedBufferGeometry();
    g.attributes.position = base.attributes.position; g.attributes.normal = base.attributes.normal; g.attributes.aWing = base.attributes.aWing;
    const n = flocks.reduce((a, f) => a + f.n, 0), Cc = new Float32Array(n * 4), S = new Float32Array(n * 3);
    let k = 0;
    flocks.forEach((f, fi) => { for (let i = 0; i < f.n; i++, k++) { Cc.set([f.x + (hash2(fi, i, 5) - 0.5) * 14, f.y + (hash2(fi, i, 6) - 0.5) * 6, f.z + (hash2(fi, i, 7) - 0.5) * 14, f.r + (hash2(fi, i, 8) - 0.5) * 10], k * 4); S.set([f.w * (0.9 + hash2(fi, i, 9) * 0.2), fi * 1.7 + i * 0.09, hash2(fi, i, 10)], k * 3); } });
    g.setAttribute('aC', new THREE.InstancedBufferAttribute(Cc, 4));
    g.setAttribute('aS', new THREE.InstancedBufferAttribute(S, 3));
    g.instanceCount = n;
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 60, 0), 2000);
    g.userData.base = base;
    return g;
  }
  function birdMaterial(U) {
    const m = new THREE.MeshStandardMaterial({ color: new THREE.Color('#2b2a28'), roughness: 0.9, side: THREE.DoubleSide });
    return patch(m, 'birds', {
      uniforms: U,
      vhead: 'attribute float aWing; attribute vec4 aC; attribute vec3 aS; uniform float uBirdT; uniform float uFlap;',
      vbegin: `{
        float ang = uBirdT * aS.x + aS.y;
        float sgn = aS.x < 0.0 ? -1.0 : 1.0;
        vec3 p = aC.xyz + vec3(cos(ang) * aC.w, sin(ang * 0.7 + aS.z * 6.0) * 2.5, sin(ang) * aC.w);
        vec3 fwd = normalize(vec3(-sin(ang), 0.0, cos(ang)) * sgn);
        vec3 rgt = normalize(cross(vec3(0.0, 1.0, 0.0), fwd));
        float flap = sin(uBirdT * 10.0 + aS.z * 40.0) * 0.55 * uFlap;
        vec3 q = transformed * 1.6;
        q.y += abs(q.x) * flap * aWing * aWing;
        transformed = p + rgt * q.x + vec3(0.0, 1.0, 0.0) * q.y + fwd * q.z;
      }`,
    });
  }
  /** dawn mist sheets over the valley floors: soft procedural alpha (no texture), fades by the hour of the day */
  function veilMaterial(U) {
    const m = new THREE.MeshBasicMaterial({ color: new THREE.Color('#dfe4e6'), transparent: true, depthWrite: false, opacity: 1, side: THREE.DoubleSide });
    return patch(m, 'veil', {
      uniforms: U,
      vhead: 'varying vec2 vVUv; ' + WP_VARY, vbegin: 'vVUv = uv;', vend: WP_CALC,
      fhead: 'uniform float uVeil; uniform float uTime; varying vec2 vVUv; ' + WP_VARY + GLSL_COMMON,
      fcolor: `{
        vec2 uvv = vVUv * 2.0 - 1.0;
        float edge = (1.0 - smoothstep(0.55, 1.0, abs(uvv.x))) * (1.0 - smoothstep(0.35, 1.0, abs(uvv.y)));
        float n = cxFbm(vCxWP.xz / 46.0 + vec2(uTime * 0.004, uTime * 0.002)) * 0.7 + cxFbm(vCxWP.xz / 17.0 - vec2(uTime * 0.006, 0.0)) * 0.45;
        diffuseColor.a = uVeil * edge * smoothstep(0.38, 0.9, n) * 0.62;
      }`,
    });
  }
  /** fish shadows in the shallows: soft dark ovals drifting up and down stream (GPU; still under reduce-motion) */
  function fishGeometry(spots) {
    const base = shadowGeometry();
    const g = new THREE.InstancedBufferGeometry();
    g.index = base.index; g.attributes.position = base.attributes.position; g.attributes.color = base.attributes.color;
    const A = new Float32Array(spots.length * 4), D = new Float32Array(spots.length * 4);
    spots.forEach((s, i) => { A.set([s.x, s.y, s.z, s.ph], i * 4); D.set([s.dx, s.dz, s.len, s.sp], i * 4); });
    g.setAttribute('aA', new THREE.InstancedBufferAttribute(A, 4));
    g.setAttribute('aD', new THREE.InstancedBufferAttribute(D, 4));
    g.instanceCount = spots.length;
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(-180, 0, 40), 400);
    g.userData.base = base;
    return g;
  }
  function fishMaterial(U) {
    const m = new THREE.MeshBasicMaterial({ color: new THREE.Color('#10140f'), vertexColors: true, transparent: true, opacity: 0.38, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    return patch(m, 'fish', {
      uniforms: U,
      vhead: 'attribute vec4 aA; attribute vec4 aD; uniform float uFishT;',
      vbegin: `{
        float u = sin(uFishT * aD.w + aA.w) * aD.z;
        float wig = sin(uFishT * 2.2 + aA.w * 3.0) * 0.06;
        vec2 dir = normalize(aD.xy + vec2(1e-5));
        vec2 side = vec2(-dir.y, dir.x);
        vec2 off = dir * u + side * sin(uFishT * 0.4 + aA.w) * 0.8;
        vec2 q = vec2(transformed.x * 0.16, transformed.z * 0.42);
        vec2 r = side * q.x + dir * (q.y + wig * q.x);
        transformed = vec3(aA.x + off.x + r.x, aA.y, aA.z + off.y + r.y);
      }`,
    });
  }

  // =============================================================================================== the part
  const CROWN_R = [2.6, 3.4, 3.9, 1.7, 2.2];
  const HAZE = 0.38;                              // district fog = the valley's × this (see the haze adapter in build)      // crown radius per species family (contact shadows)
  function build(ctx, C) {
    const t0 = (typeof performance !== 'undefined' ? performance : Date).now();
    const q = ctx.low ? 'low' : ['low', 'medium', 'high'].includes(ctx.quality) ? ctx.quality : 'high';
    const low = q === 'low', high = q === 'high';
    const root = new THREE.Group(); root.name = 'cxl-landscape';
    ctx.group.add(root);
    const owned = [];                                 // geometries / materials / textures made here (disposed with the part)
    const own = (x) => { if (x) owned.push(x); return x; };
    const U = { uTime: { value: 0 }, uWind: { value: new THREE.Vector2(0.82, 0.57) }, uWindAmp: { value: 1 }, uJetT: { value: 0 }, uWaterY: { value: 0 }, uBirdT: { value: 0 }, uFlap: { value: 1 }, uVeil: { value: 0 }, uFishT: { value: 0 } };
    const stats = { quality: q, ms: {}, counts: {} };
    const lap = (k, t) => { stats.ms[k] = Math.round(((typeof performance !== 'undefined' ? performance : Date).now() - t) * 10) / 10; };
    const now = () => (typeof performance !== 'undefined' ? performance : Date).now();
    const B = C.bounds;

    // ---- mountains
    let tt = now();
    const md = mountainData(C, q);
    mountainShading(C, md.geo, low);
    const mMat = own(mountainMaterial(low, U));
    const mountains = new THREE.Mesh(own(md.geo), mMat);
    mountains.name = 'cxl-mountains'; mountains.receiveShadow = !low; mountains.castShadow = false;
    root.add(mountains);
    stats.counts.heightCalls = md.calls;
    lap('mountains', tt);
    const hAt = (x, z) => {
      if (outside(x, z, B) < 1e-9) return C.height(x, z);
      const v = md.sample(x, z);
      return v === v ? v - SEAM_DROP : land(C, x, z) - SEAM_DROP;
    };
    const hSite = (x, z) => (outside(x, z, B) < 1e-9 ? C.height(x, z) : hAt(x, z));

    // ---- trees (the plan's forests, garden, gate, streets, plaza) + pines on the cliff tops
    tt = now();
    const T = trees(C, q, hSite);
    const cliffs = [];
    {
      const L = md.lattices[0], L2 = md.lattices[1], river = C.byId && C.byId('RIVER');
      const lim = high ? 520 : q === 'medium' ? 260 : 70;
      for (const Lt of [L, L2]) {
        const w = Lt.nx + 1;
        for (let j = 1; j < Lt.nz && cliffs.length < lim; j++) for (let i = 1; i < Lt.nx && cliffs.length < lim; i++) {
          const h = Lt.h[j * w + i]; if (h !== h) continue;
          const hx = Lt.h[j * w + i + 1] - Lt.h[j * w + i - 1], hz = Lt.h[(j + 1) * w + i] - Lt.h[(j - 1) * w + i];
          if (hx !== hx || hz !== hz) continue;
          const slope = Math.hypot(hx, hz) / (2 * Lt.c);
          const x = Lt.x0 + i * Lt.c, z = Lt.z0 + j * Lt.c;
          const far = !!river && Math.abs(z - clamp(z, river.pts[0][1], river.pts[river.pts.length - 1][1])) < 200 && x < riverXAt(river.pts, z) - 10;
          if (slope < (far ? 0.62 : 0.95) || hash2(i, j, Lt.c) > (far ? 0.85 : 0.35)) continue;
          if (blocked(C, x, z, 2, {})) continue;
          const s = (far ? 4.2 : 3.2) + hash2(i, j, 3) * (far ? 6 : 3.5);
          cliffs.push({ x: x + (hash2(i, j, 4) - 0.5) * Lt.c * 0.6, z: z + (hash2(i, j, 5) - 0.5) * Lt.c * 0.6, y: h - SEAM_DROP - s * 0.35, s, nx: -hx / Math.hypot(hx, hz), nz: -hz / Math.hypot(hx, hz), far });
          if (far && hash2(i, j, 6) < 0.45) {                 // a pine on the cliff top (picture 4)
            const px = x + hx / Math.hypot(hx, hz) * s * 0.7, pz = z + hz / Math.hypot(hx, hz) * s * 0.7;
            if (!blocked(C, px, pz, 2, {})) T.list.push({ x: px, y: hAt(px, pz), z: pz, sp: SP.pine, kind: 'pine', s: 0.75 + hash2(i, j, 7) * 0.3, rot: hash2(i, j, 8) * TAU, src: 'cliff', v: 0.4 });
          }
        }
      }
    }
    // the vegetation system's planting API (render-nature): the same trees, levels of detail, wind and shadows as the
    // valley; this part's own instanced trees are the fallback when it is not there (or plants nothing)
    let grove = null;
    const nature = G.sys && G.sys.nature;
    if (nature && typeof nature.grove === 'function') {
      try {
        grove = nature.grove(T.list.map((t) => ({ x: t.x, y: t.y, z: t.z, species: t.kind, scale: t.s, rot: t.rot })), { parent: root, space: 'parent', name: 'cxl-grove', heightAt: hSite, colliders: false });
        if (!grove || typeof grove.dispose !== 'function' || !grove.count) { if (grove && grove.dispose) grove.dispose(); grove = null; }
      } catch (e) { G.log && G.log.warn && G.log.warn('COMPLEX', 'landscape: grove() failed — own trees instead', e); grove = null; }
    }
    const treeMat = own(treeMaterial(low, U, 'near'));
    const treeSet = grove ? null : new TreeSet(root, T.list, { lods: low ? [2] : [0, 1, 2], dist: high ? [46, 175] : [32, 130], material: treeMat, geometry: (sp, lod) => treeGeometry(sp, lod), low });
    stats.counts.trees = T.list.length; stats.counts.treeSources = T.counts; stats.counts.grove = !!grove;
    lap('trees', tt);

    // ---- crown clumps of the far forest skin (nearer slopes + every ridge line)
    tt = now();
    const clumps = [[], []];
    {
      const forests = (C.elements || []).filter((e) => e.type === 'forest' && e.poly).map((e) => ({ e, box: polyBox(e.poly) }));
      const realTrees = (x, z) => { if (low || outside(x, z, B) > (QPLAN[q] || QPLAN.high).belt) return false; for (const F of forests) { const b = F.box; if (x >= b.x0 && x <= b.x1 && z >= b.z0 && z <= b.z1 && pointInPoly(x, z, F.e.poly)) return true; } return false; };
      const mix = md.geo.attributes.aMix.array, mpos = md.geo.attributes.position.array;
      void mix; void mpos;
      const P = { high: [0.55, 0.85, 0.8, 0.7], medium: [0.35, 0.6, 0.6, 0.55], low: [0, 0.1, 0.18, 0.2] }[q];
      const SC = [8.5, 9.5, 15, 24];
      md.lattices.forEach((Lt, k) => {
        const w = Lt.nx + 1, step = k === 0 ? 2 : 1;
        for (let j = 1; j < Lt.nz; j += step) for (let i = 1; i < Lt.nx; i += step) {
          const h = Lt.h[j * w + i]; if (h !== h) continue;
          const hl = Lt.h[j * w + i - 1], hr = Lt.h[j * w + i + 1], hu = Lt.h[(j - 1) * w + i], hd = Lt.h[(j + 1) * w + i];
          if (hl !== hl || hr !== hr || hu !== hu || hd !== hd) continue;
          const x = Lt.x0 + i * Lt.c, z = Lt.z0 + j * Lt.c;
          const slope = Math.max(Math.abs(hr - hl), Math.abs(hd - hu)) / (2 * Lt.c);
          if (slope > 1.15) continue;
          const ridge = (2 * h - hl - hr) > 0.22 * Lt.c || (2 * h - hu - hd) > 0.22 * Lt.c;
          const u = hash2(i, j, 100 + k);
          if (!ridge && u > P[k]) continue;
          if (low && !ridge) continue;
          if (realTrees(x, z)) continue;
          const jx = x + (hash2(i, j, 110 + k) - 0.5) * Lt.c * 0.8, jz = z + (hash2(i, j, 120 + k) - 0.5) * Lt.c * 0.8;
          if (blocked(C, jx, jz, SC[k] * 0.4, {})) continue;
          const y = hAt(jx, jz);
          const conif = clamp(0.42 + smooth(140, 360, y) * 0.25 + (fbm3(jx / 110, jz / 110, 61) - 0.5) * 0.5 + (ridge ? 0.15 : 0), 0, 1);
          const kind = hash2(i, j, 130 + k) < conif ? 0 : 1;
          const s = SC[k] * (0.85 + hash2(i, j, 140 + k) * 0.35);
          clumps[kind].push({ x: jx, y: y - s * 0.05, z: jz, s, rot: hash2(i, j, 150 + k) * TAU, k, v: hash2(i, j, 160 + k) });
          if (ridge && k > 0 && !low) {                  // ridges carry a second clump: tree-shaped silhouettes
            const ex = x + (hash2(i, j, 170 + k) - 0.5) * Lt.c, ez = z + (hash2(i, j, 180 + k) - 0.5) * Lt.c;
            clumps[hash2(i, j, 190 + k) < conif ? 0 : 1].push({ x: ex, y: hAt(ex, ez) - s * 0.05, z: ez, s: s * 0.9, rot: hash2(i, j, 200 + k) * TAU, k, v: hash2(i, j, 210 + k) });
          }
        }
      });
    }
    const clumpMat = own(low ? new THREE.MeshLambertMaterial({ vertexColors: true }) : patch(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0, envMapIntensity: 0.45 }), 'clump', {
      vhead: 'attribute float aLeaf;', vcolor: CAR_VCOLOR.replace('aPaint', 'aLeaf'),
    }));
    const clumpMeshes = [];
    clumps.forEach((list, kind) => {
      if (!list.length) return;
      for (const lod of low ? [1] : [0, 1]) {
        const sub = list.filter((c) => (low ? true : lod === 0 ? c.k <= 1 : c.k >= 2));
        if (!sub.length) continue;
        const geo = own(clumpGeometry(kind, lod));
        const mesh = new THREE.InstancedMesh(geo, clumpMat, sub.length);
        mesh.name = `cxl-crowns-${kind ? 'broad' : 'conifer'}-${lod}`; mesh.frustumCulled = false; mesh.receiveShadow = !low;
        const m = new THREE.Matrix4(), qt = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), s = new THREE.Vector3(), c = new THREE.Color();
        const base = kind ? [0.078, 0.118, 0.034] : [0.038, 0.062, 0.027];
        sub.forEach((cl, i) => {
          e.set(0, cl.rot, 0); qt.setFromEuler(e); v.set(cl.x, cl.y, cl.z); s.set(cl.s, cl.s * (kind ? 0.9 : 1.05), cl.s);
          m.compose(v, qt, s); mesh.setMatrixAt(i, m);
          const k2 = 0.8 + 0.4 * cl.v; c.setRGB(base[0] * k2 * (kind ? 1 + (cl.v - 0.5) * 0.25 : 1), base[1] * k2, base[2] * k2);
          mesh.setColorAt(i, c);
        });
        mesh.userData.tris = geo.index ? geo.index.count / 3 : geo.attributes.position.count / 3;
        root.add(mesh); clumpMeshes.push(mesh);
      }
    });
    stats.counts.crowns = clumps[0].length + clumps[1].length;
    lap('crowns', tt);

    // ---- rocks: river boulders (plan + gravel bars), garden and gate rocks, cliffs
    tt = now();
    const rocks = [];
    const RL = riverLine(C);
    if (RL) {
      for (const r of RL.rocks) { const wy = C.waterY(r[0], r[1]); rocks.push({ x: r[0], z: r[1], r: r[2], wet: wy > -Infinity, wy: wy > -Infinity ? wy : -999 }); }
      // more boulders and gravel bars along the whole line (also beyond the site)
      const P = RL.pts, step = high ? 2.6 : q === 'medium' ? 4.5 : 12;
      for (let i = 0, s = 0; i < P.length - 1; i++) {
        const a = P[i], b = P[i + 1], l = Math.hypot(b[0] - a[0], b[1] - a[1]);
        for (let u = 0; u < l; u += step, s++) {
          const x0 = lerp(a[0], b[0], u / l), z0 = lerp(a[1], b[1], u / l), wy = lerp(a[2], b[2], u / l);
          const nx = -(b[1] - a[1]) / l, nz = (b[0] - a[0]) / l;
          const side = hash2(s, 1, 301) < 0.5 ? -1 : 1, off = (RL.w / 2 - 1 + hash2(s, 2, 301) * 4.5) * side;
          const x = x0 + nx * off, z = z0 + nz * off;
          if (hash2(s, 3, 301) < 0.4) continue;
          if (C.byId('BRIDGE') && polyNear(x, z, [[C.byId('BRIDGE').x0, C.byId('BRIDGE').z0], [C.byId('BRIDGE').x1, C.byId('BRIDGE').z1]]).d < 4) continue;
          const r = hash2(s, 4, 301) < 0.12 ? 1.2 + hash2(s, 5, 301) * 1.4 : 0.25 + hash2(s, 6, 301) * 0.6;
          rocks.push({ x, z, r, wet: Math.abs(off) < RL.w / 2, wy });
          if (hash2(s, 7, 301) < 0.15) { const m2 = hash2(s, 8, 301) * 0.6; rocks.push({ x: x0 + nx * (m2 - 0.3) * RL.w, z: z0 + nz * (m2 - 0.3) * RL.w, r: 0.4 + hash2(s, 9, 301) * 0.8, wet: true, wy }); }
        }
      }
    }
    if (RL) for (const [n, rf] of riffles(RL).entries()) {
      const cnt = high ? 6 : q === 'medium' ? 4 : 2;
      for (let k = 0; k < cnt; k++) { const u = (hash2(n, k, 709) - 0.5) * RL.w * 0.9, along = (hash2(n, k, 710) - 0.5) * 5; rocks.push({ x: rf.x + rf.nx * u - rf.nz * along, z: rf.z + rf.nz * u + rf.nx * along, r: 0.35 + hash2(n, k, 711) * 0.75, wet: true, wy: rf.y }); }
    }
    const gd = C.byId && C.byId('GARDEN');
    if (gd) for (const r of gd.rocks || []) rocks.push({ x: r.x, z: r.z, r: r.r, wet: false, wy: -999, garden: true });
    for (const t of T.list) if (t.src === 'gate' || (t.src === 'garden' && hash2(Math.round(t.x), Math.round(t.z), 5) < 0.5)) {
      const a = t.rot, x = t.x + Math.cos(a) * 1.6, z = t.z + Math.sin(a) * 1.6;
      if (!blocked(C, x, z, 0.6, { plaza: true, garden: true })) rocks.push({ x, z, r: 0.55 + hash2(Math.round(x * 3), 1, 7) * 0.5, wet: false, wy: -999, garden: true });
    }
    const rockMat = own(rockMaterial(low, U));
    const rockMeshes = [];
    const putRocks = (list, detail, name, cliff) => {
      if (!list.length) return;
      const geo = own(rockGeometry(cliff ? 3.7 : 1.3, detail));
      const wy = new Float32Array(list.length);
      const mesh = new THREE.InstancedMesh(geo, rockMat, list.length);
      mesh.name = name; mesh.frustumCulled = false; mesh.castShadow = !low; mesh.receiveShadow = !low;
      const m = new THREE.Matrix4(), qt = new THREE.Quaternion(), q2 = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), s = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), nrm = new THREE.Vector3();
      list.forEach((r, i) => {
        if (cliff) {
          nrm.set(r.nx * 0.8, 0.6, r.nz * 0.8).normalize(); qt.setFromUnitVectors(up, nrm);
          q2.setFromEuler(e.set(0, hash2(i, 1, 77) * TAU, 0)); qt.multiply(q2);
          v.set(r.x, r.y, r.z); s.set(r.s * (0.9 + hash2(i, 2, 77) * 0.5), r.s * (1.1 + hash2(i, 3, 77) * 0.6), r.s * (0.8 + hash2(i, 4, 77) * 0.4));
        } else {
          const y = (r.garden ? C.height(r.x, r.z) : hAt(r.x, r.z)) - r.r * 0.22;
          qt.setFromEuler(e.set((hash2(i, 5, 78) - 0.5) * 0.4, hash2(i, 6, 78) * TAU, (hash2(i, 7, 78) - 0.5) * 0.4));
          v.set(r.x, y, r.z); s.set(r.r * (0.9 + hash2(i, 8, 78) * 0.4), r.r * (0.7 + hash2(i, 9, 78) * 0.5), r.r * (0.8 + hash2(i, 10, 78) * 0.4));
        }
        m.compose(v, qt, s); mesh.setMatrixAt(i, m);
        wy[i] = r.wy != null ? r.wy : -999;
      });
      geo.setAttribute('aWY', new THREE.InstancedBufferAttribute(wy, 1));
      mesh.userData.tris = geo.index ? geo.index.count / 3 : geo.attributes.position.count / 3;
      root.add(mesh); rockMeshes.push(mesh);
    };
    putRocks(rocks, low ? 0 : 1, 'cxl-boulders', false);
    putRocks(cliffs.map((c) => Object.assign(c, { wy: -999 })), low ? 0 : 2, 'cxl-cliffs', true);
    stats.counts.rocks = rocks.length; stats.counts.cliffs = cliffs.length;
    lap('rocks', tt);

    // ---- water: the river (+ its valley beyond the site) and the fountain basin share one mesh
    tt = now();
    let F = null;
    if (gd && gd.fountain) {
      const fy = C.height(gd.fountain.x, gd.fountain.z);
      F = { x: gd.fountain.x, z: gd.fountain.z, y0: fy, r: gd.fountain.r || 4, jets: gd.fountain.jets || 7, jetR: (gd.fountain.r || 4) * 0.62 };
      F.y = fy + 0.46;
    }
    const wMat = own(waterMaterial(low, U));
    const wGeo = own(waterGeometry(C, q, (x, z) => (outside(x, z, B) < 1e-9 ? C.height(x, z) : hAt(x, z) + SEAM_DROP * 0), rocks, F ? { x: F.x, z: F.z, y: F.y, r: F.r - 0.3, jetR: F.jetR } : null));
    const water = new THREE.Mesh(wGeo, wMat);
    water.name = 'cxl-water'; water.receiveShadow = !low; water.renderOrder = 1;
    root.add(water);
    lap('water', tt);

    // ---- the roundabout garden: lawn, hedge ring, flower drifts, fountain; hedges round the parking
    tt = now();
    const gardenMeshes = [];
    if (gd) {
      const lawnMat = own(low ? new THREE.MeshLambertMaterial({ color: new THREE.Color('#5c7a35') }) : new THREE.MeshStandardMaterial({ color: new THREE.Color('#6b8a3c'), roughness: 0.95, metalness: 0, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
      if (!low && G.mat && G.mat.apply) { try { G.mat.apply(lawnMat, 'grass', { tile: [2.2, 2.2], look: [96, 124, 52] }); } catch (e) { /* plain */ } }
      const lawn = new THREE.Mesh(own(discGeometry(gd.cx, gd.cz, F ? F.r + 1.2 : 0.5, gd.r - 0.4, C.height, 0.07, 0.18, low ? 24 : 64, low ? 3 : 8)), lawnMat);
      lawn.name = 'cxl-lawn'; lawn.receiveShadow = !low; root.add(lawn); gardenMeshes.push(lawn);
      if (F) {
        const pave = new THREE.Mesh(own(discGeometry(F.x, F.z, F.r + 0.1, F.r + 1.25, C.height, 0.06, 0, low ? 20 : 56, 1)), own(fountainStoneMaterial(low, U)));
        pave.name = 'cxl-fountain-paving'; pave.receiveShadow = !low; root.add(pave); gardenMeshes.push(pave);
        const fg = own(fountainGeometry(F, low));
        const fm = new THREE.Mesh(fg, pave.material); fm.position.set(F.x, F.y0 + 0.02, F.z); fm.name = 'cxl-fountain'; fm.castShadow = !low; fm.receiveShadow = !low;
        root.add(fm); gardenMeshes.push(fm);
        U.uWaterY.value = F.y - F.y0 - 0.02;
        if (!low) {
          const jg = own(jetGeometry(F, high ? 640 : 300, low));
          own(jg.userData.base);
          const jm = new THREE.Mesh(jg, own(jetMaterial(U)));
          jm.name = 'cxl-fountain-jets'; jm.position.copy(fm.position); jm.frustumCulled = true; jm.renderOrder = 2;
          root.add(jm); gardenMeshes.push(jm);
        } else {
          const K = new Kit([]);
          K.add(new THREE.CylinderGeometry(0.08, 0.16, 1.7, 6), { matrix: at(0, 2.2, 0), color: lin('#dfeef0') });
          for (let i = 0; i < F.jets; i++) { const a = i / F.jets * TAU; K.add(new THREE.CylinderGeometry(0.04, 0.07, 1.2, 5), { matrix: at(Math.cos(a) * F.jetR * 0.6, 1.0, Math.sin(a) * F.jetR * 0.6, Math.sin(a) * 0.7, 0, -Math.cos(a) * 0.7), color: lin('#dfeef0') }); }
          const jm = new THREE.Mesh(own(K.build()), own(new THREE.MeshLambertMaterial({ vertexColors: true })));
          jm.name = 'cxl-fountain-jets'; jm.position.copy(fm.position); root.add(jm); gardenMeshes.push(jm);
        }
      }
      // hedges: the clipped ring of the island + the edges of the parking
      const lines = [];
      if (gd.hedge) { const pts = []; const n = low ? 48 : 120; for (let i = 0; i < n; i++) { const a = i / n * TAU; pts.push([gd.cx + Math.cos(a) * gd.hedge.r, gd.cz + Math.sin(a) * gd.hedge.r]); } lines.push({ pts, closed: true }); }
      const P = C.byId && C.byId('PARKING');
      if (P) {
        const off = 1.7, runs = [[[P.x0, P.z0 - off], [P.x1 + off, P.z0 - off]], [[P.x1 + off, P.z0 - off], [P.x1 + off, P.z1 + off]], [[P.x1 + off, P.z1 + off], [P.x0, P.z1 + off]]];
        for (const [a, b] of runs) {
          const l = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.ceil(l / 1.5);
          let cur = [];
          for (let i = 0; i <= n; i++) {
            const x = lerp(a[0], b[0], i / n), z = lerp(a[1], b[1], i / n);
            const bad = (() => { const pd = C.pathDistance ? C.pathDistance(x, z) : { d: 9 }; if (pd.d < 0.8 && pd.path && pd.path.kind !== 'plaza') return true; for (const p of footprints(C).points) if (Math.hypot(x - p.x, z - p.z) < 1.4) return true; for (const L of footprints(C).lines) if (L.road && polyNear(x, z, L.pts).d < L.w - 1.5) return true; return false; })();
            if (bad) { if (cur.length > 2) lines.push({ pts: cur }); cur = []; } else cur.push([x, z]);
          }
          if (cur.length > 2) lines.push({ pts: cur });
        }
      }
      if (lines.length) {
        const hedge = new THREE.Mesh(own(hedgeGeometry(lines, C.height)), own(treeMaterial(low, U, 'hedge')));
        hedge.name = 'cxl-hedges'; hedge.castShadow = !low; hedge.receiveShadow = !low;
        hedge.userData.colorScale = 1;
        // hedge colour lives in the vertex shades × a material colour (no instance colour here)
        hedge.material.color = new THREE.Color(0.055, 0.1, 0.036).multiplyScalar(low ? 6 : 1);
        root.add(hedge); gardenMeshes.push(hedge);
        stats.counts.hedgeRuns = lines.length;
      }
      // flower drifts (azalea cushions) between the pines, round the fountain paving and at the gate pines
      const fl = [];
      const pal = [lin('#b8236b'), lin('#e9e4dc'), lin('#e0769a'), lin('#d6a21e'), lin('#7c4aa8')];
      const nd = low ? 6 : high ? 16 : 10;
      for (let k = 0; k < nd; k++) {
        const a = (k + 0.5) / nd * TAU + 0.15, r = (F ? F.r + 2.6 : 3) + hash2(k, 1, 401) * (gd.r - (F ? F.r + 5 : 6));
        const cx = gd.cx + Math.cos(a) * r, cz = gd.cz + Math.sin(a) * r, col = pal[k % pal.length];
        const n = low ? 3 : 7 + Math.floor(hash2(k, 2, 401) * 6);
        for (let i = 0; i < n; i++) {
          const x = cx + (hash2(k, i + 3, 402) - 0.5) * 3.2, z = cz + (hash2(k, i + 3, 403) - 0.5) * 3.2;
          if ((gd.pines || []).some((p) => Math.hypot(p.x - x, p.z - z) < 1.6) || (gd.rocks || []).some((p) => Math.hypot(p.x - x, p.z - z) < p.r + 0.5)) continue;
          if (Math.hypot(x - gd.cx, z - gd.cz) > gd.r - 1.6) continue;
          fl.push({ x, z, s: 0.38 + hash2(k, i, 404) * 0.32, col });
        }
      }
      for (const t of T.list) if (t.src === 'gate') for (let i = 0; i < (low ? 1 : 4); i++) {
        const a = t.rot + i * 1.6, x = t.x + Math.cos(a) * 2.2, z = t.z + Math.sin(a) * 2.2;
        if (!blocked(C, x, z, 0.4, { plaza: true })) fl.push({ x, z, s: 0.42 + hash2(i, Math.round(x), 405) * 0.25, col: pal[(((i + Math.round(t.x)) % pal.length) + pal.length) % pal.length], site: true });
      }
      if (fl.length) {
        const geo = own(blob(1, low ? 0 : 1, 2.2, 1, 0.62, 1, 0.3));
        const cols = new Float32Array(geo.attributes.position.count * 3);
        const pp = geo.attributes.position.array;
        for (let i = 0; i < cols.length / 3; i++) { const top = smooth(-0.1, 0.5, pp[i * 3 + 1]); const v = 0.55 + 0.45 * top; cols[i * 3] = v; cols[i * 3 + 1] = v; cols[i * 3 + 2] = v; }
        geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
        const fm = own(low ? new THREE.MeshLambertMaterial({ vertexColors: true }) : patch(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 }), 'flowers', {
          fhead: WP_VARY + GLSL_COMMON, vhead: WP_VARY, vend: WP_CALC,
          fcolor: '{ float n = cxN3(vCxWP * 9.0); diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.03, 0.07, 0.02), smoothstep(0.62, 0.8, n) * 0.85); }',
        }));
        const mesh = new THREE.InstancedMesh(geo, fm, fl.length);
        mesh.name = 'cxl-flowers'; mesh.castShadow = false; mesh.receiveShadow = !low;
        const m = new THREE.Matrix4(), v = new THREE.Vector3(), s = new THREE.Vector3(), qt = new THREE.Quaternion(), c = new THREE.Color();
        fl.forEach((f, i) => { v.set(f.x, C.height(f.x, f.z) + (f.site ? 0.02 : 0.12) + f.s * 0.2, f.z); s.set(f.s, f.s, f.s); qt.setFromAxisAngle(new THREE.Vector3(0, 1, 0), hash2(i, 1, 406) * TAU); m.compose(v, qt, s); mesh.setMatrixAt(i, m); mesh.setColorAt(i, c.setRGB(f.col[0], f.col[1], f.col[2])); });
        mesh.userData.tris = geo.attributes.position.count / 3;
        root.add(mesh); gardenMeshes.push(mesh);
        stats.counts.flowers = fl.length;
      }
    }
    lap('garden', tt);

    // ---- reeds and grasses on the banks (medium / high: alpha-tested blade quads with wind)
    tt = now();
    let reeds = null;
    if (!low && RL) {
      const list = [];
      const P = RL.pts, step = high ? 1.3 : 2.6, hw = RL.w / 2;
      for (let i = 0, s = 0; i < P.length - 1; i++) {
        const a = P[i], b = P[i + 1], l = Math.hypot(b[0] - a[0], b[1] - a[1]);
        const nx = -(b[1] - a[1]) / l, nz = (b[0] - a[0]) / l;
        for (let u = 0; u < l; u += step, s++) for (const side of [-1, 1]) {
          if (hash2(s, side + 5, 501) < 0.3) continue;
          const off = (hw - 0.8 + hash2(s, side + 7, 501) * 3.2) * side;
          const x = lerp(a[0], b[0], u / l) + nx * off, z = lerp(a[1], b[1], u / l) + nz * off;
          if (rocks.some((r) => Math.abs(r.x - x) < r.r + 0.5 && Math.abs(r.z - z) < r.r + 0.5)) continue;
          if (footprints(C).lines.some((L) => polyNear(x, z, L.pts).d < L.w)) continue;
          const wy = lerp(a[2], b[2], u / l), g = hAt(x, z);
          list.push({ x, z, y: Math.max(g, wy - 0.35), s: 0.7 + hash2(s, side + 9, 501) * 0.6, r: hash2(s, side + 11, 501) * TAU });
        }
      }
      if (list.length) {
        const tex = own(G.gfx && G.gfx.canvasTexture ? G.gfx.canvasTexture(128, 256, (g, w, h) => {
          g.clearRect(0, 0, w, h);
          const rnd = mulberry(77);
          for (let i = 0; i < 26; i++) {
            const x0 = w * (0.08 + rnd() * 0.84), lean = (rnd() - 0.5) * w * 0.5, top = h * (0.02 + rnd() * 0.4), wd = 2 + rnd() * 3;
            const gcol = `rgb(${Math.round(70 + rnd() * 50)},${Math.round(92 + rnd() * 50)},${Math.round(34 + rnd() * 20)})`;
            g.strokeStyle = gcol; g.lineWidth = wd; g.lineCap = 'round';
            g.beginPath(); g.moveTo(x0, h); g.quadraticCurveTo(x0 + lean * 0.3, (h + top) / 2, x0 + lean, top); g.stroke();
            if (rnd() < 0.3) { g.fillStyle = 'rgb(122,96,62)'; g.beginPath(); g.ellipse(x0 + lean, top + 8, 3, 11, 0, 0, TAU); g.fill(); }
          }
        }, { srgb: true }) : null);
        const geo = new THREE.BufferGeometry();
        const pos = [], uv = [], idx = [];
        for (let k = 0; k < 3; k++) { const a = k / 3 * PI, c = Math.cos(a) * 0.55, sn = Math.sin(a) * 0.55, b = pos.length / 3; pos.push(-c, 0, -sn, c, 0, sn, c, 1.6, sn, -c, 1.6, -sn); uv.push(0, 0, 1, 0, 1, 1, 0, 1); idx.push(b, b + 1, b + 2, b, b + 2, b + 3); }
        geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); geo.setIndex(idx);
        geo.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array(pos.length).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
        own(geo);
        const rm = own(patch(new THREE.MeshStandardMaterial({ map: tex, alphaTest: 0.42, side: THREE.DoubleSide, roughness: 0.9, metalness: 0, color: new THREE.Color(0.92, 0.95, 0.85) }), 'reeds', {
          uniforms: U,
          vhead: 'uniform float uTime; uniform vec2 uWind; uniform float uWindAmp;',
          vbegin: `{ vec3 ip = vec3(0.0);
#ifdef USE_INSTANCING
            ip = instanceMatrix[3].xyz;
#endif
            float w = (sin(uTime * 1.6 + dot(ip.xz, vec2(0.21, 0.17))) * 0.7 + sin(uTime * 2.7 + ip.x * 0.3) * 0.3) * uWindAmp;
            transformed.xz += uWind * w * 0.16 * position.y * position.y; }`,
        }));
        reeds = new THREE.InstancedMesh(geo, rm, list.length);
        reeds.name = 'cxl-reeds'; reeds.frustumCulled = false; reeds.receiveShadow = true;
        const m = new THREE.Matrix4(), qt = new THREE.Quaternion(), v = new THREE.Vector3(), s = new THREE.Vector3();
        list.forEach((r, i) => { qt.setFromAxisAngle(new THREE.Vector3(0, 1, 0), r.r); v.set(r.x, r.y, r.z); s.set(r.s, r.s * (0.8 + 0.4 * hash2(i, 3, 502)), r.s); m.compose(v, qt, s); reeds.setMatrixAt(i, m); });
        reeds.userData.tris = 6;
        root.add(reeds);
        stats.counts.reeds = list.length;
      }
    }
    lap('reeds', tt);

    // ---- vehicles: parked cars, two coaches, the shuttle bus at its bay
    tt = now();
    const V = cars(C);
    const carMeshes = [], buses = [];
    const carMat = own(carMaterial(low));
    for (const kind of [0, 1]) {
      const list = V.cars.filter((c) => c.kind === kind);
      if (!list.length) continue;
      const geo = own(carGeometry(kind === 1, low));
      const mesh = new THREE.InstancedMesh(geo, carMat, list.length);
      mesh.name = 'cxl-cars-' + (kind ? 'suv' : 'sedan'); mesh.castShadow = !low; mesh.receiveShadow = !low;
      const m = new THREE.Matrix4(), qt = new THREE.Quaternion(), v = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1), c = new THREE.Color();
      list.forEach((car, i) => { qt.setFromAxisAngle(new THREE.Vector3(0, 1, 0), car.rot); v.set(car.x, car.y, car.z); m.compose(v, qt, one); mesh.setMatrixAt(i, m); const p = PAINTS[car.paint]; mesh.setColorAt(i, c.setRGB(p[0], p[1], p[2])); });
      mesh.userData.tris = geo.index ? geo.index.count / 3 : geo.attributes.position.count / 3;
      root.add(mesh); carMeshes.push(mesh);
    }
    const placeBus = (spot, kind) => {
      if (!spot) return;
      const b = bus({ kind, low });
      b.position.set(spot.x, spot.y, spot.z); b.rotation.y = spot.rot;
      root.add(b); buses.push(b);
    };
    for (const c of V.coaches) placeBus(c, 'coach');
    placeBus(V.shuttle, 'shuttle');
    stats.counts.cars = V.cars.length; stats.counts.coaches = V.coaches.length; stats.counts.shuttle = V.shuttle ? 1 : 0;
    lap('vehicles', tt);

    // ---- colliders inside the site (the place removes them on dispose): trunks, garden rocks, the fountain, cars, buses
    if (typeof ctx.addCollider === 'function') {
      const col = (o) => { try { ctx.addCollider(o); } catch (e) { /* the place refuses: fine */ } };
      for (const t of T.list) if (outside(t.x, t.z, B) < 1e-9) col({ shape: 'circle', x: t.x, z: t.z, r: (t.sp === 4 ? 0.45 : 0.32) * t.s + 0.1, tag: 'tree' });
      for (const r of rocks) if (r.garden && outside(r.x, r.z, B) < 1e-9) col({ shape: 'circle', x: r.x, z: r.z, r: r.r * 0.85, tag: 'rock' });
      if (F) col({ shape: 'circle', x: F.x, z: F.z, r: F.r + 0.2, tag: 'fountain' });
      for (const c of V.cars) col({ shape: 'box', x: c.x, z: c.z, hw: 0.95, hd: 2.3, rot: c.rot, tag: 'car' });
      for (const c of V.coaches) col({ shape: 'box', x: c.x, z: c.z, hw: 1.3, hd: 6.1, rot: c.rot, tag: 'bus' });
      if (V.shuttle) col({ shape: 'box', x: V.shuttle.x, z: V.shuttle.z, hw: 1.25, hd: 4.6, rot: V.shuttle.rot, tag: 'bus' });
    }

    // ---- contact shadows (crowns near the site, cars, buses, rocks) — one instanced soft disc
    tt = now();
    {
      const S = [];
      for (const t of T.list) { if (outside(t.x, t.z, B) > 26 && t.src === 'forest') continue; const r = CROWN_R[t.sp] * t.s * 1.05; S.push({ x: t.x, z: t.z, rx: r, rz: r, rot: 0, k: 0.85 }); }
      for (const c of V.cars) S.push({ x: c.x, z: c.z, rx: 1.25, rz: 2.75, rot: c.rot, k: 1 });
      for (const c of V.coaches) S.push({ x: c.x, z: c.z, rx: 1.65, rz: 6.8, rot: c.rot, k: 1 });
      if (V.shuttle) S.push({ x: V.shuttle.x, z: V.shuttle.z, rx: 1.6, rz: 5.2, rot: V.shuttle.rot, k: 1 });
      for (const r of rocks) if (!r.wet && outside(r.x, r.z, B) < 30) S.push({ x: r.x, z: r.z, rx: r.r * 1.35, rz: r.r * 1.35, rot: 0, k: 0.8 });
      if (S.length) {
        const geo = own(shadowGeometry());
        const mat = own(new THREE.MeshBasicMaterial({ color: new THREE.Color('#0d0f0a'), vertexColors: true, transparent: true, opacity: low ? 0.32 : 0.42, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, side: THREE.DoubleSide }));
        const mesh = new THREE.InstancedMesh(geo, mat, S.length);
        mesh.name = 'cxl-contact-shadows'; mesh.frustumCulled = false; mesh.renderOrder = 0;
        const m = new THREE.Matrix4(), qt = new THREE.Quaternion(), q2 = new THREE.Quaternion(), v = new THREE.Vector3(), s = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), n = new THREE.Vector3();
        S.forEach((o, i) => {
          const h = hSite(o.x, o.z), hx = hSite(o.x + 1, o.z) - hSite(o.x - 1, o.z), hz = hSite(o.x, o.z + 1) - hSite(o.x, o.z - 1);
          n.set(-hx / 2, 1, -hz / 2).normalize(); qt.setFromUnitVectors(up, n); q2.setFromAxisAngle(up, o.rot); qt.multiply(q2);
          v.set(o.x, h + 0.05, o.z); s.set(o.rx, 1, o.rz); m.compose(v, qt, s); mesh.setMatrixAt(i, m);
        });
        mesh.userData.tris = geo.index.count / 3;
        root.add(mesh);
        stats.counts.shadows = S.length;
      }
    }
    lap('shadows', tt);

    // ---- birds over the forest (P1; medium / high)
    let birds = null;
    if (!low) {
      const fl = [{ x: 60, y: 135, z: -330, r: 70, n: 7, w: 0.16 }, { x: -320, y: 120, z: -120, r: 55, n: 5, w: -0.2 }, { x: 300, y: 150, z: 40, r: 85, n: 6, w: 0.13 }, { x: -60, y: 95, z: 230, r: 40, n: 4, w: -0.22 }];
      for (const f of fl) f.y = Math.max(f.y, hAt(f.x, f.z) + 45);
      const bg = own(birdGeometry(fl)); own(bg.userData.base);
      birds = new THREE.Mesh(bg, own(birdMaterial(U)));
      birds.name = 'cxl-birds'; birds.frustumCulled = false;
      root.add(birds);
    }

    // ---- dawn mist in the side valleys (P1; medium / high) and fish shadows in the shallows (P1)
    let veils = null, fish = null;
    if (!low) {
      const sheets = [];
      for (const A of axesOf(C)) {
        if (A.id === 'E') continue;
        for (let k = 1; k < A.pts.length - 1; k++) {
          const a = A.pts[k], b = A.pts[k + 1], len = Math.hypot(b[0] - a[0], b[1] - a[1]);
          for (let u = 0.25; u < 1; u += 0.5) {
            const x = lerp(a[0], b[0], u), z = lerp(a[1], b[1], u), y = lerp(a[2], b[2], u) + 7 + k * 2;
            sheets.push({ x, z, y, rot: Math.atan2(b[0] - a[0], b[1] - a[1]), w: lerp(A.w0, A.w1, k / A.pts.length) * 2.2, l: len * 0.62 });
          }
        }
      }
      const river = C.byId && C.byId('RIVER');
      if (river) for (let k = 2; k < river.pts.length - 1; k += 2) { const a = river.pts[k], b = river.pts[k + 1]; sheets.push({ x: (a[0] + b[0]) / 2 - 8, z: (a[1] + b[1]) / 2, y: (a[2] + b[2]) / 2 + 4.5, rot: Math.atan2(b[0] - a[0], b[1] - a[1]), w: 70, l: 90 }); }
      if (sheets.length) {
        const parts = sheets.map((sh) => { const g = new THREE.PlaneGeometry(sh.w, sh.l, 1, 1); g.rotateX(-PI / 2); g.rotateY(sh.rot); g.translate(sh.x, sh.y, sh.z); return g; });
        const g = ADDONS.BufferGeometryUtils.mergeGeometries(parts, false); parts.forEach((p) => p.dispose());
        veils = new THREE.Mesh(own(g), own(veilMaterial(U)));
        veils.name = 'cxl-veil'; veils.renderOrder = 3; veils.visible = false; veils.frustumCulled = false;
        root.add(veils);
      }
      if (RL) {
        const spots = [];
        const P = RL.pts;
        for (let i = 0; i < P.length - 1 && spots.length < (high ? 22 : 12); i++) {
          const a = P[i], b = P[i + 1];
          if (outside(a[0], a[1], B) > 120) continue;
          const l = Math.hypot(b[0] - a[0], b[1] - a[1]), nx = -(b[1] - a[1]) / l, nz = (b[0] - a[0]) / l;
          for (let k = 0; k < 3; k++) {
            const t = hash2(i, k, 601), side = hash2(i, k, 602) < 0.5 ? -1 : 1, off = (RL.w / 2 - 2.2 - hash2(i, k, 603) * 2.5) * side;
            const x = lerp(a[0], b[0], t) + nx * off, z = lerp(a[1], b[1], t) + nz * off;
            spots.push({ x, z, y: lerp(a[2], b[2], t) - 0.22, ph: hash2(i, k, 604) * TAU, dx: (b[0] - a[0]) / l, dz: (b[1] - a[1]) / l, len: 1.5 + hash2(i, k, 605) * 2.5, sp: 0.18 + hash2(i, k, 606) * 0.2 });
          }
        }
        if (spots.length) {
          const fg = own(fishGeometry(spots)); own(fg.userData.base);
          fish = new THREE.Mesh(fg, own(fishMaterial(U)));
          fish.name = 'cxl-fish'; fish.renderOrder = 2; fish.frustumCulled = false;
          root.add(fish);
        }
      }
    }

    // ---- district haze: the valley's fog (FogExp2 ≈ 0.0026, made for a 270 m valley) would bury a 380 m site and its
    // ridges 1 km away; inside this place the aerial perspective is thinned so that far ridges fade warm-blue as in the
    // picture. Weather writes fog.density afresh every frame; this scales it right before the scene render, only while
    // the player is in this place, and steps aside when the place itself defines a fog / haze profile.
    const E = G.sys && G.sys.engine;
    let hazeLast = -1;
    const offHaze = E && typeof E.onPreRender === 'function' ? E.onPreRender(() => {
      const PL = G.sys.places;
      if (!PL || !ctx.id || PL.current !== ctx.id) return;
      const d = PL.def && PL.def(ctx.id);
      if (d && (d.fog || d.haze)) return;
      const f = E.scene && E.scene.fog;
      if (!f || !f.isFogExp2 || f.density === hazeLast) return;          // weather did not write this frame: no compounding
      f.density *= HAZE; hazeLast = f.density;
    }) : null;

    // ---- statistics (what this part costs: calls, triangles per family)
    const measure = () => {
      const fam = {}; let calls = 0, tris = 0;
      root.traverse((o) => {
        if (!o.isMesh || !o.visible) return;
        const g = o.geometry; const per = o.userData.tris || (g.index ? g.index.count / 3 : g.attributes.position.count / 3);
        const n = o.isInstancedMesh ? o.count : g.isInstancedBufferGeometry ? g.instanceCount : 1;
        if (!n) return;
        const f = o.name.replace(/^cxl-/, '').replace(/-(\d|sedan|suv|body|label|broad|conifer).*$/, '').replace(/-.*$/, '');
        const a = fam[f] || (fam[f] = { calls: 0, tris: 0 }); a.calls++; a.tris += per * n; calls++; tris += per * n;
      });
      return { calls, tris: Math.round(tris), families: fam };
    };
    stats.ms.total = Math.round((now() - t0) * 10) / 10;
    const api = G.complexLandscape;
    api.stats = stats; api.measure = measure; api.root = root;
    api.debug = { hAt, mountains, md, T, clumps, rocks, cliffs, V };

    // ---- per frame
    const cam = new THREE.Vector3();
    let birdT = 0, jetT = 0;
    if (treeSet) { const E = G.sys && G.sys.engine; if (E && E.camera) { root.updateMatrixWorld(true); cam.copy(E.camera.position); root.worldToLocal(cam); treeSet.assign(cam.x, cam.z, true); } else treeSet.assign(0, 0, true); }
    return {
      update(dt) {
        const still = motionReduced();
        dt = Math.min(0.1, Math.max(0, dt || 0));
        U.uTime.value = (U.uTime.value + dt * (still ? 0.35 : 1)) % 3600;
        U.uWindAmp.value = still ? 0.3 : 1;
        if (!still) jetT = (jetT + dt) % 3600;
        U.uJetT.value = still ? 0.37 : jetT;
        birdT = (birdT + dt * (still ? 0.4 : 1)) % 3600; U.uBirdT.value = birdT; U.uFlap.value = still ? 0 : 1;
        if (!still) U.uFishT.value = (U.uFishT.value + dt) % 3600;
        if (veils) {
          const W = G.sys && G.sys.weather, h = W && Number.isFinite(W.hour) ? W.hour : 12, id = W && (W.current || W.id || W.weather);
          const dawn = smooth(4.6, 5.8, h) * (1 - smooth(7.4, 9.3, h)), fogw = /FOG/.test(String(id || '')) ? 0.6 : 0;
          U.uVeil.value = Math.max(dawn, fogw);
          veils.visible = U.uVeil.value > 0.01;
        }
        if (treeSet) {
          const E = G.sys && G.sys.engine;
          if (E && E.camera) { cam.copy(E.camera.position); root.worldToLocal(cam); treeSet.assign(cam.x, cam.z, false); }
        }
      },
      dispose() {
        if (offHaze) offHaze();
        if (grove) { try { grove.dispose(); } catch (e) { /* ignore */ } }
        if (treeSet) treeSet.dispose();
        for (const b of buses) { if (b.userData.dispose) b.userData.dispose(); }
        root.traverse((o) => { if (o.isInstancedMesh && o.dispose) o.dispose(); });
        for (const x of owned) { try { if (x.isTexture && x.userData && (x.userData.packed || x.userData.blank)) continue; x.dispose(); } catch (e) { /* ignore */ } }
        owned.length = 0;
        root.removeFromParent();
        if (G.complexLandscape.root === root) { G.complexLandscape.root = null; G.complexLandscape.debug = null; }
      },
    };
  }
  G.complexLandscape._build = build;
  G.complexLandscape.bus = bus;
  CX.add('landscape', (ctx, C) => build(ctx, C), 10);
})();
