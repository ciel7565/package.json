// =============================================================================
// 05-input.js — keyboard / mouse / touch / on-screen d-pad abstraction.
//
//   G.input.axis            {x: -1..1 (right +), y: -1..1 (forward +)}  combined move input
//   G.input.running         Shift held or mobile run toggle
//   G.input.consumeJump()   true once per jump press
//   G.input.consumeLook()   {dx, dy} accumulated camera drag (pixels * sensitivity)
//   G.input.consumeZoom()   accumulated zoom delta (+ = zoom out)
//   G.input.onKey(code, fn, {allowInModal, allowTyping, repeat, onControl})  -> off()
//                           Enter / Space handlers are skipped while a control has keyboard focus unless onControl
//   G.input.keyboardFocus() a button / tab / link was reached with Tab / arrows: it owns Enter / Space
//   G.input.isDown(code)
//   events: 'input:interact' (E / mobile / d-pad center), 'input:click' {x, y, button, target}
//           'input:move-start' (first movement input; cancels click-to-move / sitting)
//   G.input.shieldClicks(ms?)   swallow the browser click that trails the current press (see "ghost clicks")
// Gameplay input is ignored while G.ui.isBlocking() (modal, dialogue, typing...).
//
// [gfx] KEY BINDINGS (CONTRACT §18.2) — G.input.bindings. Every key the client acts on is an ACTION with default
// physical keys (e.code: a Korean input source changes nothing). Fragments keep calling G.input.onKey('KeyI', …) with
// the DEFAULT code; when the player gives an action another key (설정 → 조작), the dispatcher translates: the new key
// fires the handlers of the default one and the old key fires nothing. Nothing is translated until a key was changed.
//   list()                 [{ id, label, group, groupLabel, codes, def, names, fixed, tap, game, custom }] in table order
//   get(id)                the action's current codes (a copy) | null
//   set(id, codes, {steal})  → { ok: true, codes, stolen } | { ok: false, reason: 'conflict' | 'reserved' | 'fixed' |
//                          'invalid' | 'unknown', message (Korean), conflicts: [{ code, id, label }] } — a key that
//                          another action uses is REFUSED unless steal: true (then the other action loses it)
//   reset(id?)             one action (or all) back to its default keys
//   isDown(id)             is one of the action's keys held?
//   on(id, fn, opts)       fn(event) when the action's key goes down (opts as onKey) -> off()
//   name(code)             what to print on a key cap: 'KeyW' → 'W', 'ControlLeft' → 'Ctrl', 'ArrowUp' → '↑'
//   capture(fn)            the next key press goes to fn(code | null) and nowhere else (Esc = null) -> cancel()
//   bindings.forward / .jump / … (every action id) are the live code arrays (read only), as before
// Kept for the next visit under G.settings['key_<id>'] (an array of codes) and declared to the options registry as
// type 'key' (tab controls). Inside a window (G.ui.isBlocking) the keys of game actions (move, jump, interact, chat,
// turn speed, zoom) are plain dialog keys again — Space / Enter / E / arrows always work there, whatever was rebound.
// Keys with Ctrl / Alt / Meta held are never game keys. Emits 'input:bindings' { id, codes }.
//
// [move] DOUBLE TAP → RUN, DASH (CONTRACT §19.3). Two fresh presses of the same direction within the tap window (200 – 450 ms,
// default 300; counted from press to press, timed by the key events' own timeStamp so that a long frame cannot spoil it):
//   forward  → the run latches while that second press stays down (input.running; event 'input:run' {on, via}); letting go
//              of forward ends it. Left / right / back never latch: they give ONE dash (event 'input:dash' {dir: 'left' |
//              'right' | 'back', via, t}) that the player carries out. Key auto-repeat (e.repeat, or a release + press pair
//              closer than 10 ms), a second key of the same direction while one is down, another direction pressed in
//              between, and a press that is still held from before never count. WASD and the arrows alike, through the bindings.
//   Touch: the stick (two quick flicks past 55 %) and the d-pad buttons feed the same detector; the run button stays.
//   input.taps (the pure detector: down / up / reset / held), input.makeTapDetector(windowFn), input.comfort() (the options
//   of the 조작 tab, mode-dependent defaults), input.tapRun (false | 'key' | 'stick' | 'dpad'), input.autoForward /
//   input.setAutoForward(on) (the 'autoForward' key walks on by itself until forward / back is pressed).
//
// Ghost clicks (NEW-1): a touch / pen tap is pointerdown → pointerup → (later) a compatibility `click` that the
// browser hit-tests at the tap point AFTER our handlers ran. When the press itself opened something there (the
// phone 👆 opening a dialogue, a tap on the 3D view opening a picker), that click used to land on the new UI and
// close / skip it. Every primary press is remembered; a trusted pointer click that lands on an element unrelated
// to the pressed one (while the pressed one is still in the page) is swallowed, and controls that act on their
// own (👆 / 점프 / 달리기 / d-pad) swallow their trailing click outright. Keyboard clicks (detail 0) and
// programmatic .click() calls are never touched. The 👆 and the d-pad centre now act on RELEASE (sliding the
// finger off cancels), with touchend.preventDefault() so most browsers do not even send the click.
// =============================================================================
(function () {
  const keys = new Set();
  const handlers = new Map(); // code -> [{fn, opts}]
  const look = { dx: 0, dy: 0 };
  let zoom = 0;
  let jumpQueued = false;
  const joy = { x: 0, y: 0, active: false };
  const dpad = { x: 0, y: 0 };
  let mobileRun = false;
  let tapRun = false;       // [move] the double-tapped run is on: false | 'key' | 'stick' | 'dpad'
  let autoFwd = false;      // [move] the auto-forward key is on
  let wasMoving = false;
  // a finger resting on the joystick / a held d-pad button sends no DOM events, yet the child keeps walking: every
  // HOLD_NOTE_MS the held control re-tells the play counters (03-state playTime, 08-easy healthy play) that there is
  // input — a synthetic pointermove with a button down, exactly what a steering finger produces (R3 seams-lost-9)
  const HOLD_NOTE_MS = 20000;
  const hold = { el: null, id: 0, x: 0, y: 0, last: 0, notes: 0 };
  function noteHold() {
    hold.notes++;
    try { G.save?.noteInput?.(); } catch (e) { /* counters optional */ }
    const el = hold.el;
    if (!el) return;
    try { el.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: hold.id, pointerType: 'touch', buttons: 1, clientX: hold.x, clientY: hold.y })); }
    catch (e) { try { el.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, buttons: 1, clientX: hold.x, clientY: hold.y })); } catch (e2) { /* very old engine */ } }
  }

  const isTouch = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
  const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;

  // ---------------------------------------------------------------- ghost-click shield (see header)
  const GHOST_MS = 900;            // how long after a press its trailing click can still arrive (slow phones ≈ 700 ms)
  const GHOST_PX = 48;             // the trailing click lands where the finger was
  let press = null;                // {el, id, t, x, y, type, shieldUntil, up}
  const ACTIVATION_KEYS = new Set(['Enter', 'NumpadEnter', 'Space']);
  const ARROWS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
  // the element the keyboard moved the focus to (Tab / arrows, incl. the focus traps); cleared by any pointer press
  let navAt = -1e9, navFocus = null;
  document.addEventListener('focusin', (e) => { navFocus = performance.now() - navAt < 400 && e.target instanceof Element ? e.target : null; }, true);
  window.addEventListener('pointerdown', () => { navFocus = null; navAt = -1e9; }, { capture: true, passive: true });
  /** force-swallow the next trusted pointer click of the current press (the control already acted) */
  function shieldPress(ms = GHOST_MS) {
    const now = performance.now();
    if (!press || now - press.t > GHOST_MS * 2) press = { el: null, id: -1, t: now, x: NaN, y: NaN, type: 'any', shieldUntil: 0, up: false };
    press.shieldUntil = now + Math.max(0, Math.min(3000, Number(ms) || GHOST_MS));
  }
  function swallow(e) { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); }
  /** the nearest actionable element around a node (what a click on it activates) */
  const CONTROL_SEL = 'button, a[href], input, select, textarea, summary, label, [data-action], [role="button"], [role="tab"], [role="option"], [role="switch"], [role="menuitem"], [role="radio"], [role="checkbox"], [role="link"]';
  function controlOf(el) { try { return el?.closest?.(CONTROL_SEL) || null; } catch (e) { return null; } }
  function bindGhostShield() {
    if (window._tfmGhostShield) return;
    window._tfmGhostShield = true;
    window.addEventListener('pointerdown', (e) => {
      if (!e.isPrimary) return;
      press = { el: e.target instanceof Element ? e.target : null, id: e.pointerId, t: performance.now(), x: e.clientX, y: e.clientY, type: e.pointerType, shieldUntil: 0, up: false };
    }, { capture: true, passive: true });
    window.addEventListener('pointerup', (e) => { if (press && e.pointerId === press.id) press.up = true; }, { capture: true, passive: true });
    window.addEventListener('pointercancel', (e) => { if (press && e.pointerId === press.id && !(press.shieldUntil > performance.now())) press = null; }, { capture: true, passive: true });
    // capture on window: runs before every other click listener (document capture, delegated actions, the target)
    window.addEventListener('click', (e) => {
      const p = press;
      if (!p || !e.isTrusted || !(e.detail >= 1)) return; // keyboard / programmatic clicks are never ghosts
      const now = performance.now();
      if (now - p.t > GHOST_MS && !(p.shieldUntil > now)) { press = null; return; }
      const t = e.target instanceof Element ? e.target : (e.target?.parentElement || null);
      const near = !Number.isFinite(p.x) || Math.abs(e.clientX - p.x) + Math.abs(e.clientY - p.y) <= GHOST_PX * 2;
      let ghost = false;
      if (p.shieldUntil > now && near) ghost = true;               // a control that acted on press / release
      else if (p.el && p.el.isConnected && t && near && !p.el.contains(t) && !t.contains(p.el)) {
        // the DOM changed under the finger between press and click: a new element took the click — unless both are
        // parts of the same control (a tile's emoji pressed, its label clicked once :active scaled the emoji away)
        const c = controlOf(p.el);
        if (!(c && c === controlOf(t))) {
          const lab = p.el.closest?.('label');
          ghost = !(lab && (lab.control === t || lab.contains(t)));
        }
      }
      if (!ghost) return;
      press = null;
      swallow(e);
      G.log?.debug?.('INPUT', 'ghost click swallowed', { on: String(t?.className || t?.tagName || '').slice(0, 40) });
    }, true);
  }

  /** [controls] look-delta gain: sensitivity × lookSpeed (the + / − keys, §17.1), both finite and in range */
  const lookGain = () => {
    const s = Number(G.settings?.sensitivity), k = Number(G.settings?.lookSpeed);
    return (Number.isFinite(s) && s > 0 ? Math.min(3, s) : 1) * (Number.isFinite(k) && k > 0 ? Math.min(4, Math.max(0.25, k)) : 1);
  };

  // ---------------------------------------------------------------- [gfx] key bindings (see the header)
  // [id, label, group, default codes, flags] — flags: g = game action (its keys are plain dialog keys inside a window),
  // x = fixed (the browser owns the key), t = acts on a clean tap (down and up alone), a = advanced (end of the table)
  const KEY_GROUPS = { move: '움직이기', view: '화면 보기', open: '창 열기', system: '그 밖에' };
  const ACTION_TABLE = [
    ['forward', '앞으로 가기', 'move', ['KeyW', 'ArrowUp'], 'g'],
    ['back', '뒤로 가기', 'move', ['KeyS', 'ArrowDown'], 'g'],
    ['left', '왼쪽으로 가기', 'move', ['KeyA', 'ArrowLeft'], 'g'],
    ['right', '오른쪽으로 가기', 'move', ['KeyD', 'ArrowRight'], 'g'],
    ['run', '달리기 (누른 채 움직이기)', 'move', ['ShiftLeft', 'ShiftRight'], 'g'],
    ['jump', '점프', 'move', ['Space'], 'g'],
    ['interact', '말 걸기 · 살펴보기', 'move', ['KeyE'], 'g'],
    ['autoForward', '앞으로 계속 가기 (켜고 끄기)', 'move', ['KeyK'], 'g'],   // [move]
    ['mouseToggle', '마우스 고정 ↔ 풀기 (한 번 톡)', 'view', ['ControlLeft', 'ControlRight'], 'gt'],
    ['lookFaster', '화면 돌리기 빠르게', 'view', ['Equal', 'NumpadAdd'], 'g'],
    ['lookSlower', '화면 돌리기 느리게', 'view', ['Minus', 'NumpadSubtract'], 'g'],
    ['lookReset', '돌리는 빠르기 처음으로', 'view', ['Digit0', 'Numpad0'], 'g'],
    ['zoomIn', '가까이 보기', 'view', ['KeyZ'], 'g'],
    ['zoomOut', '멀리 보기', 'view', ['KeyX'], 'g'],
    ['fullscreen', '전체 화면 켜고 끄기', 'view', ['KeyF'], ''],
    ['menu', '메뉴 열기 · 창 닫기', 'open', ['Escape'], 'x'],
    ['map', '지도', 'open', ['KeyM'], ''],
    ['bag', '가방', 'open', ['KeyI'], ''],
    ['quest', '할 일', 'open', ['KeyQ', 'KeyL'], ''],
    ['collection', '도감 · 업적', 'open', ['KeyC'], ''],
    ['journal', '작업일지', 'open', ['KeyJ'], ''],
    ['today', '오늘의 체험', 'open', ['KeyN'], ''],
    ['companion', '옹이와 놀기', 'open', ['KeyO'], ''],
    ['chat', '채팅 쓰기', 'open', ['Enter', 'NumpadEnter'], 'g'],
    ['emote', '이모지', 'open', ['KeyT'], ''],
    ['gesture', '몸짓', 'open', ['KeyG'], ''],
    ['photo', '사진 찍기', 'open', ['KeyP'], ''],
    ['help', '도움말', 'open', ['KeyH'], ''],
    ['settings', '설정', 'open', ['F10'], ''],
    ['roomEdit', '방 꾸미기 (내 방에서)', 'system', ['KeyB'], 'a'],
    ['devcenter', '개발자·관리자 센터 (권한이 있을 때)', 'system', ['F9', 'Backquote'], 'a'],
  ];
  const KEYSET = 'key_';        // G.settings key of an action's codes: key_<id> = ['KeyW', 'ArrowUp']
  const MAX_CODES = 3;
  // the physical keys an action may sit on (KeyboardEvent.code of an ordinary keyboard)
  const CODE_RE = /^(Key[A-Z]|Digit\d|Numpad(\d|Add|Subtract|Multiply|Divide|Decimal|Enter)|F([1-9]|1\d|2[0-4])|Arrow(Up|Down|Left|Right)|Space|Enter|Escape|(Shift|Control|Alt|Meta)(Left|Right)|Minus|Equal|Backquote|Bracket(Left|Right)|Semicolon|Quote|Comma|Period|Slash|Backslash|IntlBackslash|Page(Up|Down)|Home|End|Insert|Delete|Backspace|Tab|CapsLock)$/;
  // keys no action may take: the quick picks 1 – 9, the keys every window needs, and the ones the browser / system owns
  const RESERVED_RE = /^(Digit[1-9]|Numpad[1-9]|Tab|Escape|Backspace|Delete|CapsLock|NumLock|ScrollLock|Pause|PrintScreen|ContextMenu|Meta(Left|Right)|OS(Left|Right)|Alt(Left|Right)|F5|F11|F12|Unidentified|Lang\d|Convert|NonConvert|KanaMode|HangulMode|Hanja)$/;
  const MOD_RE = /^(Control|Meta|Alt|OS)(Left|Right)$/;
  const KEY_NAMES = {
    Space: 'Space', Enter: 'Enter', NumpadEnter: '숫자판 Enter', Escape: 'Esc', ShiftLeft: 'Shift', ShiftRight: 'Shift', ControlLeft: 'Ctrl', ControlRight: 'Ctrl',
    ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Equal: '+', Minus: '−', NumpadAdd: '숫자판 +', NumpadSubtract: '숫자판 −', NumpadMultiply: '숫자판 ×', NumpadDivide: '숫자판 ÷', NumpadDecimal: '숫자판 .',
    Backquote: '`', BracketLeft: '[', BracketRight: ']', Semicolon: ';', Quote: '\'', Comma: ',', Period: '.', Slash: '/', Backslash: '\\', PageUp: 'PgUp', PageDown: 'PgDn', Insert: 'Ins',
  };
  /** what to print on a key cap */
  function keyName(code) {
    code = String(code || '');
    if (KEY_NAMES[code]) return KEY_NAMES[code];
    let m = /^Key([A-Z])$/.exec(code); if (m) return m[1];
    m = /^Digit(\d)$/.exec(code); if (m) return m[1];
    m = /^Numpad(\d)$/.exec(code); if (m) return '숫자판 ' + m[1];
    return code;
  }
  const acts = new Map();       // id → { id, label, group, def, codes, game, fixed, tap, adv }
  const keyOwner = new Map();   // code → the action that has it now
  const defOwner = new Map();   // code → the action it belongs to by default
  let keysCustom = false;       // an action is away from its defaults: only then does the dispatcher translate
  let keyWriting = null;        // the G.settings key being written by store() (its settings:changed is our own echo)
  let keyCapture = null;        // bindings.capture(): the next key press goes there
  for (const [id, label, group, def, flags] of ACTION_TABLE) {
    acts.set(id, { id, label, group, def: def.slice(), codes: def.slice(), game: flags.includes('g'), fixed: flags.includes('x'), tap: flags.includes('t'), adv: flags.includes('a') });
    for (const c of def) defOwner.set(c, id);
  }
  const sameCodes = (a, b) => a.length === b.length && a.every((c, i) => c === b[i]);
  function reindexKeys() {
    keyOwner.clear();
    let custom = false;
    for (const A of acts.values()) { for (const c of A.codes) keyOwner.set(c, A.id); if (!sameCodes(A.codes, A.def)) custom = true; }
    keysCustom = custom;
  }
  reindexKeys();
  /** a list of codes made safe: real key codes, no doubles, at most MAX_CODES. null when it is not a list — and, with
   *  strict (a choice made by hand), when one entry is not a key; stored / synced lists just lose such entries */
  function cleanCodes(codes, strict) {
    if (typeof codes === 'string') codes = codes ? [codes] : [];
    if (!Array.isArray(codes)) return null;
    const out = [];
    for (const c of codes) {
      if (typeof c !== 'string' || !CODE_RE.test(c)) { if (strict) return null; continue; }
      if (out.indexOf(c) < 0 && out.length < MAX_CODES) out.push(c);
    }
    return out;
  }
  /** keep an action's keys for the next visit (through the options registry when it knows the row) */
  function storeKeys(id) {
    const A = acts.get(id), key = KEYSET + id, v = A.codes.slice();
    keyWriting = key;
    try {
      const S = G.sys && G.sys.settings;
      if (S && typeof S.set === 'function' && typeof S.has === 'function' && S.has(key)) S.set(key, v, { force: true });
      else if (typeof G.setSetting === 'function') G.setSetting(key, v);
      else if (G.settings) G.settings[key] = v;
    } catch (e) { G.log?.warn?.('INPUT', 'key binding not stored', id, e?.message || e); }
    finally { keyWriting = null; }
  }
  /** give an action its keys. A key another action holds: refused (ok: false) unless steal. → result of bindings.set */
  function assignKeys(id, codes, opts = {}) {
    const A = acts.get(id);
    if (!A) return { ok: false, reason: 'unknown', message: '모르는 동작이에요.' };
    if (A.fixed) return { ok: false, reason: 'fixed', message: `${keyName(A.def[0])} 키는 브라우저가 정해 둔 키라서 바꿀 수 없어요.` };
    const list = cleanCodes(codes, !opts.quiet);
    if (!list) return { ok: false, reason: 'invalid', message: '쓸 수 없는 키예요.' };
    for (const c of list) if (RESERVED_RE.test(c)) return { ok: false, reason: 'reserved', code: c, message: `${keyName(c)} 키는 다른 일에 쓰고 있어서 고를 수 없어요.` };
    const hits = [];
    for (const c of list) { const o = keyOwner.get(c); if (o && o !== id) hits.push({ code: c, id: o, label: acts.get(o).label }); }
    if (hits.length && !opts.steal) return { ok: false, reason: 'conflict', code: hits[0].code, conflicts: hits, message: `${keyName(hits[0].code)} 키는 이미 ‘${hits[0].label}’에 쓰고 있어요.` };
    for (const h of hits) if (acts.get(h.id).fixed) return { ok: false, reason: 'fixed', code: h.code, conflicts: hits, message: `${keyName(h.code)} 키는 바꿀 수 없는 키예요.` };
    const changed = [];
    for (const h of hits) { const B = acts.get(h.id); B.codes = B.codes.filter((c) => c !== h.code); if (changed.indexOf(h.id) < 0) changed.push(h.id); }
    if (!sameCodes(A.codes, list)) { A.codes = list; changed.push(id); }
    if (!changed.length) return { ok: true, codes: A.codes.slice(), stolen: [] };
    reindexKeys();
    for (const k of Array.from(keys)) if (!keyOwner.has(k) && defOwner.has(k)) keys.delete(k);   // a key that just lost its job is not "held"
    if (!opts.quiet) for (const cid of changed) storeKeys(cid);
    for (const cid of changed) { try { G.bus.emit('input:bindings', { id: cid, codes: acts.get(cid).codes.slice() }); } catch (e) { /* bus optional */ } }
    return { ok: true, codes: A.codes.slice(), stolen: hits };
  }
  /** stored / synced keys arrive (start, another device, the registry's reset): the newcomer wins a shared key */
  function adoptKeys(id, codes) {
    const A = acts.get(id);
    if (!A || A.fixed) return;
    const list = cleanCodes(codes);
    if (!list) return;
    const ok = list.filter((c) => !RESERVED_RE.test(c) && !(keyOwner.get(c) && acts.get(keyOwner.get(c)).fixed));
    if (sameCodes(A.codes, ok)) return;
    const before = new Map([...acts.values()].map((x) => [x.id, x.codes.join()]));
    assignKeys(id, ok, { steal: true, quiet: true });
    // the others that lost a key to the newcomer are stored too (their old rows would bring the key back)
    for (const B of acts.values()) if (B.id !== id && before.get(B.id) !== B.codes.join()) storeKeys(B.id);
  }
  /** the default codes a pressed key stands for right now (what onKey handlers are registered under) */
  const _oneCode = [''];
  function logicalCodes(code, e, blocking) {
    if (!keysCustom || (e && (e.ctrlKey || e.metaKey || e.altKey) && !MOD_RE.test(code))) { _oneCode[0] = code; return _oneCode; }
    const out = [];
    const cur = keyOwner.get(code);
    if (cur) { const A = acts.get(cur); if (!(blocking && A.game)) out.push(A.def[Math.min(A.codes.indexOf(code), A.def.length - 1)]); }
    const d = defOwner.get(code);
    if ((!d || (blocking && acts.get(d).game)) && out.indexOf(code) < 0) out.push(code);
    return out;
  }
  const bindings = {
    list() {
      return [...acts.values()].map((A) => ({ id: A.id, label: A.label, group: A.group, groupLabel: KEY_GROUPS[A.group] || '', codes: A.codes.slice(), def: A.def.slice(),
        names: A.codes.map(keyName).filter((n, i, a) => a.indexOf(n) === i), fixed: A.fixed, tap: A.tap, game: A.game, adv: A.adv, custom: !sameCodes(A.codes, A.def) }));
    },
    get(id) { const A = acts.get(id); return A ? A.codes.slice() : null; },
    set(id, codes, opts) { return assignKeys(id, codes, opts || {}); },
    reset(id) {
      if (id != null) { const A = acts.get(id); return A ? assignKeys(id, A.def, { steal: true }) : { ok: false, reason: 'unknown', message: '모르는 동작이에요.' }; }
      for (const A of acts.values()) if (!A.fixed) A.codes = A.def.slice();
      reindexKeys();
      for (const A of acts.values()) { if (A.fixed) continue; storeKeys(A.id); try { G.bus.emit('input:bindings', { id: A.id, codes: A.codes.slice() }); } catch (e) { /* bus optional */ } }
      return { ok: true };
    },
    isDown(id) { const A = acts.get(id); return !!A && A.codes.some((c) => keys.has(c)); },
    on(id, fn, opts) {
      const A = acts.get(id);
      if (!A || typeof fn !== 'function') return () => {};
      const offs = A.def.map((c) => input.onKey(c, fn, opts));
      return () => { for (const o of offs) o(); };
    },
    name: keyName,
    /** the names of an action's keys for a hint: 'W · ↑' */
    label(id) { const A = acts.get(id); return A ? A.codes.map(keyName).filter((n, i, a) => a.indexOf(n) === i).join(' · ') : ''; },
    capture(fn) {
      const c = { fn: typeof fn === 'function' ? fn : null };
      keyCapture = c;
      return () => { if (keyCapture === c) keyCapture = null; };
    },
    get custom() { return keysCustom; },
    groups: KEY_GROUPS, reserved: (code) => RESERVED_RE.test(String(code || '')), MAX: MAX_CODES,
    /** tests: the codes a pressed key stands for (see the header) */
    _logical: (code, e, blocking) => logicalCodes(code, e || null, !!blocking).slice(),
  };
  // the old shape: bindings.forward, bindings.jump … are the live code arrays
  for (const A of acts.values()) Object.defineProperty(bindings, A.id, { get: () => A.codes, enumerable: false });

  // ---------------------------------------------------------------- [move] double tap → run, dash (see the header)
  /** the options of the 조작 tab that decide how moving feels (a value the player never set follows the mode: easy = gentler) */
  const hasSet = (k) => !!G.settings && Object.prototype.hasOwnProperty.call(G.settings, k);
  const easyMv = () => (G.easy ? !!G.easy.on : G.settings?.easyMode !== false);
  const numSet = (k, lo, hi, dNormal, dEasy) => { const v = hasSet(k) ? Number(G.settings[k]) : NaN; return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : (easyMv() ? dEasy : dNormal); };
  const boolSet = (k, dNormal, dEasy = dNormal) => (hasSet(k) && typeof G.settings[k] === 'boolean' ? G.settings[k] : (easyMv() ? dEasy : dNormal));
  const _cf = { alwaysRun: false, tapRun: true, dash: true, tapMs: 300, jumpBufMs: 120, coyoteMs: 100, wallSlide: true, stepAround: true, lowFences: true };
  function comfort() {
    const c = _cf;
    c.alwaysRun = boolSet('alwaysRun', false); c.tapRun = boolSet('tapRun', true); c.dash = boolSet('dashOn', true);
    c.tapMs = numSet('tapWindow', 200, 450, 300, 360); c.jumpBufMs = numSet('jumpBuffer', 0, 200, 120, 180); c.coyoteMs = numSet('coyoteMs', 0, 200, 100, 150);
    c.wallSlide = boolSet('wallSlide', true); c.stepAround = boolSet('stepAround', true); c.lowFences = boolSet('lowFences', true);
    return c;
  }
  /**
   * The double-tap detector as pure logic (no DOM, no clock of its own: every call carries the time of the event).
   *   down(dir, code, t, repeat) → null | { dir } — dir: 'f' | 'b' | 'l' | 'r'; the second FRESH press of a direction ≤ windowMs()
   *       after the first one (press to press) answers { dir }; the press after that starts a new count.
   *   up(dir, code, t)  reset()  held(dir)
   * Never counted: auto-repeat (repeat = true), a key that is already down, a second key of the direction while one is held,
   * a press within 60 ms of the last one (a bounce) or within 10 ms of that key's release (an old X11 repeat pair), a press
   * while another direction was pressed in between, a first press that is older than the window, timestamps that run backwards.
   */
  function makeTapDetector(windowFn) {
    const mk = () => ({ held: new Set(), at: -1e9, pend: false, upAt: new Map() });
    const D = { f: mk(), b: mk(), l: mk(), r: mk() };
    const BOUNCE = 60, PAIR = 10;
    return {
      down(dir, code, t, repeat) {
        const d = D[dir];
        if (!d || repeat || !Number.isFinite(t)) return null;
        if (d.held.has(code)) return null;                       // already down: a repeat the browser did not flag
        const ua = d.upAt.get(code);
        if (ua !== undefined && t - ua >= 0 && t - ua < PAIR) return null;   // release + press pair of one auto-repeat tick
        const was = d.held.size > 0;
        d.held.add(code);
        if (was) return null;                                    // another key of this direction is still down
        for (const k in D) if (k !== dir) D[k].pend = false;     // another direction in between spoils the count
        const gap = t - d.at;
        if (d.pend && gap >= 0 && gap < BOUNCE) return null;     // a bounce of the switch
        if (d.pend && gap >= BOUNCE && gap <= windowFn()) { d.pend = false; return { dir }; }
        d.pend = true; d.at = t;
        return null;
      },
      up(dir, code, t) { const d = D[dir]; if (!d) return; d.held.delete(code); if (Number.isFinite(t)) d.upAt.set(code, t); },
      held(dir) { return !!D[dir] && D[dir].held.size > 0; },
      pending(dir) { return !!D[dir] && D[dir].pend; },
      reset() { for (const k in D) { D[k].held.clear(); D[k].pend = false; D[k].upAt.clear(); } },
    };
  }
  const taps = makeTapDetector(() => comfort().tapMs);
  const DIR_ACTION = { f: 'forward', b: 'back', l: 'left', r: 'right' };
  const DIR_WORD = { b: 'back', l: 'left', r: 'right' };
  function dirOfCode(code) { for (const d in DIR_ACTION) { if (bindings[DIR_ACTION[d]].includes(code)) return d; } return null; }
  function endTapRun() { if (!tapRun) return; tapRun = false; try { G.bus.emit('input:run', { on: false }); } catch (e) { /* bus optional */ } }
  /** one fresh press of a direction (a key, the stick or a d-pad button) → the double tap, if it is one */
  function tapPress(dir, code, t, via) {
    if (!input.gameplay()) return;
    if (!taps.down(dir, code, t, false)) return;
    const C = comfort();
    if (dir === 'f') { if (C.tapRun && !tapRun) { tapRun = via; try { G.bus.emit('input:run', { on: true, via }); } catch (e) { /* bus optional */ } } }
    else if (C.dash) { try { G.bus.emit('input:dash', { dir: DIR_WORD[dir], via, t }); } catch (e) { /* bus optional */ } }
  }
  function setAutoForward(on) {
    on = !!on && input.gameplay();
    if (on === autoFwd) return autoFwd;
    autoFwd = on;
    try { G.bus.emit('input:autoforward', { on }); } catch (e) { /* bus optional */ }
    try { G.ui?.toast?.(on ? `⬆️ 앞으로 계속 가요 · 멈추려면 ${bindings.label('back') || 'S'} 또는 ${bindings.label('autoForward') || 'K'}` : '⏹️ 멈췄어요'); } catch (e) { /* toast optional */ }
    return autoFwd;
  }
  // touch: the stick counts as four keys (a press = it reaches 55 % of its travel in a direction, released below 30 %)
  let stickDir = null;
  function stickTap(t) {
    const mag = Math.hypot(joy.x, joy.y);
    let nd = null;
    if (mag >= (stickDir ? 0.3 : 0.55)) nd = Math.abs(joy.y) >= Math.abs(joy.x) ? (joy.y > 0 ? 'f' : 'b') : (joy.x > 0 ? 'r' : 'l');
    if (nd === stickDir) return;
    if (stickDir) taps.up(stickDir, 'stick', t);
    stickDir = nd;
    if (nd) tapPress(nd, 'stick', t, 'stick');
  }
  function stickEnd(t) { if (stickDir) { taps.up(stickDir, 'stick', t); stickDir = null; } }
  const DPAD_DIR = { up: 'f', down: 'b', left: 'l', right: 'r' };

  const input = {
    keys,
    hasTouch: isTouch,
    touchUI: isTouch && (coarse || Math.min(screen.width, screen.height) < 900),
    enabled: true,
    axis: { x: 0, y: 0 },
    running: false,
    pointerDown: false,
    bindings,
    taps, makeTapDetector, comfort,   // [move] the double-tap detector (pure), its factory and the comfort options
    get tapRun() { return tapRun; },
    get autoForward() { return autoFwd; },
    setAutoForward,
    isDown: (code) => keys.has(code),
    any(list) { return list.some((c) => keys.has(c)); },
    onKey(code, fn, opts = {}) {
      if (!handlers.has(code)) handlers.set(code, []);
      const entry = { fn, opts };
      handlers.get(code).push(entry);
      return () => { const arr = handlers.get(code); const i = arr ? arr.indexOf(entry) : -1; if (i >= 0) arr.splice(i, 1); };
    },
    consumeJump() { const j = jumpQueued; jumpQueued = false; return j; },
    consumeLook() { const r = { dx: look.dx, dy: look.dy }; look.dx = 0; look.dy = 0; return r; },
    consumeZoom() { const z = zoom; zoom = 0; return z; },
    /** gameplay allowed right now? */
    gameplay() { return input.enabled && !G.ui?.isBlocking?.(); },
    /** a button / tab / link was reached with Tab / arrows — Enter / Space then belong to it, not to the game. Focus that
     *  a mouse click left on a HUD button, or that a closing window gives back, does not count (Space still jumps). */
    keyboardFocus() {
      const ae = document.activeElement;
      return !!(ae && ae !== document.body && ae === navFocus && ae.isConnected && ae.matches?.(ACTIVATE_SEL));
    },
    setMobileRun(v) { mobileRun = !!v; document.querySelector('[data-mobile=run]')?.classList.toggle('on', mobileRun); },
    queueJump() { jumpQueued = true; },
    /** swallow the trailing browser click of the press in progress (or of the one that just ended) */
    shieldClicks(ms = GHOST_MS) { shieldPress(ms); },
    reset() { keys.clear(); taps.reset(); tapRun = false; autoFwd = false; look.dx = look.dy = 0; zoom = 0; jumpQueued = false; joy.x = joy.y = 0; dpad.x = dpad.y = 0; input.setMobileRun(false); },

    /** recompute axis; called by the player each frame */
    update() {
      try { ml.tick(); } catch (e) { /* [controls] mouse look must never stop the player */ }
      let x = 0, y = 0;
      if (input.gameplay()) {
        const b = input.bindings;
        if (input.any(b.forward)) y += 1;
        if (input.any(b.back)) y -= 1;
        if (input.any(b.right)) x += 1;
        if (input.any(b.left)) x -= 1;
        x += joy.x + dpad.x; y += joy.y + dpad.y;
        if (autoFwd) y += 1;   // [move] the auto-forward key
      } else {
        taps.reset(); if (autoFwd) setAutoForward(false);   // [move] a window opened: nothing is half-counted, nothing walks on
      }
      const len = Math.hypot(x, y);
      if (len > 1) { x /= len; y /= len; }
      input.axis.x = x; input.axis.y = y;
      // [move] the double-tapped run holds while forward is held; 항상 달리기 turns Shift / the run button into "walk"
      if (tapRun && !(input.gameplay() && (tapRun === 'key' ? input.any(input.bindings.forward) : tapRun === 'stick' ? (joy.active && joy.y > 0.3) : dpad.y > 0))) endTapRun();
      const slow = input.any(input.bindings.run) || mobileRun;
      input.running = input.gameplay() && ((comfort().alwaysRun ? !slow : (slow || Math.hypot(joy.x, joy.y) > 0.92)) || !!tapRun);
      const moving = len > 0.05;
      if (moving && !wasMoving) G.bus.emit('input:move-start');
      wasMoving = moving;
      if (hold.el && (joy.active || dpad.x || dpad.y)) {
        const now = performance.now();
        if (now - hold.last >= HOLD_NOTE_MS) { hold.last = now; noteHold(); }
      }
      return input.axis;
    },
    /** test seam: the held on-screen control and how often it re-told the play counters */
    holdInfo() { return { held: !!hold.el, notes: hold.notes, sinceMs: hold.el ? performance.now() - hold.last : 0 }; },
  };
  G.input = input;
  // [gfx] the keys kept on this device come back (03-state has read the device store), and every action is declared to
  // the options registry as one row of type 'key' (68-settings drains the queue; without it the rows are simply unused)
  {
    for (const A of acts.values()) { const v = G.settings ? G.settings[KEYSET + A.id] : undefined; if (Array.isArray(v) && !A.fixed) adoptKeys(A.id, v); }
    const Q = (G.settingsQueue = G.settingsQueue || []);
    let n = 0;
    for (const A of acts.values()) {
      if (A.fixed) continue;
      Q.push({
        id: KEYSET + A.id, key: KEYSET + A.id, tab: 'controls', group: '키 설정', type: 'key', label: A.label, action: A.id, order: 300 + n++, scope: 'account',
        hint: A.tap ? '이 키를 한 번 톡 누르면 바뀌어요. 다른 키와 함께 누르면 아무 일도 없어요.' : A.game ? '창이 열려 있을 때는 창의 키(Space · Enter · 화살표)가 그대로 일해요.' : '',
        words: '키 단축키 key ' + A.def.map(keyName).join(' '), default: A.def.slice(),
        apply: (v) => { if (keyWriting !== KEYSET + A.id) adoptKeys(A.id, v); },
      });
    }
    G.bus.on('settings:changed', ({ key, value } = {}) => {
      if (typeof key !== 'string' || key.indexOf(KEYSET) !== 0 || key === keyWriting) return;
      const id = key.slice(KEYSET.length);
      if (acts.has(id) && Array.isArray(value)) adoptKeys(id, value);
    });
  }
  // [move] the auto-forward key (a plain toggle; the dispatcher already translates a rebound key)
  bindings.on('autoForward', () => { setAutoForward(!autoFwd); return false; });
  // [move] the comfort options of the 조작 tab (CONTRACT §19.3): declared here, drained by 68-settings (queue); a value the
  // player never set follows the mode (easy mode = the gentler side), see comfort()
  {
    const Q = (G.settingsQueue = G.settingsQueue || []);
    const grp = '달리기 · 대시 · 편의';
    Q.push(
      { id: 'tapRun', tab: 'controls', group: grp, type: 'toggle', label: '🏃 앞으로 두 번 눌러 달리기', hint: '앞으로 가는 키를 두 번 톡톡 누르고 두 번째에서 손을 떼지 않으면 달려요. 키에서 손을 떼면 걸어요. Shift로도 달릴 수 있어요.', default: true, order: 200, words: '달리기 더블탭 두번 달려 run' },
      { id: 'dashOn', tab: 'controls', group: grp, type: 'toggle', label: '💨 옆·뒤로 두 번 눌러 대시', hint: '왼쪽·오른쪽·뒤로 가는 키를 두 번 누르면 그쪽으로 휙 한 번 물러나요. 계속 눌러도 달리지는 않아요.', default: true, order: 201, words: '대시 회피 더블탭 dash' },
      { id: 'tapWindow', tab: 'controls', group: grp, type: 'slider', label: '⏱️ 두 번 누르는 간격', hint: '이 시간 안에 두 번 누르면 한 묶음이에요. 길수록 천천히 눌러도 돼요. (쉬운 모드는 처음에 360)', min: 200, max: 450, step: 10, unit: '밀리초', default: 300, order: 202, words: '더블탭 간격 시간' },
      { id: 'alwaysRun', tab: 'controls', group: grp, type: 'toggle', label: '🏃‍♀️ 항상 달리기', hint: '켜면 늘 달려요. 이때 Shift(또는 달리기 단추)를 누르면 걸어요.', default: false, order: 203, words: '자동 달리기 항상 run' },
      { id: 'jumpBuffer', tab: 'controls', group: grp, type: 'slider', label: '🦘 점프 미리 누르기', hint: '땅에 닿기 조금 전에 점프를 눌러도 닿자마자 뛰어요. (쉬운 모드는 처음에 180)', min: 0, max: 200, step: 10, unit: '밀리초', default: 120, order: 204, words: '점프 버퍼 입력' },
      { id: 'coyoteMs', tab: 'controls', group: grp, type: 'slider', label: '🪂 낭떠러지 끝에서 뛰기', hint: '땅 끝을 막 벗어난 뒤에도 이 시간 동안은 점프가 돼요. (쉬운 모드는 처음에 150)', min: 0, max: 200, step: 10, unit: '밀리초', default: 100, order: 205, words: '코요테 점프 유예' },
      { id: 'wallSlide', tab: 'controls', group: grp, type: 'toggle', label: '🧱 벽을 따라 미끄러지기', hint: '비스듬히 벽이나 모서리에 닿아도 멈추지 않고 벽을 따라 돌아 가요.', default: true, order: 206, words: '벽 미끄러짐 모서리' },
      { id: 'stepAround', tab: 'controls', group: grp, type: 'toggle', label: '🪨 작은 것 비켜 가기', hint: '길에 작은 돌이나 항아리가 있으면 살짝 비켜서 지나가요.', default: true, order: 207, words: '장애물 우회 비켜' },
      { id: 'lowFences', tab: 'controls', group: grp, type: 'toggle', label: '🌾 달릴 때 낮은 울타리 넘기', hint: '달리다가 낮은 울타리나 돌담을 만나면 점프하지 않아도 훌쩍 넘어가요. (쉬운 모드는 처음부터 켜져 있어요)', default: true, order: 208, words: '울타리 자동 넘기 vault' },
      { id: 'runFree', tab: 'controls', group: grp, type: 'info', label: '🍃 달려도 힘이 들지 않아요', hint: '', order: 209, words: '달리기 힘 피로', render: (el) => { el.textContent = '달리기와 대시는 아무것도 줄어들게 하지 않아요. 힘이 떨어지거나 느려지는 일이 없어요.'; } },
    );
  }
  // every profile starts with clean input: no held keys, no 달리기 toggle left on by the previous child
  for (const ev of ['game:logout', 'game:login']) G.bus.on(ev, () => input.reset());
  if (input.touchUI) document.body?.classList.add('is-touch');
  else if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => { if (input.touchUI) document.body.classList.add('is-touch'); });

  // ---------------------------------------------------------------- [controls] mouse look without a button (§17.1)
  // G.settings.mouseLook: 'auto' (the site default per mode) | 'lock' | 'walk' | 'drag'
  //   lock  pointer lock: the first movement key or a click on the 3D view captures the pointer; moving the mouse turns
  //         the view (yaw + pitch); a centre dot and the chip "Esc: 마우스 풀기 · + / −: 회전 속도" show; any modal,
  //         panel, dialogue, chat field or the grown-up gate (G.ui.isBlocking) releases it at once, the next movement key
  //         or click on the view takes it again (after Esc: only a click on the view — the keys walk with a free pointer)
  //   walk  the same, but only while a movement key is held (+ 1.2 s): standing still frees the pointer for the buttons
  //   drag  the old behaviour (press and drag); touch devices always
  // Where pointer lock is refused (pointerlockerror / no API) the fallback is HOVER LOOK: mousemove deltas over the view
  // with no button down, plus slow turning while the pointer rests in the outer 6 % of the view.
  // Defaults [gfx, §18.0]: fine pointer + keyboard → 'lock' in BOTH modes — the view is fixed to the character
  // (operator settings controls.mouse_look_normal / _easy through G.site still decide where they are set); touch →
  // 'drag'; automation (navigator.webdriver) → 'drag' unless ?mouselook=lock|walk|drag asks otherwise.
  // THE CTRL TAP [gfx, §18.2]: Control pressed and let go ALONE within 600 ms (no other key, no click between) switches
  //   locked ↔ free. Free by Ctrl stays free — the keys walk, a click on the view is an ordinary click, dragging turns —
  //   until Ctrl is tapped again (or the chip is pressed). Free by Esc (the browser took the pointer): Ctrl or a press
  //   on the view locks again. 'drag' mode: a tap locks for as long as the player wants, another frees. Where the lock is
  //   refused the tap switches the hover look on / off. A chip shows the state — "🖱️ 고정" / "🖱️ 자유 · Ctrl" — and the
  //   first start explains the key with a drawn key cap (read aloud in easy mode; mouseLook.coach(true) shows it again).
  //   Touch devices: nothing of this exists. Automation without ?mouselook / setMode: no chip, no card.
  // TEST SEAM G.input.mouseLook: state() → {mode, pref, locked, free, requests, exits, refused, hover, walking,
  //   userReleased, lastReason, chip, taps}; feed(dx, dy) adds raw mouse deltas exactly as a locked mousemove does;
  //   setApi({request(el), exit(), element()}) replaces requestPointerLock / exitPointerLock /
  //   document.pointerLockElement (call lockChanged() from the fakes); refuse() simulates a refused lock; refresh()
  //   re-reads the mode; toggle() is what a clean Ctrl tap does; coach(force) shows the card.
  const LOOK_MODES = ['lock', 'walk', 'drag'];
  const qLook = (() => { try { const v = new URLSearchParams(location.search).get('mouselook'); return LOOK_MODES.includes(v) ? v : null; } catch (e) { return null; } })();
  const finePointer = (() => { try { return !!(window.matchMedia && window.matchMedia('(pointer: fine)').matches); } catch (e) { return false; } })();
  const WALK_HOLD_MS = 1200, EDGE = 0.06, EDGE_PX_S = 260, LOCK_GAIN = 1, TAP_MS = 600;
  const autoRun = (() => { try { return !!navigator.webdriver; } catch (e) { return false; } })();
  const easyNow = () => (G.easy ? !!G.easy.on : G.settings?.easyMode !== false);
  const ml = {
    _mode: null, locked: false, requests: 0, exits: 0, refused: false, userReleased: false, walkUntil: 0, lastReason: '',
    free: null,        // [gfx] null | 'ctrl' (the player freed the pointer with the key) | 'esc' (the browser took it back)
    ctrlLock: false,   // [gfx] 'drag' mode: locked by a tap of the key (kept until the next tap)
    taps: 0,
    _ours: false, _edgeT: 0, _px: NaN, _py: NaN, _over: false, _dot: null, _chip: null, _coach: null, _coachT: 0, _tap: null, _playT: 0,
    api: {
      request(el) { const r = el?.requestPointerLock?.(); if (r && typeof r.catch === 'function') r.catch(() => ml._refused('promise')); return !!el?.requestPointerLock; },
      exit() { try { document.exitPointerLock?.(); } catch (e) { /* ignore */ } },
      element() { return document.pointerLockElement || null; },
    },
    el() { return document.getElementById('game-container'); },
    /** the user's / site's preference before the device rules */
    pref() {
      if (qLook) return qLook;
      const s = G.settings?.mouseLook;
      if (LOOK_MODES.includes(s)) return s;
      const site = easyNow() ? G.site?.get?.('controls.mouse_look_easy', 'lock') : G.site?.get?.('controls.mouse_look_normal', 'lock');
      return LOOK_MODES.includes(site) ? site : 'lock';   // [gfx] §18.0: fixed to the character in both modes
    },
    /** the effective mode on this device right now (useQuery false: what it would be without ?mouselook / a test) */
    mode(useQuery = true) {
      if (useQuery && ml._force) return ml._force;
      if (useQuery && qLook) return qLook;
      if (input.touchUI && !finePointer) return 'drag';
      if (autoRun) return 'drag';
      return ml.pref();
    },
    /** [gfx] a mouse and a keyboard (not a touch screen): the key, the chip and the card exist here */
    desktop() { return !(input.touchUI && !finePointer); },
    /** … and under automation only when a test asked for a mode (existing suites see no new chip, no card) */
    active() { return ml.desktop() && (!autoRun || !!ml._force || !!qLook); },
    isLocked() { const el = ml.el(); return !!el && ml.locked && ml.api.element() === el; },
    /** [gfx] "fixed to the character", as the chip says it: the pointer is locked, or the hover look stands in for it */
    fixed() { return ml.isLocked() || (ml.refused && !ml.free && ml.mode() === 'lock'); },
    isMoveKey(code) { const b = input.bindings; return b.forward.includes(code) || b.back.includes(code) || b.left.includes(code) || b.right.includes(code); },
    moving() { const b = input.bindings; return input.any(b.forward) || input.any(b.back) || input.any(b.left) || input.any(b.right); },
    /** ask for the pointer (true when a request went out) */
    request(reason) {
      const m = ml.mode();
      if ((m === 'drag' && !ml.ctrlLock) || ml.refused || ml.isLocked() || !input.gameplay()) return false;
      if (reason === 'click' && ml.free === 'ctrl') return false;   // freed on purpose: a click on the view is a click
      const el = ml.el();
      if (!el) return false;
      ml.requests++; ml.lastReason = 'request:' + reason;
      let ok = false;
      try { ok = ml.api.request(el) !== false; } catch (e) { ok = false; }
      if (!ok) { ml._refused('api'); return false; }
      return true;
    },
    release(reason) {
      if (!ml.isLocked()) return false;
      ml.exits++; ml.lastReason = 'release:' + reason; ml._ours = true;
      try { ml.api.exit(); } catch (e) { /* ignore */ }
      if (ml.api.element() !== ml.el()) ml.lockChanged();
      return true;
    },
    onMoveKey() {
      if (ml.mode() === 'walk') ml.walkUntil = performance.now() + WALK_HOLD_MS;
      if (ml.free === 'ctrl') return;                          // freed with the key: the keys walk, the pointer stays free
      if (ml.userReleased && ml.mode() !== 'walk') return;     // Esc: only the key or a press on the view takes it again
      if (!ml.isLocked()) ml.request('key');
    },
    /** [gfx] what a clean tap of the key does: fixed ↔ free (see the header) → fixed now? */
    toggle(why = 'ctrl') {
      if (!ml.desktop()) return false;
      ml.taps++;
      const m = ml.mode();
      if (ml.fixed()) {
        ml.free = 'ctrl'; ml.userReleased = false; ml.ctrlLock = false;
        if (ml.isLocked()) ml.release(why);
        ml.lastReason = 'free:' + why;
      } else {
        ml.free = null; ml.userReleased = false;
        if (m === 'drag') ml.ctrlLock = true;
        if (m === 'walk') ml.walkUntil = performance.now() + WALK_HOLD_MS;
        if (ml.refused) ml.lastReason = 'hover:' + why; else ml.request(why);
      }
      if (ml._coach) { clearTimeout(ml._coachT); ml._coachT = setTimeout(() => ml._coachClose(), 1600); }   // learned: the card may go
      ml._ui();
      const fixed = ml.fixed();
      G.bus.emit('input:mouse-toggle', { fixed, free: ml.free, why });
      return fixed;
    },
    /** pointerlockchange (real or from a fake API) */
    lockChanged() {
      const el = ml.el(), now = !!el && ml.api.element() === el;
      if (now === ml.locked) { ml._ours = false; return; }
      ml.locked = now;
      if (now) { ml.userReleased = false; ml.free = null; ml.everLocked = true; ml.coach(); }
      else if (!ml._ours) { ml.userReleased = true; ml.ctrlLock = false; if (ml.free !== 'ctrl') ml.free = 'esc'; }   // Esc / the browser took it back: keys no longer re-take it
      ml._ours = false;
      ml._ui();
      G.bus.emit('input:pointer-lock', { locked: now, mode: ml.mode(), free: ml.free });
    },
    _refused(why) {
      if (ml.refused) return;
      // a lock that worked before and fails now is transient (the browser's cool-down right after Esc, no gesture):
      // stay unlocked, the next movement key / click asks again — only a device that never locked gets hover look
      if (ml.everLocked && why !== 'test') { ml.lastReason = 'retry:' + why; return; }
      ml.refused = true; ml.lastReason = 'refused:' + why;
      G.log?.warn?.('INPUT', 'pointer lock refused: hover look instead', { why });
      ml._ui();
    },
    /** hover-look fallback active right now? (refused lock, lock / walk mode, walk: only while moving; never while freed) */
    hover() {
      const m = ml.mode();
      if (!ml.refused || m === 'drag' || ml.free === 'ctrl' || !input.gameplay()) return false;
      return m === 'lock' || performance.now() < ml.walkUntil || ml.moving();
    },
    /** add raw mouse deltas (px) to the view, as a locked mousemove does */
    feed(dx, dy) {
      if (!Number.isFinite(dx) || !Number.isFinite(dy)) return;
      const s = lookGain() * LOCK_GAIN;
      look.dx += G.util.clamp(dx, -400, 400) * s;
      look.dy += G.util.clamp(dy, -400, 400) * s * (G.settings?.invertY ? -1 : 1);
    },
    /** every frame (input.update): release on any blocking UI, walk-mode timeout, hover edge turning, chip and card */
    tick() {
      const now = performance.now();
      if (ml.isLocked()) {
        if (!input.gameplay() || G.ui?.isBlocking?.() || G.util?.isTyping?.()) ml.release('ui');
        else if (ml.mode() === 'walk') { if (ml.moving()) ml.walkUntil = now + WALK_HOLD_MS; else if (now > ml.walkUntil) ml.release('walk'); }
        else if (ml.mode() === 'drag' && !ml.ctrlLock) ml.release('mode');
      } else if (ml.locked) ml.lockChanged();   // lost without an event (tab switch)
      const dt = Math.min(0.1, Math.max(0, (now - (ml._edgeT || now)) / 1000));
      ml._edgeT = now;
      if (ml._over && ml.hover() && !input.pointerDown && Number.isFinite(ml._px)) {
        const el = ml.el(), r = el?.getBoundingClientRect?.();
        if (r && r.width > 40 && r.height > 40) {
          const u = (ml._px - r.left) / r.width, v = (ml._py - r.top) / r.height;
          const ex = u < EDGE ? -1 : u > 1 - EDGE ? 1 : 0, ey = v < EDGE ? -1 : v > 1 - EDGE ? 1 : 0;
          if (ex || ey) ml.feed(ex * EDGE_PX_S * dt, ey * EDGE_PX_S * 0.5 * dt);
        }
      }
      if (ml._dot && !ml._dot.hidden !== ml.isLocked()) ml._ui();
      else if (now - (ml._chipAt || 0) > 150) { ml._chipAt = now; ml._chipSync(); }   // (the chip follows windows opening and closing; state changes sync it at once)
      // the first calm moment of the first game on this device: the card that explains the key (1.5 s of play first)
      if (!ml._coachTried && ml.active()) {
        // (wall-clock time: on a slow device frames are long and the clamped dt would stretch 1.5 s into half a minute)
        if (G.state && G.ready && input.gameplay() && !G.sys?.manjangdae?.introActive) { if (!ml._playT) ml._playT = now; else if (now - ml._playT > 1500) { ml._coachTried = true; ml.coach(); } }
        else ml._playT = 0;
      }
    },
    // ---- the centre dot, the state chip, the first-time coach card (inline styles: no stylesheet of our own)
    _ui() {
      if (!document.body) return;
      const on = ml.isLocked();
      if (on && !ml._dot) {
        const dot = document.createElement('div');
        dot.id = 'ml-dot'; dot.setAttribute('aria-hidden', 'true');
        Object.assign(dot.style, { position: 'fixed', left: '50%', top: '50%', width: '6px', height: '6px', margin: '-3px 0 0 -3px', borderRadius: '50%', background: 'rgba(255,250,235,0.92)', boxShadow: '0 0 0 1.5px rgba(40,28,14,0.55)', pointerEvents: 'none', zIndex: '40' });
        document.body.appendChild(dot);
        ml._dot = dot;
      }
      if (ml._dot) ml._dot.hidden = !on;
      ml._chipSync();
    },
    /** [gfx] the chip "🖱️ 고정" / "🖱️ 자유 · Ctrl": in a running game on a desktop, never over a window or the photo view */
    _chipWanted() {
      if (!ml.active() || !G.state || !input.enabled || !document.body) return false;
      if (G.ui?.isBlocking?.() || document.body.classList.contains('hud-hidden')) return false;
      return true;
    },
    _chipSync() {
      const c0 = ml._chip;
      if (!ml._chipWanted()) { if (c0 && !c0.hidden) c0.hidden = true; return; }
      const fixed = ml.fixed(), easy = easyNow(), k = keyName(input.bindings.mouseToggle[0] || '');
      const key = (fixed ? 'f' : 'r') + (easy ? 'e' : 'n') + k;
      let c = c0;
      if (!c) {
        c = document.createElement('button');
        c.id = 'ml-chip'; c.type = 'button';
        Object.assign(c.style, { position: 'fixed', left: '50%', bottom: '86px', transform: 'translateX(-50%)', borderRadius: '999px', border: '0', background: 'rgba(32,24,16,0.72)', color: '#fff8e6', zIndex: '40', whiteSpace: 'nowrap', cursor: 'pointer' });
        // a press on the chip fixes the view again (a pointer gesture: the browser allows the lock)
        c.addEventListener('click', () => { try { c.blur(); } catch (e) { /* ignore */ } if (!ml.fixed()) ml.toggle('chip'); });
        document.body.appendChild(c);
        ml._chip = c;
      }
      if (c.hidden) c.hidden = false;
      // sit 8 px above the bottom bar wherever it is (its height changes with easy mode and the UI size)
      const bar = document.getElementById('bottom-bar'), br = bar && !bar.hidden ? bar.getBoundingClientRect() : null;
      const bottom = br && br.height > 0 && br.top > innerHeight * 0.5 ? Math.round(innerHeight - br.top + 8) + 'px' : '86px';
      if (c.style.bottom !== bottom) c.style.bottom = bottom;
      if (c._key === key) return;
      c._key = key;
      c.textContent = fixed ? '🖱️ 고정' : (k ? `🖱️ 자유 · ${k}` : '🖱️ 자유');
      c.dataset.state = fixed ? 'fixed' : 'free';
      const say = fixed ? `마우스가 캐릭터를 따라 돌아요.${k ? ` ${k} 키를 누르면 마우스가 풀려요.` : ''}` : `마우스가 풀려 있어요. ${k ? `${k} 키를 누르거나 ` : ''}여기를 누르면 다시 캐릭터를 따라 돌아요.`;
      c.dataset.say = say; c.title = say; c.setAttribute('aria-label', say); c.setAttribute('aria-pressed', String(fixed));
      Object.assign(c.style, { pointerEvents: fixed ? 'none' : 'auto', padding: easy ? '0 22px' : '6px 14px', minHeight: easy ? '56px' : '0', minWidth: easy ? '56px' : '0', font: `600 ${easy ? 18 : 13}px/1.3 system-ui, sans-serif`, opacity: fixed ? '0.82' : '1' });
    },
    /** the drawn key cap (with a little mouse) for the card */
    _keyPicture(k) {
      const NS = 'http://www.w3.org/2000/svg';
      const mk = (tag, attrs, text) => { const n = document.createElementNS(NS, tag); for (const a in attrs) n.setAttribute(a, attrs[a]); if (text != null) n.textContent = text; return n; };
      const svg = mk('svg', { viewBox: '0 0 168 72', width: '168', height: '72', 'aria-hidden': 'true', focusable: 'false' });
      svg.style.flex = '0 0 auto';
      const cap = mk('g', {});
      cap.append(mk('rect', { x: 6, y: 12, width: 84, height: 54, rx: 11, fill: '#6b4f2c' }),
        mk('rect', { x: 10, y: 10, width: 76, height: 46, rx: 9, fill: '#fffaf0', stroke: '#c9a45c', 'stroke-width': 2 }),
        mk('text', { x: 48, y: 41, 'text-anchor': 'middle', 'font-family': 'system-ui, sans-serif', 'font-weight': 800, 'font-size': k.length > 5 ? 15 : 21, fill: '#3b2a17' }, k));
      if (!G.settings?.reduceMotion && !G.osReducedMotion?.()) {
        // one calm press every 1.8 s (0.55 Hz): the cap goes down a little and comes back
        cap.append(mk('animateTransform', { attributeName: 'transform', type: 'translate', values: '0 0; 0 0; 0 4; 0 0', keyTimes: '0; 0.55; 0.72; 1', dur: '1.8s', repeatCount: 'indefinite' }));
      }
      const arrow = mk('path', { d: 'M100 36 h18 m-7 -7 l7 7 l-7 7', fill: 'none', stroke: '#8a6a3a', 'stroke-width': 3.5, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' });
      const mouse = mk('g', {});
      mouse.append(mk('rect', { x: 130, y: 10, width: 30, height: 50, rx: 15, fill: '#fffaf0', stroke: '#3b2a17', 'stroke-width': 2.5 }),
        mk('line', { x1: 145, y1: 10, x2: 145, y2: 30, stroke: '#3b2a17', 'stroke-width': 2 }),
        mk('rect', { x: 142.5, y: 16, width: 5, height: 9, rx: 2.5, fill: '#d98a2b' }));
      svg.append(cap, arrow, mouse);
      return svg;
    },
    _coachClose() {
      clearTimeout(ml._coachT); ml._coachT = 0;
      const c = ml._coach;
      ml._coach = null;
      if (c) { try { c.remove(); } catch (e) { /* gone */ } }
    },
    /** [gfx] the card "Ctrl 키를 누르면 마우스가 풀려요 …": once per device (force: again, from 도움말) → shown? */
    coach(force) {
      const KEY = 'tfm.v1.ctrlcoach';
      if (!force) {
        if (!ml.active() || ml._coachShown) return false;
        try { if (localStorage.getItem(KEY)) { ml._coachShown = true; return false; } localStorage.setItem(KEY, '1'); } catch (e) { /* storage blocked: once per page */ }
      }
      if (!ml.desktop() || !document.body) return false;
      ml._coachShown = true; ml._coachTried = true;
      ml._coachClose();
      const easy = easyNow(), k = keyName(input.bindings.mouseToggle[0] || 'ControlLeft');
      const text = `${k} 키를 누르면 마우스가 풀려요. 한 번 더 누르면 다시 캐릭터를 따라 돌아요.`;
      const card = document.createElement('div');
      card.id = 'ml-coach'; card.setAttribute('role', 'status'); card.dataset.say = text;
      Object.assign(card.style, { position: 'fixed', left: '50%', top: '16%', transform: 'translateX(-50%)', display: 'flex', alignItems: 'center', gap: '16px', maxWidth: 'min(560px, 92vw)', padding: '16px 20px', borderRadius: '18px', background: 'rgba(253,246,228,0.97)', color: '#3b2a17', font: `700 ${easy ? 19 : 16}px/1.5 system-ui, sans-serif`, boxShadow: '0 10px 30px rgba(0,0,0,0.28)', zIndex: force ? '60' : '41', pointerEvents: 'none' });
      const words = document.createElement('div');
      const head = document.createElement('div');
      head.textContent = '🖱️ 마우스를 움직이면 화면이 돌아가요';
      Object.assign(head.style, { fontSize: easy ? '15px' : '13px', fontWeight: '600', opacity: '0.72', marginBottom: '4px' });
      const line = document.createElement('div');
      line.className = 'ml-coach-text'; line.textContent = text;
      words.append(head, line);
      card.append(ml._keyPicture(k), words);
      document.body.appendChild(card);
      ml._coach = card;
      if (easy) { try { G.easy?.say?.(text, { force: true, priority: 1 }); } catch (e) { /* voice optional */ } }
      ml._coachT = setTimeout(() => ml._coachClose(), easy ? 14000 : 10000);
      return true;
    },
  };
  input.mouseLook = {
    state() {
      return { mode: ml.mode(), defaultMode: ml.mode(false), pref: ml.pref(), locked: ml.isLocked(), fixed: ml.fixed(), free: ml.free, ctrlLock: ml.ctrlLock, taps: ml.taps,
        requests: ml.requests, exits: ml.exits, refused: ml.refused, hover: ml.hover(), walking: performance.now() < ml.walkUntil, userReleased: ml.userReleased, lastReason: ml.lastReason,
        coach: !!ml._coach, chip: ml._chip && !ml._chip.hidden ? ml._chip.textContent : '', active: ml.active(), query: qLook };
    },
    feed: (dx, dy) => ml.feed(dx, dy),
    setApi(api) { if (api && typeof api === 'object') { for (const k of ['request', 'exit', 'element']) if (typeof api[k] === 'function') ml.api[k] = api[k]; } ml.lockChanged(); },
    lockChanged: () => ml.lockChanged(),
    refuse: () => ml._refused('test'),
    /** tests: force a mode ('lock' | 'walk' | 'drag'; null = back to the rules) */
    setMode(m) { ml._force = LOOK_MODES.includes(m) ? m : null; return input.mouseLook.refresh(); },
    refresh() { ml.userReleased = false; ml.refused = false; ml.free = null; ml.ctrlLock = false; if (ml.isLocked() && ml.mode() === 'drag') ml.release('mode'); ml._ui(); return ml.mode(); },
    release: (why) => ml.release(why || 'api'),
    /** [gfx] what a clean tap of the Ctrl key does (also for a button of the settings window) → fixed now? */
    toggle: (why) => ml.toggle(why || 'api'),
    /** [gfx] fixed to the character right now? */
    fixed: () => ml.fixed(),
    /** [gfx] show the card that explains the key (force = true: again, from 도움말) */
    coach: (o) => ml.coach(o && typeof o === 'object' ? !!o.force : o !== false),   // coach() / coach(true) / coach({ force: true }) show it again (도움말); coach({ force: false }) = only the first time
    modes: LOOK_MODES.slice(),
  };
  document.addEventListener('pointerlockchange', () => ml.lockChanged());
  document.addEventListener('pointerlockerror', () => ml._refused('error'));
  document.addEventListener('mousemove', (e) => {
    const el = ml.el();
    if (ml.isLocked()) { ml.feed(Number(e.movementX) || 0, Number(e.movementY) || 0); return; }
    const over = !!el && e.target instanceof Node && el.contains(e.target);
    // hover look: movementX / Y where the browser gives them, else the change of the pointer position
    const mx = Number(e.movementX) || 0, my = Number(e.movementY) || 0, px = ml._px, py = ml._py;
    const dx = mx || my ? mx : (Number.isFinite(px) ? e.clientX - px : 0), dy = mx || my ? my : (Number.isFinite(py) ? e.clientY - py : 0);
    const was = ml._over;
    ml._over = over; ml._px = e.clientX; ml._py = e.clientY;
    if (over && was && e.buttons === 0 && ml.hover()) ml.feed(dx, dy);
  }, { passive: true });
  // any typing field that takes the focus (chat, forms) releases the pointer at once
  document.addEventListener('focusin', (e) => { if (ml.isLocked() && G.util?.isTyping?.()) ml.release('typing'); }, true);
  G.bus.on('settings:changed', ({ key } = {}) => { if (key === 'mouseLook' || key === 'easyMode') input.mouseLook.refresh(); });
  // [gfx] the tap of the key: down and up of it alone within TAP_MS (called from the keyboard listeners below)
  let ctrlAt = -1e9;   // when a Control key was last seen down (see the beforeunload guard)
  // when the key really went down / up: the event's own time (a long frame delays the handling of both, not the press)
  const evT = (e) => (e && Number.isFinite(e.timeStamp) && e.timeStamp > 0 ? e.timeStamp : performance.now());
  function tapDown(e) {
    if (e.ctrlKey || /^Control/.test(e.code)) ctrlAt = performance.now();
    if (input.bindings.mouseToggle.includes(e.code)) {
      if (e.repeat) return;
      const chord = e.altKey || e.metaKey || (e.shiftKey && !/^Shift/.test(e.code)) || (e.ctrlKey && !/^Control/.test(e.code));
      ml._tap = chord ? null : { code: e.code, t: evT(e), clean: true };
      return;
    }
    if (ml._tap) ml._tap.clean = false;   // another key between: not a tap
  }
  // [move] the keys of the four directions feed the double-tap detector (the press is stamped with the event's own time)
  function moveTapDown(e) {
    if (e.repeat || e.ctrlKey || e.altKey || e.metaKey) return;
    const dir = dirOfCode(e.code);
    if (!dir) return;
    if ((dir === 'f' || dir === 'b') && autoFwd) setAutoForward(false);
    tapPress(dir, e.code, evT(e), 'key');
  }
  function moveTapUp(e) { const dir = dirOfCode(e.code); if (dir) taps.up(dir, e.code, evT(e)); }
  function tapUp(e) {
    if (/^Control/.test(e.code)) ctrlAt = performance.now();
    const T = ml._tap;
    if (!T || e.code !== T.code) return;
    ml._tap = null;
    if (!T.clean || evT(e) - T.t > TAP_MS) return;
    if (!G.state || !input.enabled || G.util?.isTyping?.() || G.ui?.isBlocking?.()) return;
    ml.toggle('ctrl');
  }
  window.addEventListener('pointerdown', () => { if (ml._tap) ml._tap.clean = false; }, { capture: true, passive: true });   // Ctrl + click is no tap
  window.addEventListener('blur', () => { ml._tap = null; });
  // Ctrl + W (W = forward) closes the tab in every browser and a page cannot stop it: while a game runs and the key was
  // down a moment ago, the browser asks first. (The save is flushed on pagehide either way.)
  window.addEventListener('beforeunload', (e) => {
    if (!G.state || !ml.desktop() || performance.now() - ctrlAt > 1500) return;
    e.preventDefault(); e.returnValue = '';
  });

  // ---------------------------------------------------------------- [controls] turn speed keys (§17.1)
  // + / = / NumpadAdd faster, - / NumpadSubtract slower (× 1.15 steps, 0.25 … 4), 0 back to 1 — saved per device;
  // a toast "🖱️ 회전 속도 1.3배". It scales mouse look, drag look and the hover-look edge turning alike.
  const LS_MIN = 0.25, LS_MAX = 4, LS_STEP = 1.15;
  let lsToast = null;
  function setLookSpeed(v) {
    const n = Math.round(G.util.clamp(Number(v) || 1, LS_MIN, LS_MAX) * 10000) / 10000;
    if (typeof G.setSetting === 'function') G.setSetting('lookSpeed', n); else if (G.settings) G.settings.lookSpeed = n;
    const msg = `회전 속도 ${String(Math.round(n * 100) / 100)}배`;   // shown as "🖱️ 회전 속도 1.32배"
    try {
      const old = lsToast && lsToast.isConnected && !lsToast.classList.contains('out') ? lsToast.querySelector('.t-msg') : null;
      if (old) old.textContent = msg; else lsToast = G.ui?.toast?.(msg, { type: 'info', emoji: '🖱️', sound: false, duration: 1600 }) || null;
    } catch (e) { /* toast optional */ }
    G.bus.emit('input:look-speed', { value: n });
    return n;
  }
  const curLS = () => { const k = Number(G.settings?.lookSpeed); return Number.isFinite(k) && k > 0 ? k : 1; };
  input.lookSpeed = { get: curLS, set: setLookSpeed, faster: () => setLookSpeed(curLS() * LS_STEP), slower: () => setLookSpeed(curLS() / LS_STEP), reset: () => setLookSpeed(1), MIN: LS_MIN, MAX: LS_MAX, STEP: LS_STEP };
  bindings.on('lookFaster', () => { input.lookSpeed.faster(); return true; }, { repeat: true });   // [gfx] through the bindings (defaults: = / + , − , 0)
  bindings.on('lookSlower', () => { input.lookSpeed.slower(); return true; }, { repeat: true });
  bindings.on('lookReset', () => { input.lookSpeed.reset(); return true; });
  // [gfx] zoom keys (the wheel and the pinch stay): one press ≈ half a wheel notch
  bindings.on('zoomIn', () => { zoom -= 0.8; return true; }, { repeat: true });
  bindings.on('zoomOut', () => { zoom += 0.8; return true; }, { repeat: true });
  // [gfx] full screen (67-display.js; a key press is the gesture a browser asks for) and the settings window
  bindings.on('fullscreen', () => { const D = G.sys?.display; if (!D || typeof D.toggleFullscreen !== 'function') return false; D.toggleFullscreen('key'); return true; });
  bindings.on('settings', () => {
    const S = G.sys?.settings;
    if (S && typeof S.isOpen === 'function' && S.isOpen()) { S.close?.(); return true; }
    if (!G.state || G.ui?.isBlocking?.()) return false;
    if (S && typeof S.open === 'function') S.open(); else G.ui?.triggerAction?.('settings');
    return true;
  }, { allowInModal: true });

  // ---------------------------------------------------------------- keyboard
  const ACTIVATE_SEL = 'button, [role="button"], [role="option"], [role="tab"], [role="switch"], [role="menuitem"], [role="radio"], [role="checkbox"], a[href], summary, input[type="checkbox"], input[type="radio"]';
  const ARROW_SEL = 'input, select, textarea, [role="slider"], [role="radio"], [role="tab"], [role="option"], [role="listbox"], [role="menuitem"], [role="spinbutton"], [contenteditable]';
  const FOCUSABLE_SEL = 'button:not([disabled]), a[href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';
  /** keep Tab inside the top-most open window (aria-modal dialog); 70-app traps the title / coach cards itself.
   *  Only elements in the tab order count (tabIndex >= 0): a roving tile with tabindex="-1" is reached with the arrows,
   *  never with Tab — taking it as `last` let Tab leave the dialog and Shift+Tab land on it (R3 ui-3) */
  function trapDialogTab(e) {
    const dialogs = [...document.querySelectorAll('[role="dialog"][aria-modal="true"]')].filter((d) => !d.inert && !d.closest('[hidden], [inert]') && d.getClientRects().length);
    const top = dialogs[dialogs.length - 1];
    if (!top) return;
    const items = [...top.querySelectorAll(FOCUSABLE_SEL)].filter((el) => el.tabIndex >= 0 && !el.closest('[hidden], [inert]') && el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden');
    if (!items.length) { e.preventDefault(); return; }
    const first = items[0], last = items[items.length - 1], a = document.activeElement;
    if (!top.contains(a)) { e.preventDefault(); (e.shiftKey ? last : first).focus(); }
    else if (e.shiftKey && a === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && a === last) { e.preventDefault(); first.focus(); }
  }
  // [gfx] bindings.capture(): the settings window waits for "the next key" — it goes there and nowhere else. In the
  // capture phase, before every other listener of the page: a focused button would otherwise take Enter or Space as a
  // press on itself first, and Esc would close the window instead of only ending the wait.
  window.addEventListener('keydown', (e) => {
    if (!keyCapture) return;
    const c = keyCapture; keyCapture = null;
    e.preventDefault(); e.stopPropagation();
    if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
    e._tfmCaptured = true;
    try { c.fn?.(e.code === 'Escape' ? null : e.code); } catch (err) { G.log.error('INPUT', err); }
  }, true);
  window.addEventListener('keydown', (e) => {
    if (e._tfmCaptured) return;   // (the key of a capture, see above)
    const typing = G.util.isTyping();
    if (e.code === 'Escape') {
      if (typing) { document.activeElement.blur(); e.preventDefault(); return; }
      if (G.ui?.handleEscape?.()) { e.preventDefault(); return; }
      G.bus.emit('input:menu'); // app shell opens the main menu
      e.preventDefault();
      return;
    }
    // a control reached with the keyboard (Tab, arrows) takes Enter / Space itself; one that only kept the focus after a
    // mouse click (a HUD button) does not: Space still jumps and Enter still opens the chat
    if (e.code === 'Tab' || ARROWS.has(e.code)) navAt = performance.now();
    const kbdFocus = !typing && input.keyboardFocus();
    if (!typing) {
      if (!e.repeat) keys.add(e.code);
      const ae = document.activeElement;
      const onControl = !!(ae && ae !== document.body && ae.matches?.(ACTIVATE_SEL));
      // a held Enter / Space must not re-activate a focused button 30× a second (open → close → open … flicker)
      if (e.repeat && onControl && ACTIVATION_KEYS.has(e.code)) { e.preventDefault(); return; }
      // arrows move the player (no page scroll) — but never inside a window, a slider, a list or a tab row
      if (ARROWS.has(e.code)) { if (input.gameplay() && !(ae && ae !== document.body && ae.matches?.(ARROW_SEL))) e.preventDefault(); }
      // Space = jump while playing; on a keyboard-focused control, or inside a window, it activates the button
      else if (e.code === 'Space' && !kbdFocus && (!onControl || !G.ui?.isBlocking?.())) e.preventDefault();
    }
    // Tab moves the focus (title, forms, menus, windows); inside an open window it wraps instead of leaving it
    if (e.code === 'Tab' && !e.defaultPrevented) trapDialogTab(e);
    tapDown(e);   // [gfx] the Ctrl tap (and what spoils it)
    // [gfx] Ctrl held with a game key (Ctrl + S / D / A / E …) does nothing in the browser while playing
    if (!typing && e.ctrlKey && !e.altKey && !e.metaKey && !MOD_RE.test(e.code) && input.gameplay()) { const o = keyOwner.get(e.code); if (o && acts.get(o).game) e.preventDefault(); }
    // [gfx] handlers are registered under the DEFAULT code of an action: a rebound key stands for that code
    const blockingNow = keysCustom ? !!G.ui?.isBlocking?.() : false;
    dispatch: for (const lc of logicalCodes(e.code, e, blockingNow)) {
      const list = handlers.get(lc);
      if (!list || !list.length) continue;
      for (const { fn, opts } of list.slice()) {
        if (kbdFocus && ACTIVATION_KEYS.has(e.code) && !opts.onControl) continue; // the focused control acts
        if (e.repeat && !opts.repeat) continue;
        if (typing && !opts.allowTyping) continue;
        if (!typing && !opts.allowInModal && G.ui?.isBlocking?.()) continue;
        if (!input.enabled && !opts.allowInModal) continue;
        try { if (fn(e) === true) { e.preventDefault(); break dispatch; } } catch (err) { G.log.error('INPUT', err); }
      }
    }
    if (typing || e.repeat) return;
    if (!input.gameplay()) return;
    moveTapDown(e);   // [move] double tap → run / dash; forward or back also stops the auto-forward walk
    if (!kbdFocus && ml.isMoveKey(e.code)) ml.onMoveKey();   // [controls] lock / walk: the first movement key captures the pointer
    if (input.bindings.jump.includes(e.code) && !kbdFocus) jumpQueued = true;
    if (input.bindings.interact.includes(e.code)) G.bus.emit('input:interact', { source: 'key' });
  });
  window.addEventListener('keyup', (e) => { keys.delete(e.code); moveTapUp(e); if (ml.isMoveKey(e.code) && ml.mode() === 'walk') ml.walkUntil = performance.now() + WALK_HOLD_MS; tapUp(e); });   // [controls] walk: + 1.2 s after the last key · [gfx] the Ctrl tap
  window.addEventListener('blur', () => { keys.clear(); taps.reset(); endTapRun(); setAutoForward(false); });   // [move]

  // ---------------------------------------------------------------- mouse / pointer on the 3D canvas
  function bindCanvas() {
    const el = document.getElementById('game-container');
    if (!el || el._inputBound) return;
    el._inputBound = true;
    let drag = null; // {id, x, y, sx, sy, moved, button, touch}
    const touches = new Map();
    let pinch = 0;

    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch') {
        touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (touches.size === 2) { const [a, b] = [...touches.values()]; pinch = Math.hypot(a.x - b.x, a.y - b.y); }
        // a second finger (pinch, palm, two-finger tap) turns the press into a gesture: never a tap-to-walk
        if (touches.size >= 2 && drag) { drag.moved = 999; return; }
      }
      if (drag && e.pointerType !== 'touch') return;
      // [controls] pointer locked: a left click is the interact key on the focused thing (no drag, no click-to-move)
      if (ml.isLocked()) { if (e.button === 0 && input.gameplay()) G.bus.emit('input:interact', { source: 'lock-click' }); return; }
      // lock mode: a click on the 3D view captures the pointer (that click is the capture, never a walk-to)
      // ([gfx] not while the player freed the pointer with the Ctrl tap: then a click is a click — see ml.request)
      const capture = e.pointerType === 'mouse' && e.button === 0 && (ml.mode() === 'lock' || ml.ctrlLock) && input.gameplay() && ml.request('click');
      drag = { id: e.pointerId, x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, moved: 0, button: e.button, touch: e.pointerType === 'touch', t: performance.now(), capture };
      input.pointerDown = true;
      try { el.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      el.focus?.({ preventScroll: true });
    });
    el.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'touch' && touches.has(e.pointerId)) {
        touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (touches.size >= 2) {
          const [a, b] = [...touches.values()];
          const d = Math.hypot(a.x - b.x, a.y - b.y);
          if (pinch) zoom += (pinch - d) * 0.02;
          pinch = d;
          if (drag) drag.moved = 999;
          return;
        }
      }
      if (!drag || drag.id !== e.pointerId) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      drag.x = e.clientX; drag.y = e.clientY;
      drag.moved += Math.abs(dx) + Math.abs(dy);
      if (ml.isLocked()) return;   // [controls] locked: the deltas come from mousemove (movementX / Y)
      const s = lookGain() * (drag.touch ? 1.4 : 1);
      look.dx += dx * s;
      look.dy += dy * s * (G.settings?.invertY ? -1 : 1);
    });
    const end = (e) => {
      if (e.pointerType === 'touch') { touches.delete(e.pointerId); if (touches.size < 2) pinch = 0; }
      if (!drag || drag.id !== e.pointerId) return;
      const d = drag;
      drag = null;
      input.pointerDown = false;
      if (e.type === 'pointerup' && !d.capture && !ml.isLocked() && d.moved < 7 && performance.now() - d.t < 600) {
        G.bus.emit('input:click', { x: e.clientX, y: e.clientY, button: d.button, touch: d.touch });
      }
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('wheel', (e) => { e.preventDefault(); zoom += Math.sign(e.deltaY) * Math.min(3, Math.abs(e.deltaY) / 60); }, { passive: false });
  }

  // ---------------------------------------------------------------- on-screen d-pad (desktop reference UI)
  function bindDpad() {
    const pad = document.getElementById('dpad');
    if (!pad || pad._bound) return;
    pad._bound = true;
    const active = new Map();
    const recompute = () => {
      dpad.x = 0; dpad.y = 0;
      for (const dir of active.values()) {
        if (dir === 'up') dpad.y += 1; if (dir === 'down') dpad.y -= 1;
        if (dir === 'left') dpad.x -= 1; if (dir === 'right') dpad.x += 1;
      }
    };
    let centre = null; // {id, el} the centre (interact) button acts on release, while the pointer is still on it
    pad.addEventListener('pointerdown', (e) => {
      const b = e.target.closest('[data-dir]');
      if (!b) return;
      e.preventDefault();
      shieldPress();
      const dir = b.dataset.dir;
      if (dir !== 'center') { hold.el = pad; hold.id = e.pointerId; hold.x = e.clientX; hold.y = e.clientY; hold.last = performance.now(); }
      if (dir === 'center') {
        centre = { id: e.pointerId, el: b };
        b.classList.add('pressed');
        try { b.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
        return;
      }
      active.set(e.pointerId, dir); b.classList.add('pressed');
      if (DPAD_DIR[dir]) tapPress(DPAD_DIR[dir], 'dpad:' + dir, evT(e), 'dpad');   // [move]
      try { pad.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      recompute();
    });
    const up = (e) => {
      if (centre && e.pointerId === centre.id) {
        const c = centre; centre = null;
        c.el.classList.remove('pressed');
        if (e.type === 'pointerup' && overEl(c.el, e)) { shieldPress(); G.bus.emit('input:interact', { source: 'dpad' }); }
        return;
      }
      if (active.has(e.pointerId)) { const d0 = active.get(e.pointerId); if (DPAD_DIR[d0]) taps.up(DPAD_DIR[d0], 'dpad:' + d0, evT(e)); active.delete(e.pointerId); pad.querySelectorAll('.pressed').forEach((x) => x.classList.remove('pressed')); recompute(); if (!active.size && hold.el === pad) hold.el = null; }
    };
    pad.addEventListener('pointerup', up);
    pad.addEventListener('pointercancel', up);
    // no compatibility mouse events / click for taps on the pad (they would hit whatever the press opened)
    pad.addEventListener('touchend', (e) => { if (e.cancelable && e.target instanceof Element && e.target.closest('[data-dir]')) e.preventDefault(); }, { passive: false });
  }

  /** is the pointer (still) over the element? a little slack for fat fingers */
  function overEl(el, e, slack = 18) {
    try {
      const r = el.getBoundingClientRect();
      return e.clientX >= r.left - slack && e.clientX <= r.right + slack && e.clientY >= r.top - slack && e.clientY <= r.bottom + slack;
    } catch (err) { return false; }
  }

  // ---------------------------------------------------------------- touch joystick + buttons
  function bindMobile() {
    const stick = document.getElementById('joystick');
    if (!stick || stick._bound) return;
    stick._bound = true;
    const knob = stick.querySelector('.joystick-knob');
    let id = null, cx = 0, cy = 0, R = 50;
    const set = (x, y, t) => {
      let dx = x - cx, dy = y - cy;
      const len = Math.hypot(dx, dy);
      if (len > R) { dx = (dx / len) * R; dy = (dy / len) * R; }
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
      joy.x = dx / R; joy.y = -dy / R; joy.active = true;
      stickTap(t);   // [move] two quick flicks = the double tap
    };
    stick.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      id = e.pointerId;
      const r = stick.getBoundingClientRect();
      cx = r.left + r.width / 2; cy = r.top + r.height / 2; R = r.width * 0.36;
      try { stick.setPointerCapture(id); } catch (err) { /* ignore */ }
      set(e.clientX, e.clientY, evT(e));
      hold.el = stick; hold.id = id; hold.x = e.clientX; hold.y = e.clientY; hold.last = performance.now();
    });
    stick.addEventListener('pointermove', (e) => { if (e.pointerId === id) { set(e.clientX, e.clientY, evT(e)); if (e.isTrusted) { hold.x = e.clientX; hold.y = e.clientY; } } });
    const end = (e) => { if (e.pointerId !== id) return; stickEnd(evT(e)); id = null; joy.x = joy.y = 0; joy.active = false; knob.style.transform = ''; if (hold.el === stick) hold.el = null; };
    stick.addEventListener('pointerup', end);
    stick.addEventListener('pointercancel', end);

    // 점프 / 달리기 act on press (instant feel); 👆 and 📷 open things, so they act on RELEASE while the finger is
    // still on the button (sliding off cancels) — and every one of them swallows its trailing click (ghost taps).
    document.querySelectorAll('[data-mobile]').forEach((b) => {
      let held = null;
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        shieldPress();
        const a = b.dataset.mobile;
        if (a === 'jump') { jumpQueued = true; return; }
        if (a === 'run') { input.setMobileRun(!mobileRun); return; }
        if (held != null) return; // a second finger on the same button
        held = e.pointerId;
        b.classList.add('pressed');
        try { b.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      });
      const release = (e) => {
        if (held == null || e.pointerId !== held) return;
        held = null;
        b.classList.remove('pressed');
        if (e.type !== 'pointerup' || !overEl(b, e)) return;
        shieldPress();
        const a = b.dataset.mobile;
        if (a === 'interact') G.bus.emit('input:interact', { source: 'touch' });
        else if (a === 'photo') G.ui?.triggerAction?.('photo', b);
      };
      b.addEventListener('pointerup', release);
      b.addEventListener('pointercancel', release);
      b.addEventListener('lostpointercapture', (e) => { if (held != null && e.pointerId === held) { held = null; b.classList.remove('pressed'); } });
      b.addEventListener('touchend', (e) => { if (e.cancelable) e.preventDefault(); }, { passive: false });
      // keyboard / switch access (no pointer): Enter / Space on a focused control button still works
      b.addEventListener('click', (e) => {
        if (e.detail !== 0) return; // pointer clicks were handled above (and are swallowed by the shield)
        const a = b.dataset.mobile;
        if (a === 'jump') jumpQueued = true;
        else if (a === 'run') input.setMobileRun(!mobileRun);
        else if (a === 'interact') G.bus.emit('input:interact', { source: 'key' });
        else if (a === 'photo') G.ui?.triggerAction?.('photo', b);
      });
    });
  }

  // ---------------------------------------------------------------- 쉬운 모드: long-press to read (touch / pen)
  // Holding a button, tile, card or text for 600 ms reads it aloud (G.easy.say, forced) and swallows the click that
  // follows, so a child can "ask" what a button does without triggering it. Not on the 3D view or the controls.
  const LP_MS = 600, LP_MOVE = 12;
  const LP_EXCLUDE = '#game-container, #mobile-controls, #dpad, input, textarea, select, [contenteditable], .no-read';
  const LP_TARGET = '[data-say], button, [role="button"], [role="option"], .easy-tile, .chip, .slot, .card, .list-item, .toast, .bubble, .nametag, label, h1, h2, h3, h4, p, li, .badge';
  let lp = null, fired = null, swallowUntil = 0;
  function lpClear() { if (lp) { clearTimeout(lp.timer); lp.el.classList.remove('easy-reading-wait'); lp = null; } }
  function bindLongPress() {
    if (document._easyLongPress) return;
    document._easyLongPress = true;
    document.addEventListener('pointerdown', (e) => {
      lpClear();
      if (fired && e.pointerId !== fired.id) { fired = null; swallowUntil = 0; } // a new finger: the old press is over
      if (e.pointerType === 'mouse' || !e.isPrimary || !G.easy?.on) return;
      const t = e.target instanceof Element ? e.target : null;
      if (!t || t.closest(LP_EXCLUDE)) return;
      const el = t.closest(LP_TARGET);
      if (!el || el === document.body) return;
      const cur = { id: e.pointerId, x: e.clientX, y: e.clientY, el, timer: 0 };
      cur.timer = setTimeout(() => {
        if (lp !== cur) return;
        const text = G.easy?.textOf?.(el) || el.textContent || '';
        lp = null;
        el.classList.remove('easy-reading-wait');
        if (!String(text).trim()) return;
        fired = { id: cur.id };
        swallowUntil = performance.now() + 60000; // until this finger is lifted
        el.classList.add('easy-reading');
        setTimeout(() => el.classList.remove('easy-reading'), 1400);
        try { navigator.vibrate?.(12); } catch (err) { /* not supported */ }
        G.easy?.say?.(text, { force: true, priority: 1 });
      }, LP_MS);
      lp = cur;
      el.classList.add('easy-reading-wait');
    }, { capture: true, passive: true });
    document.addEventListener('pointermove', (e) => {
      if (lp && e.pointerId === lp.id && Math.abs(e.clientX - lp.x) + Math.abs(e.clientY - lp.y) > LP_MOVE) lpClear();
    }, { capture: true, passive: true });
    const end = (e) => {
      if (lp && e.pointerId === lp.id) lpClear();
      if (fired && e.pointerId === fired.id) { fired = null; swallowUntil = performance.now() + 450; }
    };
    document.addEventListener('pointerup', end, { capture: true, passive: true });
    document.addEventListener('pointercancel', end, { capture: true, passive: true });
    window.addEventListener('blur', () => { lpClear(); if (fired) { fired = null; swallowUntil = 0; } });
    // the click that ends a long-press is swallowed (read, don't activate)
    document.addEventListener('click', (e) => {
      if (performance.now() < swallowUntil) { swallowUntil = 0; e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); }
    }, true);
    document.addEventListener('contextmenu', (e) => {
      if ((lp || fired || performance.now() < swallowUntil) && G.easy?.on) e.preventDefault();
    }, true);
  }

  function bindAll() { bindGhostShield(); bindCanvas(); bindDpad(); bindMobile(); bindLongPress(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bindAll); else bindAll();
  input.bindAll = bindAll;
})();
