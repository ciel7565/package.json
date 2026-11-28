// =============================================================================
// 20-avatar.js — procedural avatars (G.avatar): the realistic style `real` (default for new profiles, CONTRACT §17.7)
//                and the round style `cute` (귀여운 모습, kept for older saves and for whoever likes it)
//
//   G.avatar.defaultAppearance / options / labels / heightRange
//   G.avatar.normalize(app) -> complete, validated appearance
//   G.avatar.random(seed) -> appearance
//   G.avatar.presets -> 15 ready-made looks [{id, emoji, label, say, appearance}] (frozen, normalized; the first six are
//                       the title screen's picks) — data in 02-avatar-data.js
//   G.avatar.far.create(max) -> instanced far figures for crowds (one draw call); G.avatar.triangles(app); G.avatar.cache
//                       (bounded: { size, max, clear() } — least recently used bodies no rig wears are given back)
//   G.avatar.slots / expressions -> the table's wearable keys and nine faces (G.data.avatar, 02-avatar-data.js)
//   Hanbok only (§19.1, lane hanbok): the realistic body is built from the garment kit below (OUTER_KIT · TOP_KIT ·
//   BOTTOM_KIT tables → robe / crossCollar / sleeves / chima / baji / shoe parts; hats as lathe profiles and shells;
//   꾸미개 in their own slots); the round style and the far figures draw each piece as its nearest simple form (view).
//   G.avatar.create(appearance, {shadow=true}) -> rig
//     rig.group (feet at y=0, faces +Z, ~1.45 m), rig.height, rig.headAnchor, rig.handR, rig.handL
//     rig.update(dt, {speed, grounded, vy})      locomotion: idle / walk / run / jump / fall / land; above
//                                                ~5 m/s an IK bounding run + sprint pose (stride grows with
//                                                speed, playback = speed / stride: no foot sliding)
//     rig.gait -> {speed, stride, cadence, fast, sprint}  (read-only; for fx / audio / camera)
//     rig.setAnim(name, {loop, duration, speed, seatY, onEnd})  layered actions
//     rig.flip(dur = 0.5)                        double jump (§14.2): a 360° forward tuck-flip about the body centre,
//                                                eased in/out (no overshoot), knees up and arms in, landing squash as usual
//     rig.stopAction(), rig.currentAction, rig.setAppearance(app), rig.setHeld(name|null),
//     rig.setLookTarget(vec3|null), rig.setExpression(expr, seconds), rig.dispose()
//       expr: the nine of the table (neutral smile laugh surprise curious proud shy sleepy focus) or the passing ones
//       (happy wink blink think talk); appearance.expr is the usual face
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

  // ---------------------------------------------------------------- options / labels (table: 02-avatar-data.js)
  const DATA = (G.data && G.data.avatar) || {};
  const OPTIONS = DATA.options;
  const COLOR_KEYS = new Set(DATA.colorKeys);
  const HEX = /^#[0-9a-f]{6}$/i;
  const LEGACY_HAT = new Set(['strawhat', 'headband', 'cap', 'gat']);   // phase ≤ 8: hats were kept as accessories
  const MIGRATE = DATA.migrate || {};
  const NAMES = DATA.names || {};
  const own = (o, k) => o != null && Object.prototype.hasOwnProperty.call(o, k);

  const LABELS = {
    keys: {
      style: '모습', skin: '피부색', face: '눈매', expr: '표정', hair: '머리 모양', hairColor: '머리 색', beard: '수염', hat: '쓰개', hatColor: '쓰개 색',
      outer: '겉옷', outerColor: '겉옷 색', top: '저고리', topColor: '저고리 색', trimColor: '회장 색', pattern: '옷감과 무늬', bottom: '아래옷', bottomColor: '아래옷 색',
      footwear: '신', shoes: '신 색', norigae: '노리개', norigaeColor: '노리개 색', pouch: '주머니', pouchColor: '주머니 색', fan: '부채', hairpin: '머리꽂이',
      ribbon: '댕기', ribbonColor: '댕기 색', belt: '띠', beltColor: '띠 색', bag: '짐', bagColor: '짐 색', accessoryColor: '꾸미개 색', height: '키',
    },
    style: { real: '진짜 같은 모습', cute: '귀여운 모습' },
    face: { smile: '웃는 눈', calm: '차분한 눈', cheer: '활짝 웃음', gentle: '순한 눈', bright: '또렷한 눈' },
    height: { 0.9: '아담하게', 0.95: '조금 작게', 1: '보통', 1.05: '조금 크게', 1.1: '크게' },
    anims: {
      idle: '대기', walk: '걷기', run: '달리기', jump: '점프', fall: '낙하', sit: '앉기', wave: '손 흔들기', bow: '인사(절)', clap: '박수',
      thumbsup: '엄지척', point: '가리키기', photo: '브이 포즈', celebrate: '만세', surprise: '깜짝', nod: '끄덕끄덕', heart: '하트',
      dance: '춤추기', think: '생각하기', water: '물 주기', harvest: '수확하기', interact: '살펴보기', talk: '이야기하기',
    },
    colors: {
      '#fde3cf': '밝은 살구', '#f6d0b1': '살구', '#efc6a2': '복숭아', '#e6b48d': '밀색', '#d9a77f': '황갈색', '#c68b62': '구릿빛', '#a86d48': '갈색', '#7d4f33': '짙은 갈색',
      '#1f1a18': '흑색', '#2f2520': '흑갈색', '#3a2a20': '진갈색', '#4a3a2c': '고동색', '#6b4a2e': '밤색', '#8a5a34': '갈색', '#b07a45': '밝은 갈색', '#d9b26f': '금발', '#b9b4ad': '은회색', '#6e3b4e': '자적색',
      '#f5f0e6': '아이보리', '#2a1d14': '흑갈색', '#7a4a2c': '갈색', '#e2c27a': '짚색', '#8a5a3b': '가죽 갈색', '#b88a4a': '대나무색', '#cfcac2': '은백색', '#6e2f4e': '자줏빛',
    },
  };
  // the Hangul names of the table (02-avatar-data.js) and the traditional dye names win over the plain colour words
  for (const [k, m] of Object.entries(NAMES)) LABELS[k] = Object.assign({}, LABELS[k] || {}, m);
  for (const d of DATA.dyes || []) LABELS.colors[d.hex] = d.name;

  const DEFAULT = Object.assign({}, DATA.defaults);

  /**
   * a complete, valid appearance. Unknown ids / colours fall back to the default; a look WITHOUT `style` is an older
   * save (phase ≤ 8) and keeps the round style; a hat stored as `accessory` moves to `hat` (with its colour). Every id
   * of `legacy` (modern clothes, pieces that now have a key of their own) becomes its hanbok counterpart (`migrate`).
   */
  function normalize(a) {
    const src = a && typeof a === 'object' ? a : {};
    const s = {};
    for (const k of Object.keys(src)) if (k !== '__proto__' && k !== 'constructor' && k !== 'prototype') s[k] = src[k];
    const old = !own(src, 'style') && Object.keys(src).length > 0;
    if (old) {
      if (s.hat === undefined && LEGACY_HAT.has(s.accessory)) { s.hat = s.accessory; s.hatColor = s.accessoryColor; s.accessory = 'none'; }
      if (s.footwear === undefined) s.footwear = 'sneakers';
      if (s.top === undefined) s.top = 'jacket';
      if (s.bottom === undefined) s.bottom = 'pants';
    }
    const given = Object.assign({}, s);
    for (const k of Object.keys(MIGRATE)) {
      const map = MIGRATE[k], v = s[k];
      if (typeof v !== 'string' || !own(map, v)) continue;
      if (k === 'accessory' && LEGACY_HAT.has(v)) { if (s.hat === undefined || s.hat === 'none') { s.hat = v; if (s.hatColor === undefined) s.hatColor = given.accessoryColor; } continue; }
      if (OPTIONS[k] && OPTIONS[k].includes(v)) continue; // still a current id of that key
      const m = map[v];
      for (const k2 of Object.keys(m)) {
        const v2 = m[k2];
        const val = typeof v2 === 'string' && v2[0] === '$' ? given[v2.slice(1)] : v2;
        if (val === undefined) continue;
        if (k2 === k || COLOR_KEYS.has(k2) || given[k2] === undefined || given[k2] === 'none') s[k2] = val;
      }
      if (!own(m, k)) delete s[k];
    }
    const out = {};
    for (const k of Object.keys(DEFAULT)) {
      const v = s[k];
      if (k === 'height') { const n = Number(v); out.height = Number.isFinite(n) && v !== null && v !== '' && typeof v !== 'boolean' ? Math.round(clamp(n, 0.9, 1.1) * 100) / 100 : DEFAULT.height; continue; }
      if (COLOR_KEYS.has(k)) { out[k] = typeof v === 'string' && HEX.test(v) ? v.toLowerCase() : DEFAULT[k]; continue; }
      out[k] = OPTIONS[k] && OPTIONS[k].includes(v) ? v : DEFAULT[k];
    }
    if (old) out.style = 'cute';
    if (out.hat === 'strawhat' && src.hatColor === undefined && !old) out.hatColor = '#e2c27a';
    return out;
  }

  /** a random look from a seed (visitors in the valley): always hanbok (§19.0) — a set's pieces, recoloured with dyes */
  function random(seed) {
    const r = G.util.rng(seed == null ? Math.floor(Math.random() * 1e9) : seed);
    const pick = (arr) => arr[Math.floor(r() * arr.length) % arr.length];
    const wpick = (pairs) => { let tot = 0; for (const p of pairs) tot += p[1]; let x = r() * tot; for (const p of pairs) { x -= p[1]; if (x <= 0) return p[0]; } return pairs[0][0]; };
    const style = r() < 0.88 ? 'real' : 'cute';
    const fem = r() < 0.5;
    const dye = (DATA.dyes || []).map((d) => d.hex);
    const calm = dye.filter((h) => lum(h) > 0.55);     // light 저고리 colours
    const deep = dye.filter((h) => lum(h) < 0.5);      // 치마 / 바지 / 겉옷 colours
    const top = wpick([['hanbok', 6], ['banhoejang', fem ? 2.5 : 0.4], ['samhoejang', fem ? 1.2 : 0], ['jeoksam', 2], ['saekdong', 0.6], ['som', 0.6], ['nubi', 0.5], ['kkaekki', fem ? 0.6 : 0], ['saenghwal', 1.2]]);
    const bottom = fem ? wpick([['skirt', 5], ['tongchima', 2], ['mongdang', 0.8], ['seuran', 0.4], ['saenghwal', 0.6]]) : wpick([['pants', 7], ['jambang', 0.8], ['nubibaji', 0.6], ['saenghwal', 0.6]]);
    const outer = wpick([['none', 9], ['durumagi', fem ? 1 : 2.4], ['baeja', 1.4], ['magoja', fem ? 0 : 0.8], ['jokki', fem ? 0 : 0.6], ['kwaeja', 0.4], ['haengju', fem ? 0.8 : 0], ['dopo', fem ? 0 : 0.5]]);
    const hair = fem ? wpick([['jjok', 3], ['daenggi', 3], ['eonjeun', 1], ['bun', 1], ['long', 0.8], ['twinbraid', 0.6], ['gwimit', 0.5]])
      : wpick([['sangtu', 3], ['side', 2], ['short', 2], ['buzz', 1.4], ['ttaeun', 0.8]]);
    let hat = 'none';
    if (r() < 0.38) hat = fem ? wpick([['jobawi', 1], ['ayam', 1], ['jeonmo', 0.5], ['sugeon', 0.6], ['strawhat', 0.4]])
      : (hair === 'sangtu' ? wpick([['gat', 3], ['tanggeon', 0.6], ['paeraengi', 0.8], ['satgat', 0.4]]) : wpick([['bokgeon', 1], ['strawhat', 1], ['sugeon', 1], ['nambawi', 0.4]]));
    const footwear = fem ? wpick([['gomusin', 5], ['kkotsin', 2], ['unhye', 0.6], ['danghye', 0.6], ['jipsin', 0.6]]) : wpick([['gomusin', 5], ['jipsin', 1.4], ['mituri', 1], ['taesahye', 0.8]]);
    return normalize({
      style, skin: pick(OPTIONS.skin.slice(0, 6)), face: pick(OPTIONS.face), expr: wpick([['smile', 5], ['neutral', 2], ['laugh', 1], ['curious', 1]]),
      hair, hairColor: pick(OPTIONS.hairColor.slice(0, 7)), beard: !fem && r() < 0.18 ? pick(['mustache', 'goatee', 'long']) : 'none',
      hat, hatColor: hat === 'strawhat' || hat === 'satgat' || hat === 'paeraengi' || hat === 'jeonmo' ? '#e2c27a' : hat === 'sugeon' ? '#ffffff' : hat === 'jobawi' || hat === 'nambawi' ? pick(['#6e2f4e', '#2e3f6e', '#1f1f22']) : '#1f1f22',
      outer, outerColor: outer === 'haengju' ? '#f1ece1' : pick(deep.concat(calm.slice(0, 4))), top, topColor: pick(calm), trimColor: pick(deep),
      pattern: wpick([['none', 8], ['cloud', 0.6], ['flower', fem ? 0.8 : 0.2], ['mosi', 0.6], ['myeongju', 0.6], ['gyeokja', 0.3], ['jul', 0.3]]),
      bottom, bottomColor: pick(deep.concat(fem ? calm.slice(0, 6) : [])), footwear,
      shoes: footwear === 'gomusin' ? pick(['#f5f0e6', '#1f1f22', '#ffffff']) : footwear === 'jipsin' || footwear === 'mituri' ? '#e2c27a' : pick(OPTIONS.shoes),
      norigae: fem && r() < 0.3 ? pick(['danjak', 'samjak', 'nabi', 'bangul']) : 'none', norigaeColor: pick(OPTIONS.norigaeColor),
      pouch: r() < 0.2 ? pick(['durujumeoni', 'gwijumeoni', 'bokjumeoni']) : 'none', pouchColor: pick(OPTIONS.pouchColor),
      fan: !fem && r() < 0.12 ? 'hapjuk' : 'none', hairpin: fem && hair === 'jjok' && r() < 0.6 ? pick(['binyeo', 'okbinyeo', 'dwikkoji']) : 'none',
      ribbon: fem && hair === 'daenggi' ? 'jebi' : 'none', ribbonColor: pick(OPTIONS.ribbonColor),
      belt: 'none', beltColor: pick(OPTIONS.beltColor), bag: wpick([['none', 8], ['basket', 1], ['botjim', 0.6], ['bojagi', 0.8], ['gwaenari', 0.4]]), bagColor: pick(OPTIONS.bagColor),
      accessoryColor: pick(OPTIONS.accessoryColor), height: Math.round((0.92 + r() * 0.16) * 100) / 100,
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

  // ---------------------------------------------------------------- skeletons (one per style, same bones in the same order)
  // [name, parentIndex, absX, absY, absZ]  (rest pose = zero rotations). Both styles share every channel and action.
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
    ['hairB', 2, 0, 0.84, -0.12],   // hanging hair (braids, long hair) — a spring, follows the head a little
    ['cloth', 2, 0, 0.62, 0.12],    // 고름, 노리개, coat fronts — a spring
  ];
  // the realistic body: 1.62 m at height 1, about seven heads, natural limb lengths (thigh 0.40, shin 0.40, arm 0.54)
  const BONES_REAL = [
    ['root', -1, 0, 0, 0],
    ['hips', 0, 0, 0.95, 0],
    ['spine', 1, 0, 1.03, 0],
    ['neck', 2, 0, 1.405, -0.012],
    ['head', 3, 0, 1.488, -0.004],
    ['shL', 2, 0.182, 1.372, -0.018], ['elL', 5, 0.196, 1.09, -0.03], ['hdL', 6, 0.204, 0.842, -0.012],
    ['shR', 2, -0.182, 1.372, -0.018], ['elR', 8, -0.196, 1.09, -0.03], ['hdR', 9, -0.204, 0.842, -0.012],
    ['thL', 1, 0.09, 0.88, 0], ['knL', 11, 0.092, 0.48, 0], ['ftL', 12, 0.094, 0.08, 0],
    ['thR', 1, -0.09, 0.88, 0], ['knR', 14, -0.092, 0.48, 0], ['ftR', 15, -0.094, 0.08, 0],
    ['pony', 4, 0, 1.6, -0.095],
    ['bag', 2, 0, 1.26, -0.13],
    ['fgP', 10, -0.204, 0.75, 0.004], ['fgV', 10, -0.204, 0.75, 0.004], ['fgT', 10, -0.204, 0.79, 0.03],
    ['skirt', 1, 0, 0.98, 0],
    ['hairB', 2, 0, 1.5, -0.08],
    ['cloth', 2, 0, 1.18, 0.1],
  ];
  const B = {};
  BONES.forEach((b, i) => { B[b[0]] = i; });
  const invOf = (tbl) => tbl.map((b) => new THREE.Matrix4().makeTranslation(-b[2], -b[3], -b[4]));
  const BONE_INV = invOf(BONES), BONE_INV_REAL = invOf(BONES_REAL);
  const IDENTITY = new THREE.Matrix4();

  // proportions of the round style
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

  // per-style kinematics: leg lengths, seat, head centre, gait scales (everything the locomotion maths needs)
  const KIN = {
    cute: { L1: 0.17, L2: 0.185, LF: 0.085, seat: 0.075 - 0.46, HC, height: 1.45, slow: [1.45, 2.25], fast: [1.1, 0.24], sweep: 0.38, lift: [0.12, 0.18], crouch: [0.05, 0.062], bob: [0.035, 0.07], fp: 1, bones: BONES, inv: BONE_INV },
    real: { L1: 0.40, L2: 0.40, LF: 0.08, seat: 0.078 - 0.88, HC: 1.548, height: 1.62, slow: [1.35, 2.2], fast: [1.6, 0.26], sweep: 0.62, lift: [0.2, 0.3], crouch: [0.07, 0.09], bob: [0.035, 0.065], fp: 1.7, bones: BONES_REAL, inv: BONE_INV_REAL },
  };
  for (const k of Object.values(KIN)) { k.max = (k.L1 + k.L2) * 0.999; k.min = Math.abs(k.L1 - k.L2) + 0.03 * k.fp; }

  // [people] §19.9 head counts by build: child ≈ 6.0, youth ≈ 6.6, adult ≈ 7.2, elder ≈ 7.0 heads tall. The garment kit
  // draws ONE adult body; a build re-proportions it bone by bone — every vertex moves with the bones it is skinned to,
  // v' = p'(bone) + S(bone) · (v − p(bone)), blended by its skin weights — and the skeleton follows (p' below), so every
  // piece of clothing keeps fitting and the locomotion maths (KIN) stay exact for the new limb lengths.
  //   leg: length of legs + pelvis · torso: length of the spine · head: size of head and neck (headW: its width) ·
  //   sh / hip: width of chest / pelvis (depth: dz) · lg: girth of the legs · arm: [length, girth] · foot: its length
  const BUILDS = {
    child: { leg: 0.7, torso: 0.94, head: 0.93, headW: 1.04, sh: 0.8, hip: 0.84, dz: 0.88, lg: 0.8, arm: [0.75, 0.8], foot: 0.8 },
    youth: { leg: 0.86, torso: 0.957, head: 0.96, headW: 1.01, sh: 0.9, hip: 0.9, dz: 0.92, lg: 0.88, arm: [0.88, 0.88], foot: 0.92 },
    adult: { leg: 1, torso: 1, head: 0.98, headW: 1, sh: 1, hip: 1, dz: 1, lg: 1, arm: [1, 1], foot: 1.04 },
    elder: { leg: 0.96, torso: 0.998, head: 0.98, headW: 1, sh: 0.98, hip: 1.02, dz: 1.02, lg: 0.94, arm: [0.98, 0.94], foot: 1.02 },
  };
  const ADULT_HAIR = new Set(['sangtu', 'jjok', 'eonjeun', 'keunmeori']);
  const ADULT_HAT = new Set(['gat', 'jeongja', 'tanggeon', 'samo', 'jeollip', 'jokduri', 'hwagwan', 'jeonmo', 'yugeon', 'satgat', 'ayam', 'sugeon', 'paeraengi', 'chorip']);
  const ADULT_OUTER = new Set(['dopo', 'dallyeong', 'gugunbok', 'cheollik', 'wonsam', 'hwarot', 'dangui', 'jangot', 'sseugae', 'hakchang', 'magoja', 'haengju', 'dapho', 'jeonbok']);
  /** the build of a realistic look, from what it wears (no new key: saves and the server's whitelist stay as they are):
   *  grey hair → elder; a married person's hair (상투, 쪽, 얹은머리, 큰머리), a beard, a grown-up's hat or robe → adult;
   *  tall (≥ 1.05) without those → youth; everybody else — the default profile too — is a child */
  function buildOf(app) {
    if (!app || app.style !== 'real') return 'adult';
    const hc = String(app.hairColor || '').toLowerCase();
    if (hc === '#b9b4ad') return 'elder';
    if (ADULT_HAIR.has(app.hair) || (app.beard && app.beard !== 'none') || ADULT_HAT.has(app.hat) || ADULT_OUTER.has(app.outer) || app.bottom === 'jambang') return 'adult';
    if ((Number(app.height) || 1) >= 1.05) return 'youth';
    return 'child';
  }
  /** per-bone scale S (x, y, z) of a build (index = bone) */
  function buildScales(b) {
    const P = BUILDS[b] || BUILDS.adult, out = [];
    const hd = [P.head * P.headW, P.head, P.head * (P.headW * 0.5 + 0.5)], arm = [P.arm[1], P.arm[0], P.arm[1]], leg = [P.lg, P.leg, P.lg];
    for (const [name] of BONES_REAL) {
      let s;
      if (name === 'root') s = [1, P.leg, 1];
      else if (name === 'hips' || name === 'skirt') s = [P.hip, P.leg, P.dz];
      else if (name === 'spine' || name === 'bag' || name === 'cloth') s = [P.sh, P.torso, P.dz];
      else if (name === 'neck' || name === 'head' || name === 'pony' || name === 'hairB') s = hd;
      else if (/^(sh|el|hd)[LR]$|^fg/.test(name)) s = arm;
      else if (/^ft[LR]$/.test(name)) s = [P.lg, P.leg, P.foot];
      else s = leg;
      out.push(s);
    }
    return out;
  }
  /** the re-proportioned skeleton: [name, parent, x', y', z'] (hairB follows the head, as its hair does) */
  function buildBones(b) {
    const S = buildScales(b), out = [];
    BONES_REAL.forEach(([name, parent, x, y, z], i) => {
      let ref = parent;
      if (name === 'hairB') ref = B.head;
      if (ref < 0) { out.push([name, parent, x, y * S[i][1], z]); return; }
      const p = BONES_REAL[ref], q = out[ref], s = S[ref];
      out.push([name, parent, q[2] + s[0] * (x - p[2]), q[3] + s[1] * (y - p[3]), q[4] + s[2] * (z - p[4])]);
    });
    return out;
  }
  /** model-space point of the adult body → the same point on a build, as rigidly attached to bone i */
  function buildPoint(b, i, x, y, z, out) {
    const S = BUILD_CACHE(b), s = S.scales[i], p = BONES_REAL[i], q = S.bones[i];
    out[0] = q[2] + s[0] * (x - p[2]); out[1] = q[3] + s[1] * (y - p[3]); out[2] = q[4] + s[2] * (z - p[4]);
    return out;
  }
  const _buildC = new Map();
  function BUILD_CACHE(b) {
    let c = _buildC.get(b);
    if (!c) { c = { scales: buildScales(b), bones: buildBones(b) }; _buildC.set(b, c); }
    return c;
  }
  /** re-proportion a built adult geometry (positions + normals, by its skin weights) */
  function warpBuild(g, b) {
    if (b === 'adult' && BUILDS.adult.head === 1) return g;
    const C = BUILD_CACHE(b), pa = g.attributes.position, na = g.attributes.normal, si = g.attributes.skinIndex, sw = g.attributes.skinWeight;
    for (let i = 0; i < pa.count; i++) {
      const x = pa.getX(i), y = pa.getY(i), z = pa.getZ(i);
      let ox = 0, oy = 0, oz = 0, nx = 0, ny = 0, nz = 0, wt = 0;
      for (let k = 0; k < 2; k++) {
        const w = sw.getComponent(i, k); if (!(w > 0)) continue;
        const j = si.getComponent(i, k), s = C.scales[j], p = BONES_REAL[j], q = C.bones[j];
        ox += w * (q[2] + s[0] * (x - p[2])); oy += w * (q[3] + s[1] * (y - p[3])); oz += w * (q[4] + s[2] * (z - p[4]));
        if (na) { nx += w * na.getX(i) / s[0]; ny += w * na.getY(i) / s[1]; nz += w * na.getZ(i) / s[2]; }
        wt += w;
      }
      if (!(wt > 0)) continue;
      pa.setXYZ(i, ox / wt, oy / wt, oz / wt);
      if (na) { const l = Math.hypot(nx, ny, nz) || 1; na.setXYZ(i, nx / l, ny / l, nz / l); }
    }
    pa.needsUpdate = true; if (na) na.needsUpdate = true;
    g.computeBoundingSphere();
    return g;
  }
  /** the kinematics of a build (bone rests, inverse binds, leg lengths, seat, head centre, stature) */
  for (const b of Object.keys(BUILDS)) {
    const bones = buildBones(b), K0 = KIN.real, P = BUILDS[b], L = P.leg;
    const hb = bones[B.head], th = bones[B.thL], kn = bones[B.knL], ft = bones[B.ftL];
    const K = Object.assign({}, K0, { bones, inv: invOf(bones), build: b, L1: th[3] - kn[3], L2: kn[3] - ft[3], LF: ft[3],
      seat: ft[3] - th[3], HC: hb[3] + P.head * (K0.HC - BONES_REAL[B.head][3]), height: hb[3] + P.head * (K0.height - BONES_REAL[B.head][3]),
      sweep: K0.sweep * L, lift: K0.lift.map((v) => v * L), crouch: K0.crouch.map((v) => v * L), bob: K0.bob.map((v) => v * L), fp: K0.fp * L,
      headK: [P.head * P.headW, P.head, P.head * (P.headW * 0.5 + 0.5)] });
    K.max = (K.L1 + K.L2) * 0.999; K.min = Math.abs(K.L1 - K.L2) + 0.03 * K.fp;
    KIN['real:' + b] = K;
  }
  const kinKey = (app) => (app.style === 'real' ? 'real:' + buildOf(app) : app.style);

  // ---------------------------------------------------------------- palette slots
  const SLOT = { skin: 0, hair: 1, top: 2, top2: 3, top3: 4, under: 5, bottom: 6, bottom2: 7, shoe: 8, sole: 9, bag: 10, bag2: 11, acc: 12, acc2: 13, white: 14, dark: 15, red: 16, gold: 17, leaf: 18, metal: 19,
    outer: 20, outer2: 21, sleeve: 22, hat: 23, hat2: 24, band: 25,
    // [hanbok] phase 11: 회장 (trim), the 꾸미개 of their own slots, a fixed blue (삼색띠, 전모), the sleeves of a 겉옷
    trim: 26, nor: 27, pouch: 28, rib: 29, belt: 30, blue: 31, osleeve: 32 };
  const NSLOT = 33;
  const ROUGH = [0.6, 0.46, 0.86, 0.8, 0.7, 0.86, 0.82, 0.8, 0.55, 0.72, 0.62, 0.6, 0.5, 0.6, 0.7, 0.5, 0.6, 0.32, 0.72, 0.3, 0.84, 0.8, 0.86, 0.7, 0.6, 0.62,
    0.78, 0.6, 0.7, 0.62, 0.72, 0.7, 0.84];
  // surface kind per slot (shader): 0 plain, 1 woven cloth, 2 hair strands, 3 skin; + 8 × pattern (FX below)
  const KIND = [3, 2, 1, 1, 1, 1, 1, 1, 0, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1];
  const FX = { none: 0, gold: 1, cloud: 2, flower: 3, stripes: 4, straw: 5, tiger: 6, gyeokja: 7, jul: 8, nubi: 9, mosi: 10, myeongju: 11, gwigap: 12, mulgyeol: 13 };
  const STRAW_HATS = new Set(['strawhat', 'chorip', 'paeraengi', 'satgat']);
  const RED_TASSEL = new Set(['ayam', 'jobawi', 'nambawi', 'pungcha', 'jeollip']);
  const GOLD_HAT = new Set(['jokduri', 'hwagwan', 'hogeon', 'gulle', 'sangmo']);

  function slotColors(app) {
    const out = new Array(NSLOT);
    const topL = lum(app.topColor), botL = lum(app.bottomColor);
    const strawFoot = app.footwear === 'jipsin' || app.footwear === 'mituri';
    out[SLOT.skin] = skinTone(app.skin);
    out[SLOT.hair] = app.hairColor;
    out[SLOT.top] = app.topColor;
    out[SLOT.top2] = shade(app.topColor, topL > 0.78 ? -0.2 : topL < 0.2 ? 0.22 : -0.22);
    out[SLOT.top3] = accentFor(app.topColor);
    out[SLOT.under] = topL > 0.6 ? '#7a6250' : '#efe8dc';
    out[SLOT.bottom] = app.bottomColor;
    out[SLOT.bottom2] = shade(app.bottomColor, botL < 0.2 ? 0.18 : -0.25);
    out[SLOT.shoe] = app.footwear === 'jipsin' ? '#c9a964' : app.footwear === 'mituri' ? '#b9a27a' : app.footwear === 'namaksin' ? '#8a6440' : app.shoes;
    out[SLOT.sole] = strawFoot ? '#a88a4c' : app.footwear === 'namaksin' ? '#6e4e30' : lum(app.shoes) > 0.75 ? '#cfc8bb' : '#f2eee6';
    out[SLOT.bag] = app.bagColor;
    out[SLOT.bag2] = shade(app.bagColor, lum(app.bagColor) < 0.2 ? 0.2 : -0.28);
    out[SLOT.acc] = app.accessoryColor;
    out[SLOT.acc2] = shade(app.accessoryColor, lum(app.accessoryColor) < 0.2 ? 0.25 : -0.3);
    out[SLOT.white] = '#f4f1ea';
    out[SLOT.dark] = '#26211e';
    out[SLOT.red] = '#c8323c';
    out[SLOT.gold] = '#e8b84a';
    out[SLOT.leaf] = '#5aa04a';
    out[SLOT.metal] = '#b8bcc2';
    out[SLOT.outer] = app.outerColor;
    out[SLOT.outer2] = shade(app.outerColor, lum(app.outerColor) < 0.2 ? 0.22 : -0.25);
    out[SLOT.sleeve] = app.topColor;
    out[SLOT.hat] = STRAW_HATS.has(app.hat) && !HEX.test(app.hatColor) ? '#e2c27a' : app.hatColor;
    out[SLOT.hat2] = app.hat === 'strawhat' ? '#8a2f2f' : GOLD_HAT.has(app.hat) ? '#e8b84a' : RED_TASSEL.has(app.hat) ? '#c8323c' : shade(app.hatColor, lum(app.hatColor) < 0.2 ? 0.3 : -0.3);
    const chima = !!(BOTTOM_KIT[app.bottom] || {}).chima || app.bottom === 'skirt';
    out[SLOT.band] = app.pattern === 'geumbak' || BOTTOM_KIT[app.bottom]?.bands ? (chima ? shade(app.bottomColor, -0.18) : shade(app.topColor, -0.3)) : out[SLOT.top3];
    if (app.outer === 'dallyeong') out[SLOT.band] = shade(app.outerColor, -0.2);
    out[SLOT.trim] = app.trimColor || out[SLOT.top3];
    out[SLOT.nor] = app.norigaeColor || app.accessoryColor;
    out[SLOT.pouch] = app.pouchColor || app.accessoryColor;
    out[SLOT.rib] = app.ribbonColor || '#c8323c';
    out[SLOT.belt] = app.beltColor || '#2e3f6e';
    out[SLOT.blue] = '#2f5fb0';
    out[SLOT.osleeve] = app.outerColor;
    return out;
  }
  /** pattern per slot (shader): 금박 on bands (and all over a 당의), tone-on-tone motifs and fabrics on the garments, 색동 sleeves */
  function slotFx(app) {
    const fx = new Array(NSLOT).fill(0);
    const P = FX[app.pattern] || 0;
    const tone = app.pattern !== 'geumbak' && app.pattern !== 'saekdong' ? P : 0;
    if (tone) for (const k of ['top', 'bottom', 'outer', 'sleeve', 'osleeve']) fx[SLOT[k]] = tone;
    const OD = OUTER_KIT[app.outer] || {};
    if (app.pattern === 'geumbak') { fx[SLOT.band] = FX.gold; if (app.top === 'dangui' || app.outer === 'dangui') { fx[SLOT.top] = FX.gold; fx[SLOT.outer] = FX.gold; fx[SLOT.osleeve] = FX.gold; } }
    if (BOTTOM_KIT[app.bottom]?.bands || app.outer === 'dangui') fx[SLOT.band] = FX.gold;
    if (app.outer === 'dallyeong') fx[SLOT.band] = FX.cloud;
    if (app.top === 'saekdong' || app.pattern === 'saekdong') fx[SLOT.sleeve] = FX.stripes;
    if (OD.stripes) fx[SLOT.osleeve] = FX.stripes;
    if (app.outer === 'hwarot') fx[SLOT.outer] = FX.flower;
    if ((TOP_KIT[app.top] || {}).quilt) fx[SLOT.top] = fx[SLOT.sleeve] = FX.nubi;
    if (OD.quilt) fx[SLOT.outer] = fx[SLOT.osleeve] = FX.nubi;
    if ((BOTTOM_KIT[app.bottom] || {}).quilt) fx[SLOT.bottom] = FX.nubi;
    if ((TOP_KIT[app.top] || {}).sheer && !tone) fx[SLOT.top] = fx[SLOT.sleeve] = FX.mosi;
    if (app.footwear === 'jipsin' || app.footwear === 'mituri') { fx[SLOT.shoe] = FX.straw; fx[SLOT.sole] = FX.straw; }
    if (app.footwear === 'unhye') fx[SLOT.shoe] = FX.cloud;
    if (STRAW_HATS.has(app.hat)) fx[SLOT.hat] = FX.straw;
    if (app.hat === 'hogeon') fx[SLOT.hat] = FX.tiger;
    if (app.hat === 'gulle') fx[SLOT.hat] = FX.stripes;
    if (app.bag === 'basket') { fx[SLOT.bag] = FX.straw; }
    if (app.pouch === 'bokjumeoni') fx[SLOT.pouch] = FX.gold;
    if (app.ribbon === 'doturak') fx[SLOT.rib] = FX.gold;
    return fx;
  }

  // ---------------------------------------------------------------- geometry helpers
  const _lodV = new THREE.Vector3();
  const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
  function xf(geo, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
    _e.set(rx, ry, rz); _q.setFromEuler(_e); _p.set(x, y, z); _s.set(sx, sy, sz);
    _m4.compose(_p, _q, _s);
    geo.applyMatrix4(_m4);
    return geo;
  }
  // [people] §19.9 the middle level (beyond 12 m): the same kit built with fewer segments (LODK < 1), ≤ 12 000 triangles
  let LODK = 1;
  const lk = (n, min) => (LODK === 1 ? n : Math.max(min, Math.round(n * LODK)));
  const sphere = (r, w = 16, h = 12) => new THREE.SphereGeometry(r, lk(w, 6), lk(h, 4));
  const capsule = (r, len, rs = 8) => new THREE.CapsuleGeometry(r, len, LODK === 1 ? 2 : 1, lk(rs, 5));
  const cyl = (rt, rb, h, rs = 14, open = false, ts, tl) => new THREE.CylinderGeometry(rt, rb, h, lk(rs, 5), 1, open, ts ?? 0, tl ?? TAU);
  const torus = (r, t, rs = 5, ts = 18, arc = TAU) => new THREE.TorusGeometry(r, t, lk(Math.min(rs, 5), 3), lk(Math.min(ts, 20), 6), arc);
  const rbox = (w, h, d, rad, seg) => new ADDONS.RoundedBoxGeometry(w, h, d, seg ?? (Math.max(w, h, d) > 0.15 ? 2 : 1), Math.min(rad, w / 2, h / 2, d / 2) * 0.999);
  function lathe(pts, segs = 20, zs = 1) { const g = new THREE.LatheGeometry(pts.map((p) => new THREE.Vector2(p[0], p[1])), lk(segs, 6)); if (zs !== 1) xf(g, 0, 0, 0, 0, 0, 0, 1, 1, zs); return g; }
  function tube(points, r, segs = 20, rs = 6) { return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(p[0], p[1], p[2]))), lk(segs, 4), r, lk(rs, 4), false); }
  /** limb capsule between y0 (top) and y1 (bottom) at (x, z) */
  function limb(x, y0, y1, r, z = 0) { return xf(capsule(r, Math.max(0.001, y0 - y1)), x, (y0 + y1) / 2, z); }

  const KEEP = new Set(['position', 'normal', 'uv']);
  class Parts {
    constructor() { this.list = []; }
    /** bone: an index (rigid) or a weight function (x, y, z) → [boneA, weightA, boneB, weightB] (smooth skinning) */
    add(geo, bone, slot) {
      let g = geo;
      if (!g.index) g = BGU.mergeVertices(g); // safety: all merged parts must be indexed
      for (const k of Object.keys(g.attributes)) if (!KEEP.has(k)) g.deleteAttribute(k);
      if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
      const n = g.attributes.position.count;
      const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4), sl = new Float32Array(n);
      const fn = typeof bone === 'function' ? bone : null, pa = g.attributes.position;
      for (let i = 0; i < n; i++) {
        sl[i] = slot;
        if (!fn) { si[i * 4] = bone; sw[i * 4] = 1; continue; }
        const w = fn(pa.getX(i), pa.getY(i), pa.getZ(i));
        const a = w[1] >= 0 ? w[1] : 0, b = w[3] >= 0 ? w[3] : 0, t = a + b || 1;
        si[i * 4] = w[0]; sw[i * 4] = a / t; si[i * 4 + 1] = w[2]; sw[i * 4 + 1] = b / t;
      }
      if (fn) bone = -1;
      g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
      g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
      g.setAttribute('aSlot', new THREE.Float32BufferAttribute(sl, 1));
      this.list.push(g);
      if (G.avatar && G.avatar._trace) G.avatar._trace.push([bone >= 0 ? BONES[bone][0] : 'skin', slot, g.index ? g.index.count / 3 : n / 3]);
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
  function styleSig(app) { return [app.style, app.hair, app.hat, app.top, app.bottom, app.footwear, app.bag, app.accessory].join('|'); }
  /** the realistic body depends on every piece (one geometry per combination, cached) */
  const SHAPE_KEYS = ['hair', 'beard', 'hat', 'outer', 'top', 'bottom', 'footwear', 'norigae', 'pouch', 'fan', 'hairpin', 'ribbon', 'belt', 'bag'];
  function shapeSig(app) { return app.style === 'real' ? 'r|' + SHAPE_KEYS.map((k) => app[k]).join('|') + (app.pattern === 'geumbak' ? '|g' : '') + '|' + buildOf(app) : styleSig(view(app)); }
  const HAT = { strawhat: true, cap: true, gat: true, jokduri: true, ayam: true, jobawi: true, hogeon: true, bokgeon: true };
  const HANBOK_TOPS = new Set(['hanbok', 'saekdong', 'dangui', 'baeja', 'kwaeja', 'durumagi']);
  // the round style draws the newer hair styles from its six shells + a few extra volumes (cuteExtras)
  const CUTE_HAIR = { daenggi: 'ponytail', jjok: 'bun', sangtu: 'buzz', pigtails: 'short', side: 'short', wave: 'long', bangs: 'short', twinbraid: 'short' };

  // ---- what the builders draw (§19.1): a piece that has no model of its own yet is drawn as its nearest modelled one
  const DRAW_TOP_OUTER = { durumagi: 'durumagi', dopo: 'durumagi', hakchang: 'durumagi', nubi: 'durumagi', kkachi: 'durumagi', dallyeong: 'durumagi', wonsam: 'durumagi',
    hwarot: 'durumagi', jangot: 'durumagi', sseugae: 'durumagi', cheollik: 'durumagi', gugunbok: 'kwaeja', kwaeja: 'kwaeja', jeonbok: 'kwaeja', dapho: 'kwaeja',
    baeja: 'baeja', jokki: 'baeja', magoja: 'baeja', dangui: 'dangui' };
  const DRAW_BOTTOM = { skirt: 'skirt', tongchima: 'skirt', seuran: 'skirt', daeran: 'skirt', mongdang: 'skirt', pants: 'pants', pungcha: 'pants', nubibaji: 'pants', saenghwal: 'pants', jambang: 'shorts' };
  const DRAW_HAT = { none: 'none', gat: 'gat', chorip: 'gat', paeraengi: 'gat', jeollip: 'gat', satgat: 'strawhat', jeonmo: 'strawhat', strawhat: 'strawhat', yugeon: 'bokgeon',
    tanggeon: 'bokgeon', jeongja: 'bokgeon', samo: 'bokgeon', bokgeon: 'bokgeon', gokkal: 'bokgeon', sangmo: 'bokgeon', hogeon: 'hogeon', gulle: 'jobawi', nambawi: 'jobawi',
    pungcha: 'jobawi', jobawi: 'jobawi', ayam: 'ayam', jokduri: 'jokduri', hwagwan: 'jokduri', sugeon: 'headband' };
  const DRAW_FOOT = { gomusin: 'gomusin', kkotsin: 'kkotsin', danghye: 'kkotsin', unhye: 'kkotsin', gatsin: 'kkotsin', taesahye: 'gomusin', mokhwa: 'gomusin', namaksin: 'gomusin', jipsin: 'jipsin', mituri: 'jipsin' };
  const DRAW_BAG = { none: 'none', botjim: 'backpack', gwaenari: 'backpack', bojagi: 'backpack', basket: 'basket' };
  const DRAW_PATTERN = { none: 'none', geumbak: 'geumbak', cloud: 'cloud', flower: 'flower' };
  function view(app) {
    const v = Object.assign({}, app);
    const o = DRAW_TOP_OUTER[app.outer];
    v.top = o || (app.top === 'saekdong' ? 'saekdong' : 'hanbok');
    if (o === 'dangui') v.topColor = app.outerColor;
    v.bottom = DRAW_BOTTOM[app.bottom] || 'pants';
    v.hat = DRAW_HAT[app.hat] || 'none';
    v.footwear = DRAW_FOOT[app.footwear] || 'gomusin';
    v.bag = DRAW_BAG[app.bag] || 'none';
    v.pattern = DRAW_PATTERN[app.pattern] || 'none';
    v.accessory = app.norigae !== 'none' ? 'norigae' : app.pouch !== 'none' ? 'bokjumeoni' : app.fan !== 'none' ? 'fan' : app.ribbon !== 'none' ? 'daenggi' : app.beard !== 'none' ? 'beard' : 'none';
    v.accessoryColor = app.norigae !== 'none' ? app.norigaeColor : app.pouch !== 'none' ? app.pouchColor : app.ribbon !== 'none' && app.fan === 'none' ? app.ribbonColor : app.accessoryColor;
    if (v.accessory === 'beard') v.accessoryColor = app.hairColor;
    return v;
  }
  function buildBody(app) { return app.style === 'real' ? buildReal(app) : buildCute(app); }

  function buildCute(app) {
    const P = new Parts();
    const S = SLOT;
    const top = HANBOK_TOPS.has(app.top) ? 'hanbok' : app.top, bottom = app.bottom, hair = CUTE_HAIR[app.hair] || app.hair, acc = app.hat !== 'none' ? app.hat : app.accessory;
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
      const low = !!HAT[acc] || app.hair === 'jjok';
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
      P.add(tilt(xf(brim, 0, 1.33, -0.01), -0.09), B.head, S.hat);
      P.add(tilt(xf(lathe([[0.238, 1.325], [0.236, 1.4], [0.226, 1.45], [0.19, 1.478], [0, 1.484]], 28), 0, 0, -0.01), -0.09), B.head, S.hat);
      P.add(tilt(xf(cyl(0.242, 0.242, 0.04, 28, true), 0, 1.357, -0.01), -0.09), B.head, S.hat2);
    } else if (acc === 'headband') {
      // ring = section of the hair shell by a plane tilted forward (front over the forehead, back higher)
      const ta = 0.24, rho = R * 1.1, d = 0.13;
      const sec = Math.sqrt(rho * rho - d * d);
      const band = torus(sec, 0.024, 8, 44);
      xf(band, 0, 0, 0, Math.PI / 2, 0, 0, HS[0] * 1.01, 1, 1);
      xf(band, 0, HC + d * Math.cos(ta), d * Math.sin(ta), ta, 0, 0);
      P.add(band, B.head, S.hat);
      const ky = HC + d * Math.cos(ta) + sec * Math.sin(ta), kz = d * Math.sin(ta) - sec * Math.cos(ta) - 0.012;
      for (const s of [1, -1]) {
        P.add(xf(sphere(0.038, 10, 8), s * 0.03, ky, kz, 0, 0, 0, 1.2, 0.85, 0.7), B.head, S.hat);
        P.add(xf(rbox(0.045, 0.13, 0.012, 0.005), s * 0.045, ky - 0.075, kz - 0.012, -0.22, 0, s * 0.32), B.head, S.hat);
      }
    } else if (acc === 'cap') {
      P.add(xf(new THREE.SphereGeometry(1, 30, 14, 0, TAU, 0, 1.18), 0, HC + 0.005, -0.008, -0.1, 0, 0, 0.322, 0.322, 0.33), B.head, S.hat);
      P.add(xf(cyl(0.21, 0.21, 0.016, 24, false, -1.0, 2.0), 0, 1.232, 0.1, 0.16, 0, 0, 1, 1, 1.28), B.head, S.hat);
      P.add(xf(sphere(0.022, 8, 6), 0, 1.44, -0.04), B.head, S.hat);
    } else if (acc === 'beard') {
      P.add(xf(sphere(1, 18, 14), 0, 0.92, 0.16, 0.25, 0, 0, 0.165, 0.15, 0.12), B.head, S.acc);
      for (const s of [1, -1]) P.add(xf(capsule(0.019, 0.06, 6), s * 0.042, 1.012, 0.268, 0, 0, s * 1.2), B.head, S.acc);
    } else if (acc === 'gat') {
      P.add(xf(cyl(0.43, 0.43, 0.012, 40), 0, 1.405, -0.01), B.head, S.hat);
      P.add(xf(cyl(0.128, 0.148, 0.2, 24), 0, 1.51, -0.01), B.head, S.hat);
    }
    if (app.accessory === 'glasses' && acc !== 'glasses') { // glasses under a hat
      for (const s of [1, -1]) P.add(xf(torus(0.06, 0.009, 6, 22), s * 0.104, 1.088, 0.272), B.head, S.acc);
      P.add(xf(cyl(0.0065, 0.0065, 0.09, 6), 0, 1.1, 0.283, 0, 0, Math.PI / 2), B.head, S.acc);
    } else if (app.accessory === 'beard' && acc !== 'beard') {
      P.add(xf(sphere(1, 18, 14), 0, 0.92, 0.16, 0.25, 0, 0, 0.165, 0.15, 0.12), B.head, S.acc);
    }
    cuteExtras(P, app);

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
      const sleeveSlot = top === 'apron' ? S.under : hanbok ? S.sleeve : S.top;
      if (top === 'tshirt') {
        P.add(limb(x, 0.755, 0.605, 0.048), sh, S.skin);
        P.add(xf(cyl(0.064, 0.07, 0.1, 14), x, 0.715, 0), sh, S.top);
        P.add(xf(new THREE.SphereGeometry(0.064, 14, 8, 0, TAU, 0, Math.PI / 2), x, 0.765, 0), sh, S.top);
        P.add(limb(x, 0.605, 0.475, 0.043), el, S.skin);
      } else {
        const rU = hanbok ? 0.056 : 0.052;
        P.add(limb(x, 0.755, 0.605, rU), sh, sleeveSlot);
        if (hanbok) {
          P.add(xf(cyl(0.052, 0.074, 0.13, 14), x, 0.548, 0), el, S.sleeve);
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
  /** the round style's share of the phase-9 options: braids, topknot, the traditional headwear, hanbok outer pieces, trinkets */
  function cuteExtras(P, app) {
    const S = SLOT;
    const braid = (pts, r, bone) => { // a chain of slightly flattened beads along a path (a plait)
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i], b = pts[i + 1];
        for (let k = 0; k < 2; k++) {
          const t = (k + 0.5) / 2, x = lerp(a[0], b[0], t), y = lerp(a[1], b[1], t), z = lerp(a[2], b[2], t);
          const rr = r * (1 - 0.35 * (i + t) / pts.length);
          P.add(xf(sphere(rr, 8, 6), x + (k ? 0.006 : -0.006), y, z, 0, 0, k ? 0.5 : -0.5, 1.15, 0.8, 0.9), bone, S.hair);
        }
      }
      const e = pts[pts.length - 1];
      return e;
    };
    const ribbonC = app.accessory === 'daenggi' ? S.acc : S.red;
    const h = app.hair;
    if (h === 'daenggi') {
      const e = braid([[0, 0.98, -0.25], [0, 0.82, -0.25], [0, 0.66, -0.24], [0, 0.52, -0.23]], 0.045, B.hairB);
      P.add(xf(rbox(0.07, 0.11, 0.012, 0.006), 0, e[1] - 0.06, e[2] - 0.01, 0.08, 0, 0), B.hairB, ribbonC);
    } else if (h === 'twinbraid' || h === 'pigtails') {
      for (const s of [1, -1]) {
        if (h === 'twinbraid') { const e = braid([[s * 0.24, 1.0, -0.06], [s * 0.25, 0.86, -0.02], [s * 0.24, 0.72, 0.0]], 0.04, B.head); P.add(xf(sphere(0.03, 8, 6), e[0], e[1] - 0.02, e[2]), B.head, ribbonC); }
        else { P.add(xf(lathe([[0, 0.02], [0.05, 0], [0.07, -0.08], [0.06, -0.2], [0.02, -0.27], [0, -0.28]], 12), s * 0.27, 1.12, -0.1, 0, 0, s * 0.5), B.head, S.hair); P.add(xf(torus(0.04, 0.014, 6, 14), s * 0.27, 1.13, -0.1, 0, 0, s * 0.5 + Math.PI / 2), B.head, ribbonC); }
      }
    } else if (h === 'sangtu') {
      P.add(xf(lathe([[0, 0], [0.05, 0.005], [0.055, 0.06], [0.04, 0.12], [0, 0.14]], 14), 0, 1.36, -0.02), B.head, S.hair);
      P.add(xf(cyl(0.006, 0.006, 0.18, 6), 0, 1.44, -0.02, 0, 0, Math.PI / 2), B.head, S.gold);
    } else if (h === 'jjok') {
      P.add(xf(cyl(0.008, 0.008, 0.34, 6), 0, 1.02, -0.285, 0, 0, Math.PI / 2), B.head, S.gold);
    } else if (h === 'bangs') {
      P.add(xf(new THREE.SphereGeometry(1, 20, 6, -0.9, 1.8, 0.95, 0.42), 0, HC, 0.0, 0, 0, 0, R * 1.1 * HS[0], R * 1.1 * HS[1], R * 1.12), B.head, S.hair);
    }
    // traditional headwear
    const hat = app.hat;
    if (hat === 'jokduri') {
      P.add(xf(cyl(0.085, 0.11, 0.09, 6), 0, 1.4, 0.02, -0.12, 0, 0), B.head, S.hat);
      for (let i = 0; i < 6; i++) { const a = (i / 6) * TAU; P.add(xf(sphere(0.016, 6, 5), Math.sin(a) * 0.1, 1.36, 0.02 + Math.cos(a) * 0.1), B.head, S.hat2); }
      P.add(xf(sphere(0.026, 8, 6), 0, 1.47, 0.03), B.head, S.hat2);
    } else if (hat === 'ayam' || hat === 'jobawi') {
      const ear = hat === 'jobawi';
      const g = new THREE.SphereGeometry(1, 28, 12, 0, TAU, 0.42, ear ? 1.55 : 1.05);
      P.add(xf(g, 0, HC, -0.01, -0.12, 0, 0, R * 1.12 * HS[0], R * 1.12 * HS[1], R * 1.14), B.head, S.hat);
      P.add(xf(torus(R * 1.1, 0.014, 6, 30), 0, HC + 0.2, -0.04, Math.PI / 2 - 0.12, 0, 0, HS[0], 1, 1), B.head, S.hat2);
      if (!ear) for (const s of [1, -1]) P.add(xf(rbox(0.05, 0.36, 0.01, 0.005), s * 0.04, 0.95, -0.29, 0.2, 0, s * 0.06), B.hairB, S.red); // 드림
      P.add(xf(sphere(0.03, 8, 6), 0, HC + 0.24, 0.22), B.head, S.hat2);
    } else if (hat === 'hogeon' || hat === 'bokgeon') {
      P.add(xf(new THREE.SphereGeometry(1, 28, 14, 0, TAU, 0, 1.75), 0, HC + 0.01, -0.02, -0.25, 0, 0, R * 1.14 * HS[0], R * 1.15 * HS[1], R * 1.16), B.head, S.hat);
      P.add(xf(rbox(0.16, 0.34, 0.02, 0.01), 0, 0.98, -0.3, 0.25, 0, 0), B.hairB, S.hat);
      if (hat === 'hogeon') for (const s of [1, -1]) P.add(xf(sphere(0.045, 8, 6), s * 0.17, 1.38, 0.0, 0, 0, 0, 1, 1, 0.6), B.head, S.hat); // ears
    }
    // hanbok outer pieces (the round style keeps them simple)
    const t = app.top;
    if (t === 'dangui' || t === 'durumagi' || t === 'kwaeja') {
      const long = t === 'durumagi' ? 0.16 : t === 'kwaeja' ? 0.24 : 0.34;
      const sl = t === 'dangui' ? S.top : S.outer;
      const g = lathe([[0.19, 0.72], [0.2, 0.6], [0.215, 0.48], [0.24, long + 0.12], [0.25, long], [0.235, long - 0.004], [0.17, 0.72]], 28, 0.84);
      P.add(g, B.skirt, sl);
      if (t === 'dangui') P.add(xf(torus(0.245, 0.012, 6, 28), 0, long + 0.01, 0, Math.PI / 2, 0, 0, 1, 0.84, 1), B.skirt, S.band);
    }
    if (t === 'baeja' || t === 'kwaeja') {
      for (const s of [1, -1]) P.add(xf(rbox(0.11, 0.3, 0.02, 0.01), s * 0.1, 0.63, surfZ(s * 0.1, 0.63, 0.015), 0, s * 0.18, 0), B.spine, S.outer);
      P.add(xf(rbox(0.3, 0.3, 0.02, 0.01), 0, 0.63, -0.15), B.spine, S.outer);
      if (t === 'baeja') for (const s of [1, -1]) P.add(xf(capsule(0.012, 0.28, 5), s * 0.055, 0.64, surfZ(s * 0.05, 0.64, 0.028)), B.spine, S.white);
    }
    // trinkets
    const a = app.accessory;
    if (a === 'norigae') {
      P.add(xf(sphere(0.02, 8, 6), -0.06, 0.6, surfZ(-0.06, 0.6, 0.03)), B.cloth, S.acc);
      P.add(xf(rbox(0.03, 0.05, 0.012, 0.006), -0.06, 0.55, surfZ(-0.06, 0.55, 0.03)), B.cloth, S.gold);
      P.add(xf(cyl(0.012, 0.022, 0.12, 8), -0.06, 0.47, surfZ(-0.06, 0.5, 0.03)), B.cloth, S.acc);
    } else if (a === 'bokjumeoni') {
      P.add(xf(lathe([[0, 0], [0.04, 0.01], [0.05, 0.04], [0.035, 0.075], [0.018, 0.085], [0.026, 0.095], [0, 0.1]], 12), 0.15, 0.4, 0.1), B.hips, S.acc);
      P.add(xf(torus(0.02, 0.005, 4, 10), 0.15, 0.485, 0.1, Math.PI / 2, 0, 0), B.hips, S.gold);
    } else if (a === 'fan') {
      P.add(xf(rbox(0.03, 0.2, 0.02, 0.008), 0.205, 0.36, 0.03), B.hdL, S.acc);
    } else if (a === 'daenggi' && !['daenggi', 'twinbraid', 'pigtails'].includes(h)) {
      P.add(xf(rbox(0.12, 0.06, 0.02, 0.01), 0, 1.0, -0.27, 0.3, 0, 0), B.head, S.acc);
      for (const s of [1, -1]) P.add(xf(rbox(0.045, 0.16, 0.01, 0.005), s * 0.03, 0.9, -0.27, 0.15, 0, s * 0.15), B.hairB, S.acc);
    }
    // 고무신 / 꽃신 / 짚신: a pointed, upturned toe and white 버선
    if (app.footwear !== 'sneakers') for (const s of [1, -1]) {
      P.add(xf(sphere(0.026, 8, 6), s * 0.088, 0.04, 0.15, 0, 0, 0, 0.8, 0.9, 1.4), s > 0 ? B.ftL : B.ftR, S.shoe);
      if (app.footwear === 'kkotsin') P.add(xf(sphere(0.018, 8, 6), s * 0.088, 0.075, 0.1), s > 0 ? B.ftL : B.ftR, S.red);
    }
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
  // the body cache is bounded (§19.1): least recently used bodies that no rig wears any more are given back
  const CACHE_MAX = 64;
  const geoRefs = new Map();
  const geoRef = (key, d) => { if (!key) return; const n = (geoRefs.get(key) || 0) + d; if (n > 0) geoRefs.set(key, n); else geoRefs.delete(key); };
  function trimCache(keep) {
    if (geoCache.size <= CACHE_MAX) return;
    for (const [k, g] of geoCache) {
      if (geoCache.size <= CACHE_MAX) break;
      if (k === keep || geoRefs.has(k)) continue;
      geoCache.delete(k); g.dispose();
    }
  }
  function bodyGeometry(app) {
    const key = shapeSig(app);
    let g = geoCache.get(key);
    if (g) { geoCache.delete(key); geoCache.set(key, g); } // most recently used at the end
    if (!g) {
      const t0 = performance.now();
      g = buildBody(app.style === 'real' ? app : view(app));
      if (app.style === 'real') warpBuild(g, buildOf(app)); // [people] §19.9 the build's proportions
      geoCache.set(key, g);
      trimCache(key);
      G.log.debug('AVATAR', `geometry ${key}: ${g.attributes.position.count} verts, ${(performance.now() - t0).toFixed(1)}ms`);
    }
    return g;
  }

  /** [people] §19.9 the middle level of a realistic body (beyond 12 m): the same pieces with about a fifth of the
   *  triangles (≤ 12 000), built at most once per 120 ms across all rigs (null until then: the rig keeps its near body) */
  const MID_K = 0.45;
  let midLast = -1e9;
  function midGeometry(app, force) {
    const key = shapeSig(app) + '|m';
    let g = geoCache.get(key);
    if (g) { geoCache.delete(key); geoCache.set(key, g); return g; }
    const now = performance.now();
    if (!force && now - midLast < 120) return null;
    midLast = now;
    LODK = MID_K;
    try { g = buildBody(app); warpBuild(g, buildOf(app)); } finally { LODK = 1; }
    geoCache.set(key, g);
    trimCache(key);
    return g;
  }

  // ---------------------------------------------------------------- the realistic body (style `real`, CONTRACT §17.7)
  // Natural proportions (1.62 m, ~7 heads). Every part is a shaped surface — swept rings with superelliptic sections
  // (torso, limbs, garments), a sculpted head (skull, jaw, cheekbones, eye sockets, lips, a separate nose and ears),
  // hair as real volumes over the skull (14 styles: shells with combed grooves, three-strand plaits, buns, a topknot),
  // headwear, hanbok pieces (저고리 with 깃 · 동정 · 섶 · 고름 · 끝동 and curved 배래 sleeves, 치마 with pleats and 스란단,
  // 바지 with 대님, 당의 with side slits, 배자 with fur trim, 쾌자, 두루마기), 버선 + 고무신 / 꽃신 / 짚신, trinkets.
  // Vertices near joints are SMOOTHLY skinned between two bones (waist, shoulders, elbows, hips, knees, ankles, the
  // skirt between hips and thighs), so the body bends instead of breaking at the joints. Still one geometry per style
  // combination (cached), one skinned mesh, one program.
  const HEAD = { cx: 0, cy: 1.548, cz: 0.006, rx: 0.078, ry: 0.118, rz: 0.099 };
  const gauss = (x) => Math.exp(-x * x);
  /** a point on the sculpted head for a unit direction (nx, ny, nz), pushed out by `grow` metres */
  function headPos(nx, ny, nz, grow, out) {
    let x = nx * HEAD.rx, y = ny * HEAD.ry, z = nz * HEAD.rz;
    const low = smooth(-0.05, -0.95, ny), front = smooth(0.2, 1, nz);
    x *= 1 - 0.24 * low * low;                                       // jaw narrows to the chin ([people] rounder, less of a V)
    if (nz < 0) z *= 1 - 0.4 * low * -nz;                            // the back of the lower head goes into the neck
    z += 0.012 * low * front; y -= 0.01 * low * front;               // face plane and chin forward
    z -= 0.01 * smooth(0, -0.8, nz) * smooth(-0.3, 0.6, ny);         // the cranium bulges at the back
    z -= 0.006 * smooth(0.2, 0.8, ny) * smooth(0.5, 1, nz);          // a flatter forehead
    x += Math.sign(nx) * 0.006 * gauss((ny + 0.05) / 0.2) * gauss((Math.abs(nx) - 0.72) / 0.25) * smooth(0, 0.8, nz); // cheekbones
    z -= 0.0055 * gauss((ny - 0.08) / 0.08) * gauss((Math.abs(nx) - 0.36) / 0.14) * smooth(0.6, 1, nz);               // eye sockets
    z += 0.0035 * gauss((ny - 0.2) / 0.06) * gauss((Math.abs(nx) - 0.35) / 0.25) * smooth(0.6, 1, nz);               // brow ridge
    z += 0.0035 * gauss((ny + 0.86) / 0.09) * gauss(nx / 0.26) * smooth(0.5, 1, nz);                                  // [people] the chin
    z -= 0.0022 * gauss((ny + 0.74) / 0.05) * gauss(nx / 0.3) * smooth(0.7, 1, nz);                                   // the dip under the lower lip
    z += 0.0025 * gauss((ny + 0.32) / 0.16) * gauss((Math.abs(nx) - 0.5) / 0.2) * smooth(0.4, 0.9, nz);               // soft cheeks
    z += 0.0035 * gauss((ny + 0.63) / 0.07) * gauss(nx / 0.28) * smooth(0.7, 1, nz);                                  // lips
    x *= 1 - 0.04 * smooth(0.2, 0.6, ny);                            // temples
    if (grow) { const gx = x / (HEAD.rx * HEAD.rx), gy = y / (HEAD.ry * HEAD.ry), gz = z / (HEAD.rz * HEAD.rz); const gl = Math.hypot(gx, gy, gz) || 1; x += (gx / gl) * grow; y += (gy / gl) * grow; z += (gz / gl) * grow; }
    out[0] = HEAD.cx + x; out[1] = HEAD.cy + y; out[2] = HEAD.cz + z;
    return out;
  }
  const _hp = [0, 0, 0];
  /** a sphere grid mapped through headPos; growFn(yaw, elev, dir) → metres (or a number) */
  function headShell(growFn, w = 44, hgt = 34, phiStart = 0, phiLen = TAU, thStart = 0, thLen = Math.PI) {
    let g = new THREE.SphereGeometry(1, lk(w, 10), lk(hgt, 8), phiStart, phiLen, thStart, thLen);
    g.deleteAttribute('normal');
    if (phiLen >= TAU - 1e-6) { g.deleteAttribute('uv'); g = BGU.mergeVertices(g, 1e-5); }
    const p = g.attributes.position, v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).normalize();
      const yaw = Math.atan2(v.x, v.z), elev = Math.asin(clamp(v.y, -1, 1));
      const gr = typeof growFn === 'function' ? growFn(yaw, elev, v) : growFn || 0;
      headPos(v.x, v.y, v.z, gr, _hp);
      p.setXYZ(i, _hp[0], _hp[1], _hp[2]);
    }
    g.computeVertexNormals();
    return g;
  }

  // torso profile: [y, rx, rz, cz] (rest pose, metres)
  const TORSO_R = [[0.84, 0.118, 0.09, 0], [0.9, 0.156, 0.1, -0.004], [0.96, 0.164, 0.102, -0.006], [1.02, 0.15, 0.093, -0.004], [1.08, 0.134, 0.086, 0],
    [1.15, 0.142, 0.092, 0.006], [1.22, 0.155, 0.1, 0.012], [1.28, 0.163, 0.1, 0.01], [1.33, 0.17, 0.092, 0], [1.365, 0.163, 0.08, -0.01], [1.388, 0.128, 0.066, -0.012], [1.405, 0.07, 0.054, -0.012], [1.415, 0.056, 0.05, -0.012]];
  /** Catmull-Rom through a [y, a, b, c…] knot table → the row at y (clamped) */
  function prof(tbl, y, out) {
    const n = tbl.length;
    if (y <= tbl[0][0]) { for (let k = 1; k < tbl[0].length; k++) out[k - 1] = tbl[0][k]; return out; }
    if (y >= tbl[n - 1][0]) { for (let k = 1; k < tbl[0].length; k++) out[k - 1] = tbl[n - 1][k]; return out; }
    let i = 0; while (i < n - 2 && y > tbl[i + 1][0]) i++;
    const p0 = tbl[Math.max(0, i - 1)], p1 = tbl[i], p2 = tbl[i + 1], p3 = tbl[Math.min(n - 1, i + 2)];
    const t = (y - p1[0]) / (p2[0] - p1[0] || 1);
    for (let k = 1; k < p1.length; k++) out[k - 1] = crom(p0[k], p1[k], p2[k], p3[k], t);
    return out;
  }
  const _tp = [0, 0, 0];
  const torsoAt = (y) => prof(TORSO_R, y, _tp);
  /** superellipse point: angle a (0 = front, +π/2 = the body's left), radii, exponent n */
  function se(a, rx, rz, n) { const s = Math.sin(a), c = Math.cos(a); return [Math.sign(s) * rx * Math.pow(Math.abs(s), 2 / n), Math.sign(c) * rz * Math.pow(Math.abs(c), 2 / n)]; }

  /**
   * a swept surface: rows along v (0 = first ring), columns around u. ringFn(v, u01, out[x, y, z]) gives the points.
   * opts: nu, nv, open (no seam closing: a sheet), cap0 / cap1 (close the first / last ring with a fan)
   */
  function sweep(ringFn, opts) {
    const nu = lk(opts.nu || 18, opts.open ? 2 : 4), nv = lk(opts.nv || 8, 1), open = !!opts.open;
    const cols = open ? nu + 1 : nu;
    const pos = [], uv = [], idx = [], pt = [0, 0, 0];
    for (let j = 0; j <= nv; j++) {
      const v = j / nv;
      for (let i = 0; i < cols; i++) { ringFn(v, i / nu, pt); pos.push(pt[0], pt[1], pt[2]); uv.push(i / nu, v); }
    }
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
      const a = j * cols + i, b = j * cols + (open ? i + 1 : (i + 1) % cols), c = a + cols, d = b + cols;
      idx.push(a, c, b, b, c, d);
    }
    const cap = (row, flip) => {
      let cx = 0, cy = 0, cz = 0;
      for (let i = 0; i < cols; i++) { const k = (row * cols + i) * 3; cx += pos[k]; cy += pos[k + 1]; cz += pos[k + 2]; }
      const ci = pos.length / 3; pos.push(cx / cols, cy / cols, cz / cols); uv.push(0.5, row ? 1 : 0);
      for (let i = 0; i < nu; i++) { const a = row * cols + i, b = row * cols + (i + 1) % cols; if (flip) idx.push(ci, b, a); else idx.push(ci, a, b); }
    };
    if (opts.cap0) cap(0, false);
    if (opts.cap1) cap(nv, true);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }
  /** a body ring stack from a knot table [y, rx, rz, cx, cz] (top → bottom), superellipse n, with a twist offset */
  function rings(tbl, opts = {}) {
    const n = opts.n || 2.2, off = opts.off || 0, row = [0, 0, 0, 0];
    const y0 = tbl[0][0], y1 = tbl[tbl.length - 1][0];
    const t2 = tbl.map((r) => [r[0], r[1], r[2], r[3] || 0, r[4] || 0]);
    const asc = y0 > y1 ? t2.slice().reverse() : t2;
    return sweep((v, u, out) => {
      const y = lerp(y0, y1, v);
      prof(asc, y, row);
      const p = se(u * TAU, row[0] + off, row[1] + off, n);
      out[0] = row[2] + p[0]; out[1] = y; out[2] = row[3] + p[1];
    }, { nu: opts.nu || 16, nv: opts.nv || Math.max(4, tbl.length * 2), cap0: opts.cap0 !== false, cap1: opts.cap1 !== false });
  }
  /** a tube with varying radius along a Catmull-Rom path; radius(t) → metres; flat: section squash (thin ribbons) */
  function sweepPath(points, radius, opts = {}) {
    const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(p[0], p[1], p[2])));
    const nv = opts.nv || 16, nu = opts.nu || 8; // (sweep thins the grid on the middle level; frames stay at nv)
    const fr = curve.computeFrenetFrames(nv, false);
    const c = new THREE.Vector3();
    return sweep((v, u, out) => {
      const j = Math.round(v * nv);
      curve.getPointAt(v, c);
      const r = typeof radius === 'function' ? radius(v) : radius;
      const a = u * TAU + (opts.twist || 0) * v + (opts.phase || 0);
      const N = fr.normals[j], Bn = fr.binormals[j];
      const ca = Math.cos(a) * r * (opts.flat || 1), sa = Math.sin(a) * r;
      const ox = opts.orbit ? Math.cos(opts.orbit[1] * v + opts.orbit[2]) * opts.orbit[0] : 0, oy = opts.orbit ? Math.sin(opts.orbit[1] * v + opts.orbit[2]) * opts.orbit[0] : 0;
      out[0] = c.x + N.x * (ca + ox) + Bn.x * (sa + oy); out[1] = c.y + N.y * (ca + ox) + Bn.y * (sa + oy); out[2] = c.z + N.z * (ca + ox) + Bn.z * (sa + oy);
    }, { nu, nv, cap0: true, cap1: true });
  }
  /** a three-strand plait along a path: three strands spiral round the axis (a real braid, not a chain of balls) */
  function plait(P, points, r, bone, slot) {
    for (let k = 0; k < 3; k++) {
      P.add(sweepPath(points, (v) => r * 0.62 * (1 - 0.35 * v) * (0.85 + 0.15 * Math.cos(v * 22 + k * 2.1)), { nv: 40, nu: 7, orbit: [r * 0.42, 22, k * (TAU / 3)] }), bone, slot);
    }
  }

  // two-bone weights: [b0, w0, b1, w1] — w(b1) rises from 0 at a to 1 at b (along y)
  const wy = (b0, b1, a, bb) => (x, y) => { const t = smooth(a, bb, y); return [b0, 1 - t, b1, t]; };
  const armBones = (s) => (s > 0 ? [B.shL, B.elL, B.hdL] : [B.shR, B.elR, B.hdR]);
  const legBones = (s) => (s > 0 ? [B.thL, B.knL, B.ftL] : [B.thR, B.knR, B.ftR]);
  /** arm weights: shoulder above the elbow, forearm, hand below the wrist (blended over ±3 cm) */
  const armW = (s) => { const [sh, el, hd] = armBones(s); return (x, y) => (y > 1.09 ? (() => { const t = smooth(1.125, 1.06, y); return [sh, 1 - t, el, t]; })() : (() => { const t = smooth(0.87, 0.835, y); return [el, 1 - t, hd, t]; })()); };
  /** leg weights: hips at the top of the thigh, thigh, shin, foot */
  const legW = (s) => { const [th, kn, ft] = legBones(s); return (x, y) => {
    if (y > 0.86) { const t = smooth(0.95, 0.86, y); return [B.hips, 1 - t, th, t]; }
    if (y > 0.3) { const t = smooth(0.52, 0.45, y); return [th, 1 - t, kn, t]; }
    const t = smooth(0.13, 0.085, y); return [kn, 1 - t, ft, t];
  }; };
  /** torso weights: hips below the waist, spine above, neck at the top */
  const torsoW = (x, y) => (y > 1.36 ? (() => { const t = smooth(1.39, 1.43, y); return [B.spine, 1 - t, B.neck, t]; })() : (() => { const t = smooth(0.98, 1.07, y); return [B.hips, 1 - t, B.spine, t]; })());
  /** long skirts and coats: spine at the chest, the skirt bone below the waist, and the front follows the thigh on its side */
  const skirtW = (x, y, z) => {
    if (y > 1.0) { const t = smooth(1.08, 0.98, y); return [B.spine, 1 - t, B.skirt, t]; }
    const fr = smooth(-0.02, 0.12, z) * smooth(0.02, 0.1, Math.abs(x)) * smooth(0.95, 0.55, y) * 0.5;
    return [B.skirt, 1 - fr, x > 0 ? B.thL : B.thR, fr];
  };
  const coatW = (x, y, z) => (y > 1.0 ? torsoW(x, y) : skirtW(x, y, z));

  /** torso garment shell between yTop and a hem that may depend on the angle (hem(a) → y); open: [a0, a1] gap at the front */
  function torsoShell(yTop, hem, off, opts = {}) {
    const flare = opts.flare || 0, n = opts.n || 2.3;
    const gap = opts.gap || 0;
    return sweep((v, u, out) => {
      const a = gap ? lerp(gap, TAU - gap, u) : u * TAU;
      const yb = typeof hem === 'function' ? hem(a) : hem;
      const y = lerp(yTop, yb, v);
      const r = torsoAt(Math.min(1.405, Math.max(0.84, y)));
      const fl = flare * smooth(opts.flareFrom || 1.0, yb, y);
      const p = se(a, r[0] + off + fl, r[1] + off + fl * 0.85, n);
      out[0] = p[0]; out[1] = y; out[2] = r[2] + p[1];
    }, { nu: opts.nu || 28, nv: opts.nv || 12, open: !!gap, cap0: false, cap1: false });
  }
  /** a point on the torso surface at angle a and height y (+ offset) */
  function torsoPt(a, y, off = 0) { const r = torsoAt(y); const p = se(a, r[0] + off, r[1] + off, 2.3); return [p[0], y, r[2] + p[1]]; }
  /** the wearer's-right overlapping collar line of a hanbok (back of the neck → down to the right chest) */
  function collarPath(off, yEnd = 1.235, xEnd = -0.07) {
    const pts = [];
    for (let i = 0; i <= 10; i++) {
      const t = i / 10;
      const a = lerp(Math.PI * 0.98, -0.3, Math.pow(t, 0.8)) * (t < 0.45 ? 1 : 1);
      const y = lerp(1.405, yEnd, smooth(0.25, 1, t));
      const p = torsoPt(lerp(Math.PI + 0.25, -0.42, t), Math.min(1.4, y), off + 0.004 + 0.012 * (1 - smooth(0, 0.3, t)));
      if (t > 0.6) p[0] = lerp(p[0], xEnd, smooth(0.6, 1, t));
      void a; pts.push(p);
    }
    return pts;
  }

  // ---------------------------------------------------------------- the garment kit (§19.1, lane hanbok)
  // Every hanbok piece of the table is a few lines of data below, drawn by a handful of parametric parts:
  //   robe()     a garment shell from the shoulders to a hem (may depend on the angle: slits, curved 당의 panels),
  //              optional front opening, flare, pleats from the waist (철릭), a back flap (도포), an edge band
  //   collar()   the overlapping 깃 (LEFT front over the RIGHT, as a hanbok closes) with 동정, the 섶 line and the
  //              고름 that hangs from the right chest on the cloth spring — or a round 단령 collar, a band, or none
  //   sleeve     rings along the arm: narrow, wide with the curved 배래 (the lower line of the sleeve), short, none;
  //              끝동 (cuff band), 한삼 (the white cuff of 원삼 / 활옷)
  //   chima()    a high-waisted wrapped skirt with pleats, volume and gold bands (스란 / 대란)
  //   baji()     wide trousers tied with 대님 at the ankle, or short work trousers
  //   shoe()     heel → toe sections with a raised toe, sides, a boot shaft, wooden teeth
  // Hats are lathe profiles and shells in buildRealHat; trinkets have slots of their own (노리개, 주머니, 부채, 머리꽂이,
  // 댕기, 띠, 짐). Colours come from the palette slots, patterns from the slot's FX code (shader below).
  const WIDE = { wide: 1, wider: 1.5 };
  /** 겉옷: o = { len, sleeve, collar, gap, flare, slit, back, pleat, band, apron, head, goreum, kid } */
  const OUTER_KIT = {
    durumagi: { len: 0.36, sleeve: 'wide', collar: 'cross', goreum: 1, flare: 0.1 },
    dopo: { len: 0.2, sleeve: 'wider', collar: 'cross', goreum: 0.6, flare: 0.13, back: 1 },
    hakchang: { len: 0.22, sleeve: 'wider', collar: 'cross', goreum: 0, flare: 0.12, band: 'trim' },
    nubi: { len: 0.36, sleeve: 'wide', collar: 'cross', goreum: 1, flare: 0.1, quilt: 1 },
    kkachi: { len: 0.42, sleeve: 'wide', collar: 'cross', goreum: 1, flare: 0.09, stripes: 1 },
    dallyeong: { len: 0.17, sleeve: 'wider', collar: 'round', goreum: 0, flare: 0.13, badge: 1 },
    wonsam: { len: (a) => 0.5 - 0.3 * smooth(1.2, 2.6, Math.abs(a)), sleeve: 'wider', collar: 'cross', goreum: 0, flare: 0.12, gap: 0.05, slit: 0.95, stripes: 1, hansam: 1 },
    hwarot: { len: (a) => 0.42 - 0.3 * smooth(1.2, 2.6, Math.abs(a)), sleeve: 'wider', collar: 'cross', goreum: 0, flare: 0.13, gap: 0.05, slit: 0.95, stripes: 1, hansam: 1 },
    cheollik: { len: 0.3, sleeve: 'wide', collar: 'cross', goreum: 1, flare: 0.16, pleat: 1.02 },
    jangot: { len: 0.55, sleeve: 'none', collar: 'none', head: 1, gap: 0.55, flare: 0.06, band: 'trim' },
    sseugae: { len: 0.86, sleeve: 'none', collar: 'none', head: 1, gap: 0.5, flare: 0.1, pleat: 2 },
    kwaeja: { len: (a) => (Math.abs(Math.sin(a)) > 0.985 ? 0.86 : 0.5), sleeve: 'none', collar: 'v', gap: 0.16, flare: 0.05, open: 1 }, // [people] narrow side slits (the panels nearly meet)
    jeonbok: { len: (a) => (Math.abs(Math.sin(a)) > 0.985 ? 0.9 : Math.abs(a) > 3.04 ? 0.72 : 0.42), sleeve: 'none', collar: 'none', gap: 0.05, flare: 0.06, open: 1 },
    gugunbok: { len: (a) => (Math.abs(Math.sin(a)) > 0.985 ? 0.9 : Math.abs(a) > 3.04 ? 0.72 : 0.42), sleeve: 'narrow', sleeveSlot: 'red', collar: 'none', gap: 0.05, flare: 0.06, open: 1, under: 0.36 },
    dapho: { len: (a) => (Math.abs(Math.sin(a)) > 0.985 ? 0.86 : 0.44), sleeve: 'short', collar: 'none', gap: 0.05, flare: 0.06, open: 1 },
    baeja: { len: 0.97, sleeve: 'none', collar: 'v', gap: 0.16, flare: 0.008, fur: 1, open: 1 },
    jokki: { len: 0.92, sleeve: 'none', collar: 'v', gap: 0.02, flare: 0.006, buttons: 5, pockets: 1, open: 1 },
    magoja: { len: 0.96, sleeve: 'narrow', collar: 'band', gap: 0.02, flare: 0.012, buttons: 2 },
    dangui: { len: (a) => 0.86 + 0.27 * Math.pow(Math.abs(Math.sin(a)), 3), sleeve: 'narrow', collar: 'cross', goreum: 1, flare: 0.045, band: 'gold', short: 1 },
    haengju: { apron: 1 },
  };
  /** 저고리: trim 0 = 민, 1 = 반회장 (깃 · 고름 · 끝동), 2 = 삼회장 (+ 곁마기); thick = padding */
  const TOP_KIT = {
    hanbok: { trim: 0 }, banhoejang: { trim: 1 }, samhoejang: { trim: 2 }, saekdong: { trim: 1, stripes: 1 }, kkaekki: { trim: 0, sheer: 1 },
    nubi: { trim: 0, quilt: 1, thick: 0.004 }, jeoksam: { trim: 0, plain: 1 }, som: { trim: 0, thick: 0.006 }, saenghwal: { trim: 1, band: 1 },
  };
  /** 아래옷: chima { hem, flare, pleats, bands } or baji { end, width, tie, kid } */
  const BOTTOM_KIT = {
    skirt: { chima: 1, hem: 0.035, flare: 0.17, pleats: 22 }, tongchima: { chima: 1, hem: 0.26, flare: 0.12, pleats: 18 },
    seuran: { chima: 1, hem: 0.02, flare: 0.19, pleats: 24, bands: [0.17] }, daeran: { chima: 1, hem: 0.006, flare: 0.22, pleats: 26, bands: [0.21, 0.1] },
    mongdang: { chima: 1, hem: 0.4, flare: 0.1, pleats: 16 }, pants: { end: 0.13, width: 1, tie: 1 }, pungcha: { end: 0.13, width: 0.9, tie: 1, split: 1 },
    jambang: { end: 0.52, width: 1.1, tie: 0 }, nubibaji: { end: 0.13, width: 1.15, tie: 1, quilt: 1 }, saenghwal: { end: 0.12, width: 0.7, tie: 0, cuff: 1 },
  };
  const STRAW_FEET = new Set(['jipsin', 'mituri']);

  /** a garment shell around the torso and below it: yTop → hem(a); off = distance from the skin */
  function robe(yTop, hem, off, o) {
    const flare = o.flare || 0, gap = o.gap || 0, pl = o.pleat, back = o.back;
    return sweep((v, u, out) => {
      const a = gap ? lerp(gap, TAU - gap, u) : u * TAU;
      const aa = a > Math.PI ? a - TAU : a;
      const yb = typeof hem === 'function' ? hem(aa) : hem;
      const y = lerp(typeof yTop === 'function' ? yTop(aa) : yTop, yb, v);
      const r = torsoAt(Math.min(1.405, Math.max(0.84, y)));
      let fl = flare * smooth(o.flareFrom || 1.02, yb, y);
      let k = 1;
      if (pl && y < pl) k += 0.05 * Math.sin(a * 44) * smooth(pl, pl - 0.08, y);                     // 철릭: pleats below the waist
      if (back) fl += 0.012 * smooth(1.2, 0.8, y) * smooth(1.6, 2.6, Math.abs(a > Math.PI ? a - TAU : a)); // 도포: the back flap
      // below the waist the robe clears the hips and the tops of the trousers (they never poke through it)
      const hip = smooth(1.08, 0.92, y);
      let rx = (Math.max(r[0], y < 0.84 ? 0.15 : 0, 0.188 * hip) + off + fl) * k, rz = (Math.max(r[1], y < 0.84 ? 0.1 : 0, 0.136 * hip) + off + fl * 0.9) * k;
      if (o.skirt && y < 1.27) { // over a 치마: just outside the skirt's own radius at this height (pleats included)
        const sf = o.skirt * Math.pow(smooth(1.15, 0.04, y), 0.8);
        rx = Math.max(rx, (Math.max(r[0], 0.15) + sf) * 1.05 + 0.012); rz = Math.max(rz, (Math.max(r[1], 0.1) + sf * 0.92) * 1.05 + 0.012);
      }
      const p = se(a, rx, rz, 2.3);
      out[0] = p[0]; out[1] = y; out[2] = (y < 0.84 ? 0 : r[2]) + p[1];
    }, { nu: o.nu || 34, nv: o.nv || 16, open: !!gap, cap0: false, cap1: false });
  }
  /** a ribbon of cloth that hangs on the cloth spring (고름, 끈, 띠 ends): from p, length, width, sway */
  function hangBand(P, p, len, w, rz, slot, bone = B.cloth) {
    P.add(xf(rbox(w, len, 0.004, 0.002), p[0], p[1] - len / 2, p[2], -0.06, -0.5, rz), bone, slot);
  }
  /** 깃 + 동정 + 섶 + 고름 of a crossed collar (left front over right, tied on the right chest) */
  function crossCollar(P, o) {
    const S = SLOT;
    const cp = collarPath(o.off, o.yEnd, -0.075);
    P.add(sweepPath(cp, o.w || 0.013, { nu: 6, nv: 22, flat: 0.45 }), torsoW, o.slot);
    if (o.dongjeong !== false) P.add(sweepPath(cp.slice(0, o.djN || 8).map((p, i) => [p[0], p[1] + 0.008, p[2] + 0.006 * (i > 3 ? 1 : 0.4)]), 0.0065, { nu: 5, nv: 14, flat: 0.5 }), torsoW, S.white);
    const sb = cp[cp.length - 1];
    P.add(sweepPath([sb, torsoPt(-0.55, lerp(sb[1], o.hemY, 0.5), o.off + 0.006), torsoPt(-0.62, o.hemY + 0.01, o.off + 0.006)], 0.004, { nu: 4, nv: 10 }), o.weight || torsoW, o.seop);
    if (o.goreum) {
      const kn = torsoPt(-0.58, o.knotY, o.off + 0.02), L = o.goreum;
      P.add(xf(sphere(0.013, 10, 8), kn[0], kn[1], kn[2], 0, 0, 0, 1.4, 1, 0.7), B.cloth, o.goC);
      P.add(xf(rbox(0.032, 0.3 * L, 0.004, 0.002), kn[0] + 0.012, kn[1] - 0.155 * L, kn[2] + 0.006, -0.06, -0.5, 0.06), B.cloth, o.goC);
      P.add(xf(rbox(0.026, 0.22 * L, 0.004, 0.002), kn[0] - 0.014, kn[1] - 0.115 * L, kn[2] + 0.01, -0.05, -0.5, -0.08), B.cloth, o.goC);
      for (const s of [1, -1]) P.add(xf(rbox(0.05, 0.03, 0.006, 0.003), kn[0] + s * 0.022, kn[1] + 0.004, kn[2] + 0.002, 0, -0.5, s * 0.5), B.cloth, o.goC);
    }
    return cp;
  }
  /** knotted buttons (매듭단추) down the front */
  function knotButtons(P, n, y0, y1, off, slot) { for (let i = 0; i < n; i++) { const p = torsoPt(0, lerp(y0, y1, n > 1 ? i / (n - 1) : 0), off); P.add(xf(sphere(0.0075, 8, 6), p[0], p[1], p[2]), torsoW, slot); } }

  function buildReal(app) {
    const P = new Parts();
    const S = SLOT;
    const OK = OUTER_KIT[app.outer] || null, TK = TOP_KIT[app.top] || TOP_KIT.hanbok, BK = BOTTOM_KIT[app.bottom] || BOTTOM_KIT.pants;
    const chima = !!BK.chima;
    const apron = OK && OK.apron;
    const robeO = OK && !apron ? OK : null;              // a 겉옷 that is a garment shell
    const longRobe = robeO && (typeof robeO.len === 'function' || robeO.len < 0.8) && !robeO.open && !robeO.head;
    const fem = chima;
    const jeoHem = chima ? 1.17 : TK.band ? 0.98 : 0.95;
    const jeoOff = (chima ? 0.014 : 0.008) + (TK.thick || 0);

    // ---- head, ears, nose, neck (skin)
    P.add(headShell(0, 40, 30), B.head, S.skin);
    const fz = headPos(0, -0.28, 0.96, 0, [0, 0, 0])[2];
    const nose = sweep((v, u, out) => { // bridge → tip: a narrow wedge that widens to the wings
      const y = lerp(HEAD.cy + 0.004, HEAD.cy - 0.047, v); // [people] §19.9 a lower, softer bridge into a small rounded tip
      const w = lerp(0.0068, 0.0128, smooth(0.25, 1, v)), d = lerp(0.0012, 0.0125, Math.pow(v, 1.6));
      const a = u * TAU, s = Math.sin(a), c = Math.cos(a);
      out[0] = s * w; out[1] = y - (c < 0 ? 0 : 0.003 * v * c); out[2] = fz - 0.012 + Math.max(0, c) * d + 0.006 * v + c * 0.002;
    }, { nu: 12, nv: 8, cap0: true, cap1: true });
    P.add(nose, B.head, S.skin);
    for (const s of [1, -1]) {
      P.add(xf(sphere(0.006, 8, 6), s * 0.0095, HEAD.cy - 0.0465, fz - 0.002, 0, 0, 0, 1, 0.75, 1.1), B.head, S.skin);  // nostril wings
      // [people] §19.9 the ear: a flat shell close to the head with its rim lying on it (it read as a handle)
      const ear = xf(sphere(1, 12, 10), s * (HEAD.rx - 0.001), HEAD.cy - 0.012, -0.014, 0, s * -0.3, s * 0.1, 0.009, 0.03, 0.019);
      P.add(ear, B.head, S.skin);
      P.add(xf(torus(0.019, 0.0024, 5, 14, Math.PI * 1.15), s * (HEAD.rx + 0.0015), HEAD.cy - 0.009, -0.016, 0, s * (Math.PI / 2 - 0.3), Math.PI * 0.55, 1, 1.4, 0.7), B.head, S.skin);
    }
    P.add(rings([[1.515, 0.05, 0.053, 0, -0.012], [1.46, 0.051, 0.054, 0, -0.012], [1.405, 0.056, 0.058, 0, -0.014], [1.37, 0.07, 0.07, 0, -0.012]], { nu: 14, nv: 6 }), torsoW, S.skin);
    P.add(torsoShell(1.405, 1.25, -0.003, { nu: 22, nv: 5 }), torsoW, S.skin);

    // ---- hair, hat, beard
    buildRealHair(P, app);
    buildRealHat(P, app);
    buildRealBeard(P, app);

    // ---- 저고리 (always worn): body, collar, 곁마기
    const trimTop = TK.trim ? S.trim : TK.stripes ? S.top3 : S.top2;
    if (!(robeO && robeO.short)) { // a 당의 replaces the 저고리 body (the 저고리 shows at the collar and the cuffs)
      P.add(torsoShell(1.402, jeoHem, jeoOff, { nu: 32, nv: 10, flare: chima ? 0.006 : 0.016, flareFrom: 1.2 }), torsoW, S.top);
    }
    const knotY = chima ? 1.215 : 1.17;
    if (TK.band) { // 생활한복: a straight band collar and knotted buttons instead of the 고름
      P.add(sweepPath(collarPath(jeoOff, 1.24, -0.02), 0.011, { nu: 6, nv: 18, flat: 0.45 }), torsoW, trimTop);
      knotButtons(P, 3, 1.22, 1.06, jeoOff + 0.008, trimTop);
    } else if (!(robeO && robeO.collar === 'cross' && longRobe) && !(robeO && robeO.collar === 'round')) {
      crossCollar(P, { off: jeoOff, yEnd: chima ? 1.245 : 1.2, hemY: jeoHem, knotY, slot: trimTop, seop: S.top2, goC: TK.trim ? S.trim : chima || TK.stripes ? S.top3 : S.top2, goreum: TK.plain ? 0.75 : chima ? 1 : 0.85 });
    } else {
      // under a long crossed robe: the 저고리's own 동정 shows as a layer at the neck
      P.add(sweepPath(collarPath(jeoOff, 1.3, -0.04).slice(0, 7), 0.008, { nu: 5, nv: 12, flat: 0.5 }), torsoW, S.white);
    }
    if (TK.trim === 2) for (const s of [1, -1]) P.add(xf(sphere(1, 10, 8), s * 0.155, 1.3, -0.005, 0, 0, s * 0.2, 0.02, 0.05, 0.06), torsoW, S.trim); // 곁마기
    if (TK.quilt) for (let i = 0; i < 6; i++) { const y = lerp(1.36, jeoHem + 0.03, i / 5); P.add(torsoShell(y + 0.002, y - 0.002, jeoOff + 0.002, { nu: 32, nv: 1 }), torsoW, S.top2); }

    // ---- 겉옷
    let outerSleeve = null, outerHem = null;
    if (robeO) {
      const o = robeO, slot = S.outer;
      const yTop = o.head ? 1.405 : 1.4;
      const off = o.open ? 0.03 : 0.032;
      const hemFn = typeof o.len === 'function' ? o.len : o.len;
      outerHem = typeof o.len === 'function' ? o.len(0) : o.len;
      const w = longRobe || o.pleat ? coatW : torsoW;
      const oFlare = o.flare, overSkirt = chima ? BK.flare : 0; // over a 치마 the robe keeps outside the skirt
      let shell = robe(yTop, hemFn, off, { skirt: overSkirt, flare: oFlare, gap: o.gap, pleat: o.pleat === 1.02 ? 1.02 : 0, back: o.back, nu: o.pleat ? 48 : 34, nv: longRobe ? 18 : 12, flareFrom: o.pleat ? 1.02 : 1.05 });
      if (o.sleeve === 'none' || o.sleeve === 'short') { // armholes: pull the shoulder caps in (sleeveless / short sleeves)
        const vp = shell.attributes.position;
        for (let i = 0; i < vp.count; i++) { const x = vp.getX(i), y = vp.getY(i); if (y > 1.2 && Math.abs(x) > 0.13) vp.setX(i, Math.sign(x) * (0.13 + (Math.abs(x) - 0.13) * 0.4)); }
        shell.computeVertexNormals();
      }
      if (o.head) shell = null; // the head coverings are drawn below
      if (shell) P.add(shell, w, slot);
      if (shell) P.add(robe(typeof hemFn === 'function' ? (a) => hemFn(a) + 0.03 : hemFn + 0.03, hemFn, off + 0.002, { skirt: overSkirt, flare: oFlare, gap: o.gap, nu: o.pleat ? 48 : 34, nv: 1, flareFrom: o.pleat ? 1.02 : 1.05 }), w, o.band === 'gold' ? S.band : o.band === 'trim' ? S.trim : S.outer2); // hem band
      if (o.pleat === 1.02) P.add(torsoShell(1.05, 1.01, off + 0.004, { nu: 34, nv: 1 }), torsoW, S.outer2); // the waist seam of the 철릭
      if (o.under) P.add(robe(0.62, o.under, off - 0.006, { flare: o.flare * 0.9, nu: 34, nv: 4 }), coatW, S.red); // 동달이: the red coat under the 전복
      if (o.collar === 'cross') crossCollar(P, { off: off - 0.002, yEnd: o.short ? 1.245 : 1.2, hemY: longRobe ? Math.max(0.3, outerHem) : 0.86, knotY: o.short ? 1.215 : 1.17, slot: o.band === 'trim' ? S.trim : o.short ? S.top3 : S.outer2, seop: o.band === 'trim' ? S.trim : S.outer2, goC: o.short ? S.band : S.outer2, goreum: o.goreum || 0, weight: w, w: 0.015, djN: o.short ? 8 : 6 }); // [people] a robe's 동정 ends at the collarbone (its end read as a white speck on the chest)
      else if (o.collar === 'round') { // 단령: a round collar ring and the 흉배 square on the chest
        P.add(xf(torus(0.078, 0.011, 6, 28), 0, 1.395, -0.006, Math.PI / 2 - 0.12, 0, 0, 1, 1.05, 1), torsoW, S.outer2);
        P.add(sweepPath(collarPath(off, 1.3, -0.05).slice(0, 6), 0.007, { nu: 5, nv: 10, flat: 0.5 }), torsoW, S.white);
      } else if (o.collar === 'v' || o.collar === 'band') {
        for (const s of [1, -1]) P.add(sweepPath([torsoPt(s * 0.16, 1.39, off - 0.008), torsoPt(s * 0.17, 1.2, off - 0.008), torsoPt(s * 0.18, (outerHem || 0.95) + 0.02, off - 0.008 + (o.open && outerHem < 0.8 ? 0.04 : 0))], o.fur ? 0.008 : 0.004, { nu: 6, nv: 12 }), w, o.fur ? S.white : S.outer2);
      }
      if (o.badge) for (const z of [1, -1]) { const p = torsoPt(z > 0 ? 0 : Math.PI, 1.18, off + 0.004); P.add(xf(rbox(0.13, 0.13, 0.004, 0.003), p[0], p[1], p[2], 0, z > 0 ? 0 : Math.PI, 0), torsoW, S.band); }
      if (o.buttons) knotButtons(P, o.buttons, 1.3, o.len > 0.9 ? o.len + 0.05 : 1.05, off + 0.01, o.buttons > 2 ? S.metal : S.outer2);
      if (o.pockets) for (const s of [1, -1]) { const p = torsoPt(s * 0.55, 1.0, off + 0.004); P.add(xf(rbox(0.06, 0.004, 0.012, 0.002), p[0], p[1], p[2], 0, s * 0.5, 0), torsoW, S.outer2); }
      if (o.head) { // 장옷 / 쓰개치마: worn over the head, open at the face, falling over the back and the sides
        const len = o.len, pleated = o.pleat === 2;
        P.add(sweep((v, u, out) => {
          const a = lerp(o.gap, TAU - o.gap, u);
          const y = lerp(1.72, len, v);
          const hy = Math.min(1.405, Math.max(0.84, y));
          const r = torsoAt(hy);
          const hr = y > 1.42 ? 1 : 0;
          const k = pleated ? 1 + 0.04 * Math.sin(a * 30) * smooth(1.3, 0.9, y) : 1;
          let rx, rz, cz;
          if (hr) { const t = smooth(1.72, 1.45, y); rx = lerp(0.05, 0.12, t) + 0.01; rz = lerp(0.06, 0.13, t) + 0.01; cz = -0.03 * t; }
          else { rx = Math.max(r[0], 0.15) + 0.05 + (o.flare || 0) * smooth(1.2, len, y); rz = Math.max(r[1], 0.1) + 0.05 + (o.flare || 0) * smooth(1.2, len, y); cz = r[2] - 0.01; }
          const p = se(a, rx * k, rz * k, 2.2);
          out[0] = p[0]; out[1] = y; out[2] = cz + p[1] - (hr ? 0 : 0.01);
        }, { nu: 34, nv: 18, open: true, cap0: false, cap1: false }), (x, y, z) => (y > 1.42 ? [B.head, 1, B.spine, 0] : coatW(x, y, z)), slot);
        P.add(sweepPath([[-0.07, 1.62, 0.07], [0, 1.73, 0.03], [0.07, 1.62, 0.07]], 0.009, { nu: 5, nv: 10, flat: 0.5 }), B.head, o.band === 'trim' ? S.trim : S.outer2); // the edge round the face
        if (!pleated) for (const s of [1, -1]) P.add(xf(rbox(0.05, 0.36, 0.006, 0.003), s * 0.2, 1.27, 0.02, 0.03, 0, s * 0.06), B.cloth, S.outer2); // the empty 장옷 sleeves hang at the sides
      }
      outerSleeve = o.sleeve;
    }
    if (apron) { // 행주치마: wrapped round the front of the skirt from under the chest, tied at the back
      const yT = chima ? 1.2 : 1.06;
      const ap = sweep((v, u, out) => { const y = lerp(yT, chima ? 0.32 : 0.55, v); const r = torsoAt(Math.max(0.84, Math.min(1.4, y))); const a = lerp(-1.25, 1.25, u); const fl = (chima ? 0.2 : 0.06) * Math.pow(smooth(1.1, 0.3, y), 0.8) + 0.03 * smooth(0.95, 0.6, y); const p = se(a, Math.max(r[0], 0.15) + 0.016 + fl, Math.max(r[1], 0.1) + 0.016 + fl * 0.92, 2.2); out[0] = p[0]; out[1] = y; out[2] = (y < 0.84 ? 0 : r[2]) + p[1]; }, { nu: 18, nv: 12, open: true });
      P.add(ap, skirtW, S.outer);
      P.add(torsoShell(yT + 0.025, yT - 0.005, chima ? 0.018 : 0.02, { nv: 1 }), torsoW, S.outer2);
      hangBand(P, [0, yT - 0.01, -0.12], 0.24, 0.03, 0.08, S.outer2);
    }

    // ---- arms: the outermost sleeve over the arm, skin, hands
    const sleeveOuter = outerSleeve === 'wide' || outerSleeve === 'wider' || outerSleeve === 'narrow' ? outerSleeve : null;
    for (const s of [1, -1]) {
      const x0 = s * 0.19;
      const aw = armW(s), hd = armBones(s)[2];
      const armT = [[1.392, 0.022, 0.026, x0 - s * 0.034, -0.016], [1.375, 0.044, 0.046, x0 - s * 0.012, -0.018], [1.33, 0.048, 0.047, x0, -0.02], [1.25, 0.043, 0.044, x0 + s * 0.002, -0.024],
        [1.17, 0.039, 0.04, x0 + s * 0.004, -0.028], [1.1, 0.035, 0.037, x0 + s * 0.006, -0.03], [1.04, 0.037, 0.037, x0 + s * 0.008, -0.028], [0.96, 0.032, 0.031, x0 + s * 0.011, -0.02], [0.88, 0.025, 0.023, x0 + s * 0.013, -0.014], [0.85, 0.023, 0.021, x0 + s * 0.014, -0.012]];
      const endY = 0.875;
      const bare = armT.filter((r) => r[0] <= endY + 0.02);
      P.add(rings(bare, { nu: 12, nv: bare.length * 2 }), aw, S.skin);
      // 배래: the wide sleeve hangs below the arm in a curve; wider for 도포 / 단령 / 원삼
      const kind = sleeveOuter || 'jeo';
      const wideK = WIDE[kind] || 0;
      const sl = armT.filter((r) => r[0] >= endY - 0.03).map((r) => {
        const dz = kind === 'narrow' ? 0.002 : kind === 'jeo' ? 0.006 + 0.032 * smooth(1.32, 0.95, r[0]) : 0.012 + 0.05 * wideK * smooth(1.32, 0.95, r[0]);
        // [people] §19.9 a robe's sleeve sits close over the upper arm and widens toward the 배래 (it read as puffed shoulders)
        const g = r[0] > 1.36 ? 0.006 + (sleeveOuter ? 0.007 : 0) : kind === 'narrow' ? 0.016 : sleeveOuter ? lerp(0.012, 0.022, smooth(1.3, 1.08, r[0])) : 0.014;
        return [r[0], r[1] + g + (wideK ? 0.008 * wideK * smooth(1.3, 1.1, r[0]) : 0), r[2] + g + dz, r[3], r[4] - dz * 0.35];
      });
      sl[sl.length - 1][0] = endY;
      const sSlot = sleeveOuter ? (robeO.sleeveSlot ? S[robeO.sleeveSlot] : S.osleeve) : S.sleeve;
      P.add(rings(sl, { nu: 14, nv: 14, n: 2.1, cap1: false }), aw, sSlot);
      const c = sl[sl.length - 1];
      const cuffSlot = sleeveOuter ? (robeO.band === 'trim' ? S.trim : robeO.short ? S.white : robeO.stripes ? S.band : S.outer2) : TK.trim ? S.trim : TK.stripes ? S.band : TK.plain ? S.top : S.top3;
      P.add(rings([[endY + 0.05, c[1] + 0.002, c[2] + 0.002, c[3], c[4]], [endY - 0.002, c[1] + 0.003, c[2] + 0.003, c[3], c[4]]], { nu: 14, nv: 2, cap0: false, cap1: false }), aw, cuffSlot); // 끝동
      if (sleeveOuter && robeO.hansam) P.add(rings([[endY + 0.004, c[1] - 0.004, c[2] - 0.004, c[3], c[4]], [endY - 0.16, c[1] - 0.006, c[2] - 0.01, c[3] + s * 0.004, c[4] + 0.01]], { nu: 14, nv: 4, cap0: false, cap1: false }), hd, S.white); // 한삼
      if (outerSleeve === 'short') { const st = armT.filter((r) => r[0] >= 1.08).map((r) => [r[0], r[1] + 0.03, r[2] + 0.032, r[3], r[4]]); P.add(rings(st, { nu: 14, nv: 6, cap1: false, cap0: false }), aw, S.outer); }
      // hand: palm, four fingers in a relaxed curl, the thumb in front
      const hx = x0 + s * 0.016, hz = -0.008;
      P.add(rings([[0.852, 0.017, 0.022, hx, hz], [0.82, 0.018, 0.034, hx, hz + 0.004], [0.785, 0.0175, 0.041, hx - s * 0.001, hz + 0.006], [0.758, 0.015, 0.04, hx - s * 0.003, hz + 0.006]], { nu: 12, nv: 6, n: 2.6 }), hd, S.skin);
      for (let f = 0; f < 4; f++) {
        const fzz = hz + 0.006 + lerp(0.026, -0.024, f / 3), len = [0.06, 0.068, 0.064, 0.05][f];
        // [people] §19.9 three joints that curl the finger in toward the palm at rest (the little finger most)
        const cu = 1 + f * 0.25;
        P.add(sweepPath([[hx - s * 0.003, 0.765, fzz], [hx - s * (0.004 + 0.004 * cu), 0.765 - len * 0.45, fzz + 0.004], [hx - s * (0.006 + 0.012 * cu), 0.765 - len * 0.8, fzz + 0.009], [hx - s * (0.008 + 0.02 * cu), 0.765 - len * 0.97, fzz + 0.012]], (v) => 0.0079 - 0.0024 * v, { nu: 6, nv: 8 }), hd, S.skin);
      }
      P.add(sweepPath([[hx - s * 0.004, 0.83, hz + 0.03], [hx - s * 0.008, 0.8, hz + 0.044], [hx - s * 0.012, 0.775, hz + 0.05]], (v) => 0.0095 - 0.002 * v, { nu: 6, nv: 6 }), hd, S.skin);
      if (s < 0) { // gesture fingers on the right hand (scaled up by the fgP / fgV / fgT channels)
        P.add(sweepPath([[hx - s * 0.002, 0.758, hz + 0.022], [hx - s * 0.002, 0.71, hz + 0.024], [hx - s * 0.002, 0.672, hz + 0.024]], 0.0075, { nu: 6, nv: 4 }), B.fgP, S.skin);
        for (const dz of [0.022, 0.006]) P.add(sweepPath([[hx - s * 0.002, 0.758, hz + dz], [hx - s * 0.002, 0.712, hz + dz * 1.6], [hx - s * 0.002, 0.675, hz + dz * 2.1]], 0.0075, { nu: 6, nv: 4 }), B.fgV, S.skin);
        P.add(sweepPath([[hx, 0.79, hz + 0.03], [hx, 0.79, hz + 0.06], [hx, 0.79, hz + 0.082]], 0.0095, { nu: 6, nv: 4 }), B.fgT, S.skin);
      }
    }

    // ---- legs and the 아래옷
    for (const s of [1, -1]) {
      const x0 = s * 0.091, lw = legW(s);
      // [people] §19.9 thighs that taper into the pelvis (no riding-breech bulge), a knee, a calf, a slim ankle
      const legT = [[0.94, 0.074, 0.08, x0 + s * 0.002, 0.004], [0.86, 0.075, 0.082, x0 + s * 0.002, 0.008], [0.76, 0.066, 0.072, x0 + s * 0.002, 0.01], [0.64, 0.056, 0.06, x0 + s * 0.001, 0.008],
        [0.53, 0.047, 0.05, x0, 0.006], [0.48, 0.043, 0.048, x0, 0.012], [0.42, 0.043, 0.048, x0, 0.002], [0.34, 0.046, 0.054, x0, -0.01], [0.24, 0.034, 0.04, x0, -0.006], [0.14, 0.025, 0.03, x0, -0.004], [0.095, 0.024, 0.028, x0, -0.002]];
      if (chima) { // under a skirt: the 속바지 (white) from the knee down shows only under a short skirt
        if (BK.hem > 0.2) P.add(rings(legT.filter((r) => r[0] <= BK.hem + 0.06 && r[0] >= 0.11).map((r) => [r[0], r[1] + 0.01, r[2] + 0.01, r[3], r[4]]), { nu: 12, nv: 10 }), lw, S.white);
      } else {
        const endY = BK.end;
        if (endY > 0.3) P.add(rings(legT.filter((r) => r[0] <= endY + 0.04), { nu: 12, nv: 12 }), lw, S.skin); // 잠방이: the bare shin
        const wk = BK.width || 1;
        const pl = legT.filter((r) => r[0] >= endY - 0.05).map((r) => {
          // [people] gathered at the hip, full over the knee and the shin, bunched above the 대님 (no breeches at the thigh)
          const k = (endY > 0.3 ? 0.026 : 0.014 + 0.02 * smooth(0.18, 0.5, r[0]) - 0.012 * smooth(0.62, 0.9, r[0])) * wk + (BK.quilt ? 0.006 : 0);
          return [r[0], r[1] + k, r[2] + k * 1.1, r[3] + s * 0.004 * wk, r[4]];
        });
        pl[pl.length - 1][0] = endY;
        if (BK.tie) pl.push([0.112, 0.034, 0.038, x0, -0.002]);
        if (BK.cuff) pl.push([0.1, 0.03, 0.034, x0, -0.002]);
        P.add(rings(pl, { nu: 14, nv: 18, cap1: false }), lw, S.bottom);
        if (BK.tie) { // 대님: the ankle tie, with its bow on the inner side
          P.add(rings([[0.16, 0.036, 0.04, x0, -0.002], [0.13, 0.036, 0.04, x0, -0.002]], { nu: 12, nv: 1, cap0: false, cap1: false }), lw, fem ? S.top3 : S.band);
          P.add(xf(rbox(0.012, 0.05, 0.004, 0.002), x0 - s * 0.035, 0.12, 0.012, 0, 0, s * 0.3), legBones(s)[1], fem ? S.top3 : S.band);
        }
        if (BK.cuff) P.add(rings([[0.13, 0.033, 0.037, x0, -0.002], [0.1, 0.033, 0.037, x0, -0.002]], { nu: 12, nv: 1, cap0: false, cap1: false }), lw, S.bottom2);
      }
      buildRealFoot(P, app, s);
    }
    if (!chima) {
      P.add(torsoShell(1.03, 0.84, 0.016 * (BK.width || 1), { nu: 28, nv: 6 }), torsoW, S.bottom);
      P.add(torsoShell(1.03, 0.995, BK.cuff ? 0.026 : 0.012, { nu: 28, nv: 1 }), torsoW, BK.cuff ? S.bottom2 : S.top3);   // 허리띠 (under the 저고리; the 생활한복 band shows)
      if (BK.split) P.add(xf(rbox(0.07, 0.12, 0.006, 0.003), 0, 0.86, -0.12, 0.1, 0, 0), B.hips, S.bottom2); // 풍차: the back flap
    } else {
      const pleats = BK.pleats, hem = BK.hem, flare = BK.flare;
      const ch = sweep((v, u, out) => {
        const y = lerp(1.275, hem, v);
        const r = torsoAt(Math.min(1.4, Math.max(0.84, y)));
        const fl = flare * Math.pow(smooth(1.15, 0.04, y), 0.8);
        const a = u * TAU;
        const pl = 1 + 0.045 * Math.sin(a * pleats) * smooth(1.0, 0.3, y);
        const p = se(a, (Math.max(r[0], 0.15) + 0.004 + fl) * pl, (Math.max(r[1], 0.1) + 0.004 + fl * 0.92) * pl, 2.1);
        out[0] = p[0]; out[1] = y; out[2] = r[2] * (1 - v) + p[1];
      }, { nu: 66, nv: 18, cap0: false, cap1: true });
      P.add(ch, skirtW, S.bottom);
      P.add(torsoShell(1.285, 1.255, 0.006, { nu: 30, nv: 1 }), torsoW, S.white); // 치마허리
      const bands = BK.bands || (app.pattern === 'geumbak' ? [0.22] : []);
      for (const yb of bands) { // 스란단 / 대란단: gold bands round the skirt
        P.add(sweep((v, u, out) => { const y = lerp(yb, yb - 0.07, v); const a = u * TAU; const fl = flare * Math.pow(smooth(1.15, 0.04, y), 0.8); const pl = 1 + 0.045 * Math.sin(a * pleats) * smooth(1.0, 0.3, y); const p = se(a, (0.15 + 0.0055 + fl) * pl, (0.1 + 0.0055 + fl * 0.92) * pl, 2.1); out[0] = p[0]; out[1] = y; out[2] = p[1]; }, { nu: 66, nv: 2 }), skirtW, S.band);
      }
    }

    // ---- 꾸미개 and 짐
    buildRealBag(P, app);
    buildRealTrinket(P, app);
    return P.build();
  }

  /** 신: 버선 (white socks with the pointed toe) + one of ten traditional shoes */
  function buildRealFoot(P, app, s) {
    const S = SLOT;
    const ft = legBones(s)[2], kn = legBones(s)[1];
    const x0 = s * 0.094;
    const fw = app.footwear;
    const footSweep = (grow, toeUp, yTopMul, nv = 12) => sweep((v, u, out) => {
      const z = lerp(-0.058, 0.19 + toeUp * 0.02, v);
      const w = (0.03 + 0.016 * smooth(-0.05, 0.08, z) - 0.03 * smooth(0.13, 0.2 + toeUp * 0.02, z)) + grow;
      const top = (0.078 - 0.046 * smooth(-0.01, 0.15, z)) * yTopMul + grow;
      const a = u * TAU, sa = Math.sin(a), ca = Math.cos(a);
      const lift = toeUp * 0.03 * smooth(0.13, 0.21, z);
      out[0] = x0 + sa * Math.max(0.003, w) * (0.96 + 0.04 * Math.sign(sa) * s);
      out[1] = Math.max(0, top * 0.5 + ca * top * 0.5) + lift;
      out[2] = z;
    }, { nu: 14, nv, cap0: true, cap1: true });
    const lift = fw === 'namaksin' ? 0.05 : 0;
    const boot = fw === 'mokhwa';
    P.add(xf(footSweep(0.002, STRAW_FEET.has(fw) ? 0.3 : 0.6, 1), 0, lift, 0), ft, S.white);                                // 버선 foot
    P.add(rings([[0.2 + lift, 0.034, 0.038, x0, -0.004], [0.13 + lift, 0.031, 0.035, x0, -0.004], [0.07 + lift, 0.031, 0.04, x0, 0.004]], { nu: 12, nv: 4, cap0: false, cap1: false }), (x, y) => { const t = smooth(0.13, 0.08, y); return [kn, 1 - t, ft, t]; }, S.white);
    if (STRAW_FEET.has(fw)) { // 짚신 / 미투리: a woven sole with straps over the 버선
      const fine = fw === 'mituri';
      P.add(xf(rbox(0.088, fine ? 0.012 : 0.016, 0.27, 0.007), x0, 0.008, 0.068), ft, S.sole);
      for (const z of fine ? [0.0, 0.05, 0.1, 0.15] : [0.02, 0.09, 0.15]) P.add(sweepPath([[x0 + 0.042, 0.012, z], [x0 + 0.03, 0.05 - z * 0.12, z + 0.01], [x0, 0.06 - z * 0.15, z + 0.012], [x0 - 0.03, 0.05 - z * 0.12, z + 0.01], [x0 - 0.042, 0.012, z]], fine ? 0.003 : 0.004, { nu: 5, nv: 12 }), ft, S.shoe);
      P.add(sweepPath([[x0 + 0.03, 0.012, -0.05], [x0 + 0.034, 0.07, -0.045], [x0, 0.085, -0.05], [x0 - 0.034, 0.07, -0.045], [x0 - 0.03, 0.012, -0.05]], 0.004, { nu: 5, nv: 12 }), ft, S.shoe);
      return;
    }
    // a boat-shaped shoe: open on top (the 버선 shows), the toe drawn up; side height and toe curl per kind
    const K = { gomusin: [0.036, 0.03, 1], kkotsin: [0.042, 0.03, 1], danghye: [0.046, 0.036, 1.02], unhye: [0.046, 0.03, 1.02], taesahye: [0.05, 0.026, 1.04], gatsin: [0.054, 0.022, 1.05], namaksin: [0.036, 0.02, 1.02], mokhwa: [0.06, 0.02, 1.06] }[fw] || [0.036, 0.03, 1];
    const shoe = sweep((v, u, out) => {
      const z = lerp(-0.064, 0.215, v);
      const w = (0.035 + 0.016 * smooth(-0.05, 0.08, z) - 0.043 * smooth(0.12, 0.215, z)) * K[2];
      const h = lerp(0.012, K[0], u < 0.5 ? u * 2 : 2 - u * 2) + K[1] * smooth(0.14, 0.215, z);
      const a = u * Math.PI;
      out[0] = x0 + Math.cos(a) * Math.max(0.004, w); out[1] = lift + Math.sin(a) * 0.004 + (Math.abs(Math.cos(a)) > 0.3 ? h * Math.abs(Math.cos(a)) : 0) + 0.002; out[2] = z;
    }, { nu: 16, nv: 14, open: true, cap0: false, cap1: false });
    P.add(shoe, ft, S.shoe);
    P.add(xf(rbox(0.08, 0.01, 0.26, 0.004), x0, 0.005 + lift, 0.07), ft, S.sole);
    if (fw === 'namaksin') for (const z of [-0.02, 0.13]) P.add(xf(rbox(0.07, 0.05, 0.035, 0.006), x0, 0.025, z), ft, S.shoe);             // the two wooden teeth
    if (boot) P.add(rings([[0.36, 0.044, 0.05, x0, -0.004], [0.2, 0.04, 0.046, x0, -0.004], [0.08, 0.042, 0.06, x0, 0.01], [0.04, 0.045, 0.07, x0, 0.02]], { nu: 14, nv: 6, cap0: false, cap1: false }), (x, y) => { const t = smooth(0.13, 0.08, y); return [kn, 1 - t, ft, t]; }, S.shoe); // 목화: the boot shaft
    if (fw === 'kkotsin' || fw === 'danghye' || fw === 'unhye') { // flowers / clouds on the toe, a coloured edge
      for (const [dx, dz, c] of [[0, 0.16, S.red], [0.008, 0.14, S.gold], [-0.008, 0.14, S.gold], [0, 0.12, S.leaf]]) P.add(xf(sphere(0.0055, 6, 4), x0 + dx, 0.045 + (0.16 - dz) * -0.2, dz), ft, fw === 'unhye' ? S.white : c);
      P.add(sweepPath([[x0 + 0.035, 0.034, -0.05], [x0 + 0.045, 0.034, 0.06], [x0, 0.06, 0.205], [x0 - 0.045, 0.034, 0.06], [x0 - 0.035, 0.034, -0.05]], 0.0025, { nu: 4, nv: 24 }), ft, fw === 'danghye' ? S.gold : S.top3);
    }
    if (fw === 'taesahye') P.add(sweepPath([[x0 + 0.02, 0.04, 0.12], [x0, 0.058, 0.2], [x0 - 0.02, 0.04, 0.12]], 0.0022, { nu: 4, nv: 10 }), ft, S.white);   // 태사 무늬 on the toe
    if (fw === 'gatsin') P.add(sweepPath([[x0, 0.05, -0.06], [x0, 0.055, 0.1], [x0, 0.06, 0.2]], 0.0018, { nu: 4, nv: 10 }), ft, S.dark);                   // the seam
  }

  /** 수염: 콧수염, 염소수염, 긴 수염 (hair colour) */
  function buildRealBeard(P, app) {
    const S = SLOT, b = app.beard;
    if (!b || b === 'none') return;
    for (const s of [1, -1]) P.add(sweepPath([[0, HEAD.cy - 0.06, headPos(0, -0.52, 0.85, 0.004, [0, 0, 0])[2]], [s * 0.016, HEAD.cy - 0.063, headPos(0.25, -0.55, 0.8, 0.004, [0, 0, 0])[2]], [s * 0.03, HEAD.cy - 0.072, headPos(0.42, -0.6, 0.7, 0.004, [0, 0, 0])[2]]], (v) => 0.0035 * (1 - 0.6 * v), { nu: 5, nv: 8 }), B.head, S.hair);
    if (b === 'goatee' || b === 'long') {
      const cz = headPos(0, -0.95, 0.3, 0.004, [0, 0, 0]);
      const end = b === 'long' ? [[0, cz[1] - 0.05, cz[2] + 0.02], [0, cz[1] - 0.12, cz[2] + 0.04], [0, cz[1] - 0.2, cz[2] + 0.05]] : [[0, cz[1] - 0.04, cz[2] + 0.015]];
      P.add(sweepPath([[0, cz[1] + 0.02, cz[2] - 0.01], [0, cz[1], cz[2] + 0.006], ...end], (v) => (b === 'long' ? 0.02 : 0.012) * (1 - 0.8 * v) + 0.002, { nu: 8, nv: b === 'long' ? 14 : 8 }), (x, y) => { const t = smooth(1.45, 1.38, y); return [B.head, 1 - t, B.cloth, t]; }, S.hair);
    }
  }
  // hair of the realistic style: shells over the skull (hairline, parting, combed grooves) + real volumes
  const HAIR_REAL = {
    short: { fringe: 0.62, faceW: 1.05, side: -0.5, nape: -0.62, thick: 0.012, flare: 0.016 },
    bangs: { fringe: 0.3, faceW: 1.08, side: -0.45, nape: -0.6, thick: 0.012, flare: 0.014, flat: true },
    long: { fringe: 0.7, faceW: 1.0, side: -0.72, nape: -0.85, thick: 0.011, flare: 0.006 },
    wave: { fringe: 0.68, faceW: 1.0, side: -0.72, nape: -0.85, thick: 0.015, flare: 0.012 },
    bun: { fringe: 0.74, faceW: 1.18, side: 0.04, nape: -0.42, thick: 0.008, back: 1 },
    ponytail: { fringe: 0.74, faceW: 1.16, side: 0.04, nape: -0.42, thick: 0.008, back: 1 },
    daenggi: { fringe: 0.74, faceW: 1.16, side: 0.02, nape: -0.45, thick: 0.008, part: 0 },
    jjok: { fringe: 0.74, faceW: 1.16, side: 0.02, nape: -0.45, thick: 0.008, part: 0 },
    twinbraid: { fringe: 0.72, faceW: 1.14, side: 0.0, nape: -0.45, thick: 0.009, part: 0 },
    pigtails: { fringe: 0.6, faceW: 1.12, side: 0.0, nape: -0.45, thick: 0.01, part: 0 },
    sangtu: { fringe: 0.74, faceW: 1.2, side: 0.08, nape: -0.4, thick: 0.007, back: 1 },
    buzz: { fringe: 0.74, faceW: 1.22, side: 0.0, nape: -0.4, thick: 0.0045 },
    curly: { fringe: 0.6, faceW: 1.05, side: -0.25, nape: -0.5, thick: 0.022, curly: true },
    side: { fringe: 0.66, faceW: 1.15, side: 0.02, nape: -0.45, thick: 0.011, part: 0.45, sweep: true },
    eonjeun: { fringe: 0.74, faceW: 1.16, side: 0.02, nape: -0.45, thick: 0.008, part: 0 },
    saengang: { fringe: 0.72, faceW: 1.14, side: 0.02, nape: -0.45, thick: 0.009, part: 0 },
    ttaeun: { fringe: 0.74, faceW: 1.16, side: 0.02, nape: -0.45, thick: 0.008, part: 0 },
    keunmeori: { fringe: 0.74, faceW: 1.18, side: 0.02, nape: -0.45, thick: 0.008, part: 0 },
    gwimit: { fringe: 0.72, faceW: 1.14, side: 0.0, nape: -0.45, thick: 0.009, part: 0 },
  };
  function hairCovReal(h, yaw, elev, inset = 0) {
    const ay = Math.abs(yaw);
    let fringe = h.flat ? h.fringe : h.fringe + 0.015 * Math.cos(yaw * 9);
    // [people] §19.9 a hair pulled back from a parting has a rounded hairline: higher over the forehead, lower at the temples
    if (h.part != null || h.back) fringe += 0.05 * (1 - smooth(0, h.faceW, ay)) - 0.05 * smooth(h.faceW * 0.55, h.faceW, ay);
    if (inset) { fringe += inset; h = Object.assign({}, h, { faceW: h.faceW + inset, side: h.side + inset * 0.7, nape: h.nape + inset * 0.5 }); }
    const faceCut = smooth(-0.12, 0.12, h.faceW - ay) * smooth(-0.1, 0.1, fringe - elev);
    const bottom = lerp(h.side, h.nape, smooth(h.faceW, Math.PI, ay));
    return (1 - faceCut) * smooth(bottom - 0.09, bottom + 0.09, elev);
  }
  /** z of the back surface (head above the neck, the back below it) at height y */
  function backZ(y) {
    const ny = clamp((y - HEAD.cy) / HEAD.ry, -0.95, 0.95);
    const hz = headPos(0, ny, -Math.sqrt(1 - ny * ny), 0, [0, 0, 0])[2];
    if (y > 1.45) return hz;
    const r = torsoAt(clamp(y, 0.84, 1.405));
    const tz = r[2] - r[1];
    return y > 1.38 ? Math.min(hz, lerp(tz, hz, smooth(1.38, 1.45, y))) : tz;
  }
  const hairW = (a, b) => wy(B.head, B.hairB, a, b);

  function buildRealHair(P, app) {
    const S = SLOT;
    const hs = app.hair, h = HAIR_REAL[hs] || HAIR_REAL.short;
    const hatOn = app.hat !== 'none' && app.hat !== 'headband';
    const ribbon = app.ribbon && app.ribbon !== 'none' ? S.rib : S.red;
    const shell = headShell((yaw, elev, v) => {
      const cov = hairCovReal(h, yaw, elev);
      // [people] §19.9 more volume over the crown when no hat sits on it; deeper combed locks
      let t = h.thick * (1 + (hatOn ? 0.45 : 0.85) * Math.max(0, v.y)) + (h.flare || 0) * smooth(0.1, -0.5, elev) * smooth(0.6, 1.4, Math.abs(yaw));
      t += (0.0006 * Math.sin(yaw * 38 + elev * 3) + 0.0009 * Math.sin(yaw * 11 - elev * 5 + 1.3)) * smooth(-0.6, 0.4, elev); // combed strands, locks
      if (h.part != null && elev > 0.45) t -= 0.006 * gauss((yaw - h.part) / 0.045) * smooth(0.45, 0.7, elev); // the parting
      if (h.sweep) t += 0.009 * gauss((elev - 0.78) / 0.2) * gauss(yaw / 0.8);                 // a swept front
      if (h.curly) t += 0.008 * (Math.sin(v.x * 31) * Math.sin(v.y * 27 + 1) * Math.sin(v.z * 29 + 2) + 0.4);
      if (h.flat) t += 0.004 * smooth(0.25, 0.5, elev) * smooth(0.6, 0, Math.abs(yaw));
      // [people] the hair thins to a couple of millimetres at its edge (no cap-like lip at the hairline)
      const deep = hairCovReal(h, yaw, elev, 0.28);
      return lerp(-0.003, t * (0.16 + 0.84 * deep), cov);
    }, 64, 46);
    P.add(shell, B.head, S.hair);

    if (hs === 'long' || hs === 'wave') { // the curtain down the back + locks behind the ears
      const yEnd = hs === 'wave' ? 1.16 : 1.1, wv = hs === 'wave';
      P.add(sweep((v, u, out) => {
        const y = lerp(1.56, yEnd, v);
        const w = lerp(0.068, 0.108, smooth(1.52, 1.34, y)) * (1 - 0.18 * smooth(1.25, yEnd, y));
        const a = u * TAU, s = Math.sin(a), c = Math.cos(a);
        const rip = wv ? 0.01 * Math.sin(v * 15 + s * 3) : 0;
        out[0] = s * w + rip * 0.6; out[1] = y; out[2] = backZ(y) - 0.02 + c * 0.017 + rip - 0.01 * smooth(1.5, 1.3, y);
      }, { nu: 18, nv: 16, cap0: false, cap1: true }), hairW(1.46, 1.38), S.hair);
      for (const s of [1, -1]) P.add(sweepPath([[s * 0.07, 1.53, -0.02], [s * 0.085, 1.44, -0.03], [s * 0.1, 1.36, -0.02], [s * 0.11, wv ? 1.28 : 1.25, 0.0]], (v) => 0.016 * (1 - 0.5 * v), { nu: 8, nv: 10, flat: 0.5 }), hairW(1.46, 1.38), S.hair);
    } else if (hs === 'ponytail') {
      P.add(xf(torus(0.016, 0.006, 6, 14), 0, 1.6, -0.103, 1.0, 0, 0), B.pony, ribbon);
      P.add(sweepPath([[0, 1.602, -0.105], [0, 1.585, -0.15], [0, 1.49, -0.165], [0, 1.37, -0.145], [0, 1.3, -0.13]], (v) => 0.021 * Math.sin(Math.PI * Math.min(1, 0.25 + v)) + 0.004, { nu: 10, nv: 18 }), B.pony, S.hair);
    } else if (hs === 'bun') {
      const by = hatOn ? 1.5 : 1.655, bz = hatOn ? -0.1 : -0.075;
      P.add(xf(sphere(0.04, 16, 12), 0, by, bz, 0, 0, 0, 1, 0.8, 0.9), B.head, S.hair);
      P.add(xf(torus(0.03, 0.011, 6, 18), 0, by - 0.012, bz + 0.004, hatOn ? 0 : 1.15, 0, 0), B.head, S.hair);
      P.add(xf(cyl(0.003, 0.003, 0.12, 6), 0, by + 0.004, bz, 0, 0, Math.PI / 2 - 0.3), B.head, S.gold);
    } else if (hs === 'jjok') {
      P.add(xf(sphere(1, 16, 12), 0, 1.462, -0.104, 0, 0, 0, 0.043, 0.028, 0.032), B.head, S.hair);
      if (!app.hairpin || app.hairpin === 'none') P.add(xf(cyl(0.0035, 0.0035, 0.17, 8), 0, 1.466, -0.11, 0, 0, Math.PI / 2), B.head, S.gold); // 비녀
      if (!app.hairpin || app.hairpin === 'none') for (const s of [1, -1]) P.add(xf(sphere(0.007, 8, 6), s * 0.085, 1.466, -0.11), B.head, s > 0 ? S.gold : S.leaf);
    } else if (hs === 'daenggi') {
      const pts = [[0, 1.47, -0.094], [0, 1.41, -0.103], [0, 1.3, -0.12], [0, 1.17, -0.128], [0, 1.06, -0.125]];
      plait(P, pts, 0.02, hairW(1.47, 1.41), S.hair);
      P.add(xf(rbox(0.03, 0.1, 0.004, 0.002), 0, 1.0, -0.128, 0.05, 0, 0), B.hairB, ribbon);                  // 제비부리댕기
      for (const s of [1, -1]) P.add(xf(rbox(0.016, 0.05, 0.004, 0.002), s * 0.008, 0.94, -0.126, 0.05, 0, s * 0.35), B.hairB, ribbon);
    } else if (hs === 'twinbraid' || hs === 'pigtails') {
      for (const s of [1, -1]) {
        if (hs === 'twinbraid') {
          plait(P, [[s * 0.064, 1.5, -0.05], [s * 0.095, 1.4, -0.012], [s * 0.112, 1.3, 0.028], [s * 0.11, 1.22, 0.05]], 0.016, hairW(1.47, 1.4), S.hair);
          P.add(xf(sphere(0.009, 8, 6), s * 0.11, 1.205, 0.052), B.hairB, ribbon);
        } else {
          P.add(xf(torus(0.012, 0.005, 6, 12), s * 0.075, 1.56, -0.062, 0, 0, s * 1.2), B.head, ribbon);
          P.add(sweepPath([[s * 0.075, 1.56, -0.062], [s * 0.105, 1.52, -0.075], [s * 0.12, 1.43, -0.07], [s * 0.118, 1.33, -0.05]], (v) => 0.018 * Math.sin(Math.PI * Math.min(1, 0.3 + v)) + 0.004, { nu: 9, nv: 14 }), hairW(1.5, 1.42), S.hair);
        }
      }
    } else if (hs === 'sangtu') {
      P.add(xf(lathe([[0, 0], [0.022, 0.004], [0.024, 0.022], [0.017, 0.04], [0, 0.048]], 12), 0, 1.668, -0.012), B.head, S.hair);
      P.add(xf(cyl(0.0025, 0.0025, 0.07, 6), 0, 1.69, -0.012, 0, 0, Math.PI / 2), B.head, S.metal);           // 동곳
      P.add(sweep((v, u, out) => { const yaw = u * TAU; const e = 0.6 + 0.12 * (1 - Math.cos(yaw)) * 0.5 + v * 0.09; const c = Math.cos(e); headPos(Math.sin(yaw) * c, Math.sin(e), Math.cos(yaw) * c, 0.0095, out); }, { nu: 40, nv: 1 }), B.head, S.dark); // 망건
    }
    if (hs === 'ttaeun' || hs === 'gwimit') { // 땋은머리: one long plait down the back (귀밑머리: side locks plaited over the ears into it)
      plait(P, [[0, 1.47, -0.094], [0, 1.4, -0.104], [0, 1.25, -0.122], [0, 1.08, -0.13], [0, 0.95, -0.128]], 0.019, hairW(1.47, 1.41), S.hair);
      if (hs === 'gwimit') for (const s of [1, -1]) plait(P, [[s * 0.07, 1.56, 0.02], [s * 0.085, 1.5, -0.02], [s * 0.07, 1.47, -0.07], [s * 0.02, 1.46, -0.095]], 0.008, B.head, S.hair);
      if (app.ribbon === 'jebi') { P.add(xf(rbox(0.03, 0.1, 0.004, 0.002), 0, 0.9, -0.128, 0.05, 0, 0), B.hairB, ribbon); for (const s of [1, -1]) P.add(xf(rbox(0.016, 0.05, 0.004, 0.002), s * 0.008, 0.84, -0.126, 0.05, 0, s * 0.35), B.hairB, ribbon); }
    } else if (hs === 'eonjeun') { // 얹은머리: a plait wound round the head like a crown
      const pts = []; for (let i = 0; i <= 16; i++) { const yaw = (i / 16) * TAU * 0.96 + 0.1; const c = Math.cos(0.55); const p = headPos(Math.sin(yaw) * c, Math.sin(0.55), Math.cos(yaw) * c, 0.022, [0, 0, 0]); pts.push(p); }
      plait(P, pts, 0.02, B.head, S.hair);
    } else if (hs === 'saengang') { // 새앙머리: two loops at the back, tied with ribbons
      for (const s of [1, -1]) { P.add(xf(torus(0.03, 0.013, 6, 16), s * 0.045, 1.49, -0.1, 0, s * 0.5, 0), B.head, S.hair); P.add(xf(rbox(0.02, 0.03, 0.012, 0.005), s * 0.02, 1.5, -0.104), B.head, ribbon); }
    } else if (hs === 'keunmeori') { // 큰머리 (가체): a great braided roll over the head on a 쪽
      P.add(xf(sphere(1, 16, 12), 0, 1.462, -0.104, 0, 0, 0, 0.043, 0.028, 0.032), B.head, S.hair);
      const pts = []; for (let i = 0; i <= 20; i++) { const a = (i / 20) * TAU; pts.push([Math.sin(a) * 0.13, 1.645 + 0.01 * Math.cos(a * 2), -0.012 + Math.cos(a) * 0.11]); }
      plait(P, pts, 0.03, B.head, S.hair);
    }
  }

  /** headwear of the realistic style: shells over the head and lathe profiles (§19.1) */
  function buildRealHat(P, app) {
    const S = SLOT, hat = app.hat;
    if (!hat || hat === 'none') return;
    const ring = (e0, e1, grow, nu = 44, open) => sweep((v, u, out) => { const yaw = u * TAU; const e = lerp(e0(yaw), e1(yaw), v); const c = Math.cos(e); headPos(Math.sin(yaw) * c, Math.sin(e), Math.cos(yaw) * c, grow, out); }, { nu, nv: 4, open, cap0: false, cap1: false });
    /** a flat brim that droops (or turns up) toward its edge */
    const brim = (r, y, drop, segs = 48, z = -0.004) => { const g = cyl(r, r, 0.003, segs, false); const bp = g.attributes.position; for (let i = 0; i < bp.count; i++) { const d = Math.hypot(bp.getX(i), bp.getZ(i)); bp.setY(i, bp.getY(i) - drop * smooth(0.1, r, d)); } g.computeVertexNormals(); return xf(g, 0, y, z); };
    /** 갓끈: bead strings from the brim tied under the chin */
    const strings = (slot, beads) => {
      for (const s of [1, -1]) {
        const pts = [[s * 0.07, 1.63, 0.02], [s * 0.075, 1.52, 0.055], [s * 0.035, 1.41, 0.075], [s * 0.03, 1.32, 0.11], [s * 0.035, 1.22, 0.12]];
        P.add(sweepPath(pts, 0.0022, { nu: 4, nv: 16 }), (x, y) => { const t = smooth(1.43, 1.36, y); return [B.head, 1 - t, B.cloth, t]; }, slot);
        if (beads) for (let i = 0; i < 6; i++) { const t = 0.45 + i * 0.09; const q = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p))).getPointAt(Math.min(1, t)); P.add(xf(sphere(0.0055, 6, 5), q.x, q.y, q.z), (x, y) => { const k = smooth(1.43, 1.36, y); return [B.head, 1 - k, B.cloth, k]; }, S.dark); }
      }
    };
    const ties = (slot) => { for (const s of [1, -1]) P.add(sweepPath([[s * 0.075, 1.6, 0.0], [s * 0.07, 1.5, 0.04], [s * 0.03, 1.43, 0.07]], 0.003, { nu: 4, nv: 8 }), B.head, slot); };
    /** a cap over the skull: lo / hi = the elevation band it covers, face = how far it stays off the face */
    const cap = (grow, lo, hi, faceEl, extra) => headShell((yaw, elev) => {
      const ay = Math.abs(yaw), l = typeof lo === 'function' ? lo(ay) : lo;
      const face = faceEl == null ? 0 : smooth(-0.08, 0.08, 1.0 - ay) * smooth(-0.06, 0.06, faceEl - elev);
      const on = smooth(l - 0.04, l + 0.04, elev) * smooth(hi + 0.04, hi - 0.04, elev) * (1 - face);
      return lerp(-0.004, grow + (extra ? extra(yaw, elev) : 0), on);
    }, 44, 30);
    switch (hat) {
      case 'gat': case 'chorip': case 'paeraengi': { // 갓 (horsehair), 초립 (fine straw), 패랭이 (bamboo)
        const R = hat === 'gat' ? 0.205 : hat === 'chorip' ? 0.15 : 0.17, H = hat === 'gat' ? 0.14 : hat === 'chorip' ? 0.1 : 0.085;
        P.add(brim(R, 1.632, hat === 'paeraengi' ? 0.014 : 0.01), B.head, S.hat);
        P.add(xf(cyl(hat === 'paeraengi' ? 0.045 : 0.056, hat === 'paeraengi' ? 0.07 : 0.067, H, 24), 0, 1.633 + H / 2, -0.004), B.head, S.hat);
        P.add(xf(cyl(0.068, 0.068, 0.018, 24, true), 0, 1.64, -0.004), B.head, S.hat2);
        strings(hat === 'gat' ? S.dark : S.hat2, hat === 'gat');
        if (hat === 'paeraengi') for (const s of [1, -1]) P.add(xf(sphere(0.02, 8, 6), s * 0.07, 1.665, 0.0), B.head, S.white); // 목화송이
        break;
      }
      case 'jeollip': { // 전립: a felt dome with a turned-up brim, a peacock feather and a red tassel
        const g = brim(0.15, 1.632, -0.03, 40); P.add(g, B.head, S.hat);
        P.add(xf(lathe([[0.085, 0], [0.084, 0.03], [0.07, 0.06], [0.04, 0.078], [0, 0.082]], 24), 0, 1.632, -0.004), B.head, S.hat);
        P.add(xf(sphere(0.016, 8, 6), 0, 1.718, -0.004), B.head, S.gold);
        P.add(xf(lathe([[0, 0], [0.012, -0.004], [0.02, -0.05], [0, -0.054]], 10), 0, 1.72, -0.03, 0.9, 0, 0), B.head, S.red);
        P.add(sweepPath([[0.03, 1.71, -0.03], [0.06, 1.78, -0.1], [0.07, 1.82, -0.18]], (v) => 0.006 + 0.012 * Math.sin(Math.PI * v), { nu: 5, nv: 8, flat: 0.3 }), B.head, S.leaf);
        strings(S.hat2, false);
        break;
      }
      case 'satgat': case 'jeonmo': { // 삿갓 (a deep straw cone) / 전모 (a flat umbrella of oiled paper)
        const deep = hat === 'satgat';
        P.add(xf(lathe(deep ? [[0.27, 0], [0.2, 0.04], [0.1, 0.12], [0.02, 0.18], [0, 0.185]] : [[0.25, 0], [0.18, 0.025], [0.07, 0.07], [0, 0.085]], 32), 0, deep ? 1.6 : 1.64, -0.006), B.head, S.hat);
        P.add(xf(cyl(0.09, 0.09, 0.03, 20, true), 0, 1.65, -0.006), B.head, S.hat2);
        if (!deep) for (let i = 0; i < 12; i++) { const a = (i / 12) * TAU; P.add(sweepPath([[0, 1.725, -0.006], [Math.sin(a) * 0.12, 1.69, Math.cos(a) * 0.12 - 0.006], [Math.sin(a) * 0.245, 1.643, Math.cos(a) * 0.245 - 0.006]], 0.002, { nu: 3, nv: 6 }), B.head, i % 2 ? S.red : S.blue); }
        ties(S.hat2);
        break;
      }
      case 'samo': { // 사모: a black crown higher at the back, two flat wings
        P.add(cap(0.016, -0.15, 1.6, 0.55), B.head, S.hat);
        P.add(xf(lathe([[0.075, 0], [0.074, 0.06], [0.055, 0.09], [0, 0.095]], 24, 0.8), 0, 1.63, -0.04), B.head, S.hat);
        for (const s of [1, -1]) P.add(xf(rbox(0.14, 0.05, 0.004, 0.02), s * 0.11, 1.68, -0.08, 0, s * 0.15, s * 0.1), B.head, S.hat);
        break;
      }
      case 'yugeon': case 'tanggeon': case 'jeongja': { // 유건 (a square hood), 탕건 (the small crown under a 갓), 정자관 (tiers of peaks)
        P.add(cap(0.01, 0.35, 1.6, null), B.head, S.hat);
        if (hat === 'yugeon') { P.add(xf(rbox(0.15, 0.1, 0.19, 0.01), 0, 1.68, -0.01), B.head, S.hat); P.add(xf(rbox(0.004, 0.09, 0.2, 0.002), 0, 1.73, -0.01, 0, 0, 0), B.head, S.hat2); for (const s of [1, -1]) P.add(xf(rbox(0.035, 0.16, 0.004, 0.002), s * 0.03, 1.5, backZ(1.5) - 0.02, 0.1, 0, s * 0.08), B.hairB, S.hat); }
        else if (hat === 'tanggeon') P.add(xf(lathe([[0.086, 0], [0.085, 0.04], [0.075, 0.075], [0.05, 0.09], [0, 0.092]], 24, 0.95), 0, 1.6, -0.01, -0.12, 0, 0), B.head, S.hat);
        else for (let k = 0; k < 3; k++) { const y = 1.64 + k * 0.045, w = 0.17 - k * 0.035; for (const z of [1, -1]) P.add(xf(rbox(w, 0.06, 0.006, 0.003), 0, y, -0.01 + z * (0.07 - k * 0.012), 0, 0, 0), B.head, S.hat); for (const s of [1, -1]) P.add(xf(rbox(0.006, 0.06, 0.14 - k * 0.024, 0.003), s * w / 2, y, -0.01), B.head, S.hat); P.add(xf(rbox(w * 0.7, 0.04, 0.006, 0.003), 0, y + 0.04, -0.01, 0, 0, 0), B.head, S.hat2); }
        break;
      }
      case 'ayam': case 'jobawi': case 'nambawi': case 'pungcha': { // winter coverings: 아얌 (forehead), 조바위 (ears), 남바위 / 풍차 (ears, neck; open on top)
        const ear = hat !== 'ayam', open = hat === 'nambawi' || hat === 'pungcha';
        const lo = (ay) => (hat === 'pungcha' ? lerp(-0.6, 0.3, smooth(2.2, 0.9, ay)) : hat === 'nambawi' ? lerp(-0.62, 0.3, smooth(1.9, 0.9, ay)) : ear ? lerp(-0.42, 0.3, smooth(1.9, 0.9, ay)) : 0.22);
        P.add(cap(ear ? 0.03 : 0.022, lo, open ? 0.72 : 0.86, 0.62), B.head, S.hat);
        P.add(ring(() => (open ? 0.72 : 0.86), () => (open ? 0.78 : 0.9), 0.018), B.head, S.dark);       // fur trim
        if (open) P.add(ring(() => 0.3, () => 0.36, 0.019, 30, true), B.head, S.dark);
        P.add(xf(sphere(0.011, 8, 6), 0, HEAD.cy + 0.095, headPos(0, 0.8, 0.6, 0.02, [0, 0, 0])[2] + 0.004), B.head, S.hat2); // 술
        if (!ear) for (const s of [1, -1]) P.add(xf(rbox(0.04, 0.42, 0.004, 0.002), s * 0.024, 1.36, backZ(1.36) - 0.03, 0.03, 0, s * 0.04), B.hairB, S.hat2); // 드림
        else for (const z of [1, -1]) P.add(xf(sphere(0.008, 8, 6), 0, HEAD.cy + 0.075, headPos(0, 0.65, 0.76 * z, 0.02, [0, 0, 0])[2]), B.head, S.gold);
        break;
      }
      case 'hogeon': case 'bokgeon': case 'gulle': { // 호건 (tiger), 복건 (black hood, a flap), 굴레 (a child's bright cap with beads)
        P.add(cap(0.015, -0.5, 1.6, 0.55, hat === 'bokgeon' ? (yaw, elev) => 0.012 * smooth(0, -1, Math.cos(yaw)) * smooth(0.2, 0.9, elev) : null), B.head, S.hat);
        if (hat !== 'gulle') P.add(xf(rbox(0.12, 0.2, 0.008, 0.004), 0, 1.43, backZ(1.43) - 0.022, 0.12, 0, 0), B.hairB, S.hat);
        if (hat === 'hogeon') for (const s of [1, -1]) { P.add(xf(sphere(0.022, 8, 6), s * 0.055, 1.67, -0.01, 0, 0, 0, 1, 1, 0.5), B.head, S.hat); P.add(xf(sphere(0.012, 6, 5), s * 0.055, 1.67, 0.0, 0, 0, 0, 1, 1, 0.4), B.head, S.hat2); }
        else if (hat === 'bokgeon') for (const s of [1, -1]) P.add(xf(rbox(0.02, 0.16, 0.004, 0.002), s * 0.03, 1.35, backZ(1.35) - 0.03, 0.08, 0, s * 0.1), B.hairB, S.hat);
        else { for (let i = 0; i < 5; i++) P.add(xf(sphere(0.008, 6, 5), 0, 1.66 - i * 0.03, headPos(0, 0.95 - i * 0.2, -0.3 - i * 0.12, 0.02, [0, 0, 0])[2]), B.head, i % 2 ? S.red : S.gold); P.add(xf(rbox(0.05, 0.22, 0.004, 0.002), 0, 1.4, backZ(1.4) - 0.03, 0.1, 0, 0), B.hairB, S.hat2); }
        break;
      }
      case 'jokduri': case 'hwagwan': { // 족두리 / 화관: a small crown on the top of the head; the 화관 with flowers
        const big = hat === 'hwagwan';
        P.add(xf(lathe(big ? [[0, 0], [0.045, 0.004], [0.052, 0.04], [0.036, 0.062], [0, 0.066]] : [[0, 0], [0.034, 0.004], [0.04, 0.03], [0.027, 0.045], [0, 0.048]], 8), 0, 1.658, 0.016, -0.18, 0, 0), B.head, S.hat);
        const n = big ? 10 : 6;
        for (let i = 0; i < n; i++) { const a = (i / n) * TAU; P.add(xf(sphere(big ? 0.009 : 0.006, 6, 5), Math.sin(a) * (big ? 0.042 : 0.03), big ? 1.72 : 1.704, 0.016 + Math.cos(a) * (big ? 0.042 : 0.03) - 0.008), B.head, i % 3 === 0 ? S.red : i % 3 === 1 ? S.hat2 : big ? S.leaf : S.hat2); }
        P.add(xf(sphere(big ? 0.013 : 0.009, 8, 6), 0, big ? 1.74 : 1.718, 0.012), B.head, S.hat2);
        if (big) for (const s of [1, -1]) P.add(sweepPath([[s * 0.04, 1.71, 0.02], [s * 0.07, 1.68, 0.04], [s * 0.08, 1.62, 0.05]], 0.0025, { nu: 3, nv: 6 }), B.head, S.gold);
        break;
      }
      case 'gokkal': { // 고깔: a tall paper cone covered in paper flowers
        P.add(xf(lathe([[0.088, 0], [0.07, 0.08], [0.04, 0.17], [0, 0.25]], 24, 0.95), 0, 1.6, -0.01), B.head, S.hat);
        const fc = [S.red, S.gold, S.blue, S.red, S.leaf, S.gold];
        for (let i = 0; i < 12; i++) { const t = (i % 4) / 4, a = i * 2.4; const r = lerp(0.085, 0.045, t); P.add(xf(sphere(0.02, 8, 6), Math.sin(a) * r, 1.62 + t * 0.15, Math.cos(a) * r - 0.01), B.head, fc[i % 6]); }
        ties(S.hat);
        break;
      }
      case 'sangmo': { // 상모: a small black hat with a long white ribbon on a pivot
        P.add(xf(lathe([[0.088, 0], [0.087, 0.03], [0.07, 0.06], [0, 0.066]], 24), 0, 1.6, -0.01), B.head, S.hat);
        P.add(xf(brim(0.12, 1.604, 0.004, 32, -0.01), 0, 0, 0), B.head, S.hat);
        P.add(xf(sphere(0.012, 8, 6), 0, 1.672, -0.01), B.head, S.gold);
        P.add(sweepPath([[0, 1.68, -0.01], [0, 1.78, -0.08], [0, 1.72, -0.25], [0, 1.55, -0.36], [0, 1.35, -0.4]], 0.012, { nu: 6, nv: 24, flat: 0.12 }), B.pony, S.white);
        ties(S.hat);
        break;
      }
      case 'strawhat': {
        const g = brim(0.215, 1.635, 0.028, 40, -0.006);
        P.add(tilt2(g, -0.08), B.head, S.hat);
        P.add(tilt2(xf(lathe([[0.096, 1.632], [0.095, 1.69], [0.088, 1.715], [0.06, 1.728], [0, 1.73]], 28), 0, 0, -0.006), -0.08), B.head, S.hat);
        P.add(tilt2(xf(cyl(0.0975, 0.0975, 0.018, 28, true), 0, 1.648, -0.006), -0.08), B.head, S.hat2);
        break;
      }
      case 'sugeon': { // 머릿수건: a cloth round the head, knotted at the right front
        P.add(ring(() => 0.48, () => 0.66, 0.014), B.head, S.hat);
        const k = headPos(-0.5, 0.55, 0.7, 0.02, [0, 0, 0]);
        P.add(xf(sphere(0.014, 8, 6), k[0], k[1], k[2], 0, 0, 0, 1.3, 1, 0.7), B.head, S.hat);
        for (const s of [1, -1]) P.add(xf(rbox(0.022, 0.05, 0.004, 0.002), k[0] - 0.01, k[1] - 0.025, k[2] + 0.004, 0, -0.6, s * 0.5), B.head, S.hat);
        break;
      }
      default: break;
    }
  }
  /** rotate a model-space geometry around the realistic head centre (hat tilt) */
  function tilt2(geo, rx) { xf(geo, 0, -HEAD.cy, 0); xf(geo, 0, 0, 0, rx, 0, 0); return xf(geo, 0, HEAD.cy, 0); }

  /** 짐: 봇짐 (a bundle on the back), 괴나리봇짐 (a small one with a strap), 바구니 (basket), 보자기 (a wrapped bundle in the hand) */
  function buildRealBag(P, app) {
    const S = SLOT, bag = app.bag;
    const straps = (y0) => { for (const s of [1, -1]) P.add(sweepPath([[s * 0.07, y0, -0.12], [s * 0.1, 1.41, -0.06], [s * 0.115, 1.4, 0.03], torsoPt(s * 0.75, 1.28, 0.014), torsoPt(s * 1.1, 1.12, 0.014), [s * 0.12, 1.06, -0.11]], 0.008, { nu: 5, nv: 20, flat: 0.4 }), torsoW, S.bag2); };
    if (bag === 'botjim' || bag === 'gwaenari') {
      const big = bag === 'botjim';
      P.add(xf(sphere(1, 16, 12), 0, big ? 1.18 : 1.24, big ? -0.2 : -0.17, 0, 0, 0, big ? 0.17 : 0.12, big ? 0.15 : 0.1, big ? 0.1 : 0.075), B.bag, S.bag);
      P.add(xf(sphere(0.03, 10, 8), 0, big ? 1.32 : 1.33, big ? -0.18 : -0.16, 0, 0, 0, 1.4, 0.8, 1), B.bag, S.bag2);             // the knot
      for (const s of [1, -1]) P.add(xf(rbox(0.03, 0.07, 0.005, 0.002), s * 0.03, big ? 1.3 : 1.31, big ? -0.165 : -0.15, 0.2, 0, s * 0.7), B.bag, S.bag2);
      straps(1.32);
    } else if (bag === 'basket') {
      P.add(xf(lathe([[0, 0], [0.1, 0.005], [0.13, 0.12], [0.15, 0.3], [0.145, 0.305], [0, 0.29]], 20), 0, 1.04, -0.22, -0.1, 0, 0), B.bag, S.bag);
      P.add(xf(torus(0.148, 0.01, 5, 24), 0, 1.335, -0.25, Math.PI / 2 - 0.1, 0, 0), B.bag, S.bag2);
      for (const [lx, ly, lz] of [[-0.05, 1.36, -0.24], [0.05, 1.37, -0.21], [0, 1.38, -0.28]]) P.add(xf(sphere(0.05, 10, 8), lx, ly, lz, 0, 0, 0, 1, 0.7, 1), B.bag, S.leaf);
      for (const s of [1, -1]) P.add(sweepPath([[s * 0.08, 1.32, -0.14], [s * 0.11, 1.41, -0.05], [s * 0.115, 1.4, 0.03], torsoPt(s * 0.75, 1.27, 0.014), [s * 0.13, 1.12, -0.13]], 0.008, { nu: 5, nv: 18, flat: 0.5 }), torsoW, S.bag2);
    } else if (bag === 'bojagi') { // in the left hand: a square bundle with its four corners knotted on top
      P.add(xf(rbox(0.13, 0.09, 0.11, 0.035), 0.22, 0.69, 0.0), B.hdL, S.bag);
      P.add(xf(sphere(0.018, 8, 6), 0.215, 0.76, 0.0), B.hdL, S.bag);
      for (const s of [1, -1]) P.add(xf(rbox(0.02, 0.04, 0.004, 0.002), 0.215 + s * 0.012, 0.785, 0, 0, 0, s * 0.6), B.hdL, S.bag2);
    }
  }

  /** 꾸미개, each in a slot of its own: 노리개, 주머니, 부채, 머리꽂이, 댕기, 띠 */
  function buildRealTrinket(P, app) {
    const S = SLOT;
    const chima = !!(BOTTOM_KIT[app.bottom] || {}).chima;
    const knot = torsoPt(-0.58, chima ? 1.2 : 1.15, 0.03);
    // ---- 노리개: hangs from the 고름 (knot, ornaments, long tassels on the cloth spring)
    const nor = app.norigae;
    if (nor && nor !== 'none') {
      const p = knot;
      const one = (dx, y0, orn, len) => {
        P.add(xf(sphere(0.007, 8, 6), p[0] + dx, y0, p[2]), B.cloth, S.nor);
        if (orn === 'nabi') for (const s of [1, -1]) P.add(xf(sphere(1, 10, 8), p[0] + dx + s * 0.016, y0 - 0.035, p[2] + 0.002, 0, 0, s * 0.5, 0.017, 0.012, 0.004), B.cloth, S.gold);
        else if (orn === 'bangul') for (let i = 0; i < 3; i++) P.add(xf(sphere(0.008, 8, 6), p[0] + dx + (i - 1) * 0.012, y0 - 0.032 - (i === 1 ? 0.006 : 0), p[2]), B.cloth, S.gold);
        else P.add(xf(sphere(1, 10, 8), p[0] + dx, y0 - 0.035, p[2] + 0.002, 0, 0, 0, 0.02, 0.028, 0.009), B.cloth, orn === 'jade' ? S.leaf : S.gold);
        P.add(xf(sphere(0.008, 8, 6), p[0] + dx, y0 - 0.07, p[2]), B.cloth, S.nor);
        P.add(xf(lathe([[0, 0], [0.007, -0.004], [0.013, -0.05], [0.016, -len * 1.3], [0, -len * 1.3 - 0.004]], 10), p[0] + dx, y0 - 0.078, p[2]), B.cloth, S.nor);
      };
      P.add(sweepPath([[p[0], p[1], p[2]], [p[0], p[1] - 0.05, p[2] + 0.002]], 0.002, { nu: 3, nv: 4 }), B.cloth, S.nor);
      if (nor === 'samjak') { one(-0.026, p[1] - 0.06, 'gold', 0.13); one(0, p[1] - 0.05, 'jade', 0.15); one(0.026, p[1] - 0.06, 'gold', 0.13); }
      else one(0, p[1] - 0.05, nor === 'nabi' ? 'nabi' : nor === 'bangul' ? 'bangul' : 'gold', 0.12);
    }
    // ---- 주머니: at the left hip on a cord
    const pou = app.pouch;
    if (pou && pou !== 'none') {
      const x = 0.165, y = 0.9, z = 0.05;
      if (pou === 'gwijumeoni') { P.add(xf(rbox(0.07, 0.06, 0.025, 0.012), x, y + 0.03, z), B.hips, S.pouch); for (const s of [1, -1]) P.add(xf(sphere(0.012, 6, 5), x + s * 0.037, y + 0.012, z, 0, 0, 0, 1, 1.4, 0.6), B.hips, S.pouch); }
      else P.add(xf(lathe([[0, 0], [0.03, 0.006], [0.042, 0.035], [0.03, 0.064], [0.014, 0.072], [0.02, 0.08], [0, 0.084]], 14), x, y, z), B.hips, S.pouch);
      P.add(xf(torus(0.015, 0.0035, 4, 12), x, 0.97, z, Math.PI / 2, 0, 0), B.hips, pou === 'bokjumeoni' ? S.gold : S.dark);
      P.add(sweepPath([[x, 0.975, z], [x - 0.005, 1.0, z + 0.02], torsoPt(0.9, 1.02, 0.02)], 0.003, { nu: 4, nv: 8 }), B.hips, S.gold);
    }
    // ---- 부채: in the left hand — 합죽선 (folded), 단선 (round silk), 파초선 (a big leaf)
    const fan = app.fan;
    if (fan === 'hapjuk') { P.add(xf(rbox(0.012, 0.25, 0.028, 0.005), 0.215, 0.73, 0.03, -0.35, 0, 0.05), B.hdL, S.acc); P.add(xf(sphere(0.008, 6, 5), 0.215, 0.85, -0.012), B.hdL, S.dark); }
    else if (fan === 'danseon' || fan === 'pacho') {
      const big = fan === 'pacho';
      P.add(xf(cyl(0.004, 0.004, big ? 0.16 : 0.12, 6), 0.215, 0.73, 0.02, -0.3, 0, 0), B.hdL, S.dark);
      P.add(xf(cyl(big ? 0.12 : 0.085, big ? 0.12 : 0.085, 0.004, 24), 0.215, big ? 0.6 : 0.62, big ? 0.07 : 0.06, Math.PI / 2 - 0.3, 0, 0, big ? 0.7 : 1, 1, 1), B.hdL, S.acc);
    }
    // ---- 머리꽂이: 비녀 / 옥비녀 through the bun, 떨잠 on the top of the head, 뒤꽂이 behind the bun
    const pin = app.hairpin;
    if (pin && pin !== 'none') {
      const bunHair = app.hair === 'jjok' || app.hair === 'keunmeori' || app.hair === 'eonjeun';
      const by = app.hair === 'jjok' ? 1.466 : 1.5, bz = backZ(by) - 0.03;
      if (pin === 'binyeo' || pin === 'okbinyeo') { P.add(xf(cyl(0.004, 0.004, bunHair ? 0.19 : 0.14, 8), 0, by, bz, 0, 0, Math.PI / 2), B.head, pin === 'okbinyeo' ? S.leaf : S.acc); for (const s of [1, -1]) P.add(xf(sphere(0.008, 8, 6), s * (bunHair ? 0.095 : 0.07), by, bz), B.head, pin === 'okbinyeo' ? S.leaf : S.acc); }
      else if (pin === 'tteoljam') { const p = headPos(0, 0.9, 0.42, 0.014, [0, 0, 0]); P.add(xf(sphere(0.014, 8, 6), p[0], p[1], p[2]), B.head, S.acc); for (let i = 0; i < 5; i++) { const a = (i / 5) * TAU; P.add(xf(sphere(0.006, 6, 5), p[0] + Math.sin(a) * 0.016, p[1] + 0.006 + Math.cos(a) * 0.01, p[2]), B.head, i % 2 ? S.red : S.gold); } }
      else { P.add(xf(rbox(0.05, 0.012, 0.012, 0.005), 0, by + 0.02, bz - 0.01, 0, 0, 0.3), B.head, S.acc); P.add(xf(sphere(0.009, 6, 5), 0.024, by + 0.028, bz - 0.012), B.head, S.red); }
    }
    // ---- 댕기: 제비부리 at a braid's end (or a bow), 도투락 (a wide pair falling down the back), 배씨 (on the parting)
    const rib = app.ribbon;
    if (rib === 'jebi' && !['daenggi', 'twinbraid', 'ttaeun', 'gwimit'].includes(app.hair)) {
      P.add(xf(rbox(0.05, 0.022, 0.012, 0.006), 0, 1.5, backZ(1.5) - 0.012, 0.2, 0, 0), B.head, S.rib);
      for (const s of [1, -1]) P.add(xf(rbox(0.018, 0.09, 0.004, 0.002), s * 0.012, 1.44, backZ(1.44) - 0.016, 0.1, 0, s * 0.2), B.hairB, S.rib);
    } else if (rib === 'doturak') {
      for (const s of [1, -1]) P.add(sweep((v, u, out) => { const y = lerp(1.47, 0.62, v); const x = s * (0.035 + 0.01 * v) + lerp(-0.022, 0.022, u); out[0] = x; out[1] = y; out[2] = backZ(Math.max(0.85, y)) - 0.04 - 0.05 * smooth(1.1, 0.62, y); }, { nu: 2, nv: 14, open: true }), B.hairB, S.rib);
      P.add(xf(rbox(0.09, 0.03, 0.014, 0.006), 0, 1.475, backZ(1.475) - 0.03), B.head, S.rib);
    } else if (rib === 'baessi') {
      const p = headPos(0, 0.72, 0.68, 0.012, [0, 0, 0]);
      P.add(xf(sphere(1, 10, 8), p[0], p[1], p[2], -0.6, 0, 0, 0.012, 0.018, 0.005), B.head, S.rib);
      P.add(xf(sphere(0.005, 6, 5), p[0], p[1] + 0.018, p[2] - 0.004), B.head, S.gold);
    }
    // ---- 띠: 세조대 (a thin cord at the chest), 광다회 (a wide cord), 전대 (a sash), 각대 (a stiff belt), 삼색띠 (풍물)
    const belt = app.belt;
    const od = OUTER_KIT[app.outer];
    const over = od && !od.apron ? 0.036 : chima ? 0.02 : 0.026;
    if (belt === 'sejodae' || belt === 'gwangdahoe' || belt === 'jeondae') {
      const y = belt === 'sejodae' ? 1.2 : belt === 'jeondae' ? 1.08 : 1.06, th = belt === 'sejodae' ? 0.006 : belt === 'gwangdahoe' ? 0.012 : 0.022;
      P.add(torsoShell(y + th, y - th, over + 0.004, { nu: 34, nv: 1 }), torsoW, S.belt);
      const k = torsoPt(-0.35, y, over + 0.012);
      P.add(xf(sphere(belt === 'jeondae' ? 0.018 : 0.011, 8, 6), k[0], k[1], k[2], 0, 0, 0, 1.4, 1, 0.7), B.cloth, S.belt);
      hangBand(P, [k[0] + 0.01, k[1] - 0.01, k[2] + 0.004], belt === 'sejodae' ? 0.42 : 0.32, belt === 'jeondae' ? 0.04 : 0.012, 0.04, S.belt);
      hangBand(P, [k[0] - 0.01, k[1] - 0.01, k[2] + 0.006], belt === 'sejodae' ? 0.36 : 0.28, belt === 'jeondae' ? 0.034 : 0.012, -0.06, S.belt);
      if (belt === 'sejodae') for (const dx of [0.01, -0.01]) P.add(xf(lathe([[0, 0], [0.006, -0.004], [0.01, -0.05], [0, -0.054]], 8), k[0] + dx, k[1] - 0.42, k[2] + 0.004), B.cloth, S.belt); // 술
    } else if (belt === 'gakdae') { // stands off the robe, lower in front
      P.add(sweep((v, u, out) => { const a = u * TAU; const y = lerp(1.03, 1.06, (1 - Math.cos(a)) / 2) + lerp(0.012, -0.012, v); const r = torsoAt(y); const p = se(a, r[0] + over + 0.03, r[1] + over + 0.035, 2.3); out[0] = p[0]; out[1] = y; out[2] = r[2] + p[1] + 0.01; }, { nu: 40, nv: 1 }), torsoW, S.belt);
    } else if (belt === 'saekdi') { // 삼색띠: three sashes across the chest from the left shoulder to the right hip
      const cols = [S.red, S.blue, S.gold];
      for (let i = 0; i < 3; i++) { const d = (i - 1) * 0.025; P.add(sweepPath([torsoPt(0.9, 1.36 + d, over), torsoPt(0.25, 1.22 + d, over + 0.004), torsoPt(-0.4, 1.06 + d, over + 0.004), torsoPt(-1.2, 0.98 + d, over), torsoPt(-2.4, 1.1 + d, over), torsoPt(-3.0, 1.3 + d, over)], 0.01, { nu: 5, nv: 24, flat: 0.25 }), torsoW, cols[i]); }
      const k = torsoPt(-0.9, 1.0, over + 0.02);
      hangBand(P, k, 0.3, 0.03, 0.05, S.red); hangBand(P, [k[0] - 0.02, k[1], k[2]], 0.26, 0.03, -0.05, S.blue);
    }
  }

  // ---------------------------------------------------------------- face decal (canvas texture per face type × expression)
  const FW = 384, FH = 280;
  const FWR = 320, FHR = 400, FACE_W = 0.15, FACE_H = 0.19; // the realistic face: 0.15 × 0.19 m of the head on 320 × 400 px
  let faceGeo = null, faceGeoReal = null;
  function faceGeometry(style) {
    if (style === 'real') return faceGeometryReal();
    if (faceGeo) return faceGeo;
    const g = new THREE.SphereGeometry(R * 1.012, 28, 20, Math.PI / 2 - 0.85, 1.7, Math.PI / 2 - 0.62, 1.24);
    xf(g, 0, 0, 0, 0, 0, 0, HS[0], HS[1], HS[2]);
    xf(g, 0, HC - BONES[B.head][3], 0);
    faceGeo = g;
    return g;
  }
  /** the decal of the realistic face: the front of the sculpted head itself, 0.8 mm out, UVs projected flat */
  function faceGeometryReal() {
    if (faceGeoReal) return faceGeoReal;
    const g = sweep((v, u, out) => {
      const yaw = lerp(-1.22, 1.22, u), elev = lerp(0.6, -1.18, v), c = Math.cos(elev); // rows top → bottom: outward winding
      headPos(Math.sin(yaw) * c, Math.sin(elev), Math.cos(yaw) * c, 0.0008, out);
    }, { nu: 34, nv: 30, open: true, cap0: false, cap1: false });
    const p = g.attributes.position, uv = g.attributes.uv;
    const hb = BONES_REAL[B.head];
    for (let i = 0; i < p.count; i++) {
      uv.setXY(i, 0.5 + p.getX(i) / FACE_W, 0.5 + (p.getY(i) - (HEAD.cy - 0.02)) / FACE_H);
      p.setXYZ(i, p.getX(i) - hb[2], p.getY(i) - hb[3], p.getZ(i) - hb[4]);
    }
    g.computeBoundingSphere();
    faceGeoReal = g;
    return g;
  }
  const faceMats = new Map();
  // the round style draws the nine faces with its own few (§19.1)
  const CUTE_EXPR = { neutral: 'base', smile: 'base', laugh: 'happy', proud: 'happy', curious: 'think', focus: 'think', shy: 'base', sleepy: 'blink' };
  const FACE_RES = [[FWR, FHR], [256, 320], [512, 640]]; // [people] §19.9 the face on low (as before), medium, high
  const FACE_MAX = 72; // painted faces kept (least recently used ones are given back)
  function faceMaterial(face, expr, style, age, gaze) {
    if (style !== 'real' && CUTE_EXPR[expr]) expr = CUTE_EXPR[expr];
    const real = style === 'real';
    const q = real ? AV_Q.value : 0, res = FACE_RES[q] || FACE_RES[0];
    const key = real ? 'r:' + face + ':' + expr + ':' + (age || 'adult') + ':' + (gaze || 0) + ':' + res[0] : face + ':' + expr;
    let m = faceMats.get(key);
    if (m) { faceMats.delete(key); faceMats.set(key, m); }
    if (!m) {
      if (faceMats.size >= FACE_MAX) { const [k0, m0] = faceMats.entries().next().value; faceMats.delete(k0); if (m0.map) m0.map.dispose(); m0.dispose(); }
      const tex = real ? G.gfx.canvasTexture(res[0], res[1], (ctx) => drawFaceReal(ctx, face, expr, age, gaze, res[0], res[1]), { full: true }) : G.gfx.canvasTexture(FW, FH, (ctx) => drawFace(ctx, face, expr));
      m = new THREE.MeshStandardMaterial({ map: tex, transparent: true, depthWrite: false, roughness: real ? 0.5 : 0.55, envMapIntensity: 0.6, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
      m.name = 'avatarFace:' + key;
      if (real) { // [people] §19.9 the painted face is lit like the skin under it (wrapped, warm at the terminator)
        m.onBeforeCompile = (sh) => {
          sh.uniforms.uAvQ = AV_Q;
          sh.fragmentShader = 'uniform float uAvQ;\n' + AV_LIGHT_HEAD + sh.fragmentShader.replace('#include <lights_physical_pars_fragment>', avLightChunk())
            .replace('#include <color_fragment>', '#include <color_fragment>\n  avKindG = uAvQ > 0.5 ? 3.0 : 0.0;');
        };
        m.customProgramCacheKey = () => 'tfmAvatarFace1';
      }
      faceMats.set(key, m);
    }
    return m;
  }
  /**
   * [people] §19.9 the realistic face, painted at 512 px on high, 256 px on medium and 320 px on low (as before) — the
   * drawing keeps the 320 × 400 frame and is scaled. A calm picture-book face: eyes set into soft sockets with an upper
   * lid fold, a lash line and a lower lid, a white that darkens to its corners, an iris of fine fibres with a dark rim,
   * a pupil and a catch light; brows of single strokes; a small nose drawn by its shadows; lips with a soft edge and a
   * little colour; warm cheeks. Children: rounder, larger eyes and a smaller mouth; elders: grey brows, a heavier lid
   * and fine lines. The nine expressions move brows, lids, the eyes' direction and the mouth; gaze -1 / 0 / 1 turns
   * both irises to the person's right / ahead / left.
   */
  const FACE_AGE = { child: { ew: 1.08, eh: 1.14, ir: 1.12, mw: 0.86, blush: 1.35, brow: 0.8 }, youth: { ew: 1.04, eh: 1.06, ir: 1.06, mw: 0.93, blush: 1.15, brow: 0.9 },
    adult: { ew: 1, eh: 1, ir: 1, mw: 1, blush: 1, brow: 1 }, elder: { ew: 0.98, eh: 0.86, ir: 0.98, mw: 0.98, blush: 0.7, brow: 1.05, lines: 1, grey: 1 } };
  function drawFaceReal(ctx, face, expr, age, gaze, W0, H0) {
    const W = FWR, H = FHR, cx = W / 2, sc = (W0 || W) / W;
    ctx.clearRect(0, 0, W0 || W, H0 || H);
    ctx.save(); ctx.scale(sc, (H0 || H) / H);
    const A = FACE_AGE[age] || FACE_AGE.adult;
    const Y = (dy) => (1 - (0.5 + (dy + 0.02) / FACE_H)) * H; // dy: metres from the head centre
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const soft = (x, y, rx, ry, rgba) => { ctx.save(); ctx.translate(x, y); ctx.scale(1, ry / rx); const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx); g.addColorStop(0, rgba); g.addColorStop(1, rgba.replace(/[\d.]+\)$/, '0)')); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, rx, 0, TAU); ctx.fill(); ctx.restore(); };
    const blur = (px) => { try { ctx.filter = px > 0 ? `blur(${(px * sc).toFixed(2)}px)` : 'none'; } catch (e) { /* no filter: hard edges */ } };
    // the nine calm faces (무표정 미소 활짝 웃음 놀람 궁금 뿌듯 수줍음 졸림 집중) + the passing ones
    const M = { neutral: { smile: 0.04, open: 1 }, smile: { smile: 0.95, open: 0.9 },
      laugh: { happy: 1, open: 0.55, brow: -6, teeth: 1, smile: 1, mouthOpen: 9, blush: 0.3 },
      surprise: { open: 1.32, brow: -15, ring: 1, oMouth: 13 },
      curious: { browOne: -13, look: [7, -4], smile: 0.18, shift: 5, open: 1.05 },
      proud: { happy: 0.6, open: 0.62, brow: -4, smile: 1.15, blush: 0.2, chin: 1 },
      shy: { look: [-3, 6], open: 0.68, inner: 7, blush: 0.42, smile: 0.42, mw: 0.78 },
      sleepy: { open: 0.26, brow: 4, smile: 0.06, mw: 0.82, inner: 2, yawn: 1 },
      focus: { open: 0.72, brow: 4, inner: -7, smile: -0.12, mw: 0.86, press: 1 },
      happy: { happy: 1, open: 0.7, smile: 1, teeth: 1, mouthOpen: 5, brow: -3 }, wink: { happy: 1, smile: 0.9 }, think: { look: [6, -5], smile: 0, shift: 6, browOne: -8 },
      talk: { oMouth: 7, smile: 0.2 }, blink: { open: 0 } }[expr] || { smile: face === 'calm' ? 0.3 : face === 'gentle' ? 0.6 : 0.8 };
    const happy = !!M.happy || (face === 'cheer' && !(expr in { neutral: 1, sleepy: 1, focus: 1, shy: 1, curious: 1, surprise: 1 }));
    const ey = Y(0.005), edx = (0.031 / FACE_W) * W;
    const hairTone = A.grey ? 'rgba(150,144,136,0.9)' : 'rgba(48,32,24,0.88)';
    // ---- the shading that models the face: sockets, nose, the cheeks, under the lip, the jaw line
    for (const s of [-1, 1]) {
      soft(cx + s * edx * 1.04, ey - 6, 46, 30, `rgba(118,68,52,${A.lines ? 0.22 : 0.15})`);   // eye socket
      soft(cx + s * edx * 0.62, ey + 2, 14, 16, 'rgba(112,66,54,0.12)');                        // the inner corner, beside the bridge
      soft(cx + s * 15, Y(-0.028), 8, 30, 'rgba(118,70,55,0.13)');                              // sides of the nose
      soft(cx + s * 86, Y(-0.044), 44, 28, `rgba(236,112,108,${(M.blush || (happy ? 0.2 : 0.12)) * A.blush})`); // cheek
      soft(cx + s * 98, Y(-0.02), 26, 40, 'rgba(255,236,226,0.12)');                            // light on the cheekbone
      soft(cx + s * 108, Y(-0.098), 34, 52, 'rgba(110,64,50,0.08)');                            // under the jaw
      soft(cx + s * 142, Y(-0.03), 30, 90, 'rgba(120,70,56,0.1)');                              // the side of the face turns away
    }
    soft(cx, Y(0.06), 70, 26, 'rgba(255,238,228,0.1)');   // light on the forehead
    soft(cx, Y(-0.012), 7, 26, 'rgba(255,240,232,0.2)');  // the bridge of the nose catches the light
    soft(cx, Y(-0.043), 9, 7, 'rgba(255,238,230,0.18)');  // its tip
    for (const s of [-1, 1]) soft(cx + s * 8.5, Y(-0.0495), 4.6, 2.8, 'rgba(80,38,32,0.42)'); // nostrils
    soft(cx, Y(-0.055), 24, 7, 'rgba(105,58,46,0.22)');   // under the nose
    soft(cx, Y(-0.066), 5, 8, 'rgba(110,62,50,0.12)');    // the groove above the lip
    soft(cx, Y(-0.093), 24, 9, 'rgba(118,68,54,0.17)');   // under the lower lip
    if (A.lines) { // fine lines: crow's feet, the folds from nose to mouth, the forehead, under the eyes
      ctx.strokeStyle = 'rgba(112,70,54,0.28)'; ctx.lineWidth = 1.3;
      for (const s of [-1, 1]) {
        const ox = cx + s * (edx + 36);
        for (let k = -1; k <= 1; k++) { ctx.beginPath(); ctx.moveTo(ox, ey + k * 6); ctx.quadraticCurveTo(ox + s * 7, ey + k * 7.5, ox + s * 12, ey + k * 10); ctx.stroke(); }
        ctx.beginPath(); ctx.moveTo(cx + s * 20, Y(-0.046)); ctx.quadraticCurveTo(cx + s * 34, Y(-0.066), cx + s * 31, Y(-0.088)); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(cx + s * (edx - 20), ey + 18); ctx.quadraticCurveTo(cx + s * edx, ey + 24, cx + s * (edx + 18), ey + 17); ctx.stroke();
      }
      ctx.strokeStyle = 'rgba(112,70,54,0.16)'; ctx.lineWidth = 1.4;
      for (const yy of [0.072, 0.083]) { ctx.beginPath(); ctx.moveTo(cx - 52, Y(yy)); ctx.quadraticCurveTo(cx, Y(yy + 0.004), cx + 52, Y(yy)); ctx.stroke(); }
    }
    // ---- brows: single strokes along an arch, thick at the head, fine at the tail
    const browLift = (face === 'bright' ? -4 : 0) + (M.brow || 0);
    for (const s of [-1, 1]) {
      const bx = cx + s * edx * 1.04, by = Y(0.028) + browLift + (M.browOne && s > 0 ? M.browOne : 0);
      const inner = M.inner != null ? M.inner : face === 'gentle' ? 4 : face === 'calm' ? 1 : -1;
      ctx.strokeStyle = hairTone;
      const n = Math.round(22 * A.brow);
      for (let i = 0; i < n; i++) {
        const t = i / (n - 1), x = bx + s * lerp(-31, 33, t), y = by + inner * (1 - t) * 1.25 - 8 * Math.sin(Math.PI * Math.min(1, t * 1.2)) + (t > 0.82 ? (t - 0.82) * 18 : 0);
        ctx.lineWidth = lerp(4.2, 1.6, t) * A.brow;
        const ang = lerp(-1.1, -0.25, t);
        ctx.beginPath(); ctx.moveTo(x - s * 3.5 * Math.cos(ang), y + 3.5); ctx.lineTo(x + s * 4.5 * Math.cos(ang), y - 2.5 + (i % 2)); ctx.stroke();
      }
    }
    // ---- eyes
    // (picture-book proportions: the eye a little larger and rounder than life, so that it reads at two metres)
    const eyeH = (face === 'bright' ? 19 : face === 'calm' ? 16.5 : face === 'gentle' ? 17.5 : 18.5) * A.eh;
    const eyeW = 33 * A.ew;
    const ir = 14.6 * A.ir * (M.ring ? 0.88 : 1);
    const look = [(M.look ? M.look[0] : 0) + (gaze || 0) * 7.5, M.look ? M.look[1] : 0];
    const drawEye = (s, open) => {
      const x = cx + s * edx, y = ey;
      const hv = M.happy ? 3 * M.happy : 0;
      const xi = x - s * eyeW, xo = x + s * eyeW, outer = (face === 'gentle' ? 3 : face === 'bright' ? -3 : -1) - (A.lines ? -2 : 0);
      if (open <= 0.12) { // closed: a curved lash line, the lid's fold above it
        ctx.strokeStyle = '#2a1a14'; ctx.lineWidth = 3.2;
        ctx.beginPath(); ctx.moveTo(xi, y + 2); ctx.quadraticCurveTo(x, y + (happy ? -9 : 7), xo, y + 1 + outer); ctx.stroke();
        ctx.strokeStyle = 'rgba(110,68,50,0.4)'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(xi + s * 6, y - 5); ctx.quadraticCurveTo(x, y + (happy ? -17 : -4), xo - s * 4, y - 4 + outer); ctx.stroke();
        if (!happy) { ctx.strokeStyle = 'rgba(40,24,18,0.55)'; ctx.lineWidth = 1.2; for (let k = 0; k < 5; k++) { const t = 0.35 + k * 0.14, lx = lerp(xi, xo, t), lyy = y + 1 + 6 * Math.sin(Math.PI * t); ctx.beginPath(); ctx.moveTo(lx, lyy); ctx.lineTo(lx + s * 2.5, lyy + 3); ctx.stroke(); } }
        return;
      }
      const hh = eyeH * open;
      const up = -hh * 1.22 + hv, lo = hh * (happy ? 0.42 : 0.8);
      const shape = () => {
        ctx.beginPath(); ctx.moveTo(xi, y + 2);
        ctx.bezierCurveTo(x - s * eyeW * 0.45, y + up, x + s * eyeW * 0.45, y + up * 0.96, xo, y + outer);
        ctx.bezierCurveTo(x + s * eyeW * 0.4, y + lo, x - s * eyeW * 0.5, y + lo * 1.04, xi, y + 2);
        ctx.closePath();
      };
      // the lid fold above the eye: a soft shadow and a crease line
      soft(x + s * 2, y + up - 6, eyeW * 0.95, 9, 'rgba(120,72,56,0.22)');
      ctx.strokeStyle = 'rgba(112,68,52,0.42)'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(xi + s * 7, y + up * 0.62 - 3); ctx.bezierCurveTo(x - s * eyeW * 0.3, y + up * 1.5 - 2, x + s * eyeW * 0.45, y + up * 1.42 - 2, xo - s * 1, y + outer - hh * 0.55); ctx.stroke();
      ctx.save();
      shape();
      const wg = ctx.createRadialGradient(x, y - 2, 2, x, y, eyeW * 1.05);
      wg.addColorStop(0, '#f5f0ea'); wg.addColorStop(0.62, '#eee6df'); wg.addColorStop(1, '#cdbdb3');
      ctx.fillStyle = wg; ctx.fill();
      ctx.clip();
      // the iris: fibres of warm brown, a lighter ring round the pupil, a dark rim; the pupil; the lid's shadow over it
      const ix = x + look[0], iy = y - 1 + look[1];
      const g = ctx.createRadialGradient(ix, iy, 1, ix, iy, ir);
      g.addColorStop(0, '#1a0f0a'); g.addColorStop(0.36, '#5a3620'); g.addColorStop(0.62, '#7a4c2c'); g.addColorStop(0.86, '#4e2f1c'); g.addColorStop(1, '#1d120c');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(ix, iy, ir, 0, TAU); ctx.fill();
      ctx.lineWidth = 0.9;
      for (let k = 0; k < 28; k++) { const a = k / 28 * TAU + 0.11 * (k % 3); ctx.strokeStyle = k % 2 ? 'rgba(160,110,70,0.35)' : 'rgba(40,22,14,0.3)'; ctx.beginPath(); ctx.moveTo(ix + Math.cos(a) * ir * 0.42, iy + Math.sin(a) * ir * 0.42); ctx.lineTo(ix + Math.cos(a) * ir * 0.9, iy + Math.sin(a) * ir * 0.9); ctx.stroke(); }
      ctx.strokeStyle = 'rgba(20,12,8,0.75)'; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.arc(ix, iy, ir - 0.6, 0, TAU); ctx.stroke();
      ctx.fillStyle = '#070403'; ctx.beginPath(); ctx.arc(ix, iy, ir * 0.38, 0, TAU); ctx.fill();
      const lg0 = ctx.createLinearGradient(0, y + up, 0, y + up + hh * 1.2);
      lg0.addColorStop(0, 'rgba(60,32,24,0.55)'); lg0.addColorStop(1, 'rgba(60,32,24,0)');
      ctx.fillStyle = lg0; ctx.fillRect(x - eyeW - 4, y + up - 2, eyeW * 2 + 8, hh * 1.3);
      ctx.fillStyle = 'rgba(255,255,255,0.96)'; ctx.beginPath(); ctx.ellipse(ix - 4, iy - 4.5, 3.6, 3.1, -0.4, 0, TAU); ctx.fill(); // the catch light
      ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.beginPath(); ctx.arc(ix + 4, iy + 4, 1.5, 0, TAU); ctx.fill();
      ctx.restore();
      // the upper lash line (thicker to the outer corner, a small flick) and the lower lid
      ctx.strokeStyle = '#1c110c';
      for (let k = 0; k < 3; k++) {
        ctx.lineWidth = 3.6 - k * 0.9;
        ctx.beginPath(); ctx.moveTo(xi + s * k * 6, y + 2 - (k ? 1 : 0)); ctx.bezierCurveTo(x - s * eyeW * 0.45, y + up, x + s * eyeW * 0.45, y + up * 0.96, xo + s * 3, y + outer - 2.5); ctx.stroke();
      }
      ctx.lineWidth = 1.2;
      for (let k = 0; k < 5; k++) { const t = 0.5 + k * 0.11, lx = lerp(xi, xo + s * 3, t), lyy = y + up * (0.92 - 0.6 * Math.pow(t - 0.5, 2) * 4) + (t > 0.8 ? 4 : 0); ctx.beginPath(); ctx.moveTo(lx, lyy); ctx.lineTo(lx + s * 3.5, lyy - 3.2); ctx.stroke(); }
      ctx.strokeStyle = 'rgba(255,226,214,0.5)'; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.moveTo(xi + s * 4, y + 4); ctx.quadraticCurveTo(x, y + lo + 2.5, xo - s * 2, y + outer + 1.5); ctx.stroke();
      ctx.strokeStyle = 'rgba(96,58,44,0.38)'; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(xi + s * 6, y + 5.5); ctx.quadraticCurveTo(x, y + lo + 5, xo - s * 1, y + outer + 3); ctx.stroke();
      ctx.fillStyle = 'rgba(214,128,124,0.7)'; ctx.beginPath(); ctx.ellipse(xi + s * 3, y + 2, 2.6, 2, 0, 0, TAU); ctx.fill(); // the inner corner
      if (happy) soft(x, y + lo + 8, 22, 6, 'rgba(255,226,212,0.3)'); // a smile lifts the cheek under the eye
    };
    for (const s of [-1, 1]) {
      let open = M.open != null ? M.open : happy ? 0.8 : face === 'calm' ? 0.94 : 1;
      if (expr === 'wink' && s > 0) open = 0;
      drawEye(s, open);
    }
    // ---- lips: an upper lip with a bow, a fuller lower lip with a light on it, soft edges; the mouth's line
    const my = Y(-0.074), mw = 26 * A.mw * (M.oMouth ? 0.62 : happy ? 1.14 : 1) * (M.mw || 1);
    const lipU = A.grey ? '#a8635d' : '#c0605a', lipL = A.grey ? '#bb7a72' : '#d97970';
    blur(0.7);
    if (M.oMouth) {
      const oh = M.oMouth;
      ctx.fillStyle = lipU; ctx.beginPath(); ctx.ellipse(cx, my + 2, mw * 0.9, oh, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = '#4a1c1c'; ctx.beginPath(); ctx.ellipse(cx, my + 3, mw * 0.64, oh * 0.64, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = 'rgba(200,110,110,0.55)'; ctx.beginPath(); ctx.ellipse(cx, my + 3 + oh * 0.35, mw * 0.4, oh * 0.22, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = 'rgba(255,200,196,0.4)'; ctx.beginPath(); ctx.ellipse(cx, my + oh * 0.95, mw * 0.5, 2.5, 0, 0, TAU); ctx.fill();
      blur(0); ctx.restore(); return;
    }
    const smileK = M.smile != null ? M.smile : 0.5;
    const corner = -6.5 * smileK, shift = M.shift || 0, open = M.mouthOpen || (M.yawn ? 3 : 0);
    ctx.fillStyle = lipU;
    ctx.beginPath();
    ctx.moveTo(cx - mw + shift, my + corner);
    ctx.bezierCurveTo(cx - mw * 0.6, my - 8.5, cx - 7, my - 11, cx, my - 6.5);
    ctx.bezierCurveTo(cx + 7, my - 11, cx + mw * 0.6, my - 8.5, cx + mw + shift, my + corner);
    ctx.quadraticCurveTo(cx, my + 2 + 3 * smileK, cx - mw + shift, my + corner);
    ctx.fill();
    const lg = ctx.createLinearGradient(0, my + open, 0, my + open + 13);
    lg.addColorStop(0, lipL); lg.addColorStop(1, 'rgba(210,125,116,0.5)');
    ctx.fillStyle = lg;
    ctx.beginPath();
    ctx.moveTo(cx - mw * 0.92 + shift, my + corner + 1);
    ctx.quadraticCurveTo(cx, my + 2 + 3 * smileK + open * 2, cx + mw * 0.92 + shift, my + corner + 1);
    ctx.bezierCurveTo(cx + mw * 0.55, my + 15.5 + open, cx - mw * 0.55, my + 15.5 + open, cx - mw * 0.92 + shift, my + corner + 1);
    ctx.fill();
    blur(0);
    if (open > 0) { // an open smile: the dark of the mouth, the upper teeth
      ctx.fillStyle = '#4c1e1e';
      ctx.beginPath(); ctx.moveTo(cx - mw * 0.82 + shift, my + corner * 0.8); ctx.quadraticCurveTo(cx, my + 2 + 3 * smileK + open * 2.2, cx + mw * 0.82 + shift, my + corner * 0.8); ctx.quadraticCurveTo(cx, my + 1 + 3 * smileK, cx - mw * 0.82 + shift, my + corner * 0.8); ctx.fill();
      if (M.teeth) { ctx.fillStyle = '#f4efe8'; ctx.beginPath(); ctx.moveTo(cx - mw * 0.7 + shift, my + corner * 0.7); ctx.quadraticCurveTo(cx, my + 2 + 3 * smileK + open * 0.9, cx + mw * 0.7 + shift, my + corner * 0.7); ctx.quadraticCurveTo(cx, my + 1 + 3 * smileK, cx - mw * 0.7 + shift, my + corner * 0.7); ctx.fill(); }
    }
    ctx.strokeStyle = M.press ? 'rgba(80,28,26,0.9)' : 'rgba(92,34,30,0.75)'; ctx.lineWidth = M.press ? 2.2 : 1.7;
    ctx.beginPath(); ctx.moveTo(cx - mw + shift, my + corner); ctx.quadraticCurveTo(cx, my + 2 + 3 * smileK, cx + mw + shift, my + corner); ctx.stroke();
    for (const s of [-1, 1]) soft(cx + s * (mw + 2) + shift, my + corner, 4, 4, 'rgba(100,52,42,0.3)'); // the corners
    if (smileK > 0.8) for (const s of [-1, 1]) soft(cx + s * (mw + 9) + shift, my + corner - 2, 5, 7, 'rgba(110,60,48,0.16)'); // dimples
    soft(cx, my - 5.5, 8, 3, 'rgba(255,215,200,0.25)'); // light on the upper lip
    soft(cx + 2, my + 7 + open, 9, 3, 'rgba(255,225,215,0.35)'); // and on the lower
    if (M.chin) soft(cx, Y(-0.1), 16, 7, 'rgba(255,232,222,0.18)');
    ctx.restore();
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
  // One program for every avatar (both styles): colour, roughness and a surface effect per palette slot come from
  // uniform arrays; the rest position of each vertex (before skinning) maps the effects, so they stick to the cloth
  // as it moves: a woven-linen detail on fabric (the pack's hemp_linen photograph when it is in the page, a drawn
  // weave otherwise), strands on hair, and drawn patterns — 금박 (gold leaf: metallic, glossy), 구름 / 꽃 (tone on tone),
  // 색동 (rainbow bands), straw weave (짚신, 밀짚모자, baskets), tiger stripes (호건).
  let patTex = null, weaveTex = null;
  function patternAtlas() {
    if (patTex) return patTex;
    patTex = G.gfx.canvasTexture(512, 512, (ctx) => {
      ctx.clearRect(0, 0, 512, 512);
      const tile = (ox, oy, draw) => { ctx.save(); ctx.beginPath(); ctx.rect(ox, oy, 256, 256); ctx.clip(); for (const dx of [-256, 0, 256]) for (const dy of [-256, 0, 256]) { ctx.save(); ctx.translate(ox + dx, oy + dy); draw(); ctx.restore(); } ctx.restore(); };
      const flower = (x, y, r, petals) => { for (let i = 0; i < petals; i++) { const a = (i / petals) * TAU; ctx.beginPath(); ctx.ellipse(x + Math.cos(a) * r * 0.55, y + Math.sin(a) * r * 0.55, r * 0.42, r * 0.22, a, 0, TAU); ctx.fill(); } ctx.beginPath(); ctx.arc(x, y, r * 0.2, 0, TAU); ctx.fill(); };
      ctx.fillStyle = '#fff'; ctx.strokeStyle = '#fff';
      // 금박: round flower medallions, small blossoms and dotted vines (alpha = gold)
      tile(0, 0, () => {
        flower(128, 128, 46, 8); ctx.lineWidth = 5; ctx.beginPath(); ctx.arc(128, 128, 58, 0, TAU); ctx.stroke();
        for (const [x, y] of [[0, 0], [256, 0], [0, 256], [256, 256]]) flower(x, y, 30, 6);
        for (const [x, y] of [[128, 0], [0, 128], [256, 128], [128, 256]]) { ctx.beginPath(); ctx.arc(x, y, 7, 0, TAU); ctx.fill(); }
        ctx.lineWidth = 3; for (const s of [-1, 1]) { ctx.beginPath(); ctx.moveTo(40, 128 + s * 40); ctx.quadraticCurveTo(80, 128 + s * 90, 128, 128 + s * 96); ctx.stroke(); }
      });
      // 구름 (운문): curling cloud strokes
      tile(256, 0, () => {
        ctx.lineWidth = 9; ctx.globalAlpha = 0.9;
        for (const [x, y, k] of [[70, 80, 1], [190, 190, -1], [200, 60, 1], [60, 210, -1]]) {
          ctx.beginPath(); ctx.arc(x, y, 26, Math.PI * 0.2, Math.PI * 1.7); ctx.stroke();
          ctx.beginPath(); ctx.arc(x + 34 * k, y + 8, 18, Math.PI * 1.1, Math.PI * 2.6); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(x - 30, y + 26); ctx.quadraticCurveTo(x + 10, y + 44, x + 60 * k, y + 30); ctx.stroke();
        }
        ctx.globalAlpha = 1;
      });
      // 꽃 (매화): scattered five-petal blossoms
      tile(0, 256, () => { for (const [x, y, r] of [[60, 60, 26], [180, 110, 22], [100, 190, 28], [220, 230, 18], [20, 150, 16]]) flower(x, y, r, 5); });
      // weave (used when the pack's linen is not in the page): over-under threads
      ctx.save(); ctx.beginPath(); ctx.rect(256, 256, 256, 256); ctx.clip();
      ctx.fillStyle = 'rgb(128,128,128)'; ctx.fillRect(256, 256, 256, 256);
      for (let i = 0; i < 32; i++) for (let j = 0; j < 32; j++) { const v = ((i + j) % 2) ? 165 : 95; ctx.fillStyle = `rgb(${v},${v},${v})`; ctx.fillRect(256 + i * 8 + 1, 256 + j * 8 + 1, 6, 6); }
      ctx.restore();
    });
    return patTex;
  }
  function weaveTexture() {
    if (weaveTex) return weaveTex;
    const P = G.pack;
    if (P && typeof P.texture === 'function' && P.usable && P.usable('mat/hemp_linen/c')) {
      try { weaveTex = P.texture('mat/hemp_linen/c', { repeat: [1, 1], wrap: 'repeat', priority: 6 }); } catch (e) { weaveTex = null; }
    }
    if (!weaveTex) {
      weaveTex = G.gfx.canvasTexture(64, 64, (ctx) => { for (let i = 0; i < 16; i++) for (let j = 0; j < 16; j++) { const r = G.util.rng(i * 31 + j)(); const v = Math.round(((i + j) % 2 ? 150 : 105) + r * 30); ctx.fillStyle = `rgb(${v},${v},${v})`; ctx.fillRect(i * 4, j * 4, 4, 4); } });
      weaveTex.wrapS = weaveTex.wrapT = THREE.RepeatWrapping;
    }
    return weaveTex;
  }
  // low: flat colours (§19.1) — one uniform shared by every avatar material, set from the engine's preset each frame
  const AV_FLAT = { value: 0 };
  const AV_Q = { value: 1 }; // [people] §19.9 the preset: 0 low (flat), 1 medium, 2 high — skin, hair, folds and weave
  const syncFlat = () => { const n = G.sys && G.sys.engine && G.sys.engine.preset && G.sys.engine.preset.name; AV_FLAT.value = n === 'low' ? 1 : 0; AV_Q.value = n === 'low' ? 0 : n === 'high' ? 2 : 1; };
  /**
   * [people] §19.9 skin, hair, cloth and silk light (medium / high; low stays flat). A few lines in the lighting of the
   * standard material — no extra pass, no texture: skin wraps the light round its terminator with a warm tint where
   * it turns away (thin parts glow a little); hair gets two shifted highlight bands along its strands (Kajiya–Kay);
   * silk a soft edge light. `avKindG` / `avSilkG` are set per pixel by the colour stage (3 skin, 2 hair, 1 cloth).
   */
  const AV_LIGHT_HEAD = 'float avKindG = 0.0;\nfloat avSilkG = 0.0;\nvec3 avHairT = vec3(0.0, 1.0, 0.0);\n';
  function avLightChunk() {
    return THREE.ShaderChunk.lights_physical_pars_fragment.replace('reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );', `{
    float avNL = dot( geometryNormal, directLight.direction );
    vec3 avIrr = irradiance;
    if ( avKindG > 2.5 ) { // skin: wrapped diffuse + a warm band at the terminator
      float avW = saturate( ( avNL + 0.42 ) / 1.42 );
      float avT = smoothstep( -0.42, 0.05, avNL ) * ( 1.0 - smoothstep( 0.05, 0.6, avNL ) );
      avIrr = directLight.color * ( vec3( mix( dotNL, avW * avW, 0.55 ) ) + vec3( 0.32, 0.1, 0.05 ) * avT );
      // thin parts (ears, the nose's wings, fingers) glow warm when the light is behind them
      avIrr += directLight.color * vec3( 0.42, 0.12, 0.06 ) * pow( saturate( dot( -directLight.direction, geometryViewDir ) ), 6.0 ) * ( 1.0 - smoothstep( -0.6, 0.15, avNL ) ) * 0.5;
    } else if ( avKindG > 1.5 ) { // hair: soft diffuse, two highlight bands along the strand
      avIrr = directLight.color * saturate( ( avNL + 0.25 ) / 1.25 ) * 0.92;
      vec3 avH = normalize( directLight.direction + geometryViewDir );
      vec3 avT1 = normalize( avHairT + geometryNormal * 0.12 ), avT2 = normalize( avHairT - geometryNormal * 0.1 );
      float avTH1 = dot( avT1, avH ), avTH2 = dot( avT2, avH );
      float avS1 = pow( sqrt( max( 0.0, 1.0 - avTH1 * avTH1 ) ), 70.0 ), avS2 = pow( sqrt( max( 0.0, 1.0 - avTH2 * avTH2 ) ), 22.0 );
      reflectedLight.directSpecular += directLight.color * saturate( avNL * 1.4 + 0.2 ) * ( vec3( 0.13 ) * avS1 + material.diffuseColor * 0.7 * avS2 );
    } else if ( avSilkG > 0.0 ) { // silk: a soft edge light
      float avR = 1.0 - saturate( dot( geometryNormal, geometryViewDir ) );
      reflectedLight.directSpecular += directLight.color * material.diffuseColor * avSilkG * 0.55 * avR * avR * saturate( avNL + 0.3 );
    }
    reflectedLight.directDiffuse += avIrr * BRDF_Lambert( material.diffuseColor );
  }`);
  }
  /** a bump from a height field h (metres) by screen-space derivatives (no tangents needed; safe when flat) */
  const AV_BUMP = `vec3 avBump( vec3 pos, vec3 n, float h ) {
    vec3 dpx = dFdx( pos ), dpy = dFdy( pos );
    vec3 r1 = cross( dpy, n ), r2 = cross( n, dpx );
    float det = dot( dpx, r1 );
    vec3 g = sign( det ) * ( dFdx( h ) * r1 + dFdy( h ) * r2 );
    vec3 r = abs( det ) * n - g;
    float l2 = dot( r, r );
    return l2 > 1e-24 ? r * inversesqrt( l2 ) : n;
  }\n`;
  function makeBodyMaterial() {
    // double-sided: open garment edges (sleeve ends, hems, a shoe's inside) never show the world through them
    const m = new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0, envMapIntensity: 0.6, side: THREE.DoubleSide });
    const pal = new Float32Array(NSLOT * 3), rough = new Float32Array(NSLOT), fx = new Float32Array(NSLOT);
    m.userData.pal = pal; m.userData.rough = rough; m.userData.fx = fx; m.userData.skirt = { value: 0 }; m.userData.stride = { value: 0 };
    m.name = 'avatarBody';
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uPal = { value: pal };
      sh.uniforms.uRough = { value: rough };
      sh.uniforms.uFx = { value: fx };
      sh.uniforms.uPatTex = { value: patternAtlas() };
      sh.uniforms.uWeave = { value: weaveTexture() };
      sh.uniforms.uAvFlat = AV_FLAT;
      sh.uniforms.uAvQ = AV_Q;
      sh.uniforms.uAvSkirt = m.userData.skirt;
      sh.uniforms.uAvStride = m.userData.stride;
      sh.vertexShader = `attribute float aSlot;\nuniform vec3 uPal[${NSLOT}];\nuniform float uRough[${NSLOT}];\nuniform float uFx[${NSLOT}];\nvarying vec3 vPalColor;\nvarying float vPalRough;\nvarying float vFx;\nvarying vec3 vRest;\nvarying float vSlotF;\n` +
        sh.vertexShader.replace('#include <color_vertex>', '#include <color_vertex>\n  { int si = int(aSlot + 0.5); vPalColor = uPal[si]; vPalRough = uRough[si]; vFx = uFx[si]; vRest = position; vSlotF = aSlot; }');
      sh.fragmentShader = 'varying vec3 vPalColor;\nvarying float vPalRough;\nvarying float vFx;\nvarying vec3 vRest;\nvarying float vSlotF;\nuniform sampler2D uPatTex;\nuniform sampler2D uWeave;\nuniform float uAvFlat;\nuniform float uAvQ;\nuniform float uAvSkirt;\nuniform float uAvStride;\n' + AV_LIGHT_HEAD + AV_BUMP + sh.fragmentShader
        .replace('#include <lights_physical_pars_fragment>', avLightChunk())
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
  if (uAvQ > 0.5 && avKindG > 0.5) { // [people] §19.9 folds, creases, weave and strands as a height field on the rest pose
    float ang = atan(vRest.x, vRest.z), y = vRest.y, h = 0.0;
    vec2 cu = vec2(ang * 0.16, y);
    if (avKindG > 1.5 && avKindG < 2.5) { // hair: strands (fine on high), a few locks
      float f = 1.0 - smoothstep(0.15, 0.45, fwidth(ang * 260.0));
      h = 0.0005 * sin(ang * 13.0 + sin(y * 30.0) * 1.2) + 0.00006 * f * (uAvQ > 1.5 ? 1.0 : 0.5) * sin(ang * 260.0 + sin(y * 55.0 + ang * 9.0) * 2.4); // [people] locks + fine strands (the strands were a moiré)
    } else if (avKindG < 1.5) {
      float sl = vSlotF;
      bool lower = (sl > 5.5 && sl < 7.5) || (sl > 19.5 && sl < 21.5);
      if (lower && y < 1.0) { // hanging cloth: vertical folds that deepen to the hem (around the body on a skirt or robe, round each leg on trousers)
        float a2 = uAvSkirt > 0.5 || sl > 19.5 ? ang : atan(vRest.x - sign(vRest.x) * 0.091, vRest.z);
        float n2 = uAvSkirt > 0.5 || sl > 19.5 ? 15.0 : 7.0;
        float op = 1.0 - 0.6 * uAvStride * abs(cos(ang)) * smoothstep(0.95, 0.4, y); // the folds open in front and behind as the legs part in a walk
        h += 0.0042 * op * smoothstep(1.0, 0.45, y) * sin(a2 * n2 * (1.0 - 0.12 * uAvStride) + 1.6 * sin(a2 * 3.0 + y * 5.0));
        if (uAvSkirt < 0.5 && sl < 7.5) h += 0.0016 * exp(-((y - 0.49) * (y - 0.49)) / 0.0025) * sin(y * 150.0 + ang * 3.0); // creases over the knee
      }
      if ((sl > 1.5 && sl < 4.5) || (sl > 21.5 && sl < 22.5) || (sl > 19.5 && sl < 21.5 && y > 1.0)) { // sleeves: creases at the elbow and the 배래 curve
        float ax = abs(vRest.x);
        h += 0.0018 * smoothstep(0.15, 0.2, ax) * exp(-((y - 1.09) * (y - 1.09)) / 0.0036) * sin((y + ax * 0.7) * 170.0);
      }
      float fw = 1.0 - smoothstep(0.3, 0.9, fwidth(cu.x * 1900.0)); // the weave: only where a thread is wider than a pixel
      if (fw > 0.0) h += fw * 0.00005 * (sin(cu.x * 2800.0) * sin(cu.y * 2800.0) + 0.6 * sin(cu.y * 2800.0 + 1.6));
    } else { // skin: pores on high only, a faint unevenness on medium
      float fp = 1.0 - smoothstep(0.3, 0.9, fwidth(vRest.y * 2100.0));
      h = fp * 0.00004 * (uAvQ > 1.5 ? 1.0 : 0.4) * sin(vRest.x * 2300.0 + sin(vRest.y * 1700.0) * 2.0) * sin(vRest.y * 2100.0 + vRest.z * 900.0);
    }
    if (h != 0.0) normal = avBump(-vViewPosition, normal, h);
    if (avKindG > 1.5 && avKindG < 2.5) { // the strand direction in view space: down the head, along the surface
      vec3 up = (viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz;
      vec3 t = up - normal * dot(normal, up);
      float tl = dot(t, t);
      avHairT = tl > 1e-6 ? t * inversesqrt(tl) : normalize(cross(normal, vec3(1.0, 0.0, 0.0)) + vec3(0.0, 1e-3, 0.0));
    }
  }`)
        .replace('#include <color_fragment>', `#include <color_fragment>
  diffuseColor.rgb *= vPalColor;
  float avGold = 0.0, avSilk = 0.0;
  {
    float kind = mod(vFx, 8.0), pat = floor(vFx / 8.0 + 0.01);
    if (uAvFlat > 0.5) { kind = 0.0; pat = pat < 1.5 || (pat > 3.5 && pat < 4.5) ? pat : 0.0; } // low: flat colours (gold and 색동 stay, they are colours)
    avKindG = uAvQ > 0.5 ? kind : 0.0;
    if (uAvQ > 0.5 && kind > 0.5 && kind < 1.5 && vPalRough < 0.66) avSilkG = 0.6; // smooth cloth is silk
    float ang = atan(vRest.x, vRest.z);
    vec2 cylUv = vec2(ang * 0.16, vRest.y);
    if (kind > 0.5 && kind < 1.5) { float w = texture(uWeave, cylUv * 26.0 + vec2(vRest.x * 9.0, 0.0)).r; diffuseColor.rgb *= 0.84 + 0.3 * w; }
    else if (kind > 1.5 && kind < 2.5) { float sa = ang * 150.0 + vRest.y * 22.0 + sin(ang * 23.0) * 2.0; float sf = 1.0 - smoothstep(0.4, 1.2, fwidth(sa)); float st = sin(sa) * 0.5 + 0.5; float lk = sin(ang * 31.0 + sin(vRest.y * 40.0)) * 0.5 + 0.5; diffuseColor.rgb *= 0.86 + 0.1 * lk + sf * 0.12 * (st - 0.5); } // [people] strands that fade where finer than a pixel, a few locks
    if (pat > 0.5) {
      vec2 puv = cylUv / 0.085;
      vec2 off = pat < 1.5 ? vec2(0.0, 0.5) : pat < 2.5 ? vec2(0.5, 0.5) : vec2(0.0, 0.0);
      if (pat < 3.5) {
        float msk = textureGrad(uPatTex, off + fract(puv) * 0.5, dFdx(puv) * 0.5, dFdy(puv) * 0.5).a;
        if (pat < 1.5) { avGold = msk; diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.86, 0.64, 0.26), msk); }
        else diffuseColor.rgb *= 1.0 + 0.2 * (msk - 0.25);
      } else if (pat < 4.5) {
        float band = mod(floor(vRest.y / 0.028), 7.0);
        vec3 c = band < 0.5 ? vec3(0.84, 0.24, 0.24) : band < 1.5 ? vec3(0.95, 0.76, 0.19) : band < 2.5 ? vec3(0.24, 0.6, 0.29) : band < 3.5 ? vec3(0.94, 0.48, 0.63) : band < 4.5 ? vec3(0.23, 0.38, 0.72) : band < 5.5 ? vec3(0.95, 0.94, 0.9) : vec3(0.48, 0.29, 0.63);
        diffuseColor.rgb = c * (diffuseColor.rgb / max(vPalColor, vec3(0.05)));
      } else if (pat < 5.5) {
        float s1 = sin(cylUv.x * 420.0 + cylUv.y * 60.0), s2 = sin(cylUv.y * 380.0 - cylUv.x * 50.0);
        diffuseColor.rgb *= 0.78 + 0.3 * (0.5 + 0.5 * max(s1, s2));
      } else if (pat < 6.5) {
        float tg = smoothstep(0.55, 0.75, sin(ang * 14.0 + sin(vRest.y * 160.0) * 1.4 + vRest.y * 40.0));
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.06, 0.05, 0.04), tg * 0.85);
      } else if (pat < 7.5) { // 격자: a tone-on-tone woven grid
        vec2 gq = abs(fract(cylUv * 18.0) - 0.5);
        diffuseColor.rgb *= 1.0 - 0.16 * smoothstep(0.42, 0.48, max(gq.x, gq.y));
      } else if (pat < 8.5) { // 줄: soft vertical stripes
        diffuseColor.rgb *= 0.9 + 0.16 * smoothstep(0.3, 0.7, abs(fract(ang * 7.64) - 0.5) * 2.0);
      } else if (pat < 9.5) { // 누비: stitched rows every 2.5 cm, the padding swelling between them
        float rq = abs(fract(vRest.y / 0.025) - 0.5) * 2.0;
        diffuseColor.rgb *= 0.76 + 0.26 * smoothstep(0.0, 0.55, rq);
      } else if (pat < 10.5) { // 모시 결: a fine open weave, a little lighter
        float wq = texture(uWeave, cylUv * 64.0).r;
        diffuseColor.rgb = mix(diffuseColor.rgb * (0.9 + 0.18 * wq), vec3(1.0), 0.05);
      } else if (pat < 11.5) { // 명주 윤: silk — smoother, with a faint lengthwise lustre
        avSilk = 1.0;
        diffuseColor.rgb *= 1.0 + 0.05 * sin(vRest.y * 260.0 + ang * 3.0);
      } else if (pat < 12.5) { // 거북등: hexagons, tone on tone
        vec2 hq = cylUv * 14.0; hq.x *= 1.1547; hq.y += mod(floor(hq.x), 2.0) * 0.5;
        vec2 fq = abs(fract(hq) - 0.5);
        diffuseColor.rgb *= 1.0 - 0.14 * smoothstep(0.4, 0.47, max(fq.x * 1.5 + fq.y * 0.5, fq.y));
      } else { // 물결: rolling waves
        float wv = sin(cylUv.x * 44.0 + sin(vRest.y * 90.0) * 1.6 + vRest.y * 62.0);
        diffuseColor.rgb *= 0.96 + 0.13 * smoothstep(0.55, 0.92, wv);
      }
    }
  }`)
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n  roughnessFactor = mix(mix(roughnessFactor * vPalRough, 0.28, avGold), 0.36, avSilk);\n  if (avSilk > 0.5) avSilkG = 1.0;')
        .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\n  metalnessFactor = mix(metalnessFactor, 0.8, avGold);')
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n  { float rimF = 1.0 - saturate(dot(normal, normalize(vViewPosition))); totalEmissiveRadiance += diffuseColor.rgb * rimF * rimF * rimF * 0.16; }');
    };
    m.customProgramCacheKey = () => 'tfmAvatarPalette4';
    return m;
  }
  function applyPalette(mat, app) {
    const va = app.style === 'real' ? app : view(app), cols = slotColors(va), fxs = slotFx(va);
    const pal = mat.userData.pal, rough = mat.userData.rough, fx = mat.userData.fx;
    const real = app.style === 'real';
    for (let i = 0; i < NSLOT; i++) {
      _c1.set(cols[i]);
      pal[i * 3] = _c1.r; pal[i * 3 + 1] = _c1.g; pal[i * 3 + 2] = _c1.b;
      rough[i] = ROUGH[i];
      fx[i] = (real || KIND[i] !== 1 ? KIND[i] : 0) + 8 * fxs[i];
    }
    if (real) { rough[SLOT.skin] = 0.52; rough[SLOT.hair] = 0.42; }
    if (mat.userData.skirt) mat.userData.skirt.value = DRAW_BOTTOM[app.bottom] === 'skirt' ? 1 : 0; // [people] folds round the body or round each leg
    if (app.accessory === 'glasses') rough[SLOT.acc] = 0.32;
    if (app.hat === 'gat') rough[SLOT.hat] = 0.4;
    if (app.footwear === 'gomusin') rough[SLOT.shoe] = 0.35;
    if (app.footwear === 'kkotsin' || app.top === 'dangui') { rough[SLOT.shoe] = 0.45; rough[SLOT.top] = Math.min(rough[SLOT.top], 0.6); } // silk
  }

  // ---------------------------------------------------------------- animation channels
  const CH = ['rootY', 'squash', 'rootRY', 'hipsX', 'hipsY', 'hipsZ', 'spineX', 'spineY', 'spineZ', 'neckX', 'neckY', 'neckZ', 'headX', 'headY', 'headZ',
    'shLX', 'shLY', 'shLZ', 'elLX', 'elLY', 'elLZ', 'hdLX', 'hdLY', 'hdLZ',
    'shRX', 'shRY', 'shRZ', 'elRX', 'elRY', 'elRZ', 'hdRX', 'hdRY', 'hdRZ',
    'thLX', 'thLY', 'thLZ', 'knLX', 'ftLX', 'ftLZ', 'thRX', 'thRY', 'thRZ', 'knRX', 'ftRX', 'ftRZ',
    'ponyX', 'ponyZ', 'bagX', 'skirtX', 'skirtZ', 'fgP', 'fgV', 'fgT', 'seatW', 'seatY', 'rootRX', 'rootZ'];
  const C = {};
  CH.forEach((n, i) => { C[n] = i; });
  const NCH = CH.length;

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
  /** metres per full gait cycle (two steps) at ground speed v (K: the style's kinematics) */
  function strideLength(v, runW, fastW, K) {
    const slow = lerp(K.slow[0], K.slow[1], runW);
    const fast = K.fast[0] + K.fast[1] * clamp(v, 0, 30);
    return lerp(slow, fast, fastW);
  }
  /** planar two-bone IK in the sagittal plane: ankle target (z fwd, y up) relative to the hip joint -> out[0]=thigh, out[1]=knee */
  function legIK(z, y, out, K) {
    const L1 = K.L1, L2 = K.L2;
    let d = Math.hypot(z, y);
    if (!(d > 1e-4)) { z = 0; y = -K.max; d = K.max; }
    if (d > K.max) { const k = K.max / d; z *= k; y *= k; d = K.max; }
    else if (d < K.min) { const k = K.min / d; z *= k; y *= k; d = K.min; }
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
  function footPath(f, duty, S2, H, sprintW, out, fp = 1) {
    if (f < duty) { // stance: planted, sweeping back linearly (= ground speed)
      const u = f / duty;
      out.z = S2 - 2 * S2 * u; out.y = 0; out.stance = 1 - Math.abs(u * 2 - 1);
      return out;
    }
    const u = (f - duty) / (1 - duty);
    // keyframes: lift-off, heel kick behind, tucked under the hip, reach forward, touchdown (+ phantom ends)
    SW_Z[0] = -S2 + 0.12 * fp; SW_Y[0] = -0.05 * H;
    SW_Z[1] = -S2; SW_Y[1] = 0;
    SW_Z[2] = -S2 - (0.07 + 0.05 * sprintW) * fp; SW_Y[2] = 0.58 * H;
    SW_Z[3] = 0.03 * fp; SW_Y[3] = H;
    SW_Z[4] = S2 + (0.06 + 0.04 * sprintW) * fp; SW_Y[4] = 0.42 * H;
    SW_Z[5] = S2; SW_Y[5] = 0;
    SW_Z[6] = S2 - 0.12 * fp; SW_Y[6] = -0.05 * H;
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
  const sharedBounds = new THREE.Sphere(new THREE.Vector3(0, 0.9, 0), 1.15);
  const sharedBox = new THREE.Box3(new THREE.Vector3(-0.48, -0.05, -0.45), new THREE.Vector3(0.48, 1.86, 0.5));
  const HEAD_TOP = { strawhat: 1.5, cap: 1.47, gat: 1.62, jokduri: 1.45, ayam: 1.44, jobawi: 1.44, hogeon: 1.47, bokgeon: 1.48 };
  const HEAD_TOP_REAL = { none: 1.69, gat: 1.78, strawhat: 1.735, jokduri: 1.73, ayam: 1.7, jobawi: 1.7, hogeon: 1.71, bokgeon: 1.72, cap: 1.7, headband: 1.69,
    chorip: 1.74, paeraengi: 1.72, jeollip: 1.72, satgat: 1.79, jeonmo: 1.73, samo: 1.73, yugeon: 1.74, tanggeon: 1.7, jeongja: 1.8, gulle: 1.71,
    nambawi: 1.7, pungcha: 1.7, hwagwan: 1.76, gokkal: 1.86, sangmo: 1.7, sugeon: 1.69 };

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
      this.style = 'cute'; this.K = KIN.cute;
      // secondary motion (springs on the hair, skirt, coat fronts and bag): angle, velocity per channel
      this._spr = new Float32Array(10); this._prevWP = null; this._prevYaw = null; this._vel = 0; this._yawRate = 0;
      this.bone = {};
      BONES.forEach(([name], i) => { this.bone[name] = this.bones[i]; });
      this.material = makeBodyMaterial();
      this.mesh = null;
      this.face = new THREE.Mesh(faceGeometry('cute'), faceMaterial('smile', 'base', 'cute'));
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
      this._flip = null; // {t, dur}: the double-jump tuck-flip in progress
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
      if (kinKey(app) !== this._kin) this._setStyle(app.style, kinKey(app));
      applyPalette(this.material, app);
      const geo = bodyGeometry(app);
      const gk = shapeSig(app);
      if (gk !== this._geoKey) { geoRef(gk, 1); geoRef(this._geoKey, -1); this._geoKey = gk; }
      if (this._midKey) { geoRef(this._midKey, -1); this._midKey = null; } this._lod = 0; this._lodT = 0; // [people] re-chosen on the next tick
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
      // [settings] §18.2 캐릭터 크기: the drawn size of the player's own rig (setDrawScale) stays across look changes
      const ds = this.drawScale || 1;
      this.scaler.scale.setScalar(app.height * ds);
      this.height = this.K.height * app.height * ds;
      const top = app.style === 'real' ? (HEAD_TOP_REAL[app.hat] || 1.69) + (app.hair === 'bun' && app.hat === 'none' ? 0.02 : app.hair === 'sangtu' && app.hat === 'none' ? 0.04 : 0)
        : HEAD_TOP[app.hat] || (app.hair === 'bun' ? 1.47 : 1.43);
      const hk = this.K.headK ? this.K.headK[1] : 1; // [people] the head of a build is smaller / larger than the adult's
      this.headAnchor.position.set(0, app.style === 'real' ? (top - BONES_REAL[B.head][3]) * hk + 0.08 : top + 0.08 - this.K.bones[B.head][3], 0);
      this._faceFace = '';
      return app;
    }

    /** [settings] §18.2 캐릭터 크기: draw this rig k times its size (0.8 – 1.3; feet stay on the ground, rig.height follows
     *  so the camera frames the head; collisions are the player's and do not change) */
    setDrawScale(k) {
      const s = Math.min(1.3, Math.max(0.8, Number(k) || 1));
      this.drawScale = s;
      const hm = this.heightMul || 1;
      this.scaler.scale.setScalar(hm * s);
      this.height = this.K.height * hm * s;
      return s;
    }

    /** switch the skeleton (bone rest positions + inverse binds), the kinematics and the face decal to another style */
    _setStyle(style, kin) {
      const K = KIN[kin || style] || KIN[style] || KIN.cute;
      this.style = style; this.K = K; this._kin = kin || style;
      K.bones.forEach(([, parent, x, y, z], i) => {
        const p = parent >= 0 ? K.bones[parent] : null;
        this.bones[i].position.set(x - (p ? p[2] : 0), y - (p ? p[3] : 0), z - (p ? p[4] : 0));
        this.skeleton.boneInverses[i].copy(K.inv[i]);
      });
      this.face.geometry = faceGeometry(style);
      if (K.headK) this.face.scale.set(K.headK[0], K.headK[1], K.headK[2]); else this.face.scale.set(1, 1, 1); // [people] the build's head
      this._faceFace = '';
      this.phase = this.phase % 1;
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
    /** stop everything (action + sitting + a flip) */
    stopAll() {
      if (this._act && !this._act.stopping) this._act.stopping = true;
      if (this._sitL && !this._sitL.stopping) this._sitL.stopping = true;
      this._flip = null;
      this._syncCurrent();
    }
    /** double jump: one forward somersault over `dur` seconds (eased, no overshoot), arms and knees tucked at the middle */
    flip(dur = 0.5) {
      const d = Number(dur);
      this._flip = { t: 0, dur: d > 0.15 && d < 3 ? d : 0.5 };
    }
    get flipping() { return !!this._flip; }
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
    /** [people] §19.9 near body within 11 m of the game camera, the middle level beyond 13 m (only for rigs in the world scene) */
    _lodTick(dt) {
      this._lodT = (this._lodT || 0) - dt;
      if (this._lodT > 0 || !this.mesh || this.style !== 'real') return;
      this._lodT = 0.3 + Math.random() * 0.2;
      const E = G.sys && G.sys.engine, cam = E && E.camera;
      if (!cam || !E.scene) return;
      let r = this.group; while (r.parent) r = r.parent;
      let want = 0;
      if (r === E.scene) { this.group.getWorldPosition(_lodV); const d = _lodV.distanceTo(cam.position); want = d > 13 ? 1 : d < 11 ? 0 : (this._lod || 0); }
      if (want === (this._lod || 0)) return;
      const geo = want ? midGeometry(this.appearance) : bodyGeometry(this.appearance);
      if (!geo) { this._lodT = 0.05; return; }
      if (want) { const mk = shapeSig(this.appearance) + '|m'; geoRef(mk, 1); this._midKey = mk; } else { geoRef(this._midKey, -1); this._midKey = null; }
      this.mesh.geometry = geo; this._lod = want;
    }

    update(dt, p) {
      this._lodTick(dt);
      const su = this.material && this.material.userData.stride; // [people] how far the legs are apart (skirt folds open)
      if (su) su.value = clamp((this._moveW || 0) * Math.abs(Math.sin(this.phase * TAU)), 0, 1) || 0;
      syncFlat();
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
        const cyc = strideLength(this._gaitV, this._runW, this._fastW, this.K);
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
        const hy = this.K.HC * this.heightMul;
        const yaw = Math.atan2(_v.x, _v.z);
        if (Math.abs(yaw) < 2.0) { ly = clamp(yaw, -1.05, 1.05); lx = clamp(-Math.atan2(_v.y - hy, Math.hypot(_v.x, _v.z)), -0.45, 0.4); lw = 1; }
      } else if (this._moveW < 0.2 && !a && !this._sitL) {
        this._idleLookT -= dt;
        if (this._idleLookT <= 0) { this._idleLookTarget = Math.random() < 0.45 ? 0 : (Math.random() - 0.5) * 1.1; this._idleLookT = 2.5 + Math.random() * 4; }
        ly = this._idleLookTarget; lw = 1;
      }
      const ld = damp(lw ? 5 : 4, dt);
      this._lookAim = this._look && lw ? clamp(Math.atan2(_v.x, _v.z), -1.6, 1.6) : ly; // [people] where the eyes go (the head follows ly)
      this._lookY += (ly - this._lookY) * ld; this._lookX += (lx - this._lookX) * ld;
      F[C.neckY] += this._lookY * 0.35; F[C.headY] += this._lookY * 0.65;
      F[C.neckX] += this._lookX * 0.35; F[C.headX] += this._lookX * 0.65;

      // double-jump tuck-flip: the root turns a full forward circle about the body centre (0.72 m up), eased in and out
      // (smoothstep: no overshoot), while knees and arms tuck in at the middle of the turn
      const fl = this._flip;
      if (fl) {
        fl.t += dt;
        const k = clamp(fl.t / fl.dur, 0, 1), e = k * k * (3 - 2 * k);
        const th = e * TAU, c = 0.72;
        F[C.rootRX] += th;
        F[C.rootY] += c * (1 - Math.cos(th));
        F[C.rootZ] += -c * Math.sin(th);
        const w = Math.sin(Math.PI * k) * 0.9;
        mix(F, C.thLX, -1.35, w); mix(F, C.thRX, -1.35, w); mix(F, C.knLX, 2.0, w); mix(F, C.knRX, 2.0, w);
        mix(F, C.ftLX, 0.3, w); mix(F, C.ftRX, 0.3, w);
        mix(F, C.shLX, -1.15, w); mix(F, C.shRX, -1.15, w); mix(F, C.shLZ, 0.22, w); mix(F, C.shRZ, -0.22, w);
        mix(F, C.elLX, -1.75, w); mix(F, C.elRX, -1.75, w);
        mix(F, C.spineX, 0.45, w); mix(F, C.neckX, 0.15, w); mix(F, C.headX, 0.35, w);
        if (k >= 1) this._flip = null;
      }

      this._secondary(dt, F);
      this._apply(F);
      this._updateFace(dt);
    }

    _loco(o, t, vy) {
      o.fill(0);
      const sd = this._seed * 10;
      const br = Math.sin(t * 2.1 + sd);
      // idle
      // [people] §19.9 a relaxed stance: arms a little away from the body, elbows softly bent, hands turned in; slow
      // breathing; the weight shifts from one leg to the other now and then; an elder stands a little stooped
      const eld = this.K.build === 'elder' ? 1 : 0, sh = Math.sin(t * 0.37 + sd) * 0.6 + Math.sin(t * 0.13 + sd * 2) * 0.4;
      o[C.spineX] = 0.025 + 0.018 * br + 0.1 * eld; o[C.headX] = -0.02 - 0.012 * br - 0.06 * eld; o[C.neckX] = 0.05 * eld;
      o[C.shLZ] = 0.2 + 0.015 * br; o[C.shRZ] = -0.2 - 0.015 * br; o[C.shLX] = 0.05 + 0.04 * eld; o[C.shRX] = 0.05 + 0.04 * eld;
      o[C.elLX] = -0.3 - 0.1 * eld; o[C.elRX] = -0.3 - 0.1 * eld; o[C.elLZ] = -0.06; o[C.elRZ] = 0.06; o[C.hdLZ] = -0.12; o[C.hdRZ] = 0.12; o[C.hdLX] = -0.08; o[C.hdRX] = -0.08;
      o[C.hipsZ] = 0.035 * sh; o[C.spineZ] = -o[C.hipsZ] * 0.75; o[C.headZ] = -o[C.hipsZ] * 0.2;
      o[C.thLZ] = 0.035 - 0.03 * sh; o[C.thRZ] = -0.035 - 0.03 * sh; o[C.knLX] = 0.03 + 0.06 * Math.max(0, sh) + 0.04 * eld; o[C.knRX] = 0.03 + 0.06 * Math.max(0, -sh) + 0.04 * eld; o[C.ftLZ] = -0.03 + 0.03 * sh; o[C.ftRZ] = 0.03 + 0.03 * sh;
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
      const K = this.K;
      const duty = clamp(K.sweep / cyc, 0.05, 0.42);     // stance share of a leg's cycle
      const S2 = K.sweep * 0.5;
      const H = lerp(K.lift[0], K.lift[1], sw);           // swing foot lift
      const crouch = lerp(K.crouch[0], K.crouch[1], sw);
      const phL = this.phase, phR = (this.phase + 0.5) % 1;
      const fl = footPath(phL, duty, S2, H, sw, _fpL, K.fp), fr = footPath(phR, duty, S2, H, sw, _fpR, K.fp);
      // body: lowest at mid-stance, a short ballistic hop between steps (exaggerated a little for readability)
      const psi = (this.phase * 2) % 1, d2 = Math.min(0.9, duty * 2);
      const bobAmp = lerp(K.bob[0], K.bob[1], sw);
      const bob = psi < d2 ? -0.018 * Math.sin(Math.PI * psi / d2) : bobAmp * Math.sin(Math.PI * (psi - d2) / (1 - d2));
      const hipY = (K.L1 + K.L2 + K.LF) - crouch + bob;
      legIK(fl.z, -(hipY - K.LF - fl.y), _ikA, K);
      legIK(fr.z, -(hipY - K.LF - fr.y), _ikB, K);
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

    /**
     * secondary motion: cheap damped springs on the hanging hair, the skirt, the coat fronts / 고름 and the bag, driven by
     * how the avatar moves in the world (forward acceleration, turning, landing) — read from the group's world matrix,
     * so it works the same for the player, NPCs, visitors and the customiser's turntable.
     */
    _secondary(dt, F) {
      const sp = this._spr;
      const e = this.group.matrixWorld.elements;
      const x = e[12], z = e[14], yaw = Math.atan2(e[8], e[10]);
      let acc = 0, yr = 0;
      if (this._prevWP && dt < 0.25) {
        const fl = Math.hypot(e[8], e[10]) || 1;
        const fwd = ((x - this._prevWP[0]) * e[8] + (z - this._prevWP[1]) * e[10]) / fl / dt;
        if (Number.isFinite(fwd) && Math.abs(fwd) < 80) { acc = clamp((fwd - this._vel) / dt, -40, 40); this._vel += (fwd - this._vel) * damp(18, dt); }
        let dy = yaw - this._prevYaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
        if (Number.isFinite(dy)) yr = clamp(dy / dt, -10, 10);
      } else this._prevWP = [x, z];
      this._prevWP[0] = x; this._prevWP[1] = z; this._prevYaw = yaw;
      this._yawRate += (yr - this._yawRate) * damp(10, dt);
      const land = this._landT < 0.12 ? this._landAmt * 6 : 0;
      const spd = clamp(Math.abs(this._vel), 0, 20);
      // [k, c, drive] for hair X/Z, skirt X/Z, cloth X/Z, bag X
      const drv = [-acc * 0.02 + land * 0.5, this._yawRate * spd * 0.012, -acc * 0.006 + land * 0.12, this._yawRate * spd * 0.004, -acc * 0.016 + land * 0.4, this._yawRate * spd * 0.01, -acc * 0.01 + land * 0.3];
      const K = [28, 28, 70, 70, 40, 40, 55], D = [4.5, 4.5, 11, 11, 6, 6, 8];
      const n = Math.min(4, Math.max(1, Math.ceil(dt / 0.017))), h = dt / n;
      for (let st = 0; st < n; st++) for (let c = 0; c < 7; c++) {
        let a = sp[c];
        const vi = this._sprV || (this._sprV = new Float32Array(7));
        vi[c] += (-K[c] * a - D[c] * vi[c] + drv[c] * K[c]) * h;
        vi[c] = clamp(vi[c], -20, 20);
        a += vi[c] * h;
        sp[c] = Number.isFinite(a) ? clamp(a, -1.1, 1.1) : 0;
        if (!Number.isFinite(vi[c])) vi[c] = 0;
      }
    }

    _apply(F) {
      const b = this.bone;
      // auto ground contact: the longer leg reaches the floor
      const { L1, L2, LF } = this.K;
      const hL = L1 * Math.cos(F[C.thLX]) * Math.cos(F[C.thLZ]) + L2 * Math.cos(F[C.thLX] + F[C.knLX]) + LF;
      const hR = L1 * Math.cos(F[C.thRX]) * Math.cos(F[C.thRZ]) + L2 * Math.cos(F[C.thRX] + F[C.knRX]) + LF;
      const drop = (L1 + L2 + LF) - Math.max(hL, hR);
      const groundY = -drop * (1 - this._airW * 0.85);
      const seatRoot = F[C.seatY] + this.K.seat;
      const sw = clamp(F[C.seatW], 0, 1);
      const sq = F[C.squash];
      b.root.position.y = lerp(groundY, seatRoot, sw) + F[C.rootY];
      b.root.position.z = F[C.rootZ];
      b.root.rotation.x = F[C.rootRX];
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
      const sp = this._spr;
      b.pony.rotation.set(F[C.ponyX] + sp[0] * 0.7, 0, F[C.ponyZ] + sp[1] * 0.7);
      b.bag.rotation.set(F[C.bagX] + sp[6], 0, 0);
      // hanging hair: the head's turn half-way, a stream when running, the spring
      b.hairB.rotation.set(clamp(F[C.headX] * 0.3 + F[C.neckX] * 0.3 - 0.32 * this._fastW * this._moveW + sp[0], -1.1, 0.7), (F[C.headY] + F[C.neckY]) * 0.45, clamp(F[C.headZ] * 0.3 + sp[1], -0.8, 0.8));
      b.cloth.rotation.set(clamp(sp[4] - 0.12 * this._moveW * Math.sin(this.phase * TAU * 2) - F[C.spineX] * 0.5, -1, 0.9), 0, clamp(sp[5] - F[C.spineZ] * 0.5, -0.7, 0.7));
      const thAvg = (F[C.thLX] + F[C.thRX]) * 0.5;
      b.skirt.rotation.set((F[C.skirtX] || thAvg * 0.35) + sp[2], 0, F[C.skirtZ] + sp[3]);
      b.fgP.scale.setScalar(Math.max(1e-3, clamp(F[C.fgP], 0, 1)));
      b.fgV.scale.setScalar(Math.max(1e-3, clamp(F[C.fgV], 0, 1)));
      b.fgT.scale.setScalar(Math.max(1e-3, clamp(F[C.fgT], 0, 1)));
    }

    _updateFace(dt) {
      const app = this.appearance;
      const a = this._act;
      const usual = app.expr && app.expr !== 'smile' ? app.expr : 'base';
      let expr = usual;
      if (this._exprOverride) { this._exprT -= dt; if (this._exprT <= 0) this._exprOverride = null; else expr = this._exprOverride; }
      if (expr === usual && a && !a.stopping && a.def.face) expr = typeof a.def.face === 'function' ? a.def.face(a.t) : a.def.face;
      if (expr === 'talk') {
        this._talkT -= dt;
        if (this._talkT <= 0) { this._talkOpen = !this._talkOpen; this._talkT = 0.07 + Math.random() * 0.12; }
        if (!this._talkOpen) expr = usual;
      }
      // blink
      this._blinkT -= dt;
      if (this._blinking > 0) { this._blinking -= dt; if (expr === 'base' || expr === usual || expr === 'talk' || expr === 'think') expr = 'blink'; }
      else if (this._blinkT <= 0) { this._blinking = 0.12; this._blinkT = 2 + Math.random() * 3.5; if (Math.random() < 0.15) this._blinkT = 0.25; }
      // (compared field by field: building a 'face:expr' key string every frame was per-frame garbage for every avatar)
      // [people] §19.9 the eyes lead where the person turns to look (a glance before the head follows); the face's age and the preset's resolution
      let gz = 0;
      if (this.style === 'real') {
        const d = this._lookAim - this._lookY;
        gz = this._gaze || 0;
        if (d > 0.28) gz = 1; else if (d < -0.28) gz = -1; else if (Math.abs(d) < 0.12) gz = Math.abs(this._lookAim) > 1.0 ? Math.sign(this._lookAim) : 0;
        this._gaze = gz;
      }
      const fq = this.style === 'real' ? AV_Q.value : 0, age = this.K.build || 'adult';
      if (app.face !== this._faceFace || expr !== this._faceExpr || gz !== this._faceGaze || fq !== this._faceQ || age !== this._faceAge) {
        this._faceFace = app.face; this._faceExpr = expr; this._faceGaze = gz; this._faceQ = fq; this._faceAge = age;
        this.face.material = faceMaterial(app.face, expr, this.style, age, gz);
      }
    }

    dispose() {
      this.group.parent?.remove(this.group);
      this.setHeld(null);
      this._act = null; this._sitL = null; this._look = null;
      this.material.dispose();
      this.skeleton.dispose();
      geoRef(this._geoKey, -1); this._geoKey = null;
      geoRef(this._midKey, -1); this._midKey = null; this._lod = 0;
      this.mesh = null;
    }
  }

  // ---------------------------------------------------------------- far figures for crowds (one instanced draw call)
  // A simple 1.6 m figure (~230 triangles): head + hair cap, torso, arms, legs, an optional skirt cone, coloured per
  // instance (skin, top, bottom, hair) with a walking swing of legs and arms in the vertex shader. Used by 60-social for
  // visitors / players further than a few dozen metres, so a crowd costs one draw call instead of two per person.
  function farGeometry() {
    const L = [];
    const part = (g, id) => { g = g.index ? g : BGU.mergeVertices(g); for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k); const n = g.attributes.position.count; g.setAttribute('aPart', new THREE.Float32BufferAttribute(new Float32Array(n).fill(id), 1)); L.push(g); };
    part(xf(sphere(1, 10, 8), 0, 1.545, 0.005, 0, 0, 0, 0.08, 0.115, 0.098), 0);
    part(xf(new THREE.SphereGeometry(1, 10, 6, 0, TAU, 0, 1.75), 0, 1.552, -0.004, -0.25, 0, 0, 0.088, 0.125, 0.106), 3);
    part(xf(cyl(0.05, 0.055, 0.1, 8), 0, 1.43, -0.01), 0);
    part(lathe([[0, 0.86], [0.16, 0.9], [0.165, 0.98], [0.14, 1.08], [0.16, 1.24], [0.165, 1.33], [0.12, 1.39], [0, 1.41]], 10, 0.62), 1);
    for (const s of [1, -1]) {
      part(xf(cyl(0.042, 0.03, 0.52, 7), s * 0.2, 1.11, -0.02, 0, 0, s * 0.06), s > 0 ? 7 : 8);
      part(xf(sphere(0.03, 6, 4), s * 0.215, 0.82, -0.01), s > 0 ? 7 : 8);
      part(xf(cyl(0.075, 0.045, 0.78, 7), s * 0.092, 0.49, 0), s > 0 ? 5 : 6);
      part(xf(rbox(0.08, 0.06, 0.22, 0.02, 1), s * 0.094, 0.04, 0.05), s > 0 ? 5 : 6);
    }
    part(xf(cyl(0.17, 0.32, 0.95, 12, true), 0, 0.56, 0), 4);
    const g = BGU.mergeGeometries(L, false);
    L.forEach((x) => x.dispose());
    g.computeBoundingSphere();
    return g;
  }
  let farGeo = null;
  function createFar(max = 64) {
    if (!farGeo) farGeo = farGeometry();
    const geo = farGeo.clone();
    const cols = new Float32Array(max * 12), anim = new Float32Array(max * 3);
    const aC = new THREE.InstancedBufferAttribute(cols, 12); aC.setUsage(THREE.DynamicDrawUsage);
    const aA = new THREE.InstancedBufferAttribute(anim, 3); aA.setUsage(THREE.DynamicDrawUsage);
    // a mat4-sized attribute is not allowed: four vec3 colours as three vec4 slots
    geo.setAttribute('aC0', new THREE.InterleavedBufferAttribute(new THREE.InstancedInterleavedBuffer(cols, 12).setUsage(THREE.DynamicDrawUsage), 4, 0));
    geo.setAttribute('aC1', new THREE.InterleavedBufferAttribute(geo.attributes.aC0.data, 4, 4));
    geo.setAttribute('aC2', new THREE.InterleavedBufferAttribute(geo.attributes.aC0.data, 4, 8));
    geo.setAttribute('aAnim', aA);
    void aC;
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.8, metalness: 0, envMapIntensity: 0.5 });
    mat.onBeforeCompile = (sh) => {
      sh.vertexShader = 'attribute float aPart;\nattribute vec4 aC0;\nattribute vec4 aC1;\nattribute vec4 aC2;\nattribute vec3 aAnim;\nvarying vec3 vFarCol;\n' + sh.vertexShader
        .replace('#include <begin_vertex>', `#include <begin_vertex>
  {
    float pt = aPart;
    vec3 cSkin = aC0.xyz, cTop = vec3(aC0.w, aC1.xy), cBot = vec3(aC1.zw, aC2.x), cHair = aC2.yzw;
    vFarCol = pt < 0.5 ? cSkin : pt < 1.5 ? cTop : pt < 3.5 ? (pt < 2.5 ? cBot : cHair) : pt < 4.5 ? cBot : pt < 6.5 ? cBot : cTop;
    float sw = sin(aAnim.x * 6.2832) * aAnim.y;
    if (pt > 4.5 && pt < 6.5) { float sg = pt < 5.5 ? 1.0 : -1.0; float k = (0.88 - transformed.y); transformed.z += sg * sw * 0.55 * k; transformed.y += abs(sw) * 0.08 * k * 0.0; }
    if (pt > 6.5) { float sg = pt < 7.5 ? -1.0 : 1.0; float k = (1.37 - transformed.y); transformed.z += sg * sw * 0.5 * k; }
    if (pt > 3.5 && pt < 4.5) transformed.xz *= aAnim.z;
    if (pt > 3.5 && pt < 4.5 && aAnim.z < 0.01) transformed.y = 0.9;
  }`);
      sh.fragmentShader = 'varying vec3 vFarCol;\n' + sh.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\n  diffuseColor.rgb *= vFarCol;');
    };
    mat.customProgramCacheKey = () => 'tfmAvatarFar1';
    const mesh = new THREE.InstancedMesh(geo, mat, max);
    mesh.name = 'avatarFar';
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.castShadow = true; mesh.receiveShadow = true;
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), pv = new THREE.Vector3(), sv = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    const colCache = new Map();
    const lin = (hex) => { let c = colCache.get(hex); if (!c) { _c1.set(hex); c = [_c1.r, _c1.g, _c1.b]; colCache.set(hex, c); } return c; };
    let n = 0;
    return {
      mesh, max,
      get count() { return n; },
      begin() { n = 0; },
      /** add one figure: world position, facing, a normalized appearance, walk phase 0..1 and swing 0..1 */
      push(x, y, z, rotY, app, phase = 0, swing = 0) {
        if (n >= max) return false;
        const a = view(app || DEFAULT);
        const hs = (a.style === 'real' ? (KIN[kinKey(a)] || KIN.real).height / 1.62 : 0.9) * (Number(a.height) || 1); // [people] a far child is a child's size
        q.setFromAxisAngle(up, rotY || 0); pv.set(x, y, z); sv.set(hs, hs, hs);
        m4.compose(pv, q, sv); mesh.setMatrixAt(n, m4);
        const sk = lin(skinTone(a.skin || '#f6d0b1')), tp = lin(a.top === 'durumagi' ? a.outerColor || a.topColor : a.topColor || '#888888'), bt = lin(a.bottomColor || '#333333'), hr = lin(a.hat !== 'none' && HAT[a.hat] ? a.hatColor || a.hairColor : a.hairColor || '#222222');
        const o = n * 12;
        cols[o] = sk[0]; cols[o + 1] = sk[1]; cols[o + 2] = sk[2]; cols[o + 3] = tp[0]; cols[o + 4] = tp[1]; cols[o + 5] = tp[2];
        cols[o + 6] = bt[0]; cols[o + 7] = bt[1]; cols[o + 8] = bt[2]; cols[o + 9] = hr[0]; cols[o + 10] = hr[1]; cols[o + 11] = hr[2];
        anim[n * 3] = phase; anim[n * 3 + 1] = clamp(swing, 0, 1); anim[n * 3 + 2] = a.bottom === 'skirt' ? (HANBOK_TOPS.has(a.top) || a.top === 'durumagi' ? 1 : 0.62) : a.top === 'durumagi' ? 0.9 : 0;
        n++;
        return true;
      },
      end() {
        mesh.count = n;
        if (n) { mesh.instanceMatrix.needsUpdate = true; geo.attributes.aC0.data.needsUpdate = true; aA.needsUpdate = true; }
        mesh.visible = n > 0;
      },
      dispose() { mesh.parent?.remove(mesh); geo.dispose(); mat.dispose(); mesh.dispose?.(); },
    };
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
    presets: Object.freeze((DATA.presets || []).map((p) => Object.freeze({ id: p.id, emoji: p.emoji, label: p.label, say: p.say, get appearance() { return normalize(p.app); } }))),
    styles: OPTIONS.style.slice(),
    /** far figures for crowds: create(max) → { mesh, begin(), push(x, y, z, rotY, app, phase, swing), end(), count, dispose() } */
    far: { create: createFar },
    /** the triangle count of the body geometry of an appearance (budgets, tests) */
    triangles(app, o) { const a = normalize(app), g = o && o.mid && a.style === 'real' ? midGeometry(a, true) : bodyGeometry(a); return g.index ? g.index.count / 3 : g.attributes.position.count / 3; },
    /** the geometry cache (tests): size, and clear() which disposes every cached body */
    cache: { get size() { return geoCache.size; }, max: CACHE_MAX, clear() { for (const g of geoCache.values()) g.dispose(); geoCache.clear(); } },
    /** (tests) the body geometry and the palette of a normalized look */
    _geometry: (app) => bodyGeometry(app),
    _palette(app) { const a = normalize(app), va = a.style === 'real' ? a : view(a); return { cols: slotColors(va), fx: slotFx(va) }; },
    /** the table's slots, names and expressions (G.data.avatar), for the wardrobe and the sheet */
    slots: (DATA.slots || []).slice(), expressions: (DATA.expressions || []).slice(),
    create(appearance, opts = {}) { return new Rig(appearance, opts); },
    /** pre-build geometry/face textures for a list of appearances (avoids hitches later) */
    warm(list) { for (const a of list || []) { try { bodyGeometry(normalize(a)); } catch (e) { G.log.warn('AVATAR', 'warm failed', e); } } for (const f of OPTIONS.face) { faceMaterial(f, 'base', 'real'); faceMaterial(f, 'base', 'cute'); } },
    slotColors,
    _ACTIONS: ACTIONS,
    // [people] §19.9 the build of a look ('child' | 'youth' | 'adult' | 'elder') and its kinematics (stature, head centre)
    buildOf: (app) => buildOf(normalize(app)),
    _midGeometry: (app) => midGeometry(normalize(app), true), // [people] tests: the middle level of a look
    kin: (app) => { const K = KIN[kinKey(normalize(app))]; return { build: K.build || 'adult', height: K.height, HC: K.HC, L1: K.L1, L2: K.L2 }; },
  };
})();
