// =============================================================================
// 13-water.js — mountain stream, ponds and the hall-garden waterfall.
//
//   G.sys.water (order 13)
//     distanceToWater(x, z)   metres to the nearest open water (0 on/in water) — used by audio
//     isWater(x, z)           same test as G.world.isWater (deep water)
//     uniforms                {uTime, uFlowSpeed (1 = normal), uRain (0..1 extra ripples), uFoam, uCaustic, uRings}
// Phase 4: dancing caustic light on the shallow bed (two scrolling Voronoi-edge layers, min-combined; sunny
// daytime only), raindrop ring ripples on every water surface in rain (medium / high), sunlit sparkle on the
// waterfall spray. All maths guarded (no normalize of zero vectors, no division by zero).
//     meshes                  {water, fall, foam, spray, rocks}
// Water shading: MeshStandardMaterial (env reflection from scene.environment, sun glints, fog)
// with an injected flow-mapped normal, depth tint from the terrain height texture,
// soft shoreline alpha, and foam at the shore, around boulders and under the waterfall.
// =============================================================================
(function () {
  const L = G.data.layout || {};
  const PI = Math.PI, TAU = PI * 2;
  const WATER_Y = L.waterY ?? -1.1;
  const RIVER_HW = ((L.river && L.river.width) || 16) / 2;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const TR = () => G.sys.terrain;

  // ---------------------------------------------------------------- textures
  /** tileable ripple normal map (RG = slope, B = 1) with a foam/bubble pattern in A */
  function waterTexture(S = 256) {
    const rnd = G.util.rng(4321);
    const waves = [];
    for (let i = 0; i < 30; i++) {
      let fx = Math.round((rnd() * 2 - 1) * 11), fy = Math.round((rnd() * 2 - 1) * 11);
      if (!fx && !fy) fx = 1;
      const f = Math.hypot(fx, fy);
      waves.push({ fx, fy, a: (0.6 + rnd() * 0.8) / (0.8 + f), ph: rnd() * TAU });
    }
    const gx = new Float32Array(S * S), gy = new Float32Array(S * S);
    let mx = 1e-6;
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      let dx = 0, dy = 0;
      for (const w of waves) {
        const c = Math.cos((TAU * (w.fx * x + w.fy * y)) / S + w.ph) * w.a;
        dx += c * w.fx; dy += c * w.fy;
      }
      const k = y * S + x;
      gx[k] = dx; gy[k] = dy;
      mx = Math.max(mx, Math.abs(dx), Math.abs(dy));
    }
    // worley bubbles (wrapping) for foam
    const worley = (cells, seed) => {
      const r = G.util.rng(seed), pts = new Float32Array(cells * cells * 2);
      for (let i = 0; i < cells * cells; i++) { pts[i * 2] = r(); pts[i * 2 + 1] = r(); }
      const out = new Float32Array(S * S), cs = S / cells;
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        const ci = Math.floor(x / cs), cj = Math.floor(y / cs);
        let best = 9;
        for (let oj = -1; oj <= 1; oj++) for (let oi = -1; oi <= 1; oi++) {
          const ii = (ci + oi + cells) % cells, jj = (cj + oj + cells) % cells;
          const px = (ci + oi + pts[(jj * cells + ii) * 2]) * cs, py = (cj + oj + pts[(jj * cells + ii) * 2 + 1]) * cs;
          const d = Math.hypot(px - x, py - y) / cs;
          if (d < best) best = d;
        }
        out[y * S + x] = best;
      }
      return out;
    };
    const w1 = worley(9, 11), w2 = worley(19, 12);
    // caustic network: Voronoi cell edges (F2 - F1 small) of a jittered 7x7 wrapping grid -> B channel
    const edges = (() => {
      const cells = 7, r = G.util.rng(13), pts = new Float32Array(cells * cells * 2), cs = S / cells, out = new Float32Array(S * S);
      for (let i = 0; i < cells * cells; i++) { pts[i * 2] = 0.15 + r() * 0.7; pts[i * 2 + 1] = 0.15 + r() * 0.7; }
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        const ci = Math.floor(x / cs), cj = Math.floor(y / cs);
        let f1 = 9, f2 = 9;
        for (let oj = -1; oj <= 1; oj++) for (let oi = -1; oi <= 1; oi++) {
          const ii = (ci + oi + cells) % cells, jj = (cj + oj + cells) % cells;
          const px = (ci + oi + pts[(jj * cells + ii) * 2]) * cs, py = (cj + oj + pts[(jj * cells + ii) * 2 + 1]) * cs;
          const d = Math.hypot(px - x, py - y) / cs;
          if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) f2 = d;
        }
        const e = clamp(1 - (f2 - f1) / 0.2, 0, 1);
        out[y * S + x] = e * e;
      }
      return out;
    })();
    const data = new Uint8Array(S * S * 4);
    for (let i = 0; i < S * S; i++) {
      data[i * 4] = Math.round((gx[i] / mx * 0.5 + 0.5) * 255);
      data[i * 4 + 1] = Math.round((gy[i] / mx * 0.5 + 0.5) * 255);
      data[i * 4 + 2] = Math.round(edges[i] * 255);
      const f = clamp(1 - w1[i] * 1.55, 0, 1) * 0.65 + clamp(1 - w2[i] * 1.7, 0, 1) * 0.55;
      data[i * 4 + 3] = Math.round(clamp(f, 0, 1) * 255);
    }
    const t = new THREE.DataTexture(data, S, S, THREE.RGBAFormat, THREE.UnsignedByteType);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true;
    t.needsUpdate = true;
    return t;
  }
  /** vertical streaks for the falling water sheet (tiles vertically) */
  function fallTexture() {
    return G.gfx.canvasTexture(64, 256, (ctx, w, h) => {
      const img = ctx.createImageData(w, h), d = img.data, r = G.util.rng(66);
      const col = new Float32Array(w);
      for (let x = 0; x < w; x++) col[x] = 0.45 + 0.55 * Math.abs(Math.sin(x * 0.37 + r() * 0.8) * Math.sin(x * 0.11 + 1.3));
      const phases = Array.from({ length: w }, () => r() * TAU);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const v = (TAU * y) / h;
        const blob = 0.55 + 0.45 * Math.sin(v * 3 + phases[x]) * Math.sin(v * 5 + phases[(x * 7) % w]);
        const a = clamp(col[x] * blob + (r() - 0.5) * 0.12, 0, 1);
        const k = (y * w + x) * 4;
        d[k] = 235 + a * 20; d[k + 1] = 245 + a * 10; d[k + 2] = 255; d[k + 3] = Math.round(a * 255);
      }
      ctx.putImageData(img, 0, 0);
    }, { srgb: false });
  }

  const W = {
    name: 'water', order: 13, label: '계곡과 연못',
    uniforms: {
      uTime: { value: 0 },
      uFlowSpeed: { value: 1 },
      uRain: { value: 0 },
      uFoam: { value: 1 },
      uCaustic: { value: 0 },
      uRings: { value: 0 },
      uWaterLight: { value: 1 },
      uShallow: { value: new THREE.Color('#3a8f80') },
      uDeep: { value: new THREE.Color('#0c3540') },
      uMtnTint: { value: new THREE.Color(0.2, 0.33, 0.22) },
    },
    meshes: {},

    /** distance (m) from (x,z) to the nearest open water surface edge; 0 when on/in water */
    distanceToWater(x, z) {
      let d = 1e9;
      const t = TR();
      if (t?._fieldsReady) d = t.riverDistance(x, z) - (RIVER_HW - 0.3);
      else if (L.river?.points) d = G.util.distToPolyline(x, z, L.river.points).d - (RIVER_HW - 0.3);
      for (const p of L.ponds || []) { const dd = Math.hypot(x - p.x, z - p.z) - p.r; if (dd < d) d = dd; }
      return d > 0 ? d : 0;
    },
    isWater(x, z) { return G.world.isWater(x, z); },

    async init() {
      const eng = G.sys.engine;
      if (!eng?.scene) return;
      const terr = TR();
      try { terr?.ensureFields?.(); } catch (e) { /* terrain optional */ }
      this.tex = waterTexture(256);
      this.foamMask = this._buildFoamMask();
      const geo = this._buildSurfaceGeometry(terr);
      const mat = this._waterMaterial(terr);
      const water = new THREE.Mesh(geo, mat);
      water.name = 'water';
      water.receiveShadow = true;
      water.renderOrder = 1;
      water.matrixAutoUpdate = false; water.updateMatrix();
      water.raycast = () => {};
      eng.scene.add(water);
      this.meshes.water = water;
      this.material = mat;
      for (const p of L.ponds || []) {
        if (!p.waterfall) continue;
        try { this._buildWaterfall(eng.scene, p); } catch (e) { G.log.error('WORLD', 'waterfall failed', e); }
      }
    },

    // ------------------------------------------------------------- foam mask (boulders, pond-edge rocks)
    _buildFoamMask() {
      const N = 640, CORE = 160, mask = new Uint8Array(N * N);
      const rocks = (G.sys.nature?.riverRocks || []).slice();
      for (const r of rocks) {
        const R = r.r + 1.0;
        const i0 = Math.max(0, Math.floor((r.x - R + CORE) * 2)), i1 = Math.min(N - 1, Math.ceil((r.x + R + CORE) * 2));
        const j0 = Math.max(0, Math.floor((r.z - R + CORE) * 2)), j1 = Math.min(N - 1, Math.ceil((r.z + R + CORE) * 2));
        for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
          const x = i / 2 - CORE + 0.25, z = j / 2 - CORE + 0.25;
          // elongate downstream (+z)
          const dz = z - r.z, dx = x - r.x;
          const d = Math.hypot(dx, dz > 0 ? dz * 0.55 : dz * 1.2);
          const v = 0.85 * (1 - G.util.smoothstep(r.r * 0.75, R, d));
          const k = j * N + i;
          const nv = Math.round(v * 255);
          if (nv > mask[k]) mask[k] = nv;
        }
      }
      // waterfall plunge zone
      for (const p of L.ponds || []) {
        if (!p.waterfall) continue;
        const w = p.waterfall;
        let fx = p.x - w.x, fz = p.z - w.z; const l = Math.hypot(fx, fz) || 1; fx /= l; fz /= l;
        const cx = w.x + fx * 1.9, cz = w.z + fz * 1.9;
        for (let j = 0; j < N; j++) {
          const z = j / 2 - CORE; if (Math.abs(z - cz) > 5) continue;
          for (let i = 0; i < N; i++) {
            const x = i / 2 - CORE; if (Math.abs(x - cx) > 5) continue;
            const v = 1 - G.util.smoothstep(0.5, 3.6, Math.hypot(x - cx, z - cz));
            const k = j * N + i; const nv = Math.round(v * 255); if (nv > mask[k]) mask[k] = nv;
          }
        }
      }
      const t = new THREE.DataTexture(mask, N, N, THREE.RedFormat, THREE.UnsignedByteType);
      t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearFilter; t.generateMipmaps = false; t.unpackAlignment = 1; t.needsUpdate = true;
      return t;
    },

    // ------------------------------------------------------------- river ribbon + pond discs (one mesh)
    _buildSurfaceGeometry(terr) {
      const parts = [];
      const lim = (terr?.half || 500) - 4;
      let line = (terr?.riverLine?.length ? terr.riverLine : (L.river?.points || [])).filter((q) => Math.abs(q[0]) < lim && Math.abs(q[1]) < lim);
      if (line.length >= 2) {
        const n = line.length, ACR = 6, cols = ACR + 1, HWW = RIVER_HW + 3.4;
        const pos = new Float32Array(n * cols * 3), flow = new Float32Array(n * cols * 2), idx = [];
        for (let i = 0; i < n; i++) {
          const a = line[Math.max(0, i - 1)], b = line[Math.min(n - 1, i + 1)];
          let tx = b[0] - a[0], tz = b[1] - a[1]; const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
          const nx = -tz, nz = tx;
          const sp = 0.85 + 0.35 * Math.sin(i * 0.21) * Math.sin(i * 0.053 + 1.1);
          for (let k = 0; k < cols; k++) {
            const s = -1 + (2 * k) / ACR;
            const v = i * cols + k;
            pos[v * 3] = line[i][0] + nx * s * HWW; pos[v * 3 + 1] = WATER_Y; pos[v * 3 + 2] = line[i][1] + nz * s * HWW;
            const across = 1 - s * s * 0.65;
            flow[v * 2] = tx * sp * across; flow[v * 2 + 1] = tz * sp * across;
          }
        }
        for (let i = 0; i < n - 1; i++) for (let k = 0; k < ACR; k++) {
          const a = i * cols + k, b = a + 1, c = a + cols, d = c + 1;
          idx.push(a, b, c, b, d, c);
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        g.setAttribute('aFlow', new THREE.BufferAttribute(flow, 2));
        g.setIndex(idx);
        parts.push(g);
      }
      const disc = (x, z, r, y) => {
        const g = new THREE.CircleGeometry(r, 48);
        g.rotateX(-PI / 2); g.translate(x, y, z);
        g.deleteAttribute('uv');
        g.setAttribute('aFlow', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
        return g;
      };
      for (const p of L.ponds || []) {
        parts.push(disc(p.x, p.z, p.r + 1.8, WATER_Y));
        if (p.waterfall) {
          const w = p.waterfall;
          let fx = p.x - w.x, fz = p.z - w.z; const l = Math.hypot(fx, fz) || 1; fx /= l; fz /= l;
          parts.push(disc(w.x - fx * 1.9, w.z - fz * 1.9, 1.0, (w.h ?? 3.2) - 0.06)); // upper pool behind the lip
        }
      }
      for (const g of parts) { if (g.attributes.normal) g.deleteAttribute('normal'); }
      const merged = parts.length > 1 ? ADDONS.BufferGeometryUtils.mergeGeometries(parts.map((g) => (g.index ? g : g)), false) : parts[0];
      const nrm = new Float32Array(merged.attributes.position.count * 3);
      for (let i = 0; i < nrm.length; i += 3) nrm[i + 1] = 1;
      merged.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
      merged.computeBoundingSphere();
      return merged;
    },

    _waterMaterial(terr) {
      const hasT = !!terr?.uniforms;
      const u = this.uniforms;
      const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.07, metalness: 0, transparent: true });
      mat.onBeforeCompile = (sh) => {
        Object.assign(sh.uniforms, hasT ? terr.uniforms : {}, {
          uTime: u.uTime, uFlowSpeed: u.uFlowSpeed, uRain: u.uRain, uFoam: u.uFoam, uCaustic: u.uCaustic, uRings: u.uRings,
          uShallow: u.uShallow, uDeep: u.uDeep, uMtnTint: u.uMtnTint,
          tWaterN: { value: this.tex }, tFoamMask: { value: this.foamMask },
        });
        sh.defines = sh.defines || {};
        if (hasT) sh.defines.TF_TERRAIN = '';
        sh.vertexShader = sh.vertexShader
          .replace('#include <common>', '#include <common>\nattribute vec2 aFlow;\nvarying vec2 vFlow;\nvarying vec3 vWPos;')
          .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFlow = aFlow;\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
        sh.fragmentShader = sh.fragmentShader
          .replace('#include <common>', `#include <common>
            varying vec2 vFlow; varying vec3 vWPos;
            uniform float uTime; uniform float uFlowSpeed; uniform float uRain; uniform float uFoam; uniform float uCaustic; uniform float uRings;
            float tfWHash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
            uniform sampler2D tWaterN; uniform sampler2D tFoamMask; uniform vec3 uShallow; uniform vec3 uDeep; uniform vec3 uMtnTint;
            #ifdef TF_TERRAIN
            ${terr?.glslTerrain || ''}
            #endif
            vec3 tfWaterN; float tfFoamAmt;`)
          .replace('#include <color_fragment>', `#include <color_fragment>
            {
              vec2 fl = vFlow * uFlowSpeed;
              float spd = length(fl);
              float per = 6.0;
              float ph0 = fract(uTime / per), ph1 = fract(uTime / per + 0.5);
              float w0 = 1.0 - abs(2.0 * ph0 - 1.0);
              vec2 p = vWPos.xz;
              vec2 uA = p * 0.12 - fl * ph0 * per * 0.12, uB = p * 0.12 - fl * ph1 * per * 0.12 + 0.43;
              vec2 uC = p * 0.29 - fl * ph0 * per * 0.29 + 0.17, uD = p * 0.29 - fl * ph1 * per * 0.29 + 0.71;
              vec4 tA = texture2D(tWaterN, uA), tB = texture2D(tWaterN, uB), tC = texture2D(tWaterN, uC), tD = texture2D(tWaterN, uD);
              vec4 big = mix(tB, tA, w0), small = mix(tD, tC, w0);
              // gentle wind ripples everywhere (ponds have no flow)
              vec4 rip = texture2D(tWaterN, p * 0.21 + vec2(uTime * 0.021, uTime * 0.013));
              vec4 rip2 = texture2D(tWaterN, p * 0.53 - vec2(uTime * 0.034, -uTime * 0.027));
              vec2 slope = (big.xy - 0.5) * 2.0 * 0.6 + (small.xy - 0.5) * 2.0 * 0.45;
              slope *= smoothstep(0.0, 0.45, spd);
              slope += ((rip.xy - 0.5) * 0.55 + (rip2.xy - 0.5) * 0.4 * (1.0 + uRain * 2.5)) * 0.6;
              float str = mix(0.19, 0.36, smoothstep(0.0, 0.6, spd)) + uRain * 0.18;
              // raindrop rings (two staggered cell layers, one expanding ring per cell and cycle)
              if (uRings > 0.5 && uRain > 0.01) {
                for (int k = 0; k < 2; k++) {
                  vec2 q = p * 1.35 + float(k) * vec2(0.37, 0.61) - fl * uTime * 0.2;
                  vec2 cell = floor(q);
                  vec2 loc = fract(q) - 0.5 - (vec2(tfWHash(cell), tfWHash(cell + 7.1)) - 0.5) * 0.5;
                  float ph = fract(uTime * (0.7 + tfWHash(cell + 3.3) * 0.5) + tfWHash(cell + 1.7));
                  float d = length(loc);
                  float re = (d - ph * 0.45) * 24.0;
                  float ring = exp(-re * re) * (1.0 - ph) * uRain;
                  slope += (d > 1e-4 ? loc / d : vec2(0.0)) * ring * 2.2;
                }
              }
              tfWaterN = normalize(vec3(slope.x * str, 1.0, slope.y * str));
              // depth from the terrain height texture
              #ifdef TF_TERRAIN
                float depth = max(vWPos.y - terrainH(p), 0.0);
              #else
                float depth = 1.2;
              #endif
              float deepK = 1.0 - exp(-depth * 1.25);
              vec3 col = mix(uShallow, uDeep, deepK);
              // foam: shoreline, boulders, plunge pool
              vec2 muv = (p + 160.0) / 320.0;
              float rockF = (muv.x > 0.0 && muv.y > 0.0 && muv.x < 1.0 && muv.y < 1.0) ? texture2D(tFoamMask, muv).r : 0.0;
              float fpat = mix(tB.a, tA.a, w0) * 0.6 + mix(tD.a, tC.a, w0) * 0.55;
              float shore = 1.0 - smoothstep(0.02, 0.38, depth);
              float foam = clamp(shore * 0.85 + rockF * 1.2 + smoothstep(0.75, 1.2, spd) * 0.12, 0.0, 1.5);
              foam = smoothstep(0.42, 0.95, fpat * foam + foam * 0.25) * uFoam;
              tfFoamAmt = foam;
              // caustics: sunlight focused by the ripples dances on the shallow bed
              if (uCaustic > 0.001) {
                float ca = texture2D(tWaterN, p * 0.16 + vec2(uTime * 0.021, uTime * 0.013) - fl * uTime * 0.05).b;
                float cb = texture2D(tWaterN, p * 0.21 - vec2(uTime * 0.017, -uTime * 0.019) + 0.37 - fl * uTime * 0.04).b;
                float caus = min(ca, cb) * (1.0 - deepK * 0.85) * smoothstep(0.03, 0.3, depth) * (1.0 - foam);
                col += vec3(0.8, 1.0, 0.92) * caus * uCaustic * 0.6;
              }
              col = mix(col, vec3(0.93, 0.97, 1.0), foam * 0.85);
              vec3 tfVv = cameraPosition - vWPos; float tfVl = length(tfVv);
              vec3 V = tfVl > 1e-5 ? tfVv / tfVl : vec3(0.0, 1.0, 0.0);
              float fres = pow(1.0 - clamp(dot(tfWaterN, V), 0.0, 1.0), 5.0);
              float alpha = mix(0.42, 0.9, deepK) + fres * 0.45 + foam * 0.6;
              alpha *= smoothstep(0.0, 0.1, depth);
              diffuseColor.rgb = col;
              diffuseColor.a = clamp(alpha, 0.0, 1.0);
            }`)
          .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor + uRain * 0.08, 0.8, tfFoamAmt);')
          .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nnormal = normalize((viewMatrix * vec4(tfWaterN, 0.0)).xyz);')
          .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
            {
              // the valley is ringed by forested mountains: low reflected rays see green slopes, not white sky
              vec3 tfVd = cameraPosition - vWPos; float tfVdl = length(tfVd);
              vec3 tfV = tfVdl > 1e-5 ? tfVd / tfVdl : vec3(0.0, 1.0, 0.0);
              vec3 tfR = reflect(-tfV, tfWaterN);
              float tfM = smoothstep(0.45, 0.05, tfR.y) * (1.0 - tfFoamAmt);
              reflectedLight.indirectSpecular *= mix(vec3(1.0), uMtnTint, tfM * 0.85);
              // water body colour comes from scattered sunlight, not from the bright sky dome
              reflectedLight.indirectDiffuse *= 0.42;
            }`);
      };
      mat.customProgramCacheKey = () => 'tf-water3-' + (hasT ? 1 : 0);
      return mat;
    },

    // ------------------------------------------------------------- hall-garden waterfall
    _buildWaterfall(scene, pond) {
      const w = pond.waterfall, top = w.h ?? 3.2;
      let fx = pond.x - w.x, fz = pond.z - w.z; const l = Math.hypot(fx, fz) || 1; fx /= l; fz /= l;
      const sx = -fz, sz = fx;
      const grp = new THREE.Group(); grp.name = 'waterfall';
      const at = (lf, ls) => [w.x + fx * lf + sx * ls, w.z + fz * lf + sz * ls];
      const H = (x, z) => G.world.terrainHeight(x, z);
      // ---- rocky ledge
      const rnd = G.util.rng(9001);
      const rocks = [];
      const rock = (lf, ls, y, s, sy = 0.8) => { const [x, z] = at(lf, ls); rocks.push({ x, y, z, s, sy, rot: rnd() * TAU }); };
      rock(-0.15, 0, top - 0.4, 0.95, 0.42);                          // lip slab
      for (const side of [-1, 1]) {
        rock(-0.1, side * 1.65, top - 0.2, 0.8 + rnd() * 0.2, 0.9);  // lip flanks
        rock(-0.6, side * 1.9, top - 0.3, 0.9 + rnd() * 0.3, 0.85);
        rock(0.2, side * 2.05, top - 1.5, 0.9 + rnd() * 0.2, 1.1);  // cliff face
        rock(0.35, side * 2.1, 0.2, 0.95 + rnd() * 0.25, 1.0);
        rock(-1.0, side * 3.0, 1.2, 1.1 + rnd() * 0.4, 0.9);          // mound shoulders
        rock(-3.2, side * 2.2, 0.9, 1.0 + rnd() * 0.4, 0.8);
        rock(0.8, side * 1.95, WATER_Y + 0.2, 0.85 + rnd() * 0.25, 0.9);
        rock(1.9, side * (2.0 + rnd() * 0.5), WATER_Y, 0.55 + rnd() * 0.3, 0.75); // base boulders
        rock(-2.0, side * 1.45, top - 0.1, 0.7 + rnd() * 0.2, 0.7);   // frame the upper pool
      }
      rock(-3.2, 0.3, top - 0.05, 0.9, 0.6);
      rock(-0.55, 0, top - 2.4, 1.05, 1.1);                            // behind the falling sheet
      for (let i = 0; i < 12; i++) {                                     // rocks strewn over the garden mound
        const lf = -1.5 - rnd() * 5.5, ls = (rnd() - 0.5) * 9;
        const [x, z] = at(lf, ls);
        const hh = H(x, z);
        if (hh < 0.3) continue;
        rocks.push({ x, y: hh - 0.2, z, s: 0.45 + rnd() * 0.6, sy: 0.7 + rnd() * 0.3, rot: rnd() * TAU });
      }
      const rg = G.sys.nature?.rockGeometry ? G.sys.nature.rockGeometry(3.3, 2) : new THREE.IcosahedronGeometry(1, 1);
      const rm = G.sys.nature?.rockMaterial || new THREE.MeshLambertMaterial({ color: 0x7a766c });
      const im = new THREE.InstancedMesh(rg, rm, rocks.length);
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), sc = new THREE.Vector3(), c = new THREE.Color();
      rocks.forEach((r, i) => {
        e.set((rnd() - 0.5) * 0.3, r.rot, (rnd() - 0.5) * 0.3); q.setFromEuler(e);
        v.set(r.x, r.y, r.z); sc.set(r.s, r.s * r.sy, r.s);
        m4.compose(v, q, sc); im.setMatrixAt(i, m4);
        const k = 0.85 + rnd() * 0.25; im.setColorAt(i, c.setRGB(k, k, k * 0.96));
      });
      im.castShadow = true; im.receiveShadow = true; im.name = 'waterfall-rocks';
      im.computeBoundingSphere();
      im.raycast = () => {};
      grp.add(im);
      this.meshes.rocks = im;
      // block walking into the falls
      const [mx, mz] = at(-1.2, 0);
      G.world.addCollider({ shape: 'circle', x: mx, z: mz, r: 2.9, tag: 'waterfall' });

      // ---- falling sheet (arcs outward)
      const ROWS = 14, COLS = 6, WTOP = 1.7, WBOT = 2.2;
      const pos = [], uv = [], idx = [];
      const drop = top - WATER_Y;
      for (let r = 0; r <= ROWS; r++) {
        const t = r / ROWS;
        const y = top - 0.05 - drop * t;
        const out = 0.3 + 1.65 * Math.pow(t, 1.25);
        const width = WTOP + (WBOT - WTOP) * t;
        for (let k = 0; k <= COLS; k++) {
          const s = -0.5 + k / COLS;
          const [x, z] = at(out, s * width);
          pos.push(x, y, z);
          uv.push(k / COLS, t * drop / 1.6);
        }
      }
      for (let r = 0; r < ROWS; r++) for (let k = 0; k < COLS; k++) {
        const a = r * (COLS + 1) + k, b = a + 1, cc = a + COLS + 1, d = cc + 1;
        idx.push(a, cc, b, b, cc, d);
      }
      const sg = new THREE.BufferGeometry();
      sg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      sg.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      sg.setIndex(idx);
      const fallTex = fallTexture();
      fallTex.wrapS = THREE.ClampToEdgeWrapping; fallTex.wrapT = THREE.RepeatWrapping;
      const u = this.uniforms;
      const sheetMat = new THREE.ShaderMaterial({
        uniforms: { map: { value: fallTex }, uTime: u.uTime, uLight: u.uWaterLight, uLen: { value: drop / 1.6 } },
        vertexShader: `
          varying vec2 vUv; varying float vFog;
          void main() { vUv = uv; vec4 mv = modelViewMatrix * vec4(position, 1.0); vFog = -mv.z; gl_Position = projectionMatrix * mv; }`,
        fragmentShader: `
          uniform sampler2D map; uniform float uTime; uniform float uLight; uniform float uLen;
          varying vec2 vUv;
          void main() {
            float a1 = texture2D(map, vec2(vUv.x, vUv.y * 0.9 - uTime * 1.55)).a;
            float a2 = texture2D(map, vec2(vUv.x * 0.8 + 0.1, vUv.y * 1.3 - uTime * 2.2)).a;
            float a = clamp(a1 * 0.72 + a2 * 0.55, 0.0, 1.0);
            float edge = smoothstep(0.0, 0.16, vUv.x) * smoothstep(1.0, 0.84, vUv.x);
            float t = vUv.y / uLen;
            a *= edge * (0.55 + 0.45 * smoothstep(0.0, 0.08, t)) * (1.0 - smoothstep(0.86, 1.0, t) * 0.5);
            vec3 col = mix(vec3(0.7, 0.86, 0.88), vec3(1.0), smoothstep(0.25, 0.8, a)) * uLight * 1.08;
            gl_FragColor = vec4(col, clamp(a * 1.05, 0.0, 0.95));
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
          }`,
        transparent: true, depthWrite: false, side: THREE.DoubleSide,
      });
      const sheet = new THREE.Mesh(sg, sheetMat);
      sheet.renderOrder = 3; sheet.name = 'waterfall-sheet'; sheet.raycast = () => {};
      grp.add(sheet);
      this.meshes.fall = sheet;

      // ---- plunge foam disc
      const [bx, bz] = at(1.95, 0);
      const fg = new THREE.CircleGeometry(2.2, 40); fg.rotateX(-PI / 2); fg.translate(bx, WATER_Y + 0.025, bz);
      const foamMat = new THREE.ShaderMaterial({
        uniforms: { tWaterN: { value: this.tex }, uTime: u.uTime, uLight: u.uWaterLight, uC: { value: new THREE.Vector2(bx, bz) } },
        vertexShader: `varying vec3 vW; void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
        fragmentShader: `
          uniform sampler2D tWaterN; uniform float uTime; uniform float uLight; uniform vec2 uC;
          varying vec3 vW;
          void main() {
            vec2 d = vW.xz - uC; float r = length(d);
            vec2 dir = d / max(r, 1e-3);
            float f1 = texture2D(tWaterN, vW.xz * 0.45 - dir * uTime * 0.35).a;
            float f2 = texture2D(tWaterN, vW.xz * 0.9 + dir * uTime * 0.2 + 0.3).a;
            float a = smoothstep(0.25, 0.85, f1 * 0.7 + f2 * 0.5) * (1.0 - smoothstep(0.4, 2.2, r));
            gl_FragColor = vec4(vec3(0.96, 0.98, 1.0) * uLight, a * 0.9);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
          }`,
        transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
      });
      const foam = new THREE.Mesh(fg, foamMat);
      foam.renderOrder = 2; foam.name = 'waterfall-foam'; foam.raycast = () => {};
      grp.add(foam);
      this.meshes.foam = foam;

      // ---- spray particles (GPU animated)
      const N = 90;
      const ppos = new Float32Array(N * 3), seed = new Float32Array(N * 4);
      for (let i = 0; i < N; i++) {
        ppos[i * 3] = bx; ppos[i * 3 + 1] = WATER_Y + 0.05; ppos[i * 3 + 2] = bz;
        seed[i * 4] = rnd(); seed[i * 4 + 1] = rnd(); seed[i * 4 + 2] = rnd(); seed[i * 4 + 3] = rnd();
      }
      const pg = new THREE.BufferGeometry();
      pg.setAttribute('position', new THREE.BufferAttribute(ppos, 3));
      pg.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
      pg.boundingSphere = new THREE.Sphere(new THREE.Vector3(bx, WATER_Y + 1, bz), 6);
      const sprayMat = new THREE.ShaderMaterial({
        uniforms: { uTime: u.uTime, uLight: u.uWaterLight, uScale: { value: 1 }, uDir: { value: new THREE.Vector2(fx, fz) }, uSide: { value: new THREE.Vector2(sx, sz) } },
        vertexShader: `
          attribute vec4 aSeed; uniform float uTime; uniform float uScale; uniform vec2 uDir; uniform vec2 uSide;
          varying float vA;
          void main() {
            float life = fract(uTime * (0.45 + aSeed.x * 0.35) + aSeed.y);
            vec2 h = uDir * (0.2 + aSeed.z * 1.5) + uSide * (aSeed.w - 0.5) * 2.4;
            vec3 vel = vec3(h.x, 1.2 + aSeed.x * 1.8, h.y);
            vec3 p = position + vec3(uSide * (aSeed.z - 0.5) * 1.2, 0.0).xzy * vec3(1.0, 0.0, 1.0);
            p += vel * life * 1.1 + vec3(0.0, -2.2, 0.0) * life * life;
            p.y = max(p.y, position.y);
            vec4 mv = modelViewMatrix * vec4(p, 1.0);
            vA = sin(life * 3.14159) * (0.35 + aSeed.w * 0.3);
            gl_PointSize = uScale * (18.0 + life * 46.0) * (6.0 / max(1.0, -mv.z));
            gl_Position = projectionMatrix * mv;
          }`,
        fragmentShader: `
          uniform float uLight; varying float vA;
          void main() {
            float d = length(gl_PointCoord - 0.5);
            float a = smoothstep(0.5, 0.05, d) * vA;
            if (a < 0.004) discard;
            gl_FragColor = vec4(vec3(0.94, 0.97, 1.0) * uLight, a * 0.55);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
          }`,
        transparent: true, depthWrite: false,
      });
      const spray = new THREE.Points(pg, sprayMat);
      spray.renderOrder = 4; spray.name = 'waterfall-spray'; spray.raycast = () => {};
      grp.add(spray);
      this.meshes.spray = spray;
      this._sprayMat = sprayMat;
      const setScale = () => { sprayMat.uniforms.uScale.value = (G.sys.engine.renderer.getPixelRatio() || 1) * (window.innerHeight / 900); };
      setScale();
      G.sys.engine?.onResize?.(setScale);
      scene.add(grp);
      this.meshes.waterfall = grp;
      G.world.registerObject?.('WATERFALL_' + pond.id, grp);
    },

    update(dt, t) {
      this.uniforms.uTime.value = t;
      const eng = G.sys.engine;
      if (eng) {
        const sunI = eng.sun ? eng.sun.intensity * Math.max(0, eng.sunDir.y) : 1.5;
        const hemiI = eng.hemi ? eng.hemi.intensity : 0.8;
        this.uniforms.uWaterLight.value = clamp(0.25 + hemiI * 0.5 + sunI * 0.2, 0.12, 1.15);
        const feat = (f) => (typeof eng.feature === 'function' ? eng.feature(f) : false);
        // caustics need direct sun: strongest at midday, gone at night / under thick cloud
        const goal = feat('caustics') && eng.sunDir.y > 0 ? clamp(sunI / 1.6, 0, 1) : 0;
        const u = this.uniforms.uCaustic;
        u.value += (goal - u.value) * (1 - Math.exp(-Math.min(dt || 0, 0.25) / 0.8));
        this.uniforms.uRings.value = feat('rainRings') ? 1 : 0;
      }
    },
  };

  G.register(W);
})();
