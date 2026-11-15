// =============================================================================
// 71-entitle.js — G.sys.entitle + G.site (CONTRACT §17.2, client side)
//
//   The ONE answer to "what may this account do" is computed on the server (Tfm\Entitle) and arrives as `ent` with
//   auth/me · auth/login · auth/register · auth/password · player/get · player/save · sub/status · sub/confirm ·
//   sub/cancel · sub/billing-issue. Nothing here can raise it: this module only mirrors the server's word, and the
//   server judges every save with its own copy.
//
//   G.sys.entitle
//     get()            the effective entitlement, always complete:
//                      { v, role, admin, tier 1..4, paid, until, speed:{move 1..3, grow 1..4}, limits:{jars, roomItems},
//                        features:{myroom}, adminUrl, pwDefault }
//                      · local mode, guests, logged out            → the free values
//                      · a server account                          → the server's `ent` (an older server that sends
//                                                                    none: derived from the plan in G.state.sub)
//     isAdmin()        ent.admin (the server says so from the account's role — never from this page)
//     tier()           1..4          limit(key) 'jars' | 'roomItems'          has(feature) 'myroom'
//     speed()          {move, grow}  — 07-speed.js reads its multipliers here
//     refresh()        server mode: asks auth/me.php again (ent + site); → Promise<ent>
//     openAdmin()      administrators only: the admin site (ent.adminUrl, a folder next to this page) in a new tab.
//                      Easy mode: only from 어른 메뉴 (behind the parent gate); otherwise the gate is asked first.
//     changePassword(current, next, again) → {field, msg}   server accounts: POST auth/password.php (every other
//                      session of the account ends; the default-administrator flag is cleared)
//     preview(partial | null)   ?debug=1 or an open developer centre only, never in 쉬운 모드, never saved
//     events           entitle:changed { ent, prev }
//   HUD: #hud-admin "🛠️ 관리자" (normal mode, administrators only — hidden for everybody else and in 쉬운 모드).
//   An administrator who still uses the default password is reminded once per browser session after login.
//
//   G.site             the public operator settings (the `site` object of ping.php / auth/me.php / auth/login.php):
//     get(key, fallback)   e.g. G.site.get('limits.jars_free', 3) — the fallback while the server said nothing
//     all() · stamp()      events: site:changed { keys, site }
//     A save answers with `siteV`; when it differs from the copy here the page asks auth/me.php once more.
//
// Answers are read by a tap on G.net.request that stays in place when a test swaps the function (the swap replaces
// what the tap calls). Server data is shown with textContent only; the admin address must be a plain folder name.
// =============================================================================
(function () {
  const h = (...a) => G.ui.h(...a);
  const toast = (msg, opts) => G.ui?.toast?.(msg, opts);
  const serverMode = () => G.net?.mode === 'server';
  const easyOn = () => (typeof G.easy?.on === 'boolean' ? G.easy.on : G.settings?.easyMode !== false);
  const int = (v, lo, hi, d) => { const n = Math.floor(Number(v)); return Number.isFinite(n) && n >= lo && n <= hi ? n : d; };
  const clone = (v) => (v && typeof v === 'object' ? JSON.parse(JSON.stringify(v)) : v);
  /** a copy the caller may keep or change (the module's own object never leaves it) */
  const copyEnt = (e) => ({ ...e, speed: { ...e.speed }, limits: { ...e.limits }, features: { ...e.features } });
  const FOLDER_RE = /^[A-Za-z0-9_~-][A-Za-z0-9._~-]{0,63}\/$/; // the same rule as 70-app's adminLink()
  const folder = (v) => { const s = typeof v === 'string' ? v.trim() : ''; return FOLDER_RE.test(s) ? s : ''; };
  const REMIND_KEY = 'tfm.entitle.pwdef';

  // ------------------------------------------------------------------ G.site
  const KEY_RE = /^[a-z][a-z0-9_]*(\.[a-z0-9_]+){1,3}$/;
  const SITE_MAX = 200;
  /** one public value as the page may hold it: bool · finite number · short text · a short list of those */
  function cleanValue(v) {
    if (typeof v === 'boolean') return v;
    if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
    if (typeof v === 'string') return v.length <= 400 ? v : v.slice(0, 400);
    if (Array.isArray(v)) {
      const out = [];
      for (const x of v.slice(0, 40)) { const c = Array.isArray(x) ? undefined : cleanValue(x); if (c !== undefined && typeof c !== 'object') out.push(c); }
      return out;
    }
    return undefined;
  }
  const Site = {
    _v: Object.create(null),
    _stamp: '',
    _asked: 0,
    _timer: 0,
    /** a public operator setting, or `fallback` while the server has not said it (local mode: always the fallback) */
    get(key, fallback) {
      const v = Object.prototype.hasOwnProperty.call(this._v, key) ? this._v[key] : undefined;
      return v === undefined || v === null ? fallback : clone(v);
    },
    all() { return clone({ ...this._v }); },
    stamp() { return this._stamp; },
    /** the server's `site` (and its stamp): returns the keys whose value changed */
    apply(obj, stamp) {
      const next = Object.create(null);
      if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
        let n = 0;
        for (const k of Object.keys(obj)) {
          if (n >= SITE_MAX) break;
          if (!KEY_RE.test(k)) continue;
          const c = cleanValue(obj[k]);
          if (c === undefined) continue;
          next[k] = c; n++;
        }
      }
      const keys = [];
      for (const k of new Set([...Object.keys(this._v), ...Object.keys(next)])) if (JSON.stringify(this._v[k]) !== JSON.stringify(next[k])) keys.push(k);
      this._v = next;
      if (typeof stamp === 'string' && /^[0-9a-f]{6,40}$/.test(stamp)) this._stamp = stamp;
      if (keys.length) {
        G.log.info('SITE', `operator settings: ${keys.length} value(s) changed`);
        G.bus.emit('site:changed', { keys, site: this.all() });
      }
      return keys;
    },
    /** a save said the settings changed: ask once more (not more often than every 20 s) */
    _stale(stamp) {
      if (!serverMode() || typeof stamp !== 'string' || !stamp || stamp === this._stamp || this._timer) return;
      const wait = Math.max(300, 20000 - (Date.now() - this._asked));
      this._timer = setTimeout(() => {
        this._timer = 0;
        this._asked = Date.now();
        Promise.resolve(G.net.request('auth/me.php', { quiet: true, timeout: 7000 })).catch(() => {});
      }, wait);
    },
  };
  G.site = Site;

  // ------------------------------------------------------------------ the entitlement
  const FREE_JARS = 3, PAID_JARS = 12, FREE_ROOM = 80, PAID_ROOM = 160;
  /** what everybody has without a plan (local mode, guests, logged out) */
  function freeEnt() {
    return {
      v: 1, role: 'user', admin: false, tier: 1, paid: false, until: 0, speed: { move: 1, grow: 1 },
      limits: { jars: int(Site.get('limits.jars_free', FREE_JARS), 1, 12, FREE_JARS), roomItems: int(Site.get('limits.room_items_free', FREE_ROOM), 0, 300, FREE_ROOM) },
      features: { myroom: false }, adminUrl: '', pwDefault: false,
    };
  }
  /** the server's `ent` → a clean copy (null: not an entitlement this page understands) */
  function cleanEnt(e) {
    if (!e || typeof e !== 'object' || Array.isArray(e) || Number(e.v) !== 1) return null;
    const tier = int(e.tier, 1, 4, 1);
    const admin = e.admin === true && e.role === 'admin';
    const sp = e.speed && typeof e.speed === 'object' ? e.speed : {};
    const lim = e.limits && typeof e.limits === 'object' ? e.limits : {};
    const ft = e.features && typeof e.features === 'object' ? e.features : {};
    const until = Number(e.until);
    return {
      v: 1, role: admin ? 'admin' : 'user', admin, tier, paid: e.paid === true, until: Number.isFinite(until) && until > 0 ? Math.round(until) : 0,
      speed: { move: int(sp.move, 1, 3, Math.min(tier, 3)), grow: int(sp.grow, 1, 4, tier) },
      limits: { jars: int(lim.jars, 1, 12, FREE_JARS), roomItems: int(lim.roomItems, 0, 300, FREE_ROOM) },
      features: { myroom: ft.myroom === true },
      adminUrl: admin ? folder(e.adminUrl) : '', pwDefault: admin && e.pwDefault === true,
    };
  }
  /** an older server that sends no `ent`: what the plan alone gives */
  function fromSub(sub) {
    const f = freeEnt();
    const s = G.save?.sanitizeSub ? G.save.sanitizeSub(sub, 'server') : null;
    const tier = int(s && s.tier, 1, 4, 1);
    if (tier <= 1) return f;
    return {
      ...f, tier, paid: true, until: Number(s.expiresAt) > 0 ? Math.round(Number(s.expiresAt)) : 0, speed: { move: Math.min(tier, 3), grow: tier },
      limits: { jars: int(Site.get('limits.jars_paid', PAID_JARS), 1, 12, PAID_JARS), roomItems: int(Site.get('limits.room_items_paid', PAID_ROOM), 0, 300, PAID_ROOM) },
    };
  }

  const E = {
    name: 'entitle', order: 11, label: '이용 권한',
    _ent: null,       // the server's last word for the logged-in server account
    _awaitAuth: true, // after a logout only an answer that belongs to a (new) session counts: auth/* or player/get
    _preview: null,   // debug preview (never saved)
    _last: null,      // the entitlement announced last
    _sig: '',
    _chipEl: null,
    _reminded: false,

    _serverSession() { return serverMode() && G.auth?.current?.kind === 'server'; },
    get() {
      if (this._preview) return copyEnt(this._preview);
      if (!this._serverSession()) return freeEnt();
      return this._ent ? copyEnt(this._ent) : fromSub(G.state && G.state.sub);
    },
    isAdmin() { return this.get().admin === true; },
    tier() { return this.get().tier; },
    speed() { const s = this.get().speed; return { move: s.move, grow: s.grow }; },
    limit(key) { const v = this.get().limits[key]; return Number.isFinite(v) ? v : undefined; },
    has(feature) { return this.get().features[String(feature)] === true; },
    adminUrl() { return this.get().adminUrl || ''; },

    /** server mode: the fresh word (auth/me.php carries ent and site; the tap below applies both) */
    async refresh() {
      if (serverMode()) {
        try { await G.net.request('auth/me.php', { quiet: true, timeout: 7000 }); }
        catch (e) { G.log.warn('ENTITLE', 'refresh failed', e?.message || e); }
      }
      this._sync('refresh');
      return this.get();
    },
    /** an answer of the server carried `ent` (path: which endpoint said it) */
    _take(raw, path) {
      const clean = cleanEnt(raw);
      if (!clean) return;
      // a save that was still on its way when the player logged out must not speak for the next account
      if (this._awaitAuth && path !== undefined && !/^(auth\/|player\/get\.php$)/.test(String(path))) return;
      this._awaitAuth = false;
      this._ent = clean;
      this._sync('server');
    },
    /** announce the effective entitlement when it changed */
    _sync(reason) {
      const cur = this.get();
      const sig = JSON.stringify(cur);
      if (sig === this._sig) { this._chip(); return false; }
      const prev = this._last;
      this._sig = sig;
      this._last = cur;
      if (prev) G.log.info('ENTITLE', `${reason || 'change'}: tier ${prev.tier} -> ${cur.tier}, jars ${prev.limits.jars} -> ${cur.limits.jars}${cur.admin ? ' (administrator)' : ''}`);
      G.bus.emit('entitle:changed', { ent: copyEnt(cur), prev: prev ? copyEnt(prev) : null });
      this._chip();
      return true;
    },
    /** developer preview: only with ?debug=1 or an open developer centre, never in 쉬운 모드; nothing is saved */
    preview(partial) {
      if (!partial) { this._preview = null; this._sync('preview off'); return this.get(); }
      if (easyOn()) { G.log.warn('ENTITLE', 'preview refused: 쉬운 모드'); return this.get(); }
      if (!G.flags?.debug && !G.sys.devcenter?.isOpen?.()) { G.log.warn('ENTITLE', 'preview refused: open the developer centre first'); return this.get(); }
      const base = this._preview || this.get();
      const p = typeof partial === 'object' ? partial : {};
      const merged = cleanEnt({
        ...base, ...p, v: 1, role: (p.admin ?? base.admin) ? 'admin' : 'user',
        speed: { ...base.speed, ...(p.speed || {}) }, limits: { ...base.limits, ...(p.limits || {}) }, features: { ...base.features, ...(p.features || {}) },
      });
      if (merged) { merged.adminUrl = ''; merged.pwDefault = false; this._preview = merged; G.log.info('ENTITLE', '[entitle] preview', merged); }
      this._sync('preview');
      return this.get();
    },

    // ---------------------------------------------------------------- the administrator's way in
    /** opens the admin site in a new tab (administrators only). Returns true when a tab was asked for. */
    openAdmin() {
      const e = this.get();
      if (!e.admin || !G.app?.loggedIn) return false;
      // 쉬운 모드: the way in is 어른 메뉴 (behind the parent gate) — never straight from a kid screen
      if (easyOn() && G.settings?.parentGate !== false && typeof G.easy?.gateStatus === 'function' && !G.easy.gateStatus('parents')?.unlocked) {
        try { G.app?.openAdultMenu?.(); } catch (x) { /* the menu is the fallback only */ }
        return false;
      }
      const go = (u) => {
        const rel = folder(u);
        if (!rel) { toast('관리자 페이지 주소를 찾지 못했어요. 서버의 관리자 폴더 주소로 직접 들어가 주세요.', { type: 'warn' }); return false; }
        let href = '';
        try { href = new URL(rel, document.baseURI).href; } catch (x) { href = rel; }
        const w = window.open(href, '_blank', 'noopener,noreferrer');
        if (w) { try { w.opener = null; } catch (x) { /* already detached */ } }
        G.log.info('ENTITLE', 'admin site opened in a new tab');
        return true;
      };
      if (e.adminUrl) return go(e.adminUrl);
      Promise.resolve(G.auth?.adminUrl?.()).then((u) => go(u)).catch(() => go(''));
      return true;
    },
    /** what the menu tile says under 🛠️ 관리자 페이지 */
    adminTileDesc() {
      return this.get().pwDefault ? '⚠️ 기본 비밀번호를 쓰고 있어요 — 먼저 바꿔 주세요' : '설정·회원·결제·분양·강의 관리 (새 창)';
    },
    /** the caption of the ⚡ 진행 속도 구독 tile / settings row ('' = the app's own sentence) */
    tileDesc() {
      const e = this.get();
      if (e.admin) return `관리자는 모든 기능을 무료로 써요 · 지금 ${e.speed.grow}배`;
      if (e.tier > 1) return '';
      if (!serverMode()) return '';
      const on = Site.get('sub.tiers_on', null);
      const list = Array.isArray(on) ? on.filter((t) => Number.isInteger(t) && t >= 2 && t <= 4) : [2, 3];
      if (!list.length) return '지금은 구독을 받지 않아요';
      return `이동·작물·발효 ${list.join('·')}배 · 장독 ${int(Site.get('limits.jars_paid', PAID_JARS), 1, 12, PAID_JARS)}개 (토스 결제)`;
    },
    /** #hud-admin: administrators in normal mode only */
    _chip() {
      const row = document.querySelector('#hud-player .hud-currency');
      if (!row) return;
      let el = this._chipEl;
      if (!el || !el.isConnected) {
        el = h('button', { type: 'button', id: 'hud-admin', class: 'admin-chip', hidden: true, title: '관리자 페이지 열기 (새 창)', 'aria-label': '관리자 페이지 열기' },
          h('span', { class: 'emoji', 'aria-hidden': 'true' }, '🛠️'), h('span', { class: 'ac-lbl' }, '관리자'), h('span', { class: 'ac-warn', hidden: true, title: '기본 비밀번호를 쓰고 있어요' }, '⚠️'));
        el.addEventListener('click', () => this.openAdmin());
        row.insertBefore(el, row.querySelector('#hud-mode')); // just before the 로컬 / 서버 chip (null: at the end)
        this._chipEl = el;
      }
      const e = this.get();
      const show = !!G.app?.loggedIn && e.admin && !easyOn();
      el.hidden = !show;
      const warn = el.querySelector('.ac-warn');
      if (warn) warn.hidden = !(show && e.pwDefault);
      el.classList.toggle('is-warn', show && e.pwDefault);
    },
    /** once per browser session: the administrator still uses the default password */
    _remind() {
      if (this._reminded || !G.app?.loggedIn || !this.get().pwDefault) return;
      if (document.body.classList.contains('md-intro') || !G.ready) { setTimeout(() => this._remind(), 900); return; }
      this._reminded = true;
      try { if (sessionStorage.getItem(REMIND_KEY) === '1') return; sessionStorage.setItem(REMIND_KEY, '1'); } catch (x) { /* private mode: remind in this page only */ }
      if (easyOn()) {
        // a kid screen: one calm sentence, no typing, no way out of the app — the grown-up changes it from 어른 메뉴
        toast('관리자 비밀번호를 바꿔 주세요. 어른 메뉴 → 설정 → 계정', { type: 'warn', emoji: '🔐', duration: 9000, sound: false });
        return;
      }
      G.ui.modal.open({
        id: 'entitle-pwdefault', title: '관리자 비밀번호를 바꿔 주세요', icon: '🔐', size: 'sm', className: 'entitle-modal', say: false,
        body: (body) => {
          body.append(
            h('p', null, '이 관리자 계정은 설치할 때 정해진 ', h('b', null, '기본 비밀번호'), '를 아직 쓰고 있어요. 누구나 아는 비밀번호라서 그대로 두면 위험해요.'),
            h('p', { class: 'small dim' }, '설정 → 계정 → 비밀번호 바꾸기에서 지금 바꿀 수 있어요. 바꾸면 다른 기기의 로그인은 모두 풀려요.'));
        },
        actions: [
          { label: '나중에', class: 'btn-ghost' },
          { label: '지금 바꾸기', class: 'btn-primary', onClick: () => { setTimeout(() => { try { G.app?.openSettings?.('account'); } catch (x) { /* settings optional */ } }, 60); } },
        ],
      });
    },

    // ---------------------------------------------------------------- password of a server account
    /** → { field: 'current' | 'next' | 'again' | null, msg: '' when it worked } (the shape the account form expects) */
    async changePassword(current, next, again) {
      if (!this._serverSession()) return { field: null, msg: '서버 계정으로 로그인한 뒤에 바꿀 수 있어요.' };
      current = String(current ?? ''); next = String(next ?? ''); again = String(again ?? '');
      if (!current) return { field: 'current', msg: '지금 비밀번호를 입력해 주세요.' };
      if (next.length < 8) return { field: 'next', msg: '새 비밀번호는 영문과 숫자를 넣어 8자 이상으로 해 주세요.' };
      if (next !== again) return { field: 'again', msg: '새 비밀번호 두 칸이 서로 달라요.' };
      if (current === next) return { field: 'next', msg: '지금과 다른 비밀번호를 입력해 주세요.' };
      try {
        await G.net.request('auth/password.php', { body: { current, password: next, password_confirm: again }, timeout: 15000 });
        G.log.info('AUTH', 'password changed (server account) — the other sessions of this account ended');
        this._sync('password');
        return { field: null, msg: '' };
      } catch (e) {
        const code = String(e?.code || '');
        const text = (fallback) => { const m = String(e?.message || '').trim(); return m && m.length <= 140 && !/[<>{}]/.test(m) ? m : fallback; };
        if (code === 'INVALID_CREDENTIALS') return { field: 'current', msg: '지금 비밀번호가 올바르지 않아요.' };
        if (code === 'PASSWORD_REQUIRED') return { field: 'current', msg: '지금 비밀번호를 입력해 주세요.' };
        if (code === 'TOO_MANY_ATTEMPTS' || Number(e?.status) === 429) return { field: 'current', msg: text('시도가 너무 많아요. 잠시 뒤에 다시 해 주세요.') };
        if (code === 'WEAK_PASSWORD' || code === 'SAME_PASSWORD') return { field: 'next', msg: text('더 안전한 새 비밀번호를 정해 주세요.') };
        if (code === 'PASSWORD_MISMATCH') return { field: 'again', msg: '새 비밀번호 두 칸이 서로 달라요.' };
        if (code === 'NETWORK_ERROR') return { field: null, msg: '서버에 연결하지 못했어요. 인터넷을 확인하고 다시 해 주세요.' };
        if (Number(e?.status) === 401) return { field: null, msg: '로그인이 풀렸어요. 다시 로그인한 뒤 해 주세요.' };
        return { field: null, msg: text('비밀번호를 바꾸지 못했어요. 잠시 후 다시 해 주세요.') };
      }
    },

    // ---------------------------------------------------------------- lifecycle
    init() {
      if (G.net?.serverInfo?.site) Site.apply(G.net.serverInfo.site, G.net.serverInfo.siteV);
      G.ui?.onAction?.('adminsite', () => this.openAdmin());
      G.bus.on('game:login', () => { this._sync('login'); setTimeout(() => this._remind(), 1600); });
      G.bus.on('game:logout', () => { this._ent = null; this._awaitAuth = true; this._preview = null; this._reminded = false; G.ui?.modal?.get?.('entitle-pwdefault')?.close?.(); this._sync('logout'); });
      // a server that sends no `ent`: the plan alone decides. 07-speed mirrors the plan into G.state.sub on sub:changed
      // and announces speed:changed afterwards — that is when the state holds the new plan
      G.bus.on('sub:changed', () => this._sync('plan'));
      G.bus.on('speed:changed', () => this._sync('speed'));
      G.bus.on('site:changed', () => this._sync('site'));    // the free limits are operator settings
      G.bus.on('easy:changed', () => this._chip());
      this._last = this.get();
      this._sig = JSON.stringify(this._last);
    },
    onStateLoaded() { this._sync('state'); },
    onLogout() { this._chip(); },
    /** developer-centre panel */
    info() { const e = this.get(); return { mode: serverMode() ? 'server' : 'local', fromServer: !!this._ent, preview: !!this._preview, ent: { ...e, adminUrl: e.adminUrl ? '(set)' : '' }, site: Object.keys(Site._v).length, siteV: Site._stamp }; },
  };
  G.register(E);

  // ------------------------------------------------------------------ the tap on API answers
  // G.net.request stays what callers and tests see; a test that replaces it replaces what the tap calls. Assigning the
  // tap itself back (the usual "restore") returns to the real function.
  const SITE_PATHS = new Set(['ping.php', 'auth/me.php', 'auth/login.php']);
  const ENT_PATH = /^(auth|player|sub)\//;
  function take(path, d) {
    if (!d || typeof d !== 'object' || Array.isArray(d)) return;
    const p = String(path || '').replace(/^\//, '').split('?')[0];
    if (SITE_PATHS.has(p) && d.site && typeof d.site === 'object') Site.apply(d.site, d.siteV);
    else if (typeof d.siteV === 'string') Site._stale(d.siteV);
    if (ENT_PATH.test(p) && d.ent && typeof d.ent === 'object') E._take(d.ent, p);
  }
  (function installTap() {
    const net = G.net;
    if (!net || typeof net.request !== 'function' || net.__entTap) return;
    const real = net.request;
    let inner = real;
    const tap = async function request(path, opts) {
      let d;
      try { d = await inner.call(net, path, opts); }
      catch (e) { try { take(path, e && e.data); } catch (x) { /* a refusal still carries the entitlement; never mask the error */ } throw e; }
      try { take(path, d); } catch (x) { G.log.warn('ENTITLE', 'answer not applied', x?.message || x); }
      return d;
    };
    try {
      Object.defineProperty(net, 'request', { configurable: true, enumerable: true, get() { return tap; }, set(fn) { inner = typeof fn === 'function' && fn !== tap ? fn : real; } });
      net.__entTap = true;
    } catch (e) { G.log.warn('ENTITLE', 'tap not installed', e?.message || e); }
  })();
})();
