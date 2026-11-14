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
//       canvasTexture returns a 1×1 transparent texture with texture.userData.blank = true when the browser gives no
//       2D context (Chrome caps live canvases): callers that draw text boards skip the mesh when `blank`.
//   G.gfx.nanScrubShader         the NaN/Inf scrub shader that runs before bloom (dev-center GPU checks)
//   G.gfx.guard                  black-region guard (CONTRACT §14.4): the user's GPU draws NaN as opaque black.
//     .watch(obj, {uniforms,     sanitation — every frame material.opacity / scale / position / quaternion and the
//        quarantine = true})     listed uniforms (true = all) of watched objects are checked; a non-finite value hides
//                                the object for that frame, resets the value and counts in guard.stats. Screen-space
//                                quads, sprites and transparent ShaderMaterials found in the scene are enrolled by
//                                themselves (~1.5 s scan); .unwatch(obj) · .check(obj) · .quarantine(on) hides the
//                                FX / quads (quarantine: false = sanitation only; scanned opaque meshes never)
//     .watchdog                  every 2 s the final frame is copied, box-filtered into 96×54 and read back; the
//                                largest pure-black (< 6) / pure-white (> 250) block ≥ 5 % of the area in 2 probes in a
//                                row is an anomaly → quarantine ladder (1 hide FX/quads · 2 composer off · 3 canvas
//                                boards off · 4 low preset), re-probing after each step; emits 'gpu:anomaly' {step,
//                                block}; .state/.step/.lastBlock/.history · .probeNow() · .reset() ("다시 켜기") ·
//                                .inject(on) (test: a full-screen black quad)
//   engine.unsupported / G.unsupported {reason, at}   set before anything else when WebGL2 is missing or the renderer
//       cannot be created; 'engine:unsupported' {reason} is emitted once (70-app shows the friendly 2D-only screen).
//       scene + camera still exist so the world modules build; renderer is null and render() draws nothing.
//   'engine:context' {lost: true|false}   the WebGL context was lost / restored (25-npc re-renders portraits).
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
  // small-scenery cull distance (m) per preset (see engine._updateCull), measured at the default 55° field of view
  const CULL_DIST = { low: 72, medium: 125, high: 210 };
  const CULL_TAN = Math.tan(THREE.MathUtils.degToRad(55) / 2);
  const _cullBox = new THREE.Box3();
  // the environment (a soft IBL fill) is re-baked when the sky look changes; a sun that only creeps along its arc
  // re-bakes once it moved this far (deg) since the last bake
  const ENV_SUN_STEP = { low: 6, medium: 3, high: 3 };
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
      // (all but) exactly black stays black: what the NaN scrub writes and an undrawn texture are not lifted (nor
      // flashed) — at dusk / night the lift would turn them into a dark grey-blue ~(0,1,8) that the screen watchdog
      // (< 6) no longer sees as the black block it is. Real dark surfaces (L > 0.002) keep the full lift.
      float liftK = smoothstep(0.0005, 0.002, L);
      c += uLift * (1.0 - smoothstep(0.0, 0.3, L)) * liftK;
      c *= mix(vec3(1.0), uGain, smoothstep(0.3, 1.8, L));
      c += vec3(0.6, 0.68, 0.92) * uFlash * (0.05 + min(L, 2.0) * 0.45) * liftK;
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
    /** 1×1 transparent texture (texture.userData.blank = true): what canvasTexture hands out when the browser gives
     *  no 2D context. Callers that draw text boards skip the mesh when `blank`. The texel is transparent WHITE: on an
     *  opaque material (terrain, paving, walls) it leaves the material colour (a transparent-black texel would turn
     *  the surface black — the very defect §14.4 removes); on transparent / additive materials it draws nothing.
     *  opts.rgba = [r, g, b, a] (0..255) picks another texel (SignAtlas: plain wood) */
    blankTexture(opts = {}) {
      const c = Array.isArray(opts.rgba) && opts.rgba.length === 4 ? opts.rgba.map((v) => Math.max(0, Math.min(255, Math.round(+v) || 0))) : [255, 255, 255, 0];
      const t = new THREE.DataTexture(new Uint8Array(c), 1, 1);
      if (opts.srgb !== false) t.colorSpace = THREE.SRGBColorSpace;
      t.userData.blank = true;
      t.needsUpdate = true;
      return t;
    },
    /** CanvasTexture from a 2D drawing function */
    canvasTexture(w, h, draw, opts = {}) {
      let c = document.createElement('canvas');
      c.width = w; c.height = h;
      const ctx = c.getContext('2d');
      if (!ctx) { G.log.warn('ENGINE', `canvasTexture ${w}×${h}: no 2D context (blank texture)`); return G.gfx.blankTexture(opts); }
      draw(ctx, w, h);
      // low preset: big drawings (≥ 1024×640) are uploaded at half size — 4× less texture memory and upload time on
      // the first frame, which is what a slow GPU feels at start-up (the drawing code keeps its full-size coordinates)
      const low = G.sys.engine?.preset?.name === 'low';
      if (low && w * h > 600000 && !opts.full) {
        try {
          const half = document.createElement('canvas');
          half.width = Math.max(1, Math.round(w / 2)); half.height = Math.max(1, Math.round(h / 2));
          const hc = half.getContext('2d');
          hc.imageSmoothingEnabled = true; hc.imageSmoothingQuality = 'high';
          hc.drawImage(c, 0, 0, half.width, half.height);
          c.width = c.height = 1;   // free the full-size backing store
          c = half;
        } catch (e) { /* keep the full-size canvas */ }
      }
      const t = new THREE.CanvasTexture(c);
      if (opts.srgb !== false) t.colorSpace = THREE.SRGBColorSpace;
      if (opts.repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(opts.repeat[0], opts.repeat[1]); }
      t.anisotropy = low ? 1 : (opts.anisotropy ?? 4);
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

  // ---------------------------------------------------------------- render guard: sanitation (CONTRACT §14.4.1)
  // The user's Windows GPU draws a NaN opacity / scale / uniform as an opaque black quad. Every frame, before the draw,
  // the watched objects (every screen-space / camera-attached quad, sprite and transparent ShaderMaterial: enrolled
  // by their owners through guard.watch, or found by the ~1.5 s scene scan) are checked for non-finite values; an
  // offender is hidden for that frame, its value reset to a safe one, and the event counted (guard.stats).
  // (`\brain`: 'rain-splashes' yes, 'terrain-core' no — the terrain is not an effect)
  const GUARD_NAME_RE = /fx-|banner|title|portal|pillar|sky-|\brain|snow|stars|moon|meteor|halo|glow|firefl|petal|mist|spray|card|marker|ghost|ribbon|prints|splash|rainbow|overlay|afterimage|lantern/i;
  // [{ obj, uniforms, q }]   uniforms: true = every uniform, string[] = these, null = none · q: ladder step 1 hides it
  const guardList = [];
  const guardSet = new WeakSet();       // watched objects
  const guardSeen = new WeakSet();      // objects the auto-enrol scan already judged
  const guardHidden = [];               // objects hidden for the frame being drawn
  const guardQuarantined = [];          // materials masked by the quarantine ladder (restored by watchdog.reset)
  let guardScanStamp = 0;
  const finV = (v) => {
    if (v == null) return true;
    if (typeof v === 'number') return Number.isFinite(v);
    if (typeof v !== 'object') return true;
    if (v.isColor) return Number.isFinite(v.r) && Number.isFinite(v.g) && Number.isFinite(v.b);
    if (v.isVector2) return Number.isFinite(v.x) && Number.isFinite(v.y);
    if (v.isVector3) return Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);
    if (v.isVector4 || v.isQuaternion) return Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z) && Number.isFinite(v.w);
    if (v.isMatrix3 || v.isMatrix4) { const e = v.elements; for (let i = 0; i < e.length; i++) if (!Number.isFinite(e[i])) return false; return true; }
    if (Array.isArray(v)) { for (let i = 0; i < v.length; i++) if (!finV(v[i])) return false; return true; }
    return true;
  };
  /** reset a non-finite uniform value in place (0 / black / identity): invisible, never a black quad */
  const safeV = (u) => {
    const v = u.value;
    if (typeof v === 'number') { u.value = 0; return; }
    if (!v || typeof v !== 'object') return;
    if (v.isColor) v.setRGB(0, 0, 0);
    else if (v.isVector2 || v.isVector3 || v.isVector4) v.set(0, 0, 0, 0);
    else if (v.isQuaternion) v.identity();
    else if (v.isMatrix3 || v.isMatrix4) v.identity();
    else if (Array.isArray(v)) for (let i = 0; i < v.length; i++) { if (typeof v[i] === 'number' && !Number.isFinite(v[i])) v[i] = 0; else if (v[i] && typeof v[i] === 'object' && !finV(v[i])) safeV({ value: v[i] }); }
  };
  /** material-level hiding for the quarantine ladder (flag = the userData key of the step, list = what to restore) */
  function maskMaterials(root, flag, list) {
    root.traverse((o) => {
      if (!(o.isMesh || o.isSprite || o.isPoints || o.isLine) || !o.material) return;
      const ms = Array.isArray(o.material) ? o.material : [o.material];
      for (let i = 0; i < ms.length; i++) { const m = ms[i]; if (m && m.visible && !m.userData[flag]) { m.userData[flag] = true; m.visible = false; list.push(m); } }
    });
  }
  function unmaskMaterials(flag, list) {
    for (let i = 0; i < list.length; i++) { const m = list[i]; if (m.userData[flag]) { delete m.userData[flag]; m.visible = true; } }
    list.length = 0;
  }
  const guard = {
    stats: { watched: 0, checked: 0, fixed: 0, hidden: 0, frames: 0, last: [] },
    /** watch obj (and, for a group, its drawable descendants). opts.uniforms: true = all uniforms, [names], default:
     *  all uniforms of ShaderMaterials, none for built-in materials (whose numeric properties are checked anyway).
     *  opts.quarantine (default true): an owner's registration is an FX / quad that ladder step 1 hides; false =
     *  sanitation only (a world object). The scene scan decides it from the material (see scan). */
    watch(obj, opts = {}) {
      if (!obj || !obj.isObject3D) return obj;
      const q = opts.quarantine !== false;
      if (!guardSet.has(obj)) {
        guardSet.add(obj);
        guardSeen.add(obj);
        const u = opts.uniforms === true || opts.uniforms === '*' ? true : Array.isArray(opts.uniforms) ? opts.uniforms.slice() : null;
        guardList.push({ obj, uniforms: u, q });
        guard.stats.watched = guardList.length;
      } else if (!opts._scan) {
        const e = guardList.find((x) => x.obj === obj);   // found by the scan first: the owner's registration decides
        if (e) e.q = q;
      }
      if (opts.deep !== false && obj.children && obj.children.length) obj.traverse((c) => { if (c !== obj && (c.isMesh || c.isSprite || c.isPoints || c.isLine)) guard.watch(c, { uniforms: opts.uniforms, deep: false, quarantine: opts.quarantine }); });
      return obj;
    },
    unwatch(obj) {
      if (!obj || !guardSet.has(obj)) return;
      guardSet.delete(obj);
      const i = guardList.findIndex((e) => e.obj === obj);
      if (i >= 0) guardList.splice(i, 1);
      guard.stats.watched = guardList.length;
    },
    /** check one object now: returns how many values were repaired (the object is hidden for this frame when > 0) */
    check(obj, uniforms) {
      const e = guardList.find((x) => x.obj === obj);
      return guardCheck(e || { obj, uniforms: uniforms === undefined ? null : uniforms }, false);
    },
    /** hide (on) / show (off) every watched FX / quad (entries with q: the owners' registrations and the transparent
     *  / sprite / point / depth-less objects the scan found; never the terrain, the sky dome or opaque props) —
     *  ladder step 1 of the screen watchdog. It masks the MATERIALS (material.visible), never obj.visible: owners keep
     *  showing / hiding their objects meanwhile, and the release (다시 켜기) cannot bring back a board or a portal its
     *  owner has put away during the quarantine */
    quarantine(on) {
      if (on) { for (const e of guardList) if (e.q) maskMaterials(e.obj, '_gq', guardQuarantined); }
      else unmaskMaterials('_gq', guardQuarantined);
      guard.quarantined = !!on;
    },
    quarantined: false,
    /** enrol the screen-space / FX objects of a scene that nobody registered (sprites, depthTest-less quads,
     *  frustumCulled-less meshes, transparent ShaderMaterials, FX-like names) */
    scan(root) {
      let n = 0;
      const stamp = ++guardScanStamp;
      root.traverse((o) => {
        o.userData._gs = stamp;   // reachable in this scan (entries left out of two scans in a row are released below)
        if (guardSeen.has(o) || !(o.isMesh || o.isSprite || o.isPoints)) return;
        guardSeen.add(o);
        const m = Array.isArray(o.material) ? o.material[0] : o.material;
        if (!m) return;
        if (o.name === 'pick-proxy' || o.name === 'blocker' || m.visible === false || o.userData.guardSkip) return;
        const fxLike = o.isSprite || m.depthTest === false || (o.frustumCulled === false && !o.isInstancedMesh) || (m.isShaderMaterial && m.transparent) || GUARD_NAME_RE.test(o.name || '');
        if (!fxLike) return;
        // checked every frame either way; hidden by ladder step 1 only when it is effect-like (an opaque mesh — the
        // terrain, the sky dome, a lantern, a lit window — is world geometry: hiding it would punch holes in the world)
        const q = !!(o.isSprite || o.isPoints || m.depthTest === false || m.transparent);
        guard.watch(o, { deep: false, quarantine: q, _scan: true });
        n++;
      });
      // release what left the scene (a visitor's name tag, a disposed board): the list never keeps dead objects alive
      for (let i = guardList.length - 1; i >= 0; i--) {
        const o = guardList[i].obj;
        if (o.userData._gs === stamp || o.userData._gs === stamp - 1) continue;
        if (o.userData._gs === undefined) { o.userData._gs = stamp - 1; continue; }   // watched before it was added: one scan of grace
        guardList.splice(i, 1); guardSet.delete(o); guardSeen.delete(o);
      }
      guard.stats.watched = guardList.length;
      return n;
    },
    /** the frame hook: check everything, hide offenders until the draw is done */
    tick() {
      guard.stats.frames++;
      for (let i = 0; i < guardList.length; i++) {
        const e = guardList[i], o = e.obj;
        if (!o.visible) continue;
        if (guardCheck(e, true)) { guardHidden.push(o); o.visible = false; }
      }
    },
    restore() {
      for (let i = 0; i < guardHidden.length; i++) guardHidden[i].visible = true;
      guardHidden.length = 0;
    },
  };
  const _gs = [];   // reusable "what" list of the current check
  function guardCheck(e, count) {
    const o = e.obj;
    let bad = 0;
    _gs.length = 0;
    if (!finV(o.position)) { o.position.set(0, -9999, 0); bad++; _gs.push('position'); }
    if (!finV(o.scale)) { o.scale.setScalar(1e-4); bad++; _gs.push('scale'); }
    if (!finV(o.quaternion)) { o.quaternion.identity(); bad++; _gs.push('quaternion'); }
    if (o.matrixAutoUpdate === false && !finV(o.matrix)) { o.matrix.identity(); bad++; _gs.push('matrix'); }
    // a non-finite PARENT transform (a group its owner moves: banner, portal, pillar) reaches the GPU through the
    // children's world matrices — check the chain up to the scene (the camera / scene themselves are never reset)
    for (let p = o.parent, d = 0; p && !p.isScene && d < 6; p = p.parent, d++) {
      if (finV(p.position) && finV(p.scale) && finV(p.quaternion) && (p.matrixAutoUpdate !== false || finV(p.matrix))) continue;
      if (!p.isCamera) {
        if (!finV(p.position)) p.position.set(0, -9999, 0);
        if (!finV(p.scale)) p.scale.setScalar(1e-4);
        if (!finV(p.quaternion)) p.quaternion.identity();
        if (p.matrixAutoUpdate === false && !finV(p.matrix)) p.matrix.identity();
      }
      bad++; _gs.push('parent:' + (p.name || p.type));
      break;
    }
    if (o.isSprite && o.material && !Number.isFinite(o.material.rotation)) { o.material.rotation = 0; bad++; _gs.push('rotation'); }
    const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : null;
    if (mats) {
      for (let k = 0; k < mats.length; k++) {
        const m = mats[k];
        if (!m) continue;
        if (!Number.isFinite(m.opacity)) { m.opacity = 0; bad++; _gs.push('opacity'); }
        if (m.color && !finV(m.color)) { m.color.setRGB(0, 0, 0); bad++; _gs.push('color'); }
        if (m.emissive && !finV(m.emissive)) { m.emissive.setRGB(0, 0, 0); bad++; _gs.push('emissive'); }
        if (m.emissiveIntensity !== undefined && !Number.isFinite(m.emissiveIntensity)) { m.emissiveIntensity = 0; bad++; _gs.push('emissiveIntensity'); }
        const U = m.uniforms;
        if (U) {
          const want = e.uniforms === true || (e.uniforms == null && m.isShaderMaterial) ? null : e.uniforms;
          if (want === null) { for (const key in U) { const u = U[key]; if (u && !finV(u.value)) { safeV(u); bad++; _gs.push('uniform:' + key); } } }
          else if (Array.isArray(want)) for (let j = 0; j < want.length; j++) { const u = U[want[j]]; if (u && !finV(u.value)) { safeV(u); bad++; _gs.push('uniform:' + want[j]); } }
        }
      }
    }
    if (count) {
      guard.stats.checked++;
      if (bad) {
        guard.stats.fixed += bad; guard.stats.hidden++;
        const L = guard.stats.last;
        L.push({ obj: o.name || o.type, what: _gs.join(','), frame: guard.stats.frames, at: Date.now() });
        if (L.length > 12) L.shift();
        if (!o.userData._gWarned) { o.userData._gWarned = true; G.log.warn('ENGINE', `guard: non-finite ${_gs.join(',')} on "${o.name || o.type}" — hidden for the frame and reset`); }
      }
    }
    return bad;
  }
  G.gfx.guard = guard;

  // ---------------------------------------------------------------- render guard: screen watchdog (CONTRACT §14.4.2)
  // Every 2 s the frame that was just shown is copied off the canvas (GPU copy), box-filtered into 96×54 and read
  // back. The largest axis-aligned block of pure black (every channel < 6) or pure white (> 250) that covers ≥ 5 % of
  // the area in two probes in a row is an anomaly → quarantine ladder, re-probing after every step:
  //   1 hide every registered FX / quad (guard.quarantine + G.fx.quarantine) · 2 composer off (plain render) ·
  //   3 canvas-texture boards off · 4 low preset.  'gpu:anomaly' {step, block} per step; the child sees no toast;
  //   the developer center shows the state and offers 다시 켜기 (watchdog.reset()).
  const WD_W = 96, WD_H = 54;
  const WD_DOWN_FRAG = `
    uniform sampler2D tDiffuse; uniform vec2 uCell; varying vec2 vUv;
    void main() {
      vec3 s = vec3(0.0);
      for (int i = 0; i < 4; i++) for (int j = 0; j < 4; j++) {
        vec2 o = ((vec2(float(i), float(j)) + 0.5) / 4.0 - 0.5) * uCell;
        s += texture2D(tDiffuse, vUv + o).rgb;
      }
      gl_FragColor = vec4(s / 16.0, 1.0);
    }`;
  /** largest all-true axis-aligned rectangle in a W×H boolean grid (histogram + stack, O(W·H)) */
  function largestBlock(mask, W, H) {
    const hgt = new Int32Array(W), stack = new Int32Array(W + 1);
    let best = { area: 0, x: 0, y: 0, w: 0, h: 0 };
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) hgt[x] = mask[y * W + x] ? hgt[x] + 1 : 0;
      let top = 0;
      for (let x = 0; x <= W; x++) {
        const cur = x < W ? hgt[x] : 0;
        while (top > 0 && hgt[stack[top - 1]] >= cur) {
          const h = hgt[stack[--top]];
          const left = top > 0 ? stack[top - 1] + 1 : 0;
          const w = x - left;
          if (h * w > best.area) best = { area: h * w, x: left, y: y - h + 1, w, h };
        }
        stack[top++] = x;
      }
    }
    return best;
  }
  const watchdog = {
    W: WD_W, H: WD_H,
    interval: 2000, minArea: 0.05, blackMax: 6, whiteMin: 250,
    enabled: true,
    state: 'idle',          // idle (not in a game) · watching · suspect (1 anomalous probe) · quarantine (ladder step ≥ 1)
    step: 0,                // ladder step 0..4
    probes: 0, anomalies: 0, suspect: 0,
    lastBlock: null, last: null, history: [],
    nextAt: 0, holdUntil: 0,
    _rt: null, _tex: null, _mat: null, _quad: null, _buf: null, _inject: null, _boards: null, _prevQuality: null,
    composerOff: false,
    /** probes are skipped for `ms` (after login, a quality change, a resize, a hidden tab: transient frames) */
    hold(ms = 3000) { watchdog.holdUntil = Math.max(watchdog.holdUntil, performance.now() + ms); },
    /** is a probe due on this frame? */
    due(now) {
      if (!watchdog.enabled || !G.ready || !G.state || document.hidden) return false;
      if (now < watchdog.holdUntil || now < watchdog.nextAt) return false;
      return true;
    },
    /** copy + downsample + read the frame that was just drawn (call right after the final render of a frame) */
    probeNow() {
      const E = engine, r = E.renderer;
      if (!r || E._isLost()) return null;
      const now = performance.now();
      watchdog.nextAt = now + watchdog.interval;
      try {
        E.render({ force: true, probe: true });   // a fresh frame on the canvas, then the probe below (render calls _probeFrame)
      } catch (e) { G.log.warn('ENGINE', 'watchdog probe failed', e); return null; }
      return watchdog.last;
    },
    /** test helper: an opaque black quad drawn over the scene (on) / removed (off). opts (screen fractions):
     *  {w = 1, h = 1, cx = 0.5 (centre x), top = 0 (top edge, from the top)} — e.g. {w: 0.45, h: 0.56} is the block of
     *  the user's screenshot (top-centre). opts.fx = true makes it an FX quad the guard watches (ladder step 1 then
     *  hides it); by default the guard leaves it alone, like a defect no FX switch can reach. */
    inject(on, opts = {}) {
      const E = engine;
      if (!E.scene || !E.camera) return;
      if (on && watchdog._inject) watchdog.inject(false);
      if (on) {
        const fr = (v, d) => (Number.isFinite(+v) ? Math.max(0, Math.min(1, +v)) : d);
        const w = fr(opts.w, 1), h = fr(opts.h, 1), cx = fr(opts.cx, 0.5), top = fr(opts.top, 0);
        // clip-space rectangle (NDC): covers that part of the screen whatever the camera does
        const x0 = (cx - w / 2) * 2 - 1, x1 = (cx + w / 2) * 2 - 1, y1 = 1 - top * 2, y0 = 1 - (top + h) * 2;
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute([x0, y0, 0, x1, y0, 0, x1, y1, 0, x0, y0, 0, x1, y1, 0, x0, y1, 0], 3));
        const mat = new THREE.ShaderMaterial({
          name: 'WatchdogInject', vertexShader: 'void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }',
          fragmentShader: 'void main() { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); }', depthTest: false, depthWrite: false, toneMapped: false,
          // drawn in the transparent pass, after everything (renderOrder below): a solid block like a NaN quad's —
          // an opaque-pass quad would get rain streaks, sprites and FX painted over it
          transparent: true,
        });
        const m = new THREE.Mesh(g, mat);
        m.name = 'watchdog-inject'; m.frustumCulled = false; m.renderOrder = 100000; m.raycast = () => {};
        m.userData.noOutline = true;
        if (opts.fx) guard.watch(m); else m.userData.guardSkip = true;
        E.scene.add(m);
        watchdog._inject = m;
      } else if (!on && watchdog._inject) {
        guard.unwatch(watchdog._inject);
        E.scene.remove(watchdog._inject);
        watchdog._inject.geometry.dispose(); watchdog._inject.material.dispose();
        watchdog._inject = null;
      }
    },
    /** 다시 켜기: undo every ladder step, start watching again */
    reset() {
      const E = engine;
      if (watchdog.step >= 1) { guard.quarantine(false); try { G.fx?.quarantine?.(false); } catch (e) { /* fx optional */ } }
      if (watchdog.composerOff) { watchdog.composerOff = false; if (E.renderer) E._setupComposer(); }
      if (watchdog._boards) { unmaskMaterials('_gqb', watchdog._boards); watchdog._boards = null; }
      if (watchdog._prevQuality) { const q = watchdog._prevQuality; watchdog._prevQuality = null; if (E.renderer && E.quality !== q) E.setQuality(q); }
      watchdog.step = 0; watchdog.suspect = 0; watchdog.lastBlock = null;
      watchdog.state = G.ready && G.state ? 'watching' : 'idle';
      watchdog.hold(1500);
      watchdog.nextAt = 0;
      G.bus.emit('gpu:anomaly', { step: 0, block: null, reset: true });
    },
    _escalate(block) {
      const E = engine;
      if (watchdog.step >= 4) return;
      watchdog.step++;
      watchdog.state = 'quarantine';
      watchdog.anomalies++;
      switch (watchdog.step) {
        case 1: guard.quarantine(true); try { G.fx?.quarantine?.(true); } catch (e) { /* fx optional */ } break;
        case 2: watchdog.composerOff = true; E._setupComposer(); break;
        case 3: {
          // canvas-texture boards (signs, banners, cards, labels, sprites): their materials are masked (see guard.quarantine)
          const list = [];
          E.scene.traverse((o) => {
            if (!(o.isMesh || o.isSprite) || !o.visible) return;
            const m = Array.isArray(o.material) ? o.material[0] : o.material;
            if (!m || !m.map || !(m.map.isCanvasTexture || m.map.userData?.blank)) return;
            if (o.isSprite || (o.geometry && o.geometry.type === 'PlaneGeometry') || /board|sign|banner|card|title|label|hyeonpan|marker/i.test(o.name || '')) maskMaterials(o, '_gqb', list);
          });
          watchdog._boards = list;
          break;
        }
        case 4: if (E.quality !== 'low') { watchdog._prevQuality = E.quality; E.setQuality('low'); } break;
      }
      const rec = { step: watchdog.step, block, at: Date.now() };
      watchdog.history.push(rec);
      if (watchdog.history.length > 20) watchdog.history.shift();
      G.log.warn('ENGINE', `gpu:anomaly step ${watchdog.step} — ${block.kind} block ${block.w}×${block.h} cells (${(block.frac * 100).toFixed(0)} %) at ${block.x},${block.y}`);
      G.bus.emit('gpu:anomaly', { step: watchdog.step, block });
      watchdog.hold(1200);   // the next probe sees the frame after this step took effect
    },
    /** the 96×54 target, the downsample quad and the read-back buffer (lazy; dropped on a context restore) */
    _ensure() {
      if (watchdog._rt) return;
      watchdog._rt = new THREE.WebGLRenderTarget(WD_W, WD_H, { depthBuffer: false, stencilBuffer: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
      watchdog._mat = new THREE.ShaderMaterial({ name: 'WatchdogDownsample', uniforms: { tDiffuse: { value: null }, uCell: { value: new THREE.Vector2(1 / WD_W, 1 / WD_H) } }, vertexShader: FS_VERT, fragmentShader: WD_DOWN_FRAG, depthTest: false, depthWrite: false, toneMapped: false });
      watchdog._quad = new THREE.Mesh(fsGeometry(), watchdog._mat);
      watchdog._quad.frustumCulled = false;
      watchdog._buf = new Uint8Array(WD_W * WD_H * 4);
    },
    /** analyse one 96×54 RGBA read-back */
    _analyse(buf) {
      const W = WD_W, H = WD_H, n = W * H;
      const black = new Uint8Array(n), white = new Uint8Array(n);
      let nb = 0, nw = 0;
      const bm = watchdog.blackMax, wm = watchdog.whiteMin;
      for (let i = 0; i < n; i++) {
        const r = buf[i * 4], g = buf[i * 4 + 1], b = buf[i * 4 + 2];
        if (r < bm && g < bm && b < bm) { black[i] = 1; nb++; }
        else if (r > wm && g > wm && b > wm) { white[i] = 1; nw++; }
      }
      const minCells = Math.ceil(n * watchdog.minArea);
      const bb = nb >= minCells ? largestBlock(black, W, H) : { area: 0 };
      const wb = nw >= minCells ? largestBlock(white, W, H) : { area: 0 };
      const pick = bb.area >= wb.area ? { kind: 'black', ...bb } : { kind: 'white', ...wb };
      pick.frac = pick.area / n;
      const res = { at: Date.now(), black: nb / n, white: nw / n, blockBlack: bb.area ? { ...bb, frac: bb.area / n } : null, blockWhite: wb.area ? { ...wb, frac: wb.area / n } : null, block: pick.area ? pick : null, anomaly: pick.area >= minCells };
      watchdog.last = res;
      watchdog.probes++;
      return res;
    },
    /** the frame hook: runs right after the final draw of a frame that was due (or forced by probeNow) */
    _probeFrame() {
      const E = engine, r = E.renderer, gl = r.getContext();
      const size = r.getDrawingBufferSize(_wdV2);
      if (!(size.x > 0 && size.y > 0)) return null;
      watchdog._ensure();
      if (!watchdog._tex || watchdog._tex.image.width !== size.x || watchdog._tex.image.height !== size.y) {
        watchdog._tex?.dispose();
        watchdog._tex = new THREE.FramebufferTexture(size.x, size.y);
        watchdog._tex.colorSpace = THREE.NoColorSpace;
      }
      const prevRT = r.getRenderTarget();
      try {
        r.setRenderTarget(null);
        r.copyFramebufferToTexture(watchdog._tex);
        watchdog._mat.uniforms.tDiffuse.value = watchdog._tex;
        r.setRenderTarget(watchdog._rt);
        r.render(watchdog._quad, fsCam);
        // three's readRenderTargetPixelsAsync (NPC portraits) keeps a PIXEL_PACK_BUFFER bound while it waits; a sync
        // read with it bound returns zeros (= a "black" screen): unbind for the read, rebind afterwards
        const gl2 = typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext;
        const pack = gl2 ? gl.getParameter(gl.PIXEL_PACK_BUFFER_BINDING) : null;
        if (pack) gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
        try { r.readRenderTargetPixels(watchdog._rt, 0, 0, WD_W, WD_H, watchdog._buf); } finally { if (pack) gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pack); }
      } finally { r.setRenderTarget(prevRT); }
      const res = watchdog._analyse(watchdog._buf);
      if (res.anomaly) {
        watchdog.lastBlock = res.block;
        watchdog.suspect++;
        if (watchdog.step >= 1 || watchdog.suspect >= 2) watchdog._escalate(res.block);
        else watchdog.state = 'suspect';
      } else {
        watchdog.suspect = 0;
        if (watchdog.step === 0) watchdog.state = 'watching';
      }
      return res;
    },
  };
  const _wdV2 = new THREE.Vector2();
  guard.watchdog = watchdog;

  // ---------------------------------------------------------------- grade state
  const GRADE_KEYS = ['exposure', 'contrast', 'saturation', 'warmth', 'vignette', 'flash'];
  const GRADE_NEUTRAL = { exposure: 0.92, contrast: 1, saturation: 1, warmth: 0, vignette: 0.22, flash: 0 };
  const GRADE_LIMITS = { exposure: [0.2, 2.5], contrast: [0.7, 1.4], saturation: [0, 1.8], warmth: [-1, 1], vignette: [0, 0.8], flash: [0, 1] };
  const _lift = new THREE.Color(0, 0, 0), _gain = new THREE.Color(1, 1, 1), _liftGoal = new THREE.Color(0, 0, 0), _gainGoal = new THREE.Color(1, 1, 1);
  const _sunV = new THREE.Vector3(), _camFwd = new THREE.Vector3(), _sunCol = new THREE.Color();
  const _indoorGrade = { exposure: 1, warmth: 0, saturation: 1 };   // [places-kit] the 'interior' grade layer (reused)

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
      // §14.4.3: three r170 needs WebGL2. Probe first; a renderer that still throws is the same case. Either way the
      // scene and camera are built so the world modules initialise, nothing is drawn, and 70-app shows the friendly
      // 2D-only screen on 'engine:unsupported' — never a black dead world with the HUD over it.
      let renderer = null, reason = this._probeWebGL2();
      if (!reason) {
        try {
          renderer = new THREE.WebGLRenderer({
            // MSAA happens in the composer target when post-processing is on (medium/high); the low preset stays direct
            antialias: this.preset.antialias && !this._wantsComposer(this.preset),
            powerPreference: 'high-performance',
            preserveDrawingBuffer: false,
            alpha: false,
          });
        } catch (e) { renderer = null; reason = 'renderer: ' + String((e && e.message) || e).slice(0, 160); }
      }
      if (!renderer) { this._initUnsupported(container, reason); return; }
      renderer.setPixelRatio(this._pixelRatio());
      renderer.setSize(window.innerWidth, window.innerHeight);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 0.88;
      renderer.shadowMap.enabled = !!this.preset.shadows && G.settings.shadows !== false;
      renderer.shadowMap.type = this.quality === 'high' ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
      renderer.info.autoReset = false; // one reset per frame in render(): composer frames count every pass
      renderer.domElement.setAttribute('tabindex', '0');
      renderer.domElement.addEventListener('webglcontextlost', (e) => { e.preventDefault(); this._lost = true; G.ui?.toast?.('그래픽 장치가 잠깐 쉬고 있어요. 계속 멈춰 있으면 새로고침해 주세요.', { type: 'warn', duration: 6000 }); G.bus.emit('engine:context', { lost: true }); });
      renderer.domElement.addEventListener('webglcontextrestored', () => {
        // the environment bake targets belong to the lost context: drop them without dispose() (that would delete
        // objects of the old context on the new one) and re-bake; the watchdog's copy texture / target too
        this._lost = false; this._envRT = null; this._envCam = null; this._envDir = null; this._envDirty = true; this._envTimer = 0;
        watchdog._tex = null; watchdog._rt = null; watchdog._mat = null; watchdog._quad = null; watchdog.hold(3000);
        G.log.info('ENGINE', 'WebGL context restored');
        G.bus.emit('engine:context', { lost: false });
      });
      container.appendChild(renderer.domElement);
      this.renderer = renderer;

      this._initScene();
      const scene = this.scene, camera = this.camera;

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

      this._initLights(renderer.shadowMap.enabled);

      this._setupComposer();
      this.setSun(this.sunElevation, this.sunAzimuth);

      window.addEventListener('resize', () => this.resize());
      this._watchPixelRatio();
      G.bus.on('settings:changed', ({ key }) => {
        if (key === 'quality') this.setQuality(G.settings.quality);
        if (key === 'shadows') this.setShadows(G.settings.shadows);
        if (key === 'bloom') this._setupComposer();
        if (key === 'showFps') { const el = document.getElementById('fps-meter'); if (el) el.hidden = !G.settings.showFps; }
        if (key === 'reduceMotion' || key === 'fxLevel') G.bus.emit('engine:features', { quality: this.quality });
      });
      const fm = document.getElementById('fps-meter');
      if (fm) fm.hidden = !G.settings.showFps;
      // the screen watchdog waits out transient frames: a login, a tab coming back, the first frames after boot
      G.bus.on('state:loaded', () => { watchdog.hold(4000); watchdog.state = 'watching'; });
      // login builds meshes after the boot precompile (crops: instanced + instanceColor, and their shadow-depth
      // variant): link their programs now, synchronously inside applyState, while the loading screen is still up
      // — not on the first view of the farm (R3-render-3)
      G.bus.on('state:loaded', () => { try { this._loginWarm(); } catch (e) { G.log.warn('ENGINE', 'login warm-up failed', e?.message || e); } });
      G.bus.on('game:ready', () => watchdog.hold(4000));
      document.addEventListener('visibilitychange', () => { if (!document.hidden) watchdog.hold(2500); });
      watchdog.hold(4000);
      G.log.info('ENGINE', `three r${THREE.REVISION}, quality=${this.quality}, post=${this.composer ? this.composer.passes.length + ' passes' : 'direct'}`);
    },

    /** null when a WebGL2 context can be made, otherwise the reason ('no-webgl2' | 'no-webgl' | 'webgl1-only') */
    _probeWebGL2() {
      try {
        if (typeof WebGL2RenderingContext === 'undefined') return typeof WebGLRenderingContext === 'undefined' ? 'no-webgl' : 'webgl1-only';
        const c = document.createElement('canvas');
        const gl = c.getContext('webgl2', { failIfMajorPerformanceCaveat: false });
        if (!gl) return c.getContext('webgl') ? 'webgl1-only' : 'no-webgl2';
        try { gl.getExtension('WEBGL_lose_context')?.loseContext(); } catch (e) { /* probe context: let it go */ }
        return null;
      } catch (e) { return 'probe: ' + String((e && e.message) || e).slice(0, 120); }
    },
    /** scene + camera (shared by the normal and the unsupported path: world modules build into it either way) */
    _initScene() {
      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0x9cc7ea);
      scene.fog = new THREE.FogExp2(0xbcd6e8, 0.0028);
      this.scene = scene;
      const camera = new THREE.PerspectiveCamera(55, window.innerWidth / Math.max(1, window.innerHeight), 0.1, 3000);
      camera.position.set(0, 12, 30);
      camera.lookAt(0, 0, 0);
      scene.add(camera); // allows camera-attached children (rain emitters, flare anchor)
      this.camera = camera;
    },
    _initLights(shadows) {
      const scene = this.scene;
      const hemi = new THREE.HemisphereLight(0xcfe3ff, 0x5c6b3c, 0.85);
      scene.add(hemi);
      this.hemi = hemi;
      const sun = new THREE.DirectionalLight(0xfff0d8, 2.6);
      sun.castShadow = !!shadows;
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
    },
    /** no WebGL2 / renderer failure: a drawless engine. World modules still get a scene and a camera; render() is a
     *  no-op; the flag + event let 70-app show '이 기기에서는 3D를 열 수 없어요' with the 2D-only mode. */
    _initUnsupported(container, reason) {
      this.renderer = null; this.composer = null; this.bloomPass = null; this.atmosPass = null;
      this.unsupported = reason;
      G.unsupported = { reason, at: Date.now() };
      this._initScene();
      this._initLights(false);
      this.setSun(this.sunElevation, this.sunAzimuth);
      if (container) container.classList.add('no-3d');
      watchdog.enabled = false; watchdog.state = 'idle';
      window.addEventListener('resize', () => this.resize());
      G.log.warn('ENGINE', `3D unavailable (${reason}): running without a renderer`);
      G.bus.emit('engine:unsupported', { reason });
    },

    _wantsComposer(p = this.preset) {
      if (watchdog.composerOff) return false;   // quarantine ladder step 2: plain render
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
      if (!this.renderer || !this._wantsComposer()) { G.bus.emit('engine:features', { quality: this.quality }); return; }
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
      if (!this.renderer) return;
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
      if (!this.renderer) { G.bus.emit('engine:quality', { quality: name, preset: this.preset, reloadSuggested: false }); return; }
      this.renderer.setPixelRatio(this._pixelRatio());
      this.renderer.shadowMap.type = name === 'high' ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
      this.setShadows(G.settings.shadows !== false);
      this._setupComposer();
      this.resize();
      watchdog.hold(3000);
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
      // the environment re-bakes when the sky look changed (opts.env: weather transitions, time jumps) or once the sun
      // crept a few degrees since the last bake — not on every small step of its arc (each bake renders the sky cube
      // and the PMREM blur passes)
      const step = THREE.MathUtils.degToRad(ENV_SUN_STEP[this.preset?.name] ?? 3);
      if (opts.env || !this._envDir || this._envDir.angleTo(this.sunDir) > step) this._envDirty = true;
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
      if (!this._pmrem || !this._envSky || this._isLost()) return;
      if (this._indoor && this._indoor.env && this._indoorGoal) { if (this._indoorEnvDirty) this._indoorBake(); this._envDirty = false; return; }   // [places-kit] inside a room: its own bake
      if (!force && !this._envDirty) return;
      const su = this.sky.material.uniforms, eu = this._envSky.material.uniforms;
      for (const k of ['turbidity', 'rayleigh', 'mieCoefficient', 'mieDirectionalG']) eu[k].value = su[k].value;
      eu.sunPosition.value.copy(this.sunDir);
      // sky cube -> PMREM, both into targets kept for the whole session: scene.environment stays the same texture
      // object, so lit materials keep their programs (pmrem.fromScene allocated a new target per bake, and the new
      // texture made every lit material re-check its program on the next frame)
      if (!this._envCam) this._envCam = new THREE.CubeCamera(0.1, 1100, new THREE.WebGLCubeRenderTarget(256, { type: THREE.HalfFloatType }));
      this._envCam.update(this.renderer, this._envScene);
      this._envRT = this._pmrem.fromCubemap(this._envCam.renderTarget.texture, this._envRT);
      this.scene.environment = this._envRT.texture;
      this.scene.environmentIntensity = this.envIntensity ?? 0.5; // baked sky ~= sun; keep IBL as a soft fill
      (this._envDir || (this._envDir = new THREE.Vector3())).copy(this.sunDir);
      this._envDirty = false;
    },
    /** behind the loading screen (core runs postInit before the loader hides): every system has built its scene */
    async postInit() { await this.precompile(); this._markWarm(); },

    /** remember every shadow caster that exists now: the login warm-up draws only casters added after this */
    _markWarm() {
      const seen = this._warmSeen || (this._warmSeen = new WeakSet());
      this.scene?.traverse((o) => { if (o.castShadow) seen.add(o); });
    },
    /** state:loaded: compile what the login added (already-linked programs are reused) and warm the shadow-depth
     *  programs of the new shadow casters, which renderer.compile() never prepares (R3-render-3) */
    _loginWarm() {
      const r = this.renderer;
      if (!r || !this.scene || !this.camera || this._isLost()) return;
      const t0 = performance.now(), n0 = r.info.programs?.length || 0;
      this.precompile();   // issued now; its async tail only waits for a parallel compile
      // the screen watchdog's own downsample program (its first probe comes ~4 s after login)
      if (watchdog.enabled) {
        const prev = r.getRenderTarget();
        try { watchdog._ensure(); r.setRenderTarget(watchdog._rt); r.compile(watchdog._quad, fsCam); } catch (e) { /* compiled on the first probe instead */ } finally { r.setRenderTarget(prev); }
      }
      let warmed = 0;
      if (r.shadowMap.enabled && this.sun?.castShadow) {
        const seen = this._warmSeen || (this._warmSeen = new WeakSet());
        const fresh = [];
        this.scene.traverse((o) => { if (o.castShadow && (o.isMesh || o.isPoints || o.isLine) && !seen.has(o)) { seen.add(o); fresh.push(o); } });
        if (fresh.length) warmed = this._shadowWarm(fresh);
      }
      G.log.info('ENGINE', `login warm-up: ${(r.info.programs?.length || 0) - n0} programs linked, ${warmed} new shadow casters drawn, ${Math.round(performance.now() - t0)} ms`);
    },
    /** draw only `list` once (frustum culling off for them, every other drawable hidden) into a 4×4 target, so the
     *  shadow pass links their depth programs; the main pass uses the frame's target kind (composer target or canvas) */
    _shadowWarm(list) {
      const r = this.renderer, scene = this.scene, cam = this.camera;
      const keep = new Set();
      for (const o of list) { let p = o; while (p && !keep.has(p)) { keep.add(p); p = p.parent; } }
      const hidden = [], culled = [];
      scene.traverse((o) => { if (o.visible && !keep.has(o) && (o.isMesh || o.isPoints || o.isLine || o.isSprite)) { o.visible = false; hidden.push(o); } });
      for (const o of list) if (o.frustumCulled) { o.frustumCulled = false; culled.push(o); }
      const prevRT = r.getRenderTarget();
      let rt = null;
      try {
        if (this.composer) {
          rt = new THREE.WebGLRenderTarget(4, 4);   // a render target = the RenderPass program variant (linear, no tone mapping)
          r.setRenderTarget(rt);
          r.render(scene, cam);
        } else {
          // canvas variant: a 4×4 corner of the canvas, behind the loading screen (the next frame redraws everything)
          const vp = r.getViewport(new THREE.Vector4()), sc = r.getScissor(new THREE.Vector4()), st = r.getScissorTest();
          r.setRenderTarget(null);
          r.setViewport(0, 0, 4, 4); r.setScissor(0, 0, 4, 4); r.setScissorTest(true);
          try { r.render(scene, cam); } finally { r.setViewport(vp); r.setScissor(sc); r.setScissorTest(st); }
        }
      } finally {
        r.setRenderTarget(prevRT);
        if (rt) rt.dispose();
        for (const o of culled) o.frustumCulled = true;
        for (const o of hidden) o.visible = true;
      }
      return list.length;
    },

    /**
     * compile the shader program of every material in the scene, hidden ones included (rain, snow, puddles, night
     * glows, fireflies…) and the outline glow, so the first rain, night or hover does not freeze the game while the
     * driver links programs. With KHR_parallel_shader_compile the wait does not block the page (capped at maxWait).
     * The programs match the frame's: environment baked first, and on post-processing presets compiled for a render
     * target (linear output, tone mapping in the output pass) like the RenderPass draws.
     */
    async precompile(maxWait = 12000) {
      const r = this.renderer, scene = this.scene;
      if (!r || !scene || !this.camera || this._isLost()) return 0;
      const t0 = performance.now();
      if (this._envDirty) this.updateEnvironment(true);
      const warm = this._outlineWarmers();
      const prev = r.getRenderTarget();
      let job = null;
      scene.add(warm);
      try {
        r.setRenderTarget(this.composer ? this.composer.readBuffer : null);
        // compiles now; with the extension the promise waits for the driver to finish (compileAsync would also warn
        // in the console when it is missing — the plain compile hands the same work to the driver)
        if (r.extensions?.has?.('KHR_parallel_shader_compile')) job = r.compileAsync(scene, this.camera);
        else r.compile(scene, this.camera);
      } catch (e) { G.log.warn('ENGINE', 'shader precompile failed', e); }
      finally {
        r.setRenderTarget(prev);
        scene.remove(warm);
        warm.children[0].geometry.dispose();
      }
      if (job) await Promise.race([job, new Promise((res) => setTimeout(res, maxWait))]);
      const n = r.info.programs?.length || 0;
      G.log.info('ENGINE', `precompiled ${n} shader programs in ${Math.round(performance.now() - t0)} ms`);
      return n;
    },
    /** stand-ins carrying the outline glow material in each variant it is drawn with (plain, instanced, skinned) */
    _outlineWarmers() {
      const mat = this._outlineMaterial(), g = new THREE.BoxGeometry(0.1, 0.1, 0.1), n = g.attributes.position.count;
      g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Uint16Array(n * 4), 4));
      g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(new Float32Array(n * 4).fill(0.25), 4));
      const bone = new THREE.Bone(), skinned = new THREE.SkinnedMesh(g, mat);
      skinned.add(bone);
      skinned.bind(new THREE.Skeleton([bone]));
      const grp = new THREE.Group();
      grp.name = 'outline-warm';
      grp.add(new THREE.Mesh(g, mat), new THREE.InstancedMesh(g, mat, 1), skinned);
      return grp;
    },

    /** the GL context is gone (the 'webglcontextlost' event arrives asynchronously, after the loss itself) */
    _isLost() {
      if (this._lost) return true;
      if (!this.renderer) return false;
      try { return !!this.renderer.getContext?.()?.isContextLost?.(); } catch (e) { return true; }
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
      // one material for the whole session (its programs stay linked): a new one per hovered thing re-linked 2-3
      // programs on every focus change — a visible hitch on weak GPUs while just walking past signs and jars
      const mat = this._outlineMaterial();
      // HDR on bloom presets so the rim softly blooms; LDR otherwise
      try { mat.uniforms.uColor.value.set(color); } catch (e) { mat.uniforms.uColor.value.set(0xffd36a); }
      mat.uniforms.uColor.value.multiplyScalar(this.bloomPass ? 1.6 : 1.0);
      mat.uniforms.uAlpha.value = 0;
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
      this._outline = null;   // the shared material stays (see _outlineMaterial)
    },
    _outlineMaterial() {
      return this._outlineMat || (this._outlineMat = new THREE.ShaderMaterial({
        name: 'OutlineGlow',
        uniforms: { uColor: { value: new THREE.Color(0xffd36a) }, uAlpha: { value: 0 }, uPx: { value: 0.001 }, uWidth: { value: 3.2 } },
        vertexShader: OUTLINE_VERT, fragmentShader: OUTLINE_FRAG,
        side: THREE.BackSide, transparent: true, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending, toneMapped: false, fog: false,
      }));
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

    /** renderer pixel ratio: the device's (it follows browser zoom and moves between screens), capped by the preset */
    _pixelRatio() {
      const dpr = Number(window.devicePixelRatio);
      return Math.min(dpr > 0 && Number.isFinite(dpr) ? dpr : 1, this.preset.pixelRatio);
    },
    /** a devicePixelRatio change alone (browser zoom, a window dragged to another screen) fires no 'resize' event */
    _watchPixelRatio() {
      if (typeof window.matchMedia !== 'function') return;
      let mq;
      try { mq = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`); } catch (e) { return; }
      const changed = () => { this.resize(); this._watchPixelRatio(); };   // re-arm for the new ratio
      if (mq.addEventListener) mq.addEventListener('change', changed, { once: true });
      else if (mq.addListener) { const once = () => { mq.removeListener(once); changed(); }; mq.addListener(once); }
    },
    resize() {
      const w = window.innerWidth, h = Math.max(1, window.innerHeight);
      const pr = this._pixelRatio();
      if (this.camera) { this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); }
      if (!this.renderer) return;
      if (pr !== this.renderer.getPixelRatio()) this.renderer.setPixelRatio(pr);
      this.renderer.setSize(w, h);
      if (this.composer) { this.composer.setPixelRatio(pr); this.composer.setSize(w, h); }
      if (this.bloomPass) this.bloomPass.resolution.set(w / 2, h / 2);
      watchdog.hold(2000);
      for (const fn of this._resizeFns) { try { fn(w, h, pr); } catch (e) { G.log.error('ENGINE', e); } }
    },
    /** fn(cssWidth, cssHeight, pixelRatio) after every resize / pixel-ratio / quality change */
    onResize(fn) { if (typeof fn === 'function') this._resizeFns.push(fn); },

    /**
     * distance cull for small scenery: the 정선 만장대 start view frames the whole valley, and every small prop
     * (lantern, bench, sign, barrel…) far below is one more draw call. The small-prop batches of the props group
     * (`props-detail-*`: one merged batch per 44 m cell, culled when the whole cell is beyond the limit), its other small
     * direct children and the jar groups (bounding radius ≤ 3.2 m) farther than CULL_DIST (by preset, scaled by the
     * camera zoom: the telescope magnifies far scenery) leave the render layer — `visible` is not touched, so the owning
     * modules keep full control of it. Buildings, trees, terrain, instanced sets and the big merged surfaces
     * (`props-cell-*`: plazas, walls, plots) stay; invisible pick proxies are never enrolled.
     */
    _updateCull(dt) {
      const C = this._cull || (this._cull = { t: 0, items: [], key: '', off: 0 });
      C.t -= dt;
      if (C.t > 0 || !this.scene || !this.camera || !G.ready) return;
      C.t = 0.25;
      const groups = this.scene.children.filter((c) => c && (c.name === 'props' || /^jar:/.test(c.name)));
      const key = groups.map((g) => g.name + ':' + g.children.length).join('|');
      if (key !== C.key) { this._buildCull(groups); C.key = key; }
      const fov = THREE.MathUtils.degToRad(clamp(fin(this.camera.fov, 55), 1, 120));
      const lim = (CULL_DIST[this.preset?.name] ?? Infinity) * Math.max(1, CULL_TAN / Math.tan(fov / 2));
      const cp = this.camera.position;
      let off = 0;
      for (const it of C.items) {
        const dx = it.x - cp.x, dy = it.y - cp.y, dz = it.z - cp.z;
        const far = Math.sqrt(dx * dx + dy * dy + dz * dz) - it.r > lim;
        if (far !== it.off) {
          it.off = far;
          for (const m of it.meshes) { if (far) { m.userData._cullMask = m.layers.mask; m.layers.mask = 0; } else if (m.userData._cullMask != null) { m.layers.mask = m.userData._cullMask; delete m.userData._cullMask; } }
        }
        if (far) off++;
      }
      C.off = off;
    },
    _buildCull(groups) {
      const C = this._cull;
      for (const it of C.items || []) for (const m of it.meshes) if (m.userData._cullMask != null) { m.layers.mask = m.userData._cullMask; delete m.userData._cullMask; }
      const items = [];
      const box = new THREE.Box3(), sph = new THREE.Sphere();
      const shown = (m) => !!m && m.visible !== false;
      const add = (obj, rMax = 3.2) => {
        obj.updateWorldMatrix(true, true);
        box.makeEmpty();
        const meshes = [];
        obj.traverse((o) => {
          if (!(o.isMesh || o.isPoints || o.isLine || o.isSprite) || o.isInstancedMesh || o.isSkinnedMesh) return;
          if (!o.geometry) return;
          // pick proxies / camera blockers never draw: culling them saves nothing
          if (!(Array.isArray(o.material) ? o.material.some(shown) : shown(o.material))) return;
          if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
          const bb = o.geometry.boundingBox;
          if (!bb || bb.isEmpty()) return;
          box.union(_cullBox.copy(bb).applyMatrix4(o.matrixWorld));
          meshes.push(o);
        });
        if (!meshes.length || box.isEmpty()) return;
        box.getBoundingSphere(sph);
        if (!(sph.radius > 0) || sph.radius > rMax || !Number.isFinite(sph.center.x)) return;
        items.push({ x: sph.center.x, y: sph.center.y, z: sph.center.z, r: sph.radius, meshes, off: false });
      };
      for (const g of groups) {
        if (/^jar:/.test(g.name)) { add(g); continue; }
        for (const c of g.children) {
          // a merged small-prop batch is culled as a whole once its nearest point is beyond the limit; the big merged
          // surfaces (plazas, walls, plots) never are
          if (/^props-detail-/.test(c.name)) add(c, Infinity);
          else if (!/^props-cell-/.test(c.name)) add(c);
        }
      }
      C.items = items;
    },
    get cullStats() { return { items: this._cull?.items?.length || 0, culled: this._cull?.off || 0, dist: CULL_DIST[this.preset?.name] ?? null }; },

    update(dt) {
      // repair normals of geometries added since the last scan (crops regrowing, decorations, effects) ~every 1.5 s
      this._normScan = (this._normScan ?? 9) + dt; // first frame scans immediately
      if (this._normScan > 1.5 && this.scene) { this._normScan = 0; scanSceneNormals(this.scene); guard.scan(this.scene); }
      // shadow camera + sun follow the focus point (player)
      const f = this.focus;
      if (this.sun && Number.isFinite(f.x) && Number.isFinite(f.z)) {
        this.sun.position.set(f.x + this.sunDir.x * 160, f.y + Math.max(this.sunDir.y, 0.08) * 160, f.z + this.sunDir.z * 160);
        this.sun.target.position.copy(f);
        this.sun.target.updateMatrixWorld();
      }
      this._updateGrade(dt);
      this._updateOutline(dt);
      this._updateCull(dt);
      // re-bake environment at most every 2s when sun/sky changed
      this._envTimer -= dt;
      if (this._envDirty && this._envTimer <= 0) { this._envTimer = 2; this.updateEnvironment(); }
      // fps & auto quality — measured on the wall clock (the loop clamps dt to 0.1 s, which would make a 3 fps device
      // read "10 fps"); a window that spans a hidden tab or a long stall is dropped instead of judged
      const wall = performance.now();
      if (!this._fpsT0) this._fpsT0 = wall;
      this._fpsFrames++;
      this._fpsAcc = (wall - this._fpsT0) / 1000;
      if (this._fpsAcc >= 0.5) {
        this.fps = this._fpsFrames / this._fpsAcc;
        const judge = this._fpsAcc <= 3;
        this._fpsT0 = wall; this._fpsAcc = 0; this._fpsFrames = 0;
        if (G.settings.showFps) {
          const el = document.getElementById('fps-meter');
          if (el) el.textContent = `FPS ${this.fps.toFixed(0)}  ${this.quality}\ndraw ${this.frameInfo.calls}  tri ${(this.frameInfo.triangles / 1000).toFixed(0)}k`;
        }
        if (judge && (G.settings.quality || 'auto') === 'auto' && !G.flags.quality && G.ready && !document.hidden) {
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

    /** draw one frame. opts.force: never thinned out (a photo reads the frame right after) — the loop passes dt */
    render(opts) {
      // no renderer (WebGL2 unavailable, §14.4.3) draws nothing; also between a real context loss and its
      // (asynchronous) event: a first-use program would throw inside three
      if (!this.renderer || this._isLost()) return;
      // The opaque developer center hides the world (render ~1/6); a large blocking modal covers most of it (~1/3).
      const cover = opts?.force ? 1 : document.body.classList.contains('dc-open') ? 6
        : (G.ui?.modal?.isOpen?.() && document.querySelector('.modal.modal-lg, .modal.modal-xl')) ? 3 : 1;
      if (cover > 1) {
        this._skip = ((this._skip || 0) + 1) % cover;
        if (this._skip) return;
      }
      const info = this.renderer.info;
      info.reset();
      this._placeFrame();   // [places-kit] sky follow + the room's light over the weather's values (after every update)
      if (this.atmosPass) { this.camera.updateMatrixWorld(); this._updateSunScreen(); } // this frame's camera: no glow lag
      guard.tick();   // §14.4.1: a non-finite opacity / scale / uniform never reaches the GPU
      try {
        if (this.composer) this.composer.render();
        else this.renderer.render(this.scene, this.camera);
      } finally { guard.restore(); }
      this.frameInfo.calls = info.render.calls;
      this.frameInfo.triangles = info.render.triangles;
      // §14.4.2: every 2 s the shown frame is read back at 96×54 and searched for a black / white block
      if (opts?.probe || watchdog.due(performance.now())) {
        watchdog.nextAt = performance.now() + watchdog.interval;
        try { watchdog._probeFrame(); } catch (e) { watchdog.enabled = false; G.log.warn('ENGINE', 'screen watchdog disabled (probe failed)', e?.message || e); }
      }
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
    // ============================================================ [places-kit] indoor profile + pooled lights
    // (CONTRACT §16.4 / §16.5 — ONE block; the two call sites are the marked lines in updateEnvironment() and render())
    //   engine.lightPool(n) -> PointLight[]   borrow up to n of the night lamps that already exist in the scene. All
    //       of them move to the scene root while borrowed (their owners' roots are hidden inside a place), so the
    //       light count never changes and no lit program is re-linked. [] on `low` (and when there are none).
    //   engine.releaseLights()                 hand them back: old parent, position, colour, distance, decay, night glow
    //   engine.setIndoor(profile | null, {instant}) -> eases hemisphere / sun direction, colour, intensity / fill /
    //       background / fog / exposure (grade layer 'interior') / environment intensity towards the room's values.
    //       engine.indoor = the eased factor 0..1 (51-weather multiplies its outdoor-only terms by 1 - indoor).
    //       profile { center: Vector3 (world; sun target and shadow centre), radius (m, half side of the shadow
    //         frustum), dir: Vector3 (towards the window sun), dist (m), sun {color, intensity}, moon {color,
    //         intensity}, hemi {sky, ground, intensity}, hemiNight {…}, fill, background, backgroundNight,
    //         fog {color, density}, exposure, exposureNight, warmth, envIntensity, env: THREE.Scene (baked into the
    //         persistent environment target — scene.environment stays the same texture object), onBake(night 0..1),
    //         radiusY (half height of the shadow frustum; default = radius),
    //         shadow {bias, normalBias, radius, near, far, mapSize (≥ the preset's; lattice bars are 3 cm)} }
    //   engine.indoorShadows                   may the window sun cast shadows now? (preset knob indoorShadows, else
    //                                          the preset's shadows; the 그림자 setting; a renderer)
    //   engine.skyFollow(on)                   the sky dome follows the camera (an outdoor place far from the origin)
    indoor: 0, _indoor: null, _indoorGoal: 0, _indoorSaved: null, _indoorEnvDirty: false, _indoorBakeNf: -1, _skyFollow: false, _pool: null,
    get indoorShadows() {
      const p = this.preset || {};
      return !!(this.renderer && this.renderer.shadowMap.enabled && this.sun && this.sun.castShadow && (p.indoorShadows ?? (!!p.shadows && p.name !== 'low')));
    },
    lightPool(n) {
      const W = G.world, P = this._pool || (this._pool = { items: [], out: false });
      if (!P.out) {
        P.items = (W?.nightLights || []).filter((nl) => nl && nl.light && nl.light.isPointLight)
          .map((nl) => ({ nl, light: nl.light, parent: nl.light.parent, pos: nl.light.position.clone(), color: nl.light.color.clone(), distance: nl.light.distance, decay: nl.light.decay }));
        for (const it of P.items) {
          it.nl.light = null;                   // the weather's lamp loop skips it while it is away
          if (this.scene) this.scene.add(it.light);
          it.light.intensity = 0; it.light.userData.pooled = true;
        }
        P.out = true;
      }
      n = Math.max(0, Math.floor(Number(n) || 0));
      return this.preset?.name === 'low' ? [] : P.items.slice(0, n).map((it) => it.light);
    },
    releaseLights() {
      const P = this._pool;
      if (!P || !P.out) return;
      const lampK = clamp(fin(Number(G.sys.weather?._lampK), fin(G.world?.nightFactor, 0)), 0, 1);
      for (const it of P.items) {
        const l = it.light;
        (it.parent || this.scene).add(l);
        l.position.copy(it.pos); l.color.copy(it.color); l.distance = it.distance; l.decay = it.decay;
        delete l.userData.pooled; delete l.userData.flicker;
        it.nl.light = l;
        l.intensity = (it.nl.intensity ?? 1) * lampK;
      }
      P.out = false; P.items = [];
    },
    skyFollow(on) {
      this._skyFollow = !!on;
      if (!on && this.sky) this.sky.position.set(0, 0, 0);
    },
    setIndoor(profile, opts = {}) {
      if (!this._indoorBound) {
        this._indoorBound = true;
        // a quality / shadow change rebuilds the shadow camera, a restored context drops the environment targets
        G.bus.on('engine:quality', () => { if (this._indoor && this._indoorGoal) { this._indoorSaved = null; this._indoorShadow(true); this._indoorEnvDirty = true; } });
        G.bus.on('settings:changed', ({ key }) => { if (key === 'shadows' && this._indoor && this._indoorGoal) { this._indoorSaved = null; this._indoorShadow(true); } });
        G.bus.on('engine:context', ({ lost }) => { if (!lost && this._indoor) this._indoorEnvDirty = true; });
      }
      if (profile) {
        const c = (v, d) => { const o = new THREE.Color(d); try { if (v != null) o.set(v); } catch (e) { o.set(d); } return clampColor(o, 0, 4, 0.5); };
        const lit = (o, col, int) => ({ color: c(o?.color, col), intensity: clamp(fin(Number(o?.intensity), int), 0, 12) });
        const hem = (o, sky, ground, int) => ({ sky: c(o?.sky, sky), ground: c(o?.ground, ground), intensity: clamp(fin(Number(o?.intensity), int), 0, 4) });
        const dir = new THREE.Vector3(0.3, 0.55, 0.78);
        if (profile.dir && Number.isFinite(profile.dir.x) && Number.isFinite(profile.dir.y) && Number.isFinite(profile.dir.z) && profile.dir.lengthSq?.() > 1e-6) dir.copy(profile.dir);
        dir.normalize(); if (dir.y < 0.05) { dir.y = 0.05; dir.normalize(); }
        const center = new THREE.Vector3();
        if (profile.center && Number.isFinite(profile.center.x) && Number.isFinite(profile.center.z)) center.set(profile.center.x, fin(profile.center.y, 0), profile.center.z);
        const hemi = hem(profile.hemi, 0xffeedd, 0x6b5138, 0.62);
        // the void around a room is never pure black (§16.0: ≥ 10/255 — the screen watchdog reads < 6 as a defect)
        const bg = (v, d) => { const o = c(v, d); const m = 10.5 / 255; if (o.r < m) o.r = m; if (o.g < m) o.g = m; if (o.b < m) o.b = m; return o; };
        this._indoor = {
          center, dir, dist: clamp(fin(Number(profile.dist), 60), 20, 150), radius: clamp(fin(Number(profile.radius), 12), 3, 80),
          radiusY: Number.isFinite(Number(profile.radiusY)) && profile.radiusY != null ? clamp(Number(profile.radiusY), 3, 80) : null,
          sun: lit(profile.sun, 0xffe6c2, 2.6), moon: lit(profile.moon, 0x8fa6d8, 0.35),
          hemi, hemiNight: profile.hemiNight ? hem(profile.hemiNight, 0x3a4664, 0x2a2018, 0.3) : { sky: hemi.sky.clone().multiplyScalar(0.45), ground: hemi.ground.clone().multiplyScalar(0.5), intensity: hemi.intensity * 0.5 },
          fill: clamp(fin(Number(profile.fill), 0.08), 0, 2),
          background: bg(profile.background, 0x1d1712), backgroundNight: bg(profile.backgroundNight ?? profile.background, 0x14110f),
          fogColor: bg(profile.fog?.color ?? profile.background, 0x1d1712), fogDensity: clamp(fin(Number(profile.fog?.density), 0.0015), 0, 0.05),
          exposure: clamp(fin(Number(profile.exposure), 1.05), 0.4, 2), exposureNight: clamp(fin(Number(profile.exposureNight), 1.1), 0.4, 2.5),
          warmth: clamp(fin(Number(profile.warmth), 0.08), -0.5, 0.5), envIntensity: clamp(fin(Number(profile.envIntensity), 0.6), 0, 3),
          env: profile.env && profile.env.isScene ? profile.env : null, onBake: typeof profile.onBake === 'function' ? profile.onBake : null,
          shadow: { bias: fin(Number(profile.shadow?.bias), -0.0005), normalBias: fin(Number(profile.shadow?.normalBias), 0.012), radius: fin(Number(profile.shadow?.radius), 1.6), near: fin(Number(profile.shadow?.near), 1), far: fin(Number(profile.shadow?.far), NaN), mapSize: fin(Number(profile.shadow?.mapSize), 0) },
        };
        this._indoorGoal = 1;
        if (opts.instant) this.indoor = 1;
        this._indoorShadow(true);
        this._indoorEnvDirty = true; this._indoorBakeNf = -1;
        this._gradeSnap = this._gradeSnap || !!opts.instant;
      } else {
        this._indoorGoal = 0;
        if (opts.instant || !this._indoor) { this.indoor = 0; this._indoorEnd(); this._gradeSnap = true; }
      }
      this._indoorT = performance.now();
      return this.indoor;
    },
    /** the window sun's shadow frustum: tight around the room (a lattice bar is 3 cm wide), the outdoor one put back */
    _indoorShadow(on) {
      const s = this.sun && this.sun.shadow, P = this._indoor;
      if (!s || !s.camera) return;
      if (on && P) {
        const cam = s.camera;
        if (!this._indoorSaved) this._indoorSaved = { left: cam.left, right: cam.right, top: cam.top, bottom: cam.bottom, near: cam.near, far: cam.far, bias: s.bias, normalBias: s.normalBias, radius: s.radius, size: s.mapSize.x };
        const R = P.radius, RY = P.radiusY ?? R;
        Object.assign(cam, { left: -R, right: R, top: RY, bottom: -RY, near: P.shadow.near, far: Number.isFinite(P.shadow.far) ? P.shadow.far : P.dist + Math.max(R, RY) * 2.5 });
        cam.updateProjectionMatrix();
        s.bias = P.shadow.bias; s.normalBias = P.shadow.normalBias; s.radius = P.shadow.radius;
        // a finer map for the lattice (never smaller than the preset's); the old target is replaced
        const size = Math.min(4096, Math.max(this._indoorSaved.size || 0, P.shadow.mapSize || 0));
        if (size && this.sun.castShadow && size !== s.mapSize.x) { s.mapSize.set(size, size); if (s.map) { s.map.dispose(); s.map = null; } }
      } else if (!on && this._indoorSaved) {
        const v = this._indoorSaved, cam = s.camera;
        Object.assign(cam, { left: v.left, right: v.right, top: v.top, bottom: v.bottom, near: v.near, far: v.far });
        cam.updateProjectionMatrix();
        s.bias = v.bias; s.normalBias = v.normalBias; s.radius = v.radius;
        if (v.size && v.size !== s.mapSize.x) { s.mapSize.set(v.size, v.size); if (s.map) { s.map.dispose(); s.map = null; } }
        this._indoorSaved = null;
      }
    },
    _indoorEnd() {
      if (!this._indoor && !this._indoorSaved) return;
      this._indoorShadow(false);
      this._indoor = null; this.indoor = 0; this._indoorGoal = 0;
      this.grade(null, 'interior');
      if (this.scene) this.scene.environmentIntensity = this.envIntensity ?? 0.5;
      this._envDirty = true; this._envTimer = 0;   // the sky comes back into the environment on the next update
    },
    /** the room's own environment: baked into the same persistent target as the sky (the texture object is kept) */
    _indoorBake() {
      const P = this._indoor;
      if (!P || !P.env || !this._pmrem || !this.renderer || this._isLost()) return false;
      const nf = clamp(fin(G.world?.nightFactor, 0), 0, 1);
      try { P.onBake?.(nf); } catch (e) { G.log.warn('ENGINE', 'indoor environment callback failed', e?.message || e); }
      if (!this._envCam) this._envCam = new THREE.CubeCamera(0.1, 1100, new THREE.WebGLCubeRenderTarget(256, { type: THREE.HalfFloatType }));
      this._envCam.update(this.renderer, P.env);
      this._envRT = this._pmrem.fromCubemap(this._envCam.renderTarget.texture, this._envRT);
      this.scene.environment = this._envRT.texture;
      this._indoorEnvDirty = false; this._indoorBakeNf = nf; this._envDirty = false;
      return true;
    },
    /** once per rendered frame, after every system's update (the weather has written its outdoor values by then) */
    _placeFrame() {
      if (this._skyFollow && this.sky && this.camera) this.sky.position.copy(this.camera.position);
      try { G.sys.places?._frame?.(); } catch (e) { /* the places system reports its own errors */ }
      const P = this._indoor;
      if (!P) return;
      const now = performance.now(), dt = Math.min(0.1, Math.max(0, (now - (this._indoorT || now)) / 1000));
      this._indoorT = now;
      const goal = this._indoorGoal;
      if (this.indoor !== goal) { this.indoor += (goal - this.indoor) * (1 - Math.exp(-dt / 0.16)); if (Math.abs(goal - this.indoor) < 0.005) this.indoor = goal; }
      const k = clamp(fin(this.indoor, goal), 0, 1);
      if (k <= 0 && goal === 0) { this._indoorEnd(); return; }
      const nf = clamp(fin(G.world?.nightFactor, 0), 0, 1), mix = THREE.MathUtils.lerp;
      const sun = this.sun, hemi = this.hemi, scene = this.scene;
      if (sun) {
        sun.color.lerp(_sunCol.copy(P.sun.color).lerp(P.moon.color, nf), k);
        sun.intensity = mix(fin(sun.intensity, 0), mix(P.sun.intensity, P.moon.intensity, nf), k);
        if (sun.shadow && 'intensity' in sun.shadow) sun.shadow.intensity = mix(fin(sun.shadow.intensity, 1), 1, k);
        if (k > 0.5) {
          sun.position.copy(P.center).addScaledVector(P.dir, P.dist);
          sun.target.position.copy(P.center); sun.target.updateMatrixWorld();
        }
      }
      if (hemi) {
        hemi.color.lerp(_sunCol.copy(P.hemi.sky).lerp(P.hemiNight.sky, nf), k);
        hemi.groundColor.lerp(_sunCol.copy(P.hemi.ground).lerp(P.hemiNight.ground, nf), k);
        hemi.intensity = mix(fin(hemi.intensity, 0.6), mix(P.hemi.intensity, P.hemiNight.intensity, nf), k);
      }
      if (this.fill) this.fill.intensity = mix(fin(this.fill.intensity, 0.2), P.fill, k);
      if (scene) {
        if (scene.background && scene.background.isColor) {
          // The profile's colour is a scene value (it goes through the tone mapping of the composer). Without the
          // composer (`low`) the clear colour is shown as it is, so it is brought down the toe of the curve by hand;
          // either way it ends up dark, warm and at least ~12/255 on the screen.
          _sunCol.copy(P.background).lerp(P.backgroundNight, nf);
          if (!this.composer) { _sunCol.multiplyScalar(0.172); const m = 0.0042; if (_sunCol.r < m) _sunCol.r = m; if (_sunCol.g < m) _sunCol.g = m; if (_sunCol.b < m) _sunCol.b = m; }
          scene.background.lerp(_sunCol, k);
        }
        const fog = scene.fog;
        if (fog) { fog.color.lerp(P.fogColor, k); if (fog.isFogExp2) fog.density = mix(fin(fog.density, 0.0028), P.fogDensity, k); }
        scene.environmentIntensity = mix(this.envIntensity ?? 0.5, P.envIntensity, k);
      }
      _indoorGrade.exposure = 1 + (mix(P.exposure, P.exposureNight, nf) - 1) * k;
      _indoorGrade.warmth = (P.warmth + 0.22 * nf) * k;   // lamp light at night: the weather's cool night grade stays outside
      _indoorGrade.saturation = 1 + 0.12 * nf * k;
      this.grade(_indoorGrade, 'interior');
      // the room's environment: at once after entering, again when day turned to night (at most every 2 s)
      if (P.env && k > 0.5 && (this._indoorEnvDirty || Math.abs(nf - this._indoorBakeNf) > 0.12) && (this._indoorBakeNf < 0 || now - (this._indoorBakeAt || 0) > 2000)) {
        this._indoorBakeAt = now;
        try { this._indoorBake(); } catch (e) { this._indoorEnvDirty = false; G.log.warn('ENGINE', 'indoor environment bake failed', e?.message || e); }
      }
    },
    // ============================================================ [places-kit] end

    add(o) { this.scene.add(o); return o; },
    remove(o) { this.scene.remove(o); },
    PRESETS,
    FEATURES,
  };
  G.register(engine);
})();
