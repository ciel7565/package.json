// =============================================================================
// 12-nature.js — forests, landmark trees, rocks, shrubs, grass, wildflowers,
// flower beds, clouds, birds, butterflies and fireflies.
//
//   G.sys.nature (order 12)
//     setCloudCover(0..1)          how much of the sky is covered (weather)
//     setCloudTint(color)          multiply cloud colour (grey rain clouds, warm dusk ...)
//     setCloudVeil(0..1, color)    blend clouds into the overcast / fog haze colour (weather)
//     setWind(dirX, dirZ, strength) wind for trees / grass / clouds (strength 0..2, default 1)
//     setMist(0..1, color?)        valley mist layers (high preset; weather: mornings / fog / after rain)
//     setPetals(0..1)              drifting petals & leaves around the camera (medium / high; off in rain / at night)
//   Phase 4: rolling wind gusts (trees bend, waves of sheen run through the grass), GPU petals/leaves that recycle
//   around the camera (world-stable, no CPU per frame), valley mist planes that fade softly where they meet the
//   terrain (GPU height lookup, no depth texture) and near the camera, fireflies drifting around the player at night.
//   Wind sway is halved with reduceMotion. Features follow G.sys.engine.feature() and are built lazily.
//     rockGeometry(seed, detail)   displaced rock geometry (also used by the water module)
//     rockMaterial                 shared rock material (vertex colours, moss on top)
//     riverRocks                   [{x, z, r}] boulders in/along the river (water foam)
//     uniforms                     {uTime, uWind, uWindStrength, uNight}
//     counts                       instance statistics (debug)
// Everything is instanced; per-frame work only updates uniforms and a few matrices.
// =============================================================================
(function () {
  const L = G.data.layout || {};
  const PI = Math.PI, TAU = PI * 2;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const smooth = (a, b, v) => { let t = (v - a) / (b - a); t = t < 0 ? 0 : t > 1 ? 1 : t; return t * t * (3 - 2 * t); };

  // noise: shared with the terrain when available (deterministic), small fallback otherwise
  const fallbackN3 = (x, y, z) => Math.sin(x * 1.7 + Math.sin(y * 2.3 + z * 1.1) * 1.3) * Math.cos(z * 1.9 + Math.sin(x * 0.7) * 1.2) * 0.7;
  let N3 = fallbackN3;
  const N2 = (x, z) => N3(x, z, 0.371);

  // terrain helpers with graceful fallbacks
  const TR = () => G.sys.terrain;
  const H = (x, z) => G.world.terrainHeight(x, z);
  const vegBlocked = (x, z, r, kind) => {
    const t = TR();
    if (t && t._fieldsReady) return t.vegBlocked(x, z, r, kind);
    if (G.world.isWater(x, z)) return true;
    for (const zn of G.data.zones || []) { if (Math.hypot(x - zn.center[0], z - zn.center[1]) < zn.r * (kind === 'tree' ? 0.95 : 0.6)) return true; }
    return false;
  };
  const mountainH = (x, z) => (TR()?._fieldsReady ? TR().mountainHeight(x, z) : Math.max(0, H(x, z)));
  const riverDist = (x, z) => (TR()?._fieldsReady ? TR().riverDistance(x, z) : 1e9);
  const surfaceAt = (x, z) => G.world.surfaceAt(x, z);
  const RIVER_HW = ((L.river && L.river.width) || 16) / 2;
  const WATER_Y = L.waterY ?? -1.1;
  const BOX = L.bounds || { minX: -135, maxX: 135, minZ: -135, maxZ: 135 };
  const inBox = (x, z, m = 0) => x > BOX.minX - m && x < BOX.maxX + m && z > BOX.minZ - m && z < BOX.maxZ + m;

  // ---------------------------------------------------------------- shared uniforms & materials
  const uniforms = {
    uTime: { value: 0 },
    uVegAmb: { value: new THREE.Color(0.12, 0.13, 0.12) },
    uWind: { value: new THREE.Vector2(0.86, 0.5) },
    uWindStrength: { value: 1 },
    uGustPos: { value: new THREE.Vector2(0, 0) },  // gust field offset, advected by the wind on the CPU (no precision drift)
    uGustAmt: { value: 1 },                         // 0 on the low preset: the gust noise is skipped (uniform branch)
    uNight: { value: 0 },
  };
  const GLSL_NOISE = `
float tfHash(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float tfNoise(vec2 p){ vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(tfHash(i), tfHash(i + vec2(1.0, 0.0)), u.x), mix(tfHash(i + vec2(0.0, 1.0)), tfHash(i + vec2(1.0, 1.0)), u.x), u.y); }
`;
  const COLOR_VERTEX = `
#if defined( USE_COLOR_ALPHA )
  vColor = vec4( 1.0 );
#elif defined( USE_COLOR ) || defined( USE_INSTANCING_COLOR ) || defined( USE_BATCHING_COLOR )
  vColor = vec3( 1.0 );
#endif
#ifdef USE_COLOR
  vColor *= color;
#endif
#ifdef USE_INSTANCING_COLOR
  vColor.xyz *= mix( vec3( 1.0 ), instanceColor.xyz, aFoliage );
#endif
`;
  /**
   * vegetation material: vertex colours, instance colour only on foliage (aFoliage = 1), wind sway.
   * sway: metres of sway per (object-space height)^2
   */
  function vegMaterial(key, { sway = 0.0016, flutter = 0.02, rough = 0.9, side = THREE.FrontSide, bend = 0, noFlip = false } = {}) {
    return G.gfx.material('nat-' + key, () => {
      const m = new THREE.MeshLambertMaterial({ vertexColors: true, side });
      m.onBeforeCompile = (sh) => {
        sh.uniforms.uTime = uniforms.uTime; sh.uniforms.uWind = uniforms.uWind; sh.uniforms.uWindStrength = uniforms.uWindStrength; sh.uniforms.uVegAmb = uniforms.uVegAmb;
        sh.uniforms.uGustPos = uniforms.uGustPos;
        sh.uniforms.uGustAmt = uniforms.uGustAmt;
        sh.fragmentShader = sh.fragmentShader
          .replace('#include <common>', '#include <common>\nuniform vec3 uVegAmb;')
          .replace('#include <lights_fragment_end>', '#include <lights_fragment_end>\nreflectedLight.indirectDiffuse += diffuseColor.rgb * uVegAmb;');
        if (noFlip) sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_begin>', THREE.ShaderChunk.normal_fragment_begin.replace('normal *= faceDirection;', ''));
        sh.vertexShader = sh.vertexShader
          .replace('#include <common>', '#include <common>\nattribute float aFoliage;\nuniform float uTime;\nuniform vec2 uWind;\nuniform float uWindStrength;\nuniform vec2 uGustPos;\nuniform float uGustAmt;\n' + GLSL_NOISE)
          .replace('#include <color_vertex>', COLOR_VERTEX)
          .replace('#include <begin_vertex>', `#include <begin_vertex>
            #ifdef USE_INSTANCING
              vec3 tfIP = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
            #else
              vec3 tfIP = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
            #endif
            float tfPh = uTime * 1.3 + dot(tfIP.xz, vec2(0.11, 0.17));
            // rolling gusts: a slow noise field blown along the wind direction
            float tfGust = uGustAmt > 0.001 ? smoothstep(0.45, 0.95, tfNoise(tfIP.xz * 0.011 - uGustPos * 0.011)) * uGustAmt : 0.0;
            float tfSw = (sin(tfPh) * 0.65 + sin(tfPh * 2.27 + 1.7) * 0.3 + tfGust * 0.9) * uWindStrength;
            float tfHgt = max(position.y, 0.0);
            transformed.xz += uWind * tfSw * tfHgt * tfHgt * ${sway.toFixed(5)} * (0.35 + 0.65 * aFoliage);
            transformed += normal * sin(uTime * 5.3 + position.x * 3.1 + position.z * 2.3 + tfIP.x) * ${flutter.toFixed(4)} * aFoliage * uWindStrength;
            ${bend ? `transformed.xz += uWind * tfSw * tfHgt * ${bend.toFixed(4)};` : ''}
          `);
      };
      m.customProgramCacheKey = () => `nat-veg3-${sway}-${flutter}-${bend}-${noFlip}`;
      return m;
    });
  }
  const rockMaterial = () => G.gfx.material('nat-rock', () => {
    const m = new THREE.MeshLambertMaterial({ vertexColors: true });
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uVegAmb = uniforms.uVegAmb;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aFoliage;')
        .replace('#include <color_vertex>', COLOR_VERTEX);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform vec3 uVegAmb;')
        .replace('#include <lights_fragment_end>', '#include <lights_fragment_end>\nreflectedLight.indirectDiffuse += diffuseColor.rgb * uVegAmb * 0.8;');
    };
    m.customProgramCacheKey = () => 'nat-rock2';
    return m;
  });

  // ---------------------------------------------------------------- geometry builder
  /** parts: non-indexed geometries with position/normal; adds color + aFoliage; returns merged geometry */
  class Builder {
    constructor() { this.parts = []; }
    add(geo, colorFn, foliage) {
      const g = geo.index ? geo.toNonIndexed() : geo;
      if (!g.attributes.normal) g.computeVertexNormals();
      const n = g.attributes.position.count;
      const col = new Float32Array(n * 3), fol = new Float32Array(n);
      const p = g.attributes.position, c = new THREE.Color();
      for (let i = 0; i < n; i++) {
        const fval = typeof foliage === 'function' ? foliage(p.getX(i), p.getY(i), p.getZ(i), i) : foliage;
        colorFn(p.getX(i), p.getY(i), p.getZ(i), c, i);
        col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; fol[i] = fval;
      }
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      g.setAttribute('aFoliage', new THREE.BufferAttribute(fol, 1));
      for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'color', 'aFoliage'].includes(k)) g.deleteAttribute(k);
      this.parts.push(g);
      return g;
    }
    build() {
      const merged = ADDONS.BufferGeometryUtils.mergeGeometries(this.parts, false);
      for (const p of this.parts) p.dispose();
      merged.computeBoundingSphere(); merged.computeBoundingBox();
      return merged;
    }
  }
  /** lumpy blob (icosahedron) — coincident vertices get identical displacement (noise of position) */
  function blob(r, detail, { sx = 1, sy = 1, sz = 1, jitter = 0.18, seed = 0, at = [0, 0, 0] } = {}) {
    const g = new THREE.IcosahedronGeometry(r, detail);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const k = 1 + N3(x / r * 1.3 + seed * 7.1, y / r * 1.3 + seed * 3.3, z / r * 1.3 - seed) * jitter * 2;
      p.setXYZ(i, x * k * sx + at[0], y * k * sy + at[1], z * k * sz + at[2]);
    }
    g.computeVertexNormals();
    return g;
  }
  /** spherical-ish normals for soft foliage lighting */
  function softNormals(g, center, amount = 0.65) {
    const p = g.attributes.position, n = g.attributes.normal, v = new THREE.Vector3(), w = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.set(p.getX(i) - center[0], (p.getY(i) - center[1]) * 1.3, p.getZ(i) - center[2]).normalize();
      w.set(n.getX(i), n.getY(i), n.getZ(i)).multiplyScalar(1 - amount).addScaledVector(v, amount).normalize();
      n.setXYZ(i, w.x, w.y, w.z);
    }
    return g;
  }
  /** tapered tube through points */
  function tube(points, r0, r1, radial = 7, segsPer = 2) {
    const curve = new THREE.CatmullRomCurve3(points.map((q) => new THREE.Vector3(q[0], q[1], q[2])));
    const segs = Math.max(1, (points.length - 1) * segsPer);
    const g = new THREE.TubeGeometry(curve, segs, 1, radial, false);
    const p = g.attributes.position, c = new THREE.Vector3();
    for (let i = 0; i <= segs; i++) {
      curve.getPointAt(i / segs, c);
      const rr = r0 + (r1 - r0) * (i / segs);
      for (let j = 0; j <= radial; j++) {
        const k = i * (radial + 1) + j;
        p.setXYZ(k, c.x + (p.getX(k) - c.x) * rr, c.y + (p.getY(k) - c.y) * rr, c.z + (p.getZ(k) - c.z) * rr);
      }
    }
    // cap the base slightly below ground
    return g;
  }
  const lum = (c, v) => c.setRGB(v, v, v);

  // ---------------------------------------------------------------- species geometry
  const BARK = { pineLow: new THREE.Color('#4a3b30'), pineHigh: new THREE.Color('#a4573a'), oak: new THREE.Color('#4d4237'), zel: new THREE.Color('#6a6156'), maple: new THREE.Color('#5a4a3e'), conifer: new THREE.Color('#3f3329') };
  function barkFn(lo, hi, h0, h1) {
    return (x, y, z, c) => { c.copy(lo).lerp(hi || lo, smooth(h0, h1, y)); c.multiplyScalar(0.9 + 0.2 * (0.5 + 0.5 * N3(x * 4, y * 1.5, z * 4))); };
  }
  function foliageFn(yLo, yHi, base = 0.62, top = 1.0) {
    return (x, y, z, c) => lum(c, (base + (top - base) * smooth(yLo, yHi, y)) * (0.88 + 0.24 * (0.5 + 0.5 * N3(x * 0.9, y * 0.9, z * 0.9))));
  }

  function buildFarPine(rnd) {
    const B = new Builder();
    const lx = (rnd() - 0.5) * 0.5, lz = (rnd() - 0.5) * 0.5;
    B.add(tube([[0, -0.4, 0], [lx, 6.5, lz]], 0.3, 0.14, 4, 1), barkFn(BARK.pineLow, BARK.pineHigh, 1, 6), 0);
    const tiers = [[3.9, 2.75, 0.56], [6.0, 2.3, 0.6], [8.0, 1.7, 0.7]];
    for (const [y, r, sy] of tiers) {
      const g = blob(r, 0, { sx: 1.1, sy, sz: 1.1, jitter: 0.22, seed: rnd() * 10, at: [lx * (y / 6.5) + (rnd() - 0.5) * 0.7, y, lz * (y / 6.5) + (rnd() - 0.5) * 0.7] });
      softNormals(g, [lx, 6, lz], 0.55);
      B.add(g, foliageFn(3.5, 9.5, 0.5, 1.0), 1);
    }
    return B.build();
  }
  function buildPine(rnd, far) {
    if (far) return buildFarPine(rnd);
    const B = new Builder();
    const lean = [(rnd() - 0.5) * 0.9, (rnd() - 0.5) * 0.9];
    const trunkPts = far ? [[0, -0.4, 0], [lean[0], 8.8, lean[1]]] : [[0, -0.4, 0], [lean[0] * 0.3 + 0.15, 3, lean[1] * 0.3], [lean[0] * 0.8 - 0.2, 6, lean[1] * 0.7 + 0.15], [lean[0], 8.8, lean[1]]];
    B.add(tube(trunkPts, far ? 0.3 : 0.32, 0.11, far ? 4 : 7, far ? 1 : 2), barkFn(BARK.pineLow, BARK.pineHigh, 1, 7), 0);
    const pads = [];
    const top = [lean[0], 9.0, lean[1]];
    pads.push({ at: top, r: far ? 2.3 : 1.9, sy: 0.58 });
    const n = far ? 2 : 4;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + rnd() * 0.9;
      const y = 5.4 + rnd() * 3.0;
      const t = (y - 0) / 8.8;
      const base = [lean[0] * t, y - 0.6, lean[1] * t];
      const len = 1.6 + rnd() * 1.5;
      const end = [base[0] + Math.sin(a) * len, y + 0.3 + rnd() * 0.5, base[2] + Math.cos(a) * len];
      if (!far) B.add(tube([base, [(base[0] + end[0]) / 2, (base[1] + end[1]) / 2 + 0.25, (base[2] + end[2]) / 2], end], 0.09, 0.035, 4, 1), barkFn(BARK.pineHigh, BARK.pineHigh, 0, 1), 0);
      pads.push({ at: end, r: (far ? 1.9 : 1.45) + rnd() * 0.7, sy: 0.52 + rnd() * 0.12 });
    }
    const fols = [];
    for (let pi = 0; pi < pads.length; pi++) {
      const p = pads[pi];
      const g = blob(p.r, far ? 0 : 1, { sx: 1.15, sy: p.sy, sz: 1.15, jitter: 0.27, seed: rnd() * 10, at: p.at });
      if (!far && pi < 3) { // a second, smaller lump on top for the layered look
        const g2 = blob(p.r * 0.62, 0, { sx: 1.1, sy: p.sy * 0.9, sz: 1.1, jitter: 0.22, seed: rnd() * 10, at: [p.at[0] + (rnd() - 0.5) * 0.6, p.at[1] + p.r * 0.32, p.at[2] + (rnd() - 0.5) * 0.6] });
        fols.push(g2);
      }
      fols.push(g);
    }
    for (const g of fols) { softNormals(g, [lean[0], 7.4, lean[1]], 0.72); B.add(g, foliageFn(5, 9.8, 0.68, 1.05), 1); }
    return B.build();
  }
  function buildRound(rnd, far, opts = {}) {
    const B = new Builder();
    const Ht = opts.height || 8.5, crownY = Ht * 0.68, crownR = opts.crownR || 3.4;
    const bark = opts.bark || BARK.oak;
    const lx = (rnd() - 0.5) * 0.4, lz = (rnd() - 0.5) * 0.4;
    B.add(tube([[0, -0.4, 0], [lx * 0.5, Ht * 0.3, lz * 0.5], [lx, crownY, lz]], opts.trunkR || 0.27, 0.12, far ? 4 : 7, far ? 1 : 2), barkFn(bark, bark, 0, 1), 0);
    if (!far) {
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * TAU + rnd();
        const b0 = [lx * 0.6, Ht * 0.42 + rnd() * 0.6, lz * 0.6];
        B.add(tube([b0, [Math.sin(a) * crownR * 0.45, crownY + 0.2, Math.cos(a) * crownR * 0.45]], 0.11, 0.05, 4, 1), barkFn(bark, bark, 0, 1), 0);
      }
    }
    const n = far ? 2 : (opts.blobs || 5);
    const fols = [];
    for (let i = 0; i < n; i++) {
      let at, r;
      if (i === 0) { at = [lx, crownY + crownR * (far ? 0.05 : 0.25), lz]; r = crownR * (far ? 1.0 : 0.72); }
      else {
        const a = (i / (n - 1)) * TAU + rnd() * 0.6;
        const rr = crownR * (far ? 0.55 : 0.55 + rnd() * 0.15);
        at = [lx + Math.sin(a) * rr, crownY - (far ? 0.9 : 0.2) + rnd() * crownR * 0.5, lz + Math.cos(a) * rr];
        r = crownR * (far ? 0.75 : 0.5 + rnd() * 0.18);
      }
      fols.push(blob(r, far ? 0 : 1, { sx: 1, sy: opts.flat || 0.86, sz: 1, jitter: 0.2, seed: rnd() * 10, at }));
    }
    for (const g of fols) { softNormals(g, [lx, crownY + crownR * 0.2, lz], 0.62); B.add(g, foliageFn(crownY - crownR * 0.6, crownY + crownR * 0.9, 0.5, 1.0), 1); }
    return B.build();
  }
  function buildZelkova(rnd) {
    const B = new Builder();
    B.add(tube([[0, -0.5, 0], [0.1, 1.6, 0.05], [0, 3.0, 0]], 0.62, 0.42, 9), barkFn(BARK.zel, BARK.zel, 0, 1), 0);
    const limbs = 6, ends = [];
    for (let i = 0; i < limbs; i++) {
      const a = (i / limbs) * TAU + rnd() * 0.5;
      const r = 3.2 + rnd() * 1.6, y = 7 + rnd() * 1.6;
      const end = [Math.sin(a) * r, y, Math.cos(a) * r];
      ends.push(end);
      B.add(tube([[Math.sin(a) * 0.2, 2.6, Math.cos(a) * 0.2], [Math.sin(a) * r * 0.45, 5.0 + rnd(), Math.cos(a) * r * 0.45], end], 0.26, 0.08, 5, 2), barkFn(BARK.zel, BARK.zel, 0, 1), 0);
    }
    const fols = [];
    fols.push(blob(4.2, 1, { sx: 1.35, sy: 0.55, sz: 1.35, jitter: 0.16, seed: rnd() * 10, at: [0, 10.2, 0] }));
    for (const e of ends) fols.push(blob(2.6 + rnd() * 0.6, 1, { sx: 1.1, sy: 0.7, sz: 1.1, jitter: 0.2, seed: rnd() * 10, at: [e[0] * 1.15, e[1] + 0.9, e[2] * 1.15] }));
    for (let i = 0; i < 4; i++) { const a = rnd() * TAU; fols.push(blob(2.2, 1, { sy: 0.65, jitter: 0.2, seed: rnd() * 10, at: [Math.sin(a) * 2.2, 11.3 + rnd(), Math.cos(a) * 2.2] })); }
    for (const g of fols) { softNormals(g, [0, 9, 0], 0.6); B.add(g, foliageFn(6.5, 12.5, 0.5, 1.0), 1); }
    return B.build();
  }
  function buildConifer(rnd, far) {
    const B = new Builder();
    const Ht = 12.5;
    B.add(tube([[0, -0.4, 0], [0, Ht * 0.6, 0], [0, Ht, 0]], 0.26, 0.06, far ? 4 : 6, 1), barkFn(BARK.conifer, BARK.conifer, 0, 1), 0);
    const tiers = far ? 2 : 4;
    for (let i = 0; i < tiers; i++) {
      const t = i / tiers;
      const y0 = (far ? 1.4 : 2.2) + t * (Ht - 3.5), hh = (Ht - y0) * (far ? 0.85 : 0.62);
      const r = 2.5 * (1 - t * 0.62);
      const g = new THREE.ConeGeometry(r, hh, far ? 6 : 9, far ? 1 : 2, true);
      g.translate(0, y0 + hh / 2, 0);
      const p = g.attributes.position;
      for (let k = 0; k < p.count; k++) {
        const x = p.getX(k), y = p.getY(k), z = p.getZ(k);
        const j = 1 + N3(x * 1.3 + i * 3, y * 1.1, z * 1.3) * 0.22;
        p.setXYZ(k, x * j, y - (Math.hypot(x, z) / r) * 0.35, z * j);
      }
      g.computeVertexNormals();
      softNormals(g, [0, y0 + hh * 0.3, 0], 0.35);
      B.add(g, foliageFn(2, Ht, 0.5, 0.95), 1);
    }
    return B.build();
  }
  function buildShrub(rnd, flowering) {
    const B = new Builder();
    const fols = [];
    const n = 2;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + rnd();
      const r = 0.45 + rnd() * 0.2;
      fols.push(blob(r, 1, { sy: 0.72, jitter: 0.22, seed: rnd() * 10, at: [Math.sin(a) * 0.36, r * 0.55, Math.cos(a) * 0.36] }));
    }
    fols.push(blob(0.6, 1, { sy: 0.75, jitter: 0.2, seed: rnd() * 10, at: [0, 0.55, 0] }));
    const fcol = new THREE.Color('#ffffff');
    for (const g of fols) {
      softNormals(g, [0, 0.45, 0], 0.6);
      const isFlower = (x, y, z) => flowering && y > 0.42 && N3(x * 13.1, y * 13.1, z * 13.1) > 0.3;
      B.add(g, (x, y, z, c) => {
        if (isFlower(x, y, z)) c.copy(fcol).multiplyScalar(0.95);
        else lum(c, (0.55 + 0.45 * smooth(0.0, 1.0, y)) * (0.9 + 0.2 * (0.5 + 0.5 * N3(x * 3, y * 3, z * 3))));
      }, (x, y, z) => (isFlower(x, y, z) ? 0 : 1));
    }
    return B.build();
  }
  function buildFlower(rnd) {
    const B = new Builder();
    // stem (two crossed thin quads)
    for (const a of [0, PI / 2]) {
      const g = new THREE.PlaneGeometry(0.014, 0.4, 1, 1);
      g.translate(0, 0.2, 0); g.rotateY(a);
      const nr = g.attributes.normal; for (let i = 0; i < nr.count; i++) nr.setXYZ(i, 0, 1, 0);
      B.add(g, (x, y, z, c) => c.setRGB(0.07, 0.2, 0.04), 0);
    }
    // blossom: petal fan (tinted by instance colour) + yellow centre
    const petals = 5, R = 0.1;
    const pos = [];
    for (let i = 0; i < petals; i++) {
      const a0 = (i / petals) * TAU, a1 = ((i + 0.5) / petals) * TAU, a2 = ((i + 1) / petals) * TAU;
      const p0 = [0, 0, 0], p1 = [Math.sin(a0) * R * 0.55, 0.012, Math.cos(a0) * R * 0.55], pm = [Math.sin(a1) * R, 0.03, Math.cos(a1) * R], p2 = [Math.sin(a2) * R * 0.55, 0.012, Math.cos(a2) * R * 0.55];
      pos.push(...p0, ...p2, ...pm, ...p0, ...pm, ...p1);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.rotateX(0.35); g.translate(0, 0.43, 0);
    g.computeVertexNormals();
    const nr = g.attributes.normal; for (let i = 0; i < nr.count; i++) nr.setXYZ(i, 0, 1, 0);
    // centre vertices: warm yellow, not tinted; petals: neutral, tinted by the instance colour
    B.add(g, (x, y, z, c) => { if (Math.hypot(x, (y - 0.43) * 0.3, z) < 0.012) c.setRGB(0.95, 0.7, 0.12); else lum(c, 0.92); }, (x, y, z) => (Math.hypot(x, (y - 0.43) * 0.3, z) < 0.012 ? 0 : 1));
    return B.build();
  }
  function rockGeometry(seed = 1, detail = 2) {
    const g = blob(1, detail, { sx: 1.15, sy: 0.72, sz: 1.0, jitter: 0.24, seed });
    // flatten the base a bit so rocks sit nicely
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) { const y = p.getY(i); if (y < -0.35) p.setY(i, -0.35 + (y + 0.35) * 0.3); }
    g.computeVertexNormals();
    const B = new Builder();
    const moss = new THREE.Color('#4a5a2e'), r1 = new THREE.Color('#7a766c'), r2 = new THREE.Color('#5e5b54'), r3 = new THREE.Color('#918b7f');
    const nrm = g.attributes.normal;
    B.add(g, (x, y, z, c, i) => {
      const n = N3(x * 2.3 + seed, y * 2.3, z * 2.3);
      c.copy(r1).lerp(r2, smooth(-0.3, 0.4, n)).lerp(r3, smooth(0.25, 0.6, N3(x * 6, y * 6, z * 6 + seed)) * 0.6);
      const up = nrm.getY(i);
      c.lerp(moss, smooth(0.62, 0.92, up + N3(x * 3, y * 3, z * 3) * 0.3) * 0.5);
      c.multiplyScalar(0.8 + 0.25 * smooth(-0.4, 0.6, y));
    }, 1);
    return B.build();
  }

  // ---------------------------------------------------------------- instancing helpers
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _e = new THREE.Euler(), _c = new THREE.Color();
  const WHITE = new THREE.Color(1, 1, 1);
  function makeInstanced(geo, mat, list, { shadow = false, receive = true, name = '' } = {}) {
    if (!list.length) return null;
    const im = new THREE.InstancedMesh(geo, mat, list.length);
    for (let i = 0; i < list.length; i++) {
      const it = list[i];
      _e.set(it.tiltX || 0, it.rot || 0, it.tiltZ || 0);
      _q.setFromEuler(_e);
      _p.set(it.x, it.y, it.z);
      _s.set(it.s * (it.sx || 1), it.s * (it.sy || 1), it.s * (it.sz || 1));
      _m.compose(_p, _q, _s);
      im.setMatrixAt(i, _m);
      im.setColorAt(i, it.color || _c.set(0xffffff));
    }
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
    im.castShadow = shadow; im.receiveShadow = receive;
    im.computeBoundingSphere();
    im.matrixAutoUpdate = false; im.updateMatrix();
    im.name = name;
    im.raycast = () => {};
    return im;
  }
  const hsl = (h, s, l) => new THREE.Color().setHSL(((h % 1) + 1) % 1, clamp(s, 0, 1), clamp(l, 0, 1), THREE.SRGBColorSpace);
  /** species foliage colours (instance colour multiplies neutral vertex colours) */
  const PALETTE = {
    pine: (r) => hsl(0.27 + (r() - 0.5) * 0.04, 0.4 + r() * 0.12, 0.26 + r() * 0.07),
    oak: (r) => hsl(0.24 + (r() - 0.5) * 0.05, 0.5 + r() * 0.14, 0.3 + r() * 0.08),
    zelkova: (r) => hsl(0.25 + (r() - 0.5) * 0.03, 0.48 + r() * 0.1, 0.31 + r() * 0.06),
    maple: (r) => {
      const k = r();
      if (k < 0.035) return hsl(0.005 + r() * 0.02, 0.6, 0.34 + r() * 0.05);    // red accent
      if (k < 0.075) return hsl(0.07 + r() * 0.03, 0.62, 0.4 + r() * 0.05);     // orange accent
      return hsl(0.22 + (r() - 0.5) * 0.05, 0.52 + r() * 0.12, 0.33 + r() * 0.08);
    },
    conifer: (r) => hsl(0.33 + (r() - 0.5) * 0.04, 0.38 + r() * 0.1, 0.19 + r() * 0.05),
  };

  // ---------------------------------------------------------------- the system
  const NAT = {
    name: 'nature', order: 12, label: '숲과 자연',
    uniforms,
    riverRocks: [],
    counts: {},
    meshes: {},
    rockGeometry,
    get rockMaterial() { return rockMaterial(); },
    _cloudCover: 0.42, _cloudTint: new THREE.Color(1, 1, 1), _cloudVeil: 0, _cloudVeilCol: new THREE.Color(0xbcd6e8),

    setCloudCover(v) { this._cloudCover = clamp(Number(v) || 0, 0, 1); if (this._cloudMat) this._cloudMat.uniforms.uCover.value = this._cloudCover; },
    setCloudTint(c) { try { this._cloudTint.set(c); } catch (e) { this._cloudTint.set(0xffffff); } if (this._cloudMat) this._cloudMat.uniforms.uTint.value.copy(this._cloudTint); },
    /** overcast / fog veil: blend clouds toward the haze colour (they can sit in front of distant mountains,
     *  where the weather sky overlay cannot reach them) */
    setCloudVeil(amount, color) {
      this._cloudVeil = clamp(Number(amount) || 0, 0, 1);
      if (color != null) { try { this._cloudVeilCol.set(color); } catch (e) { /* keep */ } }
      if (this._cloudMat) { this._cloudMat.uniforms.uVeil.value = this._cloudVeil; this._cloudMat.uniforms.uVeilCol.value.copy(this._cloudVeilCol); }
    },
    setWind(dx = 0.86, dz = 0.5, strength = 1) {
      const l = Math.hypot(dx, dz) || 1;
      if (Number.isFinite(dx) && Number.isFinite(dz)) uniforms.uWind.value.set(dx / l, dz / l);
      this._windGoal = clamp(Number(strength) || 0, 0, 3) * (G.settings?.reduceMotion ? 0.5 : 1);
      if (this._windCur == null) { this._windCur = this._windGoal; uniforms.uWindStrength.value = this._windCur; }
    },
    setMist(amount, color) {
      this._mistAmt = clamp(Number(amount) || 0, 0, 1);
      if (color != null) { try { this._mistCol.set(color); } catch (e) { /* keep */ } }
    },
    setPetals(amount) { this._petalAmt = clamp(Number(amount) || 0, 0, 1); },
    _mistAmt: 0.35, _mistCol: new THREE.Color(0xc9d8e4), _petalAmt: 1,

    async init() {
      const eng = G.sys.engine;
      if (!eng?.scene) return;
      const terr = TR();
      if (terr?.ensureFields) { try { terr.ensureFields(); } catch (e) { G.log.warn('WORLD', 'terrain fields unavailable for nature', e); } }
      if (terr?.noise3) N3 = terr.noise3;
      const scene = eng.scene;
      const preset = eng.preset || { treeDensity: 0.75, grassDensity: 0.5, name: 'medium' };
      this.preset = preset;
      const root = new THREE.Group(); root.name = 'nature';
      scene.add(root);
      this.root = root;
      const steps = [
        ['trees', () => this._buildTrees(root, preset)],
        ['rocks', () => this._buildRocks(root, preset)],
        ['shrubs', () => this._buildShrubs(root, preset)],
        ['flowers', () => this._buildFlowers(root, preset)],
        ['grass', () => this._buildGrass(root, preset)],
        ['clouds', () => this._buildClouds(scene, preset)],
        ['birds', () => this._buildBirds(root)],
        ['butterflies', () => this._buildButterflies(root)],
        ['fireflies', () => this._buildFireflies(root, preset)],
      ];
      for (const [name, fn] of steps) {
        try { fn(); } catch (e) { G.log.error('WORLD', `nature: ${name} failed`, e); G.__systemErrors?.push({ system: 'nature', phase: 'init:' + name, message: String(e && e.stack || e) }); }
        if (name === 'trees' || name === 'grass') await G.util.nextFrame();
      }
      this._ensureAtmos();
      G.bus.on('engine:features', () => this._ensureAtmos());
      G.bus.on('engine:quality', () => this._ensureAtmos());
      G.log.info('WORLD', 'nature', JSON.stringify(this.counts));
    },

    // ============================================================== trees
    _buildTrees(root, preset) {
      const dens = clamp(preset.treeDensity ?? 0.75, 0.2, 1.2);
      const low = preset.name === 'low';
      const rnd = G.util.rng(4242);
      // geometry variants
      const geo = {
        pine: buildPine(G.util.rng(11), false),
        oak: buildRound(G.util.rng(12), false, { height: 8.5, crownR: 3.4 }),
        maple: buildRound(G.util.rng(13), false, { height: 7, crownR: 2.8, bark: BARK.maple, trunkR: 0.2, blobs: 6, flat: 0.8 }),
        zelkova: buildZelkova(G.util.rng(14)),
        conifer: buildConifer(G.util.rng(15), false),
        farPine: buildPine(G.util.rng(21), true),
        farRound: buildRound(G.util.rng(22), true, { height: 6.6, crownR: 4.1 }),
        farConifer: buildConifer(G.util.rng(23), true),
      };
      this._treeGeo = geo;
      const mat = vegMaterial('tree', { sway: 0.0011, flutter: 0.025 });
      const campus = { pine: [], oak: [], maple: [], zelkova: [], conifer: [] };
      const slope = { pine: [], oak: [], maple: [], zelkova: [], conifer: [] };
      const SECT = 8;
      const far = { farPine: [], farRound: [], farConifer: [] };
      for (const k in far) for (let s = 0; s < SECT; s++) far[k].push([]);
      const TRUNK_R = { pine: 0.3, oak: 0.28, maple: 0.22, zelkova: 0.6, conifer: 0.26 };
      const colliders = [];
      const placed = []; // campus trees (spacing check)
      const add = (kind, x, z, s, opts = {}) => {
        const y = H(x, z) - 0.15;
        const color = PALETTE[kind] ? PALETTE[kind](rnd) : PALETTE.oak(rnd);
        const it = { x, y, z, s, rot: rnd() * TAU, color, tiltX: (rnd() - 0.5) * 0.06, tiltZ: (rnd() - 0.5) * 0.06 };
        const nearBox = inBox(x, z, 24);
        if (opts.campus) campus[kind].push(it);
        else if (nearBox && !low) slope[kind].push(it);
        else {
          const fk = kind === 'pine' ? 'farPine' : kind === 'conifer' ? 'farConifer' : 'farRound';
          if (fk === 'farRound') { it.s *= kind === 'zelkova' ? 1.25 : 1; }
          const sec = Math.floor(((Math.atan2(x, z) + PI) / TAU) * SECT) % SECT;
          far[fk][sec].push(it);
        }
        if (inBox(x, z, 1) && H(x, z) < 4.5) colliders.push({ x, z, r: (TRUNK_R[kind] || 0.3) * s + 0.12 });
      };

      // ---- landmark trees
      for (const lt of L.landmarkTrees || []) {
        const kind = ({ zelkova: 'zelkova', pine: 'pine', maple: 'maple', oak: 'oak' })[lt.kind] || 'oak';
        // the zelkova model is already a 12 m giant: layout scale is relative to a ~8 m village tree
        add(kind, lt.x, lt.z, (lt.scale || 1) * (kind === 'zelkova' ? 0.68 : 1.0), { campus: true });
        placed.push([lt.x, lt.z, 5]);
      }
      // ---- campus trees: forest-edge belt, riverside, roadside avenue and sparse shade trees
      const cell = 5.2 / Math.sqrt(dens);
      for (let gz = BOX.minZ; gz < BOX.maxZ; gz += cell) {
        for (let gx = BOX.minX; gx < BOX.maxX; gx += cell) {
          const x = gx + rnd() * cell, z = gz + rnd() * cell;
          const mh = mountainH(x, z);
          if (mh > 2.2) continue; // slopes handled by the forest pass
          const h = H(x, z);
          if (h < WATER_Y + 0.6) continue;
          const rd = riverDist(x, z);
          const pd = TR()?.pathDistance ? TR().pathDistance(x, z) : 99;
          let p = 0.04;
          p = Math.max(p, smooth(0.05, 1.2, mh) * 0.75);                         // forest edge
          if (rd > RIVER_HW + 3.5 && rd < RIVER_HW + 18) p = Math.max(p, 0.32);    // riverside
          if (pd > 3.2 && pd < 7.5 && !TR()?.inZone?.(x, z)) p = Math.max(p, 0.16);
          if (z > 100 || x < -76) p = Math.max(p, 0.22);
          if (x > 100) p = Math.max(p, 0.5);                                      // east bank
          p *= 0.55 + 0.45 * smooth(-0.4, 0.3, N2(x / 40 + 9, z / 40));
          if (rnd() > p) continue;
          const kr = rnd();
          let kind;
          if (rd < RIVER_HW + 18) kind = kr < 0.45 ? 'maple' : kr < 0.8 ? 'oak' : 'pine';
          else if (mh > 0.05) kind = kr < 0.42 ? 'pine' : kr < 0.7 ? 'oak' : kr < 0.85 ? 'conifer' : 'maple';
          else kind = kr < 0.38 ? 'pine' : kr < 0.62 ? 'oak' : kr < 0.84 ? 'maple' : kr < 0.92 ? 'zelkova' : 'conifer';
          const s = (kind === 'zelkova' ? 0.75 : 0.8) + rnd() * 0.45;
          const rad = (kind === 'zelkova' ? 6 : kind === 'conifer' ? 2.4 : 3.2) * s;
          if (vegBlocked(x, z, rad * 0.45, 'tree')) continue;
          let ok = true;
          for (const q of placed) { const dx = q[0] - x, dz = q[1] - z; if (dx * dx + dz * dz < (q[2] + rad * 0.55) * (q[2] + rad * 0.55)) { ok = false; break; } }
          if (!ok) continue;
          placed.push([x, z, rad * 0.55]);
          add(kind, x, z, s, { campus: true });
        }
      }
      // ---- mountain forest (+ valley groves outside the campus)
      const fcell = 6.9 / Math.sqrt(Math.min(dens, 0.9));
      const LIM = (G.sys.terrain?.half || 500) - 8;
      for (let gz = -LIM; gz < LIM; gz += fcell) {
        for (let gx = -LIM; gx < LIM; gx += fcell) {
          const x = gx + rnd() * fcell, z = gz + rnd() * fcell;
          const mh = mountainH(x, z);
          const inside = inBox(x, z, 0);
          let p;
          if (mh > 1.6) p = 1;
          else if (!inside) p = 0.1 + 0.4 * smooth(0.15, 0.55, N2(x / 85, z / 85 + 3)) + smooth(0.2, 1.6, mh) * 0.5;
          else continue;
          const clear = N2(x / 75 - 4, z / 75 + 1);
          p *= smooth(-0.7, -0.42, clear);
          // the outer ring sits deep in the haze: thinner there (bigger trees keep the canopy closed)
          const rr = Math.max(Math.abs(x), Math.abs(z));
          p *= 1 - smooth(330, 480, rr) * (low ? 0.6 : 0.45);
          if (low) p *= 0.78;
          if (rnd() > p) continue;
          const h = H(x, z);
          if (h < WATER_Y + 0.5) continue;
          const rd = riverDist(x, z);
          if (rd < RIVER_HW + 4.5) continue;
          // avoid bare crags: steep slope -> fewer trees
          const e = 2.5, gxs = H(x + e, z) - H(x - e, z), gzs = H(x, z + e) - H(x, z - e);
          const steep = Math.hypot(gxs, gzs) / (2 * e);
          if (steep > 1.5 && rnd() < 0.7) continue;
          if (vegBlocked(x, z, 1.5, 'tree')) continue;
          const elev = h + N2(x / 30, z / 30) * 14;
          const kr = rnd();
          let kind;
          if (elev < 22) kind = kr < 0.34 ? 'oak' : kr < 0.6 ? 'pine' : kr < 0.78 ? 'maple' : 'conifer';
          else if (elev < 70) kind = kr < 0.42 ? 'pine' : kr < 0.66 ? 'oak' : kr < 0.86 ? 'conifer' : 'maple';
          else kind = kr < 0.55 ? 'pine' : kr < 0.82 ? 'conifer' : 'oak';
          const dist = Math.hypot(x, z);
          const s = (1.15 + rnd() * 0.55) * (1 + smooth(160, 420, dist) * 0.5) * (0.9 + 0.2 * (0.5 + 0.5 * N2(x / 50, z / 50))) * (low ? 1.12 : 1);
          add(kind, x, z, s);
        }
      }
      // ---- meshes
      const grp = new THREE.Group(); grp.name = 'trees';
      const shadows = !!preset.shadows;
      let total = 0;
      for (const k of Object.keys(campus)) {
        const m = makeInstanced(geo[k], mat, campus[k], { shadow: shadows, receive: true, name: 'trees-campus-' + k });
        if (m) { grp.add(m); total += campus[k].length; }
        const m2 = makeInstanced(geo[k], mat, slope[k], { shadow: false, receive: shadows, name: 'trees-slope-' + k });
        if (m2) { grp.add(m2); total += slope[k].length; }
      }
      for (const k of Object.keys(far)) for (let s = 0; s < SECT; s++) {
        const m = makeInstanced(geo[k], mat, far[k][s], { shadow: false, receive: false, name: `trees-far-${k}-${s}` });
        if (m) { grp.add(m); total += far[k][s].length; }
      }
      root.add(grp);
      this.meshes.trees = grp;
      for (const c of colliders) G.world.addCollider({ shape: 'circle', x: c.x, z: c.z, r: c.r, tag: 'tree' });
      this.counts.trees = total;
      this.counts.campusTrees = Object.values(campus).reduce((a, b) => a + b.length, 0);
      this.counts.treeColliders = colliders.length;
    },

    // ============================================================== rocks
    _buildRocks(root, preset) {
      const rnd = G.util.rng(777);
      const low = preset.name === 'low';
      const geos = [rockGeometry(1.3, low ? 1 : 2), rockGeometry(4.7, 1), rockGeometry(8.1, 1)];
      const farGeo = rockGeometry(2.9, 0);
      const mat = rockMaterial();
      const lists = [[], [], []], farList = [];
      const colliders = [];
      const rockCol = () => { const v = 0.85 + rnd() * 0.3; return new THREE.Color(v, v * (0.97 + rnd() * 0.05), v * (0.92 + rnd() * 0.08)); };
      const put = (x, z, s, opts = {}) => {
        const y = H(x, z) - s * (opts.sink ?? 0.22);
        const it = { x, y, z, s, sy: 0.75 + rnd() * 0.45, rot: rnd() * TAU, tiltX: (rnd() - 0.5) * 0.3, tiltZ: (rnd() - 0.5) * 0.3, color: rockCol() };
        const near = Math.abs(x) < 170 && Math.abs(z) < 170;
        if (near) lists[Math.floor(rnd() * 3)].push(it); else farList.push(it);
        if (inBox(x, z, 0) && s > 0.55 && H(x, z) > WATER_Y - 0.25 && !opts.noCollide) colliders.push({ x, z, r: s * 0.95 });
        return it;
      };
      // river: bank stones and boulders in the bed
      const line = TR()?.riverLine || [];
      for (let i = 0; i < line.length - 1; i++) {
        const [ax, az] = line[i], [bx, bz] = line[i + 1];
        let tx = bx - ax, tz = bz - az; const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
        const nx = -tz, nz = tx;
        for (const side of [-1, 1]) {
          const n = rnd() < 0.55 ? 1 + Math.floor(rnd() * 3) : 0;
          for (let k = 0; k < n; k++) {
            const t = rnd(), d = RIVER_HW - 2.2 + rnd() * 7.5;
            const x = ax + tx * tl * t + nx * side * d, z = az + tz * tl * t + nz * side * d;
            if (Math.abs(x) > 495 || Math.abs(z) > 495) continue;
            if (TR()?.pathDistance && TR().pathDistance(x, z) < 1.2) continue;
            if (L.riverDeck && Math.abs(x - L.riverDeck.x) < L.riverDeck.w / 2 + 1.5 && Math.abs(z - L.riverDeck.z) < L.riverDeck.d / 2 + 1.5) continue;
            const s = d < RIVER_HW ? 0.35 + rnd() * 0.75 : 0.22 + rnd() * rnd() * 1.1;
            put(x, z, s, { sink: d < RIVER_HW ? 0.35 : 0.25 });
          }
        }
        if (rnd() < 0.13) {
          const side = rnd() < 0.5 ? -1 : 1, nb = 1 + Math.floor(rnd() * 3);
          for (let k = 0; k < nb; k++) {
            const t = rnd(), d = side * (RIVER_HW - 4.4 + rnd() * 3.2);
            const x = ax + tx * tl * t + nx * d, z = az + tz * tl * t + nz * d;
            if (Math.abs(x) > 495 || Math.abs(z) > 495) continue;
            const s = 0.75 + rnd() * 0.75, sy = 0.85 + rnd() * 0.3;
            const it = put(x, z, s, { sink: 0.3, noCollide: true });
            it.sy = sy;
            it.y = Math.min(H(x, z) + 0.1, WATER_Y + 0.12 + rnd() * 0.25 - 0.72 * s * sy);
            this.riverRocks.push({ x, z, r: s * 0.95 });
          }
        }
      }
      // pond rims
      for (const p of L.ponds || []) {
        const n = Math.round(p.r * 3.2);
        for (let i = 0; i < n; i++) {
          const a = (i / n) * TAU + rnd() * 0.3;
          const d = p.r - 0.4 + rnd() * 1.6;
          const x = p.x + Math.sin(a) * d, z = p.z + Math.cos(a) * d;
          if (TR()?.pathDistance && TR().pathDistance(x, z) < 0.9) continue;
          if (p.waterfall && Math.hypot(x - p.waterfall.x, z - p.waterfall.z) < 2.2) continue;
          put(x, z, 0.3 + rnd() * 0.55, { sink: 0.3 });
          if (d < p.r + 0.3 && rnd() < 0.3) this.riverRocks.push({ x, z, r: 0.5 });
        }
      }
      // mountain outcrops (clusters on steep ground) and scattered slope boulders
      const cell = low ? 22 : 15;
      for (let gz = -490; gz < 490; gz += cell) for (let gx = -490; gx < 490; gx += cell) {
        const x = gx + rnd() * cell, z = gz + rnd() * cell;
        const mh = mountainH(x, z);
        if (mh < 3) continue;
        const e = 2.5, gxs = H(x + e, z) - H(x - e, z), gzs = H(x, z + e) - H(x, z - e);
        const steep = Math.hypot(gxs, gzs) / (2 * e);
        const p = steep > 0.9 ? 0.6 : 0.08;
        if (rnd() > p) continue;
        const n = steep > 0.9 ? 2 + Math.floor(rnd() * 3) : 1;
        for (let k = 0; k < n; k++) {
          const xx = x + (rnd() - 0.5) * 6, zz = z + (rnd() - 0.5) * 6;
          if (vegBlocked(xx, zz, 0.5, 'shrub')) continue;
          put(xx, zz, (steep > 0.9 ? 1.2 : 0.7) + rnd() * 1.8, { sink: 0.5 });
        }
      }
      // forest-edge and meadow boulders inside the campus
      for (let i = 0; i < 160; i++) {
        const x = BOX.minX + rnd() * (BOX.maxX - BOX.minX), z = BOX.minZ + rnd() * (BOX.maxZ - BOX.minZ);
        const mh = mountainH(x, z);
        if (mh < 0.15 && rnd() > 0.15) continue;
        if (vegBlocked(x, z, 1.2, 'tree')) continue;
        if (surfaceAt(x, z) !== 'grass') continue;
        const s = 0.35 + rnd() * rnd() * 1.4;
        put(x, z, s);
        if (rnd() < 0.6) put(x + (rnd() - 0.5) * 2.2, z + (rnd() - 0.5) * 2.2, s * (0.35 + rnd() * 0.3));
      }
      const grp = new THREE.Group(); grp.name = 'rocks';
      const shadows = !!preset.shadows;
      lists.forEach((l, i) => { const m = makeInstanced(geos[i], mat, l, { shadow: shadows, receive: true, name: 'rocks-' + i }); if (m) grp.add(m); });
      const fm = makeInstanced(farGeo, mat, farList, { shadow: false, receive: false, name: 'rocks-far' });
      if (fm) grp.add(fm);
      root.add(grp);
      this.meshes.rocks = grp;
      for (const c of colliders) G.world.addCollider({ shape: 'circle', x: c.x, z: c.z, r: c.r, tag: 'rock', maxY: H(c.x, c.z) + c.r * 0.9 });
      this.counts.rocks = lists.reduce((a, b) => a + b.length, 0) + farList.length;
    },

    // ============================================================== shrubs
    _buildShrubs(root, preset) {
      const rnd = G.util.rng(9191);
      const geoGreen = buildShrub(G.util.rng(31), false), geoFlower = buildShrub(G.util.rng(32), true);
      const mat = vegMaterial('shrub', { sway: 0.02, flutter: 0.012 });
      const green = [], flower = [];
      const colliders = [];
      const FLOWER_COLS = ['#f08cbc', '#f7a8c8', '#e7708f', '#fbf3f5', '#d99be0'];
      const tryPut = (x, z, s, flowering) => {
        if (!inBox(x, z, 8)) return false;
        if (vegBlocked(x, z, 0.45 * s, 'shrub')) return false;
        const sf = surfaceAt(x, z);
        if (sf !== 'grass' && sf !== 'sand') return false;
        if (H(x, z) < WATER_Y + 0.3) return false;
        const it = { x, y: H(x, z) - 0.06, z, s, sy: 0.85 + rnd() * 0.35, rot: rnd() * TAU, color: hsl(0.26 + (rnd() - 0.5) * 0.06, 0.45 + rnd() * 0.15, 0.24 + rnd() * 0.08) };
        if (flowering) { it.flowerColor = FLOWER_COLS[Math.floor(rnd() * FLOWER_COLS.length)]; flower.push(it); } else green.push(it);
        if (s > 1.05 && inBox(x, z)) colliders.push({ x, z, r: 0.55 * s });
        return true;
      };
      // around buildings (not in front of doors)
      for (const b of L.buildings || []) {
        if (['hall', 'gate', 'stall', 'pavilion'].includes(b.type)) continue;
        const c = Math.cos(b.rot || 0), s = Math.sin(b.rot || 0);
        const hw = b.w / 2 + 1.6, hd = b.d / 2 + 1.6;
        const per = 2 * (hw + hd) * 2;
        const n = Math.round(per / 2.4);
        for (let i = 0; i < n; i++) {
          const t = i / n * 4;
          let lx, lz;
          if (t < 1) { lx = -hw + 2 * hw * t; lz = -hd; } else if (t < 2) { lx = hw; lz = -hd + 2 * hd * (t - 1); } else if (t < 3) { lx = hw - 2 * hw * (t - 2); lz = hd; } else { lx = -hw; lz = hd - 2 * hd * (t - 3); }
          if (lz > 0 && Math.abs(lx) < b.w * 0.28) continue; // keep the front entrance clear
          if (rnd() > 0.6) continue;
          const x = b.x + lx * c + lz * s, z = b.z - lx * s + lz * c;
          tryPut(x + (rnd() - 0.5) * 0.6, z + (rnd() - 0.5) * 0.6, 0.75 + rnd() * 0.5, rnd() < 0.35);
        }
      }
      // plaza ring
      if (L.plaza) for (let a = 0; a < TAU; a += 0.21) {
        if (rnd() > 0.7) continue;
        const r = L.plaza.r + 2.0 + rnd() * 1.4;
        tryPut(L.plaza.x + Math.sin(a) * r, L.plaza.z + Math.cos(a) * r, 0.7 + rnd() * 0.4, rnd() < 0.5);
      }
      // garden shrubs on the waterfall mound
      for (const p of L.ponds || []) {
        if (!p.waterfall) continue;
        const w = p.waterfall; let fx = p.x - w.x, fz = p.z - w.z; const fl = Math.hypot(fx, fz) || 1; fx /= fl; fz /= fl;
        for (let i = 0; i < 16; i++) {
          const lf = -1.2 - rnd() * 6, ls = (rnd() < 0.5 ? -1 : 1) * (2.2 + rnd() * 3.5);
          const x = w.x + fx * lf - fz * ls, z = w.z + fz * lf + fx * ls;
          if (H(x, z) < 0.2 || vegBlocked(x, z, 0.4, 'shrub')) continue;
          const it = { x, y: H(x, z) - 0.08, z, s: 0.65 + rnd() * 0.5, sy: 0.85 + rnd() * 0.3, rot: rnd() * TAU, color: hsl(0.27 + (rnd() - 0.5) * 0.05, 0.42, 0.24 + rnd() * 0.07) };
          if (rnd() < 0.4) { it.flowerColor = FLOWER_COLS[Math.floor(rnd() * FLOWER_COLS.length)]; flower.push(it); } else green.push(it);
        }
      }
      // pond rims & flower beds
      for (const p of L.ponds || []) for (let a = 0; a < TAU; a += 0.32) {
        if (rnd() > 0.55) continue;
        const r = p.r + 2.2 + rnd() * 1.8;
        tryPut(p.x + Math.sin(a) * r, p.z + Math.cos(a) * r, 0.7 + rnd() * 0.5, rnd() < 0.4);
      }
      for (const fb of L.flowerBeds || []) for (let a = 0; a < TAU; a += 0.5) {
        if (rnd() > 0.5) continue;
        const r = fb.r + 0.9 + rnd() * 0.5;
        tryPut(fb.x + Math.sin(a) * r, fb.z + Math.cos(a) * r, 0.6 + rnd() * 0.3, rnd() < 0.5);
      }
      // stone walls
      for (const w of L.stoneWalls || []) {
        const len = Math.hypot(w[2] - w[0], w[3] - w[1]); const n = Math.floor(len / 2.4);
        const nx = -(w[3] - w[1]) / (len || 1), nz = (w[2] - w[0]) / (len || 1);
        for (let i = 0; i <= n; i++) for (const side of [-1, 1]) {
          if (rnd() > 0.45) continue;
          const t = n ? i / n : 0.5;
          tryPut(w[0] + (w[2] - w[0]) * t + nx * side * 1.3, w[1] + (w[3] - w[1]) * t + nz * side * 1.3, 0.65 + rnd() * 0.4, rnd() < 0.3);
        }
      }
      // forest edge undergrowth + meadow clusters
      for (let i = 0; i < 900; i++) {
        const x = BOX.minX + rnd() * (BOX.maxX - BOX.minX), z = BOX.minZ + rnd() * (BOX.maxZ - BOX.minZ);
        const mh = mountainH(x, z);
        const edge = mh > 0.1 && mh < 3;
        if (!edge && rnd() > 0.12) continue;
        const nCl = edge ? 1 + Math.floor(rnd() * 3) : 1 + Math.floor(rnd() * 2);
        for (let k = 0; k < nCl; k++) tryPut(x + (rnd() - 0.5) * 3, z + (rnd() - 0.5) * 3, 0.7 + rnd() * 0.7, !edge && rnd() < 0.3);
      }
      // flowering shrubs: instance colour = leaf colour; blossom colour baked per mesh variant
      const grp = new THREE.Group(); grp.name = 'shrubs';
      const shadows = !!preset.shadows;
      const mg = makeInstanced(geoGreen, mat, green, { shadow: shadows, name: 'shrubs-green' });
      if (mg) grp.add(mg);
      // one mesh per blossom colour (vertex colour of flowers is white -> recolour per variant)
      const byCol = new Map();
      for (const it of flower) { if (!byCol.has(it.flowerColor)) byCol.set(it.flowerColor, []); byCol.get(it.flowerColor).push(it); }
      for (const [col, list] of byCol) {
        const g = geoFlower.clone();
        const fol = g.attributes.aFoliage, cc = g.attributes.color, fc = new THREE.Color(col);
        for (let i = 0; i < fol.count; i++) if (fol.getX(i) < 0.5) cc.setXYZ(i, fc.r * (0.85 + (i % 7) * 0.03), fc.g * (0.85 + (i % 5) * 0.03), fc.b);
        const m = makeInstanced(g, mat, list, { shadow: shadows, name: 'shrubs-flower' });
        if (m) grp.add(m);
      }
      root.add(grp);
      this.meshes.shrubs = grp;
      for (const c of colliders) G.world.addCollider({ shape: 'circle', x: c.x, z: c.z, r: c.r, tag: 'shrub', maxY: H(c.x, c.z) + 0.55 });
      this.counts.shrubs = green.length + flower.length;
    },

    // ============================================================== wildflowers & flower beds
    _buildFlowers(root, preset) {
      const rnd = G.util.rng(5150);
      const geo = buildFlower(G.util.rng(41));
      const mat = vegMaterial('flower', { sway: 0.25, flutter: 0.004, side: THREE.DoubleSide, noFlip: true });
      const list = [];
      const WILD = ['#ffffff', '#ffe066', '#c9a2f0', '#ff9ec6', '#ffb347', '#a8c8ff'];
      const n = Math.round((preset.name === 'low' ? 700 : preset.name === 'medium' ? 1700 : 2600));
      for (let i = 0, tries = 0; i < n && tries < n * 6; tries++) {
        const x = BOX.minX + rnd() * (BOX.maxX - BOX.minX), z = BOX.minZ + rnd() * (BOX.maxZ - BOX.minZ);
        const patch = N2(x / 22 + 5, z / 22 - 8);
        if (patch < 0.12 && rnd() > 0.08) continue;
        if (surfaceAt(x, z) !== 'grass') continue;
        if (mountainH(x, z) > 2.5) continue;
        if (vegBlocked(x, z, 0.15, 'shrub')) continue;
        const ci = Math.floor((N2(x / 9, z / 9) * 0.5 + 0.5) * WILD.length * 1.6 + rnd() * 1.2) % WILD.length;
        const c = new THREE.Color(WILD[ci]).multiplyScalar(0.85 + rnd() * 0.2);
        list.push({ x, y: H(x, z) - 0.02, z, s: 0.6 + rnd() * 0.6, rot: rnd() * TAU, tiltX: (rnd() - 0.5) * 0.3, tiltZ: (rnd() - 0.5) * 0.3, color: c });
        i++;
      }
      // flower beds: dense blooms + low leafy mounds (never on paths/decks that cross a bed)
      const onPath = (x, z, pad) => {
        const sf = surfaceAt(x, z);
        if (sf !== 'grass' && sf !== 'dirt' && sf !== 'sand') return true;
        return TR()?.pathDistance ? TR().pathDistance(x, z) < pad : false;
      };
      const leafy = [];
      for (const fb of L.flowerBeds || []) {
        const cols = (fb.colors && fb.colors.length) ? fb.colors : ['#ff7eb6', '#ffffff'];
        const count = Math.round(PI * fb.r * fb.r * 6.5);
        for (let i = 0; i < count; i++) {
          const a = rnd() * TAU, d = Math.sqrt(rnd()) * (fb.r - 0.15);
          const x = fb.x + Math.sin(a) * d, z = fb.z + Math.cos(a) * d;
          if (onPath(x, z, 0.25)) continue;
          const ring = Math.floor((d / fb.r) * cols.length * 1.3 + rnd() * 0.8) % cols.length;
          const c = new THREE.Color(cols[ring]).multiplyScalar(0.88 + rnd() * 0.2);
          list.push({ x, y: H(x, z) + 0.02, z, s: 0.8 + rnd() * 0.55 + (1 - d / fb.r) * 0.35, rot: rnd() * TAU, tiltX: (rnd() - 0.5) * 0.25, tiltZ: (rnd() - 0.5) * 0.25, color: c });
        }
        const lc = Math.round(fb.r * fb.r * 1.1);
        for (let i = 0; i < lc; i++) {
          const a = rnd() * TAU, d = Math.sqrt(rnd()) * (fb.r - 0.3);
          const x = fb.x + Math.sin(a) * d, z = fb.z + Math.cos(a) * d;
          if (onPath(x, z, 0.5)) continue;
          leafy.push({ x, y: H(x, z) - 0.05, z, s: 0.32 + rnd() * 0.2, sy: 0.75, rot: rnd() * TAU, color: hsl(0.25, 0.48, 0.32 + rnd() * 0.08) });
        }
      }
      const grp = new THREE.Group(); grp.name = 'flowers';
      const m = makeInstanced(geo, mat, list, { shadow: false, receive: true, name: 'flowers' });
      if (m) grp.add(m);
      const lm = makeInstanced(buildShrub(G.util.rng(33), false), vegMaterial('shrub', { sway: 0.02, flutter: 0.012 }), leafy, { shadow: false, name: 'flowerbed-leaves' });
      if (lm) grp.add(lm);
      root.add(grp);
      this.meshes.flowers = grp;
      this.counts.flowers = list.length;
    },

    // ============================================================== grass (GPU, wraps around the camera)
    _buildGrass(root, preset) {
      const dens = preset.grassDensity ?? 0.5;
      const terr = TR();
      if (dens <= 0 || !terr?.uniforms) { this.counts.grass = 0; return; }
      const TSIZE = 76;
      const count = Math.round(TSIZE * TSIZE * 2.3 * dens);
      // tuft: 5 curved blades, 3 tris each
      const rnd = G.util.rng(6060);
      const pos = [], blade = [];
      const BL = 5;
      for (let b = 0; b < BL; b++) {
        const a = rnd() * TAU, off = rnd() * 0.14, h = 0.34 + rnd() * 0.32, w = 0.04 + rnd() * 0.022;
        const bx = Math.sin(a) * off, bz = Math.cos(a) * off;
        const fa = rnd() * TAU, fx = Math.cos(fa), fz = -Math.sin(fa);     // blade facing (width direction)
        const lean = 0.08 + rnd() * 0.12, lx = Math.sin(a) * lean, lz = Math.cos(a) * lean;
        const P = (t, side) => [bx + fx * w * side * (1 - t) + lx * t * t, h * t, bz + fz * w * side * (1 - t) + lz * t * t];
        const v0 = P(0, -1), v1 = P(0, 1), v2 = P(0.5, -1), v3 = P(0.5, 1), v4 = P(1, 0);
        pos.push(...v0, ...v1, ...v2, ...v1, ...v3, ...v2, ...v2, ...v3, ...v4);
        blade.push(0, 0, 0.5, 0, 0.5, 0.5, 0.5, 0.5, 1);
      }
      const base = new THREE.BufferGeometry();
      base.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      base.setAttribute('aBlade', new THREE.Float32BufferAttribute(blade, 1));
      base.computeVertexNormals();
      const geo = new THREE.InstancedBufferGeometry();
      geo.index = null;
      geo.setAttribute('position', base.attributes.position);
      geo.setAttribute('normal', base.attributes.normal);
      geo.setAttribute('aBlade', base.attributes.aBlade);
      const off = new Float32Array(count * 4);
      for (let i = 0; i < count; i++) { off[i * 4] = rnd() * TSIZE; off[i * 4 + 1] = rnd() * TSIZE; off[i * 4 + 2] = rnd() * TAU; off[i * 4 + 3] = rnd(); }
      geo.setAttribute('aOff', new THREE.InstancedBufferAttribute(off, 4));
      geo.instanceCount = count;
      geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
      const gu = { uGrassCenter: { value: new THREE.Vector2() }, uGrassT: { value: TSIZE }, uPlayer: { value: new THREE.Vector2(9999, 9999) } };
      this._grassUniforms = gu;
      const mat = new THREE.MeshLambertMaterial({ side: THREE.DoubleSide });
      mat.onBeforeCompile = (sh) => {
        Object.assign(sh.uniforms, terr.uniforms, gu, { uTime: uniforms.uTime, uWind: uniforms.uWind, uWindStrength: uniforms.uWindStrength, uGustPos: uniforms.uGustPos, uGustAmt: uniforms.uGustAmt });
        sh.vertexShader = sh.vertexShader
          .replace('#include <common>', `#include <common>
            attribute vec4 aOff; attribute float aBlade;
            uniform vec2 uGrassCenter; uniform float uGrassT; uniform vec2 uPlayer;
            uniform float uTime; uniform vec2 uWind; uniform float uWindStrength; uniform vec2 uGustPos; uniform float uGustAmt;
            uniform sampler2D tTerrColor; uniform sampler2D tGrassMask;
            varying vec3 vGrassCol;
            ${terr.glslTerrain}
            ${GLSL_NOISE}`)
          .replace('#include <beginnormal_vertex>', 'vec3 objectNormal = vec3(0.0, 1.0, 0.0);')
          .replace('#include <begin_vertex>', `
            vec2 tfC = uGrassCenter - uGrassT * 0.5;
            vec2 tfP = tfC + mod(aOff.xy - tfC, uGrassT);
            vec2 tfUv = (tfP - uTerrBox.x) / uTerrBox.y;
            float tfMask = (tfUv.x <= 0.0 || tfUv.y <= 0.0 || tfUv.x >= 1.0 || tfUv.y >= 1.0) ? 0.0 : texture2D(tGrassMask, tfUv).r;
            float tfDist = distance(tfP, cameraPosition.xz);
            float tfFade = 1.0 - smoothstep(uGrassT * 0.28, uGrassT * 0.47, tfDist);
            float tfScale = (0.68 + fract(aOff.w * 13.71) * 0.62) * smoothstep(aOff.w - 0.12, aOff.w + 0.02, tfMask) * tfFade;
            float tfCs = cos(aOff.z), tfSn = sin(aOff.z);
            vec3 tfL = position * tfScale;
            tfL.xz = vec2(tfCs * tfL.x - tfSn * tfL.z, tfSn * tfL.x + tfCs * tfL.z);
            float tfWave = sin(uTime * 1.9 + dot(tfP, vec2(0.21, 0.13))) * 0.45 + sin(uTime * 3.3 + tfP.x * 0.47) * 0.15 + (tfNoise(tfP * 0.045 + uTime * 0.18) - 0.5) * 1.1;
            // gust waves rolling across the meadow (bend + a silvery sheen on the bent blades)
            float tfGust = uGustAmt > 0.001 ? smoothstep(0.42, 0.92, tfNoise(tfP * 0.05 - uGustPos * 0.05)) * uWindStrength * uGustAmt : 0.0;
            tfWave += tfGust * 1.6;
            tfL.xz += uWind * tfWave * aBlade * aBlade * 0.14 * uWindStrength * tfScale;
            vec2 tfD = tfP - uPlayer; float tfPd = length(tfD);
            float tfPush = 1.0 - smoothstep(0.25, 1.15, tfPd);
            tfL.xz += (tfD / max(tfPd, 0.01)) * tfPush * aBlade * 0.32 * tfScale;
            tfL.y *= 1.0 - tfPush * 0.5;
            vec3 transformed = vec3(tfP.x, terrainH(tfP) - 0.02, tfP.y) + tfL;
            vec2 tfCuv = clamp(tfUv, 0.0, 1.0);
            vec3 tfG = texture2D(tTerrColor, (tfCuv * (uTerrN.x - 1.0) + 0.5) / uTerrN.x).rgb;
            tfG *= tfG;
            float tfVar = 0.88 + fract(aOff.w * 7.13) * 0.24;
            vGrassCol = mix(tfG * 0.72, tfG * 1.28 + vec3(0.025, 0.03, 0.0), aBlade) * tfVar * (1.0 + tfGust * aBlade * 0.22);
          `);
        sh.fragmentShader = sh.fragmentShader
          .replace('#include <common>', '#include <common>\nvarying vec3 vGrassCol;')
          .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= vGrassCol;')
          .replace('#include <normal_fragment_begin>', THREE.ShaderChunk.normal_fragment_begin.replace('normal *= faceDirection;', ''));
      };
      mat.customProgramCacheKey = () => 'nat-grass2';
      const mesh = new THREE.Mesh(geo, mat);
      mesh.frustumCulled = false;
      mesh.receiveShadow = !!preset.shadows;
      mesh.castShadow = false;
      mesh.name = 'grass';
      mesh.raycast = () => {};
      root.add(mesh);
      this.meshes.grass = mesh;
      this.counts.grass = count;
    },

    // ============================================================== clouds
    _buildClouds(scene, preset) {
      const tex = G.gfx.canvasTexture(512, 512, (ctx) => {
        const r = G.util.rng(808);
        for (let v = 0; v < 4; v++) {
          const ox = (v % 2) * 256, oy = Math.floor(v / 2) * 256;
          ctx.save(); ctx.beginPath(); ctx.rect(ox, oy, 256, 256); ctx.clip();
          const puffs = 26 + Math.floor(r() * 10);
          for (let i = 0; i < puffs; i++) {
            const t = r();
            const px = ox + 40 + t * 176, spread = Math.sin(t * PI);
            const py = oy + 150 - spread * (30 + r() * 45) + (r() - 0.5) * 20;
            const rad = 18 + spread * (26 + r() * 22);
            const g = ctx.createRadialGradient(px, py, rad * 0.1, px, py, rad);
            g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.62, 'rgba(255,255,255,0.92)'); g.addColorStop(0.85, 'rgba(255,255,255,0.35)'); g.addColorStop(1, 'rgba(255,255,255,0)');
            ctx.fillStyle = g; ctx.beginPath(); ctx.arc(px, py, rad, 0, TAU); ctx.fill();
          }
          // shade the underside
          ctx.globalCompositeOperation = 'source-atop';
          const sg = ctx.createLinearGradient(0, oy + 70, 0, oy + 200);
          sg.addColorStop(0, 'rgba(255,255,255,0)'); sg.addColorStop(1, 'rgba(120,132,150,0.75)');
          ctx.fillStyle = sg; ctx.fillRect(ox, oy, 256, 256);
          ctx.restore();
          ctx.globalCompositeOperation = 'source-over';
        }
      });
      const count = preset.name === 'low' ? 30 : preset.name === 'medium' ? 46 : 56;
      const rnd = G.util.rng(1717);
      const DOMAIN = 1500;
      const geo = new THREE.InstancedBufferGeometry();
      const plane = new THREE.PlaneGeometry(1, 1);
      geo.index = plane.index; geo.setAttribute('position', plane.attributes.position); geo.setAttribute('uv', plane.attributes.uv);
      const a1 = new Float32Array(count * 4), a2 = new Float32Array(count * 4);
      for (let i = 0; i < count; i++) {
        const ang = rnd() * TAU, rad = 120 + Math.sqrt(rnd()) * (DOMAIN - 400);
        a1[i * 4] = Math.sin(ang) * rad; a1[i * 4 + 1] = 210 + rnd() * 130; a1[i * 4 + 2] = Math.cos(ang) * rad; a1[i * 4 + 3] = 80 + rnd() * 110;
        a2[i * 4] = Math.floor(rnd() * 4); a2[i * 4 + 1] = (i + 0.5) / count; a2[i * 4 + 2] = 1.6 + rnd() * 0.8; a2[i * 4 + 3] = rnd();
      }
      // shuffle ranks so cover fills the sky evenly
      for (let i = count - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const t = a2[i * 4 + 1]; a2[i * 4 + 1] = a2[j * 4 + 1]; a2[j * 4 + 1] = t; }
      geo.setAttribute('aCloud', new THREE.InstancedBufferAttribute(a1, 4));
      geo.setAttribute('aInfo', new THREE.InstancedBufferAttribute(a2, 4));
      geo.instanceCount = count;
      geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
      const mat = new THREE.ShaderMaterial({
        uniforms: {
          map: { value: tex }, uOffset: { value: new THREE.Vector2(0, 0) }, uDomain: { value: DOMAIN },
          uCover: { value: this._cloudCover }, uTint: { value: this._cloudTint.clone() },
          uVeil: { value: this._cloudVeil }, uVeilCol: { value: this._cloudVeilCol.clone() },
          uSunCol: { value: new THREE.Color(1, 1, 1) }, uAmb: { value: new THREE.Color(0.8, 0.85, 0.95) }, uSunDir: { value: new THREE.Vector3(0, 1, 0) },
        },
        vertexShader: `
          attribute vec4 aCloud; attribute vec4 aInfo;
          uniform vec2 uOffset; uniform float uDomain; uniform float uCover; uniform vec3 uSunDir;
          varying vec2 vUv; varying float vAlpha; varying float vSunSide; varying float vDense; varying float vFwd;
          void main() {
            vec3 c = aCloud.xyz;
            c.xz += uOffset;
            c.xz = mod(c.xz + uDomain, 2.0 * uDomain) - uDomain;
            float dense = smoothstep(0.55, 1.0, uCover);
            float size = aCloud.w * (1.0 + dense * 0.6);
            vec4 mv = viewMatrix * vec4(c, 1.0);
            mv.xy += position.xy * vec2(size * aInfo.z, size);
            gl_Position = projectionMatrix * mv;
            float vi = aInfo.x;
            vUv = vec2(uv.x * 0.5 + mod(vi, 2.0) * 0.5, uv.y * 0.5 + (1.0 - floor(vi / 2.0)) * 0.5);
            float cover = smoothstep(aInfo.y - 0.1, aInfo.y + 0.02, uCover);
            vec3 dv = c - cameraPosition; float dvl = length(dv);
            vec3 dir = dvl > 1e-4 ? dv / dvl : vec3(0.0, 1.0, 0.0);
            float horizon = smoothstep(0.01, 0.1, dir.y);
            float edge = 1.0 - smoothstep(uDomain * 0.78, uDomain * 0.98, length(c.xz));
            vAlpha = cover * horizon * edge;
            vec3 sv = (viewMatrix * vec4(uSunDir, 0.0)).xyz; float svl = length(sv);
            sv = svl > 1e-5 ? sv / svl : vec3(0.0, 1.0, 0.0);
            vSunSide = dot(normalize(vec3(position.x, position.y, 0.3)), sv) * 0.5 + 0.5;
            vDense = dense;
            // forward scattering: clouds near the sun glow (silver lining) instead of reading as grey smudges
            float sl = length(uSunDir);
            vFwd = sl > 1e-5 ? pow(max(dot(dir, uSunDir / sl), 0.0), 5.0) : 0.0;
          }`,
        fragmentShader: `
          uniform sampler2D map; uniform vec3 uTint; uniform vec3 uSunCol; uniform vec3 uAmb; uniform float uVeil; uniform vec3 uVeilCol;
          varying vec2 vUv; varying float vAlpha; varying float vSunSide; varying float vDense; varying float vFwd;
          void main() {
            vec4 t = texture2D(map, vUv);
            float a = t.a * vAlpha * (0.9 + vDense * 0.1);
            if (a < 0.003) discard;
            vec3 base = t.rgb;
            base = mix(base, base * vec3(0.72, 0.76, 0.82), vDense * 0.6);
            vec3 col = base * (uAmb + uSunCol * (0.55 + 0.45 * vSunSide)) * uTint;
            col += uSunCol * vFwd * (1.2 + 2.6 * (1.0 - t.a)) * (1.0 - vDense * 0.7);
            col = mix(col, uVeilCol * (0.92 + 0.12 * t.r), uVeil);
            a *= 1.0 - uVeil * 0.45;
            gl_FragColor = vec4(col, a);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
          }`,
        transparent: true, depthWrite: false, fog: false,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.frustumCulled = false;
      mesh.renderOrder = -4;
      mesh.name = 'clouds';
      mesh.raycast = () => {};
      scene.add(mesh);
      this.meshes.clouds = mesh;
      this._cloudMat = mat;
      this.counts.clouds = count;
    },

    // ============================================================== birds
    _buildBirds(root) {
      const rnd = G.util.rng(3131);
      const pos = [], wing = [];
      const tri = (a, b, c, wa, wb, wc) => { pos.push(...a, ...b, ...c); wing.push(wa, wb, wc); };
      // body
      tri([0, 0, 0.32], [0.06, 0, -0.05], [-0.06, 0, -0.05], 0, 0, 0);
      tri([0.06, 0, -0.05], [0, 0, -0.32], [-0.06, 0, -0.05], 0, 0, 0);
      tri([0, 0.04, 0.1], [0.05, 0, -0.05], [-0.05, 0, -0.05], 0, 0, 0);
      // wings (inner + outer section)
      for (const s of [-1, 1]) {
        tri([0.05 * s, 0, 0.09], [0.32 * s, 0, 0.05], [0.05 * s, 0, -0.08], 0, 0.5, 0);
        tri([0.32 * s, 0, 0.05], [0.62 * s, 0, -0.08], [0.05 * s, 0, -0.08], 0.5, 1, 0);
        tri([0.32 * s, 0, 0.05], [0.66 * s, 0, -0.02], [0.62 * s, 0, -0.08], 0.5, 1, 1);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute('aWing', new THREE.Float32BufferAttribute(wing, 1));
      geo.computeVertexNormals();
      const mat = new THREE.MeshLambertMaterial({ color: 0x2f2a26, side: THREE.DoubleSide });
      mat.onBeforeCompile = (sh) => {
        sh.uniforms.uTime = uniforms.uTime;
        sh.vertexShader = sh.vertexShader
          .replace('#include <common>', '#include <common>\nattribute float aWing;\nuniform float uTime;')
          .replace('#include <begin_vertex>', `#include <begin_vertex>
            #ifdef USE_INSTANCING
              float tfPh = instanceMatrix[3][0] * 0.37 + instanceMatrix[3][2] * 0.21;
            #else
              float tfPh = 0.0;
            #endif
            float tfGlide = smoothstep(-0.3, 0.4, sin(uTime * 0.6 + tfPh * 3.0));
            float tfFlap = sin(uTime * 11.0 + tfPh * 5.0) * tfGlide + (1.0 - tfGlide) * 0.18;
            transformed.y += tfFlap * aWing * 0.42;
            transformed.x *= 1.0 - abs(tfFlap) * aWing * 0.18;`);
      };
      mat.customProgramCacheKey = () => 'nat-bird';
      const count = 11;
      const mesh = new THREE.InstancedMesh(geo, mat, count);
      mesh.frustumCulled = false;
      mesh.name = 'birds';
      mesh.raycast = () => {};
      this._birds = [];
      for (let i = 0; i < count; i++) this._birds.push({ ox: (rnd() - 0.5) * 16, oy: (rnd() - 0.5) * 5, oz: (rnd() - 0.5) * 16, ph: rnd() * TAU, sp: 0.8 + rnd() * 0.4 });
      root.add(mesh);
      this.meshes.birds = mesh;
      this._updateBirds(0);
    },
    _updateBirds(t) {
      const mesh = this.meshes.birds;
      if (!mesh) return;
      const night = G.world.nightFactor || 0;
      const vis = 1 - smooth(0.45, 0.75, night);
      mesh.visible = vis > 0.01;
      if (!mesh.visible) return;
      const w = 0.045;
      const cx = 25 + Math.cos(t * w) * 70, cz = -15 + Math.sin(t * w * 1.3) * 55, cy = 42 + Math.sin(t * 0.21) * 7;
      const vx = -Math.sin(t * w) * 70 * w, vz = Math.cos(t * w * 1.3) * 55 * w * 1.3;
      const head = Math.atan2(vx, vz);
      for (let i = 0; i < this._birds.length; i++) {
        const b = this._birds[i];
        const wob = Math.sin(t * b.sp + b.ph);
        _p.set(cx + b.ox + Math.sin(t * 0.7 + b.ph) * 2.5, cy + b.oy + wob * 1.2, cz + b.oz + Math.cos(t * 0.6 + b.ph) * 2.5);
        _e.set(wob * 0.08, head + Math.sin(t * 0.5 + b.ph) * 0.15, Math.cos(t * 0.45 + b.ph) * 0.25);
        _q.setFromEuler(_e);
        _s.setScalar(1.5 * vis);
        _m.compose(_p, _q, _s);
        mesh.setMatrixAt(i, _m);
      }
      mesh.instanceMatrix.needsUpdate = true;
    },

    // ============================================================== butterflies
    _buildButterflies(root) {
      const beds = (L.flowerBeds || []).slice();
      if (!beds.length) return;
      const rnd = G.util.rng(2525);
      const pos = [], wing = [];
      for (const s of [-1, 1]) {
        // upper + lower wing
        pos.push(0, 0, 0.01, 0.1 * s, 0, 0.06, 0.09 * s, 0, -0.01, 0, 0, 0.01, 0.09 * s, 0, -0.01, 0.0, 0, -0.01);
        pos.push(0, 0, -0.005, 0.075 * s, 0, -0.02, 0.05 * s, 0, -0.075, 0, 0, -0.005, 0.05 * s, 0, -0.075, 0, 0, -0.03);
        wing.push(0, 1, 1, 0, 1, 0, 0, 1, 1, 0, 1, 0);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute('aWing', new THREE.Float32BufferAttribute(wing, 1));
      geo.computeVertexNormals();
      const mat = new THREE.MeshLambertMaterial({ side: THREE.DoubleSide, emissive: 0x222222 });
      mat.onBeforeCompile = (sh) => {
        sh.uniforms.uTime = uniforms.uTime;
        sh.vertexShader = sh.vertexShader
          .replace('#include <common>', '#include <common>\nattribute float aWing;\nuniform float uTime;')
          .replace('#include <begin_vertex>', `#include <begin_vertex>
            #ifdef USE_INSTANCING
              float tfPh = instanceMatrix[3][0] * 3.7 + instanceMatrix[3][2] * 2.1;
            #else
              float tfPh = 0.0;
            #endif
            float tfA = (sin(uTime * 17.0 + tfPh) * 0.5 + 0.5) * 1.25;
            float tfD = abs(position.x);
            transformed.x = sign(position.x) * tfD * cos(tfA);
            transformed.y = tfD * sin(tfA);`);
      };
      mat.customProgramCacheKey = () => 'nat-butterfly';
      const COLS = ['#ffffff', '#ffe25a', '#ff9a3c', '#9fd0ff', '#f6f0d8'];
      const per = 3, count = beds.length * per;
      const mesh = new THREE.InstancedMesh(geo, mat, count);
      this._flies = [];
      for (let i = 0; i < count; i++) {
        const bed = beds[Math.floor(i / per)];
        this._flies.push({ bx: bed.x, bz: bed.z, r: bed.r + 0.6, a1: 0.35 + rnd() * 0.4, a2: 0.28 + rnd() * 0.35, p1: rnd() * TAU, p2: rnd() * TAU, ph: rnd() * TAU });
        mesh.setColorAt(i, new THREE.Color(COLS[Math.floor(rnd() * COLS.length)]));
      }
      mesh.frustumCulled = false; mesh.name = 'butterflies'; mesh.raycast = () => {};
      root.add(mesh);
      this.meshes.butterflies = mesh;
      this._updateButterflies(0);
    },
    _updateButterflies(t) {
      const mesh = this.meshes.butterflies;
      if (!mesh) return;
      const night = G.world.nightFactor || 0;
      const vis = 1 - smooth(0.2, 0.5, night);
      mesh.visible = vis > 0.01;
      if (!mesh.visible) return;
      for (let i = 0; i < this._flies.length; i++) {
        const f = this._flies[i];
        const a = t * f.a1 + f.p1, b = t * f.a2 * 1.3 + f.p2;
        const x = f.bx + Math.sin(a) * f.r * 0.8 + Math.sin(t * 2.1 + f.ph) * 0.25;
        const z = f.bz + Math.cos(b) * f.r * 0.8 + Math.cos(t * 1.7 + f.ph) * 0.25;
        const dx = Math.cos(a) * f.a1, dz = -Math.sin(b) * f.a2 * 1.3;
        _p.set(x, H(x, z) + 0.55 + Math.sin(t * 1.3 + f.ph) * 0.3 + Math.abs(Math.sin(t * 3.1 + f.ph)) * 0.12, z);
        _e.set(0.25, Math.atan2(dx, dz), Math.sin(t * 2 + f.ph) * 0.2);
        _q.setFromEuler(_e);
        _s.setScalar(1.6 * vis);
        _m.compose(_p, _q, _s);
        mesh.setMatrixAt(i, _m);
      }
      mesh.instanceMatrix.needsUpdate = true;
    },

    // ============================================================== fireflies
    _buildFireflies(root, preset) {
      const count = preset.name === 'low' ? 60 : preset.name === 'medium' ? 100 : 150;
      const rnd = G.util.rng(1212);
      const pos = new Float32Array(count * 3), seed = new Float32Array(count);
      const line = TR()?.riverLine || [];
      const spots = [];
      for (const p of L.ponds || []) spots.push({ x: p.x, z: p.z, r: p.r + 6 });
      const rest = (G.data.zones || []).find((z) => z.id === 'ZONE_REST');
      if (rest) spots.push({ x: rest.center[0], z: rest.center[1], r: rest.r * 0.8 });
      for (let i = 0; i < count; i++) {
        let x = 0, z = 0;
        if (rnd() < 0.55 && line.length) {
          for (let k = 0; k < 20; k++) {
            const q = line[Math.floor(rnd() * line.length)];
            if (q[1] < -110 || q[1] > 140) continue;
            x = q[0] - (RIVER_HW + 2 + rnd() * 12); z = q[1] + (rnd() - 0.5) * 6;
            break;
          }
        } else if (spots.length) {
          const s = spots[Math.floor(rnd() * spots.length)];
          const a = rnd() * TAU, d = Math.sqrt(rnd()) * s.r;
          x = s.x + Math.sin(a) * d; z = s.z + Math.cos(a) * d;
        }
        pos[i * 3] = x; pos[i * 3 + 1] = Math.max(H(x, z), WATER_Y) + 0.5 + rnd() * 1.8; pos[i * 3 + 2] = z;
        seed[i] = rnd();
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
      geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
      const mat = new THREE.ShaderMaterial({
        uniforms: { uTime: uniforms.uTime, uNight: uniforms.uNight, uScale: { value: 1 } },
        vertexShader: `
          attribute float aSeed; uniform float uTime; uniform float uNight; uniform float uScale;
          varying float vA;
          void main() {
            float s = aSeed * 43.0;
            vec3 p = position + vec3(sin(uTime * 0.31 + s) * 1.3, sin(uTime * 0.53 + s * 1.7) * 0.45, cos(uTime * 0.27 + s * 2.3) * 1.3);
            vec4 mv = modelViewMatrix * vec4(p, 1.0);
            float blink = smoothstep(0.35, 1.0, sin(uTime * (1.2 + aSeed) + s * 3.0) * 0.5 + 0.5);
            vA = blink * uNight;
            gl_PointSize = uScale * (0.35 + blink * 0.65) * 40.0 * (10.0 / max(1.0, -mv.z));
            gl_Position = projectionMatrix * mv;
          }`,
        fragmentShader: `
          varying float vA;
          void main() {
            float d = length(gl_PointCoord - 0.5);
            float a = smoothstep(0.5, 0.0, d);
            a = a * a * vA;
            if (a < 0.004) discard;
            gl_FragColor = vec4(vec3(0.78, 1.0, 0.42) * a * 1.6, a);
          }`,
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      });
      const pts = new THREE.Points(geo, mat);
      pts.frustumCulled = false; pts.name = 'fireflies'; pts.raycast = () => {};
      pts.visible = false;
      root.add(pts);
      this.meshes.fireflies = pts;
      this._fireflyMat = mat;
      this.counts.fireflies = count;
      G.sys.engine?.onResize?.(() => { mat.uniforms.uScale.value = (G.sys.engine.renderer.getPixelRatio() || 1) * (window.innerHeight / 900); });
      mat.uniforms.uScale.value = (G.sys.engine.renderer.getPixelRatio() || 1) * (window.innerHeight / 900);
    },

    // ============================================================== phase-4 atmosphere (lazy, preset-gated)
    _ensureAtmos() {
      const E = G.sys.engine;
      if (!E?.scene || !this.root) return;
      const want = (f) => (typeof E.feature === 'function' ? E.feature(f) : false);
      try { if (want('petals') && !this.meshes.petals) this._buildPetals(this.root); } catch (e) { G.log.warn('WORLD', 'petals failed', e); }
      try { if (want('mist') && !this.meshes.mist) this._buildMist(E.scene); } catch (e) { G.log.warn('WORLD', 'mist failed', e); }
      try { if (!this.meshes.nightFlies && (E.preset?.atmos ?? 0) >= 1) this._buildNightFlies(this.root); } catch (e) { G.log.warn('WORLD', 'fireflies near the player failed', e); }
      this._petalsOn = want('petals');
      this._mistOn = want('mist');
    },

    /** petals & leaves: GPU points in a camera-following box; positions are world-stable and wrap at the box edges */
    _buildPetals(root) {
      const high = (G.sys.engine?.preset?.atmos ?? 1) >= 2;
      const count = high ? 420 : 220;
      const rnd = G.util.rng(8128);
      const seed = new Float32Array(count * 4), kind = new Float32Array(count);
      for (let i = 0; i < count; i++) {
        seed[i * 4] = rnd(); seed[i * 4 + 1] = rnd(); seed[i * 4 + 2] = rnd(); seed[i * 4 + 3] = rnd();
        kind[i] = rnd(); // < 0.62 petal (pink / white), < 0.85 green leaf, else golden leaf
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
      geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
      geo.setAttribute('aKind', new THREE.BufferAttribute(kind, 1));
      geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
      const mat = new THREE.ShaderMaterial({
        uniforms: {
          uTime: uniforms.uTime, uWind: uniforms.uWind, uWindStrength: uniforms.uWindStrength,
          uCenter: { value: new THREE.Vector3() }, uBox: { value: new THREE.Vector3(56, 20, 56) },
          uScale: { value: 600 }, uAmount: { value: 0 }, uLight: { value: new THREE.Color(1, 1, 1) },
        },
        vertexShader: `
          attribute vec4 aSeed; attribute float aKind;
          uniform float uTime; uniform vec2 uWind; uniform float uWindStrength; uniform vec3 uCenter; uniform vec3 uBox; uniform float uScale; uniform float uAmount;
          varying float vA; varying float vSpin; varying vec3 vCol;
          void main() {
            if (aSeed.w > uAmount) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; vA = 0.0; vSpin = 0.0; vCol = vec3(0.0); return; }
            float drift = (0.55 + aSeed.w * 0.7) * (0.35 + uWindStrength * 0.65);
            vec3 p = aSeed.xyz * uBox + vec3(uWind.x * drift, -(0.32 + aSeed.x * 0.3), uWind.y * drift) * uTime;
            p += vec3(sin(uTime * 1.3 + aSeed.y * 40.0), sin(uTime * 2.1 + aSeed.z * 31.0) * 0.4, cos(uTime * 1.1 + aSeed.x * 27.0)) * 0.7;
            vec3 origin = uCenter - uBox * 0.5;
            p = origin + mod(p - origin, uBox);
            vec3 rel = (p - uCenter) / (uBox * 0.5);
            float edge = 1.0 - smoothstep(0.72, 1.0, max(max(abs(rel.x), abs(rel.z)), abs(rel.y)));
            vec4 mv = viewMatrix * vec4(p, 1.0);
            gl_Position = projectionMatrix * mv;
            float dist = max(0.2, -mv.z);
            float size = aKind < 0.62 ? 0.075 : 0.1;
            gl_PointSize = clamp(size * (0.75 + aSeed.y * 0.6) * uScale / dist, 1.0, 22.0);
            vA = edge * smoothstep(0.4, 1.6, dist) * (1.0 - smoothstep(24.0, 30.0, dist));
            vSpin = uTime * (1.5 + aSeed.z * 2.5) + aSeed.x * 6.283;
            vCol = aKind < 0.62 ? mix(vec3(1.0, 0.72, 0.84), vec3(1.0, 0.95, 0.96), step(0.42, aKind)) : aKind < 0.85 ? vec3(0.42, 0.66, 0.26) : vec3(0.95, 0.72, 0.28);
          }`,
        fragmentShader: `
          uniform vec3 uLight;
          varying float vA; varying float vSpin; varying vec3 vCol;
          void main() {
            vec2 q = gl_PointCoord - 0.5;
            float c = cos(vSpin), s = sin(vSpin);
            q = vec2(c * q.x - s * q.y, s * q.x + c * q.y);
            float flip = 0.35 + 0.65 * abs(sin(vSpin * 0.7));      // tumbling: the petal turns its edge to us
            float d = length(q * vec2(1.0, 2.0 / flip));
            float a = (1.0 - smoothstep(0.32, 0.46, d)) * vA;
            if (a < 0.02) discard;
            vec3 col = vCol * uLight * (0.8 + 0.2 * flip);
            gl_FragColor = vec4(col, a * 0.92);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
          }`,
        transparent: true, depthWrite: false,
      });
      const pts = new THREE.Points(geo, mat);
      pts.frustumCulled = false; pts.name = 'petals'; pts.renderOrder = 7; pts.visible = false;
      pts.raycast = () => {};
      root.add(pts);
      this.meshes.petals = pts;
      this._petalMat = mat;
      const scale = () => { const E = G.sys.engine; const fov = (E.camera?.fov || 55) * PI / 180; mat.uniforms.uScale.value = (window.innerHeight * (E.renderer.getPixelRatio() || 1) * 0.5) / Math.tan(fov / 2); };
      scale();
      G.sys.engine?.onResize?.(scale);
      this.counts.petals = count;
    },

    /** valley mist: 3 large horizontal layers outside the campus; soft where they meet the ground (GPU height) */
    _buildMist(scene) {
      const terr = TR();
      if (!terr?.uniforms || !terr.glslTerrain) return;
      const half = (terr.half || 500) - 10;
      const LAYERS = [{ y: 9, a: 0.5, sc: 0.012, sp: 1.0 }, { y: 19, a: 0.36, sc: 0.008, sp: 0.7 }, { y: 32, a: 0.24, sc: 0.006, sp: 0.5 }];
      const grp = new THREE.Group(); grp.name = 'valley-mist';
      const cx = L.plaza?.x ?? 0, cz = L.plaza?.z ?? 0;
      const mats = [];
      for (const ly of LAYERS) {
        const geo = new THREE.PlaneGeometry(half * 2, half * 2, 1, 1).rotateX(-PI / 2);
        geo.deleteAttribute('normal');
        const mat = new THREE.ShaderMaterial({
          uniforms: {
            ...terr.uniforms, ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
            uY: { value: ly.y }, uAlpha: { value: ly.a }, uScale: { value: ly.sc }, uAmount: { value: 0 },
            uDrift: { value: new THREE.Vector2() }, uCol: { value: new THREE.Color(0xd5e0e8) }, uSun: { value: new THREE.Color(0, 0, 0) },
            uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uCampus: { value: new THREE.Vector3(cx, cz, 115) },
          },
          vertexShader: `
            uniform float uY;
            varying vec3 vW;
            #include <fog_pars_vertex>
            void main() {
              vec4 w = modelMatrix * vec4(position.x, uY, position.z, 1.0);
              vW = w.xyz;
              vec4 mvPosition = viewMatrix * w;
              gl_Position = projectionMatrix * mvPosition;
              #include <fog_vertex>
            }`,
          fragmentShader: `
            uniform float uAlpha; uniform float uScale; uniform float uAmount; uniform vec2 uDrift; uniform vec3 uCol; uniform vec3 uSun; uniform vec3 uSunDir; uniform vec3 uCampus;
            varying vec3 vW;
            ${terr.glslTerrain}
            ${GLSL_NOISE}
            #include <fog_pars_fragment>
            void main() {
              // cheap rejections first (outside the valleys / inside the campus / close to the camera)
              float campus = smoothstep(uCampus.z, uCampus.z + 60.0, length(vW.xz - uCampus.xy));
              vec3 dv = vW - cameraPosition; float dist = length(dv);
              float nearFade = smoothstep(20.0, 70.0, dist);
              if (campus * nearFade < 0.003) discard;
              float below = vW.y - terrainH(vW.xz);
              float soft = smoothstep(0.0, 6.0, below) * (1.0 - smoothstep(26.0, 60.0, below) * 0.55);
              if (soft < 0.003) discard;
              vec2 p = vW.xz * uScale + uDrift;
              float n = tfNoise(p) * 0.55 + tfNoise(p * 2.13 + 7.1) * 0.3 + tfNoise(p * 4.7 - 3.3) * 0.15;
              float wisps = smoothstep(0.32, 0.78, n);
              float a = uAlpha * uAmount * wisps * soft * campus * nearFade;
              if (a < 0.003) discard;
              vec3 vd = dist > 1e-4 ? dv / dist : vec3(0.0, 0.0, 1.0);
              float fwd = pow(max(dot(vd, uSunDir), 0.0), 6.0);
              vec3 col = uCol + uSun * (0.25 + fwd * 1.4);
              gl_FragColor = vec4(col, a);
              #include <tonemapping_fragment>
              #include <colorspace_fragment>
              #include <fog_fragment>
            }`,
          transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: true,
        });
        const m = new THREE.Mesh(geo, mat);
        m.frustumCulled = false; m.renderOrder = 1; m.name = 'mist-' + ly.y; m.raycast = () => {};
        m.userData.sp = ly.sp;
        grp.add(m);
        mats.push(mat);
      }
      grp.visible = false;
      scene.add(grp);
      this.meshes.mist = grp;
      this._mistMats = mats;
      this._mistDrift = 0;
      this.counts.mist = LAYERS.length;
    },

    /** a few fireflies that always drift around the player at night (world-stable, wrap in a 26 m box) */
    _buildNightFlies(root) {
      const count = (G.sys.engine?.preset?.atmos ?? 1) >= 2 ? 70 : 40;
      const rnd = G.util.rng(9393);
      const seed = new Float32Array(count * 4);
      for (let i = 0; i < count * 4; i++) seed[i] = rnd();
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
      geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
      geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
      const mat = new THREE.ShaderMaterial({
        uniforms: { uTime: uniforms.uTime, uNight: uniforms.uNight, uCenter: { value: new THREE.Vector3() }, uGround: { value: 0 }, uScale: { value: 1 } },
        vertexShader: `
          attribute vec4 aSeed; uniform float uTime; uniform float uNight; uniform vec3 uCenter; uniform float uGround; uniform float uScale;
          varying float vA;
          void main() {
            vec3 box = vec3(26.0, 1.0, 26.0);
            vec3 p = vec3(aSeed.x, 0.0, aSeed.z) * box + vec3(sin(uTime * 0.23 + aSeed.y * 50.0), 0.0, cos(uTime * 0.19 + aSeed.w * 50.0)) * 3.0;
            vec3 origin = uCenter - box * 0.5;
            p.xz = origin.xz + mod(p.xz - origin.xz, box.xz);
            p.y = uGround + 0.45 + aSeed.y * 2.2 + sin(uTime * 0.6 + aSeed.x * 40.0) * 0.35;
            vec2 rel = (p.xz - uCenter.xz) / 13.0;
            float edge = 1.0 - smoothstep(0.7, 1.0, max(abs(rel.x), abs(rel.y)));
            vec4 mv = viewMatrix * vec4(p, 1.0);
            float blink = smoothstep(0.3, 1.0, sin(uTime * (0.9 + aSeed.w * 0.8) + aSeed.z * 20.0) * 0.5 + 0.5);
            vA = blink * uNight * edge;
            gl_PointSize = uScale * (0.4 + blink * 0.6) * 36.0 * (10.0 / max(1.0, -mv.z));
            gl_Position = projectionMatrix * mv;
          }`,
        fragmentShader: `
          varying float vA;
          void main() {
            float d = length(gl_PointCoord - 0.5);
            float a = smoothstep(0.5, 0.0, d);
            a = a * a * vA;
            if (a < 0.004) discard;
            gl_FragColor = vec4(vec3(0.8, 1.0, 0.45) * a * 1.7, a);
          }`,
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      });
      const pts = new THREE.Points(geo, mat);
      pts.frustumCulled = false; pts.name = 'fireflies-near'; pts.visible = false; pts.raycast = () => {};
      root.add(pts);
      this.meshes.nightFlies = pts;
      this._nightFlyMat = mat;
      const setScale = () => { mat.uniforms.uScale.value = (G.sys.engine.renderer.getPixelRatio() || 1) * (window.innerHeight / 900); };
      setScale();
      G.sys.engine?.onResize?.(setScale);
    },

    _updateAtmos(dt, t, night) {
      const E = G.sys.engine;
      const cam = E?.camera;
      if (!cam) return;
      const W = G.sys.weather;
      const rain = W?.precipitation?.rain || 0, snow = W?.precipitation?.snow || 0;
      // petals: day, dry weather, a little more with wind
      const pm = this.meshes.petals;
      if (pm) {
        const amt = this._petalsOn ? this._petalAmt * (1 - smooth(0.25, 0.7, night)) * (1 - smooth(0.05, 0.4, rain)) * (1 - snow) * clamp(0.55 + uniforms.uWindStrength.value * 0.35, 0, 1) : 0;
        pm.visible = amt > 0.01;
        if (pm.visible) {
          const u = this._petalMat.uniforms;
          u.uAmount.value = amt;
          const fx = -cam.matrixWorld.elements[8], fz = -cam.matrixWorld.elements[10], fl = Math.hypot(fx, fz) || 1;
          u.uCenter.value.set(cam.position.x + (fx / fl) * 16, cam.position.y + 1, cam.position.z + (fz / fl) * 16);
          const hemi = E.hemi, sun = E.sun;
          const li = (hemi ? hemi.intensity * 0.55 : 0.5) + (sun ? sun.intensity * Math.max(0, E.sunDir.y) * 0.28 : 0.4);
          u.uLight.value.setRGB(li, li, li).multiply(sun ? _c.copy(sun.color).lerp(WHITE, 0.6) : WHITE);
        }
      }
      // valley mist
      const mg = this.meshes.mist;
      if (mg) {
        const amt = this._mistOn ? this._mistAmt : 0;
        mg.visible = amt > 0.01;
        if (mg.visible) {
          this._mistDrift += dt * (0.4 + uniforms.uWindStrength.value * 0.6) * 0.035;
          const w = uniforms.uWind.value;
          const fogC = E.scene.fog ? E.scene.fog.color : this._mistCol;
          const sunUp = Math.max(0, E.sunDir.y);
          for (let i = 0; i < this._mistMats.length; i++) {
            const u = this._mistMats[i].uniforms, sp = mg.children[i].userData.sp || 1;
            u.uAmount.value = amt;
            u.uDrift.value.set(w.x * this._mistDrift * sp % 1000, w.y * this._mistDrift * sp % 1000);
            u.uCol.value.copy(fogC).lerp(this._mistCol, 0.35).multiplyScalar(0.92 + 0.12 * (1 - night));
            if (E.sun) u.uSun.value.copy(E.sun.color).multiplyScalar(E.sun.intensity * Math.sqrt(sunUp) * 0.16);
            u.uSunDir.value.copy(E.sunDir);
          }
        }
      }
      // fireflies around the player at night
      const nf = this.meshes.nightFlies;
      if (nf) {
        nf.visible = (E.preset?.atmos ?? 0) >= 1 && night > 0.3 && rain < 0.3 && snow < 0.3;
        if (nf.visible) {
          const pl = G.sys.player?.position || cam.position;
          const u = this._nightFlyMat.uniforms;
          u.uCenter.value.set(pl.x, pl.y, pl.z);
          u.uGround.value = Number.isFinite(pl.y) ? pl.y : 0;
        }
      }
    },

    // ============================================================== per frame
    update(dt, t) {
      uniforms.uTime.value = t;
      const night = clamp(G.world.nightFactor || 0, 0, 1);
      uniforms.uNight.value = night;
      const eng = G.sys.engine;
      // wind eases (no sudden jumps when the weather changes); gusts are advected by the wind
      if (this._windGoal != null) {
        this._windCur += (this._windGoal - this._windCur) * (1 - Math.exp(-Math.min(dt || 0, 0.25) / 1.5));
        uniforms.uWindStrength.value = this._windCur;
      }
      uniforms.uGustAmt.value = (eng?.preset?.atmos ?? 1) >= 1 ? 1 : 0;
      const ws = uniforms.uWindStrength.value, wv = uniforms.uWind.value, gp = uniforms.uGustPos.value;
      gp.x = (gp.x + wv.x * ws * 6 * Math.min(dt || 0, 0.25)) % 1e6; gp.y = (gp.y + wv.y * ws * 6 * Math.min(dt || 0, 0.25)) % 1e6;
      try { this._updateAtmos(dt, t, night); } catch (e) { if (!this._atmosErr) { this._atmosErr = true; G.log.warn('WORLD', 'nature atmosphere update failed', e); } }
      // grass follows the camera
      if (this._grassUniforms && eng) {
        const cam = eng.camera;
        const gu = this._grassUniforms;
        const fx = -cam.matrixWorld.elements[8], fz = -cam.matrixWorld.elements[10];
        const fl = Math.hypot(fx, fz) || 1;
        gu.uGrassCenter.value.set(cam.position.x + (fx / fl) * 14, cam.position.z + (fz / fl) * 14);
        const pl = G.sys.player?.position;
        if (pl) gu.uPlayer.value.set(pl.x, pl.z); else gu.uPlayer.value.set(9999, 9999);
      }
      // clouds lit by the current sun / sky
      if (this._cloudMat && eng) {
        const u = this._cloudMat.uniforms;
        u.uSunDir.value.copy(eng.sunDir);
        const sunUp = Math.max(0, eng.sunDir.y);
        const sI = eng.sun ? eng.sun.intensity : 2.5;
        u.uSunCol.value.copy(eng.sun ? eng.sun.color : _c.set(0xffffff)).multiplyScalar(sI * Math.sqrt(sunUp) * 0.3);
        const hI = eng.hemi ? eng.hemi.intensity : 0.8;
        u.uAmb.value.copy(eng.hemi ? eng.hemi.color : _c.set(0xcfe3ff)).multiplyScalar(hI * 0.95);
        u.uCover.value = this._cloudCover;
        u.uTint.value.copy(this._cloudTint);
        u.uVeil.value = this._cloudVeil;
        u.uVeilCol.value.copy(this._cloudVeilCol);
        const w = uniforms.uWind.value, ws = uniforms.uWindStrength.value;
        // drift accumulated on the CPU: a wind change bends the path smoothly instead of teleporting every cloud
        const k = 2.4 * (0.6 + ws * 0.4) * Math.min(dt || 0, 0.25), D2 = 3000;
        const off = u.uOffset.value;
        off.x = ((off.x + w.x * k) % D2 + D2) % D2; off.y = ((off.y + w.y * k) % D2 + D2) % D2;
      }
      if (eng?.hemi) uniforms.uVegAmb.value.copy(eng.hemi.color).multiplyScalar(eng.hemi.intensity * 0.16);
      if (this.meshes.fireflies) this.meshes.fireflies.visible = night > 0.04;
      this._updateBirds(t);
      this._updateButterflies(t);
    },
  };

  G.register(NAT);
})();
