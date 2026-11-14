// =============================================================================
// 48-interior-data.js — what the hanok rooms show (CONTRACT §16.6): exhibits, artworks, the 안내소 cards, motion scripts.
//
// PURE DATA: no THREE / DOM access at evaluation (it also runs in Node: tests/exhibits-client.mjs checks that).
//
//   G.data.exhibitRooms = [{ id, name, emoji, kid, motions: [motionId …] }]        the 도감 order + a board hint per room
//   G.data.exhibits[id] = { id, place, anchor, title, emoji, kid (≤ 40 chars, spoken), detail (어른용 설명),
//                           sources: [{ label, url }], confidence: 'high' | 'medium', motion?, art?, textOnly?,
//                           titleEn?, artist?, period?, credit? }
//   G.data.motions[id]  = { id, title, emoji, place, poster, steps: [{ caption, say }] }   (drawn by 49-exhibits.js)
//
// Writing rules (§12, §16.0): every sentence is newly written from the pages named in `sources` (encyclopedia of Korean
// culture, the national folk museum encyclopedia, 농사로, UNESCO, The Met Open Access …) — never copied. Numbers appear
// only as the source gives them. A fact of medium confidence speaks in "~래요 / ~라고 해요". Nothing about health
// effects, no prices. 일월오봉도 and 까치호랑이 are text-only (the pack holds no image of them — never substitute one).
// The facts are short summaries for children; they are not expert-reviewed (the card says so under 어른용 설명).
//
// ANCHOR KEYS — the room builders register these with ctx.anchor(key, object3D | {x, y, z}) (§16.4). An exhibit whose
// anchor is missing goes to the room's fallback shelf by the door, so nothing is unreachable. Keys are stable.
//
//  PL_DAECHEONG 대청마루 (14)  gidan 기단 · juchu 주춧돌 · gidung 기둥 · daedeulbo 대들보 · seokkarae 도리·서까래 ·
//                             cheoma 처마 · jibung 기와·초가지붕 · umulmaru 우물마루 · deureoyeolgae 대청·들어열개 ·
//                             changsal 창살·한지 · bangs 안방과 사랑방 (안내판) · art_geese 기러기 족자 ·
//                             art_officials 관리 모임 족자 · art_dragon_carp 용과 잉어 그림
//                             boards: MG_FRAME, MG_CHEOMA, MG_MARU, MG_CHANGSAL
//  PL_ANBANG 안방 (12)         ondol 온돌 · boryo 보료 · byeongpung 병풍 · jangnong 장롱 · bandaji 반닫이 ·
//                             gyeongdae 경대 · dadeumi 다듬잇돌 · hwaro 화로 · hwajodo 화조도·십장생 (안내판) ·
//                             art_hwajo 꽃과 새 병풍 그림 · art_deer 사슴 족자 · art_rooster 수탉 족자
//                             boards: MG_GUDEUL
//  PL_SARANG 사랑방 (12)       seoan 서안·문갑 · sabangtakja 사방탁자 · deungjan 등잔 · chaekgeori 책거리 (안내판) ·
//                             kkachi 까치호랑이 (글 안내판) · irworobong 일월오봉도 (글 안내판) ·
//                             art_chaekgeori 책거리 병풍 그림 · art_still_life 그릇과 꽃나무 병풍 그림 ·
//                             art_plum 매화 족자 · art_bamboo 대나무 족자 · art_portrait 초상 족자 · art_tiger 호랑이 족자
//                             boards: MG_CHANGSAL
//  PL_BUEOK 부엌 (8)           agungi 아궁이·부뚜막 · gamasot 가마솥 · siru 시루 · salgang 살강·물두멍 · soban 소반 ·
//                             jori 조리 · ki 키·체 · maetdol 맷돌·절구
//                             boards: MG_GUDEUL
//  PL_BALHYO 발효실 (13)       balhyo 발효 (안내판) · meju 메주 · byeotjip 볏짚 (메주 띄우기) · jangdok 장 담근 독 ·
//                             jangareugi 장 가르기 · ssiganjang 씨간장 단지 · yusan 문화유산 안내판 · gochujang 고추장 ·
//                             kimchidok 김칫독 · kimjang 김장 · sikcho 식초 · nuruk 누룩·막걸리 · geumjul 금줄 두른 독
//                             boards: MG_JANG_YEAR, MG_MICROBE
//  PL_GOTGAN 곳간 (8)          dwiju 뒤주 · gamani 가마니·멍석 · jangdokdae 장독대 (모형) · onggi 옹기 (벽 조각) ·
//                             onggi_region 고장별 옹기 · jeolgi 절기 달력 · gamja 정선 감자·옥수수 · gondeure 곤드레
//                             boards: MG_ONGGI_BREATH, MG_ONGGI_REGION, MG_JEOLGI
//  PL_OFFICE 분양 안내소 (8)   manjangdae 만장대 이야기 · bunyang 장독 분양 · year_damgeugi ① 담그기 ·
//                             year_gareugi ② 가르기 · year_ikhigi ③ 익히기 · year_batneun ④ 받는 날 · gujwa 구좌 ·
//                             bohoja 어른과 함께 신청
//                             boards: MG_JANG_YEAR
//  (PL_ALLOT has no exhibit of its own: the 장독대 facts live in the 곳간 and the 발효실, the allotment year in the 안내소.)
//
// MOTION IDS  MG_JANG_YEAR 장 담그기 열두 달 · MG_ONGGI_BREATH 옹기가 숨 쉬는 원리 · MG_GUDEUL 구들에 불이 지나가는 길 ·
//             MG_CHEOMA 처마와 해 · MG_FRAME 한옥 뼈대 쌓기 · MG_MARU 우물마루와 들어열개 · MG_CHANGSAL 창살 도감 ·
//             MG_MICROBE 작은 일꾼 미생물 · MG_ONGGI_REGION 고장마다 다른 옹기 · MG_JEOLGI 24절기 해시계
// =============================================================================
(function () {
  const ENC = 'https://encykorea.aks.ac.kr/Article/';
  const FOLK = 'https://folkency.nfm.go.kr/topic/';
  const enc = (id, name) => ({ label: `한국민족문화대백과사전 「${name}」`, url: ENC + id });
  const folk = (path, name) => ({ label: `한국민속대백과사전 「${name}」`, url: FOLK + path });
  const src = (label, url) => ({ label, url });
  const JANG = folk('detail/4784', '장 담그기');
  const JANG_ENC = enc('E0076963', '장 담그기');

  // ---------------------------------------------------------------- rooms (도감 order)
  G.data.exhibitRooms = [
    { id: 'PL_DAECHEONG', name: '대청마루', emoji: '🏛️', kid: '집이 어떻게 서 있는지 알아봐요.', motions: ['MG_FRAME', 'MG_CHEOMA', 'MG_MARU', 'MG_CHANGSAL'] },
    { id: 'PL_ANBANG', name: '안방', emoji: '🛏️', kid: '따뜻한 온돌방의 살림을 구경해요.', motions: ['MG_GUDEUL'] },
    { id: 'PL_SARANG', name: '사랑방', emoji: '📚', kid: '책과 그림이 있는 손님방이에요.', motions: ['MG_CHANGSAL'] },
    { id: 'PL_BUEOK', name: '부엌', emoji: '🍚', kid: '아궁이와 가마솥이 있는 부엌이에요.', motions: ['MG_GUDEUL'] },
    { id: 'PL_BALHYO', name: '발효실', emoji: '🫘', kid: '메주와 장이 익어 가는 방이에요.', motions: ['MG_JANG_YEAR', 'MG_MICROBE'] },
    { id: 'PL_GOTGAN', name: '곳간', emoji: '🌾', kid: '곡식과 옹기를 모아 둔 곳이에요.', motions: ['MG_ONGGI_BREATH', 'MG_ONGGI_REGION', 'MG_JEOLGI'] },
    { id: 'PL_OFFICE', name: '분양 안내소', emoji: '🏺', kid: '내 장독의 한 해를 알아봐요.', motions: ['MG_JANG_YEAR'] },
  ];

  // ---------------------------------------------------------------- exhibits
  const X = {};
  /** add(place, id, anchor, emoji, title, kid, detail, sources, extra?) */
  const add = (place, id, anchor, emoji, title, kid, detail, sources, extra) => {
    X[id] = Object.assign({ id, place, anchor, title, emoji, kid, detail, sources, confidence: 'high' }, extra || {});
  };

  // ===== 대청마루 — how a hanok stands
  add('PL_DAECHEONG', 'HX_GIDAN', 'gidan', '🧱', '기단',
    '집을 돌 단 위에 지어서 비와 물기를 피해요.',
    '기단은 터를 다진 뒤 땅보다 한 층 높게 쌓은 단이에요. 집의 무게를 땅에 고루 전하고, 빗물과 땅속 물기가 집에 닿지 않게 막아 줘요. 조선 시대에는 돌을 쌓아 만든 기단이 가장 흔했어요.',
    [folk('기단', '기단')], { motion: 'MG_FRAME' });
  add('PL_DAECHEONG', 'HX_JUCHU', 'juchu', '🪨', '주춧돌',
    '기둥 발밑의 돌이 나무를 물기에서 지켜 줘요.',
    '주춧돌은 기둥 밑을 받치는 돌로, 주추나 초석이라고도 불러요. 집의 무게를 땅으로 전하고, 나무 기둥의 밑동이 물기에 상하지 않게 해 줘요.',
    [enc('E0053449', '주추')], { motion: 'MG_FRAME' });
  add('PL_DAECHEONG', 'HX_GIDUNG', 'gidung', '🪵', '기둥',
    '가운데가 통통한 배흘림기둥도 있대요.',
    '기둥은 모양에 따라 원통형, 민흘림, 배흘림으로 나눈다고 해요. 배흘림기둥은 높이의 3분의 1쯤 되는 곳이 가장 굵대요.',
    [enc('E0008174', '기둥'), folk('detail/8596', '흘림기둥')], { motion: 'MG_FRAME', confidence: 'medium' });
  add('PL_DAECHEONG', 'HX_DAEDEULBO', 'daedeulbo', '🏗️', '대들보',
    '대들보는 지붕을 받치는 가장 큰 나무예요.',
    '보는 앞뒤 기둥 위에 가로로 걸치는 큰 나무예요. 그중 가장 큰 보가 대들보이고, 지붕의 무게를 받아 기둥으로 전해요. 천장을 꾸민 집에서도 대들보는 드러나 보이게 두었어요.',
    [folk('detail/8293', '대들보'), enc('E0023183', '보')], { motion: 'MG_FRAME' });
  add('PL_DAECHEONG', 'HX_SEOKKARAE', 'seokkarae', '🦴', '도리와 서까래',
    '서까래는 지붕을 받치는 갈비뼈 같아요.',
    '서까래는 도리와 도리 사이에 직각으로, 일정한 간격을 두고 여러 개 걸치는 나무예요. 지붕을 올리는 바탕이 되고, 그 위에 기와나 이엉을 얹어요.',
    [enc('E0027666', '서까래'), folk('detail/8410', '서까래')], { motion: 'MG_FRAME' });
  add('PL_DAECHEONG', 'HX_CHEOMA', 'cheoma', '☀️', '처마',
    '길게 나온 처마가 여름 햇볕을 가려 줘요.',
    '처마는 벽보다 길게 내민 지붕의 끝이에요. 남쪽 지방일수록 깊어지는 편이고, 비가 적고 추운 곳은 볕을 많이 받도록 짧게 했어요. 처마를 깊게 내면 여름에는 시원하고 겨울에는 따뜻하게 지낼 수 있어요.',
    [folk('처마', '처마'), enc('E0054224', '지붕')], { motion: 'MG_CHEOMA' });
  add('PL_DAECHEONG', 'HX_JIBUNG', 'jibung', '🏠', '기와지붕과 초가지붕',
    '기와는 흙을 굽고, 초가는 볏짚을 엮어요.',
    '기와지붕은 암키와와 수키와가 기왓골과 기왓등을 이루어 빗물을 흘려보내요. 초가지붕은 주로 볏짚으로 엮은 이엉을 덮고, 꼭대기에 용마름을 얹어요.',
    [folk('기와', '기와'), enc('E0045138', '이엉'), enc('E0056932', '초가')], { motion: 'MG_FRAME' });
  add('PL_DAECHEONG', 'HX_UMULMARU', 'umulmaru', '🟫', '우물마루',
    '‘우물 정’ 글자처럼 가로세로로 짠 마루예요.',
    '우물마루는 우물 정(井)자 모양으로 틀을 짜고 그 사이에 널을 끼워 까는 마루로, 우리 건축에서만 쓰는 방식이에요. 계절에 따라 나무가 줄어 틈이 생기면, 마루를 다 뜯지 않고 널을 한 장씩 밀어 촘촘히 메워요.',
    [enc('E0071897', '우물마루'), folk('마루', '마루')], { motion: 'MG_MARU' });
  add('PL_DAECHEONG', 'HX_DEUREOYEOLGAE', 'deureoyeolgae', '🚪', '대청과 들어열개',
    '여름엔 문을 접어서 위로 걸어 둬요.',
    '대청은 안방과 건넌방 사이에 있는 넓은 마루로, 가족이 지내고 일도 하던 곳이에요. 여름에는 분합문을 접어 올려 들쇠라는 고리에 매달아 두는데, 이렇게 여는 방식을 들어열개라고 해요.',
    [enc('E0014835', '대청'), enc('E0017332', '마루')], { motion: 'MG_MARU' });
  add('PL_DAECHEONG', 'HX_CHANGSAL', 'changsal', '🪟', '창살과 한지',
    '창살 무늬마다 이름이 있어요.',
    '여닫이 창에는 띠살·정자살·빗살을, 옆으로 미는 창에는 용자살·아자살·완자살을 많이 썼어요. 가는 살 아래에 널을 댄 문은 세살문이라고 해요. 창과 문에는 닥나무 섬유로 만든 한지를 발랐어요.',
    [enc('E0055311', '창'), enc('E0071904', '살창'), enc('E0013501', '닥나무')], { motion: 'MG_CHANGSAL' });
  add('PL_DAECHEONG', 'HX_BANGS', 'bangs', '🏡', '안방과 사랑방',
    '안방은 살림하는 방, 사랑방은 손님 맞는 방!',
    '안방은 집안 살림을 맡아 돌보는 중심 공간으로, 귀중한 물건과 광의 열쇠를 두었어요. 사랑방은 바깥주인이 지내며 손님을 맞는 방으로, 안방과 떨어져 집의 바깥쪽 가까이에 두었어요.',
    [enc('E0034734', '안방'), folk('사랑방', '사랑방')]);

  // ===== 안방
  add('PL_ANBANG', 'HX_ONDOL', 'ondol', '🔥', '온돌',
    '불기운이 방바닥 밑 길을 지나가요.',
    '아궁이에서 땐 불의 열과 연기가 방바닥 밑의 길인 고래를 지나 굴뚝으로 나가면서 구들장을 데워요. 고래는 아궁이 쪽이 가장 낮고 굴뚝 쪽으로 갈수록 높아서 불이 잘 들어요. 온돌문화는 2018년 4월 30일에 국가무형유산이 되었어요.',
    [enc('E0005703', '구들'), enc('E0077489', '온돌문화')], { motion: 'MG_GUDEUL' });
  add('PL_ANBANG', 'HX_BORYO', 'boryo', '🛋️', '보료',
    '보료는 솜을 넣은 폭신한 앉는 자리예요.',
    '보료는 속에 솜이나 털을 넣고 겉을 비단으로 싼 넓은 요예요. 장침, 사방침, 안석, 방석까지 한 벌로 묶어 보료라고 부르기도 해요. 빛깔은 붉은색과 남색이 흔했어요.',
    [folk('detail/8374', '보료'), enc('E0023285', '보료')]);
  add('PL_ANBANG', 'HX_BYEONGPUNG', 'byeongpung', '🪭', '병풍',
    '병풍은 바람을 막고 방을 꾸며 줘요.',
    '병풍은 바람을 막거나 자리를 가리고, 방을 꾸미는 데 쓰던 물건이에요. 여러 폭을 이어 접었다 폈다 하는 것은 연병풍이라고 해요.',
    [folk('소병', '소병'), folk('detail/8208', '가리개')]);
  add('PL_ANBANG', 'HX_JANGNONG', 'jangnong', '🗄️', '장롱',
    '옷은 장과 농에 넣어 두었어요.',
    '장은 층이 따로 떨어지지 않는 가구이고, 농은 층마다 따로 떼어 낼 수 있는 가구예요. 둘을 함께 놓고 옷을 넣어 두었고, 안방에 꼭 있어야 하는 살림이었어요.',
    [folk('장롱', '장롱'), folk('옷장', '옷장')]);
  add('PL_ANBANG', 'HX_BANDAJI', 'bandaji', '📦', '반닫이',
    '앞판 위쪽 반만 열려서 반닫이예요.',
    '반닫이는 앞면의 위쪽 절반만 문으로 여닫는 네모난 궤예요. 옷가지를 넣어 두는 데 썼어요.',
    [enc('E0021453', '반닫이')]);
  add('PL_ANBANG', 'HX_GYEONGDAE', 'gyeongdae', '🪞', '경대',
    '화장 도구를 넣는 함에 거울을 달았어요.',
    '경대는 화장품과 화장 도구를 넣어 두는 함에 거울을 단 가구예요. 좌경이라고도 불러요.',
    [enc('E0002367', '경대'), folk('detail/8238', '좌경')]);
  add('PL_ANBANG', 'HX_DADEUMI', 'dadeumi', '🥢', '다듬잇돌',
    '또닥또닥 두드려 옷감 주름을 펴요.',
    '풀을 먹인 옷감을 다듬잇돌 위에 놓고 두드려 반듯하게 폈어요. 다듬잇돌은 청석이라는 돌로 만들고, 밑에 나무 받침을 괴었어요.',
    [folk('다듬이질', '다듬이질'), enc('E0013423', '다듬이질')]);
  add('PL_ANBANG', 'HX_HWARO', 'hwaro', '♨️', '화로',
    '화로에 숯불을 담아 불씨를 지켰어요.',
    '화로는 숯불을 담아 두는 그릇이에요. 불씨를 지키고, 음식을 데우거나 밤과 고구마를 굽고, 시린 손을 녹이는 데 썼어요. 불씨를 소중히 여겨 시어머니가 며느리에게 화로를 물려주기도 했어요.',
    [folk('화로', '화로'), folk('detail/8183', '화로')]);
  add('PL_ANBANG', 'HX_HWAJODO', 'hwajodo', '🌺', '화조도와 십장생',
    '꽃과 새, 거북 그림에 좋은 뜻을 담았어요.',
    '화조도는 꽃과 새를 그린 그림이에요. 꽃 가운데 으뜸으로 치던 모란은 넉넉한 살림을 뜻했어요. 십장생은 해·산·물·돌·소나무·거북·학·사슴·불로초처럼 오래도록 변하지 않는 것으로 여긴 열 가지를 말해요.',
    [folk('detail/6600', '화조화'), enc('E0034031', '십장생')]);

  // ===== 사랑방
  add('PL_SARANG', 'HX_SEOAN', 'seoan', '✍️', '서안과 문갑',
    '앉아서 쓰는 책상과 문구를 넣는 가구예요.',
    '서안은 바닥에 앉아 책을 읽고 글을 쓰던 낮은 책상으로, 사랑방을 대표하는 가구예요. 문갑에는 서류와 문구를 넣어 두었어요.',
    [folk('서안', '서안'), enc('E0019376', '문갑')]);
  add('PL_SARANG', 'HX_SABANGTAKJA', 'sabangtakja', '🗃️', '사방탁자',
    '사방이 뚫린 선반 탁자예요.',
    '사방탁자는 네 기둥과 층널만으로 짠, 가장 단순한 짜임의 가구예요. 책과 감상하는 물건을 층마다 올려 두었어요.',
    [folk('사방탁자', '사방탁자')]);
  add('PL_SARANG', 'HX_DEUNGJAN', 'deungjan', '🪔', '등잔',
    '기름으로 불을 켜는 작은 그릇이래요.',
    '등잔은 기름을 태워 불을 켜도록 만든 그릇이라고 해요. 심지에 불을 붙여 방을 밝혔대요.',
    [enc('E0017151', '등잔')], { confidence: 'medium' });
  add('PL_SARANG', 'HX_CHAEKGEORI', 'chaekgeori', '📖', '책거리',
    '책과 붓이 가득한 그림이에요.',
    '책거리는 책과 문방구, 도자기 같은 물건을 그린 그림으로 책가도라고도 해요. 정조 임금 때 시작되었고, 19세기에 민화로 널리 퍼지면서 오래 살고 잘되기를 바라는 뜻도 담게 되었어요.',
    [folk('책거리', '책거리'), enc('E0055679', '책가도')]);
  add('PL_SARANG', 'HX_KKACHI', 'kkachi', '🐦', '까치호랑이',
    '까치는 기쁜 소식을 전한대요.',
    '까치호랑이는 호랑이와 까치를 함께 그린 민화예요. 까치는 반가운 새 소식을 뜻하고, 민화에서는 익살스러운 호랑이로 세상일을 꼬집기도 했어요. 이 방에는 그림이 없어서 글로만 소개해요.',
    [folk('detail/6565', '까치호랑이')], { textOnly: true });
  add('PL_SARANG', 'HX_IRWOROBONG', 'irworobong', '⛰️', '일월오봉도',
    '해와 달, 다섯 봉우리는 임금님 그림!',
    '일월오봉도는 해와 달, 다섯 산봉우리와 소나무를 그린 병풍 그림이에요. 조선 시대 궁궐에서 임금의 자리 뒤에 두었어요. 궁궐에서 쓰던 그림이라 이 방에는 걸지 않고 글로만 소개해요.',
    [enc('E0047296', '일월오봉도')], { textOnly: true });

  // ===== 부엌
  add('PL_BUEOK', 'HX_AGUNGI', 'agungi', '🔥', '아궁이와 부뚜막',
    '아궁이 불로 밥도 짓고 방도 데워요.',
    '부뚜막은 아궁이 위에 흙과 돌을 쌓아 만든 턱으로, 그 위에 솥을 걸어 물을 끓이고 음식을 만들어요. 부뚜막 없이 불길이 곧장 구들로 들어가게 만든 것은 함실아궁이라고 해요.',
    [enc('E0024133', '부뚜막'), enc('E0034216', '아궁이')], { motion: 'MG_GUDEUL' });
  add('PL_BUEOK', 'HX_GAMASOT', 'gamasot', '🍲', '가마솥',
    '가마솥에 밥도 짓고 콩도 삶아요.',
    '가마솥은 솥과 솥뚜껑으로 이루어져 있고, 밥을 짓거나 국과 물을 끓일 때 써요. 메주를 만들 콩도 가마솥에 넣고 푹 삶아요.',
    [folk('detail/9798', '가마솥'), folk('메주쑤기', '메주쑤기')]);
  add('PL_BUEOK', 'HX_SIRU', 'siru', '🍡', '시루',
    '바닥 구멍으로 김이 올라와 떡을 쪄요.',
    '시루는 바닥에 구멍이 뚫린 그릇이에요. 구멍으로 뜨거운 김이 올라와 안에 담은 음식이 쪄져요. 재료가 구멍으로 빠지지 않도록 시루밑을 깔아요.',
    [enc('E0032346', '시루')]);
  add('PL_BUEOK', 'HX_SALGANG', 'salgang', '🫙', '살강과 물두멍',
    '살강엔 그릇, 물두멍엔 물을 두어요.',
    '살강은 그릇을 얹어 두려고 부엌 벽 중턱에 단 선반이에요. 물두멍은 부뚜막 옆에 두고 물을 담아 쓰던, 입이 넓은 항아리예요.',
    [enc('E0001673', '개수통'), folk('부엌', '부엌')]);
  add('PL_BUEOK', 'HX_SOBAN', 'soban', '🍽️', '소반',
    '작은 밥상은 고장마다 모양이 달라요.',
    '소반은 작은 상이에요. 만든 고장의 이름을 따서 통영반, 나주반, 해주반처럼 불러요.',
    [folk('소반', '소반'), enc('E0030068', '소반')]);
  add('PL_BUEOK', 'HX_JORI', 'jori', '🥄', '조리',
    '조리로 쌀을 일고, 설날엔 복조리를 걸어요.',
    '조리는 쌀을 이는 도구예요. 쌀을 인다는 것은 물속에서 흔들어 돌을 가려내는 일을 말해요. 설날 아침에 벽에 걸어 두고 복을 비는 조리는 복조리라고 해요.',
    [enc('E0051717', '조리')]);
  add('PL_BUEOK', 'HX_KI', 'ki', '🧺', '키와 체',
    '키로 까부르고 체로 걸러요.',
    '키는 곡식을 까불러서 쭉정이와 티끌을 날려 보내는 도구예요. 체는 쳇불이라는 그물로 가루나 액체를 걸러요. 구멍이 3㎜ 이상인 체는 어레미라고 불러요.',
    [enc('E0058685', '키'), enc('E0056893', '체'), folk('어레미', '어레미')]);
  add('PL_BUEOK', 'HX_MAETDOL', 'maetdol', '⚙️', '맷돌과 절구',
    '맷돌은 갈고, 절구는 찧어요.',
    '맷돌은 위아래 두 짝의 돌이 맞닿아 돌면서 곡식의 껍질을 벗기거나 가루를 내요. 절구는 통나무나 돌의 속을 파낸 구멍에 곡식을 넣고 절굿공이로 찧는 도구예요.',
    [folk('맷돌', '맷돌'), enc('E0049788', '절구')]);

  // ===== 발효실 — the fermentation year
  add('PL_BALHYO', 'HX_BALHYO', 'balhyo', '🦠', '발효',
    '작은 미생물이 음식을 새 맛으로 바꿔요.',
    '발효는 곰팡이, 세균, 효모 같은 미생물이 재료를 잘게 나누어 새로운 성분을 만들어 내는 일이에요. 우리나라의 발효 음식에는 장, 김치, 젓갈, 술, 식초가 있어요.',
    [enc('E0068069', '발효식품'), folk('발효식품', '발효식품')], { motion: 'MG_MICROBE' });
  add('PL_BALHYO', 'HX_MEJU', 'meju', '🟫', '메주 쑤기',
    '콩을 불리고 삶고 찧어 메주를 빚어요.',
    '메주는 콩을 고르고, 씻고, 불리고, 삶고, 찧은 다음 모양을 빚어 만들어요. 빚은 메주는 겉을 말린 뒤 띄워요. 메주는 10월에서 12월 사이, 주로 입동 무렵에 쑤어요.',
    [folk('메주쑤기', '메주쑤기'), JANG], { motion: 'MG_JANG_YEAR' });
  add('PL_BALHYO', 'HX_BYEOTJIP', 'byeotjip', '🌾', '메주 띄우기',
    '볏짚에 사는 고초균이 메주로 옮겨 가요.',
    '볏짚에는 고초균이라는 세균이 살고 있어요. 메주를 볏짚 위에 놓고 띄우면 이 균이 메주로 옮겨 가서 발효가 일어나요.',
    [src('농촌진흥청 농사로 영상 설명', 'http://www.nongsaro.go.kr/portal/ps/psb/psby/vodPlay.ps?mvpNo=554&mvpClipNo=2')], { motion: 'MG_MICROBE' });
  add('PL_BALHYO', 'HX_JANGDOK', 'jangdok', '🏺', '장 담그기',
    '정월부터 3월 사이에 메주를 소금물에 담가요.',
    '장은 정월에서 3월 사이에 담가요. 소금물의 알맞은 염도는 18~20도쯤이고, 늦게 담글수록 소금을 더 넣어요.',
    [JANG], { motion: 'MG_JANG_YEAR' });
  add('PL_BALHYO', 'HX_JANGAREUGI', 'jangareugi', '🥣', '장 가르기',
    '국물은 간장, 건더기는 된장이 돼요.',
    '장을 담그고 40~60일쯤 지나면 장을 떠서 갈라요. 이때 국물은 간장이 되고, 건더기는 된장이 돼요.',
    [JANG], { motion: 'MG_JANG_YEAR' });
  add('PL_BALHYO', 'HX_SSIGANJANG', 'ssiganjang', '🫗', '씨간장과 겹장',
    '묵은 씨간장을 새 장에 더해요.',
    '지난해에 남겨 둔 씨간장을 새로 담근 장에 더하는 것을 겹장이라고 해요. 메주 하나로 된장과 간장 두 가지를 얻는 것과 함께, 우리 장만의 특징으로 꼽혀요.',
    [JANG_ENC]);
  add('PL_BALHYO', 'HX_YUSAN', 'yusan', '🌏', '세계가 아끼는 장 담그기',
    '장 담그기는 세계가 아끼는 유산이에요.',
    '장 담그기는 2018년 12월 27일에 국가무형유산이 되었어요. 2024년 12월에는 유네스코 인류무형문화유산 대표목록에 올랐고, 우리말로는 ‘한국의 장 담그기 문화’라고 불러요. 공식 영문 이름은 Knowledge, beliefs and practices related to jang making in the Republic of Korea 예요.',
    [JANG_ENC, src('유네스코 무형유산 결정문 19.COM 7.B.3', 'https://ich.unesco.org/en/decisions/19.COM/7.B.3')]);
  add('PL_BALHYO', 'HX_GOCHUJANG', 'gochujang', '🌶️', '고추장',
    '고추장엔 메줏가루와 곡식이 들어가요.',
    '고추장은 메줏가루에 질게 지은 밥이나 떡가루, 죽을 버무리고 고춧가루와 소금을 섞어 만드는 장이에요. 엿기름가루를 넣기도 해요.',
    [enc('E0004012', '고추장'), folk('고추장', '고추장')]);
  add('PL_BALHYO', 'HX_KIMCHIDOK', 'kimchidok', '🥬', '김치가 익는 까닭',
    '젖산균이 김치를 새콤하게 만들어요.',
    '김치가 익는 동안 젖산균이 저절로 늘어나요. 젖산균은 채소에 들어 있는 당을 젖산 같은 신맛 나는 성분으로 바꿔요.',
    [src('농촌진흥청 농사로 자료 (김치 발효)', 'https://www.nongsaro.go.kr/portal/viewer/result/cms_contents/1202/viewer/207969_MF_ATTACH_02.hwp.view.xhtml')], { motion: 'MG_MICROBE' });
  add('PL_BALHYO', 'HX_KIMJANG', 'kimjang', '🧤', '김장',
    '입동 무렵에 함께 담가 나눠 먹어요.',
    '김장은 입동 앞뒤에 해야 제맛이 난다고 전해져요. 김장 문화는 2013년에 유네스코 인류무형문화유산 대표목록에 올랐고, 2017년에는 ‘김치 담그기’가 국가무형유산이 되었어요.',
    [enc('E0047786', '입동'), folk('detail/7405', '김장'), src('유네스코 무형유산 결정문 8.COM 8.23', 'https://ich.unesco.org/en/decisions/8.COM/8.23')]);
  add('PL_BALHYO', 'HX_SIKCHO', 'sikcho', '🍶', '식초',
    '술이 초산균을 만나면 식초가 돼요.',
    '식초는 먼저 술이 만들어진 다음, 초산 발효를 한 번 더 거쳐서 만들어져요. 초산균이 술 속의 알코올을 신맛이 나는 초산으로 바꿔요.',
    [folk('detail/7823', '식초')], { motion: 'MG_MICROBE' });
  add('PL_BALHYO', 'HX_NURUK', 'nuruk', '🍘', '누룩과 막걸리',
    '누룩 속 곰팡이와 효모가 술을 빚어요.',
    '누룩은 밀 같은 곡식을 단단히 뭉쳐 곰팡이와 효모를 키운 덩어리예요. 막걸리는 곡물과 누룩, 물로 빚는 어른들의 술이에요. ‘막걸리 빚기’는 2021년 6월 15일에 국가무형유산이 되었어요.',
    [folk('누룩', '누룩'), enc('E0079922', '막걸리 빚기')], { motion: 'MG_MICROBE' });
  add('PL_BALHYO', 'HX_GEUMJUL', 'geumjul', '🧦', '금줄과 버선본',
    '장독에 금줄을 두르고 종이 버선을 붙여요.',
    '장을 담근 뒤 고추와 한지, 숯을 끼운 금줄을 장독에 둘렀어요. 한지를 버선 모양으로 오린 버선본을 거꾸로 붙이기도 했어요. 장에 나쁜 기운이 들지 않기를 바라던 옛사람들의 믿음이에요.',
    [folk('금줄', '금줄'), JANG_ENC]);

  // ===== 곳간 — grain, jars, the farming year
  add('PL_GOTGAN', 'HX_DWIJU', 'dwiju', '🌾', '곳간과 뒤주',
    '곳간엔 곡식, 뒤주엔 쌀을 넣어요.',
    '광, 헛간, 곡간은 모두 집에서 물건과 곡식을 넣어 두던 곳이에요. 쌀뒤주는 2말에서 10말쯤 들어가는, 옮길 수 있는 나무 궤예요. 벼를 넣는 나락뒤주는 마당에 붙박이로 지었어요.',
    [enc('E0004214', '곳간'), folk('detail/8753', '뒤주')]);
  add('PL_GOTGAN', 'HX_GAMANI', 'gamani', '🧶', '가마니와 멍석',
    '가마니 하나에 쌀이 80킬로그램 들어가요.',
    '한 가마니는 10말로, 쌀로 치면 80㎏이에요. 두 가마니가 모이면 한 섬이라고 해요. 멍석은 마당에 펴 놓고 곡식과 나물을 말리는 데 썼어요.',
    [folk('detail/8216', '가마니'), folk('마당맥질', '마당맥질')]);
  add('PL_GOTGAN', 'HX_JANGDOKDAE', 'jangdokdae', '🏺', '장독대',
    '물이 잘 빠지는 높은 자리에 독을 모아요.',
    '장독대는 장독을 올려놓는 낮은 단이에요. 물이 잘 빠지도록 땅에서 20~30㎝쯤 높이고, 돌과 자갈을 깐 위에 넓적한 돌을 놓아요. 독은 두세 줄로 세우는데 큰 독은 뒤에, 작은 독은 앞에 두어요.',
    [enc('E0048394', '장독대')]);
  add('PL_GOTGAN', 'HX_ONGGI', 'onggi', '💨', '숨 쉬는 옹기',
    '옹기 벽엔 눈에 안 보이는 숨구멍이 있어요.',
    '옹기를 높은 온도로 구우면 그릇 벽 속에 들어 있던 물기(결정수)가 빠져나가면서 아주 작은 구멍이 생겨요. 이 구멍으로 그릇 안팎의 공기가 통해서 옹기를 ‘숨 쉬는 그릇’이라고 불러요.',
    [enc('E0038898', '옹기')], { motion: 'MG_ONGGI_BREATH' });
  add('PL_GOTGAN', 'HX_ONGGI_REGION', 'onggi_region', '🗺️', '고장마다 다른 옹기',
    '추운 고장 옹기는 입이 넓대요.',
    '볕이 적은 중부와 북부 지방은 옹기의 입을 넓게, 더운 남부 지방은 입을 좁히고 어깨를 넓게 만들었다고 해요. 경상도 옹기는 수박처럼 배가 부르고, 강원도 동쪽은 산길로 나르기 좋게 작게 만들었대요. 신문 기획 기사에 실린 이야기예요.',
    [src('경상일보 기획 기사 (2009년 3월 16일)', 'https://www.ksilbo.co.kr/news/articleView.html?idxno=245819')], { motion: 'MG_ONGGI_REGION', confidence: 'medium' });
  add('PL_GOTGAN', 'HX_JEOLGI', 'jeolgi', '🗓️', '스물네 절기',
    '해가 가는 길을 스물네 칸으로 나눈 달력!',
    '해가 한 해 동안 지나는 길을 15도씩 나누어 스물네 절기를 정했어요. 망종은 모내기와 보리 베기에 알맞은 때이고, 입동은 김장할 때를 알려 줘요.',
    [folk('detail/8970', '24절기'), enc('E0017898', '망종'), enc('E0047786', '입동')], { motion: 'MG_JEOLGI' });
  add('PL_GOTGAN', 'HX_GAMJA', 'gamja', '🥔', '정선의 농사',
    '정선은 감자와 옥수수가 잘 자라요.',
    '정선군의 주요 농산물은 고랭지 채소와 감자, 옥수수예요. 강원도는 우리나라에서 감자와 옥수수를 가장 많이 기르는 곳이에요.',
    [enc('E0050384', '정선군'), src('한국민족문화대백과사전 (강원도 농업 설명)', ENC + 'E0022164')]);
  add('PL_GOTGAN', 'HX_GONDEURE', 'gondeure', '🍜', '정선의 음식',
    '곤드레밥, 올챙이국수, 콧등치기국수!',
    '곤드레는 고려엉겅퀴라는 나물로, 어린잎을 밥에 섞어 먹었어요. 올챙이국수는 옥수수로, 콧등치기국수는 메밀로 만드는 정선의 음식이에요.',
    [src('농촌진흥청 농사로 「이달의 음식」 자료', 'https://www.nongsaro.go.kr/portal/ps/psr/psrb/monthFdmtDtl.ps?menuId=&cntntsNo=211034'),
      src('한국관광공사 대한민국 구석구석 (정선 음식)', 'https://korean.visitkorea.or.kr/detail/rem_detail.do?cotid=beeeecd2-16d0-4ca3-8a1c-77103479454b')]);

  // ===== 분양 안내소 — the allotment year (examples of real villages; no prices, the operator's own terms are in the 분양 screen)
  const PAJU = src('파주플러스 기사 (장독 분양 소식)', 'https://www.pajuplus.co.kr/news/article.html?no=12402');
  const IMSIL = src('참참트립 체험 안내 (임실 다락골신전마을)', 'https://www.chamchamtrip.com/site/expr/item/view.do?menuCd=MENU_000000000000006&exItId=EXP_0000000000001448');
  add('PL_OFFICE', 'HX_MANJANGDAE', 'manjangdae', '⛰️', '만장대 이야기',
    '만장대는 ‘만 개의 장독대’라는 뜻이래요.',
    '정선만장대는 강원도 정선군에 있는 전통발효식품 협동조합의 이름이라고 해요. 누리집에는 ‘만 개의 장독대’와 ‘전국민 씨장 갖기 운동’이라는 말이 실려 있대요.',
    [src('정선만장대 누리집', 'https://www.manjangdae.com/')], { confidence: 'medium' });
  add('PL_OFFICE', 'HX_BUNYANG', 'bunyang', '🤝', '장독 분양이란?',
    '내 장독을 마을이 한 해 동안 돌봐 줘요.',
    '장독 분양은 봄에 직접 장을 담그면 운영하는 곳이 한 해 동안 익히고 돌봐 주고, 연말에 된장과 간장을 받아 가는 체험이에요. 경기도 파주의 한 곳은 12월에 한 구좌마다 된장 13~14㎏과 간장 3.6ℓ를 받아 간다고 알렸어요. 받는 양과 날짜는 운영하는 곳마다 달라요.',
    [PAJU]);
  add('PL_OFFICE', 'HX_YEAR_DAMGEUGI', 'year_damgeugi', '1️⃣', '① 담그기',
    '봄이 오기 전에 메주를 소금물에 담가요.',
    '분양받은 장독의 한 해는 장 담그기로 시작해요. 장은 정월에서 3월 사이에 담그고, 체험 마을에서는 2~3월의 정해진 날에 모여 함께 담가요.',
    [JANG, IMSIL, PAJU], { motion: 'MG_JANG_YEAR' });
  add('PL_OFFICE', 'HX_YEAR_GAREUGI', 'year_gareugi', '2️⃣', '② 가르기',
    '담근 지 40일에서 60일쯤 뒤에 장을 갈라요.',
    '장을 담그고 40~60일쯤 지나면 장을 갈라요. 국물은 간장, 건더기는 된장이 돼요. 임실의 한 체험 마을은 4~5월에 장 가르기를 한다고 안내해요.',
    [JANG, IMSIL], { motion: 'MG_JANG_YEAR' });
  add('PL_OFFICE', 'HX_YEAR_IKHIGI', 'year_ikhigi', '3️⃣', '③ 익히기',
    '장독 속에서 장이 천천히 익어 가요.',
    '가른 장은 장독에서 오래 익혀요. 분양 체험에서는 이 동안 운영하는 곳이 장독을 맡아 돌봐 줘요. 다음 일정을 문자로 알려 주는 곳도 있어요.',
    [PAJU, IMSIL], { motion: 'MG_JANG_YEAR' });
  add('PL_OFFICE', 'HX_YEAR_BATNEUN', 'year_batneun', '4️⃣', '④ 받는 날',
    '한 해가 저물 때 잘 익은 내 장을 받아요.',
    '잘 익은 장은 연말에 받아 가요. 파주와 임실의 체험 마을은 12월에 된장과 간장을 가져가는 날을 정해 두었어요.',
    [PAJU, IMSIL], { motion: 'MG_JANG_YEAR' });
  add('PL_OFFICE', 'HX_GUJWA', 'gujwa', '🔢', '구좌가 뭐예요?',
    '구좌는 내가 맡는 몫 하나를 세는 말이에요.',
    '구좌는 분양에서 한 사람이 맡는 몫 하나를 세는 말이에요. 파주의 장독 분양은 콩 한 말을 한 구좌로 정했어요. 텃밭에서는 땅 한 칸을 구획이라고 부르고, 서울의 한 도시 텃밭은 한 구획이 16.5㎡예요.',
    [PAJU, src('서울특별시 내 손안에 서울 (친환경 농장 안내)', 'https://mediahub.seoul.go.kr/archives/2003677')]);
  add('PL_OFFICE', 'HX_BOHOJA', 'bohoja', '👨‍👩‍👧', '어른과 함께 신청해요',
    '분양 신청은 꼭 어른과 함께 해요.',
    '분양을 신청하려면 이름과 연락처 같은 개인정보를 적어야 해요. 만 14세가 안 된 어린이의 개인정보는 보호자가 동의해야 쓸 수 있도록 법으로 정해져 있어서, 신청은 보호자와 함께 해요.',
    [src('국가법령정보센터 개인정보 보호법 제22조의2', 'https://www.law.go.kr/LSW//lsLinkCommonInfo.do?lsJoLnkSeq=1029334873&chrClsCd=010202&ancYnChk='),
      src('찾기 쉬운 생활법령정보 (법정대리인 동의)', 'http://easylaw.go.kr/CSP/CnpClsMain.laf?popMenu=ov&csmSeq=659&ccfNo=2&cciNo=1&cnpClsNo=2')]);

  // ---------------------------------------------------------------- artworks of the pack (The Met Open Access, CC0)
  // art = the G.pack name (§16.1 `art/<id>`); the card draws the picture only when the pack really holds it.
  const MET = '미국 메트로폴리탄 미술관';
  /** art(place, id, anchor, emoji, packId, title, kid, what, titleEn, artist|null, period, creditLine, accession, objectId) */
  const art = (place, id, anchor, emoji, packId, title, kid, what, titleEn, artist, period, creditLine, accession, objectId) => {
    const who = artist ? `${artist}의 작품으로` : '그린 사람은 알려지지 않았고';
    add(place, id, anchor, emoji, title, kid,
      // no particle after the English title (its last sound decides the particle, and that differs from title to title)
      `${what} ${MET}이 간직한 작품이에요. 박물관이 적어 둔 영어 이름은 이렇게 써요: “${titleEn}”. ${who}, ${period}에 그려졌다고 박물관은 기록해요.`,
      [src(`메트로폴리탄 미술관 소장품 기록 (${accession})`, `https://www.metmuseum.org/art/collection/search/${objectId}`)],
      { art: `art/${packId}`, titleEn, artist: artist || '', period, credit: `The Metropolitan Museum of Art, New York · ${creditLine} · ${accession} · Open Access (CC0)` });
  };
  art('PL_ANBANG', 'HX_ART_HWAJO', 'art_hwajo', '🌸', 'birds_flowers_screen', '꽃과 새 병풍',
    '꽃과 새가 가득한 열 폭 병풍이에요.', '비단에 먹과 물감으로 꽃과 새를 그린 열 폭 병풍이에요.',
    'Birds and Flowers', null, '19세기 말에서 20세기 초',
    'Purchase, The Vincent Astor Foundation Gift and John M. Crawford Jr. Bequest, 1993', '1993.255', 44760);
  art('PL_ANBANG', 'HX_ART_DEER', 'art_deer', '🦌', 'deer_pines', '소나무 숲의 사슴',
    '소나무 사이에 사슴이 있는 그림이에요.', '비단에 먹과 물감으로 소나무와 사슴을 그린 족자 한 쌍 가운데 하나예요.',
    'Deer amid Pine Trees', null, '19세기',
    'Purchase, Friends of Asian Art Gifts, 2013', '2013.29a, b', 78286);
  art('PL_ANBANG', 'HX_ART_ROOSTER', 'art_rooster', '🐓', 'rooster_hen_minhwa', '금빛 수탉과 암탉',
    '수탉과 암탉을 함께 그린 그림이에요.', '종이에 먹과 물감으로 수탉과 암탉을 그린 족자예요.',
    'Golden Rooster and Hen', null, '19세기',
    'Rogers Fund, 1919', '19.103.2', 40073);
  art('PL_SARANG', 'HX_ART_CHAEKGEORI', 'art_chaekgeori', '📚', 'chaekgeori_screen', '책과 선비의 물건 병풍',
    '책과 붓, 그릇을 그린 열 폭 병풍이에요.', '비단에 먹과 물감으로 책과 선비의 물건을 그린 열 폭 병풍이에요.',
    'Books and Scholars’ Possessions', null, '20세기 초',
    'Purchase, Shelby White Gift, 2005', '2005.385', 73134);
  art('PL_SARANG', 'HX_ART_STILL_LIFE', 'art_still_life', '🪴', 'still_life_screen', '옛 그릇과 꽃나무 병풍',
    '먹으로 그린 옛 그릇과 꽃나무예요.', '종이에 먹으로 청동 그릇과 꽃나무를 그린 열 폭 병풍이에요.',
    'Still life with bronze vessels and flowering plants', '오원 장승업(Jang Seung-eop)', '1894년',
    'Gift of Mrs. Anita H. Berger, in memory of Ambassador Samuel D. Berger, 2014', '2014.247', 646996);
  art('PL_SARANG', 'HX_ART_PLUM', 'art_plum', '🌸', 'plum_branch', '매화 가지',
    '먹으로 그린 매화 가지예요.', '종이에 먹으로 매화 가지를 그린 족자예요.',
    'Plum Branch', '이유원(Yi Yu-won)', '1888년',
    'Purchase, Seymour and Rogers Funds and Bequest of Dorothy Graham Bennett, 1990', '1990.230', 40445);
  art('PL_SARANG', 'HX_ART_BAMBOO', 'art_bamboo', '🎋', 'bamboo_wind', '바람에 흔들리는 대나무',
    '바람에 흔들리는 대나무 그림이에요.', '비단에 먹으로 바람을 맞는 대나무를 그린 족자예요.',
    'Bamboo in the Wind', '탄은 이정(Yi Jeong)', '17세기 초',
    'Mary Griggs Burke Collection, Gift of the Mary and Jackson Burke Foundation, 2015', '2015.300.299', 50486);
  art('PL_SARANG', 'HX_ART_PORTRAIT', 'art_portrait', '🖼️', 'portrait_yun_dongseom', '윤동섬 초상',
    '옛 어른의 모습을 그린 초상화예요.', '비단에 먹과 물감으로 윤동섬(1710~1795)의 모습을 그린 족자예요.',
    'Portrait of Yun Dongseom (1710–1795)', null, '1790년에서 1805년 무렵',
    'Purchase, Harris Brisbane Dick and 2014 Benefit Funds; Friends of Korean Art, Locks Foundation, Hyun Jun M. Kim, and Tchah Sup and Myong Hi Kim Gifts, 2014', '2014.605', 656430);
  art('PL_SARANG', 'HX_ART_TIGER', 'art_tiger', '🐯', 'tiger_scroll', '호랑이 족자',
    '먹으로 그린 호랑이 그림 족자예요.', '비단에 먹으로 호랑이를 그린 족자예요. 까치호랑이 민화와는 다른 그림이에요.',
    'Tiger', '박물관 기록에 Muqi라고 적힌 화가', '16세기 또는 17세기',
    'Rogers Fund, 1912', '12.123.1', 40069);
  art('PL_DAECHEONG', 'HX_ART_GEESE', 'art_geese', '🐦', 'wild_geese_landscape', '모래톱에 내려앉는 기러기',
    '기러기 떼가 모래톱에 내려앉아요.', '비단에 먹으로 기러기가 내려앉는 물가 풍경을 그린 족자예요.',
    'Wild geese descending to sandbar', null, '15세기 말에서 16세기 초',
    'Purchase, Harris Brisbane Dick Fund, John M. Crawford Jr. Bequest, and The Vincent Astor Foundation Gift, 1992', '1992.337', 39888);
  art('PL_DAECHEONG', 'HX_ART_OFFICIALS', 'art_officials', '👥', 'officials_gathering', '관리들의 모임 그림',
    '옛 관리들이 모인 날을 그린 그림이에요.', '비단에 먹과 물감으로 나라 관리들의 모임을 그린 족자예요.',
    'Gathering of government officials', null, '1551년 무렵',
    'Purchase, Acquisitions Fund, and The Vincent Astor Foundation and Hahn Kwang Ho Gifts, 2008', '2008.55', 74448);
  art('PL_DAECHEONG', 'HX_ART_DRAGON_CARP', 'art_dragon_carp', '🐉', 'dragon_carp_minhwa', '용과 잉어',
    '용과 잉어를 함께 그린 그림이에요.', '종이에 먹과 물감으로 용과 잉어를 그린 그림이에요.',
    'Dragon and carp', null, '19세기 말',
    'Gift of the children of Lea R. Sneider, 2024', '2024.89.3', 853892);

  G.data.exhibits = X;

  // ---------------------------------------------------------------- motion scripts (the drawing code lives in 49-exhibits.js)
  // poster = [step, progress 0..1]: the still frame a card, the 도감 and a reduce-motion board show.
  const M = {};
  const motion = (id, emoji, title, place, poster, steps) => { M[id] = { id, title, emoji, place, poster, steps: steps.map(([caption, say]) => ({ caption, say: say || caption })) }; };

  motion('MG_JANG_YEAR', '🗓️', '장 담그기 열두 달', 'PL_BALHYO', [4, 1], [
    ['입동 무렵, 콩을 삶아 메주를 빚어요.', '입동 무렵에 콩을 삶고 찧어서 메주를 빚어요.'],
    ['겨울 동안 볏짚 위에서 메주를 띄워요.', '겨울 동안 볏짚 위에서 메주를 띄워요. 띄운다는 건 발효시킨다는 뜻이에요.'],
    ['정월부터 3월 사이, 메주를 소금물에 담가요.', '정월부터 삼월 사이에 메주를 소금물에 담가요. 장 담그기예요.'],
    ['40일에서 60일쯤 지나면 장을 갈라요.', '사십 일에서 육십 일쯤 지나면 장을 갈라요.'],
    ['국물은 간장, 건더기는 된장이 돼요.'],
    ['장독 속에서 장이 천천히 익어 가요.'],
    ['한 해가 저물면 잘 익은 장을 받아요.', '한 해가 저물면 잘 익은 장을 받아요. 열두 달이 걸렸어요.'],
  ]);
  motion('MG_ONGGI_BREATH', '💨', '옹기가 숨 쉬는 원리', 'PL_GOTGAN', [4, 0.9], [
    ['옹기는 흙으로 빚은 그릇이에요.'],
    ['가마에 넣고 아주 뜨겁게 구워요.'],
    ['뜨거워지면 벽 속의 물기가 빠져나가요.'],
    ['물기가 나간 자리에 아주 작은 구멍이 생겨요.'],
    ['그 구멍으로 공기가 드나들어요.'],
    ['그래서 옹기를 숨 쉬는 그릇이라고 불러요.'],
  ]);
  motion('MG_GUDEUL', '🔥', '구들에 불이 지나가는 길', 'PL_ANBANG', [3, 1], [
    ['아궁이에 불을 때요.'],
    ['뜨거운 불기운이 방바닥 밑으로 들어가요.'],
    ['바닥 밑의 길 ‘고래’를 따라 올라가요.', '바닥 밑의 길을 고래라고 해요. 불기운이 고래를 따라 올라가요.'],
    ['넓적한 돌 ‘구들장’이 차례로 데워져요.', '바닥에 깐 넓적한 돌을 구들장이라고 해요. 구들장이 차례로 데워져요.'],
    ['연기는 굴뚝으로 빠져나가요.'],
    ['방바닥이 따끈따끈해졌어요.'],
  ]);
  motion('MG_CHEOMA', '☀️', '처마와 해', 'PL_DAECHEONG', [1, 1], [
    ['처마는 벽보다 길게 내민 지붕 끝이에요.'],
    ['여름 해는 높이 떠요. 처마가 볕을 가려요.'],
    ['그래서 여름 마루는 시원해요.'],
    ['겨울 해는 낮게 떠요. 볕이 방 안까지 들어와요.'],
    ['남쪽 지방일수록 처마를 깊게 냈어요.'],
  ]);
  motion('MG_FRAME', '🏗️', '한옥 뼈대 쌓기', 'PL_DAECHEONG', [6, 1], [
    ['땅을 다지고 돌로 기단을 쌓아요.'],
    ['기단 위에 주춧돌을 놓아요.'],
    ['주춧돌 위에 기둥을 세워요.'],
    ['기둥 위에 가장 큰 나무, 대들보를 걸어요.'],
    ['그 위에 도리를 길게 얹어요.'],
    ['도리 사이에 서까래를 촘촘히 걸어요.'],
    ['기와를 올리면 집이 다 됐어요.'],
  ]);
  motion('MG_MARU', '🟫', '우물마루와 들어열개', 'PL_DAECHEONG', [2, 1], [
    ['긴 나무로 마루의 틀을 짜요.'],
    ['틀 사이에 널을 한 장씩 끼워요.'],
    ['‘우물 정’ 글자 모양이 됐어요. 우물마루예요.', '우물 정 글자 모양이 됐어요. 그래서 우물마루예요.'],
    ['나무가 말라 틈이 생기면 널을 밀어 메워요.'],
    ['여름이 오면 분합문을 접어요.'],
    ['접은 문을 고리에 걸면 사방이 시원하게 트여요.'],
  ]);
  motion('MG_CHANGSAL', '🪟', '창살 도감', 'PL_DAECHEONG', [5, 1], [
    ['띠살이에요. 여닫이 창에 많이 썼어요.'],
    ['정자살은 바둑판처럼 네모나요.'],
    ['빗살은 비스듬히 엇갈려요.'],
    ['용자살이에요. 옆으로 미는 창에 썼어요.'],
    ['아자살은 네모가 겹친 무늬예요.'],
    ['완자살은 꺾인 선이 이어져요.'],
    ['창살 위에 한지를 바르면 다 됐어요.'],
  ]);
  motion('MG_MICROBE', '🦠', '작은 일꾼 미생물', 'PL_BALHYO', [5, 1], [
    ['눈에 안 보이는 작은 일꾼, 미생물이에요.'],
    ['볏짚에 사는 고초균이 메주로 옮겨 가요.'],
    ['누룩의 곰팡이와 효모는 술을 빚어요.'],
    ['초산균은 술을 새콤한 식초로 바꿔요.'],
    ['젖산균은 김치를 새콤하게 익혀요.'],
    ['작은 일꾼들 덕분에 새 맛이 생겨요.'],
  ]);
  motion('MG_ONGGI_REGION', '🗺️', '고장마다 다른 옹기', 'PL_GOTGAN', [5, 1], [
    ['옹기는 고장마다 모양이 다르대요.'],
    ['서울과 경기는 입이 넓대요.'],
    ['강원도 동쪽은 작게 만들었대요.'],
    ['충청도는 입과 밑의 크기가 비슷하대요.'],
    ['남쪽 지방은 입이 좁고 어깨가 넓대요.'],
    ['경상도는 수박처럼 배가 불룩하대요.'],
  ]);
  motion('MG_JEOLGI', '🌞', '24절기 해시계', 'PL_GOTGAN', [3, 1], [
    ['해가 한 해 동안 가는 길을 스물네 칸으로 나눴어요.'],
    ['한 칸은 15도, 절기 하나예요.', '한 칸은 십오 도이고, 절기 하나예요.'],
    ['춘분에서 0도로 시작해요.', '춘분에서 영 도로 시작해요.'],
    ['망종에는 모내기와 보리 베기를 했어요.'],
    ['처서는 150도, 8월 23일 무렵이에요.', '처서는 백오십 도이고, 팔월 이십삼 일 무렵이에요.'],
    ['입동이 오면 김장을 준비해요.'],
  ]);

  G.data.motions = M;
})();
