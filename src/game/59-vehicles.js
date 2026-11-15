// =============================================================================
// 59-vehicles.js — G.vehicles (CONTRACT §17.9, lane world): ONE generator for every parked vehicle of the valley's car
// park and of 만장대 단지 — sedan, SUV, hatchback, van, a 1-ton truck, a tour coach and the shuttle "만장대 셔틀".
//
// Real proportions (lengths, wheelbases, overhangs, wheel sizes of the classes that park in a Korean country car park),
// a lofted body shell with a shoulder line, a glass house with pillars, wheel arches cut into the sill line, tyres and
// rims, head and tail lamps, mirrors, door lines and handles, number plates, a clear-coat paint on `high`, a soft
// ground shadow under every vehicle. A vehicle is ONE geometry (vertex colours + the surface attribute aSurf), every
// kind is ONE InstancedMesh: a whole car park costs a handful of draw calls. `low` builds the same silhouettes from a
// few hundred triangles with a flat material (the frozen-low rule).
//
// UNITS / AXES: metres; a vehicle stands on y = 0 with its FRONT towards +z, its length along z, x across; rot turns it
// about +y (rot 0 = front faces +z / south, the convention of 02-layout.js). The kerb side (doors of the buses) is −x.
//
//   G.vehicles.KINDS                 ['sedan', 'suv', 'hatch', 'van', 'truck', 'coach', 'shuttle']
//   G.vehicles.spec(kind)            -> { kind, L, W, H, wheelbase, r (wheel radius), hw, hd (collider half sizes),
//                                         top (collider height), paint (default colour) }
//   G.vehicles.PAINTS                [{ id, name, rgb: [r, g, b] (linear), weight }]   paints(seed) picks one by weight
//   G.vehicles.fleet(list, opts)     list: [{ kind, x, y, z, rot, paint }] in the PARENT's coordinates (paint: an index
//                                    into PAINTS, a paint id, '#rrggbb' or [r, g, b] linear; default by position).
//                                    opts { quality = the engine's preset, shadow = true, lit = false (lamps and
//                                    windows glow at night), far = true (a simple far form, swapped by update()),
//                                    farDistance = 70, name = 'vehicles' }
//                                    -> { group (add it to your root), count, kinds: { kind: n }, calls (draw calls
//                                         when near), tris, update(cameraPosition), setPaint(i, paint), dispose() }
//   G.vehicles.one(kind, opts)       one vehicle as a THREE.Group (front +z, wheels on y 0): opts { paint, lit = true,
//                                    label, sub (lettering on the sides of a bus), quality, shadow = true }
//                                    group.userData.dispose() frees it; group.userData.kind / spec
//   G.vehicles.geometry(kind, q)     the cached geometry of a kind (q: 'high' | 'medium' | 'low' | 'far'); read only
//   G.vehicles.stats()               { live (fleets + single vehicles alive), cached: { 'kind:q': { tris, users } } }
// Everything a fleet made is freed by its dispose(); the shared geometries and materials are counted per user and go
// when their last user is gone (renderer.info.memory returns to what it was).
//
// The geometry builders are pure buffer maths (no DOM, no renderer): tests/vehicles.mjs runs them in Node for every
// kind and quality (dimensions against the spec table, finite positions and unit normals, triangle budgets) and then
// checks instancing, draw calls and dispose in the built page.
// =============================================================================
(function () {
  'use strict';
  const PI = Math.PI, TAU = PI * 2;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const fin = Number.isFinite;
  const lin = (hex) => { const c = new THREE.Color(hex); return [c.r, c.g, c.b]; };   // sRGB hex -> linear working colour
  const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _u = new THREE.Vector3();
  const KINDS = ['sedan', 'suv', 'hatch', 'van', 'truck', 'coach', 'shuttle'];

  // ---------------------------------------------------------------- surfaces: colour, paint flag, roughness, metalness, glow
  // aSurf = (paint, roughness, metalness, glow). paint 1 = the body colour of the instance (clear coat on `high`);
  // glow 1 = a lamp lens (lit variant: shines in its own colour at night), 0.3 = a lit window (warm room light).
  const SF = (hex, rough, metal, glow = 0, paint = 0) => ({ c: lin(hex), paint, rough, metal, glow });
  const S = {
    paint: SF('#ffffff', 0.34, 0.3, 0, 1),
    glass: SF('#27353d', 0.06, 0.78),
    glassLit: SF('#27353d', 0.06, 0.78, 0.3),
    rubber: SF('#0c0c0d', 0.92, 0),
    rim: SF('#c3c6ca', 0.26, 0.92),
    steel: SF('#8b8e92', 0.5, 0.6),
    chrome: SF('#dfe1e3', 0.12, 1),
    plastic: SF('#17181a', 0.68, 0.05),
    grey: SF('#3a3c40', 0.6, 0.1),
    dark: SF('#050505', 1, 0),
    lens: SF('#f6f3e6', 0.1, 0.25, 1),
    red: SF('#a3120e', 0.22, 0.1, 1),
    amber: SF('#e08a12', 0.25, 0.1, 1),
    plate: SF('#ecece6', 0.55, 0),
    white: SF('#e9e8e2', 0.5, 0.05),
    wood: SF('#a67a48', 0.85, 0),
    onggi: SF('#5a3322', 0.3, 0.05),
    leaf: SF('#7fae3e', 0.85, 0),
    straw: SF('#c9a85c', 0.9, 0),
  };
  const accent = (hex) => SF(hex, 0.4, 0.2);

  // ---------------------------------------------------------------- the spec table (true sizes, metres)
  // t runs from the tail (0) to the nose (1): z = (t − 0.5) · L. shell = the shoulder line (deck · belt · bonnet),
  // roof = the roof line of the glass house from the rear glass base to the scuttle, plan = half width / (W / 2).
  const SPEC = {
    sedan: {
      L: 4.76, W: 1.84, H: 1.45, wb: 2.78, fo: 0.92, r: 0.335, tw: 0.225, clear: 0.17, lift: [0.27, 0.2],
      shell: [[0, 0.97], [0.03, 1.02], [0.12, 1.045], [0.2, 1.05], [0.3, 1.03], [0.5, 0.99], [0.68, 0.965], [0.8, 0.925], [0.9, 0.865], [0.96, 0.81], [1, 0.74]],
      roof: [[0.2, 1.05], [0.26, 1.24], [0.33, 1.4], [0.4, 1.445], [0.5, 1.45], [0.545, 1.43], [0.62, 1.215], [0.695, 0.965]],
      plan: [[0, 0.8], [0.025, 0.9], [0.08, 0.965], [0.2, 1], [0.8, 1], [0.92, 0.97], [0.975, 0.9], [1, 0.8]],
      wind: 0.545, rear: 0.37, bp: 0.455, cp: [0.285, 0], doors: [0.69, 0.455, 0.33], handles: [0.475, 0.35], mirror: 0.665,
      paint: '#d9dadb',
    },
    suv: {
      L: 4.72, W: 1.9, H: 1.7, wb: 2.76, fo: 0.9, r: 0.37, tw: 0.245, clear: 0.21, lift: [0.34, 0.27],
      shell: [[0, 1.1], [0.03, 1.17], [0.1, 1.2], [0.3, 1.19], [0.5, 1.16], [0.68, 1.13], [0.8, 1.095], [0.9, 1.055], [0.96, 1.0], [1, 0.92]],
      roof: [[0.035, 1.19], [0.075, 1.52], [0.13, 1.68], [0.3, 1.7], [0.5, 1.695], [0.57, 1.66], [0.64, 1.42], [0.705, 1.135]],
      plan: [[0, 0.84], [0.025, 0.93], [0.08, 0.985], [0.2, 1], [0.8, 1], [0.92, 0.978], [0.975, 0.92], [1, 0.83]],
      wind: 0.57, rear: 0.13, bp: 0.46, cp: [0.075, 0.285], doors: [0.69, 0.46, 0.325], handles: [0.48, 0.345], mirror: 0.675,
      rails: true, cladding: true, paint: '#2b2d31',
    },
    hatch: {
      L: 4.06, W: 1.76, H: 1.5, wb: 2.58, fo: 0.82, r: 0.315, tw: 0.205, clear: 0.16, lift: [0.26, 0.2],
      shell: [[0, 0.96], [0.03, 1.04], [0.1, 1.07], [0.3, 1.05], [0.5, 1.01], [0.66, 0.98], [0.78, 0.935], [0.9, 0.865], [0.96, 0.8], [1, 0.73]],
      roof: [[0.03, 1.05], [0.09, 1.36], [0.16, 1.49], [0.35, 1.5], [0.5, 1.49], [0.52, 1.475], [0.6, 1.24], [0.68, 0.985]],
      plan: [[0, 0.82], [0.03, 0.92], [0.09, 0.975], [0.2, 1], [0.78, 1], [0.91, 0.97], [0.972, 0.9], [1, 0.8]],
      wind: 0.52, rear: 0.16, bp: 0.44, cp: [0.085, 0], doors: [0.665, 0.44, 0.27], handles: [0.46, 0.295], mirror: 0.645,
      spoiler: true, paint: '#a3242a',
    },
    van: {
      L: 4.98, W: 1.96, H: 1.8, wb: 3.0, fo: 0.93, r: 0.35, tw: 0.235, clear: 0.18, lift: [0.3, 0.22],
      shell: [[0, 1.12], [0.03, 1.2], [0.1, 1.22], [0.5, 1.18], [0.74, 1.14], [0.86, 1.05], [0.94, 0.94], [1, 0.83]],
      roof: [[0.02, 1.22], [0.05, 1.6], [0.1, 1.78], [0.3, 1.8], [0.56, 1.8], [0.62, 1.76], [0.69, 1.5], [0.765, 1.15]],
      plan: [[0, 0.86], [0.025, 0.94], [0.07, 0.99], [0.2, 1], [0.8, 1], [0.91, 0.97], [0.97, 0.9], [1, 0.78]],
      wind: 0.62, rear: 0.1, bp: 0.565, cp: [0.05, 0.33], doors: [0.74, 0.565, 0.3], handles: [0.585, 0.545], mirror: 0.725,
      slide: [0.3, 0.52], paint: '#e9e8e3',
    },
    truck: { L: 4.98, W: 1.74, H: 1.98, wb: 2.56, fo: 1.15, r: 0.31, tw: 0.2, clear: 0.24, paint: '#2f5fa8' },
    coach: { L: 12, W: 2.5, H: 3.42, wb: 6.1, fo: 2.62, r: 0.52, tw: 0.3, clear: 0.34, paint: '#f2f1ec', accent: '#2f4f7a', belt: 1.8, wtop: 2.84, pitch: 1.52 },
    shuttle: { L: 9, W: 2.4, H: 3.02, wb: 4.4, fo: 2.0, r: 0.47, tw: 0.28, clear: 0.32, paint: '#f6efdc', accent: '#2f7a4a', belt: 1.42, wtop: 2.44, pitch: 1.32 },
  };
  const PAINTS = [
    { id: 'white', name: '흰색', rgb: lin('#ecebe6'), weight: 0.26 }, { id: 'silver', name: '은색', rgb: lin('#b4b8bc'), weight: 0.17 },
    { id: 'black', name: '검정', rgb: lin('#141517'), weight: 0.15 }, { id: 'graphite', name: '쥐색', rgb: lin('#4a4d52'), weight: 0.13 },
    { id: 'navy', name: '남색', rgb: lin('#1d2f55'), weight: 0.09 }, { id: 'red', name: '빨강', rgb: lin('#9e1f22'), weight: 0.07 },
    { id: 'beige', name: '모래색', rgb: lin('#c9bfa6'), weight: 0.06 }, { id: 'green', name: '풀색', rgb: lin('#2f5d43'), weight: 0.04 },
    { id: 'blue', name: '파랑', rgb: lin('#2f5fa8'), weight: 0.03 },
  ];

  // ---------------------------------------------------------------- curves
  /** a smooth curve through [t, v] points (monotone cubic: no overshoot between the points) */
  function curve(pts) {
    const n = pts.length, xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]), d = [], m = new Array(n);
    for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
    m[0] = d[0]; m[n - 1] = d[n - 2];
    for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
    for (let i = 0; i < n - 1; i++) {
      if (d[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
      const a = m[i] / d[i], b = m[i + 1] / d[i], s = a * a + b * b;
      if (s > 9) { const k = 3 / Math.sqrt(s); m[i] = k * a * d[i]; m[i + 1] = k * b * d[i]; }
    }
    return (x) => {
      if (x <= xs[0]) return ys[0];
      if (x >= xs[n - 1]) return ys[n - 1];
      let i = 0; while (x > xs[i + 1]) i++;
      const h = xs[i + 1] - xs[i], t = (x - xs[i]) / h, t2 = t * t, t3 = t2 * t;
      return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * m[i + 1];
    };
  }

  // ---------------------------------------------------------------- the part collector (one geometry per vehicle)
  class Parts {
    constructor() { this.pos = []; this.nor = []; this.col = []; this.surf = []; }
    get tris() { return this.pos.length / 9; }
    /** add a BufferGeometry (consumed), placed by matrix m (or where it is), with one surface */
    add(g, m, s) {
      if (m) g.applyMatrix4(m);
      const ng = g.index ? g.toNonIndexed() : g;
      if (!ng.attributes.normal) ng.computeVertexNormals();
      const p = ng.attributes.position.array, n = ng.attributes.normal.array;
      for (let i = 0; i < p.length; i += 3) this.vert(p[i], p[i + 1], p[i + 2], n[i], n[i + 1], n[i + 2], s);
      if (ng !== g) ng.dispose();
      g.dispose();
      return this;
    }
    vert(x, y, z, nx, ny, nz, s) {
      this.pos.push(x, y, z); this.nor.push(nx, ny, nz);
      this.col.push(s.c[0], s.c[1], s.c[2]); this.surf.push(s.paint, s.rough, s.metal, s.glow);
    }
    /** a triangle with its own vertex normals (Vector3 each) */
    tri(a, b, c, na, nb, nc, s) {
      this.vert(a.x, a.y, a.z, na.x, na.y, na.z, s); this.vert(b.x, b.y, b.z, nb.x, nb.y, nb.z, s); this.vert(c.x, c.y, c.z, nc.x, nc.y, nc.z, s);
    }
    /** a flat quad a → b → c → d seen from the side its normal n points to */
    quad(a, b, c, d, n, s) {
      _v.subVectors(b, a).cross(_w.subVectors(d, a));
      if (_v.dot(n) >= 0) { this.tri(a, b, c, n, n, n, s); this.tri(a, c, d, n, n, n, s); } else { this.tri(a, d, c, n, n, n, s); this.tri(a, c, b, n, n, n, s); }
    }
    build() {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
      g.setAttribute('aSurf', new THREE.Float32BufferAttribute(this.surf, 4));
      g.computeBoundingBox(); g.computeBoundingSphere();
      return g;
    }
  }
  const MX = (x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) =>
    new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ')), new THREE.Vector3(sx, sy, sz));
  const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
  const blob = (r, ws = 10, hs = 7) => new THREE.SphereGeometry(r, ws, hs);

  /** loft a grid of points (grid[i] = one ring of Vector3) into smooth-shaded quads; surfOf(i, j) = the surface of the
   *  quad between rings i, i + 1 and ring points j, j + 1 (null = no quad). Normals point away from axisOf(p). */
  function loft(parts, grid, surfOf, axisOf) {
    const ni = grid.length, nj = grid[0].length, N = [];
    for (let i = 0; i < ni; i++) {
      const row = [];
      for (let j = 0; j < nj; j++) {
        const p = grid[i][j], a = grid[Math.min(ni - 1, i + 1)][j], b = grid[Math.max(0, i - 1)][j], c = grid[i][Math.min(nj - 1, j + 1)], d = grid[i][Math.max(0, j - 1)];
        const n = new THREE.Vector3().subVectors(a, b).cross(_w.subVectors(c, d));
        const out = _u.subVectors(p, axisOf(p));
        if (n.lengthSq() < 1e-14) n.copy(out);
        if (n.lengthSq() < 1e-14) n.set(0, 1, 0);
        n.normalize();
        if (n.dot(out) < 0) n.negate();
        row.push(n);
      }
      N.push(row);
    }
    for (let i = 0; i < ni - 1; i++) for (let j = 0; j < nj - 1; j++) {
      const s = surfOf(i, j);
      if (!s) continue;
      const a = grid[i][j], b = grid[i + 1][j], c = grid[i + 1][j + 1], d = grid[i][j + 1];
      const f = _v.subVectors(c, a).cross(_w.subVectors(d, b));          // (diagonals: twice the quad's area vector)
      if (f.lengthSq() < 1e-13) continue;
      const na = N[i][j], nb = N[i + 1][j], nc = N[i + 1][j + 1], nd = N[i][j + 1];
      if (f.dot(_u.copy(na).add(nb).add(nc).add(nd)) >= 0) { parts.tri(a, b, c, na, nb, nc, s); parts.tri(a, c, d, na, nc, nd, s); }
      else { parts.tri(a, d, c, na, nd, nc, s); parts.tri(a, c, b, na, nc, nb, s); }
    }
  }
  /** a half ring [[x, y], …] (sill → centre line) mirrored into a full ring of Vector3 at z (+x side first) */
  function fullRing(half, z, zShear) {
    const out = [], m = half.length;
    for (let j = 0; j < m; j++) out.push(new THREE.Vector3(half[j][0], half[j][1], z + (zShear ? zShear(half[j][1]) : 0)));
    for (let j = m - 2; j >= 0; j--) out.push(new THREE.Vector3(-half[j][0], half[j][1], z + (zShear ? zShear(half[j][1]) : 0)));
    return out;
  }
  /** close an end ring with flat bands between the two sides (level by level); surfOf(j) = the band above ring point j */
  function capRing(parts, ring, m, dir, surfOf) {
    const n = new THREE.Vector3(0, 0, dir);
    for (let j = 0; j < m - 1; j++) {
      const s = surfOf(j); if (!s) continue;
      const a = ring[j], b = ring[j + 1], c = ring[2 * m - 2 - (j + 1)], d = ring[2 * m - 2 - j];
      if (Math.abs(a.x - d.x) < 1e-5 && Math.abs(b.x - c.x) < 1e-5) continue;
      parts.quad(a, b, c, d, n, s);
    }
  }

  // ---------------------------------------------------------------- stations along a vehicle
  /** z positions from the tail to the nose: an even step, the wheel arches sampled as arcs, extra cuts where a colour
   *  changes (pillars, doors) and two short steps at each end (the rounding of the corners) */
  function stations(L, step, arches, cuts, arcN) {
    const zs = new Set(), h = L / 2, key = (z) => Math.round(z * 2000) / 2000;
    const inArch = (z) => arches.some((a) => Math.abs(z - a.z) < a.R - 1e-4);
    const n = Math.max(2, Math.round(L / step));
    for (let i = 0; i <= n; i++) { const z = -h + (L * i) / n; if (!inArch(z)) zs.add(key(z)); }
    for (const e of [0.035, 0.09, 0.17]) { zs.add(key(-h + e)); zs.add(key(h - e)); }
    for (const a of arches) for (let k = 0; k <= arcN; k++) zs.add(key(a.z - a.R * Math.cos((PI * k) / arcN)));
    for (const c of cuts || []) if (c > -h && c < h) zs.add(key(c));
    const list = [...zs].sort((p, q) => p - q), out = [];
    for (const z of list) if (!out.length || z - out[out.length - 1] > 0.012) out.push(z); else if (cuts && cuts.some((c) => Math.abs(c - z) < 1e-3)) out[out.length - 1] = z;
    return out;
  }

  // ---------------------------------------------------------------- wheels
  /** one wheel at the origin: axis along x, the outer face towards +x */
  function wheelInto(P, m, r, tw, q, heavy) {
    const seg = q === 'high' ? 20 : q === 'medium' ? 14 : 8;
    const toX = new THREE.Matrix4().makeRotationZ(-PI / 2);
    const place = (g) => g.applyMatrix4(toX).applyMatrix4(m);
    const rimR = r * (heavy ? 0.56 : 0.66), h = tw / 2;
    if (q === 'low' || q === 'far') {
      P.add(place(new THREE.CylinderGeometry(r, r, tw, seg)), null, S.rubber);
      P.add(place(new THREE.CylinderGeometry(rimR, rimR, 0.02, seg).translate(0, h + 0.006, 0)), null, heavy ? S.steel : S.rim);
      return;
    }
    const V2 = (a, b) => new THREE.Vector2(a, b);
    // tyre: bead → side wall → shoulder → tread → shoulder → side wall → bead
    const tyre = q === 'high'
      ? [V2(rimR, -h + 0.012), V2(r - 0.045, -h), V2(r - 0.012, -h + 0.018), V2(r, -h + 0.05), V2(r, h - 0.05), V2(r - 0.012, h - 0.018), V2(r - 0.045, h), V2(rimR, h - 0.012)]
      : [V2(rimR, -h + 0.012), V2(r - 0.03, -h), V2(r, -h + 0.04), V2(r, h - 0.04), V2(r - 0.03, h), V2(rimR, h - 0.012)];
    P.add(place(new THREE.LatheGeometry(tyre, seg)), null, S.rubber);
    if (heavy) {
      // a steel bus wheel: a deep dish, the hub and a ring of nuts
      P.add(place(new THREE.LatheGeometry([V2(rimR, h - 0.012), V2(rimR - 0.02, h - 0.03), V2(rimR * 0.72, h - 0.1), V2(0.15, h - 0.11), V2(0.12, h - 0.04), V2(0.0001, h - 0.03)], seg)), null, S.steel);
      if (q === 'high') for (let k = 0; k < 8; k++) { const a = (k / 8) * TAU; P.add(place(new THREE.CylinderGeometry(0.014, 0.014, 0.03, 6).translate(Math.cos(a) * 0.2, h - 0.095, Math.sin(a) * 0.2)), null, S.chrome); }
      return;
    }
    // an alloy wheel: the barrel with its lip, a dark disc behind five double spokes, the centre cap
    P.add(place(new THREE.LatheGeometry(q === 'high' ? [V2(rimR, -h + 0.012), V2(rimR, h - 0.02), V2(rimR - 0.014, h - 0.012), V2(rimR - 0.03, h - 0.03)] : [V2(rimR, h - 0.1), V2(rimR, h - 0.014), V2(rimR - 0.03, h - 0.03)], seg)), null, S.rim);
    P.add(place(new THREE.CircleGeometry(rimR - 0.012, seg).rotateX(-PI / 2).translate(0, h - 0.085, 0)), null, S.grey);
    const spokes = q === 'high' ? 10 : 5, len = rimR - 0.04;
    for (let k = 0; k < spokes; k++) {
      const a = (k / spokes) * TAU + (spokes === 10 ? (k % 2 ? 0.1 : -0.1) : 0);
      const g = box(spokes === 10 ? 0.026 : 0.05, 0.022, len).translate(0, h - 0.045 - 0.012, len / 2 + 0.02);
      g.applyMatrix4(new THREE.Matrix4().makeRotationX(0.07)).applyMatrix4(new THREE.Matrix4().makeRotationY(a));
      P.add(place(g), null, S.rim);
    }
    P.add(place(new THREE.CylinderGeometry(0.058, 0.066, 0.03, q === 'high' ? 12 : 8).translate(0, h - 0.035, 0)), null, S.rim);
  }
  function wheelsInto(P, sp, q, axles, heavy, dual) {
    for (const z of axles) for (const s of [1, -1]) {
      const x = s * (sp.W / 2 - sp.tw / 2 - 0.012), m = MX(x, sp.r, z, 0, s > 0 ? 0 : PI, 0);
      wheelInto(P, m, sp.r, sp.tw, q, heavy);
      if (dual && z < 0) wheelInto(P, MX(x - s * (sp.tw + 0.03), sp.r, z, 0, s > 0 ? 0 : PI, 0), sp.r, sp.tw, q === 'high' ? 'medium' : q, heavy);
    }
  }

  // ---------------------------------------------------------------- cars: sedan · SUV · hatchback · van
  function buildCar(kind, q) {
    const sp = SPEC[kind], P = new Parts(), L = sp.L, h = L / 2, W2 = sp.W / 2;
    const hi = q === 'high', lo = q === 'low' || q === 'far';
    const tz = (t) => (t - 0.5) * L, zt = (z) => z / L + 0.5;
    const shellC = curve(sp.shell), roofC = curve(sp.roof), planC = curve(sp.plan);
    const zF = h - sp.fo, zR = zF - sp.wb, Ra = sp.r + 0.07;
    const arches = [{ z: zR, R: Ra }, { z: zF, R: Ra }];
    const lowAt = (z) => {
      const t = zt(z);
      let y = sp.clear + (sp.lift[0] - sp.clear) * smooth(0.07, 0, t) + (sp.lift[1] - sp.clear) * smooth(0.94, 1, t);
      for (const a of arches) { const d = Math.abs(z - a.z); if (d < a.R) y = Math.max(y, sp.r + Math.sqrt(a.R * a.R - d * d)); }
      return y;
    };
    const half = (z) => W2 * planC(zt(z));
    const sq = (z) => { const t = zt(z); return lerp(4.4, 9, smooth(0.02, 0.2, t) * smooth(0.98, 0.76, t)); };   // boxy at the doors, rounder at the ends
    const M = hi ? 10 : lo ? 4 : 7;
    const ringMemo = new Map();
    const shellHalf = (z) => { const k = Math.round(z * 4000); let r = ringMemo.get(k); if (!r) { r = shellHalf0(z); ringMemo.set(k, r); } return r; };
    const shellHalf0 = (z) => {
      const yTop = shellC(zt(z)), yLo = Math.min(lowAt(z), yTop - 0.1), w = half(z), yc = yLo + (yTop - yLo) * 0.5, n = sq(z), pts = [];
      pts.push([w * 0.95, yLo]);
      if (M >= 7) pts.push([w * 0.985, lerp(yLo, yc, 0.55)]);
      const K = M - pts.length;
      for (let k = 0; k < K; k++) {
        const phi = (PI / 2) * Math.pow(k / (K - 1), 0.8), c = Math.cos(phi), s = Math.sin(phi);
        const x = k === K - 1 ? 0 : w * Math.pow(c, 2 / n);
        pts.push([x, yc + (yTop - yc) * Math.pow(s, 2 / n) + 0.018 * (1 - (x / w) * (x / w))]);   // a little crown
      }
      return pts;
    };
    /** half width of the shell at height y (for things that sit on the body side) */
    const sideX = (z, y) => {
      const r = shellHalf(z);
      for (let j = 0; j < r.length - 1; j++) if (y <= r[j + 1][1] || j === r.length - 2) { const a = r[j], b = r[j + 1], t = clamp((y - a[1]) / Math.max(1e-6, b[1] - a[1]), 0, 1); return lerp(a[0], b[0], t); }
      return r[0][0];
    };
    /** height of the shell's upper surface where its half width is x (the shoulder under the glass house) */
    const shoulderY = (z, x) => {
      const r = shellHalf(z);
      for (let j = r.length - 1; j > 0; j--) { const a = r[j], b = r[j - 1]; if (x <= b[0] || j === 1) { const t = clamp((x - a[0]) / Math.max(1e-6, b[0] - a[0]), 0, 1); return lerp(a[1], b[1], t); } }
      return r[r.length - 1][1];
    };
    const tGlass0 = sp.roof[0][0], tGlass1 = sp.roof[sp.roof.length - 1][0];
    const cuts = [];
    if (!lo) {
      cuts.push(tz(sp.bp) - 0.045, tz(sp.bp) + 0.045, tz(sp.wind), tz(sp.rear), tz(sp.cp[0]));
      if (sp.cp[1]) cuts.push(tz(sp.cp[1]) - 0.04, tz(sp.cp[1]) + 0.04);
    }
    cuts.push(tz(tGlass0), tz(tGlass1));
    const zs = stations(L, hi ? 0.085 : lo ? 0.34 : 0.19, arches, cuts, hi ? 12 : lo ? 4 : 6);
    const axis = (p) => _w.set(0, 0.62, clamp(p.z, -h + 0.55, h - 0.55) * 0.92);

    // ---- the body shell (paint), its floor and the two end faces
    const grid = zs.map((z) => fullRing(shellHalf(z), z));
    loft(P, grid, () => S.paint, axis);
    const dn = new THREE.Vector3(0, -1, 0);
    for (let i = 0; i < grid.length - 1; i++) { const a = grid[i][0], b = grid[i + 1][0], c = grid[i + 1][2 * M - 2], d = grid[i][2 * M - 2]; P.quad(a, b, c, d, dn, S.dark); }
    capRing(P, grid[0], M, -1, () => S.paint);
    capRing(P, grid[grid.length - 1], M, 1, () => S.paint);
    // what is seen through the arches: a dark block between the wheels of each axle
    for (const a of arches) P.add(box(sp.W - 2 * sp.tw - 0.16, sp.r + a.R - sp.clear, a.R * 2 + 0.1), MX(0, (sp.r + a.R + sp.clear) / 2, a.z), S.dark);

    // ---- the glass house: side glass, pillars, roof, windscreen and rear glass
    const MC = hi ? 8 : lo ? 4 : 5, jSide = hi ? 2 : 1, jRail = hi ? 5 : lo ? 2 : 3;
    const gh = sp.H - shellC(0.45);
    const cabHalf = (z) => {
      const t = zt(z), wb = half(z) * 0.945, yb = shoulderY(z, wb) - 0.02, yr = Math.max(yb + 0.002, roofC(t)), hg = yr - yb;
      const rr = Math.min(0.085, hg * 0.5), ys = yr - rr, ws = wb - 0.36 * (ys - yb) * clamp(hg / gh + 0.25, 0, 1);
      const wtop = Math.max(0.05, ws - rr * 1.15), crown = 0.02 * clamp(hg / gh, 0, 1);
      if (MC === 4) return [[wb, yb], [ws, ys], [wtop, yr], [0, yr + crown]];
      if (MC === 5) return [[wb, yb], [ws, ys], [ws - rr * 0.5, yr - rr * 0.32], [wtop, yr], [0, yr + crown]];
      const arc = (a) => [ws - (ws - wtop) * (1 - Math.cos(a)), ys + rr * Math.sin(a)];
      return [[wb, yb], [lerp(wb, ws, 0.5) + 0.006, lerp(yb, ys, 0.5)], [ws, ys], arc(PI / 6), arc(PI / 3), [wtop, yr], [wtop * 0.5, yr + crown * 0.75], [0, yr + crown]];
    };
    const cz = zs.filter((z) => z >= tz(tGlass0) - 1e-4 && z <= tz(tGlass1) + 1e-4);
    const cgrid = cz.map((z) => fullRing(cabHalf(z), z));
    const bz = tz(sp.bp), cp0 = tz(sp.cp[0]), cp1 = sp.cp[1] ? tz(sp.cp[1]) : null;
    loft(P, cgrid, (i, j) => {
      const zm = (cz[i] + cz[i + 1]) / 2, t = zt(zm), jj = j < MC - 1 ? j : 2 * MC - 3 - j;   // level index on either side
      if (jj < jSide) {
        if (lo) return zm < cp0 ? S.paint : S.glass;
        if (Math.abs(zm - bz) < 0.045) return S.plastic;                  // B pillar
        if (cp1 != null && Math.abs(zm - cp1) < 0.04) return S.plastic;   // C pillar of the long roofs
        if (zm < cp0) return S.paint;                                     // the last pillar (the boot side of a saloon)
        return S.glass;
      }
      if (jj < jRail) return S.paint;                                     // roof rails · A pillars · C pillars
      return t > sp.wind || t < sp.rear ? S.glass : S.paint;              // windscreen · roof · rear glass
    }, (p) => _w.set(0, shellC(zt(p.z)) - 0.25, clamp(p.z, tz(tGlass0) + 0.5, tz(tGlass1) - 0.5)));

    // ---- wheels
    wheelsInto(P, sp, q, [zR, zF], false, false);
    if (lo) {
      // lamps as plain blocks so the far form still reads as a car
      for (const s of [-1, 1]) {
        P.add(box(0.36, 0.1, 0.05), MX(s * W2 * 0.62, shellC(1) - 0.08, h - 0.015), S.lens);
        P.add(box(0.34, 0.1, 0.05), MX(s * W2 * 0.64, shellC(0) - 0.1, -h + 0.015), S.red);
      }
      return P.build();
    }

    // ---- lamps, grille, bumpers, plates
    const noseTop = shellC(1), tailTop = shellC(0), nW = half(h - 0.12), tW = half(-h + 0.12);
    /** a lamp lens: a flattened dome sunk into the corner; what would stand proud of the body is pressed flush */
    const lamp = (m, surf) => {
      const g = blob(1, 12, 8).applyMatrix4(m), p = g.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const z = clamp(p.getZ(i), -h - 0.012, h + 0.012), lim = half(clamp(z, -h, h)) + 0.012;
        p.setXYZ(i, clamp(p.getX(i), -lim, lim), p.getY(i), z);
      }
      P.add(g, null, surf);
    };
    for (const s of [-1, 1]) {
      lamp(MX(s * (nW - 0.25), noseTop - 0.15, h - 0.13, 0, s * 0.45, 0, 0.27, 0.075, 0.19), S.lens);
      lamp(MX(s * (nW - 0.02), noseTop - 0.17, h - 0.4, 0, 0, 0, 0.04, 0.04, 0.08), S.amber);
      lamp(MX(s * (tW - 0.23), tailTop - 0.16, -h + 0.12, 0, -s * 0.5, 0, 0.27, 0.08, 0.17), S.red);
      if (hi) P.add(box(0.2, 0.03, 0.02), MX(s * (nW - 0.33), sp.lift[1] + 0.13, h - 0.005, 0, s * 0.12, 0), S.lens);   // a daytime lamp bar
    }
    const faceH = noseTop - sp.lift[1];
    P.add(box(nW * 1.05, faceH * 0.3, 0.05), MX(0, sp.lift[1] + faceH * 0.56, h - 0.012), S.plastic);       // grille
    P.add(box(nW * 1.5, faceH * 0.22, 0.05), MX(0, sp.lift[1] + faceH * 0.15, h - 0.02), S.plastic);        // lower intake
    P.add(box(0.5, 0.11, 0.02), MX(0, sp.lift[1] + faceH * 0.34, h + 0.008), S.plate);
    P.add(box(tW * 1.5, 0.09, 0.05), MX(0, sp.lift[0] + 0.05, -h + 0.02), S.plastic);                        // rear valance
    P.add(box(0.5, 0.11, 0.02), MX(0, tailTop - (kind === 'sedan' ? 0.3 : 0.42), -h - 0.004), S.plate);
    if (hi) for (const s of [-1, 1]) P.add(new THREE.CylinderGeometry(0.03, 0.03, 0.09, 8), MX(s * tW * 0.55, sp.lift[0] + 0.03, -h + 0.02, PI / 2, 0, 0), S.chrome);

    // ---- mirrors
    const mzz = tz(sp.mirror), my = shellC(sp.mirror) + 0.055;
    for (const s of [-1, 1]) {
      const mx = sideX(mzz, my - 0.1);
      P.add(box(0.09, 0.03, 0.05), MX(s * (mx + 0.03), my, mzz), S.plastic);
      P.add(blob(1, 8, 6), MX(s * (mx + 0.13), my + 0.02, mzz - 0.01, 0, 0, 0, 0.085, 0.055, 0.04), S.paint);
      P.add(box(0.13, 0.075, 0.006), MX(s * (mx + 0.13), my + 0.02, mzz - 0.045), S.chrome);
    }

    // ---- door lines and handles: thin dark ribbons that follow the body side
    const ribbon = (z, y0, y1, wz) => {
      const n = 4, pts = [];
      for (let k = 0; k <= n; k++) { const y = lerp(y0, y1, k / n); pts.push([sideX(z, y) + 0.0025, y]); }
      for (const s of [-1, 1]) for (let k = 0; k < n; k++) {
        const a = new THREE.Vector3(s * pts[k][0], pts[k][1], z - wz / 2), b = new THREE.Vector3(s * pts[k][0], pts[k][1], z + wz / 2);
        const c = new THREE.Vector3(s * pts[k + 1][0], pts[k + 1][1], z + wz / 2), d = new THREE.Vector3(s * pts[k + 1][0], pts[k + 1][1], z - wz / 2);
        P.quad(a, b, c, d, new THREE.Vector3(s, 0, 0), S.dark);
      }
    };
    for (const t of sp.doors) { const z = tz(t); ribbon(z, lowAt(z) + 0.07, shellC(t) - 0.03, 0.011); }
    for (const t of sp.handles) {
      const z = tz(t), y = shellC(t) - 0.115;
      for (const s of [-1, 1]) P.add(box(0.018, 0.026, 0.15), MX(s * (sideX(z, y) + 0.008), y, z), hi ? S.chrome : S.paint);
    }
    if (sp.slide) { const y = shellC(0.4) - 0.3; for (const s of [-1, 1]) for (let k = 0; k < 6; k++) { const z0 = tz(lerp(sp.slide[0], sp.slide[1], k / 6)), z1 = tz(lerp(sp.slide[0], sp.slide[1], (k + 1) / 6)); P.add(box(0.008, 0.02, z1 - z0), MX(s * (sideX((z0 + z1) / 2, y) + 0.003), y, (z0 + z1) / 2), S.dark); } }   // the sliding door's rail

    // ---- sills, arch trims, roof rails, spoiler, antenna, wipers
    if (sp.cladding) {
      for (const a of arches) for (const s of [-1, 1]) {
        const N = hi ? 10 : 6;
        for (let k = 0; k < N; k++) {
          const a0 = (PI * k) / N, a1 = (PI * (k + 1)) / N, am = (a0 + a1) / 2, z = a.z - Math.cos(am) * (a.R + 0.03), y = sp.r + Math.sin(am) * (a.R + 0.03);
          P.add(box(0.03, 0.075, (PI * (a.R + 0.03)) / N + 0.012), MX(s * (sideX(z, y) + 0.004), y, z, -(PI / 2 - am), 0, 0), S.plastic);
        }
      }
      for (const s of [-1, 1]) P.add(box(0.03, 0.1, zF - zR - 2 * Ra), MX(s * (sideX(0, sp.clear + 0.06) + 0.004), sp.clear + 0.06, (zF + zR) / 2), S.plastic);
    }
    if (sp.rails) for (const s of [-1, 1]) {
      const z0 = tz(sp.rear) + 0.1, z1 = tz(sp.wind) - 0.12, x = cabHalf((z0 + z1) / 2)[MC - 3][0] * 0.94;
      P.add(box(0.035, 0.03, z1 - z0), MX(s * x, sp.H + 0.035, (z0 + z1) / 2), S.plastic);
      for (const z of [z0 + 0.06, z1 - 0.06]) P.add(box(0.035, 0.04, 0.07), MX(s * x, sp.H + 0.012, z), S.plastic);
    }
    if (sp.spoiler) P.add(box(sp.W * 0.62, 0.025, 0.16), MX(0, roofC(sp.rear) + 0.03, tz(sp.rear) - 0.07, 0.12, 0, 0), S.paint);
    P.add(box(0.035, 0.05, 0.14), MX(0, roofC(sp.rear + 0.05) + 0.03, tz(sp.rear + 0.05), -0.25, 0, 0), S.plastic);                   // shark fin
    if (hi) for (const s of [-1, 1]) { const t = tGlass1 - 0.012; P.add(box(0.5, 0.012, 0.022), MX(s * 0.3, shellC(t) + 0.035, tz(t) - 0.06, 0, s * 0.3, 0), S.dark); }   // wipers at rest
    return P.build();
  }

  // ---------------------------------------------------------------- a box body lofted by levels (the buses, the truck's cab)
  /** levels: [{ y, x (half width as a fraction of the plan), s (surface of the band ABOVE this level) }] bottom → roof edge;
   *  the ring ends on the centre line at topY. bandAt(i0, zMid, k, leftSide) may override a band's surface. */
  function boxBody(P, o) {
    const { zs, levels, halfAt, lowAt, topY, shear, bandAt } = o;
    const K = levels.length, m = K + 2;
    const ringAt = (z) => {
      const w = halfAt(z), lo = lowAt(z), pts = [];
      for (let k = 0; k < K; k++) pts.push([w * levels[k].x, Math.max(levels[k].y, lo + k * 0.012)]);
      const last = pts[K - 1];
      pts.push([last[0] * 0.55, topY + 0.0], [0, topY + 0.02]);
      return fullRing(pts, z, shear ? (y) => shear(y, z) : null);
    };
    const grid = zs.map(ringAt);
    const surf = (i, j) => {
      const left = j >= m - 1, k = left ? 2 * m - 3 - j : j;      // band index above level k
      const zm = (zs[i] + zs[i + 1]) / 2;
      const base = k >= K - 1 ? levels[K - 1].s : levels[k].s;
      return bandAt ? bandAt(zm, k, left, base) : base;
    };
    loft(P, grid, surf, o.axis);
    const dn = new THREE.Vector3(0, -1, 0);
    for (let i = 0; i < grid.length - 1; i++) P.quad(grid[i][0], grid[i + 1][0], grid[i + 1][2 * m - 2], grid[i][2 * m - 2], dn, S.dark);
    capRing(P, grid[0], m, -1, (j) => (o.capAt ? o.capAt(-1, j, j >= K - 1 ? levels[K - 1].s : levels[j].s) : (j >= K - 1 ? levels[K - 1].s : levels[j].s)));
    capRing(P, grid[grid.length - 1], m, 1, (j) => (o.capAt ? o.capAt(1, j, j >= K - 1 ? levels[K - 1].s : levels[j].s) : (j >= K - 1 ? levels[K - 1].s : levels[j].s)));
    return grid;
  }

  // ---------------------------------------------------------------- the tour coach and the shuttle
  function buildBus(kind, q) {
    const sp = SPEC[kind], P = new Parts(), L = sp.L, h = L / 2, W2 = sp.W / 2, coach = kind === 'coach';
    const hi = q === 'high', lo = q === 'low' || q === 'far';
    const zF = h - sp.fo, zR = zF - sp.wb, Ra = sp.r + 0.1, acc = accent(sp.accent);
    const arches = [{ z: zR, R: Ra }, { z: zF, R: Ra }];
    const lowAt = (z) => { let y = sp.clear + 0.12 * smooth(h - 0.5, h, z) + 0.16 * smooth(-h + 0.6, -h, z); for (const a of arches) { const d = Math.abs(z - a.z); if (d < a.R) y = Math.max(y, sp.r + Math.sqrt(a.R * a.R - d * d)); } return y; };
    const halfAt = (z) => W2 * (1 - 0.13 * Math.pow(smooth(h - 0.62, h, z), 2.2) - 0.07 * Math.pow(smooth(-h + 0.4, -h, z), 2.2));
    // window bays: a pillar every `pitch` between the first pillar behind the windscreen and the rear corner
    const wz1 = h - (coach ? 1.25 : 1.05), wz0 = -h + (coach ? 0.75 : 0.55), nb = Math.max(2, Math.round((wz1 - wz0) / sp.pitch)), pw = 0.05;
    const pillars = []; for (let k = 0; k <= nb; k++) pillars.push(wz0 + ((wz1 - wz0) * k) / nb);
    const door = { z0: zF + Ra + 0.12, z1: Math.min(h - 0.5, zF + Ra + 0.12 + (coach ? 0.95 : 1.05)) };          // the front door (kerb side, −x)
    const door2 = coach ? { z0: -0.2, z1: 0.75 } : null;
    const cuts = [door.z0, door.z1];
    if (door2) cuts.push(door2.z0, door2.z1);
    if (!lo) for (const pz of pillars) cuts.push(pz - pw, pz + pw);
    const zs = stations(L, hi ? 0.36 : lo ? 1.1 : 0.6, arches, cuts, hi ? 12 : lo ? 4 : 7);
    const glassS = S.glassLit, rail = sp.H - 0.2;
    const levels = [
      { y: sp.clear, x: 0.96, s: acc }, { y: 0.62, x: 1, s: acc }, { y: coach ? 1.12 : 0.9, x: 1, s: S.paint },
      { y: sp.belt, x: 1, s: glassS }, { y: sp.wtop, x: 0.985, s: S.paint }, { y: rail, x: 0.965, s: S.white }, { y: sp.H - 0.05, x: 0.86, s: S.white },
    ];
    const rake = coach ? 0.2 : 0.14;
    boxBody(P, {
      zs, levels, halfAt, lowAt, topY: sp.H,
      shear: (y, z) => -Math.max(0, y - sp.belt) * rake * smooth(h - 1.6, h - 0.2, z),       // the windscreen leans back
      axis: (p) => _w.set(0, sp.H * 0.5, clamp(p.z, -h + 1.2, h - 1.2) * 0.95),
      bandAt: (zm, k, left, base) => {
        if (k === 3) {                                                                    // the window band
          if (zm > wz1 + pw || zm < wz0 - pw) return zm > wz1 ? glassS : S.paint;          // the wrap of the windscreen · the rear corner
          if (!lo && pillars.some((pz) => Math.abs(zm - pz) < pw)) return S.plastic;
          return glassS;
        }
        if (left && (k === 1 || k === 2) && ((zm > door.z0 && zm < door.z1) || (door2 && zm > door2.z0 && zm < door2.z1))) return glassS;   // door glass down to the step
        return base;
      },
      capAt: (dir, j, base) => (dir > 0 ? (j === 3 || (coach && j === 2) ? glassS : j === 2 ? S.paint : base) : (j === 3 ? (coach ? S.paint : glassS) : base)),
    });
    for (const a of arches) P.add(box(sp.W - 2 * sp.tw - 0.2, sp.r + a.R - sp.clear, a.R * 2 + 0.16), MX(0, (sp.r + a.R + sp.clear) / 2, a.z), S.dark);
    wheelsInto(P, sp, q, [zR, zF], true, coach);
    // ---- lamps and the face
    const fz = h - 0.02, rz = -h + 0.02;
    for (const s of [-1, 1]) {
      if (lo) { P.add(box(0.4, 0.2, 0.06), MX(s * W2 * 0.66, 0.92, fz), S.lens); P.add(box(0.2, 0.5, 0.06), MX(s * W2 * 0.8, 1.2, rz), S.red); continue; }
      if (coach) { P.add(box(0.46, 0.17, 0.06), MX(s * W2 * 0.66, 0.9, fz - 0.03, 0, s * 0.18, 0), S.lens); P.add(box(0.2, 0.09, 0.06), MX(s * W2 * 0.66, 0.74, fz - 0.03, 0, s * 0.18, 0), S.amber); }
      else { P.add(new THREE.CylinderGeometry(0.19, 0.19, 0.07, 16), MX(s * W2 * 0.64, 0.98, fz - 0.03, PI / 2, 0, 0), S.lens); P.add(new THREE.CylinderGeometry(0.075, 0.075, 0.07, 10), MX(s * W2 * 0.86, 0.98, fz - 0.06, PI / 2, 0, 0), S.amber); }
      P.add(box(0.2, 0.52, 0.06), MX(s * W2 * 0.82, 1.3, rz + 0.01), S.red);
      P.add(box(0.2, 0.14, 0.06), MX(s * W2 * 0.82, 0.92, rz + 0.01), S.amber);
      for (const yy of [sp.H - 0.24]) { P.add(box(0.12, 0.05, 0.05), MX(s * W2 * 0.62, yy, fz - 0.5 * rake - 0.1), S.amber); P.add(box(0.12, 0.05, 0.05), MX(s * W2 * 0.62, yy, rz + 0.03), S.red); }   // roof marker lamps
    }
    if (!lo) {
      P.add(box(sp.W * 0.62, 0.2, 0.05), MX(0, 0.62, fz), S.plastic);                             // lower grille
      P.add(box(sp.W + 0.06, 0.26, 0.2), MX(0, sp.clear + 0.2, h - 0.06), S.plastic);               // bumpers
      P.add(box(sp.W + 0.04, 0.26, 0.18), MX(0, sp.clear + 0.24, -h + 0.06), S.plastic);
      P.add(box(0.52, 0.12, 0.02), MX(0, sp.clear + 0.22, h + 0.045), S.plate);
      P.add(box(0.52, 0.12, 0.02), MX(0, 0.95, -h - 0.012), S.plate);
      P.add(box(sp.W * 0.7, 0.26, 0.04), MX(0, sp.wtop + 0.18, fz - 0.36 * rake * 4 - 0.02, -0.22, 0, 0), S.dark);   // the destination board's housing
      P.add(box(sp.W * 0.52, 0.26, L * 0.22), MX(0, sp.H + 0.13, -L * 0.12), S.white);              // the roof air unit
      P.add(box(sp.W * 0.46, 0.05, L * 0.2), MX(0, sp.H + 0.27, -L * 0.12), S.grey);
      for (const zz of [L * 0.16, L * 0.3]) P.add(box(0.7, 0.05, 0.7), MX(0, sp.H + 0.04, zz), S.grey);   // roof hatches
      // mirrors: the coach carries them on two long arms from the roof corners, the shuttle on short arms at the pillars
      for (const s of [-1, 1]) {
        if (coach) {
          P.add(box(0.05, 0.05, 0.62), MX(s * (W2 + 0.02), sp.H - 0.45, h - 0.1, 0.5, 0, 0), S.plastic);
          P.add(box(0.05, 0.56, 0.05), MX(s * (W2 + 0.06), sp.H - 0.86, h + 0.14), S.plastic);
          P.add(box(0.07, 0.42, 0.22), MX(s * (W2 + 0.08), sp.H - 1.02, h + 0.14), S.plastic);
          P.add(box(0.008, 0.36, 0.18), MX(s * (W2 + 0.08) - s * 0.0, sp.H - 1.02, h + 0.14 - 0.115), S.chrome);
        } else {
          P.add(box(0.3, 0.04, 0.04), MX(s * (W2 + 0.1), sp.belt + 0.42, h - 0.72), S.plastic);
          P.add(box(0.06, 0.36, 0.2), MX(s * (W2 + 0.26), sp.belt + 0.42, h - 0.72), S.plastic);
          P.add(box(0.008, 0.3, 0.16), MX(s * (W2 + 0.26), sp.belt + 0.42, h - 0.72 - 0.105), S.chrome);
        }
      }
      // door frames (kerb side), luggage hatches of the coach, wipers
      const frame = (d) => { for (const z of [d.z0, d.z1, (d.z0 + d.z1) / 2]) P.add(box(0.012, sp.wtop - 0.5, 0.03), MX(-(halfAt(z) + 0.004), (sp.wtop + 0.5) / 2, z), S.dark); };
      frame(door); if (door2) frame(door2);
      if (coach) for (const s of [-1, 1]) for (let k = 0; k < 4; k++) { const z = zR + Ra + 0.5 + k * 1.05; if (z < zF - Ra - 0.3) P.add(box(0.008, 0.36, 0.012), MX(s * (halfAt(z) + 0.003), 0.82, z), S.dark); }
      if (hi) for (const s of [-1, 1]) P.add(box(0.75, 0.014, 0.03), MX(s * 0.5, sp.belt + 0.07, fz + 0.035, 0, 0, s * 0.5), S.dark);
    }
    return P.build();
  }

  // ---------------------------------------------------------------- the 1-ton truck (cab over the engine, a drop-side bed)
  function buildTruck(q) {
    const sp = SPEC.truck, P = new Parts(), L = sp.L, h = L / 2, W2 = sp.W / 2;
    const hi = q === 'high', lo = q === 'low' || q === 'far';
    const zF = h - sp.fo, zR = zF - sp.wb, Ra = sp.r + 0.08, cabBack = h - 1.66, belt = 1.2, wtop = 1.8;
    const arch = { z: zF, R: Ra };
    const lowAt = (z) => { let y = 0.44 + 0.08 * smooth(h - 0.4, h, z); const d = Math.abs(z - arch.z); if (d < arch.R) y = Math.max(y, sp.r + Math.sqrt(arch.R * arch.R - d * d)); return y; };
    const halfAt = (z) => W2 * (1 - 0.1 * Math.pow(smooth(h - 0.5, h, z), 2.2));
    const zsAll = stations(L, hi ? 0.16 : lo ? 0.5 : 0.26, [arch], [cabBack, h - 0.62, h - 1.5], hi ? 12 : lo ? 4 : 7);
    const zs = zsAll.filter((z) => z >= cabBack - 1e-4);
    boxBody(P, {
      zs, halfAt, lowAt, topY: sp.H,
      levels: [{ y: 0.44, x: 0.97, s: S.grey }, { y: 0.66, x: 1, s: S.paint }, { y: belt, x: 1, s: S.glass }, { y: wtop, x: 0.95, s: S.paint }, { y: sp.H - 0.06, x: 0.84, s: S.paint }],
      shear: (y, z) => -Math.max(0, y - belt + 0.1) * 0.42 * smooth(h - 1.0, h - 0.25, z) - Math.max(0, y - 0.66) * 0.06 * smooth(h - 0.6, h, z),
      axis: (p) => _w.set(0, 1.2, clamp(p.z, cabBack + 0.5, h - 0.6)),
      bandAt: (zm, k, left, base) => (k === 2 && !lo && (zm < cabBack + 0.16 || Math.abs(zm - (h - 0.62)) < 0.05) ? S.paint : base),   // rear quarter · the A pillar
      capAt: (dir, j, base) => (dir < 0 ? (j === 2 ? S.paint : base) : base),
    });
    P.add(box(sp.W - 2 * sp.tw - 0.14, sp.r + Ra - 0.3, Ra * 2 + 0.1), MX(0, (sp.r + Ra + 0.3) / 2, zF), S.dark);
    // ---- chassis and the bed
    const bedY = 0.86, bz0 = -h + 0.03, bz1 = cabBack - 0.07, bl = bz1 - bz0, bw = sp.W + 0.02;
    for (const s of [-1, 1]) P.add(box(0.09, 0.3, L - 1.2), MX(s * 0.38, 0.65, -0.5), S.dark);      // frame rails (they carry the bed)
    for (let k = 0; k < 5; k++) P.add(box(sp.W - 0.1, 0.07, 0.08), MX(0, bedY - 0.1, bz0 + 0.25 + (bl - 0.5) * k / 4), S.dark);   // cross members
    P.add(box(0.42, 0.26, 0.6), MX(-0.6, 0.52, zF - 1.0), S.grey);                                  // tank
    P.add(box(bw, 0.07, bl), MX(0, bedY - 0.035, (bz0 + bz1) / 2), S.grey);                         // bed floor
    const side = 0.38;
    for (const s of [-1, 1]) P.add(box(0.035, side, bl), MX(s * (bw / 2 - 0.018), bedY + side / 2, (bz0 + bz1) / 2), S.paint);
    P.add(box(bw, side, 0.035), MX(0, bedY + side / 2, bz0 + 0.018), S.paint);                      // tail board
    P.add(box(bw, 0.62, 0.04), MX(0, bedY + 0.31, bz1 - 0.02), S.paint);                            // head board
    if (!lo) {
      for (const s of [-1, 1]) { for (const yy of [bedY + 0.9, bedY + 0.66]) P.add(box(0.035, 0.035, 0.05), MX(s * (bw / 2 - 0.2), yy, bz1 - 0.02), S.dark); P.add(box(0.035, 0.62, 0.035), MX(s * (bw / 2 - 0.2), bedY + 0.62, bz1 - 0.02), S.dark); }
      P.add(box(bw - 0.4, 0.035, 0.035), MX(0, bedY + 0.92, bz1 - 0.02), S.dark);                   // the guard frame behind the cab
      for (const s of [-1, 1]) for (let k = 1; k < 3; k++) P.add(box(0.012, side - 0.04, 0.05), MX(s * (bw / 2 + 0.002), bedY + side / 2, bz0 + (bl * k) / 3), S.dark);   // board hinges
      // what a truck of this valley carries: three 옹기 jars roped together and crates of 배추
      const jar = (x, z, s2) => {
        const prof = [[0.001, 0], [0.16, 0], [0.27, 0.16], [0.31, 0.36], [0.27, 0.56], [0.18, 0.66], [0.2, 0.7], [0.001, 0.7]].map(([r, y]) => new THREE.Vector2(r * s2, y * s2));
        P.add(new THREE.LatheGeometry(prof, hi ? 14 : 9), MX(x, bedY, z), S.onggi);
      };
      jar(-0.42, bz1 - 0.5, 1); jar(0.3, bz1 - 0.48, 0.92); jar(-0.05, bz1 - 1.02, 0.8);
      P.add(new THREE.TorusGeometry(0.62, 0.012, 4, hi ? 20 : 12), MX(-0.05, bedY + 0.38, bz1 - 0.66, PI / 2, 0, 0), S.straw);
      for (const [x, z, n] of [[-0.42, bz0 + 0.5, 2], [0.36, bz0 + 0.52, 1], [0.36, bz0 + 1.12, 2]]) for (let k = 0; k < n; k++) {
        P.add(box(0.62, 0.22, 0.46), MX(x, bedY + 0.11 + k * 0.23, z, 0, k * 0.08, 0), S.wood);
        if (k === n - 1) for (const [dx, dz] of [[-0.16, -0.1], [0.14, -0.08], [-0.02, 0.12]]) P.add(blob(1, 8, 6), MX(x + dx, bedY + 0.25 + k * 0.23, z + dz, 0, 0, 0, 0.13, 0.11, 0.13), S.leaf);
      }
    }
    wheelsInto(P, { ...sp }, q, [zF], false, false);
    wheelsInto(P, { ...sp, r: 0.29 }, q, [zR], false, true);
    // ---- face, lamps, mirrors
    const fz = h - 0.03;
    for (const s of [-1, 1]) {
      P.add(box(0.3, 0.16, 0.06), MX(s * W2 * 0.64, 0.82, fz, 0, s * 0.12, 0), S.lens);
      P.add(box(0.1, 0.16, 0.06), MX(s * W2 * 0.9, 0.82, fz - 0.04, 0, s * 0.4, 0), S.amber);
      P.add(box(0.26, 0.11, 0.05), MX(s * (bw / 2 - 0.2), bedY - 0.14, bz0 + 0.02), S.red);
      if (lo) continue;
      P.add(box(0.34, 0.035, 0.035), MX(s * (W2 + 0.14), belt + 0.3, h - 0.7), S.plastic);
      P.add(box(0.05, 0.3, 0.17), MX(s * (W2 + 0.3), belt + 0.3, h - 0.7), S.plastic);
      P.add(box(0.008, 0.25, 0.13), MX(s * (W2 + 0.3), belt + 0.3, h - 0.7 - 0.09), S.chrome);
      P.add(box(0.012, belt - 0.2, 0.012), MX(s * (halfAt(cabBack + 0.24) + 0.003), (belt + 0.6) / 2, cabBack + 0.24), S.dark);   // door line
      P.add(box(0.018, 0.028, 0.14), MX(s * (halfAt(cabBack + 0.4) + 0.008), belt - 0.14, cabBack + 0.42), S.plastic);
      P.add(box(0.3, 0.34, 0.02), MX(s * (W2 - 0.14), 0.42, zR - 0.42), S.plastic);                // mud flaps
    }
    if (!lo) {
      P.add(box(sp.W * 0.6, 0.12, 0.04), MX(0, 0.98, fz - 0.035), S.plastic);
      P.add(box(sp.W + 0.02, 0.2, 0.12), MX(0, 0.54, h - 0.04), S.grey);
      P.add(box(0.5, 0.11, 0.02), MX(0, 0.54, h + 0.025), S.plate);
      P.add(box(0.5, 0.11, 0.02), MX(0, bedY - 0.3, bz0 - 0.005), S.plate);
    }
    return P.build();
  }

  // ---------------------------------------------------------------- the cache (every geometry and material is reference counted)
  // key -> { v, n }: a fleet holds what it uses and lets go in dispose(); what nobody holds any more is disposed, so a
  // place that is thrown away gives its vehicle buffers back (renderer.info.memory returns to what it was).
  const cache = { geo: new Map(), mat: new Map(), misc: new Map() };
  const presetName = () => { const n = G.sys && G.sys.engine && G.sys.engine.preset && G.sys.engine.preset.name; return n === 'low' || n === 'medium' || n === 'high' ? n : 'medium'; };
  const QUAL = (q) => (q === 'low' || q === 'medium' || q === 'high' || q === 'far' ? q : presetName());
  const hold = (map, key, make) => { let e = map.get(key); if (!e) { e = { v: make(), n: 0 }; map.set(key, e); } e.n++; return e.v; };
  const drop = (map, key, free) => { const e = map.get(key); if (!e) return; if (--e.n <= 0) { map.delete(key); try { free(e.v); } catch (err) { /* already gone */ } } };
  function build(kind, q) { return kind === 'truck' ? buildTruck(q) : kind === 'coach' || kind === 'shuttle' ? buildBus(kind, q) : buildCar(kind, q); }
  const makeGeo = (kind, q) => () => { const g = build(kind, q); g.name = `vehicle-${kind}:${q}`; return g; };
  /** the cached geometry of a kind (read only; a fleet holds its own reference) */
  function geometry(kind, q) {
    if (!SPEC[kind]) kind = 'sedan';
    q = QUAL(q);
    const key = kind + ':' + q;
    let e = cache.geo.get(key);
    if (!e) { e = { v: makeGeo(kind, q)(), n: 0 }; cache.geo.set(key, e); }
    return e.v;
  }
  const COLOR_VERT = `
#if defined( USE_COLOR ) || defined( USE_INSTANCING_COLOR )
  vColor = vec3( 1.0 );
#endif
#ifdef USE_COLOR
  vColor *= color;
#endif
#ifdef USE_INSTANCING_COLOR
  vColor.xyz *= mix( vec3( 1.0 ), instanceColor.xyz, aSurf.x );
#endif
  vSurf = aSurf;`;
  function patch(m, key) {
    m.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec4 aSurf;\nvarying vec4 vSurf;').replace('#include <color_vertex>', COLOR_VERT);
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec4 vSurf;')
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n  roughnessFactor = clamp( vSurf.y, 0.04, 1.0 );')
        .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\n  metalnessFactor = clamp( vSurf.z, 0.0, 1.0 );')
        .replace('#include <lights_physical_fragment>', '#include <lights_physical_fragment>\n#ifdef USE_CLEARCOAT\n  material.clearcoat *= vSurf.x;\n#endif')
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n  totalEmissiveRadiance *= vSurf.w > 0.6 ? vColor.rgb * 1.6 : vec3( 1.0, 0.8, 0.52 ) * vSurf.w;');
    };
    m.customProgramCacheKey = () => 'vehicles-' + key;
    return m;
  }
  const matKey = (q, lit) => { q = QUAL(q); if (q === 'far') q = presetName() === 'low' ? 'low' : 'medium'; return q + (lit ? ':lit' : ''); };
  /** the material of a quality; lit = lamps and windows glow at night (it is a night material of the world then) */
  function makeMaterial(key) {
    const lit = key.endsWith(':lit'), q = key.split(':')[0];
    const em = lit ? { emissive: new THREE.Color(0xffffff), emissiveIntensity: 0 } : {};
    let m;
    if (q === 'low') m = new THREE.MeshLambertMaterial({ vertexColors: true, ...em });
    else if (q === 'high') m = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.3, clearcoat: 1, clearcoatRoughness: 0.07, envMapIntensity: 1.05, ...em });
    else m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.3, envMapIntensity: 1.0, ...em });
    m.name = 'vehicle-' + key;
    patch(m, key);
    if (lit && G.world && G.world.addNightMaterial) G.world.addNightMaterial(m, 1.5, 0);
    return m;
  }
  function freeMaterial(m) {
    const list = G.world && G.world.nightMaterials;
    if (Array.isArray(list)) { const i = list.findIndex((e) => e && e.material === m); if (i >= 0) list.splice(i, 1); }
    m.dispose();
  }
  /** the material of a quality as the cache holds it right now, or a fresh one that nobody holds (inspection, tests) */
  function material(q, lit) { const key = matKey(q, lit), e = cache.mat.get(key); return e ? e.v : null; }
  /** a soft shadow under a vehicle: a rounded patch, dark in the middle, clear at its edge (instanced, no texture) */
  function makeShadowGeometry() {
    const seg = 20, pos = [0, 0, 0], col = [0, 0, 0, 0.62], idx = [];
    const rings = [[0.62, 0.55], [0.86, 0.3], [1.08, 0]];
    for (const [rr, a] of rings) for (let s = 0; s < seg; s++) {
      const t = (s / seg) * TAU, c = Math.cos(t), sn = Math.sin(t), e = 2 / 4.5;
      pos.push(Math.sign(c) * Math.pow(Math.abs(c), e) * rr, 0, Math.sign(sn) * Math.pow(Math.abs(sn), e) * rr); col.push(0, 0, 0, a);
    }
    for (let s = 0; s < seg; s++) idx.push(0, 1 + ((s + 1) % seg), 1 + s);
    for (let k = 0; k < rings.length - 1; k++) for (let s = 0; s < seg; s++) { const a = 1 + k * seg + s, b = 1 + k * seg + ((s + 1) % seg); idx.push(a, b, b + seg, a, b + seg, a + seg); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
    g.setIndex(idx);
    g.name = 'vehicle-shadow';
    return g;
  }
  function makeShadowMaterial() {
    const m = new THREE.MeshBasicMaterial({ color: 0x000000, vertexColors: true, transparent: true, depthWrite: false, fog: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
    m.name = 'vehicle-shadow';
    return m;
  }

  // ---------------------------------------------------------------- paints
  function paintOf(p, i) {
    if (Array.isArray(p) && p.length >= 3) return p;
    if (typeof p === 'string') { if (p[0] === '#') return lin(p); const f = PAINTS.find((e) => e.id === p); if (f) return f.rgb; }
    if (fin(p)) return PAINTS[((p % PAINTS.length) + PAINTS.length) % PAINTS.length].rgb;
    return paints(i * 7 + 3).rgb;
  }
  /** a paint picked by weight from a seed (the same seed gives the same paint on every machine) */
  function paints(seed) {
    let h = (Math.imul((seed | 0) + 1, 374761393) ^ 0x5bd1e995) >>> 0; h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
    let u = ((h ^ (h >>> 16)) >>> 0) / 4294967296, acc = 0;
    for (const p of PAINTS) { acc += p.weight; if (u < acc) return p; }
    return PAINTS[0];
  }
  function spec(kind) {
    const s = SPEC[kind]; if (!s) return null;
    return { kind, L: s.L, W: s.W, H: s.H, wheelbase: s.wb, r: s.r, hw: s.W / 2 + 0.04, hd: s.L / 2 + 0.04, top: kind === 'truck' ? 2.0 : s.H, paint: s.paint };
  }

  // ---------------------------------------------------------------- fleets
  const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s1 = new THREE.Vector3(1, 1, 1), _p = new THREE.Vector3(), _c = new THREE.Color(), _up = new THREE.Vector3(0, 1, 0);
  let live = 0;
  function fleet(list, opts = {}) {
    const q = QUAL(opts.quality), low = q === 'low';
    const items = (Array.isArray(list) ? list : []).filter((v) => v && fin(Number(v.x)) && fin(Number(v.z))).map((v, i) => ({
      kind: SPEC[v.kind] ? v.kind : 'sedan', x: Number(v.x), y: fin(Number(v.y)) ? Number(v.y) : 0, z: Number(v.z), rot: fin(Number(v.rot)) ? Number(v.rot) : 0,
      rgb: paintOf(v.paint != null ? v.paint : (SPEC[v.kind] && (v.kind === 'coach' || v.kind === 'shuttle' || v.kind === 'truck') ? SPEC[v.kind].paint : null), i), i,
    }));
    const group = new THREE.Group(); group.name = opts.name || 'vehicles';
    const held = [];   // [map, key, free] of everything this fleet holds in the cache
    const take = (map, key, make, free) => { held.push([map, key, free]); return hold(map, key, make); };
    const freeGeo = (g) => g.dispose();
    const mk = matKey(q, !!opts.lit), mat = take(cache.mat, mk, () => makeMaterial(mk), freeMaterial), wantFar = opts.far !== false && !low;
    const fk = matKey('far', !!opts.lit), farMat = wantFar ? take(cache.mat, fk, () => makeMaterial(fk), freeMaterial) : null;
    live++;
    const meshes = [], fars = [], kinds = {}, slot = [];
    let tris = 0;
    const centre = new THREE.Vector3(); let radius = 0;
    for (const it of items) centre.add(_p.set(it.x, it.y, it.z));
    if (items.length) centre.multiplyScalar(1 / items.length);
    for (const it of items) radius = Math.max(radius, _p.set(it.x, it.y, it.z).distanceTo(centre) + SPEC[it.kind].L / 2);
    for (const kind of KINDS) {
      const sub = items.filter((it) => it.kind === kind);
      if (!sub.length) continue;
      kinds[kind] = sub.length;
      const make = (g, m, tag) => {
        const mesh = new THREE.InstancedMesh(g, m, sub.length);
        mesh.name = `${group.name}-${kind}${tag}`;
        sub.forEach((it, k) => {
          _m4.compose(_p.set(it.x, it.y, it.z), _q.setFromAxisAngle(_up, it.rot), _s1);
          mesh.setMatrixAt(k, _m4); mesh.setColorAt(k, _c.setRGB(it.rgb[0], it.rgb[1], it.rgb[2]));
        });
        mesh.instanceMatrix.needsUpdate = true; if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        mesh.castShadow = !low; mesh.receiveShadow = !low;
        mesh.computeBoundingSphere(); mesh.computeBoundingBox();
        group.add(mesh);
        return mesh;
      };
      const g = take(cache.geo, kind + ':' + q, makeGeo(kind, q), freeGeo), near = make(g, mat, '');
      near.userData.tris = g.attributes.position.count / 3;
      meshes.push(near); tris += (g.attributes.position.count / 3) * sub.length;
      sub.forEach((it, k) => { slot[it.i] = { mesh: near, k, far: null }; });
      if (wantFar) {
        const fg = take(cache.geo, kind + ':far', makeGeo(kind, 'far'), freeGeo), fm = make(fg, farMat, '-far');
        fm.userData.tris = fg.attributes.position.count / 3; fm.visible = false; fm.castShadow = false;
        fars.push(fm); sub.forEach((it) => { slot[it.i].far = fm; });
      }
    }
    let shadow = null;
    if (opts.shadow !== false && items.length) {
      shadow = new THREE.InstancedMesh(take(cache.misc, 'shadow-geo', makeShadowGeometry, freeGeo), take(cache.misc, 'shadow-mat', makeShadowMaterial, (m) => m.dispose()), items.length);
      shadow.name = group.name + '-shadow'; shadow.renderOrder = 1; shadow.castShadow = false; shadow.receiveShadow = false; shadow.raycast = () => {};
      items.forEach((it, k) => {
        const sp = SPEC[it.kind];
        _m4.compose(_p.set(it.x, it.y + 0.025, it.z), _q.setFromAxisAngle(_up, it.rot), _w.set(sp.W / 2 + 0.2, 1, sp.L / 2 + 0.12));
        shadow.setMatrixAt(k, _m4);
      });
      shadow.instanceMatrix.needsUpdate = true;
      shadow.computeBoundingSphere(); shadow.computeBoundingBox();
      group.add(shadow);
    }
    const farD = Math.max(20, Number(opts.farDistance) || 70);
    let isFar = false, dead = false;
    return {
      group, count: items.length, kinds, meshes, tris, calls: meshes.length + (shadow ? 1 : 0), centre, radius,
      /** swap the full models for the far form when the camera is far from the whole fleet (call it now and then) */
      update(cam) {
        if (dead || !fars.length || !cam) return isFar;
        group.updateWorldMatrix(true, false);
        const d = _p.copy(centre).applyMatrix4(group.matrixWorld).distanceTo(cam) - radius;
        const want = isFar ? d > farD * 0.9 : d > farD;
        if (want !== isFar) { isFar = want; for (const m of meshes) m.visible = !want; for (const m of fars) m.visible = want; }
        return isFar;
      },
      get far() { return isFar; },
      setPaint(i, paint) {
        const s = slot[i]; if (!s || dead) return false;
        const rgb = paintOf(paint, i); _c.setRGB(rgb[0], rgb[1], rgb[2]);
        s.mesh.setColorAt(s.k, _c); s.mesh.instanceColor.needsUpdate = true;
        if (s.far) { s.far.setColorAt(s.k, _c); s.far.instanceColor.needsUpdate = true; }
        return true;
      },
      dispose() {
        if (dead) return; dead = true; live--;
        if (group.parent) group.parent.remove(group);
        for (const m of [...meshes, ...fars]) m.dispose();
        if (shadow) shadow.dispose();
        for (const [map, key, free] of held.splice(0)) drop(map, key, free);
      },
    };
  }

  // ---------------------------------------------------------------- one vehicle (the shuttle at its stop)
  function labelTexture(text, sub) {
    const draw = (g, w, hh) => {
      g.clearRect(0, 0, w, hh);
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.font = `800 ${Math.round(hh * 0.5)}px "PretendardEmbed","Pretendard","Noto Sans KR","Apple SD Gothic Neo","Malgun Gothic",sans-serif`;
      g.lineWidth = hh * 0.09; g.lineJoin = 'round'; g.strokeStyle = 'rgba(255,255,255,0.96)'; g.strokeText(text, w / 2, hh * 0.4);
      g.fillStyle = '#1f5132'; g.fillText(text, w / 2, hh * 0.4);
      if (sub) { g.font = `600 ${Math.round(hh * 0.2)}px "PretendardEmbed","Pretendard","Noto Sans KR",sans-serif`; g.fillStyle = '#2f6b45'; g.fillText(sub, w / 2, hh * 0.83); }
    };
    if (G.gfx && G.gfx.canvasTexture) return G.gfx.canvasTexture(512, 128, draw, { srgb: true });
    if (typeof document === 'undefined') return null;
    const cv = document.createElement('canvas'); cv.width = 512; cv.height = 128;
    const g = cv.getContext('2d'); if (!g) return null;
    draw(g, 512, 128);
    const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
  }
  function one(kind, opts = {}) {
    if (!SPEC[kind]) kind = 'sedan';
    const sp = SPEC[kind], q = QUAL(opts.quality), low = q === 'low';
    const f = fleet([{ kind, x: 0, y: 0, z: 0, rot: 0, paint: opts.paint != null ? opts.paint : sp.paint }], { quality: q, shadow: opts.shadow !== false, lit: opts.lit !== false, far: false, name: 'vehicle-' + kind });
    const grp = f.group, owned = [];
    const text = opts.label != null ? String(opts.label) : kind === 'shuttle' ? '만장대 셔틀' : '';
    if (text && !low && (kind === 'shuttle' || kind === 'coach')) {
      const tex = labelTexture(text, opts.sub != null ? String(opts.sub) : kind === 'shuttle' ? '마을 ↔ 만장대 단지' : '');
      if (tex) {
        const lm = new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.5, metalness: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
        // the lettering sits on the painted band under the windows (512 × 128 texture: four times as wide as high)
        const lh = kind === 'coach' ? 0.58 : 0.46, lg = new THREE.PlaneGeometry(lh * 4, lh);
        for (const s of [-1, 1]) {
          const p = new THREE.Mesh(lg, lm); p.name = 'vehicle-label';
          p.position.set(s * (sp.W / 2 + 0.012), kind === 'coach' ? 1.46 : 1.16, -sp.L * 0.06); p.rotation.y = (s * PI) / 2;
          grp.add(p);
        }
        owned.push(tex, lm, lg);
      }
    }
    grp.userData.kind = kind; grp.userData.spec = spec(kind); grp.userData.fleet = f;
    grp.userData.dispose = () => { for (const o of owned) if (o.dispose && !(o.isTexture && o.userData && o.userData.blank)) o.dispose(); owned.length = 0; f.dispose(); };
    return grp;
  }
  function stats() {
    const cached = {};
    for (const [k, e] of cache.geo) cached[k] = { tris: e.v.attributes.position.count / 3, users: e.n };
    return { live, cached, materials: [...cache.mat.entries()].map(([k, e]) => `${k} ×${e.n}`) };
  }

  G.vehicles = { KINDS, PAINTS, paints, spec, geometry, material, fleet, one, stats, _build: build, _SPEC: SPEC };
})();
