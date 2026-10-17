// =============================================================================
// 05-input.js — keyboard / mouse / touch / on-screen d-pad abstraction.
//
//   G.input.axis            {x: -1..1 (right +), y: -1..1 (forward +)}  combined move input
//   G.input.running         Shift held or mobile run toggle
//   G.input.consumeJump()   true once per jump press
//   G.input.consumeLook()   {dx, dy} accumulated camera drag (pixels * sensitivity)
//   G.input.consumeZoom()   accumulated zoom delta (+ = zoom out)
//   G.input.onKey(code, fn, {allowInModal, allowTyping, repeat})  -> off()
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

  const isTouch = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
  const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;

  // ---------------------------------------------------------------- ghost-click shield (see header)
  const GHOST_MS = 900;            // how long after a press its trailing click can still arrive (slow phones ≈ 700 ms)
  const GHOST_PX = 48;             // the trailing click lands where the finger was
  let press = null;                // {el, id, t, x, y, type, shieldUntil, up}
  const ACTIVATION_KEYS = new Set(['Enter', 'NumpadEnter', 'Space']);
  /** force-swallow the next trusted pointer click of the current press (the control already acted) */
  function shieldPress(ms = GHOST_MS) {
    const now = performance.now();
    if (!press || now - press.t > GHOST_MS * 2) press = { el: null, id: -1, t: now, x: NaN, y: NaN, type: 'any', shieldUntil: 0, up: false };
    press.shieldUntil = now + Math.max(0, Math.min(3000, Number(ms) || GHOST_MS));
  }
  function swallow(e) { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); }
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
        // the DOM changed under the finger between press and click: a new element took the click
        const lab = p.el.closest?.('label');
        ghost = !(lab && (lab.control === t || lab.contains(t)));
      }
      if (!ghost) return;
      press = null;
      swallow(e);
      G.log?.debug?.('INPUT', 'ghost click swallowed', { on: String(t?.className || t?.tagName || '').slice(0, 40) });
    }, true);
  }

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
    setMobileRun(v) { mobileRun = !!v; document.querySelector('[data-mobile=run]')?.classList.toggle('on', mobileRun); },
    queueJump() { jumpQueued = true; },
    /** swallow the trailing browser click of the press in progress (or of the one that just ended) */
    shieldClicks(ms = GHOST_MS) { shieldPress(ms); },
    reset() { keys.clear(); look.dx = look.dy = 0; zoom = 0; jumpQueued = false; joy.x = joy.y = 0; dpad.x = dpad.y = 0; },

    /** recompute axis; called by the player each frame */
    update() {
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
      return input.axis;
    },
  };
  G.input = input;
  if (input.touchUI) document.body?.classList.add('is-touch');
  else if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => { if (input.touchUI) document.body.classList.add('is-touch'); });

  // ---------------------------------------------------------------- keyboard
  window.addEventListener('keydown', (e) => {
    const typing = G.util.isTyping();
    if (e.code === 'Escape') {
      if (typing) { document.activeElement.blur(); e.preventDefault(); return; }
      if (G.ui?.handleEscape?.()) { e.preventDefault(); return; }
      G.bus.emit('input:menu'); // app shell opens the main menu
      e.preventDefault();
      return;
    }
    if (!typing) {
      if (!e.repeat) keys.add(e.code);
      const ae = document.activeElement;
      const onControl = !!(ae && ae !== document.body && ae.matches?.('button, [role="button"], [role="option"], [role="tab"], [role="switch"], a[href], summary, input[type="checkbox"], input[type="radio"]'));
      // a held Enter / Space must not re-activate a focused button 30× a second (open → close → open … flicker)
      if (e.repeat && onControl && ACTIVATION_KEYS.has(e.code)) { e.preventDefault(); return; }
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
      // Space = jump while playing; inside a window (modal, dialogue) it activates the focused button as usual
      else if (e.code === 'Space' && (!onControl || !G.ui?.isBlocking?.())) e.preventDefault();
    }
    const list = handlers.get(e.code);
    if (list && list.length) {
      for (const { fn, opts } of list.slice()) {
        if (e.repeat && !opts.repeat) continue;
        if (typing && !opts.allowTyping) continue;
        if (!typing && !opts.allowInModal && G.ui?.isBlocking?.()) continue;
        if (!input.enabled && !opts.allowInModal) continue;
        try { if (fn(e) === true) { e.preventDefault(); break; } } catch (err) { G.log.error('INPUT', err); }
      }
    }
    if (typing || e.repeat) return;
    if (!input.gameplay()) return;
    if (input.bindings.jump.includes(e.code)) jumpQueued = true;
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
      }
      if (drag && e.pointerType !== 'touch') return;
      drag = { id: e.pointerId, x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, moved: 0, button: e.button, touch: e.pointerType === 'touch', t: performance.now() };
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
      const s = (G.settings?.sensitivity || 1) * (drag.touch ? 1.4 : 1);
      look.dx += dx * s;
      look.dy += dy * s * (G.settings?.invertY ? -1 : 1);
    });
    const end = (e) => {
      if (e.pointerType === 'touch') { touches.delete(e.pointerId); if (touches.size < 2) pinch = 0; }
      if (!drag || drag.id !== e.pointerId) return;
      const d = drag;
      drag = null;
      input.pointerDown = false;
      if (e.type === 'pointerup' && d.moved < 7 && performance.now() - d.t < 600) {
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
      if (active.has(e.pointerId)) { active.delete(e.pointerId); pad.querySelectorAll('.pressed').forEach((x) => x.classList.remove('pressed')); recompute(); }
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
    });
    stick.addEventListener('pointermove', (e) => { if (e.pointerId === id) set(e.clientX, e.clientY); });
    const end = (e) => { if (e.pointerId !== id) return; id = null; joy.x = joy.y = 0; joy.active = false; knob.style.transform = ''; };
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
