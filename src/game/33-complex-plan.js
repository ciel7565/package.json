// =============================================================================
// 33-complex-plan.js — the master plan of 만장대 단지 (PL_ALLOT) as DATA: G.data.complex (CONTRACT §16.8)
//
// PURE DATA + PURE FUNCTIONS: no THREE, no DOM, no G.sys at evaluation — it also runs in bare Node (tests/complex-plan.mjs
// evaluates it in node:vm with a stub G). allot-client (the 2D map), complex-site (the 3D environment) and complex-units (the
// 10,000 instanced units) all build on it: change numbers HERE, never copy them into those files.
//
// Look target: assets/reference/03-concept-main.webp (the owner's aerial view), 04 for the river side, 02 for what each area is
// for. Seen from the south-south-west as in the picture: the river and a two-lane road along the west edge, the roundabout with
// its pine garden and fountain front-left, the parking, the grand main building (본관) left of centre with the hanok village on
// a terrace behind it, the great jar circle (8 aisles, a small plaza, a low stone wall) in front right of centre, the roofed
// corridor (회랑) along its north edge to the two-tier pavilion (정자) on a knoll, the jar amphitheatre (half rings climbing the
// hill) top-right with the straight field terraces above it, steep forested mountains all round, the valley opening north-west
// where the river comes from.
//
// ---------------------------------------------------------------------------------------------------------------------------
// COORDINATES  local metres of the place (PL_ALLOT origin = world (0, 2600)); x east, z SOUTH, y up (north = −z, as the valley).
//              rot is about +y with the front = +z at rot 0 (π/2 faces east): facing (dx, dz) ⇒ rot = atan2(dx, dz).
//              bounds x −190 … 190, z −150 … 170 (the south strip 150 … 170 is the slope with the viewpoint deck; every unit
//              lies inside x −190 … 190, z −150 … 150).
//
// FINAL PLAN (replaces the starting numbers of §16.8 — measured against image 3 with the massing preview, see the report)
// | thing                         | where (x, z)                         | size / numbers                                              |
// |-------------------------------|--------------------------------------|-------------------------------------------------------------|
// | river (water y −0.9 … 6.0)    | centre line (−214,−210) … (−172,80) … (−194,240) | 18 m wide, boulders on both banks, flows south      |
// | stone arch bridge (footbridge)| (−192,96) → (−156,96)                | 4 m wide, 3 arches, deck 2.6 m over the water               |
// | road (2 lanes, 8 m)           | north (−158,−150) along the river → roundabout → south (−92,120) → east along z 134 → (190,134); spur SW to (−160,152) |
// | roundabout                    | centre (−104, 46)                    | island r 19 (pine garden, fountain r 4), outer r 30, lane r 24.5 |
// | parking                       | x −142 … −112, z −50 … 6             | 84 bays 2.5 × 5 m in 4 columns                              |
// | bus bay + stop (arrival)      | bay x −74 … −68, z 30 … 52; stop (−69.5, 41) | spawn (−60, 41) facing east on the entrance plaza   |
// | entrance plaza                | x −72 … −48, z 14 … 70               | stone paving, signposts, lamps                              |
// | main building 본관            | centre (−66, −18), 66 × 42           | core 40 × 42, 3 floors on a 1.2 m podium, two-tier hip-and-gable roof; wings 13 × 30, 2 floors; portico 20 × 10 to the south; door (−66, 3.2) |
// | café 카페                     | centre (−60, 78), 20 × 12            | on the plaza, terrace deck 20 × 6 to the south              |
// | hanok village (12 houses)     | terrace x −38 … 50, z −112 … −46, +2 m | 4 columns x −26/−4/18/40 × 3 rows z −56/−76/−96, houses 11–13 × 7.5, 4 m lanes |
// | corridor 회랑                 | (−33,−16) → (78,−16) → (85.5,−1.5)   | 4.4 m wide, roofed, along the circle's north edge           |
// | pavilion 정자                 | (90, 4) on a 3 m knoll (r 7)         | 9 × 9, two tiers                                            |
// | GREAT JAR CIRCLE              | centre (14, 52)                      | plaza r 9.6; 27 rings r 11 … 59 (3 rings of 1.6 m + a 2.4 m ring walk = 5.6 m); 8 radial aisles 4 m wide; wall r 61.6 with gates S/W/N/E; bowl 0.075 m per m (0.12 per ring) |
// | gate house 정문               | (−31.6, 97.6) in the SW wall, rot −π/4 | 12 × 6, 4.2 m passage on the 135° aisle; forecourt to the road |
// | JAR AMPHITHEATRE              | centre (114, −62), north half        | same 27 half rings r 11 … 59, aisles at 180/225/270/315/360°, 9 terraces of +0.45 m |
// | fields (3 terraced blocks)    | N x −24 … 165, z −149 … −131; E x 149 … 186, z −28 … 64; SE x 108 … 183, z 74 … 120 | beds 1.0 × 1.5 m, 0.4 m paths, 1.2 m walk per 2 rows (4.6 m terraces), 1.6 m cross aisle every 10 beds |
// | storehouse yard (2 rows)      | 8 long houses x −144 … −67.2, centres z −62.6 − 11 k | each 76.8 × 6.6 m, 63 bays of 1.2 × 3 m per side, 4.4 m lanes |
// | 옹기 workshop + climbing kiln | (−50, −128), kiln (−50, −134 … −149) | 12 × 9                                                      |
// | overflow field                | x 100 … 146, z 14 … 66               | any kind on a 2 m grid, 360 places                          |
// | viewpoint deck 전망 데크      | (−58, 160), top y 22                 | 14 × 10, three stair legs from the road at (−112, 141); the forest is cleared in its view |
// | aerial camera (= image 3)     | (−23, 110, 189) → (−25, 0, −2), vfov 48 | fitted to 7 landmarks of the picture (rms error 0.05 of the half frame) |
// | slots, default preset         | J01 GC-SW · J02 GC-NW · J03 GC-NE · J04 GC-SE · J05 AM-W · J06 AM-E · P01 N · P02 E · P03 SE · S01 houses 1–4 · S02 houses 5–8 |
// | capacity                      | jar slot 1,008 (natural) · plot slot 1,000 · store slot 500 · overflow 360 | default 10,000 = exactly placed      |
//
// ---------------------------------------------------------------------------------------------------------------------------
// API (all pure; arrays are plain JS / typed arrays)
//   C.K                         constants (JAR_PITCH 1.25, RING_SPACING 1.6, RING_WALK 2.4, AISLE_W 4, BED_W 1, BED_D 1.5 …)
//   C.bounds                    { minX, maxX, minZ, maxZ }  (the walkable rectangle of the place)
//   C.elements                  [{ id, type, … }] every drawable thing in plan coordinates (types: river, bridge, road, roundabout,
//                               garden, parking, busbay, plaza, building, corridor, wall, gate, stair, ramp, deck, terrace, field,
//                               jarcircle, amphitheatre, storeyard, lamp, sign, forest, knoll, kiln, rock, pine, fountain)
//   C.byId(id)                  one element
//   C.height(x, z)              terrain y (smooth; level under buildings; bowl, terraces, knolls, river bed, mountains)
//   C.waterY(x, z)              water surface y of the river at the nearest point (or −Infinity far from it); C.inWater(x, z)
//   C.slots                     [{ id, kind, type 'ring'|'grid', name, cap, limit, sys? }]
//   C.defaultZones()            the server's default preset as map zones [{ code, kind, name, cap, sort }]
//   C.layout(zones)             → L (below); zones = map.php zones ({ code, kind, name, cap | capacity | count | s }) in sort order
//   L.zones                     [{ code, kind, name, slot, slots: [{ slot, from, n }], count, placed, unplaced, frame }]
//   L.unit(code, seq)           { x, y, z, rot, kind, ring, variant, zone, seq, slot, i } | null (null = unknown or not placed)
//   L.unitAt(x, z, pad = 0)     { zone, seq } | null        O(1): polar arithmetic for rings, grid arithmetic for blocks
//   L.index(code, seq)          the flat index i (0 … L.count − 1) or −1;  L.arrays { x, y, z, rot, kind, zone, seq, variant, ring }
//   L.cells()                   = C.cells(L): { size 44, nx, nz, list: [{ id, i, j, x0, z0, x1, z1, units: { jar, plot, store }
//                               (Int32Array of flat indices), count, sphere: { x, y, z, r } }], at(x, z) }
//   C.paths                     [{ id, kind, w, pts: [[x, z], …], ys?, arc?: { cx, cz, r, a0, a1 } }] aisles, walks, roads, lanes, stairs
//   C.walkable(x, z)            not water / building / wall / unit / outside the bounds
//   C.spawn, C.viewpoints, C.busStop, C.door (main building door), C.pathDistance(x, z)
//   C.draw(ctx2d, view, opts)   THE 2D site plan (panel map + minimap). view = { x, z, scale (px per m), w, h } (C.fitView helps);
//                               opts = { layout, unitStyle(zoneCode, seq, kind, i) → css colour | null, units, labels, relief,
//                               highlight: { zone, seq }, quality: 'low'|'high' }
//   C.use(L) / C.current()      the layout C.unit / C.unitAt use (default: the default preset)
// =============================================================================

(function () {
  'use strict';
  const PI = Math.PI, TAU = PI * 2;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
  const r3 = (v) => Math.round(v * 1000) / 1000;
  const normA = (a) => { a %= TAU; return a < 0 ? a + TAU : a; };

  // ------------------------------------------------------------------ deterministic noise (same in Node and browsers)
  function hashI(ix, iz) {
    let h = (Math.imul(ix | 0, 374761393) + Math.imul(iz | 0, 668265263)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }
  function vnoise(x, z) {
    const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz;
    const ux = fx * fx * (3 - 2 * fx), uz = fz * fz * (3 - 2 * fz);
    const a = hashI(ix, iz), b = hashI(ix + 1, iz), c = hashI(ix, iz + 1), d = hashI(ix + 1, iz + 1);
    return lerp(lerp(a, b, ux), lerp(c, d, ux), uz);
  }
  const fbm = (x, z) => vnoise(x, z) * 0.55 + vnoise(x * 2.07 + 13.1, z * 2.07 - 7.3) * 0.3 + vnoise(x * 4.3 - 3.7, z * 4.3 + 9.9) * 0.15;
  function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; }

  // ------------------------------------------------------------------ geometry helpers
  function segD2(px, pz, ax, az, bx, bz) {
    const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
    const t = l2 > 0 ? clamp(((px - ax) * dx + (pz - az) * dz) / l2, 0, 1) : 0;
    const qx = ax + dx * t - px, qz = az + dz * t - pz;
    return { d2: qx * qx + qz * qz, t };
  }
  /** nearest point on a polyline: { d, seg, t, s (distance along) } */
  function polyNear(px, pz, pts) {
    let best = Infinity, bi = 0, bt = 0, s = 0, bs = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1], len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const r = segD2(px, pz, a[0], a[1], b[0], b[1]);
      if (r.d2 < best) { best = r.d2; bi = i; bt = r.t; bs = s + len * r.t; }
      s += len;
    }
    return { d: Math.sqrt(best), seg: bi, t: bt, s: bs };
  }
  const polyLen = (pts) => { let s = 0; for (let i = 0; i < pts.length - 1; i++) s += Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]); return s; };
  /** signed distance to an axis-aligned rectangle (≤ 0 inside) */
  function rectSD(x, z, x0, z0, x1, z1) {
    const dx = Math.max(x0 - x, x - x1), dz = Math.max(z0 - z, z - z1);
    if (dx <= 0 && dz <= 0) return Math.max(dx, dz);
    return Math.hypot(Math.max(dx, 0), Math.max(dz, 0));
  }
  function pointInPoly(x, z, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i][0], zi = poly[i][1], xj = poly[j][0], zj = poly[j][1];
      if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
    }
    return inside;
  }

  // ================================================================== constants and the plan numbers
  const K = Object.freeze({
    JAR_PITCH: 1.25, RING_SPACING: 1.6, RING_WALK: 2.4, RING_GROUP: 3, RING_PERIOD: 5.6, RING_R0: 11, RING_ROWS: 27,
    AISLE_W: 4.0, JAR_R: 0.45, JAR_HIT: 0.55, WALK_W: 1.6, BOWL_SLOPE: 0.075, AMPH_RISE: 0.45, PLAZA_R: 9.6, WALL_R: 61.6,
    BED_W: 1.0, BED_D: 1.5, BED_PATH: 0.4, FIELD_WALK: 1.2, FIELD_PERIOD: 4.6, FIELD_GROUP: 10, FIELD_AISLE: 1.6,
    BAY_W: 1.2, BAY_D: 3.0, HOUSE_W: 6.6, HOUSE_SPINE: 0.6, STORE_LANE: 4.4, STORE_PITCH: 11, BAYS_PER_SIDE: 63,
    OVER_PITCH: 2.0, CELL: 44, STEP_MAX: 0.5, AVENUE_MIN: 4.0,
    MIN_SPACING: Object.freeze({ jar: 1.24, plot: 1.39, store: 1.19, over: 1.99 }),
    KINDS: Object.freeze(['jar', 'plot', 'store']),
  });
  const KIND_ID = { jar: 0, plot: 1, store: 2 };

  const bounds = Object.freeze({ minX: -190, maxX: 190, minZ: -150, maxZ: 170 });
  const unitBounds = Object.freeze({ minX: -190, maxX: 190, minZ: -150, maxZ: 150 });

  // river centre line with the water surface y per vertex (it falls towards the south)
  const RIVER = { w: 18, pts: [[-214, -210, 6.0], [-206, -150, 4.6], [-198, -90, 3.2], [-188, -30, 1.8], [-178, 30, 0.4], [-172, 80, -0.4], [-174, 130, -0.9], [-182, 180, -1.3], [-194, 240, -1.8]] };
  const RIVER_XZ = RIVER.pts.map((p) => [p[0], p[1]]);
  // the roads that leave the site (north along the river, east along the south edge, south-west to the bridge)
  const ROAD_LINES = [[[-158, -170], [-154, -110], [-151, -60]], [[60, 134], [140, 134], [200, 134]], [[-151, 96], [-155, 130], [-160, 175]]];

  const GC = { id: 'GC', cx: 14, cz: 52, sectors: [0, 1, 2, 3, 4, 5, 6, 7] };   // the great circle
  const AM = { id: 'AM', cx: 114, cz: -62, sectors: [4, 5, 6, 7] };              // the amphitheatre (north half: a ∈ [π, 2π])
  const RING_SYS = [GC, AM];
  const ROUND = { cx: -104, cz: 46, r0: 19, r1: 30, lane: 24.5 };
  const GATE = { x: GC.cx + 64.5 * Math.cos(PI * 0.75), z: GC.cz + 64.5 * Math.sin(PI * 0.75), rot: -PI / 4 };   // the main gate house faces south-west (image 3)
  const MAIN = { x: -66, z: -18, w: 66, d: 42 };
  const VILLAGE = { x0: -38, z0: -112, x1: 50, z1: -46, cols: [-26, -4, 18, 40], rows: [-56, -76, -96], hw: 6.5, hd: 3.75, raise: 2.0 };
  const KNOLL = { cx: 90, cz: 4, r: 7, rise: 3.0 };
  const DECK = { x: -58, z: 160, w: 14, d: 10, y: 22 };
  const YARD = { x0: -144, len: K.BAYS_PER_SIDE * K.BAY_W + 1.2, zc0: -62.6, houses: 8 };
  const OVER = { x0: 100, z0: 14, x1: 146, z1: 66 };

  // ================================================================== terrain: base slope + mountains + pads + river
  function riverNear(x, z) { return polyNear(x, z, RIVER_XZ); }
  function riverX(z) {                                   // x of the centre line at z (the line is monotonic in z)
    const P = RIVER.pts;
    if (z <= P[0][1]) return P[0][0];
    for (let i = 0; i < P.length - 1; i++) if (z <= P[i + 1][1]) return lerp(P[i][0], P[i + 1][0], (z - P[i][1]) / (P[i + 1][1] - P[i][1]));
    return P[P.length - 1][0];
  }
  function riverWaterY(n) {
    const P = RIVER.pts, a = P[n.seg], b = P[n.seg + 1];
    return lerp(a[2], b[2], n.t);
  }
  const ease = (d, L) => (d <= 0 ? 0 : 1 - Math.exp(-d / L));
  function mountains(x, z) {
    const dN = -152 - z, dS = z - 141, dE = x - 192, dW = (riverX(z) - 16) - x;
    if (dN <= -30 && dS <= -30 && dE <= -30 && dW <= -30) return 0;
    const n = fbm(x * 0.018, z * 0.018), n2 = vnoise(x * 0.05 + 40, z * 0.05 - 17);
    const rn = riverNear(x, z).d, valley = 1 - 0.78 * Math.exp(-Math.pow(rn / 48, 2));       // the valley opens along the river
    let rd = Infinity;
    for (const pts of ROAD_LINES) rd = Math.min(rd, polyNear(x, z, pts).d);
    const road = 1 - Math.exp(-Math.pow(rd / 16, 2));                                          // the roads leave through cuts
    const hN = 92 * ease(dN, 55) * (0.75 + 0.5 * n) * valley;
    const hS = 58 * ease(dS, 34) * (0.8 + 0.4 * n);
    const hE = 76 * ease(dE, 46) * (0.75 + 0.5 * n);
    const hW = 70 * ease(dW, 26) * (0.7 + 0.6 * n2) * (0.55 + 0.45 * valley);              // rocky cliffs beyond the far bank
    const m = Math.max(hN, hS, hE, hW), sum = hN + hS + hE + hW;
    return (m + 0.3 * (sum - m)) * road;
  }
  function baseSlope(z) {
    let h = 0.6;
    if (z < 30) h += (30 - z) * 0.028;
    if (z < -40) h += (-40 - z) * 0.05;
    return h;
  }
  const base = (x, z) => baseSlope(z) + mountains(x, z);

  // pads: { sd(x, z) → signed distance (≤ 0 inside), blend, h(x, z) → level }. Later pads win.
  const PADS = [];
  const padRect = (id, x0, z0, x1, z1, level, blend) => PADS.push({ id, sd: (x, z) => rectSD(x, z, x0, z0, x1, z1), blend, h: typeof level === 'function' ? level : () => level });
  const padCircle = (id, cx, cz, r, level, blend) => PADS.push({ id, sd: (x, z) => Math.hypot(x - cx, z - cz) - r, blend, h: typeof level === 'function' ? level : () => level });

  // the great circle bowl: rim at the site level, the plaza 3.9 m lower (0.12 m per ring)
  const GC_RIM = baseSlope(GC.cz);
  function gcLevel(x, z) { const r = Math.hypot(x - GC.cx, z - GC.cz); return GC_RIM - K.BOWL_SLOPE * (K.WALL_R - clamp(r, K.PLAZA_R, K.WALL_R)); }
  // the amphitheatre: 9 terraces of +0.45 m; the riser sits in the outer 0.3 m of each ring walk (just inside the next jars)
  const AM_L0 = baseSlope(AM.cz);
  function amTerrace(r) {
    let h = 0;
    for (let k = 0; k < 9; k++) { const edge = K.RING_R0 + K.RING_PERIOD * k - 0.6; h += K.AMPH_RISE * smooth(edge - 0.15, edge + 0.15, r); }
    return h;
  }
  const amLevel = (x, z) => AM_L0 + amTerrace(Math.hypot(x - AM.cx, z - AM.cz));
  // the village terrace
  const VILLAGE_Y = baseSlope((VILLAGE.z0 + VILLAGE.z1) / 2) + VILLAGE.raise;
  const MAIN_Y = baseSlope(MAIN.z);
  const KNOLL_Y = baseSlope(KNOLL.cz) + KNOLL.rise;

  // ------------------------------------------------------------------ fields (terraced blocks) — frames in a (u, v) system
  // block: origin (ox, oz) = the corner where u = 0, v = 0; (ux, uz) along the rows, (vx, vz) across them (the terrace steps
  // up along +v); rows = bed rows (2 per terrace); n = beds per row; rise(t) → level of terrace t.
  function fieldBlock(id, name, ox, oz, ux, uz, vx, vz, rows, n, riseFn) {
    const period = K.FIELD_PERIOD, terr = Math.ceil(rows / 2);
    const groupLen = K.FIELD_GROUP * (K.BED_W + K.BED_PATH) - K.BED_PATH + K.FIELD_AISLE;     // 10 beds + one cross aisle
    const groups = Math.ceil(n / K.FIELD_GROUP);
    const lenU = (groups - 1) * groupLen + (n - (groups - 1) * K.FIELD_GROUP) * (K.BED_W + K.BED_PATH) - K.BED_PATH;
    const lenV = terr * period;
    const levels = [];
    for (let t = 0; t < terr; t++) levels.push(riseFn(t, ox + ux * lenU / 2 + vx * (t + 0.5) * period, oz + uz * lenU / 2 + vz * (t + 0.5) * period));
    return { id, name, ox, oz, ux, uz, vx, vz, rows, n, terr, period, groupLen, lenU, lenV, levels };
  }
  const fu = (B, x, z) => (x - B.ox) * B.ux + (z - B.oz) * B.uz;
  const fv = (B, x, z) => (x - B.ox) * B.vx + (z - B.oz) * B.vz;
  const fxz = (B, u, v) => [B.ox + B.ux * u + B.vx * v, B.oz + B.uz * u + B.vz * v];
  function fieldLevel(B, x, z) {
    const v = clamp(fv(B, x, z), 0, B.lenV - 1e-6);
    const t = Math.floor(v / B.period), w = v - t * B.period;
    const lo = B.levels[Math.max(0, t - 1)], hi = B.levels[t];
    return t === 0 ? hi : lerp(lo, hi, smooth(0, 0.3, w));                             // the riser: the first 0.3 m of the walk
  }
  function fieldSD(B, x, z) {
    const u = fu(B, x, z), v = fv(B, x, z);
    return rectSD(u, v, -1.2, -0.2, B.lenU + 1.2, B.lenV + 0.2);
  }
  // north strip (steps up to the north, follows the hill), east strip (north, follows the hill), south-east block (+0.3 m a terrace)
  const FIELDS = [
    fieldBlock('F_N', '약초 계단밭 (북쪽)', -24, -130.6, 1, 0, 0, -1, 8, 125, (t, x, z) => baseSlope(z) - 0.2),
    fieldBlock('F_E', '약초 계단밭 (동쪽)', 149, 64, 1, 0, 0, -1, 40, 25, (t, x, z) => baseSlope(z) - 0.1),
    fieldBlock('F_SE', '약초 계단밭 (남동쪽)', 108, 74, 1, 0, 0, 1, 20, 50, (t) => 0.6 + 0.3 * t),
  ];

  // ------------------------------------------------------------------ storehouses
  const HOUSES = [];
  for (let k = 0; k < YARD.houses; k++) {
    const zc = YARD.zc0 - K.STORE_PITCH * k;
    HOUSES.push({ k, x0: YARD.x0, x1: YARD.x0 + YARD.len, zc, z0: zc - K.HOUSE_W / 2, z1: zc + K.HOUSE_W / 2, y: baseSlope(zc) });
  }

  // ------------------------------------------------------------------ pads in order (later wins)
  padRect('P_PARK', -142, -50, -112, 6, (x, z) => baseSlope(z), 3);
  padRect('P_VILLAGE', VILLAGE.x0, VILLAGE.z0, VILLAGE.x1, VILLAGE.z1, VILLAGE_Y, 12);
  padRect('P_MAIN', MAIN.x - MAIN.w / 2 - 1, MAIN.z - MAIN.d / 2 - 1, MAIN.x + MAIN.w / 2 + 1, MAIN.z + MAIN.d / 2 + 11, MAIN_Y, 9);
  padCircle('P_GC', GC.cx, GC.cz, K.WALL_R + 1.0, gcLevel, 6);
  padCircle('P_KNOLL', KNOLL.cx, KNOLL.cz, KNOLL.r, KNOLL_Y, 10);
  PADS.push({ id: 'P_AM', blend: 6, h: amLevel, sd: (x, z) => { const r = Math.hypot(x - AM.cx, z - AM.cz); return Math.min(Math.max(r - (K.WALL_R + 0.8), z - AM.cz), r - 12); } });
  for (const B of FIELDS) PADS.push({ id: 'P_' + B.id, blend: 4, h: (x, z) => fieldLevel(B, x, z), sd: (x, z) => fieldSD(B, x, z) });
  for (const H of HOUSES) padRect('P_SH' + H.k, H.x0 - 1, H.z0 - 0.4, H.x1 + 1, H.z1 + 0.4, H.y, 2.2);
  padRect('P_WORKSHOP', -57, -133, -43, -123, baseSlope(-128), 4);
  padRect('P_CAFE', -71, 71, -49, 91, baseSlope(81), 3);
  PADS.push({ id: 'P_GATE', blend: 1.5, h: () => GC_RIM, sd: (x, z) => { const lx = (x - GATE.x) * Math.cos(GATE.rot) - (z - GATE.z) * Math.sin(GATE.rot), lz = (x - GATE.x) * Math.sin(GATE.rot) + (z - GATE.z) * Math.cos(GATE.rot); return rectSD(lx, lz, -7.5, -3.4, 7.5, 3.4); } });
  padRect('P_OVER', OVER.x0, OVER.z0, OVER.x1, OVER.z1, (x, z) => baseSlope(z), 3);
  padCircle('P_DECK', DECK.x, DECK.z, 8, DECK.y - 0.4, 14);

  function heightNoRiver(x, z) {
    let h = base(x, z);
    for (let i = 0; i < PADS.length; i++) {
      const p = PADS[i], d = p.sd(x, z);
      if (d >= p.blend) continue;
      const w = d <= 0 ? 1 : 1 - smooth(0, p.blend, d);
      h = lerp(h, p.h(x, z), w);
    }
    return h;
  }
  function height(x, z) {
    let h = heightNoRiver(x, z);
    const n = riverNear(x, z), hw = RIVER.w / 2;
    if (n.d < hw + 26) {
      const wy = riverWaterY(n);
      const bank = wy + 0.5 + Math.pow(Math.max(0, n.d - hw), 1.15) * 0.9;              // the bank climbs steeply out of the water
      const bed = wy - 0.5 - 1.6 * (1 - Math.pow(Math.min(1, n.d / hw), 2));
      const cut = n.d < hw ? Math.min(bed, bank) : bank;
      if (cut < h) h = n.d < hw ? cut : lerp(h, cut, 1);
      if (n.d < hw && h > bed) h = bed;
    }
    return h;
  }
  function waterY(x, z) { const n = riverNear(x, z); return n.d < RIVER.w / 2 + 0.5 ? riverWaterY(n) : -Infinity; }
  const inWater = (x, z) => riverNear(x, z).d < RIVER.w / 2 - 0.3;

  // ================================================================== ring systems (jars) — geometry of rows and sectors
  // rows: r = R0 + 5.6 k + 1.6 j (k = 0 … 8, j = 0 … 2); sector s spans a ∈ [s π/4, (s+1) π/4], aisles on the sector borders.
  const ROWS = [];
  for (let k = 0; ; k++) {
    let stop = false;
    for (let j = 0; j < 3; j++) { if (ROWS.length >= K.RING_ROWS) { stop = true; break; } ROWS.push(K.RING_R0 + K.RING_PERIOD * k + K.RING_SPACING * j); }
    if (stop) break;
  }
  const SEC = PI / 4;
  /** natural row geometry: { r, del (angular clearance from each aisle), span, th (min step), nat (jars that fit) } */
  const ROWGEO = ROWS.map((r) => {
    const del = Math.asin((K.AISLE_W / 2 + K.JAR_R) / r), span = SEC - 2 * del, th = 2 * Math.asin(K.JAR_PITCH / 2 / r);
    return { r, del, span, th, nat: Math.floor(span / th + 1e-9) + 1 };
  });
  const ringRowOf = (r) => {                                             // nearest row index to radius r (O(1)) or −1
    const k = Math.floor((r - K.RING_R0 + 1.2) / K.RING_PERIOD);
    if (k < 0) return -1;
    const j = Math.round((r - (K.RING_R0 + K.RING_PERIOD * k)) / K.RING_SPACING);
    if (j < 0 || j > 2) return -1;
    const i = k * 3 + j;
    return i < ROWS.length ? i : -1;
  };
  // the ground under a unit equals height() there (no later pad or the river reaches a unit — tests/complex-plan.mjs checks it)
  const sysLevel = (sys, x, z) => (sys === GC ? gcLevel(x, z) : amLevel(x, z));

  // ================================================================== slots
  const SLOTS = [];
  const ringSlot = (id, name, sys, sectors, cap) => {
    const nat = ROWGEO.reduce((a, g) => a + g.nat * sectors.length, 0);
    SLOTS.push({ id, kind: 'jar', type: 'ring', name, sys: sys.id, sectors, cap, limit: nat });
  };
  ringSlot('GC_SW', '큰 원 남서쪽', GC, [2, 3], 1000);
  ringSlot('GC_NW', '큰 원 북서쪽', GC, [4, 5], 1000);
  ringSlot('GC_NE', '큰 원 북동쪽', GC, [6, 7], 1000);
  ringSlot('GC_SE', '큰 원 남동쪽', GC, [0, 1], 1000);
  ringSlot('AM_W', '반원 계단 서쪽', AM, [4, 5], 1000);
  ringSlot('AM_E', '반원 계단 동쪽', AM, [6, 7], 1000);
  // grid slots share one engine: rows (v offsets, period pattern) × columns (u offsets, groups with an aisle)
  for (const B of FIELDS) {
    const BB = B;
    SLOTS.push({ id: B.id, kind: 'plot', type: 'grid', name: B.name, cap: B.rows * B.n, limit: B.rows * B.n,
      g: { ox: B.ox, oz: B.oz, ux: B.ux, uz: B.uz, vx: B.vx, vz: B.vz, rows: B.rows, n: B.n,
        rowV: (i) => Math.floor(i / 2) * B.period + K.FIELD_WALK + K.BED_D / 2 + (i % 2) * (K.BED_D + K.BED_PATH),
        rowOf: (v) => { const t = Math.floor(v / B.period), w = v - t * B.period; const j = Math.round((w - K.FIELD_WALK - K.BED_D / 2) / (K.BED_D + K.BED_PATH)); return j < 0 || j > 1 ? -1 : t * 2 + j; },
        colU: (c) => Math.floor(c / K.FIELD_GROUP) * B.groupLen + (c % K.FIELD_GROUP) * (K.BED_W + K.BED_PATH) + K.BED_W / 2,
        colOf: (u) => { const g = Math.floor(u / B.groupLen), w = u - g * B.groupLen; const c = Math.round((w - K.BED_W / 2) / (K.BED_W + K.BED_PATH)); return c < 0 || c >= K.FIELD_GROUP ? -1 : g * K.FIELD_GROUP + c; },
        hu: K.BED_W / 2, hv: K.BED_D / 2, faceRow: (i) => (i % 2 === 0 ? -1 : 1), level: (x, z) => fieldLevel(BB, x, z) } });
  }
  // storehouses: v runs north (−z) from the south face of house 0; side 0 = south bays (door south), side 1 = north bays
  const storeG = (houses, id, name) => {
    const z0 = HOUSES[houses[0]].z1;                        // south face of the first house of the row
    const rowCount = houses.length * 2;
    return { id, kind: 'store', type: 'grid', name, cap: 500, limit: 500, houses,
      g: { ox: YARD.x0 + 0.6, oz: z0, ux: 1, uz: 0, vx: 0, vz: -1, rows: rowCount, n: K.BAYS_PER_SIDE,
        rowV: (i) => Math.floor(i / 2) * K.STORE_PITCH + (i % 2 === 0 ? K.BAY_D / 2 : K.HOUSE_W - K.BAY_D / 2),
        rowOf: (v) => { const t = Math.floor(v / K.STORE_PITCH), w = v - t * K.STORE_PITCH; if (t < 0 || t >= houses.length) return -1; if (w >= 0 && w <= K.BAY_D) return t * 2; if (w >= K.HOUSE_W - K.BAY_D && w <= K.HOUSE_W) return t * 2 + 1; return -1; },
        colU: (c) => c * K.BAY_W + K.BAY_W / 2, colOf: (u) => { const c = Math.floor(u / K.BAY_W); return c < 0 || c >= K.BAYS_PER_SIDE ? -1 : c; },
        hu: K.BAY_W / 2 - 0.05, hv: K.BAY_D / 2, faceRow: (i) => (i % 2 === 0 ? -1 : 1), level: (x, z) => HOUSES[houses[0] + Math.floor(Math.max(0, (z0 - z)) / K.STORE_PITCH)].y } };
  };
  SLOTS.push(storeG([0, 1, 2, 3], 'SY_A', '창고 앞줄 (1~4동)'));
  SLOTS.push(storeG([4, 5, 6, 7], 'SY_B', '창고 뒷줄 (5~8동)'));
  // the overflow field: any kind on a 2 m grid; rows in pairs between 1.6 m walks
  const OVR = { id: 'OVER', kind: '*', type: 'grid', name: '임시 자리 (넘친 자리)', cap: 0, limit: 0,
    g: { ox: OVER.x0 + 2, oz: OVER.z0, ux: 1, uz: 0, vx: 0, vz: 1, rows: 18, n: 20,
      rowV: (i) => Math.floor(i / 2) * 5.6 + 2.6 + (i % 2) * 2.0,
      rowOf: (v) => { const t = Math.floor(v / 5.6), w = v - t * 5.6; const j = Math.round((w - 2.6) / 2.0); return j < 0 || j > 1 || Math.abs(w - 2.6 - 2 * j) > 0.75 ? -1 : t * 2 + j; },
      colU: (c) => Math.floor(c / 10) * 22 + (c % 10) * 2 + 1, colOf: (u) => { const g = Math.floor(u / 22), w = u - g * 22; const c = Math.round((w - 1) / 2); return c < 0 || c >= 10 ? -1 : g * 10 + c; },
      hu: 0.7, hv: 0.7, faceRow: (i) => (i % 2 === 0 ? -1 : 1), level: (x, z) => height(x, z) } };
  OVR.limit = OVR.g.rows * OVR.g.n;
  SLOTS.push(OVR);
  const SLOT_BY_ID = new Map(SLOTS.map((s) => [s.id, s]));
  const IS_RING = Uint8Array.from(SLOTS.map((s) => (s.type === 'ring' ? 1 : 0)));
  const SLOT_IDX = new Map(SLOTS.map((s, i) => [s.id, i]));
  const SECTOR_SLOT = { GC: new Array(8).fill(-1), AM: new Array(8).fill(-1) };
  SLOTS.forEach((s, i) => { if (s.type === 'ring') for (const sec of s.sectors) SECTOR_SLOT[s.sys][sec] = i; });
  const sysOf = (id) => (id === 'GC' ? GC : AM);

  // grid slot region (for unitAt): bounding (u, v) rectangle + the numeric pattern of rows and columns
  //   rowV(i) = ⌊i/2⌋·P + (i odd ? o1 : o0)        colU(c) = ⌊c/G⌋·GL + (c mod G)·pitch + c0
  const GRIDNUM = { F: { P: K.FIELD_PERIOD, o0: K.FIELD_WALK + K.BED_D / 2, o1: K.FIELD_WALK + K.BED_D * 1.5 + K.BED_PATH, G: K.FIELD_GROUP, pitch: K.BED_W + K.BED_PATH, c0: K.BED_W / 2 },
    S: { P: K.STORE_PITCH, o0: K.BAY_D / 2, o1: K.HOUSE_W - K.BAY_D / 2, G: K.BAYS_PER_SIDE, GL: K.BAYS_PER_SIDE * K.BAY_W, pitch: K.BAY_W, c0: K.BAY_W / 2 },
    O: { P: 5.6, o0: 2.6, o1: 4.6, G: 10, GL: 22, pitch: 2, c0: 1 } };
  for (const s of SLOTS) if (s.type === 'grid') {
    const g = s.g;
    Object.assign(g, s.kind === 'plot' ? Object.assign({ GL: FIELDS.find((f) => f.id === s.id).groupLen }, GRIDNUM.F) : s.kind === 'store' ? GRIDNUM.S : GRIDNUM.O);
    for (let i = 0; i < Math.min(g.rows, 6); i++) if (Math.abs(g.rowV(i) - (Math.floor(i / 2) * g.P + (i & 1 ? g.o1 : g.o0))) > 1e-9) throw new Error('complex-plan: row pattern of ' + s.id);
    for (let c = 0; c < Math.min(g.n, 25); c++) if (Math.abs(g.colU(c) - (Math.floor(c / g.G) * g.GL + (c % g.G) * g.pitch + g.c0)) > 1e-9) throw new Error('complex-plan: column pattern of ' + s.id);
    g.maxU = g.colU(g.n - 1) + g.hu + 0.01;
    g.maxV = g.rowV(g.rows - 1) + g.hv + 0.01;
  }

  // ================================================================== zones → layout
  const DEFAULT_PRESET = [['J', 'jar', 6, 1000, '장독대 %d구역'], ['P', 'plot', 3, 1000, '텃밭 %d구역'], ['S', 'store', 2, 500, '창고 %d동']];
  function defaultZones() {
    const out = [];
    let sort = 0;
    for (const [p, kind, n, cap, pat] of DEFAULT_PRESET) for (let i = 1; i <= n; i++) out.push({ code: p + String(i).padStart(2, '0'), kind, name: pat.replace('%d', String(i)), cap, sort: ++sort });
    return out;
  }
  function normZones(zones) {
    const out = [], seen = new Set();
    (Array.isArray(zones) ? zones : []).forEach((z, i) => {
      if (!z || typeof z !== 'object') return;
      const code = String(z.code || '').trim().toUpperCase();
      if (!/^[A-Z0-9]{1,12}$/.test(code) || seen.has(code)) return;
      if (!Object.prototype.hasOwnProperty.call(KIND_ID, z.kind)) return;               // unknown kinds are ignored
      let n = [z.cap, z.capacity, z.count, z.units].find((v) => Number.isFinite(+v) && v !== null && v !== '');
      n = n === undefined ? (typeof z.s === 'string' ? z.s.length : 0) : Math.floor(+n);
      seen.add(code);
      out.push({ code, kind: z.kind, name: String(z.name || code).slice(0, 40), count: clamp(n || 0, 0, 5000), sort: Number.isFinite(+z.sort) ? +z.sort : i, order: i });
    });
    out.sort((a, b) => a.sort - b.sort || a.order - b.order);
    return out;
  }

  function layout(zonesIn) {
    const zones = normZones(zonesIn);
    const used = SLOTS.map(() => 0), owner = SLOTS.map(() => []);           // owner: runs { from, n, zi, seq0 }
    const Z = [];
    zones.forEach((z, zi) => {
      let rem = z.count;
      const segs = [];
      const take = (si) => {
        const s = SLOTS[si], free = s.limit - used[si];
        if (free <= 0 || rem <= 0) return;
        const n = Math.min(free, rem);
        segs.push({ slot: s.id, si, from: used[si], n, seq0: z.count - rem + 1 });
        owner[si].push({ from: used[si], n, zi, seq0: z.count - rem + 1 });
        used[si] += n; rem -= n;
      };
      const mine = SLOTS.map((s, i) => i).filter((i) => SLOTS[i].kind === z.kind);
      for (const si of mine) if (rem > 0 && used[si] === 0) take(si);          // fresh slots of its kind first, in order
      for (const si of mine) if (rem > 0) take(si);                              // then free room left in used ones
      if (rem > 0) take(SLOT_IDX.get('OVER'));                                    // then the overflow field
      Z.push({ code: z.code, kind: z.kind, name: z.name, count: z.count, placed: z.count - rem, unplaced: rem, slot: segs.length ? segs[0].slot : null,
        slots: segs.map((g) => ({ slot: g.slot, from: g.from, n: g.n })), segs, frame: null, start: 0 });
    });
    // flat arrays (only placed units)
    let N = 0;
    for (const z of Z) { z.start = N; N += z.placed; }
    const A = { x: new Float32Array(N), y: new Float32Array(N), z: new Float32Array(N), rot: new Float32Array(N), kind: new Uint8Array(N),
      zone: new Uint16Array(N), seq: new Int32Array(N), variant: new Uint8Array(N), ring: new Int16Array(N), slot: new Uint8Array(N) };
    const slotPos = SLOTS.map((s, i) => new Int32Array(Math.max(0, used[i])).fill(-1)); // slot position → flat index
    // ring tables per slot: rows used, per (row, sector) arcs { k, a0, step, start }
    const ringTab = SLOTS.map((s, i) => {
      if (s.type !== 'ring') return null;
      let left = used[i];
      const rows = [];
      let start = 0;
      for (let ri = 0; ri < ROWGEO.length && left > 0; ri++) {
        const G0 = ROWGEO[ri], natRow = G0.nat * s.sectors.length;
        const k = Math.min(left, natRow);
        const arcs = [];
        let given = 0;
        s.sectors.forEach((sec, si2) => {
          const rest = s.sectors.length - si2;
          const ka = si2 === s.sectors.length - 1 ? k - given : Math.min(G0.nat, Math.ceil((k - given) / rest));
          const a0 = sec * SEC + G0.del;
          const step = ka > 1 ? G0.span / (ka - 1) : 0;
          arcs.push({ sec, k: ka, a0: ka === 1 ? sec * SEC + SEC / 2 : a0, step, start: start + given });
          given += ka;
        });
        const bySec = new Array(8).fill(null);
        for (const a of arcs) bySec[a.sec] = a;
        rows.push({ ri, arcs, bySec, start, k });
        start += k; left -= k;
      }
      return rows;
    });
    // fill positions
    const posXZ = (si, p) => {                         // slot si, position p → [x, z, rot, ring]
      const s = SLOTS[si];
      if (s.type === 'ring') {
        const sys = sysOf(s.sys), rows = ringTab[si];
        let lo = 0, hi = rows.length - 1;
        while (lo < hi) { const m = (lo + hi + 1) >> 1; if (rows[m].start <= p) lo = m; else hi = m - 1; }
        const row = rows[lo], r = ROWGEO[row.ri].r;
        let arc = row.arcs[0];
        for (const a of row.arcs) if (p >= a.start) arc = a;
        const a = arc.a0 + arc.step * (p - arc.start);
        const x = sys.cx + r * Math.cos(a), z = sys.cz + r * Math.sin(a);
        return [x, z, Math.atan2(sys.cx - x, sys.cz - z), row.ri];
      }
      const g = s.g, row = Math.floor(p / g.n), c = p - row * g.n;
      const u = g.colU(c), v = g.rowV(row);
      const x = g.ox + g.ux * u + g.vx * v, z = g.oz + g.uz * u + g.vz * v;
      const f = g.faceRow(row);
      return [x, z, Math.atan2(g.vx * f, g.vz * f), row];
    };
    Z.forEach((z, zi) => {
      const hz = hashStr(z.code);
      let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity, sx = 0, sz = 0;
      for (const g of z.segs) for (let q = 0; q < g.n; q++) {
        const p = g.from + q, seq = g.seq0 + q, i = z.start + seq - 1;
        const [x, zz, rot, ring] = posXZ(g.si, p);
        A.x[i] = x; A.z[i] = zz; A.y[i] = SLOTS[g.si].type === 'ring' ? sysLevel(sysOf(SLOTS[g.si].sys), x, zz) : SLOTS[g.si].g.level(x, zz); A.rot[i] = rot; A.kind[i] = KIND_ID[z.kind]; A.zone[i] = zi; A.seq[i] = seq;
        A.ring[i] = ring; A.slot[i] = g.si; A.variant[i] = (Math.imul(hz ^ seq, 2654435761) >>> 27) & 7;
        slotPos[g.si][p] = i;
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (zz < z0) z0 = zz; if (zz > z1) z1 = zz; sx += x; sz += zz;
      }
      const n = z.placed;
      z.frame = n ? { x0: r3(x0), z0: r3(z0), x1: r3(x1), z1: r3(z1), cx: r3(sx / n), cz: r3(sz / n), label: labelPoint(z) } : null;
      function labelPoint(zz) {
        const g = zz.segs[0], s = SLOTS[g.si];
        if (s.type === 'ring') { const sys = sysOf(s.sys), am = (s.sectors[0] + s.sectors[s.sectors.length - 1] + 1) / 2 * SEC; return { x: r3(sys.cx + 35 * Math.cos(am)), z: r3(sys.cz + 35 * Math.sin(am)) }; }
        return { x: r3(sx / n), z: r3(sz / n) };
      }
    });
    const zoneIdx = new Map(Z.map((z, i) => [z.code, i]));
    const index = (code, seq) => {
      const zi = zoneIdx.get(String(code || '').toUpperCase());
      if (zi === undefined) return -1;
      const z = Z[zi]; seq = Math.floor(+seq);
      return seq >= 1 && seq <= z.placed ? z.start + seq - 1 : -1;
    };
    const unit = (code, seq) => {
      const i = index(code, seq);
      if (i < 0) return null;
      return { x: A.x[i], y: A.y[i], z: A.z[i], rot: A.rot[i], kind: K.KINDS[A.kind[i]], ring: A.ring[i], variant: A.variant[i], zone: Z[A.zone[i]].code, seq: A.seq[i], slot: SLOTS[A.slot[i]].id, i };
    };
    // a coarse grid (8 m) of candidate slots: unitAt looks at one cell, then does arithmetic in at most one or two slots
    const SG = 8, PADMAX = 3, gnx = Math.ceil((unitBounds.maxX - unitBounds.minX) / SG) + 1, gnz = Math.ceil((unitBounds.maxZ - unitBounds.minZ) / SG) + 1;
    const gridSlots = new Array(gnx * gnz).fill(null);
    SLOTS.forEach((sl, si) => {
      if (!used[si]) return;
      let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
      for (let p = 0; p < used[si]; p++) { const i = slotPos[si][p]; if (i < 0) continue; const x = A.x[i], z = A.z[i]; if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z; }
      const m = 2 + PADMAX;
      const c0 = Math.max(0, Math.floor((x0 - m - unitBounds.minX) / SG)), c1 = Math.min(gnx - 1, Math.floor((x1 + m - unitBounds.minX) / SG));
      const r0 = Math.max(0, Math.floor((z0 - m - unitBounds.minZ) / SG)), r1 = Math.min(gnz - 1, Math.floor((z1 + m - unitBounds.minZ) / SG));
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) { const id = r * gnx + c; (gridSlots[id] || (gridSlots[id] = [])).push(si); }
    });
    // flat arc tables per ring slot (row × sector): k, a0, step, start — no object lookups in the hot path
    const RT = SLOTS.map((sl, si) => {
      if (sl.type !== 'ring') return null;
      const n = ROWS.length * 8, k = new Int32Array(n), a0 = new Float64Array(n), st = new Float64Array(n), start = new Int32Array(n), R = Float64Array.from(ROWS);
      for (const row of ringTab[si]) for (const arc of row.arcs) { const j = row.ri * 8 + arc.sec; k[j] = arc.k; a0[j] = arc.a0; st[j] = arc.step; start[j] = arc.start; }
      const sys = sl.sys === 'GC' ? GC : AM;
      return { k, a0, st, start, R, cx: sys.cx, cz: sys.cz, owner: Int8Array.from(SECTOR_SLOT[sl.sys]), pos: slotPos[si], rows: ringTab[si].length };
    });
    const RMIN = K.RING_R0 - 1, RMAX = ROWS[ROWS.length - 1] + 1, RP = K.RING_PERIOD, RS = K.RING_SPACING, R0 = K.RING_R0;
    function ringHit(si, x, z, pad) {
      const T = RT[si], dx = x - T.cx, dz = z - T.cz, r = Math.sqrt(dx * dx + dz * dz);
      if (r < RMIN - pad || r > RMAX + pad) return -1;
      let a = Math.atan2(dz, dx); if (a < 0) a += TAU;
      let sec = Math.floor(a / SEC); if (sec > 7) sec = 7;
      if (T.owner[sec] !== si) return -1;
      // the row by arithmetic (groups of three rows 1.6 m apart, 5.6 m per group)
      const kg = Math.floor((r - R0 + 1.2) / RP), j = Math.round((r - (R0 + RP * kg)) / RS);
      let r0 = kg * 3 + (j < 0 ? 0 : j > 2 ? 2 : j);
      if (r0 < 0) r0 = 0;
      const lim = K.JAR_HIT + pad, lim2 = lim * lim, span = pad > 0.5 ? 1 : 0;
      for (let ri = r0 - 1 - span; ri <= r0 + 1 + span; ri++) {
        if (ri < 0 || ri >= T.rows) continue;
        const R = T.R[ri], dr = r - R;
        if (dr > lim || dr < -lim) continue;
        const jj = ri * 8 + sec, kk = T.k[jj];
        if (kk <= 0) continue;
        const q = kk === 1 ? 0 : Math.round((a - T.a0[jj]) / T.st[jj]);
        if (q < 0 || q >= kk) continue;
        const da = (a - T.a0[jj] - T.st[jj] * q) * R;                 // arc offset (≥ the chord: a conservative, trig-free test)
        if (dr * dr + da * da <= lim2) { const i = T.pos[T.start[jj] + q]; if (i >= 0) return i; }
      }
      return -1;
    }
    function gridHit(si, x, z, pad) {
      const g = SLOTS[si].g, dx = x - g.ox, dz = z - g.oz, u = dx * g.ux + dz * g.uz, v = dx * g.vx + dz * g.vz;
      if (u < -1 - pad || v < -1 - pad || u > g.maxU + pad || v > g.maxV + pad) return -1;
      // numeric inverse (monomorphic): row from the period pattern, column from the group pattern
      const t = Math.floor(v / g.P), wv = v - t * g.P, j = Math.abs(wv - g.o0) <= Math.abs(wv - g.o1) ? 0 : 1;
      const gi = Math.floor(u / g.GL), wu = u - gi * g.GL;
      let cc = Math.round((wu - g.c0) / g.pitch);
      if (cc < 0) cc = 0; else if (cc >= g.G) cc = g.G - 1;
      const row0 = t * 2 + j, col0 = gi * g.G + cc, sp = pad > 0 ? 1 : 0;
      for (let row = row0 - sp; row <= row0 + sp; row++) {
        if (row < 0 || row >= g.rows) continue;
        const rv = Math.floor(row / 2) * g.P + (row & 1 ? g.o1 : g.o0);
        if (Math.abs(v - rv) > g.hv + pad) continue;
        for (let c = col0 - sp; c <= col0 + sp; c++) {
          if (c < 0 || c >= g.n) continue;
          const p = row * g.n + c;
          if (p >= used[si]) continue;
          const cu = Math.floor(c / g.G) * g.GL + (c % g.G) * g.pitch + g.c0;
          if (Math.abs(u - cu) <= g.hu + pad) return slotPos[si][p];
        }
      }
      return -1;
    }
    /** flat index at (x, z) (within `pad` metres of a unit's footprint) or −1 — O(1) */
    function indexAt(x, z, pad) {
      pad = clamp(+pad || 0, 0, 50);
      if (!(x === x && z === z)) return -1;
      let list;
      if (pad <= PADMAX) {
        const c = Math.floor((x - unitBounds.minX) / SG), r = Math.floor((z - unitBounds.minZ) / SG);
        if (c < 0 || r < 0 || c >= gnx || r >= gnz) return -1;
        list = gridSlots[r * gnx + c];
        if (!list) return -1;
      } else list = SLOTS.map((q, i) => i).filter((i) => used[i]);
      for (let k = 0; k < list.length; k++) {
        const si = list[k], i = IS_RING[si] ? ringHit(si, x, z, pad) : gridHit(si, x, z, pad);
        if (i >= 0) return i;
      }
      return -1;
    }
    const unitAt = (x, z, pad) => { const i = indexAt(+x, +z, pad); return i < 0 ? null : { zone: Z[A.zone[i]].code, seq: A.seq[i] }; };
    const L = {
      zones: Z.map((z) => ({ code: z.code, kind: z.kind, name: z.name, slot: z.slot, slots: z.slots, count: z.count, placed: z.placed, unplaced: z.unplaced, frame: z.frame, start: z.start })),
      count: N, total: Z.reduce((a, z) => a + z.count, 0), unplaced: Z.reduce((a, z) => a + z.unplaced, 0),
      used: Object.fromEntries(SLOTS.map((s, i) => [s.id, used[i]])),
      arrays: A, unit, unitAt, index, indexAt, ringRows: (slotId) => (ringTab[SLOT_IDX.get(slotId)] || []).map((r) => ({ ri: r.ri, r: ROWGEO[r.ri].r, k: r.k, arcs: r.arcs.map((a) => ({ sec: a.sec, k: a.k, a0: a.a0, step: a.step })) })),
      zoneOf: (code) => { const zi = zoneIdx.get(String(code || '').toUpperCase()); return zi === undefined ? null : Z[zi]; },
      cells: () => cells(L),
      paths: PATHS, walkable: (x, z) => walkable(x, z, L), height, spawn: SPAWN, viewpoints: VIEWPOINTS, busStop: BUS_STOP,
    };
    return L;
  }

  // ================================================================== cells for instancing (≈ 44 m)
  function cells(L) {
    if (L.__cells) return L.__cells;
    const S = K.CELL, nx = Math.ceil((unitBounds.maxX - unitBounds.minX) / S), nz = Math.ceil((unitBounds.maxZ - unitBounds.minZ) / S);
    const A = L.arrays, buckets = new Map();
    for (let i = 0; i < L.count; i++) {
      const ci = clamp(Math.floor((A.x[i] - unitBounds.minX) / S), 0, nx - 1), cj = clamp(Math.floor((A.z[i] - unitBounds.minZ) / S), 0, nz - 1);
      const id = cj * nx + ci;
      let b = buckets.get(id);
      if (!b) { b = { id, i: ci, j: cj, lists: [[], [], []] }; buckets.set(id, b); }
      b.lists[A.kind[i]].push(i);
    }
    const list = [...buckets.values()].sort((a, b) => a.id - b.id).map((b) => {
      let x0 = Infinity, z0 = Infinity, y0 = Infinity, x1 = -Infinity, z1 = -Infinity, y1 = -Infinity;
      for (const l of b.lists) for (const i of l) { const x = A.x[i], z = A.z[i], y = A.y[i]; if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z; if (y < y0) y0 = y; if (y + 1.6 > y1) y1 = y + 1.6; }
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, cz = (z0 + z1) / 2;
      const r = Math.hypot(x1 - x0 + 3, y1 - y0, z1 - z0 + 3) / 2;
      return { id: b.id, i: b.i, j: b.j, x0: unitBounds.minX + b.i * S, z0: unitBounds.minZ + b.j * S, x1: unitBounds.minX + (b.i + 1) * S, z1: unitBounds.minZ + (b.j + 1) * S,
        units: { jar: Int32Array.from(b.lists[0]), plot: Int32Array.from(b.lists[1]), store: Int32Array.from(b.lists[2]) },
        count: b.lists[0].length + b.lists[1].length + b.lists[2].length, sphere: { x: r3(cx), y: r3(cy), z: r3(cz), r: r3(r) } };
    });
    const byId = new Map(list.map((c) => [c.id, c]));
    const out = { size: S, nx, nz, list, at: (x, z) => { const ci = Math.floor((x - unitBounds.minX) / S), cj = Math.floor((z - unitBounds.minZ) / S); return ci < 0 || cj < 0 || ci >= nx || cj >= nz ? null : byId.get(cj * nx + ci) || null; } };
    Object.defineProperty(L, '__cells', { value: out, enumerable: false });
    return out;
  }

  // ================================================================== elements (everything drawable)
  const E = [];
  const add = (o) => { E.push(o); return o; };
  const arcPts = (cx, cz, r, a0, a1, n) => { const out = []; for (let i = 0; i <= n; i++) { const a = a0 + (a1 - a0) * i / n; out.push([r3(cx + r * Math.cos(a)), r3(cz + r * Math.sin(a))]); } return out; };

  // river, rocks, bridge
  {
    const rocks = [];
    const len = polyLen(RIVER_XZ);
    for (let s = 0, k = 0; s < len; s += 4.5, k++) {
      // walk the line, drop boulders on both banks and a few in the water
      let acc = 0, p = null;
      for (let i = 0; i < RIVER_XZ.length - 1; i++) { const a = RIVER_XZ[i], b = RIVER_XZ[i + 1], l = Math.hypot(b[0] - a[0], b[1] - a[1]); if (acc + l >= s) { const t = (s - acc) / l; p = [lerp(a[0], b[0], t), lerp(a[1], b[1], t), (b[0] - a[0]) / l, (b[1] - a[1]) / l]; break; } acc += l; }
      if (!p) break;
      const nx = -p[3], nz = p[2];
      for (const side of [-1, 1]) {
        const h = hashI(k * 7 + (side > 0 ? 1 : 0), 911);
        if (h < 0.35) continue;
        const off = RIVER.w / 2 + 0.5 + hashI(k, 17 + side) * 3.5, r = 0.6 + hashI(k, 33 + side) * 1.8;
        rocks.push([r3(p[0] + nx * off * side), r3(p[1] + nz * off * side), r3(r)]);
      }
      if (hashI(k, 4242) > 0.82) { const off = (hashI(k, 51) - 0.5) * RIVER.w * 0.7; rocks.push([r3(p[0] + nx * off), r3(p[1] + nz * off), r3(0.5 + hashI(k, 52) * 1.0)]); }
    }
    add({ id: 'RIVER', type: 'river', name: '강', w: RIVER.w, pts: RIVER.pts.map((p) => p.slice()), rocks, flow: 'south' });
    const by = baseSlope(96) + 2.6;
    add({ id: 'BRIDGE', type: 'bridge', name: '돌다리', x0: -192, z0: 96, x1: -156, z1: 96, w: 4, arches: 3, deckY: r3(Math.max(by, riverWaterY(riverNear(-174, 96)) + 3.4)), stone: true });
  }
  // roads
  const ROADS = [
    { id: 'ROAD_N', name: '강변 길', w: 8, pts: [[-158, -170], [-154, -110], [-151, -60], [-148, -20], [-144, 12], [-133, 30], [-128.2, 34.6]], markings: { center: 'double-yellow', edge: true } },
    { id: 'ROAD_S', name: '단지 앞길', w: 8, pts: [[-104, 70.5], [-102, 96], [-92, 120], [-74, 132], [-40, 134], [60, 134], [140, 134], [200, 134]], markings: { center: 'dashed-white', edge: true } },
    { id: 'ROAD_SW', name: '돌다리 가는 길', w: 7, pts: [[-127.8, 53.8], [-146, 64], [-151, 96], [-155, 130], [-160, 175]], markings: { center: 'dashed-white', edge: true } },
    { id: 'ROAD_PARK', name: '주차장 길', w: 7, pts: [[-106, 21.6], [-110, 10], [-114, 4]], markings: { center: 'none', edge: false } },
  ];
  for (const r of ROADS) add(Object.assign({ type: 'road', lanes: r.w >= 8 ? 2 : 1 }, r));
  add({ id: 'ROUNDABOUT', type: 'roundabout', name: '회전 교차로', cx: ROUND.cx, cz: ROUND.cz, r0: ROUND.r0, r1: ROUND.r1, lane: ROUND.lane, markings: { center: 'dashed-white', edge: true } });
  // the island garden: fountain, sculpted pines, rocks, hedges
  {
    const pines = [], rocks = [];
    for (let i = 0; i < 9; i++) { const a = i / 9 * TAU + 0.3; const r = 10.5 + (i % 2) * 3.5; pines.push({ x: r3(ROUND.cx + r * Math.cos(a)), z: r3(ROUND.cz + r * Math.sin(a)), s: r3(0.9 + hashI(i, 5) * 0.5), kind: 'pine_sculpted' }); }
    for (let i = 0; i < 12; i++) { const a = i / 12 * TAU + 0.1; const r = 6.5 + hashI(i, 9) * 9; rocks.push({ x: r3(ROUND.cx + r * Math.cos(a)), z: r3(ROUND.cz + r * Math.sin(a)), r: r3(0.5 + hashI(i, 11) * 1.1) }); }
    add({ id: 'GARDEN', type: 'garden', name: '소나무 정원', cx: ROUND.cx, cz: ROUND.cz, r: ROUND.r0 - 0.6, fountain: { x: ROUND.cx, z: ROUND.cz, r: 4, jets: 7 }, pines, rocks, hedge: { r: ROUND.r0 - 1.2, w: 0.8 }, lawn: true });
  }
  // parking
  {
    const bays = [];
    const cols = [{ x: -139.5, rot: PI / 2 }, { x: -130.5, rot: -PI / 2 }, { x: -125.5, rot: PI / 2 }, { x: -116.5, rot: -PI / 2 }];
    for (const c of cols) for (let z = -47.75; z <= 3.5; z += 2.5) bays.push({ x: c.x, z: r3(z), rot: c.rot, w: 2.5, d: 5 });
    add({ id: 'PARKING', type: 'parking', name: '주차장', x0: -142, z0: -50, x1: -112, z1: 6, bays, aisles: [[-135, -50, -135, 6], [-121, -50, -121, 6]], surface: 'asphalt' });
  }
  const BUS_STOP = Object.freeze({ x: -69.5, z: 41, rot: PI, bay: { x0: -74, z0: 30, x1: -68, z1: 52 }, shelter: { x: -64.5, z: 41, w: 3, d: 7, rot: -PI / 2 }, sign: { x: -65, z: 34.5 } });
  add({ id: 'BUSBAY', type: 'busbay', name: '셔틀버스 정류장', x0: -74, z0: 30, x1: -68, z1: 52, stop: { x: BUS_STOP.x, z: BUS_STOP.z, rot: BUS_STOP.rot }, shelter: BUS_STOP.shelter });
  add({ id: 'PLAZA_ENTRY', type: 'plaza', name: '들머리 마당', shape: 'rect', x0: -72, z0: 14, x1: -48, z1: 70, surface: 'stone' });
  add({ id: 'PLAZA_GATE', type: 'plaza', name: '정문 앞마당', shape: 'rect', x0: -48, z0: 99, x1: -26, z1: 128, surface: 'stone' });

  // buildings
  const B = (o) => add(Object.assign({ type: 'building' }, o));
  B({ id: 'B_MAIN', kind: 'main', name: '만장대 본관', x: MAIN.x, z: MAIN.z, w: MAIN.w, d: MAIN.d, rot: 0, y: r3(MAIN_Y), podium: 1.2, h: 14.5, floors: 3,
    parts: [
      { id: 'core', x0: -86, z0: -39, x1: -46, z1: 3, floors: 3, h: 14.5, roof: { type: 'paljak2', h: 9.5, overhang: 3.2 }, facade: 'glass-timber' },
      { id: 'wingW', x0: -99, z0: -33, x1: -86, z1: -3, floors: 2, h: 9.0, roof: { type: 'paljak', h: 5.0, overhang: 2.4 }, facade: 'glass-timber' },
      { id: 'wingE', x0: -46, z0: -33, x1: -33, z1: -3, floors: 2, h: 9.0, roof: { type: 'paljak', h: 5.0, overhang: 2.4 }, facade: 'glass-timber' },
      { id: 'portico', x0: -76, z0: 3, x1: -56, z1: 13, floors: 1, h: 6.0, roof: { type: 'paljak', h: 3.6, overhang: 1.8 }, facade: 'columns' },
    ],
    door: { x: -66, z: 3.2, rot: 0 }, doors: [{ x: -66, z: 3.2, rot: 0, main: true }, { x: -33, z: -16, rot: PI / 2 }],
    stairs: [{ x0: -76, z0: 13, x1: -56, z1: 16, y0: r3(MAIN_Y), y1: r3(MAIN_Y + 1.2) }], place: 'PL_OFFICE' });
  B({ id: 'B_CAFE', kind: 'cafe', name: '농촌 카페', x: -60, z: 78, w: 20, d: 12, rot: 0, y: r3(baseSlope(81)), h: 4.2, floors: 1, roof: { type: 'matbae', h: 2.6, overhang: 1.2 },
    door: { x: -60, z: 84, rot: 0 }, terrace: { x0: -70, z0: 84, x1: -50, z1: 90 } });
  B({ id: 'B_GATE', kind: 'gatehouse', name: '장독대 정문', x: r3(GATE.x), z: r3(GATE.z), w: 12, d: 6, rot: r3(GATE.rot), y: r3(GC_RIM), h: 4.6, floors: 1, roof: { type: 'sosul', h: 2.8, overhang: 1.4 }, passage: { w: 4.2 }, door: { x: r3(GATE.x + 3 * Math.sin(GATE.rot)), z: r3(GATE.z + 3 * Math.cos(GATE.rot)), rot: r3(GATE.rot) } });
  B({ id: 'B_PAVILION', kind: 'pavilion', name: '정자', x: KNOLL.cx, z: KNOLL.cz, w: 9, d: 9, rot: 0, y: r3(KNOLL_Y), h: 7.5, floors: 2, roof: { type: 'paljak2', h: 4.5, overhang: 1.8 }, open: true });
  B({ id: 'B_WORKSHOP', kind: 'workshop', name: '옹기 공방', x: -50, z: -128, w: 12, d: 9, rot: 0, y: r3(baseSlope(-128)), h: 4.0, floors: 1, roof: { type: 'matbae', h: 2.4, overhang: 1.0 }, door: { x: -50, z: -123.5, rot: 0 } });
  add({ id: 'KILN', type: 'kiln', name: '오름가마', x: -50, z0: -134, z1: -149, w: 3.6, chambers: 6, y0: r3(height(-50, -134)), y1: r3(height(-50, -149)) });
  // the hanok village: 12 houses on the terrace
  {
    let n = 0;
    VILLAGE.rows.forEach((z, ri) => VILLAGE.cols.forEach((x, ci) => {
      n++;
      const v = (ri * 4 + ci) % 3;
      B({ id: 'B_VH' + String(n).padStart(2, '0'), kind: 'hanok', name: `한옥 ${n}`, x, z, w: 13 - v, d: 7.5, rot: 0, y: r3(VILLAGE_Y), h: 3.2, floors: 1, variant: v,
        roof: { type: v === 2 ? 'matbae' : 'paljak', h: 2.6, overhang: 1.3, tile: 'giwa' }, door: { x, z: z + VILLAGE.hd, rot: 0 }, wall: { x0: x - 9.5, z0: z - 6.5, x1: x + 9.5, z1: z + 8.5, h: 1.4, gate: 'south' } });
    }));
  }
  // storehouses
  HOUSES.forEach((H) => B({ id: 'B_SH' + (H.k + 1), kind: 'storehouse', name: `창고 ${H.k + 1}동`, x: r3((H.x0 + H.x1) / 2), z: r3(H.zc), w: r3(H.x1 - H.x0), d: K.HOUSE_W, rot: 0, y: r3(H.y), h: 3.2, floors: 1,
    roof: { type: 'matbae', h: 1.8, overhang: 0.8 }, bays: { side: K.BAYS_PER_SIDE, w: K.BAY_W, d: K.BAY_D, spine: K.HOUSE_SPINE, first: YARD.x0 + 0.6 }, row: H.k < 4 ? 'SY_A' : 'SY_B',
    shared: H.k === 3 || H.k === 7 ? { side: 1, from: 59, n: 4, name: '함께 쓰는 칸' } : null }));
  add({ id: 'STOREYARD', type: 'storeyard', name: '창고 마당', x0: YARD.x0 - 3, z0: HOUSES[7].z0 - 4.4, x1: YARD.x0 + YARD.len + 3, z1: HOUSES[0].z1 + 4.4 });

  // corridor and the pavilion knoll
  const CORRIDOR_PTS = [[-33, -16], [40, -16], [78, -16], [85.5, -1.5]];
  add({ id: 'CORRIDOR', type: 'corridor', name: '회랑', pts: CORRIDOR_PTS, w: 4.4, h: 3.4, roof: { type: 'matbae', h: 1.6, overhang: 0.9 }, postEvery: 3.0 });
  add({ id: 'KNOLL', type: 'knoll', name: '정자 언덕', cx: KNOLL.cx, cz: KNOLL.cz, r: KNOLL.r, top: r3(KNOLL_Y) });

  // the great circle and the amphitheatre (frames; the jars come from layout)
  const GC_GATES = [{ a: PI * 0.75, w: 5, name: '정문 (남서)', main: true }, { a: PI / 2, w: 4.4, name: '남문' }, { a: PI, w: 4.4, name: '서문' }, { a: PI * 1.5, w: 4.4, name: '북문' }, { a: 0, w: 4.4, name: '동문' }];
  add({ id: 'JARCIRCLE', type: 'jarcircle', name: '큰 장독대 (동심원)', cx: GC.cx, cz: GC.cz, plazaR: K.PLAZA_R, r0: K.RING_R0, r1: ROWS[ROWS.length - 1], wallR: K.WALL_R, rows: ROWS.slice(),
    walks: Array.from({ length: 10 }, (_, k) => r3(K.RING_R0 - 1.2 + K.RING_PERIOD * k)), aisles: [0, 1, 2, 3, 4, 5, 6, 7].map((s) => r3(s * SEC)), aisleW: K.AISLE_W, rim: r3(GC_RIM),
    centre: { kind: 'stone-table', r: 3 } });
  add({ id: 'WALL_GC', type: 'wall', name: '큰 장독대 돌담', arc: { cx: GC.cx, cz: GC.cz, r: K.WALL_R, a0: 0, a1: TAU }, h: 0.9, w: 0.5, gates: GC_GATES.map((g) => ({ a: r3(g.a), w: g.w, name: g.name })), stone: true });
  add({ id: 'AMPHI', type: 'amphitheatre', name: '반원 계단 장독대', cx: AM.cx, cz: AM.cz, a0: PI, a1: TAU, plazaR: K.PLAZA_R, r0: K.RING_R0, r1: ROWS[ROWS.length - 1], wallR: K.WALL_R, rows: ROWS.slice(),
    terraces: Array.from({ length: 9 }, (_, k) => ({ r: r3(K.RING_R0 + K.RING_PERIOD * k - 0.6), y: r3(AM_L0 + K.AMPH_RISE * (k + 1)) })), base: r3(AM_L0),
    aisles: [4, 5, 6, 7, 8].map((s) => r3(s * SEC)), aisleW: K.AISLE_W });
  add({ id: 'WALL_AM', type: 'wall', name: '반원 장독대 돌담', arc: { cx: AM.cx, cz: AM.cz, r: K.WALL_R, a0: PI, a1: TAU }, h: 0.9, w: 0.5,
    gates: [4, 5, 6, 7, 8].map((s) => ({ a: r3(s * SEC), w: 4.6 })), stone: true });
  add({ id: 'TERRACE_VILLAGE', type: 'terrace', name: '한옥 마을 언덕', x0: VILLAGE.x0, z0: VILLAGE.z0, x1: VILLAGE.x1, z1: VILLAGE.z1, y: r3(VILLAGE_Y), retaining: 'stone' });
  for (const F of FIELDS) {
    const c = [fxz(F, 0, 0), fxz(F, F.lenU, 0), fxz(F, F.lenU, F.lenV), fxz(F, 0, F.lenV)];
    add({ id: F.id, type: 'field', name: F.name, poly: c.map((p) => [r3(p[0]), r3(p[1])]), u: [F.ux, F.uz], v: [F.vx, F.vz], origin: [F.ox, F.oz], lenU: r3(F.lenU), lenV: r3(F.lenV),
      terraces: F.levels.map((y, t) => ({ v0: r3(t * F.period), v1: r3((t + 1) * F.period), y: r3(y) })), bed: { w: K.BED_W, d: K.BED_D, path: K.BED_PATH, walk: K.FIELD_WALK }, crop: ['herb', 'greens', 'beans'][FIELDS.indexOf(F)] });
  }
  add({ id: 'OVERFLOW', type: 'field', name: '임시 자리', poly: [[OVER.x0, OVER.z0], [OVER.x1, OVER.z0], [OVER.x1, OVER.z1], [OVER.x0, OVER.z1]], overflow: true, surface: 'gravel' });

  // the viewpoint deck and its three stair legs (y per vertex — the steps are drawn by complex-site; the terrain stays natural)
  const STAIRS = [
    { id: 'ST_DECK1', name: '전망 데크 계단 1', w: 2.4, pts: [[-112, 141, 0.7], [-40, 144, 9.0]] },
    { id: 'ST_DECK2', name: '전망 데크 계단 2', w: 2.4, pts: [[-40, 144, 9.0], [-40, 148, 9.0], [-100, 151, 17.0]] },
    { id: 'ST_DECK3', name: '전망 데크 계단 3', w: 2.4, pts: [[-100, 151, 17.0], [-100, 155, 17.0], [-66, 158.5, DECK.y]] },
    { id: 'ST_VILLAGE', name: '한옥 마을 돌계단', w: 3.0, pts: [[11, -18.5, r3(height(11, -18.5))], [11, -46, r3(VILLAGE_Y)]], natural: true },
  ];
  for (const s of STAIRS) add(Object.assign({ type: 'stair' }, s));
  add({ id: 'DECK', type: 'deck', name: '전망 데크', x0: DECK.x - DECK.w / 2, z0: DECK.z - DECK.d / 2, x1: DECK.x + DECK.w / 2, z1: DECK.z + DECK.d / 2, y: DECK.y, rail: 1.1, telescope: { x: DECK.x - 2, z: DECK.z - DECK.d / 2 + 0.8 } });
  // amphitheatre radial aisles are stairs too (they cross the terrace risers)
  [4, 5, 6, 7, 8].forEach((s) => {
    const a = s * SEC, pts = [];
    for (let r = K.PLAZA_R; r <= K.WALL_R + 0.01; r += 2.0) pts.push([r3(AM.cx + r * Math.cos(a)), r3(AM.cz + r * Math.sin(a)), r3(amLevel(AM.cx + r * Math.cos(a), AM.cz + r * Math.sin(a)))]);
    add({ id: 'ST_AM' + s, type: 'stair', name: '반원 장독대 계단', w: K.AISLE_W, pts, natural: true });
  });

  // lamps (street lights along roads, garden lights, lanterns on the corridor and in the village)
  {
    const lamps = [];
    for (const r of ROADS) {
      const L0 = polyLen(r.pts);
      for (let s = 10; s < L0; s += 26) {
        let acc = 0;
        for (let i = 0; i < r.pts.length - 1; i++) {
          const a = r.pts[i], b = r.pts[i + 1], l = Math.hypot(b[0] - a[0], b[1] - a[1]);
          if (acc + l >= s) { const t = (s - acc) / l, nx = -(b[1] - a[1]) / l, nz = (b[0] - a[0]) / l, off = r.w / 2 + 1.2; const x = lerp(a[0], b[0], t) + nx * off, z = lerp(a[1], b[1], t) + nz * off; if (x > bounds.minX && x < bounds.maxX && z > bounds.minZ && z < bounds.maxZ) lamps.push([r3(x), r3(z), 'street']); break; }
          acc += l;
        }
      }
    }
    for (let i = 0; i < 16; i++) { const a = i / 16 * TAU; lamps.push([r3(ROUND.cx + (ROUND.r1 + 1.5) * Math.cos(a)), r3(ROUND.cz + (ROUND.r1 + 1.5) * Math.sin(a)), 'street']); }
    for (let x = -68; x <= -40; x += 14) for (const z of [18, 50, 84]) lamps.push([x, z, 'garden']);
    for (let s = 0; s < 8; s++) { const a = s * SEC + SEC / 2; lamps.push([r3(GC.cx + (K.WALL_R - 1.2) * Math.cos(a)), r3(GC.cz + (K.WALL_R - 1.2) * Math.sin(a)), 'bollard']); lamps.push([r3(GC.cx + K.PLAZA_R * Math.cos(a)), r3(GC.cz + K.PLAZA_R * Math.sin(a)), 'bollard']); }
    for (let s = 4; s <= 8; s++) { const a = s * SEC; lamps.push([r3(AM.cx + (K.WALL_R + 1.2) * Math.cos(a)), r3(AM.cz + (K.WALL_R + 1.2) * Math.sin(a)), 'bollard']); }
    const cl = polyLen(CORRIDOR_PTS);
    for (let s = 3; s < cl; s += 6) { const n = polyNear(0, 0, CORRIDOR_PTS); void n; let acc = 0; for (let i = 0; i < CORRIDOR_PTS.length - 1; i++) { const a = CORRIDOR_PTS[i], b = CORRIDOR_PTS[i + 1], l = Math.hypot(b[0] - a[0], b[1] - a[1]); if (acc + l >= s) { const t = (s - acc) / l; lamps.push([r3(lerp(a[0], b[0], t)), r3(lerp(a[1], b[1], t)), 'lantern']); break; } acc += l; } }
    for (const x of [-11, 11, 33]) for (const z of [-56, -76, -96]) lamps.push([x, z, 'lantern']);
    for (let z = -46; z <= 2; z += 12) for (const x of [-135, -121]) lamps.push([x, z, 'street']);
    for (let k = 0; k <= 8; k++) lamps.push([r3(YARD.x0 - 2), r3(YARD.zc0 + K.HOUSE_W / 2 + K.STORE_LANE / 2 - K.STORE_PITCH * k), 'street']);
    lamps.push([DECK.x - 6, DECK.z - 4, 'lantern'], [DECK.x + 6, DECK.z - 4, 'lantern']);
    add({ id: 'LAMPS', type: 'lamp', name: '가로등', list: lamps });
  }
  // signposts (Korean, with an emoji for the 3D board / minimap)
  const SIGNS = [
    { id: 'SG_ENTRY', x: -62, z: 36, rot: PI / 2, emoji: '🏺', text: '만장대 단지 — 어서 오세요' },
    { id: 'SG_BUS', x: -65, z: 34.5, rot: -PI / 2, emoji: '🚌', text: '셔틀버스 (마을로 가요)' },
    { id: 'SG_GATE', x: -42, z: 112, rot: r3(GATE.rot), emoji: '🚪', text: '큰 장독대 정문' },
    { id: 'SG_GCW', x: -51, z: 46, rot: PI / 2, emoji: '🏺', text: '큰 장독대 (서문)' },
    { id: 'SG_MAIN', x: -80, z: 18, rot: 0, emoji: '🏛️', text: '본관 — 분양 안내소' },
    { id: 'SG_VILLAGE', x: 14, z: -20, rot: 0, emoji: '🏘️', text: '한옥 마을' },
    { id: 'SG_PAVILION', x: 80, z: -10, rot: 0, emoji: '⛩️', text: '정자' },
    { id: 'SG_AM', x: 114, z: -49, rot: 0, emoji: '🏺', text: '반원 계단 장독대' },
    { id: 'SG_FN', x: -26, z: -128, rot: 0, emoji: '🌿', text: '계단밭 (북쪽)' },
    { id: 'SG_FE', x: 146, z: 62, rot: -PI / 2, emoji: '🌿', text: '계단밭 (동쪽)' },
    { id: 'SG_FSE', x: 106, z: 124, rot: 0, emoji: '🌿', text: '계단밭 (남동쪽)' },
    { id: 'SG_YARD', x: -148, z: -56, rot: PI / 2, emoji: '📦', text: '창고 마당' },
    { id: 'SG_WORKSHOP', x: -50, z: -121, rot: 0, emoji: '⚱️', text: '옹기 공방' },
    { id: 'SG_CAFE', x: -48, z: 86, rot: PI / 2, emoji: '☕', text: '농촌 카페' },
    { id: 'SG_DECK', x: -114, z: 139, rot: 0, emoji: '🔭', text: '전망 데크 (계단)' },
    { id: 'SG_PARK', x: -110, z: 2, rot: PI / 2, emoji: '🅿️', text: '주차장' },
    { id: 'SG_BRIDGE', x: -152, z: 92, rot: -PI / 2, emoji: '🌉', text: '돌다리' },
    { id: 'SG_OVER', x: 98, z: 12, rot: 0, emoji: '🧺', text: '임시 자리' },
  ];
  for (const s of SIGNS) add(Object.assign({ type: 'sign' }, s));
  // forest (density = trees per 100 m²; species shares; complex-site plants it through the vegetation system)
  {
    const farBank = [];
    for (let z = -330; z <= 300; z += 30) farBank.push([r3(riverX(z) - 14), z]);
    const F = (id, name, poly, density, species, extra) => add(Object.assign({ id, type: 'forest', name, poly, density, species }, extra || {}));
    F('FO_N', '북쪽 산', [[-200, -152], [230, -152], [230, -420], [-180, -420]], 1.6, { pine: 0.35, oak: 0.3, maple: 0.15, zelkova: 0.05, birch: 0.15 });
    F('FO_E', '동쪽 산', [[193, -152], [330, -152], [330, 260], [193, 260]], 1.6, { pine: 0.4, oak: 0.35, maple: 0.15, birch: 0.1 });
    F('FO_S', '남쪽 산', [[-150, 142], [193, 142], [193, 320], [-150, 320]], 1.4, { pine: 0.45, oak: 0.3, maple: 0.15, birch: 0.1 }, { clear: [{ x: DECK.x, z: DECK.z, r: 11 }, { x: DECK.x + 6, z: DECK.z - 11, r: 10 }, { x: DECK.x + 18, z: DECK.z - 14, r: 9 }, { x: DECK.x - 6, z: DECK.z - 12, r: 9 }, { x: DECK.x + 30, z: DECK.z - 16, r: 7 }] });
    F('FO_W', '강 건너 숲', farBank.concat([[-420, 300], [-420, -330]]), 1.3, { pine: 0.5, oak: 0.25, maple: 0.15, birch: 0.1 }, { cliffs: true });
    F('FO_VILLAGE', '마을 뒤 숲', [[-34, -116], [54, -116], [54, -126], [-34, -126]], 0.9, { pine: 0.7, maple: 0.3 });
    F('FO_MAIN', '본관 뒤 소나무', [[-100, -48], [-36, -48], [-36, -42], [-100, -42]], 0.8, { pine: 1.0 });
    F('FO_RIVERSIDE', '강가 나무', [[-168, -150], [-160, -150], [-158, 152], [-166, 152]], 0.5, { zelkova: 0.4, maple: 0.3, pine: 0.3 });
    F('FO_GCW', '정문 옆 솔숲', [[-22, 113], [-4, 112], [-4, 128], [-22, 128]], 1.1, { pine: 0.8, pine_sculpted: 0.2 });
  }

  // ================================================================== paths (walk lines with widths) — colliders, minimap, walking
  const PATHS = [];
  const P = (o) => PATHS.push(o);
  for (const r of ROADS) P({ id: r.id, kind: 'road', w: r.w + 3, pts: r.pts });
  P({ id: 'RING_ROAD', kind: 'road', w: ROUND.r1 - ROUND.r0 + 1, arc: { cx: ROUND.cx, cz: ROUND.cz, r: ROUND.lane, a0: 0, a1: TAU }, pts: arcPts(ROUND.cx, ROUND.cz, ROUND.lane, 0, TAU, 48) });
  P({ id: 'ENTRY', kind: 'plaza', w: 36, pts: [[-54, 14], [-54, 88]] });
  P({ id: 'PORTICO', kind: 'avenue', w: 18, pts: [[-66, 13], [-66, 16]] });
  P({ id: 'GC_WEST', kind: 'avenue', w: 6, pts: [[-50, GC.cz], [GC.cx - K.WALL_R - 1.5, GC.cz]] });
  P({ id: 'GATE_ROAD', kind: 'avenue', w: 6, pts: [[r3(GC.cx + (K.WALL_R - 2) * Math.cos(PI * 0.75)), r3(GC.cz + (K.WALL_R - 2) * Math.sin(PI * 0.75))], [-36, 104], [-38, 131]] });
  P({ id: 'GATE_PLAZA', kind: 'plaza', w: 20, pts: [[-37, 101], [-37, 126]] });
  P({ id: 'CAFE', kind: 'avenue', w: 4, pts: [[-60, 70], [-60, 72], [-44, 92], [-40, 104]] });
  P({ id: 'CORRIDOR', kind: 'corridor', w: 4.0, pts: CORRIDOR_PTS });
  P({ id: 'KNOLL_TOP', kind: 'plaza', w: 12, pts: [[KNOLL.cx - 1, KNOLL.cz], [KNOLL.cx + 1, KNOLL.cz]] });
  // the great circle: radial aisles, ring walks, plaza
  for (let s = 0; s < 8; s++) { const a = s * SEC; P({ id: 'GC_A' + s, kind: 'aisle', w: K.AISLE_W, pts: [[r3(GC.cx + K.PLAZA_R * Math.cos(a)), r3(GC.cz + K.PLAZA_R * Math.sin(a))], [r3(GC.cx + (K.WALL_R + 2) * Math.cos(a)), r3(GC.cz + (K.WALL_R + 2) * Math.sin(a))]] }); }
  for (let k = 0; k < 10; k++) { const r = K.RING_R0 - 1.2 + K.RING_PERIOD * k; P({ id: 'GC_W' + k, kind: 'ringwalk', w: K.WALK_W, arc: { cx: GC.cx, cz: GC.cz, r, a0: 0, a1: TAU }, pts: arcPts(GC.cx, GC.cz, r, 0, TAU, 64) }); }
  P({ id: 'GC_PLAZA', kind: 'plaza', w: K.PLAZA_R * 2, pts: [[GC.cx - 0.01, GC.cz], [GC.cx + 0.01, GC.cz]] });
  // amphitheatre: radial stairs, ring walks (half), plaza and the front walk
  for (let s = 4; s <= 8; s++) { const a = s * SEC; P({ id: 'AM_A' + s, kind: 'stair', w: K.AISLE_W, pts: [[r3(AM.cx + K.PLAZA_R * Math.cos(a)), r3(AM.cz + K.PLAZA_R * Math.sin(a))], [r3(AM.cx + (K.WALL_R + 2) * Math.cos(a)), r3(AM.cz + (K.WALL_R + 2) * Math.sin(a))]] }); }
  for (let k = 0; k < 10; k++) { const r = K.RING_R0 - 1.2 + K.RING_PERIOD * k; P({ id: 'AM_W' + k, kind: 'ringwalk', w: K.WALK_W, arc: { cx: AM.cx, cz: AM.cz, r, a0: PI, a1: TAU }, pts: arcPts(AM.cx, AM.cz, r, PI, TAU, 40) }); }
  P({ id: 'AM_PLAZA', kind: 'plaza', w: K.PLAZA_R * 2, pts: [[AM.cx - 0.01, AM.cz], [AM.cx + 0.01, AM.cz]] });
  P({ id: 'AM_FRONT', kind: 'avenue', w: 5, pts: [[AM.cx - K.WALL_R, AM.cz + 3], [AM.cx + K.WALL_R, AM.cz + 3]] });
  P({ id: 'AM_LINK', kind: 'avenue', w: 4, pts: [[94, -2], [104, -30], [AM.cx - 4, AM.cz + 6]] });
  // fields: a walk at the start of every terrace, cross aisles, an edge walk round the block
  for (const F of FIELDS) {
    for (let t = 0; t < F.terr; t++) { const v = t * F.period + K.FIELD_WALK / 2; P({ id: `${F.id}_W${t}`, kind: 'walk', w: K.FIELD_WALK, pts: [fxz(F, -1.2, v), fxz(F, F.lenU + 1.2, v)].map((p) => [r3(p[0]), r3(p[1])]) }); }
    P({ id: `${F.id}_TOP`, kind: 'walk', w: K.FIELD_WALK, pts: [fxz(F, -1.2, F.lenV + 0.6), fxz(F, F.lenU + 1.2, F.lenV + 0.6)].map((p) => [r3(p[0]), r3(p[1])]) });
    const groups = Math.ceil(F.n / K.FIELD_GROUP);
    for (let g = 1; g < groups; g++) { const u = g * F.groupLen - K.FIELD_AISLE / 2; P({ id: `${F.id}_X${g}`, kind: 'walk', w: K.FIELD_AISLE, pts: [fxz(F, u, 0), fxz(F, u, F.lenV)].map((p) => [r3(p[0]), r3(p[1])]) }); }
    for (const u of [-0.8, F.lenU + 0.8]) P({ id: `${F.id}_E${u < 0 ? 'L' : 'R'}`, kind: 'walk', w: 1.6, pts: [fxz(F, u, 0), fxz(F, u, F.lenV + 0.6)].map((p) => [r3(p[0]), r3(p[1])]) });
  }
  // storehouse lanes (between and around the houses) + the two end lanes
  for (let k = 0; k <= YARD.houses; k++) { const z = YARD.zc0 + K.HOUSE_W / 2 + K.STORE_LANE / 2 - K.STORE_PITCH * k; P({ id: 'SY_L' + k, kind: 'lane', w: K.STORE_LANE, pts: [[YARD.x0 - 3, r3(z)], [r3(YARD.x0 + YARD.len + 3), r3(z)]] }); }
  for (const x of [YARD.x0 - 3, YARD.x0 + YARD.len + 3]) P({ id: 'SY_E' + (x < -100 ? 'W' : 'E'), kind: 'lane', w: 4.4, pts: [[r3(x), r3(HOUSES[7].z0 - 4.4)], [r3(x), r3(HOUSES[0].z1 + 4.4)]] });
  P({ id: 'SY_LINK', kind: 'avenue', w: 5, pts: [[-63, -56.7], [-60, -48], [-60, -40]] });
  // overflow walks
  for (let t = 0; t <= 9; t++) { const z = OVER.z0 + t * 5.6 + 0.8; if (z <= OVER.z1 + 1) P({ id: 'OV_W' + t, kind: 'walk', w: 1.6, pts: [[OVER.x0, r3(z)], [OVER.x1, r3(z)]] }); }
  P({ id: 'OV_X', kind: 'walk', w: 2.0, pts: [[OVER.x0 + 23, OVER.z0], [OVER.x0 + 23, OVER.z1]] });
  P({ id: 'OV_LINK', kind: 'avenue', w: 4, pts: [[92, 40], [OVER.x0, 40]] });
  // the village: lanes between the houses, the main stair from the corridor, a path round the back
  for (const x of [VILLAGE.x0 + 2, VILLAGE.cols[0] + 11, VILLAGE.cols[1] + 11, VILLAGE.cols[2] + 11, VILLAGE.x1 - 2]) P({ id: 'VL_X' + x, kind: 'lane', w: 4.0, pts: [[x, VILLAGE.z0 + 2], [x, VILLAGE.z1 - 1]] });
  for (const z of [-48.5, -66, -86, -105.5]) P({ id: 'VL_Z' + z, kind: 'lane', w: 4.0, pts: [[VILLAGE.x0 + 1, z], [VILLAGE.x1 - 1, z]] });
  P({ id: 'ST_VILLAGE', kind: 'stair', w: 3.0, pts: [[11, -18.5], [11, -46]] });
  P({ id: 'WORKSHOP', kind: 'avenue', w: 4, pts: [[-60, -56.7], [-50, -80], [-50, -123]] });
  P({ id: 'NFIELD_LINK', kind: 'avenue', w: 4, pts: [[53, -106], [60, -118], [60, -128.6]] });
  // the deck stairs and the deck
  for (const s of STAIRS) if (!s.natural) P({ id: s.id, kind: 'stair', w: s.w, pts: s.pts.map((p) => [p[0], p[1]]), ys: s.pts.map((p) => p[2]) });
  P({ id: 'DECK', kind: 'deck', w: DECK.d, pts: [[DECK.x - DECK.w / 2 + DECK.d / 2, DECK.z], [DECK.x + DECK.w / 2 - DECK.d / 2, DECK.z]], ys: [DECK.y, DECK.y] });
  P({ id: 'PARK_AISLES', kind: 'road', w: 6, pts: [[-135, -50], [-135, 6]] });
  P({ id: 'PARK_AISLES2', kind: 'road', w: 6, pts: [[-121, -50], [-121, 6]] });

  /** distance from (x, z) to the nearest path AREA (0 inside one), and that path */
  function pathDistance(x, z, kinds) {
    let best = Infinity, which = null;
    for (const p of PATHS) {
      if (kinds && !kinds.includes(p.kind)) continue;
      let d;
      if (p.arc) {
        const a = p.arc, r = Math.hypot(x - a.cx, z - a.cz), ang = normA(Math.atan2(z - a.cz, x - a.cx));
        const inA = a.a1 - a.a0 >= TAU - 1e-9 || (ang >= normA(a.a0) - 1e-9 && ang <= (a.a1 >= TAU ? TAU : a.a1) + 1e-9) || (a.a1 >= TAU && ang <= a.a1 - TAU);
        d = inA ? Math.abs(r - a.r) : polyNear(x, z, p.pts).d;
      } else d = p.pts.length === 1 ? Math.hypot(x - p.pts[0][0], z - p.pts[0][1]) : polyNear(x, z, p.pts).d;
      d = Math.max(0, d - p.w / 2);
      if (d < best) { best = d; which = p; }
    }
    return { d: best, path: which };
  }

  // ================================================================== obstacles → walkable(x, z)
  const OBST = [];       // { x0, z0, x1, z1, test(x, z) → bool }
  for (const e of E) {
    if (e.type === 'building' && !e.open) {
      if (e.rot) {                                       // a rotated building (the gate house): test in its own frame, the passage stays open
        const c = Math.cos(e.rot), sn = Math.sin(e.rot), R = Math.hypot(e.w, e.d) / 2, pw = e.passage ? e.passage.w / 2 : -1;
        OBST.push({ id: e.id, x0: e.x - R, z0: e.z - R, x1: e.x + R, z1: e.z + R, test: (x, z) => { const lx = (x - e.x) * c - (z - e.z) * sn, lz = (x - e.x) * sn + (z - e.z) * c; return Math.abs(lx) <= e.w / 2 && Math.abs(lz) <= e.d / 2 && Math.abs(lx) > pw; } });
        continue;
      }
      const parts = e.parts || [{ x0: e.x - e.w / 2, z0: e.z - e.d / 2, x1: e.x + e.w / 2, z1: e.z + e.d / 2 }];
      for (const p of parts) if (p.id !== 'portico') OBST.push({ id: e.id, x0: p.x0, z0: p.z0, x1: p.x1, z1: p.z1, test: () => true });
    }
    if (e.type === 'wall' && e.arc) {
      const a = e.arc, gates = e.gates || [];
      OBST.push({ id: e.id, x0: a.cx - a.r - 1, z0: a.cz - a.r - 1, x1: a.cx + a.r + 1, z1: a.cz + a.r + 1, test: (x, z) => {
        const r = Math.hypot(x - a.cx, z - a.cz);
        if (Math.abs(r - a.r) > e.w / 2 + 0.05) return false;
        const ang = normA(Math.atan2(z - a.cz, x - a.cx));
        if (a.a1 - a.a0 < TAU - 1e-6 && (ang < normA(a.a0) - 0.01 && !(a.a0 >= PI && ang < 1e-3))) return false;
        if (a.a0 >= PI - 1e-9 && ang < PI - 1e-9 && ang > 1e-3) return false;
        for (const g of gates) { const dA = Math.abs(normA(ang - g.a + PI) - PI) * a.r; if (dA < g.w / 2) return false; }
        return true;
      } });
    }
    if (e.type === 'kiln') OBST.push({ id: e.id, x0: e.x - e.w / 2, z0: e.z1, x1: e.x + e.w / 2, z1: e.z0, test: () => true });
    if (e.type === 'garden') OBST.push({ id: e.id, x0: e.cx - e.r, z0: e.cz - e.r, x1: e.cx + e.r, z1: e.cz + e.r, test: (x, z) => Math.hypot(x - e.fountain.x, z - e.fountain.z) < e.fountain.r });
  }
  function walkable(x, z, L) {
    if (!(x >= bounds.minX && x <= bounds.maxX && z >= bounds.minZ && z <= bounds.maxZ)) return false;
    if (inWater(x, z)) return false;
    for (const o of OBST) if (x >= o.x0 && x <= o.x1 && z >= o.z0 && z <= o.z1 && o.test(x, z)) return false;
    const LL = L || current();
    if (LL && LL.indexAt(x, z, 0) >= 0) return false;
    return true;
  }

  // ================================================================== spawn, viewpoints
  const SPAWN = Object.freeze({ x: -60, z: 41, rot: PI / 2, y: r3(height(-60, 41)), name: '들머리 마당 (셔틀버스 정류장 앞)' });
  const VP = (id, name, x, y, z, lx, ly, lz, fov, extra) => Object.freeze(Object.assign({ id, name, x, y, z, look: Object.freeze({ x: lx, y: ly, z: lz }), fov }, extra || {}));
  const VIEWPOINTS = Object.freeze([
    VP('deck', '전망 데크', DECK.x, DECK.y + 1.6, DECK.z - 3, 22, 2, 8, 62, { stand: { x: DECK.x, z: DECK.z - 2.5 } }),
    VP('aerial', '하늘에서 본 단지 (그림 3과 같은 자리)', -23, 110, 189, -25, 0, -2, 48, { camera: true }),
    VP('gate', '큰 장독대 정문', -38, GC_RIM + 1.6, 108, GC.cx + 6, 0, GC.cz - 6, 60, { stand: { x: -38, z: 108 } }),
    VP('pavilion', '정자 위', KNOLL.cx, KNOLL_Y + 4.2, KNOLL.cz, GC.cx, 0, GC.cz, 60, { stand: { x: KNOLL.cx, z: KNOLL.cz } }),
    VP('amph', '반원 장독대 꼭대기', AM.cx, AM_L0 + 5.8, AM.cz - 58, 60, 2, 20, 62, { stand: { x: AM.cx, z: AM.cz - 63.5 } }),
    VP('garden', '소나무 정원 분수', ROUND.cx + 22, 2.4, ROUND.cz + 18, ROUND.cx, 1.2, ROUND.cz, 58, { stand: { x: ROUND.cx + 22, z: ROUND.cz + 18 } }),
  ]);

  // ================================================================== the 2D site plan
  const COL = Object.freeze({
    paper: '#efe9dc', lawn: '#cfd9b4', lawnDark: '#b9c99c', forest: '#6f8f5e', forestDark: '#55744a', mountain: '#7d9a68', river: '#8fc0d6', riverDeep: '#6aa8c4', bank: '#d9cfb8',
    road: '#9a9ca0', roadEdge: '#7d7f84', mark: '#ffffff', markYellow: '#f2c94c', plaza: '#e6dac3', stone: '#d8cdb6', wall: '#9b8e78', roof: '#4c5058', roofHanok: '#5a5450', roofStore: '#6e6252', roofCafe: '#7a5a45',
    glass: '#9fb7c4', soil: '#b48a5d', soilDark: '#9c7349', walk: '#e9dfca', water: '#8fc0d6', label: '#2e2a25', halo: 'rgba(255,255,250,0.85)', jar: '#8a5a3c', plot: '#6f9a4a', store: '#8d7458', deck: '#b0895e', corridor: '#6d5a45', pine: '#3f6b45',
  });
  const fitView = (w, h, pad, area) => {
    const a = area || { minX: -200, maxX: 200, minZ: -160, maxZ: 170 };
    const scale = Math.min((w - 2 * (pad || 0)) / (a.maxX - a.minX), (h - 2 * (pad || 0)) / (a.maxZ - a.minZ));
    return { x: (a.minX + a.maxX) / 2, z: (a.minZ + a.maxZ) / 2, scale, w, h };
  };
  function draw(ctx, view, opts) {
    opts = opts || {};
    const cv = ctx.canvas || {}, w = view.w || cv.width || 512, h = view.h || cv.height || 512, s = view.scale || 1;
    const TX = (x) => (x - view.x) * s + w / 2, TZ = (z) => (z - view.z) * s + h / 2;
    const L = opts.layout === undefined ? current() : opts.layout;
    const hi = opts.quality !== 'low';
    ctx.save();
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.fillStyle = COL.lawn; ctx.fillRect(0, 0, w, h);
    // relief: a soft hill shade from height() (mountains darker and greener)
    if (opts.relief !== false) {
      const step = Math.max(2, (hi ? 5 : 9) / s) * s >= 3 ? Math.max(2, (hi ? 5 : 9)) : 3 / s;
      const cell = step * s;
      const x0 = view.x - w / 2 / s, z0 = view.z - h / 2 / s;
      for (let pz = 0; pz < h + cell; pz += cell) for (let px = 0; px < w + cell; px += cell) {
        const x = x0 + (px + cell / 2) / s, z = z0 + (pz + cell / 2) / s;
        const y = heightNoRiver(x, z), ye = heightNoRiver(x + 2, z), ys = heightNoRiver(x, z + 2);
        const shade = clamp(0.5 + ((y - ye) * 0.7 + (y - ys) * 0.9) * 0.18, 0, 1);
        const m = smooth(4, 30, y - baseSlope(clamp(z, -152, 141)));
        const g = Math.round(lerp(205, 120, m) * (0.82 + 0.3 * shade)), r = Math.round(lerp(196, 98, m) * (0.82 + 0.3 * shade)), b = Math.round(lerp(170, 86, m) * (0.85 + 0.25 * shade));
        ctx.fillStyle = `rgb(${clamp(r, 0, 255)},${clamp(g, 0, 255)},${clamp(b, 0, 255)})`;
        ctx.fillRect(Math.floor(px), Math.floor(pz), Math.ceil(cell) + 1, Math.ceil(cell) + 1);
      }
    }
    const path = (pts) => { ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(TX(p[0]), TZ(p[1])) : ctx.moveTo(TX(p[0]), TZ(p[1])))); };
    const poly = (pts, fill, stroke, lw) => { path(pts); ctx.closePath(); if (fill) { ctx.fillStyle = fill; ctx.fill(); } if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw || 1; ctx.stroke(); } };
    const rect = (x0, z0, x1, z1, fill, stroke, lw) => poly([[x0, z0], [x1, z0], [x1, z1], [x0, z1]], fill, stroke, lw);
    const circ = (cx, cz, r, fill, stroke, lw) => { ctx.beginPath(); ctx.arc(TX(cx), TZ(cz), Math.max(0.5, r * s), 0, TAU); if (fill) { ctx.fillStyle = fill; ctx.fill(); } if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw || 1; ctx.stroke(); } };
    const line = (pts, col, wm, dash) => { path(pts); ctx.strokeStyle = col; ctx.lineWidth = Math.max(0.6, wm * s); ctx.setLineDash(dash || []); ctx.stroke(); ctx.setLineDash([]); };
    // forests (texture of dots)
    for (const e of E) if (e.type === 'forest') {
      ctx.globalAlpha = 0.55; poly(e.poly, COL.forest); ctx.globalAlpha = 1;
      if (hi && s > 0.6) {
        let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
        for (const p of e.poly) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); z0 = Math.min(z0, p[1]); z1 = Math.max(z1, p[1]); }
        const vx0 = view.x - w / 2 / s, vx1 = view.x + w / 2 / s, vz0 = view.z - h / 2 / s, vz1 = view.z + h / 2 / s;
        const st = Math.max(6, 9 / Math.sqrt(e.density));
        ctx.fillStyle = COL.forestDark;
        for (let z = Math.max(z0, vz0); z < Math.min(z1, vz1); z += st) for (let x = Math.max(x0, vx0); x < Math.min(x1, vx1); x += st) {
          const jx = x + (hashI(Math.round(x), Math.round(z)) - 0.5) * st, jz = z + (hashI(Math.round(z), Math.round(x)) - 0.5) * st;
          if (!pointInPoly(jx, jz, e.poly)) continue;
          ctx.beginPath(); ctx.arc(TX(jx), TZ(jz), Math.max(0.8, 2.2 * s), 0, TAU); ctx.fill();
        }
      }
    }
    // river
    const rp = RIVER.pts.map((p) => [p[0], p[1]]);
    line(rp, COL.bank, RIVER.w + 7); line(rp, COL.river, RIVER.w); if (hi) line(rp, COL.riverDeep, RIVER.w * 0.45);
    // roads + roundabout
    for (const e of E) if (e.type === 'road') line(e.pts, COL.roadEdge, e.w + 1.2);
    circ(ROUND.cx, ROUND.cz, ROUND.r1 + 0.6, COL.roadEdge);
    for (const e of E) if (e.type === 'road') line(e.pts, COL.road, e.w);
    circ(ROUND.cx, ROUND.cz, ROUND.r1, COL.road);
    if (s > 1.2) {
      for (const e of E) if (e.type === 'road' && e.markings.center !== 'none') line(e.pts, e.markings.center === 'double-yellow' ? COL.markYellow : COL.mark, 0.25, [3 * s, 3 * s]);
      ctx.beginPath(); ctx.arc(TX(ROUND.cx), TZ(ROUND.cz), ROUND.lane * s, 0, TAU); ctx.strokeStyle = COL.mark; ctx.lineWidth = Math.max(0.5, 0.2 * s); ctx.setLineDash([3 * s, 3 * s]); ctx.stroke(); ctx.setLineDash([]);
    }
    // garden island
    const gd = E.find((e) => e.type === 'garden');
    circ(gd.cx, gd.cz, gd.r, COL.lawnDark, COL.stone, Math.max(1, 0.6 * s));
    circ(gd.fountain.x, gd.fountain.z, gd.fountain.r, COL.water, COL.stone, Math.max(1, 0.5 * s));
    for (const p of gd.pines) circ(p.x, p.z, 1.9 * p.s, COL.pine);
    // bridge, parking, plazas, bus bay
    const br = E.find((e) => e.type === 'bridge');
    line([[br.x0, br.z0], [br.x1, br.z1]], COL.wall, br.w + 0.8); line([[br.x0, br.z0], [br.x1, br.z1]], COL.stone, br.w);
    const pk = E.find((e) => e.type === 'parking');
    rect(pk.x0, pk.z0, pk.x1, pk.z1, COL.road, COL.roadEdge, 1);
    if (s > 1.5) { ctx.strokeStyle = COL.mark; ctx.lineWidth = 0.6; for (const b of pk.bays) { const hx = Math.abs(Math.sin(b.rot)) * b.d / 2, hz = Math.abs(Math.cos(b.rot)) * b.d / 2; ctx.strokeRect(TX(b.x - (hx || b.w / 2)), TZ(b.z - b.w / 2), (2 * (hx || b.w / 2)) * s, b.w * s); } }
    for (const e of E) if (e.type === 'plaza') rect(e.x0, e.z0, e.x1, e.z1, COL.plaza);
    for (const e of E) if (e.type === 'busbay') rect(e.x0, e.z0, e.x1, e.z1, COL.road, COL.markYellow, Math.max(1, 0.3 * s));
    // great circle + amphitheatre frames
    circ(GC.cx, GC.cz, K.WALL_R, COL.stone, COL.wall, Math.max(1.2, 0.6 * s));
    for (let k = 0; k < 10; k++) { ctx.beginPath(); ctx.arc(TX(GC.cx), TZ(GC.cz), (K.RING_R0 - 1.2 + K.RING_PERIOD * k) * s, 0, TAU); ctx.strokeStyle = COL.walk; ctx.lineWidth = Math.max(0.5, K.WALK_W * s); ctx.stroke(); }
    for (let k = 0; k < 8; k++) { const a = k * SEC; line([[GC.cx + K.PLAZA_R * Math.cos(a), GC.cz + K.PLAZA_R * Math.sin(a)], [GC.cx + K.WALL_R * Math.cos(a), GC.cz + K.WALL_R * Math.sin(a)]], COL.walk, K.AISLE_W); }
    circ(GC.cx, GC.cz, K.PLAZA_R, COL.plaza, COL.wall, 1);
    ctx.beginPath(); ctx.moveTo(TX(AM.cx), TZ(AM.cz)); ctx.arc(TX(AM.cx), TZ(AM.cz), K.WALL_R * s, PI, TAU); ctx.closePath(); ctx.fillStyle = COL.stone; ctx.fill(); ctx.strokeStyle = COL.wall; ctx.lineWidth = Math.max(1.2, 0.6 * s); ctx.stroke();
    for (let k = 0; k < 10; k++) { ctx.beginPath(); ctx.arc(TX(AM.cx), TZ(AM.cz), (K.RING_R0 - 1.2 + K.RING_PERIOD * k) * s, PI, TAU); ctx.strokeStyle = COL.walk; ctx.lineWidth = Math.max(0.5, K.WALK_W * s); ctx.stroke(); }
    for (let k = 4; k <= 8; k++) { const a = k * SEC; line([[AM.cx + K.PLAZA_R * Math.cos(a), AM.cz + K.PLAZA_R * Math.sin(a)], [AM.cx + K.WALL_R * Math.cos(a), AM.cz + K.WALL_R * Math.sin(a)]], COL.walk, K.AISLE_W); }
    circ(AM.cx, AM.cz, K.PLAZA_R, COL.plaza, COL.wall, 1);
    // fields, overflow, terraces
    for (const e of E) if (e.type === 'terrace') rect(e.x0, e.z0, e.x1, e.z1, COL.lawnDark, COL.wall, Math.max(1, 0.4 * s));
    for (const e of E) if (e.type === 'field') { poly(e.poly, e.overflow ? COL.lawnDark : COL.soil, e.overflow ? COL.wall : COL.soilDark, 1); }
    // corridor, stairs, deck, storeyard ground
    for (const e of E) if (e.type === 'storeyard') rect(e.x0, e.z0, e.x1, e.z1, COL.walk);
    line(CORRIDOR_PTS, COL.corridor, 4.4);
    for (const e of E) if (e.type === 'stair' && !e.natural) line(e.pts.map((p) => [p[0], p[1]]), COL.deck, e.w, s > 1.5 ? [0.5 * s, 0.3 * s] : null);
    const dk = E.find((e) => e.type === 'deck'); rect(dk.x0, dk.z0, dk.x1, dk.z1, COL.deck, COL.corridor, 1);
    // buildings (roofs seen from above)
    for (const e of E) if (e.type === 'building') {
      const col = e.kind === 'hanok' || e.kind === 'pavilion' || e.kind === 'gatehouse' ? COL.roofHanok : e.kind === 'storehouse' ? COL.roofStore : e.kind === 'cafe' || e.kind === 'workshop' ? COL.roofCafe : COL.roof;
      if (e.wall && s > 1) rect(e.wall.x0, e.wall.z0, e.wall.x1, e.wall.z1, null, COL.wall, Math.max(0.6, 0.35 * s));
      if (e.rot) {
        const c = Math.cos(e.rot), sn = Math.sin(e.rot), ov = (e.roof || {}).overhang || 0.8, hw = e.w / 2 + ov * 0.6, hd = e.d / 2 + ov * 0.6;
        poly([[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]].map(([lx, lz]) => [e.x + lx * c + lz * sn, e.z - lx * sn + lz * c]), col, 'rgba(0,0,0,0.35)', 1);
        continue;
      }
      const parts = e.parts || [{ x0: e.x - e.w / 2, z0: e.z - e.d / 2, x1: e.x + e.w / 2, z1: e.z + e.d / 2 }];
      for (const p of parts) {
        const ov = (p.roof || e.roof || {}).overhang || 0.8;
        rect(p.x0 - ov * 0.6, p.z0 - ov * 0.6, p.x1 + ov * 0.6, p.z1 + ov * 0.6, col, 'rgba(0,0,0,0.35)', 1);
        if (s > 0.8) { const lw = Math.max(1, 0.5 * s); ctx.strokeStyle = 'rgba(255,255,255,0.32)'; ctx.lineWidth = lw; ctx.beginPath(); const lx = p.x1 - p.x0 >= p.z1 - p.z0; if (lx) { const zc = (p.z0 + p.z1) / 2, inset = (p.z1 - p.z0) / 2; ctx.moveTo(TX(p.x0 + inset), TZ(zc)); ctx.lineTo(TX(p.x1 - inset), TZ(zc)); } else { const xc = (p.x0 + p.x1) / 2, inset = (p.x1 - p.x0) / 2; ctx.moveTo(TX(xc), TZ(p.z0 + inset)); ctx.lineTo(TX(xc), TZ(p.z1 - inset)); } ctx.stroke(); }
      }
      if (e.kind === 'main' && s > 0.6) { ctx.globalAlpha = 0.5; rect(-84, 1.6, -48, 3.2, COL.glass); ctx.globalAlpha = 1; }
    }
    const kn = E.find((e) => e.type === 'kiln'); rect(kn.x - kn.w / 2, kn.z1, kn.x + kn.w / 2, kn.z0, COL.roofCafe, 'rgba(0,0,0,0.35)', 1);
    // units
    if (L && opts.units !== false) {
      const A = L.arrays, style = opts.unitStyle, groups = new Map();
      const vx0 = view.x - w / 2 / s - 2, vx1 = view.x + w / 2 / s + 2, vz0 = view.z - h / 2 / s - 2, vz1 = view.z + h / 2 / s + 2;
      for (let i = 0; i < L.count; i++) {
        const x = A.x[i], z = A.z[i];
        if (x < vx0 || x > vx1 || z < vz0 || z > vz1) continue;
        const kind = K.KINDS[A.kind[i]];
        const col = style ? style(L.zones[A.zone[i]].code, A.seq[i], kind, i) : COL[kind];
        if (!col) continue;
        let g = groups.get(col); if (!g) { g = []; groups.set(col, g); } g.push(i);
      }
      for (const [col, list] of groups) {
        ctx.fillStyle = col;
        if (s < 2.2) {
          const px = Math.max(1, s * 1.05);
          for (const i of list) ctx.fillRect(TX(A.x[i]) - px / 2, TZ(A.z[i]) - px / 2, px, px);
        } else {
          ctx.beginPath();
          for (const i of list) {
            const k = A.kind[i], x = TX(A.x[i]), z = TZ(A.z[i]);
            if (k === 0) { ctx.moveTo(x + K.JAR_R * s, z); ctx.arc(x, z, K.JAR_R * s, 0, TAU); }
            else { const sl = SLOTS[A.slot[i]], g = sl.g, hu = g.hu * s, hv = g.hv * s; const horiz = Math.abs(g.ux) > 0.5; const hw = horiz ? hu : hv, hd = horiz ? hv : hu; ctx.rect(x - hw, z - hd, hw * 2, hd * 2); }
          }
          ctx.fill();
        }
      }
      if (opts.highlight) {
        const u = L.unit(opts.highlight.zone, opts.highlight.seq);
        if (u) { ctx.beginPath(); ctx.arc(TX(u.x), TZ(u.z), Math.max(5, 2.2 * s), 0, TAU); ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 3; ctx.stroke(); ctx.strokeStyle = '#e8590c'; ctx.lineWidth = 1.6; ctx.stroke(); }
      }
    }
    // labels
    if (opts.labels !== false) {
      const fs = clamp(Math.round(11 + s * 1.6), 10, 20);
      const label = (txt, x, z, size, bold) => {
        ctx.font = `${bold ? '700 ' : '600 '}${size}px "Noto Sans KR", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.lineWidth = 3.2; ctx.strokeStyle = COL.halo; ctx.strokeText(txt, TX(x), TZ(z));
        ctx.fillStyle = COL.label; ctx.fillText(txt, TX(x), TZ(z));
      };
      const names = [['만장대 본관', -66, -18, 1], ['한옥 마을', 10, -79, 0], ['정자', KNOLL.cx, KNOLL.cz + 9, 0], ['회랑', 20, -20.5, 0], ['소나무 정원', ROUND.cx, ROUND.cz + 12, 0],
        ['주차장', -127, -22, 0], ['창고 마당', -105.6, -101, 0], ['옹기 공방', -50, -119, 0], ['농촌 카페', -60, 78, 0], ['전망 데크', DECK.x, DECK.z + 8, 0], ['강', riverX(-60) - 1, -60, 0], ['임시 자리', 123, 40, 0],
        ['🚌 정류장', -66, 26, 0]];
      if (!L || !L.zones.length || opts.zoneLabels === false) names.push(['큰 장독대', GC.cx, GC.cz, 1], ['반원 장독대', AM.cx, AM.cz - 30, 1]);
      for (const [t, x, z, b] of names) label(t, x, z, b ? fs + 1 : fs - 1, b);
      if (L && opts.zoneLabels !== false) for (const z of L.zones) if (z.frame) label(z.name, z.frame.label.x, z.frame.label.z, fs, true);
    }
    ctx.restore();
  }

  // ================================================================== current layout
  let CUR = null;
  function current() { if (!CUR) CUR = layout(defaultZones()); return CUR; }
  const use = (L) => { if (L && typeof L.unit === 'function') CUR = L; return CUR; };

  const C = {
    version: 1,
    K, bounds, unitBounds, elements: E, byId: (id) => E.find((e) => e.id === id) || null,
    height, waterY, inWater, slots: SLOTS.map((s) => ({ id: s.id, kind: s.kind, type: s.type, name: s.name, cap: s.cap, limit: s.limit, sys: s.sys || null, sectors: s.sectors || null })),
    defaultZones, layout, cells, paths: PATHS, pathDistance: (x, z, kinds) => pathDistance(x, z, kinds), walkable: (x, z) => walkable(x, z, null),
    spawn: SPAWN, viewpoints: VIEWPOINTS, busStop: BUS_STOP, door: Object.freeze({ x: -66, z: 3.2, rot: 0, building: 'B_MAIN', place: 'PL_OFFICE' }),
    rings: Object.freeze({ GC: Object.freeze({ cx: GC.cx, cz: GC.cz }), AM: Object.freeze({ cx: AM.cx, cz: AM.cz, a0: PI, a1: TAU }), rows: Object.freeze(ROWS.slice()), natural: Object.freeze(ROWGEO.map((g) => g.nat)) }),
    colors: COL, fitView, draw, use, current,
    unit: (code, seq) => current().unit(code, seq),
    unitAt: (x, z, pad) => current().unitAt(x, z, pad),
  };
  G.data = G.data || {};
  G.data.complex = C;
})();
