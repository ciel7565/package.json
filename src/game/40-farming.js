// =============================================================================
// 40-farming.js — farm plots: timestamp-based growth simulation, procedural instanced crops,
// wet soil, droplet / harvest particles, plot labels, plot modal + seed picker (G.sys.farming).
//
//   G.sys.farming (order 60)
//     getPlot(id) -> {id, def, crop, cropId, growth, water, health, stage, stageName, ready, empty, eta, ...} | null
//     plots() -> [getPlot(...)]          plotIds()
//     water(id) -> bool                  needs ITEM_WATERING_CAN (offers to buy it through the 매점 when missing)
//     plant(id, cropId) -> bool          needs the crop's seed item; crop plots take crops, herb plots take herbs
//     harvest(id) -> {itemId, qty}|null  only at 100 % (yield scaled by health, + basket bonus)
//     clear(id) -> Promise<bool>         empty the plot (confirm)
//     openPlot(id)                       modal: crop, stage, 성장률/수분/건강 bars, ETA, tips, actions, seed picker
//     primary(id)                        what E does: plant (empty) / harvest (ready) / water (< 90 %) / open modal
//     setPlot(id, patch)                 debug / test helper (growth, water, health, cropId)
//     growAll(pct) / fastForward(sec)    debug helpers (dev center)
//   Emits farm:watered {plotId, cropId}, farm:planted {plotId, cropId}, farm:harvested {plotId, cropId, itemId, qty}.
//   쉬운 모드 (CONTRACT §12): ONE TAP does the right thing — empty → picture seed picker (G.easy.pick) → plant,
//     ready → harvest (+ G.easy.celebrate), thirsty (< 80 %) → water, otherwise a big picture card
//     (stage 🌱→🌿→🌾→crop, 💧 drops 0–5, 😊/😐/😟, one sentence, big 💧/🧺/🌱 buttons). Plot labels become
//     pictures too, every action is spoken (G.easy.say). The grown-up modal is unchanged in normal mode.
//
//   G.ffx — small shared particle system (also used by 41-fermentation.js):
//     G.ffx.spawn(preset, x, y, z, vx, vy, vz, color?, floorY?)   G.ffx.burst(preset, x, y, z, n, speed, up, color?)
//     G.ffx.P.{DROP, SPLASH, LEAF, POP, SPARK, GLINT, DUST, STEAM, BUBBLE, PETAL}   G.ffx.update(dt) (once per frame)
//     G.ffx.floatText(html, vec3, cls)  rising world-anchored text
// Growth is simulated in fixed steps from each plot's lastUpdate to G.time.now() (catch-up capped by
// G.data.farming.offlineCatchUpMax), so offline time counts. Visuals/labels refresh 4x per second.
// Live rain from G.sys.weather (precipitation.rain) slowly waters every bed while the player is online.
// =============================================================================
(function () {
  const U = G.util;
  const clamp = U.clamp, lerp = U.lerp;
  const PI = Math.PI, TAU = PI * 2;
  const esc = U.escapeHtml;
  const fmt = (n) => U.fmt(n);
  /** Korean particle: josa('콩', '이/가') -> '콩이', josa('고추', '을/를') -> '고추를' (first form follows a final consonant);
   *  digits are read in Sino-Korean (josa('35', '을/를') -> '35를'), other endings take the vowel form */
  function josa(word, pair) {
    const w = String(word ?? '');
    const [withB, withoutB] = pair.split('/');
    const last = w.trim().slice(-1);
    const code = last.charCodeAt(0) - 0xac00;
    if (!(code >= 0 && code <= 11171)) return w + (/[013678]/.test(last) ? withB : withoutB);
    const fin = code % 28;
    if (withB === '으로') return w + (fin === 0 || fin === 8 ? '로' : '으로');
    return w + (fin ? withB : withoutB);
  }

  /** '많이' / '보통' / '조금' relative to the other crops (stays correct when the balance data changes) */
  function waterNeedLabel(use) {
    const all = Object.values(G.data.crops || {}).map((c) => Number(c.waterUse)).filter((v) => v > 0);
    if (!all.length || !(use > 0)) return '보통';
    const lo = Math.min(...all), hi = Math.max(...all);
    const t = hi > lo ? (use - lo) / (hi - lo) : 0.5;
    return t >= 0.67 ? '많이' : t <= 0.33 ? '조금' : '보통';
  }

  // ===========================================================================================
  // G.ffx — pooled GPU point particles (two pools: normal + additive)
  // ===========================================================================================
  G.ffx = G.ffx || (function () {
    const N_NORMAL = 760, N_ADD = 420;
    let pools = null, tex = null, lastFrame = -1;
    const uPx = { value: 600 };
    const WHITE = new THREE.Color(1, 1, 1);
    const _c = new THREE.Color();

    function atlas() {
      return G.gfx.canvasTexture(128, 128, (ctx) => {
        ctx.clearRect(0, 0, 128, 128);
        // 0: soft round puff (steam, dust, bubbles, pops)
        let g = ctx.createRadialGradient(32, 32, 0, 32, 32, 31);
        g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.45, 'rgba(255,255,255,0.75)'); g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 64);
        // 1: droplet with a highlight
        ctx.save(); ctx.translate(96, 30);
        g = ctx.createLinearGradient(-12, -20, 12, 22);
        g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(1, 'rgba(200,230,255,0.85)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.moveTo(0, -24); ctx.bezierCurveTo(6, -10, 14, 2, 14, 10); ctx.arc(0, 10, 14, 0, PI); ctx.bezierCurveTo(-14, 2, -6, -10, 0, -24); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.95)'; ctx.beginPath(); ctx.ellipse(-5, 8, 3, 6, -0.4, 0, TAU); ctx.fill();
        ctx.restore();
        // 2: four-point sparkle star with glow
        ctx.save(); ctx.translate(32, 96);
        g = ctx.createRadialGradient(0, 0, 0, 0, 0, 30);
        g.addColorStop(0, 'rgba(255,255,255,0.9)'); g.addColorStop(0.25, 'rgba(255,255,255,0.35)'); g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g; ctx.fillRect(-32, -32, 64, 64);
        ctx.fillStyle = 'rgba(255,255,255,1)';
        ctx.beginPath();
        for (let i = 0; i < 8; i++) { const a = (i / 8) * TAU - PI / 2; const r = i % 2 ? 4 : 29; ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
        ctx.closePath(); ctx.fill();
        ctx.restore();
        // 3: leaf
        ctx.save(); ctx.translate(96, 96); ctx.rotate(-0.6);
        ctx.fillStyle = 'rgba(255,255,255,1)';
        ctx.beginPath(); ctx.moveTo(0, -26); ctx.quadraticCurveTo(20, -4, 0, 26); ctx.quadraticCurveTo(-20, -4, 0, -26); ctx.fill();
        ctx.strokeStyle = 'rgba(150,170,150,0.9)'; ctx.lineWidth = 2.2;
        ctx.beginPath(); ctx.moveTo(0, -22); ctx.lineTo(0, 24); ctx.stroke();
        ctx.restore();
      });
    }

    const VS = `
      attribute vec3 color; attribute float aSize; attribute float aAlpha; attribute float aKind; attribute float aRot;
      uniform float uPx;
      varying vec3 vColor; varying float vAlpha; varying float vKind; varying float vRot;
      void main() {
        vColor = color; vAlpha = aAlpha; vKind = aKind; vRot = aRot;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = clamp(aSize * uPx / max(-mv.z, 0.05), 1.0, 300.0);
        gl_Position = projectionMatrix * mv;
      }`;
    const FS = `
      uniform sampler2D uMap;
      varying vec3 vColor; varying float vAlpha; varying float vKind; varying float vRot;
      void main() {
        vec2 pc = gl_PointCoord - 0.5;
        float c = cos(vRot), s = sin(vRot);
        pc = vec2(c * pc.x - s * pc.y, s * pc.x + c * pc.y) + 0.5;
        if (pc.x < 0.0 || pc.x > 1.0 || pc.y < 0.0 || pc.y > 1.0) discard;
        float col = mod(vKind, 2.0), row = floor(vKind / 2.0 + 0.01);
        vec2 uv = vec2((col + pc.x) * 0.5, 1.0 - (row + pc.y) * 0.5);
        vec4 t = texture2D(uMap, uv);
        float a = t.a * vAlpha;
        if (a < 0.008) discard;
        gl_FragColor = vec4(vColor * t.rgb, a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`;

    function makePool(n, additive) {
      const geo = new THREE.BufferGeometry();
      const P = {
        n, alive: 0, geo, dirty: true,
        pos: new Float32Array(n * 3), col: new Float32Array(n * 3), size: new Float32Array(n), alpha: new Float32Array(n),
        kind: new Float32Array(n), rot: new Float32Array(n),
        vel: new Float32Array(n * 3), life: new Float32Array(n), max: new Float32Array(n), s0: new Float32Array(n), s1: new Float32Array(n),
        a0: new Float32Array(n), grav: new Float32Array(n), drag: new Float32Array(n), spin: new Float32Array(n), floor: new Float32Array(n),
        splash: new Uint8Array(n),
      };
      const attr = (name, arr, sz) => { const a = new THREE.BufferAttribute(arr, sz); a.setUsage(THREE.DynamicDrawUsage); geo.setAttribute(name, a); return a; };
      P.aPos = attr('position', P.pos, 3); P.aCol = attr('color', P.col, 3); P.aSize = attr('aSize', P.size, 1);
      P.aAlpha = attr('aAlpha', P.alpha, 1); P.aKind = attr('aKind', P.kind, 1); P.aRot = attr('aRot', P.rot, 1);
      geo.setDrawRange(0, 0);
      geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
      const mat = new THREE.ShaderMaterial({
        uniforms: { uMap: { value: tex }, uPx },
        vertexShader: VS, fragmentShader: FS,
        transparent: true, depthWrite: false,
        blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      });
      const pts = new THREE.Points(geo, mat);
      pts.frustumCulled = false;
      pts.renderOrder = additive ? 12 : 11;
      pts.name = additive ? 'ffx-add' : 'ffx-normal';
      pts.raycast = () => {};
      P.pts = pts;
      return P;
    }

    function ensure() {
      if (pools) return true;
      const scene = G.sys.engine?.scene;
      if (!scene) return false;
      tex = atlas();
      pools = { normal: makePool(N_NORMAL, false), add: makePool(N_ADD, true) };
      scene.add(pools.normal.pts, pools.add.pts);
      return true;
    }

    /** particle presets (static objects: spawning allocates nothing) */
    const C = (hex) => new THREE.Color(hex);
    const P = {
      DROP: { kind: 1, life: 0.95, s0: 0.12, s1: 0.085, alpha: 1, grav: -7.5, drag: 0.35, colors: [C('#cfe9ff'), C('#a9d8ff'), C('#e9f6ff')], splash: 1, spin: 0, align: true },
      SPLASH: { kind: 0, life: 0.36, s0: 0.05, s1: 0.2, alpha: 0.7, grav: 0, drag: 3.5, colors: [C('#d7ecff')] },
      LEAF: { kind: 3, life: 1.35, s0: 0.19, s1: 0.13, alpha: 1, grav: -3.0, drag: 1.5, colors: [C('#5aa043'), C('#7cc45a'), C('#3f8a35'), C('#9bd46f')], spin: 7 },
      POP: { kind: 0, life: 0.6, s0: 0.18, s1: 0.03, alpha: 0.95, grav: -2.0, drag: 2.0, colors: [C('#ffffff')] },
      SPARK: { kind: 2, life: 1.0, s0: 0.16, s1: 0.0, alpha: 1, grav: 0.35, drag: 0.8, colors: [C('#ffe08a'), C('#fff1c2'), C('#ffc94a')], add: 1, spin: 1.5 },
      GLINT: { kind: 2, life: 1.4, s0: 0.0, s1: 0.0, alpha: 0.9, grav: 0.25, drag: 0.2, colors: [C('#ffe9a6'), C('#fff6d8')], add: 1, spin: 0.8, twinkle: 1 },
      DUST: { kind: 0, life: 0.85, s0: 0.1, s1: 0.32, alpha: 0.55, grav: -0.6, drag: 2.6, colors: [C('#7a5638'), C('#946c48'), C('#6a4a30')] },
      STEAM: { kind: 0, life: 2.6, s0: 0.1, s1: 0.6, alpha: 0.26, grav: 0.22, drag: 0.55, colors: [C('#f4f1ea'), C('#ffffff')] },
      BUBBLE: { kind: 0, life: 0.75, s0: 0.03, s1: 0.06, alpha: 0.8, grav: 0.18, drag: 1.2, colors: [C('#fff6dc')] },
      PETAL: { kind: 3, life: 1.6, s0: 0.1, s1: 0.07, alpha: 1, grav: -1.4, drag: 1.6, colors: [C('#ffd166'), C('#ffe9a8'), C('#ffb4c8')], spin: 5 },
    };

    function spawn(pr, x, y, z, vx, vy, vz, color, floorY) {
      if (!ensure()) return -1;
      const pool = pr.add ? pools.add : pools.normal;
      if (pool.alive >= pool.n) return -1;
      const i = pool.alive++;
      const i3 = i * 3;
      pool.pos[i3] = x; pool.pos[i3 + 1] = y; pool.pos[i3 + 2] = z;
      pool.vel[i3] = vx; pool.vel[i3 + 1] = vy; pool.vel[i3 + 2] = vz;
      const c = color || pr.colors[(Math.random() * pr.colors.length) | 0] || WHITE;
      pool.col[i3] = c.r; pool.col[i3 + 1] = c.g; pool.col[i3 + 2] = c.b;
      const v = 0.8 + Math.random() * 0.4;
      pool.life[i] = 0; pool.max[i] = pr.life * (0.8 + Math.random() * 0.4);
      pool.s0[i] = pr.s0 * v; pool.s1[i] = (pr.twinkle ? 0.16 : pr.s1) * v;
      pool.a0[i] = pr.alpha; pool.grav[i] = pr.grav; pool.drag[i] = pr.drag;
      pool.spin[i] = pr.spin ? (Math.random() - 0.5) * 2 * pr.spin : 0;
      pool.rot[i] = pr.align ? 0 : Math.random() * TAU;
      pool.kind[i] = pr.kind;
      pool.floor[i] = floorY == null ? -1e9 : floorY;
      pool.splash[i] = (pr.splash ? 1 : 0) | (pr.twinkle ? 2 : 0);
      pool.size[i] = pool.s0[i]; pool.alpha[i] = 0;
      pool.dirty = true;
      return i;
    }
    /** radial burst: n particles, horizontal speed `speed`, upward speed `up` */
    function burst(pr, x, y, z, n, speed = 1.5, up = 2, color, floorY) {
      for (let k = 0; k < n; k++) {
        const a = Math.random() * TAU, s = speed * (0.35 + Math.random() * 0.65);
        spawn(pr, x + (Math.random() - 0.5) * 0.15, y + Math.random() * 0.1, z + (Math.random() - 0.5) * 0.15, Math.cos(a) * s, up * (0.6 + Math.random() * 0.6), Math.sin(a) * s, color, floorY);
      }
    }

    function kill(pool, i) {
      const j = --pool.alive;
      if (i === j) return;
      const i3 = i * 3, j3 = j * 3;
      for (const k of ['pos', 'vel', 'col']) { const a = pool[k]; a[i3] = a[j3]; a[i3 + 1] = a[j3 + 1]; a[i3 + 2] = a[j3 + 2]; }
      for (const k of ['size', 'alpha', 'kind', 'rot', 'life', 'max', 's0', 's1', 'a0', 'grav', 'drag', 'spin', 'floor', 'splash']) pool[k][i] = pool[k][j];
    }

    function stepPool(pool, dt) {
      if (!pool.alive && !pool.dirty) return;
      let i = 0;
      while (i < pool.alive) {
        const life = (pool.life[i] += dt);
        const max = pool.max[i];
        if (life >= max) { kill(pool, i); continue; }
        const i3 = i * 3;
        const dr = Math.max(0, 1 - pool.drag[i] * dt);
        pool.vel[i3] *= dr; pool.vel[i3 + 2] *= dr;
        pool.vel[i3 + 1] = pool.vel[i3 + 1] * dr + pool.grav[i] * dt;
        pool.pos[i3] += pool.vel[i3] * dt; pool.pos[i3 + 1] += pool.vel[i3 + 1] * dt; pool.pos[i3 + 2] += pool.vel[i3 + 2] * dt;
        if (pool.pos[i3 + 1] < pool.floor[i]) {
          if (pool.splash[i] & 1) {
            const x = pool.pos[i3], z = pool.pos[i3 + 2], fy = pool.floor[i] + 0.02;
            kill(pool, i);
            if (Math.random() < 0.55) spawn(P.SPLASH, x, fy, z, (Math.random() - 0.5) * 0.6, 0.05, (Math.random() - 0.5) * 0.6);
            continue;
          }
          pool.pos[i3 + 1] = pool.floor[i]; pool.vel[i3 + 1] = 0;
        }
        const t = life / max;
        if (pool.splash[i] & 2) { // twinkle: size pulses in and out
          pool.size[i] = pool.s1[i] * Math.sin(t * PI) * (0.75 + 0.25 * Math.sin(life * 18));
        } else pool.size[i] = pool.s0[i] + (pool.s1[i] - pool.s0[i]) * t;
        const fin = t < 0.1 ? t / 0.1 : 1, fout = t > 0.6 ? 1 - (t - 0.6) / 0.4 : 1;
        pool.alpha[i] = pool.a0[i] * fin * fout;
        if (pool.spin[i]) pool.rot[i] += pool.spin[i] * dt;
        else if (pool.kind[i] === 1) { // droplets point along their velocity (screen-space approximation)
          pool.rot[i] = 0;
        }
        i++;
      }
      pool.geo.setDrawRange(0, pool.alive);
      pool.aPos.needsUpdate = true; pool.aCol.needsUpdate = true; pool.aSize.needsUpdate = true;
      pool.aAlpha.needsUpdate = true; pool.aKind.needsUpdate = true; pool.aRot.needsUpdate = true;
      pool.dirty = pool.alive > 0;
    }

    function update(dt) {
      if (!pools) return;
      if (G.time.frame === lastFrame) return;
      lastFrame = G.time.frame;
      const eng = G.sys.engine;
      if (eng?.renderer && eng.camera) {
        const h = eng.renderer.domElement.height || window.innerHeight;
        uPx.value = h / (2 * Math.tan(THREE.MathUtils.degToRad(eng.camera.fov) / 2));
      }
      stepPool(pools.normal, dt);
      stepPool(pools.add, dt);
    }
    function clear() { if (!pools) return; for (const p of [pools.normal, pools.add]) { p.alive = 0; p.dirty = true; p.geo.setDrawRange(0, 0); } }

    /** world-anchored rising text (e.g. "+45% 수분") */
    function floatText(html, pos, cls = '') {
      if (!G.ui?.label) return;
      const target = new THREE.Vector3(pos.x, pos.y, pos.z);
      const L = G.ui.label({ html: `<span class="ffx-float-in">${html}</span>`, className: `ffx-float ${cls}`, target, maxDist: 60 });
      setTimeout(() => L.remove(), 1500);
    }

    return { P, spawn, burst, update, clear, ensure, floatText, color: _c };
  })();
  const FX = G.ffx;

  // ===========================================================================================
  // procedural plant kit (indexed geometry with vertex colours; normals computed at the end)
  // ===========================================================================================
  const _m4 = new THREE.Matrix4(), _q4 = new THREE.Quaternion(), _e4 = new THREE.Euler(0, 0, 0, 'YXZ'), _s4 = new THREE.Vector3(), _p4 = new THREE.Vector3();
  const _va = new THREE.Vector3(), _vb = new THREE.Vector3(), _vt = new THREE.Vector3(), _vu = new THREE.Vector3(), _vw = new THREE.Vector3(), _vr = new THREE.Vector3();
  const _ca = new THREE.Color(), _cb = new THREE.Color();
  const col = (hex) => new THREE.Color(hex);

  class GB {
    constructor() { this.p = []; this.c = []; this.i = []; }
    get count() { return this.p.length / 3; }
    v(x, y, z, c) { this.p.push(x, y, z); this.c.push(c.r, c.g, c.b); return this.p.length / 3 - 1; }
    tri(a, b, c) { this.i.push(a, b, c); }
    /** append a THREE geometry transformed by m; colour = c0 (bottom) .. c1 (top) over local y in [y0, y1] */
    geo(g, m, c0, c1 = c0, y0 = -1, y1 = 1) {
      const pa = g.attributes.position;
      const base = this.count;
      for (let k = 0; k < pa.count; k++) {
        _va.fromBufferAttribute(pa, k);
        const t = clamp((_va.y - y0) / (y1 - y0 || 1), 0, 1);
        _ca.copy(c0).lerp(c1, t);
        _va.applyMatrix4(m);
        this.v(_va.x, _va.y, _va.z, _ca);
      }
      if (g.index) for (let k = 0; k < g.index.count; k++) this.i.push(base + g.index.getX(k));
      else for (let k = 0; k < pa.count; k++) this.i.push(base + k);
      g.dispose();
    }
    /** tone: colour multiplier (linear) — plants sit in strong sun + ACES, so authored greens are darkened */
    build(tone = 1) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
      const c = tone === 1 ? this.c : this.c.map((v) => v * tone);
      g.setAttribute('color', new THREE.Float32BufferAttribute(c, 3));
      g.setIndex(this.i);
      g.computeVertexNormals();
      g.computeBoundingBox();
      g.computeBoundingSphere();
      return g;
    }
  }
  /** matrix: translate, then rotate (yaw, pitch-up, roll in YXZ), then scale */
  function MX(x, y, z, yaw = 0, pitch = 0, roll = 0, sx = 1, sy = sx, sz = sx) {
    _e4.set(-pitch, yaw, roll, 'YXZ');
    _q4.setFromEuler(_e4);
    return new THREE.Matrix4().compose(_p4.set(x, y, z), _q4, _s4.set(sx, sy, sz));
  }
  const WIDTH = {
    ovate: (t) => Math.pow(Math.sin(PI * Math.pow(t, 0.72)), 0.8),
    lance: (t) => Math.pow(Math.sin(PI * Math.pow(t, 0.55)), 1.05),
    round: (t) => Math.pow(Math.sin(PI * Math.pow(t, 0.85)), 0.5),
    spoon: (t) => Math.pow(Math.sin(PI * Math.pow(t, 0.55)), 0.55),
    strap: (t) => Math.pow(1 - Math.pow(t, 3), 0.7) * Math.min(1, 0.55 + t * 6),
    needle: (t) => 1 - Math.pow(t, 3),
    broad: (t) => Math.pow(Math.sin(PI * Math.pow(t, 0.62)), 0.55),
  };
  /**
   * leaf blade: base at origin pointing +Z, normal +Y, then transformed by m.
   * o: {len, wid, segs, shape, curl (tip rise (+) / droop (−) as fraction of len), fold (edge lift vs half width),
   *     serr (alternate-row width cut), c0 (base), c1 (tip), rib (midrib colour)}
   */
  function leaf(gb, m, o) {
    const segs = o.segs || 4, len = o.len, wid = o.wid;
    const cols = o.cols || 2;                 // columns across the blade (2 = V-fold, 4 = rounded cup)
    const wf = WIDTH[o.shape || 'ovate'];
    const curl = o.curl || 0, fold = o.fold ?? 0.22, serr = o.serr || 0;
    const base = gb.count;
    for (let k = 0; k <= segs; k++) {
      const t = k / segs;
      let hw = (wid / 2) * wf(t);
      if (serr && k % 2 === 1 && k < segs) hw *= 1 - serr;
      const z = t * len * (1 - Math.abs(curl) * 0.25 * t), y = curl * t * t * len;
      _ca.copy(o.c0).lerp(o.c1, t);
      for (let j = 0; j <= cols; j++) {
        const u = (j / cols) * 2 - 1;            // -1 .. 1 across
        const au = Math.abs(u);
        const px = u * hw, py = y + fold * hw * (cols > 2 ? au * au : au);
        _cb.copy(o.rib || o.c1).lerp(_ca, Math.min(1, 0.35 + 0.65 * t + au * 0.8));
        _va.set(px, py, z).applyMatrix4(m);
        gb.v(_va.x, _va.y, _va.z, au < 0.01 ? _cb : _ca);
      }
    }
    const R = cols + 1;
    for (let k = 0; k < segs; k++) {
      for (let j = 0; j < cols; j++) {
        const a = base + k * R + j, b = a + R;
        gb.tri(a, b, a + 1); gb.tri(a + 1, b, b + 1);
      }
    }
  }
  /** generalized tube along points [[x,y,z]...] with radii (number or array), colour gradient c0 -> c1 (or fn(i,n)) */
  function tube(gb, pts, radii, sides, c0, c1 = c0, capEnd = false) {
    const n = pts.length;
    const base = gb.count;
    let prevU = null;
    for (let k = 0; k < n; k++) {
      const pa = pts[Math.max(0, k - 1)], pb = pts[Math.min(n - 1, k + 1)];
      _vt.set(pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]).normalize();
      if (prevU) { _vu.copy(prevU).addScaledVector(_vt, -prevU.dot(_vt)); if (_vu.lengthSq() < 1e-6) prevU = null; }
      if (!prevU) {
        _vr.set(Math.abs(_vt.y) < 0.9 ? 0 : 1, Math.abs(_vt.y) < 0.9 ? 1 : 0, 0);
        _vu.crossVectors(_vt, _vr);
      }
      _vu.normalize();
      _vw.crossVectors(_vt, _vu).normalize();
      prevU = prevU || new THREE.Vector3();
      prevU.copy(_vu);
      const r = Array.isArray(radii) ? radii[Math.min(k, radii.length - 1)] : radii;
      const c = typeof c0 === 'function' ? c0(k, n) : _ca.copy(c0).lerp(c1, n > 1 ? k / (n - 1) : 0);
      for (let j = 0; j < sides; j++) {
        const an = (j / sides) * TAU;
        const ca = Math.cos(an) * r, sa = Math.sin(an) * r;
        gb.v(pts[k][0] + _vu.x * ca + _vw.x * sa, pts[k][1] + _vu.y * ca + _vw.y * sa, pts[k][2] + _vu.z * ca + _vw.z * sa, c);
      }
    }
    for (let k = 0; k < n - 1; k++) {
      for (let j = 0; j < sides; j++) {
        const a = base + k * sides + j, b = base + k * sides + ((j + 1) % sides), c = a + sides, d = b + sides;
        gb.tri(a, c, b); gb.tri(b, c, d);
      }
    }
    if (capEnd) { // close the last ring with a centre vertex
      const last = pts[n - 1];
      const cc = typeof c0 === 'function' ? c0(n - 1, n) : c1;
      const ci = gb.v(last[0], last[1], last[2], cc);
      const rb = base + (n - 1) * sides;
      for (let j = 0; j < sides; j++) gb.tri(rb + j, ci, rb + ((j + 1) % sides));
    }
  }
  /** point along a quadratic curve a -> b with mid lift */
  function curvePts(a, b, lift, n) {
    const out = [];
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      out.push([lerp(a[0], b[0], t), lerp(a[1], b[1], t) + Math.sin(t * PI) * lift, lerp(a[2], b[2], t)]);
    }
    return out;
  }
  function jitterColor(c, r, amt = 0.08) { const k = 1 + (r() - 0.5) * 2 * amt; return c.clone().multiplyScalar(k); }

  // ---------------------------------------------------------------- crop models
  // Each builder returns { body: GB, fruit: GB|null }. Plant origin = soil surface, +Y up, ~real size (m).
  const MODELS = {
    bean: {
      height: 0.62, rowStep: 2, xs: 1.0, scale: 1.5, fruitTint: 'data', unripe: '#8fbf5a',
      build(r) {
        const body = new GB(), fruit = new GB();
        const sc0 = col('#4a7a2a'), sc1 = col('#6a9a3c');
        for (let s = 0; s < 5; s++) {
          const a = (s / 5) * TAU + r() * 0.6, top = 0.3 + r() * 0.16;
          tube(body, [[0, 0, 0], [Math.sin(a) * 0.05, top * 0.45, Math.cos(a) * 0.05], [Math.sin(a) * 0.14, top, Math.cos(a) * 0.14]], [0.012, 0.009, 0.006], 5, sc0, sc1);
        }
        const l0 = col('#2f6a1f'), l1 = col('#6aae3c'), rib = col('#a7d07a');
        for (let k = 0; k < 22; k++) {
          const a = k * 2.39996 + r() * 0.3;
          const t = k / 22;
          const h = 0.1 + t * 0.36 + r() * 0.05;
          const rr = 0.07 + (1 - t * 0.6) * 0.13 + r() * 0.05;
          const ex = Math.sin(a) * rr, ez = Math.cos(a) * rr;
          tube(body, [[Math.sin(a) * 0.03, h - 0.07, Math.cos(a) * 0.03], [ex, h, ez]], 0.0045, 4, sc0, sc1);
          const c0 = jitterColor(l0, r, 0.12), c1 = jitterColor(l1, r, 0.12);
          const pitch = 0.05 + r() * 0.35;
          leaf(body, MX(ex, h, ez, a, pitch, (r() - 0.5) * 0.4), { len: 0.13, wid: 0.095, segs: 3, shape: 'ovate', curl: -0.2, fold: 0.25, c0, c1, rib });
          leaf(body, MX(ex, h, ez, a + 1.15, pitch * 0.7, 0.2), { len: 0.105, wid: 0.08, segs: 3, shape: 'ovate', curl: -0.15, fold: 0.22, c0, c1, rib });
          leaf(body, MX(ex, h, ez, a - 1.15, pitch * 0.7, -0.2), { len: 0.105, wid: 0.08, segs: 3, shape: 'ovate', curl: -0.15, fold: 0.22, c0, c1, rib });
        }
        // pods: hanging clusters, gently curved, bead-like bulges
        const pc = col('#f4f1e2'), pcd = col('#d9d4bd');
        for (let k = 0; k < 12; k++) {
          const a = r() * TAU, h = 0.12 + r() * 0.24, rr = 0.06 + r() * 0.1;
          const x = Math.sin(a) * rr, z = Math.cos(a) * rr;
          const ox = Math.sin(a) * 0.014, oz = Math.cos(a) * 0.014;
          const pts = [];
          for (let j = 0; j <= 4; j++) { const t = j / 4; pts.push([x + ox * t * 3, h - t * 0.1, z + oz * t * 3 + Math.sin(t * PI) * 0.008]); }
          tube(fruit, pts, [0.005, 0.016, 0.014, 0.015, 0.004], 5, (i) => (i === 0 ? pcd : pc));
        }
        return { body, fruit };
      },
    },
    pepper: {
      height: 0.75, rowStep: 2, xs: 1.05, scale: 1.4, fruitTint: 'data', unripe: '#3f9a35',
      build(r) {
        const body = new GB(), fruit = new GB();
        const s0 = col('#3b6a2a'), s1 = col('#56923a');
        tube(body, [[0, 0, 0], [0.01, 0.16, 0], [0, 0.32, 0.01]], [0.016, 0.012, 0.01], 6, s0, s1);
        const branches = [];
        for (let b = 0; b < 5; b++) {
          const a = (b / 5) * TAU + r() * 0.6, y0 = 0.22 + b * 0.03;
          const end = [Math.sin(a) * (0.15 + r() * 0.06), 0.55 + r() * 0.16, Math.cos(a) * (0.15 + r() * 0.06)];
          const mid = [Math.sin(a) * 0.07, (y0 + end[1]) * 0.5, Math.cos(a) * 0.07];
          const pts = [[0, y0, 0], mid, end];
          tube(body, pts, [0.009, 0.006, 0.004], 5, s0, s1);
          branches.push({ a, pts });
        }
        const at = (br, t) => { const p = br.pts; const i = t < 0.5 ? 0 : 1, u = t < 0.5 ? t * 2 : (t - 0.5) * 2; return [lerp(p[i][0], p[i + 1][0], u), lerp(p[i][1], p[i + 1][1], u), lerp(p[i][2], p[i + 1][2], u)]; };
        const l0 = col('#245e1f'), l1 = col('#4f9a36'), rib = col('#8cc46a');
        for (let k = 0; k < 40; k++) {
          const br = branches[k % 5], t = 0.2 + r() * 0.8, p = at(br, t);
          leaf(body, MX(p[0], p[1], p[2], br.a + (r() - 0.5) * 2.6, 0.05 + r() * 0.5, (r() - 0.5) * 0.5), { len: 0.12 + r() * 0.05, wid: 0.055 + r() * 0.015, segs: 3, shape: 'lance', curl: -0.25, fold: 0.18, c0: jitterColor(l0, r, 0.12), c1: jitterColor(l1, r, 0.12), rib });
        }
        for (const br of branches) for (let k = 0; k < 3; k++) {
          const p = br.pts[2];
          leaf(body, MX(p[0], p[1], p[2], br.a + (k - 1) * 1.6 + r() * 0.3, 0.7 + r() * 0.3, 0), { len: 0.09, wid: 0.045, segs: 3, shape: 'lance', curl: -0.1, c0: l0, c1: l1, rib });
        }
        // peppers hanging below the branches
        const calyx = col('#4c8a35'), white = col('#ffffff');
        for (let k = 0; k < 13; k++) {
          const br = branches[k % 5], p = at(br, 0.3 + r() * 0.6);
          const dx = Math.sin(br.a + (r() - 0.5)) * 0.014, dz = Math.cos(br.a + (r() - 0.5)) * 0.014, L = 0.13 + r() * 0.05;
          const pts = [];
          for (let j = 0; j <= 4; j++) { const t = j / 4; pts.push([p[0] + dx * (1 + t * 2) + Math.sin(t * 2) * 0.01, p[1] - 0.012 - t * L, p[2] + dz * (1 + t * 2)]); }
          tube(fruit, pts, [0.008, 0.021, 0.018, 0.011, 0.002], 6, (i) => (i === 0 ? calyx : white));
        }
        return { body, fruit };
      },
    },
    cabbage: {
      height: 0.5, rowStep: 2, xs: 1.05, scale: 1.55, fruitTint: 'white', unripe: '#b9d38a', ripe: '#f2f8dc', fruitTone: 0.72, fruitMat: 'foliage',
      build(r) {
        const body = new GB(), fruit = new GB();
        const o0 = col('#3f7d2a'), o1 = col('#6fae45'), rib = col('#dcecb8');
        for (let k = 0; k < 11; k++) {
          const a = (k / 11) * TAU + r() * 0.3;
          leaf(body, MX(Math.sin(a) * 0.03, 0.02, Math.cos(a) * 0.03, a, 0.22 + r() * 0.25, (r() - 0.5) * 0.3), { len: 0.34 + r() * 0.07, wid: 0.27 + r() * 0.05, shape: 'broad', segs: 5, cols: 4, curl: -0.38, fold: 0.42, serr: 0.06, c0: jitterColor(o0, r, 0.1), c1: jitterColor(o1, r, 0.1), rib });
        }
        const i0 = col('#5f9e3c'), i1 = col('#93c860');
        for (let k = 0; k < 7; k++) {
          const a = (k / 7) * TAU + 0.4 + r() * 0.3;
          leaf(body, MX(Math.sin(a) * 0.03, 0.03, Math.cos(a) * 0.03, a, 0.7 + r() * 0.2, 0), { len: 0.26, wid: 0.21, shape: 'broad', segs: 4, cols: 4, curl: -0.12, fold: 0.5, serr: 0.05, c0: i0, c1: i1, rib });
        }
        // napa head: upright overlapping leaves curling inward (green tips, pale bases) + core
        const h0 = col('#eef3d6'), h1 = col('#7fb04a'), hr = col('#f6f8ea');
        for (let k = 0; k < 9; k++) {
          const a = (k / 9) * TAU + r() * 0.2;
          leaf(fruit, MX(Math.sin(a) * 0.055, 0.02, Math.cos(a) * 0.055, a, 1.32 + r() * 0.1, 0), { len: 0.36 + r() * 0.04, wid: 0.22, shape: 'broad', segs: 5, cols: 4, curl: 0.3, fold: 0.5, c0: h0, c1: h1, rib: hr });
        }
        const core = new THREE.SphereGeometry(1, 10, 8);
        fruit.geo(core, MX(0, 0.19, 0, 0, 0, 0, 0.1, 0.19, 0.1), h0, h1, -1, 1);
        return { body, fruit };
      },
    },
    perilla: {
      height: 0.85, rowStep: 2, xs: 1.0, scale: 1.38, fruitTint: 'data', unripe: '#8ab86a', fruitMat: 'foliage',
      build(r) {
        const body = new GB(), fruit = new GB();
        const s0 = col('#3f6e2c'), s1 = col('#5f8f3c');
        const lean = (r() - 0.5) * 0.04;
        const stem = [[0, 0, 0], [lean, 0.28, 0], [lean * 1.5, 0.55, 0.01], [lean * 2, 0.8, 0.01]];
        tube(body, stem, [0.014, 0.011, 0.008, 0.005], 4, s0, s1);
        const l0 = col('#245c1b'), l1 = col('#4d9436'), rib = col('#8cbf6a');
        const leafAt = (x, y, z, a, f, pitch) => {
          const px = x + Math.sin(a) * 0.035 * f, pz = z + Math.cos(a) * 0.035 * f;
          tube(body, [[x, y, z], [px, y + 0.01, pz]], 0.003, 3, s1, s1);
          leaf(body, MX(px, y + 0.01, pz, a, pitch, (r() - 0.5) * 0.3), { len: 0.22 * f, wid: 0.2 * f, shape: 'broad', segs: 4, cols: 4, curl: -0.34, fold: 0.26, serr: 0.08, c0: jitterColor(l0, r, 0.12), c1: jitterColor(l1, r, 0.12), rib });
        };
        const nodes = [0.08, 0.17, 0.27, 0.37, 0.47, 0.57, 0.66, 0.74];
        nodes.forEach((y, n) => {
          const f = 1 - (n / nodes.length) * 0.45;
          const a0 = (n % 2 ? PI / 2 : 0) + r() * 0.3;
          for (const side of [0, PI]) leafAt(lean * y * 2, y, 0, a0 + side, f, 0.08 + r() * 0.22);
        });
        const tips = [];
        for (const [y, a] of [[0.24, 0.6 + r()], [0.36, 2.7 + r()], [0.46, 4.6 + r()]]) {
          const end = [Math.sin(a) * 0.22, y + 0.28, Math.cos(a) * 0.22];
          tube(body, [[lean * y * 2, y, 0], [Math.sin(a) * 0.1, y + 0.12, Math.cos(a) * 0.1], end], [0.007, 0.005, 0.003], 4, s0, s1);
          for (let k = 0; k < 3; k++) {
            const t = 0.45 + k * 0.25;
            leafAt(end[0] * t, y + 0.28 * t, end[2] * t, a + (k % 2 ? 1.5 : -1.5), 0.7, 0.2);
          }
          tips.push(end);
        }
        for (const e of tips) fruitSpike(fruit, e, 0.07, 0.013);
        fruitSpike(fruit, stem[3], 0.09, 0.015);
        return { body, fruit };
      },
    },
    corn: {
      height: 2.0, rowStep: 2, xs: 1.1, scale: 1.08, fruitTint: 'white', unripe: '#c4d8a0', ripe: '#ffffff', fruitTone: 0.85,
      build(r) {
        const body = new GB(), fruit = new GB();
        const s0 = col('#4d8a2e'), s1 = col('#86b850');
        const pts = [];
        for (let k = 0; k <= 8; k++) { const t = k / 8; pts.push([Math.sin(t * 2.2) * 0.012, t * 1.74, 0]); }
        tube(body, pts, [0.03, 0.028, 0.025, 0.023, 0.02, 0.018, 0.016, 0.014, 0.011], 7, s0, s1);
        for (let k = 0; k < 4; k++) { const a = (k / 4) * TAU + 0.4; tube(body, [[0, 0.1, 0], [Math.sin(a) * 0.07, 0.0, Math.cos(a) * 0.07]], [0.009, 0.006], 4, s0, s0); }
        const l0 = col('#2f6e22'), l1 = col('#7fb04a'), rib = col('#c9e39a');
        for (let k = 0; k < 11; k++) {
          const y = 0.18 + k * 0.13, a = (k % 2 ? PI : 0) + (r() - 0.5) * 0.7 + k * 0.17;
          leaf(body, MX(Math.sin(a) * 0.022, y, Math.cos(a) * 0.022, a, 0.85 + r() * 0.2, (r() - 0.5) * 0.4), { len: 0.82 - k * 0.03, wid: 0.11, shape: 'strap', segs: 6, curl: -0.95 - r() * 0.2, fold: 0.3, c0: jitterColor(l0, r, 0.1), c1: jitterColor(l1, r, 0.1), rib });
        }
        // tassel
        const t0 = col('#c7a75a'), t1 = col('#efdb9c');
        const top = [0.0, 1.74, 0];
        tube(fruit, [top, [0, 1.86, 0], [0.01, 1.99, 0]], [0.007, 0.005, 0.002], 4, t0, t1);
        for (let k = 0; k < 8; k++) {
          const a = (k / 8) * TAU + r() * 0.4, L = 0.22 + r() * 0.08;
          tube(fruit, curvePts([0, 1.8 + r() * 0.06, 0], [Math.sin(a) * L, 1.78 - L * 0.35, Math.cos(a) * L], 0.08, 3), [0.005, 0.004, 0.003, 0.0015], 3, t0, t1);
        }
        // ears in husks + silk + peeking kernels
        const husk0 = col('#6c9f3e'), husk1 = col('#a7cc70'), silk = col('#9b6a3a'), kern = col('#f2cf4a');
        for (const [y, a] of [[0.84, 0.6 + r() * 0.4], [1.02, 3.6 + r() * 0.4]]) {
          const dx = Math.sin(a), dz = Math.cos(a);
          const base = [dx * 0.025, y, dz * 0.025];
          const ep = [];
          for (let j = 0; j <= 5; j++) { const t = j / 5; ep.push([base[0] + dx * (0.03 + t * 0.1), y + t * 0.23, base[2] + dz * (0.03 + t * 0.1)]); }
          tube(fruit, ep, [0.014, 0.042, 0.046, 0.04, 0.028, 0.009], 7, husk0, husk1);
          const tip = ep[5];
          fruit.geo(new THREE.SphereGeometry(1, 7, 5), MX(tip[0] - dx * 0.014, tip[1] - 0.014, tip[2] - dz * 0.014, a, 0.45, 0, 0.022, 0.03, 0.022), kern, kern);
          for (let s = 0; s < 6; s++) {
            const sa = r() * TAU;
            tube(fruit, [tip, [tip[0] + dx * 0.03 + Math.sin(sa) * 0.03, tip[1] + 0.02, tip[2] + dz * 0.03 + Math.cos(sa) * 0.03], [tip[0] + dx * 0.05 + Math.sin(sa) * 0.05, tip[1] - 0.02, tip[2] + dz * 0.05 + Math.cos(sa) * 0.05]], [0.0025, 0.002, 0.001], 3, silk, silk);
          }
        }
        return { body, fruit };
      },
    },
    radish: {
      height: 0.48, rowStep: 2, xs: 0.85, scale: 1.45, fruitTint: 'white', unripe: '#e6efd8', ripe: '#ffffff', fruitTone: 0.95,
      build(r) {
        const body = new GB(), fruit = new GB();
        const l0 = col('#2c6a22'), l1 = col('#5fa63c'), rib = col('#b5d98e');
        for (let k = 0; k < 13; k++) {
          const a = (k / 13) * TAU + r() * 0.35;
          leaf(body, MX(Math.sin(a) * 0.03, 0.1, Math.cos(a) * 0.03, a, 0.75 + r() * 0.35, (r() - 0.5) * 0.4), { len: 0.34 + r() * 0.1, wid: 0.11, shape: 'lance', segs: 6, curl: -0.45, fold: 0.15, serr: 0.32, c0: jitterColor(l0, r, 0.1), c1: jitterColor(l1, r, 0.1), rib });
        }
        // white root shoulder with a green top
        const g0 = col('#f6f4ea'), g1 = col('#b3d382');
        tube(fruit, [[0, -0.06, 0], [0, 0.02, 0], [0, 0.08, 0], [0, 0.11, 0], [0, 0.125, 0]], [0.05, 0.056, 0.054, 0.045, 0.024], 9, (i, n) => _cb.copy(g0).lerp(g1, Math.pow(i / (n - 1), 1.6)), null, true);
        return { body, fruit };
      },
    },
    mint: {
      height: 0.36, rowStep: 2, xs: 0.9, scale: 1.85, fruitTint: 'data', unripe: '#9fd59a', fruitMat: 'foliage', fruitTone: 0.8,
      build(r) {
        const body = new GB(), fruit = new GB();
        const s0 = col('#3f7a32'), s1 = col('#5c9a46');
        const l0 = col('#1f7a32'), l1 = col('#4fb24f'), rib = col('#9fdc96');
        for (let s = 0; s < 12; s++) {
          const a = (s / 12) * TAU + r() * 0.5, lean = 0.15 + r() * 0.3, H = 0.18 + r() * 0.14;
          const end = [Math.sin(a) * (0.05 + lean * H), H, Math.cos(a) * (0.05 + lean * H)];
          const st = [[Math.sin(a) * 0.02, 0, Math.cos(a) * 0.02], [lerp(0, end[0], 0.5), H * 0.5, lerp(0, end[2], 0.5)], end];
          tube(body, st, [0.006, 0.005, 0.003], 4, s0, s1);
          for (let n = 0; n < 4; n++) {
            const t = 0.25 + n * 0.2, y = H * t;
            const px = lerp(st[0][0], end[0], t), pz = lerp(st[0][2], end[2], t);
            const na = a + (n % 2 ? PI / 2 : 0);
            for (const side of [0, PI]) leaf(body, MX(px, y, pz, na + side, 0.15 + r() * 0.2, 0), { len: 0.07 - n * 0.006, wid: 0.05 - n * 0.004, segs: 3, shape: 'ovate', curl: -0.2, fold: 0.3, serr: 0.12, c0: jitterColor(l0, r, 0.12), c1: jitterColor(l1, r, 0.12), rib });
          }
          const f0 = col('#bfe8b6'), f1 = col('#e4f7dc');
          for (let k = 0; k < 4; k++) leaf(fruit, MX(end[0], end[1], end[2], a + k * PI / 2, 0.85, 0), { len: 0.045, wid: 0.034, segs: 3, shape: 'ovate', curl: -0.05, fold: 0.35, serr: 0.1, c0: f0, c1: f1, rib: f1 });
        }
        return { body, fruit };
      },
    },
    lavender: {
      height: 0.62, rowStep: 2, xs: 1.05, scale: 1.55, fruitTint: 'data', unripe: '#b8c2a8', fruitTone: 0.95, fruitMat: 'foliage',
      build(r) {
        const body = new GB(), fruit = new GB();
        const n0 = col('#4f7550'), n1 = col('#93ad89');
        for (let k = 0; k < 54; k++) {
          const a = r() * TAU, rr = r() * 0.08;
          leaf(body, MX(Math.sin(a) * rr, 0.01, Math.cos(a) * rr, a, 0.55 + r() * 0.75, 0), { len: 0.13 + r() * 0.08, wid: 0.016, shape: 'needle', segs: 2, curl: -0.12, fold: 0, c0: n0, c1: n1 });
        }
        const s0 = col('#6f8f5c'), s1 = col('#9db58a');
        const f0 = col('#ffffff'), f1 = col('#f3eaff');
        for (let k = 0; k < 24; k++) {
          const a = r() * TAU, tilt = 0.1 + r() * 0.5, L = 0.36 + r() * 0.18;
          const bx = Math.sin(a) * 0.05, bz = Math.cos(a) * 0.05;
          const tx = bx + Math.sin(a) * Math.sin(tilt) * L, tz = bz + Math.cos(a) * Math.sin(tilt) * L, ty = 0.06 + Math.cos(tilt) * L;
          tube(body, [[bx, 0.05, bz], [lerp(bx, tx, 0.5), lerp(0.05, ty, 0.5), lerp(bz, tz, 0.5)], [tx, ty, tz]], [0.0035, 0.003, 0.0024], 3, s0, s1);
          const dx = (tx - bx) / L, dy = (ty - 0.05) / L, dz = (tz - bz) / L;
          const sp = [];
          for (let j = 0; j <= 4; j++) { const t = j / 4; sp.push([tx + dx * t * 0.1, ty + dy * t * 0.1, tz + dz * t * 0.1]); }
          tube(fruit, sp, [0.008, 0.016, 0.016, 0.012, 0.004], 5, f0, f1);
        }
        return { body, fruit };
      },
    },
    rosemary: {
      height: 0.56, rowStep: 2, xs: 1.0, scale: 1.6, fruitTint: 'data', unripe: '#c9d7e2', fruitTone: 0.95,
      build(r) {
        const body = new GB(), fruit = new GB();
        const w0 = col('#6b5a3c'), w1 = col('#5d7a45');
        const n0 = col('#1f4f2c'), n1 = col('#4f7f52');
        const fl = col('#ffffff');
        for (let b = 0; b < 9; b++) {
          const a = (b / 9) * TAU + r() * 0.4, tilt = 0.08 + r() * 0.35, L = 0.36 + r() * 0.18;
          const bx = Math.sin(a) * 0.03, bz = Math.cos(a) * 0.03;
          const pts = [];
          for (let j = 0; j <= 4; j++) { const t = j / 4; const tl = tilt * (0.6 + t * 0.6); pts.push([bx + Math.sin(a) * Math.sin(tl) * L * t, 0.01 + Math.cos(tl) * L * t, bz + Math.cos(a) * Math.sin(tl) * L * t]); }
          tube(body, pts, [0.008, 0.007, 0.005, 0.004, 0.002], 4, w0, w1);
          for (let k = 0; k < 22; k++) {
            const t = 0.12 + (k / 22) * 0.88, i = Math.min(3, Math.floor(t * 4)), u = t * 4 - i;
            const p = [lerp(pts[i][0], pts[i + 1][0], u), lerp(pts[i][1], pts[i + 1][1], u), lerp(pts[i][2], pts[i + 1][2], u)];
            leaf(body, MX(p[0], p[1], p[2], k * 2.4 + r() * 0.5, 0.5 + r() * 0.6, 0), { len: 0.045 + r() * 0.015, wid: 0.01, shape: 'needle', segs: 2, curl: -0.1, fold: 0, c0: jitterColor(n0, r, 0.1), c1: jitterColor(n1, r, 0.1) });
          }
          for (let k = 0; k < 3; k++) {
            const t = 0.5 + r() * 0.45, i = Math.min(3, Math.floor(t * 4)), u = t * 4 - i;
            const p = [lerp(pts[i][0], pts[i + 1][0], u), lerp(pts[i][1], pts[i + 1][1], u), lerp(pts[i][2], pts[i + 1][2], u)];
            const fa = r() * TAU;
            fruit.geo(new THREE.IcosahedronGeometry(1, 0), MX(p[0] + Math.sin(fa) * 0.016, p[1] + 0.006, p[2] + Math.cos(fa) * 0.016, fa, 0, 0, 0.013, 0.009, 0.013), fl, fl);
          }
        }
        return { body, fruit };
      },
    },
    lemonbalm: {
      height: 0.4, rowStep: 2, xs: 0.95, scale: 1.8, fruitTint: 'data', unripe: '#a9d47c', fruitMat: 'foliage', fruitTone: 0.85,
      build(r) {
        const body = new GB(), fruit = new GB();
        const s0 = col('#4f8a35'), s1 = col('#76b04a');
        const l0 = col('#4a9230'), l1 = col('#93cc5a'), rib = col('#cfeca2');
        for (let s = 0; s < 12; s++) {
          const a = (s / 12) * TAU + r() * 0.4, lean = 0.35 + r() * 0.35, H = 0.15 + r() * 0.14;
          const end = [Math.sin(a) * (0.04 + lean * H), H, Math.cos(a) * (0.04 + lean * H)];
          tube(body, [[Math.sin(a) * 0.015, 0, Math.cos(a) * 0.015], end], [0.005, 0.003], 4, s0, s1);
          for (let n = 0; n < 3; n++) {
            const t = 0.3 + n * 0.25, px = end[0] * t, pz = end[2] * t, y = H * t;
            const na = a + (n % 2 ? PI / 2 : 0);
            for (const side of [0, PI]) leaf(body, MX(px, y, pz, na + side, 0.1 + r() * 0.2, (r() - 0.5) * 0.3), { len: 0.082 - n * 0.008, wid: 0.075 - n * 0.007, segs: 3, cols: 4, shape: 'broad', curl: -0.25, fold: 0.3, serr: 0.14, c0: jitterColor(l0, r, 0.12), c1: jitterColor(l1, r, 0.12), rib });
          }
          const f0 = col('#d6edb0'), f1 = col('#f2fbe2');
          for (let k = 0; k < 3; k++) leaf(fruit, MX(end[0], end[1], end[2], a + k * 2.1, 0.8, 0), { len: 0.05, wid: 0.045, segs: 3, shape: 'round', curl: -0.05, fold: 0.35, serr: 0.12, c0: f0, c1: f1, rib: f1 });
        }
        return { body, fruit };
      },
    },
  };
  function fruitSpike(gb, at, L, r0) {
    const c = col('#ffffff');
    const pts = [];
    for (let j = 0; j <= 4; j++) pts.push([at[0], at[1] + (j / 4) * L, at[2]]);
    tube(gb, pts, [r0 * 0.6, r0, r0 * 0.95, r0 * 0.7, r0 * 0.2], 5, c, c);
  }
  const SPROUT = {
    build(r) {
      const body = new GB();
      const s = col('#7fb85a');
      tube(body, [[0, 0, 0], [0.003, 0.03, 0], [0, 0.055, 0.002]], [0.004, 0.0035, 0.003], 4, s, s);
      const c0 = col('#6cb24a'), c1 = col('#b0e07a');
      leaf(body, MX(0, 0.055, 0, 0, 0.35, 0), { len: 0.04, wid: 0.03, shape: 'round', curl: -0.1, fold: 0.3, c0, c1 });
      leaf(body, MX(0, 0.055, 0, PI, 0.35, 0), { len: 0.04, wid: 0.03, shape: 'round', curl: -0.1, fold: 0.3, c0, c1 });
      leaf(body, MX(0, 0.05, 0, PI / 2 + r() * 0.3, 0.95, 0), { len: 0.028, wid: 0.018, shape: 'ovate', curl: 0, fold: 0.3, c0, c1 });
      return body;
    },
  };
  const MOUND = {
    build() {
      const gb = new GB();
      const g = new THREE.SphereGeometry(1, 12, 5, 0, TAU, 0, PI / 2);
      gb.geo(g, MX(0, -0.012, 0, 0, 0, 0, 0.15, 0.055, 0.15), col('#5a3d27'), col('#7a5639'), 0, 1);
      return gb;
    },
  };

  const geoCache = new Map();
  function modelGeo(model) {
    if (geoCache.has(model)) return geoCache.get(model);
    let out = null;
    try {
      const def = MODELS[model];
      if (def) {
        const r = U.rng('crop:' + model);
        const { body, fruit } = def.build(r);
        out = { body: body.build(def.tone ?? 0.62), fruit: fruit && fruit.count ? fruit.build(def.fruitTone ?? 0.9) : null };
      }
    } catch (e) { G.log.error('FARM', `crop model ${model} failed`, e); out = null; }
    geoCache.set(model, out);
    return out;
  }
  let sproutGeo = null, moundGeo = null;
  const getSprout = () => sproutGeo || (sproutGeo = SPROUT.build(U.rng('sprout')).build(0.68));
  const getMound = () => moundGeo || (moundGeo = MOUND.build().build());

  // ---------------------------------------------------------------- materials (shared, with wind sway)
  const windU = { uTime: { value: 0 }, uWind: { value: 1 } };
  function swayMaterial(key, opts) {
    return G.gfx.material('farm:' + key, () => {
      const m = new THREE.MeshStandardMaterial(Object.assign({ vertexColors: true, roughness: 0.78, metalness: 0, side: THREE.DoubleSide, envMapIntensity: 0.55 }, opts));
      m.onBeforeCompile = (sh) => {
        sh.uniforms.uTime = windU.uTime;
        sh.uniforms.uWind = windU.uWind;
        sh.vertexShader = 'uniform float uTime;\nuniform float uWind;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
          #ifdef USE_INSTANCING
            vec2 ipos = vec2(instanceMatrix[3][0], instanceMatrix[3][2]) + vec2(modelMatrix[3][0], modelMatrix[3][2]);
          #else
            vec2 ipos = vec2(modelMatrix[3][0], modelMatrix[3][2]);
          #endif
          float hh = max(position.y, 0.0);
          float ph = uTime * 1.7 + dot(ipos, vec2(0.37, 0.53));
          float k = pow(hh, 1.35) * 0.06 * uWind;
          transformed.x += (sin(ph) + 0.35 * sin(ph * 2.3 + 1.1)) * k;
          transformed.z += cos(ph * 0.87 + 0.6) * k * 0.7;
          transformed.y += sin(uTime * 5.3 + position.x * 31.0 + position.z * 17.0) * 0.004 * hh * uWind;`);
      };
      m.customProgramCacheKey = () => 'farm-sway';
      return m;
    });
  }
  const foliageMat = () => swayMaterial('foliage', { roughness: 0.8 });
  const fruitMat = () => swayMaterial('fruit', { roughness: 0.42, metalness: 0.02 });
  const moundMat = () => G.gfx.material('farm:mound', () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 }));

  // ===========================================================================================
  // farming system
  // ===========================================================================================
  const RAIN_WATER_RATE = 0.6; // water % per second under full rain (a dry bed is soaked in ~2-3 min)
  // rain soaks a bed up to here, never to 100 %: a bed always still takes a watering can (the "물 주기" quest steps,
  // the 💧 tap and the water button all need water < 100 %, and a long rain spell would otherwise block them)
  const RAIN_WATER_CAP = 92;
  const DEF_CFG = { waterPerAction: 45, waterCooldown: 2.5, dryThreshold: 25, healthDecayDry: 0.25, healthRegen: 0.08, basketBonus: 1, offlineCatchUpMax: 3600 };
  let CFG = null;
  const cfg = () => CFG || (CFG = Object.assign({}, DEF_CFG, G.data.farming || {}));
  const crops = () => G.data.crops || {};
  const cropOf = (id) => (id && crops()[id]) || null;
  const items = () => G.data.items || {};
  const STAGES = () => G.data.cropStages || [{ id: 'seed', name: '씨앗', min: 0 }, { id: 'sprout', name: '새싹', min: 20 }, { id: 'growing', name: '성장 중', min: 50 }, { id: 'mature', name: '성숙', min: 80 }, { id: 'harvestable', name: '수확 가능', min: 100 }];
  function stageOf(growth) {
    const st = STAGES();
    let s = st[0];
    for (const x of st) if (growth >= x.min) s = x;
    return s;
  }
  const isHerbPlot = (def) => def.zone === 'ZONE_HERB';
  const plotCategory = (def) => (isHerbPlot(def) ? 'herb' : 'crop');
  const CIRCLED = { 0: '⓪', 1: '①', 2: '②', 3: '③', 4: '④', 5: '⑤', 6: '⑥', 7: '⑦', 8: '⑧', 9: '⑨', A: 'Ⓐ', B: 'Ⓑ', C: 'Ⓒ', D: 'Ⓓ', E: 'Ⓔ', F: 'Ⓕ' };
  /** ms of watering cooldown left (a stamp from the future — clock moved back — counts as no cooldown) */
  const waterCoolLeft = (s) => { const d = now() - (Number(s?.lastWaterAt) || 0); return d < 0 ? 0 : Math.max(0, cfg().waterCooldown * 1000 - d); };
  const plotTitle = (def, crop) => (crop ? `${crop.name}밭` : isHerbPlot(def) ? '빈 허브밭' : '빈 밭');
  const now = () => G.time.now();
  const LABEL_HZ = 0.25;
  const HARVEST_END = 1.25;  // s: plants wiggle, then vanish at the "pull" of the harvest animation
  const NO_RAY = () => {};

  const _cam = new THREE.Vector3(), _tmpC = new THREE.Color(), _tmpC2 = new THREE.Color(), _cc = new THREE.Color();
  const _mat = new THREE.Matrix4(), _pos = new THREE.Vector3(), _quat = new THREE.Quaternion(), _scl = new THREE.Vector3(), _eul = new THREE.Euler(0, 0, 0, 'YXZ');
  const _hand = new THREE.Vector3();
  const DRY_TINT = new THREE.Color(0.95, 0.74, 0.38);
  const SOIL_DRY = new THREE.Color(1.0, 0.96, 0.92), SOIL_WET = new THREE.Color(0.5, 0.45, 0.42);

  // ---------------------------------------------------------------- 쉬운 모드 helpers (pictures instead of numbers)
  const kidOn = () => !!(G.easy ? G.easy.on : G.settings?.easyMode !== false);
  const KID_WATER_AT = 80;               // one tap waters a bed below this water level
  const KID_STAGE = ['🌱', '🌿', '🌾'];   // + the crop's own picture when it is ready
  const kidStageIdx = (g) => (g >= 100 ? 3 : g >= 80 ? 2 : g >= 50 ? 1 : 0);
  const cropPic = (crop) => items()[crop?.harvestItem]?.icon || '🌾';
  const kidStagePic = (crop, g) => { const i = kidStageIdx(g); return i === 3 ? cropPic(crop) : KID_STAGE[i]; };
  const kidFace = (health) => (health >= 70 ? '😊' : health >= 40 ? '😐' : '😟');
  const kidDrops = (water) => clamp(Math.round((Number(water) || 0) / 20), 0, 5);
  const kidSay = (text, opts) => { try { G.easy?.say?.(text, opts || { priority: 1 }); } catch (e) { /* voice optional */ } };
  const pickOne = (a) => a[Math.floor(Math.random() * a.length)];
  /** one short sentence about a planted bed for children */
  function kidSentence(s, crop) {
    const C = cfg();
    if (!crop) return '';
    if (s.growth >= 100) return `${josa(crop.name, '이/가')} 다 자랐어요! 거둬요 🧺`;
    if (s.water <= 0) return '흙이 바싹 말랐어요! 물을 주세요 💧';
    if (s.water < C.dryThreshold) return '목이 말라요! 물을 주세요 💧';
    if (s.health < 40) return '조금 아파요. 물을 주면 나아요 💚';
    if ((Number(G.sys.weather?.precipitation?.rain) || 0) > 0.15) return '비가 와서 촉촉해요 🌧️';
    if (s.water < KID_WATER_AT) return '쑥쑥 자라요! 물을 더 줘도 좋아요 💧';
    return '쑥쑥 자라고 있어요! 조금만 기다려요 😊';
  }

  const farming = {
    name: 'farming', order: 60, label: '농장',
    _plots: new Map(),   // id -> runtime {def, group, root, meshes, plants[], label, vis, ...}
    _tick: 0,
    _modal: null,
    _emitters: [],
    _ready: false,

    // ------------------------------------------------------------ lifecycle
    init() {
      FX.ensure();
      const L = G.data.layout || {};
      const preset = G.sys.engine?.preset || {};
      this._lowQ = preset.name === 'low';
      this._shadows = !!preset.shadows;
      for (const def of L.farmPlots || []) {
        try { this._buildPlot(def); } catch (e) { G.log.error('FARM', `plot ${def.id} build failed`, e); }
      }
      G.bus.on('state:before-save', () => { if (G.state) this._simulateAll(); });
      // graphics quality changed in the settings: crop shadows and the low-preset plant spacing follow it
      G.bus.on('engine:quality', (p) => this._applyQuality(p?.preset || G.sys.engine?.preset || {}));
      // a bed registered later (props rebuilt) replaces our fallback / old bed
      G.bus.on('world:object', ({ id, obj }) => {
        const P = this._plots.get(id);
        if (!P || !obj || P.group === obj) return;
        this._adoptGroup(P, obj, false);
        if (G.state) { P.modelId = '__rebuild'; this._syncVisual(P, true); }
      });
      // 쉬운 모드 switched: labels switch picture/number rows at once, an open plot window reopens in the other style
      G.bus.on('easy:changed', () => {
        for (const P of this._plots.values()) if (P.labelEls) P.labelEls.last = {};
        if (G.state && this._ready) this._refreshLabels(true);
        const md = this._modal;
        if (md && !md.m.closed && md.kid !== kidOn() && G.ui.modal.top?.() === md.m) { const id = md.id; md.m.close(); this.openPlot(id); }
      });
      G.log.info('FARM', `${this._plots.size} plots ready`);
    },

    onStateLoaded(state) {
      if (!state) return;
      state.farm = state.farm && typeof state.farm === 'object' ? state.farm : { plots: {} };
      state.farm.plots = state.farm.plots && typeof state.farm.plots === 'object' ? state.farm.plots : {};
      const t = now();
      for (const P of this._plots.values()) {
        const def = P.def;
        let s = state.farm.plots[def.id];
        if (!s || typeof s !== 'object') {
          s = state.farm.plots[def.id] = this._initialPlotState(def, t);
        }
        // repair
        if (s.cropId && !cropOf(s.cropId)) s.cropId = null;
        for (const k of ['growth', 'water', 'health']) s[k] = clamp(Number(s[k]) || 0, 0, 100);
        if (!s.cropId) s.growth = 0;
        if (!Number.isFinite(s.lastUpdate) || s.lastUpdate <= 0 || s.lastUpdate > t + 60000) s.lastUpdate = t;
        s.harvests = Number(s.harvests) || 0;
        // a save from a device whose clock ran ahead: a future stamp would keep the watering cooldown on for hours
        s.lastWaterAt = Number(s.lastWaterAt) || 0;
        if (s.lastWaterAt > t) s.lastWaterAt = 0;
        s.plantedAt = Math.min(Number(s.plantedAt) || (s.cropId ? t : 0), t);
        this._simulate(def.id, t);
        P.vis.g = P.vis.gT = s.growth; P.vis.w = P.vis.wT = s.water; P.vis.wApplied = -99; P.vis.trans = 1; P.vis.harvestT = -1; P.vis.key = '';
        P.busyUntil = 0;
        this._syncVisual(P, true);
      }
      this._ready = true;
      this._refreshLabels(true);
    },

    onLogout() {
      this._ready = false;
      this._modal?.m?.close?.();
      this._modal = null;
      this._emitters.length = 0;
      FX.clear();
      for (const P of this._plots.values()) { P.label?.setVisible(false); P.vis.harvestT = -1; }
    },

    update(dt, t) {
      windU.uTime.value = t;
      FX.update(dt);
      this._updateEmitters(dt);
      if (!this._ready || !G.state) return;
      this._tick -= dt;
      if (this._tick <= 0) {
        this._tick = LABEL_HZ;
        this._simulateAll();
        this._rainWater();
        for (const P of this._plots.values()) this._syncVisual(P, false);
        this._refreshLabels(false);
        this._refreshModal();
      }
      // per-frame: easing transitions, harvest shrink, sparkles
      const cam = G.sys.engine?.camera;
      if (cam) _cam.copy(cam.position);
      for (const P of this._plots.values()) {
        const v = P.vis;
        if (v.harvestT >= 0) {
          v.harvestT += dt;
          this._layoutInstances(P);
          if (v.harvestT > HARVEST_END) { v.harvestT = -1; this._syncVisual(P, true); }
          continue;
        }
        let relayout = false;
        if (v.trans < 1) { v.trans = Math.min(1, v.trans + dt * 2.4); relayout = true; }
        // big growth jumps (debug / catch-up) ease in; normal growth snaps at the 4 Hz tick
        if (v.g !== v.gT) { v.g = Math.abs(v.gT - v.g) < 0.3 ? v.gT : v.g + (v.gT - v.g) * Math.min(1, dt * 3); relayout = true; }
        if (relayout) this._layoutInstances(P);
        // soil wetness eases toward the water level (watering = +45 % -> visible darkening)
        if (v.w !== v.wT) { v.w = Math.abs(v.wT - v.w) < 0.4 ? v.wT : v.w + (v.wT - v.w) * Math.min(1, dt * 2.5); }
        if (Math.abs(v.w - v.wApplied) > 0.35) this._applySoil(P);
        // golden sparkles over harvestable plots
        if (P.ready && P.plants.length && !G.settings.reduceMotion) {
          const d = Math.hypot(_cam.x - P.cx, _cam.z - P.cz);
          if (d < 55) {
            P.spark += dt * (this._lowQ ? 2.5 : 5);
            while (P.spark >= 1) {
              P.spark -= 1;
              const pl = P.plants[(Math.random() * P.plants.length) | 0];
              const h = P.model ? P.model.height * pl.s * (P.modelDef?.scale || 1) : 0.4;
              FX.spawn(FX.P.GLINT, pl.wx + (Math.random() - 0.5) * 0.4, P.soilY + h * (0.5 + Math.random() * 0.6), pl.wz + (Math.random() - 0.5) * 0.4, 0, 0.15, 0);
            }
          }
        }
      }
    },

    // ------------------------------------------------------------ state
    _initialPlotState(def, t) {
      const pre = def.prefill;
      const crop = cropOf(def.crop);
      if (crop && pre) {
        const growth = clamp(Number(pre.growth) || 0, 0, 100);
        return {
          cropId: crop.id, growth, water: clamp(Number(pre.water) || 0, 0, 100), health: clamp(Number(pre.health) || 100, 0, 100),
          plantedAt: t - Math.round((growth / 100) * crop.growthTime * 1000), lastUpdate: t, lastWaterAt: 0, harvests: 0,
        };
      }
      return { cropId: null, growth: 0, water: 40, health: 100, plantedAt: 0, lastUpdate: t, lastWaterAt: 0, harvests: 0 };
    },
    _state(id) { return G.state?.farm?.plots?.[id] || null; },

    /** advance one plot's simulation from lastUpdate to `t` in fixed steps */
    _simulate(id, t = now()) {
      const s = this._state(id);
      if (!s) return null;
      let el = (t - s.lastUpdate) / 1000;
      if (!(el > 0)) { if (el < -5) s.lastUpdate = t; return s; }
      const C = cfg();
      el = Math.min(el, C.offlineCatchUpMax);
      const crop = cropOf(s.cropId);
      const steps = Math.ceil(el);
      const h = el / steps;
      const rate = crop ? 100 / Math.max(1, crop.growthTime) : 0;
      const use = crop ? crop.waterUse : 0.12; // bare soil still dries out slowly
      for (let k = 0; k < steps; k++) {
        if (s.water <= 0 && !crop) break;
        const w = s.water;
        s.water = Math.max(0, w - use * h);
        if (!crop) continue;
        if (s.growth < 100 && s.health > 0) {
          const f = w <= 0 ? 0 : w < C.dryThreshold ? 0.5 : 1;
          s.growth = Math.min(100, s.growth + rate * f * h * (0.6 + 0.4 * s.health / 100));
        }
        if (w <= 0) s.health = Math.max(5, s.health - C.healthDecayDry * h);
        else if (w >= C.dryThreshold) s.health = Math.min(100, s.health + C.healthRegen * h);
      }
      s.lastUpdate = t;
      return s;
    },
    _simulateAll() { const t = now(); for (const id of this._plots.keys()) this._simulate(id, t); },

    /** live rain (weather system) slowly waters every bed — no farm:watered event (it is not the player's action) */
    _rainWater() {
      // wall-clock based like the growth simulation (frame dt is capped and would lag behind on slow devices)
      const t = now();
      const dt = this._rainAt ? clamp((t - this._rainAt) / 1000, 0, 5) : 0;
      this._rainAt = t;
      const rain = Number(G.sys.weather?.precipitation?.rain) || 0;
      if (rain < 0.15 || !(dt > 0)) { if (rain < 0.05) this._rainNotified = false; return; }
      const add = RAIN_WATER_RATE * rain * dt;
      let any = false;
      for (const id of this._plots.keys()) {
        const s = this._state(id);
        if (!s || s.water >= RAIN_WATER_CAP) continue;
        s.water = Math.min(RAIN_WATER_CAP, s.water + add);
        const P = this._plots.get(id);
        if (P) P.vis.wT = s.water;
        any = true;
      }
      if (any) G.dirty('farm');
      if (!this._rainNotified && rain > 0.5 && G.ready) {
        this._rainNotified = true;
        const near = (G.sys.minimap?.currentZone?.id || G.state?.player?.zoneId) === 'ZONE_CROP' || (G.sys.minimap?.currentZone?.id || G.state?.player?.zoneId) === 'ZONE_HERB';
        if (near) G.ui.toast('비가 내려 밭이 촉촉해지고 있어요. 비가 오는 동안은 물을 덜 줘도 돼요!', { type: 'info', emoji: '🌧️', sound: false, duration: 4200 });
      }
    },

    /** seconds to 100 %: {full: watered well, now: with the current water (Infinity if it stalls)} */
    _eta(s, crop) {
      if (!crop || s.growth >= 100) return { full: 0, now: 0 };
      const C = cfg();
      const hf = 0.6 + 0.4 * s.health / 100;
      const rate = (100 / Math.max(1, crop.growthTime)) * hf;
      const need = 100 - s.growth;
      const full = need / rate;
      let g = 0, tt = 0, w = s.water;
      if (w > C.dryThreshold) { const t1 = (w - C.dryThreshold) / crop.waterUse; if (rate * t1 >= need) return { full, now: need / rate }; g += rate * t1; tt += t1; w = C.dryThreshold; }
      if (w > 0) { const t2 = w / crop.waterUse; if (g + rate * 0.5 * t2 >= need) return { full, now: tt + (need - g) / (rate * 0.5) }; g += rate * 0.5 * t2; tt += t2; }
      return { full, now: Infinity, stallAt: s.growth + g };
    },

    // ------------------------------------------------------------ public API
    plotIds() { return Array.from(this._plots.keys()); },
    plots() { return this.plotIds().map((id) => this.getPlot(id)).filter(Boolean); },
    getPlot(id) {
      const P = this._plots.get(id);
      const s = this._state(id);
      if (!P) return null;
      if (!s) {
        const pre = P.def.prefill || {};
        return { id, def: P.def, cropId: P.def.crop || null, crop: cropOf(P.def.crop), growth: pre.growth || 0, water: pre.water || 0, health: pre.health || 100, stage: 'seed', stageName: '씨앗', ready: false, empty: !P.def.crop };
      }
      const crop = cropOf(s.cropId);
      const st = stageOf(s.growth);
      return {
        id, def: P.def, state: s, cropId: s.cropId, crop, growth: s.growth, water: s.water, health: s.health,
        stage: crop ? st.id : 'empty', stageName: crop ? st.name : '비어 있음', ready: !!crop && s.growth >= 100, empty: !crop,
        dry: !!crop && s.water < cfg().dryThreshold, eta: crop ? this._eta(s, crop) : null,
        plantedAt: s.plantedAt, harvests: s.harvests, category: plotCategory(P.def),
      };
    },

    primary(id) {
      const s = this._simulate(id);
      if (!s) return;
      const P = this._plots.get(id);
      if (P && performance.now() < P.busyUntil) {
        // still watering / harvesting / planting: the prompt shows ⏳ — the tap answers instead of doing nothing
        if (kidOn()) { kidSay(P.busyLine || '조금만 기다려요!', { priority: 1 }); G.kidKit?.shake?.(document.getElementById('interact-prompt')); }
        return;
      }
      if (kidOn()) { this._kidPrimary(id, s); return; }
      if (!s.cropId) { this.openPlot(id); return; }
      if (s.growth >= 100) { this.harvest(id); return; }
      if (s.water < 90) { this.water(id); return; }
      this.openPlot(id);
    },
    /** the "다음 할 일" step right now is 💧 watering (then one tap waters any bed that still takes water, ripe or not) */
    _questWantsWater() {
      try {
        const f = G.sys.quest?.focus?.();
        if (!f || f.mode !== 'objective') return false;
        return G.data.quests?.[f.questId]?.objectives?.[f.objective]?.type === 'water';
      } catch (e) { return false; }
    },
    /** 쉬운 모드 one tap: plant (seed pictures) / harvest / water / big picture card */
    _kidPrimary(id, s) {
      if (!s.cropId) { this._kidPlant(id); return; }
      const cool = waterCoolLeft(s) > 0;
      // the tap does what the gold prompt SAYS: the words were picked a moment ago (the quest focus can move on in
      // between — e.g. the step turns to 💧 the frame a zone visit completes), so follow the shown action while it is fresh
      const shown = this._kidShown?.get(id);
      if (shown && performance.now() - shown.t < 1500) {
        if (shown.act === 'harvest' && s.growth >= 100) { this.harvest(id); return; }
        if (shown.act === 'water' && !cool && s.water < 100) { this.water(id); return; }
        if (shown.act === 'view') { this.openPlot(id); return; }
      }
      // card says "물을 줘요" -> the tap waters first, even a ripe bed (otherwise the step could never be done)
      if (!cool && s.water < 100 && this._questWantsWater()) { this.water(id); return; }
      if (s.growth >= 100) { this.harvest(id); return; }
      if (s.water < KID_WATER_AT && !cool) { this.water(id); return; }
      this.openPlot(id);
    },
    /** what one tap will do in 쉬운 모드 -> {label, emoji} (prompt words + picture) */
    _kidAction(id) {
      const a = this._kidActionNow(id);
      // remembered per bed: what the prompt shows is what the next tap does (see _kidPrimary)
      if (!this._kidShown) this._kidShown = new Map();
      const m = this._kidShown.get(id);
      if (m) { m.act = a.act; m.t = performance.now(); } else this._kidShown.set(id, { act: a.act, t: performance.now() });
      return a;
    },
    _kidActionNow(id) {
      const s = this._state(id);
      const crop = cropOf(s?.cropId);
      if (!s) return { label: '밭 보기', emoji: '👀', act: 'view' };
      const P = this._plots.get(id);
      if (P && performance.now() < P.busyUntil) return { label: '잠깐만요', emoji: '⏳', act: 'wait' };
      if (!crop) return { label: isHerbPlot(this._plots.get(id)?.def || {}) ? '모종 심기' : '씨앗 심기', emoji: '🌱', act: 'plant' };
      const cool = waterCoolLeft(s) > 0;
      if (!cool && s.water < 100 && this._questWantsWater()) return { label: '물 주기', emoji: '💧', act: 'water' };
      if (s.growth >= 100) return { label: `${crop.name} 거두기`, emoji: cropPic(crop), act: 'harvest' };
      if (s.water < KID_WATER_AT && !cool) return { label: '물 주기', emoji: '💧', act: 'water' };
      return { label: `${crop.name}밭 보기`, emoji: '👀', act: 'view' };
    },
    _primaryLabel(id) {
      const s = this._state(id), P = this._plots.get(id);
      if (!s || !P) return '밭 살펴보기';
      const crop = cropOf(s.cropId);
      if (!crop) return '씨앗 심기';
      if (s.growth >= 100) return `${crop.name} 수확하기`;
      if (s.water < 90) return `${crop.name}밭에 물 주기`;
      return `${crop.name}밭 살펴보기`;
    },

    water(id, opts = {}) {
      if (!G.state) return false;
      const P = this._plots.get(id);
      const s = this._simulate(id);
      if (!P || !s) return false;
      const crop = cropOf(s.cropId);
      const kid = kidOn();
      if (!crop) { G.ui.toast(kid ? '빈 밭이에요. 먼저 씨앗을 심어요!' : '빈 밭이에요. 먼저 씨앗을 심어 주세요.', { type: 'info', emoji: '🌱', say: kid ? '빈 밭이에요. 먼저 씨앗을 심어요!' : undefined }); return false; }
      if (!this._hasItem('ITEM_WATERING_CAN')) { this._offerWateringCan(id); return false; }
      const C = cfg();
      const t = now();
      if (waterCoolLeft(s) > 0) {
        if (!opts.silent) {
          if (kid) G.ui.toast('물이 스며들고 있어요. 조금만 기다려요!', { type: 'info', emoji: '💧', sound: false, duration: 1800, say: '물이 스며들고 있어요. 조금만 기다려요!' });
          else G.ui.toast('물이 흙에 스며드는 중이에요. 잠시 후에 다시 주세요.', { type: 'info', emoji: '💧', sound: false, duration: 1600 });
        }
        return false;
      }
      if (s.water >= 100) { G.ui.toast(kid ? '흙이 벌써 촉촉해요!' : '흙이 이미 촉촉해요. 물을 더 줄 필요가 없어요.', { type: 'info', emoji: '💧', say: kid ? '흙이 벌써 촉촉해요!' : undefined }); return false; }
      const before = s.water;
      s.water = Math.min(100, s.water + C.waterPerAction);
      s.lastWaterAt = t;
      s.lastUpdate = t;
      P.busyUntil = performance.now() + 2300;
      P.busyLine = '물이 스며들고 있어요. 조금만 기다려요!';
      this._doWaterFx(P);
      G.sfx('water');
      if (kid) {
        // pictures, not percentages: one 💧 per 20 % of water now in the bed
        G.ffx.floatText(`<b>${'💧'.repeat(Math.max(1, kidDrops(s.water)))}</b> 촉촉!`, { x: P.cx, y: P.soilY + 1.3, z: P.cz }, 'water kid');
        kidSay(pickOne(['물을 줬어요! 쑥쑥 자라라!', '시원한 물이에요! 촉촉해졌어요.', `${josa(crop.name, '이/가')} 고맙대요! 꿀꺽꿀꺽!`]));
      } else G.ffx.floatText(`<b>💧 +${Math.round(s.water - before)}%</b> 수분`, { x: P.cx, y: P.soilY + 1.3, z: P.cz }, 'water');
      G.log.info('FARM', `water ${id} (${crop.id}) ${before.toFixed(0)} -> ${s.water.toFixed(0)}`);
      G.activity('water', `${crop.name}밭에 물 주기`, { plotId: id, cropId: crop.id });
      G.dirty('farm');
      G.bus.emit('farm:watered', { plotId: id, cropId: crop.id });
      this._syncVisual(P, false);
      this._refreshLabels(true);
      this._refreshModal(true);
      return true;
    },

    plant(id, cropId) {
      if (!G.state) return false;
      const P = this._plots.get(id);
      const s = this._simulate(id);
      const crop = cropOf(cropId);
      if (!P || !s || !crop) return false;
      if (s.cropId) { G.ui.toast('이미 작물이 자라고 있어요. 먼저 수확하거나 밭을 비워 주세요.', { type: 'warn' }); return false; }
      if (crop.category !== plotCategory(P.def)) {
        G.ui.toast(plotCategory(P.def) === 'herb' ? '허브밭에는 허브 모종만 심을 수 있어요.' : '작물밭에는 작물 씨앗만 심을 수 있어요. 허브는 허브 구역에 심어 주세요.', { type: 'warn' });
        return false;
      }
      const seed = crop.seedItem;
      if (!this._hasItem(seed)) {
        G.ui.toast(`${josa(items()[seed]?.name || '씨앗', '이/가')} 없어요. 매점에서 구할 수 있어요.`, { type: 'warn', emoji: '🌱' });
        return false;
      }
      if (!this._takeItem(seed, 1)) return false;
      const t = now();
      Object.assign(s, { cropId: crop.id, growth: 0, health: 100, plantedAt: t, lastUpdate: t });
      if (!(s.water > 0)) s.water = 20;
      P.busyUntil = performance.now() + 900;
      P.busyLine = '씨앗을 심고 있어요. 조금만 기다려요!';
      const pl = G.sys.player;
      pl?.faceTowards?.(P.cx, P.cz);
      pl?.playAction?.('interact', { duration: 0.9 });
      const fp = this._frontPoint(P);
      FX.burst(FX.P.DUST, fp.x, P.soilY + 0.05, fp.z, 14, 1.0, 0.9);
      FX.burst(FX.P.SPARK, fp.x, P.soilY + 0.2, fp.z, 6, 0.6, 0.8);
      G.sfx('plant');
      if (kidOn()) {
        G.ui.toast(`${josa(crop.name, '을/를')} 심었어요! 🌱`, { type: 'success', emoji: cropPic(crop), say: `${josa(crop.name, '을/를')} 심었어요! 물을 주면 쑥쑥 자라요.` });
        G.ffx.floatText('<b>🌱</b> 심었어요!', { x: P.cx, y: P.soilY + 1.2, z: P.cz }, 'kid');
      } else G.ui.toast(`${crop.name} ${crop.category === 'herb' ? '모종' : '씨앗'}을 심었어요! 물을 주면 더 빨리 자라요.`, { type: 'success', emoji: items()[seed]?.icon || '🌱' });
      G.log.info('FARM', `plant ${id} <- ${crop.id}`);
      G.activity('plant', `${crop.name} 심기`, { plotId: id, cropId: crop.id });
      G.dirty('farm');
      G.bus.emit('farm:planted', { plotId: id, cropId: crop.id });
      P.vis.trans = 0;
      this._syncVisual(P, true);
      this._refreshLabels(true);
      this._refreshModal(true);
      return true;
    },

    harvest(id) {
      if (!G.state) return null;
      const P = this._plots.get(id);
      const s = this._simulate(id);
      const crop = cropOf(s?.cropId);
      if (!P || !s || !crop) return null;
      if (s.growth < 100) { G.ui.toast(`아직 다 자라지 않았어요. (성장률 ${Math.floor(s.growth)}%)`, { type: 'info', emoji: '🌱' }); return null; }
      const C = cfg();
      const itemId = crop.harvestItem;
      // a full stack in the bag: keep the crop in the bed (nothing would reach the bag)
      if (G.sys.inventory?.room && G.sys.inventory.room(itemId) <= 0) { G.sys.inventory.fullNotice?.(itemId); return null; }
      const [lo, hi] = Array.isArray(crop.harvestAmount) ? crop.harvestAmount : [1, 3];
      const base = U.randInt(lo, hi);
      let qty = Math.max(1, Math.round(base * (0.55 + 0.45 * s.health / 100)));
      const basket = this._hasItem('ITEM_BASKET') ? (C.basketBonus || 0) : 0;
      qty += basket;
      if (G.sys.inventory?.add) qty = G.sys.inventory.add(itemId, qty, { source: 'harvest' }) || qty; // what really went in
      else if (items()[itemId]) {
        G.state.inventory[itemId] = (Number(G.state.inventory[itemId]) || 0) + qty;
        G.bus.emit('item:added', { itemId, qty, source: 'harvest' });
        G.ui.toast(`+${items()[itemId].name} ×${qty}`, { type: 'success', emoji: items()[itemId].icon });
      }
      // coin / exp are shown in the floating harvest text + HUD counters (no extra toast in the stack)
      if (G.sys.progression?.grant) G.sys.progression.grant({ exp: crop.exp || 0, coin: crop.coin || 0 }, { popup: false, silent: true, reason: 'harvest' });
      const t = now();
      s.harvests = (s.harvests || 0) + 1;
      if (crop.category === 'herb') {
        // perennial herbs: cut back and they grow again from the sprout stage
        Object.assign(s, { growth: 30, plantedAt: t - Math.round(0.3 * crop.growthTime * 1000), lastUpdate: t });
      } else {
        Object.assign(s, { cropId: null, growth: 0, health: 100, plantedAt: 0, lastUpdate: t });
      }
      P.busyUntil = performance.now() + 2100;
      P.busyLine = '거두고 있어요. 조금만 기다려요!';
      const pl = G.sys.player;
      pl?.faceTowards?.(P.cx, P.cz);
      pl?.playAction?.('harvest');
      // shrink plants + burst at the "pull" moment of the animation
      P.vis.harvestT = 0;
      P.vis.harvestCrop = crop.id;
      const fp = this._frontPoint(P);
      const fruitC = new THREE.Color(crop.fruit || '#ffffff');
      this._emit(0.85, 0.35, () => {
        FX.burst(FX.P.LEAF, fp.x, P.soilY + 0.25, fp.z, 14, 1.8, 2.4, null, P.soilY);
        FX.burst(FX.P.POP, fp.x, P.soilY + 0.3, fp.z, 7, 1.6, 2.2, fruitC);
      }, 0.12);
      this._emit(0.9, 0.05, () => {
        FX.burst(FX.P.SPARK, fp.x, P.soilY + 0.5, fp.z, 22, 1.6, 1.8);
        for (const pl2 of P.plants) if (Math.random() < 0.5) FX.spawn(FX.P.LEAF, pl2.wx, P.soilY + 0.2, pl2.wz, (Math.random() - 0.5) * 1.2, 1.2 + Math.random(), (Math.random() - 0.5) * 1.2, null, P.soilY);
      }, 1);
      G.sfx('harvest');
      const rw = [crop.coin ? `🪙+${fmt(crop.coin)}` : '', crop.exp ? `✨+${fmt(crop.exp)}` : ''].filter(Boolean).join(' ');
      G.ffx.floatText(`<b>${esc(items()[itemId]?.icon || '🧺')} +${qty}</b> ${esc(items()[itemId]?.name || '')}${basket ? ' <small>(바구니 보너스)</small>' : ''}${rw ? `<small class="ffx-rw">${rw}</small>` : ''}`, { x: P.cx, y: P.soilY + 1.6, z: P.cz }, 'harvest');
      G.log.info('FARM', `harvest ${id} ${crop.id} -> ${itemId} x${qty}`);
      G.activity('harvest', `${crop.name} ${qty}개 수확`, { plotId: id, cropId: crop.id, itemId, qty });
      G.dirty('farm');
      G.bus.emit('farm:harvested', { plotId: id, cropId: crop.id, itemId, qty });
      const kid = kidOn();
      if (kid) {
        // a big happy moment for children: picture pop + rays + voice (G.easy.celebrate)
        const nm = items()[itemId]?.name || crop.name;
        try { G.easy?.celebrate?.(`${nm} ${qty}개!`, { emoji: items()[itemId]?.icon || '🧺', say: `${josa(nm, '을/를')} ${qty}개 거뒀어요! 최고예요!`, duration: 1900, sound: 'pop' }); } catch (e) { /* optional */ }
      }
      if (crop.category === 'herb') setTimeout(() => { if (G.state && this._ready) G.ui.toast(kid ? '허브는 잘라도 다시 자라요! 🌿' : '허브는 여러해살이라 줄기를 잘라 수확하면 다시 자라요.', { type: 'info', emoji: '🌿', sound: false }); }, kid ? 2400 : 1400);
      this._refreshLabels(true);
      this._refreshModal(true);
      return { itemId, qty };
    },

    async clear(id) {
      const P = this._plots.get(id);
      const s = this._simulate(id);
      const crop = cropOf(s?.cropId);
      if (!P || !s || !crop) return false;
      const ok = await G.ui.confirm(s.growth >= 100
        ? `${josa(crop.name, '이/가')} 다 자랐어요! 밭을 비우면 수확물 없이 작물이 사라져요. 정말 비울까요?`
        : `${crop.name}밭을 비울까요? 자라던 작물은 사라지고 씨앗은 돌려받지 못해요.`, { title: '밭 비우기', okText: '비우기', danger: true, icon: 'trash' });
      if (!ok || !G.state) return false;
      Object.assign(s, { cropId: null, growth: 0, health: 100, plantedAt: 0, lastUpdate: now() });
      const fp = this._frontPoint(P);
      FX.burst(FX.P.DUST, fp.x, P.soilY + 0.05, fp.z, 12, 1.0, 0.8);
      FX.burst(FX.P.LEAF, P.cx, P.soilY + 0.2, P.cz, 10, 1.2, 1.5, null, P.soilY);
      G.activity('farm', `${crop.name}밭 비우기`, { plotId: id, cropId: crop.id });
      G.dirty('farm');
      this._syncVisual(P, true);
      this._refreshLabels(true);
      this._refreshModal(true);
      return true;
    },

    /** debug/test helper: patch {cropId, growth, water, health} */
    setPlot(id, patch = {}) {
      const s = this._simulate(id);
      const P = this._plots.get(id);
      if (!s || !P) return null;
      if ('cropId' in patch) { s.cropId = cropOf(patch.cropId) ? patch.cropId : null; if (s.cropId && !s.plantedAt) s.plantedAt = now(); }
      for (const k of ['growth', 'water', 'health']) if (patch[k] != null) s[k] = clamp(Number(patch[k]) || 0, 0, 100);
      if (!s.cropId) s.growth = 0;
      s.lastUpdate = now();
      P.vis.g = P.vis.gT = s.growth; P.vis.w = P.vis.wT = s.water;
      this._syncVisual(P, true);
      this._refreshLabels(true);
      this._refreshModal(true);
      G.dirty('farm');
      return this.getPlot(id);
    },
    growAll(pct = 100) { for (const id of this._plots.keys()) { const s = this._state(id); if (s?.cropId) this.setPlot(id, { growth: Math.min(100, s.growth + pct) }); } },
    /** debug / test helper: simulate `sec` seconds for every plot (same rules as offline catch-up) */
    fastForward(sec = 60) {
      sec = clamp(Number(sec) || 0, 0, 24 * 3600);
      if (!sec || !G.state) return 0;
      const t = now();
      for (const id of this._plots.keys()) {
        const s = this._state(id);
        if (!s) continue;
        let left = sec;
        // step in chunks no longer than the offline cap so long jumps are simulated fully
        while (left > 0) { const chunk = Math.min(left, cfg().offlineCatchUpMax || 1800); s.lastUpdate = t - chunk * 1000; this._simulate(id, t); left -= chunk; }
        const P = this._plots.get(id);
        if (P) { P.vis.gT = s.growth; P.vis.wT = s.water; this._syncVisual(P, true); }
      }
      this._refreshLabels(true);
      this._refreshModal(true);
      G.dirty('farm');
      return sec;
    },

    // ------------------------------------------------------------ inventory helpers
    _hasItem(id, n = 1) { return G.sys.inventory?.has ? G.sys.inventory.has(id, n) : (Number(G.state?.inventory?.[id]) || 0) >= n; },
    _countItem(id) { return G.sys.inventory?.count ? G.sys.inventory.count(id) : Number(G.state?.inventory?.[id]) || 0; },
    _takeItem(id, n = 1) {
      if (G.sys.inventory?.remove) return G.sys.inventory.remove(id, n, { source: 'farm' });
      const inv = G.state?.inventory; if (!inv || (Number(inv[id]) || 0) < n) return false;
      inv[id] -= n; if (inv[id] <= 0) delete inv[id];
      G.bus.emit('item:removed', { itemId: id, qty: n, source: 'farm' });
      return true;
    },
    async _offerWateringCan(id) {
      if (this._offering) return;
      const it = items().ITEM_WATERING_CAN || { name: '물뿌리개', price: 300 };
      const price = it.price || 300;
      const coin = G.state?.stats?.coin || 0;
      let ok;
      this._offering = true;
      try {
        ok = kidOn() && G.easy?.confirm
          ? await G.easy.confirm({ emoji: it.icon || '🚿', heading: '물뿌리개', title: '물뿌리개가 없어요!', text: `🪙 ${fmt(price)}으로 살까요? (지금 🪙 ${fmt(coin)})`, say: '물뿌리개가 없어요. 코인으로 살까요?', yes: '살래요', no: '아니요' })
          : await G.ui.confirm(`물을 주려면 <b>${esc(it.name)}</b>${josa(it.name, '이/가').slice(it.name.length)} 필요해요.<br>${fmt(price)} 코인에 구입할까요? <span class="dim small">(보유 ${fmt(coin)} 코인)</span>`, { title: '물뿌리개가 없어요', okText: `${fmt(price)} 코인에 구입`, icon: 'watering-can', html: true });
      } finally { this._offering = false; }
      if (!ok || !G.state) return;
      if (this._hasItem('ITEM_WATERING_CAN')) { if (id) setTimeout(() => this.water(id), 150); return; } // bought meanwhile
      const inv = G.sys.inventory;
      // one purchase path: the 매점 (SHOP_GENERAL sells the can) — same price, coin check, toasts and events
      if (inv?.buy) {
        if (!inv.buy('ITEM_WATERING_CAN', 1, 'SHOP_GENERAL')) {
          if ((G.state?.stats?.coin || 0) < price) G.ui.toast('수확물이나 발효식품을 매점에 팔면 코인을 모을 수 있어요.', { type: 'info', emoji: '💡' });
          inv.openShop?.('SHOP_GENERAL');
          return;
        }
      } else {
        const prog = G.sys.progression;
        if (!prog?.spendCoin || !prog.spendCoin(price)) { G.ui.toast('코인이 부족해요. 수확물이나 발효식품을 팔아 코인을 모아 보세요.', { type: 'warn' }); return; }
        G.state.inventory.ITEM_WATERING_CAN = 1;
        G.bus.emit('item:added', { itemId: 'ITEM_WATERING_CAN', qty: 1, source: 'shop' });
        G.sfx('coin');
        G.dirty('inventory');
      }
      if (id) setTimeout(() => this.water(id), 250);
    },

    // ------------------------------------------------------------ build per plot
    _buildPlot(def) {
      const scene = G.sys.engine.scene;
      let group = G.world.getObject(def.id);
      let own = false;
      if (!group) { group = this._fallbackGroup(def); own = true; }
      const P = {
        id: def.id, def, group, ownGroup: own,
        root: new THREE.Group(),
        meshes: { mound: null, sprout: null, body: null, fruit: null },
        model: null, modelDef: null, modelId: null, plants: [],
        label: null, labelEls: null, labelPos: new THREE.Vector3(def.x, 1.5, def.z),
        vis: { g: 0, gT: 0, w: 50, wT: 50, h: 100, trans: 1, harvestT: -1, key: '' },
        cx: def.x, cz: def.z, soilY: 0.3, spark: 0, ready: false, busyUntil: 0,
      };
      P.root.name = 'crops:' + def.id;
      this._plots.set(def.id, P);
      if (own) scene.add(group);
      this._buildLabel(P);
      this._adoptGroup(P, group, own);
    },
    _fallbackGroup(def) {
      const g = new THREE.Group();
      g.name = def.id;
      const gy = G.world.terrainHeight(def.x, def.z) || 0;
      g.position.set(def.x, gy, def.z);
      g.rotation.y = def.rot || 0;
      const m = new THREE.MeshStandardMaterial({ color: 0x6a4a30, roughness: 1 });
      const soil = new THREE.Mesh(new THREE.BoxGeometry(def.w - 0.3, 0.3, def.d - 0.3), m);
      soil.position.y = 0.15; soil.receiveShadow = true;
      g.add(soil);
      g.userData.soilMaterial = m;
      g.userData.soilColor = '#6a4a30';
      g.userData.soilTopY = gy + 0.3;
      g.userData.size = { w: def.w - 0.3, d: def.d - 0.3 };
      return g;
    },
    /** attach the crop root to the plot bed group (props' bed, or our fallback when props is missing) */
    _adoptGroup(P, group, own = false) {
      if (P.root.parent) P.root.parent.remove(P.root);
      if (P.ownGroup && P.group && P.group !== group) P.group.parent?.remove(P.group);
      P.group = group;
      P.ownGroup = own;
      group.updateMatrixWorld(true);
      const ud = group.userData || {};
      const topLocal = (Number.isFinite(ud.soilTopY) ? ud.soilTopY : group.position.y + 0.3) - group.position.y;
      P.root.position.set(0, topLocal, 0);
      group.add(P.root);
      P.root.updateMatrixWorld(true);
      P.soilY = group.position.y + topLocal;
      P.size = ud.size || { w: P.def.w - 0.3, d: P.def.d - 0.3 };
      const rows = ud.rows && Array.isArray(ud.rows.z) ? ud.rows.z.slice() : null;
      if (rows && rows.length) P.rowZ = rows;
      else {
        const n = Math.max(3, Math.round(P.size.d / 0.75)), sp = P.size.d / n;
        P.rowZ = Array.from({ length: n }, (_, k) => P.size.d / 2 - (k + 0.5) * sp);
      }
      P.soilMat = ud.soilMaterial || null;
      P.soilBase = P.soilMat ? P.soilMat.color.clone() : null;
      P.soilRough = P.soilMat ? P.soilMat.roughness : 1;
      if (P.label) P.labelPos.set(P.cx, P.soilY + 1.2, P.cz);
      this._registerInteract(P);
    },

    _registerInteract(P) {
      if (!G.interact?.register) return;
      const self = this;
      const id = P.def.id;
      const herb = isHerbPlot(P.def);
      G.interact.register({
        id, kind: 'plot',
        label: () => self._primaryLabel(id),
        kidLabel: () => self._kidAction(id).label,
        emoji: () => self._kidAction(id).emoji,
        handOffset: 1.55, // above the plot tag
        position: new THREE.Vector3(P.cx, P.soilY, P.cz),
        object: P.group,
        radius: Math.max(P.def.w, P.def.d) / 2 + (herb ? 1.6 : 1.9),
        priority: 0,
        enabled: () => !!G.state && self._ready,
        onInteract: () => self.primary(id),
      });
    },

    _frontPoint(P) {
      const pl = G.sys.player;
      const out = { x: P.cx, z: P.cz };
      if (!pl?.position) return out;
      // nearest point inside the bed to the player, pulled 0.6 m into the bed
      const hw = (P.size?.w || P.def.w) / 2 - 0.5, hd = (P.size?.d || P.def.d) / 2 - 0.5;
      out.x = clamp(pl.position.x, P.cx - hw, P.cx + hw);
      out.z = clamp(pl.position.z, P.cz - hd, P.cz + hd);
      return out;
    },

    // ------------------------------------------------------------ crop meshes
    _rebuildMeshes(P, modelId) {
      for (const k of Object.keys(P.meshes)) {
        const m = P.meshes[k];
        if (m) { P.root.remove(m); m.dispose?.(); P.meshes[k] = null; }
      }
      P.plants = [];
      P.model = null; P.modelDef = null; P.modelId = modelId || null;
      if (!modelId) return;
      const def = MODELS[modelId];
      const geo = modelGeo(modelId);
      if (!def || !geo) return;
      P.modelDef = def;
      P.model = def;
      // layout: rows on the ridges, plants spaced along local X
      const rows = P.rowZ, nR = rows.length;
      const step = def.rowStep || 2;
      const k = Math.max(1, Math.floor((nR - 3) / step) + 1);
      const c = (nR - 1) / 2;
      const rowIdx = [];
      for (let j = 0; j < k; j++) rowIdx.push(clamp(Math.round(c - ((k - 1) * step) / 2 + j * step), 0, nR - 1));
      const xs = (def.xs || 1.1) * (this._lowQ ? 1.3 : 1);
      const usable = Math.max(0.5, (P.size?.w || P.def.w) - 1.0);
      const nX = Math.max(2, Math.floor(usable / xs) + 1);
      const r = U.rng('plot:' + P.id + ':' + modelId);
      P.root.updateMatrixWorld(true);
      for (const ri of rowIdx) {
        for (let j = 0; j < nX; j++) {
          const lx = (-(nX - 1) / 2 + j) * xs + (r() - 0.5) * 0.18 + (ri % 2 ? xs * 0.12 : -xs * 0.12);
          const lz = rows[ri] + (r() - 0.5) * 0.12;
          _pos.set(lx, 0, lz).applyMatrix4(P.root.matrixWorld);
          P.plants.push({ x: lx, z: lz, ry: r() * TAU, s: 0.88 + r() * 0.24, tilt: (r() - 0.5) * 0.12, droopDir: r() < 0.5 ? -1 : 1, wx: _pos.x, wz: _pos.z });
        }
      }
      const n = P.plants.length;
      const mk = (g, mat, cast, name) => {
        const im = new THREE.InstancedMesh(g, mat, n);
        im.name = name;
        im.castShadow = cast && this._shadows;
        im.receiveShadow = true;
        im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        for (let i = 0; i < n; i++) im.setColorAt(i, _tmpC.setRGB(1, 1, 1));
        const hw = (P.size?.w || P.def.w) / 2, hd = (P.size?.d || P.def.d) / 2;
        im.geometry.computeBoundingSphere();
        im.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, (def.height || 1) * 0.5, 0), Math.hypot(hw, hd) + (def.height || 1) * 1.2);
        im.frustumCulled = true;
        im.raycast = NO_RAY; // the soil bed stays clickable; per-instance plant raycasts are not worth their cost
        P.root.add(im);
        return im;
      };
      P.meshes.mound = mk(getMound(), moundMat(), false, 'mounds');
      P.meshes.sprout = mk(getSprout(), foliageMat(), false, 'sprouts');
      P.meshes.body = mk(geo.body, foliageMat(), true, 'crop-body');
      if (geo.fruit) P.meshes.fruit = mk(geo.fruit, def.fruitMat === 'foliage' ? foliageMat() : fruitMat(), true, 'crop-fruit');
    },

    /** recompute instance matrices/colours for the displayed growth (P.vis.g) */
    _layoutInstances(P) {
      const n = P.plants.length;
      if (!n || !P.meshes.mound) return;
      const s = this._state(P.id);
      const v = P.vis;
      const C = cfg();
      const def = P.modelDef || {};
      const g = v.g;
      const harvesting = v.harvestT >= 0;
      // harvest: plants swell/wiggle while the player kneels, then vanish at the "pull" (~0.85 s)
      let hk = 1;
      if (harvesting) { const t = v.harvestT; hk = t < 0.85 ? 1 + Math.sin((t / 0.85) * PI * 3) * 0.04 : Math.max(0, 1 - (t - 0.85) / 0.3); }
      const water = s ? s.water : 50, health = s ? s.health : 100;
      const droop = water < C.dryThreshold ? (1 - water / C.dryThreshold) : 0;
      const wilt = health < 60 ? (60 - health) / 60 : 0;
      const pop = v.trans < 1 ? (v.trans < 0.7 ? v.trans / 0.7 * 1.08 : 1.08 - (v.trans - 0.7) / 0.3 * 0.08) : 1;
      const msc = def.scale || 1;
      // per-stage factors
      const sproutOn = g >= 20 && g < 50;
      const bodyOn = g >= 50;
      const fruitOn = g >= 80 && !!P.meshes.fruit;
      const sproutS = sproutOn ? lerp(0.9, 2.1, (g - 20) / 30) : 0;
      const bodyS = !bodyOn ? 0 : g < 80 ? lerp(0.4, 0.8, (g - 50) / 30) : lerp(0.8, 1.0, Math.min(1, (g - 80) / 20));
      const fruitS = !fruitOn ? 0 : g >= 100 ? 1 : lerp(0.35, 0.82, (g - 80) / 20);
      const ripe = g >= 100 ? 1 : fruitOn ? Math.pow((g - 80) / 20, 2) * 0.55 : 0;
      // colours
      const bodyTint = _tmpC.setRGB(1, 1, 1).lerp(DRY_TINT, clamp(wilt * 0.9 + droop * 0.18, 0, 0.9));
      let fruitTint = _tmpC2;
      if (def.fruitTint === 'white') fruitTint.set(def.unripe || '#dddddd').lerp(_ca.set(def.ripe || '#ffffff'), ripe);
      else fruitTint.set(def.unripe || '#88bb66').lerp(_ca.set(cropOf(s?.cropId || v.harvestCrop)?.fruit || '#ffffff'), ripe);
      const M = P.meshes;
      M.mound.visible = true;
      M.sprout.visible = sproutOn;
      M.body.visible = bodyOn;
      if (M.fruit) M.fruit.visible = fruitOn;
      const dryK = 1 - droop * 0.22 - wilt * 0.12;
      const soilTint = this._soilColorFor(P, _cc);
      for (let i = 0; i < n; i++) {
        const pl = P.plants[i];
        const k = pl.s * pop * hk;
        // soil mound around the stem
        _eul.set(0, pl.ry, 0);
        _quat.setFromEuler(_eul);
        _pos.set(pl.x, 0, pl.z);
        const ms = (g < 20 ? 1 : 1.15) * pop * (harvesting ? Math.max(0.6, hk) : 1);
        _scl.set(ms * pl.s, ms, ms * pl.s);
        _mat.compose(_pos, _quat, _scl);
        M.mound.setMatrixAt(i, _mat);
        M.mound.setColorAt(i, soilTint);
        if (sproutOn) {
          _scl.setScalar(sproutS * k);
          _scl.y *= dryK;
          _mat.compose(_pos, _quat, _scl);
          M.sprout.setMatrixAt(i, _mat);
        }
        if (bodyOn) {
          _eul.set(pl.tilt + droop * 0.28 * pl.droopDir, pl.ry, pl.tilt * 0.5 + wilt * 0.15 * pl.droopDir);
          _quat.setFromEuler(_eul);
          const bs = bodyS * k * msc;
          _scl.set(bs, bs * dryK, bs);
          _mat.compose(_pos, _quat, _scl);
          M.body.setMatrixAt(i, _mat);
          M.body.setColorAt(i, bodyTint);
          if (fruitOn) {
            // fruits are authored attached to the full-size plant, so they share the body transform;
            // a slightly smaller scale makes young fruits read smaller without detaching from the stems
            _scl.multiplyScalar(lerp(0.9, 1, fruitS));
            _mat.compose(_pos, _quat, _scl);
            M.fruit.setMatrixAt(i, _mat);
            M.fruit.setColorAt(i, fruitTint);
          }
        }
      }
      for (const k of ['mound', 'sprout', 'body', 'fruit']) {
        const m = M[k];
        if (!m) continue;
        m.instanceMatrix.needsUpdate = true;
        if (m.instanceColor) m.instanceColor.needsUpdate = true;
      }
      // label height follows the crop
      const top = bodyOn ? (def.height || 0.6) * bodyS * msc : sproutOn ? 0.15 : 0.08;
      P.labelPos.set(P.cx, P.soilY + Math.max(0.9, top + 0.55), P.cz);
    },

    _soilColorFor(P, out) {
      // mound tint mirrors the soil wetness (mounds use their own vertex-coloured material)
      const w = clamp(P.vis.w / 100, 0, 1);
      const e = w * w * (3 - 2 * w);
      return out.copy(SOIL_DRY).lerp(SOIL_WET, e);
    },
    _applySoil(P) {
      P.vis.wApplied = P.vis.w;
      const w = clamp(P.vis.w / 100, 0, 1);
      const e = w * w * (3 - 2 * w);
      if (P.soilMat) {
        P.soilMat.color.copy(SOIL_DRY).lerp(SOIL_WET, e);
        if (P.soilBase) P.soilMat.color.multiply(P.soilBase);
        P.soilMat.roughness = lerp(P.soilRough ?? 1, 0.55, e);
      }
      const mound = P.meshes.mound;
      if (mound && P.plants.length) {
        const c = this._soilColorFor(P, _cc);
        for (let i = 0; i < P.plants.length; i++) mound.setColorAt(i, c);
        if (mound.instanceColor) mound.instanceColor.needsUpdate = true;
      }
    },

    /** sync meshes with the state; full=true snaps easing values */
    _applyQuality(preset) {
      const lowQ = preset.name === 'low', shadows = !!preset.shadows;
      const relayout = lowQ !== this._lowQ;
      this._lowQ = lowQ;
      this._shadows = shadows;
      for (const P of this._plots.values()) {
        if (relayout) { P.modelId = '__rebuild'; if (G.state && this._ready) this._syncVisual(P, true); }  // new spacing
        else for (const k of ['body', 'fruit']) if (P.meshes?.[k]) P.meshes[k].castShadow = shadows;
      }
    },
    _syncVisual(P, full) {
      const s = this._state(P.id);
      if (!s) return;
      const crop = cropOf(s.cropId);
      const modelId = crop ? crop.model : null;
      if (P.vis.harvestT >= 0 && !full) return; // let the shrink animation finish first
      if (modelId !== P.modelId) {
        this._rebuildMeshes(P, modelId);
        P.vis.g = s.growth;
        P.vis.key = '';
      }
      P.vis.gT = s.growth;
      P.vis.wT = s.water;
      if (full) { P.vis.g = s.growth; P.vis.w = s.water; }
      P.ready = !!crop && s.growth >= 100;
      const key = `${modelId}|${Math.round(s.growth * 4)}|${Math.round(s.water / 4)}|${Math.round(s.health / 4)}`;
      if (full || key !== P.vis.key) { P.vis.key = key; this._layoutInstances(P); }
      if (full) this._applySoil(P);
      if (!crop) P.labelPos.set(P.cx, P.soilY + 0.9, P.cz);
    },

    // ------------------------------------------------------------ particles over time
    _emit(delay, dur, fn, rate) {
      this._emitters.push({ delay, dur, fn, rate: rate || 0.05, acc: 0, t: 0 });
    },
    _updateEmitters(dt) {
      const list = this._emitters;
      for (let i = list.length - 1; i >= 0; i--) {
        const e = list[i];
        e.t += dt;
        if (e.t < e.delay) continue;
        if (!e.fired) { e.fired = true; e.acc = e.rate; }
        e.acc += dt;
        while (e.acc >= e.rate) { e.acc -= e.rate; try { e.fn(e); } catch (err) { G.log.warn('FARM', 'emitter', err); } }
        if (e.t >= e.delay + e.dur) list.splice(i, 1);
      }
    },
    _doWaterFx(P) {
      const pl = G.sys.player;
      pl?.faceTowards?.(P.cx, P.cz);
      pl?.playAction?.('water');
      const self = this;
      const floorY = P.soilY;
      this._emit(0.45, 1.45, () => {
        const pp = pl?.position;
        if (!pp) return;
        const ry = pl.rotY || 0;
        const fx = Math.sin(ry), fz = Math.cos(ry);
        // spout: right hand (rig) or an estimate in front of the player
        const hand = pl.rig?.handR;
        if (hand) { hand.getWorldPosition(_hand); _hand.x += fx * 0.32; _hand.z += fz * 0.32; _hand.y += 0.02; }
        else _hand.set(pp.x + fx * 0.6, pp.y + 0.75, pp.z + fz * 0.6);
        for (let k = 0; k < 4; k++) {
          const sp = 1.1 + Math.random() * 0.7, side = (Math.random() - 0.5) * 0.8;
          FX.spawn(FX.P.DROP, _hand.x + (Math.random() - 0.5) * 0.05, _hand.y, _hand.z + (Math.random() - 0.5) * 0.05,
            fx * sp + fz * side, 0.3 + Math.random() * 0.5, fz * sp - fx * side, null, floorY);
        }
        void self;
      }, 0.03);
    },

    // ------------------------------------------------------------ labels
    _buildLabel(P) {
      if (!G.ui?.label) return;
      const def = P.def;
      const el = document.createElement('div');
      el.className = 'plot-label farm-label';
      el.innerHTML = `<div class="fl-head"><span class="num">${esc(def.label)}</span><span class="ttl"></span><span class="fl-stage"></span></div>`
        + '<div class="fl-stats"><span class="fl-g">성장률 <b>0%</b></span><i></i><span class="fl-w">수분 <b>0%</b></span><i></i><span class="fl-h">건강 <b>0%</b></span></div>'
        + '<div class="fl-empty">씨앗을 심어 주세요</div>'
        // 쉬운 모드 picture row (CSS shows it instead of the numbers): stage · 💧 0–5 · face / "다 자랐어요!"
        + '<div class="fl-kid" aria-hidden="true"><span class="flk-stage emoji"></span><span class="flk-drops"><i></i><i></i><i></i><i></i><i></i></span><span class="flk-face emoji"></span><span class="flk-ready">✨ 다 자랐어요!</span></div>'
        + '<div class="fl-kid-empty" aria-hidden="true"><span class="emoji">🌱</span><span class="flk-empty-t">씨앗 심어요</span></div>';
      if (isHerbPlot(def)) el.classList.add('herb');
      P.labelEls = {
        el, ttl: el.querySelector('.ttl'), stage: el.querySelector('.fl-stage'),
        g: el.querySelector('.fl-g b'), w: el.querySelector('.fl-w b'), h: el.querySelector('.fl-h b'), empty: el.querySelector('.fl-empty'), last: {},
        kStage: el.querySelector('.flk-stage'), kDrops: Array.from(el.querySelectorAll('.flk-drops i')), kFace: el.querySelector('.flk-face'), kEmpty: el.querySelector('.flk-empty-t'),
      };
      P.labelPos.set(P.cx, P.soilY + 1.2, P.cz);
      P.label = G.ui.label({ el, target: P.labelPos, maxDist: 42, fadeDist: 8, onClick: (ev) => { ev.stopPropagation(); this.openPlot(def.id); } });
      P.label.setVisible(false);
    },
    _refreshLabels() {
      for (const P of this._plots.values()) {
        const E = P.labelEls;
        if (!E || !P.label) continue;
        const s = this._state(P.id);
        if (!s || !G.state) { P.label.setVisible(false); continue; }
        if (!P.label.visible) P.label.setVisible(true);
        const crop = cropOf(s.cropId);
        const C = cfg();
        const st = stageOf(s.growth);
        const L = E.last;
        const set = (k, el, v) => { if (L[k] !== v) { L[k] = v; el.textContent = v; } };
        set('ttl', E.ttl, plotTitle(P.def, crop));
        const cls = !crop ? 'is-empty' : s.growth >= 100 ? 'is-ready' : s.water < C.dryThreshold ? 'is-dry' : s.health < 50 ? 'is-sick' : 'is-growing';
        if (L.cls !== cls) { E.el.classList.remove('is-empty', 'is-ready', 'is-dry', 'is-sick', 'is-growing'); E.el.classList.add(cls); L.cls = cls; }
        const stageTxt = !crop ? '' : s.growth >= 100 ? '✨ 수확 가능' : s.water < C.dryThreshold ? '💧 물이 필요해요' : st.name;
        set('stage', E.stage, stageTxt);
        if (crop) {
          set('g', E.g, `${Math.floor(s.growth)}%`);
          set('w', E.w, `${Math.round(s.water)}%`);
          set('h', E.h, `${Math.round(s.health)}%`);
        } else set('empty', E.empty, isHerbPlot(P.def) ? '허브 모종을 심어 주세요' : '씨앗을 심어 주세요');
        if (kidOn() && E.kStage) {
          if (crop) {
            set('kStage', E.kStage, kidStagePic(crop, s.growth));
            set('kFace', E.kFace, s.water < C.dryThreshold ? '🥵' : kidFace(s.health));
            const n = kidDrops(s.water);
            if (L.kDrops !== n) { L.kDrops = n; for (let i = 0; i < E.kDrops.length; i++) E.kDrops[i].classList.toggle('on', i < n); }
          } else set('kEmpty', E.kEmpty, isHerbPlot(P.def) ? '모종 심어요' : '씨앗 심어요');
        }
      }
    },

    // ------------------------------------------------------------ plot modal
    openPlot(id) {
      const P = this._plots.get(id);
      if (!P || !G.state) return null;
      const s = this._simulate(id);
      const self = this;
      const kid = kidOn();
      const crop = cropOf(s?.cropId);
      const m = G.ui.modal.open({
        id: 'farm-plot', size: kid ? 'sm' : 'md', className: kid ? 'farm-modal farm-kid' : 'farm-modal', title: '', icon: null,
        // 쉬운 모드: the card reads its name and one sentence aloud when it opens
        say: kid ? `${plotTitle(P.def, crop)}. ${crop ? kidSentence(s, crop) : (isHerbPlot(P.def) ? '모종을 심어 볼까요?' : '씨앗을 심어 볼까요?')}` : undefined,
        body: (body) => { body.classList.add(kid ? 'fk-body' : 'fm-body'); },
        onClose: () => { if (self._modal?.m === m) self._modal = null; },
      });
      this._modal = { m, id, key: '', els: null, kid };
      this._refreshModal(true);
      return m;
    },
    _near(P) {
      const pl = G.sys.player;
      if (!pl?.position) return true;
      const hw = (P.def.w || 6) / 2 + 2.4, hd = (P.def.d || 6) / 2 + 2.4;
      return Math.abs(pl.position.x - P.cx) <= hw && Math.abs(pl.position.z - P.cz) <= hd;
    },
    _refreshModal(force) {
      const md = this._modal;
      if (!md) return;
      if (md.m.closed) { this._modal = null; return; }
      const P = this._plots.get(md.id);
      const s = this._state(md.id);
      if (!P || !s) return;
      const crop = cropOf(s.cropId);
      const near = this._near(P);
      const ready = !!crop && s.growth >= 100;
      if (md.kid) {
        const key = `k|${s.cropId}|${ready}|${near}`;
        if (force || key !== md.key) { md.key = key; this._renderKid(md, P, s, crop, near); }
        this._updateKid(md, P, s, crop);
        return;
      }
      const seedSig = !crop ? this._seedList(P).map((x) => x.id + x.count).join(',') : '';
      const key = `${s.cropId}|${ready}|${near}|${seedSig}`;
      if (force || key !== md.key) { md.key = key; this._renderModal(md, P, s, crop, near); }
      this._updateModalValues(md, P, s, crop);
    },

    // ------------------------------------------------------------ 쉬운 모드: picture card + seed picker
    _renderKid(md, P, s, crop, near) {
      const m = md.m, def = P.def, h = G.ui.h;
      const herb = isHerbPlot(def);
      m.setTitle(`${CIRCLED[def.label] || def.label} ${plotTitle(def, crop)}`, crop ? cropPic(crop) : '🌱');
      const body = m.body;
      body.innerHTML = '';
      const els = { crop };
      els.ring = h('div', { class: `fk-ring${crop ? '' : ' empty'}` }, els.pic = h('span', { class: 'fk-pic emoji', 'aria-hidden': 'true' }, crop ? kidStagePic(crop, s.growth) : '🟫'));
      // the sentence lives in its own span: the 🔊 button easy.speakable appends must survive text updates
      els.sayT = h('span', { class: 'fk-say-t' });
      els.say = h('p', { class: 'fk-say' }, els.sayT);
      const btns = h('div', { class: 'fk-btns' });
      const big = (cls, emoji, label, fn) => {
        const b = h('button', { type: 'button', class: `easy-big-btn ${cls}` }, h('span', { class: 'emoji', 'aria-hidden': 'true' }, emoji), h('span', { class: 'fk-btn-lbl' }, label));
        b.addEventListener('click', fn);
        btns.appendChild(b);
        return b;
      };
      if (!crop) {
        els.sayT.textContent = herb ? '빈 허브 밭이에요. 모종을 심어 볼까요?' : '빈 밭이에요. 씨앗을 심어 볼까요?';
        body.append(h('div', { class: 'fk-hero' }, els.ring), els.say);
        if (near) big('easy-btn-yes', '🌱', herb ? '모종 심기' : '씨앗 심기', () => { m.close(); this._kidPlant(P.id); });
        else big('easy-btn-yes', '👉', '밭으로 가기', () => this._goTo(P, false));
      } else {
        // stage track 🌱 → 🌿 → 🌾 → crop
        els.steps = [0, 1, 2, 3].map((i) => h('span', { class: 'fk-step emoji', 'aria-hidden': 'true' }, i === 3 ? cropPic(crop) : KID_STAGE[i]));
        const track = h('div', { class: 'fk-track', role: 'img', 'aria-label': '자라는 단계' });
        els.steps.forEach((st, i) => { if (i) track.appendChild(h('span', { class: 'fk-arrow', 'aria-hidden': 'true' }, '›')); track.appendChild(st); });
        els.drops = [0, 1, 2, 3, 4].map(() => h('i'));
        els.face = h('span', { class: 'fk-face emoji', 'aria-hidden': 'true' }, '😊');
        const meter = h('div', { class: 'fk-meter' },
          h('div', { class: 'fk-m water' }, h('span', { class: 'fk-m-ico emoji', 'aria-hidden': 'true' }, '💧'), h('span', { class: 'fk-drops' }, els.drops)),
          h('div', { class: 'fk-m feel' }, els.face));
        body.append(h('div', { class: 'fk-hero' }, els.ring), track, meter, els.say);
        if (near) {
          if (s.growth >= 100) big('easy-btn-yes fk-harvest', cropPic(crop), '거두기', () => { if (this.harvest(P.id)) m.close(); });
          else els.water = big('easy-btn-yes fk-water', '💧', '물 주기', () => { if (this.water(P.id)) m.close(); });
        } else big('easy-btn-yes', '👉', '밭으로 가기', () => this._goTo(P, s.growth >= 100));
      }
      body.appendChild(btns);
      try { G.easy?.speakable?.(els.say, () => els.sayT.textContent); } catch (e) { /* optional */ }
      m.setActions([]);
      md.els = els;
    },
    _updateKid(md, P, s, crop) {
      const els = md.els;
      if (!els) return;
      const txt = (el, v) => { if (el && el.textContent !== v) el.textContent = v; };
      if (!crop) return;
      const g = Math.floor(s.growth);
      const p = String(g);
      if (els.ring.style.getPropertyValue('--p') !== p) els.ring.style.setProperty('--p', p);
      txt(els.pic, kidStagePic(crop, s.growth));
      const si = kidStageIdx(s.growth);
      if (els.si !== si) { els.si = si; els.steps.forEach((st, i) => { st.classList.toggle('done', i < si); st.classList.toggle('cur', i === si); }); }
      const n = kidDrops(s.water);
      if (els.n !== n) { els.n = n; els.drops.forEach((d, i) => d.classList.toggle('on', i < n)); }
      txt(els.face, s.water < cfg().dryThreshold ? '🥵' : kidFace(s.health));
      txt(els.sayT, kidSentence(s, crop));
      if (els.water) {
        const cool = waterCoolLeft(s) > 0;
        const full = s.water >= 100;
        const dis = cool || full;
        if (els.water.disabled !== dis) els.water.disabled = dis;
        txt(els.water.querySelector('.fk-btn-lbl'), cool ? '스며드는 중' : full ? '촉촉해요' : '물 주기');
      }
    },
    /** 쉬운 모드: "무엇을 심을까?" picture picker (only seeds that fit this bed; 🛒 가게 when you have none) */
    async _kidPlant(id) {
      const P = this._plots.get(id);
      if (!P || !G.state || this._picking || !G.easy?.pick) { if (!G.easy?.pick) this.openPlot(id); return; }
      const st0 = G.state;
      const herb = isHerbPlot(P.def);
      const list = this._seedList(P).filter((x) => x.ok);
      const items0 = list.map((x) => ({
        id: x.id, emoji: cropPic(x.crop), label: x.crop.name, badge: x.count > 0 ? `×${Math.min(x.count, 99)}` : null,
        disabled: x.count <= 0, disabledSay: `${x.crop.name} ${herb ? '모종' : '씨앗'}이 없어요. 가게에서 살 수 있어요.`,
        say: `${x.crop.name}. ${x.count}개 있어요.`,
      }));
      items0.sort((a, b) => (a.disabled - b.disabled));
      const has = items0.some((x) => !x.disabled);
      if (G.sys.inventory?.openShop) items0.push({ id: '__shop', emoji: '🛒', label: '가게', say: '가게에서 씨앗을 사요.' });
      this._picking = true;
      let pick = null;
      try {
        pick = await G.easy.pick({
          id: 'farm-seed', title: herb ? '어떤 모종을 심을까?' : '무엇을 심을까?', emoji: '🌱', items: items0, columns: items0.length > 6 ? 4 : 3,
          say: has ? '무엇을 심을까요? 그림을 골라요.' : '씨앗이 없어요. 가게에서 사 올까요?',
          text: has ? '' : '씨앗이 없어요. 🛒 가게에서 살 수 있어요!',
        });
      } finally { this._picking = false; }
      if (!pick || !G.state || G.state !== st0) return;
      if (pick === '__shop') { G.sys.inventory?.openShop?.('SHOP_GENERAL'); return; }
      const s = this._simulate(id);
      if (!s || s.cropId) return; // planted meanwhile
      this.plant(id, pick);
    },
    _seedList(P) {
      const cat = plotCategory(P.def);
      const out = [];
      for (const [cid, crop] of Object.entries(crops())) {
        const seed = items()[crop.seedItem];
        if (!seed) continue;
        const count = this._countItem(crop.seedItem);
        out.push({ id: cid, crop, seed, count, ok: crop.category === cat });
      }
      out.sort((a, b) => (b.ok - a.ok) || ((b.count > 0) - (a.count > 0)) || a.crop.growthTime - b.crop.growthTime);
      return out;
    },
    _renderModal(md, P, s, crop, near) {
      const m = md.m, def = P.def, C = cfg();
      const herb = isHerbPlot(def);
      m.setTitle(`${CIRCLED[def.label] || def.label} ${plotTitle(def, crop)}`, crop ? (items()[crop.harvestItem]?.icon || '🌱') : '🌱');
      const body = m.body;
      body.innerHTML = '';
      const h = G.ui.h;
      if (!crop) {
        const list = this._seedList(P);
        const owned = list.filter((x) => x.ok && x.count > 0);
        const wrap = h('div', { class: 'fm-empty' },
          h('div', { class: 'fm-hero' },
            h('div', { class: 'fm-ring empty' }, h('span', { class: 'emoji' }, '🌱')),
            h('div', { class: 'fm-hero-text' },
              h('div', { class: 'row wrap' }, h('b', { class: 'fm-name' }, herb ? '빈 허브밭' : '빈 밭'), h('span', { class: 'chip' }, herb ? '허브 전용' : '작물 전용')),
              h('p', { class: 'dim small' }, herb ? '허브 구역의 밭이에요. 박하·라벤더·로즈마리·레몬밤 같은 허브 모종을 심을 수 있어요.' : '전통작물 구역의 밭이에요. 콩·고추·배추·들깨·옥수수·무 씨앗을 심을 수 있어요.'))),
          h('div', { class: 'fm-section-title' }, h('span', { class: 'ico ico-sm', 'data-icon': 'sprout' }), '씨앗 고르기', h('span', { class: 'muted small' }, ` · 가방에 있는 ${herb ? '모종' : '씨앗'} ${owned.length}종`)));
        const grid = h('div', { class: 'fm-seeds' });
        for (const x of list) {
          const dis = !x.ok || x.count <= 0 || !near;
          const b = h('button', { class: `fm-seed ${x.ok ? '' : 'wrong'} ${x.count > 0 ? '' : 'none'}`, type: 'button', disabled: dis || null, title: x.crop.desc || '' },
            h('span', { class: 'emoji fm-seed-ico' }, x.seed.icon || '🌱'),
            h('b', null, x.crop.name),
            h('span', { class: 'fm-seed-meta' }, x.ok ? `${U.formatDuration(x.crop.growthTime)} · 물 ${waterNeedLabel(x.crop.waterUse)}` : (herb ? '작물밭 전용' : '허브밭 전용')),
            h('span', { class: 'fm-seed-qty' }, `×${x.count}`));
          if (!dis) b.addEventListener('click', () => { if (this.plant(P.id, x.id)) m.close(); });
          grid.appendChild(b);
        }
        wrap.appendChild(grid);
        if (!owned.length) {
          wrap.appendChild(h('div', { class: 'empty fm-noseed' },
            h('div', null, `심을 수 있는 ${herb ? '허브 모종' : '씨앗'}이 없어요.`),
            h('div', { class: 'small' }, '정문 옆 매점에서 씨앗과 모종을 살 수 있어요.'),
            G.sys.inventory?.openShop ? h('button', { class: 'btn btn-sm btn-soft mt-1', type: 'button', onclick: () => { m.close(); G.sys.inventory.openShop('SHOP_GENERAL'); } }, h('span', { class: 'ico ico-sm', 'data-icon': 'store' }), '매점 열기') : null));
        }
        if (!near) wrap.appendChild(h('div', { class: 'notice-box info mt-1' }, '밭 가까이 가야 씨앗을 심을 수 있어요.'));
        wrap.appendChild(h('div', { class: 'notice-box info mt-1 fm-tip' }, herb ? '💡 허브는 여러해살이라 한 번 심으면 수확한 뒤에도 다시 자라요.' : '💡 씨앗을 심은 뒤 물을 주면 더 빨리 자라요. 수분이 25% 아래로 떨어지면 성장이 느려져요.'));
        body.appendChild(wrap);
        G.ui.hydrateIcons(body);
        const acts = [{ label: '닫기', class: 'btn-ghost' }];
        if (!near) acts.push({ label: '밭으로 가기', class: 'btn-primary', icon: 'pin', onClick: () => { this._goTo(P); } });
        m.setActions(acts);
        md.els = null;
        return;
      }
      // ---- planted
      const ready = s.growth >= 100;
      const st = stageOf(s.growth);
      const stages = STAGES();
      const timeline = h('div', { class: 'fm-timeline' }, stages.map((x, i) => h('div', { class: 'fm-step', dataset: { i: String(i) } }, h('i'), h('span', null, x.name))));
      const bar = (cls, label, icon) => h('div', { class: `fm-stat ${cls}` },
        h('div', { class: 'fm-stat-head' }, h('span', { class: 'emoji' }, icon), h('span', null, label), h('b', { class: 'fm-val' }, '0%')),
        h('div', { class: `bar bar-lg ${cls === 'water' ? 'bar-water' : cls === 'health' ? 'bar-purple' : ''}` }, h('i')));
      const els = {};
      const hero = h('div', { class: 'fm-hero' },
        els.ring = h('div', { class: 'fm-ring' }, h('span', { class: 'emoji' }, items()[crop.harvestItem]?.icon || '🌱')),
        h('div', { class: 'fm-hero-text' },
          h('div', { class: 'row wrap' }, h('b', { class: 'fm-name' }, crop.name), els.chip = h('span', { class: 'chip chip-green' }, st.name), h('span', { class: 'chip' }, crop.category === 'herb' ? '허브' : '전통작물')),
          h('p', { class: 'dim small' }, crop.desc || '')));
      const stats = h('div', { class: 'fm-stats' }, els.g = bar('growth', '성장률', '🌱'), els.w = bar('water', '수분', '💧'), els.h = bar('health', '건강', '💚'));
      const info = h('div', { class: 'fm-info' },
        h('div', { class: 'fm-info-item' }, h('span', { class: 'ico ico-sm', 'data-icon': 'clock' }), h('span', { class: 'muted' }, '수확까지'), els.eta = h('b', null, '-')),
        h('div', { class: 'fm-info-item' }, h('span', { class: 'emoji' }, '🧺'), h('span', { class: 'muted' }, '예상 수확량'), els.yield = h('b', null, '-')),
        h('div', { class: 'fm-info-item' }, h('span', { class: 'emoji' }, '🌾'), h('span', { class: 'muted' }, '이 밭 수확'), h('b', null, `${fmt(s.harvests || 0)}회`)));
      els.etaNote = h('div', { class: 'fm-eta-note small muted' });
      els.tip = h('div', { class: 'notice-box info fm-tip' });
      body.append(hero, timeline, stats, info, els.etaNote, els.tip);
      if (!near) body.appendChild(h('div', { class: 'notice-box mt-1' }, '밭 가까이 가야 물을 주거나 수확할 수 있어요.'));
      body.appendChild(h('p', { class: 'tiny muted mt-1 fm-disclaimer' }, G.data.meta?.disclaimer || ''));
      G.ui.hydrateIcons(body);
      els.timeline = timeline;
      md.els = els;
      // actions
      const acts = [{ label: '밭 비우기', class: 'btn-ghost fm-clear', icon: 'trash', onClick: () => { this.clear(P.id); return false; } }];
      // successful actions close the modal so the player sees the 3D feedback (animation, droplets, harvest burst)
      if (near) {
        acts.push({ label: '물 주기', class: ready ? 'btn-soft fm-water' : 'btn-primary fm-water', icon: 'droplet', onClick: () => this.water(P.id) });
        acts.push({ label: '수확하기', class: 'btn-gold', icon: 'basket', disabled: !ready, onClick: () => !!this.harvest(P.id) });
      } else {
        acts.push({ label: ready ? '가서 수확하기' : '가서 돌보기', class: ready ? 'btn-gold' : 'btn-primary', icon: 'pin', onClick: () => { this._goTo(P, true); } });
      }
      m.setActions(acts);
      md.waterBtn = m.foot.querySelector('.fm-water');
      void C;
    },
    _updateModalValues(md, P, s, crop) {
      const els = md.els;
      if (!els || !crop) return;
      const C = cfg();
      const st = stageOf(s.growth);
      const g = Math.floor(s.growth), w = Math.round(s.water), hl = Math.round(s.health);
      const setBar = (wrap, v, txt) => { const i = wrap.querySelector('.bar > i'); const b = wrap.querySelector('.fm-val'); const vs = `${v}%`; if (i.style.width !== vs) i.style.width = vs; if (b.textContent !== txt) b.textContent = txt; };
      setBar(els.g, g, `${g}%`);
      setBar(els.w, w, `${w}%`);
      setBar(els.h, hl, `${hl}%`);
      els.w.classList.toggle('low', s.water < C.dryThreshold);
      els.h.classList.toggle('low', s.health < 50);
      els.ring.style.setProperty('--p', String(g));
      const ready = s.growth >= 100;
      const chipTxt = ready ? '수확 가능' : st.name;
      if (els.chip.textContent !== chipTxt) { els.chip.textContent = chipTxt; els.chip.className = `chip ${ready ? 'chip-gold' : 'chip-green'}`; }
      const idx = STAGES().indexOf(st);
      els.timeline.querySelectorAll('.fm-step').forEach((el, i) => { el.classList.toggle('done', i < idx || ready); el.classList.toggle('cur', i === idx); });
      // ETA
      const eta = this._eta(s, crop);
      let etaTxt, note = '';
      if (ready) etaTxt = '지금 수확할 수 있어요!';
      else if (eta.now === Infinity) {
        etaTxt = `약 ${U.formatDuration(eta.full)}`;
        note = s.water <= 0 ? '⚠️ 흙이 바싹 말라 성장이 멈췄어요. 물을 주세요!' : `⚠️ 이대로면 성장률 약 ${Math.floor(eta.stallAt)}%에서 멈춰요. 물을 충분히 주면 위 시간 안에 다 자라요.`;
      } else {
        etaTxt = `약 ${U.formatDuration(eta.now)}`;
        if (eta.now - eta.full > 3) note = `물을 25% 이상 유지하면 약 ${U.formatDuration(eta.full)} 만에 다 자라요.`;
      }
      if (els.eta.textContent !== etaTxt) els.eta.textContent = etaTxt;
      if (els.etaNote.textContent !== note) els.etaNote.textContent = note;
      const [lo, hi] = crop.harvestAmount || [1, 3];
      const hk = 0.55 + 0.45 * s.health / 100;
      const bonus = this._hasItem('ITEM_BASKET') ? (C.basketBonus || 0) : 0;
      const yTxt = `${Math.max(1, Math.round(lo * hk)) + bonus}~${Math.max(1, Math.round(hi * hk)) + bonus}개${bonus ? ' (바구니 +' + bonus + ')' : ''}`;
      if (els.yield.textContent !== yTxt) els.yield.textContent = yTxt;
      // tip
      let tip;
      if (ready) tip = `🧺 다 자랐어요! 수확하면 ${josa(items()[crop.harvestItem]?.name || crop.name, '과/와')} 경험치 ${crop.exp || 0}, 코인 ${josa(String(crop.coin || 0), '을/를')} 받아요.${bonus ? '' : ' 바구니가 있으면 수확량이 1개 늘어나요.'}`;
      else if (s.water <= 0) tip = '🥀 흙이 완전히 말랐어요. 성장이 멈추고 건강이 조금씩 떨어지고 있어요.';
      else if (s.water < C.dryThreshold) tip = `💧 흙이 말라 가요. 수분이 ${C.dryThreshold}% 아래면 자라는 속도가 절반으로 느려져요.`;
      else if (s.health < 50) tip = '💚 작물이 약해졌어요. 물을 넉넉히 주면 건강이 천천히 회복돼요. 건강할수록 수확량이 많아요.';
      else if ((Number(G.sys.weather?.precipitation?.rain) || 0) > 0.15) tip = '🌧️ 비가 내려 밭이 저절로 촉촉해지고 있어요. 비가 그치면 수분을 다시 확인해 주세요.';
      else if (crop.category === 'herb') tip = '🌿 허브는 여러해살이라 줄기를 잘라 수확해도 다시 자라요. 물을 너무 많이 주지 않아도 잘 자라요.';
      else if (s.water >= 85) tip = `😊 흙이 촉촉해요! ${crop.name}${josa(crop.name, '이/가').slice(crop.name.length)} 쑥쑥 자라는 중이에요. 수분이 ${C.dryThreshold}% 아래로 내려가기 전에 다시 물을 주면 가장 빨리 자라요.`;
      else tip = `🌱 물을 ${waterNeedLabel(crop.waterUse) === '많이' ? '자주' : waterNeedLabel(crop.waterUse) === '조금' ? '가끔' : '적당히'} 주면 좋아요. 수분이 ${C.dryThreshold}% 아래면 자라는 속도가 절반으로 느려져요.`;
      if (els.tip.textContent !== tip) els.tip.textContent = tip;
      // water button cooldown text
      if (md.waterBtn) {
        const cd = waterCoolLeft(s);
        const full = s.water >= 100;
        md.waterBtn.disabled = cd > 0 || full;
        md.waterBtn.title = full ? '흙이 이미 촉촉해요' : cd > 0 ? '물이 스며드는 중…' : '수분 +' + C.waterPerAction + '%';
      }
    },
    _goTo(P, act) {
      this._modal?.m?.close();
      if (act && G.interact?.activate) { G.interact.activate(P.id); return; }
      const pl = G.sys.player;
      if (!pl?.walkTo) return;
      const pp = pl.position;
      const hw = (P.def.w || 6) / 2 + 0.9, hd = (P.def.d || 6) / 2 + 0.9;
      const tx = clamp(pp.x, P.cx - hw, P.cx + hw), tz = clamp(pp.z, P.cz - hd, P.cz + hd);
      const onEdge = Math.abs(tx - P.cx) >= hw - 0.01 || Math.abs(tz - P.cz) >= hd - 0.01;
      pl.walkTo({ x: onEdge ? tx : P.cx + hw, z: onEdge ? tz : P.cz }, { stopDistance: 0.5, onArrive: () => this.openPlot(P.id) });
    },
  };

  G.register(farming);
})();
