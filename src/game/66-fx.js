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
//   G.fx.kidParty(pos?, {rain=true, burst=true, emoji})                 쉬운 모드 celebration: confetti + stars + hearts
//        in 3D and a soft 2D rain of stars / hearts / confetti (auto-added to every G.easy.celebrate pop)
//   G.fx.portal(pos?, {mode:'in'|'out'})                                teleport / travel portal: dissolving light column
//        + rune disc + spiral sparks (auto-played on every teleport arrival of the player)
//   G.fx.pillar(pos?, {kind:'quest'|'level'})                           light pillar + falling star shower
//   G.fx.zoneBanner(zoneId)                                             3D hanging name board (현판) on a first visit
//   G.fx.itemFly(from, itemId|emoji, {qty})                             3D pop + arc into the 🎒 가방 tile
//
// Phase 4 character motion (CONTRACT §13.4, tuned for WALK 9.6 / RUN 18 m/s from G.sys.player):
//   sprint speed lines (one instanced clip-space draw, animated in the vertex shader — no per-frame uploads)
//   + a soft sprint vignette (engine.grade layer 'fx-sprint'), additive afterimages (the player's own skinned
//   mesh re-drawn at its recent positions with a rim shader), a soft ground ribbon behind the feet, pooled
//   footprint decals (64, fade in the shader by birth time, aligned to the slope, coloured by surface /
//   rain / snow), kick-off / skid / landing dust with a dust shock ring, a teleport portal on every arrival,
//   a 3D zone banner on first visits, a quest-complete light pillar, 3D coins that hand over to the 2D HUD
//   flight. Off: fxLevel 'off'. Low: fewer lines, one afterimage, short-lived prints. reduceMotion: no speed
//   lines / afterimages / ribbon / swing (portal & banner just fade). Hidden during the 만장대 intro / tour,
//   photo mode, dialogue camera and any non-follow camera.
//
// 쉬운 모드 & photosensitivity (CONTRACT §12.4): nothing flashes faster than 3 Hz — edge pulses are merged
// (≥ 0.7 s apart) and eased, the level-up light eases in over ~0.6 s, light rays turn slowly (≤ 1.2 Hz stripe
// rate; kid ≤ 0.9 Hz), star twinkle ≈ 1.7 Hz; no camera shake for children; prefers-reduced-motion counts like
// the reduceMotion setting. Kid texts: level-up = "쑥쑥 컸어요!" + ⭐ number (no "LEVEL UP"/EXP), quest stamp =
// "참 잘했어요!".
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

  // the OS-level "reduce motion" wish counts like the in-game setting (cached query, live `matches`)
  let RMQ = null;
  try { RMQ = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null; } catch (e) { RMQ = null; }
  const osReduce = () => !!(RMQ && RMQ.matches);
  /** 0 off, 1 low, 2 high (reduceMotion caps at 1) */
  function lv() {
    let l = LEVEL_NAMES.indexOf(G.settings ? G.settings.fxLevel : DEFAULT_LEVEL);
    if (l < 0) l = LEVEL_NAMES.indexOf(DEFAULT_LEVEL);
    if (l > 1 && ((G.settings && G.settings.reduceMotion) || osReduce())) l = 1;
    return l;
  }
  const mult = () => { const l = lv(); return l === 2 ? 1 : l === 1 ? 0.45 : 0; };
  const motion = () => !(G.settings && G.settings.reduceMotion) && !osReduce();
  const kidOn = () => !!(G.easy ? G.easy.on : G.settings?.easyMode !== false);

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
  const SURFACE_DUST = dict({ grass: C('#d4dbb8'), road: C('#c9c4bb'), stone: C('#cfc8bb'), dirt: C('#a5835e'), wood: C('#b49470'), sand: C('#e2d2a8') });
  const _c1 = new THREE.Color(), _c2 = new THREE.Color();

  // ---------------------------------------------------------------- positions
  const _pv = new THREE.Vector3(), _pv2 = new THREE.Vector3(), _hv = new THREE.Vector3(), _kv = new THREE.Vector3();
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
        if (k < 0.12) { const q = k / 0.12; size *= 1 + 2 * (q - 1) * (q - 1) * (q - 1) + (q - 1) * (q - 1); } // ease-out-back pop (peak +3.7 %)
      }
      if (fl & F_TWINKLE) size *= 0.72 + 0.28 * Math.sin(life * 11 + P.ph[i]);   // ≈ 1.7 Hz: well under the 3 Hz flash limit
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
    _pulseAt: -1e9, _partyAt: -1e9, _itemEls: 0, _itemAt: 0,

    // ------------------------------------------------------------ lifecycle
    init() {
      // the lazily made FX meshes are built now, hidden: engine.postInit precompiles every scene material behind the
      // loader, so the first teleport portal, zone board or level-up pillar does not stall a frame linking a shader
      // (the motion ghosts need the player rig and stay lazy)
      if (this._ensure3D()) {
        try { this._buildPillar(); CM.build(); } catch (e) { G.log.warn('UI', 'fx prebuild failed', e?.message || e); }
      }
      this._bindEvents();
      this._applyBodyClass();
      // every G.easy.celebrate pop gets the kid party (08-easy emits easy:celebrate, CONTRACT §12.5)
      G.bus.on('easy:celebrate', (e) => { if (!e?.reduced) this._onCelebrate(); });
      // the OS "reduce motion" switch can flip while playing: keep the fx-* body classes in step
      try { RMQ?.addEventListener?.('change', () => { this._applyBodyClass(); if (osReduce()) this._stopRain(); }); } catch (e) { /* old engines */ }
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
      // phase-4 character motion (speed lines, afterimages, ribbon, prints, portal, banner) — hides itself when off
      if (ok) { try { CM.update(dt, t, G.state ? lv() : 0); } catch (e) { G.log.warn('UI', 'fx motion', e); CM.hideAll(); } }
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
      const kid = kidOn();
      const el = h('div', { class: 'fx-stamp-wrap' + (motion() ? '' : ' fx-static') + (kid ? ' fx-kid' : ''), 'aria-hidden': 'true' },
        h('div', { class: 'fx-stamp' }, kid ? h('span', { class: 'fx-stamp-star emoji' }, '⭐') : null, h('span', { class: 'fx-stamp-text' }, txt), sub ? h('span', { class: 'fx-stamp-sub' }, sub) : null),
        h('div', { class: 'fx-stamp-ink' }));
      el.style.setProperty('--fx-stamp', color);
      this._root.appendChild(el);
      this._stampEl = el;
      const dur = clamp(Number(opts.duration) || 1900, 900, 5000);
      // the lifetime starts when the stamp is actually painted (slow devices commit frames late)
      this._whenShown(el, () => {
        if (this._stampEl !== el) return;
        // no camera shake for children (motion sickness); a soft 'stamp' thud instead of the pop
        this._later(() => { if (this._stampEl === el) { G.sfx(kid ? 'stamp' : 'pop', { volume: 1 }); if (!kid && motion() && G.settings.cameraShake !== false) G.sys.camera?.shake?.(0.06); } }, motion() ? 230 : 0);
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
      // 3D hand-over: from a world point the coins first burst up as spinning 3D 엽전, then each one continues as a
      // 2D coin from where its 3D twin is on screen (analytic ballistic position at the hand-over time)
      const w3 = from && (from.isVector3 || from.isObject3D) && this._ensure3D() ? (from.isObject3D ? from.getWorldPosition(_kv) : _kv.copy(from)) : null;
      const HAND = 0.42, GRAV = -11;
      for (let i = 0; i < n; i++) {
        const el = h('span', { class: 'fx-coin', html: G.icon('coin') }); // static inline SVG from the core icon set
        this._root.appendChild(el);
        this._coinEls++;
        const a = rnd() * TAU, sr = R(18, 64);
        let x0 = src.x, y0 = src.y, handed = false;
        if (w3) {
          const s = R(0.7, 1.7), vx = Math.cos(a) * s, vy = R(5.2, 6.4), vz = Math.sin(a) * s;
          resetSP(); SP.kind = K.COIN; SP.life = HAND + 0.08; SP.s0 = SP.s1 = R(0.2, 0.26); SP.grav = GRAV; SP.drag = 0; SP.flags = F_COIN;
          SP.phs = R(9, 14); SP.spin = 0; SP.rot = R(-0.25, 0.25); SP.fout = 0.8; SP.color = PAL.white[0]; SP.bri = 1.1; SP.delay = i * 0.03;
          spawn(this._normal, w3.x, w3.y, w3.z, vx, vy, vz);
          const tt = HAND;
          _pv.set(w3.x + vx * tt, w3.y + vy * tt + 0.5 * GRAV * tt * tt, w3.z + vz * tt);
          const sp = toScreen(_pv);
          if (sp && sp.x > -40 && sp.x < innerWidth + 40 && sp.y > -40 && sp.y < innerHeight + 40) { x0 = sp.x; y0 = sp.y; handed = true; }
        }
        const x1 = handed ? x0 : x0 + Math.cos(a) * sr, y1 = handed ? y0 : y0 + Math.sin(a) * sr * 0.7 - 20;
        const cx = (x1 + tx) / 2 + R(-90, 90), cy = Math.min(y1, ty) - R(90, 200);
        // spin = horizontal squash that never goes fully edge-on (stays readable as a coin)
        const ph0 = rnd() * Math.PI;
        const spin = (k) => (0.38 + 0.62 * Math.abs(Math.cos(ph0 + k * Math.PI * 3.5))).toFixed(3);
        const frames = [handed
          ? { transform: `translate(${x0.toFixed(1)}px,${y0.toFixed(1)}px) scale(${(0.9 * spin(0)).toFixed(3)},.9)`, opacity: 1, offset: 0 }
          : { transform: `translate(${x0}px,${y0}px) scale(.3,.3)`, opacity: 0, offset: 0 }];
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
          const anim = el.animate(frames, { duration: R(720, 900), delay: handed ? HAND * 1000 + i * 30 : i * 55, easing: 'cubic-bezier(.35,.1,.6,1)', fill: handed ? 'forwards' : 'both' });
          anim.onfinish = finish; anim.oncancel = finish;
        } catch (e) { finish(); }
        this._later(finish, 2600 + i * 60); // hard stop
      }
    },

    /** soft screen-edge glow */
    pulse(color = '#f4c54a', opts = {}) {
      if (!lv() || !this._layer()) return;
      // photosensitivity: back-to-back events (achievement + quest + level-up in one tick) merge into ONE glow,
      // so the screen edge can never flash faster than ~1.4 Hz; the rise is eased over a third of the duration
      const now = pnow();
      if (now - this._pulseAt < 700) return;
      this._pulseAt = now;
      const c = cssColor(color) || '#f4c54a';
      let el = this._pulseEl;
      if (!el || !el.isConnected) { el = this._pulseEl = G.ui.h('div', { class: 'fx-pulse', 'aria-hidden': 'true' }); this._root.appendChild(el); }
      el.style.setProperty('--fx-pulse', c);
      const dur = clamp(Number(opts?.duration) || 1300, 900, 4000);
      const peak = !motion() ? 0.55 : kidOn() ? 0.75 : 0.95;
      try {
        el.getAnimations?.().forEach((a) => a.cancel());
        el.animate([{ opacity: 0 }, { opacity: peak, offset: 0.35 }, { opacity: 0 }], { duration: dur, easing: 'ease-in-out' });
      } catch (e) { /* cosmetic */ }
    },

    /** 쉬운 모드 party: confetti + stars + hearts at pos (default: the player) and a soft 2D rain of stars & hearts */
    kidParty(pos, opts = {}) {
      if (!lv()) return 0;
      if (opts == null || typeof opts !== 'object') opts = {};
      const now = pnow();
      if (now - this._partyAt < 900) return 0;   // one party at a time (celebrations can chain)
      this._partyAt = now;
      let n = 0;
      if (opts.burst !== false) {
        const p = pos == null ? playerPos(_kv) : resolvePos(pos, _kv);
        if (p) {
          n += this.burst('confetti', p, { count: 34, lift: 1.5, spread: 0.9 });
          n += this.burst('stars', p, { count: 14, lift: 1.7, spread: 0.9 });
          n += this.burst('hearts', p, { count: 8, lift: 1.6, spread: 0.8 });
          const e = cleanEmoji(opts.emoji);
          if (e) this.emoji3d(null, e, { scale: 1.2, rise: 1.4, duration: 1.9 });
        }
      }
      if (opts.rain !== false && motion()) this._startRain(lv() > 1 ? 70 : 34, 2.6, true);
      return n;
    },
    /** 08-easy already bursts confetti at the player: add stars + hearts and the falling-shapes rain */
    _onCelebrate() {
      if (!G.state || !lv()) return;
      this.burst('stars', null, { count: 12, lift: 1.8 });
      this.burst('hearts', null, { count: 6, lift: 1.7 });
      if (motion() && pnow() - this._partyAt > 900) { this._partyAt = pnow(); this._startRain(lv() > 1 ? 60 : 30, 2.4, true); }
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
      CM.clear();
    },

    stats() {
      const m = CM.stats();
      return {
        level: this.level(), normal: this._normal?.n || 0, additive: this._add?.n || 0, emoji: this._emoInst.length, emojiCached: this._emoMap.size,
        pillar: !!this._pillar?.active, coinsFlying: this._coinEls, flights: this._flights.length, levelUpQueue: this._luQ.length,
        levelUpShowing: !!this._lu, rain: !!this._rain?.active, ffxMerged: !!G.ffx?.__fxGated, items: this._itemEls,
        motion: m,
        drawCalls: [this._normal, this._add, this._emo].filter((P) => P?.mesh.visible).length + (this._pillar?.active ? 2 : 0) + m.drawCalls,
      };
    },

    /** teleport / travel portal at pos (default: the player) — 'in' = arriving (dissolves away), 'out' = leaving */
    portal(pos, opts) {
      if (!lv() || !this._ensure3D()) return false;
      const o = opts && typeof opts === 'object' ? opts : {};
      const p = pos == null ? playerPos(_pv) : resolvePos(pos, _pv);
      if (!p) return false;
      return CM.portal(p, o.mode === 'out' ? 'out' : 'in');
    },
    /** light pillar + star shower at pos (default: the player); kind 'quest' (jade-gold) or 'level' (gold) */
    pillar(pos, opts) {
      if (!lv() || !this._ensure3D()) return false;
      const o = opts && typeof opts === 'object' ? opts : {};
      const p = pos == null ? playerPos(_pv) : resolvePos(pos, _pv);
      if (!p) return false;
      this._startPillar(o.kind === 'level' ? 'level' : 'quest', p);
      return true;
    },
    /** 3D hanging name board for a zone (first visits play it automatically) */
    zoneBanner(zoneId) {
      if (!lv() || !this._ensure3D() || typeof zoneId !== 'string') return false;
      const z = G.world?.zoneById?.(zoneId);
      return z && z.r > 0 ? CM.banner(z) : false;
    },

    /** an item pops out of `from` (3D) and arcs into the 🎒 가방 tile (2D); qty shows as "+n" */
    itemFly(from, what, opts) {
      if (!lv() || !this._layer()) return false;
      const o = opts && typeof opts === 'object' ? opts : {};
      const it = typeof what === 'string' ? G.data.items?.[what] : null;
      const e = cleanEmoji(it ? it.icon : what);
      if (!e) return false;
      const bag = document.querySelector('#hud-left-menu [data-action="inventory"]');
      if (!bag || !bag.getClientRects().length || document.body.classList.contains('hud-hidden') || document.getElementById('hud')?.hidden) return false;
      if (this._itemEls >= 4) return false;
      const qty = Math.max(1, Math.min(999, Math.floor(Number(o.qty) || 1)));
      // 3D pop at the source, then the 2D flight starts where the pop is on screen
      let start = null;
      const world = from && (from.isObject3D || from.isVector3 || (typeof from === 'object' && Number.isFinite(from.x) && Number.isFinite(from.z) && from.y !== undefined));
      if (world && motion()) {
        const p = from.isObject3D ? headPos(from, _kv, 0.2) : resolvePos(from, _kv);
        if (p) {
          this.emoji3d(p, e, { rise: 0.75, duration: 0.6, scale: 1.05 });
          _pv.copy(p); _pv.y += 0.7;
          start = toScreen(_pv);
        }
      }
      if (!start) start = this._screenFrom(world ? null : from);
      const br = bag.getBoundingClientRect();
      const tx = br.left + br.width / 2, ty = br.top + br.height / 2;
      if (!motion() || typeof Element.prototype.animate !== 'function') { this._bumpBag(bag, qty, e); return true; }
      const el = G.ui.h('span', { class: 'fx-item emoji' }, e);   // textContent: the emoji / item icon
      this._root.appendChild(el);
      this._itemEls++;
      const x0 = clamp(start.x, 0, innerWidth), y0 = clamp(start.y, 0, innerHeight);
      const cx = (x0 + tx) / 2 + R(-40, 40), cy = Math.min(y0, ty) - R(70, 140);
      const frames = [];
      for (let s = 0; s <= 10; s++) {
        const u = s / 10, iu = 1 - u;
        const bx = iu * iu * x0 + 2 * iu * u * cx + u * u * tx, by = iu * iu * y0 + 2 * iu * u * cy + u * u * ty;
        const sc = u < 0.15 ? 0.6 + u / 0.15 * 0.5 : 1.1 - 0.55 * ((u - 0.15) / 0.85);
        frames.push({ transform: `translate(${bx.toFixed(1)}px,${by.toFixed(1)}px) scale(${sc.toFixed(3)})`, opacity: u < 0.1 ? u / 0.1 : 1, offset: u });
      }
      const gen = this._gen;
      let done = false;
      const finish = () => {
        if (done) return; done = true;
        el.remove();
        if (gen !== this._gen) return;
        this._itemEls = Math.max(0, this._itemEls - 1);
        this._bumpBag(bag, qty, e);
      };
      try {
        const a = el.animate(frames, { duration: 780, delay: world ? 380 : 0, easing: 'cubic-bezier(.4,.05,.55,1)', fill: 'both' });
        a.onfinish = finish; a.oncancel = finish;
      } catch (err) { finish(); }
      this._later(finish, 2400);
      return true;
    },
    _bumpBag(bag, qty, e) {
      if (!bag.isConnected) return;
      try { bag.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.04)', offset: 0.35 }, { transform: 'scale(1)' }], { duration: 360, easing: 'cubic-bezier(.22,1,.36,1)' }); } catch (err) { /* cosmetic */ }
      if (!this._layer()) return;
      const r = bag.getBoundingClientRect();
      const chip = G.ui.h('span', { class: 'fx-item-chip' }, '+' + qty);
      chip.style.left = (r.right - 6) + 'px'; chip.style.top = (r.top + 4) + 'px';
      this._root.appendChild(chip);
      this._later(() => chip.remove(), 1300);
      G.sfx('pop', { volume: 0.35 });
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
        // pop in to 104 % and settle (no overshoot past 4 %); reduceMotion: full size at once, a short fade-in instead
        const mo = motion();
        const pop = u < 0.16 ? (u / 0.16) : 1;
        const sc = !mo ? 1 : u < 0.16 ? 1.04 * Math.sin(pop * Math.PI / 2) : u < 0.3 ? 1.04 - 0.04 * ((u - 0.16) / 0.14) : 1;
        P.iData[i4] = it.size * sc;
        P.iData[i4 + 1] = (u > 0.7 ? 1 - (u - 0.7) / 0.3 : 1) * (mo ? 1 : Math.min(1, u / 0.08));
        P.iData[i4 + 2] = mo ? Math.sin(it.t * 3.4 + it.ph) * 0.14 : 0;
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
      // NaN-safe: every normalize is guarded (a pillar scaled thin must never feed normalize(vec3(0)) to the GPU)
      const mk = (core) => lightMat(new THREE.ShaderMaterial({
        uniforms: { uTime: { value: 0 }, uOp: { value: 0 }, uColor: { value: new THREE.Color(core ? 0xfff2c0 : 0xffc94a) } },
        vertexShader: `varying vec2 vUv; varying float vFace;
          void main(){
            vUv = uv; vec4 wp = modelMatrix * vec4(position, 1.0);
            vec3 n = mat3(modelMatrix) * normal; float nl = length(n); n = nl > 1e-6 ? n / nl : vec3(0.0, 1.0, 0.0);
            vec3 v = cameraPosition - wp.xyz; float vl = length(v); v = vl > 1e-6 ? v / vl : vec3(0.0, 0.0, 1.0);
            vFace = clamp(abs(dot(n, v)), 0.0, 1.0);
            gl_Position = projectionMatrix * viewMatrix * wp; }`,
        fragmentShader: `uniform float uTime; uniform float uOp; uniform vec3 uColor; varying vec2 vUv; varying float vFace;
          void main(){
            float facing = pow(max(vFace, 0.0), ${core ? '1.2' : '2.2'});
            float fade = pow(max(1.0 - vUv.y, 0.0), 1.25) * smoothstep(0.0, 0.035, vUv.y);
            float sw = 0.62 + 0.38 * sin((vUv.x * ${core ? '2.0' : '5.0'} + vUv.y * 9.0 - uTime * 2.4) * 6.2831);
            float a = clamp(facing * fade * sw * uOp, 0.0, 1.0);
            if (a < 0.002) discard;
            gl_FragColor = vec4(uColor * (1.1 + facing), a);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
            gl_FragColor.rgb *= gl_FragColor.a;   // premultiplied (lightMat blending)
          }`,
        transparent: true, depthWrite: false, side: THREE.DoubleSide,
      }));
      const outer = new THREE.Mesh(geo, mk(false));
      const inner = new THREE.Mesh(geo, mk(true));
      for (const m of [outer, inner]) { m.frustumCulled = false; m.renderOrder = 13; m.raycast = () => {}; }
      const group = new THREE.Group();
      group.name = 'fx-light-pillar';
      group.add(outer, inner);
      group.visible = false;
      this._scene.add(group);
      this._pillar = { group, outer, inner, t: 0, dur: 2.8, active: false, spawnAcc: 0, showerAcc: 0, kind: 'level', follow: true, tall: 16 };
      return this._pillar;
    },
    /** kind 'level' (gold, tall, confetti) or 'quest' (jade-gold, star shower); pos = where (default: the player) */
    _startPillar(kind = 'level', pos = null) {
      if (!this._ensure3D()) return;
      const at = pos ? _pv2.copy(pos) : playerPos(_pv2);
      if (!at) return;
      const P = this._buildPillar();
      const quest = kind === 'quest';
      P.kind = quest ? 'quest' : 'level';
      P.t = 0; P.active = true; P.spawnAcc = 0; P.showerAcc = 0; P.group.visible = true;
      lightBlend(P.outer.material); lightBlend(P.inner.material);   // HDR additive / LDR screen (see lightMat)
      P.dur = quest ? 2.4 : 2.8; P.tall = quest ? 12 : 16; P.follow = !pos;
      P.outer.material.uniforms.uColor.value.set(quest ? 0x7fe3b4 : 0xffc94a);
      P.inner.material.uniforms.uColor.value.set(quest ? 0xdcffec : 0xfff2c0);
      P.group.position.copy(at);
      const ground = this._ev.copy(at);
      // shock rings + star burst (+ confetti for a level-up)
      this.ripple(ground, { color: quest ? '#9cf0c8' : '#ffd166', radius: quest ? 2.6 : 3.4, duration: 1.2, rings: lv() > 1 ? 3 : 1 });
      this.burst('stars', ground, { count: quest ? 18 : 26, lift: 1.0, spread: quest ? 1.1 : 1.4 });
      if (!quest) this.burst('confetti', ground, { count: 50, lift: 2.2 });
      G.sfx('whoosh', { volume: quest ? 0.45 : 0.7 });
      if (!quest && motion() && !kidOn() && G.settings.cameraShake !== false) G.sys.camera?.shake?.(0.16);
    },
    _stepPillar(dt, t) {
      const P = this._pillar;
      P.t += dt;
      const k = P.t / P.dur;
      if (k >= 1 || !G.state) { P.active = false; P.group.visible = false; return; }
      if (P.follow && playerPos(_pv)) P.group.position.lerp(_pv, Math.min(1, dt * 10));
      const grow = 1 - Math.pow(1 - Math.min(1, P.t / 0.45), 3);
      const op = (P.t < 0.15 ? P.t / 0.15 : 1) * (k > 0.62 ? 1 - (k - 0.62) / 0.38 : 1);
      const h = 2 + grow * P.tall;
      const w = P.kind === 'quest' ? 0.85 : 1;
      P.outer.scale.set((0.35 + grow * 1.05) * w, h, (0.35 + grow * 1.05) * w);
      P.inner.scale.set((0.12 + grow * 0.36) * w, h * 1.05, (0.12 + grow * 0.36) * w);
      P.outer.material.uniforms.uOp.value = op * 0.55;
      P.inner.material.uniforms.uOp.value = op * 0.8;
      P.outer.material.uniforms.uTime.value = t;
      P.inner.material.uniforms.uTime.value = t * 1.3;
      if (!lv()) return;
      const g = P.group.position;
      // rising helix of sparks
      if (P.t < 1.7) {
        P.spawnAcc += dt * (lv() > 1 ? 34 : 14);
        while (P.spawnAcc >= 1) {
          P.spawnAcc -= 1;
          const a = P.t * 7 + (rnd() < 0.5 ? 0 : Math.PI) + R(-0.2, 0.2);
          const r = R(0.9, 1.3) * w;
          resetSP(); SP.kind = rnd() < 0.5 ? K.SPARK : K.STAR; SP.life = R(0.9, 1.4); SP.s0 = R(0.18, 0.3); SP.s1 = 0.02; SP.grav = 0; SP.drag = 0.4;
          SP.flags = F_TWINKLE; SP.spin = R(-3, 3); SP.bri = 1.6; SP.color = PAL.stars[(rnd() * PAL.stars.length) | 0];
          spawn(this._add, g.x + Math.cos(a) * r, g.y + R(0.1, 0.6), g.z + Math.sin(a) * r, -Math.sin(a) * 1.2, R(3.5, 6), Math.cos(a) * 1.2);
        }
      }
      // quest pillar: a slow shower of stars drifting down around it (twinkle ≈ 1.7 Hz, no flashing)
      if (P.kind === 'quest' && P.t > 0.35 && P.t < 1.9) {
        P.showerAcc += dt * (lv() > 1 ? 16 : 7);
        while (P.showerAcc >= 1) {
          P.showerAcc -= 1;
          const a = rnd() * TAU, r = R(0.4, 2.2);
          resetSP(); SP.kind = K.STAR; SP.life = R(1.4, 2.1); SP.s0 = R(0.16, 0.26); SP.s1 = 0.08; SP.grav = -1.2; SP.drag = 1.4;
          SP.flags = F_TWINKLE | F_FLUTTER; SP.spin = R(-1.5, 1.5); SP.bri = 1.5; SP.floor = g.y + 0.05; SP.fout = 0.6;
          SP.color = rnd() < 0.35 ? PAL.firefly[0] : PAL.stars[(rnd() * PAL.stars.length) | 0];
          spawn(this._add, g.x + Math.cos(a) * r, g.y + R(4.5, 8), g.z + Math.sin(a) * r, R(-0.3, 0.3), R(-0.4, 0), R(-0.3, 0.3));
        }
      }
    },

    // ------------------------------------------------------------ player-driven world fx
    _stepPlayerFx(dt, l) {
      const pl = G.sys.player;
      if (!pl?.rig || !pl.position || pl.enabled === false) return;
      const steps = Number(pl.rig.steps) || 0;
      const sp = Number(pl.speed) || 0;
      const RUN = RUNV(), WALK = WALKV();
      const quietCam = cinematic();
      if (this._steps < 0 || steps < this._steps) this._steps = steps;
      if (steps !== this._steps) {
        // at 18 m/s several steps can pass in one slow frame: lay their prints along the frame's path
        const nStep = Math.min(3, steps - this._steps);
        this._steps = steps;
        if (pl.grounded && !quietCam) {
          for (let k = 0; k < nStep; k++) CM.footprint(pl, (k + 1) / nStep, l);
          // step dust only when actually running (walking is 9.6 m/s now: dust on every walk step would be noise)
          if (sp > (WALK + RUN) * 0.5 && (l > 1 || (steps & 1))) this._footDust(pl, l, 0.8);
        }
      }
      // kick-off (stand -> walk/sprint) and skid (sprint -> sudden stop) dust. The player speeds up / brakes over a
      // few frames (21-player ACCEL / DECEL): the kick compares with the speed of the last 0.35 s, the skid fires
      // when the wanted speed drops away while still sprinting (input released; an auto-walk brakes gently instead)
      const prev = this._spPrev ?? sp;
      this._spPrev = sp;
      const ft = (this._pfT = (this._pfT || 0) + dt);
      if (this._slowAt === undefined || prev < WALK * 0.55) this._slowAt = ft;
      if (pl.grounded && !quietCam) {
        if (prev <= WALK * 0.9 && sp > WALK * 0.9 && ft - this._slowAt < 0.35 && pnow() - (this._kickAt || 0) > 900) { this._kickAt = pnow(); this._footDust(pl, l, 1.2, -1); }
        const want = Number(pl.wantSpeed);
        if (want < WALK * 0.45 && prev > RUN * 0.7 && this._sprintPeak > 0.4 && pnow() - (this._skidAt || 0) > 700) { this._skidAt = pnow(); this._footDust(pl, l, 1.5, 1); }
      }
      this._sprintPeak = sp > RUN * 0.7 ? Math.min(2, (this._sprintPeak || 0) + dt) : Math.max(0, (this._sprintPeak || 0) - dt * 2);
      if (!pl.grounded) { this._airVy = Math.min(this._airVy, pl.velocity?.y || 0); this._wasAir = true; }
      else if (this._wasAir) {
        if (this._airVy < -4 && !quietCam) {          // every real jump / drop (jump v0 = 5.7 m/s), not a step down
          const power = clamp(-this._airVy / 6, 1, 2.4);
          this._footDust(pl, l, power);
          CM.landRing(pl, power, l);
          CM.footprint(pl, 1, l, true);
        }
        this._airVy = 0; this._wasAir = false;
      }
    },
    /** dust at the feet; dir -1 = kicked backwards (sprint start), +1 = sprayed forwards (skid), 0 = around */
    _footDust(pl, l, power, dir = 0) {
      const p = pl.position;
      let surf = 'grass';
      try { surf = G.world?.surfaceAt?.(p.x, p.z) || 'grass'; } catch (e) { surf = 'grass'; }
      const water = surf === 'water' || p.y < (G.data.layout?.waterY ?? -1.1) - 0.02;
      let fx = Math.sin(pl.rotY || 0), fz = Math.cos(pl.rotY || 0);
      if (dir > 0) { fx = -fx; fz = -fz; }   // skid: the spray goes ahead of the feet (the "behind" below flips)
      const n = Math.max(1, Math.round((l > 1 ? 3 : 1) * power * (dir ? 1.6 : 1)));
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
      try { icon.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.04) rotate(-6deg)', filter: 'drop-shadow(0 0 6px rgba(255,214,90,.95))' }, { transform: 'scale(1)' }], { duration: 260, easing: 'ease-out' }); } catch (e) { /* cosmetic */ }
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
      const kid = kidOn();
      const numEl = h('b', { class: 'fx-lu-num' }, h('span', { class: 'fx-lu-digit' }, String(anim ? Math.max(1, from) : to)));
      const mascot = this._mascotNode('cheer');
      // 쉬운 모드: no "LEVEL UP" / EXP words — a big ⭐ with the number and one happy sentence
      const card = kid
        ? h('div', { class: 'fx-lu-card' },
          mascot ? h('div', { class: 'fx-lu-mascot' }, mascot) : null,
          h('div', { class: 'fx-lu-title' }, '쑥쑥 컸어요!'),
          h('div', { class: 'fx-lu-level' }, h('span', { class: 'fx-lu-lv fx-lu-star emoji' }, '⭐'), numEl),
          h('div', { class: 'fx-lu-sub' }, h('span', { class: 'emoji' }, '🌱'), ' 별이 하나 더 생겼어요!'))
        : h('div', { class: 'fx-lu-card' },
          mascot ? h('div', { class: 'fx-lu-mascot' }, mascot) : null,
          h('div', { class: 'fx-lu-eyebrow' }, 'LEVEL UP'),
          h('div', { class: 'fx-lu-title' }, '레벨 업!'),
          h('div', { class: 'fx-lu-level' }, h('span', { class: 'fx-lu-lv' }, 'Lv.'), numEl),
          title ? h('div', { class: 'fx-lu-sub fx-lu-titleline' }, h('span', { class: 'emoji' }, '🏅'), ' 새 칭호 「', h('b', null, title), '」 획득!') : null,
          title && G.data.meta?.titleDisclaimer ? h('div', { class: 'fx-lu-note' }, G.data.meta.titleDisclaimer) : null,
          !title && Number.isFinite(remain) && remain > 0 ? h('div', { class: 'fx-lu-sub' }, h('span', { class: 'emoji' }, '✨'), ` 다음 레벨까지 ${U.fmt(remain)} EXP`) : null);
      // decorative (fx-root is aria-hidden): the level-up toast from progression is the accessible announcement
      const el = h('div', { class: 'fx-lu' + (anim ? '' : ' fx-static') + (kid ? ' fx-kid' : '') },
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
      if (anim && lv() > 0) this._startRain(kid ? (lv() > 1 ? 90 : 40) : lv() > 1 ? 130 : 50, 3.0, kid);
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
        nu.animate([{ transform: 'translateY(70%) scale(.8)', opacity: 0 }, { transform: 'translateY(0) scale(1.03)', opacity: 1, offset: 0.7 }, { transform: 'translateY(0) scale(1)', opacity: 1 }], { duration: last ? 420 : 220, easing: 'ease-out' });
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
    _startRain(n, dur, kid) {
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
        // shape: 0 rect, 1 dot, 2 star, 3 heart (kid rain: mostly stars & hearts, bigger, slower flips)
        const r = rnd();
        const shape = kid ? (r < 0.4 ? 2 : r < 0.68 ? 3 : r < 0.85 ? 0 : 1) : (r < 0.25 ? 1 : 0);
        const big = shape >= 2 ? R(1.5, 2.1) : 1;
        R0.parts.push({ x: R(0, W), y: R(-innerHeight * 0.6, -10), vx: R(-50, 50), vy: R(60, 200), w: R(7, 13) * big, h: R(4, 8) * big, rot: R(0, TAU), vr: R(-6, 6) * (kid ? 0.5 : 1), ph: R(0, TAU), phs: R(5, 12) * (shape >= 2 ? 0.35 : 1), c: shape === 3 ? (rnd() < 0.6 ? '#ff6b9d' : '#ff8fb3') : shape === 2 ? (rnd() < 0.7 ? '#ffd43b' : '#fff3b0') : cols[(rnd() * cols.length) | 0], shape, sway: R(15, 45) });
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
        if (p.shape === 1) { ctx.beginPath(); ctx.arc(0, 0, p.h * 0.6, 0, TAU); ctx.fill(); }
        else if (p.shape === 2) { starPath(ctx, p.w * 0.62); ctx.fill(); }
        else if (p.shape === 3) { heartPath(ctx, p.w * 0.6); ctx.fill(); }
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
      this._lastFarm = null; this._lastJar = null;
      this._airVy = 0; this._wasAir = false;
      if (this._root) this._root.querySelectorAll('.fx-item, .fx-item-chip').forEach((n) => n.remove());
      this._itemEls = 0;
      CM.reset();
      this._partyAt = -1e9; this._pulseAt = -1e9;
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
          if (kidOn()) this.stamp('참 잘했어요!', { sub: ps.count > 1 ? `${ps.count}개나 해냈어요! 🎁` : '🎁 선물을 받아요!' });
          else this.stamp('완료!', { sub: ps.count > 1 ? `퀘스트 ${ps.count}개 완료` : ps.title });
          this.pulse('#34c36b', { duration: 1200 });
          this.burst('sparkle', null, { count: 18, lift: 1.2 });
          // a jade-gold light pillar with a slow star shower (a level-up pillar that is already up wins)
          if (!this._pillar?.active) this._startPillar('quest');
        }, 120);
      });

      // items flying into the bag (harvest / NPC gifts / rewards / crafts); shop buys and silent adds stay quiet
      on('item:added', ({ itemId, qty, source }) => {
        const src = String(source || '');
        if (!lv() || !G.data.items?.[itemId] || /^(shop|buy|debug|import|init|restore|load|server|corrupted|default)/.test(src)) return;
        if (G.ui.modal?.isOpen?.() || pnow() < this._quietUntil) return;
        const now = pnow();
        if (now - this._itemAt < 220) return;   // a reward with many items: the first one flies, the bag bumps for all
        this._itemAt = now;
        const farm = /^harvest|^farm/.test(src), jar = /^ferment/.test(src);
        // farm:harvested / ferment:claimed (which name the plot / jar) are emitted AFTER the item is in the bag:
        // pick the start point when the flight starts, not now
        this._later(() => {
          if (!G.state) return;
          const L = farm ? this._lastFarm : jar ? this._lastJar : null;
          const from = L && Math.abs(L.t - now) < 900 ? L.v : headPos(null, new THREE.Vector3(), 0);
          this.itemFly(from, itemId, { qty });
        }, farm ? 260 : 120);
      });

      // first visit of a zone: a 3D name board floats in front of the camera
      on('zone:enter', ({ zone, first }) => {
        if (!first || !zone || !(zone.r > 0) || pnow() < this._quietUntil + 1500) return;
        // still there 0.35 s later; while the onboarding coach card covers the board's spot it waits (≤ ~10 s) for it
        const show = (n) => {
          if (!G.state || G.sys.minimap?.currentZone?.id !== zone.id) return;
          if (CM.coachCovers()) { if (n < 14) this._later(() => show(n + 1), 700); return; }
          CM.banner(zone);
        };
        this._later(() => show(0), 350);
      });

      on('quest:claimed', ({ questId }) => {
        const q = G.data.quests?.[questId];
        this.burst('confetti', null, { count: q?.category === 'main' ? 60 : 38 });
        this.burst('stars', null, { count: 12 });
        if (q?.category === 'main' && motion()) this._later(() => this._startRain(lv() > 1 ? 80 : 30, 2.2, kidOn()), 250);
        else if (kidOn()) this.burst('hearts', null, { count: 8, lift: 1.6 });
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
        this._lastJar = { v: v.clone().setY(v.y + 0.6), t: pnow() };
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

  // ===========================================================================================
  // Phase 4: character motion graphics (CONTRACT §13.4) — speed lines, afterimages, ground ribbon,
  // footprints, landing ring, teleport portal, 3D zone banner. Built lazily on the first frame with a scene,
  // nothing allocated per frame, every mesh hidden while it has nothing to show (0 draw calls when idle).
  // ===========================================================================================
  const fin = Number.isFinite;
  const WALKV = () => (fin(G.sys.player?.WALK) ? G.sys.player.WALK : 9.6);
  const RUNV = () => (fin(G.sys.player?.RUN) ? G.sys.player.RUN : 18);
  const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const dampK = (k, dt) => 1 - Math.exp(-k * dt);
  const easeOutQuint = (x) => 1 - Math.pow(1 - clamp(x, 0, 1), 5);
  const noRay = () => {};
  /** the camera is telling a story (intro, telescope tour, photo, dialogue / focus camera): no character fx */
  function cinematic() {
    const M = G.sys.manjangdae;
    if (M && (M.introActive || M.tourActive)) return true;
    const cam = G.sys.camera;
    if (cam && cam.mode && cam.mode !== 'follow') return true;
    const b = document.body;
    return !!(b && (b.classList.contains('photo-mode') || b.classList.contains('dialogue-open')));
  }
  // ---- the zone name board (CM.banner) hangs BAN_DIST m in front of the camera, centred, under the top HUD bars
  const BAN_DIST = 5.4;
  /** view size at the board's distance and the board's scale (≤ 84 % of the view wide, ≤ 26 % high) */
  function banFit(cam) {
    const visH = 2 * BAN_DIST * Math.tan(THREE.MathUtils.degToRad(cam.fov || 55) / 2), visW = visH * Math.max(0.3, cam.aspect || 1);
    return { visH, visW, sc: Math.min(1, (visW * 0.84) / 2.8, (visH * 0.26) / 0.9) };
  }
  /** px: lowest bottom edge of the top HUD bars ("다음 할 일", objective, profile, minimap…) over the columns [l, r] */
  function hudTopUnder(l, r) {
    const H = innerHeight;
    let y = 0;
    for (const id of ['easy-next', 'objective-hint', 'hud-profile', 'hud-player', 'hud-right']) {
      const el = document.getElementById(id);
      if (!el || el.hidden || !el.getClientRects().length) continue;
      const b = el.getBoundingClientRect();
      // bars only: a tall side column (the desktop minimap + quest panel) stands beside the board, not above it
      if (b.width && b.top < H * 0.3 && b.height < H * 0.4 && b.left < r && b.right > l) y = Math.max(y, b.bottom);
    }
    return y;
  }
  /** the onboarding coach card (70-app) is up over the rect [l, t, r, b] (px) */
  function coachOver(l, t, r, b) {
    const co = document.querySelector('.coach-layer .coach:not([hidden])');
    if (!co) return false;
    const c = co.getBoundingClientRect();
    return c.width > 0 && c.left < r && c.right > l && c.top < b && c.bottom > t;
  }
  /** the low quality preset stays cheap: one afterimage, the short speed-line set */
  const lowQ = () => G.sys.engine?.quality === 'low';
  // Light effects (portal, light pillar) output premultiplied colour and blend "additively" in two ways: on the HDR composer
  // target (medium / high) as plain additive light (dst + c·a, tone-mapped later by the OutputPass); on the low
  // preset — straight into the 8-bit canvas, already tone-mapped — as "screen" (dst + c·a·(1 − dst)), which can
  // never clip a bright scene to a flat white block over the character.
  function lightMat(m) {
    m.blending = THREE.CustomBlending; m.blendEquation = THREE.AddEquation;
    m.blendSrc = THREE.OneFactor; m.blendDst = THREE.OneFactor;
    m.blendSrcAlpha = THREE.ZeroFactor; m.blendDstAlpha = THREE.OneFactor;
    return m;
  }
  function lightBlend(m) {
    const src = G.sys.engine?.composer ? THREE.OneFactor : THREE.OneMinusDstColorFactor;
    if (m.blendSrc !== src) m.blendSrc = src;
  }
  function weatherId() { const c = G.sys.weather?.current; return (c && typeof c === 'object' ? c.id : c) || 'CLEAR'; }
  function wetness() {
    const W = G.sys.weather;
    const r = Number(W?.precipitation?.rain) || 0;
    return weatherId() === 'RAIN' ? Math.max(0.6, r) : r;
  }

  // ---- shaders (NaN-safe: every normalize / division is guarded)
  const SL_N = 64;
  const SL_VS = `
    attribute vec4 aSeed;
    uniform float uTime; uniform float uStrength; uniform float uAspect; uniform vec2 uCenter;
    varying vec2 vUv; varying float vA;
    void main() {
      vUv = position.xy + 0.5;
      float cyc = fract(aSeed.z + uTime * (0.55 + 0.6 * aSeed.y));
      vec2 dir = vec2(cos(aSeed.x), sin(aSeed.x));
      float ax = abs(dir.x), ay = abs(dir.y);
      float edge = min(ax > 1e-4 ? uAspect / ax : 1e4, ay > 1e-4 ? 1.0 / ay : 1e4);
      float r0 = mix(0.6, 1.08, cyc) * edge;
      float len = (0.07 + 0.22 * uStrength) * (0.6 + 0.5 * aSeed.y) * edge;
      float hw = (0.0022 + 0.003 * aSeed.w) * (0.6 + 0.4 * uStrength);
      vec2 perp = vec2(-dir.y, dir.x);
      vec2 p = uCenter * vec2(uAspect, 1.0) + dir * (r0 + position.y * len) + perp * (position.x * 2.0 * hw);
      gl_Position = vec4(p.x / max(uAspect, 0.05), p.y, 0.0, 1.0);
      vA = smoothstep(0.0, 0.22, cyc) * (1.0 - smoothstep(0.72, 1.0, cyc));
    }`;
  const SL_FS = `
    uniform vec3 uColor; uniform float uAlpha;
    varying vec2 vUv; varying float vA;
    void main() {
      float across = 1.0 - abs(vUv.x * 2.0 - 1.0);
      float along = sin(clamp(vUv.y, 0.0, 1.0) * 3.14159265);
      float a = uAlpha * vA * across * along;
      if (a < 0.003) discard;
      gl_FragColor = vec4(uColor, a);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`;
  // afterimage: the player's skinned body re-drawn with a soft rim (same pose, translated to a recent position)
  const GHOST_VS = `
    #include <common>
    #include <skinning_pars_vertex>
    varying float vRim; varying float vY;
    void main() {
      #include <beginnormal_vertex>
      #include <skinbase_vertex>
      #include <skinnormal_vertex>
      #include <begin_vertex>
      #include <skinning_vertex>
      vec4 mv = modelViewMatrix * vec4(transformed, 1.0);
      vec3 n = normalMatrix * objectNormal; float nl = length(n); n = nl > 1e-6 ? n / nl : vec3(0.0, 0.0, 1.0);
      vec3 vd = -mv.xyz; float vl = length(vd); vd = vl > 1e-6 ? vd / vl : vec3(0.0, 0.0, 1.0);
      vRim = clamp(1.0 - abs(dot(n, vd)), 0.0, 1.0);
      vY = position.y;
      gl_Position = projectionMatrix * mv;
    }`;
  const GHOST_FS = `
    uniform vec3 uColor; uniform float uAlpha;
    varying float vRim; varying float vY;
    void main() {
      // mostly rim: a light silhouette, not a second body (the interior is a faint tint)
      float r = vRim * vRim;
      float a = uAlpha * (0.07 + 0.93 * r) * smoothstep(-0.02, 0.32, vY);
      if (a < 0.004) discard;
      gl_FragColor = vec4(uColor * (0.55 + 0.8 * r), clamp(a, 0.0, 1.0));
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`;
  const RB_N = 24;
  const RB_VS = `
    attribute float aAlpha; attribute float aSide;
    varying float vA; varying float vS;
    void main() { vA = aAlpha; vS = aSide; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
  const RB_FS = `
    uniform vec3 uColor; varying float vA; varying float vS;
    void main() {
      float e = 1.0 - vS * vS;
      float a = clamp(vA * e, 0.0, 1.0);
      if (a < 0.003) discard;
      gl_FragColor = vec4(uColor, a);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`;
  const FP_CAP = 64;
  const FP_VS = `
    attribute vec4 iData; attribute vec3 iCol;
    uniform float uTime; uniform float uLife;
    varying vec2 vUv; varying float vA; varying vec3 vCol;
    void main() {
      vUv = vec2(iData.z < 0.0 ? 1.0 - uv.x : uv.x, uv.y);
      float age = uTime - iData.x;
      vA = iData.y * smoothstep(0.0, 0.08, age) * (1.0 - smoothstep(uLife * 0.45, uLife, age));
      vCol = iCol;
      vec4 p = vec4(position, 1.0);
      #ifdef USE_INSTANCING
        p = instanceMatrix * p;
      #endif
      gl_Position = projectionMatrix * modelViewMatrix * p;
    }`;
  const FP_FS = `
    uniform sampler2D uMap; uniform float uNight;
    varying vec2 vUv; varying float vA; varying vec3 vCol;
    void main() {
      float a = texture2D(uMap, vUv).a * vA;
      if (a < 0.01) discard;
      gl_FragColor = vec4(vCol * (1.0 - 0.45 * uNight), clamp(a, 0.0, 1.0));
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`;
  const PORTAL_VS = `
    varying vec2 vUv; varying float vFace;
    void main() {
      vUv = uv;
      vec4 wp = modelMatrix * vec4(position, 1.0);
      vec3 n = mat3(modelMatrix) * normal; float nl = length(n); n = nl > 1e-6 ? n / nl : vec3(0.0, 1.0, 0.0);
      vec3 v = cameraPosition - wp.xyz; float vl = length(v); v = vl > 1e-6 ? v / vl : vec3(0.0, 0.0, 1.0);
      vFace = clamp(abs(dot(n, v)), 0.0, 1.0);
      gl_Position = projectionMatrix * viewMatrix * wp;
    }`;
  const PORTAL_FS = `
    uniform float uProg; uniform float uTime; uniform float uOp; uniform float uDir; uniform vec3 uColor; uniform vec3 uEdge;
    varying vec2 vUv; varying float vFace;
    float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
    float vnoise(vec2 p) {
      vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
      return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), u.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), u.x), u.y);
    }
    void main() {
      float y = uDir > 0.0 ? vUv.y : 1.0 - vUv.y;
      vec2 q = vec2(vUv.x * 10.0, vUv.y * 6.0 - uTime * 1.4);
      float n = vnoise(q) * 0.65 + vnoise(q * 2.7 + 3.1) * 0.35;
      float field = y * 0.62 + n * 0.38;
      float thr = uProg * 1.12 - 0.06;
      float keep = smoothstep(thr - 0.02, thr + 0.03, field);
      float live = step(0.01, uProg) * (1.0 - step(0.99, uProg));
      float edge = (1.0 - smoothstep(0.0, 0.07, abs(field - thr))) * live;
      float dy = (y - uProg) * 12.0;
      float scan = exp(-dy * dy) * live;
      // brightest just inside the silhouette, fading to nothing AT it: soft sides instead of a hard-edged box
      float side = smoothstep(0.02, 0.32, vFace);
      float rim = (0.3 + 0.7 * (1.0 - vFace)) * side;
      float fade = (1.0 - smoothstep(0.72, 1.0, vUv.y)) * smoothstep(0.0, 0.04, vUv.y);
      // the solid part is a soft, noisy veil brightest at the feet (no flat "box of light"); the burning edge carries the shape
      float body = keep * rim * (0.3 + 0.32 * n) * mix(1.0, 0.45, vUv.y);
      float a = (body + (edge * 1.1 + scan * 0.55) * (0.35 + 0.65 * side)) * fade * uOp;
      if (a < 0.003) discard;
      vec3 c = mix(uColor, uEdge, clamp(edge + scan, 0.0, 1.0));
      gl_FragColor = vec4(c, clamp(a, 0.0, 1.0));
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
      gl_FragColor.rgb *= gl_FragColor.a;   // premultiplied (lightMat blending)
    }`;

  // ---- canvas art
  function drawPrint(ctx, w, h) {
    // a small shoe print (sole + heel), soft edges; white alpha mask tinted in the shader
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#fff';
    ctx.filter = 'blur(1.2px)';
    ctx.beginPath(); ctx.ellipse(w * 0.5, h * 0.33, w * 0.3, h * 0.25, 0, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.ellipse(w * 0.5, h * 0.77, w * 0.22, h * 0.14, 0, 0, TAU); ctx.fill();
    ctx.filter = 'none';
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = 'rgba(0,0,0,.35)';
    for (let i = 0; i < 4; i++) { ctx.fillRect(w * 0.26, h * (0.18 + i * 0.075), w * 0.48, h * 0.022); }
    ctx.globalCompositeOperation = 'source-over';
  }
  function drawRune(ctx, w) {
    const c = w / 2;
    ctx.clearRect(0, 0, w, w);
    const g = ctx.createRadialGradient(c, c, 0, c, c, c);
    g.addColorStop(0, 'rgba(255,240,200,.55)'); g.addColorStop(0.4, 'rgba(255,220,140,.16)'); g.addColorStop(1, 'rgba(255,214,102,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, w);
    ctx.strokeStyle = 'rgba(255,236,180,.95)'; ctx.lineCap = 'round';
    ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(c, c, c * 0.9, 0, TAU); ctx.stroke();
    ctx.lineWidth = 1.6; ctx.beginPath(); ctx.arc(c, c, c * 0.78, 0, TAU); ctx.stroke();
    ctx.lineWidth = 2.2; ctx.beginPath(); ctx.arc(c, c, c * 0.42, 0, TAU); ctx.stroke();
    // 24 ticks between the rings + 8 diamonds (오방색 accents) — a 문양 ring, no letters
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * TAU, r0 = c * 0.8, r1 = c * (i % 3 ? 0.86 : 0.88);
      ctx.lineWidth = i % 3 ? 1.4 : 2.6;
      ctx.beginPath(); ctx.moveTo(c + Math.cos(a) * r0, c + Math.sin(a) * r0); ctx.lineTo(c + Math.cos(a) * r1, c + Math.sin(a) * r1); ctx.stroke();
    }
    const hues = ['#ffd84a', '#ff8f7a', '#8fd3ff', '#9cf0c8', '#fff4d6'];
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU + Math.PI / 8, r = c * 0.6;
      ctx.save(); ctx.translate(c + Math.cos(a) * r, c + Math.sin(a) * r); ctx.rotate(a);
      ctx.fillStyle = hues[i % hues.length];
      ctx.beginPath(); ctx.moveTo(0, -9); ctx.lineTo(6, 0); ctx.lineTo(0, 9); ctx.lineTo(-6, 0); ctx.closePath(); ctx.fill();
      ctx.restore();
    }
  }
  const SERIF = '"Noto Serif KR","Nanum Myeongjo","Batang","AppleMyungjo","Noto Serif CJK KR",serif';
  const SANS = '"PretendardEmbed","Pretendard","Noto Sans KR","Apple SD Gothic Neo","Malgun Gothic",sans-serif';
  /** 현판-style name board: lacquered wood, gold double frame, 단청 bands, emoji medallion, zone name */
  function drawBanner(ctx, w, h, name, sub, emoji) {
    ctx.clearRect(0, 0, w, h);
    const x0 = 16, y0 = 26, x1 = w - 16, y1 = h - 26, r = 30;
    const rr = (x, y, ww, hh, rad) => { ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(x, y, ww, hh, rad); else ctx.rect(x, y, ww, hh); };
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,.45)'; ctx.shadowBlur = 18; ctx.shadowOffsetY = 6;
    const wood = ctx.createLinearGradient(0, y0, 0, y1);
    wood.addColorStop(0, '#4a2c17'); wood.addColorStop(0.5, '#33200f'); wood.addColorStop(1, '#22140a');
    ctx.fillStyle = wood; rr(x0, y0, x1 - x0, y1 - y0, r); ctx.fill();
    ctx.restore();
    // wood grain
    ctx.save(); rr(x0, y0, x1 - x0, y1 - y0, r); ctx.clip();
    ctx.strokeStyle = 'rgba(255,220,170,.05)'; ctx.lineWidth = 2;
    for (let i = 0; i < 14; i++) { const y = y0 + 12 + i * ((y1 - y0 - 24) / 13); ctx.beginPath(); ctx.moveTo(x0, y); ctx.bezierCurveTo(w * 0.3, y + 6, w * 0.6, y - 6, x1, y + 3); ctx.stroke(); }
    // 단청 bands (top + bottom)
    const band = ['#2f8a72', '#c8453a', '#2b5ea8', '#f2d27a', '#e8e1cf'];
    for (const by of [y0 + 16, y1 - 28]) {
      for (let x = x0 + 26, i = 0; x < x1 - 26; x += 22, i++) { ctx.fillStyle = band[i % band.length]; ctx.globalAlpha = 0.85; ctx.fillRect(x, by, 18, 12); }
    }
    ctx.globalAlpha = 1;
    ctx.restore();
    // gold double frame
    ctx.strokeStyle = '#e8c46a'; ctx.lineWidth = 6; rr(x0 + 6, y0 + 6, x1 - x0 - 12, y1 - y0 - 12, r - 6); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,236,180,.7)'; ctx.lineWidth = 2; rr(x0 + 40, y0 + 36, x1 - x0 - 80, y1 - y0 - 72, 14); ctx.stroke();
    // medallion with the zone picture
    const mx = x0 + 132, my = h / 2;
    const mg = ctx.createRadialGradient(mx - 20, my - 24, 6, mx, my, 76);
    mg.addColorStop(0, '#fff6d2'); mg.addColorStop(0.55, '#f2c860'); mg.addColorStop(1, '#b37a1c');
    ctx.fillStyle = mg; ctx.beginPath(); ctx.arc(mx, my, 74, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#fff1c4'; ctx.lineWidth = 4; ctx.stroke();
    ctx.font = `86px ${EMOJI_FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(emoji, mx, my + 6);
    // name (shrinks to fit) + sub line
    const tx = mx + 104, maxW = x1 - 60 - tx;
    let fs = 104;
    ctx.textAlign = 'left';
    for (; fs > 48; fs -= 4) { ctx.font = `900 ${fs}px ${SERIF}`; if (ctx.measureText(name).width <= maxW) break; }
    ctx.shadowColor = 'rgba(0,0,0,.55)'; ctx.shadowBlur = 8; ctx.shadowOffsetY = 3;
    ctx.fillStyle = '#fff3cf'; ctx.fillText(name, tx, h / 2 - 18, maxW);
    ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
    ctx.font = `800 40px ${SANS}`; ctx.fillStyle = '#f2c860';
    ctx.fillText(sub, tx + 2, h / 2 + 62, maxW);
  }

  // ---- shared position history of the player's feet (time-stamped ring) for afterimages / ribbon
  const HN = 48;
  const Hist = {
    x: new Float32Array(HN), y: new Float32Array(HN), z: new Float32Array(HN), t: new Float32Array(HN), head: -1, n: 0,
    reset() { this.head = -1; this.n = 0; },
    push(x, y, z, t) { this.head = (this.head + 1) % HN; const h = this.head; this.x[h] = x; this.y[h] = y; this.z[h] = z; this.t[h] = t; if (this.n < HN) this.n++; },
    /** position at time `at` (interpolated) into out; returns false when the history does not reach back that far */
    at(at, out) {
      if (!this.n) return false;
      let i = this.head;
      if (at >= this.t[i]) { out.set(this.x[i], this.y[i], this.z[i]); return true; }
      for (let k = 1; k < this.n; k++) {
        const j = (i - 1 + HN) % HN;
        if (this.t[j] <= at) {
          const span = this.t[i] - this.t[j];
          const u = span > 1e-6 ? (at - this.t[j]) / span : 1;
          out.set(this.x[j] + (this.x[i] - this.x[j]) * u, this.y[j] + (this.y[i] - this.y[j]) * u, this.z[j] + (this.z[i] - this.z[j]) * u);
          return true;
        }
        i = j;
      }
      out.set(this.x[i], this.y[i], this.z[i]);
      return false;
    },
  };

  const _cv = new THREE.Vector3(), _cv2 = new THREE.Vector3(), _cn = new THREE.Vector3(), _cf = new THREE.Vector3(), _cr = new THREE.Vector3(), _cb = new THREE.Vector3(), _cd = new THREE.Vector3(), _ce = new THREE.Vector3();
  const _cm4 = new THREE.Matrix4(), _cq = new THREE.Quaternion();
  const _rx = new Float32Array(RB_N), _ry = new Float32Array(RB_N), _rz = new Float32Array(RB_N);

  const CM = {
    ready: false, scene: null,
    sl: null, slS: 0, slCx: 0, slCy: 0.1, vig: 0,
    gh: [], ghSrc: null, ghS: 0,
    rb: null, rbS: 0,
    fp: null, fpI: 0, fpLast: -1e9, fpSide: 1,
    pt: [], ban: null, banTex: new Map(),
    prev: new THREE.Vector3(), hasPrev: false, lastPortalAt: -1e9, t: 0, banCls: false,

    build() {
      if (this.ready) return true;
      const scene = G.sys.engine?.scene;
      if (!scene) return false;
      this.scene = scene;
      this._buildLines(scene);
      this._buildRibbon(scene);
      this._buildPrints(scene);
      this._buildPortals(scene);
      this._buildBanner(scene);
      this.ready = true;
      return true;
    },

    // ------------------------------------------------------------ builders
    _buildLines(scene) {
      const base = new THREE.PlaneGeometry(1, 1);
      const geo = new THREE.InstancedBufferGeometry();
      geo.setIndex(base.getIndex());
      geo.setAttribute('position', base.getAttribute('position'));
      const seed = new Float32Array(SL_N * 4);
      // golden-angle order: any prefix (the low preset draws the first 26) is still spread all around
      for (let i = 0; i < SL_N; i++) { seed[i * 4] = (i * 2.399963 + R(-0.06, 0.06)) % TAU; seed[i * 4 + 1] = R(0.7, 1.35); seed[i * 4 + 2] = rnd(); seed[i * 4 + 3] = R(0.5, 1.5); }
      geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 4));
      geo.instanceCount = SL_N;
      const mat = new THREE.ShaderMaterial({
        uniforms: { uTime: { value: 0 }, uStrength: { value: 0 }, uAspect: { value: 1 }, uCenter: { value: new THREE.Vector2() }, uColor: { value: new THREE.Color('#f3f8ff') }, uAlpha: { value: 0.3 } },
        vertexShader: SL_VS, fragmentShader: SL_FS, transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.name = 'fx-speed-lines'; mesh.frustumCulled = false; mesh.renderOrder = 998; mesh.visible = false; mesh.raycast = noRay; mesh.matrixAutoUpdate = false;
      scene.add(mesh);
      this.sl = { mesh, mat, geo };
    },
    _buildRibbon(scene) {
      const V = RB_N * 2;
      const pos = new Float32Array(V * 3), alpha = new Float32Array(V), side = new Float32Array(V);
      for (let i = 0; i < RB_N; i++) { side[i * 2] = -1; side[i * 2 + 1] = 1; }
      const idx = [];
      for (let i = 0; i < RB_N - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
      const geo = new THREE.BufferGeometry();
      geo.setIndex(idx);
      const pa = new THREE.BufferAttribute(pos, 3); pa.setUsage(THREE.DynamicDrawUsage);
      const aa = new THREE.BufferAttribute(alpha, 1); aa.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute('position', pa); geo.setAttribute('aAlpha', aa); geo.setAttribute('aSide', new THREE.BufferAttribute(side, 1));
      const mat = new THREE.ShaderMaterial({
        uniforms: { uColor: { value: new THREE.Color('#ffe3a6') } }, vertexShader: RB_VS, fragmentShader: RB_FS,
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.name = 'fx-sprint-ribbon'; mesh.frustumCulled = false; mesh.renderOrder = 4; mesh.visible = false; mesh.raycast = noRay; mesh.matrixAutoUpdate = false;
      scene.add(mesh);
      this.rb = { mesh, mat, pos, alpha, pa, aa };
    },
    _buildPrints(scene) {
      const geo = new THREE.PlaneGeometry(0.21, 0.33).rotateX(-Math.PI / 2);
      geo.deleteAttribute('normal');   // unlit decal: no normals at all (nothing for a GPU to normalise)
      const data = new Float32Array(FP_CAP * 4), col = new Float32Array(FP_CAP * 3);
      for (let i = 0; i < FP_CAP; i++) data[i * 4] = -1e5;
      const ad = new THREE.InstancedBufferAttribute(data, 4); ad.setUsage(THREE.DynamicDrawUsage);
      const ac = new THREE.InstancedBufferAttribute(col, 3); ac.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute('iData', ad); geo.setAttribute('iCol', ac);
      const tex = G.gfx.canvasTexture(64, 96, drawPrint);
      const mat = new THREE.ShaderMaterial({
        uniforms: { uMap: { value: tex }, uTime: { value: 0 }, uLife: { value: 7 }, uNight: { value: 0 } },
        vertexShader: FP_VS, fragmentShader: FP_FS, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
      });
      const mesh = new THREE.InstancedMesh(geo, mat, FP_CAP);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      _cm4.makeTranslation(0, -9999, 0);
      for (let i = 0; i < FP_CAP; i++) mesh.setMatrixAt(i, _cm4);
      mesh.name = 'fx-footprints'; mesh.frustumCulled = false; mesh.renderOrder = 2; mesh.visible = false; mesh.raycast = noRay;
      mesh.castShadow = false; mesh.receiveShadow = false;
      scene.add(mesh);
      this.fp = { mesh, mat, data, col, ad, ac };
    },
    _buildPortals(scene) {
      const colGeo = new THREE.CylinderGeometry(1, 1, 1, 40, 1, true); colGeo.translate(0, 0.5, 0);
      const discGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
      const runeTex = G.gfx.canvasTexture(256, 256, (ctx, w) => drawRune(ctx, w));
      for (let k = 0; k < 2; k++) {
        const colMat = lightMat(new THREE.ShaderMaterial({
          uniforms: { uProg: { value: 0 }, uTime: { value: 0 }, uOp: { value: 0 }, uDir: { value: 1 }, uColor: { value: new THREE.Color('#ffcf73') }, uEdge: { value: new THREE.Color('#fff6dc') } },
          vertexShader: PORTAL_VS, fragmentShader: PORTAL_FS, transparent: true, depthWrite: false, side: THREE.DoubleSide,
        }));
        const discMat = lightMat(new THREE.MeshBasicMaterial({ map: runeTex, color: 0xffd36a, transparent: true, opacity: 0, depthWrite: false, premultipliedAlpha: true, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
        const col = new THREE.Mesh(colGeo, colMat), disc = new THREE.Mesh(discGeo, discMat);
        col.renderOrder = 13; disc.renderOrder = 3;
        const g = new THREE.Group(); g.name = 'fx-portal'; g.add(col, disc); g.visible = false;
        for (const m of [col, disc]) { m.frustumCulled = false; m.raycast = noRay; }
        scene.add(g);
        this.pt.push({ g, col, disc, colMat, discMat, t: 0, dur: 1.3, active: false, mode: 'in', acc: 0, burst: false });
      }
    },
    _buildBanner(scene) {
      const board = new THREE.Mesh(new THREE.PlaneGeometry(2.8, 0.9), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthTest: false, depthWrite: false, toneMapped: false }));
      const glowTex = G.gfx.radialTexture(128, 'rgba(255,214,120,0.5)', 'rgba(255,214,120,0)');
      const glow = new THREE.Mesh(new THREE.PlaneGeometry(4.4, 2.0), new THREE.MeshBasicMaterial({ map: glowTex, transparent: true, opacity: 0, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
      glow.position.z = -0.03;
      board.renderOrder = 993; glow.renderOrder = 992;
      for (const m of [board, glow]) { m.frustumCulled = false; m.raycast = noRay; }
      const g = new THREE.Group(); g.name = 'fx-zone-banner'; g.add(glow, board); g.visible = false;
      scene.add(g);
      this.ban = { g, board, glow, t: 0, dur: 3.4, active: false, pos: new THREE.Vector3(), cam: new THREE.Vector3(), snap: true, burst: false, scale: 1, zone: null,
        chk: 0, top: 0, covered: false };
    },
    /** where the board rests on screen (px): centred, ~30 % above the middle, but under the top HUD bars (top: their
     *  bottom edge, measured unless given) — on a phone the fixed spot ran under "다음 할 일" / the objective bar */
    _banSpot(cam, top) {
      const W = innerWidth, H = innerHeight, f = banFit(cam);
      const bw = ((2.8 * f.sc) / f.visW) * W, bh = ((0.9 * f.sc) / f.visH) * H;
      const l = (W - bw) / 2, r = (W + bw) / 2;
      if (top == null) top = hudTopUnder(l, r);
      const yc = clamp(Math.max(H * 0.195, top + 6 + bh / 2), 0, H * 0.42);
      return { f, l, r, t: yc - bh / 2, b: yc + bh / 2, yc, top };
    },
    /** the onboarding coach card covers the board's spot (a first-visit board waits for it, a shown one lifts away) */
    coachCovers() {
      const cam = G.sys.engine?.camera;
      if (!cam) return false;
      const s = this._banSpot(cam);
      return coachOver(s.l, s.t, s.r, s.b);
    },

    // ------------------------------------------------------------ per frame
    update(dt, t, l) {
      if (!this.ready && !this.build()) return;
      this.t = t;
      const pl = G.sys.player;
      const live = l > 0 && !!G.state && !!pl?.position && pl._ready !== false && pl.object?.visible !== false;
      const quiet = !live || cinematic();
      const mo = motion();
      // ---- history + teleport detection
      if (live) {
        const p = pl.position;
        if (this.hasPrev) {
          const jx = p.x - this.prev.x, jz = p.z - this.prev.z;
          if (jx * jx + jz * jz > 36) {                    // > 6 m in one frame: teleport / fast travel / rescue hop
            Hist.reset();
            if (!quiet && t - this.lastPortalAt > 0.6) { this.lastPortalAt = t; this.portal(_cv.copy(p), 'in'); }
          }
        }
        if (Hist.n === 0 || t - Hist.t[Hist.head] > 0.03 || Math.hypot(p.x - Hist.x[Hist.head], p.z - Hist.z[Hist.head]) > 0.2) Hist.push(p.x, p.y, p.z, t);
        this.prev.copy(p); this.hasPrev = true;
      } else { this.hasPrev = false; Hist.reset(); }

      const sp = live ? Number(pl.speed) || 0 : 0;
      const RUN = RUNV();
      const kid = kidOn();
      const gate = live && !quiet && mo;
      // ---- sprint speed lines (+ a soft vignette layer on the engine grade)
      this._stepLines(dt, t, l, pl, gate ? smooth(RUN * 0.6, RUN * 0.97, sp) : 0, kid);
      // ---- afterimages + ground ribbon
      this._stepGhosts(dt, t, l, pl, gate ? smooth(RUN * 0.62, RUN * 0.98, sp) : 0, kid);
      this._stepRibbon(dt, t, l, pl, gate && pl.grounded !== false ? smooth(RUN * 0.55, RUN * 0.95, sp) : 0);
      // ---- footprints (fade in the shader)
      const fp = this.fp;
      fp.mat.uniforms.uTime.value = t;
      fp.mat.uniforms.uNight.value = clamp(Number(G.world?.nightFactor) || 0, 0, 1);
      const vis = t - this.fpLast < fp.mat.uniforms.uLife.value + 0.3 && !!G.state;
      if (fp.mesh.visible !== vis) fp.mesh.visible = vis;
      // ---- portals + banner
      for (const P of this.pt) if (P.active) this._stepPortal(P, dt, t, l, mo);
      if (this.ban.active) this._stepBanner(dt, t, mo);
      if (this.banCls !== this.ban.active) { this.banCls = this.ban.active; document.body?.classList.toggle('fx-zone3d', this.banCls); }
    },

    _stepLines(dt, t, l, pl, target, kid) {
      const S = this.sl;
      this.slS += (target - this.slS) * dampK(target > this.slS ? 3.2 : 5, dt);
      if (this.slS < 0.012) {
        this.slS = target > 0 ? this.slS : 0;
        if (S.mesh.visible) S.mesh.visible = false;
        this._vignette(0);
        return;
      }
      const u = S.mat.uniforms;
      u.uTime.value = t;
      u.uStrength.value = this.slS;
      u.uAspect.value = Math.max(0.2, innerWidth / Math.max(1, innerHeight));
      u.uAlpha.value = (kid ? 0.32 : 0.42) * (l > 1 ? 1 : 0.8);
      // radiate from where the run is heading on screen (the camera trails behind: near the centre)
      const cam = G.sys.engine?.camera, v = pl.velocity;
      let cx = 0, cy = 0.12;
      if (cam && v) {
        const vl = Math.hypot(v.x, v.z);
        if (vl > 0.5) {
          _cv2.set(pl.position.x + (v.x / vl) * 14, pl.position.y + 1.2, pl.position.z + (v.z / vl) * 14).project(cam);
          if (_cv2.z > -1 && _cv2.z < 1 && fin(_cv2.x) && fin(_cv2.y)) { cx = clamp(_cv2.x, -0.4, 0.4); cy = clamp(_cv2.y, -0.25, 0.22); }
        }
      }
      const k = dampK(4, dt);
      this.slCx += (cx - this.slCx) * k; this.slCy += (cy - this.slCy) * k;
      u.uCenter.value.set(this.slCx, this.slCy);
      S.geo.instanceCount = l > 1 && !lowQ() ? SL_N : 26;
      if (!S.mesh.visible) S.mesh.visible = true;
      this._vignette(this.slS);
    },
    _vignette(s) {
      const q = Math.round(clamp(s, 0, 1) * 8) / 8;
      if (q === this.vig) return;
      this.vig = q;
      try { G.sys.engine?.grade?.(q > 0 ? { vignette: 0.12 * q } : null, 'fx-sprint'); } catch (e) { /* engine grade optional */ }
    },

    _ensureGhosts(pl) {
      const src = pl?.rig?.mesh;
      if (!src || !src.isSkinnedMesh || !src.skeleton) return false;
      if (this.ghSrc === src && this.gh.length) return true;
      this._disposeGhosts();
      const cols = ['#ffe7a8', '#a9d7ff'];
      for (let k = 0; k < 2; k++) {
        const mat = new THREE.ShaderMaterial({
          uniforms: { uColor: { value: new THREE.Color(cols[k]) }, uAlpha: { value: 0 } },
          vertexShader: GHOST_VS, fragmentShader: GHOST_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
        });
        const g = new THREE.SkinnedMesh(src.geometry, mat);
        g.bind(src.skeleton, src.bindMatrix);
        g.name = 'fx-afterimage'; g.frustumCulled = false; g.castShadow = false; g.receiveShadow = false;
        g.matrixAutoUpdate = false; g.matrixWorldAutoUpdate = false; g.raycast = noRay; g.renderOrder = 12; g.visible = false;
        const off = new THREE.Vector3();
        g.userData.off = off;
        // same pose as the live body, translated to where the player was a moment ago
        g.onBeforeRender = () => {
          const s = this.ghSrc;
          if (!s) return;
          if (g.geometry !== s.geometry) g.geometry = s.geometry;
          g.matrixWorld.copy(s.matrixWorld);
          const e = g.matrixWorld.elements;
          e[12] += off.x; e[13] += off.y; e[14] += off.z;
          g.bindMatrixInverse.copy(s.bindMatrixInverse);
        };
        this.scene.add(g);
        this.gh.push({ g, mat, off });
      }
      this.ghSrc = src;
      return true;
    },
    _disposeGhosts() {
      for (const x of this.gh) { x.g.onBeforeRender = () => {}; this.scene?.remove(x.g); x.mat.dispose(); }
      this.gh.length = 0; this.ghSrc = null;
    },
    _stepGhosts(dt, t, l, pl, target, kid) {
      this.ghS += (target - this.ghS) * dampK(target > this.ghS ? 3 : 6, dt);
      if (this.ghS < 0.02 || !this._ensureGhosts(pl)) { for (const x of this.gh) if (x.g.visible) x.g.visible = false; return; }
      const n = l > 1 && !lowQ() ? 2 : 1;
      const p = pl.position;
      for (let k = 0; k < this.gh.length; k++) {
        const x = this.gh[k];
        if (k >= n) { x.g.visible = false; continue; }
        const lag = 0.06 * (k + 1) * (1.25 - 0.25 * this.ghS);
        Hist.at(t - lag, _cv);
        x.off.set(_cv.x - p.x, _cv.y - p.y, _cv.z - p.z);
        const d = Math.hypot(x.off.x, x.off.z);
        x.mat.uniforms.uAlpha.value = this.ghS * (k ? 0.15 : 0.24) * (kid ? 0.85 : 1) * clamp((d - 0.12) / 0.4, 0, 1);
        x.g.visible = d > 0.12 && pl.object.visible !== false;
      }
    },

    _stepRibbon(dt, t, l, pl, target) {
      const R0 = this.rb;
      this.rbS += (target - this.rbS) * dampK(target > this.rbS ? 3 : 4, dt);
      if (this.rbS < 0.02 || Hist.n < 2) { if (R0.mesh.visible) R0.mesh.visible = false; return; }
      const span = 0.32;
      for (let i = 0; i < RB_N; i++) {
        const u = i / (RB_N - 1);
        Hist.at(t - u * span, _cv);
        _rx[i] = _cv.x; _ry[i] = _cv.y; _rz[i] = _cv.z;
      }
      // the newest point sits at the current feet
      _rx[0] = pl.position.x; _ry[0] = pl.position.y; _rz[0] = pl.position.z;
      let tx = Math.sin(pl.rotY || 0), tz = Math.cos(pl.rotY || 0);
      const P = R0.pos, A = R0.alpha;
      const s = this.rbS * (l > 1 ? 0.5 : 0.36);
      for (let i = 0; i < RB_N; i++) {
        const a = Math.max(0, i - 1), b = Math.min(RB_N - 1, i + 1);
        const dx = _rx[a] - _rx[b], dz = _rz[a] - _rz[b], dl = Math.hypot(dx, dz);
        if (dl > 1e-4) { tx = dx / dl; tz = dz / dl; }
        const u = i / (RB_N - 1);
        const w = 0.34 * (1 - 0.65 * u) * (0.65 + 0.35 * this.rbS);
        const sx = -tz * w, sz = tx * w, y = _ry[i] + 0.05;
        const o = i * 6;
        P[o] = _rx[i] + sx; P[o + 1] = y; P[o + 2] = _rz[i] + sz;
        P[o + 3] = _rx[i] - sx; P[o + 4] = y; P[o + 5] = _rz[i] - sz;
        const al = s * Math.pow(1 - u, 1.6);
        A[i * 2] = al; A[i * 2 + 1] = al;
      }
      R0.pa.needsUpdate = true; R0.aa.needsUpdate = true;
      if (!R0.mesh.visible) R0.mesh.visible = true;
    },

    /** one footprint at the player's feet; frac = where along this frame's path (0 = last frame, 1 = now) */
    footprint(pl, frac = 1, l = 2, landing = false) {
      if (!this.ready || !l || !pl?.position) return;
      const p = pl.position;
      // interpolate along this frame's path — never across a teleport jump (> 6 m)
      const lerpOk = this.hasPrev && frac < 1 && (p.x - this.prev.x) ** 2 + (p.z - this.prev.z) ** 2 < 36;
      const x = lerpOk ? this.prev.x + (p.x - this.prev.x) * frac : p.x;
      const z = lerpOk ? this.prev.z + (p.z - this.prev.z) * frac : p.z;
      let surf = 'grass';
      try { surf = G.world?.surfaceAt?.(x, z) || 'grass'; } catch (e) { surf = 'grass'; }
      if (surf === 'water') return;
      const wet = wetness(), snow = weatherId() === 'SNOW';
      let col, a;
      if (snow && surf !== 'wood') { col = 0x8ea6c2; a = 0.42; }
      else if (surf === 'dirt') { col = 0x3a2617; a = 0.36 + 0.12 * wet; }
      else if (surf === 'sand') { col = 0x5e4628; a = 0.36; }
      else if (surf === 'grass') { col = 0x263a1b; a = 0.26 + 0.12 * wet; }
      else if (wet > 0.3) { col = 0x1b1d20; a = 0.22 * wet; }          // wet prints on stone / road / wood
      else return;
      const fp = this.fp;
      const yaw = pl.rotY || 0;
      const side = landing ? 0 : (this.fpSide = -this.fpSide);
      const fx = Math.sin(yaw), fz = Math.cos(yaw);
      const rx = -fz, rz = fx;                                     // character right (+Z facing: right = -X)
      for (let j = 0, nPrints = landing ? 2 : 1; j < nPrints; j++) {   // landing: both feet, else the next foot
        const sd = landing ? (j ? 1 : -1) : side;
        const px = x + rx * 0.12 * sd, pz = z + rz * 0.12 * sd;
        const gy = groundAt(px, pz, p.y + 0.6);
        // slope normal from four height samples
        const hx0 = groundAt(px - 0.25, pz, gy + 0.5), hx1 = groundAt(px + 0.25, pz, gy + 0.5);
        const hz0 = groundAt(px, pz - 0.25, gy + 0.5), hz1 = groundAt(px, pz + 0.25, gy + 0.5);
        _cn.set(-(hx1 - hx0) / 0.5, 1, -(hz1 - hz0) / 0.5);
        const nl = _cn.length();
        if (!(nl > 1e-6) || !fin(nl)) _cn.set(0, 1, 0); else _cn.multiplyScalar(1 / nl);
        if (_cn.y < 0.55) continue;                                // steep step / wall edge: no print
        _cf.set(fx, 0, fz).addScaledVector(_cn, -(fx * _cn.x + fz * _cn.z));
        const fl = _cf.length();
        if (!(fl > 1e-6)) continue;
        _cf.multiplyScalar(1 / fl);
        _cr.crossVectors(_cf, _cn);
        const rl = _cr.length();
        if (!(rl > 1e-6)) continue;
        _cr.multiplyScalar(1 / rl);
        _cb.copy(_cf).negate();
        _cm4.makeBasis(_cr, _cn, _cb);
        _cm4.setPosition(px + _cn.x * 0.015, gy + 0.02, pz + _cn.z * 0.015);
        const i = this.fpI;
        this.fpI = (this.fpI + 1) % FP_CAP;
        fp.mesh.setMatrixAt(i, _cm4);
        fp.data[i * 4] = this.t; fp.data[i * 4 + 1] = clamp(a, 0, 0.6); fp.data[i * 4 + 2] = sd < 0 ? -1 : 1; fp.data[i * 4 + 3] = 0;
        _c2.setHex(col);
        fp.col[i * 3] = _c2.r; fp.col[i * 3 + 1] = _c2.g; fp.col[i * 3 + 2] = _c2.b;
      }
      fp.mesh.instanceMatrix.needsUpdate = true; fp.ad.needsUpdate = true; fp.ac.needsUpdate = true;
      fp.mat.uniforms.uLife.value = l > 1 ? 7 : 4;
      this.fpLast = this.t;
    },

    /** dust shock ring + a crown of puffs blown outwards on a landing (normal blending: dust, not light) */
    landRing(pl, power, l = 2) {
      if (!fx._normal) return;
      const p = pl.position;
      let surf = 'grass';
      try { surf = G.world?.surfaceAt?.(p.x, p.z) || 'grass'; } catch (e) { surf = 'grass'; }
      if (surf === 'water') return;
      const col = SURFACE_DUST[surf] || SURFACE_DUST.grass;
      resetSP(); SP.kind = K.SHOCK; SP.flags = F_FLAT | F_GROW; SP.life = 0.6; SP.s0 = 0.4; SP.s1 = 1.5 + power * 0.9; SP.a0 = 0.62; SP.drag = 0; SP.fout = 0.35; SP.color = col; SP.rot = rnd() * TAU;
      spawn(fx._normal, p.x, p.y + 0.05, p.z, 0, 0, 0);
      const n = l > 1 ? 10 : 5, a0 = rnd() * TAU;
      for (let i = 0; i < n; i++) {
        const a = a0 + (i / n) * TAU + R(-0.15, 0.15), v = R(1.6, 2.6) * Math.min(1.6, power);
        resetSP(); SP.kind = K.PUFF; SP.life = R(0.5, 0.75); SP.s0 = 0.16; SP.s1 = R(0.42, 0.6); SP.a0 = 0.6; SP.grav = 0.25; SP.drag = 3.2;
        SP.floor = p.y; SP.color = col;
        spawn(fx._normal, p.x + Math.cos(a) * 0.25, p.y + 0.08, p.z + Math.sin(a) * 0.25, Math.cos(a) * v, R(0.25, 0.55), Math.sin(a) * v);
      }
    },

    portal(pos, mode) {
      if (!this.ready && !this.build()) return false;
      let P = this.pt.find((x) => !x.active);
      if (!P) P = this.pt.reduce((a, b) => (a.t > b.t ? a : b));
      const reduce = !motion();
      P.mode = mode; P.t = 0; P.active = true; P.acc = 0; P.burst = false;
      P.dur = reduce ? 0.9 : mode === 'in' ? 1.35 : 0.95;
      lightBlend(P.colMat); lightBlend(P.discMat);   // the preset (composer or straight to the canvas) may have changed
      P.g.position.copy(pos);
      P.g.position.y = groundAt(pos.x, pos.z, pos.y + 0.6);
      P.colMat.uniforms.uDir.value = mode === 'in' ? 1 : -1;
      P.g.visible = true;
      fx.ripple(P.g.position, { color: '#ffe08a', radius: 2.2, duration: 1.0, rings: lv() > 1 ? 2 : 1 });
      return true;
    },
    _stepPortal(P, dt, t, l, mo) {
      P.t += dt;
      const k = P.t / P.dur;
      if (k >= 1 || !G.state) { P.active = false; P.g.visible = false; return; }
      const fadeIn = clamp(P.t / 0.1, 0, 1), fadeOut = 1 - smooth(0.8, 1, k);
      const u = P.colMat.uniforms;
      u.uTime.value = mo ? t : 0;
      u.uOp.value = fadeIn * fadeOut * (mo ? 1 : 0.6);
      // 'in': solid light that burns away from the feet up (the character appears); 'out': forms, then burns top-down
      u.uProg.value = mo ? (P.mode === 'in' ? smooth(0.12, 0.92, k) : smooth(0.25, 0.95, k)) : 0;
      const rad = 0.62 + (mo ? 0.08 * Math.sin(P.t * 5) : 0);
      P.col.scale.set(rad, 2.5 + (P.mode === 'in' ? 0.4 * k : -0.5 * k), rad);
      const grow = easeOutQuint(Math.min(1, P.t / 0.45));
      P.disc.scale.setScalar(Math.max(0.05, 3.2 * (0.35 + 0.65 * grow)));
      P.disc.position.y = 0.03;
      if (mo) P.disc.rotation.y += dt * 1.1;
      P.discMat.opacity = 0.9 * fadeIn * fadeOut;
      // spiral sparks rising with the scan line
      if (mo && l > 0 && k < 0.8) {
        P.acc += dt * (l > 1 ? 30 : 12);
        const g = P.g.position;
        while (P.acc >= 1) {
          P.acc -= 1;
          const a = P.t * 9 + (rnd() < 0.5 ? 0 : Math.PI) + R(-0.25, 0.25), r = R(0.55, 0.85);
          resetSP(); SP.kind = rnd() < 0.6 ? K.SPARK : K.STAR; SP.life = R(0.6, 1.0); SP.s0 = R(0.12, 0.22); SP.s1 = 0.02; SP.grav = 0; SP.drag = 0.6;
          SP.flags = F_TWINKLE; SP.spin = R(-3, 3); SP.bri = 1.6; SP.color = PAL.stars[(rnd() * PAL.stars.length) | 0];
          spawn(fx._add, g.x + Math.cos(a) * r, g.y + R(0.05, 0.4) + k * 1.8, g.z + Math.sin(a) * r, -Math.sin(a) * 0.9, R(1.4, 2.6), Math.cos(a) * 0.9);
        }
      }
      if (!P.burst && k > 0.78) {
        P.burst = true;
        if (P.mode === 'in') fx.burst('stars', P.g.position, { count: 10, lift: 1.1, spread: 0.8 });
      }
    },

    banner(zone) {
      if (!this.ready && !this.build()) return false;
      if (cinematic() || !G.state) return false;
      const B = this.ban, kid = kidOn();
      const key = `${zone.id}|${kid ? 'k' : 'n'}`;
      let tex = this.banTex.get(key);
      if (!tex) {
        const ZE = { ZONE_MAIN: '⛲', ZONE_CROP: '🌱', ZONE_HALL: '🏛️', ZONE_HERB: '🌿', ZONE_EDUCATION: '📖', ZONE_FERMENTATION: '🍲', ZONE_JANGDOKDAE: '🏺', ZONE_REST: '🌸', ZONE_ENTRANCE: '🚪', ZONE_MANJANGDAE: '🏔️' };
        const name = String(zone.name || '').replace(/[\u0000-\u001f<>]/g, '').slice(0, 16) || '새로운 곳';
        const emoji = cleanEmoji(zone.emoji) || ZE[zone.id] || '📍';
        const sub = kid ? '새로운 곳이에요!' : '새로운 구역 발견';
        tex = G.gfx.canvasTexture(1024, 330, (ctx, w, h) => drawBanner(ctx, w, h, name, sub, emoji));
        if (this.banTex.size > 16) { const first = this.banTex.keys().next().value; this.banTex.get(first)?.dispose?.(); this.banTex.delete(first); }
        this.banTex.set(key, tex);
      }
      B.board.material.map = tex; B.board.material.needsUpdate = true;
      B.t = 0; B.active = true; B.snap = true; B.burst = false; B.zone = zone.id; B.g.visible = true;
      B.chk = 0; B.covered = false;
      B.dur = kid ? 3.8 : 3.4;
      return true;
    },
    _stepBanner(dt, t, mo) {
      const B = this.ban;
      const cam = G.sys.engine?.camera;
      B.t += dt;
      // the top HUD bars' bottom edge and the onboarding coach card: DOM reads ~4× a second, not every frame
      if (cam && (B.chk -= dt) <= 0) {
        B.chk = 0.25;
        const s = this._banSpot(cam);
        B.top = s.top; B.covered = coachOver(s.l, s.t, s.r, s.b);
      }
      // left the zone (fast travel, teleport, walked on) or the coach card came up over it: the board lifts away now
      // instead of naming the wrong place / showing under the card
      const zNow = G.sys.minimap?.currentZone?.id || G.state?.player?.zoneId || null;
      // (the fade-out starts from where the board is now: the end moves up to 0.6 s from now, B.t keeps running)
      if (((zNow && B.zone && zNow !== B.zone) || B.covered) && B.t < B.dur - 0.6) B.dur = B.t + 0.6;
      if (!cam || B.t >= B.dur || !G.state || cinematic()) { B.active = false; B.g.visible = false; return; }
      const spot = this._banSpot(cam, B.top), sc = spot.f.sc;
      // BAN_DIST m in front of the camera, ~30 % above the screen centre or just under the top HUD bars
      _cv.set(0, 0, -1).applyQuaternion(cam.quaternion);
      _cv2.set(0, 1, 0).applyQuaternion(cam.quaternion);
      const want = _cb.copy(cam.position).addScaledVector(_cv, BAN_DIST).addScaledVector(_cv2, spot.f.visH * (0.5 - spot.yc / innerHeight));
      // a soft spring gives it depth when the camera turns; the camera's own travel carries the board along (left to the
      // spring it trailed ~v/10 m: at the 18 m/s run it hung 1.5 m closer, half again as big, over the HUD)
      if (B.snap || !mo) { B.pos.copy(want); B.snap = false; }
      else {
        B.pos.add(_cd.subVectors(cam.position, B.cam)); B.pos.lerp(want, dampK(10, dt));
        // the swing stays on screen: on a phone the board is 84 % of the view wide (little room beside it) and the HUD
        // bars may sit right above it
        const f = spot.f, dv = _cd.subVectors(B.pos, want);
        _ce.set(1, 0, 0).applyQuaternion(cam.quaternion);
        const mx = Math.max(0, (f.visW - 2.8 * sc * 1.06) / 2), my = Math.max(0, ((spot.t - spot.top - 6) / innerHeight) * f.visH);
        B.pos.copy(want).addScaledVector(_ce, clamp(dv.dot(_ce), -mx, mx)).addScaledVector(_cv2, clamp(dv.dot(_cv2), -0.4 * sc, my))
          .addScaledVector(_cv, clamp(dv.dot(_cv), -0.4, 0.4));
      }
      B.cam.copy(cam.position);
      const tOut = B.dur - 0.6;
      const out = B.t > tOut ? clamp((B.t - tOut) / 0.6, 0, 1) : 0;
      B.g.position.copy(B.pos);
      if (mo) B.g.position.addScaledVector(_cv2, Math.sin(B.t * 2.4) * 0.03 * sc + out * 0.35 * sc);
      B.g.quaternion.copy(cam.quaternion);
      if (mo) { B.g.rotateY(Math.sin(B.t * 1.7) * 0.06 * (1 - out)); B.g.rotateZ(Math.sin(B.t * 2.1 + 0.6) * 0.018); }
      // unroll sideways (ease-out-quint, no overshoot), hold, then lift away while fading
      const open = mo ? easeOutQuint(B.t / 0.55) : 1;
      B.g.scale.set(sc * Math.max(0.04, open), sc * (1 - 0.18 * out), sc);
      const op = clamp(B.t / 0.22, 0, 1) * (1 - out);
      B.board.material.opacity = op;
      B.glow.material.opacity = op * 0.55;
      if (!B.burst && B.t > tOut && lv() > 0) {
        B.burst = true;
        fx.burst('petals', _cb.copy(B.g.position).addScaledVector(_cv2, -0.2), { count: 14, lift: 0, spread: 0.8, up: 0.5 });
      }
    },

    hideAll() {
      if (!this.ready) return;
      this.sl.mesh.visible = false; this.rb.mesh.visible = false;
      for (const x of this.gh) x.g.visible = false;
      this._vignette(0);
    },
    clear() {
      if (!this.ready) return;
      this.hideAll();
      this.slS = 0; this.ghS = 0; this.rbS = 0;
      for (const P of this.pt) { P.active = false; P.g.visible = false; }
      this.ban.active = false; this.ban.g.visible = false;
      document.body?.classList.remove('fx-zone3d'); this.banCls = false;
      for (let i = 0; i < FP_CAP; i++) this.fp.data[i * 4] = -1e5;
      this.fp.ad.needsUpdate = true; this.fp.mesh.visible = false; this.fpLast = -1e9;
    },
    reset() { this.clear(); Hist.reset(); this.hasPrev = false; },
    stats() {
      if (!this.ready) return { built: false, drawCalls: 0 };
      const vis = [this.sl.mesh, this.rb.mesh, this.fp.mesh, ...this.gh.map((x) => x.g)].filter((m) => m.visible).length
        + this.pt.filter((P) => P.active).length * 2 + (this.ban.active ? 2 : 0);
      return {
        built: true, speedLines: +this.slS.toFixed(3), afterimage: +this.ghS.toFixed(3), ribbon: +this.rbS.toFixed(3),
        footprints: this.fp.data.filter((v, i) => i % 4 === 0 && v > this.t - this.fp.mat.uniforms.uLife.value).length,
        portals: this.pt.filter((P) => P.active).length, banner: this.ban.active ? this.ban.zone : null, history: Hist.n, drawCalls: vis,
      };
    },
  };

  // ---------------------------------------------------------------- 2D rain shapes (centred on 0,0; r = outer radius)
  function starPath(ctx, r) {
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5, rr = i % 2 ? r * 0.45 : r;
      if (i) ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); else ctx.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
    }
    ctx.closePath();
  }
  function heartPath(ctx, r) {
    ctx.beginPath();
    ctx.moveTo(0, r * 0.9);
    ctx.bezierCurveTo(-r * 1.25, r * 0.1, -r * 0.75, -r * 0.95, 0, -r * 0.35);
    ctx.bezierCurveTo(r * 0.75, -r * 0.95, r * 1.25, r * 0.1, 0, r * 0.9);
    ctx.closePath();
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
    kidParty: (p, o) => fx.kidParty(p, o),
    portal: (p, o) => fx.portal(p, o),
    pillar: (p, o) => fx.pillar(p, o),
    zoneBanner: (z) => fx.zoneBanner(z),
    itemFly: (f, w, o) => fx.itemFly(f, w, o),
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
