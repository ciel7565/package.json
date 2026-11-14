// =============================================================================
// 19-hanok-kit.js — the hanok kit: G.hanok (CONTRACT §16.5). Rooms are built from it inside places.define({ build(ctx) }).
//
// UNITS: metres, radians. Everything is in the place's LOCAL frame: origin = middle of the floor, +Y up, north = −Z,
// rotY 0 faces +Z (south), π/2 faces +X (east). Colours are '#rrggbb' strings. Materials are the photographed sets of
// G.mat (14-materials.js: albedo / normal / roughness) on medium / high with the asset pack, and the kit's own procedural
// ones otherwise. A tint is a multiplier on a surface whose mean colour is the same in both cases, so a room looks the
// same colour on every preset; `low` = same geometry, flat look, no lamps, minimal effects.
//
// ── 1. THE ROOM SHELL ────────────────────────────────────────────────────────────────────────────────────────────
//   const R = G.hanok.room(ctx, spec)            ctx = the build context of 18-places.js
//   spec {
//     w, d            inner size (m): w along X, d along Z                     (default: ctx.size.w / d)
//     post            top of the posts = underside of the big beams (m)       (default 2.7)
//     ridge           ridge height of an open-rafter roof (m)                 (default ctx.size.h)
//     bays: {x, z}    칸 수 along X and Z (posts stand on every bay line)      (default ≈ one per 2.7 m)
//     floor           'maru' (우물마루) | 'jangpan' (장판) | 'earth' | 'stone'    (default 'maru')
//     roof            'rafters' (연등천장: 대들보 · 동자주 · 종보 · 대공 · 도리 · 서까래 · 앙토) | 'ceiling' (반자) |
//                     'none'                                                   (default 'rafters')
//     ceiling         height of a flat 반자 (m; roof 'ceiling')                (default post + 0.35)
//     postR           post radius (m, default 0.15)     entasis: true = 배흘림  stoneBase: true = 주춧돌 showing
//     tone            'warm' | 'dark' (smoke-darkened timber: 부엌, 곳간) | 'pale'
//     walls: { N: [bay, …], E: […], S: […], W: […] }   one entry per bay, LEFT → RIGHT as seen from inside:
//          'plaster' | 'clay' | 'board' (판벽)                       solid infill between the timbers
//          { window: 'ttisal'|'jeongja'|'bitsal'|'yongja'|'aja'|'wanja', w = 1.5, h = 1.3, sill = 0.55, label }
//                                                                    창호 (lattice + back-lit 한지) over a 머름
//          { door: 'panel' (판문) | 'changho' (세살문), w = 1.5, h = 2.0, exit: true, open: 0..1, label }
//          { shutter: true, w = 1.0, h = 0.9, sill = 1.0, open: 0..1 }  바라지창 (wooden shutters)
//          { open: true, bunhap: 4 }                                  들어열개: the bay is open, n door leaves hang
//                                                                    folded under the eaves (0 = none)
//          'none'                                                    nothing (you add your own)
//     sun: { az, el }  where the window sun stands: az 180 = south (+Z), 90 = east (+X), 270 = west; el = elevation
//                      (deg; default the side with the most windows, el 34)
//     backdrop        'yard' (a painted courtyard behind open bays; default when a bay is open) | false
//     light           overrides for the engine profile (see R.light())
//   }
//   R.w / R.d / R.post / R.ridge / R.bays      the resolved numbers
//   R.add(key, geometry, matrix, tint, {wall: 'N'|'E'|'S'|'W', cast = true})
//                    add geometry (consumed) under material key; wall = it belongs to that wall (hidden with it while
//                    the camera is outside); cast = it also goes into the invisible shadow caster
//   R.wm(side, u, v, n = 0, ry = 0) -> Matrix4   a spot on a wall: u metres from its left end (seen from inside), v up,
//                    n into the room, facing the room                R.bay(side, i) -> {u0, u1, uc, len}
//   R.at(x, y, z, ry = 0, s = 1) -> Matrix4      a spot in the room (= G.bkit.M)
//   R.roofY(z)       height of the rafters' underside at z (open-rafter roofs)
//   R.postAt(x, z, {wall, top, r})  ·  R.beam(ax, ay, az, bx, by, bz, {w, h, wall})  ·  R.log(ax…bz, r, {wall})
//   R.label(text, {x, y, z, rotY, w, h, sub, style: 'wood'|'paper', wall}) -> {x, y, z}    a small name plate
//   R.signPost({x, z, rotY, title, sub}) -> {x, y, z}   a low stake with a name board (hang ctx.anchor on it)
//   R.shelfWall(side, bay, {levels, slots}) -> [{x, y, z}]   a wall shelf (the fallback exhibit shelf: register
//                    the spots with ctx.anchor('shelf:' + i, spot))
//   R.finish({exit: {x, z}}) -> R   merges everything (one mesh per material and wall), builds the shadow caster, the
//                    light decal, the wall colliders, the cut-away, the minimap plan and the light profile. Call once,
//                    after every R.add / generator call. R.onUpdate(fn(dt, t, night)) runs with the room.
//   R.light() -> the 10-engine setIndoor profile (used automatically by 18-places when define() gives no light)
//   R.plan(ctx2d, map)   the minimap floor plan (used automatically when define() gives no minimap)
//
// ── 2. 창호, DOORS (also usable on their own) ────────────────────────────────────────────────────────────────────
//   G.hanok.lattice(pattern, w, h) -> [[x0, y0, x1, y1], …]   bar centre lines of a pattern in a w × h field (centre 0,0)
//   G.hanok.changho(T, m, {w, h, pattern, frame = 0.06, bar = 0.026, depth = 0.03, paper = true, wall})
//                    a lattice sash with paper at matrix m (facing +Z); T = a room R (or anything with .add)
//   G.hanok.panelDoor(T, m, {w, h, leaves = 2, open = 0, wall})   판문: board leaves with ledges and iron rings
//   G.hanok.PATTERNS = ['ttisal', 'jeongja', 'bitsal', 'yongja', 'aja', 'wanja']   + PATTERN_NAMES (Korean)
//
// ── 3. FURNITURE AND PROPS — each takes (T, opts) with opts.x / y / z / rotY (y = the floor it stands on) ──────────
//   chest(T, {w = 0.9, d = 0.45, h = 0.8, doors = 2, drawers = 0, legs = 0.08, fittings: 'brass'|'iron'|false, tone})
//                    a panelled chest (frame and panel, hinges, lock plate, corner braces): 반닫이 / 장 / 뒤주 / 문갑
//   table(T, {w = 0.7, d = 0.4, h = 0.3, legs: 'straight'|'curved', apron = true, tone})          서안 / 소반 / 경상
//   shelf(T, {w = 0.6, d = 0.35, h = 1.4, levels = 3, back = false, tone}) -> [{x, y, z}] level spots   사방탁자 / 살강
//   pot(T, {kind: 'hangari'|'dok'|'danji'|'jungduri'|'sot'|'siru'|'bowl'|'bottle'|'brazier'|'mortar'|'millstone'|
//                  'basin', s = 1, lid = false, mat = 'onggi', tint})                   lathe-turned jars, pots, bowls
//   cushion(T, {w = 0.6, d = 0.6, h = 0.09, tint, trim})                               방석 / 보료 (h up to 0.2)
//   cloth(T, {w, d, drop = 0.25, tint})   a cloth draped over a box of w × d           roll(T, {len, r, tint})  rolled bedding / mat
//   floorMat(T, {w, d, tint, border})     a woven straw mat on the floor (돗자리 / 멍석)
//   screen(T, {panels = 6, w = 0.45, h = 1.7, fold = 0.35, art: name | [names], tint}) -> {w}   병풍 (art = G.pack names,
//                    aspect kept, shown across the panels; blank silk without the pack)
//   scroll(T, {art, h = 1.5, wall}) -> {x, y, z, w, h}   족자: a mounted hanging scroll (aspect kept); hang it with m =
//                    R.wm(side, u, v) through opts.m
//   basket(T, {r = 0.25, h = 0.2, kind: 'round'|'ki'|'sieve'})        rope(T, {points: [[x, y, z], …], r = 0.012, sag})
//   straw(T, {kind: 'bundle'|'sack'|'coil', s})                       block(T, {w, h, d, bevel, mat, tint})  a bevelled block
//   jwadeung(T, {h = 0.9})   a standing paper lamp (좌등)             deungjan(T, {h = 0.45})   an oil lamp on its stand
//   Every generator returns its footprint {x, z, w, d, top} where useful and adds NO collider: call
//   ctx.addCollider yourself for things a child must walk around (R.block(x, z, hw, hd) is a shortcut).
//
// ── 4. EFFECTS (medium / high; a still glow on low; all respect reduce motion and stay under 3 Hz) ─────────────────
//   fire(R, {x, y, z, s = 1, light = true})     flames + embers + a pooled lamp with a slow flicker (아궁이, 화로)
//   steam(R, {x, y, z, s = 1, rate})            soft rising puffs (가마솥, 시루)          smoke(R, {x, y, z, s})  thin grey smoke
//   lamp(R, {x, y, z, s = 1, color, intensity, distance})   a small flame + a pooled lamp (등잔, 초롱, 좌등)
//   dust(R, {count})                            motes drifting in the window sun (placed in the sun shafts by themselves)
//
// ── 5. HELPERS ───────────────────────────────────────────────────────────────────────────────────────────────────
//   G.hanok.mat(key) -> THREE.Material      keys: wood (frame + joinery) · floor · furn · plaster · clay · stone · earth ·
//                    straw · basket · cloth · onggi · hanji · paper (back-lit, own) · brass · iron · lacquer · paint ·
//                    glow (emissive, own) · sign. Shared: never dispose one.   G.hanok.tint(key, hex) -> hex, or the
//                    key's own colour when hex is missing. Mean colours a tint multiplies: wood / floor / furn
//                    (195,155,111) · plaster / clay (231,226,214) · stone (142,136,123) · earth (72,49,31) · straw /
//                    basket (160,135,88) · onggi (75,44,24) · cloth (238,236,230) · hanji (244,234,211) · jangpan
//                    (212,160,74) · brass / iron / lacquer / paint / glow: white (the tint is the colour)
//   G.hanok.art(name) -> {texture, aspect, ok}   a pack artwork ('art/<id>' or '<id>') — ok false = not in this build
//   G.hanok.geo.timber(len, h, w, bevel) (chamfered, along X) · .post(r, h, entasis) · .slab(w, h, d, bevel)
//   Budget: one room ≤ 200 draw calls on high — R.finish() logs the count of meshes it made.
// =============================================================================
(function () {
  const BK = G.bkit;
  if (!BK) { G.log.warn('WORLD', 'hanok kit: G.bkit is missing (15-buildings.js not in this build)'); return; }
  const { M, mul, col } = BK, geo = BK.geo;
  const PI = Math.PI, TAU = PI * 2, DEG = PI / 180;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const num = (v, d) => (Number.isFinite(Number(v)) && v != null ? Number(v) : d);
  const FONT = BK.FONT || 'sans-serif';
  const PATTERNS = ['ttisal', 'jeongja', 'bitsal', 'yongja', 'aja', 'wanja'];
  const PATTERN_NAMES = { ttisal: '띠살', jeongja: '정자살', bitsal: '빗살', yongja: '용자살', aja: '아자살', wanja: '완자살' };
  const SIDES = ['N', 'E', 'S', 'W'];
  const YAW = { N: 0, E: -PI / 2, S: PI, W: PI / 2 };

  // ---------------------------------------------------------------- materials
  const own = (key, make) => G.gfx.material('hk-' + key, make);
  const STD = (o) => new THREE.MeshStandardMaterial(o);
  const lowQ = () => G.sys.engine?.preset?.name === 'low';
  function paperTex() {
    return own('tex-paper', () => G.gfx.canvasTexture(256, 256, (c, w, h) => {
      c.fillStyle = '#f4ead2'; c.fillRect(0, 0, w, h);
      const r = G.util.rng('hk:paper');
      for (let i = 0; i < 520; i++) {   // 닥 fibres
        const x = r() * w, y = r() * h, l = 6 + r() * 26, a = r() * PI;
        c.strokeStyle = `rgba(${150 + r() * 60 | 0},${120 + r() * 50 | 0},${70 + r() * 40 | 0},${0.05 + r() * 0.1})`;
        c.lineWidth = 0.5 + r() * 0.9; c.beginPath(); c.moveTo(x, y); c.quadraticCurveTo(x + Math.cos(a) * l * 0.5 + (r() - 0.5) * 6, y + Math.sin(a) * l * 0.5 + (r() - 0.5) * 6, x + Math.cos(a) * l, y + Math.sin(a) * l); c.stroke();
      }
      for (let i = 0; i < 60; i++) { c.fillStyle = `rgba(255,250,235,${0.05 + r() * 0.08})`; c.beginPath(); c.arc(r() * w, r() * h, 6 + r() * 22, 0, TAU); c.fill(); }
    }, { repeat: [1.25, 1.25] }));
  }
  function jangpanTex() {
    return own('tex-jangpan', () => G.gfx.canvasTexture(256, 256, (c, w, h) => {
      const g = c.createLinearGradient(0, 0, w, h);
      g.addColorStop(0, '#d7a54e'); g.addColorStop(0.5, '#cf9b45'); g.addColorStop(1, '#d9aa55');
      c.fillStyle = g; c.fillRect(0, 0, w, h);
      const r = G.util.rng('hk:jangpan');
      for (let i = 0; i < 260; i++) { c.fillStyle = `rgba(${90 + r() * 60 | 0},${55 + r() * 40 | 0},20,${0.03 + r() * 0.05})`; c.beginPath(); c.ellipse(r() * w, r() * h, 3 + r() * 20, 2 + r() * 9, r() * PI, 0, TAU); c.fill(); }
      for (let i = 0; i < 40; i++) { c.fillStyle = `rgba(255,236,170,${0.04 + r() * 0.06})`; c.beginPath(); c.arc(r() * w, r() * h, 8 + r() * 26, 0, TAU); c.fill(); }
    }, { repeat: [1 / 1.4, 1 / 1.4] }));
  }
  function clothTex() {
    return own('tex-cloth', () => G.gfx.canvasTexture(128, 128, (c, w, h) => {
      c.fillStyle = '#f2f0ea'; c.fillRect(0, 0, w, h);
      for (let y = 0; y < h; y += 2) { c.fillStyle = `rgba(0,0,0,${0.03 + (y % 4 ? 0.02 : 0)})`; c.fillRect(0, y, w, 1); }
      for (let x = 0; x < w; x += 2) { c.fillStyle = 'rgba(255,255,255,0.05)'; c.fillRect(x, 0, 1, h); }
    }, { repeat: [1 / 0.18, 1 / 0.18] }));
  }
  // key -> { g: G.mat set (the photographed surface, medium / high with the asset pack),
  //          look: the mean sRGB colour the photograph is brought to = the mean of the fallback texture, so that a tint
  //                (a vertex colour, i.e. a multiplier) means the same thing on every preset,
  //          o: more G.mat options, fb: G.bkit material key | () => the kit's own material (low / no pack),
  //          tint: the default tint, tintG: the default tint while the photograph is on (when it already has the colour) }
  // Timber, floor boards and furniture are modelled piece by piece, so they take the plain pine grain (it runs along U =
  // along the member); the photographed plank floors would draw joints across single boards.
  const WOOD = [195, 155, 111];
  const MATS = {
    wood: { g: 'pine_timber', look: WOOD, o: { roughness: 0.74, normalScale: 0.7, env: 0.7 }, fb: () => own('wood', () => STD({ map: BK.tex('wood'), vertexColors: true, roughness: 0.72, envMapIntensity: 0.7 })), tint: '#d6bfa0' },
    floor: { g: 'pine_timber', look: WOOD, o: { roughness: 0.46, normalScale: 0.45, env: 0.85 }, fb: () => (lowQ() ? own('floor-flat', () => STD({ color: 0xc39b6f, vertexColors: true, roughness: 0.6 })) : own('floor', () => STD({ map: BK.tex('wood'), vertexColors: true, roughness: 0.5, envMapIntensity: 0.85 }))), tint: '#e0d4c0' },   // low: plain boards (the canvas grain shimmers without mip levels worth the name)
    furn: { g: 'pine_timber', look: WOOD, o: { roughness: 0.44, normalScale: 0.35, env: 0.9 }, fb: () => own('furn', () => STD({ map: BK.tex('wood'), vertexColors: true, roughness: 0.5, envMapIntensity: 0.9 })), tint: '#8e6444' },
    plaster: { g: 'lime_plaster_wall', look: [231, 226, 214], o: { normalScale: 0.9, blend: 0.5, macro: 0.06 }, fb: 'plaster', tint: '#f1e6d2' },
    clay: { g: 'hwangto_clay_wall', look: [231, 226, 214], o: { normalScale: 0.9, macro: 0.07 }, fb: 'plaster', tint: '#c79f72', tintG: '#c7c2ac' },
    stone: { g: 'granite_stone', look: [142, 136, 123], o: { tile: 1.4, normalScale: 0.8 }, fb: 'stone', tint: '#cbc4b6' },
    earth: { g: 'yard_dirt_path', look: [72, 49, 31], o: { normalScale: 0.9, macro: 0.08 }, fb: 'soil', tint: '#b4946c' },
    straw: { g: 'straw_mat', look: [160, 135, 88], o: { tile: 0.6 }, fb: 'thatch', tint: '#dcc27c' },
    basket: { g: 'woven_basket', look: [160, 135, 88], fb: 'thatch', tint: '#c8a45f' },
    onggi: { g: 'onggi_glaze', look: [75, 44, 24], o: { roughness: 0.28, env: 1.2 }, fb: 'glaze', tint: '#6a442e' },
    cloth: { g: 'hemp_linen', look: [238, 236, 230], fb: () => own('cloth', () => STD({ map: clothTex(), vertexColors: true, roughness: 0.95 })), tint: '#efe9dc' },
    hanji: { g: 'hanji_paper', look: [244, 234, 211], fb: () => own('hanji', () => STD({ map: paperTex(), vertexColors: true, roughness: 0.96 })), tint: '#f4ecd8' },
    jangpan: { g: 'jangpan_floor_paper', look: [212, 160, 74], o: { roughness: 0.42, normalScale: 0.3, env: 0.9 }, fb: () => own('jangpan', () => STD({ map: jangpanTex(), vertexColors: true, roughness: 0.42, metalness: 0.0, envMapIntensity: 0.9 })), tint: '#ffffff' },
    // the kit's own (never from G.mat): they have a job a plain surface set cannot do
    paper: { fb: () => own('paper', () => STD({ map: paperTex(), emissiveMap: paperTex(), emissive: new THREE.Color('#ffe2b0'), emissiveIntensity: 0.9, vertexColors: true, roughness: 0.95 })), tint: '#fff7e6', own: true },
    brass: { fb: () => own('brass', () => STD({ vertexColors: true, color: 0xffffff, roughness: 0.36, metalness: 0.92, envMapIntensity: 1.2 })), tint: '#c9a24a', own: true },
    iron: { fb: () => own('iron', () => STD({ vertexColors: true, roughness: 0.55, metalness: 0.8, envMapIntensity: 0.9 })), tint: '#3a3a3d', own: true },
    lacquer: { fb: () => own('lacquer', () => STD({ vertexColors: true, roughness: 0.28, metalness: 0.05, envMapIntensity: 1.1 })), tint: '#5a2318', own: true },
    paint: { fb: () => own('paint', () => STD({ vertexColors: true, roughness: 0.7, metalness: 0.0 })), tint: '#ffffff', own: true },
    glow: { fb: () => own('glow', () => STD({ vertexColors: true, emissive: new THREE.Color('#ff9a3c'), emissiveIntensity: 1.6, roughness: 0.8 })), tint: '#ffd9a0', own: true },
  };
  /** is the photographed set of this key in use right now (asked each time: the preset can change between two builds) */
  const photo = (d) => !!(d && d.g && !d.own && G.mat && typeof G.mat.usable === 'function' && G.mat.usable(d.g));
  /** the material of a kit key: the photographed G.mat set on medium / high with the pack, else the kit's own. All of
   *  them take vertex colours (the tints) and are shared — never dispose them. */
  function mat(key) {
    const d = MATS[key];
    if (!d) throw new Error('hanok kit: unknown material ' + key);
    if (photo(d)) {
      try { const m = G.mat.get(d.g, { vertexColors: true, look: d.look, ...(d.o || {}) }); if (m && m.isMaterial) return m; }
      catch (e) { G.log.warn('WORLD', `hanok kit: material set ${d.g} failed`, e?.message || e); }
    }
    return typeof d.fb === 'function' ? d.fb() : BK.mat(d.fb);
  }
  /** the tint a part gets when none is given: the key's own colour ('#rrggbb' or a linear THREE.Color go through) */
  function tint(key, hex) {
    if (hex) return hex;
    const d = MATS[key] || {};
    return (d.tintG && photo(d) ? d.tintG : d.tint) || '#ffffff';
  }

  // ---------------------------------------------------------------- geometry
  const KG = {};
  /** a prism along X: sec = [[y, z], …] (any winding), length len; u = along (m), v = around (m). Flat faces. */
  function prism(sec, len, caps = true, uo = 0) {
    const n = sec.length, hx = len / 2;
    let cy = 0, cz = 0;
    for (const p of sec) { cy += p[0]; cz += p[1]; }
    cy /= n; cz /= n;
    const pos = [], nor = [], uv = [], idx = [];
    let per = 0;
    for (let i = 0; i < n; i++) {
      const a = sec[i], b = sec[(i + 1) % n];
      const ey = b[0] - a[0], ez = b[1] - a[1], el = Math.hypot(ey, ez) || 1e-6;
      let ny = ez / el, nz = -ey / el;                                   // perpendicular to the edge
      if (ny * ((a[0] + b[0]) / 2 - cy) + nz * ((a[1] + b[1]) / 2 - cz) < 0) { ny = -ny; nz = -nz; }
      const base = pos.length / 3;
      pos.push(-hx, a[0], a[1], hx, a[0], a[1], hx, b[0], b[1], -hx, b[0], b[1]);
      for (let k = 0; k < 4; k++) nor.push(0, ny, nz);
      uv.push(uo, per, uo + len, per, uo + len, per + el, uo, per + el);
      // winding: (p1 - p0) × (p3 - p0) = (0, -2hx·ez, 2hx·ey) must point along the normal
      if (-ez * ny + ey * nz >= 0) idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
      else idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
      per += el;
    }
    if (caps) {
      for (const sx of [-1, 1]) {
        const base = pos.length / 3;
        for (const p of sec) { pos.push(sx * hx, p[0], p[1]); nor.push(sx, 0, 0); uv.push(p[1], p[0]); }
        for (let k = 1; k < n - 1; k++) {
          const a = sec[0], b = sec[k], c = sec[k + 1];
          const cr = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);   // x of cross in (y, z)
          if (cr * sx >= 0) idx.push(base, base + k, base + k + 1); else idx.push(base, base + k + 1, base + k);
        }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    return g;
  }
  /** chamfered timber along X: len × h (Y) × w (Z); the four long edges are bevelled (b m) */
  KG.timber = function (len, h, w, b = 0.014, uo = 0) {
    const hy = h / 2, hz = w / 2;
    b = Math.max(0, Math.min(b, hy * 0.45, hz * 0.45));
    if (b < 0.002) return prism([[-hy, -hz], [hy, -hz], [hy, hz], [-hy, hz]], len, true, uo);
    return prism([[-hy + b, -hz], [hy - b, -hz], [hy, -hz + b], [hy, hz - b], [hy - b, hz], [-hy + b, hz], [-hy, hz - b], [-hy, -hz + b]], len, true, uo);
  };
  /** a timber between two points (its height stays in the vertical plane of the span) */
  KG.span = function (ax, ay, az, bx, by, bz, h, w, b = 0.014) {
    const dx = bx - ax, dy = by - ay, dz = bz - az, len = Math.hypot(dx, dy, dz) || 1e-3;
    const g = KG.timber(len, h, w, b, (ax + az) * 0.37);
    const yaw = Math.atan2(-dz, dx), pitch = Math.atan2(dy, Math.hypot(dx, dz));
    g.applyMatrix4(new THREE.Matrix4().makeRotationZ(pitch));
    g.applyMatrix4(new THREE.Matrix4().makeRotationY(yaw));
    g.translate((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2);
    return g;
  };
  /** a round post standing on y = 0 (배흘림: thickest a third of the way up, slimmer at the top) */
  KG.post = function (r, h, entasis = true, seg = 12) {
    const pts = [];
    const n = entasis ? 7 : 1;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const k = !entasis ? 1 : t < 1 / 3 ? 1 + 0.06 * Math.sin(t * 3 * PI / 2) : 1.06 - 0.18 * Math.pow((t - 1 / 3) / (2 / 3), 1.4);
      pts.push([r * k, t * h]);
    }
    const g = geo.lathe(pts, seg);
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * TAU * r, uv.getY(i) * h);
    return g;
  };
  /** a bevelled block w × h × d (rounded-box look with flat faces; UV in metres) */
  KG.slab = function (w, h, d, b = 0.01) {
    if (w >= d) return KG.timber(w, h, d, b);
    const g = KG.timber(d, h, w, b);
    g.applyMatrix4(new THREE.Matrix4().makeRotationY(PI / 2));
    return g;
  };
  /** flat quad in the XY plane facing +Z with metre UVs (single sided) */
  KG.quad = (w, h, uo = 0, vo = 0) => geo.mquad(w, h, uo, vo);
  /** horizontal quad (facing up, or down with flip) with metre UVs: w along X, d along Z */
  KG.floor = function (w, d, flip = false, uo = 0, vo = 0) {
    const g = geo.mquad(w, d, uo, vo);
    g.rotateX(flip ? PI / 2 : -PI / 2);
    return g;
  };
  /** lathe with metre UVs */
  KG.lathe = function (pts, seg = 16) {
    const g = geo.lathe(pts, seg);
    let rmax = 0, len = 0;
    for (let i = 0; i < pts.length; i++) { rmax = Math.max(rmax, pts[i][0]); if (i) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); }
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * TAU * rmax, uv.getY(i) * len);
    return g;
  };

  // ---------------------------------------------------------------- lattice patterns
  /** bar centre lines of a 창살 pattern in a w × h field centred on (0, 0): [[x0, y0, x1, y1], …] */
  function lattice(pattern, w, h) {
    const S = [], hw = w / 2, hh = h / 2;
    const V = (x, y0 = -hh, y1 = hh) => S.push([x, y0, x, y1]);
    const H = (y, x0 = -hw, x1 = hw) => S.push([x0, y, x1, y]);
    switch (pattern) {
      case 'jeongja': {   // 정자살: a square grid
        const nx = Math.max(3, Math.round(w / 0.15)), ny = Math.max(3, Math.round(h / 0.15));
        for (let i = 1; i < nx; i++) V(-hw + (w * i) / nx);
        for (let j = 1; j < ny; j++) H(-hh + (h * j) / ny);
        break;
      }
      case 'bitsal': {    // 빗살: two sets of diagonals
        const s = 0.19;
        for (let c = -(w + h); c <= w + h; c += s) {
          for (const dir of [1, -1]) {
            // y = dir·x + c inside the field: |y| ≤ hh and |x| ≤ hw
            const xa = Math.max(-hw, dir > 0 ? -hh - c : c - hh), xb = Math.min(hw, dir > 0 ? hh - c : c + hh);
            if (xb - xa > 0.04) S.push([xa, dir * xa + c, xb, dir * xb + c]);
          }
        }
        break;
      }
      case 'yongja': {    // 용자살: few bars — two uprights, three rails (用)
        V(-w / 6); V(w / 6);
        H(h * 0.24); H(0); H(-h * 0.24);
        break;
      }
      case 'aja': {       // 아자살: nested frames tied to each other (亞)
        const a = Math.min(w, h) * 0.17, x1 = hw - a, y1 = hh - a, x2 = hw - a * 2.2, y2 = hh - a * 2.2;
        H(y1, -x1, x1); H(-y1, -x1, x1); V(-x1, -y1, y1); V(x1, -y1, y1);          // outer frame
        H(y2, -x2, x2); H(-y2, -x2, x2); V(-x2, -y2, y2); V(x2, -y2, y2);          // inner frame
        for (const sx of [-1, 1]) for (const f of [-0.42, 0.42]) H(f * y1, sx * hw, sx * x1);                  // ties: field edge -> outer frame
        for (const sy of [-1, 1]) for (const f of [-0.42, 0.42]) V(f * x1, sy * hh, sy * y1);
        for (const sx of [-1, 1]) H(0, sx * x1, sx * x2);                           // ties: outer -> inner frame
        for (const sy of [-1, 1]) V(0, sy * y1, sy * y2);
        break;
      }
      case 'wanja': {     // 완자살: a running fret of hooked crosses
        const n = Math.max(2, Math.round(w / 0.5)), m = Math.max(2, Math.round(h / 0.44)), cw = w / n, ch = h / m, k = 0.6;
        for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) {
          const cx = -hw + cw * (i + 0.5), cy = -hh + ch * (j + 0.5), a = cw / 2, b = ch / 2;
          S.push([cx, cy - b * k, cx, cy + b * k], [cx - a * k, cy, cx + a * k, cy]);
          S.push([cx, cy + b * k, cx + a * k, cy + b * k], [cx + a * k, cy, cx + a * k, cy - b * k], [cx, cy - b * k, cx - a * k, cy - b * k], [cx - a * k, cy, cx - a * k, cy + b * k]);
          S.push([cx + a * k, cy + b * k, cx + a * k, cy + b], [cx + a * k, cy - b * k, cx + a, cy - b * k], [cx - a * k, cy - b * k, cx - a * k, cy - b], [cx - a * k, cy + b * k, cx - a, cy + b * k]);
        }
        break;
      }
      default: {          // 'ttisal' 띠살(세살): close uprights, rails in three belts
        const nx = Math.max(5, Math.round(w / 0.115));
        for (let i = 1; i < nx; i++) V(-hw + (w * i) / nx);
        const belt = (yc, n, gap) => { for (let k = 0; k < n; k++) H(yc + (k - (n - 1) / 2) * gap); };
        const gap = Math.min(0.085, h * 0.062);
        belt(hh - gap * 3.1, 4, gap); belt(0, 5, gap); belt(-hh + gap * 3.1, 4, gap);
      }
    }
    return S;
  }
  /** lattice bars as boxes (facing +Z, z from 0 to depth) */
  function latticeBars(T, m, segs, bar, depth, tintHex, o) {
    for (const s of segs) {
      const dx = s[2] - s[0], dy = s[3] - s[1], len = Math.hypot(dx, dy);
      if (len < 0.02) continue;
      const g = geo.box(len + bar * 0.6, bar, depth, 'grain', s[0] * 3.1, s[1] * 2.3);
      g.applyMatrix4(new THREE.Matrix4().makeRotationZ(Math.atan2(dy, dx)));
      g.translate((s[0] + s[2]) / 2, (s[1] + s[3]) / 2, depth / 2);
      T.add('wood', g, m, tintHex, o);
    }
  }
  /** a lattice sash with paper: frame (문울거미) + bars + back-lit 한지, centred at m, facing +Z */
  function changho(T, m, o = {}) {
    const w = num(o.w, 1.5), h = num(o.h, 1.3), fr = num(o.frame, 0.06), bar = num(o.bar, 0.026), depth = num(o.depth, 0.03);
    const tn = o.tint || '#c9ae8c', opt = { wall: o.wall, cast: o.cast };
    const iw = w - fr * 2, ih = h - fr * 2;
    for (const sy of [-1, 1]) T.add('wood', KG.timber(w, fr, depth + 0.016, 0.006), mul(m, M(0, sy * (h - fr) / 2, (depth + 0.016) / 2)), tn, opt);
    for (const sx of [-1, 1]) { const g = KG.timber(ih, fr, depth + 0.016, 0.006); g.applyMatrix4(new THREE.Matrix4().makeRotationZ(PI / 2)); T.add('wood', g, mul(m, M(sx * (w - fr) / 2, 0, (depth + 0.016) / 2)), tn, opt); }
    const segs = lattice(o.pattern || 'ttisal', iw, ih);
    latticeBars(T, m, segs, bar, depth, tn, opt);
    if (o.paper !== false) T.add('paper', KG.quad(iw, ih, w * 0.7, h * 0.3), mul(m, M(0, 0, 0.004)), o.paperTint || '#fff6e2', { wall: o.wall, cast: false });
    return { w, h, iw, ih, segs };
  }
  /** 판문: board leaves with two ledges and an iron ring each; open 0..1 swings them into the room */
  function panelDoor(T, m, o = {}) {
    const w = num(o.w, 1.5), h = num(o.h, 2.0), leaves = Math.max(1, Math.round(num(o.leaves, 2))), open = clamp(num(o.open, 0), 0, 1);
    const lw = w / leaves, tn = o.tint || '#b89a78', opt = { wall: o.wall, cast: o.cast };
    for (let i = 0; i < leaves; i++) {
      const hingeLeft = i < leaves / 2, hx = -w / 2 + (hingeLeft ? i * lw : (i + 1) * lw);
      const sw = (hingeLeft ? 1 : -1) * open * 1.25;
      const leaf = mul(m, mul(M(hx, 0, 0.03, sw), M((hingeLeft ? 1 : -1) * lw / 2, 0, 0)));
      const nb = Math.max(2, Math.round(lw / 0.19)), bw = lw / nb;
      for (let k = 0; k < nb; k++) {
        const g = KG.timber(h - 0.04, bw - 0.006, 0.034, 0.004, k * 0.7 + i);
        g.applyMatrix4(new THREE.Matrix4().makeRotationZ(PI / 2));
        T.add('wood', g, mul(leaf, M(-lw / 2 + bw * (k + 0.5), 0, 0)), k % 2 ? tn : '#c2a482', opt);
      }
      for (const fy of [-0.3, 0.3]) T.add('wood', KG.timber(lw - 0.04, 0.09, 0.03, 0.006), mul(leaf, M(0, fy * h, 0.03)), '#a68868', opt);
      const ring = new THREE.TorusGeometry(0.045, 0.007, 6, 14);
      T.add('iron', ring, mul(leaf, M((hingeLeft ? 1 : -1) * (lw / 2 - 0.1), -0.05, 0.05)), null, { wall: o.wall, cast: false });
      T.add('iron', geo.cyl(0.028, 0.028, 0.012, 10), mul(leaf, M((hingeLeft ? 1 : -1) * (lw / 2 - 0.1), 0.0, 0.048, 0, 1, 1, 1, PI / 2)), null, { wall: o.wall, cast: false });
    }
    return { w, h };
  }

  // ---------------------------------------------------------------- artworks (G.pack)
  const _art = new Map();
  /** a pack artwork as {texture, aspect (w / h), ok}; ok false = not available here (blank silk is shown instead) */
  function art(name) {
    if (!name) return { texture: null, aspect: 0.5, ok: false };
    const full = String(name).indexOf('art/') === 0 ? String(name) : 'art/' + name;
    if (_art.has(full)) return _art.get(full);
    let rec = { texture: null, aspect: 0.5, ok: false };
    try {
      const P = G.pack;
      if (P && typeof P.usable === 'function' && P.usable(full)) {
        const meta = (typeof P.meta === 'function' && P.meta(full)) || {};
        const tex = P.texture(full, { srgb: true, anisotropy: 4 });
        if (tex && tex.isTexture) rec = { texture: tex, aspect: meta.w > 0 && meta.h > 0 ? meta.w / meta.h : 0.5, ok: true };
      }
    } catch (e) { G.log.warn('WORLD', `hanok kit: artwork ${full} unavailable`, e?.message || e); }
    if (rec.ok) _art.set(full, rec);
    return rec;
  }
  function artMaterial(T, rec) {
    // a picture is its own light-independent surface: shown evenly in a dim room, never brighter than paper white
    const m = new THREE.MeshStandardMaterial({ map: rec.texture, roughness: 0.9, metalness: 0, emissiveMap: rec.texture, emissive: new THREE.Color(0xffffff), emissiveIntensity: 0.28 });
    T.ctx?.own?.(m);
    return m;
  }

  // ---------------------------------------------------------------- the room
  class Room {
    constructor(ctx, spec = {}) {
      this.ctx = ctx; this.spec = spec;
      ctx.room = this;
      this.w = num(spec.w, ctx.size?.w || 12); this.d = num(spec.d, ctx.size?.d || 9);
      this.post = num(spec.post, 2.7); this.ridge = num(spec.ridge, ctx.size?.h || 4.6);
      this.roof = spec.roof || 'rafters';
      this.ceilY = num(spec.ceiling, this.post + 0.35);
      this.bays = { x: Math.max(1, Math.round(num(spec.bays?.x, this.w / 2.7))), z: Math.max(1, Math.round(num(spec.bays?.z, this.d / 2.7))) };
      this.postR = num(spec.postR, 0.15);
      this.low = !!ctx.low;
      this.shadows = !!ctx.preset?.shadows && !this.low;
      this.tone = spec.tone || 'warm';
      this.woodT = this.tone === 'dark' ? '#8a715a' : this.tone === 'pale' ? '#e6d6bd' : '#d2bb9c';
      this.B = { main: new BK.Bucket(), N: new BK.Bucket(), E: new BK.Bucket(), S: new BK.Bucket(), W: new BK.Bucket() };
      this.extra = [];          // [{mesh, wall}] meshes with their own material (art, backdrop)
      this.shadow = [];         // geometries of the shadow caster
      this.ports = [];          // where the sun comes in: {side, u0, u1, v0, v1, segs?, cu, cv}
      this.solid = { N: [], E: [], S: [], W: [] };
      this.updates = [];
      this.fx = null;
      this.atlas = null;
      this.rnd = G.util.rng('hk:' + ctx.id);
      this.len = { N: this.w, S: this.w, E: this.d, W: this.d };
      this.nb = { N: this.bays.x, S: this.bays.x, E: this.bays.z, W: this.bays.z };
      this.walls = {};
      for (const s of SIDES) {
        const list = Array.isArray(spec.walls?.[s]) ? spec.walls[s] : [];
        this.walls[s] = Array.from({ length: this.nb[s] }, (_, i) => list[i] ?? 'plaster');
      }
      // the window sun: where most of the light comes in unless the spec says so
      let az = num(spec.sun?.az, NaN);
      if (!Number.isFinite(az)) {
        const score = (s) => this.walls[s].reduce((n, b) => n + (b && typeof b === 'object' && (b.window || b.open) ? 1 : 0), 0);
        const best = SIDES.slice().sort((a, b) => score(b) - score(a))[0];
        az = { N: 0, E: 90, S: 180, W: 270 }[best] + 24;
      }
      const el = clamp(num(spec.sun?.el, 34), 12, 70) * DEG, th = az * DEG;
      this.sun = new THREE.Vector3(Math.cos(el) * Math.sin(th), Math.sin(el), -Math.cos(el) * Math.cos(th)).normalize();
      this._shell();
    }
    // ---- placement
    at(x, y, z, ry = 0, s = 1) { return M(x, y, z, ry, s); }
    /** wall frame -> room: u along the wall from its left end (seen from inside), v up, n into the room */
    wm(side, u, v, n = 0, ry = 0) {
      const w = this.w / 2, d = this.d / 2;
      const o = side === 'N' ? [-w, -d] : side === 'E' ? [w, -d] : side === 'S' ? [w, d] : [-w, d];
      return mul(M(o[0], 0, o[1], YAW[side]), M(u, v, n, ry));
    }
    /** room position of a wall spot */
    wp(side, u, v, n = 0) { return new THREE.Vector3(u, v, n).applyMatrix4(this.wm(side, 0, 0, 0)); }
    bay(side, i) { const len = this.len[side] / this.nb[side]; return { u0: i * len, u1: (i + 1) * len, uc: (i + 0.5) * len, len }; }
    /** the underside of the rafters at z (the ridge runs along X) — a flat ceiling answers its height */
    roofY(z) {
      if (this.roof !== 'rafters') return this.ceilY;
      const t = clamp(Math.abs(z) / (this.d / 2), 0, 1), q = 0.5;
      const eave = this.post + 0.5, mid = lerp(this.ridge, eave, 0.56);
      return (t <= q ? lerp(this.ridge, mid, t / q) : lerp(mid, eave, (t - q) / (1 - q))) - 0.14;
    }
    add(key, g, m, tintHex, o) {
      if (!g) return;
      const B = this.B[(o && o.wall) || 'main'] || this.B.main;
      B.add(key, g, m, tint(key, tintHex));
      if (this.shadows && !(o && o.cast === false) && key !== 'paper' && key !== 'glow') this.shadow.push(g);
    }
    /** a mesh with its own material (an artwork, the backdrop); wall = hidden with that wall */
    addMesh(mesh, wall) { this.extra.push({ mesh, wall: wall || null }); return mesh; }
    onUpdate(fn) { if (typeof fn === 'function') this.updates.push(fn); }
    block(x, z, hw, hd, o = {}) { return this.ctx.addCollider({ shape: 'box', x, z, hw, hd, rot: o.rot || 0, maxY: o.maxY, stand: o.stand }); }

    // ---- frame members
    post_(x, z, o = {}) {
      const r = num(o.r, this.postR), top = num(o.top, this.post), base = this.spec.stoneBase === false ? 0 : 0.12;
      if (base) this.add('stone', KG.lathe([[0, 0], [r * 1.75, 0], [r * 1.8, 0.05], [r * 1.5, base * 0.8], [r * 1.25, base], [0, base]], 12), M(x, 0, z), '#bdb6a8', o);
      this.add('wood', KG.post(r, top - base, this.spec.entasis !== false, 12), M(x, base, z), o.tint || this.woodT, o);
    }
    beam(ax, ay, az, bx, by, bz, o = {}) { this.add('wood', KG.span(ax, ay, az, bx, by, bz, num(o.h, 0.2), num(o.w, 0.14), num(o.bevel, 0.014)), null, o.tint || this.woodT, o); }
    log(ax, ay, az, bx, by, bz, r = 0.06, o = {}) { this.add('wood', geo.tube(ax, ay, az, bx, by, bz, r, o.seg || 7), null, o.tint || this.woodT, o); }

    // ---- the shell: floor, posts, rails, walls, roof
    _shell() {
      const s = this.spec, w = this.w, d = this.d, P = this.post;
      this._floor(s.floor || 'maru');
      // posts on every bay line (the four corner posts go with the short walls E / W)
      for (const side of SIDES) {
        const n = this.nb[side], len = this.len[side], ends = side === 'E' || side === 'W';
        for (let i = ends ? 0 : 1; i <= (ends ? n : n - 1); i++) {
          const p = this.wp(side, (len * i) / n, 0, 0);
          this.post_(p.x, p.z, { wall: side, top: ends && this.roof === 'rafters' ? Math.max(P, this.roofY(p.z) + 0.1) : P });
        }
      }
      // 하인방 (sill) and 창방 (lintel between post tops) + wall bays
      for (const side of SIDES) {
        const n = this.nb[side], len = this.len[side];
        const openAll = this.walls[side].every((b) => b && typeof b === 'object' && b.open);
        if (!openAll) this.add('wood', KG.timber(len - 0.1, 0.16, 0.13, 0.012), this.wm(side, len / 2, 0.08, 0), this.woodT, { wall: side });
        this.add('wood', KG.timber(len - 0.06, 0.22, 0.14, 0.014), this.wm(side, len / 2, P - 0.13, 0), this.woodT, { wall: side });
        for (let i = 0; i < n; i++) this._bay(side, i, this.walls[side][i]);
      }
      if (this.roof === 'rafters') this._rafterRoof();
      else if (this.roof === 'ceiling') this._flatCeiling();
    }
    _floor(kind) {
      const w = this.w, d = this.d, rnd = this.rnd;
      this.floorKind = kind;
      if (kind === 'maru') {
        // 우물마루: 장귀틀 on the bay lines (along Z), 동귀틀 between them (along X), short 청판 slotted in between
        this.add('paint', KG.floor(w, d), M(0, -0.012, 0), '#2a1d14', { cast: false });               // the dark of the joints
        const nx = this.bays.x, bw = w / nx, jw = 0.2, dw = 0.13;
        for (let i = 0; i <= nx; i++) {
          const x = -w / 2 + bw * i, half = i === 0 || i === nx;
          const g = KG.floor(half ? jw / 2 : jw, d, false, i * 1.7, 0); g.rotateY(0);
          const uv = g.attributes.uv; for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getY(k), uv.getX(k));   // grain along Z
          this.add('floor', g, M(x + (i === 0 ? jw / 4 : i === nx ? -jw / 4 : 0), 0.002, 0), '#cdbda4', { cast: false });
        }
        const rows = Math.max(2, Math.round(d / 0.78)), rl = d / rows;
        for (let i = 0; i < nx; i++) {
          const x0 = -w / 2 + bw * i + jw / 2, x1 = x0 + bw - jw, span = x1 - x0;
          for (let j = 0; j <= rows; j++) {
            const z = -d / 2 + rl * j;
            if (j > 0 && j < rows) this.add('floor', KG.floor(span, dw, false, i * 2.3 + j * 0.9, j * 0.31), M((x0 + x1) / 2, 0.001, z), '#d6c7ae', { cast: false });
            if (j === rows) break;
            // boards of this cell: uneven widths, each with its own shade
            let x = x0 + 0.004;
            const z0 = z + (j === 0 ? 0 : dw / 2) + 0.004, z1 = z + rl - (j === rows - 1 ? 0 : dw / 2) - 0.004;
            while (x < x1 - 0.05) {
              let bwid = 0.17 + rnd() * 0.13;
              if (x + bwid > x1 - 0.09) bwid = x1 - 0.004 - x;
              const g = KG.floor(bwid - 0.006, z1 - z0, false, rnd() * 3, rnd() * 3);
              const uv = g.attributes.uv; for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getY(k), uv.getX(k));
              const sh = 0.93 + rnd() * 0.12;
              this.add('floor', g, M(x + bwid / 2, 0, (z0 + z1) / 2), new THREE.Color(0.9 * sh, 0.85 * sh, 0.76 * sh), { cast: false });
              x += bwid;
            }
          }
        }
      } else if (kind === 'jangpan') {
        this.add('jangpan', KG.floor(w, d), M(0, 0, 0), '#ffffff', { cast: false });
        // the overlaps of the oiled paper sheets
        const sw = 0.92, sl = 1.84;
        for (let x = -w / 2 + sw; x < w / 2 - 0.05; x += sw) this.add('jangpan', KG.floor(0.012, d), M(x, 0.0015, 0), '#b98a3a', { cast: false });
        let row = 0;
        for (let x = -w / 2; x < w / 2; x += sw, row++) for (let z = -d / 2 + (row % 2 ? sl / 2 : sl); z < d / 2 - 0.05; z += sl) this.add('jangpan', KG.floor(Math.min(sw, w / 2 - x), 0.012), M(x + Math.min(sw, w / 2 - x) / 2, 0.0015, z), '#b98a3a', { cast: false });
      } else if (kind === 'stone') {
        this.add('paint', KG.floor(w, d), M(0, -0.01, 0), '#3a352e', { cast: false });
        const cs = 0.62, nx = Math.round(w / cs), nz = Math.round(d / cs), cx = w / nx, cz = d / nz;
        for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) { const sh = 0.86 + rnd() * 0.2; this.add('stone', KG.floor(cx - 0.014, cz - 0.014, false, rnd() * 4, rnd() * 4), M(-w / 2 + cx * (i + 0.5), 0, -d / 2 + cz * (j + 0.5)), new THREE.Color(0.80 * sh, 0.77 * sh, 0.72 * sh), { cast: false }); }
      } else {
        this.add('earth', KG.floor(w, d), M(0, 0, 0), null, { cast: false });
      }
    }
    /** one wall bay */
    _bay(side, i, spec) {
      const P = this.post, b = this.bay(side, i), wallTop = P - 0.24, kind = typeof spec === 'string' ? spec : spec && typeof spec === 'object' ? (spec.window ? 'window' : spec.door ? 'door' : spec.shutter ? 'shutter' : spec.open ? 'open' : 'plaster') : 'plaster';
      const o = { wall: side };
      const u0 = b.u0 + 0.04, u1 = b.u1 - 0.04, mat_ = spec === 'clay' || spec?.wallMat === 'clay' ? 'clay' : spec === 'board' ? 'wood' : 'plaster';
      const panel = (pu0, pu1, pv0, pv1) => {
        if (pu1 - pu0 < 0.02 || pv1 - pv0 < 0.02) return;
        if (mat_ === 'wood') {   // 판벽: vertical boards
          const n = Math.max(1, Math.round((pu1 - pu0) / 0.24)), bw = (pu1 - pu0) / n;
          for (let k = 0; k < n; k++) { const g = KG.quad(bw - 0.006, pv1 - pv0, k * 0.9 + i, 0); const uv = g.attributes.uv; for (let q = 0; q < uv.count; q++) uv.setXY(q, uv.getY(q), uv.getX(q)); this.add('wood', g, this.wm(side, pu0 + bw * (k + 0.5), (pv0 + pv1) / 2, 0.012), k % 2 ? '#c2a684' : '#b89a78', { wall: side, cast: false }); }
        } else this.add(mat_, KG.quad(pu1 - pu0, pv1 - pv0, pu0 + i * 0.7, pv0), this.wm(side, (pu0 + pu1) / 2, (pv0 + pv1) / 2, 0.012), null, { wall: side, cast: false });
        this.solid[side].push([pu0 - 0.06, pu1 + 0.06, pv0 - 0.1, pv1 + 0.1]);
      };
      if (kind === 'none') { this.solid[side].push([b.u0, b.u1, 0, P]); return; }
      if (kind === 'open') {
        this.ports.push({ side, u0: b.u0 + this.postR, u1: b.u1 - this.postR, v0: 0, v1: P - 0.24, open: true });
        this.solid[side].push([b.u0, b.u1, P - 0.24, P]);
        const n = Math.max(0, Math.round(num(spec.bunhap, 4)));
        if (n) this._bunhapUp(side, b, n);
        return;
      }
      if (kind === 'plaster' || kind === 'clay' || kind === 'board') {
        // 중인방 (middle rail) splits a tall plain wall
        const mid = num(spec?.rail, 1.18);
        this.add('wood', KG.timber(b.len - this.postR * 2 + 0.02, 0.11, 0.1, 0.01), this.wm(side, b.uc, mid, 0), this.woodT, o);
        panel(u0 + this.postR - 0.04, u1 - this.postR + 0.04, 0.16, mid - 0.055);
        panel(u0 + this.postR - 0.04, u1 - this.postR + 0.04, mid + 0.055, wallTop);
        return;
      }
      const ow = Math.min(num(spec.w, kind === 'door' ? 1.5 : kind === 'shutter' ? 1.0 : 1.5), b.len - this.postR * 2 - 0.24);
      const sill = kind === 'door' ? 0.1 : num(spec.sill, kind === 'shutter' ? 1.0 : 0.55);
      const oh = Math.min(num(spec.h, kind === 'door' ? 2.0 : kind === 'shutter' ? 0.9 : 1.3), wallTop - sill - 0.16);
      const cu = b.uc + num(spec.offset, 0), ou0 = cu - ow / 2, ou1 = cu + ow / 2, ov0 = sill, ov1 = sill + oh;
      const jt = 0.09;   // 문선 / 문틀
      // frame around the opening
      for (const su of [ou0 - jt / 2, ou1 + jt / 2]) { const g = KG.timber(ov1 - ov0 + jt * 2, jt, 0.12, 0.01); g.applyMatrix4(new THREE.Matrix4().makeRotationZ(PI / 2)); this.add('wood', g, this.wm(side, su, (ov0 + ov1) / 2, 0), this.woodT, o); }
      this.add('wood', KG.timber(ow + jt * 2 + 0.14, jt, 0.13, 0.01), this.wm(side, cu, ov1 + jt / 2, 0), this.woodT, o);
      this.add('wood', KG.timber(ow + jt * 2 + 0.14, jt, 0.14, 0.01), this.wm(side, cu, ov0 - jt / 2, 0.005), this.woodT, o);
      // infill around it
      const a0 = u0 + this.postR - 0.04, a1 = u1 - this.postR + 0.04;
      panel(a0, ou0 - jt, 0.16, wallTop); panel(ou1 + jt, a1, 0.16, wallTop);
      panel(ou0 - jt, ou1 + jt, ov1 + jt, wallTop);
      if (kind === 'window' || kind === 'shutter') {
        if (ov0 - jt - 0.16 > 0.12) {
          if (kind === 'window' && spec.meoreum !== false) {
            // 머름: a low panelled wall under the window (stiles + sunk panels + cap)
            const y0 = 0.16, y1 = ov0 - jt, n = Math.max(2, Math.round((ow + jt * 2) / 0.5)), pw = (ow + jt * 2) / n;
            this.add('wood', KG.quad(ow + jt * 2, y1 - y0, cu, 0), this.wm(side, cu, (y0 + y1) / 2, 0.006), '#b39474', { wall: side, cast: false });
            for (let k = 0; k <= n; k++) { const g = KG.timber(y1 - y0, 0.06, 0.05, 0.006); g.applyMatrix4(new THREE.Matrix4().makeRotationZ(PI / 2)); this.add('wood', g, this.wm(side, ou0 - jt + pw * k, (y0 + y1) / 2, 0.03), this.woodT, o); }
            this.add('wood', KG.timber(ow + jt * 2, 0.05, 0.05, 0.006), this.wm(side, cu, y0 + 0.025, 0.03), this.woodT, o);
            this.solid[side].push([ou0 - jt, ou1 + jt, 0, y1 + 0.02]);
          } else panel(ou0 - jt, ou1 + jt, 0.16, ov0 - jt);
        }
      }
      if (kind === 'window') {
        const two = ow > 1.15, sw = two ? ow / 2 : ow;
        let segs = [];
        for (let k = 0; k < (two ? 2 : 1); k++) {
          const cx = two ? (k ? sw / 2 : -sw / 2) : 0;
          const r = changho(this, this.wm(side, cu + cx, (ov0 + ov1) / 2, 0.0), { w: sw - 0.008, h: oh - 0.008, pattern: spec.window, wall: side, tint: '#c4a886' });
          segs = segs.concat(r.segs.map((sg) => [sg[0] + cx, sg[1], sg[2] + cx, sg[3]]));
          segs.push([cx - sw / 2 + 0.03, -oh / 2, cx - sw / 2 + 0.03, oh / 2], [cx + sw / 2 - 0.03, -oh / 2, cx + sw / 2 - 0.03, oh / 2], [cx - sw / 2, oh / 2 - 0.03, cx + sw / 2, oh / 2 - 0.03], [cx - sw / 2, -oh / 2 + 0.03, cx + sw / 2, -oh / 2 + 0.03]);
        }
        this.ports.push({ side, u0: ou0, u1: ou1, v0: ov0, v1: ov1, segs, bar: 0.03, pattern: spec.window });
        if (spec.label !== false) this.label(typeof spec.label === 'string' ? spec.label : PATTERN_NAMES[spec.window] || '창살', { side, u: cu, v: ov1 + jt + 0.15, w: 0.52, h: 0.17, style: 'wood' });
      } else if (kind === 'shutter') {
        panelDoor(this, this.wm(side, cu, (ov0 + ov1) / 2, 0.0), { w: ow - 0.01, h: oh - 0.01, leaves: 2, open: num(spec.open, 0), wall: side });
        this.solid[side].push([ou0, ou1, ov0, ov1]);
      } else {
        if (spec.door === 'changho') {
          // 세살문: lattice above, a sunk wooden panel (궁판) below
          const two = ow > 1.0, sw = two ? ow / 2 : ow, kp = Math.min(0.5, oh * 0.26);
          for (let k = 0; k < (two ? 2 : 1); k++) {
            const cx = two ? (k ? sw / 2 : -sw / 2) : 0;
            changho(this, this.wm(side, cu + cx, ov0 + kp + (oh - kp) / 2, 0), { w: sw - 0.008, h: oh - kp - 0.008, pattern: spec.pattern || 'ttisal', wall: side });
            this.add('wood', KG.timber(sw - 0.008, kp - 0.008, 0.045, 0.008), this.wm(side, cu + cx, ov0 + kp / 2, 0.022), '#b89a78', o);
            this.add('wood', KG.quad(sw - 0.14, kp - 0.14), this.wm(side, cu + cx, ov0 + kp / 2, 0.05), '#a88a6a', { wall: side, cast: false });
          }
          this.ports.push({ side, u0: ou0, u1: ou1, v0: ov0 + kp, v1: ov1, segs: null });
          this.solid[side].push([ou0, ou1, ov0 - 0.1, ov0 + kp]);
        } else {
          panelDoor(this, this.wm(side, cu, (ov0 + ov1) / 2, 0.0), { w: ow - 0.01, h: oh - 0.01, leaves: 2, open: num(spec.open, 0), wall: side });
          this.solid[side].push([ou0, ou1, 0, ov1]);
        }
        // 문지방 (threshold)
        this.add('wood', KG.timber(ow + 0.3, 0.08, 0.2, 0.012), this.wm(side, cu, 0.04, 0.03), this.woodT, o);
        if (spec.exit) {
          const p = this.wp(side, cu, 1.1, 0.75);
          this.exitAt = { x: p.x, z: p.z, side };
          this.ctx.exitDoor(p.x, p.z, { y: 1.1 });
          this.label(typeof spec.label === 'string' ? spec.label : '나가는 문', { side, u: cu, v: ov1 + jt + 0.2, w: 0.9, h: 0.26, style: 'wood', sub: '🚪 밖으로' });
        }
      }
    }
    /** 들어열개: n 분합문 leaves folded in pairs and hung from 들쇠 under the eaves, level with the lintel */
    _bunhapUp(side, b, n) {
      const P = this.post, lw = (b.len - this.postR * 2 - 0.1) / n, lh = Math.min(P - 0.45, 2.15), y = P - 0.36, o = { wall: side };
      for (let k = 0; k < n; k++) {
        const u = b.u0 + this.postR + 0.05 + lw * (k + 0.5), fold = k % 2 ? 0.07 : 0;
        // the leaf lies almost level under the eaves: hinged at the lintel, its far end (the 궁판) a little higher,
        // lattice side down; leaf-local y runs from the hinge (0) into the room (lh)
        const m = mul(this.wm(side, u, y + fold, 0.12), mul(M(0, 0, 0, 0, 1, 1, 1, PI / 2 - 0.4), M(0, lh / 2, 0)));
        const kp = lh * 0.26;
        changho(this, mul(m, M(0, -kp / 2, 0)), { w: lw - 0.03, h: lh - kp, pattern: 'ttisal', wall: side, tint: '#c2a482' });
        this.add('wood', KG.timber(lw - 0.03, kp - 0.01, 0.045, 0.008), mul(m, M(0, lh / 2 - kp / 2, 0.02)), '#b89a78', o);
        // 들쇠: an iron hook from the rafters
        if (k % 2 === 0) { const p = this.wp(side, u + lw / 2, y + 0.02 + Math.sin(0.4) * lh * 0.86, 0.12 + Math.cos(0.4) * lh * 0.86); this.add('iron', geo.tube(p.x, p.y, p.z, p.x, Math.max(p.y + 0.15, this.roofY(p.z) + 0.2), p.z, 0.009, 5), null, null, { wall: side, cast: false }); }
      }
    }
    _rafterRoof() {
      const w = this.w, d = this.d, P = this.post, T = this.woodT, hd = d / 2, q = hd * 0.5;
      const eaveY = P + 0.5, ridgeY = this.ridge, midY = lerp(ridgeY, eaveY, 0.56);
      const pur = 0.115;   // 도리 radius
      // 대들보 on every interior bay line + in both gables: bottom on the post tops
      for (let i = 0; i <= this.bays.x; i++) {
        const x = -w / 2 + (w * i) / this.bays.x, end = i === 0 || i === this.bays.x, o = { wall: i === 0 ? 'W' : i === this.bays.x ? 'E' : null };
        const bx = end ? x + (i === 0 ? 0.02 : -0.02) : x;
        this.add('wood', KG.span(bx, P + 0.19, -hd - 0.12, bx, P + 0.19, hd + 0.12, 0.38, 0.3, 0.05), null, this.tone === 'dark' ? '#7d6650' : '#c4ab8a', o);
        // 동자주 → 종보 → 판대공
        const jb = midY - pur - 0.2;   // 종보 centre
        const dh = Math.max(0.05, jb - 0.13 - (P + 0.38));
        for (const sz of [-1, 1]) this.add('wood', KG.timber(dh, 0.2, 0.2, 0.02).applyMatrix4(new THREE.Matrix4().makeRotationZ(PI / 2)), M(bx, P + 0.38 + dh / 2, sz * q), T, o);
        this.add('wood', KG.span(bx, jb, -q - 0.3, bx, jb, q + 0.3, 0.26, 0.22, 0.035), null, this.tone === 'dark' ? '#806952' : '#c8b090', o);
        const k0 = jb + 0.13, k1 = ridgeY - pur - 0.1;
        const kg = prism([[k0, -0.34], [k0, 0.34], [k1, 0.13], [k1, -0.13]], 0.12);
        this.add('wood', kg, M(bx, 0, 0), T, o);
      }
      // 도리 (purlins) + 장여 under each: 주심도리 × 2 (with the long walls), 중도리 × 2, 종도리
      const purlin = (z, y, wall) => {
        this.add('wood', geo.tube(-w / 2 - 0.05, y, z, w / 2 + 0.05, y, z, pur, 10), null, this.tone === 'dark' ? '#84705a' : '#cab292', { wall });
        this.add('wood', KG.timber(w + 0.06, 0.16, 0.09, 0.008), M(0, y - pur - 0.07, z), T, { wall });
      };
      purlin(-hd, eaveY, 'N'); purlin(hd, eaveY, 'S'); purlin(-q, midY, null); purlin(q, midY, null); purlin(0, ridgeY, null);
      // 서까래: 장연 (eave → middle purlin) and 단연 (middle → ridge), a round log every ~0.36 m
      const n = Math.max(6, Math.round(w / 0.36)), rr = 0.058, up = pur + rr * 0.6;
      for (let i = 0; i < n; i++) {
        const x = -w / 2 + (w * (i + 0.5)) / n + (this.rnd() - 0.5) * 0.02, r1 = rr * (0.92 + this.rnd() * 0.16);
        const sh = (this.tone === 'dark' ? 0.62 : 0.94) + this.rnd() * 0.14, tn = new THREE.Color(0.86 * sh, 0.75 * sh, 0.61 * sh);
        for (const sz of [-1, 1]) {
          this.add('wood', geo.tube(x, eaveY + up - 0.07, sz * (hd + 0.28), x, midY + up + 0.02, sz * (q - 0.16), r1, 6), null, tn);
          this.add('wood', geo.tube(x, midY + up, sz * (q + 0.14), x, ridgeY + up + 0.03, sz * 0.03, r1 * 0.95, 6), null, tn);
        }
      }
      // 앙토 / 개판: the pale ceiling between the rafters (single sided, facing down), a touch above the logs' axes
      const plane = (z0, y0, z1, y1) => {
        if (z1 < z0) { const tz = z0, ty = y0; z0 = z1; y0 = y1; z1 = tz; y1 = ty; }      // always towards +Z: the face stays down
        const len = Math.hypot(z1 - z0, y1 - y0), g = geo.mquad(w + 0.2, len, 0, z0);
        g.rotateX(PI / 2);                                      // faces −Y, its length along Z
        const m = new THREE.Matrix4().makeRotationX(Math.atan2(y1 - y0, z1 - z0) * -1);
        g.applyMatrix4(m); g.translate(0, (y0 + y1) / 2 + up + rr * 0.5, (z0 + z1) / 2);
        this.add('plaster', g, null, new THREE.Color(1.32, 1.27, 1.16), { cast: false });   // lit only by what the floor throws back up: kept pale
      };
      for (const sz of [-1, 1]) { plane(sz * (hd + 0.3), eaveY - 0.07, sz * q, midY); plane(sz * q, midY, 0, ridgeY + 0.02); }
      // gables: plaster up to the rafters on the short walls
      for (const [side, x] of [['W', -w / 2], ['E', w / 2]]) {
        const pts = [[-hd, P - 0.02], [hd, P - 0.02], [hd, eaveY + up], [q, midY + up], [0, ridgeY + up], [-q, midY + up], [-hd, eaveY + up]];
        const sh = new THREE.Shape(pts.map((p) => new THREE.Vector2(p[0], p[1])));
        const g = new THREE.ShapeGeometry(sh);
        const uv = g.attributes.uv, pos = g.attributes.position;
        for (let k = 0; k < uv.count; k++) uv.setXY(k, pos.getX(k), pos.getY(k));
        g.applyMatrix4(new THREE.Matrix4().makeRotationY(side === 'W' ? PI / 2 : -PI / 2));
        g.translate(x + (side === 'W' ? 0.03 : -0.03), 0, 0);
        this.add('plaster', g, null, null, { wall: side, cast: false });
      }
      this._roofSlabs = { eaveY, midY, ridgeY, q, hd, up };
      // 포벽: plaster between the lintel and the eave purlin on the long walls, with small bearing blocks (소로)
      for (const side of ['N', 'S']) {
        const y0 = P - 0.02, y1 = eaveY - pur - 0.14;
        this.add('plaster', KG.quad(w, y1 - y0, 0, y0), this.wm(side, w / 2, (y0 + y1) / 2, 0.012), '#efe5d2', { wall: side, cast: false });
        const n2 = this.bays.x * 3;
        for (let i = 0; i <= n2; i++) this.add('wood', KG.slab(0.11, y1 - y0, 0.1, 0.012), this.wm(side, 0.06 + ((w - 0.12) * i) / n2, (y0 + y1) / 2, 0.03), T, { wall: side, cast: false });
        // (shadow caster) the same strip, up to the eaves
        this.solid[side].push([-0.3, w + 0.3, P - 0.26, eaveY + 0.45]);
      }
    }
    _flatCeiling() {
      const w = this.w, d = this.d, y = this.ceilY;
      // 종이반자: paper on a light wooden grid
      this.add('hanji', KG.floor(w, d, true), M(0, y, 0), '#f1e7d0', { cast: false });
      const n = Math.max(2, Math.round(w / 1.2)), m = Math.max(2, Math.round(d / 1.2));
      for (let i = 1; i < n; i++) this.add('wood', KG.timber(d, 0.03, 0.05, 0.004).applyMatrix4(new THREE.Matrix4().makeRotationY(PI / 2)), M(-w / 2 + (w * i) / n, y - 0.012, 0), '#a17650', { cast: false });
      for (let j = 1; j < m; j++) this.add('wood', KG.timber(w, 0.03, 0.05, 0.004), M(0, y - 0.012, -d / 2 + (d * j) / m), '#a17650', { cast: false });
      // exposed 대들보 under the ceiling on the interior bay lines of the longer side
      if (this.spec.beams !== false) for (let i = 1; i < this.bays.x; i++) { const x = -w / 2 + (w * i) / this.bays.x; this.add('wood', KG.span(x, this.post + 0.14, -d / 2, x, this.post + 0.14, d / 2, 0.28, 0.22, 0.04), null, '#7d5437'); }
      // the wall above the lintel up to the ceiling
      for (const side of SIDES) { const len = this.len[side]; this.add('plaster', KG.quad(len, y - this.post + 0.02, 0, this.post), this.wm(side, len / 2, (y + this.post) / 2, 0.012), null, { wall: side, cast: false }); this.solid[side].push([0, len, this.post - 0.1, y + 0.2]); }
    }

    // ---- small things on walls / floor
    _atlas() {
      if (!this.atlas) { this.atlas = new BK.SignAtlas('hk:' + this.ctx.id, 1024, this.low ? 512 : 1024); this.labels = []; }
      return this.atlas;
    }
    /** a small name plate. Either {x, y, z, rotY} in the room or {side, u, v} on a wall */
    label(text, o = {}) {
      const A = this._atlas(), w = num(o.w, 0.5), h = num(o.h, 0.18), paper = o.style === 'paper';
      const px = Math.round(clamp(w * 300, 96, 512)), py = Math.round(clamp(h * 300, 48, 256));
      const rect = A.slot(px, py, (c, cw, ch) => {
        c.fillStyle = paper ? '#f3ead3' : '#3a2a1c'; c.fillRect(0, 0, cw, ch);
        c.strokeStyle = paper ? 'rgba(90,60,30,.5)' : '#b08d4c'; c.lineWidth = Math.max(2, ch * 0.05); c.strokeRect(c.lineWidth, c.lineWidth, cw - c.lineWidth * 2, ch - c.lineWidth * 2);
        c.fillStyle = paper ? '#2e2218' : '#f0d9a0'; c.textAlign = 'center'; c.textBaseline = 'middle';
        let size = Math.round(ch * (o.sub ? 0.4 : 0.52)); c.font = `800 ${size}px ${FONT}`;
        while (c.measureText(String(text)).width > cw * 0.86 && size > 10) { size -= 1; c.font = `800 ${size}px ${FONT}`; }
        c.fillText(String(text), cw / 2, o.sub ? ch * 0.38 : ch * 0.53);
        if (o.sub) { c.font = `600 ${Math.round(size * 0.6)}px ${FONT}`; c.fillStyle = paper ? '#6a5136' : '#d8c49a'; c.fillText(String(o.sub), cw / 2, ch * 0.76); }
      });
      const m = o.side ? this.wm(o.side, o.u, o.v, num(o.n, 0.075)) : M(num(o.x, 0), num(o.y, 1), num(o.z, 0), num(o.rotY, 0), 1, 1, 1, num(o.tilt, 0));
      const wall = o.side || o.wall || null;
      this.labels.push({ g: geo.quad(w, h, rect), m, wall });
      this.add('wood', KG.slab(w + 0.03, h + 0.03, 0.02, 0.005), mul(m, M(0, 0, -0.011)), '#8a6c4e', { wall, cast: false });
      const p = new THREE.Vector3(0, 0, 0).applyMatrix4(m);
      return { x: p.x, y: p.y, z: p.z };
    }
    /** a low stake with a tilted name board */
    signPost(o = {}) {
      const x = num(o.x, 0), z = num(o.z, 0), ry = num(o.rotY, 0), h = num(o.h, 0.92);
      this.add('wood', KG.timber(0.05, h, 0.05, 0.006).applyMatrix4(new THREE.Matrix4().makeRotationZ(0)), M(x, h / 2, z, ry), '#6f4b30');
      const g = KG.timber(h, 0.05, 0.05, 0.006); g.applyMatrix4(new THREE.Matrix4().makeRotationZ(PI / 2));
      this.add('wood', g, M(x, h / 2, z, ry), '#6f4b30');
      this.add('stone', KG.slab(0.22, 0.06, 0.22, 0.012), M(x, 0.03, z, ry), '#b9b2a4');
      return this.label(o.title || '', { x: x + Math.sin(ry) * 0.035, y: h + 0.07, z: z + Math.cos(ry) * 0.035, rotY: ry, tilt: -0.32, w: num(o.w, 0.46), h: num(o.bh, o.sub ? 0.24 : 0.17), sub: o.sub, style: o.style || 'paper' });
    }
    /** a wall shelf (살강 style): returns the spots on it, left to right, top to bottom */
    shelfWall(side, bayIndex, o = {}) {
      const b = this.bay(side, bayIndex), levels = Math.max(1, Math.round(num(o.levels, 2))), slots = Math.max(1, Math.round(num(o.slots, 3)));
      const wid = Math.min(num(o.w, b.len - 0.9), b.len - 0.6), dep = num(o.d, 0.28), y0 = num(o.y, 0.95), gap = num(o.gap, 0.5), out = [];
      for (let l = 0; l < levels; l++) {
        const y = y0 + (levels - 1 - l) * gap;
        this.add('wood', KG.slab(wid, 0.035, dep, 0.006), this.wm(side, b.uc, y, dep / 2 + 0.02), '#8a6040', { wall: side });
        for (const su of [-1, 1]) { const g = prism([[0, 0], [0, dep - 0.03], [-0.16, 0]], 0.03); g.applyMatrix4(new THREE.Matrix4().makeRotationY(-PI / 2)); this.add('wood', g, this.wm(side, b.uc + su * (wid / 2 - 0.12), y - 0.018, 0.02), '#7a5236', { wall: side }); }
        for (let s = 0; s < slots; s++) { const p = this.wp(side, b.uc - wid / 2 + (wid * (s + 0.5)) / slots, y + 0.02, dep / 2 + 0.02); out.push({ x: p.x, y: p.y, z: p.z }); }
      }
      return out;
    }

    // ---- finishing
    /** the engine profile of this room (10-engine setIndoor): window sun, warm fill, void colour, environment */
    light() {
      const E = G.sys.engine, sp = this.spec.light || {}, shadowed = !!E?.indoorShadows;
      const hx = this.w / 2 + 1.2, hz = this.d / 2 + 1.2, top = Math.max(this.ridge, this.ceilY) + 0.4;
      // the shadow frustum hugs the room as the sun sees it
      const sd = this.sun, right = new THREE.Vector3(sd.z, 0, -sd.x).normalize(), upv = new THREE.Vector3().crossVectors(sd, right).normalize();
      let rx = 0, ry = 0;
      const c = new THREE.Vector3(0, top / 2, 0), v = new THREE.Vector3();
      for (const x of [-hx, hx]) for (const y of [0, top]) for (const z of [-hz, hz]) { v.set(x, y, z).sub(c); rx = Math.max(rx, Math.abs(v.dot(right))); ry = Math.max(ry, Math.abs(v.dot(upv))); }
      const dark = this.tone === 'dark';
      return {
        center: { x: 0, y: top / 2, z: 0 }, radius: rx + 0.3, radiusY: ry + 0.3, dir: sd.clone(), dist: 60,
        // without shadows the sun would light every surface the same: it stays a soft key and the decal draws the window light
        sun: { color: '#fff0da', intensity: shadowed ? 3.9 : 0.7 }, moon: { color: '#8ea4d8', intensity: shadowed ? 0.55 : 0.14 },
        hemi: { sky: dark ? '#e6d8c2' : '#f4eee3', ground: dark ? '#8c7a66' : '#c2a888', intensity: shadowed ? (dark ? 0.32 : 0.42) : 0.86 },
        hemiNight: { sky: '#56628a', ground: '#4a3a2a', intensity: 0.36 },
        // the void: a scene value (the engine brings it down the tone curve; on the screen about (28, 24, 22) by day)
        fill: 0.04, background: '#4d4339', backgroundNight: '#3b3b45', fog: { color: '#4d4339', density: 0.0012 },
        exposure: 1.02, exposureNight: 1.34, warmth: 0.02, envIntensity: this.low ? 0.35 : 0.5,
        env: this._env || null, onBake: (nf) => this._envLook?.(nf),
        shadow: { bias: -0.0006, normalBias: 0.011, radius: 1.4, mapSize: 2048 },
        ...sp,
      };
    }
    /** a tiny scene of the room for the environment bake: warm floor, pale walls, dark roof, bright windows */
    _buildEnv() {
      const sc = new THREE.Scene(), w = this.w, d = this.d, h = Math.max(this.ridge, this.ceilY), eye = 1.3;
      const g = new THREE.BoxGeometry(w, h, d);
      const colr = [], p = g.attributes.position, c = new THREE.Color();
      for (let i = 0; i < p.count; i++) {
        const y = p.getY(i);
        if (y < 0) c.set('#8a6238'); else c.set(this.roof === 'rafters' ? '#5a4332' : '#d8cdb8');
        colr.push(c.r, c.g, c.b);
      }
      g.setAttribute('color', new THREE.Float32BufferAttribute(colr, 3));
      const wallM = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide });
      const box = new THREE.Mesh(g, wallM); box.position.set(0, h / 2 - eye, 0); sc.add(box);
      const band = new THREE.Mesh(new THREE.BoxGeometry(w * 0.999, this.post, d * 0.999), new THREE.MeshBasicMaterial({ color: new THREE.Color('#cdbfa5'), side: THREE.BackSide }));
      band.position.set(0, this.post / 2 - eye, 0); sc.add(band);
      const fl = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshBasicMaterial({ color: new THREE.Color('#9a6f42') })); fl.rotation.x = -PI / 2; fl.position.y = -eye + 0.01; sc.add(fl);
      const winM = new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 1, 1) });
      for (const pt of this.ports) {
        const q = new THREE.Mesh(new THREE.PlaneGeometry(pt.u1 - pt.u0, pt.v1 - pt.v0), winM);
        q.applyMatrix4(this.wm(pt.side, (pt.u0 + pt.u1) / 2, (pt.v0 + pt.v1) / 2 - eye, 0.05));
        sc.add(q);
      }
      this._env = sc; this._envMats = [wallM, band.material, fl.material, winM];
      this._envLook = (nf) => {
        const dayK = 1 - nf;
        winM.color.setRGB(lerp(0.16, 3.4, dayK), lerp(0.2, 3.0, dayK), lerp(0.34, 2.3, dayK));
        wallM.color.setScalar(lerp(0.3, 1, dayK)); band.material.color.set('#cdbfa5').multiplyScalar(lerp(0.3, 1, dayK)); fl.material.color.set('#9a6f42').multiplyScalar(lerp(0.35, 1.1, dayK));
      };
      for (const m of this._envMats) this.ctx.own(m);
      sc.traverse((o) => { if (o.geometry) this.ctx.own(o.geometry); });
    }
    /** the window light on the floor as a picture (presets without indoor shadows) */
    _buildDecal() {
      const w = this.w, d = this.d, ppm = this.low ? 40 : 64, cw = Math.min(2048, Math.round(w * ppm)), ch = Math.min(2048, Math.round(d * ppm));
      const sx = cw / w, sz = ch / d, sd = this.sun, kx = -sd.x / sd.y, kz = -sd.z / sd.y;
      const tex = G.gfx.canvasTexture(cw, ch, (c) => {
        c.fillStyle = '#000'; c.fillRect(0, 0, cw, ch);
        for (const pt of this.ports) {
          const o = this.wp(pt.side, 0, 0, 0), ux = this.wp(pt.side, 1, 0, 0).sub(o), cu = (pt.u0 + pt.u1) / 2, cv = (pt.v0 + pt.v1) / 2;
          // only light that travels into the room through this wall
          const inward = this.wp(pt.side, 0, 0, 1).sub(o);
          if (-(sd.x * inward.x + sd.z * inward.z) <= 0.05) continue;
          // port (a, b) [a along the wall from its centre, b up from its centre] -> canvas
          const px = (a, b) => [(o.x + ux.x * (cu + a) + kx * (cv + b) + w / 2) * sx, (o.z + ux.z * (cu + a) + kz * (cv + b) + d / 2) * sz];
          const O = px(0, 0), A = px(1, 0), Bv = px(0, 1);
          c.save();
          c.setTransform(A[0] - O[0], A[1] - O[1], Bv[0] - O[0], Bv[1] - O[1], O[0], O[1]);
          const hw = (pt.u1 - pt.u0) / 2, hh = (pt.v1 - pt.v0) / 2;
          c.shadowColor = 'rgba(255,214,150,0.9)'; c.shadowBlur = pt.open ? 28 : 10;
          c.fillStyle = pt.open ? 'rgba(255,222,170,0.82)' : 'rgba(255,224,176,0.95)';
          c.fillRect(-hw, -hh, hw * 2, hh * 2);
          c.shadowBlur = 0;
          if (pt.segs) {
            c.strokeStyle = 'rgba(0,0,0,0.9)'; c.lineWidth = (pt.bar || 0.028) * 1.15; c.lineCap = 'butt';
            c.beginPath();
            for (const s of pt.segs) { c.moveTo(s[0], s[1]); c.lineTo(s[2], s[3]); }
            c.stroke();
          }
          c.restore();
        }
        // soften the whole picture a little (the sun is a disc, paper scatters)
        try { c.filter = 'blur(1.5px)'; c.globalAlpha = 0.5; c.drawImage(c.canvas, 0, 0); c.filter = 'none'; c.globalAlpha = 1; } catch (e) { /* no canvas filter */ }
      }, { full: true, anisotropy: 4 });
      this.ctx.own(tex);
      const mat_ = new THREE.MeshBasicMaterial({ map: tex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.5, fog: false });
      this.ctx.own(mat_);
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat_);
      mesh.rotation.x = -PI / 2; mesh.position.y = 0.014; mesh.name = 'room-sunlight'; mesh.renderOrder = 2; mesh.raycast = () => {};
      mesh.userData.guardSkip = true;
      this.ctx.group.add(mesh);
      this._decal = mesh;
    }
    /** soft beams of window sun in the room's air: one additive mesh, brighter at the window, gone at night */
    _buildShafts() {
      const sd = this.sun, pos = [], colr = [], idx = [];
      for (const pt of this.ports) {
        if (pt.open) continue;
        const inw = this.wp(pt.side, 0, 0, 1).sub(this.wp(pt.side, 0, 0, 0));
        if (-(sd.x * inw.x + sd.z * inw.z) <= 0.12) continue;
        const top = [this.wp(pt.side, pt.u0 + 0.05, pt.v1 - 0.05, 0.04), this.wp(pt.side, pt.u1 - 0.05, pt.v1 - 0.05, 0.04), this.wp(pt.side, pt.u1 - 0.05, pt.v0 + 0.05, 0.04), this.wp(pt.side, pt.u0 + 0.05, pt.v0 + 0.05, 0.04)];
        const bot = top.map((p) => { const t = (p.y - 0.02) / sd.y; return new THREE.Vector3(p.x - sd.x * t, 0.02, p.z - sd.z * t); });
        for (let k = 0; k < 4; k++) {
          const a = top[k], b = top[(k + 1) % 4], c2 = bot[(k + 1) % 4], d2 = bot[k], base = pos.length / 3;
          pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c2.x, c2.y, c2.z, d2.x, d2.y, d2.z);
          colr.push(1, 0.93, 0.8, 1, 0.93, 0.8, 0.16, 0.14, 0.11, 0.16, 0.14, 0.11);
          idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
        }
      }
      if (!idx.length) return;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(colr, 3)); g.setIndex(idx);
      const m = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, opacity: 0.05, fog: false });
      this.ctx.own(m);
      const mesh = new THREE.Mesh(g, m);
      mesh.name = 'room-sunshafts'; mesh.renderOrder = 3; mesh.raycast = () => {}; mesh.userData.guardSkip = true;
      this.ctx.group.add(mesh);
      this._shafts = mesh;
    }
    /** one invisible mesh that casts every static shadow of the room (walls with their openings, roof, timbers, props) */
    _buildCaster() {
      const pos = [], idx = [];
      const push = (g, m) => {
        const p = g.attributes.position, base = pos.length / 3, v = new THREE.Vector3();
        for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i); if (m) v.applyMatrix4(m); pos.push(v.x, v.y, v.z); }
        if (g.index) { const a = g.index.array; for (let i = 0; i < a.length; i++) idx.push(base + a[i]); } else for (let i = 0; i < p.count; i++) idx.push(base + i);
      };
      for (const g of this.shadow) push(g, null);
      const box = new THREE.BoxGeometry(1, 1, 1);
      // walls: every solid rectangle as a slab just outside the wall line
      for (const side of SIDES) for (const r of this.solid[side]) {
        const u0 = Math.max(-0.3, r[0]), u1 = Math.min(this.len[side] + 0.3, r[1]), v0 = Math.max(-0.2, r[2]), v1 = r[3];
        if (u1 - u0 < 0.01 || v1 - v0 < 0.01) continue;
        push(box, mul(this.wm(side, (u0 + u1) / 2, (v0 + v1) / 2, -0.1), M(0, 0, 0, 0, u1 - u0, v1 - v0, 0.16)));
      }
      // roof: slabs over the rafters (or one over a flat ceiling), gables
      const w = this.w, hd = this.d / 2;
      if (this._roofSlabs) {
        const s = this._roofSlabs, slab = (z0, y0, z1, y1) => {
          const len = Math.hypot(z1 - z0, y1 - y0);
          push(box, mul(M(0, (y0 + y1) / 2 + s.up + 0.2, (z0 + z1) / 2, 0, 1, 1, 1, -Math.atan2(y1 - y0, z1 - z0)), M(0, 0, 0, 0, w + 1.6, 0.12, len + 0.1)));
        };
        for (const sz of [-1, 1]) { slab(sz * (hd + 1.1), s.eaveY - 0.33, sz * s.q, s.midY); slab(sz * s.q, s.midY, 0, s.ridgeY + 0.02); }
        for (const x of [-w / 2 - 0.1, w / 2 + 0.1]) push(box, M(x, (this.post + s.ridgeY) / 2 + 0.2, 0, 0, 0.16, s.ridgeY - this.post + 0.6, this.d + 0.4));
      } else push(box, M(0, this.ceilY + 0.25, 0, 0, w + 1.2, 0.14, this.d + 1.2));
      box.dispose();
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setIndex(idx);
      g.computeBoundingSphere(); g.computeBoundingBox();
      const mesh = new THREE.Mesh(g, own('caster', () => new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false })));
      mesh.name = 'room-shadow-caster'; mesh.castShadow = true; mesh.receiveShadow = false; mesh.raycast = () => {}; mesh.renderOrder = -5;
      mesh.userData.guardSkip = true; mesh.userData.noOutline = true;
      mesh.matrixAutoUpdate = false; mesh.updateMatrix();
      this.ctx.group.add(mesh);
      this._caster = mesh;
      return idx.length / 3;
    }
    /** the minimap plan in place-local metres (map.X / map.Y / map.S from 50-minimap) */
    plan(c, map) {
      const w = this.w, d = this.d, X = map.X, Y = map.Y, S = map.S;
      c.fillStyle = this.floorKind === 'jangpan' ? '#d9ab58' : this.floorKind === 'earth' ? '#b39874' : this.floorKind === 'stone' ? '#bfb8aa' : '#c79b66';
      c.fillRect(X(-w / 2), Y(-d / 2), w * S, d * S);
      if (this.floorKind === 'maru') {
        c.strokeStyle = 'rgba(70,45,25,.45)'; c.lineWidth = Math.max(1, S * 0.12);
        for (let i = 1; i < this.bays.x; i++) { const x = X(-w / 2 + (w * i) / this.bays.x); c.beginPath(); c.moveTo(x, Y(-d / 2)); c.lineTo(x, Y(d / 2)); c.stroke(); }
      }
      const seg = (side, u0, u1, style, lw) => { const a = this.wp(side, u0, 0, 0), b = this.wp(side, u1, 0, 0); c.strokeStyle = style; c.lineWidth = lw; c.beginPath(); c.moveTo(X(a.x), Y(a.z)); c.lineTo(X(b.x), Y(b.z)); c.stroke(); };
      for (const side of SIDES) {
        for (let i = 0; i < this.nb[side]; i++) {
          const b = this.bay(side, i), sp = this.walls[side][i], k = sp && typeof sp === 'object' ? (sp.window ? 'w' : sp.door ? 'd' : sp.open ? 'o' : sp.shutter ? 'w' : 'p') : 'p';
          if (k === 'o') continue;
          seg(side, b.u0, b.u1, '#4a3423', Math.max(2, S * 0.26));
          if (k === 'w') seg(side, b.uc - 0.7, b.uc + 0.7, '#fff3c9', Math.max(2, S * 0.2));
          if (k === 'd') seg(side, b.uc - 0.75, b.uc + 0.75, '#e0a23e', Math.max(2, S * 0.3));
        }
        for (let i = 0; i <= this.nb[side]; i++) { const p = this.wp(side, (this.len[side] * i) / this.nb[side], 0, 0); c.fillStyle = '#3a2718'; c.beginPath(); c.arc(X(p.x), Y(p.z), Math.max(2, S * 0.2), 0, TAU); c.fill(); }
      }
      for (const f of this._planItems || []) { c.fillStyle = f.color || 'rgba(90,60,35,.75)'; c.fillRect(X(f.x - f.w / 2), Y(f.z - f.d / 2), f.w * S, f.d * S); }
    }
    /** note a footprint for the minimap plan */
    planItem(x, z, w, d, color) { (this._planItems || (this._planItems = [])).push({ x, z, w, d, color }); }

    finish(o = {}) {
      if (this._done) return this;
      this._done = true;
      const ctx = this.ctx, grp = ctx.group, w = this.w, d = this.d;
      if (this.ports.some((p) => p.open) && this.spec.backdrop !== false) this._yard();
      // label quads share one atlas texture
      const used = new Set();
      const mats = {};
      const want = (B) => { for (const k of B.parts.keys()) if (!mats[k]) { mats[k] = k === 'sign' ? this._signMat : mat(k); used.add(k); } };
      if (this.atlas) {
        this._signMat = new THREE.MeshBasicMaterial({ map: this.atlas.getTexture(), fog: false, color: 0xd9d2c4 });
        ctx.own(this._signMat); if (!this.atlas.blank) ctx.own(this.atlas.texture);
        for (const L of this.labels) this.B[L.wall || 'main'].add('sign', L.g, L.m, null);
      }
      let meshes = 0;
      this.wallGroups = {};
      for (const key of ['main'].concat(SIDES)) {
        const B = this.B[key];
        want(B);
        const parent = key === 'main' ? grp : (this.wallGroups[key] = new THREE.Group());
        if (key !== 'main') { parent.name = 'wall:' + key; grp.add(parent); }
        const out = B.build(parent, { name: ctx.id + (key === 'main' ? '' : ':' + key), materials: mats, shadows: false });
        for (const k in out) { meshes++; out[k].receiveShadow = k !== 'paper' && k !== 'glow' && k !== 'sign'; if (k === 'sign') out[k].userData.guardSkip = true; }
      }
      for (const e of this.extra) { (e.wall && this.wallGroups[e.wall] ? this.wallGroups[e.wall] : grp).add(e.mesh); meshes++; }
      // shadows or the painted window light
      let casterTris = 0;
      if (this.shadows) { try { casterTris = this._buildCaster(); } catch (e) { G.log.warn('WORLD', 'hanok kit: shadow caster failed', e?.message || e); } }
      try { this._buildDecal(); } catch (e) { G.log.warn('WORLD', 'hanok kit: light decal failed', e?.message || e); }
      if (!this.low) { try { this._buildEnv(); } catch (e) { G.log.warn('WORLD', 'hanok kit: environment scene failed', e?.message || e); } }
      if (!this.low && this.spec.shafts !== false) { try { this._buildShafts(); } catch (e) { G.log.warn('WORLD', 'hanok kit: light shafts failed', e?.message || e); } }
      // wall colliders: thick, just outside the wall line (the open side too: nobody walks off the 기단)
      for (const [x, z, hw, hd] of [[0, -d / 2 - 1.05, w / 2 + 2, 1], [0, d / 2 + 1.05, w / 2 + 2, 1], [-w / 2 - 1.05, 0, 1, d / 2 + 2], [w / 2 + 1.05, 0, 1, d / 2 + 2]]) ctx.addCollider({ shape: 'box', x, z, hw, hd });
      if (o.exit && !this.exitAt) { ctx.exitDoor(o.exit.x, o.exit.z, { y: 1.1 }); this.exitAt = o.exit; }
      if (!ctx.def.minimap) ctx.def.minimap = (c, map) => this.plan(c, map);
      // per frame: cut-away walls, the look of paper and decal by day and night, the room's own updates
      const cam = G.sys.engine?.camera, paper = MATS.paper.fb(), _l = new THREE.Vector3();
      const dayC = new THREE.Color('#ffe3b4'), nightC = new THREE.Color('#5a6f9c');
      ctx.onUpdate((dt, t) => {
        const nf = clamp(Number(G.world.nightFactor) || 0, 0, 1), E = G.sys.engine;
        if (cam) {
          grp.worldToLocal(_l.copy(cam.position));
          const g = this.wallGroups, m = 0.04;
          if (g.N) g.N.visible = _l.z > -d / 2 + m; if (g.S) g.S.visible = _l.z < d / 2 - m;
          if (g.W) g.W.visible = _l.x > -w / 2 + m; if (g.E) g.E.visible = _l.x < w / 2 - m;
        }
        paper.emissive.copy(dayC).lerp(nightC, nf); paper.emissiveIntensity = lerp(0.92, 0.2, nf);
        if (this._decal) { const on = !E?.indoorShadows; this._decal.visible = on; if (on) this._decal.material.opacity = lerp(0.5, 0.1, nf); }
        if (this._backdrop) this._backdrop.material.color.setScalar(lerp(1.0, 0.16, nf));
        if (this._shafts) { this._shafts.visible = nf < 0.9; this._shafts.material.opacity = lerp(0.055, 0.0, nf); }
        for (let i = 0; i < this.updates.length; i++) this.updates[i](dt, t, nf);
      });
      G.log.info('WORLD', `hanok kit: ${ctx.id} — ${meshes} meshes, ${this.B.main.tris | 0} + wall tris, caster ${casterTris} tris, ${this.ports.length} sun ports, materials ${[...used].join(' ')}`);
      this.meshCount = meshes;
      return this;
    }
    /** the courtyard behind the open bays: 기단 edge, 댓돌, the yard with a 장독대 and a stone wall (real geometry,
     *  lit by the same sun) and, beyond the wall, a painted far view on an arc (ridges, trees, sky) */
    _yard() {
      const open = this.ports.filter((p) => p.open);
      const sides = [...new Set(open.map((p) => p.side))];
      for (const side of sides) {
        const len = this.len[side], r = this.rnd, Y = -0.5, o = { cast: false };
        const put = (u, v, n, ry = 0) => this.wm(side, u, v, -n, ry);          // n metres out into the yard
        // 기단: the stone platform edge and the step stone; the yard lies 0.5 m below the floor
        this.add('stone', KG.slab(len + 0.6, 0.5, 1.5, 0.02), put(len / 2, -0.25, 0.75), '#c5beb0', o);
        this.add('stone', KG.slab(1.5, 0.22, 0.55, 0.03), put(len / 2, -0.39, 1.8), '#b7b0a2', o);
        this.add('earth', KG.floor(len + 30, 13), put(len / 2, Y, 7.4), '#cdb48c', o);
        // 돌담: a field-stone wall with a tile cap, 8 m out
        this.add('stone', KG.slab(len + 26, 1.35, 0.55, 0.03), put(len / 2, Y + 0.675, 8.2), '#e2d6c0', o);
        this.add('paint', KG.slab(len + 26, 0.1, 0.8, 0.02), put(len / 2, Y + 1.4, 8.2), '#45494e', o);
        this.add('paint', KG.slab(len + 26, 0.09, 0.34, 0.03), put(len / 2, Y + 1.49, 8.2), '#3c4045', o);
        // 장독대: a low stone platform with jars of many sizes
        const cx = len * 0.34;
        this.add('stone', KG.slab(4.6, 0.22, 2.5, 0.03), put(cx, Y + 0.11, 5.2), '#bdb6a8', o);
        const kinds = ['dok', 'hangari', 'jungduri', 'hangari', 'danji', 'dok', 'hangari', 'danji', 'jungduri', 'danji', 'hangari'];
        kinds.forEach((kind, i) => {
          const row = i % 2, u = cx - 1.9 + (i * 3.8) / (kinds.length - 1) + (r() - 0.5) * 0.12, n = 5.7 - row * 0.95 + (r() - 0.5) * 0.1, s = (kind === 'dok' ? 0.92 : kind === 'danji' ? 1.05 : 0.95) * (0.9 + r() * 0.2);
          const sh = 0.8 + r() * 0.35, m = mul(put(u, Y + 0.22, n, r() * 6), M(0, 0, 0, 0, s));
          this.add('onggi', KG.lathe(BK.JAR_PROFILES[kind], 14), m, new THREE.Color(0.44 * sh, 0.29 * sh, 0.2 * sh), o);
          const rim = BK.JAR_PROFILES[kind][BK.JAR_PROFILES[kind].length - 3][0];
          this.add('onggi', BK.lidGeometry(12, rim), mul(m, M(0, BK.jarTop(kind) - 0.02, 0)), new THREE.Color(0.4 * sh, 0.26 * sh, 0.18 * sh), o);
        });
        // a few flat stepping stones across the yard
        for (let i = 0; i < 5; i++) this.add('stone', geo.cyl(0.32 + r() * 0.1, 0.34 + r() * 0.1, 0.06, 9), put(len / 2 + (r() - 0.5) * 0.5, Y + 0.03, 2.7 + i * 0.95, r() * 3), '#a9a294', o);
        // the far view: one picture on an arc behind the wall
        const tex = G.gfx.canvasTexture(this.low ? 1024 : 2048, this.low ? 256 : 512, (c, cw, ch) => paintFar(c, cw, ch, this.ctx.id), { full: !this.low });
        this.ctx.own(tex);
        const R = 15, arc = 2.6, bg = new THREE.CylinderGeometry(R, R, 9, 40, 1, true, -arc / 2, arc);
        const mat_ = new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, fog: false });
        this.ctx.own(mat_);
        const mesh = new THREE.Mesh(bg, mat_);
        // the arc is centred on the cylinder's +Z: turned to stand outside this wall, its middle 9.5 m out
        mesh.applyMatrix4(mul(this.wm(side, len / 2, 3.2, 5.5), M(0, 0, 0, PI)));
        mesh.name = 'room-backdrop'; mesh.userData.guardSkip = true; mesh.raycast = () => {};
        this.addMesh(mesh, null);
        this._backdrop = mesh;
      }
    }
  }
  /** the far view behind the yard wall: a soft sky, three ridges fading with distance, a line of pines and broadleaves */
  function paintFar(c, w, h, seed) {
    const r = G.util.rng('hk:far:' + seed);
    const hz = h * 0.62;                                   // where the ridges stand (about eye level in the room)
    const sky = c.createLinearGradient(0, 0, 0, hz);
    sky.addColorStop(0, '#8fb6dd'); sky.addColorStop(0.55, '#bcd5e8'); sky.addColorStop(1, '#e3ebe6');
    c.fillStyle = sky; c.fillRect(0, 0, w, h);
    for (let i = 0; i < 9; i++) {   // thin high clouds
      const x = r() * w, y = h * (0.08 + r() * 0.3), g = c.createRadialGradient(x, y, 0, x, y, 60 + r() * 120);
      g.addColorStop(0, 'rgba(255,255,255,0.5)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = g; c.save(); c.translate(x, y); c.scale(2.6, 0.5); c.translate(-x, -y); c.fillRect(x - 200, y - 200, 400, 400); c.restore();
    }
    const ridge = (base, amp, col2, f) => {
      c.fillStyle = col2; c.beginPath(); c.moveTo(0, h);
      for (let x = 0; x <= w; x += 6) c.lineTo(x, base - (Math.sin(x * f + base) * 0.5 + Math.sin(x * f * 2.7 + 1.3) * 0.28 + Math.sin(x * f * 6.1 + 4) * 0.1) * amp - amp * 0.6);
      c.lineTo(w, h); c.fill();
    };
    ridge(hz - h * 0.02, h * 0.11, '#a9bfcb', 0.0042); ridge(hz + h * 0.01, h * 0.085, '#8dab9f', 0.0061); ridge(hz + h * 0.045, h * 0.06, '#6f957a', 0.0085);
    // the wooded slope just beyond the wall: many small crowns, darker below, a little light on their tops
    for (let pass = 0; pass < 3; pass++) {
      const n = 150 + pass * 70;
      for (let i = 0; i < n; i++) {
        const x = r() * w, s = h * (0.016 + r() * 0.02) * (1 + pass * 0.45), y = hz + h * (0.05 + pass * 0.035) + r() * h * 0.03, pine = r() < 0.45;
        const g0 = 70 + pass * 8 + r() * 26;
        c.fillStyle = `rgb(${g0 * 0.56 | 0},${g0 * 1.12 | 0},${g0 * 0.62 | 0})`;
        if (pine) { c.beginPath(); c.moveTo(x, y - s * 2.1); c.lineTo(x + s * 0.6, y); c.lineTo(x - s * 0.6, y); c.fill(); }
        else { c.beginPath(); c.ellipse(x, y - s * 0.8, s * 0.85, s * 0.9, 0, 0, TAU); c.fill(); }
        c.fillStyle = 'rgba(214,232,170,0.16)'; c.beginPath(); c.ellipse(x - s * 0.2, y - s * (pine ? 1.4 : 1.15), s * 0.32, s * 0.3, 0, 0, TAU); c.fill();
      }
    }
    const gr = c.createLinearGradient(0, hz + h * 0.1, 0, h);
    gr.addColorStop(0, '#4f7a4c'); gr.addColorStop(1, '#7f8d5e');
    c.fillStyle = gr; c.fillRect(0, hz + h * 0.16, w, h);
    // a breath of haze over the foot of the hills
    const hazeG = c.createLinearGradient(0, hz - h * 0.05, 0, hz + h * 0.12);
    hazeG.addColorStop(0, 'rgba(232,238,232,0)'); hazeG.addColorStop(1, 'rgba(232,238,232,0.35)');
    c.fillStyle = hazeG; c.fillRect(0, hz - h * 0.05, w, h * 0.17);
  }

  // ---------------------------------------------------------------- props
  const P0 = (o) => M(num(o.x, 0), num(o.y, 0), num(o.z, 0), num(o.rotY, 0));
  const base = (T, o) => (o.m && o.m.isMatrix4 ? o.m : P0(o));
  function block(T, o = {}) {
    const w = num(o.w, 0.4), h = num(o.h, 0.3), d = num(o.d, 0.4);
    T.add(o.mat || 'furn', KG.slab(w, h, d, num(o.bevel, 0.012)), mul(base(T, o), M(0, h / 2, 0)), o.tint, o);
    return { w, d, top: num(o.y, 0) + h };
  }
  /** a panelled chest: posts, rails, sunk panels, a lid line, metal fittings */
  function chest(T, o = {}) {
    const w = num(o.w, 0.9), d = num(o.d, 0.45), h = num(o.h, 0.8), legs = num(o.legs, 0.08), m = base(T, o), key = o.mat || 'furn';
    const tn = o.tone || '#7a4a2e', dark = o.frameTone || '#5d3722', fit = o.fittings === false ? null : (o.fittings || 'brass');
    const st = 0.05, bh = h - legs;
    // carcass (a touch smaller than the frame so the panels read as sunk)
    T.add(key, KG.slab(w - 0.02, bh - 0.02, d - 0.02, 0.006), mul(m, M(0, legs + bh / 2, 0)), tn, o);
    // frame: four posts down to the feet + top and bottom rails on the front and sides
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) { const g = KG.timber(h, st, st, 0.006); g.applyMatrix4(new THREE.Matrix4().makeRotationZ(PI / 2)); T.add(key, g, mul(m, M(sx * (w - st) / 2, h / 2, sz * (d - st) / 2)), dark, o); }
    for (const y of [legs + st / 2, h - st / 2]) {
      for (const sz of [-1, 1]) T.add(key, KG.timber(w - st * 2, st, st * 0.8, 0.005), mul(m, M(0, y, sz * (d - st * 0.8) / 2)), dark, o);
      for (const sx of [-1, 1]) T.add(key, KG.timber(d - st * 2, st, st * 0.8, 0.005).applyMatrix4(new THREE.Matrix4().makeRotationY(PI / 2)), mul(m, M(sx * (w - st * 0.8) / 2, y, 0)), dark, o);
    }
    T.add(key, KG.slab(w + 0.03, 0.03, d + 0.03, 0.008), mul(m, M(0, h + 0.015, 0)), dark, o);   // 천판
    // front: drawers on top, then doors (or one drop front for a 반닫이)
    const fz = d / 2 + 0.001, iw = w - st * 2, drawers = Math.max(0, Math.round(num(o.drawers, 0))), doors = Math.max(0, Math.round(num(o.doors, 2)));
    let top = h - st;
    if (drawers) {
      const dh = Math.min(0.14, (bh - st * 2) * 0.24), dw = iw / drawers;
      for (let i = 0; i < drawers; i++) {
        T.add(key, KG.slab(dw - 0.012, dh - 0.012, 0.012, 0.004), mul(m, M(-iw / 2 + dw * (i + 0.5), top - dh / 2, fz)), tn, { ...o, cast: false });
        if (fit) T.add(fit, new THREE.TorusGeometry(0.018, 0.004, 5, 10), mul(m, M(-iw / 2 + dw * (i + 0.5), top - dh / 2 - 0.01, fz + 0.012)), null, { ...o, cast: false });
      }
      top -= dh; T.add(key, KG.timber(iw, 0.02, 0.02, 0.003), mul(m, M(0, top, fz)), dark, { ...o, cast: false });
    }
    const ph = top - (legs + st);
    if (doors) {
      const dw = iw / doors;
      for (let i = 0; i < doors; i++) {
        const cx = -iw / 2 + dw * (i + 0.5);
        T.add(key, KG.slab(dw - 0.014, ph - 0.014, 0.012, 0.004), mul(m, M(cx, legs + st + ph / 2, fz)), tn, { ...o, cast: false });
        T.add(key, KG.slab(dw - 0.1, ph - 0.1, 0.008, 0.003), mul(m, M(cx, legs + st + ph / 2, fz + 0.008)), o.panelTone || '#8a5636', { ...o, cast: false });
        if (fit) {
          // hinges at the outer edge, a pull at the meeting edge
          const hx = cx + (i < doors / 2 ? -1 : 1) * (dw / 2 - 0.012);
          for (const fy of [0.22, 0.78]) T.add(fit, KG.slab(0.03, 0.06, 0.006, 0.002), mul(m, M(hx, legs + st + ph * fy, fz + 0.014)), null, { ...o, cast: false });
          T.add(fit, new THREE.TorusGeometry(0.016, 0.004, 5, 10), mul(m, M(cx + (i < doors / 2 ? 1 : -1) * (dw / 2 - 0.04), legs + st + ph * 0.5, fz + 0.018)), null, { ...o, cast: false });
        }
      }
    }
    if (fit) {
      // 앞바탕 (lock plate) in the middle and 감잡이 (corner braces)
      T.add(fit, geo.cyl(0.055, 0.055, 0.006, 14), mul(m, M(0, legs + st + ph * 0.72, fz + 0.016, 0, 1, 1, 1, PI / 2)), null, { ...o, cast: false });
      T.add(fit, KG.slab(0.02, 0.05, 0.012, 0.003), mul(m, M(0, legs + st + ph * 0.72 - 0.05, fz + 0.022)), null, { ...o, cast: false });
      for (const sx of [-1, 1]) for (const y of [legs + st + 0.02, h - st - 0.02]) T.add(fit, KG.slab(0.06, 0.035, 0.005, 0.002), mul(m, M(sx * (w / 2 - 0.035), y, fz + 0.012)), null, { ...o, cast: false });
    }
    T.planItem?.(num(o.x, 0), num(o.z, 0), w, d);
    return { w, d, top: num(o.y, 0) + h + 0.03 };
  }
  /** a low table: top, apron, straight or curved (호족) legs */
  function table(T, o = {}) {
    const w = num(o.w, 0.7), d = num(o.d, 0.4), h = num(o.h, 0.3), m = base(T, o), key = o.mat || 'furn', tn = o.tone || '#6b3d26', round = !!o.round;
    if (round) T.add(key, geo.cyl(w / 2, w / 2 - 0.012, 0.028, 20), mul(m, M(0, h - 0.014, 0)), tn, o);
    else T.add(key, KG.slab(w, 0.028, d, 0.008), mul(m, M(0, h - 0.014, 0)), tn, o);
    if (o.apron !== false && !round) {
      for (const sz of [-1, 1]) T.add(key, KG.timber(w - 0.1, 0.05, 0.015, 0.004), mul(m, M(0, h - 0.055, sz * (d / 2 - 0.04))), tn, o);
      for (const sx of [-1, 1]) T.add(key, KG.timber(d - 0.1, 0.05, 0.015, 0.004).applyMatrix4(new THREE.Matrix4().makeRotationY(PI / 2)), mul(m, M(sx * (w / 2 - 0.04), h - 0.055, 0)), tn, o);
    }
    const lh = h - 0.028, n = round ? 3 : 4;
    for (let i = 0; i < n; i++) {
      const a = round ? (i / n) * TAU + 0.5 : 0, lx = round ? Math.cos(a) * (w / 2 - 0.07) : (i % 2 ? 1 : -1) * (w / 2 - 0.045), lz = round ? Math.sin(a) * (w / 2 - 0.07) : (i < 2 ? 1 : -1) * (d / 2 - 0.045);
      if (o.legs === 'curved') {
        // 호족: an S-curved leg as three short timbers
        const pts = [[0, lh], [0.022, lh * 0.55], [-0.012, lh * 0.2], [0.03, 0]];
        const out = Math.atan2(lz, lx);
        for (let k = 0; k < 3; k++) T.add(key, KG.span(lx + Math.cos(out) * pts[k][0], pts[k][1], lz + Math.sin(out) * pts[k][0], lx + Math.cos(out) * pts[k + 1][0], pts[k + 1][1], lz + Math.sin(out) * pts[k + 1][0], 0.03, 0.03, 0.006), m, tn, o);
      } else { const g = KG.timber(lh, 0.032, 0.032, 0.005); g.applyMatrix4(new THREE.Matrix4().makeRotationZ(PI / 2)); T.add(key, g, mul(m, M(lx, lh / 2, lz)), tn, o); }
    }
    return { w, d, top: num(o.y, 0) + h };
  }
  /** an open shelf (사방탁자 / 살강 / 선반): four slim posts and level boards; returns the spots on its levels */
  function shelf(T, o = {}) {
    const w = num(o.w, 0.6), d = num(o.d, 0.35), h = num(o.h, 1.4), levels = Math.max(1, Math.round(num(o.levels, 3))), m = base(T, o), key = o.mat || 'furn', tn = o.tone || '#6e4129';
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) { const g = KG.timber(h, 0.03, 0.03, 0.005); g.applyMatrix4(new THREE.Matrix4().makeRotationZ(PI / 2)); T.add(key, g, mul(m, M(sx * (w / 2 - 0.015), h / 2, sz * (d / 2 - 0.015))), tn, o); }
    const out = [], pm = new THREE.Vector3();
    for (let l = 0; l <= levels; l++) {
      const y = 0.1 + ((h - 0.12) * l) / levels;
      T.add(key, KG.slab(w, 0.018, d, 0.004), mul(m, M(0, y, 0)), tn, o);
      if (l < levels || o.topSpot) { pm.set(0, y + 0.012, 0).applyMatrix4(m); out.push({ x: pm.x, y: pm.y, z: pm.z }); }
    }
    if (o.back) T.add(key, KG.quad(w - 0.03, h - 0.12), mul(m, M(0, h / 2 + 0.04, -d / 2 + 0.012)), '#5a3421', { ...o, cast: false });
    T.planItem?.(num(o.x, 0), num(o.z, 0), w, d);
    return out;
  }
  // lathe profiles [r, y] at s = 1 (metres)
  const PROFILES = {
    sot: [[0, 0.02], [0.2, 0.02], [0.3, 0.1], [0.36, 0.22], [0.37, 0.3], [0.46, 0.31], [0.46, 0.335], [0.36, 0.34], [0.34, 0.4], [0.3, 0.41], [0.29, 0.38]],       // 가마솥 with its flange (전)
    sotLid: [[0, 0.1], [0.05, 0.1], [0.06, 0.07], [0.2, 0.05], [0.31, 0.012], [0.31, 0], [0, 0]],
    siru: [[0, 0], [0.2, 0], [0.24, 0.03], [0.3, 0.26], [0.31, 0.3], [0.29, 0.3], [0.25, 0.05], [0, 0.04]],                                                       // 시루 (wide steamer)
    bowl: [[0, 0], [0.04, 0], [0.045, 0.012], [0.09, 0.04], [0.1, 0.07], [0.092, 0.07], [0.08, 0.04], [0, 0.018]],
    bottle: [[0, 0], [0.06, 0], [0.085, 0.04], [0.09, 0.12], [0.06, 0.2], [0.025, 0.25], [0.022, 0.31], [0.032, 0.33], [0.02, 0.33], [0, 0.31]],
    brazier: [[0, 0], [0.11, 0], [0.12, 0.03], [0.1, 0.06], [0.2, 0.2], [0.23, 0.22], [0.2, 0.22], [0.17, 0.2], [0.09, 0.09], [0, 0.08]],                        // 화로
    mortar: [[0, 0], [0.2, 0], [0.22, 0.06], [0.15, 0.2], [0.17, 0.4], [0.24, 0.52], [0.25, 0.56], [0.2, 0.56], [0.12, 0.4], [0, 0.36]],                         // 절구
    millstone: [[0, 0], [0.26, 0], [0.27, 0.02], [0.27, 0.1], [0.25, 0.11], [0.25, 0.12], [0.27, 0.13], [0.27, 0.21], [0.25, 0.22], [0.05, 0.22], [0.045, 0.2], [0, 0.2]], // 맷돌
    basin: [[0, 0], [0.2, 0], [0.23, 0.02], [0.34, 0.18], [0.36, 0.2], [0.33, 0.2], [0.22, 0.04], [0, 0.03]],                                                    // 자배기 / 물두멍
  };
  function pot(T, o = {}) {
    const s = num(o.s, 1), kind = o.kind || 'hangari', m = mul(base(T, o), M(0, 0, 0, 0, s)), jar = !!BK.JAR_PROFILES[kind];
    const key = o.mat || (kind === 'sot' ? 'iron' : kind === 'millstone' || kind === 'mortar' ? 'stone' : kind === 'bowl' || kind === 'bottle' ? 'paint' : 'onggi');
    const tn = o.tint || (kind === 'bowl' || kind === 'bottle' ? '#e9e4d6' : kind === 'brazier' ? '#8a6a3a' : null);
    const g = jar ? KG.lathe(BK.JAR_PROFILES[kind], o.seg || 18) : KG.lathe(PROFILES[kind] || PROFILES.bowl, o.seg || 18);
    T.add(kind === 'brazier' ? (o.mat || 'brass') : key, g, m, tn, o);
    let top = (jar ? BK.jarTop(kind) : (PROFILES[kind] || PROFILES.bowl).reduce((a, p) => Math.max(a, p[1]), 0)) * s;
    if (o.lid) {
      if (jar) { const rim = BK.JAR_PROFILES[kind][BK.JAR_PROFILES[kind].length - 3][0]; T.add(key, BK.lidGeometry(16, rim), mul(m, M(0, BK.jarTop(kind) - 0.02, 0)), o.lidTint || tn, o); top += 0.14 * s; }
      else if (kind === 'sot') { T.add('iron', KG.lathe(PROFILES.sotLid, 18), mul(m, M(0, 0.4, 0)), null, o); top += 0.1 * s; }
    }
    return { r: (jar ? 0.42 : 0.3) * s, top: num(o.y, 0) + top };
  }
  /** a cushion: a soft box (rounded top through a subdivided, puffed grid) with a trim band */
  function cushion(T, o = {}) {
    const w = num(o.w, 0.6), d = num(o.d, 0.6), h = num(o.h, 0.09), m = base(T, o), n = 6;
    const g = geo.grid(n, n, (i, j, out) => {
      const u = i / n, v = j / n, e = Math.min(u, 1 - u, v, 1 - v) * 2;
      out[0] = (u - 0.5) * w; out[2] = (0.5 - v) * d; out[1] = h * (0.55 + 0.45 * Math.sqrt(clamp(e * 2.2, 0, 1)));
      out[3] = u * w; out[4] = v * d;
    });
    T.add('cloth', g, m, o.tint || '#b8322e', o);
    T.add('cloth', KG.slab(w, h * 0.55, d, Math.min(0.02, h * 0.25)), mul(m, M(0, h * 0.275, 0)), o.trim || o.tint || '#2f4f8a', o);
    return { w, d, top: num(o.y, 0) + h };
  }
  /** a cloth draped over a w × d top: hangs down `drop` on every side with soft folds */
  function cloth(T, o = {}) {
    const w = num(o.w, 0.8), d = num(o.d, 0.5), drop = num(o.drop, 0.25), m = base(T, o), n = 14, r = G.util.rng('hk:cloth:' + w + d);
    const ph = Array.from({ length: 8 }, () => r() * TAU);
    const g = geo.grid(n, n, (i, j, out) => {
      const u = i / n * 2 - 1, v = j / n * 2 - 1;
      const ex = Math.max(0, Math.abs(u) - 0.72) / 0.28, ez = Math.max(0, Math.abs(v) - 0.72) / 0.28, e = Math.max(ex, ez);
      const wave = Math.sin(u * 9 + ph[0]) * Math.sin(v * 8 + ph[1]) * 0.012 * e;
      out[0] = Math.sign(u) * Math.min(Math.abs(u), 0.72) / 0.72 * (w / 2) + Math.sign(u) * ex * 0.015 + wave;
      out[2] = -(Math.sign(v) * Math.min(Math.abs(v), 0.72) / 0.72 * (d / 2) + Math.sign(v) * ez * 0.015 + wave);
      out[1] = -e * drop + 0.004;
      out[3] = (u + 1) * 0.5 * (w + drop * 2); out[4] = (v + 1) * 0.5 * (d + drop * 2);
    });
    T.add('cloth', g, m, o.tint || '#e8e2d2', { ...o, cast: o.cast });
    return { w, d };
  }
  function roll(T, o = {}) {
    const len = num(o.len, 0.9), r = num(o.r, 0.1), m = base(T, o);
    const g = geo.cyl(r, r, len, 14); g.applyMatrix4(new THREE.Matrix4().makeRotationZ(PI / 2));
    T.add(o.mat || 'cloth', g, mul(m, M(0, r, 0)), o.tint || '#d9c9a0', o);
    for (const sx of [-0.3, 0.3]) { const b = geo.cyl(r + 0.004, r + 0.004, 0.025, 14); b.applyMatrix4(new THREE.Matrix4().makeRotationZ(PI / 2)); T.add('cloth', b, mul(m, M(sx * len, r, 0)), o.band || '#8a3a2a', o); }
    return { top: num(o.y, 0) + r * 2 };
  }
  /** a woven straw mat on the floor with a cloth border */
  function matFloor(T, o = {}) {
    const w = num(o.w, 2.4), d = num(o.d, 1.6), m = base(T, o);
    T.add('straw', KG.floor(w, d), mul(m, M(0, 0.012, 0)), o.tint || '#e0c98a', { ...o, cast: false });
    if (o.border !== false) {
      for (const sz of [-1, 1]) T.add('cloth', KG.floor(w, 0.07), mul(m, M(0, 0.014, sz * (d / 2 - 0.035))), o.border || '#3a3550', { ...o, cast: false });
      for (const sx of [-1, 1]) T.add('cloth', KG.floor(0.07, d), mul(m, M(sx * (w / 2 - 0.035), 0.014, 0)), o.border || '#3a3550', { ...o, cast: false });
    }
    return { w, d };
  }
  /** a picture quad with the artwork's aspect inside a w × h window (letterboxed on silk); returns the drawn size */
  function picture(T, m, rec, maxW, maxH, o = {}) {
    let pw = maxW, ph = maxH;
    if (rec.ok) { if (maxW / maxH > rec.aspect) pw = maxH * rec.aspect; else ph = maxW / rec.aspect; }
    if (rec.ok) {
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(pw, ph), artMaterial(T, rec));
      mesh.applyMatrix4(mul(m, M(0, 0, 0.004)));
      mesh.name = 'room-art'; mesh.userData.guardSkip = true; mesh.receiveShadow = true;
      (T.addMesh ? T.addMesh(mesh, o.wall) : T.ctx?.group?.add(mesh));
    } else T.add('hanji', KG.quad(pw, ph), mul(m, M(0, 0, 0.004)), '#efe6cf', { wall: o.wall, cast: false });
    return { w: pw, h: ph };
  }
  /** 병풍: panels standing in a zig-zag; the artwork runs across them (aspect kept per panel strip) */
  function screen(T, o = {}) {
    const n = Math.max(2, Math.round(num(o.panels, 6))), pw = num(o.w, 0.45), h = num(o.h, 1.7), fold = clamp(num(o.fold, 0.35), 0, 1.2), m = base(T, o);
    const names = Array.isArray(o.art) ? o.art : o.art ? [o.art] : [];
    const recs = names.map((nm) => art(nm));
    const cx = Math.cos(fold) * pw, total = cx * n;
    for (let i = 0; i < n; i++) {
      const a = i % 2 ? -fold : fold, x = -total / 2 + cx * (i + 0.5), z = 0;   // opposite angles about the panel centres meet edge to edge
      const pm = mul(m, M(x, 0, z, a));
      T.add('furn', KG.slab(pw, h, 0.022, 0.004), mul(pm, M(0, h / 2 + 0.03, 0)), o.tint || '#2a2f45', o);
      for (const sx of [-1, 1]) T.add('furn', KG.slab(0.03, 0.03, 0.03, 0.004), mul(pm, M(sx * (pw / 2 - 0.03), 0.015, 0)), '#3a2416', o);
      // silk mount + the picture strip
      T.add('cloth', KG.quad(pw - 0.05, h - 0.1), mul(pm, M(0, h / 2 + 0.03, 0.0125)), o.silk || '#d9cfb6', { ...o, cast: false });
      const aw = pw - 0.1, ah = h - 0.5;
      const rec = recs.length ? (recs.length >= n ? recs[i] : recs[0]) : null;
      if (rec && rec.ok) {
        // one wide picture shown across the panels: this panel gets its slice
        const whole = recs.length < n, g = new THREE.PlaneGeometry(aw, whole ? Math.min(ah, (aw * n) / rec.aspect) : Math.min(ah, aw / rec.aspect));
        if (whole) { const uv = g.attributes.uv; for (let k = 0; k < uv.count; k++) uv.setX(k, (i + uv.getX(k)) / n); }
        const mesh = new THREE.Mesh(g, T._artMat?.get(rec) || artMaterial(T, rec));
        (T._artMat || (T._artMat = new Map())).set(rec, mesh.material);
        mesh.applyMatrix4(mul(pm, M(0, h / 2 + 0.06, 0.0145)));
        mesh.name = 'room-art'; mesh.userData.guardSkip = true;
        (T.addMesh ? T.addMesh(mesh, o.wall) : T.ctx?.group?.add(mesh));
      } else T.add('hanji', KG.quad(aw, ah), mul(pm, M(0, h / 2 + 0.06, 0.0145)), '#eee4cc', { ...o, cast: false });
    }
    T.planItem?.(num(o.x, 0), num(o.z, 0), total, 0.3);
    return { w: total, h };
  }
  /** 족자: a hanging scroll — silk mount, the picture (aspect kept), rollers, a cord. o.m = where its top centre hangs */
  function scroll(T, o = {}) {
    const rec = art(o.art), h = num(o.h, 1.5), m = base(T, o);
    const ph = h * 0.62, pw = rec.ok ? clamp(ph * rec.aspect, 0.2, num(o.maxW, 1.6)) : num(o.w, 0.5), ph2 = rec.ok ? pw / rec.aspect : ph;
    const mw = pw + 0.12, top = (h - ph2) * 0.58, wall = o.wall;
    T.add('cloth', KG.quad(mw, h), mul(m, M(0, -h / 2, 0.012)), o.silk || '#cfc3a4', { wall, cast: false });
    T.add('cloth', KG.quad(mw, top * 0.5), mul(m, M(0, -top * 0.25, 0.0135)), o.band || '#5a6b55', { wall, cast: false });
    picture(T, mul(m, M(0, -top - ph2 / 2, 0.0115)), rec, pw, ph2, { wall });
    T.add('furn', geo.cyl(0.016, 0.016, mw + 0.08, 8).applyMatrix4(new THREE.Matrix4().makeRotationZ(PI / 2)), mul(m, M(0, -h, 0.02)), '#3a2416', { wall });
    T.add('furn', KG.timber(mw + 0.02, 0.018, 0.012, 0.003), mul(m, M(0, 0, 0.015)), '#3a2416', { wall, cast: false });
    T.add('cloth', geo.tube(-mw * 0.3, 0, 0.015, 0, 0.12, 0.012, 0.004, 4), m, '#6a5a3a', { wall, cast: false });
    T.add('cloth', geo.tube(mw * 0.3, 0, 0.015, 0, 0.12, 0.012, 0.004, 4), m, '#6a5a3a', { wall, cast: false });
    const p = new THREE.Vector3(0, -h * 0.55, 0.05).applyMatrix4(m);
    return { x: p.x, y: p.y, z: p.z, w: mw, h, ok: rec.ok };
  }
  function basket(T, o = {}) {
    const r = num(o.r, 0.25), h = num(o.h, 0.2), m = base(T, o), kind = o.kind || 'round';
    if (kind === 'ki') {   // 키: a winnowing scoop
      const g = geo.grid(8, 6, (i, j, out) => { const u = i / 8 - 0.5, v = j / 6; out[0] = u * r * 2.2 * (0.6 + v * 0.4); out[2] = (0.5 - v) * r * 2.4; out[1] = (1 - v) * (0.04 + Math.abs(u) * Math.abs(u) * 1.4) * r * 1.2; out[3] = i / 8 * r * 2; out[4] = v * r * 2; });
      T.add('basket', g, mul(m, M(0, 0.01, 0)), o.tint, o);
      const b = g.clone(); b.index && b.setIndex(Array.from(b.index.array).reverse()); b.computeVertexNormals(); T.add('basket', b, mul(m, M(0, 0.008, 0)), o.tint || '#b8924f', o);
    } else if (kind === 'sieve') {   // 체: a hoop with a mesh bottom
      T.add('furn', geo.cyl(r, r, h, 20, true), mul(m, M(0, h / 2, 0)), '#a07848', o);
      T.add('furn', geo.cyl(r - 0.008, r - 0.008, h, 20, true).scale(-1, 1, 1), mul(m, M(0, h / 2, 0)), '#8a6238', { ...o, cast: false });
      T.add('basket', geo.disc(r - 0.006, 20, 6), mul(m, M(0, 0.012, 0)), '#d8c38a', { ...o, cast: false });
    } else {
      const pts = [[0, 0], [r * 0.72, 0], [r * 0.92, h * 0.35], [r, h], [r * 0.96, h], [r * 0.86, h * 0.36], [r * 0.66, 0.02], [0, 0.02]];
      T.add('basket', KG.lathe(pts, 16), m, o.tint, o);
    }
    return { r, top: num(o.y, 0) + h };
  }
  /** a twisted straw rope along points (it sags between them) */
  function rope(T, o = {}) {
    const pts = (o.points || []).map((p) => new THREE.Vector3(p[0], p[1], p[2])), r = num(o.r, 0.012), sag = num(o.sag, 0.08), m = o.m || null;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1], n = Math.max(2, Math.round(a.distanceTo(b) / 0.3));
      let prev = a.clone();
      for (let k = 1; k <= n; k++) {
        const t = k / n, p = a.clone().lerp(b, t); p.y -= Math.sin(t * PI) * sag;
        T.add('straw', geo.tube(prev.x, prev.y, prev.z, p.x, p.y, p.z, r, 5), m, o.tint || '#cdb06a', { ...o, cast: o.cast !== false && r > 0.01 });
        prev = p;
      }
    }
  }
  function straw(T, o = {}) {
    const s = num(o.s, 1), m = mul(base(T, o), M(0, 0, 0, 0, s)), kind = o.kind || 'bundle';
    if (kind === 'sack') {   // 가마니: a stuffed straw sack lying down
      const g = new THREE.SphereGeometry(0.5, 14, 10); g.scale(0.9, 0.42, 0.56);
      T.add('straw', g, mul(m, M(0, 0.21, 0)), o.tint || '#d4b874', o);
      for (const sx of [-0.45, 0, 0.45]) T.add('straw', new THREE.TorusGeometry(0.235, 0.012, 5, 14).applyMatrix4(new THREE.Matrix4().makeRotationY(PI / 2)).scale(1, 0.88, 1.16), mul(m, M(sx * 0.6, 0.21, 0)), '#b8964e', { ...o, cast: false });
    } else if (kind === 'coil') {   // a coil of rope
      for (let i = 0; i < 4; i++) T.add('straw', new THREE.TorusGeometry(0.2 - i * 0.012, 0.016, 5, 16).applyMatrix4(new THREE.Matrix4().makeRotationX(PI / 2)), mul(m, M(0, 0.016 + i * 0.03, 0)), '#c9aa62', o);
    } else {   // 짚단: a tied sheaf standing up
      T.add('straw', KG.lathe([[0, 0], [0.16, 0], [0.11, 0.3], [0.07, 0.42], [0.1, 0.5], [0.19, 0.85], [0, 0.82]], 10), m, o.tint || '#dcc27c', o);
      T.add('straw', new THREE.TorusGeometry(0.075, 0.012, 5, 12).applyMatrix4(new THREE.Matrix4().makeRotationX(PI / 2)), mul(m, M(0, 0.42, 0)), '#b08f48', { ...o, cast: false });
    }
  }
  /** 좌등: a standing lamp — a wooden frame, paper sides that glow, a lamp from the pool inside */
  function jwadeung(T, o = {}) {
    const h = num(o.h, 0.9), m = base(T, o), s = 0.28;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) { const g = KG.timber(h, 0.028, 0.028, 0.004); g.applyMatrix4(new THREE.Matrix4().makeRotationZ(PI / 2)); T.add('furn', g, mul(m, M(sx * s / 2, h / 2, sz * s / 2)), '#4a2c1b', o); }
    for (const y of [0.16, h - 0.02]) { T.add('furn', KG.slab(s + 0.05, 0.022, s + 0.05, 0.004), mul(m, M(0, y, 0)), '#4a2c1b', o); }
    for (let k = 0; k < 4; k++) T.add('glow', KG.quad(s - 0.03, h - 0.24), mul(m, mul(M(0, 0, 0, k * PI / 2), M(0, (h + 0.14) / 2, s / 2 - 0.004))), '#ffe4b8', { ...o, cast: false });
    if (T.ctx && o.light !== false) T.ctx.light({ x: num(o.x, 0), y: num(o.y, 0) + h * 0.62, z: num(o.z, 0), color: '#ffb469', intensity: num(o.intensity, 7.5), distance: num(o.distance, 11), decay: 1.7, flicker: 0.05, day: 0.3 });
    return { top: num(o.y, 0) + h };
  }
  /** 등잔: an oil lamp on its stand (등잔대) with a small flame */
  function deungjan(T, o = {}) {
    const h = num(o.h, 0.45), m = base(T, o);
    T.add('furn', KG.lathe([[0, 0], [0.09, 0], [0.095, 0.02], [0.02, 0.05], [0.016, h - 0.05], [0.07, h - 0.02], [0.07, h], [0, h]], 12), m, '#3a2416', o);
    T.add('paint', KG.lathe([[0, 0], [0.03, 0], [0.045, 0.02], [0.04, 0.035], [0, 0.03]], 10), mul(m, M(0, h, 0)), '#e8e2d0', o);
    if (T instanceof Room) lamp(T, { x: num(o.x, 0), y: num(o.y, 0) + h + 0.055, z: num(o.z, 0), s: 0.8, intensity: num(o.intensity, 3.2), distance: num(o.distance, 6) });
    return { top: num(o.y, 0) + h + 0.1 };
  }

  // ---------------------------------------------------------------- effects: one Points object per room
  const FX_VERT = `
    attribute vec4 aSeed; attribute vec4 aParam; attribute vec3 aCol;
    uniform float uTime; uniform float uPx; uniform float uStill; uniform float uNight;
    varying float vA; varying vec3 vC; varying float vKind;
    void main() {
      float kind = aParam.x, size = aParam.y, life = max(0.2, aParam.z), rise = aParam.w;
      float t = uStill > 0.5 ? aSeed.x : fract(uTime / life + aSeed.x);
      vec3 p = position;
      float a = 1.0;
      if (kind < 0.5) {                              // flame tongue: rises, narrows, sways slowly
        p.y += t * rise; p.x += sin(uTime * 2.1 + aSeed.y * 6.28) * 0.03 * rise * t * 3.0; p.z += cos(uTime * 1.7 + aSeed.z * 6.28) * 0.03 * rise * t * 3.0;
        a = (1.0 - t) * smoothstep(0.0, 0.12, t); size *= 1.0 - t * 0.6;
      } else if (kind < 1.5) {                       // steam / smoke puff: rises, spreads, fades
        p.y += t * rise; p.x += (aSeed.y - 0.5) * t * rise * 0.5 + sin(uTime * 0.6 + aSeed.z * 6.28) * 0.05 * t; p.z += (aSeed.z - 0.5) * t * rise * 0.5;
        a = sin(t * 3.14159) * 0.55; size *= 0.6 + t * 1.6;
      } else if (kind < 2.5) {                       // dust mote: drifts in its beam, twinkles slowly
        p += vec3(sin(uTime * 0.11 + aSeed.y * 6.28), sin(uTime * 0.09 + aSeed.z * 6.28) * 0.6, cos(uTime * 0.13 + aSeed.w * 6.28)) * rise;
        a = (0.35 + 0.65 * (0.5 + 0.5 * sin(uTime * 0.9 + aSeed.x * 6.28))) * (1.0 - uNight * 0.85);
      } else {                                       // a small steady lamp flame: breathes
        float b = 1.0 + 0.1 * sin(uTime * 4.3 + aSeed.y * 6.28) + 0.06 * sin(uTime * 9.7 + aSeed.z * 6.28);
        if (uStill > 0.5) b = 1.0;
        size *= b; a = 0.95;
      }
      vA = a; vC = aCol; vKind = kind;
      vec4 mv = modelViewMatrix * vec4(p, 1.0);
      gl_Position = projectionMatrix * mv;
      gl_PointSize = clamp(size * uPx / max(0.2, -mv.z), 1.0, 220.0);
    }`;
  const FX_FRAG = `
    varying float vA; varying vec3 vC; varying float vKind;
    void main() {
      vec2 q = gl_PointCoord - 0.5;
      float d = length(q * vec2(1.0, vKind < 0.5 || vKind > 2.5 ? 0.72 : 1.0));
      float m = smoothstep(0.5, 0.05, d);
      if (vKind > 2.5) m = smoothstep(0.5, 0.0, length(vec2(q.x * 1.9, q.y + 0.08 + q.x * q.x * 1.5)));
      float a = clamp(m * vA, 0.0, 1.0);
      if (a < 0.004) discard;
      gl_FragColor = vec4(vC * a, a);
    }`;
  class FxSet {
    constructor(R) { this.R = R; this.items = { add: [], norm: [] }; }
    push(blend, x, y, z, kind, size, life, rise, colHex, n, spread = 0) {
      const c = col(colHex), list = this.items[blend], r = this.R.rnd;
      for (let i = 0; i < n; i++) list.push([x + (r() - 0.5) * spread, y + (r() - 0.5) * spread * 0.3, z + (r() - 0.5) * spread, r(), r(), r(), r(), kind, size * (0.75 + r() * 0.5), life * (0.8 + r() * 0.4), rise, c.r, c.g, c.b]);
    }
    build() {
      const out = [];
      for (const blend of ['norm', 'add']) {
        const L = this.items[blend];
        if (!L.length) continue;
        const n = L.length, pos = new Float32Array(n * 3), seed = new Float32Array(n * 4), par = new Float32Array(n * 4), cl = new Float32Array(n * 3);
        L.forEach((p, i) => { pos.set(p.slice(0, 3), i * 3); seed.set(p.slice(3, 7), i * 4); par.set(p.slice(7, 11), i * 4); cl.set(p.slice(11, 14), i * 3); });
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
        g.setAttribute('aParam', new THREE.BufferAttribute(par, 4)); g.setAttribute('aCol', new THREE.BufferAttribute(cl, 3));
        g.computeBoundingSphere(); g.boundingSphere.radius += 3;
        const m = new THREE.ShaderMaterial({
          name: 'HanokFx', uniforms: { uTime: { value: 0 }, uPx: { value: 600 }, uStill: { value: 0 }, uNight: { value: 0 } },
          vertexShader: FX_VERT, fragmentShader: FX_FRAG, transparent: true, depthWrite: false,
          blending: blend === 'add' ? THREE.AdditiveBlending : THREE.NormalBlending, premultipliedAlpha: blend !== 'add',
        });
        this.R.ctx.own(m);
        const pts = new THREE.Points(g, m);
        pts.name = 'fx-room-' + blend; pts.renderOrder = 4; pts.raycast = () => {};
        G.gfx.guard?.watch?.(pts, { uniforms: true });
        this.R.ctx.group.add(pts);
        out.push(pts);
      }
      const E = G.sys.engine;
      this.R.onUpdate((dt, t, nf) => {
        const h = E?.renderer ? E.renderer.getDrawingBufferSize(new THREE.Vector2()).y : 720, fov = (E?.camera?.fov || 55) * DEG;
        for (const p of out) { const u = p.material.uniforms; u.uTime.value = t % 3600; u.uPx.value = h / (2 * Math.tan(fov / 2)); u.uStill.value = G.settings?.reduceMotion ? 1 : 0; u.uNight.value = nf; }
      });
      return out;
    }
  }
  const fxOf = (R) => {
    if (R.fx) return R.fx;
    R.fx = new FxSet(R);
    const fin0 = R.finish.bind(R);
    R.finish = (o) => { if (!R._done && !R.low) { try { R.fx.build(); } catch (e) { G.log.warn('WORLD', 'hanok kit: effects failed', e?.message || e); } } return fin0(o); };
    return R.fx;
  };
  function fire(R, o = {}) {
    const x = num(o.x, 0), y = num(o.y, 0.1), z = num(o.z, 0), s = num(o.s, 1);
    // embers: a few glowing lumps (they are the fire on low)
    for (let i = 0; i < 5; i++) R.add('glow', new THREE.IcosahedronGeometry(0.05 * s * (0.7 + R.rnd() * 0.6), 0), M(x + (R.rnd() - 0.5) * 0.22 * s, y + 0.03 * s, z + (R.rnd() - 0.5) * 0.16 * s, R.rnd() * 3), i % 2 ? '#ff7a2a' : '#ffb347', { cast: false });
    if (!R.low) { const F = fxOf(R); F.push('add', x, y + 0.04 * s, z, 0, 0.3 * s, 0.9, 0.42 * s, '#ff8a2a', 14, 0.2 * s); F.push('add', x, y + 0.02 * s, z, 0, 0.2 * s, 0.7, 0.3 * s, '#ffd27a', 8, 0.12 * s); }
    if (o.light !== false) R.ctx.light({ x, y: y + 0.3 * s, z: z + num(o.out, 0), color: '#ff9a4a', intensity: num(o.intensity, 7) * s, distance: num(o.distance, 7.5), decay: 1.8, flicker: 0.11, day: 0.7 });
  }
  function steam(R, o = {}) {
    if (R.low) return;
    const s = num(o.s, 1);
    fxOf(R).push('norm', num(o.x, 0), num(o.y, 1), num(o.z, 0), 1, 0.5 * s, num(o.life, 3.2), 0.9 * s, o.color || '#e9e6de', Math.round(num(o.count, 12)), 0.22 * s);
  }
  function smoke(R, o = {}) {
    if (R.low) return;
    const s = num(o.s, 1);
    fxOf(R).push('norm', num(o.x, 0), num(o.y, 1), num(o.z, 0), 1, 0.34 * s, num(o.life, 4.5), 1.3 * s, o.color || '#8f8a84', Math.round(num(o.count, 8)), 0.08 * s);
  }
  function lamp(R, o = {}) {
    const x = num(o.x, 0), y = num(o.y, 1), z = num(o.z, 0), s = num(o.s, 1);
    R.add('glow', new THREE.SphereGeometry(0.012 * s, 6, 5).scale(1, 1.8, 1), M(x, y, z), '#ffd8a0', { cast: false });
    if (!R.low) fxOf(R).push('add', x, y + 0.012 * s, z, 3, 0.11 * s, 1, 0, '#ffb45a', 1, 0);
    if (o.light !== false) R.ctx.light({ x, y: y + 0.05, z, color: o.color || '#ffb060', intensity: num(o.intensity, 3.4), distance: num(o.distance, 6.5), decay: 1.9, flicker: 0.07, day: num(o.day, 0.35) });
  }
  /** motes in the window sun: scattered through the shafts of light that the room's openings let in */
  function dust(R, o = {}) {
    if (R.low) return;
    const F = fxOf(R), sd = R.sun, n = Math.round(num(o.count, 110)), r = R.rnd;
    const ports = R.ports.filter((p) => { const inw = R.wp(p.side, 0, 0, 1).sub(R.wp(p.side, 0, 0, 0)); return -(sd.x * inw.x + sd.z * inw.z) > 0.05; });
    if (!ports.length) return;
    const c = col('#ffe7bd');
    for (let i = 0; i < n; i++) {
      const p = ports[Math.floor(r() * ports.length)], q = R.wp(p.side, lerp(p.u0, p.u1, r()), lerp(p.v0, p.v1, r()), 0.1);
      const tmax = q.y / sd.y, t = r() * tmax * 0.96;
      F.items.add.push([q.x - sd.x * t, q.y - sd.y * t, q.z - sd.z * t, r(), r(), r(), r(), 2, 0.016 + r() * 0.022, 1, 0.07 + r() * 0.07, c.r * 0.9, c.g * 0.9, c.b * 0.9]);
    }
  }

  const K = {
    VERSION: 1, PATTERNS, PATTERN_NAMES, PROFILES,
    room: (ctx, spec) => new Room(ctx, spec), Room,
    mat, tint, art, lattice, changho, panelDoor, geo: KG,
    block, chest, table, shelf, pot, cushion, cloth, roll, floorMat: matFloor, screen, scroll, picture, basket, rope, straw, jwadeung, deungjan,
    fire, steam, smoke, lamp, dust,
  };
  // post / beam under their documented names (post_ is the method: `post` is the post-top height)
  Room.prototype.postAt = Room.prototype.post_;
  G.hanok = K;
})();
