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
// =============================================================================
(function () {
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const esc = G.util.escapeHtml;

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
      if (!badge) { badge = h('span', { class: 'badge' }); b.appendChild(badge); }
      badge.textContent = count > 99 ? '99+' : String(count);
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
      rb.addEventListener('click', () => { el.remove(); try { opts.retry(); } catch (e) { G.log.error('UI', 'toast retry', e); } });
      el.appendChild(rb);
      el.classList.add('has-btn');
    }
    root.appendChild(el);
    while (root.children.length > 4) root.firstChild.remove();
    const dur = opts.duration ?? (type === 'error' ? (easy ? 5500 : 4500) : easy ? 3400 : 2800);
    setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 260); }, dur);
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

  // ---------------------------------------------------------------- modal stack
  const modalStack = [];
  const modal = {
    /**
     * open({ id, title, icon(emoji or icon name), body (html string | Node | (bodyEl, m) => void),
     *        actions:[{label, class:'btn-primary', onClick(m) -> false keeps open, close:true}],
     *        size:'sm'|'md'|'lg'|'xl', closable:true, blocking:true, className, onClose })
     */
    open(opts = {}) {
      if (opts.id) { const ex = modal.get(opts.id); if (ex) ex.close(); }
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
        close() {
          if (m.closed) return;
          m.closed = true;
          const i = modalStack.indexOf(m);
          if (i >= 0) modalStack.splice(i, 1);
          backdrop.remove();
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
      modalStack.push(m);
      if (opts.blocking !== false) block('modal:' + m.id);
      document.body.classList.add('modal-open');
      hydrateIcons(box);
      G.bus.emit('ui:modal-open', { id: m.id });
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
    if (r.coin) items.push(`<div class="rp-item"><span class="ico" data-icon="coin"></span>+${G.util.fmt(r.coin)}</div>`);
    if (r.exp) items.push(`<div class="rp-item"><span class="emoji">✨</span>${easy ? '' : 'EXP '}+${G.util.fmt(r.exp)}</div>`);
    if (r.edu) items.push(`<div class="rp-item"><span class="emoji">📘</span>${easy ? '' : '교육 '}+${G.util.fmt(r.edu)}</div>`);
    for (const [id, q] of Object.entries(r.items || {})) {
      const it = G.data.items?.[id];
      items.push(`<div class="rp-item"><span class="emoji">${it?.icon || '🎁'}</span>${esc(it?.name || id)} ×${q}</div>`);
    }
    if (r.titleName) items.push(`<div class="rp-item"><span class="emoji">🏅</span>칭호 「${esc(r.titleName)}」</div>`);
    const el = h('div', { class: 'reward-pop', role: 'alertdialog' });
    const eyebrow = easy ? '🎉 🎁 🎉' : (r.eyebrow || 'REWARD');
    el.innerHTML = `<div class="rp-eyebrow">${esc(eyebrow)}</div><h3>${esc(r.title || '보상 획득!')}</h3>${r.note && !easy ? `<p class="dim small">${esc(r.note)}</p>` : ''}<div class="rp-items">${items.join('') || '<span class="dim">🎉</span>'}</div><button class="btn btn-gold btn-lg">${easy ? '좋아요! 👍' : '확인'}</button>`;
    if (easy) el.classList.add('kid');
    hydrateIcons(el);
    root.innerHTML = '';
    root.appendChild(el);
    G.sfx(r.sound || 'reward');
    if (easy) { try { G.easy?.say?.(`${r.title || '선물을 받았어요'}!`, { priority: 1 }); } catch (e) { /* voice optional */ } }
    const close = () => { el.classList.add('out'); setTimeout(() => { el.remove(); unblock('reward'); nextReward(); }, 220); offEsc(); clearTimeout(auto); };
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
      const el = h('div', { class: `popover ${opts.className || ''}` });
      if (typeof content === 'string') el.innerHTML = content; else el.appendChild(content);
      hydrateIcons(el);
      root.appendChild(el);
      const place = () => {
        const r = anchor.getBoundingClientRect();
        const pr = el.getBoundingClientRect();
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
          el.remove(); anchor.classList?.remove('active');
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
  const loading = {
    _tipTimer: 0,
    show() {
      const el = $('#loading-screen');
      if (!el) return;
      el.hidden = false; el.classList.remove('done');
      loading.nextTip();
      clearInterval(loading._tipTimer);
      loading._tipTimer = setInterval(loading.nextTip, 4200);
    },
    set(frac, text) {
      const pct = Math.round(G.util.clamp(frac, 0, 1) * 100);
      const fill = $('#loading-bar-fill'); if (fill) fill.style.width = pct + '%';
      const p = $('#loading-pct'); if (p) p.textContent = pct + '%';
      const l = $('#loading-label'); if (l && text) l.textContent = text;
      $('#loading-screen .loading-bar')?.setAttribute('aria-valuenow', String(pct));
    },
    nextTip() {
      const tips = G.data.tips || [];
      if (!tips.length) return;
      const [k, t] = tips[Math.floor(Math.random() * tips.length)];
      const el = $('#loading-tip'); if (el) el.innerHTML = `<b>${esc(k)}</b>${esc(t)}`;
    },
    hide() {
      const el = $('#loading-screen');
      clearInterval(loading._tipTimer);
      if (!el) return;
      el.classList.add('done');
      setTimeout(() => { el.hidden = true; }, 650);
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
  function flash() {
    const el = h('div', { style: { position: 'fixed', inset: '0', background: '#fff', zIndex: 95, pointerEvents: 'none', opacity: '0.9', transition: 'opacity .35s ease' } });
    document.body.appendChild(el);
    requestAnimationFrame(() => { el.style.opacity = '0'; });
    setTimeout(() => el.remove(), 420);
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
  /** tabs(container, [{id,label}], onChange, activeId) -> {set(id)} */
  function tabs(container, list, onChange, active) {
    container.classList.add('tabs');
    container.innerHTML = '';
    const btns = list.map((t) => { const b = h('button', { class: 'tab', type: 'button', dataset: { tab: t.id } }, t.icon ? h('span', { class: 'emoji' }, t.icon + ' ') : null, t.label); b.addEventListener('click', () => set(t.id)); container.appendChild(b); return b; });
    function set(id) { btns.forEach((b) => b.classList.toggle('active', b.dataset.tab === id)); onChange?.(id); }
    if (active ?? list[0]?.id) set(active ?? list[0].id);
    return { set };
  }

  G.ui = {
    $, $$, h, esc, fmt: G.util.fmt, hydrateIcons, setIcon,
    block, unblock, isBlocking, onEscape, handleEscape, blockers,
    onAction, triggerAction, setActive, setBadge, getBadge,
    toast, banner, zoneBanner, objective,
    modal, confirm, alert, rewardPopup, popover,
    label, updateLabels, labels,
    loading, fade, fadeThrough, flash, setHudVisible,
    bar, itemIcon, itemName, tabs,
  };

  // hydrate static template icons asap
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => hydrateIcons(document));
  else hydrateIcons(document);
  const addr = document.getElementById('minimap-address');
  if (addr && G.data.meta) { addr.textContent = G.data.meta.address; addr.title = G.data.meta.addressNote; }
})();
