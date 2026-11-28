// =============================================================================
// 73-ai.js — 🤖 옹이 선생님: a child asks a question about the 체험관 and gets a short, calm answer from the server's
//            Claude helper (G.sys.ai, CONTRACT §15.6 / §16.10, owner: claude)
//
//   G.sys.ai (order 93)
//     available() -> bool        server mode + a server account + the operator switched the helper on (G.site
//                                'ai.kid_helper', public). In local (file) mode the helper does not exist.
//     menuItem(kid) -> {emoji, label, say, fn} | null   the fifth item of 옹이's play menu (65-companion asks for it);
//                                null when not available
//     open() -> modal | null     the window: first GET api/ai/status.php (tiles, questions left), then the tiles
//     ask({presetId} | {question}) -> Promise<{ok, answer, why, left}>   POST api/ai/ask.php (also used by the window)
//     state (getter)             'closed' | 'loading' | 'pick' | 'thinking' | 'answer' | 'off' | 'error'
//     preview(opts) -> modal     the developer centre / kid audit: the same window with sample tiles and a sample answer,
//                                no server and no network (opts.left, opts.answer, opts.why) — never reachable from the menu
//   KID RULES (§12): easy mode = preset picture tiles only (≥ 56 px, a data-say line each, no typing — the question text is
//     chosen on the server from the tile's id, so nothing a child types leaves the app); every state has a way back
//     (⬅️ 닫기 of the window, 🙋 다른 것 물어보기 after an answer); used up / unreachable / switched off = one calm
//     sentence and 닫기; the answer is read aloud (G.easy.say) with a 🔊 다시 듣기. No prices, no links. The thinking
//     dots pulse slowly (≤ 1 Hz) and stand still with reduce motion.
//   Normal mode adds a text box of at most 200 characters (the server masks personal data before it leaves and filters
//     bad words; a note under the box says so).
//   SECURITY: the answer and every server text reach the DOM as text (G.ui.h children / textContent), never as HTML;
//     the page never sees the key or the model; requests go only to this site (G.net.request, CSRF header).
//   Events: ai:answered { ok, why, preset } · ai:opened {}
// =============================================================================
(function () {
  const h = (...a) => G.ui.h(...a);
  const CAT = 'AI';
  const easyOn = () => (typeof G.easy?.on === 'boolean' ? G.easy.on : G.settings?.easyMode !== false);
  const isServer = () => G.net?.mode === 'server';
  const say = (t) => { try { if (easyOn()) G.easy?.say?.(t, { priority: 1 }); } catch (e) { /* voice optional */ } };
  const Q_MAX = 200;
  const mascot = (mood, size) => { try { return G.mascot?.svg?.(mood, size, { outfit: 'current', bob: true }) || ''; } catch (e) { return ''; } };
  // G.ui.modal.open sets the footer from opts.actions after the body callback: a body that sets its own buttons does so
  // in a microtask
  const later = (m, actions) => queueMicrotask(() => { if (!m.closed) m.setActions(actions); });
  // the calm sentences of the page itself (the server sends its own for its reasons)
  const LINE = {
    local: '옹이 선생님은 체험관 서버에 연결했을 때 만날 수 있어요.',
    login: '로그인하면 옹이 선생님에게 물어볼 수 있어요.',
    off: '지금은 옹이 선생님이 쉬고 있어요. 다음에 또 물어봐 줘요.',
    busy: '조금 천천히 물어봐요. 잠깐 쉬었다가 다시 해 봐요.',
    net: '지금은 옹이 선생님과 이야기가 잘 안 돼요. 조금 뒤에 다시 해 봐요.',
    none: '오늘 물어볼 수 있는 만큼 다 물어봤어요. 내일 또 만나요!',
  };
  // sample tiles of preview() only (the real ones come from api/ai/status.php)
  const PREVIEW_TILES = [
    { id: 'kimchi', icon: '🥬', label: '김치는 어떻게 만들어요?' }, { id: 'doenjang', icon: '🫘', label: '된장은 왜 오래 기다려요?' },
    { id: 'meju', icon: '🧱', label: '메주는 뭐예요?' }, { id: 'gochujang', icon: '🌶️', label: '고추장은 무슨 맛이에요?' },
    { id: 'jangdok', icon: '🏺', label: '장독대는 왜 햇볕에 있어요?' }, { id: 'hanok', icon: '🏠', label: '한옥 지붕은 왜 휘었어요?' },
    { id: 'hanbok', icon: '👘', label: '저고리는 뭐예요?' }, { id: 'spring', icon: '🌱', label: '봄에는 무엇을 심어요?' },
    { id: 'autumn', icon: '🍂', label: '가을에는 무엇을 거둬요?' }, { id: 'winter', icon: '❄️', label: '겨울에 장은 어떻게 돼요?' },
  ];
  const TILE_COLORS = ['#ffb86b', '#8ce99a', '#74c0fc', '#ff8fb3', '#ffd43b', '#b197fc', '#63e6be', '#ffa8a8', '#a5d8ff', '#d8f5a2'];

  const AI = {
    name: 'ai',
    order: 93,
    _state: 'closed',
    _status: null,
    _modal: null,
    _busy: false,
    _preview: null,
    _last: null,

    init() {
      G.bus.on?.('site:changed', (e) => { if (e?.keys?.includes?.('ai.kid_helper') && !this.available()) this._modal?.close?.(); });
    },
    update() {},

    get state() { return this._state; },

    available() {
      if (!isServer()) return false;
      if (G.auth?.current?.kind !== 'server') return false;
      return G.site?.get?.('ai.kid_helper', false) === true;
    },

    menuItem(kid) {
      if (!this.available()) return null;
      return kid
        ? { emoji: '🤖', label: '물어보기', say: '옹이 선생님에게 궁금한 걸 물어봐요', color: '#b197fc', fn: () => this.open() }
        : { emoji: '🤖', label: '옹이 선생님', say: '옹이 선생님에게 물어보기', fn: () => this.open() };
    },

    async ask(q) {
      if (this._preview) {
        const p = this._preview;
        await new Promise((r) => setTimeout(r, 250));
        if (p.left > 0) p.left--;
        return { ok: p.why === 'ok', answer: p.why === 'ok' ? p.answer : (p.why === 'capped_user' ? LINE.none : LINE.net), why: p.why, left: p.left };
      }
      const body = q && typeof q.presetId === 'string' ? { presetId: q.presetId.slice(0, 40) } : { question: String(q?.question ?? '').slice(0, Q_MAX) };
      try {
        const d = await G.net.request('ai/ask.php', { body, timeout: 75000, quiet: true });
        const out = { ok: d?.ok === true, answer: typeof d?.answer === 'string' ? d.answer.slice(0, 1200) : '', why: typeof d?.why === 'string' ? d.why.slice(0, 30) : '', left: Number.isFinite(d?.left) ? Math.max(0, d.left | 0) : null };
        if (!out.answer) out.answer = LINE.net;
        return out;
      } catch (e) {
        const st = e?.status | 0;
        const why = st === 429 ? 'busy' : st === 401 ? 'login' : st === 400 ? 'bad' : 'net';
        G.log.warn(CAT, `ask failed (${e?.code || st})`);
        return { ok: false, answer: why === 'busy' ? LINE.busy : why === 'login' ? LINE.login : LINE.net, why, left: null };
      }
    },

    async _loadStatus() {
      if (this._preview) return { kid: true, presets: PREVIEW_TILES.map((t) => ({ ...t, say: t.label })), left: this._preview.left, max: Q_MAX };
      try {
        const d = await G.net.request('ai/status.php', { timeout: 9000, quiet: true });
        const presets = Array.isArray(d?.presets) ? d.presets.slice(0, 16).filter((p) => p && typeof p.id === 'string' && /^[a-z0-9_]{1,40}$/.test(p.id)).map((p) => ({
          id: p.id, icon: typeof p.icon === 'string' ? p.icon.slice(0, 8) : '❓', label: typeof p.label === 'string' ? p.label.slice(0, 40) : p.id, say: typeof p.say === 'string' ? p.say.slice(0, 80) : '',
        })) : [];
        return { kid: d?.kid === true, presets, left: Number.isFinite(d?.left) ? Math.max(0, d.left | 0) : 0, max: Math.min(Q_MAX, Math.max(20, d?.max | 0 || Q_MAX)) };
      } catch (e) {
        G.log.warn(CAT, `status failed (${e?.code || e?.status || 'network'})`);
        return null;
      }
    },

    open() {
      if (G.ui.modal.get?.('ai-helper')) return G.ui.modal.get('ai-helper');
      const kid = easyOn();
      const view = { kind: 'loading', text: '', why: '', preset: null, typed: '' };
      const m = G.ui.modal.open({
        id: 'ai-helper', title: '옹이 선생님에게 물어보기', icon: '🤖', size: 'md', className: `ai-modal${kid ? ' ai-kid' : ''}`, autofocus: false,
        onClose: () => { this._modal = null; this._state = 'closed'; this._preview = null; },
        body: (body, mm) => {
          const render = () => {
            body.textContent = '';
            this._state = view.kind;
            const st = this._status;
            if (view.kind === 'loading') {
              body.append(this._hero('think', '옹이 선생님을 부르고 있어요…', true));
              later(mm, [{ label: '닫기', class: 'btn-ghost' }]);
              return;
            }
            if (view.kind === 'off' || view.kind === 'error') {
              body.append(this._hero(view.kind === 'off' ? 'sleepy' : 'sad', view.text));
              later(mm, view.kind === 'error'
                ? [{ label: '닫기', class: 'btn-ghost' }, { label: '🔄 다시 해 보기', class: 'btn-soft', onClick: () => { start(); return false; } }]
                : [{ label: '닫기', class: 'btn-primary' }]);
              say(view.text);
              return;
            }
            if (view.kind === 'thinking') {
              body.append(this._hero('think', '옹이 선생님이 생각하고 있어요', true));
              later(mm, [{ label: '닫기', class: 'btn-ghost' }]);
              return;
            }
            if (view.kind === 'answer') {
              const ans = h('div', { class: `ai-answer${view.ok ? '' : ' is-calm'}`, 'data-say': view.text, role: 'status', 'aria-live': 'polite' });
              ans.textContent = view.text; // server text: always as text
              const face = h('div', { class: 'ai-face', html: mascot(view.ok ? 'happy' : 'sleepy', kid ? 92 : 76) });
              const wrap = h('div', { class: 'ai-talk' }, face, ans);
              if (view.preset) body.append(h('p', { class: 'ai-asked', text: `🙋 ${view.preset}` }));
              body.append(wrap);
              if (st && Number.isFinite(st.left)) body.append(this._left(st.left));
              if (view.ok) body.append(h('p', { class: 'ai-note', text: '옹이 선생님의 말이 틀릴 때도 있어요. 궁금한 건 선생님께 한 번 더 여쭤봐요.' }));
              const acts = [{ label: '🙋 다른 것 물어보기', class: 'btn-primary', onClick: () => { view.kind = 'pick'; render(); return false; } }, { label: '닫기', class: 'btn-ghost' }];
              if (kid) acts.splice(1, 0, { label: '🔊 다시 듣기', class: 'btn-soft', onClick: () => { try { G.easy?.say?.(view.text, { priority: 2, interrupt: true }); } catch (e) { /* voice optional */ } return false; } });
              if (st && st.left === 0) acts.shift();
              later(mm, acts);
              say(view.text);
              return;
            }
            // pick
            if (!st || !st.presets.length) { view.kind = 'off'; view.text = LINE.off; render(); return; }
            if (st.left === 0) { view.kind = 'answer'; view.ok = false; view.text = LINE.none; view.preset = null; render(); return; }
            body.append(this._hero('wink', kid ? '무엇이 궁금해요? 그림을 눌러 물어봐요.' : '무엇이 궁금해요? 그림을 누르거나 직접 써서 물어봐요.'));
            body.append(this._left(st.left));
            const grid = h('div', { class: 'ai-tiles', role: 'list' });
            st.presets.forEach((p, i) => {
              const b = h('button', { type: 'button', class: 'ai-tile', role: 'listitem', 'data-say': p.say || p.label, dataset: { preset: p.id } },
                h('span', { class: 'ai-tile-ico emoji', 'aria-hidden': 'true' }, p.icon),
                h('span', { class: 'ai-tile-lbl', text: p.label }));
              b.style.setProperty('--tile', TILE_COLORS[i % TILE_COLORS.length]);
              b.addEventListener('click', () => send({ presetId: p.id }, p.label));
              grid.append(b);
            });
            body.append(grid);
            if (!kid) {
              const ta = h('textarea', { class: 'ai-input', maxlength: String(st.max), rows: '2', placeholder: '예: 식초는 어떻게 만들어요?', 'aria-label': '옹이 선생님에게 물어볼 말' });
              ta.value = view.typed;
              const count = h('span', { class: 'ai-count', text: `${[...ta.value].length} / ${st.max}` });
              const go = h('button', { type: 'button', class: 'btn btn-primary ai-send' }, '💬 물어보기');
              const sync = () => { view.typed = ta.value; const n = [...ta.value].length; count.textContent = `${n} / ${st.max}`; go.disabled = !ta.value.trim() || n > st.max; };
              ta.addEventListener('input', sync);
              ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); if (!go.disabled) go.click(); } });
              go.addEventListener('click', () => { const q = ta.value.trim(); if (q) send({ question: q }, q.length > 40 ? q.slice(0, 40) + '…' : q); });
              sync();
              body.append(h('div', { class: 'ai-ask' }, h('label', { class: 'ai-ask-lbl', text: '✍️ 직접 물어보기' }), ta, h('div', { class: 'ai-ask-row' }, count, go)),
                h('p', { class: 'ai-note', text: '이름 · 전화번호 · 주소는 쓰지 말아요. 혹시 써도 보내기 전에 저절로 가려져요.' }));
            }
            later(mm, [{ label: '닫기', class: 'btn-ghost' }]);
            say(kid ? '무엇이 궁금해요? 그림을 눌러 물어봐요.' : '');
          };
          const send = async (q, label) => {
            if (this._busy) return;
            this._busy = true;
            view.kind = 'thinking'; view.preset = label || null;
            render();
            const r = await this.ask(q);
            this._busy = false;
            this._last = r;
            if (this._status && r.left !== null) this._status.left = r.left;
            if (r.why === 'off') { view.kind = 'off'; view.text = r.answer || LINE.off; }
            else { view.kind = 'answer'; view.ok = r.ok; view.text = r.answer; }
            G.bus.emit('ai:answered', { ok: r.ok, why: r.why, preset: q.presetId || null });
            if (!mm.closed) render();
          };
          const start = async () => {
            view.kind = 'loading'; render();
            if (!this._preview && !isServer()) { view.kind = 'off'; view.text = LINE.local; render(); return; }
            if (!this._preview && G.auth?.current?.kind !== 'server') { view.kind = 'off'; view.text = LINE.login; render(); return; }
            const s = await this._loadStatus();
            if (mm.closed) return;
            if (!s) { view.kind = 'error'; view.text = LINE.net; render(); return; }
            this._status = s;
            if (!s.kid) { view.kind = 'off'; view.text = LINE.off; render(); return; }
            view.kind = 'pick'; render();
          };
          start();
        },
      });
      this._modal = m;
      G.bus.emit('ai:opened', {});
      return m;
    },

    preview(opts = {}) {
      G.ui.modal.get?.('ai-helper')?.close?.({ instant: true });
      this._preview = { left: Number.isFinite(opts.left) ? opts.left : 5, why: typeof opts.why === 'string' ? opts.why : 'ok',
        answer: typeof opts.answer === 'string' ? opts.answer : '배추를 소금에 절여 숨을 죽인 다음, 고춧가루와 마늘 같은 양념을 골고루 발라요. 항아리에 담아 두면 며칠 동안 천천히 익으면서 새콤한 맛이 나요.' };
      return this.open();
    },

    _hero(mood, text, dots) {
      const kid = easyOn();
      const bubble = h('div', { class: 'ai-bubble', 'data-say': text });
      bubble.textContent = text;
      if (dots) bubble.append(h('span', { class: 'ai-dots', 'aria-hidden': 'true' }, h('i'), h('i'), h('i')));
      return h('div', { class: 'ai-hero' }, h('div', { class: 'ai-face', html: mascot(mood, kid ? 92 : 76) }), bubble);
    },

    _left(n) {
      return h('p', { class: `ai-left${n <= 2 ? ' is-low' : ''}`, 'data-say': n > 0 ? `오늘 ${n}번 더 물어볼 수 있어요` : '오늘은 다 물어봤어요', text: n > 0 ? `🎟️ 오늘 ${n}번 더 물어볼 수 있어요` : '🌙 오늘은 다 물어봤어요' });
    },
  };

  G.register(AI);
})();
