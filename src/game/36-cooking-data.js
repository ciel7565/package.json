// =============================================================================
// 36-cooking-data.js — dishes, stations and kitchen staples as data: G.data.cooking (CONTRACT §18.4, lane cooking).
// Pure data + small pure helpers (no DOM, no THREE): tools/build.mjs evaluates this file in Node ([cooking] block) and
// exports the item ids, the dish ids and the state limits to server/data/game-data.json. 37-cooking.js is the kitchen.
//
//   G.data.cooking = {
//     v, stations: { id: { name, emoji, kid, does, actions } },        the stations of the 부엌 and the river 화덕
//     actions: { id: { verb, kid, mode: 'hold'|'taps'|'wait'|'fire'|'window'|'pick'|'tap', emoji } }
//     vessels: { id: { name, kind: 'onggi'|'baekja'|'yugi'|'wood'|'iron', kid } }
//     fishClasses: { small | trout | bottom: { name, kid, families: [...], standIn: [{id, name}] } }
//     pantry: [itemId]        the 찬장's staples (zero-value items; three of each per real day)
//     dishes: { DISH_…: { id, name, emoji, kind: 'fish'|'jang'|'field'|'jeongseon', vessel, look, outdoor?,
//               ingredients: [{ fish: class, n } | { item, n, base? } | { season: [itemIds], n, base } | { item, n, opt: true }],
//               steps: [{ station, action, seconds, heat?, count?, note, kid }], result: { serves }, kid, safety?,
//               origin, sources: [{ label, url }] } }
//     limits: { bookMax, tableMax, catchMax, pantryPerDay }
//     content: { education, quizzes, deck, quests, achievements }   merged by mergeContent() (idempotent)
//     fishFor(cls, speciesList?) -> [{ id, itemId, name }]     the species of a class that may be cooked (never a
//               protected one: G.data.fish.species[].protected); the stand-in list until 34-fish-data.js is in the build
//     obtainable() -> Set(itemIds)   items a player can get (crops, jar products, shop, crafts, pantry)
//   }
// Ingredient forms: fish = any non-protected species of the class (FISH_<ID> items of lane fishing); item = taken from
// the bag or the 곳간; base = the kitchen supplies a little when the bag has none (no item appears, nothing is sold);
// season = any one of the listed jar products from the player's own jars (better stars) — else the kitchen's own
// seasoning (`base`); opt = used when the bag has it (a little better), never required.
// Freshwater fish is always cooked through; every fish dish says why in one calm sentence (`safety`). No health claims.
// Sources (own words, paraphrased): 한국민족문화대백과사전 (E…), 국립민속박물관 한국민속대백과사전 (F…), 질병관리청.
// Notes with the research: the lane's notes-sources.txt (scratch) — summarised in docs by the docs lane.
// =============================================================================
(function () {
  const E = (id, t) => ({ label: '한국민족문화대백과사전' + (t ? ' · ' + t : ''), url: 'https://encykorea.aks.ac.kr/Article/' + id });
  const F = (id, t) => ({ label: '국립민속박물관 한국민속대백과사전' + (t ? ' · ' + t : ''), url: 'https://folkency.nfm.go.kr/topic/detail/' + id });
  const KDCA = { label: '질병관리청 국가건강정보포털 · 간흡충증', url: 'https://health.kdca.go.kr/healthinfo/biz/health/gnrlzHealthInfo/gnrlzHealthInfo/gnrlzHealthInfoView.do?cntnts_sn=6294' };
  const RDA = { label: '농촌진흥청 국립농업과학원 · 한식 자료', url: 'https://koreanfood.rda.go.kr/' };
  const SAFE = '민물고기 속에는 눈에 안 보이는 아주 작은 벌레가 살 수 있어서, 속까지 푹 익혀 먹어요.';

  // ---------------------------------------------------------------- kitchen staples (the 찬장; zero value: never sold)
  const STAPLES = {
    ITEM_POTATO: { name: '감자', icon: '🥔', desc: '정선 비탈밭에서 잘 자라는 감자예요. 갈아서 옹심이와 감자전을 만들어요.' },
    ITEM_GONDEURE: { name: '말린 곤드레', icon: '🌿', desc: '봄에 뜯어 삶아 말린 곤드레 나물이에요. 물에 불려 곤드레밥을 지어요.' },
    ITEM_MEMIL: { name: '메밀가루', icon: '🌾', desc: '메밀을 맷돌에 갈아 낸 가루예요. 전병과 콧등치기국수를 만들어요.' },
    ITEM_SUSU: { name: '찰수수가루', icon: '🌾', desc: '붉은 찰수수를 빻은 가루예요. 익반죽해 부꾸미를 지져요.' },
    ITEM_PAT: { name: '팥소', icon: '🫘', desc: '팥을 삶아 으깨 단맛을 낸 소예요. 부꾸미 속에 넣어요.' },
    ITEM_DEULGIREUM: { name: '들기름', icon: '🫗', desc: '들깨를 볶아 짠 고소한 기름이에요. 나물을 무치고 전을 부쳐요.' },
    ITEM_MILGARU: { name: '밀가루', icon: '🌾', desc: '밀을 곱게 빻은 가루예요. 전과 튀김옷을 만들어요.' },
    ITEM_GUKSU: { name: '마른 국수', icon: '🍜', desc: '밀가루 반죽을 가늘게 뽑아 말린 국수예요.' },
    ITEM_SANNAMUL: { name: '말린 산나물', icon: '🥬', desc: '고사리·취나물 같은 산나물을 말려 둔 것이에요. 불려서 무쳐요.' },
  };
  G.data.items = G.data.items || {};
  for (const [id, s] of Object.entries(STAPLES)) {
    if (G.data.items[id]) continue;
    G.data.items[id] = { id, name: s.name, type: 'ingredient', icon: s.icon, price: 0, sell: 0, desc: s.desc + ' (부엌 찬장)', stack: true, max: 99, kitchen: true };
  }

  // ---------------------------------------------------------------- stations
  const stations = {
    muldumeong: { name: '물두멍', emoji: '💧', kid: '물로 깨끗이 씻어요', does: '부엌의 큰 물독이에요. 재료를 씻고, 생선을 만진 도마와 손도 씻어요.' },
    doma: { name: '도마', emoji: '🪵', kid: '도마에서 손질해요', does: '도마 위에서 재료를 손질하고 반죽하고 빚어요. 칼은 어른이 쓰고, 아이는 씻고 빚고 담아요.' },
    gamasot: { name: '아궁이와 가마솥', emoji: '🍲', kid: '불 때고 끓여요', does: '아궁이에 장작을 넣어 불을 때고 가마솥에 밥을 짓고 국을 끓여요. 밥은 끓은 뒤 불을 줄여 뜸을 들여요.' },
    hwaro: { name: '화로와 석쇠', emoji: '♨️', kid: '숯불에 구워요', does: '숯불이 담긴 화로에 석쇠를 얹어 생선을 굽고, 작은 냄비로 조림과 찌개를 끓여요.' },
    sotttukkeong: { name: '솥뚜껑', emoji: '🍳', kid: '솥뚜껑에 부쳐요', does: '무쇠 솥뚜껑을 뒤집어 돌 위에 걸고 기름을 둘러 전을 부치고 지져요.' },
    siru: { name: '시루', emoji: '♨️', kid: '김으로 쪄요', does: '바닥에 구멍이 난 질그릇이에요. 솥에서 올라온 김으로 감자·옥수수·생선을 쪄요.' },
    maetdol: { name: '맷돌과 절구', emoji: '⚙️', kid: '갈고 찧어요', does: '맷돌은 돌을 돌려 곡식과 감자를 갈고, 절구는 공이로 콩과 곡식을 찧어요.' },
    yangnyeom: { name: '양념 선반', emoji: '🏺', kid: '내 장으로 맛을 내요', does: '내가 장독대에서 담근 간장·된장·고추장·김치·식초가 놓이는 선반이에요. 내 장을 쓰면 맛이 더 깊어져요.' },
    chanjang: { name: '찬장', emoji: '🗄️', kid: '재료를 꺼내요', does: '감자·메밀가루·곤드레처럼 부엌에 늘 두는 재료가 들어 있어요. 하루에 조금씩 꺼내 쓸 수 있어요.' },
    soban: { name: '소반', emoji: '🍽️', kid: '상을 차려요', does: '다 된 음식을 그릇에 담아 작은 밥상 소반에 올려요. 먹거나 이웃과 나누거나 사진을 찍어요.' },
    hwadeok: { name: '냇가 화덕', emoji: '🔥', kid: '냇가에서 구워요', does: '냇가에 돌을 쌓아 만든 화덕이에요. 갓 잡은 물고기를 굽고 끓여요. 옛날 천렵 날처럼요.' },
  };

  // ---------------------------------------------------------------- actions (37-cooking.js gives each its mechanic)
  // hold = keep pressing (progress only while held) · taps = n calm taps (≥ 0.6 s apart) · wait = watch (a timer) ·
  // fire = keep the flame in the band (hold to feed wood; it sinks slowly) · window = press when it is ready (≥ 2 s) ·
  // pick = choose a seasoning tile · tap = one press
  const actions = {
    wash: { verb: '씻기', emoji: '💧', mode: 'hold', kid: '꾹 누르고 있으면 깨끗이 씻겨요' },
    scale: { verb: '비늘 긁기', emoji: '🐟', mode: 'hold', kid: '꼬리에서 머리 쪽으로 살살 긁어요' },
    trim: { verb: '손질하기', emoji: '🪵', mode: 'hold', kid: '어른이 손질하는 동안 꾹 눌러 도와요' },
    rinse: { verb: '도마 씻기', emoji: '🧽', mode: 'hold', kid: '물고기를 만진 도마와 손을 씻어요' },
    salt: { verb: '소금 뿌리기', emoji: '🧂', mode: 'taps', kid: '천천히 세 번 톡톡 뿌려요' },
    soak: { verb: '불리기', emoji: '🫧', mode: 'wait', kid: '물에 담가 말랑해질 때까지 기다려요' },
    fire: { verb: '불 때기', emoji: '🔥', mode: 'fire', kid: '장작을 넣어 불꽃을 초록 칸에 맞춰요' },
    add: { verb: '넣기', emoji: '🥣', mode: 'tap', kid: '재료를 넣어요' },
    pour: { verb: '물 붓기', emoji: '🫗', mode: 'hold', kid: '꾹 눌러 물을 부어요' },
    stir: { verb: '젓기', emoji: '🥄', mode: 'hold', kid: '꾹 누르고 있으면 천천히 저어요' },
    boil: { verb: '끓이기', emoji: '🫕', mode: 'wait', kid: '보글보글 끓을 때까지 기다려요' },
    steam: { verb: '찌기', emoji: '♨️', mode: 'wait', kid: '김이 오를 때까지 기다려요' },
    grill: { verb: '굽기', emoji: '♨️', mode: 'wait', kid: '가장자리가 노릇해질 때까지 봐요' },
    turn: { verb: '뒤집기', emoji: '🔄', mode: 'window', kid: '노릇해지면 지금 뒤집어요' },
    fry: { verb: '지지기', emoji: '🍳', mode: 'wait', kid: '지글지글 익을 때까지 봐요' },
    knead: { verb: '반죽하기', emoji: '🤲', mode: 'hold', kid: '꾹 누르고 있으면 조물조물 반죽해요' },
    shape: { verb: '빚기', emoji: '⚪', mode: 'taps', kid: '하나씩 천천히 빚어요' },
    spread: { verb: '펴기', emoji: '🫓', mode: 'hold', kid: '얇게 펴요' },
    roll: { verb: '말기', emoji: '🌯', mode: 'tap', kid: '돌돌 말아요' },
    grind: { verb: '맷돌 돌리기', emoji: '⚙️', mode: 'hold', kid: '꾹 누르고 있으면 맷돌이 돌아가요' },
    pound: { verb: '절구 찧기', emoji: '🪵', mode: 'taps', kid: '쿵 — 쿵 — 천천히 찧어요' },
    season: { verb: '양념하기', emoji: '🏺', mode: 'pick', kid: '어떤 장으로 맛을 낼까요?' },
    mix: { verb: '무치기', emoji: '🥢', mode: 'hold', kid: '조물조물 무쳐요' },
    rest: { verb: '뜸 들이기', emoji: '⏳', mode: 'wait', kid: '불을 줄이고 기다려요' },
    strain: { verb: '거르기', emoji: '🫗', mode: 'hold', kid: '체에 걸러 가시를 골라내요' },
    drop: { verb: '내리기', emoji: '💧', mode: 'hold', kid: '구멍 바가지로 찬물에 똑똑 내려요' },
    arrange: { verb: '돌려 담기', emoji: '🌀', mode: 'taps', kid: '동그랗게 한 마리씩 돌려 놓아요' },
    brush: { verb: '양념 바르기', emoji: '🖌️', mode: 'hold', kid: '양념을 골고루 발라요' },
    serve: { verb: '담기', emoji: '🍽️', mode: 'tap', kid: '그릇에 담아 소반에 올려요' },
  };

  // ---------------------------------------------------------------- vessels (bowls and plates people would name)
  const vessels = {
    ttukbaegi: { name: '뚝배기', kind: 'onggi', kid: '흙으로 빚은 뚝배기' },
    onggi_bowl: { name: '옹기 대접', kind: 'onggi', kid: '옹기 대접' },
    baekja_plate: { name: '백자 접시', kind: 'baekja', kid: '하얀 백자 접시' },
    baekja_long: { name: '백자 긴 접시', kind: 'baekja', kid: '생선을 담는 긴 백자 접시' },
    baekja_bowl: { name: '백자 대접', kind: 'baekja', kid: '하얀 백자 대접' },
    yugi_bowl: { name: '놋 대접', kind: 'yugi', kid: '반짝이는 놋 대접' },
    yugi_jubal: { name: '놋 주발', kind: 'yugi', kid: '뚜껑 있는 놋 밥그릇' },
    sotttukkeong: { name: '솥뚜껑째', kind: 'iron', kid: '무쇠 솥뚜껑 그대로' },
    chaebang: { name: '채반', kind: 'wood', kid: '대나무 채반' },
  };

  // ---------------------------------------------------------------- fish classes (lane fishing names the species)
  const fishClasses = {
    small: { name: '작은 냇물고기', kid: '피라미 같은 작은 물고기', families: ['잉어과', '모래무지아과', '피라미아과', '황어아과'],
      standIn: [{ id: 'PIRAMI', name: '피라미' }, { id: 'GALGYEONI', name: '갈겨니' }, { id: 'BEODEULCHI', name: '버들치' }] },
    trout: { name: '송어 무리', kid: '산천어 같은 물고기', families: ['연어과'],
      standIn: [{ id: 'SANCHEONEO', name: '산천어' }] },
    bottom: { name: '바닥에 사는 물고기', kid: '메기·꺽지 같은 물고기', families: ['메기과', '동자개과', '퉁가리과', '꺽지과'],
      standIn: [{ id: 'MEGI', name: '메기' }, { id: 'KKEOKJI', name: '꺽지' }, { id: 'DONGJAGAE', name: '동자개' }] },
  };

  // ---------------------------------------------------------------- dishes
  const S = (station, action, seconds, note, kid, o) => Object.assign({ station, action, seconds, note, kid }, o || {});
  const WASH_FISH = (n) => [
    S('muldumeong', 'wash', 6, '물고기를 맑은 물에 여러 번 헹궈요.', '물고기를 깨끗이 씻어요'),
    S('doma', 'scale', 6, '비늘을 꼬리에서 머리 쪽으로 긁어 내요.', '비늘을 살살 긁어요'),
    S('doma', 'trim', 6, '어른이 배 속을 깨끗이 비우고 지느러미를 다듬어요.', n > 1 ? '어른이 손질하는 걸 도와요' : '어른이 손질해요'),
    S('muldumeong', 'rinse', 4, '민물고기를 만진 도마와 손은 바로 씻어 따로 써요.', '도마와 손을 씻어요'),
  ];
  const dishes = {
    // ============================================================ the river's catch
    DISH_SOGEUMGUI: {
      name: '민물고기 소금구이', emoji: '🐟', kind: 'fish', vessel: 'baekja_long', outdoor: true,
      look: { type: 'grill', fish: 'trout', count: 1, garnish: 'scallion' },
      ingredients: [{ fish: 'trout', n: 1 }, { item: 'ITEM_SALT', n: 1, base: true }, { item: 'ITEM_SCALLION', n: 1, opt: true }],
      steps: [...WASH_FISH(1),
        S('doma', 'salt', 6, '굵은 소금을 앞뒤로 고루 뿌려 잠시 둬요.', '소금을 톡톡 뿌려요', { count: 3 }),
        S('hwaro', 'fire', 10, '숯불이 빨갛게 고루 살아나면 석쇠를 얹어요.', '숯불을 알맞게 피워요', { heat: 'mid' }),
        S('hwaro', 'grill', 12, '한쪽 가장자리가 노릇해질 때까지 기다려요.', '노릇해지는 걸 봐요'),
        S('hwaro', 'turn', 6, '한 번만 조심히 뒤집어요. 자주 뒤집으면 살이 부서져요.', '지금 뒤집어요!'),
        S('hwaro', 'grill', 12, '두꺼운 등 쪽까지 속이 하얗게 익어야 해요.', '속까지 푹 익혀요'),
        S('soban', 'serve', 2, '긴 접시에 머리를 왼쪽으로 담아요.', '접시에 담아요')],
      kid: '소금만 뿌려 숯불에 구운 물고기예요. 냇가에서 잡아 바로 구웠어요.',
      safety: SAFE, origin: '냇가 마을 어디서나 즐기던 구이예요. 석쇠는 숯불 위에 올려 굽는 옛 도구예요.',
      sources: [F('7751', '석쇠'), KDCA],
    },
    DISH_MAEUNTANG: {
      name: '민물 매운탕', emoji: '🍲', kind: 'fish', vessel: 'ttukbaegi', outdoor: true,
      look: { type: 'stew', broth: ['#c9a27a', '#b5401f'], chunks: ['fish', 'radish', 'scallion'], fish: 'bottom' },
      ingredients: [{ fish: 'bottom', n: 1 }, { item: 'ITEM_RADISH', n: 1, base: true }, { season: ['ITEM_GOCHUJANG', 'ITEM_DOENJANG'], n: 1, base: true },
        { item: 'ITEM_GOCHUGARU', n: 1, opt: true }, { item: 'ITEM_SCALLION', n: 1, opt: true }, { item: 'ITEM_GARLIC', n: 1, opt: true }],
      steps: [...WASH_FISH(1),
        S('gamasot', 'pour', 4, '솥에 물을 붓고 무를 넓게 썰어 깔아요.', '물을 부어요'),
        S('gamasot', 'fire', 10, '센 불로 물을 끓여요.', '불을 세게 때요', { heat: 'high' }),
        S('yangnyeom', 'season', 4, '고추장을 풀고 된장을 조금 더하면 비린 맛이 줄어요.', '장을 골라 풀어요'),
        S('gamasot', 'add', 2, '물이 끓으면 물고기를 넣어요.', '물고기를 넣어요'),
        S('gamasot', 'boil', 16, '민물 매운탕은 푹 끓일수록 맛이 들어요. 속살까지 하얗게 익혀요.', '보글보글 푹 끓여요'),
        S('gamasot', 'add', 2, '마지막에 파와 마늘을 넣어요.', '파를 넣어요'),
        S('soban', 'serve', 2, '뚝배기에 담아 김이 날 때 내요.', '뚝배기에 담아요')],
      kid: '물고기를 고추장 국물에 푹 끓인 얼큰한 탕이에요.',
      safety: SAFE, origin: '냇가에서 잡은 물고기를 솥에 끓여 함께 먹던 천렵의 음식이에요.',
      sources: [E('E0017976', '매운탕'), E('E0055834', '천렵'), KDCA],
    },
    DISH_EOJUK: {
      name: '어죽', emoji: '🥣', kind: 'fish', vessel: 'yugi_bowl',
      look: { type: 'porridge', broth: ['#d8c6a4', '#c06a3a'], chunks: ['rice', 'scallion'] },
      ingredients: [{ fish: 'small', n: 2 }, { item: 'ITEM_MEPSSAL', n: 1, base: true }, { season: ['ITEM_GOCHUJANG', 'ITEM_DOENJANG'], n: 1, base: true }, { item: 'ITEM_SCALLION', n: 1, opt: true }],
      steps: [...WASH_FISH(2),
        S('muldumeong', 'soak', 6, '쌀을 미리 물에 불려 둬요.', '쌀을 불려요'),
        S('gamasot', 'fire', 10, '물고기를 통째로 넣고 센 불로 끓여요.', '불을 세게 때요', { heat: 'high' }),
        S('gamasot', 'boil', 14, '살이 뭉그러질 만큼 푹 고아요.', '푹 고아요'),
        S('gamasot', 'strain', 8, '체에 걸러 뼈와 가시를 골라내고 국물만 받아요.', '체에 걸러요'),
        S('yangnyeom', 'season', 4, '고추장을 풀어 간을 맞춰요.', '장을 풀어요'),
        S('gamasot', 'add', 2, '불린 쌀을 넣어요.', '쌀을 넣어요'),
        S('gamasot', 'stir', 14, '쌀이 바닥에 붙지 않게 천천히 저으며 퍼질 때까지 쑤어요.', '천천히 저어요', { heat: 'low' }),
        S('soban', 'serve', 2, '놋 대접에 떠 파를 얹어요.', '대접에 담아요')],
      kid: '물고기를 푹 고아 가시를 거르고 쌀을 넣어 쑨 죽이에요.',
      safety: SAFE, origin: '강과 냇가 마을의 죽이에요. 물고기를 푹 고아 살을 발라 쌀과 쑤었어요.',
      sources: [E('E0036113', '어죽'), KDCA],
    },
    DISH_DORIBAENGBAENG: {
      name: '도리뱅뱅이', emoji: '🌀', kind: 'fish', vessel: 'sotttukkeong', outdoor: true,
      look: { type: 'round', fish: 'small', count: 9, glaze: '#a8321e' },
      ingredients: [{ fish: 'small', n: 3 }, { item: 'ITEM_DEULGIREUM', n: 1, base: true }, { season: ['ITEM_GOCHUJANG'], n: 1, base: true }, { item: 'ITEM_GARLIC', n: 1, opt: true }],
      steps: [...WASH_FISH(3),
        S('sotttukkeong', 'fire', 8, '솥뚜껑을 달구고 기름을 넉넉히 둘러요.', '솥뚜껑을 달궈요', { heat: 'mid' }),
        S('sotttukkeong', 'arrange', 8, '머리를 가운데로 모아 동그랗게 돌려 담아요. 그래서 이름이 도리뱅뱅이에요.', '동그랗게 돌려 놓아요', { count: 5 }),
        S('sotttukkeong', 'fry', 14, '바삭해질 때까지 기름에 지져요.', '바삭하게 지져요'),
        S('yangnyeom', 'season', 4, '고추장에 마늘을 넣어 양념장을 만들어요.', '양념장을 골라요'),
        S('sotttukkeong', 'brush', 6, '양념장을 골고루 바르고 조금 더 지져요.', '양념을 발라요'),
        S('soban', 'serve', 2, '솥뚜껑째 상에 올려요.', '그대로 상에 올려요')],
      kid: '작은 물고기를 동그랗게 돌려 담아 바삭하게 지진 음식이에요.',
      safety: SAFE, origin: '금강 가 마을(충청북도 옥천 들)에서 즐기는 음식이에요. 동그랗게 돌려 담아 이름이 붙었어요.',
      sources: [{ label: '문화일보 · 이우석의 푸드로지 (도리뱅뱅이·매운탕·어죽)', url: 'https://www.munhwa.com/article/11248786' }, KDCA],
    },
    DISH_EOTANGGUKSU: {
      name: '어탕국수', emoji: '🍜', kind: 'fish', vessel: 'onggi_bowl',
      look: { type: 'noodlesoup', broth: ['#d2b48a', '#b8562c'], noodle: '#efe4c8', chunks: ['scallion'] },
      ingredients: [{ fish: 'small', n: 2 }, { item: 'ITEM_GUKSU', n: 1 }, { season: ['ITEM_GOCHUJANG', 'ITEM_DOENJANG'], n: 1, base: true }, { item: 'ITEM_SCALLION', n: 1, opt: true }],
      steps: [...WASH_FISH(2),
        S('gamasot', 'fire', 10, '물고기를 넣고 센 불로 끓여요.', '불을 세게 때요', { heat: 'high' }),
        S('gamasot', 'boil', 14, '살이 풀어지도록 푹 고아요.', '푹 고아요'),
        S('gamasot', 'strain', 8, '체에 걸러 뼈를 골라내요.', '체에 걸러요'),
        S('yangnyeom', 'season', 4, '고추장을 풀어 얼큰하게 해요.', '장을 풀어요'),
        S('gamasot', 'add', 2, '마른 국수를 넣어요.', '국수를 넣어요'),
        S('gamasot', 'boil', 10, '국수가 투명해지도록 삶아요.', '국수를 삶아요'),
        S('soban', 'serve', 2, '옹기 대접에 담아요.', '대접에 담아요')],
      kid: '물고기를 푹 끓인 국물에 국수를 넣은 음식이에요.',
      safety: SAFE, origin: '어죽에 쌀 대신 국수를 넣은 음식이에요. 경상도에서 즐겨 먹어요.',
      sources: [F('7879', '어탕국수'), KDCA],
    },
    DISH_TWIGIM: {
      name: '민물고기 튀김', emoji: '🍤', kind: 'fish', vessel: 'chaebang',
      look: { type: 'fried', fish: 'small', count: 6, batter: '#e6c27a' },
      ingredients: [{ fish: 'small', n: 2 }, { item: 'ITEM_MILGARU', n: 1 }, { item: 'ITEM_DEULGIREUM', n: 1, base: true }, { item: 'ITEM_SALT', n: 1, base: true }],
      steps: [...WASH_FISH(2),
        S('doma', 'knead', 6, '밀가루에 찬물을 넣어 묽은 튀김옷을 만들어요.', '튀김옷을 만들어요'),
        S('sotttukkeong', 'fire', 8, '기름을 넉넉히 달궈요. 기름이 튀니 멀찍이 서요.', '기름을 달궈요', { heat: 'mid' }),
        S('sotttukkeong', 'fry', 12, '튀김옷을 입혀 노릇해질 때까지 튀겨요.', '노릇하게 튀겨요'),
        S('sotttukkeong', 'turn', 6, '한 번 뒤집어 반대쪽도 익혀요.', '지금 뒤집어요!'),
        S('sotttukkeong', 'fry', 8, '속까지 익도록 조금 더 튀겨요.', '속까지 익혀요'),
        S('soban', 'serve', 2, '채반에 건져 기름을 빼요.', '채반에 건져요')],
      kid: '작은 물고기에 튀김옷을 입혀 바삭하게 튀겼어요.',
      safety: SAFE, origin: '작은 냇물고기를 통째로 튀겨 뼈까지 바삭하게 먹어요.',
      sources: [RDA, KDCA],
    },
    DISH_JORIM: {
      name: '민물고기 조림', emoji: '🥘', kind: 'fish', vessel: 'baekja_plate',
      look: { type: 'braise', fish: 'bottom', count: 1, sauce: '#7a3414', chunks: ['radish'] },
      ingredients: [{ fish: 'bottom', n: 1 }, { item: 'ITEM_RADISH', n: 1, base: true }, { season: ['ITEM_GANJANG', 'ITEM_GOCHUJANG'], n: 1, base: true }, { item: 'ITEM_GOCHUGARU', n: 1, opt: true }],
      steps: [...WASH_FISH(1),
        S('hwaro', 'pour', 4, '냄비 바닥에 무를 깔고 물을 조금 부어요.', '무를 깔고 물을 부어요'),
        S('yangnyeom', 'season', 4, '간장에 고춧가루를 풀어 양념장을 만들어요.', '양념장을 골라요'),
        S('hwaro', 'fire', 8, '중간 불로 끓여요.', '불을 알맞게 해요', { heat: 'mid' }),
        S('hwaro', 'boil', 14, '양념을 끼얹으며 국물이 졸아들 때까지 익혀요.', '국물이 졸아들어요'),
        S('soban', 'serve', 2, '접시에 무와 함께 담아요.', '접시에 담아요')],
      kid: '무를 깔고 간장 양념에 졸인 물고기예요.',
      safety: SAFE, origin: '집집마다 즐기던 조림이에요. 무가 양념을 머금어 맛있어요.',
      sources: [RDA, KDCA],
    },
    DISH_JJIM: {
      name: '산천어 찜', emoji: '♨️', kind: 'fish', vessel: 'baekja_long',
      look: { type: 'steamed_fish', fish: 'trout', count: 1, sauce: '#8a4a22', garnish: 'scallion' },
      ingredients: [{ fish: 'trout', n: 1 }, { season: ['ITEM_GANJANG'], n: 1, base: true }, { item: 'ITEM_SCALLION', n: 1, opt: true }, { item: 'ITEM_GINGER', n: 1, opt: true }],
      steps: [...WASH_FISH(1),
        S('gamasot', 'fire', 10, '솥에 물을 붓고 끓여 김을 올려요.', '불을 때요', { heat: 'high' }),
        S('siru', 'add', 2, '시루에 물고기를 얹어요.', '시루에 얹어요'),
        S('siru', 'steam', 16, '김이 시루 위로 오르고 살이 하얗게 익을 때까지 쪄요.', '김이 오를 때까지 기다려요'),
        S('yangnyeom', 'season', 4, '간장에 파와 생강을 넣어 양념장을 끼얹어요.', '양념장을 골라요'),
        S('soban', 'serve', 2, '긴 접시에 담아요.', '접시에 담아요')],
      kid: '시루에 김을 올려 촉촉하게 찐 물고기예요.',
      safety: SAFE, origin: '김으로 익히면 살이 부드럽고 촉촉해요. 시루는 떡을 찌던 그릇이에요.',
      sources: [E('E0036113', '어죽 (민물고기 음식)'), KDCA],
    },
    DISH_CHEONRYEOPGUK: {
      name: '천렵국', emoji: '🏞️', kind: 'fish', vessel: 'onggi_bowl', outdoor: true,
      look: { type: 'stew', broth: ['#cdb08a', '#a8542a'], chunks: ['fish', 'squash', 'scallion'], fish: 'small' },
      ingredients: [{ fish: 'small', n: 2 }, { item: 'ITEM_POTATO', n: 1 }, { season: ['ITEM_GOCHUJANG', 'ITEM_DOENJANG'], n: 1, base: true }, { item: 'ITEM_SCALLION', n: 1, opt: true }],
      steps: [
        S('muldumeong', 'wash', 6, '냇물에 물고기를 헹궈요.', '냇물에 씻어요'),
        S('doma', 'trim', 6, '어른이 납작한 돌 위에서 손질해요.', '어른이 손질해요'),
        S('muldumeong', 'rinse', 4, '손을 깨끗이 헹궈요.', '손을 씻어요'),
        S('gamasot', 'fire', 10, '화덕에 솥을 걸고 마른 나뭇가지로 불을 때요.', '불을 때요', { heat: 'high' }),
        S('yangnyeom', 'season', 4, '고추장과 된장을 풀어요.', '장을 풀어요'),
        S('gamasot', 'add', 2, '물고기와 감자를 넣어요.', '물고기와 감자를 넣어요'),
        S('gamasot', 'boil', 16, '감자가 포슬하게 익고 물고기 속까지 익을 때까지 끓여요.', '푹 끓여요'),
        S('soban', 'serve', 2, '함께 온 사람들과 나눠 떠요.', '나눠 담아요')],
      kid: '냇가에서 잡은 물고기를 솥에 바로 끓여 다 같이 먹는 국이에요.',
      safety: SAFE, origin: '여름에 냇가에서 고기를 잡고 솥을 걸어 끓여 먹던 천렵 날의 국이에요.',
      sources: [E('E0055834', '천렵'), KDCA],
    },

    // ============================================================ the jars' 장 and 김치
    DISH_DOENJANGGUK: {
      name: '된장국', emoji: '🥣', kind: 'jang', vessel: 'yugi_bowl',
      look: { type: 'soup', broth: ['#d9c9a8', '#9c7140'], chunks: ['cabbage', 'scallion'] },
      ingredients: [{ item: 'ITEM_CABBAGE', n: 1, base: true }, { season: ['ITEM_DOENJANG', 'ITEM_MAKJANG'], n: 1, base: true }, { item: 'ITEM_SCALLION', n: 1, opt: true }],
      steps: [
        S('muldumeong', 'wash', 6, '배추 잎을 한 장씩 씻어요.', '배추를 씻어요'),
        S('gamasot', 'pour', 4, '솥에 물을 부어요.', '물을 부어요'),
        S('gamasot', 'fire', 8, '물을 끓여요.', '불을 때요', { heat: 'mid' }),
        S('yangnyeom', 'season', 4, '체에 된장을 대고 풀어요. 내가 담근 된장이면 더 구수해요.', '된장을 골라 풀어요'),
        S('gamasot', 'add', 2, '배추를 넣어요.', '배추를 넣어요'),
        S('gamasot', 'boil', 12, '배추가 부드러워질 때까지 끓여요.', '보글보글 끓여요'),
        S('soban', 'serve', 2, '놋 대접에 떠요.', '대접에 담아요')],
      kid: '내가 담근 된장을 풀어 끓인 구수한 국이에요.',
      origin: '된장은 메주로 담가 장 가르기를 해서 얻어요. 된장국은 날마다 밥상에 오르던 국이에요.',
      sources: [RDA],
    },
    DISH_KIMCHIJEON: {
      name: '김치전', emoji: '🥞', kind: 'jang', vessel: 'baekja_plate',
      look: { type: 'pancake', color: ['#efe2c2', '#d98a4a'], dots: '#b8331f' },
      ingredients: [{ item: 'ITEM_KIMCHI', n: 1 }, { item: 'ITEM_MILGARU', n: 1 }, { item: 'ITEM_DEULGIREUM', n: 1, base: true }],
      steps: [
        S('doma', 'trim', 4, '김치를 잘게 썰어요 (어른이).', '어른이 김치를 썰어요'),
        S('doma', 'knead', 6, '밀가루에 물과 김치 국물을 넣어 반죽해요.', '반죽을 섞어요'),
        S('sotttukkeong', 'fire', 8, '솥뚜껑을 달구고 들기름을 둘러요.', '솥뚜껑을 달궈요', { heat: 'mid' }),
        S('sotttukkeong', 'spread', 4, '반죽을 얇게 펴요.', '얇게 펴요'),
        S('sotttukkeong', 'fry', 10, '가장자리가 바삭해질 때까지 지져요.', '지글지글 지져요'),
        S('sotttukkeong', 'turn', 6, '한 번에 뒤집어요.', '지금 뒤집어요!'),
        S('sotttukkeong', 'fry', 8, '뒷면도 노릇하게 지져요.', '뒷면도 지져요'),
        S('soban', 'serve', 2, '접시에 담아요.', '접시에 담아요')],
      kid: '잘 익은 김치를 넣어 부친 전이에요.',
      origin: '새콤하게 익은 김치로 부치면 맛이 좋아요. 김치는 젖산균이 익혀요.',
      sources: [RDA],
    },
    DISH_MUSAENGCHAE: {
      name: '무생채', emoji: '🥗', kind: 'jang', vessel: 'baekja_bowl',
      look: { type: 'salad', color: '#e05a3a', base: '#f3efe2' },
      ingredients: [{ item: 'ITEM_RADISH', n: 1 }, { item: 'ITEM_GOCHUGARU', n: 1, base: true }, { season: ['ITEM_VINEGAR', 'ITEM_GAMSIKCHO', 'ITEM_HYEONMISIKCHO'], n: 1, base: true }, { item: 'ITEM_SALT', n: 1, base: true }],
      steps: [
        S('muldumeong', 'wash', 6, '무를 깨끗이 씻어요.', '무를 씻어요'),
        S('doma', 'trim', 6, '무를 가늘게 채 썰어요 (어른이).', '어른이 채를 썰어요'),
        S('doma', 'salt', 4, '소금을 조금 뿌려 살짝 절여요.', '소금을 톡톡', { count: 3 }),
        S('yangnyeom', 'season', 4, '고춧가루로 물들이고 식초로 새콤하게 해요.', '식초를 골라요'),
        S('doma', 'mix', 8, '조물조물 무쳐요.', '조물조물 무쳐요'),
        S('soban', 'serve', 2, '백자 대접에 담아요.', '대접에 담아요')],
      kid: '무를 가늘게 썰어 새콤달콤 무친 반찬이에요.',
      origin: '가을 무로 만든 반찬이에요. 내가 빚은 식초를 쓰면 향이 좋아요.',
      sources: [RDA],
    },
    DISH_CHEONGGUKJANG: {
      name: '청국장찌개', emoji: '🫕', kind: 'jang', vessel: 'ttukbaegi',
      look: { type: 'stew', broth: ['#cdb48c', '#8c6234'], chunks: ['bean', 'kimchi', 'scallion'] },
      ingredients: [{ season: ['ITEM_CHEONGGUKJANG'], n: 1, base: true }, { item: 'ITEM_KIMCHI', n: 1, opt: true }, { item: 'ITEM_RADISH', n: 1, base: true }],
      steps: [
        S('doma', 'trim', 4, '무와 김치를 먹기 좋게 썰어요 (어른이).', '어른이 썰어요'),
        S('hwaro', 'pour', 4, '뚝배기에 물을 붓고 무를 넣어요.', '물을 부어요'),
        S('hwaro', 'fire', 8, '화로 불에 뚝배기를 올려요.', '불을 알맞게', { heat: 'mid' }),
        S('yangnyeom', 'season', 4, '청국장을 넣어요. 오래 끓이지 않아야 맛이 살아요.', '청국장을 골라요'),
        S('hwaro', 'boil', 10, '한소끔만 끓여요.', '한소끔 끓여요'),
        S('soban', 'serve', 2, '뚝배기째 올려요.', '뚝배기째 올려요')],
      kid: '볏짚으로 띄운 청국장을 넣어 끓인 찌개예요.',
      origin: '청국장은 삶은 콩을 볏짚과 따뜻하게 두어 2~3일 만에 띄우는 빠른 장이에요.',
      sources: [RDA],
    },
    DISH_BIBIMBAP: {
      name: '산채비빔밥', emoji: '🍚', kind: 'jang', vessel: 'yugi_bowl',
      look: { type: 'bibim', rice: '#f4f0e6', toppings: ['#5d7a33', '#8a5a2e', '#e0b23a', '#c53b25'] },
      ingredients: [{ item: 'ITEM_SANNAMUL', n: 1 }, { item: 'ITEM_MEPSSAL', n: 1, base: true }, { season: ['ITEM_GOCHUJANG'], n: 1, base: true }, { item: 'ITEM_DEULGIREUM', n: 1, base: true }],
      steps: [
        S('muldumeong', 'soak', 6, '말린 산나물을 물에 불려요.', '나물을 불려요'),
        S('muldumeong', 'wash', 6, '쌀을 씻어 일어요.', '쌀을 씻어요'),
        S('gamasot', 'fire', 10, '밥물이 끓을 때까지 센 불로 때요.', '불을 세게', { heat: 'high' }),
        S('gamasot', 'rest', 10, '끓으면 불을 줄여 뜸을 들여요.', '뜸을 들여요'),
        S('doma', 'mix', 6, '불린 나물을 들기름에 조물조물 무쳐요.', '나물을 무쳐요'),
        S('yangnyeom', 'season', 4, '고추장을 한 숟가락 얹어요.', '고추장을 골라요'),
        S('soban', 'serve', 2, '밥 위에 나물을 돌려 얹어요.', '밥에 나물을 얹어요')],
      kid: '산에서 난 나물을 밥에 얹고 고추장에 비벼 먹어요.',
      origin: '강원도 산골에서는 봄에 뜯어 말린 산나물을 겨우내 먹었어요.',
      sources: [RDA],
    },

    // ============================================================ the fields' crops
    DISH_OKSUSU: {
      name: '찐 옥수수', emoji: '🌽', kind: 'field', vessel: 'chaebang',
      look: { type: 'corn', count: 3 },
      ingredients: [{ item: 'ITEM_CORN', n: 2 }, { item: 'ITEM_SALT', n: 1, base: true }],
      steps: [
        S('doma', 'trim', 6, '껍질을 한두 겹 남기고 벗겨요.', '껍질을 벗겨요'),
        S('gamasot', 'pour', 4, '솥에 물을 붓고 소금을 조금 넣어요.', '물을 부어요'),
        S('gamasot', 'fire', 8, '물을 끓여 김을 올려요.', '불을 때요', { heat: 'high' }),
        S('siru', 'add', 2, '시루에 옥수수를 담아요.', '시루에 담아요'),
        S('siru', 'steam', 14, '알이 통통하고 반짝일 때까지 쪄요.', '김이 오를 때까지 기다려요'),
        S('soban', 'serve', 2, '채반에 건져요.', '채반에 담아요')],
      kid: '밭에서 딴 옥수수를 시루에 쪘어요.',
      origin: '강원도에서는 옥수수를 강냉이라고 불러요. 여름에 쪄서 즐겨 먹어요.',
      sources: [F('7908', '옥수수밥')],
    },
    DISH_GAMJA: {
      name: '찐 감자', emoji: '🥔', kind: 'field', vessel: 'chaebang',
      look: { type: 'potato', count: 5 },
      ingredients: [{ item: 'ITEM_POTATO', n: 2 }, { item: 'ITEM_SALT', n: 1, base: true }],
      steps: [
        S('muldumeong', 'wash', 6, '흙을 깨끗이 씻어요.', '감자를 씻어요'),
        S('gamasot', 'fire', 8, '솥에 물을 붓고 끓여요.', '불을 때요', { heat: 'high' }),
        S('siru', 'add', 2, '시루에 감자를 담아요.', '시루에 담아요'),
        S('siru', 'steam', 16, '젓가락이 쑥 들어가면 다 익었어요.', '김이 오를 때까지 기다려요'),
        S('soban', 'serve', 2, '껍질이 터져 포슬하면 다 됐어요.', '채반에 담아요')],
      kid: '포슬포슬하게 찐 감자예요.',
      origin: '정선 같은 산골 비탈밭은 감자가 잘 자라요. 쌀이 귀할 때 든든한 먹거리였어요.',
      sources: [E('E0076609', '감자옹심이')],
    },
    DISH_GAMJAJEON: {
      name: '감자전', emoji: '🥔', kind: 'field', vessel: 'baekja_plate',
      look: { type: 'pancake', color: ['#efe6cf', '#d9a050'], dots: '#4f7a2c' },
      ingredients: [{ item: 'ITEM_POTATO', n: 2 }, { item: 'ITEM_DEULGIREUM', n: 1, base: true }, { item: 'ITEM_SALT', n: 1, base: true }, { item: 'ITEM_SCALLION', n: 1, opt: true }],
      steps: [
        S('muldumeong', 'wash', 6, '감자를 씻어 껍질을 벗겨요.', '감자를 씻어요'),
        S('maetdol', 'grind', 10, '강판이나 맷돌에 감자를 갈아요.', '감자를 갈아요'),
        S('doma', 'strain', 6, '물기를 짜고 가라앉은 앙금을 다시 섞어요.', '물기를 짜요'),
        S('sotttukkeong', 'fire', 8, '솥뚜껑에 들기름을 둘러 달궈요.', '솥뚜껑을 달궈요', { heat: 'mid' }),
        S('sotttukkeong', 'spread', 4, '동그랗게 펴요.', '동그랗게 펴요'),
        S('sotttukkeong', 'fry', 10, '가장자리가 바삭해지면', '지글지글 지져요'),
        S('sotttukkeong', 'turn', 6, '뒤집어요.', '지금 뒤집어요!'),
        S('sotttukkeong', 'fry', 8, '뒷면도 노릇하게 지져요.', '뒷면도 지져요'),
        S('soban', 'serve', 2, '접시에 담아요.', '접시에 담아요')],
      kid: '감자를 갈아 쫀득하고 바삭하게 부친 전이에요.',
      origin: '강원도의 대표 감자 음식이에요. 앙금(녹말)이 쫀득함을 줘요.',
      sources: [F('7322', '감자옹심이')],
    },
    DISH_KONGBAP: {
      name: '콩밥', emoji: '🍚', kind: 'field', vessel: 'yugi_jubal',
      look: { type: 'rice', rice: '#f3eee2', mix: '#a07a3c', nurungji: true },
      ingredients: [{ item: 'ITEM_BEAN', n: 1 }, { item: 'ITEM_MEPSSAL', n: 1, base: true }],
      steps: [
        S('muldumeong', 'soak', 6, '콩을 미리 물에 불려 둬요.', '콩을 불려요'),
        S('muldumeong', 'wash', 6, '쌀을 씻어 일어요.', '쌀을 씻어요'),
        S('gamasot', 'add', 2, '쌀 위에 콩을 얹고 물을 맞춰요.', '콩을 얹어요'),
        S('gamasot', 'fire', 10, '밥물이 끓을 때까지 센 불로 때요.', '불을 세게', { heat: 'high' }),
        S('gamasot', 'rest', 12, '불을 줄여 뜸을 들이면 솥 바닥에 누룽지가 생겨요.', '뜸을 들여요'),
        S('soban', 'serve', 2, '놋 주발에 담아요. 누룽지는 숭늉으로 끓여요.', '주발에 담아요')],
      kid: '밭에서 거둔 콩을 넣어 지은 밥이에요.',
      origin: '가마솥 밥은 바닥에 누룽지가 생겨요. 누룽지에 물을 부어 끓이면 숭늉이 돼요.',
      sources: [F('8432', '아궁이')],
    },
    DISH_BAECHUJEON: {
      name: '메밀배추전', emoji: '🥬', kind: 'field', vessel: 'baekja_plate',
      look: { type: 'leafcake', color: ['#e4dcc4', '#c9a160'], leaf: '#8fae5a' },
      ingredients: [{ item: 'ITEM_CABBAGE', n: 1 }, { item: 'ITEM_MEMIL', n: 1 }, { item: 'ITEM_DEULGIREUM', n: 1, base: true }],
      steps: [
        S('muldumeong', 'wash', 6, '배추 잎을 씻어요.', '배추를 씻어요'),
        S('doma', 'salt', 4, '소금을 뿌려 숨을 죽여요.', '소금을 톡톡', { count: 3 }),
        S('doma', 'knead', 6, '메밀가루를 물에 묽게 풀어요.', '반죽을 풀어요'),
        S('sotttukkeong', 'fire', 8, '솥뚜껑을 들기름으로 닦아 달궈요.', '솥뚜껑을 달궈요', { heat: 'mid' }),
        S('sotttukkeong', 'spread', 4, '배추 잎에 반죽을 얇게 입혀 펴요.', '배추를 펴요'),
        S('sotttukkeong', 'fry', 10, '얇게 지져요.', '지져요'),
        S('sotttukkeong', 'turn', 6, '뒤집어요.', '지금 뒤집어요!'),
        S('soban', 'serve', 2, '접시에 담아요.', '접시에 담아요')],
      kid: '배추 잎에 메밀 반죽을 입혀 얇게 부쳤어요.',
      origin: '강원도 잔칫날과 제삿날에 빠지지 않는 전이에요.',
      sources: [RDA],
    },

    // ============================================================ the table of 정선
    DISH_GONDEUREBAP: {
      name: '곤드레밥', emoji: '🌿', kind: 'jeongseon', vessel: 'yugi_jubal',
      look: { type: 'rice', rice: '#efe9d8', mix: '#4e5f2a', nurungji: true },
      ingredients: [{ item: 'ITEM_GONDEURE', n: 1 }, { item: 'ITEM_MEPSSAL', n: 1, base: true }, { item: 'ITEM_DEULGIREUM', n: 1, base: true }, { season: ['ITEM_GANJANG'], n: 1, base: true }],
      steps: [
        S('muldumeong', 'soak', 8, '말린 곤드레를 물에 불려요.', '곤드레를 불려요'),
        S('doma', 'mix', 6, '물기를 짜고 들기름과 소금으로 무쳐요.', '들기름에 무쳐요'),
        S('muldumeong', 'wash', 6, '쌀을 씻어 일어요.', '쌀을 씻어요'),
        S('gamasot', 'add', 2, '쌀 위에 곤드레를 얹어요.', '곤드레를 얹어요'),
        S('gamasot', 'fire', 10, '밥물이 끓을 때까지 센 불로 때요.', '불을 세게', { heat: 'high' }),
        S('gamasot', 'rest', 12, '불을 줄여 뜸을 들여요. 솥 바닥에 누룽지가 생겨요.', '뜸을 들여요'),
        S('yangnyeom', 'season', 4, '간장에 파·깨를 넣어 양념간장을 만들어요.', '간장을 골라요'),
        S('soban', 'serve', 2, '양념간장에 비벼 먹어요.', '주발에 담아요')],
      kid: '정선 산에서 나는 곤드레 나물을 넣어 지은 밥이에요.',
      origin: '곤드레는 강원도 산에서 나는 나물이에요. 곤드레밥은 정선의 대표 음식이에요.',
      sources: [{ label: '매일신문 · 정선 콧등치기와 황기족발 (정선 3대 향토음식)', url: 'https://www.imaeil.com/page/view/2012111007120776586' }, RDA],
    },
    DISH_KOTDEUNGCHIGI: {
      name: '콧등치기국수', emoji: '🍜', kind: 'jeongseon', vessel: 'onggi_bowl',
      look: { type: 'noodlesoup', broth: ['#cbb592', '#8f6a3e'], noodle: '#8e7a62', chunks: ['potato', 'scallion'] },
      ingredients: [{ item: 'ITEM_MEMIL', n: 1 }, { item: 'ITEM_POTATO', n: 1, opt: true }, { season: ['ITEM_DOENJANG', 'ITEM_MAKJANG'], n: 1, base: true }],
      steps: [
        S('doma', 'knead', 10, '메밀가루를 뜨거운 물로 익반죽해요.', '반죽해요'),
        S('doma', 'spread', 6, '홍두깨로 넓게 밀어요.', '얇게 밀어요'),
        S('doma', 'trim', 6, '굵게 썰어요 (어른이).', '어른이 썰어요'),
        S('gamasot', 'fire', 8, '솥에 물을 끓여요.', '불을 때요', { heat: 'high' }),
        S('yangnyeom', 'season', 4, '된장을 풀어 장국을 만들어요.', '된장을 골라요'),
        S('gamasot', 'add', 2, '국수와 감자를 넣어요.', '국수를 넣어요'),
        S('gamasot', 'boil', 12, '국수가 익을 때까지 끓여요.', '보글보글 끓여요'),
        S('soban', 'serve', 2, '후루룩 먹으면 면이 콧등을 쳐요!', '대접에 담아요')],
      kid: '굵은 메밀국수가 후루룩 콧등을 친다고 붙은 이름이에요.',
      origin: '정선 장터의 이름난 국수예요. 된장을 푼 장국에 굵은 메밀국수를 끓여요.',
      sources: [{ label: '매일신문 · 정선 콧등치기와 황기족발', url: 'https://www.imaeil.com/page/view/2012111007120776586' }],
    },
    DISH_OLCHAENGI: {
      name: '올챙이국수', emoji: '🌽', kind: 'jeongseon', vessel: 'baekja_bowl',
      look: { type: 'olchaengi', color: '#e9d27a', broth: '#8a5a2a' },
      ingredients: [{ item: 'ITEM_CORN', n: 2 }, { season: ['ITEM_GANJANG'], n: 1, base: true }, { item: 'ITEM_KIMCHI', n: 1, opt: true }],
      steps: [
        S('muldumeong', 'soak', 8, '옥수수 알을 물에 불려요.', '옥수수를 불려요'),
        S('maetdol', 'grind', 12, '맷돌에 물을 조금씩 넣으며 곱게 갈아요.', '맷돌을 돌려요'),
        S('doma', 'strain', 6, '체에 걸러 가라앉은 앙금만 모아요.', '체에 걸러요'),
        S('gamasot', 'fire', 8, '앙금을 솥에 넣고 불을 때요.', '불을 때요', { heat: 'mid' }),
        S('gamasot', 'stir', 16, '눌어붙지 않게 저으며 걸쭉해질 때까지 쑤어요.', '천천히 저어요', { heat: 'low' }),
        S('muldumeong', 'drop', 10, '구멍 뚫린 바가지에 붓고 찬물에 똑똑 떨어뜨리면 올챙이 모양으로 굳어요.', '찬물에 똑똑'),
        S('yangnyeom', 'season', 4, '양념간장을 얹어요.', '간장을 골라요'),
        S('soban', 'serve', 2, '그릇에 담아 김치를 곁들여요.', '그릇에 담아요')],
      kid: '옥수수 반죽이 찬물에 떨어지며 올챙이처럼 굳어요.',
      origin: '옥수수를 맷돌에 갈아 앙금을 쑤어 만든 강원도 음식이에요. 정선 장터에서 맛볼 수 있어요.',
      sources: [F('7912', '올챙이묵')],
    },
    DISH_ONGSIMI: {
      name: '감자옹심이', emoji: '⚪', kind: 'jeongseon', vessel: 'onggi_bowl',
      look: { type: 'dumplingsoup', broth: ['#e2d6b8', '#cdb88e'], ball: '#e9dfc3', chunks: ['squash', 'scallion'] },
      ingredients: [{ item: 'ITEM_POTATO', n: 3 }, { season: ['ITEM_GANJANG', 'ITEM_DOENJANG'], n: 1, base: true }, { item: 'ITEM_SCALLION', n: 1, opt: true }],
      steps: [
        S('muldumeong', 'wash', 6, '감자를 씻어 껍질을 벗겨요.', '감자를 씻어요'),
        S('maetdol', 'grind', 12, '강판이나 맷돌에 감자를 갈아요.', '감자를 갈아요'),
        S('doma', 'strain', 6, '건지는 꼭 짜고, 물은 두어 녹말을 가라앉혀요.', '물을 짜요'),
        S('doma', 'knead', 6, '건지와 앙금(녹말)을 섞어 반죽해요.', '반죽해요'),
        S('doma', 'shape', 8, '새알처럼 동그랗게 빚어요.', '동글동글 빚어요', { count: 5 }),
        S('gamasot', 'fire', 8, '장국을 끓여요.', '불을 때요', { heat: 'high' }),
        S('yangnyeom', 'season', 4, '간장으로 간을 해요.', '간장을 골라요'),
        S('gamasot', 'add', 2, '옹심이를 넣어요.', '옹심이를 넣어요'),
        S('gamasot', 'boil', 12, '옹심이가 동동 떠오르고 투명해질 때까지 끓여요.', '동동 떠올라요'),
        S('soban', 'serve', 2, '대접에 담아요.', '대접에 담아요')],
      kid: '감자를 갈아 새알처럼 빚어 끓인 쫀득한 음식이에요.',
      origin: '정선·영월에서 시작된 음식이에요. 옹심이는 새알심을 부르는 강원도 말이에요.',
      sources: [E('E0076609', '감자옹심이'), F('7322', '감자옹심이')],
    },
    DISH_JEONBYEONG: {
      name: '메밀전병', emoji: '🌯', kind: 'jeongseon', vessel: 'baekja_plate',
      look: { type: 'roll', color: ['#ddd3bd', '#b89a6a'], fill: '#c2452c', count: 3 },
      ingredients: [{ item: 'ITEM_MEMIL', n: 1 }, { item: 'ITEM_KIMCHI', n: 1, opt: true }, { item: 'ITEM_RADISH', n: 1, base: true }, { item: 'ITEM_DEULGIREUM', n: 1, base: true }],
      steps: [
        S('doma', 'knead', 6, '메밀가루를 미지근한 물에 아주 묽게 풀고 소금 간을 해요.', '반죽을 풀어요'),
        S('doma', 'mix', 8, '삶아 짠 무채와 김치에 양념을 해 소를 만들어요.', '소를 무쳐요'),
        S('sotttukkeong', 'fire', 8, '솥뚜껑을 들기름으로 닦아 달궈요.', '솥뚜껑을 달궈요', { heat: 'mid' }),
        S('sotttukkeong', 'spread', 6, '반죽을 아주 얇게 둥글게 펴요.', '얇게 펴요'),
        S('sotttukkeong', 'fry', 8, '한쪽만 살짝 익혀요.', '살짝 익혀요'),
        S('sotttukkeong', 'roll', 3, '소를 올리고 돌돌 말아요.', '돌돌 말아요'),
        S('soban', 'serve', 2, '접시에 담아요.', '접시에 담아요')],
      kid: '얇은 메밀 반죽에 김치 소를 넣고 돌돌 말았어요.',
      origin: '메밀이 잘 자라는 강원도의 음식이에요. 정선 장터에서 즐겨 먹어요.',
      sources: [F('7579', '메밀전병')],
    },
    DISH_BUKKUMI: {
      name: '수수부꾸미', emoji: '🥮', kind: 'jeongseon', vessel: 'baekja_plate',
      look: { type: 'halfmoon', color: ['#c99a8c', '#a3523c'], fill: '#5a2a24', count: 3 },
      ingredients: [{ item: 'ITEM_SUSU', n: 1 }, { item: 'ITEM_PAT', n: 1 }, { item: 'ITEM_DEULGIREUM', n: 1, base: true }],
      steps: [
        S('doma', 'knead', 8, '찰수수가루를 뜨거운 물로 익반죽해요.', '반죽해요'),
        S('doma', 'shape', 8, '동글납작하게 빚어요.', '동글납작 빚어요', { count: 3 }),
        S('sotttukkeong', 'fire', 8, '솥뚜껑에 들기름을 둘러 달궈요.', '솥뚜껑을 달궈요', { heat: 'mid' }),
        S('sotttukkeong', 'fry', 10, '앞뒤로 쫀득하게 지져요.', '지글지글 지져요'),
        S('sotttukkeong', 'roll', 3, '팥소를 넣고 반달로 접어요.', '반달로 접어요'),
        S('soban', 'serve', 2, '접시에 담아요.', '접시에 담아요')],
      kid: '수수 반죽을 지져 팥소를 넣고 반달로 접었어요.',
      origin: '강원도에서는 수수제비치라고도 불러요. 쫀득하고 달콤한 간식이에요.',
      sources: [F('7790', '수수부꾸미'), F('7984', '전병')],
    },
    DISH_OKSUSUBAP: {
      name: '옥수수밥', emoji: '🌽', kind: 'jeongseon', vessel: 'yugi_jubal',
      look: { type: 'rice', rice: '#f1ebd8', mix: '#e8c04a', nurungji: true },
      ingredients: [{ item: 'ITEM_CORN', n: 1 }, { item: 'ITEM_MEPSSAL', n: 1, base: true }, { item: 'ITEM_BEAN', n: 1, opt: true }],
      steps: [
        S('muldumeong', 'soak', 8, '말린 옥수수 알을 하룻밤 불린 셈 쳐요.', '옥수수를 불려요'),
        S('muldumeong', 'wash', 6, '쌀을 씻어 일어요.', '쌀을 씻어요'),
        S('gamasot', 'add', 2, '쌀과 옥수수를 섞어 물을 맞춰요.', '옥수수를 넣어요'),
        S('gamasot', 'fire', 10, '센 불로 끓여요.', '불을 세게', { heat: 'high' }),
        S('gamasot', 'rest', 12, '불을 줄여 뜸을 들여요.', '뜸을 들여요'),
        S('soban', 'serve', 2, '주발에 담아요.', '주발에 담아요')],
      kid: '강냉이(옥수수)를 넣어 지은 노란 밥이에요.',
      origin: '쌀이 귀한 강원도 산골에서 옥수수를 섞어 지었어요.',
      sources: [F('7908', '옥수수밥')],
    },
  };
  for (const [id, d] of Object.entries(dishes)) {
    d.id = id;
    d.result = d.result || { serves: 1 };
    d.steps.forEach((s, i) => { s.index = i; });
  }

  // ---------------------------------------------------------------- learning cards, quizzes, a deck, quests
  // (shapes of 45-education-data.js; merged by mergeContent — 45 assigns G.data.education / quizzes after this file
  // has loaded, so 37-cooking.js calls mergeContent() again at load, and the build's [cooking] block once in Node)
  const AUTHOR = '전통발효체험관 교육팀 (요리 자료)';
  const QR = () => ({ exp: 60, edu: 8 });
  const steps = (arr) => ({ type: 'steps', items: arr.map(([icon, label]) => ({ icon, label })), sep: '→' });
  const education = {
    EDU_COOK_FISH: {
      title: '민물고기 요리는 속까지 익혀요', cat: 'jeongseon', icon: '🐟',
      summary: '맑은 냇물의 물고기로 끓이고 굽는 우리 음식과, 민물고기를 꼭 익혀 먹는 까닭을 알아봐요.',
      pages: [
        { title: '냇가 마을의 물고기 음식', text: '냇가 마을 사람들은 잡은 물고기로 매운탕·어죽·소금구이를 만들어 먹었어요. 여름에는 냇가에 솥을 걸고 물고기를 잡아 바로 끓여 먹는 천렵을 즐겼어요.', points: ['천렵: 냇가에서 고기를 잡고 끓여 먹으며 쉬는 여름 풍속', '매운탕은 푹 끓일수록 맛이 들어요'], visual: steps([['🎣', '잡기'], ['💧', '씻기'], ['🔥', '익히기'], ['🍽️', '나누기']]) },
        { title: '왜 꼭 익혀 먹을까요?', text: SAFE + ' 그래서 회로 먹지 않고 끓이거나 구워요. 민물고기를 만진 도마와 손은 바로 씻어 다른 음식과 따로 써요.', points: ['속까지 하얗게 익히기', '도마와 손은 바로 씻기'], visual: { type: 'emoji', emoji: '🔥' } },
        { title: '보호하는 물고기는 놓아줘요', text: '열목어처럼 나라가 보호하는 물고기는 잡아도 먹지 않고 물로 돌려보내요. 맑은 물을 지켜야 물고기도 오래 살아요.', points: ['천연기념물·멸종위기 물고기는 놓아주기', '맑은 물 지키기'], visual: { type: 'emoji', emoji: '🫶' } },
      ],
      kid: { title: '물고기는 푹 익혀요', summary: '냇물고기는 속까지 푹 익혀 먹어요 🔥', slides: [{ emoji: '🎣', text: '냇가에서 잡은 물고기로 요리해요' }, { emoji: '🔥', text: '속까지 하얗게 푹 익혀요' }, { emoji: '🧽', text: '도마와 손은 바로 씻어요' }] },
      sources: [E('E0055834', '천렵'), E('E0017976', '매운탕'), KDCA], related: ['EDU_COOK_JEONGSEON'],
    },
    EDU_COOK_JEONGSEON: {
      title: '정선의 밥상', cat: 'jeongseon', icon: '🌿',
      summary: '곤드레밥·콧등치기국수·감자옹심이·메밀전병처럼 산골 정선의 땅에서 난 것으로 차린 밥상을 알아봐요.',
      pages: [
        { title: '쌀이 귀한 산골의 지혜', text: '정선은 산이 높고 밭이 비탈져 쌀보다 감자·옥수수·메밀이 잘 자랐어요. 사람들은 이 곡식으로 옹심이·올챙이국수·전병 같은 음식을 만들었어요.', points: ['감자 → 옹심이·감자전', '옥수수 → 올챙이국수·옥수수밥', '메밀 → 전병·콧등치기국수'], visual: steps([['🥔', '감자'], ['🌽', '옥수수'], ['🌾', '메밀']]) },
        { title: '곤드레밥', text: '곤드레는 강원도 산에서 나는 나물이에요. 봄에 뜯어 삶아 말려 두었다가 불려 들기름에 무쳐 밥 위에 얹어 지어요. 양념간장에 비벼 먹어요.', points: ['불리기 → 무치기 → 밥 짓기 → 뜸 들이기'], visual: { type: 'emoji', emoji: '🌿' } },
        { title: '이름이 재미있는 국수', text: '콧등치기국수는 굵은 메밀국수를 후루룩 먹을 때 면이 콧등을 친다고 붙은 이름이에요. 올챙이국수는 옥수수 반죽을 구멍 바가지로 찬물에 떨어뜨리면 올챙이처럼 굳어서 붙은 이름이에요.', points: ['콧등치기: 콧등을 치는 국수', '올챙이: 올챙이 모양으로 굳은 국수'], visual: { type: 'emoji', emoji: '🍜' } },
      ],
      kid: { title: '정선의 밥상', summary: '감자·옥수수·메밀로 맛있는 음식을 만들어요 🥔🌽', slides: [{ emoji: '🥔', text: '감자를 갈아 옹심이를 빚어요' }, { emoji: '🌽', text: '옥수수로 올챙이국수를 만들어요' }, { emoji: '🌿', text: '곤드레 나물로 밥을 지어요' }] },
      sources: [E('E0076609', '감자옹심이'), F('7579', '메밀전병'), F('7912', '올챙이묵'), F('7908', '옥수수밥')], related: ['EDU_COOK_KITCHEN'],
    },
    EDU_COOK_KITCHEN: {
      title: '옛 부엌의 살림살이', cat: 'hanok', icon: '🍚',
      summary: '아궁이와 가마솥, 시루, 물두멍, 맷돌과 절구, 소반이 부엌에서 무슨 일을 하는지 알아봐요.',
      pages: [
        { title: '아궁이와 가마솥', text: '아궁이에 장작을 넣어 불을 때면 가마솥의 밥이 끓고 방바닥 구들도 따뜻해져요. 밥이 끓으면 불을 줄여 뜸을 들여요. 솥 바닥에 생긴 누룽지에 물을 부어 끓이면 숭늉이 돼요.', points: ['센 불로 끓이고 약한 불로 뜸 들이기', '누룽지 → 숭늉'], visual: steps([['🔥', '불 때기'], ['🍚', '끓이기'], ['⏳', '뜸'], ['🥣', '숭늉']]) },
        { title: '시루와 물두멍', text: '시루는 바닥에 구멍이 뚫린 질그릇이에요. 솥 위에 얹으면 김이 구멍으로 올라와 떡과 감자를 쪄요. 물두멍은 부엌에 물을 길어 두는 큰 독이에요.', points: ['시루: 김으로 찌는 그릇', '물두멍: 부엌의 물독'], visual: { type: 'emoji', emoji: '♨️' } },
        { title: '맷돌·절구·소반', text: '맷돌은 위짝을 돌려 곡식을 갈고, 절구는 공이로 찧어요. 다 된 음식은 작은 밥상 소반에 차려 냈어요. 그릇은 옹기 뚝배기, 하얀 백자, 반짝이는 놋그릇을 썼어요.', points: ['맷돌: 갈기 · 절구: 찧기', '뚝배기·백자·놋그릇'], visual: { type: 'emoji', emoji: '🍽️' } },
      ],
      kid: { title: '옛 부엌', summary: '아궁이에 불을 때고 가마솥에 밥을 지어요 🔥', slides: [{ emoji: '🔥', text: '아궁이에 장작을 넣어 불을 때요' }, { emoji: '♨️', text: '시루에 김을 올려 쪄요' }, { emoji: '🍽️', text: '소반에 상을 차려요' }] },
      sources: [F('8432', '아궁이'), F('7751', '석쇠')], related: ['EDU_COOK_FISH'],
    },
  };
  const quiz = (edu, question, choices, answer, explain, kid) => ({ edu, question, choices, answer, explain, reward: QR(), kid });
  const quizzes = {
    QZ_COOK_FISH_1: quiz('EDU_COOK_FISH', '냇물에서 잡은 민물고기는 어떻게 먹어야 할까요?', ['날로 회를 떠서', '속까지 푹 익혀서', '얼려서 그대로', '소금만 뿌려 날로'], 1, SAFE, { q: '물고기는 어떻게 먹을까요?', choices: [{ e: '🔥', t: '푹 익혀요' }, { e: '🧊', t: '날로 먹어요' }], answer: 0, hint: '불을 생각해 봐요', why: '속까지 푹 익혀야 안전해요' }),
    QZ_COOK_FISH_2: quiz('EDU_COOK_FISH', '냇가에서 고기를 잡아 솥에 끓여 먹으며 쉬던 여름 풍속은?', ['천렵', '김장', '단오', '널뛰기'], 0, '천렵은 냇가에서 고기를 잡아 매운탕을 끓여 먹으며 하루를 즐기던 풍속이에요.', { q: '냇가에서 물고기를 끓여 먹는 날은?', choices: [{ e: '🏞️', t: '천렵' }, { e: '🥬', t: '김장' }], answer: 0, hint: '냇가를 생각해요', why: '천렵 날이에요' }),
    QZ_COOK_FISH_3: quiz('EDU_COOK_FISH', '열목어처럼 나라가 보호하는 물고기를 잡았다면?', ['요리해 먹는다', '물로 돌려보낸다', '어항에 오래 둔다', '친구에게 판다'], 1, '보호하는 물고기는 먹거나 팔지 않고 물로 돌려보내요.', { q: '보호하는 물고기를 잡았어요', ox: true, answer: false, hint: '먹어도 될까요?', why: '놓아줘요' }),
    QZ_COOK_JEONGSEON_1: quiz('EDU_COOK_JEONGSEON', '감자를 갈아 새알처럼 빚어 끓인 정선·영월의 음식은?', ['감자옹심이', '수제비', '칼국수', '만두'], 0, '감자옹심이는 갈아 낸 감자의 건지와 앙금을 섞어 빚어 장국에 끓여요.', { q: '감자로 빚은 동글동글 음식은?', choices: [{ e: '⚪', t: '옹심이' }, { e: '🥟', t: '만두' }], answer: 0, hint: '새알 모양이에요', why: '감자옹심이예요' }),
    QZ_COOK_JEONGSEON_2: quiz('EDU_COOK_JEONGSEON', '올챙이국수는 무엇으로 만들까요?', ['옥수수', '쌀', '밀', '감자'], 0, '옥수수를 맷돌에 갈아 앙금을 쑤어 구멍 바가지로 찬물에 떨어뜨려 만들어요.', { q: '올챙이국수는 무엇으로?', choices: [{ e: '🌽', t: '옥수수' }, { e: '🍚', t: '쌀' }], answer: 0, hint: '노란 곡식이에요', why: '옥수수예요' }),
    QZ_COOK_JEONGSEON_3: quiz('EDU_COOK_JEONGSEON', '곤드레밥을 지을 때 곤드레 나물은 먼저 어떻게 할까요?', ['물에 불려 들기름에 무친다', '얼린다', '기름에 튀긴다', '날로 갈아 넣는다'], 0, '말린 곤드레를 물에 불려 물기를 짜고 들기름에 무쳐 밥 위에 얹어 지어요.', null),
    QZ_COOK_KITCHEN_1: quiz('EDU_COOK_KITCHEN', '바닥에 구멍이 뚫려 김으로 음식을 찌는 그릇은?', ['시루', '뚝배기', '소반', '물두멍'], 0, '시루는 솥 위에 얹어 구멍으로 올라오는 김으로 쪄요.', { q: '김으로 찌는 그릇은?', choices: [{ e: '♨️', t: '시루' }, { e: '🍽️', t: '소반' }], answer: 0, hint: '구멍이 있어요', why: '시루예요' }),
    QZ_COOK_KITCHEN_2: quiz('EDU_COOK_KITCHEN', '가마솥 밥이 끓은 뒤에는 어떻게 할까요?', ['불을 더 세게 한다', '불을 줄여 뜸을 들인다', '물을 더 붓는다', '바로 꺼낸다'], 1, '끓으면 불을 줄여 뜸을 들여요. 솥 바닥에는 누룽지가 생겨요.', { q: '밥이 끓으면?', choices: [{ e: '⏳', t: '뜸 들여요' }, { e: '🔥', t: '더 세게' }], answer: 0, hint: '기다려요', why: '불을 줄여 뜸을 들여요' }),
  };
  for (const [id, q] of Object.entries(quizzes)) { q.id = id; if (!q.kid) delete q.kid; if (education[q.edu]) (education[q.edu].quizzes = education[q.edu].quizzes || []).push(id); }
  for (const [id, e] of Object.entries(education)) {
    e.id = id; e.author = AUTHOR; e.referenceDate = '2026-11'; e.verified = false;
    e.quizzes = e.quizzes || []; e.quiz = e.quizzes[0];
    e.pages.forEach((p, i) => { p.index = i; });
    e.source = e.sources.map((s) => s.label).filter((v, i, a) => a.indexOf(v) === i).join(' · ') + ' 내용을 쉽게 풀어 쓴 요약(교육용)';
  }
  const D = (title, picture, lines, note) => (note ? { title, picture, emoji: picture, lines, note } : { title, picture, emoji: picture, lines });
  const deck = {
    id: 'DECK_COOK', title: '민물고기 요리와 우리 장', emoji: '🍲', audience: 'all', edu: 'EDU_COOK_FISH',
    summary: '냇가에서 잡은 물고기를 우리 장으로 맛을 내 익혀 먹는 법, 정선의 밥상, 옛 부엌의 살림을 배워요.',
    slides: [
      D('냇물에서 부엌까지', '🎣', ['맑은 냇물에서 잡은 물고기를 부엌에서 요리해요.', '씻기 → 손질 → 익히기 → 상 차리기 차례로 해요.'], '부엌의 물두멍·도마·화로·가마솥에서 직접 해 볼 수 있어요.'),
      D('꼭 익혀 먹어요', '🔥', [SAFE, '민물고기를 만진 도마와 손은 바로 씻어요.']),
      D('보호하는 물고기', '🫶', ['열목어처럼 나라가 보호하는 물고기는 놓아줘요.', '도감에 기록만 하고 물로 돌려보내요.']),
      D('소금구이', '🐟', ['소금만 뿌려 숯불 석쇠에 구워요.', '가장자리가 노릇해지면 한 번만 뒤집어요.']),
      D('매운탕', '🍲', ['물이 끓으면 물고기를 넣고 고추장을 풀어요.', '민물 매운탕은 푹 끓일수록 맛이 들어요.']),
      D('어죽과 어탕국수', '🥣', ['물고기를 푹 고아 체에 걸러 가시를 골라요.', '쌀을 넣으면 어죽, 국수를 넣으면 어탕국수예요.']),
      D('도리뱅뱅이', '🌀', ['작은 물고기를 동그랗게 돌려 담아 지져요.', '고추장 양념을 발라 마무리해요.']),
      D('내 장으로 맛 내기', '🏺', ['장독대에서 담근 된장·고추장·간장을 양념 선반에서 골라요.', '내 장을 쓰면 별을 더 받아요.']),
      D('정선의 밥상', '🌿', ['곤드레밥 · 콧등치기국수 · 올챙이국수', '감자옹심이 · 메밀전병 · 수수부꾸미']),
      D('가마솥 밥과 누룽지', '🍚', ['센 불로 끓이고 약한 불로 뜸을 들여요.', '바닥의 누룽지로 숭늉을 끓여요.']),
      D('상 차리기', '🍽️', ['뚝배기 · 백자 · 놋그릇에 담아 소반에 올려요.', '이웃과 나누면 더 맛있어요.']),
      D('정리해요', '📝', ['잡기 → 씻기 → 익히기 → 나누기', '퀴즈로 오늘 배운 것을 확인해 봐요!']),
    ],
  };
  deck.kid = '냇물고기를 푹 익혀 우리 장으로 맛을 내요.';
  // quests (objective type 'interact': kind 'cooking' = a dish served, 'cookshare' = a dish shared, 'cookbook' = a new dish)
  const quests = {
    Q_COOK_FIRST: { title: '부엌에서 첫 요리', icon: '🍳', category: 'ferment', autoAccept: true, desc: '부엌(초가 안)에 들어가 음식 하나를 처음부터 끝까지 만들어 소반에 올려 보세요.', easyDesc: '부엌에서 음식을 하나 만들어요!', objectives: [{ type: 'interact', kind: 'cooking', count: 1, text: '음식 하나 만들어 소반에 올리기', easyText: '음식을 만들어요' }], reward: { coin: 500, exp: 120 } },
    Q_COOK_FISH: { title: '냇가의 맛', icon: '🐟', category: 'ferment', autoAccept: true, requires: ['Q_COOK_FIRST'], desc: '냇가에서 잡은 물고기로 요리를 두 번 해 보세요. 민물고기는 속까지 익혀요.', easyDesc: '물고기 요리를 두 번 해요!', objectives: [{ type: 'interact', kind: 'cookfish', count: 2, text: '물고기 요리 2번', easyText: '물고기 요리를 해요' }], reward: { coin: 700, exp: 160 } },
    Q_COOK_SHARE: { title: '이웃과 나누기', icon: '🤝', category: 'social', autoAccept: true, requires: ['Q_COOK_FIRST'], desc: '만든 음식을 이웃에게 나눠 보세요. 소반에서 ‘나누기’를 누르면 돼요.', easyDesc: '음식을 이웃과 나눠요!', objectives: [{ type: 'interact', kind: 'cookshare', count: 1, text: '음식 나누기', easyText: '음식을 나눠요' }], reward: { coin: 600, exp: 120 } },
    Q_COOK_BOOK: { title: '요리 도감 다섯 칸', icon: '📖', category: 'edu', autoAccept: true, requires: ['Q_COOK_FIRST'], desc: '서로 다른 음식 다섯 가지를 만들어 요리 도감을 채워 보세요.', easyDesc: '다른 음식 다섯 가지를 만들어요!', objectives: [{ type: 'interact', kind: 'cookbook', count: 5, text: '다른 음식 5가지', easyText: '새 음식을 만들어요' }], reward: { coin: 1200, exp: 250 } },
    Q_COOK_JEONGSEON: { title: '정선의 밥상 차리기', icon: '🌿', category: 'edu', autoAccept: true, requires: ['Q_COOK_FIRST'], desc: '정선의 음식(곤드레밥·콧등치기국수·올챙이국수·감자옹심이·메밀전병·수수부꾸미·옥수수밥) 가운데 세 가지를 만들어 보세요.', easyDesc: '정선 음식 세 가지를 만들어요!', objectives: [{ type: 'interact', kind: 'cookjeongseon', count: 3, text: '정선 음식 3가지', easyText: '정선 음식을 만들어요' }], reward: { coin: 1000, exp: 200 } },
  };
  // achievements: stats kept by 37-cooking.js as plain counters (dishesCooked, dishKinds, dishesShared, dishStars3)
  const achievements = {
    ACH_COOK_1: { name: '첫 상차림', icon: '🍽️', desc: '처음으로 음식을 만들어 소반에 올렸어요.', condition: { stat: 'dishesCooked', gte: 1 }, reward: { coin: 300 } },
    ACH_COOK_10: { name: '부엌 단골', icon: '🍳', desc: '음식을 10번 만들었어요.', condition: { stat: 'dishesCooked', gte: 10 }, reward: { coin: 800 } },
    ACH_COOK_KINDS_12: { name: '요리 도감 반쪽', icon: '📖', desc: '서로 다른 음식 12가지를 만들었어요.', condition: { stat: 'dishKinds', gte: 12 }, reward: { coin: 1200, title: '부엌 살림꾼' } },
    ACH_COOK_SHARE_5: { name: '나눔 밥상', icon: '🤝', desc: '음식을 다섯 번 이웃과 나눴어요.', condition: { stat: 'dishesShared', gte: 5 }, reward: { coin: 800 } },
    ACH_COOK_STARS: { name: '별 셋 요리사', icon: '⭐', desc: '별 세 개 음식을 다섯 번 만들었어요.', condition: { stat: 'dishStars3', gte: 5 }, reward: { coin: 1000 } },
  };

  const C = {
    v: 1, stations, actions, vessels, fishClasses, dishes, safety: SAFE,
    pantry: Object.keys(STAPLES),
    limits: { bookMax: 64, tableMax: 6, catchMax: 40, pantryPerDay: 3, sharedMax: 100000 },
    kinds: { fish: '냇가의 물고기', jang: '장과 김치', field: '밭에서 거둔 것', jeongseon: '정선의 밥상' },
    content: { education, quizzes, deck, quests, achievements },
    /** the species of a class that may be cooked: [{id, itemId, name}] (protected species never) */
    fishFor(cls, list) {
      const fc = fishClasses[cls];
      if (!fc) return [];
      const sp = Array.isArray(list) ? list : (G.data.fish && Array.isArray(G.data.fish.species) ? G.data.fish.species : null);
      if (sp && sp.length) {
        const out = [];
        for (const s of sp) {
          if (!s || typeof s.id !== 'string' || s.protected || s.observe || s.observationOnly) continue;
          const c = typeof s.cook === 'string' ? s.cook : null;
          const fam = String(s.family || '');
          const hit = c ? c === cls : fc.families.some((f) => fam.indexOf(f.replace(/과$/, '')) >= 0);
          if (hit) out.push({ id: s.id, itemId: 'FISH_' + s.id, name: s.name || s.id });
        }
        return out;
      }
      return fc.standIn.map((s) => ({ id: s.id, itemId: 'FISH_' + s.id, name: s.name }));
    },
    /** every item a player can get without this file's base supply: crops, jar products, the shop, crafts, the 찬장 */
    obtainable() {
      const d = G.data, set = new Set();
      for (const c of Object.values(d.crops || {})) if (c && c.harvestItem) set.add(c.harvestItem);
      for (const r of Object.values(d.recipes || {})) if (r && r.resultItem) set.add(r.resultItem);
      for (const s of Object.values(d.shops || {})) for (const id of (s.sells || [])) set.add(id);
      for (const c of Object.values(d.crafts || {})) for (const id of Object.keys(c.out || {})) set.add(id);
      for (const id of C.pantry) set.add(id);
      return set;
    },
    /** fold the cards, quizzes, deck, quests and achievements into G.data (idempotent; runs again after 45 has loaded) */
    mergeContent() {
      const d = G.data;
      const k = C.content;
      if (d.education) for (const [id, e] of Object.entries(k.education)) if (!d.education[id]) d.education[id] = e;
      if (d.quizzes) for (const [id, q] of Object.entries(k.quizzes)) if (!d.quizzes[id]) d.quizzes[id] = q;
      if (Array.isArray(d.lectureDecks) && !d.lectureDecks.some((x) => x && x.id === k.deck.id)) d.lectureDecks.push(k.deck);
      if (d.quests) for (const [id, q] of Object.entries(k.quests)) if (!d.quests[id]) { q.id = id; q.objectives.forEach((o, i) => { o.index = i; o.count = o.count || 1; }); d.quests[id] = q; }
      if (d.achievements) for (const [id, a] of Object.entries(k.achievements)) if (!d.achievements[id]) { a.id = id; d.achievements[id] = a; }
      return true;
    },
  };
  G.data.cooking = C;
  C.mergeContent();
})();
