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

  // ---------------------------------------------------------------- 실시간 텃밭 + 곳간 (phase 7, CONTRACT §15.1 / §15.2)
  // East of the crop field, on the free ground between its east fence (x 16.4 — the z −32 field path ends at its gap)
  // and the stone path to the 발효주 저장고: x 20 … 32, z −37 … −18 has no path, collider, quest marker or NPC
  // (tests/realfarm-client.mjs checks the colliders). Both sit outside every zone circle (the 만장대 telescope keeps
  // aiming at the field) and are buildings, so the terrain flattens them and keeps trees / shrubs off them.
  //   garden: a fence 10 m (x) × 9.5 m (z), the gate in the middle of its west side facing the field (local front:
  //           rot −π/2), four raised beds RB1–RB4 (3.4 × 2.4 m, soil 0.38 m up) along a 2.4 m aisle from the gate,
  //           the wooden clock sign "⏰ 진짜 시간으로 자라요" outside, north of the gate
  //   곳간 B_GOTGAN ("B_STORAGE" is the 발효주 저장고): a thatched store house just south, its door facing west
  const RTG = { x: 26, z: -30.75, sx: 10, sz: 9.5 };
  L.rtGarden = {
    id: 'B_RTGARDEN', x: RTG.x, z: RTG.z, sx: RTG.sx, sz: RTG.sz,
    gate: { x: RTG.x - RTG.sx / 2, z: RTG.z, w: 2.4 },                  // opening in the west fence (world coords)
    sign: { x: RTG.x - RTG.sx / 2 - 0.6, z: RTG.z - 2.9, rot: -PI / 2, title: '⏰ 진짜 시간으로 자라요' },
    approach: { x: RTG.x - RTG.sx / 2 - 1.6, z: RTG.z },               // where the "가기" helper stops (outside the gate)
  };
  L.rtBeds = [
    { id: 'RB1', label: '1', x: RTG.x - 2.4, z: RTG.z - 2.4, w: 3.4, d: 2.4, h: 0.38, rot: 0 },
    { id: 'RB2', label: '2', x: RTG.x + 2.4, z: RTG.z - 2.4, w: 3.4, d: 2.4, h: 0.38, rot: 0 },
    { id: 'RB3', label: '3', x: RTG.x - 2.4, z: RTG.z + 2.4, w: 3.4, d: 2.4, h: 0.38, rot: 0 },
    { id: 'RB4', label: '4', x: RTG.x + 2.4, z: RTG.z + 2.4, w: 3.4, d: 2.4, h: 0.38, rot: 0 },
  ];
  // w = the front (gate / door) side, d = the depth: with rot −π/2 the front faces west, w runs along z, d along x
  L.buildings.push(
    { id: 'B_RTGARDEN', type: 'rtgarden', name: '실시간 텃밭', x: RTG.x, z: RTG.z, w: RTG.sz, d: RTG.sx, rot: -PI / 2, sign: '진짜 시간으로 자라요' },
    { id: 'B_GOTGAN', type: 'gotgan', name: '곳간', x: 26, z: -21.6, w: 6.4, d: 4.4, rot: -PI / 2, sign: '곳간' },
  );
  L.gotganDoor = { x: 26 - 4.4 / 2 - 1.0, z: -21.6, rot: PI / 2 };       // the spot in front of the door (facing east)

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
  // [world] phase 9 (CONTRACT §17.9): lamps along the fields and the paths between them — the owner found the fields
  // too dark at night. type 'field' = a tall timber post with a hanging 한지 lantern (16-props.js), 'stone' = 석등.
  // Appended (the indexes of the lamps above stay); tag = where it stands; y = metres above the ground (on a terrace).
  // Fence lamps stand ON the fence line (they replace a fence post), path lamps 0.6 m beside the path's edge.
  L.lanterns.push(
    // the crop field: its south and north fences and the verge of the middle path (one lamp per plot side)
    { x: -11, z: -21.8, type: 'field', tag: 'crop' }, { x: 0, z: -21.85, type: 'field', tag: 'crop' }, { x: 11, z: -21.8, type: 'field', tag: 'crop' },
    { x: -11, z: -30.0, type: 'field', tag: 'crop' }, { x: 0, z: -30.0, type: 'field', tag: 'crop' }, { x: 11, z: -30.0, type: 'field', tag: 'crop' },
    { x: -11, z: -43.4, type: 'field', tag: 'crop' }, { x: 0, z: -43.4, type: 'field', tag: 'crop' }, { x: 11, z: -43.4, type: 'field', tag: 'crop' },
    // the herb garden: one lamp at each gate post, a 석등 where the aisles cross
    { x: -42.2, z: -20.4, type: 'field', tag: 'herb' }, { x: -45.8, z: -39.6, type: 'field', tag: 'herb' },
    { x: -34.4, z: -28.2, type: 'field', tag: 'herb' }, { x: -53.6, z: -29.5, type: 'field', tag: 'herb' },
    { x: -45.7, z: -32.3, type: 'stone', tag: 'herb' },
    // the real-time garden: its gate post and the far end of its aisle
    { x: 21, z: -29.25, type: 'field', tag: 'rtgarden' }, { x: 30.6, z: -30.75, type: 'field', tag: 'rtgarden' },
    // paths between the zones
    { x: -23.7, z: -29.0, type: 'field', tag: 'path' },                      // crop field → herb garden
    { x: -39.6, z: -13.3, type: 'field', tag: 'path' },                      // fermentation yard → herb garden
    { x: -57.2, z: -33.4, type: 'field', tag: 'path' },                      // herb garden → tool display
    { x: -41.9, z: -45.8, type: 'field', tag: 'path' },                      // herb garden → education hall
    { x: -26.6, z: -56.7, type: 'stone', tag: 'path' },                      // hall → waterfall garden
    { x: 17.6, z: -52.7, type: 'field', tag: 'path' }, { x: 31.5, z: -36.6, type: 'field', tag: 'path' },   // hall → storage
    { x: 35.4, z: -16.2, type: 'stone', tag: 'path' },                       // jar yard → storage
    { x: 12.9, z: 17.5, type: 'field', tag: 'path' }, { x: 26.5, z: 25.5, type: 'field', tag: 'path' }, { x: 34.7, z: 38.2, type: 'field', tag: 'path' },   // plaza → rest garden
    { x: 2.5, z: 22, type: 'field', tag: 'path' }, { x: -2.5, z: 33.5, type: 'field', tag: 'path' }, { x: 2.5, z: 45, type: 'field', tag: 'path' },       // plaza → gate
    { x: -2.9, z: 66.2, type: 'field', tag: 'path' }, { x: 2.9, z: 76.5, type: 'field', tag: 'path' },                                                  // gate → road
    { x: -19.6, z: 5.3, type: 'stone', tag: 'path' },                        // plaza → fermentation yard
    // the jar yard: beside the connecting step and at the two ends of the ring field's aisle
    { x: 39, z: -0.5, type: 'stone', tag: 'jangdok' }, { x: 39, z: 8.5, type: 'stone', tag: 'jangdok' },
    { x: 60, z: -16.0, type: 'field', tag: 'jangdok' }, { x: 60, z: 24.0, type: 'field', tag: 'jangdok' },
    // the car park: its two back corners
    { x: -19.7, z: 81.7, type: 'field', tag: 'parking' }, { x: -45.0, z: 83.2, type: 'field', tag: 'parking' },
  );
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

  // [heal] 힐링관 (CONTRACT §19.6, lane heal-hall) — THE PLOT TAKEN: the north edge behind the main hall, east of its axis:
  // the footprint x 8 … 68, z −126 … −110 (60 × 16 m, the glass front faces south, rot 0), the door in the middle of
  // the front at (38, −109.7), the spot outside it (38, −107.1). Kept free around it: 6 m in front (the yard and the
  // path), 3 m at the back and the ends; the main hall's back wall (z −102) stands 8 m south-west of the front. The
  // inside is the place PL_HEAL of 69-healing-hall.js (the type 'heal' is built there, not by 15-buildings.js).
  L.buildings.push({ id: 'B_HEAL', type: 'heal', name: '힐링관', x: 38, z: -118, w: 60, d: 16, rot: 0, floors: 1 });
  L.paths.push({ id: 'PATH_HEAL', type: 'stone', width: 3.0, points: [[15, -70], [28, -79], [34, -92], [38, -101], [38, -108.6]] });

  // [buildings] ten hanok to walk into (CONTRACT §19.2, lane buildings) — THE PLOTS TAKEN, two small streets (the 힐링관
  // chose first; its plot and yard stay free). Type 'craft' is built by 64-interiors-e.js (G.bkit.craft, called from the
  // BUILDERS of 15-buildings.js); `craft` names the house, `sign` is its 현판. Every front faces its street (rot 0 = the
  // front faces south, rot π = north); steps end at the street's edge, doors are the middle of each front (doorOf).
  //  장터 거리 — west of the entrance path, inside the campus between the 한옥 마을 and the gate: the street z 44 … 48
  //    from the entrance path (x −1) to x −53. North side (fronts south): 한복집 x −20.9 … −7.1 · 염색 공방 −37.4 … −23.6 ·
  //    주막 −53.2 … −41.2 (the 3.8 m side yard between it and the 염색 공방 holds the dye drying rack). South side (fronts north): 떡집 −37.9 … −26.1 · 한지 공방 −51.2 … −39.8. Kept free: the entrance
  //    path and its view to the plaza, the gate's stone walls (z 58 … 59.5), 6 m to the road and to the 한옥 마을.
  //  공방 마을 — east of the main hall, towards the river: the street z −89.75 … −86.25 from PATH_HEAL (x 32.5) to x 79.
  //    North side: 서당 x 40.6 … 53.4 · 대장간 55 … 66 · 방앗간 68.5 … 79.5 (its water wheel and flume east of it,
  //    x 80 … 84, still dry land: the river's west bank is at x ≈ 88). South side: 약초방 42.1 … 53.9 · 찻집 56.6 … 67.4.
  //    Kept free: the 힐링관 yard (z > −104), PATH_HEAL, the hall plaza and the hall zone (r 28).
  L.buildings.push(
    { id: 'B_HANBOK', type: 'craft', craft: 'hanbok', name: '한복집', sign: '한복집', x: -14, z: 38.6, w: 12, d: 7, rot: 0 },
    { id: 'B_DYE', type: 'craft', craft: 'dye', name: '염색 공방', sign: '염색 공방', x: -30.5, z: 38.25, w: 12, d: 8, rot: 0 },
    { id: 'B_JUMAK', type: 'craft', craft: 'jumak', name: '주막', sign: '주막', x: -47.2, z: 38.9, w: 11, d: 7, rot: 0 },
    { id: 'B_TTEOK', type: 'craft', craft: 'tteok', name: '떡집', sign: '떡집', x: -32, z: 53.4, w: 10, d: 7, rot: PI },
    { id: 'B_HANJI', type: 'craft', craft: 'hanji', name: '한지 공방', sign: '한지 공방', x: -45.5, z: 53.4, w: 9.5, d: 7, rot: PI },
    { id: 'B_SEODANG', type: 'craft', craft: 'seodang', name: '서당', sign: '서당', x: 47, z: -95, w: 11, d: 7, rot: 0 },
    { id: 'B_FORGE', type: 'craft', craft: 'forge', name: '대장간', sign: '대장간', x: 60.5, z: -94.7, w: 9, d: 7, rot: 0 },
    { id: 'B_MILL', type: 'craft', craft: 'mill', name: '방앗간', sign: '방앗간', x: 74, z: -95.2, w: 9, d: 8, rot: 0 },
    { id: 'B_HERB', type: 'craft', craft: 'herb', name: '약초방', sign: '약초방', x: 48, z: -81, w: 10, d: 7, rot: PI },
    { id: 'B_TEA', type: 'craft', craft: 'tea', name: '찻집', sign: '찻집', x: 62, z: -81, w: 9, d: 7, rot: PI },
  );
  L.paths.push(
    { id: 'PATH_MARKET', type: 'stone', width: 4.0, points: [[-1, 46], [-12, 46], [-30, 46.2], [-53, 46]] },
    { id: 'PATH_CRAFT', type: 'stone', width: 3.5, points: [[32.5, -88], [44, -88], [62, -88], [79, -88]] },
  );

  // ---------------------------------------------------------------- anchor lookup
  L.anchors = {};
  const add = (o) => { if (o && o.id) L.anchors[o.id] = o; };
  [L.buildings, L.jars, L.jarDisplays, L.farmPlots, L.signs, L.kiosks, L.exhibits, L.tools, L.photoZones, L.ponds, L.rtBeds].forEach((arr) => arr.forEach(add));
  [L.craftTable, L.shopStall, L.hallDoor, L.eduBoard, L.riverDeck].forEach(add);
  const M = L.manjangdae;
  [M.pavilion, M.marker, M.telescope, M.board].forEach(add);
  L.anchors.MANJANGDAE = { id: 'MANJANGDAE', x: M.deck.x, z: M.deck.z, rot: PI };
  /** anchor by id -> {x, z, rot, ...} or null */
  L.get = (id) => L.anchors[id] || null;
})();
