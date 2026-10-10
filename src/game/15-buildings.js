// =============================================================================
// 15-buildings.js — procedural architecture of the 전통발효체험관 campus.
//
//   G.bkit                   shared building kit (also used by 16-props.js):
//     col(hex) / M(...) / mul(a,b)          colour + matrix helpers
//     tex(name) / mat(key)                  procedural canvas textures + shared materials
//     Bucket                                per-material geometry accumulator -> merged meshes
//     geo.{box,cyl,lathe,quad,grid,sweep,disc,ring,tube}   primitives with metre UVs
//     roof(B, M, opts)                      hanok roof generator (팔작 / 우진각 / 맞배 / skirt)
//     polyRoof(B, M, opts)                  regular-polygon pavilion roof (육모 정자)
//     jarProfile(kind) / jarGeometry(kind, seg) / lidGeometry(seg)   onggi lathe profiles
//     SignAtlas                             many sign textures in one canvas (1 draw call)
//     Site                                  per-object helper (world transforms, colliders, walkables, blockers)
//
//   G.sys.buildings (order 20): every G.data.layout.buildings entry with box colliders,
//   camera blockers, G.world.registerObject(id, group) and G.assets.tryOverride(id, group).
//     get(id) -> group, list() -> [{id, type, group}]
// =============================================================================
(function () {
  const L = G.data.layout || {};
  const PI = Math.PI, TAU = PI * 2;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const FONT = '"PretendardEmbed","Pretendard","Noto Sans KR","Apple SD Gothic Neo","Malgun Gothic",sans-serif';

  // ---------------------------------------------------------------- colour & matrix helpers
  const _cc = new Map();
  /** linear-space THREE.Color from '#rrggbb' (cached, do not mutate) */
  function col(hex) {
    if (hex && hex.isColor) return hex;
    let c = _cc.get(hex);
    if (!c) { c = new THREE.Color(hex); _cc.set(hex, c); }
    return c;
  }
  const _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(), _p = new THREE.Vector3();
  /** Matrix4 from translation, yaw (ry), scale and optional pitch/roll (Euler order YXZ) */
  function M(x = 0, y = 0, z = 0, ry = 0, sx = 1, sy = sx, sz = sx, rx = 0, rz = 0) {
    _e.set(rx, ry, rz, 'YXZ');
    _q.setFromEuler(_e);
    return new THREE.Matrix4().compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz));
  }
  const mul = (a, b) => new THREE.Matrix4().multiplyMatrices(a, b);
  const I4 = new THREE.Matrix4();
  const rngOf = (name) => G.util.rng('bk:' + name);

  // ---------------------------------------------------------------- procedural textures
  function speckle(ctx, w, h, rnd, n, colors, a0 = 0.05, a1 = 0.18, s0 = 1, s1 = 2.5) {
    for (let i = 0; i < n; i++) {
      ctx.globalAlpha = a0 + rnd() * (a1 - a0);
      ctx.fillStyle = colors[(rnd() * colors.length) | 0];
      const s = s0 + rnd() * (s1 - s0);
      ctx.fillRect(rnd() * w, rnd() * h, s, s);
    }
    ctx.globalAlpha = 1;
  }
  function blotches(ctx, w, h, rnd, n, colors, r0, r1, a = 0.06) {
    for (let i = 0; i < n; i++) {
      const x = rnd() * w, y = rnd() * h, r = r0 + rnd() * (r1 - r0);
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      const c = colors[(rnd() * colors.length) | 0];
      g.addColorStop(0, c); g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.globalAlpha = a; ctx.fillStyle = g;
      // wrap so the texture tiles
      for (const ox of [-w, 0, w]) for (const oy of [-h, 0, h]) { ctx.save(); ctx.translate(ox, oy); ctx.fillRect(x - r, y - r, r * 2, r * 2); ctx.restore(); }
    }
    ctx.globalAlpha = 1;
  }
  function roundRect(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  const ctex = (w, h, draw, tile, opts = {}) => G.gfx.canvasTexture(w, h, draw, { repeat: tile ? [1 / tile[0], 1 / tile[1]] : [1, 1], anisotropy: 8, ...opts });

  const PAINT = {
    // 기와 (dark grey giwa): ribs along V; 1 tile = 1.2 m x 1.2 m (4 rows of cover tiles)
    tile: () => ctex(256, 256, (ctx, w, h) => {
      const r = rngOf('tile');
      ctx.fillStyle = '#2f3134'; ctx.fillRect(0, 0, w, h);
      const n = 4, cw = w / n;
      for (let i = 0; i < n; i++) {
        const x0 = i * cw;
        let g = ctx.createLinearGradient(x0, 0, x0 + cw, 0);
        g.addColorStop(0, '#222427'); g.addColorStop(0.18, '#36383b'); g.addColorStop(0.5, '#2c2e31'); g.addColorStop(0.82, '#36383b'); g.addColorStop(1, '#222427');
        ctx.fillStyle = g; ctx.fillRect(x0, 0, cw, h);
        // convex cover tile (수키와) rib
        const rx = x0 + cw * 0.5 - cw * 0.21, rw = cw * 0.42;
        ctx.fillStyle = 'rgba(8,9,10,0.6)'; ctx.fillRect(rx + rw, 0, cw * 0.07, h); // cast shadow
        g = ctx.createLinearGradient(rx, 0, rx + rw, 0);
        g.addColorStop(0, '#1c1e20'); g.addColorStop(0.28, '#5c5f63'); g.addColorStop(0.5, '#4a4d51'); g.addColorStop(0.85, '#2c2e31'); g.addColorStop(1, '#191b1d');
        ctx.fillStyle = g; ctx.fillRect(rx, 0, rw, h);
        // tile course joints
        for (let k = 0; k < 4; k++) {
          const y = k * (h / 4) + r() * 3;
          ctx.fillStyle = 'rgba(8,9,10,0.75)'; ctx.fillRect(rx, y, rw, 3);
          ctx.fillStyle = 'rgba(150,152,156,0.2)'; ctx.fillRect(rx, y + 3, rw, 2);
          ctx.fillStyle = 'rgba(8,9,10,0.25)'; ctx.fillRect(x0, y + h / 8, cw, 2);
        }
      }
      blotches(ctx, w, h, r, 26, ['#5d6656', '#1d1f21', '#6b6e72'], 8, 30, 0.08);
      speckle(ctx, w, h, r, 1600, ['#101112', '#7c7f83', '#3e4144'], 0.05, 0.22);
    }, [1.2, 1.2]),
    tileBump: () => ctex(256, 256, (ctx, w, h) => {
      ctx.fillStyle = '#404040'; ctx.fillRect(0, 0, w, h);
      const n = 4, cw = w / n;
      for (let i = 0; i < n; i++) {
        const x0 = i * cw;
        let g = ctx.createLinearGradient(x0, 0, x0 + cw, 0);
        g.addColorStop(0, '#606060'); g.addColorStop(0.5, '#303030'); g.addColorStop(1, '#606060');
        ctx.fillStyle = g; ctx.fillRect(x0, 0, cw, h);
        const rx = x0 + cw * 0.29, rw = cw * 0.42;
        g = ctx.createLinearGradient(rx, 0, rx + rw, 0);
        g.addColorStop(0, '#707070'); g.addColorStop(0.5, '#ffffff'); g.addColorStop(1, '#707070');
        ctx.fillStyle = g; ctx.fillRect(rx, 0, rw, h);
        for (let k = 0; k < 4; k++) { ctx.fillStyle = '#202020'; ctx.fillRect(rx, k * (h / 4), rw, 3); }
      }
    }, [1.2, 1.2], { srgb: false }),
    // eave edge: 막새 (tile ends) on top, 부연 + 서까래 rafter ends below. 0.6 m x full height (v 0..1)
    fascia: () => ctex(256, 128, (ctx, w, h) => {
      const r = rngOf('fascia');
      ctx.fillStyle = '#2a2420'; ctx.fillRect(0, 0, w, h);
      // tile ends (upper 44 %)
      const th = h * 0.44;
      ctx.fillStyle = '#30353a'; ctx.fillRect(0, 0, w, th);
      for (let i = 0; i < 2; i++) {
        const cx = w * (0.25 + i * 0.5), cy = th * 0.52, rr = th * 0.42;
        // 암막새 between discs
        ctx.fillStyle = '#3b4046';
        ctx.beginPath(); ctx.ellipse(cx + w * 0.25, th * 0.62, w * 0.13, th * 0.3, 0, 0, PI); ctx.fill();
        const g = ctx.createRadialGradient(cx - rr * 0.3, cy - rr * 0.3, 1, cx, cy, rr);
        g.addColorStop(0, '#7b828a'); g.addColorStop(0.7, '#4b5157'); g.addColorStop(1, '#2a2e33');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, rr, 0, TAU); ctx.fill();
        ctx.strokeStyle = 'rgba(200,205,210,0.35)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(cx, cy, rr * 0.72, 0, TAU); ctx.stroke();
        ctx.fillStyle = 'rgba(210,215,220,0.4)';
        for (let k = 0; k < 8; k++) { const a = k / 8 * TAU; ctx.beginPath(); ctx.arc(cx + Math.cos(a) * rr * 0.45, cy + Math.sin(a) * rr * 0.45, 2, 0, TAU); ctx.fill(); }
      }
      // 평고대 board
      ctx.fillStyle = '#4a3423'; ctx.fillRect(0, th, w, h * 0.08);
      // 부연 (square flying-rafter ends) and 서까래 (round rafter ends)
      const y1 = th + h * 0.08;
      for (let i = 0; i < 2; i++) {
        const cx = w * (0.25 + i * 0.5);
        ctx.fillStyle = '#2f6b5a'; ctx.fillRect(cx - 17, y1 + 3, 34, h * 0.2);
        ctx.fillStyle = '#e8e2cf'; ctx.beginPath(); ctx.arc(cx, y1 + 3 + h * 0.1, 5, 0, TAU); ctx.fill();
        ctx.fillStyle = '#c0453a'; ctx.beginPath(); ctx.arc(cx, y1 + 3 + h * 0.1, 2.2, 0, TAU); ctx.fill();
        const cy = h * 0.85, rr = h * 0.13;
        const g = ctx.createRadialGradient(cx, cy, 1, cx, cy, rr);
        g.addColorStop(0, '#e2c08c'); g.addColorStop(0.55, '#b6884f'); g.addColorStop(0.7, '#2f6b5a'); g.addColorStop(1, '#244f45');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, rr, 0, TAU); ctx.fill();
      }
      speckle(ctx, w, h, r, 300, ['#000', '#fff'], 0.03, 0.1);
    }, [0.6, 1]),
    // eave underside: round rafters along V over boards. 0.6 m x 1.2 m
    soffit: () => ctex(128, 256, (ctx, w, h) => {
      const r = rngOf('soffit');
      ctx.fillStyle = '#c9a274'; ctx.fillRect(0, 0, w, h);
      for (let y = 0; y < h; y += 32) { ctx.fillStyle = 'rgba(80,50,25,0.35)'; ctx.fillRect(0, y, w, 2); }
      for (let i = 0; i < 2; i++) {
        const cx = w * (0.25 + i * 0.5), rw = w * 0.2;
        ctx.fillStyle = 'rgba(40,24,12,0.45)'; ctx.fillRect(cx - rw - 3, 0, rw * 2 + 6, h);
        const g = ctx.createLinearGradient(cx - rw, 0, cx + rw, 0);
        g.addColorStop(0, '#6a4024'); g.addColorStop(0.35, '#b07c4c'); g.addColorStop(0.6, '#9a6a3e'); g.addColorStop(1, '#5a361d');
        ctx.fillStyle = g; ctx.fillRect(cx - rw, 0, rw * 2, h);
      }
      speckle(ctx, w, h, r, 500, ['#3b2414', '#e6c9a0'], 0.04, 0.14);
    }, [0.6, 1.2]),
    // 한지 창호: left = 띠살 door, right = 용자살 window (UV 0..1 per panel)
    hanji: () => ctex(512, 256, (ctx, w, h) => {
      const r = rngOf('hanji');
      const half = w / 2;
      const paper = (x0) => {
        const g = ctx.createLinearGradient(0, 0, 0, h);
        g.addColorStop(0, '#f3e9d0'); g.addColorStop(1, '#e9dcbc');
        ctx.fillStyle = g; ctx.fillRect(x0, 0, half, h);
        ctx.save(); ctx.beginPath(); ctx.rect(x0, 0, half, h); ctx.clip();
        speckle(ctx, w, h, r, 900, ['#c8b48c', '#fffaf0'], 0.05, 0.2, 1, 3);
        ctx.restore();
      };
      const wood = '#5b3a22';
      paper(0); paper(half);
      ctx.fillStyle = wood;
      // 띠살문
      for (let i = 1; i < 10; i++) ctx.fillRect(i * half / 10 - 1.5, 0, 3, h);
      for (const yc of [0.14, 0.5, 0.86]) for (let k = -1; k <= 1; k++) ctx.fillRect(0, yc * h + k * 9 - 1.5, half, 3);
      ctx.lineWidth = 14; ctx.strokeStyle = wood; ctx.strokeRect(7, 7, half - 14, h - 14);
      // 용자살 window
      for (let i = 1; i < 4; i++) ctx.fillRect(half + i * half / 4 - 2, 0, 4, h);
      for (let i = 1; i < 5; i++) ctx.fillRect(half, i * h / 5 - 2, half, 4);
      ctx.strokeRect(half + 7, 7, half - 14, h - 14);
      ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(half - 1, 0, 2, h);
    }),
    plaster: () => ctex(256, 256, (ctx, w, h) => {
      const r = rngOf('plaster');
      ctx.fillStyle = '#ece6da'; ctx.fillRect(0, 0, w, h);
      blotches(ctx, w, h, r, 40, ['#ffffff', '#d8cfbf', '#cfc6b4'], 10, 40, 0.08);
      speckle(ctx, w, h, r, 2000, ['#bdb3a2', '#ffffff'], 0.04, 0.12);
      ctx.globalAlpha = 0.05; ctx.strokeStyle = '#8a7f6d';
      for (let i = 0; i < 18; i++) { const y = r() * h; ctx.beginPath(); ctx.moveTo(0, y); ctx.bezierCurveTo(w * 0.3, y + 6, w * 0.6, y - 6, w, y + r() * 4); ctx.stroke(); }
      ctx.globalAlpha = 1;
    }, [2, 2]),
    // dressed granite blocks (장대석): 2 m x 2 m, 6 courses
    stone: () => ctex(256, 256, (ctx, w, h) => {
      const r = rngOf('stone');
      ctx.fillStyle = '#6c675f'; ctx.fillRect(0, 0, w, h);
      const rows = 6, rh = h / rows;
      for (let j = 0; j < rows; j++) {
        let x = -r() * 60;
        while (x < w) {
          const bw = 56 + r() * 70;
          const l = 47 + r() * 14, s = 5 + r() * 7;
          ctx.fillStyle = `hsl(${32 + r() * 14},${s}%,${l}%)`;
          const drawB = (ox) => {
            ctx.fillRect(x + 1.5 + ox, j * rh + 1.5, bw - 3, rh - 3);
            ctx.fillStyle = 'rgba(255,255,255,0.10)'; ctx.fillRect(x + 1.5 + ox, j * rh + 1.5, bw - 3, 3);
            ctx.fillStyle = 'rgba(0,0,0,0.12)'; ctx.fillRect(x + 1.5 + ox, j * rh + rh - 5, bw - 3, 3);
          };
          const fs = ctx.fillStyle; drawB(0); if (x + bw > w) { ctx.fillStyle = fs; drawB(-w); }
          x += bw;
        }
      }
      speckle(ctx, w, h, r, 2600, ['#2e2b27', '#d9d4ca', '#8d877c'], 0.05, 0.2);
    }, [2, 2]),
    // field stones (석축 / 돌담): flat-faced irregular stones in rough courses, 2 m x 2 m
    fieldstone: () => ctex(256, 256, (ctx, w, h) => {
      const r = rngOf('fieldstone');
      ctx.fillStyle = '#36322c'; ctx.fillRect(0, 0, w, h);
      const tones = ['#7f796d', '#8f8778', '#6f6a60', '#9a9180', '#857b69', '#787267', '#8d8577', '#a19887', '#6a6458'];
      let y = -4;
      while (y < h) {
        const rh = 20 + r() * 14;
        let x = -r() * 24;
        while (x < w) {
          const rw = 24 + r() * 36;
          const cx = x + rw / 2, cy = y + rh / 2 + (r() - 0.5) * 3;
          const n = 7 + ((r() * 3) | 0), pts = [];
          for (let k = 0; k < n; k++) {
            const a = (k / n) * TAU + (r() - 0.5) * 0.5;
            const kx = rw * 0.5 * (0.84 + r() * 0.16), ky = rh * 0.5 * (0.8 + r() * 0.2);
            pts.push([Math.cos(a) * kx, Math.sin(a) * ky]);
          }
          const tone = tones[(r() * tones.length) | 0];
          for (const ox of [-w, 0, w]) for (const oy of [-h, 0, h]) {
            const px = cx + ox, py = cy + oy;
            if (px < -50 || px > w + 50 || py < -50 || py > h + 50) continue;
            ctx.beginPath(); pts.forEach(([a, b], k) => (k ? ctx.lineTo(px + a, py + b) : ctx.moveTo(px + a, py + b))); ctx.closePath();
            ctx.fillStyle = tone; ctx.fill();
            const g = ctx.createLinearGradient(0, py - rh / 2, 0, py + rh / 2);
            g.addColorStop(0, 'rgba(255,248,235,0.16)'); g.addColorStop(0.45, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.22)');
            ctx.fillStyle = g; ctx.fill();
            ctx.strokeStyle = 'rgba(20,18,15,0.55)'; ctx.lineWidth = 1.5; ctx.stroke();
          }
          x += rw * (0.95 + r() * 0.08);
        }
        y += rh * 0.95;
      }
      speckle(ctx, w, h, r, 2200, ['#26231f', '#cfc8ba', '#5e594f'], 0.05, 0.18);
    }, [2, 2]),
    // wood with grain along V: 0.5 m x 2 m
    wood: () => ctex(128, 256, (ctx, w, h) => {
      const r = rngOf('wood');
      ctx.fillStyle = '#c69d70'; ctx.fillRect(0, 0, w, h);
      for (let i = 0; i < 46; i++) {
        const x = r() * w, a = 0.08 + r() * 0.16;
        ctx.strokeStyle = r() < 0.5 ? `rgba(92,58,30,${a})` : `rgba(240,214,170,${a * 0.8})`;
        ctx.lineWidth = 0.6 + r() * 1.6;
        ctx.beginPath(); ctx.moveTo(x, 0);
        const amp = 1 + r() * 3, f = 0.01 + r() * 0.03, ph = r() * 6;
        for (let y = 0; y <= h; y += 8) ctx.lineTo(x + Math.sin(y * f + ph) * amp, y);
        ctx.stroke();
      }
      for (let i = 0; i < 3; i++) { const x = r() * w, y = r() * h; ctx.fillStyle = 'rgba(80,46,22,0.45)'; ctx.beginPath(); ctx.ellipse(x, y, 3 + r() * 3, 6 + r() * 6, 0, 0, TAU); ctx.fill(); }
      speckle(ctx, w, h, r, 500, ['#5a381c', '#ead1a6'], 0.04, 0.12);
    }, [0.5, 2]),
    // planks along U (decks / floors): 2 m x 2 m, 8 boards
    plank: () => ctex(256, 256, (ctx, w, h) => {
      const r = rngOf('plank');
      const n = 8, bh = h / n;
      for (let j = 0; j < n; j++) {
        const l = 52 + r() * 12;
        ctx.fillStyle = `hsl(${28 + r() * 8},${38 + r() * 12}%,${l}%)`;
        ctx.fillRect(0, j * bh, w, bh);
        for (let k = 0; k < 7; k++) {
          ctx.strokeStyle = `rgba(90,56,28,${0.08 + r() * 0.12})`; ctx.lineWidth = 1;
          const y = j * bh + 3 + r() * (bh - 6);
          ctx.beginPath(); ctx.moveTo(0, y); ctx.bezierCurveTo(w * 0.3, y + 2, w * 0.7, y - 2, w, y); ctx.stroke();
        }
        ctx.fillStyle = 'rgba(40,24,12,0.7)'; ctx.fillRect(0, j * bh, w, 2);
        const jx = r() * w; ctx.fillRect(jx, j * bh, 2, bh);
      }
      speckle(ctx, w, h, r, 700, ['#4a2e16', '#f0d7ad'], 0.04, 0.12);
    }, [2, 2]),
    // curtain-wall glass: 3 m x 4.2 m (one storey bay)
    glass: () => ctex(256, 512, (ctx, w, h) => {
      const r = rngOf('glass');
      let g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#8fb3c6'); g.addColorStop(0.35, '#4f7a8f'); g.addColorStop(1, '#2a4656');
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
      // interior hints
      ctx.fillStyle = 'rgba(20,32,40,0.55)'; ctx.fillRect(0, 0, w, h * 0.1);
      for (let x = 20; x < w; x += 42) { ctx.fillStyle = 'rgba(255,240,210,0.55)'; ctx.fillRect(x, h * 0.06, 14, 3); }
      for (let i = 0; i < 3; i++) { const x = r() * w * 0.8, bw = 30 + r() * 60; ctx.fillStyle = 'rgba(18,28,34,0.45)'; ctx.fillRect(x, h * (0.62 + r() * 0.1), bw, h); }
      ctx.fillStyle = 'rgba(160,120,80,0.18)'; ctx.fillRect(0, h * 0.86, w, h * 0.14);
      // reflections
      ctx.globalAlpha = 0.08; ctx.fillStyle = '#ffffff';
      for (let i = 0; i < 4; i++) { const x = r() * w; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + 40, 0); ctx.lineTo(x - 60, h); ctx.lineTo(x - 100, h); ctx.fill(); }
      ctx.globalAlpha = 1;
      // transom + centre mullion
      ctx.fillStyle = '#2f353b'; ctx.fillRect(0, h * 0.27, w, 7); ctx.fillRect(w / 2 - 3, 0, 6, h);
      ctx.fillStyle = 'rgba(220,230,235,0.35)'; ctx.fillRect(0, h * 0.27, w, 1.5); ctx.fillRect(w / 2 - 3, 0, 1.5, h);
      ctx.fillStyle = '#2f353b'; ctx.fillRect(0, 0, w, 4); ctx.fillRect(0, h - 4, w, 4);
    }, [3, 4.2]),
    glassEmit: () => ctex(256, 512, (ctx, w, h) => {
      const r = rngOf('glassEmit');
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, h);
      for (let i = 0; i < 2; i++) {
        const on = r() < 0.85, b = on ? 0.65 + r() * 0.35 : 0.08;
        const g = ctx.createLinearGradient(0, 0, 0, h);
        g.addColorStop(0, `rgba(255,236,200,${b})`); g.addColorStop(0.5, `rgba(255,205,140,${b * 0.85})`); g.addColorStop(1, `rgba(220,150,80,${b * 0.6})`);
        ctx.fillStyle = g; ctx.fillRect(i * w / 2, 0, w / 2, h);
      }
      for (let x = 20; x < w; x += 42) { ctx.fillStyle = '#fff6e0'; ctx.fillRect(x, h * 0.06, 14, 3); }
      ctx.fillStyle = '#000'; ctx.fillRect(0, h * 0.27, w, 7); ctx.fillRect(w / 2 - 3, 0, 6, h); ctx.fillRect(0, 0, w, 4); ctx.fillRect(0, h - 4, w, 4);
      for (let i = 0; i < 3; i++) { const x = r() * w * 0.8, bw = 30 + r() * 60; ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(x, h * (0.62 + r() * 0.1), bw, h); }
    }, [3, 4.2]),
    // straw thatch with rope net: 1.5 m x 1.5 m
    thatch: () => ctex(256, 256, (ctx, w, h) => {
      const r = rngOf('thatch');
      ctx.fillStyle = '#9c8152'; ctx.fillRect(0, 0, w, h);
      const tones = ['#c9ad6e', '#8a6d3d', '#d8c08a', '#6e5530', '#b39660', '#a38a5a'];
      for (let i = 0; i < 2600; i++) {
        const x = r() * w, y = r() * h, len = 10 + r() * 34;
        ctx.strokeStyle = tones[(r() * tones.length) | 0]; ctx.globalAlpha = 0.35 + r() * 0.5; ctx.lineWidth = 0.8 + r() * 1.4;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + (r() - 0.5) * 4, y + len); ctx.stroke();
        if (y + len > h) { ctx.beginPath(); ctx.moveTo(x, y - h); ctx.lineTo(x, y - h + len); ctx.stroke(); }
      }
      ctx.globalAlpha = 1;
      for (let y = 0; y < h; y += 64) { const g = ctx.createLinearGradient(0, y, 0, y + 64); g.addColorStop(0, 'rgba(255,240,200,0.06)'); g.addColorStop(1, 'rgba(40,28,10,0.16)'); ctx.fillStyle = g; ctx.fillRect(0, y, w, 64); }
      // 새끼줄 net
      ctx.strokeStyle = 'rgba(66,46,24,0.85)'; ctx.lineWidth = 3;
      for (const x of [64, 192]) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
      for (const y of [64, 192]) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
      ctx.strokeStyle = 'rgba(220,200,150,0.35)'; ctx.lineWidth = 1;
      for (const x of [62, 190]) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
      for (const y of [62, 190]) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
    }, [1.5, 1.5]),
    gravel: () => ctex(256, 256, (ctx, w, h) => {
      const r = rngOf('gravel');
      ctx.fillStyle = '#857d6e'; ctx.fillRect(0, 0, w, h);
      blotches(ctx, w, h, r, 30, ['#9a917f', '#6c655a'], 10, 40, 0.15);
      const tones = ['#a8a090', '#6f685d', '#8e8678', '#b8b0a0', '#5c564d', '#9a8f7a'];
      for (let i = 0; i < 2600; i++) {
        ctx.fillStyle = tones[(r() * tones.length) | 0]; ctx.globalAlpha = 0.5 + r() * 0.5;
        const s = 1 + r() * 3.2;
        ctx.beginPath(); ctx.ellipse(r() * w, r() * h, s, s * (0.6 + r() * 0.4), r() * 3, 0, TAU); ctx.fill();
      }
      ctx.globalAlpha = 1;
    }, [2, 2]),
    // onggi glaze (lathe UV: u around, v bottom->top)
    jar: () => ctex(128, 256, (ctx, w, h) => {
      const r = rngOf('jar');
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#2c180c'); g.addColorStop(0.07, '#432614'); g.addColorStop(0.45, '#56321c'); g.addColorStop(0.8, '#472815'); g.addColorStop(0.93, '#3a2011'); g.addColorStop(1, '#2c180c');
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
      for (let i = 0; i < 40; i++) {
        const x = r() * w, y0 = h * (0.05 + r() * 0.3), len = h * (0.15 + r() * 0.45);
        ctx.strokeStyle = r() < 0.5 ? 'rgba(130,82,48,0.35)' : 'rgba(20,10,4,0.4)'; ctx.lineWidth = 1 + r() * 3;
        ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x + (r() - 0.5) * 3, y0 + len); ctx.stroke();
      }
      // 수화문 (finger-drawn grass band) on the shoulder
      ctx.strokeStyle = 'rgba(150,104,66,0.7)'; ctx.lineWidth = 2.2;
      ctx.beginPath();
      for (let x = 0; x <= w; x += 2) { const y = h * 0.36 + Math.sin(x / w * TAU * 4) * 7; if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); }
      ctx.stroke();
      for (let i = 0; i < 8; i++) { const x = (i + 0.5) * w / 8; ctx.beginPath(); ctx.moveTo(x, h * 0.36 + 6); ctx.quadraticCurveTo(x + 6, h * 0.3, x + 2, h * 0.24); ctx.stroke(); }
      speckle(ctx, w, h, r, 400, ['#1a0e06', '#c08a5a'], 0.05, 0.18);
    }),
    // wooden balustrade with alpha (난간): 1.5 m x 0.9 m (v 0..1 = height)
    railing: () => ctex(256, 128, (ctx, w, h) => {
      ctx.clearRect(0, 0, w, h);
      const wood = (x, y, ww, hh) => {
        const g = ctx.createLinearGradient(x, y, x + ww, y);
        g.addColorStop(0, '#5a3a20'); g.addColorStop(0.4, '#9a6a3e'); g.addColorStop(1, '#4e321b');
        ctx.fillStyle = g; ctx.fillRect(x, y, ww, hh);
      };
      wood(0, h - 14, w, 14);
      wood(0, h * 0.42, w, 9);
      for (let x = 10; x < w; x += 32) wood(x, h * 0.42, 8, h * 0.58 - 14);
      for (let x = 0; x < w; x += 64) { wood(x + 26, 0, 12, h * 0.42 + 2); wood(x + 4, h * 0.2, 56, 6); }
    }, [1.5, 1]),
    // raised-bed soil with furrows along U: 2 m x 1.4 m (two furrows)
    soil: () => ctex(256, 256, (ctx, w, h) => {
      const r = rngOf('soil');
      for (let j = 0; j < 2; j++) {
        const y0 = j * h / 2;
        const g = ctx.createLinearGradient(0, y0, 0, y0 + h / 2);
        g.addColorStop(0, '#2c1c10'); g.addColorStop(0.5, '#5e4129'); g.addColorStop(1, '#2c1c10');
        ctx.fillStyle = g; ctx.fillRect(0, y0, w, h / 2);
      }
      blotches(ctx, w, h, r, 30, ['#3a2616', '#6f4f33', '#4b3220'], 8, 26, 0.25);
      const tones = ['#21150b', '#4a3220', '#6b4c33', '#37241550', '#7d5d40'];
      for (let i = 0; i < 2200; i++) {
        ctx.fillStyle = tones[(r() * tones.length) | 0]; ctx.globalAlpha = 0.25 + r() * 0.45;
        const s2 = 0.8 + r() * 2.4; ctx.beginPath(); ctx.ellipse(r() * w, r() * h, s2, s2 * 0.7, r() * 3, 0, TAU); ctx.fill();
      }
      ctx.globalAlpha = 0.5;
      for (let i = 0; i < 40; i++) { ctx.fillStyle = r() < 0.5 ? '#8a7a68' : '#5c5248'; ctx.beginPath(); ctx.ellipse(r() * w, r() * h, 1.5 + r() * 2, 1 + r() * 1.5, r() * 3, 0, TAU); ctx.fill(); }
      ctx.globalAlpha = 1;
    }, [2, 1.4]),
    // canvas awning stripes (U)
    awning: () => ctex(128, 64, (ctx, w, h) => {
      for (let i = 0; i < 4; i++) { ctx.fillStyle = i % 2 ? '#f4efe4' : '#2f7d4a'; ctx.fillRect(i * w / 4, 0, w / 4, h); }
      ctx.fillStyle = 'rgba(0,0,0,0.08)'; for (let y = 0; y < h; y += 6) ctx.fillRect(0, y, w, 1);
    }, [1.6, 1]),
  };
  const TEX = {};
  function tex(name) {
    if (!TEX[name]) {
      if (!PAINT[name]) throw new Error('bkit: unknown texture ' + name);
      TEX[name] = PAINT[name]();
    }
    return TEX[name];
  }

  // ---------------------------------------------------------------- shared materials
  const STD = (o) => new THREE.MeshStandardMaterial(o);
  const MATDEF = {
    roof: { make: () => STD({ map: tex('tile'), bumpMap: tex('tileBump'), bumpScale: 3, vertexColors: true, roughness: 0.8, metalness: 0, envMapIntensity: 0.55 }) },
    fascia: { make: () => STD({ map: tex('fascia'), vertexColors: true, roughness: 0.8 }) },
    soffit: { make: () => STD({ map: tex('soffit'), vertexColors: true, roughness: 0.85 }), cast: false },
    hanji: {
      make: () => {
        const m = STD({ map: tex('hanji'), emissiveMap: tex('hanji'), emissive: new THREE.Color('#ffb25a'), vertexColors: true, roughness: 0.92 });
        G.world.addNightMaterial(m, 1.25, 0);
        return m;
      },
    },
    plaster: { make: () => STD({ map: tex('plaster'), vertexColors: true, roughness: 0.95 }) },
    stone: { make: () => STD({ map: tex('stone'), vertexColors: true, roughness: 0.9 }) },
    field: { make: () => STD({ map: tex('fieldstone'), vertexColors: true, roughness: 0.95 }) },
    wood: { make: () => STD({ map: tex('wood'), vertexColors: true, roughness: 0.78 }) },
    plank: { make: () => STD({ map: tex('plank'), vertexColors: true, roughness: 0.82 }) },
    glass: {
      make: () => {
        const m = STD({ map: tex('glass'), emissiveMap: tex('glassEmit'), emissive: new THREE.Color('#ffd9a0'), vertexColors: true, metalness: 0.55, roughness: 0.1, envMapIntensity: 1.5 });
        G.world.addNightMaterial(m, 1.3, 0);
        return m;
      },
    },
    thatch: { make: () => STD({ map: tex('thatch'), vertexColors: true, roughness: 1 }) },
    gravel: { make: () => STD({ map: tex('gravel'), vertexColors: true, roughness: 1 }), cast: false },
    soil: { make: () => STD({ map: tex('soil'), vertexColors: true, roughness: 1 }), cast: false },
    paint: { make: () => STD({ vertexColors: true, roughness: 0.62, metalness: 0.02 }) },
    metal: { make: () => STD({ vertexColors: true, roughness: 0.38, metalness: 0.7 }) },
    glossy: { make: () => STD({ vertexColors: true, roughness: 0.18, metalness: 0.1 }) },
    darkglass: { make: () => STD({ vertexColors: true, color: 0x1b252c, roughness: 0.08, metalness: 0.7, envMapIntensity: 1.6 }) },
    glaze: { make: () => STD({ map: tex('jar'), vertexColors: true, roughness: 0.3, metalness: 0.04 }) },
    railing: { make: () => STD({ map: tex('railing'), vertexColors: true, roughness: 0.8, alphaTest: 0.5, side: THREE.DoubleSide }), cast: false },
    awning: { make: () => STD({ map: tex('awning'), vertexColors: true, roughness: 0.9, side: THREE.DoubleSide }) },
    glow: {
      make: () => {
        const m = STD({ vertexColors: true, color: 0xfff1d8, emissive: new THREE.Color('#ffb04d'), roughness: 0.7 });
        G.world.addNightMaterial(m, 2.4, 0.12);
        return m;
      },
      cast: false,
    },
  };
  function mat(key) {
    const d = MATDEF[key];
    if (!d) throw new Error('bkit: unknown material ' + key);
    return G.gfx.material('bk-' + key, d.make);
  }
  function registerMaterial(key, make, opts = {}) { MATDEF[key] = { make, ...opts }; }

  // ---------------------------------------------------------------- geometry accumulator
  const KEEP = { position: 1, normal: 1, uv: 1, color: 1 };
  const WHITE = new THREE.Color(1, 1, 1);
  class Bucket {
    constructor() { this.parts = new Map(); this.tris = 0; }
    /** add geometry (consumed!) under material key, transformed by matrix m, tinted by colour */
    add(key, geo, m, color) {
      if (!geo || !geo.attributes.position) return;
      const n = geo.attributes.position.count;
      if (!n) return;
      if (!geo.index) { const idx = new Array(n); for (let i = 0; i < n; i++) idx[i] = i; geo.setIndex(idx); }
      for (const name of Object.keys(geo.attributes)) if (!KEEP[name]) geo.deleteAttribute(name);
      if (!geo.attributes.normal) geo.computeVertexNormals();
      if (!geo.attributes.uv) geo.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(n * 2), 2));
      if (m && m !== I4) geo.applyMatrix4(m);
      const c = color ? col(color) : WHITE;
      const ca = geo.attributes.color;
      if (!ca) {
        const arr = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
        geo.setAttribute('color', new THREE.Float32BufferAttribute(arr, 3));
      } else if (color) {
        const a = ca.array;
        for (let i = 0; i < n; i++) { a[i * 3] *= c.r; a[i * 3 + 1] *= c.g; a[i * 3 + 2] *= c.b; }
      }
      geo.morphAttributes = {};
      geo.clearGroups();
      let list = this.parts.get(key);
      if (!list) { list = []; this.parts.set(key, list); }
      list.push(geo);
      this.tris += geo.index.count / 3;
    }
    has(key) { return this.parts.has(key); }
    /** merge everything into one mesh per material, added to parent. opts.shadows=false disables casting */
    build(parent, opts = {}) {
      const out = {};
      const BGU = ADDONS.BufferGeometryUtils;
      for (const [key, list] of this.parts) {
        if (!list.length) continue;
        let geo = list.length === 1 ? list[0] : (BGU && BGU.mergeGeometries(list, false));
        if (!geo) { G.log.warn('WORLD', 'merge failed for', key); continue; }
        geo.computeBoundingSphere(); geo.computeBoundingBox();
        const def = MATDEF[key] || {};
        const material = opts.materials?.[key] || mat(key);
        const mesh = new THREE.Mesh(geo, material);
        mesh.name = (opts.name ? opts.name + ':' : '') + key;
        // cast regardless of the current preset: the renderer's shadow map switch decides (quality can change at runtime)
        mesh.castShadow = opts.shadows !== false && def.cast !== false;
        mesh.receiveShadow = def.receive !== false;
        mesh.matrixAutoUpdate = false; mesh.updateMatrix();
        parent.add(mesh);
        out[key] = mesh;
      }
      this.parts.clear();
      return out;
    }
  }

  // ---------------------------------------------------------------- primitives (UVs in metres)
  const geo = {};
  /**
   * box w x h x d centred at origin. uv: 'world' (sides: u horizontal, v vertical; top: x,z) or 'grain'
   * (v along the longest box dimension -> wood grain along beams/posts). uo/vo offset the UVs.
   */
  geo.box = function (w, h, d, uv = 'world', uo = 0, vo = 0) {
    const hx = w / 2, hy = h / 2, hz = d / 2;
    const pos = [], nor = [], uvs = [], idx = [];
    const longest = w >= h && w >= d ? 0 : h >= d ? 1 : 2;
    const faces = [
      [1, 0, 0, 0, 0, -1, 0, 1, 0, hx, hz, hy], [-1, 0, 0, 0, 0, 1, 0, 1, 0, hx, hz, hy],
      [0, 0, 1, 1, 0, 0, 0, 1, 0, hz, hx, hy], [0, 0, -1, -1, 0, 0, 0, 1, 0, hz, hx, hy],
      [0, 1, 0, 1, 0, 0, 0, 0, -1, hy, hx, hz], [0, -1, 0, 1, 0, 0, 0, 0, 1, hy, hx, hz],
    ];
    for (const f of faces) {
      const [nx, ny, nz, ux, uy, uz, vx, vy, vz, hn, hu, hv] = f;
      if (hu < 1e-6 || hv < 1e-6) continue;
      const base = pos.length / 3;
      const uAxis = ux ? 0 : uy ? 1 : 2, vAxis = vx ? 0 : vy ? 1 : 2;
      const swap = uv === 'grain' && uAxis === longest;
      for (const [su, sv] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        pos.push(nx * hn + ux * hu * su + vx * hv * sv, ny * hn + uy * hu * su + vy * hv * sv, nz * hn + uz * hu * su + vz * hv * sv);
        nor.push(nx, ny, nz);
        const cu = hu * su, cv = hv * sv;
        if (swap) uvs.push(cv + uo, cu + vo); else uvs.push(cu + uo, cv + vo);
      }
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
      void uAxis; void vAxis;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    g.setIndex(idx);
    return g;
  };
  /** cylinder along Y centred at origin (UV in metres: u around, v along height) */
  geo.cyl = function (rt, rb, h, seg = 12, open = false, hs = 1) {
    const g = new THREE.CylinderGeometry(rt, rb, h, seg, hs, open);
    const uv = g.attributes.uv, n = uv.count, side = (seg + 1) * (hs + 1);
    const circ = TAU * Math.max(rt, rb), r2 = 2 * Math.max(rt, rb);
    for (let i = 0; i < n; i++) {
      if (i < side) uv.setXY(i, uv.getX(i) * circ, uv.getY(i) * h);
      else uv.setXY(i, uv.getX(i) * r2, uv.getY(i) * r2);
    }
    return g;
  };
  geo.lathe = function (pts, seg = 16) {
    return new THREE.LatheGeometry(pts.map((p) => new THREE.Vector2(p[0], p[1])), seg);
  };
  /** vertical quad in the XY plane facing +Z, w x h centred; uv 0..1 or rect [u0,v0,u1,v1] */
  geo.quad = function (w, h, rect, doubleSided = false) {
    const g = new THREE.PlaneGeometry(w, h);
    if (rect) {
      const uv = g.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, lerp(rect[0], rect[2], uv.getX(i)), lerp(rect[1], rect[3], uv.getY(i)));
    }
    if (!doubleSided) return g;
    const b = g.clone(); b.rotateY(PI);
    return ADDONS.BufferGeometryUtils.mergeGeometries([g, b]);
  };
  /** quad with UVs in metres (u along width, v along height) */
  geo.mquad = function (w, h, uo = 0, vo = 0) {
    const g = new THREE.PlaneGeometry(w, h);
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w + uo, uv.getY(i) * h + vo);
    return g;
  };
  /** horizontal disc (XZ, facing up) with planar metre UVs */
  geo.disc = function (r, seg = 32, uvScale = 1) {
    const g = new THREE.CircleGeometry(r, seg);
    g.rotateX(-PI / 2);
    const p = g.attributes.position, uv = g.attributes.uv;
    for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) * uvScale, -p.getZ(i) * uvScale);
    return g;
  };
  /** flat annulus (XZ, facing up) with planar UVs in metres */
  geo.ring = function (r0, r1, seg = 48, a0 = 0, a1 = TAU) {
    const g = new THREE.RingGeometry(r0, r1, seg, 1, a0, a1 - a0);
    g.rotateX(-PI / 2);
    const p = g.attributes.position, uv = g.attributes.uv;
    for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i), -p.getZ(i));
    return g;
  };
  /**
   * parametric grid: fn(i, j, out) fills out = [x, y, z, u, v] for i in 0..nu, j in 0..nv.
   * Front side = counter-clockwise for increasing i (right) and j (up); flip reverses.
   */
  geo.grid = function (nu, nv, fn, flip = false) {
    const cols = nu + 1, rows = nv + 1;
    const pos = new Float32Array(cols * rows * 3), uvs = new Float32Array(cols * rows * 2), idx = [];
    const o = [0, 0, 0, 0, 0];
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
      fn(i, j, o);
      const k = j * cols + i;
      pos[k * 3] = o[0]; pos[k * 3 + 1] = o[1]; pos[k * 3 + 2] = o[2];
      uvs[k * 2] = o[3]; uvs[k * 2 + 1] = o[4];
    }
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
      const a = j * cols + i, b = a + 1, c = a + cols, d = c + 1;
      if (flip) idx.push(a, c, b, b, c, d); else idx.push(a, b, c, b, d, c);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  };
  /**
   * sweep a closed profile [[s,u],...] (counter-clockwise when looking down the path) along a polyline of
   * Vector3. s = sideways (horizontal, right of the path), u = up. Each profile edge gets its own vertices
   * (hard edges across the profile, smooth along the path). colors: optional per-edge hex array.
   */
  geo.sweep = function (pts, prof, colors, caps = true) {
    const n = pts.length;
    if (n < 2) return null;
    const T = [], U = [], S = [];
    const up = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < n; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
      const t = new THREE.Vector3().subVectors(b, a).normalize();
      let u = up.clone().addScaledVector(t, -up.dot(t));
      if (u.lengthSq() < 1e-6) u.set(0, 0, 1);
      u.normalize();
      const s = new THREE.Vector3().crossVectors(t, u).normalize();
      T.push(t); U.push(u); S.push(s);
    }
    const lens = [0];
    for (let i = 1; i < n; i++) lens.push(lens[i - 1] + pts[i].distanceTo(pts[i - 1]));
    const pos = [], uvs = [], cols = [], idx = [];
    const m = prof.length;
    let plen = 0;
    const tmp = new THREE.Vector3();
    for (let e = 0; e < m; e++) {
      const p0 = prof[e], p1 = prof[(e + 1) % m];
      const el = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
      const c = col(colors ? colors[e % colors.length] : '#ffffff');
      const base = pos.length / 3;
      for (let i = 0; i < n; i++) {
        for (const [pp, vv] of [[p0, plen], [p1, plen + el]]) {
          tmp.copy(pts[i]).addScaledVector(S[i], pp[0]).addScaledVector(U[i], pp[1]);
          pos.push(tmp.x, tmp.y, tmp.z); uvs.push(lens[i], vv); cols.push(c.r, c.g, c.b);
        }
      }
      for (let i = 0; i < n - 1; i++) {
        const a = base + i * 2, b = a + 1, c2 = a + 2, d = a + 3;
        idx.push(a, c2, b, b, c2, d);
      }
      plen += el;
    }
    if (caps) {
      const c = col(colors ? colors[colors.length - 1] : '#ffffff');
      for (const [i, dir] of [[0, -1], [n - 1, 1]]) {
        const base = pos.length / 3;
        for (const pp of prof) {
          tmp.copy(pts[i]).addScaledVector(S[i], pp[0]).addScaledVector(U[i], pp[1]);
          pos.push(tmp.x, tmp.y, tmp.z); uvs.push(pp[0], pp[1]); cols.push(c.r, c.g, c.b);
        }
        for (let k = 1; k < m - 1; k++) { if (dir > 0) idx.push(base, base + k + 1, base + k); else idx.push(base, base + k, base + k + 1); }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  };
  /** box spanning two points (thickness w horizontally, h vertically) - beams, rails, rafters */
  geo.beam = function (ax, ay, az, bx, by, bz, w, h, uv = 'grain') {
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const len = Math.hypot(dx, dy, dz);
    const g = geo.box(len, h, w, uv);
    const yaw = Math.atan2(-dz, dx), pitch = Math.atan2(dy, Math.hypot(dx, dz));
    g.applyMatrix4(new THREE.Matrix4().makeRotationZ(pitch));
    g.applyMatrix4(new THREE.Matrix4().makeRotationY(yaw));
    g.translate((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2);
    return g;
  };
  /** round log between two points */
  geo.tube = function (ax, ay, az, bx, by, bz, r, seg = 8) {
    const a = new THREE.Vector3(ax, ay, az), b = new THREE.Vector3(bx, by, bz);
    const len = a.distanceTo(b);
    const g = geo.cyl(r, r, len, seg, false);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
    g.applyQuaternion(q);
    g.translate((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2);
    return g;
  };

  // ---------------------------------------------------------------- hanok roof generator
  const RIDGE_W = '#ebe7de', RIDGE_D = '#55585c', RIDGE_B = '#46494d';
  function ridgeProfile(w, h) {
    // stacked dark ridge tiles (적새) with a thin white mortar line, capped by a rounded tile row
    return {
      body: [[-w * 0.4, -0.08], [w * 0.4, -0.08], [w * 0.4, h * 0.6], [-w * 0.4, h * 0.6]],
      line: [[-w * 0.43, h * 0.12], [w * 0.43, h * 0.12], [w * 0.43, h * 0.24], [-w * 0.43, h * 0.24]],
      cap: [[-w * 0.5, h * 0.55], [w * 0.5, h * 0.55], [w * 0.36, h], [-w * 0.36, h]],
    };
  }
  function addRidge(B, m, pts, w, h, tint) {
    if (pts.length < 2) return;
    const pr = ridgeProfile(w, h);
    B.add('plaster', geo.sweep(pts, pr.body, [RIDGE_B]), m);
    B.add('plaster', geo.sweep(pts, pr.line, [RIDGE_W]), m, tint);
    B.add('roof', geo.sweep(pts, pr.cap, [RIDGE_D]), m);
  }
  /**
   * Korean roof. o = { mode:'paljak'|'hip'|'gable'|'skirt', hw, hd (wall/pillar half extents), ov (eave overhang),
   *   rise (eave->ridge height), y (eave height at the middle of the long side), out (corner plan bulge), lift (corner
   *   upturn), vg (paljak hip fraction), bo (gable overhang), vs (skirt top fraction), t (thickness), k (concavity),
   *   ridge: {w,h}, tint, gableColor, seg }  -> info {ridgeY, eaveY, xw, roofYAt(z)}.
   * Local frame: ridge along X, front = +Z.
   */
  function roof(B, m, o) {
    const mode = o.mode || 'paljak';
    const hw = o.hw, hd = o.hd, ov = o.ov ?? 1.5;
    const A = hw + ov, C = hd + ov;
    const gableMode = mode === 'gable';
    const out = gableMode ? 0 : (o.out ?? 0.5);
    const lift = o.lift ?? (gableMode ? 0.05 : 0.5);
    const H = o.rise ?? C * 0.7;
    const k = o.k ?? 1.45, p = o.p ?? 2.4;
    const t = o.t ?? 0.32;
    const rl = o.ridgeLift ?? Math.min(0.35, H * 0.08);
    const y0 = o.y ?? 0;
    const tint = o.tint || '#ffffff';
    const segU = o.seg ?? 1;
    let vg = 1, xw = 0, bo = o.bo ?? 0.4;
    if (mode === 'paljak') { vg = o.vg ?? 0.5; xw = A + out - vg * (C + out); }
    else if (mode === 'hip' || mode === 'skirt') { vg = 1; xw = Math.max(0, A - C); }
    else { vg = 0; xw = A; bo = 0; }
    const vTop = mode === 'skirt' ? (o.vs ?? 0.35) : 1;
    const ux = (x) => Math.min(Math.abs(x) / A, 1.3);
    const bul = (x) => out * Math.pow(ux(x), p);
    const fz = (x, v) => (1 - v) * (C + bul(x));
    const liftAt = (x, v) => lift * Math.pow(ux(x), p) * (1 - v) * (1 - v) + rl * Math.pow(ux(x), 4) * Math.pow(Math.max(v, 0), 6);
    const fy = (x, v) => y0 + H * Math.pow(Math.max(v, 0), k) + liftAt(x, v);
    const a = (v) => (A + out) - (v / (vg || 1)) * ((A + out) - xw);
    const sx = (s, v) => { const e = A + out * Math.pow(Math.abs(s), p); return e + (xw - e) * (v / vg); };
    const sz = (s, v) => s * fz(a(v), v);
    const sy = (s, v) => y0 + H * Math.pow(Math.max(v, 0), k) + Math.pow(Math.abs(s), p) * liftAt(a(v), v);
    // slope length table along the middle (for tile V)
    const slen = (v) => { let L2 = 0, pz = C, py = y0; const N = 24; for (let i = 1; i <= N; i++) { const vv = v * i / N; const z = (1 - vv) * C, y = y0 + H * Math.pow(vv, k); L2 += Math.hypot(z - pz, y - py); pz = z; py = y; } return L2; };
    const nv = Math.max(4, Math.round(8 * (o.vres ?? 1)));
    const surfaces = []; // {fn, nu, nv} top surfaces (also used for soffits)
    // front faces (+z); mirrored for back
    const lowEnd = mode === 'gable' ? 0 : Math.min(vg, vTop);
    if (mode !== 'gable') {
      const nu = Math.max(8, Math.round((A + out) * 2 / 1.1 * segU));
      const nvl = Math.max(3, Math.round(nv * lowEnd));
      surfaces.push({ kind: 'front', nu, nv: nvl, P: (i, j, oo) => { const v = lowEnd * j / nvl; const x = (i / nu * 2 - 1) * a(v); oo[0] = x; oo[1] = fy(x, v); oo[2] = fz(x, v); oo[3] = x; oo[4] = slen(v); } });
    }
    if (mode === 'paljak' || mode === 'gable') {
      const v0 = mode === 'gable' ? 0 : vg, xe = mode === 'gable' ? A : xw + bo;
      const nu = Math.max(6, Math.round(xe * 2 / 1.1 * segU));
      const nvu = Math.max(3, Math.round(nv * (1 - v0)));
      surfaces.push({ kind: 'upper', nu, nv: nvu, v0, xe, P: (i, j, oo) => { const v = v0 + (1 - v0) * j / nvu; const x = (i / nu * 2 - 1) * xe; oo[0] = x; oo[1] = fy(x, v); oo[2] = fz(x, v); oo[3] = x; oo[4] = slen(v); } });
    }
    // side faces (+x); mirrored for -x
    if (mode !== 'gable') {
      const vs = Math.min(vg, vTop);
      const nu = Math.max(6, Math.round((C + out) * 2 / 1.1 * segU));
      const nvs = Math.max(3, Math.round(nv * vs));
      surfaces.push({ kind: 'side', nu, nv: nvs, P: (i, j, oo) => { const v = vs * j / nvs; const s = 1 - i / nu * 2; const x = sx(s, v); oo[0] = x; oo[1] = sy(s, v); oo[2] = sz(s, v); oo[3] = -oo[2]; oo[4] = slen(v); } });
    }
    for (const sf of surfaces) {
      const mirrors = [[1, 1, false], [1, -1, true]];
      if (sf.kind === 'side') { mirrors[1] = [-1, 1, true]; }
      for (const [mx, mz, flip] of mirrors) {
        const top = geo.grid(sf.nu, sf.nv, (i, j, oo) => { sf.P(i, j, oo); oo[0] *= mx; oo[2] *= mz; }, flip);
        B.add('roof', top, m, tint);
        const bot = geo.grid(sf.nu, sf.nv, (i, j, oo) => { sf.P(i, j, oo); oo[0] *= mx; oo[2] *= mz; oo[1] -= t; }, !flip);
        B.add('soffit', bot, m, o.soffitTint || '#ffffff');
      }
    }
    // eave fascia strips (front/back along x, sides along z)
    const fascia = (pts) => {
      const nn = pts.length;
      const lens = [0];
      for (let i = 1; i < nn; i++) lens.push(lens[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][2] - pts[i - 1][2]));
      const g = geo.grid(nn - 1, 1, (i, j, oo) => { const q = pts[i]; oo[0] = q[0]; oo[1] = q[1] - (j ? 0 : t); oo[2] = q[2]; oo[3] = lens[i]; oo[4] = j; });
      B.add('fascia', g, m, o.fasciaTint || '#ffffff');
    };
    const nE = Math.max(16, Math.round((A + out) * 2 / 0.6));
    if (mode !== 'gable') {
      for (const mz of [1, -1]) {
        const pts = [];
        for (let i = 0; i <= nE; i++) { const x = (i / nE * 2 - 1) * a(0); pts.push([mz > 0 ? x : -x, fy(x, 0), fz(x, 0) * mz]); }
        fascia(pts);
      }
      const nS = Math.max(10, Math.round((C + out) * 2 / 0.6));
      for (const mx of [1, -1]) {
        const pts = [];
        for (let i = 0; i <= nS; i++) { const s = 1 - i / nS * 2; pts.push([sx(s, 0) * mx, sy(s, 0), mx > 0 ? sz(s, 0) : -sz(s, 0)]); }
        fascia(pts);
      }
    } else {
      for (const mz of [1, -1]) {
        const pts = [];
        for (let i = 0; i <= nE; i++) { const x = (i / nE * 2 - 1) * A; pts.push([mz > 0 ? x : -x, fy(x, 0), fz(x, 0) * mz]); }
        fascia(pts);
      }
    }
    // ridges
    const rw = o.ridge?.w ?? 0.42, rh = o.ridge?.h ?? 0.42;
    const V = (x, y, z) => new THREE.Vector3(x, y, z);
    let xr = 0;
    if (mode === 'paljak') xr = xw + bo - 0.08;
    else if (mode === 'gable') xr = A - 0.05;
    else if (mode === 'hip') xr = xw;
    if (mode !== 'skirt' && xr > 0.15) {
      const pts = [], N = Math.max(6, Math.round(xr * 2 / 0.5));
      for (let i = 0; i <= N; i++) { const x = (i / N * 2 - 1) * xr; pts.push(V(x, fy(x, 1) - 0.05, 0)); }
      addRidge(B, m, pts, rw, rh, tint);
      // ridge-end tiles (망와) turned up and out
      const ew = Math.min(0.16, rw * 0.38);
      for (const sgn of [-1, 1]) {
        const x = sgn * xr, y = fy(x, 1) + rh * 0.55;
        const g = geo.box(ew, rh * 1.25, rw * 1.05);
        B.add('roof', g, mul(m, M(x + sgn * ew * 0.12, y + rh * 0.25, 0, 0, 1, 1, 1, 0, -sgn * 0.35)), RIDGE_D);
        B.add('plaster', geo.box(ew * 0.38, rh * 0.8, rw * 0.7), mul(m, M(x + sgn * ew * 0.62, y + rh * 0.2, 0, 0, 1, 1, 1, 0, -sgn * 0.35)), RIDGE_W);
      }
    }
    // hip ridges (추녀마루)
    if (mode !== 'gable') {
      const vEnd = Math.min(vg, vTop);
      const hr = Math.max(0.24, rw * 0.7), hh = Math.max(0.22, rh * 0.62);
      const tip = Math.min(0.55, 0.18 + (C + out) * 0.035);
      for (const mx of [1, -1]) for (const mz of [1, -1]) {
        const pts = [], N = 10;
        for (let i = 0; i <= N; i++) {
          const v = vEnd * i / N, x = a(v);
          pts.push(V(x * mx, fy(x, v) - 0.04, fz(x, v) * mz));
        }
        // upturned tip beyond the eave corner (추녀 끝)
        const d0 = pts[0].clone().sub(pts[1]).setY(0).normalize();
        pts.unshift(pts[0].clone().addScaledVector(d0, tip).add(new THREE.Vector3(0, tip * 0.75, 0)));
        addRidge(B, m, pts, hr, hh, tint);
      }
    }
    // paljak: gable walls, gable base ridge, rake ridges, barge boards
    if (mode === 'paljak' || mode === 'gable') {
      const xg = mode === 'gable' ? hw : xw;
      const xe = mode === 'gable' ? A : xw + bo;
      const zBase = mode === 'gable' ? hd : fz(xw, vg);
      const zTopK = C + bul(xg);
      const nz = 16;
      for (const mx of [1, -1]) {
        const wall = geo.grid(nz, 1, (i, j, oo) => {
          const s = 1 - i / nz * 2, z = s * zBase;
          const vTopZ = 1 - Math.abs(z) / zTopK;
          const yt = fy(xg, vTopZ) - t * 0.6;
          const yb = mode === 'gable' ? (o.wallTop ?? y0) : sy(s, vg);
          oo[0] = (xg - 0.05) * mx; oo[1] = j ? Math.max(yt, yb) : yb; oo[2] = z * mx; oo[3] = z; oo[4] = oo[1];
        });
        B.add('wood', wall, m, o.gableColor || '#6b4a30');
        if (mode === 'paljak') {
          // decorative white band around the gable wall foot
          const pts = [];
          for (let i = 0; i <= 10; i++) { const s = 1 - i / 5; pts.push(V((xg + 0.02) * mx, sy(s, vg) + 0.02, (mx > 0 ? s : -s) * zBase)); }
          addRidge(B, m, pts, 0.24, 0.2, tint);
        }
        // barge boards + rake ridges on both slopes
        for (const mz of [1, -1]) {
          const v0 = mode === 'gable' ? 0 : vg;
          const bp = [], rp = [], N = 10;
          for (let i = 0; i <= N; i++) {
            const v = v0 + (1 - v0) * i / N;
            bp.push(V(xe * mx, fy(xe, v) - 0.02, fz(xe, v) * mz));
            const xi = xe - 0.16;
            rp.push(V(xi * mx, fy(xi, v) - 0.04, fz(xi, v) * mz));
          }
          if (mx * mz > 0) { bp.reverse(); rp.reverse(); }
          const bd = t + Math.min(0.22, t * 0.7), bw2 = Math.min(0.05, 0.02 + t * 0.1);
          B.add('wood', geo.sweep(bp, [[-bw2, -bd], [bw2, -bd], [bw2, 0.02], [-bw2, 0.02]], ['#5a3d26']), m);
          addRidge(B, m, rp, rw * 0.72, rh * 0.68, tint);
        }
      }
    }
    if (mode === 'skirt') {
      // flashing along the top edge
      for (const mz of [1, -1]) {
        const pts = [];
        for (let i = 0; i <= 12; i++) { const x = (i / 12 * 2 - 1) * a(vTop); pts.push(V(x, fy(x, vTop) - 0.05, fz(x, vTop) * mz)); }
        if (mz < 0) pts.reverse();
        addRidge(B, m, pts, 0.3, 0.24, tint);
      }
      for (const mx of [1, -1]) {
        const pts = [];
        for (let i = 0; i <= 8; i++) { const s = 1 - i / 4; pts.push(V(sx(s, vTop) * mx, sy(s, vTop) - 0.05, (mx > 0 ? sz(s, vTop) : -sz(s, vTop)))); }
        addRidge(B, m, pts, 0.3, 0.24, tint);
      }
    }
    return {
      ridgeY: fy(0, 1), eaveY: y0, xw, A, C, H, t,
      /** roof underside height above a point of the front/back slope (|z| from the ridge line) */
      undersideAt: (x, z) => { const v = clamp(1 - Math.abs(z) / (C + bul(x)), 0, 1); return fy(x, v) - t; },
      topAt: (x, z) => { const v = clamp(1 - Math.abs(z) / (C + bul(x)), 0, 1); return fy(x, v); },
      yAtV: (v) => y0 + H * Math.pow(v, k),
    };
  }
  /** eave base height so that the roof underside sits at `wallTop` above the wall line (z = hd) */
  function roofBaseFor(o, wallTop, gap = 0.05) {
    const C = o.hd + (o.ov ?? 1.5);
    const H = o.rise ?? C * 0.7, k = o.k ?? 1.45, t = o.t ?? 0.32;
    const vw = clamp(1 - o.hd / C, 0, 1);
    return wallTop + gap + t - H * Math.pow(vw, k);
  }

  /**
   * regular polygon (hexagonal pavilion) roof with curved, upturned corners and a finial.
   * o = { n, R (eave corner radius at the eave), y (eave height), rise, lift, t, tint, rot }
   */
  function polyRoof(B, m, o) {
    const n = o.n || 6, R = o.R, y0 = o.y ?? 0, H = o.rise ?? R * 0.62, lift = o.lift ?? 0.45, t = o.t ?? 0.3;
    const k = o.k ?? 1.5, p = 2.6, rot0 = o.rot ?? 0, tint = o.tint || '#ffffff';
    const corner = (i) => { const ang = rot0 + i / n * TAU; return [Math.sin(ang) * R, Math.cos(ang) * R]; };
    const nu = 10, nv = 8;
    const yOf = (u, v) => y0 + H * Math.pow(v, k) + lift * Math.pow(Math.abs(u), p) * (1 - v) * (1 - v);
    const sag = 0.06 * R; // plan sag of the eave edge between corners (안허리)
    for (let i = 0; i < n; i++) {
      const c0 = corner(i), c1 = corner(i + 1);
      const mx = (c0[0] + c1[0]) / 2, mz = (c0[1] + c1[1]) / 2, ml = Math.hypot(mx, mz);
      const nx = mx / ml, nz = mz / ml;
      const edgeLen = Math.hypot(c1[0] - c0[0], c1[1] - c0[1]);
      const P = (ii, jj, oo, dy) => {
        const u = ii / nu * 2 - 1, v = jj / nv;
        const ex = lerp(c0[0], c1[0], (u + 1) / 2) - nx * sag * (1 - u * u), ez = lerp(c0[1], c1[1], (u + 1) / 2) - nz * sag * (1 - u * u);
        oo[0] = ex * (1 - v); oo[2] = ez * (1 - v); oo[1] = yOf(u, v) + dy;
        oo[3] = u * edgeLen / 2 * (1 - v); oo[4] = v * Math.hypot(ml, H);
      };
      B.add('roof', geo.grid(nu, nv, (ii, jj, oo) => P(ii, jj, oo, 0), false), m, tint);
      B.add('soffit', geo.grid(nu, nv, (ii, jj, oo) => P(ii, jj, oo, -t), true), m);
      // fascia
      const pts = [];
      for (let ii = 0; ii <= nu; ii++) { const oo = [0, 0, 0, 0, 0]; P(ii, 0, oo, 0); pts.push(oo.slice(0, 3)); }
      const lens = [0];
      for (let ii = 1; ii < pts.length; ii++) lens.push(lens[ii - 1] + Math.hypot(pts[ii][0] - pts[ii - 1][0], pts[ii][2] - pts[ii - 1][2]));
      B.add('fascia', geo.grid(nu, 1, (ii, jj, oo) => { const q = pts[ii]; oo[0] = q[0]; oo[1] = q[1] - (jj ? 0 : t); oo[2] = q[2]; oo[3] = lens[ii]; oo[4] = jj; }), m);
      // hip ridge from this corner to the apex
      const rp = [];
      for (let jj = -1; jj <= nv; jj++) {
        const v = jj / nv;
        const vv = Math.max(v, 0);
        const ext = v < 0 ? 1 - v * 1.2 : 1;
        rp.push(new THREE.Vector3(c0[0] * (1 - vv) * ext, yOf(-1, vv) - 0.04 + (v < 0 ? 0.18 : 0), c0[1] * (1 - vv) * ext));
      }
      addRidge(B, m, rp, 0.26, 0.24, tint);
    }
    // finial (절병통)
    const top = y0 + H;
    B.add('roof', geo.lathe([[0, 0], [0.32, 0], [0.34, 0.12], [0.22, 0.2], [0.26, 0.42], [0.2, 0.62], [0.08, 0.7], [0.1, 0.82], [0.05, 0.95], [0, 1.0]], 10), mul(m, M(0, top - 0.12, 0)), RIDGE_D);
    return { topY: top };
  }

  // ---------------------------------------------------------------- onggi jar profiles (unit-ish sizes, metres)
  const JAR_PROFILES = {
    hangari: [[0, 0], [0.2, 0], [0.235, 0.035], [0.3, 0.17], [0.37, 0.33], [0.41, 0.47], [0.42, 0.55], [0.405, 0.64], [0.36, 0.74], [0.3, 0.81], [0.265, 0.855], [0.27, 0.885], [0.292, 0.905], [0.285, 0.925], [0.25, 0.93], [0.23, 0.9]],
    dok: [[0, 0], [0.22, 0], [0.25, 0.05], [0.31, 0.25], [0.37, 0.5], [0.4, 0.72], [0.4, 0.86], [0.37, 1.0], [0.32, 1.1], [0.29, 1.16], [0.3, 1.2], [0.315, 1.225], [0.3, 1.245], [0.27, 1.25], [0.25, 1.22]],
    jungduri: [[0, 0], [0.22, 0], [0.26, 0.05], [0.36, 0.2], [0.45, 0.38], [0.48, 0.5], [0.46, 0.62], [0.4, 0.72], [0.33, 0.79], [0.3, 0.83], [0.31, 0.86], [0.325, 0.88], [0.31, 0.9], [0.28, 0.9], [0.26, 0.87]],
    danji: [[0, 0], [0.13, 0], [0.155, 0.025], [0.21, 0.1], [0.245, 0.2], [0.25, 0.26], [0.23, 0.33], [0.19, 0.38], [0.165, 0.405], [0.17, 0.43], [0.18, 0.445], [0.17, 0.46], [0.15, 0.46], [0.14, 0.44]],
  };
  const LID_PROFILE = [[0, 0.17], [0.04, 0.17], [0.055, 0.15], [0.06, 0.12], [0.13, 0.112], [0.22, 0.088], [0.29, 0.048], [0.315, 0.012], [0.3, 0], [0.26, 0.02], [0.15, 0.06], [0, 0.07]];
  function jarTop(kind) { const pr = JAR_PROFILES[kind] || JAR_PROFILES.hangari; let y = 0; for (const p of pr) y = Math.max(y, p[1]); return y; }
  function jarGeometry(kind = 'hangari', seg = 16) { return geo.lathe(JAR_PROFILES[kind] || JAR_PROFILES.hangari, seg); }
  /** lid sized for a rim radius (default hangari rim ~0.29) */
  function lidGeometry(seg = 16, rim = 0.29) { const s = rim / 0.3; return geo.lathe(LID_PROFILE.map((p) => [p[0] * s, p[1] * s]), seg); }

  // ---------------------------------------------------------------- sign atlas (shelf-packed slots in one canvas)
  class SignAtlas {
    constructor(name, W = 1024, H = 2048) {
      this.name = name; this.W = W; this.H = H;
      this.canvas = document.createElement('canvas'); this.canvas.width = W; this.canvas.height = H;
      this.ctx = this.canvas.getContext('2d');
      this.ctx.fillStyle = '#5b3a22'; this.ctx.fillRect(0, 0, W, H);
      this.x = 0; this.y = 0; this.rowH = 0; this.texture = null;
    }
    /** reserve a w x h pixel slot; draw(ctx, w, h) paints it. Returns uv rect [u0, v0, u1, v1]. */
    slot(w, h, draw) {
      w = Math.min(w, this.W);
      if (this.x + w > this.W) { this.x = 0; this.y += this.rowH; this.rowH = 0; }
      if (this.y + h > this.H) { G.log.warn('WORLD', `sign atlas ${this.name} is full`); return [0, 0, 0.02, 0.02]; }
      const x = this.x, y = this.y;
      this.x += w; this.rowH = Math.max(this.rowH, h);
      this.ctx.save(); this.ctx.translate(x, y); this.ctx.beginPath(); this.ctx.rect(0, 0, w, h); this.ctx.clip();
      try { draw(this.ctx, w, h); } catch (e) { G.log.warn('WORLD', 'sign draw failed', e); }
      this.ctx.restore();
      if (this.texture) this.texture.needsUpdate = true;
      // half-texel inset avoids bleeding from neighbouring slots
      const ix = 0.5 / this.W, iy = 0.5 / this.H;
      return [x / this.W + ix, 1 - (y + h) / this.H + iy, (x + w) / this.W - ix, 1 - y / this.H - iy];
    }
    /** wooden sign via G.gfx.signTexture (same look as the rest of the game) */
    sign(title, sub, opts = {}, w = 512, h = 256) {
      return this.slot(w, h, (ctx) => {
        const t = G.gfx.signTexture(title, sub, { ...opts, w, h });
        ctx.drawImage(t.image, 0, 0);
        t.dispose();
      });
    }
    getTexture() {
      if (!this.texture) {
        this.texture = new THREE.CanvasTexture(this.canvas);
        this.texture.colorSpace = THREE.SRGBColorSpace;
        this.texture.anisotropy = 8;
      }
      return this.texture;
    }
  }
  /** dark lacquered 현판 board (gold lettering) */
  const HYEONPAN = { bg1: '#3b2a1d', bg2: '#21160e', border: '#a8823e', color: '#f2d27e', subColor: '#e9d5a6' };

  // ---------------------------------------------------------------- per-object helper
  class Site {
    constructor(def, opts = {}) {
      this.def = def; this.id = def.id;
      this.x = def.x; this.z = def.z; this.rot = def.rot || 0;
      this.c = Math.cos(this.rot); this.s = Math.sin(this.rot);
      this.gy = opts.gy ?? Site.groundY(def.x, def.z, (def.w || 4) / 2, (def.d || 4) / 2, this.rot);
      this.group = new THREE.Group();
      this.group.name = def.id || 'site';
      this.group.position.set(this.x, this.gy, this.z);
      this.group.rotation.y = this.rot;
      this.group.updateMatrix(); this.group.updateMatrixWorld(true);
      this.B = new Bucket();
      this.colliders = []; this.walkables = []; this.blockers = [];
    }
    /** average terrain height over a footprint (centre + corners) */
    static groundY(x, z, hw = 2, hd = 2, rot = 0) {
      const W = G.world; let s = 0, n = 0;
      const c = Math.cos(rot), sn = Math.sin(rot);
      for (const [lx, lz] of [[0, 0], [-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]]) {
        const y = W.terrainHeight(x + lx * c + lz * sn, z - lx * sn + lz * c);
        if (Number.isFinite(y)) { s += y; n++; }
      }
      return n ? s / n : 0;
    }
    wx(lx, lz) { return this.x + lx * this.c + lz * this.s; }
    wz(lx, lz) { return this.z - lx * this.s + lz * this.c; }
    /** box collider in local coords (optional maxY above the site ground) */
    box(lx, lz, hw, hd, opts = {}) {
      const c = { shape: 'box', x: this.wx(lx, lz), z: this.wz(lx, lz), hw, hd, rot: this.rot + (opts.rot || 0), tag: opts.tag || this.id };
      if (opts.maxY != null) c.maxY = this.gy + opts.maxY;
      if (opts.minY != null) c.minY = this.gy + opts.minY;
      this.colliders.push(G.world.addCollider(c));
    }
    circle(lx, lz, r, opts = {}) {
      const c = { shape: 'circle', x: this.wx(lx, lz), z: this.wz(lx, lz), r, tag: opts.tag || this.id };
      if (opts.maxY != null) c.maxY = this.gy + opts.maxY;
      this.colliders.push(G.world.addCollider(c));
    }
    /** walkable box / circle; top is relative to the site ground */
    walk(lx, lz, hw, hd, top, surface = 'stone', rot = 0) {
      this.walkables.push(G.world.addWalkable({ shape: 'box', x: this.wx(lx, lz), z: this.wz(lx, lz), hw, hd, rot: this.rot + rot, top: this.gy + top, surface }));
    }
    walkCircle(lx, lz, r, top, surface = 'stone') {
      this.walkables.push(G.world.addWalkable({ shape: 'circle', x: this.wx(lx, lz), z: this.wz(lx, lz), r, top: this.gy + top, surface }));
    }
    /** invisible camera-blocker box in local coords (y = bottom) */
    blocker(lx, y, lz, w, h, d, ry = 0) {
      const m = new THREE.Mesh(Site.unitBox, Site.proxyMat);
      m.position.set(lx, y + h / 2, lz); m.scale.set(w, h, d); m.rotation.y = ry;
      m.visible = false; m.name = 'blocker';
      this.group.add(m); m.updateMatrix(); m.updateMatrixWorld(true);
      G.world.cameraBlockers.push(m);
      this.blockers.push(m);
      return m;
    }
    /** invisible pick/bounds proxy for interaction (child of `parent`, not a camera blocker) */
    static proxy(parent, x, y, z, w, h, d, ry = 0) {
      const m = new THREE.Mesh(Site.unitBox, Site.proxyMat);
      m.position.set(x, y + h / 2, z); m.scale.set(w, h, d); m.rotation.y = ry;
      m.visible = false; m.name = 'pick-proxy';
      parent.add(m);
      return m;
    }
    /** merge bucket into the group; roof meshes become camera blockers */
    finish(scene, opts = {}) {
      const meshes = this.B.build(this.group, { name: this.id, shadows: opts.shadows });
      for (const key of opts.blockKeys || ['roof']) if (meshes[key]) G.world.cameraBlockers.push(meshes[key]);
      scene.add(this.group);
      this.group.updateMatrixWorld(true);
      this.meshes = meshes;
      return meshes;
    }
  }
  Site.unitBox = new THREE.BoxGeometry(1, 1, 1);
  Site.proxyMat = new THREE.MeshBasicMaterial({ color: 0xff00ff, visible: false });

  G.bkit = {
    col, M, mul, I4, rngOf, tex, mat, registerMaterial, MATDEF, Bucket, geo, roof, roofBaseFor, polyRoof, addRidge,
    JAR_PROFILES, jarTop, jarGeometry, lidGeometry, SignAtlas, HYEONPAN, Site, roundRect, speckle, blotches, ctex, FONT,
  };

  // =============================================================================================
  // building builders (local frame: origin at the footprint centre on the ground, front = +Z)
  // =============================================================================================
  const WOOD = { natural: '#b98a5c', dark: '#7a5236', pillar: '#a8693f', red: '#a8442f', green: '#3f7f6c', beam: '#94653f', light: '#d6b48a' };
  const STONE_T = '#c9c3b8', PLASTER_T = '#ffffff';
  const SIGN_ATLAS = new SignAtlas('buildings', 1024, 1536);

  /** one wall bay between (x0,z0) and (x1,z1) on a wall line with outward normal (nx,nz) */
  function wallBay(B, x0, z0, x1, z1, nx, nz, type, y0, y1, st) {
    const len = Math.hypot(x1 - x0, z1 - z0);
    if (len < 0.25) return;
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    const ry = Math.atan2(nx, nz); // panel local +Z = outward normal
    const P = (lx, ly, lz) => M(cx + Math.cos(ry) * lx + Math.sin(ry) * lz, ly, cz - Math.sin(ry) * lx + Math.cos(ry) * lz, ry);
    const h = y1 - y0;
    const wt = st.wallTint || PLASTER_T, bt = st.frameTint || WOOD.dark;
    B.add(st.wallMat || 'plaster', geo.box(len - 0.06, h, 0.14, 'world', cx + cz, y0), P(0, y0 + h / 2, 0), wt);
    // sill + head beams
    B.add('wood', geo.box(len, 0.16, 0.2, 'grain'), P(0, y0 + 0.08, 0), bt);
    B.add('wood', geo.box(len, 0.2, 0.2, 'grain'), P(0, y1 - 0.1, 0), bt);
    const panel = (w, hh, xc, yc, door) => {
      const rect = door ? [0, 0, 0.5, 1] : [0.5, 0, 1, 1];
      B.add('hanji', geo.quad(w, hh, rect), P(xc, yc, 0.075));
      const fr = 0.07;
      for (const sx of [-1, 1]) B.add('wood', geo.box(fr, hh + fr * 2, 0.17, 'grain'), P(xc + sx * (w / 2 + fr / 2), yc, 0), bt);
      for (const sy of [-1, 1]) B.add('wood', geo.box(w + fr * 2, fr, 0.17, 'grain'), P(xc, yc + sy * (hh / 2 + fr / 2), 0), bt);
    };
    if (type === 'door') {
      // two 띠살 leaves side by side
      const dh = Math.min(2.05, h - 0.45), dw = Math.min(0.85, (len - 0.4) / 2);
      const yc = y0 + 0.16 + dh / 2;
      for (const s of [-1, 1]) panel(dw, dh, s * (dw / 2 + 0.07), yc, true);
      B.add('wood', geo.box(len, 0.14, 0.2, 'grain'), P(0, y0 + 0.16 + dh + 0.1, 0), bt);
    } else if (type === 'window') {
      const ww = Math.min(1.5, len - 0.5), wh = Math.min(1.0, h - 1.3);
      B.add('wood', geo.box(len, 0.14, 0.19, 'grain'), P(0, y0 + 0.82, 0), bt);
      if (ww > 0.3 && wh > 0.3) panel(ww, wh, 0, y0 + 0.92 + wh / 2, false);
      B.add('wood', geo.box(len, 0.12, 0.19, 'grain'), P(0, y0 + 0.98 + wh + 0.08, 0), bt);
    } else {
      B.add('wood', geo.box(len, 0.13, 0.19, 'grain'), P(0, y0 + 1.0, 0), bt);
      if (len > 2.2) B.add('wood', geo.box(0.12, h - 0.2, 0.19, 'grain'), P(0, y0 + h / 2, 0), bt);
    }
  }

  function addSignBoard(B, atlasRect, w, h, m, frameTint = '#4a2f1c') {
    B.add('sign', geo.quad(w, h, atlasRect), m);
    const fr = 0.07;
    B.add('wood', geo.box(w + fr * 2, h + fr * 2, 0.06), mul(m, M(0, 0, -0.035)), frameTint);
  }

  // ---------------------------------------------------------------- hanok (발효문화관 / 한옥 / 체험교육관)
  function buildHanok(site, b, o = {}) {
    const B = site.B;
    const w = b.w, d = b.d;
    const baseH = o.baseH ?? 0.55, bm = o.bm ?? 0.9;
    const floorY = baseH + 0.36;
    const ph = o.ph ?? clamp(2.55 + d * 0.06, 2.6, 3.2);
    const topY = baseH + ph;
    const nb = o.bays ?? Math.max(3, Math.round(w / 2.7));
    const bay = w / nb;
    const vd = o.veranda ?? (d >= 6 ? 1.25 : 0);
    const fwz = d / 2 - vd;
    const st = {
      wallTint: o.wallTint || PLASTER_T,
      frameTint: o.frameTint || WOOD.dark,
    };
    const pillarT = o.pillarTint || WOOD.pillar;
    // 기단 (stone platform) + coping
    B.add('stone', geo.box(w + bm * 2, baseH + 0.7, d + bm * 2, 'world'), M(0, (baseH - 0.7) / 2, 0), STONE_T);
    B.add('stone', geo.box(w + bm * 2 + 0.08, 0.08, d + bm * 2 + 0.08, 'world', 0.3, 0.7), M(0, baseH - 0.04, 0), '#dcd7cd');
    // front steps (centre)
    const stepW = Math.max(2.2, bay + 0.6);
    const nSteps = baseH > 0.4 ? 2 : 1;
    for (let i = 0; i < nSteps; i++) {
      const top = baseH * (i + 1) / (nSteps + 1);
      const zf = d / 2 + bm + 0.42 * (nSteps - i);
      B.add('stone', geo.box(stepW, top + 0.4, 0.44, 'world', i * 0.7), M(0, (top - 0.4) / 2, zf - 0.21), '#d2cdc3');
      site.walk(0, zf - 0.21, stepW / 2, 0.22, top, 'stone');
    }
    // 고막이 + floor
    B.add('stone', geo.box(w + 0.2, floorY - baseH, d + 0.2, 'world', 0.5), M(0, (baseH + floorY) / 2, 0), '#d6d0c4');
    if (vd > 0) {
      B.add('plank', geo.box(w + 0.3, 0.1, vd + 0.25, 'world'), M(0, floorY - 0.05, d / 2 - vd / 2 + 0.06), '#e2c49a');
      B.add('wood', geo.box(w + 0.3, 0.22, 0.16, 'grain'), M(0, floorY - 0.15, d / 2 + 0.12), WOOD.dark);
    }
    // pillars (round) on 주춧돌
    const pillars = [];
    for (let i = 0; i <= nb; i++) {
      const x = -w / 2 + i * bay;
      pillars.push([x, d / 2], [x, -d / 2]);
      if (vd > 0) pillars.push([x, fwz]);
    }
    const nd = Math.max(1, Math.round(d / 2.6));
    for (let j = 1; j < nd; j++) {
      const z = -d / 2 + j * (d / nd);
      if (vd > 0 && z > fwz - 0.3) continue;
      pillars.push([-w / 2, z], [w / 2, z]);
    }
    const pr = o.pillarR ?? (w > 12 ? 0.18 : 0.15);
    for (const [x, z] of pillars) {
      B.add('stone', geo.cyl(pr * 1.7, pr * 2, 0.16, 10), M(x, baseH + 0.08, z), '#d9d4cb');
      B.add('wood', geo.cyl(pr * 0.94, pr, ph - 0.16, 12), M(x, baseH + 0.16 + (ph - 0.16) / 2, z), pillarT);
      B.add('wood', geo.box(pr * 2.3, 0.2, pr * 2.3, 'grain'), M(x, topY + 0.1, z), o.beamTint || WOOD.beam);
    }
    // beams: 창방 on every pillar line + round 도리 under the eaves
    const beamT = o.beamTint || WOOD.beam;
    const zLines = [d / 2, -d / 2]; if (vd > 0) zLines.push(fwz);
    for (const z of zLines) B.add('wood', geo.box(w + 0.3, 0.32, 0.24, 'grain'), M(0, topY - 0.12, z), beamT);
    for (const x of [-w / 2, w / 2]) B.add('wood', geo.box(0.24, 0.32, d + 0.3, 'grain'), M(x, topY - 0.12, 0), beamT);
    for (const z of [d / 2, -d / 2]) B.add('wood', geo.tube(-w / 2 - 0.5, topY + 0.32, z, w / 2 + 0.5, topY + 0.32, z, 0.13, 8), I4, beamT);
    if (o.dancheong) {
      for (const z of [d / 2 + 0.125, -d / 2 - 0.125]) B.add('paint', geo.box(w, 0.1, 0.01), M(0, topY - 0.1, z), '#2f7a68');
    }
    // walls
    const wy0 = floorY, wy1 = topY - 0.28;
    const doorSet = new Set(o.doors || (nb % 2 ? [Math.floor(nb / 2)] : [nb / 2 - 1, nb / 2]));
    for (let i = 0; i < nb; i++) {
      const x0 = -w / 2 + i * bay, x1 = x0 + bay;
      const type = doorSet.has(i) ? 'door' : (o.frontType || 'window');
      wallBay(B, x0 + pr, fwz, x1 - pr, fwz, 0, 1, type, wy0, wy1, st);
      wallBay(B, x1 - pr, -d / 2, x0 + pr, -d / 2, 0, -1, i % 2 ? 'window' : 'wall', wy0, wy1, st);
    }
    const sideZ = [-d / 2];
    for (let j = 1; j < nd; j++) { const z = -d / 2 + j * (d / nd); if (!(vd > 0 && z > fwz - 0.3)) sideZ.push(z); }
    sideZ.push(fwz);
    for (let j = 0; j < sideZ.length - 1; j++) {
      const za = sideZ[j] + pr, zb = sideZ[j + 1] - pr;
      const type = j === sideZ.length - 2 && (zb - za) > 1.6 ? 'window' : 'wall';
      wallBay(B, -w / 2, zb, -w / 2, za, -1, 0, type, wy0, wy1, st);
      wallBay(B, w / 2, za, w / 2, zb, 1, 0, type, wy0, wy1, st);
    }
    // 누마루 railing
    if (o.railing && vd > 0) {
      const ry = floorY;
      for (let i = 0; i < nb; i++) {
        if (doorSet.has(i)) continue;
        const x0 = -w / 2 + i * bay + pr, x1 = x0 + bay - pr * 2;
        const len = x1 - x0, cx = (x0 + x1) / 2;
        B.add('railing', geo.mquad(len, 0.72, 0, 0), M(cx, ry + 0.36, d / 2 + 0.02));
        B.add('wood', geo.box(len, 0.07, 0.1, 'grain'), M(cx, ry + 0.75, d / 2 + 0.02), WOOD.dark);
      }
    }
    // roof
    const ro = { mode: o.roofMode || 'paljak', hw: w / 2, hd: d / 2, ov: o.ov ?? clamp(1.25 + d * 0.06, 1.3, 1.9), out: o.out ?? 0.55, lift: o.lift ?? 0.55, t: 0.3, tint: o.roofTint || '#ffffff', gableColor: o.gableColor, vres: 1 };
    ro.rise = o.rise ?? (ro.hd + ro.ov) * 0.72;
    ro.y = roofBaseFor(ro, topY + 0.46);
    ro.ridge = { w: 0.44, h: 0.44 };
    const info = roof(B, M(0, 0, 0), ro);
    // 현판: hangs from the front beam, kept below the eave line so it reads from the yard
    const eaveBottom = ro.y - ro.t;
    if (o.sign) {
      const rect = SIGN_ATLAS.sign(o.sign, null, HYEONPAN);
      const sw = o.signW || 1.9, sh = sw / 2;
      const top = Math.min(topY - 0.26, eaveBottom - 0.1);
      addSignBoard(B, rect, sw, sh, M(0, top - sh / 2, d / 2 + 0.2, 0, 1, 1, 1, -0.06));
    }
    // colliders / walkables / blockers
    site.walk(0, 0, w / 2 + bm, d / 2 + bm, baseH, 'stone');
    site.box(0, 0, w / 2 + 0.22, d / 2 + 0.22);
    site.blocker(0, 0, 0, w + 0.3, topY + 0.4, d + 0.3);
    return { topY, floorY, baseH, roof: info, eaveBottom };
  }

  // ---------------------------------------------------------------- 체험교육관 (classroom hanok + big signboard)
  function buildClassroom(site, b) {
    const nb = Math.max(4, Math.round(b.w / 2.6));
    const r = buildHanok(site, b, { bays: nb, doors: [1, nb - 2], frontType: 'window', veranda: 1.3, ph: 3.1, pillarTint: '#9a5a36', sign: null });
    // large wooden signboard hung on the front beam
    const rect = SIGN_ATLAS.sign(b.sign || b.name, '전통발효·전통농업 배움터', { bg1: '#8a5d36', bg2: '#5e3b20', border: '#3a2414', color: '#fff6e0' }, 1024, 256);
    const top = Math.min(r.topY - 0.26, r.eaveBottom - 0.1);
    addSignBoard(site.B, rect, 4.0, 1.0, M(0, top - 0.5, b.d / 2 + 0.24, 0, 1, 1, 1, -0.05));
    return r;
  }

  // ---------------------------------------------------------------- 전통발효체험관 (hall)
  function buildHall(site, b) {
    const B = site.B;
    const W = b.w, D = b.d, hw = W / 2, hd = D / 2;
    const PL = 0.9, SH = 4.2, F2 = PL + SH, F3 = F2 + SH;
    const glassT = '#ffffff', mullT = '#3a4047', bandT = '#6a4a33', woodT = '#a8713f';
    // plinth + coping
    B.add('stone', geo.box(W + 1.6, PL + 1.0, D + 1.6, 'world'), M(0, (PL - 1.0) / 2, 0), '#c4beb3');
    B.add('stone', geo.box(W + 1.8, 0.12, D + 1.8, 'world', 0.4, 0.2), M(0, PL - 0.06, 0), '#d9d4ca');
    // front terrace + steps + cheek walls
    B.add('stone', geo.box(10, PL + 1.0, 5.2, 'world', 1.1), M(0, (PL - 1.0) / 2, hd + 2.5), '#c4beb3');
    B.add('stone', geo.box(10.2, 0.12, 5.3, 'world', 0.2), M(0, PL - 0.06, hd + 2.55), '#d9d4ca');
    for (let i = 0; i < 3; i++) {
      const top = 0.225 * (3 - i);
      const z0 = hd + 5.0 + 0.6 * i;
      B.add('stone', geo.box(9.2, top + 0.3, 0.6, 'world', i), M(0, (top - 0.3) / 2, z0 + 0.3), '#d2cdc3');
      site.walk(0, z0 + 0.3, 4.6, 0.3, top, 'stone');
    }
    for (const sx of [-1, 1]) B.add('stone', geo.box(0.4, PL + 0.35, 1.9, 'world'), M(sx * 4.85, (PL + 0.35) / 2 - 0.05, hd + 5.95), '#cfcac0');
    site.walk(0, hd + 2.5, 5, 2.5, PL, 'stone');
    // glass curtain walls (1F + 2F)
    const glassSide = (len, h, m) => B.add('glass', geo.mquad(len, h, -len / 2, 0), m, glassT);
    glassSide(W, F3 - PL, M(0, PL + (F3 - PL) / 2, hd));
    glassSide(W, F3 - PL, M(0, PL + (F3 - PL) / 2, -hd, PI));
    glassSide(D, F3 - PL, M(hw, PL + (F3 - PL) / 2, 0, PI / 2));
    glassSide(D, F3 - PL, M(-hw, PL + (F3 - PL) / 2, 0, -PI / 2));
    // mullions every 1.5 m (skip the door opening)
    for (let x = -hw + 1.5; x < hw - 0.1; x += 1.5) {
      for (const sz of [1, -1]) {
        if (sz > 0 && Math.abs(x) < 2.6) { B.add('metal', geo.box(0.09, F3 - F2, 0.14), M(x, F2 + (F3 - F2) / 2, hd + 0.06), mullT); continue; }
        B.add('metal', geo.box(0.09, F3 - PL, 0.14), M(x, PL + (F3 - PL) / 2, sz * (hd + 0.06)), mullT);
      }
    }
    for (let z = -hd + 1.5; z < hd - 0.1; z += 1.5) for (const sx of [1, -1]) B.add('metal', geo.box(0.14, F3 - PL, 0.09), M(sx * (hw + 0.06), PL + (F3 - PL) / 2, z), mullT);
    // slab bands
    for (const [y, hgt, dep, tint] of [[F2, 0.5, 0.42, bandT], [F3 + 0.1, 0.7, 0.5, bandT]]) {
      B.add('wood', geo.box(W + dep, hgt, dep, 'grain'), M(0, y, hd), tint);
      B.add('wood', geo.box(W + dep, hgt, dep, 'grain'), M(0, y, -hd), tint);
      B.add('wood', geo.box(dep, hgt, D, 'grain'), M(hw, y, 0), tint);
      B.add('wood', geo.box(dep, hgt, D, 'grain'), M(-hw, y, 0), tint);
    }
    // timber columns every 6 m + stone corner piers
    for (let x = -hw + 6; x < hw - 1; x += 6) for (const sz of [1, -1]) B.add('wood', geo.box(0.5, F3 - PL, 0.5, 'grain'), M(x, PL + (F3 - PL) / 2, sz * (hd + 0.3)), woodT);
    for (let z = -hd + 6; z < hd - 1; z += 6) for (const sx of [1, -1]) B.add('wood', geo.box(0.5, F3 - PL, 0.5, 'grain'), M(sx * (hw + 0.3), PL + (F3 - PL) / 2, z), woodT);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) B.add('stone', geo.box(1.5, F3 - PL + 0.5, 1.5, 'world', sx, sz), M(sx * (hw - 0.1), PL + (F3 - PL + 0.5) / 2, sz * (hd - 0.1)), '#e4e0d8');
    // entrance doors + HALL_DOOR anchor
    const doorH = 3.3;
    B.add('wood', geo.box(5.4, 0.35, 0.5, 'grain'), M(0, PL + doorH + 0.17, hd + 0.12), WOOD.dark);
    for (const sx of [-1, 1]) B.add('wood', geo.box(0.3, doorH, 0.5, 'grain'), M(sx * 2.55, PL + doorH / 2, hd + 0.12), WOOD.dark);
    B.add('metal', geo.box(0.08, doorH, 0.16), M(0, PL + doorH / 2, hd + 0.1), mullT);
    B.add('darkglass', geo.box(4.8, doorH, 0.06), M(0, PL + doorH / 2, hd + 0.04), '#ffffff');
    for (const sx of [-1, 1]) B.add('metal', geo.box(0.05, 1.1, 0.08), M(sx * 0.22, PL + 1.1, hd + 0.16), '#c9a45a');
    B.add('glow', geo.box(4.8, 0.06, 0.2), M(0, PL + doorH + 0.02, hd + 0.4), '#ffffff');
    const door = new THREE.Group(); door.name = 'HALL_DOOR';
    door.position.set(0, 0, hd + 0.2);
    Site.proxy(door, 0, PL, 0, 5.2, doorH + 0.3, 0.6);
    site.group.add(door);
    // 2F balconies (left & right of the portico)
    for (const sx of [-1, 1]) {
      const x0 = 5.6, x1 = hw - 3, len = x1 - x0, cx = sx * (x0 + len / 2), dz = 1.7;
      B.add('plank', geo.box(len, 0.2, dz, 'world'), M(cx, F2 + 0.2, hd + dz / 2), '#d8b78a');
      B.add('railing', geo.mquad(len, 1.0), M(cx, F2 + 0.8, hd + dz - 0.05));
      B.add('wood', geo.box(len + 0.1, 0.09, 0.12, 'grain'), M(cx, F2 + 1.32, hd + dz - 0.05), WOOD.dark);
      for (const ex of [x0, x1]) {
        B.add('railing', geo.mquad(dz, 1.0), M(sx * ex, F2 + 0.8, hd + dz / 2, PI / 2));
        B.add('wood', geo.box(0.12, 0.09, dz, 'grain'), M(sx * ex, F2 + 1.32, hd + dz / 2), WOOD.dark);
      }
      for (let x = x0; x <= x1 + 0.01; x += len / 4) {
        B.add('wood', geo.box(0.12, 1.3, 0.12, 'grain'), M(sx * x, F2 + 0.75, hd + dz - 0.05), WOOD.dark);
        B.add('wood', geo.beam(sx * x, F2 - 0.75, hd + 0.08, sx * x, F2 + 0.08, hd + dz * 0.62, 0.12, 0.14), I4, WOOD.dark);
      }
    }
    // lower roof tier (skirt) around the 3F
    const w3 = hw - 3, d3 = hd - 3;
    const sk = { mode: 'skirt', hw, hd, ov: 1.7, out: 0.9, lift: 0.75, t: 0.42, rise: (hd + 1.7) * 0.85, vres: 1.4, seg: 0.8, tint: '#f4f6f8' };
    sk.vs = 1 - d3 / (hd + sk.ov);
    sk.y = roofBaseFor(sk, F3 + 0.45);
    roof(B, I4, sk);
    // 3F: timber pillars + hanji lattice windows + rails
    const W3top = 14.9;
    const s3x = Math.round((w3 * 2) / 3.5), s3z = Math.round((d3 * 2) / 3.6);
    B.add('plaster', geo.box(w3 * 2, W3top - F3, d3 * 2, 'world'), M(0, F3 + (W3top - F3) / 2, 0), '#f3efe6');
    const pill3 = [];
    for (let i = 0; i <= s3x; i++) { const x = -w3 + i * (2 * w3 / s3x); pill3.push([x, d3], [x, -d3]); }
    for (let j = 1; j < s3z; j++) { const z = -d3 + j * (2 * d3 / s3z); pill3.push([w3, z], [-w3, z]); }
    for (const [x, z] of pill3) B.add('wood', geo.cyl(0.21, 0.23, W3top - F3, 12), M(x, F3 + (W3top - F3) / 2, z), '#8f4f2f');
    const win3 = (x0, z0, x1, z1, nx, nz) => {
      const len = Math.hypot(x1 - x0, z1 - z0), cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, ry = Math.atan2(nx, nz);
      const yb = 12.35, yt = 14.3;
      B.add('hanji', geo.quad(len - 0.5, yt - yb, [0.5, 0, 1, 1]), M(cx + nx * 0.03, (yb + yt) / 2, cz + nz * 0.03, ry));
      B.add('wood', geo.box(len, 0.16, 0.22, 'grain'), M(cx + nx * 0.05, yb - 0.08, cz + nz * 0.05, ry), WOOD.dark);
      B.add('wood', geo.box(len, 0.2, 0.22, 'grain'), M(cx + nx * 0.05, yt + 0.1, cz + nz * 0.05, ry), WOOD.dark);
    };
    for (let i = 0; i < s3x; i++) { const xa = -w3 + i * (2 * w3 / s3x), xb = xa + 2 * w3 / s3x; win3(xa, d3, xb, d3, 0, 1); win3(xb, -d3, xa, -d3, 0, -1); }
    for (let j = 0; j < s3z; j++) { const za = -d3 + j * (2 * d3 / s3z), zb = za + 2 * d3 / s3z; win3(w3, za, w3, zb, 1, 0); win3(-w3, zb, -w3, za, -1, 0); }
    B.add('wood', geo.box(w3 * 2 + 0.4, 0.38, 0.3, 'grain'), M(0, W3top + 0.05, d3), WOOD.beam);
    B.add('wood', geo.box(w3 * 2 + 0.4, 0.38, 0.3, 'grain'), M(0, W3top + 0.05, -d3), WOOD.beam);
    B.add('wood', geo.box(0.3, 0.38, d3 * 2 + 0.4, 'grain'), M(w3, W3top + 0.05, 0), WOOD.beam);
    B.add('wood', geo.box(0.3, 0.38, d3 * 2 + 0.4, 'grain'), M(-w3, W3top + 0.05, 0), WOOD.beam);
    // main 팔작 roof
    const mr = { mode: 'paljak', hw: w3, hd: d3, ov: 2.7, out: 1.25, lift: 1.3, t: 0.55, rise: 7.4, vres: 1.6, seg: 0.8, bo: 0.75, ridge: { w: 0.85, h: 0.95 }, tint: '#f4f6f8', gableColor: '#5e3f28' };
    mr.y = roofBaseFor(mr, W3top + 0.24);
    const main = roof(B, I4, mr);
    // big signboard on the 3F front
    const bigRect = SIGN_ATLAS.sign(b.name || '전통발효체험관', null, { ...HYEONPAN, size: 120 }, 1024, 256);
    addSignBoard(B, bigRect, 8.6, 2.15, M(0, 13.25, d3 + 0.42, 0, 1, 1, 1, -0.08), '#3a2414');
    // entrance portico (hanok roof on four posts)
    const pz = hd + 2.5, phw = 3.4, phd = 2.0;
    const pTop = PL + 4.0;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const x = sx * phw, z = pz + sz * phd;
      B.add('stone', geo.cyl(0.36, 0.42, 0.18, 10), M(x, PL + 0.09, z), '#d9d4cb');
      B.add('wood', geo.cyl(0.2, 0.22, pTop - PL - 0.18, 12), M(x, PL + 0.18 + (pTop - PL - 0.18) / 2, z), WOOD.red);
      B.add('wood', geo.box(0.5, 0.22, 0.5, 'grain'), M(x, pTop + 0.11, z), '#3f7f6c');
    }
    for (const sz of [-1, 1]) B.add('wood', geo.box(phw * 2 + 0.5, 0.36, 0.26, 'grain'), M(0, pTop - 0.08, pz + sz * phd), '#3f7f6c');
    for (const sx of [-1, 1]) B.add('wood', geo.box(0.26, 0.36, phd * 2 + 0.5, 'grain'), M(sx * phw, pTop - 0.08, pz), '#3f7f6c');
    for (const sz of [-1, 1]) B.add('paint', geo.box(phw * 2 + 0.2, 0.08, 0.02), M(0, pTop - 0.02, pz + sz * (phd + 0.14)), '#b8463a');
    const po = { mode: 'paljak', hw: phw, hd: phd, ov: 1.3, out: 0.5, lift: 0.55, t: 0.32, rise: 2.5, bo: 0.38, ridge: { w: 0.42, h: 0.44 } };
    po.y = roofBaseFor(po, pTop + 0.42);
    roof(B, M(0, 0, pz), po);
    const pRect = SIGN_ATLAS.sign('전통발효체험관', null, { ...HYEONPAN, size: 70 });
    addSignBoard(B, pRect, 2.0, 1.0, M(0, Math.min(pTop - 0.28, po.y - po.t - 0.1) - 0.5, pz + phd + 0.18, 0, 1, 1, 1, -0.05));
    // colliders, blockers
    site.box(0, -0.4, hw + 0.8, hd + 0.4);
    for (const sx of [-1, 1]) site.box(sx * (5 + (hw + 0.8 - 5) / 2), hd + 0.4, (hw + 0.8 - 5) / 2, 0.4);
    for (const sx of [-1, 1]) { site.box(sx * 4.85, hd + 3.45, 0.22, 3.45); site.circle(sx * phw, pz + phd, 0.26); site.circle(sx * phw, pz - phd, 0.26); }
    site.blocker(0, -0.5, 0, W + 1.6, F3 + 1.2, D + 1.6);
    site.blocker(0, F3, 0, w3 * 2 + 0.6, W3top - F3 + 0.4, d3 * 2 + 0.6);
    G.world.registerObject(L.hallDoor?.id || 'HALL_DOOR', door);
    return { ridgeY: main.ridgeY };
  }

  // ---------------------------------------------------------------- 발효주 저장고 (stone + timber storehouse, open doorway)
  function buildStorage(site, b) {
    const B = site.B;
    const w = b.w, d = b.d, hw = w / 2, hd = d / 2;
    const baseH = 0.18, stoneH = 1.6, wallTop = 4.8, th = 0.45;
    const doorW = 4.0, doorH = 2.9;
    B.add('stone', geo.box(w + 1.2, baseH + 0.5, d + 1.2, 'world'), M(0, (baseH - 0.5) / 2, 0), '#d8d2c6');
    B.add('stone', geo.box(w - th * 2, 0.04, d - th * 2, 'world'), M(0, baseH + 0.02, 0), '#bdb5a6');
    // walls: lower field stone, upper vertical boards between timber posts
    const wall = (x0, z0, x1, z1, nx, nz) => {
      const len = Math.hypot(x1 - x0, z1 - z0); if (len < 0.1) return;
      const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, ry = Math.atan2(nx, nz);
      B.add('field', geo.box(len, stoneH, th + 0.08, 'world', cx * 0.7), M(cx, baseH + stoneH / 2, cz, ry), '#ffffff');
      B.add('stone', geo.box(len + 0.05, 0.12, th + 0.14, 'world'), M(cx, baseH + stoneH + 0.06, cz, ry), '#e9e5dc');
      const uh = wallTop - baseH - stoneH - 0.12;
      const g = geo.box(len, uh, th - 0.1, 'world');
      // vertical boards: rotate UVs (plank texture runs along U)
      const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getY(i), uv.getX(i));
      B.add('plank', g, M(cx, baseH + stoneH + 0.12 + uh / 2, cz, ry), '#9a7656');
      B.add('wood', geo.box(len + 0.1, 0.26, th + 0.06, 'grain'), M(cx, wallTop - 0.13, cz, ry), WOOD.dark);
      B.add('wood', geo.box(len, 0.14, th + 0.02, 'grain'), M(cx, baseH + stoneH + 0.5 + uh * 0.45, cz, ry), WOOD.dark);
    };
    wall(-hw, -hd, hw, -hd, 0, -1);
    wall(-hw, -hd, -hw, hd, -1, 0);
    wall(hw, -hd, hw, hd, 1, 0);
    wall(-hw, hd, -doorW / 2 - 0.2, hd, 0, 1);
    wall(doorW / 2 + 0.2, hd, hw, hd, 0, 1);
    // lintel wall above the doorway
    const lt = wallTop - (baseH + doorH);
    B.add('plank', geo.box(doorW + 0.4, lt, th - 0.1, 'world'), M(0, baseH + doorH + lt / 2, hd), '#9a7656');
    // corner + door posts
    for (const [x, z] of [[-hw, -hd], [hw, -hd], [-hw, hd], [hw, hd], [-hw, 0], [hw, 0], [0, -hd]]) B.add('wood', geo.box(0.36, wallTop - baseH, 0.36, 'grain'), M(x, baseH + (wallTop - baseH) / 2, z), WOOD.dark);
    for (const sx of [-1, 1]) B.add('wood', geo.box(0.34, doorH + 0.2, th + 0.16, 'grain'), M(sx * (doorW / 2 + 0.12), baseH + (doorH + 0.2) / 2, hd), '#5e3d24');
    B.add('wood', geo.box(doorW + 0.9, 0.36, th + 0.2, 'grain'), M(0, baseH + doorH + 0.18, hd), '#5e3d24');
    // open plank door leaves swung against the façade
    for (const sx of [-1, 1]) {
      const g = geo.box(doorW / 2, doorH - 0.1, 0.1, 'world');
      const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getY(i), uv.getX(i));
      B.add('plank', g, M(sx * (doorW / 2 + 0.3 + doorW / 4), baseH + (doorH - 0.1) / 2 + 0.03, hd + 0.32, 0), '#7a5236');
      for (const yy of [0.6, doorH - 0.7]) B.add('metal', geo.box(doorW / 2 - 0.1, 0.07, 0.04), M(sx * (doorW / 2 + 0.3 + doorW / 4), baseH + yy, hd + 0.39), '#2b2b2b');
    }
    // interior: dim inner faces, beams, big jars on stone slabs, hanging lamp
    B.add('wood', geo.box(w - th * 2, 0.06, d - th * 2), M(0, wallTop - 0.03, 0), '#3b2a1e');
    for (let x = -hw + 2.2; x < hw - 1; x += 2.6) B.add('wood', geo.box(0.26, 0.3, d, 'grain'), M(x, wallTop - 0.2, 0), WOOD.dark);
    const jr = rngOf('storage-jars');
    const inside = [];
    for (let row = 0; row < 2; row++) for (let i = 0; i < 6; i++) {
      const x = -hw + 1.4 + i * ((w - 2.8) / 5), z = -hd + 1.25 + row * 1.6;
      inside.push([x, z, row ? 'dok' : 'jungduri', 1.05 + jr() * 0.25]);
    }
    for (const x of [-hw + 1.2, hw - 1.2]) inside.push([x, 1.6, 'hangari', 0.95 + jr() * 0.2]);
    for (const [x, z, kind, s] of inside) {
      B.add('stone', geo.cyl(0.55 * s, 0.6 * s, 0.12, 12), M(x, baseH + 0.06, z), '#9d968a');
      B.add('glaze', jarGeometry(kind, 14), M(x, baseH + 0.12, z, jr() * TAU, s), '#ffffff');
      B.add('glaze', lidGeometry(12, (kind === 'dok' ? 0.31 : kind === 'jungduri' ? 0.325 : 0.29) * 1.0), M(x, baseH + 0.12 + jarTop(kind) * s - 0.01, z, 0, s), '#ffffff');
      site.circle(x, z, 0.5 * s);
    }
    B.add('glow', geo.cyl(0.18, 0.22, 0.4, 8), M(0, wallTop - 0.9, 0.5), '#ffffff');
    B.add('wood', geo.box(0.03, 0.55, 0.03), M(0, wallTop - 0.42, 0.5), '#222222');
    // roof
    const ro = { mode: 'paljak', hw, hd, ov: 1.5, out: 0.5, lift: 0.5, t: 0.3, rise: (hd + 1.5) * 0.7, tint: '#eef0f2', gableColor: '#5a3d26' };
    ro.y = roofBaseFor(ro, wallTop + 0.1);
    roof(B, I4, ro);
    // 현판 above the doorway
    const rect = SIGN_ATLAS.sign(b.sign || b.name, null, HYEONPAN);
    const sTop = Math.min(wallTop - 0.2, ro.y - ro.t - 0.1);
    const sH = clamp(sTop - (baseH + doorH + 0.4), 0.5, 0.95);
    addSignBoard(B, rect, sH * 2, sH, M(0, sTop - sH / 2, hd + 0.3, 0, 1, 1, 1, -0.05));
    // colliders: wall boxes (interior walkable)
    site.box(0, -hd, hw + 0.1, th / 2 + 0.05);
    site.box(-hw, 0, th / 2 + 0.05, hd + 0.1);
    site.box(hw, 0, th / 2 + 0.05, hd + 0.1);
    const fl = (hw - doorW / 2 - 0.2);
    for (const sx of [-1, 1]) site.box(sx * (doorW / 2 + 0.2 + fl / 2), hd, fl / 2 + 0.05, th / 2 + 0.05);
    site.walk(0, 0, hw + 0.6, hd + 0.6, baseH, 'stone');
    site.blocker(0, 0, -hd, w, wallTop, th);
    site.blocker(-hw, 0, 0, th, wallTop, d);
    site.blocker(hw, 0, 0, th, wallTop, d);
    for (const sx of [-1, 1]) site.blocker(sx * (doorW / 2 + 0.2 + fl / 2), 0, hd, fl, wallTop, th);
  }

  // ---------------------------------------------------------------- 초가집 (thatched house)
  function buildThatched(site, b) {
    const B = site.B;
    const w = b.w, d = b.d, hw = w / 2, hd = d / 2;
    const baseH = 0.32, wallTop = baseH + 2.25;
    const earth = '#bfa077';
    B.add('field', geo.box(w + 1.0, baseH + 0.5, d + 1.0, 'world'), M(0, (baseH - 0.5) / 2, 0), '#ffffff');
    B.add('stone', geo.box(w + 1.04, 0.06, d + 1.04, 'world'), M(0, baseH - 0.03, 0), '#c9c2b4');
    // walls (earth plaster) with rough posts and beams
    B.add('plaster', geo.box(w, wallTop - baseH, d, 'world'), M(0, (baseH + wallTop) / 2, 0), earth);
    const posts = [];
    for (let i = 0; i <= 3; i++) { const x = -hw + i * (w / 3); posts.push([x, hd], [x, -hd]); }
    posts.push([-hw, 0], [hw, 0]);
    for (const [x, z] of posts) B.add('wood', geo.box(0.22, wallTop - baseH + 0.1, 0.22, 'grain'), M(x, (baseH + wallTop) / 2 + 0.05, z), '#7a5a3e');
    for (const z of [hd, -hd]) B.add('wood', geo.tube(-hw - 0.12, wallTop + 0.05, z, hw + 0.12, wallTop + 0.05, z, 0.12, 7), I4, '#7a5a3e');
    for (const x of [hw, -hw]) B.add('wood', geo.tube(x, wallTop + 0.05, -hd - 0.1, x, wallTop + 0.05, hd + 0.1, 0.11, 7), I4, '#7a5a3e');
    // wooden door + lattice windows
    const g = geo.box(0.95, 1.85, 0.08, 'world'); const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getY(i), uv.getX(i));
    B.add('plank', g, M(-w / 6, baseH + 0.98, hd + 0.03), '#8a6646');
    B.add('wood', geo.box(1.15, 0.12, 0.14), M(-w / 6, baseH + 1.95, hd + 0.03), '#5a3f28');
    for (const x of [w / 6 + 0.2, -hw + 0.0]) {
      if (x === -hw) continue;
      B.add('hanji', geo.quad(0.9, 0.7, [0.5, 0, 1, 1]), M(x, baseH + 1.45, hd + 0.075));
      B.add('wood', geo.box(1.04, 0.84, 0.06), M(x, baseH + 1.45, hd + 0.04), '#5a3f28');
    }
    B.add('hanji', geo.quad(0.8, 0.6, [0.5, 0, 1, 1]), M(hw + 0.075, baseH + 1.45, -0.6, PI / 2));
    // little 툇마루 bench along the front
    B.add('plank', geo.box(w * 0.55, 0.08, 0.55, 'world'), M(w * 0.18, baseH + 0.42, hd + 0.35), '#c49a6c');
    for (const x of [w * 0.18 - w * 0.25, w * 0.18 + w * 0.25]) B.add('wood', geo.box(0.1, 0.38, 0.1), M(x, baseH + 0.19, hd + 0.5), '#6a4a30');
    // rounded straw roof (superellipse rings) with braided ridge
    const A = hw + 0.95, Cc = hd + 0.95, H = 2.25, r0 = Math.max(0.3, A - Cc);
    const ring = (s) => ({ a: r0 + (A - r0) * s, b: Cc * s });
    const NR = 10, NA = 40;
    const P = (i, j, oo, dy = 0, shrink = 0) => {
      const phi = (j / NR) * (PI / 2) * 0.96;
      const s = Math.cos(phi), hgt = Math.sin(phi) * H;
      const r = ring(s);
      const ang = (i / NA) * TAU;
      const ca = Math.cos(ang), sa = Math.sin(ang);
      const px = Math.sign(ca) * Math.pow(Math.abs(ca), 0.55) * (r.a - shrink), pz = Math.sign(sa) * Math.pow(Math.abs(sa), 0.55) * Math.max(0.02, r.b - shrink);
      oo[0] = px; oo[2] = pz; oo[1] = wallTop - 0.25 + hgt + dy;
      oo[3] = (i / NA) * 2 * (A + Cc) * 1.4; oo[4] = phi * H * 1.6;
    };
    B.add('thatch', geo.grid(NA, NR, (i, j, oo) => P(i, j, oo), true), I4, '#b8a17a');
    // thick rolled eave edge + underside
    B.add('thatch', geo.grid(NA, 1, (i, j, oo) => { P(i, 0, oo); if (!j) { oo[1] -= 0.45; oo[0] *= 0.985; oo[2] *= 0.985; } oo[4] = j * 0.5; }, true), I4, '#d8cbb0');
    B.add('thatch', geo.grid(NA, 1, (i, j, oo) => { P(i, 0, oo, -0.45, 0); oo[0] *= j ? 0.62 : 0.985; oo[2] *= j ? 0.62 : 0.985; oo[1] = wallTop - 0.7 + (j ? 0.4 : 0); }), I4, '#8f7a58');
    // 용마름 ridge
    const pts = [];
    for (let i = 0; i <= 8; i++) { const x = (i / 8 * 2 - 1) * (r0 + 0.2); pts.push(new THREE.Vector3(x, wallTop - 0.25 + H * 0.99, 0)); }
    B.add('thatch', geo.sweep(pts, [[-0.3, -0.05], [0.3, -0.05], [0.2, 0.22], [-0.2, 0.22]], ['#b79a62']), I4);
    // jars + firewood by the wall
    const jr = rngOf('thatch-jars');
    for (const [x, z, kind, s] of [[hw + 0.7, 0.9, 'hangari', 0.75], [hw + 0.75, 1.75, 'danji', 1.1], [hw + 0.6, -0.1, 'hangari', 0.6], [-hw - 0.75, 1.2, 'danji', 1.0]]) {
      B.add('glaze', jarGeometry(kind, 12), M(x, baseH, z, jr() * TAU, s), '#ffffff');
      if (kind === 'hangari') B.add('glaze', lidGeometry(12), M(x, baseH + jarTop(kind) * s - 0.01, z, 0, s), '#ffffff');
      site.circle(x, z, 0.4 * s);
    }
    for (let i = 0; i < 9; i++) {
      const row = Math.floor(i / 3), k = i % 3;
      B.add('wood', geo.cyl(0.09, 0.09, 1.1, 7), M(-hw - 0.45, baseH + 0.1 + row * 0.17, -1.2 + k * 0.2 + (row % 2) * 0.1, 0, 1, 1, 1, PI / 2), '#8a6a48');
    }
    site.walk(0, 0, hw + 0.5, hd + 0.5, baseH, 'stone');
    site.box(0, 0, hw + 0.15, hd + 0.15);
    site.box(-hw - 0.45, -1.0, 0.3, 0.6);
    site.blocker(0, 0, 0, w, wallTop, d);
  }

  // ---------------------------------------------------------------- 정자 (hexagonal pavilion, walkable floor)
  function buildPavilion(site, b) {
    const B = site.B;
    const n = 6, Rp = Math.min(b.w, b.d) / 2 * 0.86; // post circle radius
    const floorH = 0.9, postH = 2.65;
    const L2 = G.data.layout;
    // entrance faces the path coming from the north-west (towards (45,33))
    const tx = 45 - b.x, tz = 33 - b.z;
    const entAng = Math.atan2(tx, tz) - site.rot;
    const rot0 = entAng + PI / n; // corners offset so a side faces the entrance
    const corner = (i, r = Rp) => { const a = rot0 + i / n * TAU; return [Math.sin(a) * r, Math.cos(a) * r]; };
    const apo = Rp * Math.cos(PI / n); // inner radius to a side
    // stone base + floor
    const baseG = geo.cyl(Rp + 0.55, Rp + 0.6, 0.35, n, false); baseG.rotateY(rot0);
    B.add('stone', baseG, M(0, 0.12, 0), '#d6d1c7');
    for (let i = 0; i < n; i++) {
      const [x, z] = corner(i);
      B.add('stone', geo.box(0.42, 0.25, 0.42), M(x, 0.42, z), '#cfc9be');
      B.add('wood', geo.cyl(0.11, 0.11, floorH - 0.5, 8), M(x * 0.6, 0.3 + (floorH - 0.5) / 2, z * 0.6), WOOD.dark);
    }
    const floorG = geo.cyl(Rp + 0.25, Rp + 0.25, 0.14, n, false); floorG.rotateY(rot0);
    { const uv = floorG.attributes.uv; const p = floorG.attributes.position; for (let i = 0; i < uv.count; i++) uv.setXY(i, p.getX(i), p.getZ(i)); }
    B.add('plank', floorG, M(0, floorH - 0.07, 0), '#dcbb8c');
    B.add('wood', (() => { const g = geo.cyl(Rp + 0.27, Rp + 0.27, 0.22, n, true); g.rotateY(rot0); return g; })(), M(0, floorH - 0.2, 0), WOOD.dark);
    // posts + beams
    for (let i = 0; i < n; i++) {
      const [x, z] = corner(i);
      B.add('wood', geo.cyl(0.15, 0.16, postH, 12), M(x, floorH + postH / 2, z), WOOD.red);
      B.add('wood', geo.box(0.36, 0.2, 0.36, 'grain'), M(x, floorH + postH + 0.1, z), '#3f7f6c');
      const [x2, z2] = corner(i + 1);
      B.add('wood', geo.beam(x, floorH + postH - 0.1, z, x2, floorH + postH - 0.1, z2, 0.22, 0.3), I4, '#3f7f6c');
      B.add('paint', geo.beam(x * 1.01, floorH + postH - 0.04, z * 1.01, x2 * 1.01, floorH + postH - 0.04, z2 * 1.01, 0.235, 0.07), I4, '#b8463a');
      // railing on all sides except the entrance side (side 0 faces the entrance)
      if (i !== n - 1) {
        const mx = (x + x2) / 2, mz = (z + z2) / 2, len = Math.hypot(x2 - x, z2 - z) - 0.3;
        const ry = Math.atan2(mx, mz);
        B.add('railing', geo.mquad(len, 0.7), M(mx, floorH + 0.35, mz, ry));
        B.add('wood', geo.box(len + 0.3, 0.08, 0.12, 'grain'), M(mx, floorH + 0.72, mz, ry), WOOD.dark);
        // the railing blocks walkers on the floor and under it
        site.box(mx, mz, len / 2 + 0.15, 0.16, { rot: ry });
      }
      site.circle(x, z, 0.22);
    }
    // steps at the entrance side
    {
      const [x, z] = corner(n - 1), [x2, z2] = corner(0);
      const mx = (x + x2) / 2, mz = (z + z2) / 2, ry = Math.atan2(mx, mz);
      const nx = Math.sin(ry), nz = Math.cos(ry);
      for (let s = 0; s < 2; s++) {
        const top = 0.3 * (s + 1), dist = apo + 0.25 + 0.4 * (2 - s) - 0.2;
        B.add('stone', geo.box(1.8, top + 0.3, 0.42), M(nx * dist, (top - 0.3) / 2, nz * dist, ry), '#e3dfd6');
        site.walk(nx * dist, nz * dist, 0.9, 0.21, top, 'stone', ry);
      }
      // skirt colliders beside the steps (stop ground walkers sliding under the floor)
      for (const sgn of [-1, 1]) {
        const ox = mx + Math.cos(ry) * sgn * 1.25, oz = mz - Math.sin(ry) * sgn * 1.25;
        site.box(ox, oz, 0.3, 0.2, { rot: ry, maxY: floorH });
      }
    }
    site.walkCircle(0, 0, apo + 0.15, floorH, 'wood');
    // hexagonal roof
    polyRoof(B, I4, { n, R: Rp + 1.35, y: floorH + postH + 0.32, rise: 2.2, lift: 0.55, t: 0.28, rot: rot0, tint: '#ffffff' });
    // the merged roof mesh is the camera blocker (a box would push the camera in while standing inside)
    return { floorH };
  }

  // ---------------------------------------------------------------- 정문 (솟을대문)
  function buildGate(site, b) {
    const B = site.B;
    const w = b.w, d = b.d, hw = w / 2, hd = d / 2;
    const pw = 2.1; // half passage width
    const cTop = 4.3, wTop = 2.75;
    B.add('stone', geo.box(w + 0.8, 0.5, d + 0.8, 'world'), M(0, -0.12, 0), '#d8d3ca');
    B.add('stone', geo.box(pw * 2 - 0.2, 0.14, 0.4), M(0, 0.07, 0), '#bfb8ab');
    site.walk(0, 0, pw - 0.1, 0.2, 0.14, 'stone');
    // posts
    const posts = [[-pw, hd], [pw, hd], [-pw, -hd], [pw, -hd]];
    for (const [x, z] of posts) {
      B.add('stone', geo.box(0.5, 0.18, 0.5), M(x, 0.2, z), '#d9d4cb');
      B.add('wood', geo.cyl(0.18, 0.2, cTop - 0.2, 12), M(x, 0.2 + (cTop - 0.2) / 2, z), WOOD.red);
    }
    for (const sx of [-1, 1]) for (const z of [hd, -hd]) {
      B.add('wood', geo.cyl(0.15, 0.17, wTop - 0.2, 10), M(sx * hw, 0.2 + (wTop - 0.2) / 2, z), WOOD.red);
    }
    // central beams (dancheong)
    for (const z of [hd, -hd]) {
      B.add('wood', geo.box(pw * 2 + 0.6, 0.38, 0.26, 'grain'), M(0, cTop - 0.1, z), '#3f7f6c');
      B.add('paint', geo.box(pw * 2 + 0.3, 0.09, 0.02), M(0, cTop - 0.06, z + Math.sign(z) * 0.14), '#b8463a');
    }
    for (const sx of [-1, 1]) B.add('wood', geo.box(0.26, 0.38, d + 0.5, 'grain'), M(sx * pw, cTop - 0.1, 0), '#3f7f6c');
    // big doors swung open against the passage sides
    for (const sx of [-1, 1]) {
      const g = geo.box(0.12, cTop - 0.75, d * 0.62, 'world');
      const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getY(i), uv.getX(i));
      B.add('plank', g, M(sx * (pw - 0.22), 0.2 + (cTop - 0.75) / 2, -hd * 0.25), '#7a4a30');
      for (const yy of [0.7, cTop - 1.3]) B.add('metal', geo.box(0.04, 0.08, d * 0.6), M(sx * (pw - 0.3), yy, -hd * 0.25), '#2a2a2a');
      B.add('metal', geo.cyl(0.12, 0.12, 0.03, 12), M(sx * (pw - 0.3), 1.6, -hd * 0.25 + 0.4, 0, 1, 1, 1, 0, PI / 2), '#c9a45a');
    }
    // side wings (행랑): stone lower walls + plaster + small windows
    for (const sx of [-1, 1]) {
      const cx = sx * (pw + (hw - pw) / 2), len = hw - pw - 0.3;
      for (const z of [hd, -hd]) {
        B.add('field', geo.box(len, 0.9, 0.3, 'world', cx), M(cx, 0.45, z * 0.95), '#ffffff');
        B.add('plaster', geo.box(len, wTop - 1.05, 0.22, 'world'), M(cx, 0.9 + (wTop - 1.05) / 2, z * 0.95), '#ffffff');
        B.add('wood', geo.box(len + 0.3, 0.26, 0.26, 'grain'), M(cx, wTop - 0.05, z), WOOD.beam);
        B.add('wood', geo.box(len, 0.12, 0.26, 'grain'), M(cx, 0.95, z * 0.95), WOOD.dark);
        B.add('hanji', geo.quad(0.9, 0.55, [0.5, 0, 1, 1]), M(cx, 1.75, z * 0.95 + Math.sign(z) * 0.12, z > 0 ? 0 : PI));
        B.add('wood', geo.box(1.02, 0.67, 0.2), M(cx, 1.75, z * 0.95), WOOD.dark);
      }
      B.add('field', geo.box(0.3, 0.9, d * 0.95, 'world'), M(sx * hw * 0.98, 0.45, 0), '#ffffff');
      B.add('plaster', geo.box(0.22, wTop - 1.05, d * 0.95, 'world'), M(sx * hw * 0.98, 0.9 + (wTop - 1.05) / 2, 0), '#ffffff');
      const wr = { mode: 'gable', hw: (hw - pw) / 2 + 0.15, hd, ov: 0.85, rise: 1.5, t: 0.26, tint: '#ffffff', gableColor: '#ffffff', wallTop: wTop + 0.1 };
      wr.y = roofBaseFor(wr, wTop + 0.12);
      roof(B, M(cx + sx * 0.15, 0, 0), wr);
    }
    const cr = { mode: 'gable', hw: pw + 0.35, hd, ov: 1.05, rise: 1.9, t: 0.3, tint: '#ffffff', gableColor: '#6b4a30', wallTop: cTop + 0.2, ridge: { w: 0.46, h: 0.5 } };
    cr.y = roofBaseFor(cr, cTop + 0.12);
    roof(B, I4, cr);
    // 현판
    const rect = SIGN_ATLAS.sign(b.sign || b.name, null, HYEONPAN);
    addSignBoard(B, rect, 2.0, 1.0, M(0, Math.min(cTop - 0.3, cr.y - cr.t - 0.1) - 0.5, hd + 0.2, 0, 1, 1, 1, -0.05));
    for (const sx of [-1, 1]) site.box(sx * (pw + 0.2 + (hw - pw) / 2), 0, (hw - pw) / 2 + 0.1, hd + 0.15);
    for (const [x, z] of posts) site.circle(x, z, 0.22);
    for (const sx of [-1, 1]) site.blocker(sx * (pw + (hw - pw) / 2), 0, 0, hw - pw, wTop, d);
  }

  // ---------------------------------------------------------------- 매점 stall
  function buildStall(site, b) {
    const B = site.B;
    const w = b.w, d = b.d, hw = w / 2, hd = d / 2;
    const h = 2.5;
    B.add('stone', geo.box(w + 0.6, 0.3, d + 0.6, 'world'), M(0, 0.0, 0), '#d6d0c4');
    for (const [x, z] of [[-hw, hd], [hw, hd], [-hw, -hd], [hw, -hd]]) B.add('wood', geo.box(0.16, h, 0.16, 'grain'), M(x, 0.15 + h / 2, z), WOOD.dark);
    // counter (front) + side panels + back wall
    B.add('plank', geo.box(w - 0.1, 0.95, 0.5, 'world'), M(0, 0.15 + 0.48, hd - 0.25), '#c79a68');
    B.add('wood', geo.box(w + 0.1, 0.07, 0.62, 'grain'), M(0, 1.14, hd - 0.22), '#7a5236');
    for (const sx of [-1, 1]) B.add('plank', geo.box(0.08, h * 0.65, d - 0.2, 'world'), M(sx * hw, 0.15 + h * 0.33, 0), '#b8895a');
    B.add('plank', geo.box(w, h, 0.1, 'world'), M(0, 0.15 + h / 2, -hd), '#a87c52');
    for (const yy of [1.0, 1.6]) B.add('wood', geo.box(w - 0.3, 0.05, 0.42), M(0, yy, -hd + 0.28), '#6a4a30');
    // roof board + striped awning sloping forward
    B.add('wood', geo.box(w + 0.5, 0.12, d + 0.4, 'grain'), M(0, 0.15 + h + 0.06, -0.1), WOOD.dark);
    const aw = geo.mquad(w + 0.7, 1.35);
    B.add('awning', aw, mul(M(0, 0.15 + h - 0.2, hd + 0.45), M(0, 0, 0, 0, 1, 1, 1, -PI / 2 + 0.5)));
    // scalloped awning edge
    for (let i = 0; i < 8; i++) {
      const x = -((w + 0.7) / 2) + (i + 0.5) * ((w + 0.7) / 8);
      B.add('paint', geo.box((w + 0.7) / 8 - 0.02, 0.18, 0.02), M(x, 0.15 + h - 0.78, hd + 1.0), i % 2 ? '#f4efe4' : '#2f7d4a');
    }
    // sign on top
    const rect = SIGN_ATLAS.sign(b.sign || '매점', '간식 · 발효식품 · 기념품', { bg1: '#2f7d4a', bg2: '#235f38', border: '#1a4229', color: '#ffffff', subColor: '#e3f5e5' });
    addSignBoard(B, rect, 2.2, 1.1, M(0, 0.15 + h + 0.7, hd - 0.1), '#1f3a26');
    for (const sx of [-1, 1]) B.add('wood', geo.box(0.08, 0.5, 0.08), M(sx * 0.9, 0.15 + h + 0.3, hd - 0.12), WOOD.dark);
    site.box(0, -0.15, hw + 0.15, hd + 0.05);
    site.blocker(0, 0, 0, w, h + 0.2, d);
  }

  // =============================================================================================
  const BUILDERS = {
    hall: buildHall,
    hanok: (site, b) => {
      const big = b.id === 'B_CULTURE';
      const r = rngOf(b.id);
      return buildHanok(site, b, big
        ? { railing: true, veranda: 1.5, ph: 3.0, pillarTint: '#9c5634', sign: b.sign || b.name, signW: 2.2, roofTint: '#f1f3f5' }
        : { veranda: b.d >= 6.5 ? 1.2 : 0.9, pillarTint: r() < 0.5 ? '#a8693f' : '#9a6440', roofTint: r() < 0.5 ? '#ffffff' : '#ece6dc', wallTint: r() < 0.3 ? '#f6efe0' : '#ffffff' });
    },
    classroom: buildClassroom,
    storage: buildStorage,
    thatched: buildThatched,
    pavilion: buildPavilion,
    gate: buildGate,
    stall: buildStall,
  };

  const buildings = {
    name: 'buildings',
    label: '건물',
    order: 20,
    groups: {},
    _list: [],

    init() {
      const E = G.sys.engine;
      if (!E?.scene) throw new Error('engine scene missing');
      registerMaterial('sign', () => {
        const m = new THREE.MeshStandardMaterial({ map: SIGN_ATLAS.getTexture(), roughness: 0.7, metalness: 0.05 });
        return m;
      });
      const root = new THREE.Group(); root.name = 'buildings';
      E.scene.add(root);
      this.root = root;
      let tris = 0;
      for (const b of L.buildings || []) {
        const fn = BUILDERS[b.type];
        if (!fn) { G.log.warn('WORLD', `unknown building type ${b.type} (${b.id})`); continue; }
        try {
          const site = new Site(b);
          fn(site, b);
          tris += site.B.tris;
          const meshes = site.finish(root, { blockKeys: b.type === 'thatched' ? ['thatch'] : ['roof'] });
          site.group.userData.building = b;
          site.group.userData.colliders = site.colliders;
          this.groups[b.id] = site.group;
          this._list.push({ id: b.id, type: b.type, group: site.group, meshes });
          G.world.registerObject(b.id, site.group);
          G.assets.tryOverride(b.id, site.group).catch?.(() => {});
        } catch (e) {
          G.log.error('WORLD', `building ${b.id} failed`, e);
          G._recordSystemError?.({ name: 'buildings' }, 'build ' + b.id, e);
        }
      }
      SIGN_ATLAS.getTexture().needsUpdate = true;
      G.log.info('WORLD', `buildings: ${this._list.length} built, ~${Math.round(tris / 1000)}k triangles`);
    },

    get(id) { return this.groups[id] || null; },
    list() { return this._list.map(({ id, type, group }) => ({ id, type, group })); },
  };
  G.register(buildings);
})();
