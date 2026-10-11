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

    /** Decide local vs server mode. Server mode only when served over http(s) next to api/ping.php. */
    async detect() {
      G.net.mode = 'local';
      if (G.flags.forceLocal) return 'local';
      if (!/^https?:$/.test(location.protocol)) return 'local';
      try {
        const res = await G.net.request('ping.php', { timeout: 2500, quiet: true });
        if (res && res.app === 'tfm-metaverse') {
          G.net.mode = 'server';
          G.net.serverInfo = res;
          if (res.serverTime) G.time.serverOffset = Number(res.serverTime) - Date.now();
          if (res.csrf) G.net.csrf = res.csrf;
          G.log.info('NETWORK', `server mode (api v${res.version || '?'}, db: ${res.db || '?'})`);
        }
      } catch (e) {
        G.log.info('NETWORK', 'no PHP API found -> local mode');
      }
      return G.net.mode;
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
      if (!json || json.success !== true) {
        const err = (json && json.error) || {};
        throw new ApiError(err.code || `HTTP_${res.status}`, err.message || '작업을 완료하지 못했습니다. 잠시 후 다시 시도해주세요.', res.status, json && json.data);
      }
      return json.data;
    },
  };
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
      },
      player: { x: sp.x, y: 0, z: sp.z, rotY: sp.rotY, zoneId: 'ZONE_MAIN' },
      inventory: G.util.clone(G.data.startingInventory || {}),
      quests: {},          // questId -> { status, progress:[n...], acceptedAt, completedAt, claimedAt, tracked }
      farm: { plots: {} }, // plotId -> { cropId, growth, water, health, plantedAt, lastUpdate, lastWaterAt, harvests }
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
  function normalize(data, profile) {
    const def = createDefaultState(profile);
    if (!data || typeof data !== 'object') return def;
    data = migrate(data);
    G.util.defaults(data, def);
    // arrays may be corrupted
    for (const k of ['journal', 'photos', 'activity', 'blocked']) if (!Array.isArray(data[k])) data[k] = [];
    if (profile) { data.profile.id = profile.id; if (profile.nickname) data.profile.nickname = profile.nickname; if (profile.role) data.profile.role = profile.role; if (profile.email) data.profile.email = profile.email; }
    return data;
  }

  // ---------------------------------------------------------------- adapters
  const LocalAdapter = {
    name: 'local',
    key: (id) => `${PREFIX}save.${id}`,
    async load(id) {
      const tryParse = (raw) => {
        if (!raw) return null;
        const env = JSON.parse(raw);
        if (!env || typeof env.data !== 'string') return null;
        if (env.checksum && checksum(env.data) !== env.checksum) throw new Error('checksum mismatch');
        return JSON.parse(env.data);
      };
      try {
        const main = tryParse(localStorage.getItem(LocalAdapter.key(id)));
        if (main) return { data: main, source: 'main' };
      } catch (e) {
        G.log.warn('SAVE', 'main save corrupted, trying backup', e);
        try {
          const bak = tryParse(localStorage.getItem(LocalAdapter.key(id) + '.bak'));
          if (bak) return { data: bak, source: 'backup' };
        } catch (e2) { G.log.error('SAVE', 'backup also corrupted', e2); }
        return { data: null, source: 'corrupted' };
      }
      return { data: null, source: 'none' };
    },
    async save(id, state) {
      // keep local storage bounded: photos/journal photos are thumbnails, cap counts
      if (state.photos.length > LOCAL_PHOTO_LIMIT) state.photos.splice(0, state.photos.length - LOCAL_PHOTO_LIMIT);
      const data = JSON.stringify(state);
      const env = JSON.stringify({ version: STATE_VERSION, savedAt: state.savedAt, checksum: checksum(data), data });
      const k = LocalAdapter.key(id);
      try {
        const prev = localStorage.getItem(k);
        if (prev) localStorage.setItem(k + '.bak', prev);
        localStorage.setItem(k, env);
      } catch (e) {
        // quota: drop backup + oldest photo thumbnails and retry once
        try {
          localStorage.removeItem(k + '.bak');
          state.photos.splice(0, Math.ceil(state.photos.length / 2));
          for (const j of state.journal) if (j.photo && j.photo.length > 60000) j.photo = null;
          const d2 = JSON.stringify(state);
          localStorage.setItem(k, JSON.stringify({ version: STATE_VERSION, savedAt: state.savedAt, checksum: checksum(d2), data: d2 }));
          G.ui?.toast?.('저장 공간이 부족해 오래된 사진 일부를 정리했습니다.', { type: 'warn' });
        } catch (e2) { throw e2; }
      }
      return { savedAt: state.savedAt };
    },
    remove(id) { try { localStorage.removeItem(LocalAdapter.key(id)); localStorage.removeItem(LocalAdapter.key(id) + '.bak'); } catch (e) { /* ignore */ } },
  };

  const ServerAdapter = {
    name: 'server',
    async load() {
      const d = await G.net.request('player/get.php');
      if (!d || !d.save || !d.save.data) return { data: null, source: 'none' };
      let data = d.save.data;
      if (typeof data === 'string') data = JSON.parse(data);
      return { data, source: 'server' };
    },
    async save(id, state) {
      const data = JSON.stringify(state);
      try {
        return await G.net.request('player/save.php', { body: { version: STATE_VERSION, checksum: checksum(data), data: state } });
      } catch (e) {
        if (e.code === 'VALIDATION_FAILED' && e.data && e.data.save) {
          // server rejected suspicious progress -> restore server copy
          G.log.warn('SAVE', 'server rejected save, restoring server state', e.message);
          G.save._pendingServerRestore = e.data.save;
        }
        throw e;
      }
    },
    remove() { /* server keeps data */ },
  };

  // ---------------------------------------------------------------- manager
  let autosaveTimer = 0, debounceTimer = 0;
  G.save = {
    STATE_VERSION,
    adapter: LocalAdapter,
    profile: null,
    dirty: false,
    saving: false,
    lastSavedAt: 0,
    createDefaultState,
    checksum,
    migrate,
    normalize,
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
      G.applySettingsToDom();
      for (const [key, value] of changed) G.bus.emit('settings:changed', { key, value });
      return changed.length;
    },

    /** choose who we are saving for. mode: 'local' | 'server' */
    useProfile(profile, mode) {
      G.save.profile = profile;
      G.save.adapter = mode === 'server' ? ServerAdapter : LocalAdapter;
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
        G.ui?.toast?.('저장 데이터를 불러오지 못해 새로 시작합니다.', { type: 'warn' });
      }
      const isNew = !res.data;
      const state = normalize(res.data, profile);
      state._isNew = isNew;
      if (res.source === 'backup') G.ui?.toast?.('저장 파일이 손상되어 백업본으로 복구했습니다.', { type: 'warn' });
      G.save.applyProfileSettings(state);
      G.save.dirty = false;
      G.log.info('SAVE', `loaded profile ${profile.id} (${res.source}${isNew ? ', new' : ''})`);
      return state;
    },

    /** persist now. returns true on success */
    async save(opts = {}) {
      if (!G.state || !G.save.profile) return false;
      if (G.save.saving) { G.save._again = true; return false; }
      G.save.saving = true;
      try {
        G.bus.emit('state:before-save', G.state);
        G.state.savedAt = G.time.now();
        G.state.settings = { ...G.settings };
        const snapshot = JSON.parse(JSON.stringify(G.state, (k, v) => (k.startsWith('_') ? undefined : v)));
        await G.save.adapter.save(G.save.profile.id, snapshot);
        G.save.dirty = false;
        G.save.lastSavedAt = Date.now();
        G.bus.emit('state:saved', { reason: opts.reason });
        if (opts.notify) G.ui?.toast?.('저장되었습니다.', { type: 'success', icon: 'save' });
        return true;
      } catch (e) {
        G.log.error('SAVE', 'save failed', e);
        if (G.save._pendingServerRestore) {
          const srv = G.save._pendingServerRestore; G.save._pendingServerRestore = null;
          G.state = normalize(typeof srv.data === 'string' ? JSON.parse(srv.data) : srv.data, G.save.profile);
          G.save.applyProfileSettings(G.state);
          G.applyState();
          G.ui?.toast?.('서버 검증에 실패해 서버에 저장된 진행 상황으로 복구했습니다.', { type: 'warn' });
        } else if (opts.notify || opts.reason === 'manual') {
          G.ui?.toast?.(e.message || '저장하지 못했습니다.', { type: 'error' });
        }
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
      autosaveTimer = setInterval(() => {
        if (!G.state) return;
        G.state.stats.playTime = (G.state.stats.playTime || 0) + intervalMs / 1000;
        G.save.save({ reason: 'autosave' });
      }, intervalMs);
    },
    stopAutosave() { clearInterval(autosaveTimer); clearTimeout(debounceTimer); },

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
    if (!G.state || !G.save.profile || !G.save.dirty) return;
    try {
      if (G.save.adapter === LocalAdapter) G.save.save({ reason: 'unload' });
      else if (navigator.sendBeacon && G.net.csrf) {
        // best effort: the server also accepts beacons with the csrf token in the payload
        const data = JSON.stringify({ version: STATE_VERSION, checksum: checksum(JSON.stringify(G.state)), data: G.state, csrf: G.net.csrf });
        navigator.sendBeacon(G.net.base + 'player/save.php', new Blob([data], { type: 'application/json' }));
      }
    } catch (e) { /* ignore */ }
  };
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
})();
