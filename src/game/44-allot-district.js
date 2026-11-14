// =============================================================================
// 44-allot-district.js — the 10,000 units of 만장대 단지 (PL_ALLOT): jars on the rings, herb beds on the terraces, store bays
// along the long storehouses — instanced with levels of detail, coloured by 분양 status, picked, labelled, findable
// (CONTRACT §16.8 "3D … complex-units"; part 'units' of the complex part registry, order 40).
//
// Look target: assets/reference/03-concept-main.webp — the rings of dark glazed onggi in perfect concentric rows are the
// dominant texture of the picture. From the `aerial` viewpoint every jar is there as a lit lathe form with its lid (never a dot
// or a cylinder), grounded by a soft contact shadow; beside a ring the photographed onggi glaze of G.mat, lids, 금줄 ropes,
// name stakes, lid stones and weeds at the kerbs hold a close look.
//
// DATA   G.sys.allot.mapState() (43-allot.js) → { v, demo, layout L, status Uint8Array (0 open · 1 held · 2 leased · 3 closed
//        · 4 mine), mine, zones }, event 'allot:map'. Without it (or with an empty layout): G.data.complex.current() and
//        "all open". Every unit position comes from L (L.arrays x, y, z, rot, kind, zone, seq, variant, ring, slot) — this file
//        never places a unit itself; colliders and stand spots are derived from those positions and C.rings / C.slots.
//
// RENDERING (all THREE.InstancedMesh, frustumCulled off — the culling is ours, by 11 m sub-cells of each kind):
//   jar    full = lathe body (14 seg, 196 tri) + lid (second mesh sharing the body's instance buffers, 100 tri)
//          low  = one lathe with the lid (7 × 4 = 56 tri) · far = 4 × 2 lathe (16 tri)
//          8 variants by instance scale (squat / tall / small / 독-like); the status ribbon is a band of the neck painted in
//          the fragment shader (object-space y), the warm glow of "mine" is emissive (aMark.w ≥ 2)
//   plot   full = timber frame (bk 'wood') + soil (bk 'soil') + crop by variant (leafy / upright / bushy meshes; variant 7 =
//          fallow under straw) · low = a bed block tinted by its crop (24 tri) · far = a flat quad pair (4 tri)
//   store  a numbered door bay (frame, leaf, battens, hasp; bk 'wood') at the wall face of every bay — right with or without
//          the storehouses of 55-complex-buildings.js — and, near the camera, a plate with the 4-digit number of the code
//          (one digit strip texture, digits chosen per instance in the shader)
//   markers  name stake (held / leased) · gold star stake (mine; also a SHAPE, never colour alone) · straw cover (closed
//          jar / bed) · crossed battens (closed bay)
//   grounding  one soft vertex-alpha disc per jar / bed (no texture, no shadow map: it reads from the aerial view and on low)
//   near (≤ ~25 m)  금줄 (straw rope with paper, pepper and charcoal) round some necks, lid stones, weeds at the ring kerbs
//   Level per sub-cell from the camera distance with 3 m hysteresis; instance buffers are rewritten in place, only when a
//   sub-cell changes level or enters / leaves the view (no per-frame allocations). Budgets (aerial, high): ≤ 30 draw calls
//   and ≤ 0.9 M triangles for all units; medium ≤ 0.45 M; low = flat colours, low-poly and far forms only.
//   LOD distances (m, camera → sub-cell)   high: jar full 22 / low 330, bed 26 / 120 · medium: 14 / 150, 16 / 80 · low: — / 90, — / 45
//
// STATUS  instanceColor = the natural glaze / soil / timber tint (closed: dimmed); jars get a neck ribbon in the Okabe–Ito hue
//   of the status (held #E69F00, leased cream, mine #0072B2) and a stake; 'allot:map' rewrites ONLY the changed indices.
// PICKING ONE dynamic interactable 'cu-unit' (G.interact): every 0.12 s L.indexAt is probed ahead of the player; the unit faced
//   within 2.5 m (edge distance; bays: their door) gets our own highlight (a gold ring on the ground + a soft glow shell; never
//   engine.setOutline on an instanced mesh) and the prompt '🏺 J01-0012 보기' (easy: '항아리 보기') →
//   G.sys.allot.open('map', { unit: code }) or, without the panel, a small card (code, kind, status in kid words).
// LABELS  ≤ 12 pooled world labels (code + public nameplate when the map state carries one + status words; textContent only),
//   kept while their unit stays within 11 m, at most 2 new ones every 0.3 s, faded in and out (no label storm on a ring walk).
// COLLIDERS  one box strip per ring arc (chord pieces per sector × group of 3 rows), per bed row pair (per group of 10), per
//   storehouse bay row pair — the player walks the aisles and ring walks (≈ 600 colliders for 10,000 units).
// BOARDS  two timber notice boards (entrance plaza by the spawn; the plaza of the great circle, two-sided) with a canvas:
//   전체 · 빈 자리 · 분양 중 · 내 것 per kind, big numbers and drawn icons, redrawn on 'allot:map' / 'allot:mine'.
//
// PUBLIC  G.sys.allotDistrict (present after this file loads; the scene part works once PL_ALLOT is built)
//   goto(code) -> Promise<bool>    찾아가기: the player stands on the walk beside the unit, facing it, with a beacon (soft light
//                                   column + arrow; steady under reduce-motion) for 20 s. Outside PL_ALLOT it enters the place
//                                   first (G.sys.places.enter('PL_ALLOT', { focusUnit: code })) and goes there when built.
//   highlight(code | null)          force the highlight on a unit (null → back to the nearest-unit pick)
//   counts() -> { jar|plot|store|all: { total, open, held, leased, taken, closed, mine } }
//   stats()  -> { built, count, levels {kind: [full, low, far]}, drawn {mesh: n}, drawCalls, triangles, labels, markers,
//               near, rebuilds, statusWrites, focus, colliders, boards }
//   refresh()                        re-read the map state (full re-colour) and rebuild the visible buffers
//   spotFor(code) -> { x, z, rotY } | null    the stand spot beside a unit (place-local metres; tests)
//   ready() -> bool                  the part is built
// Events: district:goto { code, ok } · district:focus { code | null }
// =============================================================================
const CX = (G.complexParts = G.complexParts || { list: [], add(name, fn, order) { this.list.push({ name, fn, order: order == null ? 100 : order }); } });
(function () {
  'use strict';
  const PI = Math.PI, TAU = PI * 2;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const fin = Number.isFinite;
  const CAT = 'DISTRICT';
  const PLACE = 'PL_ALLOT';
  const KINDS = ['jar', 'plot', 'store'];
  const ST_KEYS = ['open', 'held', 'leased', 'closed', 'mine'];
  const ST_SHORT = ['o', 'h', 'l', 'c', 'm'];
  const REACH = 2.5;                       // m from the player to a unit's edge (bays: their door)
  const SUB = 11;                          // sub-cell (m) of the level-of-detail / culling lists
  const easyOn = () => (typeof G.easy?.on === 'boolean' ? G.easy.on : G.settings?.easyMode !== false);
  const reduced = () => (typeof G.motionReduced === 'function' ? G.motionReduced() : !!G.settings?.reduceMotion);
  const say = (t) => { try { G.easy?.say?.(t, { priority: 1 }); } catch (e) { /* voice optional */ } };
  const D = () => G.data.allot || {};
  const LOD = {
    high: { jar: [22, 330], plot: [26, 120], store: [55, 1e9], stake: 80, cover: 230, near: 25, label: 6.5 },
    medium: { jar: [14, 150], plot: [16, 80], store: [38, 1e9], stake: 55, cover: 150, near: 18, label: 6 },
    low: { jar: [-1, 90], plot: [-1, 45], store: [24, 1e9], stake: 34, cover: 90, near: 0, label: 5.5 },
  };
  const HYST = 3;
  const KIND_WORD = { jar: '항아리', plot: '밭', store: '창고 칸' };
  const KIND_EMOJI = { jar: '🏺', plot: '🌱', store: '📦' };
  const ST_WORDS = { open: ['빈 자리', '비어 있어요'], held: ['신청 중', '누가 신청했어요'], leased: ['분양됨', '주인이 있어요'], closed: ['쉬는 자리', '지금은 쉬어요'], mine: ['내 자리', '내 자리예요'] };
  // ribbon colours (linear) by status: open none · held Okabe–Ito orange · leased a cream cloth · closed none · mine blue
  const RIBBON = [null, '#E69F00', '#efe4cc', null, '#0072B2'];
  // jar variants: [xz scale, y scale]
  const JV = [[1.0, 1.0], [0.94, 0.95], [1.06, 1.02], [0.98, 1.1], [1.08, 1.16], [0.88, 0.9], [1.03, 0.96], [0.99, 1.05]];
  // crop of a bed by variant: [mesh 0 leafy | 1 upright | 2 bushy | -1 fallow, colour]
  const CROP = [[0, '#8fbf4a'], [0, '#3f7a2e'], [0, '#7fa88a'], [1, '#6f9a3c'], [1, '#5d8f2f'], [2, '#4f7f2a'], [2, '#86a845'], [-1, '#b59a62']];

  // ---------------------------------------------------------------- small helpers
  const _c = new THREE.Color();
  function lin(hex) { _c.set(hex); return [_c.r, _c.g, _c.b]; }
  function hash(i, k) {
    let h = (Math.imul(i + 1, 2654435761) ^ Math.imul(k + 7, 40503)) | 0;
    h = Math.imul(h ^ (h >>> 15), 2246822519); h ^= h >>> 13; h = Math.imul(h, 3266489917); h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }
  /** column-major TRS (rotation about +y, local +z → (sin r, cos r)) into arr at o */
  function trs(arr, o, x, y, z, ry, sx, sy, sz) {
    const c = Math.cos(ry), s = Math.sin(ry);
    arr[o] = c * sx; arr[o + 1] = 0; arr[o + 2] = -s * sx; arr[o + 3] = 0;
    arr[o + 4] = 0; arr[o + 5] = sy; arr[o + 6] = 0; arr[o + 7] = 0;
    arr[o + 8] = s * sz; arr[o + 9] = 0; arr[o + 10] = c * sz; arr[o + 11] = 0;
    arr[o + 12] = x; arr[o + 13] = y; arr[o + 14] = z; arr[o + 15] = 1;
  }
  const copy16 = (dst, d, src, s) => { for (let k = 0; k < 16; k++) dst[d + k] = src[s + k]; };
  const copy3 = (dst, d, src, s) => { dst[d] = src[s]; dst[d + 1] = src[s + 1]; dst[d + 2] = src[s + 2]; };
  const copy4 = (dst, d, src, s) => { dst[d] = src[s]; dst[d + 1] = src[s + 1]; dst[d + 2] = src[s + 2]; dst[d + 3] = src[s + 3]; };
  function codeOf(L, i) {
    const z = L.zones[L.arrays.zone[i]];
    return (D().codeOf ? D().codeOf(z.code, L.arrays.seq[i]) : `${z.code}-${String(L.arrays.seq[i]).padStart(4, '0')}`);
  }
  function parse(code) {
    if (D().parseCode) return D().parseCode(code);
    const m = /^([A-Z0-9]{1,12})-(\d{1,6})$/.exec(String(code || '').toUpperCase());
    return m ? { zone: m[1], seq: Number(m[2]) } : null;
  }

  // ---------------------------------------------------------------- geometry (built once per build, owned by the place)
  /** merge parts [{ g, m (Matrix4|null), c (hex|[r,g,b]) , a? alpha }] into one non-indexed geometry with position / normal / uv / color */
  function merge(parts, alpha) {
    let n = 0;
    const list = parts.map((p) => {
      let g = p.g.index ? p.g.toNonIndexed() : p.g;
      if (p.m) g.applyMatrix4(p.m);
      if (!g.attributes.normal) g.computeVertexNormals();
      n += g.attributes.position.count;
      return { g, c: Array.isArray(p.c) ? p.c : lin(p.c || '#ffffff'), a: p.a == null ? 1 : p.a };
    });
    const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2), col = new Float32Array(n * (alpha ? 4 : 3));
    let o = 0;
    for (const { g, c, a } of list) {
      const P = g.attributes.position, N = g.attributes.normal, U = g.attributes.uv, C = g.attributes.color, k = P.count;
      for (let i = 0; i < k; i++) {
        pos[(o + i) * 3] = P.getX(i); pos[(o + i) * 3 + 1] = P.getY(i); pos[(o + i) * 3 + 2] = P.getZ(i);
        nor[(o + i) * 3] = N.getX(i); nor[(o + i) * 3 + 1] = N.getY(i); nor[(o + i) * 3 + 2] = N.getZ(i);
        if (U) { uv[(o + i) * 2] = U.getX(i); uv[(o + i) * 2 + 1] = U.getY(i); }
        const s = alpha ? 4 : 3, vr = C ? C.getX(i) : 1, vg = C ? C.getY(i) : 1, vb = C ? C.getZ(i) : 1;
        col[(o + i) * s] = c[0] * vr; col[(o + i) * s + 1] = c[1] * vg; col[(o + i) * s + 2] = c[2] * vb;
        if (alpha) col[(o + i) * s + 3] = C && C.itemSize === 4 ? C.getW(i) * a : a;
      }
      o += k;
      g.dispose?.();
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    out.setAttribute('color', new THREE.BufferAttribute(col, alpha ? 4 : 3));
    out.computeBoundingSphere();
    return out;
  }
  const M4 = (x = 0, y = 0, z = 0, ry = 0, sx = 1, sy = sx, sz = sx, rx = 0, rz = 0) => {
    const e = new THREE.Euler(rx, ry, rz, 'YXZ');
    return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(e), new THREE.Vector3(sx, sy, sz));
  };
  const box = (w, h, d) => (G.bkit?.geo?.box ? G.bkit.geo.box(w, h, d) : new THREE.BoxGeometry(w, h, d));
  const lathe = (pts, seg, phi = 0) => {
    const g = new THREE.LatheGeometry(pts.map((p) => new THREE.Vector2(p[0], p[1])), seg, phi);
    return g;
  };
  /** a lathe whose vertex colours shade the foot and the mouth (the painted jar's dark foot / rim) */
  function shadeByY(g, stops) {
    const P = g.attributes.position, n = P.count, c = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const y = P.getY(i);
      let v = stops[stops.length - 1][1];
      for (let k = 0; k < stops.length - 1; k++) {
        const a = stops[k], b = stops[k + 1];
        if (y >= a[0] && y <= b[0]) { v = a[1] + (b[1] - a[1]) * ((y - a[0]) / (b[0] - a[0] || 1)); break; }
        if (y < stops[0][0]) { v = stops[0][1]; break; }
      }
      c[i * 3] = c[i * 3 + 1] = c[i * 3 + 2] = v;
    }
    g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    return g;
  }
  const JAR_SHADE = [[0, 0.62], [0.06, 0.82], [0.25, 1], [0.7, 1], [0.84, 0.8], [0.9, 0.86], [1.05, 1]];
  function geoms() {
    const G3 = {};
    // jar body: foot → belly → shoulder → neck → rim (7 bands × 14)
    // (a hand-thrown 항아리: small foot, the widest point high on the belly, a strong shoulder, a short neck and rolled rim)
    G3.jarBody = shadeByY(lathe([[0.185, 0], [0.235, 0.05], [0.33, 0.2], [0.398, 0.39], [0.415, 0.53], [0.372, 0.69], [0.285, 0.815], [0.292, 0.868], [0.262, 0.9]], 13), JAR_SHADE);
    // lid (5 bands × 9), already at its place on the rim (the lid mesh shares the body's instance matrices)
    G3.jarLid = shadeByY(lathe([[0.322, 0.872], [0.268, 0.926], [0.108, 0.983], [0.062, 0.998], [0.05, 1.04], [0, 1.05]], 9), [[0.87, 0.82], [0.93, 1], [1.05, 1.06]]);
    // low: body + lid in one (4 bands × 7 = 56 tri) · far: 2 bands × 4 = 16 tri
    G3.jarLow = shadeByY(lathe([[0.19, 0], [0.412, 0.47], [0.36, 0.72], [0.3, 0.88], [0, 1.03]], 7), [[0, 0.7], [0.3, 1], [0.75, 0.95], [0.88, 0.85], [1.03, 1.05]]);
    G3.jarFar = shadeByY(lathe([[0.2, 0], [0.42, 0.5], [0, 0.98]], 4, PI / 4), [[0, 0.75], [0.5, 1], [0.98, 1.05]]);
    // bed (1.0 wide along x, 1.5 deep along z; front +z): frame + soil
    const W = 0.98, Dd = 1.48, H = 0.24, T = 0.06;
    const frame = [];
    for (const s of [-1, 1]) {
      frame.push({ g: box(W, H, T), m: M4(0, H / 2, s * (Dd / 2 - T / 2)), c: '#a7865f' });
      frame.push({ g: box(T, H, Dd - 2 * T), m: M4(s * (W / 2 - T / 2), H / 2, 0), c: '#9b7a55' });
    }
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) frame.push({ g: box(0.08, H + 0.06, 0.08), m: M4(sx * (W / 2 - 0.03), (H + 0.06) / 2, sz * (Dd / 2 - 0.03)), c: '#6f5137' });
    G3.bedFrame = merge(frame);
    const soil = new THREE.PlaneGeometry(W - 2 * T, Dd - 2 * T, 2, 4);
    soil.rotateX(-PI / 2);
    { const P = soil.attributes.position; for (let i = 0; i < P.count; i++) { const x = P.getX(i); P.setY(i, 0.2 + 0.025 * Math.cos(x / (W / 2) * PI * 1.5)); } soil.computeVertexNormals(); }
    { const U = soil.attributes.uv; for (let i = 0; i < U.count; i++) U.setXY(i, U.getX(i) * 0.86, U.getY(i) * 1.36); }
    G3.bedSoil = merge([{ g: soil, c: '#ffffff' }]);
    // crops (bed local; soil top y ≈ 0.2)
    const leafy = [], upright = [], bushy = [];
    for (const x of [-0.2, 0.2]) for (const z of [-0.42, 0, 0.42]) {
      for (let k = 0; k < 5; k++) {
        const a = (k / 5) * TAU + x * 3 + z, len = 0.2, w = 0.08;
        const g = new THREE.BufferGeometry();
        const ca = Math.cos(a), sa = Math.sin(a);
        const tip = [x + ca * len, 0.3, z + sa * len], b0 = [x - sa * w, 0.21, z + ca * w], b1 = [x + sa * w, 0.21, z - ca * w], mid = [x + ca * len * 0.45, 0.31, z + sa * len * 0.45];
        g.setAttribute('position', new THREE.Float32BufferAttribute([...b0, ...mid, ...tip, ...b0, ...tip, ...b1, ...b1, ...tip, ...mid], 3));
        g.setAttribute('color', new THREE.Float32BufferAttribute([0.7, 0.7, 0.7, 0.95, 0.95, 0.95, 1.15, 1.15, 1.1, 0.7, 0.7, 0.7, 1.15, 1.15, 1.1, 0.7, 0.7, 0.7, 0.7, 0.7, 0.7, 1.15, 1.15, 1.1, 0.95, 0.95, 0.95], 3));
        g.computeVertexNormals();
        leafy.push({ g });
      }
    }
    for (const z of [-0.45, 0, 0.45]) for (const x of [-0.3, -0.1, 0.1, 0.3]) for (let k = 0; k < 3; k++) {
      const a = k * 2.1 + x * 5, h = 0.26 + 0.12 * ((k + 1) % 3) / 2, lean = 0.06;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute([x - 0.018 * Math.sin(a), 0.2, z - 0.018 * Math.cos(a), x + 0.018 * Math.sin(a), 0.2, z + 0.018 * Math.cos(a), x + lean * Math.cos(a), 0.2 + h, z + lean * Math.sin(a)], 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute([0.65, 0.68, 0.6, 0.65, 0.68, 0.6, 1.1, 1.12, 1.0], 3));
      g.computeVertexNormals();
      upright.push({ g });
    }
    for (const x of [-0.2, 0.2]) for (const z of [-0.36, 0.36]) {
      const g = new THREE.OctahedronGeometry(0.17, 0);
      g.scale(1, 0.75, 1);
      const P = g.attributes.position, c = [];
      for (let i = 0; i < P.count; i++) { const v = P.getY(i) > 0.05 ? 1.1 : P.getY(i) < -0.05 ? 0.6 : 0.85; c.push(v, v, v); }
      g.setAttribute('color', new THREE.Float32BufferAttribute(c, 3));
      bushy.push({ g, m: M4(x, 0.31, z, x * 4 + z) });
    }
    G3.crop = [merge(leafy), merge(upright), merge(bushy)];
    // bed low: a block tinted by its crop (top light, sides darker) · far: border + inner quad
    const blk = box(0.98, 0.26, 1.48);
    { const P = blk.attributes.position, N = blk.attributes.normal, c = []; for (let i = 0; i < P.count; i++) { const v = N.getY(i) > 0.5 ? 1 : 0.42; c.push(v, v * 0.95, v * 0.9); } blk.setAttribute('color', new THREE.Float32BufferAttribute(c, 3)); }
    G3.bedLow = merge([{ g: blk, m: M4(0, 0.13, 0) }]);
    const q0 = new THREE.PlaneGeometry(1.05, 1.55); q0.rotateX(-PI / 2);
    const q1 = new THREE.PlaneGeometry(0.82, 1.3); q1.rotateX(-PI / 2);
    G3.bedFar = merge([{ g: q0, m: M4(0, 0.16, 0), c: [0.4, 0.36, 0.32] }, { g: q1, m: M4(0, 0.2, 0), c: '#ffffff' }]);
    // store bay door (front +z at the wall face; y = 0 at the floor)
    const door = [];
    for (const s of [-1, 1]) door.push({ g: box(0.1, 2.35, 0.12), m: M4(s * 0.55, 1.175, 0.06), c: '#5d4029' });
    door.push({ g: box(1.22, 0.16, 0.14), m: M4(0, 2.43, 0.07), c: '#5a3d27' });
    door.push({ g: box(1.0, 2.2, 0.05), m: M4(0, 1.12, 0.035), c: '#8d6c49' });
    for (const y of [0.55, 1.7]) door.push({ g: box(0.96, 0.08, 0.03), m: M4(0, y, 0.075), c: '#6b4f36' });
    door.push({ g: box(0.06, 0.16, 0.04), m: M4(0.38, 1.15, 0.08), c: '#3b3835' });
    G3.door = merge(door);
    const plate = new THREE.PlaneGeometry(0.44, 0.17);
    G3.plate = merge([{ g: plate, m: M4(0, 2.03, 0.1), c: '#ffffff' }]);
    // markers (unit local; jars are scaled with the jar so their lid is at 1.05)
    G3.stake = merge([{ g: box(0.045, 0.78, 0.045), m: M4(0, 0.39, 0), c: '#7a5a3a' }, { g: box(0.27, 0.15, 0.022), m: M4(0, 0.68, 0.03), c: '#f4efe4' }, { g: box(0.27, 0.025, 0.024), m: M4(0, 0.6, 0.03), c: '#c9b27c' }]);
    const star = new THREE.BufferGeometry(), sp = [], R0 = 0.2, R1 = 0.085;
    for (let k = 0; k < 10; k++) {
      const a0 = (k / 10) * TAU + PI / 2, a1 = ((k + 1) / 10) * TAU + PI / 2, r0 = k % 2 ? R1 : R0, r1 = k % 2 ? R0 : R1;
      for (const zf of [0.012, -0.012]) {
        const p = [0, 0, zf, Math.cos(a0) * r0, Math.sin(a0) * r0, zf, Math.cos(a1) * r1, Math.sin(a1) * r1, zf];
        if (zf < 0) sp.push(p[0], p[1], p[2], p[6], p[7], p[8], p[3], p[4], p[5]); else sp.push(...p);
      }
    }
    star.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3)); star.computeVertexNormals();
    G3.flag = merge([{ g: box(0.04, 1.3, 0.04), m: M4(0, 0.65, 0), c: '#efe7d6' }, { g: star, m: M4(0, 1.36, 0), c: '#ffc531' }, { g: box(0.05, 0.1, 0.012), m: M4(0, 1.12, 0.02), c: '#0072B2' }]);
    const cone = new THREE.ConeGeometry(0.43, 0.36, 9, 1, true); cone.translate(0, 0.18, 0);
    G3.cover = merge([{ g: cone, c: '#c3a565' }]);
    const bars = [];
    for (const s of [-1, 1]) bars.push({ g: box(1.36, 0.09, 0.045), m: M4(0, 1.15, 0.13, 0, 1, 1, 1, 0, s * 1.02), c: '#6a4f35' });
    G3.bars = merge(bars);
    // near details: 금줄 round the neck (jar local), lid stone, weeds
    const rope = [];
    const tor = new THREE.TorusGeometry(0.3, 0.022, 3, 12); tor.rotateX(PI / 2);
    rope.push({ g: tor, m: M4(0, 0.79, 0), c: '#b39a63' });
    for (let k = 0; k < 3; k++) { const a = k * 0.55 - 0.55; const pl = new THREE.PlaneGeometry(0.05, 0.14); rope.push({ g: pl, m: M4(Math.sin(a) * 0.31, 0.71, Math.cos(a) * 0.31, a), c: '#f6f3ea' }); }
    { const a = 0.95; rope.push({ g: new THREE.ConeGeometry(0.022, 0.13, 5), m: M4(Math.sin(a) * 0.32, 0.72, Math.cos(a) * 0.32, a, 1, 1, 1, PI), c: '#b3261e' }); }
    { const a = -1.0; rope.push({ g: box(0.05, 0.05, 0.04), m: M4(Math.sin(a) * 0.32, 0.74, Math.cos(a) * 0.32, a), c: '#262321' }); }
    G3.rope = merge(rope);
    const stone = new THREE.DodecahedronGeometry(0.1, 0); stone.scale(1.1, 0.5, 0.85);
    G3.stone = merge([{ g: stone, m: M4(0.07, 1.035, 0.04), c: '#8f8a80' }]);
    const weed = [];
    for (let k = 0; k < 5; k++) {
      const a = k * 1.3, h = 0.12 + 0.05 * (k % 3), g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute([-0.02 * Math.sin(a), 0, -0.02 * Math.cos(a), 0.02 * Math.sin(a), 0, 0.02 * Math.cos(a), 0.06 * Math.cos(a), h, 0.06 * Math.sin(a)], 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute([0.55, 0.6, 0.5, 0.55, 0.6, 0.5, 1, 1, 0.9], 3));
      g.computeVertexNormals();
      weed.push({ g, c: k % 2 ? '#6d8f3a' : '#7f9a45' });
    }
    G3.weed = merge(weed);
    // soft contact shadow: a hexagon fan, alpha 0.62 at the centre → 0 at the rim (vertex alpha; no texture)
    const blob = [];
    for (let k = 0; k < 6; k++) {
      const a0 = (k / 6) * TAU, a1 = ((k + 1) / 6) * TAU;
      blob.push(0, 0, 0, Math.cos(a1), 0, Math.sin(a1), Math.cos(a0), 0, Math.sin(a0));
    }
    const bg = new THREE.BufferGeometry();
    bg.setAttribute('position', new THREE.Float32BufferAttribute(blob, 3));
    bg.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(blob.length).fill(0).map((v, i) => (i % 3 === 1 ? 1 : 0)), 3));
    const ba = [];
    for (let k = 0; k < 6; k++) ba.push(1, 1, 1, 0.62, 1, 1, 1, 0, 1, 1, 1, 0);
    bg.setAttribute('color', new THREE.Float32BufferAttribute(ba, 4));
    G3.blob = bg;
    // highlight: a gold ring on the ground, a beacon column with a vertical fade, an arrow
    G3.ring = new THREE.RingGeometry(0.66, 0.82, 40); G3.ring.rotateX(-PI / 2);
    // a soft light column: clear at the jar (it never hides the unit), brightest at head height, fading upwards
    const col = new THREE.CylinderGeometry(0.4, 0.4, 14, 18, 7, true); col.translate(0, 7, 0);
    { const P = col.attributes.position, c = []; for (let i = 0; i < P.count; i++) { const y = P.getY(i), t = clamp(y / 14, 0, 1), up = clamp((y - 1.2) / 1.2, 0, 1); c.push(1, 0.86, 0.55, 0.3 * up * (1 - t) * (1 - t)); } col.setAttribute('color', new THREE.Float32BufferAttribute(c, 4)); }
    G3.column = col;
    const arrow = merge([{ g: new THREE.ConeGeometry(0.34, 0.55, 14), m: M4(0, 0, 0, 0, 1, 1, 1, PI), c: '#ffcf4a' }, { g: box(0.16, 0.45, 0.16), m: M4(0, 0.48, 0), c: '#ffcf4a' }]);
    G3.arrow = arrow;
    return G3;
  }
  const triOf = (g) => (g.index ? g.index.count : g.attributes.position.count) / 3;

  // ---------------------------------------------------------------- materials
  const STD = (o) => new THREE.MeshStandardMaterial(o);
  const LAM = (o) => new THREE.MeshLambertMaterial(o);
  const BAND = new THREE.Vector2(0.745, 0.83);
  const GLOW = { value: 0.42 };
  /** the status ribbon (neck band) + the warm glow of "mine": instance attribute aMark (rgb, w = band 0..1 + 2·glow) */
  function markPatch(m) {
    const prev = m.onBeforeCompile;
    m.onBeforeCompile = function (sh, r) {
      if (typeof prev === 'function') prev.call(this, sh, r);
      sh.uniforms.uCuBand = { value: BAND };
      sh.uniforms.uCuGlow = GLOW;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec4 aMark;\nvarying vec4 vCuMark;\nvarying float vCuY;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvCuMark = aMark; vCuY = position.y;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec4 vCuMark;\nvarying float vCuY;\nuniform vec2 uCuBand;\nuniform float uCuGlow;')
        .replace('#include <color_fragment>', `#include <color_fragment>
  float cuGlow = step(1.5, vCuMark.w);
  float cuBand = (vCuMark.w - 2.0 * cuGlow) * smoothstep(uCuBand.x - 0.006, uCuBand.x + 0.006, vCuY) * (1.0 - smoothstep(uCuBand.y - 0.006, uCuBand.y + 0.006, vCuY));
  diffuseColor.rgb = mix(diffuseColor.rgb, vCuMark.rgb, clamp(cuBand, 0.0, 1.0));`)
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n  totalEmissiveRadiance += vec3(1.0, 0.55, 0.2) * cuGlow * uCuGlow * (0.35 + 0.65 * smoothstep(0.3, 0.9, vCuY));');
    };
    const pk = m.customProgramCacheKey;
    m.customProgramCacheKey = function () { return (typeof pk === 'function' ? pk.call(this) : '') + '|cu-mark'; };
    return m;
  }
  function mats(q) {
    const low = q === 'low', M = {};
    M.jar = G.gfx.material('cu-jar-' + (low ? 'low' : 'pbr'), () => {
      if (low) return markPatch(LAM({ color: 0x8a5634, vertexColors: true }));
      const photo = !!G.mat?.usable?.('onggi_glaze');
      let map = null;
      try { map = G.bkit?.tex?.(photo ? 'jarGlaze' : 'jar') || null; } catch (e) { map = null; }
      const m = markPatch(STD({ map, vertexColors: true, roughness: 0.3, metalness: 0.04, color: map ? 0xffffff : 0x6a4128 }));
      if (photo) { try { G.mat.apply(m, 'onggi_glaze', { detail: true, tile: [1 / 2, 1], strength: 0.75, normalScale: 0.5, roughness: 0.25, env: 1.25, priority: 1 }); } catch (e) { G.log.warn(CAT, 'onggi glaze failed', e); } }
      return m;
    });
    M.leaf = G.gfx.material('cu-leaf-' + (low ? 'low' : 'pbr'), () => (low ? LAM({ vertexColors: true, side: THREE.DoubleSide }) : STD({ vertexColors: true, roughness: 0.82, side: THREE.DoubleSide })));
    M.flat = G.gfx.material('cu-flat-' + (low ? 'low' : 'pbr'), () => (low ? LAM({ vertexColors: true }) : STD({ vertexColors: true, roughness: 0.88 })));
    M.flag = G.gfx.material('cu-flag', () => { const m = (low ? LAM : STD)({ vertexColors: true, emissive: new THREE.Color('#ffb347'), ...(low ? {} : { roughness: 0.6 }) }); G.world?.addNightMaterial?.(m, 0.9, 0.18); return m; });
    let wood = null, soil = null;
    try { wood = G.bkit.mat('wood'); soil = G.bkit.mat('soil'); } catch (e) { G.log.warn(CAT, 'building kit materials missing', e); }
    M.wood = low || !wood ? M.flat : wood;
    M.soil = low || !soil ? G.gfx.material('cu-soil-flat', () => LAM({ vertexColors: true, color: 0x6b5141 })) : soil;
    M.blob = G.gfx.material('cu-blob', () => new THREE.MeshBasicMaterial({ color: 0x1c140c, vertexColors: true, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4 }));
    M.ring = G.gfx.material('cu-ring', () => new THREE.MeshBasicMaterial({ color: 0xffd36a, transparent: true, opacity: 0.9, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -6 }));
    M.glow = G.gfx.material('cu-glow', () => new THREE.MeshBasicMaterial({ color: 0xffc46b, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.BackSide }));
    M.column = G.gfx.material('cu-column', () => new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    M.arrow = G.gfx.material('cu-arrow', () => new THREE.MeshBasicMaterial({ vertexColors: true }));
    return M;
  }
  /** the plate: a strip of 10 digits; each instance shows 4 digits of aNum (the seq of its code) */
  function plateMaterial(own) {
    const cv = document.createElement('canvas'); cv.width = 640; cv.height = 72;
    const g = cv.getContext('2d');
    if (g) {
      g.fillStyle = '#efe7d2'; g.fillRect(0, 0, 640, 72);
      g.fillStyle = '#2a2018'; g.font = `700 54px ${G.bkit?.FONT || 'sans-serif'}`; g.textAlign = 'center'; g.textBaseline = 'middle';
      for (let d = 0; d < 10; d++) g.fillText(String(d), d * 64 + 32, 38);
      g.fillStyle = 'rgba(70,52,34,0.55)'; g.fillRect(0, 0, 640, 4); g.fillRect(0, 68, 640, 4);
    }
    const tex = own(new THREE.CanvasTexture(cv));
    tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
    const m = own(STD({ map: tex, roughness: 0.75 }));
    m.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aNum;\nvarying float vCuNum;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvCuNum = aNum;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vCuNum;')
        .replace('#include <map_fragment>', `#ifdef USE_MAP
  float cuU = clamp(vMapUv.x, 0.0, 0.9999) * 4.0;
  float cuSlot = floor(cuU);
  float cuD = mod(floor(floor(vCuNum + 0.5) / pow(10.0, 3.0 - cuSlot) + 0.0001), 10.0);
  vec4 sampledDiffuseColor = texture2D(map, vec2((cuD + 0.12 + fract(cuU) * 0.76) / 10.0, vMapUv.y));
  diffuseColor *= sampledDiffuseColor;
#endif`);
    };
    m.customProgramCacheKey = () => 'cu-plate';
    return m;
  }

  // ---------------------------------------------------------------- the district (one per build)
  class District {
    constructor(ctx, C) {
      this.ctx = ctx; this.C = C;
      this.q = ctx.quality || G.sys.engine?.preset?.name || 'low';
      this.root = new THREE.Group(); this.root.name = 'allot-units';
      ctx.group.add(this.root);
      this.geo = geoms();
      for (const g of Object.values(this.geo)) (Array.isArray(g) ? g : [g]).forEach((x) => ctx.own?.(x));
      this.M = mats(this.q);
      this.plateMat = plateMaterial((x) => (ctx.own ? ctx.own(x) : x));
      this.meshes = {};
      this.colliders = [];
      this.rebuilds = 0; this.statusWrites = 0; this.lastWrite = { changed: 0, written: 0 };
      this.focus = -1; this.forced = -1; this.pickT = 0; this.labelT = 0;
      this._cam = new THREE.Vector3(1e9, 0, 0); this._camQ = new THREE.Quaternion(); this._near = new THREE.Vector3(1e9, 0, 0);
      this._frustum = new THREE.Frustum(); this._pm = new THREE.Matrix4(); this._sph = new THREE.Sphere();
      this._v = new THREE.Vector3(); this._p = new THREE.Vector3();
      this.origin = new THREE.Vector3();
      ctx.group.updateMatrixWorld(true); ctx.group.getWorldPosition(this.origin);
      this.beacon = null; this.labels = []; this.labelChurn = 0;
      this.L = null; this.st = null; this.plates = null;
      this._onMap = () => this.applyMap(false);
      this._onQuality = () => { this.dirty = true; };
      G.bus?.on?.('allot:map', this._onMap); G.bus?.on?.('allot:mine', this._onMap); G.bus?.on?.('engine:quality', this._onQuality);
      this.applyMap(true);
      if (!this.hasMap) { try { const r = G.sys.allot?.refreshMap?.(); if (r && typeof r.catch === 'function') r.catch(() => {}); } catch (e) { /* the panel is optional */ } }
      this.buildBoards();
      this.buildFx();
      this.buildInteract();
      this.buildLabels();
    }
    // ------------------------------------------------------------ map state → layout + status
    source() {
      let ms = null;
      try { ms = G.sys.allot?.mapState?.() || null; } catch (e) { ms = null; }
      if (ms && ms.layout && ms.layout.count > 0 && typeof ms.layout.indexAt === 'function') return { L: ms.layout, st: ms.status && ms.status.length >= ms.layout.count ? ms.status : null, demo: !!ms.demo, v: ms.v, plates: ms.plates || ms.nameplates || null };
      return { L: this.C.current(), st: null, demo: false, v: 0, plates: null };
    }
    applyMap(first) {
      const s = this.source();
      this.demo = s.demo; this.plates = s.plates; this.hasMap = !!s.st;
      if (s.L !== this.L) { this.setLayout(s.L, s.st); return; }
      // same layout: rewrite only the units whose status changed
      const n = this.L.count, old = this.st, nw = s.st;
      let changed = 0, written = 0;
      for (let i = 0; i < n; i++) {
        const a = old[i], b = nw ? nw[i] : 0;
        if (a === b) continue;
        old[i] = b; changed++;
        this.unitLook(i);
        written += this.writeStatus(i);
      }
      this.lastWrite = { changed, written };
      this.statusWrites += written;
      if (changed) { this.markersDirty = true; this.drawBoards(); }
      else if (!first) this.drawBoards();
    }
    setLayout(L, st) {
      this.L = L; this.A = L.arrays;
      const n = L.count;
      this.st = new Uint8Array(n);
      if (st) this.st.set(st.subarray ? st.subarray(0, n) : st);
      this.prepareUnits();
      this.prepareSubcells();
      this.prepareMeshes();
      this.buildColliders();
      this.dirty = true; this.markersDirty = true; this.nearDirty = true;
      this.focus = -1;
      this.drawBoards?.();
    }
    // per-unit matrices, tints and marks
    prepareUnits() {
      const L = this.L, A = this.A, n = L.count;
      this.mat = new Float32Array(n * 16); this.tint = new Float32Array(n * 3); this.col = new Float32Array(n * 3); this.crop = new Float32Array(n * 3);
      this.mark = new Float32Array(n * 4); this.sxz = new Float32Array(n); this.sy = new Float32Array(n);
      this.where = new Int32Array(n).fill(-1); this.where2 = new Int32Array(n).fill(-1);
      this.kindCount = [0, 0, 0];
      this.slotType = (C => (C.slots || []).map((s) => s.type))(this.C);
      this.slotSys = (this.C.slots || []).map((s) => s.sys);
      const jarT = lin('#ffffff'), soilT = lin('#ffffff');
      for (let i = 0; i < n; i++) {
        const k = A.kind[i], v = A.variant[i] & 7, h = hash(i, 1);
        this.kindCount[k]++;
        let sx = 1, sy = 1, ry = A.rot[i], x = A.x[i], y = A.y[i], z = A.z[i];
        if (k === 0) {
          sx = JV[v][0] * (0.97 + 0.06 * h); sy = JV[v][1] * (0.97 + 0.05 * hash(i, 2));
          ry += (hash(i, 3) - 0.5) * 2.4;
          // fired onggi is never one colour: darker and lighter firings, a little warmer or cooler (the glaze map gives the brown)
          const tone = 0.6 + 0.26 * hash(i, 4), warm = (hash(i, 5) - 0.5) * 0.14;
          this.tint[i * 3] = jarT[0] * tone * (0.9 + warm); this.tint[i * 3 + 1] = jarT[1] * tone * 0.86; this.tint[i * 3 + 2] = jarT[2] * tone * (0.84 - warm);
        } else if (k === 1) {
          const tone = 0.88 + 0.2 * h;
          this.tint[i * 3] = soilT[0] * tone; this.tint[i * 3 + 1] = soilT[1] * tone * 0.98; this.tint[i * 3 + 2] = soilT[2] * tone * 0.95;
          const cc = lin(CROP[v][1]), t2 = 0.85 + 0.3 * hash(i, 6);
          this.crop[i * 3] = cc[0] * t2; this.crop[i * 3 + 1] = cc[1] * t2; this.crop[i * 3 + 2] = cc[2] * t2;
        } else {
          // the door stands at the wall face, half a bay depth in front of the bay's centre
          const off = (this.C.K?.BAY_D || 3) / 2;
          x += Math.sin(ry) * off; z += Math.cos(ry) * off;
          const tone = 0.85 + 0.25 * h;
          this.tint[i * 3] = tone; this.tint[i * 3 + 1] = tone * 0.97; this.tint[i * 3 + 2] = tone * 0.93;
        }
        this.sxz[i] = sx; this.sy[i] = sy;
        trs(this.mat, i * 16, x, y, z, ry, sx, sy, sx);
        this.unitLook(i);
      }
    }
    /** colour + ribbon of unit i from its status */
    unitLook(i) {
      const s = this.st[i], k = this.A.kind[i], dim = s === 3 ? 0.55 : 1;
      this.col[i * 3] = this.tint[i * 3] * dim; this.col[i * 3 + 1] = this.tint[i * 3 + 1] * dim; this.col[i * 3 + 2] = this.tint[i * 3 + 2] * dim * (s === 3 ? 1.04 : 1);
      const rb = RIBBON[s];
      if (k === 0 && rb) { const c = lin(rb); this.mark[i * 4] = c[0]; this.mark[i * 4 + 1] = c[1]; this.mark[i * 4 + 2] = c[2]; this.mark[i * 4 + 3] = 1 + (s === 4 ? 2 : 0); }
      else { this.mark[i * 4] = 0; this.mark[i * 4 + 1] = 0; this.mark[i * 4 + 2] = 0; this.mark[i * 4 + 3] = s === 4 ? 2 : 0; }
    }
    // sub-cells: 11 m buckets per kind, each with a bounding sphere (local metres)
    prepareSubcells() {
      const A = this.A, n = this.L.count, B = this.C.unitBounds || { minX: -190, minZ: -150 };
      const keyOf = (i) => A.kind[i] * 4096 + clamp(Math.floor((A.z[i] - B.minZ) / SUB), 0, 63) * 64 + clamp(Math.floor((A.x[i] - B.minX) / SUB), 0, 63);
      const map = new Map();
      for (let i = 0; i < n; i++) { const k = keyOf(i); let a = map.get(k); if (!a) { a = []; map.set(k, a); } a.push(i); }
      const keys = [...map.keys()].sort((a, b) => a - b), m = keys.length;
      const S = { n: m, kind: new Uint8Array(m), x: new Float32Array(m), y: new Float32Array(m), z: new Float32Array(m), r: new Float32Array(m),
        start: new Int32Array(m + 1), idx: new Int32Array(n), level: new Int8Array(m).fill(-2), vis: new Uint8Array(m), d: new Float32Array(m) };
      let o = 0;
      keys.forEach((k, s) => {
        const list = map.get(k);
        S.kind[s] = Math.floor(k / 4096); S.start[s] = o;
        let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
        for (const i of list) {
          S.idx[o++] = i;
          const x = A.x[i], y = A.y[i], z = A.z[i];
          if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y + 1.4 > y1) y1 = y + 1.4; if (z < z0) z0 = z; if (z > z1) z1 = z;
        }
        S.x[s] = (x0 + x1) / 2; S.y[s] = (y0 + y1) / 2; S.z[s] = (z0 + z1) / 2;
        S.r[s] = Math.hypot(x1 - x0 + 3, y1 - y0, z1 - z0 + 3) / 2;
      });
      S.start[m] = o;
      this.S = S;
    }
    // ------------------------------------------------------------ meshes
    im(name, g, mat, cap, opts = {}) {
      const old = this.meshes[name];
      if (old) { this.root.remove(old); old.dispose?.(); }
      const mesh = new THREE.InstancedMesh(g, mat, Math.max(1, cap));
      mesh.name = 'cu-' + name; mesh.count = 0; mesh.frustumCulled = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      if (opts.color !== false) { mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, cap) * 3), 3); mesh.instanceColor.setUsage(THREE.DynamicDrawUsage); }
      mesh.castShadow = !!opts.cast; mesh.receiveShadow = opts.receive !== false;
      if (opts.order != null) mesh.renderOrder = opts.order;
      mesh.visible = false;
      mesh.userData.tri = triOf(g);
      this.root.add(mesh);
      this.meshes[name] = mesh;
      return mesh;
    }
    markAttr(mesh, cap) {
      const a = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, cap) * 4), 4);
      a.setUsage(THREE.DynamicDrawUsage);
      mesh.geometry.setAttribute('aMark', a);
      return a;
    }
    prepareMeshes() {
      const [nj, np, ns] = this.kindCount, G3 = this.geo, M = this.M, low = this.q === 'low';
      // geometry clones per mesh: the instanced attributes (aMark, aNum) live on the geometry
      const g = (x) => this.ctx.own ? this.ctx.own(x.clone()) : x.clone();
      if (!low) {
        const body = this.im('jarFull', g(G3.jarBody), M.jar, nj, { cast: true });
        this.markAttr(body, nj);
        const lid = this.im('jarLid', g(G3.jarLid), M.jar, 1, { cast: true });
        lid.instanceMatrix = body.instanceMatrix; lid.instanceColor = body.instanceColor;
        lid.geometry.setAttribute('aMark', body.geometry.getAttribute('aMark'));
      }
      this.markAttr(this.im('jarLow', g(G3.jarLow), M.jar, nj, { cast: true }), nj);
      this.markAttr(this.im('jarFar', g(G3.jarFar), M.jar, nj, { cast: false }), nj);
      if (!low) {
        const fr = this.im('bedFrame', g(G3.bedFrame), M.wood, np, { cast: true });
        const so = this.im('bedSoil', g(G3.bedSoil), M.soil, np, { cast: false });
        so.instanceMatrix = fr.instanceMatrix; so.instanceColor = fr.instanceColor;
        for (let c = 0; c < 3; c++) this.im('crop' + c, g(G3.crop[c]), M.leaf, np, { cast: c !== 1 });
      }
      this.im('bedLow', g(G3.bedLow), M.flat, np, { cast: !low });
      this.im('bedFar', g(G3.bedFar), M.flat, np, { cast: false });
      this.im('door', g(G3.door), M.wood, ns, { cast: false });
      const plate = this.im('plate', g(G3.plate), this.plateMat, ns, { cast: false, color: false });
      const an = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, ns)), 1); an.setUsage(THREE.DynamicDrawUsage);
      plate.geometry.setAttribute('aNum', an);
      // markers / near details / grounding (capacities: all units of a status could be in range)
      const n = this.L.count;
      this.im('stake', g(G3.stake), M.flat, n, { cast: !low });
      this.im('flag', g(G3.flag), M.flag, Math.min(n, 2000), { cast: !low });
      this.im('cover', g(G3.cover), M.flat, nj + np, { cast: !low });
      this.im('bars', g(G3.bars), M.wood, ns, { cast: false });
      if (!low) {
        this.im('rope', g(G3.rope), M.flat, 1500, { cast: false });
        this.im('stone', g(G3.stone), M.flat, 1500, { cast: true });
        this.im('weed', g(G3.weed), M.leaf, 2500, { cast: false });
      }
      // grounding: every jar and bed, written once per layout
      const blob = this.im('blob', g(G3.blob), M.blob, nj + np, { cast: false, receive: false, color: false, order: 1 });
      const A = this.A, arr = blob.instanceMatrix.array;
      let b = 0;
      for (let i = 0; i < n; i++) {
        const k = A.kind[i];
        if (k === 2) continue;
        const s = k === 0 ? 0.7 * this.sxz[i] : 0;
        if (k === 0) trs(arr, b * 16, A.x[i], A.y[i] + 0.04, A.z[i], A.rot[i], s, 1, s);
        else trs(arr, b * 16, A.x[i], A.y[i] + 0.04, A.z[i], A.rot[i], 0.72, 1, 0.98);
        b++;
      }
      blob.count = b; blob.visible = b > 0; blob.instanceMatrix.needsUpdate = true;
    }
    // ------------------------------------------------------------ level of detail + culling
    cfg() { return LOD[G.sys.engine?.preset?.name || this.q] || LOD[this.q] || LOD.medium; }
    update(dt, t) {
      if (!this.L) return;
      const cam = G.sys.engine?.camera;
      if (!cam) return;
      cam.updateMatrixWorld();
      const cp = this._v.setFromMatrixPosition(cam.matrixWorld);
      const lx = cp.x - this.origin.x, ly = cp.y - this.origin.y, lz = cp.z - this.origin.z;
      const moved = Math.hypot(lx - this._cam.x, ly - this._cam.y, lz - this._cam.z), turned = 1 - Math.abs(this._camQ.dot(cam.quaternion));
      if (this.dirty || moved > 0.6 || turned > 0.0004) {
        this._cam.set(lx, ly, lz); this._camQ.copy(cam.quaternion);
        this.evalLevels(cam, lx, ly, lz);
      }
      if (this.markersDirty) this.buildMarkers();
      const nearCfg = this.cfg().near;
      if (nearCfg > 0 && (this.nearDirty || Math.hypot(lx - this._near.x, lz - this._near.z) > 3)) { this._near.set(lx, ly, lz); this.buildNear(lx, lz, nearCfg); }
      this.pickT -= dt;
      if (this.pickT <= 0) { this.pickT = 0.12; this.pickUpdate(); }
      this.labelT -= dt;
      if (this.labelT <= 0) { this.labelT = 0.3; this.labelUpdate(); }
      this.fxUpdate(dt, t);
    }
    evalLevels(cam, lx, ly, lz) {
      const S = this.S, c = this.cfg(), o = this.origin;
      this._pm.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
      this._frustum.setFromProjectionMatrix(this._pm);
      const changed = [false, false, false];
      const th = [c.jar, c.plot, c.store];
      let force = this.dirty;
      for (let s = 0; s < S.n; s++) {
        const dx = S.x[s] - lx, dy = S.y[s] - ly, dz = S.z[s] - lz;
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz) - S.r[s] * 0.5;
        S.d[s] = d;
        const T = th[S.kind[s]], prev = S.level[s];
        let lev = d < T[0] ? 0 : d < T[1] ? 1 : 2;
        if (prev >= 0 && prev !== lev) {                       // hysteresis: stay unless HYST past the ring
          if (lev > prev && d < T[prev] + HYST) lev = prev;
          else if (lev < prev && d > T[lev] - HYST) lev = prev;
        }
        this._sph.center.set(S.x[s] + o.x, S.y[s] + o.y, S.z[s] + o.z); this._sph.radius = S.r[s] + 2.5;
        const vis = this._frustum.intersectsSphere(this._sph) ? 1 : 0;
        if (lev !== prev || vis !== S.vis[s]) { changed[S.kind[s]] = true; S.level[s] = lev; S.vis[s] = vis; }
      }
      for (let k = 0; k < 3; k++) if (changed[k] || force) this.rebuildKind(k);
      if (changed[0] || changed[1] || changed[2] || force) { this.markersDirty = true; this.nearDirty = true; }
      this.dirty = false;
    }
    /** rewrite the instance buffers of one kind from the sub-cell levels (in place; counts change) */
    rebuildKind(k) {
      const S = this.S, A = this.A, ms = this.meshes, low = this.q === 'low';
      this.rebuilds++;
      const W = this.where, W2 = this.where2;
      if (k === 0) {
        const tgt = [low ? ms.jarLow : ms.jarFull, ms.jarLow, ms.jarFar], cnt = [0, 0, 0];
        const arr = tgt.map((m) => m.instanceMatrix.array), cols = tgt.map((m) => m.instanceColor.array), mk = tgt.map((m) => m.geometry.getAttribute('aMark').array);
        for (let s = 0; s < S.n; s++) {
          if (S.kind[s] !== 0) continue;
          const lev = S.level[s];
          for (let p = S.start[s]; p < S.start[s + 1]; p++) {
            const i = S.idx[p];
            if (!S.vis[s]) { W[i] = -1; continue; }
            const L = low && lev === 0 ? 1 : lev, j = cnt[L]++;
            copy16(arr[L], j * 16, this.mat, i * 16); copy3(cols[L], j * 3, this.col, i * 3); copy4(mk[L], j * 4, this.mark, i * 4);
            W[i] = (L << 24) | j;
          }
        }
        tgt.forEach((m, L) => { if (low && L === 0) return; this.commit(m, cnt[L]); this.commitAttr(m.geometry.getAttribute('aMark'), cnt[L], 4); });
        if (!low) { ms.jarLid.count = ms.jarFull.count; ms.jarLid.visible = ms.jarFull.visible; }
      } else if (k === 1) {
        const full = low ? null : ms.bedFrame, crops = low ? [] : [ms.crop0, ms.crop1, ms.crop2];
        const cnt = [0, 0, 0], cc = [0, 0, 0];
        const lowA = ms.bedLow, farA = ms.bedFar;
        for (let s = 0; s < S.n; s++) {
          if (S.kind[s] !== 1) continue;
          const lev = S.level[s];
          for (let p = S.start[s]; p < S.start[s + 1]; p++) {
            const i = S.idx[p];
            W2[i] = -1;
            if (!S.vis[s]) { W[i] = -1; continue; }
            const L = low && lev === 0 ? 1 : lev;
            if (L === 0) {
              const j = cnt[0]++;
              copy16(full.instanceMatrix.array, j * 16, this.mat, i * 16); copy3(full.instanceColor.array, j * 3, this.col, i * 3);
              W[i] = j;
              const cr = CROP[A.variant[i] & 7][0];
              if (cr >= 0 && this.st[i] !== 3) {
                const m = crops[cr], q = cc[cr]++;
                copy16(m.instanceMatrix.array, q * 16, this.mat, i * 16); copy3(m.instanceColor.array, q * 3, this.crop, i * 3);
                W2[i] = (cr << 24) | q;
              }
            } else {
              const m = L === 1 ? lowA : farA, j = cnt[L]++;
              copy16(m.instanceMatrix.array, j * 16, this.mat, i * 16);
              this.lowBedColor(m.instanceColor.array, j * 3, i);
              W[i] = (L << 24) | j;
            }
          }
        }
        if (full) { this.commit(full, cnt[0]); ms.bedSoil.count = full.count; ms.bedSoil.visible = full.visible; crops.forEach((m, c) => this.commit(m, cc[c])); }
        this.commit(lowA, cnt[1]); this.commit(farA, cnt[2]);
      } else {
        const door = ms.door, plate = ms.plate, an = plate.geometry.getAttribute('aNum').array;
        let nd = 0, np = 0;
        for (let s = 0; s < S.n; s++) {
          if (S.kind[s] !== 2) continue;
          const lev = S.level[s];
          for (let p = S.start[s]; p < S.start[s + 1]; p++) {
            const i = S.idx[p];
            if (!S.vis[s]) { W[i] = -1; W2[i] = -1; continue; }
            const j = nd++;
            copy16(door.instanceMatrix.array, j * 16, this.mat, i * 16); copy3(door.instanceColor.array, j * 3, this.col, i * 3);
            W[i] = j; W2[i] = -1;
            if (lev === 0) { const q = np++; copy16(plate.instanceMatrix.array, q * 16, this.mat, i * 16); an[q] = A.seq[i] % 10000; W2[i] = q; }
          }
        }
        this.commit(door, nd); this.commit(plate, np); this.commitAttr(plate.geometry.getAttribute('aNum'), np, 1);
      }
    }
    lowBedColor(dst, o, i) {
      const cr = CROP[this.A.variant[i] & 7][0], closed = this.st[i] === 3;
      const src = cr < 0 || closed ? this.col : this.crop;
      dst[o] = src[i * 3] * (cr < 0 ? 0.62 : 1); dst[o + 1] = src[i * 3 + 1] * (cr < 0 ? 0.52 : 1); dst[o + 2] = src[i * 3 + 2] * (cr < 0 ? 0.42 : 1);
    }
    commit(m, n) {
      m.count = n; m.visible = n > 0;
      const a = m.instanceMatrix;
      a.clearUpdateRanges?.(); a.addUpdateRange?.(0, n * 16); a.needsUpdate = true;
      if (m.instanceColor) { const c = m.instanceColor; c.clearUpdateRanges?.(); c.addUpdateRange?.(0, n * 3); c.needsUpdate = true; }
    }
    commitAttr(a, n, size) { if (!a) return; a.clearUpdateRanges?.(); a.addUpdateRange?.(0, n * size); a.needsUpdate = true; }
    /** status of unit i changed: rewrite its drawn entries only → number of entries written */
    writeStatus(i) {
      const k = this.A.kind[i], w = this.where[i], ms = this.meshes, low = this.q === 'low';
      if (w < 0) return 0;
      const part = (a, j, size, src, si) => { for (let q = 0; q < size; q++) a.array[j * size + q] = src[si * size + q]; a.addUpdateRange?.(j * size, size); a.needsUpdate = true; };
      if (k === 0) {
        const L = w >>> 24, j = w & 0xffffff, m = [low ? ms.jarLow : ms.jarFull, ms.jarLow, ms.jarFar][L];
        part(m.instanceColor, j, 3, this.col, i); part(m.geometry.getAttribute('aMark'), j, 4, this.mark, i);
        return 1;
      }
      if (k === 1) {
        const L = w >>> 24, j = w & 0xffffff;
        if (L === 0 && !low) {
          part(ms.bedFrame.instanceColor, j, 3, this.col, i);
          // a closed bed loses its crop (straw cover instead): that list changes size → rebuild the plots
          const crop = CROP[this.A.variant[i] & 7][0] >= 0;
          if (crop && (this.where2[i] < 0) !== (this.st[i] === 3)) this.rebuildKind(1);
        } else {
          const m = L === 1 ? ms.bedLow : ms.bedFar, a = m.instanceColor;
          this.lowBedColor(a.array, j * 3, i); a.addUpdateRange?.(j * 3, 3); a.needsUpdate = true;
        }
        return 1;
      }
      part(ms.door.instanceColor, w, 3, this.col, i);
      return 1;
    }
    // ------------------------------------------------------------ markers (stakes, flags, covers, bars)
    buildMarkers() {
      this.markersDirty = false;
      const S = this.S, A = this.A, c = this.cfg(), ms = this.meshes, st = this.st, M = this.mat;
      const stake = ms.stake, flag = ms.flag, cover = ms.cover, bars = ms.bars;
      let ns = 0, nf = 0, nc = 0, nb = 0;
      const sa = stake.instanceMatrix.array, scol = stake.instanceColor.array, fa = flag.instanceMatrix.array, ca = cover.instanceMatrix.array, ba = bars.instanceMatrix.array;
      const fcap = flag.instanceMatrix.count, held = lin('#E69F00'), white = [1, 1, 1];
      const at = (arr, o, i, lx, ly, lz, ry, s, sy2) => {     // a marker at (lx, ly, lz) in unit i's frame (unit scale kept)
        const b = i * 16, sx = this.sxz[i], sy = this.sy[i];
        const c0 = M[b] / sx, s0 = M[b + 8] / sx;               // cos / sin of the unit's turn
        const x = M[b + 12] + (lx * c0 + lz * s0) * sx, z = M[b + 14] + (-lx * s0 + lz * c0) * sx, y = M[b + 13] + ly * sy;
        trs(arr, o, x, y, z, Math.atan2(s0, c0) + ry, s, sy2 == null ? s : sy2, s);
      };
      for (let s = 0; s < S.n; s++) {
        if (!S.vis[s]) continue;
        const d = S.d[s], k = S.kind[s];
        const stakeOn = d < c.stake, coverOn = d < c.cover;
        for (let p = S.start[s]; p < S.start[s + 1]; p++) {
          const i = S.idx[p], v = st[i];
          if (v === 0) continue;
          if (v === 4 && nf < fcap) {
            const o = nf++ * 16;
            if (k === 0) at(fa, o, i, 0.36, 0, 0.42, 0, 1); else if (k === 1) at(fa, o, i, 0.42, 0.18, 0.7, 0, 1); else at(fa, o, i, 0.62, 0.0, 0.25, 0, 1);
            continue;
          }
          if ((v === 1 || v === 2) && stakeOn) {
            const o = ns++;
            if (k === 0) at(sa, o * 16, i, -0.36, 0, 0.44, 0.3, 1); else if (k === 1) at(sa, o * 16, i, -0.36, 0.1, 0.78, 0, 1); else at(sa, o * 16, i, 0, 0.98, 0.1, 0, 0.9);
            const tc = v === 1 ? held : white; scol[o * 3] = tc[0]; scol[o * 3 + 1] = tc[1]; scol[o * 3 + 2] = tc[2];
            continue;
          }
          if (v === 3 && coverOn) {
            if (k === 0) at(ca, nc++ * 16, i, 0, 0.84, 0, 0, 1, 1);
            else if (k === 1) at(ca, nc++ * 16, i, 0, 0.17, 0, 0, 1, 0.42);
            else at(ba, nb++ * 16, i, 0, 0, 0, 0, 1);
          }
        }
      }
      // plots under a cover are wider than a jar: scale the cone by the bed (written above with s = 1)
      this.commit(stake, ns); this.commit(flag, nf); this.commit(cover, nc); this.commit(bars, nb);
      if (cover.count) { const a = cover.instanceMatrix.array; for (let j = 0; j < nc; j++) { const sy = a[j * 16 + 5]; if (sy < 0.5) { for (const q of [0, 2]) a[j * 16 + q] *= 1.45; for (const q of [8, 10]) a[j * 16 + q] *= 2.0; } } }
      this.markerCounts = { stake: ns, flag: nf, cover: nc, bars: nb };
    }
    // ------------------------------------------------------------ near details (rope, lid stones, weeds) within ~25 m
    buildNear(cx, cz, R) {
      this.nearDirty = false;
      const ms = this.meshes;
      if (!ms.rope) return;
      const S = this.S, A = this.A, M = this.mat, R2 = R * R;
      const ra = ms.rope.instanceMatrix.array, sa = ms.stone.instanceMatrix.array, wa = ms.weed.instanceMatrix.array;
      const rcap = ms.rope.instanceMatrix.count, scap = ms.stone.instanceMatrix.count, wcap = ms.weed.instanceMatrix.count;
      let nr = 0, ns = 0, nw = 0;
      for (let s = 0; s < S.n; s++) {
        if (!S.vis[s] || S.kind[s] === 2) continue;
        const dx = S.x[s] - cx, dz = S.z[s] - cz;
        if (Math.hypot(dx, dz) - S.r[s] > R) continue;
        for (let p = S.start[s]; p < S.start[s + 1]; p++) {
          const i = S.idx[p], ux = A.x[i] - cx, uz = A.z[i] - cz;
          if (ux * ux + uz * uz > R2) continue;
          const b = i * 16;
          if (A.kind[i] === 0) {
            if (this.st[i] === 3) continue;
            const v = A.variant[i] & 7, h = hash(i, 9);
            if ((h < 0.09 || (this.st[i] === 4 && h < 0.5)) && nr < rcap) { copy16(ra, nr * 16, M, b); nr++; }
            if (v >= 6 && ns < scap) { copy16(sa, ns * 16, M, b); ns++; }
            // weeds at the kerbs: the inner row of a band (j = 0) towards the walk inside, the outer row (j = 2) outside
            const j = ((A.ring[i] % 3) + 3) % 3;
            if (this.slotType[A.slot[i]] === 'ring' && j !== 1 && hash(i, 11) < 0.55 && nw < wcap) {
              const f = j === 0 ? 1 : -1, ry = A.rot[i], sx = Math.sin(ry), sz = Math.cos(ry), off = 0.62 + 0.15 * hash(i, 12), lat = (hash(i, 13) - 0.5) * 0.9;
              trs(wa, nw * 16, A.x[i] + sx * off * f + sz * lat, A.y[i] + 0.01, A.z[i] + sz * off * f - sx * lat, hash(i, 14) * TAU, 0.8 + 0.6 * hash(i, 15), 0.8 + 0.6 * hash(i, 16), 0.8 + 0.6 * hash(i, 15));
              nw++;
            }
          } else if (A.kind[i] === 1 && hash(i, 17) < 0.35 && nw < wcap) {
            const ry = A.rot[i], c0 = Math.cos(ry), s0 = Math.sin(ry), lx = (hash(i, 18) < 0.5 ? -1 : 1) * 0.56, lz = (hash(i, 19) - 0.5) * 1.3;
            trs(wa, nw * 16, A.x[i] + lx * c0 + lz * s0, A.y[i] + 0.01, A.z[i] - lx * s0 + lz * c0, hash(i, 20) * TAU, 1, 0.9 + 0.5 * hash(i, 21), 1);
            nw++;
          }
        }
      }
      ms.rope.count = nr; ms.stone.count = ns; ms.weed.count = nw;
      this.commit(ms.rope, nr); this.commit(ms.stone, ns); this.commit(ms.weed, nw);
      // tints: rope straw / stone grey / weeds green — instance colours stay white (vertex colours carry them)
      for (const m of [ms.rope, ms.stone, ms.weed]) { const a = m.instanceColor.array; for (let q = 0; q < m.count * 3; q++) a[q] = 1; }
      this.nearCounts = { rope: nr, stone: ns, weed: nw };
    }
    // ------------------------------------------------------------ colliders (aisle-level strips)
    buildColliders() {
      const ctx = this.ctx;
      for (const id of this.colliders) { try { G.world.removeCollider(id); } catch (e) { /* gone */ } }
      this.colliders = [];
      const A = this.A, n = this.L.count, rings = this.C.rings || {}, add = (c) => { const id = ctx.addCollider({ ...c, shape: 'box', tag: 'allot-units' }); if (id) this.colliders.push(id); };
      const JR = (this.C.K?.JAR_R || 0.45) + 0.02;
      // ring bands: (sys, sector, group of three rows)
      const groups = new Map();
      for (let i = 0; i < n; i++) {
        const si = A.slot[i];
        if (this.slotType[si] !== 'ring') continue;
        const sys = this.slotSys[si], R = rings[sys];
        if (!R) continue;
        const dx = A.x[i] - R.cx, dz = A.z[i] - R.cz, r = Math.hypot(dx, dz);
        let a = Math.atan2(dz, dx); if (a < 0) a += TAU;
        const sec = Math.min(7, Math.floor(a / (PI / 4))), grp = Math.floor(A.ring[i] / 3);
        const key = `${sys}:${sec}:${grp}`;
        let g = groups.get(key);
        if (!g) { g = { R, amin: Infinity, amax: -Infinity, rmin: Infinity, rmax: -Infinity }; groups.set(key, g); }
        if (a < g.amin) g.amin = a; if (a > g.amax) g.amax = a; if (r < g.rmin) g.rmin = r; if (r > g.rmax) g.rmax = r;
      }
      for (const g of groups.values()) {
        const rin = g.rmin - JR, rout = g.rmax + JR, rmid = (rin + rout) / 2;
        const pad = JR / rmid, a0 = g.amin - pad, a1 = g.amax + pad, len = (a1 - a0) * rmid;
        const piece = clamp(Math.sqrt(8 * rin * 0.12), 2.4, 7), pieces = Math.max(1, Math.ceil(len / piece)), da = (a1 - a0) / pieces;
        for (let k = 0; k < pieces; k++) {
          const am = a0 + (k + 0.5) * da, half = da / 2, rOut = rout * Math.cos(half), rc = (rin + rOut) / 2;
          add({ x: g.R.cx + Math.cos(am) * rc, z: g.R.cz + Math.sin(am) * rc, hw: rout * Math.sin(half) + 0.02, hd: (rOut - rin) / 2, rot: Math.atan2(Math.cos(am), Math.sin(am)) });
        }
      }
      // grid strips: (slot, row pair) → runs along the row split at the cross aisles
      const strips = new Map();
      for (let i = 0; i < n; i++) {
        const si = A.slot[i];
        if (this.slotType[si] === 'ring') continue;
        const key = si * 100000 + Math.floor(A.ring[i] / 2);
        let s = strips.get(key);
        if (!s) { s = []; strips.set(key, s); }
        s.push(i);
      }
      const HALF = [[JR, JR], [0.5, 0.75], [0.6, 1.5]];          // [along the row, across] half sizes by kind (+ over: below)
      for (const list of strips.values()) {
        const i0 = list[0], ry = A.rot[i0], tx = Math.cos(ry), tz = -Math.sin(ry), fx = Math.sin(ry), fz = Math.cos(ry);
        const over = this.C.slots?.[A.slot[i0]]?.id === 'OVER';
        const hs = over ? [0.7, 0.7] : HALF[A.kind[i0]];
        const items = list.map((i) => ({ u: A.x[i] * tx + A.z[i] * tz, v: A.x[i] * fx + A.z[i] * fz })).sort((a, b) => a.u - b.u);
        const gaps = [];
        for (let k = 1; k < items.length; k++) { const gp = items[k].u - items[k - 1].u; if (gp > 0.3) gaps.push(gp); }   // the two rows of a pair share u
        const pitch = gaps.length ? gaps.sort((a, b) => a - b)[Math.floor(gaps.length / 4)] : 1;
        let start = 0;
        const flush = (endK) => {
          let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
          for (let k = start; k <= endK; k++) { const it = items[k]; if (it.u < u0) u0 = it.u; if (it.u > u1) u1 = it.u; if (it.v < v0) v0 = it.v; if (it.v > v1) v1 = it.v; }
          u0 -= hs[0]; u1 += hs[0]; v0 -= hs[1]; v1 += hs[1];
          const uc = (u0 + u1) / 2, vc = (v0 + v1) / 2;
          add({ x: uc * tx + vc * fx, z: uc * tz + vc * fz, hw: (u1 - u0) / 2, hd: (v1 - v0) / 2, rot: ry });
        };
        for (let k = 1; k < items.length; k++) if (items[k].u - items[k - 1].u > pitch * 1.5 + 0.05) { flush(k - 1); start = k; }
        flush(items.length - 1);
      }
    }
    // ------------------------------------------------------------ counts + boards
    counts() {
      const out = {};
      for (const k of [...KINDS, 'all']) out[k] = { total: 0, open: 0, held: 0, leased: 0, taken: 0, closed: 0, mine: 0 };
      if (!this.L) return out;
      const A = this.A, st = this.st;
      for (let i = 0; i < this.L.count; i++) {
        const o = out[KINDS[A.kind[i]]], s = ST_KEYS[st[i]];
        o.total++; out.all.total++; o[s]++; out.all[s]++;
      }
      for (const k of [...KINDS, 'all']) { const o = out[k]; o.taken = o.held + o.leased + o.mine; }
      return out;
    }
    buildBoards() {
      const ctx = this.ctx, B = G.bkit && new G.bkit.Bucket(), C = this.C, H = C.height;
      if (!B) return;
      const sp = C.spawn || { x: -60, z: 41 };
      // entrance board: front-right of the arrival spot, turned to it · centre board: the plaza of the great circle (two faces)
      const gc = C.rings?.GC || { cx: 14, cz: 52 };
      const spots = [
        { id: 'entrance', x: sp.x + 7.5, z: sp.z - 6.5, faces: 1 },
        { id: 'centre', x: gc.cx, z: gc.cz - 5.2, faces: 2 },
      ];
      spots[0].rot = Math.atan2(sp.x - spots[0].x, sp.z - spots[0].z);
      spots[1].rot = -PI / 4;
      const W = 3.2, Hh = 2.0, base = 0.9;
      this.boards = [];
      const own = (x) => (ctx.own ? ctx.own(x) : x);
      for (const s of spots) {
        const y = H(s.x, s.z), m = M4(s.x, y, s.z, s.rot);
        const add = (key, g, mm, c) => B.add(key, g, new THREE.Matrix4().multiplyMatrices(m, mm), c);
        for (const sx of [-1, 1]) add('wood', box(0.2, base + Hh + 0.55, 0.2), M4(sx * (W / 2 + 0.12), (base + Hh + 0.55) / 2, 0), '#6a4a2e');
        add('wood', box(W + 0.5, 0.14, 0.24), M4(0, base + Hh + 0.12, 0), '#5c3f27');
        add('wood', box(W + 0.24, 0.1, 0.16), M4(0, base - 0.05, 0), '#5c3f27');
        add('wood', box(W + 0.24, Hh + 0.1, 0.06), M4(0, base + Hh / 2, 0), '#7d5b3b');
        for (const sz of [-1, 1]) add('wood', box(W + 1.1, 0.07, 0.62), M4(0, base + Hh + 0.42, sz * 0.24, 0, 1, 1, 1, sz * 0.42), '#3f3a36');
        add('wood', box(W + 1.1, 0.1, 0.1), M4(0, base + Hh + 0.56, 0), '#2f2b28');
        ctx.addCollider({ shape: 'box', x: s.x, z: s.z, hw: W / 2 + 0.3, hd: 0.3, rot: s.rot, tag: 'allot-board' });
        this.boards.push({ ...s, y });
      }
      const g = new THREE.Group(); g.name = 'cu-boards';
      B.build(g, { ao: false });
      g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      this.root.add(g);
      // faces: one canvas texture for both boards
      const low = this.q === 'low';
      const cv = document.createElement('canvas'); cv.width = low ? 768 : 1024; cv.height = low ? 480 : 640;
      this.boardCanvas = cv;
      const tex = own(new THREE.CanvasTexture(cv)); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
      this.boardTex = tex;
      const fm = own((low ? LAM : STD)({ map: tex, emissiveMap: tex, emissive: new THREE.Color('#ffffff'), ...(low ? {} : { roughness: 0.86 }) }));
      G.world?.addNightMaterial?.(fm, 0.5, 0.06);
      const parts = [];
      for (const b of this.boards) {
        for (let f = 0; f < b.faces; f++) {
          const q = new THREE.PlaneGeometry(W, Hh);
          parts.push({ g: q, m: new THREE.Matrix4().multiplyMatrices(M4(b.x, b.y, b.z, b.rot + f * PI), M4(0, base + Hh / 2, 0.035)) });
        }
      }
      const face = new THREE.Mesh(own(merge(parts)), fm);
      face.name = 'cu-board-faces'; face.receiveShadow = true;
      this.root.add(face);
      this.boardMeshes = [g, face];
      // a board opens the map (the panel when present)
      for (const b of this.boards) {
        const fx = Math.sin(b.rot), fz = Math.cos(b.rot);
        ctx.interact?.({ id: 'cu-board-' + b.id, kind: 'board', label: '📋 분양 현황판', kidLabel: '현황판 보기', emoji: '📋', radius: 3.4,
          position: { x: b.x + fx * 0.6, y: base + Hh / 2, z: b.z + fz * 0.6 }, highlight: false,
          onInteract: () => { if (G.sys.allot?.open) G.sys.allot.open('map'); else say('여기서 빈 자리와 분양된 자리를 셀 수 있어요.'); } });
      }
      this.drawBoards();
    }
    drawBoards() {
      const cv = this.boardCanvas;
      if (!cv) return;
      const g = cv.getContext('2d');
      if (!g) return;
      const w = cv.width, h = cv.height, k = w / 1024, F = G.bkit?.FONT || 'sans-serif', cnt = this.counts();
      g.fillStyle = '#f3ead6'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#4a321e'; g.fillRect(0, 0, w, 104 * k);
      g.fillStyle = '#fff6e2'; g.font = `800 ${54 * k}px ${F}`; g.textBaseline = 'middle'; g.textAlign = 'left';
      g.fillText('만장대 단지 · 분양 현황', 34 * k, 54 * k);
      g.textAlign = 'right'; g.font = `600 ${26 * k}px ${F}`; g.fillStyle = '#f2d9a8';
      g.fillText(this.demo ? '체험용 숫자예요' : '새 소식이 오면 바뀌어요', w - 30 * k, 56 * k);
      // column heads with shapes (colour is never the only sign)
      const cols = [['전체', 'all', '#4a3b2e'], ['빈 자리', 'open', '#009E73'], ['분양 중', 'taken', '#7d6e60'], ['내 것', 'mine', '#0072B2']];
      const x0 = 300 * k, cw = 180 * k, rowH = 150 * k, top = 128 * k;
      g.textAlign = 'center';
      cols.forEach(([t, , c], ci) => {
        const cx = x0 + cw * ci + cw / 2;
        this.shape(g, ci, cx - 52 * k, top + 26 * k, 13 * k, c);
        g.fillStyle = '#3b2a1c'; g.font = `700 ${30 * k}px ${F}`; g.fillText(t, cx + 12 * k, top + 26 * k);
      });
      const rows = [['jar', '항아리'], ['plot', '밭'], ['store', '창고']];
      rows.forEach(([kind, name], ri) => {
        const y = top + 60 * k + ri * rowH;
        g.fillStyle = ri % 2 ? 'rgba(122,90,55,0.07)' : 'rgba(122,90,55,0.13)'; g.fillRect(16 * k, y, w - 32 * k, rowH - 10 * k);
        this.icon(g, kind, 74 * k, y + rowH / 2 - 5 * k, 46 * k);
        g.fillStyle = '#2f2117'; g.font = `800 ${46 * k}px ${F}`; g.textAlign = 'left'; g.fillText(name, 120 * k, y + rowH / 2 - 5 * k);
        g.textAlign = 'center';
        const c = cnt[kind];
        cols.forEach(([, key, colr], ci) => {
          const v = key === 'all' ? c.total : key === 'taken' ? c.held + c.leased : c[key];
          g.fillStyle = ci === 0 ? '#2f2117' : colr; g.font = `800 ${(ci === 0 ? 50 : 56) * k}px ${F}`;
          g.fillText(Number(v || 0).toLocaleString('ko-KR'), x0 + cw * ci + cw / 2, y + rowH / 2 - 5 * k);
        });
      });
      g.fillStyle = '#5a4430'; g.font = `600 ${24 * k}px ${F}`; g.textAlign = 'center';
      g.fillText('가까이 가서 보면 자리 번호를 알 수 있어요', w / 2, h - 26 * k);
      if (this.boardTex) this.boardTex.needsUpdate = true;
    }
    shape(g, i, x, y, r, c) {
      g.fillStyle = c; g.strokeStyle = c; g.lineWidth = r * 0.35;
      g.beginPath();
      if (i === 0) { g.rect(x - r, y - r, r * 2, r * 2); g.stroke(); return; }
      if (i === 1) { g.arc(x, y, r, 0, TAU); g.fill(); return; }
      if (i === 2) { g.moveTo(x, y - r * 1.15); g.lineTo(x + r * 1.15, y); g.lineTo(x, y + r * 1.15); g.lineTo(x - r * 1.15, y); g.closePath(); g.fill(); return; }
      for (let q = 0; q < 10; q++) { const a = -PI / 2 + q * PI / 5, rr = q % 2 ? r * 0.48 : r * 1.25; if (q === 0) g.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); else g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); }
      g.closePath(); g.fill();
    }
    icon(g, kind, x, y, s) {
      g.save(); g.translate(x, y);
      if (kind === 'jar') {
        g.fillStyle = '#5b3420'; g.beginPath(); g.moveTo(-s * 0.22, s * 0.5); g.bezierCurveTo(-s * 0.62, s * 0.2, -s * 0.5, -s * 0.32, -s * 0.24, -s * 0.38); g.lineTo(s * 0.24, -s * 0.38);
        g.bezierCurveTo(s * 0.5, -s * 0.32, s * 0.62, s * 0.2, s * 0.22, s * 0.5); g.closePath(); g.fill();
        g.fillStyle = '#7a4a2c'; g.beginPath(); g.ellipse(0, -s * 0.42, s * 0.3, s * 0.1, 0, 0, TAU); g.fill();
        g.fillStyle = 'rgba(255,230,190,0.35)'; g.beginPath(); g.ellipse(-s * 0.16, -s * 0.06, s * 0.08, s * 0.2, -0.3, 0, TAU); g.fill();
      } else if (kind === 'plot') {
        g.fillStyle = '#7a5a3a'; g.fillRect(-s * 0.55, s * 0.18, s * 1.1, s * 0.3);
        g.fillStyle = '#3f8a3a';
        for (const dx of [-0.3, 0, 0.3]) { g.beginPath(); g.ellipse(dx * s - s * 0.08, 0, s * 0.1, s * 0.22, -0.5, 0, TAU); g.fill(); g.beginPath(); g.ellipse(dx * s + s * 0.08, 0, s * 0.1, s * 0.22, 0.5, 0, TAU); g.fill(); }
      } else {
        g.fillStyle = '#6e5238'; g.fillRect(-s * 0.48, -s * 0.38, s * 0.96, s * 0.86);
        g.fillStyle = '#3f3a36'; g.beginPath(); g.moveTo(-s * 0.62, -s * 0.36); g.lineTo(0, -s * 0.66); g.lineTo(s * 0.62, -s * 0.36); g.closePath(); g.fill();
        g.fillStyle = '#c7a473'; g.fillRect(-s * 0.18, -s * 0.06, s * 0.36, s * 0.54);
      }
      g.restore();
    }
    // ------------------------------------------------------------ highlight + beacon
    buildFx() {
      const G3 = this.geo, M = this.M;
      this.ring = new THREE.Mesh(G3.ring, M.ring); this.ring.name = 'cu-focus-ring'; this.ring.visible = false; this.ring.renderOrder = 3;
      this.glow = new THREE.Mesh(G3.jarLow, M.glow); this.glow.name = 'cu-focus-glow'; this.glow.visible = false; this.glow.renderOrder = 4;
      this.root.add(this.ring, this.glow);
      const col = new THREE.Mesh(G3.column, M.column), arrow = new THREE.Mesh(G3.arrow, M.arrow);
      col.name = 'cu-beacon-column'; arrow.name = 'cu-beacon-arrow';
      col.renderOrder = 5;
      const bg = new THREE.Group(); bg.name = 'cu-beacon'; bg.visible = false; bg.add(col, arrow);
      this.beaconGroup = bg; this.beaconArrow = arrow;
      this.root.add(bg);
    }
    showFocus(i) {
      const A = this.A, r = this.ring, gl = this.glow;
      if (i < 0) { r.visible = false; gl.visible = false; return; }
      const k = A.kind[i], b = i * 16, M = this.mat;
      const x = M[b + 12], y = M[b + 13], z = M[b + 14], ry = A.rot[i];
      r.position.set(x, y + 0.05, z); r.rotation.set(0, ry, 0);
      if (k === 0) { r.scale.setScalar(this.sxz[i]); gl.geometry = this.geo.jarLow; gl.position.set(x, y - 0.02, z); gl.rotation.set(0, ry, 0); gl.scale.set(this.sxz[i] * 1.14, this.sy[i] * 1.08, this.sxz[i] * 1.14); }
      else if (k === 1) { r.scale.set(0.95, 1, 1.25); gl.geometry = this.geo.bedLow; gl.position.set(x, y - 0.01, z); gl.rotation.set(0, ry, 0); gl.scale.set(1.12, 1.25, 1.08); }
      else { r.scale.set(1.0, 1, 0.7); r.position.set(x + Math.sin(ry) * 0.8, y + 0.05, z + Math.cos(ry) * 0.8); gl.geometry = this.geo.door; gl.position.set(x, y, z); gl.rotation.set(0, ry, 0); gl.scale.set(1.06, 1.04, 1.6); }
      r.visible = true; gl.visible = true;
    }
    beaconAt(i) {
      const b = i * 16, M = this.mat, bg = this.beaconGroup;
      bg.position.set(M[b + 12], M[b + 13], M[b + 14]);
      bg.visible = true; this.beacon = { i, t: 0, life: 20 };
      this.beaconGroup.children[0].material.opacity = 1;
    }
    fxUpdate(dt, t) {
      const red = reduced();
      if (this.ring.visible) {
        const p = red ? 1 : 0.9 + 0.1 * Math.sin(t * TAU * 0.8);
        this.M.ring.opacity = 0.85 * p; this.M.glow.opacity = red ? 0.22 : 0.16 + 0.08 * (0.5 + 0.5 * Math.sin(t * TAU * 0.8));
      }
      const B = this.beacon;
      if (B) {
        B.t += dt;
        const fade = clamp((B.life - B.t) / 1.5, 0, 1) * clamp(B.t / 0.6, 0, 1);
        this.beaconGroup.scale.set(1, Math.max(0.001, fade), 1);
        this.beaconArrow.position.y = 3.1 + (red ? 0 : 0.18 * Math.sin(t * TAU * 0.5));
        if (B.t >= B.life) { this.beaconGroup.visible = false; this.beacon = null; }
      }
    }
    // ------------------------------------------------------------ picking (one dynamic interactable)
    footR(i) { const k = this.A.kind[i]; return k === 0 ? 0.42 * this.sxz[i] : k === 1 ? 0.55 : 0; }
    /** the unit the player faces within REACH (place-local) or −1 */
    pick(px, pz, ry) {
      const L = this.L, A = this.A, M = this.mat, fx = Math.sin(ry), fz = Math.cos(ry);
      let best = -1, bs = Infinity;
      const consider = (i) => {
        if (i < 0) return;
        const b = i * 16, ux = A.kind[i] === 2 ? M[b + 12] : A.x[i], uz = A.kind[i] === 2 ? M[b + 14] : A.z[i];
        const dx = ux - px, dz = uz - pz, d = Math.hypot(dx, dz) || 1e-6, edge = d - this.footR(i);
        if (edge > REACH) return;
        const cos = (dx * fx + dz * fz) / d;
        if (cos < -0.2 && edge > 0.6) return;
        const s = edge + (1 - cos) * 1.4 - (i === this.focus ? 0.3 : 0);
        if (s < bs) { bs = s; best = i; }
      };
      for (const d of [0.7, 1.3, 1.9, 2.6, 3.2]) consider(L.indexAt(px + fx * d, pz + fz * d, 0.5));
      for (const a of [-0.6, 0.6]) consider(L.indexAt(px + Math.sin(ry + a) * 1.5, pz + Math.cos(ry + a) * 1.5, 0.5));
      consider(L.indexAt(px, pz, 1.8));
      if (this.focus >= 0) consider(this.focus);
      return best;
    }
    pickUpdate() {
      const pl = G.sys.player, cur = G.sys.places?.current;
      if (this.forced >= 0) { if (this.focus !== this.forced) { this.focus = this.forced; this.showFocus(this.focus); } return; }
      if (!pl?.position || (cur && cur !== this.ctx.id)) { this.setFocus(-1); return; }
      const px = pl.position.x - this.origin.x, pz = pl.position.z - this.origin.z;
      // after 찾아가기 the found unit keeps the focus while the player stays on the spot (a middle-row jar is behind its neighbour)
      const st = this.sticky;
      if (st && Math.hypot(px - st.x, pz - st.z) < 0.8) { this.setFocus(st.i); return; }
      this.sticky = null;
      this.setFocus(this.pick(px, pz, pl.rotY || 0));
    }
    setFocus(i) {
      if (i === this.focus) return;
      this.focus = i;
      this.showFocus(i);
      G.bus?.emit?.('district:focus', { code: i >= 0 ? codeOf(this.L, i) : null });
    }
    statusKey(i) { return ST_KEYS[this.st[i]] || 'open'; }
    buildInteract() {
      const self = this, pos = { x: 0, y: 0, z: 0 };
      this.interact = this.ctx.interact?.({
        id: 'cu-unit', kind: 'jar', radius: 3.4, priority: 1, highlight: false,
        label: () => (self.focus >= 0 ? `${KIND_EMOJI[KINDS[self.A.kind[self.focus]]]} ${codeOf(self.L, self.focus)} 보기` : ''),
        kidLabel: () => (self.focus >= 0 ? `${KIND_WORD[KINDS[self.A.kind[self.focus]]]} 보기` : ''),
        emoji: () => (self.focus >= 0 ? KIND_EMOJI[KINDS[self.A.kind[self.focus]]] : '🏺'),
        position: () => {
          const i = self.focus;
          if (i < 0) return null;
          const b = i * 16, M = self.mat;
          pos.x = M[b + 12]; pos.y = M[b + 13] + (self.A.kind[i] === 0 ? 1.05 * self.sy[i] : self.A.kind[i] === 1 ? 0.4 : 1.6); pos.z = M[b + 14];
          return pos;
        },
        enabled: () => self.focus >= 0,
        onInteract: () => self.open(self.focus),
      }) || null;
    }
    open(i) {
      if (i < 0) return;
      const code = codeOf(this.L, i);
      if (G.sys.allot?.open) { try { G.sys.allot.open('map', { unit: code }); return; } catch (e) { G.log.warn(CAT, 'allot panel failed', e); } }
      this.card(i, code);
    }
    card(i, code) {
      const kind = KINDS[this.A.kind[i]], st = this.statusKey(i), easy = easyOn(), h = G.ui.h;
      const words = ST_WORDS[st] || ST_WORDS.open;
      const body = h('div', { class: 'cu-card' },
        h('p', { class: 'cu-card-code' }, `${KIND_EMOJI[kind]} ${code}`),
        h('p', { class: 'cu-card-kind' }, `${KIND_WORD[kind]} · ${easy ? words[1] : words[0]}`),
        h('p', { class: 'cu-card-note' }, st === 'open' ? '비어 있는 자리예요. 어른과 함께 분양 안내를 볼 수 있어요.' : st === 'mine' ? '내 자리예요! 잘 익어 가고 있어요.' : st === 'closed' ? '지금은 쉬는 자리예요.' : '주인이 있는 자리예요. 눈으로만 봐요.'));
      try {
        G.ui.modal.open({ id: 'cu-unit-card', title: `${KIND_WORD[kind]} ${code}`, icon: KIND_EMOJI[kind], body, size: 'sm', className: 'cu-card-modal', say: `${KIND_WORD[kind]}, ${words[1]}`, actions: [{ label: easy ? '⬅️ 닫기' : '닫기', class: 'btn-primary', close: true }] });
      } catch (e) { G.ui.toast?.(`${code} · ${words[0]}`); }
    }
    // ------------------------------------------------------------ labels (≤ 12 pooled, hysteresis, max 2 new per 0.3 s)
    buildLabels() {
      if (!G.ui?.label) return;
      for (let k = 0; k < 12; k++) {
        const el = document.createElement('div'); el.className = 'cu-label';
        const a = document.createElement('span'); a.className = 'cu-l-code';
        const b = document.createElement('span'); b.className = 'cu-l-np';
        const c = document.createElement('span'); c.className = 'cu-l-st';
        el.append(a, b, c);
        const tgt = new THREE.Vector3();
        const lab = G.ui.label({ el, className: 'cu-label', target: tgt, offsetY: 0, maxDist: 16, visible: false });
        lab.setVisible(false);
        this.labels.push({ lab, el, a, b, c, tgt, i: -1, shownAt: 0 });
      }
    }
    labelUpdate() {
      const pl = G.sys.player, cur = G.sys.places?.current, P = this.labels;
      if (!P.length) return;
      const inside = pl?.position && (!cur || cur === this.ctx.id);
      const c = this.cfg(), R = c.label, KEEP = R + 2.5;
      const A = this.A, M = this.mat;
      if (!inside) { for (const s of P) if (s.i >= 0) this.dropLabel(s); return; }
      const px = pl.position.x - this.origin.x, pz = pl.position.z - this.origin.z, ry = pl.rotY || 0, fx = Math.sin(ry), fz = Math.cos(ry);
      // keep the labels whose unit stays within KEEP
      const held = new Set();
      for (const s of P) {
        if (s.i < 0) continue;
        const b = s.i * 16, d = Math.hypot(M[b + 12] - px, M[b + 14] - pz);
        if (d > KEEP || s.i >= this.L.count) this.dropLabel(s); else { held.add(s.i); this.fillLabel(s, s.i); }
      }
      // candidates: the nearest units in front within R (sub-cells near the player)
      const cand = this._cand || (this._cand = []);
      cand.length = 0;
      const S = this.S;
      for (let s = 0; s < S.n; s++) {
        if (Math.hypot(S.x[s] - px, S.z[s] - pz) - S.r[s] > R) continue;
        for (let p = S.start[s]; p < S.start[s + 1]; p++) {
          const i = S.idx[p];
          if (held.has(i)) continue;
          const b = i * 16, dx = M[b + 12] - px, dz = M[b + 14] - pz, d = Math.hypot(dx, dz);
          if (d > R) continue;
          const front = (dx * fx + dz * fz) / (d || 1);
          cand.push(d - front * 1.5, i);
        }
      }
      if (!cand.length) return;
      const order = [];
      for (let q = 0; q < cand.length; q += 2) order.push(q);
      order.sort((a, b) => cand[a] - cand[b]);
      // screen boxes of the labels already shown: a new one never overlaps them (dense rings stay readable)
      const cam = G.sys.engine?.camera, box = this._boxes || (this._boxes = []);
      box.length = 0;
      const W = innerWidth, Hh = innerHeight, bw = easyOn() ? 112 : 96, bh = easyOn() ? 56 : 48;
      const scr = (s, out) => { const v = this._p.copy(s.tgt).project(cam); if (v.z > 1 || v.z < -1) return false; out[0] = (v.x * 0.5 + 0.5) * W; out[1] = (-v.y * 0.5 + 0.5) * Hh; return true; };
      const tmp = [0, 0];
      if (cam) for (const s of P) if (s.i >= 0 && scr(s, tmp)) box.push(tmp[0], tmp[1]);
      let added = 0;
      for (const q of order) {
        if (added >= 2) break;
        const free = P.find((s) => s.i < 0);
        if (!free) break;
        const i = cand[q + 1];
        this.fillLabel(free, i);
        if (cam && scr(free, tmp)) {
          let hit = false;
          for (let b = 0; b < box.length; b += 2) if (Math.abs(box[b] - tmp[0]) < bw && Math.abs(box[b + 1] - tmp[1]) < bh) { hit = true; break; }
          if (hit) continue;
          box.push(tmp[0], tmp[1]);
        }
        free.i = i; free.shownAt = performance.now();
        free.lab.setVisible(true); free.el.classList.remove('cu-out');
        added++; this.labelChurn++;
      }
      void A;
    }
    fillLabel(s, i) {
      const b = i * 16, M = this.mat, k = this.A.kind[i];
      s.tgt.set(M[b + 12] + this.origin.x, M[b + 13] + this.origin.y + (k === 0 ? 1.25 * this.sy[i] : k === 1 ? 0.6 : 2.6), M[b + 14] + this.origin.z);
      const code = codeOf(this.L, i), st = this.statusKey(i), easy = easyOn();
      if (s.a.textContent !== code) s.a.textContent = code;
      let np = '';
      const pl = this.plates;
      if (pl) { try { np = String((typeof pl.get === 'function' ? pl.get(code) ?? pl.get(i) : pl[code]) || '').slice(0, 14); } catch (e) { np = ''; } }
      if (s.b.textContent !== np) s.b.textContent = np;
      s.b.hidden = !np;
      const w = ST_WORDS[st] || ST_WORDS.open, txt = `${(D().status?.[ST_SHORT[this.st[i]]] || {}).emoji || ''} ${easy ? w[1] : w[0]}`.trim();
      if (s.c.textContent !== txt) s.c.textContent = txt;
      s.el.dataset.st = st;
    }
    dropLabel(s) { s.i = -1; s.lab.setVisible(false); }
    visibleLabels() { return this.labels.filter((s) => s.i >= 0 && s.lab.visible && !s.el.classList.contains('hidden')).length; }
    // ------------------------------------------------------------ 찾아가기
    spotFor(i) {
      if (i < 0) return null;
      const A = this.A, M = this.mat, si = A.slot[i], x = A.x[i], z = A.z[i], ry = A.rot[i];
      const blocked = (sx, sz) => { try { return !!G.world?.blocked?.(sx + this.origin.x, sz + this.origin.z, 0.36, this.C.height(sx, sz) + this.origin.y); } catch (e) { return false; } };
      let cands = [];
      if (this.slotType[si] === 'ring') {
        const R = (this.C.rings || {})[this.slotSys[si]];
        const dx = x - R.cx, dz = z - R.cz, r = Math.hypot(dx, dz), ux = dx / r, uz = dz / r, j = ((A.ring[i] % 3) + 3) % 3;
        const r0 = r - (this.C.K?.RING_SPACING || 1.6) * j, inner = r0 - 0.92, outer = r0 + 2 * (this.C.K?.RING_SPACING || 1.6) + 0.92;
        const order = j === 2 ? [outer, inner] : [inner, outer];
        for (const rs of order) for (const t of [0, 0.5, -0.5, 1, -1]) {
          const a = Math.atan2(dz, dx) + t / rs;
          cands.push([R.cx + Math.cos(a) * rs, R.cz + Math.sin(a) * rs]);
        }
      } else {
        const b = i * 16, fx = Math.sin(ry), fz = Math.cos(ry), store = A.kind[i] === 2;
        const ox = store ? M[b + 12] : x, oz = store ? M[b + 14] : z, d0 = store ? 1.1 : A.kind[i] === 1 ? 1.32 : 1.25;
        for (const d of [d0, d0 + 0.35, -d0, -(d0 + 0.35)]) for (const t of [0, 0.5, -0.5]) cands.push([ox + fx * d + fz * t, oz + fz * d - fx * t]);
        if (store) cands = cands.filter((c) => (c[0] - ox) * fx + (c[1] - oz) * fz > 0);
      }
      for (const [sx, sz] of cands) {
        if (blocked(sx, sz)) continue;
        const b = i * 16, tx = A.kind[i] === 2 ? M[b + 12] : x, tz = A.kind[i] === 2 ? M[b + 14] : z;
        return { x: sx, z: sz, rotY: Math.atan2(tx - sx, tz - sz) };
      }
      return null;
    }
    async goto(code) {
      const p = parse(code), i = p && this.L ? this.L.index(p.zone, p.seq) : -1;
      if (i < 0) { G.bus?.emit?.('district:goto', { code, ok: false }); return false; }
      const sp = this.spotFor(i);
      if (!sp) { G.bus?.emit?.('district:goto', { code, ok: false }); return false; }
      const pl = G.sys.player;
      try { await pl?.teleport?.(sp.x + this.origin.x, sp.z + this.origin.z, sp.rotY, { fade: !reduced() }); } catch (e) { G.log.warn(CAT, 'goto teleport failed', e); return false; }
      this.beaconAt(i);
      const pp = pl?.position;
      this.sticky = { i, x: pp ? pp.x - this.origin.x : sp.x, z: pp ? pp.z - this.origin.z : sp.z };
      this.pickT = 0;
      G.bus?.emit?.('district:goto', { code: codeOf(this.L, i), ok: true });
      say(`${KIND_WORD[KINDS[this.A.kind[i]]]} 앞에 왔어요. 빛나는 기둥을 찾아봐요!`);
      return true;
    }
    // ------------------------------------------------------------ stats + dispose
    stats() {
      const S = this.S, lev = { jar: [0, 0, 0], plot: [0, 0, 0], store: [0, 0, 0] };
      if (S) for (let s = 0; s < S.n; s++) { const l = S.level[s] < 0 ? 2 : S.level[s]; const low = this.q === 'low' && l === 0 && S.kind[s] < 2 ? 1 : l; lev[KINDS[S.kind[s]]][low] += S.start[s + 1] - S.start[s]; }
      const drawn = {};
      let calls = 0, tris = 0;
      this.root.traverse((o) => {
        if (!o.isMesh) return;
        let vis = o.visible;
        for (let p = o.parent; p && vis; p = p.parent) if (!p.visible) vis = false;
        if (!vis) return;
        const n = o.isInstancedMesh ? o.count : 1;
        if (!n) return;
        calls++;
        tris += n * triOf(o.geometry);
        if (o.isInstancedMesh) drawn[o.name.replace(/^cu-/, '')] = n;
      });
      return { built: true, quality: this.q, count: this.L ? this.L.count : 0, levels: lev, drawn, drawCalls: calls, triangles: Math.round(tris), labels: this.visibleLabels(),
        labelChurn: this.labelChurn, markers: { ...(this.markerCounts || {}) }, near: { ...(this.nearCounts || {}) }, rebuilds: this.rebuilds, statusWrites: this.statusWrites,
        lastWrite: { ...this.lastWrite }, focus: this.focus >= 0 ? codeOf(this.L, this.focus) : null, colliders: this.colliders.length, boards: (this.boards || []).length, demo: !!this.demo,
        beacon: this.beacon ? { code: codeOf(this.L, this.beacon.i), left: Math.max(0, this.beacon.life - this.beacon.t) } : null };
    }
    dispose() {
      G.bus?.off?.('allot:map', this._onMap); G.bus?.off?.('allot:mine', this._onMap); G.bus?.off?.('engine:quality', this._onQuality);
      for (const id of this.colliders) { try { G.world.removeCollider(id); } catch (e) { /* gone */ } }
      this.colliders = [];
      for (const s of this.labels) { try { s.lab.remove(); } catch (e) { /* gone */ } }
      this.labels = [];
      try { this.interact?.unregister?.(); } catch (e) { /* gone */ }
      for (const m of Object.values(this.meshes)) { m.dispose?.(); m.geometry?.dispose?.(); }
      for (const g of Object.values(this.geo)) (Array.isArray(g) ? g : [g]).forEach((x) => x.dispose?.());
      this.root.traverse((o) => { if (o.isMesh && o.geometry) o.geometry.dispose(); });
      this.root.parent?.remove(this.root);
      this.meshes = {}; this.L = null; this.S = null; this.mat = null;
      if (live === this) live = null;
    }
  }

  // ---------------------------------------------------------------- the part + the public API
  let live = null, pending = null;
  CX.add('units', (ctx, C) => {
    const d = new District(ctx, C || G.data.complex);
    live = d;
    return { dispose() { d.dispose(); }, update(dt, t) { try { d.update(dt, t); } catch (e) { if (!d._warned) { d._warned = true; G.log.warn(CAT, 'units update failed', e); } } } };
  }, 40);

  G.sys = G.sys || {};
  G.sys.allotDistrict = {
    ready: () => !!live,
    async goto(code) {
      code = String(code || '').toUpperCase();
      if (!parse(code)) return false;
      const P = G.sys.places;
      const placeId = live ? live.ctx.id : PLACE;
      if (live && P?.current === placeId) { pending = null; return live.goto(code); }
      pending = code;
      let ok = false;
      try { ok = !!(await P?.enter?.(placeId, { focusUnit: code })); } catch (e) { G.log.warn(CAT, 'enter for goto failed', e); }
      if (!ok || !live) { if (!live) G.ui?.toast?.('만장대 단지를 아직 지을 수 없어요. 조금 뒤에 다시 해 주세요.'); return false; }
      if (pending === code) { pending = null; return live.goto(code); }
      return true;
    },
    highlight(code) {
      if (!live) return false;
      if (code == null) { live.forced = -1; live.focus = -1; live.showFocus(-1); return true; }
      const p = parse(code), i = p ? live.L.index(p.zone, p.seq) : -1;
      live.forced = i; live.focus = i; live.showFocus(i);
      return i >= 0;
    },
    counts: () => (live ? live.counts() : null),
    stats: () => (live ? live.stats() : { built: false }),
    refresh() { if (!live) return false; live.applyMap(true); live.dirty = true; live.markersDirty = true; return true; },
    spotFor(code) { if (!live) return null; const p = parse(code), i = p ? live.L.index(p.zone, p.seq) : -1; return live.spotFor(i); },
    get _live() { return live; },
  };
})();
