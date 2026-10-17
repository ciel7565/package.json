// =============================================================================
// 10-engine.js — Three.js renderer / scene / camera / sun & sky / post-processing / quality.
//
//   G.sys.engine.renderer | scene | camera | sun | hemi | sky | composer | bloomPass | atmosPass
//   G.sys.engine.focus (Vector3)  shadow-camera follow target (player sets it every frame)
//   G.sys.engine.preset           quality preset {name, pixelRatio, shadows, shadowSize, bloom, grade, godrays, atmos,
//                                 treeDensity, grassDensity, drawDistance}
//   G.sys.engine.feature(name)    is a world-ambience feature on right now? (preset + reduceMotion + fxLevel)
//                                 'grade' 'godrays' 'sunGlow' 'petals' 'mist' 'smoke' 'caustics' 'rainRings' 'splashes'
//                                 'lightning' 'sway'. Emits 'engine:features' when the answer may have changed.
//   G.sys.engine.setSun(elevationDeg, azimuthDeg, {intensity, color})
//   G.sys.engine.setQuality('low'|'medium'|'high'|'auto')
//   G.sys.engine.grade({exposure, contrast, saturation, warmth, vignette, lift, gain, flash}, layer = 'base')
//       colour grade (one combined pass after bloom, before OutputPass). The 'base' layer holds absolute values
//       (weather / time of day); any other layer name holds modifiers on top (exposure/contrast/saturation are
//       multipliers, warmth/vignette/flash are added) — grade(null, 'name') removes a layer. Values are eased
//       (~0.45 s) so large brightness changes are never abrupt. Low preset: exposure only (no extra pass).
//   G.sys.engine.gradeState      the eased values on screen right now
//   G.sys.engine.setOutline(objects|null, {color, strength}) -> meshes outlined   soft pulsing rim glow (inverted
//       hull, ≤ 1 Hz pulse, steady with reduceMotion) for hovered interactables; works on every preset, also for
//       skinned (NPC) and instanced meshes. clearOutline(). Calling it every frame with the same list is free.
//   G.sys.engine.updateEnvironment(force)   re-bake scene.environment from the sky (PMREM)
//   G.sys.engine.raycastScreen(clientX, clientY, objects, recursive) -> intersections
//   G.sys.engine.worldToScreen(vec3) -> {x, y, visible}
//   G.sys.engine.atmos           {sunGlow, rays} weather-driven strengths of the sun glow / god rays (0..1)
//   G.gfx.canvasTexture(w, h, drawFn(ctx,w,h), opts) / G.gfx.material(key, factory) / G.gfx.fixNormals(geo)
//   G.gfx.nanScrubShader         the NaN/Inf scrub shader that runs before bloom (dev-center GPU checks)
//
// Post chain (medium / high): RenderPass → [NaNScrub → UnrealBloom] → AtmosPass(god rays on high, sun glow, grade,
// vignette, dither) → OutputPass (ACES + sRGB). Low renders straight to the canvas exactly as before.
// Every shader guards normalize / division / pow / sqrt; the AtmosPass scrubs NaN itself when bloom is off.
// =============================================================================
(function () {
  const PRESETS = {
    low: { name: 'low', label: '낮음', pixelRatio: 1, shadows: false, shadowSize: 0, bloom: false, grade: false, godrays: false, atmos: 0, antialias: false, treeDensity: 0.45, grassDensity: 0.0, drawDistance: 700, flare: false },
    medium: { name: 'medium', label: '중간', pixelRatio: 1.25, shadows: true, shadowSize: 1024, bloom: false, grade: true, godrays: false, atmos: 1, antialias: true, treeDensity: 0.75, grassDensity: 0.5, drawDistance: 1200, flare: true },
    high: { name: 'high', label: '높음', pixelRatio: 2, shadows: true, shadowSize: 2048, bloom: true, grade: true, godrays: true, atmos: 2, antialias: true, treeDensity: 1.0, grassDensity: 1.0, drawDistance: 2000, flare: true },
  };
  // world-ambience features: minimum preset level (0 low, 1 medium, 2 high) and whether reduceMotion turns them off
  const FEATURES = {
    grade: { min: 1 }, sunGlow: { min: 1 }, godrays: { min: 2 },
    petals: { min: 1, motion: true, fx: true }, mist: { min: 2 }, smoke: { min: 1 },
    caustics: { min: 1 }, rainRings: { min: 1 }, splashes: { min: 0 }, lightning: { min: 0, motion: true, fx: true },
    sway: { min: 0 },
  };
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const fin = (v, d) => (Number.isFinite(v) ? v : d);
  const clampColor = (c, lo, hi, def) => { c.r = clamp(fin(c.r, def), lo, hi); c.g = clamp(fin(c.g, def), lo, hi); c.b = clamp(fin(c.b, def), lo, hi); return c; };

  function autoQuality() {
    if (G.input?.touchUI) return 'low';
    const mem = navigator.deviceMemory || 8;
    const cores = navigator.hardwareConcurrency || 4;
    if (mem <= 2 || cores <= 2) return 'low';
    if (mem <= 4 || cores <= 4) return 'medium';
    return 'high';
  }
  function resolveQuality() {
    const q = G.flags.quality || G.settings.quality || 'auto';
    return PRESETS[q] ? q : autoQuality();
  }

  // ---------------------------------------------------------------- geometry hygiene (GPU NaN guard)
  // Zero-length or NaN vertex normals (degenerate triangles, cone tips, parts scaled to 0) make real GPUs evaluate
  // normalize(vec3(0)) = NaN (Direct3D/ANGLE on Windows); bloom then smears that NaN into big black rectangles.
  // Normals are repaired at the source (computeVertexNormals / applyMatrix4 / mergeGeometries) and new scene
  // geometries are scanned once (engine.update), so no module has to remember it.
  function fixNormals(geo) {
    const n = geo && geo.attributes && geo.attributes.normal;
    if (!n || n.itemSize !== 3) return geo;
    let bad = 0;
    if (n.isInterleavedBufferAttribute) {
      for (let i = 0; i < n.count; i++) {
        const x = n.getX(i), y = n.getY(i), z = n.getZ(i), l2 = x * x + y * y + z * z;
        if (!(l2 > 1e-12) || !Number.isFinite(l2)) { n.setXYZ(i, 0, 1, 0); bad++; }
      }
    } else {
      const a = n.array;
      for (let i = 0; i + 2 < a.length; i += 3) {
        const x = a[i], y = a[i + 1], z = a[i + 2], l2 = x * x + y * y + z * z;
        if (!(l2 > 1e-12) || !Number.isFinite(l2)) { a[i] = 0; a[i + 1] = 1; a[i + 2] = 0; bad++; }
      }
    }
    if (bad) { n.needsUpdate = true; fixNormals.repaired += bad; }
    return geo;
  }
  fixNormals.repaired = 0;
  const BG = THREE.BufferGeometry.prototype;
  if (!BG.__tfmNormalFix) {
    BG.__tfmNormalFix = true;
    const computeVertexNormals = BG.computeVertexNormals;
    BG.computeVertexNormals = function () { computeVertexNormals.call(this); fixNormals(this); };
    const applyMatrix4 = BG.applyMatrix4;
    BG.applyMatrix4 = function (m) { applyMatrix4.call(this, m); fixNormals(this); return this; };
    const U = ADDONS.BufferGeometryUtils;
    if (U && typeof U.mergeGeometries === 'function') {
      ADDONS.BufferGeometryUtils = Object.assign({}, U, { mergeGeometries: (...a) => fixNormals(U.mergeGeometries(...a)) });
    }
  }
  const checkedGeos = new WeakSet();
  function scanSceneNormals(root) {
    let n = 0;
    root.traverse((o) => { const g = o.geometry; if (g && !checkedGeos.has(g)) { checkedGeos.add(g); fixNormals(g); n++; } });
    return n;
  }

  // ---------------------------------------------------------------- shaders
  const FS_VERT = 'varying vec2 vUv;\nvoid main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
  const SCRUB_FRAG = [
    'uniform sampler2D tDiffuse;', 'varying vec2 vUv;',
    'void main() {',
    '  vec4 c = texture2D(tDiffuse, vUv);',
    '  if (any(isnan(c)) || any(isinf(c))) c = vec4(0.0, 0.0, 0.0, 1.0);',
    '  gl_FragColor = vec4(min(max(c.rgb, vec3(0.0)), vec3(48.0)), clamp(c.a, 0.0, 1.0));',
    '}',
  ].join('\n');
  const NAN_SCRUB = {
    name: 'NaNScrubShader',
    uniforms: { tDiffuse: { value: null } },
    vertexShader: 'varying vec2 vUv;\nvoid main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: SCRUB_FRAG,
  };
  const GLSL_COMMON = `
    float tfLuma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
    vec3 tfSafe(vec3 c) { if (any(isnan(c)) || any(isinf(c))) return vec3(0.0); return clamp(c, vec3(0.0), vec3(48.0)); }
    float tfIgn(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
  `;
  // god rays: radial march towards the sun on a quarter-resolution buffer; only very bright (sky) texels shine,
  // so mountains, trees and roofs cut the light into shafts. Off-screen samples are ignored (no edge streaks).
  const RAYS_FRAG = `
    uniform sampler2D tDiffuse; uniform vec3 uSun; uniform float uAspect; uniform float uThr;
    varying vec2 vUv;
    ${GLSL_COMMON}
    void main() {
      vec2 toSun = uSun.xy - vUv;
      float dist = length(toSun * vec2(uAspect, 1.0));
      vec2 stepUv = toSun * (0.92 / 28.0);
      vec2 p = vUv + stepUv * tfIgn(gl_FragCoord.xy);
      vec3 sum = vec3(0.0);
      // adaptive threshold: only texels nearly as bright as the sky right at the sun cast shafts (no broad haze)
      float skyAtSun = tfLuma(tfSafe(texture2D(tDiffuse, clamp(uSun.xy, vec2(0.002), vec2(0.998))).rgb));
      float thr = max(uThr, min(skyAtSun * 0.6, 8.0));
      float illum = 1.0;
      for (int i = 0; i < 28; i++) {
        float inside = step(0.0, p.x) * step(p.x, 1.0) * step(0.0, p.y) * step(p.y, 1.0);
        vec3 s = tfSafe(texture2D(tDiffuse, clamp(p, vec2(0.0), vec2(1.0))).rgb);
        float m = smoothstep(thr, thr * 1.8, tfLuma(s));
        sum += min(s, vec3(6.0)) * m * illum * inside;
        illum *= 0.95;
        p += stepUv;
      }
      sum *= (0.4 / 28.0) * exp(-dist * 2.6) * uSun.z;
      gl_FragColor = vec4(sum, 1.0);
    }`;
  const ATMOS_FRAG = `
    uniform sampler2D tDiffuse; uniform sampler2D tRays;
    uniform float uRays; uniform vec3 uSun; uniform vec3 uSunCol; uniform float uGlow; uniform float uAspect; uniform float uGlowThr;
    uniform float uContrast; uniform float uSaturation; uniform float uWarmth; uniform float uVignette;
    uniform vec3 uLift; uniform vec3 uGain; uniform float uFlash;
    varying vec2 vUv;
    ${GLSL_COMMON}
    float tfDisc(vec2 uv, vec2 c, float r, float soft) {
      float d = length((uv - c) * vec2(uAspect, 1.0));
      return 1.0 - smoothstep(r * (1.0 - soft), r, d);
    }
    void main() {
      vec3 c = tfSafe(texture2D(tDiffuse, vUv).rgb);
      // ---- sun: analytic glow + soft lens ghosts (replaces the framebuffer-copy lens flare), occlusion-tested
      if (uSun.z > 0.002 && uGlow > 0.002) {
        vec2 sp = uSun.xy;
        float edge = min(min(sp.x, 1.0 - sp.x), min(sp.y, 1.0 - sp.y));
        float onScreen = smoothstep(-0.02, 0.03, edge);
        if (onScreen > 0.0) {
          vec2 o = vec2(0.006 / max(uAspect, 0.2), 0.006);
          vec2 cs = clamp(sp, vec2(0.001), vec2(0.999));
          float occ = tfLuma(tfSafe(texture2D(tDiffuse, cs).rgb));
          occ += tfLuma(tfSafe(texture2D(tDiffuse, clamp(cs + vec2(o.x, 0.0), vec2(0.001), vec2(0.999))).rgb));
          occ += tfLuma(tfSafe(texture2D(tDiffuse, clamp(cs - vec2(o.x, 0.0), vec2(0.001), vec2(0.999))).rgb));
          occ += tfLuma(tfSafe(texture2D(tDiffuse, clamp(cs + vec2(0.0, o.y), vec2(0.001), vec2(0.999))).rgb));
          occ += tfLuma(tfSafe(texture2D(tDiffuse, clamp(cs - vec2(0.0, o.y), vec2(0.001), vec2(0.999))).rgb));
          float vis = smoothstep(uGlowThr, uGlowThr * 2.0 + 0.3, occ * 0.2) * onScreen * uSun.z * uGlow;
          if (vis > 0.0) {
            float r = length((vUv - sp) * vec2(uAspect, 1.0));
            float glow = exp(-r * 18.0) * 0.36 + exp(-r * 5.0) * 0.08;
            float hr = (r - 0.26) * 16.0;
            float halo = exp(-hr * hr) * 0.035;
            vec2 axis = vec2(0.5) - sp;
            float gh = tfDisc(vUv, sp + axis * 0.62, 0.035, 0.7) * 0.07
                     + tfDisc(vUv, sp + axis * 1.32, 0.06, 0.85) * 0.05
                     + tfDisc(vUv, sp + axis * 1.75, 0.022, 0.5) * 0.08;
            c += uSunCol * glow * vis + mix(uSunCol, vec3(0.62, 0.82, 1.0), 0.55) * (gh + halo) * vis;
          }
        }
      }
      // ---- god rays (high preset)
      // shafts read against darker things (ridges, crowns, roofs); the already-bright sky is not washed further
      if (uRays > 0.001) c += texture2D(tRays, vUv).rgb * uRays * mix(vec3(1.0), uSunCol, 0.65) * (1.0 - 0.8 * smoothstep(0.5, 2.2, tfLuma(c)));
      // ---- grade (linear HDR; exposure + ACES happen in OutputPass)
      c *= vec3(1.0 + uWarmth * 0.11, 1.0 + uWarmth * 0.015, 1.0 - uWarmth * 0.13);
      float L = tfLuma(c);
      float Lc = 0.18 * pow(max(L, 1e-5) / 0.18, uContrast);
      c *= Lc / max(L, 1e-5);
      L = tfLuma(c);
      // vibrance-style saturation: already vivid colours (lawn, roofs) get less of the boost
      float cMax = max(c.r, max(c.g, c.b)), cMin = min(c.r, min(c.g, c.b));
      float chroma = (cMax - cMin) / max(cMax, 1e-4);
      float satK = mix(uSaturation, 1.0 + (uSaturation - 1.0) * 0.35, clamp(chroma, 0.0, 1.0));
      c = max(mix(vec3(L), c, satK), vec3(0.0));
      c += uLift * (1.0 - smoothstep(0.0, 0.3, L));
      c *= mix(vec3(1.0), uGain, smoothstep(0.3, 1.8, L));
      c += vec3(0.6, 0.68, 0.92) * uFlash * (0.05 + min(L, 2.0) * 0.45);
      vec2 q = (vUv - 0.5) * 2.0 * vec2(min(uAspect, 2.2) / 1.55, 1.0);
      c *= 1.0 - smoothstep(0.55, 1.55, length(q)) * uVignette;
      c *= 1.0 + (tfIgn(gl_FragCoord.xy) - 0.5) * 0.012;
      gl_FragColor = vec4(tfSafe(c), 1.0);
    }`;

  // full-screen triangle (no normals: never part of the scene)
  let fsGeo = null;
  const fsCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  function fsGeometry() {
    if (!fsGeo) {
      fsGeo = new THREE.BufferGeometry();
      fsGeo.setAttribute('position', new THREE.Float32BufferAttribute([-1, 3, 0, -1, -1, 0, 3, -1, 0], 3));
      fsGeo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 2, 0, 0, 2, 0], 2));
    }
    return fsGeo;
  }

  /** combined atmosphere pass (EffectComposer pass protocol): god rays → sun glow → grade → vignette → dither */
  class AtmosPass {
    constructor(opts) {
      this.enabled = true; this.needsSwap = true; this.clear = false; this.renderToScreen = false;
      this.godrays = !!opts.godrays;
      this.uniforms = {
        tDiffuse: { value: null }, tRays: { value: null }, uRays: { value: 0 },
        uSun: { value: new THREE.Vector3(0.5, 0.5, 0) }, uSunCol: { value: new THREE.Color(1, 0.95, 0.85) },
        uGlow: { value: 0 }, uGlowThr: { value: 3.0 }, uAspect: { value: 1.6 },
        uContrast: { value: 1 }, uSaturation: { value: 1 }, uWarmth: { value: 0 }, uVignette: { value: 0 },
        uLift: { value: new THREE.Color(0, 0, 0) }, uGain: { value: new THREE.Color(1, 1, 1) }, uFlash: { value: 0 },
      };
      this.material = new THREE.ShaderMaterial({ name: 'AtmosGradeShader', uniforms: this.uniforms, vertexShader: FS_VERT, fragmentShader: ATMOS_FRAG, depthTest: false, depthWrite: false, toneMapped: false });
      this.quad = new THREE.Mesh(fsGeometry(), this.material);
      this.quad.frustumCulled = false;
      this.rayUniforms = { tDiffuse: { value: null }, uSun: this.uniforms.uSun, uAspect: this.uniforms.uAspect, uThr: { value: 2.2 } };
      this.rayMat = this.godrays ? new THREE.ShaderMaterial({ name: 'GodRayShader', uniforms: this.rayUniforms, vertexShader: FS_VERT, fragmentShader: RAYS_FRAG, depthTest: false, depthWrite: false, toneMapped: false }) : null;
      this.rayRT = this.godrays ? new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, depthBuffer: false }) : null;
      this.rayActive = false;
    }
    setSize(w, h) {
      this.uniforms.uAspect.value = w / Math.max(1, h);
      if (this.rayRT) this.rayRT.setSize(Math.max(1, Math.floor(w / 4)), Math.max(1, Math.floor(h / 4)));
    }
    render(renderer, writeBuffer, readBuffer) {
      const u = this.uniforms;
      const rays = !!(this.rayRT && u.uRays.value > 0.001 && u.uSun.value.z > 0.002);
      if (rays) {
        this.rayUniforms.tDiffuse.value = readBuffer.texture;
        this.quad.material = this.rayMat;
        renderer.setRenderTarget(this.rayRT);
        renderer.render(this.quad, fsCam);
        this.quad.material = this.material;
      }
      u.tDiffuse.value = readBuffer.texture;
      u.tRays.value = rays ? this.rayRT.texture : null;
      if (!rays) u.uRays.value = 0;
      renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
      renderer.render(this.quad, fsCam);
    }
    dispose() { this.material.dispose(); this.rayMat?.dispose(); this.rayRT?.dispose(); }
  }

  // outline hull (inverted, view-space inflated back faces; soft additive rim)
  const OUTLINE_VERT = `
    #include <common>
    #include <skinning_pars_vertex>
    uniform float uPx; uniform float uWidth;
    varying float vRim;
    void main() {
      #include <beginnormal_vertex>
      #include <skinbase_vertex>
      #include <skinnormal_vertex>
      #include <begin_vertex>
      #include <skinning_vertex>
      vec3 tfN = objectNormal;
      vec4 tfP = vec4(transformed, 1.0);
      #ifdef USE_INSTANCING
        mat3 tfIm = mat3(instanceMatrix);
        vec3 tfD = vec3(dot(tfIm[0], tfIm[0]), dot(tfIm[1], tfIm[1]), dot(tfIm[2], tfIm[2]));
        tfN = tfIm * (tfN / max(tfD, vec3(1e-8)));
        tfP = instanceMatrix * tfP;
      #endif
      vec4 mvPosition = modelViewMatrix * tfP;
      vec3 n = normalMatrix * tfN;
      float nl = length(n);
      n = nl > 1e-6 ? n / nl : vec3(0.0, 0.0, 1.0);
      float dist = max(-mvPosition.z, 0.1);
      mvPosition.xyz += n * clamp(uWidth * uPx * dist, 0.006, 0.09);
      vec3 vd = -mvPosition.xyz; float vl = length(vd); vd = vl > 1e-6 ? vd / vl : vec3(0.0, 0.0, 1.0);
      vRim = 1.0 - abs(dot(n, vd));
      gl_Position = projectionMatrix * mvPosition;
    }`;
  const OUTLINE_FRAG = `
    uniform vec3 uColor; uniform float uAlpha;
    varying float vRim;
    void main() {
      float a = (0.45 + 0.55 * smoothstep(0.0, 0.85, vRim)) * uAlpha;
      gl_FragColor = vec4(uColor * a, a);
    }`;

  // ---------------------------------------------------------------- tiny graphics helpers shared by world modules
  const matCache = new Map();
  G.gfx = {
    /** repair zero/NaN vertex normals in place (see "geometry hygiene"); returns the geometry */
    fixNormals,
    get normalsRepaired() { return fixNormals.repaired; },
    /** the NaN/Inf scrub that runs before bloom (read by the dev center's GPU checks) */
    nanScrubShader: NAN_SCRUB,
    /** CanvasTexture from a 2D drawing function */
    canvasTexture(w, h, draw, opts = {}) {
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const ctx = c.getContext('2d');
      draw(ctx, w, h);
      const t = new THREE.CanvasTexture(c);
      if (opts.srgb !== false) t.colorSpace = THREE.SRGBColorSpace;
      if (opts.repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(opts.repeat[0], opts.repeat[1]); }
      t.anisotropy = opts.anisotropy ?? 4;
      if (opts.nearest) { t.magFilter = THREE.NearestFilter; }
      t.needsUpdate = true;
      return t;
    },
    /** shared material cache: G.gfx.material('roofTile', () => new THREE.MeshStandardMaterial({...})) */
    material(key, factory) {
      if (!matCache.has(key)) matCache.set(key, factory());
      return matCache.get(key);
    },
    /** soft radial sprite texture (glows, clouds, flares) */
    radialTexture(size = 128, inner = 'rgba(255,255,255,1)', outer = 'rgba(255,255,255,0)') {
      return G.gfx.canvasTexture(size, size, (ctx, w) => {
        const g = ctx.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
        g.addColorStop(0, inner); g.addColorStop(1, outer);
        ctx.fillStyle = g; ctx.fillRect(0, 0, w, w);
      });
    },
    /** wooden sign board texture with Korean text */
    signTexture(title, sub, opts = {}) {
      const w = opts.w || 512, h = opts.h || 256;
      return G.gfx.canvasTexture(w, h, (ctx) => {
        const bg = ctx.createLinearGradient(0, 0, 0, h);
        bg.addColorStop(0, opts.bg1 || '#7a5232'); bg.addColorStop(1, opts.bg2 || '#5b3a22');
        ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
        ctx.globalAlpha = 0.12; ctx.strokeStyle = '#000';
        for (let y = 10; y < h; y += 14) { ctx.beginPath(); ctx.moveTo(0, y + Math.sin(y) * 3); ctx.bezierCurveTo(w * 0.3, y + 6, w * 0.6, y - 6, w, y + 2); ctx.stroke(); }
        ctx.globalAlpha = 1;
        ctx.strokeStyle = opts.border || '#3b2414'; ctx.lineWidth = 14; ctx.strokeRect(7, 7, w - 14, h - 14);
        ctx.fillStyle = opts.color || '#fff6e0';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        const font = `"PretendardEmbed","Pretendard","Noto Sans KR","Apple SD Gothic Neo","Malgun Gothic",sans-serif`;
        let size = opts.size || Math.round(h * 0.3);
        ctx.font = `800 ${size}px ${font}`;
        while (ctx.measureText(title).width > w * 0.86 && size > 12) { size -= 2; ctx.font = `800 ${size}px ${font}`; }
        ctx.shadowColor = 'rgba(0,0,0,.45)'; ctx.shadowBlur = 6; ctx.shadowOffsetY = 3;
        ctx.fillText(title, w / 2, sub ? h * 0.42 : h / 2);
        if (sub) { ctx.font = `600 ${Math.round(size * 0.45)}px ${font}`; ctx.fillStyle = opts.subColor || '#f4d9a8'; ctx.fillText(sub, w / 2, h * 0.72); }
      });
    },
  };

  // ---------------------------------------------------------------- GLB asset hook (spec #22/#66: code and models are separated)
  // Modules build procedural blockout models; when G.data.modelOverrides[anchorId] = 'assets/models/x.glb'
  // exists and the file loads (http/https hosting), modules may swap the procedural mesh for the GLB.
  G.data.modelOverrides = G.data.modelOverrides || {};
  G.assets = {
    _cache: new Map(),
    loadGLB(url) {
      if (!ADDONS.GLTFLoader) return Promise.reject(new Error('GLTFLoader missing'));
      if (!/^https?:$/.test(location.protocol)) return Promise.reject(new Error('GLB loading needs http(s) hosting'));
      // same-origin relative paths only (CSP; never load models from other sites)
      if (typeof url !== 'string' || !/^[\w./-]+\.glb$/i.test(url) || url.startsWith('//') || url.includes('..')) return Promise.reject(new Error('model path must be a same-origin .glb path'));
      if (!this._cache.has(url)) {
        this._cache.set(url, new Promise((resolve, reject) => new ADDONS.GLTFLoader().load(url, resolve, undefined, reject)));
      }
      return this._cache.get(url);
    },
    /** replace children of `group` with the GLB at G.data.modelOverrides[id] (keeps procedural model on failure) */
    async tryOverride(id, group) {
      const url = G.data.modelOverrides[id];
      if (!url || !group) return false;
      try {
        const gltf = await this.loadGLB(url);
        const model = gltf.scene.clone(true);
        model.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; if (o.geometry) fixNormals(o.geometry); } });
        group.clear();
        group.add(model);
        G.log.info('ASSETS', `model override applied: ${id} <- ${url}`);
        return true;
      } catch (e) { G.log.warn('ASSETS', `model override failed for ${id}`, e.message || e); return false; }
    },
  };

  // ---------------------------------------------------------------- grade state
  const GRADE_KEYS = ['exposure', 'contrast', 'saturation', 'warmth', 'vignette', 'flash'];
  const GRADE_NEUTRAL = { exposure: 0.92, contrast: 1, saturation: 1, warmth: 0, vignette: 0.22, flash: 0 };
  const GRADE_LIMITS = { exposure: [0.2, 2.5], contrast: [0.7, 1.4], saturation: [0, 1.8], warmth: [-1, 1], vignette: [0, 0.8], flash: [0, 1] };
  const _lift = new THREE.Color(0, 0, 0), _gain = new THREE.Color(1, 1, 1), _liftGoal = new THREE.Color(0, 0, 0), _gainGoal = new THREE.Color(1, 1, 1);
  const _sunV = new THREE.Vector3(), _camFwd = new THREE.Vector3(), _sunCol = new THREE.Color();

  const engine = {
    name: 'engine',
    label: '3D 엔진',
    order: 0,
    renderer: null, scene: null, camera: null,
    sun: null, hemi: null, sky: null, composer: null, bloomPass: null, atmosPass: null, flare: null,
    focus: new THREE.Vector3(0, 0, 0),
    sunDir: new THREE.Vector3(0.4, 0.8, 0.3).normalize(),
    sunElevation: 45, sunAzimuth: 160,
    preset: PRESETS.high,
    quality: 'high',
    fps: 60,
    frameInfo: { calls: 0, triangles: 0 },
    atmos: { sunGlow: 1, rays: 1 },
    flareSuppressed: false,
    gradeState: { ...GRADE_NEUTRAL },
    _gradeBase: { ...GRADE_NEUTRAL },
    _gradeLayers: new Map(),
    _gradeGoal: { ...GRADE_NEUTRAL },
    _fpsAcc: 0, _fpsFrames: 0, _lowFpsTime: 0,
    _envDirty: true, _envTimer: 0,
    _resizeFns: [],
    _outline: null,

    init() {
      const container = document.getElementById('game-container');
      this.quality = resolveQuality();
      this.preset = PRESETS[this.quality];
      const renderer = new THREE.WebGLRenderer({
        // MSAA happens in the composer target when post-processing is on (medium/high); the low preset stays direct
        antialias: this.preset.antialias && !this._wantsComposer(this.preset),
        powerPreference: 'high-performance',
        preserveDrawingBuffer: false,
        alpha: false,
      });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.preset.pixelRatio));
      renderer.setSize(window.innerWidth, window.innerHeight);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 0.88;
      renderer.shadowMap.enabled = !!this.preset.shadows && G.settings.shadows !== false;
      renderer.shadowMap.type = this.quality === 'high' ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
      renderer.info.autoReset = false; // one reset per frame in render(): composer frames count every pass
      renderer.domElement.setAttribute('tabindex', '0');
      renderer.domElement.addEventListener('webglcontextlost', (e) => { e.preventDefault(); this._lost = true; G.ui?.toast?.('그래픽 장치가 잠깐 쉬고 있어요. 계속 멈춰 있으면 새로고침해 주세요.', { type: 'warn', duration: 6000 }); });
      renderer.domElement.addEventListener('webglcontextrestored', () => { this._lost = false; this._envDirty = true; G.log.info('ENGINE', 'WebGL context restored'); });
      container.appendChild(renderer.domElement);
      this.renderer = renderer;

      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0x9cc7ea);
      scene.fog = new THREE.FogExp2(0xbcd6e8, 0.0028);
      this.scene = scene;

      const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 3000);
      camera.position.set(0, 12, 30);
      camera.lookAt(0, 0, 0);
      scene.add(camera); // allows camera-attached children (rain emitters, flare anchor)
      this.camera = camera;

      // sky dome (Preetham)
      if (ADDONS.Sky) {
        const sky = new ADDONS.Sky();
        sky.scale.setScalar(2800);
        const u = sky.material.uniforms;
        u.turbidity.value = 5.5; u.rayleigh.value = 1.5; u.mieCoefficient.value = 0.004; u.mieDirectionalG.value = 0.82;
        sky.frustumCulled = false;
        sky.renderOrder = -10;
        scene.add(sky);
        this.sky = sky;
        this._envScene = new THREE.Scene();
        this._envSky = new ADDONS.Sky();
        this._envSky.scale.setScalar(1000);
        Object.assign(this._envSky.material.uniforms.turbidity, { value: 5.5 });
        this._envScene.add(this._envSky);
        this._pmrem = new THREE.PMREMGenerator(renderer);
      }

      // lights
      const hemi = new THREE.HemisphereLight(0xcfe3ff, 0x5c6b3c, 0.85);
      scene.add(hemi);
      this.hemi = hemi;
      const sun = new THREE.DirectionalLight(0xfff0d8, 2.6);
      sun.castShadow = renderer.shadowMap.enabled;
      if (sun.castShadow) this._configureShadow(sun);
      scene.add(sun);
      scene.add(sun.target);
      this.sun = sun;
      const fill = new THREE.DirectionalLight(0xbfd6ff, 0.35); // soft sky bounce from the opposite side
      fill.position.set(-50, 40, -60);
      scene.add(fill);
      this.fill = fill;

      // outline glow root (hulls copy their source's world matrix at render time: no lag, no scene-graph edits)
      this._outlineRoot = new THREE.Group();
      this._outlineRoot.name = 'outline-glow';
      this._outlineRoot.matrixAutoUpdate = false;
      scene.add(this._outlineRoot);

      this._setupComposer();
      this.setSun(this.sunElevation, this.sunAzimuth);

      window.addEventListener('resize', () => this.resize());
      G.bus.on('settings:changed', ({ key }) => {
        if (key === 'quality') this.setQuality(G.settings.quality);
        if (key === 'shadows') this.setShadows(G.settings.shadows);
        if (key === 'bloom') this._setupComposer();
        if (key === 'showFps') { const el = document.getElementById('fps-meter'); if (el) el.hidden = !G.settings.showFps; }
        if (key === 'reduceMotion' || key === 'fxLevel') G.bus.emit('engine:features', { quality: this.quality });
      });
      const fm = document.getElementById('fps-meter');
      if (fm) fm.hidden = !G.settings.showFps;
      G.log.info('ENGINE', `three r${THREE.REVISION}, quality=${this.quality}, post=${this.composer ? this.composer.passes.length + ' passes' : 'direct'}`);
    },

    _wantsComposer(p = this.preset) {
      return !!ADDONS.EffectComposer && (!!p.grade || (!!p.bloom && G.settings.bloom !== false));
    },

    /** is a world-ambience feature on (preset level, reduceMotion, fxLevel 'off')? */
    feature(name) {
      const f = FEATURES[name];
      if (!f) return false;
      const lvl = this.preset?.atmos ?? 0;
      if (lvl < f.min) return false;
      if (f.motion && G.settings?.reduceMotion) return false;
      if (f.fx && G.settings?.fxLevel === 'off') return false;
      if (name === 'godrays') return !!this.atmosPass?.rayRT;
      return true;
    },

    _configureShadow(sun) {
      const s = sun.shadow;
      const size = this.preset.shadowSize || 1024;
      s.mapSize.set(size, size);
      const R = this.quality === 'high' ? 55 : 45;
      Object.assign(s.camera, { left: -R, right: R, top: R, bottom: -R, near: 1, far: 400 });
      s.camera.updateProjectionMatrix();
      s.bias = -0.00035;
      s.normalBias = 0.035;
      s.radius = 3;
      if (s.map) { s.map.dispose(); s.map = null; } // a new map size needs a new shadow target
    },

    _disposeComposer() {
      const c = this.composer;
      if (!c) return;
      for (const p of c.passes || []) { try { p.dispose?.(); } catch (e) { /* already gone */ } }
      try { c.dispose?.(); } catch (e) { /* ignore */ }
      this.composer = null; this.bloomPass = null; this.atmosPass = null;
    },

    _setupComposer() {
      this._disposeComposer();
      if (!this._wantsComposer()) { G.bus.emit('engine:features', { quality: this.quality }); return; }
      try {
        const r = this.renderer;
        const size = r.getDrawingBufferSize(new THREE.Vector2());
        const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: this.preset.antialias ? 4 : 0 });
        const composer = new ADDONS.EffectComposer(r, rt);
        composer.setPixelRatio(r.getPixelRatio());
        composer.setSize(window.innerWidth, window.innerHeight);
        composer.addPass(new ADDONS.RenderPass(this.scene, this.camera));
        const bloomOn = !!this.preset.bloom && G.settings.bloom !== false && !!ADDONS.UnrealBloomPass;
        if (bloomOn) {
          // NaN/Inf scrub before bloom: one bad pixel (any shader, any GPU) must never be blurred into a black box;
          // also caps HDR so half-float bloom targets cannot overflow. max/min drop NaN on D3D; isnan/isinf cover GL.
          if (ADDONS.ShaderPass) composer.addPass(new ADDONS.ShaderPass({ ...NAN_SCRUB, uniforms: { tDiffuse: { value: null } } }));
          // threshold > 1: only HDR emissives (lanterns, markers, glowing jars) bloom
          const bloom = new ADDONS.UnrealBloomPass(new THREE.Vector2(window.innerWidth / 2, window.innerHeight / 2), 0.24, 0.4, 1.05);
          composer.addPass(bloom);
          this.bloomPass = bloom;
        }
        if (this.preset.grade) {
          // the atmosphere pass scrubs its own input, so medium (no bloom) is NaN-safe too
          const ap = new AtmosPass({ godrays: !!this.preset.godrays });
          composer.addPass(ap);
          this.atmosPass = ap;
        }
        composer.addPass(new ADDONS.OutputPass());
        this.composer = composer;
      } catch (e) {
        G.log.warn('ENGINE', 'post-processing unavailable, rendering directly', e);
        this._disposeComposer();
      }
      G.bus.emit('engine:features', { quality: this.quality });
    },

    setShadows(on) {
      on = !!on && !!this.preset.shadows;
      this.renderer.shadowMap.enabled = on;
      this.sun.castShadow = on;
      if (on) this._configureShadow(this.sun);
      this.scene.traverse((o) => { if (o.material) { const m = Array.isArray(o.material) ? o.material : [o.material]; m.forEach((x) => (x.needsUpdate = true)); } });
    },

    setQuality(q) {
      const name = PRESETS[q] ? q : autoQuality();
      const prevDensity = this.preset.treeDensity;
      this.quality = name;
      this.preset = PRESETS[name];
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.preset.pixelRatio));
      this.renderer.shadowMap.type = name === 'high' ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
      this.setShadows(G.settings.shadows !== false);
      this._setupComposer();
      this.resize();
      G.bus.emit('engine:quality', { quality: name, preset: this.preset, reloadSuggested: prevDensity !== this.preset.treeDensity });
    },

    /** elevation/azimuth in degrees. azimuth 180 = sun in the south (+Z), 90 = east (+X) */
    setSun(elevationDeg, azimuthDeg, opts = {}) {
      elevationDeg = fin(Number(elevationDeg), this.sunElevation); azimuthDeg = fin(Number(azimuthDeg), this.sunAzimuth);
      this.sunElevation = elevationDeg; this.sunAzimuth = azimuthDeg;
      const phi = THREE.MathUtils.degToRad(90 - elevationDeg);
      const theta = THREE.MathUtils.degToRad(azimuthDeg);
      // spherical: x = sin(phi) sin(theta), y = cos(phi), z = -sin(phi) cos(theta)  (north = -Z)
      this.sunDir.set(Math.sin(phi) * Math.sin(theta), Math.cos(phi), -Math.sin(phi) * Math.cos(theta)).normalize();
      if (this.sky) this.sky.material.uniforms.sunPosition.value.copy(this.sunDir);
      if (this._envSky) this._envSky.material.uniforms.sunPosition.value.copy(this.sunDir);
      if (opts.intensity != null) this.sun.intensity = opts.intensity;
      if (opts.color != null) this.sun.color.set(opts.color);
      this._envDirty = true;
    },

    /** colour grade targets (see header). Unknown keys are ignored; every value is clamped. */
    grade(params, layer = 'base') {
      layer = String(layer || 'base');
      if (layer !== 'base') {
        if (params == null) { this._gradeLayers.delete(layer); return this.gradeState; }
        const cur = this._gradeLayers.get(layer) || {};
        for (const k of GRADE_KEYS) if (params[k] != null && Number.isFinite(Number(params[k]))) cur[k] = Number(params[k]);
        if (params.lift) cur.lift = params.lift;
        if (params.gain) cur.gain = params.gain;
        this._gradeLayers.set(layer, cur);
        return this.gradeState;
      }
      if (!params) return this.gradeState;
      const b = this._gradeBase;
      for (const k of GRADE_KEYS) {
        const v = Number(params[k]);
        if (params[k] != null && Number.isFinite(v)) b[k] = clamp(v, GRADE_LIMITS[k][0], GRADE_LIMITS[k][1]);
      }
      if (params.lift != null) { try { _liftGoal.set(params.lift); } catch (e) { _liftGoal.setRGB(0, 0, 0); } clampColor(_liftGoal, 0, 0.08, 0); }
      if (params.gain != null) { try { _gainGoal.set(params.gain); } catch (e) { _gainGoal.setRGB(1, 1, 1); } clampColor(_gainGoal, 0.6, 1.5, 1); }
      if (params.instant) this._gradeSnap = true;
      return this.gradeState;
    },

    _updateGrade(dt) {
      const goal = this._gradeGoal, b = this._gradeBase;
      for (const k of GRADE_KEYS) goal[k] = b[k];
      for (const L of this._gradeLayers.values()) {
        if (L.exposure != null) goal.exposure *= L.exposure;
        if (L.contrast != null) goal.contrast *= L.contrast;
        if (L.saturation != null) goal.saturation *= L.saturation;
        if (L.warmth != null) goal.warmth += L.warmth;
        if (L.vignette != null) goal.vignette += L.vignette;
        if (L.flash != null) goal.flash += L.flash;
      }
      const s = this.gradeState;
      const k = this._gradeSnap ? 1 : 1 - Math.exp(-Math.min(dt || 0.016, 0.25) / 0.45);
      this._gradeSnap = false;
      for (const key of GRADE_KEYS) {
        const lim = GRADE_LIMITS[key];
        const g = clamp(goal[key], lim[0], lim[1]);
        const v = s[key] + (g - s[key]) * k;
        s[key] = Number.isFinite(v) ? v : GRADE_NEUTRAL[key];
      }
      _lift.lerp(_liftGoal, k); _gain.lerp(_gainGoal, k);
      // exposure is the renderer's (OutputPass / direct render): works on every preset
      if (this.renderer) this.renderer.toneMappingExposure = s.exposure * (1 + (this.atmosPass ? 0 : s.flash * 0.35));
      const ap = this.atmosPass;
      if (ap) {
        const u = ap.uniforms;
        u.uContrast.value = s.contrast; u.uSaturation.value = s.saturation; u.uWarmth.value = s.warmth;
        u.uVignette.value = s.vignette; u.uFlash.value = s.flash;
        u.uLift.value.copy(_lift); u.uGain.value.copy(_gain);
      }
    },

    /** sun screen position / visibility for the glow + god rays (no allocations) */
    _updateSunScreen() {
      const ap = this.atmosPass;
      if (!ap) return;
      const u = ap.uniforms, cam = this.camera;
      _camFwd.set(0, 0, -1).applyQuaternion(cam.quaternion);
      const front = _camFwd.dot(this.sunDir);
      _sunV.copy(cam.position).addScaledVector(this.sunDir, 1000).project(cam);
      const up = THREE.MathUtils.smoothstep(this.sunDir.y, -0.03, 0.07);
      const vis = front > 0.05 && Number.isFinite(_sunV.x) && Number.isFinite(_sunV.y) ? THREE.MathUtils.smoothstep(front, 0.05, 0.35) * up : 0;
      u.uSun.value.set(_sunV.x * 0.5 + 0.5, _sunV.y * 0.5 + 0.5, vis);
      const glow = clamp(fin(this.atmos.sunGlow, 1), 0, 1) * (this.flareSuppressed ? 0.25 : 1);
      u.uGlow.value = glow;
      u.uRays.value = this.feature('godrays') ? clamp(fin(this.atmos.rays, 1), 0, 1.5) * 0.9 : 0;
      // the sun's colour drives glow/ray tint (warm at golden hour), normalised so intensity does not double up
      _sunCol.copy(this.sun ? this.sun.color : _sunCol.setRGB(1, 0.95, 0.85));
      const m = Math.max(_sunCol.r, _sunCol.g, _sunCol.b, 1e-4);
      u.uSunCol.value.setRGB(_sunCol.r / m, _sunCol.g / m, _sunCol.b / m);
    },

    /** copy sky look (turbidity etc.) to the env-bake sky and re-bake scene.environment */
    updateEnvironment(force) {
      if (!this._pmrem || !this._envSky || this._lost) return;
      if (!force && !this._envDirty) return;
      const su = this.sky.material.uniforms, eu = this._envSky.material.uniforms;
      for (const k of ['turbidity', 'rayleigh', 'mieCoefficient', 'mieDirectionalG']) eu[k].value = su[k].value;
      eu.sunPosition.value.copy(this.sunDir);
      const rt = this._pmrem.fromScene(this._envScene, 0, 0.1, 1100);
      if (this._envRT) this._envRT.dispose();
      this._envRT = rt;
      this.scene.environment = rt.texture;
      this.scene.environmentIntensity = this.envIntensity ?? 0.5; // baked sky ~= sun; keep IBL as a soft fill
      this._envDirty = false;
    },

    /** add an object to the environment-bake scene (e.g. weather cloud overlay) */
    addEnvObject(obj) { if (this._envScene && obj) { this._envScene.add(obj); this._envDirty = true; } return obj; },
    removeEnvObject(obj) { if (this._envScene && obj) { this._envScene.remove(obj); this._envDirty = true; } },

    // ------------------------------------------------------------ outline glow (hovered interactables)
    setOutline(objs, opts = {}) {
      const list = objs == null ? [] : (Array.isArray(objs) ? objs : [objs]).filter((o) => o && o.isObject3D);
      const color = opts.color ?? 0xffd36a, strength = clamp(fin(Number(opts.strength), 1), 0, 2);
      const cur = this._outline;
      if (cur && cur.list.length === list.length && cur.color === color && cur.strength === strength && list.every((o, i) => o === cur.list[i])) return cur.count;
      this.clearOutline();
      if (!list.length || !this._outlineRoot) return 0;
      const mat = new THREE.ShaderMaterial({
        name: 'OutlineGlow',
        uniforms: { uColor: { value: new THREE.Color(color) }, uAlpha: { value: 0 }, uPx: { value: 0.001 }, uWidth: { value: 3.2 } },
        vertexShader: OUTLINE_VERT, fragmentShader: OUTLINE_FRAG,
        side: THREE.BackSide, transparent: true, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending, toneMapped: false, fog: false,
      });
      // HDR on bloom presets so the rim softly blooms; LDR otherwise
      mat.uniforms.uColor.value.multiplyScalar(this.bloomPass ? 1.6 : 1.0);
      const hulls = [];
      const MAX = 48;
      for (const root of list) {
        root.traverse((src) => {
          if (hulls.length >= MAX || !src.isMesh || src.isPoints || src.isLine || src.isSprite) return;
          if (!src.visible || src.name === 'pick-proxy' || src.name === 'blocker' || src.userData?.noOutline) return;
          const sm = Array.isArray(src.material) ? src.material[0] : src.material;
          if (!sm || sm.visible === false || (sm.transparent && sm.blending === THREE.AdditiveBlending)) return;
          const g = src.geometry;
          if (!g?.attributes?.position || !g.attributes.normal) return;
          let hull;
          if (src.isSkinnedMesh && src.skeleton) {
            hull = new THREE.SkinnedMesh(g, mat);
            hull.bind(src.skeleton, src.bindMatrix);
            hull.bindMode = src.bindMode;
          } else if (src.isInstancedMesh) {
            hull = new THREE.InstancedMesh(g, mat, src.count);
            hull.instanceMatrix = src.instanceMatrix;
            hull.count = src.count;
          } else hull = new THREE.Mesh(g, mat);
          hull.name = 'outline-hull';
          hull.matrixAutoUpdate = false; hull.matrixWorldAutoUpdate = false;
          hull.frustumCulled = false; hull.castShadow = false; hull.receiveShadow = false;
          hull.renderOrder = 6;
          hull.raycast = () => {};
          hull.userData.src = src;
          hull.onBeforeRender = () => {
            hull.matrixWorld.copy(src.matrixWorld);
            if (hull.geometry !== src.geometry && src.geometry?.attributes?.normal) hull.geometry = src.geometry;
            if (hull.isSkinnedMesh) hull.bindMatrixInverse.copy(src.bindMatrixInverse);
            if (hull.isInstancedMesh) hull.count = src.count;
          };
          this._outlineRoot.add(hull);
          hulls.push(hull);
        });
      }
      this._outline = { list, color, strength, mat, hulls, count: hulls.length, t: 0 };
      return hulls.length;
    },
    clearOutline() {
      const o = this._outline;
      if (!o) return;
      for (const h of o.hulls) { h.onBeforeRender = () => {}; this._outlineRoot?.remove(h); h.userData.src = null; }
      o.mat.dispose();
      this._outline = null;
    },
    get outline() { return this._outline ? { objects: this._outline.list.slice(), count: this._outline.count } : null; },
    _updateOutline(dt) {
      const o = this._outline;
      if (!o) return;
      o.t += dt;
      // hide hulls whose source is gone / hidden (walk up once per hull; only a handful exist)
      let any = false;
      for (const h of o.hulls) {
        let vis = !!h.userData.src;
        for (let p = h.userData.src; p && vis; p = p.parent) if (!p.visible) vis = false;
        if (vis && h.userData.src && !h.userData.src.parent) vis = false;
        h.visible = vis;
        any = any || vis;
      }
      if (!any) return;
      const u = o.mat.uniforms;
      const fade = Math.min(1, o.t / 0.18); // ease in (no pop)
      const pulse = G.settings?.reduceMotion ? 0.85 : 0.72 + 0.28 * Math.sin(o.t * Math.PI * 2 * 0.9); // 0.9 Hz breathing
      u.uAlpha.value = 0.55 * o.strength * fade * pulse;
      const cam = this.camera;
      u.uPx.value = 2 * Math.tan(THREE.MathUtils.degToRad(cam.fov || 55) / 2) / Math.max(1, window.innerHeight);
    },

    resize() {
      const w = window.innerWidth, h = window.innerHeight;
      this.renderer.setSize(w, h);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      if (this.composer) { this.composer.setPixelRatio(this.renderer.getPixelRatio()); this.composer.setSize(w, h); }
      if (this.bloomPass) this.bloomPass.resolution.set(w / 2, h / 2);
      for (const fn of this._resizeFns) { try { fn(w, h); } catch (e) { G.log.error('ENGINE', e); } }
    },
    onResize(fn) { if (typeof fn === 'function') this._resizeFns.push(fn); },

    update(dt) {
      // repair normals of geometries added since the last scan (crops regrowing, decorations, effects) ~every 1.5 s
      this._normScan = (this._normScan ?? 9) + dt; // first frame scans immediately
      if (this._normScan > 1.5 && this.scene) { this._normScan = 0; scanSceneNormals(this.scene); }
      // shadow camera + sun follow the focus point (player)
      const f = this.focus;
      if (this.sun && Number.isFinite(f.x) && Number.isFinite(f.z)) {
        this.sun.position.set(f.x + this.sunDir.x * 160, f.y + Math.max(this.sunDir.y, 0.08) * 160, f.z + this.sunDir.z * 160);
        this.sun.target.position.copy(f);
        this.sun.target.updateMatrixWorld();
      }
      this._updateGrade(dt);
      this._updateOutline(dt);
      // re-bake environment at most every 2s when sun/sky changed
      this._envTimer -= dt;
      if (this._envDirty && this._envTimer <= 0) { this._envTimer = 2; this.updateEnvironment(); }
      // fps & auto quality
      this._fpsAcc += dt; this._fpsFrames++;
      if (this._fpsAcc >= 0.5) {
        this.fps = this._fpsFrames / this._fpsAcc;
        this._fpsAcc = 0; this._fpsFrames = 0;
        if (G.settings.showFps) {
          const el = document.getElementById('fps-meter');
          if (el) el.textContent = `FPS ${this.fps.toFixed(0)}  ${this.quality}\ndraw ${this.frameInfo.calls}  tri ${(this.frameInfo.triangles / 1000).toFixed(0)}k`;
        }
        if ((G.settings.quality || 'auto') === 'auto' && !G.flags.quality && G.ready && !document.hidden) {
          this._lowFpsTime = this.fps < 24 ? this._lowFpsTime + 0.5 : Math.max(0, this._lowFpsTime - 0.5);
          if (this._lowFpsTime > 6 && this.quality !== 'low') {
            const next = this.quality === 'high' ? 'medium' : 'low';
            this.setQuality(next);
            this._lowFpsTime = 0;
            G.ui?.toast?.(`화면이 부드럽게 움직이도록 그래픽 품질을 '${PRESETS[next].label}'(으)로 낮췄어요.`, { type: 'info' });
          }
        }
      }
    },

    render() {
      if (this._lost) return;
      // The opaque developer center hides the world (render ~1/6); a large blocking modal covers most of it (~1/3).
      const cover = document.body.classList.contains('dc-open') ? 6
        : (G.ui?.modal?.isOpen?.() && document.querySelector('.modal.modal-lg, .modal.modal-xl')) ? 3 : 1;
      if (cover > 1) {
        this._skip = ((this._skip || 0) + 1) % cover;
        if (this._skip) return;
      }
      const info = this.renderer.info;
      info.reset();
      if (this.atmosPass) { this.camera.updateMatrixWorld(); this._updateSunScreen(); } // this frame's camera: no glow lag
      if (this.composer) this.composer.render();
      else this.renderer.render(this.scene, this.camera);
      this.frameInfo.calls = info.render.calls;
      this.frameInfo.triangles = info.render.triangles;
    },

    /** raycast from screen coords against objects */
    raycastScreen(clientX, clientY, objects, recursive = true) {
      const r = this._ray || (this._ray = new THREE.Raycaster());
      const v = this._v2 || (this._v2 = new THREE.Vector2());
      v.set((clientX / window.innerWidth) * 2 - 1, -(clientY / window.innerHeight) * 2 + 1);
      r.setFromCamera(v, this.camera);
      r.far = 400;
      return r.intersectObjects(objects, recursive);
    },
    worldToScreen(p) {
      const v = (this._v3 || (this._v3 = new THREE.Vector3())).copy(p).project(this.camera);
      return { x: (v.x * 0.5 + 0.5) * window.innerWidth, y: (-v.y * 0.5 + 0.5) * window.innerHeight, visible: v.z < 1 && v.z > -1 && Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1 };
    },
    add(o) { this.scene.add(o); return o; },
    remove(o) { this.scene.remove(o); },
    PRESETS,
    FEATURES,
  };
  G.register(engine);
})();
