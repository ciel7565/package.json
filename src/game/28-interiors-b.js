// =============================================================================
// 28-interiors-b.js — rooms ②: PL_ANBANG 안방 and PL_SARANG 사랑방 (CONTRACT §16.4 / §16.5), built with the hanok kit
// (19-hanok-kit.js; the furniture generators of its [rooms-b] block) the way 27-interiors-a.js builds the 대청.
//
// 안방 (door: the front of 한옥 ① B_HANOK1) — the warm, soft inner room of the house. 장판 over 온돌: the 아랫목 (the
//   warm end over the fire, west) is browned by the heat and breathes a faint warm shimmer; there the 보료 with its 장침,
//   안석 and 사방침 lies before a ten-panel 병풍 of flowers and birds (The Met, CC0). Along the north wall the 이불장 with
//   the folded bedding, the 이층장 (장롱), the 반닫이 under a 족자; the 경대 by the east window in the morning sun; a
//   다듬잇돌 with its two 방망이 and a 반짇고리 by the south windows; a brass 화로 with glowing coals, a 등잔, a 소반 with
//   persimmons, clothes on the 횃대, and a cut-away model of the 구들 under the motion board.
// 사랑방 (door: the front of 한옥 ② B_HANOK2) — the quiet study. Two bays of the south wall stand open to the yard (the real
//   valley behind them), their 세살문 swung back; the 서안 with the 문방사우 before the 책거리 병풍, a 책장 of thread-bound
//   books, a 사방탁자 of ceramics, a pair of 문갑 under a 족자, a 거문고 on its stand, the 고비 with letters, a 바둑판 with a
//   game half played and a tea tray before a second 병풍, a moon jar, four 족자 in all.
//
// Exhibit anchors (48-interior-data.js):
//   PL_ANBANG  ondol · boryo · byeongpung · jangnong · bandaji · gyeongdae · dadeumi · hwaro · hwajodo · art_hwajo ·
//              art_deer · art_rooster                                             board MG_GUDEUL (south wall, west bay)
//   PL_SARANG  seoan · sabangtakja · deungjan · chaekgeori · kkachi · irworobong · art_chaekgeori · art_still_life ·
//              art_plum · art_bamboo · art_portrait · art_tiger                    board MG_CHANGSAL (west wall, south bay)
// Living details: 안방 — the 아랫목 shimmer, the coals of the 화로 (glow + a pooled lamp with a slow flicker), the 등잔
//   flame, motes in the morning sun; 사랑방 — the 등잔 flame, steam from the teapot, a sheet of paper on the desk that lifts in
//   the breeze, motes in the sun. All of it stays still under reduce-motion and slower than 3 Hz.
// No smoking or drinking props. Every name plate is short; the hard words are explained on the exhibit cards.
// =============================================================================
(function () {
  const P = G.sys.places, K = G.hanok;
  if (!P || !K || typeof K.jangnong !== 'function') { G.log.warn('WORLD', 'interiors-b: places / hanok kit (with its [rooms-b] block) missing — no 안방 / 사랑방'); return; }
  const PI = Math.PI;
  const BK = G.bkit, M = BK.M, geo = BK.geo;
  const still = () => !!G.settings?.reduceMotion;

  /** the 아랫목: the paper browned by years of heat (geometry, every preset) and a faint warm shimmer (medium / high) */
  function araenmok(R, ctx, x0, x1, z0, z1) {
    const w = x1 - x0, d = z1 - z0, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    const n = 6;
    for (let i = 0; i < n; i++) {   // darker towards the fire end (west), soft steps
      const f = i / n, ww = w * (1 - f * 0.8);
      R.add('jangpan', K.geo.floor(ww, d * (1 - f * 0.25)), M(x0 + ww / 2, 0.0004 + i * 0.00013, cz), new THREE.Color(1 - 0.05 * (i + 1), 1 - 0.085 * (i + 1), 1 - 0.12 * (i + 1)), { cast: false });
    }
    if (ctx.low) return;
    const mat = new THREE.ShaderMaterial({
      name: 'AraenmokShimmer', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
      uniforms: { uTime: { value: 0 }, uAmp: { value: 1 } },
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `varying vec2 vUv; uniform float uTime; uniform float uAmp;
        float n2(vec2 p) { return sin(p.x) * sin(p.y); }
        void main() {
          vec2 q = vUv * vec2(6.0, 9.0);
          float k = 0.5 + 0.25 * n2(q + vec2(uTime * 0.21, -uTime * 0.17)) + 0.25 * n2(q * 1.7 + vec2(-uTime * 0.13, uTime * 0.11));
          float edge = smoothstep(0.0, 0.25, vUv.y) * smoothstep(1.0, 0.75, vUv.y) * smoothstep(1.0, 0.35, vUv.x);
          float a = edge * (0.022 + 0.02 * k) * uAmp;
          gl_FragColor = vec4(vec3(1.0, 0.55, 0.22) * a, 1.0);
        }`,
    });
    ctx.own(mat);
    const g = new THREE.PlaneGeometry(w, d); ctx.own(g);
    const mesh = new THREE.Mesh(g, mat);
    mesh.rotation.x = -PI / 2; mesh.position.set(cx, 0.02, cz); mesh.renderOrder = 2; mesh.raycast = () => {};
    mesh.name = 'room-araenmok'; mesh.userData.guardSkip = true;
    R.addMesh(mesh, null);
    R.onUpdate((dt, t, nf) => { mat.uniforms.uTime.value = still() ? 0 : t % 3600; mat.uniforms.uAmp.value = 0.8 + nf * 0.6; });
  }

  /** a cut-away model of the 구들 on a low table, its open side to the room (−Z): 아궁이 with coals → the 고래 (channels
   *  between stone ridges, the heat glowing along them) → 굴뚝; over the east part the layers 구들장 · 진흙 · 장판 in steps */
  function gudeulModel(R, x, z) {
    const top = K.table(R, { x, z, w: 1.42, d: 0.62, h: 0.4, tone: '#7a4e30' }).top, m = M(x, top, z), mul = BK.mul, F = { cast: false };
    R.add('earth', K.geo.slab(1.3, 0.06, 0.52, 0.006), mul(m, M(0.02, 0.03, 0)), '#a07c58');
    R.add('paint', K.geo.floor(1.02, 0.44), mul(m, M(0.06, 0.0615, 0)), '#241a12', F);
    for (const gz of [-0.2, -0.1, 0, 0.1, 0.2]) R.add('stone', K.geo.slab(1.02, 0.09, 0.04, 0.008), mul(m, M(0.06, 0.105, gz)), '#a39a8a');
    for (const gz of [-0.15, -0.05, 0.05, 0.15]) R.add('glow', K.geo.slab(0.96, 0.008, 0.022, 0.003), mul(m, M(0.05, 0.068, gz)), gz < 0 ? '#ff7a2c' : '#ff9a44', F);
    for (let i = 0; i < 4; i++) R.add('stone', K.geo.slab(0.115, 0.032, 0.5, 0.005), mul(m, M(0.16 + i * 0.12, 0.166, 0, (i % 2 ? 0.025 : -0.02))), '#8a8276');
    R.add('clay', K.geo.slab(0.33, 0.036, 0.5, 0.004), mul(m, M(0.42, 0.2, 0)), '#b58a5e');
    R.add('jangpan', K.geo.slab(0.17, 0.008, 0.5, 0.002), mul(m, M(0.5, 0.222, 0)), '#ffffff');
    // 아궁이 (west end): a clay firebox, its mouth to the room, coals inside; 굴뚝 (east end)
    R.add('clay', K.geo.slab(0.16, 0.22, 0.52, 0.012), mul(m, M(-0.54, 0.11, 0)), '#a77a50');
    R.add('paint', K.geo.quad(0.11, 0.1).applyMatrix4(new THREE.Matrix4().makeRotationY(PI)), mul(m, M(-0.54, 0.09, -0.262)), '#170f0a', F);
    for (let i = 0; i < 4; i++) R.add('glow', new THREE.IcosahedronGeometry(0.016, 0), mul(m, M(-0.57 + i * 0.022, 0.06, -0.23 + (i % 2) * 0.02)), i % 2 ? '#ff7a2a' : '#ffb347', F);
    R.add('clay', geo.cyl(0.04, 0.05, 0.42, 10), mul(m, M(0.63, 0.21, 0.12)), '#9c7650');
    R.label('구들 모형', { x, y: top - 0.07, z: z - 0.315, rotY: PI, w: 0.56, h: 0.14, sub: '아궁이 → 고래 → 굴뚝', style: 'paper' });
    R.planItem(x, z, 1.42, 0.62);
    return top + 0.25;
  }

  /** 화문석: a straw mat woven with a border and flower medallions in red and indigo */
  function hwamunseok(R, x, z, w, d, ry = 0) {
    K.floorMat(R, { x, z, w, d, rotY: ry, tint: '#e6d39a', border: '#5a3a28' });
    const m = M(x, 0, z, ry), mul = BK.mul;
    for (const sz of [-1, 1]) R.add('cloth', K.geo.floor(w - 0.3, 0.035), mul(m, M(0, 0.016, sz * (d / 2 - 0.17))), '#9a2f28', { cast: false });
    for (const sx of [-1, 1]) R.add('cloth', K.geo.floor(0.035, d - 0.3), mul(m, M(sx * (w / 2 - 0.17), 0.016, 0)), '#9a2f28', { cast: false });
    const n = Math.max(2, Math.round(w / 0.75));
    for (let i = 0; i < n; i++) for (const sz of [-1, 1]) {
      const px = -w / 2 + (w * (i + 0.5)) / n, pz = sz * d * 0.2;
      R.add('cloth', geo.ring(0.07, 0.11, 16), mul(m, M(px, 0.017, pz)), (i + (sz > 0 ? 1 : 0)) % 2 ? '#2c4470' : '#a3302a', { cast: false });
      R.add('cloth', geo.disc(0.035, 10), mul(m, M(px, 0.0175, pz)), '#d9a636', { cast: false });
    }
  }
  /** 다과상: a round low table with cups, a plate of 약과 and a plate of 다식 (no drinks but tea) */
  function dagwasang(R, x, z, o = {}) {
    const t = K.table(R, { x, z, w: o.w || 0.62, round: true, h: 0.3, legs: 'curved', tone: o.tone || '#5a2e1a' }).top;
    K.pot(R, { kind: 'bowl', x: x - 0.12, y: t, z: z + 0.04, s: 1.5, tint: '#f0ecdf' });
    for (let i = 0; i < 5; i++) { const a = i * 1.26; R.add('paint', geo.cyl(0.026, 0.028, 0.018, 8), M(x - 0.12 + Math.cos(a) * 0.04, t + 0.03 + (i === 4 ? 0.016 : 0), z + 0.04 + Math.sin(a) * 0.04, a), '#9a5622'); }   // 약과
    K.pot(R, { kind: 'bowl', x: x + 0.13, y: t, z: z - 0.06, s: 1.3, tint: '#efeadb' });
    ['#e9d27a', '#7a9a5a', '#d88a9a', '#5a3a2a'].forEach((c, i) => R.add('paint', geo.cyl(0.017, 0.017, 0.016, 10), M(x + 0.13 + (i % 2 - 0.5) * 0.04, t + 0.024 + (i > 1 ? 0.012 : 0), z - 0.06 + (i > 1 ? 0 : 0.02) * (i % 2 ? 1 : -1)), c));   // 다식
    for (const a of [0.9, 2.6, 4.4]) K.pot(R, { kind: 'bowl', x: x + Math.cos(a) * 0.2, y: t, z: z + Math.sin(a) * 0.2, s: 0.55, tint: '#b9ccb9' });
    R.block(x, z, 0.32, 0.32);
    return t;
  }
  /** 지통: a tall holder of rolled paper and scrolls */
  function jitong(R, x, z) {
    R.add('furn', K.geo.lathe([[0, 0], [0.13, 0], [0.135, 0.02], [0.125, 0.52], [0.135, 0.54], [0.12, 0.54], [0.11, 0.05], [0, 0.04]], 16), M(x, 0, z), '#6a4428');
    for (let i = 0; i < 9; i++) {
      const a = i * 2.4, r = (i % 3) * 0.035, tx = Math.cos(a) * 0.16, tz = Math.sin(a) * 0.16, h = 0.75 + (i % 4) * 0.07;
      R.add('hanji', geo.tube(x + Math.cos(a) * r, 0.05, z + Math.sin(a) * r, x + Math.cos(a) * r + tx, h, z + Math.sin(a) * r + tz, 0.022 + (i % 2) * 0.006, 8), null, i % 3 ? '#efe5cb' : '#e2d3ae');
      if (i % 3 === 0) R.add('furn', geo.cyl(0.03, 0.03, 0.02, 8).applyMatrix4(new THREE.Matrix4().makeRotationX(0)), M(x + Math.cos(a) * r + tx, h + 0.01, z + Math.sin(a) * r + tz), '#5a3420', { cast: false });
    }
    R.block(x, z, 0.16, 0.16);
  }

  // ================================================================ 안방
  const doorA = P.doorOf('B_HANOK1') || { x: -24, z: 30, exit: { x: -24, z: 33, rotY: 0 } };
  P.define({
    id: 'PL_ANBANG', name: '안방', kidName: '안방', emoji: '🛏️', zoneId: 'ZONE_PL_ANBANG', color: '#d9a85a',
    desc: '따뜻한 온돌방에서 집안 살림을 돌보던 방이에요.',
    origin: { x: -400, z: 2000 }, size: { w: 12, d: 9, h: 3.2 }, floorY: 0, surface: 'wood',
    spawn: { x: 4.5, z: 3.1, rotY: -PI * 0.78 },
    door: { buildingId: 'B_HANOK1', x: doorA.x, z: doorA.z, label: '🚪 안방 들어가기', kidLabel: '안방 구경' },
    exit: doorA.exit,
    indoor: true, camera: { dist: 4.6, min: 2.2, max: 6.2, pitch: 0.16, pmin: -0.1, pmax: 0.8, ceil: 2.62 }, far: 150,
    build(ctx) {
      const R = K.room(ctx, {
        w: 12, d: 9, post: 2.55, ceiling: 2.95, bays: { x: 4, z: 3 }, floor: 'jangpan', roof: 'ceiling', tone: 'warm', postR: 0.13,
        walls: {
          // left → right as seen from inside: N west → east, E north → south, S east → west, W south → north
          N: ['plaster', 'plaster', 'plaster', 'plaster'],
          E: ['plaster', { window: 'wanja', w: 1.7, h: 1.3, sill: 0.6 }, 'plaster'],
          S: [{ door: 'changho', exit: true, w: 1.5, h: 2.0 }, { window: 'aja', w: 1.7, h: 1.35, sill: 0.55 }, { window: 'aja', w: 1.7, h: 1.35, sill: 0.55 }, 'plaster'],
          W: ['plaster', 'plaster', 'plaster'],
        },
        sun: { az: 122, el: 23 },   // morning: low sun from the east-south-east through the 완자살 and 아자살 windows
      });
      const A = (key, spot) => ctx.anchor(key, spot);

      // ---- the 아랫목 (west, over the fire): browned paper, a warm shimmer; the 보료 before the 병풍
      araenmok(R, ctx, -6, -2.6, -4.5, 4.5);
      const scr = K.foldScreen(R, { x: -5.5, z: 0, rotY: PI / 2, art: 'birds_flowers_screen', panels: 10, artH: 1.36, fold: 0.3, frame: '#3a2416', brocade: '#3e4f62', silk: '#d8c9a2' });
      R.block(-5.5, 0, 0.16, scr.w / 2 + 0.05);
      A('art_hwajo', scr.center);
      A('byeongpung', { x: -5.42, y: scr.h - 0.05, z: -scr.w / 2 + 0.35 });
      K.boryo(R, { x: -4.82, z: 0, rotY: PI / 2, w: 2.05, d: 0.95, tint: '#902c27', trim: '#22386a', accent: '#d6a636' });
      R.block(-4.85, 0, 0.5, 1.05);
      A('boryo', { x: -4.55, y: 0.45, z: 0.55 });
      const hw = K.hwaro(R, { x: -3.75, z: 0.62, s: 0.95 });
      R.block(-3.75, 0.62, 0.3, 0.3);
      A('hwaro', { x: hw.glow.x + 0.05, y: hw.top + 0.3, z: hw.glow.z });
      const mj = K.chest(R, { x: -5.45, z: -2.05, rotY: PI / 2, w: 0.62, d: 0.38, h: 0.6, doors: 2, drawers: 2, legs: 0.07, fittings: 'brass', tone: '#8a5634' });   // 머릿장
      R.block(-5.45, -2.05, 0.2, 0.32);
      K.deungjan(R, { x: -5.45, y: mj.top, z: -1.92, h: 0.36 });
      K.pot(R, { kind: 'bottle', x: -5.45, y: mj.top, z: -2.24, s: 0.45, tint: '#efebe0' });
      hwamunseok(R, -1.15, 0.15, 2.7, 1.9);
      dagwasang(R, -1.15, 0.15);
      for (const [cx, cz] of [[-1.15, -0.62], [-1.15, 0.92]]) K.cushion(R, { x: cx, z: cz, w: 0.52, d: 0.52, h: 0.08, tint: cz < 0 ? '#2c4a6e' : '#8a2f2a', trim: cz < 0 ? '#c49a40' : '#2a3f66' });
      // a small table with three persimmons by the 보료
      const sb = K.table(R, { x: -3.7, z: -1.25, w: 0.46, round: true, h: 0.26, legs: 'curved', tone: '#5e301c' }).top;
      K.pot(R, { kind: 'bowl', x: -3.7, y: sb, z: -1.25, s: 1.25, tint: '#efeadb' });
      for (let i = 0; i < 3; i++) R.add('paint', new THREE.SphereGeometry(0.036, 12, 8).scale(1, 0.82, 1), M(-3.7 + Math.cos(i * 2.1) * 0.035, sb + 0.072 + (i === 2 ? 0.03 : 0), -1.25 + Math.sin(i * 2.1) * 0.035), '#e2742a');
      R.block(-3.7, -1.25, 0.24, 0.24);

      // ---- the north wall: 이불장 · 장롱 · 반닫이 (under the 족자 of deer)
      const ib = K.ibuljang(R, { x: -4.1, z: -4.17, w: 1.32, d: 0.56, h: 0.82 });
      R.block(-4.1, -4.17, 0.68, 0.3);
      const jn = K.jangnong(R, { x: -1.75, z: -4.2, w: 1.2, d: 0.52, h: 1.72, tiers: 2, tone: '#a2703f' });
      R.block(-1.75, -4.2, 0.62, 0.28);
      A('jangnong', { x: -1.75, y: 1.15, z: -3.9 });
      R.add('lacquer', K.geo.slab(0.5, 0.16, 0.36, 0.01), M(-1.9, jn.top + 0.08, -4.2, 0.04), '#4e1c12');                  // 함 (boxes) on the 장롱
      R.add('lacquer', K.geo.slab(0.36, 0.12, 0.28, 0.01), M(-1.86, jn.top + 0.22, -4.22, -0.06), '#7a2e1c');
      for (const dx of [-0.08, 0.08]) R.add('brass', K.geo.slab(0.04, 0.03, 0.004, 0.001), M(-1.9 + dx, jn.top + 0.1, -4.2 + 0.182), null, { cast: false });
      const bd = K.bandaji(R, { x: 1.5, z: -4.2, w: 1.0, d: 0.46, h: 0.78, tone: '#7a4628' });
      R.block(1.5, -4.2, 0.52, 0.25);
      A('bandaji', { x: 1.5, y: 0.6, z: -3.95 });
      // a wrapped bundle (보자기) and a lidded box on the 반닫이
      K.cushion(R, { x: 1.25, y: bd.top, z: -4.22, w: 0.4, d: 0.32, h: 0.12, tint: '#c8463a', trim: '#e2b03c' });
      R.add('lacquer', K.geo.slab(0.28, 0.12, 0.2, 0.01), M(1.78, bd.top + 0.06, -4.22, 0.1), '#5a2416');
      R.add('brass', K.geo.slab(0.06, 0.04, 0.004, 0.001), M(1.78 + 0.01, bd.top + 0.07, -4.22 + 0.1, 0.1), null, { cast: false });
      const sDeer = K.scroll(R, { m: R.wm('N', R.bay('N', 2).uc, 2.48, 0.03), art: 'deer_pines', h: 1.38, wall: 'N', maxW: 0.7 });
      A('art_deer', { x: sDeer.x, y: Math.max(1.35, sDeer.y), z: sDeer.z + 0.3 });

      // ---- the east wall: the 경대 under the rooster 족자 (north bay), the 완자살 window, clothes on the 횃대 (south bay)
      const sRooster = K.scroll(R, { m: R.wm('E', R.bay('E', 0).uc, 2.48, 0.03), art: 'rooster_hen_minhwa', h: 1.36, wall: 'E', maxW: 0.68 });
      A('art_rooster', { x: sRooster.x - 0.3, y: Math.max(1.35, sRooster.y), z: sRooster.z });
      const gy = K.gyeongdae(R, { x: 5.45, z: -3.0, rotY: -PI / 2 });
      K.cushion(R, { x: 4.85, z: -3.0, w: 0.5, d: 0.5, h: 0.08, tint: '#3c6a5a', trim: '#c79a3c' });
      K.pot(R, { kind: 'bottle', x: 5.5, z: -2.62, s: 0.32, tint: '#f0ece0' });
      R.block(5.45, -3.0, 0.2, 0.25);
      A('gyeongdae', { x: gy.mirror.x - 0.1, y: Math.max(0.55, gy.mirror.y), z: gy.mirror.z });
      {
        const b = R.bay('E', 2), y = 2.04, a = R.wp('E', b.u0 + 0.45, y, 0.17), c = R.wp('E', b.u1 - 0.45, y, 0.17);
        R.add('furn', geo.tube(a.x, a.y, a.z, c.x, c.y, c.z, 0.018, 8), null, '#6a4026', { wall: 'E' });
        for (const p of [a, c]) R.add('cloth', geo.tube(p.x, p.y, p.z, p.x + 0.16, 2.42, p.z, 0.004, 4), null, '#7a2e22', { wall: 'E', cast: false });
        // a 치마 (skirt, deep indigo) and a 저고리 (jacket, yellow with a red tie) thrown over the rail
        K.cloth(R, { m: M(a.x, y + 0.02, (a.z + c.z) / 2 - 0.55, PI / 2), w: 0.82, d: 0.05, drop: 1.05, tint: '#2c3d6a', wall: 'E' });
        K.cloth(R, { m: M(a.x, y + 0.028, (a.z + c.z) / 2 + 0.55, PI / 2), w: 0.62, d: 0.05, drop: 0.5, tint: '#dcb64c', wall: 'E' });
        R.add('cloth', K.geo.slab(0.04, 0.32, 0.03, 0.01), M(a.x - 0.04, y - 0.2, (a.z + c.z) / 2 + 0.5), '#b2302a', { wall: 'E', cast: false });
      }

      // ---- by the south windows: the 다듬잇돌 and a 반짇고리 (cloth, thread and 골무), each with a cushion
      const dd = K.dadeumitdol(R, { x: 0.9, z: 2.75, rotY: 0.12 });
      K.cushion(R, { x: 0.86, z: 3.4, w: 0.5, d: 0.5, h: 0.08, tint: '#9a3a30', trim: '#2c4470' });
      R.block(0.9, 2.75, 0.38, 0.2);
      A('dadeumi', { x: 0.9, y: dd.top + 0.25, z: 2.6 });
      K.banjitgori(R, { x: -1.55, z: 3.35, rotY: -0.08 });
      K.cushion(R, { x: -1.5, z: 2.75, w: 0.5, d: 0.5, h: 0.08, tint: '#2f5c50', trim: '#d0a040' });
      R.block(-1.35, 3.35, 0.42, 0.2);

      // ---- the south-west: a cut-away model of the 구들 under the motion board, the 화조도 · 십장생 sign
      const gm = gudeulModel(R, -4.45, 3.74);
      R.block(-4.45, 3.74, 0.72, 0.32);
      A('ondol', { x: -4.6, y: gm, z: 3.5 });
      {
        const b = R.bay('S', 3), w = 1.5, h = 0.84, v = 1.62;
        R.add('wood', K.geo.slab(w + 0.12, h + 0.12, 0.05, 0.012), R.wm('S', b.uc, v, 0.03), '#4a3020', { wall: 'S' });
        const p = R.wp('S', b.uc, v, 0.062);
        ctx.board('MG_GUDEUL', { x: p.x, y: p.y, z: p.z, rotY: PI, w, h, title: '구들에 불이 지나가는 길' });
      }
      A('hwajodo', R.signPost({ x: -3.1, z: 1.8, rotY: PI / 2 + 0.3, title: '화조도 · 십장생', sub: '그림에 담은 좋은 뜻' }));
      R.block(-3.1, 1.8, 0.15, 0.15);

      // ---- light: the coals, the 등잔 and a 좌등 are pooled lights (night); motes in the morning sun
      K.jwadeung(R, { x: 3.75, z: -3.95, h: 0.86 });
      R.block(3.75, -3.95, 0.2, 0.2);
      K.dust(R, { count: 150 });
      R.finish();
    },
  });

  // ================================================================ 사랑방
  const doorS = P.doorOf('B_HANOK2') || { x: 0, z: 30, exit: { x: 0, z: 33, rotY: 0 } };
  P.define({
    id: 'PL_SARANG', name: '사랑방', kidName: '사랑방', emoji: '📚', zoneId: 'ZONE_PL_SARANG', color: '#c8b07a',
    desc: '책을 읽고 손님을 맞던 조용한 방이에요.',
    origin: { x: -200, z: 2000 }, size: { w: 12, d: 8, h: 3.2 }, floorY: 0, surface: 'wood',
    spawn: { x: 3.7, z: 2.55, rotY: -PI * 0.8 },
    door: { buildingId: 'B_HANOK2', x: doorS.x, z: doorS.z, label: '🚪 사랑방 들어가기', kidLabel: '사랑방 구경' },
    exit: doorS.exit,
    indoor: true, camera: { dist: 4.6, min: 2.2, max: 6.2, pitch: 0.16, pmin: -0.1, pmax: 0.8, ceil: 2.62 }, far: 150,
    build(ctx) {
      const R = K.room(ctx, {
        w: 12, d: 8, post: 2.55, ceiling: 2.95, bays: { x: 4, z: 3 }, floor: 'jangpan', roof: 'ceiling', tone: 'warm', postR: 0.13,
        walls: {
          N: ['plaster', 'plaster', 'plaster', 'plaster'],
          E: ['plaster', { window: 'yongja', w: 1.5, h: 1.25, sill: 0.6 }, 'plaster'],
          S: [{ door: 'changho', exit: true, w: 1.5, h: 2.0 }, { open: true, bunhap: 0 }, { open: true, bunhap: 0 }, 'plaster'],
          W: ['plaster', 'plaster', 'plaster'],
        },
        sun: { az: 205, el: 30 },
      });
      const A = (key, spot) => ctx.anchor(key, spot), mul = BK.mul;

      // ---- the open 세살문: in each open bay two leaves swung back against the posts
      for (const bi of [1, 2]) {
        const b = R.bay('S', bi);
        for (const side of [-1, 1]) {
          const hu = side < 0 ? b.u0 + 0.16 : b.u1 - 0.16, lw = 0.68, lh = 2.0, kp = 0.48;
          const hm = mul(R.wm('S', hu, 0.12, 0.06), M(0, 0, 0, side < 0 ? -1.75 : 1.75));
          const lm = mul(hm, M(-side * lw / 2, 0, 0));
          K.changho(R, mul(lm, M(0, kp + (lh - kp) / 2, 0)), { w: lw, h: lh - kp, pattern: 'ttisal', tint: '#c2a482' });
          R.add('hanji', K.geo.quad(lw - 0.12, lh - kp - 0.12).applyMatrix4(new THREE.Matrix4().makeRotationY(PI)), mul(lm, M(0, kp + (lh - kp) / 2, -0.002)), '#e6dcc4', { cast: false });   // the paper seen from the other side
          R.add('wood', K.geo.timber(lw, kp - 0.01, 0.045, 0.008), mul(lm, M(0, kp / 2, 0.02)), '#b89a78');
          R.add('iron', new THREE.TorusGeometry(0.035, 0.006, 5, 12), mul(lm, M(side * (lw / 2 - 0.08), kp + 0.25, 0.05)), null, { cast: false });
          const c = new THREE.Vector3(0, 0, 0).applyMatrix4(lm);
          R.block(c.x, c.z, 0.38, 0.38);
        }
      }

      // ---- the north wall: 책장 · 책거리 병풍 with the 서안 before it · 사방탁자
      const scr = K.foldScreen(R, { x: 0, z: -3.62, art: 'chaekgeori_screen', panels: 10, artH: 1.24, fold: 0.3, frame: '#33200f', brocade: '#5a3a2e', silk: '#d6c8a4' });
      R.block(0, -3.62, scr.w / 2 + 0.05, 0.16);
      A('art_chaekgeori', scr.center);
      K.cushion(R, { x: 0, z: -3.0, w: 0.62, d: 0.6, h: 0.09, tint: '#2c4a6e', trim: '#b8903c' });
      R.add('cloth', K.geo.slab(0.28, 0.28, 0.28, 0.06), M(-0.55, 0.23, -3.05), '#7a2c26');   // 사방침 by the seat
      const sa = K.seoan(R, { x: 0, z: -2.45, rotY: PI, w: 1.06, d: 0.38, h: 0.35 });
      K.munbang(R, { x: 0, y: sa.top, z: -2.45, rotY: PI });
      R.block(0, -2.45, 0.58, 0.22);
      A('seoan', { x: 0.1, y: sa.top + 0.35, z: -2.3 });
      // a sheet of paper on the desk that lifts a little in the breeze from the yard
      {
        const g = new THREE.PlaneGeometry(0.2, 0.26, 1, 4); g.rotateX(-PI / 2); g.translate(0, 0, 0.13);
        const pos = g.attributes.position, base = Float32Array.from(pos.array);
        const pm = new THREE.Mesh(g, K.mat('hanji'));
        ctx.own(g);
        pm.position.set(-0.38, sa.top + 0.004, -2.55); pm.rotation.y = PI + 0.25; pm.name = 'room-paper'; pm.receiveShadow = true;
        R.addMesh(pm, null);
        const tint = new THREE.Color('#f5eedb'), cols = new Float32Array(pos.count * 3);
        for (let i = 0; i < pos.count; i++) tint.toArray(cols, i * 3);
        g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
        let acc = 0;
        R.onUpdate((dt, t) => {
          if (still()) return;
          acc += dt; if (acc < 1 / 20) return; acc = 0;
          const lift = Math.max(0, Math.sin(t * 0.55) * 0.6 + Math.sin(t * 1.3) * 0.25) * 0.045;
          for (let i = 0; i < pos.count; i++) { const z = base[i * 3 + 2]; pos.setY(i, base[i * 3 + 1] + Math.pow(Math.max(0, z / 0.26), 2) * lift); }
          pos.needsUpdate = true;
        });
      }
      K.deungjan(R, { x: 0.82, z: -3.05, h: 0.5 });
      R.block(0.82, -3.05, 0.12, 0.12);
      A('deungjan', { x: 0.82, y: 0.85, z: -2.9 });
      A('chaekgeori', R.signPost({ x: 2.45, z: -3.05, rotY: -0.25, title: '책거리', sub: '책과 붓을 그린 그림' }));
      A('irworobong', R.signPost({ x: -2.45, z: -3.05, rotY: 0.25, title: '일월오봉도', sub: '글로 만나는 그림' }));
      for (const x of [2.45, -2.45]) R.block(x, -3.05, 0.15, 0.15);
      const ch = K.chaekjang(R, { x: -4.6, z: -3.78, w: 1.15, d: 0.4, h: 1.82, levels: 4, seed: 3 });
      R.block(-4.6, -3.78, 0.6, 0.22);
      void ch;
      const tk = K.sabangtakja(R, { x: 4.6, z: -3.72, w: 0.5, d: 0.46, h: 1.5, levels: 4 });
      R.block(4.6, -3.72, 0.27, 0.25);
      if (tk.length >= 4) {
        K.pot(R, { kind: 'bottle', x: tk[0].x - 0.08, y: tk[0].y, z: tk[0].z, s: 0.8, tint: '#a9c3b2' });            // a celadon bottle
        K.books(R, { x: tk[0].x + 0.12, y: tk[0].y, z: tk[0].z, w: 0.16, d: 0.24, n: 5, seed: 11, rotY: 0.1 });
        K.pot(R, { kind: 'bowl', x: tk[1].x, y: tk[1].y, z: tk[1].z, s: 1.3, tint: '#efece2' });                     // a white porcelain bowl
        R.add('stone', new THREE.DodecahedronGeometry(0.075, 1).scale(0.7, 1.5, 0.6), M(tk[2].x, tk[2].y + 0.11, tk[2].z, 0.6), '#77736c');   // 수석 (a scholar's stone)
        R.add('furn', K.geo.slab(0.16, 0.02, 0.12, 0.005), M(tk[2].x, tk[2].y + 0.01, tk[2].z), '#3a2416');
        K.pot(R, { kind: 'hangari', x: tk[3].x, y: tk[3].y, z: tk[3].z, s: 0.33, mat: 'paint', tint: '#f2f0e8' });     // a small white jar
        A('sabangtakja', { x: tk[2].x, y: tk[2].y + 0.25, z: tk[2].z + 0.25 });
      } else A('sabangtakja', { x: 4.6, y: 1.0, z: -3.45 });

      // ---- the east wall: the 거문고 under the portrait (north bay), the 용자살 window, the 고비 and the tiger (south bay)
      K.geomungo(R, { x: 5.32, z: -2.6, rotY: -PI / 2, len: 1.62, w: 0.2, stand: 0.22 });
      R.block(5.32, -2.6, 0.2, 0.85);
      const sPort = K.scroll(R, { m: R.wm('E', R.bay('E', 0).uc, 2.48, 0.03), art: 'portrait_yun_dongseom', h: 1.4, wall: 'E', maxW: 0.8 });
      A('art_portrait', { x: sPort.x - 0.3, y: Math.max(1.35, sPort.y), z: sPort.z });
      const gb = K.gobi(R, { m: R.wm('E', R.bay('E', 2).u0 + 0.62, 2.05, 0.02), wall: 'E' });
      void gb;
      const sTiger = K.scroll(R, { m: R.wm('E', R.bay('E', 2).uc + 0.45, 2.48, 0.03), art: 'tiger_scroll', h: 1.38, wall: 'E', maxW: 0.68 });
      A('art_tiger', { x: sTiger.x - 0.3, y: Math.max(1.35, sTiger.y), z: sTiger.z });
      A('kkachi', R.signPost({ x: 5.15, z: 2.45, rotY: -PI / 2 + 0.2, title: '까치호랑이', sub: '글로 만나는 그림' }));
      R.block(5.15, 2.45, 0.15, 0.15);

      // ---- the west wall: the motion board (south bay), the 문갑 pair under the plum 족자, the bamboo 족자 and a moon jar
      {
        const b = R.bay('W', 0), w = 1.5, h = 0.84, v = 1.62;
        R.add('wood', K.geo.slab(w + 0.12, h + 0.12, 0.05, 0.012), R.wm('W', b.uc, v, 0.03), '#4a3020', { wall: 'W' });
        const p = R.wp('W', b.uc, v, 0.062);
        ctx.board('MG_CHANGSAL', { x: p.x, y: p.y, z: p.z, rotY: PI / 2, w, h, title: '창살 도감' });
      }
      for (const [z, lay] of [[-0.62, 'dDDd'], [0.62, 'dDDd']]) K.mungap(R, { x: -5.76, z, rotY: PI / 2, w: 1.2, d: 0.34, h: 0.5, layout: lay });
      R.block(-5.76, 0, 0.2, 1.24);
      K.pot(R, { kind: 'bottle', x: -5.74, y: 0.52, z: -0.95, s: 0.9, tint: '#f1efe7' });     // a white porcelain bottle
      K.books(R, { x: -5.74, y: 0.52, z: -0.2, w: 0.2, d: 0.26, n: 4, seed: 5, rotY: PI / 2 });
      K.pot(R, { kind: 'bowl', x: -5.74, y: 0.52, z: 0.75, s: 0.9, tint: '#a9c3b2' });
      const sPlum = K.scroll(R, { m: R.wm('W', R.bay('W', 1).uc, 2.48, 0.03), art: 'plum_branch', h: 1.3, wall: 'W', maxW: 0.9 });
      A('art_plum', { x: sPlum.x + 0.35, y: Math.max(1.3, sPlum.y), z: sPlum.z });
      const sBamboo = K.scroll(R, { m: R.wm('W', R.bay('W', 2).uc, 2.48, 0.03), art: 'bamboo_wind', h: 1.4, wall: 'W', maxW: 0.68 });
      A('art_bamboo', { x: sBamboo.x + 0.35, y: Math.max(1.35, sBamboo.y), z: sBamboo.z });
      R.add('furn', K.geo.slab(0.5, 0.08, 0.5, 0.01), M(-5.55, 0.04, -2.75), '#4a2c1a');
      K.pot(R, { kind: 'hangari', x: -5.55, y: 0.08, z: -2.75, s: 0.82, mat: 'paint', tint: '#f3f1ea' });   // 달항아리 (a white moon jar)
      R.block(-5.55, -2.75, 0.32, 0.32);

      // ---- the south-west: a low 병풍 behind a 바둑판 with a game half played, two cushions, a tea tray with steam
      const scr2 = K.foldScreen(R, { x: -4.5, z: 3.62, rotY: PI, art: 'still_life_screen', panels: 10, artH: 0.9, fold: 0.3, frame: '#2e1c10', brocade: '#3d4a42', silk: '#dcd0b0' });
      R.block(-4.5, 3.62, scr2.w / 2 + 0.05, 0.16);
      A('art_still_life', scr2.center);
      const bdk = K.baduk(R, { x: -4.4, z: 2.15, w: 0.45, d: 0.42 });
      R.block(-4.4, 2.15, 0.25, 0.24);
      void bdk;
      K.cushion(R, { x: -5.15, z: 2.15, w: 0.52, d: 0.52, h: 0.08, tint: '#8a2f2a', trim: '#2a3f66' });
      K.cushion(R, { x: -3.65, z: 2.15, w: 0.52, d: 0.52, h: 0.08, tint: '#355e52', trim: '#c49a40' });
      const tea = K.teaSet(R, { x: -4.45, z: 2.98, tint: '#b7cbb8' });
      R.block(-4.45, 2.98, 0.24, 0.24);
      K.steam(R, { x: tea.spout.x, y: tea.spout.y + 0.02, z: tea.spout.z, s: 0.18, count: 7, life: 2.6 });

      K.jwadeung(R, { x: 3.3, z: -3.72, h: 0.86 });
      K.jwadeung(R, { x: -2.95, z: -3.72, h: 0.86 });
      for (const x of [3.3, -2.95]) R.block(x, -3.72, 0.2, 0.2);
      jitong(R, -3.62, -3.7);
      // the guests' corner by the open side: a 화문석, cushions and a 다과상
      hwamunseok(R, 1.7, 0.55, 2.6, 1.8);
      dagwasang(R, 1.7, 0.55);
      for (const [cx, cz] of [[1.7, -0.25], [0.85, 0.55], [2.55, 0.55]]) K.cushion(R, { x: cx, z: cz, w: 0.5, d: 0.5, h: 0.08, tint: cx === 1.7 ? '#2c4a6e' : '#7e3a2c', trim: '#c49a40' });
      // 현판: a name board over the screen — 讀書堂 (독서당, the hall where one reads)
      R.label('讀書堂', { side: 'N', u: 6, v: 2.16, w: 1.2, h: 0.36, sub: '독서당 · 글 읽는 집', style: 'wood' });
      // rolled bamboo blinds (발) under the lintel of the open bays
      for (const bi of [1, 2]) { const b = R.bay('S', bi), a0 = R.wp('S', b.u0 + 0.25, 2.2, 0.12), a1 = R.wp('S', b.u1 - 0.25, 2.2, 0.12); R.add('basket', geo.tube(a0.x, a0.y, a0.z, a1.x, a1.y, a1.z, 0.05, 10), null, '#c9ab6a', { wall: 'S' }); for (const f of [0.2, 0.8]) { const q = R.wp('S', b.u0 + 0.25 + (b.len - 0.5) * f, 2.2, 0.12); R.add('cloth', geo.tube(q.x, 2.12, q.z, q.x, 2.34, q.z + 0.0, 0.006, 4), null, '#7a2e22', { wall: 'S', cast: false }); } }
      K.dust(R, { count: 120 });
      R.finish();
    },
  });
})();
