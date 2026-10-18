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
//     temperature (°C), humidity (%), nightFactor, isNight, precipitation {rain, snow}, wetness (0..1 after rain)
//     sunElevation / sunAzimuth (deg), timeString(h?) -> '10:30', icon(), openPopover(anchor)
//   Emits weather:changed {id, prev, source}, time:phase {phase, prev, name}.
//   쉬운 모드 (CONTRACT §12): a 🌤️ 날씨 button joins the kid bottom bar (#easy-wx-btn, easy-only) and the
//   popover becomes a picture card — a big animated weather picture + one sentence (read aloud) + a feeling
//   word instead of °C, 5 big weather tiles and 4 time-of-day tiles (아침/낮/저녁/밤). Weather is per device
//   (local), so a child's change never affects anyone else.
//   Drives engine.setSun, Preetham sky uniforms, scene.fog, hemi / sun / fill lights, the colour grade
//   (engine.grade: exposure, contrast, saturation, warmth, vignette, shadow lift / highlight gain by time and weather),
//   sun glow + god-ray strength (engine.atmos), G.world.nightFactor, G.world.nightMaterials / nightLights,
//   nature clouds & wind, water ripples / flow speed (G.sys.water.uniforms.uRain / uFlowSpeed).
//   Phase 4 atmosphere: soft lightning in heavy rain (one slow eased glow, never faster than ~0.6 Hz, off with
//   reduceMotion / fxLevel 'off'), a rainbow opposite the sun after rain (weather:rainbow {on}), shimmering
//   puddles on paths and the plaza that fill with rain and dry afterwards (medium / high), sunrise / sunset
//   twilight bands (warm horizon, pink anti-twilight arch), a shooting star now and then on clear nights
//   (weather:shootingstar). this.lightning (0..1), this.rainbow (0..1).
//   Per-device persistence: manual weather (auto off) and the locked hour.
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
    CLEAR: { cover: 0.36, tint: '#ffffff', sun: 1.0, hemi: 1.0, fog: 0.0026, grey: 0.0, greyCol: '#c4d0da', turb: -1.3, ray: 0.25, mie: 0, exp: 1.0, wind: 0.9, lamp: 0, haze: 0.2, sat: 1.1, con: 1.06, warm: 0.02, vig: 0.2 },
    CLOUDY: { cover: 0.84, tint: '#d4d9df', sun: 0.42, hemi: 1.12, fog: 0.0036, grey: 0.42, greyCol: '#b6bfc8', turb: 4.5, ray: 0.5, mie: 0.004, exp: 0.98, wind: 1.25, lamp: 0.1, haze: 0.3, sat: 1.0, con: 1.03, warm: -0.03, vig: 0.22 },
    RAIN: { cover: 1.0, tint: '#9aa2ac', sun: 0.16, hemi: 0.84, fog: 0.0072, grey: 0.84, greyCol: '#86909a', turb: 9, ray: 1.0, mie: 0.01, exp: 0.95, wind: 1.8, lamp: 0.42, haze: 0.4, sat: 0.86, con: 1.02, warm: -0.12, vig: 0.3 },
    FOG: { cover: 0.3, tint: '#eef1f3', sun: 0.32, hemi: 1.06, fog: 0.021, grey: 0.97, greyCol: '#c3cacf', turb: 10, ray: 0.8, mie: 0.012, exp: 1.0, wind: 0.25, lamp: 0.36, haze: 0.5, sat: 0.88, con: 0.94, warm: -0.04, vig: 0.24 },
    SNOW: { cover: 0.96, tint: '#eef1f5', sun: 0.36, hemi: 1.2, fog: 0.0062, grey: 0.74, greyCol: '#d0d7df', turb: 8, ray: 0.6, mie: 0.008, exp: 1.0, wind: 0.6, lamp: 0.26, haze: 0.45, sat: 0.9, con: 1.0, warm: -0.14, vig: 0.22 },
  };
  // monthly climate of a Gangwon mountain valley (°C daily max / min, humidity offset %)
  const CLIMATE = {
    max: [1, 4, 10, 18, 23, 27, 29, 29, 25, 19, 11, 3],
    min: [-11, -8, -3, 3, 9, 15, 20, 20, 13, 5, -1, -8],
    hum: [-10, -8, -6, -4, 0, 6, 10, 10, 4, 0, -4, -8],
  };
  const PICK_COLORS = { CLEAR: '#ffd23f', CLOUDY: '#c9d3dc', RAIN: '#6fb9ff', FOG: '#d7dde2', SNOW: '#dff0ff' };
  // kid picture card (easy mode)
  const KID_WX = {
    CLEAR: { emoji: '☀️', night: '🌙', label: '맑음', line: '해님이 반짝반짝 웃어요!', nightLine: '달님이 떴어요. 별도 반짝반짝해요!', pick: '해님아, 나와라!' },
    CLOUDY: { emoji: '☁️', label: '구름', line: '구름이 몽실몽실 떠 있어요.', pick: '구름이 몽실몽실 와요!' },
    RAIN: { emoji: '🌧️', label: '비', line: '비가 주룩주룩 내려요. 우산을 써요!', pick: '비가 주룩주룩 내려요!' },
    FOG: { emoji: '🌫️', label: '안개', line: '안개가 뿌옇게 꼈어요. 천천히 걸어요.', pick: '안개가 스르르 와요!' },
    SNOW: { emoji: '❄️', label: '눈', line: '하얀 눈이 펑펑 내려요!', pick: '눈이 펑펑 내려요!' },
  };
  const KID_TIMES = [
    { h: 6.5, emoji: '🌅', label: '아침', say: '아침이에요. 해가 떠요!' },
    { h: 12, emoji: '🌞', label: '낮', say: '낮이에요. 신나게 놀아요!' },
    { h: 18.6, emoji: '🌇', label: '저녁', say: '저녁이에요. 노을이 예뻐요!' },
    { h: 22, emoji: '🌙', label: '밤', say: '밤이에요. 별을 찾아봐요!' },
  ];
  const easyOn = () => (G.easy ? !!G.easy.on : G.settings?.easyMode !== false);
  const kidSay = (text, opts) => { try { return G.easy?.say?.(text, opts); } catch (e) { return null; } };
  /** a feeling word instead of a number (°C) for small children */
  function feelWord(t) {
    if (!Number.isFinite(t)) return { emoji: '😊', word: '기분 좋은 날씨예요' };
    if (t <= 0) return { emoji: '🥶', word: '꽁꽁 추워요' };
    if (t <= 10) return { emoji: '🧣', word: '조금 추워요' };
    if (t <= 20) return { emoji: '🍃', word: '시원해요' };
    if (t <= 27) return { emoji: '😊', word: '따뜻해요' };
    return { emoji: '🥵', word: '더워요' };
  }

  // ---------------------------------------------------------------- colours (linear working space)
  const C = (hex) => new THREE.Color(hex);
  const COL = {
    sunNoon: C('#ffeed4'), sunGold: C('#ffa25a'), moon: C('#a9bdff'),
    hemiDay: C('#d3e3f6'), hemiGold: C('#ffd2a8'), hemiNight: C('#4b6290'),
    groundDay: C('#66683c'), groundNight: C('#1d2621'), groundSnow: C('#c9d0d6'),
    fogDay: C('#bcd6e8'), fogGold: C('#efbf92'), fogNight: C('#1b2840'),
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
  const _mixed = { cover: 0, sun: 0, hemi: 0, fog: 0, grey: 0, turb: 0, ray: 0, mie: 0, exp: 0, wind: 0, lamp: 0, haze: 0, tempMod: 0, hum: 0, sat: 0, con: 0, warm: 0, vig: 0 };
  const _lift = new THREE.Color(), _gain = new THREE.Color(), _gradeArg = { exposure: 1, contrast: 1, saturation: 1, warmth: 0, vignette: 0.2, lift: _lift, gain: _gain, instant: false };
  const _flashArg = { flash: 0, exposure: 1 };

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
    uniform vec3 uSunDir; uniform vec3 uGlow; uniform float uGlowAmt; uniform float uBelt; uniform float uRainbow;
    varying vec3 vDir;
    vec3 tfSpectrum(float x) { // 0 = violet .. 1 = red
      float h = (1.0 - clamp(x, 0.0, 1.0)) * 0.76;
      return clamp(abs(fract(vec3(h) + vec3(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0) - 1.0, 0.0, 1.0);
    }
    void main() {
      float dl = length(vDir);
      vec3 d = dl > 1e-6 ? vDir / dl : vec3(0.0, 1.0, 0.0);
      float k = smoothstep(-0.03, uBand, d.y);
      vec3 col = mix(uHorizon, uZenith, k);
      float a = mix(uAH, uAT, k);
      // warm twilight glow above the horizon on the sun side
      vec2 sxz = uSunDir.xz, dxz = d.xz;
      float sl = length(sxz), dlh = length(dxz);
      vec2 sh = sl > 1e-5 ? sxz / sl : vec2(0.0, 1.0);
      vec2 dh = dlh > 1e-5 ? dxz / dlh : vec2(0.0, 1.0);
      float sunSide = dot(dh, sh);
      float g = pow(max(sunSide, 0.0), 3.0) * (1.0 - smoothstep(-0.02, 0.42, d.y)) * uGlowAmt;
      col = mix(col, uGlow, clamp(g * 1.15, 0.0, 1.0));
      a = max(a, g);
      // anti-twilight arch (pink) over the earth's shadow (blue-grey) opposite the sun
      if (uBelt > 0.001) {
        float anti = pow(max(-sunSide, 0.0), 1.6);
        float belt = smoothstep(0.015, 0.09, d.y) * (1.0 - smoothstep(0.1, 0.32, d.y)) * anti * uBelt;
        float shade = (1.0 - smoothstep(0.0, 0.06, d.y)) * anti * uBelt;
        col = mix(col, vec3(0.86, 0.58, 0.66), clamp(belt * 0.85, 0.0, 1.0));
        col = mix(col, vec3(0.34, 0.4, 0.56), clamp(shade * 0.55, 0.0, 1.0));
        a = max(a, max(belt * 0.75, shade * 0.5));
      }
      // rainbow: primary bow at ~41-42 deg around the antisolar point, faint reversed secondary at ~51 deg
      if (uRainbow > 0.001) {
        float cosA = clamp(dot(d, -uSunDir), -1.0, 1.0);
        float ang = acos(cosA) * 57.29578;
        float x1 = (ang - 40.3) / 2.3, x2 = 1.0 - (ang - 50.2) / 3.4;
        float b1 = smoothstep(-0.05, 0.25, x1) * (1.0 - smoothstep(0.75, 1.05, x1));
        float b2 = smoothstep(-0.05, 0.25, x2) * (1.0 - smoothstep(0.75, 1.05, x2)) * 0.32;
        float ground = smoothstep(0.0, 0.1, d.y);
        float ra = (b1 + b2) * uRainbow * 0.42 * ground;
        if (ra > 0.0005) {
          vec3 rc = b1 >= b2 ? tfSpectrum(x1) : tfSpectrum(x2);
          float na = a + ra * (1.0 - a);
          col = (col * a + rc * ra * (1.0 - a) + rc * ra * a * 0.6) / max(na, 1e-4);
          a = clamp(na, 0.0, 1.0);
        }
      }
      gl_FragColor = vec4(col, a);
      #include <colorspace_fragment>
    }`;

  function buildOverlay() {
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uHorizon: { value: new THREE.Color(0xbcd6e8) }, uZenith: { value: new THREE.Color(0xbcd6e8) },
        uAH: { value: 0 }, uAT: { value: 0 }, uBand: { value: 0.12 },
        uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uGlow: { value: new THREE.Color(0xff9a5c) }, uGlowAmt: { value: 0 },
        uBelt: { value: 0 }, uRainbow: { value: 0 },
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

  /** one shooting star: a thin additive streak on the sky dome (head bright, tail fading) */
  function buildMeteor() {
    const geo = new THREE.PlaneGeometry(1, 1);
    const mat = new THREE.ShaderMaterial({
      uniforms: { uA: { value: new THREE.Vector3() }, uB: { value: new THREE.Vector3() }, uT: { value: 0 }, uAlpha: { value: 0 } },
      vertexShader: `
        uniform vec3 uA; uniform vec3 uB; uniform float uT;
        varying vec2 vUv;
        void main() {
          // the streak runs from the tail (behind) to the head (uT along A->B), 9 % of the path long
          float head = uT, tail = max(0.0, uT - 0.09);
          vec3 p0 = (modelMatrix * vec4(mix(uA, uB, tail), 1.0)).xyz, p1 = (modelMatrix * vec4(mix(uA, uB, head), 1.0)).xyz;
          vec3 c = mix(p0, p1, position.x + 0.5);
          vec3 dir = p1 - p0; float dl = length(dir);
          dir = dl > 1e-4 ? dir / dl : vec3(1.0, 0.0, 0.0);
          vec3 toCam = cameraPosition - c; float tl = length(toCam);
          toCam = tl > 1e-4 ? toCam / tl : vec3(0.0, 0.0, 1.0);
          vec3 side = cross(dir, toCam); float sl = length(side);
          side = sl > 1e-4 ? side / sl : vec3(0.0, 1.0, 0.0);
          c += side * position.y * 3.2;
          vUv = uv;
          gl_Position = projectionMatrix * viewMatrix * vec4(c, 1.0);
        }`,
      fragmentShader: `
        uniform float uAlpha; varying vec2 vUv;
        void main() {
          float along = vUv.x;                 // 0 tail .. 1 head
          float across = 1.0 - abs(vUv.y - 0.5) * 2.0;
          float a = along * along * across * across * uAlpha;
          if (a < 0.004) discard;
          gl_FragColor = vec4(vec3(0.85, 0.9, 1.0) * a, a);
          #include <colorspace_fragment>
        }`,
      transparent: true, depthWrite: false, depthTest: true, fog: false, blending: THREE.AdditiveBlending,
    });
    const m = new THREE.Mesh(geo, mat);
    m.frustumCulled = false; m.renderOrder = -7; m.name = 'shooting-star'; m.visible = false;
    m.raycast = () => {};
    return m;
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
          vec3 tc = cameraPosition - p; float tcl = length(tc);
          vec3 toCam = tcl > 1e-4 ? tc / tcl : vec3(0.0, 0.0, 1.0);
          vec3 sd = cross(axis, toCam); float sdl = length(sd);
          vec3 side = sdl > 1e-4 ? sd / sdl : vec3(1.0, 0.0, 0.0);
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
          float ring = smoothstep(0.62, 0.8, r) * (1.0 - smoothstep(0.84, 0.98, r));
          float core = (1.0 - smoothstep(0.0, 0.3, r)) * (1.0 - smoothstep(0.0, 0.25, vAge));
          float fade = 1.0 - vAge;
          float a = (ring * 0.8 * fade + core) * fade * uOpacity;
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

  // ================================================================= puddles (medium / high): fill with rain, dry afterwards
  const PUDDLE_VS = `
    attribute vec4 aPud; attribute vec4 aPud2;
    varying vec2 vLocal; varying vec3 vW; varying float vSeed;
    #include <fog_pars_vertex>
    void main() {
      float c = cos(aPud2.x), s = sin(aPud2.x);
      vec2 p = position.xz * aPud.w * vec2(aPud2.y, 1.0);
      p = vec2(c * p.x - s * p.y, s * p.x + c * p.y);
      vec3 w = vec3(aPud.x + p.x, aPud.y, aPud.z + p.y);
      vLocal = position.xz; vW = w; vSeed = aPud2.z;
      vec4 mvPosition = viewMatrix * vec4(w, 1.0);
      gl_Position = projectionMatrix * mvPosition;
      #include <fog_vertex>
    }`;
  const PUDDLE_FS = `
    uniform float uWet; uniform float uRain; uniform float uTime; uniform vec3 uSky; uniform vec3 uHor; uniform vec3 uSunCol; uniform vec3 uSunDir;
    varying vec2 vLocal; varying vec3 vW; varying float vSeed;
    #include <fog_pars_fragment>
    float pHash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
    float pNoise(vec2 p) { vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
      return mix(mix(pHash(i), pHash(i + vec2(1.0, 0.0)), u.x), mix(pHash(i + vec2(0.0, 1.0)), pHash(i + vec2(1.0, 1.0)), u.x), u.y); }
    void main() {
      float r = length(vLocal);
      float n = pNoise(vLocal * 2.3 + vSeed * 17.0) * 0.45 + pNoise(vLocal * 5.1 - vSeed * 9.0) * 0.2;
      float fill = mix(0.2, 0.92, uWet);
      float mask = 1.0 - smoothstep(fill - 0.14, fill, r + n * 0.5);
      if (mask < 0.01) discard;
      // raindrop rings: two staggered cell layers, each cell one expanding ring per cycle
      vec2 nrm = vec2(0.0);
      if (uRain > 0.01) {
        for (int k = 0; k < 2; k++) {
          vec2 q = vW.xz * 2.1 + float(k) * vec2(0.37, 0.61);
          vec2 cell = floor(q);
          vec2 loc = fract(q) - 0.5 - (vec2(pHash(cell), pHash(cell + 7.1)) - 0.5) * 0.5;
          float ph = fract(uTime * (0.75 + pHash(cell + 3.3) * 0.5) + pHash(cell + 1.7));
          float d = length(loc);
          float re = (d - ph * 0.42) * 30.0;
          float ring = exp(-re * re) * (1.0 - ph) * uRain;
          nrm += (d > 1e-4 ? loc / d : vec2(0.0)) * ring;
        }
      }
      vec3 N = normalize(vec3(nrm.x * 0.5, 1.0, nrm.y * 0.5));
      vec3 vv = cameraPosition - vW; float vl = length(vv);
      vec3 V = vl > 1e-5 ? vv / vl : vec3(0.0, 1.0, 0.0);
      float fres = 0.04 + 0.96 * pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 5.0);
      vec3 R = reflect(-V, N);
      vec3 refl = mix(uHor, uSky, smoothstep(0.0, 0.55, R.y));
      float spec = pow(max(dot(R, uSunDir), 0.0), 160.0) * 2.5;
      // looking down a puddle mostly darkens the stone (wet, absorbing); towards grazing angles it mirrors the sky
      vec3 col = mix(uHor * 0.07, refl, clamp(fres * 1.7, 0.0, 1.0)) + uSunCol * spec;
      float a = mask * (0.4 + 0.5 * fres) * clamp(uWet * 1.4, 0.0, 1.0);
      gl_FragColor = vec4(col, a);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
      #include <fog_fragment>
    }`;
  function buildPuddles(count) {
    const L = G.data.layout || {};
    const W = G.world;
    const rnd = U.rng(3434);
    const lines = [...(L.paths || []), ...(L.roads || [])].filter((p) => Array.isArray(p.points) && p.points.length > 1 && !p.elevated);
    const spots = [];
    const flat = (x, z, r) => {
      const h0 = W.surfaceHeight(x, z);
      if (!Number.isFinite(h0) || h0 - W.terrainHeight(x, z) > 0.1) return null; // not on decks / building platforms
      let lo = h0, hi = h0;
      for (const [dx, dz] of [[r, 0], [-r, 0], [0, r], [0, -r]]) { const h = W.surfaceHeight(x + dx, z + dz); if (!Number.isFinite(h)) return null; lo = Math.min(lo, h); hi = Math.max(hi, h); }
      return hi - lo < 0.05 ? h0 : null;
    };
    for (let i = 0; i < count * 40 && spots.length < count; i++) {
      let x, z;
      if (L.plaza && rnd() < 0.35) { const a = rnd() * PI * 2, d = Math.sqrt(rnd()) * (L.plaza.r - 1); x = L.plaza.x + Math.sin(a) * d; z = L.plaza.z + Math.cos(a) * d; }
      else if (lines.length) {
        const ln = lines[Math.floor(rnd() * lines.length)], pts = ln.points, k = Math.floor(rnd() * (pts.length - 1));
        const t = rnd(), ax = pts[k][0], az = pts[k][1], bx = pts[k + 1][0], bz = pts[k + 1][1];
        const len = Math.hypot(bx - ax, bz - az) || 1, off = (rnd() - 0.5) * (ln.width || 3) * 0.6;
        x = ax + (bx - ax) * t + (-(bz - az) / len) * off; z = az + (bz - az) * t + ((bx - ax) / len) * off;
      } else break;
      if (Math.abs(x) > 130 || Math.abs(z) > 130 || W.isWater(x, z)) continue;
      const sf = W.surfaceAt(x, z);
      if (sf !== 'stone' && sf !== 'dirt' && sf !== 'road') continue;
      const r = 0.55 + rnd() * rnd() * 1.3;
      const y = flat(x, z, r * 1.1);
      if (y == null) continue;
      if (spots.some((p) => Math.hypot(p[0] - x, p[2] - z) < p[3] + r + 0.6)) continue;
      spots.push([x, y + 0.016, z, r, rnd() * PI * 2, 0.65 + rnd() * 0.75, rnd()]);
    }
    if (!spots.length) return null;
    const plane = new THREE.PlaneGeometry(2, 2).rotateX(-PI / 2);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = plane.index;
    geo.setAttribute('position', plane.attributes.position);
    const a1 = new Float32Array(spots.length * 4), a2 = new Float32Array(spots.length * 4);
    spots.forEach((p, i) => { a1.set([p[0], p[1], p[2], p[3]], i * 4); a2.set([p[4], p[5], p[6], 0], i * 4); });
    geo.setAttribute('aPud', new THREE.InstancedBufferAttribute(a1, 4));
    geo.setAttribute('aPud2', new THREE.InstancedBufferAttribute(a2, 4));
    geo.instanceCount = spots.length;
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    plane.dispose();
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
        uWet: { value: 0 }, uRain: { value: 0 }, uTime: { value: 0 }, uSky: { value: new THREE.Color(0x9fb4c8) }, uHor: { value: new THREE.Color(0xbcd6e8) },
        uSunCol: { value: new THREE.Color(0, 0, 0) }, uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      },
      vertexShader: PUDDLE_VS, fragmentShader: PUDDLE_FS,
      transparent: true, depthWrite: false, fog: true,
      polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false; mesh.renderOrder = 2; mesh.name = 'puddles'; mesh.visible = false;
    mesh.raycast = () => {};
    mesh.userData.count = spots.length;
    return mesh;
  }

  // ================================================================= the system
  const WX = {
    name: 'weather', order: 72, label: '날씨와 시간',
    current: 'CLEAR',
    mix: { CLEAR: 1, CLOUDY: 0, RAIN: 0, FOG: 0, SNOW: 0 },
    temperature: 23, humidity: 55,
    nightFactor: 0, sunElevation: 45, sunAzimuth: 160,
    precipitation: { rain: 0, snow: 0 },
    wetness: 0, lightning: 0, rainbow: 0,
    _lt: null, _ltT: 20, _rainbowOn: false, _puddles: null,
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
          if (typeof E.addEnvObject === 'function') {
            const envOv = new THREE.Mesh(this._overlay.geometry, this._overlay.material);
            envOv.scale.setScalar(900); envOv.frustumCulled = false; envOv.renderOrder = -9; envOv.name = 'sky-overlay-env';
            if (E.addEnvObject(envOv) && envOv.parent) this._envOverlay = envOv;
          }
        } catch (e) { G.log.warn('WEATHER', 'sky overlay failed', e); }
        try { this._stars = buildStars(q === 'low' ? 900 : q === 'medium' ? 1500 : 2200); fx.add(this._stars); } catch (e) { G.log.warn('WEATHER', 'stars failed', e); }
        try { this._moon = buildMoon(); fx.add(this._moon); } catch (e) { G.log.warn('WEATHER', 'moon failed', e); }
        try { this._meteor = buildMeteor(); fx.add(this._meteor); } catch (e) { G.log.warn('WEATHER', 'shooting star failed', e); }
        E.scene.add(fx);
        this._fx = fx;
        try { this._rain = buildRain(q === 'low' ? 2600 : q === 'medium' ? 5200 : 8000); E.scene.add(this._rain); } catch (e) { G.log.warn('WEATHER', 'rain failed', e); }
        try { this._splash = buildSplashes(q === 'low' ? 70 : q === 'medium' ? 150 : 230); E.scene.add(this._splash); } catch (e) { G.log.warn('WEATHER', 'splashes failed', e); }
        try { this._snow = buildSnow(q === 'low' ? 2200 : q === 'medium' ? 4200 : 6000); E.scene.add(this._snow); } catch (e) { G.log.warn('WEATHER', 'snow failed', e); }
        this._ensurePuddles();
        this._onResize();
        E.onResize?.(() => this._onResize());
      }

      G.ui.onAction('weather', (el) => this.openPopover(el));
      this._ensureKidButton();
      G.bus.on('easy:changed', () => { this._pop?.close?.(); this._updateHud(true); });
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
      G.bus.on('engine:quality', () => { this._onResize(); this._ensurePuddles(); });
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
      this._updateLightning(dt);
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
        m.sat += L.sat * w; m.con += L.con * w; m.warm += L.warm * w; m.vig += L.vig * w;
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
      const gold = smooth(-5, 2, e) * (1 - smooth(10, 34, e));      // golden hour: the valley's ridges (~16°) hide the low sun, so the warm light starts higher
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
        // a weather blend or a jump (set time / weather) changes the sky itself: re-bake the environment then; a sun
        // that only creeps along its arc re-bakes every few degrees (engine.setSun)
        E.setSun(e, _sun.az, { env: !!(force || trans) });
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
        // overcast skies and moonlight cast soft, faint shadows (no hard black pools under the trees at night)
        if (sun.shadow && 'intensity' in sun.shadow) sun.shadow.intensity = clamp((1 - grey * 0.6) * (e > -1.75 ? 0.92 : 0.5), 0.25, 1);
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
      _fogCol.copy(COL.fogDay).lerp(COL.fogGold, gold * 0.82).lerp(COL.fogNight, 1 - dayK);
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
        // a tighter, dimmer sun halo on clear days keeps blue sky around a low sun (less milky backlight)
        u.mieCoefficient.value = 0.003 + m.mie + gold * 0.0008;
        u.mieDirectionalG.value = 0.85 - grey * 0.04;
      }
      // ---- colour grade (one engine pass on medium / high; exposure on every preset) + sun glow / god rays
      const exposure = lerp(0.95, 0.9, dayK) * m.exp * (1 + 0.06 * gold);
      const wFog = this.mix.FOG || 0, lowLight = 1 - dayK;
      _gradeArg.exposure = exposure;
      _gradeArg.contrast = m.con + gold * 0.04 - lowLight * 0.03;
      _gradeArg.saturation = m.sat * lerp(0.8, 1, dayK) + gold * 0.1 * (1 - grey);
      _gradeArg.warmth = m.warm + gold * 0.5 * (1 - grey * 0.6) + glowK * 0.08 - lowLight * 0.2;
      _gradeArg.vignette = m.vig + lowLight * 0.12 + gold * 0.05;
      // daytime shadow lift: dense far forest floor lit by the sky only sits in the ACES toe and crushed to ~(2,6,3)
      // (S-6); 0.007 keeps it dark green (≥ ~(5,10,7)) for +1 % mean brightness. Night keeps its own cool lift.
      _lift.setRGB(0.007 + gold * 0.004, 0.007 + gold * 0.002, 0.009).lerp(_c1.setRGB(0.002, 0.004, 0.011), lowLight);
      _gain.setRGB(1, 1, 1).lerp(_c1.setRGB(1.05, 1.0, 0.92), gold * (1 - grey)).lerp(_c2.setRGB(0.94, 0.98, 1.07), lowLight * 0.8);
      _gradeArg.instant = !!force;
      if (typeof E.grade === 'function') E.grade(_gradeArg);
      else if (E.renderer) E.renderer.toneMappingExposure = exposure;
      if (E.atmos) {
        E.atmos.sunGlow = (1 - grey) * smooth(-2, 3, e) * (1 - wFog * 0.6);
        E.atmos.rays = (1 - smooth(0.25, 0.75, grey)) * (0.7 + 0.8 * gold) * smooth(-1, 3, e);
      }
      // ---- rainbow: opposite the sun when it shines again after rain (low sun, wet air)
      const rbGoal = smooth(0.18, 0.55, this.wetness) * (1 - smooth(0.04, 0.2, this.mix.RAIN || 0)) * smooth(2, 9, e) * (1 - smooth(34, 44, e))
        * (1 - smooth(0.35, 0.7, grey)) * (1 - wFog) * (1 - (this.mix.SNOW || 0));
      this.rainbow = force ? rbGoal : this.rainbow + (rbGoal - this.rainbow) * (1 - Math.exp(-Math.min(dt || 0, 0.25) / 2.5));
      if (!(this.rainbow >= 0)) this.rainbow = 0;
      const rbOn = this._rainbowOn ? this.rainbow > 0.1 : this.rainbow > 0.25;
      if (rbOn !== !!this._rainbowOn) { this._rainbowOn = rbOn; G.bus.emit('weather:rainbow', { on: rbOn }); }

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
        // twilight: pink anti-twilight arch above the earth's blue shadow on the side opposite the sun
        u.uBelt.value = smooth(-7, -1.5, e) * (1 - smooth(1, 7, e)) * (1 - grey) * 0.85;
        u.uRainbow.value = this.rainbow;
        ov.visible = u.uAH.value > 0.004 || u.uAT.value > 0.004 || u.uGlowAmt.value > 0.004 || u.uBelt.value > 0.004 || u.uRainbow.value > 0.004;
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
      this._updateMeteor(dt, smooth(0.5, 0.95, nightK) * clearNight);
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
          // overcast / fog: clouds melt into the haze (also where they overlap distant mountains)
          N.setCloudVeil?.(clamp(grey * 0.85, 0, 0.92), _fogCol);
          // valley mist: thick at dawn, in fog and after rain, a thin veil on clear afternoons, silvery at night
          const morn = Math.max(0, 1 - Math.abs(this._hour - 6.8) / 2.6);
          N.setMist?.(clamp(0.2 + morn * 0.6 + (this.mix.FOG || 0) * 0.7 + this.wetness * 0.35 + (1 - dayK) * 0.18 + (this.mix.RAIN || 0) * 0.2, 0, 1), _fogCol);
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

    /** heavy rain: now and then ONE slow soft glow lights the clouds (0.4 s rise, 1.4 s fade — never a strobe) */
    _updateLightning(dt) {
      const E = G.sys.engine;
      const rainI = this.mix.RAIN || 0;
      const allowed = rainI > 0.6 && (typeof E?.feature === 'function' ? E.feature('lightning') : !G.settings?.reduceMotion);
      const p = this._lt;
      if (p) {
        p.t += dt;
        const v = p.t < 0.4 ? smooth(0, 0.4, p.t) : 1 - smooth(0.4, 1.8, p.t);
        this.lightning = clamp(v * p.amp * (allowed ? 1 : 0.5), 0, 1);
        if (p.t >= 1.8) { this._lt = null; this.lightning = 0; }
      } else {
        this.lightning = 0;
        if (allowed) {
          this._ltT -= dt;
          if (this._ltT <= 0) { this._lt = { t: 0, amp: 0.3 + Math.random() * 0.25 }; this._ltT = 24 + Math.random() * 32; }
        } else if (this._ltT < 8) this._ltT = 8 + Math.random() * 10;
      }
      const v = this.lightning;
      if (typeof E?.grade === 'function') {
        if (v > 0.001) { _flashArg.flash = v * 0.5; _flashArg.exposure = 1 + v * 0.12; E.grade(_flashArg, 'lightning'); this._ltLayer = true; }
        else if (this._ltLayer) { E.grade(null, 'lightning'); this._ltLayer = false; }
      }
      if (v > 0.001 && E?.hemi) E.hemi.intensity *= 1 + v * 0.45;
      const N = G.sys.nature;
      if (v > 0.001 && N?._cloudTint && typeof N.setCloudTint === 'function') N.setCloudTint(_c3.copy(N._cloudTint).lerp(COL.white, v * 0.45));
    },

    /** clear nights: now and then a shooting star glides across the sky (~1 s; off with reduceMotion) */
    _updateMeteor(dt, skyK) {
      const m = this._meteor;
      if (!m) return;
      const E = G.sys.engine;
      const ok = skyK > 0.5 && (typeof E?.feature === 'function' ? E.feature('lightning') : !G.settings?.reduceMotion);
      const st = this._met || (this._met = { t: -1, wait: 25 + Math.random() * 30 });
      if (st.t >= 0) {
        st.t += (dt || 0) / st.dur;
        const u = m.material.uniforms;
        u.uT.value = Math.min(st.t, 1);
        u.uAlpha.value = skyK * Math.sin(Math.PI * Math.min(st.t, 1)) * 1.3;
        if (st.t >= 1) { st.t = -1; m.visible = false; st.wait = 35 + Math.random() * 55; }
        return;
      }
      if (!ok) return;
      st.wait -= dt || 0;
      if (st.wait > 0) return;
      // a path high in the sky, 25-40 degrees long, gently descending
      const az = Math.random() * PI * 2, el = (38 + Math.random() * 30) * DEG, len = (25 + Math.random() * 15) * DEG, dz = (8 + Math.random() * 10) * DEG;
      const dir = Math.random() < 0.5 ? 1 : -1, R = 1800;
      const pt = (a, e2, out) => out.set(Math.cos(e2) * Math.sin(a) * R, Math.sin(e2) * R, -Math.cos(e2) * Math.cos(a) * R);
      const u = m.material.uniforms;
      pt(az, el, u.uA.value); pt(az + dir * len, el - dz, u.uB.value);
      st.t = 0; st.dur = 0.9 + Math.random() * 0.5;
      u.uT.value = 0; u.uAlpha.value = 0;
      m.visible = true;
      G.bus.emit('weather:shootingstar', {});
    },

    _inTransition() {
      for (const id of IDS) { const v = this.mix[id]; if (v > 0.001 && v < 0.999) return true; }
      return false;
    },

    _updatePrecip(dt, t, dayK, cam) {
      const rainI = this.mix.RAIN || 0, snowI = this.mix.SNOW || 0;
      this.precipitation.rain = rainI; this.precipitation.snow = snowI;
      // ground / stream wetness: soaks up in ~40 s of rain, dries over ~4 min (river swells and runs faster after rain)
      const wetGoal = rainI;
      this.wetness += (wetGoal - this.wetness) * (1 - Math.exp(-(wetGoal > this.wetness ? 1 / 40 : 1 / 240) * Math.min(dt || 0, 0.25)));
      if (!(this.wetness >= 0)) this.wetness = 0;
      const WU = G.sys.water?.uniforms;
      if (WU) {
        if (WU.uRain) WU.uRain.value = clamp(rainI, 0, 1);
        if (WU.uFlowSpeed) WU.uFlowSpeed.value = 1 + 0.55 * this.wetness + 0.15 * rainI;
      }
      const pd = this._puddles;
      if (pd) {
        const wet = clamp((this.wetness - 0.04) / 0.6, 0, 1);
        pd.visible = !!pd.userData.allowed && wet > 0.01;
        if (pd.visible) {
          const u = pd.material.uniforms, E = G.sys.engine;
          u.uWet.value = wet; u.uRain.value = rainI; u.uTime.value = t;   // unwrapped: a wrap restarted every ring at once
          u.uHor.value.copy(_fogCol);
          u.uSky.value.copy(this._overlay ? this._overlay.material.uniforms.uZenith.value : _fogCol).lerp(_fogCol, 0.35);
          if (E?.sun) { u.uSunCol.value.copy(E.sun.color).multiplyScalar(E.sun.intensity * 0.35 * (E.sunDir.y > 0 ? 1 : 0)); u.uSunDir.value.copy(E.sunDir); }
        }
      }
      if (!cam) return;
      // camera-forward biased centre so most drops are in view
      _fwd.set(0, 0, -1).applyQuaternion(cam.quaternion); _fwd.y = 0;
      if (_fwd.lengthSq() < 1e-6) _fwd.set(0, 0, -1); else _fwd.normalize();
      // rain streaks wrap their clock every 10 min (fast random streaks hide the reshuffle; keeps float precision for
      // hours); slow snowflakes would visibly jump all at once, so snow runs on the unwrapped clock
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
          u.uTime.value = t;
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
          u.uOpacity.value = lerp(0.13, 0.28, dayK) * rainI;
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

    /** puddles exist on medium / high (built once, lazily, when the preset allows them) */
    _ensurePuddles() {
      const E = G.sys.engine;
      const on = typeof E?.feature === 'function' ? E.feature('rainRings') : (E?.preset?.name !== 'low');
      if (on && !this._puddles && E?.scene) {
        try {
          const q = E.preset?.name;
          this._puddles = buildPuddles(q === 'high' ? 44 : 28);
          if (this._puddles) E.scene.add(this._puddles);
        } catch (e) { G.log.warn('WEATHER', 'puddles failed', e); this._puddles = null; }
      }
      if (this._puddles) this._puddles.userData.allowed = !!on;
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
      const btn = document.querySelector('#bottom-bar [data-action="weather"]:not(#easy-wx-btn)');
      if (btn) {
        btn.title = `${name} · ${tempTxt} · 습도 ${this.humidity}% · ${this.timeString()} (${this.phaseName})`;
        btn.setAttribute('aria-label', `날씨: ${name}, ${tempTxt}, ${this.phaseName}`);
        btn.dataset.phase = this.phase.toLowerCase();
      }
      const kb = this._kidBtn;
      if (kb) {
        const emo = this._kidEmoji();
        const e = kb.querySelector('.bb-emo');
        if (e && e.textContent !== emo) e.textContent = emo;
        kb.dataset.wx = this.current.toLowerCase();
        kb.setAttribute('aria-label', `날씨: ${KID_WX[this.current]?.label || name}. 날씨 바꾸기`);
      }
    },

    // ------------------------------------------------------------ 쉬운 모드: kid weather button + picture card
    /** the kid bottom bar has no weather button in the template: add one (easy-only; CSS orders it before 🔊) */
    _ensureKidButton() {
      const bar = document.getElementById('bottom-bar');
      if (!bar) return;
      let b = bar.querySelector('#easy-wx-btn');
      if (!b) {
        const h = G.ui.h;
        b = h('button', { id: 'easy-wx-btn', type: 'button', class: 'easy-only easy-wx-btn', 'data-action': 'weather', 'data-say': '날씨. 날씨와 시간을 바꿔요.', 'aria-label': '날씨 바꾸기' },
          h('span', { class: 'bb-emo emoji', 'aria-hidden': 'true' }, '☀️'), h('span', { class: 'lbl' }, '날씨'));
        bar.insertBefore(b, bar.querySelector('[data-action="sound"]'));
      }
      this._kidBtn = b;
    },
    _kidEmoji(id = this.current) {
      const k = KID_WX[id] || KID_WX.CLEAR;
      return id === 'CLEAR' && this.nightFactor > 0.55 ? k.night : k.emoji;
    },
    /** one sentence for the picture card */
    _kidLine() {
      const k = KID_WX[this.current] || KID_WX.CLEAR;
      const night = this.nightFactor > 0.55;
      return this.current === 'CLEAR' && night ? k.nightLine : k.line;
    },

    _buildKidPopover() {
      const h = G.ui.h;
      const scene = h('div', { class: 'wxk-scene', dataset: { wx: 'scene' }, 'aria-hidden': 'true' },
        h('span', { class: 'wxk-fx' }), h('span', { class: 'wxk-big emoji' }, '☀️'));
      const line = h('p', { class: 'wxk-line', dataset: { wx: 'line' } }, '');
      const feel = h('div', { class: 'wxk-feel', dataset: { wx: 'feel' } }, '');
      const picks = Object.keys(KID_WX).map((id) => {
        const b = h('button', { type: 'button', class: 'wxk-tile', dataset: { kidWx: id }, 'aria-pressed': 'false', 'data-say': KID_WX[id].label },
          h('span', { class: 'wxk-emo emoji', 'aria-hidden': 'true' }, KID_WX[id].emoji), h('span', { class: 'wxk-lbl' }, KID_WX[id].label));
        b.style.setProperty('--wx', PICK_COLORS[id]);
        return b;
      });
      const times = KID_TIMES.map((tm) => h('button', { type: 'button', class: 'wxk-time', dataset: { kidHour: String(tm.h) }, 'aria-pressed': 'false', 'data-say': tm.label },
        h('span', { class: 'wxk-emo emoji', 'aria-hidden': 'true' }, tm.emoji), h('span', { class: 'wxk-lbl' }, tm.label)));
      const auto = h('button', { type: 'button', class: 'wxk-auto', dataset: { kidAuto: '1' }, 'aria-pressed': 'false' },
        h('span', { class: 'emoji', 'aria-hidden': 'true' }, '🔄'), h('span', { dataset: { wx: 'autoLbl' } }, '저절로 바뀌어요'));
      const close = h('button', { type: 'button', class: 'wxk-x', 'aria-label': '닫기', title: '닫기' }, h('span', { class: 'emoji', 'aria-hidden': 'true' }, '✖'));
      const head = h('div', { class: 'wxk-head' }, scene, h('div', { class: 'wxk-say' }, line, feel));
      const el = h('div', { class: 'wxk', role: 'dialog', 'aria-label': '날씨' },
        close, head,
        h('div', { class: 'wxk-title' }, h('span', { class: 'emoji', 'aria-hidden': 'true' }, '👇'), '날씨를 바꿔 봐요'),
        h('div', { class: 'wxk-picks' }, picks),
        h('div', { class: 'wxk-title' }, h('span', { class: 'emoji', 'aria-hidden': 'true' }, '🕰️'), '언제로 할까요?'),
        h('div', { class: 'wxk-times' }, times),
        auto);
      try { G.easy?.speakable?.(head.querySelector('.wxk-say'), () => this._kidSpeech()); } catch (e) { /* voice optional */ }
      close.addEventListener('click', () => this._pop?.close?.());
      el.addEventListener('click', (ev) => {
        const p = ev.target.closest('[data-kid-wx]');
        if (p) {
          const id = p.dataset.kidWx;
          if (this.auto) G.setSetting('autoWeather', false);
          this.set(id, { source: 'user' });
          this._bump();
          kidSay(KID_WX[id]?.pick || '', { priority: 1 });
          return;
        }
        const tm = ev.target.closest('[data-kid-hour]');
        if (tm) {
          const hr = Number(tm.dataset.kidHour);
          this.setHour(hr);
          this._bump();
          kidSay(KID_TIMES.find((x) => x.h === hr)?.say || '', { priority: 1 });
          this._refreshPopover(true);
          return;
        }
        if (ev.target.closest('[data-kid-auto]')) {
          const on = !this.auto;
          G.setSetting('autoWeather', on);
          kidSay(on ? '이제 날씨가 저절로 바뀌어요.' : '내가 고른 날씨로 있어요.', { priority: 1 });
        }
      });
      return el;
    },
    _kidSpeech() {
      const f = feelWord(this.temperature);
      return `${this._kidLine()} ${f.word}.`;
    },
    _bump() {
      const sc = this._popEl?.querySelector('.wxk-scene');
      if (!sc) return;
      sc.classList.remove('bump'); void sc.offsetWidth; sc.classList.add('bump');
    },
    _refreshKid(force) {
      const el = this._popEl;
      if (!el) return;
      const q = (k) => el.querySelector(`[data-wx="${k}"]`);
      const sc = q('scene');
      if (sc) {
        const night = this.nightFactor > 0.55 ? '1' : '0';
        if (sc.dataset.kind !== this.current || sc.dataset.night !== night) {
          sc.dataset.kind = this.current; sc.dataset.night = night;
          const big = sc.querySelector('.wxk-big');
          if (big) big.textContent = this._kidEmoji();
        }
      }
      const setT = (n, v) => { if (n && n.textContent !== v) n.textContent = v; };
      setT(q('line'), this._kidLine());
      const f = feelWord(this.temperature);
      setT(q('feel'), `${f.emoji} ${f.word}`);
      for (const b of el.querySelectorAll('[data-kid-wx]')) {
        const on = b.dataset.kidWx === this.current;
        b.classList.toggle('active', on); b.setAttribute('aria-pressed', on ? 'true' : 'false');
      }
      const ph = this.phase;
      const cur = ph === 'MORNING' ? 6.5 : ph === 'DAY' ? 12 : ph === 'EVENING' ? 18.6 : 22;
      for (const b of el.querySelectorAll('[data-kid-hour]')) {
        const on = Number(b.dataset.kidHour) === cur;
        b.classList.toggle('active', on); b.setAttribute('aria-pressed', on ? 'true' : 'false');
      }
      const au = el.querySelector('[data-kid-auto]');
      if (au) { au.setAttribute('aria-pressed', this.auto ? 'true' : 'false'); au.classList.toggle('on', this.auto); }
      setT(q('autoLbl'), this.auto ? '날씨가 저절로 바뀌어요' : '저절로 바뀌게 하기');
      if (force) el.closest('.popover') && this._pop?.reposition?.();
    },

    // ------------------------------------------------------------ popover
    openPopover(anchor) {
      const kid = easyOn();
      if (!anchor || !anchor.isConnected || anchor.offsetParent === null) {
        anchor = kid ? (this._kidBtn || document.querySelector('#bottom-bar [data-action="weather"]')) : document.querySelector('#bottom-bar [data-action="weather"]:not(#easy-wx-btn)');
      }
      if (!anchor) return null;
      const el = kid ? this._buildKidPopover() : this._buildPopover();
      const p = G.ui.popover.open(anchor, el, { id: 'weather', placement: 'top', className: kid ? 'wx-popover wxk-popover' : 'wx-popover', onClose: () => { if (this._pop === p) { this._pop = null; this._popEl = null; } } });
      if (!p) { this._pop = null; return null; }
      this._pop = p;
      this._popEl = el;
      this._popKid = kid;
      this._refreshPopover(true);
      p.reposition?.();
      if (kid) kidSay(`날씨예요. ${this._kidSpeech()}`, { priority: 0 });
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
      if (this._popKid) { this._refreshKid(force); return; }
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
