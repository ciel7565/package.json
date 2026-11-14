// =============================================================================
// 27-interiors-a.js — rooms ①: PL_DAECHEONG 대청마루, the reference room of the hanok kit (CONTRACT §16.4 / §16.5).
//
// The hall that shows how a hanok stands: every member of the frame is in view — 주춧돌 → 기둥 → 창방 → 대들보 → 동자주 →
// 종보 → 대공 → 도리 → 서까래 — over an 우물마루 floor. The south wall is the 창살 도감 (the six lattice patterns as real
// windows, their shadows on the floor), the west side is open (들어열개: the 분합문 hang folded under the eaves) to a
// yard, the door back out is in the east wall. Door: the front of 발효문화관 (B_CULTURE).
//
// Exhibit anchors (48-interior-data.js): gidan · juchu · gidung · daedeulbo · seokkarae · cheoma · jibung · umulmaru ·
// deureoyeolgae · changsal · bangs · art_geese · art_officials · art_dragon_carp, shelf:0…5 (the fallback shelf by the
// door). Motion boards: MG_FRAME · MG_CHEOMA · MG_MARU (north wall) · MG_CHANGSAL (east wall).
// Living details: dust in the window sun, the glow of four 좌등 and a 초롱 (slow flicker), a bamboo blind that sways at
// the open side.
//
// Room origins (z = 2000): PL_DAECHEONG −600 · PL_ANBANG −400 · PL_SARANG −200 · PL_BUEOK 0 · PL_BALHYO 200 ·
// PL_GOTGAN 400 · PL_OFFICE 600 (the district PL_ALLOT at (0, 2600)).
// =============================================================================
(function () {
  const P = G.sys.places, K = G.hanok;
  if (!P || !K) { G.log.warn('WORLD', 'interiors-a: places / hanok kit missing — no rooms'); return; }
  const PI = Math.PI;
  const BK = G.bkit, M = BK.M, mul = BK.mul, geo = BK.geo;

  // shown only while 49-exhibits.js is not in the build (its data and cards take over when it is)
  const TOPICS = [
    ['gidan', '🧱', '기단', '집을 돌 단 위에 지어 비와 습기를 피했어요.', '터를 다진 뒤 땅보다 한 층 높게 쌓은 단이에요. 집 무게를 땅에 고루 전하고 빗물과 습기를 막아요.'],
    ['juchu', '🪨', '주춧돌', '기둥 발밑 돌이 나무를 물기에서 지켜요.', '기둥 밑을 받치는 돌이에요. 집 무게를 땅에 전하고 기둥 밑동이 습기에 상하지 않게 해요.'],
    ['gidung', '🪵', '기둥', '가운데가 통통한 배흘림기둥도 있어요.', '기둥은 모양에 따라 원통형, 민흘림, 배흘림으로 나눠요. 배흘림은 높이의 삼분의 일쯤이 가장 굵대요.'],
    ['daedeulbo', '🏗️', '대들보', '가장 큰 보가 지붕 무게를 기둥에 넘겨요.', '보는 앞뒤 기둥 위에 걸치는 큰 나무이고, 가장 큰 것이 대들보예요.'],
    ['seokkarae', '🦴', '도리와 서까래', '서까래는 지붕을 받치는 갈비뼈예요.', '서까래는 도리와 도리 사이에 촘촘히 걸쳐요. 그 위에 기와나 이엉을 올려요.'],
    ['cheoma', '☀️', '처마', '긴 처마가 여름 볕을 가려 줘요.', '벽보다 길게 내민 지붕 끝이에요. 여름 볕은 가리고 겨울 볕은 들여요.'],
    ['jibung', '🏠', '기와지붕과 초가지붕', '기와는 흙을 굽고, 초가는 볏짚을 엮어요.', '기와는 암키와와 수키와가 골을 이뤄 빗물을 흘려보내요. 초가는 볏짚 이엉을 덮어요.'],
    ['umulmaru', '🟫', '우물마루', '우물 정 글자처럼 짠 마루예요.', '긴 틀 사이에 짧은 널을 끼워 까는 마루예요. 나무가 말라 틈이 생기면 널을 밀어 메워요.'],
    ['deureoyeolgae', '🚪', '대청과 들어열개', '여름엔 문을 접어 천장에 걸어요.', '대청은 방과 방 사이 넓은 마루예요. 분합문을 접어 들쇠에 매달면 사방이 트여요.'],
    ['changsal', '🪟', '창살과 한지', '창살 무늬마다 이름이 있어요.', '띠살, 정자살, 빗살, 용자살, 아자살, 완자살이 있어요. 문에는 닥나무로 뜬 한지를 발라요.'],
    ['bangs', '🏡', '안방과 사랑방', '안방은 살림방, 사랑방은 손님방이에요.', '안방은 집안 살림의 중심이고, 사랑방은 손님을 맞는 방이에요.'],
  ].map(([anchor, emoji, title, kid, detail]) => ({ id: 'HX_' + anchor.toUpperCase(), anchor, emoji, title, kid, detail }));

  const door = P.doorOf('B_CULTURE') || { x: -39.2, z: 2, exit: { x: -36.6, z: 2, rotY: PI / 2 } };

  /** a 1 : 8 model of the frame on a low table: 기단 → 주춧돌 → 기둥 → 창방 → 대들보 → 도리 → 서까래 (one half left open) */
  function frameModel(R, x, z) {
    const top = K.table(R, { x, z, w: 2.3, d: 1.35, h: 0.52, tone: '#a07a56' }).top, s = 1 / 8, W = 12 * s, D = 6 * s, PH = 2.6 * s;
    const T = '#9a6c44', at = (lx, ly, lz) => M(x + lx, top + ly, z + lz);
    R.add('paint', K.geo.slab(W + 0.3, 0.05, D + 0.3, 0.008), at(0, 0.025, 0), '#b4ada0');   // a model: plain stone colour (the granite photograph is out of scale here)
    const xs = [-W / 2, -W / 6, W / 6, W / 2], zs = [-D / 2, D / 2];
    for (const px of xs) for (const pz of zs) {
      R.add('paint', geo.cyl(0.03, 0.036, 0.018, 8), at(px, 0.059, pz), '#9a9387');
      R.add('wood', geo.cyl(0.02, 0.022, PH, 8), at(px, 0.068 + PH / 2, pz), T);
    }
    const y0 = 0.068 + PH;
    for (const pz of zs) R.add('wood', K.geo.timber(W, 0.026, 0.02, 0.003), at(0, y0 - 0.03, pz), T);            // 창방
    for (const px of xs) {
      R.add('wood', K.geo.span(x + px, top + y0 + 0.022, z - D / 2 - 0.03, x + px, top + y0 + 0.022, z + D / 2 + 0.03, 0.044, 0.034, 0.006), null, '#855a38');   // 대들보
      for (const sz of [-1, 1]) R.add('wood', K.geo.timber(0.07, 0.024, 0.024, 0.003).applyMatrix4(new THREE.Matrix4().makeRotationZ(PI / 2)), at(px, y0 + 0.08, sz * D / 4), T);  // 동자주
      R.add('wood', K.geo.span(x + px, top + y0 + 0.125, z - D / 4 - 0.03, x + px, top + y0 + 0.125, z + D / 4 + 0.03, 0.03, 0.026, 0.004), null, T);            // 종보
      R.add('wood', K.geo.timber(0.075, 0.03, 0.02, 0.003).applyMatrix4(new THREE.Matrix4().makeRotationZ(PI / 2)), at(px, y0 + 0.178, 0), T);                    // 대공
    }
    const eave = y0 + 0.06, mid = y0 + 0.155, ridge = y0 + 0.228;
    for (const [pz, py] of [[-D / 2, eave], [D / 2, eave], [-D / 4, mid], [D / 4, mid], [0, ridge]]) R.add('wood', geo.tube(x - W / 2 - 0.05, top + py, z + pz, x + W / 2 + 0.05, top + py, z + pz, 0.014, 7), null, '#8a5e3c');   // 도리
    const n = 22;
    for (let i = 0; i < n; i++) {
      const px = -W / 2 + (W * (i + 0.5)) / n;
      for (const sz of [-1, 1]) {
        if (sz > 0 && px > 0.05) continue;                              // the south-east quarter stays open: the frame shows
        R.add('wood', geo.tube(x + px, top + eave + 0.012, z + sz * (D / 2 + 0.09), x + px, top + mid + 0.02, z + sz * D / 4, 0.007, 5), null, '#a5774d');
        R.add('wood', geo.tube(x + px, top + mid + 0.02, z + sz * D / 4, x + px, top + ridge + 0.02, z + sz * 0.005, 0.007, 5), null, '#a5774d');
      }
    }
    // a strip of 기와 on the north-west part: where the roof would go on
    const tile = (z0, y0b, z1, y1) => {
      const len = Math.hypot(z1 - z0, y1 - y0b), g = K.geo.slab(W * 0.46, 0.012, len, 0.003);
      g.applyMatrix4(new THREE.Matrix4().makeRotationX(Math.atan2(y0b - y1, z1 - z0)));
      R.add('paint', g, M(x - W * 0.26, top + (y0b + y1) / 2 + 0.034, z + (z0 + z1) / 2), '#4b4f55');
    };
    tile(-D / 2 - 0.1, eave, -D / 4, mid); tile(-D / 4, mid, 0, ridge);
    R.block(x, z, 1.2, 0.75);
    R.planItem(x, z, 2.3, 1.35, 'rgba(120,80,45,.8)');
    return top;
  }

  /** two small roof samples on a stand: a 기와 slope and a 초가 mound */
  function roofSamples(R, x, z, ry) {
    const top = K.table(R, { x, z, rotY: ry, w: 1.3, d: 0.6, h: 0.62, tone: '#a07a56' }).top, m = M(x, top, z, ry);
    // 기와: a sloped board with rows of round tiles
    const tb = K.geo.slab(0.5, 0.02, 0.42, 0.004); tb.applyMatrix4(new THREE.Matrix4().makeRotationX(0.5));
    R.add('wood', tb, mul(m, M(-0.32, 0.14, 0)), '#7a5236');
    for (let i = 0; i < 6; i++) {
      const g = geo.cyl(0.022, 0.022, 0.42, 8); g.applyMatrix4(new THREE.Matrix4().makeRotationX(PI / 2 + 0.5));
      R.add('paint', g, mul(m, M(-0.52 + i * 0.08, 0.162, 0)), i % 2 ? '#474b51' : '#53575d');
    }
    for (const sx of [-1, 1]) R.add('wood', K.geo.slab(0.03, 0.2, 0.03, 0.004), mul(m, M(-0.32 + sx * 0.2, 0.1, -0.14)), '#6a4830');
    // 초가: a thatch mound with its ridge roll (용마름)
    const th = new THREE.SphereGeometry(0.26, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2); th.scale(1, 0.62, 0.72);
    R.add('straw', th, mul(m, M(0.32, 0.0, 0)), '#d8bd76');
    R.add('straw', geo.cyl(0.03, 0.03, 0.4, 8).applyMatrix4(new THREE.Matrix4().makeRotationZ(PI / 2)), mul(m, M(0.32, 0.162, 0)), '#c2a25a');
    R.planItem(x, z, 1.3, 0.6);
    R.block(x, z, Math.abs(Math.cos(ry)) * 0.65 + Math.abs(Math.sin(ry)) * 0.3 + 0.02, Math.abs(Math.sin(ry)) * 0.65 + Math.abs(Math.cos(ry)) * 0.3 + 0.02);
    return top;
  }

  P.define({
    id: 'PL_DAECHEONG', name: '대청마루', kidName: '대청마루', emoji: '🏛️', zoneId: 'ZONE_PL_DAECHEONG', color: '#e8c58a',
    desc: '한옥이 어떻게 서 있는지 보여 주는 넓은 마루예요.',
    origin: { x: -600, z: 2000 }, size: { w: 16, d: 10, h: 4.6 }, floorY: 0, surface: 'wood',
    spawn: { x: 6.1, z: 0, rotY: -PI / 2 },
    door: { buildingId: 'B_CULTURE', x: door.x, z: door.z, label: '🚪 대청마루 들어가기', kidLabel: '대청마루 구경' },
    exit: door.exit,
    indoor: true, camera: { dist: 5.6, min: 2.6, max: 7.5, pitch: 0.13, pmin: -0.1, pmax: 0.8, ceil: 2.52 }, far: 150,
    exhibits: TOPICS,
    build(ctx) {
      const R = K.room(ctx, {
        w: 16, d: 10, post: 2.7, ridge: 4.6, bays: { x: 6, z: 3 }, floor: 'maru', roof: 'rafters', tone: 'warm',
        walls: {
          // left → right as seen from inside: N from west to east, E from north to south, S from east to west, W from south to north
          N: ['plaster', 'plaster', 'plaster', 'plaster', 'plaster', 'plaster'],
          E: ['plaster', { door: 'panel', exit: true, w: 1.7, h: 2.05 }, 'plaster'],
          S: K.PATTERNS.map((p) => ({ window: p, w: 1.62, h: 1.36, sill: 0.56 })),
          W: [{ open: true, bunhap: 4 }, { open: true, bunhap: 4 }, { open: true, bunhap: 0 }],
        },
        sun: { az: 206, el: 33 },
      });
      const A = (key, spot) => ctx.anchor(key, spot);

      // ---- north wall: three motion boards, two scrolls and a picture between the posts (bays 0…5 from west to east)
      const board = (side, bay, id, title) => {
        const b = R.bay(side, bay), w = 1.62, h = 0.91, v = 1.62;
        R.add('wood', K.geo.slab(w + 0.12, h + 0.12, 0.05, 0.012), R.wm(side, b.uc, v, 0.03), '#4a3020', { wall: side });
        const p = R.wp(side, b.uc, v, 0.062);
        ctx.board(id, { x: p.x, y: p.y, z: p.z, rotY: { N: 0, E: -PI / 2, S: PI, W: PI / 2 }[side], w, h, title });
      };
      board('N', 0, 'MG_CHEOMA', '처마와 해');
      board('N', 2, 'MG_FRAME', '한옥 뼈대 쌓기');
      board('N', 4, 'MG_MARU', '우물마루와 들어열개');
      board('E', 2, 'MG_CHANGSAL', '창살 도감');
      const hang = (bay, name, key, h) => {
        const b = R.bay('N', bay), s = K.scroll(R, { m: R.wm('N', b.uc, 2.42, 0.03), art: name, h, wall: 'N', maxW: 1.7 });
        const p = R.wp('N', b.uc, 1.15, 0.45);
        A(key, { x: p.x, y: p.y, z: p.z });
        return s;
      };
      hang(1, 'wild_geese_landscape', 'art_geese', 1.62);
      hang(3, 'officials_gathering', 'art_officials', 1.62);
      hang(5, 'dragon_carp_minhwa', 'art_dragon_carp', 1.5);

      // ---- the fallback shelf by the door (east wall, north bay)
      R.shelfWall('E', 0, { levels: 2, slots: 3, w: 2.1, y: 0.92, gap: 0.52 }).forEach((sp, i) => A('shelf:' + i, sp));
      // a few quiet pots under it
      K.pot(R, { kind: 'hangari', x: 7.25, z: -4.25, s: 0.9, lid: true });
      K.pot(R, { kind: 'danji', x: 6.55, z: -4.45, s: 1.1, lid: true, tint: '#7a5236' });
      R.block(7.0, -4.3, 0.75, 0.45);

      // ---- the frame model in the middle, the roof samples by the north wall
      frameModel(R, 0.4, -0.3);
      A('jibung', { x: 4.9, y: roofSamples(R, 4.9, -3.75, 0) + 0.2, z: -3.75 });

      // ---- name stakes: each stands by the member it names
      const stake = (key, x, z, ry, title, sub) => A(key, R.signPost({ x, z, rotY: ry, title, sub }));
      stake('gidan', -7.25, 1.6, PI / 2, '기단', '돌로 쌓은 단');
      stake('juchu', -2.2, -4.45, 0, '주춧돌', '기둥 발밑의 돌');
      stake('gidung', 0.45, -4.45, 0, '기둥', '배흘림기둥');
      stake('daedeulbo', 2.4, 1.9, PI / 2, '대들보 ⬆', '머리 위 가장 큰 나무');
      stake('seokkarae', -2.67, 2.2, PI / 2, '도리·서까래 ⬆', '지붕의 갈비뼈');
      stake('cheoma', -7.25, -3.4, PI / 2, '처마', '지붕의 긴 끝');
      stake('umulmaru', -4.6, -1.2, PI / 2, '우물마루 ⬇', '井자 마루');
      stake('deureoyeolgae', -6.2, 3.3, PI / 2, '들어열개 ⬆', '접어 올린 문');
      stake('changsal', -0.2, 4.15, PI, '창살 도감', '여섯 가지 무늬');
      stake('bangs', 7.1, 1.85, -PI / 2, '안방 · 사랑방', '문 너머의 방들');

      // ---- a place to sit: a mat, a small table with a tea set, two cushions (near the open side)
      K.floorMat(R, { x: -4.4, z: 1.3, w: 2.6, d: 1.9, rotY: 0 });
      const tb = K.table(R, { x: -4.4, z: 1.3, w: 0.52, round: true, h: 0.3, legs: 'curved', tone: '#6b3a22' }).top;
      K.pot(R, { kind: 'bottle', x: -4.48, y: tb, z: 1.26, s: 0.62, tint: '#e9e6da' });
      K.pot(R, { kind: 'bowl', x: -4.28, y: tb, z: 1.4, s: 0.55, tint: '#eeeadc' });
      K.pot(R, { kind: 'bowl', x: -4.3, y: tb, z: 1.16, s: 0.55, tint: '#eeeadc' });
      K.cushion(R, { x: -5.15, z: 1.3, w: 0.56, d: 0.56, tint: '#a8322c', trim: '#2f4a80' });
      K.cushion(R, { x: -3.65, z: 1.3, w: 0.56, d: 0.56, tint: '#2f6a58', trim: '#c9a24a' });
      R.planItem(-4.4, 1.3, 2.6, 1.9, 'rgba(225,200,140,.75)');
      // a rice chest (뒤주) against the south-east corner post, a basket and a straw sheaf by the yard side
      K.chest(R, { x: 7.2, z: 3.9, rotY: -PI / 2, w: 0.95, d: 0.62, h: 0.86, doors: 1, drawers: 0, legs: 0.14, fittings: 'iron', tone: '#8a5a36', frameTone: '#5d3a24' });
      R.block(7.2, 3.9, 0.36, 0.52);
      K.basket(R, { x: -7.1, z: -1.1, r: 0.3, h: 0.24 });
      K.basket(R, { x: -6.75, z: -0.45, kind: 'ki', r: 0.26, rotY: 0.7 });
      K.straw(R, { x: -7.3, z: -0.3, kind: 'bundle', s: 0.9, rotY: 0.4 });

      // ---- light: two standing lamps by the north wall, a lantern over the door; dust in the window sun
      K.jwadeung(R, { x: -1.35, z: -4.2 });
      K.jwadeung(R, { x: 3.95, z: -4.2 });
      K.jwadeung(R, { x: -6.3, z: 4.25 });
      K.jwadeung(R, { x: 2.67, z: 4.3, h: 0.8 });
      for (const [lx, lz] of [[-1.35, -4.2], [3.95, -4.2], [-6.3, 4.25], [2.67, 4.3]]) R.block(lx, lz, 0.2, 0.2);
      // 초롱 over the door: a paper lantern on a cord
      R.add('glow', geo.cyl(0.11, 0.11, 0.3, 10), M(6.9, 2.18, 0), '#ffd9a8', { cast: false, wall: 'E' });
      for (const y of [2.02, 2.34]) R.add('furn', geo.cyl(0.115, 0.115, 0.03, 10), M(6.9, y, 0), '#3a2416', { cast: false, wall: 'E' });
      R.add('iron', geo.tube(6.9, 2.35, 0, 6.9, 2.62, 0, 0.005, 4), null, null, { cast: false, wall: 'E' });
      ctx.light({ x: 6.6, y: 2.1, z: 0, color: '#ffb66a', intensity: 6, distance: 10, decay: 1.7, flicker: 0.05, day: 0.3 });
      K.dust(R, { count: 140 });

      // ---- 발: a bamboo blind half let down in the north bay of the open side; it sways a little
      const blindTex = G.gfx.canvasTexture(128, 256, (c, w, h) => {
        c.fillStyle = '#c8ab6a'; c.fillRect(0, 0, w, h);
        for (let y = 0; y < h; y += 3) { c.fillStyle = y % 6 ? 'rgba(90,65,25,0.5)' : 'rgba(255,240,190,0.25)'; c.fillRect(0, y, w, 1); }
        for (const x of [20, 64, 108]) { c.fillStyle = 'rgba(70,45,20,0.8)'; c.fillRect(x, 0, 3, h); }
      });
      ctx.own(blindTex);
      const bl = new THREE.Mesh(new THREE.PlaneGeometry(2.7, 1.25).translate(0, -0.625, 0), new THREE.MeshStandardMaterial({ map: blindTex, side: THREE.DoubleSide, roughness: 0.9 }));
      ctx.own(bl.material);
      const bw = R.bay('W', 2), bp = R.wp('W', bw.uc, 2.42, 0.02);
      bl.position.copy(bp); bl.rotation.y = PI / 2; bl.name = 'room-blind'; bl.receiveShadow = true;
      R.addMesh(bl, null);
      R.add('wood', K.geo.timber(2.76, 0.05, 0.05, 0.01).applyMatrix4(new THREE.Matrix4().makeRotationY(PI / 2)), M(bp.x, 2.44, bp.z), '#6a4830');
      R.onUpdate((dt, t) => { bl.rotation.z = G.settings?.reduceMotion ? 0 : Math.sin(t * 0.7) * 0.022 + Math.sin(t * 1.9) * 0.008; });

      R.finish();
    },
  });
})();
