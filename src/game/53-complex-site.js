const CX = (G.complexParts = G.complexParts || { list: [], add(name, fn, order) { this.list.push({ name, fn, order: order == null ? 100 : order }); } });
// =============================================================================
// 53-complex-site.js — 만장대 단지 (PL_ALLOT): the place, its GROUND and the part registry (CONTRACT §16.8, track complex-ground)
//
// The district after the owner's concept image (assets/reference/03-concept-main.webp; 04 for the river side) is built from
// the master plan G.data.complex (33-complex-plan.js — every number comes from there). This file:
//   · defines the place PL_ALLOT (outdoor, origin (0, 2600) so that place-LOCAL metres ARE plan metres; floorY = C.height,
//     isWater = C.inWater, surfaceAt from the plan, keepAlive, bounds = C.bounds — the plan is not centred on its origin),
//   · builds the terrain inside C.bounds (the valley's photographed splat material, plan masks; a 3 m skirt on the rectangle
//     C.bounds = the seam with complex-landscape, whose ground starts 2 m inside it and 0.3 m lower),
//   · runs every registered part of the complex (sorted by order, each in try / catch),
//   · registers its own part 'ground' (order 0): roads, markings, parking, paving, rings, terraces, walls, the bridge, stairs,
//     the viewpoint deck, lamps, signs, colliders,
//   · draws the minimap plan (C.draw, rendered once to an offscreen canvas),
//   · puts the shuttle-bus stop into the valley (scene root 'complex-shuttle'): the place's door.
//
// THE PART REGISTRY (fixed interface; every complex fragment starts with exactly the first line of this file):
//   CX.add('<part name>', (ctx, C) => { … build into ctx.group in LOCAL metres (y = C.height(x, z)) …
//                                         return { dispose() {}, update(dt, t) {} }; }, <order>);
//   orders: ground 0 · landscape 10 · main 20 · buildings 30 · units 40 (others 100). A part that throws is skipped with
//   G.log.warn (never console.error); its update() is dropped after its first throw.
//   ctx = the places ctx unchanged: group, quality, low, preset, addCollider, addWalkable, interact, light, onUpdate, own,
//   exitDoor, anchor, board, id, def, size, origin, floorY (0 here: local y = world y).
//
// G.sys.complexSite (this system, order 29):
//   C                     = G.data.complex
//   parts() / failed()    names of the parts that built / threw at the last build
//   stats()               { parts, failed, ground: { calls, tris }, buildMs }
//   busStop               the valley stop (world): { x, z, rot, door: {x, z}, exit: {x, z, rotY} }
//   enter(opts)           = G.sys.places.enter('PL_ALLOT', opts); opts.focusUnit = 'J01-17' | { zone, seq } ends beside that
//                           unit (after the fade, G.sys.allotDistrict?.goto?.(code))
// =============================================================================
(function () {
  'use strict';
  const C = G.data && G.data.complex;
  const P = G.sys.places;
  if (!C || !P) { G.log.warn('WORLD', 'complex-site: master plan or places missing — no 만장대 단지'); return; }
  const PI = Math.PI, TAU = PI * 2;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
  const fin = Number.isFinite;
  const ID = 'PL_ALLOT', ORIGIN = Object.freeze({ x: 0, z: 2600 });
  const B = C.bounds, K = C.K;
  const H = (x, z) => C.height(x, z);
  const el = (type) => C.elements.filter((e) => e.type === type);
  const easyOn = () => (G.easy ? !!G.easy.on : G.settings?.easyMode !== false);

  // ---------------------------------------------------------------- deterministic noise (colour variation only)
  function hash2(ix, iz) {
    let h = (Math.imul(ix | 0, 374761393) + Math.imul(iz | 0, 668265263)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }
  function vnoise(x, z) {
    const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz, ux = fx * fx * (3 - 2 * fx), uz = fz * fz * (3 - 2 * fz);
    return lerp(lerp(hash2(ix, iz), hash2(ix + 1, iz), ux), lerp(hash2(ix, iz + 1), hash2(ix + 1, iz + 1), ux), uz);
  }
  const fbm = (x, z) => vnoise(x, z) * 0.55 + vnoise(x * 2.07 + 13.1, z * 2.07 - 7.3) * 0.3 + vnoise(x * 4.3 - 3.7, z * 4.3 + 9.9) * 0.15;

  // ---------------------------------------------------------------- geometry helpers (plan space)
  function segD(px, pz, ax, az, bx, bz) {
    const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
    const t = l2 > 0 ? clamp(((px - ax) * dx + (pz - az) * dz) / l2, 0, 1) : 0;
    return Math.hypot(ax + dx * t - px, az + dz * t - pz);
  }
  function polyD(px, pz, pts) { let d = Infinity; for (let i = 0; i < pts.length - 1; i++) d = Math.min(d, segD(px, pz, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1])); return d; }
  function inPoly(x, z, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i][0], zi = poly[i][1], xj = poly[j][0], zj = poly[j][1];
      if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
    }
    return inside;
  }
  const normA = (a) => { a %= TAU; return a < 0 ? a + TAU : a; };

  // ================================================================ masks: what the ground is, on a grid over C.bounds
  // channels (0..1): 0 rock · 1 worn earth · 2 soil · 3 gravel (= the terrain shader's aSplat x y z w) · 4 paved (under a
  // paving mesh) · 5 jar ground (pale gravel inside the walls) · 6 lawn (kept green) · 7 road (asphalt above it)
  const CH = { rock: 0, earth: 1, soil: 2, gravel: 3, paved: 4, jar: 5, lawn: 6, road: 7 };
  class Field {
    constructor(step) {
      this.step = step;
      this.nx = Math.round((B.maxX - B.minX) / step) + 1; this.nz = Math.round((B.maxZ - B.minZ) / step) + 1;
      this.ch = Array.from({ length: 8 }, () => new Float32Array(this.nx * this.nz));
    }
    x(i) { return i === this.nx - 1 ? B.maxX : B.minX + i * this.step; }
    z(j) { return j === this.nz - 1 ? B.maxZ : B.minZ + j * this.step; }
    /** visit the grid points in a box: fn(k, x, z) */
    box(x0, z0, x1, z1, fn) {
      const s = this.step;
      const i0 = clamp(Math.floor((x0 - B.minX) / s), 0, this.nx - 1), i1 = clamp(Math.ceil((x1 - B.minX) / s), 0, this.nx - 1);
      const j0 = clamp(Math.floor((z0 - B.minZ) / s), 0, this.nz - 1), j1 = clamp(Math.ceil((z1 - B.minZ) / s), 0, this.nz - 1);
      for (let j = j0; j <= j1; j++) { const z = this.z(j); for (let i = i0; i <= i1; i++) fn(j * this.nx + i, this.x(i), z); }
    }
    put(c, k, w) { const a = this.ch[c]; if (w > a[k]) a[k] = w; }
    /** a band round a polyline: full inside hw, fading over feather */
    line(c, pts, hw, feather = 0.6, w = 1) {
      let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
      for (const p of pts) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); z0 = Math.min(z0, p[1]); z1 = Math.max(z1, p[1]); }
      const r = hw + feather;
      this.box(x0 - r, z0 - r, x1 + r, z1 + r, (k, x, z) => { const d = polyD(x, z, pts); if (d < r) this.put(c, k, w * (1 - smooth(hw, r, d))); });
    }
    circle(c, cx, cz, r, feather = 0.6, w = 1) { this.ring(c, cx, cz, -1, r, 0, TAU, feather, w); }
    /** an annulus (r0 < r < r1) between angles a0 … a1 (radians, plan convention: a = atan2(z − cz, x − cx)) */
    ring(c, cx, cz, r0, r1, a0, a1, feather = 0.6, w = 1) {
      const R = r1 + feather, full = a1 - a0 >= TAU - 1e-6;
      this.box(cx - R, cz - R, cx + R, cz + R, (k, x, z) => {
        const r = Math.hypot(x - cx, z - cz);
        if (r > R || r < r0 - feather) return;
        if (!full) { const a = normA(Math.atan2(z - cz, x - cx)); const lo = normA(a0), hi = lo + (a1 - a0); if (!((a >= lo && a <= hi) || (a + TAU >= lo && a + TAU <= hi))) return; }
        let f = 1;
        if (r > r1) f = 1 - smooth(r1, R, r);
        if (r0 > 0 && r < r0) f = Math.min(f, 1 - smooth(r0, r0 - feather, r));
        this.put(c, k, w * f);
      });
    }
    rect(c, x0, z0, x1, z1, feather = 0.6, w = 1) {
      this.box(x0 - feather, z0 - feather, x1 + feather, z1 + feather, (k, x, z) => {
        const dx = Math.max(x0 - x, x - x1, 0), dz = Math.max(z0 - z, z - z1, 0), d = Math.hypot(dx, dz);
        this.put(c, k, w * (1 - smooth(0, feather, d)));
      });
    }
    poly(c, poly, feather = 0.6, w = 1) {
      let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
      for (const p of poly) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); z0 = Math.min(z0, p[1]); z1 = Math.max(z1, p[1]); }
      const ring = poly.concat([poly[0]]);
      this.box(x0 - feather, z0 - feather, x1 + feather, z1 + feather, (k, x, z) => {
        const inside = inPoly(x, z, poly), d = polyD(x, z, ring);
        this.put(c, k, w * (inside ? 1 : 1 - smooth(0, feather, d)));
      });
    }
  }
  /** stamp what the plan says the ground is */
  function planMasks(step) {
    const F = new Field(step);
    for (const e of C.elements) {
      switch (e.type) {
        case 'road': F.line(CH.road, e.pts, e.w / 2 + 0.6, 0.8); break;
        case 'roundabout': F.ring(CH.road, e.cx, e.cz, e.r0 - 0.4, e.r1 + 0.6, 0, TAU, 0.8); F.circle(CH.lawn, e.cx, e.cz, e.r0 - 0.6, 0.5); break;
        case 'parking': case 'busbay': F.rect(CH.road, e.x0, e.z0, e.x1, e.z1, 0.8); break;
        case 'plaza': F.rect(CH.paved, e.x0, e.z0, e.x1, e.z1, 0.8); break;
        case 'jarcircle': F.circle(CH.jar, e.cx, e.cz, e.wallR + 0.3, 0.8); F.circle(CH.paved, e.cx, e.cz, e.plazaR, 0.4); break;
        case 'amphitheatre': F.ring(CH.jar, e.cx, e.cz, -1, e.wallR + 0.3, e.a0, e.a1, 0.8); F.ring(CH.paved, e.cx, e.cz, -1, e.plazaR, e.a0, e.a1, 0.4); break;
        case 'field': if (e.overflow) F.poly(CH.gravel, e.poly, 1.0); else F.poly(CH.soil, e.poly, 0.8); break;
        case 'storeyard': F.rect(CH.gravel, e.x0, e.z0, e.x1, e.z1, 1.2); break;
        case 'terrace': F.rect(CH.earth, e.x0, e.z0, e.x1, e.z1, 1.0, 0.35); break;
        case 'building': {
          const parts = e.parts || [{ x0: e.x - e.w / 2, z0: e.z - e.d / 2, x1: e.x + e.w / 2, z1: e.z + e.d / 2 }];
          if (!e.rot) for (const p of parts) F.rect(CH.earth, p.x0 - 0.8, p.z0 - 0.8, p.x1 + 0.8, p.z1 + 0.8, 1.2);
          else F.circle(CH.earth, e.x, e.z, Math.hypot(e.w, e.d) / 2, 1);
          if (e.terrace) F.rect(CH.paved, e.terrace.x0, e.terrace.z0, e.terrace.x1, e.terrace.z1, 0.5);
          break;
        }
        case 'kiln': F.rect(CH.earth, e.x - e.w / 2 - 2, e.z1 - 1, e.x + e.w / 2 + 2, e.z0 + 2, 1.4); break;
        default: break;
      }
    }
    for (const p of C.paths) {
      if (p.kind === 'road' || p.kind === 'deck') continue;
      const ch = p.kind === 'walk' ? CH.earth : p.kind === 'lane' || p.kind === 'ringwalk' || p.kind === 'aisle' ? CH.gravel : CH.paved;
      if (p.arc) F.ring(ch, p.arc.cx, p.arc.cz, p.arc.r - p.w / 2, p.arc.r + p.w / 2, p.arc.a0, p.arc.a1, 0.5, p.kind === 'ringwalk' ? 0.8 : 1);
      else if (p.pts && p.pts.length >= 2) F.line(ch, p.pts, p.w / 2, 0.6, p.kind === 'walk' ? 0.7 : 1);
      else if (p.pts && p.pts.length === 1) F.circle(ch, p.pts[0][0], p.pts[0][1], p.w / 2, 0.5);
    }
    return F;
  }

  // ================================================================ surface for footsteps (a 2 m table, built once)
  let SURF = null;
  const SURF_NAMES = ['grass', 'road', 'stone', 'dirt', 'wood', 'sand'];
  function surfaceTable() {
    if (SURF) return SURF;
    const F = planMasks(2);
    const n = F.nx * F.nz, t = new Uint8Array(n);
    for (let k = 0; k < n; k++) {
      const c = F.ch;
      t[k] = c[CH.road][k] > 0.5 ? 1 : c[CH.paved][k] > 0.5 ? 2 : (c[CH.jar][k] > 0.5 || c[CH.gravel][k] > 0.5 || c[CH.earth][k] > 0.5 || c[CH.soil][k] > 0.5) ? 3 : 0;
    }
    SURF = { F, t };
    return SURF;
  }
  const deckEl = C.byId('DECK'), bridgeEl = C.byId('BRIDGE');
  function surfaceAt(x, z) {
    if (deckEl && x >= deckEl.x0 && x <= deckEl.x1 && z >= deckEl.z0 && z <= deckEl.z1) return 'wood';
    if (bridgeEl && Math.abs(z - bridgeEl.z0) <= bridgeEl.w / 2 && x >= Math.min(bridgeEl.x0, bridgeEl.x1) && x <= Math.max(bridgeEl.x0, bridgeEl.x1)) return 'stone';
    const S = surfaceTable(), F = S.F;
    const i = clamp(Math.round((x - B.minX) / F.step), 0, F.nx - 1), j = clamp(Math.round((z - B.minZ) / F.step), 0, F.nz - 1);
    return SURF_NAMES[S.t[j * F.nx + i]] || 'grass';
  }

  // ================================================================ quality knobs
  function knobs(q) {
    return {
      high: { step: 1, lampLights: 6, aniso: 8 },
      medium: { step: 2, lampLights: 4, aniso: 4 },
      low: { step: 4, lampLights: 0, aniso: 1 },
    }[q] || { step: 2, lampLights: 4, aniso: 4 };
  }

  // ================================================================ the terrain (inside C.bounds, with a skirt)
  const GC = {};      // ground colours (linear), filled on first use (THREE.Color needs the colour management of the page)
  function groundColors() {
    if (GC.lawn) return GC;
    const c = (hex) => new THREE.Color(hex);
    Object.assign(GC, {
      lawn: c('#7d9c45'), lawnB: c('#6b8c3c'), lawnDry: c('#9aa45a'), lawnDeep: c('#5a7c34'),
      forest: c('#33432a'), forestB: c('#2a3922'), rock: c('#7c776d'), rockB: c('#5f5b53'),
      earth: c('#9c8566'), soil: c('#6a4e38'), soilB: c('#7d5c40'), gravel: c('#a39d8f'), jar: c('#bcb4a3'), jarB: c('#cfc7b5'),
      paved: c('#b1a690'), road: c('#5e5f60'), bank: c('#8c877a'), bed: c('#5f5b4c'),
    });
    return GC;
  }
  const _c = new THREE.Color(), _c2 = new THREE.Color();
  function buildTerrain(ctx, S) {
    const step = S.step, F = planMasks(step), nx = F.nx, nz = F.nz, N = nx * nz, col = groundColors();
    const hg = new Float32Array(N);
    for (let j = 0; j < nz; j++) { const z = F.z(j); for (let i = 0; i < nx; i++) hg[j * nx + i] = H(F.x(i), z); }
    // perimeter skirt: one more ring of vertices 3 m lower (the seam with complex-landscape is the rectangle C.bounds)
    const per = [];
    for (let i = 0; i < nx; i++) per.push(i);                              // north edge (z = minZ), west → east
    for (let j = 1; j < nz; j++) per.push(j * nx + nx - 1);                // east edge, north → south
    for (let i = nx - 2; i >= 0; i--) per.push((nz - 1) * nx + i);         // south edge, east → west
    for (let j = nz - 2; j >= 1; j--) per.push(j * nx);                    // west edge, south → north
    const NV = N + per.length;
    const pos = new Float32Array(NV * 3), nor = new Float32Array(NV * 3), clr = new Float32Array(NV * 3), uv = new Float32Array(NV * 2);
    const spl = new Uint8Array(NV * 4);
    const pbr = !ctx.low;
    for (let j = 0; j < nz; j++) {
      const z = F.z(j);
      for (let i = 0; i < nx; i++) {
        const k = j * nx + i, x = F.x(i), y = hg[k];
        pos[k * 3] = x; pos[k * 3 + 1] = y; pos[k * 3 + 2] = z;
        const hx0 = i > 0 ? hg[k - 1] : H(x - step, z), hx1 = i < nx - 1 ? hg[k + 1] : H(x + step, z);
        const hz0 = j > 0 ? hg[k - nx] : H(x, z - step), hz1 = j < nz - 1 ? hg[k + nx] : H(x, z + step);
        let ex = (hx0 - hx1) / (2 * step), ez = (hz0 - hz1) / (2 * step);
        const il = 1 / Math.sqrt(ex * ex + 1 + ez * ez);
        nor[k * 3] = ex * il; nor[k * 3 + 1] = il; nor[k * 3 + 2] = ez * il;
        uv[k * 2] = x / 4.5; uv[k * 2 + 1] = z / 4.5;
        groundAt(F, k, x, z, y, il, col, _c, spl, k * 4);
        clr[k * 3] = _c.r; clr[k * 3 + 1] = _c.g; clr[k * 3 + 2] = _c.b;
      }
    }
    per.forEach((src, q) => {
      const k = N + q;
      pos[k * 3] = pos[src * 3]; pos[k * 3 + 1] = pos[src * 3 + 1] - 3; pos[k * 3 + 2] = pos[src * 3 + 2];
      nor[k * 3] = nor[src * 3]; nor[k * 3 + 1] = nor[src * 3 + 1]; nor[k * 3 + 2] = nor[src * 3 + 2];
      clr[k * 3] = clr[src * 3] * 0.7; clr[k * 3 + 1] = clr[src * 3 + 1] * 0.7; clr[k * 3 + 2] = clr[src * 3 + 2] * 0.7;
      uv[k * 2] = uv[src * 2]; uv[k * 2 + 1] = uv[src * 2 + 1] + 0.6;
      for (let c = 0; c < 4; c++) spl[k * 4 + c] = spl[src * 4 + c];
    });
    const idx = new Uint32Array((nx - 1) * (nz - 1) * 6 + per.length * 6);
    let q = 0;
    for (let j = 0; j < nz - 1; j++) for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
      idx[q++] = a; idx[q++] = c; idx[q++] = d; idx[q++] = a; idx[q++] = d; idx[q++] = b;
    }
    for (let p = 0; p < per.length; p++) {     // the skirt faces outwards (the perimeter runs clockwise seen from above)
      const a = per[p], b = per[(p + 1) % per.length], a2 = N + p, b2 = N + ((p + 1) % per.length);
      idx[q++] = a; idx[q++] = b; idx[q++] = b2; idx[q++] = a; idx[q++] = b2; idx[q++] = a2;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(clr, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    if (pbr) geo.setAttribute('aSplat', new THREE.BufferAttribute(spl, 4, true));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.computeBoundingSphere(); geo.computeBoundingBox();
    const mat = terrainMaterial(ctx);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'cx-terrain';
    mesh.receiveShadow = true; mesh.castShadow = false;
    mesh.matrixAutoUpdate = false; mesh.updateMatrix();
    ctx.group.add(mesh);
    G.world.groundMeshes?.push?.(mesh);
    return { mesh, F, hg, nx, nz, step, tris: idx.length / 3, dispose() { const gm = G.world.groundMeshes; const i = gm ? gm.indexOf(mesh) : -1; if (i >= 0) gm.splice(i, 1); } };
  }
  /** the valley's own terrain material when it fits this preset (same program, nothing new to compile), else a plain one */
  function terrainMaterial(ctx) {
    const T = G.sys.terrain, m = T && T.material;
    const wantPbr = !ctx.low;
    if (m && m.isMaterial) {
      const isPbr = !!(m.userData && m.userData.tf);
      if (isPbr === wantPbr) return m;
      if (!wantPbr && m.isMeshLambertMaterial) return m;
    }
    return ctx.own(new THREE.MeshLambertMaterial({ vertexColors: true }));
  }
  /** colour + splat of one terrain vertex from the plan masks */
  function groundAt(F, k, x, z, y, ny, col, out, spl, si) {
    const ch = F.ch;
    const n1 = fbm(x / 38, z / 38), n2 = vnoise(x / 9 + 11, z / 9 - 3), n3 = vnoise(x / 2.6, z / 2.6);
    // lawn: bright, slightly yellow, mottled (image 3: mown lawns between everything)
    out.copy(col.lawn).lerp(col.lawnB, smooth(0.3, 0.7, n1)).lerp(col.lawnDry, smooth(0.55, 0.85, n2) * 0.45).lerp(col.lawnDeep, smooth(0.6, 0.9, 1 - n1) * 0.3);
    let rock = 0, earth = 0, soil = 0, grav = 0;
    // steep ground (the slopes inside the rectangle, the river banks): forest floor and rock
    const slope = 1 - ny, lawnKeep = ch[CH.lawn][k];
    const forest = smooth(0.12, 0.3, slope + (n2 - 0.5) * 0.1) * (1 - lawnKeep);
    if (forest > 0) { _c2.copy(col.forest).lerp(col.forestB, n2); out.lerp(_c2, forest); soil = Math.max(soil, forest * 0.75); }
    const rk = smooth(0.42, 0.62, slope + (n2 - 0.5) * 0.15);
    if (rk > 0) { _c2.copy(col.rock).lerp(col.rockB, n3); out.lerp(_c2, rk); rock = Math.max(rock, rk); }
    // the river: pebbles on the banks, a dark bed under the water
    const wy = C.waterY(x, z);
    if (wy > -1e6) {
      const wet = smooth(wy + 1.2, wy - 0.2, y);
      _c2.copy(col.bank).lerp(col.bed, smooth(wy, wy - 1.2, y)); out.lerp(_c2, Math.max(wet, 0.6 * smooth(wy + 2.5, wy + 0.8, y)));
      grav = Math.max(grav, wet); rock = rock * (1 - wet);
    }
    const w = (c) => ch[c][k];
    const e = w(CH.earth); if (e > 0) { _c2.copy(col.earth).lerp(col.gravel, n3 * 0.4); out.lerp(_c2, e); earth = Math.max(earth, e); }
    const s = w(CH.soil); if (s > 0) { _c2.copy(col.soil).lerp(col.soilB, n3); out.lerp(_c2, s); soil = Math.max(soil, s); }
    const g = w(CH.gravel); if (g > 0) { _c2.copy(col.gravel).lerp(col.jarB, n3 * 0.4); out.lerp(_c2, g); grav = Math.max(grav, g); }
    const j = w(CH.jar); if (j > 0) { _c2.copy(col.jar).lerp(col.jarB, n3); out.lerp(_c2, j); grav = Math.max(grav, j); }
    const p = w(CH.paved); if (p > 0) { out.lerp(col.paved, p); grav = Math.max(grav, p * 0.6); }
    const r = w(CH.road); if (r > 0) { out.lerp(col.road, r * 0.85); grav = Math.max(grav, r); }
    if (lawnKeep > 0) { _c2.copy(col.lawn).lerp(col.lawnB, n2); out.lerp(_c2, lawnKeep); }
    const keep = 1 - lawnKeep;
    spl[si] = Math.round(clamp(rock * keep, 0, 1) * 255); spl[si + 1] = Math.round(clamp(earth * keep, 0, 1) * 255);
    spl[si + 2] = Math.round(clamp(soil * keep, 0, 1) * 255); spl[si + 3] = Math.round(clamp(grav * keep, 0, 1) * 255);
    return out;
  }

  // ================================================================ the minimap plan (an offscreen picture of C.draw)
  const MM = { canvas: null, ver: -1, area: { minX: B.minX - 12, maxX: B.maxX + 12, minZ: B.minZ - 12, maxZ: B.maxZ + 12 }, ppm: 2.5 };
  function minimapCanvas() {
    const ver = (G.sys.allot && G.sys.allot.mapState && (G.sys.allot.mapState() || {}).v) || 0;
    if (MM.canvas && MM.ver === ver) return MM.canvas;
    const a = MM.area, w = Math.round((a.maxX - a.minX) * MM.ppm), h = Math.round((a.maxZ - a.minZ) * MM.ppm);
    const cv = MM.canvas || document.createElement('canvas');
    cv.width = w; cv.height = h;
    const c2 = cv.getContext('2d');
    if (!c2) return null;
    let st = null;
    try { st = G.sys.allot?.mapState?.() || null; } catch (e) { st = null; }
    const L = st && st.layout ? st.layout : C.current();
    const COLS = { 0: '#c8b089', 1: '#9b7b56', 2: '#7a5a3c', 3: '#8f8f8f', 4: '#e8590c' };
    const unitStyle = st && st.status ? (zone, seq, kind, i) => COLS[st.status[i]] || C.colors[kind] : null;
    try { C.draw(c2, { x: (a.minX + a.maxX) / 2, z: (a.minZ + a.maxZ) / 2, scale: MM.ppm, w, h }, { layout: L, unitStyle, quality: 'high', zoneLabels: false }); } catch (e) { G.log.warn('UI', 'complex minimap plan failed', e?.message || e); }
    MM.canvas = cv; MM.ver = ver;
    return cv;
  }
  function drawMinimap(ctx2d, map) {
    const cv = minimapCanvas();
    const a = MM.area;
    if (cv) ctx2d.drawImage(cv, map.X(a.minX), map.Y(a.minZ), (a.maxX - a.minX) * map.S, (a.maxZ - a.minZ) * map.S);
    // the bus stop: the way back to the village
    const bs = C.busStop, px = map.X(bs.x), py = map.Y(bs.z), r = Math.max(7, 9 * (map.dpr || 1));
    ctx2d.beginPath(); ctx2d.arc(px, py, r, 0, TAU); ctx2d.fillStyle = '#fff6dc'; ctx2d.fill();
    ctx2d.lineWidth = 2 * (map.dpr || 1); ctx2d.strokeStyle = '#b9882a'; ctx2d.stroke();
    ctx2d.textAlign = 'center'; ctx2d.textBaseline = 'middle'; ctx2d.font = `${Math.round(r * 1.25)}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
    ctx2d.fillStyle = '#000'; ctx2d.fillText('🚌', px, py + 1);
  }

  // ================================================================ THE GROUND PART (order 0)
  // Everything that is terrain, paving or masonry. Draped surfaces follow the RENDERED terrain triangles (meshY) a few
  // centimetres up with a polygon offset; masonry is merged per material (G.bkit Bucket); lamps and signs are merged too.
  /** the rendered terrain's height (same triangles as buildTerrain) — outside the rectangle the plan's height */
  function meshYFn(T) {
    if (!T) return H;
    const { hg, nx, nz, step } = T;
    return (x, z) => {
      const fx = (x - B.minX) / step, fz = (z - B.minZ) / step;
      if (fx < 0 || fz < 0 || fx > nx - 1 || fz > nz - 1) return H(x, z);
      const i = Math.min(nx - 2, Math.floor(fx)), j = Math.min(nz - 2, Math.floor(fz)), u = fx - i, v = fz - j, k = j * nx + i;
      const a = hg[k], b = hg[k + 1], c = hg[k + nx], d = hg[k + nx + 1];
      // triangles (a, c, d) and (a, d, b): the diagonal runs from a to d
      return v >= u ? a + (d - c) * u + (c - a) * v : a + (b - a) * u + (d - b) * v;
    };
  }
  /** draped surfaces: grids of vertices on the ground (+ lift), one BufferGeometry per Drape */
  class Drape {
    constructor(Y) { this.Y = Y; this.p = []; this.n = []; this.uv = []; this.c = []; this.i = []; this.v = 0; }
    vert(x, z, lift, u, w, col) {
      const Y = this.Y, e = 0.5, y = Y(x, z) + lift;
      const nx = Y(x - e, z) - Y(x + e, z), nz = Y(x, z - e) - Y(x, z + e), l = Math.hypot(nx, 2 * e, nz);
      this.p.push(x, y, z); this.n.push(nx / l, 2 * e / l, nz / l); this.uv.push(u, w);
      this.c.push(col ? col.r : 1, col ? col.g : 1, col ? col.b : 1);
      return this.v++;
    }
    /** a grid rows × cols of vertices from fn(r, c) -> [x, z, u, v] | null; quads with a missing corner are skipped */
    grid(rows, cols, fn, lift, col) {
      const ids = new Int32Array(rows * cols).fill(-1);
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) { const q = fn(r, c); if (q) ids[r * cols + c] = this.vert(q[0], q[1], lift, q[2], q[3], col); }
      for (let r = 0; r < rows - 1; r++) for (let c = 0; c < cols - 1; c++) {
        const a = ids[r * cols + c], b = ids[r * cols + c + 1], d = ids[(r + 1) * cols + c], e = ids[(r + 1) * cols + c + 1];
        if (a < 0 || b < 0 || d < 0 || e < 0) continue;
        this.i.push(a, d, e, a, e, b);
      }
    }
    /** a band of half width hw along a polyline (sampled every ds); uv: 'world' (metres) or 'along' (u across 0..1, v metres) */
    strip(pts, hw, o = {}) {
      const ds = o.ds || 1.5, across = o.across || Math.max(1, Math.ceil((2 * hw) / (o.dw || 2))), lift = o.lift ?? 0.05;
      const S = resample(pts, ds), n = S.length;
      if (n < 2) return;
      const off = o.offset || 0;
      this.grid(n, across + 1, (r, c) => {
        const s = S[r], t = -1 + (2 * c) / across, x = s.x + s.nx * (off + t * hw * s.m), z = s.z + s.nz * (off + t * hw * s.m);
        if (o.clip && !o.clip(x, z)) return null;
        return o.uv === 'along' ? [x, z, (t + 1) / 2, s.s] : [x, z, x, z];
      }, lift, o.color);
    }
    /** an annulus r0 … r1 between angles a0 … a1 */
    ring(cx, cz, r0, r1, a0, a1, o = {}) {
      const lift = o.lift ?? 0.05, segs = Math.max(6, Math.ceil(((a1 - a0) * r1) / (o.ds || 1.5))), rad = Math.max(1, Math.ceil((r1 - r0) / (o.dr || 2)));
      this.grid(segs + 1, rad + 1, (r, c) => {
        const a = a0 + ((a1 - a0) * r) / segs, rr = r0 + ((r1 - r0) * c) / rad, x = cx + rr * Math.cos(a), z = cz + rr * Math.sin(a);
        if (o.clip && !o.clip(x, z)) return null;
        return o.uv === 'along' ? [x, z, c / rad, a * rr] : [x, z, x, z];
      }, lift, o.color);
    }
    /** a filled disc (fan of rings) */
    disc(cx, cz, r, o = {}) { this.ring(cx, cz, 0.001, r, o.a0 || 0, o.a1 == null ? TAU : o.a1, o); }
    /** a rectangle area (axis aligned), optionally only where inside(x, z) */
    rect(x0, z0, x1, z1, o = {}) {
      const st = o.ds || 1.5, nx = Math.max(1, Math.ceil((x1 - x0) / st)), nz = Math.max(1, Math.ceil((z1 - z0) / st));
      this.grid(nz + 1, nx + 1, (r, c) => { const x = x0 + ((x1 - x0) * c) / nx, z = z0 + ((z1 - z0) * r) / nz; if (o.inside && !o.inside(x, z)) return null; return [x, z, x, z]; }, o.lift ?? 0.05, o.color);
    }
    /** a flat quad (no draping) — markings on a level spot */
    geometry() {
      if (!this.i.length) return null;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
      g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
      g.setIndex(this.v > 65535 ? new THREE.Uint32BufferAttribute(this.i, 1) : new THREE.Uint16BufferAttribute(this.i, 1));
      g.computeBoundingSphere(); g.computeBoundingBox();
      return g;
    }
  }
  /** points every ds along a polyline with tangent normals (nx, nz → left of travel) and a miter factor m */
  function resample(pts, ds) {
    const out = [];
    if (!pts || pts.length < 2) return out;
    let s = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (L < 1e-6) continue;
      const n = Math.max(1, Math.ceil(L / ds));
      for (let k = 0; k < n; k++) out.push({ x: a[0] + ((b[0] - a[0]) * k) / n, z: a[1] + ((b[1] - a[1]) * k) / n, s: s + (L * k) / n, seg: i });
      s += L;
    }
    const last = pts[pts.length - 1];
    out.push({ x: last[0], z: last[1], s, seg: pts.length - 2 });
    for (let i = 0; i < out.length; i++) {
      const p = out[Math.max(0, i - 1)], q = out[Math.min(out.length - 1, i + 1)];
      let tx = q.x - p.x, tz = q.z - p.z; const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
      out[i].tx = tx; out[i].tz = tz; out[i].nx = -tz; out[i].nz = tx; out[i].m = 1;
    }
    return out;
  }
  /** Chaikin corner cutting (keeps the ends): roads read as curves, not as kinked polylines */
  function chaikin(pts, it = 2) {
    let P = pts.map((p) => [p[0], p[1]]);
    for (let k = 0; k < it; k++) {
      const Q = [P[0]];
      for (let i = 0; i < P.length - 1; i++) {
        const a = P[i], b = P[i + 1];
        Q.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
      }
      Q.push(P[P.length - 1]);
      P = Q;
    }
    return P;
  }
  /** a swept box profile along a path: pts [{x, z, yb, yt}] (bottom / top per point), width w (centred on the path);
   *  faces: left side, top, right side (+ end caps) — flat shaded, uv in metres (u along, v up / across) */
  function sweep(pts, w, o = {}) {
    const n = pts.length;
    if (n < 2) return null;
    const P = [], N = [], U = [], I = [];
    let v = 0;
    const quad = (a, b, c, d, nrm, uvs) => {     // a b c d counter-clockwise seen from outside
      for (const [p, uv] of [[a, uvs[0]], [b, uvs[1]], [c, uvs[2]], [d, uvs[3]]]) { P.push(p[0], p[1], p[2]); N.push(nrm[0], nrm[1], nrm[2]); U.push(uv[0], uv[1]); }
      I.push(v, v + 1, v + 2, v, v + 2, v + 3); v += 4;
    };
    const hw = w / 2;
    let s = 0;
    const L = [], R = [];
    for (let i = 0; i < n; i++) {
      const p = pts[Math.max(0, i - 1)], q = pts[Math.min(n - 1, i + 1)];
      let tx = q.x - p.x, tz = q.z - p.z; const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
      const nx = -tz, nz = tx, c = pts[i];
      L.push({ x: c.x + nx * hw, z: c.z + nz * hw, nx, nz }); R.push({ x: c.x - nx * hw, z: c.z - nz * hw });
    }
    for (let i = 0; i < n - 1; i++) {
      const a = pts[i], b = pts[i + 1], seg = Math.hypot(b.x - a.x, b.z - a.z), s1 = s + seg;
      const la = L[i], lb = L[i + 1], ra = R[i], rb = R[i + 1];
      const nx = (la.nx + lb.nx) / 2, nz = (la.nz + lb.nz) / 2;
      // left side (normal +n), right side (normal −n), top
      quad([la.x, a.yb, la.z], [lb.x, b.yb, lb.z], [lb.x, b.yt, lb.z], [la.x, a.yt, la.z], [nx, 0, nz], [[s, a.yb], [s1, b.yb], [s1, b.yt], [s, a.yt]]);
      quad([rb.x, b.yb, rb.z], [ra.x, a.yb, ra.z], [ra.x, a.yt, ra.z], [rb.x, b.yt, rb.z], [-nx, 0, -nz], [[s1, b.yb], [s, a.yb], [s, a.yt], [s1, b.yt]]);
      if (o.top !== false) quad([la.x, a.yt, la.z], [lb.x, b.yt, lb.z], [rb.x, b.yt, rb.z], [ra.x, a.yt, ra.z], [0, 1, 0], [[s, 0], [s1, 0], [s1, w], [s, w]]);
      s = s1;
    }
    if (o.caps !== false) {
      const end = (i, sign) => {
        const p = pts[i], l = L[i], r = R[i], tx = -l.nz * sign, tz = l.nx * sign;
        if (sign < 0) quad([r.x, p.yb, r.z], [l.x, p.yb, l.z], [l.x, p.yt, l.z], [r.x, p.yt, r.z], [tx, 0, tz], [[0, p.yb], [w, p.yb], [w, p.yt], [0, p.yt]]);
        else quad([l.x, p.yb, l.z], [r.x, p.yb, r.z], [r.x, p.yt, r.z], [l.x, p.yt, l.z], [tx, 0, tz], [[0, p.yb], [w, p.yb], [w, p.yt], [0, p.yt]]);
      };
      end(0, -1); end(n - 1, 1);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
    g.setIndex(I);
    return g;
  }
  /** points of an arc (plan convention), every ds metres, split into runs that avoid the gaps [{a, w}] (w in metres) */
  function arcRuns(cx, cz, r, a0, a1, gaps, ds = 1.2) {
    const runs = [];
    let cur = null;
    const n = Math.max(4, Math.ceil(((a1 - a0) * r) / ds));
    for (let k = 0; k <= n; k++) {
      const a = a0 + ((a1 - a0) * k) / n;
      const inGap = (gaps || []).some((g) => Math.abs(normA(a - g.a + PI) - PI) * r < g.w / 2);
      if (inGap) { if (cur && cur.length > 1) runs.push(cur); cur = null; continue; }
      (cur || (cur = [])).push({ a, x: cx + r * Math.cos(a), z: cz + r * Math.sin(a) });
    }
    if (cur && cur.length > 1) runs.push(cur);
    // a closed full circle without gaps: join the ends
    if (a1 - a0 >= TAU - 1e-6 && (!gaps || !gaps.length) && runs.length === 1) runs[0].push(runs[0][0]);
    return runs;
  }
  /** cut a polyline into runs where keep(x, z) holds (sampled every ds) */
  function lineRuns(pts, ds, keep) {
    const S = resample(pts, ds), runs = [];
    let cur = null;
    for (const s of S) {
      if (!keep(s.x, s.z)) { if (cur && cur.length > 1) runs.push(cur); cur = null; continue; }
      (cur || (cur = [])).push(s);
    }
    if (cur && cur.length > 1) runs.push(cur);
    return runs;
  }

  // ---------------------------------------------------------------- materials of the draped surfaces
  /** one material per surface per build (own); medium / high get the photographed set (world uv in metres) */
  function paveMaterial(ctx, kind) {
    const low = ctx.low;
    const def = {
      asphalt: { color: '#4f5052', set: 'gravel', look: [78, 79, 80], rough: 0.9, units: -2 },
      marks: { color: '#ffffff', set: null, rough: 0.7, units: -5 },
      granite: { color: '#c4baa6', set: 'flagstone', look: [192, 184, 166], rough: 0.85, units: -3 },
      walk: { color: '#d3cbb9', set: 'gravel', look: [208, 201, 186], rough: 0.95, units: -3 },
      earth: { color: '#a48a68', set: 'yard_dirt_path', look: [164, 140, 108], rough: 1, units: -2 },
    }[kind];
    const base = { vertexColors: true, color: low ? new THREE.Color(def.color) : 0xffffff, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: def.units };
    let m;
    if (low || !def.set || !(G.mat && G.mat.usable && G.mat.usable(def.set))) {
      m = new THREE.MeshLambertMaterial({ ...base, color: new THREE.Color(def.color) });
    } else {
      m = new THREE.MeshStandardMaterial({ ...base, roughness: def.rough, metalness: 0 });
      try { G.mat.apply(m, def.set, { look: def.look, tile: kind === 'granite' ? 2.4 : undefined, macro: 0.08, blend: 0.4 }); } catch (e) { m.color.set(def.color); }
    }
    m.name = 'cx-' + kind;
    return ctx.own(m);
  }
  function addDrape(ctx, D, kind, name, shadow = false) {
    const g = D.geometry();
    if (!g) return null;
    const mesh = new THREE.Mesh(g, paveMaterial(ctx, kind));
    mesh.name = 'cx-' + name;
    mesh.receiveShadow = true; mesh.castShadow = shadow;
    mesh.matrixAutoUpdate = false; mesh.updateMatrix();
    ctx.group.add(mesh);
    RUN.groundCalls++; RUN.groundTris += g.index.count / 3;
    return mesh;
  }

  // ---------------------------------------------------------------- the ground part
  CX.add('ground', (ctx) => buildGround(ctx), 0);

  function buildGround(ctx) {
    const BK = G.bkit, M = BK.M, geo = BK.geo, low = ctx.low;
    const T = ctx.complex && ctx.complex.terrain;
    const Y = meshYFn(T);
    const Bk = new BK.Bucket();
    const cols = (hex) => new THREE.Color(hex);
    const WHITE = cols('#f3f1ea'), YELLOW = cols('#e8b730');
    const own = [];
    const colliders = [];
    const col = (c) => { colliders.push(ctx.addCollider(c)); };
    const inB = (x, z, pad = 60) => x > B.minX - pad && x < B.maxX + pad && z > B.minZ - pad && z < B.maxZ + pad;
    const roads = el('road');
    const RB = C.byId('ROUNDABOUT');
    const smoothRoads = roads.map((r) => ({ e: r, pts: chaikin(r.pts, 3) }));
    const onRoad = (x, z, pad = 0, skip = null) => {
      if (Math.hypot(x - RB.cx, z - RB.cz) < RB.r1 + pad) return true;
      for (const r of smoothRoads) if (r.e !== skip && polyD(x, z, r.pts) < r.e.w / 2 + pad) return true;
      for (const e of el('parking').concat(el('busbay'))) if (x > e.x0 - pad && x < e.x1 + pad && z > e.z0 - pad && z < e.z1 + pad) return true;
      return false;
    };

    // ================= asphalt: roads, the roundabout lane, the parking, the bus bay
    const DA = new Drape(Y);
    for (const r of smoothRoads) DA.strip(r.pts, r.e.w / 2, { ds: 1.4, dw: 2, lift: 0.05, clip: (x, z) => inB(x, z) });
    DA.ring(RB.cx, RB.cz, RB.r0, RB.r1, 0, TAU, { ds: 1.4, dr: 2, lift: 0.05 });
    for (const e of el('parking')) DA.rect(e.x0, e.z0, e.x1, e.z1, { ds: 2, lift: 0.05 });
    for (const e of el('busbay')) DA.rect(e.x0, e.z0, e.x1, e.z1, { ds: 1.5, lift: 0.052 });
    addDrape(ctx, DA, 'asphalt', 'asphalt');

    // ================= road markings (white / yellow paint)
    const DM = new Drape(Y), LM = 0.085;
    const dashed = (pts, off, on, gap, w, color, clip) => {
      const S = resample(pts, 0.5);
      let run = null;
      const flush = () => { if (run && run.length > 1) DM.strip(run.map((p) => [p.x + p.nx * off, p.z + p.nz * off]), w / 2, { ds: 0.5, across: 1, lift: LM, color }); run = null; };
      for (const p of S) {
        const ph = on >= 1e6 ? 0 : p.s % (on + gap);
        if (ph > on || (clip && !clip(p.x + p.nx * off, p.z + p.nz * off))) { flush(); continue; }
        (run || (run = [])).push(p);
      }
      flush();
    };
    const SOLID = 1e9;
    for (const r of smoothRoads) {
      const e = r.e, mk = e.markings || {}, hw = e.w / 2;
      const clip = (x, z) => inB(x, z, 50) && Math.hypot(x - RB.cx, z - RB.cz) > RB.r1 + 1.2;
      if (mk.center === 'double-yellow') { dashed(r.pts, 0.12, SOLID, 0, 0.12, YELLOW, clip); dashed(r.pts, -0.12, SOLID, 0, 0.12, YELLOW, clip); }
      else if (mk.center === 'dashed-white') dashed(r.pts, 0, 3, 5, 0.13, WHITE, clip);
      if (mk.edge) { dashed(r.pts, hw - 0.3, SOLID, 0, 0.15, WHITE, clip); dashed(r.pts, -(hw - 0.3), SOLID, 0, 0.15, WHITE, clip); }
    }
    // roundabout: the lane divider (dashed), edge lines; give-way lines and arrows at the entries
    for (const rr of [RB.r0 + 0.35, RB.r1 - 0.35]) DM.ring(RB.cx, RB.cz, rr - 0.075, rr + 0.075, 0, TAU, { ds: 0.8, dr: 1, lift: LM, color: WHITE });
    {
      const n = Math.round((TAU * RB.lane) / 6);
      for (let k = 0; k < n; k++) { const a = (k / n) * TAU; DM.ring(RB.cx, RB.cz, RB.lane - 0.07, RB.lane + 0.07, a, a + 3 / RB.lane, { ds: 0.6, dr: 1, lift: LM, color: WHITE }); }
    }
    const arrow = (x, z, dx, dz, color) => {        // a straight arrow 3.6 m long pointing along (dx, dz)
      const nx = -dz, nz = dx;
      DM.strip([[x - dx * 1.8, z - dz * 1.8], [x + dx * 0.4, z + dz * 0.4]], 0.11, { ds: 0.5, across: 1, lift: LM, color });
      for (let k = 0; k < 6; k++) { const t = k / 6, w = 0.55 * (1 - t); DM.strip([[x + dx * (0.4 + t * 1.2) - nx * w, z + dz * (0.4 + t * 1.2) - nz * w], [x + dx * (0.4 + t * 1.2) + nx * w, z + dz * (0.4 + t * 1.2) + nz * w]], 0.1, { ds: 0.5, across: 1, lift: LM, color }); }
    };
    for (const r of smoothRoads) {
      // which end touches the roundabout?
      for (const end of [0, 1]) {
        const pts = end ? r.pts.slice().reverse() : r.pts, p0 = pts[0];
        if (Math.abs(Math.hypot(p0[0] - RB.cx, p0[1] - RB.cz) - RB.r1) > 3) continue;
        // walk out from the ring 1.5 m (give way, dashed across the inbound half) and 9 m (an arrow)
        const S = resample(pts, 0.5), at = (d) => S.find((s) => Math.hypot(s.x - RB.cx, s.z - RB.cz) >= RB.r1 + d) || S[S.length - 1];
        const g = at(1.6), hw = r.e.w / 2;
        // inbound lane = the right of travel towards the ring (Korea drives on the right): travel dir = −t here
        for (let k = 0; k < 5; k++) { const o0 = -hw + 0.4 + k * 0.75; DM.strip([[g.x - g.nx * o0, g.z - g.nz * o0], [g.x - g.nx * (o0 + 0.45), g.z - g.nz * (o0 + 0.45)]], 0.2, { ds: 0.5, across: 1, lift: LM, color: WHITE }); }
        const a = at(9);
        arrow(a.x - a.nx * hw / 2, a.z - a.nz * hw / 2, -a.tx, -a.tz, WHITE);
      }
    }
    // zebra crossings: across the front road at the gate plaza, across the parking road at the entrance plaza
    const zebra = (r, px, pz, len) => {
      const S = resample(r.pts, 0.5); let best = S[0], bd = Infinity;
      for (const s of S) { const d = Math.hypot(s.x - px, s.z - pz); if (d < bd) { bd = d; best = s; } }
      const hw = r.e.w / 2;
      for (let k = -Math.floor(len / 2); k <= Math.floor(len / 2); k++) {
        const o = k * 0.9, cx = best.x + best.tx * o, cz = best.z + best.tz * o;
        DM.strip([[cx - best.nx * (hw - 0.4), cz - best.nz * (hw - 0.4)], [cx + best.nx * (hw - 0.4), cz + best.nz * (hw - 0.4)]], 0.22, { ds: 1, across: 1, lift: LM, color: WHITE });
      }
      for (const sgn of [-1, 1]) { const o = sgn * (Math.floor(len / 2) * 0.9 + 1.2), cx = best.x + best.tx * o, cz = best.z + best.tz * o; DM.strip([[cx - best.nx * (hw - 0.3), cz - best.nz * (hw - 0.3)], [cx + best.nx * (hw - 0.3), cz + best.nz * (hw - 0.3)]], 0.2, { ds: 1, across: 1, lift: LM, color: WHITE }); }
      return best;
    };
    const RS = smoothRoads.find((r) => r.e.id === 'ROAD_S'), RP = smoothRoads.find((r) => r.e.id === 'ROAD_PARK');
    const crossings = [];
    if (RS) crossings.push(zebra(RS, -38, 131, 5));
    if (RP) crossings.push(zebra(RP, -110, 10, 4));
    // parking bays (white lines), bus bay (yellow box)
    for (const e of el('parking')) for (const b of e.bays) {
      const c = Math.cos(b.rot), s = Math.sin(b.rot);   // bay depth along (sin rot, cos rot) — the car's front
      const fx = s, fz = c, sx = c, sz = -s, hd = b.d / 2, hwb = b.w / 2;
      for (const side of [-1, 1]) DM.strip([[b.x + sx * hwb * side - fx * hd, b.z + sz * hwb * side - fz * hd], [b.x + sx * hwb * side + fx * hd * 0.96, b.z + sz * hwb * side + fz * hd * 0.96]], 0.06, { ds: 1, across: 1, lift: LM, color: WHITE });
    }
    for (const e of el('busbay')) {
      const box = [[e.x0 + 0.2, e.z0 + 0.2], [e.x1 - 0.2, e.z0 + 0.2], [e.x1 - 0.2, e.z1 - 0.2], [e.x0 + 0.2, e.z1 - 0.2], [e.x0 + 0.2, e.z0 + 0.2]];
      DM.strip(box, 0.1, { ds: 0.5, across: 1, lift: LM, color: YELLOW });
      for (let z = e.z0 + 2; z < e.z1 - 2; z += 3) DM.strip([[e.x0 + 0.4, z], [e.x1 - 0.4, z + 1.5]], 0.08, { ds: 0.5, across: 1, lift: LM, color: YELLOW });
    }
    addDrape(ctx, DM, 'marks', 'markings');

    // ================= kerbs: road edges (granite), the island, the parking, the plazas
    const kerbOf = (pts3, w = 0.18, h = 0.15) => Bk.add('stone', sweep(pts3, w, { caps: true }), null, '#cfc8bb');
    const yK = (x, z) => Y(x, z);
    for (const r of smoothRoads) {
      const hw = r.e.w / 2 + 0.09;
      for (const side of [-1, 1]) {
        const off = r.pts.map(() => 0);
        void off;
        const S = resample(r.pts, 1.2).map((s) => [s.x + s.nx * hw * side, s.z + s.nz * hw * side]);
        for (const run of lineRuns(S, 1.2, (x, z) => inB(x, z, 40) && !onRoad(x, z, -0.05, r.e) && !crossingNear(x, z))) kerbOf(run.map((p) => ({ x: p.x, z: p.z, yb: yK(p.x, p.z) - 0.25, yt: yK(p.x, p.z) + 0.15 })));
      }
    }
    function crossingNear(x, z) { for (const c of crossings) if (c && Math.hypot(x - c.x, z - c.z) < 3.4) return true; return false; }
    for (const rr of [RB.r0 - 0.09]) for (const run of arcRuns(RB.cx, RB.cz, rr, 0, TAU, [], 1.2)) kerbOf(run.map((p) => ({ x: p.x, z: p.z, yb: yK(p.x, p.z) - 0.25, yt: yK(p.x, p.z) + 0.2 })), 0.3);
    for (const run of arcRuns(RB.cx, RB.cz, RB.r1 + 0.09, 0, TAU, [], 1.2)) {
      const keep = run.filter((p) => !smoothRoads.some((r) => polyD(p.x, p.z, r.pts) < r.e.w / 2 + 0.6) && !el('busbay').some((e) => p.x > e.x0 - 1 && p.x < e.x1 + 1 && p.z > e.z0 - 1 && p.z < e.z1 + 1));
      for (const sub of splitRun(keep, 1.6)) kerbOf(sub.map((p) => ({ x: p.x, z: p.z, yb: yK(p.x, p.z) - 0.25, yt: yK(p.x, p.z) + 0.15 })));
    }
    for (const e of el('parking')) {
      const ring = [[e.x0 - 0.1, e.z0 - 0.1], [e.x1 + 0.1, e.z0 - 0.1], [e.x1 + 0.1, e.z1 + 0.1], [e.x0 - 0.1, e.z1 + 0.1], [e.x0 - 0.1, e.z0 - 0.1]];
      for (const run of lineRuns(ring, 1.2, (x, z) => !smoothRoads.some((r) => polyD(x, z, r.pts) < r.e.w / 2 + 0.8))) kerbOf(run.map((p) => ({ x: p.x, z: p.z, yb: yK(p.x, p.z) - 0.25, yt: yK(p.x, p.z) + 0.15 })));
      // kerb islands with lawn at the ends of the double rows and in the middle row
      for (const ax of e.aisles || []) void ax;
      for (const [ix, iz] of [[-128, e.z0 + 0.55], [-128, e.z1 - 0.6]]) {
        const w = 9.6, d = 0.9;
        kerbOf([{ x: ix - w / 2, z: iz, yb: yK(ix, iz) - 0.2, yt: yK(ix, iz) + 0.16 }, { x: ix + w / 2, z: iz, yb: yK(ix, iz) - 0.2, yt: yK(ix, iz) + 0.16 }], d);
      }
    }
    function splitRun(list, gap) { const out = []; let cur = []; for (let i = 0; i < list.length; i++) { if (i && Math.hypot(list[i].x - list[i - 1].x, list[i].z - list[i - 1].z) > gap) { if (cur.length > 1) out.push(cur); cur = []; } cur.push(list[i]); } if (cur.length > 1) out.push(cur); return out; }

    // ================= granite paving: plazas, avenues, the corridor apron, the circle's centre plaza, the knoll top
    const DG = new Drape(Y);
    for (const e of el('plaza')) DG.rect(e.x0, e.z0, e.x1, e.z1, { ds: 1.5, lift: 0.04, inside: (x, z) => !onRoad(x, z, 0.1) });
    for (const p of C.paths) {
      if (!p.pts || p.pts.length < 2) continue;
      if (p.kind === 'avenue' || p.kind === 'plaza' && p.id !== 'GC_PLAZA' && p.id !== 'AM_PLAZA' && p.id !== 'KNOLL_TOP') {
        DG.strip(p.pts, p.w / 2, { ds: 1.5, dw: 2, lift: 0.042, clip: (x, z) => !onRoad(x, z, 0.1) && !C.inWater(x, z) });
      }
    }
    // the great circle: the centre plaza (paving pattern: rings of slabs, a darker compass star), the aisles
    const JC = C.byId('JARCIRCLE'), AMP = C.byId('AMPHI');
    if (JC) {
      DG.disc(JC.cx, JC.cz, JC.plazaR, { ds: 1.2, dr: 1.2, lift: 0.045 });
      for (let s = 0; s < 8; s++) { const a = s * PI / 4; DG.strip([[JC.cx + JC.plazaR * Math.cos(a), JC.cz + JC.plazaR * Math.sin(a)], [JC.cx + (JC.wallR + 3.5) * Math.cos(a), JC.cz + (JC.wallR + 3.5) * Math.sin(a)]], JC.aisleW / 2, { ds: 1.4, dw: 1, lift: 0.045 }); }
    }
    if (AMP) {
      DG.ring(AMP.cx, AMP.cz, 0.001, AMP.plazaR, PI, TAU, { ds: 1.2, dr: 1.2, lift: 0.045 });
      DG.strip([[AMP.cx - AMP.wallR - 2, AMP.cz + 2.5], [AMP.cx + AMP.wallR + 2, AMP.cz + 2.5]], 2.5, { ds: 1.5, dw: 1.25, lift: 0.045 });
    }
    const KN = C.byId('KNOLL');
    if (KN) DG.disc(KN.cx, KN.cz, KN.r - 0.2, { ds: 1.2, dr: 1.2, lift: 0.045 });
    addDrape(ctx, DG, 'granite', 'paving');

    // ================= pale walks: the ring walks of the circle and the amphitheatre, the store lanes, field walks
    const DW = new Drape(Y);
    const aisleGaps = (n, a0, w) => Array.from({ length: n }, (_, s) => ({ a: a0 + s * PI / 4, w: w + 0.4 }));
    if (JC) for (const r of JC.walks) DW.ring(JC.cx, JC.cz, r - K.WALK_W / 2, r + K.WALK_W / 2, 0, TAU, { ds: 1.3, dr: 1.6, lift: 0.04, clip: (x, z) => Math.hypot(x - JC.cx, z - JC.cz) < JC.wallR - 0.3 });
    if (AMP) for (let k = 0; k < 10; k++) { const r = K.RING_R0 - 1.2 + K.RING_PERIOD * k; DW.ring(AMP.cx, AMP.cz, r - K.WALK_W / 2, r + K.WALK_W / 2, PI, TAU, { ds: 1.3, dr: 1.6, lift: 0.04, clip: (x, z) => Math.hypot(x - AMP.cx, z - AMP.cz) < AMP.wallR - 0.3 }); }
    for (const p of C.paths) if ((p.kind === 'lane' || p.kind === 'walk') && p.pts && p.pts.length >= 2) DW.strip(p.pts, p.w / 2, { ds: 1.5, dw: 2, lift: 0.035, clip: (x, z) => !onRoad(x, z, 0.1) });
    addDrape(ctx, DW, 'walk', 'walks');
    void aisleGaps;

    // ================= ring kerbs (low granite edges along the walks — image 3: pale rings with kerbs)
    const ringKerbs = (cx, cz, a0, a1, wallR, aisles) => {
      for (let k = 0; k < 10; k++) {
        const rc = K.RING_R0 - 1.2 + K.RING_PERIOD * k;
        for (const rr of [rc - K.WALK_W / 2 - 0.06, rc + K.WALK_W / 2 + 0.06]) {
          if (rr > wallR - 0.6 || rr < K.PLAZA_R + 0.2) continue;
          for (const run of arcRuns(cx, cz, rr, a0, a1, aisles.map((a) => ({ a, w: K.AISLE_W + 0.2 })), low ? 2.4 : 1.4)) kerbOf(run.map((p) => ({ x: p.x, z: p.z, yb: Y(p.x, p.z) - 0.12, yt: Y(p.x, p.z) + 0.09 })), 0.12);
        }
      }
      // the plaza rim
      for (const run of arcRuns(cx, cz, K.PLAZA_R + 0.06, a0, a1, aisles.map((a) => ({ a, w: K.AISLE_W })), 1.2)) kerbOf(run.map((p) => ({ x: p.x, z: p.z, yb: Y(p.x, p.z) - 0.12, yt: Y(p.x, p.z) + 0.16 })), 0.24);
    };
    if (JC) ringKerbs(JC.cx, JC.cz, 0, TAU, JC.wallR, JC.aisles);
    if (AMP) ringKerbs(AMP.cx, AMP.cz, PI, TAU, AMP.wallR, AMP.aisles);
    // aisle edges (granite) in the great circle
    if (JC) for (let s = 0; s < 8; s++) {
      const a = s * PI / 4, ca = Math.cos(a), sa = Math.sin(a), nx = -sa, nz = ca;
      for (const side of [-1, 1]) {
        const o = (JC.aisleW / 2 + 0.06) * side, pts = [];
        for (let r = JC.plazaR + 0.3; r <= JC.wallR - 0.5; r += 1.5) { const x = JC.cx + ca * r + nx * o, z = JC.cz + sa * r + nz * o; pts.push({ x, z, yb: Y(x, z) - 0.12, yt: Y(x, z) + 0.1 }); }
        if (pts.length > 1) Bk.add('stone', sweep(pts, 0.14), null, '#cfc8bb');
      }
    }

    // ================= the centre pieces: a round stone table in the great circle, a stone basin in the amphitheatre
    if (JC) {
      const y = Y(JC.cx, JC.cz);
      Bk.add('stone', geo.cyl(3.0, 3.2, 0.35, 40), M(JC.cx, y + 0.17, JC.cz), '#bdb4a3');
      Bk.add('stone', geo.cyl(1.0, 1.25, 0.7, 24), M(JC.cx, y + 0.7, JC.cz), '#b2a996');
      Bk.add('stone', geo.cyl(1.7, 1.7, 0.18, 32), M(JC.cx, y + 1.13, JC.cz), '#c8bfad');
      col({ shape: 'circle', x: JC.cx, z: JC.cz, r: 3.1, maxY: y + 0.36 });
      // the paving pattern: eight dark granite rays and a ring
      const DS = new Drape(Y), dark = cols('#8f877a');
      for (let s = 0; s < 8; s++) { const a = s * PI / 4 + PI / 8; DS.strip([[JC.cx + 3.4 * Math.cos(a), JC.cz + 3.4 * Math.sin(a)], [JC.cx + (JC.plazaR - 0.6) * Math.cos(a), JC.cz + (JC.plazaR - 0.6) * Math.sin(a)]], 0.22, { ds: 0.8, across: 1, lift: 0.06, color: dark }); }
      DS.ring(JC.cx, JC.cz, 6.0, 6.5, 0, TAU, { ds: 0.8, dr: 1, lift: 0.06, color: dark });
      DS.ring(JC.cx, JC.cz, 3.3, 3.6, 0, TAU, { ds: 0.8, dr: 1, lift: 0.06, color: dark });
      if (AMP) { DS.ring(AMP.cx, AMP.cz, 5.0, 5.4, PI, TAU, { ds: 0.8, dr: 1, lift: 0.06, color: dark }); }
      addDrape(ctx, DS, 'granite', 'paving-pattern');
    }
    if (AMP) {
      const y = Y(AMP.cx, AMP.cz - 2);
      Bk.add('stone', geo.cyl(2.2, 2.4, 0.4, 32), M(AMP.cx, y + 0.2, AMP.cz - 2), '#bdb4a3');
      col({ shape: 'circle', x: AMP.cx, z: AMP.cz - 2, r: 2.3, maxY: y + 0.4 });
    }

    // ================= amphitheatre terraces: stone risers on the terrace edges, steps in the stair aisles
    if (AMP) {
      const gaps = AMP.aisles.map((a) => ({ a, w: AMP.aisleW + 0.1 }));
      AMP.terraces.forEach((t) => {
        if (t.r > AMP.wallR - 0.4) return;
        for (const run of arcRuns(AMP.cx, AMP.cz, t.r, PI, TAU, gaps, low ? 2.2 : 1.2)) {
          const pts = run.map((p) => ({ x: p.x, z: p.z, yb: t.y - K.AMPH_RISE - 0.18, yt: t.y + 0.04 }));
          Bk.add('field', sweep(pts, 0.34), null, '#a49a88');
        }
        // the steps of the five stair aisles (one 0.45 m riser = 2 steps of 0.225)
        for (const a of AMP.aisles) {
          const ca = Math.cos(a), sa = Math.sin(a), nx = -sa, nz = ca, w = AMP.aisleW - 0.2;
          for (let q = 0; q < 2; q++) {
            const r = t.r - 0.55 + q * 0.32, x = AMP.cx + ca * r, z = AMP.cz + sa * r, top = t.y - K.AMPH_RISE / 2 * (1 - q) + 0.01;
            Bk.add('stone', geo.box(w, top - (t.y - K.AMPH_RISE - 0.15), 0.34, 'world'), M(x, (top + t.y - K.AMPH_RISE - 0.15) / 2, z, Math.atan2(nx, nz)), '#c3baa8');
            ctx.addWalkable({ shape: 'box', x, z, hw: w / 2, hd: 0.17, rot: Math.atan2(nx, nz), top, surface: 'stone' });
          }
        }
      });
    }
    // ================= field terraces: stone edges along each riser line
    for (const F of C.elements.filter((e) => e.type === 'field' && !e.overflow)) {
      const [ux, uz] = F.u, [vx, vz] = F.v, [ox, oz] = F.origin;
      const P0 = (u, v) => [ox + ux * u + vx * v, oz + uz * u + vz * v];
      for (let t = 1; t < F.terraces.length; t++) {
        const v = F.terraces[t].v0 + 0.15, lo = F.terraces[t - 1].y, hi = F.terraces[t].y, pts = [];
        for (let u = -1.2; u <= F.lenU + 1.2 + 1e-6; u += low ? 4 : 2) { const [x, z] = P0(Math.min(u, F.lenU + 1.2), v); pts.push({ x, z, yb: Math.min(lo, hi) - 0.2, yt: Math.max(lo, hi) + 0.08 }); }
        if (pts.length > 1) Bk.add('field', sweep(pts, 0.3), null, '#9c907c');
      }
      // the block's outer edge (a low dry-stone rim)
      const rim = [P0(-1.6, -0.3), P0(F.lenU + 1.6, -0.3), P0(F.lenU + 1.6, F.lenV + 1.4), P0(-1.6, F.lenV + 1.4), P0(-1.6, -0.3)];
      for (const run of lineRuns(rim, low ? 3 : 1.5, (x, z) => inB(x, z, 0) && !onRoad(x, z, 0.3))) Bk.add('field', sweep(run.map((p) => ({ x: p.x, z: p.z, yb: H(p.x, p.z) - 0.25, yt: H(p.x, p.z) + 0.32 })), 0.42), null, '#8e8370');
    }
    // ================= the village terrace, the knoll: dressed stone edges
    const TV = C.byId('TERRACE_VILLAGE');
    if (TV) {
      const edge = [[TV.x0, TV.z1], [TV.x0, TV.z0], [TV.x1, TV.z0], [TV.x1, TV.z1], [TV.x0, TV.z1]];
      const gate = (x, z) => !(Math.abs(z - TV.z1) < 0.5 && Math.abs(x - 11) < 2.2) && !C.paths.some((p) => p.kind === 'lane' && p.pts && polyD(x, z, p.pts) < p.w / 2 && (Math.abs(z - TV.z0) < 0.5 || Math.abs(x - TV.x0) < 0.5 || Math.abs(x - TV.x1) < 0.5));
      for (const run of lineRuns(edge, low ? 3 : 1.2, gate)) Bk.add('field', sweep(run.map((p) => ({ x: p.x, z: p.z, yb: Math.min(H(p.x, p.z), TV.y) - 0.6, yt: TV.y + 0.55 })), 0.5), null, '#988c78');
      for (const run of lineRuns(edge, low ? 3 : 1.2, gate)) {
        const pts = run.map((p) => ({ x: p.x, z: p.z, yb: TV.y + 0.55, yt: TV.y + 0.66 }));
        Bk.add('stone', sweep(pts, 0.58), null, '#c2b9a6');
        for (let i = 0; i < run.length - 1; i++) { const a = run[i], b = run[i + 1], mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2, L = Math.hypot(b.x - a.x, b.z - a.z); col({ shape: 'box', x: mx, z: mz, hw: L / 2 + 0.05, hd: 0.3, rot: Math.atan2(b.x - a.x, b.z - a.z) + PI / 2 }); }
      }
    }
    if (KN) {
      for (const run of arcRuns(KN.cx, KN.cz, KN.r, 0, TAU, [{ a: Math.atan2(-1.5 - KN.cz, 85.5 - KN.cx), w: 4.6 }, { a: Math.atan2(-30 - KN.cz, 104 - KN.cx), w: 4.2 }], 1.0)) {
        Bk.add('field', sweep(run.map((p) => ({ x: p.x, z: p.z, yb: H(p.x, p.z) - 0.5, yt: KN.top + 0.12 })), 0.45), null, '#9a8e7a');
      }
    }

    // ================= stone walls (한식 담장): fieldstone base, lime plaster band, tiled coping; gates with stone posts
    for (const w of el('wall')) {
      const a = w.arc, gates = w.gates || [];
      const gaps = gates.map((g) => ({ a: g.a, w: g.w }));
      const runs = arcRuns(a.cx, a.cz, a.r, a.a0, a.a1, gaps, low ? 2.4 : 1.2);
      for (const run of runs) {
        const base = run.map((p) => ({ x: p.x, z: p.z, yb: Y(p.x, p.z) - 0.3, yt: Y(p.x, p.z) + 0.55 }));
        Bk.add('field', sweep(base, w.w + 0.06), null, '#9d917d');
        Bk.add('plaster', sweep(run.map((p) => ({ x: p.x, z: p.z, yb: Y(p.x, p.z) + 0.55, yt: Y(p.x, p.z) + w.h + 0.02 })), w.w - 0.06), null, '#efe9de');
        Bk.add('roof', sweep(run.map((p) => ({ x: p.x, z: p.z, yb: Y(p.x, p.z) + w.h, yt: Y(p.x, p.z) + w.h + 0.12 })), w.w + 0.42), null, '#5d6066');
        Bk.add('roof', sweep(run.map((p) => ({ x: p.x, z: p.z, yb: Y(p.x, p.z) + w.h + 0.12, yt: Y(p.x, p.z) + w.h + 0.24 })), 0.2), null, '#4c4f55');
        for (let i = 0; i < run.length - 1; i++) {
          const p = run[i], q = run[i + 1], mx = (p.x + q.x) / 2, mz = (p.z + q.z) / 2, L = Math.hypot(q.x - p.x, q.z - p.z);
          col({ shape: 'box', x: mx, z: mz, hw: L / 2 + 0.04, hd: w.w / 2 + 0.05, rot: Math.atan2(q.x - p.x, q.z - p.z) + PI / 2 });
        }
      }
      for (const g of gates) for (const sgn of [-1, 1]) {
        const ang = g.a + sgn * (g.w / 2 + 0.3) / a.r, x = a.cx + a.r * Math.cos(ang), z = a.cz + a.r * Math.sin(ang), y = Y(x, z);
        if (a.a1 - a.a0 < TAU - 1e-6 && (normA(ang) < normA(a.a0) - 0.02 && normA(ang) > 0.02)) continue;
        Bk.add('stone', geo.box(0.62, w.h + 0.75, 0.62, 'world'), M(x, y + (w.h + 0.75) / 2 - 0.1, z, -ang), '#bfb6a4');
        Bk.add('stone', geo.box(0.78, 0.14, 0.78, 'world'), M(x, y + w.h + 0.7, z, -ang), '#cbc3b1');
        col({ shape: 'circle', x, z, r: 0.42 });
      }
    }

    // ================= the stone arch bridge (3 arches), humped deck, parapets
    if (bridgeEl) buildBridge(ctx, Bk, bridgeEl, col);
    // ================= stairs (the deck legs; the village stair) and the viewpoint deck
    for (const s of el('stair')) if (!s.natural) buildStair(ctx, Bk, s, col);
    const vs = C.byId('ST_VILLAGE');
    if (vs) naturalSteps(Bk, vs, Y);
    if (deckEl) buildDeck(ctx, Bk, deckEl, col);

    // ================= the bus shelter of the complex, benches along the plaza
    const bs = C.busStop;
    if (bs && bs.shelter) shelter(Bk, bs.shelter, Y, col);
    const plazaE = C.byId('PLAZA_ENTRY');
    if (plazaE) for (let z = plazaE.z0 + 8; z < plazaE.z1 - 4; z += 12) for (const x of [plazaE.x1 - 1.4]) bench(Bk, x, z, -PI / 2, Y, col);
    if (JC) for (let s = 0; s < 8; s++) { const a = s * PI / 4 + PI / 8, r = JC.plazaR - 1.4; bench(Bk, JC.cx + r * Math.cos(a), JC.cz + r * Math.sin(a), Math.atan2(-Math.cos(a), -Math.sin(a)), Y, col); }

    // ================= lamps (merged: posts in metal / stone, heads in glow) + pooled real lights near the player
    const lamps = (C.byId('LAMPS') || { list: [] }).list;
    const corridor = C.byId('CORRIDOR');
    const lampAt = [];
    for (const [x, z, kind] of lamps) {
      if (!inB(x, z, 0)) continue;
      const y = Y(x, z), onCorr = corridor && polyD(x, z, corridor.pts) < corridor.w / 2;
      if (kind === 'street') {
        Bk.add('metal', geo.cyl(0.07, 0.1, 6.2, 8), M(x, y + 3.1, z), '#4a4e53');
        Bk.add('metal', geo.cyl(0.18, 0.22, 0.35, 10), M(x, y + 0.17, z), '#3d4044');
        Bk.add('metal', geo.box(0.12, 0.1, 1.5), M(x, y + 6.1, z), '#4a4e53');
        Bk.add('glow', geo.box(0.34, 0.1, 0.6), M(x, y + 6.0, z), '#fff4dc');
        col({ shape: 'circle', x, z, r: 0.16 });
        lampAt.push({ x, y: y + 5.8, z, kind });
      } else if (kind === 'garden') {
        Bk.add('metal', geo.cyl(0.06, 0.07, 3.0, 8), M(x, y + 1.5, z), '#3f4246');
        Bk.add('glow', geo.cyl(0.18, 0.14, 0.42, 10), M(x, y + 3.15, z), '#fff1d6');
        Bk.add('metal', geo.cyl(0.22, 0.05, 0.12, 10), M(x, y + 3.42, z), '#3f4246');
        col({ shape: 'circle', x, z, r: 0.14 });
        lampAt.push({ x, y: y + 3.1, z, kind });
      } else if (kind === 'bollard') {
        Bk.add('stone', geo.box(0.26, 0.85, 0.26, 'world'), M(x, y + 0.42, z), '#c4bba9');
        Bk.add('glow', geo.box(0.27, 0.12, 0.27), M(x, y + 0.72, z), '#ffefcf');
        col({ shape: 'circle', x, z, r: 0.2 });
        lampAt.push({ x, y: y + 0.8, z, kind });
      } else if (onCorr) {                     // a hanging lantern under the corridor roof (complex-buildings builds the roof)
        Bk.add('glow', geo.cyl(0.2, 0.2, 0.42, 8), M(x, y + 2.75, z), '#ffd9a0');
        Bk.add('wood', geo.cyl(0.24, 0.24, 0.05, 8), M(x, y + 2.98, z), '#6e4a2c');
        lampAt.push({ x, y: y + 2.7, z, kind: 'hang' });
      } else {                                 // 석등: a stone lantern
        Bk.add('stone', geo.box(0.6, 0.18, 0.6, 'world'), M(x, y + 0.09, z), '#b9b09d');
        Bk.add('stone', geo.cyl(0.11, 0.13, 0.75, 8), M(x, y + 0.55, z), '#b9b09d');
        Bk.add('stone', geo.box(0.42, 0.42, 0.42, 'world'), M(x, y + 1.13, z), '#c2b9a6');
        Bk.add('glow', geo.box(0.3, 0.26, 0.44), M(x, y + 1.13, z), '#ffd9a0');
        Bk.add('stone', geo.cyl(0.02, 0.42, 0.28, 4), M(x, y + 1.48, z, PI / 4), '#a9a08e');
        col({ shape: 'circle', x, z, r: 0.34 });
        lampAt.push({ x, y: y + 1.15, z, kind: 'lantern' });
      }
    }
    // ================= signposts (emoji + words on one atlas: one draw call for every board)
    const signs = el('sign');
    const atlas = new BK.SignAtlas('complex-signs', 1024, 1024);
    const signMat = ctx.own(new THREE.MeshStandardMaterial({ map: null, roughness: 0.8, metalness: 0 }));
    const DSn = [];
    for (const s of signs) {
      if (!inB(s.x, s.z, 0)) continue;
      const rect = atlas.slot(256, 128, (c2, w, h) => {
        const t = G.gfx.signTexture(`${s.emoji} ${s.text.split(' — ')[0].split(' (')[0]}`, s.text.includes(' — ') ? s.text.split(' — ')[1] : (s.text.includes(' (') ? '(' + s.text.split(' (')[1] : ''), { w, h, size: 34 });
        c2.drawImage(t.image, 0, 0); t.dispose();
      });
      const y = Y(s.x, s.z), fx = Math.sin(s.rot), fz = Math.cos(s.rot);
      Bk.add('wood', geo.box(0.12, 2.1, 0.12, 'grain'), M(s.x, y + 1.05, s.z), '#6e4a2c');
      Bk.add('wood', geo.box(1.46, 0.78, 0.07, 'grain'), M(s.x, y + 1.9, s.z, s.rot), '#5b3a22');
      DSn.push({ g: geo.quad(1.36, 0.68, rect), m: M(s.x + fx * 0.04, y + 1.9, s.z + fz * 0.04, s.rot) });
      DSn.push({ g: geo.quad(1.36, 0.68, rect), m: M(s.x - fx * 0.04, y + 1.9, s.z - fz * 0.04, s.rot + PI) });
      col({ shape: 'circle', x: s.x, z: s.z, r: 0.14 });
    }
    if (DSn.length) {
      signMat.map = atlas.getTexture(); ctx.own(signMat.map);
      const SB = new BK.Bucket();
      for (const d of DSn) SB.add('signs', d.g, d.m, '#ffffff');
      SB.build(ctx.group, { name: 'cx', materials: { signs: signMat }, ao: false });
      RUN.groundCalls++;
    }

    // ================= the fountain basin's footprint (complex-landscape builds the fountain)
    const GD = C.byId('GARDEN');
    if (GD && GD.fountain) col({ shape: 'circle', x: GD.fountain.x, z: GD.fountain.z, r: GD.fountain.r + 0.2 });

    // ================= merge the masonry
    const meshes = Bk.build(ctx.group, { name: 'cx-ground', ao: low ? false : { ground: (x, z) => Y(x, z) } });
    for (const k of Object.keys(meshes)) { const m = meshes[k]; RUN.groundCalls++; RUN.groundTris += m.geometry.index ? m.geometry.index.count / 3 : m.geometry.attributes.position.count / 3; if (k === 'plaster' || k === 'field' || k === 'stone') m.castShadow = true; }

    // ================= pooled lamp lights near the player (none on low): moved to the nearest lamps twice a second
    const lights = [];
    const nl = Math.min(ctx.complex.knobs.lampLights, lampAt.length);
    for (let i = 0; i < nl; i++) lights.push(ctx.light({ x: lampAt[i].x, y: lampAt[i].y, z: lampAt[i].z, color: 0xffcf8a, intensity: 9, distance: 18, decay: 2, day: 0 }));
    let tAcc = 1;
    return {
      lamps: lampAt,
      update(dt) {
        if (!lights.length) return;
        tAcc += dt;
        if (tAcc < 0.5) return;
        tAcc = 0;
        const pl = G.sys.player && G.sys.player.position;
        if (!pl) return;
        const px = pl.x - ORIGIN.x, pz = pl.z - ORIGIN.z;
        const near = lampAt.map((l, i) => ({ i, d: (l.x - px) * (l.x - px) + (l.z - pz) * (l.z - pz) })).sort((a, b) => a.d - b.d).slice(0, lights.length);
        near.forEach((n, k) => {
          const l = lampAt[n.i], h = lights[k];
          h.set({ x: l.x, y: l.y, z: l.z, distance: l.kind === 'street' ? 20 : l.kind === 'bollard' ? 6 : 10, intensity: l.kind === 'street' ? 10 : l.kind === 'bollard' ? 2.5 : 5 });
          const L = h.light;
          if (L) { L.position.set(ORIGIN.x + l.x, l.y, ORIGIN.z + l.z); L.distance = h.cfg.distance; }
        });
      },
      dispose() { for (const o of own) { try { o.dispose(); } catch (e) { /* gone */ } } colliders.length = 0; },
    };
  }

  // ---------------------------------------------------------------- the bridge
  function buildBridge(ctx, Bk, e, col) {
    const BK = G.bkit, M = BK.M, geo = BK.geo;
    const xa = Math.max(Math.min(e.x0, e.x1), B.minX + 0.2), xb = Math.max(e.x0, e.x1) + 4, z = e.z0, hw = e.w / 2;
    // the deck profile: the plan's deck height over the water, easing down to the banks (a humped arch bridge)
    const ground = (x) => H(x, z);
    const yTop = e.deckY, xc = -172, half = Math.max(xc - xa, xb - xc);
    const prof = (x) => Math.max(ground(x) + 0.05, yTop - (yTop - Math.max(0.6, ground(xb))) * Math.pow(Math.abs(x - xc) / half, 2.2));
    const pts = [];
    for (let x = xa; x <= xb + 1e-6; x += 0.6) pts.push({ x, z, y: prof(x) });
    // deck slab (stone) + parapets + spandrel walls with three arch openings
    Bk.add('stone', sweep(pts.map((p) => ({ x: p.x, z: p.z, yb: p.y - 0.45, yt: p.y })), e.w), null, '#b8ae9b');
    for (const side of [-1, 1]) {
      const zz = z + side * (hw - 0.15);
      Bk.add('stone', sweep(pts.map((p) => ({ x: p.x, z: zz, yb: p.y, yt: p.y + 0.85 })), 0.3), null, '#aca290');
      Bk.add('stone', sweep(pts.map((p) => ({ x: p.x, z: zz, yb: p.y + 0.85, yt: p.y + 0.95 })), 0.4), null, '#c6bdab');
      for (let i = 0; i < pts.length - 1; i += 2) { const a = pts[i], b = pts[Math.min(pts.length - 1, i + 2)]; col({ shape: 'box', x: (a.x + b.x) / 2, z: zz, hw: Math.abs(b.x - a.x) / 2 + 0.05, hd: 0.2 }); }
    }
    // the arches: three spans over the water; each spandrel is a ring of voussoirs and a filled wall above it
    const spans = [[-183.5, -175.5], [-176, -168], [-168.5, -160.5]];
    const seg = 18;
    for (const [s0, s1] of spans) {
      const cx = (s0 + s1) / 2, r = (s1 - s0) / 2, springY = -1.2;
      for (let k = 0; k < seg; k++) {
        const a0 = PI - (PI * k) / seg, a1 = PI - (PI * (k + 1)) / seg, am = (a0 + a1) / 2;
        const x = cx + r * Math.cos(am), y = springY + r * Math.sin(am);
        Bk.add('stone', geo.box(0.62, (PI * r) / seg + 0.04, e.w - 0.1, 'world'), M(x + 0.18 * Math.cos(am), y + 0.18 * Math.sin(am), z, 0, 1, 1, 1, 0, am - PI / 2), k % 2 ? '#b3a996' : '#a89e8b');
        // the wall above the voussoir up to the deck
        const top = prof(x) - 0.45, yb = y + 0.45 * Math.sin(am);
        if (top > yb + 0.05) Bk.add('field', geo.box((PI * r) / seg + 0.06, top - yb, e.w - 0.25, 'world'), M(x, (top + yb) / 2, z), '#9b907c');
      }
    }
    // piers between the arches and abutments
    for (const px of [-175.75, -168.25]) { const top = prof(px) - 0.45; Bk.add('field', geo.box(1.2, top + 3.2, e.w - 0.2, 'world'), M(px, (top - 3.2) / 2, z), '#968b78'); col({ shape: 'box', x: px, z, hw: 0.6, hd: hw - 0.1, maxY: top }); }
    // walkable: the deck in short level pieces (rise per piece ≤ 0.2 m)
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      ctx.addWalkable({ shape: 'box', x: (a.x + b.x) / 2, z, hw: Math.abs(b.x - a.x) / 2 + 0.02, hd: hw - 0.3, top: Math.max(a.y, b.y), surface: 'stone' });
    }
  }

  // ---------------------------------------------------------------- stairs of the viewpoint deck (timber, on the slope)
  /** steps along the plan's legs at max(plan y, ground + 0.15); rise per step ≤ 0.22 m, treads 0.3 … 1.6 m */
  function buildStair(ctx, Bk, s, col) {
    const BK = G.bkit, M = BK.M, geo = BK.geo, w = s.w || 2.4;
    const P = s.pts;
    // a fine profile along the whole leg
    const prof = [];
    let acc = 0;
    for (let i = 0; i < P.length - 1; i++) {
      const a = P[i], b = P[i + 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.ceil(L / 0.25));
      for (let k = 0; k < n; k++) {
        const t = k / n, x = a[0] + (b[0] - a[0]) * t, z = a[1] + (b[1] - a[1]) * t, py = a[2] + (b[2] - a[2]) * t;
        const dx = (b[0] - a[0]) / L, dz = (b[1] - a[1]) / L, nx = -dz, nz = dx;
        let g = -Infinity;
        for (const o of [-w / 2, 0, w / 2]) g = Math.max(g, H(x + nx * o, z + nz * o));
        prof.push({ x, z, s: acc + L * t, y: Math.max(py, g + 0.15), g: H(x, z), dx, dz });
      }
      acc += L;
    }
    const last = P[P.length - 1];
    { const g = H(last[0], last[1]); prof.push({ x: last[0], z: last[1], s: acc, y: Math.max(last[2], g + 0.15), g, dx: prof[prof.length - 1].dx, dz: prof[prof.length - 1].dz }); }
    // smooth small dips (≤ 0.6 m) so the stair does not bob
    for (let i = 1; i < prof.length - 1; i++) prof[i].y = Math.max(prof[i].y, Math.min(prof[i - 1].y, prof[i + 1].y) - 0.0);
    // steps
    const steps = [];
    let i0 = 0;
    while (i0 < prof.length - 1) {
      let i1 = i0 + 1;
      while (i1 < prof.length - 1 && Math.abs(prof[i1].y - prof[i0].y) < 0.2 && prof[i1].s - prof[i0].s < 1.6 && prof[i1].dx === prof[i0].dx) i1++;
      const a = prof[i0], b = prof[i1];
      let top = -Infinity, gmin = Infinity;
      for (let k = i0; k <= i1; k++) { top = Math.max(top, prof[k].y); gmin = Math.min(gmin, prof[k].g); }
      steps.push({ x: (a.x + b.x) / 2, z: (a.z + b.z) / 2, len: Math.hypot(b.x - a.x, b.z - a.z), top, gmin, rot: Math.atan2(a.dx, a.dz) });
      i0 = i1;
    }
    for (const st of steps) {
      Bk.add('plank', geo.box(w, 0.08, st.len + 0.04, 'world'), M(st.x, st.top - 0.04, st.z, st.rot), '#b98e60');
      Bk.add('wood', geo.box(w, 0.2, 0.06, 'grain'), M(st.x - Math.sin(st.rot) * st.len / 2, st.top - 0.14, st.z - Math.cos(st.rot) * st.len / 2, st.rot), '#7a5236');
      ctx.addWalkable({ shape: 'box', x: st.x, z: st.z, hw: w / 2, hd: st.len / 2 + 0.03, rot: st.rot, top: st.top, surface: 'wood' });
      const lift = st.top - st.gmin;
      if (lift > 0.35) for (const o of [-w / 2 + 0.1, w / 2 - 0.1]) {
        const nx = Math.cos(st.rot), nz = -Math.sin(st.rot), x = st.x + nx * o, z = st.z + nz * o, gy = H(x, z);
        if (st.top - gy > 0.3) Bk.add('wood', geo.box(0.14, st.top - gy + 0.3, 0.14, 'grain'), M(x, (st.top + gy - 0.3) / 2, z), '#6e4a2c');
      }
    }
    // hand rails both sides (posts every ~2 m, a rail on top) + colliders
    for (const side of [-1, 1]) {
      const rail = [];
      for (const st of steps) { const nx = Math.cos(st.rot), nz = -Math.sin(st.rot); rail.push({ x: st.x + nx * side * (w / 2 + 0.06), z: st.z + nz * side * (w / 2 + 0.06), y: st.top }); }
      for (let i = 0; i < rail.length; i++) {
        const p = rail[i];
        if (i % 2 === 0) Bk.add('wood', geo.box(0.09, 1.05, 0.09, 'grain'), M(p.x, p.y + 0.52, p.z), '#6e4a2c');
        if (i < rail.length - 1) {
          const q = rail[i + 1], L = Math.hypot(q.x - p.x, q.z - p.z);
          if (L < 0.05) continue;
          const ry = Math.atan2(q.x - p.x, q.z - p.z), pitch = -Math.atan2(q.y - p.y, L);
          Bk.add('wood', geo.box(0.07, 0.07, L + 0.05, 'grain'), M((p.x + q.x) / 2, (p.y + q.y) / 2 + 1.02, (p.z + q.z) / 2, ry, 1, 1, 1, pitch), '#8a6040');
          Bk.add('wood', geo.box(0.04, 0.05, L + 0.05, 'grain'), M((p.x + q.x) / 2, (p.y + q.y) / 2 + 0.55, (p.z + q.z) / 2, ry, 1, 1, 1, pitch), '#7a5236');
          col({ shape: 'box', x: (p.x + q.x) / 2, z: (p.z + q.z) / 2, hw: 0.06, hd: L / 2 + 0.04, rot: ry });
        }
      }
    }
    return steps;
  }
  /** granite steps that follow natural ground (the village stair): visual only, the terrain carries the walker */
  function naturalSteps(Bk, s, Y) {
    const BK = G.bkit, M = BK.M, geo = BK.geo, w = s.w || 3;
    const a = s.pts[0], b = s.pts[s.pts.length - 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]), dx = (b[0] - a[0]) / L, dz = (b[1] - a[1]) / L, rot = Math.atan2(dx, dz);
    for (let t = 0.2; t < L; t += 0.42) {
      const x = a[0] + dx * t, z = a[1] + dz * t, y = Y(x, z), y2 = Y(x + dx * 0.42, z + dz * 0.42);
      Bk.add('stone', geo.box(w, Math.max(0.12, Math.abs(y2 - y) + 0.12), 0.44, 'world'), M(x, Math.max(y, y2) - Math.max(0.12, Math.abs(y2 - y) + 0.12) / 2 + 0.06, z, rot), '#c0b7a4');
    }
  }

  // ---------------------------------------------------------------- the viewpoint deck (전망 데크)
  function buildDeck(ctx, Bk, e, col) {
    const BK = G.bkit, M = BK.M, geo = BK.geo, y = e.y;
    const w = e.x1 - e.x0, d = e.z1 - e.z0, cx = (e.x0 + e.x1) / 2, cz = (e.z0 + e.z1) / 2;
    Bk.add('plank', geo.box(w, 0.1, d, 'world'), M(cx, y - 0.05, cz), '#c49a6c');
    for (const zz of [e.z0, e.z1]) Bk.add('wood', geo.box(w + 0.1, 0.24, 0.16, 'grain'), M(cx, y - 0.2, zz), '#6e4a2c');
    for (const xx of [e.x0, e.x1]) Bk.add('wood', geo.box(0.16, 0.24, d, 'grain'), M(xx, y - 0.2, cz), '#6e4a2c');
    for (let x = e.x0 + 0.3; x <= e.x1 - 0.2; x += 2.3) for (let z = e.z0 + 0.3; z <= e.z1 - 0.2; z += 2.4) {
      const g = H(x, z); if (y - g > 0.25) Bk.add('wood', geo.box(0.2, y - g + 0.4, 0.2, 'grain'), M(x, (y + g - 0.4) / 2, z), '#5e3d24');
    }
    ctx.addWalkable({ shape: 'box', x: cx, z: cz, hw: w / 2, hd: d / 2, top: y, surface: 'wood' });
    // the rail: north (the view), east and south; on the west side an opening where the stair arrives
    const stairEnd = C.byId('ST_DECK3'), sx = stairEnd ? stairEnd.pts[stairEnd.pts.length - 1] : [e.x0, cz];
    const railSeg = (ax, az, bx, bz) => {
      const L = Math.hypot(bx - ax, bz - az); if (L < 0.2) return;
      const ry = Math.atan2(bx - ax, bz - az), mx = (ax + bx) / 2, mz = (az + bz) / 2;
      Bk.add('wood', geo.box(0.1, 0.1, L, 'grain'), M(mx, y + e.rail, mz, ry), '#8a6040');
      Bk.add('railing', geo.mquad ? geo.mquad(L, 0.85) : geo.box(0.02, 0.85, L), M(mx, y + 0.5, mz, ry + (geo.mquad ? -PI / 2 : 0)));
      for (let t = 0; t <= 1.0001; t += 1 / Math.max(1, Math.round(L / 1.6))) Bk.add('wood', geo.box(0.11, e.rail, 0.11, 'grain'), M(ax + (bx - ax) * t, y + e.rail / 2, az + (bz - az) * t), '#6e4a2c');
      col({ shape: 'box', x: mx, z: mz, hw: 0.08, hd: L / 2 + 0.05, rot: ry });
    };
    railSeg(e.x0, e.z0, e.x1, e.z0); railSeg(e.x1, e.z0, e.x1, e.z1); railSeg(e.x1, e.z1, e.x0, e.z1);
    railSeg(e.x0, e.z1, e.x0, Math.min(e.z1, sx[1] + 1.4)); railSeg(e.x0, Math.max(e.z0, sx[1] - 1.4), e.x0, e.z0);
    // two benches facing the view, the telescope stand, the sign
    for (const bx of [cx - 3.2, cx + 3.2]) bench(Bk, bx, cz + 2.4, PI, () => y, col);
    const t = e.telescope;
    if (t) {
      Bk.add('metal', geo.cyl(0.05, 0.07, 1.1, 8), M(t.x, y + 0.55, t.z + 0.3), '#4a4e53');
      Bk.add('metal', geo.cyl(0.25, 0.32, 0.08, 10), M(t.x, y + 0.04, t.z + 0.3), '#3d4044');
      Bk.add('glossy', geo.cyl(0.09, 0.13, 0.62, 12), M(t.x, y + 1.2, t.z + 0.1, 0, 1, 1, 1, PI / 2 - 0.25), '#2f5d8a');
      col({ shape: 'circle', x: t.x, z: t.z + 0.3, r: 0.3 });
      ctx.interact({ id: 'CX_TELESCOPE', kind: 'look', label: '🔭 망원경으로 단지 보기', kidLabel: '🔭 멀리 보기', emoji: '🔭', radius: 2.6,
        position: { x: t.x, y: y + 1.2, z: t.z + 0.3 }, onInteract: () => lookFromDeck() });
    }
    const face = ctx.own(new THREE.MeshStandardMaterial({ map: ctx.own(G.gfx.signTexture('🔭 만장대 전망대', '만 개의 장독대가 한눈에 보여요', { w: 512, h: 256 })), roughness: 0.8, metalness: 0 }));
    const wood = BK.mat('wood');
    const sg = new THREE.Group(); sg.name = 'cx-deck-sign';
    sg.position.set(e.x1 - 1.0, y, e.z1 - 0.9); sg.rotation.y = PI;
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.12, 2.1, 0.12), wood); post.position.y = 1.05;
    const board = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.75, 0.06), [wood, wood, wood, wood, face, wood]); board.position.set(0, 1.75, 0.07);
    for (const m of [post, board]) { m.castShadow = true; m.receiveShadow = true; sg.add(m); }
    ctx.group.add(sg);
    col({ shape: 'circle', x: sg.position.x, z: sg.position.z, r: 0.12 });
  }
  /** the telescope: the camera of the picture for a while (the deck viewpoint), then back */
  function lookFromDeck() {
    const cam = G.sys.camera, v = (C.viewpoints || []).find((p) => p.id === 'aerial'), d = P.def(ID);
    if (!cam || !v || !d || typeof cam.shot !== 'function') return;
    try {
      cam.shot({ x: d.origin.x + v.x, y: v.y, z: d.origin.z + v.z }, { x: d.origin.x + v.look.x, y: v.look.y, z: d.origin.z + v.look.z }, { fov: v.fov, duration: 1.6 });
      if (easyOn()) G.easy?.say?.('하늘에서 본 만장대 단지예요. 둥근 장독대가 보여요!', { priority: 1 });
      setTimeout(() => { try { cam.setMode('follow', { duration: 1.2 }); } catch (e) { /* camera gone */ } }, 6500);
    } catch (e) { G.log.warn('WORLD', 'complex: telescope view failed', e?.message || e); }
  }
  /** a granite bench (seat on two legs) */
  function bench(Bk, x, z, rot, Y, col) {
    const BK = G.bkit, M = BK.M, geo = BK.geo, y = Y(x, z), c = Math.cos(rot), s = Math.sin(rot);
    Bk.add('plank', geo.box(1.8, 0.08, 0.46, 'world'), M(x, y + 0.45, z, rot), '#a77a4e');
    for (const o of [-0.7, 0.7]) Bk.add('stone', geo.box(0.16, 0.42, 0.42, 'world'), M(x + c * o, y + 0.21, z - s * o, rot), '#b9b09d');
    col({ shape: 'box', x, z, hw: 0.92, hd: 0.25, rot, maxY: y + 0.5 });
  }
  /** the bus shelter of the complex (C.busStop.shelter: centre, w along the kerb, d, rot = its front) */
  function shelter(Bk, sh, Y, col) {
    const BK = G.bkit, M = BK.M, geo = BK.geo, y = Y(sh.x, sh.z), r = sh.rot, c = Math.cos(r), s = Math.sin(r);
    const at = (lx, ly, lz) => M(sh.x + lx * c + lz * s, y + ly, sh.z - lx * s + lz * c, r);
    const W = sh.d, D = sh.w;     // long side along the kerb
    Bk.add('stone', geo.box(W + 0.4, 0.14, D + 0.3, 'world'), at(0, 0.07, 0), '#cbc3b1');
    for (const lx of [-W / 2 + 0.2, W / 2 - 0.2]) for (const lz of [-D / 2 + 0.15, D / 2 - 0.2]) Bk.add('wood', geo.box(0.16, 2.6, 0.16, 'grain'), at(lx, 1.36, lz), '#7a5236');
    Bk.add('wood', geo.box(W - 0.3, 1.9, 0.07, 'grain'), at(0, 1.2, -D / 2 + 0.12), '#a8794c');
    Bk.add('roof', geo.box(W + 1.0, 0.18, D + 0.9, 'world'), at(0, 2.75, 0.1), '#5a5d63');
    Bk.add('wood', geo.box(W + 0.8, 0.14, 0.18, 'grain'), at(0, 2.6, D / 2 + 0.3), '#6e4a2c');
    Bk.add('plank', geo.box(W - 1.2, 0.08, 0.48, 'world'), at(0, 0.5, -D / 2 + 0.55), '#b98a5c');
    for (const lx of [-W / 2 + 1.2, 0, W / 2 - 1.2]) Bk.add('metal', geo.box(0.08, 0.42, 0.4), at(lx, 0.29, -D / 2 + 0.55), '#55595e');
    col({ shape: 'box', x: sh.x - s * (D / 2 - 0.12), z: sh.z - c * (D / 2 - 0.12), hw: W / 2 - 0.1, hd: 0.12, rot: r });
  }

  // ================================================================ the build runner (environment → parts)
  const RUN = { built: [], failed: [], groundCalls: 0, groundTris: 0, buildMs: 0, last: null };
  /** run parts sorted by order (stable), each in try / catch; their updates go into one ctx.onUpdate */
  function runParts(list, ctx) {
    const parts = list.slice().sort((a, b) => a.order - b.order);
    const built = [], failed = [], disposers = [], updates = [];
    for (const p of parts) {
      try {
        const r = p.fn(ctx, C) || {};
        if (typeof r.dispose === 'function') disposers.push(r.dispose);
        if (typeof r.update === 'function') updates.push({ name: p.name, fn: r.update, dead: false });
        built.push(p.name);
      } catch (e) {
        failed.push(p.name);
        G.log.warn('WORLD', `complex part "${p.name}" failed — skipped`, e?.message || e);
      }
    }
    if (updates.length) ctx.onUpdate((dt, t) => {
      for (let i = 0; i < updates.length; i++) {
        const u = updates[i];
        if (u.dead) continue;
        try { u.fn(dt, t); } catch (e) { u.dead = true; G.log.warn('WORLD', `complex part "${u.name}": update failed — stopped`, e?.message || e); }
      }
    });
    return { built, failed, dispose() { for (const d of disposers.reverse()) { try { d(); } catch (e) { G.log.warn('WORLD', 'complex part dispose failed', e?.message || e); } } } };
  }
  function buildPlace(ctx) {
    const t0 = performance.now();
    const S = knobs(ctx.quality);
    ctx.complex = { knobs: S, origin: ORIGIN };
    const disposers = [];
    RUN.built = []; RUN.failed = []; RUN.groundTris = 0; RUN.groundCalls = 1;
    // 1. the terrain
    try {
      const T = buildTerrain(ctx, S);
      disposers.push(() => T.dispose());
      RUN.groundTris += T.tris;
      ctx.complex.masks = T.F;
      ctx.complex.terrain = T;
      ctx.complex.terrain = T;
    } catch (e) { G.log.warn('WORLD', 'complex-site: terrain failed', e?.message || e); }
    // 2. the parts, in order (ground 0 · landscape 10 · main 20 · buildings 30 · units 40)
    const R = runParts(CX.list, ctx);
    RUN.built = R.built; RUN.failed = R.failed;
    disposers.push(R.dispose);
    // the way back: the bus stop of the complex
    const bs = C.busStop;
    ctx.exitDoor(bs.x, bs.z, { y: H(bs.x, bs.z) + 1.2 });
    RUN.buildMs = Math.round(performance.now() - t0);
    G.log.info('WORLD', `complex built in ${RUN.buildMs} ms — parts: ${RUN.built.join(', ') || '-'}${RUN.failed.length ? ' · failed: ' + RUN.failed.join(', ') : ''}`);
    return { dispose() { for (const d of disposers.reverse()) { try { d(); } catch (e) { G.log.warn('WORLD', 'complex part dispose failed', e?.message || e); } } } };
  }

  // ================================================================ the valley's shuttle stop (the door of PL_ALLOT)
  // Beside the valley parking, on the north verge of the main road, east of the bays: free ground, reachable on foot.
  const STOP = (() => {
    const pk = G.data.layout?.parking || { x: -32, z: 89, w: 24, d: 12, rot: 0.06 };
    const x = pk.x + pk.w / 2 + 6.5, z = pk.z + 1.5;                // the shelter stands here, facing the road (south)
    return { x, z, rot: 0, door: { x, z: z + 2.4 }, exit: { x: x - 1.6, z: z + 3.2, rotY: PI }, bus: { x: x - 0.5, z: z + 7.4, rot: -PI / 2 } };
  })();

  // ================================================================ the place
  function define() {
    const bs = C.busStop;
    return P.define({
      id: ID, name: '만장대 단지', kidName: '만 개의 장독대', emoji: '🏺', zoneId: 'ZONE_PL_ALLOT', color: '#c98d4f',
      desc: '항아리 1만 개가 둥글게 놓인 장독대 단지예요. 셔틀버스를 타고 가요.',
      origin: { x: ORIGIN.x, z: ORIGIN.z },
      size: { w: B.maxX - B.minX, d: B.maxZ - B.minZ, h: 80 },
      bounds: { minX: B.minX, maxX: B.maxX, minZ: B.minZ, maxZ: B.maxZ },         // [complex-ground] local, not centred
      margin: 0,
      indoor: false, keepAlive: true,
      floorY: (x, z) => C.height(x, z), isWater: (x, z) => C.inWater(x, z), surfaceAt, surface: 'grass',
      spawn: { x: C.spawn.x, z: C.spawn.z, rotY: C.spawn.rot },
      door: { x: STOP.door.x, z: STOP.door.z, label: '🚌 만장대 단지 가기', kidLabel: '🚌 만 개의 장독대 가기', radius: 3.4, sign: false },
      exit: STOP.exit,
      camera: { dist: 10, min: 4.5, max: 24, pitch: 0.42, pmin: -0.1, pmax: 1.15 },
      far: 2600,
      minimap: drawMinimap,
      build: buildPlace,
    });
  }

  const site = {
    name: 'complexSite', order: 29, label: '만장대 단지',
    C, busStop: STOP, _defined: null,
    parts() { return RUN.built.slice(); },
    failed() { return RUN.failed.slice(); },
    stats() { return { parts: RUN.built.slice(), failed: RUN.failed.slice(), ground: { calls: RUN.groundCalls, tris: RUN.groundTris }, buildMs: RUN.buildMs }; },
    surfaceAt,
    _runParts: runParts,
    /** enter the complex; opts.focusUnit ('J01-17' or { zone, seq }) ends beside that unit */
    enter(opts = {}) { return P.enter(ID, opts); },
    init() {
      this._defined = define();
      G.bus.on('place:enter', (e) => {
        if (!e || e.id !== ID) return;
        const fu = e.opts && e.opts.focusUnit;
        if (!fu) return;
        const code = typeof fu === 'string' ? fu : fu.zone && fu.seq ? `${fu.zone}-${fu.seq}` : '';
        try { if (code) G.sys.allotDistrict?.goto?.(code); } catch (err) { G.log.warn('WORLD', 'complex: focus unit failed', err?.message || err); }
      });
      G.bus.on('allot:map', () => { MM.ver = -1; });
    },
    postInit() {
      try { buildShuttle(); } catch (e) { G.log.warn('WORLD', 'complex: valley shuttle stop failed', e?.message || e); }
    },
  };

  // ---------------------------------------------------------------- valley: the stop, a waiting bus, the signpost at 장독대
  let shuttleRoot = null;
  function buildShuttle() {
    const E = G.sys.engine, BK = G.bkit;
    if (!E?.scene || !BK) return;
    P.hideRoot?.('complex-shuttle');
    shuttleRoot = new THREE.Group();
    shuttleRoot.name = 'complex-shuttle';
    E.scene.add(shuttleRoot);
    const W = G.world, gy = (x, z) => { const y = W.terrainHeight ? W.terrainHeight(x, z) : 0; return fin(y) ? y : 0; };
    const Bk = new BK.Bucket(), M = BK.M, geo = BK.geo;
    // shelter (stone floor, timber frame, tiled roof, a bench), facing south (+z) towards the road
    const s = STOP, y0 = gy(s.x, s.z);
    const at = (lx, ly, lz, ry = 0) => M(s.x + lx, y0 + ly, s.z + lz, ry);
    Bk.add('stone', geo.box(4.2, 0.18, 2.4, 'world'), at(0, 0.09, 0), '#c9c3b8');
    for (const px of [-1.9, 1.9]) for (const pz of [-0.95]) Bk.add('wood', geo.box(0.14, 2.5, 0.14, 'grain'), at(px, 1.33, pz), '#7a5236');
    for (const px of [-1.9, 1.9]) Bk.add('wood', geo.box(0.14, 2.4, 0.14, 'grain'), at(px, 1.28, 0.95), '#7a5236');
    Bk.add('wood', geo.box(4.0, 1.9, 0.06, 'grain'), at(0, 1.25, -1.0), '#a8794c');
    Bk.add('roof', geo.box(4.8, 0.16, 3.0, 'world'), at(0, 2.62, 0, 0), '#5d6066');
    Bk.add('wood', geo.box(4.6, 0.12, 0.16, 'grain'), at(0, 2.5, 1.2), '#6e4a2c');
    Bk.add('plank', geo.box(3.0, 0.08, 0.5, 'world'), at(0, 0.52, -0.6), '#b98a5c');
    for (const px of [-1.2, 1.2]) Bk.add('metal', geo.box(0.08, 0.42, 0.4), at(px, 0.3, -0.6), '#55595e');
    // the bus (a simple coach until complex-landscape lends its own)
    let bus = null;
    try { bus = G.complexLandscape?.bus?.() || null; } catch (e) { bus = null; }
    const bx = s.bus.x, bz = s.bus.z, by = gy(bx, bz);
    if (bus && bus.isObject3D) { bus.position.set(bx, by, bz); bus.rotation.y = s.bus.rot; shuttleRoot.add(bus); }
    else addSimpleBus(Bk, M(bx, by, bz, s.bus.rot), BK);
    const meshes = Bk.build(shuttleRoot, { name: 'complex-shuttle' });
    void meshes;
    // the stop sign + the destination board
    const face = new THREE.MeshStandardMaterial({ map: G.gfx.signTexture('🚌 만장대 단지', '셔틀버스 타는 곳', { w: 512, h: 256 }), roughness: 0.8, metalness: 0 });
    const wood = BK.mat('wood');
    const sg = new THREE.Group(); sg.name = 'complex-shuttle-sign';
    sg.position.set(s.x + 2.9, gy(s.x + 2.9, s.z + 1.4), s.z + 1.4);
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.12, 2.4, 0.12), wood); post.position.y = 1.2;
    const board = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.75, 0.06), [wood, wood, wood, wood, face, wood]); board.position.set(0, 2.15, 0.07);
    for (const m of [post, board]) { m.castShadow = true; m.receiveShadow = true; sg.add(m); }
    shuttleRoot.add(sg);
    // colliders: the shelter's back wall and posts, the bus body (the door point is in front of the shelter, on the verge)
    W.addCollider({ shape: 'box', x: s.x, z: s.z - 1.0, hw: 2.0, hd: 0.12, tag: 'complex-shuttle' });
    W.addCollider({ shape: 'circle', x: sg.position.x, z: sg.position.z, r: 0.14, tag: 'complex-shuttle' });
    W.addCollider({ shape: 'box', x: bx, z: bz, hw: 5.4, hd: 1.3, rot: s.bus.rot + PI / 2, tag: 'complex-shuttle' });
    // the signpost at 장독대 that points to the stop
    const jz = (G.data.zones || []).find((z) => z.id === 'ZONE_JANGDOKDAE');
    if (jz) {
      const dx = s.x - jz.center[0], dz = s.z - jz.center[1], l = Math.hypot(dx, dz) || 1;
      const px = jz.center[0] + (dx / l) * (jz.r + 2), pz = jz.center[1] + (dz / l) * (jz.r + 2);
      const f2 = new THREE.MeshStandardMaterial({ map: G.gfx.signTexture('🚌 만 개의 장독대 →', '셔틀버스 타는 곳', { w: 512, h: 256 }), roughness: 0.8, metalness: 0 });
      const g2 = new THREE.Group(); g2.name = 'complex-shuttle-signpost';
      g2.position.set(px, gy(px, pz), pz); g2.rotation.y = Math.atan2(-dx, -dz);
      const p2 = new THREE.Mesh(new THREE.BoxGeometry(0.12, 2.0, 0.12), wood); p2.position.y = 1.0;
      const b2 = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.65, 0.06), [wood, wood, wood, wood, f2, wood]); b2.position.set(0, 1.75, 0.07);
      for (const m of [p2, b2]) { m.castShadow = true; m.receiveShadow = true; g2.add(m); }
      shuttleRoot.add(g2);
      W.addCollider({ shape: 'circle', x: px, z: pz, r: 0.14, tag: 'complex-shuttle' });
      site.signpost = { x: px, z: pz };
    }
    shuttleRoot.updateMatrixWorld(true);
  }
  /** a 10.5 m coach from boxes (body, windows, wheels, lights) into a Bucket, local frame: front = +z */
  function addSimpleBus(Bk, base, BK) {
    const M = BK.M, mul = BK.mul, geo = BK.geo;
    const add = (key, g, m, c) => Bk.add(key, g, mul(base, m), c);
    const L = 10.5, Wd = 2.5;
    add('glossy', geo.box(Wd, 2.3, L), M(0, 1.55, 0), '#e9e6dc');
    add('glossy', geo.box(Wd + 0.02, 0.5, L + 0.02), M(0, 0.62, 0), '#2f6f5e');
    add('darkglass', geo.box(Wd + 0.04, 1.0, L - 1.6), M(0, 2.0, -0.4), '#ffffff');
    add('darkglass', geo.box(Wd - 0.2, 1.3, 0.06), M(0, 1.95, L / 2 + 0.01), '#ffffff');
    add('glossy', geo.box(Wd - 0.1, 0.12, L - 0.2), M(0, 2.74, 0), '#d8d4ca');
    for (const sx of [-1, 1]) for (const sz of [-3.4, 3.2]) {
      add('paint', geo.cyl(0.5, 0.5, 0.3, 14), M(sx * (Wd / 2 - 0.12), 0.5, sz, 0, 1, 1, 1, 0, PI / 2), '#1d1e20');
      add('metal', geo.cyl(0.26, 0.26, 0.31, 10), M(sx * (Wd / 2 - 0.11), 0.5, sz, 0, 1, 1, 1, 0, PI / 2), '#b9bcc0');
    }
    for (const sx of [-1, 1]) {
      add('glow', geo.box(0.4, 0.16, 0.05), M(sx * 0.85, 0.8, L / 2 + 0.01), '#ffffff');
      add('paint', geo.box(0.4, 0.16, 0.05), M(sx * 0.85, 0.8, -L / 2 - 0.01), '#c0281c');
    }
    add('glow', geo.box(1.6, 0.26, 0.04), M(0, 2.6, L / 2 + 0.02), '#ffd27a');
  }

  G.register(site);
})();
