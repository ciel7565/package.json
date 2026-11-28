// =============================================================================
// 02-avatar-data.js — the avatar's option table as plain data (CONTRACT §17.7, §19.1 — lane hanbok)
//
//   G.data.avatar = {
//     v,                      table version (3 = phase 11: hanbok only — 겉옷 `outer`, own slots for 꾸미개, dyes, sets)
//     options { key: [ids | '#rrggbb'] }   every choice there is (20-avatar.js draws exactly this table)
//     colorKeys [key]                      the keys whose values are colours
//     legacy { key: [ids] }                ids older saves may still carry (accepted by the server, turned into their
//                                          hanbok counterpart by G.avatar.normalize through `migrate`)
//     migrate { key: { oldId: { key2: value | '$colourKey' } } }   the hanbok counterpart of every legacy id
//     slots [{ key, name, colorKey, empty }]   the keys that are things to wear (lane wardrobe makes them items)
//     names { key: { id: '이름' } }        the Hangul name of every option (items, tiles, the character sheet)
//     about { key: { id: '…' } }           one calm line per piece: what it is, who wore it, when
//     dyes [{ id, name, hex }]             the named traditional dyes (every colour list of a garment is made of them)
//     expressions [{ id, name, say }]      the nine calm faces (rig.setExpression(id); `expr` = the usual face)
//     defaults { key: value }              the look of a NEW profile (style `real`, an everyday hanbok)
//     presets [{ id, emoji, label, say, app }]   the 갖춤 (sets): ready-made looks, the first six are the title picks
//   }
// Pure data (no THREE, no DOM): tools/build.mjs evaluates the 01- / 02- fragments in Node and exports `options` +
// `legacy` + `colorKeys` into game-data.json, where Tfm\Presence (the whitelist behind SaveValidator and the presence /
// sync looks) reads which ids are allowed. Change a list here and both sides follow after the next build.
// Hanbok only (§19.0): no modern garment is in `options`; an old save that still wears one is dressed in its hanbok
// counterpart by `migrate` — it never breaks, and the server keeps accepting the old ids.
// Notes on each piece (shape, wearer, occasion) and their sources: docs of lane hanbok, phase 11.
// =============================================================================
(function () {
  // ---------------------------------------------------------------- the named dyes (전통 색이름)
  // [id, name, hex] — every hex value of the phase-9 lists is kept (renamed after the dye it is closest to)
  const DYE = [
    ['so', '소색', '#f1ece1'], ['baek', '흰색', '#ffffff'], ['seolbaek', '설백', '#e9e4da'], ['mosi', '모시색', '#e8d9b5'],
    ['sambe', '삼베색', '#c9b38f'], ['songhwa', '송화색', '#f2e18c'], ['chija', '치자색', '#ffd766'], ['hwang', '황색', '#f4c54a'],
    ['juhwang', '주황', '#ff9f6b'], ['dahong', '다홍', '#d9534f'], ['yeonji', '연지', '#c23a4a'], ['dohwa', '도화색', '#f7c6d0'],
    ['bunhong', '분홍', '#f08bb0'], ['hongmae', '홍매색', '#b45a73'], ['jaju', '자주', '#8a3b4b'], ['jajeok', '자적색', '#6e3b4e'],
    ['bora', '보라', '#8b6fd6'], ['ok', '옥색', '#a8d8c8'], ['bi', '비색', '#8fbfa8'], ['cheoncheong', '천청색', '#6fc3df'],
    ['cheong', '청색', '#4a78c8'], ['nam', '남색', '#3b5ba5'], ['jjok', '쪽빛', '#24508e'], ['gam', '감색', '#2e3f6e'],
    ['acheong', '아청', '#2c3540'], ['cheongrok', '청록', '#2f6f8f'], ['chorok', '초록', '#2f7d4a'], ['yeondu', '연두', '#9bd27a'],
    ['ssuk', '쑥색', '#6d8f4e'], ['jinnok', '진녹색', '#3f5a3c'], ['songrok', '송록', '#2f5a3c'], ['dotori', '도토리색', '#7a6a55'],
    ['gal', '갈색', '#7a5a43'], ['godong', '고동색', '#5a4636'], ['meokhoe', '먹회색', '#3c3934'], ['meok', '먹색', '#3a3d42'],
    ['heuk', '흑색', '#1f1f22'], ['geum', '금색', '#e2c27a'],
  ];
  const dyes = DYE.map(([id, name, hex]) => ({ id, name, hex }));
  const D = Object.fromEntries(DYE.map(([id, , hex]) => [id, hex]));
  const hexes = (ids) => ids.map((id) => D[id]);
  const ALL_DYES = DYE.filter(([id]) => id !== 'geum').map((d) => d[2]);

  const options = {
    style: ['real', 'cute'],
    skin: ['#fde3cf', '#f6d0b1', '#efc6a2', '#e6b48d', '#d9a77f', '#c68b62', '#a86d48', '#7d4f33'],
    face: ['smile', 'calm', 'cheer', 'gentle', 'bright'],
    expr: ['neutral', 'smile', 'laugh', 'surprise', 'curious', 'proud', 'shy', 'sleepy', 'focus'],
    hair: ['short', 'long', 'bun', 'ponytail', 'buzz', 'curly', 'daenggi', 'jjok', 'sangtu', 'pigtails', 'side', 'wave', 'bangs', 'twinbraid',
      'eonjeun', 'saengang', 'ttaeun', 'keunmeori', 'gwimit'],
    hairColor: ['#1f1a18', '#2f2520', '#3a2a20', '#4a3a2c', '#6b4a2e', '#8a5a34', '#b07a45', '#d9b26f', '#b9b4ad', '#6e3b4e'],
    beard: ['none', 'mustache', 'goatee', 'long'],
    // 쓰개 (headwear)
    hat: ['none', 'gat', 'chorip', 'paeraengi', 'jeollip', 'satgat', 'yugeon', 'jeongja', 'tanggeon', 'bokgeon', 'hogeon', 'gulle', 'jobawi', 'ayam',
      'nambawi', 'pungcha', 'jokduri', 'hwagwan', 'jeonmo', 'gokkal', 'sangmo', 'strawhat', 'sugeon', 'samo'],
    hatColor: ['#1f1f22', '#2e3f6e', '#6e2f4e', '#8a3b4b', '#2f5a3c', '#e2c27a', '#d9534f', '#f4c54a', '#ffffff', '#3b5ba5',
      D.so, D.sambe, D.meok, D.jaju, D.ok, D.dahong],
    // 겉옷 (worn over the 저고리)
    outer: ['none', 'durumagi', 'dopo', 'cheollik', 'kwaeja', 'dapho', 'jeonbok', 'gugunbok', 'jangot', 'sseugae', 'baeja', 'magoja', 'jokki',
      'dangui', 'wonsam', 'hwarot', 'kkachi', 'nubi', 'dallyeong', 'hakchang', 'haengju'],
    outerColor: ALL_DYES.slice(),
    // 저고리 (top)
    top: ['hanbok', 'banhoejang', 'samhoejang', 'saekdong', 'kkaekki', 'nubi', 'jeoksam', 'som', 'saenghwal'],
    topColor: ALL_DYES.slice(),
    trimColor: ALL_DYES.slice(),
    // 옷감과 무늬 (fabric and pattern) — no written characters in any pattern
    pattern: ['none', 'geumbak', 'cloud', 'flower', 'saekdong', 'gyeokja', 'jul', 'nubi', 'mosi', 'myeongju', 'gwigap', 'mulgyeol'],
    // 아래옷 (bottom)
    bottom: ['skirt', 'tongchima', 'seuran', 'daeran', 'mongdang', 'pants', 'pungcha', 'jambang', 'nubibaji', 'saenghwal'],
    bottomColor: ALL_DYES.slice(),
    // 신 (footwear)
    footwear: ['gomusin', 'kkotsin', 'danghye', 'unhye', 'taesahye', 'jipsin', 'mituri', 'namaksin', 'mokhwa', 'gatsin'],
    shoes: ['#f5f0e6', '#ffffff', '#2a1d14', '#1f1f22', '#7a4a2c', '#d9534f', '#3b5ba5', '#e2c27a', '#b45a73', '#2f7d4a', D.dohwa, D.ok, D.jaju, D.gam],
    // 꾸미개 — each in a slot of its own
    norigae: ['none', 'danjak', 'samjak', 'nabi', 'bangul'],
    norigaeColor: hexes(['dahong', 'yeonji', 'jaju', 'jajeok', 'bunhong', 'chorok', 'ok', 'nam', 'hwang', 'geum']),
    pouch: ['none', 'durujumeoni', 'gwijumeoni', 'bokjumeoni'],
    pouchColor: hexes(['dahong', 'jaju', 'bunhong', 'chija', 'chorok', 'ok', 'nam', 'gam', 'jajeok', 'hwang']),
    fan: ['none', 'hapjuk', 'danseon', 'pacho'],
    hairpin: ['none', 'binyeo', 'okbinyeo', 'tteoljam', 'dwikkoji'],
    ribbon: ['none', 'jebi', 'doturak', 'baessi'],
    ribbonColor: hexes(['dahong', 'yeonji', 'jaju', 'bunhong', 'nam', 'gam', 'chorok', 'heuk']),
    belt: ['none', 'sejodae', 'gwangdahoe', 'jeondae', 'gakdae', 'saekdi'],
    beltColor: hexes(['dahong', 'nam', 'jajeok', 'gam', 'chorok', 'hwang', 'heuk', 'so', 'ok', 'jaju']),
    bag: ['none', 'botjim', 'gwaenari', 'basket', 'bojagi'],
    bagColor: ['#8a5a3b', '#6b4a2e', '#b88a4a', '#2f7d4a', '#3b5ba5', '#d9534f', '#f4c54a', '#3a3d42', D.ok, D.jaju, D.so],
    accessoryColor: ['#d9534f', '#8a3b4b', '#f4c54a', '#2f7d4a', '#3b5ba5', '#6e3b4e', '#ffffff', '#1f1f22', '#e2c27a', '#cfcac2'],
  };
  const colorKeys = ['skin', 'hairColor', 'hatColor', 'topColor', 'outerColor', 'trimColor', 'bottomColor', 'shoes', 'bagColor',
    'accessoryColor', 'norigaeColor', 'pouchColor', 'ribbonColor', 'beltColor'];

  // the keys that are things to wear (CONTRACT §19.1): one item per value, `empty` is the id of "nothing" (null = always
  // something), colorKey = the dye row that goes with it (null = none)
  const slots = [
    { key: 'outer', name: '겉옷', colorKey: 'outerColor', empty: 'none' },
    { key: 'top', name: '저고리', colorKey: 'topColor', empty: null },
    { key: 'bottom', name: '아래옷', colorKey: 'bottomColor', empty: null },
    { key: 'hat', name: '쓰개', colorKey: 'hatColor', empty: 'none' },
    { key: 'footwear', name: '신', colorKey: 'shoes', empty: null },
    { key: 'hair', name: '머리', colorKey: 'hairColor', empty: null },
    { key: 'pattern', name: '옷감과 무늬', colorKey: null, empty: 'none' },
    { key: 'norigae', name: '노리개', colorKey: 'norigaeColor', empty: 'none' },
    { key: 'pouch', name: '주머니', colorKey: 'pouchColor', empty: 'none' },
    { key: 'fan', name: '부채', colorKey: 'accessoryColor', empty: 'none' },
    { key: 'hairpin', name: '머리꽂이', colorKey: 'accessoryColor', empty: 'none' },
    { key: 'ribbon', name: '댕기', colorKey: 'ribbonColor', empty: 'none' },
    { key: 'belt', name: '띠', colorKey: 'beltColor', empty: 'none' },
    { key: 'bag', name: '짐', colorKey: 'bagColor', empty: 'none' },
  ];

  // phase ≤ 10 ids: modern clothes, hats once kept as accessories, pieces that now have their own key
  const legacy = {
    accessory: ['none', 'norigae', 'bokjumeoni', 'fan', 'daenggi', 'glasses', 'beard', 'strawhat', 'headband', 'cap', 'gat'],
    top: ['tshirt', 'hoodie', 'shirt', 'jacket', 'apron', 'baeja', 'kwaeja', 'durumagi', 'dangui'],
    bottom: ['shorts'],
    footwear: ['sneakers'],
    hat: ['cap', 'headband'],
    bag: ['backpack', 'pouch'],
  };
  // the hanbok counterpart of every legacy id: { key2: value } — '$key' copies that key's colour of the old look
  const migrate = {
    accessory: {
      norigae: { norigae: 'samjak', norigaeColor: '$accessoryColor' }, bokjumeoni: { pouch: 'bokjumeoni', pouchColor: '$accessoryColor' },
      fan: { fan: 'hapjuk' }, daenggi: { ribbon: 'jebi', ribbonColor: '$accessoryColor' }, glasses: {}, beard: { beard: 'mustache' }, none: {},
    },
    top: {
      tshirt: { top: 'jeoksam' }, hoodie: { top: 'nubi' }, shirt: { top: 'hanbok' }, jacket: { top: 'hanbok', outer: 'magoja' },
      apron: { top: 'jeoksam', outer: 'haengju', outerColor: '$topColor', topColor: D.so },
      baeja: { top: 'hanbok', outer: 'baeja' }, kwaeja: { top: 'hanbok', outer: 'kwaeja' }, durumagi: { top: 'hanbok', outer: 'durumagi' },
      dangui: { top: 'hanbok', outer: 'dangui', outerColor: '$topColor' },
    },
    bottom: { shorts: { bottom: 'jambang' } },
    footwear: { sneakers: { footwear: 'gomusin' } },
    hat: { cap: { hat: 'paeraengi' }, headband: { hat: 'sugeon' } },
    bag: { backpack: { bag: 'gwaenari' }, pouch: { bag: 'none', pouch: 'durujumeoni', pouchColor: '$bagColor' } },
  };

  // ---------------------------------------------------------------- names (Hangul) and one line about each piece
  const names = {
    outer: {
      none: '겉옷 없음', durumagi: '두루마기', dopo: '도포', cheollik: '철릭', kwaeja: '쾌자', dapho: '답호', jeonbok: '전복', gugunbok: '구군복',
      jangot: '장옷', sseugae: '쓰개치마', baeja: '배자', magoja: '마고자', jokki: '조끼', dangui: '당의', wonsam: '원삼', hwarot: '활옷',
      kkachi: '까치두루마기', nubi: '누비 두루마기', dallyeong: '단령', hakchang: '학창의', haengju: '행주치마',
    },
    top: {
      hanbok: '민저고리', banhoejang: '반회장저고리', samhoejang: '삼회장저고리', saekdong: '색동저고리', kkaekki: '깨끼저고리', nubi: '누비저고리',
      jeoksam: '적삼', som: '솜저고리', saenghwal: '생활한복 저고리',
    },
    bottom: {
      skirt: '풀치마', tongchima: '통치마', seuran: '스란치마', daeran: '대란치마', mongdang: '몽당치마', pants: '사폭바지', pungcha: '풍차바지',
      jambang: '잠방이', nubibaji: '누비바지', saenghwal: '생활한복 바지',
    },
    hat: {
      none: '안 써요', gat: '갓', chorip: '초립', paeraengi: '패랭이', jeollip: '전립', satgat: '삿갓', yugeon: '유건', jeongja: '정자관', tanggeon: '탕건',
      bokgeon: '복건', hogeon: '호건', gulle: '굴레', jobawi: '조바위', ayam: '아얌', nambawi: '남바위', pungcha: '풍차', jokduri: '족두리', hwagwan: '화관',
      jeonmo: '전모', gokkal: '고깔', sangmo: '상모', strawhat: '밀짚모자', sugeon: '머릿수건', samo: '사모',
    },
    footwear: {
      gomusin: '고무신', kkotsin: '꽃신', danghye: '당혜', unhye: '운혜', taesahye: '태사혜', jipsin: '짚신', mituri: '미투리', namaksin: '나막신',
      mokhwa: '목화', gatsin: '갖신',
    },
    hair: {
      short: '단발머리', long: '긴 생머리', bun: '올림머리', ponytail: '하나 묶음', buzz: '짧은 머리', curly: '곱슬머리', daenggi: '댕기머리', jjok: '쪽머리',
      sangtu: '상투', pigtails: '양갈래', side: '옆가르마', wave: '물결 머리', bangs: '앞머리 단발', twinbraid: '양갈래 땋기',
      eonjeun: '얹은머리', saengang: '새앙머리', ttaeun: '땋은머리', keunmeori: '큰머리', gwimit: '귀밑머리',
    },
    pattern: {
      none: '민무늬', geumbak: '금박', cloud: '구름무늬', flower: '꽃무늬', saekdong: '색동', gyeokja: '격자무늬', jul: '줄무늬', nubi: '누비 줄',
      mosi: '모시 결', myeongju: '명주 윤', gwigap: '거북등무늬', mulgyeol: '물결무늬',
    },
    norigae: { none: '안 달아요', danjak: '단작노리개', samjak: '삼작노리개', nabi: '나비노리개', bangul: '방울노리개' },
    pouch: { none: '안 차요', durujumeoni: '두루주머니', gwijumeoni: '귀주머니', bokjumeoni: '복주머니' },
    fan: { none: '안 들어요', hapjuk: '합죽선', danseon: '단선', pacho: '파초선' },
    hairpin: { none: '안 꽂아요', binyeo: '비녀', okbinyeo: '옥비녀', tteoljam: '떨잠', dwikkoji: '뒤꽂이' },
    ribbon: { none: '안 매요', jebi: '제비부리댕기', doturak: '도투락댕기', baessi: '배씨댕기' },
    belt: { none: '안 매요', sejodae: '세조대', gwangdahoe: '광다회', jeondae: '전대', gakdae: '각대', saekdi: '삼색띠' },
    bag: { none: '없음', botjim: '봇짐', gwaenari: '괴나리봇짐', basket: '바구니', bojagi: '보자기' },
    beard: { none: '수염 없음', mustache: '콧수염', goatee: '염소수염', long: '긴 수염' },
    expr: {
      neutral: '무표정', smile: '미소', laugh: '활짝 웃음', surprise: '놀람', curious: '궁금', proud: '뿌듯', shy: '수줍음', sleepy: '졸림', focus: '집중',
    },
  };
  const about = {
    outer: {
      durumagi: '밖에 나갈 때 저고리 위에 입는 긴 겉옷이에요. 남자도 여자도 입었어요.',
      dopo: '선비가 나들이나 제사 때 입던 긴 겉옷이에요. 뒤에 자락이 한 겹 더 있어요.',
      cheollik: '허리 아래에 주름을 잡은 긴 옷이에요. 무관과 관리가 입었어요.',
      kwaeja: '소매가 없는 긴 조끼 옷이에요. 돌날이나 명절에 아이들도 입었어요.',
      dapho: '소매가 짧거나 없는 겉옷이에요. 철릭 위에 덧입었어요.',
      jeonbok: '소매가 없고 뒤가 트인 긴 옷이에요. 군인이 입었어요.',
      gugunbok: '붉은 소매의 동달이 위에 전복을 입고 전대를 맨 무관의 옷이에요.',
      jangot: '여자가 밖에 나갈 때 머리에서부터 덮어 쓰던 긴 옷이에요.',
      sseugae: '치마처럼 생긴 천을 머리에 써서 얼굴을 가리던 쓰개예요.',
      baeja: '저고리 위에 덧입는 따뜻한 조끼예요. 가장자리에 털을 달기도 해요.',
      magoja: '저고리 위에 입는 단추 달린 덧옷이에요. 고름 대신 단추를 채워요.',
      jokki: '주머니가 달린 조끼예요. 저고리 위에 입어요.',
      dangui: '궁중과 양반가 여자가 저고리 위에 입던 예복이에요. 옆이 길게 트였어요.',
      wonsam: '혼례 날 신부나 궁중 여자가 입던 큰 예복이에요. 소매가 색동이에요.',
      hwarot: '혼례 날 신부가 입던 붉은 예복이에요. 꽃과 새를 수놓았어요.',
      kkachi: '설날 아이들이 입던 오색 두루마기예요. 까치설빔이라고 불러요.',
      nubi: '솜을 넣고 줄줄이 누빈 따뜻한 겨울 두루마기예요.',
      dallyeong: '깃이 둥근 관리의 옷이에요. 혼례 날 신랑도 입었어요.',
      hakchang: '흰 옷 가장자리에 검은 선을 두른 선비의 옷이에요.',
      haengju: '부엌일을 할 때 치마 위에 두르는 앞치마예요.',
    },
    top: {
      hanbok: '깃과 고름이 옷과 같은 색인 수수한 저고리예요.',
      banhoejang: '깃, 고름, 끝동만 다른 색으로 꾸민 저고리예요.',
      samhoejang: '깃, 고름, 끝동에 겨드랑이 곁마기까지 다른 색인 저고리예요.',
      saekdong: '소매에 여러 색 줄을 이어 붙인 아이들의 명절 저고리예요.',
      kkaekki: '얇은 천을 두 겹으로 곱게 박은 여름 저고리예요.',
      nubi: '솜을 넣고 줄을 따라 누빈 겨울 저고리예요.',
      jeoksam: '안감 없이 홑겹으로 지은 여름 윗옷이에요. 일할 때도 입었어요.',
      som: '솜을 두어 포근한 겨울 저고리예요.',
      saenghwal: '요즘 입기 편하게 만든 단정한 생활한복 윗옷이에요.',
    },
    bottom: {
      skirt: '허리에 둘러 입는 긴 치마예요. 주름이 많아 풍성해요.',
      tongchima: '뒤가 막힌 통으로 된 치마예요. 걷기 편하게 조금 짧아요.',
      seuran: '아랫단에 금박 띠를 두른 긴 예복 치마예요.',
      daeran: '금박 띠를 두 줄 두른 아주 긴 예복 치마예요.',
      mongdang: '일하기 좋게 짧게 지은 치마예요.',
      pants: '폭이 넉넉한 바지예요. 발목을 대님으로 묶어요.',
      pungcha: '뒤가 트인 아이들의 바지예요.',
      jambang: '무릎까지 오는 짧은 일 바지예요.',
      nubibaji: '솜을 넣고 누빈 따뜻한 겨울 바지예요.',
      saenghwal: '발목을 오므린 편한 생활한복 바지예요.',
    },
    hat: {
      gat: '말총으로 엮은 챙이 넓은 검은 갓이에요. 어른 남자가 썼어요.', chorip: '풀로 엮은 작은 갓이에요. 혼인한 젊은이가 썼어요.',
      paeraengi: '대나무를 엮은 갓이에요. 보부상과 서민이 썼어요.', jeollip: '털로 만든 무관의 모자예요. 공작 깃을 달았어요.',
      satgat: '비와 햇볕을 가리는 큰 삿갓이에요. 나그네가 썼어요.', yugeon: '향교와 서원의 유생이 쓰던 검은 두건이에요.',
      jeongja: '층층이 솟은 선비의 집 안 모자예요. 훈장님이 썼어요.', tanggeon: '갓 아래에 받쳐 쓰던 작은 망건 모자예요.',
      bokgeon: '검은 천으로 만든 두건이에요. 돌날 아이와 학동이 썼어요.', hogeon: '호랑이 얼굴을 수놓은 아이의 모자예요.',
      gulle: '어린아이가 쓰던 알록달록한 모자예요.', jobawi: '귀를 덮는 여자의 겨울 쓰개예요.', ayam: '이마를 덮는 여자의 겨울 쓰개예요. 붉은 술이 달려요.',
      nambawi: '귀와 목덜미까지 덮는 따뜻한 겨울 모자예요.', pungcha: '볼과 귀를 덮는 겨울 모자예요.',
      jokduri: '혼례 날 신부가 쓰던 작은 관이에요.', hwagwan: '꽃으로 꾸민 예식 날의 관이에요.', jeonmo: '대오리에 종이를 바른 여자의 햇볕 가리개예요.',
      gokkal: '풍물놀이 때 쓰는 종이꽃 고깔이에요.', sangmo: '풍물놀이 때 끈을 돌리는 모자예요.', strawhat: '밭일할 때 쓰는 밀짚모자예요.',
      sugeon: '일할 때 머리에 두르는 수건이에요.', samo: '관리와 혼례 날 신랑이 쓰던 검은 모자예요.',
    },
    footwear: {
      gomusin: '고무로 만든 편한 신이에요.', kkotsin: '꽃을 수놓은 고운 신이에요.', danghye: '여자의 가죽신이에요. 코에 무늬가 있어요.',
      unhye: '구름무늬를 놓은 여자의 비단 신이에요.', taesahye: '남자 양반의 가죽신이에요.', jipsin: '볏짚으로 삼은 신이에요.',
      mituri: '삼 껍질로 곱게 삼은 신이에요. 짚신보다 튼튼해요.', namaksin: '비 오는 날 신던 나무 신이에요.',
      mokhwa: '관리와 무관이 신던 목이 긴 신이에요.', gatsin: '가죽으로 지은 신이에요.',
    },
    norigae: { danjak: '술이 하나인 노리개예요.', samjak: '세 갈래로 늘어진 노리개예요. 예식 날 달았어요.', nabi: '나비 모양 장식의 노리개예요.', bangul: '작은 방울이 달린 노리개예요.' },
    pouch: { durujumeoni: '둥근 모양의 주머니예요.', gwijumeoni: '양쪽에 귀가 나온 주머니예요.', bokjumeoni: '설날에 차는 복을 비는 주머니예요.' },
    fan: { hapjuk: '대나무 살을 접었다 펴는 부채예요.', danseon: '둥근 비단 부채예요.', pacho: '파초 잎처럼 생긴 큰 부채예요.' },
    hairpin: { binyeo: '쪽진 머리에 꽂는 긴 비녀예요.', okbinyeo: '옥으로 만든 비녀예요.', tteoljam: '움직이면 떨리는 꽃 장식 머리꽂이예요.', dwikkoji: '쪽 뒤에 꽂는 작은 장식이에요.' },
    ribbon: { jebi: '끝이 제비 부리처럼 뾰족한 댕기예요.', doturak: '혼례 날 뒤로 길게 늘이는 넓은 댕기예요.', baessi: '어린 여자아이 앞머리에 다는 작은 댕기예요.' },
    belt: { sejodae: '도포 위에 매는 가는 띠예요.', gwangdahoe: '넓게 짠 끈 띠예요. 철릭에 맸어요.', jeondae: '쾌자나 전복 위에 매는 띠예요.', gakdae: '단령 위에 두르는 딱딱한 띠예요.', saekdi: '풍물놀이 때 두르는 세 가지 색 띠예요.' },
    bag: { botjim: '보자기에 싸서 등에 진 짐이에요.', gwaenari: '나그네가 멘 작은 봇짐이에요.', basket: '대나무로 엮은 바구니예요.', bojagi: '물건을 곱게 싼 보자기예요.' },
  };

  // the nine calm faces (CONTRACT §19.1)
  const expressions = [
    { id: 'neutral', name: '무표정', say: '조용한 얼굴이에요.' }, { id: 'smile', name: '미소', say: '살짝 웃는 얼굴이에요.' },
    { id: 'laugh', name: '활짝 웃음', say: '활짝 웃는 얼굴이에요.' }, { id: 'surprise', name: '놀람', say: '깜짝 놀란 얼굴이에요.' },
    { id: 'curious', name: '궁금', say: '궁금한 얼굴이에요.' }, { id: 'proud', name: '뿌듯', say: '뿌듯한 얼굴이에요.' },
    { id: 'shy', name: '수줍음', say: '수줍은 얼굴이에요.' }, { id: 'sleepy', name: '졸림', say: '졸린 얼굴이에요.' },
    { id: 'focus', name: '집중', say: '집중하는 얼굴이에요.' },
  ];

  // a new profile: the realistic style in a calm everyday hanbok (민저고리, 사폭바지, 고무신)
  const defaults = {
    style: 'real', skin: '#f6d0b1', face: 'smile', expr: 'smile', hair: 'short', hairColor: '#2f2520', beard: 'none', hat: 'none', hatColor: '#1f1f22',
    outer: 'none', outerColor: '#2e3f6e', top: 'hanbok', topColor: '#f1ece1', trimColor: '#2e3f6e', pattern: 'none', bottom: 'pants', bottomColor: '#3f5a3c',
    footwear: 'gomusin', shoes: '#f5f0e6', norigae: 'none', norigaeColor: '#d9534f', pouch: 'none', pouchColor: '#d9534f', fan: 'none', hairpin: 'none',
    ribbon: 'none', ribbonColor: '#d9534f', belt: 'none', beltColor: '#2e3f6e', bag: 'none', bagColor: '#8a5a3b', accessoryColor: '#d9534f', height: 1,
  };
  const L = (o) => Object.assign({}, defaults, o);
  // 갖춤 (sets): each one historically sensible — who wore it and when is in its `say`
  const presets = [
    { id: 'seollal', emoji: '🎎', label: '설빔 친구', say: '색동저고리에 다홍치마를 입은 설날 친구예요.',
      app: L({ hair: 'daenggi', top: 'saekdong', topColor: '#ffd766', trimColor: '#d9534f', bottom: 'skirt', bottomColor: '#d9534f', pattern: 'geumbak', footwear: 'kkotsin', shoes: '#b45a73', norigae: 'samjak', norigaeColor: '#8a3b4b', ribbon: 'jebi', ribbonColor: '#d9534f', face: 'cheer', expr: 'laugh', height: 0.95 }) },
    { id: 'seonbi', emoji: '🎩', label: '선비 친구', say: '도포에 세조대를 매고 갓을 쓴 선비 친구예요.',
      app: L({ hair: 'sangtu', hat: 'gat', outer: 'dopo', outerColor: '#f1ece1', top: 'hanbok', topColor: '#f1ece1', bottom: 'pants', bottomColor: '#e9e4da', footwear: 'taesahye', shoes: '#1f1f22', belt: 'sejodae', beltColor: '#2e3f6e', fan: 'hapjuk', accessoryColor: '#e2c27a', face: 'calm', expr: 'neutral', height: 1.05 }) },
    { id: 'farmer', emoji: '🧑‍🌾', label: '농부 친구', say: '적삼을 입고 밀짚모자를 쓰고 짚신을 신은 농부 친구예요.',
      app: L({ hair: 'side', hat: 'strawhat', hatColor: '#e2c27a', top: 'jeoksam', topColor: '#e8d9b5', pattern: 'mosi', bottom: 'pants', bottomColor: '#c9b38f', footwear: 'jipsin', shoes: '#e2c27a', bag: 'basket', bagColor: '#b88a4a', face: 'cheer', expr: 'smile' }) },
    { id: 'gungjung', emoji: '👑', label: '궁중 친구', say: '금박 당의에 스란치마를 입고 족두리를 쓴 친구예요.',
      app: L({ hair: 'jjok', hat: 'jokduri', outer: 'dangui', outerColor: '#2f7d4a', top: 'hanbok', topColor: '#ffffff', bottom: 'seuran', bottomColor: '#d9534f', pattern: 'geumbak', footwear: 'danghye', shoes: '#d9534f', norigae: 'samjak', norigaeColor: '#6e3b4e', hairpin: 'binyeo', accessoryColor: '#e2c27a', face: 'gentle', expr: 'smile' }) },
    { id: 'hogeon', emoji: '🐯', label: '호건 친구', say: '호랑이 호건을 쓰고 쾌자에 전대를 맨 씩씩한 친구예요.',
      app: L({ hair: 'buzz', hat: 'hogeon', top: 'saekdong', topColor: '#ffd766', outer: 'kwaeja', outerColor: '#2e3f6e', bottom: 'pants', bottomColor: '#8a3b4b', pattern: 'cloud', belt: 'jeondae', beltColor: '#d9534f', footwear: 'gomusin', shoes: '#2a1d14', pouch: 'bokjumeoni', pouchColor: '#d9534f', face: 'bright', expr: 'proud', height: 0.92 }) },
    { id: 'winter', emoji: '❄️', label: '겨울 친구', say: '배자를 입고 조바위를 쓴 겨울 친구예요.',
      app: L({ hair: 'daenggi', hat: 'jobawi', hatColor: '#6e2f4e', top: 'hanbok', topColor: '#f08bb0', outer: 'baeja', outerColor: '#6e3b4e', bottom: 'skirt', bottomColor: '#2e3f6e', pattern: 'flower', footwear: 'kkotsin', shoes: '#8a3b4b', pouch: 'bokjumeoni', pouchColor: '#f4c54a', ribbon: 'jebi', ribbonColor: '#8a3b4b', face: 'smile', expr: 'smile', height: 0.95 }) },
    { id: 'grandma', emoji: '👵', label: '장 담그는 할머니', say: '아얌을 쓰고 행주치마를 두르고 장을 담그는 할머니예요.',
      app: L({ skin: '#e6b48d', hair: 'jjok', hairColor: '#b9b4ad', hat: 'ayam', hatColor: '#1f1f22', top: 'hanbok', topColor: '#e8d9b5', outer: 'haengju', outerColor: '#f1ece1', bottom: 'skirt', bottomColor: '#5a4636', hairpin: 'binyeo', accessoryColor: '#cfcac2', footwear: 'gomusin', shoes: '#ffffff', face: 'gentle', expr: 'smile', height: 0.92 }) },
    { id: 'scholar', emoji: '📜', label: '서당 친구', say: '복건을 쓰고 책을 읽는 서당 친구예요.',
      app: L({ hair: 'ttaeun', hat: 'bokgeon', top: 'hanbok', topColor: '#f1ece1', outer: 'kwaeja', outerColor: '#2e3f6e', bottom: 'pants', bottomColor: '#e9e4da', footwear: 'gomusin', shoes: '#1f1f22', ribbon: 'jebi', ribbonColor: '#1f1f22', face: 'calm', expr: 'focus', height: 0.95 }) },
    { id: 'explorer', emoji: '🎒', label: '나그네', say: '삿갓을 쓰고 괴나리봇짐을 멘 나그네예요.',
      app: L({ hair: 'sangtu', hairColor: '#4a3a2c', hat: 'satgat', hatColor: '#e2c27a', outer: 'durumagi', outerColor: '#e8d9b5', top: 'jeoksam', topColor: '#f1ece1', bottom: 'pants', bottomColor: '#c9b38f', footwear: 'mituri', shoes: '#c9b38f', bag: 'gwaenari', bagColor: '#8a5a3b', face: 'cheer', expr: 'curious' }) },
    { id: 'cook', emoji: '🧑‍🍳', label: '부엌 살림꾼', say: '머릿수건을 두르고 행주치마를 입고 김치를 담그는 친구예요.',
      app: L({ skin: '#e6b48d', hair: 'jjok', hairColor: '#6b4a2e', hat: 'sugeon', hatColor: '#ffffff', top: 'jeoksam', topColor: '#f1ece1', outer: 'haengju', outerColor: '#ffffff', bottom: 'mongdang', bottomColor: '#2c3540', footwear: 'gomusin', shoes: '#f5f0e6', face: 'smile', expr: 'smile' }) },
    { id: 'student', emoji: '🏛️', label: '향교 유생', say: '유건을 쓰고 학창의를 입은 향교의 유생이에요.',
      app: L({ hair: 'sangtu', hairColor: '#2f2520', hat: 'yugeon', outer: 'hakchang', outerColor: '#ffffff', trimColor: '#1f1f22', top: 'hanbok', topColor: '#ffffff', bottom: 'pants', bottomColor: '#e9e4da', footwear: 'taesahye', shoes: '#1f1f22', face: 'bright', expr: 'focus', height: 1.0 }) },
    { id: 'potter', emoji: '🏺', label: '옹기장이', say: '머릿수건을 두르고 잠방이를 입고 옹기를 빚는 아저씨예요.',
      app: L({ skin: '#c68b62', hair: 'sangtu', hairColor: '#1f1a18', hat: 'sugeon', hatColor: '#e8d9b5', top: 'jeoksam', topColor: '#7a6a55', bottom: 'jambang', bottomColor: '#5a4636', footwear: 'jipsin', shoes: '#e2c27a', beard: 'mustache', face: 'calm', expr: 'focus', height: 1.08 }) },
    { id: 'twins', emoji: '🎀', label: '새앙머리 아기씨', say: '새앙머리에 배씨댕기를 단 꼬마 아기씨예요.',
      app: L({ hair: 'saengang', hairColor: '#3a2a20', top: 'banhoejang', topColor: '#ffd766', trimColor: '#d9534f', bottom: 'skirt', bottomColor: '#f08bb0', footwear: 'kkotsin', shoes: '#d9534f', ribbon: 'baessi', ribbonColor: '#d9534f', face: 'cheer', expr: 'shy', height: 0.9 }) },
    { id: 'wave', emoji: '🌿', label: '모시 여름옷', say: '모시 깨끼저고리에 전모를 쓴 여름 나들이 차림이에요.',
      app: L({ hair: 'jjok', hairColor: '#4a3a2c', hat: 'jeonmo', hatColor: '#e2c27a', top: 'kkaekki', topColor: '#a8d8c8', pattern: 'mosi', bottom: 'tongchima', bottomColor: '#e9e4da', footwear: 'unhye', shoes: '#a8d8c8', fan: 'danseon', accessoryColor: '#f7c6d0', hairpin: 'okbinyeo', face: 'gentle', expr: 'smile' }) },
    { id: 'cute', emoji: '🧸', label: '귀여운 모습', say: '동글동글 귀여운 모습이에요.',
      app: L({ style: 'cute', hair: 'bun', hairColor: '#1f1a18', top: 'hanbok', topColor: '#f08bb0', bottom: 'skirt', bottomColor: '#b45a73', footwear: 'kkotsin', shoes: '#ffffff', pouch: 'durujumeoni', pouchColor: '#f4c54a', face: 'smile', height: 0.95 }) },
    // ---- phase 11 sets
    { id: 'bride', emoji: '💐', label: '혼례 신부', say: '활옷을 입고 화관을 쓴 혼례 날의 신부예요.',
      app: L({ skin: '#fde3cf', hair: 'keunmeori', hat: 'hwagwan', hatColor: '#e2c27a', top: 'samhoejang', topColor: '#f2e18c', trimColor: '#8a3b4b', outer: 'hwarot', outerColor: '#c23a4a', bottom: 'daeran', bottomColor: '#2e3f6e', pattern: 'flower', footwear: 'danghye', shoes: '#c23a4a', norigae: 'samjak', norigaeColor: '#6e3b4e', ribbon: 'doturak', ribbonColor: '#c23a4a', hairpin: 'binyeo', accessoryColor: '#e2c27a', face: 'gentle', expr: 'shy' }) },
    { id: 'groom', emoji: '🎎', label: '혼례 신랑', say: '단령에 사모를 쓰고 각대를 두른 사모관대 차림의 신랑이에요.',
      app: L({ hair: 'sangtu', hat: 'samo', outer: 'dallyeong', outerColor: '#2e3f6e', pattern: 'cloud', top: 'hanbok', topColor: '#ffffff', bottom: 'pants', bottomColor: '#e9e4da', belt: 'gakdae', beltColor: '#e2c27a', footwear: 'mokhwa', shoes: '#1f1f22', face: 'calm', expr: 'proud', height: 1.04 }) },
    { id: 'dol', emoji: '🎂', label: '돌잔치 아기', say: '색동저고리에 쾌자와 전대, 복건을 갖춘 첫 돌 아기예요.',
      app: L({ hair: 'buzz', hat: 'bokgeon', top: 'saekdong', topColor: '#ffd766', outer: 'kwaeja', outerColor: '#2f7d4a', pattern: 'geumbak', bottom: 'pungcha', bottomColor: '#f1ece1', belt: 'jeondae', beltColor: '#d9534f', footwear: 'gomusin', shoes: '#d9534f', pouch: 'bokjumeoni', pouchColor: '#d9534f', face: 'bright', expr: 'laugh', height: 0.9 }) },
    { id: 'dolgirl', emoji: '🍰', label: '돌잔치 아기씨', say: '굴레를 쓰고 색동저고리에 다홍치마를 입은 첫 돌 아기씨예요.',
      app: L({ hair: 'bangs', hat: 'gulle', hatColor: '#2e3f6e', top: 'saekdong', topColor: '#f08bb0', bottom: 'skirt', bottomColor: '#d9534f', pattern: 'geumbak', footwear: 'kkotsin', shoes: '#f08bb0', pouch: 'bokjumeoni', pouchColor: '#f4c54a', face: 'cheer', expr: 'laugh', height: 0.9 }) },
    { id: 'kkachi', emoji: '🐦', label: '까치설빔', say: '오색 까치두루마기에 복건을 쓴 설날 아이예요.',
      app: L({ hair: 'ttaeun', hat: 'bokgeon', top: 'saekdong', topColor: '#ffd766', outer: 'kkachi', outerColor: '#8b6fd6', bottom: 'pants', bottomColor: '#2e3f6e', footwear: 'gomusin', shoes: '#1f1f22', pouch: 'bokjumeoni', pouchColor: '#d9534f', face: 'bright', expr: 'laugh', height: 0.92 }) },
    { id: 'mugwan', emoji: '🛡️', label: '무관', say: '동달이에 전복을 입고 전대를 매고 전립을 쓴 무관이에요.',
      app: L({ hair: 'sangtu', hat: 'jeollip', outer: 'gugunbok', outerColor: '#2e3f6e', top: 'hanbok', topColor: '#d9534f', bottom: 'pants', bottomColor: '#e9e4da', belt: 'jeondae', beltColor: '#d9534f', footwear: 'mokhwa', shoes: '#1f1f22', beard: 'mustache', face: 'bright', expr: 'focus', height: 1.08 }) },
    { id: 'cheollik', emoji: '🏹', label: '철릭 차림', say: '주름 잡힌 철릭에 광다회를 매고 갓을 쓴 차림이에요.',
      app: L({ hair: 'sangtu', hat: 'gat', outer: 'cheollik', outerColor: '#2f6f8f', top: 'hanbok', topColor: '#f1ece1', bottom: 'pants', bottomColor: '#e9e4da', belt: 'gwangdahoe', beltColor: '#d9534f', footwear: 'mokhwa', shoes: '#1f1f22', face: 'calm', expr: 'neutral', height: 1.05 }) },
    { id: 'nubiwinter', emoji: '🧣', label: '겨울 누비', say: '누비저고리와 누비바지에 남바위를 쓴 겨울 차림이에요.',
      app: L({ hair: 'side', hat: 'nambawi', hatColor: '#6e2f4e', top: 'nubi', topColor: '#3f5a3c', pattern: 'nubi', outer: 'baeja', outerColor: '#5a4636', bottom: 'nubibaji', bottomColor: '#7a6a55', footwear: 'gatsin', shoes: '#2a1d14', face: 'smile', expr: 'smile' }) },
    { id: 'mosisummer', emoji: '🎐', label: '여름 모시', say: '모시 적삼과 바지에 합죽선을 든 여름 차림이에요.',
      app: L({ hair: 'sangtu', hat: 'gat', top: 'jeoksam', topColor: '#f1ece1', pattern: 'mosi', bottom: 'pants', bottomColor: '#f1ece1', footwear: 'taesahye', shoes: '#1f1f22', fan: 'hapjuk', accessoryColor: '#e2c27a', face: 'calm', expr: 'smile' }) },
    { id: 'pungmul', emoji: '🥁', label: '풍물패 상모잡이', say: '흰 바지저고리에 삼색띠를 두르고 상모를 쓴 풍물패예요.',
      app: L({ hair: 'buzz', hat: 'sangmo', top: 'hanbok', topColor: '#ffffff', bottom: 'pants', bottomColor: '#ffffff', belt: 'saekdi', beltColor: '#d9534f', footwear: 'mituri', shoes: '#c9b38f', face: 'cheer', expr: 'laugh' }) },
    { id: 'gokkal', emoji: '🌸', label: '풍물패 고깔', say: '꽃 고깔을 쓰고 쾌자에 삼색띠를 두른 풍물패예요.',
      app: L({ hair: 'daenggi', hat: 'gokkal', hatColor: '#ffffff', top: 'hanbok', topColor: '#ffffff', outer: 'kwaeja', outerColor: '#2e3f6e', bottom: 'pants', bottomColor: '#ffffff', belt: 'saekdi', beltColor: '#d9534f', footwear: 'mituri', shoes: '#c9b38f', face: 'bright', expr: 'laugh' }) },
    { id: 'healing', emoji: '🍵', label: '힐링복', say: '힐링관에서 갈아입는 편한 생활한복이에요.',
      app: L({ hair: 'short', top: 'saenghwal', topColor: '#a8d8c8', trimColor: '#f1ece1', pattern: 'myeongju', bottom: 'saenghwal', bottomColor: '#e9e4da', footwear: 'gomusin', shoes: '#f5f0e6', face: 'gentle', expr: 'smile' }) },
    { id: 'healstaff', emoji: '🌿', label: '힐링관 안내', say: '단정한 생활한복에 배자를 입은 힐링관 안내 선생님이에요.',
      app: L({ hair: 'jjok', hairpin: 'dwikkoji', accessoryColor: '#cfcac2', top: 'saenghwal', topColor: '#f1ece1', trimColor: '#2f6f8f', outer: 'baeja', outerColor: '#2f6f8f', bottom: 'saenghwal', bottomColor: '#2e3f6e', footwear: 'gomusin', shoes: '#1f1f22', face: 'gentle', expr: 'smile' }) },
    { id: 'hunjang', emoji: '📖', label: '훈장님', say: '정자관을 쓰고 두루마기를 입은 서당의 훈장님이에요.',
      app: L({ skin: '#e6b48d', hair: 'sangtu', hairColor: '#b9b4ad', beard: 'long', hat: 'jeongja', outer: 'durumagi', outerColor: '#e9e4da', top: 'hanbok', topColor: '#f1ece1', bottom: 'pants', bottomColor: '#e9e4da', footwear: 'taesahye', shoes: '#1f1f22', fan: 'hapjuk', accessoryColor: '#e2c27a', face: 'calm', expr: 'neutral', height: 1.02 }) },
    { id: 'jangot', emoji: '🌙', label: '장옷 나들이', say: '장옷을 머리에서부터 덮어 쓰고 나들이 가는 아씨예요.',
      app: L({ hair: 'jjok', outer: 'jangot', outerColor: '#2f7d4a', trimColor: '#ffffff', top: 'samhoejang', topColor: '#f2e18c', bottom: 'skirt', bottomColor: '#8a3b4b', hairpin: 'binyeo', accessoryColor: '#e2c27a', footwear: 'unhye', shoes: '#8a3b4b', face: 'gentle', expr: 'shy' }) },
    { id: 'sseugae', emoji: '🍂', label: '쓰개치마 아낙', say: '쓰개치마를 쓰고 장에 가는 아낙이에요.',
      app: L({ hair: 'jjok', outer: 'sseugae', outerColor: '#a8d8c8', top: 'hanbok', topColor: '#ffffff', bottom: 'skirt', bottomColor: '#2e3f6e', footwear: 'gomusin', shoes: '#ffffff', bag: 'bojagi', bagColor: '#d9534f', face: 'smile', expr: 'smile' }) },
    { id: 'bobusang', emoji: '🧺', label: '보부상', say: '패랭이를 쓰고 봇짐을 진 장돌림 보부상이에요.',
      app: L({ hair: 'sangtu', hat: 'paeraengi', hatColor: '#e2c27a', top: 'jeoksam', topColor: '#e8d9b5', outer: 'jokki', outerColor: '#5a4636', bottom: 'pants', bottomColor: '#c9b38f', footwear: 'mituri', shoes: '#c9b38f', bag: 'botjim', bagColor: '#2e3f6e', face: 'cheer', expr: 'laugh' }) },
    { id: 'magoja', emoji: '🧥', label: '마고자 어르신', say: '저고리 위에 마고자를 입고 조끼를 갖춘 어르신이에요.',
      app: L({ skin: '#e6b48d', hair: 'short', hairColor: '#b9b4ad', top: 'hanbok', topColor: '#f1ece1', outer: 'magoja', outerColor: '#7a5a43', bottom: 'pants', bottomColor: '#3c3934', footwear: 'gomusin', shoes: '#1f1f22', pouch: 'gwijumeoni', pouchColor: '#2e3f6e', face: 'gentle', expr: 'smile', height: 1.0 }) },
    { id: 'wonsam', emoji: '🌺', label: '원삼 예복', say: '색동 소매의 원삼에 족두리를 쓴 예식 차림이에요.',
      app: L({ hair: 'jjok', hat: 'jokduri', outer: 'wonsam', outerColor: '#2f7d4a', pattern: 'geumbak', top: 'samhoejang', topColor: '#f2e18c', trimColor: '#8a3b4b', bottom: 'daeran', bottomColor: '#c23a4a', footwear: 'danghye', shoes: '#2f7d4a', ribbon: 'doturak', ribbonColor: '#c23a4a', hairpin: 'binyeo', accessoryColor: '#e2c27a', face: 'gentle', expr: 'proud' }) },
    { id: 'nongbu', emoji: '🌾', label: '모내기 일꾼', say: '잠방이에 머릿수건을 두르고 논에서 일하는 일꾼이에요.',
      app: L({ skin: '#c68b62', hair: 'buzz', hat: 'sugeon', hatColor: '#ffffff', top: 'jeoksam', topColor: '#f1ece1', bottom: 'jambang', bottomColor: '#c9b38f', footwear: 'jipsin', shoes: '#e2c27a', face: 'cheer', expr: 'smile' }) },
    { id: 'rainy', emoji: '☔', label: '비 오는 날', say: '나막신을 신고 삿갓을 쓴 비 오는 날 차림이에요.',
      app: L({ hair: 'side', hat: 'satgat', hatColor: '#c9b38f', top: 'jeoksam', topColor: '#7a6a55', bottom: 'pants', bottomColor: '#5a4636', footwear: 'namaksin', shoes: '#7a4a2c', face: 'calm', expr: 'curious' }) },
  ];
  G.data.avatar = { v: 3, options, colorKeys, legacy, migrate, slots, names, about, dyes, expressions, defaults, presets };
})();
