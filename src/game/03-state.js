// =============================================================================
// 03-state.js — settings, network client (optional PHP server mode), save system.
//
// Modes
//   local  : file:// or no PHP API found -> data saved in this browser (localStorage),
//            with version, checksum, backup copy and migrations.
//   server : index.html served next to /api (PHP + MySQL/SQLite). Accounts, saves,
//            chat and presence go through the REST API; the server re-validates
//            rewards/timings (see server/api/player/save.php).
// =============================================================================

// ------------------------------------------------------------------ device settings
(function () {
  const KEY = 'tfm.v1.settings';
  const DEFAULTS = {
    volumeMaster: 0.8, volumeMusic: 0.45, volumeSfx: 0.8, volumeAmbient: 0.6, muted: false,
    quality: 'auto',            // auto | low | medium | high
    shadows: true,
    bloom: true,
    sensitivity: 1.0,           // camera drag sensitivity
    invertY: false,
    uiScale: 1.0,               // 0.85 .. 1.3
    highContrast: false,
    largeText: false,
    reduceMotion: false,
    subtitles: true,            // dialogue text always on; TTS when voiceOver true
    voiceOver: false,           // read NPC dialogue aloud (speechSynthesis)
    showFps: false,
    minimapVisible: true,
    chatVisible: true,
    clickToMove: true,
    cameraShake: true,
    autoWeather: true,
    lockTime: false,
    // ---- Phase 3: 쉬운 모드 (CONTRACT §12.1) — easy mode is the DEFAULT
    easyMode: true,             // big picture UI for young children (body.easy / body.easy-off)
    voiceGuide: true,           // read prompts aloud in easy mode (G.easy.say)
    voiceRate: 0.95,            // speech rate for the voice guide (0.6 .. 1.4)
    playReminderMin: 30,        // healthy-play reminder every N minutes of active play (0 = off)
    kidChat: true,              // easy mode chat = preset phrases + emoji only (no free text)
    parentGate: true,           // G.easy.gate() before grown-up screens (settings, logout, reset...)
  };
  /** settings that belong to the PLAYER (profile save) rather than the device: a parent who switches
   *  easy mode off in their own profile must not leak that into a child's profile on the same device. */
  const PROFILE_KEYS = ['easyMode', 'kidChat', 'parentGate'];
  const ENUMS = { quality: ['auto', 'low', 'medium', 'high'] };
  const RANGES = { volumeMaster: [0, 1], volumeMusic: [0, 1], volumeSfx: [0, 1], volumeAmbient: [0, 1], sensitivity: [0.2, 3], uiScale: [0.75, 1.4], voiceRate: [0.6, 1.4], playReminderMin: [0, 240] };
  /** coerce a stored/imported value to the default's type (corrupt or hostile saves must not break the UI) */
  function sanitize(key, value) {
    const def = DEFAULTS[key];
    if (def === undefined) return value; // unknown keys are kept as-is (other modules may add their own)
    if (typeof def === 'boolean') return typeof value === 'boolean' ? value : def;
    if (typeof def === 'number') {
      const n = Number(value);
      if (typeof value !== 'number' || !Number.isFinite(n)) return def;
      const r = RANGES[key];
      return r ? G.util.clamp(n, r[0], r[1]) : n;
    }
    if (typeof def === 'string') {
      if (typeof value !== 'string') return def;
      if (ENUMS[key] && !ENUMS[key].includes(value)) return def;
      return value.slice(0, 40);
    }
    return value;
  }
  /**
   * Device store format marker. Before it existed, setSetting serialised the whole merged G.settings, so a
   * grown-up's profile could leak easyMode:false / parentGate:false / kidChat:false onto the device (the next
   * child then got the normal-mode title with no gate). Stores without the marker drop those keys once
   * (child-safe direction: back to the defaults = easy mode on, gate on).
   */
  const STORE_V = 2;
  const isBadKey = (k) => k === '__proto__' || k === 'constructor' || k === 'prototype';
  /** this device's stored settings object (never the merged in-memory G.settings) */
  function readDevice() {
    let dev = {};
    try { dev = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { dev = {}; }
    if (!dev || typeof dev !== 'object' || Array.isArray(dev)) dev = {};
    if (dev._v !== STORE_V) {
      for (const k of PROFILE_KEYS) delete dev[k];
      dev._v = STORE_V;
      try { localStorage.setItem(KEY, JSON.stringify(dev)); } catch (e) { /* storage blocked */ }
    }
    return dev;
  }
  const stored = readDevice();
  G.settings = Object.assign({}, DEFAULTS);
  for (const [k, v] of Object.entries(stored)) {
    if (isBadKey(k) || k.charAt(0) === '_') continue;
    G.settings[k] = sanitize(k, v);
  }
  // OS "reduce motion" (R3 device-env-4): one effective flag. While the player never chose the in-app switch (no
  // 'reduceMotion' key in the device store), the setting follows the OS preference — and follows it when it changes —
  // so the 3D layer (intro flight, FOV kick, lightning, portal …) calms down together with the 2D layer.
  const RMQ = (() => { try { return window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null; } catch (e) { return null; } })();
  const rmChosen = () => { try { return Object.prototype.hasOwnProperty.call(readDevice(), 'reduceMotion'); } catch (e) { return true; } };
  G.osReducedMotion = () => !!(RMQ && RMQ.matches);
  G.reduceMotionChosen = rmChosen;
  /** the setting, or the OS preference while the player never chose (what every motion call site should read) */
  G.motionReduced = () => !!G.settings.reduceMotion || (G.osReducedMotion() && !rmChosen());
  if (RMQ && RMQ.matches && !rmChosen()) G.settings.reduceMotion = true;
  if (RMQ) {
    const onRM = (e) => {
      if (rmChosen()) return;
      const v = !!(e && e.matches);
      if (G.settings.reduceMotion === v) return;
      G.settings.reduceMotion = v;
      G.applySettingsToDom();
      G.bus.emit('settings:changed', { key: 'reduceMotion', value: v });
    };
    try { if (RMQ.addEventListener) RMQ.addEventListener('change', onRM); else if (RMQ.addListener) RMQ.addListener(onRM); } catch (e) { /* old engine */ }
  }
  G.settingsDefaults = DEFAULTS;
  G.settingsProfileKeys = PROFILE_KEYS;
  G.sanitizeSetting = sanitize;
  /** after logout: profile-scoped keys fall back to this device's stored values (title screen) */
  G.restoreDeviceSettings = function () {
    const dev = readDevice();
    for (const k of PROFILE_KEYS) {
      const v = sanitize(k, Object.prototype.hasOwnProperty.call(dev, k) ? dev[k] : DEFAULTS[k]);
      if (G.settings[k] !== v) { G.settings[k] = v; G.bus.emit('settings:changed', { key: k, value: v }); }
    }
    G.applySettingsToDom();
  };
  /** the stored device value of a key (profile keys: what the title screen uses) */
  G.deviceSetting = function (key) {
    const dev = readDevice();
    return sanitize(key, Object.prototype.hasOwnProperty.call(dev, key) ? dev[key] : DEFAULTS[key]);
  };

  G.setSetting = function (key, value) {
    if (typeof key !== 'string' || isBadKey(key) || key.charAt(0) === '_') return;
    value = sanitize(key, value);
    if (G.settings[key] === value) return;
    G.settings[key] = value;
    // write ONLY this key to the device store. Profile-scoped keys (easy mode, kid chat, parent gate) changed
    // while a profile is loaded belong to that profile's save only (§12.1) — they never touch the device.
    if (!(PROFILE_KEYS.includes(key) && G.state)) {
      try {
        const dev = readDevice();
        dev[key] = value;
        localStorage.setItem(KEY, JSON.stringify(dev));
      } catch (e) { /* storage blocked */ }
    }
    G.applySettingsToDom();
    G.bus.emit('settings:changed', { key, value });
    G.dirty('settings');
    // a kid-safety switch (아이 채팅, 보호자 확인, 쉬운 모드) is saved right away: closing the tab inside the save
    // debounce must not bring the old value back on the next login
    if (PROFILE_KEYS.includes(key) && G.state) G.save?.save?.({ reason: 'settings' });
  };
  G.applySettingsToDom = function () {
    const b = document.body;
    if (!b) return;
    const root = document.documentElement;
    root.style.setProperty('--ui-scale', String(G.util.clamp(Number(G.settings.uiScale) || 1, 0.75, 1.4)));
    b.classList.toggle('high-contrast', !!G.settings.highContrast);
    b.classList.toggle('large-text', !!G.settings.largeText);
    b.classList.toggle('reduce-motion', !!G.settings.reduceMotion);
    // 쉬운 모드 (§12.1): body.easy | body.easy-off, minimum tap size token
    const easy = G.settings.easyMode !== false;
    b.classList.toggle('easy', easy);
    b.classList.toggle('easy-off', !easy);
    root.style.setProperty('--tap', easy ? '56px' : '40px');
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => G.applySettingsToDom());
  else G.applySettingsToDom();
})();

// ------------------------------------------------------------------ network client
(function () {
  class ApiError extends Error {
    constructor(code, message, status, data) { super(message); this.code = code; this.status = status; this.data = data; }
  }
  G.net = {
    ApiError,
    mode: 'local',   // 'local' | 'server'
    base: 'api/',
    csrf: null,
    serverInfo: null,
    online: true,
    /** true when ping.php never answered in time (a busy server, slow Wi-Fi): the title keeps retrying (recheck) */
    unreachable: false,

    /**
     * Decide local vs server mode. Server mode only when served over http(s) next to api/ping.php.
     * A missing / non-PHP api (404, not JSON) means local mode at once; a ping that times out is retried with longer
     * waits first, so one slow answer from a busy classroom server does not put the whole session in local mode.
     */
    async detect() {
      G.net.mode = 'local';
      G.net.unreachable = false;
      if (G.flags.forceLocal) return 'local';
      if (!/^https?:$/.test(location.protocol)) return 'local';
      for (const timeout of [2500, 5000, 9000]) {
        const r = await ping(timeout);
        if (r === 'server') return 'server';
        if (r === 'none') { G.log.info('NETWORK', 'no PHP API found -> local mode'); return 'local'; }
      }
      G.net.unreachable = true;
      G.log.warn('NETWORK', 'server did not answer -> local mode for now (the title keeps checking)');
      return 'local';
    },
    /** one more ping while nobody is logged in (title screen); true when server mode is now on */
    async recheck() {
      if (G.net.mode === 'server' || !G.net.unreachable) return G.net.mode === 'server';
      const r = await ping(6000);
      if (r === 'none') G.net.unreachable = false;
      return r === 'server';
    },

    /**
     * JSON request to the PHP API. Returns `data` of {success:true,data}; throws ApiError otherwise.
     * opts: { method, body (object -> JSON), form (FormData), timeout, quiet }
     */
    async request(path, opts = {}) {
      const method = opts.method || (opts.body || opts.form ? 'POST' : 'GET');
      const headers = { Accept: 'application/json' };
      let body;
      if (opts.form) body = opts.form;
      else if (opts.body !== undefined) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(opts.body); }
      if (method !== 'GET' && G.net.csrf) headers['X-CSRF-Token'] = G.net.csrf;
      const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timer = setTimeout(() => ctrl?.abort(), opts.timeout || 12000);
      let res, json;
      try {
        res = await fetch(G.net.base + path.replace(/^\//, ''), { method, headers, body, credentials: 'include', signal: ctrl?.signal, cache: 'no-store' });
        json = await res.json().catch(() => null);
      } catch (e) {
        if (!opts.quiet) G.log.warn('API', `${method} ${path} failed`, e);
        throw new ApiError('NETWORK_ERROR', '서버에 연결하지 못했습니다. 잠시 후 다시 시도해주세요.', 0);
      } finally { clearTimeout(timer); }
      if (json && json.csrf) G.net.csrf = json.csrf;
      if (json && json.serverTime) G.time.serverOffset = Number(json.serverTime) - Date.now();
      // the time limit ran out while the answer's body was still arriving (a busy single-threaded server answers
      // the headers late): that is a timeout like any other, not a refusal with status 200
      if (!json && ctrl?.signal?.aborted) {
        if (!opts.quiet) G.log.warn('API', `${method} ${path} timed out reading the answer`);
        throw new ApiError('NETWORK_ERROR', '서버에 연결하지 못했습니다. 잠시 후 다시 시도해주세요.', 0);
      }
      if (!json || json.success !== true) {
        const err = (json && json.error) || {};
        throw new ApiError(err.code || `HTTP_${res.status}`, err.message || '작업을 완료하지 못했습니다. 잠시 후 다시 시도해주세요.', res.status, json && json.data);
      }
      return json.data;
    },
  };
  /** -> 'server' (server mode is on now) | 'none' (no PHP API here) | 'late' (no answer / network error: retry) */
  async function ping(timeout) {
    try {
      const res = await G.net.request('ping.php', { timeout, quiet: true });
      if (!res || res.app !== 'tfm-metaverse') return 'none';
      G.net.mode = 'server';
      G.net.unreachable = false;
      G.net.serverInfo = res;
      if (res.serverTime) G.time.serverOffset = Number(res.serverTime) - Date.now();
      if (res.csrf) G.net.csrf = res.csrf;
      G.log.info('NETWORK', `server mode (api v${res.version || '?'}, db: ${res.db || '?'})`);
      return 'server';
    } catch (e) {
      // timeout / network error / an overloaded server (429, 5xx) may answer next time; 404 or not-JSON never will
      const st = Number(e && e.status) || 0;
      return e && (e.code === 'NETWORK_ERROR' || st === 429 || st >= 500) ? 'late' : 'none';
    }
  }
})();

// ------------------------------------------------------------------ save system
(function () {
  const STATE_VERSION = 1;
  const PREFIX = 'tfm.v1.';
  const LOCAL_PHOTO_LIMIT = 24;

  /** checksum over the serialized data (detects truncated/corrupted saves) */
  function checksum(str) { return G.util.hash(str); }

  // ---------------------------------------------------------------- default state
  function createDefaultState(profile) {
    const L = G.data.layout || {};
    const sp = L.spawn || { x: 0, z: 9, rotY: Math.PI };
    return {
      version: STATE_VERSION,
      createdAt: G.time.now(),
      savedAt: 0,
      profile: {
        id: profile?.id || 'guest',
        nickname: profile?.nickname || '게스트',
        email: profile?.email || '',
        role: profile?.role || 'user',
        avatar: null,            // null -> G.avatar.defaultAppearance
        title: '',
        titles: [],
      },
      stats: {
        level: 1, exp: 0, coin: 0, edu: 0,
        logins: 0, playTime: 0, distance: 0,
        waters: 0, plants: 0, harvests: 0, harvestedItems: 0,
        fermentsStarted: 0, fermentsClaimed: 0, fermentChecks: 0,
        quizCorrect: 0, quizAnswered: 0, eduCompleted: 0,
        journals: 0, photos: 0, emotes: 0, gestures: 0, chats: 0, talks: 0, crafts: 0, interacts: 0,
        doubleJumps: 0,
        rtHarvests: 0,           // real-time bed harvests (CONTRACT §15.1; the server checks its growth per save)
      },
      // speed tiers (CONTRACT §14.1): server-authoritative; the server ignores the client's `sub` on save (like `role`)
      sub: { tier: 1, status: 'none', expiresAt: 0, autoRenew: false, source: 'local' },
      player: { x: sp.x, y: 0, z: sp.z, rotY: sp.rotY, zoneId: 'ZONE_MAIN' },
      inventory: G.util.clone(G.data.startingInventory || {}),
      quests: {},          // questId -> { status, progress:[n...], acceptedAt, completedAt, claimedAt, tracked }
      farm: { plots: {} }, // plotId -> { cropId, growth, water, health, plantedAt, lastUpdate, lastWaterAt, harvests }
      // 실시간 텃밭 (CONTRACT §15.1): bedId -> { cropId, pid, plantedAt, readyAt, dur, tier, care, lastCareAt } (an empty
      // bed has no key), last = the newest 8 harvests, reports = completion requests (local mode only, §15.3)
      rtfarm: { beds: {}, last: [], reports: [] },
      // 곳간 (CONTRACT §15.2): itemId -> qty, total ≤ cap
      storage: { items: {}, cap: (G.data.storage && G.data.storage.cap) || 300 },
      jars: {},            // jarId  -> { owned, recipeId, status, progress, quality, temp, humidity, hygiene, startedAt, lastUpdate, ... }
      education: { viewed: {}, completed: {}, quiz: {} },
      journal: [],         // { id, date, zoneId, activity, harvest, ferment, learned, memo, photo, createdAt }
      photos: [],          // { id, at, zoneId, photoZoneId, thumb }
      achievements: {},    // id -> unlockedAt
      collection: {},      // id -> { at, zoneId }
      visited: {},         // zoneId -> first visit ts
      poisVisited: {},     // poiId -> ts
      npcsTalked: {},      // npcId -> ts
      cropKinds: {},       // cropId -> first harvest ts
      flags: {},
      tutorial: { step: 0, done: false },
      activity: [],
      settings: {},
      blocked: [],         // blocked chat user ids/names
    };
  }

  /** older saves -> current shape */
  const MIGRATIONS = {
    // 1: (s) => { ...; s.version = 2; return s; },
  };
  function migrate(data) {
    let v = Number(data.version || 1);
    while (MIGRATIONS[v]) { data = MIGRATIONS[v](data) || data; v = Number(data.version || v + 1); }
    data.version = STATE_VERSION;
    return data;
  }
  const isMap = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
  const SUB_STATUS = ['none', 'active', 'past_due', 'canceled'];
  /** a subscription record from the server / a save -> a clean {tier 1..4, status, expiresAt, autoRenew, source};
   *  anything unreadable is tier 1 (G.sys.speed reads the tier from here; local mode never goes above 1) */
  function sanitizeSub(sub, source) {
    const out = { tier: 1, status: 'none', expiresAt: 0, autoRenew: false, source: source === 'server' ? 'server' : 'local' };
    if (!isMap(sub)) return out;
    const raw = sub.tier;
    const t = typeof raw === 'number' || (typeof raw === 'string' && /^\s*\d{1,2}\s*$/.test(raw)) ? Math.floor(Number(raw)) : NaN;
    out.tier = Number.isFinite(t) && t >= 1 && t <= 4 ? t : 1;
    out.status = typeof sub.status === 'string' && SUB_STATUS.includes(sub.status) ? sub.status : (out.tier > 1 ? 'active' : 'none');
    const ex = Number(sub.expiresAt);
    out.expiresAt = Number.isFinite(ex) && ex > 0 ? Math.floor(ex) : 0;
    out.autoRenew = sub.autoRenew === true || sub.autoRenew === 1 || sub.autoRenew === '1';
    return out;
  }
  /** keys that name Object.prototype members ('__proto__', 'constructor', 'toString'…) are dropped: modules index
   *  their maps with `map[id]` and a hand-edited save must not shadow those names */
  function dropProtoKeys(o, depth) {
    for (const k of Object.keys(o)) {
      if (k in Object.prototype) delete o[k];
      else if (depth > 0 && isMap(o[k])) dropProtoKeys(o[k], depth - 1);
    }
  }
  // ---------------------------------------------------------------- 실시간 텃밭 + 곳간 (CONTRACT §15.1 – §15.3)
  // Interface 1 of the phase-7 build: the save carries exactly these shapes; the server re-validates every one of them.
  const RT_PID = /^[0-9a-f]{16}$/;            // a real-time planting: 16 lowercase hex chars (crypto.getRandomValues)
  const RT_PLOT_PID = /^[1-9]\d{0,14}$/;      // a quick plot's planting = String(plantedAt)
  const RT_LAST_MAX = 8, RT_REPORT_MAX = 50, RT_NOTE_MAX = 80, RT_MEMO_MAX = 500;
  const RT_STATUS = ['pending', 'approved', 'rejected'];
  const ownKey = (o, k) => typeof k === 'string' && !!o && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k);
  const finNum = (v) => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN);
  const intIn = (v, a, b, d) => { const n = finNum(v); return Number.isFinite(n) ? Math.min(b, Math.max(a, Math.round(n))) : d; };
  const cleanStr = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '');
  /** one bed of a save -> a clean bed, or null (unknown crop, bad pid, impossible times) */
  function sanitizeRtBed(b) {
    const crops = (G.data.rtfarm && G.data.rtfarm.crops) || {};
    if (!isMap(b) || !ownKey(crops, b.cropId) || typeof b.pid !== 'string' || !RT_PID.test(b.pid)) return null;
    const plantedAt = finNum(b.plantedAt), readyAt = finNum(b.readyAt);
    if (!(plantedAt > 0) || !Number.isFinite(readyAt) || readyAt < plantedAt) return null;
    // the longest a planting can take: tier 1 at the smallest operator time scale (0.1)
    const maxDur = Math.ceil((Number(crops[b.cropId].minutes) || 0) * 60000 / 0.1);
    if (readyAt - plantedAt > maxDur + 60000) return null;
    let dur = finNum(b.dur);
    if (!(dur > 0) || dur > maxDur + 60000) dur = readyAt - plantedAt;
    const caredAt = finNum(b.lastCareAt);
    return {
      cropId: b.cropId, pid: b.pid, plantedAt: Math.round(plantedAt), readyAt: Math.round(readyAt), dur: Math.round(dur),
      tier: intIn(b.tier, 1, 4, 1), care: intIn(b.care, 0, 100, 0), lastCareAt: caredAt > 0 ? Math.round(caredAt) : 0,
    };
  }
  /** rtfarm.last: the newest 8 harvests {pid, bedId, cropId, amount, stars, at} */
  function sanitizeRtLast(list) {
    const D = G.data.rtfarm || {};
    const out = [];
    for (const x of Array.isArray(list) ? list : []) {
      if (!isMap(x) || typeof x.pid !== 'string' || !RT_PID.test(x.pid) || !(D.beds || []).includes(x.bedId) || !ownKey(D.crops, x.cropId)) continue;
      const at = finNum(x.at);
      if (!(at > 0)) continue;
      out.push({ pid: x.pid, bedId: x.bedId, cropId: x.cropId, amount: intIn(x.amount, 0, 99, 0), stars: intIn(x.stars, 1, 3, 1), at: Math.round(at) });
    }
    // oldest → newest by time (a copy may come newest-first), then the newest 8
    out.sort((a, b) => a.at - b.at);
    return out.slice(-RT_LAST_MAX);
  }
  /** a completion request kept on this device (local mode, §15.3): the same object the server's book returns */
  function sanitizeRtReport(r) {
    if (!isMap(r)) return null;
    const kind = r.kind === 'rt' || r.kind === 'plot' ? r.kind : null;
    if (!kind) return null;
    const plots = ((G.data.layout && G.data.layout.farmPlots) || []).map((p) => p.id);
    const bedOk = kind === 'rt' ? ((G.data.rtfarm && G.data.rtfarm.beds) || []).includes(r.bedId) : plots.includes(r.bedId);
    const pid = typeof r.pid === 'string' ? r.pid : '';
    if (!bedOk || !(kind === 'rt' ? RT_PID : RT_PLOT_PID).test(pid) || !ownKey(G.data.crops, r.cropId)) return null;
    const id = intIn(r.id, 0, 1e12, 0), requestedAt = finNum(r.requestedAt);
    if (!(id > 0) || !(requestedAt > 0)) return null;
    const status = RT_STATUS.includes(r.status) ? r.status : 'pending';
    const decidedAt = finNum(r.decidedAt);
    return {
      id, kind, bedId: r.bedId, pid, cropId: r.cropId, stars: intIn(r.stars, 1, 3, 1), amount: intIn(r.amount, 0, 99, 0),
      note: cleanStr(r.note, RT_NOTE_MAX), status, memo: status === 'pending' ? '' : cleanStr(r.memo, RT_MEMO_MAX),
      requestedAt: Math.round(requestedAt), decidedAt: status !== 'pending' && decidedAt > 0 ? Math.round(decidedAt) : 0,
      photoUrl: null, source: 'local', seen: status !== 'pending' && r.seen === true,
    };
  }
  /** the 곳간: known storable item ids only, integer 0..9999 each, total ≤ cap (the data's item order decides what a
   *  damaged save that holds more than the cap keeps) */
  function sanitizeStorage(s) {
    const D = G.data.storage || {};
    const cap = Math.max(0, Math.floor(Number(D.cap) || 300));
    const out = { items: {}, cap };
    const src = isMap(s) && isMap(s.items) ? s.items : {};
    let total = 0;
    for (const id of Array.isArray(D.itemIds) ? D.itemIds : []) {
      if (!ownKey(src, id)) continue;
      const q = Math.min(intIn(src[id], 0, 9999, 0), cap - total);
      if (q > 0) { out.items[id] = q; total += q; }
    }
    return out;
  }
  /**
   * phase-7 upgrade + shape rules, run on every load / import / server restore: an older save (no rtfarm, storage or
   * stats.rtHarvests) gets the empty defaults and keeps everything else; unknown beds, crops, items and keys are
   * dropped (so no local-only value — e.g. a local time scale — ever rides along into a server-mode save), numbers are
   * clamped, a pid is used by one bed only, `last` keeps the newest 8, the 곳간 total stays ≤ cap. The completion
   * requests of `reports` belong to local mode only: a server-mode profile keeps none (the server holds them).
   */
  function sanitizeRealFarm(data, mode) {
    const rt = isMap(data.rtfarm) ? data.rtfarm : {};
    const beds = {}, pids = new Set();
    for (const id of (G.data.rtfarm && G.data.rtfarm.beds) || []) {
      if (!isMap(rt.beds) || !ownKey(rt.beds, id)) continue;
      const b = sanitizeRtBed(rt.beds[id]);
      if (b && !pids.has(b.pid)) { beds[id] = b; pids.add(b.pid); }
    }
    let reports = [];
    if (mode !== 'server') {
      const keys = new Set();
      for (const r of (Array.isArray(rt.reports) ? rt.reports : []).map(sanitizeRtReport)) {
        const k = r && `${r.kind}|${r.bedId}|${r.pid}`;
        if (r && !keys.has(k)) { keys.add(k); reports.push(r); } // one request per planting
      }
      reports = reports.slice(-RT_REPORT_MAX);
    }
    data.rtfarm = { beds, last: sanitizeRtLast(rt.last), reports };
    data.storage = sanitizeStorage(data.storage);
    if (isMap(data.stats)) data.stats.rtHarvests = intIn(data.stats.rtHarvests, 0, 1e7, 0);
    return data;
  }

  function normalize(data, profile) {
    const def = createDefaultState(profile);
    if (!isMap(data)) return def;
    data = migrate(data);
    if (!isMap(data)) return def;
    // the starting bag belongs to a brand-new profile only: an item that was used up (its key deleted) stays gone
    if (isMap(data.inventory)) def.inventory = {};
    // wrong-typed containers (hand-edited, imported or damaged saves) are replaced by their defaults
    dropProtoKeys(data, 2);
    for (const [k, dv] of Object.entries(def)) {
      if (Array.isArray(dv)) { if (!Array.isArray(data[k])) data[k] = []; }
      else if (isMap(dv) && !isMap(data[k])) data[k] = G.util.clone(dv);
    }
    G.util.defaults(data, def);
    for (const k of ['journal', 'photos', 'activity']) if (data[k].some((x) => !isMap(x))) data[k] = data[k].filter(isMap);
    for (const [k, v] of Object.entries(data.stats)) {
      if (typeof v === 'number' && Number.isFinite(v)) continue;
      const n = typeof v === 'string' && v.trim() ? Number(v) : NaN;
      data.stats[k] = Number.isFinite(n) ? n : (def.stats[k] ?? 0);
    }
    for (const k of ['x', 'y', 'z', 'rotY']) if (!Number.isFinite(data.player[k])) data.player[k] = def.player[k];
    // speed tier: clamped 1..4 in server mode (the server's answer overwrites it anyway); always tier 1 in local mode
    data.sub = G.net?.mode === 'server' ? sanitizeSub(data.sub, 'server') : sanitizeSub(null, 'local');
    // 실시간 텃밭 / 곳간 (phase 7): upgrade older saves, drop what does not fit the shape
    sanitizeRealFarm(data, G.net?.mode === 'server' ? 'server' : 'local');
    if (profile) { data.profile.id = profile.id; if (profile.nickname) data.profile.nickname = profile.nickname; if (profile.role) data.profile.role = profile.role; if (profile.email) data.profile.email = profile.email; }
    return data;
  }

  // ---------------------------------------------------------------- adapters
  /** another tab / window of the same profile saved after this tab loaded it (LocalAdapter never overwrites it) */
  class SaveConflict extends Error { constructor() { super('saved from another tab'); this.code = 'SAVE_CONFLICT'; } }
  /** the stored envelope string -> its data object; throws on anything that is not a readable save (the loader then
   *  tries the backup). Older tools stored `data` as an object without a checksum: accepted as it is. */
  function readEnvelope(raw) {
    const env = JSON.parse(raw);
    if (!isMap(env)) throw new Error('not a save envelope');
    if (typeof env.data === 'string') {
      if (env.checksum && checksum(env.data) !== env.checksum) throw new Error('checksum mismatch');
      const d = JSON.parse(env.data);
      if (!isMap(d)) throw new Error('save data is not an object');
      return d;
    }
    if (isMap(env.data) && !env.checksum) return env.data;
    throw new Error('not a save envelope');
  }
  const validEnvelope = (raw) => { try { readEnvelope(raw); return true; } catch (e) { return false; } };
  /** what this tab last read or wrote per save key: {sig, ok} (ok = that copy is a valid save) */
  const seen = new Map();
  const sig = (raw) => (raw ? `${raw.length}:${raw.slice(0, 200)}` : '');
  const LocalAdapter = {
    name: 'local',
    key: (id) => `${PREFIX}save.${id}`,
    async load(id) {
      const k = LocalAdapter.key(id);
      const raw = localStorage.getItem(k); // throws when site storage is blocked (G.save.load reports it)
      seen.set(k, { sig: sig(raw), ok: false });
      if (!raw) return { data: null, source: 'none' };
      try {
        const data = readEnvelope(raw);
        seen.set(k, { sig: sig(raw), ok: true });
        return { data, source: 'main' };
      } catch (e) {
        G.log.warn('SAVE', 'main save corrupted, trying backup', e);
        let bak = null;
        try {
          bak = localStorage.getItem(k + '.bak');
          if (bak) return { data: readEnvelope(bak), source: 'backup' };
        } catch (e2) { G.log.error('SAVE', 'backup also corrupted', e2); }
        // nothing readable: keep the damaged copies aside (the next save replaces them) so they can still be recovered
        try { localStorage.setItem(k + '.corrupt', JSON.stringify({ at: Date.now(), main: raw, bak })); } catch (e3) { /* no room */ }
        return { data: null, source: 'corrupted' };
      }
    },
    async save(id, state) {
      // keep local storage bounded: photos/journal photos are thumbnails, cap counts
      if (state.photos.length > LOCAL_PHOTO_LIMIT) state.photos.splice(0, state.photos.length - LOCAL_PHOTO_LIMIT);
      const k = LocalAdapter.key(id);
      const prev = localStorage.getItem(k);
      const known = seen.get(k);
      // last writer must not win: a newer copy from another tab is never overwritten by this (stale) tab
      if (prev && known && sig(prev) !== known.sig) throw new SaveConflict();
      const write = (st) => {
        const data = JSON.stringify(st);
        const env = JSON.stringify({ version: STATE_VERSION, savedAt: st.savedAt, checksum: checksum(data), data });
        localStorage.setItem(k, env);
        seen.set(k, { sig: sig(env), ok: true });
      };
      try {
        // only a valid main becomes the backup: a damaged copy must never replace a good .bak
        if (prev && ((known && known.ok) || validEnvelope(prev))) localStorage.setItem(k + '.bak', prev);
        write(state);
      } catch (e) {
        if (e instanceof SaveConflict) throw e;
        // storage full: free room step by step, retrying after each step. Only the copy written here is trimmed —
        // the game keeps every photo and diary picture (a later save tries again from the full state), so repeated
        // saves under quota never shrink the album further (each one trims the same snapshot the same way).
        const tryWrite = () => { try { write(state); return true; } catch (e2) { if (e2 instanceof SaveConflict) throw e2; return false; } };
        const Q = G.save.quota;
        // 1. the kept-aside damaged copy, then the backup copy
        try { localStorage.removeItem(k + '.corrupt'); } catch (e2) { /* ignore */ }
        if (tryWrite()) return { savedAt: state.savedAt };
        try { localStorage.removeItem(k + '.bak'); } catch (e2) { /* ignore */ }
        if (tryWrite()) return { savedAt: state.savedAt };
        // from here on the save leaves things out: 47-journal stops copying album photos back into diary entries
        if (Q) Q.tight = true;
        // 2. diary copies (data: URLs) in this copy: an entry keeps its photoId (47-journal shows the album photo
        //    while the album has it). Copies of photos the album still keeps go first, then all of them
        const dropCopies = (all) => {
          const kept = new Set(state.photos.map((ph) => ph && ph.id).filter(Boolean));
          for (const j of Array.isArray(state.journal) ? state.journal : []) {
            if (j && typeof j.photo === 'string' && j.photo.startsWith('data:') && (all || (j.photoId && kept.has(j.photoId)))) j.photo = null;
          }
        };
        dropCopies(false);
        let ok = tryWrite();
        if (!ok) { dropCopies(true); ok = tryWrite(); }
        // 3. the oldest album photos of this copy: as many of the newest as fit are kept (binary search, ≤ 6 tries)
        if (!ok) {
          // (a refused write stores nothing, and every success keeps more photos than the one before it: the copy
          // in storage is the last successful one = the largest count that fits)
          const all = state.photos.slice();
          let fits = -1, fails = all.length;
          while (fails - fits > 1) {
            const mid = (fits + fails) >> 1;
            state.photos = all.slice(all.length - mid);
            if (tryWrite()) fits = mid; else fails = mid;
          }
          if (fits < 0) throw e; // nothing left to leave out: the save fails (onFailed tells the player)
        }
        if (Q && !Q.noted) {
          Q.noted = true;
          G.ui?.toast?.('저장 공간이 모자라요. 오래된 사진은 일부만 저장돼요.', { type: 'warn', easy: '저장 공간이 모자라요. 어른에게 알려 줘요!', duration: 7000 });
        }
      }
      return { savedAt: state.savedAt };
    },
    remove(id) {
      const k = LocalAdapter.key(id);
      try { localStorage.removeItem(k); localStorage.removeItem(k + '.bak'); localStorage.removeItem(k + '.corrupt'); seen.set(k, { sig: '', ok: true }); } catch (e) { /* ignore */ }
    },
  };

  const revOf = (v) => (Number.isSafeInteger(v) && v >= 0 ? v : null);
  const ServerAdapter = {
    name: 'server',
    /** the server revision this tab's state is based on (get.php / save.php answers); sent as `base` so the server
     *  refuses a stale tab's save (409 STALE_SAVE) instead of letting an old copy overwrite newer progress.
     *  null = unknown (no base sent: accepted as before) */
    rev: null,
    /** savedAt of the copies this tab sent lately (saves and page-hide beacons): a STALE_SAVE whose stored copy is one
     *  of them is this tab's own save (a beacon, or a save whose answer was lost) — adopt its revision, no restore */
    sent: [],
    /** savedAt -> revision of this tab's copies the server confirmed. A confirmed copy that comes back under another
     *  revision was put back on the server (admin.php "직전 저장으로 되돌리기" swaps the backup in at a new revision):
     *  that restore is the newer state — this tab never writes over it */
    confirmed: new Map(),
    /** the server's current subscription from player/get.php (G.sys.speed applies it on state load) */
    sub: null,
    /** the server's own view of the real-time beds from player/get.php (CONTRACT §15.1 interface 2: {scale, tier, beds}):
     *  42-realfarm applies it on state load; every accepted save answer carries a fresh one (applied right away) */
    rt: null,
    reset() { ServerAdapter.rev = null; ServerAdapter.sent = []; ServerAdapter.confirmed = new Map(); ServerAdapter.sub = null; ServerAdapter.rt = null; },
    /** every copy sent since the last confirmed one is remembered (R3 device-env-1: a bounded list let 8 failed offline
     *  attempts push out the one save whose answer was lost, so that own copy was taken for another device's) */
    mark(savedAt) { const L = ServerAdapter.sent; if (!L.includes(savedAt)) L.push(savedAt); if (L.length > 400) L.splice(0, L.length - 400); },
    confirm(savedAt, rev) {
      const C = ServerAdapter.confirmed; C.delete(savedAt); C.set(savedAt, rev); if (C.size > 8) C.delete(C.keys().next().value);
      ServerAdapter.sent = ServerAdapter.sent.filter((at) => at > savedAt); // older copies are superseded by this one
    },
    async load() {
      ServerAdapter.reset();
      const d = await G.net.request('player/get.php');
      ServerAdapter.sub = d && d.sub && typeof d.sub === 'object' && !Array.isArray(d.sub) ? d.sub : null;
      ServerAdapter.rt = d && isMap(d.rt) ? d.rt : null;
      if (!d || !d.save || !d.save.data) {
        // a new player is based on "nothing stored yet" (0); an unreadable stored copy keeps the old rules (no base)
        ServerAdapter.rev = d && !d.save && !d.corrupted ? 0 : null;
        return { data: null, source: 'none' };
      }
      let data = d.save.data;
      if (typeof data === 'string') data = JSON.parse(data);
      ServerAdapter.rev = revOf(d.save.revision);
      return { data, source: 'server' };
    },
    /** the request body: key order version, checksum, base, data (the server checks the checksum on that slice) */
    body(state, data) {
      const rev = ServerAdapter.rev;
      return { version: STATE_VERSION, checksum: checksum(data), ...(rev != null ? { base: rev } : {}), data: state };
    },
    /** the upload limit grows with the body (R3 device-env-2: a fixed 12 s let no full-album save through a slow
     *  classroom link): 12 s + 1 s per 20 KB, at most 90 s */
    timeoutFor(bytes) { return Math.min(90000, 12000 + Math.ceil((Number(bytes) || 0) / 20)); },
    async save(id, state) {
      const data = JSON.stringify(state);
      ServerAdapter.mark(state.savedAt);
      const timeout = ServerAdapter.timeoutFor(data.length);
      const post = async () => {
        try { return await G.net.request('player/save.php', { body: ServerAdapter.body(state, data), timeout }); }
        catch (e) {
          // a rotated session (login elsewhere, expiry) leaves this tab with an old CSRF token; the error answer
          // carries the current one — one retry tells a stale token apart from a real refusal (then 401 / 403)
          if (e.code !== 'CSRF_INVALID') throw e;
          return await G.net.request('player/save.php', { body: ServerAdapter.body(state, data), timeout });
        }
      };
      const done = (res) => {
        const r = revOf(Number(res?.revision));
        if (r != null) { ServerAdapter.rev = r; ServerAdapter.confirm(state.savedAt, r); }
        // the subscription is the server's: every save answer carries the current tier (§14.1)
        if (res && res.sub && typeof res.sub === 'object') { try { G.sys.speed?.setFromServer?.(res.sub); } catch (e) { G.log.warn('SAVE', 'sub from save answer', e); } }
        // the real-time beds as the server measured them (§15.1): its readyAt is the only judge of "ready"
        if (res && isMap(res.rt)) { ServerAdapter.rt = res.rt; try { G.sys.realfarm?.applyServer?.(res.rt); } catch (e) { G.log.warn('SAVE', 'rt from save answer', e); } }
        return res;
      };
      try {
        try { return done(await post()); }
        catch (e) {
          // the newer stored copy is one this very tab sent (its page-hide beacon, or a save whose answer never
          // arrived): adopt that revision and save again
          const st = e?.data?.save, at = st?.data?.savedAt;
          // the server marks the copy admin.php put back (data.restored): load it whoever sent it, never save over it
          if (e?.code === 'STALE_SAVE' && e.data?.restored === true) { e.restored = true; throw e; }
          if (e.code !== 'STALE_SAVE' || !st || !at || !ServerAdapter.sent.includes(at) || revOf(st.revision) == null) throw e;
          // ...unless the server had already confirmed that copy under another revision: it was restored, not lost
          const was = ServerAdapter.confirmed.get(at);
          if (was != null && was !== st.revision) { e.restored = true; throw e; }
          ServerAdapter.rev = st.revision;
          ServerAdapter.confirm(at, st.revision);
          return done(await post());
        }
      } catch (e) {
        const st = e && e.data && e.data.save;
        if ((e.code === 'VALIDATION_FAILED' || e.code === 'STALE_SAVE') && st) {
          // VALIDATION_FAILED: the server rejected suspicious progress; STALE_SAVE: another tab / device saved newer
          // progress since this tab loaded, or a grown-up restored an earlier save (e.restored). Either way the stored
          // copy comes back and later saves build on it.
          if (revOf(st.revision) != null) ServerAdapter.rev = st.revision;
          if ((st.data && typeof st.data === 'object') || typeof st.data === 'string') {
            G.log.warn('SAVE', e.restored ? 'the server save was restored to an earlier copy, loading it' : e.code === 'STALE_SAVE' ? 'a newer save exists on the server, restoring it' : 'server rejected save, restoring server state', e.message);
            G.save._pendingServerRestore = st;
            G.save._pendingServerRestoreCode = e.restored ? 'SAVE_RESTORED' : e.code;
            // the violation codes (VALIDATION_FAILED): RT_HARVEST_TOO_EARLY & co. get their own calm words (§15.1)
            G.save._pendingServerRestoreViolations = Array.isArray(e.data.violations) ? e.data.violations.filter((c) => typeof c === 'string').slice(0, 20) : [];
          }
        }
        throw e;
      }
    },
    remove() { /* server keeps data */ },
  };

  // ---------------------------------------------------------------- manager
  let autosaveTimer = 0, debounceTimer = 0;
  // 플레이 시간 (stats.playTime, shown to grown-ups): wall-clock time the tab was visible with input in the last 90 s.
  // A tab left in the background or a device left lying around adds nothing (the same rule as 08-easy's healthy-play
  // reminder). play.at..now is one stretch of one visibility (play.vis); input after a long idle closes the stretch.
  const ACTIVE_GAP = 90000;
  const play = { input: 0, at: 0, vis: false };
  function accruePlay() {
    if (!play.at) return; // no game session running (title screen, between two children): nothing to count
    const t = performance.now();
    if (G.state && play.vis) {
      const end = Math.min(t, play.input + ACTIVE_GAP);
      if (end > play.at) G.state.stats.playTime = (Number(G.state.stats.playTime) || 0) + (end - play.at) / 1000;
    }
    play.at = t;
    play.vis = !document.hidden;
  }
  // steady play is mostly moves (a finger steering the joystick, a camera drag): a move with a finger or button down is
  // input too — a hover with nothing pressed is not
  const playInput = (e) => {
    if (e?.type === 'pointermove' && !e.buttons) return;
    const t = performance.now();
    if (t - play.input > ACTIVE_GAP) accruePlay();
    play.input = t;
  };
  for (const ev of ['pointerdown', 'keydown', 'wheel', 'touchstart', 'pointermove', 'touchmove']) window.addEventListener(ev, playInput, { capture: true, passive: true });
  document.addEventListener('visibilitychange', accruePlay);
  /** input that sends no DOM event (a finger resting on the joystick, a held d-pad button): 05-input calls it while a
   *  stick is held (R3 seams-lost-9: the counters stopped 90 s after the last touchmove although the child kept walking) */
  const noteInput = () => playInput({ type: 'hold' });
  /** the state as it is persisted: modules write their live values first (state:before-save), settings and savedAt
   *  are stamped, runtime-only '_' keys are dropped. Shared by save() and the server-mode beacon. */
  function snapshot() {
    accruePlay();
    G.bus.emit('state:before-save', G.state);
    G.state.savedAt = G.time.now();
    G.state.settings = { ...G.settings };
    return JSON.parse(JSON.stringify(G.state, (k, v) => (k.startsWith('_') ? undefined : v)));
  }
  /** a storage error that means "full" (not "blocked") */
  const isQuotaError = (e) => !!e && (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED' || e.code === 22 || e.code === 1014);
  /** true = saving works, 'full' = storage is there but full, false = the browser blocks site storage */
  function storageWorks() {
    try { const k = `${PREFIX}__probe`; localStorage.setItem(k, '1'); localStorage.removeItem(k); return true; } catch (e) { return isQuotaError(e) ? 'full' : false; }
  }
  // server mode: the newest progress the server has not confirmed yet (session ended, outage, tab closed with only
  // the beacon) is kept on this device; 70-app offers it at the next login of the same account
  const PENDING = (id) => `${PREFIX}pending.${id}`;
  const pending = {
    get(id) {
      try {
        const o = JSON.parse(localStorage.getItem(PENDING(id)) || 'null');
        return isMap(o) && isMap(o.data) && Number.isFinite(Number(o.savedAt)) ? o : null;
      } catch (e) { return null; }
    },
    put(id, snap) {
      try { localStorage.setItem(PENDING(id), JSON.stringify({ at: Date.now(), savedAt: Number(snap.savedAt) || 0, data: snap })); G.save._fail.pendingSelf = true; }
      catch (e) { G.log.warn('SAVE', 'could not keep an offline copy', e?.name || e); }
    },
    drop(id) { try { localStorage.removeItem(PENDING(id)); } catch (e) { /* ignore */ } },
    /** a pending copy that a STALE_SAVE restore pushed aside (newer than the copy the server handed back): kept under
     *  its own key for the next login (70-app offers it; a later successful save never deletes it) */
    getLost(id) {
      try {
        const o = JSON.parse(localStorage.getItem(PENDING(id) + '.lost') || 'null');
        return isMap(o) && isMap(o.data) && Number.isFinite(Number(o.savedAt)) ? o : null;
      } catch (e) { return null; }
    },
    keepLost(id) {
      const cur = pending.get(id);
      if (!cur) return false;
      try { localStorage.setItem(PENDING(id) + '.lost', JSON.stringify({ ...cur, lost: true, lostAt: Date.now() })); return true; }
      catch (e) { G.log.warn('SAVE', 'could not keep the pushed-aside copy', e?.name || e); return false; }
    },
    dropLost(id) { try { localStorage.removeItem(PENDING(id) + '.lost'); } catch (e) { /* ignore */ } },
  };
  const freshFail = () => ({ count: 0, warnedAt: 0, authLost: false, pendingSelf: false });
  function onSaved() {
    const F = G.save._fail;
    if (F.pendingSelf && G.save.adapter === ServerAdapter) { pending.drop(G.save.profile.id); F.pendingSelf = false; }
    if (!F.count && !F.authLost) return;
    const warned = F.warnedAt || F.authLost;
    Object.assign(F, { count: 0, warnedAt: 0, authLost: false });
    if (warned) G.ui?.toast?.('다시 잘 저장돼요!', { type: 'success', icon: 'save' });
    G.bus.emit('save:recovered');
  }
  function onFailed(e, snap, opts) {
    const F = G.save._fail;
    F.count++;
    const server = G.save.adapter === ServerAdapter;
    if (server && snap) pending.put(G.save.profile.id, snap);
    // the server session ended (idle / lifetime / password reset / ban review): ask a grown-up to log in again
    if (server && (Number(e?.status) === 401 || e?.code === 'AUTH_REQUIRED')) {
      const again = opts.notify || opts.reason === 'manual';
      if (!F.authLost || again) { F.authLost = true; G.bus.emit('save:auth-lost', { reason: opts.reason, notify: !!opts.notify }); }
      return;
    }
    if (opts.notify || opts.reason === 'manual') {
      F.warnedAt = Date.now();
      G.ui?.toast?.(e?.message || '저장하지 못했어요.', { type: 'error' });
      return;
    }
    // autosaves fail quietly once; the second failure in a row tells the player (again every 10 minutes) — unless the
    // re-login prompt for an ended session is what the player already sees
    if (!F.authLost && F.count >= 2 && Date.now() - F.warnedAt > 10 * 60000) {
      F.warnedAt = Date.now();
      G.ui?.toast?.('저장이 안 되고 있어요. 인터넷 연결이나 저장 공간을 확인해 주세요.', {
        type: 'error', easy: '저장이 안 돼요. 어른에게 알려 줘요!', duration: 9000, retry: () => G.save.save({ reason: 'manual' }),
      });
      G.bus.emit('save:failing', { count: F.count });
    }
  }
  /** another tab saved this profile: this tab stops saving for good (its state is older), 70-app tells the player */
  function markConflict() {
    if (G.save.conflict) return;
    G.save.conflict = true;
    G.save.stopAutosave();
    G.save.dirty = false;
    G.log.warn('SAVE', 'this profile was saved from another tab -> this tab stops saving');
    G.bus.emit('save:conflict');
  }

  G.save = {
    STATE_VERSION,
    adapter: LocalAdapter,
    profile: null,
    dirty: false,
    saving: false,
    lastSavedAt: 0,
    /** true once another tab saved the same profile (local mode): saves are refused until a reload */
    conflict: false,
    _fail: freshFail(),
    /** local storage ran full this session (per profile): tight = saves leave old photos / diary copies out (47-journal
     *  then stops copying album photos back into entries), noted = the player was told once */
    quota: { tight: false, noted: false },
    createDefaultState,
    checksum,
    migrate,
    normalize,
    sanitizeSub,
    // phase 7 (CONTRACT §15.1 – §15.3): the shape rules of the real-time beds, the 곳간 and the local completion book
    sanitizeRealFarm, sanitizeRtBed, sanitizeRtReport, sanitizeStorage,
    noteInput,
    pending,
    LocalAdapter,
    ServerAdapter,

    /**
     * apply the settings stored in a profile save to G.settings (validated per key type).
     * Profile-scoped keys (easyMode, kidChat, parentGate) ALWAYS come from the save, falling back to the
     * defaults when the save predates them (existing players get easy mode = the default, §12.1).
     * Emits settings:changed for every key whose value actually changed.
     */
    applyProfileSettings(state) {
      const src = state && state.settings && typeof state.settings === 'object' && !Array.isArray(state.settings) ? state.settings : {};
      const defs = G.settingsDefaults, profileKeys = G.settingsProfileKeys || [];
      const changed = [];
      const set = (k, v) => { v = G.sanitizeSetting(k, v); if (G.settings[k] !== v) { G.settings[k] = v; changed.push([k, v]); } };
      for (const [k, v] of Object.entries(src)) if (k in defs && !profileKeys.includes(k)) set(k, v);
      for (const k of profileKeys) set(k, Object.prototype.hasOwnProperty.call(src, k) ? src[k] : defs[k]);
      // the OS asks for less motion and the player never chose otherwise: the profile's stored value does not override it
      if (G.osReducedMotion?.() && !G.reduceMotionChosen?.()) set('reduceMotion', true);
      G.applySettingsToDom();
      for (const [key, value] of changed) G.bus.emit('settings:changed', { key, value });
      return changed.length;
    },

    /** choose who we are saving for. mode: 'local' | 'server' */
    useProfile(profile, mode) {
      G.save.profile = profile;
      G.save.adapter = mode === 'server' ? ServerAdapter : LocalAdapter;
      ServerAdapter.reset(); // a revision belongs to one login of one account
      G.save.conflict = false;
      G.save._fail = freshFail();
      G.save.quota = { tight: false, noted: false };
      const chip = document.getElementById('hud-mode');
      if (chip) { chip.textContent = mode === 'server' ? '서버' : '로컬'; chip.classList.toggle('server', mode === 'server'); chip.title = mode === 'server' ? '서버에 저장됩니다' : '이 브라우저에 저장됩니다'; }
    },

    /** load (or create) the state for the current profile */
    async load() {
      const profile = G.save.profile || { id: 'guest', nickname: '게스트' };
      let res = { data: null, source: 'none' };
      try { res = await G.save.adapter.load(profile.id); }
      catch (e) {
        G.log.error('SAVE', 'load failed', e);
        res = { data: null, source: 'error' };
      }
      const isNew = !res.data;
      const state = normalize(res.data, profile);
      state._isNew = isNew;
      const warn = (msg, easy) => G.ui?.toast?.(msg, { type: 'warn', duration: 6000, ...(easy ? { easy } : {}) });
      const works = G.save.adapter === LocalAdapter ? storageWorks() : true;
      if (works === 'full') warn('저장 공간이 꽉 찼어요. 오래된 사진이나 쓰지 않는 프로필을 지워 주세요.', '저장 공간이 꽉 찼어요. 어른에게 알려 줘요!');
      else if (!works) warn('이 브라우저는 저장을 막아 두었어요. 창을 닫으면 놀던 것이 사라져요.');
      else if (res.source === 'error') warn('저장된 기록을 불러오지 못해서 새로 시작해요.');
      else if (res.source === 'backup') warn('저장 파일이 망가져서 백업으로 되살렸어요.');
      else if (res.source === 'corrupted') warn('저장 파일이 망가져서 새로 시작해요. 옛 파일은 따로 보관했어요.');
      G.save.applyProfileSettings(state);
      G.save.dirty = false;
      G.log.info('SAVE', `loaded profile ${profile.id} (${res.source}${isNew ? ', new' : ''})`);
      return state;
    },

    /** persist now. returns true on success */
    async save(opts = {}) {
      if (!G.state || !G.save.profile) return false;
      if (G.save.conflict) return false; // another tab holds newer progress of this profile
      if (G.save.saving) { G.save._again = true; return false; }
      G.save.saving = true;
      let snap = null;
      try {
        snap = snapshot();
        await G.save.adapter.save(G.save.profile.id, snap);
        G.save.dirty = false;
        G.save.lastSavedAt = Date.now();
        G.bus.emit('state:saved', { reason: opts.reason });
        onSaved();
        if (opts.notify) G.ui?.toast?.('저장되었습니다.', { type: 'success', icon: 'save' });
        return true;
      } catch (e) {
        if (e && e.code === 'SAVE_CONFLICT') { markConflict(); return false; }
        // a refusal the server answered with its stored copy (STALE_SAVE / VALIDATION_FAILED) is handled right here
        if (G.save._pendingServerRestore) G.log.warn('SAVE', 'save refused, restoring the server copy', e?.code || e);
        // an ended server session is expected (idle / lifetime): save:auth-lost and the re-login prompt handle it
        else if (G.save.adapter === ServerAdapter && (Number(e?.status) === 401 || e?.code === 'AUTH_REQUIRED')) G.log.warn('SAVE', 'save needs a new login (session ended)', e?.code || e?.status);
        else G.log.error('SAVE', 'save failed', e);
        if (G.save._pendingServerRestore) {
          const srv = G.save._pendingServerRestore, code = G.save._pendingServerRestoreCode;
          const violations = G.save._pendingServerRestoreViolations || [];
          G.save._pendingServerRestore = null; G.save._pendingServerRestoreCode = null; G.save._pendingServerRestoreViolations = null;
          G.state = normalize(typeof srv.data === 'string' ? JSON.parse(srv.data) : srv.data, G.save.profile);
          G.save.applyProfileSettings(G.state);
          G.applyState();
          G.save.dirty = false;
          if (code === 'SAVE_RESTORED') {
            // the progress this tab kept for a later login is what the restore took back: it must not undo the restore
            pending.drop(G.save.profile.id);
            G.ui?.toast?.('운영자가 되돌린 저장 기록을 불러왔어요. 그 기록부터 이어서 해요.', { type: 'info', icon: 'save', duration: 7000, easy: '전에 저장한 곳부터 다시 놀아요!' });
          } else if (code === 'STALE_SAVE') {
            // the progress this device kept while saves failed is NEVER thrown away by the restore: a pending copy that
            // is newer than the copy the server handed back stays aside for the next login (R3 device-env-1)
            const pend = pending.get(G.save.profile.id);
            if (pend && Number(pend.savedAt) > (Number(G.state.savedAt) || 0) && pending.keepLost(G.save.profile.id)) G.log.warn('SAVE', 'offline progress kept aside for the next login (pending.lost)');
            G.save._fail.pendingSelf = false;
            G.ui?.toast?.('다른 창(기기)에서 더 새로 저장한 진행 상황을 불러왔어요.', { type: 'info', icon: 'save', easy: '다른 곳에서 논 것을 불러왔어요!' });
          }
          else {
            // a real-time bed harvested before the server's own clock said ready (RT_HARVEST_TOO_EARLY, §15.1): the
            // farm module tells the child calmly that it is not ready yet instead of the grown-up refusal line
            let handled = false;
            try { handled = G.sys.realfarm?.onSaveRefused?.(violations) === true; } catch (err) { handled = false; }
            if (!handled) G.ui?.toast?.('서버 검증에 실패해 서버에 저장된 진행 상황으로 복구했습니다.', { type: 'warn' });
          }
        } else onFailed(e, snap, opts);
        return false;
      } finally {
        G.save.saving = false;
        if (G.save._again) { G.save._again = false; setTimeout(() => G.save.save({ reason: 'queued' }), 500); }
      }
    },

    /** mark state as changed; saves after a short debounce */
    markDirty(reason) {
      if (!G.state) return;
      G.save.dirty = true;
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => G.save.save({ reason: reason || 'dirty' }), G.save.adapter === ServerAdapter ? 4000 : 1500);
    },

    startAutosave(intervalMs = 30000) {
      clearInterval(autosaveTimer);
      if (G.save.conflict) return;
      // a new session: play time counts from now (loading and the title screen are not play)
      play.at = performance.now();
      play.vis = !document.hidden;
      autosaveTimer = setInterval(() => {
        if (!G.state) return;
        G.save.save({ reason: 'autosave' }); // the snapshot adds the play time since the last one
      }, intervalMs);
    },
    stopAutosave() { clearInterval(autosaveTimer); clearTimeout(debounceTimer); play.at = 0; },

    /** wipe progress for the current profile and start over */
    async resetProgress() {
      const p = G.save.profile;
      if (!p) return;
      G.save.adapter.remove?.(p.id);
      G.state = normalize(null, p);
      G.state._isNew = true;
      G.save.applyProfileSettings(G.state); // a fresh start is a child-safe start (easy mode = default)
      await G.save.save({ reason: 'reset' });
      G.applyState();
    },

    exportJSON() { return JSON.stringify({ app: 'tfm-metaverse', version: STATE_VERSION, exportedAt: new Date().toISOString(), state: G.state }, null, 2); },
    importJSON(text) {
      const obj = JSON.parse(text);
      if (!obj || obj.app !== 'tfm-metaverse' || !obj.state) throw new Error('올바른 저장 파일이 아닙니다.');
      G.state = normalize(obj.state, G.save.profile);
      G.save.applyProfileSettings(G.state);
      G.applyState();
      return G.save.save({ reason: 'import', notify: true });
    },
  };

  // flush on tab close / hide (local adapter is synchronous enough; server uses keepalive best effort)
  const flush = () => {
    if (!G.state || !G.save.profile || !G.save.dirty || G.save.conflict) return;
    try {
      if (G.save.adapter === LocalAdapter) G.save.save({ reason: 'unload' });
      else {
        // the beacon carries the same snapshot a normal save would (fresh settings, live module values, no '_'
        // keys); its answer is never seen, so the copy also stays on this device until a save is confirmed
        const snap = snapshot();
        pending.put(G.save.profile.id, snap);
        if (navigator.sendBeacon && G.net.csrf) {
          // best effort: the server also accepts beacons with the csrf token in the payload
          // with the same base as a normal save: a stale tab's beacon never overwrites newer progress either
          const data = JSON.stringify({ ...ServerAdapter.body(snap, JSON.stringify(snap)), csrf: G.net.csrf });
          if (navigator.sendBeacon(G.net.base + 'player/save.php', new Blob([data], { type: 'application/json' }))) ServerAdapter.mark(snap.savedAt);
        }
      }
    } catch (e) { /* ignore */ }
  };
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
  // two tabs of one local profile: the moment the other tab saves it, this one is stale (it would erase that progress)
  window.addEventListener('storage', (e) => {
    try {
      if (!G.state || !G.save.profile || G.save.adapter !== LocalAdapter || e.storageArea !== localStorage) return;
      if (e.key === LocalAdapter.key(G.save.profile.id) && e.newValue) markConflict();
    } catch (err) { /* storage blocked */ }
  });
})();
