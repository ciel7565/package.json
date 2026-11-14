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
//
//   Phase 8 (CONTRACT §16.2) — real vegetation on medium / high (`low` keeps the plain look below, untouched):
//     real                         true when the real trees / grass / rocks are on
//     grove(list, opts) -> { group, count, stats(), dispose() }
//                                  plant trees anywhere (places, the 만장대 complex): list of { x, z, y?, species, scale?,
//                                  rot?, variant?, tint? } in the coordinates of opts.parent (default: the scene; a
//                                  translated parent is fine). species: 'pine' | 'gardenPine' | 'oak' | 'maple' |
//                                  'redMaple' | 'zelkova' | 'conifer'. The same levels of detail, wind and shadows as
//                                  the valley's trees; plain instanced trees on `low`. opts: { parent, name, shadows,
//                                  colliders: false, heightAt(x, z) -> y }
//     meadow(opts) -> { mesh, count, dispose() }
//                                  a patch of grass tufts and wild flowers for a place: { parent, x, z, w, d, density,
//                                  flowers: 0..1, heightAt(x, z), mask(x, z) -> 0..1, seed }
//     lodStats()                   { real, forests: [{ trees, near, mid, chunks, … }], foliage: { size, photo } }
//     veg                          the vegetation internals (templates, Forest, atlas) for tests and the developer centre
//   Wind: engine.wind = { x, z, strength } wins over setWind() when the engine provides it.
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
    const real = NAT.real;
    B.add(g, (x, y, z, c, i) => {
      // [render-nature] the photographed rock gets its colour, moss and wet foot in the shader: only a soft variation here
      if (real) { const v = 0.84 + 0.26 * (0.5 + 0.5 * N3(x * 2.3 + seed, y * 2.3, z * 2.3)); c.setRGB(v, v * 0.99, v * 0.97).multiplyScalar(0.86 + 0.18 * smooth(-0.4, 0.6, y)); return; }
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

  // =============================================================================================================
  // REAL VEGETATION (medium / high) — CONTRACT §16.2.  `low` never runs any of this: it keeps the blob trees, the
  // tuft grass and the Lambert rocks further down exactly as they were.
  //
  //   foliage atlas   4 × 4 cells of leaf clusters painted on a 2D canvas: photographed leaves of the asset pack
  //                   (alpha/oak_leaf, zelkova_leaf, maple_leaf, pine_branch) are the stamps once they are decoded,
  //                   painted leaves and needles before that / in a page without the pack. The canvas becomes a
  //                   DataTexture: leaf colour bled into the transparent texels (no dark fringes) and a mip chain
  //                   whose alpha keeps the coverage of level 0 (crowns do not thin out with distance).
  //   templates       per species × variant × level a list of QUADS (bark tubes + leaf cards) grown from a seeded
  //                   branch skeleton: spherised normals, baked crown occlusion, wind weights.
  //   Forest          the trees of one area: two world-space quad batches (level 0 < 40 m, level 1 < 110 m — one draw
  //                   call each, whatever the species) that trees enter and leave a few times per second, and ONE
  //                   instanced billboard mesh with every tree (impostors baked in JS from the level-1 templates,
  //                   colour + normal) that the GPU cuts by distance. Levels cross-fade with a screen-door dither.
  // =============================================================================================================
  const VEG = { CELLS: 4 };
  const hash01 = (a, b = 0, c = 0) => {
    let h = (Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul((b | 0) + 0x165667b1, 0x85ebca6b) ^ Math.imul((c | 0) + 0x9e3779b9, 0xc2b2ae35)) | 0;
    h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12; h = Math.imul(h, 0x297a2d39); h ^= h >>> 15;
    return (h >>> 0) / 4294967296;
  };
  const mk2d = (w, h) => {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const x = c.getContext('2d', { willReadFrequently: true });
    return x ? { c, x } : null;
  };
  const freeCanvas = (c) => { try { if (c) c.width = c.height = 0; } catch (e) { /* already gone */ } };
  const CELL = { pineTop: 0, pineSide: 1, pineTwig: 2, fir: 3, oakA: 4, oakB: 5, zelA: 6, zelB: 7, mapA: 8, mapB: 9, mapRed: 10, shrub: 11, bloom: 12, firB: 13, herb: 14, shrubB: 15 };
  VEG.CELL = CELL;
  /** uv rectangle [u0, v0, du, dv] of an atlas cell (row 0 is the top row of the painting) */
  const cellUV = (i, n = VEG.CELLS) => [(i % n) / n, 1 - (Math.floor(i / n) + 1) / n, 1 / n, 1 / n];

  // ---------------------------------------------------------------- leaf stamps (one sheet; a leaf points up, stem at the bottom centre)
  const ST_W = 96, ST_H = 128, ST_COLS = 12, SHADES = [1, 0.8, 0.6];
  const css = (r, g, b, a = 1) => `rgba(${r | 0},${g | 0},${b | 0},${a})`;
  /** painted leaves (unit box: x 0..1, y 0 = tip, 1 = stem end) */
  const LEAF_PAINT = {
    ovate(x, r, c0, c1) {   // zelkova / elm: pointed, saw-toothed
      const pts = [], N = 26, ph = r() * 9;
      for (let i = 0; i <= N; i++) { const t = i / N; const w = 0.40 * Math.pow(Math.sin(PI * Math.pow(t, 0.72)), 0.9) * (1 + 0.07 * (((t * 13 + ph) % 1) - 0.5)); pts.push([w, 0.93 - t * 0.9]); }
      const g = x.createLinearGradient(0, 0.95, 0, 0); g.addColorStop(0, c0); g.addColorStop(1, c1);
      x.fillStyle = g; x.beginPath(); x.moveTo(0.5, 0.95);
      for (const p of pts) x.lineTo(0.5 - p[0], p[1]);
      for (let i = pts.length - 1; i >= 0; i--) x.lineTo(0.5 + pts[i][0], pts[i][1]);
      x.closePath(); x.fill();
      x.strokeStyle = 'rgba(235,245,190,0.30)'; x.lineWidth = 0.014; x.beginPath(); x.moveTo(0.5, 0.97); x.lineTo(0.5, 0.06);
      for (let i = 1; i < 8; i++) { const y = 0.9 - i * 0.1, w = 0.34 * Math.sin(PI * Math.pow(i / 9, 0.72)); x.moveTo(0.5, y); x.lineTo(0.5 - w, y - 0.07); x.moveTo(0.5, y); x.lineTo(0.5 + w, y - 0.07); }
      x.stroke();
    },
    oak(x, r, c0, c1) {     // rounded lobes
      const pts = [], N = 40, ph = r() * 6, k = 3 + Math.floor(r() * 2);
      for (let i = 0; i <= N; i++) { const t = i / N; const w = 0.37 * Math.pow(Math.sin(PI * Math.pow(t, 0.9)), 0.62) * (0.74 + 0.3 * Math.cos(t * TAU * k + ph)) * (0.55 + 0.6 * t * (1.6 - t)); pts.push([Math.max(0.012, w), 0.92 - t * 0.88]); }
      const g = x.createLinearGradient(0, 0.95, 0, 0); g.addColorStop(0, c0); g.addColorStop(1, c1);
      x.fillStyle = g; x.beginPath(); x.moveTo(0.5, 0.98);
      for (const p of pts) x.lineTo(0.5 - p[0], p[1]);
      for (let i = pts.length - 1; i >= 0; i--) x.lineTo(0.5 + pts[i][0], pts[i][1]);
      x.closePath(); x.fill();
      x.strokeStyle = 'rgba(240,248,200,0.28)'; x.lineWidth = 0.016; x.beginPath(); x.moveTo(0.5, 0.98); x.lineTo(0.5, 0.08);
      for (let i = 1; i < 6; i++) { const y = 0.86 - i * 0.13; x.moveTo(0.5, y); x.lineTo(0.5 - 0.22, y - 0.09); x.moveTo(0.5, y); x.lineTo(0.5 + 0.22, y - 0.09); }
      x.stroke();
    },
    maple(x, r, c0, c1) {   // five pointed lobes on a long stalk
      const g = x.createRadialGradient(0.5, 0.6, 0.02, 0.5, 0.5, 0.55); g.addColorStop(0, c0); g.addColorStop(1, c1);
      x.fillStyle = g;
      const lobes = [[0, 0.56], [0.86, 0.47], [-0.86, 0.47], [1.75, 0.3], [-1.75, 0.3]];
      x.beginPath();
      for (const [a, len] of lobes) {
        const l = len * (0.9 + r() * 0.2), ca = Math.sin(a), sa = -Math.cos(a);
        const bx = 0.5, by = 0.62, w = 0.105;
        x.moveTo(bx - sa * w, by + ca * w);
        x.lineTo(bx + ca * l * 0.45 - sa * w * 1.25, by + sa * l * 0.45 + ca * w * 1.25);
        x.lineTo(bx + ca * l * 0.52 - sa * w * 0.55, by + sa * l * 0.52 + ca * w * 0.55);
        x.lineTo(bx + ca * l, by + sa * l);
        x.lineTo(bx + ca * l * 0.52 + sa * w * 0.55, by + sa * l * 0.52 - ca * w * 0.55);
        x.lineTo(bx + ca * l * 0.45 + sa * w * 1.25, by + sa * l * 0.45 - ca * w * 1.25);
        x.lineTo(bx + sa * w, by - ca * w);
        x.closePath();
      }
      x.fill();
      x.strokeStyle = c0; x.lineWidth = 0.02; x.beginPath(); x.moveTo(0.5, 0.62); x.lineTo(0.5 + (r() - 0.5) * 0.06, 0.99); x.stroke();
      x.strokeStyle = 'rgba(245,250,205,0.26)'; x.lineWidth = 0.012; x.beginPath();
      for (const [a, len] of lobes) { x.moveTo(0.5, 0.62); x.lineTo(0.5 + Math.sin(a) * len * 0.85, 0.62 - Math.cos(a) * len * 0.85); }
      x.stroke();
    },
    small(x, r, c0, c1) {   // shrub leaf: a glossy oval
      const g = x.createLinearGradient(0.3, 0.95, 0.7, 0.05); g.addColorStop(0, c0); g.addColorStop(1, c1);
      x.fillStyle = g; x.beginPath(); x.moveTo(0.5, 0.97);
      x.bezierCurveTo(0.08, 0.72, 0.14, 0.2, 0.5, 0.05); x.bezierCurveTo(0.86, 0.2, 0.92, 0.72, 0.5, 0.97); x.fill();
      x.strokeStyle = 'rgba(240,250,210,0.3)'; x.lineWidth = 0.02; x.beginPath(); x.moveTo(0.5, 0.95); x.lineTo(0.5, 0.1); x.stroke();
    },
    blade(x, r, c0, c1) {   // a long arching leaf (herbs, lilies)
      const g = x.createLinearGradient(0, 1, 0, 0); g.addColorStop(0, c0); g.addColorStop(1, c1);
      const b = (r() - 0.5) * 0.5;
      x.fillStyle = g; x.beginPath(); x.moveTo(0.44, 0.99);
      x.bezierCurveTo(0.3, 0.6, 0.38 + b, 0.3, 0.5 + b, 0.02); x.bezierCurveTo(0.6 + b * 0.6, 0.3, 0.66, 0.6, 0.56, 0.99); x.fill();
    },
    blossom(x, r, c0, c1, sh = 1) {   // a five-petalled azalea flower, almost white: the instance colour tints it
      const cx = 0.5, cy = 0.5;
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * TAU + r() * 0.2, ca = Math.cos(a), sa = Math.sin(a);
        const g = x.createRadialGradient(cx, cy, 0.02, cx + ca * 0.3, cy + sa * 0.3, 0.36);
        g.addColorStop(0, css(196 * sh, 180 * sh, 188 * sh)); g.addColorStop(0.45, css(246 * sh, 238 * sh, 242 * sh)); g.addColorStop(1, css(255 * sh, 252 * sh, 253 * sh));
        x.fillStyle = g; x.beginPath(); x.ellipse(cx + ca * 0.24, cy + sa * 0.24, 0.25, 0.17, a, 0, TAU); x.fill();
      }
      x.fillStyle = css(150 * sh, 120 * sh, 128 * sh);
      for (let i = 0; i < 6; i++) { const a = r() * TAU, d = 0.03 + r() * 0.08; x.beginPath(); x.arc(cx + Math.cos(a) * d, cy + Math.sin(a) * d, 0.016, 0, TAU); x.fill(); }
    },
  };
  // stamp families: painted fallback colours [stem end, tip] and what to take from the pack when it is there
  const LEAF_FAM = {
    oak: { paint: 'oak', n: 5, c: [[70, 112, 36], [118, 160, 52]], pack: 'alpha/oak_leaf', grid: [3, 2], recolor: [100, 150, 50], amt: 0.5, mul: [208, 220, 188] },
    zel: { paint: 'ovate', n: 4, c: [[52, 100, 36], [92, 144, 52]], pack: 'alpha/zelkova_leaf', grid: [0, 1], recolor: [92, 152, 52], amt: 0.55, mul: [255, 255, 236] },
    map: { paint: 'maple', n: 5, c: [[72, 124, 38], [128, 172, 58]], pack: 'alpha/maple_leaf', grid: [3, 3], recolor: [104, 160, 50], amt: 0.9, mul: [222, 232, 205] },
    mapRed: { paint: 'maple', n: 4, c: [[116, 34, 30], [186, 62, 38]], pack: 'alpha/maple_leaf', grid: [3, 3], pick: [2, 3, 8, 0], recolor: [170, 40, 40], amt: 0.82, mul: [236, 210, 206] },
    shrub: { paint: 'small', n: 3, c: [[40, 84, 34], [78, 126, 50]] },
    herb: { paint: 'blade', n: 4, c: [[44, 92, 30], [104, 150, 54]] },
    bloom: { paint: 'blossom', n: 3, c: null, shades: [1, 0.93, 0.86] },
  };
  /** tight alpha box of a region of straight RGBA data */
  function alphaBox(d, W, x0, y0, x1, y1, thr = 24) {
    let ax = x1, ay = y1, bx = x0 - 1, by = y0 - 1;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (d[(y * W + x) * 4 + 3] > thr) { if (x < ax) ax = x; if (x > bx) bx = x; if (y < ay) ay = y; if (y > by) by = y; }
    return bx < ax ? null : [ax, ay, bx - ax + 1, by - ay + 1];
  }
  /** leaf rectangles of a pack card: a grid of cells, or (cols = 0) the pieces between empty columns of each row band */
  function packLeaves(img, grid) {
    const W = img.width, H = img.height, t = mk2d(W, H);
    if (!t) return [];
    t.x.drawImage(img, 0, 0);
    const d = t.x.getImageData(0, 0, W, H).data, out = [];
    const [cols, rows] = grid;
    if (cols > 0) {
      for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
        const b = alphaBox(d, W, Math.floor(i * W / cols), Math.floor(j * H / rows), Math.floor((i + 1) * W / cols), Math.floor((j + 1) * H / rows));
        if (b && b[2] > 8 && b[3] > 8) out.push(b);
      }
    } else {
      for (let j = 0; j < rows; j++) {
        const y0 = Math.floor(j * H / rows), y1 = Math.floor((j + 1) * H / rows);
        let start = -1;
        for (let x = 0; x <= W; x++) {
          let any = false;
          if (x < W) for (let y = y0; y < y1; y++) if (d[(y * W + x) * 4 + 3] > 24) { any = true; break; }
          if (any && start < 0) start = x;
          if (!any && start >= 0) { const b = alphaBox(d, W, start, y0, x, y1); if (b && b[2] > 8 && b[3] > 8) out.push(b); start = -1; }
        }
      }
    }
    freeCanvas(t.c);
    return out;
  }
  /** the stamp sheet: every family in SHADES brightness steps. imgs: { 'alpha/oak_leaf': ImageBitmap, … } (or {}) */
  function buildStamps(imgs, rnd) {
    const fams = Object.keys(LEAF_FAM);
    let total = 0;
    for (const k of fams) total += LEAF_FAM[k].n * SHADES.length;
    const sheet = mk2d(ST_COLS * ST_W, Math.ceil(total / ST_COLS) * ST_H);
    if (!sheet) return null;
    const x = sheet.x, out = { sheet: sheet.c, fam: {}, photo: {} };
    let slot = 0;
    for (const k of fams) {
      const F = LEAF_FAM[k], img = F.pack ? imgs[F.pack] : null;
      let rects = img ? packLeaves(img, F.grid) : [];
      if (F.pick && rects.length) rects = F.pick.map((i) => rects[i % rects.length]);
      // zelkova: the three-leaf twig is wider than tall — keep single leaves only
      rects = rects.filter((b) => b[3] >= b[2] * 0.9);
      const useImg = rects.length >= 2;
      out.photo[k] = useImg;
      const shades = F.shades || SHADES, list = [];
      const n = useImg ? Math.min(F.n + 1, rects.length) : F.n;
      for (let i = 0; i < n && slot + shades.length <= ST_COLS * Math.ceil(total / ST_COLS) + 0; i++) {
        const seed = rnd();
        const row = [];
        for (let s = 0; s < shades.length; s++) {
          if (slot >= ST_COLS * Math.ceil(total / ST_COLS)) break;
          const cx = (slot % ST_COLS) * ST_W, cy = Math.floor(slot / ST_COLS) * ST_H; slot++;
          const sh = shades[s];
          // shaded leaves lose more red and green than blue: the shade inside a crown is sky-lit
          const kr = sh, kg = sh * 0.96 + 0.04, kb = sh * 0.9 + 0.1;
          x.save(); x.beginPath(); x.rect(cx, cy, ST_W, ST_H); x.clip();
          if (useImg) {
            const b = rects[i], k2 = Math.min((ST_W - 6) / b[2], (ST_H - 6) / b[3]);
            const w = b[2] * k2, h = b[3] * k2;
            const draw = () => x.drawImage(img, b[0], b[1], b[2], b[3], cx + (ST_W - w) / 2, cy + ST_H - 3 - h, w, h);
            x.globalCompositeOperation = 'source-over'; draw();
            if (F.recolor) { x.globalCompositeOperation = 'color'; x.globalAlpha = F.amt ?? 0.85; x.fillStyle = css(...F.recolor); x.fillRect(cx, cy, ST_W, ST_H); x.globalAlpha = 1; }
            const m = F.mul || [255, 255, 255];
            x.globalCompositeOperation = 'multiply'; x.fillStyle = css(m[0] * kr, m[1] * kg, m[2] * kb); x.fillRect(cx, cy, ST_W, ST_H);
            x.globalCompositeOperation = 'destination-in'; draw();   // one drawImage: back to the leaf's own outline
          } else {
            // painted leaves take their shade in the colours (several strokes cannot serve as one mask)
            const r2 = G.util.rng(Math.floor(seed * 1e6) + 7), c = F.c;
            x.translate(cx + 3, cy + 3); x.scale(ST_W - 6, ST_H - 6);
            LEAF_PAINT[F.paint](x, r2, c ? css(c[0][0] * kr, c[0][1] * kg, c[0][2] * kb) : '', c ? css(c[1][0] * kr, c[1][1] * kg, c[1][2] * kb) : '', sh);
          }
          x.restore();
          row.push([cx, cy]);
        }
        list.push(row);
      }
      out.fam[k] = list;
    }
    return out;
  }

  // ---------------------------------------------------------------- cluster painters (one atlas cell each)
  /** a clump / spray of leaves on fine twigs. o: { fam, n, leaf (length / S), mode: 'clump' | 'spray', gaps } */
  function paintLeaves(x, st, ox, oy, S, rnd, o) {
    const list = st.fam[o.fam];
    if (!list || !list.length) return;
    const spray = o.mode === 'spray';
    const cx = ox + S * 0.5, cy = oy + S * (spray ? 0.93 : 0.5), R = S * 0.44;
    const twigs = [], nt = spray ? 7 : 10;
    for (let i = 0; i < nt; i++) {
      const u = nt > 1 ? i / (nt - 1) : 0.5;
      const a = spray ? -PI / 2 + (u - 0.5) * 2.05 + (rnd() - 0.5) * 0.22 : (i / nt) * TAU + (rnd() - 0.5) * 0.5;
      const len = spray ? R * 1.86 * (0.72 + rnd() * 0.28) * (1 - Math.abs(u - 0.5) * 0.62) : R * (0.62 + rnd() * 0.36);
      twigs.push({ a, len, bend: (rnd() - 0.5) * 0.6 });
    }
    const leaves = [], L = S * o.leaf, total = Math.round(o.n * (o.dens || 1));
    const inside = (px, py) => px > ox + S * 0.035 && px < ox + S * 0.965 && py > oy + S * 0.035 && py < oy + S * 0.965;
    const per = Math.max(3, Math.round(total * 0.62 / nt));
    for (const tw of twigs) {
      for (let k = 0; k < per; k++) {
        const t = 0.12 + 0.88 * ((k + rnd()) / per), ang = tw.a + tw.bend * t;
        const px = cx + Math.cos(ang) * tw.len * t, py = cy + Math.sin(ang) * tw.len * t;
        const side = (k & 1) ? 1 : -1;
        leaves.push({ px, py, a: ang + side * (0.45 + rnd() * 0.75), s: L * (0.72 + rnd() * 0.5), d: rnd() * 0.75 + 0.25 * t });
      }
    }
    // fillers close the body of the cluster; a few holes stay open (sky shows through real crowns)
    const nf = Math.round(total * 0.38);
    for (let k = 0; k < nf; k++) {
      const a = spray ? -PI / 2 + (rnd() - 0.5) * 1.9 : rnd() * TAU, d = Math.sqrt(rnd()) * R * (spray ? 1.5 : 0.9);
      const px = cx + Math.cos(a) * d, py = cy + Math.sin(a) * d * (spray ? 1 : 0.96);
      leaves.push({ px, py, a: a + (rnd() - 0.5) * 1.6, s: L * (0.7 + rnd() * 0.5), d: rnd() * 0.8 });
    }
    leaves.sort((p, q) => p.d - q.d);
    const drawLeaf = (lf) => {
      if (!inside(lf.px + Math.cos(lf.a) * lf.s, lf.py + Math.sin(lf.a) * lf.s) || !inside(lf.px, lf.py)) return;
      const shape = list[Math.floor(rnd() * list.length)];
      const sh = lf.d < 0.36 ? Math.min(2, shape.length - 1) : lf.d < 0.7 ? Math.min(1, shape.length - 1) : 0;
      const [sx, sy] = shape[sh];
      const h = lf.s, w = h * ST_W / ST_H, rot = lf.a + PI / 2, c = Math.cos(rot), s = Math.sin(rot), fl = rnd() < 0.5 ? -1 : 1;
      x.setTransform(c * fl, s * fl, -s, c, lf.px, lf.py);
      x.drawImage(st.sheet, sx, sy, ST_W, ST_H, -w / 2, -h + 2, w, h);
    };
    x.save(); x.beginPath(); x.rect(ox, oy, S, S); x.clip();
    const cut = Math.floor(leaves.length * 0.36);
    const drawTwigs = () => {
      x.setTransform(1, 0, 0, 1, 0, 0);
      x.strokeStyle = o.twig || 'rgba(58,44,30,0.95)'; x.lineCap = 'round';
      for (const tw of twigs) {
        x.lineWidth = Math.max(1, S * 0.0085); x.beginPath(); x.moveTo(cx, cy);
        for (let k = 1; k <= 6; k++) { const t = k / 6, ang = tw.a + tw.bend * t; x.lineTo(cx + Math.cos(ang) * tw.len * t * 0.94, cy + Math.sin(ang) * tw.len * t * 0.94); }
        x.stroke();
      }
    };
    // a clump hides its twigs under all the leaves (no star of spokes in the middle of a card); a spray shows its stalk
    if (!spray) drawTwigs();
    for (let i = 0; i < cut; i++) drawLeaf(leaves[i]);
    if (spray) drawTwigs();
    for (let i = cut; i < leaves.length; i++) drawLeaf(leaves[i]);
    x.setTransform(1, 0, 0, 1, 0, 0);
    x.restore();
  }
  /** red-pine needles. mode 'top' (a pad seen from above), 'side' (flat-bottomed dome), 'twig' (a branch end) */
  function paintPine(x, ox, oy, S, rnd, mode, dens = 1) {
    const tufts = [], NL = S * 0.062;
    if (mode === 'top') {
      const n = Math.round(96 * dens);
      for (let i = 0; i < n; i++) {
        // scattered, denser towards the rim (no seed-head spiral: it would show as a dot grid on the card)
        const rr = Math.pow(rnd(), 0.42) * 0.41, a = rnd() * TAU;
        tufts.push({ px: 0.5 + Math.cos(a) * rr, py: 0.5 + Math.sin(a) * rr, a0: a, fan: TAU, d: rnd() * 0.5 + (1 - rr / 0.41) * 0.5, k: 0.8 + rnd() * 0.5 });
      }
    } else if (mode === 'side') {
      const n = Math.round(96 * dens);
      for (let i = 0; i < n; i++) {
        const u = (i + rnd()) / n, xx = 0.5 + (u - 0.5) * 0.86, dome = 0.36 * Math.sqrt(Math.max(0, 1 - Math.pow((xx - 0.5) / 0.45, 2)));
        const v = rnd();
        tufts.push({ px: xx, py: 0.70 - v * dome, a0: -PI / 2 + (xx - 0.5) * 1.5, fan: 2.5, d: v * 0.6 + rnd() * 0.4, k: 1 });
      }
    } else {
      const n = Math.round(15 * dens);
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5) / n, side = (i & 1) ? 1 : -1, sp = 0.05 + t * 0.24;
        tufts.push({ px: 0.5 + side * sp * (0.4 + rnd() * 0.8), py: 0.9 - t * 0.74 + (rnd() - 0.5) * 0.05, a0: -PI / 2 + side * 0.6, fan: 3.6, d: rnd(), k: 1.35 });
      }
    }
    x.save(); x.beginPath(); x.rect(ox, oy, S, S); x.clip();
    // twigs first (reddish, like the upper bark of a red pine)
    x.lineCap = 'round'; x.strokeStyle = 'rgba(112,62,38,0.95)';
    const pvx = ox + S * 0.5, pvy = oy + S * (mode === 'top' ? 0.5 : mode === 'side' ? 0.76 : 0.97);
    for (let i = 0; i < tufts.length; i += (mode === 'twig' ? 1 : 3)) {
      const t = tufts[i];
      x.lineWidth = Math.max(1, S * (mode === 'twig' ? 0.011 : 0.006));
      x.beginPath(); x.moveTo(pvx, pvy);
      x.quadraticCurveTo(pvx + (ox + t.px * S - pvx) * 0.5, pvy + (oy + t.py * S - pvy) * 0.35, ox + t.px * S, oy + t.py * S);
      x.stroke();
    }
    tufts.sort((p, q) => p.d - q.d);
    const lw = Math.max(0.85, S / 300);
    for (const t of tufts) {
      const sh = 0.5 + 0.5 * Math.min(1, t.d * 1.25), tx = ox + t.px * S, ty = oy + t.py * S;
      const nn = Math.round((mode === 'twig' ? 46 : 34) * Math.min(1.2, 0.6 + dens * 0.5));
      for (let i = 0; i < nn; i++) {
        const a = t.a0 + (rnd() - 0.5) * t.fan, len = NL * t.k * (0.7 + rnd() * 0.5);
        const ca = Math.cos(a), sa = Math.sin(a), g = rnd();
        const mx = tx + ca * len * 0.5, my = ty + sa * len * 0.5 + len * 0.04;
        x.lineWidth = lw * 1.15;
        x.strokeStyle = css((40 + g * 22) * sh, (74 + g * 30) * sh, (32 + g * 14) * sh);
        x.beginPath(); x.moveTo(tx, ty); x.lineTo(mx, my); x.stroke();
        x.lineWidth = lw;
        x.strokeStyle = css((78 + g * 46) * sh, (122 + g * 46) * sh, (46 + g * 22) * sh);
        x.beginPath(); x.moveTo(mx, my); x.lineTo(tx + ca * len, ty + sa * len + len * 0.1); x.stroke();
      }
      if (rnd() < 0.3) {   // late spring: pale new shoots ("candles")
        x.lineWidth = lw * 2.2; x.strokeStyle = css(150 * sh, 172 * sh, 92 * sh);
        const a = mode === 'top' ? t.a0 : -PI / 2 + (rnd() - 0.5) * 0.5, len = NL * 0.55;
        x.beginPath(); x.moveTo(tx, ty); x.lineTo(tx + Math.cos(a) * len, ty + Math.sin(a) * len); x.stroke();
      }
    }
    x.restore();
  }
  /** a painted conifer frond pointing along +x from (0, 0), length len */
  function paintFrond(x, len, rnd, sh) {
    x.lineCap = 'round';
    x.strokeStyle = css(74 * sh, 54 * sh, 36 * sh); x.lineWidth = Math.max(1, len * 0.012);
    x.beginPath(); x.moveTo(0, 0); x.quadraticCurveTo(len * 0.5, -len * 0.03, len, len * 0.02); x.stroke();
    const n = 26;
    for (let i = 1; i < n; i++) {
      const t = i / n, bx = len * t, by = -len * 0.03 * Math.sin(PI * t) * 2 + len * 0.02 * t, bl = len * 0.2 * Math.sin(PI * Math.pow(t, 0.6)) * (0.8 + rnd() * 0.4);
      for (const side of [-1, 1]) {
        const a = side * (0.95 + rnd() * 0.25) - 0.25 * side * t, ex = bx + Math.cos(a) * bl, ey = by + Math.sin(a) * bl;
        x.strokeStyle = css(60 * sh, 44 * sh, 30 * sh); x.lineWidth = Math.max(0.8, len * 0.005);
        x.beginPath(); x.moveTo(bx, by); x.lineTo(ex, ey); x.stroke();
        const m = Math.max(4, Math.round(bl / (len * 0.011)));
        for (let k = 1; k <= m; k++) {
          const u = k / m, px = bx + (ex - bx) * u, py = by + (ey - by) * u, g = rnd(), nl = len * 0.03 * (1.1 - u * 0.5);
          x.lineWidth = Math.max(0.8, len * 0.0042);
          x.strokeStyle = css((34 + g * 34) * sh, (72 + g * 46) * sh, (34 + g * 18) * sh);
          for (const s2 of [-1, 1]) { const na = a + s2 * 0.9; x.beginPath(); x.moveTo(px, py); x.lineTo(px + Math.cos(na) * nl, py + Math.sin(na) * nl); x.stroke(); }
        }
      }
    }
  }
  /** conifer sprays fanning out of the left edge of the cell (pivot: left centre) */
  function paintFir(x, ox, oy, S, rnd, img, single) {
    const px = ox + S * 0.04, py = oy + S * 0.5;
    const fans = single ? [[0, 0.93, 1]] : [[-0.5, 0.66, 0.66], [0.52, 0.7, 0.7], [-0.2, 0.9, 0.86], [0.2, 0.86, 1]];
    let rects = null;
    if (img) { rects = packLeaves(img, [1, 3]); if (rects.length < 2) rects = null; }
    x.save(); x.beginPath(); x.rect(ox, oy, S, S); x.clip();
    for (const [a, l, sh] of fans) {
      const len = S * l * (0.94 + rnd() * 0.06);
      x.save(); x.translate(px, py); x.rotate(a + (rnd() - 0.5) * 0.06);
      if (rects) {
        const b = rects[Math.floor(rnd() * rects.length)], k = len / b[2], h = b[3] * k;
        // the photographed sprays point left: mirror them so the cut end sits at the pivot
        x.save(); x.scale(1, rnd() < 0.5 ? -1 : 1);
        x.drawImage(img, b[0], b[1], b[2], b[3], 0, -h / 2, len, h);
        x.restore();
      } else paintFrond(x, len, rnd, sh);
      x.restore();
    }
    if (rects) {   // deeper, bluer green than the photographed cypress (source-atop keeps the sprays' own alpha)
      x.globalCompositeOperation = 'source-atop'; x.fillStyle = 'rgba(16,58,34,0.42)'; x.fillRect(ox, oy, S, S);
      x.globalCompositeOperation = 'source-over';
    }
    x.restore();
  }
  /** blossoms only (no leaves): the shader tints them with the instance's flower colour */
  function paintBlooms(x, st, ox, oy, S, rnd) {
    const list = st.fam.bloom;
    if (!list || !list.length) return;
    x.save(); x.beginPath(); x.rect(ox, oy, S, S); x.clip();
    const n = 34;
    for (let i = 0; i < n; i++) {
      const a = rnd() * TAU, d = Math.sqrt(rnd()) * S * 0.4, s = S * (0.12 + rnd() * 0.07);
      const shape = list[Math.floor(rnd() * list.length)], [sx, sy] = shape[Math.floor(rnd() * shape.length)];
      const px = ox + S * 0.5 + Math.cos(a) * d, py = oy + S * 0.5 + Math.sin(a) * d * 0.95;
      x.save(); x.translate(px, py); x.rotate(rnd() * TAU); x.scale(1, 0.55 + rnd() * 0.45);
      x.drawImage(st.sheet, sx, sy, ST_W, ST_H, -s / 2, -s / 2, s, s * ST_H / ST_W * 0.75);
      x.restore();
    }
    x.restore();
  }
  /** paints the whole foliage atlas (size px, 4 × 4 cells) as a generator: one cell per step */
  function* paintAtlas(x, size, imgs, seed, dens) {
    const rnd = G.util.rng(seed), S = size / VEG.CELLS;
    const st = buildStamps(imgs, G.util.rng(seed + 11));
    if (!st) return null;
    yield;
    const at = (i) => [(i % VEG.CELLS) * S, Math.floor(i / VEG.CELLS) * S];
    const fir = imgs['alpha/pine_branch'] || null;
    const jobs = [
      [CELL.pineTop, (o) => paintPine(x, o[0], o[1], S, rnd, 'top', dens)],
      [CELL.pineSide, (o) => paintPine(x, o[0], o[1], S, rnd, 'side', dens)],
      [CELL.pineTwig, (o) => paintPine(x, o[0], o[1], S, rnd, 'twig', dens)],
      [CELL.fir, (o) => paintFir(x, o[0], o[1], S, rnd, fir, false)],
      [CELL.firB, (o) => paintFir(x, o[0], o[1], S, rnd, fir, true)],
      [CELL.oakA, (o) => paintLeaves(x, st, o[0], o[1], S, rnd, { fam: 'oak', n: 300, leaf: 0.11, mode: 'clump' , dens })],
      [CELL.oakB, (o) => paintLeaves(x, st, o[0], o[1], S, rnd, { fam: 'oak', n: 270, leaf: 0.115, mode: 'spray' , dens })],
      [CELL.zelA, (o) => paintLeaves(x, st, o[0], o[1], S, rnd, { fam: 'zel', n: 400, leaf: 0.09, mode: 'clump' , dens })],
      [CELL.zelB, (o) => paintLeaves(x, st, o[0], o[1], S, rnd, { fam: 'zel', n: 350, leaf: 0.095, mode: 'spray' , dens })],
      [CELL.mapA, (o) => paintLeaves(x, st, o[0], o[1], S, rnd, { fam: 'map', n: 320, leaf: 0.12, mode: 'clump' , dens })],
      [CELL.mapB, (o) => paintLeaves(x, st, o[0], o[1], S, rnd, { fam: 'map', n: 290, leaf: 0.125, mode: 'spray' , dens })],
      [CELL.mapRed, (o) => paintLeaves(x, st, o[0], o[1], S, rnd, { fam: 'mapRed', n: 320, leaf: 0.12, mode: 'clump' , dens })],
      [CELL.shrub, (o) => paintLeaves(x, st, o[0], o[1], S, rnd, { fam: 'shrub', n: 420, leaf: 0.07, mode: 'clump' , dens })],
      [CELL.shrubB, (o) => paintLeaves(x, st, o[0], o[1], S, rnd, { fam: 'shrub', n: 360, leaf: 0.075, mode: 'spray' , dens })],
      [CELL.herb, (o) => paintLeaves(x, st, o[0], o[1], S, rnd, { fam: 'herb', n: 46, leaf: 0.42, mode: 'spray', twig: 'rgba(0,0,0,0)' , dens })],
      [CELL.bloom, (o) => paintBlooms(x, st, o[0], o[1], S, rnd)],
    ];
    for (const [cell, fn] of jobs) { fn(at(cell)); yield; }
    freeCanvas(st.sheet);
    return { photo: st.photo };
  }

  // ---------------------------------------------------------------- canvas → texture data with honest edges and mips
  const S2L = new Float32Array(256), L2S = new Uint8Array(1025);
  for (let i = 0; i < 256; i++) { const c = i / 255; S2L[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
  for (let i = 0; i <= 1024; i++) { const c = i / 1024; L2S[i] = Math.round(255 * (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055)); }
  /**
   * straight-alpha RGBA rows (top first) → mip chain [{ data, width, height }] with row 0 at the bottom (DataTexture):
   * transparent texels take the mean colour of their cell (bilinear filtering never mixes in black), every level is a
   * linear-light box filter, and per cell the alpha of each level is scaled so that as many texels pass the 0.5 test
   * as on level 0. A generator: one level per step.
   */
  function* bakeMips(src, W, H, cols, rows, opts = {}) {
    const d0 = new Uint8Array(W * H * 4);
    const cw = W / cols, ch = H / rows, cov = new Float32Array(cols * rows), mean = new Float32Array(cols * rows * 3);
    const linear = !!opts.linear;   // data maps (normals): no sRGB round trip, no bleed colour
    for (let cj = 0; cj < rows; cj++) for (let ci = 0; ci < cols; ci++) {
      let r = 0, g = 0, b = 0, n = 0;
      const x0 = Math.round(ci * cw), x1 = Math.round((ci + 1) * cw), y0 = Math.round(cj * ch), y1 = Math.round((cj + 1) * ch);
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const k = (y * W + x) * 4; if (src[k + 3] >= 128) { r += src[k]; g += src[k + 1]; b += src[k + 2]; n++; } }
      const c = cj * cols + ci;
      cov[c] = n / Math.max(1, (x1 - x0) * (y1 - y0));
      if (n) { r /= n; g /= n; b /= n; } else { r = 96; g = 120; b = 60; }
      mean[c * 3] = r; mean[c * 3 + 1] = g; mean[c * 3 + 2] = b;
      for (let y = y0; y < y1; y++) {
        const dy = H - 1 - y;
        for (let x = x0; x < x1; x++) {
          const k = (y * W + x) * 4, q = (dy * W + x) * 4, a = src[k + 3];
          if (a < 10 && !linear) { d0[q] = r; d0[q + 1] = g; d0[q + 2] = b; d0[q + 3] = 0; }
          else { d0[q] = src[k]; d0[q + 1] = src[k + 1]; d0[q + 2] = src[k + 2]; d0[q + 3] = a; }
        }
      }
    }
    const mips = [{ data: d0, width: W, height: H }];
    yield;
    let pw = W, ph = H, pd = d0;
    const hist = new Uint32Array(256);
    for (let lv = 1; pw > 1 || ph > 1; lv++) {
      const w = Math.max(1, pw >> 1), h = Math.max(1, ph >> 1), d = new Uint8Array(w * h * 4);
      const sx = pw / w, sy = ph / h;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        let r = 0, g = 0, b = 0, a = 0, wsum = 0, r2 = 0, g2 = 0, b2 = 0, cnt = 0;
        const xa = Math.floor(x * sx), xb = Math.min(pw, Math.max(xa + 1, Math.floor((x + 1) * sx))), ya = Math.floor(y * sy), yb = Math.min(ph, Math.max(ya + 1, Math.floor((y + 1) * sy)));
        for (let yy = ya; yy < yb; yy++) for (let xx = xa; xx < xb; xx++) {
          const k = (yy * pw + xx) * 4, al = pd[k + 3];
          const lr = linear ? pd[k] / 255 : S2L[pd[k]], lg = linear ? pd[k + 1] / 255 : S2L[pd[k + 1]], lb = linear ? pd[k + 2] / 255 : S2L[pd[k + 2]];
          r += lr * al; g += lg * al; b += lb * al; wsum += al; a += al; r2 += lr; g2 += lg; b2 += lb; cnt++;
        }
        if (wsum > 0 && !linear) { r /= wsum; g /= wsum; b /= wsum; } else { r = r2 / cnt; g = g2 / cnt; b = b2 / cnt; }
        const q = (y * w + x) * 4;
        if (linear) { d[q] = Math.round(r * 255); d[q + 1] = Math.round(g * 255); d[q + 2] = Math.round(b * 255); }
        else { d[q] = L2S[Math.min(1024, Math.round(r * 1024))]; d[q + 1] = L2S[Math.min(1024, Math.round(g * 1024))]; d[q + 2] = L2S[Math.min(1024, Math.round(b * 1024))]; }
        d[q + 3] = Math.round(a / cnt);
      }
      // coverage: per cell, find the alpha that level 0's share of texels reaches, and scale it up to the test value
      const lcw = w / cols, lch = h / rows;
      if (!opts.keepAlpha && lcw >= 2 && lch >= 2) {
        for (let cj = 0; cj < rows; cj++) for (let ci = 0; ci < cols; ci++) {
          const c = (rows - 1 - cj) * cols + ci;   // level data is bottom-up; cov[] was counted top-down
          const x0 = Math.round(ci * lcw), x1 = Math.round((ci + 1) * lcw), y0 = Math.round(cj * lch), y1 = Math.round((cj + 1) * lch);
          hist.fill(0);
          for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) hist[d[(y * w + x) * 4 + 3]]++;
          const want = cov[c] * (x1 - x0) * (y1 - y0);
          let acc = 0, t = 255;
          for (; t > 1; t--) { acc += hist[t]; if (acc >= want) break; }
          const s = clamp(128 / Math.max(1, t), 1, 3.2);
          if (s > 1.01) for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const k = (y * w + x) * 4 + 3; d[k] = Math.min(255, Math.round(d[k] * s)); }
        }
      }
      mips.push({ data: d, width: w, height: h });
      pd = d; pw = w; ph = h;
      yield;
    }
    return { mips, cov, mean };
  }
  /** mip chain → THREE.DataTexture (sRGB colour or linear data) */
  function mipTexture(mips, { srgb = true, aniso = 4 } = {}) {
    const t = new THREE.DataTexture(mips[0].data, mips[0].width, mips[0].height, THREE.RGBAFormat, THREE.UnsignedByteType);
    t.mipmaps = mips; t.generateMipmaps = false;
    t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    t.anisotropy = aniso;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.needsUpdate = true;
    return t;
  }
  /** run a generator to its end (the synchronous path of the first build) */
  const drain = (gen) => { let r = gen.next(); while (!r.done) r = gen.next(); return r.value; };
  // ---------------------------------------------------------------- quads
  /** a growing list of quads (4 vertices: bottom-left, bottom-right, top-left, top-right; triangles 0-1-2, 2-1-3).
   *  P position, N normal, U uv, C tint (rgb = sqrt(colour / 4) so that 127 ≈ 1 and dark bark keeps precision;
   *  a = 255 leaf card / 0 bark), W wind (sway, flutter, phase, bob — bytes) */
  class Quads {
    constructor(cap = 512) { this.n = 0; this.cap = 0; this._alloc(cap); }
    _alloc(cap) {
      const P = new Float32Array(cap * 12), N = new Float32Array(cap * 12), U = new Float32Array(cap * 8), C = new Uint8Array(cap * 16), W = new Uint8Array(cap * 16);
      if (this.P) { P.set(this.P); N.set(this.N); U.set(this.U); C.set(this.C); W.set(this.W); }
      this.cap = cap; this.P = P; this.N = N; this.U = U; this.C = C; this.W = W;
    }
    quad() { if (this.n === this.cap) this._alloc(this.cap * 2); return this.n++; }
    vert(q, k, x, y, z, nx, ny, nz, u, v) {
      const o = (q * 4 + k) * 3, P = this.P, N = this.N, l = Math.hypot(nx, ny, nz);
      P[o] = x; P[o + 1] = y; P[o + 2] = z;
      // never a zero-length normal: some GPUs turn normalize(0) into NaN (CONTRACT §14.4)
      if (l > 1e-6 && Number.isFinite(l)) { N[o] = nx / l; N[o + 1] = ny / l; N[o + 2] = nz / l; } else { N[o] = 0; N[o + 1] = 1; N[o + 2] = 0; }
      const p = (q * 4 + k) * 2; this.U[p] = u; this.U[p + 1] = v;
    }
    tint(q, k, r, g, b, leaf) {
      const o = (q * 4 + k) * 4, C = this.C;
      C[o] = Math.min(255, Math.round(Math.sqrt(Math.max(0, r) / 4) * 255)); C[o + 1] = Math.min(255, Math.round(Math.sqrt(Math.max(0, g) / 4) * 255));
      C[o + 2] = Math.min(255, Math.round(Math.sqrt(Math.max(0, b) / 4) * 255)); C[o + 3] = leaf ? 255 : 0;
    }
    wind(q, k, sway, flutter, phase, bob) {
      const o = (q * 4 + k) * 4, W = this.W;
      W[o] = Math.round(clamp(sway, 0, 1) * 255); W[o + 1] = Math.round(clamp(flutter, 0, 1) * 255); W[o + 2] = Math.round((((phase % 1) + 1) % 1) * 255); W[o + 3] = Math.round(clamp(bob, 0, 1) * 255);
    }
  }
  const V3 = {
    add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
    sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
    mul: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
    mad: (a, b, s) => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s],
    len: (a) => Math.hypot(a[0], a[1], a[2]),
    norm: (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; },
    cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
    lerp: (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t],
    dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  };
  /** a branch path: n steps from p along d, turning a little each step (curl) and rising (lift) */
  function vpath(rnd, p, d, len, n, curl, lift) {
    const pts = [p], st = len / n;
    let dir = V3.norm(d), q = p;
    for (let i = 0; i < n; i++) {
      dir = V3.norm([dir[0] + (rnd() - 0.5) * curl, dir[1] + (rnd() - 0.5) * curl * 0.5 + lift, dir[2] + (rnd() - 0.5) * curl]);
      q = [q[0] + dir[0] * st, q[1] + dir[1] * st, q[2] + dir[2] * st];
      pts.push(q);
    }
    return { pts, dir };
  }
  const polyAt = (pts, t) => { const f = clamp(t, 0, 1) * (pts.length - 1), i = Math.min(pts.length - 2, Math.floor(f)); return V3.lerp(pts[i], pts[i + 1], f - i); };
  /** d tilted by `spread` rad toward the perpendicular that sits at angle a around it */
  function tiltDir(d, a, spread) {
    const u = V3.norm(V3.cross(d, Math.abs(d[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0])), w = V3.cross(d, u);
    const ca = Math.cos(a), sa = Math.sin(a), c = Math.cos(spread), s = Math.sin(spread);
    return V3.norm([d[0] * c + (u[0] * ca + w[0] * sa) * s, d[1] * c + (u[1] * ca + w[1] * sa) * s, d[2] * c + (u[2] * ca + w[2] * sa) * s]);
  }

  // ---------------------------------------------------------------- skeletons (metres, at scale 1, base at the origin)
  // { sp, H, branches: [{ pts, r0, r1, depth }], tips: [{ p, d, r, inner? }], sprays?: [{ a, b, len, t }] }
  /** 소나무 (red pine): a sinuous reddish trunk, bare below, horizontal limbs that end in flat needle pads.
   *  v 0 forest pine · 1 leaning · 2 sculpted garden pine (low, strong S) · 3 twin leaders */
  function growPine(rnd, v) {
    const garden = v === 2;
    const H = (garden ? 7.8 : 9.6) * (0.95 + rnd() * 0.1);
    const T = { sp: 'pine', H, branches: [], tips: [] };
    const la = rnd() * TAU;
    const stem = (p0, h, lean, amp, wav, r0) => {
      const N = 9, pts = [], ph = rnd() * TAU, lz = la + (p0[1] > 0 ? 2.2 : 0);
      for (let i = 0; i <= N; i++) {
        const t = i / N, sw = Math.sin(t * TAU * wav + ph) * amp * smooth(0.04, 0.5, t), off = lean * h * t * t;
        pts.push([p0[0] + Math.cos(lz) * off + Math.cos(lz + 1.4) * sw, p0[1] + h * t, p0[2] + Math.sin(lz) * off + Math.sin(lz + 1.4) * sw]);
      }
      T.branches.push({ pts, r0, r1: 0.05, depth: 0 });
      return pts;
    };
    const limbs = (pts, t0, nl, k) => {
      for (let i = 0; i < nl; i++) {
        const t = t0 + (0.95 - t0) * (nl > 1 ? i / (nl - 1) : 0.6) + (rnd() - 0.5) * 0.04;
        const base = polyAt(pts, t), az = i * 2.4 + rnd() * 0.9;
        const span = Math.sin(PI * clamp((t - t0 + 0.14) / (1.1 - t0), 0, 1));
        const len = (garden ? 1.4 + span * 1.5 : 1.25 + span * 2.1) * (0.85 + rnd() * 0.3) * k;
        const lb = vpath(rnd, base, [Math.cos(az), 0.06 + rnd() * 0.16 - (1 - t) * 0.12, Math.sin(az)], len, 3, 0.22, 0.07);
        const r = 0.045 + 0.07 * (1 - t) + len * 0.012;
        T.branches.push({ pts: lb.pts, r0: r, r1: r * 0.45, depth: 1 });
        const end = lb.pts[3], kids = 2 + (rnd() < 0.55 ? 1 : 0);
        for (let j = 0; j < kids; j++) {
          const a = az + (j - (kids - 1) / 2) * 0.95 + (rnd() - 0.5) * 0.3;
          const sb = vpath(rnd, kids === 3 && j === 1 ? polyAt(lb.pts, 0.6) : end, [Math.cos(a), 0.2 + rnd() * 0.16, Math.sin(a)], len * (0.3 + rnd() * 0.16), 2, 0.15, 0.1);
          T.branches.push({ pts: sb.pts, r0: r * 0.42, r1: r * 0.2, depth: 2 });
          T.tips.push({ p: sb.pts[2], d: sb.dir, r: (1.08 + rnd() * 0.42) * (garden ? 1.12 : 1) * k });
        }
      }
      for (let j = 0; j < 3; j++) {   // the flat top
        const a = rnd() * TAU, sb = vpath(rnd, polyAt(pts, 0.95), [Math.cos(a) * 0.8, 0.5, Math.sin(a) * 0.8], (0.7 + rnd() * 0.4) * k, 2, 0.15, 0.08);
        T.branches.push({ pts: sb.pts, r0: 0.05, r1: 0.022, depth: 2 });
        T.tips.push({ p: sb.pts[2], d: sb.dir, r: (1.15 + rnd() * 0.35) * k });
      }
    };
    const main = stem([0, -0.5, 0], H + 0.4, (v === 1 ? 0.2 : garden ? 0.1 : 0.05) + rnd() * 0.05, garden ? 0.8 : v === 1 ? 0.45 : 0.24, garden ? 1.1 : 0.7 + rnd() * 0.4, 0.3);
    if (v === 3) {
      limbs(main, 0.56, 5, 0.9);
      const fp = polyAt(main, 0.4), second = stem(fp, H * 0.5, 0.42, 0.22, 0.6, 0.17);
      limbs(second, 0.42, 4, 0.82);
    } else limbs(main, garden ? 0.36 : 0.5, garden ? 5 : 6 + Math.floor(rnd() * 2), 1);
    return T;
  }
  const BROAD = {
    // 참나무: upright trunk, sturdy spreading limbs, an irregular round crown
    oak: { H: 9.4, trunk: 0.4, r0: 0.28, limbs: [4, 5], ang: [0.75, 1.2], len: 2.45, lenK: 0.66, depth: 3, spread: 0.62, curl: 0.3, lift: 0.1, leader: 1, tipR: 0.75, card: 1.8, cells: [CELL.oakA, CELL.oakB] },
    // 느티나무: a massive short trunk that fans into many ascending limbs — the village's guardian tree
    zelkova: { H: 12.6, trunk: 0.23, r0: 0.6, limbs: [5, 7], ang: [0.42, 0.82], len: 3.6, lenK: 0.68, depth: 3, spread: 0.52, curl: 0.22, lift: 0.13, leader: 0, tipR: 0.95, card: 2.2, cells: [CELL.zelA, CELL.zelB] },
    // 단풍나무: low forks, layered spreading sprays
    maple: { H: 6.9, trunk: 0.22, r0: 0.2, limbs: [3, 4], ang: [0.6, 1.0], len: 2.05, lenK: 0.72, depth: 3, spread: 0.72, curl: 0.3, lift: -0.02, leader: 0, tipR: 0.62, card: 1.55, cells: [CELL.mapA, CELL.mapB] },
  };
  function growBroad(rnd, v, sp) {
    const B = BROAD[sp], H = B.H * (0.94 + rnd() * 0.12);
    const T = { sp, H, branches: [], tips: [] };
    const th = H * B.trunk * (0.9 + rnd() * 0.25);
    const tr = vpath(rnd, [0, -0.5, 0], [(rnd() - 0.5) * 0.12, 1, (rnd() - 0.5) * 0.12], th + 0.5, 4, 0.1, 0.25);
    T.branches.push({ pts: tr.pts, r0: B.r0, r1: B.r0 * 0.72, depth: 0 });
    const top = tr.pts[4];
    const rec = (p, d, len, r, depth) => {
      const last = depth >= B.depth;
      const br = vpath(rnd, p, d, len, last ? 1 : 2, B.curl, B.lift * (depth === 1 ? 1 : 0.5));
      T.branches.push({ pts: br.pts, r0: r, r1: r * 0.6, depth });
      const end = br.pts[br.pts.length - 1];
      if (last) { T.tips.push({ p: end, d: br.dir, r: B.tipR * (0.85 + rnd() * 0.3) }); return; }
      const kids = 2 + (rnd() < 0.35 ? 1 : 0), a0 = rnd() * TAU;
      for (let k = 0; k < kids; k++) rec(end, tiltDir(br.dir, a0 + (k / kids) * TAU + (rnd() - 0.5) * 0.7, B.spread * (0.7 + rnd() * 0.6)), len * B.lenK * (0.85 + rnd() * 0.3), r * 0.58, depth + 1);
      // foliage along the limb keeps the middle of the crown from being hollow
      if (depth <= 2 && rnd() < 0.75) T.tips.push({ p: polyAt(br.pts, 0.5 + rnd() * 0.3), d: br.dir, r: B.tipR * 0.9, inner: true });
    };
    const n = B.limbs[0] + Math.floor(rnd() * (B.limbs[1] - B.limbs[0] + 1)), az0 = rnd() * TAU;
    for (let i = 0; i < n; i++) {
      const az = az0 + (i / n) * TAU + (rnd() - 0.5) * 0.5, ang = B.ang[0] + rnd() * (B.ang[1] - B.ang[0]);
      rec(i < 2 ? top : polyAt(tr.pts, 0.72 + rnd() * 0.26), [Math.cos(az) * Math.sin(ang), Math.cos(ang), Math.sin(az) * Math.sin(ang)], B.len * (0.85 + rnd() * 0.3), B.r0 * 0.5, 1);
    }
    if (B.leader) rec(top, [(rnd() - 0.5) * 0.3, 1, (rnd() - 0.5) * 0.3], B.len * 0.95, B.r0 * 0.55, 1);
    return T;
  }
  /** 전나무 / 잣나무: a straight stem with whorls of drooping sprays — a cone */
  function growConifer(rnd, v) {
    const H = 12.5 * (0.9 + rnd() * 0.18), T = { sp: 'conifer', H, branches: [], tips: [], sprays: [] };
    const lean = [(rnd() - 0.5) * 0.05, 1, (rnd() - 0.5) * 0.05];
    const pts = [];
    for (let i = 0; i <= 5; i++) pts.push([lean[0] * H * (i / 5), -0.5 + (H + 0.5) * (i / 5), lean[2] * H * (i / 5)]);
    T.branches.push({ pts, r0: 0.26, r1: 0.025, depth: 0 });
    const y0 = (v === 1 ? 1.3 : 2.1) + rnd() * 0.5, wide = v === 3 ? 1.18 : v === 2 ? 0.86 : 1;
    let w = 0;
    for (let y = y0; y < H - 0.8; y += 0.86 + rnd() * 0.16, w++) {
      const t = (y - y0) / (H - y0), nb = t > 0.8 ? 4 : 5, a0 = w * 0.7 + rnd();
      for (let k = 0; k < nb; k++) {
        const az = a0 + (k / nb) * TAU + (rnd() - 0.5) * 0.35;
        const len = (2.75 * Math.pow(1 - t, 0.9) + 0.42) * (0.85 + rnd() * 0.3) * wide;
        const base = [lean[0] * (y + 0.5), y, lean[2] * (y + 0.5)];
        const br = vpath(rnd, base, [Math.cos(az), -0.16 - 0.1 * (1 - t), Math.sin(az)], len, 2, 0.08, 0.1);
        T.branches.push({ pts: br.pts, r0: 0.05 * (1 - t) + 0.014, r1: 0.008, depth: 1 });
        T.sprays.push({ a: base, b: br.pts[2], len, t });
      }
    }
    T.spire = { p: [lean[0] * H, H - 1.5, lean[2] * H], h: 1.9 };
    return T;
  }

  // ---------------------------------------------------------------- skeleton → quads
  // bark colours (linear albedo): [low on the trunk, high on the trunk / limbs]
  const BARK2 = {
    pine: [[0.20, 0.155, 0.125], [0.56, 0.22, 0.105]],      // grey-brown plates below, the flaky red of 적송 above
    oak: [[0.17, 0.145, 0.12], [0.2, 0.172, 0.14]],
    zelkova: [[0.27, 0.25, 0.22], [0.31, 0.29, 0.255]],     // smooth grey
    maple: [[0.2, 0.17, 0.145], [0.25, 0.205, 0.17]],
    conifer: [[0.15, 0.115, 0.09], [0.19, 0.145, 0.11]],
  };
  const swayOf = (y) => clamp((y / 10) * (y / 10) / 8, 0, 1);
  /** tube quads along pts; opts: { radial, flare, c0, c1, yRed (height where the colour has turned), bob } */
  function tubeQuads(Q, pts, r0, r1, o) {
    const n = pts.length, rings = [];
    let acc = 0;
    for (let i = 0; i < n; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)], tan = V3.norm(V3.sub(b, a));
      let u = V3.cross(tan, [1, 0, 0]);
      if (V3.len(u) < 0.2) u = V3.cross(tan, [0, 0, 1]);
      u = V3.norm(u);
      const w = V3.cross(tan, u), t = n > 1 ? i / (n - 1) : 0;
      let r = r0 + (r1 - r0) * t;
      if (o.flare) r *= 1 + o.flare * Math.pow(1 - clamp((pts[i][1] + 0.5) / 1.5, 0, 1), 2);
      if (i) acc += V3.len(V3.sub(pts[i], pts[i - 1]));
      rings.push({ c: pts[i], u, w, r, v: acc / 1.8 });
    }
    const R = o.radial, uRep = Math.max(1, Math.round(TAU * r0 / 0.9));
    for (let i = 0; i < n - 1; i++) for (let j = 0; j < R; j++) {
      const q = Q.quad();
      for (let k = 0; k < 4; k++) {
        const g = rings[i + (k >> 1)], jj = j + (k & 1), a = (jj / R) * TAU, ca = Math.cos(a), sa = Math.sin(a);
        const nx = g.u[0] * ca + g.w[0] * sa, ny = g.u[1] * ca + g.w[1] * sa, nz = g.u[2] * ca + g.w[2] * sa;
        const y = g.c[1] + ny * g.r;
        Q.vert(q, k, g.c[0] + nx * g.r, y, g.c[2] + nz * g.r, nx, ny, nz, (jj / R) * uRep, g.v);
        const m = smooth(o.y0, o.y1, y), sh = 0.86 + 0.28 * hash01(i * 7 + jj, j, Math.round(y * 3));
        Q.tint(q, k, (o.c0[0] + (o.c1[0] - o.c0[0]) * m) * sh, (o.c0[1] + (o.c1[1] - o.c0[1]) * m) * sh, (o.c0[2] + (o.c1[2] - o.c0[2]) * m) * sh, false);
        Q.wind(q, k, swayOf(Math.max(0, y)) * 0.55, 0, 0, o.bob || 0);
      }
    }
  }
  /** one leaf card: bl corner, ax (full width vector), ay (full height vector), atlas cell. shade(p) → [r, g, b] tint, nrm(p) → normal */
  function cardQuad(Q, bl, ax, ay, cell, flip, shade, nrm, phase, flut, bob) {
    const uv = cellUV(cell), q = Q.quad();
    for (let k = 0; k < 4; k++) {
      const fu = k & 1, fv = k >> 1;
      const p = [bl[0] + ax[0] * fu + ay[0] * fv, bl[1] + ax[1] * fu + ay[1] * fv, bl[2] + ax[2] * fu + ay[2] * fv];
      const nn = nrm(p), c = shade(p);
      Q.vert(q, k, p[0], p[1], p[2], nn[0], nn[1], nn[2], uv[0] + (flip ? 1 - fu : fu) * uv[2], uv[1] + fv * uv[3]);
      Q.tint(q, k, c[0], c[1], c[2], true);
      Q.wind(q, k, swayOf(Math.max(0, p[1])), flut, phase + k * 0.06, bob);
    }
  }
  /** skeleton → { quads, … } for a level of detail (0 = full, 1 = fewer and larger cards) */
  function emitTree(T, lvl, rnd) {
    const Q = new Quads(lvl ? 128 : 1024), sp = T.sp, bark = BARK2[sp] || BARK2.oak, H = T.H;
    // ---- crown ellipsoid (from the foliage points): normals and occlusion come from it
    const fol = T.sprays ? T.sprays.map((s) => s.b) : T.tips.map((t) => t.p);
    let cx = 0, cz = 0, y0 = 1e9, y1 = -1e9;
    for (const p of fol) { cx += p[0]; cz += p[2]; if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1]; }
    cx /= Math.max(1, fol.length); cz /= Math.max(1, fol.length);
    let rx = 0.5;
    for (const p of fol) rx = Math.max(rx, Math.hypot(p[0] - cx, p[2] - cz));
    const pad = sp === 'zelkova' ? 1.2 : sp === 'pine' ? 1.0 : 0.9;
    const C = [cx, (y0 + y1) / 2, cz], RX = rx + pad, RY = (y1 - y0) / 2 + pad;
    T.C = C; T.RX = RX; T.RY = RY;
    const ell = (p) => Math.hypot((p[0] - C[0]) / RX, (p[1] - C[1]) / RY, (p[2] - C[2]) / RX);
    const crownN = (p) => V3.norm([(p[0] - C[0]) / (RX * RX), (p[1] - C[1]) / (RY * RY) + 0.06 / RY, (p[2] - C[2]) / (RX * RX)]);
    const crownAO = (p) => (0.55 + 0.45 * smooth(0.28, 0.98, ell(p))) * (0.8 + 0.2 * smooth(-0.95, 0.35, (p[1] - C[1]) / RY));
    // ---- wood
    for (const b of T.branches) {
      if (lvl && b.depth > 1) continue;
      let pts = b.pts;
      if (lvl && pts.length > 3) pts = pts.filter((p, i) => i % 2 === 0 || i === b.pts.length - 1);
      if (sp === 'conifer' && b.depth) pts = [pts[0], pts[pts.length - 1]];   // hidden in the sprays: one segment is enough
      if (lvl && sp === 'conifer' && b.depth) continue;
      const radial = lvl ? (b.depth ? 3 : 5) : (b.depth === 0 ? 8 : sp === 'conifer' ? 3 : b.depth === 1 ? 5 : b.depth === 2 ? 4 : 3);
      const red = sp === 'pine';
      tubeQuads(Q, pts, b.r0, b.r1, { radial, flare: b.depth === 0 && b.pts[0][1] < 0 ? 0.55 : 0, c0: bark[0], c1: bark[1], y0: red ? H * 0.2 : 0.5, y1: red ? H * 0.52 : H * 0.6, bob: b.depth >= 2 ? 0.5 : b.depth ? 0.25 : 0 });
    }
    const wood = Q.n;
    // ---- foliage
    const jit = (a) => 1 + (rnd() - 0.5) * a;
    if (sp === 'pine') {
      for (const tip of T.tips) {
        const r = tip.r * (lvl ? 1.18 : 1), p = tip.p;
        const padC = [p[0], p[1] - r * 0.95, p[2]];
        const nrm = (q) => { const a = V3.norm(V3.sub(q, padC)), b = crownN(q); return [a[0] * 0.62 + b[0] * 0.38, a[1] * 0.62 + b[1] * 0.38 + 0.12, a[2] * 0.62 + b[2] * 0.38]; };
        const depth = 0.72 + 0.28 * smooth(-0.8, 0.5, (p[1] - C[1]) / RY);
        const nTop = lvl ? 2 : 5, nSide = lvl ? 2 : 3;
        for (let i = 0; i < nTop; i++) {
          const W = (r / 0.44) * jit(0.16), yaw = rnd() * TAU, tx = (rnd() - 0.5) * 0.34, tz = (rnd() - 0.5) * 0.34;
          const ax = [Math.cos(yaw) * W, tx * W, Math.sin(yaw) * W], ay = [-Math.sin(yaw) * W, tz * W, Math.cos(yaw) * W];
          const o = [p[0] + (rnd() - 0.5) * r * 0.5, p[1] + r * (0.02 + 0.13 * i) + (lvl ? r * 0.12 : 0), p[2] + (rnd() - 0.5) * r * 0.5];
          const k = (0.8 + 0.2 * (i + 1) / nTop) * depth * jit(0.12);
          cardQuad(Q, [o[0] - (ax[0] + ay[0]) / 2, o[1] - (ax[1] + ay[1]) / 2, o[2] - (ax[2] + ay[2]) / 2], ax, ay, CELL.pineTop, rnd() < 0.5, () => [k, k, k], nrm, rnd(), 0.7, 0.6);
        }
        for (let i = 0; i < nSide; i++) {
          const W = (2 * r / 0.86) * jit(0.14), yaw = (i / nSide) * PI + rnd() * 0.6;
          const ax = [Math.cos(yaw) * W, 0, Math.sin(yaw) * W], ay = [(rnd() - 0.5) * 0.16 * W, W, (rnd() - 0.5) * 0.16 * W];
          const bl = [p[0] - ax[0] / 2 - ay[0] * 0.3, p[1] - 0.06 * r - W * 0.30, p[2] - ax[2] / 2 - ay[2] * 0.3];
          const k = depth * jit(0.12);
          cardQuad(Q, bl, ax, ay, CELL.pineSide, rnd() < 0.5, (q) => { const g = k * (0.66 + 0.34 * smooth(p[1] - r * 0.2, p[1] + r * 0.5, q[1])); return [g, g, g]; }, nrm, rnd(), 0.6, 0.6);
        }
        if (!lvl) {   // the shoot that carries the pad
          const d = V3.norm([tip.d[0], tip.d[1] * 0.5 + 0.2, tip.d[2]]), side = V3.norm(V3.cross(d, [0, 1, 0])), W = r * 1.5;
          const k = depth * 0.9;
          cardQuad(Q, V3.mad(V3.mad(p, d, -W * 0.72), side, -W / 2), V3.mul(side, W), V3.mul(d, W), CELL.pineTwig, rnd() < 0.5, () => [k, k, k], nrm, rnd(), 0.6, 0.6);
        }
      }
    } else if (sp === 'conifer') {
      const axis = (y) => { const t = clamp((y + 0.5) / (H + 0.5), 0, 1), b = T.branches[0].pts; return [b[5][0] * t, b[5][2] * t]; };
      const nrm = (q) => { const a = axis(q[1]); const rx2 = q[0] - a[0], rz2 = q[2] - a[1], l = Math.hypot(rx2, rz2) || 1; return [rx2 / l * 0.8, 0.55, rz2 / l * 0.8]; };
      const list = lvl ? T.sprays.filter((s, i) => i % 5 !== 4 && (i % 5 !== 2 || s.t < 0.4)) : T.sprays;
      for (const s of list) {
        const dir = V3.norm(V3.sub(s.b, s.a)), side = V3.norm(V3.cross(dir, [0, 1, 0])), up = V3.cross(side, dir);
        const L = s.len * 1.22 * (lvl ? 1.1 : 1), a = V3.mad(s.a, dir, -L * 0.03);
        let kk = jit(0.14);
        const inner = (q) => { const ax2 = axis(q[1]), d = Math.hypot(q[0] - ax2[0], q[2] - ax2[1]); const g = (0.52 + 0.48 * smooth(0.2, s.len * 0.75, d)) * (0.82 + 0.18 * s.t) * kk; return [g, g, g]; };
        // the curtain of needles that hangs from the branch (seen from the side: the layered cone)
        const Hc = L * (0.62 + rnd() * 0.12);
        cardQuad(Q, V3.mad(a, up, -Hc * 0.62), V3.mul(dir, L), V3.mul(up, Hc), s.t > 0.75 ? CELL.firB : CELL.fir, rnd() < 0.5, inner, nrm, rnd(), 0.5, 0.7);
        // the frond itself, rolled a little (seen from above and from below)
        if (!lvl || s.t < 0.55) {
          kk = jit(0.14);
          const roll = (rnd() - 0.5) * 0.7, W = L * 0.85, ay = [side[0] * Math.cos(roll) + up[0] * Math.sin(roll), side[1] * Math.cos(roll) + up[1] * Math.sin(roll), side[2] * Math.cos(roll) + up[2] * Math.sin(roll)];
          cardQuad(Q, V3.mad(a, ay, -W / 2), V3.mul(dir, L), V3.mul(ay, W), CELL.fir, rnd() < 0.5, inner, nrm, rnd(), 0.5, 0.7);
        }
      }
      // the spire
      for (let i = 0; i < 2; i++) {
        const yaw = i * PI / 2 + rnd(), h = T.spire.h * (lvl ? 1.2 : 1), w = h * 0.55, side = [Math.cos(yaw), 0, Math.sin(yaw)];
        cardQuad(Q, V3.mad(T.spire.p, side, -w / 2), [0, h, 0], V3.mul(side, w), CELL.firB, false, () => [0.95, 0.95, 0.95], nrm, rnd(), 0.5, 0.8);
      }
    } else {
      const B = BROAD[sp];
      for (const tip of T.tips) {
        const p = tip.p, out = V3.norm([p[0] - C[0], (p[1] - C[1]) * 0.6, p[2] - C[2]]);
        const n = lvl ? (tip.inner ? 1 : 2) : (tip.inner ? 3 : 6);
        const size = B.card * (lvl ? 1.62 : 1.12) * (tip.inner ? 0.92 : 1);
        for (let i = 0; i < n; i++) {
          const c = size * jit(0.3), kind = lvl ? i : i % 3, spray = !lvl && i >= 3;
          let m;
          if (kind === 0) m = V3.norm([out[0] + (rnd() - 0.5) * 1.3, (rnd() - 0.5) * 0.5, out[2] + (rnd() - 0.5) * 1.3]);
          else if (kind === 1) m = V3.norm([(rnd() - 0.5) * (sp === 'maple' ? 0.5 : 0.9), 1, (rnd() - 0.5) * (sp === 'maple' ? 0.5 : 0.9)]);
          else m = V3.norm([rnd() - 0.5, (rnd() - 0.5) * 0.8, rnd() - 0.5]);
          let ux = V3.norm(V3.cross(m, Math.abs(m[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0])), uy = V3.cross(m, ux);
          let bl;
          if (spray) {
            // the spray grows away from the twig: its height axis follows the outward direction inside the card plane
            const want = [out[0] + tip.d[0] * 0.6, out[1] + 0.35, out[2] + tip.d[2] * 0.6], d = V3.dot(want, m);
            uy = V3.norm([want[0] - m[0] * d, want[1] - m[1] * d, want[2] - m[2] * d]); ux = V3.cross(uy, m);
            bl = V3.mad(V3.mad(p, ux, -c / 2), uy, -c * 0.08);
          } else {
            const a = rnd() * TAU, ca = Math.cos(a), sa = Math.sin(a);
            const u2 = [ux[0] * ca + uy[0] * sa, ux[1] * ca + uy[1] * sa, ux[2] * ca + uy[2] * sa];
            uy = [uy[0] * ca - ux[0] * sa, uy[1] * ca - ux[1] * sa, uy[2] * ca - ux[2] * sa]; ux = u2;
            const o = [p[0] + (rnd() - 0.5) * tip.r * 0.9 + out[0] * tip.r * 0.25, p[1] + (rnd() - 0.5) * tip.r * 0.7, p[2] + (rnd() - 0.5) * tip.r * 0.9 + out[2] * tip.r * 0.25];
            bl = [o[0] - (ux[0] + uy[0]) * c / 2, o[1] - (ux[1] + uy[1]) * c / 2, o[2] - (ux[2] + uy[2]) * c / 2];
          }
          const k = jit(0.16), warm = 1 + (rnd() - 0.5) * 0.1;
          const cell = sp === 'maple' && T.red ? CELL.mapRed : B.cells[spray ? 1 : 0];
          cardQuad(Q, bl, V3.mul(ux, c), V3.mul(uy, c), cell, rnd() < 0.5, (q) => { const g = crownAO(q) * k; return [g * warm, g, g * (2 - warm)]; },
            (q) => { const a = crownN(q); return [a[0] * 0.84 + m[0] * 0.16 * Math.sign(V3.dot(m, a) || 1), a[1] * 0.84 + m[1] * 0.16 * Math.sign(V3.dot(m, a) || 1), a[2] * 0.84 + m[2] * 0.16 * Math.sign(V3.dot(m, a) || 1)]; },
            rnd(), 1, 0.8);
        }
      }
    }
    // ---- bounds
    let rad = 0, top = 0;
    for (let i = 0; i < Q.n * 4; i++) { const x = Q.P[i * 3], y = Q.P[i * 3 + 1], z = Q.P[i * 3 + 2]; rad = Math.max(rad, Math.hypot(x, z)); if (y > top) top = y; }
    const n = Q.n;
    return { n, wood, P: Q.P.subarray(0, n * 12), N: Q.N.subarray(0, n * 12), U: Q.U.subarray(0, n * 8), C: Q.C.subarray(0, n * 16), W: Q.W.subarray(0, n * 16), radius: rad, top, H, crown: [C[0], C[1], C[2], RX, RY] };
  }
  VEG.SPECIES = ['pine', 'oak', 'maple', 'zelkova', 'conifer'];
  VEG.VARIANTS = 4;
  /** every template: tpl[species][variant] = [level 0, level 1]. Seeded: the same trees on every device. */
  function buildTemplates() {
    const out = {};
    VEG.SPECIES.forEach((sp, si) => {
      out[sp] = [];
      for (let v = 0; v < VEG.VARIANTS; v++) {
        const seed = 9000 + si * 100 + v * 7, rnd = G.util.rng(seed);
        const T = sp === 'pine' ? growPine(rnd, v) : sp === 'conifer' ? growConifer(rnd, v) : growBroad(rnd, v, sp);
        if (sp === 'maple' && v === 3) T.red = true;   // 홍단풍: the red garden maple
        out[sp].push([emitTree(T, 0, G.util.rng(seed + 1)), emitTree(T, 1, G.util.rng(seed + 2))]);
      }
    });
    return out;
  }
  // ---------------------------------------------------------------- impostors (the far level)
  /**
   * Every species × variant seen from the side (orthographic, looking along −z) in one cell of two images: colour
   * (the atlas texels of each card × its baked shade; bark in its own tint) and normal (the cards' spherised
   * normals, billboard space: x right, y up, z towards the viewer). A small painter's-order rasteriser over typed
   * arrays — no GL and no canvas, so a lost context cannot hurt it and premultiplied alpha never comes into it.
   * The level-1 templates are drawn: at the 110 m hand-over the billboard shows the same cards. A generator.
   */
  function* bakeImpostors(tpl, atlas, cellPx) {
    const cols = VEG.SPECIES.length, rows = VEG.VARIANTS, W = cols * cellPx, HH = rows * cellPx;
    const acc = new Float32Array(W * HH * 4), nor = new Float32Array(W * HH * 3);
    const cells = [];
    const aW0 = atlas[0].width, cellA = aW0 / VEG.CELLS;
    for (let si = 0; si < cols; si++) {
      cells.push([]);
      for (let v = 0; v < rows; v++) {
        const t = tpl[VEG.SPECIES[si]][v][1];
        const ww = 2 * t.radius * 1.04, wh = (t.top + 0.3) * 1.03, sx = cellPx / ww, sy = cellPx / wh;
        const x0 = si * cellPx, y0 = v * cellPx;
        cells[si].push({ w: ww, h: wh });
        // far quads first
        const order = new Int32Array(t.n), key = new Float32Array(t.n);
        for (let q = 0; q < t.n; q++) { order[q] = q; key[q] = t.P[q * 12 + 2] + t.P[q * 12 + 5] + t.P[q * 12 + 8] + t.P[q * 12 + 11]; }
        order.sort((a, b) => key[a] - key[b]);
        for (let oi = 0; oi < t.n; oi++) {
          const q = order[oi], p = q * 12;
          const ax = x0 + (t.P[p] + ww / 2) * sx, ay = y0 + cellPx - (t.P[p + 1] + 0.3) * sy;
          const bx = x0 + (t.P[p + 3] + ww / 2) * sx, by = y0 + cellPx - (t.P[p + 4] + 0.3) * sy;
          const cx = x0 + (t.P[p + 6] + ww / 2) * sx, cy = y0 + cellPx - (t.P[p + 7] + 0.3) * sy;
          const e1x = bx - ax, e1y = by - ay, e2x = cx - ax, e2y = cy - ay, det = e1x * e2y - e1y * e2x;
          if (Math.abs(det) < 0.6) continue;   // edge-on
          const dx = bx + e2x, dy = by + e2y;
          const mnx = Math.max(x0, Math.floor(Math.min(ax, bx, cx, dx))), mxx = Math.min(x0 + cellPx - 1, Math.ceil(Math.max(ax, bx, cx, dx)));
          const mny = Math.max(y0, Math.floor(Math.min(ay, by, cy, dy))), mxy = Math.min(y0 + cellPx - 1, Math.ceil(Math.max(ay, by, cy, dy)));
          const leaf = t.C[q * 16 + 3] > 127;
          // atlas level whose texels are about one pixel of this card
          const lv = leaf ? clamp(Math.round(Math.log2(cellA / Math.max(4, Math.hypot(e1x, e1y), Math.hypot(e2x, e2y)))), 0, atlas.length - 3) : 0;
          const am = atlas[lv], aw = am.width, ah = am.height, ad = am.data;
          const u0 = t.U[q * 8], v0 = t.U[q * 8 + 1], u1 = t.U[q * 8 + 2] - u0, v2 = t.U[q * 8 + 5] - v0;
          for (let py = mny; py <= mxy; py++) for (let px = mnx; px <= mxx; px++) {
            const rx = px + 0.5 - ax, ry = py + 0.5 - ay;
            const s = (rx * e2y - ry * e2x) / det, tt = (e1x * ry - e1y * rx) / det;
            if (s < 0 || s > 1 || tt < 0 || tt > 1) continue;
            let r = 1, g = 1, b = 1, a = 1;
            if (leaf) {
              const tx = Math.min(aw - 1, Math.max(0, Math.floor((u0 + s * u1) * aw))), ty = Math.min(ah - 1, Math.max(0, Math.floor((v0 + tt * v2) * ah)));
              const k = (ty * aw + tx) * 4;
              a = ad[k + 3] / 255;
              if (a < 0.04) continue;
              r = S2L[ad[k]]; g = S2L[ad[k + 1]]; b = S2L[ad[k + 2]];
            }
            // corner tints (sqrt-encoded) and normals, bilinear
            const w0 = (1 - s) * (1 - tt), w1 = s * (1 - tt), w2 = (1 - s) * tt, w3 = s * tt, c = q * 16, n = q * 12;
            const tr = (t.C[c] * w0 + t.C[c + 4] * w1 + t.C[c + 8] * w2 + t.C[c + 12] * w3) / 255, tg = (t.C[c + 1] * w0 + t.C[c + 5] * w1 + t.C[c + 9] * w2 + t.C[c + 13] * w3) / 255, tb = (t.C[c + 2] * w0 + t.C[c + 6] * w1 + t.C[c + 10] * w2 + t.C[c + 14] * w3) / 255;
            r *= tr * tr * 4; g *= tg * tg * 4; b *= tb * tb * 4;
            const nx = t.N[n] * w0 + t.N[n + 3] * w1 + t.N[n + 6] * w2 + t.N[n + 9] * w3, ny = t.N[n + 1] * w0 + t.N[n + 4] * w1 + t.N[n + 7] * w2 + t.N[n + 10] * w3, nz = t.N[n + 2] * w0 + t.N[n + 5] * w1 + t.N[n + 8] * w2 + t.N[n + 11] * w3;
            const k2 = py * W + px, ia = 1 - a;
            acc[k2 * 4] = acc[k2 * 4] * ia + r * a; acc[k2 * 4 + 1] = acc[k2 * 4 + 1] * ia + g * a; acc[k2 * 4 + 2] = acc[k2 * 4 + 2] * ia + b * a; acc[k2 * 4 + 3] = acc[k2 * 4 + 3] * ia + a;
            nor[k2 * 3] = nor[k2 * 3] * ia + nx * a; nor[k2 * 3 + 1] = nor[k2 * 3 + 1] * ia + ny * a; nor[k2 * 3 + 2] = nor[k2 * 3 + 2] * ia + nz * a;
          }
        }
        yield;
      }
    }
    // straight-alpha bytes (rows top first, like a canvas read-back)
    const col8 = new Uint8ClampedArray(W * HH * 4), nor8 = new Uint8ClampedArray(W * HH * 4);
    for (let i = 0; i < W * HH; i++) {
      const a = acc[i * 4 + 3];
      if (a > 0.003) {
        col8[i * 4] = L2S[Math.min(1024, Math.round(Math.min(1, acc[i * 4] / a) * 1024))]; col8[i * 4 + 1] = L2S[Math.min(1024, Math.round(Math.min(1, acc[i * 4 + 1] / a) * 1024))]; col8[i * 4 + 2] = L2S[Math.min(1024, Math.round(Math.min(1, acc[i * 4 + 2] / a) * 1024))];
        col8[i * 4 + 3] = Math.round(Math.min(1, a) * 255);
        const l = Math.hypot(nor[i * 3], nor[i * 3 + 1], nor[i * 3 + 2]) || 1;
        nor8[i * 4] = 127.5 + 127.5 * nor[i * 3] / l; nor8[i * 4 + 1] = 127.5 + 127.5 * nor[i * 3 + 1] / l; nor8[i * 4 + 2] = 127.5 + 127.5 * nor[i * 3 + 2] / l;
      } else { nor8[i * 4] = 128; nor8[i * 4 + 1] = 160; nor8[i * 4 + 2] = 230; }
      nor8[i * 4 + 3] = 255;
    }
    yield;
    const cg = bakeMips(col8, W, HH, cols, rows);
    let r = cg.next();
    while (!r.done) { yield; r = cg.next(); }
    const ng = bakeMips(nor8, W, HH, cols, rows, { linear: true, keepAlpha: true });
    let r2 = ng.next();
    while (!r2.done) { yield; r2 = ng.next(); }
    return { color: r.value.mips, normal: r2.value.mips, cells, cols, rows };
  }

  // ---------------------------------------------------------------- shaders
  VEG.U = {
    uFlutter: { value: 1 },                            // leaf flutter (0 with reduce-motion)
    uA2C: { value: 1 },                                // 1: the frame is multisampled (level fades go through the coverage mask)
    uLeafGain: { value: new THREE.Vector3(1, 1, 1) },  // overall leaf albedo (tuning / seasons)
    uTrans: { value: new THREE.Color(0.62, 0.70, 0.24) },   // light that comes through a leaf
    tBark: { value: null }, uBarkGain: { value: new THREE.Vector3(1, 1, 1) },
    uGroundGain: { value: new THREE.Vector3(1, 1, 1) },    // 1 / the mean colour of the grass cells (blades take the terrain's colour)
  };
  const GLSL_VEG_VERT = `
uniform float uTime; uniform vec2 uWind; uniform float uWindStrength; uniform vec2 uGustPos; uniform float uGustAmt;
uniform vec3 uLodC; uniform vec3 uOrigin; uniform vec4 uFade; uniform float uFlutter;
varying vec4 vTint; varying float vFade;
${GLSL_NOISE}
// the swing of the tree that stands at p (m at the top of a 10 m tree = × 0.11): slow, with rolling gusts
float tfSway(vec2 p) {
  float ph = uTime * 1.3 + dot(p, vec2(0.045, 0.06));
  float gust = uGustAmt > 0.001 ? smoothstep(0.45, 0.95, tfNoise(p * 0.011 - uGustPos * 0.011)) * uGustAmt : 0.0;
  return (sin(ph) * 0.65 + sin(ph * 2.27 + 1.7) * 0.3 + gust * 0.9) * uWindStrength;
}
// 1 inside this level's distance band, 0 outside, a ramp at both ends (the next level ramps the other way)
float tfLod(vec2 p) { float d = distance(p, uLodC.xz); return smoothstep(uFade.x, uFade.y, d) * (1.0 - smoothstep(uFade.z, uFade.w, d)); }
`;
  const GLSL_VEG_FRAG = `
varying vec4 vTint; varying float vFade; uniform float uA2C; uniform vec3 uLeafGain;
float tfIgn(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
`;
  // the cross-fade between levels: through the multisample coverage where there is one (5 steps, dithered), else a
  // screen-door pattern. Placed after the alpha test.
  const GLSL_FADE = `
  if ( vFade < 0.999 ) {
    float tfDz = tfIgn( gl_FragCoord.xy );
    #ifdef ALPHA_TO_COVERAGE
      if ( uA2C > 0.5 ) { diffuseColor.a *= clamp( vFade + ( tfDz - 0.5 ) * 0.3, 0.0, 1.0 ); if ( diffuseColor.a <= 0.004 ) discard; }
      else if ( vFade <= tfDz ) discard;
    #else
      if ( vFade <= tfDz ) discard;
    #endif
  }`;
  // leaves are lit softly: the light wraps round the crown, and a leaf between the eye and the sun glows
  const GLSL_LEAF_LIGHT = `
varying vec3 vViewPosition;
uniform vec3 uVegAmb; uniform vec3 uTrans;
struct LambertMaterial { vec3 diffuseColor; float specularStrength; };
void RE_Direct_Lambert( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in LambertMaterial material, inout ReflectedLight reflectedLight ) {
  float tfNl = dot( geometryNormal, directLight.direction );
  float tfLeaf = step( 0.5, vTint.a );
  float tfWrap = 0.42 * tfLeaf;
  float tfDif = saturate( ( tfNl + tfWrap ) / ( 1.0 + tfWrap ) );
  float tfVl = saturate( dot( geometryViewDir, - directLight.direction ) );
  vec3 tfThru = uTrans * tfLeaf * ( 0.16 + 0.84 * tfVl * tfVl ) * saturate( 0.55 - tfNl * 0.55 );
  reflectedLight.directDiffuse += directLight.color * BRDF_Lambert( material.diffuseColor ) * ( tfDif + tfThru );
}
void RE_IndirectDiffuse_Lambert( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in LambertMaterial material, inout ReflectedLight reflectedLight ) {
  reflectedLight.indirectDiffuse += ( irradiance + uVegAmb * PI ) * BRDF_Lambert( material.diffuseColor );
}
#define RE_Direct RE_Direct_Lambert
#define RE_IndirectDiffuse RE_IndirectDiffuse_Lambert
`;
  const NOFLIP = () => THREE.ShaderChunk.normal_fragment_begin.replace('normal *= faceDirection;', '');
  const vegUniforms = (sh, extra) => Object.assign(sh.uniforms, {
    uTime: uniforms.uTime, uWind: uniforms.uWind, uWindStrength: uniforms.uWindStrength, uGustPos: uniforms.uGustPos, uGustAmt: uniforms.uGustAmt, uVegAmb: uniforms.uVegAmb,
  }, VEG.U, extra);
  // batch vertices are already in world space (the mesh matrix is the identity)
  const BATCH_VERT = `
    vec3 transformed = vec3( position );
    transformed.xz += uWind * ( tfSway( position.xz ) * aWind.x * 0.88 );
    transformed.y += sin( uTime * 1.7 + aWind.z * 6.2832 + position.x * 0.3 ) * aWind.w * 0.035 * uWindStrength;
    transformed += normal * ( sin( uTime * 4.6 + aWind.z * 6.2832 + position.z * 1.7 ) * aWind.y * 0.022 * uWindStrength * uFlutter );
    vTint = aTint; vFade = tfLod( position.xz );`;
  /** the material of a quad batch; fade = [in0, in1, out0, out1] metres from the centre */
  function batchMaterial(fade, FU) {
    const m = new THREE.MeshLambertMaterial({ map: VEG.atlasTex, alphaTest: 0.5, alphaToCoverage: true, side: THREE.DoubleSide });
    m.userData.uFade = { value: new THREE.Vector4(fade[0], fade[1], fade[2], fade[3]) };
    m.userData.FU = FU;
    m.onBeforeCompile = (sh) => {
      vegUniforms(sh, { uFade: m.userData.uFade, uLodC: FU.uLodC, uOrigin: FU.uOrigin });
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec4 aTint; attribute vec4 aWind;\n' + GLSL_VEG_VERT)
        .replace('#include <begin_vertex>', BATCH_VERT);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform sampler2D tBark; uniform vec3 uBarkGain;\n' + GLSL_VEG_FRAG)
        .replace('#include <lights_lambert_pars_fragment>', GLSL_LEAF_LIGHT)
        .replace('#include <map_fragment>', `
          vec4 tfLeafT = texture2D( map, vMapUv );
          vec3 tfBarkT = texture2D( tBark, vMapUv ).rgb * uBarkGain;
          float tfIsLeaf = step( 0.5, vTint.a );
          diffuseColor.rgb *= mix( tfBarkT, tfLeafT.rgb * uLeafGain, tfIsLeaf ) * vTint.rgb * vTint.rgb * 4.0;
          diffuseColor.a *= mix( 1.0, tfLeafT.a, tfIsLeaf );`)
        .replace('#include <alphatest_fragment>', '#include <alphatest_fragment>\n' + GLSL_FADE)
        .replace('#include <normal_fragment_begin>', NOFLIP());
    };
    m.customProgramCacheKey = () => 'nat-veg-batch1';
    VEG.atlasUsers.push(m);
    return m;
  }
  /** its shadow twin: the same wind, the same fade, leaf-shaped holes */
  function batchDepthMaterial(main) {
    const d = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: VEG.atlasTex, alphaTest: 0.5, side: THREE.DoubleSide });
    d.onBeforeCompile = (sh) => {
      vegUniforms(sh, { uFade: main.userData.uFade, uLodC: main.userData.FU.uLodC, uOrigin: main.userData.FU.uOrigin });
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec4 aTint; attribute vec4 aWind;\n' + GLSL_VEG_VERT)
        .replace('#include <begin_vertex>', BATCH_VERT);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\n' + GLSL_VEG_FRAG)
        .replace('#include <map_fragment>', `
          if ( vFade < 0.999 && vFade <= tfIgn( gl_FragCoord.xy ) ) discard;
          diffuseColor.a *= mix( 1.0, texture2D( map, vMapUv ).a, step( 0.5, vTint.a ) );`);
    };
    d.customProgramCacheKey = () => 'nat-veg-batch-depth1';
    VEG.atlasUsers.push(d);
    return d;
  }
  /** far trees: one camera-facing quad each, shaded with the baked normals */
  function impostorMaterial(fade, FU) {
    const m = new THREE.MeshLambertMaterial({ map: VEG.impColor, alphaTest: 0.5, alphaToCoverage: true, side: THREE.DoubleSide });
    m.userData.uFade = { value: new THREE.Vector4(fade[0], fade[1], fade[2], fade[3]) };
    m.onBeforeCompile = (sh) => {
      vegUniforms(sh, { uFade: m.userData.uFade, uLodC: FU.uLodC, uOrigin: FU.uOrigin, tImpN: VEG.U.tImpN, uImpUV: VEG.U.uImpUV });
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec4 aTree; attribute vec4 aRect; attribute vec3 aTintI; uniform vec2 uImpUV; varying vec4 vBill;\n' + GLSL_VEG_VERT)
        .replace('#include <beginnormal_vertex>', 'vec3 objectNormal = vec3( 0.0, 1.0, 0.0 );')
        .replace('#include <begin_vertex>', `
          vec2 tfTo = cameraPosition.xz - uOrigin.xz - aTree.xz; float tfTl = length( tfTo );
          vec2 tfF = tfTl > 1e-3 ? tfTo / tfTl : vec2( 0.0, 1.0 ); vec2 tfR = vec2( tfF.y, - tfF.x );
          float tfH = position.y * aRect.w * aTree.w;
          vec3 transformed = vec3( aTree.x, aTree.y - 0.3 * aTree.w, aTree.z ) + vec3( tfR.x, 0.0, tfR.y ) * ( position.x * aRect.z * aTree.w ) + vec3( 0.0, tfH, 0.0 );
          transformed.xz += uWind * ( tfSway( aTree.xz ) * tfH * tfH * 0.00088 );
          vMapUv = aRect.xy + uv * uImpUV;
          vBill = vec4( tfR * sign( aRect.z ), tfF );
          vTint = vec4( aTintI, 1.0 ); vFade = tfLod( aTree.xz );`)
        .replace('#include <project_vertex>', '#include <project_vertex>\nif ( vFade <= 0.002 ) gl_Position = vec4( 2.0, 2.0, 2.0, 1.0 );');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform sampler2D tImpN; varying vec4 vBill;\n' + GLSL_VEG_FRAG)
        .replace('#include <lights_lambert_pars_fragment>', GLSL_LEAF_LIGHT)
        .replace('#include <map_fragment>', `
          vec4 tfT = texture2D( map, vMapUv );
          diffuseColor *= vec4( tfT.rgb * uLeafGain * vTint.rgb * vTint.rgb * 4.0, tfT.a );`)
        .replace('#include <alphatest_fragment>', '#include <alphatest_fragment>\n' + GLSL_FADE)
        .replace('#include <normal_fragment_begin>', `
          float faceDirection = 1.0;
          vec3 tfNb = texture2D( tImpN, vMapUv ).xyz * 2.0 - 1.0;
          vec3 tfNw = vec3( vBill.x, 0.0, vBill.y ) * tfNb.x + vec3( 0.0, tfNb.y, 0.0 ) + vec3( vBill.z, 0.0, vBill.w ) * tfNb.z;
          vec3 normal = normalize( ( viewMatrix * vec4( tfNw, 0.0 ) ).xyz + vec3( 0.0, 0.0, 1e-4 ) );
          vec3 nonPerturbedNormal = normal;`);
    };
    m.customProgramCacheKey = () => 'nat-veg-impostor1';
    VEG.impUsers.push(m);
    return m;
  }

  // ---------------------------------------------------------------- quad batch (levels 0 and 1)
  /**
   * One mesh, one draw call: a pool of fixed chunks of quads with a static index pattern. A tree that comes near is
   * WRITTEN into chunks at the end of the pool (its template quads moved to its place, turned, scaled, tinted); a
   * tree that leaves gives its chunks back and the last chunks of the pool move into the holes. Only the touched
   * chunks are uploaded. Nothing happens per frame.
   */
  class QuadBatch {
    constructor(maxQuads, chunk, material, depth, name, heads, shadows) {
      this.chunk = chunk; this.maxChunks = Math.max(1, Math.floor(maxQuads / chunk)); this.heads = heads;
      const nq = this.maxChunks * chunk, nv = nq * 4, g = new THREE.BufferGeometry();
      const dyn = (a) => { a.setUsage(THREE.DynamicDrawUsage); return a; };
      this.aP = dyn(new THREE.BufferAttribute(new Float32Array(nv * 3), 3));
      this.aN = dyn(new THREE.BufferAttribute(new Int8Array(nv * 3), 3, true));
      this.aU = dyn(new THREE.BufferAttribute(new Float32Array(nv * 2), 2));
      this.aC = dyn(new THREE.BufferAttribute(new Uint8Array(nv * 4), 4, true));
      this.aW = dyn(new THREE.BufferAttribute(new Uint8Array(nv * 4), 4, true));
      g.setAttribute('position', this.aP); g.setAttribute('normal', this.aN); g.setAttribute('uv', this.aU); g.setAttribute('aTint', this.aC); g.setAttribute('aWind', this.aW);
      const idx = new Uint32Array(nq * 6);
      for (let q = 0; q < nq; q++) { const v = q * 4, o = q * 6; idx[o] = v; idx[o + 1] = v + 1; idx[o + 2] = v + 2; idx[o + 3] = v + 2; idx[o + 4] = v + 1; idx[o + 5] = v + 3; }
      g.setIndex(new THREE.BufferAttribute(idx, 1));
      g.setDrawRange(0, 0);
      g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, -1e4, 0), 1);
      const mesh = new THREE.Mesh(g, material);
      mesh.customDepthMaterial = depth; mesh.castShadow = !!shadows; mesh.receiveShadow = !!shadows;
      mesh.matrixAutoUpdate = false; mesh.name = name; mesh.raycast = () => {}; mesh.userData.guardSkip = true; mesh.userData.veg = true;
      this.mesh = mesh; this.geo = g;
      this.used = 0; this.trees = 0;
      this.owner = new Int32Array(this.maxChunks).fill(-1); this.next = new Int32Array(this.maxChunks).fill(-1); this.prev = new Int32Array(this.maxChunks).fill(-1);
      this._tmp = new Int32Array(this.maxChunks);
      this._dirty = new Int32Array(64); this._nd = 0; this._lo = 1e9; this._hi = -1;
    }
    _mark(c) { if (this._nd < 64) this._dirty[this._nd] = c; this._nd++; if (c < this._lo) this._lo = c; if (c > this._hi) this._hi = c; }
    room(quads) { return this.used + Math.ceil(quads / this.chunk) <= this.maxChunks; }
    /** write tree `id` (template t) with the 3×4 matrix m (rows), scale s, leaf tint factors (sqrt space) and bark factor */
    add(id, t, m, s, tr, tg, tb, bk) {
      const ch = this.chunk, need = Math.ceil(t.n / ch);
      if (this.used + need > this.maxChunks) return false;
      const P = this.aP.array, N = this.aN.array, U = this.aU.array, C = this.aC.array, W = this.aW.array;
      const tP = t.P, tN = t.N, tU = t.U, tC = t.C, tW = t.W, is = 127 / s, s2 = s * s;
      let prev = -1;
      for (let c = 0; c < need; c++) {
        const ci = this.used++;
        this.owner[ci] = id; this.prev[ci] = prev; this.next[ci] = -1;
        if (prev >= 0) this.next[prev] = ci; else this.heads[id] = ci;
        prev = ci;
        let vo = ci * ch * 4;
        const v0 = c * ch * 4, v1 = Math.min(t.n, (c + 1) * ch) * 4;
        for (let v = v0; v < v1; v++, vo++) {
          const a = v * 3, x = tP[a], y = tP[a + 1], z = tP[a + 2], nx = tN[a], ny = tN[a + 1], nz = tN[a + 2];
          P[vo * 3] = m[0] * x + m[1] * y + m[2] * z + m[3]; P[vo * 3 + 1] = m[4] * x + m[5] * y + m[6] * z + m[7]; P[vo * 3 + 2] = m[8] * x + m[9] * y + m[10] * z + m[11];
          N[vo * 3] = (m[0] * nx + m[1] * ny + m[2] * nz) * is; N[vo * 3 + 1] = (m[4] * nx + m[5] * ny + m[6] * nz) * is; N[vo * 3 + 2] = (m[8] * nx + m[9] * ny + m[10] * nz) * is;
          U[vo * 2] = tU[v * 2]; U[vo * 2 + 1] = tU[v * 2 + 1];
          const b = v * 4, o = vo * 4;
          if (tC[b + 3]) { C[o] = Math.min(255, tC[b] * tr); C[o + 1] = Math.min(255, tC[b + 1] * tg); C[o + 2] = Math.min(255, tC[b + 2] * tb); C[o + 3] = 255; }
          else { C[o] = Math.min(255, tC[b] * bk); C[o + 1] = Math.min(255, tC[b + 1] * bk); C[o + 2] = Math.min(255, tC[b + 2] * bk); C[o + 3] = 0; }
          W[o] = Math.min(255, tW[b] * s2); W[o + 1] = tW[b + 1]; W[o + 2] = tW[b + 2]; W[o + 3] = tW[b + 3];
        }
        const end = (ci + 1) * ch * 4;
        if (vo < end) P.fill(0, vo * 3, end * 3);   // the rest of the chunk: quads of no size
        this._mark(ci);
      }
      this.trees++;
      return true;
    }
    remove(id) {
      let c = this.heads[id];
      if (c < 0) return;
      const tmp = this._tmp, ch = this.chunk;
      let n = 0;
      while (c >= 0 && n < tmp.length) { tmp[n++] = c; c = this.next[c]; }
      for (let i = 1; i < n; i++) { const v = tmp[i]; let j = i - 1; while (j >= 0 && tmp[j] < v) { tmp[j + 1] = tmp[j]; j--; } tmp[j + 1] = v; }   // descending
      const P = this.aP.array, N = this.aN.array, U = this.aU.array, C = this.aC.array, W = this.aW.array, v4 = ch * 4;
      for (let i = 0; i < n; i++) {
        const h = tmp[i], last = this.used - 1;
        if (h !== last) {
          P.copyWithin(h * v4 * 3, last * v4 * 3, (last + 1) * v4 * 3); N.copyWithin(h * v4 * 3, last * v4 * 3, (last + 1) * v4 * 3);
          U.copyWithin(h * v4 * 2, last * v4 * 2, (last + 1) * v4 * 2); C.copyWithin(h * v4 * 4, last * v4 * 4, (last + 1) * v4 * 4); W.copyWithin(h * v4 * 4, last * v4 * 4, (last + 1) * v4 * 4);
          const o = this.owner[last];
          this.owner[h] = o; this.prev[h] = this.prev[last]; this.next[h] = this.next[last];
          if (this.prev[h] >= 0) this.next[this.prev[h]] = h; else this.heads[o] = h;
          if (this.next[h] >= 0) this.prev[this.next[h]] = h;
          this._mark(h);
        }
        this.owner[last] = -1; this.next[last] = -1; this.prev[last] = -1;
        this.used--;
      }
      this.heads[id] = -1;
      this.trees--;
    }
    /** send what changed to the GPU: the touched chunks one by one, or one span when there are many */
    flush() {
      if (!this._nd) return false;
      const v4 = this.chunk * 4, attrs = [[this.aP, 3], [this.aN, 3], [this.aU, 2], [this.aC, 4], [this.aW, 4]];
      const hi = Math.min(this._hi, Math.max(0, this.used - 1));
      for (const [a, k] of attrs) {
        // ranges of an earlier flush that was never drawn (a hidden forest) are still waiting: keep them — unless
        // they pile up, then the whole array goes up once (no ranges = everything)
        if (a.updateRanges.length > 200) { a.clearUpdateRanges(); a.needsUpdate = true; continue; }
        if (this._nd > 24) { if (hi >= this._lo) a.addUpdateRange(this._lo * v4 * k, (hi - this._lo + 1) * v4 * k); }
        else for (let i = 0; i < this._nd; i++) { const c = this._dirty[i]; if (c < this.used) a.addUpdateRange(c * v4 * k, v4 * k); }
        if (a.updateRanges.length) a.needsUpdate = true;
      }
      this._nd = 0; this._lo = 1e9; this._hi = -1;
      this.geo.setDrawRange(0, this.used * this.chunk * 6);
      return true;
    }
  }

  // ---------------------------------------------------------------- the forest
  const LOD = { near: 40, mid: 110 };   // §16.2: full < 40 m, reduced < 110 m, impostor beyond
  const _fe = new THREE.Euler(), _fm = new THREE.Matrix4(), _m34 = new Float64Array(12);
  /**
   * new Forest(list, opts)   list: [{ x, y, z, s, rot, tiltX?, tiltZ?, sp (species index), v (variant), tint: [r, g, b] }]
   *   opts: { name, shadows, scale (level distances × scale), cap: [near quads, mid quads] }
   *   .group       add it to the scene (two batch meshes + the impostor mesh)
   *   .tick(focus, force)   call every frame: re-buckets a few times per second, inside a small write budget
   *   .stats()     { trees, near, mid, quads: [..], chunks }
   */
  class Forest {
    constructor(list, o = {}) {
      const n = list.length, tpl = VEG.templates;
      this.n = n; this.name = o.name || 'forest';
      this.scale = o.scale || 1;
      this.X = new Float32Array(n); this.Y = new Float32Array(n); this.Z = new Float32Array(n); this.S = new Float32Array(n);
      this.ROT = new Float32Array(n); this.TX = new Float32Array(n); this.TZ = new Float32Array(n);
      this.SV = new Uint8Array(n); this.TINT = new Float32Array(n * 3);
      this.h0 = new Int32Array(n).fill(-1); this.h1 = new Int32Array(n).fill(-1);
      let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9, y0 = 1e9, y1 = -1e9;
      for (let i = 0; i < n; i++) {
        const t = list[i];
        this.X[i] = t.x; this.Y[i] = t.y; this.Z[i] = t.z; this.S[i] = t.s; this.ROT[i] = t.rot || 0; this.TX[i] = t.tiltX || 0; this.TZ[i] = t.tiltZ || 0;
        this.SV[i] = (t.sp | 0) * VEG.VARIANTS + (t.v | 0);
        const c = t.tint || [1, 1, 1];
        this.TINT[i * 3] = Math.sqrt(c[0]); this.TINT[i * 3 + 1] = Math.sqrt(c[1]); this.TINT[i * 3 + 2] = Math.sqrt(c[2]);
        if (t.x < x0) x0 = t.x; if (t.x > x1) x1 = t.x; if (t.z < z0) z0 = t.z; if (t.z > z1) z1 = t.z; if (t.y < y0) y0 = t.y; if (t.y > y1 + 0) y1 = t.y;
      }
      this.box = n ? [x0, y0, z0, x1, y1, z1] : [0, 0, 0, 0, 0, 0];
      this.cx = (x0 + x1) / 2; this.cz = (z0 + z1) / 2; this.rad = n ? Math.hypot(x1 - x0, z1 - z0) / 2 + 30 : 0;
      // capacity: the most trees any focus can have inside each ring (sampled over o.area or the forest's box), in quads
      const cap = o.cap || this._capacity(o.area);
      this.scale0 = this.scale; this.want = this.scale;
      // the level centre and the forest's own origin (a forest may hang in a group that is moved: places)
      this.FU = { uLodC: { value: new THREE.Vector3(0, 0, 0) }, uOrigin: { value: new THREE.Vector3(0, 0, 0) } };
      this.m0 = batchMaterial([0, 0, 0, 0], this.FU);
      this.m1 = batchMaterial([0, 0, 0, 0], this.FU);
      this.mF = impostorMaterial([0, 0, 0, 0], this.FU);
      this._bands();
      this.b0 = new QuadBatch(cap[0], 64, this.m0, batchDepthMaterial(this.m0), this.name + '-near', this.h0, o.shadows);
      this.b1 = new QuadBatch(cap[1], 16, this.m1, batchDepthMaterial(this.m1), this.name + '-mid', this.h1, o.shadows);
      this.far = this._buildFar();
      this.group = new THREE.Group(); this.group.name = this.name;
      this.group.add(this.b0.mesh, this.b1.mesh);
      if (this.far) this.group.add(this.far);
      this._t = 0; this._fx = 1e9; this._fz = 1e9; this._pending = true; this._cand = new Int32Array(Math.min(n, 4096)); this._cd = new Float32Array(this._cand.length);
      this.writes = 0; this.maxTickMs = 0;
    }
    /** membership rings (squared metres, with hysteresis) and the shaders' fade bands for the current scale */
    _bands() {
      const k = this.scale, N = LOD.near * k, M = LOD.mid * k;
      this.r = { in0: (N + 6) * (N + 6), out0: (N + 12) * (N + 12), lo1in: (N - 10) * (N - 10), lo1out: (N - 14) * (N - 14), hi1in: (M + 10) * (M + 10), hi1out: (M + 18) * (M + 18) };
      this.m0.userData.uFade.value.set(-2, -1, N - 4, N + 2);
      this.m1.userData.uFade.value.set(N - 4, N + 2, M - 6, M + 4);
      this.mF.userData.uFade.value.set(M - 6, M + 4, 1e8, 1e9);
    }
    /** shrink / restore the level distances (a quality step while playing); never beyond what the batches were sized for */
    setScale(k) {
      k = Math.min(Math.max(0.3, Number(k) || 1), this.scale0);
      if (k === this.scale) return;
      this.scale = k; this._bands(); this._pending = true;
    }
    /** the scale the quality asks for (the forest may run below it while a spot is crowded) */
    setWant(k) { this.want = Math.min(Math.max(0.3, Number(k) || 1), this.scale0); this.setScale(this.want); }
    /** quads needed for the densest spot (sampled on a 24 m grid over the forest's box) */
    _capacity(area) {
      const tpl = VEG.templates, n = this.n, k = this.scale;
      const R0 = (LOD.near * k + 12), R1 = (LOD.mid * k + 18);
      const b = area ? [area[0], 0, area[1], area[2], 0, area[3]] : this.box;
      let q0 = 0, q1 = 0;
      const SVq0 = new Float32Array(VEG.SPECIES.length * VEG.VARIANTS), SVq1 = new Float32Array(SVq0.length);
      VEG.SPECIES.forEach((sp, si) => { for (let v = 0; v < VEG.VARIANTS; v++) { SVq0[si * VEG.VARIANTS + v] = Math.ceil(tpl[sp][v][0].n / 64) * 64; SVq1[si * VEG.VARIANTS + v] = Math.ceil(tpl[sp][v][1].n / 16) * 16; } });
      const step = 24;
      for (let z = b[2]; z <= b[5] + step; z += step) for (let x = b[0]; x <= b[3] + step; x += step) {
        let a0 = 0, a1 = 0;
        for (let i = 0; i < n; i++) {
          const dx = this.X[i] - x, dz = this.Z[i] - z, d2 = dx * dx + dz * dz;
          if (d2 < R1 * R1) { a1 += SVq1[this.SV[i]]; if (d2 < R0 * R0) a0 += SVq0[this.SV[i]]; }
        }
        if (a0 > q0) q0 = a0; if (a1 > q1) q1 = a1;
      }
      // the sample grid misses peaks between its points: a margin; and a ceiling on the memory (31 bytes per vertex).
      // Where even that is not enough the forest pulls its levels in for a while (tick) instead of dropping trees.
      return [Math.min(Math.ceil(q0 * 1.3) + 2048, 48000), Math.min(Math.ceil(q1 * 1.15) + 1024, 64000)];
    }
    _buildFar() {
      const n = this.n, imp = VEG.imp;
      if (!n || !imp) return null;
      const g = new THREE.InstancedBufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, 0, 0, 0.5, 0, 0, -0.5, 1, 0, 0.5, 1, 0], 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 1, 1], 2));
      g.setIndex([0, 1, 2, 2, 1, 3]);
      const aTree = new Float32Array(n * 4), aRect = new Float32Array(n * 4), aTint = new Uint8Array(n * 4);
      let top = 0;
      for (let i = 0; i < n; i++) {
        const si = Math.floor(this.SV[i] / VEG.VARIANTS), v = this.SV[i] % VEG.VARIANTS, c = imp.cells[si][v];
        aTree[i * 4] = this.X[i]; aTree[i * 4 + 1] = this.Y[i]; aTree[i * 4 + 2] = this.Z[i]; aTree[i * 4 + 3] = this.S[i];
        aRect[i * 4] = si / imp.cols; aRect[i * 4 + 1] = 1 - (v + 1) / imp.rows; aRect[i * 4 + 2] = c.w * (hash01(i, 77) < 0.5 ? -1 : 1); aRect[i * 4 + 3] = c.h;
        aTint[i * 4] = Math.min(255, 127.5 * this.TINT[i * 3]); aTint[i * 4 + 1] = Math.min(255, 127.5 * this.TINT[i * 3 + 1]); aTint[i * 4 + 2] = Math.min(255, 127.5 * this.TINT[i * 3 + 2]);
        top = Math.max(top, c.h * this.S[i], c.w * this.S[i]);
      }
      g.setAttribute('aTree', new THREE.InstancedBufferAttribute(aTree, 4));
      g.setAttribute('aRect', new THREE.InstancedBufferAttribute(aRect, 4));
      g.setAttribute('aTintI', new THREE.InstancedBufferAttribute(aTint, 4, true));
      g.instanceCount = n;
      const b = this.box;
      g.boundingSphere = new THREE.Sphere(new THREE.Vector3((b[0] + b[3]) / 2, (b[1] + b[4]) / 2 + top / 2, (b[2] + b[5]) / 2), Math.hypot(b[3] - b[0], b[4] - b[1] + top, b[5] - b[2]) / 2 + top);
      const mesh = new THREE.Mesh(g, this.mF);
      mesh.name = this.name + '-far'; mesh.castShadow = false; mesh.receiveShadow = false; mesh.matrixAutoUpdate = false; mesh.raycast = () => {};
      mesh.userData.guardSkip = true; mesh.userData.veg = true;
      return mesh;
    }
    _matrix(i) {
      _fe.set(this.TX[i], this.ROT[i], this.TZ[i]); _fm.makeRotationFromEuler(_fe);
      const e = _fm.elements, s = this.S[i];
      _m34[0] = e[0] * s; _m34[1] = e[4] * s; _m34[2] = e[8] * s; _m34[3] = this.X[i];
      _m34[4] = e[1] * s; _m34[5] = e[5] * s; _m34[6] = e[9] * s; _m34[7] = this.Y[i];
      _m34[8] = e[2] * s; _m34[9] = e[6] * s; _m34[10] = e[10] * s; _m34[11] = this.Z[i];
      return _m34;
    }
    _write(batch, lvl, i) {
      const si = Math.floor(this.SV[i] / VEG.VARIANTS), v = this.SV[i] % VEG.VARIANTS, t = VEG.templates[VEG.SPECIES[si]][v][lvl];
      const bk = 0.9 + 0.2 * hash01(i, 5);
      return batch.add(i, t, this._matrix(i), this.S[i], this.TINT[i * 3], this.TINT[i * 3 + 1], this.TINT[i * 3 + 2], bk);
    }
    /** re-bucket by the distance to the world point (wx, wz). force: no write budget (first frame, a teleport) */
    tick(wx, wz, dt, force) {
      if (!this.n) return;
      // into the forest's own space (its group may be translated; rotation / scale of a parent are not supported)
      this.group.updateWorldMatrix(true, false);
      const gm = this.group.matrixWorld.elements, fx = wx - gm[12], fz = wz - gm[14];
      this.FU.uOrigin.value.set(gm[12], gm[13], gm[14]);
      this.FU.uLodC.value.set(fx, 0, fz);
      const jump = Math.hypot(fx - this._fx, fz - this._fz);
      this._t -= dt;
      if (jump > 25) force = true;
      if (!force && !this._pending && this._t > 0 && jump < 3) return;
      const ddx = fx - this.cx, ddz = fz - this.cz, reach = this.rad + LOD.mid * this.scale + 20;
      if (ddx * ddx + ddz * ddz > reach * reach && !this.b0.used && !this.b1.used) { this._t = 0.5; this._fx = fx; this._fz = fz; this._pending = false; return; }
      const t0 = performance.now();
      this._t = 0.2; this._fx = fx; this._fz = fz;
      const X = this.X, Z = this.Z, h0 = this.h0, h1 = this.h1, r = this.r, b0 = this.b0, b1 = this.b1, cand = this._cand, cd = this._cd;
      let nc = 0;
      for (let i = 0, n = this.n; i < n; i++) {
        const dx = X[i] - fx, dz = Z[i] - fz, d2 = dx * dx + dz * dz;
        if (h0[i] >= 0) { if (d2 > r.out0) b0.remove(i); }
        else if (d2 < r.in0 && nc < cand.length) { cand[nc] = i; cd[nc++] = d2; }
        if (h1[i] >= 0) { if (d2 > r.hi1out || d2 < r.lo1out) b1.remove(i); }
        else if (d2 < r.hi1in && d2 > r.lo1in && nc < cand.length) { cand[nc] = -1 - i; cd[nc++] = d2; }
      }
      // writes: nearest first, inside the budget (quads per call) unless forced
      let budget = force ? 1e9 : 2600, left = nc, crowded = false;
      while (left > 0 && budget > 0) {
        let best = -1, bd = 1e30;
        if (force) best = left - 1;
        else for (let k = 0; k < nc; k++) if (cd[k] < bd) { bd = cd[k]; best = k; }
        if (best < 0) break;
        const c = cand[best];
        cd[best] = 1e30; left--;
        const lvl = c < 0 ? 1 : 0, i = c < 0 ? -1 - c : c, batch = lvl ? b1 : b0;
        const tq = VEG.templates[VEG.SPECIES[Math.floor(this.SV[i] / VEG.VARIANTS)]][this.SV[i] % VEG.VARIANTS][lvl].n;
        if (!batch.room(tq)) { this.full = (this.full || 0) + 1; crowded = true; continue; }
        this._write(batch, lvl, i);
        budget -= tq; this.writes++;
      }
      this._pending = left > 0 && budget <= 0;
      // a crowded spot: pull the levels in (trees beyond them become impostors); widen again when there is room
      if (crowded) { this._wide = 0; this.setScale(Math.max(0.5, this.scale * 0.9)); }
      else if (this.scale < this.want) {
        this._wide = (this._wide || 0) + 1;
        if (this._wide > 40 && b0.used < b0.maxChunks * 0.6 && b1.used < b1.maxChunks * 0.6) { this._wide = 0; this.setScale(Math.min(this.want, this.scale * 1.06)); }
      }
      const ch0 = b0.flush(), ch1 = b1.flush();
      if (ch0) this._sphere(b0, h0, 0);
      if (ch1) this._sphere(b1, h1, 1);
      const ms = performance.now() - t0;
      if (ms > this.maxTickMs) this.maxTickMs = ms;
    }
    /** the batch's bounding sphere from the trees it holds */
    _sphere(batch, heads, lvl) {
      let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9, z0 = 1e9, z1 = -1e9, any = false;
      for (let c = 0; c < batch.used; c++) {
        const i = batch.owner[c];
        if (i < 0 || heads[i] !== c) continue;   // once per tree (its head chunk)
        const t = VEG.templates[VEG.SPECIES[Math.floor(this.SV[i] / VEG.VARIANTS)]][this.SV[i] % VEG.VARIANTS][lvl], s = this.S[i], rr = (t.radius + 1.5) * s;
        const x = this.X[i], y = this.Y[i], z = this.Z[i];
        if (x - rr < x0) x0 = x - rr; if (x + rr > x1) x1 = x + rr; if (z - rr < z0) z0 = z - rr; if (z + rr > z1) z1 = z + rr;
        if (y - 1 < y0) y0 = y - 1; if (y + (t.top + 1) * s > y1) y1 = y + (t.top + 1) * s;
        any = true;
      }
      const sph = batch.geo.boundingSphere;
      if (!any) { sph.center.set(0, -1e4, 0); sph.radius = 1; return; }
      sph.center.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
      sph.radius = Math.hypot(x1 - x0, y1 - y0, z1 - z0) / 2 + 2;   // + the reach of the wind
    }
    stats() { return { trees: this.n, scale: +this.scale.toFixed(3), near: this.b0.trees, mid: this.b1.trees, chunks: [this.b0.used, this.b1.used], cap: [this.b0.maxChunks, this.b1.maxChunks], quads: [this.b0.used * 64, this.b1.used * 16], writes: this.writes, full: this.full || 0, maxTickMs: +this.maxTickMs.toFixed(2) }; }
    dispose() {
      this.group.parent?.remove(this.group);
      for (const m of [this.b0.mesh, this.b1.mesh, this.far]) if (m) m.geometry.dispose();
      for (const m of [this.m0, this.m1, this.mF, this.b0.mesh.customDepthMaterial, this.b1.mesh.customDepthMaterial]) {
        m.dispose();
        for (const list of [VEG.atlasUsers, VEG.impUsers]) { const k = list.indexOf(m); if (k >= 0) list.splice(k, 1); }
      }
    }
  }
  VEG.Forest = Forest; VEG.LOD = LOD;
  // ---------------------------------------------------------------- set-up of what every forest shares
  /** paint + bake the foliage atlas (a generator: yields between cells and mip levels) */
  function* genAtlas(size, imgs, dens) {
    const cv = mk2d(size, size);
    if (!cv) return null;
    const pg = paintAtlas(cv.x, size, imgs, 7, dens);
    let r = pg.next();
    while (!r.done) { yield; r = pg.next(); }
    const src = cv.x.getImageData(0, 0, size, size).data;
    freeCanvas(cv.c);
    yield;
    const bg = bakeMips(src, size, size, VEG.CELLS, VEG.CELLS);
    let b = bg.next();
    while (!b.done) { yield; b = bg.next(); }
    return { mips: b.value.mips, photo: (r.value && r.value.photo) || {} };
  }
  /** a painted bark (vertical furrows) for pages without the pack; mean ≈ mid grey */
  function paintedBark() {
    const cv = mk2d(128, 256);
    if (!cv) return null;
    const x = cv.x, r = G.util.rng(4711);
    x.fillStyle = '#8a8a8a'; x.fillRect(0, 0, 128, 256);
    for (let i = 0; i < 520; i++) {
      const px = r() * 128, py = r() * 256, len = 14 + r() * 60, v = 70 + r() * 110;
      x.strokeStyle = css(v, v * 0.97, v * 0.93, 0.5); x.lineWidth = 1 + r() * 3.5;
      x.beginPath(); x.moveTo(px, py); x.bezierCurveTo(px + (r() - 0.5) * 6, py + len * 0.3, px + (r() - 0.5) * 6, py + len * 0.7, px + (r() - 0.5) * 4, py + len); x.stroke();
    }
    const t = new THREE.CanvasTexture(cv.c);
    t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4;
    return t;
  }
  VEG.atlasUsers = []; VEG.impUsers = [];
  /** build the small first versions (painted leaves) so that the trees are complete on the first frame. false = no 2D canvas */
  VEG.setup = function (preset) {
    if (VEG.ready) return true;
    VEG.high = preset.name === 'high';
    VEG.aniso = preset.aniso ?? (VEG.high ? 8 : 4);
    const t0 = performance.now();
    const a = drain(genAtlas(512, {}, 0.55));
    if (!a) return false;
    VEG.atlasMips = a.mips; VEG.atlasTex = mipTexture(a.mips, { aniso: VEG.aniso });
    VEG.templates = buildTemplates();
    const im = drain(bakeImpostors(VEG.templates, a.mips, 64));
    VEG.imp = im; VEG.impColor = mipTexture(im.color, { aniso: 2 });
    VEG.U.tImpN = { value: mipTexture(im.normal, { srgb: false, aniso: 2 }) };
    VEG.U.uImpUV = { value: new THREE.Vector2(1 / im.cols, 1 / im.rows) };
    // bark: the photographed pine bark when the pack is there (a 1×1 placeholder until it is decoded), else painted
    let bark = null;
    const P = G.pack;
    if (P && P.usable && P.usable('mat/pine_bark/c')) {
      bark = P.texture('mat/pine_bark/c', { anisotropy: VEG.aniso, priority: 3 });
      const avg = (P.meta('mat/pine_bark/c') || {}).avg || [124, 104, 83];
      VEG.U.uBarkGain.value.set(1 / Math.max(0.02, S2L[avg[0]]), 1 / Math.max(0.02, S2L[avg[1]]), 1 / Math.max(0.02, S2L[avg[2]]));
    } else {
      bark = paintedBark();
      const g = 1 / S2L[122];
      VEG.U.uBarkGain.value.set(g, g, g);
    }
    VEG.U.tBark.value = bark;
    // ground cover: painted blades first
    const gr = drain(genGround(128, null));
    if (gr) { VEG.groundTex = mipTexture(gr.mips, { aniso: VEG.aniso }); VEG.U.uGroundGain.value.set(gr.gain[0], gr.gain[1], gr.gain[2]); }
    VEG.setupMs = Math.round(performance.now() - t0);
    VEG.atlasSize = 512; VEG.impCell = 64;
    VEG.ready = true;
    return true;
  };
  /**
   * the full-size textures (photographed leaves when imgs has them), built in slices: call .next() while there is
   * time in the frame. Swaps the textures of every material that uses them; no shader is recompiled.
   */
  VEG.upgrade = function* (imgs, size, cellPx) {
    const ag = genAtlas(size, imgs, 1);
    let a = ag.next();
    while (!a.done) { yield; a = ag.next(); }
    if (!a.value) return false;
    const ig = bakeImpostors(VEG.templates, a.value.mips, cellPx);
    let im = ig.next();
    while (!im.done) { yield; im = ig.next(); }
    const old = [VEG.atlasTex, VEG.impColor, VEG.U.tImpN.value];
    VEG.atlasMips = a.value.mips; VEG.atlasTex = mipTexture(a.value.mips, { aniso: VEG.aniso });
    VEG.impColor = mipTexture(im.value.color, { aniso: 2 });
    VEG.U.tImpN.value = mipTexture(im.value.normal, { srgb: false, aniso: 2 });
    for (const m of VEG.atlasUsers) m.map = VEG.atlasTex;
    for (const m of VEG.impUsers) m.map = VEG.impColor;
    yield;
    for (const t of old) t.dispose();
    // ground cover
    const gg = genGround(VEG.high ? 256 : 192, imgs['alpha/grass_blade'] || null);
    let gr = gg.next();
    while (!gr.done) { yield; gr = gg.next(); }
    if (gr.value && VEG.groundTex) {
      const og = VEG.groundTex;
      VEG.groundTex = mipTexture(gr.value.mips, { aniso: VEG.aniso });
      VEG.U.uGroundGain.value.set(gr.value.gain[0], gr.value.gain[1], gr.value.gain[2]);
      for (const m of VEG.groundUsers) m.map = VEG.groundTex;
      yield;
      og.dispose();
    }
    VEG.photo = a.value.photo; VEG.atlasSize = size; VEG.impCell = cellPx;
    return true;
  };
  // ---------------------------------------------------------------- ground cover: grass tufts, wild flowers
  // ground atlas, 4 × 2 cells — top row: grass tufts (lawn, meadow, seeding, weeds); bottom row: flower greenery,
  // its blossoms (same layout, white: tinted per plant), blossoms seen from above, clover
  const GCELL = { lawn: 0, meadow: 1, seed: 2, weed: 3, stems: 4, blooms: 5, bloomsTop: 6, clover: 7 };
  function paintBlade(x, bx, by, len, lean, w, rnd, sh) {
    const tx = bx + lean * len, ty = by - len * Math.sqrt(Math.max(0.05, 1 - lean * lean * 0.6)), mx = bx + lean * len * 0.25, my = by - len * 0.6;
    const g = x.createLinearGradient(bx, by, tx, ty), v = rnd();
    g.addColorStop(0, css((34 + v * 14) * sh, (70 + v * 22) * sh, (26 + v * 10) * sh));
    g.addColorStop(0.55, css((66 + v * 30) * sh, (118 + v * 30) * sh, (40 + v * 14) * sh));
    g.addColorStop(1, css((120 + v * 40) * sh, (152 + v * 28) * sh, (62 + v * 22) * sh));
    x.fillStyle = g; x.beginPath();
    x.moveTo(bx - w / 2, by); x.quadraticCurveTo(mx - w * 0.42, my, tx, ty); x.quadraticCurveTo(mx + w * 0.42, my, bx + w / 2, by); x.closePath(); x.fill();
  }
  function paintTuft(x, ox, oy, S, rnd, kind, blades) {
    x.save(); x.beginPath(); x.rect(ox, oy, S, S); x.clip();
    const bx = ox + S * 0.5, by = oy + S * 0.985;
    const n = kind === GCELL.weed ? 9 : kind === GCELL.lawn ? 22 : 18, tall = kind === GCELL.lawn ? 0.62 : 0.86;
    const order = [];
    for (let i = 0; i < n; i++) order.push({ d: rnd(), u: (i + rnd()) / n });
    order.sort((a, b) => a.d - b.d);
    for (const o of order) {
      const lean = (o.u - 0.5) * (kind === GCELL.lawn ? 1.25 : 1.0) + (rnd() - 0.5) * 0.3, len = S * tall * (0.55 + rnd() * 0.45) * (1 - Math.abs(lean) * 0.25);
      const px = bx + (o.u - 0.5) * S * 0.3, sh = 0.62 + 0.38 * o.d;
      if (blades && blades.rects.length && rnd() < 0.55) {
        // a photographed blade, stretched to the length and leaned
        const b = blades.rects[Math.floor(rnd() * blades.rects.length)], w = Math.max(S * 0.03, len * b[2] / b[3] * 1.6);
        x.save(); x.translate(px, by); x.rotate(Math.atan2(lean, 1)); x.globalAlpha = 1;
        x.drawImage(blades.img, b[0], b[1], b[2], b[3], -w / 2, -len, w, len);
        x.restore();
      } else paintBlade(x, px, by, len, lean, S * (0.028 + rnd() * 0.02), rnd, sh);
    }
    if (kind === GCELL.seed) {
      for (let i = 0; i < 4; i++) {
        const lean = (rnd() - 0.5) * 0.5, len = S * (0.8 + rnd() * 0.16), tx = bx + lean * len, ty = by - len * 0.97;
        x.strokeStyle = css(120, 132, 66); x.lineWidth = Math.max(1, S * 0.008); x.beginPath(); x.moveTo(bx + (rnd() - 0.5) * S * 0.1, by); x.quadraticCurveTo(bx + lean * len * 0.3, by - len * 0.6, tx, ty); x.stroke();
        x.fillStyle = css(176, 160, 96);
        for (let k = 0; k < 9; k++) { x.beginPath(); x.ellipse(tx + (rnd() - 0.5) * S * 0.03 - lean * k * S * 0.006, ty + k * S * 0.016, S * 0.012, S * 0.02, lean, 0, TAU); x.fill(); }
      }
    }
    if (kind === GCELL.weed) {
      for (let i = 0; i < 7; i++) {
        const a = -PI / 2 + (i / 6 - 0.5) * 2.3 + (rnd() - 0.5) * 0.3, len = S * (0.3 + rnd() * 0.22), v = rnd();
        x.save(); x.translate(bx, by); x.rotate(a + PI / 2);
        const g = x.createLinearGradient(0, 0, 0, -len); g.addColorStop(0, css(40 + v * 20, 84 + v * 20, 30)); g.addColorStop(1, css(92 + v * 30, 140 + v * 24, 52));
        x.fillStyle = g; x.beginPath(); x.moveTo(0, 0); x.bezierCurveTo(-len * 0.3, -len * 0.4, -len * 0.22, -len * 0.85, 0, -len); x.bezierCurveTo(len * 0.22, -len * 0.85, len * 0.3, -len * 0.4, 0, 0); x.fill();
        x.restore();
      }
    }
    x.restore();
  }
  /** flower plants: stems (cell `stems`) and their blossoms (cell `blooms`, same positions), blossoms from above, clover */
  function paintFlowers(x, S, oxS, oxB, oxT, oxC, oy, rnd) {
    const tops = [];
    x.save(); x.beginPath(); x.rect(oxS, oy, S, S); x.clip();
    for (let i = 0; i < 6; i++) {
      const bx = oxS + S * (0.5 + (rnd() - 0.5) * 0.16), by = oy + S * 0.985, lean = (i / 5 - 0.5) * 0.9 + (rnd() - 0.5) * 0.2, len = S * (0.5 + rnd() * 0.34);
      const tx = bx + lean * len * 0.6, ty = by - len;
      x.strokeStyle = css(58, 110, 40); x.lineWidth = Math.max(1, S * 0.012); x.lineCap = 'round';
      x.beginPath(); x.moveTo(bx, by); x.quadraticCurveTo(bx + lean * len * 0.15, by - len * 0.6, tx, ty); x.stroke();
      for (let k = 1; k < 4; k++) {   // leaves along the stem
        const t = k / 4.4, px = bx + (tx - bx) * t * t * 0.9 + lean * len * 0.1 * t, py = by + (ty - by) * t, side = (k & 1) ? 1 : -1, ll = S * (0.1 + rnd() * 0.06);
        x.save(); x.translate(px, py); x.rotate(side * (0.9 + rnd() * 0.4));
        x.fillStyle = css(60 + rnd() * 26, 118 + rnd() * 26, 42); x.beginPath(); x.moveTo(0, 0); x.quadraticCurveTo(ll * 0.3, -ll * 0.5, 0, -ll); x.quadraticCurveTo(-ll * 0.3, -ll * 0.5, 0, 0); x.fill();
        x.restore();
      }
      tops.push([tx - oxS, ty - oy, S * (0.085 + rnd() * 0.04)]);
    }
    x.restore();
    const daisy = (cx, cy, r, squash) => {
      const np = 9 + Math.floor(rnd() * 4), a0 = rnd() * TAU;
      for (let k = 0; k < np; k++) {
        const a = a0 + (k / np) * TAU, v = 232 + rnd() * 23;
        x.fillStyle = css(v, v, v);
        x.beginPath(); x.ellipse(cx + Math.cos(a) * r * 0.55, cy + Math.sin(a) * r * 0.55 * squash, r * 0.5, r * 0.2, Math.atan2(Math.sin(a) * squash, Math.cos(a)), 0, TAU); x.fill();
      }
      x.fillStyle = css(128, 118, 96); x.beginPath(); x.ellipse(cx, cy, r * 0.26, r * 0.26 * squash, 0, 0, TAU); x.fill();
    };
    x.save(); x.beginPath(); x.rect(oxB, oy, S, S); x.clip();
    for (const t of tops) daisy(oxB + t[0], oy + t[1], t[2], 0.62);
    x.restore();
    x.save(); x.beginPath(); x.rect(oxT, oy, S, S); x.clip();
    for (let i = 0; i < 7; i++) { const a = rnd() * TAU, d = Math.sqrt(rnd()) * S * 0.33; daisy(oxT + S * 0.5 + Math.cos(a) * d, oy + S * 0.5 + Math.sin(a) * d, S * (0.09 + rnd() * 0.05), 1); }
    x.restore();
    x.save(); x.beginPath(); x.rect(oxC, oy, S, S); x.clip();
    for (let i = 0; i < 26; i++) {   // clover: three round leaflets on short stalks
      const px = oxC + S * (0.12 + rnd() * 0.76), py = oy + S * (0.45 + rnd() * 0.48), r = S * (0.035 + rnd() * 0.025), v = rnd();
      x.strokeStyle = css(52, 100, 40); x.lineWidth = Math.max(1, S * 0.008); x.beginPath(); x.moveTo(px, py); x.lineTo(px + (rnd() - 0.5) * r, oy + S * 0.985); x.stroke();
      for (let k = 0; k < 3; k++) { const a = -PI / 2 + (k - 1) * 2.1; x.fillStyle = css(48 + v * 30, 110 + v * 34, 44 + v * 10); x.beginPath(); x.arc(px + Math.cos(a) * r * 0.8, py + Math.sin(a) * r * 0.8, r, 0, TAU); x.fill(); }
    }
    x.restore();
  }
  /** paint + bake the ground atlas (generator) → { mips, gain: 1 / mean linear colour of the grass cells } */
  function* genGround(S, bladeImg) {
    const cv = mk2d(S * 4, S * 2);
    if (!cv) return null;
    const x = cv.x, rnd = G.util.rng(31337);
    let blades = null;
    if (bladeImg) { const rects = packLeaves(bladeImg, [0, 2]).filter((b) => b[3] > b[2] * 2.2 && b[3] > 60); if (rects.length >= 3) blades = { img: bladeImg, rects }; }
    for (const k of [GCELL.lawn, GCELL.meadow, GCELL.seed, GCELL.weed]) { paintTuft(x, k * S, 0, S, rnd, k, blades); yield; }
    paintFlowers(x, S, 0, S, S * 2, S * 3, S, rnd);
    yield;
    const src = x.getImageData(0, 0, S * 4, S * 2).data;
    freeCanvas(cv.c);
    yield;
    const bg = bakeMips(src, S * 4, S * 2, 4, 2);
    let b = bg.next();
    while (!b.done) { yield; b = bg.next(); }
    const m = b.value.mean;
    let r = 0, g = 0, bl = 0;
    for (let c = 0; c < 3; c++) { r += S2L[Math.round(m[c * 3])]; g += S2L[Math.round(m[c * 3 + 1])]; bl += S2L[Math.round(m[c * 3 + 2])]; }
    return { mips: b.value.mips, gain: [3 / Math.max(0.01, r), 3 / Math.max(0.01, g), 3 / Math.max(0.01, bl)], photo: !!blades };
  }
  /**
   * grass: tufts of three crossed blade cards on the GPU. Every instance lives in a square tile that wraps around a
   * moving centre (the player for the dense lawn layer, a point ahead of the camera for the wide meadow layer), so
   * the ring follows the player and nothing is re-seeded on the CPU. Height and mask come from the terrain's
   * textures (no grass on paving, roads, yards, water), the colour from the terrain colour under each tuft.
   * layers: [{ tile (m), count, size }]
   */
  function buildGrassMesh(terr, layers, shadows) {
    const base = [], uvs = [], idx = [];
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * PI + 0.3, c = Math.cos(a), s = Math.sin(a), v = i * 4;
      base.push(-0.5 * c, 0, -0.5 * s, 0.5 * c, 0, 0.5 * s, -0.5 * c, 1, -0.5 * s, 0.5 * c, 1, 0.5 * s);
      uvs.push(0, 0, 1, 0, 0, 1, 1, 1);
      idx.push(v, v + 1, v + 2, v + 2, v + 1, v + 3);
    }
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(base, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    g.setIndex(idx);
    let total = 0;
    for (const l of layers) total += l.count;
    const off = new Float32Array(total * 4), lay = new Float32Array(total * 2), rnd = G.util.rng(6060);
    // the layers are mixed in the buffer: a lower instanceCount (a quality step down) thins every layer alike
    const left = layers.map((l) => l.count);
    for (let k = 0, li = 0; k < total; k++) {
      do { li = Math.floor(rnd() * layers.length); } while (!left[li]);
      left[li]--;
      off[k * 4] = rnd(); off[k * 4 + 1] = rnd(); off[k * 4 + 2] = rnd() * TAU; off[k * 4 + 3] = rnd(); lay[k * 2] = layers[li].tile; lay[k * 2 + 1] = layers[li].size;
    }
    g.setAttribute('aOff', new THREE.InstancedBufferAttribute(off, 4));
    g.setAttribute('aLay', new THREE.InstancedBufferAttribute(lay, 2));
    g.instanceCount = total;
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
    const gu = { uGrassNear: { value: new THREE.Vector2() }, uGrassFar: { value: new THREE.Vector2() }, uPlayer: { value: new THREE.Vector2(9999, 9999) } };
    const mat = new THREE.MeshLambertMaterial({ map: VEG.groundTex, alphaTest: 0.5, alphaToCoverage: true, side: THREE.DoubleSide });
    mat.onBeforeCompile = (sh) => {
      vegUniforms(sh, Object.assign({}, terr.uniforms, gu));
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>
          attribute vec4 aOff; attribute vec2 aLay;
          uniform vec2 uGrassNear; uniform vec2 uGrassFar; uniform vec2 uPlayer;
          uniform float uTime; uniform vec2 uWind; uniform float uWindStrength; uniform vec2 uGustPos; uniform float uGustAmt;
          uniform sampler2D tTerrColor; uniform sampler2D tGrassMask;
          varying vec3 vGrassCol; varying vec4 vTint; varying float vFade;
          ${terr.glslTerrain}
          ${GLSL_NOISE}`)
        .replace('#include <beginnormal_vertex>', 'vec3 objectNormal = vec3( 0.0, 1.0, 0.0 );')
        .replace('#include <begin_vertex>', `
          float tfT = aLay.x;
          vec2 tfCtr = tfT < 40.0 ? uGrassNear : uGrassFar;
          vec2 tfC = tfCtr - tfT * 0.5;
          vec2 tfP = tfC + mod( aOff.xy * tfT - tfC, tfT );
          vec2 tfUv = ( tfP - uTerrBox.x ) / uTerrBox.y;
          float tfMask = ( tfUv.x <= 0.0 || tfUv.y <= 0.0 || tfUv.x >= 1.0 || tfUv.y >= 1.0 ) ? 0.0 : texture2D( tGrassMask, tfUv ).r;
          float tfFadeR = 1.0 - smoothstep( tfT * 0.31, tfT * 0.48, distance( tfP, tfCtr ) );
          // a mask of 0 (paving, roads, yards, the lookout deck) always means no tuft
          float tfScale = ( 0.72 + fract( aOff.w * 13.71 ) * 0.56 ) * smoothstep( aOff.w - 0.12, aOff.w + 0.02, tfMask ) * step( 0.004, tfMask ) * tfFadeR * aLay.y;
          float tfCell = floor( fract( aOff.w * 7.31 ) * 4.0 );
          // lawn tufts stay short; meadow and seeding tufts stand taller where the grass is thick (far from paths)
          float tfHgt = ( tfCell < 0.5 ? 0.36 : tfCell < 2.5 ? 0.62 : 0.34 ) * ( 0.62 + 0.55 * tfMask ) * ( tfT < 40.0 ? 0.86 : 1.12 );
          float tfCs = cos( aOff.z ), tfSn = sin( aOff.z );
          vec3 tfL = vec3( position.x * 0.62, position.y * tfHgt, position.z * 0.62 ) * tfScale;
          tfL.xz = vec2( tfCs * tfL.x - tfSn * tfL.z, tfSn * tfL.x + tfCs * tfL.z );
          float tfB = position.y;
          float tfWave = sin( uTime * 1.9 + dot( tfP, vec2( 0.21, 0.13 ) ) ) * 0.45 + sin( uTime * 3.3 + tfP.x * 0.47 ) * 0.15 + ( tfNoise( tfP * 0.045 + uTime * 0.18 ) - 0.5 ) * 1.1;
          // gust waves rolling over the meadow (the blades bend, their backs catch the light)
          float tfGust = uGustAmt > 0.001 ? smoothstep( 0.42, 0.92, tfNoise( tfP * 0.05 - uGustPos * 0.05 ) ) * uWindStrength * uGustAmt : 0.0;
          tfWave += tfGust * 1.6;
          tfL.xz += uWind * tfWave * tfB * tfB * 0.3 * tfHgt * uWindStrength * tfScale;
          vec2 tfD = tfP - uPlayer; float tfPd = length( tfD );
          float tfPush = 1.0 - smoothstep( 0.25, 1.15, tfPd );
          tfL.xz += ( tfD / max( tfPd, 0.01 ) ) * tfPush * tfB * 0.32 * tfScale;
          tfL.y *= 1.0 - tfPush * 0.5;
          vec3 transformed = vec3( tfP.x, terrainH( tfP ) - 0.03, tfP.y ) + tfL;
          vec2 tfCuv = clamp( tfUv, 0.0, 1.0 );
          vec3 tfG = texture2D( tTerrColor, ( tfCuv * ( uTerrN.x - 1.0 ) + 0.5 ) / uTerrN.x ).rgb;
          tfG *= tfG;
          vGrassCol = tfG * ( 0.86 + fract( aOff.w * 7.13 ) * 0.3 ) * ( 1.0 + tfGust * tfB * 0.22 );
          vMapUv = vec2( ( tfCell + uv.x ) * 0.25, 0.5 + uv.y * 0.5 );
          vTint = vec4( 0.5, 0.5, 0.5, 1.0 ); vFade = 1.0;`);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vGrassCol; uniform vec3 uGroundGain;\n' + GLSL_VEG_FRAG)
        .replace('#include <lights_lambert_pars_fragment>', GLSL_LEAF_LIGHT)
        .replace('#include <map_fragment>', `
          vec4 tfT = texture2D( map, vMapUv );
          diffuseColor.rgb *= vGrassCol * tfT.rgb * uGroundGain;
          diffuseColor.a *= tfT.a;`)
        .replace('#include <normal_fragment_begin>', NOFLIP());
    };
    mat.customProgramCacheKey = () => 'nat-veg-grass1';
    VEG.groundUsers.push(mat);
    const mesh = new THREE.Mesh(g, mat);
    mesh.frustumCulled = false; mesh.receiveShadow = !!shadows; mesh.castShadow = false;
    mesh.name = 'grass'; mesh.raycast = () => {}; mesh.userData.guardSkip = true; mesh.userData.veg = true;
    return { mesh, uniforms: gu, count: total };
  }
  VEG.groundUsers = [];
  /**
   * a fixed patch of grass tufts and flower plants (places: the lawns and gardens of the complex). list: [[x, y, z,
   * random, flower 0|1], …] in the parent's coordinates. No terrain textures: the colour is opts colour, the height
   * is in the list. Tufts shrink away beyond ~55 m.
   */
  function patchMesh(list, color, flowerColors, shadows) {
    const tufts = list.filter((p) => !p[4]), flowers = list.filter((p) => p[4]);
    const group = new THREE.Group(), disposables = [];
    if (tufts.length) {
      const base = [], uvs = [], idx = [];
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * PI + 0.3, c = Math.cos(a), s = Math.sin(a), v = i * 4;
        base.push(-0.5 * c, 0, -0.5 * s, 0.5 * c, 0, 0.5 * s, -0.5 * c, 1, -0.5 * s, 0.5 * c, 1, 0.5 * s);
        uvs.push(0, 0, 1, 0, 0, 1, 1, 1);
        idx.push(v, v + 1, v + 2, v + 2, v + 1, v + 3);
      }
      const g = new THREE.InstancedBufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(base, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
      g.setIndex(idx);
      const pos = new Float32Array(tufts.length * 4), box = new THREE.Box3();
      tufts.forEach((p, i) => { pos[i * 4] = p[0]; pos[i * 4 + 1] = p[1]; pos[i * 4 + 2] = p[2]; pos[i * 4 + 3] = p[3]; box.expandByPoint(_p.set(p[0], p[1], p[2])); });
      g.setAttribute('aPos', new THREE.InstancedBufferAttribute(pos, 4));
      g.instanceCount = tufts.length;
      g.boundingSphere = box.getBoundingSphere(new THREE.Sphere()); g.boundingSphere.radius += 1.5;
      const col = new THREE.Color(0.13, 0.215, 0.062);
      if (Array.isArray(color) && color.length === 3) col.setRGB(color[0] / 255, color[1] / 255, color[2] / 255, THREE.SRGBColorSpace);
      else if (color != null) { try { col.set(color); } catch (e) { /* keep the default */ } }
      const U = { uPatchCol: { value: col }, uPlayerL: { value: new THREE.Vector2(9999, 9999) } };
      const mat = new THREE.MeshLambertMaterial({ map: VEG.groundTex, alphaTest: 0.5, alphaToCoverage: true, side: THREE.DoubleSide });
      mat.onBeforeCompile = (sh) => {
        vegUniforms(sh, U);
        sh.vertexShader = sh.vertexShader
          .replace('#include <common>', `#include <common>
            attribute vec4 aPos; uniform vec3 uPatchCol; uniform vec2 uPlayerL;
            uniform float uTime; uniform vec2 uWind; uniform float uWindStrength; uniform vec2 uGustPos; uniform float uGustAmt;
            varying vec3 vGrassCol; varying vec4 vTint; varying float vFade;
            ${GLSL_NOISE}`)
          .replace('#include <beginnormal_vertex>', 'vec3 objectNormal = vec3( 0.0, 1.0, 0.0 );')
          .replace('#include <begin_vertex>', `
            vec2 tfP = aPos.xz;
            vec3 tfWp = ( modelMatrix * vec4( aPos.xyz, 1.0 ) ).xyz;
            float tfScale = ( 0.72 + fract( aPos.w * 13.71 ) * 0.56 ) * ( 1.0 - smoothstep( 46.0, 60.0, distance( tfWp, cameraPosition ) ) );
            float tfCell = floor( fract( aPos.w * 7.31 ) * 4.0 );
            float tfHgt = tfCell < 0.5 ? 0.34 : tfCell < 2.5 ? 0.56 : 0.32;
            float tfRot = aPos.w * 61.7, tfCs = cos( tfRot ), tfSn = sin( tfRot );
            vec3 tfL = vec3( position.x * 0.62, position.y * tfHgt, position.z * 0.62 ) * tfScale;
            tfL.xz = vec2( tfCs * tfL.x - tfSn * tfL.z, tfSn * tfL.x + tfCs * tfL.z );
            float tfB = position.y;
            float tfWave = sin( uTime * 1.9 + dot( tfWp.xz, vec2( 0.21, 0.13 ) ) ) * 0.45 + sin( uTime * 3.3 + tfWp.x * 0.47 ) * 0.15 + ( tfNoise( tfWp.xz * 0.045 + uTime * 0.18 ) - 0.5 ) * 1.1;
            float tfGust = uGustAmt > 0.001 ? smoothstep( 0.42, 0.92, tfNoise( tfWp.xz * 0.05 - uGustPos * 0.05 ) ) * uWindStrength * uGustAmt : 0.0;
            tfWave += tfGust * 1.6;
            tfL.xz += uWind * tfWave * tfB * tfB * 0.3 * tfHgt * uWindStrength * tfScale;
            vec2 tfD = tfP - uPlayerL; float tfPd = length( tfD );
            float tfPush = 1.0 - smoothstep( 0.25, 1.15, tfPd );
            tfL.xz += ( tfD / max( tfPd, 0.01 ) ) * tfPush * tfB * 0.32 * tfScale;
            tfL.y *= 1.0 - tfPush * 0.5;
            vec3 transformed = vec3( aPos.x, aPos.y - 0.03, aPos.z ) + tfL;
            vGrassCol = uPatchCol * ( 0.86 + fract( aPos.w * 7.13 ) * 0.3 ) * ( 1.0 + tfGust * tfB * 0.22 );
            vMapUv = vec2( ( tfCell + uv.x ) * 0.25, 0.5 + uv.y * 0.5 );
            vTint = vec4( 0.5, 0.5, 0.5, 1.0 ); vFade = 1.0;`);
        sh.fragmentShader = sh.fragmentShader
          .replace('#include <common>', '#include <common>\nvarying vec3 vGrassCol; uniform vec3 uGroundGain;\n' + GLSL_VEG_FRAG)
          .replace('#include <lights_lambert_pars_fragment>', GLSL_LEAF_LIGHT)
          .replace('#include <map_fragment>', `
            vec4 tfT = texture2D( map, vMapUv );
            diffuseColor.rgb *= vGrassCol * tfT.rgb * uGroundGain;
            diffuseColor.a *= tfT.a;`)
          .replace('#include <normal_fragment_begin>', NOFLIP());
      };
      mat.customProgramCacheKey = () => 'nat-veg-patch1';
      VEG.groundUsers.push(mat);
      const mesh = new THREE.Mesh(g, mat);
      mesh.receiveShadow = !!shadows; mesh.castShadow = false; mesh.name = 'meadow-grass'; mesh.raycast = () => {}; mesh.userData.guardSkip = true; mesh.userData.veg = true;
      mesh.onBeforeRender = () => {
        const pl = G.sys.player?.position, e = mesh.matrixWorld.elements;
        if (pl && Number.isFinite(pl.x) && Number.isFinite(pl.z)) U.uPlayerL.value.set(pl.x - e[12], pl.z - e[14]); else U.uPlayerL.value.set(9999, 9999);
      };
      group.add(mesh);
      disposables.push(g, mat);
    }
    if (flowers.length) {
      const cols = (Array.isArray(flowerColors) && flowerColors.length ? flowerColors : ['#ffffff', '#ffe066', '#c9a2f0', '#ff9ec6', '#ffb347']);
      const mat = G.gfx.material('nat-veg-flower', () => { const m = cardMaterial('flower', VEG.groundTex, 0.25, 0.004); VEG.groundUsers.push(m); return m; });
      const fg = flowerGeometry(), im = new THREE.InstancedMesh(fg, mat, flowers.length);
      flowers.forEach((p, i) => {
        _e.set((p[3] - 0.5) * 0.3, p[3] * 40, 0); _q.setFromEuler(_e); _p.set(p[0], p[1] - 0.02, p[2]); _s.setScalar(0.7 + p[3] * 0.6);
        im.setMatrixAt(i, _m.compose(_p, _q, _s));
        let c; try { c = _c.set(cols[Math.floor(p[3] * 977) % cols.length]); } catch (e) { c = _c.set(0xffffff); }
        im.setColorAt(i, c);
      });
      im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true;
      im.computeBoundingSphere(); im.receiveShadow = !!shadows; im.name = 'meadow-flowers'; im.raycast = () => {}; im.userData.veg = true;
      group.add(im);
      disposables.push(fg);
    }
    return { mesh: group, dispose: () => { group.parent?.remove(group); for (const d of disposables) { d.dispose(); const k = VEG.groundUsers.indexOf(d); if (k >= 0) VEG.groundUsers.splice(k, 1); } } };
  }

  // ---------------------------------------------------------------- flowers and shrubs: instanced card clusters
  /** geometry of crossed cards. cards: [{ o: [x, y, z] (bottom centre), w, h, yaw, tilt, cell (uv rect), fol, ao: [bottom, top], n: fn(p) }] */
  function cardGeometry(cards) {
    const n = cards.length, P = new Float32Array(n * 12), N = new Float32Array(n * 12), U = new Float32Array(n * 8), C = new Float32Array(n * 12), F = new Float32Array(n * 4), idx = [];
    cards.forEach((c, q) => {
      const cy = Math.cos(c.yaw), sy = Math.sin(c.yaw), ct = Math.cos(c.tilt || 0), st = Math.sin(c.tilt || 0);
      const ax = [cy * c.w, 0, sy * c.w], ay = [-sy * st * c.h, ct * c.h, cy * st * c.h];
      for (let k = 0; k < 4; k++) {
        const fu = k & 1, fv = k >> 1;
        const p = [c.o[0] + ax[0] * (fu - 0.5) + ay[0] * (fv - (c.pivot || 0)), c.o[1] + ay[1] * (fv - (c.pivot || 0)), c.o[2] + ax[2] * (fu - 0.5) + ay[2] * (fv - (c.pivot || 0))];
        const nn = c.n ? V3.norm(c.n(p)) : [0, 1, 0], a = c.ao ? c.ao[0] + (c.ao[1] - c.ao[0]) * fv : 1;
        P.set(p, (q * 4 + k) * 3); N.set(nn, (q * 4 + k) * 3);
        U[(q * 4 + k) * 2] = c.cell[0] + (c.flip ? 1 - fu : fu) * c.cell[2]; U[(q * 4 + k) * 2 + 1] = c.cell[1] + fv * c.cell[3];
        C[(q * 4 + k) * 3] = a; C[(q * 4 + k) * 3 + 1] = a; C[(q * 4 + k) * 3 + 2] = a;
        F[q * 4 + k] = c.fol;
      }
      idx.push(q * 4, q * 4 + 1, q * 4 + 2, q * 4 + 2, q * 4 + 1, q * 4 + 3);
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.BufferAttribute(N, 3)); g.setAttribute('uv', new THREE.BufferAttribute(U, 2));
    g.setAttribute('color', new THREE.BufferAttribute(C, 3)); g.setAttribute('aFoliage', new THREE.BufferAttribute(F, 1));
    g.setIndex(idx);
    g.computeBoundingSphere(); g.computeBoundingBox();
    return g;
  }
  /** a wild flower plant ≈ 0.45 m: two crossed cards (stems with their blossoms) and one card of blossoms seen from above */
  function flowerGeometry() {
    const gc = (i) => [(i % 4) / 4, i < 4 ? 0.5 : 0, 0.25, 0.5];
    return cardGeometry([
      { o: [0, -0.01, 0], w: 0.42, h: 0.46, yaw: 0.2, cell: gc(GCELL.stems), fol: 0, ao: [0.7, 1] },
      { o: [0, -0.01, 0], w: 0.42, h: 0.46, yaw: 0.2 + PI / 2, cell: gc(GCELL.stems), fol: 0, ao: [0.7, 1], flip: true },
      { o: [0, 0.36, 0], w: 0.4, h: 0.4, yaw: 0.9, tilt: PI / 2 - 0.25, pivot: 0.5, cell: gc(GCELL.bloomsTop), fol: 1, ao: [1, 1] },
    ]);
  }
  /** a shrub ≈ 1.5 m wide, 1 m tall: a dome of leaf cards (+ blossom cards that only flowering shrubs show) */
  function shrubGeometry(rnd) {
    const cards = [], tc = (i) => cellUV(i);
    const nrm = (p) => [p[0] * 1.1, (p[1] - 0.25) * 1.5 + 0.25, p[2] * 1.1];
    const ring = (n, r, y, h, w, tilt, cell, fol, ao) => {
      for (let i = 0; i < n; i++) {
        const a = (i / n) * TAU + rnd() * 0.7, rr = r * (0.8 + rnd() * 0.4);
        cards.push({ o: [Math.cos(a) * rr, y + (rnd() - 0.5) * 0.08, Math.sin(a) * rr], w: w * (0.85 + rnd() * 0.3), h: h * (0.85 + rnd() * 0.3), yaw: a + PI / 2 + (rnd() - 0.5) * 0.9, tilt: tilt * (0.6 + rnd() * 0.8) * (rnd() < 0.5 ? -1 : 1), cell: tc(cell), fol, ao, n: nrm, flip: rnd() < 0.5 });
      }
    };
    ring(6, 0.34, -0.06, 0.95, 1.05, 0.3, CELL.shrubB, 1, [0.5, 1]);      // sprays growing up from the base
    ring(5, 0.2, 0.3, 0.95, 1.0, 0.5, CELL.shrub, 1, [0.72, 1]);
    for (let i = 0; i < 3; i++) cards.push({ o: [(rnd() - 0.5) * 0.4, 0.62 + rnd() * 0.16, (rnd() - 0.5) * 0.4], w: 1.0, h: 1.0, yaw: rnd() * TAU, tilt: PI / 2 - 0.3 + rnd() * 0.3, pivot: 0.5, cell: tc(CELL.shrub), fol: 1, ao: [1, 1], n: nrm });
    // blossoms sit just outside the leaves
    ring(5, 0.5, 0.2, 0.7, 0.8, 0.4, CELL.bloom, 0, [0.9, 1]);
    for (let i = 0; i < 2; i++) cards.push({ o: [(rnd() - 0.5) * 0.4, 0.78 + rnd() * 0.1, (rnd() - 0.5) * 0.4], w: 0.9, h: 0.9, yaw: rnd() * TAU, tilt: PI / 2 - 0.2, pivot: 0.5, cell: tc(CELL.bloom), fol: 0, ao: [1, 1], n: nrm });
    return cardGeometry(cards);
  }
  /**
   * instanced card material (flowers: ground atlas; shrubs: foliage atlas). Vertex colour = baked occlusion; the
   * instance colour tints the cards with aFoliage = 1. Flowers (kind 'flower'): aFoliage = 0 cards show the stems and,
   * from the cell next to it, their blossoms tinted with the instance colour. Shrubs (kind 'shrub'): aFoliage = 0
   * cards are blossoms tinted with the instanced attribute aBloom (rgb, amount) and vanish when amount = 0.
   */
  function cardMaterial(kind, map, sway, flutter) {
    const flower = kind === 'flower';
    const m = new THREE.MeshLambertMaterial({ map, vertexColors: true, alphaTest: flower ? 0.4 : 0.5, alphaToCoverage: true, side: THREE.DoubleSide });
    m.onBeforeCompile = (sh) => {
      vegUniforms(sh, {});
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>
          attribute float aFoliage; ${flower ? '' : 'attribute vec4 aBloom;'}
          uniform float uTime; uniform vec2 uWind; uniform float uWindStrength; uniform vec2 uGustPos; uniform float uGustAmt; uniform float uFlutter;
          varying vec4 vTint; varying float vFade; varying vec4 vCard;
          ${GLSL_NOISE}`)
        .replace('#include <color_vertex>', `
          vColor = vec3( 1.0 );
          #ifdef USE_COLOR
            vColor *= color;
          #endif
          vec3 tfIC = vec3( 1.0 );
          #ifdef USE_INSTANCING_COLOR
            tfIC = instanceColor.xyz;
          #endif
          ${flower ? 'vCard = vec4( tfIC, aFoliage ); vColor *= mix( vec3( 1.0 ), tfIC, aFoliage );' : 'vCard = vec4( aBloom.rgb, aFoliage ); vColor *= mix( aBloom.rgb, tfIC, aFoliage );'}`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          #ifdef USE_INSTANCING
            vec3 tfIP = vec3( instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2] );
          #else
            vec3 tfIP = ( modelMatrix * vec4( 0.0, 0.0, 0.0, 1.0 ) ).xyz;
          #endif
          ${flower ? '' : 'transformed *= mix( step( 0.01, aBloom.a ), 1.0, aFoliage );'}
          float tfPh = uTime * 1.3 + dot( tfIP.xz, vec2( 0.11, 0.17 ) );
          float tfGust = uGustAmt > 0.001 ? smoothstep( 0.45, 0.95, tfNoise( tfIP.xz * 0.011 - uGustPos * 0.011 ) ) * uGustAmt : 0.0;
          float tfSw = ( sin( tfPh ) * 0.65 + sin( tfPh * 2.27 + 1.7 ) * 0.3 + tfGust * 0.9 ) * uWindStrength;
          float tfH2 = max( position.y, 0.0 );
          transformed.xz += uWind * tfSw * tfH2 * tfH2 * ${sway.toFixed(4)};
          transformed += normal * ( sin( uTime * 4.6 + position.x * 3.1 + position.z * 2.3 + tfIP.x ) * ${flutter.toFixed(4)} * uWindStrength * uFlutter * step( 0.2, position.y ) );
          vTint = vec4( 0.5, 0.5, 0.5, 1.0 ); vFade = 1.0;`);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec4 vCard;\n' + GLSL_VEG_FRAG)
        .replace('#include <lights_lambert_pars_fragment>', GLSL_LEAF_LIGHT)
        .replace('#include <map_fragment>', flower ? `
          vec4 tfS = texture2D( map, vMapUv );
          // the blossoms of these stems are painted in the next cell at the same place: white, tinted per plant
          vec4 tfB = texture2D( map, vMapUv + vec2( 0.25, 0.0 ) ) * ( 1.0 - vCard.a );
          vec3 tfC = mix( tfS.rgb, tfB.rgb * vCard.rgb, tfB.a );
          diffuseColor.rgb *= mix( tfC, tfS.rgb, vCard.a );
          diffuseColor.a *= max( tfS.a, tfB.a );` : `
          vec4 tfS = texture2D( map, vMapUv );
          diffuseColor *= tfS;`)
        .replace('#include <normal_fragment_begin>', NOFLIP());
    };
    m.customProgramCacheKey = () => `nat-veg-card1-${kind}-${sway}-${flutter}`;
    return m;
  }
  function cardDepthMaterial(kind, map, sway) {
    const flower = kind === 'flower';
    const d = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map, alphaTest: 0.5, side: THREE.DoubleSide });
    d.onBeforeCompile = (sh) => {
      vegUniforms(sh, {});
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>
          attribute float aFoliage; ${flower ? '' : 'attribute vec4 aBloom;'}
          uniform float uTime; uniform vec2 uWind; uniform float uWindStrength; uniform vec2 uGustPos; uniform float uGustAmt;
          ${GLSL_NOISE}`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          #ifdef USE_INSTANCING
            vec3 tfIP = vec3( instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2] );
          #else
            vec3 tfIP = ( modelMatrix * vec4( 0.0, 0.0, 0.0, 1.0 ) ).xyz;
          #endif
          ${flower ? '' : 'transformed *= mix( step( 0.01, aBloom.a ), 1.0, aFoliage );'}
          float tfPh = uTime * 1.3 + dot( tfIP.xz, vec2( 0.11, 0.17 ) );
          float tfGust = uGustAmt > 0.001 ? smoothstep( 0.45, 0.95, tfNoise( tfIP.xz * 0.011 - uGustPos * 0.011 ) ) * uGustAmt : 0.0;
          float tfSw = ( sin( tfPh ) * 0.65 + sin( tfPh * 2.27 + 1.7 ) * 0.3 + tfGust * 0.9 ) * uWindStrength;
          float tfH2 = max( position.y, 0.0 );
          transformed.xz += uWind * tfSw * tfH2 * tfH2 * ${sway.toFixed(4)};`);
    };
    d.customProgramCacheKey = () => `nat-veg-card-depth1-${kind}-${sway}`;
    return d;
  }

  // ---------------------------------------------------------------- rocks: photographed granite, moss on top
  /** world-space triplanar granite (colour; + normals on high) with moss where the rock faces the sky and a dark wet foot at the water line */
  function realRockMaterial(high) {
    const P = G.pack, has = !!(P && P.usable && P.usable('mat/granite_stone/c'));
    const U = {
      tRock: { value: has ? P.texture('mat/granite_stone/c', { anisotropy: VEG.aniso, priority: 3 }) : (VEG.U.tBark.value) },
      tRockN: { value: has && high ? P.texture('mat/granite_stone/n', { anisotropy: VEG.aniso, priority: 5 }) : null },
      uRockGain: { value: new THREE.Vector3(1, 1, 1) }, uRockTile: { value: 1 / 2.4 }, uWaterY: { value: (L.waterY ?? -1.1) },
    };
    if (has) { const a = (P.meta('mat/granite_stone/c') || {}).avg || [148, 145, 136]; U.uRockGain.value.set(1 / S2L[a[0]], 1 / S2L[a[1]], 1 / S2L[a[2]]); }
    else { const g = 1 / S2L[122]; U.uRockGain.value.set(g, g, g); }
    const nrm = !!U.tRockN.value;
    // the photograph is divided by its own mean (gain): the stone's albedo — weathered granite — comes from the colour
    const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0, color: new THREE.Color(0.27, 0.255, 0.23) });
    m.userData.rock = U;
    m.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, U);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aFoliage;\nvarying vec3 vRkP; varying vec3 vRkN;')
        .replace('#include <color_vertex>', COLOR_VERTEX)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          vec4 tfRp = vec4( transformed, 1.0 ); vec3 tfRn = objectNormal;
          #ifdef USE_INSTANCING
            tfRp = instanceMatrix * tfRp; tfRn = mat3( instanceMatrix ) * tfRn;
          #endif
          vRkP = ( modelMatrix * tfRp ).xyz; vRkN = mat3( modelMatrix ) * tfRn;`);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
          varying vec3 vRkP; varying vec3 vRkN;
          uniform sampler2D tRock; uniform vec3 uRockGain; uniform float uRockTile; uniform float uWaterY;
          ${nrm ? 'uniform sampler2D tRockN;' : ''}
          ${GLSL_NOISE}`)
        .replace('#include <map_fragment>', `
          vec3 tfWn = normalize( vRkN );
          vec3 tfBw = pow( abs( tfWn ), vec3( 4.0 ) ); tfBw /= max( tfBw.x + tfBw.y + tfBw.z, 1e-4 );
          vec3 tfRq = vRkP * uRockTile;
          vec3 tfRc = ( texture2D( tRock, tfRq.zy ).rgb * tfBw.x + texture2D( tRock, tfRq.xz ).rgb * tfBw.y + texture2D( tRock, tfRq.xy ).rgb * tfBw.z ) * uRockGain;
          diffuseColor.rgb *= clamp( tfRc, 0.25, 2.2 );
          // moss and lichen where the rock faces the sky, in patches
          float tfMn = tfNoise( vRkP.xz * 1.7 ) * 0.6 + tfNoise( vRkP.xz * 6.3 + 9.0 ) * 0.4;
          float tfMoss = smoothstep( 0.42, 0.78, tfWn.y + ( tfMn - 0.5 ) * 0.7 ) * smoothstep( 0.2, 0.6, tfMn + tfWn.y * 0.3 );
          vec3 tfMc = mix( vec3( 0.075, 0.115, 0.03 ), vec3( 0.16, 0.2, 0.055 ), tfNoise( vRkP.xz * 11.0 ) );
          diffuseColor.rgb = mix( diffuseColor.rgb, tfMc, tfMoss * 0.82 );
          // dark and wet just above the water
          float tfWet = 1.0 - smoothstep( uWaterY + 0.05, uWaterY + 0.5, vRkP.y );
          diffuseColor.rgb *= 1.0 - tfWet * 0.42;`)
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix( mix( 0.86, 1.0, tfMoss ), 0.32, tfWet * 0.8 );')
        .replace('#include <normal_fragment_maps>', nrm ? `#include <normal_fragment_maps>
          {
            // whiteout blend of the three projections, then into view space; fades out with distance
            float tfNf = 1.0 - smoothstep( 18.0, 60.0, length( vViewPosition ) );
            vec3 tfNx = texture2D( tRockN, tfRq.zy ).xyz * 2.0 - 1.0, tfNy = texture2D( tRockN, tfRq.xz ).xyz * 2.0 - 1.0, tfNz = texture2D( tRockN, tfRq.xy ).xyz * 2.0 - 1.0;
            tfNx = vec3( tfNx.xy * tfNf + tfWn.zy, abs( tfNx.z ) * tfWn.x ); tfNy = vec3( tfNy.xy * tfNf + tfWn.xz, abs( tfNy.z ) * tfWn.y ); tfNz = vec3( tfNz.xy * tfNf + tfWn.xy, abs( tfNz.z ) * tfWn.z );
            vec3 tfNn = normalize( tfNx.zyx * tfBw.x + tfNy.xzy * tfBw.y + tfNz.xyz * tfBw.z );
            normal = normalize( ( viewMatrix * vec4( mix( tfNn, tfWn, tfMoss * 0.6 ), 0.0 ) ).xyz );
          }` : '#include <normal_fragment_maps>');
    };
    m.customProgramCacheKey = () => 'nat-veg-rock1' + (nrm ? 'n' : '');
    return m;
  }

  VEG.forests = [];

  // ---------------------------------------------------------------- the system
  const NAT = {
    name: 'nature', order: 12, label: '숲과 자연',
    uniforms,
    riverRocks: [],
    counts: {},
    meshes: {},
    rockGeometry,
    get rockMaterial() { return this.real ? G.gfx.material('nat-veg-rock', () => realRockMaterial(VEG.high)) : rockMaterial(); },
    real: false,
    veg: VEG,
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
    setWind(dx = 0.86, dz = 0.5, strength = 1, fromEngine = false) {
      if (this._engineWind && !fromEngine) return;   // engine.wind leads when the engine provides it
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
      // [render-nature] real vegetation (CONTRACT §16.2) on medium / high. `low`, ?veg=old and a browser without a 2D
      // canvas keep the plain trees, tufts and rocks
      this.real = false;
      if (preset.name !== 'low' && eng.renderer && G.params?.get?.('veg') !== 'old') {
        try { this.real = !!VEG.setup(preset); } catch (e) { this.real = false; G.log.warn('WORLD', 'real vegetation unavailable — the plain trees are used', e?.message || e); }
      }
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
      if (this.real) {
        this._scheduleFoliage();
        G.bus.on('engine:quality', () => this._vegQuality());
        this.counts.vegSetupMs = VEG.setupMs;
      }
      G.log.info('WORLD', 'nature', JSON.stringify(this.counts));
    },

    // ============================================================== [render-nature] real vegetation (medium / high)
    /** the full-size foliage textures: photographed leaves once the pack has decoded them (painted ones in a page
     *  without the pack), built in slices of a few ms per frame; the materials keep their shaders */
    _scheduleFoliage() {
      const P = G.pack, names = ['alpha/oak_leaf', 'alpha/zelkova_leaf', 'alpha/maple_leaf', 'alpha/pine_branch', 'alpha/grass_blade'];
      const start = (imgs) => { if (!this._vegJob && !this._vegDone) this._vegJob = VEG.upgrade(imgs, VEG.high ? 2048 : 1024, VEG.high ? 256 : 128); };
      const usable = !!(P && P.usable && names.some((n) => P.usable(n)));
      if (!usable) { if (G.ready) start({}); else G.bus.on('game:ready', () => start({})); return; }
      Promise.all(names.map((n) => (P.usable(n) ? Promise.resolve(P.image(n, { priority: 4 })).catch(() => null) : Promise.resolve(null)))).then((list) => {
        const imgs = {};
        names.forEach((n, i) => { if (list[i]) imgs[n] = list[i]; });
        start(imgs);
      });
    },
    /** a quality change while playing: the levels of detail shrink / grow, the grass thins (the trees themselves stay) */
    _vegQuality() {
      if (!this.real) return;
      const q = G.sys.engine?.quality || 'high';
      for (const f of VEG.forests) f.setWant(q === 'high' ? 1 : q === 'medium' ? 0.85 : 0.6);
      const g = this.meshes.grass;
      if (g && this._grassTotal) {
        const want = q === 'high' ? 1 : q === 'medium' ? 0.5 : 0.22;
        g.geometry.instanceCount = Math.max(1, Math.round(this._grassTotal * Math.min(1, want / Math.max(0.05, this._grassDens || 1))));
      }
      this._a2cT = 0;
    },
    /** a tree of the placement lists → a Forest record (species index, variant, tint of the photographed leaves) */
    _treeRecord(it) {
      const SP = { pine: 0, oak: 1, maple: 2, zelkova: 3, conifer: 4 };
      const M = this._palMean || (this._palMean = (() => {
        // the mean palette colour of every species (red / orange maple accents left out)
        const out = {};
        for (const k of Object.keys(PALETTE)) {
          const r = G.util.rng(99), c = new THREE.Color(0, 0, 0);
          let n = 0;
          for (let i = 0; i < 96; i++) { const p = PALETTE[k](r); if (p.r > p.g) continue; c.add(p); n++; }
          out[k] = c.multiplyScalar(1 / Math.max(1, n));
        }
        return out;
      })());
      const kind = it.kind, col = it.color, m = M[kind] || M.oak;
      const red = it.species === 'redMaple' || (kind === 'maple' && col && col.r > col.g * 1.05);
      const h = hash01(Math.round(it.x * 16), Math.round(it.z * 16), 3);
      let v = Math.floor(h * 4) % 4;
      if (kind === 'maple') v = red ? 3 : Math.floor(h * 3) % 3;
      if (kind === 'pine') v = (it.landmark || it.species === 'gardenPine') ? 2 : it.campus ? v : [0, 1, 3, 0][v];
      if (Number.isInteger(it.variant) && it.variant >= 0 && it.variant < VEG.VARIANTS) v = it.variant;
      let tint = [1, 1, 1];
      if (Array.isArray(it.tint) && it.tint.length === 3) tint = it.tint.map((c) => clamp(Number(c) || 1, 0.4, 2));
      else if (!red && col) tint = [clamp(col.r / m.r, 0.78, 1.28), clamp(col.g / m.g, 0.8, 1.25), clamp(col.b / m.b, 0.75, 1.3)];
      return { x: it.x, y: it.y, z: it.z, s: it.s, rot: it.rot, tiltX: it.tiltX, tiltZ: it.tiltZ, sp: SP[kind] ?? 1, v, tint };
    },
    /** the valley's trees as a Forest + invisible carriers the minimap reads (trees-campus-<kind> / trees-slope-<kind>) */
    _realTrees(grp, preset, all, campus, slope) {
      const forest = new Forest(all.map((it) => this._treeRecord(it)), {
        name: 'trees-real', shadows: !!preset.shadows, scale: preset.name === 'high' ? 1 : 0.85,
        area: [BOX.minX - 12, BOX.minZ - 12, BOX.maxX + 12, BOX.maxZ + 12],
      });
      grp.add(forest.group);
      this.forest = forest;
      VEG.forests.push(forest);
      const tri = new THREE.BufferGeometry();
      tri.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0, 0, 0, 0], 3));
      const dm = new THREE.MeshBasicMaterial({ visible: false });
      for (const k of Object.keys(campus)) for (const [tag, lst] of [['campus', campus[k]], ['slope', slope[k]]]) {
        const m = makeInstanced(tri, dm, lst, { name: `trees-${tag}-${k}` });
        if (m) { m.visible = false; m.userData.dataOnly = true; m.userData.guardSkip = true; grp.add(m); }
      }
      this.counts.treeQuads = [forest.b0.maxChunks * 64, forest.b1.maxChunks * 16];
      return all.length;
    },
    grove(list, opts = {}) {
      const eng = G.sys.engine, parent = opts.parent || eng?.scene;
      const none = { group: null, count: 0, stats: () => null, dispose() {} };
      if (!parent || !Array.isArray(list) || !list.length) return none;
      parent.updateWorldMatrix?.(true, false);
      const pm = parent.matrixWorld.elements, ox = pm[12], oy = pm[13], oz = pm[14];
      const KIND = { pine: 'pine', gardenPine: 'pine', oak: 'oak', maple: 'maple', redMaple: 'maple', zelkova: 'zelkova', conifer: 'conifer', fir: 'conifer' };
      const TR_R = { pine: 0.3, oak: 0.28, maple: 0.22, zelkova: 0.6, conifer: 0.26 };
      const hAt = typeof opts.heightAt === 'function' ? opts.heightAt : (x, z) => H(x + ox, z + oz) - oy;
      const rnd = G.util.rng((opts.seed ?? 20260) + list.length);
      const items = [];
      for (const t of list) {
        const x = Number(t && t.x), z = Number(t && t.z);
        if (!Number.isFinite(x) || !Number.isFinite(z)) continue;
        const kind = KIND[t.species] || 'oak', s = clamp(Number(t.scale) || 1, 0.2, 4);
        const y = Number.isFinite(t.y) ? Number(t.y) : Number(hAt(x, z));
        if (!Number.isFinite(y)) continue;
        items.push({ x, y: y - 0.15 * s, z, s, rot: Number.isFinite(t.rot) ? Number(t.rot) : rnd() * TAU, tiltX: (rnd() - 0.5) * 0.05, tiltZ: (rnd() - 0.5) * 0.05, color: PALETTE[kind](rnd), kind, species: t.species, variant: t.variant, tint: t.tint, campus: true });
      }
      if (!items.length) return none;
      let group, forest = null;
      const shadows = opts.shadows ?? !!this.preset?.shadows;
      if (this.real) {
        forest = new Forest(items.map((it) => this._treeRecord(it)), { name: String(opts.name || 'grove'), shadows, scale: this.forest ? this.forest.scale : (eng?.quality === 'high' ? 1 : 0.85) });
        group = forest.group;
        parent.add(group);
        VEG.forests.push(forest);
      } else {
        // `low`: the plain instanced trees
        const geo = this._treeGeo || (this._treeGeo = { pine: buildPine(G.util.rng(11), false), oak: buildRound(G.util.rng(12), false, { height: 8.5, crownR: 3.4 }), maple: buildRound(G.util.rng(13), false, { height: 7, crownR: 2.8, bark: BARK.maple, trunkR: 0.2, blobs: 6, flat: 0.8 }), zelkova: buildZelkova(G.util.rng(14)), conifer: buildConifer(G.util.rng(15), false) });
        const mat = vegMaterial('tree', { sway: 0.0011, flutter: 0.025 });
        group = new THREE.Group(); group.name = String(opts.name || 'grove');
        for (const k of ['pine', 'oak', 'maple', 'zelkova', 'conifer']) {
          const m = makeInstanced(geo[k], mat, items.filter((it) => it.kind === k), { shadow: shadows, receive: true, name: `grove-${k}` });
          if (m) group.add(m);
        }
        parent.add(group);
      }
      const ids = [];
      if (opts.colliders) for (const it of items) ids.push(G.world.addCollider({ shape: 'circle', x: it.x + ox, z: it.z + oz, r: (TR_R[it.kind] || 0.3) * it.s + 0.12, tag: 'tree' }));
      return {
        group, count: items.length, forest,
        stats: () => (forest ? forest.stats() : { trees: items.length, plain: true }),
        dispose: () => {
          for (const id of ids) { try { G.world.removeCollider(id); } catch (e) { /* gone */ } }
          ids.length = 0;
          if (forest) { const k = VEG.forests.indexOf(forest); if (k >= 0) VEG.forests.splice(k, 1); forest.dispose(); }
          else { group.parent?.remove(group); group.traverse((o) => { if (o.isInstancedMesh) o.dispose?.(); }); }
        },
      };
    },
    meadow(opts = {}) {
      const eng = G.sys.engine, parent = opts.parent || eng?.scene;
      const none = { mesh: null, count: 0, dispose() {} };
      if (!this.real || !parent || !VEG.groundTex) return none;
      const w = clamp(Number(opts.w) || 10, 0.5, 400), d = clamp(Number(opts.d) || 10, 0.5, 400), cx = Number(opts.x) || 0, cz = Number(opts.z) || 0;
      const dens = clamp(Number(opts.density) || 6, 0.2, 24), fl = clamp(Number(opts.flowers) || 0, 0, 1);
      const want = Math.min(60000, Math.round(w * d * dens)), rnd = G.util.rng((opts.seed ?? 4040) + want);
      const hAt = typeof opts.heightAt === 'function' ? opts.heightAt : () => 0, mask = typeof opts.mask === 'function' ? opts.mask : null;
      const list = [];
      for (let i = 0; i < want; i++) {
        const x = cx + (rnd() - 0.5) * w, z = cz + (rnd() - 0.5) * d, mk = mask ? clamp(Number(mask(x, z)) || 0, 0, 1) : 1;
        if (rnd() > mk) continue;
        const y = Number(hAt(x, z));
        if (!Number.isFinite(y)) continue;
        list.push([x, y, z, rnd(), rnd() < fl ? 1 : 0]);
      }
      if (!list.length) return none;
      const pm = patchMesh(list, opts.color, opts.flowerColors, !!this.preset?.shadows);
      pm.mesh.name = String(opts.name || 'meadow');
      parent.add(pm.mesh);
      return { mesh: pm.mesh, count: list.length, dispose: pm.dispose };
    },
    lodStats() {
      return {
        real: this.real,
        forests: VEG.forests.map((f) => Object.assign({ name: f.name }, f.stats())),
        foliage: { size: VEG.atlasSize || 512, impostor: VEG.impCell || 64, photo: VEG.photo || null, pending: !!this._vegJob || !this._vegDone },
        grass: this._grassTotal ? { total: this._grassTotal, drawn: this.meshes.grass?.geometry?.instanceCount } : null,
      };
    },

    // ============================================================== trees
    _buildTrees(root, preset) {
      const dens = clamp(preset.treeDensity ?? 0.75, 0.2, 1.2);
      const low = preset.name === 'low';
      const rnd = G.util.rng(4242);
      const real = this.real, all = [];   // [render-nature] real trees take the same placement, in one list
      // geometry variants
      const geo = real ? {} : {
        pine: buildPine(G.util.rng(11), false),
        oak: buildRound(G.util.rng(12), false, { height: 8.5, crownR: 3.4 }),
        maple: buildRound(G.util.rng(13), false, { height: 7, crownR: 2.8, bark: BARK.maple, trunkR: 0.2, blobs: 6, flat: 0.8 }),
        zelkova: buildZelkova(G.util.rng(14)),
        conifer: buildConifer(G.util.rng(15), false),
        farPine: buildPine(G.util.rng(21), true),
        farRound: buildRound(G.util.rng(22), true, { height: 6.6, crownR: 4.1 }),
        farConifer: buildConifer(G.util.rng(23), true),
      };
      if (!real) this._treeGeo = geo;
      const mat = real ? null : vegMaterial('tree', { sway: 0.0011, flutter: 0.025 });
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
        if (real) all.push({ x, y, z, s, rot: it.rot, tiltX: it.tiltX, tiltZ: it.tiltZ, color, kind, campus: !!opts.campus, landmark: !!opts.landmark });
        const nearBox = inBox(x, z, 24);
        if (opts.campus) campus[kind].push(it);
        else if (nearBox && !low) slope[kind].push(it);
        else {
          const fk = kind === 'pine' ? 'farPine' : kind === 'conifer' ? 'farConifer' : 'farRound';
          if (fk === 'farRound') { it.s *= kind === 'zelkova' ? 1.25 : 1; }
          const sec = Math.floor(((Math.atan2(x, z) + PI) / TAU) * SECT) % SECT;
          far[fk][sec].push(it);
        }
        // every trunk inside the walkable box blocks: its foothills rise well above the valley floor and stay walkable
        if (inBox(x, z, 1)) colliders.push({ x, z, r: (TRUNK_R[kind] || 0.3) * s + 0.12 });
      };

      // ---- landmark trees
      for (const lt of L.landmarkTrees || []) {
        const kind = ({ zelkova: 'zelkova', pine: 'pine', maple: 'maple', oak: 'oak' })[lt.kind] || 'oak';
        // the zelkova model is already a 12 m giant: layout scale is relative to a ~8 m village tree
        add(kind, lt.x, lt.z, (lt.scale || 1) * (kind === 'zelkova' ? 0.68 : 1.0), { campus: true, landmark: true });
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
      if (real) total = this._realTrees(grp, preset, all, campus, slope);
      else {
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
      const mat = this.rockMaterial;   // [render-nature] photographed granite on medium / high
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
    /** [render-nature] shrubs as one instanced mesh (room for the flower beds' leafy mounds, added by _buildFlowers) */
    _realShrubs(grp, list, shadows) {
      const mean = hsl(0.26, 0.52, 0.28), cap = list.length + 700;
      const mat = G.gfx.material('nat-veg-shrub', () => { const m = cardMaterial('shrub', VEG.atlasTex, 0.02, 0.012); VEG.atlasUsers.push(m); return m; });
      const dep = G.gfx.material('nat-veg-shrub-depth', () => { const m = cardDepthMaterial('shrub', VEG.atlasTex, 0.02); VEG.atlasUsers.push(m); return m; });
      const geo = shrubGeometry(G.util.rng(31));
      const bloom = new Float32Array(cap * 4);
      geo.setAttribute('aBloom', new THREE.InstancedBufferAttribute(bloom, 4));
      const im = new THREE.InstancedMesh(geo, mat, cap);
      im.customDepthMaterial = dep;
      im.castShadow = !!shadows; im.receiveShadow = true;
      im.matrixAutoUpdate = false; im.updateMatrix();
      im.name = 'shrubs-real'; im.raycast = () => {}; im.userData.veg = true;
      this._shrubReal = { im, bloom, n: 0, cap, mean };
      this._addShrubs(list);
      grp.add(im);
    },
    _addShrubs(list) {
      const S = this._shrubReal;
      if (!S) return 0;
      const im = S.im, fc = new THREE.Color();
      let added = 0;
      for (const it of list) {
        if (S.n >= S.cap) break;
        const i = S.n++;
        _e.set(it.tiltX || 0, it.rot || 0, it.tiltZ || 0); _q.setFromEuler(_e);
        _p.set(it.x, it.y, it.z); _s.set(it.s * (it.sx || 1), it.s * (it.sy || 1), it.s * (it.sz || 1));
        _m.compose(_p, _q, _s);
        im.setMatrixAt(i, _m);
        const c = it.color || S.mean;
        im.setColorAt(i, _c.setRGB(clamp(c.r / S.mean.r, 0.7, 1.4), clamp(c.g / S.mean.g, 0.75, 1.35), clamp(c.b / S.mean.b, 0.7, 1.4)));
        if (it.flowerColor) { fc.set(it.flowerColor); S.bloom[i * 4] = fc.r; S.bloom[i * 4 + 1] = fc.g; S.bloom[i * 4 + 2] = fc.b; S.bloom[i * 4 + 3] = 1; }
        added++;
      }
      im.count = S.n;
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
      im.geometry.attributes.aBloom.needsUpdate = true;
      im.computeBoundingSphere();
      return added;
    },

    _buildShrubs(root, preset) {
      const rnd = G.util.rng(9191);
      const real = this.real;
      const geoGreen = real ? null : buildShrub(G.util.rng(31), false), geoFlower = real ? null : buildShrub(G.util.rng(32), true);
      const mat = real ? null : vegMaterial('shrub', { sway: 0.02, flutter: 0.012 });
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
      if (this.real) {
        // [render-nature] one instanced mesh of leaf-card shrubs; flowering ones show their blossom cards (aBloom)
        this._realShrubs(grp, green.concat(flower), shadows);
      } else {
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
      }
      root.add(grp);
      this.meshes.shrubs = grp;
      // foliage is never a platform (stand:false). Its blocking top sits above every bit of ground a walker could
      // stand on beside it (a bush on a slope would otherwise be "passed over" from the uphill side, then shove the
      // walker sideways as the ground drops inside it)
      const WALKER_R = 0.4;
      for (const c of colliders) {
        let rim = H(c.x, c.z);
        for (let k = 0; k < 12; k++) {
          const a = (k / 12) * Math.PI * 2, rr = c.r + WALKER_R;
          rim = Math.max(rim, H(c.x + Math.sin(a) * rr, c.z + Math.cos(a) * rr), H(c.x + Math.sin(a) * c.r * 0.6, c.z + Math.cos(a) * c.r * 0.6));
        }
        G.world.addCollider({ shape: 'circle', x: c.x, z: c.z, r: c.r, tag: 'shrub', stand: false, maxY: Math.max(H(c.x, c.z) + 0.55, rim + 0.1) });
      }
      this.counts.shrubs = green.length + flower.length;
    },

    // ============================================================== wildflowers & flower beds
    _buildFlowers(root, preset) {
      const rnd = G.util.rng(5150);
      const real = this.real && !!VEG.groundTex;   // [render-nature] flower plants as cards on medium / high
      const geo = real ? flowerGeometry() : buildFlower(G.util.rng(41));
      const mat = real ? G.gfx.material('nat-veg-flower', () => { const m = cardMaterial('flower', VEG.groundTex, 0.25, 0.004); VEG.groundUsers.push(m); return m; })
        : vegMaterial('flower', { sway: 0.25, flutter: 0.004, side: THREE.DoubleSide, noFlip: true });
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
      if (m) { grp.add(m); m.userData.veg = true; }
      if (this.real && this._shrubReal) this._addShrubs(leafy);   // [render-nature] the beds' leafy mounds join the shrub mesh
      else {
        const lm = makeInstanced(buildShrub(G.util.rng(33), false), vegMaterial('shrub', { sway: 0.02, flutter: 0.012 }), leafy, { shadow: false, name: 'flowerbed-leaves' });
        if (lm) grp.add(lm);
      }
      root.add(grp);
      this.meshes.flowers = grp;
      this.counts.flowers = list.length;
    },

    // ============================================================== grass (GPU, wraps around the camera)
    _buildGrass(root, preset) {
      const dens = preset.grassDensity ?? 0.5;
      const terr = TR();
      if (dens <= 0 || !terr?.uniforms) { this.counts.grass = 0; return; }
      if (this.real && VEG.groundTex) {
        // [render-nature] blade cards: a dense lawn layer around the player and a wide meadow layer ahead of the camera
        const gr = buildGrassMesh(terr, [{ tile: 30, count: Math.round(30 * 30 * 16 * dens), size: 1 }, { tile: 84, count: Math.round(84 * 84 * 3.4 * dens), size: 1.22 }], !!preset.shadows);
        root.add(gr.mesh);
        this.meshes.grass = gr.mesh;
        this._grassReal = gr.uniforms; this._grassTotal = gr.count; this._grassDens = dens;
        this.counts.grass = gr.count;
        return;
      }
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
            // step(): a mask of 0 (paving, roads, the 만장대 deck) always means no tuft — the smoothstep alone is > 0 at
            // tfMask = 0 for aOff.w < 0.12, which left ~12 % of the tufts standing on stone
            float tfScale = (0.68 + fract(aOff.w * 13.71) * 0.62) * smoothstep(aOff.w - 0.12, aOff.w + 0.02, tfMask) * step(0.004, tfMask) * tfFade;
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
            // live projection / 1.921 (55° design FOV): world-sized through the telescope and FOV kicks (R3-render-1)
            gl_PointSize = uScale * (projectionMatrix[1][1] / 1.921) * (0.35 + blink * 0.65) * 40.0 * (10.0 / max(1.0, -mv.z));
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
      G.gfx.guard?.watch?.(pts, { uniforms: true });   // §14.4.1 sanitation
      pts.visible = false;
      root.add(pts);
      this.meshes.fireflies = pts;
      this._fireflyMat = mat;
      this.counts.fireflies = count;
      const setScale = () => { mat.uniforms.uScale.value = (G.sys.engine?.renderer?.getPixelRatio?.() || 1) * (window.innerHeight / 900); };
      G.sys.engine?.onResize?.(setScale);
      setScale();
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
            gl_PointSize = clamp(size * (0.75 + aSeed.y * 0.6) * uScale * projectionMatrix[1][1] / dist, 1.0, 22.0);
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
      G.gfx.guard?.watch?.(pts, { uniforms: true });
      pts.raycast = () => {};
      root.add(pts);
      this.meshes.petals = pts;
      this._petalMat = mat;
      // half the drawing-buffer height; the shader multiplies by the live projectionMatrix[1][1] (= 1 / tan(fov / 2)),
      // so a telescope / FOV change keeps the petals world-sized (R3-render-1: the FOV used to be read on resize only)
      const scale = () => { const E = G.sys.engine; mat.uniforms.uScale.value = window.innerHeight * (E.renderer?.getPixelRatio?.() || 1) * 0.5; };
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
        G.gfx.guard?.watch?.(m, { uniforms: true });
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
            gl_PointSize = uScale * (projectionMatrix[1][1] / 1.921) * (0.4 + blink * 0.6) * 36.0 * (10.0 / max(1.0, -mv.z));
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
      G.gfx.guard?.watch?.(pts, { uniforms: true });
      root.add(pts);
      this.meshes.nightFlies = pts;
      this._nightFlyMat = mat;
      const setScale = () => { mat.uniforms.uScale.value = (G.sys.engine?.renderer?.getPixelRatio?.() || 1) * (window.innerHeight / 900); };
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

    /** [render-nature] levels of detail around the player, the texture upgrade in slices, the grass ring */
    _updateReal(dt, eng) {
      VEG.U.uFlutter.value = G.settings?.reduceMotion ? 0 : 1;
      this._a2cT = (this._a2cT || 0) - (dt || 0);
      if (this._a2cT <= 0 && eng?.renderer) {
        // is the frame multisampled? (the composer's target on medium / high; a plain antialiased canvas otherwise)
        this._a2cT = 1.5;
        let ms = false;
        try {
          const pi = eng.composer ? eng.postInfo : null;   // render-light: { samples, … } of the scene pass
          ms = eng.composer ? ((pi && Number.isFinite(pi.samples) ? pi.samples : (eng.composer.renderTarget1?.samples || 0)) > 0) : !!eng.renderer.getContextAttributes?.().antialias;
        } catch (e) { ms = false; }
        VEG.U.uA2C.value = ms ? 1 : 0;
      }
      const f = eng?.focus;
      if (f && Number.isFinite(f.x) && Number.isFinite(f.z)) {
        const hidden = this.root && this.root.visible === false;   // inside a place the valley is hidden: its forest rests
        for (let i = 0; i < VEG.forests.length; i++) { const fr = VEG.forests[i]; if (fr === this.forest && hidden) continue; fr.tick(f.x, f.z, dt || 0, false); }
      }
      if (this._vegJob) {
        // a time slice per frame: 3 ms at 60 fps, a tenth of the real frame time on a slow device (so it still ends there)
        const t0 = performance.now(), slice = clamp((t0 - (this._vegT || t0)) * 0.1, 3, 150);
        this._vegT = t0;
        try {
          let r;
          do { r = this._vegJob.next(); } while (!r.done && performance.now() - t0 < slice);
          if (r.done) { this._vegJob = null; this._vegDone = true; G.bus.emit('nature:foliage', { photo: VEG.photo || null }); }
        } catch (e) { this._vegJob = null; this._vegDone = true; G.log.warn('WORLD', 'foliage textures: the first versions stay', e?.message || e); }
      }
      const gu = this._grassReal;
      if (gu && eng?.camera) {
        const cam = eng.camera, fx = -cam.matrixWorld.elements[8], fz = -cam.matrixWorld.elements[10], fl = Math.hypot(fx, fz) || 1;
        gu.uGrassFar.value.set(cam.position.x + (fx / fl) * 16, cam.position.z + (fz / fl) * 16);
        const pl = G.sys.player?.position;
        if (pl && Number.isFinite(pl.x) && Number.isFinite(pl.z)) { gu.uPlayer.value.set(pl.x, pl.z); gu.uGrassNear.value.set(pl.x, pl.z); }
        else { gu.uPlayer.value.set(9999, 9999); gu.uGrassNear.value.set(cam.position.x + (fx / fl) * 8, cam.position.z + (fz / fl) * 8); }
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
      // [render-nature] the engine's wind, when it has one, leads (render-light); otherwise the weather calls setWind()
      const ew = eng?.wind;
      if (ew && Number.isFinite(Number(ew.strength))) { this._engineWind = true; this.setWind(Number(ew.x ?? ew.dir?.x ?? 0.86), Number(ew.z ?? ew.dir?.y ?? ew.dir?.z ?? 0.5), Number(ew.strength), true); }
      else this._engineWind = false;
      if (this.real) {
        try { this._updateReal(dt, eng); } catch (e) { if (!this._realErr) { this._realErr = true; G.log.warn('WORLD', 'vegetation update failed', e?.message || e); } }
      }
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
