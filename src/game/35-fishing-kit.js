// =============================================================================
// 35-fishing-kit.js — G.fishkit: the bodies and skins of the fish of G.data.fish (CONTRACT §18.3, "Realism").
//
// Every species is BUILT from its own `look` (34-fish-data.js): the body is lofted from the depth and width curves
// (snout 0 … tail base 1) with the head's flattening, the arch of the back and the section shape; the fins (dorsal,
// second dorsal, adipose, anal, pelvic, pectoral, tail with its fork) are thin membranes with rays; eyes and barbels
// are geometry. The skin is DRAWN for the species on a canvas: countershading, scales, then its marks — parr marks,
// dotted rows, bands, bars, saddles, mottling, blotches, fin bands — and, in its months, the colours of the breeding
// season. medium / high: one wet, slightly iridescent body material + one translucent fin material; low: the same
// silhouette with vertex colours sampled from a small drawing of the same skin (no texture map, one draw call).
// A swimming wave runs in the vertex shader (uniform `uSwim`: x = phase, y = wave number, z = amplitude).
//
//   G.fishkit.build(id, { quality?, month?, length? (m, default 1 = unit length), swim? = true }) → Object3D | null
//        .userData.fish = { id, length, uniforms: { uSwim }, dispose() }        the fish looks along +X, belly −Y
//   G.fishkit.skin(id, { w, h, month? }) → HTMLCanvasElement       the painted atlas (body + fin cells + the eye)
//   G.fishkit.studio                    a small scene with its own light that draws fish for the 2D interface
//        .show(canvas2d, id, { month?, turn? = true, yaw? }) → handle { stop() }   live: the fish turning in the canvas
//        .thumb(id, { w = 320, h = 200, month?, yaw? }) → Promise<dataURL | ''>     a still picture (cached)
//        .sheet({ cols = 6, cellW = 300, cellH = 190, ids?, month?, labels = true }) → Promise<HTMLCanvasElement>
//                                                                                     the contact sheet of every species
//   G.fishkit.silhouette(kind) → BufferGeometry    'fusi' | 'deep' | 'long' | 'flat' — the cheap shapes of the schools
//   G.fishkit.kindOf(id) → one of those kinds
//   G.fishkit.stats → { built, skins, thumbs, frames }
// The studio never opens a second WebGL context: it draws into a corner of the main canvas BEFORE the engine draws its
// frame (engine.onPreRender — the frame then covers it) and copies that corner into the 2D canvas with drawImage.
// Nothing here is user data: every number and colour comes from the data fragment; colours are validated.
// =============================================================================
(function () {
  const TAU = Math.PI * 2, PI = Math.PI;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const FD = () => (G.data && G.data.fish) || null;
  const HEX = /^#[0-9a-f]{6}$/i;
  const col = (c, d) => (typeof c === 'string' && HEX.test(c) ? c : d || '#808080');
  const quality = () => G.sys.engine?.preset?.name || G.sys.engine?.quality || 'low';
  const stats = { built: 0, skins: 0, thumbs: 0, frames: 0 };

  // ---------------------------------------------------------------- curves
  /** a smooth function through [[s, v] …] (Catmull-Rom, clamped to the neighbours' range so it never overshoots) */
  function sampler(pts) {
    const n = pts.length;
    return (s) => {
      if (s <= pts[0][0]) return pts[0][1];
      if (s >= pts[n - 1][0]) return pts[n - 1][1];
      let i = 1;
      while (i < n - 1 && pts[i][0] < s) i++;
      const p1 = pts[i - 1], p2 = pts[i], p0 = pts[Math.max(0, i - 2)], p3 = pts[Math.min(n - 1, i + 1)];
      const t = (s - p1[0]) / (p2[0] - p1[0]), t2 = t * t, t3 = t2 * t;
      const v = 0.5 * ((2 * p1[1]) + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3);
      const lo = Math.min(p1[1], p2[1]), hi = Math.max(p1[1], p2[1]);
      return clamp(v, lo - (hi - lo) * 0.1, hi + (hi - lo) * 0.1);
    };
  }

  // ---------------------------------------------------------------- the atlas layout (fractions of the canvas)
  // top 62 %: the body (u = snout → tail base, v = back ridge → belly line); bottom 38 %: eight cells
  const BODY_V = 0.62;
  const CELLS = ['dorsal', 'dorsal2', 'anal', 'tail', 'pectoral', 'pelvic', 'adipose', 'eye'];
  const cellRect = (name) => { const i = CELLS.indexOf(name); return { u0: i / 8, u1: (i + 1) / 8, v0: BODY_V, v1: 1 }; };
  /** fin-cell uv: a along the base 0 … 1, b from the base 0 to the tip 1 (a small inset keeps neighbours out) */
  function cellUV(name, a, b) {
    const r = cellRect(name), m = 0.006;
    return [lerp(r.u0 + m, r.u1 - m, a), lerp(r.v1 - m, r.v0 + m, b)];
  }

  // ---------------------------------------------------------------- geometry
  /** the body's measures at s for a look (unit standard length): { x, top, bot, hw (half width) } */
  function bodyAt(P, depth, width, s) {
    const d = depth(s), w = width(s), a = P.arch || 0;
    return { x: 0.5 - s, top: d * (0.5 + a / 2), bot: -d * (0.5 - a / 2), hw: w / 2 };
  }
  /** superellipse point for angle th (0 = back ridge, PI = belly) with exponent n: [y factor −1 … 1, z factor −1 … 1] */
  function sect(th, n) {
    const c = Math.cos(th), s = Math.sin(th), e = 2 / n;
    return [Math.sign(c) * Math.pow(Math.abs(c), e), Math.sign(s) * Math.pow(Math.abs(s), e)];
  }
  /**
   * Build the geometry of one look. → { body: BufferGeometry, fins: BufferGeometry, tris }
   * attributes: position, normal, uv, aSwim (vec3: s along the body, wave weight, flutter weight)
   */
  function buildGeometry(look, q) {
    const P = look.profile, FN = look.fins || {};
    const depth = sampler(P.depth), width = sampler(P.width);
    const NS = q === 'high' ? 44 : q === 'medium' ? 30 : 18, NR = q === 'high' ? 20 : q === 'medium' ? 14 : 10;
    const n = P.section || 2.2;
    const pos = [], uv = [], sw = [], idx = [];
    const push = (x, y, z, u, v, s, w, fl) => { pos.push(x, y, z); uv.push(u, 1 - v * BODY_V); sw.push(s, w, fl || 0); return pos.length / 3 - 1; };
    const wave = (s) => Math.pow(smooth(0.22, 1.0, s), 1.4);
    // ---- the body: NS + 1 rings of NR + 1 vertices (the seam on the back ridge is doubled for the uv)
    const ringStart = [];
    for (let i = 0; i <= NS; i++) {
      // more rings in the head (where the profile changes fastest)
      const t = i / NS, s = Math.pow(t, 1.25);
      const b = bodyAt(P, depth, width, s);
      // a flattened head: the section is squarer and the top is pressed down towards the snout
      const fh = (P.flatHead || 0) * (1 - smooth(0, P.head * 1.3, s));
      const nn = n + fh * 1.2;
      ringStart.push(pos.length / 3);
      for (let j = 0; j <= NR; j++) {
        const th = (j / NR) * TAU;
        const [ey, ez] = sect(th, nn);
        const y = ey >= 0 ? ey * b.top : -ey * b.bot;
        const v = (th <= PI ? th : TAU - th) / PI;
        push(b.x, y, ez * b.hw, s, v, s, wave(s), 0);
      }
    }
    for (let i = 0; i < NS; i++) for (let j = 0; j < NR; j++) {
      const a = ringStart[i] + j, b = ringStart[i + 1] + j;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
    // caps: a rounded snout tip and the closed tail stalk
    {
      const b0 = bodyAt(P, depth, width, 0);
      const tip = push(b0.x + Math.max(b0.top - b0.bot, 0.01) * (0.18 + 0.5 * (P.snout || 0)), (b0.top + b0.bot) / 2 - (P.mouth === 'low' || P.mouth === 'under' ? (b0.top - b0.bot) * 0.12 : 0), 0, 0, 0.5, 0, 0, 0);
      for (let j = 0; j < NR; j++) idx.push(tip, ringStart[0] + j, ringStart[0] + j + 1);
      const b1 = bodyAt(P, depth, width, 1);
      const end = push(b1.x, (b1.top + b1.bot) / 2, 0, 1, 0.5, 1, wave(1), 0);
      for (let j = 0; j < NR; j++) idx.push(end, ringStart[NS] + j + 1, ringStart[NS] + j);
    }
    // ---- eyes: a small sphere half sunk into each side of the head
    const eyeN = q === 'low' ? 6 : 10;
    if (Array.isArray(P.eye)) {
      const [es, eh, ed] = P.eye;
      const b = bodyAt(P, depth, width, es);
      const y = lerp(b.bot, b.top, clamp(eh, 0.05, 0.97));
      const fh = (P.flatHead || 0) * (1 - smooth(0, P.head * 1.3, es));
      const nn = n + fh * 1.2;
      const yn = clamp(y >= 0 ? y / Math.max(b.top, 1e-4) : y / Math.max(-b.bot, 1e-4), -0.999, 0.999);
      const cy = Math.pow(Math.abs(yn), nn / 2), szz = Math.sqrt(Math.max(0, 1 - cy * cy));
      const zf = Math.pow(szz, 2 / nn);
      const r = ed / 2;
      for (const side of [1, -1]) {
        // outward direction at that point (flat heads look up)
        let ny = yn * 0.9, nz = side * Math.max(0.25, zf);
        const nl = Math.hypot(ny, nz) || 1; ny /= nl; nz /= nl;
        const cxp = b.x, cyp = y - ny * r * 0.35, czp = side * zf * b.hw - nz * r * 0.35;
        const base = pos.length / 3;
        for (let a = 0; a <= eyeN; a++) {
          const lat = (a / eyeN) * PI / 2 * 1.25;   // a cap a little more than a hemisphere
          for (let c = 0; c <= eyeN; c++) {
            const lon = (c / eyeN) * TAU;
            const rr = Math.sin(lat) * r, hh = Math.cos(lat) * r * 0.62;
            // local frame: N = (0, ny, nz), T = (1, 0, 0), B = N × T
            const bx = Math.cos(lon) * rr, bb = Math.sin(lon) * rr;
            const px = cxp + bx, py = cyp + ny * hh + (-nz) * bb * side, pz = czp + nz * hh + ny * bb * side;
            const [u, v] = cellUV('eye', 0.5 + Math.cos(lon) * Math.sin(lat) * 0.5 / 1.0, 0.5 + Math.sin(lon) * Math.sin(lat) * 0.5);
            pos.push(px, py, pz); uv.push(u, 1 - v); sw.push(es, wave(es), 0);
          }
        }
        for (let a = 0; a < eyeN; a++) for (let c = 0; c < eyeN; c++) {
          const p0 = base + a * (eyeN + 1) + c, p1 = p0 + eyeN + 1;
          if (side > 0) idx.push(p0, p0 + 1, p1, p0 + 1, p1 + 1, p1); else idx.push(p0, p1, p0 + 1, p0 + 1, p1, p1 + 1);
        }
      }
    }
    const body = new THREE.BufferGeometry();
    body.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    body.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    body.setAttribute('aSwim', new THREE.Float32BufferAttribute(sw, 3));
    body.setIndex(idx);
    body.computeVertexNormals();
    // the doubled seam on the back ridge: one normal for both copies
    { const N = body.attributes.normal; for (let i = 0; i <= NS; i++) { const a = ringStart[i], b = a + NR; const x = (N.getX(a) + N.getX(b)) / 2, y = (N.getY(a) + N.getY(b)) / 2, z = 0; const l = Math.hypot(x, y, z) || 1; N.setXYZ(a, x / l, y / l, 0); N.setXYZ(b, x / l, y / l, 0); } }

    // ---- fins: double-sided membranes
    const fp = [], fu = [], fs = [], fi = [], fnor = [];
    const fpush = (x, y, z, u, v, s, w, fl, nx, ny, nz) => { fp.push(x, y, z); fu.push(u, 1 - v); fs.push(s, w, fl || 0); fnor.push(nx || 0, ny || 0, nz == null ? 1 : nz); return fp.length / 3 - 1; };
    const strip = (rows) => { // rows: [[baseIdx, tipIdx] …] in order
      for (let i = 0; i < rows.length - 1; i++) { const [a, b] = rows[i], [c, d] = rows[i + 1]; fi.push(a, c, b, b, c, d); }
    };
    const HF = {
      tri: (t) => lerp(1, 0.26, Math.pow(t, 0.8)) * Math.pow(smooth(0, 0.07, t), 0.5),
      round: (t) => Math.pow(Math.sin(PI * (0.07 + 0.86 * t)), 0.6) * (1 - 0.22 * t),
      sail: (t) => Math.pow(Math.sin(PI * (0.05 + 0.9 * t)), 0.42),
      low: (t) => Math.pow(Math.sin(PI * clamp(0.03 + 0.94 * t, 0, 1)), 0.3) * 0.92,
      long: (t) => lerp(1, 0.42, Math.pow(t, 0.6)) * Math.pow(smooth(0, 0.06, t), 0.5) * (1 - smooth(0.9, 1, t) * 0.55),
      spiny: (t, rays) => (0.7 + 0.3 * Math.abs(Math.sin(PI * (rays || 12) * t))) * Math.pow(Math.sin(PI * (0.04 + 0.92 * t)), 0.35),
    };
    /** a median fin on the back (dir 1) or on the belly (dir −1) */
    function median(name, f, dir) {
      if (!f) return;
      const hf = HF[f.shape] || HF.tri;
      const seg = f.shape === 'spiny' ? Math.max(16, (f.rays || 12) * 2) : (q === 'low' ? 6 : 12);
      const lean = f.shape === 'low' ? 0.2 : f.shape === 'spiny' ? 0.25 : 0.55;
      const rows = [];
      for (let i = 0; i <= seg; i++) {
        const t = i / seg, s = clamp(f.at + f.base * t, 0, 1);
        const b = bodyAt(P, depth, width, s);
        const y0 = dir > 0 ? b.top - (b.top - b.bot) * 0.03 : b.bot + (b.top - b.bot) * 0.03;
        const H = f.h * hf(t, f.rays);
        const [u0, v0] = cellUV(name, t, 0), [u1, v1] = cellUV(name, t, 1);
        const a = fpush(b.x, y0, 0, u0, v0, s, wave(s), 0);
        const c = fpush(b.x - lean * H, y0 + dir * H, 0, u1, v1, clamp(s + lean * H, 0, 1.3), wave(s) * 1.15, 0.4);
        rows.push([a, c]);
      }
      strip(rows);
    }
    median('dorsal', FN.dorsal, 1);
    median('dorsal2', FN.dorsal2, 1);
    median('anal', FN.anal, -1);
    if (FN.adipose) {
      const a = FN.adipose;
      if (a.low) median('adipose', { at: a.at, base: Math.min(a.size, 0.99 - a.at), h: 0.032, shape: 'low' }, 1);
      else median('adipose', { at: a.at, base: a.size * 1.1, h: a.size * 0.8, shape: 'round' }, 1);
    }
    // ---- the tail fin
    if (FN.tail) {
      const T = FN.tail, K = q === 'low' ? 8 : 16;
      const b = bodyAt(P, depth, width, 1);
      const lenF = {
        fork: (qq) => 1 - T.fork * 0.62 * (1 - Math.pow(Math.abs(qq), 1.3)),
        notch: (qq) => 1 - T.fork * 0.62 * (1 - Math.pow(Math.abs(qq), 1.3)),
        flat: () => 0.92,
        round: (qq) => 0.72 + 0.28 * Math.cos(qq * PI / 2),
        point: (qq) => 1 - 0.78 * Math.pow(Math.abs(qq), 1.15),
      }[T.shape] || (() => 1);
      const rows = [];
      for (let i = 0; i <= K; i++) {
        const qq = (i / K) * 2 - 1;
        const y0 = lerp(b.bot, b.top, (qq + 1) / 2) * 0.96;
        const L = T.len * lenF(qq);
        // the lobes of a forked tail end in soft points
        const yt = qq * (T.spread / 2) * (T.shape === 'fork' ? 1 - 0.1 * (1 - Math.abs(qq)) : 1);
        const [u0, v0] = cellUV('tail', (qq + 1) / 2, 0), [u1, v1] = cellUV('tail', (qq + 1) / 2, 1);
        const a = fpush(b.x + 0.012, y0, 0, u0, v0, 1, wave(1), 0);
        const c = fpush(b.x - L, yt, 0, u1, v1, 1 + L, wave(1) * (1 + L * 2.2), 0.3);
        rows.push([a, c]);
      }
      strip(rows);
    }
    // ---- paired fins (pectoral, pelvic): a leaf on each side
    function paired(name, f, kind) {
      if (!f) return;
      const K = q === 'low' ? 4 : 8;
      const b = bodyAt(P, depth, width, f.at);
      const yb = kind === 'pelvic' ? b.bot + (b.top - b.bot) * 0.04 : lerp(b.bot, b.top, f.low ? 0.24 : 0.42);
      for (const side of [1, -1]) {
        // D = along the fin, V = across it
        let D, V;
        if (kind === 'pelvic') { D = [-0.82, -0.5, side * 0.28]; V = [0.3, -0.1, side * 0.95]; }
        else if (f.fan) { D = [-0.5, -0.12, side * 0.86]; V = [0.62, 0.3, side * 0.42]; }
        else { D = [-0.78, -0.42, side * 0.46]; V = [0.25, -0.75, side * -0.2]; }
        const dl = Math.hypot(D[0], D[1], D[2]), vl = Math.hypot(V[0], V[1], V[2]);
        D = D.map((x) => x / dl); V = V.map((x) => x / vl);
        const nrm = [D[1] * V[2] - D[2] * V[1], D[2] * V[0] - D[0] * V[2], D[0] * V[1] - D[1] * V[0]];
        const zb = side * b.hw * (kind === 'pelvic' ? 0.35 : 0.86);
        const rows = [];
        for (let i = 0; i <= K; i++) {
          const a = (i / K) * 2 - 1;
          const L = f.len * Math.pow(Math.cos(a * 0.95), 0.7), wv = f.len * (f.fan ? 0.62 : 0.42) * Math.sin(a * 1.15);
          const bx = b.x + V[0] * 0.05 * f.len * a, by = yb + V[1] * 0.05 * f.len * a, bz = zb + V[2] * 0.05 * f.len * a;
          const [u0, v0] = cellUV(name, (a + 1) / 2, 0), [u1, v1] = cellUV(name, (a + 1) / 2, 1);
          const p0 = fpush(bx, by, bz, u0, v0, f.at, wave(f.at), 0, nrm[0], nrm[1], nrm[2]);
          const p1 = fpush(bx + D[0] * L + V[0] * wv, by + D[1] * L + V[1] * wv, bz + D[2] * L + V[2] * wv, u1, v1, f.at + L * 0.6, wave(f.at), 1, nrm[0], nrm[1], nrm[2]);
          rows.push([p0, p1]);
        }
        strip(rows);
      }
    }
    paired('pectoral', FN.pectoral, 'pectoral');
    paired('pelvic', FN.pelvic, 'pelvic');
    // ---- barbels: thin strips that hang from the corners of the mouth (they take their colour from the belly)
    if (P.barbels > 0 && q !== 'low') {
      const bl = P.barbelLen || 0.03;
      for (let k = 0; k < P.barbels; k++) {
        const s0 = 0.012 + k * 0.018;
        const b = bodyAt(P, depth, width, s0);
        // the first pair of a catfish is the long one and points forward and out
        const longOne = k === 0 && bl > 0.06;
        const L = bl * (longOne ? 1 : P.barbels > 2 ? 0.7 - k * 0.08 : 0.55);
        for (const side of [1, -1]) {
          const rows = [];
          const SEG = 5, wd = Math.max(0.0035, L * 0.05);
          for (let i = 0; i <= SEG; i++) {
            const t = i / SEG;
            const x = b.x + (longOne ? L * (0.45 * t - 0.75 * t * t) : -L * 0.35 * t);
            const y = lerp(b.bot, b.top, longOne ? 0.45 : 0.18) - L * (longOne ? 0.25 * t * t : 0.75 * t);
            const z = side * (b.hw * 0.7 + L * (longOne ? 0.85 * t : 0.3 * t));
            const w = wd * (1 - t * 0.85);
            const p0 = fpush(x, y + w, z, 0.035, 0.6, s0, 0, 1, 0, 0, side);
            const p1 = fpush(x, y - w, z, 0.035, 0.6, s0, 0, 1, 0, 0, side);
            rows.push([p0, p1]);
          }
          strip(rows);
        }
      }
    }
    const finsG = new THREE.BufferGeometry();
    finsG.setAttribute('position', new THREE.Float32BufferAttribute(fp, 3));
    finsG.setAttribute('normal', new THREE.Float32BufferAttribute(fnor, 3));
    // barbels sample the BODY part of the atlas (their uv was pushed raw): fix the v of body-region uvs
    for (let i = 0; i < fu.length; i += 2) if (fu[i] === 0.035) fu[i + 1] = 1 - 0.6 * BODY_V;
    finsG.setAttribute('uv', new THREE.Float32BufferAttribute(fu, 2));
    finsG.setAttribute('aSwim', new THREE.Float32BufferAttribute(fs, 3));
    finsG.setIndex(fi);
    return { body, fins: finsG, tris: (idx.length + fi.length) / 3 };
  }

  // ---------------------------------------------------------------- the skin (a 2D drawing)
  const hexRgb = (h) => { const n = parseInt(col(h).slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  const rgba = (h, a) => { const [r, g, b] = hexRgb(h); return `rgba(${r},${g},${b},${clamp(a == null ? 1 : a, 0, 1)})`; };
  const mixHex = (a, b, t) => { const A = hexRgb(a), B = hexRgb(b); return `rgb(${Math.round(lerp(A[0], B[0], t))},${Math.round(lerp(A[1], B[1], t))},${Math.round(lerp(A[2], B[2], t))})`; };
  /** the look of a month: the breeding colours and marks join in its months */
  function seasonLook(look, month) {
    const B = look.breeding;
    if (!B || !Array.isArray(B.months) || !B.months.includes(Number(month))) return { colours: look.colours, marks: look.marks, breeding: false };
    return { colours: Object.assign({}, look.colours, B.colours || {}), marks: look.marks.concat(B.marks || []), breeding: true };
  }
  /** paint the atlas of a species on ctx (w × h) */
  function paintSkin(ctx, w, h, sp, month) {
    const look = sp.look, P = look.profile;
    const { colours: C, marks } = seasonLook(look, month);
    const bh = Math.round(h * BODY_V);
    const rnd = G.util.rng(sp.id.length * 131 + sp.id.charCodeAt(0) * 17 + sp.id.charCodeAt(sp.id.length - 1));
    const depth = sampler(P.depth);
    const maxD = Math.max.apply(null, P.depth.map((p) => p[1]));
    // ---- 1. countershading: back → side → belly
    const g = ctx.createLinearGradient(0, 0, 0, bh);
    g.addColorStop(0, col(C.back)); g.addColorStop(0.2, col(C.back));
    g.addColorStop(0.42, mixHex(C.back, C.side, 0.75)); g.addColorStop(0.56, col(C.side));
    g.addColorStop(0.78, mixHex(C.side, C.belly, 0.75)); g.addColorStop(1, col(C.belly));
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, bh);
    // the head is a little darker on top, the snout tip too
    { const hg = ctx.createLinearGradient(0, 0, w * P.head, 0); hg.addColorStop(0, rgba(C.back, 0.35)); hg.addColorStop(1, rgba(C.back, 0)); ctx.fillStyle = hg; ctx.fillRect(0, 0, w * P.head, bh * 0.6); }
    // ---- 2. scales: overlapping arcs (none on a scaleless skin, which gets a soft sheen of fine speckles instead)
    const U = (u) => u * w, V = (v) => v * bh;
    if (look.scales !== 'none') {
      const sz = (look.scales === 'large' ? 0.034 : look.scales === 'medium' ? 0.024 : 0.015) * w * (0.2 / Math.max(0.16, maxD)) * 0.8;
      ctx.lineWidth = Math.max(0.6, sz * 0.09);
      for (let row = 0, y = 0; y < bh + sz; y += sz * 0.56, row++) {
        for (let x = P.head * w * 0.92 + (row % 2 ? sz / 2 : 0); x < w + sz; x += sz) {
          ctx.strokeStyle = 'rgba(20,18,10,0.16)';
          ctx.beginPath(); ctx.arc(x, y, sz * 0.52, -PI * 0.42, PI * 0.42); ctx.stroke();
          ctx.strokeStyle = 'rgba(255,255,255,0.10)';
          ctx.beginPath(); ctx.arc(x - sz * 0.1, y, sz * 0.5, -PI * 0.32, PI * 0.32); ctx.stroke();
        }
      }
    } else {
      for (let i = 0; i < 900; i++) { ctx.fillStyle = rnd() < 0.5 ? 'rgba(255,255,255,0.035)' : 'rgba(0,0,0,0.05)'; ctx.fillRect(rnd() * w, rnd() * bh, 1 + rnd() * 2, 1 + rnd() * 2); }
    }
    // ---- 3. the marks, in the order of the data
    const blob = (x, y, rx, ry, c, a, soft) => {
      ctx.save(); ctx.translate(x, y); ctx.scale(1, ry / rx);
      const gr = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
      gr.addColorStop(0, rgba(c, a)); gr.addColorStop(soft == null ? 0.62 : soft, rgba(c, a * 0.9)); gr.addColorStop(1, rgba(c, 0));
      ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(0, 0, rx, 0, TAU); ctx.fill(); ctx.restore();
    };
    for (const m of marks) {
      const r = G.util.rng((m.seed || 1) * 7919 + sp.id.length);
      const c = col(m.c, '#222222'), a = m.a == null ? 0.8 : m.a;
      if (m.t === 'band') {
        // a lengthwise band; `grow` > 0 lets it fade in towards the tail
        const u0 = m.u0 == null ? 0 : m.u0, u1 = m.u1 == null ? 1 : m.u1, hw = (m.w || 0.08) * bh / 2;
        const steps = 48;
        for (let i = 0; i < steps; i++) {
          const ua = lerp(u0, u1, i / steps), ub = lerp(u0, u1, (i + 1) / steps);
          const al = a * (m.grow ? lerp(1 - m.grow, 1, i / steps) : 1) * Math.min(1, i / 2.5, (steps - i) / 1.5);
          const gy = ctx.createLinearGradient(0, V(m.v) - hw, 0, V(m.v) + hw);
          gy.addColorStop(0, rgba(c, 0)); gy.addColorStop(0.3, rgba(c, al)); gy.addColorStop(0.7, rgba(c, al)); gy.addColorStop(1, rgba(c, 0));
          ctx.fillStyle = gy; ctx.fillRect(U(ua) - 0.5, V(m.v) - hw, U(ub) - U(ua) + 1, hw * 2);
        }
      } else if (m.t === 'bars') {
        for (let i = 0; i < m.n; i++) {
          const u = lerp(m.u0, m.u1, (i + 0.5) / m.n) + (r() - 0.5) * (m.jitter || 0) * (m.u1 - m.u0) / m.n;
          const ww = (m.w || 0.03) * w * (0.8 + r() * 0.4), y0 = V(m.v0), y1 = V(m.v1);
          const sl = (m.slant || 0) * (y1 - y0);
          const gx = ctx.createLinearGradient(U(u) - ww / 2, 0, U(u) + ww / 2, 0);
          gx.addColorStop(0, rgba(c, 0)); gx.addColorStop(0.35, rgba(c, a)); gx.addColorStop(0.65, rgba(c, a)); gx.addColorStop(1, rgba(c, 0));
          ctx.save(); ctx.transform(1, 0, sl / Math.max(1, y1 - y0), 1, 0, 0);
          ctx.fillStyle = gx; ctx.beginPath();
          // a bar tapers to its ends
          ctx.ellipse(U(u) - sl * 0.5 * 0, (y0 + y1) / 2, ww / 2, (y1 - y0) / 2, 0, 0, TAU); ctx.fill(); ctx.restore();
        }
      } else if (m.t === 'parr') {
        for (let i = 0; i < m.n; i++) { const u = lerp(m.u0, m.u1, (i + 0.5) / m.n); blob(U(u), V(m.v), (m.rx || 0.025) * w, (m.ry || 0.15) * bh, c, a, 0.7); }
      } else if (m.t === 'spots') {
        for (let i = 0; i < m.n; i++) {
          const u = lerp(m.u0, m.u1, r()), v = lerp(m.v0, m.v1, Math.pow(r(), 1.2)), rr = lerp(m.r0, m.r1, r()) * w;
          blob(U(u), V(v), rr, rr * (0.8 + r() * 0.4), c, a, 0.55);
        }
      } else if (m.t === 'rows') {
        // dotted rows that follow the body: fewer rows fit where the body is slender
        for (let k = 0; k < m.rows; k++) {
          const v = lerp(m.v0, m.v1, m.rows > 1 ? k / (m.rows - 1) : 0.5);
          for (let i = 0; i < m.n; i++) {
            const u = lerp(m.u0, m.u1, (i + (k % 2 ? 0.5 : 0)) / m.n);
            const slim = depth(u) / maxD;
            const vv = 0.5 + (v - 0.5) * (0.55 + 0.45 * slim);
            const rr = (m.r || 0.007) * w * (0.75 + 0.25 * slim);
            blob(U(u), V(vv), rr, rr, c, a, 0.6);
          }
        }
      } else if (m.t === 'saddles') {
        for (let i = 0; i < m.n; i++) {
          const u = lerp(m.u0, m.u1, (i + 0.5) / m.n), ww = (m.w || 0.05) * w * (0.8 + r() * 0.4), dd = (m.depth || 0.3) * bh * (0.8 + r() * 0.35);
          const gy = ctx.createLinearGradient(0, 0, 0, dd);
          gy.addColorStop(0, rgba(c, a)); gy.addColorStop(0.6, rgba(c, a * 0.85)); gy.addColorStop(1, rgba(c, 0));
          ctx.fillStyle = gy; ctx.beginPath(); ctx.ellipse(U(u), 0, ww / 2, dd, 0, 0, PI); ctx.fill();
        }
      } else if (m.t === 'mottle') {
        for (let i = 0; i < m.n; i++) {
          const u = lerp(m.u0, m.u1, r()), v = lerp(m.v0, m.v1, r()), rr = lerp(m.r0, m.r1, r()) * w;
          blob(U(u), V(v), rr * (0.7 + r() * 0.8), rr * (0.5 + r() * 0.7), c, a * (0.6 + r() * 0.4), 0.4);
        }
      } else if (m.t === 'blotch') {
        if (m.ring) blob(U(m.u), V(m.v), (m.rx || 0.02) * w * 1.6, (m.ry || 0.05) * bh * 1.6, col(m.ring), 0.9, 0.75);
        blob(U(m.u), V(m.v), (m.rx || 0.02) * w, (m.ry || 0.05) * bh, c, a, 0.7);
      }
    }
    // ---- 4. the lateral line, the gill cover, the mouth, the nostril
    ctx.strokeStyle = 'rgba(30,26,16,0.22)'; ctx.lineWidth = Math.max(1, w / 700); ctx.setLineDash([w / 180, w / 260]);
    ctx.beginPath(); ctx.moveTo(U(P.head), V(0.46)); ctx.quadraticCurveTo(U(0.55), V(0.53), U(1), V(0.5)); ctx.stroke(); ctx.setLineDash([]);
    if (P.kind === 'lamprey') {
      // seven gill pores in a row behind the eye, a round sucker instead of jaws
      for (let i = 0; i < (P.gills || 7); i++) { const u = P.eye[0] + 0.022 + i * 0.016; blob(U(u), V(0.56), w * 0.0042, w * 0.0042, '#1a1814', 0.95, 0.7); }
      blob(U(0.006), V(0.62), w * 0.02, bh * 0.2, '#3a2a22', 0.8, 0.6);
    } else {
      ctx.strokeStyle = 'rgba(20,16,10,0.42)'; ctx.lineWidth = Math.max(1.2, w / 420);
      ctx.beginPath(); ctx.moveTo(U(P.head * 0.86), V(0.12)); ctx.quadraticCurveTo(U(P.head * 1.12), V(0.5), U(P.head * 0.8), V(0.9)); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.14)';
      ctx.beginPath(); ctx.moveTo(U(P.head * 0.86) + 2, V(0.12)); ctx.quadraticCurveTo(U(P.head * 1.12) + 2, V(0.5), U(P.head * 0.8) + 2, V(0.9)); ctx.stroke();
      // the mouth line: at the tip, under the snout, or turned up
      const my = { end: 0.56, under: 0.68, low: 0.82, up: 0.44, sucker: 0.6 }[P.mouth] || 0.56;
      const ml = 0.02 + 0.07 * (P.gape || 0.4);
      ctx.strokeStyle = 'rgba(25,14,10,0.62)'; ctx.lineWidth = Math.max(1.4, w / 360);
      ctx.beginPath(); ctx.moveTo(U(0), V(my)); ctx.quadraticCurveTo(U(ml * 0.6), V(my + (P.mouth === 'up' ? -0.02 : 0.03)), U(ml), V(my + (P.mouth === 'up' ? 0.07 : 0.06))); ctx.stroke();
      if (P.lips > 0.3) { ctx.strokeStyle = rgba(C.belly, 0.5 * P.lips); ctx.lineWidth = Math.max(2, w / 200) * P.lips; ctx.beginPath(); ctx.moveTo(U(0.002), V(my - 0.05)); ctx.lineTo(U(ml * 0.8), V(my - 0.03)); ctx.stroke(); }
      blob(U(P.eye[0] * 0.52), V(Math.max(0.12, 1 - P.eye[1] - 0.02)), w * 0.0035, w * 0.0035, '#15120c', 0.7, 0.6);
    }
    // a soft socket shade round the eye
    blob(U(P.eye[0]), V(clamp(1 - P.eye[1], 0.05, 0.95)), P.eye[2] * w * 0.85, P.eye[2] * w * 0.85 * (bh / w) / Math.max(0.08, maxD) * 0.2 + P.eye[2] * w * 0.5, '#15120c', 0.22, 0.4);
    // ---- 5. the fin cells
    const FN = look.fins || {};
    const finMarks = marks.filter((m) => m.t === 'fin');
    for (const name of CELLS) {
      const r = cellRect(name), x0 = r.u0 * w, y0 = r.v0 * h, cw = (r.u1 - r.u0) * w, ch = (r.v1 - r.v0) * h;
      ctx.save(); ctx.beginPath(); ctx.rect(x0, y0, cw, ch); ctx.clip();
      ctx.clearRect(x0, y0, cw, ch);
      if (name === 'eye') {
        // the iris with its dark pupil and a small highlight; the rim is dark
        const cx = x0 + cw / 2, cy = y0 + ch / 2, R = Math.min(cw, ch) / 2;
        ctx.fillStyle = '#0d0c0a'; ctx.fillRect(x0, y0, cw, ch);
        const ig = ctx.createRadialGradient(cx, cy, R * 0.2, cx, cy, R * 0.86);
        ig.addColorStop(0, mixHex(C.eye, '#ffffff', 0.25)); ig.addColorStop(0.75, col(C.eye)); ig.addColorStop(1, mixHex(C.eye, '#000000', 0.6));
        ctx.fillStyle = ig; ctx.beginPath(); ctx.arc(cx, cy, R * 0.86, 0, TAU); ctx.fill();
        ctx.fillStyle = '#050505'; ctx.beginPath();
        if (C.pupil === 'slit') ctx.ellipse(cx, cy, R * 0.16, R * 0.5, 0, 0, TAU); else ctx.arc(cx, cy, R * 0.44, 0, TAU);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.beginPath(); ctx.arc(cx - R * 0.2, cy - R * 0.24, R * 0.11, 0, TAU); ctx.fill();
        ctx.restore(); continue;
      }
      const f = name === 'adipose' ? FN.adipose : FN[name];
      if (!f) { ctx.restore(); continue; }
      const tint = finMarks.find((m) => m.fin === name && m.kind === 'tint');
      const base = tint ? mixHex(C.fin, tint.c, tint.a) : col(C.fin);
      // the membrane: more solid at the base, clear towards the edge (the cell's bottom = the fin's base)
      const mg = ctx.createLinearGradient(0, y0 + ch, 0, y0);
      const [br, bg, bb] = base[0] === '#' ? hexRgb(base) : base.match(/\d+/g).slice(0, 3).map(Number);
      mg.addColorStop(0, `rgba(${br},${bg},${bb},0.96)`); mg.addColorStop(0.45, `rgba(${br},${bg},${bb},0.8)`); mg.addColorStop(1, `rgba(${br},${bg},${bb},0.56)`);
      ctx.fillStyle = mg; ctx.fillRect(x0, y0, cw, ch);
      if (name === 'adipose') { ctx.fillStyle = rgba(C.back, 0.5); ctx.fillRect(x0, y0, cw, ch); }
      // rays
      const rays = name === 'tail' ? 18 : name === 'pectoral' ? 13 : name === 'pelvic' ? 8 : name === 'adipose' ? 0 : Math.max(5, Math.min(40, f.rays || 9));
      ctx.lineWidth = Math.max(0.8, cw / 90);
      for (let i = 0; i <= rays; i++) {
        const x = x0 + (i / Math.max(1, rays)) * cw;
        ctx.strokeStyle = 'rgba(25,20,12,0.28)'; ctx.beginPath(); ctx.moveTo(x, y0 + ch); ctx.lineTo(x, y0); ctx.stroke();
        ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.beginPath(); ctx.moveTo(x + ctx.lineWidth, y0 + ch); ctx.lineTo(x + ctx.lineWidth, y0); ctx.stroke();
      }
      for (const m of finMarks.filter((mm) => mm.fin === name)) {
        const c = col(m.c, '#222222'), a = m.a == null ? 0.7 : m.a;
        if (m.kind === 'bands') { for (let k = 0; k < m.n; k++) { const yy = y0 + ch * (1 - (k + 0.7) / (m.n + 0.6)); ctx.fillStyle = rgba(c, a); ctx.fillRect(x0, yy - ch * 0.045, cw, ch * 0.09); } }
        else if (m.kind === 'band') { ctx.fillStyle = rgba(c, a); ctx.fillRect(x0, y0 + ch * 0.3, cw, ch * 0.26); }
        else if (m.kind === 'edge') { const eg = ctx.createLinearGradient(0, y0, 0, y0 + ch * 0.2); eg.addColorStop(0, rgba(c, a)); eg.addColorStop(1, rgba(c, 0)); ctx.fillStyle = eg; ctx.fillRect(x0, y0, cw, ch * 0.2); }
        else if (m.kind === 'base') { blob(x0 + cw * 0.12, y0 + ch * 0.96, cw * 0.14, ch * 0.2, c, a, 0.6); }
        else if (m.kind === 'spots') { const rr = G.util.rng(m.n * 31 + name.length); for (let k = 0; k < m.n; k++) blob(x0 + rr() * cw, y0 + ch * (0.12 + rr() * 0.8), cw * 0.035, cw * 0.035, c, a, 0.6); }
      }
      ctx.restore();
    }
    stats.skins++;
  }
  function skin(id, opts) {
    const sp = FD()?.byId?.[id];
    const o = opts || {};
    const c = document.createElement('canvas');
    c.width = o.w || 512; c.height = o.h || 256;
    const ctx = c.getContext('2d', { willReadFrequently: !!o.read });
    if (!ctx || !sp) return null;
    paintSkin(ctx, c.width, c.height, sp, o.month);
    return c;
  }

  // ---------------------------------------------------------------- materials
  const SWIM_PARS = 'attribute vec3 aSwim;\nuniform vec3 uSwim;\n';
  // the wave travels from the head to the tail: sideways (z), growing towards the tail; fins flutter a little
  const SWIM_MAIN = 'transformed.z += sin(uSwim.x - aSwim.x * uSwim.y) * uSwim.z * aSwim.y;\ntransformed.y += sin(uSwim.x * 1.7 + aSwim.x * 9.0) * uSwim.z * 0.22 * aSwim.z;\n';
  function swimPatch(mat, uniforms) {
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uSwim = uniforms.uSwim;
      sh.vertexShader = SWIM_PARS + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n' + SWIM_MAIN);
    };
    mat.customProgramCacheKey = () => 'fishkit-swim';
    return mat;
  }
  /** vertex colours from a small drawing of the same skin (the low preset: no texture map) */
  function bakeColours(geo, small, sctx) {
    const uv = geo.attributes.uv, n = uv.count;
    const data = sctx.getImageData(0, 0, small.width, small.height).data;
    const out = new Float32Array(n * 3);
    const c = new THREE.Color();
    for (let i = 0; i < n; i++) {
      const x = clamp(Math.floor(uv.getX(i) * small.width), 0, small.width - 1), y = clamp(Math.floor((1 - uv.getY(i)) * small.height), 0, small.height - 1);
      const k = (y * small.width + x) * 4;
      c.setRGB(data[k] / 255, data[k + 1] / 255, data[k + 2] / 255, THREE.SRGBColorSpace);
      out[i * 3] = c.r; out[i * 3 + 1] = c.g; out[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(out, 3));
  }
  const geoCache = new Map();   // id|quality → { body, fins, tris }
  function geometryOf(sp, q) {
    const k = sp.id + '|' + q;
    let g = geoCache.get(k);
    if (!g) { g = buildGeometry(sp.look, q); geoCache.set(k, g); }
    return g;
  }
  /** the 3D fish of a species (see the header) */
  function build(id, opts) {
    const sp = FD()?.byId?.[id];
    if (!sp) return null;
    const o = opts || {};
    const q = o.quality || quality();
    const month = o.month || 0;
    const uniforms = { uSwim: { value: new THREE.Vector3(0, 7.5, o.swim === false ? 0 : 0.03) } };
    const group = new THREE.Group();
    group.name = 'fish:' + id;
    const g = geometryOf(sp, q);
    const owned = [];
    const gloss = sp.look.colours.gloss == null ? 0.8 : sp.look.colours.gloss;
    if (q === 'low') {
      // one mesh, flat colours from the drawing
      const small = skin(id, { w: 128, h: 64, month, read: true });
      const merged = ADDONS.BufferGeometryUtils.mergeGeometries([g.body.clone(), g.fins.clone()], false);
      if (small) bakeColours(merged, small, small.getContext('2d'));
      const mat = swimPatch(new THREE.MeshLambertMaterial({ vertexColors: !!small, side: THREE.DoubleSide, color: small ? 0xffffff : new THREE.Color(col(sp.look.colours.side)) }), uniforms);
      const mesh = new THREE.Mesh(merged, mat);
      mesh.name = 'fish-body';
      group.add(mesh); owned.push(merged, mat);
    } else {
      const hi = q === 'high';
      const cv = skin(id, { w: hi ? 1024 : 512, h: hi ? 512 : 256, month });
      const map = new THREE.CanvasTexture(cv);
      map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = hi ? 4 : 2; map.generateMipmaps = true; map.needsUpdate = true;
      const sheen = new THREE.Color(col(sp.look.colours.sheen, '#ffffff'));
      const bodyMat = swimPatch(hi
        ? new THREE.MeshPhysicalMaterial({ map, roughness: 0.46 - gloss * 0.14, metalness: 0.0, clearcoat: 0.45 + gloss * 0.5, clearcoatRoughness: 0.2, iridescence: 0.18 + gloss * 0.3, iridescenceIOR: 1.32, iridescenceThicknessRange: [180, 420], sheen: 0.35, sheenColor: sheen, sheenRoughness: 0.5, envMapIntensity: 0.9 })
        : new THREE.MeshStandardMaterial({ map, roughness: 0.4 - gloss * 0.12, metalness: 0.08, envMapIntensity: 1.0 }), uniforms);
      const finMat = swimPatch(new THREE.MeshStandardMaterial({ map, transparent: true, alphaTest: 0.04, side: THREE.DoubleSide, depthWrite: false, roughness: 0.5, metalness: 0, envMapIntensity: 0.5 }), uniforms);
      const body = new THREE.Mesh(g.body, bodyMat); body.name = 'fish-body';
      const fins = new THREE.Mesh(g.fins, finMat); fins.name = 'fish-fins'; fins.renderOrder = 2;
      group.add(body, fins);
      owned.push(map, bodyMat, finMat);
    }
    const L = Number(o.length) > 0 ? Number(o.length) : 1;
    group.scale.setScalar(L);
    group.traverse((m) => { if (m.isMesh) { m.castShadow = false; m.receiveShadow = false; m.frustumCulled = false; } });
    group.userData.fish = {
      id, length: L, uniforms, tris: g.tris,
      dispose() { for (const x of owned) { try { x.dispose?.(); } catch (e) { /* already gone */ } } group.parent?.remove(group); },
    };
    stats.built++;
    return group;
  }

  // ---------------------------------------------------------------- cheap shapes for the schools
  const KIND = { fusi: { deep: 0.2, wide: 0.13, at: 0.36, head: 1 }, deep: { deep: 0.36, wide: 0.13, at: 0.38, head: 1 }, long: { deep: 0.11, wide: 0.1, at: 0.3, head: 1 }, flat: { deep: 0.17, wide: 0.24, at: 0.2, head: 1.6 } };
  const silCache = new Map();
  /** a low-poly fish seen mostly from above: a lofted body (6 × 8), a tail blade and two pectoral blades. +X = forward. */
  function silhouette(kind) {
    if (silCache.has(kind)) return silCache.get(kind);
    const K = KIND[kind] || KIND.fusi;
    const pos = [], idx = [], sw = [];
    const NS = 8, NR = 6;
    for (let i = 0; i <= NS; i++) {
      const s = i / NS;
      const f = s <= K.at ? Math.sin(Math.pow(s / K.at, 0.7) * PI / 2) : Math.cos(Math.pow((s - K.at) / (1 - K.at), 1.15) * PI / 2) * 0.82 + 0.18;
      const d = Math.max(0.012, K.deep * f), w = Math.max(0.01, K.wide * (s <= K.at ? Math.sin(Math.pow(s / K.at, 0.6) * PI / 2) : Math.pow(Math.cos((s - K.at) / (1 - K.at) * PI / 2), 0.8) * 0.9 + 0.1));
      for (let j = 0; j < NR; j++) { const th = (j / NR) * TAU; pos.push(0.5 - s, Math.cos(th) * d / 2, Math.sin(th) * w / 2); sw.push(s, Math.pow(smooth(0.2, 1, s), 1.4), 0); }
    }
    for (let i = 0; i < NS; i++) for (let j = 0; j < NR; j++) { const a = i * NR + j, b = (i + 1) * NR + j, a1 = i * NR + (j + 1) % NR, b1 = (i + 1) * NR + (j + 1) % NR; idx.push(a, b, a1, a1, b, b1); }
    // tail blade (vertical) and pectoral blades (flat, seen from above)
    const v = (x, y, z, s, w) => { pos.push(x, y, z); sw.push(s, w, 0); return pos.length / 3 - 1; };
    const t0 = v(-0.5, 0, 0, 1, 1), t1 = v(-0.72, K.deep * 0.75, 0, 1.2, 1.5), t2 = v(-0.72, -K.deep * 0.75, 0, 1.2, 1.5), t3 = v(-0.62, 0, 0, 1.12, 1.3);
    idx.push(t0, t1, t3, t0, t3, t2, t0, t3, t1, t0, t2, t3);
    for (const sd of [1, -1]) { const p0 = v(0.22, -K.deep * 0.2, sd * K.wide * 0.4, 0.28, 0.1), p1 = v(0.06, -K.deep * 0.3, sd * (K.wide * 0.5 + 0.12 * K.head), 0.44, 0.3), p2 = v(0.14, -K.deep * 0.25, sd * K.wide * 0.42, 0.36, 0.1); idx.push(p0, p1, p2, p0, p2, p1); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('aSwim', new THREE.Float32BufferAttribute(sw, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    silCache.set(kind, g);
    return g;
  }
  /** which cheap shape a species has in a school */
  function kindOf(id) {
    const sp = FD()?.byId?.[id];
    if (!sp) return 'fusi';
    const P = sp.look.profile;
    const maxD = Math.max.apply(null, P.depth.map((p) => p[1]));
    if (P.kind === 'lamprey' || maxD < 0.16) return 'long';
    if ((P.flatHead || 0) >= 0.5 || (P.arch || 0) >= 0.4) return 'flat';
    if (maxD >= 0.3) return 'deep';
    return 'fusi';
  }

  // ---------------------------------------------------------------- the studio
  const studio = {
    scene: null, camera: null, holder: null, jobs: [], live: null, off: null, cache: new Map(), _t: 0,
    _ensure() {
      if (this.scene) return true;
      const eng = G.sys.engine;
      if (!eng?.renderer || typeof eng.onPreRender !== 'function') return false;
      const sc = new THREE.Scene();
      // a calm water-coloured backdrop (vertex colours: works on every preset) far behind the fish
      const bg = new THREE.PlaneGeometry(8, 5, 1, 4);
      const cols = [];
      const top = new THREE.Color('#cfe6ea'), mid = new THREE.Color('#8fbfc6'), bot = new THREE.Color('#3f7f8a');
      for (let i = 0; i < bg.attributes.position.count; i++) { const y = bg.attributes.position.getY(i) / 5 + 0.5; const c = y > 0.5 ? mid.clone().lerp(top, (y - 0.5) * 2) : bot.clone().lerp(mid, y * 2); cols.push(c.r, c.g, c.b); }
      bg.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
      const back = new THREE.Mesh(bg, new THREE.MeshBasicMaterial({ vertexColors: true, depthWrite: false, fog: false, toneMapped: false }));
      back.position.set(0, 0, -2.2); back.renderOrder = -10;
      sc.add(back);
      sc.add(new THREE.HemisphereLight(0xf2fbff, 0x54707a, 1.25));
      const key = new THREE.DirectionalLight(0xfff4e0, 2.3); key.position.set(-1.2, 2.2, 2.4); sc.add(key);
      const rim = new THREE.DirectionalLight(0xbfe8ff, 1.0); rim.position.set(1.5, 0.8, -2); sc.add(rim);
      const fill = new THREE.DirectionalLight(0xffffff, 0.5); fill.position.set(0.5, -1.5, 1.5); sc.add(fill);
      this.holder = new THREE.Group(); sc.add(this.holder);
      this.camera = new THREE.PerspectiveCamera(24, 1.6, 0.05, 20);
      this.scene = sc;
      this.off = eng.onPreRender((a) => this._frame(a));
      return true;
    },
    /** frame the fish in the camera: the whole body with its fins, for the given aspect */
    _place(fishObj, aspect, yaw, t) {
      const sp = FD().byId[fishObj.userData.fish.id], FN = sp.look.fins;
      const len = 1 + (FN.tail ? FN.tail.len : 0);
      const maxD = Math.max.apply(null, sp.look.profile.depth.map((p) => p[1])) + (FN.dorsal ? FN.dorsal.h : 0) + (FN.anal ? FN.anal.h : 0);
      const cam = this.camera;
      cam.aspect = aspect;
      const vf = cam.fov * PI / 180, hf = 2 * Math.atan(Math.tan(vf / 2) * aspect);
      const dist = Math.max((len * 1.12) / (2 * Math.tan(hf / 2)), (Math.max(maxD, 0.3) * 1.5) / (2 * Math.tan(vf / 2)));
      // pictures of fish show the head on the left: the holder is turned half round, the tail then points to +X
      this.holder.rotation.set(0, PI, 0);
      cam.position.set((FN.tail ? FN.tail.len : 0) / 2, 0.03, dist); cam.lookAt((FN.tail ? FN.tail.len : 0) / 2, 0, 0); cam.updateProjectionMatrix(); cam.updateMatrixWorld();
      fishObj.rotation.set(0.05 * Math.sin(t * 0.7), yaw, 0.03 * Math.sin(t * 0.9));
    },
    /** draw the scene into the bottom-left corner of the main canvas and copy it into ctx2d */
    _draw(a, fishObj, c2d, yaw, t) {
      const r = a.renderer, gl = r.domElement;
      const pr = r.getPixelRatio();
      const ss = 2;   // 2× supersampling, smoothed by the copy
      let pw = Math.min(gl.width, c2d.width * ss), ph = Math.min(gl.height, c2d.height * ss);
      if (pw < 8 || ph < 8) return false;
      if (pw / ph > c2d.width / c2d.height) pw = Math.round(ph * c2d.width / c2d.height); else ph = Math.round(pw * c2d.height / c2d.width);
      this.holder.clear(); this.holder.add(fishObj);
      this._place(fishObj, pw / ph, yaw, t);
      this.scene.environment = a.scene?.environment || null;
      const ov = r.getViewport(new THREE.Vector4()), os = r.getScissor(new THREE.Vector4()), ost = r.getScissorTest(), oac = r.autoClear, oexp = r.toneMappingExposure, ort = r.getRenderTarget();
      try {
        r.setRenderTarget(null);
        r.setViewport(0, 0, pw / pr, ph / pr); r.setScissor(0, 0, pw / pr, ph / pr); r.setScissorTest(true);
        r.autoClear = true; r.toneMappingExposure = 1.0;
        r.render(this.scene, this.camera);
        const ctx = c2d.getContext('2d');
        ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(gl, 0, gl.height - ph, pw, ph, 0, 0, c2d.width, c2d.height);
      } finally {
        r.setViewport(ov); r.setScissor(os); r.setScissorTest(ost); r.autoClear = oac; r.toneMappingExposure = oexp; r.setRenderTarget(ort);
        this.holder.clear();
      }
      stats.frames++;
      return true;
    },
    _frame(a) {
      const t = (this._t += G.time?.delta || 0.016);
      // stills first (one a frame), then the live canvas
      const job = this.jobs.shift();
      if (job) {
        let ok = false;
        try {
          const f = build(job.id, { month: job.month, swim: false });
          if (f) { ok = this._draw(a, f, job.canvas, job.yaw, 0); f.userData.fish.dispose(); }
        } catch (e) { G.log.warn('FISH', 'studio still failed', e?.message || e); }
        job.done(ok);
      }
      const L = this.live;
      if (L && L.canvas.isConnected) {
        try {
          L.fish.userData.fish.uniforms.uSwim.value.x = t * 5.2;
          const yaw = L.turn ? L.yaw + 0.62 * Math.sin(t * 0.55) : L.yaw;
          this._draw(a, L.fish, L.canvas, yaw, t);
        } catch (e) { if (!L.warned) { L.warned = true; G.log.warn('FISH', 'studio live view failed', e?.message || e); } }
      } else if (L) this._stopLive();
    },
    _stopLive() { const L = this.live; this.live = null; try { L?.fish?.userData?.fish?.dispose?.(); } catch (e) { /* gone */ } },
    show(canvas, id, opts) {
      if (!canvas || !this._ensure()) return { stop() {} };
      this._stopLive();
      const o = opts || {};
      const fish = build(id, { month: o.month });
      if (!fish) return { stop() {} };
      const L = { canvas, fish, turn: o.turn !== false, yaw: o.yaw == null ? 0.25 : o.yaw };
      this.live = L;
      return { stop: () => { if (this.live === L) this._stopLive(); } };
    },
    thumb(id, opts) {
      const o = opts || {};
      const w = o.w || 320, h = o.h || 200, month = o.month || 0, yaw = o.yaw == null ? 0.18 : o.yaw;
      const key = `${id}|${w}x${h}|${month}|${yaw}|${quality()}`;
      if (this.cache.has(key)) return Promise.resolve(this.cache.get(key));
      if (!FD()?.byId?.[id] || !this._ensure()) return Promise.resolve('');
      return new Promise((resolve) => {
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const timer = setTimeout(() => { const i = this.jobs.findIndex((j) => j.canvas === canvas); if (i >= 0) this.jobs.splice(i, 1); resolve(''); }, 20000);
        this.jobs.push({ id, month, yaw, canvas, done: (ok) => {
          clearTimeout(timer);
          let url = '';
          if (ok) { try { url = canvas.toDataURL('image/webp', 0.9); if (!/^data:image\/webp/.test(url)) url = canvas.toDataURL('image/png'); } catch (e) { url = ''; } }
          canvas.width = canvas.height = 1;
          if (url) { this.cache.set(key, url); stats.thumbs++; }
          resolve(url);
        } });
      });
    },
    async sheet(opts) {
      const o = opts || {};
      const ids = (o.ids || FD().ids).filter((id) => FD().byId[id]);
      const cols = o.cols || 6, cw = o.cellW || 300, chh = o.cellH || 190, lab = o.labels === false ? 0 : 34;
      const rows = Math.ceil(ids.length / cols);
      const out = document.createElement('canvas');
      out.width = cols * cw; out.height = rows * (chh + lab);
      const ctx = out.getContext('2d');
      ctx.fillStyle = '#12303a'; ctx.fillRect(0, 0, out.width, out.height);
      for (let i = 0; i < ids.length; i++) {
        const url = await this.thumb(ids[i], { w: cw - 8, h: chh - 8, month: o.month, yaw: o.yaw == null ? 0.0 : o.yaw });
        const x = (i % cols) * cw, y = Math.floor(i / cols) * (chh + lab);
        if (url) { const img = new Image(); await new Promise((res) => { img.onload = res; img.onerror = res; img.src = url; }); try { ctx.drawImage(img, x + 4, y + 4, cw - 8, chh - 8); } catch (e) { /* skip */ } }
        if (lab) {
          const sp = FD().byId[ids[i]];
          ctx.fillStyle = sp.protected ? '#ffd27a' : '#f2f6f4'; ctx.font = '600 17px sans-serif'; ctx.textBaseline = 'middle';
          ctx.fillText(`${sp.name}${sp.protected ? ' 🛟' : ''}`, x + 8, y + chh + 11);
          ctx.fillStyle = '#9fc4c8'; ctx.font = 'italic 12px sans-serif';
          ctx.fillText(`${sp.sci} · ${sp.size.usual[0]}–${sp.size.usual[1]} cm`, x + 8, y + chh + 26);
        }
      }
      return out;
    },
  };

  G.fishkit = { build, skin, studio, silhouette, kindOf, stats, _buildGeometry: buildGeometry, _sampler: sampler, _seasonLook: seasonLook, _swimPatch: swimPatch, CELLS };
})();
