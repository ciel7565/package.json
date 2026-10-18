// =============================================================================
// 20-avatar.js — procedural chibi avatars (G.avatar)
//
//   G.avatar.defaultAppearance / options / labels / heightRange
//   G.avatar.normalize(app) -> complete, validated appearance
//   G.avatar.random(seed) -> appearance
//   G.avatar.presets -> 6 bright ready-made kid looks [{id, emoji, label, say, appearance}] (frozen, normalized)
//                       for the easy-mode look picker (title screen / customizer)
//   G.avatar.create(appearance, {shadow=true}) -> rig
//     rig.group (feet at y=0, faces +Z, ~1.45 m), rig.height, rig.headAnchor, rig.handR, rig.handL
//     rig.update(dt, {speed, grounded, vy})      locomotion: idle / walk / run / jump / fall / land; above
//                                                ~5 m/s an IK bounding run + sprint pose (stride grows with
//                                                speed, playback = speed / stride: no foot sliding)
//     rig.gait -> {speed, stride, cadence, fast, sprint}  (read-only; for fx / audio / camera)
//     rig.setAnim(name, {loop, duration, speed, seatY, onEnd})  layered actions
//     rig.stopAction(), rig.currentAction, rig.setAppearance(app), rig.setHeld(name|null),
//     rig.setLookTarget(vec3|null), rig.setExpression(expr, seconds), rig.dispose()
//
// Rendering: every avatar is ONE rigidly skinned mesh (all body parts merged, bone per part)
// + one face decal. Body geometry is cached per style combination and shared between
// avatars; colours come from a per-avatar palette uniform (slot attribute per vertex), so
// 20+ avatars cost ~2 draw calls each and share a single shader program.
// =============================================================================
(function () {
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
  const damp = (l, dt) => 1 - Math.exp(-l * dt);
  const BGU = ADDONS.BufferGeometryUtils;

  // ---------------------------------------------------------------- options / labels
  const OPTIONS = {
    skin: ['#fde3cf', '#f6d0b1', '#efc6a2', '#e6b48d', '#d9a77f', '#c68b62', '#a86d48', '#7d4f33'],
    hair: ['short', 'long', 'bun', 'ponytail', 'buzz', 'curly'],
    hairColor: ['#1f1a18', '#2f2520', '#3a2a20', '#4a3a2c', '#6b4a2e', '#8a5a34', '#b07a45', '#d9b26f', '#b9b4ad', '#6e3b4e'],
    top: ['tshirt', 'hoodie', 'shirt', 'hanbok', 'apron', 'jacket'],
    topColor: ['#f1ece1', '#ffffff', '#e8d9b5', '#f08bb0', '#ff9f6b', '#ffd766', '#9bd27a', '#2f7d4a', '#6fc3df', '#4a78c8', '#2e3f6e', '#8b6fd6', '#d9534f', '#6d8f4e', '#7a5a43', '#3a3d42'],
    bottom: ['pants', 'shorts', 'skirt'],
    bottomColor: ['#2c3540', '#3c3934', '#3f5a3c', '#5a4636', '#2f6f8f', '#3b5ba5', '#7a6a55', '#c9b38f', '#8a3b4b', '#b45a73', '#e9e4da', '#1f1f22'],
    shoes: ['#f5f0e6', '#ffffff', '#2a1d14', '#1f1f22', '#7a4a2c', '#d9534f', '#3b5ba5', '#e2c27a'],
    bag: ['none', 'backpack', 'basket', 'pouch'],
    bagColor: ['#8a5a3b', '#6b4a2e', '#b88a4a', '#2f7d4a', '#3b5ba5', '#d9534f', '#f4c54a', '#3a3d42'],
    accessory: ['none', 'glasses', 'strawhat', 'headband', 'cap', 'beard', 'gat'],
    accessoryColor: ['#1f1f22', '#e2c27a', '#2f7d4a', '#d9534f', '#3b5ba5', '#f4c54a', '#ffffff', '#cfcac2', '#8a5a3b'],
    face: ['smile', 'calm', 'cheer'],
  };
  const COLOR_KEYS = new Set(['skin', 'hairColor', 'topColor', 'bottomColor', 'shoes', 'bagColor', 'accessoryColor']);
  const HEX = /^#[0-9a-f]{6}$/i;

  const LABELS = {
    keys: {
      skin: '피부색', hair: '헤어스타일', hairColor: '머리 색', top: '상의', topColor: '상의 색', bottom: '하의', bottomColor: '하의 색',
      shoes: '신발 색', bag: '가방', bagColor: '가방 색', accessory: '액세서리', accessoryColor: '액세서리 색', face: '표정', height: '키',
    },
    hair: { short: '단발', long: '긴머리', bun: '올림머리', ponytail: '포니테일', buzz: '짧은머리', curly: '곱슬머리' },
    top: { tshirt: '티셔츠', hoodie: '후드티', shirt: '셔츠', hanbok: '한복 저고리', apron: '앞치마', jacket: '재킷' },
    bottom: { pants: '바지', shorts: '반바지', skirt: '치마' },
    bag: { none: '없음', backpack: '백팩', basket: '등바구니', pouch: '크로스 파우치' },
    accessory: { none: '없음', glasses: '안경', strawhat: '밀짚모자', headband: '머리띠', cap: '모자', beard: '수염', gat: '갓' },
    face: { smile: '미소', calm: '차분', cheer: '활짝' },
    height: { 0.9: '아담하게', 0.95: '조금 작게', 1: '보통', 1.05: '조금 크게', 1.1: '크게' },
    anims: {
      idle: '대기', walk: '걷기', run: '달리기', jump: '점프', fall: '낙하', sit: '앉기', wave: '손 흔들기', bow: '인사(절)', clap: '박수',
      thumbsup: '엄지척', point: '가리키기', photo: '브이 포즈', celebrate: '만세', surprise: '깜짝', nod: '끄덕끄덕', heart: '하트',
      dance: '춤추기', think: '생각하기', water: '물 주기', harvest: '수확하기', interact: '살펴보기', talk: '이야기하기',
    },
    colors: {
      '#fde3cf': '밝은 살구', '#f6d0b1': '살구', '#efc6a2': '복숭아', '#e6b48d': '밀색', '#d9a77f': '황갈색', '#c68b62': '구릿빛', '#a86d48': '갈색', '#7d4f33': '짙은 갈색',
      '#1f1a18': '흑색', '#2f2520': '흑갈색', '#3a2a20': '진갈색', '#4a3a2c': '고동색', '#6b4a2e': '밤색', '#8a5a34': '갈색', '#b07a45': '밝은 갈색', '#d9b26f': '금발', '#b9b4ad': '은회색', '#6e3b4e': '와인색',
      '#f1ece1': '미색', '#ffffff': '흰색', '#e8d9b5': '베이지', '#f08bb0': '분홍', '#ff9f6b': '살구 주황', '#ffd766': '노랑', '#9bd27a': '연두', '#2f7d4a': '초록', '#6fc3df': '하늘',
      '#4a78c8': '파랑', '#2e3f6e': '남색', '#8b6fd6': '보라', '#d9534f': '빨강', '#6d8f4e': '올리브', '#7a5a43': '갈색', '#3a3d42': '먹색',
      '#2c3540': '진청', '#3c3934': '먹회색', '#3f5a3c': '진초록', '#5a4636': '흙갈색', '#2f6f8f': '청록', '#3b5ba5': '파랑', '#7a6a55': '카키', '#c9b38f': '모래색',
      '#8a3b4b': '자주', '#b45a73': '장미', '#e9e4da': '아이보리', '#1f1f22': '검정', '#f5f0e6': '아이보리', '#2a1d14': '흑갈색', '#7a4a2c': '갈색', '#e2c27a': '짚색',
      '#8a5a3b': '가죽 갈색', '#b88a4a': '대나무색', '#f4c54a': '황금색', '#cfcac2': '은백색',
    },
  };

  // reference image 3: cream zip jacket, dark green trousers, brown backpack, white sneakers
  const DEFAULT = {
    skin: '#f6d0b1', hair: 'short', hairColor: '#3a2a20', top: 'jacket', topColor: '#ece3cf', bottom: 'pants', bottomColor: '#3f5a3c',
    shoes: '#f5f0e6', bag: 'backpack', bagColor: '#8a5a3b', accessory: 'none', accessoryColor: '#1f1f22', face: 'smile', height: 1,
  };

  function normalize(a) {
    const src = a && typeof a === 'object' ? a : {};
    const out = {};
    for (const k of Object.keys(DEFAULT)) {
      const v = src[k];
      if (k === 'height') { const n = Number(v); out.height = Number.isFinite(n) && v !== null && v !== '' ? clamp(n, 0.9, 1.1) : DEFAULT.height; continue; }
      if (COLOR_KEYS.has(k)) { out[k] = typeof v === 'string' && HEX.test(v) ? v.toLowerCase() : DEFAULT[k]; continue; }
      out[k] = OPTIONS[k] && OPTIONS[k].includes(v) ? v : DEFAULT[k];
    }
    return out;
  }

  // ---------------------------------------------------------------- 6 bright kid looks (easy mode picker)
  const PRESETS_RAW = [
    { id: 'farmer', emoji: '🧑‍🌾', label: '농부 친구', say: '밀짚모자를 쓴 농부 친구예요.',
      app: { skin: '#f6d0b1', hair: 'short', hairColor: '#3a2a20', top: 'apron', topColor: '#9bd27a', bottom: 'pants', bottomColor: '#5a4636', shoes: '#7a4a2c', bag: 'basket', bagColor: '#b88a4a', accessory: 'strawhat', accessoryColor: '#e2c27a', face: 'cheer', height: 1 } },
    { id: 'hanbok', emoji: '👘', label: '한복 친구', say: '분홍 한복을 입은 친구예요.',
      app: { skin: '#fde3cf', hair: 'bun', hairColor: '#1f1a18', top: 'hanbok', topColor: '#f08bb0', bottom: 'skirt', bottomColor: '#b45a73', shoes: '#ffffff', bag: 'pouch', bagColor: '#f4c54a', accessory: 'none', accessoryColor: '#1f1f22', face: 'smile', height: 0.95 } },
    { id: 'explorer', emoji: '🧢', label: '탐험가 친구', say: '빨간 모자를 쓴 탐험가 친구예요.',
      app: { skin: '#efc6a2', hair: 'short', hairColor: '#4a3a2c', top: 'tshirt', topColor: '#ffd766', bottom: 'shorts', bottomColor: '#2f6f8f', shoes: '#d9534f', bag: 'backpack', bagColor: '#3b5ba5', accessory: 'cap', accessoryColor: '#d9534f', face: 'cheer', height: 0.95 } },
    { id: 'cook', emoji: '🧑‍🍳', label: '요리사 친구', say: '하얀 앞치마를 두른 요리사 친구예요.',
      app: { skin: '#e6b48d', hair: 'ponytail', hairColor: '#6b4a2e', top: 'apron', topColor: '#ffffff', bottom: 'pants', bottomColor: '#3b5ba5', shoes: '#f5f0e6', bag: 'none', bagColor: '#8a5a3b', accessory: 'headband', accessoryColor: '#f4c54a', face: 'smile', height: 1 } },
    { id: 'bear', emoji: '🐻', label: '곰돌이 친구', say: '보라색 후드티를 입은 곰돌이 친구예요.',
      app: { skin: '#d9a77f', hair: 'curly', hairColor: '#2f2520', top: 'hoodie', topColor: '#8b6fd6', bottom: 'pants', bottomColor: '#3b5ba5', shoes: '#ffffff', bag: 'backpack', bagColor: '#f4c54a', accessory: 'none', accessoryColor: '#1f1f22', face: 'cheer', height: 0.9 } },
    { id: 'sky', emoji: '🌈', label: '하늘 친구', say: '하늘색 옷에 동그란 안경을 쓴 친구예요.',
      app: { skin: '#f6d0b1', hair: 'long', hairColor: '#8a5a34', top: 'shirt', topColor: '#6fc3df', bottom: 'skirt', bottomColor: '#ffd766', shoes: '#d9534f', bag: 'pouch', bagColor: '#d9534f', accessory: 'glasses', accessoryColor: '#3b5ba5', face: 'smile', height: 1 } },
  ];

  function random(seed) {
    const r = G.util.rng(seed == null ? Math.floor(Math.random() * 1e9) : seed);
    const pick = (arr) => arr[Math.floor(r() * arr.length) % arr.length];
    const wpick = (pairs) => { let tot = 0; for (const p of pairs) tot += p[1]; let x = r() * tot; for (const p of pairs) { x -= p[1]; if (x <= 0) return p[0]; } return pairs[0][0]; };
    const top = wpick([['tshirt', 4], ['hoodie', 3], ['shirt', 3], ['hanbok', 1.6], ['apron', 1], ['jacket', 3]]);
    const bottom = top === 'hanbok' ? wpick([['skirt', 3], ['pants', 2]]) : wpick([['pants', 5], ['shorts', 2], ['skirt', 2]]);
    const hair = bottom === 'skirt' ? wpick([['long', 3], ['bun', 2], ['ponytail', 3], ['short', 2], ['curly', 1]]) : wpick([['short', 4], ['buzz', 2], ['curly', 2], ['ponytail', 1], ['long', 1], ['bun', 0.6]]);
    let accessory = wpick([['none', 9], ['glasses', 3], ['strawhat', 1.4], ['headband', 1], ['cap', 2.2], ['beard', 0.6], ['gat', 0.35]]);
    if (accessory === 'gat' && top !== 'hanbok') accessory = 'none';
    const skinPool = OPTIONS.skin.slice(0, 6);
    return normalize({
      skin: pick(skinPool), hair, hairColor: pick(OPTIONS.hairColor.slice(0, 8)), top, topColor: pick(OPTIONS.topColor), bottom,
      bottomColor: pick(OPTIONS.bottomColor), shoes: pick(OPTIONS.shoes), bag: wpick([['none', 5], ['backpack', 3], ['basket', 1], ['pouch', 2]]),
      bagColor: pick(OPTIONS.bagColor), accessory, accessoryColor: accessory === 'gat' ? '#1f1f22' : pick(OPTIONS.accessoryColor),
      face: pick(OPTIONS.face), height: Math.round((0.92 + r() * 0.16) * 100) / 100,
    });
  }

  // ---------------------------------------------------------------- colour helpers
  const _c1 = new THREE.Color(), _c2 = new THREE.Color(), _hsl = { h: 0, s: 0, l: 0 };
  function lum(hex) { _c1.set(hex); _c1.getHSL(_hsl, THREE.SRGBColorSpace); return _hsl.l; }
  function shade(hex, amt) {
    _c1.set(hex);
    _c2.set(amt < 0 ? '#000000' : '#ffffff');
    _c1.lerp(_c2, Math.abs(amt));
    return '#' + _c1.getHexString(THREE.SRGBColorSpace);
  }
  /** skin reads chalky after ACES tone mapping: a bit more saturation, a touch darker */
  function skinTone(hex) {
    _c1.set(hex); _c1.getHSL(_hsl, THREE.SRGBColorSpace);
    _c1.setHSL(_hsl.h, clamp(_hsl.s * 1.22 + 0.04, 0, 1), _hsl.l * 0.95, THREE.SRGBColorSpace);
    return '#' + _c1.getHexString(THREE.SRGBColorSpace);
  }
  function accentFor(hex) {
    _c1.set(hex); _c1.getHSL(_hsl, THREE.SRGBColorSpace);
    const h = _hsl.h * 360;
    if (_hsl.s < 0.18) return '#b8324a';
    if (h < 25 || h > 320) return '#3b4f9a';      // red/pink top -> indigo goreum
    if (h < 70) return '#b8324a';                 // yellow/orange -> crimson
    if (h < 170) return '#c43c5a';                // green -> 자주
    return '#d64b5d';                             // blue/purple -> red
  }

  // ---------------------------------------------------------------- skeleton (fixed for every avatar)
  // [name, parentIndex, absX, absY, absZ]  (rest pose = zero rotations)
  const BONES = [
    ['root', -1, 0, 0, 0],
    ['hips', 0, 0, 0.46, 0],
    ['spine', 1, 0, 0.49, 0],
    ['neck', 2, 0, 0.80, 0],
    ['head', 3, 0, 0.845, 0],
    ['shL', 2, 0.205, 0.755, 0], ['elL', 5, 0.205, 0.605, 0], ['hdL', 6, 0.205, 0.475, 0],
    ['shR', 2, -0.205, 0.755, 0], ['elR', 8, -0.205, 0.605, 0], ['hdR', 9, -0.205, 0.475, 0],
    ['thL', 1, 0.088, 0.44, 0], ['knL', 11, 0.088, 0.27, 0], ['ftL', 12, 0.088, 0.085, 0],
    ['thR', 1, -0.088, 0.44, 0], ['knR', 14, -0.088, 0.27, 0], ['ftR', 15, -0.088, 0.085, 0],
    ['pony', 4, 0, 1.22, -0.2],
    ['bag', 2, 0, 0.70, -0.15],
    ['fgP', 10, -0.205, 0.43, 0], ['fgV', 10, -0.205, 0.43, 0], ['fgT', 10, -0.205, 0.43, 0],
    ['skirt', 1, 0, 0.52, 0],
  ];
  const B = {};
  BONES.forEach((b, i) => { B[b[0]] = i; });
  const BONE_INV = BONES.map((b) => new THREE.Matrix4().makeTranslation(-b[2], -b[3], -b[4]));
  const IDENTITY = new THREE.Matrix4();

  // proportions
  const R = 0.275, HS = [1.06, 0.97, 1.0], HC = 1.11;   // head radius, head scale, head centre y
  const TZ = 0.78;                                         // torso depth factor
  const TORSO = [[0, 0.43], [0.13, 0.435], [0.158, 0.465], [0.165, 0.53], [0.172, 0.61], [0.178, 0.69], [0.176, 0.735], [0.162, 0.775], [0.125, 0.8], [0.07, 0.815], [0, 0.82]];
  function torsoR(y) {
    for (let i = 1; i < TORSO.length; i++) {
      const a = TORSO[i - 1], b = TORSO[i];
      if (y <= b[1]) return lerp(a[0], b[0], clamp((y - a[1]) / (b[1] - a[1] || 1), 0, 1));
    }
    return 0;
  }
  /** z of the torso front surface at (x, y) (+ outward offset) */
  function surfZ(x, y, off = 0) { const r = torsoR(y) + off; return TZ * Math.sqrt(Math.max(0, r * r - x * x)) + off * 0.3; }

  // ---------------------------------------------------------------- palette slots
  const SLOT = { skin: 0, hair: 1, top: 2, top2: 3, top3: 4, under: 5, bottom: 6, bottom2: 7, shoe: 8, sole: 9, bag: 10, bag2: 11, acc: 12, acc2: 13, white: 14, dark: 15, red: 16, gold: 17, leaf: 18, metal: 19 };
  const NSLOT = 20;
  const ROUGH = [0.6, 0.46, 0.86, 0.8, 0.7, 0.86, 0.82, 0.8, 0.55, 0.72, 0.62, 0.6, 0.5, 0.6, 0.7, 0.5, 0.6, 0.32, 0.72, 0.3];

  function slotColors(app) {
    const out = new Array(NSLOT);
    const topL = lum(app.topColor), botL = lum(app.bottomColor);
    out[SLOT.skin] = skinTone(app.skin);
    out[SLOT.hair] = app.hairColor;
    out[SLOT.top] = app.topColor;
    out[SLOT.top2] = shade(app.topColor, topL > 0.78 ? -0.2 : topL < 0.2 ? 0.22 : -0.22);
    out[SLOT.top3] = accentFor(app.topColor);
    out[SLOT.under] = topL > 0.6 ? '#7a6250' : '#efe8dc';
    out[SLOT.bottom] = app.bottomColor;
    out[SLOT.bottom2] = shade(app.bottomColor, botL < 0.2 ? 0.18 : -0.25);
    out[SLOT.shoe] = app.shoes;
    out[SLOT.sole] = lum(app.shoes) > 0.75 ? '#cfc8bb' : '#f2eee6';
    out[SLOT.bag] = app.bagColor;
    out[SLOT.bag2] = shade(app.bagColor, lum(app.bagColor) < 0.2 ? 0.2 : -0.28);
    out[SLOT.acc] = app.accessoryColor;
    out[SLOT.acc2] = app.accessory === 'strawhat' ? '#8a2f2f' : shade(app.accessoryColor, lum(app.accessoryColor) < 0.2 ? 0.25 : -0.3);
    out[SLOT.white] = '#f4f1ea';
    out[SLOT.dark] = '#26211e';
    out[SLOT.red] = '#d64545';
    out[SLOT.gold] = '#e8b84a';
    out[SLOT.leaf] = '#5aa04a';
    out[SLOT.metal] = '#b8bcc2';
    return out;
  }

  // ---------------------------------------------------------------- geometry helpers
  const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
  function xf(geo, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
    _e.set(rx, ry, rz); _q.setFromEuler(_e); _p.set(x, y, z); _s.set(sx, sy, sz);
    _m4.compose(_p, _q, _s);
    geo.applyMatrix4(_m4);
    return geo;
  }
  const sphere = (r, w = 16, h = 12) => new THREE.SphereGeometry(r, w, h);
  const capsule = (r, len, rs = 8) => new THREE.CapsuleGeometry(r, len, 2, rs);
  const cyl = (rt, rb, h, rs = 14, open = false, ts, tl) => new THREE.CylinderGeometry(rt, rb, h, rs, 1, open, ts ?? 0, tl ?? TAU);
  const torus = (r, t, rs = 5, ts = 18, arc = TAU) => new THREE.TorusGeometry(r, t, Math.min(rs, 5), Math.min(ts, 20), arc);
  const rbox = (w, h, d, rad, seg) => new ADDONS.RoundedBoxGeometry(w, h, d, seg ?? (Math.max(w, h, d) > 0.15 ? 2 : 1), Math.min(rad, w / 2, h / 2, d / 2) * 0.999);
  function lathe(pts, segs = 20, zs = 1) { const g = new THREE.LatheGeometry(pts.map((p) => new THREE.Vector2(p[0], p[1])), segs); if (zs !== 1) xf(g, 0, 0, 0, 0, 0, 0, 1, 1, zs); return g; }
  function tube(points, r, segs = 20, rs = 6) { return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(p[0], p[1], p[2]))), segs, r, rs, false); }
  /** limb capsule between y0 (top) and y1 (bottom) at (x, z) */
  function limb(x, y0, y1, r, z = 0) { return xf(capsule(r, Math.max(0.001, y0 - y1)), x, (y0 + y1) / 2, z); }

  const KEEP = new Set(['position', 'normal', 'uv']);
  class Parts {
    constructor() { this.list = []; }
    add(geo, bone, slot) {
      let g = geo;
      if (!g.index) g = BGU.mergeVertices(g); // safety: all merged parts must be indexed
      for (const k of Object.keys(g.attributes)) if (!KEEP.has(k)) g.deleteAttribute(k);
      if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
      const n = g.attributes.position.count;
      const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4), sl = new Float32Array(n);
      for (let i = 0; i < n; i++) { si[i * 4] = bone; sw[i * 4] = 1; sl[i] = slot; }
      g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
      g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
      g.setAttribute('aSlot', new THREE.Float32BufferAttribute(sl, 1));
      this.list.push(g);
      if (G.avatar && G.avatar._trace) G.avatar._trace.push([BONES[bone][0], slot, g.index ? g.index.count / 3 : n / 3]);
      return g;
    }
    build() {
      const merged = BGU.mergeGeometries(this.list, false);
      for (const g of this.list) g.dispose();
      this.list = [];
      merged.computeBoundingSphere();
      return merged;
    }
  }

  // ---------------------------------------------------------------- hair (deformed sphere shell)
  function hairCoverage(style, yaw, elev) {
    const ay = Math.abs(yaw);
    let fringe, faceW, sideBottom, nape;
    switch (style) {
      case 'long': fringe = 0.3 + 0.03 * Math.cos(yaw * 11); faceW = 1.0; sideBottom = -0.95; nape = -0.95; break;
      case 'bun': fringe = 0.36 + 0.26 * smooth(0.55, 0, ay) - 0.04 * Math.cos(yaw * 9); faceW = 1.12; sideBottom = -0.06; nape = -0.42; break;
      case 'ponytail': fringe = 0.3 + 0.16 * smooth(-0.6, 0.6, yaw) + 0.035 * Math.cos(yaw * 11); faceW = 1.1; sideBottom = -0.12; nape = -0.42; break;
      case 'buzz': fringe = 0.56 + 0.02 * Math.cos(yaw * 6); faceW = 1.28; sideBottom = 0.16; nape = -0.4; break;
      case 'curly': fringe = 0.4; faceW = 1.06; sideBottom = -0.22; nape = -0.5; break;
      default: fringe = 0.31 + 0.032 * Math.cos(yaw * 11); faceW = 1.04; sideBottom = -0.36; nape = -0.55 + 0.06 * Math.cos(yaw * 9); // short (bob)
    }
    const faceCut = smooth(-0.08, 0.08, faceW - ay) * smooth(-0.07, 0.07, fringe - elev);
    const bottom = lerp(sideBottom, nape, smooth(faceW, Math.PI, ay));
    return (1 - faceCut) * smooth(bottom - 0.07, bottom + 0.07, elev);
  }
  function hairShell(style) {
    let g = new THREE.SphereGeometry(1, 42, 32);
    g.deleteAttribute('uv'); g.deleteAttribute('normal');
    g = BGU.mergeVertices(g, 1e-4);
    const pos = g.attributes.position;
    const v = new THREE.Vector3();
    const rIn = R * 0.9;
    const rOut = R * (style === 'buzz' ? 1.03 : style === 'curly' ? 1.06 : 1.08);
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).normalize();
      const yaw = Math.atan2(v.x, v.z), elev = Math.asin(clamp(v.y, -1, 1));
      const cov = hairCoverage(style, yaw, elev);
      let vol = 0.045 * Math.max(0, v.y);
      if (style === 'short') vol += 0.05 * smooth(0.15, -0.3, elev) * smooth(0.8, 1.3, Math.abs(yaw));
      if (style === 'long') vol += 0.03 * smooth(0.1, -0.5, elev);
      const r = lerp(rIn, rOut * (1 + vol), cov);
      pos.setXYZ(i, v.x * r * HS[0], v.y * r * HS[1] + HC, v.z * r * HS[2]);
    }
    g.computeVertexNormals();
    return g;
  }
  function headPoint(yaw, elev, rr) { // point on the head ellipsoid (model space)
    const ce = Math.cos(elev);
    return [Math.sin(yaw) * ce * rr * HS[0], Math.sin(elev) * rr * HS[1] + HC, Math.cos(yaw) * ce * rr * HS[2]];
  }

  /** rotate a model-space geometry around the head centre (hat tilt) */
  function tilt(geo, rx) { xf(geo, 0, -HC, 0); xf(geo, 0, 0, 0, rx, 0, 0); return xf(geo, 0, HC, 0); }

  // ---------------------------------------------------------------- body builder
  const geoCache = new Map();
  function styleSig(app) { return [app.hair, app.top, app.bottom, app.bag, app.accessory].join('|'); }
  const HAT = { strawhat: true, cap: true, gat: true };

  function buildBody(app) {
    const P = new Parts();
    const S = SLOT;
    const top = app.top, bottom = app.bottom, hair = app.hair, acc = app.accessory;
    const hanbok = top === 'hanbok';
    const chima = hanbok && bottom === 'skirt';

    // ---- head, ears, nose, neck
    P.add(xf(sphere(R, 26, 18), 0, HC, 0, 0, 0, 0, HS[0], HS[1], HS[2]), B.head, S.skin);
    for (const s of [1, -1]) P.add(xf(sphere(0.058, 8, 6), s * 0.284, 1.095, -0.012, 0, 0, 0, 0.5, 1, 0.82), B.head, S.skin);
    P.add(xf(sphere(0.019, 8, 6), 0, 1.06, 0.272, 0, 0, 0, 1.35, 0.85, 0.75), B.head, S.skin);
    P.add(xf(cyl(0.058, 0.064, 0.1, 12), 0, 0.83, 0), B.neck, S.skin);

    // ---- hair
    P.add(hairShell(hair), B.head, S.hair);
    if (hair === 'long') {
      P.add(xf(sphere(1, 22, 16), 0, 0.9, -0.15, 0.06, 0, 0, 0.29, 0.42, 0.15), B.head, S.hair);
      for (const s of [1, -1]) P.add(xf(capsule(0.05, 0.2, 8), s * 0.215, 0.93, 0.04, 0.12, 0, s * 0.12), B.head, S.hair); // side locks
    } else if (hair === 'bun') {
      const low = !!HAT[acc];
      const by = low ? 1.02 : 1.33, bz = low ? -0.285 : -0.15;
      P.add(xf(sphere(0.118, 18, 14), 0, by, bz), B.head, S.hair);
      P.add(xf(torus(0.085, 0.022, 6, 18), 0, by - (low ? 0 : 0.05), bz + (low ? 0.05 : 0.04), low ? 0 : 1.1, 0, 0), B.head, S.hair);
      P.add(xf(cyl(0.011, 0.011, 0.36, 8), 0, by + 0.01, bz, 0, 0, Math.PI / 2 - 0.25), B.head, S.gold);
      for (const s of [1, -1]) P.add(xf(sphere(0.02, 8, 6), s * 0.18 * Math.cos(0.25), by + 0.01 + s * 0.18 * Math.sin(0.25), bz), B.head, S.gold);
    } else if (hair === 'ponytail') {
      P.add(xf(torus(0.042, 0.019, 6, 16), 0, 1.22, -0.215, 1.0, 0, 0), B.pony, S.red);
      const tail = lathe([[0, 0.02], [0.045, 0], [0.072, -0.07], [0.086, -0.15], [0.078, -0.25], [0.05, -0.34], [0.016, -0.4], [0, -0.41]], 16);
      P.add(xf(tail, 0, 1.22, -0.235, 0.55, 0, 0), B.pony, S.hair);
    } else if (hair === 'short' && !HAT[acc]) {
      // little cowlick (ahoge) on the crown
      P.add(tube([[0.0, 1.385, -0.07], [0.012, 1.45, -0.05], [0.04, 1.49, 0.0], [0.07, 1.47, 0.04]], 0.013, 10, 5), B.head, S.hair);
      P.add(tube([[-0.01, 1.385, -0.09], [-0.03, 1.44, -0.08], [-0.065, 1.465, -0.05]], 0.011, 8, 5), B.head, S.hair);
    } else if (hair === 'curly') {
      const N = 74, gold = Math.PI * (3 - Math.sqrt(5));
      const rnd = G.util.rng(7);
      for (let i = 0; i < N; i++) {
        const y = 1 - (i / (N - 1)) * 2, rad = Math.sqrt(1 - y * y), th = gold * i;
        const dx = Math.cos(th) * rad, dz = Math.sin(th) * rad;
        const yaw = Math.atan2(dx, dz), elev = Math.asin(y);
        if (hairCoverage('curly', yaw, elev) < 0.75) continue;
        if (HAT[acc] && elev > (acc === 'cap' ? 0.05 : 0.32)) continue;
        const p = headPoint(yaw, elev, R * 1.05);
        const rr = 0.055 + rnd() * 0.025;
        P.add(xf(sphere(rr * 1.08, 7, 5), p[0], p[1], p[2]), B.head, S.hair);
      }
      if (acc !== 'cap') for (let a = -0.9; a <= 0.91; a += 0.3) { const p = headPoint(a, 0.42, R * 1.03); P.add(xf(sphere(0.052, 7, 5), p[0], p[1], p[2]), B.head, S.hair); }
    }

    // ---- accessories (head)
    if (acc === 'glasses') {
      for (const s of [1, -1]) {
        P.add(xf(torus(0.06, 0.009, 6, 22), s * 0.104, 1.088, 0.272), B.head, S.acc);
        P.add(tube([[s * 0.165, 1.095, 0.255], [s * 0.255, 1.1, 0.14], [s * 0.29, 1.095, 0.02]], 0.0065, 8, 5), B.head, S.acc);
      }
      P.add(xf(cyl(0.0065, 0.0065, 0.09, 6), 0, 1.1, 0.283, 0, 0, Math.PI / 2), B.head, S.acc);
    } else if (acc === 'strawhat') {
      const brim = cyl(0.44, 0.44, 0.016, 36, false);
      const bp = brim.attributes.position;
      for (let i = 0; i < bp.count; i++) { const x = bp.getX(i), z = bp.getZ(i); const rr = Math.hypot(x, z); bp.setY(i, bp.getY(i) - 0.045 * smooth(0.25, 0.44, rr)); }
      brim.computeVertexNormals();
      P.add(tilt(xf(brim, 0, 1.33, -0.01), -0.09), B.head, S.acc);
      P.add(tilt(xf(lathe([[0.238, 1.325], [0.236, 1.4], [0.226, 1.45], [0.19, 1.478], [0, 1.484]], 28), 0, 0, -0.01), -0.09), B.head, S.acc);
      P.add(tilt(xf(cyl(0.242, 0.242, 0.04, 28, true), 0, 1.357, -0.01), -0.09), B.head, S.acc2);
    } else if (acc === 'headband') {
      // ring = section of the hair shell by a plane tilted forward (front over the forehead, back higher)
      const ta = 0.24, rho = R * 1.1, d = 0.13;
      const sec = Math.sqrt(rho * rho - d * d);
      const band = torus(sec, 0.024, 8, 44);
      xf(band, 0, 0, 0, Math.PI / 2, 0, 0, HS[0] * 1.01, 1, 1);
      xf(band, 0, HC + d * Math.cos(ta), d * Math.sin(ta), ta, 0, 0);
      P.add(band, B.head, S.acc);
      const ky = HC + d * Math.cos(ta) + sec * Math.sin(ta), kz = d * Math.sin(ta) - sec * Math.cos(ta) - 0.012;
      for (const s of [1, -1]) {
        P.add(xf(sphere(0.038, 10, 8), s * 0.03, ky, kz, 0, 0, 0, 1.2, 0.85, 0.7), B.head, S.acc);
        P.add(xf(rbox(0.045, 0.13, 0.012, 0.005), s * 0.045, ky - 0.075, kz - 0.012, -0.22, 0, s * 0.32), B.head, S.acc);
      }
    } else if (acc === 'cap') {
      P.add(xf(new THREE.SphereGeometry(1, 30, 14, 0, TAU, 0, 1.18), 0, HC + 0.005, -0.008, -0.1, 0, 0, 0.322, 0.322, 0.33), B.head, S.acc);
      P.add(xf(cyl(0.21, 0.21, 0.016, 24, false, -1.0, 2.0), 0, 1.232, 0.1, 0.16, 0, 0, 1, 1, 1.28), B.head, S.acc);
      P.add(xf(sphere(0.022, 8, 6), 0, 1.44, -0.04), B.head, S.acc);
    } else if (acc === 'beard') {
      P.add(xf(sphere(1, 18, 14), 0, 0.92, 0.16, 0.25, 0, 0, 0.165, 0.15, 0.12), B.head, S.acc);
      for (const s of [1, -1]) P.add(xf(capsule(0.019, 0.06, 6), s * 0.042, 1.012, 0.268, 0, 0, s * 1.2), B.head, S.acc);
    } else if (acc === 'gat') {
      P.add(xf(cyl(0.43, 0.43, 0.012, 40), 0, 1.405, -0.01), B.head, S.acc);
      P.add(xf(cyl(0.128, 0.148, 0.2, 24), 0, 1.51, -0.01), B.head, S.acc);
    }

    // ---- torso & top
    const torsoSlot = top === 'apron' ? S.under : S.top;
    const grow = top === 'hoodie' ? 0.01 : top === 'jacket' ? 0.006 : 0;
    P.add(lathe(TORSO.map((p) => [p[0] > 0 ? p[0] + grow : 0, p[1]]), 22, TZ), B.spine, torsoSlot);
    const front = (x, y0, y1, off, n = 6) => { const pts = []; for (let i = 0; i <= n; i++) { const y = lerp(y0, y1, i / n); pts.push([x, y, surfZ(x, y, off)]); } return pts; };

    if (top === 'tshirt') {
      P.add(xf(torus(0.074, 0.012, 6, 22), 0, 0.81, 0.005, Math.PI / 2, 0, 0, 1, 0.82, 1), B.spine, S.top2);
      P.add(xf(cyl(0.032, 0.032, 0.006, 16), 0.075, 0.69, surfZ(0.075, 0.69, 0.004), Math.PI / 2 - 0.35, 0.4, 0), B.spine, S.top3);
    } else if (top === 'hoodie') {
      P.add(xf(sphere(1, 18, 12), 0, 0.8, -0.13, 0, 0, 0, 0.165, 0.1, 0.1), B.spine, S.top);
      P.add(xf(torus(0.096, 0.03, 8, 24), 0, 0.808, -0.005, Math.PI / 2 - 0.12, 0, 0, 1, 1, 1), B.spine, S.top);
      P.add(xf(cyl(0.188, 0.183, 0.1, 18, true, -0.62, 1.24), 0, 0.55, 0, 0, 0, 0, 1, 1, TZ + 0.02), B.spine, S.top2);
      for (const s of [1, -1]) P.add(xf(capsule(0.008, 0.08, 5), s * 0.042, 0.73, surfZ(s * 0.042, 0.73, 0.012)), B.spine, S.white);
      P.add(xf(torus(torsoR(0.455) + 0.012, 0.016, 6, 26), 0, 0.452, 0, Math.PI / 2, 0, 0, 1, TZ + 0.04, 1), B.spine, S.top2);
    } else if (top === 'shirt') {
      for (const s of [1, -1]) P.add(xf(rbox(0.085, 0.05, 0.012, 0.005), s * 0.05, 0.792, 0.1, -0.5, s * -0.25, s * 0.55), B.spine, S.top2);
      P.add(tube(front(0, 0.45, 0.785, 0.004), 0.009, 10, 5), B.spine, S.top2);
      for (const y of [0.54, 0.62, 0.7]) P.add(xf(sphere(0.011, 8, 6), 0, y, surfZ(0, y, 0.012)), B.spine, S.white);
      P.add(xf(rbox(0.06, 0.06, 0.01, 0.006), 0.085, 0.69, surfZ(0.085, 0.69, 0.006), 0, 0.42, 0), B.spine, S.top2);
    } else if (top === 'jacket') {
      P.add(xf(cyl(0.088, 0.1, 0.065, 18, true), 0, 0.822, -0.005, 0, 0, 0, 1, 1, 0.92), B.spine, S.top);
      P.add(tube(front(0, 0.45, 0.8, 0.008), 0.007, 10, 5), B.spine, S.top2);
      P.add(xf(sphere(0.012, 8, 6), 0, 0.8, surfZ(0, 0.8, 0.02)), B.spine, S.metal);
      for (const s of [1, -1]) P.add(tube([[s * 0.07, 0.54, surfZ(0.07, 0.54, 0.006)], [s * 0.12, 0.6, surfZ(0.12, 0.6, 0.006)]], 0.007, 4, 5), B.spine, S.top2);
      P.add(xf(torus(torsoR(0.455) + 0.01, 0.017, 6, 26), 0, 0.455, 0, Math.PI / 2, 0, 0, 1, TZ + 0.04, 1), B.spine, S.top2);
    } else if (hanbok) {
      const git = [[0.075, 0.815, 0.035], [0.055, 0.795, surfZ(0.055, 0.795, 0.008)], [0, 0.735, surfZ(0, 0.735, 0.01)], [-0.06, 0.68, surfZ(-0.06, 0.68, 0.01)], [-0.11, 0.645, surfZ(-0.11, 0.645, 0.008)]];
      P.add(tube(git, 0.017, 18, 6), B.spine, S.top2);
      P.add(tube(git.slice(0, 4).map((p) => [p[0], p[1] + 0.006, p[2] + 0.008]), 0.011, 14, 5), B.spine, S.white);
      P.add(xf(torus(0.072, 0.016, 6, 20, Math.PI * 1.15), 0, 0.808, -0.01, Math.PI / 2, 0, Math.PI * 0.92, 1, 0.85, 1), B.spine, S.top2);
      const kx = -0.075, ky = 0.655;
      P.add(xf(sphere(0.024, 10, 8), kx, ky, surfZ(kx, ky, 0.02), 0, 0, 0, 1.2, 0.9, 0.8), B.spine, S.top3);
      P.add(xf(rbox(0.034, 0.24, 0.006, 0.003), kx + 0.012, ky - 0.125, surfZ(kx, ky - 0.12, 0.022), -0.08, 0, 0.09), B.spine, S.top3);
      P.add(xf(rbox(0.03, 0.18, 0.006, 0.003), kx - 0.02, ky - 0.1, surfZ(kx - 0.03, ky - 0.1, 0.026), -0.08, 0, -0.1), B.spine, S.top3);
    } else if (top === 'apron') {
      P.add(xf(cyl(0.19, 0.188, 0.2, 18, true, -0.66, 1.32), 0, 0.665, 0, 0, 0, 0, 1, 1, TZ + 0.03), B.spine, S.top);
      P.add(tube([[0.1, 0.765, surfZ(0.1, 0.765, 0.01)], [0.11, 0.825, 0.02], [0, 0.845, -0.08], [-0.11, 0.825, 0.02], [-0.1, 0.765, surfZ(0.1, 0.765, 0.01)]], 0.011, 18, 5), B.spine, S.top);
      P.add(xf(torus(torsoR(0.53) + 0.012, 0.013, 6, 28), 0, 0.53, 0, Math.PI / 2, 0, 0, 1, TZ + 0.04, 1), B.spine, S.top);
      for (const s of [1, -1]) P.add(xf(rbox(0.035, 0.13, 0.008, 0.004), s * 0.03, 0.47, -0.145, 0.1, 0, s * 0.18), B.spine, S.top);
      P.add(xf(sphere(0.022, 8, 6), 0, 0.53, -0.142, 0, 0, 0, 1.4, 1, 0.8), B.spine, S.top);
      P.add(xf(cyl(0.205, 0.245, 0.29, 18, true, -0.82, 1.64), 0, 0.39, 0.0, 0, 0, 0, 1, 1, 0.88), B.skirt, S.top);
      P.add(xf(rbox(0.12, 0.08, 0.01, 0.008), 0, 0.37, 0.215, -0.13, 0, 0), B.skirt, S.top2);
    }

    // ---- arms
    const longSleeve = top !== 'tshirt';
    for (const s of [1, -1]) {
      const x = s * 0.205;
      const sh = s > 0 ? B.shL : B.shR, el = s > 0 ? B.elL : B.elR, hd = s > 0 ? B.hdL : B.hdR;
      const sleeveSlot = top === 'apron' ? S.under : S.top;
      if (top === 'tshirt') {
        P.add(limb(x, 0.755, 0.605, 0.048), sh, S.skin);
        P.add(xf(cyl(0.064, 0.07, 0.1, 14), x, 0.715, 0), sh, S.top);
        P.add(xf(new THREE.SphereGeometry(0.064, 14, 8, 0, TAU, 0, Math.PI / 2), x, 0.765, 0), sh, S.top);
        P.add(limb(x, 0.605, 0.475, 0.043), el, S.skin);
      } else {
        const rU = hanbok ? 0.056 : 0.052;
        P.add(limb(x, 0.755, 0.605, rU), sh, sleeveSlot);
        if (hanbok) {
          P.add(xf(cyl(0.052, 0.074, 0.13, 14), x, 0.548, 0), el, S.top);
          P.add(xf(cyl(0.075, 0.076, 0.035, 14), x, 0.484, 0), el, S.top3);
        } else if (top === 'shirt' || top === 'apron') {
          P.add(limb(x, 0.605, 0.475, 0.043), el, S.skin);
          P.add(xf(torus(0.05, 0.016, 6, 16), x, 0.592, 0, Math.PI / 2, 0, 0), el, top === 'apron' ? S.under : S.top);
        } else {
          P.add(limb(x, 0.605, 0.49, 0.047), el, S.top);
          P.add(xf(torus(0.044, 0.013, 6, 16), x, 0.488, 0, Math.PI / 2, 0, 0), el, S.top2);
        }
      }
      // mitten hand + thumb nub
      P.add(xf(sphere(0.058, 10, 7), x, 0.43, 0, 0, 0, 0, 0.82, 1.06, 0.95), hd, S.skin);
      P.add(xf(sphere(0.024, 6, 5), x, 0.448, 0.046), hd, S.skin);
    }
    // finger gestures (hidden bones scaled up when used)
    const fx = -0.205;
    const finger = (r, len) => new THREE.CapsuleGeometry(r, len, 2, 6);
    P.add(xf(finger(0.016, 0.055), fx, 0.3575, 0), B.fgP, S.skin);
    for (const a of [0.28, -0.28]) P.add(xf(finger(0.016, 0.06), fx + Math.sin(a) * 0.04, 0.355, 0, 0, 0, a), B.fgV, S.skin);
    P.add(xf(finger(0.019, 0.045), fx, 0.445, 0.075, Math.PI / 2, 0, 0), B.fgT, S.skin);

    // ---- bottoms & legs
    const pelvis = [[0, 0.385], [0.1, 0.388], [0.148, 0.415], [0.158, 0.46], [0.156, 0.5], [0.15, 0.525], [0, 0.53]];
    for (const s of [1, -1]) {
      const x = s * 0.088;
      const th = s > 0 ? B.thL : B.thR, kn = s > 0 ? B.knL : B.knR, ft = s > 0 ? B.ftL : B.ftR;
      if (bottom === 'pants') {
        if (hanbok) {
          P.add(xf(sphere(1, 14, 12), x + s * 0.008, 0.35, 0, 0, 0, 0, 0.09, 0.12, 0.09), th, S.bottom);
          P.add(limb(x, 0.28, 0.13, 0.068), kn, S.bottom);
          P.add(xf(torus(0.06, 0.014, 6, 16), x, 0.12, 0, Math.PI / 2, 0, 0), kn, S.white);
        } else {
          P.add(limb(x, 0.44, 0.27, 0.07), th, S.bottom);
          P.add(limb(x, 0.27, 0.1, 0.062), kn, S.bottom);
          P.add(xf(cyl(0.066, 0.068, 0.04, 14), x, 0.112, 0), kn, S.bottom2);
        }
      } else if (bottom === 'shorts') {
        P.add(limb(x, 0.44, 0.27, 0.058), th, S.skin);
        P.add(xf(cyl(0.074, 0.08, 0.13, 14), x + s * 0.004, 0.375, 0), th, S.bottom);
        P.add(limb(x, 0.27, 0.1, 0.053), kn, S.skin);
        P.add(xf(cyl(0.057, 0.058, 0.06, 12), x, 0.115, 0), kn, S.white);
      } else { // skirt / chima
        P.add(limb(x, 0.44, 0.27, 0.057), th, S.skin);
        P.add(limb(x, 0.27, 0.1, 0.052), kn, S.skin);
        P.add(xf(cyl(0.056, 0.057, 0.07, 12), x, 0.12, 0), kn, S.white);
      }
      // shoe + sole
      P.add(xf(sphere(1, 12, 9), x, 0.054, 0.032, 0, 0, 0, 0.064, 0.05, 0.112), ft, S.shoe);
      P.add(xf(sphere(1, 12, 6), x, 0.014, 0.032, 0, 0, 0, 0.068, 0.016, 0.118), ft, S.sole);
    }
    if (bottom === 'pants' || bottom === 'shorts') {
      P.add(lathe(pelvis, 22, 0.8), B.hips, S.bottom);
      P.add(xf(torus(0.152, 0.012, 6, 26), 0, 0.515, 0, Math.PI / 2, 0, 0, 1, 0.8, 1), B.hips, hanbok ? S.top3 : S.bottom2);
    } else if (chima) {
      P.add(lathe([[0.168, 0.53], [0.178, 0.6], [0.184, 0.672], [0.17, 0.676], [0, 0.676]], 26, 0.84), B.spine, S.bottom);
      const sk = lathe([[0.172, 0.54], [0.192, 0.45], [0.228, 0.33], [0.262, 0.2], [0.285, 0.09], [0.292, 0.04], [0.28, 0.036], [0.16, 0.53]], 40, 0.9);
      pleat(sk, 20, 0.04, 0.54, 0.04);
      P.add(sk, B.skirt, S.bottom);
    } else { // skirt
      const sk = lathe([[0.152, 0.535], [0.162, 0.5], [0.188, 0.42], [0.216, 0.32], [0.232, 0.255], [0.226, 0.25], [0.148, 0.53]], 36, 0.86);
      pleat(sk, 16, 0.03, 0.535, 0.25);
      P.add(sk, B.skirt, S.bottom);
      P.add(xf(torus(0.153, 0.014, 6, 26), 0, 0.53, 0, Math.PI / 2, 0, 0, 1, 0.86, 1), B.skirt, S.bottom2);
    }

    // ---- bags
    if (app.bag === 'backpack') {
      P.add(xf(rbox(0.25, 0.27, 0.13, 0.05), 0, 0.64, -0.21), B.bag, S.bag);
      P.add(xf(rbox(0.18, 0.11, 0.05, 0.022, 1), 0, 0.575, -0.285), B.bag, S.bag2);
      P.add(xf(rbox(0.252, 0.06, 0.135, 0.03, 1), 0, 0.755, -0.21), B.bag, S.bag2);
      P.add(xf(torus(0.03, 0.008, 5, 12, Math.PI), 0, 0.785, -0.2), B.bag, S.bag2);
      for (const s of [1, -1]) P.add(strap(s), B.spine, S.bag2);
    } else if (app.bag === 'basket') {
      P.add(xf(cyl(0.155, 0.118, 0.23, 18), 0, 0.66, -0.25, -0.12, 0, 0), B.bag, S.bag);
      for (const y of [0.6, 0.7]) P.add(xf(torus(0.14 + (y - 0.6) * 0.3, 0.008, 4, 22), 0, y, -0.25 + (y - 0.66) * 0.12, Math.PI / 2 - 0.12, 0, 0), B.bag, S.bag2);
      P.add(xf(torus(0.156, 0.016, 6, 24), 0, 0.775, -0.236, Math.PI / 2 - 0.12, 0, 0), B.bag, S.bag2);
      for (const [lx, ly, lz, lr] of [[-0.05, 0.8, -0.25, 0.07], [0.06, 0.81, -0.22, 0.065], [0.0, 0.83, -0.29, 0.06]]) P.add(xf(sphere(lr, 10, 8), lx, ly, lz, 0, 0, 0, 1, 0.8, 1), B.bag, S.leaf);
      for (const s of [1, -1]) P.add(strap(s), B.spine, S.bag2);
    } else if (app.bag === 'pouch') {
      P.add(xf(rbox(0.13, 0.11, 0.065, 0.028), -0.165, 0.49, 0.08, 0, -0.55, 0), B.hips, S.bag);
      P.add(xf(rbox(0.134, 0.05, 0.07, 0.022), -0.165, 0.525, 0.082, 0.1, -0.55, 0), B.hips, S.bag2);
      const cross = [[-0.15, 0.545, 0.11], [-0.07, 0.62, surfZ(-0.07, 0.62, 0.012)], [0.04, 0.72, surfZ(0.04, 0.72, 0.012)], [0.115, 0.8, 0.07], [0.14, 0.815, -0.03], [0.07, 0.72, -0.135], [-0.06, 0.6, -0.13], [-0.16, 0.53, -0.04]];
      P.add(tube(cross, 0.012, 16, 5), B.spine, S.bag2);
    }
    return P.build();
  }
  function strap(s) {
    const x0 = s * 0.088;
    return tube([[x0, 0.735, -0.155], [s * 0.1, 0.8, -0.1], [s * 0.115, 0.82, 0.0], [s * 0.112, 0.78, surfZ(0.112, 0.78, 0.012)], [s * 0.118, 0.68, surfZ(0.118, 0.68, 0.012)], [s * 0.122, 0.56, surfZ(0.122, 0.56, 0.012)], [s * 0.13, 0.5, 0.06], [s * 0.115, 0.52, -0.13]], 0.012, 16, 5);
  }
  /** vertical pleats on a lathe skirt between yTop and yHem */
  function pleat(g, n, amt, yTop, yHem) {
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const a = Math.atan2(x, z);
      const k = 1 + amt * Math.sin(a * n) * smooth(yTop, yHem, y);
      p.setXYZ(i, x * k, y, z * k);
    }
    g.computeVertexNormals();
  }
  function bodyGeometry(app) {
    const key = styleSig(app);
    let g = geoCache.get(key);
    if (!g) {
      const t0 = performance.now();
      g = buildBody(app);
      geoCache.set(key, g);
      G.log.debug('AVATAR', `geometry ${key}: ${g.attributes.position.count} verts, ${(performance.now() - t0).toFixed(1)}ms`);
    }
    return g;
  }

  // ---------------------------------------------------------------- face decal (canvas texture per face type × expression)
  const FW = 384, FH = 280;
  let faceGeo = null;
  function faceGeometry() {
    if (faceGeo) return faceGeo;
    const g = new THREE.SphereGeometry(R * 1.012, 28, 20, Math.PI / 2 - 0.85, 1.7, Math.PI / 2 - 0.62, 1.24);
    xf(g, 0, 0, 0, 0, 0, 0, HS[0], HS[1], HS[2]);
    xf(g, 0, HC - BONES[B.head][3], 0);
    faceGeo = g;
    return g;
  }
  const faceMats = new Map();
  function faceMaterial(face, expr) {
    const key = face + ':' + expr;
    let m = faceMats.get(key);
    if (!m) {
      const tex = G.gfx.canvasTexture(FW, FH, (ctx) => drawFace(ctx, face, expr));
      m = new THREE.MeshStandardMaterial({ map: tex, transparent: true, depthWrite: false, roughness: 0.55, envMapIntensity: 0.6, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
      m.name = 'avatarFace:' + key;
      faceMats.set(key, m);
    }
    return m;
  }
  function drawFace(ctx, face, expr) {
    const cx = FW / 2, ey = 160, edx = 80;
    ctx.clearRect(0, 0, FW, FH);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    // blush
    const blushA = expr === 'happy' || expr === 'wink' ? 0.62 : 0.48;
    for (const s of [-1, 1]) {
      const bx = cx + s * 112, by = 206;
      const gr = ctx.createRadialGradient(bx, by, 2, bx, by, 33);
      gr.addColorStop(0, `rgba(255,120,130,${blushA})`); gr.addColorStop(1, 'rgba(255,120,130,0)');
      ctx.save(); ctx.translate(bx, by); ctx.scale(1, 0.55); ctx.translate(-bx, -by);
      ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(bx, by, 33, 0, TAU); ctx.fill(); ctx.restore();
    }
    // brows
    ctx.strokeStyle = 'rgba(68,44,30,0.85)'; ctx.lineWidth = 4.5;
    for (const s of [-1, 1]) {
      const bx = cx + s * edx;
      let by = ey - 46;
      if (expr === 'surprise') by -= 9;
      if (expr === 'think' && s > 0) by -= 8;
      const tilt = face === 'calm' ? -2 : 0;
      ctx.beginPath(); ctx.moveTo(bx - 13, by + 3 + tilt * s); ctx.quadraticCurveTo(bx, by - 5, bx + 13, by + 3 - tilt * s); ctx.stroke();
    }
    // eyes
    const openEye = (x, y, sc, lx, ly) => {
      const rx = 18 * sc, ry = (face === 'calm' ? 21.5 : 24.5) * sc;
      const gr = ctx.createLinearGradient(x, y - ry, x, y + ry);
      gr.addColorStop(0, '#1c120d'); gr.addColorStop(0.62, '#2e1d14'); gr.addColorStop(1, '#5b3a26');
      ctx.fillStyle = gr; ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.arc(x - 6 * sc + lx, y - 9 * sc + ly, 7.2 * sc, 0, TAU); ctx.fill();
      ctx.globalAlpha = 0.85; ctx.beginPath(); ctx.arc(x + 6 * sc + lx * 0.5, y + 9.5 * sc + ly * 0.5, 3.1 * sc, 0, TAU); ctx.fill(); ctx.globalAlpha = 1;
      if (face === 'calm') { ctx.strokeStyle = '#1c120d'; ctx.lineWidth = 3.5; ctx.beginPath(); ctx.moveTo(x - rx - 2, y - ry * 0.55); ctx.quadraticCurveTo(x, y - ry - 3, x + rx + 2, y - ry * 0.55); ctx.stroke(); }
    };
    const happyEye = (x, y) => { ctx.strokeStyle = '#1c120d'; ctx.lineWidth = 7; ctx.beginPath(); ctx.arc(x, y + 10, 17, Math.PI * 1.12, Math.PI * 1.88); ctx.stroke(); };
    const closedEye = (x, y) => { ctx.strokeStyle = '#1c120d'; ctx.lineWidth = 6; ctx.beginPath(); ctx.arc(x, y - 9, 17, Math.PI * 0.18, Math.PI * 0.82); ctx.stroke(); };
    const winkEye = (x, y) => { ctx.strokeStyle = '#1c120d'; ctx.lineWidth = 6.5; ctx.beginPath(); ctx.moveTo(x - 15, y - 10); ctx.lineTo(x + 10, y); ctx.lineTo(x - 15, y + 10); ctx.stroke(); };
    for (const s of [-1, 1]) {
      const x = cx + s * edx;
      if (expr === 'blink') closedEye(x, ey);
      else if (expr === 'happy') happyEye(x, ey);
      else if (expr === 'wink' && s > 0) winkEye(x, ey);
      else if (expr === 'surprise') openEye(x, ey - 3, 1.14, 0, 0);
      else if (expr === 'think') openEye(x, ey, 0.95, 4, -5);
      else openEye(x, ey, 1, 0, 0);
    }
    // mouth
    const my = 226;
    const ink = '#6b2a2a';
    const openMouth = (w, h, y) => {
      ctx.save();
      ctx.beginPath(); ctx.moveTo(cx - w, y); ctx.quadraticCurveTo(cx, y + h * 2, cx + w, y); ctx.quadraticCurveTo(cx, y + h * 0.35, cx - w, y); ctx.closePath();
      ctx.fillStyle = '#7a2626'; ctx.fill();
      ctx.clip();
      ctx.fillStyle = '#ff8c8c'; ctx.beginPath(); ctx.ellipse(cx, y + h * 1.25, w * 0.55, h * 0.55, 0, 0, TAU); ctx.fill();
      ctx.restore();
    };
    ctx.strokeStyle = ink; ctx.lineWidth = 5.5;
    if (expr === 'surprise') { ctx.fillStyle = '#7a2626'; ctx.beginPath(); ctx.ellipse(cx, my + 8, 9, 11, 0, 0, TAU); ctx.fill(); }
    else if (expr === 'talk') { ctx.fillStyle = '#7a2626'; ctx.beginPath(); ctx.ellipse(cx, my + 6, 12, 9, 0, 0, TAU); ctx.fill(); ctx.fillStyle = '#ff8c8c'; ctx.beginPath(); ctx.ellipse(cx, my + 11, 7, 4, 0, 0, TAU); ctx.fill(); }
    else if (expr === 'happy' || expr === 'wink') openMouth(22, 15, my - 2);
    else if (expr === 'think') { ctx.beginPath(); ctx.moveTo(cx - 12, my + 1); ctx.quadraticCurveTo(cx - 5, my + 6, cx + 2, my + 2); ctx.quadraticCurveTo(cx + 8, my - 2, cx + 14, my + 2); ctx.stroke(); }
    else if (face === 'cheer') openMouth(19, 13, my - 1);
    else if (face === 'calm') { ctx.beginPath(); ctx.arc(cx, my - 6, 14, Math.PI * 0.3, Math.PI * 0.7); ctx.stroke(); }
    else { ctx.beginPath(); ctx.arc(cx, my - 12, 20, Math.PI * 0.24, Math.PI * 0.76); ctx.stroke(); }
  }

  // ---------------------------------------------------------------- held items (fixed colours, vertex coloured)
  const heldCache = new Map();
  let heldMat = null;
  function vcolor(g, hex) {
    _c1.set(hex);
    const n = g.attributes.position.count, a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { a[i * 3] = _c1.r; a[i * 3 + 1] = _c1.g; a[i * 3 + 2] = _c1.b; }
    g.setAttribute('color', new THREE.Float32BufferAttribute(a, 3));
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(k)) g.deleteAttribute(k);
    return g;
  }
  function heldGeometry(name) {
    if (heldCache.has(name)) return heldCache.get(name);
    const L = [];
    if (name === 'watering-can') {
      L.push(vcolor(xf(cyl(0.085, 0.095, 0.15, 18), 0, -0.185, 0.03), '#3f9e5a'));
      L.push(vcolor(xf(cyl(0.087, 0.087, 0.016, 18), 0, -0.11, 0.03), '#2f7d4a'));
      L.push(vcolor(xf(torus(0.06, 0.012, 6, 14, Math.PI), 0, -0.11, 0.03, 0, Math.PI / 2, 0), '#2f7d4a'));
      L.push(vcolor(xf(cyl(0.012, 0.02, 0.24, 8), 0, -0.15, 0.2, 1.05, 0, 0), '#2f7d4a'));
      L.push(vcolor(xf(cyl(0.04, 0.018, 0.04, 12), 0, -0.096, 0.303, 1.05, 0, 0), '#c9a24a'));
    } else if (name === 'basket') {
      L.push(vcolor(xf(cyl(0.12, 0.095, 0.1, 16), 0, -0.21, 0), '#b88a4a'));
      L.push(vcolor(xf(torus(0.12, 0.012, 5, 18), 0, -0.16, 0, Math.PI / 2, 0, 0), '#8a5f2c'));
      L.push(vcolor(xf(torus(0.11, 0.01, 5, 16, Math.PI), 0, -0.16, 0), '#8a5f2c'));
      L.push(vcolor(xf(sphere(0.045, 10, 8), -0.04, -0.15, 0.02), '#d9534f'));
      L.push(vcolor(xf(sphere(0.042, 10, 8), 0.045, -0.15, -0.01), '#f0c040'));
      L.push(vcolor(xf(sphere(0.05, 10, 8), 0, -0.145, -0.05, 0, 0, 0, 1, 0.7, 1), '#5aa04a'));
    } else if (name === 'camera') {
      L.push(vcolor(xf(rbox(0.12, 0.075, 0.055, 0.012), 0, -0.06, 0.05), '#2b2d31'));
      L.push(vcolor(xf(cyl(0.027, 0.03, 0.045, 16), 0, -0.06, 0.095, Math.PI / 2, 0, 0), '#141416'));
      L.push(vcolor(xf(torus(0.029, 0.005, 5, 16), 0, -0.06, 0.118), '#c0c4c8'));
      L.push(vcolor(xf(rbox(0.03, 0.015, 0.02, 0.004), 0.035, -0.018, 0.05), '#c0c4c8'));
    } else { heldCache.set(name, null); return null; }
    const g = BGU.mergeGeometries(L, false);
    L.forEach((x) => x.dispose());
    heldCache.set(name, g);
    return g;
  }

  // ---------------------------------------------------------------- shared avatar material (palette shader)
  function makeBodyMaterial() {
    const m = new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0, envMapIntensity: 0.6 });
    const pal = new Float32Array(NSLOT * 3), rough = new Float32Array(NSLOT);
    m.userData.pal = pal; m.userData.rough = rough;
    m.name = 'avatarBody';
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uPal = { value: pal };
      sh.uniforms.uRough = { value: rough };
      sh.vertexShader = `attribute float aSlot;\nuniform vec3 uPal[${NSLOT}];\nuniform float uRough[${NSLOT}];\nvarying vec3 vPalColor;\nvarying float vPalRough;\n` +
        sh.vertexShader.replace('#include <color_vertex>', '#include <color_vertex>\n  { int si = int(aSlot + 0.5); vPalColor = uPal[si]; vPalRough = uRough[si]; }');
      sh.fragmentShader = 'varying vec3 vPalColor;\nvarying float vPalRough;\n' + sh.fragmentShader
        .replace('#include <color_fragment>', '#include <color_fragment>\n  diffuseColor.rgb *= vPalColor;')
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n  roughnessFactor *= vPalRough;')
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n  { float rimF = 1.0 - saturate(dot(normal, normalize(vViewPosition))); totalEmissiveRadiance += diffuseColor.rgb * rimF * rimF * rimF * 0.16; }');
    };
    m.customProgramCacheKey = () => 'tfmAvatarPalette1';
    return m;
  }
  function applyPalette(mat, app) {
    const cols = slotColors(app);
    const pal = mat.userData.pal, rough = mat.userData.rough;
    for (let i = 0; i < NSLOT; i++) {
      _c1.set(cols[i]);
      pal[i * 3] = _c1.r; pal[i * 3 + 1] = _c1.g; pal[i * 3 + 2] = _c1.b;
      rough[i] = ROUGH[i];
    }
    if (app.accessory === 'glasses') rough[SLOT.acc] = 0.32;
  }

  // ---------------------------------------------------------------- animation channels
  const CH = ['rootY', 'squash', 'rootRY', 'hipsX', 'hipsY', 'hipsZ', 'spineX', 'spineY', 'spineZ', 'neckX', 'neckY', 'neckZ', 'headX', 'headY', 'headZ',
    'shLX', 'shLY', 'shLZ', 'elLX', 'elLY', 'elLZ', 'hdLX', 'hdLY', 'hdLZ',
    'shRX', 'shRY', 'shRZ', 'elRX', 'elRY', 'elRZ', 'hdRX', 'hdRY', 'hdRZ',
    'thLX', 'thLY', 'thLZ', 'knLX', 'ftLX', 'ftLZ', 'thRX', 'thRY', 'thRZ', 'knRX', 'ftRX', 'ftRZ',
    'ponyX', 'ponyZ', 'bagX', 'skirtX', 'skirtZ', 'fgP', 'fgV', 'fgT', 'seatW', 'seatY'];
  const C = {};
  CH.forEach((n, i) => { C[n] = i; });
  const NCH = CH.length;
  const L1 = 0.17, L2 = 0.185, LF = 0.085, HIP = 0.44 + 0.02; // thigh, shin, ankle height, hips bone height

  // helper used by poses: set both arms symmetric (mirror Y/Z)
  function arms(o, x, z, ex, ez) {
    o[C.shLX] = x; o[C.shRX] = x; o[C.shLZ] = z; o[C.shRZ] = -z;
    o[C.elLX] = ex; o[C.elRX] = ex; o[C.elLZ] = ez || 0; o[C.elRZ] = -(ez || 0);
  }
  function mix(o, i, v, w) { o[i] += (v - o[i]) * w; }
  /** fast gait toes: push off at the end of stance, reach (toes up) before touchdown (f = leg phase, duty = stance share) */
  function toeAngle(f, duty) { return f < duty ? 0.35 * smooth(0.55, 1, f / duty) : -0.25 * smooth(0.6, 0.95, (f - duty) / (1 - duty)); }

  // ---------------------------------------------------------------- fast gait (phase 4: the 9.6 / 18 m/s player)
  // Above ~5 m/s the sinusoidal walk/run blends into an IK-driven bounding run: each foot follows a
  // stance line that moves backwards exactly as fast as the body moves forwards (no foot sliding), then a
  // swing curve (heel kick -> high knee -> reach). Stride per cycle grows with speed so the cadence stays
  // readable (2.8 Hz at 9.6 m/s, 3.3 Hz at 18 m/s); the stance is short and the flight long, like a sprint.
  const FAST0 = 5, FAST1 = 8;          // m/s: fast-gait blend in
  const SPRINT0 = 11, SPRINT1 = 16;    // m/s: sprint pose blend in
  const SWEEP = 0.38;                  // m: how far a planted foot travels under the hip
  const LEG_MAX = (L1 + L2) * 0.999, LEG_MIN = Math.abs(L1 - L2) + 0.03;
  /** metres per full gait cycle (two steps) at ground speed v */
  function strideLength(v, runW, fastW) {
    const slow = lerp(1.45, 2.25, runW);
    const fast = 1.1 + 0.24 * clamp(v, 0, 30);
    return lerp(slow, fast, fastW);
  }
  /** planar two-bone IK in the sagittal plane: ankle target (z fwd, y up) relative to the hip joint -> out[0]=thigh, out[1]=knee */
  function legIK(z, y, out) {
    let d = Math.hypot(z, y);
    if (!(d > 1e-4)) { z = 0; y = -LEG_MAX; d = LEG_MAX; }
    if (d > LEG_MAX) { const k = LEG_MAX / d; z *= k; y *= k; d = LEG_MAX; }
    else if (d < LEG_MIN) { const k = LEG_MIN / d; z *= k; y *= k; d = LEG_MIN; }
    const aT = Math.atan2(-z, -y);
    const beta = Math.acos(clamp((L1 * L1 + d * d - L2 * L2) / (2 * L1 * d), -1, 1));
    const inner = Math.acos(clamp((L1 * L1 + L2 * L2 - d * d) / (2 * L1 * L2), -1, 1));
    out[0] = aT - beta;
    out[1] = Math.PI - inner;
    return out;
  }
  const crom = (p0, p1, p2, p3, t) => {
    const t2 = t * t, t3 = t2 * t;
    return 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
  };
  const SW_Z = new Float32Array(7), SW_Y = new Float32Array(7);
  /** ankle offset {z, y(above the sole line)} of one leg at leg phase f (0 = touchdown) */
  function footPath(f, duty, S2, H, sprintW, out) {
    if (f < duty) { // stance: planted, sweeping back linearly (= ground speed)
      const u = f / duty;
      out.z = S2 - 2 * S2 * u; out.y = 0; out.stance = 1 - Math.abs(u * 2 - 1);
      return out;
    }
    const u = (f - duty) / (1 - duty);
    // keyframes: lift-off, heel kick behind, tucked under the hip, reach forward, touchdown (+ phantom ends)
    SW_Z[0] = -S2 + 0.12; SW_Y[0] = -0.05 * H;
    SW_Z[1] = -S2; SW_Y[1] = 0;
    SW_Z[2] = -S2 - 0.07 - 0.05 * sprintW; SW_Y[2] = 0.58 * H;
    SW_Z[3] = 0.03; SW_Y[3] = H;
    SW_Z[4] = S2 + 0.06 + 0.04 * sprintW; SW_Y[4] = 0.42 * H;
    SW_Z[5] = S2; SW_Y[5] = 0;
    SW_Z[6] = S2 - 0.12; SW_Y[6] = -0.05 * H;
    const x = u * 4, i = Math.min(3, Math.floor(x)), t = x - i;
    out.z = crom(SW_Z[i], SW_Z[i + 1], SW_Z[i + 2], SW_Z[i + 3], t);
    out.y = Math.max(0, crom(SW_Y[i], SW_Y[i + 1], SW_Y[i + 2], SW_Y[i + 3], t));
    out.stance = 0;
    return out;
  }
  const _ikA = [0, 0], _ikB = [0, 0], _fpL = { z: 0, y: 0, stance: 0 }, _fpR = { z: 0, y: 0, stance: 0 };
  const env = (t, d, a = 0.25, b = 0.3) => Math.min(smooth(0, a, t), 1 - smooth(d - b, d, t));

  // Action library. pose(o, t, k, rig): o is prefilled with the locomotion pose; write absolute channel values.
  // fullBody: the action wants the character to stand still (player cancels it when moving).
  const ACTIONS = {
    sit: {
      loop: true, fullBody: true, face: null,
      pose(o, t, k, rig) {
        const seat = rig._seatY;
        const br = Math.sin(t * 2) * 0.012;
        o[C.seatW] = 1; o[C.seatY] = seat;
        if (seat > 0.12) {
          o[C.thLX] = -1.52; o[C.thRX] = -1.52; o[C.thLZ] = 0.07; o[C.thRZ] = -0.07; o[C.thLY] = 0; o[C.thRY] = 0;
          o[C.knLX] = 1.3 + 0.2 * Math.sin(t * 2.3); o[C.knRX] = 1.3 + 0.2 * Math.sin(t * 2.3 + Math.PI);
          o[C.ftLX] = -0.15; o[C.ftRX] = -0.15;
          arms(o, -0.62, 0.12, -0.7, 0);
          o[C.spineX] = -0.02 + br; o[C.hipsX] = 0; o[C.hipsZ] = 0; o[C.headX] = 0.04 - br;
        } else {
          o[C.thLX] = -1.42; o[C.thRX] = -1.48; o[C.thLZ] = 0.12; o[C.thRZ] = -0.1;
          o[C.knLX] = 0.25; o[C.knRX] = 0.12; o[C.ftLX] = 0.1; o[C.ftRX] = 0.15;
          arms(o, 0.62, 0.28, -0.05, 0);
          o[C.spineX] = -0.2 + br; o[C.headX] = 0.08; o[C.hipsZ] = 0;
        }
        o[C.skirtX] = -0.5;
      },
    },
    wave: {
      dur: 2.4, face: 'happy',
      pose(o, t) {
        const w = Math.sin(t * 9);
        o[C.shRZ] = -2.25; o[C.shRX] = -0.4; o[C.shRY] = 0;
        o[C.elRX] = -0.15; o[C.elRZ] = -0.62 + 0.38 * w; o[C.hdRZ] = 0.25 * Math.sin(t * 9 + 0.7);
        o[C.headZ] = 0.12; o[C.spineZ] = 0.05; o[C.shLZ] = 0.2;
      },
    },
    bow: {
      dur: 2.2, fullBody: true, face: 'base',
      pose(o, t, k, rig) {
        const e = Math.min(smooth(0.05, 0.55, t), 1 - smooth(1.45, 1.95, t));
        o[C.spineX] = 0.82 * e; o[C.headX] = 0.22 * e; o[C.neckX] = 0.1 * e;
        o[C.shLX] = -0.5 * e; o[C.shRX] = -0.5 * e; o[C.shLZ] = -0.32 * e; o[C.shRZ] = 0.32 * e;
        o[C.elLX] = -0.95 * e; o[C.elRX] = -0.95 * e; o[C.elLZ] = -0.3 * e; o[C.elRZ] = 0.3 * e;
      },
    },
    clap: {
      dur: 2.0, face: 'happy',
      pose(o, t) {
        const c = Math.max(0, Math.sin(t * 13));
        o[C.shLX] = -1.0; o[C.shRX] = -1.0;
        o[C.shLZ] = -0.06 - 0.32 * (1 - c) + 0.32; o[C.shRZ] = -o[C.shLZ];
        o[C.shLY] = -0.35; o[C.shRY] = 0.35;
        o[C.elLX] = -0.85; o[C.elRX] = -0.85; o[C.elLZ] = -0.55 + 0.3 * c; o[C.elRZ] = 0.55 - 0.3 * c;
        o[C.headX] = -0.05 + 0.04 * c; o[C.spineX] = 0.03;
      },
    },
    thumbsup: {
      dur: 2.0, face: 'wink',
      pose(o, t) {
        const b = Math.sin(t * 6) * 0.04;
        o[C.shRX] = -1.15; o[C.shRZ] = -0.32; o[C.shRY] = 0.25; o[C.elRX] = -1.25 + b; o[C.elRY] = 0;
        o[C.hdRX] = 0.15; o[C.hdRY] = -0.6; o[C.fgT] = 1;
        o[C.headZ] = 0.1; o[C.spineY] = -0.1; o[C.shLZ] = 0.22;
      },
    },
    point: {
      dur: 2.0, face: 'base',
      pose(o, t) {
        o[C.shRX] = -1.48; o[C.shRZ] = -0.12; o[C.shRY] = 0.1; o[C.elRX] = -0.08; o[C.hdRX] = -0.1;
        o[C.fgP] = 1; o[C.spineY] = 0.12; o[C.headY] = -0.05; o[C.headX] = -0.04;
      },
    },
    photo: {
      dur: 4.0, face: 'wink',
      pose(o, t) {
        const b = Math.sin(t * 2.4) * 0.03;
        o[C.shRX] = -0.55; o[C.shRZ] = -1.05; o[C.shRY] = 0.2; o[C.elRX] = -0.2; o[C.elRZ] = -2.25; o[C.hdRZ] = 0.3; o[C.hdRY] = -0.5;
        o[C.fgV] = 1;
        o[C.shLZ] = 0.62; o[C.shLX] = 0.15; o[C.elLX] = -0.6; o[C.elLZ] = 1.45; o[C.elLY] = 0;
        o[C.headZ] = 0.17 + b; o[C.spineZ] = 0.06; o[C.hipsZ] = -0.05; o[C.spineY] = 0.06;
      },
    },
    celebrate: {
      dur: 2.4, face: 'happy', fullBody: true,
      pose(o, t, k, rig) {
        const hop = Math.abs(Math.sin(t * 6.5));
        arms(o, -0.25, 2.65 + 0.12 * Math.sin(t * 13), -0.25, 0);
        o[C.hdLZ] = 0.3 * Math.sin(t * 13); o[C.hdRZ] = -0.3 * Math.sin(t * 13);
        o[C.rootY] += hop * 0.11 * (1 - rig._moveW);
        o[C.thLX] += -0.3 * hop; o[C.thRX] += -0.3 * hop; o[C.knLX] += 0.6 * hop; o[C.knRX] += 0.6 * hop;
        o[C.headX] = -0.15; o[C.spineX] = -0.06;
      },
    },
    surprise: {
      dur: 1.5, face: 'surprise',
      pose(o, t) {
        const e = smooth(0, 0.15, t);
        const hop = t < 0.35 ? Math.sin((t / 0.35) * Math.PI) : 0;
        o[C.spineX] = -0.22 * e; o[C.headX] = -0.18 * e;
        arms(o, -0.55 * e, 1.05 * e, -1.25 * e, 0.3 * e);
        o[C.rootY] += 0.06 * hop;
      },
    },
    nod: {
      dur: 1.3, face: 'happy',
      pose(o, t) { o[C.headX] += 0.3 * Math.max(0, Math.sin(t * 9.5)) * (1 - smooth(0.9, 1.3, t)); o[C.neckX] += 0.06 * Math.max(0, Math.sin(t * 9.5)); },
    },
    heart: {
      dur: 2.6, face: 'happy',
      pose(o, t) {
        const sw = Math.sin(t * 3.2) * 0.08;
        o[C.shLZ] = 2.62; o[C.shRZ] = -2.62; o[C.shLX] = -0.3; o[C.shRX] = -0.3;
        o[C.elLZ] = 1.0; o[C.elRZ] = -1.0; o[C.elLX] = -0.1; o[C.elRX] = -0.1;
        o[C.hdLZ] = 0.4; o[C.hdRZ] = -0.4;
        o[C.spineZ] = sw; o[C.headZ] = sw * 1.5; o[C.headX] = -0.05;
      },
    },
    dance: {
      loop: true, fullBody: true, face: 'happy',
      pose(o, t) {
        const b = t * 6.2, s = Math.sin(b), bounce = Math.abs(Math.sin(b));
        o[C.hipsZ] = 0.12 * s; o[C.spineZ] = -0.16 * s; o[C.headZ] = 0.1 * s; o[C.spineY] = 0.15 * Math.sin(b * 0.5);
        o[C.shLZ] = 1.0 + 0.85 * Math.sin(b); o[C.shRZ] = -(1.0 + 0.85 * Math.sin(b + Math.PI));
        o[C.shLX] = -0.3; o[C.shRX] = -0.3; o[C.elLX] = -0.7; o[C.elRX] = -0.7;
        o[C.thLX] = -0.15 - 0.15 * bounce; o[C.thRX] = -0.15 - 0.15 * bounce; o[C.knLX] = 0.3 + 0.35 * bounce; o[C.knRX] = 0.3 + 0.35 * bounce;
        o[C.ftLX] = -0.1; o[C.ftRX] = -0.1; o[C.thLZ] = 0.08; o[C.thRZ] = -0.08;
        o[C.rootRY] = 0.35 * Math.sin(t * 1.55);
        o[C.headX] = 0.08 * Math.sin(b * 2);
      },
    },
    think: {
      dur: 3.0, face: 'think',
      pose(o, t) {
        o[C.shRX] = -0.95; o[C.shRZ] = 0.12; o[C.shRY] = 0.3; o[C.elRX] = -2.15; o[C.elRY] = 0; o[C.hdRX] = 0.2;
        o[C.shLX] = -0.55; o[C.shLZ] = -0.25; o[C.shLY] = -0.3; o[C.elLX] = -1.35;
        o[C.headZ] = 0.14 + Math.sin(t * 1.5) * 0.03; o[C.headX] = -0.08; o[C.headY] = 0.08;
      },
    },
    water: {
      dur: 2.2, face: 'base', held: 'watering-can',
      pose(o, t) {
        const e = env(t, 2.2, 0.35, 0.35);
        o[C.shRX] = -1.05 * e; o[C.shRZ] = -0.18 * e; o[C.elRX] = -0.3 * e;
        o[C.hdRX] = (0.95 + 0.15 * Math.sin(t * 4)) * e;
        o[C.shLZ] = 0.25; o[C.spineX] = 0.14 * e; o[C.headX] = 0.28 * e;
      },
    },
    harvest: {
      dur: 2.0, fullBody: true, face: (t) => (t > 1.1 ? 'happy' : 'base'),
      pose(o, t) {
        const down = smooth(0.0, 0.45, t) * (1 - smooth(1.35, 1.9, t));
        const pull = smooth(0.85, 1.15, t) * (1 - smooth(1.5, 1.95, t));
        o[C.thLX] = -1.05 * down; o[C.thRX] = -1.15 * down; o[C.knLX] = 1.9 * down; o[C.knRX] = 2.0 * down;
        o[C.ftLX] = -0.85 * down; o[C.ftRX] = -0.85 * down; o[C.thLZ] = 0.1 * down; o[C.thRZ] = -0.1 * down;
        o[C.spineX] = 0.55 * down - 0.35 * pull; o[C.headX] = 0.25 * down - 0.2 * pull;
        const reach = down * (1 - pull);
        arms(o, -1.05 * reach - 1.9 * pull, 0.1 + 0.5 * pull, -0.25 * reach - 0.6 * pull, 0);
      },
    },
    interact: {
      dur: 0.9, face: 'base',
      pose(o, t) {
        const e = Math.sin(clamp(t / 0.9, 0, 1) * Math.PI);
        o[C.shRX] = -1.15 * e; o[C.shRZ] = -0.1; o[C.elRX] = -0.35 * e; o[C.hdRX] = -0.2 * e;
        o[C.spineX] = 0.1 * e; o[C.headX] = 0.08 * e;
      },
    },
    talk: {
      loop: true, face: 'talk',
      pose(o, t, k, rig) {
        const p = rig._seed * 10;
        o[C.shRX] = -0.5 - 0.22 * Math.sin(t * 2.3 + p); o[C.shRZ] = -0.18; o[C.elRX] = -0.95 + 0.3 * Math.sin(t * 3.1 + p); o[C.elRZ] = 0.2;
        o[C.shLX] = -0.2 - 0.12 * Math.sin(t * 1.7 + p + 1); o[C.shLZ] = 0.18; o[C.elLX] = -0.5 + 0.2 * Math.sin(t * 2.6 + p);
        o[C.headX] += 0.05 * Math.sin(t * 2.7 + p); o[C.headY] += 0.06 * Math.sin(t * 1.3 + p); o[C.spineY] = 0.05 * Math.sin(t * 1.1 + p);
      },
    },
  };
  const LOCO = new Set(['idle', 'walk', 'run', 'jump', 'fall']);

  // ---------------------------------------------------------------- rig
  const _v = new THREE.Vector3();
  const sharedBounds = new THREE.Sphere(new THREE.Vector3(0, 0.78, 0), 1.05);
  const sharedBox = new THREE.Box3(new THREE.Vector3(-0.48, -0.05, -0.45), new THREE.Vector3(0.48, 1.68, 0.5));
  const HEAD_TOP = { strawhat: 1.5, cap: 1.47, gat: 1.62 };

  class Rig {
    constructor(appearance, opts = {}) {
      this.opts = opts;
      this.group = new THREE.Group();
      this.group.name = 'avatar';
      this.scaler = new THREE.Object3D();
      this.group.add(this.scaler);
      this.bones = BONES.map(([name]) => { const b = new THREE.Bone(); b.name = name; return b; });
      BONES.forEach(([, parent, x, y, z], i) => {
        const p = parent >= 0 ? BONES[parent] : null;
        this.bones[i].position.set(x - (p ? p[2] : 0), y - (p ? p[3] : 0), z - (p ? p[4] : 0));
        if (parent >= 0) this.bones[parent].add(this.bones[i]); else this.scaler.add(this.bones[i]);
      });
      this.skeleton = new THREE.Skeleton(this.bones, BONE_INV.map((m) => m.clone()));
      this.bone = {};
      BONES.forEach(([name], i) => { this.bone[name] = this.bones[i]; });
      this.material = makeBodyMaterial();
      this.mesh = null;
      this.face = new THREE.Mesh(faceGeometry(), faceMaterial('smile', 'base'));
      this.face.name = 'avatarFace';
      this.face.renderOrder = 2;
      this.bone.head.add(this.face);
      this.headAnchor = new THREE.Object3D();
      this.headAnchor.name = 'headAnchor';
      this.bone.head.add(this.headAnchor);
      this.handR = this.bone.hdR;
      this.handL = this.bone.hdL;
      this.held = null; this._heldMesh = null; this._heldName = null;
      // animation state
      this._seed = Math.random();
      this.phase = this._seed;
      this.steps = 0;
      this._moveW = 0; this._runW = 0; this._airW = 0; this._fastW = 0; this._sprintW = 0; this._gaitV = 0; this._cyc = 1.45;
      this._grounded = true; this._lastVy = 0; this._landT = 9; this._landAmt = 0;
      this._L = new Float32Array(NCH); this._A = new Float32Array(NCH); this._F = new Float32Array(NCH); this._S = new Float32Array(NCH);
      this._cross = 1; // crossfade progress from snapshot S
      this._act = null;
      this._sitL = null;
      this._seatY = 0;
      this._t = 0;
      this._blinkT = 1 + Math.random() * 3; this._blinking = 0;
      this._exprOverride = null; this._exprT = 0;
      this._talkT = 0; this._talkOpen = false;
      this._faceFace = ''; this._faceExpr = '';
      this._look = null; this._lookY = 0; this._lookX = 0; this._lookW = 0;
      this._idleLook = 0; this._idleLookT = 2 + Math.random() * 4; this._idleLookTarget = 0;
      this._fing = [0, 0, 0];
      this.currentAction = null;
      this.setAppearance(appearance);
      this._apply(this._F);
    }

    // -------------------------------------------------------------- appearance
    setAppearance(appearance) {
      const app = normalize(appearance);
      this.appearance = app;
      applyPalette(this.material, app);
      const geo = bodyGeometry(app);
      if (!this.mesh) {
        this.mesh = new THREE.SkinnedMesh(geo, this.material);
        this.mesh.name = 'avatarBody';
        this.mesh.bind(this.skeleton, IDENTITY);
        this.mesh.boundingSphere = sharedBounds;
        this.mesh.boundingBox = sharedBox;
        this.mesh.castShadow = this.opts.shadow !== false;
        this.mesh.receiveShadow = true;
        this.scaler.add(this.mesh);
      } else if (this.mesh.geometry !== geo) {
        this.mesh.geometry = geo; // shared cached geometry: never dispose it here
      }
      this.face.castShadow = false;
      this.face.receiveShadow = true;
      this.heightMul = app.height;
      this.scaler.scale.setScalar(app.height);
      this.height = 1.45 * app.height;
      const top = HEAD_TOP[app.accessory] || (app.hair === 'bun' ? 1.47 : 1.43);
      this.headAnchor.position.set(0, top + 0.08 - BONES[B.head][3], 0);
      this._faceFace = '';
      return app;
    }

    // -------------------------------------------------------------- held props
    setHeld(name) {
      name = name || null;
      if (name === this._heldName) return;
      this._heldName = name;
      this.held = name;
      if (this._heldMesh) { this._heldMesh.parent?.remove(this._heldMesh); this._heldMesh = null; }
      if (!name) return;
      const g = heldGeometry(name);
      if (!g) return;
      if (!heldMat) heldMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.05 });
      const m = new THREE.Mesh(g, heldMat);
      m.name = 'held:' + name;
      m.castShadow = this.opts.shadow !== false;
      m.position.set(0, 0, 0);
      this.handR.add(m);
      this._heldMesh = m;
    }

    /** look at a world point (Vector3 / {x,y,z}) or follow an Object3D (e.g. another rig's headAnchor); null = free */
    setLookTarget(v) { this._look = v && (v.isObject3D || Number.isFinite(v.x)) ? v : null; }
    setExpression(expr, seconds = 2) { this._exprOverride = expr || null; this._exprT = expr ? seconds : 0; }

    // -------------------------------------------------------------- actions
    setAnim(name, opts = {}) {
      if (!name || LOCO.has(name)) { this.stopAll(); return; }
      const def = ACTIONS[name];
      if (!def) { G.log.warn('AVATAR', `unknown animation "${name}"`); return; }
      if (name === 'sit') {
        // persistent base layer: seated characters can still wave / talk / clap on top of it
        this._seatY = opts.seatY != null && Number.isFinite(opts.seatY) ? Math.max(0, opts.seatY) : 0;
        if (this._act && this._act.def.fullBody && !this._act.stopping) this.stopAction();
        if (!this._sitL || this._sitL.stopping) this._sitL = { t: 0, w: this._sitL ? this._sitL.w : 0, stopping: false };
        this._syncCurrent();
        return;
      }
      if (def.fullBody && this._sitL && !this._sitL.stopping) this._sitL.stopping = true;
      if (this._act && this._act.name === name && !this._act.stopping && (opts.loop ?? def.loop) && !opts.restart) return;
      const prev = this._act;
      if (prev) { this._S.set(this._F); this._cross = 0; this._finishAction(prev, true); }
      const loop = opts.loop ?? !!def.loop;
      this._act = { name, def, t: 0, loop, dur: opts.duration ?? (loop ? Infinity : def.dur || 1.5), speed: opts.speed || 1, w: prev ? 1 : 0, stopping: false, onEnd: opts.onEnd || null, prevHeld: this._heldName };
      if (def.held) this.setHeld(def.held);
      this._syncCurrent();
    }
    /** stop the layered action (or, when none is playing, stand up from sitting) */
    stopAction() {
      if (this._act && !this._act.stopping) { this._act.stopping = true; this._syncCurrent(); return; }
      if (this._sitL && !this._sitL.stopping) { this._sitL.stopping = true; this._syncCurrent(); }
    }
    /** stop everything (action + sitting) */
    stopAll() {
      if (this._act && !this._act.stopping) this._act.stopping = true;
      if (this._sitL && !this._sitL.stopping) this._sitL.stopping = true;
      this._syncCurrent();
    }
    get sitting() { return !!(this._sitL && !this._sitL.stopping); }
    /** current gait (read-only numbers): ground speed, metres per cycle, cycles per second, blend weights */
    get gait() {
      const g = this._gaitOut || (this._gaitOut = { speed: 0, stride: 1.45, cadence: 0, fast: 0, sprint: 0 });
      g.speed = this._gaitV; g.stride = this._cyc; g.cadence = this._cyc > 0 ? this._gaitV / this._cyc : 0; g.fast = this._fastW; g.sprint = this._sprintW;
      return g;
    }
    _syncCurrent() {
      this.currentAction = this._act && !this._act.stopping ? this._act.name : this.sitting ? 'sit' : null;
    }
    _finishAction(a, replaced) {
      if (a.def.held && this._heldName === a.def.held) this.setHeld(a.prevHeld && a.prevHeld !== a.def.held ? a.prevHeld : null);
      if (!replaced) { this._act = null; this._syncCurrent(); }
      try { a.onEnd?.(); } catch (e) { G.log.error('AVATAR', e); }
    }
    get actionFullBody() { return !!(this._act && !this._act.stopping && this._act.def.fullBody) || this.sitting; }

    // -------------------------------------------------------------- per-frame
    update(dt, p) {
      if (!(dt > 0)) return;
      const speed = p && p.speed > 0 ? p.speed : 0;
      const grounded = !p || p.grounded !== false;
      const vy = (p && p.vy) || 0;
      this._t += dt;
      const t = this._t;

      // locomotion weights
      this._moveW += (clamp(speed / 3.0, 0, 1) - this._moveW) * damp(9, dt);
      this._runW += (clamp((speed - 3.3) / 2.4, 0, 1) - this._runW) * damp(6, dt);
      this._fastW += (clamp((speed - FAST0) / (FAST1 - FAST0), 0, 1) - this._fastW) * damp(8, dt);
      this._sprintW += (clamp((speed - SPRINT0) / (SPRINT1 - SPRINT0), 0, 1) - this._sprintW) * damp(5, dt);
      this._airW += ((grounded ? 0 : 1) - this._airW) * damp(grounded ? 16 : 10, dt);
      this._gaitV += (speed - this._gaitV) * damp(12, dt);
      if (!Number.isFinite(this._gaitV)) this._gaitV = 0;
      if (speed > 0.05) {
        // playback rate = ground speed / stride length: the feet never slide (stride grows with speed)
        const cyc = strideLength(this._gaitV, this._runW, this._fastW);
        this._cyc = cyc;
        const prevHalf = Math.floor(this.phase * 2);
        this.phase = (this.phase + (speed * dt) / cyc) % 1;
        if (!Number.isFinite(this.phase)) this.phase = 0;
        if (Math.floor(this.phase * 2) !== prevHalf && grounded && this._moveW > 0.3) this.steps++;
      }
      if (!this._grounded && grounded) { this._landT = 0; this._landAmt = clamp(-this._lastVy / 9, 0.12, 1); }
      this._grounded = grounded;
      if (!grounded) this._lastVy = vy;
      this._landT += dt;

      const L = this._L;
      this._loco(L, t, vy);
      const sl = this._sitL;
      if (sl) {
        sl.t += dt;
        if (sl.stopping) sl.w -= dt / 0.3; else sl.w = Math.min(1, sl.w + dt / 0.3);
        if (sl.w <= 0 && sl.stopping) { this._sitL = null; this._syncCurrent(); }
        else {
          const A = this._A;
          A.set(L);
          ACTIONS.sit.pose(A, sl.t, sl, this);
          const w = smooth(0, 1, sl.w);
          for (let i = 0; i < NCH; i++) L[i] += (A[i] - L[i]) * w;
        }
      }

      // action layer
      const F = this._F;
      const a = this._act;
      if (a) {
        a.t += dt * a.speed;
        if (a.stopping) a.w -= dt / 0.28; else a.w = Math.min(1, a.w + dt / 0.22);
        if (!a.loop && a.t >= a.dur && !a.stopping) { a.stopping = true; this._syncCurrent(); }
        if (a.w <= 0 && a.stopping) { this._finishAction(a, false); F.set(L); }
        else {
          const A = this._A;
          A.set(L);
          a.def.pose(A, a.t, a, this);
          const w = smooth(0, 1, a.w);
          for (let i = 0; i < NCH; i++) F[i] = L[i] + (A[i] - L[i]) * w;
        }
      } else F.set(L);
      if (this._cross < 1) {
        this._cross = Math.min(1, this._cross + dt / 0.25);
        const k = smooth(0, 1, this._cross);
        const S = this._S;
        for (let i = 0; i < NCH; i++) F[i] = S[i] + (F[i] - S[i]) * k;
      }

      // look-at (additive, smoothed)
      let ly = 0, lx = 0, lw = 0;
      if (this._look) {
        if (this._look.isObject3D) this._look.getWorldPosition(_v); else _v.set(this._look.x, this._look.y, this._look.z);
        this.group.worldToLocal(_v);
        const hy = HC * this.heightMul;
        const yaw = Math.atan2(_v.x, _v.z);
        if (Math.abs(yaw) < 2.0) { ly = clamp(yaw, -1.05, 1.05); lx = clamp(-Math.atan2(_v.y - hy, Math.hypot(_v.x, _v.z)), -0.45, 0.4); lw = 1; }
      } else if (this._moveW < 0.2 && !a && !this._sitL) {
        this._idleLookT -= dt;
        if (this._idleLookT <= 0) { this._idleLookTarget = Math.random() < 0.45 ? 0 : (Math.random() - 0.5) * 1.1; this._idleLookT = 2.5 + Math.random() * 4; }
        ly = this._idleLookTarget; lw = 1;
      }
      const ld = damp(lw ? 5 : 4, dt);
      this._lookY += (ly - this._lookY) * ld; this._lookX += (lx - this._lookX) * ld;
      F[C.neckY] += this._lookY * 0.35; F[C.headY] += this._lookY * 0.65;
      F[C.neckX] += this._lookX * 0.35; F[C.headX] += this._lookX * 0.65;

      this._apply(F);
      this._updateFace(dt);
    }

    _loco(o, t, vy) {
      o.fill(0);
      const sd = this._seed * 10;
      const br = Math.sin(t * 2.1 + sd);
      // idle
      o[C.spineX] = 0.025 + 0.018 * br; o[C.headX] = -0.02 - 0.012 * br;
      o[C.shLZ] = 0.14 + 0.02 * br; o[C.shRZ] = -0.14 - 0.02 * br; o[C.shLX] = 0.02; o[C.shRX] = 0.02;
      o[C.elLX] = -0.14; o[C.elRX] = -0.14; o[C.hdLZ] = -0.08; o[C.hdRZ] = 0.08;
      o[C.hipsZ] = 0.025 * Math.sin(t * 0.55 + sd); o[C.spineZ] = -o[C.hipsZ] * 0.7;
      o[C.thLZ] = 0.035; o[C.thRZ] = -0.035; o[C.knLX] = 0.03; o[C.knRX] = 0.03; o[C.ftLZ] = -0.03; o[C.ftRZ] = 0.03;
      o[C.ponyX] = 0.04 * Math.sin(t * 1.3 + sd); o[C.ponyZ] = 0.04 * Math.sin(t * 0.9 + sd);
      // walk / run
      const mw = this._moveW;
      if (mw > 0.002) {
        const rw = this._runW;
        const s = Math.sin(this.phase * TAU), c = Math.cos(this.phase * TAU);
        const A = lerp(0.46, 0.68, rw), K0 = lerp(0.1, 0.32, rw), KB = lerp(0.8, 1.45, rw);
        mix(o, C.thLX, -A * s, mw); mix(o, C.thRX, A * s, mw);
        mix(o, C.knLX, K0 + KB * Math.max(0, c), mw); mix(o, C.knRX, K0 + KB * Math.max(0, -c), mw);
        mix(o, C.ftLX, -(-A * s + K0 + KB * Math.max(0, c)) * 0.65 + 0.12 * Math.max(0, -s), mw);
        mix(o, C.ftRX, -(A * s + K0 + KB * Math.max(0, -c)) * 0.65 + 0.12 * Math.max(0, s), mw);
        mix(o, C.thLZ, 0.02, mw); mix(o, C.thRZ, -0.02, mw);
        const armA = lerp(0.42, 0.62, rw);
        mix(o, C.shLX, armA * s, mw); mix(o, C.shRX, -armA * s, mw);
        mix(o, C.shLZ, lerp(0.12, 0.2, rw), mw); mix(o, C.shRZ, -lerp(0.12, 0.2, rw), mw);
        mix(o, C.elLX, -lerp(0.3, 1.35, rw) - 0.12 * Math.max(0, -s), mw); mix(o, C.elRX, -lerp(0.3, 1.35, rw) - 0.12 * Math.max(0, s), mw);
        mix(o, C.spineX, lerp(0.07, 0.24, rw), mw); mix(o, C.spineY, 0.12 * s * (1 - rw * 0.3), mw);
        mix(o, C.hipsY, -0.09 * s, mw); mix(o, C.hipsZ, 0.035 * c, mw);
        mix(o, C.headY, -0.1 * s, mw); mix(o, C.headX, -lerp(0.04, 0.14, rw), mw);
        mix(o, C.ponyX, -0.15 - 0.25 * rw + 0.1 * Math.sin(this.phase * TAU * 2), mw); mix(o, C.ponyZ, 0.08 * s, mw);
        mix(o, C.bagX, 0.05 * Math.sin(this.phase * TAU * 2) * (0.4 + rw), mw);
        mix(o, C.skirtZ, 0.03 * s, mw);
      }
      // fast gait (IK bounding run) + sprint pose
      const fw = this._fastW * mw;
      if (fw > 0.002) this._fastGait(o, t, fw);
      // air
      const aw = this._airW;
      if (aw > 0.002) {
        const up = clamp((vy + 1) / 5, 0, 1);
        mix(o, C.thLX, lerp(-0.25, -0.75, up), aw); mix(o, C.thRX, lerp(0.12, -0.12, up), aw);
        mix(o, C.knLX, lerp(0.35, 1.25, up), aw); mix(o, C.knRX, lerp(0.25, 0.55, up), aw);
        mix(o, C.ftLX, 0.25, aw); mix(o, C.ftRX, 0.3, aw);
        mix(o, C.shLZ, lerp(1.15, 0.55, up), aw); mix(o, C.shRZ, -lerp(1.15, 0.55, up), aw);
        mix(o, C.shLX, lerp(-0.2, -0.6, up), aw); mix(o, C.shRX, lerp(-0.2, -0.6, up), aw);
        mix(o, C.elLX, -0.45, aw); mix(o, C.elRX, -0.45, aw);
        mix(o, C.spineX, lerp(-0.04, 0.1, up), aw); mix(o, C.headX, lerp(0.05, -0.1, up), aw);
        mix(o, C.ponyX, lerp(-0.6, 0.4, up), aw); mix(o, C.squash, lerp(-0.02, 0.06, up), aw);
      }
      // landing squash & knee dip
      if (this._landT < 0.6) {
        const e = this._landAmt * Math.exp(-this._landT * 9) * Math.min(1, this._landT * 40);
        o[C.thLX] -= 0.55 * e; o[C.thRX] -= 0.55 * e; o[C.knLX] += 1.1 * e; o[C.knRX] += 1.1 * e;
        o[C.ftLX] -= 0.5 * e; o[C.ftRX] -= 0.5 * e;
        o[C.spineX] += 0.22 * e; o[C.squash] -= 0.13 * e;
        o[C.shLZ] += 0.35 * e; o[C.shRZ] -= 0.35 * e;
      }
    }

    _fastGait(o, t, fw) {
      const sw = this._sprintW;
      const cyc = Math.max(0.5, this._cyc);
      const duty = clamp(SWEEP / cyc, 0.05, 0.42);       // stance share of a leg's cycle
      const S2 = SWEEP * 0.5;
      const H = lerp(0.12, 0.18, sw);                     // swing foot lift
      const crouch = lerp(0.05, 0.062, sw);
      const phL = this.phase, phR = (this.phase + 0.5) % 1;
      const fl = footPath(phL, duty, S2, H, sw, _fpL), fr = footPath(phR, duty, S2, H, sw, _fpR);
      // body: lowest at mid-stance, a short ballistic hop between steps (exaggerated a little for readability)
      const psi = (this.phase * 2) % 1, d2 = Math.min(0.9, duty * 2);
      const bobAmp = lerp(0.035, 0.07, sw);
      const bob = psi < d2 ? -0.018 * Math.sin(Math.PI * psi / d2) : bobAmp * Math.sin(Math.PI * (psi - d2) / (1 - d2));
      const hipY = (L1 + L2 + LF) - crouch + bob;
      legIK(fl.z, -(hipY - LF - fl.y), _ikA);
      legIK(fr.z, -(hipY - LF - fr.y), _ikB);
      // toes: push off at the end of stance, reach (toes up) before touchdown
      mix(o, C.thLX, _ikA[0], fw); mix(o, C.knLX, _ikA[1], fw); mix(o, C.ftLX, -(_ikA[0] + _ikA[1]) + toeAngle(phL, duty), fw);
      mix(o, C.thRX, _ikB[0], fw); mix(o, C.knRX, _ikB[1], fw); mix(o, C.ftRX, -(_ikB[0] + _ikB[1]) + toeAngle(phR, duty), fw);
      mix(o, C.thLZ, 0.03, fw); mix(o, C.thRZ, -0.03, fw);
      // the auto ground contact drops the body until the lowest foot touches: give back the lift of a flight phase
      mix(o, C.rootY, Math.min(fl.y, fr.y), fw);
      // upper body: forward lean, opposite arm pump with bent elbows, torso twist, head looking ahead
      const aw = clamp(fl.z / (S2 + 0.1), -1, 1), bw = clamp(fr.z / (S2 + 0.1), -1, 1);
      const armA = lerp(0.72, 1.08, sw);
      mix(o, C.shLX, -armA * bw * 0.9 + 0.12, fw); mix(o, C.shRX, -armA * aw * 0.9 + 0.12, fw);
      mix(o, C.shLZ, lerp(0.16, 0.1, sw), fw); mix(o, C.shRZ, -lerp(0.16, 0.1, sw), fw);
      mix(o, C.elLX, -lerp(1.35, 1.65, sw) - 0.25 * Math.max(0, bw), fw); mix(o, C.elRX, -lerp(1.35, 1.65, sw) - 0.25 * Math.max(0, aw), fw);
      mix(o, C.hdLZ, -0.15, fw); mix(o, C.hdRZ, 0.15, fw);
      const tw = (aw - bw) * 0.5;
      mix(o, C.hipsY, 0.11 * tw, fw); mix(o, C.spineY, -0.15 * tw, fw);
      mix(o, C.hipsX, lerp(0.05, 0.12, sw), fw);
      mix(o, C.spineX, lerp(0.3, 0.46, sw), fw);
      mix(o, C.headX, -lerp(0.2, 0.32, sw), fw); mix(o, C.headY, 0.04 * tw, fw);
      mix(o, C.hipsZ, 0.025 * tw, fw);
      // stance compression (cartoon squash) and streaming hair / bag
      mix(o, C.squash, -0.035 * Math.max(fl.stance, fr.stance), fw);
      mix(o, C.ponyX, -0.75 - 0.35 * sw + 0.12 * Math.sin(t * 17), fw); mix(o, C.ponyZ, 0.08 * tw, fw);
      mix(o, C.bagX, -0.12 - 0.1 * sw + 0.08 * Math.sin(this.phase * TAU * 2), fw);
      mix(o, C.skirtX, 0.22 + 0.1 * sw, fw);
    }

    _apply(F) {
      const b = this.bone;
      // auto ground contact: the longer leg reaches the floor
      const hL = L1 * Math.cos(F[C.thLX]) * Math.cos(F[C.thLZ]) + L2 * Math.cos(F[C.thLX] + F[C.knLX]) + LF;
      const hR = L1 * Math.cos(F[C.thRX]) * Math.cos(F[C.thRZ]) + L2 * Math.cos(F[C.thRX] + F[C.knRX]) + LF;
      const drop = (L1 + L2 + LF) - Math.max(hL, hR);
      const groundY = -drop * (1 - this._airW * 0.85);
      const seatRoot = F[C.seatY] + 0.075 - HIP;
      const sw = clamp(F[C.seatW], 0, 1);
      const sq = F[C.squash];
      b.root.position.y = lerp(groundY, seatRoot, sw) + F[C.rootY];
      b.root.rotation.y = F[C.rootRY];
      b.root.scale.set(1 - sq * 0.5, 1 + sq, 1 - sq * 0.5);
      b.hips.rotation.set(F[C.hipsX], F[C.hipsY], F[C.hipsZ]);
      b.spine.rotation.set(F[C.spineX], F[C.spineY], F[C.spineZ]);
      b.neck.rotation.set(F[C.neckX], F[C.neckY], F[C.neckZ]);
      b.head.rotation.set(F[C.headX], F[C.headY], F[C.headZ]);
      b.shL.rotation.set(F[C.shLX], F[C.shLY], F[C.shLZ]);
      b.elL.rotation.set(F[C.elLX], F[C.elLY], F[C.elLZ]);
      b.hdL.rotation.set(F[C.hdLX], F[C.hdLY], F[C.hdLZ]);
      b.shR.rotation.set(F[C.shRX], F[C.shRY], F[C.shRZ]);
      b.elR.rotation.set(F[C.elRX], F[C.elRY], F[C.elRZ]);
      b.hdR.rotation.set(F[C.hdRX], F[C.hdRY], F[C.hdRZ]);
      b.thL.rotation.set(F[C.thLX], F[C.thLY], F[C.thLZ]);
      b.knL.rotation.set(F[C.knLX], 0, 0);
      b.ftL.rotation.set(F[C.ftLX], 0, F[C.ftLZ]);
      b.thR.rotation.set(F[C.thRX], F[C.thRY], F[C.thRZ]);
      b.knR.rotation.set(F[C.knRX], 0, 0);
      b.ftR.rotation.set(F[C.ftRX], 0, F[C.ftRZ]);
      b.pony.rotation.set(F[C.ponyX], 0, F[C.ponyZ]);
      b.bag.rotation.set(F[C.bagX], 0, 0);
      const thAvg = (F[C.thLX] + F[C.thRX]) * 0.5;
      b.skirt.rotation.set(F[C.skirtX] || thAvg * 0.35, 0, F[C.skirtZ]);
      b.fgP.scale.setScalar(Math.max(1e-3, clamp(F[C.fgP], 0, 1)));
      b.fgV.scale.setScalar(Math.max(1e-3, clamp(F[C.fgV], 0, 1)));
      b.fgT.scale.setScalar(Math.max(1e-3, clamp(F[C.fgT], 0, 1)));
    }

    _updateFace(dt) {
      const app = this.appearance;
      const a = this._act;
      let expr = 'base';
      if (this._exprOverride) { this._exprT -= dt; if (this._exprT <= 0) this._exprOverride = null; else expr = this._exprOverride; }
      if (expr === 'base' && a && !a.stopping && a.def.face) expr = typeof a.def.face === 'function' ? a.def.face(a.t) : a.def.face;
      if (expr === 'talk') {
        this._talkT -= dt;
        if (this._talkT <= 0) { this._talkOpen = !this._talkOpen; this._talkT = 0.07 + Math.random() * 0.12; }
        if (!this._talkOpen) expr = 'base';
      }
      // blink
      this._blinkT -= dt;
      if (this._blinking > 0) { this._blinking -= dt; if (expr === 'base' || expr === 'talk' || expr === 'think') expr = 'blink'; }
      else if (this._blinkT <= 0) { this._blinking = 0.12; this._blinkT = 2 + Math.random() * 3.5; if (Math.random() < 0.15) this._blinkT = 0.25; }
      // (compared field by field: building a 'face:expr' key string every frame was per-frame garbage for every avatar)
      if (app.face !== this._faceFace || expr !== this._faceExpr) { this._faceFace = app.face; this._faceExpr = expr; this.face.material = faceMaterial(app.face, expr); }
    }

    dispose() {
      this.group.parent?.remove(this.group);
      this.setHeld(null);
      this._act = null; this._sitL = null; this._look = null;
      this.material.dispose();
      this.skeleton.dispose();
      this.mesh = null;
    }
  }

  G.avatar = {
    defaultAppearance: Object.freeze({ ...DEFAULT }),
    options: OPTIONS,
    labels: LABELS,
    heightRange: { min: 0.9, max: 1.1, step: 0.05, default: 1 },
    anims: Object.keys(LABELS.anims),
    actions: Object.fromEntries(Object.entries(ACTIONS).map(([k, d]) => [k, { loop: !!d.loop, duration: d.dur || null, fullBody: !!d.fullBody, held: d.held || null }])),
    normalize,
    random,
    // every read of .appearance is a fresh normalized copy: callers may edit it freely, the presets never change
    presets: Object.freeze(PRESETS_RAW.map((p) => Object.freeze({ id: p.id, emoji: p.emoji, label: p.label, say: p.say, get appearance() { return normalize(p.app); } }))),
    create(appearance, opts = {}) { return new Rig(appearance, opts); },
    /** pre-build geometry/face textures for a list of appearances (avoids hitches later) */
    warm(list) { for (const a of list || []) { try { bodyGeometry(normalize(a)); } catch (e) { G.log.warn('AVATAR', 'warm failed', e); } } for (const f of OPTIONS.face) faceMaterial(f, 'base'); },
    slotColors,
    _ACTIONS: ACTIONS,
  };
})();
