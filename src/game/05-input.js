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

  const input = {
    keys,
    hasTouch: isTouch,
    touchUI: isTouch && (coarse || Math.min(screen.width, screen.height) < 900),
    enabled: true,
    axis: { x: 0, y: 0 },
    running: false,
    pointerDown: false,
    bindings: {
      forward: ['KeyW', 'ArrowUp'], back: ['KeyS', 'ArrowDown'], left: ['KeyA', 'ArrowLeft'], right: ['KeyD', 'ArrowRight'],
      run: ['ShiftLeft', 'ShiftRight'], jump: ['Space'], interact: ['KeyE'],
    },
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
    reset() { keys.clear(); look.dx = look.dy = 0; zoom = 0; jumpQueued = false; joy.x = joy.y = 0; dpad.x = dpad.y = 0; input.setMobileRun(false); },

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
      }
      const len = Math.hypot(x, y);
      if (len > 1) { x /= len; y /= len; }
      input.axis.x = x; input.axis.y = y;
      input.running = input.gameplay() && (input.any(input.bindings.run) || mobileRun || Math.hypot(joy.x, joy.y) > 0.92);
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
  // Defaults: fine pointer + keyboard → normal mode 'lock', easy mode 'walk' (operator settings
  // controls.mouse_look_normal / _easy through G.site); touch → 'drag'; automation (navigator.webdriver) → 'drag'
  // unless ?mouselook=lock|walk|drag asks otherwise.
  // TEST SEAM G.input.mouseLook: state() → {mode, pref, locked, requests, exits, refused, hover, walking, userReleased,
  //   lastReason}; feed(dx, dy) adds raw mouse deltas exactly as a locked mousemove does; setApi({request(el), exit(),
  //   element()}) replaces requestPointerLock / exitPointerLock / document.pointerLockElement (call lockChanged() from
  //   the fakes); refuse() simulates a refused lock; refresh() re-reads the mode.
  const LOOK_MODES = ['lock', 'walk', 'drag'];
  const qLook = (() => { try { const v = new URLSearchParams(location.search).get('mouselook'); return LOOK_MODES.includes(v) ? v : null; } catch (e) { return null; } })();
  const finePointer = (() => { try { return !!(window.matchMedia && window.matchMedia('(pointer: fine)').matches); } catch (e) { return false; } })();
  const WALK_HOLD_MS = 1200, EDGE = 0.06, EDGE_PX_S = 260, LOCK_GAIN = 1;
  const ml = {
    _mode: null, locked: false, requests: 0, exits: 0, refused: false, userReleased: false, walkUntil: 0, lastReason: '',
    _ours: false, _edgeT: 0, _px: NaN, _py: NaN, _over: false, _dot: null, _chip: null, _coach: null,
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
      const easy = G.easy ? !!G.easy.on : G.settings?.easyMode !== false;
      const site = easy ? G.site?.get?.('controls.mouse_look_easy', 'walk') : G.site?.get?.('controls.mouse_look_normal', 'lock');
      return LOOK_MODES.includes(site) ? site : (easy ? 'walk' : 'lock');
    },
    /** the effective mode on this device right now (useQuery false: what it would be without ?mouselook / a test) */
    mode(useQuery = true) {
      if (useQuery && ml._force) return ml._force;
      if (useQuery && qLook) return qLook;
      if (input.touchUI && !finePointer) return 'drag';
      let auto = false;
      try { auto = !!navigator.webdriver; } catch (e) { auto = false; }
      if (auto) return 'drag';
      return ml.pref();
    },
    isLocked() { const el = ml.el(); return !!el && ml.locked && ml.api.element() === el; },
    isMoveKey(code) { const b = input.bindings; return b.forward.includes(code) || b.back.includes(code) || b.left.includes(code) || b.right.includes(code); },
    moving() { const b = input.bindings; return input.any(b.forward) || input.any(b.back) || input.any(b.left) || input.any(b.right); },
    /** ask for the pointer (true when a request went out) */
    request(reason) {
      const m = ml.mode();
      if (m === 'drag' || ml.refused || ml.isLocked() || !input.gameplay()) return false;
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
      if (ml.userReleased && ml.mode() === 'lock') return;
      if (!ml.isLocked()) ml.request('key');
    },
    /** pointerlockchange (real or from a fake API) */
    lockChanged() {
      const el = ml.el(), now = !!el && ml.api.element() === el;
      if (now === ml.locked) { ml._ours = false; return; }
      ml.locked = now;
      if (now) { ml.userReleased = false; ml.everLocked = true; ml._coachOnce(); }
      else if (!ml._ours) ml.userReleased = true;   // Esc / the browser took it back: keys no longer re-take it
      ml._ours = false;
      ml._ui();
      G.bus.emit('input:pointer-lock', { locked: now, mode: ml.mode() });
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
    /** hover-look fallback active right now? (refused lock, lock / walk mode, walk: only while moving) */
    hover() {
      const m = ml.mode();
      if (!ml.refused || m === 'drag' || !input.gameplay()) return false;
      return m === 'lock' || performance.now() < ml.walkUntil || ml.moving();
    },
    /** add raw mouse deltas (px) to the view, as a locked mousemove does */
    feed(dx, dy) {
      if (!Number.isFinite(dx) || !Number.isFinite(dy)) return;
      const s = lookGain() * LOCK_GAIN;
      look.dx += G.util.clamp(dx, -400, 400) * s;
      look.dy += G.util.clamp(dy, -400, 400) * s * (G.settings?.invertY ? -1 : 1);
    },
    /** every frame (input.update): release on any blocking UI, walk-mode timeout, hover edge turning */
    tick() {
      const now = performance.now();
      if (ml.isLocked()) {
        if (!input.gameplay() || G.ui?.isBlocking?.() || G.util?.isTyping?.()) ml.release('ui');
        else if (ml.mode() === 'walk') { if (ml.moving()) ml.walkUntil = now + WALK_HOLD_MS; else if (now > ml.walkUntil) ml.release('walk'); }
        else if (ml.mode() === 'drag') ml.release('mode');
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
      if (ml._chip && !ml._chip.hidden !== ml.isLocked()) ml._ui();
    },
    // ---- the centre dot, the hint chip, the first-time coach card (inline styles: no stylesheet of our own)
    _ui() {
      const on = ml.isLocked();
      if (on && !ml._dot && document.body) {
        const dot = document.createElement('div');
        dot.id = 'ml-dot'; dot.setAttribute('aria-hidden', 'true');
        Object.assign(dot.style, { position: 'fixed', left: '50%', top: '50%', width: '6px', height: '6px', margin: '-3px 0 0 -3px', borderRadius: '50%', background: 'rgba(255,250,235,0.92)', boxShadow: '0 0 0 1.5px rgba(40,28,14,0.55)', pointerEvents: 'none', zIndex: '40' });
        const chip = document.createElement('div');
        chip.id = 'ml-chip'; chip.setAttribute('role', 'status');
        chip.textContent = 'Esc: 마우스 풀기 · + / −: 회전 속도';
        Object.assign(chip.style, { position: 'fixed', left: '50%', bottom: '86px', transform: 'translateX(-50%)', padding: '6px 14px', borderRadius: '999px', background: 'rgba(32,24,16,0.72)', color: '#fff8e6', font: '600 13px/1.3 system-ui, sans-serif', pointerEvents: 'none', zIndex: '40', whiteSpace: 'nowrap' });
        document.body.append(dot, chip);
        ml._dot = dot; ml._chip = chip;
      }
      if (ml._dot) ml._dot.hidden = !on;
      if (ml._chip) ml._chip.hidden = !on;
    },
    _coachOnce() {
      const KEY = 'tfm.v1.mlcoach';
      try { if (localStorage.getItem(KEY)) return; localStorage.setItem(KEY, '1'); } catch (e) { if (ml._coach !== null) return; }
      if (!document.body) return;
      const easy = G.easy ? !!G.easy.on : G.settings?.easyMode !== false;
      const walk = ml.mode() === 'walk';
      const text = walk ? '걸으면서 마우스를 움직이면 화면이 돌아가요. 멈추면 마우스로 그림 단추를 누를 수 있어요.'
        : '마우스를 움직이면 화면이 돌아가요. Esc를 누르면 마우스가 풀려요. + 와 − 로 도는 빠르기를 바꿔요.';
      const card = document.createElement('div');
      card.id = 'ml-coach'; card.setAttribute('role', 'status'); card.dataset.say = text;
      Object.assign(card.style, { position: 'fixed', left: '50%', top: '18%', transform: 'translateX(-50%)', maxWidth: 'min(420px, 88vw)', padding: '14px 18px', borderRadius: '16px', background: 'rgba(253,246,228,0.96)', color: '#3b2a17', font: '600 15px/1.45 system-ui, sans-serif', boxShadow: '0 8px 28px rgba(0,0,0,0.28)', zIndex: '41', pointerEvents: 'none' });
      card.textContent = '🖱️ ' + text;
      document.body.appendChild(card);
      ml._coach = card;
      if (easy) { try { G.easy?.say?.(text, { force: true, priority: 1 }); } catch (e) { /* voice optional */ } }
      setTimeout(() => { card.remove(); }, easy ? 9000 : 7000);
    },
  };
  input.mouseLook = {
    state() {
      return { mode: ml.mode(), defaultMode: ml.mode(false), pref: ml.pref(), locked: ml.isLocked(), requests: ml.requests, exits: ml.exits, refused: ml.refused, hover: ml.hover(),
        walking: performance.now() < ml.walkUntil, userReleased: ml.userReleased, lastReason: ml.lastReason, coach: !!ml._coach, query: qLook };
    },
    feed: (dx, dy) => ml.feed(dx, dy),
    setApi(api) { if (api && typeof api === 'object') { for (const k of ['request', 'exit', 'element']) if (typeof api[k] === 'function') ml.api[k] = api[k]; } ml.lockChanged(); },
    lockChanged: () => ml.lockChanged(),
    refuse: () => ml._refused('test'),
    /** tests: force a mode ('lock' | 'walk' | 'drag'; null = back to the rules) */
    setMode(m) { ml._force = LOOK_MODES.includes(m) ? m : null; return input.mouseLook.refresh(); },
    refresh() { ml.userReleased = false; ml.refused = false; if (ml.isLocked() && ml.mode() === 'drag') ml.release('mode'); return ml.mode(); },
    release: (why) => ml.release(why || 'api'),
    modes: LOOK_MODES.slice(),
  };
  document.addEventListener('pointerlockchange', () => ml.lockChanged());
  document.addEventListener('pointerlockerror', () => ml._refused('error'));
  document.addEventListener('mousemove', (e) => {
    const el = ml.el();
    if (ml.isLocked()) { ml.feed(Number(e.movementX) || 0, Number(e.movementY) || 0); return; }
    const over = !!el && e.target instanceof Node && el.contains(e.target);
    ml._over = over; ml._px = e.clientX; ml._py = e.clientY;
    if (over && e.buttons === 0 && ml.hover()) ml.feed(Number(e.movementX) || 0, Number(e.movementY) || 0);
  }, { passive: true });
  // any typing field that takes the focus (chat, forms) releases the pointer at once
  document.addEventListener('focusin', (e) => { if (ml.isLocked() && G.util?.isTyping?.()) ml.release('typing'); }, true);
  G.bus.on('settings:changed', ({ key } = {}) => { if (key === 'mouseLook' || key === 'easyMode') input.mouseLook.refresh(); });

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
  for (const c of ['Equal', 'NumpadAdd']) input.onKey(c, () => { input.lookSpeed.faster(); return true; }, { repeat: true });
  for (const c of ['Minus', 'NumpadSubtract']) input.onKey(c, () => { input.lookSpeed.slower(); return true; }, { repeat: true });
  for (const c of ['Digit0', 'Numpad0']) input.onKey(c, () => { input.lookSpeed.reset(); return true; });

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
  window.addEventListener('keydown', (e) => {
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
    const list = handlers.get(e.code);
    if (list && list.length) {
      for (const { fn, opts } of list.slice()) {
        if (kbdFocus && ACTIVATION_KEYS.has(e.code) && !opts.onControl) continue; // the focused control acts
        if (e.repeat && !opts.repeat) continue;
        if (typing && !opts.allowTyping) continue;
        if (!typing && !opts.allowInModal && G.ui?.isBlocking?.()) continue;
        if (!input.enabled && !opts.allowInModal) continue;
        try { if (fn(e) === true) { e.preventDefault(); break; } } catch (err) { G.log.error('INPUT', err); }
      }
    }
    if (typing || e.repeat) return;
    if (!input.gameplay()) return;
    if (!kbdFocus && ml.isMoveKey(e.code)) ml.onMoveKey();   // [controls] lock / walk: the first movement key captures the pointer
    if (input.bindings.jump.includes(e.code) && !kbdFocus) jumpQueued = true;
    if (input.bindings.interact.includes(e.code)) G.bus.emit('input:interact', { source: 'key' });
  });
  window.addEventListener('keyup', (e) => { keys.delete(e.code); });
  window.addEventListener('blur', () => { keys.clear(); });

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
      const capture = e.pointerType === 'mouse' && e.button === 0 && ml.mode() === 'lock' && input.gameplay() && ml.request('click');
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
      if (active.has(e.pointerId)) { active.delete(e.pointerId); pad.querySelectorAll('.pressed').forEach((x) => x.classList.remove('pressed')); recompute(); if (!active.size && hold.el === pad) hold.el = null; }
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
    const set = (x, y) => {
      let dx = x - cx, dy = y - cy;
      const len = Math.hypot(dx, dy);
      if (len > R) { dx = (dx / len) * R; dy = (dy / len) * R; }
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
      joy.x = dx / R; joy.y = -dy / R; joy.active = true;
    };
    stick.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      id = e.pointerId;
      const r = stick.getBoundingClientRect();
      cx = r.left + r.width / 2; cy = r.top + r.height / 2; R = r.width * 0.36;
      try { stick.setPointerCapture(id); } catch (err) { /* ignore */ }
      set(e.clientX, e.clientY);
      hold.el = stick; hold.id = id; hold.x = e.clientX; hold.y = e.clientY; hold.last = performance.now();
    });
    stick.addEventListener('pointermove', (e) => { if (e.pointerId === id) { set(e.clientX, e.clientY); if (e.isTrusted) { hold.x = e.clientX; hold.y = e.clientY; } } });
    const end = (e) => { if (e.pointerId !== id) return; id = null; joy.x = joy.y = 0; joy.active = false; knob.style.transform = ''; if (hold.el === stick) hold.el = null; };
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
