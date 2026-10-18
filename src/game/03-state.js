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
  const isMap = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
  /** keys that name Object.prototype members ('__proto__', 'constructor', 'toString'…) are dropped: modules index
   *  their maps with `map[id]` and a hand-edited save must not shadow those names */
  function dropProtoKeys(o, depth) {
    for (const k of Object.keys(o)) {
      if (k in Object.prototype) delete o[k];
      else if (depth > 0 && isMap(o[k])) dropProtoKeys(o[k], depth - 1);
    }
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
  let quotaNoted = false;
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
        // quota: the backup copy goes first; only when that is not enough, the oldest photos (in the game too, so the
        // album shows exactly what is kept)
        try { localStorage.removeItem(k + '.bak'); } catch (e2) { /* ignore */ }
        try { write(state); }
        catch (e3) {
          const cut = Math.ceil(state.photos.length / 2);
          state.photos.splice(0, cut);
          const live = G.state && G.save.profile && G.save.profile.id === id ? G.state : null;
          if (live && Array.isArray(live.photos)) live.photos.splice(0, Math.min(cut, live.photos.length));
          for (const list of [state.journal, live?.journal]) for (const j of Array.isArray(list) ? list : []) if (j && typeof j.photo === 'string' && j.photo.length > 60000) j.photo = null;
          write(state);
          if (!quotaNoted) { quotaNoted = true; G.ui?.toast?.('저장 공간이 모자라서 오래된 사진을 조금 정리했어요.', { type: 'warn' }); }
        }
      }
      return { savedAt: state.savedAt };
    },
    remove(id) {
      const k = LocalAdapter.key(id);
      try { localStorage.removeItem(k); localStorage.removeItem(k + '.bak'); seen.set(k, { sig: '', ok: true }); } catch (e) { /* ignore */ }
    },
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
      const body = { version: STATE_VERSION, checksum: checksum(data), data: state };
      try {
        try { return await G.net.request('player/save.php', { body }); }
        catch (e) {
          // a rotated session (login elsewhere, expiry) leaves this tab with an old CSRF token; the error answer
          // carries the current one — one retry tells a stale token apart from a real refusal (then 401 / 403)
          if (e.code !== 'CSRF_INVALID') throw e;
          return await G.net.request('player/save.php', { body });
        }
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
  /** the state as it is persisted: modules write their live values first (state:before-save), settings and savedAt
   *  are stamped, runtime-only '_' keys are dropped. Shared by save() and the server-mode beacon. */
  function snapshot() {
    G.bus.emit('state:before-save', G.state);
    G.state.savedAt = G.time.now();
    G.state.settings = { ...G.settings };
    return JSON.parse(JSON.stringify(G.state, (k, v) => (k.startsWith('_') ? undefined : v)));
  }
  function storageWorks() {
    try { const k = `${PREFIX}__probe`; localStorage.setItem(k, '1'); localStorage.removeItem(k); return true; } catch (e) { return false; }
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
      if (!F.authLost || again) { F.authLost = true; G.bus.emit('save:auth-lost', { reason: opts.reason }); }
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
    createDefaultState,
    checksum,
    migrate,
    normalize,
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
      G.applySettingsToDom();
      for (const [key, value] of changed) G.bus.emit('settings:changed', { key, value });
      return changed.length;
    },

    /** choose who we are saving for. mode: 'local' | 'server' */
    useProfile(profile, mode) {
      G.save.profile = profile;
      G.save.adapter = mode === 'server' ? ServerAdapter : LocalAdapter;
      G.save.conflict = false;
      G.save._fail = freshFail();
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
      const warn = (msg) => G.ui?.toast?.(msg, { type: 'warn', duration: 6000 });
      if (G.save.adapter === LocalAdapter && !storageWorks()) warn('이 브라우저는 저장을 막아 두었어요. 창을 닫으면 놀던 것이 사라져요.');
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
        G.log.error('SAVE', 'save failed', e);
        if (G.save._pendingServerRestore) {
          const srv = G.save._pendingServerRestore; G.save._pendingServerRestore = null;
          G.state = normalize(typeof srv.data === 'string' ? JSON.parse(srv.data) : srv.data, G.save.profile);
          G.save.applyProfileSettings(G.state);
          G.applyState();
          G.ui?.toast?.('서버 검증에 실패해 서버에 저장된 진행 상황으로 복구했습니다.', { type: 'warn' });
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
          const data = JSON.stringify({ version: STATE_VERSION, checksum: checksum(JSON.stringify(snap)), data: snap, csrf: G.net.csrf });
          navigator.sendBeacon(G.net.base + 'player/save.php', new Blob([data], { type: 'application/json' }));
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
