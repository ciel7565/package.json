// =============================================================================
// 29-interiors-c.js — rooms ③: PL_BUEOK 부엌 · PL_BALHYO 발효실 · PL_GOTGAN 곳간 (CONTRACT §16.4 / §16.5, track rooms-c).
//
// Built with the hanok kit (19-hanok-kit.js — the generators of its [rooms-c] block) exactly like the reference room
// 27-interiors-a.js: define() at load with the door from G.sys.places.doorOf(<building>), build(ctx) =
// G.hanok.room(ctx, spec) … R.finish(). Light profile and minimap plan come from the kit; every room is roomier than a
// real one so a child and the follow camera have space.
//
//  부엌 (B_THATCH, origin (0, 2000), 11 × 8 × 3.6): an earth floor a step below the door; the 부뚜막 along the west wall
//    with two 아궁이 (fire, embers, a pooled light each, a little smoke drawn to the wall), 가마솥 with steam, a 시루 on
//    the small one; a 바라지창 above it lets a sun shaft through the steam; 살강 with 사발 / 대접, 찬장, 물두멍 + 물동이,
//    소반 (a stack and a laid one), 맷돌 on its mat, 절구 + 공이, 키 · 체 · 복조리 on the wall, 장작, 광주리, strings of
//    시래기 · 고추 · 마늘 from the rafters (they sway), a smoke-darkened ceiling over the hearth.
//    Anchors: agungi · gamasot · siru · salgang · soban · jori · ki · maetdol. Board: MG_GUDEUL.
//  발효실 (B_HANOK4, origin (200, 2000), 12 × 9 × 3.4): the fermentation year — 메주 hung on straw rope (they sway),
//    a straw bed where 메주 ripen, 누룩 trays, a row of 장독 on a stone 단 (간장 open with 숯 and 고추 afloat, 된장 with a
//    금줄, 고추장, 씨간장), 장 가르기, a 김칫독 pit with 김장, 식초 by the warm wall, a salt 가마니 over a 간수 tub, tools
//    (됫박 · 깔때기 · 용수 · 체); cool dim light, two high 살창 throw shafts on the jars. A small board shows the player's
//    own jars (G.sys.fermentation, read-only).
//    Anchors: balhyo · meju · byeotjip · jangdok · jangareugi · ssiganjang · yusan · gochujang · kimchidok · kimjang ·
//    sikcho · nuruk · geumjul. Boards: MG_JANG_YEAR (the wall calendar), MG_MICROBE.
//  곳간 (B_GOTGAN, origin (400, 2000), 10 × 8 × 3.6): 뒤주, 가마니, 섬, 멍석 (one spread with peppers drying in the sun
//    shaft), a 시렁 with baskets, farm tools on the wall (호미 · 낫 · 쇠스랑 · 도리깨), a 대저울 with 되 and 말, seed corn and
//    dried herbs, a 장독대 model, an 옹기 shard, regional jar shapes — and "내 선반": what the player's own 곳간 holds
//    (G.sys.storage, updated on storage:changed) with an interactable that opens the 곳간 panel.
//    Anchors: dwiju · gamani · jangdokdae · onggi · onggi_region · jeolgi · gamja · gondeure.
//    Boards: MG_ONGGI_BREATH · MG_ONGGI_REGION · MG_JEOLGI.
// The door of B_GOTGAN outside stands 1.8 m to the side of the building's middle: the old "곳간 열기" spot (42-realfarm
// GOTGAN_DOOR) keeps opening the panel, the new door leads in.
// =============================================================================
(function () {
  const P = G.sys.places, K = G.hanok;
  if (!P || !K || typeof K.buttumak !== 'function') { G.log.warn('WORLD', 'interiors-c: places / hanok kit missing — no 부엌, 발효실, 곳간'); return; }
  const PI = Math.PI, TAU = PI * 2;
  const BK = G.bkit, M = BK.M, mul = BK.mul, geo = BK.geo;
  const FONT = BK.FONT || 'sans-serif';
  const YAW = { N: 0, E: -PI / 2, S: PI, W: PI / 2 };
  const num = (v, d) => (Number.isFinite(Number(v)) && v != null ? Number(v) : d);

  // fallback exhibits (only while 49-exhibits.js is not in the build — its data and cards take over when it is)
  const topics = (rows) => rows.map(([anchor, emoji, title, kid]) => ({ id: 'HX_' + anchor.toUpperCase(), anchor, emoji, title, kid, detail: kid }));
  const T_BUEOK = topics([
    ['agungi', '🔥', '아궁이와 부뚜막', '아궁이 불로 밥도 짓고 방도 데워요.'], ['gamasot', '🍲', '가마솥', '가마솥에 밥도 짓고 콩도 삶아요.'],
    ['siru', '🍡', '시루', '바닥 구멍으로 김이 올라와 떡을 쪄요.'], ['salgang', '🫙', '살강과 물두멍', '살강엔 그릇, 물두멍엔 물을 두어요.'],
    ['soban', '🍽️', '소반', '작은 밥상은 고장마다 모양이 달라요.'], ['jori', '🥄', '조리', '조리로 쌀을 일어요.'],
    ['ki', '🧺', '키와 체', '키로 까부르고 체로 걸러요.'], ['maetdol', '⚙️', '맷돌과 절구', '맷돌은 갈고, 절구는 찧어요.'],
  ]);
  const T_BALHYO = topics([
    ['balhyo', '🦠', '발효', '작은 미생물이 음식을 새 맛으로 바꿔요.'], ['meju', '🟫', '메주 쑤기', '콩을 삶고 찧어 메주를 빚어요.'],
    ['byeotjip', '🌾', '메주 띄우기', '볏짚에 사는 균이 메주로 옮겨 가요.'], ['jangdok', '🏺', '장 담그기', '메주를 소금물에 담가요.'],
    ['jangareugi', '🥣', '장 가르기', '국물은 간장, 건더기는 된장이 돼요.'], ['ssiganjang', '🫗', '씨간장', '묵은 씨간장을 새 장에 더해요.'],
    ['yusan', '🌏', '세계가 아끼는 장 담그기', '장 담그기는 세계가 아끼는 유산이에요.'], ['gochujang', '🌶️', '고추장', '고추장엔 메줏가루와 곡식이 들어가요.'],
    ['kimchidok', '🥬', '김칫독', '젖산균이 김치를 새콤하게 만들어요.'], ['kimjang', '🧤', '김장', '입동 무렵에 함께 담가 나눠 먹어요.'],
    ['sikcho', '🍶', '식초', '초산균이 신맛을 만들어요.'], ['nuruk', '🍘', '누룩', '누룩 속 곰팡이와 효모가 일을 해요.'],
    ['geumjul', '🧦', '금줄과 버선본', '장독에 금줄을 두르고 종이 버선을 붙여요.'],
  ]);
  const T_GOTGAN = topics([
    ['dwiju', '🌾', '곳간과 뒤주', '곳간엔 곡식, 뒤주엔 쌀을 넣어요.'], ['gamani', '🧶', '가마니와 멍석', '가마니에 곡식을 담고 멍석에 말려요.'],
    ['jangdokdae', '🏺', '장독대', '물이 잘 빠지는 높은 자리에 독을 모아요.'], ['onggi', '💨', '숨 쉬는 옹기', '옹기 벽엔 아주 작은 숨구멍이 있어요.'],
    ['onggi_region', '🗺️', '고장마다 다른 옹기', '고장마다 옹기 모양이 달라요.'], ['jeolgi', '🗓️', '스물네 절기', '해가 가는 길을 스물네 칸으로 나눴어요.'],
    ['gamja', '🥔', '정선의 농사', '정선은 감자와 옥수수가 잘 자라요.'], ['gondeure', '🍜', '정선의 음식', '곤드레밥을 지어 먹어요.'],
  ]);

  // ---------------------------------------------------------------- shared helpers
  /** a framed motion board on a wall bay (the frame is merged with the wall; the picture is the places board) */
  function wallBoard(ctx, R, side, bay, id, title, o = {}) {
    const b = R.bay(side, bay), w = o.w || 1.62, h = o.h || 0.91, v = o.v || 1.62, u = b.uc + (o.offset || 0);
    R.add('wood', K.geo.slab(w + 0.12, h + 0.12, 0.05, 0.012), R.wm(side, u, v, 0.03), '#4a3020', { wall: side });
    const p = R.wp(side, u, v, 0.062);
    ctx.board(id, { x: p.x, y: p.y, z: p.z, rotY: YAW[side], w, h, title });
    return R.wp(side, u, v - 0.2, 0.55);
  }
  /** a 초롱 (paper lantern) on a cord with a pooled light */
  function lantern(ctx, R, x, y, z, o = {}) {
    R.add('glow', geo.cyl(0.1, 0.1, 0.28, 10), M(x, y, z), '#ffd9a8', { cast: false, wall: o.wall });
    for (const yy of [y - 0.15, y + 0.15]) R.add('furn', geo.cyl(0.105, 0.105, 0.028, 10), M(x, yy, z), '#3a2416', { cast: false, wall: o.wall });
    R.add('iron', geo.tube(x, y + 0.16, z, x, num(o.top, y + 0.5), z, 0.005, 4), null, null, { cast: false, wall: o.wall });
    ctx.light({ x, y: y - 0.05, z, color: '#ffb66a', intensity: num(o.intensity, 5), distance: num(o.distance, 9), decay: 1.7, flicker: 0.05, day: 0.25 });
  }
  /** a small paper name plate on a wall (title + a plain explanation) */
  function plate(R, side, u, v, title, sub, w = 0.5) { return R.label(title, { side, u, v, w, h: sub ? 0.22 : 0.16, sub, style: 'paper' }); }
  const roundRect = (c, x, y, w, h, r) => { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); };

  // =========================================================================================== 부엌 PL_BUEOK
  const doorBu = P.doorOf('B_THATCH');
  function buildBueok(ctx) {
    const R = K.room(ctx, {
      w: 11, d: 8, post: 2.55, ridge: 3.6, bays: { x: 4, z: 3 }, floor: 'earth', roof: 'rafters', tone: 'dark',
      walls: {
        // left → right as seen from inside: N west→east, E north→south, S east→west, W south→north
        N: ['clay', 'clay', 'clay', 'clay'],
        E: ['clay', 'board', 'clay'],
        S: [{ door: 'panel', exit: true, w: 1.6, h: 2.0 }, { window: 'ttisal', w: 1.2, h: 0.95, sill: 1.0 }, 'clay', 'clay'],
        W: ['clay', { baraji: true, w: 1.0, h: 0.7, sill: 1.5, offset: 0.5, open: 0.92, label: '바라지창', sub: '연기와 김이 빠지는 창' }, 'clay'],
      },
      sun: { az: 255, el: 24 },
    });
    const A = (key, spot) => ctx.anchor(key, spot);

    // ---- the 부뚜막 along the west wall: two 아궁이, the big 가마솥 under the window, the small one with a 시루
    const bt = K.buttumak(R, { x: -5.0, z: 0, rotY: PI / 2, w: 4.4, d: 1.0, h: 0.78, mouths: [-1.3, 0.5], pots: [{ u: 0.5, s: 1.15 }, { u: -1.3, s: 0.95, siru: true }] });
    R.block(-5.0, 0, 0.53, 2.24);
    const big = bt.pots[0], sm = bt.pots[1];
    A('gamasot', { x: big.x + 0.35, y: big.y + 0.05, z: big.z });
    A('siru', { x: sm.x + 0.3, y: sm.y + 0.1, z: sm.z });
    A('agungi', { x: bt.mouths[0].x + 0.35, y: 0.4, z: bt.mouths[0].z + 0.5 });
    // a little smoke escapes each mouth and creeps up the front to the wall (the 굴뚝 is behind it)
    for (const mo of bt.mouths) {
      K.smoke(R, { x: mo.x - 0.05, y: 0.52, z: mo.z, s: 0.5, count: 5, life: 4.2 });
      K.smoke(R, { x: mo.x - 0.45, y: 0.85, z: mo.z + 0.1, s: 0.45, count: 4, life: 5 });
    }
    // 부지깽이 and a 부삽 leaning on the 부뚜막 by the south mouth
    R.add('wood', geo.tube(-4.42, 0.74, 2.05, -3.95, 0.0, 2.2, 0.016, 5), null, '#4a3524');
    R.add('iron', geo.tube(-4.42, 0.7, 2.3, -4.05, 0.05, 2.42, 0.012, 5), null, '#3a3836');
    R.add('iron', K.geo.slab(0.16, 0.004, 0.13, 0.002), M(-4.02, 0.03, 2.43, 0.4, 1, 1, 1, 0.08), '#3a3836');
    // the stone step inside the door: the earth floor lies a step below the doorway
    R.add('stone', K.geo.slab(1.7, 0.2, 0.62, 0.03), M(4.12, 0.1, 3.66), '#b3ab9c');
    ctx.addWalkable({ shape: 'box', x: 4.12, z: 3.66, hw: 0.85, hd: 0.31, top: 0.2, surface: 'stone' });

    // ---- smoke-darkened rafters, gable and mouths over the hearth
    K.soot(R, [
      { roof: true, x0: -5.5, x1: -2.4 },
      { m: R.wm('W', 4.0, 2.75, 0.035), w: 5.6, h: 2.3 },
      ...bt.mouths.map((p) => ({ m: M(p.x - 0.12, 0.72, p.z, PI / 2), w: 0.78, h: 0.42 })),
    ], { alpha: 0.8 });

    // ---- NW: 물두멍 + 물동이 with its 똬리
    K.mulDumeong(R, { x: -4.85, z: -3.3, s: 0.95 });
    R.block(-4.85, -3.3, 0.5, 0.5);
    K.dongi(R, { x: -3.72, z: -3.5, rotY: 0.4 });
    R.block(-3.72, -3.5, 0.28, 0.28);

    // ---- N bay 1: the 살강, a basin below it; N bay 2: the 찬장; N bay 3: the rice jar and an oil lamp
    const sg = K.salgang(R, 'N', 1, { levels: 2, y: 1.2, gap: 0.5 });
    A('salgang', { x: sg.x, y: sg.y - 0.25, z: sg.z + 0.15 });
    K.pot(R, { kind: 'basin', x: -1.45, z: -3.5, s: 0.95, tint: '#6a4630' });
    K.pot(R, { kind: 'bowl', x: -1.4, y: 0.05, z: -3.45, s: 1.4, tint: '#cdb47c' });   // a gourd dipper in it
    R.block(-1.45, -3.5, 0.36, 0.36);
    K.chanjang(R, { x: 1.4, z: -3.72, w: 1.2, d: 0.46 });
    R.block(1.4, -3.72, 0.62, 0.26);
    K.pot(R, { kind: 'dok', x: 4.3, z: -3.45, s: 0.82, lid: true, tint: '#6b4430' });
    K.pot(R, { kind: 'danji', x: 3.65, z: -3.6, s: 0.8, lid: true, tint: '#5f3d2a' });
    R.block(4.1, -3.5, 0.75, 0.4);
    K.deungjan(R, { x: 2.85, z: -3.55, h: 0.55, intensity: 3.6 });
    R.block(2.85, -3.55, 0.14, 0.14);

    // ---- E bay 0: 키, 체, 복조리 on the wall, a 광주리 of potatoes below
    K.basket(R, { m: mul(R.wm('E', 0.85, 1.5, 0.08), M(0, 0, 0, PI, 1, 1, 1, -PI / 2)), kind: 'ki', r: 0.3, wall: 'E' });
    K.basket(R, { m: mul(R.wm('E', 1.6, 1.62, 0.045), M(0, 0, 0, 0, 1, 1, 1, PI / 2)), kind: 'sieve', r: 0.19, h: 0.075, wall: 'E' });
    for (const [u, v] of [[0.85, 1.92], [1.6, 1.86]]) R.add('furn', geo.cyl(0.013, 0.013, 0.09, 6).applyMatrix4(new THREE.Matrix4().makeRotationX(PI / 2)), R.wm('E', u, v, 0.045), '#5c3f28', { wall: 'E' });
    K.jori(R, R.wm('E', 2.25, 1.86, 0.03), { pair: true, wall: 'E' });
    plate(R, 'E', 0.85, 0.98, '키', '곡식을 까불러 티끌을 날려요', 0.56);
    plate(R, 'E', 1.6, 1.18, '체', '가루를 걸러요', 0.42);
    plate(R, 'E', 2.25, 1.42, '복조리', '쌀을 이는 조리 한 쌍', 0.5);
    A('ki', R.wp('E', 1.2, 1.2, 0.35));
    A('jori', R.wp('E', 2.25, 1.55, 0.3));
    K.basket(R, { x: 4.95, z: -3.05, r: 0.32, h: 0.2 });
    for (let i = 0; i < 9; i++) { const a = i * 2.4, rr = i ? 0.13 : 0; R.add('paint', new THREE.SphereGeometry(0.05, 8, 6).scale(1.2, 0.85, 1), M(4.95 + Math.cos(a) * rr, 0.13 + (i > 5 ? 0.05 : 0), -3.05 + Math.sin(a) * rr, a), i % 3 ? '#b48a58' : '#a67d4e'); }
    R.block(4.95, -3.05, 0.34, 0.34);

    // ---- 소반: a stack against the 판벽, and one laid with bowls, spoon and chopsticks
    for (let k = 0; k < 3; k++) K.table(R, { x: 4.95, y: k * 0.27, z: -0.25, rotY: k * 0.35, w: 0.54, round: true, h: 0.27, legs: 'curved', tone: k === 1 ? '#5f3420' : '#6b3a22' });
    R.block(4.95, -0.25, 0.3, 0.3);
    const sb = K.table(R, { x: 3.55, z: -1.15, w: 0.62, d: 0.44, h: 0.3, legs: 'curved', tone: '#6e3d24' });
    K.bowl(R, M(3.42, sb.top, -1.08), 'sabal', '#efece3');
    K.bowl(R, M(3.7, sb.top, -1.08), 'daejeop', '#e9e5d8');
    for (const [dx, dz] of [[-0.18, -0.12], [0.02, -0.15], [0.2, -0.12]]) K.bowl(R, M(3.55 + dx, sb.top, -1.15 + dz), 'small', dx > 0.1 ? '#b8b6a0' : '#efece3');
    R.add('paint', geo.disc(0.05, 10), M(3.42, sb.top + 0.055, -1.08), '#f7f3ea');            // rice in the 사발
    R.add('paint', geo.disc(0.08, 12), M(3.7, sb.top + 0.045, -1.08), '#a9784a');             // soup in the 대접
    R.add('brass', K.geo.slab(0.2, 0.006, 0.026, 0.002), M(3.36, sb.top + 0.005, -0.98, 0.12), '#c9a24a');   // 숟가락
    for (const dz of [-0.008, 0.008]) R.add('brass', K.geo.slab(0.21, 0.005, 0.005, 0.001), M(3.72, sb.top + 0.004, -0.97 + dz, 0.05), '#c9a24a');   // 젓가락
    R.block(3.55, -1.15, 0.36, 0.27);
    A('soban', { x: 3.55, y: sb.top + 0.25, z: -1.15 });

    // ---- south: 맷돌 on its 맷방석, the 절구 and its 공이, the 장작 pile by the fire
    R.add('straw', K.geo.lathe([[0, 0], [0.52, 0], [0.57, 0.06], [0.54, 0.075], [0.49, 0.02], [0, 0.02]], 22), M(1.25, 0, 2.95), '#d4b874');
    K.pot(R, { kind: 'millstone', x: 1.25, y: 0.02, z: 2.95, s: 1.05 });
    R.add('furn', geo.tube(1.25 + 0.24, 0.17, 2.95, 1.25 + 0.24, 0.42, 2.95, 0.018, 6), null, '#6b4a30');   // 어처구니 (the handle)
    R.add('furn', geo.tube(1.25 + 0.24, 0.42, 2.95, 1.25 + 0.42, 0.42, 2.95, 0.016, 6), null, '#6b4a30');
    R.add('paint', K.geo.lathe([[0.5, 0], [0.4, 0.012], [0.3, 0.016], [0.27, 0.01]], 22), M(1.25, 0.02, 2.95), '#efe8d6');   // meal ground out round the stone
    R.block(1.25, 2.95, 0.55, 0.55);
    K.pot(R, { kind: 'mortar', x: -0.35, z: 3.2, s: 1.0, mat: 'wood', tint: '#9a7552' });
    K.gongi(R, { x: -0.2, z: 3.45, rotY: PI / 2, lean: 0.24 });
    R.block(-0.3, 3.3, 0.3, 0.38);
    A('maetdol', { x: 0.45, y: 0.55, z: 2.8 });
    K.jangjak(R, { x: -3.55, z: 3.55, w: 1.7, h: 0.72, d: 0.45 });
    R.block(-3.55, 3.55, 0.88, 0.26);
    K.straw(R, { x: -2.45, z: 3.6, kind: 'bundle', s: 0.85, rotY: 0.3 });

    // ---- the motion board (S bay 2) and the 띠살창 (S bay 1) glow
    wallBoard(ctx, R, 'S', 2, 'MG_GUDEUL', '구들에 불이 지나가는 길');

    // ---- strings of 시래기, 고추 and 마늘 from a pole under the rafters on the east side (they sway a little)
    const px = 4.3, py = 2.32, z0 = -3.1, z1 = 0.9;
    R.add('wood', geo.tube(px, py, z0, px, py, z1, 0.03, 8), null, '#8b6e50');
    for (const zz of [z0 + 0.15, z1 - 0.15]) R.add('straw', geo.tube(px, py, zz, px, R.roofY(zz) + 0.06, zz, 0.008, 4), null, '#a98a4f');
    const Sa = K.sway(R, { x: px, y: py, z: (z0 + z1) / 2, amp: 0.05, speed: 0.5, axis: 'z' }), Sb = K.sway(R, { x: px, y: py, z: (z0 + z1) / 2, amp: 0.04, speed: 0.63, axis: 'z' });
    [['s', -2.85], ['g', -2.35], ['m', -1.85], ['s', -1.3], ['g', -0.75], ['s', -0.2], ['m', 0.35]].forEach(([k, zz], i) => {
      const S = i % 2 ? Sb : Sa, o = { x: px, y: py - 0.02, z: zz };
      if (k === 's') K.siraegi(S, { ...o, len: 0.5 }); else if (k === 'g') K.gochu(S, { ...o, n: 13 }); else K.maneul(S, o);
    });
    Sa.done(); Sb.done();
    R.label('시래기 · 고추 · 마늘', { x: 4.95, y: 2.05, z: -1.3, rotY: -PI / 2, w: 0.82, h: 0.24, sub: '말려 두고 겨우내 먹어요', style: 'paper' });

    K.dust(R, { count: 110 });
    R.finish();
    return {};
  }
  P.define({
    id: 'PL_BUEOK', name: '부엌', kidName: '부엌', emoji: '🍚', zoneId: 'ZONE_PL_BUEOK', color: '#d9a46a',
    desc: '아궁이에 불을 때고 가마솥에 밥을 짓던 부엌이에요.',
    origin: { x: 0, z: 2000 }, size: { w: 11, d: 8, h: 3.6 }, floorY: 0, surface: 'dirt',
    spawn: { x: 2.3, z: 1.0, rotY: -PI / 2 - 0.2 },
    door: doorBu ? { buildingId: 'B_THATCH', x: doorBu.x, z: doorBu.z, label: '🚪 부엌 들어가기', kidLabel: '부엌 구경' } : undefined,
    exit: doorBu ? doorBu.exit : undefined,
    indoor: true, camera: { dist: 5.0, min: 2.4, max: 6.6, pitch: 0.16, pmin: -0.1, pmax: 0.8, ceil: 2.42 }, far: 150,
    exhibits: T_BUEOK,
    build: buildBueok,
  });

  // =========================================================================================== 발효실 PL_BALHYO
  const doorBa = P.doorOf('B_HANOK4');
  /** the little board of the player's own jars (41-fermentation, read-only): a canvas redrawn when something changes */
  function jarBoard(ctx, R, x, y, z, rotY) {
    const cw = 512, ch = 288;
    const tex = G.gfx.canvasTexture(cw, ch, () => {}, { full: true });
    ctx.own(tex);
    const mt = new THREE.MeshBasicMaterial({ map: tex, color: 0xe9e4da, fog: false });
    ctx.own(mt);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1.12, 0.63), mt);
    mesh.position.set(x, y, z); mesh.rotation.y = rotY; mesh.name = 'room-jarboard'; mesh.userData.guardSkip = true;
    R.addMesh(mesh, null);
    let sig = null, acc = 99;
    const read = () => {
      const F = G.sys.fermentation;
      let ids = [];
      try { ids = (F?.myJarIds?.() || []).slice(0, 3); } catch (e) { ids = []; }
      return ids.map((id) => { let j = null; try { j = F.getJar(id); } catch (e) { j = null; } return j ? { id, name: String(j.recipe?.name || ''), status: String(j.statusName || ''), st: String(j.status || ''), p: Math.max(0, Math.min(100, Math.floor(Number(j.progress) || 0))) } : null; }).filter(Boolean);
    };
    const draw = (rows) => {
      const c = tex.image.getContext('2d');
      c.clearRect(0, 0, cw, ch);
      const g = c.createLinearGradient(0, 0, 0, ch); g.addColorStop(0, '#f2e8d2'); g.addColorStop(1, '#e4d5b6');
      c.fillStyle = g; c.fillRect(0, 0, cw, ch);
      c.strokeStyle = 'rgba(90,60,30,.55)'; c.lineWidth = 6; c.strokeRect(9, 9, cw - 18, ch - 18);
      c.fillStyle = '#4a3320'; c.textAlign = 'left'; c.textBaseline = 'middle';
      c.font = `800 34px ${FONT}`; c.fillText('내 장독은 지금', 30, 44);
      c.font = `600 18px ${FONT}`; c.fillStyle = '#7a5a38'; c.fillText('장독대에 둔 내 독 (발효 놀이)', 262, 47);
      if (!rows.length) {
        c.font = `700 24px ${FONT}`; c.fillStyle = '#5a4128'; c.textAlign = 'center';
        c.fillText('장독대에서 장을 담그면', cw / 2, 140); c.fillText('여기에서 익어 가는 모습을 볼 수 있어요', cw / 2, 178);
        return;
      }
      rows.forEach((r, i) => {
        const y = 92 + i * 64;
        // a small jar
        c.fillStyle = '#5c3a27'; c.beginPath(); c.ellipse(52, y + 10, 18, 20, 0, 0, TAU); c.fill();
        c.fillRect(42, y - 14, 20, 8); c.fillStyle = '#7a5038'; c.fillRect(38, y - 18, 28, 6);
        c.fillStyle = '#3e2b1a'; c.font = `800 24px ${FONT}`; c.textAlign = 'left';
        c.fillText(r.name || '빈 독', 84, y);
        c.font = `600 19px ${FONT}`; c.fillStyle = '#6d4f30'; c.fillText(r.status, 84, y + 26);
        // the progress bar (no numbers needed: the bar says it)
        const bx = 262, bw = 214, by = y + 2;
        roundRect(c, bx, by, bw, 22, 11); c.fillStyle = 'rgba(80,55,30,.18)'; c.fill();
        if (r.p > 0) { roundRect(c, bx, by, Math.max(22, (bw * r.p) / 100), 22, 11); c.fillStyle = r.st === 'COMPLETE' ? '#6f9a4a' : '#b9823e'; c.fill(); }
        c.fillStyle = '#4a3320'; c.font = `700 17px ${FONT}`; c.textAlign = 'right'; c.fillText(r.st === 'COMPLETE' ? '다 익었어요' : r.p + '%', bx + bw, by + 40);
      });
    };
    draw([]); tex.needsUpdate = true;
    R.onUpdate((dt) => {
      acc += dt;
      if (acc < 2) return;
      acc = 0;
      const rows = read(), s = JSON.stringify(rows);
      if (s === sig) return;
      sig = s; draw(rows); tex.needsUpdate = true;
    });
    return mesh;
  }
  function buildBalhyo(ctx) {
    const shadowed = !!G.sys.engine?.indoorShadows;
    const R = K.room(ctx, {
      w: 12, d: 9, post: 2.6, ridge: 3.4, bays: { x: 4, z: 3 }, floor: 'stone', roof: 'rafters', tone: 'warm',
      walls: {
        N: ['clay', 'clay', 'clay', 'clay'],
        E: ['plaster', { door: 'panel', exit: true, w: 1.6, h: 2.0 }, 'plaster'],
        S: ['plaster', { baraji: true, w: 1.1, h: 0.5, sill: 1.76, open: 0.9 }, { baraji: true, w: 1.1, h: 0.5, sill: 1.76, open: 0.9, label: '살창', sub: '바람과 빛이 드나들어요' }, 'plaster'],
        W: ['clay', 'clay', 'clay'],
      },
      sun: { az: 195, el: 28 },
      // cool and dim: a store room kept away from the warm sun
      light: { hemi: { sky: '#dde3e8', ground: '#80776b', intensity: shadowed ? 0.36 : 0.76 }, exposure: 0.97 },
    });
    const A = (key, spot) => ctx.anchor(key, spot);

    // ---- north: the 메주 rack (bay 1), the straw bed where 메주 ripen (bay 2), the 누룩 rack (bay 3), the 김칫독 pit (corner)
    const rack = K.mejuRack(R, { x: -1.5, z: -3.85, w: 2.5, h: 2.3, rows: [2.12, 1.52], per: 5 });
    R.block(-1.5, -3.85, 1.32, 0.34);
    A('meju', rack.spots[7] || rack.spots[0]);
    plate(R, 'N', 4.5, 2.45, '메주', '콩을 삶고 찧어 빚은 덩이', 0.62);
    const bed = K.mejuBed(R, { x: 1.5, z: -3.92, w: 2.4, d: 0.8, h: 0.5, n: 6 });
    R.block(1.5, -3.92, 1.24, 0.44);
    A('byeotjip', bed.spots[2]);
    plate(R, 'N', 7.5, 1.55, '메주 띄우기', '볏짚 위에서 메주가 익어요', 0.66);
    const nr = K.nurukRack(R, { x: 4.5, z: -4.17, w: 1.5, d: 0.5, h: 1.7, levels: 4 });
    R.block(4.5, -4.17, 0.8, 0.3);
    A('nuruk', nr.spots[1]);
    plate(R, 'N', 10.5, 2.05, '누룩', '밀을 뭉쳐 띄운 덩이', 0.56);
    const pit = K.kimchiPit(R, { x: -4.95, z: -3.55, w: 1.9, d: 1.6 });
    R.block(-4.95, -3.55, 0.97, 0.82);
    A('kimchidok', pit.jars[0]);
    plate(R, 'W', 7.8, 1.6, '김칫독', '땅에 묻어 차게 익혀요', 0.58);
    // 김장: salted cabbage halves in a big basin
    K.pot(R, { kind: 'basin', x: -4.35, z: -1.65, s: 1.35, tint: '#6a4630' });
    for (let i = 0; i < 5; i++) {
      const a = i * 1.26 + 0.3, rr = i === 4 ? 0 : 0.2, cx = -4.35 + Math.cos(a) * rr, cz = -1.65 + Math.sin(a) * rr, ry = a + 0.6;
      const half = new THREE.SphereGeometry(0.11, 12, 6, 0, TAU, PI / 2, PI / 2); half.scale(1, 0.62, 1.55);
      R.add('paint', half, M(cx, 0.17, cz, ry), '#7f9a4c');
      R.add('paint', geo.disc(0.106, 12).scale(1, 1, 1.55), M(cx, 0.172, cz, ry), '#ece3b0');
      R.add('paint', K.geo.slab(0.012, 0.004, 0.3, 0.001), M(cx, 0.175, cz, ry), '#cfd8a0');
    }
    R.block(-4.35, -1.65, 0.5, 0.5);
    A('kimjang', { x: -4.35, y: 0.45, z: -1.65 });

    // ---- the row of 장독 on a stone 단 in the middle, in the sun of the two 살창
    R.add('stone', K.geo.slab(4.7, 0.22, 1.95, 0.035), M(-0.3, 0.11, 1.25), '#b5ae9f');
    for (let i = 0; i < 9; i++) R.add('stone', K.geo.slab(0.9 + R.rnd() * 0.2, 0.02, 0.8 + R.rnd() * 0.15, 0.01), M(-2.2 + i * 0.48, 0.225, 0.8 + (i % 2) * 0.9, (R.rnd() - 0.5) * 0.2), '#c3bcae');
    R.block(-0.3, 1.25, 2.38, 0.99);
    const Y0 = 0.23;
    // 간장 독: open to the air — dark 간장 with 숯 and 고추 afloat; its lid rests on the 단 beside it
    const gx = -1.65, gz = 0.78;
    K.pot(R, { kind: 'dok', x: gx, y: Y0, z: gz, s: 1.0, tint: '#5e3b27' });
    R.add('lacquer', geo.disc(0.255, 20), M(gx, Y0 + 1.19, gz), '#1b0f08', { cast: false });
    R.add('paint', new THREE.DodecahedronGeometry(0.045, 0).scale(1.3, 0.6, 0.9), M(gx + 0.06, Y0 + 1.2, gz - 0.05, 0.4), '#1c1a19');
    for (const [dx, dz, a] of [[-0.1, 0.06, 0.3], [0.03, 0.12, 2.0], [-0.05, -0.1, 4.1]]) R.add('paint', K.geo.lathe([[0, 0], [0.013, 0.02], [0.017, 0.06], [0.013, 0.095], [0, 0.11]], 7).applyMatrix4(new THREE.Matrix4().makeRotationZ(PI / 2)), M(gx + dx, Y0 + 1.205, gz + dz, a), '#9d1d17');
    R.add('onggi', BK.lidGeometry(16, 0.3), M(gx - 0.66, Y0, gz - 0.18, 0, 1, 1, 1, PI), '#5a3925');
    A('jangdok', { x: gx + 0.1, y: 1.0, z: gz + 0.45 });
    // 된장 독 with the 금줄 (숯, 고추, 한지 버선본)
    const dx0 = 0.1, dz0 = 0.8;
    K.pot(R, { kind: 'jungduri', x: dx0, y: Y0, z: dz0, s: 1.0, lid: true, tint: '#634029' });
    const gj = K.geumjul(R, { x: dx0, y: Y0, z: dz0, kind: 'jungduri', s: 1.0 });
    A('geumjul', gj);
    K.pot(R, { kind: 'hangari', x: 1.55, y: Y0, z: 0.85, s: 0.95, lid: true, tint: '#6a4530' });
    // front row: 씨간장, 고추장, a small 단지
    K.pot(R, { kind: 'danji', x: -0.85, y: Y0, z: 1.78, s: 0.95, lid: true, tint: '#4f3121' });
    A('ssiganjang', { x: -0.85, y: 0.75, z: 2.05 });
    K.pot(R, { kind: 'hangari', x: 0.75, y: Y0, z: 1.8, s: 0.7, lid: true, tint: '#6d4632' });
    A('gochujang', { x: 0.75, y: 0.8, z: 2.1 });
    K.pot(R, { kind: 'danji', x: -2.15, y: Y0, z: 1.75, s: 0.78, lid: true, tint: '#664230' });
    // tags in front of the jars, turned a little to the door
    const tag = (title, sub, x, z, y = 0.5) => R.label(title, { x, y, z, rotY: 0.55, w: 0.5, h: 0.22, sub, style: 'paper' });
    tag('간장 독', '메주를 소금물에 담가요', gx + 0.25, gz + 0.43, 0.62);
    tag('된장 독', '장을 가르고 남은 건더기', dx0 + 0.3, dz0 + 0.48, 0.55);
    tag('씨간장', '해마다 이어 온 묵은 장', -0.85 + 0.2, 1.78 + 0.28, 0.46);
    tag('고추장', '메줏가루·찹쌀·고춧가루', 0.75 + 0.22, 1.8 + 0.26, 0.42);
    // 장 가르기 beside the 단: a basin of 된장, a 단지 of 간장, a dipper, on a straw mat
    K.floorMat(R, { x: -3.75, z: 1.6, w: 1.4, d: 1.0, tint: '#d6bc7c', border: '#5a4a3a' });
    K.pot(R, { kind: 'basin', x: -3.95, y: 0.012, z: 1.55, s: 0.9, tint: '#6a4630' });
    R.add('clay', K.pillow(0.46, 0.14, 0.4, 0.55, 0.5, 14), M(-3.95, 0.16, 1.55, 0.4), '#7b5434');
    R.add('clay', K.pillow(0.22, 0.09, 0.2, 0.6, 0.5, 10), M(-3.8, 0.23, 1.47, 1.2), '#86603d');
    K.pot(R, { kind: 'danji', x: -3.3, y: 0.012, z: 1.75, s: 0.62, tint: '#5a3a28' });
    R.add('lacquer', geo.disc(0.09, 14), M(-3.3, 0.27, 1.75), '#1b0f08', { cast: false });
    K.pot(R, { kind: 'bowl', x: -3.45, y: 0.012, z: 1.3, s: 1.3, tint: '#cdb47c' });
    R.block(-3.75, 1.6, 0.7, 0.5);
    A('jangareugi', { x: -3.75, y: 0.5, z: 1.6 });

    // ---- west: 식초 by the warm wall (it shares the 부엌's 아궁이), the cloth-covered 독, the salt 가마니 over its 간수 tub
    K.pot(R, { kind: 'hangari', x: -5.35, z: 2.55, s: 0.85, tint: '#6a4430' });
    K.cloth(R, { x: -5.35, y: 0.84 * 0.93, z: 2.55, w: 0.42, d: 0.42, drop: 0.12, tint: '#ded2b6' });
    R.add('straw', new THREE.TorusGeometry(0.235, 0.01, 4, 20).applyMatrix4(new THREE.Matrix4().makeRotationX(PI / 2)), M(-5.35, 0.7, 2.55), '#9a7a44');
    R.block(-5.35, 2.55, 0.36, 0.36);
    A('sikcho', { x: -4.95, y: 0.7, z: 2.55 });
    plate(R, 'W', 2.0, 1.42, '식초 항아리', '따뜻한 벽 옆에서 익어요', 0.62);
    K.pot(R, { kind: 'dok', x: -5.42, z: -0.05, s: 0.78, tint: '#5f3c28' });
    K.cloth(R, { x: -5.42, y: 1.25 * 0.78, z: -0.05, w: 0.52, d: 0.52, drop: 0.2, tint: '#e3d8c2' });
    R.add('straw', new THREE.TorusGeometry(0.27, 0.01, 4, 20).applyMatrix4(new THREE.Matrix4().makeRotationX(PI / 2)), M(-5.42, 0.86, -0.05), '#9a7a44');
    R.block(-5.42, -0.05, 0.36, 0.36);
    // the 간수 tub: a coopered tub with two iron hoops, two logs across it, a salt 가마니 on them
    const tx = -5.0, tz = 3.72;
    R.add('wood', K.geo.lathe([[0, 0], [0.3, 0], [0.33, 0.36], [0.315, 0.36], [0.285, 0.03], [0, 0.03]], 18), M(tx, 0, tz), '#8b6b4b');
    for (const y of [0.08, 0.28]) R.add('iron', new THREE.TorusGeometry(0.31 + y * 0.08, 0.008, 4, 18).applyMatrix4(new THREE.Matrix4().makeRotationX(PI / 2)), M(tx, y, tz), '#3a3a3c');
    R.add('lacquer', geo.disc(0.29, 18), M(tx, 0.22, tz), '#4d5a5c', { cast: false });
    for (const dz of [-0.14, 0.14]) R.add('wood', geo.tube(tx - 0.5, 0.39, tz + dz, tx + 0.5, 0.39, tz + dz, 0.035, 7), null, '#7e6046');
    K.gamani(R, M(tx, 0.6, tz, 0.15), { tint: '#e6dfcc' });
    R.block(tx, tz, 0.55, 0.42);
    R.label('소금 가마니', { x: tx + 0.62, y: 0.55, z: tz - 0.42, rotY: 2.72, w: 0.62, h: 0.22, sub: '쓴 간수를 빼서 장에 써요', style: 'paper' });

    // ---- the south wall: tools of the 장 — 됫박 and 깔때기 on a shelf (bay 3), 체 and 용수 on pegs (bay 1)
    const sh = R.shelfWall('S', 3, { levels: 1, slots: 3, y: 1.38, w: 1.9, d: 0.3 });
    K.doe(R, { x: sh[0].x, y: sh[0].y, z: sh[0].z, rotY: 0.3, fill: 'bean' });
    R.add('furn', K.geo.lathe([[0.012, 0], [0.016, 0.1], [0.09, 0.2], [0.086, 0.205], [0.01, 0.105], [0.008, 0]], 14), M(sh[1].x, sh[1].y + 0.205, sh[1].z, 0, 1, 1, 1, PI), '#8d6745', { wall: 'S' });
    K.pot(R, { kind: 'danji', x: sh[2].x, y: sh[2].y, z: sh[2].z, s: 0.42, lid: true, tint: '#5f3d2a', wall: 'S' });
    plate(R, 'S', 10.5, 1.92, '됫박 · 깔때기', '곡식을 되고, 장을 병에 부어요', 0.7);
    for (const u of [4.05, 4.95]) R.add('furn', geo.cyl(0.013, 0.013, 0.09, 6).applyMatrix4(new THREE.Matrix4().makeRotationX(PI / 2)), R.wm('S', u, 1.48, 0.045), '#5c3f28', { wall: 'S' });
    K.basket(R, { m: mul(R.wm('S', 4.05, 1.27, 0.045), M(0, 0, 0, 0, 1, 1, 1, PI / 2)), kind: 'sieve', r: 0.17, h: 0.07, wall: 'S' });
    R.add('basket', K.geo.lathe([[0, 0], [0.09, 0], [0.11, 0.05], [0.115, 0.52], [0.108, 0.52], [0.1, 0.06], [0, 0.03]], 14), R.wm('S', 4.95, 0.86, 0.14), '#c4a060', { wall: 'S' });
    R.add('cloth', geo.tube(0, 0, 0, 0, 0.1, -0.09, 0.004, 3), R.wm('S', 4.95, 1.38, 0.14), '#8a7656', { wall: 'S' });
    plate(R, 'S', 4.5, 0.55, '체 · 용수', '거르고, 맑은 장을 떠내요', 0.64);

    // ---- signs: 발효 at the door, 장 담그기 by the jars
    A('balhyo', R.signPost({ x: 3.95, z: -1.55, rotY: PI / 2, title: '발효', sub: '미생물이 맛을 바꿔요' }));
    A('yusan', R.signPost({ x: 2.6, z: 2.6, rotY: PI / 2 - 0.3, title: '장 담그기', sub: '유네스코 인류무형문화유산' }));

    // ---- boards: the 장 year as a wall calendar (S bay 0), 작은 일꾼 미생물 (W bay 1), and the player's own jars (E bay 0)
    wallBoard(ctx, R, 'S', 0, 'MG_JANG_YEAR', '장 담그기 열두 달');
    wallBoard(ctx, R, 'W', 1, 'MG_MICROBE', '작은 일꾼 미생물', { v: 1.72, h: 0.86, w: 1.52 });
    const jb = R.wp('E', 1.5, 1.55, 0.062);
    R.add('wood', K.geo.slab(1.24, 0.75, 0.05, 0.012), R.wm('E', 1.5, 1.55, 0.03), '#4a3020', { wall: 'E' });
    jarBoard(ctx, R, jb.x, jb.y, jb.z, -PI / 2);

    // ---- light: a 초롱 by the door, an oil lamp by the 누룩; dust in the two shafts
    lantern(ctx, R, 5.15, 2.12, -1.25, { top: R.roofY(-1.25) + 0.1 });
    K.deungjan(R, { x: 3.05, z: -3.25, h: 0.5, intensity: 3 });
    R.block(3.05, -3.25, 0.14, 0.14);
    K.dust(R, { count: 130 });
    R.finish();
    return {};
  }
  P.define({
    id: 'PL_BALHYO', name: '발효실', kidName: '발효실', emoji: '🫘', zoneId: 'ZONE_PL_BALHYO', color: '#b98f55',
    desc: '메주와 장이 익어 가는 서늘한 방이에요.',
    origin: { x: 200, z: 2000 }, size: { w: 12, d: 9, h: 3.4 }, floorY: 0, surface: 'stone',
    spawn: { x: 4.6, z: 0.35, rotY: -PI / 2 },
    door: doorBa ? { buildingId: 'B_HANOK4', x: doorBa.x, z: doorBa.z, label: '🚪 발효실 들어가기', kidLabel: '발효실 구경' } : undefined,
    exit: doorBa ? doorBa.exit : undefined,
    indoor: true, camera: { dist: 5.2, min: 2.4, max: 7.0, pitch: 0.15, pmin: -0.1, pmax: 0.8, ceil: 2.5 }, far: 150,
    exhibits: T_BALHYO,
    build: buildBalhyo,
  });

  // =========================================================================================== 곳간 PL_GOTGAN
  // the door outside stands to one side of the building's front (the middle keeps the old "곳간 열기" spot)
  const doorGo = P.doorOf('B_GOTGAN', { side: 1.8 });
  const ITEM_LOOK = {
    ITEM_BEAN: ['sack', '#d8c48d'], ITEM_PERILLA: ['sack', '#6e5d44'], ITEM_PEPPER: ['basket', '#b3241b', 'pepper'], ITEM_CABBAGE: ['basket', '#8fb05a', 'head'],
    ITEM_CORN: ['basket', '#dfae32', 'cob'], ITEM_RADISH: ['basket', '#efeee4', 'root'], ITEM_MINT: ['tray', '#5c9a52'], ITEM_LAVENDER: ['tray', '#8b78c4'],
    ITEM_ROSEMARY: ['tray', '#5e7d58'], ITEM_LEMONBALM: ['tray', '#87ad57'],
    ITEM_DOENJANG: ['jar', '#7a5232'], ITEM_GANJANG: ['jar', '#2b1a10'], ITEM_GOCHUJANG: ['jar', '#9b2a1c'], ITEM_KIMCHI: ['jar', '#c0482e'], ITEM_VINEGAR: ['jar', '#c9a65a'],
  };
  function lookOf(id, item) {
    if (ITEM_LOOK[id]) return ITEM_LOOK[id];
    let h = 0; for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return [item?.type === 'fermented' ? 'jar' : 'sack', `hsl(${h % 360},45%,55%)`];
  }
  /** "내 선반": a shelf that shows what the player's own 곳간 holds (G.sys.storage), rebuilt when it changes */
  function liveShelf(ctx, R, o) {
    const x = o.x, z = o.z, ry = o.rotY, w = 2.3, d = 0.5, h = 1.75, levels = 3;
    const lv = K.shelf(R, { x, z, rotY: ry, w, d, h, levels, back: true, tone: '#6a4630' });
    const bm = M(x, 0, z, ry), slots = [];
    for (let l = levels - 1; l >= 0; l--) for (let k = 0; k < 3; k++) { const p = new THREE.Vector3(-w / 2 + (w * (k + 0.5)) / 3, 0, 0.0).applyMatrix4(bm); slots.push({ x: p.x, y: lv[l].y, z: p.z, l, k }); }
    // the board over the shelf + one atlas texture for the title and the nine tags (redrawn when the 곳간 changes)
    R.add('wood', K.geo.slab(2.25, 0.34, 0.04, 0.01), mul(bm, M(0, h + 0.23, -d / 2 + 0.03)), '#4a3020');
    const AW = 1024, AH = 512, TH = 128, CW = AW / 3, CH = (AH - TH) / 3;
    const tex = G.gfx.canvasTexture(AW, AH, () => {}, { full: true });
    ctx.own(tex);
    const mt = new THREE.MeshBasicMaterial({ map: tex, color: 0xe9e4da, transparent: true, fog: false });
    ctx.own(mt);
    const quads = [];
    const quad = (w2, h2, m, u0, v0, u1, v1) => { const g = new THREE.PlaneGeometry(w2, h2); const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + (u1 - u0) * uv.getX(i), v0 + (v1 - v0) * uv.getY(i)); g.applyMatrix4(m); quads.push(g); };
    quad(2.12, 0.265, mul(bm, M(0, h + 0.23, -d / 2 + 0.052)), 0, 1 - TH / AH, 1, 1);
    slots.forEach((s, i) => {
      const r = Math.floor(i / 3), c = i % 3, u0 = c / 3, v1 = 1 - (TH + r * CH) / AH, v0 = v1 - CH / AH;
      const p = new THREE.Vector3(-w / 2 + (w * (c + 0.5)) / 3, Math.max(s.y - 0.06, 0.1), d / 2 + 0.012).applyMatrix4(bm);
      quad(0.52, 0.52 * (CH / CW), M(p.x, Math.max(s.y - 0.06, 0.1), p.z, ry), u0, v0, u0 + 1 / 3, v1);
    });
    const tags = new THREE.Mesh(ADDONS.BufferGeometryUtils.mergeGeometries(quads, false), mt);
    tags.name = 'room-shelf-tags'; tags.userData.guardSkip = true; tags.renderOrder = 2;
    R.addMesh(tags, null);
    const drawTags = (list, total, cap) => {
      const c = tex.image.getContext('2d');
      c.clearRect(0, 0, AW, AH);
      // the title
      c.fillStyle = '#3a2a1c'; c.fillRect(0, 0, AW, TH);
      c.strokeStyle = '#b08d4c'; c.lineWidth = 6; c.strokeRect(6, 6, AW - 12, TH - 12);
      c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillStyle = '#f0d9a0'; c.font = `800 54px ${FONT}`; c.fillText('내 선반 · 내 곳간에 든 것', AW / 2, TH * 0.4);
      c.fillStyle = '#d8c49a'; c.font = `600 30px ${FONT}`; c.fillText(list.length ? `모두 ${total}개 · 더 넣을 자리 ${Math.max(0, cap - total)}개` : '아직 비어 있어요 · 텃밭에서 거두면 여기에 쌓여요', AW / 2, TH * 0.78);
      list.forEach((it, i) => {
        if (i >= 9) return;
        const r = Math.floor(i / 3), cc = i % 3, x0 = cc * CW + 8, y0 = TH + r * CH + 8, cw2 = CW - 16, ch2 = CH - 16;
        roundRect(c, x0, y0, cw2, ch2, 18); c.fillStyle = '#f3ead3'; c.fill();
        c.lineWidth = 4; c.strokeStyle = 'rgba(90,60,30,.6)'; c.stroke();
        c.fillStyle = it.color; c.beginPath(); c.arc(x0 + 44, y0 + ch2 / 2, 26, 0, TAU); c.fill();
        c.strokeStyle = 'rgba(60,40,20,.5)'; c.lineWidth = 3; c.stroke();
        c.textAlign = 'left'; c.fillStyle = '#2e2218';
        let size = 44; c.font = `800 ${size}px ${FONT}`;
        while (c.measureText(it.name).width > cw2 - 96 && size > 22) { size -= 2; c.font = `800 ${size}px ${FONT}`; }
        c.fillText(it.name, x0 + 84, y0 + ch2 * 0.36);
        c.fillStyle = '#6a5136'; c.font = `700 34px ${FONT}`; c.fillText(`${it.qty}개`, x0 + 84, y0 + ch2 * 0.74);
      });
      tex.needsUpdate = true;
    };
    // the things on the shelf: one small bucket per rebuild (sacks, baskets, jars, heaps)
    let grp = null;
    const build = (list) => {
      if (grp) { grp.parent?.remove(grp); grp.traverse((q) => { if (q.geometry) q.geometry.dispose(); }); grp = null; }
      const Bk = new BK.Bucket(), rnd = G.util.rng('gotgan-shelf'), T = { add: (k, g, m, t) => Bk.add(k, g, m, K.tint(k, t)), rnd };
      list.slice(0, 9).forEach((it, i) => {
        const s = slots[i], q = Math.max(1, Math.min(1.25, 0.55 + Math.log10(1 + it.qty) * 0.4)), m = M(s.x, s.y, s.z, ry + (rnd() - 0.5) * 0.3);
        const kind = it.kind, colr = it.color, piece = it.piece;
        if (kind === 'jar') {
          K.pot(T, { m, kind: it.id === 'ITEM_KIMCHI' ? 'jungduri' : 'danji', s: 0.42 * q + 0.1, lid: true, tint: '#5e3b28' });
          T.add('paint', K.geo.slab(0.12, 0.08, 0.004, 0.001), mul(m, M(0, 0.16 * q, 0.13 * q + 0.03)), colr);   // a colour tag
        } else if (kind === 'sack') {
          T.add('cloth', K.pillow(0.34, 0.3 * q, 0.28, 0.5, 0.35, 14), mul(m, M(0, 0.15 * q, 0)), '#d6c9a8');
          T.add('cloth', new THREE.TorusGeometry(0.13, 0.03, 5, 14).applyMatrix4(new THREE.Matrix4().makeRotationX(PI / 2)), mul(m, M(0, 0.3 * q, 0)), '#cbbd99');
          T.add('paint', K.geo.lathe([[0.13, 0], [0.08, 0.05], [0, 0.07]], 12), mul(m, M(0, 0.3 * q - 0.01, 0)), colr);
        } else if (kind === 'tray') {
          T.add('basket', K.geo.lathe([[0, 0], [0.24, 0], [0.28, 0.05], [0.27, 0.055], [0.23, 0.01], [0, 0.01]], 16), m, '#c49a58');
          for (let k = 0; k < 6 + Math.round(q * 4); k++) { const g = K.geo.timber(0.22, 0.03, 0.03, 0.006); g.applyMatrix4(new THREE.Matrix4().makeRotationY(rnd() * PI)); T.add('paint', g, mul(m, M((rnd() - 0.5) * 0.25, 0.03 + k * 0.012, (rnd() - 0.5) * 0.2)), colr); }
        } else {   // a round basket with the crop piled in it
          K.basket(T, { m, r: 0.25, h: 0.16 });
          const n = 5 + Math.round(q * 6);
          for (let k = 0; k < n; k++) {
            const a = k * 2.39, rr = 0.06 + (k % 4) * 0.035, y = 0.1 + Math.floor(k / 5) * 0.06, pm = mul(m, M(Math.cos(a) * rr, y, Math.sin(a) * rr, a));
            if (piece === 'pepper') T.add('paint', K.geo.lathe([[0, 0], [0.016, 0.025], [0.02, 0.07], [0.015, 0.11], [0, 0.125]], 7).applyMatrix4(new THREE.Matrix4().makeRotationZ(PI / 2)), pm, colr);
            else if (piece === 'cob') T.add('paint', K.geo.lathe([[0, 0], [0.028, 0.02], [0.032, 0.1], [0.026, 0.18], [0, 0.19]], 8).applyMatrix4(new THREE.Matrix4().makeRotationZ(PI / 2)), pm, colr);
            else if (piece === 'root') { T.add('paint', K.geo.lathe([[0, 0], [0.03, 0.03], [0.04, 0.12], [0.034, 0.2], [0, 0.21]], 8).applyMatrix4(new THREE.Matrix4().makeRotationZ(PI / 2)), pm, colr); }
            else T.add('paint', new THREE.SphereGeometry(0.075, 9, 7).scale(1, 0.9, 1), mul(pm, M(0, 0.03, 0)), colr);
          }
        }
      });
      grp = new THREE.Group(); grp.name = 'room-shelf-items';
      const mats = {}; for (const k of Bk.parts.keys()) mats[k] = K.mat(k);
      const out = Bk.build(grp, { name: 'gotgan-shelf', materials: mats, shadows: false, ao: false });
      for (const k in out) { out[k].castShadow = !!R.shadows; out[k].receiveShadow = true; }
      ctx.group.add(grp);
    };
    let sig = '#', dirty = true, acc = 0;
    const refresh = () => {
      const S = G.sys.storage;
      let raw = [];
      try { raw = S?.list?.() || []; } catch (e) { raw = []; }
      const list = raw.filter((r) => r && r.qty > 0).sort((a, b) => b.qty - a.qty).map((r) => {
        const look = lookOf(r.id, r.item), c = new THREE.Color();
        try { c.setStyle(look[1]); } catch (e) { c.set('#c8b48a'); }
        return { id: r.id, qty: r.qty | 0, name: String(r.item?.name || r.id).slice(0, 10), kind: look[0], piece: look[2], color: '#' + c.getHexString() };
      });
      let total = 0, cap = 300;
      try { total = S?.total?.() | 0; cap = S?.cap?.() | 0 || 300; } catch (e) { /* keep */ }
      const s = list.map((r) => r.id + ':' + r.qty).join(',') + '|' + total + '/' + cap;
      if (s === sig) return;
      sig = s;
      drawTags(list, total, cap);
      build(list);
    };
    const off = G.bus.on('storage:changed', () => { dirty = true; });
    R.onUpdate((dt) => {
      acc += dt;
      if (dirty || acc > 2) { dirty = false; acc = 0; refresh(); }
    });
    refresh();
    // the way to the real 곳간 panel (put in, take out)
    ctx.interact({
      id: 'PL_GOTGAN:storage', kind: 'storage', label: '곳간 열기', kidLabel: '내 곳간 열기', emoji: '🏚️', radius: 2.6, priority: 0.3,
      position: (() => { const p = new THREE.Vector3(0, 1.0, d / 2 + 0.6).applyMatrix4(bm); return { x: p.x, y: 1.0, z: p.z }; })(),
      enabled: () => !!G.state && typeof G.sys.storage?.open === 'function',
      onInteract: () => { try { G.sys.storage.open(); } catch (e) { G.log.warn('UI', 'storage panel failed', e?.message || e); } },
    });
    return { dispose() { off(); }, anchor: new THREE.Vector3(0, 1.3, d / 2 + 0.15).applyMatrix4(bm) };
  }
  /** a small shard of an 옹기 wall on a stand: the glazed outside, the pale clay body at the broken edges */
  function onggiShard(R, x, y, z, ry) {
    const prof = [[0.36, 0.28], [0.4, 0.4], [0.415, 0.52], [0.405, 0.62]], al = 0.84, s = 0.9, t = 0.024;
    const m = mul(M(x, y + 0.05, z, ry), M(0, -0.28 * s, -0.4 * s, 0, s));
    R.add('onggi', new THREE.LatheGeometry(prof.map((p) => new THREE.Vector2(p[0], p[1])), 10, -al / 2, al), m, '#5a3a27');
    R.add('clay', new THREE.LatheGeometry(prof.slice().reverse().map((p) => new THREE.Vector2(p[0] - t, p[1])), 10, -al / 2, al), m, '#9a6a48');
    // the broken edges: the pale clay body between the two skins (a strip of quads seen from both sides)
    for (const a of [-al / 2, al / 2]) {
      const pos = [], idx = [], n = prof.length * 2;
      for (let c = 0; c < 2; c++) for (const p of prof) pos.push(Math.sin(a) * p[0], p[1], Math.cos(a) * p[0], Math.sin(a) * (p[0] - t), p[1], Math.cos(a) * (p[0] - t));
      for (let i = 0; i < prof.length - 1; i++) { const b = i * 2; idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2); idx.push(n + b, n + b + 2, n + b + 1, n + b + 1, n + b + 2, n + b + 3); }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
      g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((pos.length / 3) * 2), 2));
      R.add('clay', g, m, '#b07a52');
    }
    R.add('furn', K.geo.slab(0.24, 0.05, 0.14, 0.008), M(x, y + 0.025, z, ry), '#4e3220');
  }
  const REGION = {
    // 중부: a wide mouth, straight sides · 남부: a narrow mouth, broad shoulders · 경상: a round belly like a watermelon
    jungbu: [[0, 0], [0.2, 0], [0.24, 0.05], [0.32, 0.25], [0.36, 0.5], [0.37, 0.7], [0.35, 0.82], [0.33, 0.86], [0.35, 0.9], [0.34, 0.92], [0.3, 0.92], [0.29, 0.88]],
    nambu: [[0, 0], [0.14, 0], [0.18, 0.05], [0.3, 0.3], [0.42, 0.6], [0.44, 0.68], [0.38, 0.78], [0.24, 0.86], [0.18, 0.88], [0.19, 0.92], [0.17, 0.93], [0.15, 0.9]],
    gyeongsang: [[0, 0], [0.16, 0], [0.22, 0.05], [0.36, 0.2], [0.44, 0.42], [0.45, 0.52], [0.42, 0.66], [0.32, 0.8], [0.22, 0.86], [0.23, 0.9], [0.21, 0.92], [0.19, 0.89]],
  };
  function buildGotgan(ctx) {
    const R = K.room(ctx, {
      w: 10, d: 8, post: 2.5, ridge: 3.6, bays: { x: 4, z: 3 }, floor: 'maru', roof: 'rafters', tone: 'dark',
      walls: {
        N: ['board', 'board', 'board', 'board'],
        E: ['board', 'board', 'board'],
        S: ['board', { baraji: true, w: 1.0, h: 0.4, sill: 1.76, open: 0.9 }, { baraji: true, w: 1.0, h: 0.4, sill: 1.76, open: 0.9, label: '바람창', sub: '곡식이 눅지 않게 바람을 들여요' }, 'board'],
        W: ['board', { door: 'panel', exit: true, w: 1.6, h: 2.0 }, 'board'],
      },
      sun: { az: 165, el: 30 },
    });
    const A = (key, spot) => ctx.anchor(key, spot);

    // ---- N bay 0: a 시렁 with baskets and 채반 on two poles; 섬 and a grain 독 below
    const sx0 = -3.75, sy = 1.9;
    for (const n of [0.13, 0.42]) R.add('wood', geo.tube(-4.85, sy, -4 + n, -2.65, sy, -4 + n, 0.032, 8), null, '#8b6e50', { wall: 'N' });
    for (const x of [-4.7, -2.8]) {
      R.add('wood', K.geo.slab(0.06, 0.06, 0.5, 0.008), M(x, sy - 0.05, -3.74), '#6c4a30', { wall: 'N' });
      R.add('wood', K.geo.span(x, sy - 0.08, -3.55, x, sy - 0.42, -3.97, 0.045, 0.045, 0.005), null, '#6c4a30', { wall: 'N' });
    }
    K.basket(R, { x: -4.25, y: sy + 0.03, z: -3.73, r: 0.24, h: 0.2, wall: 'N' });
    K.nurukTray(R, { x: -3.6, y: sy + 0.04, z: -3.73, r: 0.3, n: 0 });
    K.basket(R, { x: -3.6, y: sy + 0.06, z: -3.73, r: 0.17, h: 0.13 });
    K.basket(R, { x: -3.05, y: sy + 0.03, z: -3.73, r: 0.2, h: 0.24 });
    K.seom(R, { x: -4.45, z: -3.5, s: 0.95, rotY: 0.3 });
    K.seom(R, { x: -3.8, z: -3.55, s: 0.9, rotY: -0.4 });
    K.pot(R, { kind: 'dok', x: -3.05, z: -3.45, s: 0.82, tint: '#5f3d29' });
    R.add('paint', geo.disc(0.245, 18), M(-3.05, 0.97, -3.45), '#efe7d0', { cast: false });
    K.doe(R, { x: -3.0, y: 0.975, z: -3.42, rotY: 0.4, fill: 'rice' });
    R.block(-3.75, -3.5, 1.1, 0.42);
    plate(R, 'N', 1.25, 1.42, '섬 · 독', '볏섬과 곡식 독', 0.5);

    // ---- N bay 1: the 뒤주 with a 됫박 on its lid
    const dw = K.dwiju(R, { x: -1.25, z: -3.6, w: 1.0, d: 0.64, h: 0.95 });
    K.doe(R, { x: -1.45, y: dw.top - 0.03, z: -3.5, rotY: 0.2, fill: 'rice' });
    R.block(-1.25, -3.6, 0.53, 0.35);
    A('dwiju', { x: -1.25, y: dw.top + 0.1, z: -3.15 });
    plate(R, 'N', 3.75, 1.55, '뒤주', '쌀을 넣어 두는 나무 궤', 0.56);

    // ---- N bay 2: the 절기 board, potatoes and corn below (정선의 농사)
    wallBoard(ctx, R, 'N', 2, 'MG_JEOLGI', '24절기 해시계', { v: 1.66 });
    A('jeolgi', R.wp('N', 6.25, 1.25, 0.6));
    K.basket(R, { x: 0.85, z: -3.45, r: 0.33, h: 0.2 });
    for (let i = 0; i < 12; i++) { const a = i * 2.39, rr = 0.05 + (i % 4) * 0.055; R.add('paint', new THREE.SphereGeometry(0.055, 8, 6).scale(1.25, 0.85, 1), M(0.85 + Math.cos(a) * rr, 0.13 + Math.floor(i / 6) * 0.05, -3.45 + Math.sin(a) * rr, a), i % 3 ? '#b8915c' : '#a98552'); }
    for (let i = 0; i < 5; i++) R.add('paint', K.geo.lathe([[0, 0], [0.03, 0.02], [0.034, 0.1], [0.028, 0.19], [0, 0.2]], 8).applyMatrix4(new THREE.Matrix4().makeRotationZ(PI / 2)), M(1.55 + (i % 3) * 0.07, 0.035 + Math.floor(i / 3) * 0.06, -3.5 + (i % 2) * 0.09, 0.3 + i * 0.4), i % 2 ? '#dba932' : '#cf9e2b');
    R.block(1.15, -3.48, 0.65, 0.36);
    A('gamja', { x: 1.15, y: 0.5, z: -3.15 });
    plate(R, 'N', 6.25, 0.82, '감자 · 옥수수', '정선 산골에서 잘 자라요', 0.6);

    // ---- N bay 3: farm tools on the wall, each with its name plate
    const tools = [['homi', 2.95, 1.62, '호미', '김매는 작은 연장'], ['nat', 3.5, 1.62, '낫', '풀과 벼를 베요'], ['soeseurang', 4.08, 1.95, '쇠스랑', '흙을 고르는 쇠갈퀴'], ['dorikkae', 4.62, 2.02, '도리깨', '이삭을 두드려 떨어요']];
    for (const [kind, x, v, title, sub] of tools) {
      K.farmTool(R, kind, R.wm('N', x + 5, v, 0.02), { wall: 'N' });
      plate(R, 'N', x + 5, 0.42, title, sub, 0.5);
    }

    // ---- E bay 0: the 가마니 stack (a rolled 멍석 on top)
    const gs = K.gamaniStack(R, { x: 4.35, z: -2.65, rotY: PI / 2, rows: [3, 2, 1] });
    K.meongseok(R, { x: 4.3, y: gs.top - 0.02, z: -2.65, rotY: PI / 2, len: 1.3, r: 0.16 });
    R.block(4.35, -2.65, 0.52, 0.93);
    A('gamani', { x: 3.75, y: 0.9, z: -2.65 });

    // ---- E bay 1: 내 선반 — the player's own 곳간
    const live = liveShelf(ctx, R, { x: 4.7, z: 0.0, rotY: -PI / 2 });
    R.block(4.7, 0.0, 0.28, 1.18);

    // ---- E bay 2: the 대저울 with 되 and 말 on a table below, the 멍석 standing in the corner
    K.jeoul(R, R.wm('E', 6.65, 2.02, 0.02), { wall: 'E' });
    const jt = K.table(R, { x: 4.72, z: 2.55, rotY: -PI / 2, w: 0.95, d: 0.5, h: 0.55, tone: '#6e4a30' });
    K.doe(R, { x: 4.72, y: jt.top, z: 2.33, rotY: 0.3, fill: 'bean' });
    K.doe(R, { x: 4.72, y: jt.top, z: 2.78, kind: 'mal', fill: 'barley' });
    R.block(4.72, 2.55, 0.28, 0.5);
    plate(R, 'E', 6.65, 0.95, '저울 · 되 · 말', '곡식을 달고 되어요', 0.66);
    K.meongseok(R, { x: 4.5, z: 3.55, upright: true, len: 1.6, r: 0.22 });
    R.block(4.5, 3.55, 0.25, 0.25);

    // ---- the middle: a 멍석 spread with red peppers drying, right where the sun shafts fall
    K.floorMat(R, { x: 0.3, z: 0.55, w: 2.6, d: 1.8, tint: '#d6bc7c', border: false });
    const pep = K.geo.lathe([[0, 0], [0.014, 0.022], [0.018, 0.065], [0.014, 0.1], [0, 0.115]], 7);
    for (let i = 0; i < 64; i++) {
      const g = pep.clone(); g.applyMatrix4(new THREE.Matrix4().makeRotationZ(PI / 2));
      R.add('paint', g, M(0.3 + (R.rnd() - 0.5) * 2.2, 0.03, 0.55 + (R.rnd() - 0.5) * 1.45, R.rnd() * TAU), R.rnd() < 0.35 ? '#8a1712' : R.rnd() < 0.5 ? '#a8241a' : '#b52a1d', { cast: false });
    }
    pep.dispose();
    R.label('고추 말리기', { x: 0.3, y: 0.08, z: 1.62, rotY: 0, tilt: -1.1, w: 0.62, h: 0.2, sub: '멍석에 펴서 볕에 말려요', style: 'paper' });

    // ---- S bay 0: 옹기가 숨 쉬는 원리 + an 옹기 shard; S bay 1: seed corn and dried herbs on a pole (in the sun shaft);
    //      S bay 2: the 장독대 model; S bay 3: 고장마다 다른 옹기 + three shapes
    wallBoard(ctx, R, 'S', 0, 'MG_ONGGI_BREATH', '옹기가 숨 쉬는 원리', { v: 1.62 });
    const st = K.table(R, { x: 3.65, z: 3.6, w: 0.8, d: 0.42, h: 0.62, tone: '#6e4a30' });
    onggiShard(R, 3.65, st.top, 3.6, PI + 0.4);
    R.block(3.65, 3.6, 0.42, 0.23);
    A('onggi', { x: 3.65, y: st.top + 0.25, z: 3.2 });
    R.label('옹기 조각', { x: 3.65, y: st.top - 0.1, z: 3.6 - 0.225, rotY: PI, w: 0.42, h: 0.19, sub: '벽 속 작은 숨구멍', style: 'paper' });
    // the pole of strings (S bay 1, under the shaft of the 바람창)
    const pz = 3.32, py = 2.2;
    R.add('wood', geo.tube(2.25, py, pz, 0.15, py, pz, 0.028, 8), null, '#8b6e50');
    for (const x of [2.1, 0.3]) R.add('straw', geo.tube(x, py, pz, x, R.roofY(pz) + 0.06, pz, 0.008, 4), null, '#a98a4f');
    const Sa = K.sway(R, { x: 1.2, y: py, z: pz, amp: 0.045, speed: 0.46, axis: 'x' }), Sb = K.sway(R, { x: 1.2, y: py, z: pz, amp: 0.04, speed: 0.6, axis: 'x' });
    K.corn(Sa, { x: 2.0, y: py - 0.02, z: pz }); K.herbs(Sb, { x: 1.62, y: py - 0.02, z: pz, tint: '#6f7346' });
    K.corn(Sa, { x: 1.25, y: py - 0.02, z: pz }); K.herbs(Sb, { x: 0.88, y: py - 0.02, z: pz, tint: '#5f6a3c', len: 0.42 });
    K.corn(Sa, { x: 0.5, y: py - 0.02, z: pz }); K.herbs(Sb, { x: 0.25, y: py - 0.02, z: pz, tint: '#566238', len: 0.4 });
    Sa.done(); Sb.done();
    A('gondeure', { x: 0.55, y: 1.55, z: pz - 0.3 });
    R.label('곤드레 · 씨옥수수', { x: 1.2, y: 1.5, z: 3.85, rotY: PI, w: 0.78, h: 0.24, sub: '말린 나물과 내년에 심을 씨', style: 'paper' });
    // the 장독대 model: a low stone 단, big jars at the back, small ones in front
    const mt2 = K.table(R, { x: -1.25, z: 3.55, w: 1.2, d: 0.6, h: 0.5, tone: '#6e4a30' });
    R.add('stone', K.geo.slab(1.05, 0.06, 0.48, 0.012), M(-1.25, mt2.top + 0.03, 3.55), '#b5ae9f');
    const ty = mt2.top + 0.06;
    [['dok', -1.6, 3.42, 0.24], ['dok', -1.25, 3.42, 0.25], ['jungduri', -0.9, 3.42, 0.23], ['hangari', -1.68, 3.66, 0.18], ['danji', -1.42, 3.68, 0.22], ['hangari', -1.12, 3.67, 0.17], ['danji', -0.84, 3.68, 0.2]].forEach(([kind, x, z, s]) => K.pot(R, { kind, x, y: ty, z, s, lid: true, tint: '#5c3a27', seg: 12 }));
    R.block(-1.25, 3.55, 0.62, 0.32);
    A('jangdokdae', { x: -1.25, y: ty + 0.35, z: 3.2 });
    plate(R, 'S', 6.25, 1.05, '장독대 모형', '큰 독은 뒤, 작은 독은 앞', 0.6);
    // 고장마다 다른 옹기
    wallBoard(ctx, R, 'S', 3, 'MG_ONGGI_REGION', '고장마다 다른 옹기', { v: 1.62 });
    const rb = K.table(R, { x: -3.75, z: 3.6, w: 1.5, d: 0.42, h: 0.4, tone: '#6e4a30' });
    [['jungbu', -4.25, '중부'], ['nambu', -3.75, '남부'], ['gyeongsang', -3.25, '경상도']].forEach(([k, x, name]) => {
      R.add('onggi', K.geo.lathe(REGION[k], 16), M(x, rb.top, 3.6, 0, 0.42), '#5e3c28');
      R.label(name, { x, y: rb.top - 0.12, z: 3.6 - 0.215, rotY: PI, w: 0.3, h: 0.11, style: 'paper' });
    });
    R.block(-3.75, 3.6, 0.77, 0.23);
    A('onggi_region', { x: -3.75, y: rb.top + 0.35, z: 3.2 });

    // ---- light: a 초롱 by the door; dust in the two shafts
    lantern(ctx, R, -4.35, 2.1, 1.3, { top: R.roofY(1.3) + 0.1 });
    K.dust(R, { count: 120 });
    R.finish();
    return { dispose() { live.dispose(); } };
  }
  P.define({
    id: 'PL_GOTGAN', name: '곳간', kidName: '곳간', emoji: '🌾', zoneId: 'ZONE_PL_GOTGAN', color: '#d8b672',
    desc: '곡식과 옹기, 농기구를 넣어 두는 곳간이에요. 내 곳간에 든 것도 보여요.',
    origin: { x: 400, z: 2000 }, size: { w: 10, d: 8, h: 3.6 }, floorY: 0, surface: 'wood',
    spawn: { x: -3.6, z: 0.1, rotY: PI / 2 },
    door: doorGo ? { buildingId: 'B_GOTGAN', x: doorGo.x, z: doorGo.z, label: '🚪 곳간 안 들어가기', kidLabel: '곳간 구경' } : undefined,
    exit: doorGo ? doorGo.exit : undefined,
    indoor: true, camera: { dist: 5.0, min: 2.4, max: 6.6, pitch: 0.16, pmin: -0.1, pmax: 0.8, ceil: 2.4 }, far: 150,
    exhibits: T_GOTGAN,
    build: buildGotgan,
  });
})();
