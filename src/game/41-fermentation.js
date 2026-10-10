// =============================================================================
// 41-fermentation.js — my jars J1–J3 on the jangdokdae (glowing onggi + lid + recipe tag), fermentation
// state machine & quality simulation, jar modal (status/progress/environment/quality formula/care/start/
// claim), work table crafting, onggi display info (G.sys.fermentation).
//
//   G.sys.fermentation (order 62)
//     openJar(id)                 modal (emits ferment:checked for owned jars); lid lifts while open
//     start(jarId, recipeId)      consumes recipe ingredients -> PREPARING            (emits ferment:started)
//     claim(jarId)                COMPLETE -> CLAIMED, items + exp/coin via progression (emits ferment:claimed)
//     care(jarId, 'vent'|'sun'|'clean')   environment / hygiene care with cooldown
//     unlock(jarId)               buy J2/J3 for G.data.fermentation.extraJarPrice coins
//     getJar(id) -> {id, def, state, status, statusName, recipe, progress, remaining, quality, grade, env, owned}
//     myJarIds() -> ['J1', ...]   env() -> {temp, humidity, day, raining, weatherId, weatherName, source}
//     openCraft() / craft(craftId)   work table (G.data.crafts)       (emits craft:done)
//     openJarDisplay(id)          onggi type info (독/중두리/항아리/단지)
//     setJar(id, patch) / fastForward(seconds)   debug & test helpers
//   State machine EMPTY -> PREPARING -> FERMENTING -> AGING -> COMPLETE -> CLAIMED (-> new start).
//   Progress advances from timestamps (offline time counts) at a small environment-dependent speed.
//   Quality = base + 온도(0–15) + 습도(0–10) + 숙성(0–15) − 위생 감점(0–20) — an educational game simulation.
// =============================================================================
(function () {
  const U = G.util;
  const clamp = U.clamp, lerp = U.lerp;
  const PI = Math.PI, TAU = PI * 2;
  const esc = U.escapeHtml;
  const fmt = (n) => U.fmt(n);
  const now = () => G.time.now();
  /** Korean particle: josa('콩', '이/가') -> '콩이', josa('고추', '을/를') -> '고추를' (first form follows a final consonant) */
  function josa(word, pair) {
    const w = String(word ?? '');
    const [withB, withoutB] = pair.split('/');
    const code = w.trim().slice(-1).charCodeAt(0) - 0xac00;
    if (!(code >= 0 && code <= 11171)) return `${w}${withB}(${withoutB})`;
    const fin = code % 28;
    if (withB === '으로') return w + (fin === 0 || fin === 8 ? '로' : '으로');
    return w + (fin ? withB : withoutB);
  }

  const FDEF = { stages: { PREPARING: 0, FERMENTING: 10, AGING: 60 }, careCooldown: 20, maxJars: 3, extraJarPrice: 1500, starterRecipe: 'FER001', starterProgress: 35, gradeNames: [[90, '최상'], [75, '상'], [55, '중'], [0, '하']] };
  let FC = null;
  const FD = () => FC || (FC = Object.assign({}, FDEF, G.data.fermentation || {}));
  const recipes = () => G.data.recipes || {};
  const recipeOf = (id) => (id && recipes()[id]) || null;
  const items = () => G.data.items || {};
  const STATE_NAMES = () => G.data.jarStateNames || { EMPTY: '비어 있음', PREPARING: '재료 준비', FERMENTING: '발효 중', AGING: '숙성 중', COMPLETE: '완성', CLAIMED: '수령 완료' };
  const ACTIVE = new Set(['PREPARING', 'FERMENTING', 'AGING']);
  const OPEN_FOR_START = new Set(['EMPTY', 'CLAIMED']);
  const ACTION_RANGE = 15; // m: jar actions need the player on the jangdokdae (NPC 장독지기 stands within it)
  const TICK = 0.25;
  const DEF_ENV = { temp: 22, humidity: 60 };

  function stageOf(p) {
    const s = FD().stages;
    if (p >= 100) return 'COMPLETE';
    if (p >= s.AGING) return 'AGING';
    if (p >= s.FERMENTING) return 'FERMENTING';
    return 'PREPARING';
  }
  function gradeOf(q) {
    const list = (FD().gradeNames || []).slice().sort((a, b) => b[0] - a[0]);
    for (const [min, name] of list) if (q >= min) return name;
    return list.length ? list[list.length - 1][1] : '';
  }
  /** 1 inside [lo, hi], falling linearly to 0 at `fall` outside */
  function rangeScore(v, lo, hi, fall) {
    if (v >= lo && v <= hi) return 1;
    const d = v < lo ? lo - v : v - hi;
    return Math.max(0, 1 - d / fall);
  }

  const CARE = {
    vent: { name: '환기', icon: '🌬️', effect: '습도 −10% · 온도 −2.5°C · 위생 +6', desc: '뚜껑을 열어 바람이 통하게 해요. 습기와 열기가 빠지고 곰팡이 걱정이 줄어요.', apply(s) { s.humOff -= 10; s.tempOff -= 2.5; s.hygiene += 6; } },
    sun: { name: '햇볕 쬐기', icon: '☀️', effect: '온도 +4°C · 습도 −5% · 위생 +4', desc: '맑은 낮에 뚜껑을 열어 햇볕을 쬐어 줘요. 장독대를 양지바른 곳에 두는 이유예요.', apply(s) { s.tempOff += 4; s.humOff -= 5; s.hygiene += 4; } },
    clean: { name: '닦기', icon: '🧽', effect: '위생 +25', desc: '장독 겉면과 뚜껑을 깨끗이 닦아요. 옹기는 자주 닦아 반질반질하게 관리했어요.', apply(s) { s.hygiene += 25; } },
  };
  const INGREDIENT_HINTS = {
    ITEM_MEJU: '작업대에서 콩 3개로 빚거나 매점에서 살 수 있어요',
    ITEM_SALT: '매점에서 살 수 있어요',
    ITEM_RICE: '매점에서 살 수 있어요',
    ITEM_GOCHUGARU: '작업대에서 고추 3개로 빻거나 매점에서 살 수 있어요',
    ITEM_CABBAGE: '전통작물 구역 배추밭에서 수확해요',
    ITEM_BEAN: '전통작물 구역 콩밭에서 수확해요',
    ITEM_PEPPER: '전통작물 구역 고추밭에서 수확해요',
  };
  const ONGGI_INFO = {
    dok: { title: '독', sub: '가장 큰 옹기', text: '키가 크고 배가 넉넉한 큰 옹기예요. 간장·된장이나 김장 김치처럼 많은 양을 오래 담가 두는 데 썼어요.', use: '간장 · 된장 · 김장 김치', size: '아주 큼' },
    jungduri: { title: '중두리', sub: '독보다 조금 작은 옹기', text: '독보다 조금 작고 배가 불룩한 옹기예요. 장이나 곡식처럼 독에 담기에는 적은 양을 보관했어요.', use: '장류 · 곡식 · 물', size: '큼' },
    hangari: { title: '항아리', sub: '배가 부른 옹기', text: '아가리가 좁고 배가 부른 옹기예요. 고추장·젓갈·곡식 등 여러 가지를 담아 두는 가장 흔한 옹기예요.', use: '고추장 · 젓갈 · 곡식', size: '보통' },
    danji: { title: '단지', sub: '작고 목이 짧은 옹기', text: '목이 짧고 배가 부른 작은 옹기예요. 꿀·참기름·장아찌처럼 적은 양을 담아 부엌 가까이 두고 썼어요.', use: '꿀 · 참기름 · 장아찌', size: '작음' },
  };
  const ONGGI_FACT = '옹기는 흙으로 빚어 구운 그릇으로, 그릇 벽의 미세한 숨구멍 덕분에 “숨 쉬는 그릇”이라고 불려요.';

  // ---------------------------------------------------------------- onggi geometry (shared)
  const JAR_PROFILE = G.bkit?.JAR_PROFILES?.hangari || [[0, 0], [0.2, 0], [0.235, 0.035], [0.3, 0.17], [0.37, 0.33], [0.41, 0.47], [0.42, 0.55], [0.405, 0.64], [0.36, 0.74], [0.3, 0.81], [0.265, 0.855], [0.27, 0.885], [0.292, 0.905], [0.285, 0.925], [0.25, 0.93], [0.23, 0.9]];
  const LID_PROFILE = [[0, 0.17], [0.04, 0.17], [0.055, 0.15], [0.06, 0.12], [0.13, 0.112], [0.22, 0.088], [0.29, 0.048], [0.315, 0.012], [0.3, 0], [0.26, 0.02], [0.15, 0.06], [0, 0.07]];
  const JS = 1.3; // my jars are a bit larger than the decorative ones
  const JAR_TOP = JAR_PROFILE.reduce((m, p) => Math.max(m, p[1]), 0) * JS;
  let GEO = null;
  function geos() {
    if (GEO) return GEO;
    const lathe = (pts, seg, s) => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(Math.max(0.0001, r * s), y * s)), seg);
    const lidS = 0.292 / 0.3 * JS;
    const plinth = new THREE.CylinderGeometry(0.62, 0.7, 0.16, 28);
    plinth.translate(0, 0.08, 0);
    const padBody = new THREE.BoxGeometry(0.15, 0.13, 0.06);
    const shackle = new THREE.TorusGeometry(0.05, 0.012, 8, 16, PI);
    shackle.translate(0, 0.065, 0);
    const tag = new THREE.PlaneGeometry(0.3, 0.19);
    GEO = {
      jar: lathe(JAR_PROFILE, 40, JS),
      lid: lathe(LID_PROFILE, 32, lidS),
      knob: new THREE.SphereGeometry(0.045, 12, 8),
      contents: new THREE.CircleGeometry(0.262 * JS, 32).rotateX(-PI / 2),
      band: new THREE.TorusGeometry(0.315 * JS, 0.018, 8, 48).rotateX(PI / 2),
      plinth,
      padBody, shackle, tag,
      ring: new THREE.PlaneGeometry(1, 1).rotateX(-PI / 2),
    };
    return GEO;
  }
  let TEX = null;
  function textures() {
    if (TEX) return TEX;
    const ring = G.gfx.canvasTexture(256, 256, (ctx, w) => {
      const c = w / 2;
      const g = ctx.createRadialGradient(c, c, 0, c, c, c);
      g.addColorStop(0, 'rgba(255,214,102,0.0)');
      g.addColorStop(0.5, 'rgba(255,214,102,0.18)');
      g.addColorStop(0.7, 'rgba(255,224,130,0.55)');
      g.addColorStop(0.78, 'rgba(255,246,210,1)');
      g.addColorStop(0.86, 'rgba(255,200,80,0.45)');
      g.addColorStop(1, 'rgba(255,190,60,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, w);
      ctx.strokeStyle = 'rgba(255,240,190,0.9)'; ctx.lineWidth = 3; ctx.lineCap = 'round';
      for (let i = 0; i < 16; i++) { const a0 = (i / 16) * TAU; ctx.beginPath(); ctx.arc(c, c, c * 0.93, a0, a0 + 0.18); ctx.stroke(); }
    });
    const halo = G.gfx.radialTexture(128, 'rgba(255,220,130,1)', 'rgba(255,170,40,0)');
    const paste = G.gfx.canvasTexture(128, 128, (ctx, w) => {
      const r = U.rng('paste');
      const g = ctx.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
      g.addColorStop(0, '#ffffff'); g.addColorStop(0.85, '#e8e2d6'); g.addColorStop(1, '#bfb5a4');
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, w);
      for (let i = 0; i < 260; i++) { ctx.fillStyle = r() < 0.5 ? 'rgba(0,0,0,0.10)' : 'rgba(255,255,255,0.35)'; const s = 1 + r() * 3; ctx.beginPath(); ctx.arc(r() * w, r() * w, s, 0, TAU); ctx.fill(); }
    });
    TEX = { ring, halo, paste, tags: {} };
    return TEX;
  }
  function tagTexture(text, color) {
    const T = textures();
    const key = text + '|' + color;
    if (T.tags[key]) return T.tags[key];
    const t = G.gfx.canvasTexture(256, 160, (ctx, w, h) => {
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#f3e6c8'); g.addColorStop(1, '#dcc9a0');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.moveTo(18, 0); ctx.lineTo(w - 18, 0); ctx.lineTo(w, 18); ctx.lineTo(w, h - 18); ctx.lineTo(w - 18, h); ctx.lineTo(18, h); ctx.lineTo(0, h - 18); ctx.lineTo(0, 18); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = color; ctx.lineWidth = 10; ctx.stroke();
      ctx.fillStyle = 'rgba(80,50,20,0.55)'; ctx.beginPath(); ctx.arc(w / 2, 20, 8, 0, TAU); ctx.fill();
      ctx.fillStyle = '#3a2412'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const font = '"PretendardEmbed","Pretendard","Noto Sans KR","Apple SD Gothic Neo","Malgun Gothic",sans-serif';
      let size = 66; ctx.font = `800 ${size}px ${font}`;
      while (ctx.measureText(text).width > w * 0.82 && size > 20) { size -= 4; ctx.font = `800 ${size}px ${font}`; }
      ctx.fillText(text, w / 2, h * 0.58);
    });
    T.tags[key] = t;
    return t;
  }

  /** jar glaze with a soft golden fresnel rim (owned jars glow) */
  function jarMaterial() {
    const map = (() => { try { return G.bkit?.tex?.('jar') || null; } catch (e) { return null; } })();
    const m = new THREE.MeshStandardMaterial({ map, color: map ? 0xffffff : 0x4a2a16, roughness: 0.26, metalness: 0.05, side: THREE.DoubleSide, emissive: new THREE.Color(0xffa43a), emissiveIntensity: 0 });
    const rim = { uRim: { value: 0 }, uRimColor: { value: new THREE.Color(0xffc659) } };
    m.userData.rim = rim;
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uRim = rim.uRim; sh.uniforms.uRimColor = rim.uRimColor;
      sh.fragmentShader = 'uniform float uRim;\nuniform vec3 uRimColor;\n' + sh.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        float jarFres = pow(1.0 - clamp(abs(dot(normal, normalize(vViewPosition))), 0.0, 1.0), 2.4);
        totalEmissiveRadiance += uRimColor * jarFres * uRim;`);
    };
    m.customProgramCacheKey = () => 'ferment-jar-rim';
    return m;
  }

  // ===========================================================================================
  const _v = new THREE.Vector3(), _cam = new THREE.Vector3();
  const _env = { temp: 22, humidity: 60, day: true, raining: false, weatherId: 'CLEAR', weatherName: '맑음', source: 'default' };

  const fer = {
    name: 'fermentation', order: 62, label: '장독대',
    _jars: new Map(),
    _tick: 0,
    _modal: null,
    _ready: false,

    init() {
      G.ffx?.ensure?.();
      const L = G.data.layout || {};
      for (const def of L.jars || []) {
        try { this._buildJar(def); } catch (e) { G.log.error('FERMENTATION', `jar ${def.id} build failed`, e); }
      }
      this._registerCraftAndDisplays();
      G.bus.on('state:before-save', () => { if (G.state) this._simulateAll(); });
      G.bus.on('item:added', () => { if (this._modal) this._refreshModal(true); if (this._craftModal) this._renderCraft(); });
      G.bus.on('item:removed', () => { if (this._modal) this._refreshModal(true); if (this._craftModal) this._renderCraft(); });
      G.log.info('FERMENTATION', `${this._jars.size} jars ready`);
    },

    onStateLoaded(state) {
      if (!state) return;
      state.jars = state.jars && typeof state.jars === 'object' ? state.jars : {};
      const t = now();
      for (const J of this._jars.values()) {
        let s = state.jars[J.id];
        if (!s || typeof s !== 'object') s = state.jars[J.id] = this._initialJar(J.def, t);
        this._repair(J.id, s, t);
        // offline catch-up (environment unknown while away -> neutral defaults)
        this._simulate(J.id, t, true);
        J.lastStatus = s.status;
        J.lidT = 0; J.lidPulse = 0;
        this._syncVisual(J, true);
      }
      this._ready = true;
      this._refreshLabels();
    },

    onLogout() {
      this._ready = false;
      this._modal?.m?.close?.();
      this._modal = null;
      this._craftModal?.close?.();
      this._craftModal = null;
      for (const J of this._jars.values()) J.label?.setVisible(false);
    },

    update(dt, t) {
      G.ffx?.update?.(dt);
      if (!this._ready || !G.state) return;
      this._tick -= dt;
      if (this._tick <= 0) {
        this._tick = TICK;
        this._simulateAll();
        for (const J of this._jars.values()) this._syncVisual(J, false);
        this._refreshLabels();
        this._refreshModal(false);
      }
      const cam = G.sys.engine?.camera;
      if (cam) _cam.copy(cam.position);
      const reduce = !!G.settings.reduceMotion;
      for (const J of this._jars.values()) this._animateJar(J, dt, t, reduce);
    },

    // ------------------------------------------------------------ state
    _initialJar(def, t) {
      const F = FD();
      const base = { owned: false, recipeId: null, status: 'EMPTY', progress: 0, quality: 0, hygiene: 100, temp: DEF_ENV.temp, humidity: DEF_ENV.humidity, tempOff: 0, humOff: 0, startedAt: 0, lastUpdate: t, care: {}, completedAt: 0, claimedAt: 0, acc: { t: 0, temp: 0, hum: 0, hyg: 0 } };
      if (def.id !== 'J1' && def.owner !== 'me-starter') return base;
      const rec = recipeOf(F.starterRecipe);
      base.owned = true;
      if (!rec) return base;
      const p = clamp(Number(F.starterProgress) || 0, 0, 99);
      const el = (p / 100) * rec.baseDuration;
      Object.assign(base, {
        recipeId: rec.id, status: stageOf(p), progress: p, hygiene: 82, startedAt: t - Math.round(el * 1000), lastUpdate: t,
        acc: { t: el, temp: el * 0.86, hum: el * 0.8, hyg: el * 92 },
      });
      base.quality = this._quality(base, rec).total;
      return base;
    },
    _repair(id, s, t) {
      if (typeof s.owned !== 'boolean') s.owned = id === 'J1';
      if (!G.data.jarStates?.includes?.(s.status) && !STATE_NAMES()[s.status]) s.status = 'EMPTY';
      if (s.recipeId && !recipeOf(s.recipeId)) { s.recipeId = null; s.status = 'EMPTY'; }
      if (!s.recipeId && s.status !== 'EMPTY') s.status = 'EMPTY';
      s.progress = clamp(Number(s.progress) || 0, 0, 100);
      s.hygiene = clamp(Number.isFinite(Number(s.hygiene)) ? Number(s.hygiene) : 100, 0, 100);
      s.tempOff = Number(s.tempOff) || 0; s.humOff = Number(s.humOff) || 0;
      s.care = s.care && typeof s.care === 'object' ? s.care : {};
      if (!s.acc || typeof s.acc !== 'object') s.acc = { t: 0, temp: 0, hum: 0, hyg: 0 };
      for (const k of ['t', 'temp', 'hum', 'hyg']) s.acc[k] = Number(s.acc[k]) || 0;
      if (!Number.isFinite(s.lastUpdate) || s.lastUpdate <= 0 || s.lastUpdate > t + 60000) s.lastUpdate = t;
      if (ACTIVE.has(s.status) && s.progress >= 100) s.status = 'COMPLETE';
      if (ACTIVE.has(s.status)) s.status = stageOf(s.progress);
    },
    _state(id) { return G.state?.jars?.[id] || null; },

    /** current environment (weather system, falling back to 22 °C / 60 %) — returns a shared object */
    _readEnv() {
      const w = G.sys.weather;
      let temp = Number(w?.temperature), hum = Number(w?.humidity);
      _env.source = Number.isFinite(temp) ? 'weather' : 'default';
      if (!Number.isFinite(temp)) temp = DEF_ENV.temp;
      if (!Number.isFinite(hum)) hum = DEF_ENV.humidity;
      const cur = w?.current;
      const wid = (typeof cur === 'string' ? cur : cur?.id) || w?.weatherId || 'CLEAR';
      const ph = w?.phase;
      const pid = typeof ph === 'string' ? ph : ph?.id;
      const hour = Number(w?.hour);
      _env.temp = temp; _env.humidity = clamp(hum, 0, 100);
      _env.day = pid ? (pid === 'DAY' || pid === 'MORNING') : Number.isFinite(hour) ? hour >= 6 && hour < 18 : true;
      _env.raining = wid === 'RAIN' || wid === 'SNOW';
      _env.weatherId = wid;
      _env.weatherName = G.data.weather?.[wid]?.name || '맑음';
      return _env;
    },
    env() { return Object.assign({}, this._readEnv()); },
    /** jar micro-climate from the environment + care offsets */
    _micro(s, env) {
      return { temp: env.temp + (s.tempOff || 0), hum: clamp(env.humidity + (s.humOff || 0), 5, 100) };
    },
    _speed(s, rec, env) {
      const m = this._micro(s, env);
      const ts = rangeScore(m.temp, rec.idealTemp[0], rec.idealTemp[1], 10);
      const hs = rangeScore(m.hum, rec.idealHumidity[0], rec.idealHumidity[1], 20);
      return { speed: 0.8 + 0.25 * ts + 0.1 * hs, ts, hs, temp: m.temp, hum: m.hum };
    },

    /** advance one jar to time t. offline=true uses neutral default weather for the elapsed time */
    _simulate(id, t = now(), offline = false) {
      const s = this._state(id);
      if (!s) return null;
      let el = (t - s.lastUpdate) / 1000;
      s.lastUpdate = t;
      if (!(el > 0)) return s;
      const rec = recipeOf(s.recipeId);
      if (!rec || !ACTIVE.has(s.status)) return s;
      let env = this._readEnv();
      if (offline || el > 30) env = Object.assign({}, env, DEF_ENV, { raining: false });
      const steps = Math.min(4000, Math.max(1, Math.ceil(el)));
      const h = el / steps;
      const prev = s.status;
      for (let k = 0; k < steps; k++) {
        const sp = this._speed(s, rec, env);
        s.progress = Math.min(100, s.progress + (h / rec.baseDuration) * 100 * sp.speed);
        const hum = sp.hum;
        s.hygiene = clamp(s.hygiene - h * (0.12 + (hum > 80 ? 0.06 : 0) + (env.raining ? 0.03 : 0)), 0, 100);
        const decay = Math.pow(0.5, h / 60);
        s.tempOff *= decay; s.humOff *= decay;
        s.acc.t += h; s.acc.temp += sp.ts * h; s.acc.hum += sp.hs * h; s.acc.hyg += s.hygiene * h;
        s.temp = sp.temp; s.humidity = sp.hum;
        if (s.progress >= 100) { s.completedAt = Math.round(t - (steps - k - 1) * h * 1000); break; }
      }
      const q = this._quality(s, rec);
      s.quality = q.total;
      const st = stageOf(s.progress);
      if (st !== prev) {
        s.status = st;
        this._onStatusChange(id, prev, st, offline);
      }
      return s;
    },
    _simulateAll() { const t = now(); for (const id of this._jars.keys()) this._simulate(id, t, false); },

    _quality(s, rec) {
      const a = s.acc || { t: 0 };
      const T = a.t > 0 ? a.t : 0;
      const tsAvg = T ? a.temp / T : 0.75, hsAvg = T ? a.hum / T : 0.75, hyAvg = T ? a.hyg / T : s.hygiene;
      const stg = FD().stages;
      const agingFrac = clamp((s.progress - stg.AGING) / (100 - stg.AGING), 0, 1);
      const base = rec.baseQuality || 55;
      const temp = Math.round(15 * tsAvg), hum = Math.round(10 * hsAvg), aging = Math.round(15 * agingFrac);
      const hyg = Math.round(20 * clamp((90 - hyAvg) / 60, 0, 1));
      const total = clamp(base + temp + hum + aging - hyg, 0, 100);
      return { base, temp, hum, aging, hyg, total, grade: gradeOf(total), hyAvg };
    },

    _onStatusChange(id, prev, st, offline) {
      const J = this._jars.get(id);
      const s = this._state(id);
      const rec = recipeOf(s?.recipeId);
      G.log.info('FERMENTATION', `${id} ${prev} -> ${st}`);
      if (st === 'COMPLETE') {
        if (rec) {
          const q = this._quality(s, rec);
          s.quality = q.total;
          s.qualityParts = { base: q.base, temp: q.temp, hum: q.hum, aging: q.aging, hyg: q.hyg };
        }
        G.dirty('ferment');
        G.bus.emit('ferment:completed', { jarId: id, recipeId: s.recipeId });
        G.activity('ferment', `${rec?.name || '발효'} 완성 (품질 ${s.quality}점)`, { jarId: id, recipeId: s.recipeId });
        const msg = offline ? `자리를 비운 사이 ${josa(rec?.name || '발효', '이/가')} 완성됐어요! 장독대에서 수령하세요.` : `${josa(rec?.name || '발효', '이/가')} 완성됐어요! 장독을 열어 수령하세요.`;
        setTimeout(() => { if (G.state && this._ready !== false) G.ui?.toast?.(msg, { type: 'success', emoji: rec?.icon || '🏺', duration: 4800 }); }, offline ? 1800 : 0);
        if (J && !offline) { J.burst = 1; G.sfx('achievement'); }
      } else if (J && !offline) {
        J.stagePop = 1;
      }
    },

    // ------------------------------------------------------------ public API
    myJarIds() {
      const out = [];
      for (const id of this._jars.keys()) { const s = this._state(id); if (s ? s.owned : id === 'J1') out.push(id); }
      return out;
    },
    getJar(id) {
      const J = this._jars.get(id);
      if (!J) return null;
      const s = this._state(id);
      if (!s) return { id, def: J.def, owned: id === 'J1', status: id === 'J1' ? 'FERMENTING' : 'EMPTY', statusName: STATE_NAMES()[id === 'J1' ? 'FERMENTING' : 'EMPTY'] };
      const rec = recipeOf(s.recipeId);
      const env = this._readEnv();
      const sp = rec ? this._speed(s, rec, env) : null;
      const q = rec ? (s.status === 'COMPLETE' || s.status === 'CLAIMED') && s.qualityParts ? Object.assign({ total: s.quality, grade: gradeOf(s.quality) }, s.qualityParts) : this._quality(s, rec) : null;
      return {
        id, def: J.def, state: s, owned: !!s.owned, status: s.status, statusName: STATE_NAMES()[s.status] || s.status,
        recipeId: s.recipeId, recipe: rec, progress: s.progress,
        remaining: rec && ACTIVE.has(s.status) ? ((100 - s.progress) / 100) * rec.baseDuration / (sp?.speed || 1) : 0,
        quality: q ? q.total : 0, grade: q ? q.grade : '', qualityParts: q, hygiene: s.hygiene,
        temp: sp ? sp.temp : env.temp, humidity: sp ? sp.hum : env.humidity, speed: sp ? sp.speed : 1, env: Object.assign({}, env),
      };
    },

    start(jarId, recipeId) {
      if (!G.state) return false;
      const s = this._simulate(jarId);
      const rec = recipeOf(recipeId);
      const J = this._jars.get(jarId);
      if (!s || !rec || !J) return false;
      if (!s.owned) { G.ui.toast('먼저 장독을 열어야 해요.', { type: 'warn', emoji: '🔒' }); return false; }
      if (ACTIVE.has(s.status)) { G.ui.toast('이미 발효가 진행 중인 장독이에요.', { type: 'warn' }); return false; }
      if (s.status === 'COMPLETE') { G.ui.toast('완성된 발효식품을 먼저 수령해 주세요.', { type: 'warn', emoji: '🎁' }); return false; }
      const missing = this._missing(rec);
      if (missing.length) {
        G.ui.toast(`재료가 부족해요: ${missing.map((m) => `${m.name} ${m.need - m.have}개`).join(', ')}`, { type: 'warn', emoji: '🧺' });
        return false;
      }
      const taken = [];
      for (const [itemId, q] of Object.entries(rec.ingredients || {})) {
        if (this._take(itemId, q)) taken.push([itemId, q]);
        else { for (const [ri, rq] of taken) this._give(ri, rq, 'refund'); G.ui.toast('재료를 꺼내지 못했어요. 다시 시도해 주세요.', { type: 'error' }); return false; }
      }
      const t = now();
      Object.assign(s, {
        recipeId: rec.id, status: 'PREPARING', progress: 0, hygiene: 100, tempOff: 0, humOff: 0, startedAt: t, lastUpdate: t,
        care: {}, completedAt: 0, claimedAt: 0, acc: { t: 0, temp: 0, hum: 0, hyg: 0 }, qualityParts: null,
      });
      s.quality = this._quality(s, rec).total;
      J.lastStatus = 'PREPARING';
      J.lidPulse = 1.6;
      const top = J.topY;
      G.ffx?.burst?.(G.ffx.P.POP, J.x, top + 0.15, J.z, 10, 0.8, 1.6, new THREE.Color(rec.color || '#8a5a3b'));
      G.ffx?.burst?.(G.ffx.P.SPARK, J.x, top + 0.2, J.z, 12, 0.9, 1.4);
      G.sys.player?.playAction?.('interact');
      G.sfx('jar');
      G.ui.toast(`${josa(rec.name, '을/를')} 시작했어요! 약 ${U.formatDuration(rec.baseDuration)} 뒤에 완성돼요.`, { type: 'success', emoji: rec.icon || '🏺' });
      G.log.info('FERMENTATION', `start ${jarId} ${rec.id}`);
      G.activity('ferment', `${rec.name} 시작`, { jarId, recipeId: rec.id });
      G.dirty('ferment');
      G.bus.emit('ferment:started', { jarId, recipeId: rec.id });
      this._syncVisual(J, true);
      this._refreshLabels();
      this._refreshModal(true);
      return true;
    },

    claim(jarId) {
      if (!G.state) return null;
      const s = this._simulate(jarId);
      const J = this._jars.get(jarId);
      const rec = recipeOf(s?.recipeId);
      if (!s || !J || !rec) return null;
      if (s.status !== 'COMPLETE') { G.ui.toast(`아직 발효가 끝나지 않았어요. (${Math.floor(s.progress)}%)`, { type: 'info', emoji: '⏳' }); return null; }
      const q = clamp(Math.round(s.quality || 0), 0, 100);
      const grade = gradeOf(q);
      const bonus = q >= 90 ? 1 : 0;
      const qty = (rec.resultQty || 1) + bonus;
      const itemId = rec.resultItem;
      const reward = { exp: rec.exp || 0, coin: rec.coin || 0, items: { [itemId]: qty } };
      const note = `품질 ${q}점 · ${grade} 등급${bonus ? ' (최상 품질 보너스 +1)' : ''} — 교육용 가상 시뮬레이션 결과예요.`;
      if (G.sys.progression?.grant) G.sys.progression.grant(reward, { popup: true, reason: 'ferment', eyebrow: 'FERMENTATION', title: `${rec.name} 완성!`, note });
      else {
        this._give(itemId, qty, 'ferment');
        G.state.stats.coin = (G.state.stats.coin || 0) + reward.coin;
        G.ui.toast(`+${items()[itemId]?.name || itemId} ×${qty}`, { type: 'reward', emoji: items()[itemId]?.icon });
      }
      const t = now();
      Object.assign(s, { status: 'CLAIMED', claimedAt: t, lastRecipe: rec.id, lastQuality: q, lastUpdate: t });
      J.lastStatus = 'CLAIMED';
      J.lidPulse = 1.4;
      G.ffx?.burst?.(G.ffx.P.SPARK, J.x, J.topY + 0.3, J.z, 26, 1.4, 2.2);
      G.ffx?.burst?.(G.ffx.P.PETAL, J.x, J.topY + 0.3, J.z, 14, 1.2, 2.0, null, J.baseY);
      G.sfx('reward');
      G.log.info('FERMENTATION', `claim ${jarId} ${rec.id} q=${q} -> ${itemId} x${qty}`);
      G.activity('ferment', `${rec.name} 수령 (품질 ${q}점 · ${grade})`, { jarId, recipeId: rec.id, quality: q, itemId, qty });
      G.dirty('ferment');
      G.bus.emit('ferment:claimed', { jarId, recipeId: rec.id, quality: q, itemId, qty });
      this._syncVisual(J, true);
      this._refreshLabels();
      this._refreshModal(true);
      return { itemId, qty, quality: q, grade };
    },

    care(jarId, action) {
      if (!G.state) return false;
      const s = this._simulate(jarId);
      const J = this._jars.get(jarId);
      const def = CARE[action];
      if (!s || !J || !def) return false;
      if (!s.owned || !ACTIVE.has(s.status)) { G.ui.toast('발효가 진행 중인 장독만 돌볼 수 있어요.', { type: 'info' }); return false; }
      const left = this._careLeft(s, action);
      if (left > 0) { G.ui.toast(`${josa(def.name, '은/는')} ${Math.ceil(left)}초 뒤에 다시 할 수 있어요.`, { type: 'info', emoji: '⏳', sound: false }); return false; }
      const env = this._readEnv();
      if (action === 'sun') {
        if (env.raining) { G.ui.toast('비나 눈이 올 때는 장독 뚜껑을 열면 안 돼요!', { type: 'warn', emoji: '🌧️' }); return false; }
        if (!env.day) { G.ui.toast('해가 떠 있는 낮에만 햇볕을 쬘 수 있어요.', { type: 'info', emoji: '🌙' }); return false; }
      }
      def.apply(s);
      s.hygiene = clamp(s.hygiene, 0, 100);
      s.tempOff = clamp(s.tempOff, -8, 8);
      s.humOff = clamp(s.humOff, -25, 15);
      s.care[action] = now();
      const top = J.topY;
      if (action === 'vent') { J.lidPulse = 1.6; for (let k = 0; k < 12; k++) G.ffx?.spawn?.(G.ffx.P.STEAM, J.x + (Math.random() - 0.5) * 0.4, top + 0.1, J.z + (Math.random() - 0.5) * 0.4, (Math.random() - 0.5) * 0.6, 0.8 + Math.random() * 0.5, (Math.random() - 0.5) * 0.6); }
      else if (action === 'sun') { J.lidPulse = 1.8; G.ffx?.burst?.(G.ffx.P.SPARK, J.x, top + 0.4, J.z, 18, 0.7, 1.2); }
      else { for (let k = 0; k < 16; k++) { const a = Math.random() * TAU; G.ffx?.spawn?.(G.ffx.P.BUBBLE, J.x + Math.cos(a) * 0.5, J.baseY + 0.3 + Math.random() * 0.7, J.z + Math.sin(a) * 0.5, Math.cos(a) * 0.3, 0.3, Math.sin(a) * 0.3); } G.ffx?.burst?.(G.ffx.P.GLINT, J.x, J.baseY + 0.8, J.z, 6, 0.4, 0.4); }
      G.sys.player?.faceTowards?.(J.x, J.z);
      G.sys.player?.playAction?.('interact');
      G.sfx(action === 'clean' ? 'water' : 'jar');
      G.ffx?.floatText?.(`<b>${def.icon} ${esc(def.name)}</b> ${esc(def.effect)}`, { x: J.x, y: top + 0.9, z: J.z }, 'care');
      G.activity('ferment', `장독 ${def.name}`, { jarId, action });
      G.dirty('ferment');
      this._refreshModal(true);
      return true;
    },
    _careLeft(s, action) { return Math.max(0, FD().careCooldown - (now() - (Number(s.care?.[action]) || 0)) / 1000); },

    async unlock(jarId) {
      if (!G.state) return false;
      const s = this._state(jarId);
      const J = this._jars.get(jarId);
      if (!s || !J || s.owned) return false;
      const F = FD();
      if (this.myJarIds().length >= F.maxJars) { G.ui.toast(`장독은 최대 ${F.maxJars}개까지 가질 수 있어요.`, { type: 'info' }); return false; }
      const price = F.extraJarPrice;
      const prog = G.sys.progression;
      if (!prog?.spendCoin) { G.ui.toast('지금은 장독을 열 수 없어요.', { type: 'error' }); return false; }
      if ((G.state.stats?.coin || 0) < price) { G.ui.toast(`코인이 부족해요. (${fmt(price)} 코인 필요, 보유 ${fmt(G.state.stats?.coin || 0)})`, { type: 'warn', icon: 'coin' }); return false; }
      const ok = await G.ui.confirm(`${fmt(price)} 코인으로 장독을 하나 더 열까요?<br><span class="dim small">장독이 많으면 여러 발효를 동시에 진행할 수 있어요.</span>`, { title: '장독 열기', okText: `${fmt(price)} 코인으로 열기`, icon: 'jar', html: true });
      if (!ok || !G.state || s.owned) return false;
      if (!prog.spendCoin(price)) { G.ui.toast('코인이 부족해요.', { type: 'warn' }); return false; }
      Object.assign(s, { owned: true, status: 'EMPTY', recipeId: null, progress: 0, hygiene: 100, lastUpdate: now() });
      J.burst = 1;
      G.ffx?.burst?.(G.ffx.P.SPARK, J.x, J.topY + 0.2, J.z, 24, 1.2, 1.8);
      G.sfx('coin');
      G.ui.toast('새 장독을 열었어요! 발효를 시작해 보세요.', { type: 'success', emoji: '🏺' });
      G.activity('ferment', '새 장독 열기', { jarId });
      G.dirty('ferment');
      this._syncVisual(J, true);
      this._refreshLabels();
      this._refreshModal(true);
      return true;
    },

    /** debug / test helper */
    setJar(id, patch = {}) {
      const s = this._state(id);
      const J = this._jars.get(id);
      if (!s || !J) return null;
      this._simulate(id);
      if ('owned' in patch) s.owned = !!patch.owned;
      if ('recipeId' in patch) { s.recipeId = recipeOf(patch.recipeId) ? patch.recipeId : null; if (s.recipeId && !s.startedAt) s.startedAt = now(); }
      for (const k of ['progress', 'hygiene', 'tempOff', 'humOff']) if (patch[k] != null) s[k] = Number(patch[k]) || 0;
      s.progress = clamp(s.progress, 0, 100);
      if (patch.status) s.status = patch.status;
      else if (s.recipeId && s.status !== 'CLAIMED') s.status = stageOf(s.progress);
      if (!s.recipeId) s.status = 'EMPTY';
      if (s.recipeId && s.progress > 0 && s.acc.t <= 0) { const el = (s.progress / 100) * recipeOf(s.recipeId).baseDuration; s.acc = { t: el, temp: el * 0.85, hum: el * 0.8, hyg: el * Math.max(s.hygiene, 60) }; }
      if (s.status === 'COMPLETE') {
        const q = this._quality(s, recipeOf(s.recipeId));
        s.quality = q.total; s.qualityParts = { base: q.base, temp: q.temp, hum: q.hum, aging: q.aging, hyg: q.hyg };
        s.completedAt = s.completedAt || now();
      }
      s.lastUpdate = now();
      J.lastStatus = s.status;
      this._syncVisual(J, true);
      this._refreshLabels();
      this._refreshModal(true);
      G.dirty('ferment');
      return this.getJar(id);
    },
    fastForward(sec = 60) {
      for (const id of this._jars.keys()) {
        const s = this._state(id);
        if (s && ACTIVE.has(s.status)) { s.lastUpdate -= sec * 1000; this._simulate(id, now(), false); }
      }
      for (const J of this._jars.values()) this._syncVisual(J, false);
      this._refreshLabels();
      this._refreshModal(true);
    },

    // ------------------------------------------------------------ inventory helpers
    _count(id) { return G.sys.inventory?.count ? G.sys.inventory.count(id) : Number(G.state?.inventory?.[id]) || 0; },
    _take(id, n) {
      if (G.sys.inventory?.remove) return G.sys.inventory.remove(id, n, { source: 'ferment' });
      const inv = G.state?.inventory; if (!inv || (Number(inv[id]) || 0) < n) return false;
      inv[id] -= n; if (inv[id] <= 0) delete inv[id];
      G.bus.emit('item:removed', { itemId: id, qty: n, source: 'ferment' });
      return true;
    },
    _give(id, n, source) {
      if (G.sys.inventory?.add) return G.sys.inventory.add(id, n, { source });
      if (!G.state || !items()[id]) return 0;
      G.state.inventory[id] = (Number(G.state.inventory[id]) || 0) + n;
      G.bus.emit('item:added', { itemId: id, qty: n, source });
      return n;
    },
    _missing(rec) {
      const out = [];
      for (const [id, need] of Object.entries(rec.ingredients || {})) {
        const have = this._count(id);
        if (have < need) out.push({ id, need, have, name: items()[id]?.name || id });
      }
      return out;
    },
    _near(J, range = ACTION_RANGE) {
      const p = G.sys.player?.position;
      if (!p) return true;
      return Math.hypot(p.x - J.x, p.z - J.z) <= range;
    },

    // ------------------------------------------------------------ jar meshes
    _buildJar(def) {
      const scene = G.sys.engine.scene;
      const g = geos(), T = textures();
      const baseY = G.world.surfaceHeight ? G.world.surfaceHeight(def.x, def.z) : G.world.heightAt(def.x, def.z);
      const gy = Number.isFinite(baseY) ? baseY : 0;
      const group = new THREE.Group();
      group.name = 'jar:' + def.id;
      group.position.set(def.x, gy, def.z);
      group.rotation.y = def.rot ?? -PI / 2; // tag & lock face the front walkway (west)
      const stoneMat = G.gfx.material('ferment:plinth', () => {
        let map = null;
        try { map = G.bkit?.tex?.('stone') || null; } catch (e) { map = null; }
        return new THREE.MeshStandardMaterial({ map, color: map ? 0xd8d2c6 : 0x9a958c, roughness: 0.92 });
      });
      const plinth = new THREE.Mesh(g.plinth, stoneMat);
      plinth.receiveShadow = true; plinth.castShadow = true;
      group.add(plinth);
      const PL = 0.16;
      const bodyMat = jarMaterial();
      const body = new THREE.Mesh(g.jar, bodyMat);
      body.position.y = PL; body.castShadow = true; body.receiveShadow = true;
      group.add(body);
      const contentsMat = new THREE.MeshStandardMaterial({ map: T.paste, color: 0x6b4a2b, roughness: 0.38, metalness: 0 });
      const contents = new THREE.Mesh(g.contents, contentsMat);
      contents.position.y = PL + 0.86 * JS; contents.visible = false;
      group.add(contents);
      const lidMat = G.gfx.material('ferment:lid', () => new THREE.MeshStandardMaterial({ map: bodyMat.map, color: bodyMat.map ? 0xffffff : 0x4a2a16, roughness: 0.3, metalness: 0.05 }));
      const lid = new THREE.Group();
      const lidBaseY = PL + JAR_TOP - 0.012;
      lid.position.y = lidBaseY;
      const lidMesh = new THREE.Mesh(g.lid, lidMat); lidMesh.castShadow = true;
      const knob = new THREE.Mesh(g.knob, lidMat); knob.position.y = 0.17 * 0.292 / 0.3 * JS + 0.01; knob.scale.set(1, 0.7, 1);
      lid.add(lidMesh, knob);
      group.add(lid);
      // straw band around the neck + recipe tag (front = local +Z after the group's rotation)
      const bandMat = G.gfx.material('ferment:band', () => new THREE.MeshStandardMaterial({ color: 0xd9c084, roughness: 0.95 }));
      const band = new THREE.Mesh(g.band, bandMat);
      band.position.y = PL + 0.79 * JS;
      group.add(band);
      const tagMat = new THREE.MeshStandardMaterial({ map: T.paste, color: 0xffffff, roughness: 0.85, side: THREE.DoubleSide, transparent: true, alphaTest: 0.4 });
      const tag = new THREE.Mesh(g.tag, tagMat);
      const neckR = 0.33 * JS;
      tag.position.set(0, PL + 0.62 * JS, neckR + 0.105);
      tag.rotation.x = -0.12;
      tag.visible = false;
      group.add(tag);
      // padlock for locked jars
      const brass = G.gfx.material('ferment:brass', () => new THREE.MeshStandardMaterial({ color: 0xc9a14a, roughness: 0.32, metalness: 0.85 }));
      const lock = new THREE.Group();
      const lb = new THREE.Mesh(g.padBody, brass), ls = new THREE.Mesh(g.shackle, brass);
      lock.add(lb, ls);
      lock.position.set(0, PL + 0.66 * JS, 0.42 * JS + 0.05);
      lock.rotation.x = 0.18;
      group.add(lock);
      // glow: additive halo sprite + rotating ground ring (owned jars)
      const haloMat = new THREE.SpriteMaterial({ map: T.halo, color: 0xffc95a, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
      const halo = new THREE.Sprite(haloMat);
      halo.position.y = PL + 0.55 * JS; halo.scale.set(2.5, 2.6, 1);
      halo.raycast = () => {};
      group.add(halo);
      const ringMat = new THREE.MeshBasicMaterial({ map: T.ring, color: 0xffd36e, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
      const ring = new THREE.Mesh(g.ring, ringMat);
      ring.position.y = 0.025; ring.scale.setScalar(2.1);
      ring.raycast = () => {};
      ring.renderOrder = 4;
      group.add(ring);
      // invisible pick proxy (easier clicking)
      const proxy = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, JAR_TOP + 0.4, 10), new THREE.MeshBasicMaterial({ visible: false }));
      proxy.position.y = (JAR_TOP + 0.4) / 2;
      group.add(proxy);
      scene.add(group);
      group.updateMatrixWorld(true);
      // collider so players walk around the jar
      try { G.world.addCollider({ shape: 'circle', x: def.x, z: def.z, r: 0.62, tag: 'jar:' + def.id }); } catch (e) { /* optional */ }
      const J = {
        id: def.id, def, group, body, bodyMat, contents, contentsMat, lid, lidBaseY, band, tag, tagMat, lock, halo, haloMat, ring, ringMat,
        x: def.x, z: def.z, baseY: gy, topY: gy + PL + JAR_TOP, lidT: 0, lidPulse: 0, burst: 0, stagePop: 0,
        steamAcc: 0, bubbleAcc: 0, sparkAcc: 0, lastStatus: null, visKey: '', label: null, labelEls: null,
        labelPos: new THREE.Vector3(def.x, gy + PL + JAR_TOP + 0.7, def.z),
      };
      this._jars.set(def.id, J);
      try { G.world.registerObject?.(def.id, group); } catch (e) { /* ignore */ }
      this._buildLabel(J);
      this._registerJar(J);
    },

    _registerJar(J) {
      if (!G.interact?.register) return;
      const self = this;
      G.interact.register({
        id: J.id, kind: 'jar',
        label: () => {
          const s = self._state(J.id);
          if (!s) return '장독 확인';
          if (!s.owned) return '잠긴 장독 살펴보기';
          if (s.status === 'COMPLETE') return '장독 확인 · 수령하기';
          return '장독 확인';
        },
        position: new THREE.Vector3(J.x, J.baseY, J.z),
        object: J.group,
        radius: 2.3,
        priority: 0.2,
        enabled: () => !!G.state && self._ready,
        onInteract: () => self.openJar(J.id),
      });
    },

    _syncVisual(J, force) {
      const s = this._state(J.id);
      if (!s) return;
      const rec = recipeOf(s.recipeId);
      const hasContents = !!rec && s.status !== 'CLAIMED' && s.status !== 'EMPTY';
      const key = `${s.owned}|${s.status}|${s.recipeId}|${hasContents}`;
      if (!force && key === J.visKey) return;
      J.visKey = key;
      J.lock.visible = !s.owned;
      J.contents.visible = hasContents;
      if (rec) J.contentsMat.color.set(rec.color || '#6b4a2b');
      J.tag.visible = hasContents;
      if (hasContents) {
        const name = (rec.name || '').replace(/\s*체험$/, '');
        J.tagMat.map = tagTexture(name, rec.color || '#6b4a2b');
        J.tagMat.needsUpdate = true;
      }
      // glaze: locked jars look dusty/desaturated, owned ones get a faint recipe tint
      const c = J.bodyMat.color;
      if (!s.owned) c.setRGB(0.62, 0.6, 0.58);
      else if (rec && hasContents) c.setRGB(1, 1, 1).lerp(new THREE.Color(rec.color), 0.08);
      else c.setRGB(1, 1, 1);
      if (J.lastStatus !== s.status) J.lastStatus = s.status;
    },

    _animateJar(J, dt, t, reduce) {
      const s = this._state(J.id);
      if (!s) return;
      const owned = !!s.owned;
      const complete = s.status === 'COMPLETE';
      const active = ACTIVE.has(s.status);
      // lid: open while the jar modal is open, short pulse for care / start / claim
      const wantOpen = (this._modal && this._modal.jarId === J.id && !this._modal.m.closed) || J.lidPulse > 0;
      if (J.lidPulse > 0) J.lidPulse -= dt;
      const target = wantOpen && owned ? 1 : 0;
      J.lidT += (target - J.lidT) * Math.min(1, dt * 6);
      const e = J.lidT * J.lidT * (3 - 2 * J.lidT);
      J.lid.position.y = J.lidBaseY + e * 0.32;
      J.lid.position.z = -e * 0.12;
      J.lid.rotation.x = -e * 0.42;
      // glow strength by status
      const base = !owned ? 0 : complete ? 1 : active ? 0.65 : 0.5;
      const pulse = reduce ? 0.85 : 0.75 + 0.25 * Math.sin(t * (complete ? 4.2 : 2.2) + J.x);
      const glow = base * pulse;
      J.haloMat.opacity = glow * (complete ? 0.85 : 0.5);
      if (glow > 0) {
        // pull the halo sprite toward the camera so the glow washes over the jar's front, not only its rim
        _v.set(_cam.x - J.x, 0, _cam.z - J.z);
        const len = _v.length() || 1;
        _v.multiplyScalar(0.55 / len);
        _v.x += J.x; _v.z += J.z; _v.y = J.baseY + 0.16 + 0.55 * JS;
        J.group.worldToLocal(_v);
        J.halo.position.copy(_v);
      }
      J.ringMat.opacity = glow * 0.95;
      J.ring.rotation.y = reduce ? 0 : t * 0.35;
      const rs = 2.1 + (complete && !reduce ? Math.sin(t * 4.2) * 0.08 : 0);
      J.ring.scale.set(rs, 1, rs);
      J.bodyMat.emissiveIntensity = glow * (complete ? 0.2 : 0.1);
      J.bodyMat.userData.rim.uRim.value = glow * (complete ? 1.7 : 1.25);
      // particles only when the camera is near
      const d = Math.hypot(_cam.x - J.x, _cam.z - J.z);
      const fx = G.ffx;
      if (!fx || d > 45 || reduce) { J.burst = 0; J.stagePop = 0; return; }
      if (J.burst > 0) { J.burst = 0; fx.burst(fx.P.SPARK, J.x, J.topY + 0.3, J.z, 34, 1.5, 2.4); fx.burst(fx.P.PETAL, J.x, J.topY + 0.2, J.z, 12, 1.0, 2.0, null, J.baseY); }
      if (J.stagePop > 0) { J.stagePop = 0; fx.burst(fx.P.SPARK, J.x, J.topY + 0.15, J.z, 10, 0.7, 1.2); }
      if (active || complete) {
        const open = J.lidT > 0.4;
        J.steamAcc += dt * (open ? 3.2 : active ? 1.1 : 0.4);
        while (J.steamAcc >= 1) {
          J.steamAcc -= 1;
          const a = Math.random() * TAU, r = open ? Math.random() * 0.22 : 0.3 * JS * 0.95;
          fx.spawn(fx.P.STEAM, J.x + Math.cos(a) * r, (open ? J.baseY + 0.16 + 0.88 * JS : J.topY - 0.03), J.z + Math.sin(a) * r, Math.cos(a) * 0.12, 0.3 + Math.random() * 0.25, Math.sin(a) * 0.12);
        }
        if (open && active) {
          J.bubbleAcc += dt * 7;
          while (J.bubbleAcc >= 1) {
            J.bubbleAcc -= 1;
            const a = Math.random() * TAU, r = Math.sqrt(Math.random()) * 0.24 * JS;
            fx.spawn(fx.P.BUBBLE, J.x + Math.cos(a) * r, J.baseY + 0.17 + 0.86 * JS, J.z + Math.sin(a) * r, 0, 0.12 + Math.random() * 0.1, 0);
          }
        }
      }
      if (owned) {
        J.sparkAcc += dt * (complete ? 5 : 1.4);
        while (J.sparkAcc >= 1) {
          J.sparkAcc -= 1;
          const a = Math.random() * TAU, r = 0.45 + Math.random() * 0.35;
          fx.spawn(fx.P.GLINT, J.x + Math.cos(a) * r, J.baseY + 0.3 + Math.random() * (JAR_TOP + 0.4), J.z + Math.sin(a) * r, 0, 0.18, 0);
        }
      }
    },

    // ------------------------------------------------------------ labels
    _buildLabel(J) {
      if (!G.ui?.label) return;
      const el = document.createElement('div');
      el.className = 'jar-label';
      el.innerHTML = '<span class="jl-ico"><span class="emoji">🏺</span></span><span class="jl-text"><b class="jl-title"></b><small class="jl-sub"></small><span class="jl-bar"><i></i></span><em class="jl-note"></em></span>';
      J.labelEls = { el, title: el.querySelector('.jl-title'), sub: el.querySelector('.jl-sub'), bar: el.querySelector('.jl-bar > i'), note: el.querySelector('.jl-note'), ico: el.querySelector('.jl-ico .emoji'), last: {} };
      J.label = G.ui.label({ el, target: J.labelPos, maxDist: 32, fadeDist: 6, onClick: (ev) => { ev.stopPropagation(); this.openJar(J.id); } });
      J.label.setVisible(false);
    },
    _refreshLabels() {
      for (const J of this._jars.values()) {
        const E = J.labelEls;
        if (!E || !J.label) continue;
        const s = this._state(J.id);
        if (!s || !G.state) { J.label.setVisible(false); continue; }
        if (!J.label.visible) J.label.setVisible(true);
        const rec = recipeOf(s.recipeId);
        const L = E.last;
        const set = (k, el, v) => { if (L[k] !== v) { L[k] = v; el.textContent = v; } };
        let cls, title, sub, note = '', ico = '🏺', pct = 0;
        const n = J.def.slot || Number(J.id.replace(/\D/g, '')) || 1;
        if (!s.owned) {
          cls = 'locked'; ico = '🔒'; title = '잠긴 장독'; sub = `${fmt(FD().extraJarPrice)} 코인`;
        } else {
          title = J.id === 'J1' ? '내 항아리' : `내 장독 #${n}`;
          if (s.status === 'COMPLETE') { cls = 'complete'; ico = rec?.icon || '🏺'; sub = `✨ ${rec ? rec.name.replace(/\s*체험$/, '') : '발효'} 완성! 수령하세요`; pct = 100; }
          else if (ACTIVE.has(s.status) && rec) { cls = 'active'; ico = rec.icon || '🏺'; pct = Math.floor(s.progress); sub = `${rec.name.replace(/\s*체험$/, '')} · ${STATE_NAMES()[s.status]} ${pct}%`; }
          else { cls = 'empty'; sub = s.status === 'CLAIMED' ? '수령 완료 · 새 발효를 시작해 보세요' : '비어 있음 · 발효를 시작해 보세요'; }
          if (J.id === 'J1') note = '계정당 1개 배정';
        }
        if (L.cls !== cls) {
          if (L.cls) E.el.classList.remove(L.cls);
          E.el.classList.add(cls); L.cls = cls;
          // stagger: my jars float higher than the compact locked tags so neighbouring labels do not overlap
          J.labelPos.y = J.topY + (cls === 'locked' ? 0.3 : J.id === 'J1' ? 1.05 : 0.75);
        }
        set('title', E.title, title);
        set('sub', E.sub, sub);
        set('note', E.note, note);
        set('ico', E.ico, ico);
        const w = `${pct}%`;
        if (L.w !== w) { L.w = w; E.bar.style.width = w; }
      }
    },

    // ------------------------------------------------------------ jar modal
    openJar(id) {
      const J = this._jars.get(id);
      if (!J || !G.state) return null;
      const s = this._simulate(id);
      const self = this;
      const m = G.ui.modal.open({
        id: 'ferment-jar', size: 'lg', className: 'jar-modal', title: '장독', icon: '🏺',
        body: (b) => b.classList.add('jm-body'),
        onClose: () => { if (self._modal?.m === m) self._modal = null; },
      });
      this._modal = { m, jarId: id, key: '', els: null };
      this._refreshModal(true);
      if (s?.owned) {
        G.bus.emit('ferment:checked', { jarId: id });
        G.log.info('FERMENTATION', `checked ${id} (${s.status} ${Math.floor(s.progress)}%)`);
      }
      return m;
    },
    _refreshModal(force) {
      const md = this._modal;
      if (!md) return;
      if (md.m.closed) { this._modal = null; return; }
      const J = this._jars.get(md.jarId);
      const s = this._state(md.jarId);
      if (!J || !s) return;
      const near = this._near(J);
      const invSig = OPEN_FOR_START.has(s.status) ? Object.keys(recipes()).map((rid) => Object.keys(recipes()[rid].ingredients || {}).map((i) => this._count(i)).join('.')).join('|') : '';
      const coinSig = !s.owned ? String((G.state.stats?.coin || 0) >= FD().extraJarPrice) : '';
      const key = `${s.owned}|${s.status}|${s.recipeId}|${near}|${invSig}|${coinSig}`;
      if (force || key !== md.key) { md.key = key; this._renderJar(md, J, s, near); }
      this._updateJarValues(md, J, s);
    },

    _renderJar(md, J, s, near) {
      const m = md.m, h = G.ui.h;
      const body = m.body;
      body.innerHTML = '';
      md.els = null;
      const n = J.def.slot || 1;
      const rec = recipeOf(s.recipeId);
      const statusName = STATE_NAMES()[s.status] || s.status;
      const disclaimer = () => h('p', { class: 'tiny muted jm-disclaimer' }, G.data.meta?.disclaimer || '');
      const farNote = () => (near ? null : h('div', { class: 'notice-box mt-1' }, '장독대 가까이 가야 장독을 돌보거나 발효를 시작할 수 있어요.'));
      const goBtn = { label: '장독으로 가기', class: 'btn-primary', icon: 'pin', onClick: () => { this._goTo(J); } };
      // ---------------- locked
      if (!s.owned) {
        m.setTitle(`잠긴 장독 #${n}`, '🔒');
        const price = FD().extraJarPrice, coin = G.state.stats?.coin || 0;
        body.append(
          h('div', { class: 'jm-hero locked' },
            h('div', { class: 'jm-jar-ico' }, h('span', { class: 'emoji' }, '🔒')),
            h('div', { class: 'grow' },
              h('div', { class: 'row wrap' }, h('b', { class: 'jm-name' }, '아직 열지 않은 장독'), h('span', { class: 'chip' }, `최대 ${FD().maxJars}개`)),
              h('p', { class: 'dim small' }, '장독을 하나 더 열면 여러 가지 발효를 동시에 진행할 수 있어요. 첫 번째 장독(내 항아리)은 계정마다 1개씩 무료로 배정돼요.'))),
          h('div', { class: 'jm-price' },
            h('span', { class: 'ico ico-lg', 'data-icon': 'coin' }),
            h('div', null, h('b', null, `${fmt(price)} 코인`), h('div', { class: 'small muted' }, `보유 ${fmt(coin)} 코인${coin < price ? ` · ${fmt(price - coin)} 코인 부족` : ''}`))),
          h('div', { class: 'notice-box info' }, '💡 수확한 작물이나 완성한 발효식품을 매점에 팔면 코인을 모을 수 있어요.'));
        const ffL = farNote(); if (ffL) body.appendChild(ffL);
        G.ui.hydrateIcons(body);
        const acts = [{ label: '닫기', class: 'btn-ghost' }];
        if (near) acts.push({ label: `${fmt(price)} 코인으로 열기`, class: 'btn-gold', icon: 'lock', disabled: coin < price, onClick: async () => { await this.unlock(J.id); return false; } });
        else acts.push(goBtn);
        m.setActions(acts);
        return;
      }
      const title = J.id === 'J1' ? '내 항아리' : `내 장독 #${n}`;
      // ---------------- empty / claimed: recipe picker
      if (OPEN_FOR_START.has(s.status)) {
        m.setTitle(title, '🏺');
        const last = recipeOf(s.lastRecipe);
        body.append(h('div', { class: 'jm-hero' },
          h('div', { class: 'jm-jar-ico' }, h('span', { class: 'emoji' }, '🏺')),
          h('div', { class: 'grow' },
            h('div', { class: 'row wrap' }, h('b', { class: 'jm-name' }, '빈 장독'), h('span', { class: 'chip' }, statusName), J.id === 'J1' ? h('span', { class: 'chip chip-gold' }, '계정당 1개 배정') : null),
            h('p', { class: 'dim small' }, last ? `지난 발효: ${last.name} · 품질 ${s.lastQuality ?? s.quality}점 (${gradeOf(s.lastQuality ?? s.quality)}). 새 재료를 넣어 다시 발효를 시작해 보세요.` : '재료를 넣고 발효를 시작해 보세요. 날씨(온도·습도)와 장독 관리에 따라 품질이 달라져요.'))));
        body.appendChild(h('div', { class: 'jm-section-title' }, h('span', { class: 'emoji' }, '📜'), '발효 레시피 고르기'));
        const grid = h('div', { class: 'jm-recipes' });
        for (const r of Object.values(recipes())) {
          const miss = this._missing(r);
          const ok = !miss.length;
          const ings = Object.entries(r.ingredients || {}).map(([iid, need]) => {
            const have = this._count(iid);
            const it = items()[iid];
            return h('span', { class: `jm-ing ${have >= need ? 'ok' : 'no'}`, title: INGREDIENT_HINTS[iid] || '' }, h('span', { class: 'emoji' }, it?.icon || '❔'), `${it?.name || iid} `, h('b', null, `${Math.min(have, 99)}/${need}`));
          });
          const card = h('div', { class: `jm-recipe ${ok ? 'ok' : 'lack'}` },
            h('div', { class: 'jm-r-head' }, h('span', { class: 'emoji jm-r-ico' }, r.icon || '🏺'), h('div', { class: 'grow' }, h('b', null, r.name), h('div', { class: 'tiny muted' }, `약 ${U.formatDuration(r.baseDuration)} · 알맞은 온도 ${r.idealTemp[0]}~${r.idealTemp[1]}°C · 습도 ${r.idealHumidity[0]}~${r.idealHumidity[1]}%`))),
            h('p', { class: 'small dim jm-r-desc' }, r.desc || ''),
            h('div', { class: 'jm-ings' }, ings),
            h('div', { class: 'jm-r-foot' },
              h('span', { class: 'tiny muted' }, `완성품 ${items()[r.resultItem]?.icon || ''} ${items()[r.resultItem]?.name || ''} ×${r.resultQty} · EXP ${r.exp} · 코인 ${fmt(r.coin)}`),
              h('button', { class: `btn btn-sm ${ok ? 'btn-primary' : 'btn-soft'}`, type: 'button', disabled: !ok || !near || null, onclick: () => this.start(J.id, r.id) }, ok ? '발효 시작' : '재료 부족')));
          card.style.setProperty('--rc', r.color || '#8a5a3b');
          grid.appendChild(card);
        }
        body.appendChild(grid);
        const hints = Object.entries(INGREDIENT_HINTS).filter(([iid]) => ['ITEM_MEJU', 'ITEM_GOCHUGARU', 'ITEM_SALT', 'ITEM_CABBAGE'].includes(iid));
        body.appendChild(h('div', { class: 'notice-box info jm-hints' }, h('b', null, '재료 구하는 곳'), h('ul', null, hints.map(([iid, t]) => h('li', null, `${items()[iid]?.icon || ''} ${items()[iid]?.name || iid}: ${t}`)))));
        const ff = farNote(); if (ff) body.appendChild(ff);
        body.appendChild(disclaimer());
        G.ui.hydrateIcons(body);
        const acts = [{ label: '닫기', class: 'btn-ghost' }];
        if (G.sys.education?.open) acts.unshift({ label: '장독대 알아보기', class: 'btn-soft', icon: 'book', onClick: () => { G.sys.education.open('EDU_JANGDOK'); } });
        if (!near) acts.push(goBtn);
        else if (G.sys.fermentation?.openCraft) acts.push({ label: '작업대 레시피', class: 'btn-soft', icon: 'hammer', onClick: () => { this.openCraft(); return false; } });
        m.setActions(acts);
        return;
      }
      if (!rec) return;
      // ---------------- active / complete
      const els = {};
      const complete = s.status === 'COMPLETE';
      m.setTitle(`${title} · ${rec.name}`, rec.icon || '🏺');
      els.ring = h('div', { class: `jm-ring ${complete ? 'done' : ''}` }, h('span', { class: 'emoji' }, rec.icon || '🏺'));
      els.ring.style.setProperty('--rc', rec.color || '#8a5a3b');
      els.chip = h('span', { class: `chip ${complete ? 'chip-gold' : 'chip-green'}` }, statusName);
      body.appendChild(h('div', { class: 'jm-hero' }, els.ring,
        h('div', { class: 'grow' },
          h('div', { class: 'row wrap' }, h('b', { class: 'jm-name' }, complete ? `${rec.name} 완성!` : rec.name), els.chip, J.id === 'J1' ? h('span', { class: 'chip chip-gold' }, '내 항아리') : null),
          h('p', { class: 'dim small' }, complete ? '발효와 숙성이 모두 끝났어요. 수령하면 완성품과 보상을 받아요.' : rec.desc || ''))));
      // timeline
      const steps = [['PREPARING', '재료 준비'], ['FERMENTING', '발효'], ['AGING', '숙성'], ['COMPLETE', '완성']];
      els.timeline = h('div', { class: 'jm-timeline' }, steps.map(([k, label]) => h('div', { class: 'jm-step', dataset: { k } }, h('i'), h('span', null, label))));
      body.appendChild(els.timeline);
      // progress
      els.pbar = h('div', { class: 'bar bar-lg bar-gold' }, h('i'));
      els.pct = h('b', null, '0%');
      els.left = h('span', { class: 'muted' }, '');
      els.speed = h('span', { class: 'chip' }, '');
      body.appendChild(h('div', { class: 'jm-progress' },
        h('div', { class: 'row-between' }, h('span', { class: 'row' }, h('span', { class: 'ico ico-sm', 'data-icon': 'clock' }), '발효 진행률 ', els.pct), h('span', { class: 'row' }, els.left, complete ? null : els.speed)),
        els.pbar));
      // environment gauges
      const gauge = (key, icon, label, min, max, unit) => {
        const wrap = h('div', { class: `jm-gauge g-${key}` },
          h('div', { class: 'jm-g-head' }, h('span', { class: 'emoji' }, icon), h('span', null, label), h('b', { class: 'jm-g-val' }, '-'), h('span', { class: 'jm-g-state' }, '')),
          h('div', { class: 'jm-g-track' }, h('div', { class: 'jm-g-ideal' }), h('div', { class: 'jm-g-mark' })),
          h('div', { class: 'jm-g-scale tiny muted' }, h('span', null, `${min}${unit}`), h('span', { class: 'jm-g-ideal-txt' }, ''), h('span', null, `${max}${unit}`)));
        wrap._min = min; wrap._max = max; wrap._unit = unit;
        return wrap;
      };
      els.gT = gauge('temp', '🌡️', '온도', 0, 40, '°C');
      els.gH = gauge('hum', '💧', '습도', 0, 100, '%');
      els.gY = gauge('hyg', '🧼', '위생', 0, 100, '%');
      els.envNote = h('div', { class: 'tiny muted jm-env-note' }, '');
      body.appendChild(h('div', { class: 'jm-env' }, h('div', { class: 'jm-section-title' }, h('span', { class: 'emoji' }, '🌤️'), '장독 환경'), h('div', { class: 'jm-gauges' }, els.gT, els.gH, els.gY), els.envNote));
      // care
      if (!complete) {
        els.care = {};
        const grid = h('div', { class: 'jm-care' });
        for (const [k, c] of Object.entries(CARE)) {
          const btn = h('button', { class: 'jm-care-btn', type: 'button', disabled: !near || null, title: c.desc, onclick: () => this.care(J.id, k) },
            h('span', { class: 'emoji jm-care-ico' }, c.icon),
            h('b', null, c.name),
            h('span', { class: 'tiny muted' }, c.effect),
            h('span', { class: 'jm-care-cd tiny' }, ''));
          els.care[k] = btn;
          grid.appendChild(btn);
        }
        body.appendChild(h('div', { class: 'jm-section-title' }, h('span', { class: 'emoji' }, '🧑‍🌾'), '장독 돌보기', h('span', { class: 'tiny muted' }, ` · 각 ${FD().careCooldown}초마다 할 수 있어요`)));
        body.appendChild(grid);
      } else {
        const q = clamp(Math.round(s.quality || 0), 0, 100);
        const bonus = q >= 90 ? 1 : 0;
        body.appendChild(h('div', { class: 'jm-reward' },
          h('div', { class: 'jm-section-title' }, h('span', { class: 'emoji' }, '🎁'), '수령 보상'),
          h('div', { class: 'row wrap' },
            h('span', { class: 'chip chip-gold' }, `${items()[rec.resultItem]?.icon || ''} ${items()[rec.resultItem]?.name || ''} ×${(rec.resultQty || 1) + bonus}${bonus ? ' (보너스 +1)' : ''}`),
            h('span', { class: 'chip chip-green' }, `EXP +${fmt(rec.exp || 0)}`),
            h('span', { class: 'chip chip-gold' }, h('span', { class: 'ico ico-xs', 'data-icon': 'coin' }), ` ${fmt(rec.coin || 0)}`))));
      }
      // quality
      els.qScore = h('b', { class: 'jm-q-score' }, '0');
      els.qGrade = h('span', { class: 'jm-q-grade' }, '');
      const row = (label, cls, range) => { const v = h('b', null, '0'); const r = h('div', { class: `jm-f-row ${cls}` }, h('span', null, label), h('span', { class: 'tiny muted' }, range), v); r._v = v; return r; };
      els.fBase = row('기본 품질', 'base', '레시피');
      els.fTemp = row('+ 온도 보너스', 'plus', '0~15');
      els.fHum = row('+ 습도 보너스', 'plus', '0~10');
      els.fAge = row('+ 숙성 보너스', 'plus', '0~15');
      els.fHyg = row('− 위생 감점', 'minus', '0~20');
      els.fTot = row(complete ? '= 최종 품질' : '= 예상 품질', 'total', '');
      body.appendChild(h('div', { class: 'jm-quality' },
        h('div', { class: 'jm-q-main' }, h('div', { class: 'tiny muted' }, complete ? '최종 품질' : '예상 품질'), h('div', { class: 'row' }, els.qScore, h('span', { class: 'muted' }, '점')), els.qGrade,
          h('div', { class: 'tiny muted jm-grades' }, '등급 ' + (FD().gradeNames || []).filter(([min]) => min > 0).map(([min, name]) => `${name} ${min}+`).join(' · '))),
        h('div', { class: 'jm-formula' }, els.fBase, els.fTemp, els.fHum, els.fAge, els.fHyg, els.fTot)));
      body.appendChild(h('p', { class: 'tiny muted' }, complete ? '품질은 발효가 끝난 순간의 기록으로 확정됐어요.' : '지금까지의 온도·습도·위생 기록으로 계산한 예상 품질이에요. 발효가 끝나는 순간 확정돼요.'));
      const ff = farNote(); if (ff) body.appendChild(ff);
      body.appendChild(disclaimer());
      G.ui.hydrateIcons(body);
      md.els = els;
      const acts = [];
      if (rec.edu && G.sys.education?.open) acts.push({ label: '자세히 알아보기', class: 'btn-soft', icon: 'book', onClick: () => { G.sys.education.open(rec.edu); } });
      acts.push({ label: '닫기', class: 'btn-ghost' });
      if (complete) acts.push(near ? { label: '수령하기', class: 'btn-gold', icon: 'gift', onClick: () => !!this.claim(J.id) } : goBtn);
      else if (!near) acts.push(goBtn);
      m.setActions(acts);
    },

    _updateJarValues(md, J, s) {
      const els = md.els;
      const rec = recipeOf(s.recipeId);
      if (!els || !rec) return;
      const info = this.getJar(J.id);
      const complete = s.status === 'COMPLETE';
      const pct = Math.floor(s.progress);
      const txt = (el, v) => { if (el && el.textContent !== v) el.textContent = v; };
      txt(els.pct, `${pct}%`);
      const iw = `${pct}%`;
      const pi = els.pbar.firstChild;
      if (pi.style.width !== iw) pi.style.width = iw;
      els.ring.style.setProperty('--p', String(pct));
      txt(els.chip, STATE_NAMES()[s.status] || s.status);
      txt(els.left, complete ? '발효 완료!' : `남은 시간 약 ${U.formatDuration(info.remaining)}`);
      const spd = info.speed;
      txt(els.speed, spd >= 1.08 ? `빠름 ×${spd.toFixed(2)}` : spd <= 0.9 ? `느림 ×${spd.toFixed(2)}` : `보통 ×${spd.toFixed(2)}`);
      els.speed.className = `chip ${spd >= 1.08 ? 'chip-green' : spd <= 0.9 ? 'chip-red' : ''}`;
      // timeline
      const order = ['PREPARING', 'FERMENTING', 'AGING', 'COMPLETE'];
      const ci = order.indexOf(s.status);
      els.timeline.querySelectorAll('.jm-step').forEach((el, i) => { el.classList.toggle('done', i < ci || complete); el.classList.toggle('cur', i === ci && !complete); });
      // gauges
      const setG = (g, v, lo, hi, fmtV) => {
        const span = g._max - g._min;
        const pos = clamp((v - g._min) / span * 100, 0, 100);
        const ideal = g.querySelector('.jm-g-ideal'), mark = g.querySelector('.jm-g-mark');
        const l = `${clamp((lo - g._min) / span * 100, 0, 100)}%`, w = `${clamp((hi - lo) / span * 100, 0, 100)}%`;
        if (ideal.style.left !== l) ideal.style.left = l;
        if (ideal.style.width !== w) ideal.style.width = w;
        const mp = `${pos.toFixed(1)}%`;
        if (mark.style.left !== mp) mark.style.left = mp;
        txt(g.querySelector('.jm-g-val'), fmtV);
        const stTxt = v < lo ? '낮음' : v > hi ? '높음' : '알맞음';
        const st = g.querySelector('.jm-g-state');
        txt(st, stTxt);
        st.className = `jm-g-state ${stTxt === '알맞음' ? 'ok' : 'off'}`;
        txt(g.querySelector('.jm-g-ideal-txt'), `알맞은 범위 ${lo}~${hi}${g._unit}`);
      };
      setG(els.gT, info.temp, rec.idealTemp[0], rec.idealTemp[1], `${info.temp.toFixed(1)}°C`);
      setG(els.gH, info.humidity, rec.idealHumidity[0], rec.idealHumidity[1], `${Math.round(info.humidity)}%`);
      setG(els.gY, s.hygiene, 70, 100, `${Math.round(s.hygiene)}%`);
      const env = info.env;
      txt(els.envNote, `바깥 날씨 ${env.weatherName} · ${env.temp.toFixed(1)}°C · 습도 ${Math.round(env.humidity)}%${env.source === 'default' ? ' (기본값)' : ''} · ${env.day ? '낮' : '밤'}${(s.tempOff || s.humOff) && !complete ? ` · 장독 관리 효과 온도 ${s.tempOff >= 0 ? '+' : ''}${s.tempOff.toFixed(1)}°C, 습도 ${s.humOff >= 0 ? '+' : ''}${Math.round(s.humOff)}%` : ''}`);
      // quality
      const q = info.qualityParts || this._quality(s, rec);
      const total = complete ? clamp(Math.round(s.quality), 0, 100) : q.total;
      txt(els.qScore, String(total));
      const grade = gradeOf(total);
      txt(els.qGrade, `${grade} 등급`);
      els.qGrade.className = `jm-q-grade g-${['최상', '상', '중', '하'].indexOf(grade)}`;
      txt(els.fBase._v, String(q.base));
      txt(els.fTemp._v, `+${q.temp}`);
      txt(els.fHum._v, `+${q.hum}`);
      txt(els.fAge._v, `+${q.aging}`);
      txt(els.fHyg._v, q.hyg ? `−${q.hyg}` : '0');
      txt(els.fTot._v, `${total} · ${grade}`);
      // care cooldowns
      if (els.care) {
        const env2 = info.env;
        for (const [k, btn] of Object.entries(els.care)) {
          const left = this._careLeft(s, k);
          let reason = '';
          if (left > 0) reason = `${Math.ceil(left)}초 뒤 가능`;
          else if (k === 'sun' && env2.raining) reason = '비·눈이 와서 불가';
          else if (k === 'sun' && !env2.day) reason = '밤에는 불가';
          const cd = btn.querySelector('.jm-care-cd');
          txt(cd, reason || '지금 가능');
          cd.classList.toggle('ready', !reason);
          const dis = !!reason || !this._near(J);
          if (btn.disabled !== dis) btn.disabled = dis;
        }
      }
    },
    _goTo(J) {
      this._modal?.m?.close();
      const pl = G.sys.player;
      if (G.interact?.activate) { G.interact.activate(J.id); return; }
      pl?.walkTo?.({ x: J.x - 1.6, z: J.z }, { stopDistance: 0.4 });
    },

    // ------------------------------------------------------------ craft table + jar displays
    _registerCraftAndDisplays() {
      if (!G.interact?.register) return;
      const L = G.data.layout || {};
      const self = this;
      const ct = L.craftTable;
      if (ct) {
        const y = (G.world.surfaceHeight?.(ct.x, ct.z)) || 0;
        G.interact.register({
          id: ct.id || 'CRAFT_TABLE', kind: 'craft', label: '재료 만들기',
          position: new THREE.Vector3(ct.x, y, ct.z), object: G.world.getObject(ct.id) || null, radius: 2.8,
          enabled: () => !!G.state, onInteract: () => self.openCraft(),
        });
      }
      for (const jd of L.jarDisplays || []) {
        const y = (G.world.surfaceHeight?.(jd.x, jd.z)) || 0;
        G.interact.register({
          id: jd.id, kind: 'jardisp', label: '옹기 살펴보기',
          position: new THREE.Vector3(jd.x, y, jd.z), object: G.world.getObject(jd.id) || null, radius: 2.2,
          enabled: () => !!G.state, onInteract: () => self.openJarDisplay(jd.id),
        });
      }
      // props may register anchors after us (load order) -> attach objects when they appear
      G.bus.on('world:object', ({ id, obj }) => {
        if (id === ct?.id || (L.jarDisplays || []).some((d) => d.id === id)) G.interact.setObject?.(id, obj);
      });
    },

    openCraft() {
      if (!G.state) return null;
      const self = this;
      const m = G.ui.modal.open({
        id: 'ferment-craft', size: 'lg', className: 'craft-modal', title: '발효 재료 작업대', icon: '🛠️',
        body: (b) => b.classList.add('cm-body'),
        actions: [{ label: '닫기', class: 'btn-ghost' }],
        onClose: () => { if (self._craftModal === m) self._craftModal = null; },
      });
      this._craftModal = m;
      this._renderCraft();
      return m;
    },
    _renderCraft() {
      const m = this._craftModal;
      if (!m || m.closed) { this._craftModal = null; return; }
      const h = G.ui.h;
      const body = m.body;
      const scroll = body.scrollTop;
      body.innerHTML = '';
      body.appendChild(h('p', { class: 'dim small cm-intro' }, '수확한 작물로 발효에 쓰는 재료를 만들어요. 만든 재료는 장독대에서 발효를 시작할 때 쓰여요.'));
      const list = h('div', { class: 'cm-list' });
      for (const c of Object.values(G.data.crafts || {})) {
        const ins = Object.entries(c.in || {});
        const ok = ins.every(([iid, q]) => this._count(iid) >= q);
        const chip = (iid, q, have) => {
          const it = items()[iid];
          return h('span', { class: `cm-chip ${have == null ? 'out' : have >= q ? 'ok' : 'no'}` }, h('span', { class: 'emoji' }, it?.icon || '❔'), h('span', null, it?.name || iid), h('b', null, have == null ? `×${q}` : `${Math.min(have, 999)}/${q}`));
        };
        list.appendChild(h('div', { class: `cm-card ${ok ? 'ok' : 'lack'}` },
          h('div', { class: 'cm-ico emoji' }, c.icon || '🛠️'),
          h('div', { class: 'grow' },
            h('div', { class: 'row wrap' }, h('b', null, c.name), h('span', { class: 'chip chip-green' }, `EXP +${c.exp || 0}`)),
            h('p', { class: 'small dim' }, c.desc || ''),
            h('div', { class: 'cm-flow' },
              h('div', { class: 'cm-chips' }, ins.map(([iid, q]) => chip(iid, q, this._count(iid)))),
              h('span', { class: 'cm-arrow ico', 'data-icon': 'chevron-right' }),
              h('div', { class: 'cm-chips' }, Object.entries(c.out || {}).map(([iid, q]) => chip(iid, q, null))))),
          h('button', { class: `btn ${ok ? 'btn-primary' : 'btn-soft'} cm-btn`, type: 'button', disabled: !ok || null, onclick: () => this.craft(c.id) }, ok ? '만들기' : '재료 부족')));
      }
      body.appendChild(list);
      body.appendChild(h('div', { class: 'notice-box info mt-1' }, '💡 콩은 전통작물 구역 콩밭에서, 고추는 고추밭에서, 허브는 허브 구역에서 수확할 수 있어요.'));
      body.appendChild(h('p', { class: 'tiny muted mt-1' }, '게임 속 재료 만들기 과정은 실제 과정을 단순화한 교육용 체험이에요.'));
      G.ui.hydrateIcons(body);
      body.scrollTop = scroll;
    },
    craft(craftId) {
      if (!G.state) return false;
      const c = G.data.crafts?.[craftId];
      if (!c) return false;
      const ins = Object.entries(c.in || {});
      const lack = ins.filter(([iid, q]) => this._count(iid) < q);
      if (lack.length) { G.ui.toast(`재료가 부족해요: ${lack.map(([iid, q]) => `${items()[iid]?.name || iid} ${q - this._count(iid)}개`).join(', ')}`, { type: 'warn' }); return false; }
      const taken = [];
      for (const [iid, q] of ins) {
        if (this._take(iid, q)) taken.push([iid, q]);
        else { for (const [ri, rq] of taken) this._give(ri, rq, 'refund'); return false; }
      }
      for (const [iid, q] of Object.entries(c.out || {})) this._give(iid, q, 'craft');
      if (c.exp && G.sys.progression?.grant) G.sys.progression.grant({ exp: c.exp }, { popup: false, reason: 'craft' });
      const ct = G.data.layout?.craftTable;
      if (ct && G.ffx) {
        const y = (G.world.surfaceHeight?.(ct.x, ct.z) || 0) + 0.95;
        G.ffx.burst(G.ffx.P.DUST, ct.x, y, ct.z, 10, 0.6, 0.8);
        G.ffx.burst(G.ffx.P.SPARK, ct.x, y + 0.2, ct.z, 12, 0.8, 1.2);
      }
      if (G.sys.player && ct && Math.hypot(G.sys.player.position.x - ct.x, G.sys.player.position.z - ct.z) < 6) { G.sys.player.faceTowards?.(ct.x, ct.z); G.sys.player.playAction?.('interact'); }
      G.sfx('craft');
      G.log.info('FERMENTATION', `craft ${craftId}`);
      G.activity('craft', `${c.name}`, { craftId });
      G.dirty('craft');
      G.bus.emit('craft:done', { craftId });
      this._renderCraft();
      return true;
    },

    openJarDisplay(id) {
      const jd = (G.data.layout?.jarDisplays || []).find((d) => d.id === id);
      if (!jd) return null;
      const info = ONGGI_INFO[jd.kind] || { title: jd.name, sub: '옹기', text: '', use: '', size: '' };
      const colId = { dok: 'COL_JAR_DOK', jungduri: 'COL_JAR_JUNGDURI', hangari: 'COL_JAR_HANGARI', danji: 'COL_JAR_DANJI' }[jd.kind];
      const isNew = colId && G.sys.progression?.isCollected && !G.sys.progression.isCollected(colId);
      const h = G.ui.h;
      const kinds = ['dok', 'jungduri', 'hangari', 'danji'];
      const svg = this._onggiSvg(kinds, jd.kind);
      const m = G.ui.modal.open({
        id: 'ferment-onggi', size: 'md', className: 'onggi-modal', title: `옹기 살펴보기 · ${info.title}`, icon: '🏺',
        body: (b) => {
          b.append(
            h('div', { class: 'og-figure', html: svg }),
            h('div', { class: 'row wrap og-head' }, h('b', { class: 'og-name' }, info.title), h('span', { class: 'chip' }, info.sub), isNew ? h('span', { class: 'chip chip-gold' }, '✨ 도감 등록!') : null),
            h('p', null, info.text),
            h('dl', { class: 'kv' }, h('dt', null, '크기'), h('dd', null, info.size), h('dt', null, '주로 담던 것'), h('dd', null, info.use)),
            h('div', { class: 'notice-box info mt-1' }, `💡 ${ONGGI_FACT}`));
        },
        actions: [
          ...(G.sys.progression?.openCollection ? [{ label: '도감 보기', class: 'btn-soft', icon: 'collection', onClick: () => { G.sys.progression.openCollection('jar'); } }] : []),
          { label: '확인', class: 'btn-primary' },
        ],
      });
      return m;
    },
    _onggiSvg(kinds, sel) {
      const prof = G.bkit?.JAR_PROFILES || null;
      const fallback = { dok: [[0, 0], [0.22, 0], [0.31, 0.25], [0.4, 0.72], [0.37, 1.0], [0.3, 1.2], [0.27, 1.25]], jungduri: [[0, 0], [0.22, 0], [0.45, 0.38], [0.48, 0.5], [0.4, 0.72], [0.3, 0.86], [0.28, 0.9]], hangari: JAR_PROFILE, danji: [[0, 0], [0.13, 0], [0.245, 0.2], [0.23, 0.33], [0.165, 0.405], [0.15, 0.46]] };
      const W = 360, H = 170, base = 150, GAP = 24;
      const radius = (k) => ((prof && prof[k]) || fallback[k]).reduce((a, p) => Math.max(a, p[0]), 0);
      const height = (k) => ((prof && prof[k]) || fallback[k]).reduce((a, p) => Math.max(a, p[1]), 0);
      const sumW = kinds.reduce((a, k) => a + radius(k) * 2, 0);
      const S = Math.min((W - 30 - GAP * (kinds.length - 1)) / sumW, (base - 12) / Math.max(...kinds.map(height)));
      let x = (W - (sumW * S + GAP * (kinds.length - 1))) / 2;
      let out = `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="옹기 크기 비교"><defs><linearGradient id="og-g" x1="0" x2="1"><stop offset="0" stop-color="#2c180c"/><stop offset=".35" stop-color="#6b4024"/><stop offset=".6" stop-color="#4a2a16"/><stop offset="1" stop-color="#22120a"/></linearGradient><linearGradient id="og-s" x1="0" x2="1"><stop offset="0" stop-color="#8a5a2c"/><stop offset=".35" stop-color="#e2a85a"/><stop offset=".6" stop-color="#b07a3a"/><stop offset="1" stop-color="#6a4020"/></linearGradient></defs>`;
      out += `<line x1="10" y1="${base}" x2="${W - 10}" y2="${base}" stroke="rgba(255,255,255,.25)" stroke-width="2"/>`;
      const names = { dok: '독', jungduri: '중두리', hangari: '항아리', danji: '단지' };
      for (const k of kinds) {
        const pts = (prof && prof[k]) || fallback[k];
        let maxR = 0, maxY = 0;
        for (const p of pts) { maxR = Math.max(maxR, p[0]); maxY = Math.max(maxY, p[1]); }
        // keep only the outer silhouette (drop the inward lip after the rim)
        const outer = [];
        for (let i = 0; i < pts.length; i++) { if (i > 0 && pts[i][1] < pts[i - 1][1] - 1e-4) break; outer.push(pts[i]); }
        const cx = x + maxR * S;
        const right = outer.map(([r, y]) => `${(cx + r * S).toFixed(1)},${(base - y * S).toFixed(1)}`);
        const left = outer.slice().reverse().map(([r, y]) => `${(cx - r * S).toFixed(1)},${(base - y * S).toFixed(1)}`);
        const on = k === sel;
        out += `<g class="og-jar ${on ? 'on' : ''}"><polygon points="${right.concat(left).join(' ')}" fill="url(#${on ? 'og-s' : 'og-g'})" stroke="${on ? '#ffd766' : 'rgba(255,255,255,.18)'}" stroke-width="${on ? 2.5 : 1}"/>`;
        out += `<ellipse cx="${cx.toFixed(1)}" cy="${(base - maxY * S).toFixed(1)}" rx="${(outer[outer.length - 1][0] * S).toFixed(1)}" ry="3" fill="${on ? '#5a3418' : '#1a0d06'}"/>`;
        out += `<text x="${cx.toFixed(1)}" y="${H - 4}" text-anchor="middle" font-size="12" font-weight="${on ? 800 : 600}" fill="${on ? '#ffd766' : 'rgba(255,255,255,.7)'}">${names[k]}</text></g>`;
        x += maxR * S * 2 + GAP;
      }
      return out + '</svg>';
    },
  };

  G.register(fer);
})();
