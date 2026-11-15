// =============================================================================
// 76-myroom-data.js — 내 방 (CONTRACT §17.4): what a room is made of. G.data.myroom
//
// PURE DATA + PURE MATH: no THREE, no DOM, no other fragment. tools/build.mjs evaluates this file in Node and exports
// what the server checks (game-data.json → myroom: ids, placing kinds, footprints, palettes, styles, limits);
// tests/myroom-client.mjs lints it and runs the placing rules; 75-myroom.js draws and edits with it.
//
// THE ROOM (local metres, origin = the middle of the floor, +Y up, north = −Z): 14 × 11, posts 2.7, a paper ceiling at
//   3.05, five bays along X and four along Z, the door in the middle bay of the south wall. Nothing may stand in the
//   keep-clear zone before the door (x ±1.6, z 3.1 … 5.5): the way out is never blocked.
// A SAVED ROOM (≤ 24 KB of JSON, numbers and catalogue ids only — nothing anybody typed):
//   { v, style: { floor, wall, wood, mood, win }, items: [{ i, x, y, z, r, s?, c? }], public }
//   i  catalogue id          x, z  metres (multiples of 0.125; the edit grid is 0.25)
//   r  0 … 23 = quarter-hours of a turn (15° steps); rotY = r · π / 12; a wall thing has the r of its wall
//   y  F / R / H things: 0 · T things: 0 or the top they stand on · W things: the height of their middle
//   s  size 0 small (× 0.8) | 1 (left out) | 2 large (× 1.2), only where the entry allows it
//   c  index into the entry's palette (left out = the thing's own colours)
//   style.win  18 digits, one per bay in the order N0…N4 E0…E3 S0…S4 W0…W3 (left → right seen from inside):
//              0 = wall, 1…6 = a window with that lattice (ttisal, jeongja, bitsal, yongja, aja, wanja)
// PLACING KINDS (entry.place): F stands on the floor · T a small thing: on the floor or on a top that an F thing offers
//   (entry.top = [w, d, y]) · R a rug: flat, anything may stand on it · W hangs on a wall (never over a window, the
//   door or a post) · H hangs from the ceiling.
// ENTRY: { id, cat, emoji, name, kid, place, fp: [w, d, h] (metres at size 1; W: w along the wall, d off the wall, h
//   up and down round its middle; H: h = how far it hangs down), gen (a generator name of 75-myroom.js / G.hanok), opt,
//   top?, col?: [palette, option key], sz?: true, lamp?: [x, y, z] (where its light is), yw?: [min, default, max] (W) }
// API (all pure): items · cats · palettes · styles · ROOM · LIMITS · empty() · sanitize(room, limit) · check(room, it,
//   skip) → { ok, why } · rest(room, entry, x, z, skip) → { y, on } · dims(it) · box(it) · wallAt(x, z) · wallSpot(side,
//   u) · openings(style) · bayOf(side, u) · preset(id) · presets · bytes(room) · serverTable()
// =============================================================================
(function () {
  const PI = Math.PI;
  const fin = Number.isFinite;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const isMap = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
  const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

  const ROOM = Object.freeze({
    w: 14, d: 11, h: 3.4, post: 2.7, ceil: 3.05, baysX: 5, baysZ: 4, postR: 0.13,
    grid: 0.25, fine: 0.125, rotStep: 15, pad: 0.12,
    wallN: 0.062,                    // wall things hang this far in front of the wall line (clear of the middle rail)
    wallV: Object.freeze([0.2, 2.5]),// a wall thing stays between these heights
    door: Object.freeze({ side: 'S', bay: 2, x: 0, z: 5.5, w: 1.5, h: 2.0 }),
    keep: Object.freeze({ x0: -1.6, x1: 1.6, z0: 3.1, z1: 5.5 }),
    spawn: Object.freeze({ x: 0, z: 4.0, rotY: PI }),
    origin: Object.freeze({ x: 800, z: 2000 }),
  });
  const LIMITS = Object.freeze({ free: 80, paid: 160, hard: 200, bytes: 24576 });
  const SIDES = ['N', 'E', 'S', 'W'];
  const SIDE_R = { N: 0, W: 6, S: 12, E: 18 };
  const R_SIDE = { 0: 'N', 6: 'W', 12: 'S', 18: 'E' };
  const SIDE_LEN = { N: ROOM.w, S: ROOM.w, E: ROOM.d, W: ROOM.d };
  const SIDE_BAYS = { N: ROOM.baysX, S: ROOM.baysX, E: ROOM.baysZ, W: ROOM.baysZ };
  const SIZE_K = [0.8, 1, 1.2];
  const PATTERNS = ['ttisal', 'jeongja', 'bitsal', 'yongja', 'aja', 'wanja'];
  const PATTERN_NAMES = ['벽', '띠살', '정자살', '빗살', '용자살', '아자살', '완자살'];
  const WIN_LEN = 18, WIN_DOOR = 5 + 4 + 2;   // the door's bay in style.win
  const RX_ID = /^[A-Z][A-Z0-9_]{1,23}$/;

  // ---------------------------------------------------------------- palettes
  const palettes = {
    cloth: [['다홍', '#c2342e'], ['분홍', '#e58aa8'], ['주황', '#e8762a'], ['노랑', '#e6b422'], ['연두', '#9cc45a'], ['초록', '#3d7356'], ['옥색', '#8fc9bf'], ['하늘', '#6aa5d9'],
      ['쪽빛', '#2c4a7a'], ['남색', '#27325a'], ['보라', '#7a4f9c'], ['자주', '#8e2a5a'], ['밤색', '#7a4a2c'], ['흰색', '#efe9da'], ['회색', '#8a8a8c'], ['검정', '#1f1d1c']],
    wood: [['밝은 소나무', '#d9b88a'], ['꿀빛 나무', '#b98a52'], ['밤색 나무', '#8c5a36'], ['붉은 밤색', '#7e4a2c'], ['고동색', '#5d3722'], ['먹감나무', '#3a2618'], ['붉은 옻칠', '#7a2a1e'], ['검은 옻칠', '#1c1513']],
    glaze: [['옹기', '#6a442e'], ['짙은 옹기', '#4a2e20'], ['붉은 옹기', '#8a4a2a'], ['잿빛 옹기', '#5c6468'], ['푸레독', '#3d4448'], ['백자', '#e9e6da']],
  };

  // ---------------------------------------------------------------- categories
  const cats = [
    { id: 'furn', emoji: '🪑', name: '가구', say: '장롱과 상, 책장 같은 가구예요.' },
    { id: 'seat', emoji: '🛏️', name: '이불·방석', say: '폭신한 이불과 방석이에요.' },
    { id: 'rug', emoji: '🧶', name: '깔개', say: '바닥에 까는 돗자리와 깔개예요.' },
    { id: 'art', emoji: '🖼️', name: '병풍·그림', say: '옛 그림이 담긴 병풍과 족자예요.' },
    { id: 'wall', emoji: '🪭', name: '벽 장식', say: '벽에 거는 예쁜 것들이에요.' },
    { id: 'jar', emoji: '🏺', name: '항아리·그릇', say: '항아리와 도자기, 그릇이에요.' },
    { id: 'lamp', emoji: '🏮', name: '등불', say: '방을 밝히는 등불이에요.' },
    { id: 'plant', emoji: '🌸', name: '화분·꽃', say: '꽃과 나무를 심은 화분이에요.' },
    { id: 'toy', emoji: '🪁', name: '놀잇감', say: '팽이와 윷 같은 옛 놀잇감이에요.' },
    { id: 'music', emoji: '🥁', name: '악기', say: '가야금과 장구 같은 우리 악기예요.' },
    { id: 'food', emoji: '🍡', name: '먹거리·철', say: '철마다 먹고 말리던 것들이에요.' },
    { id: 'house', emoji: '🧺', name: '살림', say: '집에서 쓰던 살림살이예요.' },
  ];

  // ---------------------------------------------------------------- the catalogue
  const items = {};
  const order = [];
  /** add(id, cat, emoji, name, place, [w, d, h], gen, opt, extra) */
  function add(id, cat, emoji, name, place, fp, gen, opt, x) {
    const e = { id, cat, emoji, name, kid: (x && x.kid) || name, place, fp, gen, opt: opt || {} };
    if (x) for (const k of ['top', 'col', 'sz', 'lamp', 'yw']) if (x[k] !== undefined) e[k] = x[k];
    if (place === 'W' && !e.yw) e.yw = [ROOM.wallV[0] + fp[2] / 2, 1.55, ROOM.wallV[1] - fp[2] / 2];
    items[id] = e;
    order.push(id);
  }
  const WOOD = ['wood', 'tone'], CLOTH = ['cloth', 'tint'], GLAZE = ['glaze', 'tint'];

  // ---- 가구
  add('F_BANDAJI', 'furn', '🗄️', '반닫이', 'F', [1, 0.54, 0.81], 'bandaji', {}, { top: [0.9, 0.42, 0.81], col: WOOD });
  add('F_JANG2', 'furn', '🚪', '이층장', 'F', [1.19, 0.56, 1.65], 'jangnong', { tiers: 2 }, { col: WOOD });
  add('F_JANG3', 'furn', '🚪', '삼층장', 'F', [1.04, 0.56, 1.93], 'jangnong', { tiers: 3, w: 1.0, h: 1.9 }, { col: WOOD });
  add('F_IBULJANG', 'furn', '🛏️', '이불장', 'F', [1.34, 0.62, 1.53], 'ibuljang', {}, { col: WOOD });
  add('F_MEORIJANG', 'furn', '🗄️', '머릿장', 'F', [0.74, 0.46, 0.63], 'chest', { w: 0.7, d: 0.4, h: 0.6, doors: 2, drawers: 2 }, { top: [0.64, 0.34, 0.63], col: WOOD });
  add('F_MUNGAP', 'furn', '🗃️', '문갑', 'F', [1.43, 0.39, 0.53], 'mungap', {}, { top: [1.34, 0.3, 0.52], col: WOOD });
  add('F_MUNGAP_S', 'furn', '🗃️', '작은 문갑', 'F', [0.93, 0.39, 0.53], 'mungap', { w: 0.9, layout: 'dD' }, { top: [0.84, 0.3, 0.52], col: WOOD });
  add('F_SABANG', 'furn', '🪜', '사방탁자', 'F', [0.46, 0.46, 1.46], 'sabangtakja', {}, { top: [0.38, 0.38, 1.46], col: WOOD });
  add('F_CHAEKJANG', 'furn', '📚', '책장', 'F', [1.04, 0.42, 1.74], 'chaekjang', {}, { col: WOOD });
  add('F_SHELF', 'furn', '🪜', '선반', 'F', [0.9, 0.36, 1.2], 'shelf', { w: 0.9, d: 0.35, h: 1.2, levels: 3, topSpot: true }, { top: [0.84, 0.3, 1.2], col: WOOD });
  add('F_SEOAN', 'furn', '📖', '서안', 'F', [1.05, 0.37, 0.37], 'seoan', {}, { top: [0.86, 0.32, 0.345], col: WOOD });
  add('F_GYEONGSANG', 'furn', '📖', '낮은 책상', 'F', [0.9, 0.42, 0.32], 'table', { w: 0.9, d: 0.42, h: 0.32 }, { top: [0.86, 0.38, 0.32], col: WOOD });
  add('F_SOBAN', 'furn', '🍽️', '소반', 'F', [0.5, 0.5, 0.31], 'table', { w: 0.5, round: true, h: 0.3, legs: 'curved' }, { top: [0.4, 0.4, 0.31], col: WOOD });
  add('F_SANG', 'furn', '🍽️', '큰 상', 'F', [1.5, 0.9, 0.36], 'table', { w: 1.5, d: 0.9, h: 0.36 }, { top: [1.44, 0.84, 0.36], col: WOOD });
  add('F_PYEONGSANG', 'furn', '🪵', '평상', 'F', [1.8, 1.2, 0.36], 'pyeongsang', {}, { top: [1.74, 1.14, 0.36], col: WOOD });
  add('F_DWIJU', 'furn', '🌾', '뒤주', 'F', [0.99, 0.69, 1.01], 'dwiju', {}, { top: [0.86, 0.5, 1.01], col: WOOD });
  add('F_CHANJANG', 'furn', '🍶', '찬장', 'F', [1.22, 0.52, 1.77], 'chanjang', {});
  add('F_GYEONGDAE', 'furn', '🪞', '경대', 'T', [0.43, 0.39, 0.57], 'gyeongdae', {});
  add('F_GAT', 'furn', '🎩', '갓과 갓걸이', 'T', [0.44, 0.44, 0.46], 'gat', {});
  add('F_INLAY', 'furn', '🎁', '나전 함', 'T', [0.38, 0.24, 0.18], 'inlayBox', {});

  // ---- 이불 · 방석
  add('S_BANGSEOK', 'seat', '🟥', '방석', 'T', [0.6, 0.6, 0.1], 'cushion', {}, { col: CLOTH, sz: true });
  add('S_BANGSEOK_L', 'seat', '🟧', '긴 방석', 'T', [1.2, 0.6, 0.1], 'cushion', { w: 1.2, d: 0.6 }, { col: CLOTH });
  add('S_BORYO', 'seat', '🛋️', '보료', 'F', [1.91, 0.91, 0.76], 'boryo', {}, { col: CLOTH });
  add('S_BEDDING', 'seat', '🛏️', '이부자리', 'F', [1.09, 1.9, 0.24], 'bedding', {}, { col: CLOTH });
  add('S_ROLL', 'seat', '🌀', '이불 말이', 'T', [0.91, 0.26, 0.25], 'roll', { len: 0.9, r: 0.12 }, { col: CLOTH });
  add('S_JUKBUIN', 'seat', '🎋', '죽부인', 'T', [1.12, 0.25, 0.23], 'jukbuin', {});

  // ---- 깔개
  add('R_DOTJARI', 'rug', '🟫', '돗자리', 'R', [2.4, 1.6, 0.02], 'floorMat', { w: 2.4, d: 1.6 });
  add('R_MEONGSEOK', 'rug', '🟫', '멍석', 'R', [2.0, 2.0, 0.02], 'floorMat', { w: 2.0, d: 2.0, tint: '#c9ad6c', border: false });
  add('R_HWAMUN', 'rug', '🌼', '화문석', 'R', [2.4, 1.6, 0.02], 'rug', { kind: 'hwamun', w: 2.4, d: 1.6 });
  add('R_HWAMUN_S', 'rug', '🌼', '작은 화문석', 'R', [1.5, 1.0, 0.02], 'rug', { kind: 'hwamun', w: 1.5, d: 1.0 });
  add('R_JOGAK', 'rug', '🧩', '조각보 깔개', 'R', [1.8, 1.2, 0.02], 'rug', { kind: 'jogak', w: 1.8, d: 1.2, seed: 7 });
  add('R_SAEKDONG', 'rug', '🌈', '색동 깔개', 'R', [1.8, 1.0, 0.02], 'rug', { kind: 'saekdong', w: 1.8, d: 1.0 });
  add('R_ROUND', 'rug', '⭕', '둥근 깔개', 'R', [1.4, 1.4, 0.02], 'rug', { kind: 'round', w: 1.4 }, { col: CLOTH });
  add('R_FELT', 'rug', '🟥', '양탄자', 'R', [2.0, 1.4, 0.03], 'rug', { kind: 'felt', w: 2.0, d: 1.4 }, { col: CLOTH });

  // ---- 병풍 · 그림 (the artworks of the asset pack: The Met Open Access, CC0 — credits in 설정 → 사용한 자료)
  add('A_SCREEN_BIRDS', 'art', '🦜', '화조도 병풍', 'F', [2.86, 0.16, 1.77], 'foldScreen', { art: 'birds_flowers_screen', panels: 8, artH: 1.3, aw: 0.294 });
  add('A_SCREEN_BOOKS', 'art', '📚', '책거리 병풍', 'F', [3.24, 0.15, 1.47], 'foldScreen', { art: 'chaekgeori_screen', panels: 10, artH: 1.0, aw: 0.259 });
  add('A_SCREEN_STILL', 'art', '🏺', '기명절지 병풍', 'F', [3.15, 0.14, 1.62], 'foldScreen', { art: 'still_life_screen', panels: 10, artH: 1.15, aw: 0.25 });
  add('A_SCREEN_PLAIN', 'art', '⬜', '흰 병풍', 'F', [2.56, 0.19, 1.73], 'screen', { panels: 6 }, { col: ['cloth', 'silk'] });
  const SCROLLS = [['TIGER', '🐯', '호랑이 족자', 'tiger_scroll', 0.44], ['ROOSTER', '🐓', '닭 그림 족자', 'rooster_hen_minhwa', 0.41], ['DEER', '🦌', '사슴과 소나무 족자', 'deer_pines', 0.43],
    ['GEESE', '🪿', '기러기 족자', 'wild_geese_landscape', 0.45], ['PLUM', '🌸', '매화 족자', 'plum_branch', 0.65], ['BAMBOO', '🎋', '대나무 족자', 'bamboo_wind', 0.43],
    ['CARP', '🐟', '용과 잉어 족자', 'dragon_carp_minhwa', 0.64], ['OFFICIALS', '👥', '옛 모임 그림 족자', 'officials_gathering', 0.59], ['PORTRAIT', '🧑', '초상화 족자', 'portrait_yun_dongseom', 0.53]];
  for (const [k, emoji, name, art, aspect] of SCROLLS) {
    const h = 1.5, pw = clamp(h * 0.62 * aspect, 0.2, 1.6), w = +(pw + 0.2).toFixed(2);
    add('A_SCROLL_' + k, 'art', emoji, name, 'W', [w, 0.05, +(h + 0.14).toFixed(2)], 'scrollW', { art, h, w: +pw.toFixed(3) }, { yw: [1.02, 1.6, 1.68] });
  }
  add('A_FRAME_CARP', 'art', '🖼️', '액자 — 용과 잉어', 'W', [0.68, 0.03, 0.97], 'frame', { art: 'dragon_carp_minhwa', w: 0.52, h: 0.82 });
  add('A_FRAME_PLUM', 'art', '🖼️', '액자 — 매화', 'W', [0.68, 0.03, 0.97], 'frame', { art: 'plum_branch', w: 0.52, h: 0.82 });
  add('A_FRAME_ROOSTER', 'art', '🖼️', '액자 — 닭 그림', 'W', [0.5, 0.03, 0.99], 'frame', { art: 'rooster_hen_minhwa', w: 0.34, h: 0.84 });

  // ---- 벽 장식
  add('W_JOGAKBO', 'wall', '🧩', '조각보', 'W', [1.03, 0.04, 1.05], 'jogakbo', { w: 0.9, h: 0.9, seed: 1 });
  add('W_JOGAKBO_L', 'wall', '🧩', '긴 조각보', 'W', [1.73, 0.04, 0.85], 'jogakbo', { w: 1.6, h: 0.7, seed: 4 });
  add('W_CLOCK', 'wall', '🕰️', '괘종시계', 'W', [0.39, 0.13, 0.78], 'wallClock', {}, { col: WOOD, yw: [1.3, 1.75, 2.08] });
  add('W_MASK_Y', 'wall', '🎭', '양반탈', 'W', [0.22, 0.08, 0.36], 'mask', { kind: 'yangban' });
  add('W_MASK_G', 'wall', '🎭', '각시탈', 'W', [0.28, 0.08, 0.34], 'mask', { kind: 'gaksi' });
  add('W_FAN', 'wall', '🪭', '부채', 'W', [0.66, 0.03, 0.51], 'fanW', {}, { col: CLOTH });
  add('W_KITE', 'wall', '🪁', '방패연', 'W', [0.58, 0.02, 0.94], 'kite', { kind: 'bangpae' }, { col: CLOTH });
  add('W_KITE_G', 'wall', '🪁', '가오리연', 'W', [0.53, 0.02, 1.2], 'kite', { kind: 'gaori' }, { col: CLOTH, yw: [1.0, 1.7, 1.86] });
  add('W_MAEDEUP', 'wall', '🎀', '매듭 노리개', 'W', [0.12, 0.04, 0.48], 'maedeup', {}, { col: CLOTH });
  add('W_GOBI', 'wall', '✉️', '고비', 'W', [0.41, 0.06, 1.03], 'gobiW', {});
  add('W_JORI', 'wall', '🥄', '복조리', 'W', [0.27, 0.07, 0.43], 'joriW', {});
  add('W_HOMI', 'wall', '⛏️', '호미', 'W', [0.13, 0.1, 0.4], 'toolW', { kind: 'homi' });
  add('W_JEOUL', 'wall', '⚖️', '대저울', 'W', [0.91, 0.24, 0.62], 'jeoulW', {});

  // ---- 항아리 · 그릇
  add('J_HANGARI', 'jar', '🏺', '항아리', 'F', [0.84, 0.85, 1.08], 'pot', { kind: 'hangari', lid: true }, { col: GLAZE, sz: true });
  add('J_DOK', 'jar', '🏺', '큰 독', 'F', [0.8, 0.81, 1.4], 'pot', { kind: 'dok', lid: true }, { col: GLAZE, sz: true });
  add('J_JUNGDURI', 'jar', '🏺', '중두리', 'F', [0.96, 0.97, 1.06], 'pot', { kind: 'jungduri', lid: true }, { col: GLAZE, sz: true });
  add('J_DANJI', 'jar', '🏺', '단지', 'T', [0.51, 0.51, 0.54], 'pot', { kind: 'danji', lid: true }, { col: GLAZE, sz: true });
  add('J_GEUMJUL', 'jar', '🪢', '금줄 두른 독', 'F', [0.8, 0.82, 1.4], 'geumjulDok', {});
  add('J_MULDUMEONG', 'jar', '💧', '물두멍', 'F', [1.02, 1.02, 0.8], 'mulDumeong', {});
  add('J_DONGI', 'jar', '💧', '물동이', 'T', [0.55, 0.5, 0.43], 'dongi', { ring: false }, { col: GLAZE });
  add('J_SIRU', 'jar', '♨️', '시루', 'T', [0.64, 0.64, 0.3], 'pot', { kind: 'siru' });
  add('J_SOT', 'jar', '🍲', '가마솥', 'T', [0.92, 0.93, 0.48], 'pot', { kind: 'sot', lid: true });
  add('J_BASIN', 'jar', '🥣', '자배기', 'T', [0.72, 0.73, 0.2], 'pot', { kind: 'basin' }, { col: GLAZE });
  add('J_BOWLS', 'jar', '🥣', '사발과 대접', 'T', [0.39, 0.22, 0.12], 'bowls', {});
  add('J_MOON', 'jar', '🌕', '달항아리', 'T', [0.42, 0.42, 0.44], 'porcelain', { kind: 'moon' }, { sz: true });
  add('J_MAEBYEONG', 'jar', '🍶', '청자 매병', 'T', [0.24, 0.24, 0.4], 'porcelain', { kind: 'maebyeong' }, { sz: true });
  add('J_BOTTLE', 'jar', '🍶', '백자 병', 'T', [0.2, 0.2, 0.37], 'porcelain', { kind: 'bottle' }, { sz: true });
  add('J_HWARO', 'jar', '🔥', '화로', 'T', [0.57, 0.56, 0.44], 'hwaro', { light: false });
  add('J_MAETDOL', 'jar', '⚙️', '맷돌', 'T', [0.56, 0.56, 0.23], 'pot', { kind: 'millstone' });
  add('J_JEOLGU', 'jar', '🥢', '절구와 공이', 'F', [0.51, 0.51, 1.31], 'jeolgu', {});
  add('J_TEASET', 'jar', '🍵', '다기 세트', 'T', [0.46, 0.46, 0.3], 'teaSet', {});

  // ---- 등불
  add('L_JWADEUNG', 'lamp', '🏮', '좌등', 'T', [0.34, 0.34, 0.9], 'jwadeung', { light: false }, { lamp: [0, 0.56, 0] });
  add('L_DEUNGJAN', 'lamp', '🪔', '등잔', 'T', [0.2, 0.2, 0.54], 'deungjanLit', {}, { lamp: [0, 0.52, 0] });
  add('L_CANDLE', 'lamp', '🕯️', '촛대', 'T', [0.2, 0.2, 0.72], 'candle', {}, { lamp: [0, 0.7, 0] });
  add('L_PAPER', 'lamp', '🏮', '한지 등', 'T', [0.34, 0.34, 0.5], 'paperLamp', {}, { lamp: [0, 0.3, 0] });
  add('L_PAPER_T', 'lamp', '🏮', '키 큰 한지 등', 'T', [0.34, 0.34, 0.9], 'paperLamp', { h: 0.9 }, { lamp: [0, 0.52, 0] });
  add('L_CHORONG', 'lamp', '🏮', '청사초롱', 'T', [0.4, 0.25, 1.21], 'chorong', {}, { lamp: [0.16, 0.92, 0] });
  add('L_CHORONG_H', 'lamp', '🏮', '매단 청사초롱', 'H', [0.23, 0.23, 0.76], 'chorong', { hang: true }, { lamp: [0, -0.5, 0] });

  // ---- 화분 · 꽃
  add('P_ORCHID', 'plant', '🌿', '난초', 'T', [0.57, 0.56, 0.51], 'plant', { kind: 'orchid' }, { sz: true });
  add('P_PINE', 'plant', '🌲', '소나무 분재', 'T', [0.51, 0.27, 0.55], 'plant', { kind: 'pine' }, { sz: true });
  add('P_BAMBOO', 'plant', '🎍', '대나무', 'T', [0.53, 0.36, 1.12], 'plant', { kind: 'bamboo' }, { sz: true });
  add('P_PLUM', 'plant', '🌸', '매화 꽃병', 'T', [0.39, 0.23, 0.87], 'plant', { kind: 'plum' });
  add('P_MUM', 'plant', '🌼', '국화', 'T', [0.35, 0.31, 0.4], 'plant', { kind: 'mum' }, { col: CLOTH, sz: true });
  add('P_CAMELLIA', 'plant', '🌺', '동백', 'T', [0.35, 0.31, 0.4], 'plant', { kind: 'camellia' }, { sz: true });
  add('P_LOTUS', 'plant', '🪷', '연꽃 수반', 'T', [0.58, 0.58, 0.32], 'plant', { kind: 'lotus' }, { col: CLOTH });
  add('P_PEONY', 'plant', '💐', '모란 꽃병', 'T', [0.25, 0.26, 0.73], 'plant', { kind: 'peony' }, { col: CLOTH });
  add('P_LETTUCE', 'plant', '🥬', '상추 상자', 'T', [0.57, 0.32, 0.21], 'plant', { kind: 'lettuce' });
  add('P_PEPPER', 'plant', '🌶️', '고추 화분', 'T', [0.27, 0.27, 0.78], 'plant', { kind: 'pepper' });

  // ---- 놀잇감
  add('G_TOP', 'toy', '🌀', '팽이', 'T', [0.46, 0.22, 0.12], 'spinTop', {}, { col: CLOTH });
  add('G_EOLLE', 'toy', '🧵', '얼레', 'T', [0.42, 0.15, 0.14], 'eolle', {});
  add('G_YUT', 'toy', '🎲', '윷놀이', 'T', [0.47, 0.62, 0.03], 'yut', {});
  add('G_JEGI', 'toy', '🪶', '제기', 'T', [0.2, 0.1, 0.15], 'jegi', {});
  add('G_GONGGI', 'toy', '🪨', '공깃돌', 'T', [0.24, 0.15, 0.08], 'gonggi', {});
  add('G_TUHO', 'toy', '🎯', '투호', 'T', [0.66, 0.5, 0.83], 'tuho', {});
  add('G_BADUK', 'toy', '⚫', '바둑판', 'T', [0.96, 0.44, 0.25], 'baduk', {});
  add('G_DOLL_G', 'toy', '🎎', '각시 인형', 'T', [0.16, 0.16, 0.33], 'doll', { kind: 'gaksi' }, { col: CLOTH, sz: true });
  add('G_DOLL_B', 'toy', '🎎', '도령 인형', 'T', [0.16, 0.16, 0.33], 'doll', { kind: 'doryeong' }, { col: CLOTH, sz: true });
  add('G_BOOKS', 'toy', '📚', '책 더미', 'T', [0.22, 0.3, 0.14], 'books', { n: 8 });
  add('G_MUNBANG', 'toy', '🖌️', '붓과 벼루', 'T', [0.9, 0.31, 0.31], 'munbang', {});

  // ---- 악기
  add('M_GAYAGEUM', 'music', '🎼', '가야금', 'T', [1.57, 0.32, 0.19], 'gayageum', {});
  add('M_GEOMUNGO', 'music', '🎼', '거문고', 'T', [1.66, 0.33, 0.31], 'geomungo', {});
  add('M_JANGGU', 'music', '🥁', '장구', 'T', [0.6, 0.64, 0.44], 'janggu', {}, { col: CLOTH });
  add('M_BUK', 'music', '🥁', '북', 'T', [0.51, 0.28, 0.59], 'buk', {});
  add('M_JING', 'music', '🔔', '징', 'F', [0.78, 0.36, 0.94], 'jing', {});
  add('M_FLUTES', 'music', '🎶', '대금과 단소', 'T', [0.81, 0.21, 0.23], 'flutes', {});

  // ---- 먹거리 · 철 따라
  add('K_SONGPYEON', 'food', '🍡', '송편', 'T', [0.36, 0.36, 0.1], 'dish', { kind: 'songpyeon' });
  add('K_TTEOK', 'food', '🍰', '무지개떡', 'T', [0.35, 0.35, 0.15], 'dish', { kind: 'tteok' });
  add('K_YAKGWA', 'food', '🍪', '약과', 'T', [0.35, 0.35, 0.07], 'dish', { kind: 'yakgwa' });
  add('K_PERSIMMON', 'food', '🍊', '감', 'T', [0.35, 0.35, 0.14], 'dish', { kind: 'persimmon' });
  add('K_TANGERINE', 'food', '🍊', '귤 바구니', 'T', [0.34, 0.34, 0.14], 'dish', { kind: 'tangerine' });
  add('K_CHESTNUT', 'food', '🌰', '밤 바구니', 'T', [0.34, 0.34, 0.1], 'dish', { kind: 'chestnut' });
  add('K_WATERMELON', 'food', '🍉', '수박', 'T', [0.42, 0.42, 0.19], 'dish', { kind: 'watermelon' });
  add('K_SWEETPOTATO', 'food', '🍠', '군고구마', 'T', [0.4, 0.34, 0.08], 'dish', { kind: 'sweetpotato' });
  add('K_PUMPKIN', 'food', '🎃', '늙은 호박', 'T', [0.49, 0.46, 0.39], 'pumpkin', {}, { sz: true });
  add('C_GOTGAM', 'food', '🍂', '곶감 줄', 'H', [0.91, 0.07, 0.8], 'strings', { kind: 'gotgam' });
  add('C_MEJU', 'food', '🟫', '메주 줄', 'H', [0.92, 0.22, 0.67], 'strings', { kind: 'meju' });
  add('C_GOCHU', 'food', '🌶️', '고추 줄', 'H', [0.91, 0.19, 0.93], 'strings', { kind: 'gochu' });
  add('C_CORN', 'food', '🌽', '옥수수 줄', 'H', [0.91, 0.08, 0.66], 'strings', { kind: 'corn' });
  add('C_SIRAEGI', 'food', '🥬', '시래기 줄', 'H', [0.91, 0.17, 0.93], 'strings', { kind: 'siraegi' });

  // ---- 살림
  add('H_BASKET', 'house', '🧺', '바구니', 'T', [0.52, 0.52, 0.21], 'basket', {}, { sz: true });
  add('H_KI', 'house', '🧺', '키', 'T', [0.56, 0.61, 0.14], 'basket', { kind: 'ki' });
  add('H_SIEVE', 'house', '🧺', '체', 'T', [0.52, 0.52, 0.21], 'basket', { kind: 'sieve' });
  add('H_NURUK', 'house', '🫓', '누룩 채반', 'T', [0.62, 0.62, 0.07], 'nurukTray', {});
  add('H_STRAW', 'house', '🌾', '짚단', 'T', [0.38, 0.39, 0.85], 'straw', { kind: 'bundle' });
  add('H_GAMANI', 'house', '🌾', '가마니', 'F', [1.24, 1, 0.67], 'gamaniStack', { rows: [2, 1] });
  add('H_SEOM', 'house', '🌾', '쌀섬', 'T', [0.62, 0.55, 1.01], 'seom', {});
  add('H_MEONGSEOK', 'house', '🌀', '멍석 말이', 'T', [1.52, 0.45, 0.44], 'meongseok', {});
  add('H_JANGJAK', 'house', '🪵', '장작더미', 'F', [1.28, 0.56, 0.73], 'jangjak', {});
  add('H_JIGE', 'house', '🪜', '지게', 'F', [0.58, 0.58, 1.43], 'jige', {});
  add('H_BROOM', 'house', '🧹', '싸리비', 'T', [0.3, 0.3, 0.98], 'broom', {});
  add('H_JIPSIN', 'house', '🩴', '짚신', 'T', [0.25, 0.3, 0.05], 'jipsin', {});
  add('H_KKOTSIN', 'house', '👠', '꽃신', 'T', [0.21, 0.27, 0.06], 'shoes', { kind: 'kkotsin' }, { col: CLOTH });
  add('H_GOMUSIN', 'house', '👟', '고무신', 'T', [0.21, 0.27, 0.06], 'shoes', { kind: 'gomusin' });
  add('H_DOE', 'house', '🥛', '되와 말', 'T', [0.68, 0.41, 0.29], 'doeMal', {});
  add('H_DADEUMI', 'house', '🪨', '다듬잇돌', 'T', [0.63, 0.58, 0.32], 'dadeumitdol', {});
  add('H_BANJIT', 'house', '🧵', '반짇고리', 'T', [0.65, 0.49, 0.29], 'banjitgori', {});
  add('H_SOTDAE', 'house', '🐦', '솟대', 'T', [0.31, 0.27, 1.01], 'sotdae', {});
  add('H_FAN', 'house', '🪭', '세워 둔 부채', 'T', [0.66, 0.14, 0.5], 'fan', {}, { col: CLOTH });

  // ---------------------------------------------------------------- room styles
  const styles = {
    floor: [{ id: 'jangpan', emoji: '🟨', name: '장판', say: '기름 먹인 종이를 바른 따뜻한 바닥이에요.' }, { id: 'maru', emoji: '🟫', name: '우물마루', say: '나무 널을 짜 맞춘 시원한 마루예요.' },
      { id: 'stone', emoji: '⬜', name: '박석', say: '넓적한 돌을 깐 바닥이에요.' }, { id: 'earth', emoji: '🟤', name: '흙바닥', say: '단단히 다진 흙바닥이에요.' }],
    wall: [{ id: 'plaster', emoji: '⬜', name: '회벽', say: '하얀 회를 바른 벽이에요.' }, { id: 'clay', emoji: '🟧', name: '황토벽', say: '누런 황토를 바른 벽이에요.' }, { id: 'board', emoji: '🟫', name: '판벽', say: '나무 널을 세운 벽이에요.' }],
    wood: [{ id: 'warm', emoji: '🟠', name: '따뜻한 나무', say: '따뜻한 빛깔의 기둥이에요.' }, { id: 'pale', emoji: '🟡', name: '밝은 나무', say: '갓 지은 듯 밝은 기둥이에요.' }, { id: 'dark', emoji: '🟤', name: '오래된 나무', say: '오래되어 짙어진 기둥이에요.' }],
    mood: [{ id: 'day', emoji: '☀️', name: '맑은 낮', say: '맑은 낮의 햇빛이에요.' }, { id: 'warm', emoji: '🌇', name: '노을빛', say: '해 질 무렵의 따뜻한 빛이에요.' },
      { id: 'lamp', emoji: '🏮', name: '등불 밝힌 방', say: '등불이 은은한 아늑한 방이에요.' }, { id: 'bright', emoji: '💡', name: '환한 방', say: '구석까지 환한 방이에요.' }],
  };
  const DEFAULT_WIN = '00000' + '0660' + '10001' + '0000';
  const DEFAULT_STYLE = Object.freeze({ floor: 'jangpan', wall: 'plaster', wood: 'warm', mood: 'day', win: DEFAULT_WIN });

  // ---------------------------------------------------------------- geometry of placing
  const yawOf = (r) => ((r | 0) * PI) / 12;
  const snapTo = (v, g) => Math.round(v / g) * g;
  const r3 = (v) => Math.round(v * 1000) / 1000;
  /** the size of a placed thing: { w, d, h, k } (k = its size factor) */
  function dims(it, e) {
    e = e || items[it.i];
    const k = e && e.sz ? SIZE_K[it.s === 0 ? 0 : it.s === 2 ? 2 : 1] : 1;
    return { w: e.fp[0] * k, d: e.fp[1] * k, h: e.fp[2] * k, k };
  }
  /** a thing as a box: the oriented rectangle on the plan (cx, cz, hw, hd, cos, sin of its yaw) and its heights y0 … y1 */
  function box(it, e) {
    e = e || items[it.i];
    const D = dims(it, e), a = yawOf(it.r);
    let cx = it.x, cz = it.z, hw = D.w / 2, hd = D.d / 2, y0, y1;
    if (e.place === 'W') {
      // the thing reaches from the wall line into the room: its middle lies half its depth (+ the gap) inside
      const n = (D.d + ROOM.wallN) / 2;
      cx += Math.sin(a) * n; cz += Math.cos(a) * n; hd = n;
      y0 = it.y - D.h / 2; y1 = it.y + D.h / 2;
    } else if (e.place === 'H') { y1 = ROOM.ceil; y0 = ROOM.ceil - D.h; }
    else { y0 = it.y || 0; y1 = y0 + D.h; }
    return { cx, cz, hw, hd, c: Math.cos(a), s: Math.sin(a), y0, y1, place: e.place };
  }
  /** the axis-aligned rectangle round a box on the plan */
  function aabb(b) {
    const ex = Math.abs(b.c) * b.hw + Math.abs(b.s) * b.hd, ez = Math.abs(b.s) * b.hw + Math.abs(b.c) * b.hd;
    return { x0: b.cx - ex, x1: b.cx + ex, z0: b.cz - ez, z1: b.cz + ez };
  }
  /** do two boxes overlap (plan: separating axes of two turned rectangles; then the heights), with a little tolerance */
  function hit(a, b, eps) {
    eps = eps == null ? 0.03 : eps;
    if (a.y1 - eps <= b.y0 || b.y1 - eps <= a.y0) return false;
    const dx = b.cx - a.cx, dz = b.cz - a.cz;
    // the local X axis of a turned box is (c, −s), its local Z axis (s, c)
    const axes = [[a.c, -a.s], [a.s, a.c], [b.c, -b.s], [b.s, b.c]];
    for (let i = 0; i < 4; i++) {
      const ax = axes[i][0], az = axes[i][1];
      const ra = a.hw * Math.abs(ax * a.c - az * a.s) + a.hd * Math.abs(ax * a.s + az * a.c);
      const rb = b.hw * Math.abs(ax * b.c - az * b.s) + b.hd * Math.abs(ax * b.s + az * b.c);
      if (Math.abs(dx * ax + dz * az) >= ra + rb - eps) return false;
    }
    return true;
  }
  // ---- walls
  /** a wall spot: u metres from the wall's left end (seen from inside) → { side, u, x, z, r } on the wall line */
  function wallSpot(side, u) {
    const hw = ROOM.w / 2, hd = ROOM.d / 2;
    if (side === 'N') return { side, u, x: r3(u - hw), z: -hd, r: SIDE_R.N };
    if (side === 'E') return { side, u, x: hw, z: r3(u - hd), r: SIDE_R.E };
    if (side === 'S') return { side, u, x: r3(hw - u), z: hd, r: SIDE_R.S };
    return { side: 'W', u, x: -hw, z: r3(hd - u), r: SIDE_R.W };
  }
  /** where a wall thing at (x, z) with turn r hangs: { side, u } | null when it is not on a wall line */
  function wallOf(it) {
    const side = R_SIDE[it.r], hw = ROOM.w / 2, hd = ROOM.d / 2, e = 1e-6;
    if (side === 'N' && Math.abs(it.z + hd) < e) return { side, u: it.x + hw };
    if (side === 'E' && Math.abs(it.x - hw) < e) return { side, u: it.z + hd };
    if (side === 'S' && Math.abs(it.z - hd) < e) return { side, u: hw - it.x };
    if (side === 'W' && Math.abs(it.x + hw) < e) return { side, u: hd - it.z };
    return null;
  }
  /** the wall nearest to a floor point: { side, u, x, z, r } (u snapped to the grid) */
  function wallAt(x, z) {
    const hw = ROOM.w / 2, hd = ROOM.d / 2;
    const dist = { N: z + hd, S: hd - z, W: x + hw, E: hw - x };
    let side = 'N';
    for (const s of SIDES) if (dist[s] < dist[side]) side = s;
    const u = side === 'N' ? x + hw : side === 'E' ? z + hd : side === 'S' ? hw - x : hd - z;
    return wallSpot(side, clamp(snapTo(u, ROOM.grid), 0, SIDE_LEN[side]));
  }
  /** the bay a wall coordinate falls into: { i, u0, u1 } (the clear span between its posts) */
  function bayOf(side, u) {
    const n = SIDE_BAYS[side], len = SIDE_LEN[side] / n, i = clamp(Math.floor(u / len), 0, n - 1), m = ROOM.postR + 0.05;
    return { i, u0: i * len + m, u1: (i + 1) * len - m, len };
  }
  /** index of a bay in style.win */
  function winIndex(side, i) { return (side === 'N' ? 0 : side === 'E' ? 5 : side === 'S' ? 9 : 14) + i; }
  /** what a bay is: 'door' | 0 (wall) | 1…6 (window pattern) */
  function bayKind(style, side, i) {
    const k = winIndex(side, i);
    if (k === WIN_DOOR) return 'door';
    const w = style && typeof style.win === 'string' ? style.win : DEFAULT_WIN;
    return (w.charCodeAt(k) - 48) | 0;
  }
  /** the size of a window in a bay (as 75-myroom.js asks the hanok kit for it) */
  const WINDOW = Object.freeze({ w: 1.6, h: 1.3, sill: 0.55 });
  /** the parts of a wall nothing may hang over: { N: [[u0, u1, v0, v1], …], … } — windows (down to the floor: the low
   *  panelled wall under them), the door with its name plate */
  function openings(style) {
    const out = { N: [], E: [], S: [], W: [] };
    for (const side of SIDES) {
      const n = SIDE_BAYS[side], len = SIDE_LEN[side] / n;
      for (let i = 0; i < n; i++) {
        const k = bayKind(style, side, i), uc = (i + 0.5) * len;
        if (k === 'door') out[side].push([uc - ROOM.door.w / 2 - 0.14, uc + ROOM.door.w / 2 + 0.14, 0, 2.62]);
        else if (k > 0) out[side].push([uc - WINDOW.w / 2 - 0.12, uc + WINDOW.w / 2 + 0.12, 0, WINDOW.sill + WINDOW.h + 0.14]);
      }
    }
    return out;
  }

  // ---- tops
  /** the top a small thing would rest on at (x, z): { y, on (index) } — the highest offered top under the point, or the floor */
  function rest(room, e, x, z, skip) {
    let best = { y: 0, on: -1 };
    const list = (room && room.items) || [];
    for (let i = 0; i < list.length; i++) {
      if (i === skip) continue;
      const o = list[i], oe = items[o.i];
      if (!oe || !oe.top || oe.place !== 'F') continue;
      const k = dims(o, oe).k, a = yawOf(o.r), c = Math.cos(a), s = Math.sin(a), dx = x - o.x, dz = z - o.z;
      const lx = dx * c - dz * s, lz = dx * s + dz * c;
      if (Math.abs(lx) <= (oe.top[0] * k) / 2 && Math.abs(lz) <= (oe.top[1] * k) / 2) { const y = oe.top[2] * k; if (y > best.y) best = { y: r3(y), on: i }; }
    }
    return best;
  }

  /**
   * may this thing be where it is? → { ok: true } | { ok: false, why }   why: 'id' (unknown) · 'out' (outside the room) ·
   * 'door' (the keep-clear zone) · 'wall' (not on a wall / too high / too low) · 'post' (across a post) · 'window' (over a
   * window or the door) · 'air' (a height nothing holds up) · 'hit' (another thing is there). skip = the index of the
   * thing itself in room.items (when it is already there). opt.loose: only what makes a room unsafe (no 'hit' / 'window'
   * / 'post' / 'air') — what sanitize() uses for rooms from storage.
   */
  function check(room, it, skip, opt) {
    const e = items[it.i];
    if (!e) return { ok: false, why: 'id' };
    const loose = !!(opt && opt.loose), b = box(it, e), hw = ROOM.w / 2, hd = ROOM.d / 2;
    if (e.place === 'W') {
      const at = wallOf(it);
      if (!at) return { ok: false, why: 'wall' };
      const D = dims(it, e), u0 = at.u - D.w / 2, u1 = at.u + D.w / 2;
      if (u0 < 0.05 || u1 > SIDE_LEN[at.side] - 0.05) return { ok: false, why: 'out' };
      if (b.y0 < ROOM.wallV[0] - 1e-6 || b.y1 > ROOM.wallV[1] + 1e-6) return { ok: false, why: 'wall' };
      if (!loose) {
        const bay = bayOf(at.side, at.u);
        if (u0 < bay.u0 - 1e-6 || u1 > bay.u1 + 1e-6) return { ok: false, why: 'post' };
        for (const r of openings(room && room.style)[at.side]) if (u0 < r[1] && u1 > r[0] && b.y0 < r[3] && b.y1 > r[2]) return { ok: false, why: 'window' };
      }
    } else {
      const A = aabb(b), pad = e.place === 'R' ? 0.05 : e.place === 'H' ? 0.1 : ROOM.pad;
      if (A.x0 < -hw + pad - 1e-6 || A.x1 > hw - pad + 1e-6 || A.z0 < -hd + pad - 1e-6 || A.z1 > hd - pad + 1e-6) return { ok: false, why: 'out' };
      if (e.place === 'F' || e.place === 'T') {
        const K = ROOM.keep;
        if (A.x0 < K.x1 && A.x1 > K.x0 && A.z0 < K.z1 && A.z1 > K.z0) return { ok: false, why: 'door' };
      }
      if (e.place === 'T') {
        const y = it.y || 0;
        if (y > 1e-6 && !loose) { const sup = rest(room, e, it.x, it.z, skip); if (Math.abs(sup.y - y) > 0.02) return { ok: false, why: 'air' }; }
        if (y < 0 || y > 2.2) return { ok: false, why: 'air' };
      } else if ((it.y || 0) !== 0 && e.place !== 'W') return { ok: false, why: 'air' };
    }
    if (loose || e.place === 'R') return { ok: true };
    const list = (room && room.items) || [];
    for (let i = 0; i < list.length; i++) {
      if (i === skip) continue;
      const oe = items[list[i].i];
      if (!oe || oe.place === 'R') continue;
      if (hit(b, box(list[i], oe))) return { ok: false, why: 'hit', with: i };
    }
    return { ok: true };
  }

  // ---------------------------------------------------------------- rooms
  function cleanStyle(s) {
    const out = { ...DEFAULT_STYLE };
    if (!isMap(s)) return out;
    for (const k of ['floor', 'wall', 'wood', 'mood']) if (typeof s[k] === 'string' && styles[k].some((o) => o.id === s[k])) out[k] = s[k];
    if (typeof s.win === 'string' && /^[0-6]{18}$/.test(s.win)) out.win = s.win.slice(0, WIN_DOOR) + '0' + s.win.slice(WIN_DOOR + 1);
    return out;
  }
  /** one stored thing → a clean { i, x, y, z, r, s?, c? } or null */
  function cleanItem(raw) {
    if (!isMap(raw) || typeof raw.i !== 'string' || !RX_ID.test(raw.i) || !own(items, raw.i)) return null;
    const e = items[raw.i], x = Number(raw.x), y = Number(raw.y || 0), z = Number(raw.z), r = Number(raw.r || 0);
    if (!fin(x) || !fin(y) || !fin(z) || !Number.isInteger(r) || r < 0 || r > 23) return null;
    if (Math.abs(x) > ROOM.w / 2 || Math.abs(z) > ROOM.d / 2 || y < 0 || y > ROOM.h) return null;
    const it = { i: raw.i, x: r3(snapTo(x, ROOM.fine)), y: Math.round(y * 100) / 100, z: r3(snapTo(z, ROOM.fine)), r };
    if (e.sz && (raw.s === 0 || raw.s === 2)) it.s = raw.s;
    if (e.col && Number.isInteger(raw.c) && raw.c >= 0 && raw.c < palettes[e.col[0]].length) it.c = raw.c;
    if (e.place !== 'T' && e.place !== 'W') it.y = 0;
    return it;
  }
  const empty = () => ({ v: 0, style: { ...DEFAULT_STYLE }, items: [], public: false });
  /**
   * any stored / received value → a room this build can draw: unknown ids, broken numbers and things outside the room or
   * in the keep-clear zone are dropped, a small thing whose table is gone comes down to the floor, at most `limit`
   * things (LIMITS.hard at the very most). Overlaps are left alone: nobody loses a thing because a rule changed.
   */
  function sanitize(room, limit) {
    const out = empty();
    if (!isMap(room)) return out;
    const max = clamp(Math.floor(Number(limit) || LIMITS.hard), 0, LIMITS.hard);
    out.v = Number.isSafeInteger(room.v) && room.v >= 0 ? room.v : 0;
    out.public = room.public === true;
    out.style = cleanStyle(room.style);
    const src = Array.isArray(room.items) ? room.items : [];
    for (let k = 0; k < src.length && k < LIMITS.hard * 2 && out.items.length < max; k++) {
      const it = cleanItem(src[k]);
      if (!it) continue;
      if (!check(out, it, -1, { loose: true }).ok) continue;
      out.items.push(it);
    }
    // a small thing in the air comes down (its support was dropped or moved); one that cannot stand there goes
    for (let k = out.items.length - 1; k >= 0; k--) {
      const it = out.items[k], e = items[it.i];
      if (e.place !== 'T' || !it.y) continue;
      if (Math.abs(rest(out, e, it.x, it.z, k).y - it.y) > 0.02) it.y = 0;
    }
    return out;
  }
  const bytes = (room) => JSON.stringify({ v: room.v | 0, style: room.style, items: room.items, public: !!room.public }).length;

  // ---------------------------------------------------------------- three ready-made rooms
  // [id, x, z, r, y?, c?, s?] — every list passes check() for every thing (tests/myroom-client.mjs).
  const P = (list) => list.map((a) => { const it = { i: a[0], x: a[1], y: a[4] || 0, z: a[2], r: a[3] || 0 }; if (a[5] != null) it.c = a[5]; if (a[6] != null) it.s = a[6]; return it; });
  const presets = [
    {
      id: 'seonbi', emoji: '📚', name: '글 읽는 선비 방', say: '책과 붓이 있는 조용한 공부방이에요.',
      style: { floor: 'jangpan', wall: 'plaster', wood: 'warm', mood: 'day', win: '00000' + '0440' + '10001' + '0000' },
      items: P([
        ['A_SCREEN_BOOKS', -3.5, -5.125, 0], ['R_HWAMUN', -3.5, -4.0, 0], ['S_BANGSEOK', -3.5, -4.5, 0, 0, 8], ['F_SEOAN', -3.5, -3.875, 0], ['G_MUNBANG', -3.5, -3.875, 0, 0.345],
        ['L_JWADEUNG', -5.25, -4.0, 0], ['L_DEUNGJAN', -1.875, -3.875, 0], ['G_BOOKS', -4.625, -3.125, 2], ['F_CHAEKJANG', -6.625, -1.5, 6], ['F_SABANG', -6.625, -0.25, 6],
        ['J_MOON', -6.625, -0.25, 0, 1.46, null, 0], ['F_MUNGAP', -6.625, 1.5, 6], ['P_ORCHID', -6.625, 1.125, 0, 0.52, null, 0], ['J_MAEBYEONG', -6.625, 1.875, 0, 0.52], ['W_CLOCK', -7, -4.0, 6, 1.75],
        ['W_GOBI', -7, 4.0, 6, 1.5], ['A_SCROLL_BAMBOO', 2.25, -5.5, 0, 1.6], ['A_SCROLL_PLUM', 3.375, -5.5, 0, 1.6], ['A_SCROLL_GEESE', 5.625, -5.5, 0, 1.6], ['M_GEOMUNGO', 2.875, -4.375, 0],
        ['F_GAT', 5.625, -4.625, 0], ['P_PLUM', 4.5, -4.875, 0], ['R_DOTJARI', 3.25, -1.0, 0], ['G_BADUK', 3.25, -1.0, 0], ['S_BANGSEOK', 3.25, -1.875, 0, 0, 5],
        ['S_BANGSEOK', 3.25, -0.125, 0, 0, 12], ['J_TEASET', 4.75, -1.0, 0], ['P_PINE', 6.5, 4.5, 18], ['P_BAMBOO', -6.375, 4.75, 0], ['H_SOTDAE', 6.5, 3.25, 18],
      ]),
    },
    {
      id: 'anbang', emoji: '🛏️', name: '포근한 안방', say: '이불과 장롱이 있는 따뜻한 방이에요.',
      style: { floor: 'jangpan', wall: 'clay', wood: 'warm', mood: 'warm', win: '00000' + '0660' + '10001' + '0000' },
      items: P([
        ['A_SCREEN_BIRDS', -3.75, -5.125, 0], ['S_BORYO', -3.75, -4.375, 0], ['R_FELT', -3.75, -2.875, 0, 0, 11], ['J_HWARO', -2.0, -2.75, 0], ['F_JANG3', -6.5, -3.375, 6],
        ['F_IBULJANG', -6.5, -1.75, 6], ['W_FAN', -7, -1.75, 6, 1.95, 6], ['F_BANDAJI', -6.5, -0.125, 6], ['J_DANJI', -6.5, -0.125, 0, 0.81, null, 0], ['G_DOLL_G', -6.5, 0.25, 0, 0.81],
        ['G_DOLL_B', -6.5, -0.5, 0, 0.81], ['F_GYEONGDAE', -6.375, 1.25, 6], ['S_BANGSEOK', -5.5, 1.25, 0, 0, 1], ['F_MEORIJANG', 0.0, -5.0, 0], ['H_BANJIT', 0.0, -5.0, 0, 0.63],
        ['S_BEDDING', 1.875, -3.75, 0, 0, 8], ['L_PAPER', 3.25, -4.75, 0], ['W_JOGAKBO', 2.75, -5.5, 0, 1.6], ['A_SCROLL_ROOSTER', 5.0, -5.5, 0, 1.6], ['A_FRAME_PLUM', 6.125, -5.5, 0, 1.55],
        ['R_ROUND', 4.5, -1.0, 0, 0, 8], ['F_SOBAN', 4.5, -1.0, 0], ['K_SONGPYEON', 4.5, -1.0, 0, 0.31], ['S_BANGSEOK', 4.5, -0.125, 0, 0, 3], ['S_BANGSEOK', 4.5, -1.875, 0, 0, 0],
        ['H_DADEUMI', -5.75, 3.25, 6], ['W_MAEDEUP', -7, 3.5, 6, 1.6, 0], ['P_MUM', -6.5, 4.75, 0, 0, 3], ['P_CAMELLIA', 6.5, 4.5, 0], ['J_MOON', 6.5, -4.5, 0],
        ['L_CHORONG_H', 0.0, 0.0, 0], ['C_GOTGAM', -4.0, 4.0, 0], ['H_KKOTSIN', 2.25, 4.5, 0],
      ]),
    },
    {
      id: 'janchi', emoji: '🥁', name: '신나는 잔칫날', say: '악기와 놀잇감, 먹거리가 가득한 방이에요.',
      style: { floor: 'maru', wall: 'plaster', wood: 'pale', mood: 'bright', win: '00000' + '0110' + '10001' + '0110' },
      items: P([
        ['R_MEONGSEOK', 0.0, -1.5, 0], ['G_YUT', 0.0, -1.5, 0], ['F_PYEONGSANG', -4.5, -3.75, 0], ['M_GAYAGEUM', -4.5, -4.0, 0, 0.36], ['S_BANGSEOK_L', -4.5, -3.5, 0, 0.36, 3],
        ['M_JANGGU', -1.75, -4.25, 0], ['M_BUK', 0.0, -4.5, 0], ['M_JING', 1.75, -4.75, 0], ['M_FLUTES', 3.5, -4.75, 0], ['F_SANG', 4.75, -1.5, 6],
        ['K_TTEOK', 4.5, -2.0, 0, 0.36], ['K_SONGPYEON', 5.0, -2.0, 0, 0.36], ['K_YAKGWA', 4.5, -1.5, 0, 0.36], ['K_PERSIMMON', 5.0, -1.5, 0, 0.36], ['K_WATERMELON', 4.5, -1.0, 0, 0.36],
        ['S_BANGSEOK', 3.75, -1.5, 0, 0, 0], ['S_BANGSEOK', 5.875, -1.5, 0, 0, 7], ['G_TUHO', -5.5, 1.0, 0], ['G_TOP', -3.75, 1.5, 0], ['G_JEGI', -2.75, 0.5, 0],
        ['G_GONGGI', -3.0, 2.5, 0], ['G_DOLL_G', 2.0, 0.5, 9], ['G_DOLL_B', 2.5, 0.5, 15], ['W_KITE', -5.625, -5.5, 0, 1.8, 0], ['W_KITE_G', -2.75, -5.5, 0, 1.75, 7],
        ['W_MASK_Y', -0.5, -5.5, 0, 1.75], ['W_MASK_G', 0.5, -5.5, 0, 1.75], ['L_CHORONG_H', -3.0, -1.5, 0], ['L_CHORONG_H', 3.0, -1.5, 0], ['L_CHORONG', -6.25, -4.75, 0],
        ['L_CHORONG', 6.25, -4.75, 12], ['C_GOCHU', -5.0, 4.25, 0], ['C_CORN', 5.0, 4.25, 0], ['K_PUMPKIN', 6.25, 4.5, 0], ['H_GAMANI', -6.0, 4.25, 6],
        ['J_HANGARI', 6.0, 2.5, 0], ['J_DOK', 6.0, 1.25, 0], ['P_PEONY', -6.5, -1.0, 0, 0, 1],
      ]),
    },
  ];
  /** a ready-made room as a fresh room object (null for an unknown id) */
  function preset(id) {
    const p = presets.find((q) => q.id === id);
    return p ? sanitize({ v: 0, style: p.style, items: p.items, public: false }, LIMITS.hard) : null;
  }

  /** what the server needs to check a room (game-data.json → myroom): no names, no generator options */
  function serverTable() {
    const t = {};
    for (const id of order) { const e = items[id]; t[id] = [e.place, e.fp[0], e.fp[1], e.fp[2], e.col ? palettes[e.col[0]].length : 0, e.sz ? 1 : 0]; }
    return {
      v: 1, room: { w: ROOM.w, d: ROOM.d, h: ROOM.h, ceil: ROOM.ceil, pad: ROOM.pad, fine: ROOM.fine, wallN: ROOM.wallN, wallV: [ROOM.wallV[0], ROOM.wallV[1]], keep: { ...ROOM.keep } },
      limits: { ...LIMITS }, sizes: SIZE_K.slice(), items: t,
      styles: { floor: styles.floor.map((o) => o.id), wall: styles.wall.map((o) => o.id), wood: styles.wood.map((o) => o.id), mood: styles.mood.map((o) => o.id), winLen: WIN_LEN, winDoor: WIN_DOOR },
    };
  }

  G.data.myroom = {
    V: 1, ROOM, LIMITS, SIDES, SIDE_R, R_SIDE, SIDE_LEN, SIDE_BAYS, SIZE_K, PATTERNS, PATTERN_NAMES, WINDOW, WIN_DOOR, DEFAULT_STYLE,
    items, order, cats, palettes, styles, presets,
    yawOf, snapTo, dims, box, aabb, hit, rest, check, wallSpot, wallOf, wallAt, bayOf, bayKind, winIndex, openings,
    empty, sanitize, cleanStyle, cleanItem, preset, bytes, serverTable,
  };
})();
