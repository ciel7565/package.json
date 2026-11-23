// =============================================================================
// 68-settings.js — the options registry and the settings window of the platform (CONTRACT §18.2, lane settings).
//
// Registry (G.sys.settings, exists as soon as this fragment has loaded):
//   define(def)            declare one option (or an array). A fragment that loads EARLIER pushes the same object to
//                          (G.settingsQueue = G.settingsQueue || []).push(def); the registry drains that queue now and at
//                          init, and afterwards G.settingsQueue.push(def) defines at once.
//   get(id) / set(id, v)   the current value (sanitised by its def) / change it (stored on the device at once, sent to
//                          the account when its scope is 'account'); set returns the value that was kept
//   reset(scope)           'all' | a tab id | an option id | 'account' | 'device' → back to the defaults
//   list(filter?)          the defs (filter: { tab, group, scope } or a function)
//   search(q)              defs whose label / hint / group / tab / words match (Korean, spaces ignored)
//   available(id)          true | a reason string (why the option cannot be used here)
//   open(tab?) / close()   the window (tab ids below); open() in easy mode = the child's simple controls
//   tabs()                 [{ id, label, icon }]
// def = { id, tab, group, type: toggle|select|steps|slider|key|action|info, label, hint, kid?, options | min / max /
//         step / unit, default, key (the G.settings key, default = id), scope: account|device, apply(v), available()
//         → true | reason, restart?, words?, fmt?(v), order?, map?: { to(v) → stored, from(stored) → v }, run?() (action),
//         render?(ctl) (info / custom control) }
//   options: [{ v, l, e? (emoji), hint? }] for select / steps; slider: min, max, step, unit ('%', '배' …)
// Events (G.bus): 'settings:defined' { id }, 'settings:option' { id, value, def }, 'settings:reset' { scope, ids },
//   'settings:synced' { v, from: 'server' | 'device' }. settings:changed (03-state) still fires for the stored key.
// Tabs: graphics 그래픽 · display 화면 · sound 소리 · controls 조작 · layout 화면 구성 · game 체험 · access 접근성 ·
//   kids 아이 보호 · account 계정 · data 데이터 · help 도움말 · credits 사용한 자료. The panes 70-app.js had (sound,
//   graphics, controls, game, access, kids, account, data, credits) are handed over with adoptPanes() and shown inside
//   their tab next to the registry's rows; nothing new is added to them by hand.
// Kept for the next login: G.settings (03-state) writes the device store at once; account-scope values also go to the
//   server (user_settings, api/settings/get.php · save.php, debounced 2 s, last write wins by v), device-scope values are
//   kept per device id inside the same blob (≤ 5 devices, ≤ 8 KB). G.data.settingsTable (pure data, evaluated by
//   tools/build.mjs in Node) carries the ids / types / ranges of the options declared here; Tfm\UserSettings checks a
//   saved blob against it (unknown ids of later lanes are kept only as short plain scalars).
// =============================================================================
(function () {
  // ------------------------------------------------------------------ pure table (Node-evaluable: no DOM, no THREE)
  // type: b = boolean, n = number [min, max, step], e = one of values; scope a = account, d = device.
  const N = (min, max, step, d, scope) => ({ t: 'n', min, max, step, d, s: scope || 'a' });
  const B = (d, scope) => ({ t: 'b', d: !!d, s: scope || 'a' });
  const E = (values, d, scope) => ({ t: 'e', values, d, s: scope || 'a' });
  const TABLE = {
    v: 1, bytes: 8192, devices: 5, maxOptions: 200,
    tabs: ['graphics', 'display', 'sound', 'controls', 'layout', 'game', 'access', 'kids', 'account', 'data', 'help', 'credits'],
    options: {
      // 소리 (0 – 100, 100 = the balanced level the 체험관 has always had)
      mixMaster: N(0, 100, 5, 100), mixMusic: N(0, 100, 5, 100), mixSfx: N(0, 100, 5, 100), mixUi: N(0, 100, 5, 100),
      mixVoice: N(0, 100, 5, 100), mixNature: N(0, 100, 5, 100), muteHidden: B(true),
      muted: B(false), musicGugak: B(true), natureSounds: B(true),
      volumeMaster: N(0, 1, 0.05, 0.8), volumeMusic: N(0, 1, 0.05, 0.45), volumeSfx: N(0, 1, 0.05, 0.8), volumeAmbient: N(0, 1, 0.05, 0.6), volumeVoice: N(0, 1, 0.05, 0.9),
      // 화면 구성
      uiScale: N(0.75, 1.4, 0.01, 1), textScale: N(1, 5, 1, 2), avatarScale: N(80, 130, 5, 100),
      nameplates: E(['all', 'others', 'off'], 'all'), minimapSize: N(1, 3, 1, 2), minimapVisible: B(true),
      chatOpacity: N(30, 100, 5, 100), hudOpacity: N(40, 100, 5, 100), highContrast: B(false), largeText: B(false),
      // 조작
      sensitivity: N(0.2, 3, 0.1, 1), invertY: B(false), clickToMove: B(true), cameraShake: B(true), lookSpeed: N(0.25, 4, 0.05, 1),
      mouseLook: E(['auto', 'lock', 'walk', 'drag'], 'auto'), stickSide: E(['left', 'right'], 'left', 'd'), touchButtons: N(1, 3, 1, 2, 'd'),
      // 그래픽 (behaviour in the engine; lane gfx declares the rest of the owner's list through the registry)
      quality: E(['auto', 'low', 'medium', 'high'], 'auto', 'd'), shadows: B(true, 'd'), bloom: B(true, 'd'), showFps: B(false),
      // 체험 · 접근성 · 아이 보호
      autoWeather: B(true), lockTime: B(false), chatVisible: B(true), companion: B(true),
      reduceMotion: B(false), voiceOver: B(false), voiceGuide: B(true), voiceRate: N(0.6, 1.4, 0.05, 0.95), playReminderMin: N(0, 240, 1, 30),
      helpSeen: N(0, 99, 1, 0),
    },
  };
  G.data = G.data || {};
  G.data.settingsTable = TABLE;
  if (typeof document === 'undefined' || typeof G.register !== 'function') return; // Node data export stops here

  // ------------------------------------------------------------------ registry
  const U = G.util || {};
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const TYPES = ['toggle', 'select', 'steps', 'slider', 'key', 'action', 'info'];
  const TABS = [
    { id: 'graphics', label: '그래픽', icon: '🖥️' }, { id: 'display', label: '화면', icon: '🪟' }, { id: 'sound', label: '소리', icon: '🔊' },
    { id: 'controls', label: '조작', icon: '🎮' }, { id: 'layout', label: '화면 구성', icon: '🔠' }, { id: 'game', label: '체험', icon: '🌿' },
    { id: 'access', label: '접근성', icon: '♿' }, { id: 'kids', label: '아이 보호', icon: '👶' }, { id: 'account', label: '계정', icon: '👤' },
    { id: 'data', label: '데이터', icon: '💾' }, { id: 'help', label: '도움말', icon: '❓' }, { id: 'credits', label: '사용한 자료', icon: '🖼️' },
  ];
  const TAB_IDS = new Set(TABS.map((t) => t.id));
  const defs = new Map();        // id → def
  const byKey = new Map();       // G.settings key → id
  let seq = 0;
  let initDone = false;
  const isBad = (k) => k === '__proto__' || k === 'constructor' || k === 'prototype';
  const warn = (...a) => { try { G.log.warn('SETTINGS', ...a); } catch (e) { /* no log */ } };

  /** normalise a def; returns null (with a warning) when it cannot be used */
  function normalise(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const id = String(raw.id || '');
    if (!/^[A-Za-z][\w]{0,39}$/.test(id) || isBad(id)) { warn('bad option id', id); return null; }
    const type = TYPES.includes(raw.type) ? raw.type : null;
    if (!type) { warn('bad option type', id, raw.type); return null; }
    const T = TABLE.options[raw.key || id] || null;
    const d = Object.assign({}, raw);
    d.id = id; d.type = type;
    d.tab = TAB_IDS.has(raw.tab) ? raw.tab : 'game';
    d.group = typeof raw.group === 'string' ? raw.group.slice(0, 40) : '';
    d.label = String(raw.label || id).slice(0, 60);
    d.hint = typeof raw.hint === 'string' ? raw.hint.slice(0, 200) : '';
    d.key = typeof raw.key === 'string' && raw.key && !isBad(raw.key) ? raw.key : id;
    d.scope = raw.scope === 'device' || raw.scope === 'account' ? raw.scope : (T && T.s === 'd' ? 'device' : 'account');
    d.order = Number.isFinite(Number(raw.order)) ? Number(raw.order) : 100;
    d._seq = seq++;
    if (type === 'select' || type === 'steps') {
      let opts = Array.isArray(raw.options) ? raw.options : [];
      opts = opts.map((o) => (o && typeof o === 'object' ? o : { v: o, l: String(o) })).filter((o) => o.v !== undefined);
      if (!opts.length && type === 'steps' && Number.isFinite(Number(raw.min)) && Number.isFinite(Number(raw.max))) {
        for (let v = Number(raw.min); v <= Number(raw.max); v += Number(raw.step) || 1) opts.push({ v, l: String(v) });
      }
      if (!opts.length) { warn('option without choices', id); return null; }
      d.options = opts.map((o) => ({ v: o.v, l: String(o.l ?? o.v).slice(0, 30), e: o.e ? String(o.e).slice(0, 8) : '', hint: o.hint ? String(o.hint).slice(0, 120) : '' }));
    }
    if (type === 'slider') {
      d.min = Number.isFinite(Number(raw.min)) ? Number(raw.min) : (T ? T.min : 0);
      d.max = Number.isFinite(Number(raw.max)) ? Number(raw.max) : (T ? T.max : 100);
      if (!(d.max > d.min)) { warn('slider range', id); return null; }
      d.step = Number(raw.step) > 0 ? Number(raw.step) : (T ? T.step : 1);
      d.unit = typeof raw.unit === 'string' ? raw.unit.slice(0, 8) : '';
    }
    if (raw.default === undefined && type !== 'action' && type !== 'info') {
      d.default = T ? T.d : (type === 'toggle' ? false : type === 'slider' ? d.min : d.options ? d.options[0].v : '');
    }
    return d;
  }
  /** a value made fit for its def (type, range, choices); undefined for action / info */
  function fit(d, v) {
    switch (d.type) {
      case 'toggle': return typeof v === 'boolean' ? v : (v === 1 || v === '1' || v === 'true') ? true : (v === 0 || v === '0' || v === 'false') ? false : !!d.default;
      case 'slider': {
        const n = Number(v);
        if (typeof v === 'boolean' || v === null || v === '' || !Number.isFinite(n)) return d.default;
        const k = d.step > 0 ? Math.round((clamp(n, d.min, d.max) - d.min) / d.step) * d.step + d.min : n;
        return Math.round(clamp(k, d.min, d.max) * 1e6) / 1e6;
      }
      case 'select': case 'steps': {
        const hit = d.options.find((o) => o.v === v) || d.options.find((o) => String(o.v) === String(v));
        return hit ? hit.v : d.default;
      }
      case 'key': return Array.isArray(v) ? v.filter((c) => typeof c === 'string' && /^[\w]{1,24}$/.test(c)).slice(0, 3) : d.default;
      default: return undefined;
    }
  }
  const stored = (d) => (G.settings ? G.settings[d.key] : undefined);
  /** register the key with 03-state's validator (type of the default, range, choices) */
  function teachState(d) {
    const D = G.settingsDefaults;
    if (!D || d.type === 'action' || d.type === 'info' || d.map) return;
    if (!(d.key in D) && d.default !== undefined && typeof d.default !== 'object') D[d.key] = d.default;
    if (d.type === 'slider' && G.settingsRanges && !G.settingsRanges[d.key]) G.settingsRanges[d.key] = [d.min, d.max];
    if (d.type === 'select' && G.settingsEnums && !G.settingsEnums[d.key] && d.options.every((o) => typeof o.v === 'string')) G.settingsEnums[d.key] = d.options.map((o) => o.v);
    if (d.scope === 'device' && G.settingsDeviceKeys) G.settingsDeviceKeys.add(d.key);
    if (G.settings && G.settings[d.key] === undefined) {
      let v = d.default;
      try { if (typeof G.deviceSetting === 'function') v = G.deviceSetting(d.key); } catch (e) { /* storage blocked */ }
      G.settings[d.key] = fit(d, v === undefined ? d.default : v);
    }
  }
  function callApply(d, v) {
    if (typeof d.apply !== 'function') return;
    try { d.apply(v, d); } catch (e) { warn('apply failed', d.id, e && e.message ? e.message : e); }
  }

  const reg = {
    name: 'settings', order: 3, label: '설정',
    TABLE, TABS,
    get initialized() { return initDone; },
    define(def) {
      if (Array.isArray(def)) return def.map((x) => reg.define(x));
      const d = normalise(def);
      if (!d) return null;
      const old = defs.get(d.id);
      if (old && old.key !== d.key) byKey.delete(old.key);
      defs.set(d.id, d);
      if (d.type !== 'action' && d.type !== 'info') {
        byKey.set(d.key, d.id);
        teachState(d);
        if (initDone) callApply(d, reg.get(d.id));
      }
      try { G.bus.emit('settings:defined', { id: d.id }); } catch (e) { /* bus optional */ }
      return d;
    },
    has(id) { return defs.has(id); },
    def(id) { return defs.get(id) || null; },
    idForKey(key) { return byKey.get(key) || null; },
    get(id) {
      const d = defs.get(id);
      if (!d) return G.settings ? G.settings[id] : undefined;
      if (d.type === 'action' || d.type === 'info') return undefined;
      const raw = stored(d);
      if (d.map && typeof d.map.from === 'function') { try { return fit(d, d.map.from(raw)); } catch (e) { return d.default; } }
      return fit(d, raw === undefined ? d.default : raw);
    },
    set(id, value, opts) {
      const d = defs.get(id);
      if (!d) { if (typeof id === 'string' && G.setSetting) G.setSetting(id, value); return G.settings?.[id]; }
      if (d.type === 'action') { try { d.run?.(d); } catch (e) { warn('action failed', id, e); } return undefined; }
      if (d.type === 'info') return undefined;
      const avail = reg.available(id);
      if (avail !== true && !(opts && opts.force)) return reg.get(id);
      const v = fit(d, value);
      let out = v;
      if (d.map && typeof d.map.to === 'function') { try { out = d.map.to(v); } catch (e) { return reg.get(id); } }
      if (G.settings && G.settings[d.key] === out) { if (opts && opts.apply) callApply(d, v); return v; }
      reg._selfWrite = d.key;
      try { if (G.setSetting) G.setSetting(d.key, out); else if (G.settings) G.settings[d.key] = out; } finally { reg._selfWrite = null; }
      const now = reg.get(id);
      callApply(d, now);
      try { G.bus.emit('settings:option', { id, value: now, def: d }); } catch (e) { /* bus optional */ }
      if (!(opts && opts.quiet)) reg._dirty(d);
      return now;
    },
    available(id) {
      const d = defs.get(id);
      if (!d) return '알 수 없는 설정이에요.';
      if (typeof d.available !== 'function') return true;
      try { const r = d.available(d); return r === true || r === undefined || r === null ? true : (typeof r === 'string' && r ? r : r === false ? '이 기기에서는 쓸 수 없어요.' : true); }
      catch (e) { return '지금은 쓸 수 없어요.'; }
    },
    list(filter) {
      let all = [...defs.values()];
      if (typeof filter === 'function') all = all.filter(filter);
      else if (filter && typeof filter === 'object') {
        all = all.filter((d) => (!filter.tab || d.tab === filter.tab) && (!filter.group || d.group === filter.group) && (!filter.scope || d.scope === filter.scope) && (!filter.type || d.type === filter.type));
      }
      return all.sort((a, b) => TABS.findIndex((t) => t.id === a.tab) - TABS.findIndex((t) => t.id === b.tab) || a.order - b.order || a._seq - b._seq);
    },
    search(q) {
      const norm = (s) => String(s || '').toLowerCase().replace(/[\s·\-_()]+/g, '');
      const n = norm(q);
      if (!n) return [];
      const tabLabel = (id) => (TABS.find((t) => t.id === id) || {}).label || '';
      const hits = [];
      for (const d of reg.list()) {
        const hay = [d.label, d.hint, d.group, tabLabel(d.tab), d.words || '', d.id, d.options ? d.options.map((o) => o.l).join(' ') : ''].map(norm);
        const score = hay[0].includes(n) ? 3 : hay[1].includes(n) || hay[2].includes(n) ? 2 : hay.some((x) => x.includes(n)) ? 1 : 0;
        if (score) hits.push([score, d]);
      }
      return hits.sort((a, b) => b[0] - a[0]).map((x) => x[1]);
    },
    tabs() { return TABS.slice(); },
    reset(scope) {
      scope = scope || 'all';
      const pick = scope === 'all' ? () => true
        : scope === 'account' || scope === 'device' ? (d) => d.scope === scope
        : TAB_IDS.has(scope) ? (d) => d.tab === scope : (d) => d.id === scope;
      const ids = [];
      for (const d of reg.list(pick)) {
        if (d.type === 'action' || d.type === 'info' || d.noReset) continue;
        if (d.key === 'easyMode' || d.key === 'kidChat' || d.key === 'parentGate') continue; // child safety goes through its own switches
        reg.set(d.id, d.default, { force: true });
        ids.push(d.id);
      }
      try { G.bus.emit('settings:reset', { scope, ids }); } catch (e) { /* bus optional */ }
      return ids;
    },
    /** apply every option once (init, after a login, after a sync) */
    applyAll() { for (const d of defs.values()) if (d.type !== 'action' && d.type !== 'info') callApply(d, reg.get(d.id)); },
    /** values of one scope as { id: value } (for the account store) */
    snapshot(scope) {
      const out = {};
      for (const d of defs.values()) {
        if (d.type === 'action' || d.type === 'info' || (scope && d.scope !== scope)) continue;
        const v = reg.get(d.id);
        if (v !== undefined && (typeof v !== 'object' || Array.isArray(v))) out[d.id] = v;
      }
      return out;
    },
    /** take values from elsewhere (the account store): only known ids, each fitted to its def; no upload back */
    absorb(values, scope) {
      if (!values || typeof values !== 'object' || Array.isArray(values)) return 0;
      let n = 0;
      for (const [id, v] of Object.entries(values)) {
        const d = defs.get(id);
        if (!d || d.type === 'action' || d.type === 'info' || (scope && d.scope !== scope)) continue;
        if (d.key === 'easyMode' || d.key === 'kidChat' || d.key === 'parentGate') continue;
        const before = reg.get(id);
        const now = reg.set(id, v, { quiet: true, force: true });
        if (now !== before) n++;
      }
      return n;
    },
    drain() {
      const q = G.settingsQueue;
      if (!Array.isArray(q)) return 0;
      let n = 0;
      while (q.length) { const d = q.shift(); if (reg.define(d)) n++; }
      return n;
    },
    _dirty() { /* replaced by the account store below */ },
    _selfWrite: null,

    init() {
      reg.drain();
      // other fragments change keys directly (G.setSetting, the old panes): the option's apply follows them
      G.bus.on('settings:changed', ({ key } = {}) => {
        if (reg._selfWrite === key) return;
        const id = byKey.get(key);
        if (!id) return;
        const d = defs.get(id);
        callApply(d, reg.get(id));
        if (initDone) reg._dirty(d);
      });
    },
    postInit() {
      reg.drain();
      initDone = true;
      reg.applyAll();
    },
  };
  G.register(reg);
  // the queue: drain what earlier fragments pushed, and define at once from now on
  {
    const q = Array.isArray(G.settingsQueue) ? G.settingsQueue : [];
    G.settingsQueue = q;
    reg.drain();
    Object.defineProperty(q, 'push', { configurable: true, value: (...items) => { for (const it of items) reg.define(it); return 0; } });
  }
})();
