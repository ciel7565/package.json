const CX = (G.complexParts = G.complexParts || { list: [], add(name, fn, order) { this.list.push({ name, fn, order: order == null ? 100 : order }); } });
// =============================================================================
// 54-complex-main.js — 만장대 본관 (the main building of 만장대 단지, PL_ALLOT), exterior. Track complex-main, CONTRACT §16.8.
//
// Look target: assets/reference/03-concept-main.webp — the modern-hanok hall left of centre: a stone-clad podium with wide steps,
// warm timber columns and beams framing floor-to-ceiling glass on every floor (the glass reflects sky and forest and shows warm
// interior light), balconies with timber 난간, a lower skirt roof round the core and a great 팔작 roof over the recessed top floor,
// lower wings stepping down at the sides, a projecting gabled entrance portico on columns.
//
// Data: G.data.complex.byId('B_MAIN') (src/game/33-complex-plan.js) — centre (−66, −18), parts core / wingW / wingE / portico, podium,
// floors, h, roofs, door (C.door, the way into PL_OFFICE), the side door to the corridor (doors[1]), the front stairs.
//
// SECTION (P = B_MAIN.y + podium)       1F  P … P+5.0      2F  … P+9.6 (T2)       skirt roof over the 2F wall line
//                                       3F  inset 2.8 m, floor = top of the skirt + 0.3 (≈ P+11.8) … P + core.h (15.8)
//                                       great roof: paljak, rise = core.roof.h, overhang = core.roof.overhang
//   wings: 1F P … P+5.0, 2F … P + wing.h; paljak ridge north–south (gables face south / north)
//   portico: round columns P … P + portico.h, paljak ridge north–south (its gable faces the stairs), 현판 "만장대"
//
// FORMS  base (always): podium, terrace, stairs, ramps, columns, beams, slabs, balconies, glass, roofs (kit G.bkit.roof), doors, 현판
//        near (camera < 200 m, medium / high): rafters (서까래), bracket sets (익공), real 난간 balusters, 합각 battens, lanterns,
//              banners, potted pines (G.sys.nature.grove), 장독 groups, rain chains (낙수 사슬)
//        far  (camera > 215 m, and always on low): the balustrades as one alpha-card run
//   low: base + far, flat colours (the kit's materials have no maps on low), a plain glass material, ≤ 12 draw calls.
// GLASS  one MeshStandardMaterial with an interior-mapping patch (medium / high): every pane looks into a fake room (floor,
//        warm ceiling with lamps, side walls, a back wall with displays, a display case / onggi jar / exhibit panel in the
//        middle ground, blinds) computed from the position on the facade — no interior geometry, one draw call. Mullions and
//        transoms are drawn by the same shader. Interior light = day level + the weather's lamp factor (registered with
//        G.world.addNightMaterial: emissiveIntensity = lamp factor), so the halls glow warm at dusk and at night.
// API    CX part 'main' (order 20) → { dispose(), update(dt, t) }.  G.complexMain (debug / tests): { built, lod, stats(),
//        door: { x, y, z }, sideDoor, terrace, setLod(name|null) }.
// Coordinates: PL_ALLOT local metres (x east, z south, y up = C.height). Walkable tops / interact heights are absolute y
// (the district's floor offset is 0).
// =============================================================================
CX.add('main', (ctx, C) => {
  const K = G.bkit, THREE_ = THREE;
  if (!K || !C || typeof C.byId !== 'function') throw new Error('complex-main: G.bkit / G.data.complex missing');
  const E = C.byId('B_MAIN');
  if (!E) throw new Error('complex-main: B_MAIN missing in the plan');
  const { geo, M, I4 } = K;
  const PI = Math.PI;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
  const quality = ctx.quality || G.sys.engine?.quality || 'low';
  const low = !!ctx.low || quality === 'low';
  const part = (id) => (E.parts || []).find((p) => p.id === id);
  const core = part('core'), wingW = part('wingW'), wingE = part('wingE'), por = part('portico');
  if (!core || !wingW || !wingE || !por) throw new Error('complex-main: B_MAIN parts missing');

  // ---------------------------------------------------------------- section
  const y0 = E.y, P = y0 + (E.podium || 1.2);
  const H1 = 5.0, H2 = 4.6, T1 = P + H1, T2 = T1 + H2;
  const SET = 2.8;                                                   // 3F set back behind the 2F wall line
  const cx = (core.x0 + core.x1) / 2, cz = (core.z0 + core.z1) / 2, chw = (core.x1 - core.x0) / 2, chd = (core.z1 - core.z0) / 2;
  const hw3 = chw - SET, hd3 = chd - SET;
  const coreTop = P + (core.h || 15.8);
  const wingTop = P + (wingW.h || 9.0);
  const porTop = P + (por.h || 6.0);
  const COL = { timber: '#b4794a', beam: '#8c5a36', band: '#6f4a30', dark: '#4e3322', stone: '#d3cdc1', coping: '#e2ddd3', plinth: '#b9b2a6', deck: '#c9986a', glassFrame: '#3b3a37', rail: '#7a4f30' };

  // ---------------------------------------------------------------- groups and bookkeeping
  const root = new THREE_.Group(); root.name = 'complex-main';
  const gBase = new THREE_.Group(); gBase.name = 'complex-main:base';
  const gNear = new THREE_.Group(); gNear.name = 'complex-main:near';
  const gFar = new THREE_.Group(); gFar.name = 'complex-main:far';
  root.add(gBase, gNear, gFar);
  ctx.group.add(root);
  const owned = [];                                // materials / textures made here (disposed by us; ctx.own as well)
  const own = (x) => { if (x) { owned.push(x); try { ctx.own?.(x); } catch (e) { /* older ctx */ } } return x; };
  const blockers = [];
  const nightMats = [];
  const disposers = [];
  const Bb = new K.Bucket(), Bn = new K.Bucket(), Bf = new K.Bucket();
  const glassQ = { pos: [], nor: [], room: [], room2: [], idx: [] };
  const groundAt = (x, z) => C.height(x, z);

  // ---------------------------------------------------------------- roof maths (mirror of G.bkit.roof's parametrisation; read-only use:
  // rafters under the soffit, rain-chain corners, 합각 battens)
  function roofMath(o) {
    const mode = o.mode || 'paljak', hw = o.hw, hd = o.hd, ov = o.ov ?? 1.5;
    const A = hw + ov, Cc = hd + ov, gable = mode === 'gable';
    const out = gable ? 0 : (o.out ?? 0.5), lift = o.lift ?? (gable ? 0.05 : 0.5);
    const H = o.rise ?? Cc * 0.7, k = o.k ?? 1.45, p = o.p ?? 2.4, t = o.t ?? 0.32;
    const rl = o.ridgeLift ?? Math.min(0.35, H * 0.08), yb = o.y ?? 0;
    let vg = 1, xw = 0, bo = o.bo ?? 0.4;
    if (mode === 'paljak') { vg = o.vg ?? 0.5; xw = A + out - vg * (Cc + out); } else if (mode === 'hip' || mode === 'skirt') { vg = 1; xw = Math.max(0, A - Cc); } else { vg = 0; xw = A; bo = 0; }
    const ux = (x) => Math.min(Math.abs(x) / A, 1.3);
    const bul = (x) => out * Math.pow(ux(x), p);
    const fz = (x, v) => (1 - v) * (Cc + bul(x));
    const liftAt = (x, v) => lift * Math.pow(ux(x), p) * (1 - v) * (1 - v) + rl * Math.pow(ux(x), 4) * Math.pow(Math.max(v, 0), 6);
    const fy = (x, v) => yb + H * Math.pow(Math.max(v, 0), k) + liftAt(x, v);
    const a = (v) => (A + out) - (v / (vg || 1)) * ((A + out) - xw);
    const sx = (s, v) => { const e = A + out * Math.pow(Math.abs(s), p); return e + (xw - e) * (v / (vg || 1)); };
    const sy = (s, v) => yb + H * Math.pow(Math.max(v, 0), k) + Math.pow(Math.abs(s), p) * liftAt(a(v), v);
    return { mode, hw, hd, A, C: Cc, out, H, k, p, t, y: yb, vg, xw, bo, bul, fz, fy, a, sx, sy };
  }
  /** the roof (kit) + its rafters (near) — `m` places the roof's local frame (ridge along local X, front +Z) */
  function hanokRoof(o, m, opts = {}) {
    const info = K.roof(Bb, m, o);
    const R = roofMath(o);
    if (!low && opts.rafters !== false) rafters(R, m, opts.rr || 0.09, opts.sp || 0.5);
    if (!low && R.mode === 'paljak' && opts.battens !== false) gableBattens(R, m);
    return { info, R };
  }
  function rafters(R, m, r, sp) {
    const add = (a, b) => Bn.add('wood', geo.tube(a[0], a[1], a[2], b[0], b[1], b[2], r, 6), m, COL.timber);
    // front / back slopes: straight runs over the wall line (the fanned corner rafters stay painted on the soffit)
    const lenX = 2 * R.hw - 0.5, nX = Math.max(1, Math.round(lenX / sp));
    for (let i = 0; i <= nX; i++) {
      const x = -R.hw + 0.25 + (lenX * i) / nX, Ce = R.C + R.bul(x), vw = clamp(1 - R.hd / Ce, 0, 1);
      if (Math.abs(x) > R.a(vw) - 0.15) continue;
      const ye = R.fy(x, 0) - R.t - r, yw = R.fy(x, vw) - R.t - r, ym = R.fy(x, vw / 2) - R.t - r;
      const drop = Math.max(0, (ye + yw) / 2 - ym) + 0.01;
      for (const mz of [1, -1]) add([x, ye - drop, Ce * mz * 0.992], [x, yw - drop, R.hd * mz]);
    }
    if (R.mode === 'gable') return;
    const lenZ = 2 * R.hd - 0.5, nZ = Math.max(1, Math.round(lenZ / sp));
    const sOf = (z, v) => z / R.fz(R.a(v), v);
    for (let i = 0; i <= nZ; i++) {
      const z = -R.hd + 0.25 + (lenZ * i) / nZ;
      const s0 = sOf(z, 0);
      if (Math.abs(s0) > 0.97) continue;
      let v = 0;
      for (let it = 0; it < 5; it++) { const s = sOf(z, v), e = R.A + R.out * Math.pow(Math.abs(s), R.p); v = clamp((R.vg || 1) * (e - R.hw) / Math.max(1e-3, e - R.xw), 0, R.vg || 1); }
      const xe = R.sx(s0, 0), ye = R.sy(s0, 0) - R.t - r;
      const yw = R.sy(sOf(z, v), v) - R.t - r, ym = R.sy(sOf(z, v / 2), v / 2) - R.t - r;
      const drop = Math.max(0, (ye + yw) / 2 - ym) + 0.01;
      for (const mx of [1, -1]) add([xe * mx * 0.992, ye - drop, z], [R.hw * mx, yw - drop, z]);
    }
  }
  /** vertical battens and a rail on the 합각 (gable triangle) of a paljak roof, both ends */
  function gableBattens(R, m) {
    const xg = R.xw, zBase = R.fz(R.xw, R.vg), zTopK = R.C + R.bul(xg);
    const step = 0.42, n = Math.floor((2 * zBase - 0.4) / step);
    for (const mx of [1, -1]) {
      for (let i = 1; i < n; i++) {
        const z = -zBase + 0.2 + i * step, s = z / zBase;
        const yt = R.fy(xg, 1 - Math.abs(z) / zTopK) - R.t * 0.6 - 0.12, yb = R.sy(s, R.vg) + 0.28;
        if (yt - yb < 0.25) continue;
        Bn.add('wood', geo.box(0.07, yt - yb, 0.09, 'grain'), K.mul(m, M(mx * (xg + 0.01), (yt + yb) / 2, z, PI / 2)), COL.dark);
      }
      // the rail across the gable foot (박공 하단 띠) and a small 지네철 crest
      const yRail = R.sy(0, R.vg) + 0.55;
      Bn.add('wood', geo.box(0.12, 0.14, 2 * zBase * 0.86), K.mul(m, M(mx * (xg + 0.04), yRail, 0)), COL.band);
      const yC = (R.fy(xg, 1) + yRail) / 2;
      Bn.add('paint', geo.box(0.05, 0.9, 0.9), K.mul(m, M(mx * (xg + 0.06), yC, 0, 0, 1, 1, 1, PI / 4)), '#e9e2d2');
    }
  }

  // ---------------------------------------------------------------- glass (interior-mapped)
  const ROOM_D = { 1: 8.5, 2: 7.0, 3: 6.0 };
  /** a glass run along (x0, z0) → (x1, z1) whose outward normal is (nx, nz); cells of width cw start at the run start */
  function glassRun(x0, z0, x1, z1, nx, nz, yb, yt, cw, depth, seed, inset = 0.12) {
    if (Math.hypot(x1 - x0, z1 - z0) < 0.3 || yt - yb < 0.3) return;
    const ox = -nx * inset, oz = -nz * inset, b = glassQ.pos.length / 3;
    glassQ.pos.push(x0 + ox, yb, z0 + oz, x1 + ox, yb, z1 + oz, x1 + ox, yt, z1 + oz, x0 + ox, yt, z0 + oz);
    for (let i = 0; i < 4; i++) glassQ.nor.push(nx, 0, nz);
    const u0 = (x0 + ox) * nz - (z0 + oz) * nx;                     // u = dot(p, T), T = (nz, 0, −nx)
    for (let i = 0; i < 4; i++) { glassQ.room.push(u0, yb, cw, yt - yb - 0.36); glassQ.room2.push(depth, seed); }
    glassQ.idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  const GLASS_VS_HEAD = /* glsl */`
    attribute vec4 aRoom; attribute vec2 aRoom2;
    varying vec4 vRoom; varying vec2 vRoom2; varying vec3 vRP; varying vec3 vRD;`;
  const GLASS_VS_BODY = /* glsl */`
    {
      vec3 cmN = normalize(objectNormal);
      vec3 cmT = normalize(vec3(cmN.z, 0.0, -cmN.x));
      vec3 cmCam = cameraPosition - vec3(modelMatrix[3]);
      vec3 cmD = transformed - cmCam;
      vRD = vec3(dot(cmD, cmT), cmD.y, -dot(cmD, cmN));
      vRP = vec3(dot(transformed, cmT), transformed.y, 0.0);
      vRoom = aRoom; vRoom2 = aRoom2;
    }`;
  const GLASS_FS_HEAD = /* glsl */`
    varying vec4 vRoom; varying vec2 vRoom2; varying vec3 vRP; varying vec3 vRD;
    uniform float uCmDay; uniform float uCmNight;
    float cmH(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
    float cmMull = 0.0;
    vec3 cmInterior() {
      float W = vRoom.z, FH = max(vRoom.w, 1.0), D = vRoom2.x;
      float u = vRP.x - vRoom.x;
      float ci = floor(u / W), fu = u - ci * W;
      float fv = vRP.y - vRoom.y;
      vec2 id = vec2(ci, vRoom2.y);
      float r1 = cmH(id), r2 = cmH(id + 17.13), r3 = cmH(id + 31.71), r4 = cmH(id + 5.37);
      // mullions (three panes per bay) and a transom
      float pw = W / 3.0;
      float mu = abs(fract(fu / pw + 0.5) - 0.5) * pw;
      float tr = abs(fv - min(2.75, FH * 0.66));
      float aw = max(fwidth(vRP.x) + fwidth(vRP.z), 1e-4), ah = max(fwidth(vRP.y), 1e-4);
      cmMull = max(1.0 - smoothstep(0.03, 0.03 + aw, mu), 1.0 - smoothstep(0.025, 0.025 + ah, tr));
      cmMull = max(cmMull, 1.0 - smoothstep(0.0, ah, fv - 0.06));
      // the ray into the room box [0, W] × [0, FH] × [0, D]
      vec3 rd = normalize(vRD);
      rd.z = max(rd.z, 0.03);
      float tx = rd.x > 0.0 ? (W - fu) / max(rd.x, 1e-4) : fu / max(-rd.x, 1e-4);
      float ty = rd.y > 0.0 ? (FH - fv) / max(rd.y, 1e-4) : max(fv, 0.0) / max(-rd.y, 1e-4);
      float tz = D / rd.z;
      float t = min(min(tx, ty), tz);
      vec3 h = vec3(fu, fv, 0.0) + rd * t;
      vec3 col;
      vec2 lg = fract(vec2(h.x + ci * W, h.z) / 1.8) - 0.5;
      float pool = smoothstep(0.55, 0.0, length(lg));
      if (t == ty && rd.y > 0.0) {                       // ceiling: warm boards and a grid of lamps
        float lamp = 1.0 - smoothstep(0.07, 0.13, length(lg));
        float boards = 0.92 + 0.08 * step(0.5, fract(h.x / 0.3));
        col = vec3(0.78, 0.62, 0.45) * boards * 0.55 + lamp * vec3(4.2, 3.3, 2.2);
      } else if (t == ty) {                              // floor: stone in the lobby, wood upstairs, pools of light
        vec3 fa = vRoom2.x > 8.0 ? vec3(0.66, 0.62, 0.55) : vec3(0.46, 0.31, 0.19);
        float joint = vRoom2.x > 8.0 ? step(0.04, fract(h.x / 1.2)) * step(0.04, fract(h.z / 1.2)) : (0.9 + 0.1 * step(0.5, fract(h.z / 0.18)));
        col = fa * (0.75 + 0.25 * joint) * (0.8 + 0.7 * pool);
      } else if (t == tz) {                              // back wall: plaster, a display wall, shelves of jars
        col = mix(vec3(0.82, 0.76, 0.66), vec3(0.66, 0.53, 0.40), step(0.6, r2));
        float panel = step(0.18 * W, h.x) * step(h.x, 0.82 * W) * step(0.85, h.y) * step(h.y, min(2.7, FH - 0.5));
        if (r1 < 0.45) col = mix(col, mix(vec3(0.30, 0.20, 0.13), vec3(0.93, 0.88, 0.78), r4), panel);
        else {
          float shelf = step(0.88, fract(h.y / 0.62)) * step(h.y, 2.4);
          vec2 jc = vec2(fract(h.x / 0.7) - 0.5, fract(h.y / 0.62) - 0.42);
          float jar = (1.0 - smoothstep(0.17, 0.2, length(jc * vec2(1.0, 1.35)))) * step(h.y, 2.4) * step(0.1, h.y);
          col = mix(col, vec3(0.36, 0.22, 0.12), jar);
          col = mix(col, vec3(0.42, 0.28, 0.17), shelf);
        }
        col *= 0.95 + 0.25 * smoothstep(1.6, 0.0, abs(h.y - FH + 0.6));
      } else {                                          // side walls (partitions between halls)
        col = vec3(0.80, 0.74, 0.65) * (0.82 + 0.18 * step(0.5, fract(h.z / 2.4)));
      }
      col *= 1.0 - 0.45 * clamp(h.z / D, 0.0, 1.0);
      // the middle ground: a display case, a big onggi jar on a plinth or a standing exhibit panel
      float zf = D * (0.32 + 0.3 * r3);
      float tf = zf / rd.z;
      if (tf < t) {
        vec3 pf = vec3(fu, fv, 0.0) + rd * tf;
        float fx = pf.x / W;
        float kind = floor(r1 * 3.0);
        float m = 0.0; vec3 fc = vec3(0.0);
        if (kind < 1.0) {
          float a0 = 0.12 + 0.3 * r2, a1 = a0 + 0.28 + 0.2 * r4;
          m = step(a0, fx) * step(fx, a1) * step(pf.y, 1.05);
          fc = pf.y > 0.92 ? vec3(1.6, 1.45, 1.2) : (pf.y > 0.55 ? vec3(0.55, 0.62, 0.62) : vec3(0.28, 0.18, 0.11));
        } else if (kind < 2.0) {
          float jx = (fx - (0.3 + 0.4 * r2)) * W;
          float plinth = step(abs(jx), 0.42) * step(pf.y, 0.45);
          float body = 1.0 - smoothstep(0.0, 0.03, length(vec2(jx / 0.52, (pf.y - 0.98) / 0.56)) - 1.0);
          m = max(plinth, body * step(0.45, pf.y));
          fc = plinth > 0.5 ? vec3(0.62, 0.58, 0.52) : vec3(0.34, 0.20, 0.11) * (0.8 + 0.4 * smoothstep(-0.4, 0.4, jx));
        } else {
          float a0 = 0.2 + 0.4 * r2;
          m = step(a0, fx) * step(fx, a0 + 0.22) * step(0.2, pf.y) * step(pf.y, 2.1);
          fc = mix(vec3(0.85, 0.80, 0.70), vec3(0.42, 0.30, 0.22), step(0.5, r4)) * (pf.y > 1.95 ? 0.6 : 1.0);
        }
        if (m > 0.5) col = fc * (1.0 - 0.3 * clamp(zf / D, 0.0, 1.0));
      }
      // blinds pulled part-way down in some rooms
      float blind = (r4 > 0.62 ? 0.18 + 0.35 * r1 : 0.0) * FH;
      if (fv > FH - blind && fv < FH + 0.4) col = vec3(0.84, 0.78, 0.66) * (0.42 + 0.08 * step(0.5, fract(fu / 0.09)));
      return col;
    }`;
  function makeGlassMaterial() {
    if (low) {
      const m = own(new THREE_.MeshStandardMaterial({ color: 0x31434d, roughness: 0.18, metalness: 0.35, emissive: new THREE_.Color('#ffc485'), envMapIntensity: 1.2 }));
      G.world.addNightMaterial(m, 0.55, 0.05); nightMats.push(m);
      return m;
    }
    const m = own(new THREE_.MeshStandardMaterial({ color: 0x0c1215, roughness: 0.05, metalness: 0.08, emissive: new THREE_.Color(1, 1, 1), envMapIntensity: 1.35 }));
    m.userData.cmUniforms = { uCmDay: { value: 0.32 }, uCmNight: { value: 1.25 } };
    m.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, m.userData.cmUniforms);
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\n' + GLASS_VS_HEAD).replace('#include <begin_vertex>', '#include <begin_vertex>\n' + GLASS_VS_BODY);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\n' + GLASS_FS_HEAD)
        .replace('#include <map_fragment>', '#include <map_fragment>\n vec3 cmInt = cmInterior();\n diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.045, 0.042, 0.04), cmMull);')
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n roughnessFactor = mix(roughnessFactor, 0.42, cmMull);')
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          {
            float cmNoV = clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0);
            float cmF = 0.04 + 0.96 * pow(1.0 - cmNoV, 5.0);
            float cmLamp = totalEmissiveRadiance.r;
            totalEmissiveRadiance = cmInt * (uCmDay + cmLamp * uCmNight) * (1.0 - cmF) * (1.0 - cmMull) * 0.85;
          }`);
    };
    m.customProgramCacheKey = () => 'complex-main-glass-1';
    G.world.addNightMaterial(m, 1, 0); nightMats.push(m);
    return m;
  }

  // ---------------------------------------------------------------- small builders
  const box = (Bk, key, w, h, d, x, y, z, ry = 0, tint, uv = 'world') => Bk.add(key, geo.box(w, h, d, uv), M(x, y, z, ry), tint);
  const beamBox = (Bk, w, h, d, x, y, z, ry, tint) => Bk.add('wood', geo.box(w, h, d, 'grain'), M(x, y, z, ry), tint);
  /** a facade: start a → end b along T, outward normal n */
  const faceOf = (ax, az, bx, bz) => { const L = Math.hypot(bx - ax, bz - az), tx = (bx - ax) / L, tz = (bz - az) / L; return { ax, az, bx, bz, L, tx, tz, nx: tz, nz: -tx, ry: Math.atan2(-tz, tx) }; };
  // n = (tz, −tx): for T = (1, 0, 0) (south face, west → east) n = (0, 0, +1) — matches T = (nz, 0, −nx)
  const at = (F, s, off = 0) => [F.ax + F.tx * s + F.nx * off, F.az + F.tz * s + F.nz * off];
  /** square timber columns on a face at the bay points (dedup by position) */
  const colSeen = new Set();
  function columns(F, nb, yb, yt, size, tint, skip) {
    for (let i = 0; i <= nb; i++) {
      const s = (F.L * i) / nb;
      if (skip && skip(s)) continue;
      const [x, z] = at(F, s, 0.05);
      const key = `${x.toFixed(1)},${z.toFixed(1)},${yb.toFixed(1)}`;
      if (colSeen.has(key)) continue;
      colSeen.add(key);
      Bb.add('wood', geo.box(size, yt - yb, size, 'grain'), M(x, (yb + yt) / 2, z, F.ry), tint);
    }
  }
  /** horizontal band (창방 / slab edge) along a face */
  function band(F, y, h, d, off, tint, s0 = 0, s1 = F.L, Bk = Bb) {
    const len = s1 - s0;
    if (len < 0.2) return;
    const [x, z] = at(F, s0 + len / 2, off);
    Bk.add('wood', geo.box(len, h, d, 'grain'), M(x, y, z, F.ry), tint);
  }
  /** 익공 bracket at a column head: cap block, a cantilevered arm out of the wall and two 소로 blocks */
  function bracket(x, z, nx, nz, yTop, scale = 1) {
    const ry = Math.atan2(nx, nz), s = scale;
    Bn.add('wood', geo.box(0.62 * s, 0.24 * s, 0.62 * s, 'grain'), M(x, yTop + 0.12 * s, z, ry), COL.beam);
    const L = 1.5 * s;
    Bn.add('wood', geo.box(0.24 * s, 0.34 * s, L, 'grain'), M(x + nx * L * 0.32, yTop + 0.36 * s, z + nz * L * 0.32, ry), COL.timber);
    Bn.add('wood', geo.box(0.22 * s, 0.2 * s, 0.4 * s, 'grain'), M(x + nx * L * 0.78, yTop + 0.18 * s, z + nz * L * 0.78, ry, 1, 1, 1, -0.35), COL.timber);
    for (const k of [0.2, 0.7]) Bn.add('wood', geo.box(0.3 * s, 0.16 * s, 0.3 * s, 'grain'), M(x + nx * L * k, yTop + 0.61 * s, z + nz * L * k, ry), COL.beam);
  }
  /** balustrade (계자난간 near: posts, two rails, balusters; far: one alpha card) along a straight run */
  function railing(x0, z0, x1, z1, y, h = 1.05) {
    const L = Math.hypot(x1 - x0, z1 - z0);
    if (L < 0.4) return;
    const ry = Math.atan2(-(z1 - z0), x1 - x0), mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
    // top rail (돌란대) is shared by both forms (it is what reads from far away)
    Bb.add('wood', geo.box(L + 0.1, 0.1, 0.14, 'grain'), M(mx, y + h, mz, ry), COL.rail);
    Bf.add('railing', geo.mquad(L, h - 0.05), M(mx, y + (h - 0.05) / 2, mz, ry));
    if (low) return;
    const dx = (x1 - x0) / L, dz = (z1 - z0) / L;
    Bn.add('wood', geo.box(L, 0.08, 0.1, 'grain'), M(mx, y + 0.42, mz, ry), COL.rail);
    Bn.add('wood', geo.box(L, 0.12, 0.12, 'grain'), M(mx, y + 0.08, mz, ry), COL.rail);
    const np = Math.max(1, Math.round(L / 1.8));
    for (let i = 0; i <= np; i++) { const s = (L * i) / np; Bn.add('wood', geo.box(0.13, h + 0.08, 0.13, 'grain'), M(x0 + dx * s, y + (h + 0.08) / 2, z0 + dz * s, ry), COL.dark); }
    const nb = Math.max(1, Math.floor(L / 0.22));
    for (let i = 1; i < nb; i++) { const s = (L * i) / nb; Bn.add('wood', geo.box(0.045, 0.32, 0.045, 'grain'), M(x0 + dx * s, y + 0.3, z0 + dz * s, ry), COL.rail); }
    // 계자다리: curved stays under the top rail every 0.9 m
    const nk = Math.max(1, Math.round(L / 0.9));
    for (let i = 0; i <= nk; i++) { const s = (L * i) / nk; Bn.add('wood', geo.box(0.06, h - 0.46, 0.06, 'grain'), M(x0 + dx * s, y + 0.46 + (h - 0.46) / 2, z0 + dz * s, ry, 1, 1, 1, 0.18), COL.rail); }
  }
  /** a closed prism with a sloped top: a ramp running along x (dir ±1 = which end is high) */
  function rampGeo(x0, x1, z0, z1, yLo, yHi, yBase, highAtX1) {
    const yA = highAtX1 ? yLo : yHi, yB = highAtX1 ? yHi : yLo;
    const v = [[x0, yBase, z0], [x1, yBase, z0], [x1, yBase, z1], [x0, yBase, z1], [x0, yA, z0], [x1, yB, z0], [x1, yB, z1], [x0, yA, z1]];
    const faces = [[4, 7, 6, 5], [0, 1, 2, 3], [0, 4, 5, 1], [3, 2, 6, 7], [0, 3, 7, 4], [1, 5, 6, 2]];
    const pos = [], uv = [];
    for (const f of faces) {
      const q = f.map((i) => v[i]);
      for (const k of [0, 1, 2, 0, 2, 3]) { pos.push(...q[k]); uv.push(q[k][0] + q[k][2], q[k][1]); }
    }
    const g = new THREE_.BufferGeometry();
    g.setAttribute('position', new THREE_.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE_.Float32BufferAttribute(uv, 2));
    g.computeVertexNormals();
    return g;
  }

  // ================================================================= 1. podium, terrace, stairs, ramps
  const TER = { x0: -101.5, x1: -30.5, z0: -41.5, z1: 8 };                  // the podium terrace
  const PAD = { x0: por.x0 - 1, x1: por.x1 + 1, z0: TER.z1, z1: por.z1 };    // the portico pad (in front of the terrace)
  const ST = (E.stairs && E.stairs[0]) || { x0: por.x0, z0: por.z1, x1: por.x1, z1: por.z1 + 3, y0, y1: P };
  const CORR = { z0: -18.4, z1: -13.6 };                                    // the corridor joins the east edge here
  const RAMPS = [
    { x0: TER.x0 + 6.5, x1: PAD.x0 - 2.0, z0: TER.z1, z1: TER.z1 + 2.4, highAtX1: true },
    { x0: PAD.x1 + 2.0, x1: TER.x1 - 6.5, z0: TER.z1, z1: TER.z1 + 2.4, highAtX1: false },
  ];
  const wallsSD = (x, z) => {        // distance to the building's walls (≤ 0 inside), for the under-eave shade of the terrace
    let d = Infinity;
    for (const p of [core, wingW, wingE]) {
      const dx = Math.max(p.x0 - x, x - p.x1), dz = Math.max(p.z0 - z, z - p.z1);
      d = Math.min(d, dx <= 0 && dz <= 0 ? Math.max(dx, dz) : Math.hypot(Math.max(dx, 0), Math.max(dz, 0)));
    }
    return d;
  };
  /** the paved top of a rectangle as a grid with baked shade (darker under the eaves, along the walls) */
  function pavedTop(x0, z0, x1, z1, y, cell = 1.5) {
    const nu = Math.max(1, Math.round((x1 - x0) / cell)), nv = Math.max(1, Math.round((z1 - z0) / cell));
    const g = geo.grid(nu, nv, (i, j, o) => { const x = x0 + ((x1 - x0) * i) / nu, z = z1 - ((z1 - z0) * j) / nv; o[0] = x; o[1] = y; o[2] = z; o[3] = x; o[4] = -z; });
    const p = g.attributes.position, n = p.count, c = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const d = wallsSD(p.getX(i), p.getZ(i));
      const k = d < 0 ? 0.5 : 0.56 + 0.44 * smooth(0.2, 3.6, d) - 0.06 * (1 - smooth(3.6, 5.2, d));
      c[i * 3] = c[i * 3 + 1] = c[i * 3 + 2] = k;
    }
    g.setAttribute('color', new THREE_.Float32BufferAttribute(c, 3));
    Bb.add('stone', g, I4, COL.coping);
  }
  {
    // the stone-clad podium walls (plinth course, cladding, coping) round the terrace + the portico pad
    const yb = Math.min(groundAt(TER.x0, TER.z0), groundAt(TER.x1, TER.z1), groundAt(TER.x0, TER.z1), groundAt(TER.x1, TER.z0), y0) - 0.6;
    const solid = (x0, z0, x1, z1, top) => {
      box(Bb, 'stone', x1 - x0, top - yb - 0.12, z1 - z0, (x0 + x1) / 2, (top - 0.12 + yb) / 2, (z0 + z1) / 2, 0, COL.stone);
      box(Bb, 'stone', x1 - x0 + 0.24, 0.14, z1 - z0 + 0.24, (x0 + x1) / 2, top - 0.07, (z0 + z1) / 2, 0, COL.coping);
      box(Bb, 'stone', x1 - x0 + 0.3, 0.32, z1 - z0 + 0.3, (x0 + x1) / 2, yb + 0.75, (z0 + z1) / 2, 0, COL.plinth);
    };
    solid(TER.x0, TER.z0, TER.x1, TER.z1, P);
    solid(PAD.x0, PAD.z0, PAD.x1, PAD.z1, P);
    pavedTop(TER.x0 + 0.1, TER.z0 + 0.1, TER.x1 - 0.1, TER.z1 - 0.1, P + 0.005);
    pavedTop(PAD.x0 + 0.1, PAD.z0 - 0.1, PAD.x1 - 0.1, PAD.z1 - 0.1, P + 0.006, 1.25);
    ctx.addWalkable({ shape: 'box', x: (TER.x0 + TER.x1) / 2, z: (TER.z0 + TER.z1) / 2, hw: (TER.x1 - TER.x0) / 2, hd: (TER.z1 - TER.z0) / 2, top: P, surface: 'stone' });
    ctx.addWalkable({ shape: 'box', x: (PAD.x0 + PAD.x1) / 2, z: (PAD.z0 + PAD.z1) / 2, hw: (PAD.x1 - PAD.x0) / 2, hd: (PAD.z1 - PAD.z0) / 2, top: P, surface: 'stone' });
    // the wide entrance steps (from the plan's stair) with cheek walls
    const nSt = Math.max(3, Math.round((ST.y1 - ST.y0) / 0.15)), dz = (ST.z1 - ST.z0) / nSt;
    for (let i = 0; i < nSt; i++) {
      const top = ST.y1 - ((ST.y1 - ST.y0) * (i + 1)) / (nSt + 1);
      const za = ST.z0 + dz * i, zb = za + dz;
      box(Bb, 'stone', ST.x1 - ST.x0, top - yb, dz + 0.02, (ST.x0 + ST.x1) / 2, (top + yb) / 2, (za + zb) / 2, 0, i % 2 ? COL.stone : COL.coping);
      ctx.addWalkable({ shape: 'box', x: (ST.x0 + ST.x1) / 2, z: (za + zb) / 2, hw: (ST.x1 - ST.x0) / 2, hd: dz / 2 + 0.01, top, surface: 'stone' });
    }
    for (const sx of [ST.x0 - 0.45, ST.x1 + 0.45]) {
      box(Bb, 'stone', 0.9, P + 0.45 - yb, ST.z1 - ST.z0 + 0.4, sx, (P + 0.45 + yb) / 2, (ST.z0 + ST.z1) / 2 + 0.2, 0, COL.stone);
      box(Bb, 'stone', 1.0, 0.12, ST.z1 - ST.z0 + 0.5, sx, P + 0.51, (ST.z0 + ST.z1) / 2 + 0.2, 0, COL.coping);
      ctx.addCollider({ shape: 'box', x: sx, z: (ST.z0 + ST.z1) / 2 + 0.2, hw: 0.45, hd: (ST.z1 - ST.z0) / 2 + 0.2, maxY: P + 0.5 });
    }
    // the side ramps along the front (1 : 12)
    for (const R of RAMPS) {
      Bb.add('stone', rampGeo(R.x0, R.x1, R.z0, R.z1, y0 + 0.02, P, yb, R.highAtX1), I4, COL.coping);
      const n = 12, L = R.x1 - R.x0;
      for (let i = 0; i < n; i++) {
        const xa = R.x0 + (L * i) / n, xb = xa + L / n, f = R.highAtX1 ? (i + 1) / n : (n - i) / n;
        const top = y0 + (P - y0) * f;
        ctx.addWalkable({ shape: 'box', x: (xa + xb) / 2, z: (R.z0 + R.z1) / 2, hw: L / n / 2 + 0.01, hd: (R.z1 - R.z0) / 2, top, surface: 'stone' });
        if (top - y0 > 0.55) ctx.addCollider({ shape: 'box', x: (xa + xb) / 2, z: R.z1 + 0.12, hw: L / n / 2 + 0.01, hd: 0.12, maxY: top });
      }
      // a low parapet with a hand rail on the open side
      const mx = (R.x0 + R.x1) / 2;
      Bb.add('stone', rampGeo(R.x0, R.x1, R.z1, R.z1 + 0.3, y0 + 0.5, P + 0.55, yb, R.highAtX1), I4, COL.stone);
      const xl = R.highAtX1 ? R.x0 : R.x1, xh = R.highAtX1 ? R.x1 : R.x0;
      if (!low) Bn.add('metal', geo.tube(xl, y0 + 1.4, R.z1 + 0.15, xh, P + 0.95, R.z1 + 0.15, 0.035, 6), I4, '#5a524a');
      void mx;
    }
    // edge colliders: a walker on the terrace walks over them (maxY), one on the ground is stopped by the podium wall
    const edge = (x0, z0, x1, z1) => {
      const L = Math.hypot(x1 - x0, z1 - z0);
      if (L < 0.2) return;
      ctx.addCollider({ shape: 'box', x: (x0 + x1) / 2, z: (z0 + z1) / 2, hw: Math.abs(x1 - x0) / 2 + 0.15, hd: Math.abs(z1 - z0) / 2 + 0.15, maxY: P });
    };
    edge(TER.x0, TER.z0, TER.x1, TER.z0);
    edge(TER.x0, TER.z0, TER.x0, TER.z1);
    edge(TER.x1, TER.z0, TER.x1, CORR.z0); edge(TER.x1, CORR.z1, TER.x1, TER.z1);
    edge(TER.x0, TER.z1, PAD.x0, TER.z1); edge(PAD.x1, TER.z1, TER.x1, TER.z1);
    edge(PAD.x0, RAMPS[0].z1, PAD.x0, PAD.z1); edge(PAD.x1, RAMPS[1].z1, PAD.x1, PAD.z1);
    edge(PAD.x0, PAD.z1, ST.x0, PAD.z1); edge(ST.x1, PAD.z1, PAD.x1, PAD.z1);
    // the ramp tops reach the pad through a short landing
    for (const R of RAMPS) {
      const lx0 = R.highAtX1 ? R.x1 : PAD.x1, lx1 = R.highAtX1 ? PAD.x0 : R.x0;
      box(Bb, 'stone', lx1 - lx0, P - yb, R.z1 - R.z0, (lx0 + lx1) / 2, (P + yb) / 2, (R.z0 + R.z1) / 2, 0, COL.stone);
      pavedTop(lx0, R.z0, lx1, R.z1, P + 0.004, 1);
      ctx.addWalkable({ shape: 'box', x: (lx0 + lx1) / 2, z: (R.z0 + R.z1) / 2, hw: (lx1 - lx0) / 2 + 0.02, hd: (R.z1 - R.z0) / 2, top: P, surface: 'stone' });
    }
    // the corridor landing: a gap in the east edge at podium height (complex-buildings meets it at x = TER.x1)
  }

  // ================================================================= 2. walls: glass, columns, bands (core 1F / 2F, wings, core 3F)
  const coreFaces = {
    S: faceOf(core.x0, core.z1, core.x1, core.z1), E: faceOf(core.x1, core.z1, core.x1, core.z0),
    N: faceOf(core.x1, core.z0, core.x0, core.z0), W: faceOf(core.x0, core.z0, core.x0, core.z1),
  };
  const DOOR = { x: (C.door && C.door.x) ?? -66, z: (C.door && C.door.z) ?? core.z1, w: 6.4, h: 3.6 };
  const doorS0 = DOOR.x - DOOR.w / 2 - core.x0, doorS1 = DOOR.x + DOOR.w / 2 - core.x0;
  // where the wings cover the core's side walls (1F / 2F)
  const wingCover = (F) => {
    if (F === coreFaces.W) return [[wingW.z0 - core.z0, wingW.z1 - core.z0]];
    if (F === coreFaces.E) return [[core.z1 - wingE.z1, core.z1 - wingE.z0]];
    return [];
  };
  const runsOf = (F, cuts) => {
    const out = [];
    let s = 0;
    for (const [a, b] of cuts.slice().sort((p, q) => p[0] - q[0])) { if (a > s) out.push([s, a]); s = Math.max(s, b); }
    if (s < F.L) out.push([s, F.L]);
    return out;
  };
  const bayOf = (L, target) => L / Math.max(1, Math.round(L / target));
  let seedN = 1;
  function storey(F, yb, yt, depth, cuts, colSize, colTint) {
    const cw = bayOf(F.L, 4.1), seed = seedN++;
    for (const [s0, s1] of runsOf(F, cuts)) {
      const [x0, z0] = at(F, s0), [x1, z1] = at(F, s1);
      // cells start at the face start so they line up with the columns
      const ox = -F.nx * 0.12, oz = -F.nz * 0.12;
      const b = glassQ.pos.length / 3;
      glassQ.pos.push(x0 + ox, yb, z0 + oz, x1 + ox, yb, z1 + oz, x1 + ox, yt, z1 + oz, x0 + ox, yt, z0 + oz);
      for (let i = 0; i < 4; i++) glassQ.nor.push(F.nx, 0, F.nz);
      const u0 = (F.ax + ox) * F.nz - (F.az + oz) * F.nx;
      for (let i = 0; i < 4; i++) { glassQ.room.push(u0, yb, cw, yt - yb - 0.36); glassQ.room2.push(depth, seed); }
      glassQ.idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    }
    const inCut = (s) => cuts.some(([a, b]) => s > a + 0.3 && s < b - 0.3);
    columns(F, Math.round(F.L / cw), yb, yt, colSize, colTint, inCut);
    return cw;
  }
  // core 1F / 2F
  for (const key of ['S', 'E', 'N', 'W']) {
    const F = coreFaces[key];
    const cov = wingCover(F);
    storey(F, P, T1, ROOM_D[1], key === 'S' ? cov.concat([[doorS0, doorS1]]) : cov, 0.5, COL.timber);
    storey(F, T1, T2, ROOM_D[2], cov, 0.46, COL.timber);
    for (const [s0, s1] of runsOf(F, cov)) {
      band(F, T1, 0.62, 0.62, 0.12, COL.band, s0, s1);                       // the 2F slab edge
      band(F, T2 - 0.18, 0.5, 0.5, 0.1, COL.beam, s0, s1);                   // 창방
      band(F, T2 + 0.16, 0.24, 0.66, 0.16, COL.band, s0, s1);                // 평방
      band(F, P + 0.12, 0.24, 0.42, 0.06, COL.dark, s0, s1);                 // sill
    }
  }
  // the entrance: a timber portal, glass leaves, a lit header (the door into the lobby)
  {
    const F = coreFaces.S, zf = core.z1;
    beamBox(Bb, DOOR.w + 1.2, 0.55, 0.7, DOOR.x, P + DOOR.h + 0.27, zf + 0.15, 0, COL.beam);
    for (const sx of [-1, 1]) beamBox(Bb, 0.6, DOOR.h + 0.02, 0.7, DOOR.x + sx * (DOOR.w / 2 + 0.3), P + DOOR.h / 2, zf + 0.15, 0, COL.timber);
    // the glass leaves look into the lobby (the same interior-mapped glass), four timber-framed leaves
    glassRun(DOOR.x - DOOR.w / 2, zf, DOOR.x + DOOR.w / 2, zf, 0, 1, P, P + DOOR.h, DOOR.w / 2, ROOM_D[1] + 4, 97, 0.18);
    for (let i = 1; i < 4; i++) beamBox(Bb, 0.1, DOOR.h, 0.16, DOOR.x - DOOR.w / 2 + (DOOR.w * i) / 4, P + DOOR.h / 2, zf - 0.06, 0, COL.dark);
    if (!low) box(Bn, 'glow', DOOR.w - 0.2, 0.08, 0.3, DOOR.x, P + DOOR.h + 0.02, zf + 0.35, 0, '#ffffff');
    // the glass above the door (the 1F's upper part)
    glassRun(DOOR.x - DOOR.w / 2, zf, DOOR.x + DOOR.w / 2, zf, 0, 1, P + DOOR.h + 0.55, T1, DOOR.w, ROOM_D[1], 99);
    void F;
    if (!low) for (const sx of [-0.3, 0.3]) box(Bn, 'metal', 0.05, 1.3, 0.08, DOOR.x + sx, P + 1.1, zf + 0.06, 0, '#c9a45a');
  }
  // wings
  const wingFaces = [];
  for (const W of [wingW, wingE]) {
    const west = W === wingW;
    const faces = west
      ? { S: faceOf(W.x0, W.z1, W.x1, W.z1), W: faceOf(W.x0, W.z0, W.x0, W.z1), N: faceOf(W.x1, W.z0, W.x0, W.z0) }
      : { S: faceOf(W.x0, W.z1, W.x1, W.z1), E: faceOf(W.x1, W.z1, W.x1, W.z0), N: faceOf(W.x1, W.z0, W.x0, W.z0) };
    wingFaces.push(faces);
    for (const F of Object.values(faces)) {
      const sideDoor = !west && F === faces.E;
      const dS = sideDoor ? W.z1 - (E.doors?.[1]?.z ?? -16) : 0;
      storey(F, P, T1, ROOM_D[1], sideDoor ? [[dS - 1.8, dS + 1.8]] : [], 0.46, COL.timber);
      storey(F, T1, wingTop, ROOM_D[2], [], 0.42, COL.timber);
      band(F, T1, 0.6, 0.6, 0.12, COL.band);
      band(F, wingTop - 0.16, 0.46, 0.46, 0.1, COL.beam);
      band(F, wingTop + 0.14, 0.22, 0.6, 0.14, COL.band);
      band(F, P + 0.12, 0.24, 0.42, 0.06, COL.dark);
    }
  }
  // the side door to the corridor (east wing, east face)
  const SIDE = { x: wingE.x1, z: E.doors?.[1]?.z ?? -16 };
  {
    const zc = SIDE.z, xf = SIDE.x;
    beamBox(Bb, 0.7, 0.45, 4.2, xf + 0.15, P + 3.2 + 0.22, zc, 0, COL.beam);
    for (const sz of [-1, 1]) beamBox(Bb, 0.7, 3.2, 0.5, xf + 0.15, P + 1.6, zc + sz * 1.85, 0, COL.timber);
    glassRun(xf, zc + 1.6, xf, zc - 1.6, 1, 0, P, P + 3.1, 1.6, ROOM_D[1], 96, 0.18);
    beamBox(Bb, 0.16, 3.1, 0.1, xf - 0.05, P + 1.55, zc, 0, COL.dark);
    glassRun(xf, zc + 1.8, xf, zc - 1.8, 1, 0, P + 3.65, T1, 3.6, ROOM_D[1], 98);
  }
  // core 3F (set back) — floor deck over the skirt with its balustrade, round columns, glass
  const sk = { mode: 'skirt', hw: chw, hd: chd, ov: 2.5, out: 0.75, lift: 0.62, t: 0.4, rise: 14, vres: 1.4, seg: 0.8, tint: '#f2f3f4' };
  sk.vs = 1 - hd3 / (chd + sk.ov);
  sk.y = K.roofBaseFor(sk, T2 + 0.45);
  const skR = roofMath(sk);
  const F3 = skR.fy(0, sk.vs) + 0.32;                                       // the 3F floor just above the skirt's top edge
  const f3 = {
    S: faceOf(cx - hw3, cz + hd3, cx + hw3, cz + hd3), E: faceOf(cx + hw3, cz + hd3, cx + hw3, cz - hd3),
    N: faceOf(cx + hw3, cz - hd3, cx - hw3, cz - hd3), W: faceOf(cx - hw3, cz - hd3, cx - hw3, cz + hd3),
  };
  {
    const DK = 1.25;                                                          // the balcony reaches 1.25 m beyond the 3F wall
    box(Bb, 'plank', 2 * (hw3 + DK), 0.24, 2 * (hd3 + DK), cx, F3 - 0.12, cz, 0, COL.deck);
    beamBox(Bb, 2 * (hw3 + DK) + 0.1, 0.3, 0.2, cx, F3 - 0.15, cz + hd3 + DK, 0, COL.band);
    beamBox(Bb, 2 * (hw3 + DK) + 0.1, 0.3, 0.2, cx, F3 - 0.15, cz - hd3 - DK, 0, COL.band);
    beamBox(Bb, 0.2, 0.3, 2 * (hd3 + DK), cx + hw3 + DK, F3 - 0.15, cz, 0, COL.band);
    beamBox(Bb, 0.2, 0.3, 2 * (hd3 + DK), cx - hw3 - DK, F3 - 0.15, cz, 0, COL.band);
    const xa = cx - hw3 - DK + 0.1, xb = cx + hw3 + DK - 0.1, za = cz - hd3 - DK + 0.1, zb = cz + hd3 + DK - 0.1;
    railing(xa, zb, xb, zb, F3); railing(xb, zb, xb, za, F3); railing(xb, za, xa, za, F3); railing(xa, za, xa, zb, F3);
    if (!low) {
      // 계자다리 brackets under the deck edge, standing on the skirt
      for (const F of Object.values(f3)) {
        const n = Math.round(F.L / 2.4);
        for (let i = 0; i <= n; i++) {
          const [x, z] = at(F, (F.L * i) / n, DK * 0.55);
          Bn.add('wood', geo.box(0.16, 0.7, DK, 'grain'), M(x, F3 - 0.55, z, F.ry, 1, 1, 1, 0.5), COL.beam);
        }
      }
    }
    for (const key of ['S', 'E', 'N', 'W']) {
      const F = f3[key], cw = bayOf(F.L, 4.2), seed = seedN++;
      glassRun(F.ax, F.az, F.bx, F.bz, F.nx, F.nz, F3, coreTop, cw, ROOM_D[3], seed, 0.1);
      const nb = Math.round(F.L / cw);
      for (let i = 0; i <= nb; i++) {
        const [x, z] = at(F, (F.L * i) / nb, 0.05);
        const k = `r${x.toFixed(1)},${z.toFixed(1)}`;
        if (colSeen.has(k)) continue;
        colSeen.add(k);
        Bb.add('wood', geo.cyl(0.25, 0.29, coreTop - F3, low ? 8 : 12), M(x, (F3 + coreTop) / 2, z), COL.timber);
        if (!low) bracket(x, z, F.nx, F.nz, coreTop + 0.38, 1.15);
      }
      band(F, coreTop - 0.2, 0.55, 0.5, 0.06, COL.beam);
      band(F, coreTop + 0.2, 0.26, 0.72, 0.12, COL.band);
      band(F, F3 + 0.1, 0.2, 0.36, 0.05, COL.dark);
    }
  }
  // core / wing 2F balconies along the front (not where the portico stands)
  {
    const DK = 1.45, y = T1 + 0.31;
    const runs = [[wingW.x0, por.x0 - 2.5], [por.x1 + 2.5, wingE.x1]];
    for (const [xa, xb] of runs) {
      for (const [x0, x1, zf] of [[xa, Math.min(xb, core.x0), wingW.z1], [Math.max(xa, core.x0), Math.min(xb, core.x1), core.z1], [Math.max(xa, core.x1), xb, wingE.z1]]) {
        if (x1 - x0 < 0.5) continue;
        box(Bb, 'plank', x1 - x0, 0.22, DK, (x0 + x1) / 2, y - 0.11, zf + DK / 2, 0, COL.deck);
        beamBox(Bb, x1 - x0 + 0.05, 0.3, 0.18, (x0 + x1) / 2, y - 0.16, zf + DK, 0, COL.band);
        railing(x0 + 0.05, zf + DK - 0.08, x1 - 0.05, zf + DK - 0.08, y);
        for (const xe of [x0, x1]) {
          if ((xe === wingW.x0 && x0 === wingW.x0) || (xe === wingE.x1 && x1 === wingE.x1) || Math.abs(xe - por.x0 + 2.5) < 0.01 || Math.abs(xe - por.x1 - 2.5) < 0.01) railing(xe, zf + 0.05, xe, zf + DK - 0.08, y);
        }
        if (!low) {
          const n = Math.max(1, Math.round((x1 - x0) / 4.1));
          for (let i = 0; i <= n; i++) Bn.add('wood', geo.beam(x0 + ((x1 - x0) * i) / n, y - 1.25, zf + 0.06, x0 + ((x1 - x0) * i) / n, y - 0.2, zf + DK * 0.7, 0.14, 0.16), I4, COL.beam);
        }
      }
    }
  }
  // brackets under the skirt (core 2F columns) and the wing eaves
  if (!low) {
    for (const key of ['S', 'E', 'N', 'W']) {
      const F = coreFaces[key], cw = bayOf(F.L, 4.1), nb = Math.round(F.L / cw), cov = wingCover(F);
      for (let i = 0; i <= nb; i++) {
        const s = (F.L * i) / nb;
        if (cov.some(([a, b]) => s > a - 0.3 && s < b + 0.3)) continue;
        const [x, z] = at(F, s, 0.05);
        bracket(x, z, F.nx, F.nz, T2 + 0.3, 1.0);
      }
    }
    for (const faces of wingFaces) for (const F of Object.values(faces)) {
      const cw = bayOf(F.L, 4.1), nb = Math.round(F.L / cw);
      for (let i = 0; i <= nb; i++) { const [x, z] = at(F, (F.L * i) / nb, 0.05); bracket(x, z, F.nx, F.nz, wingTop + 0.26, 0.9); }
    }
  }

  // ================================================================= 3. roofs (two tiers on the core, the wings, the portico)
  const roofs = {};
  roofs.skirt = hanokRoof(sk, I4, { rr: 0.09, sp: 0.55 });
  {
    const rc = core.roof || { h: 9.5, overhang: 3.2 };
    const mr = { mode: 'paljak', hw: hw3, hd: hd3, ov: rc.overhang ?? 3.2, out: 1.25, lift: 1.35, t: 0.6, rise: rc.h ?? 9.5, vres: low ? 1 : 1.8, seg: low ? 0.6 : 0.9, bo: 0.9, ridge: { w: 0.95, h: 1.05 }, tint: '#f2f3f4', gableColor: '#6b4b31' };
    mr.y = K.roofBaseFor(mr, coreTop + 0.98);
    roofs.main = hanokRoof(mr, M(cx, 0, cz), { rr: 0.11, sp: 0.5 });
  }
  for (const W of [wingW, wingE]) {
    const rw = W.roof || { h: 5, overhang: 2.4 };
    const o = { mode: 'paljak', hw: (W.z1 - W.z0) / 2, hd: (W.x1 - W.x0) / 2, ov: rw.overhang ?? 2.4, out: 0.6, lift: 0.7, t: 0.42, rise: rw.h ?? 5, vres: low ? 1 : 1.4, seg: 0.9, bo: 0.6, ridge: { w: 0.62, h: 0.66 }, tint: '#f2f3f4', gableColor: '#6b4b31' };
    o.y = K.roofBaseFor(o, wingTop + 0.62);
    roofs[W.id] = hanokRoof(o, M((W.x0 + W.x1) / 2, 0, (W.z0 + W.z1) / 2, PI / 2), { rr: 0.085, sp: 0.5 });
  }
  // portico: round columns, beams, brackets, a paljak roof whose gable faces the stairs, the 현판
  const POR = { x0: por.x0 + 0.6, x1: por.x1 - 0.6, z0: por.z0, z1: por.z1 - 0.4 };
  {
    const xs = [POR.x0, DOOR.x - 3.5, DOOR.x + 3.5, POR.x1];
    const cols = xs.map((x) => [x, POR.z1]).concat([[POR.x0, (POR.z0 + POR.z1) / 2 + 0.6], [POR.x1, (POR.z0 + POR.z1) / 2 + 0.6]]);
    for (const [x, z] of cols) {
      box(Bb, 'stone', 1.05, 0.3, 1.05, x, P + 0.15, z, 0, COL.coping);
      Bb.add('wood', geo.cyl(0.3, 0.35, porTop - P - 0.3, low ? 8 : 14), M(x, P + 0.3 + (porTop - P - 0.3) / 2, z), COL.timber);
      ctx.addCollider({ shape: 'circle', x, z, r: 0.45 });
      if (!low) bracket(x, z, x < DOOR.x - 5 ? -0.6 : x > DOOR.x + 5 ? 0.6 : 0, 0.8, porTop + 0.1, 1.05);
    }
    beamBox(Bb, POR.x1 - POR.x0 + 0.7, 0.62, 0.48, (POR.x0 + POR.x1) / 2, porTop - 0.2, POR.z1, 0, COL.beam);
    beamBox(Bb, POR.x1 - POR.x0 + 0.9, 0.26, 0.66, (POR.x0 + POR.x1) / 2, porTop + 0.22, POR.z1, 0, COL.band);
    for (const x of [POR.x0, POR.x1]) {
      beamBox(Bb, 0.48, 0.62, POR.z1 - POR.z0 + 0.4, x, porTop - 0.2, (POR.z0 + POR.z1) / 2, 0, COL.beam);
      beamBox(Bb, 0.66, 0.26, POR.z1 - POR.z0 + 0.5, x, porTop + 0.22, (POR.z0 + POR.z1) / 2, 0, COL.band);
    }
    // the coffered ceiling of the portico (warm boards) so the underside never shows the sky
    box(Bb, 'plank', POR.x1 - POR.x0 + 0.4, 0.12, POR.z1 - POR.z0 + 0.3, (POR.x0 + POR.x1) / 2, porTop + 0.42, (POR.z0 + POR.z1) / 2, 0, COL.deck);
    const rp = por.roof || { h: 4.6, overhang: 1.8 };
    const o = { mode: 'paljak', hw: (POR.z1 - POR.z0) / 2 + 0.2, hd: (POR.x1 - POR.x0) / 2, ov: rp.overhang ?? 1.8, out: 0.55, lift: 0.6, t: 0.4, rise: rp.h ?? 4.6, vg: 0.28, vres: low ? 1 : 1.3, seg: 1, bo: 0.55, ridge: { w: 0.6, h: 0.62 }, tint: '#f2f3f4', gableColor: '#6b4b31' };
    o.y = K.roofBaseFor(o, porTop + 0.6);
    roofs.portico = hanokRoof(o, M((POR.x0 + POR.x1) / 2, 0, (POR.z0 + POR.z1) / 2, PI / 2), { rr: 0.085, sp: 0.5 });
    // 현판 "만장대" on the front beam under the gable
    let tex = null;
    try { tex = own(G.gfx.signTexture('만장대', null, { ...K.HYEONPAN, w: 1024, h: 400, size: 230 })); } catch (e) { tex = null; }
    const sm = own(new THREE_.MeshStandardMaterial({ map: tex || null, color: tex ? 0xffffff : 0x3b2a1d, roughness: 0.55, metalness: 0.05 }));
    const sg = new THREE_.PlaneGeometry(4.6, 1.8);
    const sign = new THREE_.Mesh(sg, sm);
    sign.name = 'complex-main:hyeonpan';
    sign.position.set(DOOR.x, porTop + 1.55, POR.z1 + 0.42); sign.rotation.x = -0.1;
    sign.castShadow = true;
    gBase.add(sign);
    box(Bb, 'wood', 4.85, 2.05, 0.1, DOOR.x, porTop + 1.55, POR.z1 + 0.36, 0, COL.dark);
  }

  // ================================================================= 4. near details: lanterns, banners, pines, jars, rain chains, gutters
  const banners = [];
  if (!low) {
    // lanterns (청사초롱-like, warm paper) hanging from the portico beam
    for (const x of [DOOR.x - 6.6, DOOR.x - 1.8, DOOR.x + 1.8, DOOR.x + 6.6]) {
      const z = POR.z1 - 0.9, yt = porTop - 0.5;
      Bn.add('metal', geo.box(0.03, 0.9, 0.03), M(x, yt - 0.45, z), '#2b2622');
      Bn.add('wood', geo.cyl(0.2, 0.2, 0.08, 10), M(x, yt - 0.94, z), COL.dark);
      Bn.add('glow', geo.cyl(0.27, 0.27, 0.62, 12), M(x, yt - 1.3, z), '#ffffff');
      Bn.add('paint', geo.cyl(0.29, 0.29, 0.1, 12), M(x, yt - 1.0, z), '#2d4f8f');
      Bn.add('paint', geo.cyl(0.29, 0.29, 0.1, 12), M(x, yt - 1.6, z), '#a3312a');
      Bn.add('wood', geo.cyl(0.18, 0.18, 0.06, 10), M(x, yt - 1.68, z), COL.dark);
    }
    // rain chains at the skirt's and the wings' outer eave corners, each over a small stone basin
    const chain = (x, ytop, z, ybot) => {
      const n = Math.max(4, Math.floor((ytop - ybot) / 0.16));
      for (let i = 0; i < n; i++) Bn.add('metal', geo.box(0.07, 0.13, 0.02), M(x, ytop - i * 0.16 - 0.065, z, (i % 2) * PI / 2), '#9a6a3c');
      Bn.add('stone', geo.cyl(0.38, 0.45, 0.32, 12), M(x, ybot + 0.16, z), '#bdb5a8');
      Bn.add('glaze', geo.cyl(0.3, 0.3, 0.02, 12), M(x, ybot + 0.31, z), '#2a3a40');
    };
    const R = skR, cxs = [core.x0 - 0.2, core.x1 + 0.2];
    for (const sx of [-1, 1]) {
      const x = cx + sx * (R.A + R.out * 0.6), z = cz + (R.C + R.bul(R.A) * 0.8);
      if (x > TER.x0 + 1 && x < TER.x1 - 1 && z < TER.z1 - 0.5) chain(x, R.fy(R.A, 0) - R.t, z, P);
    }
    void cxs;
    for (const W of [wingW, wingE]) {
      const RW = roofs[W.id].R, xs = W === wingW ? W.x0 - RW.C * 0.55 : W.x1 + RW.C * 0.55;
      const x = clamp(W === wingW ? W.x0 - 2.0 : W.x1 + 2.0, TER.x0 + 0.6, TER.x1 - 0.6);
      chain(x, RW.y - RW.t + 0.1, W.z1 + 2.0, P);
      void xs;
    }
    // 장독 groups and planters on the terrace in front of the wings
    const jars = [[-95.5, 3.5, 'dok', 1.0], [-94.2, 4.6, 'hangari', 0.9], [-96.6, 4.9, 'jungduri', 0.8], [-95.1, 6.0, 'danji', 1.2], [-37.5, 3.5, 'dok', 1.0], [-38.8, 4.7, 'hangari', 0.95], [-36.4, 4.9, 'jungduri', 0.8], [-37.9, 6.1, 'danji', 1.2]];
    for (const [x, z, kind, s] of jars) {
      Bn.add('stone', geo.cyl(0.62 * s, 0.66 * s, 0.12, 14), M(x, P + 0.06, z), '#cfc8bb');
      Bn.add('glaze', K.jarGeometry(kind, 18), M(x, P + 0.12, z, 0, s), '#7a4a2c');
      Bn.add('glaze', K.lidGeometry(14, (K.JAR_PROFILES[kind] || K.JAR_PROFILES.hangari).reduce((m, p) => (p[1] > m[1] ? p : m), [0, 0])[0] * 1.05), M(x, P + 0.12 + K.jarTop(kind) * s - 0.02, z, 0, s), '#6a3e25');
    }
    const pinesAt = [[-90.5, 4.4], [-81.5, 5.6], [-50.5, 5.6], [-41.5, 4.4]];
    for (const [x, z] of pinesAt) {
      box(Bn, 'stone', 1.7, 0.75, 1.7, x, P + 0.375, z, 0, '#c4bcae');
      box(Bn, 'stone', 1.8, 0.08, 1.8, x, P + 0.76, z, 0, COL.coping);
      box(Bn, 'gravel', 1.5, 0.05, 1.5, x, P + 0.72, z, 0, '#8d8577');
    }
    try {
      const gv = G.sys.nature?.grove?.(pinesAt.map(([x, z], i) => ({ x, z, y: P + 0.72, species: 'gardenPine', scale: 0.42 + (i % 2) * 0.06, rot: i * 1.7 })), { parent: gNear, name: 'complex-main-pines', colliders: false });
      if (gv && gv.group) disposers.push(() => gv.dispose());
    } catch (e) { G.log.warn('WORLD', 'complex-main: potted pines skipped', e?.message || e); }
    // banners on poles by the steps
    let btex = null;
    try {
      btex = own(G.gfx.canvasTexture(128, 512, (c, w, h) => {
        const g = c.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#f1e8d6'); g.addColorStop(1, '#e2d4ba');
        c.fillStyle = g; c.fillRect(0, 0, w, h);
        c.fillStyle = '#8b2f25'; c.fillRect(0, 0, w, 26); c.fillRect(0, h - 40, w, 40);
        c.fillStyle = '#3a2a1e'; c.textAlign = 'center'; c.textBaseline = 'middle';
        c.font = `800 64px ${K.FONT}`;
        ['만', '장', '대'].forEach((ch, i) => c.fillText(ch, w / 2, 110 + i * 92));
        c.font = `600 22px ${K.FONT}`; c.fillStyle = '#6a4a30';
        c.fillText('만 개의 장독대', w / 2, h - 82);
        c.fillStyle = '#7a4a2c'; c.beginPath(); c.ellipse(w / 2, 404, 22, 26, 0, 0, Math.PI * 2); c.fill();
      }));
    } catch (e) { btex = null; }
    const bm = own(new THREE_.MeshStandardMaterial({ map: btex, color: btex ? 0xffffff : 0xe9dcc4, roughness: 0.9, side: THREE_.DoubleSide }));
    for (const x of [ST.x0 - 1.6, ST.x1 + 1.6]) {
      const z = ST.z1 - 0.6, yb = groundAt(x, z);
      Bn.add('wood', geo.cyl(0.07, 0.08, 6.6, 8), M(x, yb + 3.3, z), COL.dark);
      Bn.add('wood', geo.box(0.95, 0.06, 0.06, 'grain'), M(x, yb + 6.2, z), COL.dark);
      Bn.add('stone', geo.cyl(0.32, 0.36, 0.35, 10), M(x, yb + 0.17, z), '#bdb5a8');
      const bg = new THREE_.PlaneGeometry(0.85, 3.4, 1, 6); bg.translate(0, -1.7, 0);
      const mesh = new THREE_.Mesh(bg, bm);
      mesh.position.set(x, yb + 6.17, z + 0.05); mesh.castShadow = true; mesh.name = 'complex-main:banner';
      gNear.add(mesh); banners.push(mesh);
    }
  }

  // ================================================================= 5. merge, glass mesh, contact shade, blockers
  const glassMat = makeGlassMaterial();
  const gg = new THREE_.BufferGeometry();
  gg.setAttribute('position', new THREE_.Float32BufferAttribute(glassQ.pos, 3));
  gg.setAttribute('normal', new THREE_.Float32BufferAttribute(glassQ.nor, 3));
  gg.setAttribute('aRoom', new THREE_.Float32BufferAttribute(glassQ.room, 4));
  gg.setAttribute('aRoom2', new THREE_.Float32BufferAttribute(glassQ.room2, 2));
  gg.setIndex(glassQ.idx);
  gg.computeBoundingSphere(); gg.computeBoundingBox();
  const glass = new THREE_.Mesh(gg, glassMat);
  glass.name = 'complex-main:glass'; glass.castShadow = true; glass.receiveShadow = true;
  glass.matrixAutoUpdate = false; glass.updateMatrix();
  gBase.add(glass);

  const aoGround = { ground: (x, z) => groundAt(x, z) };
  const baseMeshes = Bb.build(gBase, { name: 'complex-main', ao: aoGround });
  Bf.build(gFar, { name: 'complex-main-far', ao: false });
  if (!low) Bn.build(gNear, { name: 'complex-main-near', ao: false });

  // a soft contact shade on the ground along the podium's foot (no shadow map needed from far away)
  {
    const ring = [[TER.x0, TER.z0], [TER.x1, TER.z0], [TER.x1, TER.z1], [PAD.x1, TER.z1], [PAD.x1, PAD.z1], [PAD.x0, PAD.z1], [PAD.x0, TER.z1], [TER.x0, TER.z1]];
    const pos = [], colA = [], idx = [];
    const W = 2.6, step = 2.0;
    for (let e = 0; e < ring.length; e++) {
      const a = ring[e], b = ring[(e + 1) % ring.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (L < 0.5) continue;
      const tx = (b[0] - a[0]) / L, tz = (b[1] - a[1]) / L, nx = tz, nz = -tx;       // outward for a clockwise ring in x-east / z-south
      const n = Math.max(1, Math.round(L / step));
      for (let i = 0; i <= n; i++) {
        const s = (L * i) / n, x = a[0] + tx * s, z = a[1] + tz * s;
        const base = pos.length / 3;
        for (const [k, al] of [[0.05, 0.5], [W, 0]]) {
          const px = x + nx * k, pz = z + nz * k;
          pos.push(px, groundAt(px, pz) + 0.06, pz); colA.push(0, 0, 0, al);
        }
        if (i > 0) idx.push(base - 2, base, base - 1, base - 1, base, base + 1);
      }
    }
    const sgm = new THREE_.BufferGeometry();
    sgm.setAttribute('position', new THREE_.Float32BufferAttribute(pos, 3));
    sgm.setAttribute('color', new THREE_.Float32BufferAttribute(colA, 4));
    sgm.setIndex(idx);
    sgm.computeBoundingSphere();
    const smat = own(new THREE_.MeshBasicMaterial({ color: 0x000000, vertexColors: true, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, side: THREE_.DoubleSide }));
    const shade = new THREE_.Mesh(sgm, smat);
    shade.name = 'complex-main:contact-shade'; shade.renderOrder = 1; shade.userData.guardSkip = true;
    gBase.add(shade);
  }

  // camera blockers: the merged roof meshes + invisible boxes for the wall volumes (the follow camera pulls in under the eaves
  // and never sits inside the hall)
  const blockerMat = K.Site.hullMat;
  const addBlocker = (x0, y0b, z0, x1, y1, z1) => {
    const m = new THREE_.Mesh(K.Site.unitBox, blockerMat);
    m.position.set((x0 + x1) / 2, (y0b + y1) / 2, (z0 + z1) / 2); m.scale.set(x1 - x0, y1 - y0b, z1 - z0);
    m.visible = false; m.name = 'blocker'; m.raycast = THREE_.Mesh.prototype.raycast;
    gBase.add(m); m.updateMatrix(); m.updateMatrixWorld(true);
    G.world.cameraBlockers.push(m); blockers.push(m);
  };
  addBlocker(core.x0 - 0.3, P, core.z0 - 0.3, core.x1 + 0.3, T2 + 0.6, core.z1 + 0.3);
  addBlocker(cx - hw3 - 0.3, T2, cz - hd3 - 0.3, cx + hw3 + 0.3, coreTop + 1.0, cz + hd3 + 0.3);
  for (const W of [wingW, wingE]) addBlocker(W.x0 - 0.3, P, W.z0 - 0.3, W.x1 + 0.3, wingTop + 0.5, W.z1 + 0.3);
  if (baseMeshes.roof) { G.world.cameraBlockers.push(baseMeshes.roof); blockers.push(baseMeshes.roof); }

  // colliders: the halls themselves
  for (const p of [core, wingW, wingE]) ctx.addCollider({ shape: 'box', x: (p.x0 + p.x1) / 2, z: (p.z0 + p.z1) / 2, hw: (p.x1 - p.x0) / 2 + 0.2, hd: (p.z1 - p.z0) / 2 + 0.2 });

  // ================================================================= 6. doors, lights
  const DOOR_SPOT = { x: DOOR.x, y: P, z: core.z1 + 1.6 };
  let doorHandle = null;
  const office = !!G.sys.places?.def?.('PL_OFFICE');
  if (office) {
    doorHandle = ctx.interact({
      id: 'CX_MAIN_DOOR', kind: 'door', label: '🏛️ 본관 로비로 들어가기', kidLabel: '본관 안으로', emoji: '🏛️', radius: 3.4, priority: 0.8,
      position: { x: DOOR.x, y: P + 1.2, z: core.z1 + 1.0 },
      onInteract: () => { try { G.sys.places.enter('PL_OFFICE'); } catch (e) { G.log.warn('WORLD', 'complex-main: lobby enter failed', e?.message || e); } },
    });
    ctx.interact({
      id: 'CX_MAIN_SIDE_DOOR', kind: 'door', label: '🏛️ 본관으로 들어가기 (옆문)', kidLabel: '본관 안으로', emoji: '🏛️', radius: 3.0, priority: 0.6,
      position: { x: SIDE.x + 1.0, y: P + 1.2, z: SIDE.z },
      onInteract: () => { try { G.sys.places.enter('PL_OFFICE'); } catch (e) { G.log.warn('WORLD', 'complex-main: lobby enter failed', e?.message || e); } },
    });
  }
  if (!low && typeof ctx.light === 'function') {
    ctx.light({ x: DOOR.x - 4, y: porTop - 0.6, z: POR.z1 - 2.5, color: 0xffb46a, intensity: 9, distance: 14, decay: 2, day: 0.0 });
    ctx.light({ x: DOOR.x + 4, y: porTop - 0.6, z: POR.z1 - 2.5, color: 0xffb46a, intensity: 9, distance: 14, decay: 2, day: 0.0 });
    ctx.light({ x: SIDE.x + 1.2, y: P + 3.4, z: SIDE.z, color: 0xffc27a, intensity: 5, distance: 9, decay: 2, day: 0.0 });
  }

  // ================================================================= 7. levels of detail, update, stats, dispose
  for (const g of [gBase, gNear, gFar]) g.traverse((o) => { if (o.isMesh && o !== glass && !/contact-shade|blocker/.test(o.name)) o.receiveShadow = true; });
  const NEAR_IN = 200, NEAR_OUT = 215;
  let lod = low ? 'far' : 'near', forced = null;
  const center = new THREE_.Vector3(cx, P + 8, cz);
  const setLod = (name) => { lod = name; gNear.visible = name === 'near' && !low; gFar.visible = name !== 'near' || low; };
  setLod(lod);
  const _w = new THREE_.Vector3();
  let bannerT = 0;
  function update(dt, t) {
    const cam = G.sys.engine?.camera;
    if (!low && cam && !forced) {
      root.localToWorld(_w.copy(center));
      const d = cam.position.distanceTo(_w);
      if (lod === 'near' && d > NEAR_OUT) setLod('far');
      else if (lod === 'far' && d < NEAR_IN) setLod('near');
    }
    if (banners.length && gNear.visible && !G.settings?.reduceMotion) {
      bannerT += dt || 0;
      for (let i = 0; i < banners.length; i++) banners[i].rotation.y = Math.sin(bannerT * 0.9 + i * 1.7) * 0.12;
    }
    void t;
  }
  const countTris = (g) => { let n = 0, calls = 0; g.traverse((o) => { if (o.isMesh && o.visible !== false && o.material && o.material.visible !== false && o.geometry) { calls++; const gi = o.geometry; n += (gi.index ? gi.index.count : gi.attributes.position.count) / 3 * (o.isInstancedMesh ? o.count : 1); } }); return { tris: Math.round(n), calls }; };
  const api = {
    built: true, get lod() { return forced || lod; }, door: DOOR_SPOT, sideDoor: { x: SIDE.x + 1.2, y: P, z: SIDE.z }, terrace: { ...TER, y: P }, pad: { ...PAD }, stairs: { ...ST },
    office, podiumY: P, floors: { P, T1, T2, F3, coreTop, wingTop, porTop },
    root, groups: { base: gBase, near: gNear, far: gFar },
    setLod(name) { forced = name || null; if (name) setLod(name); },
    stats() { return { base: countTris(gBase), near: countTris(gNear), far: countTris(gFar), lod: forced || lod, low }; },
  };
  G.complexMain = api;
  return {
    update,
    dispose() {
      for (const f of disposers) { try { f(); } catch (e) { /* gone */ } }
      for (const b of blockers) { const i = G.world.cameraBlockers.indexOf(b); if (i >= 0) G.world.cameraBlockers.splice(i, 1); }
      for (const m of nightMats) { const L = G.world.nightMaterials || [], i = L.findIndex((e) => e && e.material === m); if (i >= 0) L.splice(i, 1); }
      root.traverse((o) => { if (o.isMesh && o.geometry && o.geometry !== K.Site.unitBox) o.geometry.dispose(); });
      for (const x of owned) { try { if (x.map && x.map.dispose) x.map.dispose(); x.dispose(); } catch (e) { /* gone */ } }
      root.parent?.remove(root);
      if (doorHandle && typeof doorHandle.remove === 'function') { try { doorHandle.remove(); } catch (e) { /* the place removes it */ } }
      if (G.complexMain === api) G.complexMain = { built: false };
    },
  };
}, 20);
