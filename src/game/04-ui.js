// =============================================================================
// 04-ui.js — shared HTML/CSS UI toolkit (3D = Three.js, UI = HTML/CSS).
//   G.ui.h / esc / fmt / hydrateIcons
//   G.ui.toast / banner / zoneBanner / objective
//   G.ui.modal.open(...) / confirm / alert
//   G.ui.rewardPopup(...)
//   G.ui.popover.open(...)
//   G.ui.label(...)  world-anchored DOM labels (updated every frame)
//   G.ui.loading / fade / flash / setHudVisible
//   G.ui.onAction(action, fn)  delegated [data-action] clicks
//   G.ui.onEscape(fn, priority) / handleEscape()
//   G.ui.block(key) / unblock(key) / isBlocking()
//   motion (CONTRACT §13.5): G.ui.motion {d1..d4, ease}, reducedMotion(), stagger(els, opts), countUp(el, to, opts),
//   setBar(el, pct), skeleton(opts), pulse(el) — modals grow out of the element that opened them, toasts stack with
//   FLIP, every `.bar > i` fill becomes transform-based, G.ui.tabs gets a sliding ink. reduceMotion → instant/opacity.
// =============================================================================
(function () {
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const esc = G.util.escapeHtml;

  // ---------------------------------------------------------------- motion system (§13.5)
  // the same tokens as 00-base.css (--dur-1..4, --ease-out-quint, --ease-in, --ease-pop ≤ 4 % overshoot)
  const MOTION = Object.freeze({
    d1: 120, d2: 200, d3: 320, d4: 500, stagger: 36,
    out: 'cubic-bezier(.22, 1, .36, 1)', in: 'cubic-bezier(.5, 0, .75, 0)', pop: 'cubic-bezier(.2, 1, .3, 1.1)', inOut: 'cubic-bezier(.65, 0, .35, 1)',
  });
  const rmq = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
  /** reduce motion: the player's setting or the OS preference → instant / opacity-only */
  const reduced = () => !!(G.settings && G.settings.reduceMotion) || !!(rmq && rmq.matches);
  const canAnimate = () => typeof Element !== 'undefined' && typeof Element.prototype.animate === 'function';
  const easyMotion = () => !!(G.settings && G.settings.easyMode !== false);
  const perfNow = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  /** run el.animate() safely; returns the Animation or null */
  function anim(el, frames, opts) {
    if (!el || !canAnimate()) return null;
    try { return el.animate(frames, opts); } catch (e) { return null; }
  }
  // where did the player last tap / press Enter? Dialogs and popovers grow out of that point (shared-element feel).
  const lastPtr = { x: 0, y: 0, t: -1e9 };
  document.addEventListener('pointerdown', (e) => { lastPtr.x = e.clientX; lastPtr.y = e.clientY; lastPtr.t = perfNow(); }, true);
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const a = document.activeElement;
    if (!a || a === document.body || typeof a.getBoundingClientRect !== 'function') return;
    const r = a.getBoundingClientRect();
    if (r.width < 1) return;
    lastPtr.x = r.left + r.width / 2; lastPtr.y = r.top + r.height / 2; lastPtr.t = perfNow();
  }, true);
  /** the recent tap point (≤ maxAge ms ago) or null */
  function tapOrigin(maxAge = 900) { return perfNow() - lastPtr.t <= maxAge ? { x: lastPtr.x, y: lastPtr.y } : null; }

  /**
   * stagger(elements | parent, {delay, step, y, scale, duration, max, skipAnimated=true}) — one-shot entrance with the
   * Web Animations API (fill: backwards), so a later re-render never replays it and modules' own CSS entrances win.
   */
  function stagger(list, o = {}) {
    if (reduced() || !canAnimate() || !list) return;
    const all = list instanceof Element ? Array.from(list.children) : Array.from(list);
    const max = o.max ?? 12, step = o.step ?? (easyMotion() ? 44 : MOTION.stagger), d0 = o.delay ?? 0, dur = o.duration ?? MOTION.d4;
    const y = o.y ?? (easyMotion() ? 8 : 12), s0 = o.scale ?? 1;
    let i = 0;
    for (const el of all) {
      if (i >= max) break;
      if (!(el instanceof Element) || el.hidden || el.classList.contains('tab-ink')) continue;
      if (o.skipAnimated !== false) {
        let name = 'none';
        try { name = getComputedStyle(el).animationName; } catch (e) { name = 'none'; }
        if (name && name !== 'none') continue;
      }
      anim(el, [{ opacity: 0, translate: `0 ${y}px`, scale: s0 }, { opacity: 1, translate: '0 0', scale: 1 }],
        { duration: dur, delay: d0 + i * step, easing: MOTION.out, fill: 'backwards' });
      i++;
    }
  }

  /** countUp(el, to, {from, duration, delay, format, prefix, suffix}) — eased number roll (ease-out-quint) */
  function countUp(el, to, o = {}) {
    if (!el) return;
    const end = Number(to);
    if (!Number.isFinite(end)) return;
    const fmtN = typeof o.format === 'function' ? o.format : (n) => G.util.fmt(n);
    const pre = o.prefix || '', suf = o.suffix || '';
    const paint = (v) => { el.textContent = `${pre}${fmtN(v)}${suf}`; };
    if (el.__cuRaf) { cancelAnimationFrame(el.__cuRaf); el.__cuRaf = 0; }
    clearTimeout(el.__cuT);
    const start = o.from != null ? Number(o.from) : (Number(String(el.textContent).replace(/[^\d.-]/g, '')) || 0);
    if (reduced() || !Number.isFinite(start) || start === end) { paint(end); return; }
    const dur = Math.max(120, o.duration ?? 800);
    const run = () => {
      const t0 = perfNow();
      const step = () => {
        const k = Math.min(1, (perfNow() - t0) / dur);
        const e = 1 - Math.pow(1 - k, 5);
        paint(Math.round(start + (end - start) * e));
        el.__cuRaf = k < 1 ? requestAnimationFrame(step) : 0;
      };
      paint(start);
      el.__cuRaf = requestAnimationFrame(step);
    };
    if (o.delay > 0) { paint(start); el.__cuT = setTimeout(run, o.delay); } else run();
  }

  /** a soft attention pulse on an element (scale 1 → 1.06 → 1, no flashing) */
  function pulse(el, o = {}) {
    if (!el || reduced()) return;
    anim(el, [{ scale: 1 }, { scale: o.scale ?? 1.06 }, { scale: 1 }], { duration: o.duration ?? MOTION.d3 + 80, easing: MOTION.out });
  }

  /** skeleton({rows=3, avatar=true, block=false}) → HTML string of shimmering placeholder rows (while loading) */
  function skeleton(o = {}) {
    const rows = Math.max(1, Math.min(8, Number(o.rows) || 3));
    let out = '<div class="skel" aria-hidden="true">';
    if (o.block) out += '<div class="skel-block"></div>';
    for (let i = 0; i < rows; i++) {
      out += `<div class="skel-row">${o.avatar === false ? '' : '<span class="skel-ava"></span>'}<span class="col grow"><span class="skel-line ${i % 2 ? 'w60' : 'w80'}"></span><span class="skel-line w40"></span></span></div>`;
    }
    return `${out}</div>`;
  }

  /** tiny hyperscript: h('div', {class:'x', onclick: fn, html:'<b>..</b>'}, child1, [child2, child3]) */
  function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v == null || v === false) continue;
        if (k === 'class' || k === 'className') el.className = v;
        else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
        else if (k === 'dataset') Object.assign(el.dataset, v);
        else if (k === 'html') el.innerHTML = v;
        else if (k === 'text') el.textContent = v;
        else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
        else if (v === true) el.setAttribute(k, '');
        else el.setAttribute(k, v);
      }
    }
    const add = (c) => {
      if (c == null || c === false) return;
      if (Array.isArray(c)) c.forEach(add);
      else if (c instanceof Node) el.appendChild(c);
      else el.appendChild(document.createTextNode(String(c)));
    };
    children.forEach(add);
    if (el.querySelector('[data-icon]')) hydrateIcons(el);
    return el;
  }

  /** replace <span data-icon="name"> placeholders with inline SVG */
  function hydrateIcons(root = document) {
    for (const el of root.querySelectorAll('[data-icon]')) {
      const name = el.getAttribute('data-icon');
      if (el.dataset.iconDone === name) continue;
      el.innerHTML = G.icon(name);
      el.dataset.iconDone = name;
    }
  }
  /** set the icon of an element that has data-icon */
  function setIcon(el, name) { if (!el) return; el.setAttribute('data-icon', name); el.dataset.iconDone = ''; el.innerHTML = G.icon(name); el.dataset.iconDone = name; }

  // ---------------------------------------------------------------- blocking / escape
  const blockers = new Set();
  const escHandlers = [];
  function block(key) { blockers.add(key); document.body.classList.add('ui-blocking'); }
  function unblock(key) { blockers.delete(key); if (!blockers.size) document.body.classList.remove('ui-blocking'); }
  /** true when gameplay input (movement/E/hotkeys) should be ignored */
  function isBlocking() { return blockers.size > 0 || G.util.isTyping(); }
  function onEscape(fn, priority = 0) { escHandlers.push({ fn, priority }); escHandlers.sort((a, b) => b.priority - a.priority); return () => { const i = escHandlers.findIndex((e) => e.fn === fn); if (i >= 0) escHandlers.splice(i, 1); }; }
  function handleEscape() {
    for (const { fn } of escHandlers) { try { if (fn() === true) return true; } catch (e) { G.log.error('UI', 'escape handler', e); } }
    return false;
  }

  // ---------------------------------------------------------------- delegated actions
  const actionHandlers = new Map();
  function onAction(action, fn) {
    if (!actionHandlers.has(action)) actionHandlers.set(action, new Set());
    actionHandlers.get(action).add(fn);
    return () => actionHandlers.get(action)?.delete(fn);
  }
  function triggerAction(action, el, ev) {
    const set = actionHandlers.get(action);
    G.bus.emit('ui:action', { action, el });
    if (!set || !set.size) { G.log.debug('UI', `no handler for action "${action}"`); return false; }
    for (const fn of set) { try { fn(el, ev); } catch (e) { G.log.error('UI', `action ${action}`, e); } }
    return true;
  }
  document.addEventListener('click', (ev) => {
    const el = ev.target.closest('[data-action]');
    if (!el || el.disabled) return;
    const handled = triggerAction(el.dataset.action, el, ev);
    if (handled) G.sfx('click');
  });
  function setActive(action, on) { $$(`[data-action="${action}"]`).forEach((b) => b.classList.toggle('active', !!on)); }
  // easy-mode tiles that merge several adult buttons show the sum of their badges (§12.3)
  const BADGE_ALIASES = { stickerbook: ['collection', 'quests'], 'kid-chat': ['chat'] };
  const badgeCounts = new Map();
  function paintBadge(action, count) {
    const sel = `#hud-left-menu [data-action="${action}"], #bottom-bar [data-action="${action}"], [data-badge-host][data-action="${action}"]`;
    $$(sel).forEach((b) => {
      let badge = b.querySelector('.badge');
      if (!count) { badge?.remove(); return; }
      const fresh = !badge;
      if (!badge) { badge = h('span', { class: 'badge' }); b.appendChild(badge); }
      const txt = count > 99 ? '99+' : String(count);
      if (badge.textContent === txt) return;
      badge.textContent = txt;
      // a new badge pops in (CSS badgeIn); a changed count gets one small bump
      if (!fresh && !reduced()) anim(badge, [{ scale: 1 }, { scale: 1.28 }, { scale: 1 }], { duration: MOTION.d3, easing: MOTION.out });
    });
  }
  function setBadge(action, count) {
    count = Math.max(0, Math.floor(Number(count) || 0));
    badgeCounts.set(action, count);
    paintBadge(action, count);
    for (const [alias, parts] of Object.entries(BADGE_ALIASES)) {
      if (parts.includes(action)) paintBadge(alias, parts.reduce((n, a) => n + (badgeCounts.get(a) || 0), 0));
    }
  }
  function getBadge(action) {
    const parts = BADGE_ALIASES[action];
    return parts ? parts.reduce((n, a) => n + (badgeCounts.get(a) || 0), 0) : (badgeCounts.get(action) || 0);
  }

  // ---------------------------------------------------------------- toasts / banners
  const TOAST_ICONS = { info: 'ℹ️', success: '✅', warn: '⚠️', error: '⛔', reward: '🎁' };
  const easyOn = () => !!(G.settings && G.settings.easyMode !== false);
  /** technical / long error text is replaced by one friendly sentence in easy mode (§12.0) */
  function kidError(msg, opts) {
    if (opts.easy) return String(opts.easy);
    const t = String(msg ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    if (!t || t.length > 34 || /[A-Z]{3,}|_[A-Z]|HTTP|Error|error|undefined|null|NaN|\bat\s|[{}<>]|코드|서버|네트워크|데이터|형식|시도/.test(t)) return '앗, 잘 안 됐어요. 다시 해 봐요!';
    return t;
  }
  /** remove one toast: exit animation, then FLIP the remaining stack into place (transform only, no layout jumps) */
  function dismissToast(el, instant) {
    if (!el || el.__gone) return;
    el.__gone = true;
    clearTimeout(el.__toastT);
    const root = el.parentElement;
    const finish = () => {
      if (!el.isConnected) return;
      const sibs = root ? Array.from(root.children).filter((t) => t !== el) : [];
      const before = (!reduced() && canAnimate()) ? sibs.map((t) => t.getBoundingClientRect().top) : null;
      el.remove();
      if (!before) return;
      sibs.forEach((t, i) => {
        const dy = before[i] - t.getBoundingClientRect().top;
        if (Math.abs(dy) > 0.5) anim(t, [{ transform: `translateY(${dy.toFixed(1)}px)` }, { transform: 'translateY(0)' }], { duration: MOTION.d3, easing: MOTION.out });
      });
    };
    if (instant || reduced()) { finish(); return; }
    el.classList.add('out');
    setTimeout(finish, MOTION.d2 + 20);
  }
  const heldToasts = [], heldSay = [];
  /** show the toasts held back during a cinematic (newest 4, one sound) */
  function releaseToasts() {
    const root = $('#toast-root');
    const list = heldToasts.splice(0), lines = heldSay.splice(0);
    if (!root || !list.length) return;
    list.forEach((t, i) => {
      if (t.el.__gone) return;
      setTimeout(() => {
        if (t.el.__gone) return;
        root.appendChild(t.el);
        const live = Array.from(root.children).filter((x) => !x.classList.contains('out'));
        for (let k = 0; k < live.length - 4; k++) dismissToast(live[k]);
        t.el.__toastT = setTimeout(() => dismissToast(t.el), t.dur);
      }, 160 * i);
    });
    const loud = list.find((t) => t.type === 'error' || t.type === 'reward' || t.sound !== false);
    if (loud) G.sfx(loud.type === 'reward' ? 'coin' : 'notify');
    if (lines.length && easyOn()) { try { G.easy?.say?.(lines[lines.length - 1], { interrupt: false }); } catch (e) { /* voice optional */ } }
  }
  G.bus.on('manjangdae:intro', ({ phase } = {}) => { if (phase === 'end') setTimeout(releaseToasts, 450); });
  function toast(msg, opts = {}) {
    const root = $('#toast-root');
    if (!root) return;
    const type = opts.type || 'info';
    const easy = easyOn();
    const kidErr = easy && type === 'error';
    let ico;
    if (kidErr) {
      let svg = '';
      try { svg = G.mascot?.svg?.('sad', 44) || ''; } catch (e) { svg = ''; }
      ico = typeof svg === 'string' && svg.trim().startsWith('<svg') ? h('span', { class: 't-ico t-face', html: svg }) : h('span', { class: 't-ico emoji' }, '🥺');
    } else {
      const icon = opts.emoji || (opts.icon ? null : TOAST_ICONS[type]);
      ico = icon ? h('span', { class: 't-ico emoji' }, icon) : h('span', { class: 't-ico ico', 'data-icon': opts.icon });
    }
    const text = kidErr ? kidError(msg, opts) : msg;
    const el = h('div', { class: `toast ${type}${kidErr ? ' kid' : ''}`, role: 'status', title: kidErr && text !== msg ? String(msg ?? '').slice(0, 200) : null },
      ico, h('span', { class: 't-msg', html: opts.html && !kidErr ? text : esc(text) }));
    if (typeof opts.retry === 'function') {
      const rb = h('button', { type: 'button', class: 'btn btn-sm t-retry' }, h('span', { class: 'emoji', 'aria-hidden': 'true' }, '🔄'), easy ? '다시' : '다시 시도');
      rb.addEventListener('click', () => { dismissToast(el, true); try { opts.retry(); } catch (e) { G.log.error('UI', 'toast retry', e); } });
      el.appendChild(rb);
      el.classList.add('has-btn');
    }
    const dur = opts.duration ?? (type === 'error' ? (easy ? 5500 : 4500) : easy ? 3400 : 2800);
    el.style.setProperty('--toast-life', `${Math.max(400, Number(dur) || 0)}ms`);
    // a cinematic owns the screen (정선 만장대 intro): hold the toast and show it when the cinematic ends
    if (document.body.classList.contains('md-intro') && !opts.urgent) {
      heldToasts.push({ el, dur, type, sound: opts.sound });
      while (heldToasts.length > 4) heldToasts.shift();
      if (easy && (kidErr || opts.say)) heldSay.push(typeof opts.say === 'string' ? opts.say : opts.html ? el.textContent : text);
      return el;
    }
    root.appendChild(el);
    // at most 4 live toasts: the oldest leaves (with its exit) and the stack closes up smoothly
    const live = Array.from(root.children).filter((t) => !t.classList.contains('out'));
    for (let i = 0; i < live.length - 4; i++) dismissToast(live[i]);
    el.__toastT = setTimeout(() => dismissToast(el), dur);
    if (type === 'error') G.sfx(easy ? 'notify' : 'error'); else if (type === 'reward') G.sfx('coin'); else if (opts.sound !== false) G.sfx('notify');
    if (easy && (kidErr || opts.say)) {
      const line = typeof opts.say === 'string' ? opts.say : opts.html ? el.textContent : text;
      try { G.easy?.say?.(line, { interrupt: false }); } catch (e) { /* voice optional */ }
    }
    if (kidErr && text !== msg) G.log.info('UI', 'error toast (simplified for easy mode):', String(msg ?? '').slice(0, 200));
    return el;
  }
  let bannerTimer = 0;
  /** top-center notice (reference image 3: "장독대의 빛나는 항아리를 클릭해 발효 상태를 확인하세요.") */
  function banner(text, opts = {}) {
    const el = $('#notice-banner');
    if (!el) return;
    clearTimeout(bannerTimer);
    if (!text) { el.hidden = true; return; }
    el.innerHTML = `<span class="ico ico-sm" data-icon="${opts.icon || 'info'}"></span><span>${opts.html ? text : esc(text)}</span>`;
    hydrateIcons(el);
    el.hidden = false;
    el.style.animation = 'none'; void el.offsetWidth; el.style.animation = '';
    if (opts.duration !== 0) bannerTimer = setTimeout(() => { el.hidden = true; }, opts.duration || 6000);
  }
  function zoneBanner(name, sub = '현재 위치') {
    const el = $('#zone-label');
    if (!el) return;
    el.querySelector('small').textContent = sub;
    el.querySelector('b').textContent = name;
    el.hidden = false;
    el.style.animation = 'none'; void el.offsetWidth; el.style.animation = '';
    clearTimeout(zoneBanner._t);
    zoneBanner._t = setTimeout(() => { el.hidden = true; }, 3700);
  }
  /** persistent "current objective" hint under the banner (quest system drives it) */
  function objective(text, opts = {}) {
    const el = $('#objective-hint');
    if (!el) return;
    if (!text) { el.hidden = true; return; }
    el.innerHTML = `<span class="oh-label">${esc(opts.label || '현재 목표')}</span><span class="oh-text">${esc(text)}</span>${opts.dist != null ? `<span class="oh-dist">${Math.round(opts.dist)}m</span>` : ''}`;
    el.hidden = false;
  }

  // ---------------------------------------------------------------- modal motion
  // Enter: the box grows out of the tap point (transform-origin at the button that opened it), then its content
  // staggers in once. Exit: the box steps out of every selector (`.modal` → `.modal-closing`, no role / aria-modal,
  // inert, data-kid-exempt) so scripts, tests and audits only ever see live dialogs, and fades/shrinks for 200 ms.
  const closingModals = new Set();
  function flushClosingModals() {
    for (const b of closingModals) { clearTimeout(b.__outT); b.remove(); }
    closingModals.clear();
  }
  function enterModal(m, origin, replacing) {
    const box = m.el, bd = m.backdrop;
    if (replacing) { bd.classList.add('no-enter'); return; }
    if (reduced()) {
      // opacity-only, very short (§13.5 reduce motion)
      bd.classList.add('no-enter');
      anim(bd, [{ opacity: 0 }, { opacity: 1 }], { duration: MOTION.d1, easing: 'linear' });
      return;
    }
    box.classList.add('is-entering');
    if (origin) {
      // untransformed layout box: the backdrop is the offsetParent and fills the viewport
      const ox = origin.x - box.offsetLeft, oy = origin.y - box.offsetTop;
      if (Number.isFinite(ox) && Number.isFinite(oy)) {
        box.style.transformOrigin = `${Math.round(ox)}px ${Math.round(oy)}px`;
        box.classList.add('from-origin');
      }
    }
    const body = m.body;
    stagger(Array.from(body.children).filter((c) => !c.matches('.list, .grid, .pick-grid')), { delay: 70, max: 6 });
    for (const g of body.querySelectorAll('.list, .grid, .pick-grid')) stagger(g, { delay: 110, max: 10, y: 10 });
    stagger(m.foot, { delay: 140, max: 4, y: 6 });
    // numbers marked data-countup roll up from 0 while the dialog arrives
    let k = 0;
    for (const el of body.querySelectorAll('[data-countup]')) {
      if (k++ > 24) break;
      countUp(el, Number(el.dataset.countup), { from: 0, delay: 160, duration: 900 });
    }
    clearTimeout(box.__enterT);
    box.__enterT = setTimeout(() => box.classList.remove('is-entering'), MOTION.d4 + 300);
  }
  function leaveModal(m, instant) {
    const box = m.el, bd = m.backdrop;
    clearTimeout(box.__enterT);
    if (instant || reduced() || !bd.isConnected) { bd.remove(); return; }
    // freeze the size the dialog has now (size rules hang on `.modal.<name>`), then step out of `.modal`
    const w = box.offsetWidth, hgt = box.offsetHeight;
    if (w > 0 && hgt > 0) { box.style.width = `${w}px`; box.style.height = `${hgt}px`; box.style.maxHeight = 'none'; }
    box.classList.remove('modal', 'is-entering');
    box.classList.add('modal-closing');
    box.removeAttribute('role'); box.removeAttribute('aria-modal');
    bd.setAttribute('aria-hidden', 'true');
    bd.setAttribute('data-kid-exempt', '');
    bd.inert = true;
    bd.classList.add('is-out');
    closingModals.add(bd);
    bd.__outT = setTimeout(() => { bd.remove(); closingModals.delete(bd); }, MOTION.d2 + 40);
  }

  // ---------------------------------------------------------------- modal stack
  const modalStack = [];
  const modal = {
    /**
     * open({ id, title, icon(emoji or icon name), body (html string | Node | (bodyEl, m) => void),
     *        actions:[{label, class:'btn-primary', onClick(m) -> false keeps open, close:true}],
     *        size:'sm'|'md'|'lg'|'xl', closable:true, blocking:true, className, onClose })
     */
    open(opts = {}) {
      // re-opening the same id is a re-render: swap instantly, no exit/entrance replay
      let replacing = false;
      if (opts.id) { const ex = modal.get(opts.id); if (ex) { ex.close({ instant: true }); replacing = true; } }
      flushClosingModals();
      const origin = replacing ? null : tapOrigin();
      const root = $('#modal-root');
      const backdrop = h('div', { class: 'modal-backdrop' });
      const box = h('div', { class: `modal ${opts.size ? 'modal-' + opts.size : ''} ${opts.className || ''}`, role: 'dialog', 'aria-modal': 'true' });
      const head = h('header', { class: 'modal-head' });
      const titleEl = h('h2');
      const setTitle = (t, icon) => {
        titleEl.innerHTML = '';
        if (icon) titleEl.appendChild(/^[a-z-]+$/.test(icon) ? h('span', { class: 'ico', 'data-icon': icon }) : h('span', { class: 'modal-icon emoji' }, icon));
        titleEl.appendChild(document.createTextNode(t || ''));
        hydrateIcons(titleEl);
      };
      setTitle(opts.title, opts.icon);
      // easy mode (§12.3): a big ⬅️ 닫기 at the top-left instead of the small ✖; CSS shows one or the other
      if (opts.closable !== false) head.appendChild(h('button', { type: 'button', class: 'easy-back easy-only', 'aria-label': '닫기', onclick: () => m.close() }, h('span', { class: 'emoji', 'aria-hidden': 'true' }, '⬅️'), h('span', { class: 'eb-lbl' }, '닫기')));
      head.appendChild(titleEl);
      const sayLine = () => (typeof opts.say === 'string' ? opts.say : titleEl.textContent);
      if (opts.say !== false) {
        const sb = h('button', { type: 'button', class: 'easy-speak easy-only modal-speak', 'aria-label': '소리로 듣기', title: '소리로 듣기' }, h('span', { class: 'emoji', 'aria-hidden': 'true' }, '🔊'));
        sb.addEventListener('click', () => { try { G.easy?.say?.(sayLine(), { force: true, priority: 1 }); } catch (e) { /* voice optional */ } });
        head.appendChild(sb);
      }
      if (opts.headExtra) head.appendChild(opts.headExtra);
      if (opts.closable !== false) head.appendChild(h('button', { class: 'icon-btn modal-x easy-hide', 'aria-label': '닫기', onclick: () => m.close() }, h('span', { class: 'ico', 'data-icon': 'x' })));
      const body = h('div', { class: 'modal-body' });
      const foot = h('footer', { class: 'modal-foot' });
      box.append(head, body, foot);
      backdrop.appendChild(box);
      const m = {
        id: opts.id || G.util.uid('modal'), el: box, body, foot, backdrop, opts, closed: false,
        setTitle, setBody(content) { body.innerHTML = ''; if (typeof content === 'string') body.innerHTML = content; else if (content instanceof Node) body.appendChild(content); hydrateIcons(body); },
        setActions(actions) {
          foot.innerHTML = '';
          for (const a of actions || []) {
            const b = h('button', { class: `btn ${a.class || ''}`, disabled: a.disabled || null }, a.icon ? h('span', { class: 'ico ico-sm', 'data-icon': a.icon }) : null, a.label);
            b.addEventListener('click', async () => {
              let keep = false;
              if (a.onClick) { try { keep = (await a.onClick(m, b)) === false; } catch (e) { G.log.error('UI', e); keep = true; } }
              if (!keep && a.close !== false) m.close();
            });
            foot.appendChild(b);
          }
        },
        close(how) {
          if (m.closed) return;
          m.closed = true;
          const i = modalStack.indexOf(m);
          if (i >= 0) modalStack.splice(i, 1);
          leaveModal(m, !!(how && how.instant));
          if (opts.blocking !== false) unblock('modal:' + m.id);
          if (!modalStack.length) document.body.classList.remove('modal-open');
          try { opts.onClose?.(m); } catch (e) { G.log.error('UI', e); }
          G.bus.emit('ui:modal-close', { id: m.id });
          G.sfx('close');
        },
      };
      if (typeof opts.body === 'function') opts.body(body, m);
      else if (opts.body != null) m.setBody(opts.body);
      m.setActions(opts.actions);
      if (opts.closable !== false && opts.backdropClose !== false) backdrop.addEventListener('pointerdown', (e) => { if (e.target === backdrop) m.close(); });
      root.appendChild(backdrop);
      enterModal(m, origin, replacing);
      modalStack.push(m);
      if (opts.blocking !== false) block('modal:' + m.id);
      document.body.classList.add('modal-open');
      hydrateIcons(box);
      G.bus.emit('ui:modal-open', { id: m.id, className: String(opts.className || '').slice(0, 120) });
      G.sfx('open');
      if (opts.say !== false && easyOn()) { try { G.easy?.say?.(sayLine(), { priority: 0 }); } catch (e) { /* voice optional */ } }
      // focus first input for keyboard users
      setTimeout(() => { const f = box.querySelector('[autofocus], input:not([type=hidden]), textarea, select'); if (f && opts.autofocus !== false) f.focus(); }, 30);
      return m;
    },
    get(id) { return modalStack.find((m) => m.id === id) || null; },
    isOpen(id) { return id ? !!modal.get(id) : modalStack.length > 0; },
    top() { return modalStack[modalStack.length - 1] || null; },
    closeTop() { const m = modal.top(); if (m && m.opts.closable !== false) { m.close(); return true; } return false; },
    closeAll() { for (const m of modalStack.slice().reverse()) m.close(); },
  };
  onEscape(() => modal.closeTop(), 100);

  function confirm(message, opts = {}) {
    if (easyOn() && !opts.html && G.easy?.confirm && opts.easy !== false) {
      const msg = String(message ?? '');
      const short = msg.length <= 30;
      return G.easy.confirm({
        emoji: opts.emoji || (opts.danger ? '⚠️' : '🤔'), heading: opts.title || '확인해요',
        title: short ? msg : (opts.title || '할까요?'), text: short ? '' : msg,
        yes: opts.okText || '좋아요', no: opts.cancelText || '아니요', danger: !!opts.danger,
      });
    }
    return new Promise((resolve) => {
      let done = false;
      const fin = (v) => { if (!done) { done = true; resolve(v); } };
      modal.open({
        title: opts.title || '확인', icon: opts.icon || 'help', size: 'sm', body: `<p>${opts.html ? message : esc(message)}</p>`,
        actions: [
          { label: opts.cancelText || '취소', class: 'btn-ghost', onClick: () => fin(false) },
          { label: opts.okText || '확인', class: opts.danger ? 'btn-danger' : 'btn-primary', onClick: () => fin(true) },
        ],
        onClose: () => fin(false),
      });
    });
  }
  function alert(message, opts = {}) {
    if (easyOn() && !opts.html && G.easy?.alert && opts.easy !== false) {
      const msg = String(message ?? '');
      const short = msg.length <= 30;
      return G.easy.alert({ emoji: opts.emoji || '💡', heading: opts.title || '알림', title: short ? msg : (opts.title || '알려 줄게요'), text: short ? '' : msg, ok: opts.okText || '알았어요' });
    }
    return new Promise((resolve) => {
      modal.open({ title: opts.title || '알림', icon: opts.icon || 'info', size: 'sm', body: `<p>${opts.html ? message : esc(message)}</p>`, actions: [{ label: opts.okText || '확인', class: 'btn-primary' }], onClose: () => resolve() });
    });
  }

  // ---------------------------------------------------------------- reward popup (queued)
  const rewardQueue = [];
  let rewardShowing = false;
  /** rewardPopup({ eyebrow:'QUEST CLEAR', title, coin, exp, edu, items:{ITEM:qty}, titleName, note }) */
  function rewardPopup(r) { rewardQueue.push(r); if (!rewardShowing) nextReward(); }
  function nextReward() {
    const r = rewardQueue.shift();
    if (!r) { rewardShowing = false; return; }
    rewardShowing = true;
    const root = $('#reward-root');
    const items = [];
    const easy = easyOn();
    // numbers roll up from 0 as each chip pops in (data-cu = the final value; textContent stays the real number
    // until the roll starts, so nothing is ever shown wrong if motion is off)
    const num = (v) => { const n = Math.max(0, Math.round(Number(v) || 0)); return `<b class="rp-num" data-cu="${n}">+${G.util.fmt(n)}</b>`; };
    if (r.coin) items.push(`<div class="rp-item"><span class="ico" data-icon="coin"></span>${num(r.coin)}</div>`);
    if (r.exp) items.push(`<div class="rp-item"><span class="emoji">✨</span>${easy ? '' : 'EXP '}${num(r.exp)}</div>`);
    if (r.edu) items.push(`<div class="rp-item"><span class="emoji">📘</span>${easy ? '' : '교육 '}${num(r.edu)}</div>`);
    for (const [id, q] of Object.entries(r.items || {})) {
      const it = G.data.items?.[id];
      items.push(`<div class="rp-item"><span class="emoji">${esc(it?.icon || '🎁')}</span>${esc(it?.name || id)} ×${Math.max(0, Math.round(Number(q) || 0))}</div>`);
    }
    if (r.titleName) items.push(`<div class="rp-item"><span class="emoji">🏅</span>칭호 「${esc(r.titleName)}」</div>`);
    const el = h('div', { class: 'reward-pop', role: 'alertdialog' });
    const eyebrow = easy ? '🎉 🎁 🎉' : (r.eyebrow || 'REWARD');
    el.innerHTML = `<div class="rp-eyebrow">${esc(eyebrow)}</div><h3>${esc(r.title || '보상 획득!')}</h3>${r.note && !easy ? `<p class="dim small">${esc(r.note)}</p>` : ''}<div class="rp-items">${items.join('') || '<span class="dim">🎉</span>'}</div><button class="btn btn-gold btn-lg">${easy ? '좋아요! 👍' : '확인'}</button>`;
    if (easy) el.classList.add('kid');
    hydrateIcons(el);
    root.innerHTML = '';
    root.appendChild(el);
    el.querySelectorAll('.rp-item').forEach((it, i) => it.style.setProperty('--i', String(i)));
    el.querySelectorAll('.rp-num[data-cu]').forEach((b, i) => countUp(b, Number(b.dataset.cu), { from: 0, prefix: '+', delay: 220 + i * 70, duration: 900 }));
    G.sfx(r.sound || 'reward');
    if (easy) { try { G.easy?.say?.(`${r.title || '선물을 받았어요'}!`, { priority: 1 }); } catch (e) { /* voice optional */ } }
    const close = () => {
      if (el.__closing) return;
      el.__closing = true;
      el.classList.add('out');
      setTimeout(() => { el.remove(); unblock('reward'); nextReward(); }, reduced() ? 0 : MOTION.d2 + 20);
      offEsc(); clearTimeout(auto);
    };
    el.querySelector('button').addEventListener('click', close);
    block('reward');
    const offEsc = onEscape(() => { close(); return true; }, 150);
    const auto = setTimeout(close, r.duration || (easy ? 8000 : 6000));
  }

  // ---------------------------------------------------------------- popovers (emote/gesture/weather pickers)
  let currentPopover = null;
  const popover = {
    /** open(anchorEl, contentNodeOrHtml, { id, placement:'top'|'bottom'|'left'|'right', onClose }) -> {el, close} ; toggles if same id */
    open(anchor, content, opts = {}) {
      if (currentPopover && opts.id && currentPopover.id === opts.id) { currentPopover.close(); return null; }
      popover.close();
      const root = $('#popover-root');
      // a popover still playing its exit goes now (scripts look for `#popover-root > *`)
      for (const old of Array.from(root?.querySelectorAll('.popover.is-out') || [])) old.remove();
      const el = h('div', { class: `popover ${opts.className || ''}`, 'data-place': opts.placement || 'top' });
      if (typeof content === 'string') el.innerHTML = content; else el.appendChild(content);
      hydrateIcons(el);
      root.appendChild(el);
      if (reduced()) el.style.animation = 'none';
      else for (const g of el.querySelectorAll('.pick-grid, .list')) stagger(g, { delay: 40, step: 16, max: 16, y: 6, scale: .9, duration: MOTION.d3 });
      const place = () => {
        // getBoundingClientRect of the popover itself would include its entrance scale: use the layout size
        const r = anchor.getBoundingClientRect();
        const pr = { width: el.offsetWidth, height: el.offsetHeight };
        const pl = opts.placement || 'top';
        let x = r.left + r.width / 2 - pr.width / 2, y = r.top - pr.height - 10;
        if (pl === 'bottom') y = r.bottom + 10;
        if (pl === 'right') { x = r.right + 10; y = r.top + r.height / 2 - pr.height / 2; }
        if (pl === 'left') { x = r.left - pr.width - 10; y = r.top + r.height / 2 - pr.height / 2; }
        x = G.util.clamp(x, 8, innerWidth - pr.width - 8);
        y = G.util.clamp(y, 8, innerHeight - pr.height - 8);
        el.style.left = x + 'px'; el.style.top = y + 'px';
      };
      place();
      anchor.classList?.add('active');
      const onDown = (e) => { if (!el.contains(e.target) && !anchor.contains(e.target)) p.close(); };
      setTimeout(() => document.addEventListener('pointerdown', onDown, true), 0);
      const p = currentPopover = {
        id: opts.id, el,
        close() {
          if (p.closed) return; p.closed = true;
          if (reduced() || !el.isConnected) el.remove();
          else {
            el.classList.add('is-out'); el.inert = true; el.setAttribute('aria-hidden', 'true'); el.setAttribute('data-kid-exempt', '');
            setTimeout(() => el.remove(), MOTION.d1 + 30);
          }
          anchor.classList?.remove('active');
          document.removeEventListener('pointerdown', onDown, true);
          if (currentPopover === p) currentPopover = null;
          opts.onClose?.();
        },
        reposition: place,
      };
      return p;
    },
    close() { currentPopover?.close(); },
    isOpen() { return !!currentPopover; },
  };
  onEscape(() => { if (currentPopover) { popover.close(); return true; } return false; }, 110);

  // ---------------------------------------------------------------- world labels
  const labels = new Set();
  const _v = new THREE.Vector3();
  /**
   * label({ html | el, className, target: Object3D | Vector3 | () => Vector3, offsetY: 0, maxDist: 60,
   *         minDist: 0, fadeDist: 0, visible: true, onClick })
   * -> { el, setHTML(html), setVisible(bool), remove(), opts }
   */
  function label(opts) {
    const layer = $('#labels-layer');
    const el = opts.el || h('div', { class: `wl ${opts.className || ''}`, html: opts.html || '' });
    if (!el.classList.contains('wl')) el.classList.add('wl');
    if (opts.onClick) { el.style.pointerEvents = 'auto'; el.style.cursor = 'pointer'; el.addEventListener('click', opts.onClick); }
    layer?.appendChild(el);
    const L = {
      el, opts, visible: opts.visible !== false,
      setHTML(html) { if (L._html !== html) { el.innerHTML = html; L._html = html; } },
      setVisible(v) { L.visible = !!v; if (!v) el.classList.add('hidden'); },
      remove() { el.remove(); labels.delete(L); },
    };
    labels.add(L);
    return L;
  }
  function updateLabels() {
    const eng = G.sys.engine;
    if (!eng || !eng.camera || !labels.size) return;
    const cam = eng.camera;
    const w = innerWidth, hgt = innerHeight;
    const cp = cam.position;
    for (const L of labels) {
      const o = L.opts;
      if (!L.visible) { L.el.classList.add('hidden'); continue; }
      const t = typeof o.target === 'function' ? o.target() : o.target;
      if (!t) { L.el.classList.add('hidden'); continue; }
      if (t.isObject3D) t.getWorldPosition(_v); else _v.copy(t);
      _v.y += o.offsetY || 0;
      const d = _v.distanceTo(cp);
      if (d > (o.maxDist ?? 60) || d < (o.minDist ?? 0)) { L.el.classList.add('hidden'); continue; }
      _v.project(cam);
      if (_v.z > 1 || _v.z < -1 || _v.x < -1.2 || _v.x > 1.2 || _v.y < -1.2 || _v.y > 1.2) { L.el.classList.add('hidden'); continue; }
      const x = (_v.x * 0.5 + 0.5) * w, y = (-_v.y * 0.5 + 0.5) * hgt;
      L.el.classList.remove('hidden');
      L.el.style.transform = `translate(-50%, -100%) translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
      if (o.fadeDist) L.el.style.opacity = String(G.util.clamp(((o.maxDist ?? 60) - d) / o.fadeDist, 0, 1));
      L.el.style.zIndex = String(1000 - Math.round(d));
    }
  }

  // ---------------------------------------------------------------- loading screen
  // The motion graphic (template + 01-hud.css): an onggi jar fills with 장 as `--p` (0..1) rises, steam curls from
  // the lid, the bar fill slides with transform, the % rolls smoothly towards the real value and tips cross-fade.
  const loading = {
    _tipTimer: 0,
    _shown: 0,
    _target: 0,
    _raf: 0,
    _lastTip: -1,
    show() {
      const el = $('#loading-screen');
      if (!el) return;
      el.hidden = false; el.classList.remove('done');
      loading._shown = 0; loading._target = 0;
      el.style.setProperty('--p', '0');
      loading.nextTip(true);
      clearInterval(loading._tipTimer);
      loading._tipTimer = setInterval(() => loading.nextTip(), 4200);
    },
    set(frac, text) {
      const f = G.util.clamp(Number(frac) || 0, 0, 1);
      const pct = Math.round(f * 100);
      const el = $('#loading-screen');
      // the fill (bar + jar) follows the real value; the number rolls there in the rAF below
      el?.style.setProperty('--p', f.toFixed(3));
      loading._target = pct;
      if (reduced() || !el || el.hidden) { loading._shown = pct; loading._paintPct(); }
      else if (!loading._raf) loading._raf = requestAnimationFrame(loading._tick);
      const l = $('#loading-label');
      if (l && text && l.textContent !== text) {
        l.textContent = text;
        if (!reduced()) anim(l, [{ opacity: 0.25, translate: '0 4px' }, { opacity: 1, translate: '0 0' }], { duration: MOTION.d2, easing: MOTION.out });
      }
      $('#loading-screen .loading-bar')?.setAttribute('aria-valuenow', String(pct));
    },
    _paintPct() { const p = $('#loading-pct'); if (p) p.textContent = `${loading._shown}%`; },
    _tick() {
      loading._raf = 0;
      const d = loading._target - loading._shown;
      if (d === 0) return;
      loading._shown += d > 0 ? Math.max(1, Math.round(d * 0.18)) : d;
      loading._paintPct();
      if (loading._shown !== loading._target) loading._raf = requestAnimationFrame(loading._tick);
    },
    nextTip(first) {
      const tips = G.data.tips || [];
      const el = $('#loading-tip');
      if (!tips.length || !el) return;
      let i = Math.floor(Math.random() * tips.length);
      if (tips.length > 1 && i === loading._lastTip) i = (i + 1) % tips.length;
      loading._lastTip = i;
      const [k, t] = tips[i];
      const paint = () => { el.innerHTML = `<b>${esc(k)}</b>${esc(t)}`; };
      if (first || reduced()) { paint(); return; }
      // cross-fade: out (200 ms) → swap → in (320 ms)
      el.classList.add('swap-out');
      setTimeout(() => { paint(); el.classList.remove('swap-out'); }, MOTION.d2);
    },
    hide() {
      const el = $('#loading-screen');
      clearInterval(loading._tipTimer);
      if (loading._raf) { cancelAnimationFrame(loading._raf); loading._raf = 0; }
      loading._shown = loading._target; loading._paintPct();
      if (!el) return;
      el.classList.add('done');
      setTimeout(() => { el.hidden = true; }, reduced() ? 0 : 650);
    },
  };

  // ---------------------------------------------------------------- fade / flash / hud
  function fade(on, ms = 350) {
    const el = $('#fade');
    if (!el) return Promise.resolve();
    el.style.transitionDuration = ms + 'ms';
    el.classList.toggle('on', !!on);
    return G.util.sleep(ms + 20);
  }
  async function fadeThrough(fn, ms = 300) { await fade(true, ms); try { await fn(); } finally { await fade(false, ms); } }
  /** a soft single white bloom (photosensitivity: eased in AND out, peak ≤ 0.55, never repeated; off with reduce motion) */
  function flash() {
    if (reduced()) return;
    const el = h('div', { style: { position: 'fixed', inset: '0', background: '#fff', zIndex: 95, pointerEvents: 'none', opacity: '0' } });
    document.body.appendChild(el);
    const a = anim(el, [{ opacity: 0 }, { opacity: 0.55, offset: 0.25 }, { opacity: 0 }], { duration: 520, easing: MOTION.inOut, fill: 'forwards' });
    setTimeout(() => el.remove(), a ? 560 : 0);
  }
  function setHudVisible(v) {
    const hud = $('#hud');
    if (hud) hud.hidden = !v;
    document.body.classList.toggle('in-game', !!v);
  }

  // ---------------------------------------------------------------- small render helpers
  /** progress bar html: bar(65, {cls:'bar-water', text:'65%'}) */
  function bar(value, opts = {}) { const v = G.util.clamp(Number(value) || 0, 0, 100); return `<div class="bar ${opts.cls || ''} ${opts.lg ? 'bar-lg' : ''}"><i style="width:${v}%"></i>${opts.text ? `<span>${esc(opts.text)}</span>` : ''}</div>`; }
  function itemIcon(id) { return G.data.items?.[id]?.icon || '❔'; }
  function itemName(id) { return G.data.items?.[id]?.name || id; }
  /** set a `.bar` (or its `<i>` fill) to pct 0..100 — transform-based, animated (instant with reduce motion) */
  function setBar(el, pct) {
    const i = el?.matches?.('.bar') ? el.querySelector(':scope > i') : el;
    if (!i) return;
    i.style.width = `${G.util.clamp(Number(pct) || 0, 0, 100)}%`;
    syncBar(i);
  }

  // tabs: a 3 px ink slides under the active tab (translate + scaleX of a fixed 100 px line — transform only)
  const inkRO = typeof ResizeObserver === 'function' ? new ResizeObserver((entries) => {
    for (const e of entries) {
      const c = e.target;
      if (!c.isConnected) { inkRO.unobserve(c); continue; }
      c.__placeInk?.(true);
    }
  }) : null;
  /** tabs(container, [{id,label}], onChange, activeId) -> {set(id)} */
  function tabs(container, list, onChange, active) {
    container.classList.add('tabs');
    container.innerHTML = '';
    const btns = list.map((t) => { const b = h('button', { class: 'tab', type: 'button', dataset: { tab: t.id } }, t.icon ? h('span', { class: 'emoji' }, t.icon + ' ') : null, t.label); b.addEventListener('click', () => set(t.id)); container.appendChild(b); return b; });
    const ink = h('i', { class: 'tab-ink', 'aria-hidden': 'true' });
    container.appendChild(ink);
    let cur = null, tries = 0;
    const place = (snap) => {
      const b = btns.find((x) => x.dataset.tab === cur);
      if (!b || !container.isConnected || !b.offsetWidth) {
        ink.classList.remove('on');
        // not laid out yet (built before the dialog is attached): try again on the next frames
        if (b && tries++ < 30) requestAnimationFrame(() => place(true));
        return;
      }
      tries = 0;
      const first = !ink.classList.contains('on');
      if (snap || first || reduced()) ink.classList.add('snap');
      ink.style.setProperty('--ink-x', `${b.offsetLeft}px`);
      ink.style.setProperty('--ink-y', `${Math.max(0, container.clientHeight - 2)}px`);
      ink.style.setProperty('--ink-s', (b.offsetWidth / 100).toFixed(3));
      ink.classList.add('on');
      if (ink.classList.contains('snap')) requestAnimationFrame(() => requestAnimationFrame(() => ink.classList.remove('snap')));
    };
    container.__placeInk = place;
    inkRO?.observe(container);
    function set(id) {
      cur = id;
      btns.forEach((b) => b.classList.toggle('active', b.dataset.tab === id));
      place(false);
      onChange?.(id);
    }
    if (active ?? list[0]?.id) set(active ?? list[0].id);
    return { set };
  }

  // ---------------------------------------------------------------- progress bars → transform-based fills
  // Modules write `<i style="width:N%">` (HTML strings) or `fill.style.width = …`. A MutationObserver on the UI roots
  // turns every such bar into `.bar.fx` (full-width fill, translateX by --p) so changes slide with ease-out-quint and
  // a soft sheen, and no layout property is ever animated. New bars inside a dialog that is arriving fill from 0.
  const pendingSnap = new Set();
  let snapRaf = 0;
  function flushSnaps() {
    snapRaf = 0;
    for (const bar of pendingSnap) {
      bar.classList.remove('fx-instant');
      const v = bar.__barTo;
      if (v != null) { bar.style.setProperty('--p', String(v)); bar.__barTo = null; }
    }
    pendingSnap.clear();
  }
  function syncBar(i) {
    const bar = i?.parentElement;
    if (!bar || !bar.classList.contains('bar')) return;
    const w = i.style.width;
    const v = w && w.endsWith('%') ? parseFloat(w) : NaN;
    if (!Number.isFinite(v)) { if (bar.classList.contains('fx')) { bar.classList.remove('fx'); i.__p = undefined; } return; }
    const p = G.util.clamp(v, 0, 100);
    if (i.__p === p) return;
    const prev = i.__p;
    i.__p = p;
    if (prev === undefined) {
      // first sight: snap (no transition) — or, inside a dialog that is arriving, fill up from 0
      const arriving = !reduced() && !!bar.closest('.modal.is-entering, .reward-pop, .popover');
      bar.classList.add('fx', 'fx-instant');
      bar.style.setProperty('--p', arriving ? '0' : String(p));
      bar.__barTo = arriving ? p : null;
      pendingSnap.add(bar);
      if (!snapRaf) snapRaf = requestAnimationFrame(() => { snapRaf = requestAnimationFrame(flushSnaps); });
      return;
    }
    bar.style.setProperty('--p', String(p));
    if (!reduced() && Math.abs(p - prev) >= 1) {
      bar.classList.remove('sheen');
      clearTimeout(bar.__sheenT);
      requestAnimationFrame(() => { bar.classList.add('sheen'); bar.__sheenT = setTimeout(() => bar.classList.remove('sheen'), 950); });
    }
  }
  function scanBars(node) {
    if (!node || node.nodeType !== 1) return;
    if (node.tagName === 'I' && node.parentElement?.classList.contains('bar')) { watchFill(node); return; }
    if (!node.firstElementChild) return;
    for (const i of node.querySelectorAll('.bar > i')) watchFill(i);
  }
  const fillObs = typeof MutationObserver === 'function' ? new MutationObserver((recs) => { for (const r of recs) syncBar(r.target); }) : null;
  function watchFill(i) {
    if (!i.__barWatched) { i.__barWatched = true; fillObs?.observe(i, { attributes: true, attributeFilter: ['style'] }); }
    syncBar(i);
  }
  const treeObs = typeof MutationObserver === 'function' ? new MutationObserver((recs) => {
    for (const r of recs) for (const n of r.addedNodes) scanBars(n);
  }) : null;

  // ---------------------------------------------------------------- HUD life: number ticks, panel reveals
  function hudLife() {
    // coins / edu / level: a calm gold glow while the number is changing (count-ups run elsewhere)
    const tick = (el, host) => {
      if (!el || typeof MutationObserver !== 'function') return;
      new MutationObserver(() => {
        host.classList.add('tick');
        clearTimeout(host.__tickT);
        host.__tickT = setTimeout(() => host.classList.remove('tick'), 420);
      }).observe(el, { childList: true, characterData: true, subtree: true });
    };
    tick($('#hud-coin'), $('#hud-coin')?.closest('.cur-coin') || $('#hud-coin'));
    tick($('#hud-edu'), $('#hud-edu')?.closest('.cur-edu') || $('#hud-edu'));
    const lv = $('#hud-level');
    if (lv && typeof MutationObserver === 'function') {
      let last = lv.textContent;
      new MutationObserver(() => { if (lv.textContent !== last) { last = lv.textContent; pulse(lv, { scale: 1.18, duration: MOTION.d4 }); } })
        .observe(lv, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ['data-n'] });
    }
    // a collapsed HUD panel that opens again: its content settles in once
    if (typeof MutationObserver === 'function') {
      const panels = ['#minimap-panel', '#quest-panel', '#chat-panel'].map((s) => $(s)).filter(Boolean);
      const ro = new MutationObserver((recs) => {
        for (const r of recs) {
          const p = r.target;
          const was = (r.oldValue || '').split(/\s+/).includes('collapsed');
          if (was && !p.classList.contains('collapsed') && !reduced()) {
            p.classList.add('panel-reveal');
            clearTimeout(p.__revT);
            p.__revT = setTimeout(() => p.classList.remove('panel-reveal'), MOTION.d3 + 60);
          }
        }
      });
      for (const p of panels) ro.observe(p, { attributes: true, attributeFilter: ['class'], attributeOldValue: true });
    }
  }
  // UI roots whose bars become transform-based (not #labels-layer / #dialogue-root: they change every frame)
  const BAR_ROOTS = ['#hud', '#modal-root', '#screen-root', '#popover-root', '#reward-root'];
  const LATE_ROOTS = new Set(['devcenter']); // panels appended to #app later (80-devcenter)
  function startMotionObservers() {
    if (treeObs) {
      for (const sel of BAR_ROOTS) {
        const r = $(sel);
        if (!r) continue;
        treeObs.observe(r, { childList: true, subtree: true });
        scanBars(r);
      }
      const app = $('#app');
      if (app && typeof MutationObserver === 'function') {
        new MutationObserver((recs) => {
          for (const r of recs) for (const n of r.addedNodes) {
            if (n.nodeType === 1 && LATE_ROOTS.has(n.id) && !n.__barRoot) { n.__barRoot = true; treeObs.observe(n, { childList: true, subtree: true }); scanBars(n); }
          }
        }).observe(app, { childList: true });
      }
    }
    hudLife();
  }

  G.ui = {
    $, $$, h, esc, fmt: G.util.fmt, hydrateIcons, setIcon,
    block, unblock, isBlocking, onEscape, handleEscape, blockers,
    onAction, triggerAction, setActive, setBadge, getBadge,
    toast, banner, zoneBanner, objective,
    modal, confirm, alert, rewardPopup, popover,
    label, updateLabels, labels,
    loading, fade, fadeThrough, flash, setHudVisible,
    bar, setBar, itemIcon, itemName, tabs,
    // motion system (§13.5)
    motion: MOTION, reducedMotion: reduced, tapOrigin, stagger, countUp, pulse, skeleton, dismissToast,
  };

  // hydrate static template icons asap; start the bar / HUD motion observers once the template exists
  const boot = () => { hydrateIcons(document); try { startMotionObservers(); } catch (e) { G.log.warn('UI', 'motion observers', e); } };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
  const addr = document.getElementById('minimap-address');
  if (addr && G.data.meta) { addr.textContent = G.data.meta.address; addr.title = G.data.meta.addressNote; }
})();
