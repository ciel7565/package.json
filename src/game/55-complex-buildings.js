const CX = (G.complexParts = G.complexParts || { list: [], add(name, fn, order) { this.list.push({ name, fn, order: order == null ? 100 : order }); } });
// =============================================================================
// 55-complex-buildings.js — the buildings of 만장대 단지 (PL_ALLOT) that the owner's picture shows round the main building,
// and the ones the site plan adds (CONTRACT §16.8, §17.9 lane complex2). A part of the complex (order 30).
//
// Look target: assets/reference/03-concept-main.webp. Every footprint, height, roof type, door and turn comes from the
// master plan G.data.complex (33-complex-plan.js, plan v2) — nothing here copies a plan number:
//   한옥 마을   B_VH01 … B_VH12 on TERRACE_VILLAGE: each a little different — 팔작 or 맞배 roof (plan), 툇마루 or not,
//               window patterns, chimney side, the yard (장독대 with jars, 평상, woodpile, well, flower bed), a garden
//               pine / persimmon, the 돌담 with its tiled coping and an 일각문 in the south wall (plan `wall`), a door
//               plate. Each front door leads to "내 방" through G.sys.myroom.doorAt (lane myroom); without it the door
//               says kindly that the room comes later.
//   회랑         CORRIDOR: a roofed timber bridge on tall posts from the main building's terrace (side door, the landing
//               gap 54 leaves in the terrace edge) to the pavilion, its deck rising evenly from the terrace (B_MAIN y +
//               podium) to the pavilion floor; a walkable deck with rails, the plan path underneath stays free.
//   정자         B_PAVILION on KNOLL: a two-storey 누각 — stone platform, sixteen posts, a skirt roof, the upper floor
//               with 계자난간 reached by an inner stair, a 팔작 roof above.
//   정문         B_GATE: 솟을대문 in the circle's wall — two side rooms, the raised middle roof over the passage (open
//               판문 leaves), 현판 "장독대 정문", lanterns.
//   카페         B_CAFE: a timber-and-glass café under a tiled 맞배 roof with a deck terrace (tables, stools, parasols,
//               planters); its door enters PL_CAFE (56-complex-office.js).
//   창고         B_SH1 … B_SH8: the long storehouses. 44-allot-district.js draws a numbered door at every bay face (y 0 …
//               2.5 at the face); this file draws everything round them — gable ends, the timber band and plaster above
//               the doors, posts every eight bays, the long tiled roof, the name boards "창고 n동", the shared-bay plate.
//   옹기 공방    B_WORKSHOP: clay-walled workshop with an open work bay, drying racks of raw jars, glaze tubs, a clay
//               heap and firewood; its door enters PL_WORKSHOP. KILN: the climbing kiln (오름가마) — chambers stepping up
//               the slope, the fire mouth glowing, stoking holes, a chimney, a tiled shelter over it.
//
// FORMS  every building belongs to a CLUSTER (village · corridor (+ pavilion) · gate · cafe · store · workshop). A cluster
//   has a NEAR form (the kit's roofs G.bkit.roof with tiles and eave curves, rafters / brackets / rails / jars / yard
//   things, posts on stone bases, hanji windows) and a FAR form (the same silhouettes: boxes, a low-poly roof with curved
//   eaves and upturned corners, a hanji strip that glows at night) — 3 to 4 draw calls a cluster. The near form shows
//   while the camera is within NEAR metres of the cluster (high 110 / 125, medium 70 / 80; 3 s rechecks with hysteresis);
//   `low` = far forms only, flat colours (the kit's materials carry no maps on low).
// BUDGET (`aerial`, high): every cluster far → ≈ 20 draw calls, < 40 k triangles (+ the village's garden trees through
//   G.sys.nature.grove). Walking the village: its near form ≈ 15 calls / ≈ 140 k triangles.
// COLLIDERS  houses / rooms / storehouses / kiln: tall boxes (tag 'building'; a jump never clears them); 돌담 and the
//   corridor / pavilion rails: true tops (maxY; the rails with minY so only a walker up there meets them); posts:
//   circles; terrace tables, stools, planters: their tags (§17.1 jump rules). Walkables: house platforms, the café
//   deck, the corridor deck (pieces ≤ 3 m along each leg, joints covered), the pavilion floor, its stair and upper floor.
// CAMERA  invisible blocker boxes over the walled bodies (houses, rooms of the gate, café, storehouses, workshop) as the
//   main building does; the open corridor and pavilion block nothing.
// DOORS (interactables)  CX_VH01_ROOM … CX_VH12_ROOM (내 방) · CX_CAFE_DOOR → PL_CAFE · CX_WORKSHOP_DOOR → PL_WORKSHOP ·
//   CX_PAVILION_VIEW (the upper floor: a calm word about the view) · CX_KILN (what the kiln is).
// API    G.complexBuildings = { built, stats(), clusters() → [{ id, lod, near: {calls, tris}, far: {calls, tris} }],
//   setLod(name | null) ('near' | 'far' forces every cluster; null = automatic), doors [{ id, kind, x, y, z, place?, room? }],
//   deck { pts, y0, y1, yAt(s), len, at(s) → { x, z, y } }, pavilion { x, z, floor, upper, stair }, houses [{ id, x, z, y,
//   door }], update(dt) }. All positions in PL_ALLOT local metres (= plan coordinates; y = absolute, as C.height).
// =============================================================================
CX.add('buildings', (ctx, C) => {
  const K = G.bkit;
  if (!K || !C || typeof C.byId !== 'function') throw new Error('complex-buildings: G.bkit / G.data.complex missing');
  const { geo, M, mul, I4 } = K;
  const PI = Math.PI, TAU = PI * 2;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const fin = Number.isFinite;
  const quality = ctx.quality || G.sys.engine?.quality || 'low';
  const low = !!ctx.low || quality === 'low';
  const med = quality === 'medium';
  const HY = (x, z) => C.height(x, z);
  const rngOf = K.rngOf || ((seed) => { let q = (seed | 0) || 7; return () => ((q = (q * 16807) % 2147483647) / 2147483647); });
  const FONT = K.FONT || 'sans-serif';
  const T = {
    post: '#a8794f', postDark: '#7c5636', beam: '#946840', dark: '#5f412a', rafter: '#8a6040', plaster: '#f2ece1', plasterWarm: '#ece1cc',
    clay: '#c9a37a', stone: '#d4cdc0', stoneDark: '#aba396', coping: '#e3ded3', field: '#b1a590', deck: '#bb8d60', deckDark: '#8f6a48',
    roofFar: '#5b5e63', roofUnder: '#4b3a2c', paper: '#ffffff', jar: '#62402a', jarRaw: '#a98466', brick: '#9c6c4e', iron: '#3e3a36',
    cloth: '#f4efe4', green: '#4e6b3c', soil: '#6b4e33', glassTint: '#d8e2e6',
  };
  const disposers = [], owned = [], blockers = [];
  const own = (x) => { if (x) { owned.push(x); try { ctx.own?.(x); } catch (e) { /* older ctx */ } } return x; };
  const root = new THREE.Group(); root.name = 'complex-buildings';
  ctx.group.add(root);

  // ================================================================= clusters (near / far forms)
  const CL = new Map();
  function cluster(id, cx, cz, r) {
    const gNear = new THREE.Group(), gFar = new THREE.Group();
    gNear.name = 'cxb:' + id + ':near'; gFar.name = 'cxb:' + id + ':far';
    root.add(gNear, gFar);
    const c = { id, cx, cz, cy: HY(cx, cz), r, near: new K.Bucket(), far: new K.Bucket(), gNear, gFar, lod: low ? 'far' : 'near', meshes: { near: {}, far: {} } };
    CL.set(id, c);
    return c;
  }

  // ================================================================= frames: local (lx, ly, lz) of a building → plan
  /** a building frame: origin (x, y, z), turned by rot about +y (front = local +z) */
  function frame(x, y, z, rot = 0) {
    const m = M(x, y, z, rot), c = Math.cos(rot), s = Math.sin(rot);
    return {
      x, y, z, rot, m,
      at: (lx, ly, lz, ry = 0, sx = 1, sy = sx, sz = sx, rx = 0, rz = 0) => mul(m, M(lx, ly, lz, ry, sx, sy, sz, rx, rz)),
      p: (lx, lz) => [x + lx * c + lz * s, z - lx * s + lz * c],
    };
  }
  /** colliders / walkables in a frame (local centre, half sizes; heights absolute) */
  const colBox = (f, lx, lz, hw, hd, extra) => { const [x, z] = f.p(lx, lz); return ctx.addCollider(Object.assign({ shape: 'box', x, z, hw, hd, rot: f.rot }, extra || {})); };
  const colCircle = (x, z, r, extra) => ctx.addCollider(Object.assign({ shape: 'circle', x, z, r }, extra || {}));
  const walkBox = (f, lx, lz, hw, hd, top, surface) => { const [x, z] = f.p(lx, lz); return ctx.addWalkable({ shape: 'box', x, z, hw, hd, rot: f.rot, top, surface: surface || 'wood' }); };
  const blockerMat = K.Site?.hullMat || new THREE.MeshBasicMaterial({ visible: false });
  const unitBox = K.Site?.unitBox || own(new THREE.BoxGeometry(1, 1, 1));
  function addBlocker(f, lx, ly0, lz, w, h, d) {
    const m = new THREE.Mesh(unitBox, blockerMat);
    const [x, z] = f.p(lx, lz);
    m.position.set(x, f.y + ly0 + h / 2, z); m.rotation.y = f.rot; m.scale.set(w, h, d);
    m.visible = false; m.name = 'blocker'; m.raycast = THREE.Mesh.prototype.raycast;
    root.add(m); m.updateMatrix(); m.updateMatrixWorld(true);
    if (Array.isArray(G.world?.cameraBlockers)) { G.world.cameraBlockers.push(m); blockers.push(m); }
  }

  // ================================================================= shared pieces
  const box = (B, key, f, w, h, d, lx, ly, lz, tint, ry = 0, uv = 'world', rx = 0, rz = 0) => B.add(key, geo.box(w, h, d, uv), f.at(lx, ly, lz, ry, 1, 1, 1, rx, rz), tint);
  const beam = (B, f, w, h, d, lx, ly, lz, tint, ry = 0) => B.add('wood', geo.box(w, h, d, 'grain'), f.at(lx, ly, lz, ry), tint || T.beam);
  /** a door leaf (판문) hung at (hx, hz) in frame f, `L` wide, opened by `phi` rad towards −z (s = which side it closes from) */
  function leaf(B, f, hx, hz, L, h, ly0, phi, s, tint) {
    const dx = -s * Math.cos(phi), dz = -Math.sin(phi), cx = hx + dx * L / 2, cz = hz + dz * L / 2;
    B.add('plank', geo.box(L, h, 0.07, 'world'), f.at(cx, ly0 + h / 2, cz, Math.atan2(-dz, dx)), tint);
    for (const v of [0.25, 0.75]) B.add('wood', geo.box(L * 0.92, 0.09, 0.05, 'grain'), f.at(cx - dz * 0.05, ly0 + h * v, cz + dx * 0.05, Math.atan2(-dz, dx)), T.dark);
  }
  /** a round post on a 주춧돌 from ly0 to ly1 (local), radius r */
  function post(B, f, lx, lz, ly0, ly1, r, tint, seg = 10, base = true) {
    if (base) B.add('stone', geo.cyl(r * 1.75, r * 2.05, 0.16, Math.max(6, seg - 2)), f.at(lx, ly0 + 0.08, lz), T.stone);
    const yb = ly0 + (base ? 0.16 : 0);
    B.add('wood', geo.cyl(r * 0.93, r, ly1 - yb, seg), f.at(lx, (yb + ly1) / 2, lz), tint || T.post);
  }
  /** a 창호 panel: hanji with a timber frame and a lattice of thin bars (ttisal / jeongja / aja) */
  function changho(B, f, lx, ly, lz, ry, w, h, pattern, fine) {
    const P = (u, v, n) => f.at(lx + Math.cos(ry) * u + Math.sin(ry) * n, ly + v, lz - Math.sin(ry) * u + Math.cos(ry) * n, ry);
    B.add('hanji', geo.quad(w, h, [0, 0, 1, 1]), P(0, 0, 0.005));
    const fr = 0.06, dk = T.dark;
    for (const s of [-1, 1]) B.add('wood', geo.box(fr, h + fr * 2, 0.08, 'grain'), P(s * (w / 2 + fr / 2), 0, 0.02), dk);
    for (const s of [-1, 1]) B.add('wood', geo.box(w + fr * 2, fr, 0.08, 'grain'), P(0, s * (h / 2 + fr / 2), 0.02), dk);
    if (!fine) return;
    const bar = 0.022;
    if (pattern === 'ttisal') {
      for (let i = 1; i < 6; i++) { const u = -w / 2 + (w * i) / 6; B.add('wood', geo.box(bar, h, 0.03), P(u, 0, 0.025), dk); }
      for (const v of [h * 0.36, 0, -h * 0.36]) for (const k of [-1, 0, 1]) B.add('wood', geo.box(w, bar, 0.03), P(0, v + k * 0.05, 0.025), dk);
    } else if (pattern === 'aja') {
      for (let i = 1; i < 4; i++) { const u = -w / 2 + (w * i) / 4; B.add('wood', geo.box(bar, h, 0.03), P(u, 0, 0.025), dk); }
      for (let j = 1; j < 5; j++) { const v = -h / 2 + (h * j) / 5; B.add('wood', geo.box(w, bar, 0.03), P(0, v, 0.025), dk); }
      B.add('wood', geo.box(w * 0.5, bar, 0.03), P(0, h * 0.1, 0.027), dk);
    } else {
      const nu = Math.max(2, Math.round(w / 0.24)), nv = Math.max(2, Math.round(h / 0.24));
      for (let i = 1; i < nu; i++) B.add('wood', geo.box(bar, h, 0.03), P(-w / 2 + (w * i) / nu, 0, 0.025), dk);
      for (let j = 1; j < nv; j++) B.add('wood', geo.box(w, bar, 0.03), P(0, -h / 2 + (h * j) / nv, 0.025), dk);
    }
  }
  /** one bay of a hanok wall between two posts (local points along the wall, facing n = outward local normal angle ry) */
  function wallBay(B, f, ax, az, bx, bz, ry, kind, y0, y1, o = {}) {
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 0.3) return;
    const cx = (ax + bx) / 2, cz = (az + bz) / 2, h = y1 - y0;
    const P = (u, v, n) => f.at(cx + Math.cos(ry) * u + Math.sin(ry) * n, v, cz - Math.sin(ry) * u + Math.cos(ry) * n, ry);
    const wt = o.wall || T.plaster, ft = o.frame || T.dark;
    B.add(o.wallMat || 'plaster', geo.box(len - 0.05, h, 0.14, 'world'), P(0, y0 + h / 2, 0), wt);
    B.add('wood', geo.box(len, 0.16, 0.19, 'grain'), P(0, y0 + 0.08, 0.01), ft);
    B.add('wood', geo.box(len, 0.2, 0.19, 'grain'), P(0, y1 - 0.1, 0.01), ft);
    if (kind === 'door') {
      const dh = Math.min(2.0, h - 0.4), dw = Math.min(0.8, (len - 0.3) / 2);
      for (const s of [-1, 1]) changho(B, f, cx + Math.cos(ry) * s * (dw / 2 + 0.05) + Math.sin(ry) * 0.075, y0 + 0.18 + dh / 2, cz - Math.sin(ry) * s * (dw / 2 + 0.05) + Math.cos(ry) * 0.075, ry, dw, dh, o.pattern || 'ttisal', o.fine);
      B.add('wood', geo.box(len, 0.13, 0.19, 'grain'), P(0, y0 + 0.2 + dh + 0.07, 0.01), ft);
    } else if (kind === 'window') {
      const ww = Math.min(1.4, len - 0.45), wh = Math.min(1.0, h - 1.25);
      B.add('wood', geo.box(len, 0.13, 0.19, 'grain'), P(0, y0 + 0.78, 0.01), ft);
      if (ww > 0.3 && wh > 0.3) changho(B, f, cx + Math.sin(ry) * 0.075, y0 + 0.9 + wh / 2, cz + Math.cos(ry) * 0.075, ry, ww, wh, o.pattern || 'jeongja', o.fine);
    } else {
      B.add('wood', geo.box(len, 0.12, 0.19, 'grain'), P(0, y0 + 0.95, 0.01), ft);
      if (len > 2.0) B.add('wood', geo.box(0.11, h - 0.2, 0.19, 'grain'), P(0, y0 + h / 2, 0.01), ft);
    }
  }

  // ---------------------------------------------------------------- the far roof: few quads, curved eaves, upturned corners
  /** o = { mode: 'paljak'|'hip'|'gable', hw, hd, ov, rise, y (eave), tint } in frame f (ridge along local x) */
  function farRoof(B, f, o) {
    const A = o.hw + o.ov, Cc = o.hd + o.ov, H = o.rise, yb = o.y, gable = o.mode === 'gable';
    const xr = gable ? A : Math.max(0.3, o.mode === 'hip' ? A - Cc : A - Cc * 0.55);
    const lift = gable ? 0.05 : 0.42, k = 1.45, nu = gable ? 4 : 6, nv = 3;
    const yAt = (x, v) => yb + H * Math.pow(v, k) + lift * Math.pow(Math.min(1, Math.abs(x) / A), 2.4) * (1 - v) * (1 - v);
    const tint = o.tint || T.roofFar;
    for (const mz of [1, -1]) {
      const fn = (i, j, oo, under) => {
        const v = j / nv, half = lerp(A, xr, v), x = (i / nu * 2 - 1) * half;
        const bulge = gable ? 0 : 0.3 * Math.pow(Math.abs(x) / A, 2.4) * (1 - v);
        oo[0] = x; oo[1] = yAt(x, v) - (under ? 0.12 : 0); oo[2] = mz * ((1 - v) * Cc + bulge); oo[3] = x; oo[4] = (1 - v) * Cc * 1.2;
      };
      B.add('roof', geo.grid(nu, nv, (i, j, oo) => fn(i, j, oo, false), mz < 0), f.m, tint);
      B.add('roof', geo.grid(nu, nv, (i, j, oo) => fn(i, j, oo, true), mz > 0), f.m, T.roofUnder);
    }
    if (!gable) {
      for (const mx of [1, -1]) {
        const n = 4, fn = (i, j, oo, under) => {
          const v = j / nv, s = 1 - (i / n) * 2, zr = (1 - v) * Cc * s, x = mx * lerp(A + 0.3 * (1 - v) * Math.pow(Math.abs(s), 2.4), xr, v);
          oo[0] = x; oo[1] = yAt(A, v) * (1 - Math.abs(s) * 0) - (under ? 0.12 : 0) + (lift * (Math.pow(Math.abs(s), 2.4) - 1) * (1 - v) * (1 - v)); oo[2] = zr; oo[3] = zr; oo[4] = v * 4;
        };
        B.add('roof', geo.grid(n, nv, (i, j, oo) => fn(i, j, oo, false), mx > 0), f.m, tint);
        B.add('roof', geo.grid(n, nv, (i, j, oo) => fn(i, j, oo, true), mx < 0), f.m, T.roofUnder);
      }
      if (o.mode === 'paljak') {   // the 합각: a small white gable under the ridge end
        for (const mx of [1, -1]) {
          const g = new THREE.BufferGeometry(), xg = mx * (xr + 0.05), yt = yb + H, yg = yAt(xr, 0.55), zg = (1 - 0.55) * Cc * 0.8;
          g.setAttribute('position', new THREE.Float32BufferAttribute([xg, yg, -zg, xg, yg, zg, xg, yt - 0.1, 0], 3));
          g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0.5, 1], 2));
          if (mx < 0) g.setIndex([0, 1, 2]); else g.setIndex([0, 2, 1]);
          g.computeVertexNormals();
          B.add('roof', g, f.m, '#d9d2c4');
        }
      }
    } else {
      for (const mx of [1, -1]) {   // gable ends (plaster triangles under the roof)
        const g = new THREE.BufferGeometry(), x = mx * o.hw, zg = o.hd;
        g.setAttribute('position', new THREE.Float32BufferAttribute([x, yAt(o.hw, 1 - o.hd / Cc), -zg, x, yAt(o.hw, 1 - o.hd / Cc), zg, x, yb + H - 0.12, 0], 3));
        g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0.5, 1], 2));
        if (mx < 0) g.setIndex([0, 1, 2]); else g.setIndex([0, 2, 1]);
        g.computeVertexNormals();
        B.add('roof', g, f.m, '#cfc6b6');
      }
    }
    B.add('roof', geo.box(2 * xr + 0.2, 0.32, 0.38), f.at(0, yb + H + 0.04, 0), '#46494e');
  }
  /** a far roof: the kit's own roof at a coarse resolution, folded into two keys ('roof' for tiles, eaves and soffits,
   *  'paint' for ridge plaster and barge boards) — its curves and upturned corners read from the aerial view; on low the
   *  few-quad roof above (flat colours, the same silhouette) */
  function roofFar(B, f, o) {
    if (low || !fin(o.wallTop)) { farRoof(B, f, o); return; }
    const tmp = new K.Bucket();
    const ro = o.kit ? Object.assign({}, o.kit, { seg: 0.35, vres: 0.4 }) : { mode: o.mode, hw: o.hw, hd: o.hd, ov: o.ov, rise: o.rise, out: o.mode === 'gable' ? 0 : 0.5, lift: 0.5, t: 0.3, seg: 0.35, vres: 0.4, tint: '#ffffff', ridge: { w: 0.42, h: 0.42 } };
    ro.y = K.roofBaseFor(ro, o.kit ? o.kit.wallTop : o.wallTop);
    delete ro.wallTop;
    K.roof(tmp, f.at(o.lx || 0, 0, o.lz || 0), ro);
    for (const [k, list] of tmp.parts) for (const g of list) B.add(k === 'roof' || k === 'soffit' || k === 'fascia' ? 'roof' : 'paint', g, null, k === 'soffit' ? '#6c5646' : k === 'fascia' ? '#8a7a68' : null);
    tmp.parts.clear();
  }
  /** the kit roof (near) — returns the eave y (bottom of the tiles at the wall line) */
  function nearRoof(B, f, o) {
    const ro = Object.assign({ out: 0.5, lift: 0.5, t: 0.3, tint: '#ffffff', vres: med ? 0.7 : 1 }, o);
    if (med && ro.seg == null) ro.seg = 0.7;
    ro.y = K.roofBaseFor(ro, o.wallTop);
    delete ro.wallTop;
    K.roof(B, f.at(o.lx || 0, 0, o.lz || 0, o.ry || 0), ro);
    return ro;
  }
  // ---------------------------------------------------------------- name boards: one canvas for every board of the part
  const BOARDS = [];
  const board = (text, opt = {}) => { BOARDS.push({ text, ...opt }); return BOARDS.length - 1; };
  let boardTex = null;
  const boardQuads = [];     // { B, f, lx, ly, lz, ry, w, h, i }
  function boardAtlas() {
    if (boardTex || !BOARDS.length || !G.gfx?.canvasTexture) return boardTex;
    const cw = 512, chh = 128, cols = 2, rows = Math.ceil(BOARDS.length / cols);
    boardTex = own(G.gfx.canvasTexture(cw * cols, chh * rows, (c) => {
      BOARDS.forEach((b, i) => {
        const x0 = (i % cols) * cw, y0 = Math.floor(i / cols) * chh;
        const g = c.createLinearGradient(x0, y0, x0, y0 + chh);
        g.addColorStop(0, b.bg || '#5b3a22'); g.addColorStop(1, b.bg2 || '#3f2615');
        c.fillStyle = g; c.fillRect(x0, y0, cw, chh);
        c.strokeStyle = b.edge || '#c9a35c'; c.lineWidth = 6; c.strokeRect(x0 + 8, y0 + 8, cw - 16, chh - 16);
        c.fillStyle = b.fg || '#f6e7c3'; c.textAlign = 'center'; c.textBaseline = 'middle';
        const size = Math.min(78, Math.floor((cw - 60) / Math.max(2, Array.from(b.text).length) * 1.05));
        c.font = `800 ${size}px ${FONT}`;
        c.fillText(b.text, x0 + cw / 2, y0 + chh / 2 + 3);
      });
    }));
    boardTex.userData = { cols, rows };
    return boardTex;
  }
  function addBoard(B, f, i, lx, ly, lz, ry, w, h) {
    if (low && [...CL.values()].some((c) => c.near === B)) return;
    boardQuads.push({ B, f, i, lx, ly, lz, ry, w, h });
    B.add('wood', geo.box(w + 0.12, h + 0.12, 0.07, 'grain'), f.at(lx, ly, lz - Math.cos(ry) * 0.04, ry), '#3a2414');
  }
  function flushBoards() {
    const tex = boardAtlas();
    if (!tex || !boardQuads.length) return;
    const cols = 2, rows = Math.ceil(BOARDS.length / cols);
    const mat = own(low ? new THREE.MeshLambertMaterial({ map: tex }) : new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7, metalness: 0 }));
    const byGroup = new Map();
    for (const q of boardQuads) {
      const g = geo.quad(q.w, q.h, [(q.i % cols) / cols, 1 - (Math.floor(q.i / cols) + 1) / rows, ((q.i % cols) + 1) / cols, 1 - Math.floor(q.i / cols) / rows]);
      g.applyMatrix4(q.f.at(q.lx, q.ly, q.lz, q.ry));
      const key = q.B;
      if (!byGroup.has(key)) byGroup.set(key, []);
      byGroup.get(key).push(g);
    }
    const BGU = (typeof ADDONS !== 'undefined' && ADDONS.BufferGeometryUtils) || null;
    for (const [B, list] of byGroup) {
      const c = [...CL.values()].find((cc) => cc.near === B || cc.far === B);
      const parent = c ? (c.near === B ? c.gNear : c.gFar) : root;
      for (const g of list) { for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'uv' && k !== 'normal') g.deleteAttribute(k); if (g.index === null) { const n = g.attributes.position.count, idx = []; for (let i = 0; i < n; i++) idx.push(i); g.setIndex(idx); } }
      const merged = list.length === 1 ? list[0] : (BGU ? BGU.mergeGeometries(list, false) : list[0]);
      if (!merged) continue;
      own(merged);
      const mesh = new THREE.Mesh(merged, mat);
      mesh.name = 'cxb-boards'; mesh.receiveShadow = true; mesh.userData.guardSkip = true;
      parent.add(mesh);
    }
  }

  const jarG = (kind, seg) => (K.jarGeometry ? K.jarGeometry(kind, seg) : geo.cyl(0.25, 0.3, 0.7, seg));
  const lidG = (seg, rim) => (K.lidGeometry ? K.lidGeometry(seg, rim) : geo.cyl(0.3, 0.3, 0.06, seg));
  const jarTop = (kind) => (K.jarTop ? K.jarTop(kind) : 0.7);
  function jar(B, x, y, z, s, kind, raw, rnd) {
    const seg = low ? 7 : med ? 8 : 10;
    B.add(raw ? 'plaster' : 'glaze', jarG(kind, seg), M(x, y, z, rnd() * TAU, s), raw ? T.jarRaw : T.jar);
    if (!raw && rnd() < 0.55) B.add('glaze', lidG(seg, 0.29), M(x, y + jarTop(kind) * s - 0.01, z, 0, s), '#4e3220');
  }

  // ================================================================= 1. 한옥 마을
  const VILLAGE = C.byId('TERRACE_VILLAGE');
  const houses = C.elements.filter((e) => e.type === 'building' && e.kind === 'hanok' && /^B_VH\d+$/.test(e.id));
  const doors = [];
  const houseInfo = [];
  const grovePlan = [];
  if (houses.length) {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const e of houses) { const w = e.wall || { x0: e.x - e.w / 2, x1: e.x + e.w / 2, z0: e.z - e.d / 2, z1: e.z + e.d / 2 }; x0 = Math.min(x0, w.x0); x1 = Math.max(x1, w.x1); z0 = Math.min(z0, w.z0); z1 = Math.max(z1, w.z1); }
    const V = cluster('village', (x0 + x1) / 2, (z0 + z1) / 2, Math.hypot(x1 - x0, z1 - z0) / 2 + 4);
    houses.forEach((e, idx) => buildHouse(V, e, idx));
  }
  function buildHouse(Cv, e, idx) {
    const rnd = rngOf(9100 + idx * 37);
    const v = (e.variant | 0) % 3, w = e.w, d = e.d, y = fin(e.y) ? e.y : HY(e.x, e.z);
    const f = frame(e.x, y, e.z, e.rot || 0);
    const N = Cv.near, F = Cv.far;
    const baseH = 0.55, postTop = Math.max(2.9, (e.h || 3.2)), vd = v === 2 ? 0 : 1.15;
    const nb = Math.max(3, Math.round(w / 2.6)), bay = w / nb, fwz = d / 2 - vd;
    const wallTint = [T.plaster, '#efe6d6', '#f3eee6'][v], postTint = [T.post, '#9a6d47', '#b0835a'][v];
    const roofType = e.roof && e.roof.type === 'matbae' ? 'gable' : 'paljak';
    const ov = (e.roof && e.roof.overhang) || 1.3, rise = Math.max((e.roof && e.roof.h) || 2.6, (d / 2 + ov) * 0.66);
    const fine = !med;
    // ---- near: 기단, steps, floor, posts, beams, walls, roof, chimney, door plate
    box(N, 'stone', f, w + 1.8, baseH + 0.5, d + 1.6, 0, (baseH - 0.5) / 2, 0, T.stone);
    box(N, 'stone', f, w + 1.88, 0.07, d + 1.68, 0, baseH - 0.035, 0, T.coping);
    const dz = d / 2 + 0.8;
    for (let i = 0; i < 2; i++) { const top = (baseH * (i + 1)) / 3; box(N, 'stone', f, 2.4, top + 0.3, 0.42, 0, (top - 0.3) / 2, dz + 0.42 * (2 - i) - 0.21, '#d0cabd'); }
    box(N, 'stone', f, w + 0.2, 0.36, d + 0.2, 0, baseH + 0.18, 0, '#d8d1c4');
    if (vd > 0) {
      box(N, 'plank', f, w + 0.3, 0.1, vd + 0.25, 0, baseH + 0.31, d / 2 - vd / 2 + 0.06, '#d9b98c');
      beam(N, f, w + 0.3, 0.2, 0.15, 0, baseH + 0.18, d / 2 + 0.12, T.dark);
    }
    const posts = [];
    for (let i = 0; i <= nb; i++) { const lx = -w / 2 + i * bay; posts.push([lx, d / 2], [lx, -d / 2]); if (vd > 0) posts.push([lx, fwz]); }
    for (const z of [-d / 6, d / 6]) if (!(vd > 0 && z > fwz - 0.3)) posts.push([-w / 2, z], [w / 2, z]);
    const pr = w > 12 ? 0.16 : 0.145;
    for (const [lx, lz] of posts) post(N, f, lx, lz, baseH, postTop, pr, postTint, fine ? 10 : 8);
    for (const z of vd > 0 ? [d / 2, -d / 2, fwz] : [d / 2, -d / 2]) beam(N, f, w + 0.3, 0.3, 0.22, 0, postTop - 0.1, z, T.beam);
    for (const x of [-w / 2, w / 2]) beam(N, f, 0.22, 0.3, d + 0.3, x, postTop - 0.1, 0, T.beam);
    for (const z of [d / 2, -d / 2]) N.add('wood', geo.tube(-w / 2 - 0.5, y + postTop + 0.22, 0, w / 2 + 0.5, y + postTop + 0.22, 0, 0.12, 8), f.at(0, -y, z), T.beam);
    if (fine) for (const [lx, lz] of posts) if (Math.abs(lz) > d / 2 - 0.01) box(N, 'wood', f, 0.34, 0.22, 0.3, lx, postTop + 0.05, lz + Math.sign(lz) * 0.1, T.rafter);   // 주두 / 익공 blocks
    const wy0 = baseH + 0.36, wy1 = postTop - 0.2;
    const doorBays = nb % 2 ? [Math.floor(nb / 2)] : [nb / 2 - 1, nb / 2];
    const pats = ['ttisal', 'aja', 'jeongja'];
    for (let i = 0; i < nb; i++) {
      const xa = -w / 2 + i * bay + pr, xb = -w / 2 + (i + 1) * bay - pr;
      const kind = doorBays.includes(i) ? 'door' : 'window';
      wallBay(N, f, xa, fwz, xb, fwz, 0, kind, wy0, wy1, { wall: wallTint, pattern: pats[(v + i) % 3], fine });
      wallBay(N, f, xb, -d / 2, xa, -d / 2, PI, (i + v) % 2 ? 'window' : 'wall', wy0, wy1, { wall: wallTint, pattern: 'jeongja', fine });
    }
    const sideZ = [-d / 2, -d / 6, d / 6].filter((z) => !(vd > 0 && z > fwz - 0.3));
    sideZ.push(fwz);
    for (let j = 0; j < sideZ.length - 1; j++) {
      const za = sideZ[j] + pr, zb = sideZ[j + 1] - pr, kind = j === sideZ.length - 2 && zb - za > 1.6 ? 'window' : 'wall';
      wallBay(N, f, -w / 2, zb, -w / 2, za, -PI / 2, kind, wy0, wy1, { wall: wallTint, fine });
      wallBay(N, f, w / 2, za, w / 2, zb, PI / 2, kind, wy0, wy1, { wall: wallTint, fine });
    }
    if (v === 1 && vd > 0 && fine) {   // 계자 난간 along the 툇마루 ends
      for (const s of [-1, 1]) {
        const lx = s * (w / 2 - bay / 2);
        N.add('railing', geo.mquad(bay - 0.3, 0.55, 0, 0), f.at(lx, baseH + 0.62, d / 2 + 0.02));
        beam(N, f, bay - 0.3, 0.06, 0.08, lx, baseH + 0.9, d / 2 + 0.02, T.dark);
      }
    }
    const roofO = { mode: roofType, hw: w / 2, hd: d / 2, ov, rise, wallTop: postTop + 0.42, ridge: { w: 0.42, h: 0.42 } };
    nearRoof(N, f, roofO);
    // chimney (굴뚝) behind, at one end
    const chX = (v === 1 ? -1 : 1) * (w / 2 - 1.3), chZ = -d / 2 - 1.5;
    box(N, 'field', f, 0.85, 0.5, 0.85, chX, 0.15, chZ, '#e1dacd');
    box(N, 'plaster', f, 0.56, 1.95, 0.56, chX, 1.38, chZ, '#d6c2a2');
    for (let k = 0; k < 4; k++) box(N, 'stone', f, 0.6, 0.05, 0.6, chX, 0.75 + k * 0.42, chZ, '#cfc7b8');
    box(N, 'roof', f, 0.85, 0.1, 0.85, chX, 2.42, chZ, '#ffffff');
    colBox(f, chX, chZ, 0.45, 0.45, { tag: 'building' });
    // the door plate (문패)
    const plate = board(`한옥 ${idx + 1}호`, { bg: '#e8dcc1', bg2: '#d7c7a3', fg: '#3a2616', edge: '#7a5a3a' });
    addBoard(N, f, plate, -bay * 0.5 - 0.1, postTop - 0.55, fwz + 0.12, 0, 0.62, 0.16);

    // ---- the yard and its wall (plan `wall`)
    const W = e.wall;
    if (W) {
      const wy = y, wh = W.h || 1.4, gateX = e.door ? e.door.x : e.x;
      const fw = frame(0, wy, 0, 0);
      const seg = (ax, az, bx, bz, nearB) => {
        const L = Math.hypot(bx - ax, bz - az);
        if (L < 0.3) return;
        const cx = (ax + bx) / 2, cz = (az + bz) / 2, ry = Math.atan2(-(bz - az), bx - ax);
        const fr = frame(cx, wy, cz, ry);
        nearB.add('field', geo.box(L, wh - 0.18, 0.5, 'world'), fr.at(0, (wh - 0.18) / 2, 0), T.field);
        // the tiled coping: two little slopes and a ridge
        for (const s of [-1, 1]) nearB.add('roof', geo.box(L + 0.04, 0.07, 0.42), fr.at(0, wh - 0.1, s * 0.17, 0, 1, 1, 1, s * 0.42), '#ffffff');
        nearB.add('roof', geo.box(L + 0.06, 0.1, 0.12), fr.at(0, wh + 0.0, 0), '#ffffff');
        F.add('paint', geo.box(L, wh, 0.5), fr.at(0, wh / 2, 0), '#a2978a');
        ctx.addCollider({ shape: 'box', x: cx, z: cz, hw: L / 2, hd: 0.28, rot: ry, maxY: wy + wh + 0.05, stand: true, tag: 'stonewall' });
      };
      const gh = 0.95;   // half width of the gate opening
      seg(W.x0, W.z0, W.x1, W.z0, N); seg(W.x0, W.z0, W.x0, W.z1, N); seg(W.x1, W.z0, W.x1, W.z1, N);
      if (W.gate === 'south') { seg(W.x0, W.z1, gateX - gh - 0.2, W.z1, N); seg(gateX + gh + 0.2, W.z1, W.x1, W.z1, N); }
      else seg(W.x0, W.z1, W.x1, W.z1, N);
      void fw;
      // 일각문: two posts, a small tiled roof, the leaves standing open
      const fg = frame(gateX, wy, W.z1, 0);
      for (const s of [-1, 1]) { post(N, fg, s * (gh + 0.1), 0, 0, 2.35, 0.12, T.postDark, 8, true); colCircle(...fg.p(s * (gh + 0.1), 0), 0.2, { tag: 'post' }); }
      beam(N, fg, gh * 2 + 0.6, 0.18, 0.18, 0, 2.3, 0, T.dark);
      if (!low) {
        const gr = { mode: 'gable', hw: gh + 0.4, hd: 0.55, ov: 0.45, rise: 0.75, wallTop: 2.42, ridge: { w: 0.26, h: 0.24 }, vres: 0.6, seg: 0.6 };
        nearRoof(N, fg, gr);
        for (const s of [-1, 1]) leaf(N, fg, s * gh, -0.05, gh * 0.95, 2.0, 0.1, 1.3, s, '#8d6b4a');
      }
      F.add('paint', geo.box(gh * 2 + 0.8, 0.5, 1.2), fg.at(0, 2.5, 0), T.roofFar);
      // yard things (near only): 장독대 in a back corner, then by variant a 평상, a woodpile, a well; a flower bed
      const sx = idx % 2 ? -1 : 1, jx = e.x + sx * (w / 2 - 0.4), jz = W.z0 + 1.5;
      if (fine || med) {
        box(N, 'stone', frame(jx, wy, jz), 3.0, 0.42, 1.7, 0, 0.21, 0, '#c8c1b4');
        const kinds = ['hangari', 'dok', 'danji'];
        let n = 0;
        for (let r = 0; r < 2; r++) for (let c = 0; c < 4; c++) {
          if (rnd() < 0.18) continue;
          const kind = kinds[(c + r + idx) % 3], s = kind === 'dok' ? 0.95 : kind === 'danji' ? 0.6 : 0.78;
          jar(N, jx - 1.1 + c * 0.74 + (rnd() - 0.5) * 0.08, wy + 0.42, jz - 0.38 + r * 0.76, s * (0.92 + rnd() * 0.12), kind, false, rnd);
          n++;
        }
        ctx.addCollider({ shape: 'box', x: jx, z: jz, hw: 1.55, hd: 0.9, maxY: wy + 1.25, stand: false, tag: 'jars' });
        void n;
      }
      F.add('paint', geo.box(3.0, 0.9, 1.7), M(jx, wy + 0.45, jz), '#6a4a34');
      const yx = e.x - sx * (w / 2 - 1.2), yz = W.z1 - 2.6;
      if (v === 1) {   // 평상
        const fp = frame(yx, wy, yz, 0.05);
        box(N, 'plank', fp, 1.9, 0.08, 1.3, 0, 0.42, 0, '#c59a6a');
        for (const a of [-1, 1]) for (const b of [-1, 1]) box(N, 'wood', fp, 0.08, 0.4, 0.08, a * 0.85, 0.2, b * 0.55, T.dark);
        box(N, 'paint', fp, 0.9, 0.04, 0.6, 0.3, 0.48, 0.1, '#b9483c');
        ctx.addCollider({ shape: 'box', x: yx, z: yz, hw: 0.95, hd: 0.65, rot: 0.05, maxY: wy + 0.46, stand: true, tag: 'bench' });
      } else if (v === 2) {   // 장작더미 against the side wall
        const fp = frame(e.x + sx * (W.x1 - W.x0) / 2 - sx * 0.6, wy, (W.z0 + W.z1) / 2 + 1, PI / 2);
        for (let r = 0; r < 4; r++) for (let c = 0; c < 9; c++) N.add('wood', geo.cyl(0.07, 0.07, 0.6, 6), fp.at(-1.1 + c * 0.16 + (r % 2) * 0.08, 0.08 + r * 0.14, 0, 0, 1, 1, 1, PI / 2), r % 2 ? '#9a7550' : '#8a6845');
        box(N, 'roof', fp, 1.8, 0.06, 0.9, 0, 0.78, 0, '#ffffff');
        ctx.addCollider({ shape: 'box', x: fp.x, z: fp.z, hw: 0.45, hd: 0.9, rot: PI / 2, maxY: wy + 0.7, stand: true, tag: 'pile' });
      } else {   // 우물: a round stone well with a wooden lid
        N.add('stone', geo.cyl(0.62, 0.66, 0.72, low ? 8 : 16, false), M(yx, wy + 0.36, yz), '#b9b2a6');
        N.add('plank', geo.cyl(0.66, 0.66, 0.06, low ? 8 : 16), M(yx, wy + 0.75, yz), '#8c6a46');
        if (fine) { box(N, 'wood', frame(yx, wy, yz), 0.08, 1.7, 0.08, -0.72, 0.85, 0, T.dark); box(N, 'wood', frame(yx, wy, yz), 0.08, 1.7, 0.08, 0.72, 0.85, 0, T.dark); beam(N, frame(yx, wy, yz), 1.6, 0.08, 0.08, 0, 1.7, 0, T.dark); }
        colCircle(yx, yz, 0.72, { maxY: wy + 0.78, stand: true, tag: 'low' });
      }
      // a flower bed by the house front and a tree in the yard
      if (fine) for (let k = 0; k < 7; k++) N.add('paint', new THREE.SphereGeometry(0.16 + rnd() * 0.08, 6, 4), M(e.x + sx * 1.6 + k * 0.42 * sx, wy + 0.18, e.z + d / 2 + 1.95 + (rnd() - 0.5) * 0.2), ['#d9467a', '#f2c94c', '#e8eadf', '#9b5ccf', '#4f7d3a'][k % 5]);
      grovePlan.push({ x: e.x + sx * (w / 2 + 2.2), z: W.z1 - 1.6, y: wy, species: idx % 3 === 1 ? 'oak' : 'gardenPine', scale: idx % 3 === 1 ? 0.5 : 0.62 + rnd() * 0.12, rot: rnd() * TAU });
    }
    // ---- far: body, base, hanji strip, roof
    box(F, 'paint', f, w + 1.8, baseH + 0.5, d + 1.6, 0, (baseH - 0.5) / 2, 0, '#bdb6aa');
    box(F, 'paint', f, w, postTop - baseH, d, 0, (baseH + postTop) / 2, vd > 0 ? -vd / 2 : 0, wallTint);
    if (vd > 0) box(F, 'paint', f, w, postTop - baseH, vd, 0, (baseH + postTop) / 2, d / 2 - vd / 2, '#7d5c40');
    F.add('hanji', geo.quad(w - 1.0, 1.1, [0, 0, 1, 1]), f.at(0, baseH + 1.4, fwz + 0.01));
    roofFar(F, f, { mode: roofType, hw: w / 2, hd: d / 2, ov, rise, y: postTop + 0.3, wallTop: postTop + 0.42 });
    // ---- colliders, walkables, blocker, the door
    colBox(f, 0, vd > 0 ? -vd / 2 : 0, w / 2 + 0.22, (d - vd) / 2 + 0.22, { tag: 'building' });
    walkBox(f, 0, 0, w / 2 + 0.9, d / 2 + 0.8, y + baseH, 'stone');
    if (vd > 0) walkBox(f, 0, d / 2 - vd / 2 + 0.06, w / 2 + 0.15, vd / 2 + 0.12, y + baseH + 0.36, 'wood');
    addBlocker(f, 0, baseH, vd > 0 ? -vd / 2 : 0, w + 0.3, postTop - baseH + 0.4, d - vd + 0.3);
    const dx = e.door ? e.door.x : e.x, dzW = e.z + fwz + 0.9;
    const spec = { ctx, x: dx, z: dzW, y: y + baseH + 1.2, rotY: 0, id: `CX_${e.id}_ROOM`, label: `🏠 ${e.name || '한옥'} — 내 방 들어가기`, kidLabel: '내 방 가기', radius: 3.2 };
    let handle = null;
    try { handle = G.sys.myroom?.doorAt?.(spec) || null; } catch (err) { handle = null; G.log.warn('WORLD', 'complex-buildings: 내 방 door failed', err?.message || err); }
    if (!handle) {
      handle = ctx.interact({
        id: `CX_${e.id}_ROOM`, kind: 'door', label: `🏠 ${e.name || '한옥'} 방`, kidLabel: '방 들어가 보기', emoji: '🏠', radius: 3.2, priority: 0.5,
        position: { x: dx, y: y + baseH + 1.2, z: dzW },
        onInteract: () => { try { G.ui?.toast?.('이 한옥의 방은 곧 문을 열어요. 조금만 기다려 주세요!', { emoji: '🏠', type: 'info' }); G.easy?.say?.('이 방은 곧 문을 열어요. 조금만 기다려 줘요.'); } catch (err) { /* cosmetic */ } },
      });
    }
    doors.push({ id: `CX_${e.id}_ROOM`, kind: 'room', x: dx, y: y + baseH, z: dzW, room: !!G.sys.myroom?.doorAt });
    houseInfo.push({ id: e.id, x: e.x, z: e.z, y, w, d, variant: v, roof: roofType, door: { x: dx, z: dzW, y: y + baseH } });
  }

  // ================================================================= 2. the corridor (회랑) and 3. the pavilion (정자)
  const COR = C.byId('CORRIDOR'), PAV = C.byId('B_PAVILION'), KNOLL = C.byId('KNOLL'), MAIN = C.byId('B_MAIN');
  let deckApi = null, pavApi = null;
  if (COR && Array.isArray(COR.pts) && COR.pts.length >= 2) {
    const pts = COR.pts.map((p) => [p[0], p[1]]);
    let len = 0; const cum = [0];
    for (let i = 1; i < pts.length; i++) { len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); cum.push(len); }
    const xs = pts.map((p) => p[0]), zs = pts.map((p) => p[1]);
    const Cc = cluster('corridor', (Math.min(...xs) + Math.max(...xs) + (PAV ? PAV.x * 2 : 0)) / (PAV ? 4 : 2), (Math.min(...zs) + Math.max(...zs) + (PAV ? PAV.z * 2 : 0)) / (PAV ? 4 : 2), len / 2 + 12);
    const N = Cc.near, F = Cc.far;
    const y0 = MAIN && fin(MAIN.y) ? MAIN.y + (MAIN.podium || 1.62) : HY(pts[0][0], pts[0][1]) + 1.8;
    const pavFloor = PAV ? (fin(PAV.y) ? PAV.y : HY(PAV.x, PAV.z)) + 0.3 : y0;
    const y1 = pavFloor;
    const W = COR.w || 4.4, HH = COR.h || 3.4, RO = COR.roof || { h: 1.6, overhang: 0.9 }, every = COR.postEvery || 3;
    const yAt = (s) => lerp(y0, y1, clamp(s / len, 0, 1));
    const at = (s) => { s = clamp(s, 0, len); let i = 1; while (i < cum.length - 1 && cum[i] < s) i++; const t = (s - cum[i - 1]) / (cum[i] - cum[i - 1] || 1); return { x: lerp(pts[i - 1][0], pts[i][0], t), z: lerp(pts[i - 1][1], pts[i][1], t), y: yAt(s), seg: i - 1 }; };
    deckApi = { pts, y0, y1, len, yAt, at, w: W };
    const hw = W / 2 - 0.25;   // posts / rails stand this far off the centre line
    // the landing on the terrace edge (54 leaves a 4.8 m gap in the terrace edge round the corridor's first point)
    {
      const p0 = pts[0];
      const fl = frame(p0[0], y0, p0[1] + 1.0, 0);
      box(N, 'plank', fl, W, 0.16, 2.4, 0, -0.08, 0, T.deck);
      box(F, 'paint', fl, W, 0.16, 2.4, 0, -0.08, 0, T.deck);
      walkBox(fl, 0, 0, W / 2, 1.3, y0, 'wood');
      ctx.addCollider({ shape: 'box', x: p0[0] - W / 2 + 0.05, z: p0[1] + 1.2, hw: 0.1, hd: 1.2, minY: y0 - 0.3, maxY: y0 + 1.0, stand: false, tag: 'rail' });
    }
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1], L = cum[i + 1] - cum[i];
      const ux = (b[0] - a[0]) / L, uz = (b[1] - a[1]) / L, ry = Math.atan2(-uz, ux);
      const mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2, ym = yAt((cum[i] + cum[i + 1]) / 2);
      const fs = frame(mx, ym, mz, ry);
      const ext0 = i === 0 ? 0 : W / 2, ext1 = i === pts.length - 2 ? 0 : W / 2;
      const Lx = L + ext0 + ext1, cxo = (ext1 - ext0) / 2;
      const slope = Math.atan2(yAt(cum[i + 1]) - yAt(cum[i]), L);
      // deck: planks with a fascia board and two joists, tilted with the rise
      box(N, 'plank', fs, Lx, 0.12, W, cxo, -0.06, 0, T.deck, 0, 'world', 0, slope);
      for (const s of [-1, 1]) box(N, 'wood', fs, Lx, 0.28, 0.16, cxo, -0.26, s * (W / 2 - 0.08), T.deckDark, 0, 'grain', 0, slope);
      box(F, 'paint', fs, Lx, 0.4, W, cxo, -0.2, 0, T.deckDark, 0, 'world', 0, slope);
      // posts every `every` metres on both sides, from the ground to the roof beam (stone bases on the ground)
      const n = Math.max(1, Math.round(L / every));
      for (let k = 0; k <= n; k++) {
        if (i > 0 && k === 0) continue;
        const s = cum[i] + (L * k) / n, p = at(s), yd = yAt(s);
        for (const sd of [-1, 1]) {
          const qx = p.x + uz * sd * hw, qz = p.z - ux * sd * hw;
          const g = HY(qx, qz);
          const top = yd + HH;
          N.add('stone', geo.cyl(0.26, 0.3, 0.3, 8), M(qx, g + 0.1, qz), T.stone);
          N.add('wood', geo.cyl(0.13, 0.145, top - g - 0.2, med ? 8 : 10), M(qx, (g + 0.2 + top) / 2, qz), T.post);
          F.add('paint', geo.box(0.28, top - g, 0.28), M(qx, (g + top) / 2, qz), T.post);
          if (yd - g > 1.0) colCircle(qx, qz, 0.24, { tag: 'post' });
          else colCircle(qx, qz, 0.2, { tag: 'post', minY: yd - 0.2 });
        }
        // a cross beam under the deck and a brace pair (the bridge's trestle)
        if (!low) {
          const g0 = HY(p.x, p.z);
          if (yd - g0 > 1.2) {
            const fb = frame(p.x, yd, p.z, ry);
            box(N, 'wood', fb, 0.2, 0.26, W - 0.1, 0, -0.45, 0, T.deckDark, 0, 'grain');
            if (!med) for (const sd of [-1, 1]) N.add('wood', geo.beam(...[p.x + uz * sd * hw, Math.max(g0 + 0.6, yd - 2.2), p.z - ux * sd * hw], ...[p.x - uz * sd * hw * 0.1, yd - 0.55, p.z + ux * sd * hw * 0.1], 0.12, 0.12), I4, T.deckDark);
          }
        }
      }
      // upper beams (창방 + 도리), roof
      for (const sd of [-1, 1]) {
        box(N, 'wood', fs, Lx, 0.26, 0.2, cxo, HH - 0.13, sd * hw, T.beam, 0, 'grain', 0, slope);
        box(F, 'paint', fs, Lx, 0.3, 0.24, cxo, HH - 0.15, sd * hw, T.beam, 0, 'world', 0, slope);
      }
      const ro = { mode: 'gable', hw: Lx / 2, hd: W / 2, ov: RO.overhang || 0.9, rise: RO.h || 1.6, ridge: { w: 0.34, h: 0.32 }, seg: med ? 0.45 : 0.6, vres: 0.6 };
      const frR = frame(mx + ux * cxo, ym, mz + uz * cxo, ry);
      nearRoof(N, frR, Object.assign({ wallTop: HH + 0.18 }, ro));
      farRoof(F, frR, { mode: 'gable', hw: Lx / 2, hd: W / 2, ov: ro.ov, rise: ro.rise, y: HH + 0.1 });
      // railings: a 계자난간 run on both sides (alpha card + top rail), colliders only at deck height
      const r0 = i === 0 ? 1.6 : 0, r1 = i === pts.length - 2 ? L - 1.2 : L;
      const rl = r1 - r0, rc = (r0 + r1) / 2 - L / 2;
      for (const sd of [-1, 1]) {
        if (!low) {
          N.add('railing', geo.mquad(rl, 0.78, 0, 0), fs.at(rc, 0.42, sd * (hw - 0.02), 0, 1, 1, 1, 0, slope));
          box(N, 'wood', fs, rl, 0.08, 0.11, rc, 0.86, sd * (hw - 0.02), T.dark, 0, 'grain', 0, slope);
        }
        const c = fs.p(rc, sd * (hw - 0.02));
        ctx.addCollider({ shape: 'box', x: c[0], z: c[1], hw: rl / 2, hd: 0.12, rot: ry, minY: ym - 0.25, maxY: ym + 1.0, stand: false, tag: 'rail' });
      }
      // walkable deck: pieces of ≤ 3 m, each at its own height
      const np = Math.max(1, Math.ceil(L / 3));
      for (let k = 0; k < np; k++) {
        const s0 = cum[i] + (L * k) / np, s1 = cum[i] + (L * (k + 1)) / np, pm = at((s0 + s1) / 2);
        ctx.addWalkable({ shape: 'box', x: pm.x, z: pm.z, hw: (s1 - s0) / 2 + 0.05, hd: W / 2 - 0.12, rot: ry, top: yAt((s0 + s1) / 2), surface: 'wood' });
      }
      if (i > 0) ctx.addWalkable({ shape: 'circle', x: a[0], z: a[1], r: W / 2 - 0.12, top: yAt(cum[i]), surface: 'wood' });
    }
    // lanterns (청사초롱) hang under the roof every other bay; their lights are the plan's lamps (53)
    if (!low) {
      for (let s = 4; s < len - 2; s += every * 3) {
        const p = at(s);
        N.add('glow', geo.cyl(0.13, 0.13, 0.36, 8), M(p.x, p.y + HH - 0.75, p.z), '#5a8fd0');
        N.add('glow', geo.cyl(0.135, 0.135, 0.12, 8), M(p.x, p.y + HH - 0.75, p.z), '#d84c3a');
        N.add('metal', geo.cyl(0.01, 0.01, 0.42, 4), M(p.x, p.y + HH - 0.35, p.z), T.iron);
      }
    }

    // ---- the pavilion
    if (PAV) {
      const py = fin(PAV.y) ? PAV.y : HY(PAV.x, PAV.z);
      const fp = frame(PAV.x, py, PAV.z, PAV.rot || 0);
      const hwP = (PAV.w || 9) / 2, base = 0.3, low1 = 3.0, upFloor = base + 3.6, upTop = upFloor + 2.5, inset = Math.min(3.2, hwP - 1.3);
      // platform, steps (north and towards the corridor)
      box(N, 'stone', fp, hwP * 2 + 1.4, base + 0.6, hwP * 2 + 1.4, 0, (base - 0.6) / 2, 0, T.stone);
      box(N, 'stone', fp, hwP * 2 + 1.46, 0.06, hwP * 2 + 1.46, 0, base - 0.03, 0, T.coping);
      box(F, 'paint', fp, hwP * 2 + 1.4, base + 0.6, hwP * 2 + 1.4, 0, (base - 0.6) / 2, 0, '#bdb6aa');
      walkBox(fp, 0, 0, hwP + 0.7, hwP + 0.7, py + base, 'wood');
      box(N, 'plank', fp, hwP * 2 + 0.2, 0.06, hwP * 2 + 0.2, 0, base + 0.03, 0, '#c49b6c');
      // posts: outer ring (lower storey) and inner ring (both storeys)
      const outer = [], inner = [];
      for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
        const lx = -hwP + (2 * hwP * i) / 3, lz = -hwP + (2 * hwP * j) / 3;
        if (i === 0 || i === 3 || j === 0 || j === 3) outer.push([lx, lz]);
      }
      for (const a of [-inset, inset]) for (const b of [-inset, inset]) inner.push([a, b]);
      for (const [lx, lz] of outer) { post(N, fp, lx, lz, base, low1, 0.17, T.post, med ? 8 : 12); const q = fp.p(lx, lz); colCircle(q[0], q[1], 0.24, { tag: 'post' }); }
      for (const [lx, lz] of inner) { post(N, fp, lx, lz, base, upTop, 0.19, T.post, med ? 8 : 12); const q = fp.p(lx, lz); colCircle(q[0], q[1], 0.26, { tag: 'post' }); }
      for (const [lx, lz] of outer.concat(inner)) box(F, 'paint', fp, 0.34, (inner.some((q) => q[0] === lx && q[1] === lz) ? upTop : low1) - base, 0.34, lx, (base + (inner.some((q) => q[0] === lx && q[1] === lz) ? upTop : low1)) / 2, lz, T.post);
      for (const s of [-1, 1]) { beam(N, fp, hwP * 2 + 0.3, 0.3, 0.24, 0, low1 - 0.1, s * hwP, T.beam); beam(N, fp, 0.24, 0.3, hwP * 2 + 0.3, s * hwP, low1 - 0.1, 0, T.beam); }
      if (!med && !low) for (const s of [-1, 1]) { box(N, 'paint', fp, hwP * 2, 0.1, 0.02, 0, low1 - 0.08, s * (hwP + 0.13), '#2f7a68'); box(N, 'paint', fp, 0.02, 0.1, hwP * 2, s * (hwP + 0.13), low1 - 0.08, 0, '#2f7a68'); }
      // skirt roof round the lower storey (the first of the two tiers)
      const skirt = { mode: 'skirt', hw: hwP, hd: hwP, ov: 1.25, rise: 2.0, vs: 0.42, out: 0.45, lift: 0.5, wallTop: low1 + 0.25, ridge: { w: 0.3, h: 0.3 } };
      nearRoof(N, fp, skirt);
      roofFar(F, fp, { mode: 'hip', kit: skirt, hw: hwP, hd: hwP, ov: 1.25, rise: 1.2, y: low1 + 0.2 });
      // upper floor (balcony inside the skirt) with the stairwell open, 계자난간 round it
      const stair = { x0: -2.0, x1: 2.6, z0: inset - 1.35, z1: inset - 0.15, n: 11 };   // the stair runs up from +x to −x along z ∈ [z0, z1]
      box(N, 'plank', fp, inset * 2 + 0.6, 0.14, stair.z0 + inset + 0.3, 0, upFloor - 0.07, (stair.z0 - inset - 0.3) / 2, '#c49b6c');
      box(N, 'plank', fp, stair.x0 + inset + 0.3, 0.14, inset + 0.3 - stair.z0, (stair.x0 - inset - 0.3) / 2, upFloor - 0.07, (stair.z0 + inset + 0.3) / 2, '#c49b6c');
      box(F, 'paint', fp, inset * 2 + 0.6, upTop - upFloor, inset * 2 + 0.6, 0, (upFloor + upTop) / 2, 0, '#7b5a3e');
      walkBox(fp, 0, (stair.z0 - inset - 0.3) / 2, inset + 0.3, (stair.z0 + inset + 0.3) / 2, py + upFloor, 'wood');
      walkBox(fp, (stair.x0 - inset - 0.3) / 2, (stair.z0 + inset + 0.3) / 2, (stair.x0 + inset + 0.3) / 2, (inset + 0.3 - stair.z0) / 2, py + upFloor, 'wood');
      // the stair: steps as walkables, side boards, colliders that keep floor walkers out from the side / the high end
      const rise = (upFloor - base) / stair.n, run = (stair.x1 - stair.x0) / stair.n, sw = (stair.z1 - stair.z0) / 2, scz = (stair.z0 + stair.z1) / 2;
      for (let k = 0; k < stair.n; k++) {
        const lx = stair.x1 - run * (k + 0.5), top = base + rise * (k + 1);
        box(N, 'plank', fp, run + 0.02, 0.06, sw * 2, lx, top - 0.03, scz, '#b88d5e');
        walkBox(fp, lx, scz, run / 2 + 0.01, sw - 0.05, py + top, 'wood');
      }
      for (const sd of [-1, 1]) {
        const g = new THREE.BufferGeometry(), zf = scz + sd * sw;
        g.setAttribute('position', new THREE.Float32BufferAttribute([stair.x1, base, zf, stair.x0, upFloor - 0.3, zf, stair.x0, upFloor, zf, stair.x1, base + 0.3, zf], 3));
        g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
        g.setIndex(sd > 0 ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2]); g.computeVertexNormals();
        N.add('wood', g, fp.m, T.dark);
        const c = fp.p((stair.x0 + stair.x1) / 2, zf);
        ctx.addCollider({ shape: 'box', x: c[0], z: c[1], hw: (stair.x1 - stair.x0) / 2, hd: 0.06, rot: fp.rot, minY: py + base, maxY: py + base + 1.8, stand: false, tag: 'rail' });
      }
      { const c = fp.p(stair.x0 + 0.6, scz); ctx.addCollider({ shape: 'box', x: c[0], z: c[1], hw: 0.6, hd: sw, rot: fp.rot, minY: py + base - 0.1, maxY: py + base + 1.75, stand: false, tag: 'rail' }); }
      // railings round the upper floor and round the stairwell (upper level only)
      const railU = (ax, az, bx, bz) => {
        const L2 = Math.hypot(bx - ax, bz - az), cx = (ax + bx) / 2, cz = (az + bz) / 2, ryL = Math.atan2(-(bz - az), bx - ax);
        if (!low) {
          N.add('railing', geo.mquad(L2, 0.72, 0, 0), fp.at(cx, upFloor + 0.38, cz, ryL));
          N.add('wood', geo.box(L2, 0.08, 0.1, 'grain'), fp.at(cx, upFloor + 0.78, cz, ryL), T.dark);
        }
        const c = fp.p(cx, cz);
        ctx.addCollider({ shape: 'box', x: c[0], z: c[1], hw: L2 / 2 + 0.05, hd: 0.1, rot: fp.rot + ryL, minY: py + upFloor - 0.2, maxY: py + upFloor + 0.95, stand: false, tag: 'rail' });
      };
      const e2 = inset + 0.28;
      railU(-e2, -e2, e2, -e2); railU(e2, -e2, e2, e2); railU(e2, e2, -e2, e2); railU(-e2, e2, -e2, -e2);
      railU(stair.x0, stair.z0, stair.x1 + 0.2, stair.z0); railU(stair.x1 + 0.2, stair.z0, stair.x1 + 0.2, stair.z1 + 0.15);
      // upper storey: beams, hanging 낙양 boards, the top roof (팔작)
      for (const s of [-1, 1]) { beam(N, fp, inset * 2 + 0.3, 0.3, 0.24, 0, upTop - 0.1, s * inset, T.beam); beam(N, fp, 0.24, 0.3, inset * 2 + 0.3, s * inset, upTop - 0.1, 0, T.beam); }
      const topR = { mode: 'paljak', hw: inset, hd: inset, ov: (PAV.roof && PAV.roof.overhang) || 1.8, rise: Math.min(3.8, (PAV.roof && PAV.roof.h) || 4.5), out: 0.6, lift: 0.6, wallTop: upTop + 0.4, ridge: { w: 0.4, h: 0.4 } };
      nearRoof(N, fp, topR);
      roofFar(F, fp, { mode: 'paljak', hw: inset, hd: inset, ov: topR.ov, rise: topR.rise, y: upTop + 0.35, wallTop: upTop + 0.4 });
      const pb = board(PAV.name || '정자', { bg: '#2f3d52', bg2: '#1f2a3a', fg: '#f3e2b5', edge: '#d0a85a' });
      addBoard(N, fp, pb, 0, low1 - 0.55, -hwP - 0.14, PI, 1.2, 0.36);
      // a low table and two cushions upstairs, a lantern
      if (!low) {
        box(N, 'wood', fp, 1.0, 0.06, 0.6, -0.6, upFloor + 0.3, -1.2, '#7a4f2e');
        for (const a of [-1, 1]) for (const b of [-1, 1]) box(N, 'wood', fp, 0.05, 0.28, 0.05, -0.6 + a * 0.42, upFloor + 0.14, -1.2 + b * 0.24, '#5c3b22');
        for (const s of [-1, 1]) box(N, 'paint', fp, 0.55, 0.08, 0.55, -0.6 + s * 0.9, upFloor + 0.04, -1.2, '#9c3b2e');
        N.add('glow', geo.cyl(0.16, 0.16, 0.42, 8), fp.at(0, upTop - 0.65, 0), '#e9c27a');
      }
      ctx.addCollider({ shape: 'box', x: fp.p(-0.6, -1.2)[0], z: fp.p(-0.6, -1.2)[1], hw: 0.52, hd: 0.32, rot: fp.rot, minY: py + upFloor - 0.1, maxY: py + upFloor + 0.34, stand: true, tag: 'table' });
      ctx.interact({
        id: 'CX_PAVILION_VIEW', kind: 'view', label: '🌄 정자에서 단지 바라보기', kidLabel: '경치 보기', emoji: '🌄', radius: 2.6, priority: 0.4,
        position: { x: fp.p(0, -inset + 0.8)[0], y: py + upFloor + 1.2, z: fp.p(0, -inset + 0.8)[1] },
        onInteract: () => { try { G.ui?.toast?.('정자 위에서는 큰 장독대와 본관, 산이 한눈에 보여요. 옛날에는 이런 곳에서 쉬며 바람을 쐬었대요.', { emoji: '🌄', type: 'info' }); G.easy?.say?.('정자 위에서 큰 장독대가 한눈에 보여요.'); } catch (err) { /* cosmetic */ } },
      });
      if (!low) ctx.light?.({ x: PAV.x, y: py + upTop - 0.7, z: PAV.z, color: 0xffc07a, intensity: 4, distance: 10, decay: 2, flicker: 0.05, day: 0 });
      pavApi = { x: PAV.x, z: PAV.z, y: py, floor: py + base, upper: py + upFloor, stair: Object.assign({}, stair, { bottom: fp.p(stair.x1 + 0.4, scz), top: fp.p(stair.x0 - 0.4, scz) }), inset };
      grovePlan.push({ x: PAV.x + hwP + 3.5, z: PAV.z + 2.5, species: 'maple', scale: 0.7 }, { x: PAV.x - hwP - 2.8, z: PAV.z + 3.6, species: 'gardenPine', scale: 0.75 });
    }
  }

  // ================================================================= 4. the gate house (솟을대문)
  const GATE = C.byId('B_GATE');
  if (GATE) {
    const Cg = cluster('gate', GATE.x, GATE.z, Math.hypot(GATE.w, GATE.d) / 2 + 3);
    const N = Cg.near, F = Cg.far;
    const y = fin(GATE.y) ? GATE.y : HY(GATE.x, GATE.z);
    const f = frame(GATE.x, y, GATE.z, GATE.rot || 0);
    const hw = GATE.w / 2, hd = GATE.d / 2, pw = ((GATE.passage && GATE.passage.w) || 4.2) / 2, H = GATE.h || 4.6;
    const sideW = hw - pw, base = 0.42, wallTop = H - 0.9;
    for (const s of [-1, 1]) {
      const cx = s * (pw + sideW / 2);
      box(N, 'stone', f, sideW + 0.5, base + 0.5, GATE.d + 0.5, cx, (base - 0.5) / 2, 0, T.stone);
      box(F, 'paint', f, sideW + 0.5, base + 0.5, GATE.d + 0.5, cx, (base - 0.5) / 2, 0, '#bdb6aa');
      for (const [lx, lz] of [[s * hw, hd], [s * hw, -hd], [s * (pw + sideW / 2), hd], [s * (pw + sideW / 2), -hd], [s * hw, 0]]) post(N, f, lx, lz, base, wallTop, 0.15, T.postDark, 10);
      // walls: front and back of each room with a small window, the outer gable wall
      wallBay(N, f, s > 0 ? pw + 0.15 : -hw + 0.15, hd, s > 0 ? hw - 0.15 : -pw - 0.15, hd, 0, 'window', base, wallTop, { wall: T.plasterWarm, pattern: 'jeongja', fine: !med });
      wallBay(N, f, s > 0 ? hw - 0.15 : -pw - 0.15, -hd, s > 0 ? pw + 0.15 : -hw + 0.15, -hd, PI, 'wall', base, wallTop, { wall: T.plasterWarm });
      wallBay(N, f, s * hw, s > 0 ? -hd + 0.15 : hd - 0.15, s * hw, s > 0 ? hd - 0.15 : -hd + 0.15, s * PI / 2, 'wall', base, wallTop, { wall: T.plasterWarm });
      wallBay(N, f, s * pw, s > 0 ? hd - 0.15 : -hd + 0.15, s * pw, s > 0 ? -hd + 0.15 : hd - 0.15, -s * PI / 2, 'wall', base, wallTop, { wall: T.plasterWarm });
      box(F, 'paint', f, sideW, wallTop - base, GATE.d, cx, (base + wallTop) / 2, 0, T.plasterWarm);
      beam(N, f, sideW + 0.3, 0.28, 0.22, cx, wallTop, hd, T.beam); beam(N, f, sideW + 0.3, 0.28, 0.22, cx, wallTop, -hd, T.beam);
      const sr = { mode: 'gable', hw: sideW / 2 + 0.05, hd, ov: (GATE.roof && GATE.roof.overhang) || 1.4, rise: 2.0, lx: cx, wallTop: wallTop + 0.35, ridge: { w: 0.36, h: 0.34 }, vres: 0.7 };
      nearRoof(N, f, sr);
      const pc = f.p(cx, 0);
      roofFar(F, frame(pc[0], y, pc[1], f.rot), { mode: 'gable', hw: sideW / 2 + 0.05, hd, ov: sr.ov, rise: 2.0, y: wallTop + 0.25, wallTop: wallTop + 0.35 });
      colBox(f, cx, 0, sideW / 2 + 0.2, hd + 0.25, { tag: 'building' });
      addBlocker(f, cx, base, 0, sideW + 0.3, wallTop - base + 0.3, GATE.d + 0.3);
    }
    // the passage: threshold, paving, the raised middle roof on tall posts, the two leaves standing open inward
    const midTop = H + 0.15;
    for (const [lx, lz] of [[-pw, hd], [pw, hd], [-pw, -hd], [pw, -hd], [-pw, 0], [pw, 0]]) post(N, f, lx, lz, 0, midTop, 0.17, T.postDark, 10, true);
    box(N, 'stone', f, pw * 2, 0.08, GATE.d + 0.6, 0, 0.04, 0, '#c9c2b5');
    box(N, 'wood', f, pw * 2, 0.22, 0.24, 0, 0.11, 0, T.dark, 0, 'grain');
    walkBox(f, 0, 0, pw - 0.1, hd + 0.3, y + 0.08, 'stone');
    for (const s of [-1, 1]) leaf(N, f, s * (pw - 0.1), -0.1, pw - 0.15, midTop - 0.9, 0.25, 1.45, s, '#7e5c3c');
    for (const s of [-1, 1]) { beam(N, f, pw * 2 + 0.3, 0.3, 0.24, 0, midTop - 0.12, s * hd, T.beam); }
    const mr = { mode: 'gable', hw: pw + 0.35, hd, ov: (GATE.roof && GATE.roof.overhang) || 1.4, rise: (GATE.roof && GATE.roof.h) || 2.8, wallTop: midTop + 0.32, ridge: { w: 0.42, h: 0.42 } };
    nearRoof(N, f, mr);
    roofFar(F, f, { mode: 'gable', hw: pw + 0.35, hd, ov: mr.ov, rise: mr.rise, y: midTop + 0.25, wallTop: midTop + 0.32 });
    for (const [lx, lz] of [[-pw, hd], [pw, hd], [-pw, -hd], [pw, -hd]]) { const q = f.p(lx, lz); colCircle(q[0], q[1], 0.24, { tag: 'post' }); F.add('paint', geo.box(0.34, midTop, 0.34), M(q[0], y + midTop / 2, q[1]), T.postDark); }
    const gb = board(GATE.name || '장독대 정문', { bg: '#4a2e1b', bg2: '#2f1c10', fg: '#f6e3b0', edge: '#d1a95b' });
    addBoard(N, f, gb, 0, midTop - 0.6, hd + 0.16, 0, 1.8, 0.45);
    // lanterns at the front posts
    for (const s of [-1, 1]) {
      const q = f.p(s * (pw - 0.35), hd + 0.35);
      N.add('glow', geo.cyl(0.15, 0.15, 0.42, 8), M(q[0], y + midTop - 1.1, q[1]), '#cf4836');
      N.add('glow', geo.cyl(0.155, 0.155, 0.1, 8), M(q[0], y + midTop - 0.86, q[1]), '#4f7fc4');
    }
    if (!low) { const q = f.p(0, hd + 0.6); ctx.light?.({ x: q[0], y: y + midTop - 1.2, z: q[1], color: 0xffb46a, intensity: 6, distance: 12, decay: 2, flicker: 0.05, day: 0 }); }
  }

  // ================================================================= 5. the café (카페) with its terrace
  const CAFE = C.byId('B_CAFE');
  if (CAFE) {
    const Cf = cluster('cafe', CAFE.x, CAFE.z + 2, Math.hypot(CAFE.w, CAFE.d + 6) / 2 + 3);
    const N = Cf.near, F = Cf.far;
    const y = fin(CAFE.y) ? CAFE.y : HY(CAFE.x, CAFE.z);
    const f = frame(CAFE.x, y, CAFE.z, CAFE.rot || 0);
    const hw = CAFE.w / 2, hd = CAFE.d / 2, base = 0.35, H = CAFE.h || 4.2, rnd = rngOf(551);
    box(N, 'stone', f, CAFE.w + 0.6, base + 0.5, CAFE.d + 0.6, 0, (base - 0.5) / 2, 0, T.stone);
    box(F, 'paint', f, CAFE.w + 0.6, base + 0.5, CAFE.d + 0.6, 0, (base - 0.5) / 2, 0, '#bdb6aa');
    const nb = 6, bay = CAFE.w / nb;
    for (let i = 0; i <= nb; i++) for (const s of [-1, 1]) if (!(s > 0 && i === nb / 2)) post(N, f, -hw + i * bay, s * hd, base, H, 0.15, T.post, 10, false);
    for (const s of [-1, 1]) { post(N, f, s * hw, 0, base, H, 0.15, T.post, 10, false); beam(N, f, CAFE.w + 0.3, 0.32, 0.24, 0, H - 0.12, s * hd, T.beam); beam(N, f, 0.24, 0.32, CAFE.d + 0.3, s * hw, H - 0.12, 0, T.beam); }
    // the south front and the sides: full-height glass between timber; the north wall plaster with high windows
    for (let i = 0; i < nb; i++) {
      const lx = -hw + (i + 0.5) * bay;
      N.add('glass', geo.box(bay - 0.3, H - base - 0.5, 0.06), f.at(lx, (base + H - 0.4) / 2, hd), T.glassTint);
      beam(N, f, bay - 0.3, 0.08, 0.1, lx, base + 1.05, hd + 0.03, T.dark);
      wallBay(N, f, lx + (bay - 0.3) / 2, -hd, lx - (bay - 0.3) / 2, -hd, PI, i % 2 ? 'window' : 'wall', base, H - 0.25, { wall: T.plasterWarm, pattern: 'jeongja', fine: !med });
    }
    for (const s of [-1, 1]) for (const zc of [-hd / 2, hd / 2]) N.add('glass', geo.box(0.06, H - base - 0.5, hd - 0.3), f.at(s * hw, (base + H - 0.4) / 2, zc), T.glassTint);
    F.add('glass', geo.box(CAFE.w - 0.2, H - base - 0.4, 0.06), f.at(0, (base + H - 0.3) / 2, hd), T.glassTint);
    box(F, 'paint', f, CAFE.w - 0.1, H - base, CAFE.d - 0.3, 0, (base + H) / 2, -0.15, T.plasterWarm);
    const ro = { mode: 'gable', hw, hd, ov: (CAFE.roof && CAFE.roof.overhang) || 1.2, rise: (CAFE.roof && CAFE.roof.h) || 2.6, wallTop: H + 0.35, ridge: { w: 0.42, h: 0.4 } };
    nearRoof(N, f, ro);
    roofFar(F, f, { mode: 'gable', hw, hd, ov: ro.ov, rise: ro.rise, y: H + 0.3, wallTop: H + 0.35 });
    const cb = board(CAFE.name || '농촌 카페', { bg: '#f3ead6', bg2: '#e2d3b2', fg: '#4a2e1b', edge: '#7a5a3a' });
    addBoard(N, f, cb, 0, H - 0.55, hd + 0.18, 0, 2.6, 0.62);
    colBox(f, 0, 0, hw + 0.2, hd + 0.2, { tag: 'building' });
    addBlocker(f, 0, base, 0, CAFE.w + 0.3, H - base + 0.3, CAFE.d + 0.3);
    // the terrace deck (plan `terrace`), steps, rails, tables with stools, parasols, planters
    const TR = CAFE.terrace || { x0: CAFE.x - hw, z0: CAFE.z + hd, x1: CAFE.x + hw, z1: CAFE.z + hd + 6 };
    const tw = TR.x1 - TR.x0, td = TR.z1 - TR.z0, tcx = (TR.x0 + TR.x1) / 2, tcz = (TR.z0 + TR.z1) / 2;
    const ft = frame(tcx, y, tcz, 0), dTop = base;
    box(N, 'plank', ft, tw, 0.12, td, 0, dTop - 0.06, 0, T.deck);
    box(N, 'wood', ft, tw, dTop + 0.3, 0.12, 0, (dTop - 0.3) / 2, td / 2 - 0.06, T.deckDark);
    box(F, 'paint', ft, tw, dTop + 0.3, td, 0, (dTop - 0.3) / 2, 0, T.deck);
    walkBox(ft, 0, 0, tw / 2, td / 2, y + dTop, 'wood');
    const stepX = (CAFE.door ? CAFE.door.x : CAFE.x) - tcx;
    for (let k = 0; k < 2; k++) { const top = dTop * (k + 1) / 3; box(N, 'stone', ft, 3.2, top + 0.2, 0.4, stepX, (top - 0.2) / 2, td / 2 + 0.2 + 0.4 * (1 - k), '#cfc8bb'); }
    const railRun = (ax, bx, z) => {
      const L = bx - ax; if (L < 0.4) return;
      if (!low) { N.add('railing', geo.mquad(L, 0.75, 0, 0), ft.at((ax + bx) / 2, dTop + 0.4, z)); box(N, 'wood', ft, L, 0.07, 0.1, (ax + bx) / 2, dTop + 0.8, z, T.dark, 0, 'grain'); }
      const c = ft.p((ax + bx) / 2, z); ctx.addCollider({ shape: 'box', x: c[0], z: c[1], hw: L / 2, hd: 0.1, maxY: y + dTop + 0.85, stand: false, tag: 'rail' });
    };
    railRun(-tw / 2, stepX - 1.7, td / 2 - 0.05); railRun(stepX + 1.7, tw / 2, td / 2 - 0.05);
    for (const s of [-1, 1]) { const L = td - 0.2; if (!low) { N.add('railing', geo.mquad(L, 0.75, 0, 0), ft.at(s * (tw / 2 - 0.05), dTop + 0.4, 0, PI / 2)); } const c = ft.p(s * (tw / 2 - 0.05), 0); ctx.addCollider({ shape: 'box', x: c[0], z: c[1], hw: 0.1, hd: L / 2, maxY: y + dTop + 0.85, stand: false, tag: 'rail' }); }
    const tables = [[-tw / 2 + 2.6, -0.4], [-tw / 2 + 6.4, 0.6], [tw / 2 - 6.4, 0.6], [tw / 2 - 2.6, -0.4]];
    for (const [lx, lz] of tables) {
      const q = ft.p(lx, lz);
      N.add('wood', geo.cyl(0.55, 0.55, 0.05, low ? 10 : 18), M(q[0], y + dTop + 0.74, q[1]), '#9b6a40');
      N.add('wood', geo.cyl(0.05, 0.08, 0.72, 6), M(q[0], y + dTop + 0.37, q[1]), T.dark);
      for (let k = 0; k < 4; k++) {
        const a = k * PI / 2 + 0.4, sx = q[0] + Math.cos(a) * 0.85, sz = q[1] + Math.sin(a) * 0.85;
        N.add('wood', geo.cyl(0.19, 0.17, 0.44, 8), M(sx, y + dTop + 0.22, sz), '#a77a50');
        colCircle(sx, sz, 0.22, { maxY: y + dTop + 0.45, stand: true, tag: 'stool' });
      }
      colCircle(q[0], q[1], 0.58, { maxY: y + dTop + 0.76, stand: true, tag: 'table' });
      // cups and a small jar of 식혜 on two of the tables
      if (!low && rnd() < 0.7) { N.add('glaze', geo.cyl(0.05, 0.04, 0.09, 8), M(q[0] + 0.2, y + dTop + 0.81, q[1] - 0.1), '#e8e0cf'); N.add('glaze', geo.cyl(0.05, 0.04, 0.09, 8), M(q[0] - 0.18, y + dTop + 0.81, q[1] + 0.14), '#3b5a7a'); }
    }
    for (const lx of [-tw / 2 + 4.5, tw / 2 - 4.5]) {   // parasols (canvas cone on a pole)
      const q = ft.p(lx, 0.1);
      N.add('wood', geo.cyl(0.035, 0.035, 2.5, 6), M(q[0], y + dTop + 1.25, q[1]), T.dark);
      const cone = new THREE.ConeGeometry(1.7, 0.6, low ? 8 : 16, 1, true); cone.translate(0, 0.3, 0);
      N.add('paint', cone, M(q[0], y + dTop + 2.2, q[1]), '#efe6d3');
      F.add('paint', new THREE.ConeGeometry(1.7, 0.6, 6, 1, false), M(q[0], y + dTop + 2.5, q[1]), '#efe6d3');
      colCircle(q[0], q[1], 0.12, { tag: 'post' });
    }
    for (const lx of [-tw / 2 + 0.5, tw / 2 - 0.5]) {   // planters with a small pine
      const q = ft.p(lx, -td / 2 + 0.6);
      N.add('glaze', jarG('dok', 10), M(q[0], y + dTop, q[1], 0, 0.8), '#5f3c25');
      colCircle(q[0], q[1], 0.42, { maxY: y + dTop + 0.75, stand: true, tag: 'planter' });
      grovePlan.push({ x: q[0], z: q[1], y: y + dTop + 0.55, species: 'gardenPine', scale: 0.22 });
    }
    // the door into PL_CAFE
    const dx = CAFE.door ? CAFE.door.x : CAFE.x, dz = (CAFE.door ? CAFE.door.z : CAFE.z + hd) + 0.9;
    box(N, 'wood', f, 1.9, 2.5, 0.08, dx - CAFE.x, base + 1.25, hd + 0.05, '#6b4529');
    N.add('glass', geo.box(0.7, 1.9, 0.04), f.at(dx - CAFE.x - 0.42, base + 1.3, hd + 0.1), T.glassTint);
    N.add('glass', geo.box(0.7, 1.9, 0.04), f.at(dx - CAFE.x + 0.42, base + 1.3, hd + 0.1), T.glassTint);
    ctx.interact({
      id: 'CX_CAFE_DOOR', kind: 'door', label: '☕ 카페 들어가기', kidLabel: '카페 안으로', emoji: '☕', radius: 3.2, priority: 0.7,
      position: { x: dx, y: y + base + 1.2, z: dz },
      onInteract: () => { try { G.sys.places?.enter?.('PL_CAFE'); } catch (err) { G.log.warn('WORLD', 'complex-buildings: café enter failed', err?.message || err); } },
    });
    doors.push({ id: 'CX_CAFE_DOOR', kind: 'door', place: 'PL_CAFE', x: dx, y: y + base, z: dz });
    if (!low) ctx.light?.({ x: tcx, y: y + 3.4, z: tcz, color: 0xffc27a, intensity: 6, distance: 14, decay: 2, day: 0 });
  }

  // ================================================================= 6. the storehouses (창고) round the bays of 44
  const SH = C.elements.filter((e) => e.type === 'building' && e.kind === 'storehouse');
  if (SH.length) {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const e of SH) { x0 = Math.min(x0, e.x - e.w / 2); x1 = Math.max(x1, e.x + e.w / 2); z0 = Math.min(z0, e.z - e.d / 2); z1 = Math.max(z1, e.z + e.d / 2); }
    const Cs = cluster('store', (x0 + x1) / 2, (z0 + z1) / 2, Math.hypot(x1 - x0, z1 - z0) / 2 + 3);
    const N = Cs.near, F = Cs.far;
    SH.forEach((e, k) => {
      const y = fin(e.y) ? e.y : HY(e.x, e.z), f = frame(e.x, y, e.z, e.rot || 0);
      const hw = e.w / 2, hd = e.d / 2, H = e.h || 3.2, doorTop = 2.52, bays = e.bays || { side: 63, w: 1.2, first: e.x - hw + 0.6 };
      const bx0 = (bays.first ?? (e.x - hw + 0.6)) - e.x;
      // gable ends: stone base, plaster with timber frame
      for (const s of [-1, 1]) {
        const lx = s * (hw - 0.22);
        box(N, 'stone', f, 0.5, 0.6, e.d + 0.3, lx, 0.2, 0, T.stoneDark);
        wallBay(N, f, lx, s > 0 ? -hd : hd, lx, s > 0 ? hd : -hd, s * PI / 2, 'wall', 0.5, H - 0.1, { wall: T.plasterWarm });
        post(N, f, lx, hd, 0, H, 0.15, T.postDark, 8, false); post(N, f, lx, -hd, 0, H, 0.15, T.postDark, 8, false);
      }
      box(N, 'wood', f, e.w - 0.5, doorTop, e.d - 0.4, 0, doorTop / 2, 0, '#2c2119');   // the dark inside behind the bay doors
      // the long faces: the band above the doors, posts every eight bays
      for (const sd of [-1, 1]) {
        const z = sd * hd;
        beam(N, f, e.w, 0.2, 0.22, 0, doorTop + 0.1, z, T.beam);
        box(N, 'plaster', f, e.w - 0.2, H - doorTop - 0.32, 0.14, 0, (doorTop + 0.2 + H - 0.12) / 2, z - sd * 0.05, T.plaster);
        beam(N, f, e.w + 0.2, 0.22, 0.22, 0, H - 0.08, z, T.beam);
        for (let b = 0; b <= bays.side; b += 8) { const lx = bx0 - 0.6 + Math.min(b, bays.side) * bays.w; post(N, f, lx, z + sd * 0.06, 0, H, 0.1, T.postDark, 6, false); }
        // a drain of field stones along the face
        box(N, 'field', f, e.w, 0.08, 0.34, 0, 0.04, z + sd * 0.55, '#9b917f');
      }
      const ro = { mode: 'gable', hw, hd, ov: (e.roof && e.roof.overhang) || 0.8, rise: (e.roof && e.roof.h) || 1.8, wallTop: H + 0.3, ridge: { w: 0.36, h: 0.34 }, seg: med ? 0.3 : 0.45, vres: 0.55 };
      nearRoof(N, f, ro);
      // name boards on both gable ends; the shared bays' plate
      const nbI = board(e.name || `창고 ${k + 1}동`, { bg: '#4a2e1b', bg2: '#2f1c10', fg: '#f6e3b0', edge: '#c9a35c' });
      for (const s of [-1, 1]) addBoard(N, f, nbI, s * (hw + 0.02), H + 0.5, 0, s * PI / 2, 1.4, 0.36);
      if (e.shared && fin(e.shared.from)) {
        const sb = board(e.shared.name || '함께 쓰는 칸', { bg: '#2f5d4a', bg2: '#1f4234', fg: '#f3ecd6', edge: '#d9c58a' });
        const lx = bx0 + (e.shared.from - 1 + (e.shared.n || 4) / 2) * bays.w, sdz = e.shared.side === 1 ? -1 : 1;
        addBoard(N, f, sb, lx, H - 0.4, sdz * (hd + 0.1), sdz > 0 ? 0 : PI, 1.6, 0.4);
      }
      // far: two-tone body + the cheap roof
      box(F, 'paint', f, e.w, doorTop, e.d, 0, doorTop / 2, 0, '#7a5a3e');
      box(F, 'paint', f, e.w, H - doorTop, e.d, 0, (doorTop + H) / 2, 0, T.plaster);
      farRoof(F, f, { mode: 'gable', hw, hd, ov: ro.ov, rise: ro.rise, y: H + 0.25 });
      colBox(f, 0, 0, hw, hd - 0.05, { tag: 'building' });
      addBlocker(f, 0, 0, 0, e.w, H + 0.2, e.d);
    });
  }

  // ================================================================= 7. the 옹기 workshop and the climbing kiln
  const WS = C.byId('B_WORKSHOP'), KILN = C.byId('KILN');
  let kilnGlow = null, kilnLight = null;
  if (WS || KILN) {
    const cx = WS ? WS.x : KILN.x, cz = WS && KILN ? (WS.z + (KILN.z0 + KILN.z1) / 2) / 2 : WS ? WS.z : (KILN.z0 + KILN.z1) / 2;
    const Cw = cluster('workshop', cx, cz, 18);
    const N = Cw.near, F = Cw.far, rnd = rngOf(771);
    if (WS) {
      const y = fin(WS.y) ? WS.y : HY(WS.x, WS.z), f = frame(WS.x, y, WS.z, WS.rot || 0);
      const hw = WS.w / 2, hd = WS.d / 2, base = 0.3, H = WS.h || 4.0;
      box(N, 'stone', f, WS.w + 0.8, base + 0.5, WS.d + 0.8, 0, (base - 0.5) / 2, 0, T.stoneDark);
      box(F, 'paint', f, WS.w + 0.8, base + 0.5, WS.d + 0.8, 0, (base - 0.5) / 2, 0, '#aaa294');
      const nb = 4, bay = WS.w / nb;
      for (let i = 0; i <= nb; i++) for (const s of [-1, 1]) post(N, f, -hw + i * bay, s * hd, base, H, 0.15, T.postDark, 8);
      for (const s of [-1, 1]) { post(N, f, s * hw, 0, base, H, 0.15, T.postDark, 8); beam(N, f, WS.w + 0.3, 0.3, 0.22, 0, H - 0.1, s * hd, T.beam); beam(N, f, 0.22, 0.3, WS.d + 0.3, s * hw, H - 0.1, 0, T.beam); }
      // clay walls; the front: a door bay (판문 open) and two wide open work bays with a low clay sill
      for (let i = 0; i < nb; i++) {
        const xa = -hw + i * bay + 0.15, xb = -hw + (i + 1) * bay - 0.15;
        wallBay(N, f, xb, -hd, xa, -hd, PI, i % 2 ? 'window' : 'wall', base, H - 0.2, { wall: T.clay, pattern: 'jeongja' });
        if (i === 1) wallBay(N, f, xa, hd, xb, hd, 0, 'door', base, H - 0.2, { wall: T.clay, pattern: 'ttisal' });
        else if (i === 0 || i === 3) wallBay(N, f, xa, hd, xb, hd, 0, 'window', base, H - 0.2, { wall: T.clay, pattern: 'jeongja' });
        else { box(N, 'plaster', f, xb - xa, 0.6, 0.3, (xa + xb) / 2, base + 0.3, hd, T.clay); }
      }
      for (const s of [-1, 1]) for (const [za, zb] of [[-hd + 0.15, -0.15], [0.15, hd - 0.15]]) wallBay(N, f, s * hw, s > 0 ? za : zb, s * hw, s > 0 ? zb : za, s * PI / 2, 'wall', base, H - 0.2, { wall: T.clay });
      box(F, 'paint', f, WS.w, H - base, WS.d, 0, (base + H) / 2, 0, T.clay);
      const ro = { mode: 'gable', hw, hd, ov: (WS.roof && WS.roof.overhang) || 1.0, rise: (WS.roof && WS.roof.h) || 2.4, wallTop: H + 0.32, ridge: { w: 0.38, h: 0.36 } };
      nearRoof(N, f, ro);
      roofFar(F, f, { mode: 'gable', hw, hd, ov: ro.ov, rise: ro.rise, y: H + 0.28, wallTop: H + 0.32 });
      const wb = board(WS.name || '옹기 공방', { bg: '#4a2e1b', bg2: '#2f1c10', fg: '#f6e3b0', edge: '#c9a35c' });
      addBoard(N, f, wb, -bay, H - 0.55, hd + 0.16, 0, 1.6, 0.42);
      // inside the open bay: a kick wheel with a jar on it, and a shelf of leather-hard jars
      if (!low) {
        const q = f.p(bay * 0.5, hd - 1.3);
        N.add('wood', geo.cyl(0.42, 0.42, 0.1, 14), M(q[0], y + base + 0.12, q[1]), '#6a4a30');
        N.add('wood', geo.cyl(0.06, 0.06, 0.55, 6), M(q[0], y + base + 0.4, q[1]), T.dark);
        N.add('wood', geo.cyl(0.24, 0.24, 0.06, 12), M(q[0], y + base + 0.68, q[1]), '#7a5638');
        jar(N, q[0], y + base + 0.71, q[1], 0.55, 'hangari', true, rnd);
      }
      colBox(f, 0, 0, hw + 0.2, hd + 0.2, { tag: 'building' });
      addBlocker(f, 0, base, 0, WS.w + 0.3, H - base + 0.3, WS.d + 0.3);
      // the yard: drying racks of raw jars, glaze tubs (잿물), a clay heap under a straw mat, firewood
      for (let r = 0; r < 3; r++) {
        const rz = WS.z + hd + 2.4 + r * 1.6, rx = WS.x + hw + 1.2;
        const fr = frame(rx, HY(rx + 2.4, rz), rz, 0);
        box(N, 'plank', fr, 5.2, 0.06, 0.8, 2.6, 0.4, 0, '#a98458');
        for (let k = 0; k < 4; k++) box(N, 'wood', fr, 0.07, 0.4, 0.7, 0.2 + k * 1.6, 0.2, 0, T.dark);
        for (let k = 0; k < 6; k++) jar(N, rx + 0.5 + k * 0.85, fr.y + 0.43, rz, 0.5 + rnd() * 0.12, k % 3 === 0 ? 'danji' : 'hangari', true, rnd);
        box(F, 'paint', fr, 5.2, 0.8, 0.8, 2.6, 0.4, 0, T.jarRaw);
        ctx.addCollider({ shape: 'box', x: rx + 2.6, z: rz, hw: 2.65, hd: 0.45, maxY: fr.y + 0.9, stand: false, tag: 'jars' });
      }
      for (let k = 0; k < 3; k++) {
        const tx = WS.x - hw - 1.6, tz = WS.z + hd - 1 - k * 1.5;
        N.add('glaze', geo.cyl(0.55, 0.42, 0.62, low ? 8 : 14, false), M(tx, HY(tx, tz) + 0.31, tz), '#5b4636');
        N.add('paint', geo.cyl(0.5, 0.5, 0.02, low ? 8 : 14), M(tx, HY(tx, tz) + 0.55, tz), k === 1 ? '#4a3a2a' : '#7b6a52');
        colCircle(tx, tz, 0.58, { maxY: HY(tx, tz) + 0.62, stand: true, tag: 'pot' });
      }
      {
        const hx = WS.x - hw - 2.0, hz = WS.z - hd + 0.5, hy = HY(hx, hz);
        const heap = new THREE.SphereGeometry(1.3, low ? 8 : 14, low ? 5 : 8, 0, TAU, 0, PI / 2); heap.scale(1, 0.55, 0.85);
        N.add('plaster', heap, M(hx, hy - 0.05, hz), '#9a7653');
        const mat = new THREE.SphereGeometry(1.36, low ? 8 : 12, low ? 4 : 6, 0, PI, 0, PI / 2); mat.scale(1, 0.58, 0.88);
        N.add('roof', mat, M(hx, hy - 0.04, hz, 0.3), '#c9ad6e');
        colCircle(hx, hz, 1.25, { maxY: hy + 0.72, stand: true, tag: 'pile' });
      }
    }
    if (KILN) {
      const za = Math.max(KILN.z0, KILN.z1), zb = Math.min(KILN.z0, KILN.z1), Lk = za - zb, ya = fin(KILN.y0) ? KILN.y0 : HY(KILN.x, za), yb = fin(KILN.y1) ? KILN.y1 : HY(KILN.x, zb);
      const n = KILN.chambers || 6, cl = Lk / n, kw = KILN.w || 3.6, rr = kw / 2;
      const slope = Math.atan2(yb - ya, Lk);
      const kGlow = [];
      for (let i = 0; i < n; i++) {
        const zc = za - cl * (i + 0.5), yc = lerp(ya, yb, (i + 0.5) / n);
        // each chamber: a humped barrel vault of fired clay, a step higher than the one before
        const vault = new THREE.CylinderGeometry(rr, rr, cl * 0.98, low ? 8 : 14, 1, false, -PI / 2, PI);
        vault.rotateX(-PI / 2);
        N.add('plaster', vault, M(KILN.x, yc + 0.35, zc, 0, 1, 0.78, 1), '#a26d4e');
        F.add('paint', new THREE.CylinderGeometry(rr, rr, cl, 6, 1, false, -PI / 2, PI).rotateX(-PI / 2), M(KILN.x, yc + 0.35, zc, 0, 1, 0.78, 1), '#8f6248');
        box(N, 'field', frame(KILN.x, yc, zc), kw + 0.3, 0.45, cl, 0, 0.12, 0, '#8d7a66');
        // ribs between chambers and a stoking hole on the east side
        N.add('plaster', new THREE.TorusGeometry(rr + 0.05, 0.09, 4, low ? 8 : 12, PI), M(KILN.x, yc + 0.35, zc - cl / 2, 0, 1, 0.78, 1), '#8a5a3e');
        kGlow.push([KILN.x + rr + 0.01, yc + 0.42, zc]);
      }
      // fire mouth (아궁이) at the low end, a chimney at the top
      const mouth = frame(KILN.x, ya, za + 0.3, 0);
      box(N, 'field', mouth, kw + 0.6, 1.5, 0.8, 0, 0.75, 0, '#7d6a58');
      kGlow.push([KILN.x, ya + 0.55, za + 0.72]);
      N.add('field', geo.box(1.0, 2.6, 1.0), M(KILN.x, yb + 1.4, zb - 0.6), '#7d6a58');
      N.add('roof', geo.box(1.2, 0.12, 1.2), M(KILN.x, yb + 2.76, zb - 0.6), '#ffffff');
      F.add('paint', geo.box(1.0, 2.6, 1.0), M(KILN.x, yb + 1.4, zb - 0.6), '#7d6a58');
      // the glowing holes: emissive discs on the 'glow' material (lit day and night; brighter at night)
      for (const [gx, gy, gz] of kGlow) {
        const d = new THREE.CircleGeometry(0.22, 10);
        const isMouth = Math.abs(gz - (za + 0.72)) < 0.01;
        if (isMouth) { d.scale(2.2, 1.6, 1); N.add('glow', d, M(gx, gy, gz), '#ff7a2a'); }
        else { N.add('glow', d, M(gx + 0.02, gy, gz, PI / 2), '#ff8a3a'); }
      }
      // the shelter (가마 덕): posts on both sides and one long tiled roof following the slope
      const fs = frame(KILN.x, (ya + yb) / 2, (za + zb) / 2, 0);
      const nP = Math.max(2, Math.round(Lk / 3));
      for (let k = 0; k <= nP; k++) {
        const z = za - (Lk * k) / nP, yy = lerp(ya, yb, k / nP);
        for (const s of [-1, 1]) { const x = KILN.x + s * (rr + 0.9); N.add('wood', geo.cyl(0.11, 0.12, 3.4, 8), M(x, yy + 1.7, z), T.postDark); F.add('paint', geo.box(0.24, 3.4, 0.24), M(x, yy + 1.7, z), T.postDark); colCircle(x, z, 0.18, { tag: 'post' }); }
      }
      const sr = { mode: 'gable', hw: rr + 1.0, hd: Lk / 2 + 0.6, ov: 0.6, rise: 1.3, ridge: { w: 0.3, h: 0.28 }, seg: 0.6, vres: 0.6 };
      // ridge along the kiln (local z): the roof's ridge runs along its local x — turn it by 90°
      const fr2 = { m: mul(fs.at(0, 0, 0, 0, 1, 1, 1, slope, 0), M(0, 0, 0, PI / 2)), at: (lx, ly, lz, ry = 0) => mul(mul(fs.at(0, 0, 0, 0, 1, 1, 1, slope, 0), M(0, 0, 0, PI / 2)), M(lx, ly, lz, ry)), p: fs.p, x: fs.x, y: fs.y, z: fs.z, rot: fs.rot };
      if (!low) nearRoof(N, fr2, Object.assign({ hw: Lk / 2 + 0.6, hd: rr + 1.0, wallTop: 3.3 + 0.2 }, { mode: 'gable', ov: 0.6, rise: 1.3, ridge: sr.ridge, seg: 0.6, vres: 0.6 }));
      farRoof(F, fr2, { mode: 'gable', hw: Lk / 2 + 0.6, hd: rr + 1.0, ov: 0.6, rise: 1.3, y: 3.4 });
      ctx.addCollider({ shape: 'box', x: KILN.x, z: (za + zb) / 2, hw: rr + 0.3, hd: Lk / 2 + 0.9, tag: 'building' });
      // firewood stack by the mouth
      {
        const wx = KILN.x - rr - 2.4, wz = za + 0.5, wy = HY(wx, wz), fw = frame(wx, wy, wz, PI / 2);
        for (let r = 0; r < 5; r++) for (let c = 0; c < 10; c++) N.add('wood', geo.cyl(0.075, 0.075, 0.9, 6), fw.at(-1.1 + c * 0.17 + (r % 2) * 0.085, 0.08 + r * 0.15, 0, 0, 1, 1, 1, PI / 2), r % 2 ? '#9a7550' : '#87643f');
        F.add('paint', geo.box(1.0, 0.75, 1.8), M(wx, wy + 0.37, wz), '#87643f');
        ctx.addCollider({ shape: 'box', x: wx, z: wz, hw: 0.5, hd: 0.95, maxY: wy + 0.8, stand: true, tag: 'pile' });
      }
      ctx.interact({
        id: 'CX_KILN', kind: 'exhibit', label: '🔥 오름가마 살펴보기', kidLabel: '가마 보기', emoji: '🔥', radius: 3.0, priority: 0.4,
        position: { x: KILN.x + rr + 1.6, y: ya + 1.2, z: za - cl },
        onInteract: () => {
          const X = G.sys.exhibits;
          try {
            if (X?.open && G.data.exhibits?.HX_WS_GAMA) X.open('HX_WS_GAMA');
            else { G.ui?.toast?.('오름가마는 산비탈을 따라 칸칸이 올라가는 가마예요. 아래 아궁이에서 불을 때면 뜨거운 바람이 위 칸으로 올라가며 옹기를 구워요.', { emoji: '🔥', type: 'info' }); G.easy?.say?.('오름가마는 비탈을 따라 올라가는 가마예요.'); }
          } catch (err) { /* cosmetic */ }
        },
      });
      if (!low && typeof ctx.light === 'function') kilnLight = ctx.light({ x: KILN.x, y: ya + 0.8, z: za + 1.6, color: 0xff7a30, intensity: 7, distance: 10, decay: 2, flicker: 0.25, day: 0.35 });
      kilnGlow = kGlow;
    }
    if (WS) {
      const dx = WS.door ? WS.door.x : WS.x, dz = (WS.door ? WS.door.z : WS.z + WS.d / 2) + 0.9, y = fin(WS.y) ? WS.y : HY(WS.x, WS.z);
      ctx.interact({
        id: 'CX_WORKSHOP_DOOR', kind: 'door', label: '⚱️ 옹기 공방 들어가기', kidLabel: '공방 안으로', emoji: '⚱️', radius: 3.2, priority: 0.7,
        position: { x: dx, y: y + 1.4, z: dz },
        onInteract: () => { try { G.sys.places?.enter?.('PL_WORKSHOP'); } catch (err) { G.log.warn('WORLD', 'complex-buildings: workshop enter failed', err?.message || err); } },
      });
      doors.push({ id: 'CX_WORKSHOP_DOOR', kind: 'door', place: 'PL_WORKSHOP', x: dx, y: y + 0.3, z: dz });
    }
  }

  // ================================================================= build the buckets, boards, trees
  const aoGround = { ground: (x, z) => HY(x, z) };
  for (const c of CL.values()) {
    if (!low) { try { c.meshes.near = c.near.build(c.gNear, { name: 'cxb-' + c.id, ao: G.params?.get?.('cxao') === '1' ? aoGround : false }) || {}; } catch (e) { G.log.warn('WORLD', `complex-buildings: near form of ${c.id} failed`, e?.message || e); } }
    else c.near.parts?.clear?.();
    try { c.meshes.far = c.far.build(c.gFar, { name: 'cxb-' + c.id + '-far', ao: false }) || {}; } catch (e) { G.log.warn('WORLD', `complex-buildings: far form of ${c.id} failed`, e?.message || e); }
  }
  try { flushBoards(); } catch (e) { G.log.warn('WORLD', 'complex-buildings: name boards failed', e?.message || e); }
  let grove = null;
  if (grovePlan.length) {
    const list = grovePlan.map((t) => ({ x: t.x, z: t.z, y: fin(t.y) ? t.y : HY(t.x, t.z), species: t.species, scale: t.scale, rot: t.rot }));
    try { grove = G.sys.nature?.grove?.(list, { parent: root, space: 'parent', name: 'cxb-grove', heightAt: HY, colliders: false }) || null; } catch (e) { grove = null; G.log.warn('WORLD', 'complex-buildings: garden trees failed', e?.message || e); }
    for (const t of list) colCircle(t.x, t.z, 0.3 * (t.scale || 1) + 0.1, { tag: 'tree' });
  }
  root.traverse((o) => { if (o.isMesh && o.name !== 'blocker') { o.receiveShadow = true; if (o.castShadow === undefined) o.castShadow = true; } });

  // ================================================================= levels of detail, update, api, dispose
  const NEAR_IN = med ? 70 : 110, NEAR_OUT = med ? 80 : 125;
  let forced = null, tCheck = 0;
  const setLodC = (c, name) => { c.lod = name; c.gNear.visible = name === 'near' && !low; c.gFar.visible = name !== 'near' || low; };
  for (const c of CL.values()) setLodC(c, low ? 'far' : 'near');
  const _cam = new THREE.Vector3();
  function lodCheck() {
    const cam = G.sys.engine?.camera;
    if (!cam || low) return;
    cam.getWorldPosition ? cam.getWorldPosition(_cam) : _cam.copy(cam.position);
    root.updateWorldMatrix?.(true, false);
    const o = root.matrixWorld.elements, ox = o[12], oy = o[13], oz = o[14];
    for (const c of CL.values()) {
      if (forced) { if (c.lod !== forced) setLodC(c, forced); continue; }
      const d = Math.hypot(_cam.x - (c.cx + ox), _cam.y - (c.cy + oy), _cam.z - (c.cz + oz)) - c.r;
      if (c.lod === 'near' && d > NEAR_OUT) setLodC(c, 'far');
      else if (c.lod === 'far' && d < NEAR_IN) setLodC(c, 'near');
    }
  }
  lodCheck();
  function update(dt) {
    tCheck -= dt || 0;
    if (tCheck <= 0) { tCheck = 0.3; lodCheck(); }
  }
  const countTris = (g) => { let n = 0, calls = 0; g.traverse((o) => { if (o.isMesh && o.visible !== false && o.material && o.material.visible !== false && o.geometry && o.name !== 'blocker') { calls++; const gi = o.geometry; n += ((gi.index ? gi.index.count : gi.attributes.position.count) / 3) * (o.isInstancedMesh ? o.count : 1); } }); return { tris: Math.round(n), calls }; };
  const api = {
    built: true, low, quality, doors, houses: houseInfo, deck: deckApi, pavilion: pavApi,
    get kilnGlow() { return kilnGlow ? kilnGlow.length : 0; },
    clusters() { return [...CL.values()].map((c) => ({ id: c.id, lod: c.lod, x: c.cx, z: c.cz, r: c.r, near: countTris(c.gNear), far: countTris(c.gFar) })); },
    setLod(name) { forced = name === 'near' || name === 'far' ? name : null; if (forced) for (const c of CL.values()) setLodC(c, low ? 'far' : forced); else lodCheck(); },
    /** what is drawn right now (visible near / far forms, the garden trees) */
    stats() {
      let calls = 0, tris = 0;
      for (const c of CL.values()) for (const g of [c.gNear, c.gFar]) if (g.visible) { const s = countTris(g); calls += s.calls; tris += s.tris; }
      const tg = grove && grove.group ? countTris(grove.group) : { calls: 0, tris: 0 };
      return { calls, tris, trees: tg, colliders: null, clusters: CL.size, boards: BOARDS.length, lod: forced || 'auto' };
    },
    update,
    root,
  };
  G.complexBuildings = api;
  return {
    update,
    dispose() {
      for (const fn of disposers) { try { fn(); } catch (e) { /* gone */ } }
      try { grove?.dispose?.(); } catch (e) { /* gone */ }
      for (const b of blockers) { const i = G.world.cameraBlockers.indexOf(b); if (i >= 0) G.world.cameraBlockers.splice(i, 1); }
      root.traverse((o) => { if (o.isMesh && o.geometry && o.geometry !== unitBox) o.geometry.dispose(); });
      for (const x of owned) { try { if (x.map && x.map.dispose) x.map.dispose(); x.dispose?.(); } catch (e) { /* gone */ } }
      root.parent?.remove(root);
      if (kilnLight && typeof kilnLight.remove === 'function') { try { kilnLight.remove(); } catch (e) { /* the place removes it */ } }
      if (G.complexBuildings === api) G.complexBuildings = { built: false };
    },
  };
}, 30);
