// tests/settings-store.mjs — Node-only checks of the account store of the settings window (src/game/68-settings.js,
// CONTRACT §18.2 "kept for the next login"): two devices (two copies of the fragment, each with its own local storage)
// talk to one fake api/settings server that follows Tfm\UserSettings (the blob replaces the row only when v is higher,
// else 409 SETTINGS_STALE {v}; updatedAt in server milliseconds). Timers are driven by the test (the 2 s debounce).
//   - device 1: changes → sent after the pause, account values in acct, device values under its own device id
//   - a change two seconds before the tab closes → sent on pagehide with fetch keepalive and the CSRF header
//   - a change just before the logout → flush() sends it before the session ends
//   - device 2 (fresh storage) logs in: every account value comes FROM THE ACCOUNT STORE, none of device 1's device values
//   - device 2 changes A while device 1 changes B (device 1 holds an old v) → 409 → merge → both kept, device 1 shows A
//   - changes made while the server is unreachable stay "unsent" over a logout and win at the next login unless another
//     device changed the same option later (then the later one wins)
//   - a guest of the device and the file mode never call the server
// Run: node tests/settings-store.mjs
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = fs.readFileSync(path.join(ROOT, 'src/game/68-settings.js'), 'utf8');
let pass = 0, fail = 0;
const check = (name, ok, detail = '') => { if (ok) pass++; else fail++; console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`); };
const tick = () => new Promise((r) => setImmediate(r));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------------ the fake server (Tfm\UserSettings semantics)
const server = {
  rows: new Map(), up: true, log: [], csrf: 'c0ffee',
  handle(user, method, p, body, headers) {
    this.log.push({ user, method, p, v: body?.v, keepalive: !!headers?.keepalive, csrf: headers?.['X-CSRF-Token'] || null });
    if (!this.up) return { status: 0 };
    if (!user) return { status: 401, json: { success: false, error: { code: 'AUTH_REQUIRED' } } };
    if (p === 'settings/get.php') {
      const r = this.rows.get(user);
      return { status: 200, json: { success: true, data: r ? { v: r.v, data: JSON.parse(r.data), updatedAt: r.at } : { v: 0, data: { acct: {}, dev: {} }, updatedAt: 0 } } };
    }
    if (p === 'settings/save.php') {
      if (headers?.['X-CSRF-Token'] !== this.csrf) return { status: 403, json: { success: false, error: { code: 'CSRF' } } };
      const cur = this.rows.get(user);
      if (!Number.isInteger(body?.v) || body.v < 1) return { status: 400, json: { success: false, error: { code: 'INVALID_INPUT' } } };
      if (cur && !(cur.v < body.v)) return { status: 409, json: { success: false, error: { code: 'SETTINGS_STALE' }, data: { v: cur.v } } };
      this.rows.set(user, { v: body.v, data: JSON.stringify(body.data), at: Date.now() });
      return { status: 200, json: { success: true, data: { v: body.v, dropped: 0 } } };
    }
    return { status: 404, json: { success: false, error: { code: 'NOT_FOUND' } } };
  },
  acct(user) { const r = this.rows.get(user); return r ? JSON.parse(r.data).acct : {}; },
  blob(user) { const r = this.rows.get(user); return r ? JSON.parse(r.data) : null; },
};

// ------------------------------------------------------------------ one device = one copy of the fragment
function device(tag) {
  const ls = new Map();
  const localStorage = { getItem: (k) => (ls.has(k) ? ls.get(k) : null), setItem: (k, v) => ls.set(k, String(v)), removeItem: (k) => ls.delete(k) };
  const timers = []; let now = 0;
  const setT = (fn, ms) => { const t = { at: now + (Number(ms) || 0), fn, id: timers.length + 1 }; timers.push(t); return t.id; };
  const clearT = (id) => { const t = timers.find((x) => x.id === id); if (t) t.fn = null; };
  const winEv = {}, docEv = {}, busEv = {};
  const store = {};
  const ApiError = class extends Error { constructor(code, msg, status, data) { super(msg); this.code = code; this.status = status; this.data = data; } };
  const dev = { tag, user: null, requests: 0 };
  const G = {
    data: {}, sys: {}, util: {}, flags: {},
    log: { warn() {}, info() {}, debug() {}, error() {} },
    bus: { on(n, f) { (busEv[n] = busEv[n] || []).push(f); }, once(n, f) { (busEv[n] = busEv[n] || []).push(f); }, emit(n, p) { for (const f of busEv[n] || []) f(p); } },
    settings: {}, settingsDefaults: {}, settingsRanges: {}, settingsEnums: {}, settingsDeviceKeys: new Set(),
    deviceSetting(k) { return k in store ? store[k] : G.settingsDefaults[k]; },
    setSetting(k, v) { if (G.settings[k] === v) return; G.settings[k] = v; store[k] = v; G.bus.emit('settings:changed', { key: k, value: v }); },
    register(s) { G.sys[s.name] = s; return s; },
    ui: { h: () => ({}), modal: { get: () => null, open: () => null }, toast() {}, hydrateIcons() {}, tabs() {} },
    easy: { on: false }, time: { serverOffset: 0, now: () => Date.now() },
    app: { loggedIn: false }, auth: { current: null }, state: null,
    net: {
      mode: 'server', base: 'api/', csrf: server.csrf,
      async request(p, o = {}) {
        dev.requests++;
        const method = o.method || (o.body ? 'POST' : 'GET');
        const headers = {}; if (method !== 'GET' && G.net.csrf) headers['X-CSRF-Token'] = G.net.csrf;
        await tick();
        const r = server.handle(dev.user, method, p, o.body ? JSON.parse(JSON.stringify(o.body)) : null, headers);
        if (!r.status) throw new ApiError('NETWORK_ERROR', 'down', 0);
        if (!r.json?.success) throw new ApiError(r.json?.error?.code || `HTTP_${r.status}`, 'no', r.status, r.json?.data);
        return r.json.data;
      },
    },
  };
  const fakeFetch = async (url, init) => {
    dev.requests++;
    const p = String(url).replace(/^api\//, '');
    const r = server.handle(dev.user, init.method, p, JSON.parse(init.body), { ...init.headers, keepalive: !!init.keepalive });
    if (!r.status) throw new TypeError('Failed to fetch');
    return { json: async () => r.json };
  };
  const el = { style: { setProperty() {} }, classList: { toggle() {}, contains: () => false, add() {}, remove() {} } };
  const document = { documentElement: el, body: el, visibilityState: 'visible', addEventListener: (n, f) => { (docEv[n] = docEv[n] || []).push(f); }, getElementById: () => null };
  const window = { addEventListener: (n, f) => { (winEv[n] = winEv[n] || []).push(f); } };
  const ctx = vm.createContext({ G, window, document, localStorage, fetch: fakeFetch, setTimeout: setT, clearTimeout: clearT, console, Math, JSON, Object, Array, Number, String, Date, Promise, Map, Set, Error, TypeError });
  vm.runInContext(`(function(){'use strict';\n${SRC}\n})()`, ctx, { timeout: 4000 });
  const S = G.sys.settings;
  S.init(); S.postInit();
  /** move this device's clock on, running the timers that come due (and the promises they start) */
  dev.advance = async (ms) => {
    const end = now + ms;
    for (;;) {
      await tick(); await tick();
      const due = timers.filter((t) => t.fn && t.at <= end).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      now = Math.max(now, due.at);
      const f = due.fn; due.fn = null; f();
      for (let i = 0; i < 6; i++) await tick();
    }
    now = end;
    for (let i = 0; i < 6; i++) await tick();
  };
  dev.login = async (user, kind = 'server') => {
    dev.user = kind === 'server' ? user : null;
    G.auth.current = { id: user, kind }; G.state = { settings: {} }; G.app.loggedIn = true;
    G.bus.emit('game:login', { profile: { id: user } });
    await dev.advance(100);
  };
  dev.logout = async () => {
    await Promise.race([S.store.flush(), wait(200)]);
    G.app.loggedIn = false; G.state = null; G.auth.current = null; dev.user = null;
    G.bus.emit('game:logout', {});
  };
  dev.hide = () => { document.visibilityState = 'hidden'; for (const f of docEv.visibilitychange || []) f(); for (const f of winEv.pagehide || []) f(); };
  Object.assign(dev, { G, S, ls, store });
  return dev;
}

const ACCT = { mixMaster: 65, mixMusic: 25, mixSfx: 85, mixUi: 45, mixVoice: 75, mixNature: 35, textScale: 5, uiStep: 3, avatarScale: 115, nameplates: 'off', hudOpacity: 70, muteHidden: false };
const DEV = { stickSide: 'right', touchButtons: 3 };

// ---- device 1: the debounced save
const d1 = device('d1');
await d1.login('u1');
check('device 1: the login reads the account store (get.php)', server.log.some((x) => x.user === 'u1' && x.p === 'settings/get.php') && d1.S.store.pulled);
for (const [k, v] of Object.entries({ ...ACCT, ...DEV })) d1.S.set(k, v);
const before = server.log.length;
await d1.advance(1500);
check('device 1: nothing is sent during the 2 s pause', !server.log.slice(before).some((x) => x.p === 'settings/save.php'));
await d1.advance(800);
const a1 = server.acct('u1');
const okA = Object.entries(ACCT).every(([k, v]) => (a1[k] === v));
check('device 1: after the pause every account value is in user_settings', server.rows.get('u1')?.v >= 1 && okA, Object.entries(ACCT).filter(([k, v]) => a1[k] !== v).map(([k]) => `${k}=${a1[k]}`).join(' '));
const id1 = d1.S.store.deviceId();
check('device 1: device values sit under its own device id, not in acct', server.blob('u1').dev[id1]?.s?.stickSide === 'right' && server.blob('u1').dev[id1].s.touchButtons === 3 && !('stickSide' in a1));
check('device 1: nothing is left unsent', Object.keys(d1.S.store.unsent()).length === 0 && !d1.S.store.pending);

// ---- a change two seconds before the tab closes
d1.S.set('mixMusic', 30);
await d1.advance(500);
const sb = server.log.length;
d1.hide();
await d1.advance(10);
const bc = server.log.slice(sb).find((x) => x.p === 'settings/save.php');
check('tab closes 0.5 s after a change: sent at once with keepalive and the CSRF header', !!bc && bc.keepalive && bc.csrf === server.csrf && server.acct('u1').mixMusic === 30, JSON.stringify(bc));
await d1.advance(3000);
check('… and not sent a second time when the pause ends', server.log.slice(sb).filter((x) => x.p === 'settings/save.php').length === 1);

// ---- a change just before the logout
d1.S.set('mixVoice', 55);
await d1.logout();
check('logout 0 s after a change: flush() sends it before the session ends', server.acct('u1').mixVoice === 55);

// ---- device 2: a fresh browser
const d2 = device('d2');
server.rows.get('u1').data = JSON.stringify({ ...server.blob('u1'), acct: { ...server.acct('u1'), mixNature: 15 } }); // only the account store has 15
await d2.login('u1');
const got = Object.fromEntries(Object.keys(ACCT).map((k) => [k, d2.S.get(k)]));
const want = { ...ACCT, mixMusic: 30, mixVoice: 55, mixNature: 15 };
const lost = Object.keys(want).filter((k) => got[k] !== want[k]);
check('device 2: every account value comes from the account store (자연 소리 15 too)', lost.length === 0, lost.map((k) => `${k}=${got[k]}`).join(' '));
check('device 2: none of device 1\'s device values', d2.S.get('stickSide') === 'left' && d2.S.get('touchButtons') === 2 && d2.S.store.deviceId() !== id1);
d2.S.set('touchButtons', 1);
await d2.advance(2500);
check('device 2: a device value of its own goes under its id, beside device 1\'s (which stays)', server.blob('u1').dev[d2.S.store.deviceId()]?.s?.touchButtons === 1 && server.blob('u1').dev[id1]?.s?.touchButtons === 3);

// ---- both devices at once: device 2 changes A, device 1 (an old v) changes B → 409 → merge
await d1.login('u1');
d2.S.set('mixSfx', 20);
await d2.advance(2500);
const vAfter2 = server.rows.get('u1').v;
d1.S.set('textScale', 4);
// device 1 does not know device 2's save: its v is behind
d1.S.store.v = Math.min(d1.S.store.v, vAfter2 - 1);
const c0 = server.log.length;
await d1.advance(2500);
const st = server.log.slice(c0).filter((x) => x.user === 'u1');
const s409 = st.filter((x) => x.p === 'settings/save.php').length >= 2 && st.some((x) => x.p === 'settings/get.php');
const a2 = server.acct('u1');
check('two devices: device 1 meets 409 SETTINGS_STALE, reads again and sends again', s409, st.map((x) => `${x.method}${x.v ?? ''}`).join(' '));
check('two devices: device 2\'s change (효과음 20) and device 1\'s (글자 4) are both kept', a2.mixSfx === 20 && a2.textScale === 4, JSON.stringify({ sfx: a2.mixSfx, text: a2.textScale }));
check('two devices: device 1 now shows device 2\'s value', d1.S.get('mixSfx') === 20 && d1.S.get('textScale') === 4);
await d2.logout(); await d2.login('u1');
check('two devices: device 2 picks up device 1\'s change at its next login', d2.S.get('textScale') === 4 && d2.S.get('mixSfx') === 20);

// ---- unsent over a logout: the server is down while device 1 changes things
server.up = false;
d1.S.set('hudOpacity', 60);
d1.S.set('chatOpacity', 50);
await d1.advance(2500);
await d1.logout();
check('server down: the changes stay on device 1 as unsent', (() => { const ls = JSON.parse(d1.ls.get('tfm.v1.settingsUnsent') || '{}'); return ls.u1 && ls.u1.hudOpacity?.v === 60 && ls.u1.chatOpacity?.v === 50; })(), d1.ls.get('tfm.v1.settingsUnsent'));
server.up = true;
await wait(5);
d2.S.set('mixUi', 10); d2.S.set('chatOpacity', 80); // later than device 1's 50
await d2.advance(2500);
d1.S.set('hudOpacity', 100, { quiet: true }); // the player save of device 2 may bring older values back meanwhile
await d1.login('u1');
await d1.advance(2500);
const a3 = server.acct('u1');
check('next login: device 1 keeps its unsent change nobody else made (HUD 60) and sends it', d1.S.get('hudOpacity') === 60 && a3.hudOpacity === 60, `${d1.S.get('hudOpacity')} / ${a3.hudOpacity}`);
check('next login: device 1 takes device 2\'s later changes (UI 효과음 10; 채팅 80 wins over its older 50)', d1.S.get('mixUi') === 10 && d1.S.get('chatOpacity') === 80 && a3.chatOpacity === 80 && a3.mixUi === 10, JSON.stringify({ ui: d1.S.get('mixUi'), chat: d1.S.get('chatOpacity'), srv: a3.chatOpacity }));
check('next login: the unsent list is empty again', Object.keys(d1.S.store.unsent()).length === 0);

// ---- guest and file mode
const g = device('guest');
await g.login('guest-1', 'guest');
g.S.set('mixMaster', 40);
await g.advance(3000); g.hide(); await g.advance(10);
check('a guest keeps values on the device only (no request)', g.requests === 0 && g.S.get('mixMaster') === 40);
const f = device('file');
f.G.net.mode = 'local';
await f.login('local-1', 'server');
f.S.set('mixMaster', 40);
await f.advance(3000); f.hide(); await f.advance(10);
check('the file mode keeps values on the device only (no request)', f.requests === 0 && f.S.get('mixMaster') === 40);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
