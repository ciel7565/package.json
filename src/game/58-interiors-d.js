// =============================================================================
// 58-interiors-d.js — rooms ④: PL_HALL 본관 대강의실 · PL_EDU 체험 교실 · PL_STORAGE 숙성 저장고 · PL_SHOP 전통 가게
// (CONTRACT §16.4 / §16.5 / §17.3 "In the rooms" / §17.9, lane rooms2).
//
// Built with the hanok kit (19-hanok-kit.js; the generators of its [rooms2] block) exactly like the reference room
// 27-interiors-a.js: define() at load with the door from G.sys.places.doorOf(<building>), build(ctx) =
// G.hanok.room(ctx, spec) … R.finish(). No guide stakes and no structure boards (§17.9): the exhibit cards of
// 48-interior-data.js ([rooms2] block) are touched at the real things. Every room hangs a lecture screen
// (G.hanok.lectureScreen → G.sys.lecture.screen, with the stand-in card of 27-interiors-a.js when that system is absent);
// a lecture the operator assigns to a room (admin tab 🎓 강의 자료 → place) is offered — or opens by itself — on entry.
//
//  본관 대강의실 (B_HALL — a side door on the entrance terrace, 4.1 m east of the glass doors whose "체험관 안내" stays;
//    origin (1000, 2000), 26 × 16 × 6.5): a seven-bay hall under open rafters, a raised wooden stage along the north
//    wall with the great lecture screen hung like a 족자, the name board (현판) over it, four cloth banners, the
//    teacher's 서안 before a 병풍, a 강탁 (lectern), a 국악 corner (장구 · 북 · 가야금 · 징); five rows of 방석 with small
//    서안 for a class of sixty, long benches at the back, 청사초롱 under the beams, a book case, teaching jars.
//    Anchors: gangdang · hyeonpan · seodang · chaekssisi · bangseok · janggu · buk · chorong · byeongpung.
//  체험 교실 (B_EDU — the west door of the 체험교육관, origin (1200, 2000), 16 × 11 × 3.8): a hands-on 장 담그기
//    classroom — the teacher's work table (함지박 of soaked beans, the egg in brine, 바가지, 메주), a stone 화덕 with a
//    가마솥 steaming over a small fire, four low work tables with 방석 and real tools and ingredients, shelves of small
//    단지 along the west wall, 메주 hung on straw rope (they sway), the class's own 독 with a 용수 and a 금줄.
//    Anchors: kong · sogeum · gyeran · mejubitgi · yeotgireum · bagaji · yongsu · doksodok · danji.
//    Boards: MG_JANG_YEAR · MG_MICROBE.
//  숙성 저장고 (B_STORAGE, origin (1400, 2000), 16 × 10 × 4.2): rows of great 독, 중두리 and 항아리 on raised stone
//    단 under smoke-dark rafters; cool, dim light; the sun comes through barred 바라지 openings as visible shafts with
//    dust; one 간장 독 stands open (숯 and 고추 afloat, a slow ripple). "내 장독 판" on the east wall shows the
//    player's own twelve jars as they really are (41-fermentation: getJar / lockOf, read-only, redrawn on change).
//    Anchors: dok · hangari · jungduri · soraegi · sukseong · jeotgal · jangajji · ttukkeong.
//  전통 가게 (B_SHOP — a door beside the 매점 stall, origin (1600, 2000), 12 × 9 × 3.4): a counter (계산대) with a
//    주판, strings of 엽전, an 엿판 and the account books; shelves of 장, 단지, 보자기 bundles and 한과 behind it; 짚신
//    on the wall shelf, 가마니, 되와 말, a 지게 by the door, 곶감 strings that sway. The counter opens the shop screen
//    (G.sys.inventory.openShop — the same one as the stall outside; no prices are shown in the room itself).
//    Anchors: jangteo · ojangnal · bobusang · yeopjeon · jupan · jeoul · doemal · bojagi · jipsin · yeot.
// Every room: an exit door in the south wall, colliders (true tops: low furniture can be jumped, §17.1), the kit's
// minimap plan and light, ≥ 2 living details, ≤ 200 draw calls on high, flat colours on low.
// =============================================================================
(function () {
  const P = G.sys.places, K = G.hanok;
  if (!P || !K || typeof K.room !== 'function') { G.log.warn('WORLD', 'interiors-d: places / hanok kit missing — no 대강의실, 체험 교실, 저장고, 가게'); return; }
  const PI = Math.PI, TAU = PI * 2;
  const BK = G.bkit, M = BK.M, geo = BK.geo;
  const FONT = BK.FONT || '"PretendardEmbed","Pretendard","Noto Sans KR","Apple SD Gothic Neo","Malgun Gothic",sans-serif';
  const YAW = { N: 0, E: -PI / 2, S: PI, W: PI / 2 };
  const num = (v, d) => (Number.isFinite(Number(v)) && v != null ? Number(v) : d);
  const has = (name) => typeof K[name] === 'function';
  /** a spot `d` metres along the local +X of something turned by ry */
  const along = (p, ry, d, dy = 0) => ({ x: p.x + Math.cos(ry) * d, y: p.y + dy, z: p.z - Math.sin(ry) * d });

  // fallback exhibits (only while 49-exhibits.js is not in the build — its data and cards take over when it is)
  const topics = (rows) => rows.map(([anchor, emoji, title, kid]) => ({ id: 'HX_' + anchor.toUpperCase(), anchor, emoji, title, kid, detail: kid }));

  /** the lecture screen (27-interiors-a.js shares it as G.hanok.lectureScreen); a framed G.sys.lecture.screen without it */
  function lectureScreen(R, ctx, o) {
    if (has('lectureScreen')) return K.lectureScreen(R, ctx, o);
    const p = R.wp(o.side, o.u, o.v, o.n || 0.07);
    try { const obj = G.sys.lecture?.screen?.(ctx, { x: p.x, y: p.y, z: p.z, rotY: YAW[o.side], w: o.w, h: o.h }); if (obj && obj.isObject3D && !obj.parent) ctx.group.add(obj); return obj; } catch (e) { G.log.warn('WORLD', `place ${ctx.id}: no lecture screen`, e?.message || e); return null; }
  }

  /** cloth banners on one wall: one canvas, one mesh (vertical Hangul words on silk with 오방색 hems) */
  function banners(R, ctx, side, list) {
    const n = Math.min(8, list.length);
    if (!n) return null;
    const cw = ctx.low ? 96 : 160, chh = ctx.low ? 384 : 640;
    const tex = G.gfx.canvasTexture(cw * n, chh, (c) => {
      for (let i = 0; i < n; i++) {
        const b = list[i], x0 = i * cw;
        const g = c.createLinearGradient(x0, 0, x0 + cw, 0);
        g.addColorStop(0, b.bg2 || '#e9dcc0'); g.addColorStop(0.5, b.bg || '#f3ead3'); g.addColorStop(1, b.bg2 || '#e9dcc0');
        c.fillStyle = g; c.fillRect(x0, 0, cw, chh);
        // hems: a band of colour at the top and the bottom, a thin rule inside
        c.fillStyle = b.hem || '#2f4a80'; c.fillRect(x0, 0, cw, chh * 0.07); c.fillRect(x0, chh * 0.9, cw, chh * 0.1);
        c.fillStyle = b.hem2 || '#a8322c'; c.fillRect(x0, chh * 0.07, cw, chh * 0.018); c.fillRect(x0, chh * 0.882, cw, chh * 0.018);
        c.strokeStyle = 'rgba(90,60,30,.35)'; c.lineWidth = 2; c.strokeRect(x0 + cw * 0.12, chh * 0.11, cw * 0.76, chh * 0.75);
        // the words, one syllable under the other
        const chars = Array.from(String(b.text || '')).filter((ch) => ch.trim());
        const room = chh * 0.7, step = Math.min(cw * 0.62, room / Math.max(1, chars.length));
        c.fillStyle = b.fg || '#2e2218'; c.textAlign = 'center'; c.textBaseline = 'middle';
        c.font = `800 ${Math.round(step * 0.86)}px ${FONT}`;
        const y0 = chh * 0.485 - (step * (chars.length - 1)) / 2;
        chars.forEach((ch, k) => c.fillText(ch, x0 + cw / 2, y0 + k * step));
      }
    });
    ctx.own(tex);
    const pos = [], uv = [], nrm = [], idx = [];
    list.slice(0, n).forEach((b, i) => {
      const m = R.wm(side, b.u, b.v, num(b.n, 0.07)), w = b.w, h = b.h, base = pos.length / 3;
      for (const [x, y, u, v] of [[-w / 2, -h / 2, i / n, 0], [w / 2, -h / 2, (i + 1) / n, 0], [w / 2, h / 2, (i + 1) / n, 1], [-w / 2, h / 2, i / n, 1]]) {
        const q = new THREE.Vector3(x, y, 0).applyMatrix4(m);
        pos.push(q.x, q.y, q.z); uv.push(u, v);
      }
      const nn = new THREE.Vector3(0, 0, 1).transformDirection(m);
      for (let k = 0; k < 4; k++) nrm.push(nn.x, nn.y, nn.z);
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
      // the rod at the top and the cords
      const a = R.wp(side, b.u - w / 2 - 0.05, b.v + h / 2 + 0.02, num(b.n, 0.07)), c2 = R.wp(side, b.u + w / 2 + 0.05, b.v + h / 2 + 0.02, num(b.n, 0.07));
      R.add('furn', geo.tube(a.x, a.y, a.z, c2.x, c2.y, c2.z, 0.018, 8), null, '#4a2f1c', { wall: side, cast: false });
      for (const s of [-1, 1]) R.add('brass', new THREE.SphereGeometry(0.03, 8, 6), M(s < 0 ? a.x : c2.x, a.y, s < 0 ? a.z : c2.z), null, { wall: side, cast: false });
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    ctx.own(g);
    const mt = ctx.low ? new THREE.MeshLambertMaterial({ map: tex, side: THREE.DoubleSide }) : new THREE.MeshStandardMaterial({ map: tex, roughness: 0.92, metalness: 0, side: THREE.DoubleSide });
    ctx.own(mt);
    const mesh = new THREE.Mesh(g, mt);
    mesh.name = 'room-banners'; mesh.receiveShadow = true; mesh.userData.guardSkip = true;
    R.addMesh(mesh, side);
    return mesh;
  }

  /** goods on the levels of a shelf: fn(spot, k, level) is called for `per` spots along each level */
  function fillShelf(spots, ry, w, per, fn) {
    spots.forEach((sp, l) => { for (let k = 0; k < per; k++) fn(along(sp, ry, -w / 2 + (w * (k + 0.5)) / per), k, l); });
  }

  // =========================================================================================== 본관 대강의실 PL_HALL
  const doorHall = P.doorOf('B_HALL', { side: 4.1 });
  function buildHall(ctx) {
    const win = (p) => ({ window: p, w: 2.2, h: 1.9, sill: 1.0 }), winS = (p) => ({ window: p, w: 2.5, h: 1.9, sill: 0.9 });
    const R = K.room(ctx, {
      w: 26, d: 16, post: 4.6, ridge: 6.5, bays: { x: 7, z: 5 }, floor: 'maru', roof: 'rafters', tone: 'warm', postR: 0.21, entasis: true,
      walls: {
        N: ['plaster', 'plaster', 'plaster', 'plaster', 'plaster', 'plaster', 'plaster'],
        E: ['plaster', win('ttisal'), win('jeongja'), win('ttisal'), 'plaster'],
        S: ['plaster', winS('aja'), winS('yongja'), { door: 'changho', exit: true, w: 2.2, h: 2.5 }, winS('yongja'), winS('aja'), 'plaster'],
        W: ['plaster', win('ttisal'), win('jeongja'), win('ttisal'), 'plaster'],
      },
      sun: { az: 205, el: 30 },
    });
    const A = (key, spot) => ctx.anchor(key, spot);

    // ---- the stage along the north wall: planks on a panelled base, two treads in front of the middle
    const SY = 0.55, SX = 8.6, SZ0 = -8, SZ1 = -4.4, sd = SZ1 - SZ0, scz = (SZ0 + SZ1) / 2;
    R.add('floor', K.geo.floor(SX * 2, sd), M(0, SY, scz), '#cdb79a', { cast: false });
    for (let z = SZ0 + 0.26; z < SZ1 - 0.05; z += 0.26) R.add('paint', K.geo.floor(SX * 2 - 0.02, 0.008), M(0, SY + 0.001, z), '#3a2618', { cast: false });
    R.add('furn', K.geo.slab(SX * 2, SY, 0.05, 0.006), M(0, SY / 2, SZ1 - 0.025), '#7a4b2c');
    for (let x = -SX + 0.43; x < SX; x += 0.86) R.add('furn', K.geo.slab(0.07, SY - 0.09, 0.03, 0.004), M(x, SY / 2, SZ1 + 0.008), '#5a3420', { cast: false });
    for (const y of [SY - 0.035, 0.04]) R.add('furn', K.geo.timber(SX * 2 + 0.06, y > 0.1 ? 0.07 : 0.08, 0.08, 0.008), M(0, y, SZ1 + 0.012), '#5a3420');
    for (const sx of [-1, 1]) R.add('furn', K.geo.slab(0.05, SY, sd, 0.006), M(sx * (SX + 0.025), SY / 2, scz), '#6e4428');
    for (const [z0, z1, top] of [[SZ1, SZ1 + 0.36, 0.37], [SZ1 + 0.36, SZ1 + 0.72, 0.185]]) {
      R.add('furn', K.geo.slab(3.2, top, z1 - z0, 0.008), M(0, top / 2, (z0 + z1) / 2), '#7a4b2c');
      R.add('floor', K.geo.floor(3.18, z1 - z0 - 0.02), M(0, top + 0.001, (z0 + z1) / 2), '#cdb79a', { cast: false });
      ctx.addWalkable({ shape: 'box', x: 0, z: (z0 + z1) / 2, hw: 1.6, hd: (z1 - z0) / 2, top, surface: 'wood' });
    }
    ctx.addWalkable({ shape: 'box', x: 0, z: scz, hw: SX, hd: sd / 2, top: SY, surface: 'wood' });
    R.planItem(0, scz, SX * 2, sd, 'rgba(150,100,60,.85)');
    A('gangdang', { x: -1.9, y: 0.95, z: SZ1 + 0.2 });

    // ---- the great screen hung like a 족자, the name board over it, four banners
    lectureScreen(R, ctx, { side: 'N', u: 13, v: 2.52, w: 5.4, n: 0.24, top: 4.42 });
    R.label('대강의실', { side: 'N', u: 13, v: 4.86, n: 0.2, w: 2.3, h: 0.42, style: 'wood', sub: '우리 장 배움터' });
    A('hyeonpan', { x: 1.9, y: 0.95, z: SZ1 + 0.2 });
    banners(R, ctx, 'N', [
      { u: 2.2, v: 2.75, w: 0.66, h: 2.5, text: '콩 한 알의 꿈', hem: '#2f4a80', hem2: '#c9a24a' },
      { u: 9.0, v: 2.85, w: 0.66, h: 2.5, text: '장 담그는 날', hem: '#a8322c', hem2: '#2f6a58' },
      { u: 17.0, v: 2.85, w: 0.66, h: 2.5, text: '숨 쉬는 옹기', hem: '#2f6a58', hem2: '#a8322c' },
      { u: 23.8, v: 2.75, w: 0.66, h: 2.5, text: '함께 나누는 맛', hem: '#c9a24a', hem2: '#2f4a80' },
    ]);

    // ---- on the stage: the teacher's 서안 before a 병풍 (west), the 강탁 (east of the screen), the 국악 corner (east)
    if (has('foldScreen')) {
      const fs = K.foldScreen(R, { x: -6.4, y: SY, z: -7.55, art: 'birds_flowers_screen', panels: 8, artH: 1.18, fold: 0.3, frame: '#3a2416', brocade: '#5a3a2e' });
      A('byeongpung', fs && fs.center ? { x: fs.center.x, y: Math.min(fs.center.y, SY + 1.1), z: fs.center.z + 0.3 } : { x: -6.4, y: SY + 1.0, z: -7.2 });
    } else { K.screen(R, { x: -6.4, y: SY, z: -7.55, panels: 8, art: 'birds_flowers_screen' }); A('byeongpung', { x: -6.4, y: SY + 1.0, z: -7.2 }); }
    R.block(-6.4, -7.55, 1.75, 0.22, { maxY: SY + 1.6 });
    const sa = has('seoan') ? K.seoan(R, { x: -6.4, y: SY, z: -6.25, w: 1.1, d: 0.4, h: 0.34 }) : K.table(R, { x: -6.4, y: SY, z: -6.25, w: 1.1, d: 0.4, h: 0.34, tone: '#6b3a22' });
    if (has('munbang')) K.munbang(R, { x: -6.4, y: sa.top, z: -6.25 });
    if (has('books')) K.books(R, { x: -5.75, y: sa.top, z: -6.27, w: 0.18, d: 0.26, n: 3, seed: 11, rotY: 0.1 });
    K.cushion(R, { x: -6.4, y: SY, z: -6.9, w: 0.72, d: 0.64, h: 0.12, tint: '#8a2f2a', trim: '#c9a24a' });
    R.block(-6.4, -6.25, 0.58, 0.22, { maxY: SY + 0.38 });
    A('seodang', { x: -6.4, y: SY + 0.62, z: -6.0 });
    if (has('lectern')) { K.lectern(R, { x: 4.4, y: SY, z: -5.35 }); R.block(4.4, -5.35, 0.42, 0.3, { maxY: SY + 1.2 }); }
    // 국악: 장구 · 북 on cushions, a 가야금 lying by the wall, a 징 on its frame
    K.cushion(R, { x: 6.9, y: SY, z: -6.1, w: 0.56, d: 0.56, tint: '#2f4a80', trim: '#c9a24a' });
    if (has('janggu')) { K.janggu(R, { x: 6.9, y: SY, z: -6.75, rotY: 0.15 }); A('janggu', { x: 6.9, y: SY + 0.62, z: -6.6 }); } else A('janggu', { x: 6.9, y: SY + 0.62, z: -6.6 });
    if (has('buk')) { K.buk(R, { x: 7.85, y: SY, z: -5.55, rotY: -0.6 }); }
    A('buk', { x: 7.85, y: SY + 0.6, z: -5.4 });
    if (has('gayageum')) K.gayageum(R, { x: 5.3, y: SY, z: -7.5, rotY: 0 });
    if (has('jing')) K.jing(R, { x: 8.0, y: SY, z: -7.45, rotY: -0.4 });
    R.block(7.1, -6.5, 1.3, 1.25, { maxY: SY + 1.0 });
    R.block(5.3, -7.5, 0.85, 0.2, { maxY: SY + 0.35 });
    // 좌등 at both ends of the stage
    for (const sx of [-1, 1]) { K.jwadeung(R, { x: sx * 8.1, y: SY, z: -7.6, h: 0.95 }); R.block(sx * 8.1, -7.6, 0.2, 0.2, { maxY: SY + 1.0 }); }

    // ---- the class: five rows of 방석 and small 서안 either side of the middle aisle
    const tints = [['#2c4a6e', '#c9a24a'], ['#7e3a2c', '#c49a40'], ['#2f6a58', '#c9a24a'], ['#8a6a2c', '#2f4a80'], ['#5a3a5e', '#c9a24a'], ['#a8322c', '#2f4a80']];
    const rowsZ = [-2.9, -1.5, -0.1, 1.3, 2.7], colsX = [1.5, 2.6, 3.7, 4.8, 5.9, 7.0];
    let seat = 0;
    for (const rz of rowsZ) {
      for (const sx of [-1, 1]) {
        for (const cx of colsX) {
          const x = sx * cx, [tint, trim] = tints[(seat * 5 + (rz > 0 ? 2 : 0)) % tints.length];
          K.cushion(R, { x, z: rz, w: 0.52, d: 0.52, h: 0.08, tint, trim });
          const tz = rz - 0.52, t = K.table(R, { x, z: tz, w: 0.58, d: 0.3, h: 0.26, legs: 'straight', tone: seat % 2 ? '#7a4a2c' : '#6b3a22' }).top;
          if (has('books') && seat % 3 === 0) K.books(R, { x: x + (seat % 2 ? 0.1 : -0.09), y: t, z: tz, w: 0.16, d: 0.22, n: 1 + (seat % 2), seed: 40 + seat, rotY: (seat % 5) * 0.09 - 0.15 });
          seat++;
        }
        R.block(sx * 4.25, rz - 0.52, 3.05, 0.16, { maxY: 0.3 });
        R.planItem(sx * 4.25, rz - 0.26, 6.1, 0.9, 'rgba(225,200,140,.5)');
      }
    }
    A('chaekssisi', { x: -1.5, y: 0.55, z: rowsZ[0] - 0.52 });
    A('bangseok', { x: 2.6, y: 0.42, z: rowsZ[0] });
    // long benches at the back for grown-ups
    for (const sx of [-1, 1]) for (const bz of [4.55, 5.85]) {
      if (has('bench')) K.bench(R, { x: sx * 6.3, z: bz, w: 3.6 });
      R.block(sx * 6.3, bz, 1.8, 0.2, { maxY: 0.46, stand: true });
    }

    // ---- the corners: a book case (south-west), teaching jars (north-west), a shelf of jars (south-east)
    if (has('chaekjang')) { K.chaekjang(R, { x: -12.55, z: 5.3, rotY: PI / 2, w: 1.2, d: 0.4, h: 1.82, levels: 4, seed: 19 }); R.block(-12.55, 5.3, 0.22, 0.62); }
    K.pot(R, { kind: 'dok', x: -11.7, z: -6.9, s: 1.0, lid: true });
    if (has('geumjul')) K.geumjul(R, { x: -11.7, z: -6.9, s: 1.0, kind: 'dok' });
    K.pot(R, { kind: 'hangari', x: -10.45, z: -7.15, s: 0.82, lid: true });
    K.pot(R, { kind: 'danji', x: -10.2, z: -6.35, s: 1.0, lid: true, tint: '#7a5236' });
    R.block(-11.0, -6.85, 1.2, 0.75, { maxY: 1.4 });
    const shs = K.shelf(R, { x: 12.55, z: 5.2, rotY: -PI / 2, w: 1.4, d: 0.4, h: 1.6, levels: 3, back: true });
    fillShelf(shs, -PI / 2, 1.2, 3, (p, k, l) => {
      if (l === 0) K.pot(R, { kind: k === 1 ? 'hangari' : 'danji', x: p.x, y: p.y, z: p.z, s: k === 1 ? 0.42 : 0.62, lid: true });
      else if (l === 1) K.pot(R, { kind: 'bottle', x: p.x, y: p.y, z: p.z, s: 0.8, tint: k % 2 ? '#e9e4d6' : '#6a4b34' });
      else if (has('bojagi')) K.bojagi(R, { x: p.x, y: p.y, z: p.z, w: 0.26, h: 0.16, tint: ['#a8322c', '#2f4a80', '#c9a24a'][k % 3] });
    });
    R.block(12.55, 5.2, 0.22, 0.72);
    R.shelfWall('S', 0, { levels: 2, slots: 3, w: 2.4, y: 0.95, gap: 0.5 }).forEach((sp, i) => A('shelf:' + i, sp));

    // ---- light: 청사초롱 under the beams (four of them lend a pooled lamp), the stage lamp, a lamp at the door
    const lx = [-5.57, -1.86, 1.86, 5.57], lz = [-1.85, 2.15];
    for (const x of lx) for (const z of lz) {
      if (has('chorong')) K.chorong(R, { x, y: 4.6, z, hang: true, drop: 1.15 });
      else R.add('glow', geo.cyl(0.12, 0.12, 0.3, 10), M(x, 3.5, z), '#ffd9a8', { cast: false });
    }
    A('chorong', { x: -1.86, y: 2.25, z: 2.15 });
    for (const x of [-3.7, 3.7]) for (const z of lz) ctx.light({ x, y: 3.3, z, color: '#ffc07a', intensity: 5.5, distance: 11, decay: 1.6, flicker: 0.04, day: 0.2 });
    ctx.light({ x: 0, y: 3.4, z: -5.0, color: '#ffd29a', intensity: 7, distance: 13, decay: 1.6, day: 0.25 });
    ctx.light({ x: 0, y: 2.8, z: 7.0, color: '#ffb66a', intensity: 3.5, distance: 8, decay: 1.8, flicker: 0.05, day: 0.2 });
    K.dust(R, { count: 220 });
    R.finish();
  }
  P.define({
    id: 'PL_HALL', name: '본관 대강의실', kidName: '대강의실', emoji: '🎓', zoneId: 'ZONE_PL_HALL', color: '#d9b27a',
    desc: '무대와 큰 강의 화면이 있는 한옥 강당이에요. 방석에 앉아 강의를 들어요.',
    origin: { x: 1000, z: 2000 }, size: { w: 26, d: 16, h: 6.5 }, floorY: 0, surface: 'wood',
    spawn: { x: 0, z: 6.6, rotY: PI },
    door: doorHall ? { buildingId: 'B_HALL', x: doorHall.x, z: doorHall.z, label: '🚪 본관 대강의실 들어가기', kidLabel: '대강의실 가기' } : undefined,
    exit: doorHall ? doorHall.exit : undefined,
    indoor: true, camera: { dist: 6.2, min: 2.6, max: 9.0, pitch: 0.14, pmin: -0.1, pmax: 0.8, ceil: 4.2 }, far: 150,
    exhibits: topics([
      ['gangdang', '🏛️', '강당', '여럿이 모여 배우던 큰 마루집이에요.'], ['hyeonpan', '🪧', '현판', '건물 이름을 써서 건 널판이에요.'],
      ['seodang', '📖', '서당', '마을 아이들이 글을 배우던 곳이에요.'], ['chaekssisi', '🍡', '책씻이', '책 한 권을 다 떼면 떡을 나눠요.'],
      ['bangseok', '🟥', '방석', '바닥에 깔고 앉는 작은 자리예요.'], ['janggu', '🥁', '장구', '허리가 잘록한 북이에요.'],
      ['buk', '🪘', '북', '둥근 통에 가죽을 씌운 악기예요.'], ['chorong', '🏮', '청사초롱', '푸른 비단과 붉은 비단의 등불이에요.'],
      ['byeongpung', '🖼️', '병풍', '접었다 펴는 그림 가리개예요.'],
    ]),
    build: buildHall,
  });

  // =========================================================================================== 체험 교실 PL_EDU
  const doorEdu = P.doorOf('B_EDU', { side: -3.75 });
  function buildEdu(ctx) {
    const win = (p) => ({ window: p, w: 1.7, h: 1.4, sill: 0.85 }), winS = (p) => ({ window: p, w: 2.0, h: 1.4, sill: 0.8 });
    const R = K.room(ctx, {
      w: 16, d: 11, post: 2.9, ridge: 3.8, bays: { x: 5, z: 4 }, floor: 'maru', roof: 'rafters', tone: 'warm',
      walls: {
        N: ['plaster', 'plaster', 'plaster', 'plaster', 'plaster'],
        E: [win('ttisal'), win('jeongja'), win('ttisal'), 'plaster'],
        S: [winS('aja'), winS('yongja'), { door: 'changho', exit: true, w: 1.7, h: 2.15 }, winS('yongja'), winS('aja')],
        W: ['plaster', 'plaster', 'plaster', 'plaster'],
      },
      sun: { az: 160, el: 32 },
    });
    const A = (key, spot) => ctx.anchor(key, spot);

    // ---- the screen wall: the lecture screen in the middle, two motion boards (the year of 장, the microbes)
    lectureScreen(R, ctx, { side: 'N', u: 8, v: 1.72, w: 2.8, n: 0.08, top: 2.86 });
    for (const [u, id, title] of [[2.6, 'MG_JANG_YEAR', '장 담그기 열두 달'], [13.4, 'MG_MICROBE', '작은 일꾼 미생물']]) {
      const p = R.wp('N', u, 1.62, 0.05);
      ctx.board(id, { x: p.x, y: p.y, z: p.z, rotY: 0, w: 1.7, h: 0.96, title });
    }

    // ---- the teacher's work table (standing height) and the 화덕 with the 가마솥
    const tt = K.table(R, { x: -0.4, z: -3.5, w: 2.6, d: 0.8, h: 0.74, legs: 'straight', tone: '#7a4a2c' }).top;
    if (has('hamjibak')) K.hamjibak(R, { x: -1.15, y: tt, z: -3.5, r: 0.34, h: 0.15, fill: 'kong' });
    A('kong', { x: -1.15, y: tt + 0.25, z: -3.3 });
    if (has('brineBasin')) K.brineBasin(R, { x: -0.05, y: tt, z: -3.55, r: 0.27 });
    A('gyeran', { x: -0.05, y: tt + 0.28, z: -3.3 });
    if (has('bagaji')) K.bagaji(R, { x: 0.55, y: tt, z: -3.3, r: 0.1 });
    if (has('mejuBlock')) for (let i = 0; i < 3; i++) K.mejuBlock(R, M(0.45 + i * 0.27, tt + 0.1, -3.7, 0.1 * i), R.rnd, {});
    R.block(-0.4, -3.5, 1.32, 0.42, { maxY: 0.8 });
    // 화덕: a ring of stones with a small fire, the 가마솥 on top, steam
    const hx = 2.6, hz = -3.75;
    K.block(R, { x: hx, z: hz, w: 0.95, h: 0.42, d: 0.95, mat: 'stone', tint: '#8f877a', bevel: 0.05 });
    K.block(R, { x: hx, z: hz + 0.49, w: 0.42, h: 0.06, d: 0.04, mat: 'stone', tint: '#6f675c' });
    K.pot(R, { kind: 'sot', x: hx, y: 0.42, z: hz, s: 0.78, lid: true });
    K.fire(R, { x: hx, y: 0.06, z: hz + 0.44, s: 0.45, intensity: 5, distance: 6 });
    K.steam(R, { x: hx + 0.05, y: 0.42 + 0.4, z: hz, s: 0.7, count: 9 });
    R.block(hx, hz, 0.5, 0.5, { maxY: 0.85 });
    R.planItem(hx, hz, 0.95, 0.95, 'rgba(120,110,100,.9)');

    // ---- four low work tables with 방석, each with the tools and ingredients of one step
    const tabs = [[-3.6, -0.7], [3.4, -0.7], [-3.6, 2.4], [3.4, 2.4]];
    const ct = [['#2c4a6e', '#c9a24a'], ['#7e3a2c', '#c49a40'], ['#2f6a58', '#c9a24a'], ['#a8322c', '#2f4a80']];
    tabs.forEach(([x, z], i) => {
      const top = K.table(R, { x, z, w: 2.0, d: 0.95, h: 0.42, legs: 'straight', tone: i % 2 ? '#7a4a2c' : '#6e4128' }).top;
      for (const sx of [-0.55, 0.55]) for (const sz of [-1, 1]) K.cushion(R, { x: x + sx, z: z + sz * 0.88, w: 0.5, d: 0.5, h: 0.08, tint: ct[(i + (sz > 0 ? 1 : 0)) % 4][0], trim: ct[i][1] });
      R.block(x, z, 1.02, 0.5, { maxY: 0.46 });
      R.planItem(x, z, 2.0, 0.95, 'rgba(170,120,75,.85)');
      if (i === 0) {          // 소금 and the salt water
        if (has('hamjibak')) K.hamjibak(R, { x: x - 0.45, y: top, z, r: 0.26, h: 0.12, fill: 'salt' });
        A('sogeum', { x: x - 0.45, y: top + 0.25, z: z + 0.15 });
        if (has('brineBasin')) K.brineBasin(R, { x: x + 0.35, y: top, z: z - 0.05, r: 0.24 });
        if (has('bagaji')) K.bagaji(R, { x: x + 0.78, y: top, z: z + 0.25, r: 0.09 });
      } else if (i === 1) {   // 메주 빚기: beans, a mash of beans, blocks in a row
        if (has('hamjibak')) K.hamjibak(R, { x: x - 0.5, y: top, z, r: 0.3, h: 0.14, fill: 'kong' });
        if (has('mejuBlock')) for (let k = 0; k < 4; k++) K.mejuBlock(R, M(x + 0.15 + k * 0.27, top + 0.1, z + 0.05, (k % 2) * 0.12), R.rnd, {});
        A('mejubitgi', { x: x + 0.5, y: top + 0.3, z: z + 0.2 });
      } else if (i === 2) {   // 고추장: 엿기름 and flour in basins, a 단지 to fill
        if (has('hamjibak')) { K.hamjibak(R, { x: x - 0.5, y: top, z, r: 0.25, h: 0.12, fill: 'flour', tint: '#a9774a' }); K.hamjibak(R, { x: x + 0.1, y: top, z: z - 0.08, r: 0.22, h: 0.11, fill: 'meju' }); }
        K.pot(R, { kind: 'danji', x: x + 0.66, y: top, z: z + 0.05, s: 0.75, lid: false, tint: '#7a4a2c' });
        A('yeotgireum', { x: x - 0.5, y: top + 0.25, z: z + 0.2 });
      } else {                // the 바가지 and the 키 of beans
        if (has('bagaji')) { K.bagaji(R, { x: x - 0.55, y: top, z: z - 0.1, r: 0.12 }); K.bagaji(R, { x: x - 0.25, y: top, z: z + 0.2, r: 0.1, tint: '#cdb77c' }); }
        K.basket(R, { x: x + 0.4, y: top, z, kind: 'ki', r: 0.26, rotY: 0.3 });
        if (has('kongPile')) K.kongPile(R, { x: x + 0.4, y: top + 0.03, z: z + 0.05, r: 0.12, n: 30 });
        A('bagaji', { x: x - 0.45, y: top + 0.25, z: z + 0.1 });
      }
    });

    // ---- shelves of small 단지 along the west wall
    for (const sz of [-2.6, 0.2, 3.0]) {
      const spots = K.shelf(R, { x: -7.55, z: sz, rotY: PI / 2, w: 1.5, d: 0.4, h: 1.7, levels: 4, back: true });
      fillShelf(spots, PI / 2, 1.3, 3, (p, k, l) => {
        const kinds = ['danji', 'hangari', 'danji', 'bottle'];
        const kind = kinds[(k + l) % 4];
        if (kind === 'bottle') K.pot(R, { kind, x: p.x, y: p.y, z: p.z, s: 0.75, tint: (k + l) % 2 ? '#e9e4d6' : '#5a4030' });
        else K.pot(R, { kind, x: p.x, y: p.y, z: p.z, s: kind === 'hangari' ? 0.34 : 0.55 + ((k * 7 + l) % 3) * 0.08, lid: (k + l) % 3 !== 1, tint: ['#6e3f24', '#7a4a2c', '#5e3620'][(k + l * 2) % 3] });
      });
      R.block(-7.55, sz, 0.22, 0.77, { maxY: 1.75 });
    }
    A('danji', { x: -7.0, y: 1.1, z: 0.2 });

    // ---- 메주 on straw rope in the north-east corner (they sway), the class 독 with a 용수, straw and water
    if (has('mejuRack')) { K.mejuRack(R, { x: 6.8, z: -4.75, rotY: 0, w: 1.9, h: 2.3, rows: [1.55, 2.05], per: 3 }); R.block(6.8, -4.75, 1.0, 0.25, { maxY: 2.3 }); }
    const dx = 6.6, dz = 3.9;
    K.pot(R, { kind: 'dok', x: dx, z: dz, s: 1.0 });
    // the 용수: a tall basket of split bamboo pushed down into the jar
    R.add('basket', geo.cyl(0.13, 0.11, 0.72, 12, true), M(dx, 0.98, dz), '#b59a62');
    R.add('basket', new THREE.TorusGeometry(0.13, 0.012, 5, 16).applyMatrix4(new THREE.Matrix4().makeRotationX(PI / 2)), M(dx, 1.34, dz), '#8f7442', { cast: false });
    R.add('lacquer', new THREE.CircleGeometry(0.29, 20).applyMatrix4(new THREE.Matrix4().makeRotationX(-PI / 2)), M(dx, 1.12, dz), '#3a2416', { cast: false });
    if (has('geumjul')) K.geumjul(R, { x: dx, z: dz, s: 1.0, kind: 'dok' });
    A('yongsu', { x: dx - 0.3, y: 1.35, z: dz - 0.35 });
    K.straw(R, { x: 5.3, z: 4.4, kind: 'bundle', s: 0.95, rotY: 0.5 });
    K.straw(R, { x: 5.0, z: 3.7, kind: 'bundle', s: 0.8, rotY: -0.3 });
    if (has('smoke')) K.smoke(R, { x: 5.25, y: 0.35, z: 4.2, s: 0.5 });
    A('doksodok', { x: 5.2, y: 0.7, z: 4.0 });
    R.block(dx, dz, 0.45, 0.45, { maxY: 1.35 });
    R.block(5.2, 4.05, 0.55, 0.45, { maxY: 0.5 });
    if (has('mulDumeong')) { K.mulDumeong(R, { x: -6.7, z: 4.4, s: 0.9 }); R.block(-6.7, 4.4, 0.5, 0.5, { maxY: 0.8 }); }
    R.shelfWall('E', 3, { levels: 2, slots: 3, w: 2.0, y: 0.95, gap: 0.5 }).forEach((sp, i) => A('shelf:' + i, sp));

    // ---- light: four soft lamps over the tables, the fire of the 화덕; dust in the window sun
    for (const [x, z] of tabs) ctx.light({ x, y: 2.5, z, color: '#ffc98a', intensity: 4.2, distance: 8, decay: 1.7, flicker: 0.03, day: 0.15 });
    for (const [x, z] of tabs) R.add('glow', geo.cyl(0.13, 0.13, 0.32, 10), M(x, 2.62, z), '#ffd9a8', { cast: false });
    for (const [x, z] of tabs) R.add('iron', geo.tube(x, 2.78, z, x, 3.1, z, 0.005, 4), null, null, { cast: false });
    K.dust(R, { count: 150 });
    R.finish();
  }
  P.define({
    id: 'PL_EDU', name: '체험 교실', kidName: '체험 교실', emoji: '🧑‍🏫', zoneId: 'ZONE_PL_EDU', color: '#c9a273',
    desc: '콩과 소금과 물로 장 담그기를 직접 배워 보는 교실이에요.',
    origin: { x: 1200, z: 2000 }, size: { w: 16, d: 11, h: 3.8 }, floorY: 0, surface: 'wood',
    spawn: { x: 0, z: 4.3, rotY: PI },
    door: doorEdu ? { buildingId: 'B_EDU', x: doorEdu.x, z: doorEdu.z, label: '🚪 체험 교실 들어가기', kidLabel: '체험 교실 가기' } : undefined,
    exit: doorEdu ? doorEdu.exit : undefined,
    indoor: true, camera: { dist: 5.2, min: 2.4, max: 7.2, pitch: 0.15, pmin: -0.1, pmax: 0.8, ceil: 2.7 }, far: 150,
    exhibits: topics([
      ['kong', '🫘', '메주콩', '장은 콩에서 시작해요.'], ['sogeum', '🧂', '소금', '장에는 간수를 뺀 소금을 써요.'],
      ['gyeran', '🥚', '달걀 띄우기', '달걀이 떠오르면 소금물이 알맞아요.'], ['mejubitgi', '🟫', '메주 빚기', '삶은 콩을 찧어 네모나게 빚어요.'],
      ['yeotgireum', '🌾', '엿기름', '싹 틔운 보리로 단맛을 내요.'], ['bagaji', '🥣', '바가지', '박을 반으로 갈라 만든 그릇이에요.'],
      ['yongsu', '🧺', '용수', '독에 박아 맑은 장을 떠내요.'], ['doksodok', '🔥', '독 준비', '장 담글 독을 깨끗이 소독해요.'],
      ['danji', '🏺', '단지', '배가 부르고 목이 짧은 작은 항아리예요.'],
    ]),
    build: buildEdu,
  });

  // =========================================================================================== 숙성 저장고 PL_STORAGE
  const doorSto = P.doorOf('B_STORAGE');
  /** "내 장독 판": the player's twelve jars as they are (41-fermentation, read-only); redrawn only when they change */
  function myJarsBoard(ctx, R, side, u, v) {
    const low = !!ctx.low, cw = low ? 512 : 1024, ch = low ? 288 : 576, k = cw / 1024;
    const tex = G.gfx.canvasTexture(cw, ch, () => {}, { full: true });
    ctx.own(tex);
    const mt = new THREE.MeshBasicMaterial({ map: tex, color: 0xe6e0d4, fog: false });
    ctx.own(mt);
    const bw = 2.1, bh = bw * ch / cw, p = R.wp(side, u, v, 0.07), rotY = YAW[side];
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(bw, bh), mt);
    mesh.position.copy(p); mesh.rotation.y = rotY; mesh.name = 'room-myjars'; mesh.userData.guardSkip = true;
    R.addMesh(mesh, side);
    // a wooden frame round it, two pegs
    for (const [du, dv, w, h] of [[0, bh / 2 + 0.04, bw + 0.16, 0.07], [0, -bh / 2 - 0.04, bw + 0.16, 0.07], [-bw / 2 - 0.045, 0, 0.07, bh + 0.02], [bw / 2 + 0.045, 0, 0.07, bh + 0.02]]) R.add('furn', K.geo.slab(w, h, 0.05, 0.008), R.wm(side, u + du, v + dv, 0.055), '#5a3822', { wall: side });
    const rr = (c, x, y, w, h, r) => { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); };
    const read = () => {
      const F = G.sys.fermentation, out = [];
      for (let i = 1; i <= 12; i++) {
        const id = 'J' + i;
        let j = null, lock = null;
        try { j = F?.getJar?.(id) || null; } catch (e) { j = null; }
        try { lock = F?.lockOf?.(id) || null; } catch (e) { lock = null; }
        if (!j) { out.push({ id, none: true }); continue; }
        const st = String(j.status || ''), owned = !!j.owned || id === 'J1';
        out.push({ id, owned, lock, st, name: String(j.recipe?.name || ''), status: String(j.statusName || ''), p: Math.max(0, Math.min(100, Math.floor(Number(j.progress) || 0))) });
      }
      return out;
    };
    const draw = (rows) => {
      const c = tex.image.getContext('2d');
      c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, cw, ch); c.scale(k, k);
      const W = 1024, H = 576;
      const g = c.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#efe4cc'); g.addColorStop(1, '#ddcca9');
      c.fillStyle = g; c.fillRect(0, 0, W, H);
      c.strokeStyle = 'rgba(90,60,30,.5)'; c.lineWidth = 6; c.strokeRect(10, 10, W - 20, H - 20);
      c.fillStyle = '#3e2b1a'; c.textAlign = 'left'; c.textBaseline = 'middle';
      c.font = `800 44px ${FONT}`; c.fillText('내 장독 판', 40, 56);
      c.font = `600 22px ${FONT}`; c.fillStyle = '#6d4f30'; c.fillText('장독대에 있는 내 독 열두 개가 지금 어떤지 보여 줘요', 286, 60);
      const cols = 4, gx = 40, gy = 100, cwd = (W - gx * 2) / cols, chh = (H - gy - 26) / 3;
      rows.forEach((r, i) => {
        const x = gx + (i % cols) * cwd, y = gy + Math.floor(i / cols) * chh;
        rr(c, x + 6, y + 6, cwd - 12, chh - 12, 14);
        const busy = !r.none && r.owned && !r.lock && r.st && r.st !== 'EMPTY' && r.st !== 'CLAIMED';
        c.fillStyle = r.lock ? 'rgba(80,70,60,.16)' : busy ? 'rgba(255,250,236,.75)' : 'rgba(255,250,236,.42)'; c.fill();
        c.strokeStyle = 'rgba(90,60,30,.3)'; c.lineWidth = 2; c.stroke();
        // a small jar (brown; grey when locked)
        const jx = x + 46, jy = y + chh / 2 - 4;
        c.fillStyle = r.lock ? '#8a8178' : '#824e32';
        c.beginPath(); c.ellipse(jx, jy + 8, 22, 26, 0, 0, TAU); c.fill();
        c.fillRect(jx - 12, jy - 24, 24, 10); c.fillStyle = r.lock ? '#77706a' : '#6e4026'; c.fillRect(jx - 17, jy - 29, 34, 7);
        if (r.lock) {   // a padlock drawn, not an emoji (canvas fonts may lack it)
          c.strokeStyle = '#4a4038'; c.lineWidth = 4; c.beginPath(); c.arc(jx, jy + 2, 8, PI, 0); c.stroke();
          c.fillStyle = '#4a4038'; c.fillRect(jx - 11, jy + 2, 22, 16);
        }
        c.fillStyle = '#3e2b1a'; c.font = `800 26px ${FONT}`; c.textAlign = 'left';
        c.fillText(r.id.replace('J', '') + '번 독', x + 80, y + 34);
        c.font = `600 21px ${FONT}`; c.fillStyle = '#5a4128';
        let line1 = '', line2 = '';
        if (r.none || !r.owned) { line1 = r.lock ? '잠겨 있어요' : '아직 내 독이 아니에요'; }
        else if (r.lock) { line1 = r.name || '빈 독'; line2 = '잠겨 있어요 · 그대로 있어요'; }
        else if (!busy) { line1 = '비어 있어요'; line2 = r.st === 'CLAIMED' ? '다 받았어요' : '장독대에서 담가요'; }
        else { line1 = r.name || '익어 가요'; line2 = r.status; }
        const fit = (t, mw) => { let s = String(t); while (s.length > 1 && c.measureText(s).width > mw) s = s.slice(0, -1); return s === String(t) ? s : s.slice(0, -1) + '…'; };
        c.fillText(fit(line1, cwd - 100), x + 80, y + 66);
        if (busy) {
          const bx = x + 80, bwid = cwd - 110, by = y + 86;
          rr(c, bx, by, bwid, 16, 8); c.fillStyle = 'rgba(80,55,30,.18)'; c.fill();
          if (r.p > 0) { rr(c, bx, by, Math.max(16, (bwid * r.p) / 100), 16, 8); c.fillStyle = r.st === 'COMPLETE' ? '#6f9a4a' : '#b9823e'; c.fill(); }
          c.font = `600 18px ${FONT}`; c.fillStyle = '#6d4f30'; c.fillText(fit(r.st === 'COMPLETE' ? '다 익었어요' : line2, cwd - 100), x + 80, y + 122);
        } else if (line2) { c.font = `600 18px ${FONT}`; c.fillStyle = '#7a5a38'; c.fillText(fit(line2, cwd - 100), x + 80, y + 96); }
      });
    };
    let sig = null, acc = 99;
    const tick = () => { const rows = read(), s = JSON.stringify(rows); if (s === sig) return; sig = s; draw(rows); tex.needsUpdate = true; };
    tick();
    const offs = ['ferment:started', 'ferment:claimed', 'entitle:changed'].map((ev) => G.bus.on(ev, () => { acc = 99; }));
    ctx.own({ dispose: () => { for (const off of offs) { try { off?.(); } catch (e) { /* gone */ } } } });
    R.onUpdate((dt) => { acc += dt; if (acc < 2) return; acc = 0; tick(); });
    return { x: p.x, y: p.y, z: p.z, w: bw, h: bh };
  }
  function buildStorage(ctx) {
    const shadowed = !!G.sys.engine?.indoorShadows;
    const bar = (o) => ({ baraji: true, w: 1.2, h: 0.55, sill: 2.05, open: 0.9, ...o });
    const R = K.room(ctx, {
      w: 16, d: 10, post: 3.0, ridge: 4.2, bays: { x: 5, z: 4 }, floor: 'earth', roof: 'rafters', tone: 'dark',
      walls: {
        N: ['clay', 'clay', 'clay', 'clay', 'clay'],
        E: ['clay', bar({ w: 1.0 }), 'clay', 'clay'],
        S: [bar(), bar({ label: '살창', sub: '바람과 빛이 드나들어요' }), { door: 'panel', exit: true, w: 1.7, h: 2.15 }, bar(), bar()],
        W: ['clay', 'clay', bar({ w: 1.0 }), 'clay'],
      },
      sun: { az: 200, el: 30 },
      light: { hemi: { sky: '#d4dbe2', ground: '#6b6358', intensity: shadowed ? 0.32 : 0.7 }, exposure: 0.95 },
    });
    const A = (key, spot) => ctx.anchor(key, spot);
    if (has('lightShafts')) K.lightShafts(R, { alpha: 0.05, color: '#ffe6c0', len: 6 });
    const stone = (x, z, w, d, h) => {
      K.block(R, { x, z, w, h, d, mat: 'stone', tint: '#9a9384', bevel: 0.035 });
      // a row of field stones along the front edge of the 단
      for (let t = -w / 2 + 0.2; t < w / 2 - 0.1; t += 0.42 + R.rnd() * 0.08) K.block(R, { x: x + t, z: z + d / 2 - 0.02, w: 0.36, h: h * 0.9, d: 0.16, mat: 'stone', tint: R.rnd() < 0.5 ? '#8c8576' : '#a29a8a', bevel: 0.04 });
      R.planItem(x, z, w, d, 'rgba(120,115,105,.9)');
    };

    // ---- the north row: eight great 독 on a stone 단 (one stands open: 간장 with 숯 and 고추 afloat)
    const nz = -3.9, nh = 0.3;
    stone(0, nz, 14.8, 1.35, nh);
    const big = 1.08, openI = 2;
    for (let i = 0; i < 8; i++) {
      const x = -6.3 + i * 1.8;
      K.pot(R, { kind: 'dok', x, y: nh, z: nz, s: big + ((i * 5) % 3) * 0.03, lid: i !== openI, tint: i % 3 ? null : '#6d4026' });
      if (has('geumjul') && (i === 4 || i === 6)) K.geumjul(R, { x, y: nh, z: nz, s: big + ((i * 5) % 3) * 0.03, kind: 'dok' });
    }
    const ox = -6.3 + openI * 1.8, sy = nh + 1.2 * big - 0.07;
    R.add('lacquer', new THREE.CircleGeometry(0.3 * big, 22).applyMatrix4(new THREE.Matrix4().makeRotationX(-PI / 2)), M(ox, sy, nz), '#2a1a10', { cast: false });
    for (let k = 0; k < 4; k++) R.add('paint', K.geo.slab(0.09, 0.03, 0.05, 0.01), M(ox - 0.1 + k * 0.07, sy + 0.012, nz + 0.06 - k * 0.04, k), '#1c1a18', { cast: false });
    for (let k = 0; k < 3; k++) R.add('lacquer', geo.cyl(0.012, 0.016, 0.1, 6).applyMatrix4(new THREE.Matrix4().makeRotationZ(PI / 2)), M(ox + 0.12 - k * 0.1, sy + 0.01, nz - 0.1 + k * 0.08, k * 0.9), '#a8231a', { cast: false });
    // the lid lies on the 단 beside the open jar
    K.pot(R, { kind: 'basin', x: ox + 0.86, y: nh, z: nz + 0.38, s: 0.62, tint: '#6d4026' });
    R.block(0, nz, 7.4, 0.68, { maxY: nh + 1.25 * big + 0.16 });
    A('dok', { x: -6.3, y: 1.3, z: nz + 0.55 });
    A('sukseong', { x: ox, y: sy + 0.15, z: nz + 0.45 });
    A('soraegi', { x: ox + 0.86, y: nh + 0.32, z: nz + 0.75 });
    // the ripple on the open jar: a faint ring that widens every few seconds (still under reduce motion)
    if (!ctx.low) {
      const rm = new THREE.MeshBasicMaterial({ color: 0xe8dccb, transparent: true, opacity: 0, depthWrite: false, fog: false });
      ctx.own(rm);
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.04, 0.052, 24).rotateX(-PI / 2), rm);
      ring.position.set(ox + 0.06, sy + 0.004, nz - 0.04); ring.name = 'room-ripple'; ring.renderOrder = 3; ring.userData.guardSkip = true;
      R.addMesh(ring, null);
      R.onUpdate((dt, t) => {
        if (G.settings?.reduceMotion) { rm.opacity = 0; return; }
        const ph = (t % 3.8) / 3.8;
        ring.scale.setScalar(1 + ph * 4.2); rm.opacity = 0.22 * (1 - ph) * Math.min(1, ph * 8);
      });
    }

    // ---- the middle island: 중두리 behind, 항아리 in front
    const iz = -0.4, ih = 0.25;
    stone(0, iz, 10.6, 1.9, ih);
    for (let i = 0; i < 7; i++) K.pot(R, { kind: 'jungduri', x: -4.5 + i * 1.5, y: ih, z: iz - 0.45, s: 1.0, lid: true, tint: i % 2 ? null : '#73442a' });
    for (let i = 0; i < 6; i++) K.pot(R, { kind: 'hangari', x: -3.75 + i * 1.5, y: ih, z: iz + 0.5, s: 0.9, lid: true });
    R.block(0, iz, 5.3, 0.95, { maxY: ih + 1.05 });
    A('jungduri', { x: -4.5, y: 1.25, z: iz - 1.0 });
    A('hangari', { x: 3.75, y: 1.15, z: iz + 1.05 });

    // ---- the south rows: small jars (west) and 젓갈 독 tied with cloth (east), the door between them
    const sz = 3.65, sh = 0.2;
    stone(-5.0, sz, 4.9, 1.1, sh);
    for (let i = 0; i < 6; i++) K.pot(R, { kind: i % 2 ? 'hangari' : 'danji', x: -7.0 + i * 0.8, y: sh, z: sz, s: i % 2 ? 0.66 : 1.15, lid: true, tint: i % 3 ? null : '#7a4a2c' });
    R.block(-5.0, sz, 2.45, 0.55, { maxY: sh + 0.8 });
    stone(5.0, sz, 4.9, 1.1, sh);
    for (let i = 0; i < 4; i++) {
      const x = 3.25 + i * 1.15, s = 0.82;
      K.pot(R, { kind: 'jungduri', x, y: sh, z: sz, s });
      // a cloth tied over the mouth instead of a lid
      const cg = new THREE.SphereGeometry(0.33 * s, 14, 6, 0, TAU, 0, PI / 2); cg.scale(1, 0.32, 1);
      R.add('cloth', cg, M(x, sh + 0.9 * s - 0.01, sz), i % 2 ? '#e4dccb' : '#d8cfbd');
      R.add('cloth', new THREE.TorusGeometry(0.3 * s, 0.012, 4, 16).applyMatrix4(new THREE.Matrix4().makeRotationX(PI / 2)), M(x, sh + 0.86 * s, sz), '#7a2e22', { cast: false });
    }
    R.block(5.0, sz, 2.45, 0.55, { maxY: sh + 0.95 });
    A('jeotgal', { x: 4.4, y: 1.15, z: sz - 0.6 });

    // ---- a shelf of 장아찌 단지 on the west wall; "내 장독 판" on the east wall
    const ws = K.shelf(R, { x: -7.55, z: -0.4, rotY: PI / 2, w: 1.6, d: 0.42, h: 1.8, levels: 3, back: true });
    fillShelf(ws, PI / 2, 1.4, 3, (p, k, l) => K.pot(R, { kind: l === 2 ? 'bottle' : 'danji', x: p.x, y: p.y, z: p.z, s: l === 2 ? 0.8 : 0.62 + (k % 2) * 0.1, lid: l !== 2, tint: l === 2 ? '#4a3424' : (k + l) % 2 ? '#6e3f24' : '#7a4a2c' }));
    R.block(-7.55, -0.4, 0.23, 0.82, { maxY: 1.85 });
    A('jangajji', { x: -7.0, y: 1.1, z: -0.4 });
    const jb = myJarsBoard(ctx, R, 'E', 5.0, 1.62);
    A('ttukkeong', { x: jb.x - 0.5, y: 1.0, z: jb.z + 0.9 });
    R.shelfWall('E', 3, { levels: 2, slots: 3, w: 1.9, y: 0.95, gap: 0.5 }).forEach((sp, i) => A('shelf:' + i, sp));

    // ---- light: two lanterns inside the door (warm), a cool fill over the jars; dust in the shafts
    for (const x of [-1.5, 1.5]) {
      if (has('chorong')) K.chorong(R, { x, y: 3.0, z: 4.3, hang: true, drop: 0.7 });
      else R.add('glow', geo.cyl(0.1, 0.1, 0.26, 10), M(x, 2.3, 4.3), '#ffd9a8', { cast: false });
    }
    ctx.light({ x: 0, y: 2.25, z: 4.1, color: '#ffb66a', intensity: 3.4, distance: 7.5, decay: 1.8, flicker: 0.06, day: 0.25 });
    ctx.light({ x: -2.5, y: 2.7, z: -1.8, color: '#cfd8e2', intensity: 2.4, distance: 11, decay: 1.5, day: 0.08 });
    ctx.light({ x: 3.5, y: 2.7, z: -1.8, color: '#cfd8e2', intensity: 2.4, distance: 11, decay: 1.5, day: 0.08 });
    K.dust(R, { count: 200 });
    R.finish();
  }
  P.define({
    id: 'PL_STORAGE', name: '숙성 저장고', kidName: '숙성 저장고', emoji: '🏺', zoneId: 'ZONE_PL_STORAGE', color: '#9c8a74',
    desc: '큰 독들이 줄지어 서서 장을 천천히 익히는 서늘한 곳이에요. 내 장독도 판에서 볼 수 있어요.',
    origin: { x: 1400, z: 2000 }, size: { w: 16, d: 10, h: 4.2 }, floorY: 0, surface: 'dirt',
    spawn: { x: 0, z: 3.7, rotY: PI },
    door: doorSto ? { buildingId: 'B_STORAGE', x: doorSto.x, z: doorSto.z, label: '🚪 숙성 저장고 들어가기', kidLabel: '저장고 구경' } : undefined,
    exit: doorSto ? doorSto.exit : undefined,
    indoor: true, camera: { dist: 5.2, min: 2.4, max: 7.4, pitch: 0.16, pmin: -0.1, pmax: 0.8, ceil: 2.75 }, far: 150,
    exhibits: topics([
      ['dok', '🏺', '독', '옹기 가운데 키가 큰 저장 그릇이에요.'], ['hangari', '🫙', '항아리', '아래위가 좁고 배가 불룩해요.'],
      ['jungduri', '⚱️', '중두리', '독보다 조금 작고 배가 불러요.'], ['soraegi', '🍽️', '소래기', '독 뚜껑은 굽 없는 접시 모양이에요.'],
      ['sukseong', '⚫', '숯과 고추 띄우기', '간장 독에는 숯과 붉은 고추를 띄워요.'], ['jeotgal', '🦐', '젓갈', '소금에 절여 삭힌 음식이에요.'],
      ['jangajji', '🥒', '장아찌', '채소를 장에 박아 오래 두고 먹어요.'], ['ttukkeong', '☀️', '뚜껑과 볕', '맑은 날 뚜껑을 열어 볕을 쬐어요.'],
    ]),
    build: buildStorage,
  });

  // =========================================================================================== 전통 가게 PL_SHOP
  const doorShop = P.doorOf('B_SHOP', { side: 3.6, out: -1.2 });
  function buildShop(ctx) {
    const R = K.room(ctx, {
      w: 12, d: 9, post: 2.7, ridge: 3.4, bays: { x: 3, z: 3 }, floor: 'stone', roof: 'rafters', tone: 'warm',
      walls: {
        N: ['plaster', 'plaster', 'plaster'],
        E: ['plaster', { window: 'ttisal', w: 1.6, h: 1.2, sill: 0.85 }, 'plaster'],
        S: [{ window: 'jeongja', w: 2.6, h: 1.3, sill: 0.75 }, { door: 'changho', exit: true, w: 1.7, h: 2.1 }, { window: 'jeongja', w: 2.6, h: 1.3, sill: 0.75 }],
        W: ['plaster', 'plaster', 'plaster'],
      },
      sun: { az: 170, el: 34 },
    });
    const A = (key, spot) => ctx.anchor(key, spot);

    // ---- the counter (계산대): a long panelled chest facing the customers, and what lies on it
    const cz = -1.3, ch = 0.92;
    K.chest(R, { x: 0, z: cz, w: 5.0, d: 0.66, h: ch, doors: 6, drawers: 0, legs: 0.05, fittings: false, tone: '#8a5a36', frameTone: '#5a3822', panelTone: '#9a6a42' });
    R.block(0, cz, 2.55, 0.36, { maxY: ch + 0.05 });
    const top = ch + 0.03;
    if (has('jupan')) K.jupan(R, { x: -1.7, y: top, z: cz + 0.08, rotY: 0.12 });
    A('jupan', { x: -1.7, y: top + 0.25, z: cz + 0.4 });
    if (has('yeopjeon')) K.yeopjeon(R, { x: -0.75, y: top, z: cz + 0.05 });
    A('yeopjeon', { x: -0.75, y: top + 0.25, z: cz + 0.4 });
    if (has('yeotpan')) K.yeotpan(R, { x: 0.55, y: top, z: cz - 0.02 });
    A('yeot', { x: 0.55, y: top + 0.25, z: cz + 0.4 });
    if (has('books')) K.books(R, { x: 1.6, y: top, z: cz - 0.05, w: 0.2, d: 0.28, n: 2, seed: 3, rotY: -0.2 });
    A('jangteo', { x: -2.3, y: top + 0.1, z: cz + 0.55 });
    if (has('chorong')) K.chorong(R, { x: 2.25, y: top, z: cz - 0.05 });
    // the counter opens the shop screen (the same as the stall outside)
    ctx.interact({
      id: 'PL_SHOP:counter', kind: 'shop', label: '🛒 가게 이용하기', kidLabel: '가게 열기', emoji: '🛒', radius: 3.0, priority: 0.5,
      position: { x: 0, y: 1.1, z: cz + 0.6 },
      onInteract: () => {
        const I = G.sys.inventory;
        try {
          if (I && typeof I.openShop === 'function') I.openShop('SHOP_GENERAL');
          else G.ui?.toast?.('가게 문을 여는 중이에요. 조금만 기다려 주세요.', { type: 'info', emoji: '🛒' });
        } catch (e) { G.log.warn('UI', 'shop screen failed', e?.message || e); }
      },
    });

    // ---- shelves of goods behind the counter, the shop's name board over them
    const shelfX = [-3.4, 0, 3.4];
    shelfX.forEach((sx, si) => {
      const spots = K.shelf(R, { x: sx, z: -4.05, w: 1.8, d: 0.42, h: 2.0, levels: 4, back: true });
      fillShelf(spots, 0, 1.6, si === 1 ? 4 : 3, (p, k, l) => {
        if (l === 0) K.pot(R, { kind: k % 2 ? 'hangari' : 'danji', x: p.x, y: p.y, z: p.z, s: k % 2 ? 0.4 : 0.66, lid: true, tint: ['#6e3f24', '#7a4a2c', '#5e3620'][(k + si) % 3] });
        else if (l === 1) K.pot(R, { kind: 'bottle', x: p.x, y: p.y, z: p.z, s: 0.82, tint: (k + si) % 3 === 0 ? '#e9e4d6' : (k + si) % 3 === 1 ? '#4a3424' : '#7a5a3a' });
        else if (l === 2) { if (has('bojagi')) K.bojagi(R, { x: p.x, y: p.y, z: p.z, w: 0.28, h: 0.17, tint: ['#a8322c', '#2f4a80', '#c9a24a', '#2f6a58'][(k + si) % 4], trim: '#e9dcc0' }); }
        else if (has('dish') && k % 2 === 0) K.dish(R, { x: p.x, y: p.y, z: p.z, kind: (k + si) % 4 ? 'yakgwa' : 'tteok' });
        else K.basket(R, { x: p.x, y: p.y, z: p.z, r: 0.16, h: 0.14 });
      });
      R.block(sx, -4.05, 0.92, 0.23, { maxY: 2.05 });
    });
    R.label('전통 가게', { side: 'N', u: 6, v: 2.28, n: 0.09, w: 1.6, h: 0.32, style: 'wood' });
    A('ojangnal', { x: 0, y: 1.6, z: -3.5 });
    A('bojagi', { x: -3.4, y: 1.45, z: -3.55 });

    // ---- the west wall: a shelf of 짚신, 가마니, 되와 말, a jar of 간장 with a 바가지, baskets of beans
    R.shelfWall('W', 1, { levels: 2, slots: 4, w: 2.6, y: 0.9, gap: 0.6 }).forEach((sp, i) => {
      if (i < 4) { if (has('jipsin')) K.jipsin(R, { x: sp.x + 0.02, y: sp.y, z: sp.z, rotY: PI / 2 }); }
      else if (i === 5) K.basket(R, { x: sp.x, y: sp.y, z: sp.z, kind: 'ki', r: 0.2, rotY: PI / 2 });
      else K.basket(R, { x: sp.x, y: sp.y, z: sp.z, r: 0.17, h: 0.15 });
    });
    A('jipsin', { x: -5.3, y: 1.4, z: 0 });
    if (has('gamaniStack')) { K.gamaniStack(R, { x: -5.15, z: 2.9, rotY: PI / 2, rows: [2, 1] }); R.block(-5.15, 2.9, 0.5, 0.65, { maxY: 0.95 }); }
    if (has('doe')) { K.doe(R, { x: -4.3, z: 2.2, kind: 'mal', fill: 'bean' }); K.doe(R, { x: -4.0, z: 2.65, kind: 'doe', fill: 'rice', rotY: 0.4 }); }
    A('doemal', { x: -4.15, y: 0.6, z: 2.4 });
    K.pot(R, { kind: 'dok', x: -5.2, z: -1.6, s: 0.88, lid: true });
    if (has('bagaji')) K.bagaji(R, { x: -5.15, y: 0.88 * 1.25 + 0.12, z: -1.55, r: 0.11 });
    R.block(-5.2, -1.6, 0.42, 0.42, { maxY: 1.25 });
    K.basket(R, { x: -4.35, z: -0.7, r: 0.3, h: 0.22 });
    if (has('kongPile')) K.kongPile(R, { x: -4.35, y: 0.18, z: -0.7, r: 0.2, n: 40 });
    R.block(-4.35, -0.7, 0.3, 0.3, { maxY: 0.3 });

    // ---- the east side: a low display table with jars and bundles; a 저울 on the wall
    const dt = K.table(R, { x: 4.6, z: 2.0, w: 1.9, d: 0.85, h: 0.46, legs: 'straight', tone: '#7a4a2c' }).top;
    K.pot(R, { kind: 'danji', x: 4.0, y: dt, z: 2.0, s: 0.9, lid: true });
    K.pot(R, { kind: 'hangari', x: 4.6, y: dt, z: 1.85, s: 0.42, lid: true, tint: '#7a4a2c' });
    if (has('bojagi')) { K.bojagi(R, { x: 5.15, y: dt, z: 2.05, w: 0.32, h: 0.2, tint: '#2f6a58', trim: '#c9a24a' }); K.bojagi(R, { x: 4.7, y: dt, z: 2.3, w: 0.24, h: 0.15, tint: '#a8322c', trim: '#2f4a80' }); }
    R.block(4.6, 2.0, 0.97, 0.45, { maxY: 0.8 });
    R.planItem(4.6, 2.0, 1.9, 0.85, 'rgba(170,120,75,.85)');
    if (has('jeoul')) { K.jeoul(R, R.wm('E', 1.4, 2.05, 0.06), { wall: 'E' }); }
    A('jeoul', { x: 5.4, y: 1.35, z: -3.1 });

    // ---- by the door: a 지게 with a bundle (the pedlar's), a broom and straw shoes; 곶감 strings that sway
    if (has('jige')) K.jige(R, { x: -5.4, z: 3.95, rotY: PI });
    if (has('bojagi')) K.bojagi(R, { x: -4.75, z: 3.9, w: 0.42, h: 0.3, tint: '#8a6a3a', trim: '#5a3a24' });
    R.block(-5.1, 3.95, 0.6, 0.35, { maxY: 1.4 });
    A('bobusang', { x: -4.8, y: 1.0, z: 3.4 });
    if (has('broom')) K.broom(R, { x: 5.55, z: 4.1, rotY: PI });
    if (has('jipsin')) K.jipsin(R, { x: 4.95, z: 3.95, rotY: 0.3 });
    if (has('sway') && has('strings')) {
      for (const [x, z, ph] of [[2.8, 0.4, 0], [4.4, 0.4, 1.7]]) {
        const S = K.sway(R, { x, y: 2.62, z, amp: 0.035, speed: 0.5, phase: ph });
        K.strings(S, { x, y: 2.62, z, kind: 'gotgam', w: 1.0, drop: 0.24 });
        S.done();
      }
    }
    R.shelfWall('E', 2, { levels: 2, slots: 3, w: 2.2, y: 0.95, gap: 0.5 }).forEach((sp, i) => A('shelf:' + i, sp));

    // ---- light: 초롱 over the counter, the one standing on it, a lamp at the door; dust in the window sun
    for (const x of [-1.3, 1.3]) {
      if (has('chorong')) K.chorong(R, { x, y: 2.7, z: cz + 0.1, hang: true, drop: 0.55 });
      else R.add('glow', geo.cyl(0.1, 0.1, 0.26, 10), M(x, 2.1, cz + 0.1), '#ffd9a8', { cast: false });
    }
    ctx.light({ x: 0, y: 2.05, z: cz + 0.3, color: '#ffbf78', intensity: 5.5, distance: 9, decay: 1.7, flicker: 0.05, day: 0.25 });
    ctx.light({ x: 2.25, y: top + 0.75, z: cz - 0.05, color: '#ffb060', intensity: 3.0, distance: 6, decay: 1.9, flicker: 0.07, day: 0.3 });
    ctx.light({ x: 0, y: 2.2, z: 3.4, color: '#ffc98a', intensity: 3.0, distance: 7, decay: 1.8, day: 0.15 });
    K.dust(R, { count: 120 });
    R.finish();
  }
  P.define({
    id: 'PL_SHOP', name: '전통 가게', kidName: '전통 가게', emoji: '🏪', zoneId: 'ZONE_PL_SHOP', color: '#c98f5a',
    desc: '주판과 엽전, 짚신과 장 단지가 있는 옛 가게예요. 계산대에서 물건을 사고팔 수 있어요.',
    origin: { x: 1600, z: 2000 }, size: { w: 12, d: 9, h: 3.4 }, floorY: 0, surface: 'stone',
    spawn: { x: 0, z: 3.0, rotY: PI },
    door: doorShop ? { buildingId: 'B_SHOP', x: doorShop.x, z: doorShop.z, label: '🚪 전통 가게 들어가기', kidLabel: '전통 가게 가기' } : undefined,
    exit: doorShop ? doorShop.exit : undefined,
    indoor: true, camera: { dist: 4.8, min: 2.2, max: 6.6, pitch: 0.16, pmin: -0.1, pmax: 0.8, ceil: 2.5 }, far: 150,
    exhibits: topics([
      ['jangteo', '🧺', '장터', '물건을 사고팔던 시장이에요.'], ['ojangnal', '📅', '오일장', '닷새마다 장이 섰어요.'],
      ['bobusang', '🎒', '보부상', '봇짐과 등짐을 지고 다닌 상인이에요.'], ['yeopjeon', '🪙', '엽전', '가운데 네모 구멍이 난 옛날 돈이에요.'],
      ['jupan', '🧮', '주판', '알을 올리고 내려 셈을 해요.'], ['jeoul', '⚖️', '저울', '무게를 다는 도구예요.'],
      ['doemal', '🥣', '되와 말', '곡식을 담아 양을 재요.'], ['bojagi', '🎁', '보자기', '물건을 싸는 네모난 천이에요.'],
      ['jipsin', '👡', '짚신', '볏짚으로 삼은 신이에요.'], ['yeot', '🍬', '엿', '곡식을 엿기름으로 삭혀 고아 만들어요.'],
    ]),
    build: buildShop,
  });
})();
