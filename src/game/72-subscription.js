// =============================================================================
// 72-subscription.js — G.sys.subscription: 진행 속도 구독 (CONTRACT §14.6, client side)
//
//   open({gate})          the grown-up subscription screen: current plan, three tier cards (name, price, what speeds
//                         up), 자동 갱신 구독 (토스) / 한 달 이용권 (1회 결제), 해지하기, the legal note. Easy mode asks the
//                         parent gate (reason 'subscription') first; reachable only from 어른 메뉴 and the settings 체험 tab.
//                         Local mode: the cards are disabled with 서버에 설치하면 구독할 수 있어요 + the install guide.
//   buy(tier, kind)       prepare.php → 토스 SDK (https://js.tosspayments.com/v2/standard, loaded on demand, server
//                         mode only) requestPayment / requestBillingAuth → the browser comes back through
//                         api/sub/return.php → index.html?sub=ok|fail. Mock mode (server TFM_TOSS_MOCK=1): a built-in
//                         테스트 결제 dialog that calls confirm.php with mock_<orderId> (no SDK).
//   cancel()              auto-renew off (access stays until expiresAt).
//   refresh()             GET sub/status.php → fromServer(sub)
//   fromServer(sub, src)  the server's word on the player's plan: emits 'sub:changed' (07-speed's G.sys.speed mirrors it
//                         into G.state.sub and emits 'speed:changed'); keeps the HUD chip #hud-speed in sync.
//   current() / tier()    the effective plan / tier (1..4); local mode is always 1.
//   HUD: #hud-speed (hidden at tier 1): normal ⚡2×, easy ⚡ 2배 빨라요; pulses on speed:changed; 옹이 cheers once.
//   ?sub=ok&tier=N → after login: status refresh + celebration + toast '⚡ N배 빠르게 시작!'; ?sub=fail&msg=… → a calm
//   error. The query is cleaned with history.replaceState.
// Security / kid safety: no prices on kid screens (the screen is behind the gate; the HUD chip shows no price); the
// secret key never reaches the client (status.php sends the public clientKey only); every write is a same-origin JSON
// POST with the CSRF token (G.net.request); no innerHTML with server text (textContent / G.ui.h); no inline handlers.
// =============================================================================
(function () {
  const $ = (sel, root = document) => root.querySelector(sel);
  const h = (...a) => G.ui.h(...a);
  const fmt = (n) => G.util.fmt(n);
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const now = () => Date.now();
  const easyOn = () => (typeof G.easy?.on === 'boolean' ? G.easy.on : G.settings?.easyMode !== false);
  const isServer = () => G.net?.mode === 'server';
  const serverAccount = () => isServer() && G.auth?.current?.kind === 'server';
  const reduceMotion = () => !!G.settings?.reduceMotion || (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);
  const toast = (msg, opts) => G.ui?.toast?.(msg, opts);

  const SDK_URL = 'https://js.tosspayments.com/v2/standard';
  const SDK_TIMEOUT = 15000;
  const STATUS_TTL = 5 * 60 * 1000;        // how long a status.php answer is trusted before a visible tab re-asks
  const MODAL_ID = 'app-subscription';
  const MOCK_ID = 'app-sub-mock';
  const GUIDE_ID = 'app-sub-guide';
  const STATUSES = new Set(['none', 'active', 'past_due', 'canceled']);
  const STATUS_KO = { none: '기본 속도', active: '이용 중', past_due: '결제 확인 중 (유예 기간)', canceled: '해지됨 · 남은 기간까지 이용' };
  const NONE = Object.freeze({ tier: 1, status: 'none', expiresAt: 0, autoRenew: false });
  // what status.php sends (names / prices are the operator's config); used only until the first answer arrives
  const TIER_FALLBACK = [{ tier: 2, name: '⚡ 2배', price: 2900 }, { tier: 3, name: '⚡⚡ 3배', price: 4900 }, { tier: 4, name: '⚡⚡⚡ 4배', price: 6900 }];
  const PERIOD_DAYS = 30;
  const MOVE_MAX = 3; // tier 4 moves 3× (§14.1 movement()); progression still 4×

  /** the server's `sub` (or anything that pretends to be one) → a clean plan; garbage → tier 1 */
  function sanitizeSub(s) {
    if (!s || typeof s !== 'object' || Array.isArray(s)) return { ...NONE };
    const tierN = Number(s.tier);
    let tier = Number.isInteger(tierN) ? tierN : 1;
    if (tier < 1 || tier > 4) tier = 1;
    const status = STATUSES.has(s.status) ? s.status : 'none';
    const expN = Number(s.expiresAt);
    const expiresAt = Number.isFinite(expN) && expN > 0 ? Math.round(expN) : 0;
    const paid = status === 'active' || status === 'past_due' || status === 'canceled';
    if (!paid) tier = 1;
    return { tier, status: tier > 1 ? status : (status === 'canceled' ? 'canceled' : 'none'), expiresAt, autoRenew: !!s.autoRenew && tier > 1 };
  }
  function won(n) { return `₩${fmt(Math.max(0, Math.round(Number(n) || 0)))}`; }
  function dateKo(ts) {
    const d = new Date(Number(ts) || 0);
    if (!ts || !Number.isFinite(d.getTime())) return '-';
    return `${d.getMonth() + 1}월 ${d.getDate()}일`;
  }
  function daysLeft(ts) { return Math.max(0, Math.ceil((Number(ts) - now()) / 86400000)); }
  /** the user-visible part of an API error (never a stack trace, never a raw code) */
  function errText(e, fallback) {
    const code = String(e?.code || '');
    if (code === 'NETWORK_ERROR') return '서버에 연결하지 못했어요. 인터넷을 확인하고 다시 해 주세요.';
    if (Number(e?.status) === 401) return '로그인이 풀렸어요. 다시 로그인한 뒤 해 주세요.';
    if (Number(e?.status) === 429) return '잠깐 너무 많이 시도했어요. 조금 뒤에 다시 해 주세요.';
    const m = String(e?.message || '').trim();
    return m && m.length <= 120 && !/[<>{}]/.test(m) ? m : fallback;
  }
  /** ?sub=ok|fail&tier=N&msg=… (api/sub/return.php): read once, clean the address and G.params */
  function readReturn() {
    const P = G.params || new URLSearchParams(location.search);
    const v = P.get('sub');
    if (v !== 'ok' && v !== 'fail') return null;
    const tierN = parseInt(P.get('tier') || '', 10);
    const r = { ok: v === 'ok', tier: Number.isInteger(tierN) ? clamp(tierN, 1, 4) : 0, msg: String(P.get('msg') || '').replace(/\s+/g, ' ').trim().slice(0, 120) };
    try {
      const u = new URL(location.href);
      for (const k of ['sub', 'tier', 'msg']) u.searchParams.delete(k);
      history.replaceState(history.state, '', u.pathname + (u.search || '') + u.hash);
    } catch (e) { /* file:// or a locked-down browser: the address stays, nothing else depends on it */ }
    for (const k of ['sub', 'tier', 'msg']) { try { P.delete(k); } catch (e) { /* ignore */ } }
    return r;
  }

  const Sub = {
    name: 'subscription', order: 91, label: '구독·속도',
    status: null,       // the last status.php answer {sub, tiers, mode, clientKey, periodDays, graceDays}
    fetchedAt: 0,
    _ret: null,         // the ?sub= return, consumed at the next login
    _sdk: null,         // Promise<TossPayments>
    _busy: false,
    _cheered: false,
    _retTimer: 0,

    init() {
      G.ui.onAction('subscription', () => this.open());
      this._ret = readReturn();
      if (this._ret && !this._ret.ok) this._failToast(this._ret.msg);
      G.bus.on('game:login', () => { this._cheered = false; this._onLogin(); });
      G.bus.on('game:logout', () => { this.status = null; this.fetchedAt = 0; this._cheered = false; this._chip(); });
      G.bus.on('state:loaded', () => this._chip());
      G.bus.on('speed:changed', (p) => { this._chip(p); this._rerender(); });
      G.bus.on('sub:changed', () => { this._chip(); this._rerender(); });
      G.bus.on('easy:changed', () => this._chip());
      document.addEventListener('visibilitychange', () => {
        if (document.hidden || !serverAccount() || !G.app?.loggedIn) return;
        if (now() - this.fetchedAt > STATUS_TTL) this.refresh({ quiet: true }).catch(() => {});
      });
      this._chip();
    },

    // ---------------------------------------------------------------- plan state
    /** the plan as the save mirrors it (G.state.sub, written by 07-speed from the server's answers) */
    current() {
      const c = sanitizeSub(G.state && G.state.sub);
      if (!isServer() && c.tier > 1) return { ...NONE }; // local mode is always tier 1 (§14.1)
      return c;
    },
    /** effective tier 1..4 (G.sys.speed is the authority once 07-speed is loaded) */
    tier() {
      const sp = G.sys.speed;
      const t = sp && Number.isInteger(Number(sp.tier)) ? Number(sp.tier) : this.current().tier;
      return clamp(t, 1, 4);
    },
    tiers() {
      const list = Array.isArray(this.status?.tiers) ? this.status.tiers : TIER_FALLBACK;
      return list.filter((t) => Number.isInteger(Number(t?.tier)) && Number(t.tier) >= 2 && Number(t.tier) <= 4)
        .map((t) => ({ tier: Number(t.tier), name: String(t.name || `${t.tier}배`).slice(0, 24), price: Math.max(0, Math.round(Number(t.price) || 0)) }))
        .sort((a, b) => a.tier - b.tier);
    },
    periodDays() { const d = Number(this.status?.periodDays); return Number.isFinite(d) && d > 0 ? d : PERIOD_DAYS; },
    mock() { return this.status ? this.status.mode === 'mock' : false; },
    /**
     * the server told us the plan (login / me / player get / status / confirm / cancel). 'sub:changed' carries the
     * clean plan both as the payload itself and under .sub; 07-speed mirrors it into G.state.sub and emits
     * 'speed:changed'. While 07-speed is absent the mirror + the chip are kept here, so nothing waits on it.
     */
    fromServer(sub, source = 'server') {
      const clean = sanitizeSub(sub);
      const prev = this.tier();
      if (this.status) this.status.sub = { ...clean };
      G.bus.emit('sub:changed', { ...clean, sub: { ...clean }, prev, source });
      if (!(G.sys.speed && typeof G.sys.speed.setFromServer === 'function')) {
        if (G.state && typeof G.state === 'object') G.state.sub = { ...clean, source: 'server' };
        const cur = this.tier();
        if (cur !== prev) G.bus.emit('speed:changed', { tier: cur, prev });
      }
      this._chip();
      this._rerender();
      return clean;
    },
    async refresh(opts = {}) {
      if (!serverAccount()) { this._chip(); return this.current(); }
      try {
        const d = await G.net.request('sub/status.php', { timeout: 9000, quiet: !!opts.quiet });
        this.status = d && typeof d === 'object' ? d : null;
        this.fetchedAt = now();
        return this.fromServer(d?.sub, 'status');
      } catch (e) {
        if (!opts.quiet) toast(errText(e, '구독 상태를 불러오지 못했어요. 잠시 후 다시 해 주세요.'), { type: 'error' });
        G.log.warn('SUB', 'status failed', e?.message || e);
        throw e;
      }
    },

    // ---------------------------------------------------------------- the screen
    /** the grown-up screen; easy mode asks the parent gate (reason 'subscription') unless opts.gate === false */
    async open(opts = {}) {
      if (!G.app?.loggedIn || !G.state) { toast('로그인한 뒤에 열 수 있어요.', { type: 'info', sound: false }); return null; }
      if (easyOn() && opts.gate !== false && typeof G.easy?.gate === 'function') {
        const ok = await G.easy.gate({ reason: 'subscription', title: '구독은 어른만', text: '구독과 결제는 어른이 해요.' });
        if (!ok || !G.app?.loggedIn) return null;
      }
      const ex = G.ui.modal.get(MODAL_ID);
      if (ex) ex.close();
      const m = G.ui.modal.open({
        id: MODAL_ID, title: '진행 속도 구독', icon: '⚡', size: 'lg', className: 'app-sub-modal', autofocus: false,
        say: '진행 속도 구독. 어른이 보는 화면이에요.',
        body: (body, mm) => { mm._kind = 'adult'; this._render(body, mm); },
        actions: [{ label: '닫기', class: 'btn-primary' }],
      });
      // fresh word from the server (prices / mode / plan), then the cards re-render themselves
      if (serverAccount()) {
        this.refresh({ quiet: true }).catch(() => {}).finally(() => { if (!m.closed) this._render(m.body, m); });
      }
      return m;
    },
    close() { G.ui.modal.get(MODAL_ID)?.close(); },
    _rerender() { const m = G.ui.modal.get(MODAL_ID); if (m && !m.closed && m.body) this._render(m.body, m); },

    _render(body, m) {
      const hadFocus = body.contains(document.activeElement) ? document.activeElement.dataset.sub || '' : '';
      body.textContent = '';
      const cur = this.current();
      const tier = this.tier();
      const server = serverAccount();
      const guest = isServer() && !server;
      const live = server && !!this.status && this.status.mode === 'live';
      const mockMode = server && this.mock();
      // ---- current plan
      const nowCard = h('section', { class: `sub-now${tier > 1 ? ' is-fast' : ''}`, 'data-say': tier > 1 ? `지금 ${tier}배 빨라요` : '지금은 기본 속도예요' });
      const bigLabel = tier > 1 ? `⚡ ${tier}배 빨라요` : '기본 속도 (1배)';
      const lines = [];
      if (tier > 1) {
        if (cur.expiresAt) lines.push(`${dateKo(cur.expiresAt)}까지 (${daysLeft(cur.expiresAt)}일 남음)`);
        lines.push(cur.autoRenew ? '자동 갱신 켜짐 · 기간이 끝나면 같은 단계로 다시 결제돼요' : (cur.status === 'canceled' ? '자동 갱신 해지됨 · 남은 기간까지 그대로 빨라요' : '한 달 이용권 · 기간이 끝나면 기본 속도로 돌아가요'));
        if (cur.status === 'past_due') lines.push('결제가 아직 확인되지 않았어요. 며칠 안에 확인되지 않으면 기본 속도로 돌아가요.');
      } else lines.push('이동·작물 자라기·발효가 기본 속도로 진행돼요. 아래에서 더 빠른 단계를 고를 수 있어요.');
      nowCard.append(
        h('span', { class: 'sub-now-emo emoji', 'aria-hidden': 'true' }, tier > 1 ? '⚡' : '🚶'),
        h('div', { class: 'sub-now-main' },
          h('div', { class: 'sub-now-row' }, h('b', { class: 'sub-now-tier' }, bigLabel), h('span', { class: `chip sub-status sub-status-${cur.status}` }, STATUS_KO[cur.status] || STATUS_KO.none),
            mockMode ? h('span', { class: 'chip chip-gold sub-mock-chip', title: '서버가 모의 결제 모드예요 (TFM_TOSS_MOCK=1): 실제 결제가 일어나지 않아요' }, '🧪 테스트 결제') : null),
          ...lines.map((t) => h('p', { class: 'sub-now-line' }, t))),
      );
      G.easy?.speakable?.(nowCard);
      body.appendChild(nowCard);
      // ---- what the player can do here
      if (!isServer()) {
        body.appendChild(h('div', { class: 'sub-note', role: 'note' },
          h('span', { class: 'emoji', 'aria-hidden': 'true' }, '🖥️'),
          h('div', null, h('b', null, '서버에 설치하면 구독할 수 있어요'), h('p', null, '이 파일 하나로 여는 로컬 모드에서는 결제·구독이 없어요. 체험관을 서버(XAMPP·Apache·PHP)에 올리면 토스페이먼츠 결제로 2·3·4배 단계를 구독할 수 있어요.'),
            h('button', { type: 'button', class: 'btn btn-soft btn-sm', 'data-sub': 'guide' }, '📘 설치 안내 보기'))));
      } else if (guest) {
        body.appendChild(h('div', { class: 'sub-note', role: 'note' }, h('span', { class: 'emoji', 'aria-hidden': 'true' }, '🙋'),
          h('div', null, h('b', null, '계정으로 로그인하면 구독할 수 있어요'), h('p', null, '게스트 기록은 이 브라우저에만 있어요. 어른이 계정을 만들고 로그인한 뒤 구독해 주세요.'))));
      } else if (!this.status) {
        body.appendChild(h('p', { class: 'sub-loading dim small' }, '서버에서 구독 정보를 가져오는 중…'));
      }
      // ---- tier cards
      const canBuy = server && !!this.status && !this._busy;
      const grid = h('div', { class: `sub-tiers${canBuy ? '' : ' is-off'}`, role: 'list' });
      for (const t of this.tiers()) {
        const isCur = tier === t.tier && tier > 1;
        const move = Math.min(t.tier, MOVE_MAX);
        const card = h('article', { class: `sub-tier${isCur ? ' is-current' : ''}`, role: 'listitem', 'data-tier': String(t.tier) });
        card.append(
          h('div', { class: 'st-head' }, h('b', { class: 'st-name' }, t.name), isCur ? h('span', { class: 'chip chip-gold st-cur' }, '이용 중') : null),
          h('div', { class: 'st-price' }, won(t.price), h('small', null, `/${this.periodDays()}일`)),
          h('ul', { class: 'st-perks' },
            h('li', null, h('span', { class: 'emoji', 'aria-hidden': 'true' }, '🚶'), `이동 ${move}배${t.tier > MOVE_MAX ? ' (최대)' : ''}`),
            h('li', null, h('span', { class: 'emoji', 'aria-hidden': 'true' }, '🌱'), `작물 자라기 ${t.tier}배`),
            h('li', null, h('span', { class: 'emoji', 'aria-hidden': 'true' }, '🏺'), `발효 ${t.tier}배`)),
          h('div', { class: 'st-btns' },
            h('button', { type: 'button', class: 'btn btn-gold btn-block', 'data-sub': 'buy', 'data-tier': String(t.tier), 'data-kind': 'billing', disabled: canBuy ? null : true }, '자동 갱신 구독 (토스)'),
            h('button', { type: 'button', class: 'btn btn-soft btn-block', 'data-sub': 'buy', 'data-tier': String(t.tier), 'data-kind': 'card', disabled: canBuy ? null : true }, '한 달 이용권 (1회 결제)')),
        );
        grid.appendChild(card);
      }
      body.appendChild(grid);
      if (server && cur.autoRenew) {
        body.appendChild(h('div', { class: 'sub-cancel-row' },
          h('button', { type: 'button', class: 'btn btn-ghost', 'data-sub': 'cancel', disabled: this._busy ? true : null }, '해지하기 (자동 갱신 끄기)'),
          h('span', { class: 'small dim' }, '해지해도 남은 기간까지는 그대로 빨라요.')));
      }
      // ---- legal
      body.appendChild(h('footer', { class: 'sub-legal' },
        h('p', null, h('b', null, '상품 '), `진행 속도 2·3·4배 이용권 (${this.periodDays()}일). 이동·작물 자라기·발효가 빨라져요. 아이 보호 기능(쉬는 시간, 보호자 확인, 채팅 제한)은 빨라지지 않아요.`),
        h('p', null, h('b', null, '요금·결제 '), `표시된 금액은 ${this.periodDays()}일 기준이에요(부가세 포함). 결제대행: 토스페이먼츠. 카드 정보는 토스페이먼츠에만 전달되고 체험관 서버에는 저장되지 않아요.`),
        h('p', null, h('b', null, '자동 갱신·환불 '), '자동 갱신은 이 화면에서 언제든 해지할 수 있어요(남은 기간 이용). 환불·결제 문의는 체험관을 설치한 운영자에게 해 주세요.'),
        live ? h('p', { class: 'dim' }, '실제 결제 모드예요.') : null));
      if (!body._subBound) {
        body._subBound = true;
        body.addEventListener('click', (e) => {
          const b = e.target.closest('[data-sub]');
          if (!b || b.disabled) return;
          const act = b.dataset.sub;
          if (act === 'buy') this.buy(Number(b.dataset.tier), b.dataset.kind === 'billing' ? 'billing' : 'card');
          else if (act === 'cancel') this.cancel();
          else if (act === 'guide') this.openGuide();
        });
      }
      if (hadFocus && !G.input?.touchUI) body.querySelector(`[data-sub="${hadFocus}"]:not([disabled])`)?.focus({ preventScroll: true });
      if (m) m._tier = tier;
    },

    // ---------------------------------------------------------------- buying
    /** prepare → 토스 SDK (live) or the 테스트 결제 dialog (mock). Returns true when a payment flow started / succeeded. */
    async buy(tier, kind = 'card') {
      tier = Number(tier);
      if (!Number.isInteger(tier) || tier < 2 || tier > 4) return false;
      if (kind !== 'billing') kind = 'card';
      if (this._busy) return false;
      if (!serverAccount()) { toast(isServer() ? '계정으로 로그인한 뒤에 구독할 수 있어요.' : '서버에 설치하면 구독할 수 있어요.', { type: 'info' }); return false; }
      if (easyOn() && typeof G.easy?.gateStatus === 'function' && G.settings?.parentGate !== false && !G.easy.gateStatus('subscription')?.unlocked) {
        // the grown-up session ended while the screen was up (it closes with it, but a tap may race the close)
        toast('어른 확인이 끝났어요. 다시 열어 주세요.', { type: 'info' }); return false;
      }
      this._busy = true; this._rerender();
      try {
        const p = await G.net.request('sub/prepare.php', { body: { tier, kind }, timeout: 15000 });
        if (!p || typeof p !== 'object' || !p.orderId) throw new Error('주문을 만들지 못했어요.');
        G.log.info('SUB', `prepare ${kind} tier ${tier} order ${String(p.orderId).slice(0, 8)}… ${p.mock ? '(mock)' : ''}`);
        if (p.mock) { this._busy = false; this._rerender(); return await this._mockPay(p); }
        const toss = await this._loadSdk();
        const payment = toss(String(p.clientKey || this.status?.clientKey || '')).payment({ customerKey: String(p.customerKey) });
        const customerName = String(G.state?.profile?.nickname || G.auth?.current?.nickname || '체험객').slice(0, 40);
        if (kind === 'billing') {
          await payment.requestBillingAuth({ method: 'CARD', successUrl: p.successUrl, failUrl: p.failUrl, customerName });
        } else {
          await payment.requestPayment({
            method: 'CARD', amount: { currency: 'KRW', value: Number(p.amount) }, orderId: p.orderId, orderName: String(p.orderName || ''),
            successUrl: p.successUrl, failUrl: p.failUrl, customerName,
          });
        }
        return true; // the payment window takes over; return.php brings the browser back with ?sub=ok|fail
      } catch (e) {
        const code = String(e?.code || '');
        if (/CANCEL/i.test(code)) toast('결제를 취소했어요.', { type: 'info', sound: false });
        else { toast(errText(e, '결제를 시작하지 못했어요. 잠시 후 다시 해 주세요.'), { type: 'error', duration: 6000 }); G.log.warn('SUB', 'buy failed', code || e?.message || e); }
        return false;
      } finally { this._busy = false; this._rerender(); }
    },
    /** the 토스 SDK, loaded once, only in server mode (CSP: script-src https://js.tosspayments.com) */
    _loadSdk() {
      if (typeof window.TossPayments === 'function') return Promise.resolve(window.TossPayments);
      if (!isServer()) return Promise.reject(new Error('로컬 모드에서는 결제 모듈을 불러오지 않아요.'));
      if (!this._sdk) {
        this._sdk = new Promise((resolve, reject) => {
          const s = document.createElement('script');
          s.src = SDK_URL; s.async = true; s.referrerPolicy = 'no-referrer';
          const timer = setTimeout(() => { this._sdk = null; s.remove(); reject(new Error('결제 모듈이 늦게 답해요. 잠시 후 다시 해 주세요.')); }, SDK_TIMEOUT);
          s.onload = () => { clearTimeout(timer); if (typeof window.TossPayments === 'function') resolve(window.TossPayments); else { this._sdk = null; reject(new Error('결제 모듈을 불러오지 못했어요.')); } };
          s.onerror = () => { clearTimeout(timer); this._sdk = null; s.remove(); reject(new Error('결제 모듈을 불러오지 못했어요. 인터넷 연결을 확인해 주세요.')); };
          document.head.appendChild(s);
        });
      }
      return this._sdk;
    },
    /** mock mode (server TFM_TOSS_MOCK=1): a dialog that stands in for the payment window; no SDK, no network but ours */
    _mockPay(p) {
      return new Promise((resolve) => {
        let done = false;
        const fin = (v) => { if (!done) { done = true; resolve(v); } };
        const body = h('div', { class: 'sub-mock' },
          h('p', { class: 'sub-mock-badge' }, h('span', { class: 'emoji', 'aria-hidden': 'true' }, '🧪'), ' 테스트 결제 모드 — 실제 결제가 아니에요'),
          h('dl', { class: 'sub-mock-kv' },
            h('dt', null, '상품'), h('dd', null, String(p.orderName || `진행 속도 ${p.tier}배`)),
            h('dt', null, '금액'), h('dd', null, won(p.amount)),
            h('dt', null, '방식'), h('dd', null, p.kind === 'billing' ? '자동 갱신 (빌링키 발급)' : '1회 결제'),
            h('dt', null, '주문'), h('dd', { class: 'sub-mono' }, `${String(p.orderId).slice(0, 12)}…`)),
          h('p', { class: 'small dim' }, '결제 서버에 연결하지 않고 서버가 바로 승인해요. (TFM_TOSS_MOCK=1)'));
        G.ui.modal.open({
          id: MOCK_ID, title: '테스트 결제', icon: '🧪', size: 'sm', className: 'app-sub-modal', say: '테스트 결제. 어른이 보는 화면이에요.', body,
          actions: [
            { label: '취소', class: 'btn-ghost', onClick: () => { fin(false); } },
            {
              label: '결제하기 (테스트)', class: 'btn-gold', onClick: async (m, b) => {
                b.disabled = true;
                try { await this._confirmMock(p); fin(true); return true; }
                catch (e) { toast(errText(e, '테스트 결제가 승인되지 않았어요.'), { type: 'error' }); b.disabled = false; return false; }
              },
            },
          ],
          onClose: () => fin(false),
        });
      });
    },
    async _confirmMock(p) {
      let d;
      if (p.kind === 'billing') d = await G.net.request('sub/billing-issue.php', { body: { authKey: `mock_auth_${p.orderId}`, customerKey: p.customerKey, orderId: p.orderId }, timeout: 15000 });
      else d = await G.net.request('sub/confirm.php', { body: { paymentKey: `mock_${p.orderId}`, orderId: p.orderId, amount: Number(p.amount) }, timeout: 15000 });
      const sub = this.fromServer(d?.sub, 'confirm');
      this.fetchedAt = now();
      G.log.info('SUB', `mock payment confirmed → tier ${sub.tier}`);
      this._celebrate(sub.tier);
      return sub;
    },
    async cancel() {
      if (this._busy || !serverAccount()) return false;
      const ok = await G.ui.confirm('자동 갱신을 해지할까요? 지금 기간이 끝날 때까지는 그대로 빨라요.', { title: '자동 갱신 해지', icon: 'help', okText: '해지하기', cancelText: '유지하기', danger: true, easy: false });
      if (!ok) return false;
      this._busy = true; this._rerender();
      try {
        const d = await G.net.request('sub/cancel.php', { body: {}, timeout: 12000 });
        this.fromServer(d?.sub, 'cancel');
        toast('자동 갱신을 해지했어요. 남은 기간까지 그대로 빨라요.', { type: 'success', emoji: '✅' });
        return true;
      } catch (e) {
        toast(errText(e, '해지하지 못했어요. 잠시 후 다시 해 주세요.'), { type: 'error' });
        return false;
      } finally { this._busy = false; this._rerender(); }
    },

    // ---------------------------------------------------------------- return from the payment window
    _onLogin() {
      const ret = this._ret;
      this._ret = null;
      if (!serverAccount()) { this._chip(); return; }
      if (!ret) return;
      // the plan the login answered with is already applied (70-app → fromServer); a return needs the fresh word
      const go = async () => {
        if (!ret.ok) return;
        let sub = null;
        try { sub = await this.refresh({ quiet: true }); }
        catch (e) { toast('결제는 끝났어요. 잠시 후 구독 화면에서 상태를 확인해 주세요.', { type: 'warn', duration: 7000 }); return; }
        const t = sub && sub.tier > 1 ? sub.tier : (ret.tier > 1 ? ret.tier : this.tier());
        if (t > 1) this._celebrate(t);
        else toast('결제가 끝났어요. 구독 상태를 확인하고 있어요.', { type: 'info', duration: 6000 });
      };
      // after the login choreography (welcome toast / intro) — never over the 만장대 intro
      const wait = () => {
        if (!G.app?.loggedIn) return;
        if (document.body.classList.contains('md-intro')) { setTimeout(wait, 700); return; }
        go().catch((e) => G.log.warn('SUB', 'return handling failed', e?.message || e));
      };
      setTimeout(wait, 1400);
    },
    _failToast(msg) {
      clearTimeout(this._retTimer);
      const show = () => {
        const ls = $('#loading-screen');
        if (ls && !ls.hidden) { this._retTimer = setTimeout(show, 800); return; }
        toast(`결제가 끝나지 않았어요. ${msg || '결제창이 닫혔거나 승인되지 않았어요.'} 구독 화면에서 다시 할 수 있어요.`, { type: 'error', duration: 8000, easy: '결제가 안 됐어요. 어른에게 알려 줘요!' });
      };
      this._retTimer = setTimeout(show, 1200);
    },
    _celebrate(tier) {
      const n = clamp(Number(tier) || 1, 1, 4);
      toast(`⚡ ${n}배 빠르게 시작!`, { type: 'success', emoji: '⚡', duration: 4500, sound: false, say: easyOn() ? `${n}배 빨라졌어요!` : undefined });
      if (easyOn() && typeof G.easy?.celebrate === 'function') {
        Promise.resolve(G.easy.celebrate(`${n}배 빨라요!`, { emoji: '⚡', say: '와, 더 빨라졌어요!', duration: 2400, sound: 'quest' })).catch(() => {});
      } else {
        G.sfx('reward');
        if (!reduceMotion()) { try { G.fx?.burst?.(G.sys.player?.position, { type: 'confetti', count: 36 }); } catch (e) { /* fx optional */ } }
      }
    },

    // ---------------------------------------------------------------- HUD chip
    _chip(p) {
      const el = $('#hud-speed');
      if (!el) return;
      const t = G.app?.loggedIn ? this.tier() : 1;
      const label = t > 1 ? (easyOn() ? `⚡ ${t}배 빨라요` : `⚡${t}×`) : '';
      if (el.textContent !== label) el.textContent = label;
      el.hidden = !label;
      el.dataset.tier = String(t);
      if (label) el.setAttribute('aria-label', `진행 속도 ${t}배`); else el.removeAttribute('aria-label');
      if (p && Number(p.tier) !== Number(p.prev) && t > 1) {
        if (!reduceMotion()) G.ui.pulse?.(el, { duration: 420 });
        if (!this._cheered && G.app?.loggedIn && G.ready) {
          this._cheered = true;
          try { G.mascot?.say?.('와, 더 빨라졌어요!', { mood: 'cheer', source: 'speed' }); } catch (e) { /* mascot optional */ }
        }
      }
    },

    // ---------------------------------------------------------------- install guide (local mode)
    openGuide() {
      let docs = null;
      try { docs = JSON.parse(document.getElementById('build-docs')?.textContent || 'null'); } catch (e) { docs = null; }
      const name = docs && typeof docs === 'object' ? ['SERVER-INSTALL-KO.md', 'README-SERVER.md'].find((k) => typeof docs[k] === 'string') : null;
      const body = h('div', { class: 'sub-guide md' });
      if (!name) body.appendChild(h('p', null, '설치 안내 문서가 이 빌드에 들어 있지 않아요. 배포 zip 의 docs/SERVER-INSTALL-KO.md 를 열어 주세요.'));
      else {
        let html = null;
        try { html = G.sys.devcenter?.renderMarkdown?.(docs[name]); } catch (e) { html = null; }
        if (typeof html === 'string') body.innerHTML = html; // the dev center's renderer escapes first (CSP-safe, no scripts)
        else body.appendChild(h('pre', { class: 'sub-guide-pre' }, String(docs[name]).slice(0, 60000)));
      }
      return G.ui.modal.open({ id: GUIDE_ID, title: '서버 설치 안내', icon: '📘', size: 'lg', className: 'app-sub-modal sub-guide-modal', say: '서버 설치 안내. 어른이 읽는 글이에요.', body, actions: [{ label: '닫기', class: 'btn-primary' }] });
    },

    /** dev-center panel */
    info() {
      const cur = this.current();
      return {
        mode: isServer() ? (this.status ? this.status.mode : 'server') : 'local', account: G.auth?.current?.kind || null,
        tier: this.tier(), plan: cur, speed: !!G.sys.speed, movement: G.sys.speed?.movement?.() ?? Math.min(this.tier(), MOVE_MAX), progression: G.sys.speed?.progression?.() ?? this.tier(),
        tiers: this.tiers(), fetchedAt: this.fetchedAt, sdk: typeof window.TossPayments === 'function', busy: this._busy, chip: !$('#hud-speed')?.hidden,
      };
    },
    sanitize: sanitizeSub,
    onLogout() { this.close(); G.ui.modal.get(MOCK_ID)?.close(); G.ui.modal.get(GUIDE_ID)?.close(); },
  };
  G.register(Sub);
})();
