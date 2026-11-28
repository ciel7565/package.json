// tests/helpers/input-page.mjs — a fake window / document / G around src/game/05-input.js (copied from tests/input-bindings.mjs so
// that other Node suites of the input layer can drive real key events without a browser). page(opts) → P { G, T, I, B, down, up,
// press, tap, wait, frame, ... }. opts: { touch, webdriver, search, settings, easy, site }
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SRC = fs.readFileSync(path.join(ROOT, 'src/game/05-input.js'), 'utf8');
/** a page: fake window / document / G around the fragment. opts: { touch, webdriver, search, settings, easy, site } */
export function page(opts = {}) {
  const T = { now: 1000, typing: false, blocking: false, timers: [], said: [], toasts: [] };
  const listeners = (o) => { o._l = {}; o.addEventListener = (t, fn, opt) => { (o._l[t] = o._l[t] || []).push(fn); if (opt === true || (opt && opt.capture)) (o._cap = o._cap || []).push(t); }; o.removeEventListener = () => {}; o.dispatch = (t, e) => { for (const fn of (o._l[t] || []).slice()) fn(e); }; return o; };
  const mkEl = (tag) => {
    const el = listeners({ tagName: String(tag).toUpperCase(), style: {}, dataset: {}, attrs: {}, children: [], hidden: false, textContent: '', isConnected: true,
      classList: { _s: new Set(), add(...c) { c.forEach((x) => this._s.add(x)); }, remove(...c) { c.forEach((x) => this._s.delete(x)); }, toggle(c, on) { const v = on === undefined ? !this._s.has(c) : !!on; if (v) this._s.add(c); else this._s.delete(c); return v; }, contains(c) { return this._s.has(c); } },
      setAttribute(k, v) { this.attrs[k] = String(v); }, getAttribute(k) { return this.attrs[k] ?? null; },
      append(...n) { for (const x of n) { this.children.push(x); x.parent = this; } }, appendChild(n) { this.children.push(n); n.parent = this; return n; },
      remove() { this.isConnected = false; if (this.parent) this.parent.children = this.parent.children.filter((x) => x !== this); },
      contains(n) { return n === this || this.children.some((c) => c === n || c.contains?.(n)); }, closest() { return null; }, matches() { return false; },
      querySelector() { return null; }, querySelectorAll() { return []; }, blur() {}, focus() {}, setPointerCapture() {}, getBoundingClientRect() { return { left: 0, top: 0, width: 960, height: 540, right: 960, bottom: 540 }; },
      click() { this.dispatch('click', { detail: 0 }); },
    });
    return el;
  };
  const body = mkEl('body'), gc = mkEl('div');
  gc.id = 'game-container';
  let lockEl = null;
  const lock = { requests: 0, exits: 0 };
  const document = listeners({
    readyState: 'complete', body, activeElement: body, hidden: false,
    getElementById: (id) => (id === 'game-container' ? gc : body.children.find((c) => c.id === id) || null),
    createElement: mkEl, createElementNS: (ns, tag) => mkEl(tag), querySelector: () => null, querySelectorAll: () => [],
    exitPointerLock() { lock.exits++; lockEl = null; },
  });
  Object.defineProperty(document, 'pointerLockElement', { get: () => lockEl });
  gc.requestPointerLock = () => { lock.requests++; if (opts.refuseLock) return Promise.reject(new Error('no')); lockEl = gc; setImmediateLock(); return undefined; };
  const pending = [];
  function setImmediateLock() { pending.push(() => document.dispatch('pointerlockchange', {})); }
  const flush = () => { while (pending.length) pending.shift()(); };
  const window = listeners({
    matchMedia: (q) => ({ matches: /pointer: fine/.test(q) ? !opts.touch : /pointer: coarse/.test(q) ? !!opts.touch : false, addEventListener() {} }),
    devicePixelRatio: 1,
  });
  if (opts.touch) window.ontouchstart = null;
  const bus = { _l: {}, on(t, fn) { (this._l[t] = this._l[t] || []).push(fn); return () => {}; }, emit(t, d) { for (const fn of (this._l[t] || []).slice()) fn(d); }, seen: [] };
  const store = {};
  const settings = Object.assign({ easyMode: opts.easy !== false, sensitivity: 1, lookSpeed: 1 }, opts.settings || {});
  const G = {
    util: { clamp: (v, a, b) => (v < a ? a : v > b ? b : v), isTyping: () => T.typing },
    bus, settings, state: opts.noState ? null : {}, ready: true, sys: {}, data: {},
    setSetting(k, v) { settings[k] = v; bus.emit('settings:changed', { key: k, value: v }); },
    ui: { isBlocking: () => T.blocking || T.typing, handleEscape: () => false, toast: (m) => { T.toasts.push(m); return null; } },
    log: { warn() {}, error(...a) { T.errors = (T.errors || []).concat([a.map(String).join(' ')]); }, debug() {}, info() {} },
    easy: { on: opts.easy !== false, say: (t) => T.said.push(t) },
    site: opts.site ? { get: (k, d) => (k in opts.site ? opts.site[k] : d) } : null,
    osReducedMotion: () => false,
  };
  const ctx = vm.createContext({
    G, window, document, console, Math, Number, Object, Map, Set, Array, String, JSON, Promise, Error, RegExp, Infinity, NaN, URLSearchParams,
    performance: { now: () => T.now }, navigator: { maxTouchPoints: opts.touch ? 5 : 0, webdriver: !!opts.webdriver },
    screen: { width: opts.touch ? 390 : 1920, height: opts.touch ? 844 : 1080 }, location: { search: opts.search || '' },
    localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } },
    setTimeout: (fn, ms) => { T.timers.push({ at: T.now + (ms || 0), fn }); return T.timers.length; }, clearTimeout: (id) => { if (T.timers[id - 1]) T.timers[id - 1].fn = null; },
    PointerEvent: function () {}, MouseEvent: function () {}, Element: function () {}, Node: function () {},
  });
  ctx.window.window = window;
  if (typeof opts.pre === 'function') opts.pre({ mkEl, body, document, window, G });   // elements the fragment binds at load (joystick, d-pad)
  vm.runInContext(SRC, ctx, { filename: '05-input.js' });
  const ev = (code, o = {}) => ({ code, key: o.key || code, repeat: !!o.repeat, ...(o.ts != null ? { timeStamp: o.ts } : {}), ctrlKey: !!o.ctrl || /^Control/.test(code) && o.type !== 'keyup', shiftKey: !!o.shift, altKey: !!o.alt, metaKey: !!o.meta, defaultPrevented: false, target: body,
    preventDefault() { this.defaultPrevented = true; }, stopPropagation() {} });
  const P = {
    G, T, I: G.input, B: G.input.bindings, ML: G.input.mouseLook, body, gc, lock, store, document, window, flush,
    down(code, o) { const e = ev(code, o); window.dispatch('keydown', e); flush(); return e; },
    up(code, o) { const e = ev(code, { ...o, type: 'keyup' }); e.ctrlKey = !!(o && o.ctrl); window.dispatch('keyup', e); flush(); return e; },
    press(code, o) { const e = P.down(code, o); P.up(code, o); return e; },
    tap(code = 'ControlLeft', ms = 80) { P.down(code); T.now += ms; P.up(code); },
    wait(ms) { T.now += ms; for (const t of T.timers) if (t.fn && t.at <= T.now) { const f = t.fn; t.fn = null; f(); } },
    frame() { G.input.update(); flush(); },
    clickView() { const d = { pointerType: 'mouse', button: 0, pointerId: 1, clientX: 400, clientY: 300, isPrimary: true, target: gc }; window.dispatch('pointerdown', d); gc.dispatch('pointerdown', d); flush(); gc.dispatch('pointerup', { ...d, type: 'pointerup' }); flush(); },
    escLock() { /* the browser takes the pointer back (Esc) */ document.exitPointerLock(); lock.exits--; document.dispatch('pointerlockchange', {}); },
    chip() { const c = body.children.find((x) => x.id === 'ml-chip'); return c && !c.hidden ? c : null; },
    coach() { return body.children.find((x) => x.id === 'ml-coach') || null; },
  };
  return P;
}
