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
  disclaimer: '게임 속 발효·재배 수치는 교육용 가상 시뮬레이션이며 실제 식품 제조법이나 효과를 보장하지 않습니다.',
  titleDisclaimer: '게임 내 칭호이며 실제 자격증·전문 자격과 무관합니다.',
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
  ITEM_DOENJANG: { name: '된장', type: 'fermented', icon: '🟤', price: 0, sell: 400, desc: '메주를 소금물에 담가 숙성시켜 만든 장입니다. (게임 체험 결과물)' },
  ITEM_GANJANG: { name: '간장', type: 'fermented', icon: '🫙', price: 0, sell: 420, desc: '메주를 담근 소금물을 걸러 숙성시킨 장입니다. (게임 체험 결과물)' },
  ITEM_GOCHUJANG: { name: '고추장', type: 'fermented', icon: '🔴', price: 0, sell: 500, desc: '고춧가루·찹쌀·메줏가루로 만든 장입니다. (게임 체험 결과물)' },
  ITEM_KIMCHI: { name: '김치', type: 'fermented', icon: '🥬', price: 0, sell: 450, desc: '절인 채소에 양념을 버무려 발효시킨 음식입니다. (게임 체험 결과물)' },
  ITEM_VINEGAR: { name: '전통 식초', type: 'fermented', icon: '🍶', price: 0, sell: 480, desc: '곡물을 발효시켜 만든 식초입니다. (게임 체험 결과물)' },
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
  CRAFT_MEJU: { name: '메주 빚기', icon: '🧱', in: { ITEM_BEAN: 3 }, out: { ITEM_MEJU: 1 }, exp: 40, desc: '콩 3개를 삶아 찧은 뒤 네모나게 빚어 메주를 만듭니다. (게임 과정 단순화)' },
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
  ['알림', '게임 속 발효·재배 수치는 교육용 가상 시뮬레이션입니다.'],
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
