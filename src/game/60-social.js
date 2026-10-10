// =============================================================================
// 60-social.js — chat, speech bubbles, emotes & gestures, simulated visitors (local mode), presence + chat
//                polling (server mode), voice dictation  (G.sys.social, order 80)
//
//   G.sys.social.others        Map id -> {id, name, kind:'visitor'|'remote', group, rig, position, rotY, zoneId}
//   G.sys.social.online        number of people online (me + others)
//   G.sys.social.messages      chat history (max 120): {id, name, text, channel:'all'|'local'|'system'|'npc', at, self, kind}
//   system(text) / npcSay(name, text) / sendChat(text, channel='all') -> bool / say(text) (my bubble)
//   emote(id) / gesture(id) / openEmotes(anchor?) / openGestures(anchor?) / toggleVoice()
//   setTab('all'|'local'|'system') / toggleChat(force?) / collapse(bool) / focusChat()
//   block(name) / unblock(name) / isBlocked(name) / report({name, id, text})
//   filter(text) -> bad words masked with '♡♡'
// Actions: chat, chat-collapse, emote, gesture, voice · Hotkeys: Enter (chat), T (emotes), G (gestures), 1–8 in a picker.
// Events: chat:sent {text, channel} · chat:message {msg} · emote:played {emoteId} · gesture:played {gestureId}
//
// Local mode: 8–11 visitors (G.avatar) walk a navigation graph built from the layout (paths, plaza, a coarse
// walkability grid and destination spots; A* + line-of-sight smoothing + local avoidance), sit on benches,
// water plots, pose at photo zones, chat in pairs, say lines from G.data.visitors.lines, react to the player's
// emotes / greetings / questions, and occasionally leave or arrive.
// Server mode (G.net.mode === 'server'): presence/update.php every 2 s (remote avatars with interpolation),
// chat/list.php?after= every 3 s, chat/send.php, chat/report.php; exponential back-off on network errors;
// guests (no account) can only read.
// =============================================================================
(function () {
  const U = G.util;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const damp = (l, dt) => 1 - Math.exp(-l * dt);
  const angleDiff = (a, b) => U.angleDiff(a, b);
  const TAU = Math.PI * 2;
  const esc = U.escapeHtml;

  const MAX_MSG = 120, MAX_LEN = 120, RATE_MS = 1200, LOCAL_R = 30;
  const LABEL_DIST = 40, HIDE_DIST = 120;
  const DEFLECT = [0, 0.5, -0.5, 1.0, -1.0, 1.5, -1.5]; // heading offsets tried when the way ahead is blocked
  const LS_COLLAPSED = 'tfm.v1.chat.collapsed', LS_TAB = 'tfm.v1.chat.tab', LS_REPORTS = 'tfm.v1.chat.reports';
  const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* storage blocked */ } };

  // fallbacks (G.data.visitors provides the main content)
  const FALLBACK = {
    mention: ['네, 불러 주셨어요? 😊', '저요? ㅎㅎ 반가워요!', '네~ 무슨 일이세요?'],
    agree: ['맞아요!', '저도요 ㅎㅎ', '좋아요~', '오 정말요?', '그러게요 ㅎㅎ'],
    congrats: ['레벨 업 축하해요! 🎉', '와, 축하드려요!', '축하합니다~ 👏'],
    chat: ['안녕하세요!', '멋진 공간이네요!', '오늘 날씨가 좋네요!'],
    greet: ['안녕하세요!', '반갑습니다!'], thanks: ['천만에요!'], question: ['저도 궁금해요!'],
  };

  // ---------------------------------------------------------------- korean particles
  function hasFinal(word) {
    const s = String(word ?? '').replace(/[\s)\]"'’”」』>]+$/, '');
    if (!s) return false;
    const c = s.charCodeAt(s.length - 1);
    if (c >= 0xac00 && c <= 0xd7a3) return (c - 0xac00) % 28 > 0;
    return /[013678lmnr]$/i.test(s);
  }
  function finalIsRieul(word) {
    const s = String(word ?? '').trim();
    const c = s.charCodeAt(s.length - 1);
    return c >= 0xac00 && c <= 0xd7a3 && (c - 0xac00) % 28 === 8;
  }
  const J = {
    iga: (w) => w + (hasFinal(w) ? '이' : '가'),
    eulreul: (w) => w + (hasFinal(w) ? '을' : '를'),
    euro: (w) => w + (hasFinal(w) && !finalIsRieul(w) ? '으로' : '로'),
    nim: (w) => w + '님',
  };

  function nameHue(name) { return U.hashInt(String(name)) % 360; }
  function nameColor(name) { return `hsl(${nameHue(name)} 78% 74%)`; }
  function hhmm(ts) { const d = new Date(ts); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; }

  // ================================================================= navigation graph for visitors
  const NAV = { nodes: [], cell: 10, hash: new Map(), crops: [], ready: false, bounds: { minX: -84, maxX: 88, minZ: -104, maxZ: 86 } };
  const hkey = (cx, cz) => cx * 7919 + cz;
  function inCrop(x, z) {
    for (const c of NAV.crops) if (Math.abs(x - c.x) < c.hw && Math.abs(z - c.z) < c.hd) return true;
    return false;
  }
  /** ground height for a visitor stepping onto (x, z) from fromY, or null when not walkable */
  function walkY(x, z, fromY, r = 0.38) {
    const W = G.world, b = NAV.bounds;
    if (!(x > b.minX && x < b.maxX && z > b.minZ && z < b.maxZ)) return null;
    if (inCrop(x, z)) return null;
    if (W.blocked(x, z, r, fromY)) return null; // also rejects water
    const y = W.heightAt(x, z, fromY + 0.35);
    if (!Number.isFinite(y) || Math.abs(y - fromY) > 0.52) return null;
    return y;
  }
  function segClear(ax, az, ay, bx, bz) {
    const d = Math.hypot(bx - ax, bz - az);
    const n = Math.max(1, Math.ceil(d / 0.6));
    let y = ay;
    for (let i = 1; i <= n; i++) {
      const k = i / n;
      const ny = walkY(ax + (bx - ax) * k, az + (bz - az) * k, y);
      if (ny == null) return null;
      y = ny;
    }
    return y;
  }
  function navNear(x, z, r) {
    const out = [], c = NAV.cell;
    for (let cx = Math.floor((x - r) / c); cx <= Math.floor((x + r) / c); cx++)
      for (let cz = Math.floor((z - r) / c); cz <= Math.floor((z + r) / c); cz++) {
        const list = NAV.hash.get(hkey(cx, cz));
        if (list) for (const i of list) { const n = NAV.nodes[i]; const dd = Math.hypot(n.x - x, n.z - z); if (dd <= r) out.push([dd, n]); }
      }
    out.sort((a, b) => a[0] - b[0]);
    return out;
  }
  function nearestNode(x, z, y) {
    const cand = navNear(x, z, 14);
    let tries = 0;
    for (const [, n] of cand) {
      if (!n.main) continue;
      if (segClear(x, z, y, n.x, n.z) != null) return n;
      if (++tries >= 7) break;
    }
    return null;
  }
  /** A* over the graph -> array of nodes or null */
  function astar(start, goal) {
    if (!start || !goal) return null;
    if (start === goal) return [start];
    const N = NAV.nodes.length;
    const g = new Float64Array(N).fill(Infinity), from = new Int32Array(N).fill(-1), closed = new Uint8Array(N);
    const heap = []; // [f, idx]
    const push = (f, i) => { heap.push([f, i]); let k = heap.length - 1; while (k > 0) { const p = (k - 1) >> 1; if (heap[p][0] <= heap[k][0]) break; [heap[p], heap[k]] = [heap[k], heap[p]]; k = p; } };
    const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let k = 0; for (;;) { const l = 2 * k + 1, r = l + 1; let m = k; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === k) break; [heap[m], heap[k]] = [heap[k], heap[m]]; k = m; } } return top; };
    g[start.i] = 0; push(Math.hypot(goal.x - start.x, goal.z - start.z), start.i);
    while (heap.length) {
      const [, i] = pop();
      if (closed[i]) continue;
      if (i === goal.i) break;
      closed[i] = 1;
      const n = NAV.nodes[i];
      for (const [j, c] of n.adj) {
        if (closed[j]) continue;
        const ng = g[i] + c;
        if (ng < g[j]) { g[j] = ng; from[j] = i; const m = NAV.nodes[j]; push(ng + Math.hypot(goal.x - m.x, goal.z - m.z), j); }
      }
    }
    if (from[goal.i] < 0) return null;
    const path = [];
    for (let i = goal.i; i >= 0; i = from[i]) { path.push(NAV.nodes[i]); if (i === start.i) break; }
    return path.reverse();
  }

  // ================================================================= the system
  const social = {
    name: 'social', order: 80, label: '커뮤니티',
    others: new Map(),
    messages: [],
    tab: 'all',
    spots: [],
    _seq: 0, _chat: null, _stick: true, _unread: 0, _lastSent: -1e9, _lastText: '', _repeat: 0,
    _me: null, _picker: null, _rec: null, _badRe: null,
    _pool: [], _target: 0, _vroot: null, _lineT: 12, _cycleT: 200, _joinT: -1, _recentLines: [], _replyT: 0,
    _sessionKey: null, _loggedOut: true, _mode: 'local', _srv: null, _timers: new Set(),
    _lastEmote: -1e9, _emoteSeq: 0, _emoteState: null,
    stats: { plans: 0, planFails: 0, arrivals: 0, stuck: 0, lines: 0, replies: 0, joins: 0, leaves: 0 },

    get online() { return 1 + this.others.size; },

    // ------------------------------------------------------------ lifecycle
    init() {
      this._buildFilter();
      this._initChat();
      this._initActions();
      this._initMyBubble();
      this._initVisitors();
      this._initEvents();
      this._updateOnline();
    },

    async postInit() {
      try { await this._buildNav(); } catch (e) { G.log.warn('SOCIAL', 'navigation graph failed', e); }
    },

    onStateLoaded(state) {
      const mode = G.net?.mode === 'server' ? 'server' : 'local';
      const key = `${state?.profile?.id || 'guest'}|${mode}`;
      const fresh = this._loggedOut || key !== this._sessionKey;
      this._sessionKey = key;
      this._loggedOut = false;
      if (state && !Array.isArray(state.blocked)) state.blocked = [];
      if (fresh) {
        this._stopServer();
        this._clearRemotes();
        this._mode = mode;
        this._resetChat();
        this._seedChat();
        if (mode === 'local') this._spawnVisitors(); else { this._despawnVisitors(); this._startServer(); }
        this._clearMyBubble();
      } else {
        this._refreshBlocked(); // re-applied state (reset / import): keep the session going
      }
      this._applyChatVisibility();
      this._updateGuestUi();
      this._updateOnline();
    },

    onLogout() {
      this._loggedOut = true;
      this._stopServer();
      this._clearRemotes();
      this._despawnVisitors();
      this._closePicker();
      this.stopVoice();
      this._clearMyBubble();
      for (const t of this._timers) clearTimeout(t);
      this._timers.clear();
      document.body.classList.remove('show-chat');
      this._updateOnline();
    },

    _later(ms, fn) {
      const id = setTimeout(() => { this._timers.delete(id); try { fn(); } catch (e) { G.log.error('SOCIAL', e); } }, ms);
      this._timers.add(id);
      return id;
    },

    // ================================================================ chat
    _initChat() {
      const panel = document.getElementById('chat-panel');
      const log = document.getElementById('chat-log');
      const form = document.getElementById('chat-form');
      const input = document.getElementById('chat-input');
      if (!panel || !log || !form || !input) { G.log.warn('UI', 'chat DOM missing'); return; }
      const h = G.ui.h;
      const C = this._chat = { panel, log, form, input, send: form.querySelector('button[type="submit"]'), tabs: Array.from(panel.querySelectorAll('.chat-tabs [data-channel]')) };
      input.setAttribute('enterkeyhint', 'send');
      input.maxLength = MAX_LEN;
      C.placeholder = input.getAttribute('placeholder') || '메시지를 입력하세요...';
      // header extras: unread counter (collapsed) + collapse icon state
      C.collapseBtn = panel.querySelector('[data-action="chat-collapse"]');
      C.unread = h('span', { class: 'chat-unread', hidden: true });
      C.collapseBtn?.before(C.unread);
      // "new messages" pill when scrolled up
      C.pill = h('button', { class: 'chat-new', type: 'button', hidden: true }, '새 메시지', h('span', { class: 'ico ico-xs', 'data-icon': 'chevron-down' }));
      C.pill.addEventListener('click', () => this._scrollBottom(true));
      panel.insertBefore(C.pill, form);
      // voice indicator + length counter inside the form
      C.voiceInd = h('span', { class: 'chat-voice-ind', hidden: true, title: '음성 인식 중' }, h('i'), h('i'), h('i'));
      form.insertBefore(C.voiceInd, input);
      C.count = h('span', { class: 'chat-count', hidden: true });
      form.insertBefore(C.count, C.send);

      for (const b of C.tabs) {
        b.setAttribute('type', 'button');
        b.addEventListener('click', () => this.setTab(b.dataset.channel));
      }
      log.addEventListener('scroll', () => {
        this._stick = log.scrollHeight - log.scrollTop - log.clientHeight < 28;
        if (this._stick) C.pill.hidden = true;
      }, { passive: true });
      log.addEventListener('click', (e) => {
        const who = e.target.closest('.who');
        if (!who || who.dataset.kind === 'system' || who.dataset.kind === 'me') return;
        e.stopPropagation();
        // open beside the chat panel, level with the clicked name
        const pr = panel.getBoundingClientRect(), wr = who.getBoundingClientRect();
        const anchor = { getBoundingClientRect: () => ({ left: pr.right, right: pr.right, width: 0, top: wr.top, bottom: wr.bottom, height: wr.height }), contains: (n) => who.contains(n) };
        this._openUser(anchor, { name: who.dataset.name, kind: who.dataset.kind, id: who.dataset.uid || null, msgId: who.closest('.chat-msg')?.dataset.id || null });
      });
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const v = input.value;
        if (!v.trim()) { input.blur(); return; }
        const ch = this.tab === 'local' ? 'local' : 'all';
        if (this.sendChat(v, ch)) {
          input.value = '';
          this._updateCount();
          input.blur();
          if (this.tab === 'system') this.setTab('all');
        }
      });
      input.addEventListener('input', () => this._updateCount());
      input.addEventListener('focus', () => { panel.classList.add('typing'); this._markRead(); });
      input.addEventListener('blur', () => panel.classList.remove('typing'));
      // stop key presses inside the input from reaching gameplay shortcuts (input module already ignores while typing)
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.isComposing) e.stopPropagation(); });

      if (lsGet(LS_COLLAPSED, '0') === '1') this.collapse(true, { silent: true });
      const t = lsGet(LS_TAB, 'all');
      this.setTab(['all', 'local', 'system'].includes(t) ? t : 'all', { silent: true });
      G.ui.hydrateIcons(panel);
    },

    _updateCount() {
      const C = this._chat;
      if (!C) return;
      const n = C.input.value.length;
      C.count.hidden = n < MAX_LEN - 30;
      C.count.textContent = `${n}/${MAX_LEN}`;
      C.count.classList.toggle('full', n >= MAX_LEN);
    },

    setTab(id, opts = {}) {
      const C = this._chat;
      if (!C || !['all', 'local', 'system'].includes(id)) return;
      this.tab = id;
      C.log.dataset.tab = id;
      for (const b of C.tabs) { const on = b.dataset.channel === id; b.classList.toggle('active', on); b.setAttribute('aria-selected', on ? 'true' : 'false'); }
      C.input.placeholder = this._guestReadOnly() ? '게스트는 채팅을 읽을 수만 있어요' : id === 'local' ? `주변 ${LOCAL_R}m 안의 사람에게 말하기...` : C.placeholder;
      if (!opts.silent) { lsSet(LS_TAB, id); G.sfx('click'); }
      this._scrollBottom(true);
    },

    collapse(on, opts = {}) {
      const C = this._chat;
      if (!C) return;
      on = on ?? !C.panel.classList.contains('collapsed');
      C.panel.classList.toggle('collapsed', on);
      if (C.collapseBtn) {
        G.ui.setIcon(C.collapseBtn.querySelector('.ico') || C.collapseBtn, on ? 'plus' : 'minus');
        C.collapseBtn.title = on ? '채팅 펼치기' : '채팅 접기';
        C.collapseBtn.setAttribute('aria-label', C.collapseBtn.title);
      }
      if (!opts.silent) lsSet(LS_COLLAPSED, on ? '1' : '0');
      if (!on) { this._markRead(); this._scrollBottom(true); }
    },

    _smallScreen() { return !!window.matchMedia?.('(max-width: 560px)').matches; },
    _chatShown() {
      const C = this._chat;
      if (!C) return false;
      if (C.panel.classList.contains('chat-off') || C.panel.classList.contains('collapsed')) return false;
      if (this._smallScreen()) return document.body.classList.contains('show-chat');
      return true;
    },
    /** chat button: show/hide the chat window (body.show-chat on small screens) */
    toggleChat(force) {
      const C = this._chat;
      if (!C) return;
      if (this._smallScreen()) {
        const on = force ?? !document.body.classList.contains('show-chat');
        document.body.classList.toggle('show-chat', on);
        if (on) { C.panel.classList.remove('chat-off'); this.collapse(false); this._markRead(); }
        G.ui.setActive('chat', on);
        return;
      }
      const shown = this._chatShown();
      const on = force ?? !shown;
      if (on) {
        C.panel.classList.remove('chat-off');
        if (C.panel.classList.contains('collapsed')) this.collapse(false);
        if (G.settings.chatVisible === false) G.setSetting('chatVisible', true);
        this._markRead();
        this._scrollBottom(true);
      } else {
        C.panel.classList.add('chat-off');
        if (G.settings.chatVisible !== false) G.setSetting('chatVisible', false);
      }
    },
    _applyChatVisibility() {
      const C = this._chat;
      if (!C) return;
      C.panel.classList.toggle('chat-off', G.settings.chatVisible === false);
    },
    /** make sure the chat window is open (keeps the chatVisible setting in sync) */
    _showPanel() {
      const C = this._chat;
      if (!C) return;
      if (this._smallScreen()) { document.body.classList.add('show-chat'); G.ui.setActive('chat', true); }
      C.panel.classList.remove('chat-off');
      if (G.settings.chatVisible === false) G.setSetting('chatVisible', true);
      if (C.panel.classList.contains('collapsed')) this.collapse(false);
    },
    /** Enter: open the chat input */
    focusChat() {
      const C = this._chat;
      if (!C || !G.state) return false;
      if (G.sys.photo?.active) return false;
      if (this._guestReadOnly()) { G.ui.toast('게스트는 채팅을 읽을 수만 있어요. 로그인하면 대화에 참여할 수 있어요.', { type: 'info', sound: false }); return true; }
      this._showPanel();
      C.input.focus({ preventScroll: true });
      this._markRead();
      return true;
    },

    _scrollBottom(force) {
      const C = this._chat;
      if (!C) return;
      if (force || this._stick) {
        C.log.scrollTop = C.log.scrollHeight;
        this._stick = true;
        C.pill.hidden = true;
      }
    },
    _markRead() {
      this._unread = 0;
      const C = this._chat;
      if (C) C.unread.hidden = true;
      G.ui.setBadge('chat', 0);
    },

    _resetChat() {
      this.messages.length = 0;
      if (this._chat) { this._chat.log.innerHTML = ''; this._chat.input.value = ''; this._updateCount(); }
      this._markRead();
      this._stick = true;
    },

    _seedChat() {
      this.system('전통발효체험관 메타버스에 오신 것을 환영합니다!');
      this.system('Enter 채팅 · T 이모지 · G 제스처 — 서로 배려하는 대화를 나눠 주세요. 욕설은 자동으로 가려져요.');
      if (this._mode === 'server') this.system(this._guestReadOnly() ? '게스트로 접속했어요. 채팅을 읽을 수는 있지만 메시지를 보내려면 로그인이 필요해요.' : '서버에 연결되었어요. 다른 체험객과 실시간으로 대화할 수 있어요.');
      const nick = G.state?.profile?.nickname || '체험객';
      const npc = (id, fallback) => G.data.npcs?.[id]?.name || fallback;
      this._later(1600, () => { if (G.state) this.npcSay(npc('NPC001', '발효마스터'), `${J.nim(nick)}, 3D 체험관에 오신 것을 환영합니다!`); });
      this._later(3400, () => { if (G.state) this.npcSay(npc('NPC002', '산골농부'), '항아리와 금빛 표식을 클릭해 보세요.'); });
    },

    /** add a message to the log. m: {name, text, channel, kind, self, near, uid, sid, history} */
    _push(m) {
      const msg = {
        id: m.sid != null ? `s${m.sid}` : `m${++this._seq}`,
        name: String(m.name || '익명').slice(0, 24),
        text: String(m.text ?? '').slice(0, 300),
        channel: m.channel || 'all',
        at: m.at || G.time.now(),
        self: !!m.self,
        kind: m.kind || (m.self ? 'me' : m.channel === 'system' ? 'system' : m.channel === 'npc' ? 'npc' : 'visitor'),
        near: !!m.near,
        uid: m.uid ?? null,
      };
      this.messages.push(msg);
      while (this.messages.length > MAX_MSG) { const old = this.messages.shift(); old._el?.remove(); }
      this._render(msg);
      const pub = { ...msg }; delete pub._el;
      G.bus.emit('chat:message', { msg: pub });
      if (!msg.self && !m.history) {
        const visibleHere = !(this._isBlocked(msg.name) && msg.kind !== 'system' && msg.kind !== 'npc') && !(msg.channel === 'local' && !msg.near);
        if (visibleHere && !this._chatShown()) {
          this._unread++;
          const C = this._chat;
          if (C) { C.unread.hidden = false; C.unread.textContent = this._unread > 99 ? '99+' : String(this._unread); }
          if (!this._chatShown()) G.ui.setBadge('chat', this._unread);
        }
      }
      return msg;
    },

    _render(msg) {
      const C = this._chat;
      if (!C) return;
      const h = G.ui.h;
      const cls = ['chat-msg', msg.kind];
      if (msg.near || msg.self) cls.push('near');
      if (msg.channel === 'local') cls.push('ch-local');
      if (msg.kind !== 'system' && msg.kind !== 'npc' && !msg.self && this._isBlocked(msg.name)) cls.push('blocked');
      const el = h('div', { class: cls.join(' '), dataset: { id: msg.id } });
      if (msg.channel === 'local') el.appendChild(h('span', { class: 'ch-tag' }, '지역'));
      const isBtn = msg.kind !== 'system' && msg.kind !== 'me';
      const who = h(isBtn ? 'button' : 'span', { class: 'who', type: isBtn ? 'button' : null, dataset: { name: msg.name, kind: msg.kind, uid: msg.uid ?? '' }, title: isBtn ? `${msg.name} — 메뉴 열기` : null }, `${msg.name}:`);
      if (msg.kind === 'visitor' || msg.kind === 'remote') who.style.color = nameColor(msg.name);
      el.append(who, h('span', { class: 'txt' }, msg.text), h('time', { class: 'time' }, hhmm(msg.at)));
      C.log.appendChild(el);
      msg._el = el;
      if (this._stick) this._scrollBottom(true);
      else if (!el.classList.contains('blocked')) C.pill.hidden = false;
    },

    // ------------------------------------------------------------ public chat API
    /** system line that replaces its own previous copy when repeated within 20 s (weather / time slider spam) */
    _systemOnce(key, text) {
      this._sysOnce = this._sysOnce || {};
      const prev = this._sysOnce[key];
      if (prev && performance.now() - prev.at < 20000 && prev.msg?._el?.isConnected) {
        prev.msg.text = text;
        const t = prev.msg._el.querySelector('.txt');
        if (t) t.textContent = text;
        prev.at = performance.now();
        return prev.msg;
      }
      const msg = this.system(text);
      this._sysOnce[key] = { at: performance.now(), msg };
      return msg;
    },
    system(text) { if (!text) return null; return this._push({ name: '시스템', text: String(text), channel: 'system', kind: 'system' }); },

    npcSay(name, text) {
      if (!text) return null;
      let near = false;
      try {
        const pp = G.sys.player?.position;
        const rec = G.sys.npc?.list?.().find((r) => r.data?.name === name);
        if (pp && rec?.position) near = Math.hypot(rec.position.x - pp.x, rec.position.z - pp.z) <= LOCAL_R;
      } catch (e) { /* optional */ }
      return this._push({ name: name || 'NPC', text: this.filter(String(text)), channel: 'npc', kind: 'npc', near });
    },

    filter(text) { return this._badRe ? String(text).replace(this._badRe, '♡♡') : String(text); },
    _buildFilter() {
      const words = (G.data.badWords || []).map((w) => String(w || '').trim()).filter(Boolean);
      if (!words.length) { this._badRe = null; return; }
      const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      // tolerate spaces / punctuation inserted between the letters ("시 발", "s.h.i.t")
      const parts = words.sort((a, b) => b.length - a.length).map((w) => Array.from(w).map(escRe).join('[\\s._\\-*~!@#^]*'));
      try { this._badRe = new RegExp(parts.join('|'), 'gi'); } catch (e) { this._badRe = null; }
    },

    _guestReadOnly() {
      if (this._mode !== 'server') return false;
      const p = G.save?.profile || G.state?.profile || {};
      return !!(p.guest || p.role === 'guest' || /^guest/i.test(String(p.id || 'guest')));
    },
    _updateGuestUi() {
      const C = this._chat;
      if (!C) return;
      const ro = this._guestReadOnly();
      C.input.disabled = ro;
      if (C.send) C.send.disabled = ro;
      C.panel.classList.toggle('read-only', ro);
      this.setTab(this.tab, { silent: true });
    },

    sendChat(text, channel = 'all') {
      if (!G.state) return false;
      let t = String(text ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
      if (!t) return false;
      if (this._guestReadOnly()) { G.ui.toast('게스트는 채팅을 보낼 수 없어요. 로그인 후 이용해 주세요.', { type: 'warn' }); return false; }
      if (t.length > MAX_LEN) t = t.slice(0, MAX_LEN);
      const now = performance.now();
      if (now - this._lastSent < RATE_MS) { G.ui.toast('메시지를 너무 빨리 보내고 있어요. 잠시 후 다시 보내 주세요.', { type: 'warn' }); return false; }
      if (t === this._lastText && now - this._lastSent < 10000) {
        if (++this._repeat >= 2) { G.ui.toast('같은 메시지를 계속 보낼 수 없어요.', { type: 'warn' }); return false; }
      } else this._repeat = 0;
      this._lastSent = now;
      this._lastText = t;
      const ch = channel === 'local' ? 'local' : 'all';
      const masked = this.filter(t);
      const nick = G.state.profile?.nickname || '나';
      const msg = this._push({ name: nick, text: masked, channel: ch, kind: 'me', self: true, near: true, uid: G.save?.profile?.id ?? null });
      this.say(masked);
      G.sfx('chat');
      G.bus.emit('chat:sent', { text: masked, channel: ch });
      G.log.info('UI', `chat (${ch}): ${masked}`);
      if (this._mode === 'server') this._serverSend(masked, ch, msg);
      else this._visitorsHear(masked, ch);
      return true;
    },

    // ================================================================ bubbles
    _bubbleEl(cls) { return G.ui.h('div', { class: `bubble soc-bubble ${cls || ''}`, hidden: true, role: 'status' }); },
    _initMyBubble() {
      const h = G.ui.h;
      const bubble = this._bubbleEl('me');
      const wrap = h('div', { class: 'soc-me-wrap' }, bubble);
      const head = () => G.sys.player?.rig?.headAnchor || null;
      const label = G.ui.label({ el: wrap, target: head, offsetY: 0.04, maxDist: 70, fadeDist: 10 });
      label.setVisible(false);
      this._me = { label, bubble, t: 0 };
    },
    _clearMyBubble() { if (this._me) { this._me.t = 0; this._me.bubble.hidden = true; this._me.label.setVisible(false); } },
    /** show text (or an emoji with {emote:true}) in a bubble holder {bubble, t, label?} */
    _bubble(holder, text, opts = {}) {
      if (!holder || !text) return;
      const b = holder.bubble;
      b.classList.toggle('emote', !!opts.emote);
      b.textContent = text;
      b.hidden = false;
      b.classList.remove('pop'); void b.offsetWidth; b.classList.add('pop');
      holder.t = opts.dur ?? (opts.emote ? 2.5 : clamp(2.4 + String(text).length * 0.07, 3, 6.5));
      holder.label?.setVisible?.(true);
    },
    _tickBubble(holder, dt) {
      if (!holder || holder.t <= 0) return;
      holder.t -= dt;
      if (holder.t <= 0) { holder.bubble.hidden = true; holder.label?.setVisible?.(false); }
    },
    /** my own speech bubble */
    say(text) { if (G.state && text) this._bubble(this._me, String(text)); },

    // ================================================================ emotes & gestures
    _initActions() {
      const A = G.ui;
      A.onAction('chat', () => this.toggleChat());
      A.onAction('chat-collapse', () => this.collapse());
      A.onAction('emote', (el) => this.openEmotes(el));
      A.onAction('gesture', (el) => this.openGestures(el));
      A.onAction('voice', () => this.toggleVoice());
      const IN = G.input;
      if (!IN?.onKey) return;
      for (const code of ['Enter', 'NumpadEnter']) IN.onKey(code, () => this.focusChat());
      IN.onKey('KeyT', () => { if (!G.state || G.sys.photo?.active) return false; this.openEmotes(); return true; });
      IN.onKey('KeyG', () => { if (!G.state || G.sys.photo?.active) return false; this.openGestures(); return true; });
      for (let i = 1; i <= 8; i++) {
        const sel = () => {
          const p = this._picker;
          if (!p || p.pop?.closed) return false;
          const list = p.kind === 'emote' ? G.data.emotes : G.data.gestures;
          const it = list?.[i - 1];
          if (!it) return false;
          G.ui.popover.close();
          if (p.kind === 'emote') this.emote(it.id); else this.gesture(it.id);
          return true;
        };
        IN.onKey('Digit' + i, sel);
        IN.onKey('Numpad' + i, sel);
      }
    },

    _anchorFor(action) {
      const el = document.querySelector(`#bottom-bar [data-action="${action}"]`);
      return el && el.offsetParent !== null ? el : document.querySelector('#bottom-bar') || document.body;
    },
    _closePicker() { if (this._picker) { try { this._picker.pop?.close(); } catch (e) { /* closed */ } this._picker = null; } },

    _openPicker(kind, anchor) {
      if (!G.state) return;
      if (this._picker && this._picker.kind === kind && !this._picker.pop?.closed) { this._closePicker(); return; }
      anchor = anchor && anchor.isConnected ? anchor : this._anchorFor(kind);
      const h = G.ui.h;
      const list = (kind === 'emote' ? G.data.emotes : G.data.gestures) || [];
      const current = G.sys.player?.rig?.currentAction || null;
      const grid = h('div', { class: 'pick-grid' });
      list.forEach((it, i) => {
        const loopOn = kind === 'gesture' && it.loop && current === it.anim;
        const b = h('button', { class: `pick${loopOn ? ' active' : ''}`, type: 'button', dataset: { id: it.id }, title: `${it.name} (${i + 1})` },
          h('span', { class: 'emoji' }, it.icon), h('span', { class: 'pk-name' }, it.name), h('kbd', { class: 'pk-key' }, String(i + 1)),
          kind === 'gesture' && it.loop ? h('span', { class: 'pk-loop', title: '반복 동작' }, loopOn ? '중지' : '반복') : null);
        grid.appendChild(b);
      });
      grid.addEventListener('click', (e) => {
        const b = e.target.closest('.pick');
        if (!b) return;
        G.ui.popover.close();
        if (kind === 'emote') this.emote(b.dataset.id); else { this.gesture(b.dataset.id); G.sfx('click'); }
      });
      const box = h('div', { class: `soc-picker soc-picker-${kind}` },
        h('div', { class: 'soc-pk-head' }, h('h4', null, kind === 'emote' ? '이모지 보내기' : '제스처'), h('kbd', null, kind === 'emote' ? 'T' : 'G')),
        grid,
        h('p', { class: 'soc-pk-tip' }, kind === 'emote' ? '숫자 키 1–8로도 바로 보낼 수 있어요. 가까운 체험객이 반응할지도 몰라요!' : '반복 동작은 다시 누르거나 움직이면 멈춰요.'));
      const pop = G.ui.popover.open(anchor, box, { id: 'social-' + kind, placement: 'top', className: 'soc-pop', onClose: () => { if (this._picker?.pop === pop) this._picker = null; } });
      this._picker = pop ? { kind, pop } : null;
      if (pop) G.sfx('open');
    },
    openEmotes(anchor) { this._openPicker('emote', anchor); },
    openGestures(anchor) { this._openPicker('gesture', anchor); },

    emote(id) {
      const e = (G.data.emotes || []).find((x) => x.id === id);
      if (!e || !G.state) return false;
      const now = performance.now();
      if (now - this._lastEmote < 650) return false;
      this._lastEmote = now;
      this._bubble(this._me, e.icon, { emote: true });
      try { G.sys.player?.playAction?.(e.anim); } catch (err) { G.log.warn('SOCIAL', 'emote anim failed', err); }
      G.sfx('emote');
      this._emoteState = { id: e.id, at: Date.now(), seq: ++this._emoteSeq };
      G.bus.emit('emote:played', { emoteId: e.id });
      if (this._mode === 'local') this._visitorsSeeEmote(e);
      return true;
    },

    gesture(id) {
      const g = (G.data.gestures || []).find((x) => x.id === id);
      if (!g || !G.state) return false;
      const pl = G.sys.player;
      if (!pl) return false;
      const cur = pl.rig?.currentAction;
      // looping gestures toggle off when chosen again
      if (g.loop && (cur === g.anim || (g.anim === 'sit' && pl.sitting))) {
        try { if (g.anim === 'sit') pl.standUp?.(); else pl.stopAction?.(); } catch (e) { /* ignore */ }
        return true;
      }
      try { pl.playAction?.(g.anim, { duration: g.duration, loop: !!g.loop }); } catch (e) { G.log.warn('SOCIAL', 'gesture failed', e); }
      this._gestureState = { id: g.id, anim: g.anim, loop: !!g.loop };
      G.bus.emit('gesture:played', { gestureId: g.id });
      if (this._mode === 'local') this._visitorsSeeGesture(g);
      return true;
    },

    // ================================================================ voice dictation (Web Speech API)
    toggleVoice() {
      if (this._rec) { this.stopVoice(); return false; }
      const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SR) { G.ui.toast('이 브라우저는 음성 입력을 지원하지 않습니다', { type: 'warn', emoji: '🎙️' }); return false; }
      if (!G.state) return false;
      if (this._guestReadOnly()) { G.ui.toast('게스트는 채팅을 보낼 수 없어요. 로그인 후 이용해 주세요.', { type: 'warn' }); return false; }
      const C = this._chat;
      let rec;
      try { rec = new SR(); } catch (e) { G.ui.toast('음성 입력을 시작하지 못했어요.', { type: 'error' }); return false; }
      rec.lang = 'ko-KR';
      rec.interimResults = true;
      rec.continuous = false;
      rec.maxAlternatives = 1;
      const base = C && C.input.value.trim() ? C.input.value.trim() + ' ' : '';
      let finalText = '', failed = false, started = false;
      const finish = () => {
        clearTimeout(this._voiceWatch); clearTimeout(this._voiceMax);
        if (this._rec === rec) this._rec = null;
        this._voiceUi(false);
      };
      rec.onstart = () => {
        started = true;
        clearTimeout(this._voiceWatch);
        if (C) C.input.placeholder = '듣고 있어요… 말씀해 주세요';
        G.sfx('pop');
      };
      rec.onresult = (e) => {
        let interim = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const r = e.results[i];
          if (r.isFinal) finalText += r[0].transcript; else interim += r[0].transcript;
        }
        if (C) { C.input.value = (base + finalText + interim).replace(/\s+/g, ' ').slice(0, MAX_LEN); this._updateCount(); }
      };
      rec.onerror = (e) => {
        failed = true;
        const MSG = {
          'not-allowed': '마이크 사용이 허용되지 않았어요. 브라우저 주소창의 권한 설정에서 마이크를 허용해 주세요.',
          'service-not-allowed': '이 환경에서는 음성 인식을 사용할 수 없어요. (https 주소에서 이용해 주세요)',
          'no-speech': '음성이 들리지 않았어요. 다시 시도해 주세요.',
          'audio-capture': '마이크를 찾을 수 없어요. 마이크 연결을 확인해 주세요.',
          network: '음성 인식 서버에 연결하지 못했어요. 인터넷 연결을 확인해 주세요.',
          aborted: null,
          'language-not-supported': '이 브라우저는 한국어 음성 인식을 지원하지 않아요.',
        };
        const m = e.error in MSG ? MSG[e.error] : '음성 인식 중 문제가 생겼어요. 잠시 후 다시 시도해 주세요.';
        if (m) G.ui.toast(m, { type: 'warn', emoji: '🎙️' });
        G.log.warn('UI', 'speech recognition error', e.error);
      };
      rec.onend = () => {
        if (this._rec !== rec) return; // superseded / already cleaned up
        finish();
        const text = finalText.trim();
        if (C && text && !failed) {
          C.input.focus({ preventScroll: true });
          try { C.input.setSelectionRange(C.input.value.length, C.input.value.length); } catch (e) { /* ignore */ }
          G.ui.toast('음성이 입력되었어요. Enter를 누르면 전송돼요.', { type: 'success', emoji: '🎙️', sound: false, duration: 2200 });
        } else if (C && !failed) {
          C.input.value = base.trim();
          this._updateCount();
          if (started) G.ui.toast('음성이 인식되지 않았어요. 다시 시도해 주세요.', { type: 'info', emoji: '🎙️', sound: false });
        }
      };
      try { rec.start(); } catch (e) { G.ui.toast('음성 입력을 시작하지 못했어요. 잠시 후 다시 시도해 주세요.', { type: 'warn' }); return false; }
      this._rec = rec;
      this._voiceUi(true);
      if (C) C.input.placeholder = '음성 인식을 준비하고 있어요…';
      G.sys.audio?.duck?.('voice', 0.2);
      // some browsers never answer (no microphone / offline engine): give up with a clear message
      clearTimeout(this._voiceWatch); clearTimeout(this._voiceMax);
      this._voiceWatch = setTimeout(() => {
        if (this._rec !== rec || started) return;
        failed = true;
        try { rec.abort(); } catch (e) { /* ignore */ }
        finish();
        G.ui.toast('음성 인식을 시작하지 못했어요. 마이크 연결과 브라우저 권한을 확인해 주세요.', { type: 'warn', emoji: '🎙️' });
      }, 5000);
      this._voiceMax = setTimeout(() => { if (this._rec === rec) { try { rec.stop(); } catch (e) { /* ignore */ } } }, 15000);
      return true;
    },
    stopVoice() {
      const r = this._rec;
      this._rec = null;
      clearTimeout(this._voiceWatch); clearTimeout(this._voiceMax);
      if (r) { try { r.abort(); } catch (e) { try { r.stop(); } catch (e2) { /* ignore */ } } }
      this._voiceUi(false);
    },
    _voiceUi(on) {
      G.ui.setActive('voice', on);
      document.body.classList.toggle('voice-listening', on);
      const C = this._chat;
      if (C) {
        C.form.classList.toggle('listening', on);
        C.voiceInd.hidden = !on;
        if (on) this._showPanel();
        else this.setTab(this.tab, { silent: true });
      }
      if (!on) G.sys.audio?.unduck?.('voice');
    },

    // ================================================================ blocking / reporting
    _blockedList() { const s = G.state; if (!s) return []; if (!Array.isArray(s.blocked)) s.blocked = []; return s.blocked; },
    _isBlocked(name) { return !!name && this._blockedList().includes(String(name)); },
    isBlocked(name) { return this._isBlocked(name); },
    block(name) {
      if (!name || !G.state) return false;
      const list = this._blockedList();
      if (!list.includes(name)) { list.push(String(name)); G.dirty('blocked'); }
      this._refreshBlocked();
      G.ui.toast(`${J.eulreul(J.nim(name))} 차단했어요. 이 사용자의 채팅과 말풍선이 더 이상 보이지 않아요.`, { type: 'success', emoji: '🚫' });
      G.log.info('UI', `blocked ${name}`);
      return true;
    },
    unblock(name) {
      if (!name || !G.state) return false;
      const list = this._blockedList();
      const i = list.indexOf(String(name));
      if (i >= 0) { list.splice(i, 1); G.dirty('blocked'); }
      this._refreshBlocked();
      G.ui.toast(`${J.nim(name)}의 차단을 해제했어요.`, { type: 'info', emoji: '🔓' });
      return true;
    },
    _refreshBlocked() {
      for (const m of this.messages) {
        if (!m._el || m.kind === 'system' || m.kind === 'npc' || m.self) continue;
        m._el.classList.toggle('blocked', this._isBlocked(m.name));
      }
      for (const o of this.others.values()) {
        const b = this._isBlocked(o.name);
        o.el?.root?.classList.toggle('blocked', b);
        if (b && o.bub) { o.bub.t = 0; o.bub.bubble.hidden = true; }
      }
    },

    report(info) {
      if (!info?.name) return;
      const h = G.ui.h;
      const REASONS = [['abuse', '욕설·비방'], ['spam', '도배·광고'], ['harass', '불쾌한 행동'], ['privacy', '개인정보 노출'], ['etc', '기타']];
      let reason = 'abuse';
      const lastMsg = info.msgId ? this.messages.find((m) => m.id === info.msgId) : [...this.messages].reverse().find((m) => m.name === info.name && !m.self);
      G.ui.modal.open({
        id: 'chat-report', title: `${J.nim(info.name)} 신고하기`, icon: '🚨', size: 'sm', className: 'soc-report', autofocus: false,
        body: (body) => {
          const seg = h('div', { class: 'soc-reasons', role: 'radiogroup' });
          for (const [id, label] of REASONS) {
            const b = h('button', { type: 'button', class: `chip${id === reason ? ' chip-red' : ''}`, dataset: { r: id }, role: 'radio', 'aria-checked': id === reason ? 'true' : 'false' }, label);
            b.addEventListener('click', () => { reason = id; for (const x of seg.children) { const on = x.dataset.r === id; x.classList.toggle('chip-red', on); x.setAttribute('aria-checked', on ? 'true' : 'false'); } });
            seg.appendChild(b);
          }
          body.append(
            h('p', { class: 'dim small' }, '신고 사유를 선택해 주세요. 허위 신고는 제재될 수 있어요.'),
            seg,
            lastMsg ? h('div', { class: 'soc-quote' }, h('small', null, '신고할 메시지'), h('q', null, lastMsg.text)) : null,
            h('div', { class: 'field' }, h('label', { for: 'soc-report-memo' }, '추가 설명 (선택)'), h('textarea', { id: 'soc-report-memo', maxlength: '200', rows: '3', placeholder: '상황을 간단히 적어 주세요.' })),
            h('label', { class: 'check' }, h('input', { type: 'checkbox', id: 'soc-report-block', checked: !this._isBlocked(info.name) }), '이 사용자도 차단하기'),
          );
        },
        actions: [
          { label: '취소', class: 'btn-ghost' },
          {
            label: '신고하기', class: 'btn-danger', onClick: async (m) => {
              const memo = m.body.querySelector('#soc-report-memo')?.value.trim().slice(0, 200) || '';
              const alsoBlock = !!m.body.querySelector('#soc-report-block')?.checked;
              const payload = { target: info.name, targetId: info.id || null, messageId: lastMsg?.id?.startsWith('s') ? Number(lastMsg.id.slice(1)) : null, text: lastMsg?.text || '', reason, memo, at: G.time.now() };
              if (this._mode === 'server') {
                try {
                  await G.net.request('chat/report.php', { body: payload, timeout: 8000 });
                  G.ui.toast('신고가 접수되었어요. 운영자가 확인 후 조치할 예정이에요.', { type: 'success', emoji: '🚨' });
                } catch (e) {
                  G.ui.toast(e?.message || '신고를 접수하지 못했어요. 잠시 후 다시 시도해 주세요.', { type: 'error' });
                  return false;
                }
              } else {
                try {
                  const list = JSON.parse(lsGet(LS_REPORTS, '[]')) || [];
                  list.push({ ...payload, reporter: G.state?.profile?.nickname || '' });
                  while (list.length > 50) list.shift();
                  lsSet(LS_REPORTS, JSON.stringify(list));
                } catch (e) { /* storage blocked */ }
                G.ui.toast('신고 내용이 기록되었어요. (로컬 모드에서는 이 기기에만 저장돼요)', { type: 'success', emoji: '🚨' });
              }
              G.log.info('UI', `report ${info.name} (${reason})`);
              if (alsoBlock && !this._isBlocked(info.name)) this.block(info.name);
              return true;
            },
          },
        ],
      });
    },

    /** small popover when a name (chat log or name tag) is clicked */
    _openUser(anchor, info) {
      if (!G.state || !info?.name) return;
      const h = G.ui.h;
      const kind = info.kind === 'npc' ? 'npc' : info.kind === 'remote' ? 'remote' : 'visitor';
      const rec = kind === 'npc' ? null : [...this.others.values()].find((o) => o.name === info.name) || null;
      const npcRec = kind === 'npc' ? (G.sys.npc?.list?.() || []).find((r) => r.data?.name === info.name) : null;
      const pos = rec?.position || npcRec?.position || null;
      const pp = G.sys.player?.position;
      const dist = pos && pp ? Math.round(Math.hypot(pos.x - pp.x, pos.z - pp.z)) : null;
      const zone = pos ? G.world.zoneAt(pos.x, pos.z) : null;
      const sub = kind === 'npc' ? (npcRec?.data?.role || 'NPC') : `${kind === 'remote' ? '접속 중인 체험객' : '체험객'}${zone ? ' · ' + zone.short : ''}${dist != null ? ` · ${dist}m` : ''}`;
      const blocked = this._isBlocked(info.name);
      const initial = Array.from(info.name)[0] || '?';
      const color = kind === 'npc' ? 'linear-gradient(160deg,#ffd766,#e2aa22)' : `linear-gradient(160deg, hsl(${nameHue(info.name)} 70% 62%), hsl(${(nameHue(info.name) + 40) % 360} 60% 42%))`;
      const actions = h('div', { class: 'soc-user-actions' });
      const add = (icon, label, fn, cls = '') => {
        const b = h('button', { type: 'button', class: `btn btn-sm ${cls}` }, h('span', { class: 'emoji' }, icon), label);
        b.addEventListener('click', () => { G.ui.popover.close(); fn(); });
        actions.appendChild(b);
      };
      if (pos) add('📍', kind === 'npc' ? '찾아가기' : '가까이 가기', () => this._goTo(info, rec, npcRec));
      if (kind !== 'npc') {
        add('👋', '인사하기', () => this._greetUser(info.name, rec));
        add(blocked ? '🔓' : '🚫', blocked ? '차단 해제' : '차단하기', () => (blocked ? this.unblock(info.name) : this.block(info.name)));
        add('🚨', '신고하기', () => this.report(info), 'btn-danger');
      }
      const box = h('div', { class: 'soc-user' },
        h('div', { class: 'soc-user-head' },
          h('span', { class: 'soc-ava', style: { background: color } }, kind === 'npc' ? (G.sys.npc?.icon?.(npcRec?.id) || '🧑') : initial),
          h('div', { class: 'soc-user-id' }, h('b', null, info.name), h('small', null, sub)),
          blocked ? h('span', { class: 'chip chip-red' }, '차단됨') : null),
        actions);
      G.ui.popover.open(anchor, box, { id: 'social-user', placement: anchor.closest?.('#labels-layer') ? 'top' : 'right', className: 'soc-pop soc-pop-user' });
    },
    _goTo(info, rec, npcRec) {
      const pl = G.sys.player;
      if (!pl) return;
      if (npcRec && G.interact?.activate) { G.interact.activate(npcRec.id); return; }
      const p = rec?.position || npcRec?.position;
      if (p) pl.walkTo?.({ x: p.x, z: p.z }, { stopDistance: 1.8, onArrive: () => pl.faceTowards?.(p.x, p.z) });
    },
    _greetUser(name, rec) {
      const nick = J.nim(name);
      if (!this.sendChat(`${nick}, 안녕하세요! 👋`, 'all')) return;
      if (rec?.position) G.sys.player?.faceTowards?.(rec.position.x, rec.position.z);
      this._lastEmote = -1e9;
      this.emote('EMO_HELLO');
    },

    // ================================================================ events → system messages / reactions
    _initEvents() {
      const on = (n, fn) => G.bus.on(n, (p) => { if (G.state) fn(p || {}); });
      on('level:up', ({ level }) => {
        this.system(`🎉 레벨 ${level} 달성! 축하합니다.`);
        if (this._mode === 'local') this._later(1800, () => { const v = this._nearestVisitor(LOCAL_R, true); if (v) { this._visitorFace(v); this._visitorSay(v, this._replyLine('congrats'), { anim: 'clap' }); } });
      });
      on('achievement:unlocked', ({ id }) => { const a = G.data.achievements?.[id]; if (a) this.system(`🏆 업적 달성: ${a.icon || ''} ${a.name}`); });
      on('quest:completed', ({ questId }) => { const q = G.data.quests?.[questId]; if (q) this.system(`📜 퀘스트 완료: ${q.title} — 퀘스트 패널에서 보상을 받으세요.`); });
      on('collection:unlocked', ({ id }) => { const c = G.data.collection?.[id]; if (c) this.system(`📖 도감에 등록됐어요: ${c.icon || ''} ${c.name}`); });
      on('ferment:completed', ({ recipeId }) => { const r = G.data.recipes?.[recipeId]; this.system(`🏺 ${r ? r.name.replace(/ 체험$/, '') : '장독'} 발효가 완성되었어요! 장독대에서 수령해 보세요.`); });
      on('weather:changed', ({ id, prev, source }) => {
        if (!prev || source === 'init' || prev === id) return;
        const w = G.data.weather?.[id];
        if (w) this._systemOnce('weather', `${{ CLEAR: '☀️', CLOUDY: '☁️', RAIN: '🌧️', FOG: '🌫️', SNOW: '❄️' }[id] || '🌤️'} 날씨가 ‘${w.name}’${hasFinal(w.name) && !finalIsRieul(w.name) ? '으로' : '로'} 바뀌었어요.`);
      });
      on('time:phase', ({ name, initial, prev }) => { if (!initial && prev && name) this._systemOnce('phase', `${{ 아침: '🌅', 낮: '☀️', 저녁: '🌇', 밤: '🌙' }[name] || '🕰️'} ${J.iga(name)} 되었어요.`); });
      G.bus.on('photo:mode', () => this._closePicker());
      G.bus.on('ui:modal-open', () => this._closePicker());
      G.bus.on('settings:changed', ({ key }) => { if (key === 'chatVisible') this._applyChatVisibility(); });
      G.bus.on('engine:quality', () => { /* visitors keep their meshes; shadows follow the renderer */ });
    },

    _updateOnline() {
      const el = document.getElementById('hud-online-count');
      const n = this._mode === 'server' && this._srv?.online ? Math.max(this._srv.online, 1 + this.others.size) : this.online;
      if (el && el.textContent !== String(n)) el.textContent = String(n);
      const box = el?.closest('.hud-online');
      if (box) box.title = this._mode === 'server' ? `서버 접속자 ${n}명` : `체험객 ${n}명이 함께하고 있어요`;
    },

    // ================================================================ visitors (local simulation)
    _initVisitors() {
      if (!G.avatar?.create || !G.sys.engine?.scene) return;
      const names = (G.data.visitors?.names || []).slice();
      if (!names.length) return;
      const preset = G.sys.engine.preset || {};
      const want = preset.name === 'low' ? 8 : 11;
      this._target = Math.min(want, names.length);
      this._vroot = new THREE.Group();
      this._vroot.name = 'visitors';
      G.sys.engine.scene.add(this._vroot);
      this._shadow = !!preset.shadows;
      // build the pool now (loading screen) so logging in never hitches
      const poolSize = Math.min(names.length, this._target + 1);
      for (let i = 0; i < poolSize; i++) {
        try { this._pool.push(this._makeVisitor(names[i])); } catch (e) { G.log.warn('SOCIAL', `visitor ${names[i]} failed`, e); }
      }
      G.log.info('SOCIAL', `visitor pool: ${this._pool.length} (target ${this._target})`);
    },

    _makeVisitor(name) {
      const h = G.ui.h;
      const rig = G.avatar.create(G.avatar.random(U.hashInt('visitor:' + name)), { shadow: this._shadow });
      const group = new THREE.Group();
      group.name = 'visitor';
      group.add(rig.group);
      group.visible = false;
      this._vroot.add(group);
      const bubble = this._bubbleEl('visitor');
      const dot = h('i', { class: 'soc-dot' });
      const nm = h('span', { class: 'nm' });
      const tag = h('button', { class: 'nametag visitor', type: 'button' }, dot, nm);
      const root = h('div', { class: 'soc-label' }, bubble, tag);
      const v = {
        id: '', name: '', kind: 'visitor', rig, group, position: group.position, rotY: 0, zoneId: null,
        el: { root, bubble, tag, dot, nm }, bub: null, label: null,
        params: { speed: 0, grounded: true, vy: 0 },
        state: 'idle', t: 0, path: null, pi: 0, spot: null, prevSpot: null, stuck: 0, wait: 0, slide: null,
        react: null, talk: null, act: 0, simAcc: 0, animAcc: 0, camDist: 0, hidden: true, onScreen: true,
        speed: rand(1.15, 1.5), greetAt: -1e9, leaving: false, active: false, nextLineOk: 0,
      };
      v.label = G.ui.label({ el: root, target: rig.headAnchor, offsetY: 0.04, maxDist: LABEL_DIST, fadeDist: 8 });
      v.label.setVisible(false);
      v.bub = { bubble, t: 0, label: null };
      tag.addEventListener('click', (e) => { e.stopPropagation(); this._openUser(tag, { name: v.name, kind: 'visitor', id: v.id }); });
      this._assignName(v, name);
      return v;
    },
    _assignName(v, name) {
      v.name = name;
      v.id = 'V_' + name;
      v.el.nm.textContent = name;
      v.el.dot.style.background = nameColor(name);
      v.el.tag.title = `${name} · 클릭하면 메뉴가 열려요`;
      try { v.rig.setAppearance(G.avatar.random(U.hashInt('visitor:' + name))); } catch (e) { /* keep the old look */ }
    },

    // ---------------------------------------------------------------- navigation graph
    async _buildNav() {
      const L = G.data.layout || {};
      const W = G.world;
      NAV.nodes = []; NAV.hash = new Map(); NAV.ready = false;
      NAV.crops = (L.farmPlots || []).map((p) => ({ x: p.x, z: p.z, hw: (p.w || 6) / 2 + 0.45, hd: (p.d || 6) / 2 + 0.45 }));
      let budget = performance.now();
      const breathe = async () => { if (performance.now() - budget > 10) { await U.nextFrame(); budget = performance.now(); } };
      const t0 = performance.now();
      const nodes = NAV.nodes;
      const tryAdd = (x, z, kind, gap = 2.2) => {
        const y = W.surfaceHeight(x, z);
        if (!Number.isFinite(y) || y > 3.2 || y < -0.6) return null;
        if (walkY(x, z, y, 0.42) == null) return null;
        if (gap > 0) for (const [d] of navNear(x, z, gap)) if (d < gap) return null;
        const n = { i: nodes.length, x, z, y, kind, adj: [], main: false, path: kind === 'path' };
        nodes.push(n);
        const c = NAV.cell, k = hkey(Math.floor(x / c), Math.floor(z / c));
        if (!NAV.hash.has(k)) NAV.hash.set(k, []);
        NAV.hash.get(k).push(n.i);
        return n;
      };
      // 1) destination spots (validated, get their own node)
      this.spots = this._buildSpots();
      for (const s of this.spots) { const n = tryAdd(s.x, s.z, 'spot', 0); s.node = n; }
      await breathe();
      // 2) paths sampled every 4 m
      for (const p of L.paths || []) {
        const pts = p.points || [];
        for (let i = 0; i < pts.length - 1; i++) {
          const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
          const d = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.round(d / 4));
          for (let k = 0; k <= n; k++) tryAdd(ax + (bx - ax) * (k / n), az + (bz - az) * (k / n), 'path', 2.4);
        }
      }
      // 3) plaza rings
      const pz = L.plaza || { x: 0, z: 0, r: 13 };
      for (const r of [4.5, 8.5, 11.5]) for (let i = 0; i < 12; i++) { const a = (i / 12) * TAU; tryAdd(pz.x + Math.cos(a) * r, pz.z + Math.sin(a) * r, 'path', 2.4); }
      await breathe();
      // 4) coarse walkability grid (open lawns)
      const b = NAV.bounds;
      for (let x = b.minX + 4; x <= b.maxX - 4; x += 7) {
        for (let z = b.minZ + 4; z <= b.maxZ - 4; z += 7) tryAdd(x + rand(-0.6, 0.6), z + rand(-0.6, 0.6), 'grid', 3.2);
        await breathe();
      }
      // 5) edges (line of sight, spatial hash)
      const R = 10.6;
      for (const n of nodes) {
        let checked = 0;
        for (const [d, m] of navNear(n.x, n.z, R)) {
          if (m.i === n.i || d < 0.3) continue;
          if (++checked > 16) break;
          if (m.i < n.i) continue; // pair handled from the other side
          const y = segClear(n.x, n.z, n.y, m.x, m.z);
          if (y == null || Math.abs(y - m.y) > 0.6) continue;
          const mult = n.path && m.path ? 0.82 : n.kind === 'grid' || m.kind === 'grid' ? 1.25 : 1;
          const c = d * mult;
          n.adj.push([m.i, c]); m.adj.push([n.i, c]);
        }
        await breathe();
      }
      // 6) keep the largest connected component
      const comp = new Int32Array(nodes.length).fill(-1);
      let best = -1, bestSize = 0, cid = 0;
      for (const n of nodes) {
        if (comp[n.i] >= 0) continue;
        let size = 0; const stack = [n.i]; comp[n.i] = cid;
        while (stack.length) { const i = stack.pop(); size++; for (const [j] of nodes[i].adj) if (comp[j] < 0) { comp[j] = cid; stack.push(j); } }
        if (size > bestSize) { bestSize = size; best = cid; }
        cid++;
      }
      for (const n of nodes) n.main = comp[n.i] === best;
      this.spots = this.spots.filter((s) => s.node && s.node.main);
      NAV.ready = nodes.length > 10 && this.spots.length > 4;
      G.log.info('SOCIAL', `nav graph: ${nodes.length} nodes, ${bestSize} reachable, ${this.spots.length} spots (${Math.round(performance.now() - t0)} ms)`);
    },

    /** visitor destinations from the layout: benches, photo zones, signs, plots, jangdokdae, pavilion, ... */
    _buildSpots() {
      const L = G.data.layout || {};
      const out = [];
      const fwd = (rot) => [Math.sin(rot || 0), Math.cos(rot || 0)];
      const yawTo = (x, z, tx, tz) => Math.atan2(tx - x, tz - z);
      // keep visitors out of the NPCs' personal space (name tags would overlap)
      const npcs = Object.values(G.data.npcs || {}).filter((n) => Array.isArray(n.pos)).map((n) => ({ x: n.pos[0], z: n.pos[1], r: 3.2 + (Number(n.wander) || 0) * 0.5 }));
      const add = (s) => {
        for (const n of npcs) {
          const dx = s.x - n.x, dz = s.z - n.z, d = Math.hypot(dx, dz);
          if (d < n.r) {
            if (s.kind !== 'hang' && s.kind !== 'jang') return;
            if (d > 0.01) { s.x = n.x + (dx / d) * n.r; s.z = n.z + (dz / d) * n.r; } else { s.x = n.x + n.r; }
          }
        }
        const free = this._freeNear(s.x, s.z, s.search ?? 2.5);
        if (!free) return;
        s.x = free.x; s.z = free.z;
        s.id = s.id || `${s.kind}_${out.length}`;
        s.cap = s.cap || 1;
        s.users = new Set();
        s.zoneId = G.world.zoneAt(s.x, s.z)?.id || null;
        s.stay = s.stay || [10, 24];
        s.w = s.w ?? 1;
        out.push(s);
      };
      (L.benches || []).forEach((b, i) => {
        const [fx, fz] = fwd(b.rot);
        const obj = G.world.getObject?.('BENCH_' + i);
        const seatY = Number(obj?.userData?.seatY);
        add({ id: 'BENCH_' + i, kind: 'bench', x: b.x + fx * 0.95, z: b.z + fz * 0.95, face: b.rot || 0, seat: { x: b.x + fx * 0.06, z: b.z + fz * 0.06, y: Number.isFinite(seatY) ? seatY : 0.44 }, stay: [16, 40], w: 1.3, search: 0.8, shelter: false });
      });
      for (const p of L.photoZones || []) {
        const look = p.look || [p.x, 0, p.z - 5];
        add({ id: p.id, kind: 'photo', x: p.x, z: p.z, face: yawTo(p.x, p.z, look[0], look[2]), anims: ['photo', 'photo', 'wave', 'point'], cap: 2, w: 0.9 });
      }
      for (const s of L.signs || []) {
        const [fx, fz] = fwd(s.rot);
        add({ id: s.id, kind: 'sign', x: s.x + fx * 2.1, z: s.z + fz * 2.1, face: (s.rot || 0) + Math.PI, anims: ['think', 'point', 'nod'], cap: 2, w: 0.55, stay: [6, 14] });
      }
      for (const k of L.kiosks || []) {
        const [fx, fz] = fwd(k.rot);
        add({ id: k.id, kind: 'kiosk', x: k.x + fx * 1.35, z: k.z + fz * 1.35, face: (k.rot || 0) + Math.PI, anims: ['interact', 'think', 'nod'], w: 0.6, stay: [8, 16] });
      }
      for (const e of L.exhibits || []) {
        const [fx, fz] = fwd(e.rot);
        add({ id: e.id, kind: 'exhibit', x: e.x + fx * 1.7, z: e.z + fz * 1.7, face: (e.rot || 0) + Math.PI, anims: ['think', 'point', 'interact'], w: 0.7, stay: [7, 15] });
      }
      if (L.craftTable) { const c = L.craftTable, [fx, fz] = fwd(c.rot); add({ id: c.id, kind: 'craft', x: c.x + fx * 1.5, z: c.z + fz * 1.5, face: (c.rot || 0) + Math.PI, anims: ['interact', 'think'], w: 0.4 }); }
      for (const d of L.jarDisplays || []) add({ id: d.id, kind: 'jardisp', x: d.x, z: d.z + 1.7, face: Math.PI, anims: ['think', 'point'], w: 0.45, stay: [6, 12] });
      for (const p of L.farmPlots || []) {
        add({ id: 'PLOT_' + p.id, kind: 'plot', x: p.x + rand(-1.2, 1.2), z: p.z + (p.d || 6) / 2 + 1.25, face: Math.PI, anims: ['water', 'point', 'think', 'harvest'], w: 0.85, stay: [8, 18], search: 1.2 });
      }
      const J = L.jangdokdae;
      if (J) {
        const wx = J.frontWalkX ? (J.frontWalkX[0] + J.frontWalkX[1]) / 2 - 0.6 : 22.6;
        for (const z of [-12, -8, 7, 12]) add({ id: `JANG_${z}`, kind: 'jang', x: wx, z, face: Math.PI / 2, anims: ['think', 'point', 'photo', 'nod'], w: 0.7, stay: [8, 18], search: 1.2 });
        const rg = J.rings;
        if (rg) for (let i = 0; i < 4; i++) { const a = (i / 4) * TAU; const r = 8.6; add({ id: `RING_${i}`, kind: 'ring', x: rg.cx + Math.cos(a) * r, z: rg.cz + Math.sin(a) * r, face: Math.atan2(Math.cos(a), Math.sin(a)) + Math.PI / 2, anims: ['think', 'photo', 'point'], w: 0.5, stay: [8, 16], search: 1 }); }
      }
      const pav = (L.buildings || []).find((b) => b.type === 'pavilion');
      if (pav) for (const [dx, dz] of [[0, 0.6], [-1.4, -0.6], [1.4, -0.6]]) add({ kind: 'pavilion', x: pav.x + dx, z: pav.z + dz, face: 0, anims: ['think', 'nod', 'photo', 'wave'], w: 0.6, stay: [14, 30], shelter: true, search: 1.2 });
      if (L.riverDeck) add({ id: 'DECK', kind: 'deck', x: L.riverDeck.x, z: L.riverDeck.z, face: Math.PI / 2, anims: ['photo', 'point', 'think'], cap: 2, w: 0.7 });
      // social hangouts in each zone
      const hang = [[-8.5, -1.5], [5, -4], [-7, 3.5], [6.5, 3], [0, -9.5], [-4, -69], [5, -70], [-44, -59], [-44, -30], [-35, 4.5], [-36, -2], [44, 47], [58, 46], [-4, 64], [5, 64], [-58, 22], [30, 28], [36, -18]];
      for (const [x, z] of hang) add({ kind: 'hang', x, z, face: null, anims: ['nod', 'wave', 'think', 'clap'], cap: 2, w: 1.25, stay: [10, 22], social: true });
      // shelters (rain) under eaves
      const hall = (L.buildings || []).find((b) => b.type === 'hall');
      if (hall) add({ id: 'SHELTER_HALL', kind: 'shelter', x: hall.x - 6, z: hall.z + hall.d / 2 + 3.2, face: 0, anims: ['think', 'nod'], cap: 3, w: 0.25, shelter: true, stay: [20, 40] });
      const sto = (L.buildings || []).find((b) => b.type === 'storage');
      if (sto) add({ id: 'SHELTER_STORAGE', kind: 'shelter', x: sto.x + 3, z: sto.z + sto.d / 2 + 2.2, face: 0, anims: ['think', 'nod'], cap: 2, w: 0.25, shelter: true, stay: [20, 40] });
      // exits (leaving visitors walk here)
      add({ id: 'EXIT_GATE', kind: 'exit', x: 0, z: 67, face: 0, w: 0, cap: 99, search: 3 });
      return out;
    },
    _freeNear(x, z, R) {
      const W = G.world;
      const ok = (px, pz) => { const y = W.surfaceHeight(px, pz); return Number.isFinite(y) && walkY(px, pz, y, 0.45) != null; };
      if (ok(x, z)) return { x, z };
      for (let r = 0.4; r <= R; r += 0.4) {
        const n = Math.max(8, Math.round(r * 7));
        for (let i = 0; i < n; i++) { const a = (i / n) * TAU; const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r; if (ok(px, pz)) return { x: px, z: pz }; }
      }
      return null;
    },

    // ---------------------------------------------------------------- spawning
    _spawnVisitors() {
      this._despawnVisitors();
      if (!this._pool.length || !this._target) { this._updateOnline(); return; }
      const spots = this.spots;
      const pl = G.sys.player?.position || { x: 0, z: 9 };
      const usable = spots.filter((s) => s.kind !== 'exit');
      const near = usable.filter((s) => Math.hypot(s.x - pl.x, s.z - pl.z) < 26 && s.kind !== 'bench' && Math.hypot(s.x - pl.x, s.z - pl.z) > 4);
      for (let i = 0; i < this._target && i < this._pool.length; i++) {
        const v = this._pool[i];
        let spot = null;
        if (i < 3 && near.length) spot = this._chooseSpot(v, near);
        if (!spot) spot = this._chooseSpot(v, usable);
        this._activate(v, spot, { stagger: true });
      }
      this._lineT = rand(9, 16);
      this._cycleT = rand(160, 300);
      this._joinT = -1;
      this._updateOnline();
    },
    _activate(v, spot, opts = {}) {
      v.active = true; v.leaving = false;
      v.react = null; v.talk = null; v.path = null; v.slide = null; v.stuck = 0; v.wait = 0;
      v.rig.stopAll?.(); v.rig.setHeld?.(null); v.rig.setLookTarget?.(null);
      v.bub.t = 0; v.bub.bubble.hidden = true;
      let x, z, y;
      if (opts.at) { x = opts.at.x; z = opts.at.z; } else if (spot) { this._occupy(v, spot); x = v.goal.x; z = v.goal.z; } else { const n = pick(NAV.nodes.filter((q) => q.main)) || { x: 0, z: 0 }; x = n.x; z = n.z; }
      y = G.world.surfaceHeight(x, z);
      v.position.set(x, Number.isFinite(y) ? y : 0, z);
      v.rotY = spot?.face ?? rand(-Math.PI, Math.PI);
      v.group.rotation.y = v.rotY;
      v.group.visible = true; v.hidden = false;
      v.label.setVisible(true);
      v.el.root.classList.toggle('blocked', this._isBlocked(v.name));
      this.others.set(v.id, v);
      this._activeDirty = true;
      v.zoneId = G.world.zoneAt(x, z)?.id || null;
      if (!spot || opts.at) this._release(v);
      if (spot && !opts.at) {
        this._arrive(v, { silent: true });
        if (opts.stagger) v.t = rand(2, 14);
      } else { v.state = 'idle'; v.t = opts.stagger ? rand(0.5, 3) : 0.2; }
    },
    _deactivate(v) {
      this._release(v);
      v.active = false; v.leaving = false;
      v.group.visible = false; v.hidden = true;
      v.label.setVisible(false);
      v.bub.t = 0; v.bub.bubble.hidden = true;
      v.rig.stopAll?.(); v.rig.setHeld?.(null);
      v.talk = null; v.react = null;
      this.others.delete(v.id);
      this._activeDirty = true;
    },
    _despawnVisitors() {
      for (const v of this._pool) if (v.active) this._deactivate(v);
      for (const s of this.spots) { s.users?.clear(); s.slotOf?.clear(); }
      this._activeDirty = true;
    },

    _occupy(v, spot) {
      this._release(v);
      v.spot = spot;
      spot.users.add(v.id);
      if (!spot.slotOf) spot.slotOf = new Map();
      const taken = new Set(spot.slotOf.values());
      let slot = 0;
      while (taken.has(slot)) slot++;
      spot.slotOf.set(v.id, slot);
      v.slot = slot;
      v.goal = this._spotPos(spot, slot);
    },
    _release(v) { if (v.spot) { v.spot.users.delete(v.id); v.spot.slotOf?.delete(v.id); } v.spot = null; },
    /** stand point for the n-th visitor at a spot (side by side, never on the same point) */
    _spotPos(spot, slot) {
      if (!slot || spot.kind === 'bench' || spot.kind === 'exit') return { x: spot.x, z: spot.z };
      spot.slotPos = spot.slotPos || [];
      if (spot.slotPos[slot]) return spot.slotPos[slot];
      const base = (spot.face ?? (U.hashInt(spot.id) % 628) / 100) + Math.PI / 2;
      const side = slot % 2 ? 1 : -1, r = 1.25 * Math.ceil(slot / 2);
      let pos = { x: spot.x, z: spot.z };
      for (const k of [1, 0.75, 0.5]) {
        const x = spot.x + Math.sin(base) * side * r * k, z = spot.z + Math.cos(base) * side * r * k;
        const y = G.world.surfaceHeight(x, z);
        if (Number.isFinite(y) && walkY(x, z, y, 0.4) != null && segClear(spot.x, spot.z, G.world.surfaceHeight(spot.x, spot.z), x, z) != null) { pos = { x, z }; break; }
      }
      spot.slotPos[slot] = pos;
      return pos;
    },

    _chooseSpot(v, list) {
      const W = G.sys.weather;
      const raining = (W?.precipitation?.rain ?? (W?.current === 'RAIN' ? 1 : 0)) > 0.4;
      const night = (W?.nightFactor ?? 0) > 0.6;
      const pp = G.sys.player?.sitting?.bench?.id || null;
      const p = v.position;
      let tot = 0;
      const cand = [];
      for (const s of list || this.spots) {
        if (s.kind === 'exit' || s === v.spot || s === v.prevSpot) continue;
        if (s.users.size >= s.cap) continue;
        if (s.kind === 'bench' && pp === s.id) continue;
        let w = s.w;
        const d = v.active ? Math.hypot(s.x - p.x, s.z - p.z) : 30;
        w *= d < 8 ? 0.3 : d > 80 ? 0.35 : 1;
        if (raining) w *= s.shelter ? 8 : s.kind === 'bench' || s.kind === 'plot' ? 0.2 : 0.5;
        if (night && (s.kind === 'hang' || s.kind === 'pavilion' || s.kind === 'bench')) w *= 1.6;
        if (w <= 0) continue;
        tot += w; cand.push([s, w]);
      }
      if (!cand.length) return null;
      let x = Math.random() * tot;
      for (const [s, w] of cand) { x -= w; if (x <= 0) return s; }
      return cand[cand.length - 1][0];
    },

    _plan(v, spot) {
      if (!NAV.ready || !spot?.node) return false;
      const p = v.slide ? { x: v.slide.x, z: v.slide.z, y: v.position.y } : v.position;
      const start = nearestNode(p.x, p.z, p.y);
      if (!start) return false;
      const nodes = astar(start, spot.node);
      if (!nodes) return false;
      const pts = nodes.map((n) => ({ x: n.x + rand(-0.25, 0.25), z: n.z + rand(-0.25, 0.25) }));
      const goal = v.goal || spot;
      pts.push({ x: goal.x, z: goal.z, last: true });
      v.path = pts; v.pi = 0;
      this._pull(v);
      return true;
    },
    /** line-of-sight smoothing: skip waypoints that can be reached directly */
    _pull(v) {
      const p = v.position, path = v.path;
      if (!path || v.slide) return;
      let best = v.pi;
      for (let k = v.pi + 1; k < Math.min(path.length, v.pi + 4); k++) {
        if (segClear(p.x, p.z, p.y, path[k].x, path[k].z) != null) best = k; else break;
      }
      v.pi = best;
    },

    _startWalk(v, spot) {
      if (!spot) return false;
      if (v.rig.sitting || v.slide) this._standUp(v);
      v.rig.stopAction?.();
      v.rig.setLookTarget?.(null);
      const prev = v.spot;
      this._occupy(v, spot);
      this.stats.plans++;
      if (!this._plan(v, spot)) { this.stats.planFails++; this._release(v); if (prev) this._occupy(v, prev); return false; }
      v.prevSpot = prev;
      v.state = 'walk';
      v.stuck = 0; v.wait = 0;
      const d = Math.hypot(spot.x - v.position.x, spot.z - v.position.z);
      v.run = d > 45 && Math.random() < 0.18;
      return true;
    },

    _arrive(v, opts = {}) {
      const s = v.spot;
      if (!opts.silent) this.stats.arrivals++;
      v.path = null;
      v.state = 'idle';
      v.t = s ? rand(s.stay[0], s.stay[1]) : rand(4, 9);
      v.act = rand(1.2, 4);
      if (!s) return;
      if (s.kind === 'exit' && v.leaving) { this._leaveDone(v); return; }
      if (s.kind === 'bench' && s.seat) {
        v.state = 'sit';
        v.slide = { fx: v.position.x, fz: v.position.z, x: s.seat.x, z: s.seat.z, t: 0, dur: opts.silent ? 0.001 : 0.45 };
        v.rotY = opts.silent ? s.face : v.rotY;
        v.faceYaw = s.face;
        v.rig.setAnim('sit', { loop: true, seatY: s.seat.y });
        return;
      }
      v.faceYaw = s.face ?? null;
      if (!opts.silent && s.anims && Math.random() < 0.65) this._visitorAnim(v, pick(s.anims));
      if (s.social && !opts.silent) this._tryTalk(v);
    },
    _standUp(v) {
      if (v.spot?.kind === 'bench') {
        const s = v.spot;
        v.slide = { fx: v.position.x, fz: v.position.z, x: s.x, z: s.z, t: 0, dur: 0.35 };
      }
      v.rig.stopAll?.();
    },

    _visitorAnim(v, anim, opts = {}) {
      if (!anim || !G.avatar?.actions?.[anim]) return false;
      try { v.rig.setAnim(anim, { duration: opts.duration ?? G.avatar.actions[anim].duration ?? 2, loop: !!opts.loop }); return true; } catch (e) { return false; }
    },
    _visitorFace(v, x, z) {
      const pp = x == null ? G.sys.player?.position : { x, z };
      if (!pp) return;
      v.faceYaw = Math.atan2(pp.x - v.position.x, pp.z - v.position.z);
      if (x == null) v.rig.setLookTarget?.(G.sys.player?.rig?.headAnchor || null);
    },
    /** stop and react for a while (keeps the current plan) */
    _react(v, seconds, fn) {
      if (!v.active || v.leaving) return;
      if (v.state === 'sit') { v.react = { t: seconds }; this._visitorFace(v); fn?.(); return; }
      v.react = { t: seconds };
      v.params.speed = 0;
      this._visitorFace(v);
      fn?.();
    },

    _visitorSay(v, text, opts = {}) {
      if (!v?.active || !text) return;
      const line = String(text).replace(/\{nickname\}/g, G.state?.profile?.nickname || '체험객');
      const pp = G.sys.player?.position;
      const d = pp ? Math.hypot(v.position.x - pp.x, v.position.z - pp.z) : Infinity;
      const channel = opts.channel || 'all';
      if (channel === 'local' && d > LOCAL_R) { if (!this._isBlocked(v.name)) this._bubble(v.bub, line); return; }
      this._push({ name: v.name, text: this.filter(line), channel, kind: 'visitor', near: d <= LOCAL_R, uid: v.id });
      if (!this._isBlocked(v.name)) {
        this._bubble(v.bub, line);
        if (d < 45) G.sfx('chat', { at: v.position, volume: 0.6 });
      }
      if (opts.anim && v.state !== 'walk') this._visitorAnim(v, opts.anim);
    },
    _visitorEmote(v, emo, anim) {
      if (!v?.active) return;
      if (!this._isBlocked(v.name)) this._bubble(v.bub, emo, { emote: true });
      if (anim) this._visitorAnim(v, anim);
    },

    _replyLine(kind) {
      const R = G.data.visitors?.replies || {};
      const list = Array.isArray(R[kind]) && R[kind].length ? R[kind] : FALLBACK[kind] || FALLBACK.agree;
      return pick(list);
    },
    /** a line from G.data.visitors.lines, weighted by where the visitor is */
    _pickLine(v) {
      const lines = G.data.visitors?.lines?.length ? G.data.visitors.lines : FALLBACK.chat;
      const z = v.zoneId || '';
      const HINT = [
        [/장독|발효 언제/, ['ZONE_JANGDOKDAE']], [/콩|물 주|수확/, ['ZONE_CROP', 'ZONE_HERB']], [/정자|사진/, ['ZONE_REST']],
        [/허브/, ['ZONE_HERB']], [/교육관|퀴즈/, ['ZONE_EDUCATION', 'ZONE_HALL']], [/메주|된장/, ['ZONE_FERMENTATION', 'ZONE_JANGDOKDAE']],
        [/계곡/, ['ZONE_REST']], [/처음 왔/, ['ZONE_ENTRANCE', 'ZONE_MAIN']],
      ];
      let tot = 0;
      const cand = lines.map((l) => {
        let w = this._recentLines.includes(l) ? 0 : 1;
        for (const [re, zones] of HINT) if (re.test(l)) w *= zones.includes(z) ? 5 : 0.45;
        tot += w;
        return [l, w];
      });
      let x = Math.random() * tot, out = lines[0];
      for (const [l, w] of cand) { x -= w; if (x <= 0) { out = l; break; } }
      this._recentLines.push(out);
      if (this._recentLines.length > Math.min(8, lines.length - 2)) this._recentLines.shift();
      return out;
    },

    /** active visitors (cached array, rebuilt only when someone arrives or leaves — no per-frame allocation) */
    _activeVisitors() {
      if (this._activeDirty || !this._active) {
        this._active = [];
        for (const o of this.others.values()) if (o.kind === 'visitor' && o.active) this._active.push(o);
        this._activeDirty = false;
      }
      return this._active;
    },
    _nearestVisitor(maxD, idleOnly) {
      const pp = G.sys.player?.position;
      if (!pp) return null;
      let best = null, bd = maxD;
      for (const v of this._activeVisitors()) {
        if (v.leaving || (idleOnly && v.talk)) continue;
        const d = Math.hypot(v.position.x - pp.x, v.position.z - pp.z);
        if (d < bd) { bd = d; best = v; }
      }
      return best;
    },

    // ---------------------------------------------------------------- reactions to the player
    _visitorsHear(text, channel) {
      const vis = this._activeVisitors();
      if (!vis.length) return;
      const now = performance.now();
      const t = text.toLowerCase();
      let kind = null;
      if (/안녕|반가|하이|ㅎㅇ|hello|\bhi\b|헬로|어서\s?오|반갑/.test(t)) kind = 'greet';
      else if (/고마|감사|땡큐|thank|ㄱㅅ|고맙/.test(t)) kind = 'thanks';
      else if (/[?？]|어디|어떻게|뭐|언제|왜|몇|누구|있나요|인가요|할까요/.test(t)) kind = 'question';
      const named = vis.find((v) => text.includes(v.name));
      if (!kind && !named) return;
      if (now - this._replyT < 3500 && !named) return;
      this._replyT = now;
      const pp = G.sys.player?.position;
      const near = vis.filter((v) => !v.leaving && pp && Math.hypot(v.position.x - pp.x, v.position.z - pp.z) <= (channel === 'local' ? LOCAL_R : 60))
        .sort((a, b) => Math.hypot(a.position.x - pp.x, a.position.z - pp.z) - Math.hypot(b.position.x - pp.x, b.position.z - pp.z));
      let responders = named ? [named] : near.slice(0, kind === 'greet' ? (Math.random() < 0.5 ? 2 : 1) : 1);
      if (!responders.length && channel !== 'local') responders = [pick(vis)];
      responders.forEach((v, i) => {
        this._later((rand(1, 3) + i * 1.2) * 1000, () => {
          if (!v.active || !G.state) return;
          const k = kind || 'mention';
          const pd = pp ? Math.hypot(v.position.x - pp.x, v.position.z - pp.z) : 99;
          this.stats.replies++;
          if (pd < 25) this._react(v, 3.2, () => this._visitorAnim(v, k === 'greet' ? 'wave' : k === 'thanks' ? 'nod' : k === 'question' ? 'think' : 'wave'));
          this._visitorSay(v, this._replyLine(k), { channel });
        });
      });
    },

    _visitorsSeeEmote(e) {
      const pp = G.sys.player?.position;
      if (!pp) return;
      const vis = this._activeVisitors().filter((v) => !v.leaving && Math.hypot(v.position.x - pp.x, v.position.z - pp.z) < 13)
        .sort((a, b) => Math.hypot(a.position.x - pp.x, a.position.z - pp.z) - Math.hypot(b.position.x - pp.x, b.position.z - pp.z)).slice(0, 2);
      const friendly = e.id === 'EMO_HELLO' || e.id === 'EMO_WELCOME';
      vis.forEach((v, i) => {
        if (Math.random() > (friendly ? 0.85 : 0.5)) return;
        this._later((rand(0.6, 1.6) + i * 0.7) * 1000, () => {
          if (!v.active) return;
          const map = {
            EMO_HELLO: ['👋', 'wave'], EMO_WELCOME: ['🙌', 'celebrate'], EMO_CLAP: ['👏', 'clap'], EMO_THUMBS: ['👍', 'thumbsup'],
            EMO_LIKE: ['❤️', 'heart'], EMO_WOW: [pick(['😮', '😆']), 'surprise'], EMO_SMILE: ['😊', 'nod'], EMO_LAUGH: ['😆', 'nod'],
          };
          const [emo, anim] = map[e.id] || ['😊', 'nod'];
          this._react(v, 2.8, () => this._visitorEmote(v, emo, anim));
          if (e.id === 'EMO_HELLO' && Math.random() < 0.4) this._later(900, () => this._visitorSay(v, this._replyLine('greet'), { channel: 'local' }));
        });
      });
    },

    _visitorsSeeGesture(g) {
      const pp = G.sys.player?.position;
      if (!pp) return;
      const vis = this._activeVisitors().filter((v) => !v.leaving && v.state !== 'sit' && Math.hypot(v.position.x - pp.x, v.position.z - pp.z) < 11);
      if (!vis.length) return;
      if (g.anim === 'dance') {
        vis.slice(0, 2).forEach((v, i) => {
          if (Math.random() < 0.6) this._later((1 + i * 0.8) * 1000, () => { if (!v.active) return; const secs = rand(5, 9); this._react(v, secs, () => { this._visitorAnim(v, 'dance', { duration: secs, loop: false }); this._visitorEmote(v, pick(['🎶', '💃', '😆'])); }); });
        });
      } else if (g.anim === 'bow' || g.anim === 'wave') {
        const v = vis[0];
        if (Math.random() < 0.7) this._later(rand(700, 1400), () => { if (v.active) this._react(v, 2.6, () => this._visitorAnim(v, g.anim)); });
      } else if (g.anim === 'celebrate') {
        const v = vis[0];
        if (Math.random() < 0.6) this._later(900, () => { if (v.active) this._react(v, 2.6, () => this._visitorEmote(v, '👏', 'clap')); });
      }
    },

    _tryTalk(v) {
      if (v.talk) return;
      const partner = this._activeVisitors().find((o) => o !== v && !o.talk && !o.leaving && o.state === 'idle' && !o.react && Math.hypot(o.position.x - v.position.x, o.position.z - v.position.z) < 3.8);
      if (!partner || Math.random() < 0.35) return;
      const secs = rand(7, 11);
      const pair = { a: v, b: partner, t: secs, step: 0, next: 0.6 };
      v.talk = pair; partner.talk = pair;
      v.t = Math.max(v.t, secs + 1); partner.t = Math.max(partner.t, secs + 1);
      v.faceYaw = Math.atan2(partner.position.x - v.position.x, partner.position.z - v.position.z);
      partner.faceYaw = Math.atan2(v.position.x - partner.position.x, v.position.z - partner.position.z);
      v.rig.setLookTarget?.(partner.rig.headAnchor); partner.rig.setLookTarget?.(v.rig.headAnchor);
    },
    _tickTalk(pair, dt) {
      pair.t -= dt; pair.next -= dt;
      const { a, b } = pair;
      if (!a.active || !b.active || pair.t <= 0 || a.state !== 'idle' || b.state !== 'idle') {
        for (const v of [a, b]) { if (v.talk === pair) { v.talk = null; v.rig.setLookTarget?.(null); if (v.rig.currentAction === 'talk') v.rig.stopAction(); } }
        return;
      }
      if (pair.next <= 0) {
        const speaker = pair.step % 2 === 0 ? a : b, listener = speaker === a ? b : a;
        pair.step++;
        pair.next = rand(2.2, 3.4);
        this._visitorAnim(speaker, 'talk', { duration: pair.next - 0.3 });
        if (Math.random() < 0.6) this._visitorAnim(listener, 'nod');
        if (pair.step <= 2 && Math.random() < 0.75) {
          const text = pair.step === 1 ? this._pickLine(speaker) : this._replyLine(/[?？]/.test(this._lastPairLine || '') ? 'question' : 'agree');
          this._lastPairLine = text;
          this._visitorSay(speaker, text, { channel: 'local' });
        }
      }
    },

    // ---------------------------------------------------------------- per-frame visitor update
    _updateVisitors(dt) {
      const list = this._activeVisitors();
      if (!list.length) return;
      const E = G.sys.engine, cam = E.camera, cp = cam.position;
      const pl = G.sys.player;
      const pp = pl?._ready && G.state && pl.object?.visible !== false ? pl.position : null;
      const talks = this._talkSet || (this._talkSet = new Set());
      talks.clear();
      for (const v of list) {
        const p = v.position;
        const cd = Math.hypot(p.x - cp.x, p.z - cp.z);
        v.camDist = cd;
        const hide = cd > HIDE_DIST;
        if (hide !== v.hidden) { v.hidden = hide; v.group.visible = !hide; v.label.setVisible(!hide); }
        // simulate at a reduced rate far away
        v.simAcc += dt;
        const simStep = hide ? 0.25 : cd > 70 ? 0.066 : 0;
        if (v.simAcc >= simStep) {
          const sdt = Math.min(0.3, v.simAcc);
          v.simAcc = 0;
          this._think(v, sdt, pp, list);
        }
        if (v.talk) talks.add(v.talk);
        // animation (skip off-screen / far)
        if (!hide) {
          let adt = dt;
          if (cd > 45) { v.animAcc += dt; if (v.animAcc < (cd > 85 ? 0.2 : 0.08)) adt = 0; else { adt = v.animAcc; v.animAcc = 0; } }
          if (adt > 0) {
            _tv.copy(p); _tv.y += 0.8; _tv.project(cam);
            const onScreen = _tv.z < 1 && Math.abs(_tv.x) < 1.25 && Math.abs(_tv.y) < 1.3;
            if (onScreen || (v.offAcc = (v.offAcc || 0) + adt) > 0.5) { v.rig.update(onScreen ? adt : v.offAcc || adt, v.params); v.offAcc = 0; }
          }
          v.group.rotation.y = v.rotY;
        }
        this._tickBubble(v.bub, dt);
      }
      for (const pair of talks) this._tickTalk(pair, dt);
    },

    _think(v, dt, pp, list) {
      const p = v.position;
      // slide (sitting down / standing up)
      if (v.slide) {
        const s = v.slide;
        s.t += dt;
        const k = clamp(s.t / s.dur, 0, 1), e = k * k * (3 - 2 * k);
        p.x = s.fx + (s.x - s.fx) * e; p.z = s.fz + (s.z - s.fz) * e;
        if (k >= 1) v.slide = null;
      }
      // zone (cheap: every ~1 s)
      v.zt = (v.zt || 0) - dt;
      if (v.zt <= 0) { v.zt = 1; v.zoneId = G.world.zoneAt(p.x, p.z)?.id || null; }
      // greet the player when they come close
      if (pp && v.state !== 'walk' && !v.react && !v.talk) {
        const pd = Math.hypot(pp.x - p.x, pp.z - p.z);
        const now = G.time.elapsed;
        if (pd < 3.4 && now - v.greetAt > 150) {
          v.greetAt = now;
          if (Math.random() < 0.4) this._react(v, 2.6, () => this._visitorEmote(v, pick(['👋', '😊']), 'wave'));
        }
      }
      let speed = 0;
      if (v.react) {
        v.react.t -= dt;
        if (v.faceYaw != null && v.state !== 'sit') v.rotY += angleDiff(v.rotY, v.faceYaw) * damp(6, dt);
        if (v.react.t <= 0) { v.react = null; v.rig.setLookTarget?.(null); v.faceYaw = v.spot && v.state !== 'walk' ? v.spot.face ?? null : null; }
      } else if (v.state === 'walk') {
        speed = this._walkStep(v, dt, pp, list);
      } else {
        // idle / sit at a spot
        v.t -= dt; v.act -= dt;
        if (v.faceYaw != null && !v.slide) v.rotY += angleDiff(v.rotY, v.faceYaw) * damp(v.state === 'sit' ? 12 : 3, dt);
        if (v.state === 'sit' && pp && G.sys.player?.sitting?.bench?.id === v.spot?.id) v.t = Math.min(v.t, 0.5); // make room for the player
        if (v.act <= 0 && !v.talk) {
          v.act = rand(7, 15);
          const r = Math.random();
          if (v.state === 'sit') { if (r < 0.35) this._visitorAnim(v, pick(['nod', 'wave', 'think', 'clap'])); else if (r < 0.5) this._visitorEmote(v, pick(['😊', '🌿', '☀️', '😌'])); }
          else if (r < 0.45 && v.spot?.anims) this._visitorAnim(v, pick(v.spot.anims));
          else if (r < 0.6) this._visitorEmote(v, pick(['😊', '👍', '😆', '✨', '🙌']), pick(['nod', 'thumbsup', 'clap', null]));
          else if (r < 0.8 && v.spot?.social) this._tryTalk(v);
          else v.faceYaw = (v.spot?.face ?? v.rotY) + rand(-0.9, 0.9);
        }
        if (v.t <= 0 && !v.talk) this._next(v);
      }
      v.params.speed = speed;
      v.speedNow = speed;
    },

    _next(v) {
      if (v.leaving) {
        const exit = this.spots.find((s) => s.kind === 'exit');
        if (!exit || !this._startWalk(v, exit)) this._leaveDone(v);
        return;
      }
      const spot = this._chooseSpot(v);
      if (!spot || !this._startWalk(v, spot)) { v.state = v.rig.sitting ? 'sit' : 'idle'; v.t = rand(3, 7); }
    },

    _walkStep(v, dt, pp, list) {
      const p = v.position, path = v.path;
      if (v.slide) return 0; // still standing up from a bench
      if (!path || v.pi >= path.length) { this._arrive(v); return 0; }
      const tgt = path[v.pi];
      let dx = tgt.x - p.x, dz = tgt.z - p.z;
      const d = Math.hypot(dx, dz);
      const last = v.pi === path.length - 1;
      if (d < (last ? 0.28 : 0.85)) {
        if (last) { this._arrive(v); return 0; }
        v.pi++;
        this._pull(v);
        return v.speedNow || 0;
      }
      dx /= d; dz /= d;
      // local avoidance: separation from other visitors and the player
      let sx = 0, sz = 0, blockedAhead = false;
      for (const o of list) {
        if (o === v) continue;
        const ox = p.x - o.position.x, oz = p.z - o.position.z, od = Math.hypot(ox, oz);
        if (od < 1.05 && od > 1e-4) { const k = (1.05 - od) / od; sx += ox * k; sz += oz * k; }
      }
      if (pp) {
        const ox = p.x - pp.x, oz = p.z - pp.z, od = Math.hypot(ox, oz);
        if (od < 1.4 && od > 1e-4) {
          const k = (1.4 - od) / od * 1.6; sx += ox * k; sz += oz * k;
          if (-(ox * dx + oz * dz) / od > 0.75 && od < 1.25) blockedAhead = true;
        }
      }
      if (blockedAhead) {
        v.wait += dt;
        if (v.wait < 1.1) { v.rotY += angleDiff(v.rotY, Math.atan2(dx, dz)) * damp(5, dt); return 0; }
      } else v.wait = Math.max(0, v.wait - dt);
      const want = Math.atan2(dx + sx * 0.9, dz + sz * 0.9);
      v.rotY += angleDiff(v.rotY, want) * damp(8, dt);
      const align = Math.cos(angleDiff(v.rotY, want));
      if (align < 0.3) return 0.3;
      const base = v.run ? 3.4 : v.speed;
      const sp = base * clamp(align, 0.45, 1) * (last && d < 1.4 ? Math.max(0.45, d / 1.4) : 1);
      const step = Math.min(sp * dt, d + 0.05);
      // move along the facing direction; deflect around unexpected obstacles (NPCs, props)
      for (const off of DEFLECT) {
        const a = v.rotY + off;
        const nx = p.x + Math.sin(a) * step, nz = p.z + Math.cos(a) * step;
        const y = walkY(nx, nz, p.y, 0.32);
        if (y == null) continue;
        p.x = nx; p.z = nz;
        p.y += (y - p.y) * damp(16, dt);
        if (off !== 0) v.rotY += angleDiff(v.rotY, a) * damp(4, dt);
        v.stuck = Math.max(0, v.stuck - dt);
        return sp;
      }
      v.stuck += dt;
      if (v.stuck > 1.6) { v.stuck = 0; v.state = 'idle'; v.t = rand(0.5, 1.5); v.path = null; this.stats.stuck++; }
      return 0;
    },

    // ---------------------------------------------------------------- arrivals & departures
    _leaveDone(v) {
      const name = v.name;
      this.stats.leaves++;
      this._deactivate(v);
      this.system(`🚪 ${J.nim(name)}이 체험관을 떠났어요.`);
      this._updateOnline();
      if (this._joinT < 0) this._joinT = rand(25, 70);
    },
    _join() {
      const free = this._pool.find((v) => !v.active);
      if (!free) return;
      const used = new Set(this._activeVisitors().map((v) => v.name));
      const names = (G.data.visitors?.names || []).filter((n) => !used.has(n));
      if (!names.length) return;
      this._assignName(free, pick(names));
      this.stats.joins++;
      const exit = this.spots.find((s) => s.kind === 'exit');
      this._activate(free, null, { at: exit ? { x: exit.x, z: exit.z + 1 } : { x: 0, z: 68 } });
      free.rotY = Math.PI;
      free.state = 'idle'; free.t = 0.6;
      this.system(`👋 ${J.nim(free.name)}이 입장했어요. 반갑게 인사해 보세요!`);
      this._updateOnline();
      this._later(rand(5000, 9000), () => { if (free.active && Math.random() < 0.6) this._visitorSay(free, pick(['안녕하세요!', '저 처음 왔어요!', '모두 반갑습니다~', '와, 공기가 정말 좋네요!'])); });
    },

    _updateVisitorScheduler(dt) {
      const vis = this._activeVisitors();
      // ambient chat lines (every 25–60 s overall)
      this._lineT -= dt;
      if (this._lineT <= 0 && vis.length) {
        this._lineT = rand(25, 60);
        const pp = G.sys.player?.position;
        let tot = 0;
        const cand = vis.filter((v) => !v.leaving && !this._isBlocked(v.name)).map((v) => {
          const d = pp ? Math.hypot(v.position.x - pp.x, v.position.z - pp.z) : 50;
          const w = d < LOCAL_R ? 3 : d < 60 ? 1.4 : 0.6;
          tot += w; return [v, w];
        });
        let x = Math.random() * tot, sp = null;
        for (const [v, w] of cand) { x -= w; if (x <= 0) { sp = v; break; } }
        if (sp) {
          const line = this._pickLine(sp);
          this.stats.lines++;
          this._visitorSay(sp, line, { anim: Math.random() < 0.4 ? pick(['wave', 'nod', 'clap']) : null });
          // sometimes someone answers
          if (Math.random() < 0.35) {
            const other = pick(vis.filter((o) => o !== sp && !o.leaving));
            const kind = /안녕|반가|처음/.test(line) ? 'greet' : /[?？]/.test(line) ? 'question' : 'agree';
            if (other) this._later(rand(2200, 4200), () => { if (other.active && G.state) this._visitorSay(other, this._replyLine(kind)); });
          }
        }
      }
      // occasional departures and arrivals keep the crowd alive
      this._cycleT -= dt;
      if (this._cycleT <= 0) {
        this._cycleT = rand(170, 320);
        const pp = G.sys.player?.position;
        if (vis.length > 8 && Math.random() < 0.65) {
          const cand = vis.filter((v) => !v.leaving && !v.talk && (!pp || Math.hypot(v.position.x - pp.x, v.position.z - pp.z) > 18));
          const v = cand.length ? pick(cand) : null;
          if (v) { v.leaving = true; if (v.state !== 'walk') v.t = Math.min(v.t, rand(1, 4)); else { const exit = this.spots.find((s) => s.kind === 'exit'); if (!exit || !this._startWalk(v, exit)) this._leaveDone(v); } }
        } else if (vis.length < this._target) this._joinT = rand(5, 20);
      }
      if (this._joinT >= 0) {
        this._joinT -= dt;
        if (this._joinT < 0 && this._activeVisitors().length < this._target) this._join();
      }
    },

    // ================================================================ server mode (presence + chat polling)
    _startServer() {
      const now = performance.now();
      // network timers run on the wall clock (game dt is capped and slows down on weak devices)
      this._srv = { nextPres: now + 300, nextChat: now + 150, presBusy: false, chatBusy: false, fails: 0, lastId: 0, first: true, presFirst: true, online: 0, appKey: '', appT: 0, pending: [], sentIds: new Set(), missing: new Map(), warned: false };
      G.log.info('NETWORK', 'social: server presence & chat polling started');
    },
    _stopServer() { this._srv = null; },
    _backoff(base) { const f = this._srv?.fails || 0; return Math.min(30, base * Math.pow(2, Math.min(4, f))); },
    _netFail(e) {
      const S = this._srv;
      if (!S) return;
      S.fails++;
      if (S.fails >= 3 && !S.warned) {
        S.warned = true;
        this.system('⚠️ 서버 연결이 불안정해요. 자동으로 다시 연결하는 중이에요.');
        G.ui.toast('서버 연결이 불안정해요. 잠시 후 자동으로 다시 시도합니다.', { type: 'warn' });
      }
      G.log.warn('NETWORK', 'social request failed', e?.code || e);
    },
    _netOk() {
      const S = this._srv;
      if (!S) return;
      if (S.warned) { S.warned = false; this.system('✅ 서버에 다시 연결되었어요.'); }
      S.fails = 0;
    },
    _updateServer(dt) {
      const S = this._srv;
      if (!S) return;
      const canWrite = !this._guestReadOnly();
      const now = performance.now();
      if (canWrite && now >= S.nextPres && !S.presBusy) { S.nextPres = now + this._backoff(2) * 1000; this._presence(); }
      if (now >= S.nextChat && !S.chatBusy) { S.nextChat = now + this._backoff(3) * 1000; this._pollChat(); }
      this._updateRemotes(dt);
    },
    async _presence() {
      const S = this._srv, pl = G.sys.player;
      if (!S || !pl?.position || !G.state) return;
      S.presBusy = true;
      try {
        const p = pl.position;
        const app = G.state.profile?.avatar || G.avatar?.defaultAppearance || null;
        const appKey = JSON.stringify(app || {});
        S.appT -= 1;
        const sendApp = appKey !== S.appKey || S.appT <= 0;
        const anim = pl.rig?.currentAction || (pl.sitting ? 'sit' : pl.speed > 4.5 ? 'run' : pl.speed > 0.2 ? 'walk' : 'idle');
        const body = {
          x: Math.round(p.x * 100) / 100, y: Math.round(p.y * 100) / 100, z: Math.round(p.z * 100) / 100, rotY: Math.round((pl.rotY || 0) * 1000) / 1000,
          anim, speed: Math.round((pl.speed || 0) * 10) / 10, zoneId: G.state.player?.zoneId || G.sys.minimap?.currentZone?.id || null,
          emote: this._emoteState?.id || null, emoteAt: this._emoteState?.at || 0, nickname: G.state.profile?.nickname || '',
        };
        if (sendApp) { body.appearance = app; S.appKey = appKey; S.appT = 10; }
        const data = await G.net.request('presence/update.php', { body, timeout: 6000, quiet: true });
        if (this._srv !== S) return;
        this._netOk();
        this._applyPresence(data);
      } catch (e) { if (this._srv === S) this._netFail(e); }
      finally { S.presBusy = false; }
    },
    _applyPresence(data) {
      const S = this._srv;
      const list = Array.isArray(data) ? data : Array.isArray(data?.players) ? data.players : [];
      const me = String(G.save?.profile?.id ?? '');
      const seen = new Set();
      for (const r of list) {
        const id = String(r.id ?? r.userId ?? r.user_id ?? '');
        if (!id || id === me) continue;
        const key = 'P_' + id;
        seen.add(key);
        try { this._upsertRemote(key, id, r); } catch (e) { G.log.warn('NETWORK', 'remote player update failed', e); }
      }
      for (const [key, o] of this.others) {
        if (o.kind !== 'remote' || seen.has(key)) continue;
        const miss = (S.missing.get(key) || 0) + 1;
        S.missing.set(key, miss);
        if (miss >= 2) { this._removeRemote(o); S.missing.delete(key); }
      }
      for (const key of seen) S.missing.delete(key);
      const online = Number(data?.online ?? data?.count);
      S.online = Number.isFinite(online) && online > 0 ? online : 1 + seen.size;
      S.presFirst = false;
      this._updateOnline();
    },
    _upsertRemote(key, id, r) {
      const name = String(r.nickname ?? r.name ?? '체험객').slice(0, 24);
      const x = Number(r.x), z = Number(r.z), y = Number(r.y), rot = Number(r.rotY ?? r.rot ?? 0);
      if (!Number.isFinite(x) || !Number.isFinite(z)) return;
      let o = this.others.get(key);
      if (!o) {
        if (!G.avatar?.create || !this._vroot) return;
        const h = G.ui.h;
        const rig = G.avatar.create(r.appearance || G.avatar.random(U.hashInt(name)), { shadow: this._shadow });
        const group = new THREE.Group(); group.name = 'remote'; group.add(rig.group);
        this._vroot.add(group);
        const bubble = this._bubbleEl('remote');
        const tag = h('button', { class: 'nametag remote', type: 'button', title: `${name} · 클릭하면 메뉴가 열려요` }, h('i', { class: 'soc-dot', style: { background: nameColor(name) } }), h('span', { class: 'nm' }, name));
        const root = h('div', { class: 'soc-label' }, bubble, tag);
        const label = G.ui.label({ el: root, target: rig.headAnchor, offsetY: 0.04, maxDist: LABEL_DIST, fadeDist: 8 });
        o = { id: key, uid: id, name, kind: 'remote', rig, group, position: group.position, rotY: rot, zoneId: r.zoneId || null, label, el: { root, bubble, tag }, bub: { bubble, t: 0 }, params: { speed: 0, grounded: true, vy: 0 }, tx: x, tz: z, ty: y, trot: rot, anim: null, emoteAt: Number(r.emoteAt) || 0, appKey: '' };
        tag.addEventListener('click', (e) => { e.stopPropagation(); this._openUser(tag, { name: o.name, kind: 'remote', id }); });
        group.position.set(x, Number.isFinite(y) ? y : G.world.surfaceHeight(x, z), z);
        group.rotation.y = rot;
        root.classList.toggle('blocked', this._isBlocked(name));
        this.others.set(key, o);
        if (!this._srv?.presFirst) this.system(`👋 ${J.nim(name)}이 접속했어요.`);
      }
      if (r.appearance) { const k = JSON.stringify(r.appearance); if (k !== o.appKey) { o.appKey = k; try { o.rig.setAppearance(r.appearance); } catch (e) { /* keep */ } } }
      if (Math.hypot(x - o.position.x, z - o.position.z) > 25) { o.position.set(x, Number.isFinite(y) ? y : o.position.y, z); }
      o.tx = x; o.tz = z; o.ty = Number.isFinite(y) ? y : null; o.trot = rot; o.zoneId = r.zoneId || o.zoneId;
      const anim = r.anim && G.avatar?.actions?.[r.anim] ? r.anim : null;
      if (anim !== o.anim) {
        o.anim = anim;
        if (anim) {
          const def = G.avatar.actions[anim];
          const onBench = (G.data.layout?.benches || []).some((b) => Math.hypot(b.x - x, b.z - z) < 1.2);
          o.rig.setAnim(anim, { loop: def.loop || anim === 'sit' || anim === 'dance', seatY: anim === 'sit' ? (onBench ? 0.44 : 0) : undefined });
        }
        else o.rig.stopAll?.();
      }
      const eAt = Number(r.emoteAt) || 0;
      if (r.emote && eAt > o.emoteAt) {
        o.emoteAt = eAt;
        const e = (G.data.emotes || []).find((q) => q.id === r.emote);
        if (e && !this._isBlocked(o.name) && Date.now() - eAt < 15000) { this._bubble(o.bub, e.icon, { emote: true }); o.rig.setAnim(e.anim, {}); }
      }
    },
    _updateRemotes(dt) {
      const cam = G.sys.engine.camera.position;
      for (const o of this.others.values()) {
        if (o.kind !== 'remote') continue;
        const p = o.position;
        const ox = p.x, oz = p.z;
        const k = damp(3.2, dt);
        p.x += (o.tx - p.x) * k; p.z += (o.tz - p.z) * k;
        const gy = o.ty != null ? o.ty : G.world.heightAt(p.x, p.z, p.y + 0.3);
        p.y += (gy - p.y) * damp(8, dt);
        o.rotY += angleDiff(o.rotY, o.trot) * damp(6, dt);
        o.group.rotation.y = o.rotY;
        const sp = dt > 0 ? Math.hypot(p.x - ox, p.z - oz) / dt : 0;
        o.params.speed += (sp - o.params.speed) * damp(6, dt);
        const cd = Math.hypot(p.x - cam.x, p.z - cam.z);
        const hide = cd > HIDE_DIST;
        o.group.visible = !hide;
        if (!hide) o.rig.update(dt, o.params);
        this._tickBubble(o.bub, dt);
      }
    },
    _removeRemote(o) {
      try { o.label?.remove(); o.rig?.dispose?.(); o.group?.parent?.remove(o.group); } catch (e) { /* ignore */ }
      this.others.delete(o.id);
      if (G.state && this._srv) this.system(`🚪 ${J.nim(o.name)}이 나갔어요.`);
    },
    _clearRemotes() {
      for (const o of [...this.others.values()]) {
        if (o.kind !== 'remote') continue;
        try { o.label?.remove(); o.rig?.dispose?.(); o.group?.parent?.remove(o.group); } catch (e) { /* ignore */ }
        this.others.delete(o.id);
      }
    },
    async _pollChat() {
      const S = this._srv;
      if (!S || !G.state) return;
      S.chatBusy = true;
      try {
        const data = await G.net.request(`chat/list.php?after=${encodeURIComponent(S.lastId)}`, { timeout: 6000, quiet: true });
        if (this._srv !== S) return;
        this._netOk();
        const msgs = (Array.isArray(data) ? data : Array.isArray(data?.messages) ? data.messages : []).slice().sort((a, b) => Number(a.id) - Number(b.id));
        const me = String(G.save?.profile?.id ?? '');
        const pp = G.sys.player?.position;
        for (const m of msgs) {
          const id = Number(m.id);
          if (!Number.isFinite(id) || id <= S.lastId) continue;
          S.lastId = id;
          if (S.sentIds.has(id)) continue;
          const uid = String(m.userId ?? m.user_id ?? '');
          const text = this.filter(String(m.text ?? m.message ?? ''));
          const self = !!uid && uid === me;
          if (self) {
            const i = S.pending.indexOf(text);
            if (i >= 0) { S.pending.splice(i, 1); continue; }
          }
          const channel = ['all', 'local', 'system'].includes(m.channel) ? m.channel : 'all';
          const name = channel === 'system' ? '시스템' : String(m.nickname ?? m.name ?? '체험객');
          const rawAt = m.createdAt ?? m.created_at ?? m.at;
          let at = Number(rawAt);
          if (!Number.isFinite(at) || at <= 0) at = Date.parse(String(rawAt ?? '').replace(' ', 'T'));
          if (!Number.isFinite(at) || at <= 0) at = G.time.now();
          const remote = [...this.others.values()].find((o) => o.kind === 'remote' && (o.uid === uid || o.name === name));
          const near = remote && pp ? Math.hypot(remote.position.x - pp.x, remote.position.z - pp.z) <= LOCAL_R : false;
          if (channel === 'local' && !near && !self) continue;
          this._push({ name, text, channel, kind: channel === 'system' ? 'system' : self ? 'me' : 'remote', self, near: near || self, uid, sid: id, at: at < 1e11 ? at * 1000 : at, history: S.first });
          if (!S.first && !self && remote && !this._isBlocked(name)) { this._bubble(remote.bub, text); G.sfx('chat', { volume: 0.6 }); }
        }
        S.first = false;
        const online = Number(data?.online);
        if (Number.isFinite(online) && online > 0) { S.online = online; this._updateOnline(); }
      } catch (e) { if (this._srv === S) this._netFail(e); }
      finally { S.chatBusy = false; }
    },
    async _serverSend(text, channel) {
      const S = this._srv;
      if (!S) return;
      S.pending.push(text);
      if (S.pending.length > 20) S.pending.shift();
      try {
        const data = await G.net.request('chat/send.php', { body: { text, channel }, timeout: 8000 });
        const id = Number(data?.message?.id ?? data?.id);
        if (Number.isFinite(id)) {
          S.sentIds.add(id);
          const i = S.pending.indexOf(text); if (i >= 0) S.pending.splice(i, 1);
          if (S.sentIds.size > 200) S.sentIds = new Set([...S.sentIds].slice(-100));
        }
        this._netOk();
      } catch (e) {
        const i = S.pending.indexOf(text); if (i >= 0) S.pending.splice(i, 1);
        if (e?.code === 'RATE_LIMITED' || e?.status === 429) G.ui.toast('메시지를 너무 빨리 보내고 있어요. 잠시 후 다시 보내 주세요.', { type: 'warn' });
        else G.ui.toast(e?.message || '메시지를 보내지 못했어요.', { type: 'error' });
        this.system('⚠️ 마지막 메시지가 전송되지 않았어요.');
      }
    },

    // ================================================================ frame
    update(dt) {
      this._tickBubble(this._me, dt);
      if (!G.state) return;
      if (this._mode === 'local') {
        this._updateVisitors(dt);
        this._updateVisitorScheduler(dt);
      } else this._updateServer(dt);
    },
  };

  const _tv = new THREE.Vector3();
  G.register(social);
})();
