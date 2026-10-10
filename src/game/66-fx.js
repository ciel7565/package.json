// =============================================================================
// 66-fx.js — motion-graphics layer: one particle API for everyone (G.fx), 3D bursts, floating
// emoji, ground ripples, level-up pillar, footstep dust, quest-marker fireflies, and the 2D
// screen-space celebrations (level-up show, rubber stamp, coin fly + HUD count-up, edge pulse,
// exp-bar shimmer, achievement shine). Auto-wired to game events.
//
//   G.fx.burst(pos, {type, count, color, spread, up, size, lift})      also G.fx.burst(type, pos, opts)
//        type: confetti | sparkle | hearts | leaves | coins | stars | dust | splash | petals  -> spawned count
//        pos : Vector3 | {x,y,z} | [x,y,z] | Object3D (world position) — y = ground level of the effect
//   G.fx.emoji3d(target, emoji, {rise, duration, scale, offsetY})       floating 3D emoji sprite (rise+wobble+fade)
//   G.fx.ripple(pos, {color, radius, duration, rings})                 flat ground ring(s)
//   G.fx.levelUp(level, {from})                                         full-screen celebration + 3D pillar
//   G.fx.stamp(text='완료!', {color, sub, duration})                    rubber-stamp animation
//   G.fx.coinFly(from, amount, {holdHud})                               coins arc into #hud-coin, HUD counts up
//        from: {x,y} screen px | Vector3/Object3D (projected) | Element (its centre) | null (screen centre)
//   G.fx.pulse(color, {duration})                                       soft screen-edge glow
//   G.fx.shimmerExp() / G.fx.shine(el)                                  HUD exp-bar shimmer / glossy sweep on an element
//   G.fx.level() -> 'off'|'low'|'high' (effective)   G.fx.enabled()   G.fx.clear()   G.fx.stats()
//
// One world-particle API: the farming module's pooled point system G.ffx (presets DROP SPLASH LEAF POP
// SPARK GLINT DUST STEAM BUBBLE PETAL) renders sparkle / leaves / dust / splash / petals; this module adds
// ONE instanced billboard pool per blend mode (alpha: confetti, hearts, spinning 엽전 coins; additive:
// stars, rings, fireflies, pillar sparks) + one emoji pool => at most 3 extra draw calls (+2 while the
// level-up pillar shows). Without G.ffx (isolated builds) the own pools render those looks too.
// G.ffx.burst/spawn are gated by G.settings.fxLevel (decorative presets thinned on 'low', off on 'off';
// functional DROP/SPLASH/STEAM/BUBBLE always kept) so the setting governs every module's particles.
//
// Settings: G.settings.fxLevel 'off'|'low'|'high' (default 'high' desktop / 'low' touch),
// G.settings.reduceMotion (counts like 'low', no rays / rain / flying coins / camera shake).
// Security: all text goes through textContent; colours are validated; emoji are drawn on a canvas.
// =============================================================================
(function () {
  const U = G.util;
  const clamp = U.clamp;
  const TAU = Math.PI * 2;
  const rnd = Math.random;
  const R = (a, b) => a + rnd() * (b - a);
  const pnow = () => performance.now();

  // ---------------------------------------------------------------- settings
  const TOUCH = !!(G.input && G.input.touchUI);
  const LEVEL_NAMES = ['off', 'low', 'high'];
  const DEFAULT_LEVEL = TOUCH ? 'low' : 'high';
  // register the default before the app shell (70) fills in its own generic one
  if (G.settingsDefaults && !Object.prototype.hasOwnProperty.call(G.settingsDefaults, 'fxLevel')) G.settingsDefaults.fxLevel = DEFAULT_LEVEL;
  if (G.settings && LEVEL_NAMES.indexOf(G.settings.fxLevel) < 0) G.settings.fxLevel = DEFAULT_LEVEL;

  /** 0 off, 1 low, 2 high (reduceMotion caps at 1) */
  function lv() {
    let l = LEVEL_NAMES.indexOf(G.settings ? G.settings.fxLevel : DEFAULT_LEVEL);
    if (l < 0) l = LEVEL_NAMES.indexOf(DEFAULT_LEVEL);
    if (l > 1 && G.settings && G.settings.reduceMotion) l = 1;
    return l;
  }
  const mult = () => { const l = lv(); return l === 2 ? 1 : l === 1 ? 0.45 : 0; };
  const motion = () => !(G.settings && G.settings.reduceMotion);

  // ---------------------------------------------------------------- colours (validated)
  const dict = (o) => Object.freeze(Object.assign(Object.create(null), o)); // no prototype keys ('constructor', '__proto__'...)
  const NAMED = dict({ gold: '#f4c54a', green: '#34c36b', red: '#e0453a', blue: '#4aa8ff', water: '#49b7ff', pink: '#ff7eb6', purple: '#a07dff', white: '#ffffff', orange: '#ff9f43', teal: '#33d1c1', brown: '#8a5a3b', yellow: '#ffd84a' });
  const COLOR_RE = /^(#[0-9a-f]{3}|#[0-9a-f]{6}|#[0-9a-f]{8}|rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(,\s*(0|1|0?\.\d+)\s*)?\))$/i;
  /** css colour string or null */
  function cssColor(c) {
    if (typeof c !== 'string') return null;
    const s = c.trim().toLowerCase();
    if (NAMED[s]) return NAMED[s];
    return s.length <= 40 && COLOR_RE.test(s) ? s : null;
  }
  /** THREE.Color into `out` or null */
  function toColor(c, out) {
    if (c == null) return null;
    if (c.isColor) return out.copy(c);
    if (typeof c === 'number' && Number.isFinite(c)) return out.setHex(c & 0xffffff);
    const s = cssColor(c);
    if (!s) return null;
    if (s[0] === '#' && s.length === 9) return out.set(s.slice(0, 7)); // #rrggbbaa: alpha ignored in 3D
    out.setStyle(s.startsWith('rgba') ? s.replace(/^rgba\(([^,]+,[^,]+,[^,]+),[^)]*\)$/, 'rgb($1)') : s);
    return out;
  }
  const C = (hex) => new THREE.Color(hex);
  const PAL = {
    confetti: ['#e0453a', '#f4c54a', '#2f7de1', '#f7f4ea', '#34c36b', '#ff7eb6', '#a07dff', '#ff9f43'].map(C), // 오방색 + festive
    hearts: ['#ff4d6d', '#ff5d8f', '#ff7eb6', '#ff8fab'].map(C),
    stars: ['#ffe08a', '#fff1c2', '#ffc94a', '#ffffff'].map(C),
    sparkle: ['#ffe08a', '#fff6d8', '#ffd166'].map(C),
    leaves: ['#5aa043', '#7cc45a', '#3f8a35', '#9bd46f'].map(C),
    petals: ['#ffd1dc', '#ffb4c8', '#fff0f4', '#ffe9a8'].map(C),
    dust: ['#9a7a58', '#a88a66', '#8a6a4a'].map(C),
    splash: ['#cfe9ff', '#a9d8ff', '#e9f6ff'].map(C),
    firefly: ['#fff3a0', '#e6ff9a', '#ffe48a'].map(C),
    white: [C('#ffffff')],
  };
  const SURFACE_DUST = dict({ grass: C('#b9c79a'), road: C('#c9c4bb'), stone: C('#cfc8bb'), dirt: C('#a5835e'), wood: C('#b49470'), sand: C('#e2d2a8') });
  const _c1 = new THREE.Color(), _c2 = new THREE.Color();

  // ---------------------------------------------------------------- positions
  const _pv = new THREE.Vector3(), _pv2 = new THREE.Vector3(), _hv = new THREE.Vector3();
  function groundAt(x, z, fromY) {
    try { const h = G.world?.heightAt?.(x, z, fromY == null ? Infinity : fromY); return Number.isFinite(h) ? h : 0; } catch (e) { return 0; }
  }
  /** Vector3 | {x,y,z} | [x,y,z] | Object3D -> out (or null when invalid) */
  function resolvePos(p, out) {
    if (!p) return null;
    if (p.isObject3D) { p.getWorldPosition(out); return Number.isFinite(out.x) ? out : null; }
    let x, y, z;
    if (Array.isArray(p)) { x = +p[0]; y = p.length > 2 ? +p[1] : NaN; z = p.length > 2 ? +p[2] : +p[1]; }
    else { x = +p.x; y = +p.y; z = +p.z; }
    if (!Number.isFinite(x) || !Number.isFinite(z) || Math.abs(x) > 4000 || Math.abs(z) > 4000) return null;
    if (!Number.isFinite(y) || Math.abs(y) > 4000) y = groundAt(x, z);
    return out.set(x, y, z);
  }
  function playerPos(out) { const p = G.sys.player?.position; return p && Number.isFinite(p.x) ? out.copy(p) : null; }
  /** world position just above an object's head (player / NPC rigs) or its top */
  const _topCache = new WeakMap();
  function headPos(obj, out, extra = 0.35) {
    const pl = G.sys.player;
    if (!obj || obj === pl?.object || obj === pl?.position) {
      const ha = pl?.rig?.headAnchor;
      if (ha) { ha.getWorldPosition(out); out.y += extra; return out; }
      if (!playerPos(out)) return null;
      out.y += 1.75 + extra; return out;
    }
    if (obj.isObject3D) {
      let ha = null;
      obj.traverse((o) => { if (!ha && o.name === 'headAnchor') ha = o; });
      if (ha) { ha.getWorldPosition(out); out.y += extra; return out; }
      let top = _topCache.get(obj);
      if (top == null) {
        try { const b = new THREE.Box3().setFromObject(obj); obj.getWorldPosition(_hv); top = Number.isFinite(b.max.y) ? b.max.y - _hv.y : 1; } catch (e) { top = 1; }
        top = clamp(top, 0.2, 12);
        _topCache.set(obj, top);
      }
      obj.getWorldPosition(out); out.y += top + extra * 0.5; return out;
    }
    return resolvePos(obj, out);
  }
  /** world -> screen px (or null when behind the camera) */
  function toScreen(v) {
    const eng = G.sys.engine;
    if (!eng?.camera) return null;
    _pv2.copy(v).project(eng.camera);
    if (_pv2.z > 1 || _pv2.z < -1) return null;
    return { x: (_pv2.x * 0.5 + 0.5) * innerWidth, y: (-_pv2.y * 0.5 + 0.5) * innerHeight };
  }

  // ===========================================================================================
  // 3D: instanced billboard pools (one draw call each, hidden when empty)
  // ===========================================================================================
  const F_FLIP = 1, F_COIN = 2, F_TWINKLE = 4, F_FLAT = 8, F_BOUNCE = 16, F_FLUTTER = 32, F_GROW = 64, F_WOBBLE = 128, F_SETTLE = 256;
  // atlas cells (4 x 4)
  const K = { GLOW: 0, RECT: 1, DOT: 2, HEART: 3, STAR: 4, SPARK: 5, COIN: 6, RING: 7, SHOCK: 8, LEAF: 9, PETAL: 10, DROP: 11, RIBBON: 12, NOTE: 13, PUFF: 14, FIREFLY: 15 };

  const VS = `
    attribute vec3 iPos; attribute vec4 iData; attribute vec3 iCol; attribute vec2 iMisc;
    uniform float uCells;
    varying vec2 vUv; varying vec3 vCol; varying float vAlpha;
    void main() {
      vec2 p = position.xy;
      vec2 sp = vec2(p.x * iData.w, p.y) * iData.x;
      float c = cos(iData.z), s = sin(iData.z);
      sp = vec2(c * sp.x - s * sp.y, s * sp.x + c * sp.y);
      vec4 mv;
      if (iMisc.y > 0.5) mv = modelViewMatrix * vec4(iPos + vec3(sp.x, 0.0, sp.y), 1.0);
      else { mv = modelViewMatrix * vec4(iPos, 1.0); mv.xy += sp; }
      gl_Position = projectionMatrix * mv;
      float col = mod(iMisc.x, uCells), row = floor(iMisc.x / uCells + 0.001);
      vUv = (vec2(col, uCells - 1.0 - row) + (p + 0.5)) / uCells;
      vCol = iCol; vAlpha = iData.y;
    }`;
  const FS = `
    uniform sampler2D uMap; uniform float uBright;
    varying vec2 vUv; varying vec3 vCol; varying float vAlpha;
    void main() {
      vec4 t = texture2D(uMap, vUv);
      float a = t.a * vAlpha;
      if (a < 0.01) discard;
      gl_FragColor = vec4(vCol * t.rgb * uBright, a);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`;

  function drawAtlas(ctx, S) {
    const cell = (i, fn) => {
      ctx.save();
      ctx.translate((i % 4) * S + S / 2, Math.floor(i / 4) * S + S / 2);
      fn(S / 2 - 3);
      ctx.restore();
    };
    const rad = (r, stops) => { const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r); for (const [o, c] of stops) g.addColorStop(o, c); return g; };
    // 0 soft glow
    cell(K.GLOW, (r) => { ctx.fillStyle = rad(r, [[0, 'rgba(255,255,255,1)'], [0.3, 'rgba(255,255,255,.6)'], [1, 'rgba(255,255,255,0)']]); ctx.fillRect(-r, -r, 2 * r, 2 * r); });
    // 1 confetti paper (shaded so the tint keeps a fold)
    cell(K.RECT, (r) => {
      const g = ctx.createLinearGradient(-r * 0.4, 0, r * 0.4, 0);
      g.addColorStop(0, 'rgb(225,225,225)'); g.addColorStop(0.5, '#fff'); g.addColorStop(1, 'rgb(205,205,205)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.roundRect ? ctx.roundRect(-r * 0.4, -r * 0.8, r * 0.8, r * 1.6, 3) : ctx.rect(-r * 0.4, -r * 0.8, r * 0.8, r * 1.6); ctx.fill();
    });
    // 2 confetti dot
    cell(K.DOT, (r) => { ctx.fillStyle = rad(r * 0.62, [[0, '#fff'], [0.8, 'rgb(230,230,230)'], [1, 'rgba(210,210,210,0.9)']]); ctx.beginPath(); ctx.arc(0, 0, r * 0.6, 0, TAU); ctx.fill(); });
    // 3 heart
    cell(K.HEART, (r) => {
      ctx.shadowColor = 'rgba(255,255,255,.55)'; ctx.shadowBlur = 5;
      const g = ctx.createRadialGradient(-r * 0.3, -r * 0.35, 1, 0, 0, r * 1.1);
      g.addColorStop(0, '#fff'); g.addColorStop(0.6, 'rgb(235,235,235)'); g.addColorStop(1, 'rgb(185,185,185)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.moveTo(0, r * 0.82);
      ctx.bezierCurveTo(-r * 1.15, r * 0.02, -r * 0.72, -r * 0.98, 0, -r * 0.36);
      ctx.bezierCurveTo(r * 0.72, -r * 0.98, r * 1.15, r * 0.02, 0, r * 0.82); ctx.fill();
      ctx.shadowBlur = 0; ctx.fillStyle = 'rgba(255,255,255,.95)'; ctx.beginPath(); ctx.ellipse(-r * 0.38, -r * 0.3, r * 0.14, r * 0.22, -0.6, 0, TAU); ctx.fill();
    });
    // 4 five-point star with glow
    cell(K.STAR, (r) => {
      ctx.fillStyle = rad(r, [[0, 'rgba(255,255,255,.55)'], [0.45, 'rgba(255,255,255,.18)'], [1, 'rgba(255,255,255,0)']]); ctx.fillRect(-r, -r, 2 * r, 2 * r);
      ctx.fillStyle = '#fff'; ctx.beginPath();
      for (let i = 0; i < 10; i++) { const a = (i / 10) * TAU - Math.PI / 2, rr = i % 2 ? r * 0.3 : r * 0.72; ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); }
      ctx.closePath(); ctx.fill();
    });
    // 5 four-point sparkle
    cell(K.SPARK, (r) => {
      ctx.fillStyle = rad(r, [[0, 'rgba(255,255,255,.9)'], [0.22, 'rgba(255,255,255,.35)'], [1, 'rgba(255,255,255,0)']]); ctx.fillRect(-r, -r, 2 * r, 2 * r);
      ctx.fillStyle = '#fff'; ctx.beginPath();
      for (let i = 0; i < 8; i++) { const a = (i / 8) * TAU - Math.PI / 2, rr = i % 2 ? r * 0.13 : r * 0.98; ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); }
      ctx.closePath(); ctx.fill();
    });
    // 6 엽전 (brass coin with a square hole) — pre-coloured
    cell(K.COIN, (r) => {
      const rr = r * 0.9;
      const g = ctx.createRadialGradient(-rr * 0.35, -rr * 0.4, 1, 0, 0, rr);
      g.addColorStop(0, '#fff6c8'); g.addColorStop(0.45, '#f6cd52'); g.addColorStop(1, '#b8860b');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, rr, 0, TAU); ctx.fill();
      ctx.lineWidth = 3; ctx.strokeStyle = '#8f6200'; ctx.stroke();
      ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(150,100,0,.75)'; ctx.beginPath(); ctx.arc(0, 0, rr * 0.72, 0, TAU); ctx.stroke();
      const hs = rr * 0.24;
      ctx.globalCompositeOperation = 'destination-out'; ctx.fillRect(-hs, -hs, hs * 2, hs * 2);
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = '#7a5200'; ctx.lineWidth = 2.4; ctx.strokeRect(-hs, -hs, hs * 2, hs * 2);
      ctx.fillStyle = 'rgba(122,82,0,.85)';
      for (let i = 0; i < 4; i++) { const a = (i / 4) * TAU; ctx.beginPath(); ctx.arc(Math.cos(a) * rr * 0.48, Math.sin(a) * rr * 0.48, rr * 0.07, 0, TAU); ctx.fill(); }
      ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.beginPath(); ctx.ellipse(-rr * 0.45, -rr * 0.42, rr * 0.18, rr * 0.08, -0.7, 0, TAU); ctx.fill();
    });
    // 7 thin ring
    cell(K.RING, (r) => { ctx.fillStyle = rad(r, [[0, 'rgba(255,255,255,0)'], [0.74, 'rgba(255,255,255,0)'], [0.88, 'rgba(255,255,255,1)'], [1, 'rgba(255,255,255,0)']]); ctx.fillRect(-r, -r, 2 * r, 2 * r); });
    // 8 soft shock ring
    cell(K.SHOCK, (r) => { ctx.fillStyle = rad(r, [[0, 'rgba(255,255,255,0)'], [0.45, 'rgba(255,255,255,0)'], [0.8, 'rgba(255,255,255,.85)'], [1, 'rgba(255,255,255,0)']]); ctx.fillRect(-r, -r, 2 * r, 2 * r); });
    // 9 leaf
    cell(K.LEAF, (r) => {
      ctx.rotate(-0.6); ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.moveTo(0, -r * 0.9); ctx.quadraticCurveTo(r * 0.7, -r * 0.1, 0, r * 0.9); ctx.quadraticCurveTo(-r * 0.7, -r * 0.1, 0, -r * 0.9); ctx.fill();
      ctx.strokeStyle = 'rgba(150,170,150,.9)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(0, -r * 0.75); ctx.lineTo(0, r * 0.82); ctx.stroke();
    });
    // 10 petal (매화 petal with a notch)
    cell(K.PETAL, (r) => {
      const g = ctx.createRadialGradient(0, r * 0.4, 1, 0, 0, r);
      g.addColorStop(0, '#fff'); g.addColorStop(1, 'rgb(225,225,225)');
      ctx.fillStyle = g; ctx.beginPath();
      ctx.moveTo(0, r * 0.75); ctx.bezierCurveTo(-r * 0.85, r * 0.2, -r * 0.6, -r * 0.75, -r * 0.12, -r * 0.7);
      ctx.lineTo(0, -r * 0.5); ctx.lineTo(r * 0.12, -r * 0.7);
      ctx.bezierCurveTo(r * 0.6, -r * 0.75, r * 0.85, r * 0.2, 0, r * 0.75); ctx.fill();
    });
    // 11 droplet
    cell(K.DROP, (r) => {
      const g = ctx.createLinearGradient(-r * 0.4, -r, r * 0.4, r);
      g.addColorStop(0, '#fff'); g.addColorStop(1, 'rgb(200,225,255)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(0, -r * 0.85); ctx.bezierCurveTo(r * 0.25, -r * 0.35, r * 0.5, 0, r * 0.5, r * 0.3); ctx.arc(0, r * 0.3, r * 0.5, 0, Math.PI); ctx.bezierCurveTo(-r * 0.5, 0, -r * 0.25, -r * 0.35, 0, -r * 0.85); ctx.fill();
    });
    // 12 ribbon streamer
    cell(K.RIBBON, (r) => {
      ctx.strokeStyle = '#fff'; ctx.lineWidth = r * 0.22; ctx.lineCap = 'round'; ctx.beginPath();
      for (let i = 0; i <= 16; i++) { const t = i / 16; const y = -r * 0.85 + t * r * 1.7; const x = Math.sin(t * TAU * 1.2) * r * 0.32; if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); }
      ctx.stroke();
    });
    // 13 music note
    cell(K.NOTE, (r) => {
      ctx.fillStyle = '#fff'; ctx.strokeStyle = '#fff'; ctx.lineWidth = r * 0.12;
      ctx.beginPath(); ctx.ellipse(-r * 0.32, r * 0.5, r * 0.3, r * 0.22, -0.4, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.ellipse(r * 0.42, r * 0.32, r * 0.3, r * 0.22, -0.4, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.moveTo(-r * 0.06, r * 0.45); ctx.lineTo(-r * 0.06, -r * 0.62); ctx.lineTo(r * 0.68, -r * 0.8); ctx.lineTo(r * 0.68, r * 0.28); ctx.stroke();
    });
    // 14 cloud puff
    cell(K.PUFF, (r) => {
      for (const [x, y, s] of [[-0.3, 0.1, 0.55], [0.28, 0.12, 0.5], [0, -0.22, 0.6], [0.05, 0.3, 0.45]]) {
        const g = ctx.createRadialGradient(x * r, y * r, 0, x * r, y * r, s * r);
        g.addColorStop(0, 'rgba(255,255,255,.75)'); g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g; ctx.fillRect(-r, -r, 2 * r, 2 * r);
      }
    });
    // 15 firefly (bright core + halo)
    cell(K.FIREFLY, (r) => { ctx.fillStyle = rad(r, [[0, 'rgba(255,255,255,1)'], [0.12, 'rgba(255,255,255,.95)'], [0.3, 'rgba(255,255,255,.3)'], [1, 'rgba(255,255,255,0)']]); ctx.fillRect(-r, -r, 2 * r, 2 * r); });
  }

  /** pooled instanced billboards: struct-of-arrays, swap-remove, uploads only while alive */
  function makePool(name, cap, tex, cells, additive, renderOrder) {
    const base = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.setIndex(base.getIndex());
    geo.setAttribute('position', base.getAttribute('position'));
    const P = {
      name, cap, n: 0, geo, cells,
      iPos: new Float32Array(cap * 3), iCol: new Float32Array(cap * 3), iData: new Float32Array(cap * 4), iMisc: new Float32Array(cap * 2),
      vel: new Float32Array(cap * 3), base: new Float32Array(cap * 3),
      life: new Float32Array(cap), max: new Float32Array(cap), s0: new Float32Array(cap), s1: new Float32Array(cap), a0: new Float32Array(cap),
      grav: new Float32Array(cap), drag: new Float32Array(cap), spin: new Float32Array(cap), floor: new Float32Array(cap),
      ph: new Float32Array(cap), phs: new Float32Array(cap), bri: new Float32Array(cap), fout: new Float32Array(cap),
      flags: new Uint16Array(cap), bounce: new Uint8Array(cap),
    };
    const att = (key, arr, size) => { const a = new THREE.InstancedBufferAttribute(arr, size); a.setUsage(THREE.DynamicDrawUsage); geo.setAttribute(key, a); return a; };
    P.aPos = att('iPos', P.iPos, 3); P.aCol = att('iCol', P.iCol, 3); P.aData = att('iData', P.iData, 4); P.aMisc = att('iMisc', P.iMisc, 2);
    geo.instanceCount = 0;
    const mat = new THREE.ShaderMaterial({
      uniforms: { uMap: { value: tex }, uCells: { value: cells }, uBright: { value: 1 } },
      vertexShader: VS, fragmentShader: FS,
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'fx-' + name;
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    mesh.renderOrder = renderOrder;
    mesh.visible = false;
    mesh.raycast = () => {};
    P.mesh = mesh; P.mat = mat;
    P.f1 = ['life', 'max', 's0', 's1', 'a0', 'grav', 'drag', 'spin', 'floor', 'ph', 'phs', 'bri', 'fout', 'flags', 'bounce'].map((k) => P[k]);
    P.f3 = [P.iPos, P.vel, P.base, P.iCol];
    return P;
  }

  // spawn spec (re-used: spawning allocates nothing)
  const SP = { kind: 0, life: 1, s0: 0.2, s1: 0.2, a0: 1, grav: 0, drag: 1, spin: 0, rot: 0, floor: -1e9, ph: 0, phs: 0, bri: 1, fout: 0.65, flags: 0, color: null, delay: 0 };
  function resetSP() { SP.kind = 0; SP.life = 1; SP.s0 = SP.s1 = 0.2; SP.a0 = 1; SP.grav = 0; SP.drag = 1; SP.spin = 0; SP.rot = rnd() * TAU; SP.floor = -1e9; SP.ph = rnd() * TAU; SP.phs = 0; SP.bri = 1; SP.fout = 0.65; SP.flags = 0; SP.color = null; SP.delay = 0; return SP; }

  function spawn(P, x, y, z, vx, vy, vz) {
    if (!P || P.n >= P.cap) return -1;
    const i = P.n++, i3 = i * 3;
    P.iPos[i3] = x; P.iPos[i3 + 1] = y; P.iPos[i3 + 2] = z;
    P.vel[i3] = vx; P.vel[i3 + 1] = vy; P.vel[i3 + 2] = vz;
    const c = SP.color || PAL.white[0];
    P.base[i3] = c.r; P.base[i3 + 1] = c.g; P.base[i3 + 2] = c.b;
    P.life[i] = -(SP.delay || 0); P.max[i] = Math.max(0.05, SP.life);
    P.s0[i] = SP.s0; P.s1[i] = SP.s1; P.a0[i] = SP.a0; P.grav[i] = SP.grav; P.drag[i] = SP.drag; P.spin[i] = SP.spin;
    P.floor[i] = SP.floor; P.ph[i] = SP.ph; P.phs[i] = SP.phs; P.bri[i] = SP.bri; P.fout[i] = SP.fout; P.flags[i] = SP.flags; P.bounce[i] = 0;
    const i4 = i * 4;
    P.iData[i4] = 0; P.iData[i4 + 1] = 0; P.iData[i4 + 2] = SP.rot; P.iData[i4 + 3] = 1;
    P.iMisc[i * 2] = SP.kind; P.iMisc[i * 2 + 1] = SP.flags & F_FLAT ? 1 : 0;
    return i;
  }
  function kill(P, i) {
    const j = --P.n;
    if (i === j) return;
    for (const a of P.f1) a[i] = a[j];
    const i3 = i * 3, j3 = j * 3;
    for (const a of P.f3) { a[i3] = a[j3]; a[i3 + 1] = a[j3 + 1]; a[i3 + 2] = a[j3 + 2]; }
    const i4 = i * 4, j4 = j * 4, d = P.iData;
    d[i4] = d[j4]; d[i4 + 1] = d[j4 + 1]; d[i4 + 2] = d[j4 + 2]; d[i4 + 3] = d[j4 + 3];
    P.iMisc[i * 2] = P.iMisc[j * 2]; P.iMisc[i * 2 + 1] = P.iMisc[j * 2 + 1];
  }

  function stepPool(P, dt, t) {
    if (!P.n) { if (P.mesh.visible) { P.mesh.visible = false; P.geo.instanceCount = 0; } return; }
    const pos = P.iPos, vel = P.vel, data = P.iData, col = P.iCol, base = P.base;
    let i = 0;
    while (i < P.n) {
      const life = (P.life[i] += dt);
      const i3 = i * 3, i4 = i * 4;
      if (life < 0) { data[i4] = 0; data[i4 + 1] = 0; i++; continue; } // delayed spawn
      const max = P.max[i];
      if (life >= max) { kill(P, i); continue; }
      const fl = P.flags[i];
      // --- physics
      const dr = Math.max(0, 1 - P.drag[i] * dt);
      let vx = vel[i3] * dr, vy = vel[i3 + 1] * dr + P.grav[i] * dt, vz = vel[i3 + 2] * dr;
      if (fl & F_FLUTTER && vy < -1.25) vy += (-1.25 - vy) * Math.min(1, dt * 6);
      pos[i3] += vx * dt; pos[i3 + 1] += vy * dt; pos[i3 + 2] += vz * dt;
      if (fl & F_FLUTTER) { const s = Math.sin(life * 3.1 + P.ph[i]) * 0.9 * dt; pos[i3] += s; pos[i3 + 2] += Math.cos(life * 2.3 + P.ph[i]) * 0.7 * dt; }
      if (pos[i3 + 1] < P.floor[i]) {
        pos[i3 + 1] = P.floor[i];
        if (fl & F_BOUNCE && P.bounce[i] < 2 && vy < -1.2) { vy = -vy * 0.36; vx *= 0.55; vz *= 0.55; P.bounce[i]++; }
        else { vy = 0; vx *= 0.7; vz *= 0.7; if (fl & F_SETTLE) { P.phs[i] *= 0.8; P.spin[i] *= 0.8; } }
      }
      vel[i3] = vx; vel[i3 + 1] = vy; vel[i3 + 2] = vz;
      // --- look
      const k = life / max;
      let size;
      if (fl & F_GROW) { const e = 1 - Math.pow(1 - k, 3); size = P.s0[i] + (P.s1[i] - P.s0[i]) * e; }
      else {
        size = P.s0[i] + (P.s1[i] - P.s0[i]) * k;
        if (k < 0.12) { const q = k / 0.12; size *= 1 + 2.2 * (q - 1) * (q - 1) * (q - 1) + 1.2 * (q - 1) * (q - 1); } // ease-out-back pop
      }
      if (fl & F_TWINKLE) size *= 0.72 + 0.28 * Math.sin(life * 17 + P.ph[i]);
      const fo = P.fout[i];
      let a = P.a0[i] * (k < 0.06 ? k / 0.06 : 1) * (k > fo ? 1 - (k - fo) / (1 - fo) : 1);
      if (fl & F_GROW) a *= 1 - k * 0.35;
      P.ph[i] += P.phs[i] * dt;
      let sq = 1, shade = 1;
      if (fl & F_FLIP) { sq = Math.cos(P.ph[i]); shade = sq < 0 ? 0.62 : 0.86 + 0.14 * sq; }
      else if (fl & F_COIN) { const cc = Math.abs(Math.cos(P.ph[i])); sq = Math.max(0.12, cc); shade = 0.68 + 0.32 * cc; }
      let rot = data[i4 + 2] + P.spin[i] * dt;
      if (fl & F_WOBBLE) rot = Math.sin(life * 4.2 + P.ph[i]) * 0.32;
      data[i4] = size; data[i4 + 1] = a > 0 ? a : 0; data[i4 + 2] = rot; data[i4 + 3] = sq;
      const b = shade * P.bri[i];
      col[i3] = base[i3] * b; col[i3 + 1] = base[i3 + 1] * b; col[i3 + 2] = base[i3 + 2] * b;
      i++;
    }
    P.geo.instanceCount = P.n;
    P.mesh.visible = P.n > 0;
    upload(P, P.n);
  }
  /** upload only the live instances */
  function upload(P, n) {
    if (!n) return;
    for (const a of [P.aPos, P.aCol, P.aData, P.aMisc]) {
      if (a.clearUpdateRanges) { a.clearUpdateRanges(); a.addUpdateRange(0, n * a.itemSize); }
      a.needsUpdate = true;
    }
  }

  // ===========================================================================================
  // emoji sprites (canvas atlas cache, LRU)
  // ===========================================================================================
  const EMOJI_FONT = `"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji","PretendardEmbed",sans-serif`;
  const seg = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter('ko', { granularity: 'grapheme' }) : null;
  /** at most 2 grapheme clusters, no control characters */
  function cleanEmoji(s) {
    if (s == null) return '';
    s = String(s).replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, 24);
    if (!s) return '';
    if (seg) { const out = []; for (const g of seg.segment(s)) { out.push(g.segment); if (out.length >= 2) break; } return out.join(''); }
    return Array.from(s).slice(0, 3).join('');
  }

  // ===========================================================================================
  // the system
  // ===========================================================================================
  const fx = {
    name: 'fx', order: 83, label: '효과 연출',
    _ready: false, _scene: null, _normal: null, _add: null, _emo: null, _emoTex: null, _emoCanvas: null, _emoCtx: null,
    _emoMap: new Map(), _emoCells: [], _emoInst: [], _emoQ: [], _emoQT: 0,
    _pillar: null, _quietUntil: 0, _questQuietUntil: 0, _loadedAt: 0,
    _steps: -1, _airVy: 0, _wasAir: false, _fireT: 0, _expKey: null, _expT: 0,
    _flights: [], _coinEls: 0, _coinDisp: null, _coinOverride: false, _coinText: '',
    _luQ: [], _lu: null, _stampEl: null, _stampT: 0, _pendingStamp: null, _rain: null, _pulseEl: null, _root: null,
    _lastFarm: null, _timers: new Set(), _offs: [], _gen: 0, _wLast: 0, _ev: new THREE.Vector3(),

    // ------------------------------------------------------------ lifecycle
    init() {
      this._ensure3D();
      this._bindEvents();
      this._applyBodyClass();
      G.sys.engine?.onResize?.(() => { if (this._rain?.active) this._sizeRain(); });
      G.log.info('UI', `fx ready (level ${LEVEL_NAMES[lv()]}${G.ffx ? ', G.ffx merged' : ''})`);
    },

    onStateLoaded(state) {
      this._reset();
      const t = pnow();
      this._loadedAt = t;
      this._quietUntil = t + 1200;        // achievements re-checked right after a load are fine, silent re-evaluations are not
      this._questQuietUntil = t + 3000;   // quest re-evaluation on load may emit quest:completed silently
      const s = state?.stats;
      this._expKey = s ? (Number(s.expTotal) || 0) + (Number(s.level) || 0) * 1e-6 : null;
      this._steps = -1;
    },

    onLogout() { this._reset(); this._expKey = null; },

    update(dt, t) {
      if (G.ffx?.update) G.ffx.update(dt); // frame-guarded inside: safe if farming already stepped it
      const ok = this._ready;
      if (ok) {
        const nf = clamp(Number(G.world?.nightFactor) || 0, 0, 1);
        this._normal.mat.uniforms.uBright.value = 1 - 0.5 * nf;
        this._emo.mat.uniforms.uBright.value = 1 - 0.28 * nf;
        stepPool(this._normal, dt, t);
        stepPool(this._add, dt, t);
        this._stepEmoji(dt);
        if (this._pillar?.active) this._stepPillar(dt, t);
      }
      if (G.state && ok) {
        const l = lv();
        if (l > 0) this._stepPlayerFx(dt, l);
        if (l > 1) this._stepFireflies(dt);
        if (this._emoQ.length) { this._emoQT -= dt; if (this._emoQT <= 0) { const e = this._emoQ.shift(); this._emoQT = 0.3; this.emoji3d(e.target, e.emoji, e.opts); } }
      }
      // 2D layer runs on wall-clock time so it stays in sync with its CSS animations on slow devices
      const wn = pnow();
      const wdt = this._wLast ? clamp((wn - this._wLast) / 1000, 0, 0.25) : dt;
      this._wLast = wn;
      if (this._flights.length || this._coinOverride) this._stepCoins(wdt);
      if (this._rain?.active) this._stepRain(wdt);
      // exp bar shimmer (any exp source)
      this._expT -= dt;
      if (this._expT <= 0 && G.state?.stats) {
        this._expT = 0.2;
        const s = G.state.stats;
        const key = (Number(s.expTotal) || 0) + (Number(s.level) || 0) * 1e-6;
        if (this._expKey != null && key > this._expKey + 1e-9 && pnow() > this._quietUntil) this.shimmerExp();
        this._expKey = key;
      }
    },

    // ------------------------------------------------------------ public API
    level() { return LEVEL_NAMES[lv()]; },
    enabled() { return lv() > 0; },

    /** burst(pos, {type,...}) or burst(type, pos, opts) -> number of particles spawned */
    burst(a, b, c) {
      let type, pos, o;
      if (typeof a === 'string') { type = a; pos = b; o = c || {}; }
      else { pos = a; o = b || {}; type = o.type; }
      if (o == null || typeof o !== 'object') o = {};
      type = ALIAS[String(type || 'sparkle').toLowerCase().slice(0, 24)] || 'sparkle';
      const m = mult();
      if (!m) return 0;
      const T = TYPES[type];
      const p = pos == null ? playerPos(_pv) : resolvePos(pos, _pv);
      if (!p || !this._ensure3D()) return 0;
      const n0 = Number.isFinite(+o.count) ? clamp(Math.round(+o.count), 0, 160) : T.n;
      const n = n0 ? Math.max(1, Math.round(n0 * m)) : 0;
      if (!n) return 0;
      const gy = p.y;
      const lift = Number.isFinite(+o.lift) ? clamp(+o.lift, -5, 20) : T.lift;
      const spread = Number.isFinite(+o.spread) ? clamp(+o.spread, 0.05, 6) : 1;
      const up = Number.isFinite(+o.up) ? clamp(+o.up, 0, 6) : 1;
      const size = Number.isFinite(+o.size) ? clamp(+o.size, 0.2, 5) : 1;
      const col = toColor(o.color, _c1);
      return T.fn.call(this, p.x, gy + lift, p.z, n, { gy, spread, up, size, col });
    },

    /** floating 3D emoji sprite above a target (Object3D follows it while it floats) */
    emoji3d(target, emoji, opts = {}) {
      if (!lv() || !this._ensure3D()) return false;
      const e = cleanEmoji(emoji);
      if (!e) return false;
      if (opts == null || typeof opts !== 'object') opts = {};
      const follow = target && target.isObject3D ? target : target == null ? (G.sys.player?.object || null) : null;
      const base = new THREE.Vector3();
      if (follow) { if (!headPos(follow, base, 0.3)) return false; }
      else if (target == null) { if (!headPos(null, base, 0.3)) return false; }
      else if (!resolvePos(target, base)) return false;
      const cell = this._emojiCell(e);
      if (cell < 0) return false;
      const inst = this._emoInst;
      if (inst.length >= EMO_CAP) inst.shift();
      const off = follow ? new THREE.Vector3().subVectors(base, follow.getWorldPosition(_hv)) : null;
      const dur = clamp(Number(opts.duration) || 1.7, 0.4, 6);
      inst.push({
        cell, emoji: e, follow, off, base, t: 0, dur,
        rise: clamp(Number.isFinite(+opts.rise) ? +opts.rise : 1.15, 0, 6),
        size: 0.62 * clamp(Number(opts.scale) || 1, 0.2, 4),
        oy: Number.isFinite(+opts.offsetY) ? clamp(+opts.offsetY, -5, 10) : 0,
        ph: rnd() * TAU, dx: R(-0.25, 0.25), dz: R(-0.25, 0.25),
      });
      this._emoMap.get(e).t = pnow();
      return true;
    },
    /** queued emoji (rate limited, for bursts of unlock events) */
    emojiQueued(target, emoji, opts) {
      if (!lv()) return;
      this._emoQ.push({ target, emoji, opts });
      if (this._emoQ.length > 5) this._emoQ.shift();
    },

    /** flat ground ring(s) */
    ripple(pos, opts = {}) {
      if (!lv() || !this._ensure3D()) return 0;
      if (opts == null || typeof opts !== 'object') opts = {};
      const p = pos == null ? playerPos(_pv) : resolvePos(pos, _pv);
      if (!p) return 0;
      const col = toColor(opts.color, _c1) || _c1.set('#ffe7a0');
      const radius = clamp(Number(opts.radius) || 1.6, 0.2, 20);
      const dur = clamp(Number(opts.duration) || 0.95, 0.2, 5);
      const rings = clamp(Math.round(Number(opts.rings) || (lv() > 1 ? 2 : 1)), 1, 4);
      let k = 0;
      for (let r = 0; r < rings; r++) {
        resetSP(); SP.kind = r % 2 ? K.RING : K.SHOCK; SP.flags = F_FLAT | F_GROW; SP.life = dur * (1 - r * 0.12); SP.delay = r * 0.17;
        SP.s0 = radius * 0.25; SP.s1 = radius * 2 * (1 - r * 0.1); SP.a0 = 0.9; SP.drag = 0; SP.fout = 0.4; SP.bri = 1.25; SP.color = col; SP.rot = rnd() * TAU;
        if (spawn(this._add, p.x, p.y + 0.06 + r * 0.01, p.z, 0, 0, 0) >= 0) k++;
      }
      return k;
    },

    /** full-screen level-up celebration (queued after any reward popup) */
    levelUp(level, opts = {}) {
      level = Math.floor(Number(level));
      if (!Number.isFinite(level) || level < 1 || level > 999) return;
      const from = Number.isFinite(+opts?.from) ? Math.max(1, Math.floor(+opts.from)) : level - 1;
      const last = this._luQ[this._luQ.length - 1];
      if (last && !last.started) { last.to = Math.max(last.to, level); last.from = Math.min(last.from, from); }
      else this._luQ.push({ from, to: level, started: false, waited: 0 });
      this._pumpLevelUp();
    },

    /** rubber stamp in the screen centre */
    stamp(text = '완료!', opts = {}) {
      if (!lv() || !this._layer()) return;
      if (opts == null || typeof opts !== 'object') opts = {};
      const txt = String(text ?? '').replace(/[\u0000-\u001f]/g, '').slice(0, 14) || '완료!';
      const sub = opts.sub ? String(opts.sub).replace(/[\u0000-\u001f]/g, '').slice(0, 40) : '';
      const color = cssColor(opts.color) || '#e0453a';
      this._killStamp();
      const h = G.ui.h;
      const el = h('div', { class: 'fx-stamp-wrap' + (motion() ? '' : ' fx-static'), 'aria-hidden': 'true' },
        h('div', { class: 'fx-stamp' }, h('span', { class: 'fx-stamp-text' }, txt), sub ? h('span', { class: 'fx-stamp-sub' }, sub) : null),
        h('div', { class: 'fx-stamp-ink' }));
      el.style.setProperty('--fx-stamp', color);
      this._root.appendChild(el);
      this._stampEl = el;
      const dur = clamp(Number(opts.duration) || 1900, 900, 5000);
      // the lifetime starts when the stamp is actually painted (slow devices commit frames late)
      this._whenShown(el, () => {
        if (this._stampEl !== el) return;
        this._later(() => { if (this._stampEl === el) { G.sfx('pop', { volume: 1 }); if (motion() && G.settings.cameraShake !== false) G.sys.camera?.shake?.(0.06); } }, motion() ? 230 : 0);
        this._later(() => { if (this._stampEl === el) { el.classList.add('out'); this._later(() => { el.remove(); if (this._stampEl === el) this._stampEl = null; }, 420); } }, dur);
      });
    },

    /** coins arc from `from` into #hud-coin; the HUD number counts up as they land */
    coinFly(from, amount, opts = {}) {
      amount = Math.floor(Number(amount));
      if (!(amount > 0) || amount > 1e9) return;
      const hud = document.getElementById('hud-coin');
      const hudOk = hud && !document.getElementById('hud')?.hidden && !document.body.classList.contains('hud-hidden') && hud.getClientRects().length;
      if (!hudOk || !lv() || !this._layer()) return;
      const icon = hud.parentElement?.querySelector('.ico') || hud;
      const tr = icon.getBoundingClientRect();
      const tx = tr.left + tr.width / 2, ty = tr.top + tr.height / 2;
      const src = this._screenFrom(from);
      const canAnimate = motion() && typeof Element !== 'undefined' && typeof Element.prototype.animate === 'function';
      const l = lv();
      let n = canAnimate ? Math.round(2 + Math.log2(1 + amount) * (l > 1 ? 1.25 : 0.6)) : 0;
      n = clamp(n, canAnimate ? 2 : 0, l > 1 ? 12 : 5);
      n = Math.min(n, Math.max(0, 40 - this._coinEls));
      const flight = { amount, n, landed: 0, t: 0, deadline: 0.9 + n * 0.06 + 1.2, hold: !(opts && opts.holdHud === false) };
      this._flights.push(flight);
      if (flight.hold) this._startCoinOverride();
      if (!n) { flight.landed = flight.n = 1; this._bumpCoin(icon); return; }
      const h = G.ui.h;
      const gen = this._gen;
      for (let i = 0; i < n; i++) {
        const el = h('span', { class: 'fx-coin', html: G.icon('coin') }); // static inline SVG from the core icon set
        this._root.appendChild(el);
        this._coinEls++;
        const a = rnd() * TAU, sr = R(18, 64);
        const x0 = src.x, y0 = src.y;
        const x1 = x0 + Math.cos(a) * sr, y1 = y0 + Math.sin(a) * sr * 0.7 - 20;
        const cx = (x1 + tx) / 2 + R(-90, 90), cy = Math.min(y1, ty) - R(90, 200);
        // spin = horizontal squash that never goes fully edge-on (stays readable as a coin)
        const ph0 = rnd() * Math.PI;
        const spin = (k) => (0.38 + 0.62 * Math.abs(Math.cos(ph0 + k * Math.PI * 3.5))).toFixed(3);
        const frames = [{ transform: `translate(${x0}px,${y0}px) scale(.3,.3)`, opacity: 0, offset: 0 }];
        frames.push({ transform: `translate(${x1}px,${y1}px) scale(${(1.15 * spin(0)).toFixed(3)},1.15)`, opacity: 1, offset: 0.2 });
        for (let s = 1; s <= 8; s++) {
          const u = s / 8, iu = 1 - u, sc = 1.15 - 0.5 * u;
          const bx = iu * iu * x1 + 2 * iu * u * cx + u * u * tx, by = iu * iu * y1 + 2 * iu * u * cy + u * u * ty;
          frames.push({ transform: `translate(${bx.toFixed(1)}px,${by.toFixed(1)}px) scale(${(sc * spin(u)).toFixed(3)},${sc.toFixed(3)})`, opacity: 1, offset: 0.2 + 0.8 * u });
        }
        frames[frames.length - 1].opacity = 0.85;
        let done = false;
        const finish = () => {
          if (done) return; done = true;
          el.remove();
          if (gen !== this._gen) return; // a logout / reload happened meanwhile
          this._coinEls = Math.max(0, this._coinEls - 1);
          if (this._flights.includes(flight)) {
            flight.landed++;
            this._bumpCoin(icon);
            if (flight.landed === 1 || flight.landed === flight.n) G.sfx('coin', { volume: 0.55 });
          }
        };
        try {
          const anim = el.animate(frames, { duration: R(720, 900), delay: i * 55, easing: 'cubic-bezier(.35,.1,.6,1)', fill: 'both' });
          anim.onfinish = finish; anim.oncancel = finish;
        } catch (e) { finish(); }
        this._later(finish, 2600 + i * 60); // hard stop
      }
    },

    /** soft screen-edge glow */
    pulse(color = '#f4c54a', opts = {}) {
      if (!lv() || !this._layer()) return;
      const c = cssColor(color) || '#f4c54a';
      let el = this._pulseEl;
      if (!el || !el.isConnected) { el = this._pulseEl = G.ui.h('div', { class: 'fx-pulse', 'aria-hidden': 'true' }); this._root.appendChild(el); }
      el.style.setProperty('--fx-pulse', c);
      const dur = clamp(Number(opts?.duration) || 1300, 400, 4000);
      try {
        el.getAnimations?.().forEach((a) => a.cancel());
        el.animate([{ opacity: 0 }, { opacity: motion() ? 1 : 0.7, offset: 0.25 }, { opacity: 0 }], { duration: dur, easing: 'ease-out' });
      } catch (e) { /* cosmetic */ }
    },

    shimmerExp() {
      if (!lv()) return;
      const bar = document.getElementById('hud-exp-bar')?.parentElement;
      if (!bar) return;
      this.shine(bar, { bar: true, duration: 950 });
      try { bar.animate([{ boxShadow: '0 0 0 0 rgba(178,150,255,0)' }, { boxShadow: '0 0 12px 2px rgba(178,150,255,.75)', offset: 0.3 }, { boxShadow: '0 0 0 0 rgba(178,150,255,0)' }], { duration: 1000 }); } catch (e) { /* cosmetic */ }
    },
    /** glossy light sweep across an element: one aria-hidden clip layer child (re-used); never changes the host's overflow */
    shine(el, opts) {
      if (typeof Element === 'undefined' || !(el instanceof Element) || !el.isConnected || !lv()) return;
      const o = opts && typeof opts === 'object' ? opts : {};
      let clip = el.querySelector(':scope > .fx-shine-clip');
      if (!clip) {
        clip = document.createElement('b');
        clip.className = 'fx-shine-clip';
        clip.setAttribute('aria-hidden', 'true');
        const sw = document.createElement('b');
        sw.className = 'fx-shine-sweep' + (o.bar ? ' fx-bar-shine' : '');
        clip.appendChild(sw);
        el.appendChild(clip);
        try { if (getComputedStyle(el).position === 'static') el.style.position = 'relative'; } catch (e) { /* ignore */ }
      }
      const sw = clip.firstChild;
      try { sw.animate([{ transform: 'translateX(-130%) skewX(-20deg)' }, { transform: 'translateX(330%) skewX(-20deg)' }], { duration: clamp(Number(o.duration) || 1100, 200, 4000), delay: clamp(Number(o.delay) || 0, 0, 4000), easing: 'ease-in-out', fill: 'backwards' }); } catch (e) { /* cosmetic */ }
    },

    clear() {
      for (const P of [this._normal, this._add]) if (P) { P.n = 0; P.geo.instanceCount = 0; P.mesh.visible = false; }
      this._emoInst.length = 0; this._emoQ.length = 0;
      if (this._emo) { this._emo.n = 0; this._emo.geo.instanceCount = 0; this._emo.mesh.visible = false; }
      if (this._pillar) { this._pillar.active = false; this._pillar.group.visible = false; }
      this._stopRain();
    },

    stats() {
      return {
        level: this.level(), normal: this._normal?.n || 0, additive: this._add?.n || 0, emoji: this._emoInst.length, emojiCached: this._emoMap.size,
        pillar: !!this._pillar?.active, coinsFlying: this._coinEls, flights: this._flights.length, levelUpQueue: this._luQ.length,
        levelUpShowing: !!this._lu, rain: !!this._rain?.active, ffxMerged: !!G.ffx?.__fxGated,
        drawCalls: [this._normal, this._add, this._emo].filter((P) => P?.mesh.visible).length + (this._pillar?.active ? 2 : 0),
      };
    },

    // ------------------------------------------------------------ internals: 3D setup
    _ensure3D() {
      if (this._ready) return true;
      const scene = G.sys.engine?.scene;
      if (!scene) return false;
      try {
        const S = 64;
        const atlas = G.gfx.canvasTexture(S * 4, S * 4, (ctx) => drawAtlas(ctx, S));
        this._normal = makePool('normal', 560, atlas, 4, false, 14);
        this._add = makePool('add', 420, atlas, 4, true, 15);
        // emoji atlas: 8x8 cells of 64 px, filled on demand
        const c = document.createElement('canvas');
        c.width = c.height = 512;
        this._emoCanvas = c;
        this._emoCtx = c.getContext('2d');
        const et = new THREE.CanvasTexture(c);
        et.colorSpace = THREE.SRGBColorSpace;
        et.anisotropy = 2;
        this._emoTex = et;
        this._emo = makePool('emoji', EMO_CAP, et, 8, false, 16);
        this._emoCells = new Array(64).fill(null);
        scene.add(this._normal.mesh, this._add.mesh, this._emo.mesh);
        this._scene = scene;
        this._ready = true;
      } catch (e) {
        G.log.error('UI', 'fx 3D setup failed', e);
        return false;
      }
      return true;
    },

    _emojiCell(e) {
      const hit = this._emoMap.get(e);
      if (hit) return hit.cell;
      const cells = this._emoCells;
      let cell = cells.indexOf(null);
      if (cell < 0) { // evict the least recently used emoji that is not on screen
        const used = new Set(this._emoInst.map((x) => x.cell));
        let best = -1, bt = Infinity;
        for (let i = 0; i < cells.length; i++) { const r = this._emoMap.get(cells[i]); if (r && !used.has(i) && r.t < bt) { bt = r.t; best = i; } }
        if (best < 0) return -1;
        this._emoMap.delete(cells[best]);
        cell = best;
      }
      const ctx = this._emoCtx, x = (cell % 8) * 64, y = Math.floor(cell / 8) * 64;
      ctx.clearRect(x, y, 64, 64);
      ctx.save();
      ctx.beginPath(); ctx.rect(x, y, 64, 64); ctx.clip();
      ctx.font = `46px ${EMOJI_FONT}`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.shadowColor = 'rgba(255,255,255,0.95)'; ctx.shadowBlur = 7;
      ctx.fillText(e, x + 32, y + 35);
      ctx.shadowColor = 'rgba(0,0,0,0.35)'; ctx.shadowBlur = 3; ctx.shadowOffsetY = 2;
      ctx.fillText(e, x + 32, y + 35);
      ctx.restore();
      this._emoTex.needsUpdate = true;
      cells[cell] = e;
      this._emoMap.set(e, { cell, t: pnow() });
      return cell;
    },

    _stepEmoji(dt) {
      const P = this._emo, inst = this._emoInst;
      let w = 0;
      for (let k = 0; k < inst.length; k++) {
        const it = inst[k];
        it.t += dt;
        if (it.t >= it.dur || (it.follow && !it.follow.parent)) continue;
        inst[w++] = it;
        const u = it.t / it.dur;
        if (it.follow) { it.follow.getWorldPosition(it.base); it.base.add(it.off); }
        const rise = it.rise * (1 - Math.pow(1 - Math.min(1, u * 1.15), 3));
        const i3 = (w - 1) * 3, i4 = (w - 1) * 4;
        P.iPos[i3] = it.base.x + it.dx * u + Math.sin(it.t * 2.6 + it.ph) * 0.06;
        P.iPos[i3 + 1] = it.base.y + it.oy + rise;
        P.iPos[i3 + 2] = it.base.z + it.dz * u;
        const pop = u < 0.16 ? (u / 0.16) : 1;
        const sc = u < 0.16 ? 1.32 * Math.sin(pop * Math.PI / 2) : u < 0.3 ? 1.32 - 0.32 * ((u - 0.16) / 0.14) : 1;
        P.iData[i4] = it.size * sc;
        P.iData[i4 + 1] = u > 0.7 ? 1 - (u - 0.7) / 0.3 : 1;
        P.iData[i4 + 2] = motion() ? Math.sin(it.t * 3.4 + it.ph) * 0.14 : 0;
        P.iData[i4 + 3] = 1;
        P.iCol[i3] = P.iCol[i3 + 1] = P.iCol[i3 + 2] = 1;
        P.iMisc[(w - 1) * 2] = it.cell; P.iMisc[(w - 1) * 2 + 1] = 0;
      }
      inst.length = w;
      P.n = w;
      P.geo.instanceCount = w;
      const vis = w > 0;
      if (vis) upload(P, w);
      P.mesh.visible = vis;
    },

    // ------------------------------------------------------------ level-up 3D pillar
    _buildPillar() {
      if (this._pillar) return this._pillar;
      const geo = new THREE.CylinderGeometry(1, 1, 1, 40, 1, true);
      geo.translate(0, 0.5, 0);
      const mk = (core) => new THREE.ShaderMaterial({
        uniforms: { uTime: { value: 0 }, uOp: { value: 0 }, uColor: { value: new THREE.Color(core ? 0xfff2c0 : 0xffc94a) } },
        vertexShader: `varying vec2 vUv; varying vec3 vN; varying vec3 vV;
          void main(){ vUv = uv; vec4 wp = modelMatrix * vec4(position, 1.0); vN = normalize(mat3(modelMatrix) * normal); vV = normalize(cameraPosition - wp.xyz); gl_Position = projectionMatrix * viewMatrix * wp; }`,
        fragmentShader: `uniform float uTime; uniform float uOp; uniform vec3 uColor; varying vec2 vUv; varying vec3 vN; varying vec3 vV;
          void main(){
            float facing = pow(abs(dot(normalize(vN), normalize(vV))), ${core ? '1.2' : '2.2'});
            float fade = pow(1.0 - vUv.y, 1.25) * smoothstep(0.0, 0.035, vUv.y);
            float sw = 0.62 + 0.38 * sin((vUv.x * ${core ? '2.0' : '5.0'} + vUv.y * 9.0 - uTime * 2.4) * 6.2831);
            float a = facing * fade * sw * uOp;
            gl_FragColor = vec4(uColor * (1.1 + facing), a);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
          }`,
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      });
      const outer = new THREE.Mesh(geo, mk(false));
      const inner = new THREE.Mesh(geo, mk(true));
      for (const m of [outer, inner]) { m.frustumCulled = false; m.renderOrder = 13; m.raycast = () => {}; }
      const group = new THREE.Group();
      group.name = 'fx-levelup-pillar';
      group.add(outer, inner);
      group.visible = false;
      this._scene.add(group);
      this._pillar = { group, outer, inner, t: 0, dur: 2.8, active: false, spawnAcc: 0 };
      return this._pillar;
    },
    _startPillar() {
      if (!this._ensure3D() || !playerPos(_pv)) return;
      const P = this._buildPillar();
      P.t = 0; P.active = true; P.spawnAcc = 0; P.group.visible = true;
      P.group.position.copy(_pv);
      // shock rings + star burst + confetti
      this.ripple(_pv, { color: '#ffd166', radius: 3.4, duration: 1.2, rings: lv() > 1 ? 3 : 1 });
      this.burst('stars', _pv, { count: 26, lift: 1.0, spread: 1.4 });
      this.burst('confetti', _pv, { count: 50, lift: 2.2 });
      G.sfx('whoosh', { volume: 0.7 });
      if (motion() && G.settings.cameraShake !== false) G.sys.camera?.shake?.(0.16);
    },
    _stepPillar(dt, t) {
      const P = this._pillar;
      P.t += dt;
      const k = P.t / P.dur;
      if (k >= 1 || !G.state) { P.active = false; P.group.visible = false; return; }
      if (playerPos(_pv)) P.group.position.lerp(_pv, Math.min(1, dt * 10));
      const grow = 1 - Math.pow(1 - Math.min(1, P.t / 0.45), 3);
      const op = (P.t < 0.15 ? P.t / 0.15 : 1) * (k > 0.62 ? 1 - (k - 0.62) / 0.38 : 1);
      const h = 2 + grow * 16;
      P.outer.scale.set(0.35 + grow * 1.05, h, 0.35 + grow * 1.05);
      P.inner.scale.set(0.12 + grow * 0.36, h * 1.05, 0.12 + grow * 0.36);
      P.outer.material.uniforms.uOp.value = op * 0.55;
      P.inner.material.uniforms.uOp.value = op * 0.8;
      P.outer.material.uniforms.uTime.value = t;
      P.inner.material.uniforms.uTime.value = t * 1.3;
      // rising helix of sparks
      if (P.t < 1.7 && lv()) {
        P.spawnAcc += dt * (lv() > 1 ? 34 : 14);
        const g = P.group.position;
        while (P.spawnAcc >= 1) {
          P.spawnAcc -= 1;
          const a = P.t * 7 + (rnd() < 0.5 ? 0 : Math.PI) + R(-0.2, 0.2);
          const r = R(0.9, 1.3);
          resetSP(); SP.kind = rnd() < 0.5 ? K.SPARK : K.STAR; SP.life = R(0.9, 1.4); SP.s0 = R(0.18, 0.3); SP.s1 = 0.02; SP.grav = 0; SP.drag = 0.4;
          SP.flags = F_TWINKLE; SP.spin = R(-3, 3); SP.bri = 1.6; SP.color = PAL.stars[(rnd() * PAL.stars.length) | 0];
          spawn(this._add, g.x + Math.cos(a) * r, g.y + R(0.1, 0.6), g.z + Math.sin(a) * r, -Math.sin(a) * 1.2, R(3.5, 6), Math.cos(a) * 1.2);
        }
      }
    },

    // ------------------------------------------------------------ player-driven world fx
    _stepPlayerFx(dt, l) {
      const pl = G.sys.player;
      if (!pl?.rig || !pl.position || pl.enabled === false) return;
      const steps = pl.rig.steps;
      if (this._steps < 0) this._steps = steps;
      if (steps !== this._steps) {
        this._steps = steps;
        if (pl.grounded && (pl.speed || 0) > 4.6) this._footDust(pl, l, 1);
      }
      if (!pl.grounded) { this._airVy = Math.min(this._airVy, pl.velocity?.y || 0); this._wasAir = true; }
      else if (this._wasAir) {
        if (this._airVy < -5.5) this._footDust(pl, l, clamp(-this._airVy / 6, 1, 2.4));
        this._airVy = 0; this._wasAir = false;
      }
    },
    _footDust(pl, l, power) {
      const p = pl.position;
      const surf = (() => { try { return G.world?.surfaceAt?.(p.x, p.z) || 'grass'; } catch (e) { return 'grass'; } })();
      const water = surf === 'water' || p.y < (G.data.layout?.waterY ?? -1.1) - 0.02;
      const fx = Math.sin(pl.rotY || 0), fz = Math.cos(pl.rotY || 0);
      const n = Math.max(1, Math.round((l > 1 ? 3 : 1) * power));
      const raw = ffxRaw;
      if (raw && G.ffx?.P) {
        const Pp = G.ffx.P;
        if (water) { raw.burst(Pp.DROP, p.x, p.y + 0.05, p.z, n + 2, 1.0 * power, 1.6 * power, null, p.y - 0.05); return; }
        const col = SURFACE_DUST[surf] || SURFACE_DUST.grass;
        for (let k = 0; k < n; k++) raw.spawn(Pp.DUST, p.x - fx * 0.25 + R(-0.15, 0.15), p.y + 0.06, p.z - fz * 0.25 + R(-0.15, 0.15), -fx * R(0.3, 0.9) + R(-0.4, 0.4), R(0.25, 0.6) * power, -fz * R(0.3, 0.9) + R(-0.4, 0.4), col, p.y);
        return;
      }
      // own fallback
      for (let k = 0; k < n; k++) {
        resetSP(); SP.kind = water ? K.DROP : K.PUFF; SP.life = R(0.5, 0.8); SP.s0 = 0.12; SP.s1 = water ? 0.06 : 0.42; SP.a0 = water ? 0.9 : 0.5;
        SP.grav = water ? -7 : 0.3; SP.drag = 2.4; SP.floor = p.y; SP.color = water ? PAL.splash[0] : (SURFACE_DUST[surf] || SURFACE_DUST.grass);
        spawn(this._normal, p.x - fx * 0.25, p.y + 0.06, p.z - fz * 0.25, -fx * R(0.3, 0.9) + R(-0.4, 0.4), R(0.3, 0.8) * power * (water ? 3 : 1), -fz * R(0.3, 0.9) + R(-0.4, 0.4));
      }
    },
    /** gentle firefly motes around the primary quest markers near the player (high only) */
    _stepFireflies(dt) {
      this._fireT -= dt;
      if (this._fireT > 0) return;
      this._fireT = 0.3;
      const pp = G.sys.player?.position;
      const ms = G.sys.quest?.getMarkers?.();
      if (!pp || !Array.isArray(ms) || !ms.length || document.body.classList.contains('photo-mode')) return;
      let k = 0;
      for (const m of ms) {
        if (!m || !m.primary || !Number.isFinite(m.x) || !Number.isFinite(m.z)) continue;
        const d = Math.hypot(m.x - pp.x, m.z - pp.z);
        if (d > 34 || d < 1.2) continue;
        const a = rnd() * TAU, r = R(0.7, 1.7);
        const x = m.x + Math.cos(a) * r, z = m.z + Math.sin(a) * r;
        resetSP(); SP.kind = K.FIREFLY; SP.life = R(2.2, 3.4); SP.s0 = R(0.12, 0.18); SP.s1 = 0.06; SP.a0 = 0.95; SP.grav = 0.06; SP.drag = 0.3;
        SP.flags = F_TWINKLE; SP.bri = 1.5; SP.fout = 0.55; SP.color = PAL.firefly[(rnd() * PAL.firefly.length) | 0];
        spawn(this._add, x, groundAt(x, z) + R(0.3, 2.0), z, R(-0.25, 0.25), R(0.05, 0.25), R(-0.25, 0.25));
        if (++k >= 2) break;
      }
    },

    // ------------------------------------------------------------ 2D layer
    _layer() {
      if (this._root?.isConnected) return this._root;
      if (!document.body || !G.ui?.h) return null;
      const root = G.ui.h('div', { id: 'fx-root', class: 'fx-root', 'aria-hidden': 'true' });
      (document.getElementById('app') || document.body).appendChild(root);
      this._root = root;
      return root;
    },
    _later(fn, ms) {
      const id = setTimeout(() => { this._timers.delete(id); try { fn(); } catch (e) { G.log.warn('UI', 'fx timer', e); } }, Math.max(0, ms | 0));
      this._timers.add(id);
      return id;
    },
    _screenFrom(from) {
      const W = innerWidth, H = innerHeight;
      const fallback = { x: W / 2, y: H * 0.45 };
      if (!from) return fallback;
      if (typeof Element !== 'undefined' && from instanceof Element) {
        if (!from.isConnected) return fallback;
        const r = from.getBoundingClientRect();
        return r.width || r.height ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : fallback;
      }
      if (from.isObject3D || from.isVector3) {
        const p = from.isObject3D ? from.getWorldPosition(_pv) : _pv.copy(from);
        const s = toScreen(p);
        return s && s.x > -50 && s.x < W + 50 && s.y > -50 && s.y < H + 50 ? s : fallback;
      }
      const x = Number(from.x), y = Number(from.y);
      return Number.isFinite(x) && Number.isFinite(y) ? { x: clamp(x, 0, W), y: clamp(y, 0, H) } : fallback;
    },
    _bumpCoin(icon) {
      try { icon.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.45) rotate(-10deg)', filter: 'drop-shadow(0 0 6px rgba(255,214,90,.95))' }, { transform: 'scale(1)' }], { duration: 260, easing: 'ease-out' }); } catch (e) { /* cosmetic */ }
    },
    _startCoinOverride() {
      if (this._coinOverride) return;
      const live = Number(G.state?.stats?.coin) || 0;
      this._coinOverride = true;
      this._coinDisp = null; // first frame: start from live - pending
      this._coinText = '';
      void live;
    },
    _stepCoins(dt) {
      const fl = this._flights;
      let pending = 0;
      for (let i = fl.length - 1; i >= 0; i--) {
        const f = fl[i];
        f.t += dt;
        if (f.landed >= f.n || f.t > f.deadline) { fl.splice(i, 1); continue; }
        if (f.hold) pending += f.amount * (1 - f.landed / f.n);
      }
      if (!this._coinOverride) return;
      const el = document.getElementById('hud-coin');
      const live = Number(G.state?.stats?.coin) || 0;
      if (!el || !G.state) { this._coinOverride = false; return; }
      const target = Math.max(0, live - pending);
      if (this._coinDisp == null) this._coinDisp = target;
      this._coinDisp += (target - this._coinDisp) * Math.min(1, dt * 9);
      if (!fl.length && Math.abs(this._coinDisp - live) < 0.6) this._coinDisp = live;
      const txt = U.fmt(Math.round(this._coinDisp));
      if (txt !== this._coinText || el.textContent !== txt) { el.textContent = txt; this._coinText = txt; }
      // progression runs its own count-up tween before this system each frame: keep the number until it settles
      const prog = G.sys.progression;
      const progBusy = !!prog && typeof prog._coinShown === 'number' && prog._coinShown !== prog._coinTarget;
      this._coinIdle = fl.length ? 0 : (this._coinIdle || 0) + dt;
      if (!fl.length && this._coinDisp === live && (!progBusy || this._coinIdle > 6)) { this._coinOverride = false; this._coinDisp = null; this._coinIdle = 0; }
    },

    // ------------------------------------------------------------ level-up show
    _pumpLevelUp() {
      if (this._lu || !this._luQ.length) return;
      const q = this._luQ[0];
      // never on top of a reward popup (it shows the rewards that caused the level-up)
      const pop = document.querySelector('#reward-root .reward-pop:not(.out)');
      if (pop && q.waited < 9000) { q.waited += 350; this._later(() => this._pumpLevelUp(), 350); return; }
      this._luQ.shift();
      q.started = true;
      G.sfx('levelup');
      if (!G.state || !lv() || !this._layer()) { this._pumpLevelUp(); return; }
      this._showLevelUp(q.from, q.to);
    },
    _showLevelUp(from, to) {
      const h = G.ui.h;
      const anim = motion();
      const titles = G.data.levels?.titles || {};
      let title = null;
      for (let l = to; l > from; l--) if (titles[l]) { title = titles[l]; break; }
      const remain = G.sys.progression?.expToNext?.();
      const numEl = h('b', { class: 'fx-lu-num' }, h('span', { class: 'fx-lu-digit' }, String(anim ? Math.max(1, from) : to)));
      const mascot = this._mascotNode('cheer');
      const card = h('div', { class: 'fx-lu-card' },
        mascot ? h('div', { class: 'fx-lu-mascot' }, mascot) : null,
        h('div', { class: 'fx-lu-eyebrow' }, 'LEVEL UP'),
        h('div', { class: 'fx-lu-title' }, '레벨 업!'),
        h('div', { class: 'fx-lu-level' }, h('span', { class: 'fx-lu-lv' }, 'Lv.'), numEl),
        title ? h('div', { class: 'fx-lu-sub fx-lu-titleline' }, h('span', { class: 'emoji' }, '🏅'), ' 새 칭호 「', h('b', null, title), '」 획득!') : null,
        title && G.data.meta?.titleDisclaimer ? h('div', { class: 'fx-lu-note' }, G.data.meta.titleDisclaimer) : null,
        !title && Number.isFinite(remain) && remain > 0 ? h('div', { class: 'fx-lu-sub' }, h('span', { class: 'emoji' }, '✨'), ` 다음 레벨까지 ${U.fmt(remain)} EXP`) : null);
      // decorative (fx-root is aria-hidden): the level-up toast from progression is the accessible announcement
      const el = h('div', { class: 'fx-lu' + (anim ? '' : ' fx-static') },
        h('div', { class: 'fx-lu-flash' }), anim ? h('div', { class: 'fx-lu-rays' }) : null, h('div', { class: 'fx-lu-glow' }),
        anim ? h('div', { class: 'fx-lu-ring' }) : null, card);
      this._root.appendChild(el);
      const steps = [];
      for (let l = Math.max(1, from) + 1; l <= to; l++) steps.push(l);
      while (steps.length > 12) steps.splice(1, 1); // big jumps: skip intermediate numbers
      const L = this._lu = { el, numEl, cur: numEl.firstChild, gen: this._gen };
      const gap = steps.length > 1 ? Math.min(240, 900 / steps.length) : 0;
      const dur = anim ? 3400 : 2400;
      this._whenShown(card, () => {
        if (this._lu !== L) return;
        if (anim) steps.forEach((n, i) => this._later(() => this._luTick(L, n, i === steps.length - 1), 550 + i * gap));
        this._later(() => { if (this._lu === L) L.el.classList.add('out'); }, dur);
        this._later(() => { if (this._lu !== L) return; L.el.remove(); this._lu = null; this._pumpLevelUp(); }, dur + 500);
      });
      this._startPillar();
      if (anim && lv() > 0) this._startRain(lv() > 1 ? 130 : 50, 3.0);
      this.pulse('#f4c54a', { duration: 1600 });
    },
    /** odometer step: the old number slides up, the new one pops in */
    _luTick(L, n, last) {
      if (this._lu !== L || !L.el.isConnected) return;
      const old = L.cur;
      const nu = document.createElement('span');
      nu.className = 'fx-lu-digit';
      nu.textContent = String(n);
      L.numEl.appendChild(nu);
      L.cur = nu;
      try {
        if (old) old.animate([{ transform: 'translateY(0)', opacity: 1 }, { transform: 'translateY(-70%)', opacity: 0 }], { duration: 220, easing: 'ease-in', fill: 'forwards' }).finished.then(() => old.remove(), () => old.remove());
        nu.animate([{ transform: 'translateY(70%) scale(.8)', opacity: 0 }, { transform: 'translateY(0) scale(1.18)', opacity: 1, offset: 0.7 }, { transform: 'translateY(0) scale(1)', opacity: 1 }], { duration: last ? 420 : 220, easing: 'ease-out' });
      } catch (e) { old?.remove(); }
      if (last) { G.sfx('reward', { volume: 0.5 }); L.numEl.classList.add('fx-lu-final'); }
    },
    /** the companion mascot (G.mascot.svg) when present, else a small built-in onggi spirit; sanitised */
    _mascotNode(mood) {
      let svg = '';
      try { svg = typeof G.mascot?.svg === 'function' ? String(G.mascot.svg(mood, 92) || '') : ''; } catch (e) { svg = ''; }
      if (!/^\s*<svg[\s>]/i.test(svg) || svg.length > 60000) svg = FALLBACK_MASCOT;
      const tpl = document.createElement('template');
      tpl.innerHTML = svg;
      const node = tpl.content.firstElementChild;
      if (!node || node.tagName.toLowerCase() !== 'svg') return null;
      // defence in depth: strip anything executable from the markup
      node.querySelectorAll('script,foreignObject,iframe,object,embed,a,use[href^="http"],image').forEach((n) => n.remove());
      for (const n of [node, ...node.querySelectorAll('*')]) {
        for (const at of Array.from(n.attributes)) {
          const nm = at.name.toLowerCase(), v = at.value.replace(/\s+/g, '').toLowerCase();
          if (nm.startsWith('on') || ((nm === 'href' || nm === 'xlink:href') && !v.startsWith('#')) || v.includes('javascript:')) n.removeAttribute(at.name);
        }
      }
      node.setAttribute('aria-hidden', 'true');
      node.setAttribute('focusable', 'false');
      return node;
    },

    // ------------------------------------------------------------ 2D confetti rain (one lazy canvas)
    _startRain(n, dur) {
      if (!this._layer()) return;
      let R0 = this._rain;
      if (!R0) {
        const canvas = document.createElement('canvas');
        canvas.className = 'fx-rain';
        canvas.setAttribute('aria-hidden', 'true');
        R0 = this._rain = { canvas, ctx: canvas.getContext('2d'), parts: [], active: false, t: 0, dur: 0, dpr: 1 };
      }
      if (!R0.ctx) return;
      if (!R0.canvas.isConnected) this._root.appendChild(R0.canvas);
      R0.canvas.hidden = false;
      this._sizeRain();
      const W = innerWidth;
      const cols = ['#e0453a', '#f4c54a', '#2f7de1', '#f7f4ea', '#34c36b', '#ff7eb6', '#a07dff', '#ff9f43'];
      n = Math.min(n, 220 - R0.parts.length);
      for (let i = 0; i < n; i++) {
        R0.parts.push({ x: R(0, W), y: R(-innerHeight * 0.6, -10), vx: R(-50, 50), vy: R(60, 200), w: R(7, 13), h: R(4, 8), rot: R(0, TAU), vr: R(-6, 6), ph: R(0, TAU), phs: R(5, 12), c: cols[(rnd() * cols.length) | 0], round: rnd() < 0.25, sway: R(15, 45) });
      }
      R0.active = true; R0.t = 0; R0.dur = Math.max(R0.dur - R0.t, dur);
    },
    _sizeRain() {
      const R0 = this._rain;
      if (!R0) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      R0.dpr = dpr;
      const w = Math.round(innerWidth * dpr), hh = Math.round(innerHeight * dpr);
      if (R0.canvas.width !== w || R0.canvas.height !== hh) { R0.canvas.width = w; R0.canvas.height = hh; }
    },
    _stepRain(dt) {
      const R0 = this._rain, ctx = R0.ctx, H = innerHeight;
      R0.t += dt;
      const fade = R0.t > R0.dur - 0.6 ? clamp((R0.dur - R0.t) / 0.6, 0, 1) : 1;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, R0.canvas.width, R0.canvas.height);
      ctx.setTransform(R0.dpr, 0, 0, R0.dpr, 0, 0);
      ctx.globalAlpha = fade;
      const ps = R0.parts;
      let w = 0;
      for (let i = 0; i < ps.length; i++) {
        const p = ps[i];
        p.vy = Math.min(p.vy + 240 * dt, 260);
        p.x += (p.vx + Math.sin(R0.t * 2.2 + p.ph) * p.sway) * dt; p.y += p.vy * dt;
        p.rot += p.vr * dt; p.ph += p.phs * dt;
        if (p.y > H + 30) continue;
        ps[w++] = p;
        const sx = Math.cos(p.ph);
        ctx.save();
        ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.scale(sx, 1);
        ctx.fillStyle = p.c;
        if (sx < 0) ctx.globalAlpha = fade * 0.75;
        if (p.round) { ctx.beginPath(); ctx.arc(0, 0, p.h * 0.6, 0, TAU); ctx.fill(); }
        else ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx.restore();
      }
      ps.length = w;
      ctx.globalAlpha = 1;
      if (R0.t >= R0.dur || !ps.length) this._stopRain();
    },
    _stopRain() {
      const R0 = this._rain;
      if (!R0) return;
      R0.active = false; R0.parts.length = 0; R0.t = 0; R0.dur = 0;
      if (R0.ctx) { R0.ctx.setTransform(1, 0, 0, 1, 0, 0); R0.ctx.clearRect(0, 0, R0.canvas.width, R0.canvas.height); }
      R0.canvas.hidden = true;
    },

    /** run fn once the element's CSS animations have really started (or after 4 s / immediately without WAAPI) */
    _whenShown(el, fn) {
      let done = false;
      const go = () => { if (!done) { done = true; fn(); } };
      try {
        const list = typeof el.getAnimations === 'function' ? el.getAnimations({ subtree: true }) : [];
        if (list.length) {
          Promise.all(list.map((a) => a.ready)).then(go, go);
          this._later(go, 4000);
          return;
        }
      } catch (e) { /* fall through */ }
      go();
    },
    _killStamp() { if (this._stampEl) { this._stampEl.remove(); this._stampEl = null; } },

    // ------------------------------------------------------------ reset
    _reset() {
      this._gen++;
      for (const id of this._timers) clearTimeout(id);
      this._timers.clear();
      this.clear();
      this._luQ.length = 0;
      if (this._lu) { this._lu.el.remove(); this._lu = null; }
      this._killStamp();
      this._pendingStamp = null;
      this._flights.length = 0;
      if (this._coinOverride) {
        this._coinOverride = false; this._coinDisp = null;
        const el = document.getElementById('hud-coin');
        if (el && G.state?.stats) el.textContent = U.fmt(G.state.stats.coin || 0);
      }
      if (this._root) this._root.querySelectorAll('.fx-coin').forEach((n) => n.remove());
      this._coinEls = 0;
      this._lastFarm = null;
      this._airVy = 0; this._wasAir = false;
    },

    _applyBodyClass() {
      const b = document.body;
      if (!b) return;
      const l = lv();
      b.classList.toggle('fx-off', l === 0);
      b.classList.toggle('fx-low', l === 1);
      b.classList.toggle('fx-high', l === 2);
    },

    // ------------------------------------------------------------ event wiring
    _bindEvents() {
      const live = () => !!G.state && G.ready !== false;
      const on = (name, fn) => this._offs.push(G.bus.on(name, (p) => { if (!live()) return; try { fn(p || {}); } catch (e) { G.log.warn('UI', `fx handler ${name}`, e); } }));
      const quiet = () => pnow() < this._quietUntil;

      this._offs.push(G.bus.on('settings:changed', ({ key } = {}) => {
        if (key !== 'fxLevel' && key !== 'reduceMotion') return;
        this._applyBodyClass();
        if (!lv()) { this.clear(); this._luQ.length = 0; }
      }));

      on('level:up', ({ level }) => { this.levelUp(level); });

      on('quest:completed', ({ questId }) => {
        if (pnow() < this._questQuietUntil) return;
        const q = G.data.quests?.[questId];
        // several objectives can finish in the same tick: one stamp
        if (this._pendingStamp) { this._pendingStamp.count++; return; }
        this._pendingStamp = { count: 1, title: q?.title || '' };
        this._later(() => {
          const ps = this._pendingStamp;
          this._pendingStamp = null;
          if (!ps || !G.state) return;
          this.stamp('완료!', { sub: ps.count > 1 ? `퀘스트 ${ps.count}개 완료` : ps.title });
          this.pulse('#34c36b', { duration: 1200 });
          this.burst('sparkle', null, { count: 18, lift: 1.2 });
        }, 120);
      });

      on('quest:claimed', ({ questId }) => {
        const q = G.data.quests?.[questId];
        this.burst('confetti', null, { count: q?.category === 'main' ? 60 : 38 });
        this.burst('stars', null, { count: 12 });
        if (q?.category === 'main' && motion()) this._later(() => this._startRain(lv() > 1 ? 80 : 30, 2.2), 250);
      });

      on('achievement:unlocked', ({ id }) => {
        if (quiet()) return;
        const a = G.data.achievements?.[id];
        this.burst('stars', null, { count: 16, lift: 1.3 });
        this.emojiQueued(null, a?.icon || '🏆', { scale: 1.1, rise: 1.3 });
        this.pulse('#f4c54a', { duration: 1100 });
        // glossy sweep over the achievement toast once it is on screen (toasts are queued)
        let tries = 0;
        const find = () => {
          const t = Array.from(document.querySelectorAll('#toast-root .toast.ach-toast:not([data-fx-shine])')).pop();
          if (t) { t.setAttribute('data-fx-shine', '1'); this.shine(t, { delay: 120, duration: 1200 }); return; }
          if (++tries < 12) this._later(find, 250);
        };
        this._later(find, 60);
      });

      on('collection:unlocked', ({ id }) => {
        if (quiet()) return;
        const c = G.data.collection?.[id];
        this.emojiQueued(null, c?.icon || '📖', { scale: 0.85, rise: 1.0 });
        this.burst('sparkle', null, { count: 8, lift: 1.6 });
      });

      const plotPos = (plotId, out) => {
        const o = G.world?.getObject?.(plotId);
        if (o) { o.getWorldPosition(out); out.y = groundAt(out.x, out.z) + 0.35; return out; }
        const a = G.world?.anchor?.(plotId);
        if (a && Number.isFinite(a.x) && Number.isFinite(a.z)) return out.set(a.x, groundAt(a.x, a.z) + 0.35, a.z);
        return null;
      };
      /** point on the plot bed nearest the player (the plot's DOM stat label floats over the centre) */
      const plotFront = (plotId, out) => {
        const a = G.world?.anchor?.(plotId);
        const p = G.sys.player?.position;
        if (!a || !p || !Number.isFinite(a.x) || !Number.isFinite(a.z)) return plotPos(plotId, out);
        const hw = (Number(a.w) || 6) * 0.38, hd = (Number(a.d) || 6) * 0.38;
        const x = a.x + clamp(p.x - a.x, -hw, hw), z = a.z + clamp(p.z - a.z, -hd, hd);
        return out.set(x, groundAt(x, z) + 0.35, z);
      };
      const near = (v, r = 45) => { const p = G.sys.player?.position; return !p || Math.hypot(v.x - p.x, v.z - p.z) < r; };

      on('farm:watered', ({ plotId }) => {
        const v = plotPos(plotId, new THREE.Vector3());
        if (!v || !near(v)) return;
        // farming already pours droplets: add the soak ripple when the water lands
        this._later(() => { if (G.state) this.ripple(v, { color: '#8fd3ff', radius: 2.4, duration: 1.1, rings: 2 }); }, 900);
      });
      on('farm:planted', ({ plotId }) => {
        const v = plotFront(plotId, new THREE.Vector3());
        if (!v || !near(v)) return;
        this.emoji3d(v, '🌱', { scale: 0.9, rise: 0.8, offsetY: 0.3 });
      });
      on('farm:harvested', ({ plotId, itemId }) => {
        const v = plotFront(plotId, new THREE.Vector3());
        if (!v) return;
        this._lastFarm = { v: v.clone(), t: pnow() };
        if (!near(v)) return;
        // farming pops leaves + sparks: add the item itself popping out
        this.emoji3d(v, G.data.items?.[itemId]?.icon || '🧺', { scale: 1.15, rise: 1.3, offsetY: 0.35, duration: 1.8 });
        this.burst('stars', v, { count: 6, lift: 0.9, spread: 0.7 });
      });

      on('ferment:claimed', ({ jarId, itemId }) => {
        const o = G.world?.getObject?.(jarId);
        const v = new THREE.Vector3();
        if (o) o.getWorldPosition(v); else if (!playerPos(v)) return;
        v.y = groundAt(v.x, v.z, v.y + 2);
        if (!near(v)) return;
        // fermentation already sparkles the jar: add the product + a golden ground ring
        this.emoji3d(o || v, G.data.items?.[itemId]?.icon || '🏺', { scale: 1.15, rise: 1.4, duration: 2 });
        this.ripple(v, { color: '#ffd166', radius: 1.8, rings: 2 });
        this.burst('stars', v, { count: 10, lift: 1.4, spread: 0.8 });
      });

      on('craft:done', ({ craftId }) => {
        const c = G.data.crafts?.[craftId];
        const ct = G.data.layout?.craftTable;
        if (!c || !ct || !Number.isFinite(ct.x)) return;
        const v = new THREE.Vector3(ct.x, groundAt(ct.x, ct.z) + 1.0, ct.z);
        if (!near(v, 30)) return;
        const outId = Object.keys(c.out || {})[0];
        this.emoji3d(v, G.data.items?.[outId]?.icon || c.icon || '✨', { scale: 1, rise: 1.2, offsetY: 0.2 });
      });

      on('emote:played', ({ emoteId }) => {
        const head = headPos(null, new THREE.Vector3(), 0.1);
        if (!head) return;
        const ground = this._ev.set(head.x, head.y - 1.0, head.z);
        switch (emoteId) {
          case 'EMO_LIKE': this.burst('hearts', ground, { count: 9, lift: 1.0, spread: 0.8 }); break;
          case 'EMO_CLAP': case 'EMO_WELCOME': this.burst('confetti', ground, { count: 18, lift: 0.9, spread: 0.6, up: 0.7 }); this.burst('sparkle', ground, { count: 8, lift: 1.0 }); break;
          case 'EMO_THUMBS': this.burst('stars', ground, { count: 8, lift: 1.0, spread: 0.6 }); break;
          case 'EMO_WOW': this.burst('stars', ground, { count: 10, lift: 1.1, spread: 0.9 }); break;
          case 'EMO_SMILE': case 'EMO_LAUGH': this.burst('hearts', ground, { count: 4, lift: 1.0, spread: 0.5 }); this.burst('sparkle', ground, { count: 6, lift: 1.0 }); break;
          default: this.burst('sparkle', ground, { count: 8, lift: 1.0 });
        }
      });
      on('gesture:played', ({ gestureId }) => {
        if (gestureId !== 'GES_DANCE') return;
        const p = playerPos(new THREE.Vector3());
        if (p) this._notes(p, 6);
      });

      on('reward:granted', ({ reward, reason }) => {
        const coin = Math.floor(Number(reward?.coin) || 0);
        if (!(coin > 0) || !lv()) return;
        const why = String(reason || '');
        const popup = !/^harvest|^achievement:/.test(why) && !!document.querySelector('#reward-root .reward-pop:not(.out)');
        // hold the HUD number right away (progression already added the coins), launch a beat later
        const hold = { amount: coin, n: 1, landed: 0, t: 0, deadline: 1.2, hold: true, placeholder: true };
        const hudVisible = !document.body.classList.contains('hud-hidden') && !document.getElementById('hud')?.hidden;
        if (hudVisible && motion()) { this._flights.push(hold); this._startCoinOverride(); }
        this._later(() => {
          const i = this._flights.indexOf(hold);
          if (i >= 0) this._flights.splice(i, 1);
          if (!G.state) return;
          let from = null;
          if (popup) from = document.querySelector('#reward-root .reward-pop:not(.out) .rp-item [data-icon="coin"]') || document.querySelector('#reward-root .reward-pop:not(.out)');
          else if (/^harvest/.test(why) && this._lastFarm && pnow() - this._lastFarm.t < 600) from = this._lastFarm.v;
          else if (/^achievement:/.test(why)) from = { x: innerWidth / 2, y: Math.min(innerHeight * 0.2, 140) };
          else { const hp = headPos(null, new THREE.Vector3(), 0); from = hp || null; }
          this.coinFly(from, coin);
        }, popup ? 380 : 60);
      });
    },

    /** music notes for the dance gesture */
    _notes(p, n) {
      if (!lv() || !this._ensure3D()) return;
      n = Math.max(1, Math.round(n * mult()));
      for (let k = 0; k < n; k++) {
        resetSP(); SP.kind = K.NOTE; SP.life = R(1.3, 1.9); SP.s0 = R(0.22, 0.32); SP.s1 = 0.2; SP.grav = 0.5; SP.drag = 1.2; SP.flags = F_WOBBLE;
        SP.delay = k * 0.18; SP.color = PAL.confetti[(rnd() * PAL.confetti.length) | 0];
        const a = rnd() * TAU;
        spawn(this._normal, p.x + Math.cos(a) * 0.4, p.y + R(1.3, 1.7), p.z + Math.sin(a) * 0.4, Math.cos(a) * 0.5, R(0.8, 1.3), Math.sin(a) * 0.5);
      }
    },
  };

  // ---------------------------------------------------------------- burst types
  const EMO_CAP = 40;
  const ALIAS = dict({
    confetti: 'confetti', sparkle: 'sparkle', sparkles: 'sparkle', glitter: 'sparkle', hearts: 'hearts', heart: 'hearts', leaves: 'leaves', leaf: 'leaves',
    coins: 'coins', coin: 'coins', stars: 'stars', star: 'stars', firework: 'stars', fireworks: 'stars', dust: 'dust', splash: 'splash', water: 'splash',
    petals: 'petals', petal: 'petals', flowers: 'petals',
  });
  const pick = (arr) => arr[(rnd() * arr.length) | 0];
  /** G.ffx originals (un-gated) for this module's own already-scaled spawns */
  let ffxRaw = null;

  const TYPES = {
    confetti: { n: 46, lift: 1.7, fn(x, y, z, n, o) {
      let k = 0;
      for (let i = 0; i < n; i++) {
        resetSP();
        const r = rnd();
        SP.kind = r < 0.62 ? K.RECT : r < 0.86 ? K.DOT : K.RIBBON;
        SP.life = R(1.8, 2.8); SP.s0 = SP.s1 = (SP.kind === K.RIBBON ? R(0.22, 0.3) : R(0.12, 0.19)) * o.size;
        SP.grav = -7.5; SP.drag = 1.1; SP.flags = F_FLIP | F_FLUTTER | F_SETTLE; SP.phs = R(6, 14); SP.spin = R(-4, 4); SP.floor = o.gy + 0.03; SP.fout = 0.72;
        SP.color = o.col || pick(PAL.confetti);
        const a = rnd() * TAU, s = R(0.6, 3.2) * o.spread;
        if (spawn(this._normal, x + R(-0.15, 0.15), y + R(-0.1, 0.2), z + R(-0.15, 0.15), Math.cos(a) * s, R(3.2, 6.4) * o.up, Math.sin(a) * s) >= 0) k++;
      }
      return k;
    } },
    hearts: { n: 12, lift: 1.5, fn(x, y, z, n, o) {
      let k = 0;
      for (let i = 0; i < n; i++) {
        resetSP(); SP.kind = K.HEART; SP.life = R(1.1, 1.7); SP.s0 = R(0.2, 0.32) * o.size; SP.s1 = SP.s0 * 0.85; SP.grav = 0.9; SP.drag = 1.8; SP.flags = F_WOBBLE; SP.color = o.col || pick(PAL.hearts);
        const a = rnd() * TAU, s = R(0.3, 1.1) * o.spread;
        if (spawn(this._normal, x, y + R(0, 0.3), z, Math.cos(a) * s, R(1.0, 2.2) * o.up, Math.sin(a) * s) >= 0) k++;
      }
      // a soft pink glow behind them
      resetSP(); SP.kind = K.GLOW; SP.life = 0.7; SP.s0 = 0.4; SP.s1 = 1.4 * o.size; SP.a0 = 0.45; SP.drag = 0; SP.color = o.col || PAL.hearts[2];
      spawn(this._add, x, y + 0.2, z, 0, 0.3, 0);
      return k;
    } },
    coins: { n: 12, lift: 1.1, fn(x, y, z, n, o) {
      let k = 0;
      for (let i = 0; i < n; i++) {
        resetSP(); SP.kind = K.COIN; SP.life = R(1.5, 2.1); SP.s0 = SP.s1 = R(0.2, 0.26) * o.size; SP.grav = -11; SP.drag = 0.6; SP.flags = F_COIN | F_BOUNCE | F_SETTLE;
        SP.phs = R(8, 14); SP.spin = 0; SP.rot = R(-0.25, 0.25); SP.floor = o.gy + 0.12; SP.fout = 0.75; SP.color = PAL.white[0]; SP.bri = 1.05;
        const a = rnd() * TAU, s = R(0.6, 2.0) * o.spread;
        if (spawn(this._normal, x, y + R(0, 0.2), z, Math.cos(a) * s, R(3.6, 5.8) * o.up, Math.sin(a) * s) >= 0) k++;
      }
      for (let i = 0; i < Math.ceil(n / 3); i++) { // glints
        resetSP(); SP.kind = K.SPARK; SP.life = R(0.5, 0.9); SP.s0 = R(0.18, 0.28); SP.s1 = 0; SP.grav = -1; SP.drag = 2; SP.bri = 1.5; SP.color = PAL.stars[0];
        const a = rnd() * TAU; spawn(this._add, x, y + R(0, 0.4), z, Math.cos(a) * 1.4, R(1, 2.5), Math.sin(a) * 1.4);
      }
      return k;
    } },
    stars: { n: 18, lift: 1.1, fn(x, y, z, n, o) {
      let k = 0;
      for (let i = 0; i < n; i++) {
        resetSP(); SP.kind = rnd() < 0.7 ? K.STAR : K.SPARK; SP.life = R(0.9, 1.4); SP.s0 = R(0.2, 0.34) * o.size; SP.s1 = 0.02; SP.grav = -1.6; SP.drag = 2.0;
        SP.flags = F_TWINKLE; SP.spin = R(-3, 3); SP.bri = 1.55; SP.color = o.col || pick(PAL.stars);
        const a = rnd() * TAU, s = R(1.2, 3.4) * o.spread;
        if (spawn(this._add, x, y + R(-0.1, 0.3), z, Math.cos(a) * s, R(1.2, 3.4) * o.up, Math.sin(a) * s) >= 0) k++;
      }
      resetSP(); SP.kind = K.GLOW; SP.life = 0.5; SP.s0 = 0.3; SP.s1 = 2.2 * o.size; SP.a0 = 0.55; SP.drag = 0; SP.bri = 1.2; SP.color = o.col || PAL.stars[0];
      spawn(this._add, x, y + 0.2, z, 0, 0, 0);
      return k;
    } },
    sparkle: { n: 20, lift: 0.7, fn(x, y, z, n, o) {
      const P = G.ffx?.P;
      if (ffxRaw && P) {
        ffxRaw.burst(P.SPARK, x, y, z, n, 1.3 * o.spread, 1.6 * o.up, o.col ? _c2.copy(o.col) : null);
        ffxRaw.burst(P.GLINT, x, y + 0.2, z, Math.max(1, Math.ceil(n / 4)), 0.6 * o.spread, 0.6 * o.up);
        return n;
      }
      let k = 0;
      for (let i = 0; i < n; i++) {
        resetSP(); SP.kind = K.SPARK; SP.life = R(0.7, 1.1); SP.s0 = R(0.14, 0.22) * o.size; SP.s1 = 0; SP.grav = 0.35; SP.drag = 0.9; SP.spin = R(-1.5, 1.5); SP.bri = 1.5; SP.color = o.col || pick(PAL.sparkle);
        const a = rnd() * TAU, s = R(0.4, 1.3) * o.spread;
        if (spawn(this._add, x, y, z, Math.cos(a) * s, R(0.9, 1.9) * o.up, Math.sin(a) * s) >= 0) k++;
      }
      return k;
    } },
    leaves: { n: 14, lift: 0.4, fn(x, y, z, n, o) {
      const P = G.ffx?.P;
      if (ffxRaw && P) { ffxRaw.burst(P.LEAF, x, y, z, n, 1.8 * o.spread, 2.4 * o.up, o.col ? _c2.copy(o.col) : null, o.gy); return n; }
      return ownSimple.call(this, this._normal, K.LEAF, PAL.leaves, x, y, z, n, o, { life: 1.35, s: 0.19, grav: -3, drag: 1.5, spin: 7, sp: 1.8, up: 2.4 });
    } },
    dust: { n: 12, lift: 0.05, fn(x, y, z, n, o) {
      const P = G.ffx?.P;
      if (ffxRaw && P) { ffxRaw.burst(P.DUST, x, y, z, n, 1.0 * o.spread, 0.9 * o.up, o.col ? _c2.copy(o.col) : null); return n; }
      return ownSimple.call(this, this._normal, K.PUFF, PAL.dust, x, y, z, n, o, { life: 0.85, s: 0.12, s1: 0.4, a0: 0.5, grav: -0.5, drag: 2.6, spin: 0.5, sp: 1.0, up: 0.9 });
    } },
    splash: { n: 16, lift: 0.1, fn(x, y, z, n, o) {
      const P = G.ffx?.P;
      if (ffxRaw && P) {
        ffxRaw.burst(P.DROP, x, y + 0.1, z, n, 1.6 * o.spread, 2.6 * o.up, o.col ? _c2.copy(o.col) : null, o.gy);
        ffxRaw.burst(P.SPLASH, x, o.gy + 0.04, z, 6, 0.9 * o.spread, 0.1);
        return n;
      }
      const k = ownSimple.call(this, this._normal, K.DROP, PAL.splash, x, y, z, n, o, { life: 0.9, s: 0.12, s1: 0.08, grav: -8, drag: 0.4, spin: 0, sp: 1.6, up: 2.6 });
      this.ripple({ x, y: o.gy, z }, { color: '#cfe9ff', radius: 0.9 * o.spread, rings: 1, duration: 0.6 });
      return k;
    } },
    petals: { n: 16, lift: 1.2, fn(x, y, z, n, o) {
      const P = G.ffx?.P;
      if (ffxRaw && P) { ffxRaw.burst(P.PETAL, x, y, z, n, 1.2 * o.spread, 2.0 * o.up, o.col ? _c2.copy(o.col) : null, o.gy); return n; }
      return ownSimple.call(this, this._normal, K.PETAL, PAL.petals, x, y, z, n, o, { life: 1.8, s: 0.12, grav: -1.4, drag: 1.6, spin: 5, sp: 1.2, up: 2.0, flutter: true });
    } },
  };
  function ownSimple(P, kind, pal, x, y, z, n, o, d) {
    let k = 0;
    for (let i = 0; i < n; i++) {
      resetSP(); SP.kind = kind; SP.life = d.life * R(0.8, 1.2); SP.s0 = d.s * o.size * R(0.8, 1.2); SP.s1 = d.s1 != null ? d.s1 * o.size : SP.s0 * 0.7;
      SP.a0 = d.a0 || 1; SP.grav = d.grav; SP.drag = d.drag; SP.spin = R(-d.spin, d.spin); SP.floor = o.gy + 0.02; SP.color = o.col || pick(pal);
      if (d.flutter) SP.flags = F_FLUTTER | F_FLIP; if (d.flutter) SP.phs = R(4, 9);
      const a = rnd() * TAU, s = d.sp * o.spread * R(0.35, 1);
      if (spawn(P, x + R(-0.08, 0.08), y + R(0, 0.1), z + R(-0.08, 0.08), Math.cos(a) * s, d.up * o.up * R(0.6, 1.2), Math.sin(a) * s) >= 0) k++;
    }
    return k;
  }

  // ---------------------------------------------------------------- fallback mascot (small onggi spirit, static markup)
  const FALLBACK_MASCOT = '<svg viewBox="0 0 100 100" width="92" height="92" xmlns="http://www.w3.org/2000/svg">'
    + '<defs><radialGradient id="fxm-b" cx="38%" cy="32%" r="75%"><stop offset="0" stop-color="#a8683f"/><stop offset=".65" stop-color="#6e3f22"/><stop offset="1" stop-color="#4a2814"/></radialGradient></defs>'
    + '<ellipse cx="50" cy="93" rx="26" ry="4.5" fill="rgba(0,0,0,.25)"/>'
    + '<path d="M30 30c-14 12-15 40-2 56 6 6 38 6 44 0 13-16 12-44-2-56z" fill="url(#fxm-b)"/>'
    + '<ellipse cx="50" cy="28" rx="21" ry="6.5" fill="#3b2213"/><ellipse cx="50" cy="25" rx="17" ry="5" fill="#5a3520"/>'
    + '<path d="M30 46h40" stroke="#f4c54a" stroke-width="2.4" stroke-linecap="round" opacity=".85"/>'
    + '<path d="M38 58q4-5 8 0M54 58q4-5 8 0" stroke="#2a1608" stroke-width="2.6" fill="none" stroke-linecap="round"/>'
    + '<path d="M42 66q8 8 16 0" stroke="#2a1608" stroke-width="2.6" fill="#ff8f8f" stroke-linecap="round"/>'
    + '<ellipse cx="35" cy="64" rx="4.5" ry="2.6" fill="#ff8f8f" opacity=".6"/><ellipse cx="65" cy="64" rx="4.5" ry="2.6" fill="#ff8f8f" opacity=".6"/>'
    + '<path d="M22 50l-10-12M78 50l10-12" stroke="#6e3f22" stroke-width="5" stroke-linecap="round"/>'
    + '<path d="M10 33l3 3M14 30l1 4M88 33l-3 3M84 30l-1 4" stroke="#f4c54a" stroke-width="2" stroke-linecap="round"/>'
    + '<ellipse cx="38" cy="40" rx="4" ry="9" fill="#fff" opacity=".14"/></svg>';

  // ---------------------------------------------------------------- one particle API: gate G.ffx by fxLevel
  (function gateFfx() {
    const F = G.ffx;
    if (!F || F.__fxGated || typeof F.burst !== 'function' || typeof F.spawn !== 'function') return;
    const oBurst = F.burst, oSpawn = F.spawn;
    ffxRaw = { burst: oBurst, spawn: oSpawn };
    const P = F.P || {};
    const keep = new Set([P.DROP, P.SPLASH, P.STEAM, P.BUBBLE].filter(Boolean)); // functional feedback / jar status
    const scale = (pr) => { if (keep.has(pr)) return 1; const l = lv(); return l === 2 ? 1 : l === 1 ? 0.5 : 0; };
    F.burst = function (pr, x, y, z, n, speed, up, color, floorY) {
      const s = scale(pr);
      if (s <= 0) return;
      return oBurst.call(F, pr, x, y, z, s >= 1 ? n : Math.max(1, Math.round((n || 0) * s)), speed, up, color, floorY);
    };
    F.spawn = function (pr, x, y, z, vx, vy, vz, color, floorY) {
      const s = scale(pr);
      if (s <= 0 || (s < 1 && rnd() > s)) return -1;
      return oSpawn.call(F, pr, x, y, z, vx, vy, vz, color, floorY);
    };
    F.__fxGated = true;
  })();

  // public API object (exists before init so other modules can feature-detect it)
  G.fx = {
    burst: (a, b, c) => fx.burst(a, b, c),
    emoji3d: (t, e, o) => fx.emoji3d(t, e, o),
    ripple: (p, o) => fx.ripple(p, o),
    levelUp: (l, o) => fx.levelUp(l, o),
    stamp: (t, o) => fx.stamp(t, o),
    coinFly: (f, a, o) => fx.coinFly(f, a, o),
    pulse: (c, o) => fx.pulse(c, o),
    shimmerExp: () => fx.shimmerExp(),
    shine: (el, o) => fx.shine(el, o),
    level: () => fx.level(),
    enabled: () => fx.enabled(),
    clear: () => fx.clear(),
    stats: () => fx.stats(),
  };
  Object.freeze(G.fx);

  G.register(fx);
})();
