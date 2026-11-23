// tests/settings-registry.mjs — Node-only checks of the options registry (src/game/68-settings.js, CONTRACT §18.2):
// the pure table evaluates without a DOM, define / queue / get / set / map / reset / search / snapshot / absorb behave,
// and the account store's blob rules (8 KB, ≤ 5 devices) hold. Run: node tests/settings-registry.mjs
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = fs.readFileSync(path.join(ROOT, 'src/game/68-settings.js'), 'utf8');
let pass = 0, fail = 0;
const check = (name, ok, detail = '') => { if (ok) pass++; else fail++; console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`); };

// 1) Node data export (as tools/build.mjs runs it)
{
  const G = { data: {} };
  const ctx = vm.createContext({ G, window: {}, console, Math, JSON, Object, Array, Number, String, Date });
  let err = null;
  try { vm.runInContext(`(function(){'use strict';\n${SRC}\n})()`, ctx, { timeout: 2000 }); } catch (e) { err = e; }
  const T = G.data.settingsTable;
  check('table: evaluates in Node without a DOM', !err && !!T, err ? err.message : '');
  check('table: twelve tabs incl. 도움말 and 사용한 자료', T && T.tabs.length === 12 && T.tabs.includes('help') && T.tabs.includes('credits'));
  const bad = T ? Object.entries(T.options).filter(([id, o]) => !/^[A-Za-z]\w{0,39}$/.test(id) || !['b', 'n', 'e'].includes(o.t) || !['a', 'd'].includes(o.s)
    || (o.t === 'n' && !(o.max > o.min && o.d >= o.min && o.d <= o.max)) || (o.t === 'e' && !o.values.includes(o.d)) || (o.t === 'b' && typeof o.d !== 'boolean')) : ['no table'];
  check('table: every option has a sane type, range and default', bad.length === 0, bad.map((b) => b[0]).join(','));
  check('table: the six volumes are 0 – 100 with 100 as default', T && ['mixMaster', 'mixMusic', 'mixSfx', 'mixUi', 'mixVoice', 'mixNature'].every((k) => T.options[k].min === 0 && T.options[k].max === 100 && T.options[k].d === 100));
  check('table: limits 8 KB / 5 devices', T && T.bytes === 8192 && T.devices === 5);
  check('table: JSON-serialisable (game-data.json)', (() => { try { return JSON.parse(JSON.stringify(T)).v === 1; } catch (e) { return false; } })());
}

// 2) the registry with a small fake G
function makeG() {
  const store = {};
  const ev = {};
  const G = {
    data: {}, sys: {}, util: { clamp: (v, a, b) => Math.min(b, Math.max(a, v)) },
    log: { warn() {}, info() {}, debug() {}, error() {} },
    bus: { on(n, f) { (ev[n] = ev[n] || []).push(f); }, emit(n, p) { for (const f of ev[n] || []) f(p); }, ev },
    settings: { uiScale: 1, volumeMaster: 0.8 },
    settingsDefaults: { uiScale: 1, volumeMaster: 0.8 },
    settingsRanges: { uiScale: [0.75, 1.4] }, settingsEnums: {}, settingsDeviceKeys: new Set(),
    deviceSetting(k) { return k in store ? store[k] : G.settingsDefaults[k]; },
    setSetting(k, v) { G.settings[k] = v; store[k] = v; G.bus.emit('settings:changed', { key: k, value: v }); },
    register(s) { G.sys[s.name] = s; return s; },
    _store: store,
  };
  return G;
}
{
  const G = makeG();
  const applied = [];
  G.settingsQueue = [{ id: 'early', type: 'toggle', tab: 'sound', label: '먼저 온 설정', default: true, apply: (v) => applied.push(['early', v]) }];
  const ctx = vm.createContext({ G, window: {}, document: {}, console, Math, JSON, Object, Array, Number, String, Date });
  vm.runInContext(`(function(){'use strict';\n${SRC}\n})()`, ctx, { timeout: 2000 });
  const S = G.sys.settings;
  check('registry: G.sys.settings exists at load', !!S && typeof S.define === 'function');
  check('registry: the early queue was drained at load', S.has('early'));
  G.settingsQueue.push({ id: 'late', type: 'slider', tab: 'graphics', label: '늦게 온 설정', min: 0, max: 10, step: 1, default: 9 });
  check('registry: a later push defines at once', S.has('late') && G.settingsQueue.length === 0);
  S.init(); S.postInit();
  check('registry: postInit applies every option once', applied.length === 1 && applied[0][1] === true);
  check('registry: default reaches G.settings and the validator', G.settings.late === 9 && G.settingsDefaults.late === 9 && G.settingsRanges.late[1] === 10);
  check('registry: slider values are clamped and stepped', S.set('late', 12) === 10 && S.set('late', 3.4) === 3 && S.set('late', 'x') === 9);
  S.define({ id: 'pick', type: 'select', tab: 'display', label: '화면 모드', options: [{ v: 'window', l: '창 모드' }, { v: 'fullscreen', l: '전체 화면' }], default: 'window', scope: 'device' });
  check('registry: select keeps only its choices', S.set('pick', 'fullscreen') === 'fullscreen' && S.set('pick', 'weird') === 'window');
  check('registry: device scope is told to 03-state', G.settingsDeviceKeys.has('pick'));
  // a view over another key (UI 크기 steps ↔ uiScale)
  const K = [0.9, 1, 1.12, 1.25];
  S.define({ id: 'uiStep', key: 'uiScale', type: 'steps', tab: 'layout', label: 'UI 크기', options: [1, 2, 3, 4].map((v) => ({ v, l: v + '단계' })), default: 2,
    map: { to: (v) => K[v - 1], from: (s) => { let b = 2, bd = 9; K.forEach((k, i) => { const dd = Math.abs(k - Number(s)); if (dd < bd) { bd = dd; b = i + 1; } }); return b; } } });
  check('registry: a mapped option reads the stored key', S.get('uiStep') === 2);
  S.set('uiStep', 4);
  check('registry: a mapped option writes the stored key', G.settings.uiScale === 1.25 && S.get('uiStep') === 4);
  // events and outside writes
  let opt = null; G.bus.on('settings:option', (p) => { opt = p; });
  S.set('early', false);
  check('registry: settings:option fires with the kept value', opt && opt.id === 'early' && opt.value === false);
  applied.length = 0;
  G.setSetting('early', true);
  check('registry: an outside G.setSetting runs the apply', applied.length === 1 && applied[0][1] === true);
  // availability
  S.define({ id: 'gated', type: 'toggle', tab: 'graphics', label: '블룸', default: false, available: () => '낮음 품질에서는 쓸 수 없어요.' });
  check('registry: an unavailable option keeps its value and tells why', S.set('gated', true) === false && /낮음/.test(S.available('gated')));
  // search
  check('registry: search finds by label (spaces ignored)', S.search('화면모드')[0]?.id === 'pick' && S.search('UI크기')[0]?.id === 'uiStep');
  check('registry: search finds by option label', S.search('전체 화면').some((d) => d.id === 'pick'));
  // reset
  S.set('late', 2); S.set('pick', 'fullscreen');
  const ids = S.reset('graphics');
  check('registry: reset(tab) brings only that tab back', G.settings.late === 9 && G.settings.pick === 'fullscreen' && ids.includes('late'));
  S.reset('all');
  check('registry: reset(all)', G.settings.pick === 'window' && G.settings.uiScale === 1);
  // snapshot / absorb
  S.set('late', 5); S.set('pick', 'fullscreen');
  const acct = S.snapshot('account'), dev = S.snapshot('device');
  check('registry: snapshot splits account and device', acct.late === 5 && !('pick' in acct) && dev.pick === 'fullscreen');
  const n = S.absorb({ late: 7, pick: 'window', unknown: 1, constructor: 1 }, 'account');
  check('registry: absorb takes only known ids of its scope', n === 1 && G.settings.late === 7 && G.settings.pick === 'fullscreen');
  check('registry: bad defs are refused', S.define({ id: '1x', type: 'toggle' }) === null && S.define({ id: 'ok', type: 'nope' }) === null && S.define({ id: '__proto__', type: 'toggle' }) === null);
  check('registry: list(filter) by tab, sorted', S.list({ tab: 'graphics' }).map((d) => d.id).join() === 'late,gated');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
