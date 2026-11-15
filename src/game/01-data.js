// =============================================================================
// 01-data.js — game content as data (no THREE usage: this file is also evaluated
// in Node by tools/build.mjs to export reward/timing tables for the PHP server).
//
// Content is separated from code (spec #82-84): adding a crop, quest, recipe or
// achievement = adding an entry here. Education pages/quizzes live in
// 45-education-data.js and NPC dialogue trees in 26-dialogues.js.
// Real-world facts are educational summaries; see `source` fields.
// =============================================================================

G.data.meta = {
  title: '전통발효체험관 메타버스',
  address: '정선군 화암면 소금강로 1511',
  addressNote: '참고 이미지에 표시된 주소입니다. 실제 지도 좌표·행정정보는 별도 검증 후 확정해야 합니다.',
  disclaimer: '체험관 속 발효·재배 수치는 교육용 가상 시뮬레이션이며 실제 식품 제조법이나 효과를 보장하지 않습니다.',
  titleDisclaimer: '체험관 칭호이며 실제 자격증·전문 자격과 무관합니다.',
};

// ------------------------------------------------------------------ zones (circles; smallest containing radius wins)
G.data.zones = [
  { id: 'ZONE_MAIN', name: '중앙 광장', short: '광장', center: [0, 0], r: 16, color: '#d9c9a3', icon: 'home', desc: '체험관의 중심 광장입니다. 만장대에서 내려온 체험객을 발효마스터가 맞이하고 첫 체험을 안내해 줍니다.' },
  { id: 'ZONE_CROP', name: '전통작물 구역', short: '작물밭', center: [0, -34], r: 20, color: '#7fbf5a', icon: 'sprout', desc: '콩·고추·배추 등 전통작물을 직접 심고, 물을 주고, 수확하는 농사 체험 구역입니다.' },
  { id: 'ZONE_HALL', name: '전통발효체험관', short: '체험관', center: [0, -80], r: 28, color: '#9fb4c8', icon: 'home', desc: '현대식 전시관과 한옥 지붕이 어우러진 체험관 본관입니다.' },
  { id: 'ZONE_HERB', name: '허브 구역', short: '허브', center: [-44, -30], r: 15, color: '#b48be0', icon: 'leaf', desc: '박하·라벤더·로즈마리·레몬밤 등 향기로운 허브를 기르는 구역입니다.' },
  { id: 'ZONE_EDUCATION', name: '체험교육 구역', short: '교육', center: [-44, -62], r: 16, color: '#6fb6e8', icon: 'book', desc: '키오스크와 해설사를 통해 전통발효와 전통농업을 배우는 교육 공간입니다.' },
  { id: 'ZONE_FERMENTATION', name: '발효식품 구역', short: '발효식품', center: [-38, 6], r: 17, color: '#e0a35a', icon: 'jar', desc: '된장·간장·고추장·김치·식초를 살펴보고 메주 등 발효 재료를 만들어 보는 구역입니다.' },
  { id: 'ZONE_JANGDOKDAE', name: '장독대 구역', short: '장독대', center: [46, 2], r: 30, color: '#8a5a3b', icon: 'jar', desc: '수백 개의 장독이 늘어선 장독대입니다. 내 장독의 발효 상태를 확인할 수 있습니다.' },
  { id: 'ZONE_REST', name: '휴식정원 구역', short: '휴식정원', center: [48, 50], r: 21, color: '#f08bb0', icon: 'sparkle', desc: '정자와 연못, 꽃밭이 있는 휴식 공간입니다. 사진을 찍고 다른 체험객과 쉬어 가세요.' },
  { id: 'ZONE_ENTRANCE', name: '입구', short: '입구', center: [0, 74], r: 20, color: '#c9c3b5', icon: 'flag', desc: '체험관 정문과 주차장이 있는 입구입니다.' },
  // phase 4: the start point — a high lookout on the southern ridge (elevated: the terrain keeps the hill)
  { id: 'ZONE_MANJANGDAE', name: '정선 만장대', short: '만장대', center: [52, 118], r: 14, color: '#7fa6c9', icon: 'flag', emoji: '🏔️', elevated: true, start: true,
    desc: '체험관과 계곡이 한눈에 내려다보이는 높은 전망대예요. 팔각정과 망원경이 있고, 돌계단 길을 따라 내려가면 정문과 광장이 나와요.',
    kidDesc: '높은 산 위 전망대예요. 체험관이 다 보여요!' },
];
G.data.defaultZone = { id: 'ZONE_TRAIL', name: '산책로', short: '산책로', center: [0, 0], r: 0, color: '#9aa88f', icon: 'pin', desc: '체험관 곳곳을 잇는 산책로입니다.' };
/** zones that count for "모든 구역 방문" */
G.data.visitZones = ['ZONE_MAIN', 'ZONE_CROP', 'ZONE_HALL', 'ZONE_HERB', 'ZONE_EDUCATION', 'ZONE_FERMENTATION', 'ZONE_JANGDOKDAE', 'ZONE_REST', 'ZONE_ENTRANCE'];

// Points of interest (sub-locations; emit `poi:enter`)
G.data.pois = [
  { id: 'POI_STORAGE', name: '발효주 저장고', x: 44, z: -26, r: 9, icon: 'jar', desc: '큰 옹기에 장과 발효주를 보관하는 저장고입니다.' },
  { id: 'POI_TOOLS', name: '전통도구 전시장', x: -64, z: -44, r: 10, icon: 'hammer', desc: '지게·맷돌·절구 등 옛 농기구를 볼 수 있습니다.' },
  { id: 'POI_PAVILION', name: '전통정자', x: 50, z: 41, r: 7, icon: 'home', desc: '연못가에 세운 정자입니다.' },
  { id: 'POI_WATERFALL', name: '폭포 정원', x: -24, z: -62, r: 9, icon: 'droplet', desc: '체험관 앞 작은 폭포와 연못이 있는 정원입니다.' },
  { id: 'POI_RIVERSIDE', name: '계곡 전망대', x: 76, z: 46, r: 8, icon: 'droplet', desc: '맑은 계곡물을 내려다보는 나무 데크입니다.' },
  { id: 'POI_PARKING', name: '주차장', x: -34, z: 90, r: 13, icon: 'pin', desc: '방문객 주차장입니다.' },
  { id: 'POI_HANOK_VILLAGE', name: '한옥마을', x: -64, z: 22, r: 15, icon: 'home', desc: '전통 한옥이 모여 있는 마을입니다.' },
  { id: 'POI_MANJANGDAE_TRAIL', name: '만장대 돌계단 길', x: 33, z: 97, r: 11, icon: 'flag', emoji: '🪜', desc: '만장대에서 정문까지 이어지는 지그재그 돌계단 길입니다. 밧줄 난간을 따라 천천히 내려가 보세요.' },
];

// ------------------------------------------------------------------ items
// type: seed | crop | ingredient | fermented | quest | tool | decoration
G.data.items = {
  // seeds / seedlings
  ITEM_SEED_BEAN: { name: '콩 씨앗', type: 'seed', icon: '🫘', crop: 'CROP_BEAN', price: 60, sell: 20, desc: '된장·간장의 재료가 되는 콩의 씨앗입니다.' },
  ITEM_SEED_PEPPER: { name: '고추 모종', type: 'seed', icon: '🌱', crop: 'CROP_PEPPER', price: 90, sell: 30, desc: '여름 햇볕을 좋아하는 고추 모종입니다.' },
  ITEM_SEED_CABBAGE: { name: '배추 씨앗', type: 'seed', icon: '🌱', crop: 'CROP_CABBAGE', price: 80, sell: 25, desc: '김치의 주재료인 배추 씨앗입니다.' },
  ITEM_SEED_PERILLA: { name: '들깨 씨앗', type: 'seed', icon: '🌱', crop: 'CROP_PERILLA', price: 70, sell: 20, desc: '잎과 씨를 모두 쓰는 들깨 씨앗입니다.' },
  ITEM_SEED_CORN: { name: '옥수수 씨앗', type: 'seed', icon: '🌽', crop: 'CROP_CORN', price: 80, sell: 25, desc: '키가 크게 자라는 옥수수 씨앗입니다.' },
  ITEM_SEED_RADISH: { name: '무 씨앗', type: 'seed', icon: '🌱', crop: 'CROP_RADISH', price: 60, sell: 20, desc: '김치와 장아찌에 쓰는 무 씨앗입니다.' },
  ITEM_SEED_MINT: { name: '박하 모종', type: 'seed', icon: '🌿', crop: 'CROP_MINT', price: 70, sell: 20, desc: '시원한 향의 박하 모종입니다.' },
  ITEM_SEED_LAVENDER: { name: '라벤더 모종', type: 'seed', icon: '🪻', crop: 'CROP_LAVENDER', price: 110, sell: 35, desc: '보랏빛 꽃이 피는 라벤더 모종입니다.' },
  ITEM_SEED_ROSEMARY: { name: '로즈마리 모종', type: 'seed', icon: '🌿', crop: 'CROP_ROSEMARY', price: 100, sell: 30, desc: '바늘 같은 잎을 가진 로즈마리 모종입니다.' },
  ITEM_SEED_LEMONBALM: { name: '레몬밤 모종', type: 'seed', icon: '🌿', crop: 'CROP_LEMONBALM', price: 90, sell: 30, desc: '레몬 향이 나는 레몬밤 모종입니다.' },
  // harvested crops
  ITEM_BEAN: { name: '콩', type: 'crop', icon: '🫘', price: 0, sell: 40, desc: '메주를 쑤어 된장·간장을 만드는 기본 재료입니다.' },
  ITEM_PEPPER: { name: '고추', type: 'crop', icon: '🌶️', price: 0, sell: 50, desc: '말려 빻으면 고춧가루가 됩니다.' },
  ITEM_CABBAGE: { name: '배추', type: 'crop', icon: '🥬', price: 0, sell: 50, desc: '김치를 담그는 대표 채소입니다.' },
  ITEM_PERILLA: { name: '들깨', type: 'crop', icon: '🌿', price: 0, sell: 45, desc: '고소한 향의 들깨입니다.' },
  ITEM_CORN: { name: '옥수수', type: 'crop', icon: '🌽', price: 0, sell: 50, desc: '쪄 먹어도 맛있는 옥수수입니다.' },
  ITEM_RADISH: { name: '무', type: 'crop', icon: '🥕', price: 0, sell: 40, desc: '깍두기·동치미에 쓰는 무입니다.' },
  ITEM_MINT: { name: '박하', type: 'crop', icon: '🌿', price: 0, sell: 40, desc: '상쾌한 향의 허브입니다.' },
  ITEM_LAVENDER: { name: '라벤더', type: 'crop', icon: '🪻', price: 0, sell: 60, desc: '은은한 향의 보라색 허브입니다.' },
  ITEM_ROSEMARY: { name: '로즈마리', type: 'crop', icon: '🌿', price: 0, sell: 55, desc: '향이 진한 허브입니다.' },
  ITEM_LEMONBALM: { name: '레몬밤', type: 'crop', icon: '🍃', price: 0, sell: 50, desc: '레몬 향이 나는 허브입니다.' },
  // ingredients
  ITEM_MEJU: { name: '메주', type: 'ingredient', icon: '🧱', price: 250, sell: 120, desc: '삶은 콩을 찧어 덩어리로 빚어 말린 것으로, 장류의 기본 재료입니다.' },
  ITEM_SALT: { name: '천일염', type: 'ingredient', icon: '🧂', price: 80, sell: 30, desc: '장을 담글 때 쓰는 굵은 소금입니다.' },
  ITEM_GOCHUGARU: { name: '고춧가루', type: 'ingredient', icon: '🌶️', price: 220, sell: 90, desc: '말린 고추를 빻은 가루입니다.' },
  ITEM_RICE: { name: '찹쌀', type: 'ingredient', icon: '🍚', price: 120, sell: 50, desc: '고추장·식초를 만들 때 쓰는 찹쌀입니다.' },
  // fermented foods
  ITEM_DOENJANG: { name: '된장', type: 'fermented', icon: '🟤', price: 0, sell: 400, desc: '메주를 소금물에 담가 숙성시켜 만든 장입니다. (체험 결과물)' },
  ITEM_GANJANG: { name: '간장', type: 'fermented', icon: '🫙', price: 0, sell: 420, desc: '메주를 담근 소금물을 걸러 숙성시킨 장입니다. (체험 결과물)' },
  ITEM_GOCHUJANG: { name: '고추장', type: 'fermented', icon: '🔴', price: 0, sell: 500, desc: '고춧가루·찹쌀·메줏가루로 만든 장입니다. (체험 결과물)' },
  ITEM_KIMCHI: { name: '김치', type: 'fermented', icon: '🥬', price: 0, sell: 450, desc: '절인 채소에 양념을 버무려 발효시킨 음식입니다. (체험 결과물)' },
  ITEM_VINEGAR: { name: '전통 식초', type: 'fermented', icon: '🍶', price: 0, sell: 480, desc: '곡물을 발효시켜 만든 식초입니다. (체험 결과물)' },
  // tools
  ITEM_WATERING_CAN: { name: '물뿌리개', type: 'tool', icon: '🚿', price: 300, sell: 0, desc: '작물에 물을 줄 때 사용합니다. (가방에 있으면 자동 사용)' },
  ITEM_HOMI: { name: '호미', type: 'tool', icon: '⛏️', price: 300, sell: 0, desc: '씨앗을 심고 밭을 고를 때 쓰는 전통 농기구입니다.' },
  ITEM_BASKET: { name: '바구니', type: 'tool', icon: '🧺', price: 200, sell: 0, desc: '수확량이 조금 늘어납니다.' },
  // quest
  ITEM_GUIDEBOOK: { name: '체험관 안내서', type: 'quest', icon: '📘', price: 0, sell: 0, desc: '체험관의 구역과 체험 순서가 적힌 안내서입니다.' },
  // decorations
  ITEM_SMALL_JAR: { name: '작은 장독', type: 'decoration', icon: '🏺', price: 500, sell: 100, desc: '장독대를 꾸미는 작은 장독입니다.' },
  ITEM_FLOWERPOT: { name: '꽃 화분', type: 'decoration', icon: '🪴', price: 350, sell: 80, desc: '알록달록한 꽃 화분입니다.' },
  ITEM_LANTERN: { name: '청사초롱', type: 'decoration', icon: '🏮', price: 600, sell: 120, desc: '밤길을 밝히는 전통 등입니다.' },
};
for (const [id, it] of Object.entries(G.data.items)) { it.id = id; it.stack = it.stack ?? true; it.max = it.max ?? 999; }

G.data.startingInventory = {
  ITEM_SEED_BEAN: 3, ITEM_SEED_PEPPER: 2, ITEM_SEED_CABBAGE: 2, ITEM_SEED_MINT: 2,
  ITEM_WATERING_CAN: 1, ITEM_HOMI: 1, ITEM_MEJU: 1, ITEM_SALT: 2, ITEM_GUIDEBOOK: 1,
};

// ------------------------------------------------------------------ crops
// growthTime = seconds of WATERED growth from seed to harvestable (demo-friendly).
// Stages by growth %: seed 0-19, sprout 20-49, growing 50-79, mature 80-99, harvestable 100.
G.data.cropStages = [
  { id: 'seed', name: '씨앗', min: 0 },
  { id: 'sprout', name: '새싹', min: 20 },
  { id: 'growing', name: '성장 중', min: 50 },
  { id: 'mature', name: '성숙', min: 80 },
  { id: 'harvestable', name: '수확 가능', min: 100 },
];
G.data.crops = {
  CROP_BEAN: { name: '콩', seedItem: 'ITEM_SEED_BEAN', harvestItem: 'ITEM_BEAN', harvestAmount: [3, 5], growthTime: 120, waterUse: 0.16, exp: 40, coin: 30, model: 'bean', color: '#5f9e3a', fruit: '#c9b26b', category: 'crop', desc: '된장·간장·두부의 재료. 뿌리혹박테리아 덕분에 땅을 기름지게 한다고 알려져 있습니다.' },
  CROP_PEPPER: { name: '고추', seedItem: 'ITEM_SEED_PEPPER', harvestItem: 'ITEM_PEPPER', harvestAmount: [3, 5], growthTime: 150, waterUse: 0.175, exp: 45, coin: 35, model: 'pepper', color: '#3f8a35', fruit: '#d8312a', category: 'crop', desc: '고추장·김치 양념에 쓰이는 고추입니다.' },
  CROP_CABBAGE: { name: '배추', seedItem: 'ITEM_SEED_CABBAGE', harvestItem: 'ITEM_CABBAGE', harvestAmount: [2, 4], growthTime: 140, waterUse: 0.2, exp: 45, coin: 35, model: 'cabbage', color: '#8cc65a', fruit: '#e6f1b5', category: 'crop', desc: '김치의 주재료인 결구 배추입니다.' },
  CROP_PERILLA: { name: '들깨', seedItem: 'ITEM_SEED_PERILLA', harvestItem: 'ITEM_PERILLA', harvestAmount: [3, 5], growthTime: 130, waterUse: 0.15, exp: 40, coin: 30, model: 'perilla', color: '#4c8f3c', fruit: '#6aa84f', category: 'crop', desc: '깻잎과 들기름을 얻는 들깨입니다.' },
  CROP_CORN: { name: '옥수수', seedItem: 'ITEM_SEED_CORN', harvestItem: 'ITEM_CORN', harvestAmount: [2, 4], growthTime: 160, waterUse: 0.19, exp: 50, coin: 40, model: 'corn', color: '#6aa443', fruit: '#f2cf4a', category: 'crop', desc: '여름에 키가 크게 자라는 옥수수입니다.' },
  CROP_RADISH: { name: '무', seedItem: 'ITEM_SEED_RADISH', harvestItem: 'ITEM_RADISH', harvestAmount: [2, 4], growthTime: 110, waterUse: 0.17, exp: 35, coin: 30, model: 'radish', color: '#5aa043', fruit: '#f3f1e6', category: 'crop', desc: '깍두기와 동치미에 쓰는 무입니다.' },
  CROP_MINT: { name: '박하', seedItem: 'ITEM_SEED_MINT', harvestItem: 'ITEM_MINT', harvestAmount: [3, 5], growthTime: 90, waterUse: 0.15, exp: 30, coin: 25, model: 'mint', color: '#59b35a', fruit: '#7fd17a', category: 'herb', desc: '시원한 향의 박하(민트)입니다.' },
  CROP_LAVENDER: { name: '라벤더', seedItem: 'ITEM_SEED_LAVENDER', harvestItem: 'ITEM_LAVENDER', harvestAmount: [2, 4], growthTime: 150, waterUse: 0.125, exp: 45, coin: 40, model: 'lavender', color: '#6d9a63', fruit: '#9b72d6', category: 'herb', desc: '보라색 꽃과 은은한 향의 허브입니다.' },
  CROP_ROSEMARY: { name: '로즈마리', seedItem: 'ITEM_SEED_ROSEMARY', harvestItem: 'ITEM_ROSEMARY', harvestAmount: [2, 4], growthTime: 140, waterUse: 0.11, exp: 40, coin: 35, model: 'rosemary', color: '#4f7f55', fruit: '#8fb8d8', category: 'herb', desc: '바늘 모양 잎의 상록 허브입니다.' },
  CROP_LEMONBALM: { name: '레몬밤', seedItem: 'ITEM_SEED_LEMONBALM', harvestItem: 'ITEM_LEMONBALM', harvestAmount: [3, 5], growthTime: 100, waterUse: 0.15, exp: 35, coin: 30, model: 'lemonbalm', color: '#8cc95c', fruit: '#c8e67a', category: 'herb', desc: '레몬 향이 나는 허브입니다.' },
};
for (const [id, c] of Object.entries(G.data.crops)) c.id = id;

// ------------------------------------------------------------------ [env] the Korean crop calendar (CONTRACT §17.5)
// Central inland / Gangwon mountain valley (정선): sow = months to plant in a bed, harvest = the usual harvest months,
// days = planting → harvest at tier 1 and time scale 1 (the real-time beds' 'calendar' basis). Sources: 농촌진흥청
// 텃밭 재배 안내 (rda.go.kr), 농사로 작목 정보, 지역 텃밭 달력 (see the env lane's crop notes). The server reads the
// same table from game-data.json (cropCalendar) and measures with it; G.env.cropFactor gives the gentle season ×
// weather factor (0.5 … 1.05). Words for children stay calm and concrete ('11월 20일쯤 수확해요').
G.data.cropCalendar = {
  CROP_BEAN: { sow: [5, 6], harvest: [10], days: 120, note: '5월 말에서 6월에 심어서, 서리가 내리기 전 10월에 거둬요.' },
  CROP_PEPPER: { sow: [5], harvest: [8, 9, 10], days: 90, note: '서리가 끝난 5월 중순에 모종을 심고, 8월부터 빨간 고추를 따요.' },
  CROP_CABBAGE: { sow: [3, 4, 8], harvest: [5, 6, 10, 11], days: 85, note: '김장 배추는 8월 중순에 심어서 11월에 거둬요. 봄배추도 있어요.' },
  CROP_PERILLA: { sow: [5, 6], harvest: [9, 10], days: 120, note: '6월에 모종을 옮겨 심어요. 깻잎은 여름에, 들깨는 가을에 거둬요.' },
  CROP_CORN: { sow: [4, 5], harvest: [7, 8], days: 95, note: '강원도 찰옥수수는 봄에 심어서 한여름에 쪄 먹어요.' },
  CROP_RADISH: { sow: [3, 4, 8], harvest: [5, 6, 10, 11], days: 75, note: '김장 무는 8월 말에 심어서 늦가을에 뽑아요.' },
  CROP_MINT: { sow: [4, 5], harvest: [6, 7, 8, 9], days: 70, note: '봄에 포기를 나눠 심으면 여름 내내 잎을 따요.' },
  CROP_LAVENDER: { sow: [3, 4, 5], harvest: [6, 7], days: 100, note: '봄에 모종을 심으면 초여름에 보라색 꽃이 피어요.' },
  CROP_ROSEMARY: { sow: [4, 5], harvest: [6, 7, 8, 9, 10], days: 90, note: '봄에 심어요. 추운 겨울에는 집 안으로 들여요.' },
  CROP_LEMONBALM: { sow: [4, 5], harvest: [6, 7, 8, 9], days: 70, note: '봄에 씨를 뿌리면 여름에 레몬 향 잎을 따요.' },
};
for (const [id, cal] of Object.entries(G.data.cropCalendar)) if (G.data.crops[id]) G.data.crops[id].cal = cal;

// ------------------------------------------------------------------ real-time beds "실시간 텃밭" (CONTRACT §15.1)
// Four beds that grow by the wall clock, also while the browser is closed. `minutes` = real minutes at speed tier 1 and
// time scale 1; dur(ms) = minutes × 60000 ÷ (tier × scale). In server mode the server measures the time itself.
// The harvest item / amount come from G.data.crops[id]; no seed is used up and nothing withers.
G.data.rtfarm = {
  beds: ['RB1', 'RB2', 'RB3', 'RB4'],
  careCooldownMin: 5,          // minutes between two waterings of one bed (same divisor as the growth time)
  carePerAction: 25,           // care += 25 per watering, up to 100
  starAt: [0, 40, 75],         // care ≥ 0 → ★, ≥ 40 → ★★, ≥ 75 → ★★★
  bonusAtStars: 3,             // ★★★ → one extra harvest item
  localScale: 1,               // local mode time scale (grown-up gate in the dev center only)
  reportNotes: ['물을 열심히 줬어요!', '매일 보러 왔어요!', '쑥쑥 자라서 기뻐요!', '다음에도 또 키울래요!'],
  crops: {
    CROP_MINT: { minutes: 10, exp: 60, coin: 45 },
    CROP_LEMONBALM: { minutes: 20, exp: 70, coin: 55 },
    CROP_RADISH: { minutes: 30, exp: 80, coin: 60 },
    CROP_BEAN: { minutes: 60, exp: 100, coin: 80 },
    CROP_PERILLA: { minutes: 90, exp: 120, coin: 95 },
    CROP_CABBAGE: { minutes: 120, exp: 140, coin: 110 },
    CROP_PEPPER: { minutes: 180, exp: 170, coin: 135 },
    CROP_LAVENDER: { minutes: 240, exp: 200, coin: 160 },
    CROP_ROSEMARY: { minutes: 360, exp: 260, coin: 200 },
    CROP_CORN: { minutes: 480, exp: 320, coin: 250 },
  },
};
// 곳간 (storage, CONTRACT §15.2): crop / herb harvest items and finished fermentation goods; total quantity ≤ cap
G.data.storage = {
  cap: 300,
  itemIds: Object.keys(G.data.items).filter((id) => G.data.items[id].type === 'crop' || G.data.items[id].type === 'fermented'),
};

G.data.farming = {
  waterPerAction: 45,       // +water % per watering
  waterCooldown: 2.5,       // seconds per plot
  dryThreshold: 25,         // below -> half growth speed
  healthDecayDry: 0.05,     // health / s while water == 0 (gentle: a dry crop survives ~30 min)
  healthRegen: 0.08,        // health / s while water >= dryThreshold
  basketBonus: 1,           // extra item with ITEM_BASKET
  offlineCatchUpMax: 1800,  // seconds simulated when returning
};

// ------------------------------------------------------------------ fermentation (educational simulation)
G.data.jarStates = ['EMPTY', 'PREPARING', 'FERMENTING', 'AGING', 'COMPLETE', 'CLAIMED'];
G.data.jarStateNames = { EMPTY: '비어 있음', PREPARING: '재료 준비', FERMENTING: '발효 중', AGING: '숙성 중', COMPLETE: '완성', CLAIMED: '수령 완료' };
G.data.recipes = {
  FER001: { name: '된장 체험', resultItem: 'ITEM_DOENJANG', resultQty: 2, ingredients: { ITEM_MEJU: 1, ITEM_SALT: 1 }, baseDuration: 180, idealTemp: [15, 28], idealHumidity: [50, 75], baseQuality: 60, exp: 200, coin: 300, edu: 'EDU_DOENJANG', color: '#6b4a2b', icon: '🟤', desc: '메주와 소금물로 된장을 숙성시키는 체험입니다.' },
  FER002: { name: '간장 체험', resultItem: 'ITEM_GANJANG', resultQty: 2, ingredients: { ITEM_MEJU: 1, ITEM_SALT: 2 }, baseDuration: 240, idealTemp: [15, 28], idealHumidity: [50, 75], baseQuality: 60, exp: 230, coin: 350, edu: 'EDU_GANJANG', color: '#2e1c12', icon: '🫙', desc: '메주를 담근 소금물을 숙성시켜 간장을 만드는 체험입니다.' },
  FER003: { name: '고추장 체험', resultItem: 'ITEM_GOCHUJANG', resultQty: 2, ingredients: { ITEM_GOCHUGARU: 1, ITEM_RICE: 1, ITEM_MEJU: 1 }, baseDuration: 300, idealTemp: [15, 26], idealHumidity: [45, 70], baseQuality: 58, exp: 260, coin: 400, edu: 'EDU_GOCHUJANG', color: '#a5281e', icon: '🔴', desc: '고춧가루·찹쌀·메주로 고추장을 숙성시키는 체험입니다.' },
  FER004: { name: '김치 체험', resultItem: 'ITEM_KIMCHI', resultQty: 2, ingredients: { ITEM_CABBAGE: 2, ITEM_GOCHUGARU: 1, ITEM_SALT: 1 }, baseDuration: 150, idealTemp: [4, 15], idealHumidity: [60, 85], baseQuality: 62, exp: 220, coin: 330, edu: 'EDU_KIMCHI', color: '#c43c2c', icon: '🥬', desc: '절인 배추에 양념을 버무려 발효시키는 체험입니다.' },
  FER005: { name: '전통 식초 체험', resultItem: 'ITEM_VINEGAR', resultQty: 1, ingredients: { ITEM_RICE: 2 }, baseDuration: 360, idealTemp: [20, 30], idealHumidity: [50, 75], baseQuality: 55, exp: 280, coin: 450, edu: 'EDU_FERMENT', color: '#c9a44a', icon: '🍶', desc: '곡물로 빚은 술을 초산 발효시켜 식초를 만드는 체험입니다.' },
};
for (const [id, r] of Object.entries(G.data.recipes)) r.id = id;
G.data.fermentation = {
  // progress% thresholds for states
  stages: { PREPARING: 0, FERMENTING: 10, AGING: 60 },
  careCooldown: 20,          // seconds between care actions per jar
  maxJars: 3,                // jars a player can own
  extraJarPrice: 1500,       // coins to unlock jar 2 and 3
  starterRecipe: 'FER001',   // gifted fermentation already running in jar #1
  starterProgress: 35,       // % already done when a new player starts
  gradeNames: [[90, '최상'], [75, '상'], [55, '중'], [0, '하']],
};
// Simple processing recipes (fermentation zone work table)
G.data.crafts = {
  CRAFT_MEJU: { name: '메주 빚기', icon: '🧱', in: { ITEM_BEAN: 3 }, out: { ITEM_MEJU: 1 }, exp: 40, desc: '콩 3개를 삶아 찧은 뒤 네모나게 빚어 메주를 만듭니다. (실제 과정을 단순화)' },
  CRAFT_GOCHUGARU: { name: '고춧가루 빻기', icon: '🌶️', in: { ITEM_PEPPER: 3 }, out: { ITEM_GOCHUGARU: 1 }, exp: 30, desc: '말린 고추 3개를 빻아 고춧가루를 만듭니다.' },
  CRAFT_HERB_TEA: { name: '허브 다발 묶기', icon: '💐', in: { ITEM_MINT: 2, ITEM_LAVENDER: 1 }, out: { ITEM_FLOWERPOT: 1 }, exp: 30, desc: '허브로 향기로운 화분 장식을 만듭니다.' },
};
for (const [id, c] of Object.entries(G.data.crafts)) c.id = id;

// ------------------------------------------------------------------ shops
G.data.shops = {
  SHOP_GENERAL: {
    name: '체험관 매점', npc: 'NPC005',
    sells: ['ITEM_WATERING_CAN', 'ITEM_HOMI', 'ITEM_SEED_BEAN', 'ITEM_SEED_PEPPER', 'ITEM_SEED_CABBAGE', 'ITEM_SEED_PERILLA', 'ITEM_SEED_CORN', 'ITEM_SEED_RADISH', 'ITEM_SEED_MINT', 'ITEM_SEED_LAVENDER', 'ITEM_SEED_ROSEMARY', 'ITEM_SEED_LEMONBALM', 'ITEM_SALT', 'ITEM_RICE', 'ITEM_MEJU', 'ITEM_GOCHUGARU', 'ITEM_BASKET', 'ITEM_SMALL_JAR', 'ITEM_FLOWERPOT', 'ITEM_LANTERN'],
    buysTypes: ['crop', 'fermented', 'decoration', 'ingredient'],
  },
};

// ------------------------------------------------------------------ NPCs
// appearance keys: see G.avatar (20-avatar.js)
G.data.npcs = {
  NPC001: { name: '발효마스터', role: '전통발효 교육 담당', zone: 'ZONE_MAIN', pos: [-5, -5], rotY: 0.35, wander: 0, dialogue: 'npc_master', greeting: '어서 오세요! 전통발효체험관입니다.', appearance: { skin: '#efc6a2', hair: 'short', hairColor: '#2a2522', top: 'apron', topColor: '#f1ece1', bottom: 'pants', bottomColor: '#3c3934', shoes: '#2a1d14', bag: 'none', accessory: 'headband', accessoryColor: '#2f7d4a', face: 'smile', height: 1.0 } },
  NPC002: { name: '산골농부', role: '작물·재배 교육 담당', zone: 'ZONE_CROP', pos: [-19, -31], rotY: 1.2, wander: 5, dialogue: 'npc_farmer', greeting: '오늘 날씨가 좋네요! 밭일하기 딱이에요.', appearance: { skin: '#d9a77f', hair: 'short', hairColor: '#4a3a2c', top: 'shirt', topColor: '#6d8f4e', bottom: 'pants', bottomColor: '#5a4636', shoes: '#3b2a1c', bag: 'basket', bagColor: '#b88a4a', accessory: 'strawhat', accessoryColor: '#e2c27a', face: 'smile', height: 1.02 } },
  NPC003: { name: '전통사랑', role: '지역문화·체험 프로그램 담당', zone: 'ZONE_EDUCATION', pos: [-42, -57], rotY: 2.6, wander: 3, dialogue: 'npc_culture', greeting: '모두 반갑습니다~ 전통문화 이야기 들어 보실래요?', appearance: { skin: '#f3cfb0', hair: 'bun', hairColor: '#1f1a18', top: 'hanbok', topColor: '#f08bb0', bottom: 'skirt', bottomColor: '#2f6f8f', shoes: '#f5f0e6', bag: 'none', accessory: 'none', face: 'smile', height: 0.97 } },
  NPC004: { name: '장독지기', role: '장독대 관리 담당', zone: 'ZONE_JANGDOKDAE', pos: [23, 10], rotY: -1.3, wander: 3, dialogue: 'npc_keeper', greeting: '장독은 햇볕과 바람이 잘 드는 곳에 두어야 해요.', appearance: { skin: '#e2b38c', hair: 'short', hairColor: '#b9b4ad', top: 'hanbok', topColor: '#d9d2c3', bottom: 'pants', bottomColor: '#7a6a55', shoes: '#3a2b1d', bag: 'none', accessory: 'beard', accessoryColor: '#cfcac2', face: 'calm', height: 0.98 } },
  NPC005: { name: '안내원', role: '입구 안내·매점 담당', zone: 'ZONE_ENTRANCE', pos: [6, 66], rotY: 3.4, wander: 0, dialogue: 'npc_guide', greeting: '전통발효체험관에 오신 것을 환영합니다!', shop: 'SHOP_GENERAL', appearance: { skin: '#f1c9a8', hair: 'ponytail', hairColor: '#3a2a20', top: 'jacket', topColor: '#2f7d4a', bottom: 'pants', bottomColor: '#2c3540', shoes: '#1f1f22', bag: 'none', accessory: 'cap', accessoryColor: '#2f7d4a', face: 'smile', height: 0.99 } },
};
for (const [id, n] of Object.entries(G.data.npcs)) n.id = id;
// [avatar] CONTRACT §17.7 — the guides wear the realistic style: hats move to the `hat` key, hanbok goes with 고무신
for (const n of Object.values(G.data.npcs)) {
  const a = n.appearance;
  if (!a || a.style) continue;
  a.style = 'real';
  if (['strawhat', 'headband', 'cap', 'gat'].includes(a.accessory)) { a.hat = a.accessory; a.hatColor = a.accessoryColor || '#1f1f22'; a.accessory = 'none'; }
  a.footwear = a.top === 'hanbok' ? 'gomusin' : 'sneakers';
}

// ------------------------------------------------------------------ quests
// objective types: talk{npc} visit{zone|poi} water plant harvest{crop?} ferment_check ferment_start ferment_claim{recipe?}
//   edu{edu?} quiz{quiz?} journal photo{photoZone?} emote{emote?} gesture interact{kind?,id?} collect{item} craft{craft?}
//   chat visit_all level{count=level}
G.data.questStates = ['locked', 'available', 'accepted', 'progress', 'completed', 'claimed'];
G.data.quests = {
  QUEST001: {
    title: '체험관에 오신 것을 환영합니다', icon: '🏮', category: 'main', giver: 'NPC001', autoAccept: true, sequential: true, tracked: true,
    desc: '정선 만장대에서 체험관을 내려다본 뒤, 돌계단 길을 따라 내려가 광장의 발효마스터를 만나요. 그다음 발효마스터의 안내에 따라 핵심 체험을 하나씩 해 보세요.',
    easyDesc: '산 위 전망대에서 내려가 발효마스터를 만나요!',
    objectives: [
      { type: 'talk', npc: 'NPC001', count: 1, text: '만장대에서 내려가 발효마스터와 인사하기', easyText: '산에서 내려가 발효마스터랑 이야기해요' },
      { type: 'visit', zone: 'ZONE_CROP', count: 1, text: '전통작물 구역으로 이동하기' },
      { type: 'water', count: 1, text: '작물에 물 주기' },
      { type: 'harvest', count: 1, text: '다 자란 작물 수확하기' },
      { type: 'visit', zone: 'ZONE_JANGDOKDAE', count: 1, text: '장독대 방문하기' },
      { type: 'ferment_check', count: 1, text: '빛나는 내 장독의 발효 상태 확인하기' },
      { type: 'edu', count: 1, text: '안내판·키오스크에서 교육 콘텐츠 보기' },
      { type: 'quiz', count: 1, text: '전통발효 퀴즈 맞히기' },
      { type: 'journal', count: 1, text: '작업일지 작성하기 (J)' },
    ],
    reward: { coin: 3000, exp: 500, edu: 30, items: { ITEM_SMALL_JAR: 1, ITEM_SEED_BEAN: 3 }, title: '체험관 새내기' },
  },
  Q_FIRST_WATER: { title: '첫 관수', icon: '💧', category: 'farm', autoAccept: true, tracked: true, desc: '농장 구역 한 곳에 물을 주세요.', objectives: [{ type: 'water', count: 1, text: '작물에 물 주기' }], reward: { coin: 1000, exp: 50 } },
  Q_HARVEST3: { title: '작물 수확', icon: '🌱', category: 'farm', autoAccept: true, tracked: true, desc: '작물 3개를 수확하세요.', objectives: [{ type: 'harvest', count: 3, text: '작물 수확하기' }], reward: { coin: 5000, exp: 150 } },
  Q_JOURNAL5: { title: '작업일지', icon: '📋', category: 'journal', autoAccept: true, tracked: true, desc: '작업일지를 5회 작성하세요.', objectives: [{ type: 'journal', count: 5, text: '작업일지 작성하기' }], reward: { coin: 3000, exp: 200, title: '기록하는 농부' } },
  Q_TOUR: { title: '체험관 둘러보기', icon: '🏛️', category: 'explore', autoAccept: true, desc: '전통발효체험관 본관 앞까지 가 보세요.', objectives: [{ type: 'visit', zone: 'ZONE_HALL', count: 1, text: '체험관 본관 방문하기' }], reward: { coin: 500, exp: 80 } },
  Q_STORAGE: { title: '발효주 저장고 방문하기', icon: '🏺', category: 'explore', autoAccept: true, desc: '장독대 북쪽의 발효주 저장고를 찾아가 보세요.', objectives: [{ type: 'visit', poi: 'POI_STORAGE', count: 1, text: '발효주 저장고 방문하기' }], reward: { coin: 500, exp: 80 } },
  Q_ALL_ZONES: { title: '산골 탐험가', icon: '🧭', category: 'explore', autoAccept: true, desc: '체험관의 모든 구역을 방문해 보세요.', objectives: [{ type: 'visit_all', count: 9, text: '모든 구역 방문하기' }], reward: { coin: 2000, exp: 300, title: '산골 탐험가' } },
  Q_FARMER: { title: '산골농부의 부탁', icon: '👨‍🌾', category: 'farm', giver: 'NPC002', requires: ['QUEST001'], desc: '빈 밭에 씨앗을 심어 산골농부를 도와주세요.', objectives: [{ type: 'talk', npc: 'NPC002', count: 1, text: '산골농부와 대화하기' }, { type: 'plant', count: 2, text: '빈 밭에 씨앗 심기' }], sequential: true, reward: { coin: 1200, exp: 150, items: { ITEM_SEED_CORN: 2, ITEM_SEED_RADISH: 2, ITEM_BASKET: 1 } } },
  Q_HERB: { title: '향긋한 허브', icon: '🪻', category: 'farm', giver: 'NPC002', requires: ['Q_FARMER'], desc: '허브 구역에서 허브를 2번 수확하세요.', objectives: [{ type: 'harvest', category: 'herb', count: 2, text: '허브 수확하기' }], reward: { coin: 1500, exp: 180, items: { ITEM_SEED_LAVENDER: 2, ITEM_SEED_ROSEMARY: 2 } } },
  Q_MEJU: { title: '메주 빚기', icon: '🧱', category: 'ferment', giver: 'NPC004', requires: ['QUEST001'], desc: '콩을 수확해 발효식품 구역 작업대에서 메주를 빚어 보세요.', objectives: [{ type: 'craft', craft: 'CRAFT_MEJU', count: 1, text: '작업대에서 메주 빚기' }], reward: { coin: 800, exp: 120, items: { ITEM_SALT: 2 } } },
  Q_DOENJANG: { title: '된장 발효 완성', icon: '🟤', category: 'ferment', giver: 'NPC004', requires: ['QUEST001'], desc: '내 장독의 된장 발효를 끝까지 완성하고 수령하세요.', objectives: [{ type: 'ferment_claim', recipe: 'FER001', count: 1, text: '된장 발효 완성 후 수령하기' }], reward: { coin: 2000, exp: 300, edu: 20, title: '장 담그는 손' } },
  Q_NEW_FERMENT: { title: '새로운 발효 도전', icon: '🫙', category: 'ferment', giver: 'NPC004', requires: ['Q_DOENJANG'], desc: '장독에 새로운 발효를 시작해 보세요.', objectives: [{ type: 'ferment_start', count: 1, text: '장독에 발효 시작하기' }], reward: { coin: 1000, exp: 150 } },
  Q_QUIZ3: { title: '발효 박사 도전', icon: '🎓', category: 'edu', giver: 'NPC003', requires: ['QUEST001'], desc: '전통발효 퀴즈 3문제를 맞혀 보세요.', objectives: [{ type: 'quiz', count: 3, text: '퀴즈 정답 맞히기' }], reward: { coin: 1500, exp: 250, edu: 30 } },
  Q_CULTURE: { title: '옛 농기구 탐구', icon: '🛠️', category: 'edu', giver: 'NPC003', requires: ['QUEST001'], desc: '전통도구 전시장에서 옛 농기구 3가지를 살펴보세요.', objectives: [{ type: 'interact', kind: 'tool', count: 3, text: '전통도구 살펴보기' }], reward: { coin: 1000, exp: 150, edu: 15 } },
  Q_PHOTO: { title: '추억 남기기', icon: '📷', category: 'social', autoAccept: true, desc: '포토존에서 사진을 한 장 찍어 보세요.', objectives: [{ type: 'photo', photoZone: '*', count: 1, text: '포토존에서 사진 찍기 (P)' }], reward: { coin: 800, exp: 100 } },
  Q_GREET: { title: '반가운 인사', icon: '👋', category: 'social', autoAccept: true, desc: '이모지로 다른 체험객에게 인사해 보세요.', objectives: [{ type: 'emote', emote: 'EMO_HELLO', count: 1, text: '인사 이모지 보내기' }], reward: { coin: 300, exp: 40 } },
  // 집 구경 (CONTRACT §16.6, 49-exhibits.js): progress comes from 'interact' events — kind 'place' (a room entered),
  // 'heritage' (an exhibit looked at), 'motion' (a moving picture watched to its end), 'roombook' (a room's 도감 complete);
  // each counts different rooms / exhibits / pictures only (the quest system keeps the ids it has seen)
  Q_HOUSE_ROOMS: { title: '한옥 방 구경', icon: '🏠', category: 'explore', autoAccept: true, desc: '한옥 안으로 들어가 방 세 곳을 구경해 보세요. 문 앞에 서면 들어갈 수 있어요.', easyDesc: '한옥 방 세 곳에 들어가 봐요!', objectives: [{ type: 'interact', kind: 'place', count: 3, text: '한옥 방 3곳 들어가 보기', easyText: '한옥 방에 들어가 봐요' }], reward: { coin: 600, exp: 100 } },
  Q_HOUSE_EXHIBITS: { title: '옛 살림 살펴보기', icon: '🔎', category: 'edu', autoAccept: true, desc: '방 안의 옛 살림과 그림 10가지를 살펴보세요. 살펴본 것은 ‘집 구경 도감’에 도장으로 모여요.', easyDesc: '방 안의 물건 열 가지를 살펴봐요!', objectives: [{ type: 'interact', kind: 'heritage', count: 10, text: '방 안의 전시 10가지 살펴보기', easyText: '방 안의 물건을 살펴봐요' }], reward: { coin: 1000, exp: 180, edu: 15 } },
  Q_HOUSE_MOTION: { title: '움직이는 그림 보기', icon: '🎞️', category: 'edu', autoAccept: true, desc: '움직이는 그림 3편을 끝까지 보세요. 구들·처마·옹기가 어떻게 일하는지 그림으로 알려 줘요.', easyDesc: '움직이는 그림 세 편을 끝까지 봐요!', objectives: [{ type: 'interact', kind: 'motion', count: 3, text: '움직이는 그림 3편 끝까지 보기', easyText: '움직이는 그림을 끝까지 봐요' }], reward: { coin: 800, exp: 150, edu: 15 } },
  Q_HOUSE_BOOK: { title: '방 하나 도감 완성', icon: '🏅', category: 'explore', autoAccept: true, desc: '방 한 곳의 전시를 모두 살펴보고 그 방의 도감을 완성하세요.', easyDesc: '방 하나의 도장을 모두 모아요!', objectives: [{ type: 'interact', kind: 'roombook', count: 1, text: '방 한 곳의 도감 완성하기', easyText: '방 하나의 도장을 모두 모아요' }], reward: { coin: 1500, exp: 250, title: '집 구경 박사' } },
};
for (const [id, q] of Object.entries(G.data.quests)) { q.id = id; q.objectives.forEach((o, i) => { o.index = i; o.count = o.count || 1; }); }

// ------------------------------------------------------------------ achievements
// condition: { stat, gte }  — stats are derived/maintained by the progression system
G.data.achievements = {
  ACH_FIRST_VISIT: { name: '첫 방문', icon: '🎉', desc: '전통발효체험관에 처음 입장했습니다.', condition: { stat: 'logins', gte: 1 }, reward: { coin: 100 } },
  ACH_FIRST_WATER: { name: '첫 물주기', icon: '💧', desc: '작물에 처음으로 물을 주었습니다.', condition: { stat: 'waters', gte: 1 }, reward: { coin: 100 } },
  ACH_FIRST_HARVEST: { name: '첫 수확', icon: '🧺', desc: '처음으로 작물을 수확했습니다.', condition: { stat: 'harvests', gte: 1 }, reward: { coin: 200 } },
  ACH_FIRST_FERMENT: { name: '첫 발효', icon: '🏺', desc: '처음으로 발효를 완성해 수령했습니다.', condition: { stat: 'fermentsClaimed', gte: 1 }, reward: { coin: 300, title: '발효 입문자' } },
  ACH_FIRST_QUIZ: { name: '첫 퀴즈', icon: '✅', desc: '퀴즈를 처음으로 맞혔습니다.', condition: { stat: 'quizCorrect', gte: 1 }, reward: { coin: 100 } },
  ACH_FIRST_JOURNAL: { name: '첫 작업일지', icon: '📝', desc: '작업일지를 처음 작성했습니다.', condition: { stat: 'journals', gte: 1 }, reward: { coin: 100 } },
  ACH_JOURNAL5: { name: '꾸준한 기록', icon: '📚', desc: '작업일지를 5회 작성했습니다.', condition: { stat: 'journals', gte: 5 }, reward: { coin: 500, title: '꾸준한 기록가' } },
  ACH_PHOTO10: { name: '사진작가', icon: '📸', desc: '사진을 10장 촬영했습니다.', condition: { stat: 'photos', gte: 10 }, reward: { coin: 500, title: '산골 사진작가' } },
  ACH_ALL_ZONES: { name: '모든 구역 방문', icon: '🗺️', desc: '체험관의 모든 구역을 방문했습니다.', condition: { stat: 'zonesVisited', gte: 9 }, reward: { coin: 500 } },
  ACH_CROPS5: { name: '작물 수집가', icon: '🌾', desc: '서로 다른 작물·허브 5종을 수확했습니다.', condition: { stat: 'cropKinds', gte: 5 }, reward: { coin: 600 } },
  ACH_EDU5: { name: '배움의 즐거움', icon: '📖', desc: '교육 콘텐츠 5개를 끝까지 학습했습니다.', condition: { stat: 'eduCompleted', gte: 5 }, reward: { coin: 500, edu: 20 } },
  ACH_LEVEL5: { name: '체험생', icon: '⭐', desc: '레벨 5를 달성했습니다.', condition: { stat: 'level', gte: 5 }, reward: { coin: 500 } },
  ACH_FRIENDLY: { name: '친절한 체험객', icon: '🤝', desc: '이모지·제스처로 10번 소통했습니다.', condition: { stat: 'socials', gte: 10 }, reward: { coin: 300 } },
  ACH_WALKER: { name: '산책 마니아', icon: '👟', desc: '체험관 안을 6km 걸었습니다.', condition: { stat: 'distance', gte: 6000 }, reward: { coin: 400 } },
  ACH_NPC_ALL: { name: '마당발', icon: '🧑‍🤝‍🧑', desc: '모든 NPC와 대화했습니다.', condition: { stat: 'npcsTalked', gte: 5 }, reward: { coin: 400 } },
  ACH_FIRST_CHAT: { name: '첫 인사말', icon: '💬', desc: '채팅으로 처음 이야기했습니다.', condition: { stat: 'chats', gte: 1 }, reward: { coin: 50 } },
  ACH_CRAFTER: { name: '손재주꾼', icon: '🛠️', desc: '작업대에서 재료를 3번 만들었습니다.', condition: { stat: 'crafts', gte: 3 }, reward: { coin: 300 } },
  // phase 6 (CONTRACT §14.2): the second Space press in the air — stats.doubleJumps counts them (62-engagement)
  ACH_DOUBLE_JUMP: { name: '두 번 점프', icon: '🤸', desc: '두 번 점프를 10번 했습니다.', condition: { stat: 'doubleJumps', gte: 10 }, reward: { coin: 200 } },
  // 집 구경 (CONTRACT §16.6): plain counters kept by 49-exhibits.js — always the sizes of state.places
  // (placesSeen = rooms entered, exhibitsSeen = 도감 stamps, exhibitRooms = rooms whose 도감 is complete, motionsSeen = pictures watched)
  ACH_HOUSE_FIRST: { name: '첫 집 구경', icon: '🏠', desc: '한옥 방에 처음 들어가 보았습니다.', condition: { stat: 'placesSeen', gte: 1 }, reward: { coin: 100 } },
  ACH_HOUSE_ALL: { name: '집 구경 한 바퀴', icon: '🏡', desc: '집 안의 방과 장소 여섯 곳을 구경했습니다.', condition: { stat: 'placesSeen', gte: 6 }, reward: { coin: 500, title: '한옥 길잡이' } },
  ACH_EXHIBIT10: { name: '눈 밝은 구경꾼', icon: '🔎', desc: '방 안의 전시를 10가지 살펴보았습니다.', condition: { stat: 'exhibitsSeen', gte: 10 }, reward: { coin: 300 } },
  ACH_EXHIBIT40: { name: '옛 살림 박사', icon: '🧑‍🏫', desc: '방 안의 전시를 40가지 살펴보았습니다.', condition: { stat: 'exhibitsSeen', gte: 40 }, reward: { coin: 800, edu: 20 } },
  ACH_ROOMBOOK1: { name: '첫 도감 완성', icon: '🏅', desc: '방 한 곳의 집 구경 도감을 완성했습니다.', condition: { stat: 'exhibitRooms', gte: 1 }, reward: { coin: 400 } },
  ACH_ROOMBOOK_ALL: { name: '집 구경 도감 완성', icon: '🏆', desc: '일곱 곳 모두의 집 구경 도감을 완성했습니다.', condition: { stat: 'exhibitRooms', gte: 7 }, reward: { coin: 1500, title: '한옥 도감 지킴이' } },
  ACH_MOTION5: { name: '그림으로 배우기', icon: '🎞️', desc: '움직이는 그림 5편을 끝까지 보았습니다.', condition: { stat: 'motionsSeen', gte: 5 }, reward: { coin: 400, edu: 15 } },
};
for (const [id, a] of Object.entries(G.data.achievements)) a.id = id;

// ------------------------------------------------------------------ levels & titles
G.data.levels = {
  max: 50,
  /** exp needed to go from `level` to `level+1` */
  expFor(level) { return Math.round(120 * Math.pow(level, 1.35)); },
  titles: { 1: '입문자', 5: '체험생', 10: '발효 견습생', 20: '발효 연구생', 30: '전통발효 전문가' },
};

// ------------------------------------------------------------------ collection (도감)
// unlock: list of { on: harvest|item|talk|edu|interact|claim|visit, ... } (any one unlocks)
G.data.collectionCategories = [
  { id: 'crop', name: '작물', icon: '🌾' },
  { id: 'fermented', name: '발효식품', icon: '🏺' },
  { id: 'jar', name: '장독대', icon: '🫙' },
  { id: 'tool', name: '전통도구', icon: '🛠️' },
  { id: 'plant', name: '식물', icon: '🌿' },
  { id: 'npc', name: 'NPC', icon: '🧑' },
  { id: 'edu', name: '교육', icon: '📖' },
];
G.data.collection = {
  COL_BEAN: { category: 'crop', name: '콩', icon: '🫘', location: '전통작물 구역', desc: '장류의 기본 재료. 삶아 찧어 메주를 만듭니다.', unlock: [{ on: 'harvest', crop: 'CROP_BEAN' }] },
  COL_PEPPER: { category: 'crop', name: '고추', icon: '🌶️', location: '전통작물 구역', desc: '말려서 고춧가루로 만들어 고추장·김치에 씁니다.', unlock: [{ on: 'harvest', crop: 'CROP_PEPPER' }] },
  COL_CABBAGE: { category: 'crop', name: '배추', icon: '🥬', location: '전통작물 구역', desc: '김치의 대표 재료입니다.', unlock: [{ on: 'harvest', crop: 'CROP_CABBAGE' }] },
  COL_PERILLA: { category: 'crop', name: '들깨', icon: '🌿', location: '전통작물 구역', desc: '깻잎과 들기름을 얻습니다.', unlock: [{ on: 'harvest', crop: 'CROP_PERILLA' }] },
  COL_CORN: { category: 'crop', name: '옥수수', icon: '🌽', location: '전통작물 구역', desc: '여름 작물로 키가 크게 자랍니다.', unlock: [{ on: 'harvest', crop: 'CROP_CORN' }] },
  COL_RADISH: { category: 'crop', name: '무', icon: '🥕', location: '전통작물 구역', desc: '깍두기·동치미의 재료입니다.', unlock: [{ on: 'harvest', crop: 'CROP_RADISH' }] },
  COL_MINT: { category: 'plant', name: '박하', icon: '🌿', location: '허브 구역', desc: '시원한 향의 허브입니다.', unlock: [{ on: 'harvest', crop: 'CROP_MINT' }] },
  COL_LAVENDER: { category: 'plant', name: '라벤더', icon: '🪻', location: '허브 구역', desc: '보라색 꽃의 허브입니다.', unlock: [{ on: 'harvest', crop: 'CROP_LAVENDER' }] },
  COL_ROSEMARY: { category: 'plant', name: '로즈마리', icon: '🌿', location: '허브 구역', desc: '상록성 허브입니다.', unlock: [{ on: 'harvest', crop: 'CROP_ROSEMARY' }] },
  COL_LEMONBALM: { category: 'plant', name: '레몬밤', icon: '🍃', location: '허브 구역', desc: '레몬 향이 나는 허브입니다.', unlock: [{ on: 'harvest', crop: 'CROP_LEMONBALM' }] },
  COL_PINE: { category: 'plant', name: '소나무', icon: '🌲', location: '체험관 곳곳', desc: '사철 푸른 우리나라의 대표 나무입니다.', unlock: [{ on: 'interact', id: 'PLANT_PINE' }, { on: 'visit', zone: 'ZONE_HALL' }] },
  COL_DOENJANG: { category: 'fermented', name: '된장', icon: '🟤', location: '발효식품 구역 · 장독대', desc: '메주를 소금물에 담가 숙성시킨 장입니다.', unlock: [{ on: 'item', item: 'ITEM_DOENJANG' }, { on: 'interact', id: 'EXH_DOENJANG' }] },
  COL_GANJANG: { category: 'fermented', name: '간장', icon: '🫙', location: '발효식품 구역', desc: '메주를 담근 장물을 걸러 숙성시킨 장입니다.', unlock: [{ on: 'item', item: 'ITEM_GANJANG' }, { on: 'interact', id: 'EXH_GANJANG' }] },
  COL_GOCHUJANG: { category: 'fermented', name: '고추장', icon: '🔴', location: '발효식품 구역', desc: '고춧가루·찹쌀·메줏가루로 만든 장입니다.', unlock: [{ on: 'item', item: 'ITEM_GOCHUJANG' }, { on: 'interact', id: 'EXH_GOCHUJANG' }] },
  COL_KIMCHI: { category: 'fermented', name: '김치', icon: '🥬', location: '발효식품 구역', desc: '채소를 절여 양념해 발효시킨 음식입니다.', unlock: [{ on: 'item', item: 'ITEM_KIMCHI' }, { on: 'interact', id: 'EXH_KIMCHI' }] },
  COL_VINEGAR: { category: 'fermented', name: '전통 식초', icon: '🍶', location: '발효식품 구역', desc: '곡물을 발효시켜 만든 식초입니다.', unlock: [{ on: 'item', item: 'ITEM_VINEGAR' }, { on: 'interact', id: 'EXH_VINEGAR' }] },
  COL_JAR_DOK: { category: 'jar', name: '독', icon: '🏺', location: '발효주 저장고', desc: '장이나 김치를 담그는 큰 옹기 그릇입니다.', unlock: [{ on: 'interact', id: 'JARDISP_DOK' }] },
  COL_JAR_JUNGDURI: { category: 'jar', name: '중두리', icon: '🏺', location: '발효주 저장고', desc: '독보다 조금 작고 배가 부른 옹기입니다.', unlock: [{ on: 'interact', id: 'JARDISP_JUNGDURI' }] },
  COL_JAR_HANGARI: { category: 'jar', name: '항아리', icon: '🫙', location: '발효주 저장고', desc: '아가리가 좁고 배가 부른 옹기입니다.', unlock: [{ on: 'interact', id: 'JARDISP_HANGARI' }] },
  COL_JAR_DANJI: { category: 'jar', name: '단지', icon: '🫙', location: '발효주 저장고', desc: '작고 목이 짧은 옹기 그릇입니다.', unlock: [{ on: 'interact', id: 'JARDISP_DANJI' }] },
  COL_JAR_MINE: { category: 'jar', name: '나의 장독', icon: '✨', location: '장독대', desc: '계정마다 하나씩 배정되는 나만의 장독입니다.', unlock: [{ on: 'interact', id: 'J1' }] },
  COL_TOOL_JIGE: { category: 'tool', name: '지게', icon: '🪵', location: '전통도구 전시장', desc: '등에 지고 짐을 나르던 운반 도구입니다.', unlock: [{ on: 'interact', id: 'TOOL_JIGE' }] },
  COL_TOOL_MAETDOL: { category: 'tool', name: '맷돌', icon: '🪨', location: '전통도구 전시장', desc: '곡식을 가는 돌 도구입니다.', unlock: [{ on: 'interact', id: 'TOOL_MAETDOL' }] },
  COL_TOOL_JEOLGU: { category: 'tool', name: '절구', icon: '🥣', location: '전통도구 전시장', desc: '곡식을 찧거나 빻는 도구입니다.', unlock: [{ on: 'interact', id: 'TOOL_JEOLGU' }] },
  COL_TOOL_KI: { category: 'tool', name: '키', icon: '🧺', location: '전통도구 전시장', desc: '곡식의 껍질과 티를 까불러 고르는 도구입니다.', unlock: [{ on: 'interact', id: 'TOOL_KI' }] },
  COL_TOOL_HOMI: { category: 'tool', name: '호미', icon: '⛏️', location: '전통도구 전시장', desc: '김을 매고 흙을 고르는 작은 농기구입니다.', unlock: [{ on: 'interact', id: 'TOOL_HOMI' }, { on: 'item', item: 'ITEM_HOMI' }] },
  COL_TOOL_SIRU: { category: 'tool', name: '시루', icon: '🍲', location: '전통도구 전시장', desc: '떡이나 쌀을 찌는 데 쓰는 질그릇입니다.', unlock: [{ on: 'interact', id: 'TOOL_SIRU' }] },
  COL_NPC001: { category: 'npc', name: '발효마스터', icon: '🧑‍🍳', location: '중앙 광장', desc: '전통발효 교육을 담당합니다.', unlock: [{ on: 'talk', npc: 'NPC001' }] },
  COL_NPC002: { category: 'npc', name: '산골농부', icon: '👨‍🌾', location: '전통작물 구역', desc: '작물 재배를 알려 줍니다.', unlock: [{ on: 'talk', npc: 'NPC002' }] },
  COL_NPC003: { category: 'npc', name: '전통사랑', icon: '👩', location: '체험교육 구역', desc: '지역문화와 체험 프로그램을 안내합니다.', unlock: [{ on: 'talk', npc: 'NPC003' }] },
  COL_NPC004: { category: 'npc', name: '장독지기', icon: '👴', location: '장독대 구역', desc: '장독대를 돌보는 관리인입니다.', unlock: [{ on: 'talk', npc: 'NPC004' }] },
  COL_NPC005: { category: 'npc', name: '안내원', icon: '🧑‍💼', location: '입구', desc: '입구 안내와 매점을 맡고 있습니다.', unlock: [{ on: 'talk', npc: 'NPC005' }] },
  COL_EDU_FERMENT: { category: 'edu', name: '전통발효란?', icon: '📖', location: '교육 콘텐츠', desc: '발효의 기본 개념을 배웠습니다.', unlock: [{ on: 'edu', edu: 'EDU_FERMENT' }] },
  COL_EDU_JANGDOK: { category: 'edu', name: '장독대와 옹기', icon: '📖', location: '교육 콘텐츠', desc: '장독대와 옹기에 대해 배웠습니다.', unlock: [{ on: 'edu', edu: 'EDU_JANGDOK' }] },
  COL_EDU_BEAN: { category: 'edu', name: '콩과 메주', icon: '📖', location: '교육 콘텐츠', desc: '콩과 메주에 대해 배웠습니다.', unlock: [{ on: 'edu', edu: 'EDU_BEAN' }] },
  COL_EDU_DOENJANG: { category: 'edu', name: '된장 이야기', icon: '📖', location: '교육 콘텐츠', desc: '된장에 대해 배웠습니다.', unlock: [{ on: 'edu', edu: 'EDU_DOENJANG' }] },
  COL_EDU_GANJANG: { category: 'edu', name: '간장 이야기', icon: '📖', location: '교육 콘텐츠', desc: '간장에 대해 배웠습니다.', unlock: [{ on: 'edu', edu: 'EDU_GANJANG' }] },
  COL_EDU_GOCHUJANG: { category: 'edu', name: '고추장 이야기', icon: '📖', location: '교육 콘텐츠', desc: '고추장에 대해 배웠습니다.', unlock: [{ on: 'edu', edu: 'EDU_GOCHUJANG' }] },
  COL_EDU_KIMCHI: { category: 'edu', name: '김치와 발효', icon: '📖', location: '교육 콘텐츠', desc: '김치 발효에 대해 배웠습니다.', unlock: [{ on: 'edu', edu: 'EDU_KIMCHI' }] },
  COL_EDU_FARMING: { category: 'edu', name: '전통농업과 절기', icon: '📖', location: '교육 콘텐츠', desc: '전통농업과 절기에 대해 배웠습니다.', unlock: [{ on: 'edu', edu: 'EDU_FARMING' }] },
  COL_EDU_TOOLS: { category: 'edu', name: '전통 농기구', icon: '📖', location: '교육 콘텐츠', desc: '전통 농기구에 대해 배웠습니다.', unlock: [{ on: 'edu', edu: 'EDU_TOOLS' }] },
};
for (const [id, c] of Object.entries(G.data.collection)) c.id = id;

// Education content ids (pages & quizzes are defined in 45-education-data.js)
G.data.educationIds = ['EDU_FERMENT', 'EDU_JANGDOK', 'EDU_BEAN', 'EDU_DOENJANG', 'EDU_GANJANG', 'EDU_GOCHUJANG', 'EDU_KIMCHI', 'EDU_FARMING', 'EDU_TOOLS'];

// ------------------------------------------------------------------ emotes & gestures
G.data.emotes = [
  { id: 'EMO_SMILE', name: '웃기', icon: '😊', anim: 'nod' },
  { id: 'EMO_HELLO', name: '인사', icon: '👋', anim: 'wave' },
  { id: 'EMO_CLAP', name: '박수', icon: '👏', anim: 'clap' },
  { id: 'EMO_THUMBS', name: '엄지척', icon: '👍', anim: 'thumbsup' },
  { id: 'EMO_WELCOME', name: '환영', icon: '🙌', anim: 'celebrate' },
  { id: 'EMO_LIKE', name: '좋아요', icon: '❤️', anim: 'heart' },
  { id: 'EMO_WOW', name: '놀람', icon: '😮', anim: 'surprise' },
  { id: 'EMO_LAUGH', name: '하하', icon: '😆', anim: 'nod' },
];
G.data.gestures = [
  { id: 'GES_WAVE', name: '손 흔들기', icon: '👋', anim: 'wave', duration: 2.4 },
  { id: 'GES_BOW', name: '절하기', icon: '🙇', anim: 'bow', duration: 2.2 },
  { id: 'GES_POINT', name: '가리키기', icon: '👉', anim: 'point', duration: 2.0 },
  { id: 'GES_PHOTO', name: '사진 포즈', icon: '✌️', anim: 'photo', duration: 4.0 },
  { id: 'GES_SIT', name: '앉기', icon: '🪑', anim: 'sit', loop: true },
  { id: 'GES_DANCE', name: '춤추기', icon: '💃', anim: 'dance', loop: true },
  { id: 'GES_CHEER', name: '응원하기', icon: '📣', anim: 'celebrate', duration: 2.4 },
  { id: 'GES_THINK', name: '생각하기', icon: '🤔', anim: 'think', duration: 3.0 },
];

// ------------------------------------------------------------------ weather & time
G.data.weather = {
  CLEAR: { name: '맑음', icon: 'sun', humidity: 55, tempMod: 0 },
  CLOUDY: { name: '흐림', icon: 'cloud', humidity: 66, tempMod: -2 },
  RAIN: { name: '비', icon: 'rain', humidity: 90, tempMod: -4 },
  FOG: { name: '안개', icon: 'fog', humidity: 85, tempMod: -3 },
  SNOW: { name: '눈', icon: 'snow', humidity: 72, tempMod: -18 },
};
G.data.dayPhases = [
  { id: 'MORNING', name: '아침', from: 5, to: 8 },
  { id: 'DAY', name: '낮', from: 8, to: 17 },
  { id: 'EVENING', name: '저녁', from: 17, to: 20 },
  { id: 'NIGHT', name: '밤', from: 20, to: 29 }, // wraps to 05:00
];
G.data.time = { dayLengthMinutes: 24, startHour: 10.5 };

// ------------------------------------------------------------------ loading tips (spec #72: 전통발효 상식)
G.data.tips = [
  ['상식', '장독은 햇볕이 잘 들고 바람이 잘 통하는 곳에 두는 것이 좋다고 전해집니다.'],
  ['상식', '옹기는 흙으로 빚어 구운 그릇으로, 미세한 숨구멍이 있어 “숨 쉬는 그릇”이라 불립니다.'],
  ['상식', '메주는 삶은 콩을 찧어 덩어리로 빚은 뒤 말리고 띄워서 만듭니다.'],
  ['상식', '된장과 간장은 메주를 소금물에 담가 숙성시킨 뒤 건더기와 장물을 나누어 만듭니다.'],
  ['상식', '김치는 채소를 소금에 절인 뒤 양념에 버무려 젖산 발효시키는 음식입니다.'],
  ['상식', '고추장은 고춧가루, 찹쌀(또는 엿기름), 메줏가루, 소금 등으로 만듭니다.'],
  ['상식', '발효는 미생물이 식품 성분을 분해·변화시키는 과정입니다.'],
  ['팁', 'WASD로 이동하고 Shift를 누르면 달릴 수 있어요. 마우스를 끌면 시점이 돌아갑니다.'],
  ['팁', '금빛 표식은 지금 할 일을 알려 줘요. 가까이 가서 E 키를 누르세요.'],
  ['팁', 'J 키로 작업일지를, M 키로 전체 지도를 열 수 있어요.'],
  ['팁', '작물은 물이 부족하면 자라는 속도가 느려지고 건강이 떨어져요.'],
  ['팁', 'P 키를 누르면 사진 모드! 포토존에서 찍으면 퀘스트가 진행돼요.'],
  ['팁', '정선 만장대의 망원경을 들여다보면 체험관 구역을 하나씩 구경할 수 있어요.'],
  ['팁', '돌계단 길은 밧줄 난간을 따라 지그재그로 내려가요. 가고 싶은 곳을 누르면 길을 따라 알아서 걸어가요.'],
  ['팁', '날씨와 시간에 따라 장독의 발효 환경(온도·습도)이 달라져요.'],
  ['팁', '퀘스트 패널에서 “보상 받기”를 눌러야 보상이 지급돼요.'],
  ['알림', '체험관 속 발효·재배 수치는 교육용 가상 시뮬레이션입니다.'],
];

// ------------------------------------------------------------------ simulated visitors (local mode) & chat safety
G.data.visitors = {
  names: ['참가자1', '참가자2', '산들바람', '메주콩', '장독사랑', '콩콩이', '들깨향기', '초록농부', '항아리', '바람소리', '청사초롱', '솔향기'],
  lines: [
    '안녕하세요!', '멋진 공간이네요!', '장독대 진짜 예뻐요', '같이 퀘스트 해요!', '오늘 날씨가 좋네요!', '모두 반갑습니다~',
    '콩 수확했어요 ㅎㅎ', '된장 발효 언제 끝나지?', '정자에서 사진 찍었어요', '허브 향이 날 것 같아요', '교육관 퀴즈 재밌어요',
    '물 주는 거 잊지 마세요~', '메주 처음 만들어 봤어요', '저 처음 왔어요!', '장독이 이렇게 많다니', '계곡 소리 좋네요',
    '만장대에서 보니까 다 보여요!', '만장대 팔각정 멋져요',
  ],
  replies: {
    greet: ['안녕하세요! 반가워요 😊', '어서 오세요~', '반갑습니다!'],
    thanks: ['천만에요!', '별말씀을요 ㅎㅎ'],
    question: ['저도 궁금해요!', '발효마스터한테 물어보면 알려 줄 거예요', '퀘스트 패널을 확인해 보세요!'],
  },
};
G.data.badWords = ['시발', '씨발', 'ㅅㅂ', '병신', 'ㅂㅅ', '개새끼', '좆', '지랄', 'fuck', 'shit', 'bitch'];

// ------------------------------------------------------------------ server validation limits (exported to PHP)
G.data.serverLimits = {
  saveMaxBytes: 1500000,
  maxCoinGainPerSave: 60000,  // safety cap in addition to reward-table checks
  maxExpGainPerSave: 20000,
  harvestSpeedTolerance: 0.5, // harvest allowed after growthTime * tolerance seconds since planting (water bonus etc.)
};

// [allot-client] ------------------------------------------------------------ 분양 (CONTRACT §16.8)
// G.data.allot — words, colours, shapes and the local demo of the allotment (분양). Pure data + pure functions (no DOM, no
// THREE: tools/build.mjs and the tests evaluate this file in bare Node). WHERE a unit lies is never decided here: the master
// plan G.data.complex (33-complex-plan.js) lays every zone out; the panel (43-allot.js), the minimap and the 3D district use
// it. Prices never live here (only api/allot/plans.php tells them, and easy mode never asks).
G.data.allot = (function () {
  const KIND_ORDER = ['jar', 'plot', 'store'];
  const kinds = {
    jar: { id: 'jar', name: '항아리', zoneWord: '장독대', emoji: '🏺', kidName: '내 항아리', color: '#8a5a3b', ground: '#cdbfa8',
      steps: [{ k: 'dam', emoji: '🫙', label: '담그기', kid: '메주와 소금물을 항아리에 넣어요', at: 0 },
        { k: 'gareugi', emoji: '🥄', label: '가르기', kid: '40~60일쯤 지나 간장과 된장을 나눠요', at: 50 },
        { k: 'ik', emoji: '☀️', label: '익히기', kid: '햇볕과 바람에 천천히 익어요', at: 60 },
        { k: 'get', emoji: '🎁', label: '받는 날', kid: '다 익은 장을 받아 가요', at: -1 }] },
    plot: { id: 'plot', name: '밭', zoneWord: '텃밭', emoji: '🌱', kidName: '내 밭', color: '#6f8f3a', ground: '#b89a6e',
      steps: [{ k: 'sow', emoji: '🌱', label: '심기', kid: '씨앗과 모종을 심어요', at: 0 },
        { k: 'care', emoji: '💧', label: '가꾸기', kid: '물을 주고 풀을 뽑아요', at: 14 },
        { k: 'grow', emoji: '🌿', label: '자라기', kid: '쑥쑥 자라요', at: 45 },
        { k: 'get', emoji: '🧺', label: '거두기', kid: '다 자란 채소를 거둬요', at: -1 }] },
    store: { id: 'store', name: '창고', zoneWord: '창고', emoji: '📦', kidName: '내 창고', color: '#7a6a55', ground: '#bfb39e',
      steps: [{ k: 'keep', emoji: '📦', label: '맡기기', kid: '물건을 창고 칸에 넣어요', at: 0 },
        { k: 'hold', emoji: '🔒', label: '보관', kid: '창고 칸이 잘 지켜 줘요', at: 1 },
        { k: 'get', emoji: '🚪', label: '찾아가기', kid: '기간이 끝나면 찾아가요', at: -1 }] },
  };
  // map status characters of api/allot/map.php (+ 'm' = mine, drawn by the client). Okabe–Ito colours (safe for the
  // common colour-vision differences) AND a different shape each, so colour is never the only sign.
  const status = {
    o: { key: 'open', label: '빈 자리', kid: '비어 있어요', color: '#009E73', shape: 'fill', emoji: '🟢' },
    h: { key: 'held', label: '신청 중', kid: '누가 신청했어요', color: '#E69F00', shape: 'ring', emoji: '🟠' },
    l: { key: 'leased', label: '분양됨', kid: '주인이 있어요', color: '#7d6e60', shape: 'small', emoji: '🟤' },
    c: { key: 'closed', label: '쉬는 자리', kid: '지금은 쉬어요', color: '#b9b3aa', shape: 'cross', emoji: '⚪' },
    m: { key: 'mine', label: '내 자리', kid: '내 자리예요', color: '#0072B2', shape: 'star', emoji: '🔵' },
  };
  const contract = {
    pending: { label: '확인 기다리는 중', kid: '어른이 확인하고 있어요', emoji: '⏳', tone: 'wait' },
    active: { label: '분양 중', kid: '내 자리예요', emoji: '✅', tone: 'ok' },
    overdue: { label: '납부 확인이 필요해요', kid: '어른에게 알려 주세요', emoji: '🔔', tone: 'warn' },
    ended: { label: '기간이 끝났어요', kid: '끝났어요', emoji: '🏁', tone: 'off' },
    canceled: { label: '취소됐어요', kid: '취소했어요', emoji: '↩️', tone: 'off' },
  };
  const timeline = { applied: ['📝', '신청'], approved: ['✅', '확정'], paid: ['💳', '납부 확인'], due: ['📅', '다음 납부'], ends: ['🏁', '끝나는 날'], ended: ['🏁', '끝남'], canceled: ['↩️', '취소'] };
  const notices = { applied: '📝', approved: '✅', rejected: '🙅', canceled: '↩️', hold_expired: '⌛', paid: '💳', due: '📅', ending: '🏁', overdue: '🔔', ended: '🏁',
    renewed: '🔁', moved: '🚚', offer: '🎉', offer_expired: '⌛', cancel_requested: '✉️', info: '📢' };
  const care = { care: '🧑‍🌾', water: '💧', clean: '🧽', check: '🔎', weather: '🌦️', event: '🎪', photo: '📷', notice: '📢' };
  const periods = { once: '한 번', month: '한 달마다', year: '한 해마다' };
  // easy mode names a unit with one of these (no typing); every one is ≤ 12 characters like the server's nameplate rule
  const nameplates = [{ t: '우리 가족 장', e: '👨‍👩‍👧' }, { t: '할머니 손맛', e: '👵' }, { t: '새싹 농부', e: '🌱' }, { t: '햇살 가득', e: '☀️' },
    { t: '꼬마 발효왕', e: '👑' }, { t: '사랑 가득', e: '💛' }];

  // ------------------------------------------------------------------ the local-mode demo (체험용, read-only)
  // The places of the units come from the master plan G.data.complex (33-complex-plan.js: layout(zones), unitAt) — never
  // from here. The demo is the server's default seed preset (6 × 1,000 jars · 3 × 1,000 plots · 2 × 500 stores, the same
  // codes, names and order as G.data.complex.defaultZones()) with made-up states: a hash of the index, the same every
  // time, so screenshots and tests compare. Fill rates differ per zone so the plan looks lived in.
  const DEMO_ZONES = [];
  let sortN = 0;
  for (let n = 1; n <= 6; n++) DEMO_ZONES.push({ code: `J0${n}`, kind: 'jar', name: `장독대 ${n}구역`, cap: 1000, cols: 40, sort: ++sortN });
  for (let n = 1; n <= 3; n++) DEMO_ZONES.push({ code: `P0${n}`, kind: 'plot', name: `텃밭 ${n}구역`, cap: 1000, cols: 40, sort: ++sortN });
  for (let n = 1; n <= 2; n++) DEMO_ZONES.push({ code: `S0${n}`, kind: 'store', name: `창고 ${n}동`, cap: 500, cols: 25, sort: ++sortN });
  const DEMO_FILL = [0.72, 0.64, 0.55, 0.48, 0.4, 0.3, 0.6, 0.45, 0.35, 0.7, 0.5];
  /** deterministic pseudo-random 0…1 for (zone index, unit index) */
  function demoRand(zi, i) {
    let x = ((zi + 1) * 2654435761 + (i + 1) * 40503) >>> 0;
    x ^= x >>> 15; x = Math.imul(x, 2246822519) >>> 0; x ^= x >>> 13; x = Math.imul(x, 3266489917) >>> 0; x ^= x >>> 16;
    return (x % 100000) / 100000;
  }
  /** the demo answer in the shape of api/allot/map.php: { v, demo, zones: [{ code, kind, name, cap, cols, open, s, sort }] } */
  function demoMap() {
    const zones = DEMO_ZONES.map((z, zi) => {
      const fill = DEMO_FILL[zi] || 0.5;
      const ch = new Array(z.cap);
      for (let i = 0; i < z.cap; i++) {
        const r = demoRand(zi, i);
        ch[i] = r < fill ? 'l' : r < fill + 0.025 ? 'h' : r > 0.988 ? 'c' : 'o';
      }
      if (z.code === 'J01') ch[DEMO_UNIT_SEQ - 1] = 'l';      // the sample unit is taken (it is "mine")
      return { code: z.code, kind: z.kind, name: z.name, cap: z.cap, cols: z.cols, open: true, s: ch.join(''), sort: z.sort };
    });
    return { v: 1, demo: true, zones };
  }
  const DEMO_UNIT_SEQ = 12;
  const demoUnit = 'J01-0012';
  /** unit code helpers (the server's '%s-%04d') */
  const codeOf = (zone, seq) => `${String(zone || '').toUpperCase()}-${String(Math.max(0, Math.floor(seq) || 0)).padStart(4, '0')}`;
  function parseCode(code) {
    const m = /^([A-Z0-9]{1,12})-(\d{1,6})$/.exec(String(code || '').toUpperCase());
    return m ? { zone: m[1], seq: Number(m[2]) } : null;
  }

  return { KIND_ORDER, kinds, status, contract, timeline, notices, care, periods, nameplates, demoMap, demoUnit, DEMO_ZONES, codeOf, parseCode };
})();

// [content] ---------------------------------------------------------------- phase 9 (CONTRACT §17.8): more to ferment
// Pure data (also evaluated in Node by tools/build.mjs --data-out and tests/content-data.mjs). Facts are paraphrased from
// 한국민족문화대백과사전 (E…), 국립민속박물관 한국민속대백과사전 (F…) and 농촌진흥청 농사로 (N…); the source keys are kept in
// `src` of every recipe and the notes of the content lane. No health claims. Durations: `baseDuration` is the experience
// time in seconds (real time × the speed tier, as before); `real` says how long it takes in a real house.
(function () {
  const D = G.data;
  // ---- new ingredients (bought at the 매점 or made at the work table) and new finished foods
  const NEW_ITEMS = {
    ITEM_STRAW: { name: '볏짚', type: 'ingredient', icon: '🌾', price: 40, sell: 10, desc: '벼를 거두고 남은 줄기예요. 메주와 청국장을 띄우고 금줄을 꼴 때 써요.' },
    ITEM_BARLEY: { name: '보리', type: 'ingredient', icon: '🌾', price: 80, sell: 25, desc: '막장과 엿기름의 재료가 되는 곡식이에요.' },
    ITEM_MALT: { name: '엿기름', type: 'ingredient', icon: '🌱', price: 140, sell: 50, desc: '보리에 싹을 틔워 말린 가루예요. 녹말을 단맛으로 바꾸는 효소가 들어 있어요.' },
    ITEM_WHEAT: { name: '밀', type: 'ingredient', icon: '🌾', price: 80, sell: 25, desc: '거칠게 빻아 누룩을 디딜 때 쓰는 곡식이에요.' },
    ITEM_NURUK: { name: '누룩', type: 'ingredient', icon: '🟫', price: 220, sell: 80, desc: '밀을 반죽해 곰팡이와 효모를 키운 덩어리예요. 증편을 부풀리고 식초의 밑술을 만들 때 써요.' },
    ITEM_MEPSSAL: { name: '멥쌀', type: 'ingredient', icon: '🍚', price: 100, sell: 35, desc: '밥을 짓는 보통 쌀이에요. 식혜·조청·증편에 써요.' },
    ITEM_BROWN_RICE: { name: '현미', type: 'ingredient', icon: '🍙', price: 110, sell: 35, desc: '겉껍질만 벗긴 쌀이에요. 현미식초의 재료예요.' },
    ITEM_PERSIMMON: { name: '감', type: 'ingredient', icon: '🟠', price: 90, sell: 30, desc: '가을에 익는 주황빛 열매예요. 홍시로 감식초를 담가요.' },
    ITEM_GARLIC: { name: '마늘', type: 'ingredient', icon: '🧄', price: 60, sell: 20, desc: '김치 양념과 장아찌에 쓰는 매운 향 채소예요.' },
    ITEM_GINGER: { name: '생강', type: 'ingredient', icon: '🌿', price: 70, sell: 25, desc: '김치 양념에 조금 넣는 알싸한 뿌리채소예요.' },
    ITEM_SCALLION: { name: '쪽파', type: 'ingredient', icon: '🧅', price: 50, sell: 15, desc: '가늘고 연한 파예요. 파김치와 김치 소에 써요.' },
    ITEM_CUCUMBER: { name: '오이', type: 'ingredient', icon: '🥒', price: 50, sell: 15, desc: '여름 채소예요. 오이소박이와 오이지로 담가요.' },
    ITEM_GAT: { name: '갓', type: 'ingredient', icon: '🍃', price: 60, sell: 20, desc: '톡 쏘는 맛이 있는 잎채소예요. 여수 돌산 갓이 이름났어요.' },
    ITEM_YEOLMU: { name: '열무', type: 'ingredient', icon: '🌿', price: 50, sell: 15, desc: '여름에 자라는 어린 무예요. 잎과 줄기를 김치로 담가요.' },
    ITEM_CHONGGAKMU: { name: '총각무', type: 'ingredient', icon: '🥕', price: 60, sell: 20, desc: '손가락만 한 작은 무예요. 무청까지 통째로 김치를 담가요.' },
    ITEM_PEAR: { name: '배', type: 'ingredient', icon: '🍐', price: 90, sell: 30, desc: '시원하고 단 과일이에요. 백김치와 동치미 국물을 달게 해요.' },
    ITEM_SHRIMP: { name: '생새우', type: 'ingredient', icon: '🦐', price: 120, sell: 40, desc: '작은 새우예요. 소금에 절여 새우젓을 담가요.' },
    ITEM_ANCHOVY: { name: '생멸치', type: 'ingredient', icon: '🐟', price: 110, sell: 35, desc: '봄에 잡은 멸치예요. 소금에 켜켜이 절여 멸치젓을 담가요.' },
    ITEM_FLATFISH: { name: '가자미', type: 'ingredient', icon: '🐠', price: 180, sell: 60, desc: '납작한 바닷물고기예요. 함경도에서 식해로 담가 먹었어요.' },
    ITEM_MILLET: { name: '좁쌀', type: 'ingredient', icon: '🟡', price: 80, sell: 25, desc: '조의 낟알이에요. 지은 조밥을 식해에 넣어요.' },
    ITEM_TEALEAF: { name: '찻잎', type: 'ingredient', icon: '🍵', price: 150, sell: 50, desc: '차나무의 어린 잎이에요. 쪄서 빻아 떡차를 빚어요.' },
    ITEM_CHARCOAL: { name: '숯', type: 'ingredient', icon: '⚫', price: 40, sell: 10, desc: '나무를 구워 만든 검은 덩어리예요. 간장독에 띄워 잡냄새를 줄였어요.' },
    ITEM_HANJI: { name: '한지', type: 'ingredient', icon: '📜', price: 40, sell: 10, desc: '닥나무 껍질로 뜬 종이예요. 버선본을 오리고 금줄에 끼웠어요.' },
    // finished foods (experience results)
    ITEM_CHEONGGUKJANG: { name: '청국장', type: 'fermented', icon: '🫘', price: 0, sell: 380, desc: '삶은 콩을 볏짚과 함께 따뜻하게 띄운 장이에요. (체험 결과물)' },
    ITEM_MAKJANG: { name: '막장', type: 'fermented', icon: '🟫', price: 0, sell: 380, desc: '메줏가루에 보리를 섞어 빨리 익힌 강원도의 장이에요. (체험 결과물)' },
    ITEM_BAEKKIMCHI: { name: '백김치', type: 'fermented', icon: '🥬', price: 0, sell: 420, desc: '고춧가루 없이 하얗게 담근 시원한 김치예요. (체험 결과물)' },
    ITEM_KKAKDUGI: { name: '깍두기', type: 'fermented', icon: '🟥', price: 0, sell: 380, desc: '무를 네모나게 썰어 담근 김치예요. (체험 결과물)' },
    ITEM_DONGCHIMI: { name: '동치미', type: 'fermented', icon: '🥣', price: 0, sell: 400, desc: '통무를 소금물에 담가 겨울에 익히는 물김치예요. (체험 결과물)' },
    ITEM_CHONGGAK: { name: '총각김치', type: 'fermented', icon: '🥕', price: 0, sell: 400, desc: '총각무를 무청째 담근 김치예요. (체험 결과물)' },
    ITEM_OISOBAGI: { name: '오이소박이', type: 'fermented', icon: '🥒', price: 0, sell: 360, desc: '칼집 낸 오이에 소를 채운 여름 김치예요. (체험 결과물)' },
    ITEM_GATKIMCHI: { name: '갓김치', type: 'fermented', icon: '🍃', price: 0, sell: 400, desc: '갓으로 담근 톡 쏘는 김치예요. (체험 결과물)' },
    ITEM_PAKIMCHI: { name: '파김치', type: 'fermented', icon: '🧅', price: 0, sell: 360, desc: '쪽파를 젓국 양념에 버무린 김치예요. (체험 결과물)' },
    ITEM_YEOLMUKIMCHI: { name: '열무김치', type: 'fermented', icon: '🌿', price: 0, sell: 360, desc: '여름 열무로 담근 시원한 김치예요. (체험 결과물)' },
    ITEM_NABAKKIMCHI: { name: '나박김치', type: 'fermented', icon: '🍲', price: 0, sell: 360, desc: '무와 배추를 납작하게 썰어 담근 물김치예요. (체험 결과물)' },
    ITEM_SAEUJEOT: { name: '새우젓', type: 'fermented', icon: '🦐', price: 0, sell: 440, desc: '새우를 소금에 절여 삭힌 젓갈이에요. (체험 결과물)' },
    ITEM_MYEOLCHIJEOT: { name: '멸치젓', type: 'fermented', icon: '🐟', price: 0, sell: 420, desc: '멸치를 소금에 절여 오래 삭힌 젓갈이에요. (체험 결과물)' },
    ITEM_SIKHAE: { name: '가자미식해', type: 'fermented', icon: '🐠', price: 0, sell: 460, desc: '가자미에 조밥과 엿기름을 넣어 삭힌 함경도 음식이에요. (체험 결과물)' },
    ITEM_GAMSIKCHO: { name: '감식초', type: 'fermented', icon: '🍶', price: 0, sell: 460, desc: '홍시를 항아리에서 오래 익혀 만든 식초예요. (체험 결과물)' },
    ITEM_HYEONMISIKCHO: { name: '현미식초', type: 'fermented', icon: '🍶', price: 0, sell: 460, desc: '현미로 빚은 밑술을 초산균이 바꾼 식초예요. (체험 결과물)' },
    ITEM_JEUNGPYEON: { name: '증편', type: 'fermented', icon: '🍡', price: 0, sell: 340, desc: '쌀 반죽을 부풀려 찐 새콤한 여름 떡이에요. (체험 결과물)' },
    ITEM_SIKHYE: { name: '식혜', type: 'fermented', icon: '🥛', price: 0, sell: 320, desc: '엿기름물로 밥을 삭혀 밥알이 동동 뜨는 단 음료예요. (체험 결과물)' },
    ITEM_JOCHEONG: { name: '조청', type: 'fermented', icon: '🍯', price: 0, sell: 380, desc: '삭힌 쌀물을 오래 졸인 꿀 같은 엿이에요. (체험 결과물)' },
    ITEM_CORNYEOT: { name: '옥수수엿', type: 'fermented', icon: '🍬', price: 0, sell: 360, desc: '강원도 옥수수로 고은 엿이에요. (체험 결과물)' },
    ITEM_MUJANGAJJI: { name: '무장아찌', type: 'fermented', icon: '🫙', price: 0, sell: 340, desc: '말린 무를 된장에 박아 둔 장아찌예요. (체험 결과물)' },
    ITEM_KKAENNIPJANGAJJI: { name: '깻잎장아찌', type: 'fermented', icon: '🌿', price: 0, sell: 340, desc: '깻잎을 간장에 재운 장아찌예요. (체험 결과물)' },
    ITEM_MANEULJANGAJJI: { name: '마늘장아찌', type: 'fermented', icon: '🧄', price: 0, sell: 340, desc: '통마늘을 간장 식초물에 담근 장아찌예요. (체험 결과물)' },
    ITEM_GOCHUJANGAJJI: { name: '고추장아찌', type: 'fermented', icon: '🌶️', price: 0, sell: 340, desc: '풋고추를 간장물에 삭힌 장아찌예요. (체험 결과물)' },
    ITEM_TTEOKCHA: { name: '떡차', type: 'fermented', icon: '🍵', price: 0, sell: 440, desc: '찻잎을 쪄 빻아 엽전처럼 빚어 묵힌 차예요. (체험 결과물)' },
  };
  for (const [id, it] of Object.entries(NEW_ITEMS)) if (!D.items[id]) D.items[id] = it;
  const sells = D.shops?.SHOP_GENERAL?.sells;
  if (Array.isArray(sells)) for (const id of ['ITEM_STRAW', 'ITEM_HANJI', 'ITEM_CHARCOAL', 'ITEM_BARLEY', 'ITEM_MALT', 'ITEM_WHEAT', 'ITEM_NURUK', 'ITEM_MEPSSAL', 'ITEM_BROWN_RICE', 'ITEM_PERSIMMON', 'ITEM_GARLIC', 'ITEM_GINGER', 'ITEM_SCALLION', 'ITEM_CUCUMBER', 'ITEM_GAT', 'ITEM_YEOLMU', 'ITEM_CHONGGAKMU', 'ITEM_PEAR', 'ITEM_SHRIMP', 'ITEM_ANCHOVY', 'ITEM_FLATFISH', 'ITEM_MILLET', 'ITEM_TEALEAF']) if (!sells.includes(id)) sells.push(id);
  if (D.storage && Array.isArray(D.storage.itemIds)) for (const [id, it] of Object.entries(NEW_ITEMS)) if (it.type === 'fermented' && !D.storage.itemIds.includes(id)) D.storage.itemIds.push(id);
  Object.assign(D.crafts, {
    CRAFT_MALT: { id: 'CRAFT_MALT', name: '엿기름 기르기', icon: '🌱', in: { ITEM_BARLEY: 2 }, out: { ITEM_MALT: 1 }, exp: 30, desc: '보리를 물에 불려 싹을 틔운 뒤 말려 빻아요. 싹 속 효소가 나중에 녹말을 단맛으로 바꿔요. (실제로는 일주일쯤 걸려요)' },
    CRAFT_GOCHU_DRY: { id: 'CRAFT_GOCHU_DRY', name: '마른 고추 · 숯 꾸러미', icon: '🌶️', in: { ITEM_PEPPER: 1, ITEM_STRAW: 1 }, out: { ITEM_CHARCOAL: 1 }, exp: 15, desc: '간장독에 띄울 숯 꾸러미를 볏짚으로 묶어요. (체험용으로 단순하게 만든 과정이에요)' },
  });

  // ---- recipe groups (picker tabs) and the jar kinds a recipe likes
  D.recipeCats = {
    jang: { name: '장', icon: '🫘', color: '#8a5a3b' },
    kimchi: { name: '김치', icon: '🥬', color: '#c43c2c' },
    jeot: { name: '젓갈·식해', icon: '🦐', color: '#6f8fb0' },
    vinegar: { name: '식초', icon: '🍶', color: '#c9a44a' },
    sweet: { name: '식혜·조청', icon: '🍯', color: '#d99a3a' },
    tteok: { name: '떡·누룩', icon: '🍡', color: '#b48bff' },
    jangajji: { name: '장아찌', icon: '🫙', color: '#7a8a3a' },
    tea: { name: '발효차', icon: '🍵', color: '#5a8a5a' },
  };
  D.jarKinds = { dok: '독', jungduri: '중두리', hangari: '항아리', danji: '단지' };

  // ---- what every recipe teaches: steps [icon, short name, sentence], what the microbes do, care that matters
  // care ids (41-fermentation.js): sun vent clean salt charcoal geumjul taste nametag split deot share
  const X = {
    FER001: { cat: 'jang', jar: 'jungduri', real: '장 가르기 뒤 두세 달', season: '음력 정월~삼월에 담가요', care: ['salt', 'geumjul', 'deot'], deot: 'ITEM_DOENJANG', flavor: { salty: 3, umami: 3, nutty: 3 },
      steps: [['🫘', '메주 쑤기', '늦가을에 콩을 삶아 찧어 메주를 빚고 볏짚 위에서 띄워요.'], ['🧂', '장 담그기', '깨끗한 독에 메주를 넣고 소금물을 부어요.'], ['✂️', '장 가르기', '40~60일 뒤 메주 건더기를 건져 따로 담아요.'], ['🏺', '숙성', '건더기를 치대어 독에 꾹꾹 눌러 담고 햇볕 아래에서 익혀요.']],
      microbes: '메주에 자란 고초균과 곰팡이가 콩의 단백질을 잘게 나눠 구수한 맛 성분을 만들어요.', kid: '메주가 소금물 속에서 구수한 된장이 돼요!', src: ['E:E0016941', 'F:detail/4784'] },
    FER002: { cat: 'jang', jar: 'dok', real: '장 가르기 뒤 몇 달~몇 해', season: '음력 정월~삼월에 담가요', care: ['salt', 'charcoal', 'geumjul', 'deot'], deot: 'ITEM_GANJANG', flavor: { salty: 3, umami: 3, sweet: 1 },
      steps: [['🧂', '소금물 만들기', '물에 소금을 풀어 알맞은 짠맛을 맞춰요.'], ['🫘', '메주 넣기', '독에 메주를 넣고 소금물을 부은 뒤 숯과 붉은 고추를 띄워요.'], ['✂️', '장 뜨기', '메주를 건져 낸 국물만 따로 모아요.'], ['🔥', '달이기와 숙성', '국물을 한 번 끓여 식힌 뒤 독에서 오래 익혀요.']],
      microbes: '메주에서 녹아 나온 성분을 미생물과 효소가 천천히 바꾸어 짠맛 속에 감칠맛을 더해요.', kid: '메주를 담근 소금물이 까만 간장이 돼요!', src: ['E:E0076963', 'F:detail/4784'] },
    FER003: { cat: 'jang', jar: 'hangari', real: '한두 달', season: '찬 바람이 부는 늦가을~봄', care: ['salt', 'geumjul'], flavor: { spicy: 3, sweet: 2, salty: 2, umami: 2 },
      steps: [['🍚', '찹쌀 죽', '찹쌀을 익혀 엿기름물로 삭혀 달게 만들어요.'], ['🌶️', '버무리기', '식힌 죽에 메줏가루·고춧가루·소금을 넣고 고루 섞어요.'], ['🏺', '항아리에 담기', '항아리에 꼭꼭 눌러 담고 웃소금을 뿌려요.'], ['☀️', '햇볕 숙성', '맑은 날 뚜껑을 열어 햇볕을 쬐며 익혀요.']],
      microbes: '메줏가루 속 미생물과 엿기름의 효소가 찹쌀의 녹말을 단맛으로, 콩의 단백질을 감칠맛으로 바꿔요.', kid: '빨간 고추장은 맵고 달콤하게 익어요!', src: ['E:E0004012', 'F:고추장'] },
    FER004: { cat: 'kimchi', jar: 'dok', real: '서늘한 곳에서 2~3주', season: '입동 무렵 김장철', care: ['salt', 'taste', 'share'], flavor: { spicy: 2, sour: 2, salty: 2, umami: 2 },
      steps: [['🥬', '배추 절이기', '배추를 반으로 갈라 소금물에 하룻밤 절여요.'], ['🧄', '소 만들기', '고춧가루·마늘·생강·젓갈·무채로 김칫소를 만들어요.'], ['🖐️', '소 넣기', '배춧잎 사이사이에 소를 고루 넣어요.'], ['🏺', '독에 담기', '김칫독에 꼭꼭 눌러 담고 서늘하게 익혀요.']],
      microbes: '젖산균이 배추의 당을 젖산으로 바꿔 새콤한 맛이 나고, 다른 균은 잘 자라지 못하게 돼요.', kid: '젖산균이 배추를 새콤한 김치로 바꿔요!', src: ['E:E0047786', 'F:detail/7405'] },
    FER005: { cat: 'vinegar', jar: 'hangari', real: '밑술 뒤 한두 달', season: '따뜻한 철', care: ['vent', 'taste'], flavor: { sour: 3, sweet: 1 },
      steps: [['🍚', '밑술 빚기', '쌀과 누룩으로 밑술을 먼저 빚어요.'], ['🏺', '항아리에 옮기기', '밑술을 넓은 항아리에 옮기고 천으로 덮어 바람이 통하게 해요.'], ['🦠', '초산 발효', '초산균이 술 속 알코올을 초산으로 바꿔요.'], ['🫙', '거르고 숙성', '새콤해지면 걸러서 다시 항아리에서 익혀요.']],
      microbes: '초산균은 공기를 좋아해요. 밑술의 알코올을 초산으로 바꾸어 새콤한 식초를 만들어요.', kid: '초산균이 공기를 마시며 새콤한 식초를 만들어요!', src: ['F:detail/7823', 'N:rdaInter 34315'] },
    FER006: { name: '간장·된장 담그기', cat: 'jang', jar: 'dok', resultItem: 'ITEM_GANJANG', resultQty: 2, ingredients: { ITEM_MEJU: 2, ITEM_SALT: 2 }, baseDuration: 480, idealTemp: [12, 26], idealHumidity: [50, 75], baseQuality: 62, exp: 300, coin: 420, edu: 'EDU_GANJANG', color: '#3a2414', icon: '🏺',
      desc: '메주를 소금물에 담그고, 때가 되면 장 가르기로 간장과 된장을 나누는 진짜 순서의 체험이에요.',
      real: '담근 뒤 40~60일에 장 가르기, 그 뒤 몇 달', season: '음력 정월~삼월', split: { at: 45, into: 'FER007' }, care: ['salt', 'charcoal', 'geumjul', 'split', 'deot'], deot: 'ITEM_GANJANG', flavor: { salty: 3, umami: 3 },
      steps: [['🫘', '메주 고르기', '잘 띄운 메주를 솔로 깨끗이 털어요.'], ['🧂', '소금물 붓기', '독에 메주를 넣고 알맞게 짠 소금물을 부어요.'], ['⚫', '숯·고추 띄우기', '숯과 마른 붉은 고추를 띄우고 금줄을 둘러요.'], ['✂️', '장 가르기', '40~60일 뒤 건더기는 된장독으로, 국물은 간장독에 남겨요.'], ['🏺', '따로 익히기', '간장과 된장을 각각 햇볕 아래에서 익혀요.']],
      microbes: '처음 40~60일 동안 메주의 성분이 소금물에 우러나요. 그 뒤 간장과 된장이 각자 따로 깊은 맛을 내요.', kid: '메주 하나로 간장과 된장 두 가지를 만들어요!', src: ['E:E0076963', 'F:detail/4784', 'UNESCO:19.COM 7.B.3'] },
    FER007: { name: '가른 된장 익히기', cat: 'jang', jar: 'jungduri', resultItem: 'ITEM_DOENJANG', resultQty: 2, ingredients: {}, baseDuration: 240, idealTemp: [15, 28], idealHumidity: [50, 75], baseQuality: 60, exp: 180, coin: 250, edu: 'EDU_DOENJANG', color: '#6b4a2b', icon: '🟤',
      desc: '장 가르기로 건진 메주 건더기를 치대어 된장으로 익혀요.', startable: false, splitOf: 'FER006',
      real: '두세 달', season: '장 가르기 뒤', care: ['salt', 'geumjul', 'deot'], deot: 'ITEM_DOENJANG', flavor: { salty: 3, umami: 3, nutty: 3 },
      steps: [['✂️', '건더기 건지기', '장 가르기 때 메주 건더기를 건져요.'], ['🖐️', '치대기', '건더기를 고루 으깨어 치대요.'], ['🏺', '눌러 담기', '중두리에 꾹꾹 눌러 담고 웃소금을 뿌려요.'], ['☀️', '익히기', '햇볕과 바람 속에서 두세 달 익혀요.']],
      microbes: '메주에 살던 미생물이 남은 콩 성분을 천천히 바꾸어 구수한 된장 맛을 만들어요.', kid: '건더기를 꾹꾹 눌러 담으면 된장이 돼요!', src: ['F:detail/4784', 'E:E0016941'] },
    FER008: { name: '청국장 띄우기', cat: 'jang', jar: 'danji', resultItem: 'ITEM_CHEONGGUKJANG', resultQty: 2, ingredients: { ITEM_BEAN: 3, ITEM_STRAW: 1 }, baseDuration: 150, idealTemp: [38, 45], idealHumidity: [70, 90], baseQuality: 60, exp: 170, coin: 240, edu: 'EDU_R_CHEONGGUKJANG', color: '#9a7a4a', icon: '🫘',
      desc: '푹 삶은 콩을 볏짚과 함께 따뜻한 아랫목에 두어 2~3일 만에 띄워요.', heat: { temp: 40, label: '따뜻한 아랫목' },
      real: '2~3일', season: '추운 철', care: ['vent', 'taste'], flavor: { umami: 3, nutty: 3, salty: 1 },
      steps: [['💧', '콩 불리기', '콩을 하룻밤 물에 불려요.'], ['🔥', '푹 삶기', '콩이 손으로 으깨질 만큼 푹 삶아요.'], ['🌾', '볏짚과 함께', '삶은 콩을 볏짚을 깐 그릇에 담아 덮어요.'], ['🛏️', '아랫목에서', '따뜻한 아랫목에 2~3일 두면 끈끈한 실이 생겨요.']],
      microbes: '볏짚에 사는 고초균이 따뜻한 콩으로 옮겨 가 빠르게 늘어나요. 그때 생기는 끈끈한 실이 청국장의 표시예요.', kid: '볏짚 속 고초균이 콩에서 끈끈한 실을 만들어요!', src: ['F:detail/8082', 'N:vod 240'] },
    FER009: { name: '막장 담그기', cat: 'jang', jar: 'hangari', resultItem: 'ITEM_MAKJANG', resultQty: 2, ingredients: { ITEM_MEJU: 1, ITEM_BARLEY: 2, ITEM_SALT: 1 }, baseDuration: 300, idealTemp: [15, 28], idealHumidity: [50, 75], baseQuality: 60, exp: 230, coin: 330, edu: 'EDU_R_MAKJANG', color: '#7a5532', icon: '🟫',
      desc: '메주를 가루로 빻아 보리밥과 소금물로 버무린, 빨리 먹을 수 있는 강원도의 장이에요.',
      real: '한두 달', season: '봄', region: '강원도', care: ['salt', 'geumjul', 'taste'], flavor: { salty: 2, sweet: 2, umami: 3, nutty: 2 },
      steps: [['🫘', '메줏가루', '말린 메주를 곱게 빻아요.'], ['🌾', '보리밥', '보리를 푹 익혀 식혀요.'], ['🖐️', '버무리기', '메줏가루·보리밥·식힌 소금물을 고루 버무려요.'], ['🏺', '익히기', '항아리에 담아 한두 달 익혀요.']],
      microbes: '곡물을 섞어 미생물이 먹을 것이 많아요. 그래서 된장보다 빨리 익고 단맛이 더 나요.', kid: '보리를 넣은 막장은 된장보다 빨리 익어요!', src: ['F:detail/7554', 'E:E0016941'] },
    FER010: { name: '백김치', cat: 'kimchi', jar: 'jungduri', resultItem: 'ITEM_BAEKKIMCHI', resultQty: 2, ingredients: { ITEM_CABBAGE: 2, ITEM_PEAR: 1, ITEM_SALT: 1 }, baseDuration: 180, idealTemp: [2, 12], idealHumidity: [65, 90], baseQuality: 62, exp: 200, coin: 300, edu: 'EDU_R_BAEKKIMCHI', color: '#e8e2c8', icon: '🥬',
      desc: '고춧가루 없이 배·밤·마늘로 소를 넣고 국물을 넉넉히 부어 하얗게 담가요.',
      real: '서늘한 곳에서 1~2주', season: '김장철', care: ['salt', 'taste', 'share'], flavor: { sour: 2, sweet: 2, salty: 1 },
      steps: [['🥬', '절이기', '배추를 소금물에 절여 물기를 빼요.'], ['🍐', '하얀 소', '배·밤·마늘·생강·쪽파를 채 썰어 소를 만들어요.'], ['🖐️', '소 넣기', '배춧잎 사이에 소를 넣고 잎으로 감싸요.'], ['💧', '국물 붓기', '심심한 소금물을 넉넉히 붓고 서늘하게 익혀요.']],
      microbes: '젖산균이 국물을 새콤하게 만들어요. 맵지 않아 매운 것을 못 먹는 사람도 즐겨요.', kid: '빨갛지 않은 하얀 김치예요!', src: ['F:detail/7654', 'E:E0022013'] },
    FER011: { name: '깍두기', cat: 'kimchi', jar: 'hangari', resultItem: 'ITEM_KKAKDUGI', resultQty: 2, ingredients: { ITEM_RADISH: 2, ITEM_GOCHUGARU: 1, ITEM_SALT: 1 }, baseDuration: 160, idealTemp: [4, 15], idealHumidity: [60, 85], baseQuality: 62, exp: 190, coin: 280, edu: 'EDU_R_KKAKDUGI', color: '#d4553a', icon: '🟥',
      desc: '무를 주사위처럼 네모나게 썰어 절인 뒤 고춧가루와 젓갈로 버무려요.',
      real: '실온 하루, 서늘한 곳 며칠', season: '무가 맛있는 가을', care: ['taste', 'share'], flavor: { spicy: 2, sour: 2, sweet: 1, salty: 2 },
      steps: [['🔪', '깍둑 썰기', '무를 한입 크기 네모로 썰어요.'], ['🧂', '절이기', '소금에 잠깐 절여 물기를 빼요.'], ['🌶️', '물들이기', '고춧가루로 먼저 빨갛게 물들여요.'], ['🦐', '양념', '파·마늘·생강·새우젓을 넣고 버무려 담아요.']],
      microbes: '무에서 나온 단 즙을 젖산균이 먹고 새콤한 맛을 만들어요.', kid: '네모난 무가 아삭아삭 김치가 돼요!', src: ['E:E0011225', 'F:깍두기'] },
    FER012: { name: '동치미', cat: 'kimchi', jar: 'dok', resultItem: 'ITEM_DONGCHIMI', resultQty: 2, ingredients: { ITEM_RADISH: 3, ITEM_SALT: 1, ITEM_PEAR: 1 }, baseDuration: 300, idealTemp: [0, 10], idealHumidity: [65, 90], baseQuality: 60, exp: 230, coin: 330, edu: 'EDU_R_DONGCHIMI', color: '#eef0e4', icon: '🥣',
      desc: '작은 통무를 소금에 굴려 독에 넣고, 배·생강·쪽파와 함께 소금물을 부어 겨울 동안 익혀요.',
      real: '서늘한 곳에서 2~3주', season: '초겨울', care: ['salt', 'taste', 'share'], flavor: { sour: 2, salty: 1, sweet: 1 },
      steps: [['🥕', '통무 고르기', '작고 단단한 무를 깨끗이 씻어요.'], ['🧂', '소금에 굴리기', '무를 소금에 굴려 하루 두어요.'], ['🏺', '독에 담기', '무와 배·생강·쪽파를 독에 넣어요.'], ['💧', '소금물 붓기', '심심한 소금물을 붓고 서늘한 곳에서 익혀요.']],
      microbes: '젖산균이 신맛을 만들고, 그때 생기는 탄산가스가 국물을 톡 쏘게 해요. 따뜻하면 가스가 빠져 덜 시원해요.', kid: '톡 쏘는 시원한 겨울 물김치예요!', src: ['E:E0016831', 'F:detail/7519'] },
    FER013: { name: '총각김치', cat: 'kimchi', jar: 'jungduri', resultItem: 'ITEM_CHONGGAK', resultQty: 2, ingredients: { ITEM_CHONGGAKMU: 2, ITEM_GOCHUGARU: 1, ITEM_SALT: 1 }, baseDuration: 200, idealTemp: [3, 14], idealHumidity: [60, 85], baseQuality: 62, exp: 200, coin: 300, edu: 'EDU_R_CHONGGAK', color: '#c8482f', icon: '🥕',
      desc: '총각무를 무청째 절여 양념에 버무려요. 무와 무청이 함께 맛을 내요.',
      real: '서늘한 곳에서 1~2주', season: '늦가을', care: ['salt', 'taste', 'share'], flavor: { spicy: 2, sour: 2, salty: 2 },
      steps: [['🥕', '다듬기', '총각무의 잔뿌리를 떼고 무청째 씻어요.'], ['🧂', '절이기', '소금에 절여 숨을 죽여요.'], ['🌶️', '버무리기', '고춧가루·마늘·젓갈 양념에 버무려요.'], ['🏺', '익히기', '두세 개씩 묶어 독에 담아 익혀요.']],
      microbes: '젖산균이 무 속 당을 먹고 새콤한 맛을 만들어요. 무청이 있어서 맛이 더 깊어요.', kid: '총각머리를 닮은 무로 담가요!', src: ['F:총각김치', 'F:김장'] },
    FER014: { name: '오이소박이', cat: 'kimchi', jar: 'hangari', resultItem: 'ITEM_OISOBAGI', resultQty: 2, ingredients: { ITEM_CUCUMBER: 3, ITEM_GOCHUGARU: 1, ITEM_SCALLION: 1 }, baseDuration: 140, idealTemp: [8, 18], idealHumidity: [60, 85], baseQuality: 62, exp: 170, coin: 250, edu: 'EDU_R_SOBAGI', color: '#5f9e3a', icon: '🥒',
      desc: '절인 오이에 칼집을 서너 개 내고 파·마늘·고춧가루로 만든 소를 채워요.',
      real: '실온 하루, 서늘한 곳 며칠', season: '여름', care: ['taste', 'share'], flavor: { spicy: 2, sour: 1, salty: 1 },
      steps: [['🥒', '절이기', '오이를 소금물에 절여요.'], ['🔪', '칼집', '오이에 십자 칼집을 내요.'], ['🧅', '소 만들기', '쪽파·마늘·고춧가루로 소를 버무려요.'], ['🖐️', '채우기', '칼집 사이에 소를 꼭꼭 채워 담아요.']],
      microbes: '여름에는 빨리 익어요. 젖산균이 오이를 새콤하게 하니 시원한 곳에 두어요.', kid: '오이 속에 양념을 쏙쏙 넣어요!', src: ['E:E0038476', 'F:detail/7767'] },
    FER015: { name: '갓김치', cat: 'kimchi', jar: 'hangari', resultItem: 'ITEM_GATKIMCHI', resultQty: 2, ingredients: { ITEM_GAT: 3, ITEM_GOCHUGARU: 1, ITEM_SALT: 1 }, baseDuration: 220, idealTemp: [3, 14], idealHumidity: [60, 85], baseQuality: 62, exp: 210, coin: 310, edu: 'EDU_R_GATKIMCHI', color: '#7a3a52', icon: '🍃',
      desc: '톡 쏘는 갓을 절여 젓갈 양념에 버무려요. 여수 돌산의 갓김치가 이름났어요.',
      real: '서늘한 곳에서 2~3주', season: '늦가을', region: '전라남도 여수', care: ['salt', 'taste', 'share'], flavor: { spicy: 3, sour: 1, salty: 2, umami: 2 },
      steps: [['🍃', '갓 다듬기', '누런 잎을 떼고 깨끗이 씻어요.'], ['🧂', '절이기', '소금에 절여 숨을 죽여요.'], ['🌶️', '양념', '고춧가루·젓갈·마늘·찹쌀풀로 양념을 만들어요.'], ['🏺', '익히기', '버무려 독에 담고 푹 익혀요.']],
      microbes: '갓의 톡 쏘는 향은 익으면서 부드러워지고 젖산균이 새콤한 맛을 더해요.', kid: '코끝이 찡한 갓으로 담가요!', src: ['E:E0080025'] },
    FER016: { name: '파김치', cat: 'kimchi', jar: 'danji', resultItem: 'ITEM_PAKIMCHI', resultQty: 2, ingredients: { ITEM_SCALLION: 3, ITEM_GOCHUGARU: 1 }, baseDuration: 150, idealTemp: [4, 15], idealHumidity: [60, 85], baseQuality: 62, exp: 170, coin: 250, edu: 'EDU_R_PAKIMCHI', color: '#5a7a2a', icon: '🧅',
      desc: '쪽파를 젓국에 절였다가 고춧가루와 마늘·생강으로 버무려요.',
      real: '서늘한 곳에서 며칠~1주', season: '봄·가을', care: ['taste', 'share'], flavor: { spicy: 2, salty: 2, umami: 2 },
      steps: [['🧅', '쪽파 다듬기', '뿌리를 자르고 깨끗이 씻어요.'], ['🐟', '젓국에 절이기', '젓국을 뿌려 살짝 절여요.'], ['🌶️', '버무리기', '고춧가루·마늘·생강을 넣고 버무려요.'], ['🌀', '돌돌 감기', '몇 가닥씩 돌돌 말아 담아요.']],
      microbes: '젓국 속 짠맛이 파를 지켜 주고, 젖산균이 천천히 맛을 들여요.', kid: '쪽파를 돌돌 말아 담가요!', src: ['E:E0059544'] },
    FER017: { name: '열무김치', cat: 'kimchi', jar: 'hangari', resultItem: 'ITEM_YEOLMUKIMCHI', resultQty: 2, ingredients: { ITEM_YEOLMU: 3, ITEM_SALT: 1 }, baseDuration: 140, idealTemp: [6, 16], idealHumidity: [65, 90], baseQuality: 62, exp: 160, coin: 240, edu: 'EDU_R_YEOLMU', color: '#6aa443', icon: '🌿',
      desc: '여름 열무를 살살 절여 밀가루 풀국과 함께 담가요. 세게 주무르면 풋내가 나요.',
      real: '실온 하루, 서늘한 곳 며칠', season: '여름', region: '강원도는 감자를 넣기도 해요', care: ['taste', 'share'], flavor: { sour: 2, salty: 1, spicy: 1 },
      steps: [['🌿', '다듬기', '열무를 먹기 좋게 자르고 씻어요.'], ['🧂', '살살 절이기', '살살 뒤집으며 절여요.'], ['🥣', '풀국', '밀가루나 감자로 풀국을 쑤어 식혀요.'], ['💧', '담그기', '양념과 풀국을 붓고 시원하게 익혀요.']],
      microbes: '풀국의 녹말은 젖산균의 먹이가 돼서 김치가 고르게 익어요.', kid: '여름에 먹는 시원한 열무김치예요!', src: ['F:김장', 'F:무청김치'] },
    FER018: { name: '나박김치', cat: 'kimchi', jar: 'danji', resultItem: 'ITEM_NABAKKIMCHI', resultQty: 2, ingredients: { ITEM_RADISH: 1, ITEM_CABBAGE: 1, ITEM_SALT: 1 }, baseDuration: 130, idealTemp: [6, 16], idealHumidity: [65, 90], baseQuality: 62, exp: 160, coin: 240, edu: 'EDU_R_NABAK', color: '#e48a7a', icon: '🍲',
      desc: '무와 배추를 납작납작 썰어 고춧가루 물을 연하게 들인 국물에 담가요.',
      real: '실온 하루~이틀', season: '봄·명절', care: ['taste', 'share'], flavor: { sour: 2, sweet: 1, salty: 1 },
      steps: [['🔪', '나박 썰기', '무와 배추를 얇고 네모나게 썰어요.'], ['🧂', '살짝 절이기', '소금에 잠깐 절여요.'], ['🌶️', '고운 물', '고춧가루를 베주머니에 넣어 물을 곱게 들여요.'], ['💧', '익히기', '국물을 붓고 하루쯤 두면 새콤해져요.']],
      microbes: '국물이 많아 젖산균이 고루 퍼지고 빨리 새콤해져요.', kid: '납작하게 썬 무로 담근 물김치예요!', src: ['F:detail/7592'] },
    FER019: { name: '새우젓', cat: 'jeot', jar: 'hangari', resultItem: 'ITEM_SAEUJEOT', resultQty: 2, ingredients: { ITEM_SHRIMP: 3, ITEM_SALT: 2 }, baseDuration: 420, idealTemp: [10, 20], idealHumidity: [50, 80], baseQuality: 60, exp: 280, coin: 400, edu: 'EDU_R_JEOTGAL', color: '#e8c9b8', icon: '🦐',
      desc: '새우와 소금을 10:3쯤으로 섞어 항아리에 담고 서늘한 곳에서 삭혀요.',
      real: '두세 달', season: '잡은 때에 따라 오젓(5월)·육젓(6월)·추젓(가을)', care: ['salt', 'taste'], flavor: { salty: 3, umami: 3 },
      steps: [['🦐', '새우 씻기', '갓 잡은 새우를 바닷물에 헹궈요.'], ['🧂', '소금 섞기', '새우와 소금을 고루 섞어요.'], ['🏺', '담기', '항아리에 담고 맨 위에 웃소금을 덮어요.'], ['🌡️', '삭히기', '서늘하고 그늘진 곳에서 두세 달 삭혀요.']],
      microbes: '소금이 상하게 하는 균을 막는 사이, 새우 속 효소가 살을 천천히 녹여 감칠맛을 만들어요.', kid: '작은 새우가 짭짤한 새우젓이 돼요!', src: ['F:새우젓', 'N:김장 큐레이션'] },
    FER020: { name: '멸치젓', cat: 'jeot', jar: 'dok', resultItem: 'ITEM_MYEOLCHIJEOT', resultQty: 2, ingredients: { ITEM_ANCHOVY: 3, ITEM_SALT: 2 }, baseDuration: 450, idealTemp: [10, 22], idealHumidity: [50, 80], baseQuality: 60, exp: 290, coin: 410, edu: 'EDU_R_JEOTGAL', color: '#8a7a6a', icon: '🐟',
      desc: '봄 멸치와 소금을 켜켜이 쌓아 독에 담고, 여름을 지나며 오래 삭혀요.',
      real: '석 달 이상', season: '봄에 담가요', region: '남해안', care: ['salt', 'taste'], flavor: { salty: 3, umami: 3 },
      steps: [['🐟', '멸치 고르기', '봄에 잡은 싱싱한 멸치를 골라요.'], ['🧂', '켜켜이', '멸치 한 켜, 소금 한 켜씩 쌓아요.'], ['🪨', '눌러 두기', '맨 위에 웃소금을 덮고 눌러요.'], ['🏺', '오래 삭히기', '석 달 넘게 두면 맑은 젓국이 생겨요.']],
      microbes: '높은 소금 속에서도 생선 속 효소가 단백질을 나누어 깊은 감칠맛을 만들어요. 김치 양념에 많이 써요.', kid: '멸치와 소금을 차곡차곡 쌓아요!', src: ['F:새우젓', 'N:김장 큐레이션'] },
    FER021: { name: '가자미식해', cat: 'jeot', jar: 'hangari', resultItem: 'ITEM_SIKHAE', resultQty: 2, ingredients: { ITEM_FLATFISH: 2, ITEM_MILLET: 1, ITEM_MALT: 1, ITEM_RADISH: 1 }, baseDuration: 240, idealTemp: [5, 15], idealHumidity: [55, 80], baseQuality: 60, exp: 240, coin: 360, edu: 'EDU_R_SIKHAE', color: '#c86a4a', icon: '🐠',
      desc: '꾸덕하게 말린 가자미에 조밥·엿기름·무채·고춧가루를 버무려 서늘하게 삭혀요. 함경도의 음식이에요.',
      real: '서늘한 곳에서 1~2주', season: '겨울', region: '함경도', care: ['salt', 'taste'], flavor: { sour: 2, sweet: 1, salty: 2, spicy: 2 },
      steps: [['🐠', '절이고 말리기', '가자미를 소금에 절여 꾸덕하게 말려요.'], ['🟡', '조밥', '좁쌀로 고슬고슬 조밥을 지어요.'], ['🌱', '버무리기', '조밥·엿기름·무채·고춧가루와 함께 버무려요.'], ['🏺', '삭히기', '항아리에 담아 서늘하게 삭혀요.']],
      microbes: '엿기름이 조밥을 달게 하고, 젖산균이 그 단맛을 새콤한 맛으로 바꿔 생선을 부드럽게 삭혀요.', kid: '생선과 조밥을 함께 삭혀요!', src: ['N:area 91927', 'E:E0062997'] },
    FER022: { name: '감식초', cat: 'vinegar', jar: 'hangari', resultItem: 'ITEM_GAMSIKCHO', resultQty: 1, ingredients: { ITEM_PERSIMMON: 4 }, baseDuration: 480, idealTemp: [20, 30], idealHumidity: [50, 75], baseQuality: 58, exp: 300, coin: 440, edu: 'EDU_R_VINEGAR', color: '#e0802a', icon: '🍶',
      desc: '물러진 홍시를 항아리에 넣고 천으로 덮어 두면 단맛이 먼저 술맛이 되고, 다시 새콤한 식초가 돼요.',
      real: '여러 달', season: '가을에 담가요', care: ['vent', 'taste'], flavor: { sour: 3, sweet: 1 },
      steps: [['🟠', '홍시', '잘 익어 물러진 감을 씻어 꼭지를 떼요.'], ['🏺', '항아리에', '항아리에 담고 천으로 덮어 바람만 통하게 해요.'], ['🍃', '효모 차례', '효모가 감의 단맛을 알코올로 바꿔요.'], ['🦠', '초산균 차례', '초산균이 알코올을 초산으로 바꿔 새콤해져요.']],
      microbes: '두 번의 발효가 차례로 일어나요. 먼저 효모, 그다음 공기를 좋아하는 초산균이에요.', kid: '말랑한 홍시가 새콤한 식초가 돼요!', src: ['N:rdaInter 34315', 'F:detail/7823'] },
    FER023: { name: '현미식초', cat: 'vinegar', jar: 'hangari', resultItem: 'ITEM_HYEONMISIKCHO', resultQty: 1, ingredients: { ITEM_BROWN_RICE: 2, ITEM_NURUK: 1 }, baseDuration: 420, idealTemp: [25, 30], idealHumidity: [50, 75], baseQuality: 58, exp: 290, coin: 430, edu: 'EDU_R_VINEGAR', color: '#b8903a', icon: '🍶',
      desc: '현미밥과 누룩으로 밑술을 빚은 뒤, 넓은 항아리에서 25~30℃로 한 달 반쯤 초산 발효를 해요.',
      real: '밑술 뒤 45일쯤', season: '따뜻한 철', care: ['vent', 'taste'], flavor: { sour: 3, nutty: 1 },
      steps: [['🍙', '현미밥', '현미를 불려 고슬하게 쪄요.'], ['🟫', '밑술', '누룩과 물을 섞어 밑술을 빚어요.'], ['🌬️', '초산 발효', '25~30℃에서 바람이 통하게 두어요.'], ['🫙', '거르기', '걸러서 다시 항아리에서 숙성해요.']],
      microbes: '초산균은 공기가 있어야 일해요. 그래서 식초 항아리는 꼭 막지 않고 천으로 덮어요.', kid: '현미가 새콤한 식초로 변신해요!', src: ['N:rdaInter 34315'] },
    FER024: { name: '누룩 디디기', cat: 'tteok', jar: 'danji', resultItem: 'ITEM_NURUK', resultQty: 2, ingredients: { ITEM_WHEAT: 3, ITEM_STRAW: 1 }, baseDuration: 300, idealTemp: [25, 35], idealHumidity: [70, 90], baseQuality: 60, exp: 220, coin: 300, edu: 'EDU_R_NURUK', color: '#c8a86a', icon: '🟫',
      desc: '거칠게 빻은 밀을 물에 반죽해 둥근 틀에 넣고 발로 꼭꼭 디딘 뒤, 볏짚에 싸서 따뜻하게 띄워요.',
      real: '2~3주', season: '여름', care: ['vent', 'taste'], flavor: { nutty: 2, sweet: 1 },
      steps: [['🌾', '밀 빻기', '밀을 거칠게 빻아요.'], ['💧', '반죽', '물을 조금씩 넣어 손으로 쥐면 뭉칠 만큼 반죽해요.'], ['🦶', '디디기', '둥근 틀에 넣고 발로 단단히 밟아요.'], ['🌾', '띄우기', '볏짚에 싸서 따뜻하고 축축한 곳에서 띄워요.']],
      microbes: '공기 속과 볏짚의 곰팡이·효모가 누룩에 자리 잡아요. 곰팡이는 녹말을 단맛으로 바꾸는 효소를 만들어요.', kid: '밀 반죽을 발로 꾹꾹 밟아 띄워요!', src: ['F:누룩', 'F:detail/7806'] },
    FER025: { name: '증편', cat: 'tteok', jar: 'danji', resultItem: 'ITEM_JEUNGPYEON', resultQty: 2, ingredients: { ITEM_MEPSSAL: 2, ITEM_NURUK: 1 }, baseDuration: 120, idealTemp: [28, 38], idealHumidity: [60, 85], baseQuality: 62, exp: 160, coin: 230, edu: 'EDU_R_JEUNGPYEON', color: '#f2e6cc', icon: '🍡',
      desc: '멥쌀가루를 술밑(누룩으로 빚은 술)으로 반죽해 따뜻하게 두어 부풀린 뒤 쪄 내는 여름 떡이에요.', heat: { temp: 33, label: '따뜻한 부뚜막 곁' },
      real: '반나절~하루 부풀리기', season: '여름', care: ['vent', 'taste'], flavor: { sour: 1, sweet: 2 },
      steps: [['🍚', '쌀가루', '멥쌀을 불려 곱게 빻아요.'], ['🟫', '반죽', '술밑과 따뜻한 물로 묽게 반죽해요.'], ['🫧', '부풀리기', '따뜻한 곳에 두면 효모가 거품을 만들어 부풀어요.'], ['♨️', '찌기', '틀에 붓고 고명을 얹어 쪄요.']],
      microbes: '효모가 내뿜는 가스가 반죽을 부풀리고 새콤한 맛을 더해요. 그래서 더운 여름에도 잘 쉬지 않았어요.', kid: '효모가 쌀 반죽을 폭신하게 부풀려요!', src: ['F:detail/8052', 'E:E0008438'] },
    FER026: { name: '식혜', cat: 'sweet', jar: 'hangari', resultItem: 'ITEM_SIKHYE', resultQty: 2, ingredients: { ITEM_MEPSSAL: 1, ITEM_MALT: 1 }, baseDuration: 120, idealTemp: [55, 65], idealHumidity: [40, 80], baseQuality: 62, exp: 150, coin: 220, edu: 'EDU_R_SIKHYE', color: '#f0e4c0', icon: '🥛', agent: 'enzyme',
      desc: '엿기름을 물에 주물러 거른 웃물을 밥에 붓고 따뜻하게 4~5시간 두면 밥알이 동동 떠요.', heat: { temp: 60, label: '따뜻한 솥' },
      real: '4~5시간', season: '명절·잔치', care: ['taste', 'share'], flavor: { sweet: 3 },
      steps: [['🌱', '엿기름물', '엿기름을 물에 주물러 체에 거르고 가라앉혀요.'], ['🍚', '밥 짓기', '고슬고슬하게 밥을 지어요.'], ['♨️', '삭히기', '밥에 웃물을 붓고 60~70℃쯤으로 4~5시간 두어요.'], ['🥛', '밥알 동동', '밥알이 뜨면 건져 헹구고 물을 한 번 끓여 식혀요.']],
      microbes: '식혜는 미생물이 아니라 엿기름 속 효소가 일해요. 효소가 밥의 녹말을 잘게 잘라 단맛을 만들어요. 이것을 ‘당화’라고 해요.', kid: '엿기름 속 효소가 밥을 달콤하게 해요!', src: ['E:E0032592', 'F:식혜', 'E:E0068243'] },
    FER027: { name: '조청 고기', cat: 'sweet', jar: 'danji', resultItem: 'ITEM_JOCHEONG', resultQty: 1, ingredients: { ITEM_MEPSSAL: 2, ITEM_MALT: 1 }, baseDuration: 160, idealTemp: [55, 65], idealHumidity: [30, 70], baseQuality: 60, exp: 180, coin: 260, edu: 'EDU_R_SIKHYE', color: '#a8641a', icon: '🍯', agent: 'enzyme',
      desc: '쌀을 엿기름으로 삭혀 짜낸 물을 약한 불에 오래 졸이면 꿀처럼 걸쭉한 조청이 돼요. 더 고면 엿이에요.', heat: { temp: 60, label: '따뜻한 솥' },
      real: '삭히기 반나절 + 졸이기 여러 시간', season: '겨울·설 앞', care: ['taste', 'share'], flavor: { sweet: 3 },
      steps: [['🍚', '삭히기', '찐 쌀에 엿기름물을 부어 따뜻하게 삭혀요.'], ['🧺', '짜기', '삼베 주머니에 넣어 단물을 짜내요.'], ['🔥', '졸이기', '약한 불에서 저으며 오래 졸여요.'], ['🍯', '조청과 엿', '걸쭉하면 조청, 더 고면 단단한 엿이 돼요.']],
      microbes: '효소가 만든 단물을 불로 졸이는 거예요. 오래 졸이면 색이 짙어지는데, 이것은 당이 열을 받아 생기는 변화예요.', kid: '단물을 오래오래 졸이면 조청이 돼요!', src: ['F:detail/7889', 'E:E0001283'] },
    FER028: { name: '옥수수엿', cat: 'sweet', jar: 'danji', resultItem: 'ITEM_CORNYEOT', resultQty: 1, ingredients: { ITEM_CORN: 3, ITEM_MALT: 1 }, baseDuration: 180, idealTemp: [55, 65], idealHumidity: [30, 70], baseQuality: 60, exp: 190, coin: 270, edu: 'EDU_R_SIKHYE', color: '#e0b030', icon: '🍬', agent: 'enzyme',
      desc: '강원도에서 많이 나는 옥수수를 엿기름으로 삭혀 졸여 엿을 고아요.', heat: { temp: 60, label: '따뜻한 솥' },
      real: '하루', season: '가을 옥수수 수확 뒤', region: '강원도', care: ['taste', 'share'], flavor: { sweet: 3, nutty: 1 },
      steps: [['🌽', '옥수수 삶기', '말린 옥수수 알을 푹 삶아요.'], ['🌱', '삭히기', '엿기름물을 부어 따뜻하게 삭혀요.'], ['🧺', '짜기', '단물을 걸러 짜내요.'], ['🔥', '고기', '오래 졸여 엿을 고아요.']],
      microbes: '엿기름 효소가 옥수수 녹말을 단맛으로 바꿔요. 밭에서 거둔 옥수수를 써 봐요.', kid: '밭에서 거둔 옥수수로 엿을 만들어요!', src: ['E:E0001283', 'E:E0022164'] },
    FER029: { name: '무장아찌', cat: 'jangajji', jar: 'danji', resultItem: 'ITEM_MUJANGAJJI', resultQty: 2, ingredients: { ITEM_RADISH: 2, ITEM_DOENJANG: 1 }, baseDuration: 260, idealTemp: [10, 25], idealHumidity: [40, 70], baseQuality: 60, exp: 210, coin: 300, edu: 'EDU_R_JANGAJJI', color: '#8a6a3a', icon: '🫙',
      desc: '무를 꾸덕하게 말려 된장 속에 박아 두면 장맛이 배어 오래 먹는 밑반찬이 돼요.',
      real: '몇 주~몇 달', season: '가을', care: ['salt', 'taste'], flavor: { salty: 3, umami: 2 },
      steps: [['🥕', '썰고 말리기', '무를 길게 썰어 꾸덕하게 말려요.'], ['🟤', '박기', '된장 속에 무를 쏙쏙 박아요.'], ['🏺', '기다리기', '장맛이 배어들 때까지 두어요.'], ['🍽️', '꺼내기', '꺼내어 장을 닦고 얇게 썰어 먹어요.']],
      microbes: '된장의 짠맛이 무의 물기를 빼고, 장 속 미생물과 효소의 맛이 천천히 스며들어요.', kid: '무를 된장 속에 쏙 숨겨 두어요!', src: ['E:E0048641', 'E:E0051716'] },
    FER030: { name: '깻잎장아찌', cat: 'jangajji', jar: 'danji', resultItem: 'ITEM_KKAENNIPJANGAJJI', resultQty: 2, ingredients: { ITEM_PERILLA: 3, ITEM_GANJANG: 1 }, baseDuration: 180, idealTemp: [10, 25], idealHumidity: [40, 70], baseQuality: 60, exp: 180, coin: 260, edu: 'EDU_R_JANGAJJI', color: '#3e6a2a', icon: '🌿',
      desc: '들깨 잎을 차곡차곡 쌓아 끓여 식힌 간장물을 붓고 무거운 돌로 눌러 두어요.',
      real: '1~2주', season: '여름 끝~가을', care: ['taste'], flavor: { salty: 2, umami: 2, nutty: 2 },
      steps: [['🌿', '깻잎 따기', '밭의 들깨에서 연한 잎을 따요.'], ['🧺', '켜켜이', '깨끗이 씻어 물기를 빼고 차곡차곡 쌓아요.'], ['🫙', '간장물', '간장물을 끓여 식혀 부어요.'], ['🪨', '누르기', '돌로 눌러 잎이 잠기게 해요.']],
      microbes: '간장의 짠맛이 잎을 지키고, 간장의 맛 성분이 잎에 배어들어요.', kid: '밭의 깻잎을 간장에 담가요!', src: ['E:E0048641'] },
    FER031: { name: '마늘장아찌', cat: 'jangajji', jar: 'danji', resultItem: 'ITEM_MANEULJANGAJJI', resultQty: 2, ingredients: { ITEM_GARLIC: 3, ITEM_GANJANG: 1 }, baseDuration: 300, idealTemp: [10, 22], idealHumidity: [40, 70], baseQuality: 60, exp: 220, coin: 310, edu: 'EDU_R_JANGAJJI', color: '#d8c8a0', icon: '🧄',
      desc: '햇마늘을 식촛물에 먼저 담가 매운맛을 빼고, 간장물을 부어 오래 삭혀요.',
      real: '한두 달', season: '초여름 햇마늘 때', care: ['taste'], flavor: { salty: 2, sour: 1, sweet: 1 },
      steps: [['🧄', '햇마늘', '껍질을 다듬은 햇마늘을 준비해요.'], ['💧', '식촛물', '식촛물에 일주일쯤 담가 아린 맛을 빼요.'], ['🫙', '간장물', '간장물을 끓여 식혀 부어요.'], ['⏳', '삭히기', '서늘한 곳에서 한두 달 삭혀요.']],
      microbes: '식초의 신맛과 간장의 짠맛이 마늘의 매운맛을 부드럽게 바꿔요.', kid: '매운 마늘이 순한 장아찌가 돼요!', src: ['E:E0048641'] },
    FER032: { name: '고추장아찌', cat: 'jangajji', jar: 'danji', resultItem: 'ITEM_GOCHUJANGAJJI', resultQty: 2, ingredients: { ITEM_PEPPER: 3, ITEM_GANJANG: 1, ITEM_SALT: 1 }, baseDuration: 220, idealTemp: [10, 25], idealHumidity: [40, 70], baseQuality: 60, exp: 200, coin: 290, edu: 'EDU_R_JANGAJJI', color: '#4a7a2a', icon: '🌶️',
      desc: '풋고추에 구멍을 내어 소금물에 삭힌 뒤 간장물을 부어 맛을 들여요.',
      real: '몇 주', season: '가을 끝물 고추', care: ['taste'], flavor: { salty: 2, spicy: 1, sour: 1 },
      steps: [['🌶️', '구멍 내기', '풋고추에 이쑤시개로 구멍을 내요.'], ['🧂', '삭히기', '소금물에 담가 누렇게 삭혀요.'], ['🫙', '간장물', '물기를 빼고 간장물을 부어요.'], ['⏳', '맛 들이기', '몇 주 지나면 짭짤하게 맛이 들어요.']],
      microbes: '소금물 속에서 젖산균이 천천히 일해 고추를 새콤하게 삭혀요.', kid: '밭의 고추로 장아찌를 담가요!', src: ['E:E0048641', 'E:E0051716'] },
    FER033: { name: '떡차 묵히기', cat: 'tea', jar: 'danji', resultItem: 'ITEM_TTEOKCHA', resultQty: 1, ingredients: { ITEM_TEALEAF: 2, ITEM_HANJI: 1 }, baseDuration: 420, idealTemp: [15, 30], idealHumidity: [50, 70], baseQuality: 58, exp: 270, coin: 400, edu: 'EDU_R_TEA', color: '#5a6a3a', icon: '🍵',
      desc: '찻잎을 쪄서 찧어 엽전 모양으로 빚고 가운데 구멍을 뚫어 꿰어 말린 뒤 오래 묵혀요. 장흥의 청태전이 이런 차예요.',
      real: '말리기 뒤 몇 달~몇 해', season: '봄에 찻잎을 따요', region: '전라남도 장흥', care: ['vent', 'taste'], flavor: { nutty: 2, sweet: 1 },
      steps: [['🍃', '찻잎 따기', '봄에 어린 찻잎을 따요.'], ['♨️', '찌고 찧기', '찻잎을 쪄서 절구에 찧어요.'], ['🪙', '엽전 모양', '동그랗게 빚어 가운데에 구멍을 뚫어요.'], ['🧵', '꿰어 묵히기', '줄에 꿰어 말린 뒤 바람 잘 드는 곳에서 묵혀요.']],
      microbes: '묵히는 동안 미생물과 공기가 찻잎의 맛을 천천히 바꿔 부드럽고 구수한 맛이 나요. 이런 차를 ‘후발효차’라고 해요.', kid: '엽전처럼 생긴 차를 줄에 꿰어 묵혀요!', src: ['F:detail/8988', 'E:E0076955', 'N:rdaInter 209162'] },
    FER034: { name: '메주 띄우기', cat: 'jang', jar: 'jungduri', resultItem: 'ITEM_MEJU', resultQty: 2, ingredients: { ITEM_BEAN: 4, ITEM_STRAW: 1 }, baseDuration: 240, idealTemp: [20, 30], idealHumidity: [60, 85], baseQuality: 60, exp: 180, coin: 220, edu: 'EDU_JANG_MEJU_TIME', color: '#b08a4a', icon: '🧱',
      desc: '삶아 찧은 콩을 네모나게 빚어 볏짚과 함께 따뜻한 방에서 띄워요. 잘 뜬 메주는 장 담그기의 재료가 돼요.', heat: { temp: 25, label: '따뜻한 방 (실제로는 장독이 아니라 방에 매달아요)' },
      real: '빚은 뒤 한두 달 띄우고 겨울 동안 말리기', season: '입동 무렵', care: ['vent', 'taste'], flavor: { nutty: 3, umami: 2 },
      steps: [['🫘', '불리고 삶기', '콩을 하룻밤 불려 가마솥에 푹 삶아요.'], ['🥣', '찧기', '절구로 콩을 찧어 으깨요.'], ['🧱', '빚기', '메주틀에 넣어 네모나게 빚고 겉을 말려요.'], ['🌾', '띄우기', '볏짚으로 묶어 매달거나 볏짚 위에 두어 따뜻하게 띄워요.']],
      microbes: '볏짚의 고초균과 공기 속 곰팡이가 메주에 자리를 잡고, 콩의 단백질을 나누는 효소를 만들어요. 그래서 메주에서 구수한 냄새가 나요.', kid: '볏짚 속 고초균이 콩 덩어리를 메주로 띄워요!', src: ['F:메주쑤기', 'F:detail/4784', 'N:vod 554'] },
  };
  for (const [id, x] of Object.entries(X)) {
    const r = D.recipes[id] || (D.recipes[id] = {});
    for (const [k, v] of Object.entries(x)) if (!(k in r)) r[k] = v;
    r.id = id;
  }
  // quests and achievements for the new things (the existing objective types: ferment_start / ferment_claim / edu / quiz)
  const NEW_QUESTS = {
    Q_JANG_SPLIT: { title: '장 가르기', icon: '✂️', category: 'ferment', giver: 'NPC004', requires: ['Q_DOENJANG'], desc: '메주를 소금물에 담그고, 때가 되면 장 가르기를 해서 간장과 된장을 두 장독에 나눠 익혀 보세요.', easyDesc: '장을 담그고 간장이랑 된장으로 나눠요!',
      objectives: [{ type: 'ferment_start', recipe: 'FER006', count: 1, text: '간장·된장 담그기 시작하기', easyText: '장을 담가요' }, { type: 'ferment_claim', recipe: 'FER007', count: 1, text: '장 가르기로 얻은 된장 꺼내기', easyText: '나눈 된장을 꺼내요' }],
      reward: { coin: 2500, exp: 350, edu: 20, title: '장 가르는 손' } },
    Q_GIMJANG: { title: '우리 집 김장', icon: '🥬', category: 'ferment', giver: 'NPC004', requires: ['QUEST001'], desc: '김장 때 함께 담그는 배추김치·깍두기·동치미를 장독에 담가 보세요.', easyDesc: '김치 세 가지를 담가요!',
      objectives: [{ type: 'ferment_start', recipe: 'FER004', count: 1, text: '배추김치 담그기', easyText: '배추김치를 담가요' }, { type: 'ferment_start', recipe: 'FER011', count: 1, text: '깍두기 담그기', easyText: '깍두기를 담가요' }, { type: 'ferment_start', recipe: 'FER012', count: 1, text: '동치미 담그기', easyText: '동치미를 담가요' }],
      reward: { coin: 2000, exp: 300, edu: 15 } },
    Q_FERMENT_FIVE: { title: '발효 장인의 길', icon: '🏺', category: 'ferment', giver: 'NPC004', requires: ['Q_NEW_FERMENT'], desc: '장독에서 발효 음식을 다섯 번 완성해 꺼내 보세요. 여러 가지를 담글수록 장독대가 풍성해져요.', easyDesc: '맛있는 걸 다섯 번 꺼내요!',
      objectives: [{ type: 'ferment_claim', count: 5, text: '발효 음식 5번 완성해 꺼내기', easyText: '다 익은 걸 꺼내요' }],
      reward: { coin: 3000, exp: 400, edu: 30, title: '발효 장인' } },
    Q_LEARN_MORE: { title: '배움터 탐험가', icon: '📚', category: 'edu', giver: 'NPC003', requires: ['QUEST001'], desc: '배움터에서 이야기 10개를 끝까지 보고 퀴즈 10문제를 맞혀 보세요. 발효 과학, 절기, 옹기, 정선 이야기가 기다려요.', easyDesc: '이야기 열 개를 보고 퀴즈 열 개를 맞혀요!',
      objectives: [{ type: 'edu', count: 10, text: '교육 콘텐츠 10개 끝까지 보기', easyText: '그림 이야기를 봐요' }, { type: 'quiz', count: 10, text: '퀴즈 10문제 맞히기', easyText: '퀴즈를 맞혀요' }],
      reward: { coin: 2000, exp: 300, edu: 40 } },
  };
  for (const [id, q] of Object.entries(NEW_QUESTS)) if (!D.quests[id]) { q.id = id; q.objectives.forEach((o, i) => { o.index = i; o.count = o.count || 1; }); D.quests[id] = q; }
  const NEW_ACH = {
    ACH_FERMENT_10: { name: '장독대 지킴이', icon: '🏺', desc: '발효 음식을 10번 완성해 꺼냈습니다.', condition: { stat: 'fermentsClaimed', gte: 10 }, reward: { coin: 1000, title: '장독대 지킴이' } },
    ACH_EDU_30: { name: '배움터 단골', icon: '📚', desc: '교육 콘텐츠 30개를 끝까지 학습했습니다.', condition: { stat: 'eduCompleted', gte: 30 }, reward: { coin: 1500, edu: 50 } },
    ACH_QUIZ_50: { name: '퀴즈 달인', icon: '🎓', desc: '퀴즈를 50번 맞혔습니다.', condition: { stat: 'quizCorrect', gte: 50 }, reward: { coin: 1500, edu: 50, title: '퀴즈 달인' } },
  };
  for (const [id, a] of Object.entries(NEW_ACH)) if (D.achievements && !D.achievements[id]) { a.id = id; D.achievements[id] = a; }
  // jar kinds of the 12 own jars (J1 … J12, left → right along the front row of the 장독대 terrace)
  D.fermentation.jarSlots = ['hangari', 'hangari', 'hangari', 'dok', 'jungduri', 'hangari', 'danji', 'dok', 'jungduri', 'hangari', 'danji', 'danji'];
  D.fermentation.maxJarsAll = 12;          // the most a plan or an administrator can open (G.sys.entitle.limit('jars'))
  D.fermentation.jarMismatch = 4;          // quality points lost when the jar kind is not the one the recipe likes
  D.fermentation.actionCooldown = 20;      // seconds between two of the same new jar actions
})();
