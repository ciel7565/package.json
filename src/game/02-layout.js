// =============================================================================
// 02-layout.js — world layout (positions only, meters, Y-up, north = -Z).
// Shared by terrain / buildings / props / systems / minimap so everything lines up.
// Rotation convention: rot (radians, around Y) turns a model whose FRONT faces +Z.
//   rot = 0 -> front faces south (+Z), rot = PI -> front faces north (-Z),
//   rot = PI/2 -> front faces east (+X), rot = -PI/2 -> front faces west (-X).
// Owned by the core; the buildings/props module may fine-tune coordinates here.
// =============================================================================
(function () {
  const PI = Math.PI;
  const L = (G.data.layout = {});

  // phase 4: new players start on the 정선 만장대 viewing deck, facing north over the whole valley
  L.spawn = { x: 52, z: 109.4, rotY: PI, zone: 'ZONE_MANJANGDAE' };
  L.plazaSpawn = { x: 0, z: 9, rotY: PI };   // the old start (plaza) — fallback / dev tools
  L.bounds = { minX: -135, maxX: 135, minZ: -135, maxZ: 135 }; // walkable box (soft clamp)
  L.worldSize = 1000;   // terrain plane extent (mountains continue to the horizon)
  L.waterY = -1.1;      // river / pond water surface height

  // ---------------------------------------------------------------- water
  L.river = {
    width: 16,
    points: [[124, -320], [112, -200], [100, -130], [93, -70], [90, -15], [92, 35], [98, 85], [106, 140], [116, 220], [126, 320]],
  };
  L.ponds = [
    { id: 'POND_REST', x: 52, z: 55, r: 8.5 },          // rest garden pond (pavilion on its north shore)
    { id: 'POND_HALL', x: -24, z: -64, r: 5.5, waterfall: { x: -27.5, z: -68.5, h: 3.2 } }, // hall garden pond + waterfall
  ];

  // ---------------------------------------------------------------- roads & paths
  L.roads = [
    { id: 'ROAD_MAIN', type: 'asphalt', width: 7, points: [[8, 175], [6, 132], [0, 106], [-16, 98], [-46, 96], [-70, 80], [-86, 44], [-92, 0], [-88, -44], [-76, -80], [-54, -104], [-30, -110], [-10, -112]] },
    { id: 'ROAD_LINK', type: 'asphalt', width: 6, points: [[0, 106], [0, 82]] },
  ];
  L.paths = [
    // plaza spokes
    { type: 'stone', width: 3.2, points: [[0, -12], [0, -20]] },
    { type: 'stone', width: 3.2, points: [[0, 12], [0, 34], [0, 57]] },
    { type: 'stone', width: 3.0, points: [[-12, 2], [-20, 3], [-27, 3]] },
    { type: 'stone', width: 3.0, points: [[12, 1], [17, 1.5], [21, 2]] },
    { type: 'dirt', width: 2.6, points: [[9, 10], [20, 22], [30, 32], [42, 41]] },
    // crop zone grid
    { type: 'dirt', width: 3.0, points: [[-17, -20], [17, -20]] },
    { type: 'dirt', width: 3.0, points: [[-5.5, -20], [-5.5, -45]] },
    { type: 'dirt', width: 3.0, points: [[5.5, -20], [5.5, -45]] },
    { type: 'dirt', width: 3.0, points: [[-17, -32], [17, -32]] },
    { type: 'dirt', width: 3.0, points: [[-5.5, -45], [0, -48], [5.5, -45]] },
    { type: 'stone', width: 3.4, points: [[0, -48], [0, -62]] },
    // to herb / edu / tools / fermentation
    { type: 'dirt', width: 2.6, points: [[-17, -32], [-31, -30]] },
    { type: 'dirt', width: 2.4, points: [[-40, -9], [-43, -16]] },
    { type: 'dirt', width: 2.4, points: [[-44, -42], [-44, -50]] },
    { type: 'dirt', width: 2.4, points: [[-52, -32], [-60, -38]] },
    { type: 'stone', width: 3.0, points: [[-12, -66], [-22, -58], [-32, -60]] },
    // to jangdokdae / storage / rest
    { type: 'stone', width: 2.6, points: [[30, -15], [38, -21], [45, -25]] },
    { type: 'stone', width: 2.4, points: [[12, -62], [26, -46], [40, -30]] },
    { type: 'dirt', width: 2.4, points: [[30, 18], [38, 26], [45, 33]] },
    { type: 'wood', width: 2.4, points: [[60, 46], [70, 46]] },
    // entrance
    { type: 'stone', width: 4.0, points: [[0, 57], [0, 82]] },
    // 정선 만장대: switchback stone path down the north-west flank (carved by the terrain at a constant grade,
    // hairpins filleted; see L.manjangdae.route) + the link from its foot to the entrance path
    { id: 'PATH_MANJANGDAE', type: 'stone', width: 3.0, elevated: true, points: [[43.5, 109.5], [44.6, 96.4], [24.4, 104.6], [31.9, 85.1], [15.3, 89.7]] },
    { id: 'PATH_MANJANGDAE_LINK', type: 'stone', width: 3.0, points: [[15.3, 89.7], [8.5, 84.6], [2.2, 80.6]] },
  ];
  L.plaza = { x: 0, z: 0, r: 13 };
  L.hallPlaza = { x: 0, z: -70, w: 30, d: 16 };

  // ---------------------------------------------------------------- buildings
  // type: hall | hanok | storage | thatched | pavilion | gate | stall | classroom
  L.buildings = [
    { id: 'B_HALL', type: 'hall', name: '전통발효체험관', x: 0, z: -90, w: 48, d: 24, rot: 0, floors: 3 },
    { id: 'B_CULTURE', type: 'hanok', name: '발효문화관', x: -44, z: 2, w: 16, d: 9, rot: PI / 2, sign: '발효문화관' },
    { id: 'B_STORAGE', type: 'storage', name: '발효주 저장고', x: 46, z: -34, w: 14, d: 9, rot: 0, sign: '발효주 저장고' },
    { id: 'B_EDU', type: 'classroom', name: '체험교육관', x: -46, z: -74, w: 15, d: 8, rot: 0, sign: '체험교육관' },
    { id: 'B_THATCH', type: 'thatched', name: '초가집', x: -71, z: -52, w: 9, d: 6, rot: 0.45 },
    { id: 'B_PAVILION', type: 'pavilion', name: '전통정자', x: 50, z: 41, w: 7, d: 7, rot: 0 },
    { id: 'B_GATE', type: 'gate', name: '정문', x: 0, z: 58, w: 12, d: 3, rot: 0, sign: '전통발효체험관' },
    { id: 'B_HANOK1', type: 'hanok', name: '한옥', x: -64, z: 12, w: 12, d: 7, rot: PI / 2 },
    { id: 'B_HANOK2', type: 'hanok', name: '한옥', x: -67, z: 32, w: 11, d: 7, rot: PI / 2 - 0.25 },
    { id: 'B_HANOK3', type: 'hanok', name: '한옥', x: 26, z: -58, w: 12, d: 7, rot: -0.25 },
    { id: 'B_HANOK4', type: 'hanok', name: '한옥', x: -58, z: -8, w: 9, d: 6, rot: PI / 2 + 0.2 },
    { id: 'B_SHOP', type: 'stall', name: '체험관 매점', x: 11, z: 69, w: 5, d: 3, rot: -0.35, sign: '매점' },
  ];

  // ---------------------------------------------------------------- jangdokdae (terraces + spiral ring field)
  L.jangdokdae = {
    platforms: [
      { shape: 'box', x: 28.5, z: 2, hw: 7.5, hd: 16, top: 0.45, rot: 0 },   // tier 1 (rows of jars + my jars in front)
      { shape: 'box', x: 39, z: 4, hw: 3, hd: 3.2, top: 0.45, rot: 0 },      // connecting step
      { shape: 'circle', x: 60, z: 4, r: 19, top: 0.9 },                      // tier 2 ring field
    ],
    rows: { x0: 26.6, x1: 35.4, z0: -13, z1: 16.5, step: 2.2, aisleZ: [1.9, 6.1] }, // tier-1 decorative rows (jar-free aisle, lined up with the connecting step)
    rings: { cx: 60, cz: 4, radii: [5, 7.4, 9.8, 12.2, 14.6, 17], spacing: 1.3, aisleWidth: 2.6, aisles: 4 },
    frontWalkX: [21, 25.6], // jar-free walkway on tier 1 (player jars stand at x≈24.6)
  };
  L.jars = [ // interactive jars (fermentation system); J1 is every player's assigned jar
    { id: 'J1', x: 24.6, z: -3.4, owner: 'me', slot: 1 },
    { id: 'J2', x: 24.6, z: -0.9, owner: 'me', slot: 2 },
    { id: 'J3', x: 24.6, z: 1.6, owner: 'me', slot: 3 },
  ];
  L.jarDisplays = [ // collection: 옹기 종류 (in front of the storage)
    { id: 'JARDISP_DOK', x: 39.5, z: -27.5, kind: 'dok', name: '독' },
    { id: 'JARDISP_JUNGDURI', x: 42.5, z: -28.2, kind: 'jungduri', name: '중두리' },
    { id: 'JARDISP_HANGARI', x: 49.5, z: -28.2, kind: 'hangari', name: '항아리' },
    { id: 'JARDISP_DANJI', x: 52.5, z: -27.5, kind: 'danji', name: '단지' },
  ];

  // ---------------------------------------------------------------- farm plots
  // prefill: initial growth/water/health for a NEW player (matches reference image 2 numbers)
  L.farmPlots = [
    { id: 'P1', zone: 'ZONE_CROP', label: '1', x: -11, z: -26, w: 8, d: 7, crop: 'CROP_BEAN', prefill: { growth: 65, water: 60, health: 80 } },
    { id: 'P2', zone: 'ZONE_CROP', label: '2', x: 0, z: -26, w: 8, d: 7, crop: 'CROP_PEPPER', prefill: { growth: 70, water: 55, health: 75 } },
    { id: 'P3', zone: 'ZONE_CROP', label: '3', x: 11, z: -26, w: 8, d: 7, crop: 'CROP_CABBAGE', prefill: { growth: 60, water: 50, health: 76 } },
    { id: 'P4', zone: 'ZONE_CROP', label: '4', x: -11, z: -38, w: 8, d: 7, crop: 'CROP_PERILLA', prefill: { growth: 79, water: 65, health: 85 } },
    { id: 'P5', zone: 'ZONE_CROP', label: '5', x: 0, z: -38, w: 8, d: 7, crop: 'CROP_CORN', prefill: { growth: 50, water: 45, health: 65 } },
    { id: 'P6', zone: 'ZONE_CROP', label: '6', x: 11, z: -38, w: 8, d: 7, crop: 'CROP_RADISH', prefill: { growth: 96, water: 70, health: 80 } },
    { id: 'H1', zone: 'ZONE_HERB', label: 'A', x: -49, z: -25, w: 6, d: 6, crop: 'CROP_MINT', prefill: { growth: 75, water: 60, health: 90 } },
    { id: 'H2', zone: 'ZONE_HERB', label: 'B', x: -39, z: -25, w: 6, d: 6, crop: 'CROP_LAVENDER', prefill: { growth: 40, water: 70, health: 85 } },
    { id: 'H3', zone: 'ZONE_HERB', label: 'C', x: -49, z: -35, w: 6, d: 6, crop: null, prefill: null },
    { id: 'H4', zone: 'ZONE_HERB', label: 'D', x: -39, z: -35, w: 6, d: 6, crop: 'CROP_LEMONBALM', prefill: { growth: 90, water: 50, health: 80 } },
  ];

  // ---------------------------------------------------------------- interactive props (meshes by props module, behavior by systems)
  // sign.action: 'edu' (opens edu content) | 'map' (world map) | 'info' (text modal)
  L.signs = [
    { id: 'SIGN_PLAZA', x: 7.5, z: -9, rot: -0.6, title: '전통발효체험관 안내도', action: 'map' },
    { id: 'SIGN_CROP', x: -8, z: -17.5, rot: 0.3, title: '전통작물 구역', action: 'edu', edu: 'EDU_FARMING' },
    { id: 'SIGN_BEAN', x: -17, z: -24, rot: PI / 2, title: '콩밭 이야기', action: 'edu', edu: 'EDU_BEAN' },
    { id: 'SIGN_HERB', x: -33.5, z: -19, rot: 0.6, title: '허브 구역', action: 'info', text: '박하·라벤더·로즈마리·레몬밤을 기르는 허브 정원입니다. 허브는 물을 너무 많이 주지 않아도 잘 자라요.' },
    { id: 'SIGN_FERMENT', x: -24, z: 8, rot: PI / 2 - 0.3, title: '발효문화관', action: 'edu', edu: 'EDU_FERMENT' },
    { id: 'SIGN_JANGDOK', x: 19.5, z: -7, rot: -PI / 2 + 0.2, title: '장독대', action: 'edu', edu: 'EDU_JANGDOK' },
    { id: 'SIGN_STORAGE', x: 37.5, z: -24, rot: 0.2, title: '발효주 저장고', action: 'info', text: '큰 독과 항아리에 장과 발효주를 보관하는 저장고입니다. 앞에 놓인 옹기들을 살펴보세요.' },
    { id: 'SIGN_EDU', x: -31, z: -55, rot: 0.5, title: '체험교육관', action: 'info', text: '키오스크에서 전통발효와 전통농업을 배우고 퀴즈에 도전해 보세요.' },
    { id: 'SIGN_TOOLS', x: -56, z: -36, rot: 0.9, title: '전통도구 전시장', action: 'edu', edu: 'EDU_TOOLS' },
    { id: 'SIGN_REST', x: 34, z: 33, rot: -0.8, title: '휴식정원', action: 'info', text: '정자와 연못이 있는 휴식 공간입니다. 앉아서 쉬거나 사진을 찍어 보세요.' },
    { id: 'SIGN_ENTRANCE', x: -7.5, z: 66, rot: 0.15, title: '전통발효체험관 METAVERSE', action: 'info', text: '한국 전통발효문화와 농업체험을 배우는 3D 체험관에 오신 것을 환영합니다!' },
  ];
  L.kiosks = [
    { id: 'K1', x: -53, z: -62, rot: PI / 2, edu: 'EDU_FERMENT', title: '전통발효란?' },
    { id: 'K2', x: -49, z: -57.5, rot: PI * 0.75, edu: 'EDU_BEAN', title: '콩과 메주' },
    { id: 'K3', x: -39, z: -57.5, rot: -PI * 0.75, edu: 'EDU_GOCHUJANG', title: '고추장 이야기' },
    { id: 'K4', x: -35, z: -62, rot: -PI / 2, edu: 'EDU_KIMCHI', title: '김치와 발효' },
    { id: 'K_HALL', x: 7, z: -73, rot: 0, edu: 'EDU_GANJANG', title: '체험관 안내 키오스크' },
  ];
  L.hallDoor = { id: 'HALL_DOOR', x: 0, z: -77.2, rot: 0 };
  L.eduBoard = { id: 'EDU_BOARD', x: -44, z: -68.5, rot: 0, w: 6, h: 3 };
  L.exhibits = [ // fermented-food display tables (fermentation zone yard; fronts face the plaza path)
    { id: 'EXH_DOENJANG', x: -32, z: -6, rot: PI / 2, food: 'ITEM_DOENJANG', edu: 'EDU_DOENJANG', title: '된장' },
    { id: 'EXH_GANJANG', x: -30, z: -1.5, rot: PI / 2, food: 'ITEM_GANJANG', edu: 'EDU_GANJANG', title: '간장' },
    { id: 'EXH_GOCHUJANG', x: -29.5, z: 3, rot: PI / 2, food: 'ITEM_GOCHUJANG', edu: 'EDU_GOCHUJANG', title: '고추장' },
    { id: 'EXH_KIMCHI', x: -30, z: 7.5, rot: PI / 2, food: 'ITEM_KIMCHI', edu: 'EDU_KIMCHI', title: '김치' },
    { id: 'EXH_VINEGAR', x: -32, z: 12, rot: PI / 2, food: 'ITEM_VINEGAR', edu: 'EDU_FERMENT', title: '전통 식초' },
  ];
  L.craftTable = { id: 'CRAFT_TABLE', x: -37, z: 15.5, rot: PI / 2 + 0.3, title: '발효 재료 작업대' };
  L.tools = [ // traditional tools display (collection + quest Q_CULTURE)
    { id: 'TOOL_JIGE', x: -58, z: -41, rot: 0.6, kind: 'jige', name: '지게' },
    { id: 'TOOL_MAETDOL', x: -61.5, z: -39.5, rot: 0.4, kind: 'maetdol', name: '맷돌' },
    { id: 'TOOL_JEOLGU', x: -65, z: -39.5, rot: 0.2, kind: 'jeolgu', name: '절구' },
    { id: 'TOOL_KI', x: -68.5, z: -41, rot: 0, kind: 'ki', name: '키' },
    { id: 'TOOL_HOMI', x: -59, z: -46, rot: 0.8, kind: 'homi', name: '호미' },
    { id: 'TOOL_SIRU', x: -62.5, z: -47, rot: 0.5, kind: 'siru', name: '시루' },
  ];
  L.shopStall = { id: 'SHOP_STALL', x: 11, z: 69, rot: -0.35, shop: 'SHOP_GENERAL' };
  L.photoZones = [
    { id: 'PZ_HALL', name: '체험관 앞', x: 0, z: -61, r: 4, look: [0, 7, -90] },
    { id: 'PZ_JANGDOK', name: '장독대', x: 18.5, z: 13.5, r: 4, look: [60, 1, 4] },
    { id: 'PZ_PAVILION', name: '전통정자', x: 43, z: 47, r: 4, look: [50, 3, 41] },
    { id: 'PZ_RIVER', name: '계곡', x: 74, z: 46, r: 4, look: [92, 0, 40] },
    { id: 'PZ_FLOWER', name: '꽃밭', x: 31.5, z: 66, r: 4, look: [40, 1, 61] },
    { id: 'PZ_HANOK', name: '한옥마당', x: -27, z: -3, r: 4, look: [-44, 3, 2] },
    { id: 'PZ_GATE', name: '정문', x: 0, z: 71, r: 4, look: [0, 4, 58] },
    { id: 'PZ_WATERFALL', name: '폭포 정원', x: -18, z: -58, r: 4, look: [-26, 2, -67] },
  ];

  // ---------------------------------------------------------------- decoration anchors
  L.lanterns = [
    ...[0, 1, 2, 3, 4, 5].map((i) => { const a = (i / 6) * PI * 2 + PI / 6; return { x: Math.sin(a) * 14.2, z: Math.cos(a) * 14.2, type: 'stone' }; }),
    { x: -2.6, z: -52, type: 'post' }, { x: 2.6, z: -52, type: 'post' }, { x: -2.6, z: -59, type: 'post' }, { x: 2.6, z: -59, type: 'post' },
    { x: -7, z: 60.5, type: 'post' }, { x: 7, z: 60.5, type: 'post' },
    { x: 21, z: -15, type: 'stone' }, { x: 21, z: 19, type: 'stone' },
    { x: -27, z: -9, type: 'post' }, { x: -27, z: 17, type: 'post' },
    { x: 41.2, z: 45.2, type: 'stone' }, { x: 61, z: 47, type: 'stone' }, { x: 44, z: 63, type: 'stone' }, { x: 61, z: 63, type: 'stone' },
    { x: -40, z: -52, type: 'post' }, { x: -48, z: -52, type: 'post' },
  ];
  L.benches = [
    { x: -9.5, z: 7.5, rot: PI * 0.75 + PI }, { x: 9.5, z: 7.5, rot: -PI * 0.75 + PI },
    { x: 42, z: 58, rot: PI / 2 }, { x: 60, z: 62, rot: -PI * 0.8 }, { x: 62, z: 48, rot: -PI / 2 },
    { x: -47, z: -64.5, rot: PI }, { x: -41, z: -64.5, rot: PI },
    { x: -6, z: -66, rot: 0 }, { x: 6, z: -66, rot: 0 },
  ];
  L.parking = { x: -32, z: 89, w: 24, d: 12, rot: 0.06, cars: 7 };
  L.riverDeck = { id: 'DECK_RIVER', x: 75, z: 46, w: 9, d: 6, rot: 0, top: 0.35 };
  L.flowerBeds = [
    { x: 38, z: 62, r: 4.5, colors: ['#ff7eb6', '#ffd23f', '#ffffff'] },
    { x: 64, z: 62, r: 4, colors: ['#b48be0', '#ff9f43', '#ffffff'] },
    { x: 66, z: 51.5, r: 3, colors: ['#ff6b5e', '#ffd23f'] },
    { x: -14, z: -64, r: 3.5, colors: ['#ff7eb6', '#ffffff'] },
    { x: 14, z: -64, r: 3.5, colors: ['#ffd23f', '#ff9f43'] },
    { x: -10, z: 14, r: 2.5, colors: ['#ff7eb6', '#b48be0'] },
    { x: 10, z: 14, r: 2.5, colors: ['#ffd23f', '#ffffff'] },
  ];
  L.landmarkTrees = [ // hand-placed hero trees (nature module)
    { x: -15, z: 12, kind: 'zelkova', scale: 1.6 },   // 마을 느티나무 by the plaza
    { x: 15, z: -11, kind: 'pine', scale: 1.3 },
    { x: -20, z: -70, kind: 'pine', scale: 1.2 },
    { x: -29, z: -60, kind: 'pine', scale: 1.0 },
    { x: 57, z: 37, kind: 'maple', scale: 1.2 },
    { x: 40, z: 52, kind: 'pine', scale: 1.1 },
    { x: 20, z: -73, kind: 'pine', scale: 1.1 },
  ];
  L.stoneWalls = [ // low 돌담 segments [x1,z1,x2,z2]
    [-6.5, 58, -24, 59.5], [6.5, 58, 24, 59.5],
    // hall waterfall garden: back wall behind the waterfall + east / west returns (paths stay open)
    [-34, -73.5, -17, -73.5], [-16.6, -73, -16.6, -66.5], [-34.5, -73, -34.5, -65.5],
  ];

  // ---------------------------------------------------------------- 정선 만장대 (phase 4 start: lookout on the southern ridge)
  // A paved plateau (r) at `top` m above the valley on a hill south-east of the entrance. The deck faces north:
  // the whole experience centre with the hall and the tall northern mountains behind it. The switchback
  // path (route, top -> foot) descends the gentler north-west flank; the ridge runs on out of the valley.
  // (Location naming is in-game styling, not verified geography: see G.data.meta.addressNote.)
  L.manjangdae = {
    id: 'MANJANGDAE', zone: 'ZONE_MANJANGDAE', navLink: 'MANJANGDAE',
    x: 52, z: 118, r: 12, top: 22, footY: 0,
    gentleBearing: -PI * 0.75, gentleSpan: 60, gentleWidth: 36, steepWidth: 20,   // NW flank / other faces
    ridge: [[52, 118, 22, 12, 22], [62, 148, 31, 10, 24], [70, 182, 20, 9, 22], [74, 215, 0, 6, 16]],
    view: { x: 52, z: 90.5, hw: 20, hd: 15.5 },   // no trees below the deck
    route: [[43.5, 109.5], [44.6, 96.4], [24.4, 104.6], [31.9, 85.1], [15.3, 89.7]],
    pathWidth: 3, hairpinR: 2.5,
    deck: { x: 52, z: 109.4 },                      // the viewing spot (spawn)
    look: [2, 3, -40],                              // what the deck looks at (valley centre)
    pavilion: { id: 'MD_PAVILION', x: 52, z: 124.2, r: 3.9, base: 0.62 },   // 팔각정 on a stone base
    marker: { id: 'MD_MARKER', x: 45.4, z: 113.6, rot: 1.9 },                // carved stone (faces the deck)
    telescope: { id: 'MD_TELESCOPE', x: 55.6, z: 107.5, rot: PI },           // barrels point north (rot = facing)
    board: { id: 'MD_BOARD', x: 48.4, z: 107.6, rot: 0 },                    // text faces the deck (south)
    lanterns: [{ x: 49.0, z: 118.4 }, { x: 55.0, z: 118.4 }],               // 석등 at the pavilion steps (+ 2 at the path gap, by code)
    pines: [{ x: 61.8, z: 120.6, s: 1.1, lean: 0.24 }, { x: 42.2, z: 120.6, s: 1.0, lean: 0.2 }, { x: 58.6, z: 125.8, s: 1.2, lean: 0.14 }, { x: 45.4, z: 125.8, s: 0.95, lean: 0.12 }],
    gap: { bearing: -PI * 0.75, half: 0.17 },       // railing opening where the path leaves the plateau
  };
  L.navLinks = [
    // the planner follows the switchback path on / to / from the hill (terrain replaces `route` with the filleted centre line)
    { id: 'MANJANGDAE', route: L.manjangdae.route.map((p) => p.slice()), area: { x: 52, z: 118, r: 13.5 }, width: 2.4 },
  ];
  // two benches on the deck, looking at the view (appended: existing BENCH_i ids stay stable)
  L.benches.push({ x: 46.6, z: 112.4, rot: PI, manjangdae: true }, { x: 57.4, z: 112.4, rot: PI, manjangdae: true });
  L.photoZones.push({ id: 'PZ_MANJANGDAE', name: '만장대 전망대', x: 60.8, z: 117.2, r: 3, look: [10, 6, -30], elevated: true });

  // ---------------------------------------------------------------- anchor lookup
  L.anchors = {};
  const add = (o) => { if (o && o.id) L.anchors[o.id] = o; };
  [L.buildings, L.jars, L.jarDisplays, L.farmPlots, L.signs, L.kiosks, L.exhibits, L.tools, L.photoZones, L.ponds].forEach((arr) => arr.forEach(add));
  [L.craftTable, L.shopStall, L.hallDoor, L.eduBoard, L.riverDeck].forEach(add);
  const M = L.manjangdae;
  [M.pavilion, M.marker, M.telescope, M.board].forEach(add);
  L.anchors.MANJANGDAE = { id: 'MANJANGDAE', x: M.deck.x, z: M.deck.z, rot: PI };
  /** anchor by id -> {x, z, rot, ...} or null */
  L.get = (id) => L.anchors[id] || null;
})();
