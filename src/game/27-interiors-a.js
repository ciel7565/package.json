// =============================================================================
// 27-interiors-a.js — rooms ①: PL_DAECHEONG 대청마루, the 강의실 (lecture hall) of the valley (CONTRACT §16.4 / §16.5,
// reworked in phase 9 — §17.3 "In the rooms", §17.9).
//
// A wide hanok hall used as a classroom: a lecture screen hangs like a great 족자 in the middle of the north wall, three
// rows of 방석 with small 서안 face it across a centre aisle, the teacher's 서안 with the 문방사우 and books stands beside
// it, a 책장 fills the north-east corner. The frame of the hall is still all in view (주춧돌 → 기둥 → 창방 → 대들보 → 동자주
// → 종보 → 대공 → 도리 → 서까래 over an 우물마루), the south wall is six lattice windows whose shadows lie on the floor, the
// west side stands open to a yard (들어열개), the door back out is in the east wall. Door: the front of 발효문화관 (B_CULTURE).
//
// NO guide stakes and NO structure boards any more (the owner: "건물 내부에 한옥 구조 안내판은 없애주고"): the exhibit cards of
// 48-interior-data.js are touched at the real things — a post, the floor, the folded doors, the windows, the 1 : 8 frame
// model by the open side — each with a name tag no bigger than a hand (R.label 0.3 × 0.1 m).
// Exhibit anchors: gidan · daedeulbo · seokkarae (the frame model) · juchu · gidung (two posts of the south wall) ·
// cheoma · deureoyeolgae (the open west side) · umulmaru (the floor) · changsal (the windows) · jibung (the roof samples)
// · art_geese · art_officials · art_dragon_carp; shelf:0…5 (the fallback shelf by the door: 안방과 사랑방 goes there).
//
// PUBLIC (used by 28 / 29-interiors and by any other room builder):
//   G.hanok.lectureScreen(R, ctx, { side, u, v = 1.6, w = 1.6, h = w · 9 / 16, n = 0.07, top })
//       -> { x, y, z, rotY, w, h, object }   a lecture screen hung like a 족자 on wall `side`, its centre `u` metres from
//       the wall's left end (seen from inside) and `v` up, `n` in front of the wall; `top` = where the cords are tied.
//       The picture is G.sys.lecture.screen(ctx, { x, y, z, rotY, w, h }) (74-lecture.js: the title card of the room's
//       lecture and the interactable 🎬 강의 보기; x / y / z = the CENTRE of the picture in the place's local metres). Until
//       that system is in the build a quiet card "강의 화면" hangs there and opens the lecture panel when there is one.
// Living details: dust in the window sun, the glow of the 좌등 and a 초롱 (slow flicker), a bamboo blind that sways at the
// open side.
//
// Room origins (z = 2000): PL_DAECHEONG −600 · PL_ANBANG −400 · PL_SARANG −200 · PL_BUEOK 0 · PL_BALHYO 200 ·
// PL_GOTGAN 400 · PL_OFFICE 600 (the district PL_ALLOT at (0, 2600)).
// =============================================================================
(function () {
  const P = G.sys.places, K = G.hanok;
  if (!P || !K) { G.log.warn('WORLD', 'interiors-a: places / hanok kit missing — no rooms'); return; }
  const PI = Math.PI;
  const BK = G.bkit, M = BK.M, mul = BK.mul, geo = BK.geo;
  const YAW = { N: 0, E: -PI / 2, S: PI, W: PI / 2 };
  const FONT = BK.FONT || '"PretendardEmbed","Pretendard","Noto Sans KR","Apple SD Gothic Neo","Malgun Gothic",sans-serif';
  const num = (v, d) => (Number.isFinite(Number(v)) && v != null ? Number(v) : d);

  // ================================================================ the lecture screen of a room (shared)
  /** the card that hangs while the lecture system is not in the build: calm, dark, a play mark and two lines */
  function standInCard() {
    return G.gfx.canvasTexture(512, 288, (c, w, h) => {
      const g = c.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#263640'); g.addColorStop(1, '#16222a');
      c.fillStyle = g; c.fillRect(0, 0, w, h);
      c.strokeStyle = 'rgba(214,180,110,.75)'; c.lineWidth = 3; c.strokeRect(12, 12, w - 24, h - 24);
      // a play mark
      c.fillStyle = 'rgba(232,196,120,.95)'; c.beginPath(); c.arc(w / 2, 104, 44, 0, PI * 2); c.fill();
      c.fillStyle = '#1b2830'; c.beginPath(); c.moveTo(w / 2 - 13, 82); c.lineTo(w / 2 + 24, 104); c.lineTo(w / 2 - 13, 126); c.closePath(); c.fill();
      c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillStyle = '#f4e9cf'; c.font = `800 50px ${FONT}`; c.fillText('강의 화면', w / 2, 192);
      c.fillStyle = '#c9b98f'; c.font = `600 22px ${FONT}`; c.fillText('가까이 가서 눌러 보세요', w / 2, 242);
    });
  }
  function lectureScreen(R, ctx, o = {}) {
    const side = YAW[o.side] != null ? o.side : 'N';
    const w = Math.min(6, Math.max(0.8, num(o.w, 1.6))), h = Math.min(4, Math.max(0.45, num(o.h, w * 9 / 16)));
    const u = num(o.u, R.len ? R.len[side] / 2 : 2), v = num(o.v, 1.6), n = Math.max(0.05, num(o.n, 0.07));
    const top = Math.min(num(o.top, v + h / 2 + 0.5), (R.post || 2.6) - 0.02);
    const opt = { wall: side, cast: false };
    const at = (du, dv, dn = 0) => R.wp(side, u + du, v + dv, n + dn);
    // ---- the 족자 mount: silk behind the picture, a paler band above and below, two rollers, the cords
    R.add('cloth', K.geo.slab(w + 0.16, h + 0.06, 0.012, 0.003), R.wm(side, u, v, n - 0.016), '#2e3b50', { wall: side });
    for (const [dv, hh, tint] of [[h / 2 + 0.085, 0.11, '#d9cba6'], [-h / 2 - 0.1, 0.14, '#d9cba6']]) R.add('cloth', K.geo.slab(w + 0.16, hh, 0.012, 0.003), R.wm(side, u, v + dv, n - 0.016), tint, opt);
    const rod = (dv, r, ext, tone) => { const a = at(-w / 2 - ext, dv), b = at(w / 2 + ext, dv); R.add('furn', geo.tube(a.x, a.y, a.z, b.x, b.y, b.z, r, 10), null, tone, opt); return [a, b]; };
    rod(h / 2 + 0.155, 0.017, 0.1, '#4a2f1c');
    const [ba, bb] = rod(-h / 2 - 0.19, 0.03, 0.12, '#3a2416');
    for (const p of [ba, bb]) R.add('brass', new THREE.SphereGeometry(0.036, 10, 8), M(p.x, p.y, p.z), null, opt);
    if (o.cords !== false && top > v + h / 2 + 0.22) {
      const k = at(0, 0, 0); k.y = top;
      for (const s of [-1, 1]) { const a = at(s * w * 0.36, h / 2 + 0.165); R.add('cloth', geo.tube(a.x, a.y, a.z, k.x, k.y, k.z, 0.006, 5), null, '#7a2e22', opt); }
      R.add('iron', new THREE.SphereGeometry(0.02, 8, 6), M(k.x, k.y, k.z), null, opt);
    }
    // ---- the picture: the lecture system's screen, or the stand-in card
    const p = at(0, 0, 0), rotY = YAW[side];
    const spec = { x: p.x, y: p.y, z: p.z, rotY, w, h };
    let object = null;
    const LS = G.sys.lecture;
    if (LS && typeof LS.screen === 'function') {
      try { object = LS.screen(ctx, { ...spec }) || null; if (object && object.isObject3D && !object.parent) ctx.group.add(object); }
      catch (e) { object = null; G.log.warn('WORLD', `place ${ctx.id}: the lecture screen failed — the stand-in card hangs instead`, e?.message || e); }
    }
    if (!object) {
      const tex = standInCard();
      ctx.own(tex);
      const mat = new THREE.MeshBasicMaterial({ map: tex, color: 0xe9e4da, fog: false });
      ctx.own(mat);
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
      mesh.name = 'room-lecture-screen';
      mesh.position.set(p.x, p.y, p.z); mesh.rotation.y = rotY;
      mesh.userData.guardSkip = true;   // an opaque picture on a wall: world geometry for the render guard
      R.addMesh(mesh, side);
      object = mesh;
      ctx.interact({
        id: `${ctx.id}:lecture`, kind: 'board', label: '🎬 강의 보기', kidLabel: '강의 보기', emoji: '🎬', radius: 3,
        position: { x: p.x + Math.sin(rotY) * 1.0, y: Math.min(p.y, 1.4), z: p.z + Math.cos(rotY) * 1.0 },
        onInteract: () => {
          const L2 = G.sys.lecture;
          try {
            if (L2 && typeof L2.open === 'function') { const lec = typeof L2.forPlace === 'function' ? L2.forPlace(ctx.id) : null; L2.open(lec && lec.id != null ? lec.id : undefined); }
            else G.ui?.toast?.('강의실을 준비하고 있어요. 조금만 기다려 주세요.', { type: 'info', emoji: '🎓' });
          } catch (e) { G.log.warn('UI', 'lecture panel failed', e?.message || e); }
        },
      });
    }
    return { ...spec, object };
  }
  K.lectureScreen = lectureScreen;

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
    R.block(x, z, 1.2, 0.75, { maxY: 1.2 });
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
    R.block(x, z, Math.abs(Math.cos(ry)) * 0.65 + Math.abs(Math.sin(ry)) * 0.3 + 0.02, Math.abs(Math.sin(ry)) * 0.65 + Math.abs(Math.cos(ry)) * 0.3 + 0.02, { maxY: 1.0 });
    return top;
  }

  P.define({
    id: 'PL_DAECHEONG', name: '대청마루', kidName: '대청마루', emoji: '🏛️', zoneId: 'ZONE_PL_DAECHEONG', color: '#e8c58a',
    desc: '강의를 듣는 한옥 마루 교실이에요. 집의 뼈대도 가까이에서 볼 수 있어요.',
    origin: { x: -600, z: 2000 }, size: { w: 16, d: 10, h: 4.6 }, floorY: 0, surface: 'wood',
    spawn: { x: 6.1, z: 0, rotY: -PI / 2 },
    door: { buildingId: 'B_CULTURE', x: door.x, z: door.z, label: '🚪 대청마루 강의실 들어가기', kidLabel: '마루 강의실 가기' },
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
      const spot = (p, dx = 0, dy = 0, dz = 0) => ({ x: p.x + dx, y: p.y + dy, z: p.z + dz });
      /** a name tag no bigger than a hand on a wall post (side, u, v) — the exhibit is touched at the thing itself */
      const postTag = (key, side, u, v, text, into = 0.4) => {
        R.label(text, { side, u, v, n: 0.168, w: 0.3, h: 0.1, style: 'paper' });
        const p = R.wp(side, u, Math.max(v, 0.5), into);
        return A(key, { x: p.x, y: p.y, z: p.z });
      };

      // ---- the screen wall (north): the lecture screen hangs like a great 족자 before the middle post
      K.lectureScreen(R, ctx, { side: 'N', u: 8, v: 1.63, w: 3.4, n: 0.31, top: 2.68 });
      // the teacher's place east of it: a 서안 with the 문방사우 and books, a thick cushion behind it, a 좌등
      const sa = K.seoan ? K.seoan(R, { x: 3.05, z: -3.5, rotY: PI, w: 1.1, d: 0.4, h: 0.36 }) : K.table(R, { x: 3.05, z: -3.5, w: 1.1, d: 0.4, h: 0.36, tone: '#6b3a22' });
      if (K.munbang) K.munbang(R, { x: 3.05, y: sa.top, z: -3.5, rotY: PI });
      if (K.books) {
        K.books(R, { x: 3.48, y: sa.top, z: -3.52, w: 0.18, d: 0.26, n: 3, seed: 7, rotY: 0.12 });
        K.books(R, { x: 2.2, z: -3.62, w: 0.2, d: 0.28, n: 6, seed: 21, rotY: -0.2 });
        K.books(R, { x: 2.24, z: -3.28, w: 0.2, d: 0.28, n: 3, seed: 4, rotY: 0.35 });
      }
      R.block(3.05, -3.5, 0.6, 0.24, { maxY: 0.5 });
      K.cushion(R, { x: 3.05, z: -4.1, w: 0.7, d: 0.62, h: 0.12, tint: '#8a2f2a', trim: '#c9a24a' });
      // a 책장 in the north-east corner
      if (K.chaekjang) { K.chaekjang(R, { x: 6.35, z: -4.74, w: 1.2, d: 0.4, h: 1.82, levels: 4, seed: 9 }); R.block(6.35, -4.74, 0.62, 0.22); }

      // ---- the seats: three rows of 방석 with a small 서안 each, a centre aisle towards the screen
      const tints = [['#2c4a6e', '#c9a24a'], ['#7e3a2c', '#c49a40'], ['#2f6a58', '#c9a24a'], ['#8a6a2c', '#2f4a80'], ['#5a3a5e', '#c9a24a'], ['#a8322c', '#2f4a80']];
      let seat = 0;
      for (const rz of [-0.7, 0.8, 2.3]) for (const cx of [-4.05, -2.75, -1.45, 1.45, 2.75, 4.05]) {
        const [tint, trim] = tints[(seat * 5 + (rz > 0 ? 2 : 0)) % tints.length];
        K.cushion(R, { x: cx, z: rz, w: 0.54, d: 0.54, h: 0.08, tint, trim });
        const dz = rz - 0.56, t = K.table(R, { x: cx, z: dz, w: 0.62, d: 0.32, h: 0.27, legs: 'straight', tone: seat % 2 ? '#7a4a2c' : '#6b3a22' }).top;
        if (K.books && seat % 3 !== 1) K.books(R, { x: cx + (seat % 2 ? 0.12 : -0.1), y: t, z: dz, w: 0.17, d: 0.24, n: 1 + (seat % 2), seed: 30 + seat, rotY: (seat % 5) * 0.09 - 0.15 });
        R.block(cx, dz, 0.31, 0.16, { maxY: 0.3 });
        seat++;
      }
      R.planItem(-2.75, 0.5, 3.3, 3.9, 'rgba(225,200,140,.55)');
      R.planItem(2.75, 0.5, 3.3, 3.9, 'rgba(225,200,140,.55)');

      // ---- pictures: two 족자 on the north wall, one beside the door (the screen took the middle)
      const hang = (side, bay, name, key, h) => {
        const b = R.bay(side, bay), s = K.scroll(R, { m: R.wm(side, b.uc, 2.42, 0.03), art: name, h, wall: side, maxW: 1.7 });
        A(key, spot(R.wp(side, b.uc, 1.15, 0.45)));
        return s;
      };
      hang('N', 1, 'wild_geese_landscape', 'art_geese', 1.62);
      hang('N', 4, 'officials_gathering', 'art_officials', 1.62);
      hang('E', 2, 'dragon_carp_minhwa', 'art_dragon_carp', 1.5);

      // ---- the fallback shelf by the door (east wall, north bay)
      R.shelfWall('E', 0, { levels: 2, slots: 3, w: 2.1, y: 0.92, gap: 0.52 }).forEach((sp, i) => A('shelf:' + i, sp));

      // ---- how the hall stands — touched at the real things, each with a tag no bigger than a hand
      // the 1 : 8 frame model by the open side: 기단 at its foot, 대들보 and 서까래 over it
      const mx = -6.2, mz = -1.9, mt = frameModel(R, mx, mz);
      R.label('한옥 뼈대 모형', { x: mx, y: mt - 0.08, z: mz + 0.68, rotY: 0, w: 0.5, h: 0.12, style: 'paper' });
      A('gidan', { x: mx - 0.55, y: mt + 0.12, z: mz + 0.7 });
      A('daedeulbo', { x: mx + 0.75, y: mt + 0.5, z: mz + 0.55 });
      A('seokkarae', { x: mx - 0.2, y: mt + 0.62, z: mz - 0.72 });
      // the roof samples by the north wall, west bay
      const rt = roofSamples(R, -6.55, -4.5, 0);
      R.label('기와 · 초가', { x: -6.55, y: rt - 0.09, z: -4.5 + 0.305, rotY: 0, w: 0.4, h: 0.1, style: 'paper' });
      A('jibung', { x: -6.55, y: rt + 0.2, z: -4.2 });
      // two posts of the south wall (S: u runs from east to west): a post and the stone under it
      postTag('gidung', 'S', 16 - 10.667, 1.28, '기둥');
      postTag('juchu', 'S', 16 - 5.333, 0.3, '주춧돌');
      postTag('changsal', 'S', 8, 1.28, '창살 · 한지');
      postTag('umulmaru', 'S', 16 - 13.333, 0.3, '우물마루');
      // the open west side (W: u runs from south to north): the folded doors overhead, the eaves outside
      postTag('deureoyeolgae', 'W', 3.333, 1.5, '들어열개', 0.55);
      postTag('cheoma', 'W', 6.667, 1.5, '처마', 0.55);

      // ---- a place to rest by the open side: a mat, a small table with a tea set, two cushions
      const tx = -6.25, tz = 2.55;
      K.floorMat(R, { x: tx, z: tz, w: 2.5, d: 1.9, rotY: 0 });
      const tb = K.table(R, { x: tx, z: tz, w: 0.52, round: true, h: 0.3, legs: 'curved', tone: '#6b3a22' }).top;
      K.pot(R, { kind: 'bottle', x: tx - 0.08, y: tb, z: tz - 0.04, s: 0.62, tint: '#e9e6da' });
      K.pot(R, { kind: 'bowl', x: tx + 0.12, y: tb, z: tz + 0.1, s: 0.55, tint: '#eeeadc' });
      K.pot(R, { kind: 'bowl', x: tx + 0.1, y: tb, z: tz - 0.14, s: 0.55, tint: '#eeeadc' });
      K.cushion(R, { x: tx - 0.75, z: tz, w: 0.56, d: 0.56, tint: '#a8322c', trim: '#2f4a80' });
      K.cushion(R, { x: tx + 0.75, z: tz, w: 0.56, d: 0.56, tint: '#2f6a58', trim: '#c9a24a' });
      R.block(tx, tz, 0.27, 0.27, { maxY: 0.34 });
      R.planItem(tx, tz, 2.5, 1.9, 'rgba(225,200,140,.75)');
      // a rice chest (뒤주) against the south-east corner post, two quiet pots beside it, a basket and straw by the yard side
      K.chest(R, { x: 7.2, z: 3.9, rotY: -PI / 2, w: 0.95, d: 0.62, h: 0.86, doors: 1, drawers: 0, legs: 0.14, fittings: 'iron', tone: '#8a5a36', frameTone: '#5d3a24' });
      R.block(7.2, 3.9, 0.36, 0.52, { maxY: 1.0, stand: true });   // [controls] the 뒤주 (0.86 + legs): one may land on it
      K.pot(R, { kind: 'hangari', x: 6.2, z: 4.3, s: 0.9, lid: true });
      K.pot(R, { kind: 'danji', x: 5.55, z: 4.45, s: 1.1, lid: true, tint: '#7a5236' });
      R.block(5.95, 4.35, 0.72, 0.42, { maxY: 0.75 });             // [controls] low pots: a jump clears them
      K.basket(R, { x: -7.2, z: 0.2, r: 0.3, h: 0.24 });
      K.basket(R, { x: -6.9, z: 0.85, kind: 'ki', r: 0.26, rotY: 0.7 });
      K.straw(R, { x: -7.35, z: 1.0, kind: 'bundle', s: 0.9, rotY: 0.4 });

      // ---- light: 좌등 beside the screen and by the windows, a lantern over the door; dust in the window sun
      const lamps = [[-2.3, -4.3, 0.9], [4.2, -4.3, 0.9], [-7.2, 4.3, 0.9], [2.67, 4.3, 0.8]];
      for (const [lx, lz, lh] of lamps) { K.jwadeung(R, { x: lx, z: lz, h: lh }); R.block(lx, lz, 0.2, 0.2); }
      // 초롱 over the door: a paper lantern on a cord
      R.add('glow', geo.cyl(0.11, 0.11, 0.3, 10), M(6.9, 2.18, 0), '#ffd9a8', { cast: false, wall: 'E' });
      for (const y of [2.02, 2.34]) R.add('furn', geo.cyl(0.115, 0.115, 0.03, 10), M(6.9, y, 0), '#3a2416', { cast: false, wall: 'E' });
      R.add('iron', geo.tube(6.9, 2.35, 0, 6.9, 2.62, 0, 0.005, 4), null, null, { cast: false, wall: 'E' });
      ctx.light({ x: 6.6, y: 2.1, z: 0, color: '#ffb66a', intensity: 6, distance: 10, decay: 1.7, flicker: 0.05, day: 0.3 });
      // a soft lamp over the seats so the hall reads at night (a pooled light; nothing on `low`)
      ctx.light({ x: 0, y: 2.5, z: 0.4, color: '#ffc98a', intensity: 7, distance: 13, decay: 1.6, day: 0.15 });
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
