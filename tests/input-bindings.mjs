#!/usr/bin/env node
// tests/input-bindings.mjs — CONTRACT §18.2 (lane gfx), the input layer in a Node vm with a small fake DOM (no browser):
// G.input.bindings (list / get / set / reset / isDown / on / name / capture, conflicts refused, reserved and fixed keys,
// the translation of a rebound key to the handlers of its default code, dialog keys inside a window, chords, keeping the
// keys under G.settings.key_<id>, the rows for the options registry) and the Ctrl tap that switches the view between
// "fixed to the character" and "free" (clean tap only, the chip, the first-start card, Esc, 'drag' mode, a refused
// lock, touch devices and automation untouched, the Ctrl + W guard).
// Usage: node tests/input-bindings.mjs [--json]    exit 0 = all green, 1 = a check failed
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = fs.readFileSync(path.join(ROOT, 'src/game/05-input.js'), 'utf8');
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail: String(detail) }); if (!process.argv.includes('--json')) console.log(`${ok ? '✓' : '✗'} ${name}${detail !== '' ? ' — ' + detail : ''}`); };
const J = (v) => JSON.stringify(v);

/** a page: fake window / document / G around the fragment. opts: { touch, webdriver, search, settings, easy, site } */
function page(opts = {}) {
  const T = { now: 1000, typing: false, blocking: false, timers: [], said: [], toasts: [] };
  const listeners = (o) => { o._l = {}; o.addEventListener = (t, fn) => { (o._l[t] = o._l[t] || []).push(fn); }; o.removeEventListener = () => {}; o.dispatch = (t, e) => { for (const fn of (o._l[t] || []).slice()) fn(e); }; return o; };
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
  vm.runInContext(SRC, ctx, { filename: '05-input.js' });
  const ev = (code, o = {}) => ({ code, key: o.key || code, repeat: !!o.repeat, ctrlKey: !!o.ctrl || /^Control/.test(code) && o.type !== 'keyup', shiftKey: !!o.shift, altKey: !!o.alt, metaKey: !!o.meta, defaultPrevented: false, target: body,
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

// ----------------------------------------------------------------------------------------------- the table
{
  const p = page({ easy: false });
  const L = p.B.list();
  const ids = L.map((a) => a.id);
  const need = ['forward', 'back', 'left', 'right', 'run', 'jump', 'interact', 'mouseToggle', 'lookFaster', 'lookSlower', 'zoomIn', 'zoomOut', 'menu', 'map', 'bag', 'chat', 'photo', 'settings', 'fullscreen'];
  check('bindings.list(): every action the contract names is there', need.every((id) => ids.includes(id)), `${L.length} actions; missing ${J(need.filter((id) => !ids.includes(id)))}`);
  check('defaults: W/↑ · Shift · Space · E · Ctrl · = − · Esc', J(p.B.get('forward')) === J(['KeyW', 'ArrowUp']) && J(p.B.get('run')) === J(['ShiftLeft', 'ShiftRight']) && J(p.B.get('jump')) === J(['Space']) && J(p.B.get('interact')) === J(['KeyE'])
    && J(p.B.get('mouseToggle')) === J(['ControlLeft', 'ControlRight']) && p.B.get('lookFaster').includes('Equal') && p.B.get('lookSlower').includes('Minus') && J(p.B.get('menu')) === J(['Escape']));
  const all = L.flatMap((a) => a.codes);
  check('defaults: no key is used by two actions', new Set(all).size === all.length, `${all.length} keys`);
  check('defaults: no default key is a reserved one (except the fixed Esc)', L.every((a) => a.fixed || a.codes.every((c) => !p.B.reserved(c))));
  check('the old shape still reads: bindings.forward / .jump are the live arrays', Array.isArray(p.B.forward) && p.B.forward[0] === 'KeyW' && p.B.jump[0] === 'Space');
  check('key names for the caps: W · ↑ · Ctrl · Space · +', p.B.name('KeyW') === 'W' && p.B.name('ArrowUp') === '↑' && p.B.name('ControlLeft') === 'Ctrl' && p.B.name('Space') === 'Space' && p.B.name('Equal') === '+' && p.B.label('forward') === 'W · ↑');
  check('every action has a Korean label and a group label', L.every((a) => /[가-힣]/.test(a.label) && /[가-힣]/.test(a.groupLabel)));
  check('nothing is translated while every key is the default', p.B.custom === false && J(p.B._logical('KeyI')) === J(['KeyI']));
  // the rows for the options registry
  const Q = p.G.settingsQueue || [];
  const rows = Q.filter((d) => d.type === 'key');
  check('registry: one row of type key per changeable action (tab controls, default = its keys)', rows.length === L.filter((a) => !a.fixed).length && rows.every((d) => d.tab === 'controls' && d.id === 'key_' + d.action && Array.isArray(d.default) && typeof d.apply === 'function'), `${rows.length} rows`);
}

// ----------------------------------------------------------------------------------------------- rebinding
{
  const p = page({ easy: false });
  let bag = 0, map = 0, advance = 0, dev = 0;
  p.I.onKey('KeyI', () => { bag++; return true; }, { allowInModal: true });
  p.I.onKey('KeyM', () => { map++; return true; });
  p.I.onKey('Space', () => { if (!p.T.blocking) return false; advance++; return true; }, { allowInModal: true });   // a dialogue's "next"
  p.I.onKey('KeyD', (e) => { if (!e.ctrlKey || !e.shiftKey) return false; dev++; return true; }, { allowInModal: true });
  p.press('KeyI');
  check('a handler registered with the default code fires on the default key', bag === 1);
  const r1 = p.B.set('bag', ['KeyU']);
  p.press('KeyU'); p.press('KeyI');
  check('set(bag, [U]): U opens the bag, I does nothing any more', r1.ok && bag === 2 && p.B.custom === true, `${J(r1)} bag ${bag}`);
  check('kept for the next visit under G.settings.key_bag', J(p.G.settings.key_bag) === J(['KeyU']));
  const r2 = p.B.set('bag', ['KeyM']);
  check('a key another action uses is refused, with the other action named', r2.ok === false && r2.reason === 'conflict' && r2.conflicts[0].id === 'map' && /지도/.test(r2.message) && J(p.B.get('bag')) === J(['KeyU']), J(r2));
  const r3 = p.B.set('bag', ['Digit1']), r4 = p.B.set('bag', ['Tab']), r5 = p.B.set('bag', ['AltLeft']), r6 = p.B.set('menu', ['KeyY']), r7 = p.B.set('bag', ['KeyY', 'Banana']), r7b = p.B.set('bag', { length: 1 }), r8 = p.B.set('nope', ['KeyY']);
  check('reserved keys (1 – 9, Tab, Alt …) are refused; Esc is fixed; nonsense and unknown actions are refused', [r3, r4, r5].every((r) => !r.ok && r.reason === 'reserved') && !r6.ok && r6.reason === 'fixed' && !r7.ok && r7.reason === 'invalid' && !r7b.ok && !r8.ok && r8.reason === 'unknown' && J(p.B.get('bag')) === J(['KeyU']), J([r3.reason, r4.reason, r5.reason, r6.reason, r7.reason, r7b.reason, r8.reason]));
  p.B.set('bag', ['KeyU']);
  const r9 = p.B.set('bag', ['KeyU', 'KeyM'], { steal: true });
  check('steal: true takes the key; the other action loses it and is stored too', r9.ok && r9.stolen[0].id === 'map' && p.B.get('map').length === 0 && J(p.G.settings.key_map) === J([]), J(r9));
  map = 0; bag = 0;
  p.press('KeyM');
  check('the stolen key now works for its new action (the second key stands for the same handlers)', bag === 1 && map === 0, `bag ${bag} map ${map}`);
  const r10 = p.B.reset('map');
  check('reset(map): M is back with the map, the bag keeps U', r10.ok && J(p.B.get('map')) === J(['KeyM']) && J(p.B.get('bag')) === J(['KeyU']), `${J(p.B.get('map'))} ${J(p.B.get('bag'))}`);
  // a game action: inside a window its default key is a dialog key again
  const rj = p.B.set('jump', ['KeyV']);
  p.I.reset();
  p.press('KeyV'); const j1 = p.I.consumeJump();
  p.press('Space'); const j2 = p.I.consumeJump();
  check('jump on V: V jumps, Space no longer does', rj.ok && j1 === true && j2 === false, `${j1} ${j2}`);
  p.T.blocking = true;
  p.press('Space'); const a1 = advance; p.press('KeyV'); const a2 = advance;
  check('inside a window Space is the dialog key again (V is not)', a1 === 1 && a2 === 1, `${a1} ${a2}`);
  bag = 0; p.press('KeyU'); const b1 = bag; p.press('KeyI');
  check('a window key keeps its new key inside windows (U closes the bag, I does not)', b1 === 1 && bag === 1, `${b1} ${bag}`);
  p.T.blocking = false;
  // movement follows the binding
  p.B.set('forward', ['KeyT'], { steal: true });
  p.down('KeyT'); p.frame(); const ax1 = { ...p.I.axis }; p.up('KeyT'); p.down('KeyW'); p.frame(); const ax2 = { ...p.I.axis }; p.up('KeyW');
  check('forward on T: the axis follows T, not W; isDown(id) follows too', ax1.y === 1 && ax2.y === 0, `${J(ax1)} ${J(ax2)}`);
  p.down('KeyT'); const d1 = p.B.isDown('forward'); p.up('KeyT');
  check('isDown(forward) while the new key is held', d1 === true && p.B.isDown('forward') === false);
  // chords are never game keys
  p.B.set('right', ['KeyK']);
  p.press('KeyD', { ctrl: true, shift: true });
  check('Ctrl + Shift + D still reaches its handler although D was rebound', dev === 1, dev);
  const eS = p.down('KeyS', { ctrl: true }); p.up('KeyS', { ctrl: true });
  check('Ctrl + a game key does nothing in the browser while playing (default prevented)', eS.defaultPrevented === true);
  // on(id)
  let fs = 0;
  const off = p.B.on('fullscreen', () => { fs++; return true; });
  p.press('KeyF'); p.B.set('fullscreen', ['KeyY']); p.press('KeyY'); p.press('KeyF'); off(); p.press('KeyY');
  check('on(id, fn): fires for the default key, then for the new one, not after off()', fs === 2, fs);
  // capture
  let got = 'none';
  p.B.capture((c) => { got = c; });
  bag = 0;
  const eC = p.down('KeyU'); p.up('KeyU');
  check('capture(): the next key goes to the callback and nowhere else', got === 'KeyU' && bag === 0 && eC.defaultPrevented, `${got} bag ${bag}`);
  p.B.capture((c) => { got = c; }); p.press('Escape');
  check('capture(): Esc cancels (null)', got === null);
  // reset everything
  const rAll = p.B.reset();
  check('reset(): every action has its default keys again and nothing is translated', rAll.ok && p.B.custom === false && p.B.list().every((a) => !a.custom) && J(p.G.settings.key_bag) === J(['KeyI']));
  // persistence: another page with the stored keys
  const q = page({ easy: false, settings: { key_bag: ['KeyU'], key_jump: ['KeyV', 'Digit3', 7, 'KeyV'], key_menu: ['KeyY'], key_map: ['KeyU'] } });
  check('stored keys come back at the start (cleaned: reserved / fixed / doubles / non-keys dropped; a shared key goes to the later row of the table)', J(q.B.get('jump')) === J(['KeyV']) && J(q.B.get('menu')) === J(['Escape']) && J(q.B.get('bag')) === J(['KeyU']) && !q.B.get('map').includes('KeyU'), `${J(q.B.get('jump'))} ${J(q.B.get('map'))} ${J(q.B.get('bag'))}`);
  // the registry's apply and a plain G.setSetting
  const row = (q.G.settingsQueue || []).find((d) => d.id === 'key_photo');
  row.apply(['KeyY']);
  q.G.setSetting('key_help', ['F2']);
  check('the registry row\'s apply() and G.setSetting(key_<id>) both change the keys', J(q.B.get('photo')) === J(['KeyY']) && J(q.B.get('help')) === J(['F2']));
  check('no handler errors were logged', !p.T.errors && !q.T.errors, J(p.T.errors || q.T.errors || ''));
}

// ----------------------------------------------------------------------------------------------- mouse defaults
{
  const n = page({ easy: false }), e = page({ easy: true }), s = page({ easy: true, site: { 'controls.mouse_look_easy': 'walk' } });
  const t = page({ touch: true }), a = page({ webdriver: true }), aq = page({ webdriver: true, search: '?mouselook=lock' });
  check('default on a desktop: the view is fixed to the character (lock) in normal AND easy mode', n.ML.state().mode === 'lock' && e.ML.state().mode === 'lock', `${n.ML.state().mode} / ${e.ML.state().mode}`);
  check('an operator who set the easy-mode default to walk is still obeyed', s.ML.state().mode === 'walk');
  check('touch devices keep drag; automation keeps drag unless ?mouselook asks', t.ML.state().mode === 'drag' && a.ML.state().mode === 'drag' && aq.ML.state().mode === 'lock');
  t.tap(); t.frame(); a.frame();
  check('touch: a Ctrl key does nothing, no chip, no card', t.ML.state().taps === 0 && t.lock.requests === 0 && !t.chip() && !t.coach());
  for (let i = 0; i < 40; i++) { a.T.now += 100; a.frame(); }
  check('automation without a request: no chip and no card (existing suites see nothing new)', !a.chip() && !a.coach() && a.ML.state().active === false);
}

// ----------------------------------------------------------------------------------------------- the Ctrl tap
{
  const p = page({ easy: true });
  for (let i = 0; i < 20; i++) { p.T.now += 100; p.frame(); }
  const card = p.coach();
  const text = card ? card.children.map((c) => c.children.map((x) => x.textContent).join(' ')).join(' ') : '';
  check('first start: the card explains the key in the contract\'s words', !!card && text.includes('Ctrl 키를 누르면 마우스가 풀려요. 한 번 더 누르면 다시 캐릭터를 따라 돌아요.'), text);
  check('the first-start card sits under windows (z 41 < 50): a window that opens covers it', !!card && card.style.zIndex === '41', card ? card.style.zIndex : 'no card');
  check('the card carries a drawn key cap (svg with the key name)', !!card && card.children[0].tagName === 'SVG' && card.children[0].children[0].children.some((n) => n.textContent === 'Ctrl'));
  check('easy mode: the card is read aloud', p.T.said.some((x) => /Ctrl 키를 누르면 마우스가 풀려요/.test(x)), J(p.T.said));
  check('the card is shown once per device', p.store['tfm.v1.ctrlcoach'] === '1');
  check('the chip before the first lock says free and names the key', p.chip()?.textContent === '🖱️ 자유 · Ctrl' && p.chip().dataset.state === 'free', p.chip()?.textContent);
  check('easy mode: the chip is a 56 px tap target with a voice line', p.chip().style.minHeight === '56px' && /Ctrl/.test(p.chip().dataset.say || ''));
  // the first movement key takes the pointer (lock is the default)
  p.down('KeyW'); p.frame();
  check('the first movement key locks the pointer: chip "🖱️ 고정"', p.ML.state().locked && p.chip()?.textContent === '🖱️ 고정', J({ l: p.ML.state().locked, c: p.chip()?.textContent }));
  // a clean tap while walking frees
  p.tap(); p.frame();
  const s1 = p.ML.state();
  check('a tap of Ctrl (W still held) frees the pointer: chip "🖱️ 자유 · Ctrl"', !s1.locked && s1.free === 'ctrl' && p.chip()?.textContent === '🖱️ 자유 · Ctrl', J({ locked: s1.locked, free: s1.free, chip: s1.chip }));
  p.up('KeyW');
  const r0 = p.lock.requests;
  p.press('KeyD'); p.frame();
  p.clickView();
  check('freed with the key: movement keys and a click on the view do not take the pointer again', p.lock.requests === r0 && !p.ML.state().locked, `${p.lock.requests - r0} requests`);
  let clicks = 0; p.G.bus.on('input:click', () => clicks++);
  p.clickView();
  check('… and that click is an ordinary click on the world', clicks === 1, clicks);
  p.tap('ControlRight'); p.frame();
  check('another tap (either Ctrl key) fixes the view again', p.ML.state().locked && p.ML.state().free === null && p.chip()?.textContent === '🖱️ 고정');
  // not a tap
  const st = () => p.ML.state().locked;
  p.down('ControlLeft'); p.T.now += 100; p.press('KeyC', { ctrl: true }); p.T.now += 50; p.up('ControlLeft');
  const c1 = st();
  p.down('ControlLeft'); p.T.now += 900; p.up('ControlLeft');
  const c2 = st();
  p.down('ControlLeft'); p.T.now += 60; p.window.dispatch('pointerdown', { pointerType: 'mouse', isPrimary: true, target: p.body }); p.T.now += 60; p.up('ControlLeft');
  const c3 = st();
  p.down('ControlLeft', { shift: true }); p.T.now += 60; p.up('ControlLeft');
  const c4 = st();
  check('no toggle: another key between · held longer than 600 ms · a click between · with Shift held', c1 && c2 && c3 && c4, J([c1, c2, c3, c4]));
  p.T.blocking = true; p.frame();
  const freedForWindow = !p.ML.state().locked;
  p.tap(); p.frame();
  p.T.blocking = false; p.T.typing = true; p.tap(); p.T.typing = false;
  check('a window frees the pointer by itself; taps inside a window or while typing change nothing', freedForWindow && p.ML.state().free === null && p.ML.state().taps === 2, J(p.ML.state()));
  p.press('KeyW'); p.frame();
  check('after the window the next movement key fixes the view again (not freed by the player)', p.ML.state().locked);
  // Esc (the browser takes the pointer): keys walk free, Ctrl or a press on the view locks
  p.escLock(); p.frame();
  const e1 = p.ML.state();
  const rq = p.lock.requests; p.press('KeyW'); p.frame();
  const keysRelock = p.lock.requests > rq;
  p.clickView(); p.frame();
  const e2 = p.ML.state().locked;
  p.escLock(); p.frame(); p.tap(); p.frame();
  check('Esc frees (free: esc); keys do not take it again, a press on the view does, a tap of Ctrl does', e1.free === 'esc' && e1.userReleased && !keysRelock && e2 && p.ML.state().locked, J({ e1: e1.free, keysRelock, e2, now: p.ML.state().locked }));
  // the card goes after the first tap; coach(true) shows it again
  p.wait(20000);
  const gone = !p.coach();
  p.ML.coach();
  check('the card leaves by itself and mouseLook.coach() shows it again (from 도움말)', gone && !!p.coach());
  // the way the settings window's help tab asks for it: coach({ force }) — above the open window; { force: false } = only the first time
  const z1 = p.coach().style.zIndex; p.coach().remove();
  p.ML.coach({ force: false }); const notAgain = !p.coach();
  p.ML.coach({ force: true }); const again = p.coach();
  check('도움말 shows the card again with coach({ force: true }) above the open window (z 60, a window is 50); coach({ force: false }) keeps "only once"', notAgain && !!again && again.style.zIndex === '60' && z1 === '60', `first ${z1}, again ${again && again.style.zIndex}`);
  // a rebound toggle key
  p.B.set('mouseToggle', ['KeyV']);
  p.frame();
  const lockedBefore = p.ML.state().locked;
  p.tap('KeyV'); p.frame();
  const afterV = p.ML.state();
  p.tap('ControlLeft'); p.frame();
  check('the toggle key can be rebound: V frees, Ctrl no longer does, the chip names V', lockedBefore && !afterV.locked && afterV.chip === '🖱️ 자유 · V' && !p.ML.state().locked, J({ lockedBefore, chip: afterV.chip }));
  // Ctrl + W guard
  const q = page({ easy: false });
  const bu = (pg) => { const e = { preventDefault() { this.p = true; } }; pg.window.dispatch('beforeunload', e); return !!e.p; };
  const calm = bu(q);
  q.down('ControlLeft'); const hot = bu(q); q.up('ControlLeft'); q.T.now += 3000; const later = bu(q);
  check('closing the tab right after Ctrl was down (Ctrl + W while walking) asks first; otherwise never', !calm && hot && !later, J([calm, hot, later]));
}

// ----------------------------------------------------------------------------------------------- drag mode, refused lock
{
  const d = page({ easy: false, settings: { mouseLook: 'drag' } });
  d.frame();
  d.press('KeyW'); d.frame();
  const noLock = d.lock.requests === 0 && d.chip()?.textContent === '🖱️ 자유 · Ctrl';
  d.tap(); d.frame(); d.T.now += 3000; d.frame();
  const held = d.ML.state().locked && d.ML.state().ctrlLock;
  d.tap(); d.frame();
  check('drag mode: keys never lock; a tap of Ctrl locks and it stays; another tap frees', noLock && held && !d.ML.state().locked && !d.ML.state().ctrlLock, J({ noLock, held, s: d.ML.state() }));
  const r = page({ easy: false, refuseLock: true });
  r.frame(); r.press('KeyW');
  await new Promise((res) => setTimeout(res, 5));   // the rejected promise of the fake requestPointerLock
  r.frame();
  const h0 = r.ML.state();
  r.tap(); r.frame();
  const h1 = r.ML.state();
  r.tap(); r.frame();
  const h2 = r.ML.state();
  check('a refused lock: the hover look stands in ("고정"), and the tap switches it off and on', h0.refused && h0.hover && h0.fixed && h0.chip === '🖱️ 고정' && !h1.hover && !h1.fixed && h1.chip === '🖱️ 자유 · Ctrl' && h2.hover && h2.fixed, J({ h0: [h0.refused, h0.hover, h0.chip], h1: [h1.hover, h1.chip], h2: [h2.hover, h2.chip] }));
}

const failed = results.filter((r) => !r.ok);
if (process.argv.includes('--json')) console.log(JSON.stringify({ pass: results.length - failed.length, fail: failed.length, results }, null, 1));
else console.log(`\n${results.length - failed.length} / ${results.length} passed`);
process.exit(failed.length ? 1 : 0);
