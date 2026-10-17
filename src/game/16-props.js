// =============================================================================
// 16-props.js — everything that is not a building: plaza paving, jangdokdae terraces + hundreds of
// instanced onggi jars, farm beds, fences, stone walls, signs, kiosks, exhibit tables, craft table,
// traditional tools, jar displays, shop goods, lanterns (night glow), benches, parking lot + cars,
// river deck, edu board, photo-zone frames.
//
//   G.sys.props (order 25)
//     plot(id) -> farm-bed group (userData.soilMaterial, soilTopY, size, rows)
//   Phase 4: the hanging 청사초롱 lanterns swing gently in the wind (vertex-shader pendulum around each hook;
//   2 draw calls for all of them, the night halo follows the swing); paving and decks darken and gain a wet
//   sheen while G.sys.weather.wetness is high.
//     jarCount                 number of decorative jars
//     anchors                  {id: group} of every interactive prop registered with G.world
// Static meshes are merged per material and per 44 m map cell (few draw calls, still frustum-culled).
// Interactive props are small groups holding an invisible pick/bounds proxy (G.world.registerObject).
// =============================================================================
(function () {
  const L = G.data.layout || {};
  const PI = Math.PI, TAU = PI * 2;
  const K = G.bkit;
  if (!K) {
    G.register({ name: 'props', order: 25, label: '소품', init() { throw new Error('building kit (15-buildings.js) missing'); } });
    return;
  }
  const { col, M, mul, I4, geo, Bucket, Site, tex, mat, registerMaterial, jarGeometry, lidGeometry, jarTop, SignAtlas, roof, roofBaseFor, roundRect, speckle, blotches, ctex, FONT, rngOf } = K;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const ground = (x, z) => { const y = G.world.terrainHeight(x, z); return Number.isFinite(y) ? y : 0; };
  const surf = (x, z) => { const y = G.world.surfaceHeight(x, z); return Number.isFinite(y) ? y : 0; };
  const V3 = (x, y, z) => new THREE.Vector3(x, y, z);

  // ---------------------------------------------------------------- regional buckets
  const CELL = 44;
  const cells = new Map();
  function BK(x, z) {
    const k = Math.floor(x / CELL) + ':' + Math.floor(z / CELL);
    let b = cells.get(k);
    if (!b) { b = new Bucket(); cells.set(k, b); }
    return b;
  }
  /** helper bound to one prop: add(key, geometry, localMatrix, colour) in a local frame at (x, y, z, rot) */
  function placer(x, y, z, rot = 0) {
    const base = M(x, y, z, rot);
    const B = BK(x, z);
    return { B, base, add: (key, g, m, c) => B.add(key, g, m ? mul(base, m) : base, c), x, y, z, rot, c: Math.cos(rot), s: Math.sin(rot),
      wx(lx, lz) { return x + lx * this.c + lz * this.s; }, wz(lx, lz) { return z - lx * this.s + lz * this.c; } };
  }
  const colliders = [];
  function boxCol(x, z, hw, hd, rot = 0, extra = {}) { colliders.push(G.world.addCollider({ shape: 'box', x, z, hw, hd, rot, tag: 'prop', ...extra })); }
  function circleCol(x, z, r, extra = {}) { colliders.push(G.world.addCollider({ shape: 'circle', x, z, r, tag: 'prop', ...extra })); }
  const walkables = [];
  function walkBox(x, z, hw, hd, top, surface = 'stone', rot = 0) { walkables.push(G.world.addWalkable({ shape: 'box', x, z, hw, hd, rot, top, surface })); }
  function walkCircle(x, z, r, top, surface = 'stone') { walkables.push(G.world.addWalkable({ shape: 'circle', x, z, r, top, surface })); }

  // ---------------------------------------------------------------- textures (props only)
  const PT = {};
  const ptex = (name, fn) => PT[name] || (PT[name] = fn());
  // ring-course paver: u 0..1 = 4 stones, v 0..1 = one course
  const paverTex = () => ptex('paver', () => G.gfx.canvasTexture(512, 128, (ctx, w, h) => {
    const r = rngOf('paver');
    ctx.fillStyle = '#58534b'; ctx.fillRect(0, 0, w, h);
    const tones = ['#9d968a', '#918a7e', '#a8a194', '#8a8478', '#999286', '#aea79a', '#8f897f', '#a39b8c'];
    const ws = [0.8 + r() * 0.4, 0.8 + r() * 0.4, 0.8 + r() * 0.4, 0.8 + r() * 0.4];
    const sum = ws.reduce((a, b) => a + b, 0);
    let x = 0;
    for (let i = 0; i < 4; i++) {
      const sw = ws[i] / sum * w;
      const y = 4 + r() * 3, sh = h - 8 - r() * 4;
      ctx.fillStyle = tones[(r() * tones.length) | 0];
      roundRect(ctx, x + 3, y, sw - 6, sh, 14); ctx.fill();
      const g = ctx.createLinearGradient(0, y, 0, y + sh);
      g.addColorStop(0, 'rgba(255,250,240,0.12)'); g.addColorStop(0.5, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.18)');
      ctx.fillStyle = g; roundRect(ctx, x + 3, y, sw - 6, sh, 14); ctx.fill();
      x += sw;
    }
    blotches(ctx, w, h, r, 14, ['#6d6a5a', '#b9b2a2'], 10, 30, 0.12);
    speckle(ctx, w, h, r, 3000, ['#46423c', '#d6d0c4', '#7b756b'], 0.06, 0.25);
  }, { repeat: [1, 1], anisotropy: 8 }));
  // square granite slabs (hall plaza, aisles): 2.4 m tile, 0.8 m slabs
  const pavementTex = () => ptex('pavement', () => G.gfx.canvasTexture(256, 256, (ctx, w, h) => {
    const r = rngOf('pavement');
    ctx.fillStyle = '#77726a'; ctx.fillRect(0, 0, w, h);
    const n = 3, s = w / n;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const l = 64 + r() * 10;
      ctx.fillStyle = `hsl(${34 + r() * 10},${5 + r() * 5}%,${l}%)`;
      ctx.fillRect(i * s + 2, j * s + 2, s - 4, s - 4);
    }
    speckle(ctx, w, h, r, 2600, ['#4f4b45', '#ece7dc', '#8a857b'], 0.05, 0.22);
  }, { repeat: [1 / 2.4, 1 / 2.4], anisotropy: 8 }));
  // plaza centre emblem: onggi jar inlay inside a lotus ring
  const emblemTex = () => ptex('emblem', () => G.gfx.canvasTexture(512, 512, (ctx, w) => {
    const r = rngOf('emblem'), c = w / 2;
    ctx.fillStyle = '#6a655c'; ctx.fillRect(0, 0, w, w);
    ctx.fillStyle = '#b8b2a6'; ctx.beginPath(); ctx.arc(c, c, c - 4, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#5c564d'; ctx.lineWidth = 16; ctx.beginPath(); ctx.arc(c, c, c - 22, 0, TAU); ctx.stroke();
    ctx.strokeStyle = '#d8d2c6'; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(c, c, c - 36, 0, TAU); ctx.stroke();
    // lotus petals
    ctx.fillStyle = '#8b7f6c';
    for (let i = 0; i < 16; i++) {
      const a = i / 16 * TAU;
      ctx.save(); ctx.translate(c + Math.cos(a) * (c - 70), c + Math.sin(a) * (c - 70)); ctx.rotate(a + PI / 2);
      ctx.beginPath(); ctx.ellipse(0, 0, 13, 26, 0, 0, TAU); ctx.fill(); ctx.restore();
    }
    // jar silhouette
    ctx.fillStyle = '#4f3a2b';
    ctx.beginPath();
    const jw = 120, jy = c + 95;
    ctx.moveTo(c - 52, jy);
    ctx.bezierCurveTo(c - jw - 25, jy - 70, c - jw, jy - 180, c - 62, jy - 205);
    ctx.lineTo(c - 66, jy - 228); ctx.lineTo(c + 66, jy - 228); ctx.lineTo(c + 62, jy - 205);
    ctx.bezierCurveTo(c + jw, jy - 180, c + jw + 25, jy - 70, c + 52, jy);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#3d2c20'; ctx.beginPath(); ctx.ellipse(c, jy - 236, 78, 16, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#5e4635'; ctx.beginPath(); ctx.ellipse(c, jy - 250, 22, 9, 0, 0, TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(214,190,150,0.65)'; ctx.lineWidth = 4;
    ctx.beginPath(); for (let x = -90; x <= 90; x += 4) { const y = jy - 140 + Math.sin(x / 90 * PI * 3) * 8; if (x === -90) ctx.moveTo(c + x, y); else ctx.lineTo(c + x, y); } ctx.stroke();
    ctx.fillStyle = '#efe6d2'; ctx.font = `800 34px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('전통발효', c, c + 140);
    speckle(ctx, w, w, r, 4000, ['#4d4943', '#ece7dc'], 0.05, 0.2);
  }, { anisotropy: 8 }));

  // ---------------------------------------------------------------- materials (props only)
  const STD = (o) => new THREE.MeshStandardMaterial(o);
  const OFF = { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 };
  registerMaterial('paver', () => STD({ map: paverTex(), vertexColors: true, roughness: 0.9, ...OFF }), { cast: false });
  registerMaterial('pavement', () => STD({ map: pavementTex(), vertexColors: true, roughness: 0.88, ...OFF }), { cast: false });
  registerMaterial('emblem', () => STD({ map: emblemTex(), vertexColors: true, roughness: 0.85, ...OFF }), { cast: false });
  registerMaterial('lines', () => STD({ vertexColors: true, roughness: 0.75, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6 }), { cast: false });
  registerMaterial('glazeI', () => STD({ map: tex('jar'), roughness: 0.3, metalness: 0.04 }));
  registerMaterial('silkBlue', () => { const m = STD({ vertexColors: true, color: 0x2f56b0, emissive: new THREE.Color('#5a6cff'), roughness: 0.75 }); G.world.addNightMaterial(m, 0.9, 0.0); return m; }, { cast: false });
  registerMaterial('silkRed', () => { const m = STD({ vertexColors: true, color: 0xc63a2c, emissive: new THREE.Color('#ff6a33'), roughness: 0.75 }); G.world.addNightMaterial(m, 1.6, 0.05); return m; }, { cast: false });
  const PSIGN = new SignAtlas('props', 1024, 2560);
  const SCREEN = new SignAtlas('kiosk', 1024, 1024);
  registerMaterial('psign', () => STD({ map: PSIGN.getTexture(), roughness: 0.75 }));
  registerMaterial('screen', () => {
    const m = STD({ map: SCREEN.getTexture(), emissiveMap: SCREEN.getTexture(), emissive: new THREE.Color('#ffffff'), roughness: 0.25, metalness: 0.1 });
    G.world.addNightMaterial(m, 1.25, 0.55);
    return m;
  }, { cast: false });

  // ---------------------------------------------------------------- small shared shapes
  const BOWL = [[0, 0.0], [0.55, 0], [0.7, 0.06], [0.9, 0.3], [1, 0.42], [0.95, 0.45], [0.88, 0.4], [0.7, 0.14], [0, 0.1]];
  const BOTTLE = [[0, 0], [0.07, 0], [0.075, 0.015], [0.075, 0.2], [0.065, 0.235], [0.03, 0.275], [0.024, 0.33], [0.03, 0.342], [0.026, 0.35], [0, 0.35]];
  const bowl = (r, seg = 14) => geo.lathe(BOWL.map(([a, b]) => [a * r, b * r]), seg);
  const bottle = (s = 1, seg = 10) => geo.lathe(BOTTLE.map(([a, b]) => [a * s, b * s]), seg);
  const sphere = (r, ws = 10, hs = 8) => new THREE.SphereGeometry(r, ws, hs);
  const rbox = (w, h, d, seg, rad) => (ADDONS.RoundedBoxGeometry ? new ADDONS.RoundedBoxGeometry(w, h, d, seg, rad) : geo.box(w, h, d));
  const mound = (r) => { const g = new THREE.SphereGeometry(r, 12, 6, 0, TAU, 0, PI / 2); g.scale(1, 0.38, 1); return g; };
  function smallPlate(text, sub, opts = {}) {
    return PSIGN.slot(192, 96, (ctx, w, h) => {
      const size = Math.round(h * (opts.k || (sub ? 0.36 : 0.44)));
      const t = G.gfx.signTexture(text, sub, { ...opts, w, h, size });
      ctx.drawImage(t.image, 0, 0); t.dispose();
    });
  }
  /** mini gable tile roof (sign boards, kiosks): width w, depth d, eave at local y of placer P */
  function tileCap(P, w, d, y, tint = '#ffffff') {
    const o = { mode: 'gable', hw: w / 2 - 0.12, hd: d / 2 - 0.1, ov: 0.14, rise: d * 0.36, t: 0.07, lift: 0.04, tint, gableColor: '#4a2f1c', wallTop: y, ridge: { w: 0.12, h: 0.12 }, vres: 0.6 };
    o.y = y + 0.02;
    roof(P.B, mul(P.base, M(0, 0, 0)), o);
  }
  /** vertical strip along an arc (my angle convention: x = cos a, z = sin a), centred on y = 0 */
  function arcWall(r, h, seg, a0, a1, inner = false) {
    return geo.grid(seg, 1, (i, j, o) => {
      const a = lerp(a0, a1, i / seg);
      o[0] = Math.cos(a) * r; o[2] = Math.sin(a) * r; o[1] = (j - 0.5) * h; o[3] = a * r; o[4] = j * h;
    }, !inner);
  }
  const proxies = {};
  function anchorGroup(id, x, y, z, rot, w, h, d, root, oy = 0) {
    const g = new THREE.Group(); g.name = id;
    g.position.set(x, y, z); g.rotation.y = rot;
    Site.proxy(g, 0, oy, 0, w, h, d);
    root.add(g);
    g.updateMatrixWorld(true);
    proxies[id] = g;
    G.world.registerObject(id, g);
    return g;
  }

  // =============================================================================================
  // builders
  // =============================================================================================
  function buildPlaza() {
    const pz = L.plaza; if (!pz) return;
    const gy = ground(pz.x, pz.z), y = gy + 0.05;
    const B = BK(pz.x, pz.z);
    const r = rngOf('plaza');
    const rIn = 2.5, rOut = pz.r - 0.35;
    // emblem disc
    B.add('emblem', (() => { const g = geo.disc(rIn, 48, 1); const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / (2 * rIn) + 0.5, uv.getY(i) / (2 * rIn) + 0.5); return g; })(), M(pz.x, y + 0.002, pz.z), '#ffffff');
    // concentric courses
    const nc = Math.round((rOut - rIn) / 0.56);
    const cw = (rOut - rIn) / nc;
    for (let k = 0; k < nc; k++) {
      const r0 = rIn + k * cw, r1 = r0 + cw, rm = (r0 + r1) / 2;
      const stones = Math.max(8, Math.round(TAU * rm / 0.62 / 4) * 4);
      const nseg = stones * 2;
      const off = r() * TAU;
      const accent = k === 0 || k % 6 === 5;
      const g = geo.grid(nseg, 1, (i, j, o) => {
        const a = off + i / nseg * TAU, rr = j ? r0 : r1;
        o[0] = Math.cos(a) * rr; o[1] = 0; o[2] = Math.sin(a) * rr; o[3] = i / nseg * (stones / 4); o[4] = j;
      }, true);
      const sh = 0.7 + r() * 0.08;
      const tint = accent ? new THREE.Color(0.52, 0.49, 0.45) : new THREE.Color(sh, sh * 0.97, sh * 0.92);
      B.add('paver', g, M(pz.x, y, pz.z), tint);
    }
    // raised granite curb ring
    const cr0 = rOut, cr1 = pz.r + 0.25;
    B.add('stone', geo.ring(cr0, cr1, 96), M(pz.x, y + 0.06, pz.z), '#cdc7bb');
    B.add('stone', geo.cyl(cr1, cr1, 0.2, 96, true), M(pz.x, y - 0.04, pz.z), '#bdb7ab');
    walkCircle(pz.x, pz.z, pz.r + 0.25, y, 'stone');
    // hall plaza: square granite slabs with a darker border
    const hp = L.hallPlaza;
    if (hp) {
      const hy = ground(hp.x, hp.z) + 0.05;
      const g = geo.box(hp.w, 0.02, hp.d, 'world');
      BK(hp.x, hp.z).add('pavement', g, M(hp.x, hy - 0.01, hp.z), '#c2baab');
      for (const s of [-1, 1]) {
        BK(hp.x, hp.z).add('stone', geo.box(hp.w + 0.6, 0.12, 0.45, 'world'), M(hp.x, hy, hp.z + s * (hp.d / 2 + 0.2)), '#b9b3a8');
        BK(hp.x, hp.z).add('stone', geo.box(0.45, 0.12, hp.d, 'world'), M(hp.x + s * (hp.w / 2 + 0.2), hy, hp.z), '#b9b3a8');
      }
      walkBox(hp.x, hp.z, hp.w / 2 + 0.4, hp.d / 2 + 0.4, hy + 0.01, 'stone');
    }
  }

  // ---------------------------------------------------------------- jangdokdae
  const JARS = { hangari: [], dok: [] };
  function addJar(kind, x, y, z, s, ry, tone) { JARS[kind].push({ x, y, z, s, ry, tone }); }
  function jarTone(r) {
    const v = 0.72 + r() * 0.36;
    return new THREE.Color(v * (0.98 + r() * 0.06), v * (0.94 + r() * 0.06), v * (0.9 + r() * 0.06));
  }
  function retainingBox(x, z, hw, hd, top, edges, rot = 0) {
    // field-stone walls on the requested edges ('n','s','e','w') + dressed capstones
    const B = BK(x, z);
    const th = 0.5, bot = -0.6;
    const h = top - 0.06 - bot;
    const defs = { w: [-hw + th / 2, 0, th, hd * 2], e: [hw - th / 2, 0, th, hd * 2], n: [0, -hd + th / 2, hw * 2, th], s: [0, hd - th / 2, hw * 2, th] };
    for (const e of edges) {
      const [lx, lz, w, d] = defs[e];
      B.add('field', geo.box(w, h, d, 'world', x + z * 0.3), mul(M(x, 0, z, rot), M(lx, bot + h / 2, lz)), '#ffffff');
      B.add('stone', geo.box(w + 0.06, 0.12, d + 0.06, 'world'), mul(M(x, 0, z, rot), M(lx, top - 0.02, lz)), '#c9c3b8');
    }
  }
  function buildJangdokdae() {
    const J = L.jangdokdae; if (!J) return;
    const r = rngOf('jangdok');
    const [P0, P1, P2] = J.platforms;
    const tops = {};
    // tier 1
    if (P0) {
      const gy = Math.max(0, ground(P0.x, P0.z));
      const top = P0.top + gy; tops.p0 = top;
      walkBox(P0.x, P0.z, P0.hw, P0.hd, top, 'stone', P0.rot || 0);
      BK(P0.x, P0.z).add('gravel', geo.box(P0.hw * 2 - 0.2, 0.04, P0.hd * 2 - 0.2, 'world'), M(P0.x, top - 0.02, P0.z), '#d6cfc2');
      retainingBox(P0.x, P0.z, P0.hw, P0.hd, top, ['w', 'n', 's']);
      // east wall split around the connecting step
      if (P1) {
        const zA = P1.z - P1.hd, zB = P1.z + P1.hd;
        const x = P0.x + P0.hw - 0.25;
        for (const [z0, z1] of [[P0.z - P0.hd, zA], [zB, P0.z + P0.hd]]) {
          if (z1 - z0 < 0.2) continue;
          retainingBox(x, (z0 + z1) / 2, 0.25, (z1 - z0) / 2, top, ['e']);
        }
      }
      // little steps where the paths arrive
      const steps = [[P0.x - P0.hw - 0.4, 2, 0.4, 1.6, 0], [30, P0.z - P0.hd - 0.4, 1.6, 0.4, 0], [30, P0.z + P0.hd + 0.4, 1.6, 0.4, 0]];
      for (const [x, z, hw, hd] of steps) {
        const st = gy + (top - gy) / 2;
        BK(x, z).add('stone', geo.box(hw * 2, st - gy + 0.3, hd * 2, 'world'), M(x, (st + gy - 0.3) / 2, z), '#cdc8be');
        walkBox(x, z, hw, hd, st, 'stone');
      }
      // decorative rows on stone slabs
      const R = J.rows;
      const aisle = R.aisleZ || [0, 0];
      const nRows = Math.round((R.x1 - R.x0) / R.step) + 1;
      for (let i = 0; i < nRows; i++) {
        const x = R.x0 + i * R.step;
        const sBase = 0.82 + i * 0.09;
        for (const [z0, z1] of [[R.z0, aisle[0] - 0.55], [aisle[1] + 0.55, R.z1]]) {
          if (z1 - z0 < 0.8) continue;
          BK(x, (z0 + z1) / 2).add('stone', geo.box(1.0, 0.12, z1 - z0 + 0.9, 'world'), M(x, top + 0.04, (z0 + z1) / 2), '#c2bcb1');
          boxCol(x, (z0 + z1) / 2, 0.55, (z1 - z0) / 2 + 0.45);
          const n = Math.max(1, Math.round((z1 - z0) / 1.06));
          for (let k = 0; k <= n; k++) {
            const z = lerp(z0, z1, k / n);
            const s = sBase * (0.93 + r() * 0.14);
            const kind = i >= 3 && r() < 0.35 ? 'dok' : 'hangari';
            addJar(kind, x + (r() - 0.5) * 0.08, top + 0.1, z, s * (kind === 'dok' ? 0.85 : 1), r() * TAU, jarTone(r));
          }
        }
      }
    }
    // connecting step + step up to the ring field
    if (P1) {
      const gy = Math.max(0, ground(P1.x, P1.z));
      const top = P1.top + gy; tops.p1 = top;
      walkBox(P1.x, P1.z, P1.hw, P1.hd, top, 'stone', P1.rot || 0);
      BK(P1.x, P1.z).add('gravel', geo.box(P1.hw * 2, 0.04, P1.hd * 2 - 0.2, 'world'), M(P1.x, top - 0.02, P1.z), '#d6cfc2');
      retainingBox(P1.x, P1.z, P1.hw, P1.hd, top, ['n', 's']);
    }
    // ring field with three terraces
    if (P2) {
      const cx = P2.x, cz = P2.z, R0 = P2.r;
      const gy = Math.max(0, ground(cx, cz));
      const base = P2.top + gy; tops.p2 = base;
      const rings = J.rings || { radii: [5, 7.4, 9.8, 12.2, 14.6, 17], spacing: 1.3, aisleWidth: 2.6, aisles: 4 };
      const T1 = 13.4, T2 = 8.6, DAIS = 3.3;
      const tAt = (rr) => (rr < T2 ? base + 0.4 : rr < T1 ? base + 0.2 : base);
      const B = BK(cx, cz);
      // retaining wall + capstones
      B.add('field', geo.cyl(R0, R0 + 0.12, base + 0.65, 120, true), M(cx, (base - 0.65) / 2, cz), '#ffffff');
      B.add('stone', geo.ring(R0 - 0.45, R0 + 0.18, 120), M(cx, base + 0.04, cz), '#c9c3b8');
      B.add('stone', geo.cyl(R0 + 0.18, R0 + 0.18, 0.12, 120, true), M(cx, base - 0.02, cz), '#d6d0c5');
      // terrace surfaces + risers
      B.add('gravel', geo.ring(T1, R0 - 0.4, 120), M(cx, base, cz), '#d6cfc2');
      B.add('gravel', geo.ring(T2, T1, 96), M(cx, base + 0.2, cz), '#cfc8bb');
      B.add('gravel', geo.ring(DAIS, T2, 72), M(cx, base + 0.4, cz), '#d6cfc2');
      for (const [rr, y0] of [[T1, base], [T2, base + 0.2]]) {
        B.add('stone', geo.cyl(rr, rr, 0.24, 96, true), M(cx, y0 + 0.1, cz), '#d8d2c6');
        B.add('stone', geo.ring(rr - 0.18, rr + 0.12, 96), M(cx, y0 + 0.215, cz), '#cfc9be');
      }
      walkCircle(cx, cz, R0, base, 'stone');
      walkCircle(cx, cz, T1, base + 0.2, 'stone');
      walkCircle(cx, cz, T2, base + 0.4, 'stone');
      // centre dais with a great jar
      B.add('stone', geo.cyl(DAIS, DAIS + 0.1, 0.3, 48), M(cx, base + 0.45, cz), '#d3cdc1');
      B.add('pavement', geo.disc(DAIS, 48), M(cx, base + 0.605, cz), '#ffffff');
      walkCircle(cx, cz, DAIS, base + 0.6, 'stone');
      const bigS = 1.9;
      B.add('stone', geo.cyl(1.0, 1.1, 0.2, 24), M(cx, base + 0.7, cz), '#bdb6aa');
      B.add('glaze', jarGeometry('dok', 24), M(cx, base + 0.8, cz, 0.4, bigS), '#ffffff');
      B.add('glaze', lidGeometry(20, 0.315), M(cx, base + 0.8 + jarTop('dok') * bigS - 0.02, cz, 0, bigS), '#ffffff');
      circleCol(cx, cz, 1.05);
      // aisles: paved strips crossing the terraces
      const aisleDirs = [];
      for (let i = 0; i < (rings.aisles || 4); i++) { const a = i / (rings.aisles || 4) * TAU; aisleDirs.push([Math.cos(a), Math.sin(a)]); }
      const aw = rings.aisleWidth || 2.6;
      for (const [dx, dz] of aisleDirs) {
        const ry = Math.atan2(dx, dz);
        for (const [r0, r1, y] of [[DAIS, T2, base + 0.4], [T2, T1, base + 0.2], [T1, R0 - 0.3, base]]) {
          const len = r1 - r0 - 0.05, rm = (r0 + r1) / 2;
          B.add('pavement', geo.box(aw - 0.3, 0.03, len, 'world'), M(cx + dx * rm, y + 0.01, cz + dz * rm, ry), '#ffffff');
        }
      }
      // stairs at the north and south aisle ends + cheek walls
      const gaps = [PI]; // west: connection to the tier-1 step
      for (const [dx, dz] of aisleDirs) {
        if (Math.abs(dz) < 0.5) continue;
        const ry = Math.atan2(dx, dz);
        gaps.push(Math.atan2(dz, dx));
        for (let s = 0; s < 3; s++) {
          const top = gy + (base - gy) * (3 - s) / 4;
          const d = R0 + 0.35 + s * 0.45;
          B.add('stone', geo.box(aw, top - gy + 0.4, 0.46, 'world', s), M(cx + dx * d, (top + gy - 0.4) / 2, cz + dz * d, ry), '#cdc8be');
          walkBox(cx + dx * d, cz + dz * d, aw / 2, 0.23, top, 'stone', ry);
        }
        for (const side of [-1, 1]) {
          const px = -dz * side, pzz = dx * side;
          const d = R0 + 0.8;
          const wx = cx + dx * d + px * (aw / 2 + 0.2), wz = cz + dz * d + pzz * (aw / 2 + 0.2);
          B.add('field', geo.box(0.4, base - gy + 0.5, 1.6, 'world'), M(wx, (base + gy) / 2 - 0.05, wz, ry), '#ffffff');
          B.add('stone', geo.box(0.46, 0.1, 1.66, 'world'), M(wx, base + 0.22, wz, ry), '#c9c3b8');
          boxCol(wx, wz, 0.22, 0.8, ry);
        }
      }
      // west step from the connecting platform (0.45 -> 0.9)
      if (P1) {
        const sx = cx - R0 - 0.1, top = (tops.p1 + base) / 2;
        BK(sx, P1.z).add('stone', geo.box(1.3, top - tops.p1 + 0.3, P1.hd * 2 - 0.8, 'world'), M(sx, (top + tops.p1 - 0.3) / 2, P1.z), '#cdc8be');
        walkBox(sx, P1.z, 0.65, P1.hd - 0.4, top, 'stone');
      }
      // skirt colliders (block ground walkers under the raised field, open at the gaps)
      const nSeg = 52;
      for (let i = 0; i < nSeg; i++) {
        const a = (i + 0.5) / nSeg * TAU;
        let skip = false;
        for (const g of gaps) { let d = Math.abs(((a - g) % TAU + TAU) % TAU); d = Math.min(d, TAU - d); if (d < (g === PI ? 0.2 : 0.09) + PI / nSeg) skip = true; }
        if (skip) continue;
        const px = cx + Math.cos(a) * (R0 - 0.1), pzz = cz + Math.sin(a) * (R0 - 0.1);
        const chord = 2 * R0 * Math.sin(PI / nSeg) + 0.1;
        boxCol(px, pzz, chord / 2, 0.3, Math.atan2(Math.cos(a), Math.sin(a)), { maxY: base });
      }
      // jar rings on stone ring slabs
      const spacing = rings.spacing || 1.3;
      for (const rr of rings.radii) {
        const y = tAt(rr);
        // slab arcs between aisles
        const half = (aw / 2 + 0.55) / rr;
        for (let i = 0; i < aisleDirs.length; i++) {
          const a0 = Math.atan2(aisleDirs[i][1], aisleDirs[i][0]) + half;
          let a1 = Math.atan2(aisleDirs[(i + 1) % aisleDirs.length][1], aisleDirs[(i + 1) % aisleDirs.length][0]) - half;
          while (a1 <= a0) a1 += TAU;
          const seg = Math.max(6, Math.round((a1 - a0) * rr / 0.6));
          B.add('stone', geo.ring(rr - 0.5, rr + 0.5, seg, -a1, -a0), M(cx, y + 0.1, cz), '#c5bfb4');
          for (const [rad, inner] of [[rr + 0.5, false], [rr - 0.5, true]]) B.add('stone', arcWall(rad, 0.1, seg, a0, a1, inner), M(cx, y + 0.05, cz), '#cdc7bb');
        }
        const n = Math.round(TAU * rr / spacing);
        const off = r() * TAU;
        const sBase = rr < 8 ? 0.8 : rr < 13 ? 0.9 : 1.0;
        for (let i = 0; i < n; i++) {
          const a = off + i / n * TAU;
          const px = Math.cos(a) * rr, pzz = Math.sin(a) * rr;
          let blocked = false;
          for (const [dx, dz] of aisleDirs) {
            const along = px * dx + pzz * dz;
            if (along <= 0) continue;
            const perp = Math.abs(-px * dz + pzz * dx);
            if (perp < aw / 2 + 0.42) { blocked = true; break; }
          }
          if (blocked) continue;
          const s = sBase * (0.9 + r() * 0.2);
          const kind = rr > 13 && r() < 0.3 ? 'dok' : 'hangari';
          addJar(kind, cx + px, y + 0.1, cz + pzz, s * (kind === 'dok' ? 0.85 : 1), r() * TAU, jarTone(r));
          circleCol(cx + px, cz + pzz, 0.4 * s);
        }
      }
    }
    return tops;
  }
  function buildJarInstances(root) {
    const qual = G.sys.engine?.preset?.name || 'medium';
    const seg = qual === 'low' ? 8 : qual === 'high' ? 14 : 12;
    const shadows = true; // the renderer's shadow-map switch decides (quality may change at runtime)
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), s = new THREE.Vector3();
    const material = mat('glazeI');
    let total = 0;
    const lids = [];
    for (const kind of ['hangari', 'dok']) {
      const list = JARS[kind];
      if (!list.length) continue;
      const g = jarGeometry(kind, seg);
      const im = new THREE.InstancedMesh(g, material, list.length);
      im.name = 'jars-' + kind;
      const rimR = kind === 'dok' ? 0.315 : 0.292;
      list.forEach((j, i) => {
        e.set(0, j.ry, 0); q.setFromEuler(e);
        m4.compose(p.set(j.x, j.y, j.z), q, s.set(j.s, j.s * (0.96 + ((i * 7919) % 13) / 100), j.s));
        im.setMatrixAt(i, m4);
        im.setColorAt(i, j.tone);
        lids.push({ x: j.x, y: j.y + jarTop(kind) * s.y - 0.012, z: j.z, s: j.s * rimR / 0.29, ry: j.ry, tone: j.tone });
      });
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
      im.castShadow = shadows; im.receiveShadow = true;
      im.computeBoundingSphere?.();
      root.add(im);
      total += list.length;
    }
    if (lids.length) {
      const im = new THREE.InstancedMesh(lidGeometry(Math.max(8, seg - 3), 0.29), material, lids.length);
      im.name = 'jar-lids';
      lids.forEach((l, i) => {
        e.set(0, l.ry, 0); q.setFromEuler(e);
        m4.compose(p.set(l.x, l.y, l.z), q, s.set(l.s, l.s, l.s));
        im.setMatrixAt(i, m4);
        im.setColorAt(i, l.tone);
      });
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
      im.castShadow = shadows; im.receiveShadow = true;
      im.computeBoundingSphere?.();
      root.add(im);
    }
    return total;
  }

  // ---------------------------------------------------------------- farm beds + fences
  const plotGroups = {};
  function buildPlots(root) {
    const baseSoil = new THREE.MeshStandardMaterial({ map: tex('soil'), roughness: 1, color: 0xffffff });
    for (const p of L.farmPlots || []) {
      const gy = ground(p.x, p.z), rot = p.rot || 0;
      const P = placer(p.x, gy, p.z, rot);
      const w = p.w, d = p.d, bh = 0.36, bt = 0.12;
      // raised-bed frame
      for (const s of [-1, 1]) {
        P.add('wood', geo.box(w, bh, bt, 'grain', p.x), M(0, bh / 2, s * (d / 2 - bt / 2)), '#b48d63');
        P.add('wood', geo.box(bt, bh, d - bt * 2, 'grain', p.z), M(s * (w / 2 - bt / 2), bh / 2, 0), '#a8825a');
      }
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) P.add('wood', geo.box(0.16, bh + 0.08, 0.16, 'grain'), M(sx * (w / 2 - 0.08), (bh + 0.08) / 2, sz * (d / 2 - 0.08)), '#7f5d3e');
      // soil with crop-row ridges along local X
      const iw = w - bt * 2, id = d - bt * 2;
      const rows = Math.max(3, Math.round(id / 0.75));
      const sp = id / rows;
      const nz = rows * 6;
      const soilY = 0.27;
      const g = geo.grid(2, nz, (i, j, o) => {
        const x = -iw / 2 + iw * i / 2, z = id / 2 - id * j / nz;
        const ph = ((id / 2 - z) / sp) * TAU;
        o[0] = x; o[2] = z; o[1] = soilY - 0.045 * Math.cos(ph);
        o[3] = x; o[4] = (id / 2 - z) / sp * 0.7;
      }, false);
      const m = baseSoil.clone();
      const mesh = new THREE.Mesh(g, m);
      mesh.receiveShadow = true; mesh.castShadow = false; mesh.name = 'soil';
      const grp = new THREE.Group(); grp.name = p.id;
      grp.position.set(p.x, gy, p.z); grp.rotation.y = rot;
      grp.add(mesh);
      grp.userData.soilMaterial = m;
      grp.userData.soilColor = '#ffffff';
      grp.userData.soilTopY = gy + soilY + 0.045;
      grp.userData.size = { w: iw, d: id };
      grp.userData.rows = { count: rows, spacing: sp, axis: 'x', z: Array.from({ length: rows }, (_, k) => id / 2 - (k + 0.5) * sp) };
      grp.userData.plot = p;
      root.add(grp); grp.updateMatrixWorld(true);
      plotGroups[p.id] = grp;
      G.world.registerObject(p.id, grp);
      walkBox(p.x, p.z, w / 2, d / 2, gy + soilY + 0.03, 'dirt', rot);
      // number stake at the front-left corner
      const isHerb = p.zone === 'ZONE_HERB';
      const rect = smallPlate(String(p.label), isHerb ? '허브밭' : '작물밭', { k: 0.42, bg1: '#8a5d36', bg2: '#6a4426' });
      const sx = -w / 2 - 0.25, sz = d / 2 + 0.25;
      P.add('wood', geo.box(0.07, 0.75, 0.07), M(sx, 0.375, sz), '#6a4a30');
      P.add('psign', geo.quad(0.5, 0.25, rect), M(sx, 0.78, sz + 0.04, 0, 1, 1, 1, -0.25));
      P.add('wood', geo.box(0.56, 0.31, 0.04), M(sx, 0.78, sz, 0, 1, 1, 1, -0.25), '#4a2f1c');
    }
  }
  function fence(x0, z0, x1, z1, tint = '#9a7a55') {
    const len = Math.hypot(x1 - x0, z1 - z0); if (len < 0.3) return;
    const n = Math.max(1, Math.ceil(len / 2.1));
    const ry = Math.atan2(z1 - z0, x1 - x0);
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    const B = BK(cx, cz);
    const yAt = (x, z) => ground(x, z);
    for (let i = 0; i <= n; i++) {
      const t = i / n, x = lerp(x0, x1, t), z = lerp(z0, z1, t), y = yAt(x, z);
      B.add('wood', geo.box(0.11, 0.85, 0.11, 'grain'), M(x, y + 0.42 - 0.05, z, -ry), '#7f5f40');
      B.add('wood', geo.cyl(0.0, 0.08, 0.08, 4), M(x, y + 0.84, z, -ry + PI / 4), '#7f5f40');
    }
    for (let i = 0; i < n; i++) {
      const t0 = i / n, t1 = (i + 1) / n;
      const ax = lerp(x0, x1, t0), az = lerp(z0, z1, t0), bx = lerp(x0, x1, t1), bz = lerp(z0, z1, t1);
      const ay = yAt(ax, az), by = yAt(bx, bz);
      for (const h of [0.32, 0.64]) B.add('wood', geo.beam(ax, ay + h, az, bx, by + h, bz, 0.05, 0.08), I4, tint);
    }
    boxCol(cx, cz, len / 2, 0.1, -ry);
  }
  function buildFences() {
    // crop grid (3 x 2 plots) with openings at every path
    const cz0 = -21.8, cz1 = -43.4, cx = 16.4;
    for (const z of [cz0, cz1]) for (const [a, b] of [[-cx, -7.2], [-3.8, 3.8], [7.2, cx]]) fence(a, z, b, z);
    for (const x of [-cx, cx]) for (const [a, b] of [[cz0, -30.3], [-33.7, cz1]]) fence(x, a, x, b);
    // herb garden
    const hx0 = -53.6, hx1 = -34.4, hz0 = -20.4, hz1 = -39.6;
    for (const z of [hz0, hz1]) for (const [a, b] of [[hx0, -45.6], [-42.4, hx1]]) fence(a, z, b, z, '#a08260');
    fence(hx1, hz0, hx1, -28.4, '#a08260'); fence(hx1, -31.6, hx1, hz1, '#a08260');
    fence(hx0, hz0, hx0, -29.7, '#a08260'); fence(hx0, -33.3, hx0, hz1, '#a08260');
  }

  // ---------------------------------------------------------------- stone walls (돌담 with tile coping)
  function buildStoneWalls() {
    for (const w of L.stoneWalls || []) {
      const [x0, z0, x1, z1] = w;
      const len = Math.hypot(x1 - x0, z1 - z0); if (len < 0.3) continue;
      const n = Math.max(1, Math.round(len / 3));
      const ry = -Math.atan2(z1 - z0, x1 - x0);
      for (let i = 0; i < n; i++) {
        const t0 = i / n, t1 = (i + 1) / n;
        const ax = lerp(x0, x1, t0), az = lerp(z0, z1, t0), bx = lerp(x0, x1, t1), bz = lerp(z0, z1, t1);
        const cx = (ax + bx) / 2, cz = (az + bz) / 2, l = len / n + 0.02;
        const y = ground(cx, cz);
        const B = BK(cx, cz);
        B.add('field', geo.box(l, 1.25, 0.62, 'world', cx + cz), M(cx, y + 0.32, cz, ry), '#ffffff');
        B.add('plaster', geo.box(l, 0.08, 0.7), M(cx, y + 0.98, cz, ry), '#d9d3c6');
        for (const s of [-1, 1]) B.add('roof', geo.box(l + 0.02, 0.05, 0.56, 'world'), mul(M(cx, y + 1.1, cz, ry), M(0, 0, s * 0.24, 0, 1, 1, 1, s * 0.38)), '#ffffff');
        B.add('plaster', geo.box(l + 0.02, 0.1, 0.14), M(cx, y + 1.24, cz, ry), '#4d5054');
        boxCol(cx, cz, l / 2, 0.36, ry);
      }
      for (const [x, z] of [[x0, z0], [x1, z1]]) BK(x, z).add('field', geo.box(0.7, 1.35, 0.7, 'world'), M(x, ground(x, z) + 0.37, z, ry), '#f2efe8');
    }
  }

  // ---------------------------------------------------------------- signs
  let mapTex = null;
  function drawMap(ctx, w, h) {
    // wooden frame + parchment
    ctx.fillStyle = '#6b4728'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#f3ead6'; ctx.fillRect(18, 18, w - 36, h - 36);
    ctx.fillStyle = '#2f7d4a'; ctx.fillRect(18, 18, w - 36, 78);
    ctx.fillStyle = '#ffffff'; ctx.font = `800 46px ${FONT}`; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText('전통발효체험관 안내도', 44, 58);
    ctx.font = `600 22px ${FONT}`; ctx.textAlign = 'right'; ctx.fillStyle = '#d8f0dd';
    ctx.fillText(G.data.meta?.address || '', w - 40, 60);
    // map area
    const mx = 36, my = 112, mw = 560, mh = h - my - 36;
    ctx.fillStyle = '#cfe1b4'; ctx.fillRect(mx, my, mw, mh);
    const X0 = -105, X1 = 105, Z0 = -118, Z1 = 100;
    const sc = Math.min(mw / (X1 - X0), mh / (Z1 - Z0));
    const ox = mx + (mw - (X1 - X0) * sc) / 2, oy = my + (mh - (Z1 - Z0) * sc) / 2;
    const P = (x, z) => [ox + (x - X0) * sc, oy + (z - Z0) * sc];
    ctx.save(); ctx.beginPath(); ctx.rect(mx, my, mw, mh); ctx.clip();
    // river
    if (L.river) { ctx.strokeStyle = '#6fb3d6'; ctx.lineWidth = L.river.width * sc; ctx.lineCap = 'round'; ctx.beginPath(); L.river.points.forEach(([x, z], i) => { const [a, b] = P(x, z); if (i) ctx.lineTo(a, b); else ctx.moveTo(a, b); }); ctx.stroke(); }
    // roads + paths
    for (const r of L.roads || []) { ctx.strokeStyle = '#6d6a64'; ctx.lineWidth = r.width * sc; ctx.lineJoin = 'round'; ctx.beginPath(); r.points.forEach(([x, z], i) => { const [a, b] = P(x, z); if (i) ctx.lineTo(a, b); else ctx.moveTo(a, b); }); ctx.stroke(); }
    for (const p of L.paths || []) { ctx.strokeStyle = p.type === 'stone' ? '#b9b1a0' : p.type === 'wood' ? '#a4794d' : '#c9ad84'; ctx.lineWidth = Math.max(2, p.width * sc); ctx.beginPath(); p.points.forEach(([x, z], i) => { const [a, b] = P(x, z); if (i) ctx.lineTo(a, b); else ctx.moveTo(a, b); }); ctx.stroke(); }
    // zones
    for (const zn of G.data.zones || []) {
      const [a, b] = P(zn.center[0], zn.center[1]);
      ctx.fillStyle = zn.color + '55'; ctx.strokeStyle = zn.color; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(a, b, zn.r * sc, 0, TAU); ctx.fill(); ctx.stroke();
    }
    // buildings
    for (const bd of L.buildings || []) {
      const [a, b] = P(bd.x, bd.z);
      ctx.save(); ctx.translate(a, b); ctx.rotate(-(bd.rot || 0));
      ctx.fillStyle = bd.type === 'hall' ? '#4b5563' : '#5b4636';
      ctx.fillRect(-bd.w * sc / 2, -bd.d * sc / 2, bd.w * sc, bd.d * sc);
      ctx.restore();
    }
    // labels
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const zn of G.data.zones || []) {
      const [a, b] = P(zn.center[0], zn.center[1]);
      ctx.font = `800 17px ${FONT}`;
      const t = zn.short || zn.name;
      const tw = ctx.measureText(t).width + 14;
      ctx.fillStyle = 'rgba(255,255,255,0.85)'; roundRect(ctx, a - tw / 2, b - 12, tw, 24, 10); ctx.fill();
      ctx.fillStyle = '#23302a'; ctx.fillText(t, a, b);
    }
    // you are here
    const s = (L.signs || []).find((q) => q.action === 'map');
    if (s) {
      const [a, b] = P(s.x, s.z);
      ctx.fillStyle = '#e0453a'; ctx.beginPath(); ctx.arc(a, b, 9, 0, TAU); ctx.fill();
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 3; ctx.stroke();
    }
    ctx.restore();
    ctx.strokeStyle = '#6b4728'; ctx.lineWidth = 4; ctx.strokeRect(mx, my, mw, mh);
    // legend
    const lx = mx + mw + 26;
    ctx.textAlign = 'left'; ctx.fillStyle = '#3a2a1c'; ctx.font = `800 26px ${FONT}`;
    ctx.fillText('구역 안내', lx, my + 20);
    let ly = my + 62;
    for (const zn of G.data.zones || []) {
      ctx.fillStyle = zn.color; ctx.beginPath(); ctx.arc(lx + 10, ly, 9, 0, TAU); ctx.fill();
      ctx.fillStyle = '#2f261c'; ctx.font = `700 21px ${FONT}`; ctx.fillText(zn.name, lx + 28, ly + 1);
      ly += 33;
      if (ly > h - 70) break;
    }
    ctx.fillStyle = '#e0453a'; ctx.beginPath(); ctx.arc(lx + 10, h - 52, 9, 0, TAU); ctx.fill();
    ctx.fillStyle = '#2f261c'; ctx.font = `700 21px ${FONT}`; ctx.fillText('현재 위치', lx + 28, h - 51);
  }
  function buildSigns(root) {
    for (const s of L.signs || []) {
      const gy = ground(s.x, s.z), rot = s.rot || 0;
      const P = placer(s.x, gy, s.z, rot);
      const isMap = s.action === 'map', isEntrance = s.id === 'SIGN_ENTRANCE';
      const bw = isMap ? 2.6 : isEntrance ? 3.2 : 1.7, bh = isMap ? 1.62 : isEntrance ? 1.0 : 0.85;
      const by = isMap ? 1.55 : isEntrance ? 1.75 : 1.4;
      const postH = by + bh / 2 + 0.25;
      for (const sx of [-1, 1]) {
        P.add('stone', geo.box(0.32, 0.2, 0.32), M(sx * (bw / 2 - 0.05), 0.1, 0), '#d2ccc0');
        P.add('wood', geo.box(0.13, postH, 0.13, 'grain'), M(sx * (bw / 2 - 0.05), postH / 2, 0), '#6e4a2c');
      }
      P.add('wood', geo.box(bw + 0.16, bh + 0.16, 0.09), M(0, by, -0.02), '#5a3a22');
      let rect;
      if (isMap) {
        if (!mapTex) {
          mapTex = G.gfx.canvasTexture(1024, 640, drawMap, { anisotropy: 8 });
          registerMaterial('mapboard', () => new THREE.MeshStandardMaterial({ map: mapTex, roughness: 0.8 }));
        }
        P.add('mapboard', geo.quad(bw, bh), M(0, by, 0.03));
      } else {
        const sub = s.action === 'edu' ? '가까이 와서 E 키로 살펴보기' : isEntrance ? '한국 전통발효문화와 농업을 배우는 3D 체험관' : null;
        rect = PSIGN.sign(s.title, sub, { size: isEntrance ? 62 : 54 }, isEntrance ? 1024 : 384, isEntrance ? 320 : 192);
        P.add('psign', geo.quad(bw, bh, rect), M(0, by, 0.03));
      }
      tileCap(P, bw + 0.4, 0.62, by + bh / 2 + 0.12);
      anchorGroup(s.id, s.x, gy, s.z, rot, bw + 0.2, postH + 0.3, 0.5, root);
      boxCol(s.x, s.z, bw / 2 + 0.05, 0.18, rot);
    }
  }

  // ---------------------------------------------------------------- kiosks
  function drawScreen(title, sub) {
    return (ctx, w, h) => {
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#0f3a2c'); g.addColorStop(1, '#0a2119');
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#2f7d4a'; ctx.fillRect(0, 0, w, 46);
      ctx.fillStyle = '#e9f7ec'; ctx.font = `700 24px ${FONT}`; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillText('전통발효 배움터', 22, 24);
      ctx.textAlign = 'right'; ctx.fillStyle = '#ffd766'; ctx.fillText('● 터치', w - 20, 24);
      // jar icon
      ctx.fillStyle = '#c98b52';
      const cx = 92, cy = h * 0.58;
      ctx.beginPath(); ctx.moveTo(cx - 26, cy + 52); ctx.bezierCurveTo(cx - 70, cy + 10, cx - 60, cy - 42, cx - 30, cy - 52); ctx.lineTo(cx + 30, cy - 52); ctx.bezierCurveTo(cx + 60, cy - 42, cx + 70, cy + 10, cx + 26, cy + 52); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#8a5a34'; ctx.fillRect(cx - 34, cy - 62, 68, 12);
      ctx.fillStyle = '#ffffff'; ctx.textAlign = 'left';
      let size = 52; ctx.font = `800 ${size}px ${FONT}`;
      while (ctx.measureText(title).width > w - 200 && size > 24) { size -= 2; ctx.font = `800 ${size}px ${FONT}`; }
      ctx.fillText(title, 176, h * 0.48);
      ctx.fillStyle = '#9fe0b4'; ctx.font = `600 24px ${FONT}`;
      ctx.fillText(sub, 178, h * 0.7);
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      for (let y = 50; y < h; y += 4) ctx.fillRect(0, y, w, 1);
    };
  }
  function buildKiosks(root) {
    for (const k of L.kiosks || []) {
      const gy = ground(k.x, k.z), rot = k.rot || 0;
      const P = placer(k.x, gy, k.z, rot);
      P.add('stone', geo.box(1.25, 0.14, 0.8, 'world'), M(0, 0.07, 0), '#d6d0c4');
      for (const sx of [-1, 1]) P.add('wood', geo.box(0.12, 2.3, 0.12, 'grain'), M(sx * 0.52, 0.14 + 1.15, -0.18), '#6e4a2c');
      P.add('wood', geo.box(1.16, 0.12, 0.14, 'grain'), M(0, 2.36, -0.18), '#3f7f6c');
      tileCap(P, 1.4, 0.8, 2.42);
      P.add('plank', geo.box(0.62, 0.86, 0.32, 'world'), M(0, 0.14 + 0.43, -0.1), '#b88a5a');
      P.add('metal', geo.box(0.2, 0.36, 0.16), M(0, 1.15, -0.12), '#3a3f45');
      const tilt = -0.32;
      P.add('metal', geo.box(0.92, 0.64, 0.1), mul(M(0, 1.42, -0.04), M(0, 0, 0, 0, 1, 1, 1, tilt)), '#2c3136');
      const rect = SCREEN.slot(512, 320, drawScreen(k.title, '눌러서 배워 보세요'));
      P.add('screen', geo.quad(0.82, 0.54, rect), mul(M(0, 1.42, -0.04), M(0, 0, 0.056, 0, 1, 1, 1, tilt)));
      anchorGroup(k.id, k.x, gy, k.z, rot, 1.2, 2.5, 0.9, root);
      boxCol(k.x, k.z, 0.62, 0.4, rot);
    }
  }

  // ---------------------------------------------------------------- exhibit tables + craft table
  function table(P, w, d, h, tint = '#8a5a36') {
    P.add('wood', geo.box(w, 0.07, d, 'grain'), M(0, h - 0.035, 0), tint);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) P.add('wood', geo.box(0.08, h - 0.07, 0.08, 'grain'), M(sx * (w / 2 - 0.08), (h - 0.07) / 2, sz * (d / 2 - 0.08)), '#5e3d24');
    for (const sz of [-1, 1]) P.add('wood', geo.box(w - 0.2, 0.1, 0.04, 'grain'), M(0, h - 0.12, sz * (d / 2 - 0.08)), '#5e3d24');
  }
  function smallJar(P, x, y, z, s, kind = 'danji', lid = true) {
    P.add('glaze', jarGeometry(kind, 12), M(x, y, z, x * 3, s), '#ffffff');
    if (lid) P.add('glaze', lidGeometry(10, kind === 'danji' ? 0.18 : 0.29), M(x, y + jarTop(kind) * s - 0.006, z, 0, s), '#ffffff');
  }
  function buildExhibits(root) {
    const r = rngOf('exhibits');
    const y0 = 0.8;
    for (const ex of L.exhibits || []) {
      const gy = ground(ex.x, ex.z), rot = ex.rot || 0;
      const P = placer(ex.x, gy, ex.z, rot);
      table(P, 1.7, 0.85, y0);
      P.add('paint', geo.box(1.76, 0.012, 0.4), M(0, y0 + 0.006, 0), r() < 0.5 ? '#3b4d7a' : '#8f2f2f');
      const food = ex.food;
      if (food === 'ITEM_DOENJANG') {
        P.add('glaze', bowl(0.24), M(-0.35, y0, 0.02), '#ffffff');
        P.add('glossy', mound(0.2), M(-0.35, y0 + 0.08, 0.02), '#7b5531');
        smallJar(P, 0.3, y0, -0.1, 0.9);
        P.add('wood', geo.beam(-0.05, y0 + 0.03, 0.22, 0.2, y0 + 0.05, 0.12, 0.04, 0.02), I4, '#c49a6c');
        // meju block
        P.add('paint', rbox(0.22, 0.15, 0.16, 2, 0.03), M(0.62, y0 + 0.075, 0.18), '#b98a55');
      } else if (food === 'ITEM_GANJANG') {
        P.add('glaze', bowl(0.22), M(-0.4, y0, 0.05), '#ffffff');
        P.add('glossy', geo.cyl(0.19, 0.19, 0.01, 18), M(-0.4, y0 + 0.075, 0.05), '#1e0d06');
        P.add('glossy', bottle(1.6), M(0.05, y0, -0.12), '#3a1a0c');
        P.add('paint', geo.cyl(0.04, 0.04, 0.05, 8), M(0.05, y0 + 0.56, -0.12), '#c0392b');
        smallJar(P, 0.45, y0, 0.05, 0.85);
      } else if (food === 'ITEM_GOCHUJANG') {
        P.add('glaze', bowl(0.24), M(-0.3, y0, 0.05), '#ffffff');
        P.add('glossy', mound(0.2), M(-0.3, y0 + 0.08, 0.05), '#a8261c');
        P.add('glaze', jarGeometry('danji', 12), M(0.35, y0, -0.08, 0, 1.05), '#ffffff');
        P.add('glossy', geo.cyl(0.15, 0.15, 0.01, 14), M(0.35, y0 + jarTop('danji') * 1.05 - 0.02, -0.08), '#b02a1e');
        P.add('glaze', lidGeometry(10, 0.18), M(0.62, y0 + 0.02, 0.18, 0, 1, 1, 1, 0.4), '#ffffff');
      } else if (food === 'ITEM_KIMCHI') {
        P.add('glaze', bowl(0.3), M(-0.3, y0, 0.03), '#ffffff');
        for (let i = 0; i < 7; i++) {
          const a = i / 7 * TAU, rr = 0.11;
          const g = sphere(0.07, 8, 6); g.scale(1, 0.55, 2.0);
          P.add('glossy', g, M(-0.3 + Math.cos(a) * rr, y0 + 0.14, 0.03 + Math.sin(a) * rr, a), i % 3 ? '#c2412a' : '#d75a35');
          if (i % 2 === 0) { const t = sphere(0.04, 6, 4); t.scale(1, 0.4, 1.6); P.add('glossy', t, M(-0.3 + Math.cos(a) * (rr + 0.1), y0 + 0.15, 0.03 + Math.sin(a) * (rr + 0.1), a), '#b9c96a'); }
        }
        smallJar(P, 0.38, y0, -0.05, 0.62, 'hangari');
      } else {
        for (let i = 0; i < 3; i++) {
          P.add('glossy', bottle(1.3 + i * 0.15), M(-0.45 + i * 0.22, y0, -0.1 + (i % 2) * 0.12), i === 1 ? '#d29a2a' : '#b97814');
          P.add('paint', geo.cyl(0.035, 0.035, 0.05, 8), M(-0.45 + i * 0.22, y0 + 0.35 * (1.3 + i * 0.15) + 0.02, -0.1 + (i % 2) * 0.12), '#e8dcc0');
        }
        smallJar(P, 0.45, y0, 0.0, 0.8);
        P.add('glaze', bowl(0.08), M(0.15, y0, 0.24), '#ffffff');
      }
      const rect = smallPlate(ex.title, '전통 발효식품', {});
      P.add('wood', geo.box(0.34, 0.22, 0.03), mul(M(0, y0 + 0.13, 0.36), M(0, 0, 0, 0, 1, 1, 1, -0.5)), '#4a2f1c');
      P.add('psign', geo.quad(0.32, 0.16, rect), mul(M(0, y0 + 0.13, 0.36), M(0, 0, 0.018, 0, 1, 1, 1, -0.5)));
      // shade canopy (차일) on four thin poles
      const ch = 2.15;
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) P.add('wood', geo.box(0.06, ch, 0.06, 'grain'), M(sx * 1.0, ch / 2, sz * 0.62), '#6e4a2c');
      const cloth = (dy, flip) => geo.grid(8, 6, (i, j, o) => {
        const u = i / 8 * 2 - 1, v = j / 6 * 2 - 1;
        o[0] = u * 1.12; o[2] = -v * 0.76; o[1] = ch + 0.02 - 0.1 * (1 - u * u) * (1 - 0.4 * v * v) + dy; o[3] = i / 8; o[4] = j / 6;
      }, flip);
      P.add('paint', cloth(0, false), null, '#f1e8d3');
      P.add('paint', cloth(-0.012, true), null, '#d9ccb1');
      const band = r() < 0.5 ? '#8f2f2f' : '#2f4f8a';
      P.add('paint', geo.box(2.26, 0.13, 0.02), M(0, ch - 0.04, 0.77), band);
      P.add('paint', geo.box(2.26, 0.13, 0.02), M(0, ch - 0.04, -0.77), band);
      anchorGroup(ex.id, ex.x, gy, ex.z, rot, 1.8, 1.25, 0.95, root);
      boxCol(ex.x, ex.z, 1.04, 0.66, rot);
    }
    // craft table under a small tiled shade roof
    const ct = L.craftTable;
    if (ct) {
      const gy = ground(ct.x, ct.z), rot = ct.rot || 0;
      const P = placer(ct.x, gy, ct.z, rot);
      const y = 0.82;
      table(P, 2.4, 1.1, y, '#9a6a40');
      P.add('wood', geo.box(2.2, 0.04, 0.9, 'grain'), M(0, 0.25, 0), '#7a5236');
      // bean bowl
      P.add('wood', bowl(0.3), M(-0.75, y, 0.05), '#a8794b');
      const br = rngOf('beans');
      for (let i = 0; i < 46; i++) { const a = br() * TAU, rr = Math.sqrt(br()) * 0.24; P.add('paint', new THREE.IcosahedronGeometry(0.028, 0), M(-0.75 + Math.cos(a) * rr, y + 0.1 + br() * 0.04, 0.05 + Math.sin(a) * rr), '#d9c08a'); }
      // meju blocks with straw ties
      for (let i = 0; i < 3; i++) {
        const x = -0.15 + i * 0.3;
        P.add('paint', rbox(0.24, 0.16, 0.17, 2, 0.035), M(x, y + 0.08, -0.22, 0.1 * i), '#b88752');
        P.add('thatch', geo.box(0.03, 0.18, 0.19), M(x, y + 0.08, -0.22, 0.1 * i), '#e1c98f');
      }
      // stone mortar + pestle, paddle, straw bundle
      P.add('stone', geo.lathe([[0, 0], [0.18, 0], [0.2, 0.04], [0.21, 0.2], [0.17, 0.22], [0.12, 0.12], [0, 0.1]], 12), M(0.75, y, 0.12), '#9a968e');
      P.add('wood', geo.tube(0.75, y + 0.12, 0.12, 0.9, y + 0.45, 0.3, 0.025, 6), I4, '#b58a5c');
      P.add('wood', geo.beam(0.25, y + 0.02, 0.32, 0.75, y + 0.02, 0.4, 0.09, 0.025), I4, '#c49a6c');
      P.add('thatch', geo.cyl(0.07, 0.08, 0.45, 10), M(1.0, y + 0.08, -0.32, 0.4, 1, 1, 1, 0, PI / 2), '#e1c98f');
      // shade roof on four posts
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) P.add('wood', geo.box(0.12, 2.3, 0.12, 'grain'), M(sx * 1.3, 1.15, sz * 0.75), '#6e4a2c');
      const ro = { mode: 'gable', hw: 1.3, hd: 0.75, ov: 0.45, rise: 0.75, t: 0.16, tint: '#ffffff', gableColor: '#6b4a30', wallTop: 2.3, ridge: { w: 0.24, h: 0.24 } };
      ro.y = roofBaseFor(ro, 2.32);
      roof(P.B, P.base, ro);
      const rect = smallPlate(ct.title, null, { k: 0.3 });
      P.add('psign', geo.quad(0.9, 0.45, rect), M(0, 2.05, 0.82));
      P.add('wood', geo.box(0.96, 0.5, 0.04), M(0, 2.05, 0.79), '#4a2f1c');
      anchorGroup(ct.id, ct.x, gy, ct.z, rot, 2.6, 2.6, 1.6, root);
      boxCol(ct.x, ct.z, 1.25, 0.62, rot);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) circleCol(P.wx(sx * 1.3, sz * 0.75), P.wz(sx * 1.3, sz * 0.75), 0.12);
    }
  }

  // ---------------------------------------------------------------- traditional tools
  const TOOL_BUILD = {
    jige(P, y) { // A-frame carrier leaning on its prop stick
      const lean = -0.18;
      const T = (ax, ay, az, bx, by, bz, r) => P.add('wood', geo.tube(ax, y + ay, az, bx, y + by, bz, r, 7), M(0, 0, 0, 0, 1, 1, 1, lean), '#9a7048');
      for (const s of [-1, 1]) { T(s * 0.24, 0, 0.0, s * 0.13, 1.7, -0.05, 0.035); T(s * 0.2, 0.62, 0.0, s * 0.28, 0.98, 0.42, 0.026); }
      for (const h of [0.45, 0.8, 1.15, 1.48]) { const k = h / 1.7; const xw = 0.24 - 0.11 * k; T(-xw, h, -0.01, xw, h, -0.01, 0.022); }
      for (const s of [-1, 1]) P.add('paint', geo.tube(s * 0.17, y + 1.45, -0.06, s * 0.2, y + 0.55, -0.14, 0.025, 6), M(0, 0, 0, 0, 1, 1, 1, lean), '#5a4a35');
      P.add('wood', geo.tube(0, y, 0.75, 0, y + 1.25, 0.1, 0.03, 6), I4, '#8a6240');
      // bundle of firewood on the prongs
      for (let i = 0; i < 5; i++) P.add('wood', geo.cyl(0.05, 0.05, 0.7, 6), mul(M(0, 0, 0, 0, 1, 1, 1, lean), M(-0.12 + i * 0.06, y + 1.0 + (i % 2) * 0.07, 0.3, 0, 1, 1, 1, 0, PI / 2)), '#7a5a3a');
    },
    maetdol(P, y) {
      P.add('thatch', geo.cyl(0.62, 0.62, 0.03, 20), M(0, y + 0.015, 0), '#d8c08e');
      P.add('stone', geo.cyl(0.32, 0.33, 0.14, 18), M(0, y + 0.1, 0), '#8e8a83');
      P.add('stone', geo.box(0.14, 0.06, 0.2), M(0, y + 0.12, 0.38), '#8e8a83');
      P.add('stone', geo.cyl(0.3, 0.31, 0.13, 18), M(0, y + 0.235, 0), '#9a968e');
      P.add('paint', geo.cyl(0.04, 0.04, 0.01, 8), M(0.08, y + 0.302, 0.02), '#2b2724');
      P.add('wood', geo.tube(0.26, y + 0.24, 0, 0.26, y + 0.5, 0, 0.025, 6), I4, '#7a5236');
      P.add('wood', geo.tube(0.26, y + 0.5, 0, 0.5, y + 0.52, 0, 0.022, 6), I4, '#7a5236');
    },
    jeolgu(P, y) {
      P.add('wood', geo.lathe([[0, 0], [0.22, 0], [0.24, 0.05], [0.2, 0.22], [0.19, 0.36], [0.24, 0.55], [0.26, 0.64], [0.21, 0.64], [0.17, 0.6], [0.1, 0.45], [0, 0.42]], 14), M(0, y, 0), '#8a6240');
      P.add('wood', geo.tube(0, y + 0.5, 0, 0.3, y + 1.32, -0.12, 0.045, 8), I4, '#a87c50');
      P.add('wood', geo.tube(-0.03, y + 0.42, 0.01, 0.06, y + 0.66, -0.03, 0.07, 8), I4, '#a87c50');
      P.add('wood', geo.tube(0.26, y + 1.2, -0.1, 0.33, y + 1.42, -0.13, 0.065, 8), I4, '#a87c50');
    },
    ki(P, y) { // woven winnowing basket propped on a stand
      const W = 0.42, Dp = 0.75;
      const fn = (dy) => (i, j, o) => {
        const u = i / 10 * 2 - 1, v = j / 8;
        const w = W * (1 - 0.18 * v);
        o[0] = u * w; o[2] = v * Dp - Dp / 2; o[1] = 0.2 * u * u * (1 - 0.65 * v) + 0.14 * (1 - v) * (1 - v) + dy;
        o[3] = o[0] * 2; o[4] = o[2] * 2;
      };
      const m = M(0, y + 0.48, -0.05, 0, 1, 1, 1, -0.75);
      P.add('thatch', geo.grid(10, 8, fn(0), true), m, '#dcc690');
      P.add('thatch', geo.grid(10, 8, fn(-0.015), false), m, '#c9b07a');
      P.add('wood', geo.tube(-0.25, y, -0.1, -0.25, y + 0.6, -0.25, 0.025, 6), I4, '#6e4a2c');
      P.add('wood', geo.tube(0.25, y, -0.1, 0.25, y + 0.6, -0.25, 0.025, 6), I4, '#6e4a2c');
    },
    homi(P, y) { // three hand hoes on a slanted rack
      P.add('wood', geo.box(0.9, 0.04, 0.55), mul(M(0, y + 0.3, 0), M(0, 0, 0, 0, 1, 1, 1, -0.55)), '#8a6240');
      for (const sx of [-1, 1]) P.add('wood', geo.box(0.05, 0.42, 0.05), M(sx * 0.4, y + 0.21, -0.15), '#6e4a2c');
      for (let i = 0; i < 3; i++) {
        const x = -0.28 + i * 0.28;
        const m = mul(M(x, y + 0.34, 0.02), M(0, 0, 0, 0.15 * (i - 1), 1.7, 1.7, 1.7, -0.55));
        P.add('wood', geo.cyl(0.018, 0.02, 0.16, 7), mul(m, M(0, 0.045, 0.06, 0, 1, 1, 1, PI / 2)), '#b58a5c');
        P.add('metal', geo.tube(0, 0.045, -0.02, 0, 0.065, -0.06, 0.006, 4), m, '#3d3d3d');
        const bl = geo.cyl(0.0, 0.07, 0.11, 3); bl.scale(1, 1, 0.12);
        P.add('metal', bl, mul(m, M(0, 0.04, -0.11, 0, 1, 1, 1, PI / 2)), '#4d4b48');
      }
    },
    siru(P, y) { // steamer on an iron cauldron over a stone stove
      P.add('field', geo.box(0.95, 0.5, 0.85, 'world'), M(0, y + 0.25, 0), '#ffffff');
      P.add('paint', geo.box(0.36, 0.26, 0.05), M(0, y + 0.18, 0.43), '#1d1714');
      P.add('stone', geo.box(1.0, 0.06, 0.9, 'world'), M(0, y + 0.52, 0), '#cfc8bb');
      P.add('metal', geo.lathe([[0, 0.02], [0.2, 0.02], [0.32, 0.1], [0.37, 0.2], [0.46, 0.22], [0.46, 0.25], [0.36, 0.25], [0.35, 0.28], [0, 0.28]], 16), M(0, y + 0.42, 0), '#2e2b28');
      P.add('paint', geo.lathe([[0, 0], [0.19, 0], [0.21, 0.02], [0.3, 0.2], [0.35, 0.34], [0.37, 0.4], [0.34, 0.41], [0.32, 0.38], [0.18, 0.05], [0, 0.04]], 16), M(0, y + 0.69, 0), '#a65d3a');
      for (const s of [-1, 1]) P.add('paint', geo.box(0.1, 0.05, 0.06), M(s * 0.36, y + 0.98, 0), '#8f4d2f');
      P.add('wood', geo.cyl(0.34, 0.35, 0.04, 16), M(0, y + 1.1, 0), '#9a7048');
      P.add('wood', geo.box(0.12, 0.05, 0.04), M(0, y + 1.14, 0), '#6e4a2c');
    },
  };
  function buildTools(root) {
    for (const t of L.tools || []) {
      const gy = ground(t.x, t.z), rot = t.rot || 0;
      const P = placer(t.x, gy, t.z, rot);
      P.add('stone', geo.box(1.35, 0.2, 1.35, 'world'), M(0, 0.1, 0), '#d8d3c9');
      P.add('wood', geo.box(1.45, 0.06, 1.45, 'grain'), M(0, 0.2, 0), '#7a5236');
      P.add('plank', geo.box(1.25, 0.02, 1.25, 'world'), M(0, 0.235, 0), '#d1b08a');
      try { (TOOL_BUILD[t.kind] || TOOL_BUILD.maetdol)(P, 0.245); } catch (e) { G.log.warn('WORLD', 'tool build failed', t.id, e); }
      const rect = smallPlate(t.name, '전통 농기구', {});
      P.add('wood', geo.box(0.05, 0.4, 0.05), M(0.5, 0.2, 0.78), '#6e4a2c');
      P.add('wood', geo.box(0.42, 0.24, 0.03), mul(M(0.5, 0.45, 0.8), M(0, 0, 0, 0, 1, 1, 1, -0.45)), '#4a2f1c');
      P.add('psign', geo.quad(0.38, 0.19, rect), mul(M(0.5, 0.45, 0.8), M(0, 0, 0.017, 0, 1, 1, 1, -0.45)));
      anchorGroup(t.id, t.x, gy, t.z, rot, 1.4, t.kind === 'jige' ? 1.9 : 1.3, 1.4, root);
      circleCol(t.x, t.z, 0.72);
    }
  }

  // ---------------------------------------------------------------- jar displays (독/중두리/항아리/단지)
  function buildJarDisplays(root) {
    const SC = { dok: 1.15, jungduri: 1.0, hangari: 1.0, danji: 1.35 };
    for (const jd of L.jarDisplays || []) {
      const gy = ground(jd.x, jd.z), rot = jd.rot || 0;
      const P = placer(jd.x, gy, jd.z, rot);
      const s = SC[jd.kind] || 1;
      P.add('stone', geo.cyl(0.6, 0.66, 0.22, 20), M(0, 0.11, 0), '#cfc9bd');
      P.add('stone', geo.cyl(0.64, 0.64, 0.05, 20), M(0, 0.245, 0), '#e6e1d7');
      P.add('glaze', jarGeometry(jd.kind, 20), M(0, 0.27, 0, 0.6, s), '#ffffff');
      const rim = { dok: 0.315, jungduri: 0.325, hangari: 0.292, danji: 0.18 }[jd.kind] || 0.29;
      P.add('glaze', lidGeometry(18, rim), M(0, 0.27 + jarTop(jd.kind) * s - 0.01, 0, 0, s), '#ffffff');
      const rect = smallPlate(jd.name, '옹기 종류', {});
      P.add('wood', geo.box(0.05, 0.42, 0.05), M(0, 0.21, 0.82), '#6e4a2c');
      P.add('wood', geo.box(0.42, 0.24, 0.03), mul(M(0, 0.47, 0.84), M(0, 0, 0, 0, 1, 1, 1, -0.45)), '#4a2f1c');
      P.add('psign', geo.quad(0.38, 0.19, rect), mul(M(0, 0.47, 0.84), M(0, 0, 0.017, 0, 1, 1, 1, -0.45)));
      anchorGroup(jd.id, jd.x, gy, jd.z, rot, 1.25, 0.3 + 1.3 * s, 1.25, root);
      circleCol(jd.x, jd.z, 0.62);
    }
  }

  // ---------------------------------------------------------------- shop goods
  function buildShopGoods(root) {
    const sp = L.shopStall; if (!sp) return;
    const bgrp = G.sys.buildings?.get?.('B_SHOP');
    const gy = bgrp ? bgrp.position.y : ground(sp.x, sp.z);
    const rot = sp.rot || 0;
    const b = (L.buildings || []).find((q) => q.id === 'B_SHOP') || { w: 5, d: 3 };
    const hd = b.d / 2;
    const P = placer(sp.x, gy, sp.z, rot);
    const r = rngOf('shop');
    const cy = 1.18, cz = hd - 0.25;
    // counter: jars, bottles, a basket of vegetables
    smallJar(P, -1.7, cy, cz, 0.8);
    smallJar(P, -1.35, cy, cz + 0.05, 0.65);
    for (let i = 0; i < 3; i++) P.add('glossy', bottle(1.2), M(-0.9 + i * 0.16, cy, cz), i === 1 ? '#c8891e' : '#3a1a0c');
    P.add('thatch', geo.lathe([[0, 0], [0.26, 0], [0.32, 0.16], [0.34, 0.18], [0, 0.17]], 14), M(0.5, cy, cz), '#c9a86a');
    for (let i = 0; i < 4; i++) P.add('glossy', sphere(0.1, 10, 8), M(0.4 + (i % 2) * 0.2, cy + 0.2, cz - 0.08 + Math.floor(i / 2) * 0.16), '#8cc36a');
    for (let i = 0; i < 6; i++) { const g = sphere(0.03, 6, 4); g.scale(1, 1, 3.5); P.add('glossy', g, M(1.25 + (r() - 0.5) * 0.3, cy + 0.05, cz + (r() - 0.5) * 0.2, r() * PI), '#c0281c'); }
    P.add('paint', geo.box(0.36, 0.22, 0.26), M(1.75, cy + 0.11, cz), '#c0392b');
    P.add('paint', geo.box(0.37, 0.04, 0.27), M(1.75, cy + 0.15, cz), '#f2d27e');
    // shelves (y 1.0 and 1.6 at the back wall)
    const sz = -hd + 0.28;
    for (const [yy, kind] of [[1.025, 'jars'], [1.625, 'boxes']]) {
      for (let i = 0; i < 9; i++) {
        const x = -2.1 + i * 0.52;
        if (kind === 'jars') {
          if (i % 3 === 2) { P.add('glossy', bottle(1.1), M(x, yy, sz), '#b97814'); P.add('glossy', bottle(1.1), M(x + 0.15, yy, sz), '#3a1a0c'); }
          else smallJar(P, x, yy, sz, 0.55 + r() * 0.15);
        } else {
          const c = ['#c0392b', '#2f7d4a', '#d4a017', '#3b4d7a'][i % 4];
          P.add('paint', geo.box(0.36, 0.22, 0.28), M(x, yy + 0.11, sz), c);
          P.add('paint', geo.box(0.06, 0.225, 0.285), M(x, yy + 0.11, sz), '#f4efe4');
        }
      }
    }
    const sg = anchorGroup(sp.id || 'SHOP_STALL', sp.x, gy, sp.z, rot, b.w, 1.8, 0.9, root, 0.15);
    sg.children[0].position.z = hd - 0.1;
    sg.updateMatrixWorld(true);
  }

  // ---------------------------------------------------------------- swinging lantern parts (world-space, pivot attribute)
  const SWAY_U = { uTime: { value: 0 }, uWind: { value: new THREE.Vector2(0.86, 0.5) }, uWindS: { value: 1 } };
  const SWAY_GLSL = `
    attribute vec4 aPivot;
    uniform float uTime; uniform vec2 uWind; uniform float uWindS;
    mat3 tfRot(vec3 a, float ang) {
      float c = cos(ang), s = sin(ang), t = 1.0 - c;
      return mat3(t * a.x * a.x + c, t * a.x * a.y + s * a.z, t * a.x * a.z - s * a.y,
                  t * a.x * a.y - s * a.z, t * a.y * a.y + c, t * a.y * a.z + s * a.x,
                  t * a.x * a.z + s * a.y, t * a.y * a.z - s * a.x, t * a.z * a.z + c);
    }
    mat3 tfSwing(float ph) {
      float ws = min(uWindS, 2.0);
      float ang = (sin(uTime * 1.55 + ph) * 0.6 + sin(uTime * 2.6 + ph * 1.9) * 0.3) * (0.04 + 0.06 * ws) + 0.05 * ws;
      vec3 ax = vec3(-uWind.y, 0.0, uWind.x); float al = length(ax);
      ax = al > 1e-4 ? ax / al : vec3(1.0, 0.0, 0.0);
      return tfRot(ax, ang);
    }`;
  const swayParts = { silk: [], cap: [] };
  const _swC = new THREE.Color();
  function swayAdd(kind, g, worldM, hex, pivot, phase, glow = 1) {
    if (!g.index) { const n = g.attributes.position.count, idx = new Array(n); for (let i = 0; i < n; i++) idx[i] = i; g.setIndex(idx); }
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
    if (!g.attributes.normal) g.computeVertexNormals();
    g.applyMatrix4(worldM);
    const n = g.attributes.position.count;
    _swC.set(hex);
    const colA = new Float32Array(n * 3), pv = new Float32Array(n * 4), gl = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      colA[i * 3] = _swC.r; colA[i * 3 + 1] = _swC.g; colA[i * 3 + 2] = _swC.b;
      pv[i * 4] = pivot[0]; pv[i * 4 + 1] = pivot[1]; pv[i * 4 + 2] = pivot[2]; pv[i * 4 + 3] = phase;
      gl[i] = glow;
    }
    g.setAttribute('color', new THREE.BufferAttribute(colA, 3));
    g.setAttribute('aPivot', new THREE.BufferAttribute(pv, 4));
    g.setAttribute('aGlow', new THREE.BufferAttribute(gl, 1));
    swayParts[kind].push(g);
  }
  function swayMaterial(kind) {
    const silk = kind === 'silk';
    const m = STD({ vertexColors: true, roughness: silk ? 0.75 : 0.62, metalness: silk ? 0 : 0.05, emissive: silk ? new THREE.Color(1, 1, 1) : new THREE.Color(0, 0, 0) });
    m.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, SWAY_U);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aGlow;\nvarying float vGlow;\n' + SWAY_GLSL)
        .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\nmat3 tfR = tfSwing(aPivot.w);\nobjectNormal = tfR * objectNormal;\nvGlow = aGlow;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed = aPivot.xyz + tfR * (transformed - aPivot.xyz);');
      if (silk) {
        sh.fragmentShader = sh.fragmentShader
          .replace('#include <common>', '#include <common>\nvarying float vGlow;')
          .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance *= vColor.rgb * 1.9 * vGlow;');
      }
    };
    m.customProgramCacheKey = () => 'pr-sway-' + kind;
    if (silk) G.world.addNightMaterial(m, 1.35, 0.03);
    return m;
  }
  function buildSwayMeshes(root) {
    const out = [];
    for (const kind of ['silk', 'cap']) {
      const list = swayParts[kind];
      if (!list.length) continue;
      const g = list.length === 1 ? list[0] : ADDONS.BufferGeometryUtils.mergeGeometries(list, false);
      if (!g) continue;
      g.computeBoundingSphere();
      const mesh = new THREE.Mesh(g, swayMaterial(kind));
      mesh.name = 'lanterns-sway-' + kind; mesh.castShadow = kind === 'cap'; mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false; mesh.updateMatrix();
      mesh.raycast = () => {};
      root.add(mesh);
      out.push(mesh);
      list.length = 0;
    }
    return out;
  }

  // ---------------------------------------------------------------- lanterns (+ night glow)
  const glowPts = [];
  function buildLanterns() {
    (L.lanterns || []).forEach((lt, i) => {
      const gy = ground(lt.x, lt.z);
      const P = placer(lt.x, gy, lt.z, (i * 0.7) % TAU);
      if (lt.type === 'stone') {
        P.add('stone', geo.cyl(0.36, 0.42, 0.22, 8), M(0, 0.11, 0), '#c9c3b7');
        P.add('stone', geo.cyl(0.13, 0.16, 0.72, 8), M(0, 0.58, 0), '#bfb9ad');
        P.add('stone', geo.cyl(0.3, 0.2, 0.14, 8), M(0, 1.0, 0), '#c9c3b7');
        P.add('stone', geo.box(0.42, 0.06, 0.42), M(0, 1.1, 0), '#c9c3b7');
        for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) P.add('stone', geo.box(0.09, 0.36, 0.09), M(sx * 0.16, 1.31, sz * 0.16), '#c3bdb1');
        P.add('glow', geo.box(0.26, 0.3, 0.26), M(0, 1.3, 0), '#ffffff');
        P.add('stone', geo.cyl(0.0, 0.42, 0.26, 4), M(0, 1.62, 0, PI / 4), '#bdb7ab');
        P.add('stone', geo.box(0.5, 0.05, 0.5), M(0, 1.5, 0), '#c9c3b7');
        P.add('stone', sphere(0.07, 8, 6), M(0, 1.8, 0), '#bdb7ab');
        glowPts.push([lt.x, gy + 1.3, lt.z, 1.0]);
        circleCol(lt.x, lt.z, 0.34);
      } else {
        P.add('stone', geo.box(0.34, 0.18, 0.34), M(0, 0.09, 0), '#cfc9bd');
        P.add('wood', geo.box(0.11, 2.45, 0.11, 'grain'), M(0, 0.18 + 1.22, 0), '#5e3d24');
        P.add('wood', geo.box(0.6, 0.08, 0.08, 'grain'), M(0.25, 2.5, 0), '#5e3d24');
        // 청사초롱: blue silk on top, red silk below (both glow at night), dark wooden caps, tassel — the whole
        // hanging part swings from the hook under the arm (pivot at the top of the cord)
        const pivot = [P.wx(0.48, 0), gy + 2.47, P.wz(0.48, 0)], ph = i * 1.7 + lt.x * 0.31;
        const at = (y) => mul(P.base, M(0.48, y, 0));
        swayAdd('cap', geo.cyl(0.006, 0.006, 0.22, 4), at(2.36), '#222222', pivot, ph);
        swayAdd('silk', geo.cyl(0.17, 0.17, 0.19, 12), at(2.15), '#2f56b0', pivot, ph, 0.62);
        swayAdd('silk', geo.cyl(0.17, 0.17, 0.2, 12), at(1.955), '#c63a2c', pivot, ph, 1.0);
        swayAdd('cap', geo.cyl(0.08, 0.18, 0.06, 12), at(2.275), '#3b2a1c', pivot, ph);
        swayAdd('cap', geo.cyl(0.18, 0.1, 0.05, 12), at(1.83), '#3b2a1c', pivot, ph);
        swayAdd('cap', geo.cyl(0.012, 0.035, 0.16, 6), at(1.72), '#c0392b', pivot, ph);
        glowPts.push([P.wx(0.48, 0), gy + 2.06, P.wz(0.48, 0), 0.8, pivot, ph]);
        circleCol(lt.x, lt.z, 0.2);
      }
    });
  }
  function buildGlow(root) {
    if (!glowPts.length) return null;
    const pos = new Float32Array(glowPts.length * 3), sz = new Float32Array(glowPts.length), pv = new Float32Array(glowPts.length * 4);
    glowPts.forEach((p, i) => {
      pos[i * 3] = p[0]; pos[i * 3 + 1] = p[1]; pos[i * 3 + 2] = p[2]; sz[i] = p[3];
      const piv = p[4] || [p[0], p[1], p[2]];  // stone lanterns: pivot == position -> no swing
      pv[i * 4] = piv[0]; pv[i * 4 + 1] = piv[1]; pv[i * 4 + 2] = piv[2]; pv[i * 4 + 3] = p[5] || 0;
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('size', new THREE.BufferAttribute(sz, 1));
    g.setAttribute('aPivot', new THREE.BufferAttribute(pv, 4));
    const m = new THREE.ShaderMaterial({
      uniforms: { uMap: { value: G.gfx.radialTexture(64, 'rgba(255,214,150,1)', 'rgba(255,160,60,0)') }, uOpacity: { value: 0 }, uScale: { value: window.innerHeight * 0.5 }, ...SWAY_U },
      vertexShader: SWAY_GLSL + '\nattribute float size; uniform float uScale; void main(){ vec3 p = aPivot.xyz + tfSwing(aPivot.w) * (position - aPivot.xyz); vec4 mv = modelViewMatrix * vec4(p, 1.0); gl_PointSize = size * 2.4 * uScale / max(-mv.z, 0.5); gl_Position = projectionMatrix * mv; }',
      fragmentShader: 'uniform sampler2D uMap; uniform float uOpacity; void main(){ vec4 c = texture2D(uMap, gl_PointCoord); gl_FragColor = vec4(c.rgb, c.a * uOpacity); }',
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const pts = new THREE.Points(g, m);
    pts.name = 'lantern-glow'; pts.frustumCulled = false; pts.renderOrder = 5; pts.visible = false;
    pts.raycast = () => {};
    root.add(pts);
    return pts;
  }
  function buildNightLights(root) {
    if (G.sys.engine?.preset?.name === 'low') return; // low preset: emissive glow + halos only (cheaper shading)
    const spots = [
      [0, 4.2, 1, 26],                     // plaza
      [0, 4.6, -73.6, 20],                 // hall portico
      [23.5, 3.2, -0.5, 18],               // my jars (J1-J3)
      [50, 3.3, 41, 16],                   // pavilion
      [-31, 3.2, 3, 18],                   // fermentation yard
      [0, 4.2, 61.5, 18],                  // gate
    ];
    for (const [x, y, z, dist] of spots) {
      const l = new THREE.PointLight(0xffb866, 0, dist, 1.6);
      l.position.set(x, ground(x, z) + y, z);
      l.castShadow = false;
      root.add(l);
      G.world.addNightLight(l, 14);
    }
  }

  // ---------------------------------------------------------------- benches
  function buildBenches(root) {
    (L.benches || []).forEach((bn, i) => {
      const gy = ground(bn.x, bn.z), rot = bn.rot || 0;
      const P = placer(bn.x, gy, bn.z, rot);
      const seatY = 0.44, w = 1.7;
      for (let k = 0; k < 3; k++) P.add('wood', geo.box(w, 0.05, 0.13, 'grain', k), M(0, seatY - 0.025, -0.15 + k * 0.15), '#b3804e');
      for (let k = 0; k < 2; k++) P.add('wood', geo.box(w, 0.11, 0.04, 'grain', k), mul(M(0, seatY + 0.2 + k * 0.17, -0.27), M(0, 0, 0, 0, 1, 1, 1, -0.18)), '#a87545');
      for (const sx of [-1, 1]) {
        P.add('metal', geo.box(0.06, seatY - 0.05, 0.42), M(sx * (w / 2 - 0.18), (seatY - 0.05) / 2, 0), '#2f3237');
        P.add('metal', geo.box(0.05, 0.5, 0.05), mul(M(sx * (w / 2 - 0.18), seatY + 0.22, -0.25), M(0, 0, 0, 0, 1, 1, 1, -0.18)), '#2f3237');
        P.add('metal', geo.box(0.05, 0.05, 0.42), M(sx * (w / 2 - 0.18), seatY + 0.2, 0.0), '#2f3237');
      }
      const g = anchorGroup('BENCH_' + i, bn.x, gy, bn.z, rot, w, 0.95, 0.6, root);
      g.userData.seatY = seatY;
      g.userData.bench = bn;
      boxCol(bn.x, bn.z, w / 2, 0.24, rot);
    });
  }

  // ---------------------------------------------------------------- parking lot + cars
  function car(P, x, z, ry, color, r) {
    const m = mul(P.base, M(x, 0, z, ry));
    const add = (key, g, mm, c) => P.B.add(key, g, mm ? mul(m, mm) : m, c);
    const len = 4.3 + (r() - 0.5) * 0.4, wid = 1.8, tall = r() < 0.3;
    add('glossy', rbox(wid, 0.62, len, 2, 0.16), M(0, 0.62, 0), color);
    // cabin: tapered frustum
    const cab = new THREE.CylinderGeometry(0.62, 0.86, tall ? 0.72 : 0.56, 4, 1);
    cab.rotateY(PI / 4); cab.scale(wid / 1.25, 1, (len * 0.52) / 1.25);
    add('darkglass', cab, M(0, 0.93 + (tall ? 0.36 : 0.28), -0.1), '#ffffff');
    add('glossy', geo.box(wid * 0.68, 0.05, len * 0.36), M(0, 0.93 + (tall ? 0.72 : 0.56) + 0.01, -0.1), color);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      add('paint', geo.cyl(0.34, 0.34, 0.24, 12), M(sx * (wid / 2 - 0.12), 0.34, sz * (len / 2 - 0.75), 0, 1, 1, 1, 0, PI / 2), '#1d1e20');
      add('metal', geo.cyl(0.19, 0.19, 0.25, 10), M(sx * (wid / 2 - 0.115), 0.34, sz * (len / 2 - 0.75), 0, 1, 1, 1, 0, PI / 2), '#b9bcc0');
    }
    for (const sx of [-1, 1]) {
      add('glow', geo.box(0.36, 0.1, 0.04), M(sx * 0.6, 0.72, len / 2 + 0.005), '#ffffff');
      add('paint', geo.box(0.36, 0.1, 0.04), M(sx * 0.6, 0.72, -len / 2 - 0.005), '#c0281c');
    }
    add('paint', geo.box(0.6, 0.12, 0.03), M(0, 0.5, len / 2 + 0.01), '#e9e9e9');
    return len;
  }
  function buildParking() {
    const pk = L.parking; if (!pk) return;
    const gy = ground(pk.x, pk.z), rot = pk.rot || 0;
    const P = placer(pk.x, gy + 0.045, pk.z, rot);
    const r = rngOf('parking');
    const bayW = 2.6, n = Math.floor(pk.w / bayW), x0 = -n * bayW / 2;
    const zBack = -pk.d / 2 + 0.3, zFront = zBack + 5.2;
    for (let i = 0; i <= n; i++) P.add('lines', geo.box(0.12, 0.01, 5.2), M(x0 + i * bayW, 0, (zBack + zFront) / 2), '#f3f3ef');
    P.add('lines', geo.box(n * bayW, 0.01, 0.12), M(0, 0, zBack), '#f3f3ef');
    P.add('lines', geo.box(n * bayW + 0.4, 0.01, 0.15), M(0, 0, pk.d / 2 - 0.4), '#e9c84a');
    // accessible bay
    P.add('lines', geo.box(bayW - 0.25, 0.008, 5.0), M(x0 + bayW / 2, -0.002, (zBack + zFront) / 2), '#2f62b5');
    P.add('lines', geo.box(0.9, 0.012, 0.9), M(x0 + bayW / 2, 0.002, zFront - 1.6), '#f3f3ef');
    const bays = [...Array(n).keys()].slice(1);
    for (let k = bays.length - 1; k > 0; k--) { const j = Math.floor(r() * (k + 1)); [bays[k], bays[j]] = [bays[j], bays[k]]; }
    const used = bays.slice(0, Math.min(pk.cars || 7, bays.length));
    const palette = ['#f2f2ef', '#1f2124', '#a3242a', '#b9bdc2', '#2e5aa8', '#d8cdb5', '#2f5d43', '#5e6a72'];
    let ci = 0;
    for (const i of used) {
      const x = x0 + (i + 0.5) * bayW, z = zBack + 2.7;
      P.add('stone', geo.box(1.6, 0.12, 0.2, 'world'), M(x, 0.06, zBack + 0.55), '#cbc6bc');
      const len = car(P, x + (r() - 0.5) * 0.15, z, PI + (r() - 0.5) * 0.06, palette[ci++ % palette.length], r);
      boxCol(P.wx(x, z), P.wz(x, z), 0.95, len / 2 + 0.05, rot);
    }
    for (const i of [...Array(n).keys()]) if (!used.includes(i)) P.add('stone', geo.box(1.6, 0.12, 0.2, 'world'), M(x0 + (i + 0.5) * bayW, 0.06, zBack + 0.55), '#cbc6bc');
    // P sign
    const rect = PSIGN.slot(256, 256, (ctx, w, h) => {
      ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#2f62b5'; roundRect(ctx, 10, 10, w - 20, h - 20, 26); ctx.fill();
      ctx.fillStyle = '#ffffff'; ctx.font = `900 150px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('P', w / 2, h * 0.43);
      ctx.font = `800 36px ${FONT}`; ctx.fillText('주차장', w / 2, h * 0.8);
    });
    const sx = pk.w / 2 + 0.8, sz = pk.d / 2 - 1;
    P.add('metal', geo.cyl(0.05, 0.05, 2.5, 8), M(sx, 1.25, sz), '#6b7077');
    P.add('psign', geo.quad(0.8, 0.8, rect), M(sx, 2.35, sz + 0.06));
    P.add('metal', geo.box(0.84, 0.84, 0.04), M(sx, 2.35, sz + 0.02), '#6b7077');
    circleCol(P.wx(sx, sz), P.wz(sx, sz), 0.12);
  }

  // ---------------------------------------------------------------- river deck
  function buildRiverDeck(root) {
    const dk = L.riverDeck; if (!dk) return;
    const rot = dk.rot || 0, hw = dk.w / 2, hd = dk.d / 2;
    const c = Math.cos(rot), s = Math.sin(rot);
    let gmax = -Infinity, gmin = Infinity;
    for (const [lx, lz] of [[0, 0], [-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]]) { const y = ground(dk.x + lx * c + lz * s, dk.z - lx * s + lz * c); gmax = Math.max(gmax, y); gmin = Math.min(gmin, y); }
    const top = gmax + (dk.top ?? 0.35);
    const P = placer(dk.x, top, dk.z, rot);
    P.add('plank', geo.box(dk.w, 0.12, dk.d, 'world'), M(0, -0.06, 0), '#c49a6c');
    P.add('wood', geo.box(dk.w + 0.1, 0.22, 0.14, 'grain'), M(0, -0.16, hd), '#6e4a2c');
    P.add('wood', geo.box(dk.w + 0.1, 0.22, 0.14, 'grain'), M(0, -0.16, -hd), '#6e4a2c');
    const depth = top - gmin + 0.5;
    for (let x = -hw + 0.3; x <= hw - 0.2; x += 2.15) for (const z of [-hd + 0.25, 0, hd - 0.25]) P.add('wood', geo.box(0.18, depth, 0.18, 'grain'), M(x, -depth / 2, z), '#5e3d24');
    // railings on north, south and east (open towards the boardwalk in the west)
    const rail = (ax, az, bx, bz) => {
      const len = Math.hypot(bx - ax, bz - az), ry = Math.atan2(bx - ax, bz - az) - PI / 2;
      const mx = (ax + bx) / 2, mz = (az + bz) / 2;
      P.add('railing', geo.mquad(len, 0.85), M(mx, 0.45, mz, ry));
      P.add('wood', geo.box(len + 0.12, 0.08, 0.14, 'grain'), M(mx, 0.92, mz, ry), '#6e4a2c');
      for (let t = 0; t <= 1.001; t += 1 / Math.max(1, Math.round(len / 1.5))) P.add('wood', geo.box(0.12, 1.0, 0.12, 'grain'), M(lerp(ax, bx, t), 0.5, lerp(az, bz, t)), '#6e4a2c');
      boxCol(P.wx(mx, mz), P.wz(mx, mz), len / 2, 0.12, rot + ry);
    };
    rail(-hw, -hd, hw, -hd); rail(hw, -hd, hw, hd); rail(hw, hd, -hw, hd);
    walkBox(dk.x, dk.z, hw, hd, top, 'wood', rot);
    // skirt so ground walkers do not slip under a high deck edge
    if (top - gmin > 0.6) boxCol(P.wx(-hw, 0), P.wz(-hw, 0), 0.12, hd, rot, { maxY: top });
    const g = new THREE.Group(); g.name = dk.id; g.position.set(dk.x, top, dk.z); g.rotation.y = rot;
    Site.proxy(g, 0, -0.12, 0, dk.w, 0.2, dk.d);
    root.add(g); g.updateMatrixWorld(true);
    proxies[dk.id] = g;
    G.world.registerObject(dk.id, g);
  }

  // ---------------------------------------------------------------- edu board (outdoor chalkboard)
  function drawChalk(ctx, w, h) {
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, '#24453a'); g.addColorStop(1, '#1b3a30');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    const r = rngOf('chalk');
    ctx.globalAlpha = 0.06; ctx.fillStyle = '#ffffff';
    for (let i = 0; i < 40; i++) { ctx.beginPath(); ctx.ellipse(r() * w, r() * h, 60 + r() * 120, 12 + r() * 20, r() * 3, 0, TAU); ctx.fill(); }
    ctx.globalAlpha = 1;
    const chalk = (c) => { ctx.fillStyle = c; ctx.strokeStyle = c; };
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    chalk('#f7f3e6'); ctx.font = `800 64px ${FONT}`; ctx.fillText('전통발효 교실', w / 2, 70);
    ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(w / 2 - 210, 110); ctx.lineTo(w / 2 + 210, 110); ctx.stroke();
    // bean -> meju -> jar
    const y = 270;
    chalk('#f1d48a'); ctx.lineWidth = 5;
    ctx.beginPath(); ctx.ellipse(170, y, 46, 32, -0.4, 0, TAU); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(170, y, 12, 6, -0.4, 0, TAU); ctx.stroke();
    ctx.strokeRect(420, y - 45, 120, 90);
    ctx.beginPath(); ctx.moveTo(480, y - 45); ctx.lineTo(480, y + 45); ctx.moveTo(420, y); ctx.lineTo(540, y); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(760, y + 70); ctx.bezierCurveTo(690, y + 20, 700, y - 55, 745, y - 70); ctx.lineTo(835, y - 70); ctx.bezierCurveTo(880, y - 55, 890, y + 20, 820, y + 70); ctx.closePath(); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(790, y - 82, 58, 12, 0, 0, TAU); ctx.stroke();
    chalk('#ffffff'); ctx.lineWidth = 4;
    for (const [a, b] of [[250, 380], [585, 690]]) { ctx.beginPath(); ctx.moveTo(a, y); ctx.lineTo(b, y); ctx.lineTo(b - 16, y - 12); ctx.moveTo(b, y); ctx.lineTo(b - 16, y + 12); ctx.stroke(); }
    ctx.font = `700 40px ${FONT}`;
    ctx.fillText('콩', 170, y + 82); ctx.fillText('메주', 480, y + 82); ctx.fillText('된장 · 간장', 790, y + 112);
    chalk('#9fd7ff'); ctx.font = `600 30px ${FONT}`;
    ctx.fillText('오늘의 수업: 콩이 장이 되기까지', w / 2, h - 52);
  }
  function buildEduBoard(root) {
    const eb = L.eduBoard; if (!eb) return;
    const gy = ground(eb.x, eb.z), rot = eb.rot || 0;
    const P = placer(eb.x, gy, eb.z, rot);
    const w = eb.w || 6, h = eb.h || 3, by = 2.05;
    for (const sx of [-1, 1]) {
      P.add('stone', geo.box(0.5, 0.25, 0.5), M(sx * (w / 2 + 0.2), 0.12, 0), '#d2ccc0');
      P.add('wood', geo.box(0.22, by + h / 2 + 0.55, 0.22, 'grain'), M(sx * (w / 2 + 0.2), (by + h / 2 + 0.55) / 2, 0), '#6e4a2c');
    }
    P.add('wood', geo.box(w + 0.3, h + 0.3, 0.14, 'grain'), M(0, by, -0.04), '#5a3a22');
    const tx = G.gfx.canvasTexture(1024, 512, drawChalk, { anisotropy: 8 });
    registerMaterial('chalk', () => new THREE.MeshStandardMaterial({ map: tx, roughness: 0.95 }));
    P.add('chalk', geo.quad(w, h), M(0, by, 0.04));
    P.add('wood', geo.box(w, 0.08, 0.18, 'grain'), M(0, by - h / 2 - 0.02, 0.1), '#7a5236');
    for (let i = 0; i < 4; i++) P.add('paint', geo.box(0.12, 0.025, 0.025), M(-w / 2 + 0.6 + i * 0.25, by - h / 2 + 0.04, 0.12), ['#ffffff', '#f1d48a', '#ffb3b3', '#9fd7ff'][i]);
    const ro = { mode: 'gable', hw: w / 2 + 0.35, hd: 0.4, ov: 0.45, rise: 0.55, t: 0.16, tint: '#ffffff', gableColor: '#6b4a30', wallTop: by + h / 2 + 0.55, ridge: { w: 0.26, h: 0.26 } };
    ro.y = roofBaseFor(ro, by + h / 2 + 0.56);
    roof(P.B, P.base, ro);
    anchorGroup(eb.id, eb.x, gy, eb.z, rot, w + 0.6, by + h / 2 + 1.0, 0.6, root);
    boxCol(eb.x, eb.z, w / 2 + 0.35, 0.2, rot);
  }

  // ---------------------------------------------------------------- photo-zone frames
  // A lacquered picture-frame standee stands beside the photo spot (never in the line of sight),
  // and a round camera plate marks the spot itself.
  function buildPhotoZones(root) {
    let camRect = null;
    const pathD = (x, z) => { try { const d = G.sys.terrain?.pathDistance?.(x, z); return Number.isFinite(d) ? d : 99; } catch (e) { return 99; } };
    for (const pz of L.photoZones || []) {
      const look = pz.look || [pz.x, 0, pz.z - 10];
      let dx = look[0] - pz.x, dz = look[2] - pz.z;
      const dl = Math.hypot(dx, dz) || 1; dx /= dl; dz /= dl;
      const px = -dz, pzz = dx;
      // pick the better side: not blocked, not on water, away from paths
      let best = null;
      for (const side of [1, -1]) for (const dist of [2.4, 3.2]) {
        const fx = pz.x + px * side * dist + dx * 0.4, fz = pz.z + pzz * side * dist + dz * 0.4;
        if (G.world.isWater(fx, fz)) continue;
        const score = (G.world.blocked(fx, fz, 1.0, surf(fx, fz)) ? -50 : 0) + Math.min(pathD(fx, fz), 4) - dist * 0.2;
        if (!best || score > best.score) best = { fx, fz, score };
      }
      if (!best) best = { fx: pz.x + px * 2.4, fz: pz.z + pzz * 2.4 };
      const { fx, fz } = best;
      const fy = surf(fx, fz);
      // face the photographer side (behind the spot, opposite to the view direction)
      const cx = pz.x - dx * 3, cz = pz.z - dz * 3;
      const rot = Math.atan2(cx - fx, cz - fz);
      const P = placer(fx, fy, fz, rot);
      const W = 1.9, H = 1.45, y0 = 0.85, bw = 0.14;
      for (const sx of [-1, 1]) {
        P.add('stone', geo.box(0.34, 0.14, 0.5), M(sx * 0.72, 0.07, 0), '#cfc9bd');
        P.add('wood', geo.box(0.11, y0 + 0.2, 0.11, 'grain'), M(sx * 0.72, (y0 + 0.2) / 2, 0), '#4a2a18');
      }
      const lac = '#6a2f1f', gold = '#c9a45a';
      P.add('wood', geo.box(W, bw, 0.12, 'grain'), M(0, y0 + bw / 2, 0), lac);
      P.add('wood', geo.box(W, bw, 0.12, 'grain'), M(0, y0 + H - bw / 2, 0), lac);
      for (const sx of [-1, 1]) P.add('wood', geo.box(bw, H, 0.12, 'grain'), M(sx * (W / 2 - bw / 2), y0 + H / 2, 0), lac);
      for (const sy of [0, 1]) P.add('metal', geo.box(W - bw * 2, 0.035, 0.13), M(0, y0 + bw + sy * (H - bw * 2), 0), gold);
      for (const sx of [-1, 1]) P.add('metal', geo.box(0.035, H - bw * 2, 0.13), M(sx * (W / 2 - bw), y0 + H / 2, 0), gold);
      for (const sx of [-1, 1]) for (const sy of [0, 1]) P.add('metal', sphere(0.06, 8, 6), M(sx * (W / 2 - bw / 2), y0 + bw / 2 + sy * (H - bw), 0.07), gold);
      const rect = smallPlate('포토존', pz.name, { bg1: '#2f7d4a', bg2: '#235f38', border: '#1a4229' });
      P.add('psign', geo.quad(0.96, 0.48, rect), M(0, y0 + H + 0.3, 0.035));
      P.add('wood', geo.box(1.02, 0.54, 0.05), M(0, y0 + H + 0.3, 0), '#2a1a10');
      P.add('wood', geo.box(0.08, 0.1, 0.05), M(0, y0 + H + 0.02, 0), '#2a1a10');
      // camera plate at the standing spot
      if (!camRect) camRect = PSIGN.slot(256, 256, (ctx, w, h) => {
        ctx.fillStyle = '#b9b3a7'; ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = '#5c564d'; ctx.beginPath(); ctx.arc(w / 2, h / 2, w / 2 - 10, 0, TAU); ctx.fill();
        ctx.fillStyle = '#efe9dc'; roundRect(ctx, w * 0.24, h * 0.36, w * 0.52, h * 0.34, 14); ctx.fill();
        ctx.fillRect(w * 0.4, h * 0.3, w * 0.16, h * 0.08);
        ctx.fillStyle = '#5c564d'; ctx.beginPath(); ctx.arc(w / 2, h * 0.53, w * 0.11, 0, TAU); ctx.fill();
        ctx.fillStyle = '#efe9dc'; ctx.beginPath(); ctx.arc(w / 2, h * 0.53, w * 0.06, 0, TAU); ctx.fill();
      });
      const py = surf(pz.x, pz.z);
      const plate = geo.disc(0.5, 24, 1);
      { const uv = plate.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, lerp(camRect[0], camRect[2], uv.getX(i) + 0.5), lerp(camRect[1], camRect[3], uv.getY(i) + 0.5)); }
      BK(pz.x, pz.z).add('psign', plate, M(pz.x, py + 0.035, pz.z, Math.atan2(-dx, -dz)), '#ffffff');
      BK(pz.x, pz.z).add('stone', geo.cyl(0.56, 0.58, 0.04, 24), M(pz.x, py + 0.012, pz.z), '#8f897e');
      const g = anchorGroup(pz.id, fx, fy, fz, rot, W + 0.3, y0 + H + 0.7, 0.6, root);
      g.userData.photoZone = pz;
      for (const sx of [-1, 1]) circleCol(P.wx(sx * 0.72, 0), P.wz(sx * 0.72, 0), 0.16);
    }
  }

  // =============================================================================================
  const props = {
    name: 'props',
    label: '소품',
    order: 25,
    anchors: proxies,
    jarCount: 0,

    init() {
      const E = G.sys.engine;
      if (!E?.scene) throw new Error('engine scene missing');
      const root = new THREE.Group(); root.name = 'props';
      E.scene.add(root);
      this.root = root;
      const steps = [
        ['plaza', () => buildPlaza()],
        ['jangdokdae', () => buildJangdokdae()],
        ['plots', () => buildPlots(root)],
        ['fences', () => buildFences()],
        ['walls', () => buildStoneWalls()],
        ['signs', () => buildSigns(root)],
        ['kiosks', () => buildKiosks(root)],
        ['exhibits', () => buildExhibits(root)],
        ['tools', () => buildTools(root)],
        ['jarDisplays', () => buildJarDisplays(root)],
        ['shop', () => buildShopGoods(root)],
        ['lanterns', () => buildLanterns()],
        ['benches', () => buildBenches(root)],
        ['parking', () => buildParking()],
        ['riverDeck', () => buildRiverDeck(root)],
        ['eduBoard', () => buildEduBoard(root)],
        ['photoZones', () => buildPhotoZones(root)],
      ];
      for (const [name, fn] of steps) {
        try { fn(); } catch (e) { G.log.error('WORLD', `props: ${name} failed`, e); G._recordSystemError?.({ name: 'props' }, 'build ' + name, e); }
      }
      let meshes = 0, tris = 0;
      for (const [key, B] of cells) {
        tris += B.tris;
        const grp = new THREE.Group(); grp.name = 'props-cell-' + key;
        const out = B.build(grp, { name: 'props' });
        meshes += Object.keys(out).length;
        root.add(grp);
      }
      cells.clear();
      try { this.jarCount = buildJarInstances(root); } catch (e) { G.log.error('WORLD', 'jar instancing failed', e); }
      try { this.swayMeshes = buildSwayMeshes(root); } catch (e) { G.log.error('WORLD', 'lantern sway meshes failed', e); }
      this.glow = buildGlow(root);
      try { buildNightLights(root); } catch (e) { G.log.warn('WORLD', 'night lights failed', e); }
      PSIGN.getTexture().needsUpdate = true; SCREEN.getTexture().needsUpdate = true;
      root.updateMatrixWorld(true);
      E.onResize?.((w, h) => { if (this.glow) this.glow.material.uniforms.uScale.value = h * 0.5; });
      this._colliders = colliders; this._walkables = walkables;
      G.log.info('WORLD', `props: ${meshes} merged meshes (~${Math.round(tris / 1000)}k tris), ${this.jarCount} decorative jars, ${colliders.length} colliders`);
    },

    update(dt, t) {
      SWAY_U.uTime.value = (t || 0) % 3600;
      const N = G.sys.nature?.uniforms;
      if (N) { SWAY_U.uWind.value.copy(N.uWind.value); SWAY_U.uWindS.value = N.uWindStrength.value; }
      this._updateWet();
      const nf = G.world.nightFactor || 0;
      const g = this.glow;
      if (g && nf !== this._nf) {
        this._nf = nf;
        g.material.uniforms.uOpacity.value = clamp((nf - 0.15) / 0.6, 0, 1) * 0.85;
        g.visible = nf > 0.16;
      }
    },

    /** rain darkens paving, decks and roof tiles and gives them a wet sheen (uniform tweaks only, no recompiles) */
    _updateWet() {
      const w = clamp(Number(G.sys.weather?.wetness) || 0, 0, 1);
      if (this._wetK != null && Math.abs(w - this._wetK) < 0.01) return;
      this._wetK = w;
      const k = w * w * (3 - 2 * w);
      for (const key of WET_KEYS) {
        let m;
        try { m = mat(key); } catch (e) { continue; }
        if (!m || !m.isMeshStandardMaterial) continue;
        const dry = m.userData.dry || (m.userData.dry = { r: m.roughness, c: m.color.clone(), e: m.envMapIntensity ?? 1 });
        m.roughness = lerp(dry.r, Math.min(dry.r, 0.4), k * 0.85);
        m.color.copy(dry.c).multiplyScalar(1 - 0.3 * k);
        m.envMapIntensity = dry.e * (1 + 0.45 * k);
      }
    },

    plot(id) { return plotGroups[id] || null; },
  };
  const WET_KEYS = ['paver', 'pavement', 'emblem', 'stone', 'field', 'plank', 'roof', 'gravel'];
  G.register(props);
})();
