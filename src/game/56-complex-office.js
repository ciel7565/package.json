// =============================================================================
// 56-complex-office.js — the insides of 만장대 단지 (CONTRACT §16.4 / §16.5 / §16.8 / §17.3 "In the rooms" / §17.9, lane
// complex2): three rooms built with the hanok kit (19-hanok-kit.js) like the reference room 27-interiors-a.js.
//
//  PL_OFFICE   만장대 본관 로비 (분양 안내소) — origin (600, 2000), 22 × 14 × 6.5. Entered through the main building's doors
//              (CX_MAIN_DOOR / CX_MAIN_SIDE_DOOR of 54-complex-main.js). A grand timber hall on a granite floor: in the
//              middle the TABLE-TOP MODEL of the complex — the site plan drawn by G.data.complex.draw on the table with
//              every one of the 10,000 units coloured by its live state (G.sys.allot.mapState(): 빈 자리 / 신청 중 /
//              분양됨 / 쉬는 자리 / 내 것; redrawn on allot:map and allot:mine) and small models of the buildings, the
//              circle wall and the forest on it; a stand with the live counts; the ALLOTMENT YEAR on the north wall
//              (담그기 → 가르기 → 익히기 → 받는 날 with this month marked, Korean time from G.env.kst); the 분양 안내 DESK
//              (CX_OFFICE_DESK → G.sys.allot.open()) before a 병풍; the 안내소 exhibit cards of 48-interior-data.js
//              (anchors manjangdae · bunyang · year_damgeugi · year_gareugi · year_ikhigi · year_batneun · gujwa · bohoja);
//              a lecture screen (G.hanok.lectureScreen → G.sys.lecture.screen); great jars, benches, lamps.
//  PL_WORKSHOP 옹기 공방 — origin (1800, 2000), 14 × 10 × 4.2 (the door of B_WORKSHOP, CX_WORKSHOP_DOOR of 55): an earth-
//              floored workshop under smoke-dark rafters — a kick wheel with a jar half thrown, the 도개 and 수레 on a
//              stool, drying shelves of raw jars, glaze tubs (잿물) with ash and 약토 sacks, a clay heap under a wet cloth,
//              finished jars, the mouth of the kiln glowing in the north wall (fire), dust in the light; a motion board
//              (옹기가 숨 쉬는 원리) and a lecture screen. Cards: heuk · mulle · tarim · geonjo · jaetmul · gama · muni · sum.
//  PL_CAFE     카페 · 체험 맛집 — origin (2000, 2000), 16 × 11 × 3.8 (the door of B_CAFE, CX_CAFE_DOOR of 55): a warm
//              wooden café — the counter with tea things and a 식혜 jar, the menu board (no prices), low tables with
//              cushions and high tables with stools, the TASTING BOARD of fermented foods as exhibits (doenjang · ganjang ·
//              gochujang · cheonggukjang · kimchi · jangajji · sikhye · sikcho), strings of dried peppers, steam from the
//              kettle, a lecture screen.
// The exhibit cards of the workshop and the café are added to G.data.exhibits here when 48-interior-data.js does not
// carry them yet (ids HX_WS_* / HX_CF_*; the content lane may take them over unchanged), with two rooms for the 도감.
//
// A PLACE INSIDE A PLACE: the three are entered from PL_ALLOT. canEnter() remembers which door the visitor used (the door
// spot nearest to the player in PL_ALLOT); exitTo() leads the way out back into PL_ALLOT at that door (18-places.js'
// [myroom] hooks). An explicit destination (exit({ to })) is honoured. `exit` (what a save made inside stores) is the
// way out of PL_ALLOT itself (the valley's shuttle stop), so a load always resumes safely outside.
// =============================================================================
(function () {
  const P = G.sys.places, K = G.hanok, BK = G.bkit;
  if (!P || !K || !BK || typeof K.room !== 'function') { G.log.warn('WORLD', 'complex-office: places / hanok kit missing — no lobby, workshop or café'); return; }
  const PI = Math.PI, TAU = PI * 2;
  const M = BK.M, geo = BK.geo;
  const FONT = BK.FONT || '"PretendardEmbed","Pretendard","Noto Sans KR","Apple SD Gothic Neo","Malgun Gothic",sans-serif';
  const fin = Number.isFinite;
  const num = (v, d) => (fin(Number(v)) && v != null ? Number(v) : d);
  const easyOn = () => (G.easy ? !!G.easy.on : G.settings?.easyMode !== false);
  const has = (name) => typeof K[name] === 'function';
  const toast = (msg, o) => { try { G.ui?.toast?.(msg, o); } catch (e) { /* ui optional */ } };
  const say = (t, o) => { try { G.easy?.say?.(t, o); } catch (e) { /* voice optional */ } };

  // ================================================================ exhibit cards of the workshop and the café
  {
    const X = (G.data.exhibits = G.data.exhibits || {});
    const ENC = 'https://encykorea.aks.ac.kr/Article/', FOLK = 'https://folkency.nfm.go.kr/topic/';
    const enc = (id, name) => ({ label: `한국민족문화대백과사전 「${name}」`, url: ENC + id });
    const folk = (path, name) => ({ label: `한국민속대백과사전 「${name}」`, url: FOLK + path });
    const ONGGI = enc('E0038898', '옹기'), ONGGI_F = folk('옹기', '옹기');
    const add = (place, id, anchor, emoji, title, kid, detail, sources, extra) => {
      if (X[id]) return;
      X[id] = Object.assign({ id, place, anchor, title, emoji, kid, detail, sources, confidence: 'medium' }, extra || {});
    };
    add('PL_WORKSHOP', 'HX_WS_HEUK', 'heuk', '🟤', '옹기 흙',
      '옹기는 찰기 있는 흙을 반죽해서 빚어요.',
      '옹기를 빚을 흙은 물에 풀어 돌과 모래를 가라앉히고 고운 흙만 걸러 써요. 반죽을 밟고 두드려 속의 공기를 빼야 구울 때 금이 가지 않아요.',
      [ONGGI, ONGGI_F]);
    add('PL_WORKSHOP', 'HX_WS_MULLE', 'mulle', '⚙️', '발 물레',
      '발로 물레를 돌리며 흙을 쌓아 올려요.',
      '옹기 장인은 발로 물레를 돌리면서 그 위에 흙을 쌓아 모양을 잡아요. 큰 독은 흙을 가래떡처럼 길게 밀어 한 바퀴씩 쌓아 올리는 방법으로 만들어요.',
      [ONGGI, folk('물레', '물레')]);
    add('PL_WORKSHOP', 'HX_WS_TARIM', 'tarim', '🔨', '도개와 수레',
      '안쪽은 도개로 받치고 바깥은 두드려요.',
      '쌓아 올린 흙벽은 안쪽에 도개를 대고 바깥을 수레라는 방망이로 두드려 얇고 단단하게 만들어요. 두드리면 흙 알갱이가 촘촘해져 옹기가 튼튼해져요.',
      [ONGGI, ONGGI_F]);
    add('PL_WORKSHOP', 'HX_WS_GEONJO', 'geonjo', '🌬️', '그늘에서 말리기',
      '빚은 옹기는 그늘에서 천천히 말려요.',
      '갓 빚은 옹기를 햇볕에 바로 두면 겉만 빨리 말라 갈라질 수 있어요. 그래서 바람이 잘 통하는 그늘에서 여러 날 천천히 말린 뒤에 잿물을 입혀요.',
      [ONGGI]);
    add('PL_WORKSHOP', 'HX_WS_JAETMUL', 'jaetmul', '🪣', '잿물',
      '나뭇재와 약토를 섞은 잿물을 입혀요.',
      '옹기에 입히는 유약을 잿물이라고 해요. 나무를 태운 재와 약토라는 흙을 물에 풀어 만들고, 구우면 옹기 겉이 반들반들한 짙은 갈색이 돼요.',
      [ONGGI, folk('잿물', '잿물')]);
    add('PL_WORKSHOP', 'HX_WS_GAMA', 'gama', '🔥', '오름가마',
      '비탈을 따라 칸칸이 올라가는 가마예요.',
      '옹기는 산비탈에 길게 지은 오름가마에서 구워요. 아래 아궁이에서 불을 때면 뜨거운 기운이 위 칸으로 올라가고, 옆구멍으로 나무를 더 넣으며 여러 날 구워요.',
      [ONGGI, ONGGI_F]);
    add('PL_WORKSHOP', 'HX_WS_MUNI', 'muni', '〰️', '손으로 그린 무늬',
      '손가락으로 쓱쓱 그린 무늬가 있어요.',
      '잿물을 입히고 마르기 전에 손가락으로 풀잎이나 물결 같은 무늬를 그려요. 그래서 옹기마다 만든 사람의 손길이 조금씩 달라요.',
      [ONGGI]);
    add('PL_WORKSHOP', 'HX_WS_SUM', 'sum', '🫧', '숨 쉬는 옹기',
      '옹기 벽에는 아주 작은 숨구멍이 있어요.',
      '옹기를 구우면 흙 속에 아주 작은 구멍이 생겨 공기가 조금씩 드나들어요. 그래서 장과 김치가 옹기 속에서 알맞게 익는다고 해요.',
      [ONGGI], { motion: 'MG_ONGGI_BREATH' });
    const JANG = folk('detail/4784', '장 담그기');
    add('PL_CAFE', 'HX_CF_DOENJANG', 'doenjang', '🟫', '된장',
      '장을 가르고 남은 건더기를 익힌 장이에요.',
      '장을 담그고 40~60일쯤 지나 장을 가르면 건더기는 된장이 되고 국물은 간장이 돼요. 된장은 항아리에서 오래 익을수록 맛이 깊어져요.',
      [JANG, folk('된장', '된장')], { motion: 'MG_JANG_YEAR' });
    add('PL_CAFE', 'HX_CF_GANJANG', 'ganjang', '🫗', '간장',
      '장을 가를 때 떠낸 국물이 간장이 돼요.',
      '간장은 메주를 담근 소금물을 장 가르기 때 떠낸 것이에요. 해가 갈수록 색이 짙어지고 맛이 깊어져요.',
      [folk('detail/7299', '간장'), JANG]);
    add('PL_CAFE', 'HX_CF_GOCHUJANG', 'gochujang', '🌶️', '고추장',
      '곡식과 메줏가루, 고춧가루로 만든 장!',
      '고추장은 찹쌀이나 보리 같은 곡식을 엿기름으로 삭히고, 메줏가루와 고춧가루, 소금을 섞어 익혀요. 달고 맵고 짭짤한 맛이 함께 나요.',
      [enc('E0004012', '고추장')]);
    add('PL_CAFE', 'HX_CF_CHEONGGUKJANG', 'cheonggukjang', '🫘', '청국장',
      '삶은 콩을 따뜻한 곳에서 이삼일 띄워요.',
      '청국장은 삶은 콩을 볏짚과 함께 따뜻한 곳에 두어 2~3일 띄워 만들어요. 볏짚에 사는 고초균이 콩을 발효시키면 끈끈한 실이 생겨요.',
      [folk('청국장', '청국장')], { motion: 'MG_MICROBE' });
    add('PL_CAFE', 'HX_CF_KIMCHI', 'kimchi', '🥬', '김치',
      '절인 채소에 양념을 버무려 익혀요.',
      '김치는 소금에 절인 채소에 고춧가루, 마늘, 젓갈 같은 양념을 버무려 익혀요. 유산균이 늘어나며 새콤해져요. 겨울을 나려고 늦가을에 한꺼번에 담그는 일을 김장이라고 해요.',
      [folk('김치', '김치'), folk('김장', '김장')], { motion: 'MG_MICROBE' });
    add('PL_CAFE', 'HX_CF_JANGAJJI', 'jangajji', '🥒', '장아찌',
      '채소를 장에 담가 오래 두고 먹어요.',
      '장아찌는 무, 오이, 깻잎 같은 채소를 간장이나 된장, 고추장에 박거나 담가 오래 두고 먹는 음식이에요. 제철 채소를 오래 먹으려는 지혜가 담겨 있어요.',
      [enc('E0048641', '장아찌')]);
    add('PL_CAFE', 'HX_CF_SIKHYE', 'sikhye', '🍚', '식혜',
      '엿기름 물에 밥을 삭힌 달콤한 음료!',
      '식혜는 엿기름을 우린 물에 밥을 넣고 따뜻하게 두어 삭혀요. 엿기름 속 효소가 밥의 녹말을 단맛으로 바꿔서 설탕을 많이 넣지 않아도 달아요.',
      [folk('식혜', '식혜'), folk('엿기름', '엿기름')]);
    add('PL_CAFE', 'HX_CF_SIKCHO', 'sikcho', '🍶', '식초',
      '한 번 더 발효하면 새콤한 식초가 돼요.',
      '전통 식초는 곡식이나 과일로 빚은 술을 초산균이 한 번 더 발효시켜 만들어요. 옛날에는 부뚜막 옆에 초두루미라는 항아리를 두고 식초를 길렀대요.',
      [folk('detail/7823', '식초')], { motion: 'MG_MICROBE' });
    const rooms = (G.data.exhibitRooms = G.data.exhibitRooms || []);
    if (!rooms.some((r) => r.id === 'PL_WORKSHOP')) rooms.push({ id: 'PL_WORKSHOP', name: '옹기 공방', emoji: '⚱️', kid: '옹기를 빚고 굽는 곳이에요.', motions: ['MG_ONGGI_BREATH', 'MG_ONGGI_REGION'].filter((m) => !G.data.motions || G.data.motions[m]) });
    if (!rooms.some((r) => r.id === 'PL_CAFE')) rooms.push({ id: 'PL_CAFE', name: '카페 · 체험 맛집', emoji: '☕', kid: '발효 음식을 맛보며 알아봐요.', motions: ['MG_MICROBE', 'MG_JANG_YEAR'].filter((m) => !G.data.motions || G.data.motions[m]) });
  }
  /** the fallback list for a room (shown only while 49-exhibits.js is not in the build) */
  const topicsOf = (place) => Object.values(G.data.exhibits || {}).filter((e) => e && e.place === place).map((e) => ({ id: e.id, anchor: e.anchor, title: e.title, emoji: e.emoji, kid: e.kid, detail: e.detail }));

  // ================================================================ the way back out into PL_ALLOT
  const CXP = () => G.data.complex || null;
  /** the spots in front of a building's doors, in PL_ALLOT local metres, facing out */
  function doorSpots(id) {
    const C = CXP(), out = [];
    if (!C) return out;
    if (id === 'PL_OFFICE') {
      const cm = G.complexMain && G.complexMain.built ? G.complexMain : null;
      const main = C.door || C.byId?.('B_MAIN')?.door;
      if (cm && cm.door && fin(cm.door.x)) out.push({ x: cm.door.x - 1.6, z: cm.door.z, rotY: -PI / 2 });
      else if (main && fin(main.x)) { const r = num(main.rot, -PI / 2); out.push({ x: main.x + Math.sin(r) * 3.4, z: main.z + Math.cos(r) * 3.4, rotY: r }); }
      if (cm && cm.sideDoor && fin(cm.sideDoor.x)) out.push({ x: cm.sideDoor.x, z: cm.sideDoor.z, rotY: 0 });
    } else {
      const b = C.byId?.(id === 'PL_CAFE' ? 'B_CAFE' : 'B_WORKSHOP');
      if (b) { const d = b.door || { x: b.x, z: b.z + b.d / 2, rot: 0 }, r = num(d.rot, 0); out.push({ x: d.x + Math.sin(r) * 1.7, z: d.z + Math.cos(r) * 1.7, rotY: r }); }
    }
    return out;
  }
  const back = {};
  /** canEnter hook: remember the door the visitor came through (the spot nearest to them in PL_ALLOT) */
  function remember(id, opts) {
    back[id] = null;
    if (opts && opts.quiet) return true;
    if (P.current !== 'PL_ALLOT') return true;
    const pl = G.sys.player, loc = pl && pl.position ? P.toLocal(pl.position.x, pl.position.z) : null;
    const spots = doorSpots(id);
    if (!loc || !spots.length) return true;
    let best = spots[0], bd = Infinity;
    for (const s of spots) { const d = Math.hypot(s.x - loc.x, s.z - loc.z); if (d < bd) { bd = d; best = s; } }
    back[id] = best;
    return true;
  }
  /** exitTo hook: back into PL_ALLOT in front of the door the visitor came through (an explicit destination wins; a
   *  visitor who came another way — the 가기 picture menu from the valley — leaves to the place's own exit) */
  function exitTo(id, opts) {
    if (opts && opts.to) return null;
    const spot = back[id] || null;
    back[id] = null;
    if (!spot || !P.def('PL_ALLOT')) return null;
    return { place: 'PL_ALLOT', spawn: { x: spot.x, z: spot.z, rotY: spot.rotY } };
  }

  // ================================================================ shared bits of the three rooms
  function lectureScreen(R, ctx, o) {
    if (has('lectureScreen')) return K.lectureScreen(R, ctx, o);
    try { const p = R.wp(o.side, o.u, o.v, o.n || 0.07); const obj = G.sys.lecture?.screen?.(ctx, { x: p.x, y: p.y, z: p.z, rotY: { N: 0, E: -PI / 2, S: PI, W: PI / 2 }[o.side], w: o.w, h: o.h || o.w * 9 / 16 }); if (obj && obj.isObject3D && !obj.parent) ctx.group.add(obj); return obj; } catch (e) { return null; }
  }
  /** a canvas board (own texture + material) on a wall or a stand → { mesh, redraw() } */
  function canvasBoard(R, ctx, o) {
    const cw = o.cw || 1024, chh = o.ch || 512;
    const cv = document.createElement('canvas'); cv.width = cw; cv.height = chh;
    const c2 = cv.getContext('2d');
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = ctx.low ? 1 : 4;
    ctx.own(tex);
    const mat = ctx.low ? new THREE.MeshLambertMaterial({ map: tex }) : new THREE.MeshStandardMaterial({ map: tex, roughness: 0.82, metalness: 0 });
    ctx.own(mat);
    const g = o.geometry || new THREE.PlaneGeometry(o.w, o.h);
    const mesh = new THREE.Mesh(g, mat);
    mesh.name = o.name || 'cx-board'; mesh.receiveShadow = true; mesh.userData.guardSkip = true;
    if (o.matrix) { mesh.matrixAutoUpdate = false; mesh.matrix.copy(o.matrix); mesh.matrixWorldNeedsUpdate = true; }
    R.addMesh(mesh, o.wall || null);
    const redraw = () => { if (!c2) return; try { o.draw(c2, cw, chh); tex.needsUpdate = true; } catch (e) { G.log.warn('WORLD', `${ctx.id}: board drawing failed`, e?.message || e); } };
    redraw();
    return { mesh, redraw };
  }
  const rrect = (c, x, y, w, h, r) => { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); };
  const listen = (ctx, name, fn) => { G.bus.on(name, fn); return () => { try { G.bus.off?.(name, fn); } catch (e) { /* bus gone */ } }; };
  const kst = () => { try { const k = G.env?.kst?.(); if (k && fin(k.y) && fin(k.mo)) return k; } catch (e) { /* env optional */ } const d = new Date(); return { y: d.getFullYear(), mo: d.getMonth() + 1, d: d.getDate() }; };

  // ================================================================ PL_OFFICE — the lobby with the table-top model
  const STATUS_COL = ['#efe2c2', '#E69F00', '#8a5a36', '#8f8f8f', '#0072B2'];
  const STATUS_WORD = ['빈 자리', '신청 중', '분양됨', '쉬는 자리', '내 것'];
  function buildOffice(ctx) {
    const W = 22, D = 14, low = !!ctx.low;
    const win = (p) => ({ window: p, w: 2.0, h: 2.2, sill: 0.8 });
    const R = K.room(ctx, {
      w: W, d: D, post: 4.8, ridge: 6.5, bays: { x: 7, z: 5 }, floor: 'stone', roof: 'rafters', tone: 'warm', postR: 0.22, entasis: true,
      walls: {
        N: ['plaster', win('jeongja'), 'plaster', 'plaster', 'plaster', win('jeongja'), 'plaster'],
        E: ['plaster', win('ttisal'), 'plaster', win('ttisal'), 'plaster'],
        S: [win('aja'), win('yongja'), 'plaster', { door: 'changho', exit: true, w: 2.4, h: 2.7 }, 'plaster', win('yongja'), win('aja')],
        W: ['plaster', 'plaster', 'plaster', 'plaster', 'plaster'],
      },
      sun: { az: 200, el: 32 },
    });
    const A = (key, spot) => ctx.anchor(key, spot);
    const disposers = [];
    const C = CXP();
    // ---- the model table: a timber frame, the plan on top, small buildings, the wall ring, trees
    const b = C ? C.bounds : { minX: -190, maxX: 190, minZ: -150, maxZ: 196 };
    const TW = 5.8, s = TW / (b.maxX - b.minX), TD = (b.maxZ - b.minZ) * s, TY = 0.82, TZ = -0.6;
    const cx0 = (b.minX + b.maxX) / 2, cz0 = (b.minZ + b.maxZ) / 2;
    const mx = (x) => (x - cx0) * s, mz = (z) => TZ + (z - cz0) * s;
    R.add('furn', K.geo.slab(TW + 0.3, 0.09, TD + 0.3, 0.01), M(0, TY - 0.045, TZ), '#6b4429');
    for (const a of [-1, 1]) for (const c of [-1, 1]) R.add('furn', K.geo.slab(0.12, TY - 0.09, 0.12, 0.008), M(a * (TW / 2 + 0.02), (TY - 0.09) / 2, TZ + c * (TD / 2 + 0.02)), '#5a3620');
    for (const c of [-1, 1]) R.add('furn', K.geo.slab(TW + 0.1, 0.16, 0.05, 0.006), M(0, TY - 0.17, TZ + c * (TD / 2 + 0.08)), '#5a3620');
    for (const a of [-1, 1]) R.add('furn', K.geo.slab(0.05, 0.16, TD + 0.1, 0.006), M(a * (TW / 2 + 0.08), TY - 0.17, TZ), '#5a3620');
    for (const a of [-1, 1]) for (const c of [-1, 1]) R.add('brass', K.geo.slab(0.16, 0.02, 0.16, 0.004), M(a * (TW / 2 + 0.08), TY + 0.005, TZ + c * (TD / 2 + 0.08)), null, { cast: false });
    R.block(0, TZ, TW / 2 + 0.2, TD / 2 + 0.2, { maxY: TY + 0.05, stand: false });
    // the plan, live
    const MW = low ? 640 : 1280, MH = Math.round(MW * TD / TW);
    let mapBoard = null;
    const drawMap = (c, w, h) => {
      c.fillStyle = '#e9e0cc'; c.fillRect(0, 0, w, h);
      if (!C || typeof C.draw !== 'function') return;
      const view = { x: cx0, z: cz0, scale: w / (b.maxX - b.minX), w, h };
      const ms = (() => { try { return G.sys.allot?.mapState?.() || null; } catch (e) { return null; } })();
      const L = ms && ms.layout ? ms.layout : undefined;
      const st = ms && ms.status ? ms.status : null;
      C.draw(c, view, { layout: L, relief: true, labels: !low, quality: low ? 'low' : 'high', unitStyle: st ? (code, seq, kind, i) => STATUS_COL[st[i]] || STATUS_COL[0] : null });
      if (!ms || ms.demo) {
        c.fillStyle = 'rgba(255,250,238,.88)'; rrect(c, 16, h - 64, 330, 48, 12); c.fill();
        c.fillStyle = '#5a3a22'; c.font = `700 26px ${FONT}`; c.textAlign = 'left'; c.textBaseline = 'middle';
        c.fillText(ms ? '체험용 모형이에요' : '분양 정보를 기다려요', 30, h - 40);
      }
    };
    {
      const g = new THREE.PlaneGeometry(TW, TD); g.rotateX(-PI / 2);
      mapBoard = canvasBoard(R, ctx, { cw: MW, ch: MH, w: TW, h: TD, geometry: g, name: 'office-model-map', draw: drawMap });
      mapBoard.mesh.position.set(0, TY + 0.004, TZ);
    }
    // small buildings (exaggerated heights so they read), the wall rings, the corridor, trees on the slopes
    if (C) {
      const HX = 1.6;     // height exaggeration
      const els = C.elements || [];
      const gableBox = (x0, z0, x1, z1, y0, h, roofH, wallT, roofT, ridgeX) => {
        const w = Math.abs(x1 - x0) * s, d = Math.abs(z1 - z0) * s, cx = mx((x0 + x1) / 2), cz = mz((z0 + z1) / 2), hh = Math.max(0.012, h * s * HX), rh = Math.max(0.01, roofH * s * HX);
        R.add('paint', K.geo.slab(w, hh, d, 0.001), M(cx, y0 + hh / 2, cz), wallT, { cast: false });
        const pr = new THREE.CylinderGeometry(0.5, 0.5, 1, 3, 1); pr.rotateZ(PI / 2);   // a triangular prism along X
        const sx = (ridgeX ? w : d) * 1.12, sz = (ridgeX ? d : w) * 1.18;
        R.add('paint', pr, M(cx, y0 + hh + rh * 0.25, cz, ridgeX ? 0 : PI / 2, 1).multiply(new THREE.Matrix4().makeScale(sx, rh * 1.5, sz)), roofT, { cast: false });
      };
      for (const e of els) {
        if (e.type !== 'building') continue;
        if (e.kind === 'main' && Array.isArray(e.parts)) {
          for (const p of e.parts) gableBox(p.x0, p.z0, p.x1, p.z1, TY, (p.h || 10) * (p.id === 'portico' ? 0.6 : 0.75), (p.roof && p.roof.h) || 4, '#d9cbb2', '#4b4f56', (p.roof && p.roof.ridge) === 'x');
          continue;
        }
        const w = e.w || 6, d = e.d || 6, rot = e.rot || 0;
        if (Math.abs(rot) > 0.01) {
          const hw = w * s / 2, hd = d * s / 2, hh = Math.max(0.012, (e.h || 4) * s * HX);
          R.add('paint', K.geo.slab(hw * 2, hh, hd * 2, 0.001), M(mx(e.x), TY + hh / 2, mz(e.z), rot), '#d9cbb2', { cast: false });
          R.add('paint', new THREE.ConeGeometry(Math.hypot(hw, hd) * 1.15, Math.max(0.012, ((e.roof && e.roof.h) || 2.5) * s * HX), 4, 1), M(mx(e.x), TY + hh + ((e.roof && e.roof.h) || 2.5) * s * HX / 2, mz(e.z), rot + PI / 4), '#4b4f56', { cast: false });
          continue;
        }
        gableBox(e.x - w / 2, e.z - d / 2, e.x + w / 2, e.z + d / 2, TY, e.h || 4, (e.roof && e.roof.h) || 2.5, e.kind === 'storehouse' ? '#a98a68' : '#efe6d4', e.kind === 'storehouse' ? '#5d564d' : '#45484d', w >= d);
      }
      const ringAt = (ring, r, h, tint) => { if (!ring || !fin(ring.cx)) return; const t = new THREE.TorusGeometry(r * s, 0.006, 3, low ? 48 : 96); t.rotateX(PI / 2); R.add('paint', t, M(mx(ring.cx), TY + h, mz(ring.cz)), tint, { cast: false }); };
      const GC = C.rings && C.rings.GC, wallR = (C.K && C.K.WALL_R) || 52.6;
      ringAt(GC, wallR, 0.012, '#8e8170');
      const cor = C.byId?.('CORRIDOR');
      if (cor && cor.pts) for (let i = 0; i < cor.pts.length - 1; i++) {
        const a = cor.pts[i], bb = cor.pts[i + 1], L = Math.hypot(bb[0] - a[0], bb[1] - a[1]) * s;
        R.add('paint', K.geo.slab(L, 0.02, (cor.w || 4.4) * s, 0.001), M(mx((a[0] + bb[0]) / 2), TY + 0.03, mz((a[1] + bb[1]) / 2), Math.atan2(-(bb[1] - a[1]), bb[0] - a[0])), '#6d5a45', { cast: false });
      }
      // trees: little cones where the plan's ground rises into the forest
      const rnd = G.util.rng('cx-office-trees');
      let n = 0;
      for (let k = 0; k < 900 && n < (low ? 70 : 150); k++) {
        const x = b.minX + 4 + rnd() * (b.maxX - b.minX - 8), z = b.minZ + 4 + rnd() * (b.maxZ - b.minZ - 8);
        let wild = true;
        try { wild = !C.walkable(x, z) && !C.inWater?.(x, z) && C.height(x, z) > 12; } catch (e) { wild = false; }
        if (!wild) continue;
        const hs = 0.05 + rnd() * 0.04;
        R.add('paint', new THREE.ConeGeometry(hs * 0.42, hs, 5, 1), M(mx(x), TY + hs / 2, mz(z)), rnd() < 0.5 ? '#3f6b45' : '#55744a', { cast: false });
        n++;
      }
    }
    A('gujwa', { x: TW / 2 - 0.3, y: TY + 0.25, z: TZ + TD / 2 - 0.1 });
    A('manjangdae', { x: -TW / 2 + 0.4, y: TY + 0.25, z: TZ + TD / 2 - 0.1 });
    // ---- the live counts on a stand by the table
    const counts = () => {
      const out = [0, 0, 0, 0, 0];
      try { const ms = G.sys.allot?.mapState?.(); if (ms && ms.status) for (let i = 0; i < ms.status.length; i++) out[ms.status[i] <= 4 ? ms.status[i] : 0]++; } catch (e) { /* none */ }
      return out;
    };
    const standX = TW / 2 + 1.1, standZ = TZ + TD / 2 + 0.3;
    R.add('furn', K.geo.slab(0.08, 1.1, 0.08, 0.006), M(standX, 0.55, standZ), '#5a3620');
    R.add('furn', K.geo.slab(0.5, 0.05, 0.4, 0.006), M(standX, 0.03, standZ), '#5a3620');
    const legend = canvasBoard(R, ctx, {
      cw: 640, ch: 480, w: 0.95, h: 0.71, name: 'office-legend',
      draw: (c, w, h) => {
        const g = c.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#f6eedd'); g.addColorStop(1, '#ead9b8');
        c.fillStyle = g; c.fillRect(0, 0, w, h);
        c.strokeStyle = '#7a5a3a'; c.lineWidth = 10; c.strokeRect(5, 5, w - 10, h - 10);
        c.fillStyle = '#3a2616'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.font = `800 46px ${FONT}`;
        c.fillText('만 개의 자리, 지금은?', w / 2, 56);
        const n = counts(), total = n.reduce((a, v) => a + v, 0);
        for (let i = 0; i < 5; i++) {
          const y = 120 + i * 68;
          c.fillStyle = STATUS_COL[i]; rrect(c, 40, y - 24, 48, 48, 10); c.fill(); c.strokeStyle = 'rgba(0,0,0,.35)'; c.lineWidth = 2; c.stroke();
          if (i === 4) { c.fillStyle = '#ffd34d'; c.font = `800 30px ${FONT}`; c.fillText('★', 64, y + 1); }
          c.fillStyle = '#3a2616'; c.textAlign = 'left'; c.font = `700 36px ${FONT}`; c.fillText(STATUS_WORD[i], 108, y);
          c.textAlign = 'right'; c.font = `800 38px ${FONT}`; c.fillText(total ? n[i].toLocaleString('ko-KR') : '—', w - 44, y);
          c.textAlign = 'center';
        }
      },
    });
    legend.mesh.position.set(standX, 1.38, standZ); legend.mesh.rotation.set(-0.18, -0.35, 0, 'YXZ');
    R.block(standX, standZ, 0.25, 0.22, { maxY: 1.7 });
    // ---- the allotment year on the north wall (this month marked; Korean time)
    const yearBoard = canvasBoard(R, ctx, {
      cw: 1280, ch: 448, w: 5.6, h: 1.96, wall: 'N', name: 'office-year', matrix: R.wm('N', W / 2, 2.55, 0.09),
      draw: (c, w, h) => {
        const k = kst(), mo = k.mo;
        const g = c.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#2f3d52'); g.addColorStop(1, '#1f2a3a');
        c.fillStyle = g; c.fillRect(0, 0, w, h);
        c.strokeStyle = '#d0a85a'; c.lineWidth = 8; c.strokeRect(10, 10, w - 20, h - 20);
        c.fillStyle = '#f3e2b5'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.font = `800 52px ${FONT}`;
        c.fillText(`${k.y}년, 내 장독의 한 해`, w / 2, 62);
        const steps = [['① 담그기', '2~3월', [2, 3]], ['② 가르기', '4~5월', [4, 5]], ['③ 익히기', '6~11월', [6, 7, 8, 9, 10, 11]], ['④ 받는 날', '12월', [12]]];
        const x0 = 70, x1 = w - 70, y = 250, step = (x1 - x0) / 12;
        c.lineWidth = 6; c.strokeStyle = 'rgba(243,226,181,.4)'; c.beginPath(); c.moveTo(x0, y); c.lineTo(x1, y); c.stroke();
        const cols = ['#c98a3a', '#7aa05a', '#8a6a4a', '#d0a85a'];
        steps.forEach(([name, when, ms], i) => {
          const a = x0 + (ms[0] - 1) * step, bb = x0 + ms[ms.length - 1] * step;
          c.fillStyle = cols[i]; rrect(c, a + 4, y - 26, bb - a - 8, 52, 22); c.fill();
          const here = ms.includes(mo);
          if (here) { c.strokeStyle = '#ffe9a8'; c.lineWidth = 6; rrect(c, a + 1, y - 29, bb - a - 2, 58, 24); c.stroke(); }
          c.fillStyle = '#f6ecd2'; c.font = `800 ${here ? 40 : 34}px ${FONT}`; c.fillText(name, (a + bb) / 2, y + 74);
          c.fillStyle = 'rgba(246,236,210,.8)'; c.font = `600 28px ${FONT}`; c.fillText(when, (a + bb) / 2, y + 118);
        });
        for (let m = 1; m <= 12; m++) { c.fillStyle = m === mo ? '#ffe9a8' : 'rgba(246,236,210,.75)'; c.font = `${m === mo ? 800 : 600} ${m === mo ? 34 : 26}px ${FONT}`; c.fillText(`${m}월`, x0 + (m - 0.5) * step, y - 66); }
        const px = x0 + (mo - 0.5) * step;
        c.fillStyle = '#ffe9a8'; c.beginPath(); c.moveTo(px - 16, y - 44); c.lineTo(px + 16, y - 44); c.lineTo(px, y - 26); c.closePath(); c.fill();
        c.font = `700 26px ${FONT}`; c.fillStyle = '#ffe9a8'; c.fillText('지금', px, y - 102 > 100 ? y - 102 : 104);
      },
    });
    ['year_damgeugi', 'year_gareugi', 'year_ikhigi', 'year_batneun'].forEach((key, i) => A(key, R.wp('N', W / 2 - 2.1 + i * 1.4, 1.35, 0.3)));
    // ---- the 분양 안내 desk before a 병풍 on the west wall
    const DX = -W / 2 + 2.1, DZ = -0.6;
    R.add('furn', K.geo.slab(0.9, 1.0, 4.2, 0.01), M(DX, 0.5, DZ), '#7a4a2e');
    R.add('furn', K.geo.slab(1.1, 0.06, 4.4, 0.008), M(DX, 1.03, DZ), '#5a3620');
    for (let k = -2; k <= 2; k++) R.add('furn', K.geo.slab(0.02, 0.7, 0.7, 0.004), M(DX + 0.46, 0.5, DZ + k * 0.82), '#9b6a40', { cast: false });
    if (has('screen')) K.screen(R, { x: -W / 2 + 0.55, z: DZ, rotY: PI / 2, panels: 8, art: 'birds_flowers_screen' });
    if (has('pot')) { K.pot(R, { x: DX, y: 1.06, z: DZ + 1.6, kind: 'danji', s: 0.4 }); K.pot(R, { x: DX + 0.1, y: 1.06, z: DZ - 1.7, kind: 'bowl', s: 1.1, mat: 'brass' }); }
    for (let k = 0; k < 6; k++) R.add('paper', K.geo.slab(0.22, 0.012, 0.3, 0.002), M(DX + 0.15, 1.07 + k * 0.012, DZ + 0.6, 0.1 * k), null, { cast: false });
    if (has('jwadeung')) { K.jwadeung(R, { x: DX - 0.2, z: DZ - 2.7 }); if (has('lamp')) K.lamp(R, { x: DX - 0.2, y: 0.82, z: DZ - 2.7, s: 0.6 }); }
    R.block(DX, DZ, 0.6, 2.25, { maxY: 1.06, stand: false });
    if (has('label') || typeof R.label === 'function') R.label('분양 안내', { x: DX + 0.47, y: 0.62, z: DZ, rotY: PI / 2, w: 1.1, h: 0.3, style: 'wood' });
    A('bunyang', { x: DX + 0.2, y: 1.35, z: DZ + 0.6 });
    A('bohoja', { x: DX + 0.2, y: 1.35, z: DZ - 1.2 });
    ctx.interact({
      id: 'CX_OFFICE_DESK', kind: 'npc', label: '🏺 분양 안내 데스크', kidLabel: '분양 알아보기', emoji: '🏺', radius: 2.8, priority: 0.9,
      position: { x: DX + 1.1, y: 1.2, z: DZ },
      onInteract: () => {
        try {
          if (G.sys.allot?.open) G.sys.allot.open();
          else { toast('분양 안내는 곧 열려요. 장독 한 해를 벽에서 먼저 살펴봐요!', { emoji: '🏺', type: 'info' }); say('분양 안내는 곧 열려요.'); }
        } catch (e) { G.log.warn('UI', 'complex-office: allot panel failed', e?.message || e); }
      },
    });
    // ---- the lecture screen on the east wall
    lectureScreen(R, ctx, { side: 'E', u: 7, v: 2.4, w: 3.4, n: 0.1, top: 4.4 });
    // ---- great jars along the east wall, benches by the south wall, potted pines in the corners, lanterns
    if (has('pot')) {
      [[W / 2 - 0.9, -D / 2 + 1.2, 'dok', 1.15], [W / 2 - 0.9, -D / 2 + 2.6, 'hangari', 1.0], [W / 2 - 0.9, D / 2 - 2.2, 'dok', 1.1], [W / 2 - 2.1, D / 2 - 1.0, 'jungduri', 0.9]].forEach(([x, z, kind, sc]) => { K.pot(R, { x, z, kind, s: sc, lid: true }); R.block(x, z, 0.42 * sc, 0.42 * sc, { maxY: 1.0 * sc, stand: false }); });
      for (const [x, z] of [[-W / 2 + 1.0, D / 2 - 1.0], [W / 2 - 1.0, -D / 2 + 4.2]]) {
        K.pot(R, { x, z, kind: 'dok', s: 0.75, tint: '#5e3a24' });
        for (let k = 0; k < 4; k++) R.add('paint', new THREE.ConeGeometry(0.55 - k * 0.1, 0.42, 7, 1), M(x + Math.sin(k * 2.1) * 0.08, 0.9 + k * 0.3, z + Math.cos(k * 2.1) * 0.08), k % 2 ? '#3f6b45' : '#4a7a50');
        R.block(x, z, 0.4, 0.4, { maxY: 2.0, stand: false });
      }
    }
    for (const x of [-6.2, 6.2]) {
      R.add('furn', K.geo.slab(2.6, 0.08, 0.5, 0.008), M(x, 0.45, D / 2 - 1.0), '#8a5a36');
      for (const a of [-1, 1]) R.add('furn', K.geo.slab(0.08, 0.42, 0.42, 0.006), M(x + a * 1.15, 0.21, D / 2 - 1.0), '#5a3620');
      R.block(x, D / 2 - 1.0, 1.32, 0.27, { maxY: 0.5, stand: true });
    }
    if (!low && has('lamp')) for (const x of [-5, 5]) { R.add('glow', new THREE.CylinderGeometry(0.22, 0.22, 0.6, 10), M(x, 3.9, 1.6), '#4f7fc4'); R.add('glow', new THREE.CylinderGeometry(0.225, 0.225, 0.16, 10), M(x, 3.65, 1.6), '#cf4836'); K.lamp(R, { x, y: 3.7, z: 1.6, s: 0.4, intensity: 2.5, distance: 7 }); }
    if (has('dust')) K.dust(R, { count: low ? 0 : 50 });
    // ---- living model: redraw on new allotment data
    let pend = null;
    const redrawSoon = () => { if (pend) return; pend = setTimeout(() => { pend = null; mapBoard?.redraw(); legend.redraw(); }, 400); };
    disposers.push(listen(ctx, 'allot:map', redrawSoon), listen(ctx, 'allot:mine', redrawSoon));
    disposers.push(listen(ctx, 'place:enter', (e) => { if (e && e.id === 'PL_OFFICE') { yearBoard.redraw(); redrawSoon(); try { G.sys.allot?.refreshMap?.(); } catch (err) { /* optional */ } } }));
    R.finish();
    ctx.onUpdate(() => { /* the boards redraw on events */ });
    return { dispose() { if (pend) clearTimeout(pend); for (const f of disposers) f(); } };
  }

  // ================================================================ PL_WORKSHOP — 옹기 공방
  function buildWorkshop(ctx) {
    const W = 14, D = 10, low = !!ctx.low;
    const R = K.room(ctx, {
      w: W, d: D, post: 3.0, ridge: 4.2, bays: { x: 5, z: 4 }, floor: 'earth', roof: 'rafters', tone: 'dark', postR: 0.16,
      walls: {
        N: ['clay', 'clay', 'none', 'clay', { shutter: true, w: 1.2, h: 0.9, sill: 1.2, open: 0.8 }],
        E: ['clay', { window: 'jeongja', w: 1.3, h: 1.0, sill: 1.0 }, 'clay', 'clay'],
        S: [{ shutter: true, w: 1.4, h: 1.0, sill: 1.0, open: 0.7 }, 'clay', { door: 'panel', exit: true, w: 1.8, h: 2.2, open: 0.85 }, 'clay', { window: 'ttisal', w: 1.3, h: 1.0, sill: 1.0 }],
        W: ['clay', 'clay', { shutter: true, w: 1.2, h: 0.9, sill: 1.1, open: 0.6 }, 'clay'],
      },
      sun: { az: 160, el: 30 },
    });
    const A = (key, spot) => ctx.anchor(key, spot);
    const rnd = G.util.rng('cx-workshop');
    const RAW = '#a98466', RAW2 = '#9a7457', WET = '#7d5d45';
    // ---- the kiln's mouth in the north wall (the middle bay is left open: a brick arch with fire inside)
    const bay = R.bay ? R.bay('N', 2) : { uc: W / 2, len: W / 5 };
    const kp = R.wp('N', bay.uc, 0, 0);
    R.add('stone', K.geo.slab(bay.len - 0.2, 1.7, 0.6, 0.02), M(kp.x, 0.85, kp.z - 0.1), '#8a5a43');
    R.add('clay', K.geo.slab(bay.len - 0.2, 1.3, 0.3, 0.02), M(kp.x, 2.35, kp.z - 0.05), '#9c6a4c', { wall: 'N' });
    const arch = new THREE.TorusGeometry(0.62, 0.12, 6, low ? 8 : 14, PI);
    R.add('stone', arch, M(kp.x, 0.72, kp.z + 0.22), '#6e4636');
    R.add('glow', new THREE.CircleGeometry(0.6, low ? 8 : 16, 0, PI), M(kp.x, 0.72, kp.z + 0.21), '#ff7a2a', { cast: false });
    R.add('glow', K.geo.slab(1.2, 0.72, 0.02, 0.002), M(kp.x, 0.36, kp.z + 0.21), '#ff6a1a', { cast: false });
    if (has('fire')) K.fire(R, { x: kp.x, y: 0.12, z: kp.z + 0.35, s: 0.8, light: !low });
    R.block(kp.x, kp.z + 0.1, bay.len / 2, 0.5);
    A('gama', { x: kp.x + 1.0, y: 1.3, z: kp.z + 0.7 });
    // firewood by the mouth
    for (let r = 0; r < 4; r++) for (let c = 0; c < 8; c++) R.add('wood', new THREE.CylinderGeometry(0.06, 0.06, 0.8, 6), M(kp.x + 1.8 + (r % 2) * 0.06, 0.07 + r * 0.12, kp.z + 0.6 + c * 0.13, 0, 1, 1, 1, PI / 2), r % 2 ? '#9a7550' : '#87643f');
    R.block(kp.x + 1.8, kp.z + 1.05, 0.45, 0.55, { maxY: 0.55, stand: true });
    // ---- the kick wheel (발 물레) with a jar half thrown, a low seat, the 도개 and 수레 on a stool
    const WX = -2.2, WZ = 0.4;
    R.add('wood', new THREE.CylinderGeometry(0.6, 0.6, 0.12, low ? 12 : 24), M(WX, 0.12, WZ), '#6a4a30');
    R.add('wood', new THREE.CylinderGeometry(0.06, 0.06, 0.62, 8), M(WX, 0.48, WZ), '#4a3220');
    R.add('wood', new THREE.CylinderGeometry(0.34, 0.34, 0.07, low ? 10 : 20), M(WX, 0.8, WZ), '#7a5638');
    if (has('pot')) K.pot(R, { x: WX, y: 0.835, z: WZ, kind: 'jungduri', s: 0.6, mat: 'clay', tint: WET });
    R.add('furn', K.geo.slab(0.5, 0.4, 0.4, 0.01), M(WX, 0.2, WZ + 0.95), '#6a4a30');
    R.block(WX, WZ + 0.2, 0.65, 0.95, { maxY: 0.9, stand: false });
    A('mulle', { x: WX, y: 1.5, z: WZ });
    const SX = WX + 1.3, SZ = WZ + 0.6;
    if (has('table')) K.table(R, { x: SX, z: SZ, w: 0.6, d: 0.45, h: 0.45 });
    R.add('wood', new THREE.SphereGeometry(0.11, 10, 8, 0, TAU, 0, PI / 2), M(SX - 0.12, 0.45, SZ), '#8a6a4a');                  // 도개 (anvil)
    R.add('wood', new THREE.CylinderGeometry(0.035, 0.035, 0.22, 6), M(SX - 0.12, 0.56, SZ), '#6a4a30');
    R.add('wood', K.geo.slab(0.36, 0.03, 0.09, 0.004), M(SX + 0.12, 0.47, SZ + 0.05, 0.4), '#7a5638');                               // 수레 (paddle)
    R.block(SX, SZ, 0.32, 0.25, { maxY: 0.5, stand: true });
    A('tarim', { x: SX, y: 0.9, z: SZ });
    // ---- drying shelves of raw jars along the west wall
    if (has('shelf')) {
      for (const [z, n] of [[-2.6, 3], [0.6, 3]]) {
        const spots = K.shelf(R, { x: -W / 2 + 0.45, z, rotY: PI / 2, w: 2.6, d: 0.55, h: 1.9, levels: 3 }) || [];
        spots.forEach((sp) => { for (let k = 0; k < n; k++) if (has('pot')) K.pot(R, { x: sp.x, y: sp.y, z: sp.z - 0.85 + k * 0.85, kind: k === 1 ? 'hangari' : 'danji', s: 0.36 + rnd() * 0.06, mat: 'clay', tint: rnd() < 0.5 ? RAW : RAW2 }); });
        R.block(-W / 2 + 0.45, z, 0.32, 1.35, { maxY: 1.95, stand: false });
      }
      A('geonjo', { x: -W / 2 + 1.0, y: 1.4, z: -1.0 });
    }
    // ---- glaze tubs (잿물), ash and 약토 sacks, a ladle
    const GX = W / 2 - 1.4;
    for (let k = 0; k < 3; k++) {
      const z = -2.4 + k * 1.3;
      if (has('pot')) K.pot(R, { x: GX, z, kind: 'basin', s: 1.5, tint: '#5b4636' });
      R.add('paint', new THREE.CircleGeometry(0.44, low ? 10 : 18), M(GX, 0.27, z, 0, 1, 1, 1, -PI / 2), k === 1 ? '#3e3226' : '#6e5f4a', { cast: false });
      R.block(GX, z, 0.5, 0.5, { maxY: 0.32, stand: true });
    }
    R.add('wood', new THREE.CylinderGeometry(0.02, 0.02, 0.9, 6), M(GX - 0.1, 0.55, -1.1, 0, 1, 1, 1, 0.9), '#6a4a30');
    if (has('straw')) { K.straw(R, { x: GX + 0.2, z: 1.6, kind: 'sack' }); K.straw(R, { x: GX - 0.5, z: 1.9, kind: 'sack', s: 0.9 }); }
    R.block(GX - 0.1, 1.75, 0.6, 0.45, { maxY: 0.6, stand: true });
    A('jaetmul', { x: GX, y: 0.9, z: -1.1 });
    // ---- the clay heap under a wet cloth, finished jars with finger-drawn bands by the door
    {
      const hx = 1.6, hz = -3.2;
      const heap = new THREE.SphereGeometry(0.9, low ? 10 : 18, low ? 6 : 10, 0, TAU, 0, PI / 2); heap.scale(1.2, 0.6, 0.8);
      R.add('clay', heap, M(hx, 0, hz), '#8f6a4c');
      const cl = new THREE.SphereGeometry(0.93, low ? 10 : 16, low ? 5 : 8, 0, PI * 1.2, 0, PI / 2); cl.scale(1.2, 0.62, 0.82);
      R.add('cloth', cl, M(hx, 0.01, hz, 0.4), '#d8cfbd');
      R.block(hx, hz, 1.05, 0.72, { maxY: 0.56, stand: true });
      A('heuk', { x: hx, y: 0.9, z: hz });
    }
    if (has('pot')) {
      [[2.8, 3.2, 'dok', 0.9], [3.8, 3.4, 'hangari', 0.7], [4.6, 3.0, 'danji', 0.55], [2.2, 2.4, 'jungduri', 0.7]].forEach(([x, z, kind, sc]) => { K.pot(R, { x, z, kind, s: sc, lid: kind !== 'danji' }); R.block(x, z, 0.4 * sc, 0.4 * sc, { maxY: 0.95 * sc, stand: false }); });
      A('muni', { x: 3.4, y: 1.25, z: 3.2 });
      A('sum', { x: 2.8, y: 1.3, z: 3.2 });
    }
    // ---- a motion board (옹기가 숨 쉬는 원리) and the lecture screen
    const eb = R.bay ? R.bay('E', 2) : { uc: D / 2 };
    const bp = R.wp('E', eb.uc, 1.75, 0.08);
    try { if (G.data.motions?.MG_ONGGI_BREATH) ctx.board('MG_ONGGI_BREATH', { x: bp.x, y: bp.y, z: bp.z, rotY: -PI / 2, w: 1.6, h: 0.9, title: '옹기가 숨 쉬는 원리' }); } catch (e) { /* boards optional */ }
    lectureScreen(R, ctx, { side: 'W', u: 7.6, v: 2.0, w: 1.9, n: 0.1, top: 2.9 });
    if (has('dust')) K.dust(R, { count: low ? 0 : 40 });
    if (!low && has('lamp')) K.lamp(R, { x: 0, y: 2.6, z: 1.8, s: 0.5, intensity: 2.2, distance: 7 });
    R.finish();
    return { dispose() {} };
  }

  // ================================================================ PL_CAFE — 카페 · 체험 맛집
  const TASTE = [
    ['doenjang', '된장', '#7a5530'], ['ganjang', '간장', '#2b1a10'], ['gochujang', '고추장', '#a3271c'], ['cheonggukjang', '청국장', '#8a6a3c'],
    ['kimchi', '김치', '#c4402a'], ['jangajji', '장아찌', '#6b6a2a'], ['sikhye', '식혜', '#efe6c9'], ['sikcho', '식초', '#c99a52'],
  ];
  function buildCafe(ctx) {
    const W = 16, D = 11, low = !!ctx.low;
    const win = (p) => ({ window: p, w: 1.8, h: 1.5, sill: 0.7 });
    const R = K.room(ctx, {
      w: W, d: D, post: 3.0, ridge: 3.8, bays: { x: 6, z: 4 }, floor: 'maru', roof: 'rafters', tone: 'warm', postR: 0.15,
      walls: {
        N: ['plaster', 'plaster', 'plaster', 'plaster', 'plaster', 'plaster'],
        E: ['plaster', win('ttisal'), win('ttisal'), 'plaster'],
        S: [win('aja'), win('yongja'), { door: 'changho', exit: true, w: 1.8, h: 2.2 }, win('yongja'), win('aja'), 'plaster'],
        W: ['plaster', win('jeongja'), win('jeongja'), 'plaster'],
      },
      sun: { az: 195, el: 30 },
    });
    const A = (key, spot) => ctx.anchor(key, spot);
    const rnd = G.util.rng('cx-cafe');
    // ---- the counter along the north wall, shelves of jars behind it, the menu board
    const CZ = -D / 2 + 1.6;
    R.add('furn', K.geo.slab(5.4, 1.0, 0.7, 0.01), M(-1.4, 0.5, CZ), '#7a4a2e');
    R.add('furn', K.geo.slab(5.6, 0.06, 0.85, 0.008), M(-1.4, 1.03, CZ), '#5a3620');
    for (let k = 0; k < 6; k++) R.add('furn', K.geo.slab(0.75, 0.7, 0.02, 0.004), M(-3.75 + k * 0.94, 0.5, CZ + 0.36), '#9b6a40', { cast: false });
    R.block(-1.4, CZ, 2.8, 0.45, { maxY: 1.06, stand: false });
    if (has('pot')) {
      K.pot(R, { x: -3.6, y: 1.06, z: CZ, kind: 'hangari', s: 0.55, lid: true });
      K.pot(R, { x: -0.3, y: 1.06, z: CZ - 0.1, kind: 'bottle', s: 1.6, mat: 'onggi', tint: '#3f5a74' });
      for (let k = 0; k < 4; k++) K.pot(R, { x: 0.4 + k * 0.32, y: 1.06, z: CZ + 0.15, kind: 'bowl', s: 0.9, mat: 'onggi', tint: k % 2 ? '#e8e0cf' : '#3b5a7a' });
    }
    if (has('steam')) K.steam(R, { x: -3.6, y: 1.65, z: CZ, s: 0.5 });
    if (has('shelf')) {
      const spots = K.shelf(R, { x: 2.6, z: -D / 2 + 0.35, w: 2.4, d: 0.4, h: 1.9, levels: 4 }) || [];
      spots.forEach((sp, l) => { for (let k = 0; k < 4; k++) if (has('pot')) K.pot(R, { x: sp.x - 0.85 + k * 0.57, y: sp.y, z: sp.z, kind: (k + l) % 2 ? 'danji' : 'bottle', s: 0.32 + rnd() * 0.05, mat: 'onggi', tint: (k + l) % 3 === 0 ? '#5e3a24' : (k + l) % 3 === 1 ? '#6a442e' : '#3e2a1c' }); });
      R.block(2.6, -D / 2 + 0.35, 1.25, 0.25, { maxY: 1.95, stand: false });
    }
    canvasBoard(R, ctx, {
      cw: 768, ch: 512, w: 2.1, h: 1.4, wall: 'N', name: 'cafe-menu', matrix: R.wm('N', W / 2 + 1.4, 2.05, 0.08),
      draw: (c, w, h) => {
        c.fillStyle = '#26302a'; c.fillRect(0, 0, w, h);
        c.strokeStyle = '#a07a4a'; c.lineWidth = 14; c.strokeRect(7, 7, w - 14, h - 14);
        c.fillStyle = '#f2ead6'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.font = `800 58px ${FONT}`; c.fillText('오늘의 차림', w / 2, 66);
        const items = [['🍵', '오미자차'], ['🍚', '식혜'], ['🫖', '수정과'], ['🥣', '된장 비빔밥'], ['🥞', '김치전'], ['🍡', '약과']];
        c.textAlign = 'left'; c.font = `700 40px ${FONT}`;
        items.forEach(([e, t], i) => { const x = i < 3 ? 70 : w / 2 + 30, y = 160 + (i % 3) * 104; c.fillText(`${e} ${t}`, x, y); });
        c.fillStyle = 'rgba(242,234,214,.7)'; c.font = `600 26px ${FONT}`; c.textAlign = 'center'; c.fillText('맛있게 익은 우리 발효 음식이에요', w / 2, h - 38);
      },
    });
    // ---- low tables with cushions (좌식) and high tables with stools
    const lowT = [[-5.0, 1.2], [-2.0, 2.6], [1.0, 1.2]], highT = [[4.6, 0.6], [4.6, 3.2]];
    for (const [x, z] of lowT) {
      if (has('table')) K.table(R, { x, z, w: 1.2, d: 0.75, h: 0.34, legs: 'curved' });
      if (has('cushion')) for (const [dx, dz] of [[-0.95, 0], [0.95, 0], [0, -0.75], [0, 0.75]]) K.cushion(R, { x: x + dx, z: z + dz, w: 0.55, d: 0.55, tint: rnd() < 0.5 ? '#9c3b2e' : '#2f5d74', trim: '#d9b24c' });
      R.block(x, z, 0.62, 0.4, { maxY: 0.36, stand: true });
      if (has('pot')) { K.pot(R, { x: x - 0.2, y: 0.34, z, kind: 'bowl', s: 0.8, mat: 'onggi', tint: '#e8e0cf' }); K.pot(R, { x: x + 0.25, y: 0.34, z: z + 0.1, kind: 'bowl', s: 0.8, mat: 'onggi', tint: '#3b5a7a' }); }
    }
    for (const [x, z] of highT) {
      R.add('furn', new THREE.CylinderGeometry(0.5, 0.5, 0.05, low ? 12 : 22), M(x, 0.76, z), '#9b6a40');
      R.add('furn', new THREE.CylinderGeometry(0.05, 0.08, 0.74, 8), M(x, 0.37, z), '#5a3620');
      for (let k = 0; k < 3; k++) { const a = k * TAU / 3 + 0.5, sx = x + Math.cos(a) * 0.78, sz = z + Math.sin(a) * 0.78; R.add('furn', new THREE.CylinderGeometry(0.18, 0.16, 0.5, 10), M(sx, 0.25, sz), '#a77a50'); ctx.addCollider({ shape: 'circle', x: sx, z: sz, r: 0.2, maxY: 0.5, stand: true, tag: 'stool' }); }
      ctx.addCollider({ shape: 'circle', x, z, r: 0.52, maxY: 0.78, stand: true, tag: 'table' });
    }
    // ---- the tasting board along the east wall: a long low table with eight bowls and name cards
    const TX = W / 2 - 1.0, TZ0 = -2.8;
    R.add('furn', K.geo.slab(0.8, 0.06, 6.2, 0.008), M(TX, 0.78, TZ0 + 2.6), '#6b4429');
    for (const z of [TZ0 - 0.3, TZ0 + 5.5]) for (const a of [-1, 1]) R.add('furn', K.geo.slab(0.08, 0.75, 0.08, 0.006), M(TX + a * 0.32, 0.375, z), '#4a2c18');
    R.block(TX, TZ0 + 2.6, 0.42, 3.15, { maxY: 0.82, stand: true });
    const cardTex = G.gfx.canvasTexture(1024, 256, (c, w, h) => {
      c.fillStyle = '#f6eedd'; c.fillRect(0, 0, w, h);
      TASTE.forEach(([, name], i) => {
        const x0 = (i % 4) * (w / 4), y0 = Math.floor(i / 4) * (h / 2);
        c.strokeStyle = '#8a6a4a'; c.lineWidth = 4; c.strokeRect(x0 + 6, y0 + 6, w / 4 - 12, h / 2 - 12);
        c.fillStyle = '#3a2616'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.font = `800 52px ${FONT}`; c.fillText(name, x0 + w / 8, y0 + h / 4 + 2);
      });
    });
    ctx.own(cardTex);
    const cardMat = ctx.low ? new THREE.MeshLambertMaterial({ map: cardTex }) : new THREE.MeshStandardMaterial({ map: cardTex, roughness: 0.85 });
    ctx.own(cardMat);
    const cardGeo = [];
    TASTE.forEach(([key, , food], i) => {
      const z = TZ0 + i * 0.72;
      if (has('pot')) K.pot(R, { x: TX - 0.05, y: 0.81, z, kind: 'bowl', s: 1.7, mat: 'onggi', tint: '#5e3a24' });
      R.add('paint', new THREE.CircleGeometry(0.135, low ? 10 : 16), M(TX - 0.05, 0.81 + 0.1, z, 0, 1, 1, 1, -PI / 2), food, { cast: false });
      if (key === 'kimchi' || key === 'jangajji') for (let k = 0; k < 4; k++) R.add('paint', K.geo.slab(0.07, 0.03, 0.05, 0.004), M(TX - 0.05 + (rnd() - 0.5) * 0.12, 0.93, z + (rnd() - 0.5) * 0.12, rnd() * 3), key === 'kimchi' ? '#e9e2c8' : '#5a6a2a', { cast: false });
      const g = new THREE.PlaneGeometry(0.3, 0.15);
      const u0 = (i % 4) / 4, v1 = 1 - Math.floor(i / 4) / 2, uv = g.attributes.uv;
      for (let k = 0; k < uv.count; k++) uv.setXY(k, u0 + uv.getX(k) / 4, v1 - 0.5 + uv.getY(k) / 2);
      g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(TX - 0.36, 0.9, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.5, -PI / 2, 0, 'YXZ')), new THREE.Vector3(1, 1, 1)));
      cardGeo.push(g);
      A(key, { x: TX - 0.1, y: 1.15, z });
    });
    {
      const BGU = (typeof ADDONS !== 'undefined' && ADDONS.BufferGeometryUtils) || null;
      const merged = BGU && cardGeo.length > 1 ? BGU.mergeGeometries(cardGeo, false) : cardGeo[0];
      if (merged) { ctx.own(merged); const mesh = new THREE.Mesh(merged, cardMat); mesh.name = 'cafe-taste-cards'; mesh.userData.guardSkip = true; R.addMesh(mesh, null); }
    }
    // ---- dried peppers and garlic on the west wall, a jar corner, lamps
    if (has('rope')) for (const u of [2.0, 3.0, 8.0, 9.0]) {
      const a = R.wp('W', u, 2.5, 0.1), bb = R.wp('W', u, 1.3, 0.1);
      K.rope(R, { points: [[a.x, a.y, a.z], [bb.x, bb.y, bb.z]], r: 0.012 });
      for (let k = 0; k < 9; k++) R.add('paint', new THREE.ConeGeometry(0.035, 0.16, 6, 1), M(a.x + 0.04, a.y - 0.14 - k * 0.13, a.z + (k % 2 ? 0.04 : -0.04), 0, 1, 1, 1, PI), u > 5 ? '#e8e2cf' : '#b8261c', { cast: false });
    }
    if (has('pot')) [[-W / 2 + 0.8, D / 2 - 1.0, 'dok', 1.0], [-W / 2 + 1.8, D / 2 - 0.8, 'hangari', 0.75]].forEach(([x, z, kind, sc]) => { K.pot(R, { x, z, kind, s: sc, lid: true }); R.block(x, z, 0.42 * sc, 0.42 * sc, { maxY: 0.95 * sc, stand: false }); });
    lectureScreen(R, ctx, { side: 'W', u: 5.5, v: 1.9, w: 2.2, n: 0.1, top: 2.85 });
    if (!low && has('lamp')) for (const [x, z] of [[-3.5, 1.8], [2.5, 1.8]]) K.lamp(R, { x, y: 2.5, z, s: 0.45, intensity: 2.2, distance: 6.5 });
    if (has('dust')) K.dust(R, { count: low ? 0 : 30 });
    R.finish();
    return { dispose() {} };
  }

  // ================================================================ definitions (after PL_ALLOT exists: its way out is ours)
  function define() {
    const allot = P.def('PL_ALLOT');
    const exit = allot && allot.exit ? { x: allot.exit.x, z: allot.exit.z, rotY: allot.exit.rotY } : undefined;
    const common = (id) => ({ exit, indoor: true, far: 150, canEnter: (o) => remember(id, o), exitTo: (o) => exitTo(id, o), exhibits: topicsOf(id) });
    P.define(Object.assign(common('PL_OFFICE'), {
      id: 'PL_OFFICE', name: '만장대 본관 로비', kidName: '본관 로비', emoji: '🏛️', zoneId: 'ZONE_PL_OFFICE', color: '#d8b98a',
      desc: '만장대 단지의 모형과 장독의 한 해, 분양 안내 데스크가 있는 넓은 로비예요.',
      origin: { x: 600, z: 2000 }, size: { w: 22, d: 14, h: 6.5 }, floorY: 0, surface: 'stone',
      spawn: { x: 0, z: 5.4, rotY: PI },
      camera: { dist: 6.8, min: 2.6, max: 10, pitch: 0.22, pmin: -0.1, pmax: 0.9, ceil: 4.6 },
      build: buildOffice,
    }));
    P.define(Object.assign(common('PL_WORKSHOP'), {
      id: 'PL_WORKSHOP', name: '옹기 공방', kidName: '옹기 공방', emoji: '⚱️', zoneId: 'ZONE_PL_WORKSHOP', color: '#b08a66',
      desc: '흙으로 옹기를 빚고 말리고 잿물을 입혀 가마에 굽는 곳이에요.',
      origin: { x: 1800, z: 2000 }, size: { w: 14, d: 10, h: 4.2 }, floorY: 0, surface: 'dirt',
      spawn: { x: 0, z: 3.6, rotY: PI },
      camera: { dist: 5.4, min: 2.4, max: 7.6, pitch: 0.18, pmin: -0.1, pmax: 0.8, ceil: 2.8 },
      build: buildWorkshop,
    }));
    P.define(Object.assign(common('PL_CAFE'), {
      id: 'PL_CAFE', name: '카페 · 체험 맛집', kidName: '체험 맛집', emoji: '☕', zoneId: 'ZONE_PL_CAFE', color: '#c99a6a',
      desc: '된장, 김치, 식혜 같은 발효 음식을 맛보며 알아보는 카페예요.',
      origin: { x: 2000, z: 2000 }, size: { w: 16, d: 11, h: 3.8 }, floorY: 0, surface: 'wood',
      spawn: { x: 0, z: 4.0, rotY: PI },
      camera: { dist: 5.2, min: 2.4, max: 7.2, pitch: 0.16, pmin: -0.1, pmax: 0.8, ceil: 2.7 },
      build: buildCafe,
    }));
  }
  G.register({
    name: 'complexOffice', order: 30, label: '만장대 단지 안 (로비·공방·카페)',
    init() { try { define(); } catch (e) { G.log.warn('WORLD', 'complex-office: the rooms could not be defined', e?.message || e); } },
    doorSpots, _back: back,
  });
})();
