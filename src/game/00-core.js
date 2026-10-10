// =============================================================================
// 00-core.js — G namespace, logger, event bus, utilities, icons, system registry,
//              main loop, time, boot fallback.
// Every fragment shares the closure variables THREE, ADDONS and G (see tools/build.mjs).
// =============================================================================

G.VERSION = (window.__BUILD__ && window.__BUILD__.version) || 'dev';
G.params = new URLSearchParams(location.search);
G.flags = {
  debug: G.params.get('debug') === '1',
  autostart: G.params.get('autostart') === '1',
  noTutorial: G.params.get('notutorial') === '1',
  forceLocal: G.params.get('local') === '1',
  quality: G.params.get('quality') || null, // low | medium | high
  test: G.params.get('test') === '1',
};
G.sys = G.sys || {};
G.data = G.data || {};
G.ready = false;
G.state = null;
G.__systemErrors = G.__systemErrors || [];

// ------------------------------------------------------------------ logger
// Categories follow the spec: [AUTH] [PLAYER] [QUEST] [FARM] [FERMENTATION] [INVENTORY] [API] [NETWORK] [SAVE] [UI] ...
(function () {
  const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 99 };
  let level = G.flags.debug ? LEVELS.debug : LEVELS.info;
  const fmt = (cat) => `[${String(cat || 'GAME').toUpperCase()}]`;
  G.log = {
    LEVELS,
    setLevel(name) { level = LEVELS[name] ?? level; },
    debug(cat, ...a) { if (level <= LEVELS.debug) console.debug(fmt(cat), ...a); },
    info(cat, ...a) { if (level <= LEVELS.info) console.info(fmt(cat), ...a); },
    warn(cat, ...a) { if (level <= LEVELS.warn) console.warn(fmt(cat), ...a); },
    error(cat, ...a) { if (level <= LEVELS.error) console.error(fmt(cat), ...a); },
  };
})();

// ------------------------------------------------------------------ event bus
(function () {
  const map = new Map();
  G.bus = {
    on(name, fn) {
      if (!map.has(name)) map.set(name, new Set());
      map.get(name).add(fn);
      return () => G.bus.off(name, fn);
    },
    once(name, fn) {
      const off = G.bus.on(name, (p) => { off(); fn(p); });
      return off;
    },
    off(name, fn) { const s = map.get(name); if (s) s.delete(fn); },
    emit(name, payload) {
      const s = map.get(name);
      if (G.flags.debug && !/^(player:moved|frame)$/.test(name)) G.log.debug('BUS', name, payload);
      if (!s) return;
      for (const fn of [...s]) {
        try { fn(payload); } catch (e) { G.log.error('BUS', `handler for "${name}" threw`, e); }
      }
    },
    count(name) { return map.get(name)?.size || 0; },
  };
})();

// ------------------------------------------------------------------ utilities
G.util = {
  clamp: (v, a, b) => (v < a ? a : v > b ? b : v),
  lerp: (a, b, t) => a + (b - a) * t,
  invLerp: (a, b, v) => (b === a ? 0 : (v - a) / (b - a)),
  smoothstep(a, b, v) { const t = G.util.clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); },
  /** frame-rate independent exponential smoothing factor */
  damp: (lambda, dt) => 1 - Math.exp(-lambda * dt),
  /** shortest signed angle difference a->b */
  angleDiff(a, b) { let d = (b - a) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return d; },
  angleLerp(a, b, t) { return a + G.util.angleDiff(a, b) * t; },
  dist2(ax, az, bx, bz) { const dx = ax - bx, dz = az - bz; return Math.sqrt(dx * dx + dz * dz); },
  rand: (a = 0, b = 1) => a + Math.random() * (b - a),
  randInt: (a, b) => Math.floor(a + Math.random() * (b - a + 1)),
  pick: (arr) => arr[Math.floor(Math.random() * arr.length)],
  shuffle(arr) { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; },
  /** deterministic PRNG: const r = G.util.rng(42); r() -> [0,1) */
  rng(seed) {
    let a = (typeof seed === 'string' ? G.util.hashInt(seed) : seed >>> 0) || 1;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  },
  /** cyrb53 string hash -> 53-bit int */
  hashInt(str, seed = 0) {
    let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
    for (let i = 0, ch; i < str.length; i++) {
      ch = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return 4294967296 * (2097151 & h2) + (h1 >>> 0);
  },
  hash(str) { return G.util.hashInt(String(str)).toString(16).padStart(14, '0'); },
  uid(prefix = 'id') { return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`; },
  clone(o) { return o == null ? o : (typeof structuredClone === 'function' ? structuredClone(o) : JSON.parse(JSON.stringify(o))); },
  /** fill missing keys of target from defaults (recursively, plain objects only) */
  defaults(target, defs) {
    if (!target || typeof target !== 'object') return G.util.clone(defs);
    for (const k of Object.keys(defs)) {
      const dv = defs[k];
      if (!(k in target) || target[k] === undefined) target[k] = G.util.clone(dv);
      else if (dv && typeof dv === 'object' && !Array.isArray(dv) && target[k] && typeof target[k] === 'object' && !Array.isArray(target[k])) G.util.defaults(target[k], dv);
    }
    return target;
  },
  debounce(fn, ms) { let t = 0; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; },
  throttle(fn, ms) { let last = 0, t = 0; return (...a) => { const n = performance.now(); if (n - last >= ms) { last = n; fn(...a); } else { clearTimeout(t); t = setTimeout(() => { last = performance.now(); fn(...a); }, ms - (n - last)); } }; },
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  nextFrame: () => new Promise((r) => requestAnimationFrame(() => r())),
  fmt: (n) => Number(n || 0).toLocaleString('ko-KR'),
  /** 75 -> "1분 15초", 3600 -> "1시간" */
  formatDuration(sec) {
    sec = Math.max(0, Math.round(sec));
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    if (h) return `${h}시간${m ? ` ${m}분` : ''}`;
    if (m) return `${m}분${s ? ` ${s}초` : ''}`;
    return `${s}초`;
  },
  /** 2026.10.06 */
  formatDate(ts = Date.now(), withTime = false) {
    const d = new Date(ts);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())}` + (withTime ? ` ${p(d.getHours())}:${p(d.getMinutes())}` : '');
  },
  escapeHtml(s) { return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); },
  isTyping() {
    const a = document.activeElement;
    if (!a || a === document.body) return false;
    return a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT' || a.isContentEditable;
  },
  /** point in polygon [[x,z],...] */
  pointInPoly(x, z, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i][0], zi = poly[i][1], xj = poly[j][0], zj = poly[j][1];
      if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
    }
    return inside;
  },
  /** distance from point to polyline [[x,z],...]; returns {d, t (0..1 along whole line), i (segment)} */
  distToPolyline(x, z, pts) {
    let best = Infinity, bi = 0, bt = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const ax = pts[i][0], az = pts[i][1], bx = pts[i + 1][0], bz = pts[i + 1][1];
      const vx = bx - ax, vz = bz - az, wx = x - ax, wz = z - az;
      const L = vx * vx + vz * vz || 1;
      const t = G.util.clamp((wx * vx + wz * vz) / L, 0, 1);
      const px = ax + vx * t - x, pz = az + vz * t - z;
      const d = Math.sqrt(px * px + pz * pz);
      if (d < best) { best = d; bi = i; bt = t; }
    }
    return { d: best, i: bi, t: (bi + bt) / Math.max(1, pts.length - 1) };
  },
};

// ------------------------------------------------------------------ time
// Growth / fermentation must not trust the client clock alone: in server mode
// G.time.serverOffset is set from the server's clock (see 03-state.js / G.net.detect).
G.time = {
  serverOffset: 0,
  now() { return Date.now() + G.time.serverOffset; },
  elapsed: 0, // seconds since loop start (render time)
  delta: 0,
  frame: 0,
};

// ------------------------------------------------------------------ icons (inline SVG, no external assets)
(function () {
  const P = {
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7"/>',
    'user-solid': '<circle cx="12" cy="8" r="4.3" fill="currentColor" stroke="none"/><path d="M3.4 21.2c.6-4.8 4.1-7.5 8.6-7.5s8 2.7 8.6 7.5z" fill="currentColor" stroke="none"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14c2.2.6 3.5 2.6 3.5 6"/>',
    chat: '<path d="M21 12a8.5 8.5 0 0 1-12.3 7.6L3.5 21l1.4-4.8A8.5 8.5 0 1 1 21 12z"/><path d="M8 12h.01M12 12h.01M16 12h.01" stroke-width="3"/>',
    pin: '<path d="M12 22s7-6.2 7-12a7 7 0 0 0-14 0c0 5.8 7 12 7 12z"/><circle cx="12" cy="10" r="2.6"/>',
    map: '<path d="M9 4 3 6.2v14L9 18l6 2 6-2.2v-14L15 6 9 4z"/><path d="M9 4v14M15 6v14"/>',
    bag: '<path d="M5 8h14l-1.2 12.2a1 1 0 0 1-1 .8H7.2a1 1 0 0 1-1-.8z"/><path d="M9 10V6a3 3 0 0 1 6 0v4"/>',
    quest: '<path d="M8 3h11v15a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3v-1h11v1a3 3 0 0 0 3 3"/><path d="M8 3a3 3 0 0 0-3 3v11"/><path d="M11 8h5M11 12h5"/>',
    collection: '<path d="M2 5h7a3 3 0 0 1 3 3v12a2.5 2.5 0 0 0-2.5-2.5H2z"/><path d="M22 5h-7a3 3 0 0 0-3 3v12a2.5 2.5 0 0 1 2.5-2.5H22z"/>',
    menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
    minus: '<path d="M5 12h14"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    x: '<path d="M6 6l12 12M18 6 6 18"/>',
    check: '<path d="m5 12.5 4.5 4.5L19 7"/>',
    'chevron-right': '<path d="m9 6 6 6-6 6"/>',
    'chevron-left': '<path d="m15 6-6 6 6 6"/>',
    'chevron-up': '<path d="m6 15 6-6 6 6"/>',
    'chevron-down': '<path d="m6 9 6 6 6-6"/>',
    smile: '<circle cx="12" cy="12" r="9"/><path d="M8 14s1.5 2.2 4 2.2 4-2.2 4-2.2"/><path d="M9 9.5h.01M15 9.5h.01" stroke-width="2.6"/>',
    hand: '<path d="M18 11V6a2 2 0 0 0-4 0v5"/><path d="M14 10V4a2 2 0 0 0-4 0v6"/><path d="M10 10.5V6a2 2 0 0 0-4 0v8"/><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.9-6-2.4l-3.6-3.6a2 2 0 0 1 2.8-2.8L7 15"/>',
    journal: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 2.5h6v3.5H9z"/><path d="M9 11h6M9 15h4"/>',
    sun: '<circle cx="12" cy="12" r="4.2"/><path d="M12 2v2.2M12 19.8V22M4.9 4.9l1.6 1.6M17.5 17.5l1.6 1.6M2 12h2.2M19.8 12H22M4.9 19.1l1.6-1.6M17.5 6.5l1.6-1.6"/>',
    cloud: '<path d="M17.5 19H7a5 5 0 1 1 1.1-9.9A6 6 0 0 1 19.6 11 4 4 0 0 1 17.5 19z"/>',
    'cloud-sun': '<path d="M12 2v2M4.9 4.9l1.4 1.4M20 12h2M19.1 4.9l-1.4 1.4"/><path d="M15.9 13.1A4 4 0 0 0 8.4 9.6"/><path d="M14 20H7a4 4 0 1 1 .8-7.9A5 5 0 0 1 17.5 14 3 3 0 0 1 14 20z"/>',
    rain: '<path d="M20 15.6A5 5 0 0 0 17.5 6H16A8 8 0 1 0 4 14.9"/><path d="M8 14v5M12 16v5M16 14v5"/>',
    fog: '<path d="M4 9h16M3 13h18M5 17h14M8 5h8"/>',
    snow: '<path d="M12 2v20M4.2 7l15.6 10M4.2 17 19.8 7"/><path d="m9 4 3 2 3-2M9 20l3-2 3 2"/>',
    moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
    camera: '<path d="M4 7h3l2-3h6l2 3h3a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1z"/><circle cx="12" cy="13" r="4"/>',
    mic: '<rect x="9" y="2.5" width="6" height="11.5" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3.5M8.5 21.5h7"/>',
    'mic-off': '<path d="m3 3 18 18"/><path d="M9 9v2a3 3 0 0 0 5.1 2.1M15 9.3V5.5a3 3 0 0 0-5.7-1.3"/><path d="M19 11a7 7 0 0 1-1.2 3.9M5 11a7 7 0 0 0 10.8 5.9M12 18v3.5"/>',
    coin: '<circle cx="12" cy="12" r="9" fill="#f4c54a" stroke="#b9860f"/><circle cx="12" cy="12" r="6" fill="none" stroke="#c99316" stroke-width="1.4"/><path d="M12 8.6v6.8" stroke="#8a5d00" stroke-width="2"/>',
    book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5z"/><path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5"/>',
    star: '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3l-5.6 2.9 1.1-6.2L3 9.6l6.2-.9z"/>',
    trophy: '<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"/>',
    droplet: '<path d="M12 2.7s6 6.3 6 11a6 6 0 0 1-12 0c0-4.7 6-11 6-11z"/>',
    sprout: '<path d="M12 21v-9"/><path d="M12 12C12 8 9 5 4 5c0 4 3 7 8 7z"/><path d="M12 14c0-3 2.5-6 8-6 0 3.5-3 6-8 6z"/>',
    leaf: '<path d="M11 20A7 7 0 0 1 4 13c0-6 5-10 16-10 0 11-4 16-10 16z"/><path d="M4 21c4-6 8-9 12-11"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5h.01" stroke-width="2.4"/>',
    help: '<circle cx="12" cy="12" r="9"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
    volume: '<path d="M11 5 6 9H2v6h4l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14"/>',
    'volume-off': '<path d="M11 5 6 9H2v6h4l5 4z"/><path d="m22 9-6 6M16 9l6 6"/>',
    download: '<path d="M12 3v12M7 10l5 5 5-5M4 21h16"/>',
    upload: '<path d="M12 21V9M7 14l5-5 5 5M4 3h16"/>',
    trash: '<path d="M3 6h18M8 6V4h8v2M6 6l1 15h10l1-15"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
    lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
    run: '<circle cx="14" cy="4.5" r="2"/><path d="m6 21 3-6 3 2v5M8 11l3-3 3 2 2 3h3M10 8l-3 1-2 3"/>',
    jar: '<path d="M8 3h8M9 3v2c-3 2-4 5-4 8 0 4 2 7 4 8h6c2-1 4-4 4-8 0-3-1-6-4-8V3"/><path d="M6 11h12"/>',
    home: '<path d="m3 11 9-7 9 7"/><path d="M5 10v10h14V10"/>',
    logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
    save: '<path d="M5 3h11l3 3v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M7 3v5h8V3M7 21v-7h10v7"/>',
    gift: '<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13M5 12v9h14v-9M7.5 8a2.5 2.5 0 0 1 0-5C11 3 12 8 12 8s1-5 4.5-5a2.5 2.5 0 0 1 0 5"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    thermometer: '<path d="M14 14.8V4a2 2 0 0 0-4 0v10.8a4 4 0 1 0 4 0z"/>',
    refresh: '<path d="M21 12a9 9 0 1 1-2.6-6.4L21 8"/><path d="M21 3v5h-5"/>',
    image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 9"/>',
    shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
    bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0"/>',
    sparkle: '<path d="M12 3l1.9 5.6L19.5 10l-5.6 1.9L12 17.5l-1.9-5.6L4.5 10l5.6-1.4z"/>',
    target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
    eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    'eye-off': '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/><path d="M3 3l18 18"/>',
    flag: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
    expand: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
    keyboard: '<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/>',
    'watering-can': '<path d="M4 10h11v9a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z"/><path d="m15 12 6-4M7 10V7a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v3"/>',
    basket: '<path d="M3 10h18l-2 10H5z"/><path d="m8 10 4-6 4 6M9 14v3M15 14v3M12 14v3"/>',
    hammer: '<path d="m15 12-8.5 8.5a2.1 2.1 0 0 1-3-3L12 9"/><path d="m17.6 15 4.4-4.4-6.6-6.6-4.4 4.4z"/>',
    store: '<path d="M3 9 5 4h14l2 5"/><path d="M3 9a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0"/><path d="M5 12v8h14v-8"/>',
    teleport: '<circle cx="12" cy="12" r="3"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/>',
    bug: '<rect x="8" y="6" width="8" height="14" rx="4"/><path d="M12 20v-9M8 13H3M21 13h-5M5 7l3 2M19 7l-3 2M5 19l3-2M19 19l-3-2M10 6l-1-3M14 6l1-3"/>',
    chart: '<path d="M3 3v18h18"/><path d="M7 15l4-4 3 3 5-6"/>',
  };
  G.icon = function (name, cls = '') {
    const body = P[name] || P.info;
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="${cls}">${body}</svg>`;
  };
  G.icon.names = Object.keys(P);
})();

// ------------------------------------------------------------------ system registry
// G.register({ name, order, init(), onStateLoaded(state), update(dt, t), onLogout(), ...publicApi })
(function () {
  const list = [];
  G.register = function (sys) {
    if (!sys || !sys.name) throw new Error('G.register: system needs a name');
    if (G.sys[sys.name] && G.sys[sys.name] !== sys) G.log.warn('CORE', `system "${sys.name}" re-registered`);
    sys.order = sys.order ?? 50;
    G.sys[sys.name] = sys;
    const i = list.findIndex((s) => s.name === sys.name);
    if (i >= 0) list.splice(i, 1);
    list.push(sys);
    list.sort((a, b) => a.order - b.order);
    return sys;
  };
  G.systems = () => list.slice();

  function recordError(sys, phase, e) {
    G.__systemErrors.push({ system: sys.name, phase, message: String((e && e.stack) || e) });
    G.log.error('CORE', `system "${sys.name}" ${phase} failed:`, e);
  }
  G._recordSystemError = recordError;

  /** init every system in order; onProgress(fraction, label) */
  G.initSystems = async function (onProgress) {
    const systems = list.slice();
    let i = 0;
    for (const sys of systems) {
      i++;
      if (sys._initialized) continue;
      onProgress?.(i / (systems.length + 1), sys.label || sys.name);
      try {
        const t0 = performance.now();
        await sys.init?.();
        sys._initialized = true;
        const ms = performance.now() - t0;
        if (ms > 400) G.log.info('CORE', `init ${sys.name}: ${ms.toFixed(0)}ms`);
      } catch (e) {
        recordError(sys, 'init', e);
        sys._failed = true;
      }
      await G.util.nextFrame(); // keep the loading bar animating
    }
    for (const sys of systems) {
      if (sys._failed || !sys.postInit) continue;
      try { await sys.postInit(); } catch (e) { recordError(sys, 'postInit', e); }
    }
    onProgress?.(1, '완료');
  };

  /** push the freshly loaded/created G.state into every system */
  G.applyState = function () {
    for (const sys of list) {
      if (sys._failed || !sys.onStateLoaded) continue;
      try { sys.onStateLoaded(G.state); } catch (e) { recordError(sys, 'onStateLoaded', e); }
    }
    G.bus.emit('state:loaded', G.state);
  };

  G.logoutSystems = function () {
    for (const sys of list) {
      if (sys._failed || !sys.onLogout) continue;
      try { sys.onLogout(); } catch (e) { recordError(sys, 'onLogout', e); }
    }
  };

  // ---------------------------------------------------------------- main loop
  let raf = 0, last = 0;
  const errCount = new Map();
  function frame(now) {
    raf = requestAnimationFrame(frame);
    let dt = (now - last) / 1000;
    last = now;
    if (!(dt > 0)) dt = 0.016;
    if (dt > 0.1) dt = 0.1;
    G.time.delta = dt;
    G.time.elapsed += dt;
    G.time.frame++;
    const t = G.time.elapsed;
    for (const sys of list) {
      if (!sys.update || sys._failed || sys._updateDisabled || !sys._initialized) continue;
      try { sys.update(dt, t); } catch (e) {
        const n = (errCount.get(sys.name) || 0) + 1;
        errCount.set(sys.name, n);
        if (n === 1) recordError(sys, 'update', e);
        if (n > 60) { sys._updateDisabled = true; G.log.error('CORE', `update of "${sys.name}" disabled after repeated errors`); }
      }
    }
    try { G.sys.engine?.render?.(dt); } catch (e) {
      const n = (errCount.get('render') || 0) + 1; errCount.set('render', n);
      if (n === 1) recordError({ name: 'engine' }, 'render', e);
    }
    try { G.ui?.updateLabels?.(); } catch (e) { /* labels are cosmetic */ }
  }
  G.loop = {
    running: false,
    start() { if (G.loop.running) return; G.loop.running = true; last = performance.now(); raf = requestAnimationFrame(frame); },
    stop() { G.loop.running = false; cancelAnimationFrame(raf); },
  };
})();

// ------------------------------------------------------------------ misc helpers used everywhere
/** play a UI/game sound if the audio system exists */
G.sfx = function (name, opts) { try { G.sys.audio?.play?.(name, opts); } catch (e) { /* audio optional */ } };

/** append to the recent-activity log (used by the work journal to prefill entries) */
G.activity = function (type, text, extra) {
  if (!G.state) return;
  const zoneId = G.sys.minimap?.currentZone?.id || G.state.player?.zoneId || null;
  const entry = { t: G.time.now(), type, text, zoneId, ...(extra || {}) };
  G.state.activity = G.state.activity || [];
  G.state.activity.push(entry);
  if (G.state.activity.length > 60) G.state.activity.splice(0, G.state.activity.length - 60);
  G.bus.emit('activity', entry);
};

/** unified "this changed, please persist soon" */
G.dirty = function (reason) { G.save?.markDirty?.(reason); };

G.showFatal = function (err) {
  const el = document.getElementById('fatal');
  if (!el) return;
  el.hidden = false;
  el.innerHTML = `<h2>게임을 시작하지 못했습니다</h2><p>브라우저가 WebGL을 지원하는지 확인하고, 페이지를 새로고침해 주세요.</p><pre>${G.util.escapeHtml(String((err && err.stack) || err))}</pre><button class="btn btn-primary" type="button" id="fatal-reload">새로고침</button>`;
  el.querySelector('#fatal-reload')?.addEventListener('click', () => location.reload()); // no inline handlers (CSP)
  document.getElementById('loading-screen')?.classList.add('done');
};

G.webglAvailable = function () {
  try {
    const c = document.createElement('canvas');
    return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl')));
  } catch (e) { return false; }
};

// ------------------------------------------------------------------ boot
/**
 * G.start() is called by the build wrapper after all fragments are evaluated.
 * The app shell (70-app.js) provides G.app.start() with title/login/tutorial.
 * Without it (isolated module builds) we fall back to a minimal guest boot so
 * any module can be tested on its own.
 */
G.start = async function () {
  if (!window.THREE) { G.showFatal(new Error('three.js failed to load')); return; }
  if (!G.webglAvailable()) { G.showFatal(new Error('WebGL을 사용할 수 없습니다.')); return; }
  if (G.app && typeof G.app.start === 'function') return G.app.start();
  return G.devBoot();
};

G.devBoot = async function () {
  G.ui?.loading?.show();
  G.ui?.loading?.set(0.02, '네트워크 확인');
  try { await G.net?.detect?.(); } catch (e) { G.log.warn('NETWORK', 'detect failed', e); }
  await G.initSystems((f, label) => G.ui?.loading?.set(0.05 + f * 0.85, `${label} 준비 중`));
  G.ui?.loading?.set(0.93, '저장 데이터 불러오기');
  const profile = { id: 'guest', nickname: '게스트', role: G.flags.debug ? 'admin' : 'user' };
  G.save.useProfile(profile, 'local');
  G.state = await G.save.load();
  G.applyState();
  G.loop.start();
  G.ui?.setHudVisible?.(true);
  G.ui?.loading?.set(1, '입장!');
  G.ui?.loading?.hide();
  G.save.startAutosave();
  G.ready = true;
  G.bus.emit('game:ready');
};

window.addEventListener('error', (e) => { if (e?.error) G.log.error('WINDOW', e.error); });
window.addEventListener('unhandledrejection', (e) => { G.log.error('WINDOW', 'unhandled rejection', e.reason); });
