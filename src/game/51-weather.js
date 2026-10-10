// =============================================================================
// 51-weather.js — game clock, day phases, sun & moon, sky / fog / light grading,
// weather (CLEAR CLOUDY RAIN FOG SNOW) with smooth ~6 s transitions, stars, moon,
// GPU rain streaks + ground splashes, snow, temperature & humidity, HUD + popover.
//
//   G.sys.weather (order 72)
//     current            weather id ('CLEAR' ...) — the target of the running transition
//     mix                {CLEAR:0..1, ...} blended weights actually on screen
//     hour / setHour(h)  game clock 0..24 (1 game hour = dayLengthMinutes/24 real minutes)
//     phase / phaseName  'MORNING'|'DAY'|'EVENING'|'NIGHT' / '아침'...
//     set(id, {instant, source})      change the weather (emits weather:changed {id, prev, source})
//     auto / lockTime    G.settings.autoWeather / G.settings.lockTime (setAuto(b), setLockTime(b))
//     temperature (°C), humidity (%), nightFactor, isNight, precipitation {rain, snow}
//     sunElevation / sunAzimuth (deg), timeString(h?) -> '10:30', icon(), openPopover(anchor)
//   Emits weather:changed {id, prev, source}, time:phase {phase, prev, name}.
//   Drives engine.setSun, Preetham sky uniforms, scene.fog, hemi / sun / fill lights, tone-mapping
//   exposure, G.world.nightFactor, G.world.nightMaterials / nightLights, nature clouds & wind,
//   engine.flareSuppressed. Per-device persistence: manual weather (auto off) and the locked hour.
// =============================================================================
(function () {
  const U = G.util;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const PI = Math.PI, DEG = PI / 180;
  const IDS = ['CLEAR', 'CLOUDY', 'RAIN', 'FOG', 'SNOW'];
  const LS_KEY = 'tfm.v1.weather';
  const TRANSITION = 6;            // seconds for a full weather cross-fade
  const AUTO_MIN = 180, AUTO_MAX = 360;

  // sun path: sunrise ~06:00 in the east, solar noon high in the south, sunset ~19:30 in the west
  const RISE = 6.0, SET = 19.5, MAX_ELEV = 62, NIGHT_MIN = -38;

  // per-weather look (daytime values; the time of day modulates them)
  //  cover/tint: nature clouds · sun/hemi: light multipliers · fog: FogExp2 density · grey: overcast sky amount
  //  greyCol: overcast sky / fog colour at noon · turb/ray/mie: Preetham sky offsets · exp: exposure multiplier
  //  wind: nature wind strength · lamp: how much lanterns/windows glow in daylight · haze: clear horizon haze
  const LOOK = {
    CLEAR: { cover: 0.36, tint: '#ffffff', sun: 1.0, hemi: 1.0, fog: 0.0026, grey: 0.0, greyCol: '#c4d0da', turb: 0, ray: 0, mie: 0, exp: 1.0, wind: 0.9, lamp: 0, haze: 0.2 },
    CLOUDY: { cover: 0.84, tint: '#d4d9df', sun: 0.42, hemi: 1.12, fog: 0.0036, grey: 0.42, greyCol: '#b6bfc8', turb: 4.5, ray: 0.5, mie: 0.004, exp: 0.98, wind: 1.25, lamp: 0.1, haze: 0.3 },
    RAIN: { cover: 1.0, tint: '#868e98', sun: 0.16, hemi: 0.84, fog: 0.0072, grey: 0.84, greyCol: '#86909a', turb: 9, ray: 1.0, mie: 0.01, exp: 0.95, wind: 1.8, lamp: 0.42, haze: 0.4 },
    FOG: { cover: 0.92, tint: '#e2e6e9', sun: 0.32, hemi: 1.06, fog: 0.021, grey: 0.97, greyCol: '#c3cacf', turb: 10, ray: 0.8, mie: 0.012, exp: 1.0, wind: 0.25, lamp: 0.36, haze: 0.5 },
    SNOW: { cover: 0.96, tint: '#eef1f5', sun: 0.36, hemi: 1.2, fog: 0.0062, grey: 0.74, greyCol: '#d0d7df', turb: 8, ray: 0.6, mie: 0.008, exp: 1.0, wind: 0.6, lamp: 0.26, haze: 0.45 },
  };
  // monthly climate of a Gangwon mountain valley (°C daily max / min, humidity offset %)
  const CLIMATE = {
    max: [1, 4, 10, 18, 23, 27, 29, 29, 25, 19, 11, 3],
    min: [-11, -8, -3, 3, 9, 15, 20, 20, 13, 5, -1, -8],
    hum: [-10, -8, -6, -4, 0, 6, 10, 10, 4, 0, -4, -8],
  };
  const PICK_COLORS = { CLEAR: '#ffd23f', CLOUDY: '#c9d3dc', RAIN: '#6fb9ff', FOG: '#d7dde2', SNOW: '#dff0ff' };

  // ---------------------------------------------------------------- colours (linear working space)
  const C = (hex) => new THREE.Color(hex);
  const COL = {
    sunNoon: C('#fff1dc'), sunGold: C('#ffa860'), moon: C('#a9bdff'),
    hemiDay: C('#cfe3ff'), hemiGold: C('#ffd2a8'), hemiNight: C('#4b6290'),
    groundDay: C('#5c6b3c'), groundNight: C('#1d2621'), groundSnow: C('#c9d0d6'),
    fogDay: C('#bcd6e8'), fogGold: C('#e9c4a0'), fogNight: C('#1b2840'),
    zenithNight: C('#0a1430'), zenithTwilight: C('#2b4176'), glowSunset: C('#ff9a5c'), glowDusk: C('#e8707a'), fillDay: C('#bfd6ff'), fillNight: C('#6d82b6'),
    rainDay: C('#cfdae6'), rainNight: C('#59677c'), snowDay: C('#ffffff'), snowNight: C('#9aa8c4'),
    goldTint: C('#ffd9b6'), nightTint: C('#4a5470'), white: C('#ffffff'),
  };
  const LOOK_COL = {};
  for (const id of IDS) LOOK_COL[id] = { tint: C(LOOK[id].tint), grey: C(LOOK[id].greyCol) };

  // scratch objects (no per-frame allocations)
  const _c1 = new THREE.Color(), _c2 = new THREE.Color(), _c3 = new THREE.Color();
  const _fogCol = new THREE.Color(), _greyCol = new THREE.Color(), _tint = new THREE.Color();
  const _moonDir = new THREE.Vector3(), _v = new THREE.Vector3(), _fwd = new THREE.Vector3();
  const _mixed = { cover: 0, sun: 0, hemi: 0, fog: 0, grey: 0, turb: 0, ray: 0, mie: 0, exp: 0, wind: 0, lamp: 0, haze: 0, tempMod: 0, hum: 0 };

  /** Korean particle 으로/로 for a word (ㄹ-final and vowel-final words take 로) */
  function roOf(word) {
    const w = String(word || ''), c = w.charCodeAt(w.length - 1) - 0xac00;
    if (!(c >= 0 && c <= 11171)) return '로';
    const jong = c % 28;
    return jong === 0 || jong === 8 ? '로' : '으로';
  }
  function loadPrefs() { try { return JSON.parse(localStorage.getItem(LS_KEY) || '{}') || {}; } catch (e) { return {}; } }
  function savePrefs(p) { try { localStorage.setItem(LS_KEY, JSON.stringify(p)); } catch (e) { /* storage blocked */ } }
  const wrap24 = (h) => ((h % 24) + 24) % 24;

  /** sun elevation / azimuth (deg) for a clock hour */
  function sunAngles(h, out) {
    h = wrap24(h);
    if (h >= RISE && h <= SET) {
      const p = (h - RISE) / (SET - RISE);
      out.elev = MAX_ELEV * Math.sin(PI * p);
      out.az = 80 + 200 * p;
      out.night = 0;
    } else {
      const hn = h > SET ? h - SET : h + 24 - SET;
      const p = hn / (24 - (SET - RISE));
      out.elev = NIGHT_MIN * Math.sin(PI * p);
      out.az = 280 + 160 * p;
      out.night = p;
    }
    return out;
  }
  const _sun = { elev: 0, az: 0, night: 0 };

  // ================================================================= sky effects (overlay, stars, moon)
  const OVERLAY_VS = `
    varying vec3 vDir;
    void main() {
      vec4 wp = modelMatrix * vec4(position, 1.0);
      vDir = wp.xyz - cameraPosition;
      gl_Position = projectionMatrix * viewMatrix * wp;
    }`;
  const OVERLAY_FS = `
    uniform vec3 uHorizon; uniform vec3 uZenith; uniform float uAH; uniform float uAT; uniform float uBand;
    uniform vec3 uSunDir; uniform vec3 uGlow; uniform float uGlowAmt;
    varying vec3 vDir;
    void main() {
      vec3 d = normalize(vDir);
      float k = smoothstep(-0.03, uBand, d.y);
      vec3 col = mix(uHorizon, uZenith, k);
      float a = mix(uAH, uAT, k);
      // warm twilight glow above the horizon on the sun side
      vec2 sh = normalize(uSunDir.xz + vec2(1e-5));
      vec2 dh = normalize(d.xz + vec2(1e-5));
      float g = pow(max(dot(dh, sh), 0.0), 3.0) * (1.0 - smoothstep(-0.02, 0.42, d.y)) * uGlowAmt;
      col = mix(col, uGlow, clamp(g * 1.15, 0.0, 1.0));
      a = max(a, g);
      gl_FragColor = vec4(col, a);
      #include <colorspace_fragment>
    }`;

  function buildOverlay() {
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uHorizon: { value: new THREE.Color(0xbcd6e8) }, uZenith: { value: new THREE.Color(0xbcd6e8) },
        uAH: { value: 0 }, uAT: { value: 0 }, uBand: { value: 0.12 },
        uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uGlow: { value: new THREE.Color(0xff9a5c) }, uGlowAmt: { value: 0 },
      },
      vertexShader: OVERLAY_VS, fragmentShader: OVERLAY_FS,
      side: THREE.BackSide, transparent: true, depthWrite: false, depthTest: true, fog: false,
    });
    const geo = new THREE.SphereGeometry(1, 48, 24);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.scale.setScalar(2300);
    mesh.frustumCulled = false; mesh.renderOrder = -9; mesh.name = 'sky-overlay';
    mesh.raycast = () => {};
    return mesh;
  }

  function buildStars(count) {
    const rnd = U.rng(4242);
    const pos = new Float32Array(count * 3), info = new Float32Array(count * 2), col = new Float32Array(count * 3);
    const tmp = new THREE.Color();
    for (let i = 0; i < count; i++) {
      // uniform on the upper hemisphere, slightly denser band
      const y = Math.pow(rnd(), 0.85) * 0.98 + 0.02;
      const a = rnd() * PI * 2, r = Math.sqrt(1 - y * y);
      pos[i * 3] = Math.cos(a) * r * 2000; pos[i * 3 + 1] = y * 2000; pos[i * 3 + 2] = Math.sin(a) * r * 2000;
      const bright = rnd();
      info[i * 2] = bright > 0.985 ? 3.6 + rnd() * 1.4 : bright > 0.9 ? 2.3 + rnd() * 0.8 : 1.1 + rnd() * 1.0;
      info[i * 2 + 1] = rnd();
      const k = rnd();
      tmp.set(k < 0.15 ? '#bcd2ff' : k < 0.25 ? '#ffe7c2' : '#ffffff');
      col[i * 3] = tmp.r; col[i * 3 + 1] = tmp.g; col[i * 3 + 2] = tmp.b;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aInfo', new THREE.BufferAttribute(info, 2));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const mat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uAlpha: { value: 0 }, uPR: { value: 1 } },
      vertexShader: `
        attribute vec2 aInfo; attribute vec3 color;
        uniform float uTime; uniform float uPR; uniform float uAlpha;
        varying vec3 vCol; varying float vA;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vec3 d = normalize(wp.xyz - cameraPosition);
          float tw = 0.72 + 0.28 * sin(uTime * (1.3 + aInfo.y * 2.6) + aInfo.y * 61.0);
          vA = uAlpha * tw * smoothstep(0.02, 0.22, d.y) * (0.55 + 0.45 * min(aInfo.x / 2.4, 1.0));
          vCol = color;
          gl_Position = projectionMatrix * viewMatrix * wp;
          gl_PointSize = aInfo.x * uPR;
        }`,
      fragmentShader: `
        varying vec3 vCol; varying float vA;
        void main() {
          vec2 q = gl_PointCoord - 0.5;
          float d = length(q) * 2.0;
          float a = (1.0 - smoothstep(0.35, 1.0, d)) * vA;
          if (a < 0.01) discard;
          gl_FragColor = vec4(vCol, a);
          #include <colorspace_fragment>
        }`,
      transparent: true, depthWrite: false, depthTest: true, fog: false, blending: THREE.AdditiveBlending,
    });
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false; pts.renderOrder = -8; pts.name = 'stars';
    pts.raycast = () => {};
    pts.visible = false;
    return pts;
  }

  function buildMoon() {
    const tex = G.gfx.canvasTexture(256, 256, (ctx, w) => {
      const c = w / 2;
      const glow = ctx.createRadialGradient(c, c, w * 0.1, c, c, c);
      glow.addColorStop(0, 'rgba(220,232,255,0.55)'); glow.addColorStop(0.28, 'rgba(190,210,255,0.22)'); glow.addColorStop(1, 'rgba(160,190,255,0)');
      ctx.fillStyle = glow; ctx.fillRect(0, 0, w, w);
      const R = w * 0.16;
      const disc = ctx.createRadialGradient(c - R * 0.3, c - R * 0.3, R * 0.1, c, c, R);
      disc.addColorStop(0, '#fffdf2'); disc.addColorStop(0.8, '#e9e6d8'); disc.addColorStop(1, '#cfcbbb');
      ctx.fillStyle = disc; ctx.beginPath(); ctx.arc(c, c, R, 0, PI * 2); ctx.fill();
      const rnd = U.rng(77);
      ctx.save(); ctx.beginPath(); ctx.arc(c, c, R, 0, PI * 2); ctx.clip();
      for (let i = 0; i < 11; i++) {
        const a = rnd() * PI * 2, d = Math.sqrt(rnd()) * R * 0.8, r = R * (0.06 + rnd() * 0.16);
        ctx.fillStyle = `rgba(150,146,130,${0.18 + rnd() * 0.2})`;
        ctx.beginPath(); ctx.arc(c + Math.cos(a) * d, c + Math.sin(a) * d, r, 0, PI * 2); ctx.fill();
      }
      ctx.restore();
    });
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: true, fog: false, toneMapped: false, opacity: 0 });
    const s = new THREE.Sprite(mat);
    s.scale.setScalar(210);
    s.renderOrder = -7; s.name = 'moon'; s.frustumCulled = false; s.visible = false;
    s.raycast = () => {};
    return s;
  }

  // ================================================================= precipitation
  function buildRain(count) {
    const quad = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = quad.index;
    geo.setAttribute('position', quad.attributes.position);
    const seeds = new Float32Array(count * 4);
    const rnd = U.rng(9191);
    for (let i = 0; i < count; i++) { seeds[i * 4] = rnd(); seeds[i * 4 + 1] = rnd(); seeds[i * 4 + 2] = rnd(); seeds[i * 4 + 3] = rnd(); }
    geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 4));
    geo.instanceCount = count;
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 }, uIntensity: { value: 0 }, uCenter: { value: new THREE.Vector3() }, uBox: { value: new THREE.Vector3(34, 20, 34) },
        uWind: { value: new THREE.Vector2(1.2, 0.5) }, uFall: { value: 12.5 }, uLen: { value: 0.62 }, uWidth: { value: 0.016 },
        uColor: { value: new THREE.Color(0xcfdae6) }, uOpacity: { value: 0.45 },
      },
      vertexShader: `
        attribute vec4 aSeed;
        uniform float uTime; uniform float uIntensity; uniform vec3 uCenter; uniform vec3 uBox; uniform vec2 uWind;
        uniform float uFall; uniform float uLen; uniform float uWidth;
        varying float vA; varying float vX;
        void main() {
          if (aSeed.w > uIntensity) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vA = 0.0; vX = 0.0; return; }
          float speed = uFall * (0.82 + aSeed.w * 0.36);
          vec3 vel = vec3(uWind.x, -speed, uWind.y);
          vec3 origin = uCenter - uBox * 0.5;
          vec3 p = aSeed.xyz * uBox + vel * uTime;
          p = origin + mod(p - origin, uBox);
          vec3 axis = normalize(vel);
          vec3 toCam = normalize(cameraPosition - p);
          vec3 side = normalize(cross(axis, toCam));
          float len = uLen * (0.7 + fract(aSeed.x * 7.13) * 0.6);
          vec3 wp = p + side * position.x * uWidth + axis * position.y * len;
          vec4 mv = viewMatrix * vec4(wp, 1.0);
          gl_Position = projectionMatrix * mv;
          float dist = -mv.z;
          vA = (0.35 + 0.65 * (0.5 - position.y)) * smoothstep(0.5, 2.2, dist) * (1.0 - smoothstep(13.0, 21.0, dist));
          vX = position.x * 2.0;
        }`,
      fragmentShader: `
        uniform vec3 uColor; uniform float uOpacity;
        varying float vA; varying float vX;
        void main() {
          float a = uOpacity * vA * (1.0 - vX * vX);
          if (a < 0.004) discard;
          gl_FragColor = vec4(uColor, a);
          #include <colorspace_fragment>
        }`,
      transparent: true, depthWrite: false, depthTest: true, fog: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false; mesh.renderOrder = 12; mesh.name = 'rain'; mesh.visible = false;
    mesh.raycast = () => {};
    return mesh;
  }

  function buildSplashes(count) {
    const quad = new THREE.PlaneGeometry(1, 1).rotateX(-PI / 2);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = quad.index;
    geo.setAttribute('position', quad.attributes.position);
    geo.setAttribute('uv', quad.attributes.uv);
    const data = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) data[i * 4 + 1] = -9999;
    const attr = new THREE.InstancedBufferAttribute(data, 4);
    attr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aSplash', attr);
    geo.instanceCount = count;
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    const mat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uLife: { value: 0.5 }, uOpacity: { value: 0.5 }, uColor: { value: new THREE.Color(0xe4eef7) } },
      vertexShader: `
        attribute vec4 aSplash;
        uniform float uTime; uniform float uLife;
        varying vec2 vUv; varying float vAge;
        void main() {
          float age = clamp((uTime - aSplash.w) / uLife, 0.0, 1.0);
          float s = mix(0.05, 0.46, sqrt(age));
          vec3 wp = aSplash.xyz + vec3(position.x * s, 0.0, position.z * s);
          vUv = uv; vAge = age;
          gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
        }`,
      fragmentShader: `
        uniform float uOpacity; uniform vec3 uColor;
        varying vec2 vUv; varying float vAge;
        void main() {
          float r = length(vUv - 0.5) * 2.0;
          float ring = smoothstep(0.55, 0.78, r) * (1.0 - smoothstep(0.82, 1.0, r));
          float core = (1.0 - smoothstep(0.0, 0.3, r)) * (1.0 - smoothstep(0.0, 0.25, vAge));
          float a = (ring * 0.9 + core) * (1.0 - vAge) * uOpacity;
          if (a < 0.01) discard;
          gl_FragColor = vec4(uColor, a);
          #include <colorspace_fragment>
        }`,
      transparent: true, depthWrite: false, depthTest: true, fog: false,
      polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false; mesh.renderOrder = 11; mesh.name = 'rain-splashes'; mesh.visible = false;
    mesh.raycast = () => {};
    return mesh;
  }

  function buildSnow(count) {
    const geo = new THREE.BufferGeometry();
    const seeds = new Float32Array(count * 4);
    const rnd = U.rng(5150);
    for (let i = 0; i < count; i++) { seeds[i * 4] = rnd(); seeds[i * 4 + 1] = rnd(); seeds[i * 4 + 2] = rnd(); seeds[i * 4 + 3] = rnd(); }
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 4));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 }, uIntensity: { value: 0 }, uCenter: { value: new THREE.Vector3() }, uBox: { value: new THREE.Vector3(30, 18, 30) },
        uWind: { value: new THREE.Vector2(0.6, 0.3) }, uSize: { value: 0.05 }, uScale: { value: 800 }, uColor: { value: new THREE.Color(0xffffff) }, uOpacity: { value: 0.9 },
      },
      vertexShader: `
        attribute vec4 aSeed;
        uniform float uTime; uniform float uIntensity; uniform vec3 uCenter; uniform vec3 uBox; uniform vec2 uWind; uniform float uSize; uniform float uScale;
        varying float vA;
        void main() {
          if (aSeed.w > uIntensity) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; vA = 0.0; return; }
          float fall = 0.85 + aSeed.w * 0.75;
          vec3 p = aSeed.xyz * uBox + vec3(uWind.x * 0.7, -fall, uWind.y * 0.7) * uTime;
          p.x += sin(uTime * (0.55 + aSeed.w * 0.6) + aSeed.y * 40.0) * 0.75;
          p.z += cos(uTime * (0.45 + aSeed.x * 0.5) + aSeed.z * 40.0) * 0.75;
          vec3 origin = uCenter - uBox * 0.5;
          p = origin + mod(p - origin, uBox);
          vec4 mv = viewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          float dist = max(0.1, -mv.z);
          gl_PointSize = clamp(uSize * (0.55 + aSeed.x * 0.9) * uScale / dist, 1.0, 15.0);
          vA = smoothstep(0.6, 2.2, dist) * (1.0 - smoothstep(12.0, 17.0, dist));
        }`,
      fragmentShader: `
        uniform vec3 uColor; uniform float uOpacity;
        varying float vA;
        void main() {
          float d = length(gl_PointCoord - 0.5) * 2.0;
          float a = (1.0 - smoothstep(0.25, 1.0, d)) * vA * uOpacity;
          if (a < 0.01) discard;
          gl_FragColor = vec4(uColor, a);
          #include <colorspace_fragment>
        }`,
      transparent: true, depthWrite: false, depthTest: true, fog: false,
    });
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false; pts.renderOrder = 12; pts.name = 'snow'; pts.visible = false;
    pts.raycast = () => {};
    return pts;
  }

  // ================================================================= the system
  const WX = {
    name: 'weather', order: 72, label: '날씨와 시간',
    current: 'CLEAR',
    mix: { CLEAR: 1, CLOUDY: 0, RAIN: 0, FOG: 0, SNOW: 0 },
    temperature: 23, humidity: 55,
    nightFactor: 0, sunElevation: 45, sunAzimuth: 160,
    precipitation: { rain: 0, snow: 0 },
    _hour: 10.5, _phase: null, _autoT: 240, _hudT: 0, _hudKey: '',
    _lastSunE: 999, _lastSunA: 999, _envT: 0, _ready: false, _emittedInit: false,
    _pop: null, _dragging: false, _prefs: null,
    _fx: null, _overlay: null, _envOverlay: null, _stars: null, _moon: null, _rain: null, _splash: null, _snow: null,
    _splashCenter: new THREE.Vector3(), _splashI: 0,
    _lampK: -1, _lampCount: -1,

    // ------------------------------------------------------------ getters
    get hour() { return this._hour; },
    get phase() { return this._phase || phaseOf(this._hour).id; },
    get phaseName() { return phaseOf(this._hour).name; },
    get auto() { return G.settings.autoWeather !== false; },
    get lockTime() { return !!G.settings.lockTime; },
    get isNight() { return this.nightFactor > 0.5; },
    get weatherId() { return this.current; },
    get data() { return G.data.weather?.[this.current] || null; },

    // ------------------------------------------------------------ lifecycle
    init() {
      const E = G.sys.engine;
      const T = G.data.time || { dayLengthMinutes: 24, startHour: 10.5 };
      this._rate = 24 / Math.max(1, (Number(T.dayLengthMinutes) || 24) * 60); // game hours per real second
      this._prefs = loadPrefs();
      this._hour = wrap24(Number(T.startHour ?? 10.5));
      if (this.lockTime && Number.isFinite(this._prefs.hour)) this._hour = wrap24(this._prefs.hour);
      if (!this.auto && IDS.includes(this._prefs.weather)) this.current = this._prefs.weather;
      for (const id of IDS) this.mix[id] = id === this.current ? 1 : 0;
      this._autoT = U.rand(AUTO_MIN, AUTO_MAX);
      this._phase = phaseOf(this._hour).id;

      if (E && E.scene) {
        const preset = E.preset || { name: 'medium' };
        const q = preset.name;
        const fx = new THREE.Group(); fx.name = 'weather-sky';
        try {
          this._overlay = buildOverlay();
          fx.add(this._overlay);
          // same overlay inside the environment bake so reflections match the sky (night / overcast / fog)
          if (E._envScene) {
            this._envOverlay = new THREE.Mesh(this._overlay.geometry, this._overlay.material);
            this._envOverlay.scale.setScalar(900); this._envOverlay.frustumCulled = false; this._envOverlay.renderOrder = -9;
            E._envScene.add(this._envOverlay);
          }
        } catch (e) { G.log.warn('WEATHER', 'sky overlay failed', e); }
        try { this._stars = buildStars(q === 'low' ? 900 : q === 'medium' ? 1500 : 2200); fx.add(this._stars); } catch (e) { G.log.warn('WEATHER', 'stars failed', e); }
        try { this._moon = buildMoon(); fx.add(this._moon); } catch (e) { G.log.warn('WEATHER', 'moon failed', e); }
        E.scene.add(fx);
        this._fx = fx;
        try { this._rain = buildRain(q === 'low' ? 2600 : q === 'medium' ? 5200 : 8000); E.scene.add(this._rain); } catch (e) { G.log.warn('WEATHER', 'rain failed', e); }
        try { this._splash = buildSplashes(q === 'low' ? 70 : q === 'medium' ? 150 : 230); E.scene.add(this._splash); } catch (e) { G.log.warn('WEATHER', 'splashes failed', e); }
        try { this._snow = buildSnow(q === 'low' ? 2200 : q === 'medium' ? 4200 : 6000); E.scene.add(this._snow); } catch (e) { G.log.warn('WEATHER', 'snow failed', e); }
        this._onResize();
        E.onResize?.(() => this._onResize());
      }

      G.ui.onAction('weather', (el) => this.openPopover(el));
      G.bus.on('settings:changed', ({ key }) => {
        if (key === 'autoWeather') {
          this._autoT = U.rand(AUTO_MIN, AUTO_MAX);
          this._persist();
          this._refreshPopover(true);
        } else if (key === 'lockTime') {
          this._persist();
          this._refreshPopover(true);
        }
      });
      G.bus.on('engine:quality', () => this._onResize());
      this._ready = true;
      // compute everything once so the first rendered frame is already graded
      this._apply(0, 0, true);
      this._updateTemp();
      this._updateHud(true);
      G.log.info('WEATHER', `clock ${this.timeString()} (${this.phaseName}), weather ${this.current}, ${this._rate * 3600}h per real hour`);
    },

    onStateLoaded() {
      // the save may carry device settings (autoWeather / lockTime): re-apply the matching per-device prefs
      const pr = this._prefs || {};
      if (this.lockTime && Number.isFinite(pr.hour) && Math.abs(pr.hour - this._hour) > 0.01) this.setHour(pr.hour);
      if (!this.auto && IDS.includes(pr.weather) && pr.weather !== this.current) this.set(pr.weather, { source: 'restore' });
      this._updateHud(true);
      if (!this._emittedInit) {
        this._emittedInit = true;
        // let late systems (social, audio, app) finish onStateLoaded before the initial sync events
        setTimeout(() => {
          G.bus.emit('time:phase', { phase: this.phase, prev: null, name: this.phaseName, initial: true });
          G.bus.emit('weather:changed', { id: this.current, prev: null, source: 'init' });
        }, 0);
      }
    },

    // ------------------------------------------------------------ public API
    set(id, opts = {}) {
      id = String(id || '').toUpperCase();
      if (!IDS.includes(id)) { G.log.warn('WEATHER', `unknown weather "${id}"`); return false; }
      const prev = this.current;
      if (id !== prev) {
        this.current = id;
        G.bus.emit('weather:changed', { id, prev, source: opts.source || 'api' });
        G.log.info('WEATHER', `${prev} -> ${id} (${opts.source || 'api'})`);
      }
      if (opts.instant) { for (const k of IDS) this.mix[k] = k === id ? 1 : 0; this._apply(0, G.time.elapsed, true); }
      this._persist();
      this._updateTemp();
      this._updateHud(true);
      this._refreshPopover(true);
      return true;
    },
    setHour(h) {
      h = Number(h);
      if (!Number.isFinite(h)) return;
      this._hour = wrap24(h);
      this._checkPhase();
      this._apply(0, G.time.elapsed, true);
      this._updateTemp();
      this._persist();
      this._updateHud(true);
    },
    setAuto(on) { G.setSetting('autoWeather', !!on); },
    setLockTime(on) { G.setSetting('lockTime', !!on); },
    timeString(h = this._hour) {
      h = wrap24(h);
      let hh = Math.floor(h), mm = Math.floor((h - hh) * 60 + 1e-6);
      if (mm >= 60) { mm = 0; hh = (hh + 1) % 24; }
      return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
    },
    /** icon name for the bottom bar (moon on clear nights) */
    icon(id = this.current) {
      if (id === 'CLEAR') return this.nightFactor > 0.55 ? 'moon' : 'sun';
      if (id === 'CLOUDY') return 'cloud';
      return G.data.weather?.[id]?.icon || 'sun';
    },

    // ------------------------------------------------------------ per frame
    update(dt, t) {
      if (!this._ready) return;
      // clock
      if (!this.lockTime) {
        this._hour = wrap24(this._hour + dt * this._rate);
        this._checkPhase();
      }
      // automatic weather
      if (this.auto && G.ready !== false) {
        this._autoT -= dt;
        if (this._autoT <= 0) {
          this._autoT = U.rand(AUTO_MIN, AUTO_MAX);
          const next = this._pickNext();
          if (next !== this.current) this.set(next, { source: 'auto' });
        }
      }
      // cross-fade weights (linear ~TRANSITION s, renormalised)
      const step = dt / TRANSITION;
      let sum = 0;
      for (const id of IDS) {
        const goal = id === this.current ? 1 : 0;
        const v = this.mix[id];
        this.mix[id] = v < goal ? Math.min(goal, v + step) : Math.max(goal, v - step);
        sum += this.mix[id];
      }
      if (sum > 0) for (const id of IDS) this.mix[id] /= sum;
      this._apply(dt, t, false);
      // temperature / HUD (2x per second)
      this._hudT -= dt;
      if (this._hudT <= 0) {
        this._hudT = 0.5;
        this._updateTemp();
        this._updateHud(false);
        if (this._pop && !this._pop.closed) this._refreshPopover(false);
      }
    },

    // ------------------------------------------------------------ internals
    _checkPhase() {
      const ph = phaseOf(this._hour);
      if (ph.id !== this._phase) {
        const prev = this._phase;
        this._phase = ph.id;
        G.bus.emit('time:phase', { phase: ph.id, prev, name: ph.name });
        G.log.debug('WEATHER', `phase ${prev} -> ${ph.id}`);
        this._updateHud(true);
      }
    },

    _pickNext() {
      const month = new Date(G.time.now()).getMonth();
      const winter = month === 11 || month <= 1;
      const h = this._hour;
      const morning = h >= 4.5 && h < 9.5;
      const w = { CLEAR: 46, CLOUDY: 30, RAIN: winter ? 3 : 13, FOG: morning ? 16 : 5, SNOW: winter ? 15 : 0 };
      const cur = this.current;
      if (cur === 'CLEAR') w.CLEAR *= 0.55; else w[cur] *= 0.3;
      if (cur === 'RAIN' || cur === 'SNOW' || cur === 'FOG') { w.CLOUDY *= 1.5; w.RAIN *= cur === 'RAIN' ? 1 : 0.6; }
      let total = 0;
      for (const id of IDS) total += w[id];
      let r = Math.random() * total;
      for (const id of IDS) { r -= w[id]; if (r <= 0) return id; }
      return 'CLEAR';
    },

    _mixLook() {
      const m = _mixed;
      for (const k in m) m[k] = 0;
      _greyCol.setRGB(0, 0, 0); _tint.setRGB(0, 0, 0);
      const wd = G.data.weather || {};
      for (const id of IDS) {
        const w = this.mix[id];
        if (w <= 0) continue;
        const L = LOOK[id];
        m.cover += L.cover * w; m.sun += L.sun * w; m.hemi += L.hemi * w; m.fog += L.fog * w; m.grey += L.grey * w;
        m.turb += L.turb * w; m.ray += L.ray * w; m.mie += L.mie * w; m.exp += L.exp * w; m.wind += L.wind * w;
        m.lamp += L.lamp * w; m.haze += L.haze * w;
        m.tempMod += (wd[id]?.tempMod ?? 0) * w; m.hum += (wd[id]?.humidity ?? 60) * w;
        _greyCol.r += LOOK_COL[id].grey.r * w; _greyCol.g += LOOK_COL[id].grey.g * w; _greyCol.b += LOOK_COL[id].grey.b * w;
        _tint.r += LOOK_COL[id].tint.r * w; _tint.g += LOOK_COL[id].tint.g * w; _tint.b += LOOK_COL[id].tint.b * w;
      }
      return m;
    },

    _apply(dt, t, force) {
      const E = G.sys.engine;
      if (!E || !E.scene) return;
      const m = this._mixLook();
      sunAngles(this._hour, _sun);
      const e = _sun.elev;
      this.sunElevation = e; this.sunAzimuth = _sun.az;

      // ---- time-of-day factors
      const dayK = smooth(-5, 8, e);                               // daylight amount
      const gold = smooth(-5, 2, e) * (1 - smooth(5, 22, e));      // golden hour
      const nightK = 1 - smooth(-12, -2, e);                       // depth of night (sky)
      const twK = (1 - smooth(-1, 4, e)) * (1 - nightK);           // blue hour (sun just below the horizon)
      const glowK = smooth(-9, -1, e) * (1 - smooth(4, 15, e));    // warm glow on the sun side of the sky
      const moonK = 1 - smooth(-8, -2, e);                         // moonlight ramp
      const nf = 1 - smooth(-8, 3, e);
      this.nightFactor = nf;
      G.world.nightFactor = nf;
      const grey = clamp(m.grey, 0, 1);
      const light = lerp(0.1, 1, dayK);                           // overcast brightness by time of day

      // ---- sun / moon direction (engine.setSun only when it moved noticeably -> env re-bake throttled)
      const dE = Math.abs(e - this._lastSunE), dA = Math.abs(_sun.az - this._lastSunA);
      const trans = this._inTransition();
      this._envT -= dt;
      if (force || dE > 0.35 || dA > 0.5 || (trans && this._envT <= 0)) {
        if (trans) this._envT = 1.5;
        this._lastSunE = e; this._lastSunA = _sun.az;
        E.setSun(e, _sun.az);
      }
      // moon: opposite side of the sky, high at midnight
      const moonElev = (22 + 40 * Math.sin(PI * clamp(_sun.night, 0, 1))) * DEG;
      const moonAz = ((_sun.az + 180) % 360) * DEG;
      _moonDir.set(Math.cos(moonElev) * Math.sin(moonAz), Math.sin(moonElev), -Math.cos(moonElev) * Math.cos(moonAz)).normalize();

      // ---- key light (sun by day, moon by night) — engine.update already placed the light along sunDir
      const sun = E.sun;
      if (sun) {
        if (e > -1.75) {
          _c1.copy(COL.sunNoon).lerp(COL.sunGold, gold);
          if (grey > 0) { _c2.copy(_greyCol).multiplyScalar(1.15); _c1.lerp(_c2, grey * 0.55); }
          sun.color.copy(_c1);
          sun.intensity = 2.75 * smooth(-1.5, 10, e) * m.sun * (1 - 0.15 * gold);
        } else {
          sun.color.copy(COL.moon);
          sun.intensity = 0.78 * moonK * (1 - 0.72 * grey);
          const f = E.focus;
          sun.position.set(f.x + _moonDir.x * 160, f.y + _moonDir.y * 160, f.z + _moonDir.z * 160);
        }
      }
      // ---- hemisphere (sky / ground bounce)
      const hemi = E.hemi;
      if (hemi) {
        _c1.copy(COL.hemiDay).lerp(COL.hemiGold, gold * 0.55).lerp(COL.hemiNight, 1 - dayK);
        if (grey > 0) { _c2.copy(_greyCol).multiplyScalar(light); _c1.lerp(_c2, grey * 0.55); }
        hemi.color.copy(_c1);
        _c2.copy(COL.groundDay).lerp(COL.groundNight, 1 - dayK);
        const snowW = this.mix.SNOW || 0;
        if (snowW > 0) { _c3.copy(COL.groundSnow).multiplyScalar(light); _c2.lerp(_c3, snowW * 0.6); }
        hemi.groundColor.copy(_c2);
        hemi.intensity = lerp(0.52, 0.86, dayK) * m.hemi;
      }
      if (E.fill) {
        E.fill.intensity = lerp(0.06, 0.35, dayK) * (1 - 0.4 * grey);
        E.fill.color.copy(COL.fillDay).lerp(COL.fillNight, 1 - dayK);
      }
      // ---- fog (also the horizon colour of the sky overlay -> seamless haze)
      _fogCol.copy(COL.fogDay).lerp(COL.fogGold, gold * 0.7).lerp(COL.fogNight, 1 - dayK);
      if (grey > 0) { _c2.copy(_greyCol).multiplyScalar(light); if (gold > 0) _c2.lerp(COL.fogGold, gold * 0.25 * light); _fogCol.lerp(_c2, grey); }
      const fog = E.scene.fog;
      if (fog) {
        fog.color.copy(_fogCol);
        if (fog.isFogExp2) fog.density = m.fog * lerp(1.12, 1, dayK);
        else { fog.near = 10; fog.far = clamp(2.2 / Math.max(0.0005, m.fog), 60, 1500); }
      }
      if (E.scene.background && E.scene.background.isColor) E.scene.background.copy(_fogCol);
      // ---- Preetham sky
      if (E.sky) {
        const u = E.sky.material.uniforms;
        u.turbidity.value = 5.5 + gold * 2.6 + m.turb;
        u.rayleigh.value = 1.5 + gold * 1.4 + m.ray;
        u.mieCoefficient.value = 0.004 + m.mie;
        u.mieDirectionalG.value = 0.82;
      }
      // ---- exposure
      if (E.renderer) E.renderer.toneMappingExposure = lerp(0.95, 0.88, dayK) * m.exp * (1 + 0.05 * gold);
      // lens flare only under a clear sky
      E.flareSuppressed = grey > 0.3;

      // ---- sky overlay (night sky + overcast / fog veil, horizon == fog colour)
      const ov = this._overlay;
      if (ov) {
        const u = ov.material.uniforms;
        u.uHorizon.value.copy(_fogCol);
        u.uZenith.value.copy(_fogCol).lerp(COL.zenithTwilight, twK * (1 - grey)).lerp(COL.zenithNight, nightK * (1 - grey * 0.85));
        const haze = m.haze * dayK * (1 - grey);
        u.uAH.value = Math.max(haze, grey, nightK * 0.95, twK * 0.55);
        u.uAT.value = Math.max(grey * 0.93, nightK * 0.9, twK * 0.7);
        u.uBand.value = lerp(0.1, 0.6, Math.max(grey, nightK * 0.8, twK * 0.7));
        u.uSunDir.value.copy(E.sunDir);
        u.uGlow.value.copy(COL.glowSunset).lerp(COL.glowDusk, smooth(1, -6, e));
        u.uGlowAmt.value = glowK * (1 - grey) * 0.9;
        ov.visible = u.uAH.value > 0.004 || u.uAT.value > 0.004 || u.uGlowAmt.value > 0.004;
        ov.renderOrder = grey > 0.45 ? -3 : -9; // heavy overcast also veils the clouds
        if (this._envOverlay) this._envOverlay.visible = ov.visible;
      }
      const cam = E.camera;
      if (this._fx && cam) this._fx.position.copy(cam.position);
      // ---- stars & moon
      const clearNight = (1 - grey) * (1 - smooth(0.7, 1, m.cover) * 0.6);
      if (this._stars) {
        const a = smooth(0.35, 0.9, nightK) * clearNight;
        this._stars.visible = a > 0.01;
        this._stars.material.uniforms.uAlpha.value = a;
        this._stars.material.uniforms.uTime.value = t;
      }
      if (this._moon) {
        const a = smooth(0.15, 0.7, nightK) * (1 - grey * 0.92);
        this._moon.visible = a > 0.01;
        this._moon.material.opacity = a;
        this._moon.position.copy(_moonDir).multiplyScalar(1900);
      }
      // ---- clouds & wind (nature module)
      const N = G.sys.nature;
      if (N) {
        try {
          N.setCloudCover?.(clamp(m.cover, 0, 1));
          _c1.copy(_tint).lerp(COL.goldTint, gold * 0.6).lerp(COL.nightTint, nightK * 0.75);
          N.setCloudTint?.(_c1);
          N.setWind?.(0.86, 0.5, m.wind);
        } catch (err) { /* optional */ }
      }
      // ---- night materials & lights (lanterns, windows) — lamps also glow on dark rainy days
      const lampK = clamp(Math.max(1 - smooth(-3, 5, e), m.lamp * dayK), 0, 1);
      const W = G.world;
      const nCount = (W.nightMaterials?.length || 0) * 1000 + (W.nightLights?.length || 0);
      if (force || Math.abs(lampK - this._lampK) > 0.002 || nCount !== this._lampCount) {
        this._lampK = lampK;
        this._lampCount = nCount; // materials registered later (e.g. a module built after us) get the current glow too
        for (const nm of W.nightMaterials || []) {
          if (nm && nm.material) nm.material.emissiveIntensity = lerp(nm.day ?? 0, nm.night ?? 1.5, lampK);
        }
        for (const nl of W.nightLights || []) {
          if (nl && nl.light) nl.light.intensity = (nl.intensity ?? 1) * lampK;
        }
      }
      // ---- precipitation
      this._updatePrecip(dt, t, dayK, cam);
    },

    _inTransition() {
      for (const id of IDS) { const v = this.mix[id]; if (v > 0.001 && v < 0.999) return true; }
      return false;
    },

    _updatePrecip(dt, t, dayK, cam) {
      const rainI = this.mix.RAIN || 0, snowI = this.mix.SNOW || 0;
      this.precipitation.rain = rainI; this.precipitation.snow = snowI;
      if (!cam) return;
      // camera-forward biased centre so most drops are in view
      _fwd.set(0, 0, -1).applyQuaternion(cam.quaternion); _fwd.y = 0;
      if (_fwd.lengthSq() < 1e-6) _fwd.set(0, 0, -1); else _fwd.normalize();
      const tt = t % 600;
      const r = this._rain;
      if (r) {
        r.visible = rainI > 0.01;
        if (r.visible) {
          const u = r.material.uniforms;
          u.uTime.value = tt;
          u.uIntensity.value = rainI;
          u.uCenter.value.set(cam.position.x + _fwd.x * 6, cam.position.y + 3, cam.position.z + _fwd.z * 6);
          u.uColor.value.copy(COL.rainNight).lerp(COL.rainDay, dayK);
          u.uOpacity.value = lerp(0.32, 0.46, dayK);
        }
      }
      const s = this._snow;
      if (s) {
        s.visible = snowI > 0.01;
        if (s.visible) {
          const u = s.material.uniforms;
          u.uTime.value = tt;
          u.uIntensity.value = snowI;
          u.uCenter.value.set(cam.position.x + _fwd.x * 7, cam.position.y + 4, cam.position.z + _fwd.z * 7);
          u.uColor.value.copy(COL.snowNight).lerp(COL.snowDay, dayK);
          u.uOpacity.value = lerp(0.75, 0.95, dayK);
        }
      }
      const sp = this._splash;
      if (sp) {
        sp.visible = rainI > 0.05;
        if (sp.visible) {
          const u = sp.material.uniforms;
          u.uTime.value = t;
          u.uOpacity.value = lerp(0.25, 0.55, dayK) * rainI;
          const pl = G.sys.player;
          const c = this._splashCenter;
          if (pl && pl.position && pl.object?.visible !== false) c.copy(pl.position); else c.set(cam.position.x + _fwd.x * 8, 0, cam.position.z + _fwd.z * 8);
          const attr = sp.geometry.attributes.aSplash, arr = attr.array, n = attr.count;
          const life = u.uLife.value;
          const W = G.world, wy = G.data.layout?.waterY ?? -1.1;
          // respawn a few finished splashes per frame (density follows the rain intensity)
          let changed = false, budget = Math.ceil(n * dt / life * 1.2) + 2;
          for (let k = 0; k < n && budget > 0; k++) {
            const i = (this._splashI + k) % n;
            if (t - arr[i * 4 + 3] < life + Math.random() * 0.15) continue;
            budget--;
            if (Math.random() > rainI) { arr[i * 4 + 3] = t; arr[i * 4 + 1] = -9999; changed = true; continue; }
            const a = Math.random() * PI * 2, d = Math.sqrt(Math.random()) * 13;
            const x = c.x + Math.cos(a) * d + _fwd.x * 3, z = c.z + Math.sin(a) * d + _fwd.z * 3;
            let y;
            try { y = W.isWater(x, z) ? wy + 0.03 : W.surfaceHeight(x, z) + 0.035; } catch (e) { y = c.y + 0.03; }
            arr[i * 4] = x; arr[i * 4 + 1] = Number.isFinite(y) ? y : -9999; arr[i * 4 + 2] = z; arr[i * 4 + 3] = t - Math.random() * 0.05;
            changed = true;
          }
          this._splashI = (this._splashI + 7) % n;
          if (changed) attr.needsUpdate = true;
        }
      }
    },

    _onResize() {
      const E = G.sys.engine;
      if (!E || !E.renderer) return;
      const pr = E.renderer.getPixelRatio() || 1;
      if (this._stars) this._stars.material.uniforms.uPR.value = pr * clamp(window.innerHeight / 900, 0.75, 1.5);
      if (this._snow) {
        const fov = (E.camera?.fov || 55) * DEG;
        this._snow.material.uniforms.uScale.value = (window.innerHeight * pr * 0.5) / Math.tan(fov / 2);
      }
    },

    // ------------------------------------------------------------ temperature / humidity
    _updateTemp() {
      const d = new Date(G.time.now());
      const mo = d.getMonth();
      const tMax = CLIMATE.max[mo], tMin = CLIMATE.min[mo];
      const m = this._mixLook();
      const grey = clamp(m.grey, 0, 1);
      // diurnal curve: warmest ~14:30, coldest before sunrise; overcast skies damp the swing
      const diurnal = 0.5 + 0.5 * Math.cos((2 * PI * (this._hour - 14.5)) / 24);
      const mid = (tMax + tMin) / 2, amp = (tMax - tMin) / 2 * (1 - 0.45 * grey);
      let temp = mid + amp * (diurnal * 2 - 1);
      // snow never falls at summer temperatures: clamp toward freezing by the snow weight
      let mod = 0;
      for (const id of IDS) {
        const w = this.mix[id];
        if (!w) continue;
        let tm = G.data.weather?.[id]?.tempMod ?? 0;
        if (id === 'SNOW') tm = Math.min(temp + tm, -0.5) - temp;
        mod += tm * w;
      }
      temp += mod;
      let hum = m.hum + CLIMATE.hum[mo] + 9 * Math.cos((2 * PI * (this._hour - 4)) / 24) - 2;
      this.temperature = Math.round(temp * 10) / 10;
      this.humidity = Math.round(clamp(hum, 18, 100));
    },

    // ------------------------------------------------------------ HUD (bottom bar)
    _updateHud(force) {
      const iconName = this.icon();
      const tempTxt = `${Math.round(this.temperature)}°C`;
      const name = G.data.weather?.[this.current]?.name || '맑음';
      const key = iconName + '|' + tempTxt + '|' + name + '|' + this.phase;
      if (!force && key === this._hudKey) return;
      this._hudKey = key;
      const ic = document.getElementById('weather-icon');
      if (ic && ic.dataset.iconDone !== iconName) G.ui.setIcon(ic, iconName);
      if (ic) ic.dataset.wx = this.current.toLowerCase();
      const tp = document.getElementById('weather-temp');
      if (tp) tp.textContent = tempTxt;
      const btn = document.querySelector('#bottom-bar [data-action="weather"]');
      if (btn) {
        btn.title = `${name} · ${tempTxt} · 습도 ${this.humidity}% · ${this.timeString()} (${this.phaseName})`;
        btn.setAttribute('aria-label', `날씨: ${name}, ${tempTxt}, ${this.phaseName}`);
        btn.dataset.phase = this.phase.toLowerCase();
      }
    },

    // ------------------------------------------------------------ popover
    openPopover(anchor) {
      anchor = anchor || document.querySelector('#bottom-bar [data-action="weather"]');
      if (!anchor) return null;
      const el = this._buildPopover();
      const p = G.ui.popover.open(anchor, el, { id: 'weather', placement: 'top', className: 'wx-popover', onClose: () => { if (this._pop === p) this._pop = null; } });
      if (!p) { this._pop = null; return null; }
      this._pop = p;
      this._popEl = el;
      this._refreshPopover(true);
      p.reposition?.();
      return p;
    },

    _buildPopover() {
      const h = G.ui.h;
      const picks = IDS.map((id) => {
        const d = G.data.weather?.[id] || { name: id, icon: 'sun' };
        const b = h('button', { type: 'button', class: 'wx-pick', dataset: { wxPick: id }, title: d.name, 'aria-pressed': 'false' },
          h('span', { class: 'ico', 'data-icon': d.icon }), h('span', { class: 'wx-pick-name' }, d.name));
        b.style.setProperty('--wx', PICK_COLORS[id]);
        return b;
      });
      const phaseTicks = [[2.5, '밤'], [6.5, '아침'], [12.5, '낮'], [18.5, '저녁'], [22, '밤']]
        .map(([hr, label]) => h('span', { style: { left: `${(hr / 24) * 100}%` } }, label));
      const quick = [[6.5, '아침', 'sun'], [12, '낮', 'sun'], [18.6, '저녁', 'cloud-sun'], [22, '밤', 'moon']]
        .map(([hr, label, ic]) => h('button', { type: 'button', class: 'chip wx-quick', dataset: { wxHour: String(hr) }, title: `${label} ${this.timeString(hr)}로 바꾸기` }, h('span', { class: 'ico ico-xs', 'data-icon': ic }), h('b', null, label), h('small', null, this.timeString(hr))));
      const el = h('div', { class: 'wx-pop' },
        h('div', { class: 'wx-now' },
          h('div', { class: 'wx-now-ico', dataset: { wx: 'icon' } }, h('span', { class: 'ico', 'data-icon': 'sun' })),
          h('div', { class: 'wx-now-main' }, h('b', { dataset: { wx: 'name' } }, '맑음'), h('span', { dataset: { wx: 'sub' } }, '')),
          h('div', { class: 'wx-now-clock' }, h('b', { dataset: { wx: 'clock' } }, '10:30'), h('span', { dataset: { wx: 'phase' } }, '낮'))),
        h('div', { class: 'wx-title' }, '날씨 바꾸기', h('small', { dataset: { wx: 'mode' } }, '')),
        h('div', { class: 'wx-picks' }, picks),
        h('div', { class: 'wx-title' }, '시간', h('small', null, `게임 속 하루 = 실제 ${G.data.time?.dayLengthMinutes || 24}분`)),
        h('div', { class: 'wx-slider' },
          h('input', { type: 'range', min: '0', max: '24', step: '0.25', value: String(this._hour), dataset: { wx: 'hour' }, 'aria-label': '게임 시간' }),
          h('div', { class: 'wx-ticks' }, phaseTicks)),
        h('div', { class: 'wx-quicks' }, quick),
        h('label', { class: 'wx-switch' }, h('input', { type: 'checkbox', dataset: { wx: 'auto' } }), h('span', { class: 'wx-sw' }),
          h('span', { class: 'wx-sw-text' }, h('b', null, '자동 날씨'), h('small', null, '몇 분마다 날씨가 저절로 바뀌어요'))),
        h('label', { class: 'wx-switch' }, h('input', { type: 'checkbox', dataset: { wx: 'lock' } }), h('span', { class: 'wx-sw' }),
          h('span', { class: 'wx-sw-text' }, h('b', null, '시간 고정'), h('small', null, '시계를 멈추고 지금 시간을 유지해요'))),
        h('p', { class: 'wx-note' }, h('span', { class: 'ico ico-xs', 'data-icon': 'jar' }), '기온과 습도는 장독의 발효 환경에 영향을 줘요.'));

      el.addEventListener('click', (ev) => {
        const pick = ev.target.closest('[data-wx-pick]');
        if (pick) {
          const id = pick.dataset.wxPick;
          if (this.auto) G.setSetting('autoWeather', false);
          this.set(id, { source: 'user' });
          const nm = G.data.weather?.[id]?.name || id;
          G.ui.toast(`날씨를 ‘${nm}’${roOf(nm)} 바꿨어요. 자동 날씨는 꺼졌어요.`, { type: 'info', icon: this.icon(id), sound: false, duration: 2200 });
          return;
        }
        const q = ev.target.closest('[data-wx-hour]');
        if (q) { this.setHour(Number(q.dataset.wxHour)); this._refreshPopover(true); }
      });
      const range = el.querySelector('[data-wx="hour"]');
      range.addEventListener('pointerdown', () => { this._dragging = true; });
      const endDrag = () => { this._dragging = false; };
      range.addEventListener('pointerup', endDrag);
      range.addEventListener('change', endDrag);
      range.addEventListener('blur', endDrag);
      range.addEventListener('input', () => { this.setHour(Number(range.value)); this._refreshPopover(false); });
      el.querySelector('[data-wx="auto"]').addEventListener('change', (ev) => G.setSetting('autoWeather', !!ev.target.checked));
      el.querySelector('[data-wx="lock"]').addEventListener('change', (ev) => G.setSetting('lockTime', !!ev.target.checked));
      return el;
    },

    _refreshPopover(force) {
      const el = this._popEl;
      if (!el || !this._pop || this._pop.closed) return;
      const q = (k) => el.querySelector(`[data-wx="${k}"]`);
      const d = G.data.weather?.[this.current] || { name: '맑음' };
      const icoBox = q('icon');
      const ic = icoBox?.querySelector('.ico');
      const iconName = this.icon();
      if (ic && ic.dataset.iconDone !== iconName) G.ui.setIcon(ic, iconName);
      if (icoBox) icoBox.style.setProperty('--wx', PICK_COLORS[this.current]);
      const setT = (k, v) => { const n = q(k); if (n && n.textContent !== v) n.textContent = v; };
      setT('name', d.name);
      setT('sub', `${this.temperature.toFixed(1)}°C · 습도 ${this.humidity}%`);
      setT('clock', this.timeString());
      setT('phase', this.phaseName + (this.lockTime ? ' · 고정' : ''));
      setT('mode', this.auto ? '자동' : '직접 선택');
      for (const b of el.querySelectorAll('[data-wx-pick]')) {
        const on = b.dataset.wxPick === this.current;
        b.classList.toggle('active', on);
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
      }
      const range = q('hour');
      if (range && (force || !this._dragging)) range.value = String(Math.round(this._hour * 4) / 4);
      const au = q('auto'); if (au) au.checked = this.auto;
      const lk = q('lock'); if (lk) lk.checked = this.lockTime;
    },

    _persist() {
      const p = this._prefs || (this._prefs = {});
      p.weather = this.auto ? null : this.current;
      p.hour = this.lockTime ? Math.round(this._hour * 100) / 100 : null;
      savePrefs(p);
    },
  };

  function phaseOf(h) {
    h = wrap24(h);
    const list = G.data.dayPhases || [];
    for (const p of list) {
      if ((h >= p.from && h < p.to) || (h + 24 >= p.from && h + 24 < p.to)) return p;
    }
    return list[0] || { id: 'DAY', name: '낮', from: 0, to: 24 };
  }

  G.register(WX);
})();
