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
      uiScale: N(0.75, 1.4, 0.01, 1), uiStep: N(1, 4, 1, 2), textScale: N(1, 5, 1, 2), avatarScale: N(80, 130, 5, 100),
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

// ------------------------------------------------------------------ the options of this lane, the window, 도움말, the account store
(function () {
  if (typeof document === 'undefined' || !G.sys.settings || !G.ui || typeof window.addEventListener !== 'function') return;
  const S = G.sys.settings;
  const h = (...a) => G.ui.h(...a);
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const easyOn = () => (G.easy ? !!G.easy.on : G.settings?.easyMode !== false);
  const say = (t, o) => { try { G.easy?.say?.(t, Object.assign({ force: true, priority: 1 }, o || {})); } catch (e) { /* voice optional */ } };
  const root = () => document.documentElement;
  const body = () => document.body;

  // ================================================================ options of this lane
  // ---- 소리 (61-audio channels; 100 = the balanced level the 체험관 always had)
  const MIX = [
    ['mixMaster', '전체 소리', '체험관의 모든 소리를 한꺼번에 줄이고 키워요.', 'master', '🔊'],
    ['mixMusic', '배경음악', '가야금·거문고·대금이 연주하는 잔잔한 국악이에요.', 'music', '🎵'],
    ['mixSfx', '효과음', '물 주기·수확·장독 뚜껑·발소리 같은 체험의 소리예요.', 'sfx', '🔔'],
    ['mixUi', 'UI 효과음', '단추를 누르거나 창을 열고 닫을 때 나는 짧은 소리예요.', 'ui', '👆'],
    ['mixVoice', '캐릭터 음성', '안내를 읽어 주는 목소리와 사람들의 말소리예요.', 'voice', '🗣️'],
    ['mixNature', '자연 소리', '새·풀벌레·개울물·바람·빗소리예요.', 'nature', '🍃'],
  ];
  MIX.forEach(([id, label, hint, ch, e], i) => S.define({
    id, tab: 'sound', group: '소리 크기', type: 'slider', label: `${e} ${label}`, hint: `${hint} 100이 처음 맞춰 둔 알맞은 크기예요.`, min: 0, max: 100, step: 5, default: 100,
    unit: '', order: 10 + i, test: ch, words: `볼륨 소리 크기 ${label}`, kid: true,
  }));
  S.define([
    { id: 'muted', tab: 'sound', group: '켜고 끄기', type: 'toggle', label: '🔇 음소거', hint: '모든 소리를 한 번에 꺼요. 다시 켜면 위의 크기 그대로 돌아와요.', order: 30, words: '소리 끄기 무음' },
    { id: 'musicGugak', tab: 'sound', group: '켜고 끄기', type: 'toggle', label: '🎶 전통 음악', hint: '가야금·거문고·대금·해금·장구가 그때그때 새로 지어 연주하는 국악을 켜고 꺼요.', order: 31, default: true, words: '국악 음악 배경음악' },
    { id: 'natureSounds', tab: 'sound', group: '켜고 끄기', type: 'toggle', label: '🌿 자연의 소리', hint: '계절과 시간에 맞춰 들리는 새·풀벌레·개울 소리를 켜고 꺼요.', order: 32, default: true, words: '환경음 새소리' },
    { id: 'muteHidden', tab: 'sound', group: '켜고 끄기', type: 'toggle', label: '🙈 창이 가려지면 소리 끄기', hint: '다른 탭이나 창을 보고 있을 때는 소리를 멈춰요. 끄면 뒤에서도 계속 들려요.', order: 33, default: true, words: '백그라운드 탭' },
    { id: 'volumeMaster', tab: 'sound', group: '기본 크기 (세밀하게)', type: 'slider', label: '🔈 전체 볼륨 기본값', hint: '쉬운 모드의 소리 막대가 바꾸는 값이에요. 위의 0~100은 이 값에 곱해져요.', min: 0, max: 1, step: 0.05, default: 0.8, unit: '%', order: 50 },
    { id: 'volumeMusic', tab: 'sound', group: '기본 크기 (세밀하게)', type: 'slider', label: '🎵 배경음악 기본값', hint: '운영자가 정한 음악 크기를 이 기기에서 바꿀 때 써요.', min: 0, max: 1, step: 0.05, default: 0.45, unit: '%', order: 51 },
    { id: 'volumeSfx', tab: 'sound', group: '기본 크기 (세밀하게)', type: 'slider', label: '🔔 효과음 기본값', hint: '효과음과 UI 효과음이 함께 쓰는 기본 크기예요.', min: 0, max: 1, step: 0.05, default: 0.8, unit: '%', order: 52 },
    { id: 'volumeAmbient', tab: 'sound', group: '기본 크기 (세밀하게)', type: 'slider', label: '🍃 환경음 기본값', hint: '바람·새·풀벌레·계곡 물소리의 기본 크기예요.', min: 0, max: 1, step: 0.05, default: 0.6, unit: '%', order: 53 },
    { id: 'volumeVoice', tab: 'sound', group: '기본 크기 (세밀하게)', type: 'slider', label: '🗣️ 목소리 기본값', hint: '안내 음성과 대화를 읽어 주는 목소리의 기본 크기예요.', min: 0, max: 1, step: 0.05, default: 0.9, unit: '%', order: 54 },
    { id: 'soundNow', tab: 'sound', group: '기본 크기 (세밀하게)', type: 'info', label: '🎼 지금 들리는 음악', order: 60, render: (el) => {
      const info = G.sys.audio?.moodInfo;
      el.textContent = info ? `${info.label} · ${info.mode} · ${info.jangdan}${info.quote ? ` · ${info.quote} 가락` : ''}` : '화면을 한 번 누르거나 키를 누른 뒤부터 소리가 나요. (브라우저가 그렇게 정해 두었어요.)';
    } },
  ]);

  // ---- 화면 구성
  const UI_K = [0.9, 1, 1.12, 1.25];
  const nearest = (arr, x) => { let b = 0, bd = Infinity; arr.forEach((k, i) => { const d = Math.abs(k - Number(x)); if (d < bd) { bd = d; b = i; } }); return b; };
  const TEXT_K = [0.9, 1, 1.1, 1.22, 1.36];
  S.define([
    { id: 'uiStep', key: 'uiScale', tab: 'layout', group: '크기', type: 'steps', label: '🔲 UI 크기', hint: '창·단추·글자가 함께 커지고 작아져요. 2단계가 처음 크기예요.', default: 2, order: 10, kid: true,
      options: [{ v: 1, l: '1단계', e: '▫️' }, { v: 2, l: '2단계', e: '◻️' }, { v: 3, l: '3단계', e: '⬜' }, { v: 4, l: '4단계', e: '🔳' }],
      map: { to: (v) => UI_K[clamp(v, 1, 4) - 1], from: (s) => nearest(UI_K, s == null ? 1 : s) + 1 }, words: '화면 크기 인터페이스 확대' },
    { id: 'textScale', tab: 'layout', group: '크기', type: 'steps', label: '🔠 글자 크기', hint: '창 안의 글, 대화, 채팅, 알림 글자만 키워요. 2가 처음 크기예요.', default: 2, order: 11, kid: true,
      options: [{ v: 1, l: '작게', e: '🔡' }, { v: 2, l: '보통', e: '🔤' }, { v: 3, l: '조금 크게', e: '🅰️' }, { v: 4, l: '크게', e: '🔠' }, { v: 5, l: '아주 크게', e: '🔍' }],
      apply: (v) => { root().style.setProperty('--text-k', String(TEXT_K[clamp(Number(v) || 2, 1, 5) - 1])); body()?.classList.toggle('text-scaled', Number(v) !== 2); }, words: '글씨 폰트 큰 글자' },
    { id: 'avatarScale', tab: 'layout', group: '크기', type: 'slider', label: '🧍 캐릭터 크기', hint: '내 캐릭터가 보이는 크기예요(80~130%). 카메라도 따라가요. 지나갈 수 있는 길은 그대로예요.', min: 80, max: 130, step: 5, default: 100, unit: '%', order: 12,
      apply: (v) => { try { G.sys.player?.rig?.setDrawScale?.(clamp(Number(v) || 100, 80, 130) / 100); } catch (e) { /* player optional */ } }, words: '아바타 키 몸 크기' },
    { id: 'nameplates', tab: 'layout', group: '보이는 것', type: 'select', label: '🏷️ 이름표', hint: '머리 위 이름표를 고르게 보여요. 안내하는 사람(마을 사람)의 이름은 늘 보여요.', default: 'all', order: 20,
      options: [{ v: 'all', l: '모두 보기', e: '👥' }, { v: 'others', l: '내 이름 숨기기', e: '🙈' }, { v: 'off', l: '사람 이름 숨기기', e: '🚫' }],
      apply: (v) => { const b = body(); if (!b) return; b.classList.toggle('np-others', v === 'others'); b.classList.toggle('np-off', v === 'off'); }, words: '닉네임 이름' },
    { id: 'minimapSize', tab: 'layout', group: '보이는 것', type: 'steps', label: '🗺️ 미니맵 크기', hint: '오른쪽 위 작은 지도의 크기예요. M 키로 큰 지도를 열어요.', default: 2, order: 21,
      options: [{ v: 1, l: '작게', e: '▪️' }, { v: 2, l: '보통', e: '◼️' }, { v: 3, l: '크게', e: '⬛' }],
      apply: (v) => { root().style.setProperty('--mm-k', String([0.8, 1, 1.25][clamp(Number(v) || 2, 1, 3) - 1])); body()?.classList.toggle('mm-sized', Number(v) !== 2); }, words: '지도' },
    { id: 'chatOpacity', tab: 'layout', group: '투명도', type: 'slider', label: '💬 채팅 창 진하기', hint: '채팅 창이 뒤의 3D 화면을 얼마나 가리는지예요. 마우스를 올리면 잠시 진해져요.', min: 30, max: 100, step: 5, default: 100, unit: '%', order: 30,
      apply: (v) => { root().style.setProperty('--chat-a', String(clamp(Number(v) || 100, 30, 100) / 100)); body()?.classList.toggle('chat-faded', Number(v) < 100); }, words: '투명 불투명 채팅' },
    { id: 'hudOpacity', tab: 'layout', group: '투명도', type: 'slider', label: '🪟 화면 창 진하기 (HUD)', hint: '할 일·미니맵·단추 막대 같은 화면 위 창의 진하기예요. 마우스를 올리면 잠시 진해져요.', min: 40, max: 100, step: 5, default: 100, unit: '%', order: 31,
      apply: (v) => { root().style.setProperty('--hud-a', String(clamp(Number(v) || 100, 40, 100) / 100)); body()?.classList.toggle('hud-faded', Number(v) < 100); }, words: '투명 HUD 인터페이스' },
    { id: 'highContrast', tab: 'layout', group: '보기 쉽게', type: 'toggle', label: '🌓 고대비', hint: '창 배경을 더 어둡고 글자를 더 선명하게 해요.', order: 40, words: '대비 선명 색' },
  ]);
  // ---- 그래픽 퀄리티 (the engine preset `quality`; the older pane's 그래픽 품질 row is drawn here under the owner's name)
  S.define([
    { id: 'quality', tab: 'graphics', group: '품질', type: 'select', label: '🖼️ 그래픽 퀄리티', hint: '3D 그림 전체의 곱기예요. 자동은 이 기기의 힘에 맞춰 높음·보통·낮음 가운데 골라요. 낮음은 가장 가볍고 빨라요.', default: 'auto', scope: 'device', order: 10,
      options: [{ v: 'auto', l: '자동', e: '🪄', hint: '기기에 맞춰 골라요' }, { v: 'high', l: '높음', e: '🌟' }, { v: 'medium', l: '보통', e: '⭐' }, { v: 'low', l: '낮음', e: '▫️' }],
      available: () => (G.flags?.quality ? '주소에 품질이 정해져 있어서(quality=…) 여기서는 바꿀 수 없어요.' : true), words: '그래픽 품질 퀄리티 화질 프리셋 quality 자동' },
    { id: 'qualityNow', tab: 'graphics', group: '품질', type: 'info', label: '🔎 지금 쓰는 단계', order: 11, render: (el) => {
      const E = G.sys.engine;
      el.textContent = `${E?.preset?.label || E?.quality || '-'}${G.settings?.quality === 'auto' ? ' (자동으로 골랐어요)' : ''} · 나무·풀의 수는 새로고침한 뒤에 바뀌어요.`;
    } },
  ]);
  // ---- 조작: the touch layout (device) and, until lane gfx's key table exists, the fixed keys
  S.define([
    { id: 'stickSide', tab: 'controls', group: '터치 화면', type: 'select', label: '🕹️ 이동 동그라미 위치', hint: '휴대폰·태블릿에서 걷는 동그라미를 어느 손으로 쓸지 골라요. 점프 단추는 반대쪽에 있어요.', default: 'left', scope: 'device', order: 400,
      options: [{ v: 'left', l: '왼쪽', e: '👈' }, { v: 'right', l: '오른쪽', e: '👉' }],
      apply: (v) => body()?.classList.toggle('stick-right', v === 'right'), words: '조이스틱 터치 왼손 오른손' },
    { id: 'touchButtons', tab: 'controls', group: '터치 화면', type: 'steps', label: '🔘 터치 단추 크기', hint: '점프·달리기·살펴보기 단추의 크기예요.', default: 2, scope: 'device', order: 401,
      options: [{ v: 1, l: '작게', e: '▫️' }, { v: 2, l: '보통', e: '◻️' }, { v: 3, l: '크게', e: '⬜' }],
      apply: (v) => { root().style.setProperty('--tb-k', String([0.85, 1, 1.22][clamp(Number(v) || 2, 1, 3) - 1])); body()?.classList.toggle('tb-sized', Number(v) !== 2); }, words: '버튼 터치' },
  ]);
  // ---- 도움말 (the tab's body is drawn by the window; the rows are searchable)
  S.define({ id: 'helpAbout', tab: 'help', group: '기능 설명', type: 'info', label: '❓ 기능 설명', order: 1, words: '도움 설명 사용법 안내', render: () => {} });

  // ================================================================ the fixed keys (until G.input.bindings is there)
  const FIXED_KEYS = [
    ['W A S D · ↑ ↓ ← →', '걷기'], ['Shift', '달리기 (누른 채 걷기)'], ['Space', '점프 · 앞의 낮은 것 넘어가기'], ['E', '말 걸기 · 살펴보기 · 들어가기'],
    ['Ctrl', '마우스 풀기 ↔ 캐릭터에 고정'], ['+ / −', '화면 도는 빠르기'], ['0', '도는 빠르기 처음으로'], ['휠 · Z / X', '가까이 · 멀리 보기'],
    ['Esc', '메뉴 · 창 닫기'], ['M', '지도'], ['I', '가방'], ['Q', '할 일'], ['C', '도감 · 업적'], ['J', '작업일지'], ['Enter', '채팅'], ['P', '사진'], ['H', '도움말'], ['F', '전체 화면'],
  ];
  const B = () => G.input?.bindings || null;
  /** the keys of an action as text: 'W · ↑' (bindings) or the fallback */
  function keysOf(action, fallback) {
    const b = B();
    try { if (b && typeof b.label === 'function') { const l = b.label(action); if (l) return l; } } catch (e) { /* bindings optional */ }
    return fallback || '';
  }

  // ================================================================ 도움말: 기능 설명 of the whole platform
  // k: binding ids (their current keys are read when drawn) or fixed text; t: a few calm sentences; kid: the line read aloud
  const HELP = [
    { id: 'move', e: '🚶', t: '걷기와 달리기', k: [['forward', 'W'], ['left', 'A'], ['back', 'S'], ['right', 'D'], ['run', 'Shift']], g: '움직이기',
      d: '화살표나 W·A·S·D로 걸어요. Shift를 누른 채 걸으면 달려요. 땅을 누르면 그곳까지 혼자 걸어가요(클릭해서 이동). 휴대폰에서는 왼쪽 아래 동그라미를 손가락으로 밀어요.',
      kid: '화살표를 누르면 걸어요. 휴대폰은 동그라미를 손가락으로 밀어요.' },
    { id: 'look', e: '👀', t: '둘러보기와 확대', k: [['lookFaster', '+'], ['lookSlower', '−'], ['zoomIn', 'Z'], ['zoomOut', 'X']], g: '움직이기',
      d: '마우스를 움직이면 화면이 캐릭터를 따라 돌아요. + 와 − 키로 도는 빠르기를 바꾸고, 0을 누르면 처음 빠르기로 돌아가요. 마우스 휠이나 Z·X로 가까이·멀리 봐요. 휴대폰에서는 화면을 손가락으로 끌어서 돌려요.',
      kid: '마우스를 움직이면 화면이 돌아가요. 휠을 굴리면 가까이 보여요.' },
    { id: 'ctrl', e: '🖱️', t: 'Ctrl로 마우스 풀기·고정', k: [['mouseToggle', 'Ctrl']], g: '움직이기', ctrl: true,
      d: '처음에는 화면이 캐릭터에 고정되어 있어서 마우스를 움직이면 시점이 돌아요. Ctrl 키를 한 번 톡 누르면 마우스가 풀려서 단추를 누를 수 있어요. 한 번 더 누르면 다시 캐릭터를 따라 돌아요. 화면 아래 작은 표시(🖱️ 고정 / 🖱️ 자유)가 지금 상태를 알려 줘요.',
      kid: '컨트롤 키를 누르면 마우스가 풀려요. 한 번 더 누르면 다시 캐릭터를 따라 돌아요.' },
    { id: 'jump', e: '🦘', t: '점프와 넘어가기', k: [['jump', 'Space']], g: '움직이기',
      d: 'Space를 누르면 뛰어올라요. 낮은 담·돌·장독 앞에서 뛰면 훌쩍 넘어가요. 휴대폰에서는 오른쪽 아래 점프 단추를 눌러요.',
      kid: '스페이스를 누르면 폴짝 뛰어요. 낮은 담도 넘어가요.' },
    { id: 'interact', e: '👆', t: '말 걸기 · 살펴보기', k: [['interact', 'E']], g: '움직이기',
      d: '사람이나 물건 가까이 가면 화면에 알림이 떠요. 그때 E를 누르거나 알림을 누르면 말을 걸고, 살펴보고, 문 안으로 들어가요.',
      kid: '가까이 가서 손가락 단추를 누르면 이야기해요.' },
    { id: 'go', e: '🧭', t: '가기 (가고 싶은 곳으로)', k: [['map', 'M']], g: '움직이기',
      d: '‘어디 갈까?’ 단추나 지도(M)에서 가고 싶은 곳을 고르면 그곳까지 데려다줘요. 걸어갈 때는 발자국이 길을 보여 줘요.',
      kid: '어디 갈까 단추를 누르고 가고 싶은 곳을 골라요.' },
    { id: 'next', e: '⭐', t: '다음 할 일 카드', k: [['quest', 'Q']], g: '체험',
      d: '화면 위 ‘다음 할 일’ 카드는 지금 해 볼 일을 하나씩 알려 줘요. 카드를 누르면 그 일이 있는 곳으로 길을 안내해요. Q 키로 할 일 목록 전체를 볼 수 있어요.',
      kid: '위에 있는 다음 할 일 카드를 따라가요.' },
    { id: 'farm', e: '🌱', t: '밭과 실시간 재배', k: [], g: '체험',
      d: '밭에 씨앗을 심고 물을 주면 작물이 자라요. 실시간 밭은 한국의 진짜 날짜·계절·날씨에 맞춰 며칠에 걸쳐 자라요. 다 자라면 거두어 가방이나 곳간에 넣어요.',
      kid: '씨앗을 심고 물을 주면 자라요. 다 자라면 거두어요.' },
    { id: 'jars', e: '🏺', t: '장독과 발효 · 레시피', k: [], g: '체험',
      d: '장독에 재료를 넣고 뚜껑을 닫으면 시간이 지나며 장과 김치가 익어요. 레시피 책에서 만드는 법과 걸리는 시간을 볼 수 있어요. 가끔 뚜껑을 열어 햇볕과 바람을 쐬어 주면 더 잘 익어요.',
      kid: '장독에 재료를 넣으면 맛있게 익어요.' },
    { id: 'gotgan', e: '🏚️', t: '곳간', k: [['bag', 'I']], g: '체험',
      d: '곳간은 거둔 작물과 다 익은 장을 오래 보관하는 창고예요. 가방이 가득 차면 곳간에 옮겨 두세요. I 키로 가방을 열어요.',
      kid: '곳간에 모은 것을 넣어 둬요.' },
    { id: 'rooms', e: '🏠', t: '방과 강의실', k: [['interact', 'E']], g: '장소',
      d: '한옥 문 앞에서 E를 누르면 안으로 들어가요. 대청과 대강의실은 강의실이에요. 화면 앞에서 동영상과 슬라이드 강의를 듣고, 부엌·발효실·곳간·가게도 둘러봐요.',
      kid: '문 앞에서 단추를 누르면 집 안으로 들어가요.' },
    { id: 'myroom', e: '🛋️', t: '내 방 꾸미기', k: [['roomEdit', 'B']], g: '장소',
      d: '내 방에서는 가구와 소품을 골라 마음대로 놓을 수 있어요. B 키(꾸미기)를 누르고 물건을 고른 뒤 놓을 자리를 눌러요. 친구가 놀러 올 수도 있어요.',
      kid: '내 방에 좋아하는 물건을 놓아요.' },
    { id: 'complex', e: '🏯', t: '만장대 단지와 분양', k: [], g: '장소',
      d: '만장대 단지에는 장독대 1만 개와 본관·한옥 마을·카페가 있어요. 분양을 받은 사람은 자기 장독대를 찾아가 돌보고 방을 가꿀 수 있어요. 분양 신청은 어른이 해요.',
      kid: '만장대 단지에는 장독이 아주 많아요.' },
    { id: 'fishing', e: '🎣', t: '낚시', k: [['interact', 'E']], g: '체험',
      d: '강가의 🎣 표지판 앞에서 낚시를 해요. 견지낚시·대낚시·족대·어항으로 강원도 맑은 물(1급수)에 사는 물고기를 만나요. 보호받는 물고기는 도감에 기록하고 바로 놓아줘요.',
      kid: '강가에서 물고기를 낚아요. 귀한 물고기는 놓아줘요.' },
    { id: 'cooking', e: '🍲', t: '요리와 부엌', k: [], g: '체험',
      d: '부엌과 강가 화덕에서 잡은 물고기, 밭의 작물, 장독의 장으로 요리해요. 씻고, 다듬고, 불을 지피고, 기다리며 한 단계씩 만들어요. 민물고기는 꼭 푹 익혀 먹어요. 불 옆에서는 조심해요.',
      kid: '부엌에서 한 단계씩 요리해요. 불은 조심해요.' },
    { id: 'photo', e: '📸', t: '사진', k: [['photo', 'P']], g: '기록',
      d: 'P 키나 아래 막대의 📸 사진으로 사진 찍기 모드를 열어요. 각도와 거리를 바꿔 찍으면 앨범에 남아요. 스크린샷 형식은 설정 → 그래픽에서 골라요.',
      kid: '사진 단추를 누르면 사진을 찍어요.' },
    { id: 'journal', e: '📝', t: '작업일지 (일기)', k: [['journal', 'J']], g: '기록',
      d: '작업일지에는 오늘 심고 거두고 담근 일이 저절로 적혀요. 사진과 짧은 글을 더해 나만의 일기를 만들 수 있어요.',
      kid: '일기에 오늘 한 일이 그림으로 남아요.' },
    { id: 'chat', e: '💬', t: '채팅과 안전', k: [['chat', 'Enter']], g: '함께하기',
      d: 'Enter로 채팅을 열어요. 쉬운 모드에서는 정해진 인사말과 이모지로만 이야기해요. 나쁜 말과 전화번호 같은 개인 정보는 저절로 가려져요. 불편한 말을 보면 채팅 창의 ‘신고하기’를 눌러요.',
      kid: '친구에게 인사말과 이모지를 보내요. 나쁜 말은 가려져요.' },
    { id: 'support', e: '📮', t: '문의 · 신고', k: [], g: '함께하기',
      d: '메뉴의 📮 문의·신고나 채팅 창의 ‘문의하기’·‘신고하기’로 고장(버그)을 알리거나 궁금한 점을 물어요. 지금 화면 사진이 함께 가서 운영자가 빨리 알아볼 수 있어요. 답이 오면 화면에 알림이 떠요.',
      kid: '이상한 것을 보면 어른과 함께 알려요.' },
    { id: 'plans', e: '⚡', t: '이용 방법(요금제)과 달라지는 것', k: [], g: '함께하기',
      d: '결제한 계정은 걷는 빠르기와 작물이 자라는 빠르기가 2배·3배가 되고, 장독을 12개까지 돌볼 수 있어요. 결제와 해지는 어른만 할 수 있고, 메뉴의 ‘진행 속도 구독’에서 확인해요.',
      kid: '어른이 정하는 거예요.' },
    { id: 'settings', e: '⚙️', t: '설정', k: [['settings', '']], g: '함께하기',
      d: '아래 막대의 ⚙️ 설정에서 그래픽·화면·소리·키·글자 크기를 바꿔요. 위의 찾기 칸에 ‘소리’, ‘글자’처럼 적으면 바로 찾아 줘요. 한 번 바꾼 값은 다음에 들어와도 그대로이고, 계정으로 들어오면 다른 기기에서도 같아요.',
      kid: '설정에서 소리와 글자 크기를 바꿔요.' },
    { id: 'easy', e: '👶', t: '쉬운 모드와 보호자 확인', k: [], g: '함께하기',
      d: '쉬운 모드는 그림과 큰 단추, 읽어 주기로 어린이도 혼자 놀 수 있게 해요. 설정·로그아웃처럼 어른이 할 일은 보호자 확인(곱셈 문제) 뒤에만 열려요.',
      kid: '그림 단추를 누르면 읽어 줘요.' },
  ];
  /** the help topics with their current keys (for the window, the search and tests) */
  function helpTopics() {
    return HELP.map((x) => ({ id: x.id, emoji: x.e, title: x.t, group: x.g, text: x.d, kid: x.kid, keys: x.k.map(([a, f]) => keysOf(a, f)).filter(Boolean) }));
  }

  // ================================================================ the window
  const W = { panes: null, legacyTabs: null, keys: null, hidden: {}, helpers: {}, m: null, refresh: new Map() };
  /** 70-app.js hands over its panes (they keep their builders, ids and labels) */
  S.adoptPanes = function (o) {
    if (!o || typeof o !== 'object') return;
    W.panes = o.panes || null; W.legacyTabs = o.tabs || null; W.keys = o.keys || null; W.helpers = o.helpers || {};
  };
  /** hide rows of an adopted pane whose control carries one of these aria-labels (the option moved into the registry) */
  S.hideLegacy = function (tab, labels) { (W.hidden[tab] = W.hidden[tab] || new Set()); for (const l of [].concat(labels || [])) W.hidden[tab].add(String(l)); };
  // rows of the old panes that the registry draws now (same keys, same behaviour)
  S.hideLegacy('access', ['UI 크기', '고대비']);
  S.hideLegacy('controls', ['__kbd_note__']);
  S.hideLegacy('graphics', ['그래픽 품질']); // drawn by the registry as 그래픽 퀄리티 (the same key)
  const LEGACY_OFF = new Set(['sound']); // the old 소리 pane is drawn by the registry rows above (same keys)

  const fmtVal = (d, v) => {
    if (typeof d.fmt === 'function') { try { return String(d.fmt(v)); } catch (e) { /* fall through */ } }
    if (d.unit === '%' && d.max <= 1) return `${Math.round(v * 100)}%`;
    if (d.unit) return `${Math.round(v * 100) / 100}${d.unit}`;
    return String(Math.round(v * 100) / 100);
  };
  function control(d, why) {
    const dis = why !== true;
    const v = S.get(d.id);
    switch (d.type) {
      case 'toggle': {
        const input = h('input', { type: 'checkbox', role: 'switch', 'aria-label': d.label.replace(/^[^\p{L}\p{N}]+/u, '') || d.label, disabled: dis || null });
        input.checked = !!v;
        input.addEventListener('change', () => { S.set(d.id, input.checked); G.sfx('click'); });
        W.refresh.set(d.id, () => { input.checked = !!S.get(d.id); });
        return h('label', { class: 'app-switch' }, input, h('span', { class: 'sw-track', 'aria-hidden': 'true' }, h('span', { class: 'sw-thumb' })));
      }
      case 'slider': {
        const out = h('output', { class: 'set-val' }, fmtVal(d, v));
        const input = h('input', { type: 'range', min: d.min, max: d.max, step: d.step, 'aria-label': d.label.replace(/^[^\p{L}\p{N}]+/u, '') || d.label, disabled: dis || null });
        input.value = String(v);
        const paint = () => { const k = (Number(input.value) - d.min) / (d.max - d.min || 1); input.style.setProperty('--fill', `${(k * 100).toFixed(1)}%`); out.textContent = fmtVal(d, Number(input.value)); input.setAttribute('aria-valuetext', out.textContent); };
        paint();
        const live = d.live !== false;
        input.addEventListener('input', () => { paint(); if (live) S.set(d.id, Number(input.value)); });
        input.addEventListener('change', () => { S.set(d.id, Number(input.value)); paint(); });
        W.refresh.set(d.id, () => { input.value = String(S.get(d.id)); paint(); });
        const wrap = h('div', { class: 'set-slider' }, input, out);
        if (d.test) {
          const tb = h('button', { type: 'button', class: 'btn btn-sm btn-soft sw-test', 'aria-label': `${d.label.replace(/^[^\p{L}\p{N}]+/u, '')} 들어보기`, title: '들어보기' }, h('span', { class: 'emoji', 'aria-hidden': 'true' }, '🔉'));
          tb.addEventListener('click', () => { try { G.sys.audio?.testChannel?.(d.test); } catch (e) { /* audio optional */ } });
          wrap.appendChild(tb);
        }
        return wrap;
      }
      case 'select': case 'steps': {
        if (d.type === 'select' && d.options.length > 6) {
          const sel = h('select', { class: 'sw-select', 'aria-label': d.label.replace(/^[^\p{L}\p{N}]+/u, ''), disabled: dis || null }, d.options.map((o) => h('option', { value: String(o.v) }, (o.e ? o.e + ' ' : '') + o.l)));
          sel.value = String(v);
          sel.addEventListener('change', () => { const o = d.options.find((x) => String(x.v) === sel.value); S.set(d.id, o ? o.v : sel.value); G.sfx('click'); });
          W.refresh.set(d.id, () => { sel.value = String(S.get(d.id)); });
          return sel;
        }
        const seg = h('div', { class: `seg sw-seg${d.type === 'steps' ? ' sw-steps' : ''}`, role: 'radiogroup', 'aria-label': d.label.replace(/^[^\p{L}\p{N}]+/u, '') });
        const btns = d.options.map((o, i) => {
          const on = String(o.v) === String(v);
          const b = h('button', { type: 'button', role: 'radio', 'aria-checked': String(on), class: on ? 'active' : '', tabindex: on ? '0' : '-1', disabled: dis || null, title: o.hint || null, 'data-v': String(o.v) },
            o.e ? h('span', { class: 'emoji', 'aria-hidden': 'true' }, o.e) : null, o.l);
          b.addEventListener('click', () => { S.set(d.id, o.v); G.sfx('click'); paint(); });
          b.addEventListener('keydown', (e) => {
            const dd = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
            if (!dd) return;
            e.preventDefault();
            const j = (i + dd + d.options.length) % d.options.length;
            S.set(d.id, d.options[j].v); paint(); btns[j].focus();
          });
          return b;
        });
        const paint = () => { const cur = String(S.get(d.id)); for (const b of btns) { const on = b.dataset.v === cur; b.classList.toggle('active', on); b.setAttribute('aria-checked', String(on)); b.tabIndex = on ? 0 : -1; } };
        seg.append(...btns);
        W.refresh.set(d.id, paint);
        return seg;
      }
      case 'action': {
        const b = h('button', { type: 'button', class: `btn btn-sm ${d.danger ? 'btn-danger' : 'btn-soft'}`, disabled: dis || null }, d.button || d.label);
        b.addEventListener('click', () => S.set(d.id));
        return b;
      }
      case 'key': return keyControl(d);
      case 'info': {
        const el = h('div', { class: 'sw-info' });
        try { d.render?.(el, d); } catch (e) { el.textContent = ''; }
        return el;
      }
      default: return h('span');
    }
  }
  /** a key row: the key caps, 바꾸기 (the next key press), 처음대로 — through G.input.bindings */
  function keyControl(d) {
    const b = B();
    const caps = h('span', { class: 'sw-caps' });
    const note = h('div', { class: 'sw-keynote', role: 'status', 'aria-live': 'polite' });
    const draw = () => {
      caps.textContent = '';
      const codes = (b && d.action ? b.get(d.action) : null) || S.get(d.id) || [];
      for (const c of codes) caps.appendChild(h('kbd', null, b ? b.name(c) : c));
      if (!codes.length) caps.appendChild(h('span', { class: 'dim small' }, '없음'));
    };
    draw();
    if (!b || !d.action) return h('div', { class: 'sw-key' }, caps);
    const change = h('button', { type: 'button', class: 'btn btn-sm btn-soft sw-rebind', 'aria-label': `${d.label} 키 바꾸기` }, '바꾸기');
    const back = h('button', { type: 'button', class: 'btn btn-sm btn-ghost sw-rekey', 'aria-label': `${d.label} 키 처음대로` }, '처음대로');
    let cancel = null;
    const stop = () => { if (cancel) { cancel(); cancel = null; } change.textContent = '바꾸기'; change.classList.remove('waiting'); };
    const assign = (code, steal) => {
      const r = b.set(d.action, [code], { steal: !!steal });
      note.textContent = '';
      if (r && r.ok) { G.sfx('click'); draw(); W.drawKeys?.(); return; }
      if (r && r.reason === 'conflict') {
        const who = (r.conflicts || []).map((c) => `‘${c.label}’`).join(', ');
        note.append(h('span', null, `‘${b.name(code)}’ 키는 이미 ${who}에 쓰이고 있어요. `));
        const yes = h('button', { type: 'button', class: 'btn btn-sm btn-gold' }, '그래도 바꾸기');
        yes.addEventListener('click', () => assign(code, true));
        const no = h('button', { type: 'button', class: 'btn btn-sm btn-ghost' }, '그만두기');
        no.addEventListener('click', () => { note.textContent = ''; });
        note.append(yes, no);
        return;
      }
      note.textContent = (r && r.message) || '그 키는 쓸 수 없어요.';
    };
    change.addEventListener('click', () => {
      if (cancel) { stop(); return; }
      change.textContent = '아무 키나 누르세요… (Esc: 그만)';
      change.classList.add('waiting');
      cancel = b.capture((code) => { cancel = null; stop(); if (code) assign(code, false); });
    });
    back.addEventListener('click', () => { stop(); b.reset(d.action); note.textContent = ''; draw(); G.sfx('click'); });
    W.refresh.set(d.id, draw);
    return h('div', { class: 'sw-key' }, caps, change, back, note);
  }
  function row(d) {
    const why = S.available(d.id);
    const r = h('div', { class: `set-row sw-row sw-${d.type}${why !== true ? ' sw-off' : ''}`, 'data-opt': d.id },
      h('div', { class: 'set-label' }, h('b', null, d.label), d.hint ? h('small', { class: 'sw-hint' }, d.hint) : null,
        why !== true ? h('small', { class: 'sw-why' }, `⛔ ${why}`) : null,
        d.restart ? h('small', { class: 'sw-restart' }, '🔄 새로고침한 뒤에 바뀌어요.') : null),
      h('div', { class: 'set-ctl' }, control(d, why)));
    // a voice line for every row; no extra big 🔊 per row in this grown-up window (it doubled every row's height in easy mode)
    if (easyOn()) r.dataset.say = `${d.label.replace(/^[^\p{L}\p{N}]+/u, '')}. ${d.hint || ''}`;
    return r;
  }
  function groupsOf(defs) {
    const out = new Map();
    for (const d of defs) { const g = d.group || ''; if (!out.has(g)) out.set(g, []); out.get(g).push(d); }
    return out;
  }
  function legacyPane(tab) {
    if (!W.panes || LEGACY_OFF.has(tab) || typeof W.panes[tab] !== 'function') return null;
    let f = null;
    try { f = W.panes[tab](); } catch (e) { G.log.warn('SETTINGS', 'pane failed', tab, e); return h('p', { class: 'set-note' }, '이 칸을 표시하지 못했어요.'); }
    const hide = W.hidden[tab];
    const box = h('div', { class: 'sw-legacy', 'data-legacy': tab });
    box.appendChild(f);
    if (hide && hide.size) {
      for (const r of [...box.querySelectorAll('.set-row')]) {
        const ctl = r.querySelector('[aria-label]');
        const lab = ctl ? ctl.getAttribute('aria-label') : '';
        if (hide.has(lab) || (hide.has('__kbd_note__') && /단축키/.test(r.querySelector('.set-label b')?.textContent || '') && S.list({ type: 'key' }).length)) r.remove();
      }
    }
    return box;
  }
  const TAB_NOTES = {
    graphics: '3D 그림을 얼마나 곱고 멀리 그릴지 정해요. 기기가 느리면 낮춰 보세요.',
    display: '창 크기, 전체 화면, 모니터, 밝기를 정해요.',
    sound: '소리마다 0에서 100까지 정해요. 100이 처음 맞춰 둔 알맞은 크기예요.',
    controls: '키와 마우스, 터치 단추를 정해요. 바꾼 키는 다음에도 그대로예요.',
    layout: '글자·창·캐릭터의 크기와 화면 위 창의 진하기를 정해요.',
    help: '체험관의 모든 기능을 짧게 설명해요. 찾기 칸에 궁금한 말을 적어 보세요.',
  };
  function drawTab(pane, tab) {
    W.refresh.clear();
    pane.textContent = '';
    pane.dataset.tab = tab;
    const T = S.tabs().find((t) => t.id === tab);
    const head = h('div', { class: 'sw-head' }, h('h3', null, h('span', { class: 'emoji', 'aria-hidden': 'true' }, T?.icon || ''), ' ', T?.label || ''), TAB_NOTES[tab] ? h('p', { class: 'sw-lead' }, TAB_NOTES[tab]) : null);
    pane.appendChild(head);
    if (tab === 'help') { pane.appendChild(drawHelp()); G.ui.hydrateIcons(pane); return; }
    const defs = S.list({ tab }).filter((d) => !d.hiddenRow);
    const keyDefs = defs.filter((d) => d.type === 'key');
    const plain = defs.filter((d) => d.type !== 'key');
    const before = plain.filter((d) => d.order < 200), after = plain.filter((d) => d.order >= 200);
    const drawGroups = (list) => {
      for (const [g, ds] of groupsOf(list)) {
        const sec = h('section', { class: 'sw-group', 'data-group': g });
        if (g) sec.appendChild(h('h4', { class: 'sw-gtitle' }, g));
        for (const d of ds) sec.appendChild(row(d));
        pane.appendChild(sec);
      }
    };
    drawGroups(before);
    const legacy = legacyPane(tab);
    if (legacy) pane.appendChild(legacy);
    if (tab === 'controls') pane.appendChild(drawKeyTable(keyDefs));
    drawGroups(after);
    if (pane.children.length === 1) pane.appendChild(h('div', { class: 'empty' }, h('span', { class: 'emoji big', 'aria-hidden': 'true' }, '🛠️'), h('p', null, '여기에 놓을 설정을 준비하고 있어요.')));
    G.ui.hydrateIcons(pane);
  }
  function drawKeyTable(keyDefs) {
    const sec = h('section', { class: 'sw-group sw-keys', 'data-group': '키 설정' }, h('h4', { class: 'sw-gtitle' }, '⌨️ 키 설정'));
    if (keyDefs.length && B()) {
      sec.appendChild(h('p', { class: 'set-note' }, '‘바꾸기’를 누르고 새 키를 누르면 바뀌어요. 다른 일에 쓰는 키면 알려 줘요. 숫자 1~9, Tab, Esc처럼 정해진 키는 쓸 수 없어요.'));
      const groups = new Map();
      for (const d of keyDefs) { const a = (B().list() || []).find((x) => x.id === d.action); const g = a?.groupLabel || '키'; if (!groups.has(g)) groups.set(g, []); groups.get(g).push(d); }
      for (const [g, ds] of groups) { sec.appendChild(h('h5', { class: 'sw-ktitle' }, g)); for (const d of ds) sec.appendChild(row(d)); }
      const all = h('button', { type: 'button', class: 'btn btn-sm btn-ghost' }, '↩️ 키 모두 처음대로');
      all.addEventListener('click', () => { B().reset(); const pane = sec.closest('.set-pane'); if (pane) drawTab(pane, 'controls'); G.ui.toast('키를 모두 처음대로 돌렸어요.', { type: 'info', sound: false }); });
      sec.appendChild(h('div', { class: 'sw-keyfoot' }, all));
    } else {
      sec.appendChild(h('p', { class: 'set-note' }, '지금은 키를 바꿀 수 없어서, 정해진 키를 보여 드려요.'));
      const t = h('div', { class: 'keys-table sw-fixed' });
      for (const [k, d] of FIXED_KEYS) t.appendChild(h('div', { class: 'kt-row' }, h('span', { class: 'kt-keys' }, k.split(' · ').map((x) => h('kbd', null, x))), h('span', { class: 'kt-desc' }, d)));
      sec.appendChild(t);
    }
    return sec;
  }
  function drawHelp(filter) {
    const wrap = h('div', { class: 'sw-help' });
    const list = helpTopics().filter((x) => !filter || filter.has(x.id));
    let g = null, grid = null;
    for (const x of list) {
      if (x.group !== g) { g = x.group; wrap.appendChild(h('h4', { class: 'sw-gtitle' }, g)); grid = h('div', { class: 'sw-hgrid', role: 'list' }); wrap.appendChild(grid); }
      const card = h('article', { class: 'sw-hcard', role: 'listitem', 'data-help': x.id, 'data-say': `${x.title}. ${easyOn() ? x.kid : x.text}` },
        h('div', { class: 'sw-hpic', 'aria-hidden': 'true' }, h('span', { class: 'emoji' }, x.emoji)),
        h('div', { class: 'sw-hbody' }, h('b', null, x.title),
          x.keys.length ? h('div', { class: 'sw-hkeys' }, x.keys.map((k) => h('kbd', null, k))) : null,
          h('p', null, x.text)));
      const sp = h('button', { type: 'button', class: 'btn btn-sm btn-ghost sw-hsay', 'aria-label': `${x.title} 읽어 주기` }, h('span', { class: 'emoji', 'aria-hidden': 'true' }, '🔊'));
      sp.addEventListener('click', () => readAloud(easyOn() ? `${x.title}. ${x.kid}` : `${x.title}. ${x.text}`));
      card.querySelector('.sw-hbody').appendChild(sp);
      if (x.id === 'ctrl') {
        const again = h('button', { type: 'button', class: 'btn btn-sm btn-soft' }, '🖱️ Ctrl 안내 다시 보기');
        again.addEventListener('click', () => showCtrlCoach(true));
        card.querySelector('.sw-hbody').appendChild(again);
      }
      grid.appendChild(card);
    }
    if (!filter) {
      const foot = h('div', { class: 'sw-hfoot' });
      const tour = h('button', { type: 'button', class: 'btn btn-soft' }, '🔁 처음 안내 다시 보기');
      tour.addEventListener('click', () => { const ok = G.app?.replayTutorial?.(); if (ok !== false) { W.m?.close?.(); } });
      const full = h('button', { type: 'button', class: 'btn btn-ghost' }, '📚 조작법 · 자주 묻는 질문');
      full.addEventListener('click', () => { W.m?.close?.(); G.app?.openHelp?.('controls', { full: true }); });
      foot.append(tour, full);
      wrap.appendChild(foot);
    }
    return wrap;
  }
  function readAloud(text) {
    if (easyOn()) { say(text); return; }
    if (G.sys.audio?.speak) G.sys.audio.speak(text, { force: true });
  }
  /** the first-start card about Ctrl (lane gfx shows it once; this is the copy that 도움말 shows again) */
  function showCtrlCoach(force) {
    try { if (typeof G.input?.mouseLook?.coach === 'function') { G.input.mouseLook.coach({ force: !!force }); return; } } catch (e) { /* fall back */ }
    const text = 'Ctrl 키를 누르면 마우스가 풀려요. 한 번 더 누르면 다시 캐릭터를 따라 돌아요.';
    document.getElementById('sw-ctrl-coach')?.remove();
    const card = h('div', { id: 'sw-ctrl-coach', class: 'sw-coach', role: 'status', 'data-say': text },
      h('span', { class: 'sw-kcap', 'aria-hidden': 'true' }, 'Ctrl'), h('p', null, text));
    const ok = h('button', { type: 'button', class: 'btn btn-sm btn-primary' }, '알겠어요');
    ok.addEventListener('click', () => card.remove());
    card.appendChild(ok);
    document.body.appendChild(card);
    if (easyOn()) say(text);
    setTimeout(() => card.remove(), 12000);
  }
  S.showCtrlCoach = showCtrlCoach;
  S.helpTopics = helpTopics;

  // ---- search: the registry's rows, the rows of the adopted panes and the help topics
  function legacyIndex() {
    const out = [];
    if (!W.panes) return out;
    for (const [tab, fn] of Object.entries(W.panes)) {
      if (LEGACY_OFF.has(tab) || tab === 'account' || tab === 'data' || typeof fn !== 'function') continue;
      let box = null;
      try { box = h('div', null, fn()); } catch (e) { continue; }
      for (const r of box.querySelectorAll('.set-row')) {
        const lab = r.querySelector('.set-label b')?.textContent || '';
        const ctl = r.querySelector('[aria-label]')?.getAttribute('aria-label') || '';
        if (W.hidden[tab]?.has(ctl)) continue;
        out.push({ tab, label: lab, text: (r.textContent || '').replace(/\s+/g, ' ') });
      }
    }
    return out;
  }
  function drawSearch(pane, q) {
    W.refresh.clear();
    pane.textContent = '';
    pane.dataset.tab = 'search';
    const norm = (s) => String(s || '').toLowerCase().replace(/[\s·\-_()]+/g, '');
    const n = norm(q);
    const hits = S.search(q).filter((d) => d.type !== 'info' || d.tab !== 'help');
    const leg = (W._legIdx = W._legIdx || legacyIndex()).filter((x) => norm(x.text).includes(n));
    const help = helpTopics().filter((x) => norm(`${x.title} ${x.text} ${x.keys.join(' ')}`).includes(n));
    pane.appendChild(h('div', { class: 'sw-head' }, h('h3', null, `🔎 ‘${String(q).slice(0, 30)}’ 찾은 결과`), h('p', { class: 'sw-lead' }, `설정 ${hits.length + leg.length}개 · 도움말 ${help.length}개`)));
    if (hits.length) { const sec = h('section', { class: 'sw-group' }); for (const d of hits.slice(0, 30)) { const r = row(d); r.querySelector('.set-label').appendChild(h('small', { class: 'sw-where' }, `📂 ${S.tabs().find((t) => t.id === d.tab)?.label || ''}`)); sec.appendChild(r); } pane.appendChild(sec); }
    if (leg.length) {
      const sec = h('section', { class: 'sw-group' }, h('h4', { class: 'sw-gtitle' }, '다른 칸에 있는 설정'));
      for (const x of leg.slice(0, 20)) {
        const tl = S.tabs().find((t) => t.id === x.tab);
        const b = h('button', { type: 'button', class: 'btn btn-sm btn-soft sw-jump', 'data-tab': x.tab }, `${tl?.icon || ''} ${tl?.label || x.tab} → ${x.label}`);
        b.addEventListener('click', () => { W.clearSearch?.(); W.go?.(x.tab, x.label); });
        sec.appendChild(b);
      }
      pane.appendChild(sec);
    }
    if (help.length) pane.appendChild(drawHelp(new Set(help.map((x) => x.id))));
    if (!hits.length && !leg.length && !help.length) pane.appendChild(h('div', { class: 'empty' }, h('span', { class: 'emoji big', 'aria-hidden': 'true' }, '🤔'), h('p', null, '찾는 설정이 없어요. ‘소리’, ‘글자’, ‘전체 화면’처럼 짧게 적어 보세요.')));
    G.ui.hydrateIcons(pane);
  }

  /** the window (called by 70-app's openSettings once the gate is passed in easy mode) */
  S.openWindow = function (tab) {
    const ex = G.ui.modal.get('app-settings');
    if (ex) ex.close({ instant: true });
    const all = S.tabs();
    const tabs = easyOn() ? [all.find((t) => t.id === 'kids'), ...all.filter((t) => t.id !== 'kids')] : all;
    let current = tabs.some((t) => t.id === tab) ? tab : (easyOn() ? 'kids' : 'graphics');
    W._legIdx = null;
    const m = G.ui.modal.open({
      id: 'app-settings', title: easyOn() ? '어른 설정' : '설정', icon: 'settings', size: 'xl', className: 'app-settings-modal set-window', autofocus: false,
      body: (bodyEl, mm) => {
        mm._kind = 'full';
        // (easy mode: this window opens only behind the grown-up gate, so its search box is a grown-up's — the kid audit skips it)
        const search = h('input', { type: 'search', class: 'sw-search', 'aria-label': '설정 찾기', placeholder: '🔎 찾기 (예: 소리, 글자, 전체 화면, 키)', autocomplete: 'off', maxlength: '40', 'data-kid-exempt': easyOn() ? 'gate' : null });
        const tabsEl = h('div', { class: 'set-tabs sw-tabs', role: 'tablist', 'aria-label': '설정 분류' });
        const pane = h('div', { class: 'set-pane sw-pane', role: 'tabpanel' });
        bodyEl.append(h('div', { class: 'sw-top' }, search), h('div', { class: 'sw-main' }, tabsEl, pane));
        const render = (id, focusLabel) => {
          current = id; mm._tab = id;
          try { drawTab(pane, id); } catch (e) { G.log.warn('SETTINGS', 'tab failed', id, e); pane.textContent = '설정을 표시하지 못했어요.'; }
          pane.classList.remove('enter'); void pane.offsetWidth; pane.classList.add('enter');
          pane.scrollTop = 0; if (!focusLabel) bodyEl.scrollTop = 0; // phones: the body scrolls, the tab row stays
          for (const b of tabsEl.querySelectorAll('.tab')) b.setAttribute('aria-selected', String(b.dataset.tab === id));
          if (focusLabel) {
            const r = [...pane.querySelectorAll('.set-row')].find((x) => (x.querySelector('.set-label b')?.textContent || '') === focusLabel);
            if (r) { r.classList.add('sw-flash'); r.scrollIntoView?.({ block: 'center' }); setTimeout(() => r.classList.remove('sw-flash'), 1800); }
          }
        };
        W.go = (id, label) => { mm._tabs?.set?.(id); render(id, label); };
        W.clearSearch = () => { search.value = ''; };
        mm._renderPane = () => (search.value.trim() ? drawSearch(pane, search.value.trim()) : render(current));
        mm._tabs = G.ui.tabs(tabsEl, tabs, (id) => { search.value = ''; render(id); }, current);
        for (const b of tabsEl.querySelectorAll('.tab')) { b.setAttribute('role', 'tab'); b.setAttribute('aria-selected', String(b.dataset.tab === current)); }
        let st = 0;
        search.addEventListener('input', () => {
          clearTimeout(st);
          st = setTimeout(() => { const q = search.value.trim(); if (q) drawSearch(pane, q); else render(current); }, 140);
        });
        search.addEventListener('keydown', (e) => { if (e.key === 'Escape' && search.value) { e.stopPropagation(); e.preventDefault(); search.value = ''; render(current); } });
        render(current);
      },
      actions: [
        { label: '이 칸 기본값으로', class: 'btn-ghost', icon: 'refresh', onClick: (mm) => { resetTab(mm._tab || current); mm._renderPane?.(); return false; } },
        { label: '모두 기본값으로', class: 'btn-ghost', onClick: async (mm) => {
          const ok = await G.ui.confirm('소리·그래픽·화면·글자·키 설정을 모두 처음 값으로 되돌릴까요? 쉬운 모드와 보호자 확인은 그대로예요.', { title: '모두 기본값으로', okText: '되돌리기', danger: true });
          if (ok) { resetTab('all'); mm._renderPane?.(); }
          return false;
        } },
        { label: '닫기', class: 'btn-primary' },
      ],
      onClose: () => { W.m = null; W.refresh.clear(); W.go = null; },
    });
    W.m = m;
    return m;
  };
  /** 기본값으로: the registry's rows of the tab (or all) + the keys of the adopted pane (kid safety keys excepted) */
  function resetTab(tab) {
    const ids = S.reset(tab);
    let n = ids.length;
    const D = G.settingsDefaults || {};
    const keys = tab === 'all' ? Object.values(W.keys || {}).flat() : (W.keys?.[tab] || []);
    for (const k of keys) {
      if (k === 'easyMode' || k === 'kidChat' || k === 'parentGate' || !(k in D)) continue;
      if (S.idForKey(k)) continue; // reset above
      if (G.settings[k] !== D[k]) { G.setSetting(k, D[k]); n++; }
    }
    if ((tab === 'all' || tab === 'controls') && B()) { try { B().reset(); } catch (e) { /* bindings optional */ } }
    G.ui.toast(n ? '기본값으로 되돌렸어요.' : '이미 기본값이에요.', { type: 'info', sound: false });
    return n;
  }
  S.resetTab = resetTab;
  // live controls follow changes made elsewhere (a key, the kid controls, a sync from the account)
  G.bus.on('settings:option', ({ id } = {}) => { const f = W.refresh.get(id); if (f) { try { f(); } catch (e) { /* closed */ } } });
  G.bus.on('settings:changed', ({ key } = {}) => { const id = S.idForKey(key); const f = id && W.refresh.get(id); if (f) { try { f(); } catch (e) { /* closed */ } } });
  G.bus.on('input:bindings', () => { for (const [id, f] of W.refresh) if (/^key_/.test(id)) { try { f(); } catch (e) { /* closed */ } } });

  S.open = function (tab) {
    if (G.app?.openSettings) return G.app.openSettings(tab || undefined);
    return S.openWindow(tab);
  };
  S.close = function () { G.ui.modal.get('app-settings')?.close(); };
  S.isOpen = () => !!G.ui.modal.get('app-settings');

  // ================================================================ kept for the next login: the account store
  // A change goes to this device's store at once (03-state) and is also written down as "unsent" (localStorage
  // tfm.v1.settingsUnsent, per account: { <id>: { v, b: the value last agreed with the server, t: ms, s: a | d } })
  // until the server has taken it. At a login the server's values come down; an unsent change of this device stays
  // when the server still holds the value it was made over (nobody else changed that option) or when it is newer than
  // the server's row — so a later change on another device wins over an older one here, and a change made here is
  // never lost because the tab closed or the network dropped before it was sent. 409 SETTINGS_STALE (another device
  // wrote in between): the same merge with a fresh copy, then send again. Leaving: G.app.logout awaits flush() before
  // the session ends; a closing or hidden tab sends what is waiting with fetch keepalive (the CSRF header as always).
  // A guest and the file mode keep everything on this device only (no server account).
  const DEV_KEY = 'tfm.v1.deviceId';
  const UNSENT_KEY = 'tfm.v1.settingsUnsent';
  const same = (a, b) => (Array.isArray(a) || Array.isArray(b) ? JSON.stringify(a) === JSON.stringify(b) : a === b);
  const plainMap = (m) => (m && typeof m === 'object' && !Array.isArray(m) ? m : {});
  const store = {
    v: 0, other: {}, timer: 0, pending: false, busy: false, pulled: false, last: null, errors: 0, sent: 0,
    baseA: {}, baseD: {}, updatedAt: 0, _mem: {},
    deviceId() {
      let id = '';
      try { id = localStorage.getItem(DEV_KEY) || ''; } catch (e) { id = ''; }
      if (!/^[a-z][a-z0-9]{11}$/.test(id)) {
        id = 'abcdefghijklmnopqrstuvwxyz'[Math.floor(Math.random() * 26)] + Array.from({ length: 11 }, () => 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random() * 36)]).join('');
        try { localStorage.setItem(DEV_KEY, id); } catch (e) { /* storage blocked */ }
      }
      return id;
    },
    /** the server account the values belong to ('' for a guest, a local account or nobody) */
    uid() { const c = G.auth?.current; return c && c.kind === 'server' && c.id != null && c.id !== '' ? String(c.id).slice(0, 40) : ''; },
    online() { return G.net?.mode === 'server' && !!G.app?.loggedIn && !!G.state && !!store.uid(); },
    /** the unsent changes of this account on this device */
    unsent() {
      const u = store.uid();
      if (!u) return {};
      try { const all = plainMap(JSON.parse(localStorage.getItem(UNSENT_KEY) || '{}')); return Object.assign({}, plainMap(all[u])); }
      catch (e) { return Object.assign({}, plainMap(store._mem[u])); }
    },
    keepUnsent(m) {
      const u = store.uid();
      if (!u) return;
      const has = m && Object.keys(m).length > 0;
      if (has) store._mem[u] = m; else delete store._mem[u];
      try {
        const all = plainMap(JSON.parse(localStorage.getItem(UNSENT_KEY) || '{}'));
        if (has) { delete all[u]; all[u] = m; } else delete all[u];
        const ks = Object.keys(all);
        while (ks.length > 5) delete all[ks.shift()]; // at most five accounts on one device
        if (Object.keys(all).length) localStorage.setItem(UNSENT_KEY, JSON.stringify(all)); else localStorage.removeItem(UNSENT_KEY);
      } catch (e) { /* storage blocked: kept in memory for this tab */ }
    },
    /** a change of this device that the server has not taken yet */
    note(d) {
      if (!d || !store.online()) return;
      const m = store.unsent();
      const cur = S.get(d.id);
      if (cur === undefined || (typeof cur === 'object' && !Array.isArray(cur))) return;
      const prev = m[d.id];
      const base = prev ? prev.b : (d.scope === 'device' ? store.baseD : store.baseA)[d.id];
      if (store.pulled && base !== undefined && base !== null && same(base, cur)) delete m[d.id]; // back to what the server has
      else m[d.id] = { v: cur, b: base === undefined ? null : base, t: Date.now(), s: d.scope === 'device' ? 'd' : 'a' };
      store.keepUnsent(m);
    },
    /** the blob for the server: { acct: {id: v}, dev: { <deviceId>: { t, s: {id: v} } } } (≤ 5 devices, ≤ 8 KB) */
    blob() {
      const me = store.deviceId();
      const dev = Object.assign({}, store.other);
      dev[me] = { t: Math.floor(Date.now() / 1000), s: S.snapshot('device') };
      const ids = Object.keys(dev).sort((a, b) => (dev[b].t || 0) - (dev[a].t || 0)).slice(0, S.TABLE.devices);
      const out = { acct: S.snapshot('account'), dev: {} };
      for (const id of ids) out.dev[id] = dev[id];
      let json = JSON.stringify(out);
      while (json.length > S.TABLE.bytes - 64 && Object.keys(out.dev).length > 1) {
        const oldest = Object.keys(out.dev).filter((k) => k !== me).sort((a, b) => (out.dev[a].t || 0) - (out.dev[b].t || 0))[0];
        if (!oldest) break;
        delete out.dev[oldest];
        json = JSON.stringify(out);
      }
      return out;
    },
    schedule() {
      if (!store.online() || !store.pulled) { store.pending = store.online(); return; }
      store.pending = true;
      clearTimeout(store.timer);
      store.timer = setTimeout(() => store.push(), 2000);
    },
    /** the server's copy merged with this device's unsent changes (see above); returns { acct, dev } counts */
    merge(r) {
      store.v = Math.max(0, Number(r?.v) || 0);
      store.updatedAt = Math.max(0, Number(r?.updatedAt) || 0);
      const data = plainMap(r?.data);
      const me = store.deviceId();
      store.other = {};
      for (const [id, e] of Object.entries(plainMap(data.dev))) if (id !== me && /^[a-z][a-z0-9]{11}$/.test(id) && e && typeof e === 'object') store.other[id] = { t: Number(e.t) || 0, s: plainMap(e.s) };
      const acct = Object.assign({}, plainMap(data.acct));
      const mine = Object.assign({}, plainMap(plainMap(plainMap(data.dev)[me]).s));
      const un = store.unsent();
      // the server's row is newer than a change made here when it was written after it (server clock → this clock)
      const rowAt = store.updatedAt ? store.updatedAt - (Number(G.time?.serverOffset) || 0) : 0;
      const kept = [];
      for (const [id, u] of Object.entries(un)) {
        const d = S.def(id);
        const map = u && u.s === 'd' ? mine : acct;
        const srv = map[id];
        if (!d || !u || typeof u !== 'object' || same(srv, u.v)) { delete un[id]; continue; } // (the server has it already)
        const keep = srv === undefined || (u.b !== null && u.b !== undefined && same(srv, u.b)) || Number(u.t) > rowAt;
        if (!keep) { delete un[id]; continue; } // another device changed it later: its value wins
        delete map[id];
        kept.push([id, u.v]);
      }
      const nA = S.absorb(acct, 'account');
      const nD = S.absorb(mine, 'device');
      for (const [id, v] of kept) S.set(id, v, { quiet: true, force: true }); // on top of what the player save brought
      store.baseA = plainMap(data.acct); store.baseD = plainMap(plainMap(plainMap(data.dev)[me]).s);
      store.keepUnsent(un);
      return { acct: nA, dev: nD, kept: kept.length };
    },
    async pull() {
      if (!store.online()) return false;
      try {
        const r = await G.net.request('settings/get.php', { quiet: true, timeout: 9000 });
        if (!store.online()) return false;
        const n = store.merge(r);
        store.pulled = true;
        store.last = { at: Date.now(), v: store.v, acct: n.acct, dev: n.dev, kept: n.kept };
        try { G.bus.emit('settings:synced', { v: store.v, from: 'server', acct: n.acct, dev: n.dev, kept: n.kept }); } catch (e) { /* bus optional */ }
        if (store.pending || !store.v || n.kept > 0) store.schedule();
        return true;
      } catch (e) {
        store.pulled = true; // an older server without the endpoint: keep the device store only
        G.log.info('SETTINGS', 'account settings not available', e?.code || e?.message || e);
        return false;
      }
    },
    /** after the server took a blob: it is the agreed copy now; the unsent changes it carried are done */
    took(blob, sentAt, v) {
      store.v = Math.max(store.v, Number(v) || 0);
      store.errors = 0; store.sent++;
      const me = store.deviceId();
      store.baseA = plainMap(blob.acct); store.baseD = plainMap(plainMap(plainMap(blob.dev)[me]).s);
      const un = store.unsent();
      for (const [id, u] of Object.entries(un)) { const sv = (u && u.s === 'd' ? store.baseD : store.baseA)[id]; if (!u || (Number(u.t) <= sentAt && same(sv, u.v))) delete un[id]; }
      store.keepUnsent(un);
    },
    /** one push at a time: a change made while it runs is sent by the same run (or the next pause); 409 → merge → again */
    async push() {
      clearTimeout(store.timer);
      if (!store.online()) return false;
      if (store.busy) { store.pending = true; return false; } // the running push looks at `pending` when it ends
      store.busy = true;
      let ok = false;
      try {
        for (let round = 0; round < 3 && store.online(); round++) {
          store.pending = false;
          const blob = store.blob(), sentAt = Date.now();
          try {
            const r = await G.net.request('settings/save.php', { body: { v: store.v + 1, data: blob }, quiet: true, timeout: 9000 });
            store.took(blob, sentAt, Math.max(store.v + 1, Number(r?.v) || 0));
            try { G.bus.emit('settings:synced', { v: store.v, from: 'device' }); } catch (e) { /* bus optional */ }
            ok = true;
            break;
          } catch (e) {
            if (e && e.code === 'SETTINGS_STALE' && round < 2) {
              // another device wrote in between: take its copy (keeping the changes made here), then send again
              store.stale = (store.stale || 0) + 1;
              try { store.merge(await G.net.request('settings/get.php', { quiet: true, timeout: 9000 })); }
              catch (err) { store.v = Math.max(store.v, Number(e.data?.v) || 0); }
              continue;
            }
            store.pending = true;
            if (++store.errors < 4 && e?.code !== 'NOT_FOUND' && !/^HTTP_404$/.test(e?.code || '')) { clearTimeout(store.timer); store.timer = setTimeout(() => store.push(), 5000 * store.errors); }
            G.log.info('SETTINGS', 'account settings not saved', e?.code || e?.message || e);
            return false;
          }
        }
        return ok;
      } finally {
        store.busy = false;
        if (ok && store.pending) store.schedule(); // changed while the answer was on its way
      }
    },
    /** before the session ends (logout): what is waiting goes now; resolves when the server answered (or gave up) */
    async flush() {
      for (let i = 0; i < 40 && store.busy; i++) await new Promise((r) => setTimeout(r, 100));
      if (store.pending && store.online() && store.pulled) return store.push();
      return false;
    },
    /** the tab closes or hides: send what is waiting with keepalive (its answer may never be seen; the unsent list stays) */
    beacon() {
      if (!store.pending || !store.online() || !store.pulled || typeof fetch !== 'function') return false;
      clearTimeout(store.timer);
      const blob = store.blob(), sentAt = Date.now(), v = store.v + 1;
      try {
        const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
        if (G.net.csrf) headers['X-CSRF-Token'] = G.net.csrf;
        store.pending = false;
        fetch(G.net.base + 'settings/save.php', { method: 'POST', headers, body: JSON.stringify({ v, data: blob }), credentials: 'include', keepalive: true, cache: 'no-store' })
          .then((res) => res.json()).then((j) => { if (j && j.success === true) store.took(blob, sentAt, Number(j.data?.v) || v); else store.schedule(); })
          .catch(() => { store.pending = true; if (document.visibilityState === 'visible') store.schedule(); }); // gone or offline: the unsent list waits for the next chance
        store.beaconAt = sentAt;
        return true;
      } catch (e) { store.pending = true; return false; }
    },
    reset() { clearTimeout(store.timer); store.v = 0; store.other = {}; store.pending = false; store.pulled = false; store.errors = 0; store.baseA = {}; store.baseD = {}; store.updatedAt = 0; store.last = null; },
  };
  S.store = store;
  S._dirty = (d) => { if (d && d.type !== 'action' && d.type !== 'info') { store.note(d); store.schedule(); } };
  G.bus.on('game:login', () => { store.reset(); setTimeout(() => { store.pull().then(() => S.applyAll()); }, 50); });
  G.bus.on('game:logout', () => { store.reset(); });
  window.addEventListener('pagehide', () => { try { store.beacon(); } catch (e) { /* leaving */ } });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') { try { store.beacon(); } catch (e) { /* hidden */ } } });

  // dev centre / tests
  S._W = W;
})();
