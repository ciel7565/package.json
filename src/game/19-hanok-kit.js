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
//   R.wp(side, u, v, n = 0) -> Vector3           the same wall spot as a room position (for ctx.anchor / ctx.board)
//   R.addMesh(mesh, wall) -> mesh                 a mesh with its own material (artwork, picture): kept out of the merge,
//                    hidden with `wall` while the camera is outside
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
//   R.farArc / R.setFarView(canvas, night)   rooms with open bays: the far view behind the yard wall. 18-places puts a
//                    picture of the real valley there (taken at the house's door); without it the painted view stays
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
//   scroll(T, {art, h = 1.5, maxW = 1.6, wall}) -> {x, y, z, w, h}   족자: a mounted hanging scroll (aspect kept); hang
//                    it with m = R.wm(side, u, v) through opts.m (m = where its top centre hangs)
//   picture(T, m, G.hanok.art(name), maxW, maxH, {wall}) -> {w, h}   a bare artwork fitted inside maxW × maxH (aspect
//                    kept) at matrix m, facing +Z of m; plain 한지 when the artwork is not in this build
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
//                    .span(ax, ay, az, bx, by, bz, h, w, bevel) (a chamfered timber between two room points, no matrix)
//                    .quad(w, h) (a plane facing +Z) · .floor(w, d) (facing +Y) · .lathe([[r, y], …], seg) (turned)
//                    BufferGeometry each, consumed by R.add (pass null as the matrix for .span: it is already placed)
//   Budget: one room ≤ 200 draw calls on high — R.finish() logs the count of meshes it made.
//
// ── 6. EXAMPLE — a small 안방 (see 27-interiors-a.js for the full reference room) ────────────────────────────────────
//   const P = G.sys.places, K = G.hanok, door = P.doorOf('B_HANOK1');          // {x, z, rotY, exit: {x, z, rotY}}
//   P.define({ id: 'PL_ANBANG', name: '안방', kidName: '안방', emoji: '🛏️', zoneId: 'ZONE_PL_ANBANG',
//     origin: { x: -400, z: 2000 }, size: { w: 8, d: 6, h: 3.4 }, spawn: { x: 2.6, z: 0, rotY: -Math.PI / 2 },
//     door: { buildingId: 'B_HANOK1', x: door.x, z: door.z, label: '🚪 안방 들어가기', kidLabel: '안방 구경' }, exit: door.exit,
//     camera: { ceil: 2.4 },
//     build(ctx) {
//       const R = K.room(ctx, { w: 8, d: 6, post: 2.5, ridge: 3.4, bays: { x: 3, z: 2 }, floor: 'jangpan', roof: 'ceiling',
//         walls: { N: ['plaster', { window: 'ttisal' }, 'plaster'], E: [{ door: 'changho', exit: true }, 'plaster'],
//                  S: ['clay', { window: 'aja', w: 1.2 }, 'clay'], W: ['plaster', 'plaster'] } });
//       const ch = K.chest(R, { x: -2.9, z: -2.4, w: 1.2, d: 0.48, h: 0.85, fittings: 'brass' });   // 반닫이 by the N wall
//       R.block(-2.9, -2.4, ch.w / 2, ch.d / 2);                                     // children walk around it
//       ctx.anchor('bandaji', { x: -2.9, y: ch.top + 0.2, z: -2.4 });                // an exhibit (48-interior-data.js)
//       K.screen(R, { x: -2.6, z: 1.9, rotY: Math.PI, art: 'birds_flowers_screen', panels: 8 });   // 병풍 with a pack artwork
//       K.cushion(R, { x: 0, z: 0.4, tint: '#9c3b2e', trim: '#d9b24c' });
//       const b = R.bay('W', 0), p = R.wp('W', b.uc, 1.5, 0.06);
//       ctx.board('MG_GUDEUL', { x: p.x, y: p.y, z: p.z, rotY: Math.PI / 2, w: 1.4, h: 0.8, title: '구들이 데워지는 길' });
//       K.jwadeung(R, { x: 3.2, z: -2.3 }); K.lamp(R, { x: 3.2, y: 0.82, z: -2.3, s: 0.6 });   // glow + a pooled lamp
//       K.dust(R, { count: 40 });                                                    // a living detail
//       R.finish({ exit: { x: 3.6, z: -0.75 } });                                    // merge, colliders, light, plan
//       return { dispose() {} };
//     } });
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
      // lamps that will really burn at night: what the room asked for, as far as the engine can lend them
      const lit = this.low ? 0 : Math.min(this.ctx.lightCount | 0, E?.lightPoolSize | 0);
      return {
        center: { x: 0, y: top / 2, z: 0 }, radius: rx + 0.3, radiusY: ry + 0.3, dir: sd.clone(), dist: 60,
        // without shadows the sun would light every surface the same: it stays a soft key and the decal draws the window light
        sun: { color: '#fff0da', intensity: shadowed ? 3.9 : 0.7 }, moon: { color: '#8ea4d8', intensity: shadowed ? 0.55 : 0.14 },
        hemi: { sky: dark ? '#e6d8c2' : '#f4eee3', ground: dark ? '#8c7a66' : '#c2a888', intensity: shadowed ? (dark ? 0.32 : 0.42) : 0.86 },
        // night: the lamps carry the room where the preset has them; without them (`low`) the glow of the paper lamps is
        // an even warm light, bright enough that no dark timber sinks to a black block (the screen watchdog, §14.4)
        hemiNight: lit ? { sky: '#5d6890', ground: '#523f2c', intensity: 0.42 } : { sky: '#b39a78', ground: '#7a5c3e', intensity: 1.0 },
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
        // the painted far view dims with the night; a picture of the real valley already has the light of its hour
        if (this._backdrop) this._backdrop.material.color.setScalar(this._farNf == null ? lerp(1.0, 0.16, nf) : clamp(lerp(1.0, 0.16, nf) / lerp(1.0, 0.16, this._farNf), 0.14, 3));
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
        // what a picture for this arc must cover, seen from its axis at eye height 1.5 m: the angle across, and how far
        // below / above the horizon it reaches (tangents)
        this.farArc = { arc, down: (1.5 - (3.2 - 4.5)) / R, up: ((3.2 + 4.5) - 1.5) / R };
      }
    }
    /** show a picture on the far-view arc instead of the painted one (18-places gives the real valley as it looks from
     *  the house's door, taken at night factor nf). canvas: `farArc.arc` wide, the left of the view at its RIGHT edge
     *  (the arc is seen from inside), the horizon at down / (down + up) from the bottom; o.display: true = bytes as they
     *  were on the screen (tone-mapped), false = scene light in sRGB. false = no arc in this room. */
    setFarView(canvas, nf = 0, o = {}) {
      const b = this._backdrop;
      if (!b || !canvas || !(canvas.width > 0)) return false;
      // o.display: the picture is already tone-mapped (taken from the screen): it is shown as it is
      if (b.material.toneMapped !== !o.display) { b.material.toneMapped = !o.display; b.material.needsUpdate = true; }
      if (!this._farTex) {
        this._farTex = new THREE.CanvasTexture(canvas);
        this._farTex.colorSpace = THREE.SRGBColorSpace;
        this._farTex.generateMipmaps = false; this._farTex.minFilter = THREE.LinearFilter;
        this.ctx.own(this._farTex);
      } else this._farTex.image = canvas;
      this._farTex.needsUpdate = true;
      if (b.material.map !== this._farTex) { b.material.map = this._farTex; b.material.needsUpdate = true; }
      this._farNf = clamp(Number(nf) || 0, 0, 1);
      return true;
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

  // ---------------------------------------------------------------- [rooms-b] furniture and things of the 안방 and the 사랑방
  // Same rules as section 3 of the header: (T, opts) with opts.x / y / z / rotY (or opts.m), the front faces +Z, materials
  // through the room buckets (one merge per material), no colliders (the room adds R.block), a footprint for the plan.
  //   jangnong(T, {w = 1.15, d = 0.5, h = 1.62, tiers = 2, fittings = 'brass', tone})   이층장: tiers of a panelled chest on a plinth
  //   bandaji(T, {w = 0.95, d = 0.46, h = 0.78, fittings, tone})       반닫이: the upper half of the front is the lid
  //   ibuljang(T, {w = 1.3, d = 0.56, h = 0.82, colors})               이불장 with folded bedding (요 · 이불) and two pillows on top
  //   gyeongdae(T, {w = 0.4, d = 0.3, h = 0.17})                        경대: a drawer box with a mirror leaning back on it
  //   seoan(T, {w = 1.0, d = 0.36, h = 0.34})                            서안: the top's ends curl up like a scroll, a drawer
  //   mungap(T, {w = 1.4, d = 0.34, h = 0.5, layout = 'dDDd'})          문갑: d = two drawers, D = a door, column by column
  //   sabangtakja(T, {w = 0.44, d = 0.44, h = 1.45, levels = 4}) -> [{x, y, z}]   사방탁자: open levels over a drawer
  //   chaekjang(T, {w = 1.0, d = 0.38, h = 1.7, levels = 4, seed})      책장 full of thread-bound books lying flat + book cases
  //   books(T, {w = 0.2, d = 0.28, n = 6, seed})                        a stack of thread-bound books (선장본)
  //   hwaro(T, {s = 1, light = true}) -> {top, glow}                     놋화로: ash, charcoal, embers that glow, fire tongs
  //   dadeumitdol(T, {w = 0.62, d = 0.27, h = 0.19}) -> {top}           다듬잇돌 (청석) on wooden rests, a folded cloth, two 방망이
  //   geomungo(T, {len = 1.6, w = 0.2, stand = 0.22})                   거문고 on two trestles: arched body, 6 strings, 16 괘, 3 안족
  //   baduk(T, {w = 0.45, d = 0.42})                                    바둑판 on four legs: 19 × 19 lines, a game, two 바둑통
  //   gobi(T, {m: R.wm(side, u, v, 0), w = 0.34, h = 0.95, wall})       고비: a letter rack hung on the wall, letters tucked in
  //   boryo(T, {w = 1.9, d = 0.9, tint, trim, accent})                  보료 + 장침 + 안석 + two 사방침
  //   banjitgori(T, {w = 0.34, d = 0.26})                               반짇고리: an open sewing box, 실패, 골무, rolls of cloth
  //   munbang(T, {x, y = the desk top, z, rotY})                        문방사우 on a desk: 벼루 · 먹 · 필통 with brushes · 연적 · paper
  //   teaSet(T, {tint}) -> {top, spout}                                 a small round tray with a 다관 and three cups
  //   foldScreen(T, {art, panels = 10, artH = 1.3, fold = 0.3}) -> {w, h, center}   병풍 whose artwork is ONE mesh (one draw
  //                    call) across its framed panels; the panel width follows the artwork's aspect
  (function roomsB() {
    const ZR = (a) => new THREE.Matrix4().makeRotationZ(a);
    const XR = (a) => new THREE.Matrix4().makeRotationX(a);
    const upright = (len, a, b, bev) => KG.timber(len, a, b, bev).applyMatrix4(ZR(PI / 2));    // a timber standing up
    const sub = (T) => ({ add: (...a) => T.add(...a), ctx: T.ctx, rnd: T.rnd, low: T.low });  // a kit generator without its own plan footprint
    const footp = (T, o, w, d, color) => { const q = Math.abs(Math.sin(num(o.rotY, 0))) > 0.7; T.planItem?.(num(o.x, 0), num(o.z, 0), q ? d : w, q ? w : d, color); };
    const noCast = (o) => ({ ...o, cast: false });
    const P3 = (m, x, y, z) => { const v = new THREE.Vector3(x, y, z).applyMatrix4(m); return { x: v.x, y: v.y, z: v.z }; };
    /** 들쇠: a drop handle hanging on each side of a box */
    function sideHandles(T, m, w, y, fit, F) {
      for (const sx of [-1, 1]) {
        const g = new THREE.TorusGeometry(0.042, 0.005, 5, 12, PI).applyMatrix4(ZR(PI)).applyMatrix4(new THREE.Matrix4().makeRotationY(PI / 2));
        T.add(fit, g, mul(m, M(sx * (w / 2 + 0.01), y, 0)), null, F);
        for (const sz of [-1, 1]) T.add(fit, KG.slab(0.006, 0.03, 0.02, 0.002), mul(m, M(sx * (w / 2 + 0.003), y + 0.004, sz * 0.042)), null, F);
      }
    }

    function jangnong(T, o = {}) {
      const w = num(o.w, 1.15), d = num(o.d, 0.5), h = num(o.h, 1.62), tiers = Math.max(1, Math.round(num(o.tiers, 2))), m = base(T, o);
      const tone = o.tone || '#9a6a40', frame = o.frameTone || '#58331f', fit = o.fittings === false ? null : (o.fittings || 'brass'), F = noCast(o);
      const plinth = 0.13, th = (h - plinth) / tiers;
      // 족대: a plinth with a cut-out apron on four square feet
      T.add('furn', KG.slab(w + 0.02, 0.035, d + 0.02, 0.006), mul(m, M(0, plinth - 0.0175, 0)), frame, o);
      T.add('furn', KG.timber(w - 0.1, 0.05, 0.02, 0.004), mul(m, M(0, plinth - 0.06, d / 2 - 0.005)), frame, F);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) T.add('furn', KG.slab(0.06, plinth - 0.035, 0.06, 0.005), mul(m, M(sx * (w / 2 - 0.035), (plinth - 0.035) / 2, sz * (d / 2 - 0.035))), frame, o);
      for (let i = 0; i < tiers; i++) {
        const tm = mul(m, M(0, plinth + th * i, 0)), td = d - 0.012 * i;
        chest(sub(T), { m: tm, w, d: td, h: th - 0.008, legs: 0, doors: 2, drawers: i === tiers - 1 ? 2 : 0, fittings: fit || false, tone, frameTone: frame, panelTone: o.panelTone || '#a87448', wall: o.wall, cast: o.cast });
        if (!fit) continue;
        // 나비경첩: a butterfly of brass at the outer edge of each door, a round 앞바탕 between the doors
        const ph = th - 0.1 - (i === tiers - 1 ? 0.12 : 0);
        for (const sx of [-1, 1]) for (const fy of [0.25, 0.75]) for (const k of [-1, 1]) T.add(fit, KG.slab(0.05, 0.03, 0.004, 0.0015).applyMatrix4(ZR(k * 0.55)), mul(tm, M(sx * (w / 2 - 0.085) + k * 0.016 * sx, 0.05 + ph * fy, td / 2 + 0.016)), null, F);
        sideHandles(T, tm, w, th - 0.14, fit, F);
      }
      footp(T, o, w, d);
      return { w, d, top: num(o.y, 0) + h + 0.03 };
    }

    function bandaji(T, o = {}) {
      const w = num(o.w, 0.95), d = num(o.d, 0.46), h = num(o.h, 0.78), feet = 0.06, m = base(T, o), F = noCast(o);
      const tone = o.tone || '#7e4a2c', frame = o.frameTone || '#4b2a18', pnl = o.panelTone || '#93583a', fit = o.fittings === false ? null : (o.fittings || 'brass');
      const bh = h - feet, fz = d / 2, st = 0.045, midY = feet + bh * 0.5;
      T.add('furn', KG.slab(w, bh, d, 0.008), mul(m, M(0, feet + bh / 2, 0)), tone, o);
      T.add('furn', KG.slab(w + 0.04, 0.03, d + 0.03, 0.008), mul(m, M(0, h + 0.015, 0)), frame, o);            // 천판
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) T.add('furn', KG.slab(0.075, feet, 0.075, 0.006), mul(m, M(sx * (w / 2 - 0.05), feet / 2, sz * (d / 2 - 0.05))), frame, o);
      // the front: stiles and three rails; the lid is the upper half, two sunk panels below
      for (const sx of [-1, 1]) T.add('furn', upright(bh, st, 0.012, 0.003), mul(m, M(sx * (w / 2 - st / 2), feet + bh / 2, fz + 0.006)), frame, F);
      for (const y of [feet + st / 2, midY, h - st / 2]) T.add('furn', KG.timber(w - st * 2, st, 0.012, 0.003), mul(m, M(0, y, fz + 0.006)), frame, F);
      const iw = w - st * 2, lh = h - st - midY - st / 2, lo = midY - st / 2 - (feet + st);
      T.add('furn', KG.slab(iw - 0.03, lh - 0.03, 0.01, 0.003), mul(m, M(0, midY + st / 2 + lh / 2, fz + 0.01)), pnl, F);
      for (const sx of [-1, 1]) T.add('furn', KG.slab(iw / 2 - 0.05, lo - 0.05, 0.008, 0.003), mul(m, M(sx * iw / 4, feet + st + lo / 2, fz + 0.008)), pnl, F);
      T.add('furn', upright(lo, 0.03, 0.012, 0.003), mul(m, M(0, feet + st + lo / 2, fz + 0.008)), frame, F);
      if (fit) {
        for (const sx of [-0.27, 0.27]) {        // 경첩: the lid's hinges cross the middle rail
          T.add(fit, KG.slab(0.05, 0.13, 0.005, 0.002), mul(m, M(sx * w, midY + 0.025, fz + 0.016)), null, F);
          T.add(fit, geo.cyl(0.008, 0.008, 0.056, 6).applyMatrix4(ZR(PI / 2)), mul(m, M(sx * w, midY - 0.02, fz + 0.02)), null, F);
        }
        // 앞바탕: the big round plate of the lock, its hasp and the lock bar
        T.add(fit, geo.cyl(0.1, 0.1, 0.005, 24).applyMatrix4(XR(PI / 2)), mul(m, M(0, midY + st / 2 + lh * 0.45, fz + 0.017)), null, F);
        T.add(fit, geo.cyl(0.07, 0.07, 0.006, 6).applyMatrix4(XR(PI / 2)), mul(m, M(0, midY + st / 2 + lh * 0.45, fz + 0.02)), '#d8b45a', F);
        T.add(fit, KG.slab(0.03, 0.1, 0.01, 0.003), mul(m, M(0, midY + 0.03, fz + 0.022)), null, F);
        T.add(fit, KG.slab(0.12, 0.026, 0.024, 0.005), mul(m, M(0, midY - 0.012, fz + 0.034)), '#a8842e', F);
        // 감잡이 on the corners, a row of 광두정 (round nail heads) along the top rail
        for (const sx of [-1, 1]) for (const y of [feet + 0.045, h - 0.045]) T.add(fit, KG.slab(0.1, 0.065, 0.005, 0.002), mul(m, M(sx * (w / 2 - 0.05), y, fz + 0.014)), null, F);
        for (let i = 0; i < 7; i++) T.add(fit, geo.cyl(0.009, 0.009, 0.006, 6).applyMatrix4(XR(PI / 2)), mul(m, M(-iw / 2 + (iw * (i + 0.5)) / 7, h - st / 2, fz + 0.015)), null, F);
        sideHandles(T, m, w, h - 0.17, fit, F);
      }
      footp(T, o, w, d);
      return { w, d, top: num(o.y, 0) + h + 0.03 };
    }

    function ibuljang(T, o = {}) {
      const w = num(o.w, 1.3), d = num(o.d, 0.56), h = num(o.h, 0.82), m = base(T, o);
      chest(sub(T), { m, w, d, h, legs: 0.1, doors: 2, drawers: 0, fittings: o.fittings || 'brass', tone: o.tone || '#a06c42', frameTone: o.frameTone || '#5d3a22', panelTone: o.panelTone || '#b07c4c', wall: o.wall, cast: o.cast });
      let y = h + 0.03;
      // folded 요 and 이불: soft, rounded layers of silk in quiet colours, each with its white cotton 홑청 showing at the fold
      const cols = o.colors || ['#ece6d6', '#2f4767', '#86302c', '#5d7a58', '#b48a40'];
      for (let i = 0; i < cols.length; i++) {
        const lh = 0.1 + ((i * 7) % 3) * 0.016, lw = w * (0.93 - ((i * 5) % 3) * 0.015), ld = d * 0.9, dx = (((i * 3) % 5) - 2) * 0.01;
        const g = geo.grid(10, 4, (gi, gj, out) => {   // a pillowy slab: the front edge bulges and rounds over
          const u = gi / 10 - 0.5, v = gj / 4;
          const bulge = Math.sin(v * PI) * lh * 0.42, sag = (1 - Math.cos(u * PI * 2)) * 0.004;
          out[0] = u * lw; out[1] = v * lh - sag; out[2] = ld / 2 + bulge * 0.5; out[3] = u * lw; out[4] = v * lh;
        });
        T.add('cloth', KG.slab(lw, lh * 0.9, ld - lh * 0.4, Math.min(0.045, lh * 0.45)), mul(m, M(dx, y + lh * 0.45, -lh * 0.1)), cols[i], o);
        T.add('cloth', g, mul(m, M(dx, y, -lh * 0.35)), cols[i], noCast(o));
        T.add('cloth', KG.slab(lw * 0.97, lh * 0.18, 0.012, 0.004), mul(m, M(dx, y + lh * 0.5, ld / 2 - lh * 0.12)), '#f4f0e6', noCast(o));
        y += lh * 0.92;
      }
      // 베개: two pillows with embroidered round ends (베갯모)
      for (const sx of [-1, 1]) {
        const r = 0.085, len = 0.5, px = sx * w * 0.2;
        T.add('cloth', KG.lathe([[0, 0], [r * 0.9, 0], [r, 0.03], [r, len - 0.03], [r * 0.9, len], [0, len]], 16).applyMatrix4(ZR(-PI / 2)), mul(m, M(px - len / 2, y + r * 0.92, 0.03, 0, 1, 0.9, 1)), sx < 0 ? '#ece5d4' : '#d9c39c', o);
        for (const e of [-1, 1]) {
          T.add('cloth', geo.cyl(r * 0.93, r * 0.93, 0.012, 16).applyMatrix4(ZR(PI / 2)), mul(m, M(px + e * (len / 2 + 0.004), y + r * 0.92, 0.03, 0, 1, 0.9, 1)), '#9e2a28', noCast(o));
          T.add('paint', geo.ring(r * 0.2, r * 0.62, 16).applyMatrix4(ZR(-e * PI / 2)), mul(m, M(px + e * (len / 2 + 0.011), y + r * 0.92, 0.03, 0, 1, 0.9, 1)), e < 0 ? '#d9a62c' : '#3d7a5a', noCast(o));
        }
      }
      y += 0.1;
      footp(T, o, w, d);
      return { w, d, top: num(o.y, 0) + y + 0.15, chestTop: num(o.y, 0) + h + 0.03 };
    }

    function gyeongdae(T, o = {}) {
      const w = num(o.w, 0.4), d = num(o.d, 0.3), bh = num(o.h, 0.17), m = base(T, o), tone = o.tone || '#6e2e1c', fit = o.fittings || 'brass', F = noCast(o);
      T.add('lacquer', KG.slab(w, bh, d, 0.006), mul(m, M(0, bh / 2, 0)), tone, o);
      T.add('lacquer', KG.slab(w + 0.02, 0.016, d + 0.02, 0.004), mul(m, M(0, bh + 0.008, 0)), '#4a1e12', o);
      for (const sx of [-1, 1]) {
        T.add('lacquer', KG.slab(w / 2 - 0.03, bh - 0.05, 0.008, 0.002), mul(m, M(sx * w / 4, bh / 2, d / 2 + 0.003)), '#83402a', F);
        T.add(fit, geo.cyl(0.012, 0.012, 0.008, 10).applyMatrix4(XR(PI / 2)), mul(m, M(sx * w / 4, bh / 2, d / 2 + 0.01)), null, F);
      }
      for (const sx of [-1, 1]) for (const y of [0.02, bh - 0.02]) T.add(fit, KG.slab(0.04, 0.024, 0.004, 0.0015), mul(m, M(sx * (w / 2 - 0.02), y, d / 2 + 0.003)), null, F);
      // the mirror: a lacquered frame leaning back on its stays, the polished glass, brass corners
      const fw = w - 0.03, fh = fw * 1.05, tilt = -0.3, mm = mul(m, mul(M(0, bh + 0.016, -d / 2 + 0.06, 0, 1, 1, 1, tilt), M(0, fh / 2, 0)));
      for (const sy of [-1, 1]) T.add('lacquer', KG.timber(fw, 0.028, 0.022, 0.004), mul(mm, M(0, sy * (fh / 2 - 0.014), 0)), '#5a2416', o);
      for (const sx of [-1, 1]) T.add('lacquer', upright(fh - 0.05, 0.028, 0.022, 0.004), mul(mm, M(sx * (fw / 2 - 0.014), 0, 0)), '#5a2416', o);
      T.add('lacquer', KG.quad(fw - 0.04, fh - 0.04).applyMatrix4(new THREE.Matrix4().makeRotationY(PI)), mul(mm, M(0, 0, -0.008)), '#4a1e12', F);
      T.add('iron', KG.quad(fw - 0.05, fh - 0.05), mul(mm, M(0, 0, 0.004)), o.glass || '#e4e8ea', F);
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) T.add(fit, KG.slab(0.03, 0.03, 0.004, 0.001), mul(mm, M(sx * (fw / 2 - 0.016), sy * (fh / 2 - 0.016), 0.012)), null, F);
      for (const sx of [-1, 1]) T.add('lacquer', KG.span(sx * (fw / 2 - 0.02), bh + 0.02, 0.02, sx * (fw / 2 - 0.02), bh + 0.16, -d / 2 + 0.03, 0.014, 0.012, 0.003), m, '#5a2416', F);
      footp(T, o, w, d);
      const c = P3(mm, 0, 0, 0.05);
      return { w, d, top: num(o.y, 0) + bh + fh * Math.cos(tilt) + 0.02, mirror: c };
    }

    function seoan(T, o = {}) {
      const w = num(o.w, 1.0), d = num(o.d, 0.36), h = num(o.h, 0.34), m = base(T, o), F = noCast(o);
      const tone = o.tone || '#7b4a2a', dark = o.frameTone || '#4a2a18', fit = o.fittings || 'brass', tt = 0.026;
      T.add('furn', KG.slab(w, tt, d, 0.006), mul(m, M(0, h - tt / 2, 0)), tone, o);
      // 두루마리: the two ends of the top roll up like a scroll
      for (const sx of [-1, 1]) {
        T.add('furn', geo.cyl(0.024, 0.024, d - 0.004, 12).applyMatrix4(XR(PI / 2)), mul(m, M(sx * (w / 2 - 0.006), h + 0.006, 0)), tone, o);
        T.add('furn', KG.slab(0.03, 0.03, d - 0.006, 0.006), mul(m, M(sx * (w / 2 - 0.03), h - 0.005, 0)), tone, F);
      }
      // the drawer under the top, its brass pull
      T.add('furn', KG.slab(w - 0.2, 0.065, d - 0.06, 0.004), mul(m, M(0, h - tt - 0.0325, -0.01)), tone, o);
      T.add('furn', KG.slab(w * 0.42, 0.045, 0.008, 0.002), mul(m, M(0, h - tt - 0.0325, d / 2 - 0.035)), o.panelTone || '#93603a', F);
      T.add(fit, new THREE.TorusGeometry(0.015, 0.0035, 5, 10), mul(m, M(0, h - tt - 0.038, d / 2 - 0.028)), null, F);
      T.add(fit, geo.cyl(0.02, 0.02, 0.003, 10).applyMatrix4(XR(PI / 2)), mul(m, M(0, h - tt - 0.028, d / 2 - 0.03)), null, F);
      // 판각: two side boards with a cloud cut-out (운각), on foot rails
      for (const sx of [-1, 1]) {
        const x = sx * (w / 2 - 0.07);
        T.add('furn', KG.slab(0.024, h - tt - 0.03, d - 0.05, 0.004), mul(m, M(x, (h - tt + 0.03) / 2, 0)), tone, o);
        T.add('furn', KG.quad(d * 0.5, (h - tt) * 0.4).applyMatrix4(new THREE.Matrix4().makeRotationY(sx * PI / 2)), mul(m, M(x + sx * 0.0125, (h - tt) * 0.42, 0)), '#2a170c', F);
        T.add('furn', KG.slab(0.05, 0.03, d - 0.01, 0.006), mul(m, M(x, 0.015, 0)), dark, o);
      }
      T.add('furn', KG.timber(w - 0.16, 0.025, 0.02, 0.003), mul(m, M(0, 0.07, -d / 2 + 0.04)), dark, o);
      footp(T, o, w, d);
      return { w, d, top: num(o.y, 0) + h };
    }

    function mungap(T, o = {}) {
      const w = num(o.w, 1.4), d = num(o.d, 0.34), h = num(o.h, 0.5), legs = num(o.legs, 0.07), m = base(T, o), F = noCast(o);
      const tone = o.tone || '#8c5a36', dark = o.frameTone || '#4f2f1c', pnl = o.panelTone || '#a87244', fit = o.fittings === false ? null : (o.fittings || 'brass');
      const st = 0.035, bh = h - legs, fz = d / 2 + 0.002;
      T.add('furn', KG.slab(w - 0.01, bh - 0.01, d - 0.01, 0.005), mul(m, M(0, legs + bh / 2, 0)), tone, o);
      T.add('furn', KG.slab(w + 0.02, 0.022, d + 0.02, 0.005), mul(m, M(0, h + 0.011, 0)), dark, o);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) T.add('furn', upright(h, st, st, 0.004), mul(m, M(sx * (w - st) / 2, h / 2, sz * (d - st) / 2)), dark, o);
      for (const y of [legs + st / 2, h - st / 2]) T.add('furn', KG.timber(w - st * 2, st, 0.014, 0.003), mul(m, M(0, y, fz)), dark, F);
      T.add('furn', KG.timber(w - st * 2, legs * 0.55, 0.014, 0.003), mul(m, M(0, legs * 0.6, d / 2 - 0.01)), dark, F);   // apron between the feet
      const lay = String(o.layout || 'dDDd'), n = lay.length, iw = w - st * 2, cw = iw / n, y0 = legs + st, ih = h - st * 2 - legs;
      for (let i = 0; i < n; i++) {
        const cx = -iw / 2 + cw * (i + 0.5);
        if (i) T.add('furn', upright(ih, 0.022, 0.014, 0.003), mul(m, M(-iw / 2 + cw * i, y0 + ih / 2, fz)), dark, F);
        if (lay[i] === 'd') {
          for (let j = 0; j < 2; j++) {
            const yc = y0 + (ih * (j + 0.5)) / 2;
            T.add('furn', KG.slab(cw - 0.03, ih / 2 - 0.03, 0.012, 0.003), mul(m, M(cx, yc, fz + 0.002)), pnl, F);
            if (fit) { T.add(fit, geo.cyl(0.018, 0.018, 0.003, 10).applyMatrix4(XR(PI / 2)), mul(m, M(cx, yc + 0.004, fz + 0.01)), null, F); T.add(fit, new THREE.TorusGeometry(0.013, 0.0033, 5, 10), mul(m, M(cx, yc - 0.01, fz + 0.013)), null, F); }
          }
          T.add('furn', KG.timber(cw - 0.02, 0.016, 0.012, 0.003), mul(m, M(cx, y0 + ih / 2, fz + 0.001)), dark, F);
        } else {
          T.add('furn', KG.slab(cw - 0.03, ih - 0.03, 0.012, 0.003), mul(m, M(cx, y0 + ih / 2, fz + 0.002)), pnl, F);
          T.add('furn', KG.slab(cw - 0.1, ih - 0.1, 0.006, 0.002), mul(m, M(cx, y0 + ih / 2, fz + 0.01)), tone, F);
          if (fit) {
            const hx = cx + (i < n / 2 ? -1 : 1) * (cw / 2 - 0.028), px = cx + (i < n / 2 ? 1 : -1) * (cw / 2 - 0.05);
            for (const fy of [0.22, 0.78]) T.add(fit, KG.slab(0.026, 0.05, 0.004, 0.0015), mul(m, M(hx, y0 + ih * fy, fz + 0.012)), null, F);
            T.add(fit, geo.cyl(0.028, 0.028, 0.003, 14).applyMatrix4(XR(PI / 2)), mul(m, M(px, y0 + ih / 2 + 0.008, fz + 0.012)), null, F);
            T.add(fit, new THREE.TorusGeometry(0.015, 0.0035, 5, 10), mul(m, M(px, y0 + ih / 2 - 0.012, fz + 0.016)), null, F);
          }
        }
      }
      footp(T, o, w, d);
      return { w, d, top: num(o.y, 0) + h + 0.022 };
    }

    function sabangtakja(T, o = {}) {
      const w = num(o.w, 0.44), d = num(o.d, 0.44), h = num(o.h, 1.45), levels = Math.max(2, Math.round(num(o.levels, 4))), m = base(T, o), tone = o.tone || '#7a4a2c';
      const spots = shelf(sub(T), { m, w, d, h, levels, tone, wall: o.wall, cast: o.cast, topSpot: true });
      // the lowest level is a drawer box; a thin cap rail on the top board
      const y1 = 0.1 + (h - 0.12) / levels, yc = 0.1 + (y1 - 0.1) / 2;
      T.add('furn', KG.slab(w - 0.05, y1 - 0.13, d - 0.05, 0.004), mul(m, M(0, yc, 0)), tone, o);
      T.add('furn', KG.slab(w - 0.09, y1 - 0.17, 0.008, 0.003), mul(m, M(0, yc, d / 2 - 0.022)), o.panelTone || '#9a6440', noCast(o));
      T.add(o.fittings || 'brass', new THREE.TorusGeometry(0.014, 0.0035, 5, 10), mul(m, M(0, yc - 0.006, d / 2 - 0.012)), null, noCast(o));
      for (const sz of [-1, 1]) T.add('furn', KG.timber(w, 0.02, 0.016, 0.003), mul(m, M(0, h - 0.01, sz * (d / 2 - 0.008))), '#5a3420', o);
      footp(T, o, w, d);
      return spots.slice(1);   // the drawer level is not a shelf
    }

    function books(T, o = {}) {
      const w = num(o.w, 0.2), d = num(o.d, 0.28), n = Math.max(1, Math.round(num(o.n, 6))), m = base(T, o), r = G.util.rng('hk:bk:' + (o.seed || 0)), F = noCast(o);
      let y = 0;
      for (let i = 0; i < n; i++) {
        const t = 0.011 + r() * 0.01, sh = 0.86 + r() * 0.2, rot = (r() - 0.5) * 0.08, dx = (r() - 0.5) * 0.012;
        const cover = new THREE.Color(0.86 * sh, 0.7 * sh, 0.38 * sh);   // 치자 yellow covers, faded unevenly
        const bm = mul(m, M(dx, y + t / 2, (r() - 0.5) * 0.01, rot));
        T.add('paint', geo.box(w, t, d), bm, cover, i === n - 1 ? o : F);
        T.add('paint', geo.box(w - 0.012, t - 0.004, d + 0.002), bm, '#efe7d2', F);            // the page block shows between the covers
        if (i === n - 1 || r() < 0.3) T.add('paint', geo.box(0.022, 0.0012, d * 0.5), mul(bm, M(-w / 2 + 0.03, t / 2 + 0.0006, 0)), '#f4efe2', F);   // 제첨: the paper title slip
        y += t;
      }
      return { top: num(o.y, 0) + y };
    }

    function chaekjang(T, o = {}) {
      const w = num(o.w, 1.0), d = num(o.d, 0.38), h = num(o.h, 1.7), levels = Math.max(2, Math.round(num(o.levels, 4))), m = base(T, o);
      const tone = o.tone || '#6e4128', dark = o.frameTone || '#45281a', r = G.util.rng('hk:shelves:' + (o.seed || 0)), legs = 0.08, st = 0.035;
      for (const sx of [-1, 1]) T.add('furn', KG.slab(0.022, h - legs, d - 0.01, 0.004), mul(m, M(sx * (w / 2 - 0.016), legs + (h - legs) / 2, 0)), tone, o);
      T.add('furn', KG.quad(w - 0.04, h - legs - 0.02), mul(m, M(0, legs + (h - legs) / 2, -d / 2 + 0.012)), '#4a2c1a', noCast(o));
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) T.add('furn', upright(h, st, st, 0.004), mul(m, M(sx * (w - st) / 2, h / 2, sz * (d - st) / 2)), dark, o);
      T.add('furn', KG.slab(w + 0.03, 0.025, d + 0.03, 0.005), mul(m, M(0, h + 0.0125, 0)), dark, o);
      T.add('furn', KG.timber(w - st * 2, legs * 0.6, 0.014, 0.003), mul(m, M(0, legs * 0.55, d / 2 - 0.008)), dark, noCast(o));
      const iw = w - 0.07, gap = (h - legs - 0.04) / levels;
      for (let l = 0; l <= levels; l++) {
        const y = legs + 0.02 + gap * l;
        T.add('furn', KG.slab(w - 0.04, 0.02, d - 0.02, 0.004), mul(m, M(0, y, 0)), tone, o);
        if (l === levels) break;
        T.add('furn', KG.timber(w - st * 2, 0.026, 0.014, 0.003), mul(m, M(0, y - 0.004, d / 2 - 0.008)), dark, noCast(o));
        const room = gap - 0.05;
        let x = -iw / 2;
        while (x < iw / 2 - 0.13) {
          const bw = 0.16 + r() * 0.06, bd = Math.min(d - 0.07, 0.24 + r() * 0.05);
          if (x + bw > iw / 2) break;
          const z = d / 2 - bd / 2 - 0.035;
          if (r() < 0.2) {   // 책갑: a cloth-covered book case with its bone clasps
            const hh = Math.min(room - 0.02, 0.1 + r() * 0.1), c = r() < 0.5 ? '#2c3b5e' : '#5b3a2a';
            T.add('paint', KG.slab(bw, hh, bd, 0.004), mul(m, M(x + bw / 2, y + 0.01 + hh / 2, z)), c, o);
            for (const fy of [0.3, 0.7]) T.add('paint', geo.box(0.012, 0.022, 0.006), mul(m, M(x + bw - 0.004, y + 0.01 + hh * fy, z + bd / 2 - 0.02)), '#e6dcc4', noCast(o));
            T.add('paint', geo.box(0.035, hh * 0.6, 0.002), mul(m, M(x + bw * 0.3, y + 0.01 + hh / 2, z + bd / 2 + 0.001)), '#ece3cc', noCast(o));
          } else if (r() < 0.12) {   // a gap: one leaning book
            T.add('paint', geo.box(0.018, Math.min(room - 0.02, 0.24), bd * 0.9), mul(m, M(x + 0.06, y + 0.01 + Math.min(room - 0.02, 0.24) / 2, z, 0, 1, 1, 1, 0, -0.22)), '#c4a058', o);
          } else books(T, { m: mul(m, M(x + bw / 2, y + 0.01, z, (r() - 0.5) * 0.05)), w: bw, d: bd, n: Math.max(2, Math.floor((room * (0.3 + r() * 0.65)) / 0.016)), seed: r() * 1e6 | 0, wall: o.wall });
          x += bw + 0.012 + r() * 0.025;
        }
      }
      footp(T, o, w, d);
      return { w, d, top: num(o.y, 0) + h + 0.025 };
    }

    function hwaro(T, o = {}) {
      const s = num(o.s, 1), m = mul(base(T, o), M(0, 0, 0, 0, s)), F = noCast(o), r = T.rnd || G.util.rng('hk:hwaro');
      const key = o.mat || 'brass', tn = o.tint || '#a8844a';
      // 놋화로: a wide brass bowl with a flat rim (전) on three feet, two ring handles
      T.add(key, KG.lathe([[0, 0.06], [0.1, 0.06], [0.13, 0.05], [0.13, 0.09], [0.21, 0.2], [0.25, 0.232], [0.275, 0.242], [0.272, 0.256], [0.23, 0.254], [0.2, 0.232], [0.11, 0.13], [0, 0.12]], 24), m, tn, o);
      for (let i = 0; i < 3; i++) { const a = (i / 3) * TAU + 0.5; T.add(key, KG.lathe([[0, 0], [0.026, 0], [0.032, 0.03], [0.02, 0.066], [0, 0.066]], 8), mul(m, M(Math.cos(a) * 0.105, 0, Math.sin(a) * 0.105)), '#8f6c34', o); }
      for (const sx of [-1, 1]) T.add(key, new THREE.TorusGeometry(0.028, 0.005, 5, 12).applyMatrix4(new THREE.Matrix4().makeRotationY(PI / 2)), mul(m, M(sx * 0.215, 0.19, 0)), '#8f6c34', F);
      // ash, charcoal, embers
      T.add('paint', geo.disc(0.205, 20), mul(m, M(0, 0.216, 0)), '#a39c92', F);
      for (let i = 0; i < 10; i++) { const a = r() * TAU, rr = Math.sqrt(r()) * 0.12; T.add('paint', new THREE.IcosahedronGeometry(0.02 + r() * 0.012, 0), mul(m, M(Math.cos(a) * rr, 0.222, Math.sin(a) * rr, r() * 3, 1, 0.65, 1)), '#2b2522', F); }
      for (let i = 0; i < 6; i++) { const a = r() * TAU, rr = Math.sqrt(r()) * 0.08; T.add('glow', new THREE.IcosahedronGeometry(0.016 + r() * 0.01, 0), mul(m, M(Math.cos(a) * rr, 0.226, Math.sin(a) * rr, r() * 3, 1, 0.6, 1)), i % 2 ? '#ff6a24' : '#ff9a3c', F); }
      // 부젓가락 (fire tongs) and an 인두 resting in the ash
      T.add('iron', geo.tube(0.05, 0.215, 0.06, 0.22, 0.43, 0.13, 0.0042, 5), m, null, F);
      T.add('iron', geo.tube(0.066, 0.215, 0.044, 0.236, 0.42, 0.112, 0.0042, 5), m, null, F);
      T.add('iron', geo.tube(-0.08, 0.22, -0.04, -0.2, 0.3, -0.16, 0.006, 5), m, null, F);
      T.add('furn', geo.tube(-0.2, 0.3, -0.16, -0.27, 0.35, -0.23, 0.012, 6), m, '#5a3420', F);
      const p = P3(m, 0, 0.235, 0);
      if (T instanceof Room && !T.low) {
        const Fx = fxOf(T);
        Fx.push('add', p.x, p.y - 0.004, p.z, 3, 0.2 * s, 1, 0, '#ff6c2c', 3, 0.1 * s);        // the glow of the coals: breathes
        Fx.push('add', p.x, p.y, p.z, 0, 0.07 * s, 1.3, 0.06 * s, '#ffa84a', 7, 0.13 * s);     // little tongues over them
      }
      if (T.ctx && o.light !== false) T.ctx.light({ x: p.x, y: p.y + 0.3, z: p.z, color: '#ff8a40', intensity: num(o.intensity, 2.8), distance: num(o.distance, 4.6), decay: 1.8, flicker: 0.06, day: num(o.day, 0.5) });
      footp(T, o, 0.55 * s, 0.55 * s);
      return { r: 0.275 * s, top: num(o.y, 0) + 0.26 * s, glow: p };
    }

    function dadeumitdol(T, o = {}) {
      const w = num(o.w, 0.62), d = num(o.d, 0.27), h = num(o.h, 0.19), m = base(T, o), F = noCast(o), lift = 0.03;
      // two wooden rests, then the stone: dark blue-grey 청석, wider at the foot, the top rubbed smooth and rounded
      for (const sx of [-1, 1]) T.add('furn', KG.slab(0.07, lift, d + 0.05, 0.006), mul(m, M(sx * w * 0.3, lift / 2, 0)), '#6a4428', o);
      const hy = h / 2, hz = d / 2;
      T.add('stone', prism([[-hy, -hz], [hy - 0.025, -hz + 0.022], [hy - 0.004, -hz + 0.05], [hy, -hz + 0.08], [hy, hz - 0.08], [hy - 0.004, hz - 0.05], [hy - 0.025, hz - 0.022], [-hy, hz]], w), mul(m, M(0, lift + hy, 0)), o.tint || '#6c757b', o);
      // a starched cloth folded on it, one 방망이 on the cloth and one on the floor
      const top = lift + h;
      T.add('cloth', KG.slab(w * 0.62, 0.022, d * 0.86, 0.007), mul(m, M(-0.03, top + 0.011, 0, 0.04)), '#f4f1e7', o);
      T.add('cloth', KG.slab(w * 0.6, 0.014, d * 0.82, 0.005), mul(m, M(-0.025, top + 0.029, 0.004, 0.06)), '#eae6d8', o);
      const club = () => KG.lathe([[0, 0], [0.017, 0], [0.021, 0.035], [0.029, 0.14], [0.031, 0.24], [0.026, 0.29], [0.014, 0.302], [0.012, 0.38], [0.016, 0.392], [0, 0.395]], 12).applyMatrix4(ZR(-PI / 2));
      T.add('furn', club(), mul(m, M(-0.2, top + 0.065, -0.05, 0.25)), '#c9a27a', o);
      T.add('furn', club(), mul(m, M(-0.12, 0.031, d / 2 + 0.12, -0.35)), '#c09670', o);
      footp(T, o, w + 0.1, d + 0.3);
      return { w, d, top: num(o.y, 0) + top + 0.04 };
    }

    function geomungo(T, o = {}) {
      const L = num(o.len, 1.6), W = num(o.w, 0.2), st = num(o.stand, 0.22), m = base(T, o), F = noCast(o), wood = o.tone || '#5e3c24';
      // two trestles
      for (const sx of [-1, 1]) {
        const tx = sx * L * 0.32;
        T.add('furn', KG.slab(0.06, 0.03, W + 0.1, 0.006), mul(m, M(tx, st - 0.015, 0)), '#3e2516', o);
        for (const sz of [-1, 1]) T.add('furn', upright(st - 0.05, 0.035, 0.035, 0.004), mul(m, M(tx, 0.02 + (st - 0.05) / 2, sz * (W / 2 + 0.02))), '#3e2516', o);
        T.add('furn', KG.slab(0.07, 0.02, W + 0.12, 0.004), mul(m, M(tx, 0.01, 0)), '#3e2516', o);
      }
      // the body: a flat back, an arched sounding board of paulownia, narrower towards the tail
      const y0 = st, bt = 0.022, arch = 0.035, nu = 24, nv = 8, wAt = (t) => W * (1 - 0.14 * t);
      T.add('furn', KG.slab(L, bt, W, 0.004), mul(m, M(0, y0 + bt / 2, 0)), '#3a2416', o);
      const top = geo.grid(nu, nv, (i, j, out) => {
        const t = i / nu, u = j / nv - 0.5, ww = wAt(t);
        out[0] = (t - 0.5) * L; out[2] = u * ww; out[1] = y0 + bt + arch * (1 - 4 * u * u) * (0.85 + 0.15 * Math.sin(t * PI));
        out[3] = t * L; out[4] = (u + 0.5) * ww;
      }, true);
      T.add('furn', top, m, wood, o);
      for (const sz of [-1, 1]) T.add('furn', KG.timber(L, 0.012, 0.008, 0.002), mul(m, M(0, y0 + bt + 0.004, sz * W * 0.465)), '#3a2416', F);
      const yAt = (t, u) => y0 + bt + arch * (1 - 4 * u * u) * (0.85 + 0.15 * Math.sin(t * PI));
      // 대모: the dark guard where the 술대 (plectrum) strikes; 현침 (head bridge) and 봉미 (tail)
      T.add('lacquer', KG.slab(0.2, 0.004, W * 0.62, 0.002), mul(m, M(-L * 0.36, yAt(0.14, 0) + 0.001, 0, 0, 1, 1, 1, 0, 0.02)), '#24150c', F);
      T.add('furn', KG.slab(0.022, 0.022, W * 0.9, 0.004), mul(m, M(-L / 2 + 0.06, yAt(0.04, 0) + 0.006, 0)), '#2a170c', o);
      T.add('furn', KG.slab(0.05, 0.03, wAt(1) * 0.95, 0.006), mul(m, M(L / 2 - 0.03, yAt(0.98, 0) + 0.004, 0)), '#2a170c', o);
      // 16 괘 under the 2nd, 3rd and 4th strings, three 안족 under the others, six silk strings
      const zs = [-0.38, -0.23, -0.08, 0.06, 0.2, 0.35].map((f) => f * W);
      for (let k = 0; k < 16; k++) {
        const t = 0.1 + k * 0.036, hh = 0.034 - k * 0.0017, zc = (zs[1] + zs[3]) / 2;
        T.add('furn', KG.slab(0.008, hh, (zs[3] - zs[1]) + 0.03, 0.002), mul(m, M((t - 0.5) * L, yAt(t, zc / W) + hh / 2 - 0.002, zc)), '#d8c8a8', F);
      }
      for (const [si, t] of [[0, 0.74], [4, 0.7], [5, 0.78]]) T.add('paint', KG.lathe([[0, 0], [0.012, 0], [0.004, 0.03], [0, 0.03]], 4), mul(m, M((t - 0.5) * L, yAt(t, zs[si] / W) - 0.001, zs[si])), '#e6dcc4', F);
      for (let s = 0; s < 6; s++) {
        const zh = zs[s], zt = zs[s] * 0.86, ya = yAt(0.04, 0) + 0.018, yb = yAt(0.98, 0) + 0.02;
        T.add('paint', geo.tube(-L / 2 + 0.06, ya, zh, L / 2 - 0.03, yb, zt, 0.0011 + s * 0.00012, 4), m, '#efe6cc', F);
        T.add('cloth', geo.tube(L / 2 - 0.01, yb - 0.01, zt, L / 2 + 0.03 + (s % 2) * 0.01, y0 - 0.06 - (s % 3) * 0.02, zt * 1.3, 0.004, 4), m, ['#a3302a', '#2c4a7a', '#d0a43a', '#3d7356', '#a3302a', '#6a2f5a'][s], F);   // 부들 cords
      }
      footp(T, o, L, W + 0.12);
      return { top: num(o.y, 0) + y0 + bt + arch + 0.04 };
    }

    function baduk(T, o = {}) {
      const w = num(o.w, 0.45), d = num(o.d, 0.42), th = num(o.th, 0.13), lh = num(o.legH, 0.1), m = base(T, o), F = noCast(o), top = lh + th;
      T.add('furn', KG.slab(w, th, d, 0.006), mul(m, M(0, lh + th / 2, 0)), o.tone || '#e2b77a', o);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) T.add('furn', KG.lathe([[0, 0], [0.03, 0], [0.042, 0.026], [0.036, 0.056], [0.022, 0.078], [0.032, lh], [0, lh]], 10), mul(m, M(sx * (w / 2 - 0.08), 0, sz * (d / 2 - 0.08))), '#a87a48', o);
      const gw = w - 0.05, gd = d - 0.05, n = 19, lc = '#2a1d12';
      for (let i = 0; i < n; i++) {
        const t = i / (n - 1);
        T.add('paint', geo.box(gw, 0.0014, 0.0018), mul(m, M(0, top + 0.0007, -gd / 2 + gd * t)), lc, F);
        T.add('paint', geo.box(0.0018, 0.0014, gd), mul(m, M(-gw / 2 + gw * t, top + 0.0007, 0)), lc, F);
      }
      for (const i of [3, 9, 15]) for (const j of [3, 9, 15]) T.add('paint', geo.cyl(0.0038, 0.0038, 0.0016, 8), mul(m, M(-gw / 2 + (gw * i) / 18, top + 0.0008, -gd / 2 + (gd * j) / 18)), lc, F);
      // a game half played (black and white stones on the points)
      const game = [[3, 3, 1], [15, 15, 0], [15, 3, 1], [3, 15, 0], [16, 5, 1], [13, 2, 0], [14, 3, 1], [9, 3, 0], [2, 9, 1], [5, 16, 0], [3, 13, 1], [4, 14, 0], [15, 9, 1], [9, 15, 0], [10, 10, 1], [11, 9, 0], [9, 9, 1], [10, 8, 0], [12, 15, 1], [16, 14, 0], [2, 5, 1], [5, 2, 0]];
      for (const [i, j, b] of game) T.add('lacquer', new THREE.SphereGeometry(0.0108, 10, 5).scale(1, 0.42, 1), mul(m, M(-gw / 2 + (gw * i) / 18, top + 0.0046, -gd / 2 + (gd * j) / 18)), b ? '#17171a' : '#efeee8', F);
      // 바둑통: two round lidded bowls of wood, their lids beside them
      for (const sx of [-1, 1]) {
        const bm = mul(m, M(sx * (w / 2 + 0.17), 0, 0.04));
        T.add('lacquer', KG.lathe([[0, 0], [0.05, 0], [0.075, 0.02], [0.085, 0.06], [0.075, 0.1], [0.068, 0.1], [0.062, 0.03], [0, 0.03]], 16), bm, '#6a3c22', o);
        T.add('lacquer', KG.lathe([[0, 0.012], [0.065, 0.012], [0.072, 0.02], [0.07, 0.03], [0, 0.04]], 16), mul(m, M(sx * (w / 2 + 0.17), 0, -0.13)), '#6a3c22', o);
        for (let k = 0; k < 9; k++) T.add('lacquer', new THREE.SphereGeometry(0.0108, 8, 4).scale(1, 0.42, 1), mul(bm, M((k % 3 - 1) * 0.022, 0.035 + Math.floor(k / 3) * 0.006, (Math.floor(k / 3) - 1) * 0.022)), sx < 0 ? '#17171a' : '#efeee8', F);
      }
      footp(T, o, w + 0.5, d);
      return { w, d, top: num(o.y, 0) + top };
    }

    function gobi(T, o = {}) {
      const w = num(o.w, 0.34), h = num(o.h, 0.95), m = base(T, o), wall = o.wall, F = { wall, cast: false }, tone = o.tone || '#7a4a2a';
      T.add('furn', KG.slab(w, h, 0.012, 0.003), mul(m, M(0, -h / 2, 0.008)), tone, { wall });
      for (const sx of [-1, 1]) T.add('furn', upright(h, 0.024, 0.034, 0.003), mul(m, M(sx * (w / 2 - 0.012), -h / 2, 0.026)), '#4e2e1b', { wall });
      T.add('furn', KG.timber(w + 0.06, 0.03, 0.04, 0.004), mul(m, M(0, -0.015, 0.026)), '#4e2e1b', { wall });
      const r = G.util.rng('hk:gobi');
      for (const fy of [0.45, 0.8]) {
        T.add('furn', KG.timber(w - 0.02, 0.055, 0.014, 0.003), mul(m, M(0, -h * fy, 0.05)), '#5a361f', { wall });
        // letters (folded 한지 and envelopes) tucked behind the slat
        for (let k = 0; k < 3; k++) T.add('hanji', KG.quad(0.075 + r() * 0.03, 0.2 + r() * 0.06), mul(m, M(-w * 0.3 + k * w * 0.3 + (r() - 0.5) * 0.02, -h * fy + 0.06, 0.034 + k * 0.003, 0, 1, 1, 1, 0, (k - 1) * 0.1 + (r() - 0.5) * 0.08)), k === 1 ? '#e9dcbc' : '#f1e8d2', F);
      }
      T.add('cloth', geo.tube(-0.06, 0.005, 0.012, 0, 0.07, 0.008, 0.003, 4), m, '#7a2e22', F);
      T.add('cloth', geo.tube(0.06, 0.005, 0.012, 0, 0.07, 0.008, 0.003, 4), m, '#7a2e22', F);
      return P3(m, 0, -h * 0.55, 0.08);
    }

    function boryo(T, o = {}) {
      const w = num(o.w, 1.9), d = num(o.d, 0.9), m = base(T, o), main = o.tint || '#8e2a26', trim = o.trim || '#22386a', acc = o.accent || '#d6a636';
      cushion(sub(T), { m, w, d, h: 0.11, tint: main, trim, wall: o.wall });
      // 장침: a long bolster along the back, with embroidered round ends
      const r = 0.1, len = w * 0.9;
      T.add('cloth', geo.cyl(r, r, len, 16).applyMatrix4(ZR(PI / 2)), mul(m, M(0, 0.11 + r, -d / 2 + r + 0.02)), trim, o);
      for (const e of [-1, 1]) {
        T.add('cloth', geo.cyl(r + 0.005, r + 0.005, 0.03, 16).applyMatrix4(ZR(PI / 2)), mul(m, M(e * len / 2, 0.11 + r, -d / 2 + r + 0.02)), acc, o);
        T.add('paint', geo.cyl(r * 0.58, r * 0.58, 0.004, 14).applyMatrix4(ZR(PI / 2)), mul(m, M(e * (len / 2 + 0.017), 0.11 + r, -d / 2 + r + 0.02)), main, noCast(o));
      }
      // 안석: a tall back cushion leaning on the bolster
      const am = mul(m, M(0, 0.11, -d / 2 + 0.3, 0, 1, 1, 1, -0.3));
      T.add('cloth', KG.slab(0.64, 0.66, 0.15, 0.05), mul(am, M(0, 0.33, 0)), main, o);
      T.add('cloth', KG.slab(0.6, 0.06, 0.155, 0.02), mul(am, M(0, 0.58, 0)), trim, noCast(o));
      T.add('cloth', KG.quad(0.2, 0.2).applyMatrix4(new THREE.Matrix4().makeRotationZ(PI / 4)), mul(am, M(0, 0.34, 0.077)), acc, noCast(o));
      // 사방침: two square armrests at the sides
      for (const sx of [-1, 1]) {
        const pm = mul(m, M(sx * (w / 2 - 0.22), 0.11, -d / 2 + 0.42));
        T.add('cloth', KG.slab(0.3, 0.3, 0.3, 0.07), mul(pm, M(0, 0.15, 0)), trim, o);
        for (const k of [0, 1, 2, 3]) T.add('cloth', KG.quad(0.12, 0.12).applyMatrix4(new THREE.Matrix4().makeRotationZ(PI / 4)), mul(pm, M(0, 0.15, 0, (k * PI) / 2)).multiply(M(0, 0, 0.151)), acc, noCast(o));
      }
      footp(T, o, w, d);
      return { w, d, top: num(o.y, 0) + 0.11 };
    }

    function banjitgori(T, o = {}) {
      const w = num(o.w, 0.34), d = num(o.d, 0.26), h = num(o.h, 0.1), m = base(T, o), F = noCast(o);
      // a box woven of rush, lined with red silk; the lid leans against its back
      T.add('basket', KG.slab(w, h, d, 0.014), mul(m, M(0, h / 2, 0)), '#c8a465', o);
      T.add('cloth', KG.floor(w - 0.05, d - 0.05), mul(m, M(0, h + 0.002, 0)), '#9c2f2a', F);
      T.add('basket', KG.slab(w + 0.01, 0.028, d + 0.01, 0.012), mul(m, M(0, d / 2 + 0.02, -d / 2 - 0.04, 0, 1, 1, 1, -(PI / 2 - 0.3))), '#bf9a5a', o);
      // 실패 (thread winders) with coloured thread, 골무 (thimbles), a pair of scissors
      const thread = ['#b8312c', '#2a4c86', '#e3b83a', '#ecebe4'];
      thread.forEach((c, i) => {
        const tm = mul(m, M(-w * 0.32 + i * 0.075, h + 0.012, -0.05, (i - 1.5) * 0.15));
        T.add('furn', KG.slab(0.064, 0.012, 0.03, 0.003), tm, '#d8b888', F);
        T.add('cloth', KG.slab(0.03, 0.02, 0.032, 0.006), mul(tm, M(0, 0.004, 0)), c, F);
      });
      ['#c2342e', '#2e5a9c', '#3d8a5a'].forEach((c, i) => T.add('cloth', KG.lathe([[0, 0], [0.011, 0], [0.012, 0.016], [0.009, 0.022], [0, 0.022]], 10), mul(m, M(-0.07 + i * 0.04, h + 0.003, 0.06)), c, F));
      for (const a of [-0.25, 0.25]) T.add('iron', KG.slab(0.11, 0.004, 0.012, 0.002), mul(m, M(0.09, h + 0.006, 0.05, a)), '#55575a', F);
      // rolls of cloth beside it
      const rolls = [['#e9e4d8', -0.02], ['#c3b28c', 0.08], ['#5a7a9c', 0.03]];
      rolls.forEach(([c, dz], i) => roll(sub(T), { m: mul(m, M(w / 2 + 0.24, i === 2 ? 0.088 : 0, -0.04 + dz * (i === 2 ? 0 : 1) + (i === 2 ? 0.03 : 0), PI / 2)), len: 0.38, r: 0.045, tint: c, band: '#7a5a3a', wall: o.wall }));
      footp(T, o, w + 0.4, d + 0.1);
      return { top: num(o.y, 0) + h + 0.03 };
    }

    function munbang(T, o = {}) {
      const m = base(T, o), F = noCast(o);
      // paper on the desk with a 서진 (paperweight), an open book
      T.add('hanji', KG.slab(0.3, 0.006, 0.22, 0.001), mul(m, M(-0.06, 0.003, 0.02, 0.05)), '#f2ead6', F);
      T.add('stone', KG.slab(0.2, 0.014, 0.024, 0.003), mul(m, M(-0.06, 0.013, -0.07, 0.05)), '#3d3a37', F);
      for (const sx of [-1, 1]) T.add('paint', geo.box(0.12, 0.008, 0.17), mul(m, M(-0.32 + sx * 0.062, 0.006 + 0.004, 0.0, 0, 1, 1, 1, 0, -sx * 0.06)), '#efe6cf', F);
      T.add('paint', geo.box(0.25, 0.003, 0.18), mul(m, M(-0.32, 0.0015, 0)), '#c9a35a', F);
      // 벼루 with its pool, a stick of 먹
      T.add('stone', KG.slab(0.2, 0.03, 0.13, 0.008), mul(m, M(0.22, 0.015, 0.02)), '#3c3c3f', o);
      T.add('lacquer', KG.floor(0.05, 0.09), mul(m, M(0.29, 0.0305, 0.02)), '#0c0c0e', F);
      T.add('lacquer', KG.slab(0.075, 0.016, 0.022, 0.003), mul(m, M(0.18, 0.038, -0.01, 0.35)), '#141414', F);
      // 필통 of bamboo with brushes, a 연적 (water dropper) of celadon
      const bx = 0.4, bz = -0.09;
      T.add('furn', geo.cyl(0.036, 0.036, 0.12, 14), mul(m, M(bx, 0.06, bz)), '#b89a5a', o);
      for (let k = 0; k < 5; k++) {
        const a = k * 1.3, tx = Math.cos(a) * 0.035, tz = Math.sin(a) * 0.035, y1 = 0.24 + (k % 2) * 0.03;
        T.add('furn', geo.tube(bx + tx * 0.3, 0.05, bz + tz * 0.3, bx + tx, y1, bz + tz, 0.0045, 5), m, '#7a5232', F);
        T.add('cloth', geo.tube(bx + tx, y1, bz + tz, bx + tx * 1.04, y1 + 0.03, bz + tz * 1.04, 0.0055, 5), m, k % 2 ? '#2a2a2a' : '#e9e3d4', F);
      }
      T.add('paint', KG.lathe([[0, 0], [0.03, 0], [0.042, 0.02], [0.038, 0.04], [0.012, 0.05], [0.006, 0.062], [0, 0.062]], 12), mul(m, M(0.1, 0, -0.11)), '#a9c3b2', F);
      // two rolls of paper at the back
      for (let k = 0; k < 2; k++) T.add('hanji', geo.cyl(0.022, 0.022, 0.3, 10).applyMatrix4(ZR(PI / 2)), mul(m, M(-0.2 + k * 0.03, 0.022 + k * 0.04, -0.12 - k * 0.012, 0.05)), k ? '#ece2c8' : '#f3ebd6', F);
    }

    function teaSet(T, o = {}) {
      const m = base(T, o), F = noCast(o), cel = o.tint || '#b7cbb8';
      const tr = table(sub(T), { m, w: 0.44, round: true, h: 0.17, tone: o.tone || '#5a3020', wall: o.wall }).top;
      const pm = mul(m, M(0.04, tr, -0.03));
      T.add('paint', KG.lathe([[0, 0], [0.045, 0], [0.062, 0.02], [0.068, 0.05], [0.058, 0.08], [0.032, 0.096], [0.034, 0.102], [0, 0.104]], 16), pm, cel, o);
      T.add('paint', new THREE.SphereGeometry(0.012, 8, 5), mul(pm, M(0, 0.11, 0)), cel, F);
      T.add('paint', geo.tube(0.055, 0.035, 0, 0.115, 0.09, 0, 0.008, 6), pm, cel, F);
      T.add('paint', new THREE.TorusGeometry(0.032, 0.006, 5, 10, PI).applyMatrix4(ZR(PI / 2)), mul(pm, M(-0.065, 0.05, 0)), cel, F);
      for (let k = 0; k < 3; k++) { const a = 2.2 + k * 0.85; T.add('paint', KG.lathe([[0, 0], [0.02, 0], [0.023, 0.006], [0.032, 0.04], [0.029, 0.04], [0, 0.008]], 14), mul(m, M(Math.cos(a) * 0.14, tr, Math.sin(a) * 0.14)), '#eeeadc', F); }
      footp(T, o, 0.44, 0.44);
      return { top: num(o.y, 0) + tr, spout: P3(pm, 0.115, 0.095, 0), lid: P3(pm, 0, 0.12, 0) };
    }

    function foldScreen(T, o = {}) {
      const n = Math.max(2, Math.round(num(o.panels, 10))), fold = clamp(num(o.fold, 0.3), 0, 1.2), m = base(T, o), F = noCast(o);
      const rec = art(o.art), artH = num(o.artH, 1.3), aspect = rec.ok ? rec.aspect : num(o.aspect, 2);
      const aw = num(o.aw, (artH * aspect) / n), pw = aw + 0.078, topM = num(o.top, 0.2), botM = num(o.bottom, 0.24), h = artH + topM + botM, ft = 0.03;
      const cx = Math.cos(fold) * pw, total = cx * n, frame = o.frame || '#3a2618', silk = o.silk || '#d2c4a0', brocade = o.brocade || '#4f5f6e';
      const pos = [], uv = [], nor = [], idx = [], v = new THREE.Vector3(), nm = new THREE.Matrix3();
      for (let i = 0; i < n; i++) {
        const a = i % 2 ? -fold : fold, pm = mul(m, M(-total / 2 + cx * (i + 0.5), ft, 0, a));
        T.add('furn', KG.slab(pw - 0.004, h, 0.016, 0.003), mul(pm, M(0, h / 2, 0)), frame, o);
        for (const sx of [-1, 1]) T.add('furn', upright(h, 0.02, 0.024, 0.003), mul(pm, M(sx * (pw / 2 - 0.01), h / 2, 0.004)), frame, F);
        for (const y of [0.01, h - 0.01]) T.add('furn', KG.timber(pw, 0.02, 0.024, 0.003), mul(pm, M(0, y, 0.004)), frame, F);
        T.add('cloth', KG.quad(pw - 0.04, h - 0.04), mul(pm, M(0, h / 2, 0.0085)), brocade, F);
        T.add('cloth', KG.quad(aw + 0.018, artH + 0.06), mul(pm, M(0, botM + artH / 2, 0.009)), silk, F);
        T.add('hanji', KG.quad(pw - 0.012, h - 0.02).applyMatrix4(new THREE.Matrix4().makeRotationY(PI)), mul(pm, M(0, h / 2, -0.0085)), '#e6dcc2', F);
        for (const sx of [-1, 1]) T.add('furn', KG.slab(0.045, ft, 0.05, 0.004), mul(pm, M(sx * (pw / 2 - 0.05), -ft / 2, 0)), '#26170d', o);
        if (rec.ok) {
          const am = mul(pm, M(0, botM + artH / 2, 0.0098)), b0 = pos.length / 3;
          for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { v.set((sx * aw) / 2, (sy * artH) / 2, 0).applyMatrix4(am); pos.push(v.x, v.y, v.z); uv.push((i + (sx + 1) / 2) / n, (sy + 1) / 2); }
          nm.getNormalMatrix(am); v.set(0, 0, 1).applyMatrix3(nm).normalize();
          for (let k = 0; k < 4; k++) nor.push(v.x, v.y, v.z);
          idx.push(b0, b0 + 1, b0 + 2, b0, b0 + 2, b0 + 3);
        } else T.add('hanji', KG.quad(aw, artH), mul(pm, M(0, botM + artH / 2, 0.0098)), '#eee4cc', F);
      }
      if (rec.ok && pos.length) {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx);
        g.computeBoundingSphere();
        const mesh = new THREE.Mesh(g, artMaterial(T, rec));
        mesh.name = 'room-art'; mesh.userData.guardSkip = true; mesh.receiveShadow = true;
        T.ctx?.own?.(g);
        (T.addMesh ? T.addMesh(mesh, o.wall) : T.ctx?.group?.add(mesh));
      }
      footp(T, o, total, 0.32);
      return { w: total, h: h + ft, ok: rec.ok, center: P3(m, 0, ft + botM + artH / 2, 0.08) };
    }

    Object.assign(K, { jangnong, bandaji, ibuljang, gyeongdae, seoan, mungap, sabangtakja, chaekjang, books, hwaro, dadeumitdol, geomungo, baduk, gobi, boryo, banjitgori, munbang, teaSet, foldScreen });
  })();
  // ==============================================================================================================
  // [rooms-c] generators for the 부엌, the 발효실 and the 곳간 (29-interiors-c.js) — an add-only block of the rooms-c
  // track. Same conventions as section 3: (T, opts) with opts.x / y / z / rotY (or opts.m), local +Z = the front, a
  // footprint back, no collider (R.block yourself); tints multiply the kit's materials, so `low` keeps the colours.
  //   K.sway(R, {x, y, z, amp = 0.04, speed = 0.55, axis: 'x'|'z', phase, wall}) -> S   a group that swings slowly
  //        about its pivot (x, y, z) — 메주 on straw rope, strings under the rafters. S.add(key, geometry, roomMatrix |
  //        null, tint) like R.add; S.done() before R.finish() (one draw call per material; still under reduce motion)
  //   wall bay { baraji: true, w = 1.0, h = 0.7, sill = 1.5, open = 0.85, offset = 0, gap = 0.1, wallMat, label }
  //        바라지창 / 살창: an opening with diamond wooden bars and two board shutters swung in — the window sun comes
  //        through as a hard shaft with the bars' shadows (no paper glow)
  //   K.buttumak(R, {x, z, rotY, w = 4.4, d = 1.0, h = 0.78, mouths: [u…], pots: [{u, s, siru}], fireS})
  //        -> {w, d, top, mouths: [{x, y, z}], pots: [{x, y, z, s, top}]}   부뚜막: plinth stones, a clay body with a
  //        real 아궁이 recess per mouth (sooty firebox, stone jambs + 이맛돌, half-burnt logs, flames, embers, a pooled
  //        light), 가마솥 sunk to the flange with the lid on, a 시루 sealed with 시룻번 under a cloth, steam, 조왕 bowl
  //   K.salgang(R, side, bay, {w, d = 0.34, levels = 2, y = 1.15, gap = 0.5, offset}) -> {spots, x, y, z}   살강:
  //        slatted wall shelves on bearers and braces with stacks of 사발 / 대접 and leaning 접시
  //   K.chanjang(R, {x, z, rotY, w = 1.15, d = 0.46}) -> {w, d, top, niche}   찬장: drawers and doors below, an open
  //        niche with bottles, lattice doors above
  //   K.mulDumeong(R, {x, z, s}) -> {r, top}   물두멍: a wide water jar on a flat stone, water, a floating gourd dipper,
  //        a board lid half over the mouth          K.dongi(R, {x, z, s, ring = true}) -> {r, top}   물동이 + 똬리
  //   K.mejuRack(R, {x, z, rotY, w = 2.4, h = 2.3, rows: [y…], per = 5}) -> {spots}   메주 걸이: blocks tied in a cross
  //        of straw, hung on straw rope from round bars; every row swings slowly (two groups per row)
  //   K.mejuBed(R, {x, z, rotY, w = 2.4, d = 0.8, h = 0.5, n = 6}) -> {top, spots}   a low platform lined with straw
  //        where 메주 ripen (메주 띄우기)
  //   K.nurukRack(R, {x, z, rotY, w = 1.3, d = 0.5, h = 1.6, levels = 4}) -> {spots}   shelves of 채반 with 누룩 cakes
  //   K.nurukTray(T, {x, y, z, r = 0.3, n = 6})       K.geumjul(R, {x, y, z, s = 1, kind = 'dok', rotY})   금줄 round a
  //        jar's neck with 숯 and 고추 tucked in, a 한지 버선본 upside down on the belly
  //   K.kimchiPit(R, {x, z, rotY, w = 1.9, d = 1.5}) -> {jars: [{x, y, z}], top}   a straw-covered mound in a corner
  //        with 김칫독 sunk to their shoulders, 짚방석 lids, stones round the foot
  //   K.dwiju(R, {x, z, rotY, w = 0.95, d = 0.62, h = 0.95}) -> {w, d, top}   뒤주: a rice chest on tall feet, top lid
  //   K.gamaniStack(R, {x, z, rotY, rows: [3, 2, 1]}) -> {w, d, top}       K.seom(R, {x, z, rotY, s}) -> {top}   섬
  //   K.meongseok(R, {x, z, rotY, len = 1.5, r = 0.2, upright}) -> {top}   멍석, rolled (upright: on its end)
  //   K.farmTool(R, kind, m, {wall}) -> {x, y, z}   'homi' 호미 · 'nat' 낫 · 'soeseurang' 쇠스랑 · 'dorikkae' 도리깨,
  //        hung from a peg at m (a wall spot from R.wm), handle down
  //   K.jeoul(R, m, {wall}) -> {x, y, z}   대저울 from a peg at m: a marked beam on a cord, a pan of beans, the weight
  //   K.doe(T, {x, y, z, rotY, kind: 'doe'|'mal', fill}) -> {top}   되 / 말: wooden measures heaped with grain
  //   K.jangjak(R, {x, z, rotY, w = 1.3, h = 0.75, d = 0.45}) -> {w, d, top}   a pile of split firewood
  //   K.gongi(R, {x, y, z, rotY, lean = 0.22, len = 1.15})   절구공이 leaning   K.jori(T, m, {pair, wall})  조리 / 복조리
  //   strings (T = a sway group or the room): K.siraegi(T, {x, y, z, len}) 시래기 · K.gochu(T, {x, y, z, n}) 고추 ·
  //        K.maneul(T, {x, y, z}) 마늘 접 · K.corn(T, {x, y, z}) seed corn in pairs · K.herbs(T, {x, y, z, tint}) a bunch
  //   K.soot(R, [{m, w, h} | {roof: true, x0, x1}], {color, alpha}) -> mesh   smoke-darkened patches (one draw call)
  //   K.pillow(w, h, d, e = 0.4, ey = 0.62) -> BufferGeometry   a puffed block (가마니, 메주) with metre UVs
  // ==============================================================================================================
  (function roomsC() {
    const v3 = (m, x, y, z) => new THREE.Vector3(x, y, z).applyMatrix4(m);
    const rZ = (g, a) => g.applyMatrix4(new THREE.Matrix4().makeRotationZ(a));
    const rX = (g, a) => g.applyMatrix4(new THREE.Matrix4().makeRotationX(a));
    const rY = (g, a) => g.applyMatrix4(new THREE.Matrix4().makeRotationY(a));
    const vpost = (len, w, b = 0.006) => rZ(KG.timber(len, w, w, b), PI / 2);          // a square timber standing up
    const shade = (hex, k) => { const c = col(hex).clone(); c.multiplyScalar(k); return c; };
    /** a puffed block: a superellipsoid w × h × d (flat-ish faces, round edges) with metre UVs */
    function pillow(w, h, d, e = 0.4, ey = 0.62, seg = 16) {
      const g = new THREE.SphereGeometry(1, seg, Math.max(6, Math.round(seg * 0.62)));
      const p = g.attributes.position, uv = g.attributes.uv, f = (v, k) => Math.sign(v) * Math.pow(Math.abs(v), k);
      for (let i = 0; i < p.count; i++) {
        p.setXYZ(i, f(p.getX(i), e) * w / 2, f(p.getY(i), ey) * h / 2, f(p.getZ(i), e) * d / 2);
        uv.setXY(i, uv.getX(i) * (w + d) * 1.1, uv.getY(i) * (h + Math.min(w, d)));
      }
      g.computeVertexNormals();
      return g;
    }
    /** a group that swings about its pivot; pieces are given in room coordinates */
    function sway(R, o = {}) {
      const px = num(o.x, 0), py = num(o.y, 2), pz = num(o.z, 0), inv = M(-px, -py, -pz), Bk = new BK.Bucket();
      const S = { ctx: R.ctx, low: R.low, rnd: R.rnd, room: R, isSway: true };
      S.add = (key, g, m, tintHex) => { if (g) Bk.add(key, g, m ? mul(inv, m) : inv, tint(key, tintHex)); };
      S.planItem = () => {};
      S.done = () => {
        if (S.group) return S.group;
        const grp = new THREE.Group();
        grp.name = 'room-sway'; grp.position.set(px, py, pz);
        const mats = {};
        for (const k of Bk.parts.keys()) mats[k] = mat(k);
        const out = Bk.build(grp, { name: R.ctx.id + ':sway', materials: mats, shadows: false, ao: false });
        for (const k in out) { out[k].castShadow = !!R.shadows; out[k].receiveShadow = true; }
        R.addMesh(grp, o.wall || null);
        const amp = num(o.amp, 0.04), sp = num(o.speed, 0.55), ph = num(o.phase, R.rnd() * 6.28), ax = o.axis === 'z' ? 'z' : 'x';
        R.onUpdate((dt, t) => {
          const k = G.settings?.reduceMotion ? 0 : 1;
          grp.rotation[ax] = k * (Math.sin(t * sp + ph) * amp + Math.sin(t * sp * 2.3 + ph * 1.7) * amp * 0.22);
        });
        S.group = grp;
        return grp;
      };
      return S;
    }

    // ---------------------------------------------------------------- 바라지창 / 살창 (a wall bay kind)
    function barajiBay(R, side, i, spec) {
      const P = R.post, b = R.bay(side, i), wallTop = P - 0.24, o = { wall: side }, pr = R.postR;
      const key = spec.wallMat === 'plaster' ? 'plaster' : spec.wallMat === 'board' ? 'wood' : 'clay';
      const ow = Math.min(num(spec.w, 1.0), b.len - pr * 2 - 0.3), sill = num(spec.sill, 1.5), oh = Math.max(0.2, Math.min(num(spec.h, 0.7), wallTop - sill - 0.12));
      const cu = b.uc + num(spec.offset, 0), ou0 = cu - ow / 2, ou1 = cu + ow / 2, ov0 = sill, ov1 = sill + oh, jt = 0.08;
      const a0 = b.u0 + pr, a1 = b.u1 - pr;
      const panel = (pu0, pu1, pv0, pv1) => {
        if (pu1 - pu0 < 0.02 || pv1 - pv0 < 0.02) return;
        R.add(key, KG.quad(pu1 - pu0, pv1 - pv0, pu0 + i * 0.7, pv0), R.wm(side, (pu0 + pu1) / 2, (pv0 + pv1) / 2, 0.012), null, { wall: side, cast: false });
        R.solid[side].push([pu0 - 0.06, pu1 + 0.06, pv0 - 0.1, pv1 + 0.1]);
      };
      panel(a0, ou0 - jt, 0.16, wallTop); panel(ou1 + jt, a1, 0.16, wallTop);
      panel(ou0 - jt, ou1 + jt, ov1 + jt, wallTop); panel(ou0 - jt, ou1 + jt, 0.16, ov0 - jt);
      // 중방 across the bay under the opening, the frame (문선 · 상방 · 하방)
      R.add('wood', KG.timber(b.len - pr * 2 + 0.02, 0.1, 0.1, 0.01), R.wm(side, b.uc, ov0 - jt - 0.05, 0), R.woodT, o);
      for (const su of [ou0 - jt / 2, ou1 + jt / 2]) R.add('wood', vpost(oh + jt * 2, jt, 0.01), R.wm(side, su, (ov0 + ov1) / 2, 0), R.woodT, o);
      R.add('wood', KG.timber(ow + jt * 2 + 0.12, jt, 0.13, 0.01), R.wm(side, cu, ov1 + jt / 2, 0), R.woodT, o);
      // the bars: square 살 turned 45° (they throw sharp stripes)
      const n = Math.max(3, Math.round(ow / num(spec.gap, 0.1))), segs = [];
      for (let k = 1; k < n; k++) {
        const u = ou0 + (ow * k) / n, g = vpost(oh + 0.02, 0.032, 0.004);
        rY(g, PI / 4);
        R.add('wood', g, R.wm(side, u, (ov0 + ov1) / 2, 0), '#b39270', o);
        segs.push([u - cu, -oh / 2, u - cu, oh / 2]);
      }
      // two board shutters swung in under the eaves of the opening
      panelDoor(R, R.wm(side, cu, (ov0 + ov1) / 2, 0.05), { w: ow - 0.01, h: oh - 0.01, leaves: 2, open: num(spec.open, 0.85), wall: side, tint: '#a3876a' });
      R.ports.push({ side, u0: ou0, u1: ou1, v0: ov0, v1: ov1, segs, bar: 0.036 });
      if (spec.label) R.label(String(spec.label), { side, u: cu, v: ov0 - jt - 0.24, w: 0.6, h: spec.sub ? 0.24 : 0.17, sub: spec.sub, style: 'wood' });
    }
    const _bay0 = Room.prototype._bay;
    Room.prototype._bay = function (side, i, spec) {
      if (spec && typeof spec === 'object' && spec.baraji) return barajiBay(this, side, i, spec);
      return _bay0.call(this, side, i, spec);
    };

    // ---------------------------------------------------------------- 부뚜막 · 아궁이 · 가마솥 · 시루
    function buttumak(R, o = {}) {
      const w = num(o.w, 4.4), d = num(o.d, 1.0), h = num(o.h, 0.78), m = base(R, o), tn = o.tint || '#c4a37a';
      const mw = num(o.mouthW, 0.48), mh = num(o.mouthH, 0.4), md = Math.min(d - 0.24, 0.6), my0 = 0.03, my1 = my0 + mh, jw = 0.11;
      const fz = d / 2, plinth = 0.13, topY = h - 0.07, L = (x, y, z, ry = 0) => mul(m, M(x, y, z, ry));
      const op = { wall: o.wall };
      const mouths = (Array.isArray(o.mouths) ? o.mouths : [-w / 4, w / 4]).map(Number).sort((a, b) => a - b);
      const solid = (a, c) => {
        if (c - a < 0.01) return;
        R.add('stone', KG.slab(c - a, plinth, d + 0.03, 0.025), L((a + c) / 2, plinth / 2, 0), '#a39a8a', op);
        R.add('clay', KG.slab(c - a, topY - plinth, d, 0.02), L((a + c) / 2, (plinth + topY) / 2, 0), tn, op);
      };
      let x0 = -w / 2;
      const out = { w, d, top: num(o.y, 0) + h, mouths: [], pots: [] };
      for (const mx of mouths) {
        const a = mx - mw / 2 - jw, c = mx + mw / 2 + jw;
        solid(x0, a); x0 = c;
        // stone jambs and the 이맛돌 (a long flat stone over the mouth), the clay above it
        for (const sx of [-1, 1]) {
          R.add('stone', KG.slab(jw, my1 + 0.02, 0.18, 0.02), L(mx + sx * (mw / 2 + jw / 2), (my1 + 0.02) / 2, fz - 0.08), '#9d9586', op);
          R.add('clay', KG.slab(jw, topY - 0.01, d - 0.17, 0.01), L(mx + sx * (mw / 2 + jw / 2), (topY - 0.01) / 2, -0.085), tn, op);
        }
        R.add('stone', KG.slab(mw + jw * 2 + 0.14, 0.12, 0.2, 0.025), L(mx, my1 + 0.06, fz - 0.085), '#a7a090', op);
        if (topY - my1 - 0.12 > 0.02) R.add('clay', KG.slab(mw + jw * 2, topY - my1 - 0.12, d, 0.015), L(mx, (my1 + 0.12 + topY) / 2, 0), tn, op);
        // the firebox: sooty walls, a bed of ash; solid clay behind it
        const soot = '#1d140e';
        R.add('paint', KG.quad(mw, mh), L(mx, my0 + mh / 2, fz - md), soot, { ...op, cast: false });
        R.add('paint', KG.quad(md, mh), L(mx - mw / 2, my0 + mh / 2, fz - md / 2, PI / 2), soot, { ...op, cast: false });
        R.add('paint', KG.quad(md, mh), L(mx + mw / 2, my0 + mh / 2, fz - md / 2, -PI / 2), soot, { ...op, cast: false });
        R.add('paint', KG.floor(mw, md, true), L(mx, my1, fz - md / 2), '#120c08', { ...op, cast: false });
        R.add('paint', KG.floor(mw, md), L(mx, my0, fz - md / 2), '#3b342f', { ...op, cast: false });
        R.add('clay', KG.slab(mw, my1, d - md, 0.01), L(mx, my1 / 2, (-d / 2 + fz - md) / 2), tn, op);
        // ash spilled before the mouth, two half-burnt logs, flames and embers, a pooled light in front
        R.add('paint', KG.floor(mw + 0.16, 0.3), L(mx, 0.005, fz + 0.15), '#575049', { ...op, cast: false });
        for (const [lx, lr] of [[-0.09, 0.42], [0.1, -0.35]]) {
          const pa = v3(m, mx + lx, my0 + 0.05, fz - md + 0.14), pb = v3(m, mx + lx * 1.6, 0.05, fz + 0.24 + lr * 0.1);
          R.add('wood', geo.tube(pa.x, pa.y, pa.z, pb.x, pb.y, pb.z, 0.038, 7), null, '#6b5442', op);
          const pc = v3(m, mx + lx * 1.15, my0 + 0.045, fz - md + 0.38);
          R.add('paint', geo.tube(pa.x, pa.y, pa.z, pc.x, pc.y, pc.z, 0.041, 7), null, '#1a1512', { ...op, cast: false });
        }
        const pf = v3(m, mx, my0 + 0.02, fz - md * 0.42);
        fire(R, { x: pf.x, y: pf.y, z: pf.z, s: num(o.fireS, 0.82), light: false });
        const pl = v3(m, mx, 0.32, fz + 0.4);
        R.ctx.light({ x: pl.x, y: pl.y, z: pl.z, color: '#ff8c3c', intensity: num(o.fireI, 6.2), distance: 6.5, decay: 1.8, flicker: 0.12, day: 0.7 });
        out.mouths.push(v3(m, mx, my1 + 0.08, fz + 0.15));
      }
      solid(x0, w / 2);
      // the plastered top with a rounded front edge
      R.add('clay', KG.slab(w + 0.06, 0.07, d + 0.05, 0.03), L(0, h - 0.035, 0.01), o.topTint || '#d6c09c', op);
      // 가마솥 sunk to the flange, a 시루 on one of them
      for (const p of o.pots || []) {
        const s = num(p.s, 1), u = num(p.u, 0), pz = num(p.z, -0.03), y0 = h - 0.3 * s, pm = mul(L(u, y0, pz, num(p.ry, 0)), M(0, 0, 0, 0, s));
        R.add('iron', KG.lathe(PROFILES.sot, 24), pm, '#2c2a28', op);
        let top = y0 + 0.41 * s;
        if (p.siru) {
          const ss = s * 1.06, sy = y0 + 0.395 * s, sm = mul(L(u, sy, pz), M(0, 0, 0, 0, ss));
          R.add('onggi', KG.lathe(PROFILES.siru, 22), sm, '#9a7863', op);
          R.add('cloth', new THREE.TorusGeometry(0.255 * ss, 0.024, 6, 22).applyMatrix4(new THREE.Matrix4().makeRotationX(PI / 2)), L(u, sy + 0.012, pz), '#ecdfc4', { ...op, cast: false });
          cloth(R, { m: L(u, sy + 0.3 * ss, pz), w: 0.6 * ss, d: 0.6 * ss, drop: 0.09, tint: '#e8dcc2' });
          top = sy + 0.31 * ss;
        } else if (p.lid !== false) {
          R.add('iron', KG.lathe(PROFILES.sotLid, 24), mul(pm, M(0, 0.405, 0)), '#36322f', op);
          top = y0 + 0.51 * s;
        }
        const pt = v3(m, u, top, pz);
        out.pots.push({ x: pt.x, y: pt.y, z: pt.z, s, top });
        steam(R, { x: pt.x, y: pt.y + 0.02, z: pt.z, s: p.siru ? 0.5 : 0.42, count: p.siru ? 20 : 14, life: 3.4 });
      }
      // 조왕중발: a small bowl of clean water set on the 부뚜막 for the kitchen spirit (a calm old custom)
      if (o.jowang !== false) {
        const bu = num(o.jowangU, w / 2 - 0.28);
        R.add('paint', KG.lathe(PROFILES.bowl, 14), mul(L(bu, h, -d / 2 + 0.22), M(0, 0, 0, 0, 0.62)), '#efebe1', op);
        R.add('lacquer', geo.disc(0.054, 12), L(bu, h + 0.034, -d / 2 + 0.22), '#a9b8bc', { ...op, cast: false });
      }
      R.planItem?.(num(o.x, 0), num(o.z, 0), Math.abs(Math.cos(num(o.rotY, 0))) > 0.5 ? w : d, Math.abs(Math.cos(num(o.rotY, 0))) > 0.5 ? d : w, 'rgba(150,110,70,.85)');
      return out;
    }

    // ---------------------------------------------------------------- 살강 · 찬장 · 물두멍 · 물동이
    const BOWL = [[0, 0], [0.04, 0], [0.045, 0.012], [0.09, 0.04], [0.1, 0.07], [0.092, 0.07], [0.08, 0.04], [0, 0.018]];
    const PLATE = [[0, 0], [0.05, 0], [0.085, 0.014], [0.1, 0.022], [0.094, 0.024], [0.08, 0.017], [0, 0.009]];
    function bowlAt(T, m, kind, tn, o) {
      const k = kind === 'daejeop' ? [1.05, 0.85] : kind === 'sabal' ? [0.68, 1.0] : [0.8, 0.9];
      T.add(tn === 'onggi' ? 'onggi' : 'paint', KG.lathe(BOWL, 14), mul(m, M(0, 0, 0, 0, k[0], k[1], k[0])), tn === 'onggi' ? '#6a4630' : tn, o);
      return 0.07 * k[1];
    }
    function salgang(R, side, bayIndex, o = {}) {
      const b = R.bay(side, bayIndex), wid = Math.min(num(o.w, b.len - 0.7), b.len - 0.5), dep = num(o.d, 0.34), levels = Math.max(1, Math.round(num(o.levels, 2)));
      const y0 = num(o.y, 1.15), gap = num(o.gap, 0.5), cu = b.uc + num(o.offset, 0), W = { wall: side }, spots = [], rnd = R.rnd;
      const WHITE = ['#efece3', '#e9e5d8', '#f2efe7'], GREY = '#b8b6a0';
      for (let l = 0; l < levels; l++) {
        const y = y0 + l * gap, n = 6;
        for (let k = 0; k < n; k++) R.add('wood', KG.timber(wid, 0.022, 0.04, 0.005), R.wm(side, cu, y, 0.04 + (k + 0.5) * (dep - 0.05) / n), k % 2 ? '#8b6646' : '#7a573a', W);
        for (const su of [-1, 1]) {
          const g = KG.timber(dep + 0.05, 0.05, 0.05, 0.006); rY(g, PI / 2);
          R.add('wood', g, R.wm(side, cu + su * (wid / 2 - 0.16), y - 0.036, (dep + 0.05) / 2), '#6c4a30', W);
          R.add('wood', KG.span(0, -0.06, dep * 0.8, 0, -0.36, 0.02, 0.04, 0.04, 0.005), R.wm(side, cu + su * (wid / 2 - 0.16), y, 0), '#6c4a30', W);
        }
        // dishes: stacks of 사발 turned down to drain, 대접 stacked up, a few 접시 leaning on the wall
        let u = cu - wid / 2 + 0.16;
        while (u < cu + wid / 2 - 0.16) {
          const kind = rnd() < 0.5 ? 'sabal' : 'daejeop', nStack = 2 + Math.floor(rnd() * 3), down = kind === 'sabal';
          const tn = rnd() < 0.18 ? 'onggi' : rnd() < 0.25 ? GREY : WHITE[Math.floor(rnd() * 3)];
          const nn = 0.06 + dep * 0.45;
          let yy = y + 0.012;
          for (let s = 0; s < nStack; s++) {
            const bm = mul(R.wm(side, u, yy + (down ? 0.068 : 0), nn), down ? M(0, 0, 0, 0, 1, 1, 1, PI) : M());
            yy += bowlAt(R, bm, kind, tn, W) * 0.42;
          }
          spots.push(R.wp(side, u, yy + 0.04, nn));
          u += kind === 'daejeop' ? 0.26 : 0.2;
          if (rnd() < 0.3 && u < cu + wid / 2 - 0.2) {   // a plate on edge against the wall
            R.add('paint', KG.lathe(PLATE, 14), mul(R.wm(side, u, y + 0.11, 0.05), M(0, 0, 0, 0, 1, 1, 1, PI / 2 - 0.18)), WHITE[0], W);
            u += 0.12;
          }
        }
      }
      const c = R.wp(side, cu, y0 + gap * (levels - 1) + 0.18, dep * 0.5);
      return { spots, x: c.x, y: c.y, z: c.z };
    }
    function chanjang(R, o = {}) {
      const w = num(o.w, 1.15), d = num(o.d, 0.46), m = base(R, o), tone = o.tone || '#6e4529', frameTone = '#4a2c19', x = num(o.x, 0), z = num(o.z, 0);
      chest(R, { m, x, z, w, d, h: 0.8, doors: 2, drawers: 2, legs: 0.1, fittings: 'iron', tone, frameTone, panelTone: '#7c5133' });
      // the open niche: two posts, a back board, bottles and a 단지 standing in it
      const ny0 = 0.83, ny1 = 1.12;
      for (const sx of [-1, 1]) R.add('furn', vpost(ny1 - ny0, 0.05), mul(m, M(sx * (w / 2 - 0.025), (ny0 + ny1) / 2, -d / 2 + 0.06)), frameTone, o);
      R.add('furn', KG.quad(w - 0.06, ny1 - ny0), mul(m, M(0, (ny0 + ny1) / 2, -d / 2 + 0.035)), '#4f311f', { ...o, cast: false });
      pot(R, { m: mul(m, M(-w * 0.28, ny0, -0.02)), kind: 'bottle', s: 0.7, tint: '#ebe6d7' });
      pot(R, { m: mul(m, M(-w * 0.12, ny0, 0.02)), kind: 'bottle', s: 0.62, tint: '#c9c6ae' });
      pot(R, { m: mul(m, M(w * 0.2, ny0, 0)), kind: 'danji', s: 0.38, lid: true, tint: '#6c4631' });
      // the upper cupboard with 정자살 relief on its doors
      const um = mul(m, M(0, ny1, 0.02));
      chest(R, { m: um, x, z, w: w - 0.03, d: d - 0.05, h: 0.6, doors: 2, drawers: 0, legs: 0, fittings: 'iron', tone, frameTone, panelTone: '#7c5133' });
      const iw = w - 0.03 - 0.1, dw = iw / 2;
      for (let k = 0; k < 2; k++) changho(R, mul(um, M(-iw / 2 + dw * (k + 0.5), 0.3, (d - 0.05) / 2 + 0.012)), { w: dw - 0.08, h: 0.42, pattern: 'jeongja', paper: false, bar: 0.016, depth: 0.012, frame: 0.025, tint: '#5a3822', wall: o.wall });
      R.add('furn', KG.slab(w + 0.06, 0.035, d + 0.03, 0.01), mul(m, M(0, ny1 + 0.63, 0)), frameTone, o);
      const nc = v3(m, 0, (ny0 + ny1) / 2, d / 2);
      return { w, d, top: num(o.y, 0) + ny1 + 0.65, niche: { x: nc.x, y: nc.y, z: nc.z } };
    }
    function mulDumeong(R, o = {}) {
      const s = num(o.s, 1), m0 = base(R, o), m = mul(m0, M(0, 0.06, 0, 0, s));
      R.add('stone', KG.slab(1.0 * s, 0.06, 0.95 * s, 0.025), mul(m0, M(0, 0.03, 0)), '#a8a192', o);
      const prof = [[0, 0], [0.24, 0], [0.3, 0.04], [0.42, 0.2], [0.48, 0.38], [0.5, 0.52], [0.49, 0.6], [0.47, 0.64], [0.5, 0.67], [0.49, 0.69], [0.44, 0.69], [0.42, 0.62], [0.41, 0.5]];
      R.add('onggi', KG.lathe(prof, 24), m, o.tint || '#5a3a27', o);
      R.add('lacquer', geo.disc(0.418, 24), mul(m, M(0, 0.6, 0)), '#1f2c30', { ...o, cast: false });
      // a gourd dipper (바가지) afloat, two lid boards over the back of the mouth
      const gourd = [[0, 0], [0.06, 0.004], [0.1, 0.03], [0.12, 0.07], [0.114, 0.072], [0.094, 0.035], [0.055, 0.013], [0, 0.009]];
      R.add('paint', KG.lathe(gourd, 14), mul(m, M(0.08, 0.585, 0.12, 0.6, 1, 1, 1.28)), '#cdb47c', o);
      for (const k of [0, 1]) R.add('furn', KG.slab(0.98, 0.026, 0.2, 0.006), mul(m, M(0, 0.705 + k * 0.004, -0.27 + k * 0.205, k * 0.06)), '#7d5a3d', o);
      R.planItem?.(num(o.x, 0), num(o.z, 0), 1.0 * s, 1.0 * s, 'rgba(70,60,50,.8)');
      return { r: 0.5 * s, top: num(o.y, 0) + 0.06 + 0.72 * s };
    }
    function dongi(R, o = {}) {
      const s = num(o.s, 1), m = mul(base(R, o), M(0, 0, 0, 0, s));
      const prof = [[0, 0], [0.13, 0], [0.16, 0.03], [0.22, 0.14], [0.245, 0.24], [0.235, 0.3], [0.19, 0.35], [0.135, 0.38], [0.13, 0.4], [0.145, 0.415], [0.14, 0.43], [0.12, 0.43], [0.11, 0.39]];
      R.add('onggi', KG.lathe(prof, 18), m, o.tint || '#6b4530', o);
      for (const sx of [-1, 1]) R.add('onggi', new THREE.TorusGeometry(0.036, 0.011, 5, 10, PI).applyMatrix4(new THREE.Matrix4().makeRotationZ(sx > 0 ? -PI / 2 : PI / 2)), mul(m, M(sx * 0.222, 0.29, 0)), '#5d3c29', o);
      if (o.ring !== false) R.add('straw', new THREE.TorusGeometry(0.085, 0.026, 6, 14).applyMatrix4(new THREE.Matrix4().makeRotationX(PI / 2)), mul(base(R, o), M(0.36, 0.026, 0.12)), '#c9aa66', o);
      return { r: 0.25 * s, top: num(o.y, 0) + 0.43 * s };
    }

    // ---------------------------------------------------------------- 메주 · 누룩 · 금줄 · 김칫독
    const MEJU = ['#c2a57c', '#b59a72', '#c9ad86', '#a98f68', '#bca07a'];
    function mejuBlock(T, m, rnd, o) {
      const bw = 0.24 + rnd() * 0.03, bh = 0.18 + rnd() * 0.02, bd = 0.15 + rnd() * 0.015;
      T.add('clay', pillow(bw, bh, bd, 0.32, 0.4, 14), m, MEJU[Math.floor(rnd() * MEJU.length)], o);
      // straw ties round it in a cross
      const tie = (rx, ry, sx, sy) => { const g = new THREE.TorusGeometry(1, 0.06, 4, 16); g.scale(sx, sy, 0.12); if (rx) rX(g, rx); if (ry) rY(g, ry); return g; };
      T.add('straw', tie(PI / 2, 0, bw / 2 + 0.004, bd / 2 + 0.004), m, '#e6cf92', o);
      T.add('straw', tie(0, PI / 2, bd / 2 + 0.004, bh / 2 + 0.004), m, '#e6cf92', o);
      return { bw, bh, bd };
    }
    function mejuRack(R, o = {}) {
      const w = num(o.w, 2.4), h = num(o.h, 2.3), m = base(R, o), rows = o.rows || [2.12, 1.52], per = Math.max(1, Math.round(num(o.per, 5)));
      const ry = num(o.rotY, 0), axis = Math.abs(Math.cos(ry)) > 0.7 ? 'x' : 'z', tn = o.tone || '#86684a', spots = [];
      for (const sx of [-1, 1]) {
        R.add('wood', vpost(h, 0.085, 0.01), mul(m, M(sx * w / 2, h / 2, 0)), tn, o);
        R.add('stone', KG.slab(0.22, 0.08, 0.22, 0.015), mul(m, M(sx * w / 2, 0.04, 0)), '#aaa395', o);
        // a foot across, so the frame stands by itself
        R.add('wood', rY(KG.timber(0.6, 0.07, 0.07, 0.008), PI / 2), mul(m, M(sx * w / 2, 0.12, 0)), tn, o);
      }
      R.add('wood', KG.timber(w + 0.2, 0.09, 0.09, 0.01), mul(m, M(0, h - 0.045, 0)), tn, o);
      rows.forEach((y, ri) => {
        const p0 = v3(m, -w / 2 - 0.1, y, 0), p1 = v3(m, w / 2 + 0.1, y, 0);
        R.add('wood', geo.tube(p0.x, p0.y, p0.z, p1.x, p1.y, p1.z, 0.028, 8), null, '#9b7a55', o);
        const pv = v3(m, 0, y, 0);
        const Sa = sway(R, { x: pv.x, y: pv.y, z: pv.z, amp: 0.05, speed: 0.48 + ri * 0.11, axis }), Sb = sway(R, { x: pv.x, y: pv.y, z: pv.z, amp: 0.042, speed: 0.57 + ri * 0.09, axis });
        for (let k = 0; k < per; k++) {
          const S = k % 2 ? Sb : Sa, u = -w / 2 + 0.24 + ((w - 0.48) * k) / Math.max(1, per - 1) + (R.rnd() - 0.5) * 0.04;
          const len = 0.16 + R.rnd() * 0.1, top = y - 0.025, cy = top - len - 0.1;
          const pa = v3(m, u, top, 0), pb = v3(m, u, cy + 0.09, 0);
          S.add('straw', geo.tube(pa.x, pa.y, pa.z, pb.x, pb.y, pb.z, 0.0065, 4), null, '#c4a35d');
          S.add('straw', new THREE.SphereGeometry(0.018, 5, 4), mul(m, M(u, cy + 0.1, 0)), '#d6bc7c');
          mejuBlock(S, mul(m, M(u, cy, 0, (R.rnd() - 0.5) * 0.5)), R.rnd);
          spots.push(v3(m, u, cy, 0.12));
        }
        Sa.done(); Sb.done();
      });
      R.planItem?.(num(o.x, 0), num(o.z, 0), Math.abs(Math.cos(ry)) > 0.5 ? w : 0.6, Math.abs(Math.cos(ry)) > 0.5 ? 0.6 : w);
      return { spots };
    }
    function strawBed(R, m, w, d, y, n, o) {
      // a bed of straw: a mat, then loose straws crossing it
      R.add('straw', KG.slab(w, 0.035, d, 0.012), mul(m, M(0, y + 0.017, 0)), '#d8bd78', o);
      for (let i = 0; i < n; i++) {
        const a = (R.rnd() - 0.5) * 0.9, len = 0.35 + R.rnd() * 0.4, x = (R.rnd() - 0.5) * (w - 0.2), z = (R.rnd() - 0.5) * (d - 0.1);
        const g = KG.timber(len, 0.006, 0.012, 0.001); rY(g, a);
        R.add('straw', g, mul(m, M(x, y + 0.038 + R.rnd() * 0.01, z)), R.rnd() < 0.5 ? '#e2c886' : '#c9aa63', { ...o, cast: false });
      }
    }
    function mejuBed(R, o = {}) {
      const w = num(o.w, 2.4), d = num(o.d, 0.8), h = num(o.h, 0.5), m = base(R, o), n = Math.max(1, Math.round(num(o.n, 6))), spots = [];
      table(R, { m, x: num(o.x, 0), z: num(o.z, 0), w, d, h, tone: o.tone || '#7d5b3c', apron: true });
      strawBed(R, m, w - 0.06, d - 0.06, h, 46, o);
      for (let k = 0; k < n; k++) {
        const u = -w / 2 + 0.28 + ((w - 0.56) * k) / Math.max(1, n - 1), zz = (k % 2 ? 0.12 : -0.12) * (d / 0.8);
        const bm = mul(m, M(u, h + 0.035 + 0.075, zz, (R.rnd() - 0.5) * 0.5));
        mejuBlock(R, bm, R.rnd, o);
        // a few straws laid over the block
        for (let s = 0; s < 3; s++) { const g = KG.timber(0.32, 0.006, 0.012, 0.001); rY(g, (R.rnd() - 0.5) * 1.2); R.add('straw', g, mul(bm, M((R.rnd() - 0.5) * 0.06, 0.082, (R.rnd() - 0.5) * 0.06)), '#e0c47f', { ...o, cast: false }); }
        spots.push(v3(m, u, h + 0.2, zz));
      }
      return { top: num(o.y, 0) + h + 0.2, spots };
    }
    function nurukTray(T, o = {}) {
      const r = num(o.r, 0.3), m = base(T, o), n = Math.max(1, Math.round(num(o.n, 6))), rnd = T.rnd || Math.random;
      T.add('basket', KG.lathe([[0, 0], [r * 0.86, 0], [r, 0.05], [r * 0.97, 0.056], [r * 0.84, 0.01], [0, 0.01]], 18), m, '#c49a58', o);
      const cake = [[0, 0], [0.07, 0], [0.078, 0.01], [0.078, 0.034], [0.07, 0.044], [0, 0.047]];
      for (let k = 0; k < n; k++) {
        const a = (k / Math.max(1, n - 1)) * TAU + 0.3, rr = k === n - 1 ? 0 : r * 0.55;
        T.add('clay', KG.lathe(cake, 12), mul(m, M(Math.cos(a) * rr, 0.011, Math.sin(a) * rr, rnd() * 3, 1 + (rnd() - 0.5) * 0.1, 0.9 + rnd() * 0.2)), rnd() < 0.5 ? '#d2b37f' : '#c7a46c', o);
      }
      return { top: num(o.y, 0) + 0.06 };
    }
    function nurukRack(R, o = {}) {
      const w = num(o.w, 1.3), d = num(o.d, 0.5), h = num(o.h, 1.6), levels = Math.max(1, Math.round(num(o.levels, 4))), m = base(R, o), spots = [];
      const lv = shelf(R, { m, x: num(o.x, 0), z: num(o.z, 0), w, d, h, levels, back: true, tone: o.tone || '#6e4a2f' });
      lv.forEach((sp, i) => {
        const n = Math.max(1, Math.floor(w / 0.62));
        for (let k = 0; k < n; k++) {
          const lu = -w / 2 + (w * (k + 0.5)) / n, p = v3(m, lu, 0, 0), pm = mul(M(p.x, sp.y, p.z, num(o.rotY, 0)), M(0, 0, 0, 0, 1));
          nurukTray(R, { m: pm, r: Math.min(0.3, w / n / 2 - 0.02), n: 5 + (i % 2) });
        }
        spots.push({ x: sp.x, y: sp.y + 0.12, z: sp.z });
      });
      return { spots };
    }
    /** 버선 silhouette (toe to the right, curling up), w × h, facing +Z */
    function beoseon(w, h) {
      const s = new THREE.Shape();
      s.moveTo(-0.5 * w, 0.5 * h); s.lineTo(-0.12 * w, 0.5 * h); s.lineTo(-0.1 * w, 0.02 * h);
      s.quadraticCurveTo(0.2 * w, -0.06 * h, 0.42 * w, 0.06 * h); s.quadraticCurveTo(0.52 * w, 0.12 * h, 0.5 * w, 0.2 * h);
      s.quadraticCurveTo(0.42 * w, -0.4 * h, 0.05 * w, -0.5 * h); s.quadraticCurveTo(-0.42 * w, -0.52 * h, -0.5 * w, -0.2 * h); s.lineTo(-0.5 * w, 0.5 * h);
      const g = new THREE.ShapeGeometry(s, 6), p = g.attributes.position, uv = g.attributes.uv;
      for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i), p.getY(i));
      return g;
    }
    function geumjul(R, o = {}) {
      const s = num(o.s, 1), kind = o.kind || 'dok', pr = BK.JAR_PROFILES[kind] || BK.JAR_PROFILES.dok, m = mul(base(R, o), M(0, 0, 0, 0, s));
      // the neck: the narrowest point of the upper third; the belly: the widest
      let neck = pr[0], belly = pr[0];
      const top = BK.jarTop(kind);
      for (const p of pr) { if (p[1] > top * 0.7 && p[1] < top * 0.97 && (neck === pr[0] || p[0] < neck[0])) neck = p; if (p[0] > belly[0]) belly = p; }
      const ny = num(o.ny, neck[1] - 0.01), nr = num(o.nr, neck[0] + 0.012);
      R.add('straw', new THREE.TorusGeometry(nr, 0.02, 6, 30).applyMatrix4(new THREE.Matrix4().makeRotationX(PI / 2)), mul(m, M(0, ny, 0)), '#c4a258', o);
      R.add('straw', new THREE.TorusGeometry(nr + 0.006, 0.008, 4, 30).applyMatrix4(new THREE.Matrix4().makeRotationX(PI / 2)), mul(m, M(0, ny - 0.014, 0, 0.3)), '#d6b770', { ...o, cast: false });
      // tucked into the rope: 숯 and 고추 in turn, round the front half
      const n = num(o.n, 8);
      for (let k = 0; k < n; k++) {
        const a = -PI * 0.15 + (k / (n - 1)) * PI * 1.3, cx = Math.sin(a) * (nr + 0.012), cz = Math.cos(a) * (nr + 0.012);
        const pm = mul(m, M(cx, ny - 0.02, cz, a));
        if (k % 2) {   // a dried red pepper hanging down
          const g = KG.lathe([[0, 0], [0.012, 0.02], [0.016, 0.07], [0.013, 0.1], [0.006, 0.11], [0, 0.11]], 8); rX(g, PI);
          R.add('paint', g, mul(pm, M(0, 0.03, 0.014, 0, 1, 1, 1, 0.12)), '#9d1d17', o);
          R.add('paint', geo.cyl(0.004, 0.004, 0.025, 4), mul(pm, M(0, 0.04, 0.014)), '#4f5a2a', { ...o, cast: false });
        } else R.add('paint', new THREE.DodecahedronGeometry(0.04, 0).scale(1.2, 0.8, 0.7), mul(pm, M(0, -0.01, 0.025, 0.4)), '#1c1a19', o);
      }
      // the 버선본: a paper sock cut from 한지, stuck upside down on the belly
      const by = num(o.by, belly[1] - 0.06), br = belly[0] + 0.004, ba = num(o.beoseonA, 0);
      R.add('hanji', beoseon(0.2, 0.17), mul(m, M(Math.sin(ba) * br, by, Math.cos(ba) * br, ba, 1, 1, 1, 0, PI)), '#f6efdd', { ...o, cast: false });
      const pf = v3(m, 0, ny, nr + 0.05);
      return { x: pf.x, y: pf.y, z: pf.z };
    }
    function kimchiPit(R, o = {}) {
      const w = num(o.w, 1.9), d = num(o.d, 1.5), m = base(R, o), jars = [];
      // the mound of earth heaped round the buried jars, straw over it, stones round its foot
      const dome = KG.lathe([[1.0, 0], [0.96, 0.04], [0.8, 0.15], [0.55, 0.27], [0.25, 0.33], [0, 0.34]], 18);
      R.add('earth', dome, mul(m, M(0, 0, 0, 0, w / 2, 1, d / 2)), '#8f7052', o);
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * TAU, rr = 1.0 + R.rnd() * 0.05;
        R.add('stone', new THREE.IcosahedronGeometry(0.075 + R.rnd() * 0.04, 0).scale(1.2, 0.6, 1), mul(m, M(Math.cos(a) * w / 2 * rr, 0.03, Math.sin(a) * d / 2 * rr, R.rnd() * 3)), '#aaa294', o);
      }
      for (let i = 0; i < 70; i++) {
        const a = R.rnd() * TAU, rr = Math.sqrt(R.rnd()) * 0.95, x = Math.cos(a) * rr * w / 2, z = Math.sin(a) * rr * d / 2;
        const y = 0.34 * (1 - Math.pow(rr, 2.2)) + 0.012;
        const g = KG.timber(0.3 + R.rnd() * 0.3, 0.006, 0.013, 0.001); rY(g, R.rnd() * PI); rZ(g, (R.rnd() - 0.5) * 0.3);
        R.add('straw', g, mul(m, M(x, y, z)), R.rnd() < 0.5 ? '#d9bf7c' : '#c3a35f', { ...o, cast: false });
      }
      const list = o.jars || [{ kind: 'dok', x: -w * 0.18, z: -d * 0.08, s: 0.9 }, { kind: 'jungduri', x: w * 0.25, z: d * 0.14, s: 0.78 }];
      for (const j of list) {
        const kind = j.kind || 'dok', s = num(j.s, 0.9), top = BK.jarTop(kind) * s, sink = top * 0.58;
        const jm = mul(m, M(j.x, 0.3 - sink, j.z, R.rnd() * 3, s));
        R.add('onggi', KG.lathe(BK.JAR_PROFILES[kind], 20), jm, '#5c3a27', o);
        // 짚방석: a straw lid, then a stone to hold it down
        const rim = BK.JAR_PROFILES[kind][BK.JAR_PROFILES[kind].length - 3][0] * s;
        R.add('straw', KG.lathe([[0, 0], [rim + 0.06, 0], [rim + 0.09, 0.03], [rim + 0.05, 0.065], [0, 0.075]], 18), mul(m, M(j.x, 0.3 - sink + top - 0.015, j.z)), '#cfb06a', o);
        R.add('stone', new THREE.IcosahedronGeometry(0.08, 0).scale(1.2, 0.6, 1), mul(m, M(j.x + 0.03, 0.3 - sink + top + 0.07, j.z - 0.02, 0.7)), '#9f988a', o);
        const p = v3(m, j.x, 0.3 - sink + top + 0.1, j.z);
        jars.push({ x: p.x, y: p.y, z: p.z });
      }
      R.planItem?.(num(o.x, 0), num(o.z, 0), w, d, 'rgba(120,90,60,.8)');
      return { jars, top: num(o.y, 0) + 0.5 };
    }

    // ---------------------------------------------------------------- 뒤주 · 가마니 · 섬 · 멍석
    function dwiju(R, o = {}) {
      const w = num(o.w, 0.95), d = num(o.d, 0.62), h = num(o.h, 0.95), m = base(R, o), tone = o.tone || '#7d4f30';
      chest(R, { m, x: num(o.x, 0), z: num(o.z, 0), w, d, h, doors: 0, drawers: 0, legs: 0.24, fittings: 'iron', tone, frameTone: '#4e2f1c' });
      // the top lid (윗닫이): its front half lifts — a raised board, two hinges and a hasp with a lock
      R.add('furn', KG.slab(w - 0.12, 0.025, d / 2 - 0.04, 0.006), mul(m, M(0, h + 0.042, d / 4 - 0.01)), '#8a5a38', o);
      for (const sx of [-0.28, 0.28]) R.add('iron', KG.slab(0.07, 0.006, 0.09, 0.002), mul(m, M(sx * w, h + 0.057, 0.0)), '#2f2f31', o);
      R.add('iron', KG.slab(0.07, 0.11, 0.008, 0.002), mul(m, M(0, h - 0.02, d / 2 + 0.012)), '#2f2f31', o);
      R.add('brass', KG.slab(0.09, 0.04, 0.025, 0.006), mul(m, M(0, h - 0.07, d / 2 + 0.03)), '#b48d3c', o);
      return { w, d, top: num(o.y, 0) + h + 0.06 };
    }
    function gamani(T, m, o) {
      T.add('straw', pillow(0.92, 0.34, 0.56, 0.36, 0.55, 18), m, o?.tint || (T.rnd() < 0.5 ? '#d3b878' : '#c8ab68'), o);
      for (const sx of [-0.3, 0.3]) T.add('straw', new THREE.TorusGeometry(1, 0.05, 4, 16).scale(0.29, 0.178, 1).applyMatrix4(new THREE.Matrix4().makeRotationY(PI / 2)), mul(m, M(sx, 0, 0)), '#b18f4a', { ...o, cast: false });
    }
    function gamaniStack(R, o = {}) {
      const rows = o.rows || [3, 2, 1], m = base(R, o);
      let maxN = 0;
      rows.forEach((n, l) => {
        maxN = Math.max(maxN, n);
        for (let k = 0; k < n; k++) gamani(R, mul(m, M((k - (n - 1) / 2) * 0.6, 0.16 + l * 0.29, (l % 2 ? 0.03 : -0.02) + (R.rnd() - 0.5) * 0.04, PI / 2 + (R.rnd() - 0.5) * 0.12)), o);
      });
      const w = maxN * 0.6, d = 0.95;
      R.planItem?.(num(o.x, 0), num(o.z, 0), Math.abs(Math.cos(num(o.rotY, 0))) > 0.5 ? w : d, Math.abs(Math.cos(num(o.rotY, 0))) > 0.5 ? d : w, 'rgba(200,170,100,.85)');
      return { w, d, top: num(o.y, 0) + 0.32 + rows.length * 0.29 };
    }
    function seom(R, o = {}) {
      const s = num(o.s, 1), m = mul(base(R, o), M(0, 0, 0, 0, s));
      R.add('straw', pillow(0.56, 0.86, 0.5, 0.5, 0.3, 18), mul(m, M(0, 0.43, 0)), o.tint || '#cfb26f', o);
      for (const y of [0.18, 0.43, 0.68]) R.add('straw', new THREE.TorusGeometry(1, 0.045, 4, 18).scale(0.29, 0.26, 1).applyMatrix4(new THREE.Matrix4().makeRotationX(PI / 2)), mul(m, M(0, y, 0)), '#a98846', { ...o, cast: false });
      R.add('straw', KG.lathe([[0, 0], [0.2, 0], [0.12, 0.08], [0.04, 0.16], [0, 0.17]], 10), mul(m, M(0, 0.84, 0)), '#c0a15c', o);   // the tied top
      return { top: num(o.y, 0) + 1.0 * s };
    }
    function meongseok(R, o = {}) {
      const len = num(o.len, 1.5), r = num(o.r, 0.2), m = base(R, o), up = !!o.upright;
      const g = geo.cyl(r, r, len, 18); if (!up) rZ(g, PI / 2);
      R.add('straw', g, mul(m, M(0, up ? len / 2 : r, 0)), o.tint || '#c9ad6c', o);
      // the rolled end: rings of the mat, darker in the gaps
      for (let k = 1; k <= 4; k++) {
        const ring = geo.ring(r * (k / 4.6), r * (k / 4.6) + 0.012, 18);
        if (up) R.add('straw', ring, mul(m, M(0, len + 0.002, 0)), '#8a6e3c', { ...o, cast: false });
        else for (const sx of [-1, 1]) R.add('straw', rZ(ring.clone(), sx * PI / 2), mul(m, M(sx * (len / 2 + 0.002), r, 0)), '#8a6e3c', { ...o, cast: false });
      }
      for (const t of [-0.3, 0.3]) {
        const tg = new THREE.TorusGeometry(r + 0.008, 0.012, 4, 18);
        if (!up) rY(tg, PI / 2); else rX(tg, PI / 2);
        R.add('straw', tg, mul(m, up ? M(0, len / 2 + t * len, 0) : M(t * len, r, 0)), '#a2843f', { ...o, cast: false });
      }
      return { top: num(o.y, 0) + (up ? len : r * 2) };
    }

    // ---------------------------------------------------------------- tools on the wall, 저울, 되 · 말
    function blade(shape, depth) { const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 8 }); g.translate(0, 0, -depth / 2); const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i), uv.getY(i)); return g; }
    function farmTool(R, kind, m, o = {}) {
      const W = { wall: o.wall }, wood = '#8a6644', iron = '#3b3a3a';
      R.add('furn', geo.cyl(0.014, 0.014, 0.1, 6).applyMatrix4(new THREE.Matrix4().makeRotationX(PI / 2)), mul(m, M(0, 0, 0.05)), '#5c3f28', W);   // the peg
      const at = (x, y, z, ry = 0, rx = 0, rz = 0) => mul(m, M(x, y, z, ry, 1, 1, 1, rx, rz));
      let low = -0.3;
      if (kind === 'homi') {
        R.add('furn', geo.cyl(0.017, 0.015, 0.14, 8), at(0, -0.1, 0.06), wood, W);
        R.add('iron', geo.tube(0, -0.03, 0.06, 0.0, 0.03, 0.045, 0.006, 5), m, iron, W);
        const s = new THREE.Shape(); s.moveTo(0, 0); s.lineTo(0.075, 0.035); s.quadraticCurveTo(0.06, 0.13, 0.0, 0.2); s.quadraticCurveTo(-0.05, 0.1, -0.035, 0.04); s.lineTo(0, 0);
        R.add('iron', blade(s, 0.005), at(0, 0.03, 0.04), iron, W);
        low = -0.19;
      } else if (kind === 'nat') {
        R.add('furn', geo.cyl(0.017, 0.016, 0.36, 8), at(0, -0.15, 0.06), wood, W);
        const s = new THREE.Shape(); s.absarc(0, 0, 0.17, 0.05, PI * 0.75, false); s.absarc(0.012, -0.02, 0.145, PI * 0.73, 0.06, true);
        R.add('iron', blade(s, 0.004), at(-0.01, -0.11, 0.06, 0, 0, 0.35), iron, W);
        low = -0.34;
      } else if (kind === 'soeseurang') {
        R.add('furn', geo.cyl(0.02, 0.02, 1.3, 8), at(0, -0.62, 0.07), wood, W);
        R.add('iron', KG.timber(0.26, 0.03, 0.02, 0.004), at(0, 0.06, 0.07), iron, W);
        for (let k = 0; k < 4; k++) {
          const x = -0.105 + k * 0.07;
          R.add('iron', geo.tube(x, 0.06, 0.07, x, 0.2, 0.09, 0.006, 4), m, iron, W);
          R.add('iron', geo.tube(x, 0.2, 0.09, x, 0.25, 0.14, 0.005, 4), m, iron, W);
        }
        low = -1.28;
      } else if (kind === 'dorikkae') {
        R.add('furn', geo.cyl(0.02, 0.022, 1.45, 8), at(0, -0.68, 0.06), wood, W);
        R.add('furn', geo.cyl(0.03, 0.03, 0.06, 8).applyMatrix4(new THREE.Matrix4().makeRotationX(PI / 2)), at(0, 0.03, 0.075), '#5c3f28', W);   // 꼭지 (the swivel)
        for (let k = 0; k < 3; k++) R.add('furn', geo.tube(-0.03 + k * 0.03, 0.02, 0.11, -0.05 + k * 0.05, -0.92, 0.115 + k * 0.01, 0.009, 5), m, '#a2805a', W);   // 아들 (the beating rods)
        R.add('straw', new THREE.TorusGeometry(0.06, 0.008, 4, 10).applyMatrix4(new THREE.Matrix4().makeRotationX(PI / 2)), at(0, -0.5, 0.11), '#a98846', W);
        low = -1.4;
      }
      const p = v3(m, 0, low / 2, 0.12);
      return { x: p.x, y: p.y, z: p.z, low };
    }
    function jeoul(R, m, o = {}) {
      const W = { wall: o.wall }, len = 0.78, fx = -0.22;   // the cord holds the beam 0.22 m from its centre (the pan side)
      R.add('furn', geo.cyl(0.014, 0.014, 0.1, 6).applyMatrix4(new THREE.Matrix4().makeRotationX(PI / 2)), mul(m, M(0, 0, 0.05)), '#5c3f28', W);
      const by = -0.26, bz = 0.1;
      R.add('cloth', geo.tube(0, 0, 0.09, fx, by, bz, 0.004, 4), m, '#8a7656', W);
      R.add('furn', rZ(geo.cyl(0.011, 0.014, len, 8), PI / 2), mul(m, M(0, by, bz)), '#4e3320', W);
      for (let k = 0; k < 12; k++) R.add('brass', geo.cyl(0.0125, 0.0125, 0.004, 6).applyMatrix4(new THREE.Matrix4().makeRotationZ(PI / 2)), mul(m, M(-0.1 + k * 0.042, by, bz)), '#c9a24a', { ...W, cast: false });
      // the pan on three cords from the short end
      const px = -len / 2 + 0.02, py = by - 0.34;
      for (let k = 0; k < 3; k++) { const a = (k / 3) * TAU; R.add('cloth', geo.tube(px, by, bz, px + Math.cos(a) * 0.12, py + 0.03, bz + Math.sin(a) * 0.12, 0.003, 3), m, '#8a7656', W); }
      R.add('brass', KG.lathe([[0, 0], [0.1, 0.005], [0.14, 0.03], [0.135, 0.033], [0.095, 0.012], [0, 0.008]], 16), mul(m, M(px, py, bz)), '#a8843a', W);
      R.add('paint', KG.lathe([[0.11, 0], [0.1, 0.012], [0.05, 0.04], [0, 0.05]], 12), mul(m, M(px, py + 0.01, bz)), '#d9c68f', W);   // beans in the pan
      // the weight (추) on a loop further out
      const wx = 0.28;
      R.add('cloth', geo.tube(wx, by, bz, wx, by - 0.12, bz, 0.003, 3), m, '#8a7656', W);
      R.add('iron', KG.lathe([[0, 0], [0.03, 0.005], [0.045, 0.04], [0.035, 0.07], [0.012, 0.08], [0, 0.08]], 10), mul(m, M(wx, by - 0.2, bz)), '#2e2d2c', W);
      const p = v3(m, 0, by - 0.1, bz + 0.15);
      return { x: p.x, y: p.y, z: p.z };
    }
    const GRAIN = { rice: '#efe7d0', bean: '#d8c48d', barley: '#cdb27a', millet: '#d9b44a', red: '#8a2f22' };
    function doe(T, o = {}) {
      const m = base(T, o), mal = o.kind === 'mal', fill = GRAIN[o.fill] || o.fill || GRAIN.rice, op = { wall: o.wall };
      if (mal) {
        const r = 0.19, h = 0.26;
        T.add('furn', KG.lathe([[0, 0], [r, 0], [r, h], [r - 0.015, h], [r - 0.015, 0.02], [0, 0.02]], 18), m, '#8d6745', op);
        for (const y of [0.05, h - 0.05]) T.add('iron', new THREE.TorusGeometry(r + 0.004, 0.006, 4, 18).applyMatrix4(new THREE.Matrix4().makeRotationX(PI / 2)), mul(m, M(0, y, 0)), '#3a3a3c', { ...op, cast: false });
        T.add('paint', KG.lathe([[r - 0.02, 0.0], [0.1, 0.05], [0, 0.07]], 14), mul(m, M(0, h - 0.04, 0)), fill, { ...op, cast: false });
        return { top: num(o.y, 0) + h + 0.03 };
      }
      const a = 0.21, h = 0.12, t = 0.014;
      T.add('furn', KG.slab(a, t, a, 0.003), mul(m, M(0, t / 2, 0)), '#8d6745', op);
      for (const [x, z, ry] of [[0, a / 2 - t / 2, 0], [0, -a / 2 + t / 2, 0], [a / 2 - t / 2, 0, PI / 2], [-a / 2 + t / 2, 0, PI / 2]]) T.add('furn', KG.slab(a, h, t, 0.003), mul(m, M(x, h / 2, z, ry)), '#966f4b', op);
      T.add('paint', KG.lathe([[0.1, 0.0], [0.06, 0.04], [0, 0.05]], 12), mul(m, M(0, h - 0.035, 0, 0, 1, 1, 1)), fill, { ...op, cast: false });
      return { top: num(o.y, 0) + h + 0.02 };
    }
    function jangjak(R, o = {}) {
      const w = num(o.w, 1.3), hh = num(o.h, 0.75), d = num(o.d, 0.45), m = base(R, o);
      const rows = Math.max(2, Math.round(hh / 0.13));
      for (let l = 0; l < rows; l++) {
        const span = w * (1 - l * 0.05), n = Math.max(2, Math.round(span / 0.13));
        for (let k = 0; k < n; k++) {
          const x = -span / 2 + (span * (k + 0.5)) / n + (R.rnd() - 0.5) * 0.03, y = 0.065 + l * 0.118, r = 0.05 + R.rnd() * 0.02, len = d * (0.85 + R.rnd() * 0.25);
          const g = geo.cyl(r, r * (0.9 + R.rnd() * 0.15), len, 6); rX(g, PI / 2); rZ(g, R.rnd() * 3);
          R.add('wood', g, mul(m, M(x, y, (R.rnd() - 0.5) * 0.06)), R.rnd() < 0.5 ? '#9a7a58' : '#86674a', o);
          // the split face: paler wood on a log end
          R.add('furn', geo.disc(r * 0.92, 6), mul(m, M(x, y, len / 2 + 0.002, 0, 1, 1, 1, PI / 2)), '#c9a57a', { ...o, cast: false });
        }
      }
      R.planItem?.(num(o.x, 0), num(o.z, 0), Math.abs(Math.cos(num(o.rotY, 0))) > 0.5 ? w : d, Math.abs(Math.cos(num(o.rotY, 0))) > 0.5 ? d : w, 'rgba(130,95,60,.85)');
      return { w, d, top: num(o.y, 0) + 0.065 + rows * 0.118 };
    }
    function gongi(R, o = {}) {
      const len = num(o.len, 1.15), m = mul(base(R, o), M(0, 0, 0, 0, 1, 1, 1, 0, num(o.lean, 0.22)));
      R.add('furn', KG.lathe([[0, 0], [0.055, 0], [0.062, 0.04], [0.058, len * 0.3], [0.033, len * 0.42], [0.028, len * 0.55], [0.033, len * 0.68], [0.058, len * 0.8], [0.062, len * 0.96], [0.05, len], [0, len]], 12), m, o.tint || '#a07c55', o);
    }
    function jori(T, m, o = {}) {
      const W = { wall: o.wall }, one = (mm) => {
        const g = geo.grid(8, 6, (i, j, out) => { const u = i / 8 - 0.5, v = j / 6; const r = Math.sin(v * PI * 0.92 + 0.12); out[0] = u * 0.17 * r; out[1] = -v * 0.2; out[2] = (0.25 - u * u) * 0.17 * r + 0.004; out[3] = u * 0.3; out[4] = v * 0.3; });
        T.add('basket', g, mm, '#c8a660', W);
        T.add('basket', geo.cyl(0.012, 0.016, 0.22, 6), mul(mm, M(0, 0.1, 0.012)), '#b58f4c', W);
      };
      if (o.pair) {
        one(mul(m, M(-0.06, -0.02, 0, 0, 1, 1, 1, 0, 0.18)));
        one(mul(m, M(0.06, -0.02, 0.01, 0, 1, 1, 1, 0, -0.18)));
        T.add('paint', new THREE.TorusGeometry(0.03, 0.006, 4, 10), mul(m, M(0, 0.17, 0.02)), '#b2241c', W);
        T.add('paint', geo.tube(0, 0.2, 0.02, 0, 0.02, 0.01, 0.003, 3), m, '#b2241c', W);
      } else one(m);
    }

    // ---------------------------------------------------------------- strings under the rafters
    function hangCord(T, x, y0, y1, z, tn = '#bfa060') { T.add('straw', geo.tube(x, y0, z, x, y1, z, 0.006, 4), null, tn); }
    function siraegi(T, o = {}) {
      const x = num(o.x, 0), y = num(o.y, 2.3), z = num(o.z, 0), len = num(o.len, 0.55), rnd = T.rnd || Math.random;
      hangCord(T, x, y, y - 0.08, z);
      for (let k = 0; k < 14; k++) {
        const a = rnd() * TAU, l = len * (0.7 + rnd() * 0.4), g = KG.timber(l, 0.035 + rnd() * 0.02, 0.006, 0.001);
        rZ(g, PI / 2 + (rnd() - 0.5) * 0.35); rY(g, a);
        T.add('paint', g, M(x + Math.cos(a) * 0.03, y - 0.08 - l / 2, z + Math.sin(a) * 0.03), rnd() < 0.5 ? '#7b7646' : '#6a6a3d');
      }
      T.add('straw', new THREE.TorusGeometry(0.035, 0.012, 4, 10).applyMatrix4(new THREE.Matrix4().makeRotationX(PI / 2)), M(x, y - 0.08, z), '#b49450');
    }
    function gochu(T, o = {}) {
      const x = num(o.x, 0), y = num(o.y, 2.3), z = num(o.z, 0), n = Math.round(num(o.n, 14)), rnd = T.rnd || Math.random;
      const len = n * 0.045 + 0.1;
      hangCord(T, x, y, y - len, z, '#a88a50');
      const g0 = KG.lathe([[0, 0], [0.013, 0.02], [0.017, 0.06], [0.014, 0.095], [0.007, 0.11], [0, 0.112]], 7); rX(g0, PI);
      for (let k = 0; k < n; k++) {
        const a = k * 2.2 + rnd(), yy = y - 0.08 - k * 0.045;
        T.add('paint', g0.clone(), mul(M(x, yy, z, a), M(0.012, 0, 0, 0, 1, 1, 1, 0, 0.5 + rnd() * 0.3)), rnd() < 0.3 ? '#8a1712' : rnd() < 0.5 ? '#a3221a' : '#951c15');
      }
      g0.dispose();
    }
    function maneul(T, o = {}) {
      const x = num(o.x, 0), y = num(o.y, 2.3), z = num(o.z, 0), rnd = T.rnd || Math.random;
      hangCord(T, x, y, y - 0.12, z);
      for (let k = 0; k < 12; k++) {
        const a = k * 1.9, yy = y - 0.18 - Math.floor(k / 3) * 0.075, rr = 0.045;
        const b = new THREE.SphereGeometry(0.036, 8, 6); b.scale(1, 0.82, 1);
        T.add('paint', b, M(x + Math.cos(a) * rr, yy, z + Math.sin(a) * rr), rnd() < 0.5 ? '#e8dfca' : '#ddd0b4');
        T.add('straw', geo.tube(x + Math.cos(a) * rr, yy + 0.03, z + Math.sin(a) * rr, x, y - 0.12, z, 0.006, 3), null, '#c2ab74');
      }
    }
    function corn(T, o = {}) {
      const x = num(o.x, 0), y = num(o.y, 2.3), z = num(o.z, 0), rnd = T.rnd || Math.random;
      hangCord(T, x, y, y - 0.1, z);
      const cob = [[0, 0], [0.026, 0.02], [0.03, 0.1], [0.027, 0.17], [0.016, 0.21], [0, 0.215]];
      for (const sx of [-1, 1]) {
        const m = mul(M(x + sx * 0.03, y - 0.1, z), M(0, 0, 0, 0, 1, 1, 1, 0, PI + sx * 0.12));
        T.add('paint', KG.lathe(cob, 9), mul(m, M(0, 0.04, 0)), rnd() < 0.5 ? '#d9a62c' : '#cf9a26');
        for (let k = 0; k < 4; k++) { const g = KG.timber(0.14, 0.03, 0.004, 0.001); rZ(g, PI / 2); rY(g, k * PI / 2 + 0.3); T.add('straw', g, mul(m, M(Math.cos(k * PI / 2) * 0.02, -0.04, Math.sin(k * PI / 2) * 0.02, 0, 1, 1, 1, 0, (k % 2 ? 0.3 : -0.3))), '#e6d9a6'); }
      }
    }
    function herbs(T, o = {}) {
      const x = num(o.x, 0), y = num(o.y, 2.3), z = num(o.z, 0), rnd = T.rnd || Math.random, tn = o.tint || '#6f7346', len = num(o.len, 0.36);
      hangCord(T, x, y, y - 0.06, z);
      T.add('straw', new THREE.TorusGeometry(0.03, 0.01, 4, 10).applyMatrix4(new THREE.Matrix4().makeRotationX(PI / 2)), M(x, y - 0.07, z), '#a98846');
      for (let k = 0; k < 11; k++) {
        const a = rnd() * TAU, l = len * (0.75 + rnd() * 0.4), g = KG.timber(l, 0.022 + rnd() * 0.02, 0.005, 0.001);
        rZ(g, PI / 2 + (rnd() - 0.5) * 0.5); rY(g, a);
        T.add('paint', g, M(x + Math.cos(a) * 0.025, y - 0.07 - l / 2, z + Math.sin(a) * 0.025), shade(tn, 0.8 + rnd() * 0.35));
      }
    }

    // ---------------------------------------------------------------- 그을음: smoke-darkened patches, one mesh
    function soot(R, list, o = {}) {
      const tex = G.gfx.canvasTexture(128, 128, (c, w, h) => {
        const g = c.createRadialGradient(w / 2, h / 2, 2, w / 2, h / 2, w / 2);
        g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(0.45, 'rgba(0,0,0,0.72)'); g.addColorStop(1, 'rgba(0,0,0,0)');
        c.fillStyle = g; c.fillRect(0, 0, w, h);
      });
      R.ctx.own(tex);
      const parts = [];
      for (const q of list || []) {
        if (q.roof) {
          // a strip under the rafters from x0 to x1, following both slopes (R.roofY), a little below their undersides
          const n = 16, x0 = num(q.x0, -1), x1 = num(q.x1, 1), z0 = num(q.z0, -R.d / 2), z1 = num(q.z1, R.d / 2);
          const g = geo.grid(1, n, (i, j, out) => { const z = lerp(z0, z1, j / n); out[0] = lerp(x0, x1, i); out[1] = R.roofY(z) - 0.035; out[2] = z; out[3] = i; out[4] = j / n; });
          parts.push(g);
        } else if (q.m) {
          const g = new THREE.PlaneGeometry(num(q.w, 1), num(q.h, 1)); g.applyMatrix4(q.m); parts.push(g);
        }
      }
      if (!parts.length) return null;
      for (const g of parts) { if (!g.index) g.setIndex([...Array(g.attributes.position.count).keys()]); for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'uv') g.deleteAttribute(k); }
      const BGU = ADDONS.BufferGeometryUtils, geom = parts.length === 1 ? parts[0] : BGU.mergeGeometries(parts, false);
      const mt = new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(o.color || '#160f0a'), transparent: true, opacity: num(o.alpha, 0.78), depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, fog: false });
      R.ctx.own(mt);
      const mesh = new THREE.Mesh(geom, mt);
      mesh.name = 'room-soot'; mesh.renderOrder = 1; mesh.raycast = () => {}; mesh.userData.guardSkip = true;
      R.addMesh(mesh, null);
      return mesh;
    }

    /** 지게: an A-frame carrier leaning on a wall (two legs, rungs, the 등태 pad, straps); m = its foot, leaning towards -Z */
    function jige(R, o = {}) {
      const m = mul(base(R, o), M(0, 0, 0, 0, 1, 1, 1, -num(o.lean, 0.2))), tn = o.tint || '#8b6a48';
      for (const sx of [-1, 1]) {
        R.add('furn', geo.tube(sx * 0.2, 0, 0, sx * 0.13, 1.45, 0.02, 0.026, 7), m, tn, o);
        R.add('furn', geo.tube(sx * 0.2, 0.55, 0, sx * 0.21, 0.72, 0.36, 0.022, 6), m, tn, o);   // the 가지 (prongs)
      }
      for (const y of [0.3, 0.62, 0.95, 1.25]) { const w = 0.4 - y * 0.05; R.add('furn', geo.tube(-w / 2, y, 0.005, w / 2, y, 0.005, 0.015, 6), m, '#6f5034', o); }
      R.add('straw', K.pillow(0.3, 0.32, 0.06, 0.4, 0.4, 10), mul(m, M(0, 0.85, -0.04)), '#cdb070', o);
      for (const sx of [-0.1, 0.1]) R.add('straw', geo.tube(sx, 1.2, -0.03, sx * 1.4, 0.45, -0.1, 0.012, 4), m, '#b39550', { ...o, cast: false });
      R.add('furn', geo.tube(0.32, 0, 0.25, 0.25, 1.05, 0.05, 0.02, 6), mul(base(R, o), M()), '#6a4a30', o);   // the 작대기 (prop stick)
    }
    /** 싸리비 (a broom of bush clover twigs) leaning, and a pair of 짚신 on the floor */
    function broom(R, o = {}) {
      const m = mul(base(R, o), M(0, 0, 0, 0, 1, 1, 1, -num(o.lean, 0.22)));
      R.add('furn', geo.cyl(0.018, 0.02, 0.75, 6), mul(m, M(0, 0.62, 0)), '#8a6a44', o);
      R.add('straw', KG.lathe([[0, 0], [0.15, 0], [0.08, 0.28], [0.035, 0.32], [0, 0.33]], 10), mul(m, M(0, 0, 0, 0, 1, 1, 0.35)), '#a88b55', o);
      R.add('straw', new THREE.TorusGeometry(0.04, 0.008, 4, 10).applyMatrix4(new THREE.Matrix4().makeRotationX(PI / 2)), mul(m, M(0, 0.27, 0)), '#7a5e34', { ...o, cast: false });
    }
    function jipsin(R, o = {}) {
      const m = base(R, o);
      for (const sx of [-0.07, 0.07]) {
        R.add('straw', K.pillow(0.1, 0.035, 0.26, 0.5, 0.7, 10), mul(m, M(sx, 0.018, (sx > 0 ? 0.03 : 0), sx * 0.6)), '#d4b874', o);
        R.add('straw', new THREE.TorusGeometry(0.035, 0.007, 4, 10).applyMatrix4(new THREE.Matrix4().makeRotationX(PI / 2)), mul(m, M(sx, 0.04, (sx > 0 ? 0.03 : 0) - 0.03, sx * 0.6)), '#b89a58', { ...o, cast: false });
      }
    }
    Object.assign(K, {
      jige, broom, jipsin,
      sway, pillow, buttumak, salgang, chanjang, mulDumeong, dongi, mejuBlock, mejuRack, mejuBed, nurukTray, nurukRack, geumjul,
      kimchiPit, dwiju, gamani, gamaniStack, seom, meongseok, farmTool, jeoul, doe, jangjak, gongi, jori, siraegi, gochu, maneul,
      corn, herbs, soot, strawBed, bowl: bowlAt,
    });
  })();
})();
