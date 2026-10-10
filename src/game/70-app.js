// =============================================================================
// 70-app.js — app shell: boot flow, auth, title screen, onboarding, menus, settings,
//             help, avatar customizer, debug panel, admin dashboard  (G.app, G.auth; system 'app', order 90)
//
//   G.app.start()                     loading (per-system progress + tips) -> title screen over a cinematic
//                                     orbit, or ?autostart=1 -> guest login straight away
//   G.app.enterGame(profile)          useProfile -> load -> applyState -> camera follow -> HUD -> autosave ->
//                                     G.ready -> game:login {profile, isNew} + game:ready -> onboarding (new players)
//   G.app.logout({confirm})           save -> G.logoutSystems() -> G.state = null -> title (G.ready stays true)
//   G.app.showTitle(view) / openMenu() / openSettings(tab) / openHelp(tab) / openAvatar() / openAdmin(tab)
//   G.app.openCredits() / openTerms() / toggleDebug() / onboarding / portrait
//   G.auth = { current, register(form), login(form), guest(), resume(entry), logout(), accounts(), checkServer(),
//              changeNickname(nick), validate, strength }
//
// Local accounts live in localStorage 'tfm.v1.accounts' {id, email, nickname, salt, hash, algo, role, createdAt,
// lastLogin}; hash = SHA-256(salt + password) via crypto.subtle (iterated cyrb53 fallback). The first local account
// becomes 'admin'. Server mode uses auth/register|login|logout|me.php (CONTRACT §6.11).
// 'tfm.v1.profiles' is the "최근 플레이" index (level, last played, portrait) for one-click resume.
// Onboarding state: G.state.tutorial {step, done, skipped, startedAt, doneAt}.
// Hotkeys: Esc (input:menu) main menu · H help · F9 / ` debug panel. Actions: menu avatar help settings.
// =============================================================================
(function () {
  const U = G.util;
  const esc = U.escapeHtml;
  const fmt = U.fmt;
  const h = (...a) => G.ui.h(...a);
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const ico = (name, cls = '') => `<span class="ico ${cls}" data-icon="${name}"></span>`;
  const now = () => Date.now();
  const touchUI = () => !!G.input?.touchUI;
  const isServer = () => G.net?.mode === 'server';

  const CINE = { center: [0, 4, -30], radius: 95, height: 42, speed: 0.025 };
  const KEYS = {
    accounts: 'tfm.v1.accounts',
    profiles: 'tfm.v1.profiles',
    last: 'tfm.v1.lastProfile',
    lock: 'tfm.v1.authLock',
    debugPos: 'tfm.v1.debugPanel',
  };
  const IDLE = { speed: 0, grounded: true, vy: 0 };

  // ---------------------------------------------------------------- small helpers
  const store = {
    get(k, def) { try { const r = localStorage.getItem(k); return r == null ? def : JSON.parse(r); } catch (e) { return def; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { G.log.warn('SAVE', `localStorage write failed (${k})`, e); return false; } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } },
    raw(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  };

  /** Korean particle: josa('콩', '을/를') -> '콩을' */
  function josa(word, pair) {
    const w = String(word ?? '');
    const [a, b] = pair.split('/');
    const code = w.charCodeAt(w.length - 1) - 0xac00;
    if (!(code >= 0 && code <= 11171)) return `${w}${a}(${b})`;
    const jong = code % 28;
    if (pair === '으로/로') return w + (jong && jong !== 8 ? '으로' : '로');
    return w + (jong ? a : b);
  }
  function ago(ts) {
    if (!ts) return '기록 없음';
    const s = (now() - ts) / 1000;
    if (s < 45) return '방금 전';
    if (s < 3600) return `${Math.max(1, Math.round(s / 60))}분 전`;
    if (s < 86400) return `${Math.floor(s / 3600)}시간 전`;
    if (s < 86400 * 7) return `${Math.floor(s / 86400)}일 전`;
    return U.formatDate(ts);
  }
  function bytesLabel(n) {
    if (!(n > 0)) return '0 B';
    if (n < 1024) return `${n} B`;
    if (n < 1048576) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / 1048576).toFixed(2)} MB`;
  }
  async function waitUntil(cond, timeout = 3000) {
    const t0 = performance.now();
    while (!cond() && performance.now() - t0 < timeout) await U.sleep(60);
    return cond();
  }
  function download(filename, text, type = 'application/json') {
    const blob = new Blob([text], { type });
    const url = URL.createObjectURL(blob);
    const a = h('a', { href: url, download: filename, style: { display: 'none' } });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }
  function stamp(ts = now()) {
    const d = new Date(ts), p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
  }
  function kindLabel(kind) { return kind === 'guest' ? '게스트' : kind === 'server' ? '서버 계정' : '로컬 계정'; }
  function initialOf(name) { return esc(Array.from(String(name || '?').trim())[0] || '?'); }

  // ================================================================ validation
  const RX_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  const RX_NICK = /^[가-힣a-zA-Z0-9_]+$/;
  const RESERVED = ['관리자', '운영자', '운영진', '시스템', 'admin', 'administrator', 'root', 'gm', 'system', 'moderator',
    '발효마스터', '산골농부', '전통사랑', '장독지기', '안내원'];
  function hasBadWord(s) {
    const low = String(s || '').toLowerCase();
    return (G.data.badWords || []).some((w) => w && low.includes(String(w).toLowerCase()));
  }
  const V = {
    email(v) {
      v = String(v || '').trim();
      if (!v) return '이메일을 입력해 주세요.';
      if (v.length > 120 || !RX_EMAIL.test(v)) return '이메일 형식이 올바르지 않아요. (예: name@example.com)';
      return '';
    },
    /** opts: {account: true -> stricter rules, excludeId, checkTaken} */
    nickname(v, opts = {}) {
      v = String(v || '').trim();
      if (!v) return '닉네임을 입력해 주세요.';
      const n = Array.from(v).length;
      if (n < 2 || n > 12) return '닉네임은 2~12자로 입력해 주세요.';
      if (!RX_NICK.test(v)) return '한글·영문·숫자·밑줄(_)만 사용할 수 있어요.';
      if (RESERVED.includes(v.toLowerCase())) return '사용할 수 없는 닉네임이에요.';
      if (hasBadWord(v)) return '바르고 고운 닉네임을 사용해 주세요.';
      if (opts.account && /^(게스트|guest)/i.test(v)) return '‘게스트’로 시작하는 닉네임은 사용할 수 없어요.';
      if (opts.checkTaken && Accounts.nicknameTaken(v, opts.excludeId)) return '이미 사용 중인 닉네임이에요.';
      return '';
    },
    password(v) {
      v = String(v || '');
      if (!v) return '비밀번호를 입력해 주세요.';
      if (/\s/.test(v)) return '비밀번호에는 공백을 쓸 수 없어요.';
      if (v.length < 8) return '비밀번호는 8자 이상이어야 해요.';
      if (v.length > 64) return '비밀번호는 64자 이하로 입력해 주세요.';
      if (!/[A-Za-z]/.test(v) || !/[0-9]/.test(v)) return '영문과 숫자를 모두 포함해 주세요.';
      return '';
    },
    confirm(pw, again) {
      if (!again) return '비밀번호를 한 번 더 입력해 주세요.';
      if (pw !== again) return '비밀번호가 일치하지 않아요.';
      return '';
    },
  };
  const STRENGTH = ['아주 약함', '약함', '보통', '강함', '아주 강함'];
  function strength(v) {
    v = String(v || '');
    if (!v) return 0;
    let s = 0;
    if (v.length >= 8) s++;
    if (v.length >= 12) s++;
    if (/[A-Za-z]/.test(v) && /[0-9]/.test(v)) s++;
    if (/[^A-Za-z0-9]/.test(v)) s++;
    if (/[a-z]/.test(v) && /[A-Z]/.test(v)) s++;
    if (v.length < 8) s = Math.min(s, 1);
    return Math.min(4, s);
  }

  // ================================================================ crypto
  const hasSubtle = () => !!(window.crypto && crypto.subtle && typeof crypto.subtle.digest === 'function' && typeof TextEncoder !== 'undefined');
  function randomHex(bytes = 16) {
    const a = new Uint8Array(bytes);
    if (window.crypto?.getRandomValues) crypto.getRandomValues(a);
    else for (let i = 0; i < bytes; i++) a[i] = Math.floor(Math.random() * 256);
    return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
  }
  async function sha256Hex(text) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
  }
  /** fallback for environments without crypto.subtle (plain http on a LAN): iterated cyrb53 */
  function fallbackHash(text) {
    let x = text;
    for (let i = 0; i < 4096; i++) x = U.hash(`${x}:${i}:${text.length}`) + U.hash(`${i}|${x}`);
    return x;
  }
  const preferredAlgo = () => (hasSubtle() ? 'sha256' : 'cyrb53x4096');
  async function hashPassword(salt, password, algo) {
    if (algo === 'sha256') return sha256Hex(`${salt}${password}`);
    return fallbackHash(`${salt}${password}`);
  }

  // ================================================================ local accounts / recent-profile index
  const Accounts = {
    all() {
      const a = store.get(KEYS.accounts, []);
      return Array.isArray(a) ? a.filter((x) => x && typeof x === 'object' && x.id && x.email && x.hash) : [];
    },
    write(list) { return store.set(KEYS.accounts, list); },
    byId(id) { return this.all().find((a) => a.id === id) || null; },
    byLogin(login) {
      const k = String(login || '').trim().toLowerCase();
      if (!k) return null;
      return this.all().find((a) => a.email.toLowerCase() === k || String(a.nickname || '').toLowerCase() === k) || null;
    },
    emailTaken(email) { const k = String(email || '').trim().toLowerCase(); return this.all().some((a) => a.email.toLowerCase() === k); },
    nicknameTaken(nick, excludeId) {
      const k = String(nick || '').trim().toLowerCase();
      if (!k) return false;
      if (this.all().some((a) => a.id !== excludeId && String(a.nickname || '').toLowerCase() === k)) return true;
      return Profiles.all().some((p) => p.id !== excludeId && p.kind === 'guest' && String(p.nickname || '').toLowerCase() === k);
    },
    update(id, patch) {
      const list = this.all();
      const a = list.find((x) => x.id === id);
      if (!a) return null;
      Object.assign(a, patch);
      this.write(list);
      return a;
    },
    publicList() { return this.all().map(({ id, email, nickname, role, createdAt, lastLogin, algo }) => ({ id, email, nickname, role, createdAt, lastLogin, algo })); },
  };

  const Profiles = {
    all() {
      const a = store.get(KEYS.profiles, []);
      return (Array.isArray(a) ? a.filter((p) => p && p.id && p.kind) : []).sort((x, y) => (y.lastPlayed || 0) - (x.lastPlayed || 0));
    },
    get(id) { return this.all().find((p) => p.id === id) || null; },
    upsert(entry) {
      if (!entry?.id) return null;
      const list = this.all();
      let p = list.find((x) => x.id === entry.id);
      if (!p) {
        if (!entry.kind) return null; // only full entries may create a row
        p = { id: entry.id, createdAt: now() };
        list.push(p);
      }
      for (const [k, v] of Object.entries(entry)) if (v !== undefined) p[k] = v;
      list.sort((x, y) => (y.lastPlayed || 0) - (x.lastPlayed || 0));
      if (list.length > 12) list.length = 12;
      store.set(KEYS.profiles, list);
      return p;
    },
    remove(id) {
      store.set(KEYS.profiles, this.all().filter((p) => p.id !== id));
      if (store.get(KEYS.last, null) === id) store.del(KEYS.last);
    },
    last() { const id = store.get(KEYS.last, null); return id ? this.get(id) : null; },
    setLast(id) { store.set(KEYS.last, id); },
  };
  const indexId = (p) => (p?.kind === 'server' ? `srv_${p.id}` : p?.id);

  /** failed-login throttle: 5 misses -> 30 s lock (per login name, persisted) */
  const Lock = {
    _m: null,
    _load() { if (!this._m) { const m = store.get(KEYS.lock, {}); this._m = m && typeof m === 'object' && !Array.isArray(m) ? m : {}; } return this._m; },
    left(key) { const e = this._load()[key]; return e && e.until > now() ? Math.ceil((e.until - now()) / 1000) : 0; },
    fail(key) {
      const m = this._load();
      const e = m[key] || (m[key] = { n: 0, until: 0 });
      if (e.until && e.until <= now()) { e.n = 0; e.until = 0; }
      e.n++;
      let res = { locked: false, left: 5 - e.n, wait: 0 };
      if (e.n >= 5) { e.until = now() + 30000; e.n = 0; res = { locked: true, left: 0, wait: 30 }; }
      store.set(KEYS.lock, m);
      return res;
    },
    clear(key) { const m = this._load(); if (m[key]) { delete m[key]; store.set(KEYS.lock, m); } },
  };

  // ================================================================ auth
  class AuthError extends Error {
    constructor(message, field = null, code = null) { super(message); this.name = 'AuthError'; this.field = field; this.code = code; }
  }
  function serverAuthError(e) {
    if (e instanceof AuthError) return e;
    const code = String(e?.code || '');
    const field = /EMAIL/.test(code) ? 'email' : /NICK/.test(code) ? 'nickname' : /PASS|CREDENTIAL|LOGIN|INVALID/.test(code) ? 'password' : null;
    let msg = e?.message || '요청을 처리하지 못했어요. 잠시 후 다시 시도해 주세요.';
    if (code === 'NETWORK_ERROR') msg = '서버에 연결하지 못했어요. 인터넷 연결을 확인하고 다시 시도해 주세요.';
    if (code === 'RATE_LIMITED' || e?.status === 429) msg = '요청이 너무 많아요. 잠시 후 다시 시도해 주세요.';
    return new AuthError(msg, field, code);
  }
  function normServerUser(d) {
    const u = d && (d.user || d.profile || (d.id != null ? d : null));
    if (!u || u.id == null) return null;
    return { id: String(u.id), kind: 'server', email: String(u.email || ''), nickname: String(u.nickname || u.name || '체험객'), role: u.role === 'admin' ? 'admin' : 'user', guest: false };
  }
  function toProfile(acc) {
    return { id: acc.id, kind: 'local', email: acc.email, nickname: acc.nickname, role: acc.role === 'admin' ? 'admin' : 'user', guest: false };
  }
  function guestEntry() {
    let p = Profiles.get('guest');
    if (!p) p = Profiles.upsert({ id: 'guest', kind: 'guest', nickname: `게스트${U.randInt(1000, 9999)}`, role: 'user' });
    return p || { id: 'guest', kind: 'guest', nickname: '게스트' };
  }

  const auth = {
    current: null,
    serverUser: null,
    AuthError,
    validate: V,
    strength,
    strengthLabel: (n) => STRENGTH[n] || STRENGTH[0],
    accounts: () => Accounts.publicList(),
    isServer,

    async register(form = {}) {
      const email = String(form.email || '').trim();
      const nickname = String(form.nickname || '').trim();
      const password = String(form.password || '');
      const confirm = String(form.confirm ?? password);
      let err;
      if ((err = V.email(email))) throw new AuthError(err, 'email');
      if ((err = V.nickname(nickname, { account: true, checkTaken: !isServer() }))) throw new AuthError(err, 'nickname');
      if ((err = V.password(password))) throw new AuthError(err, 'password');
      if ((err = V.confirm(password, confirm))) throw new AuthError(err, 'confirm');
      if (!form.agree) throw new AuthError('이용약관 및 개인정보 처리 안내에 동의해 주세요.', 'agree');
      if (isServer()) {
        try {
          const d = await G.net.request('auth/register.php', { body: { email, nickname, password, password_confirm: confirm, agree: true } });
          let user = normServerUser(d);
          if (!user) user = await this._serverLogin(email, password, true);
          this.serverUser = user;
          G.log.info('AUTH', `server account created ${user.id}`);
          return this._setCurrent(user);
        } catch (e) { throw serverAuthError(e); }
      }
      if (Accounts.emailTaken(email)) throw new AuthError('이미 가입된 이메일이에요. 로그인해 주세요.', 'email');
      if (Accounts.nicknameTaken(nickname)) throw new AuthError('이미 사용 중인 닉네임이에요.', 'nickname');
      const algo = preferredAlgo();
      const salt = randomHex(16);
      const hash = await hashPassword(salt, password, algo);
      const list = Accounts.all();
      const acc = { id: U.uid('u'), email, nickname, salt, hash, algo, role: list.length === 0 ? 'admin' : 'user', createdAt: now(), lastLogin: now() };
      list.push(acc);
      if (!Accounts.write(list)) throw new AuthError('저장 공간이 부족해 계정을 만들지 못했어요. 브라우저 저장 공간을 확인해 주세요.');
      G.log.info('AUTH', `local account created ${acc.id}${acc.role === 'admin' ? ' (first account -> admin)' : ''}`);
      Profiles.upsert({ id: acc.id, kind: 'local', nickname, email, role: acc.role, remember: form.remember !== false });
      const profile = this._setCurrent(toProfile(acc));
      profile.firstAdmin = acc.role === 'admin';
      return profile;
    },

    async login(form = {}) {
      const login = String(form.login ?? form.email ?? '').trim();
      const password = String(form.password || '');
      if (!login) throw new AuthError('아이디(닉네임) 또는 이메일을 입력해 주세요.', 'login');
      if (!password) throw new AuthError('비밀번호를 입력해 주세요.', 'password');
      if (isServer()) {
        try { return this._setCurrent(await this._serverLogin(login, password, !!form.remember)); } catch (e) { throw serverAuthError(e); }
      }
      const key = login.toLowerCase();
      const wait = Lock.left(key);
      if (wait) throw new AuthError(`로그인 시도가 너무 많아요. ${wait}초 후에 다시 시도해 주세요.`, 'password', 'LOCKED');
      const fail = () => {
        const r = Lock.fail(key);
        if (r.locked) return new AuthError(`로그인 시도가 너무 많아요. ${r.wait}초 후에 다시 시도해 주세요.`, 'password', 'LOCKED');
        return new AuthError(`아이디 또는 비밀번호가 올바르지 않아요.${r.left <= 2 ? ` (남은 시도 ${r.left}회)` : ''}`, 'password', 'INVALID');
      };
      const acc = Accounts.byLogin(login);
      if (!acc) { await U.sleep(220); throw fail(); }
      if (acc.algo === 'sha256' && !hasSubtle()) throw new AuthError('이 실행 환경에서는 암호화 기능을 쓸 수 없어 로그인할 수 없어요. https 주소나 파일로 직접 열어 주세요.');
      const hash = await hashPassword(acc.salt, password, acc.algo);
      if (hash !== acc.hash) throw fail();
      Lock.clear(key);
      Accounts.update(acc.id, { lastLogin: now() });
      Profiles.upsert({ id: acc.id, kind: 'local', nickname: acc.nickname, email: acc.email, role: acc.role, remember: !!form.remember });
      G.log.info('AUTH', `local login ${acc.id}`);
      return this._setCurrent(toProfile(acc));
    },

    async guest() {
      const p = guestEntry();
      return this._setCurrent({ id: 'guest', kind: 'guest', nickname: p.nickname || '게스트', email: '', role: G.flags.debug ? 'admin' : 'user', guest: true });
    },

    /** one-click resume of a profile from the "최근 플레이" list -> profile | null (password needed) */
    async resume(entry) {
      if (!entry) return null;
      if (entry.kind === 'guest') return this.guest();
      if (entry.kind === 'local') {
        if (isServer() || !entry.remember) return null;
        const acc = Accounts.byId(entry.id);
        if (!acc) { Profiles.remove(entry.id); return null; }
        Accounts.update(acc.id, { lastLogin: now() });
        return this._setCurrent(toProfile(acc));
      }
      if (entry.kind === 'server' && isServer()) {
        const u = this.serverUser || (await this.checkServer());
        if (u && indexId(u) === entry.id) return this._setCurrent(u);
      }
      return null;
    },

    /** server mode: who is logged in (session cookie)? */
    async checkServer() {
      if (!isServer()) return null;
      try { this.serverUser = normServerUser(await G.net.request('auth/me.php', { quiet: true, timeout: 5000 })); }
      catch (e) { this.serverUser = null; }
      return this.serverUser;
    },

    async _serverLogin(login, password, remember) {
      const d = await G.net.request('auth/login.php', { body: { email: login, login, password, remember: !!remember } });
      const u = normServerUser(d);
      if (!u) throw new AuthError('로그인 응답을 확인하지 못했어요. 잠시 후 다시 시도해 주세요.');
      this.serverUser = u;
      G.log.info('AUTH', `server login ${u.id}`);
      return u;
    },

    async logout() {
      const cur = this.current;
      this.current = null;
      if (!cur) return;
      if (cur.kind === 'server' && isServer()) {
        try { await G.net.request('auth/logout.php', { body: {}, timeout: 5000 }); } catch (e) { G.log.warn('AUTH', 'server logout failed', e?.message || e); }
        this.serverUser = null;
      }
      if (cur.kind === 'local') Profiles.upsert({ id: cur.id, remember: false });
      G.log.info('AUTH', `logout ${cur.kind} ${cur.id}`);
    },

    /** rename the current player (local accounts and guests) -> '' on success or an error message */
    changeNickname(nick) {
      const cur = this.current;
      if (!cur || !G.state) return '로그인한 뒤에 바꿀 수 있어요.';
      if (cur.kind === 'server') return '서버 계정의 닉네임은 이곳에서 바꿀 수 없어요.';
      nick = String(nick || '').trim();
      if (nick === cur.nickname) return '';
      const err = V.nickname(nick, { account: cur.kind === 'local', excludeId: cur.id, checkTaken: true });
      if (err) return err;
      cur.nickname = nick;
      if (G.save.profile) G.save.profile.nickname = nick;
      G.state.profile.nickname = nick;
      if (cur.kind === 'local') Accounts.update(cur.id, { nickname: nick });
      Profiles.upsert({ id: indexId(cur), nickname: nick });
      G.dirty('profile');
      G.bus.emit('profile:changed', { profile: G.state.profile, field: 'nickname' });
      G.log.info('AUTH', `nickname changed (${cur.kind})`);
      return '';
    },

    _setCurrent(p) { this.current = p; return p; },
  };
  G.auth = auth;

  // ================================================================ avatar portrait (main renderer -> RT -> PNG data URL)
  const _pv = new THREE.Vector3();
  const _pc = new THREE.Color();
  function aces(x) { const v = (x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14); return v < 0 ? 0 : v > 1 ? 1 : v; }
  function srgb(v) { return v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055; }
  let _lut = null;
  /** linear RGBA (MSAA-premultiplied edges) -> tone-mapped sRGB canvas */
  function encodePixels(buf, S, gain) {
    if (!_lut) { _lut = new Uint8Array(1024); for (let i = 0; i < 1024; i++) _lut[i] = Math.round(srgb(aces((i / 1023) * 4)) * 255); }
    const c = document.createElement('canvas');
    c.width = c.height = S;
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(S, S);
    const d = img.data;
    for (let y = 0; y < S; y++) {
      const src = (S - 1 - y) * S * 4, dst = y * S * 4;
      for (let x = 0; x < S * 4; x += 4) {
        const a = buf[src + x + 3];
        if (!a) { d[dst + x + 3] = 0; continue; }
        const k = (gain / a) * (1023 / 4);
        d[dst + x] = _lut[Math.min(1023, Math.round(buf[src + x] * k))];
        d[dst + x + 1] = _lut[Math.min(1023, Math.round(buf[src + x + 1] * k))];
        d[dst + x + 2] = _lut[Math.min(1023, Math.round(buf[src + x + 2] * k))];
        d[dst + x + 3] = a;
      }
    }
    ctx.putImageData(img, 0, 0);
    return c;
  }

  const Portrait = {
    url: null,       // current HUD portrait (data URL)
    _timer: 0,
    _busy: false,
    _again: false,
    _seq: 0,
    schedule(delay = 900) {
      clearTimeout(this._timer);
      this._timer = setTimeout(() => {
        const go = () => this._run().catch((e) => G.log.warn('UI', 'portrait skipped', e));
        if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(go, { timeout: 1500 }); else go();
      }, delay);
    },
    async _run() {
      if (this._busy) { this._again = true; return; }
      if (!G.state || !app.loggedIn) return;
      this._busy = true;
      const seq = ++this._seq;
      const owner = indexId(auth.current);
      try {
        const appearance = G.state.profile?.avatar || G.avatar?.defaultAppearance;
        const canvas = await this.render(appearance, 128);
        if (!canvas || seq !== this._seq || !app.loggedIn || indexId(auth.current) !== owner) return;
        const url = canvas.toDataURL('image/png');
        this.apply(url);
        // small copy for the title screen's "최근 플레이" list
        const sm = document.createElement('canvas');
        sm.width = sm.height = 64;
        sm.getContext('2d').drawImage(canvas, 0, 0, 64, 64);
        if (owner) Profiles.upsert({ id: owner, portrait: sm.toDataURL('image/png') });
      } finally {
        this._busy = false;
        if (this._again) { this._again = false; this.schedule(300); }
      }
    },
    /** render a head-and-shoulders portrait -> canvas | null */
    async render(appearance, S = 128) {
      const E = G.sys.engine, r = E?.renderer;
      if (!r || !G.avatar?.create || typeof r.readRenderTargetPixels !== 'function') return null;
      const K = 0.5; // lights at half power keep 8-bit targets from clipping; the gain restores them
      const scene = new THREE.Scene();
      scene.environment = E.scene?.environment || null;
      scene.environmentIntensity = 0.55;
      const key = new THREE.DirectionalLight(0xfff0d8, 3.2 * K); key.position.set(1.4, 2.4, 3);
      const fill = new THREE.DirectionalLight(0xd2e4ff, 1.2 * K); fill.position.set(-2.6, 1.0, 1.6);
      const rim = new THREE.DirectionalLight(0xffe0a8, 2.0 * K); rim.position.set(-1.2, 2.4, -2.6);
      scene.add(new THREE.HemisphereLight(0xfff4e2, 0x56674a, 1.5 * K), key, fill, rim);
      const cam = new THREE.PerspectiveCamera(22, 1, 0.05, 20);
      const rt = new THREE.WebGLRenderTarget(S, S, { samples: 4 });
      const buf = new Uint8Array(S * S * 4);
      let rig = null;
      try {
        rig = G.avatar.create(appearance, { shadow: false });
        rig.setExpression?.('happy', 60);
        for (let i = 0; i < 4; i++) rig.update(1 / 30, IDLE);
        scene.add(rig.group);
        scene.updateMatrixWorld(true);
        rig.headAnchor.getWorldPosition(_pv);
        const cy = _pv.y - 0.36;
        cam.position.set(0.3, cy + 0.08, 1.5);
        cam.lookAt(0, cy, 0);
        const prevRT = r.getRenderTarget();
        r.getClearColor(_pc);
        const prevAlpha = r.getClearAlpha();
        try {
          r.setClearColor(0x000000, 0);
          r.setRenderTarget(rt);
          r.clear();
          r.render(scene, cam);
        } finally {
          r.setRenderTarget(prevRT);
          r.setClearColor(_pc, prevAlpha);
        }
        if (typeof r.readRenderTargetPixelsAsync === 'function') await r.readRenderTargetPixelsAsync(rt, 0, 0, S, S, buf);
        else r.readRenderTargetPixels(rt, 0, 0, S, S, buf);
        return encodePixels(buf, S, 0.72 / K);
      } finally {
        rt.dispose();
        if (rig) { scene.remove(rig.group); try { rig.dispose(); } catch (e) { /* ignore */ } }
      }
    },
    apply(url) {
      this.url = url || null;
      for (const b of $$('.hud-avatar')) {
        if (url) { b.style.backgroundImage = `url("${url}"), linear-gradient(160deg, #8fd0ff, #3b74d6)`; b.classList.add('has-portrait'); }
        else { b.style.backgroundImage = ''; b.classList.remove('has-portrait'); }
      }
    },
    reset() { clearTimeout(this._timer); this._seq++; this.apply(null); },
  };

  // ================================================================ title screen
  const LOGO_SVG = `<svg viewBox="0 0 120 120" aria-hidden="true"><defs><linearGradient id="ts-jar" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8d5733"/><stop offset="1" stop-color="#3a2114"/></linearGradient><radialGradient id="ts-glow" cx=".5" cy=".55" r=".5"><stop offset="0" stop-color="#f4c54a" stop-opacity=".5"/><stop offset="1" stop-color="#f4c54a" stop-opacity="0"/></radialGradient></defs><circle cx="60" cy="64" r="58" fill="url(#ts-glow)"/><ellipse cx="60" cy="26" rx="25" ry="7.5" fill="#2a170d"/><path d="M29 31c-14 18-12 57 8 73h46c20-16 22-55 8-73z" fill="url(#ts-jar)"/><path d="M34 51h52" stroke="#f4c54a" stroke-width="3" stroke-linecap="round"/><ellipse cx="46" cy="67" rx="5" ry="14" fill="#fff" opacity=".14"/><path d="M60 3c2.4 5.6 7.6 7 7.6 7s-5.2 1.4-7.6 7c-2.4-5.6-7.6-7-7.6-7s5.2-1.4 7.6-7z" fill="#ffe08a"/></svg>`;
  const EYE_SVG = G.icon('eye');
  const EYE_OFF_SVG = G.icon('eye-off');

  const Title = {
    el: null,
    open: false,
    view: 'home',
    busy: false,
    _hideTimer: 0,

    build() {
      const el = h('div', { class: 'title-screen', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'ts-title' });
      el.innerHTML = `
        <div class="ts-vignette" aria-hidden="true"></div>
        <div class="ts-layout">
          <div class="ts-main">
            <header class="ts-brand">
              <div class="ts-logo">${LOGO_SVG}</div>
              <div class="ts-eyebrow">METAVERSE</div>
              <h1 id="ts-title" class="ts-title">전통발효체험관</h1>
              <p class="ts-sub">한국 전통발효문화와 농업을 체험하는 3D 메타버스</p>
            </header>
            <section class="ts-card glass">
              <div class="ts-view" data-view="home"></div>
              <div class="ts-view" data-view="login" hidden></div>
              <div class="ts-view" data-view="register" hidden></div>
            </section>
            <footer class="ts-foot">
              <span class="ts-mode"></span>
              <span class="ts-links">
                <button type="button" data-act="help">${ico('keyboard', 'ico-sm')}조작 방법</button>
                <button type="button" data-act="settings">${ico('settings', 'ico-sm')}설정</button>
                <button type="button" data-act="credits">${ico('info', 'ico-sm')}안내 및 고지</button>
              </span>
              <span class="ts-ver">v${esc(G.VERSION)}</span>
            </footer>
          </div>
          <aside class="ts-side">
            <section class="ts-panel glass ts-recent" aria-label="최근 플레이">
              <h3>${ico('clock', 'ico-sm')}최근 플레이</h3>
              <ul class="ts-plist"></ul>
            </section>
            <section class="ts-panel glass ts-fact" aria-label="오늘의 발효 상식">
              <h3>${ico('sparkle', 'ico-sm')}오늘의 발효 상식</h3>
              <p class="ts-fact-text"></p>
              <button type="button" class="ts-fact-next" data-act="fact">다른 상식 보기 ${ico('refresh', 'ico-xs')}</button>
            </section>
          </aside>
        </div>`;
      el.querySelector('[data-view="login"]').innerHTML = this._loginHtml();
      el.querySelector('[data-view="register"]').innerHTML = this._registerHtml();
      G.ui.hydrateIcons(el);
      el.addEventListener('click', (e) => this._onClick(e));
      for (const f of el.querySelectorAll('form[data-form]')) this._bindForm(f);
      this.el = el;
      this._fact();
    },

    show(view = 'home') {
      if (!this.el) this.build();
      clearTimeout(this._hideTimer);
      const root = $('#screen-root') || document.body;
      if (!this.el.isConnected) root.appendChild(this.el);
      this.el.classList.remove('out');
      this.open = true;
      document.body.classList.add('title-open');
      G.ui.block('title');
      G.ui.setHudVisible(false);
      G.ui.objective?.(null);
      try { G.sys.camera?.cinematic?.(CINE); } catch (e) { G.log.warn('UI', 'cinematic camera failed', e); }
      this._resetForms();
      this.renderHome();
      this.setView(view, { focus: false });
      requestAnimationFrame(() => requestAnimationFrame(() => this.el?.classList.add('in')));
      if (isServer()) auth.checkServer().then(() => { if (this.open) this.renderHome(); });
    },

    hide() {
      if (!this.el || !this.open) return;
      this.open = false;
      document.body.classList.remove('title-open');
      G.ui.unblock('title');
      this.el.classList.remove('in');
      this.el.classList.add('out');
      clearTimeout(this._hideTimer);
      this._hideTimer = setTimeout(() => { if (!this.open) { this.el?.remove(); this._resetForms(); } }, 650);
    },

    setView(view, opts = {}) {
      if (!this.el) return;
      this.view = view;
      for (const v of this.el.querySelectorAll('.ts-view')) {
        const on = v.dataset.view === view;
        v.hidden = !on;
        if (on) { v.classList.remove('enter'); void v.offsetWidth; v.classList.add('enter'); }
      }
      this.el.classList.toggle('ts-form-open', view !== 'home');
      if (view === 'login') this._prepLogin();
      if (view === 'register') this._prepRegister();
      if (opts.focus !== false && view !== 'home') {
        setTimeout(() => {
          const f = this.el?.querySelector(`.ts-view[data-view="${view}"] input:not([type=checkbox]):not([value])`) || this.el?.querySelector(`.ts-view[data-view="${view}"] input`);
          if (f && !touchUI()) f.focus();
        }, 60);
      }
    },

    // ------------------------------------------------------------ home
    _plan() {
      if (isServer() && auth.serverUser) return { kind: 'server', label: `${auth.serverUser.nickname}님으로 이어하기` };
      const last = Profiles.last();
      if (last?.kind === 'guest') return { kind: 'guest', entry: last, label: `${last.nickname} · Lv.${last.level || 1} 이어하기` };
      if (last?.kind === 'local' && !isServer() && Accounts.byId(last.id)) {
        if (last.remember) return { kind: 'resume', entry: last, label: `${last.nickname} · Lv.${last.level || 1} 이어하기` };
        return { kind: 'login', entry: last, label: `${josa(last.nickname, '으로/로')} 로그인하기` };
      }
      return { kind: 'guest', label: '설치 없이 바로 체험을 시작해요' };
    },

    renderHome() {
      if (!this.el) return;
      const plan = this._plan();
      const home = this.el.querySelector('[data-view="home"]');
      const server = isServer();
      home.innerHTML = `
        <button type="button" class="btn btn-gold btn-lg btn-block ts-start" data-act="start">
          <span class="ts-start-ico">${ico('sparkle')}</span>
          <span class="ts-start-txt"><b>게임 시작</b><small>${esc(plan.label)}</small></span>
          <span class="ts-start-arrow">${ico('chevron-right')}</span>
        </button>
        <div class="ts-row">
          <button type="button" class="btn btn-soft btn-lg" data-act="go-login">${ico('lock', 'ico-sm')}로그인</button>
          <button type="button" class="btn btn-soft btn-lg" data-act="go-register">${ico('user', 'ico-sm')}회원가입</button>
        </div>
        <button type="button" class="btn btn-ghost btn-block ts-guest" data-act="guest">${ico('eye', 'ico-sm')}게스트로 둘러보기<small>${server ? '게스트 기록은 이 브라우저에만 저장돼요' : '가입 없이 이 브라우저에 저장돼요'}</small></button>
        <div class="ts-features" aria-label="주요 체험">
          <span class="ts-feat"><span class="emoji">🌱</span>전통작물 재배</span>
          <span class="ts-feat"><span class="emoji">🏺</span>장독 발효</span>
          <span class="ts-feat"><span class="emoji">📖</span>배움터·퀴즈</span>
          <span class="ts-feat"><span class="emoji">📸</span>포토존</span>
        </div>`;
      G.ui.hydrateIcons(home);
      const mode = this.el.querySelector('.ts-mode');
      mode.className = `ts-mode ${server ? 'server' : 'local'}`;
      mode.innerHTML = server
        ? `<span class="dot"></span><b>서버 모드</b><span>계정 서버에 저장</span>`
        : `<span class="dot"></span><b>로컬 모드</b><span>이 브라우저에 저장</span>`;
      mode.title = server ? `서버에 연결됨${G.net.serverInfo?.version ? ` (API v${G.net.serverInfo.version})` : ''}` : '서버 없이 실행 중 — 진행 상황은 이 브라우저(localStorage)에 저장돼요.';
      this._renderProfiles();
    },

    _renderProfiles() {
      const list = this.el.querySelector('.ts-plist');
      const server = isServer();
      const entries = Profiles.all().filter((p) => p.kind === 'guest' || (server ? p.kind === 'server' : p.kind === 'local')).slice(0, 5);
      if (!entries.length) {
        list.innerHTML = `<li class="ts-pempty">아직 플레이 기록이 없어요.<br><b>게임 시작</b>을 눌러 첫 체험을 시작해 보세요!</li>`;
        return;
      }
      list.innerHTML = entries.map((p) => {
        const one = p.kind === 'guest' || (p.kind === 'local' && p.remember) || (p.kind === 'server' && auth.serverUser && indexId(auth.serverUser) === p.id);
        const ava = p.portrait ? ` style="background-image:url('${esc(p.portrait)}')"` : '';
        return `<li class="ts-pitem">
          <button type="button" class="ts-pmain" data-act="resume" data-id="${esc(p.id)}" title="${one ? '바로 이어하기' : '비밀번호를 입력해 로그인'}">
            <span class="ts-pava${p.portrait ? ' has-img' : ''}"${ava}>${p.portrait ? '' : initialOf(p.nickname)}</span>
            <span class="ts-pinfo"><b>${esc(p.nickname || '이름 없음')}</b><small><span class="lv">Lv.${Number(p.level) || 1}</span> · ${kindLabel(p.kind)} · ${esc(ago(p.lastPlayed))}</small></span>
            <span class="ts-pgo">${one ? '이어하기' : '로그인'}${ico('chevron-right', 'ico-xs')}</span>
          </button>
          <button type="button" class="icon-btn ts-pdel" data-act="forget" data-id="${esc(p.id)}" aria-label="${esc(p.nickname)} 목록에서 지우기" title="목록에서 지우기 (저장 데이터는 남아 있어요)">${ico('x', 'ico-sm')}</button>
        </li>`;
      }).join('');
      G.ui.hydrateIcons(list);
    },

    _fact() {
      const el = this.el?.querySelector('.ts-fact-text');
      if (!el) return;
      const tips = (G.data.tips || []).filter((t) => t[0] === '상식');
      if (!tips.length) { el.closest('.ts-fact').hidden = true; return; }
      let t;
      do { t = U.pick(tips)[1]; } while (tips.length > 1 && t === this._lastFact);
      this._lastFact = t;
      el.textContent = t;
    },

    async _onClick(e) {
      const b = e.target.closest('[data-act]');
      if (!b || !this.el.contains(b) || b.disabled) return;
      const act = b.dataset.act;
      if (['start', 'guest', 'resume'].includes(act) && (this.busy || app._entering)) return;
      switch (act) {
        case 'start': G.sfx('click'); return this._start();
        case 'guest': G.sfx('click'); return this._go(() => auth.guest(), b);
        case 'go-login': G.sfx('click'); return this.setView('login');
        case 'go-register': G.sfx('click'); return this.setView('register');
        case 'back': G.sfx('close'); return this.setView('home');
        case 'help': return openHelp();
        case 'settings': return openSettings();
        case 'credits': return openCredits();
        case 'terms': return openTerms();
        case 'fact': return this._fact();
        case 'eye': return this._toggleEye(b);
        case 'resume': return this._resume(b.dataset.id, b);
        case 'forget': {
          const p = Profiles.get(b.dataset.id);
          if (!p) return;
          const ok = await G.ui.confirm(`「${p.nickname}」을(를) 최근 플레이 목록에서 지울까요?<br><span class="small dim">저장된 진행 상황은 지워지지 않아요. 다시 로그인하면 이어서 할 수 있어요.</span>`, { title: '목록에서 지우기', icon: 'trash', okText: '지우기', html: true });
          if (ok) { Profiles.remove(p.id); this.renderHome(); }
          return;
        }
        default:
      }
    },

    async _start() {
      const plan = this._plan();
      if (plan.kind === 'server') return this._go(() => auth.resume({ kind: 'server', id: indexId(auth.serverUser) }), this.el.querySelector('.ts-start'));
      if (plan.kind === 'resume') return this._resume(plan.entry.id, this.el.querySelector('.ts-start'));
      if (plan.kind === 'login') { this.setView('login'); const i = this.el.querySelector('[data-form=login] [name=login]'); if (i) { i.value = plan.entry.email || plan.entry.nickname || ''; setTimeout(() => this.el?.querySelector('[data-form=login] [name=password]')?.focus(), 80); } return null; }
      return this._go(() => auth.guest(), this.el.querySelector('.ts-start'));
    },

    async _resume(id, btn) {
      const p = Profiles.get(id);
      if (!p) { this.renderHome(); return; }
      G.sfx('click');
      const prof = await auth.resume(p).catch(() => null);
      if (prof) return this._go(() => prof, btn);
      if (p.kind === 'server' && !isServer()) { G.ui.toast('서버 계정은 서버 모드에서만 이어할 수 있어요.', { type: 'warn' }); return; }
      if (p.kind === 'local' && isServer()) { G.ui.toast('로컬 계정은 로컬 모드에서만 이어할 수 있어요.', { type: 'warn' }); return; }
      this.setView('login');
      const i = this.el.querySelector('[data-form=login] [name=login]');
      if (i) i.value = p.email || p.nickname || '';
      setTimeout(() => this.el?.querySelector('[data-form=login] [name=password]')?.focus(), 80);
    },

    /** run an auth producer then enter the game, with a busy state on `btn` */
    async _go(producer, btn) {
      if (this.busy || app._entering) return;
      this._setBusy(true, btn);
      try {
        const profile = await producer();
        if (!profile) return;
        await app.enterGame(profile);
      } catch (e) {
        G.log.error('AUTH', 'start failed', e);
        G.ui.toast(e?.message || '게임을 시작하지 못했어요. 잠시 후 다시 시도해 주세요.', { type: 'error' });
      } finally { this._setBusy(false, btn); }
    },

    _setBusy(on, btn) {
      this.busy = !!on;
      this.el?.classList.toggle('busy', !!on);
      if (btn) { btn.classList.toggle('loading', !!on); btn.setAttribute('aria-busy', on ? 'true' : 'false'); }
      for (const b of this.el?.querySelectorAll('.ts-card button') || []) if (b !== btn) b.disabled = !!on;
    },

    // ------------------------------------------------------------ forms
    _loginHtml() {
      return `
        <div class="ts-view-head"><button type="button" class="icon-btn" data-act="back" aria-label="뒤로">${ico('chevron-left')}</button><h2>로그인</h2></div>
        <p class="ts-note" data-note="login"></p>
        <form class="ts-form" data-form="login" novalidate autocomplete="on">
          <div class="field" data-field="login">
            <label for="ts-login-id">아이디(닉네임) 또는 이메일</label>
            <input id="ts-login-id" name="login" type="text" inputmode="email" autocomplete="username" maxlength="120" placeholder="name@example.com" spellcheck="false" autocapitalize="off">
            <div class="error" role="alert"></div>
          </div>
          <div class="field" data-field="password">
            <label for="ts-login-pw">비밀번호</label>
            <div class="pw-wrap"><input id="ts-login-pw" name="password" type="password" autocomplete="current-password" maxlength="64" placeholder="비밀번호">
              <button type="button" class="pw-eye" data-act="eye" aria-label="비밀번호 보기" aria-pressed="false">${EYE_SVG}</button></div>
            <div class="hint caps" hidden>⇪ Caps Lock이 켜져 있어요</div>
            <div class="error" role="alert"></div>
          </div>
          <label class="check"><input type="checkbox" name="remember" checked> 이 기기에서 로그인 상태 유지</label>
          <div class="form-error" role="alert" hidden></div>
          <button type="submit" class="btn btn-primary btn-lg btn-block ts-submit"><span class="spin" aria-hidden="true"></span><span class="lbl">로그인</span></button>
          <p class="ts-switch">아직 계정이 없나요? <button type="button" class="link" data-act="go-register">회원가입</button></p>
        </form>`;
    },
    _registerHtml() {
      return `
        <div class="ts-view-head"><button type="button" class="icon-btn" data-act="back" aria-label="뒤로">${ico('chevron-left')}</button><h2>회원가입</h2></div>
        <p class="ts-note" data-note="register"></p>
        <form class="ts-form" data-form="register" novalidate autocomplete="on">
          <div class="field" data-field="email">
            <label for="ts-reg-email">이메일</label>
            <input id="ts-reg-email" name="email" type="email" inputmode="email" autocomplete="email" maxlength="120" placeholder="name@example.com" spellcheck="false" autocapitalize="off">
            <div class="error" role="alert"></div>
          </div>
          <div class="field" data-field="nickname">
            <label for="ts-reg-nick">닉네임 <small class="muted">2~12자 · 한글·영문·숫자·_</small></label>
            <input id="ts-reg-nick" name="nickname" type="text" autocomplete="nickname" maxlength="24" placeholder="예: 메주콩">
            <div class="hint ok" hidden></div>
            <div class="error" role="alert"></div>
          </div>
          <div class="field" data-field="password">
            <label for="ts-reg-pw">비밀번호</label>
            <div class="pw-wrap"><input id="ts-reg-pw" name="password" type="password" autocomplete="new-password" maxlength="64" placeholder="영문·숫자 포함 8자 이상">
              <button type="button" class="pw-eye" data-act="eye" aria-label="비밀번호 보기" aria-pressed="false">${EYE_SVG}</button></div>
            <div class="pw-strength" aria-live="polite"><div class="pw-meter"><i></i></div><span class="pw-label">비밀번호 강도</span></div>
            <ul class="pw-rules"><li data-rule="len">8자 이상</li><li data-rule="alpha">영문 포함</li><li data-rule="digit">숫자 포함</li></ul>
            <div class="hint caps" hidden>⇪ Caps Lock이 켜져 있어요</div>
            <div class="error" role="alert"></div>
          </div>
          <div class="field" data-field="confirm">
            <label for="ts-reg-pw2">비밀번호 확인</label>
            <input id="ts-reg-pw2" name="confirm" type="password" autocomplete="new-password" maxlength="64" placeholder="비밀번호를 한 번 더 입력">
            <div class="error" role="alert"></div>
          </div>
          <div class="field ts-agree" data-field="agree">
            <label class="check"><input type="checkbox" name="agree"><span><b class="req">[필수]</b> <button type="button" class="link" data-act="terms">이용약관·개인정보 처리 안내</button>에 동의합니다</span></label>
            <div class="error" role="alert"></div>
          </div>
          <div class="form-error" role="alert" hidden></div>
          <button type="submit" class="btn btn-primary btn-lg btn-block ts-submit"><span class="spin" aria-hidden="true"></span><span class="lbl">가입하고 시작하기</span></button>
          <p class="ts-switch">이미 계정이 있나요? <button type="button" class="link" data-act="go-login">로그인</button></p>
        </form>`;
    },

    _prepLogin() {
      const n = this.el.querySelector('[data-note=login]');
      n.innerHTML = isServer()
        ? `${ico('shield', 'ico-sm')}서버 계정으로 로그인해요. 진행 상황은 계정 서버에 저장돼요.`
        : `${ico('lock', 'ico-sm')}이 브라우저에서 만든 로컬 계정으로 로그인해요.`;
      G.ui.hydrateIcons(n);
    },
    _prepRegister() {
      const n = this.el.querySelector('[data-note=register]');
      n.innerHTML = isServer()
        ? `${ico('shield', 'ico-sm')}계정과 진행 상황이 서버에 안전하게 저장돼요. 비밀번호는 암호화되어 보관돼요.`
        : `${ico('info', 'ico-sm')}로컬 모드: 계정과 진행 상황은 이 브라우저에만 저장돼요. 다른 사이트에서 쓰는 비밀번호는 사용하지 마세요.${Accounts.all().length ? '' : ' <b class="gold">첫 번째 계정에는 관리자 권한이 주어져요.</b>'}`;
      G.ui.hydrateIcons(n);
    },

    _resetForms() {
      if (!this.el) return;
      for (const f of this.el.querySelectorAll('form[data-form]')) {
        const remember = f.querySelector('[name=remember]');
        f.reset();
        if (remember) remember.checked = true;
        f._touched?.clear();
        for (const fl of f.querySelectorAll('.field')) this._setError(f, fl.dataset.field, '');
        this._formError(f, '');
        const ok = f.querySelector('.hint.ok'); if (ok) ok.hidden = true;
        this._updatePwUi(f);
        for (const i of f.querySelectorAll('input[type=text][name=password], .pw-wrap input')) i.type = 'password';
        for (const b of f.querySelectorAll('.pw-eye')) { b.innerHTML = EYE_SVG; b.setAttribute('aria-pressed', 'false'); b.setAttribute('aria-label', '비밀번호 보기'); }
      }
      this._setBusy(false);
    },

    _toggleEye(b) {
      const input = b.closest('.pw-wrap')?.querySelector('input');
      if (!input) return;
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      b.innerHTML = show ? EYE_OFF_SVG : EYE_SVG;
      b.setAttribute('aria-pressed', show ? 'true' : 'false');
      b.setAttribute('aria-label', show ? '비밀번호 숨기기' : '비밀번호 보기');
      // keep the confirm field in sync on the register form
      const c = b.closest('form')?.querySelector('[name=confirm]');
      if (c) c.type = input.type;
    },

    _bindForm(form) {
      const kind = form.dataset.form;
      form._touched = new Set();
      const checkNick = U.debounce(() => this._nickStatus(form), 260);
      form.addEventListener('input', (e) => {
        const n = e.target.name;
        if (!n) return;
        this._formError(form, '');
        if (n === 'password') this._updatePwUi(form);
        if (form._touched.has(n) || (n === 'agree' && e.target.checked)) this._validateField(form, n);
        if (n === 'password' && form._touched.has('confirm')) this._validateField(form, 'confirm');
        if (kind === 'register' && n === 'nickname') checkNick();
      });
      form.addEventListener('focusout', (e) => {
        const n = e.target.name;
        if (!n || n === 'agree' || n === 'remember') return;
        if (e.target.value) { form._touched.add(n); this._validateField(form, n); }
      });
      const caps = (e) => {
        if (typeof e.getModifierState !== 'function') return;
        const on = e.getModifierState('CapsLock');
        const field = e.target.closest('.field');
        const hint = field?.querySelector('.hint.caps');
        if (hint) hint.hidden = !on || !/password|confirm/.test(e.target.name || '');
      };
      form.addEventListener('keydown', caps);
      form.addEventListener('keyup', caps);
      form.addEventListener('submit', (e) => { e.preventDefault(); this._submit(form); });
    },

    _nickStatus(form) {
      const input = form.querySelector('[name=nickname]');
      const hint = form.querySelector('[data-field=nickname] .hint.ok');
      if (!input || !hint) return;
      const v = input.value.trim();
      const err = v ? V.nickname(v, { account: true, checkTaken: !isServer() }) : '';
      if (v && !err) { hint.textContent = isServer() ? '✓ 사용할 수 있는 형식이에요' : '✓ 사용할 수 있는 닉네임이에요'; hint.hidden = false; this._setError(form, 'nickname', ''); }
      else {
        hint.hidden = true;
        if (v && (form._touched.has('nickname') || Array.from(v).length >= 2)) { form._touched.add('nickname'); this._setError(form, 'nickname', err); }
      }
    },

    _updatePwUi(form) {
      const pw = form.querySelector('[name=password]')?.value || '';
      const meter = form.querySelector('.pw-strength');
      if (meter) {
        const s = strength(pw);
        meter.dataset.level = pw ? String(s) : '';
        meter.querySelector('i').style.width = pw ? `${(s + 1) * 20}%` : '0%';
        meter.querySelector('.pw-label').textContent = pw ? `강도: ${STRENGTH[s]}` : '비밀번호 강도';
      }
      const rules = { len: pw.length >= 8, alpha: /[A-Za-z]/.test(pw), digit: /[0-9]/.test(pw) };
      for (const li of form.querySelectorAll('.pw-rules [data-rule]')) li.classList.toggle('ok', !!rules[li.dataset.rule]);
    },

    _value(form, name) {
      const el = form.querySelector(`[name="${name}"]`);
      if (!el) return '';
      return el.type === 'checkbox' ? el.checked : el.value;
    },

    _fieldError(form, name) {
      const kind = form.dataset.form;
      const v = this._value(form, name);
      if (kind === 'login') {
        if (name === 'login') return String(v).trim() ? '' : '아이디(닉네임) 또는 이메일을 입력해 주세요.';
        if (name === 'password') return v ? '' : '비밀번호를 입력해 주세요.';
        return '';
      }
      switch (name) {
        case 'email': return V.email(v);
        case 'nickname': return V.nickname(v, { account: true, checkTaken: !isServer() });
        case 'password': return V.password(v);
        case 'confirm': return V.confirm(this._value(form, 'password'), v);
        case 'agree': return v ? '' : '이용약관 및 개인정보 처리 안내에 동의해 주세요.';
        default: return '';
      }
    },

    _validateField(form, name) {
      const err = this._fieldError(form, name);
      this._setError(form, name, err);
      if (name === 'nickname' && err) { const ok = form.querySelector('.hint.ok'); if (ok) ok.hidden = true; }
      return !err;
    },

    _setError(form, name, msg) {
      const field = form.querySelector(`[data-field="${name}"]`);
      if (!field) return;
      const box = field.querySelector('.error');
      if (box) box.textContent = msg || '';
      field.classList.toggle('invalid', !!msg);
      const input = field.querySelector('input');
      if (input) { if (msg) input.setAttribute('aria-invalid', 'true'); else input.removeAttribute('aria-invalid'); }
    },

    _formError(form, msg) {
      const box = form.querySelector('.form-error');
      if (!box) return;
      box.textContent = msg || '';
      box.hidden = !msg;
    },

    _shake() {
      const c = this.el?.querySelector('.ts-card');
      if (!c || G.settings.reduceMotion) return;
      c.classList.remove('shake'); void c.offsetWidth; c.classList.add('shake');
    },

    async _submit(form) {
      if (this.busy || app._entering) return;
      const kind = form.dataset.form;
      const names = kind === 'login' ? ['login', 'password'] : ['email', 'nickname', 'password', 'confirm', 'agree'];
      let first = null;
      for (const n of names) { form._touched.add(n); if (!this._validateField(form, n) && !first) first = n; }
      this._formError(form, '');
      if (first) {
        this._shake();
        G.sfx('error');
        form.querySelector(`[name="${first}"]`)?.focus();
        return;
      }
      const btn = form.querySelector('.ts-submit');
      this._setBusy(true, btn);
      let profile = null;
      try {
        if (kind === 'login') {
          profile = await auth.login({ login: this._value(form, 'login'), password: this._value(form, 'password'), remember: !!this._value(form, 'remember') });
        } else {
          profile = await auth.register({
            email: this._value(form, 'email'), nickname: this._value(form, 'nickname'), password: this._value(form, 'password'),
            confirm: this._value(form, 'confirm'), agree: !!this._value(form, 'agree'), remember: true,
          });
        }
      } catch (e) {
        this._setBusy(false, btn);
        const ae = e instanceof AuthError ? e : null;
        if (!ae) G.log.error('AUTH', `${kind} failed`, e);
        const msg = ae ? ae.message : '알 수 없는 문제로 처리하지 못했어요. 잠시 후 다시 시도해 주세요.';
        if (ae?.field && form.querySelector(`[data-field="${ae.field}"]`)) {
          this._setError(form, ae.field, msg);
          form.querySelector(`[name="${ae.field}"]`)?.focus();
          if (ae.field === 'password' && kind === 'login') { const pw = form.querySelector('[name=password]'); if (pw) { pw.value = ''; } }
        } else this._formError(form, msg);
        this._shake();
        G.sfx('error');
        return;
      }
      if (kind === 'register') {
        G.ui.toast(`회원가입을 축하해요, ${profile.nickname}님!`, { type: 'success', emoji: '🎉' });
        if (profile.firstAdmin) setTimeout(() => G.ui.toast('첫 번째 계정이라 관리자 권한이 주어졌어요. 메뉴에서 관리자 대시보드를 볼 수 있어요.', { type: 'info', emoji: '🛡️', duration: 5200 }), 900);
      }
      try { await app.enterGame(profile); } finally { this._setBusy(false, btn); }
    },
  };

  // ================================================================ onboarding (coach marks for new players)
  const STEP_COUNT = 4;
  const Onboarding = {
    active: false,
    step: -1,         // 0 move · 1 look · 2 marker · 3 talk · 4 final card
    layer: null, coach: null, ring: null, final: null,
    _t: 0, _start: new THREE.Vector3(), _drag: 0, _drag0: null, _talkSeen: 0, _key: '', _hidden: true,
    _waitDialogue: false, _finalTimer: 0, _offEsc: null,

    init() {
      const layer = h('div', { class: 'coach-layer', 'aria-live': 'polite' });
      const coach = h('div', { class: 'coach', role: 'status', hidden: true });
      const ring = h('div', { class: 'coach-ring', hidden: true, 'aria-hidden': 'true' });
      layer.append(ring, coach);
      ($('#app') || document.body).appendChild(layer);
      this.layer = layer; this.coach = coach; this.ring = ring;
      coach.addEventListener('click', (e) => { if (e.target.closest('[data-c=skip]')) this.skip(); });
      // camera drag detection (step 'look')
      const gc = $('#game-container');
      if (gc) {
        gc.addEventListener('pointerdown', (e) => { if (this.active && this.step === 1) this._drag0 = { id: e.pointerId, x: e.clientX, y: e.clientY }; }, { passive: true });
        gc.addEventListener('pointermove', (e) => {
          const d = this._drag0;
          if (!d || d.id !== e.pointerId || !this.active || this.step !== 1) return;
          this._drag += Math.abs(e.clientX - d.x) + Math.abs(e.clientY - d.y);
          d.x = e.clientX; d.y = e.clientY;
        }, { passive: true });
        const up = (e) => { if (this._drag0 && this._drag0.id === e.pointerId) this._drag0 = null; };
        gc.addEventListener('pointerup', up, { passive: true });
        gc.addEventListener('pointercancel', up, { passive: true });
      }
      G.bus.on('npc:talk', ({ npcId } = {}) => {
        if (!this.active || npcId !== 'NPC001' || this.step >= 4) return;
        this._waitDialogue = true;
        this._go(4, { silent: true });
      });
      G.bus.on('dialogue:end', () => { if (this.active && this.step === 4 && this._waitDialogue) this._queueFinal(700); });
    },

    /** decide whether to run the tutorial for this freshly loaded state */
    sync(state, isNew) {
      this.stop();
      if (!state) return;
      const t = state.tutorial || (state.tutorial = { step: 0, done: false });
      if (G.flags.noTutorial || t.done) return;
      if (!isNew && !(Number(t.step) > 0)) return; // existing saves from before onboarding existed
      // already talked to the master (e.g. imported save): only the final card is left
      const q = G.state?.quests?.QUEST001;
      const talked = !!(state.npcsTalked?.NPC001) || (q && (q.status === 'completed' || q.status === 'claimed' || (q.progress?.[0] || 0) >= 1));
      this.start(talked ? 4 : U.clamp(Math.floor(Number(t.step) || 0), 0, 4));
    },

    start(step = 0) {
      if (!G.state) return;
      this.active = true;
      const t = G.state.tutorial || (G.state.tutorial = { step: 0, done: false });
      if (!t.startedAt) t.startedAt = G.time.now();
      t.done = false;
      this._go(step, { silent: true });
      G.log.info('UI', `onboarding start at step ${step}`);
    },

    stop() {
      this.active = false;
      this.step = -1;
      this._waitDialogue = false;
      clearTimeout(this._finalTimer);
      this._hideFinal();
      if (this.coach) this.coach.hidden = true;
      if (this.ring) this.ring.hidden = true;
      this._key = '';
      G.sys.quest?.suspendHint?.(false);
    },

    skip() {
      if (!this.active) return;
      const t = G.state?.tutorial;
      if (t) { t.done = true; t.skipped = true; t.doneAt = G.time.now(); G.dirty('tutorial'); }
      this.stop();
      G.sfx('close');
      G.ui.toast('튜토리얼을 건너뛰었어요. 조작법은 언제든 H 키(도움말)로 볼 수 있어요.', { type: 'info', emoji: '💡' });
    },

    _go(step, opts = {}) {
      const prev = this.step;
      this.step = step;
      this._t = 0;
      this._drag = 0;
      this._drag0 = null;
      this._talkSeen = 0;
      this._key = '';
      if (step === 0 && G.sys.player?.position) this._start.copy(G.sys.player.position);
      const t = G.state?.tutorial;
      if (t && step <= 4 && Number(t.step || 0) !== step) { t.step = step; G.dirty('tutorial'); }
      if (!opts.silent && step > prev) G.sfx('correct');
      if (step === 4 && !this._waitDialogue) this._queueFinal(500);
    },

    _queueFinal(ms) {
      clearTimeout(this._finalTimer);
      this._finalTimer = setTimeout(() => this._showFinal(), ms);
    },

    _blocked() {
      return !G.state || !app.loggedIn || document.body.classList.contains('hud-hidden') || $('#hud')?.hidden || G.ui.modal.isOpen() || !!G.sys.dialogue?.active || !!this.final;
    },

    update(dt) {
      if (!this.active || this.step < 0) return;
      this._t += dt;
      const hidden = this._blocked();
      const p = G.sys.player?.position;
      if (!hidden) {
        if (this.step === 0 && p) {
          const dx = p.x - this._start.x, dz = p.z - this._start.z;
          if (dx * dx + dz * dz > 3.2) this._go(1);
        } else if (this.step === 1) {
          if (this._drag > 140) this._go(2);
        } else if (this.step === 2 || this.step === 3) {
          const near = this._npcPromptVisible();
          if (this.step === 2 && near) this._go(3, { silent: true });
          else if (this.step === 3) { this._talkSeen = near ? 0 : this._talkSeen + dt; if (this._talkSeen > 1.6) this._go(2, { silent: true }); }
        }
      }
      if (this.step >= 4) { this.coach.hidden = true; this.ring.hidden = true; return; }
      if (hidden !== this._hidden) { this._hidden = hidden; this.coach.hidden = hidden; if (hidden) this.ring.hidden = true; else this._key = ''; }
      if (hidden) return;
      this._render();
      this._posT = (this._posT || 0) - dt;
      if (this._posT <= 0) { this._posT = 0.12; this._position(); }
    },

    _npcPromptVisible() {
      const pr = $('#interact-prompt');
      if (!pr || pr.hidden) return false;
      const cur = G.interact?.current;
      return !cur || cur.id === 'NPC001' || cur.kind === 'npc';
    },

    _content() {
      const touch = touchUI();
      switch (this.step) {
        case 0: return {
          title: '이동하기',
          text: touch ? '왼쪽 조이스틱을 밀어 이동해 보세요' : 'W A S D 키로 이동해 보세요',
          sub: touch ? '조이스틱을 끝까지 밀면 달릴 수 있어요.' : '방향키도 돼요. Shift를 누른 채 움직이면 달려요.',
          visual: touch ? `<div class="cv cv-joy"><i></i></div>` : `<div class="cv cv-keys"><kbd class="k-w">W</kbd><kbd class="k-a">A</kbd><kbd class="k-s">S</kbd><kbd class="k-d">D</kbd></div>`,
          anchor: touch ? '#joystick' : null, place: touch ? 'top' : 'center',
        };
        case 1: return {
          title: '둘러보기',
          text: touch ? '화면을 손가락으로 끌어 시점을 돌려 보세요' : '마우스를 끌어 시점을 돌려 보세요',
          sub: touch ? '두 손가락으로 벌리거나 오므리면 확대·축소돼요.' : '왼쪽 버튼을 누른 채 끌어요. 휠로 확대·축소할 수 있어요.',
          visual: touch ? `<div class="cv cv-drag"><span class="emoji">👆</span></div>` : `<div class="cv cv-mouse"><svg viewBox="0 0 40 56" aria-hidden="true"><rect x="6" y="4" width="28" height="44" rx="14" fill="none" stroke="currentColor" stroke-width="3"/><path d="M20 4v16M6 20h28" stroke="currentColor" stroke-width="3"/><path d="M6 20V18a14 14 0 0 1 14-14v16z" fill="#f4c54a"/></svg><i class="arr l">‹</i><i class="arr r">›</i></div>`,
          anchor: null, place: 'center',
        };
        case 2: return {
          title: '목표 찾기',
          text: '금빛 표식을 따라 발효마스터를 찾아가세요',
          sub: '화면 위 목표 안내의 화살표와 미니맵의 금빛 표시가 길을 알려 줘요.',
          visual: `<div class="cv cv-marker"><svg viewBox="0 0 40 48" aria-hidden="true"><path d="M20 2 34 18 20 34 6 18z" fill="#f4c54a" stroke="#fff3c4" stroke-width="2"/><path d="M20 36v10" stroke="#f4c54a" stroke-width="3" stroke-linecap="round" opacity=".7"/></svg></div>`,
          anchor: '#objective-hint', place: 'bottom',
        };
        case 3: return {
          title: '상호작용',
          text: touch ? 'E 버튼을 눌러 발효마스터와 대화해 보세요' : 'E 키를 눌러 발효마스터와 대화해 보세요',
          sub: '물 주기·장독 확인·안내판 보기도 모두 E 키로 해요. 대상을 클릭해도 돼요.',
          visual: `<div class="cv cv-e"><kbd>E</kbd></div>`,
          anchor: touch ? '.mb-interact' : '#interact-prompt', place: 'top',
        };
        default: return null;
      }
    },

    _render() {
      const c = this._content();
      if (!c) return;
      const key = `${this.step}|${touchUI()}`;
      if (key === this._key) return;
      this._key = key;
      const dots = Array.from({ length: STEP_COUNT }, (_, i) => `<i class="${i < this.step ? 'done' : i === this.step ? 'on' : ''}"></i>`).join('');
      this.coach.innerHTML = `
        <div class="coach-head"><span class="coach-step">${this.step + 1} / ${STEP_COUNT}</span><span class="coach-title">${esc(c.title)}</span>
          <button type="button" class="coach-skip" data-c="skip">튜토리얼 건너뛰기</button></div>
        <div class="coach-body">${c.visual}<div class="coach-text"><b>${esc(c.text)}</b><small>${esc(c.sub)}</small></div></div>
        <div class="coach-dots" aria-hidden="true">${dots}</div>
        <span class="coach-arrow" aria-hidden="true"></span>`;
      this.coach.classList.remove('pop'); void this.coach.offsetWidth; this.coach.classList.add('pop');
      this._anchor = c.anchor; this._place = c.place;
      this._position();
    },

    _position() {
      const co = this.coach;
      if (!co || co.hidden) return;
      const W = innerWidth, H = innerHeight;
      const cw = co.offsetWidth || 320, ch = co.offsetHeight || 120;
      let place = this._place, r = null;
      if (this._anchor) {
        const a = $(this._anchor);
        if (a && !a.hidden && a.offsetParent !== null) { const rr = a.getBoundingClientRect(); if (rr.width > 2 && rr.height > 2) r = rr; }
      }
      if (!r && place !== 'center') place = 'center';
      let x, y, ax = 0.5;
      if (place === 'center') { x = (W - cw) / 2; y = Math.max(H * 0.17, 92); }
      else {
        const cx = r.left + r.width / 2;
        x = U.clamp(cx - cw / 2, 12, W - cw - 12);
        y = place === 'bottom' ? r.bottom + 16 : r.top - ch - 16;
        y = U.clamp(y, 8, H - ch - 8);
        ax = U.clamp((cx - x) / cw, 0.08, 0.92);
      }
      co.dataset.place = place;
      co.style.setProperty('--ax', `${(ax * 100).toFixed(1)}%`);
      co.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
      // spotlight ring around the anchor
      const ring = this.ring;
      if (r && place !== 'center') {
        const pad = 6;
        ring.hidden = false;
        ring.style.transform = `translate(${Math.round(r.left - pad)}px, ${Math.round(r.top - pad)}px)`;
        ring.style.width = `${Math.round(r.width + pad * 2)}px`;
        ring.style.height = `${Math.round(r.height + pad * 2)}px`;
        ring.classList.toggle('round', this._anchor === '#joystick' || this._anchor === '.mb-interact');
      } else ring.hidden = true;
    },

    _showFinal() {
      if (!this.active || this.final) return;
      if (!G.state || !app.loggedIn) return;
      if (G.ui.modal.isOpen() || G.sys.dialogue?.active || document.body.classList.contains('hud-hidden')) { this._queueFinal(800); return; }
      this.coach.hidden = true; this.ring.hidden = true;
      const touch = touchUI();
      const items = [
        { sel: '#quest-panel', icon: '📜', title: '퀘스트 패널', key: 'Q', text: '지금 할 일과 보상을 보여 줘요. 목표를 다 채우면 ‘보상 받기’를 눌러요.' },
        { sel: '#minimap-panel', icon: '🗺️', title: '미니맵', key: 'M', text: '내 위치와 금빛 목표 표시가 보여요. 누르면 전체 지도와 빠른 이동을 열 수 있어요.' },
        { sel: '#bottom-bar [data-action=journal]', icon: '📋', title: '작업일지', key: 'J', text: '오늘 한 체험과 배운 점을 기록하면 퀘스트와 업적이 진행돼요.' },
      ];
      const wrap = h('div', { class: 'coach-final-wrap' });
      const rings = [];
      items.forEach((it, i) => {
        const a = $(it.sel);
        if (!a || a.offsetParent === null) return;
        const r = a.getBoundingClientRect();
        if (r.width < 4 || r.height < 4) return;
        const pad = 5;
        const ring = h('div', { class: 'coach-hl', style: { left: `${r.left - pad}px`, top: `${r.top - pad}px`, width: `${r.width + pad * 2}px`, height: `${r.height + pad * 2}px` } }, h('span', { class: 'coach-hl-num' }, String(i + 1)));
        rings.push(ring);
      });
      const card = h('div', { class: 'coach-final glass', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'coach-final-title' });
      card.innerHTML = `
        <div class="cf-eyebrow">TUTORIAL CLEAR</div>
        <h2 id="coach-final-title">준비 완료! 이제 마음껏 체험해 보세요</h2>
        <p class="dim">처음 체험에 필요한 것만 짧게 알려 드릴게요.</p>
        <ol class="cf-list">${items.map((it, i) => `<li><span class="cf-num">${i + 1}</span><span class="emoji cf-ico">${it.icon}</span><div><b>${esc(it.title)}${touch ? '' : ` <kbd>${it.key}</kbd>`}</b><small>${esc(it.text)}</small></div></li>`).join('')}</ol>
        <p class="cf-tip">${touch ? '메뉴 버튼에서 설정·도움말을 열 수 있어요.' : '<kbd>Esc</kbd> 메뉴 · <kbd>H</kbd> 도움말 · <kbd>E</kbd> 상호작용'}</p>
        <button type="button" class="btn btn-gold btn-lg btn-block cf-go">체험 시작하기 ${ico('chevron-right')}</button>`;
      G.ui.hydrateIcons(card);
      wrap.append(...rings, card);
      this.layer.appendChild(wrap);
      this.final = wrap;
      G.ui.block('tutorial');
      G.sfx('reward');
      const btn = card.querySelector('.cf-go');
      btn.addEventListener('click', () => this._finish());
      this._offEsc = G.ui.onEscape(() => { if (!this.final) return false; this._finish(); return true; }, 95);
      setTimeout(() => { if (this.final && !touchUI()) btn.focus(); }, 60);
    },

    _hideFinal() {
      if (this._offEsc) { this._offEsc(); this._offEsc = null; }
      if (this.final) {
        const f = this.final;
        this.final = null;
        f.classList.add('out');
        setTimeout(() => f.remove(), 260);
        G.ui.unblock('tutorial');
      }
    },

    _finish() {
      const t = G.state?.tutorial;
      if (t) { t.done = true; t.step = 5; t.doneAt = G.time.now(); G.dirty('tutorial'); }
      this._hideFinal();
      this.stop();
      G.sfx('quest');
      G.ui.banner('퀘스트 패널의 현재 목표를 따라가면 핵심 체험을 모두 해 볼 수 있어요!', { icon: 'sparkle', duration: 5200 });
      G.log.info('UI', 'onboarding done');
    },
  };

  // ================================================================ shared modal helpers
  function settingRow(label, desc, control, extraCls = '') {
    return h('div', { class: `set-row ${extraCls}` },
      h('div', { class: 'set-label' }, h('b', null, label), desc ? h('small', null, desc) : null),
      h('div', { class: 'set-ctl' }, control));
  }
  function sliderCtl(key, o = {}) {
    const min = o.min ?? 0, max = o.max ?? 1, step = o.step ?? 0.05;
    const val = Number(G.settings[key] ?? G.settingsDefaults?.[key] ?? min);
    const show = o.fmt || ((v) => `${Math.round(v * 100)}%`);
    const out = h('output', { class: 'set-val' }, show(val));
    const input = h('input', { type: 'range', min, max, step, 'aria-label': o.label || key });
    input.value = String(val);
    const paint = () => { const k = (Number(input.value) - min) / (max - min || 1); input.style.setProperty('--fill', `${(k * 100).toFixed(1)}%`); out.textContent = show(Number(input.value)); };
    paint();
    const apply = () => { paint(); G.setSetting(key, Number(input.value)); o.after?.(Number(input.value)); };
    if (o.live === false) { input.addEventListener('input', paint); input.addEventListener('change', apply); }
    else input.addEventListener('input', apply);
    return h('div', { class: 'set-slider' }, input, out);
  }
  function switchCtl(key, o = {}) {
    const input = h('input', { type: 'checkbox', role: 'switch', 'aria-label': o.label || key });
    input.checked = o.invert ? !G.settings[key] : !!G.settings[key];
    input.addEventListener('change', () => { const v = o.invert ? !input.checked : input.checked; G.setSetting(key, v); o.after?.(v); });
    return h('label', { class: 'app-switch' }, input, h('span', { class: 'sw-track', 'aria-hidden': 'true' }, h('span', { class: 'sw-thumb' })));
  }
  function segCtl(key, options, o = {}) {
    const seg = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': o.label || key });
    const cur = String(G.settings[key]);
    for (const opt of options) {
      const b = h('button', { type: 'button', role: 'radio', 'aria-checked': String(String(opt.v) === cur), class: String(opt.v) === cur ? 'active' : '' }, opt.l);
      b.addEventListener('click', () => {
        for (const x of seg.children) { x.classList.remove('active'); x.setAttribute('aria-checked', 'false'); }
        b.classList.add('active'); b.setAttribute('aria-checked', 'true');
        G.setSetting(key, opt.v);
        o.after?.(opt.v);
      });
      seg.appendChild(b);
    }
    return seg;
  }

  // ================================================================ main menu
  function isAdmin() { return auth.current?.role === 'admin' || G.state?.profile?.role === 'admin'; }
  function canDebug() { return !!(G.flags.debug || isAdmin()); }
  function canDashboard() { return isAdmin() || !isServer(); }
  function lastSavedText() {
    const t = G.save.lastSavedAt || G.state?.savedAt || 0;
    return t ? `마지막 저장 ${ago(t)}` : '아직 저장 전이에요';
  }

  function openMenu() {
    if (!app.loggedIn || !G.state) return null;
    const ex = G.ui.modal.get('app-menu');
    if (ex) { ex.close(); return null; }
    if (G.sys.photo?.active) return null;
    const st = G.state, s = st.stats || {}, p = st.profile || {};
    const tiles = [
      { act: 'resume', icon: 'chevron-right', label: '계속하기', desc: '게임으로 돌아가기', key: 'Esc', cls: 'tile-primary' },
      { act: 'profile', icon: 'user', label: '내 정보', desc: '레벨·칭호·체험 기록', tint: '#9b8cff' },
      { act: 'avatar', icon: 'smile', label: '아바타 꾸미기', desc: '옷차림·헤어·닉네임', tint: '#ff9fc7' },
      { act: 'collection', icon: 'collection', label: '도감', desc: '모은 작물·발효식품·도구', key: 'C', tint: '#6fe0d2' },
      { act: 'achievements', icon: 'trophy', label: '업적', desc: '달성한 도전 과제', tint: '#ffd766' },
      { act: 'settings', icon: 'settings', label: '설정', desc: '소리·그래픽·조작·접근성', tint: '#c9d3c6' },
      { act: 'help', icon: 'help', label: '도움말', desc: '조작법·게임 방법·구역', key: 'H', tint: '#7fc4ff' },
      { act: 'save', icon: 'save', label: '저장하기', desc: lastSavedText(), tint: '#86e3a8' },
    ];
    if (canDashboard()) tiles.push({ act: 'admin', icon: 'chart', label: '관리자 대시보드', desc: isAdmin() ? '체험 통계·활동·계정' : '내 체험 통계 (로컬)', tint: '#ffb26b' });
    if (canDebug()) tiles.push({ act: 'debug', icon: 'bug', label: '디버그 패널', desc: '테스트·점검 도구', key: 'F9', tint: '#ff8f8f' });
    tiles.push({ act: 'logout', icon: 'logout', label: '로그아웃', desc: '저장하고 처음 화면으로', cls: 'tile-danger' });

    const m = G.ui.modal.open({
      id: 'app-menu', title: '메뉴', icon: 'menu', size: 'md', className: 'app-menu-modal',
      body: (body) => {
        const lv = Number(s.level) || 1;
        const portrait = Portrait.url ? ` style="background-image:url('${Portrait.url}')"` : '';
        body.innerHTML = `
          <div class="mm-head">
            <div class="mm-ava${Portrait.url ? ' has-img' : ''}"${portrait}>${Portrait.url ? '' : initialOf(p.nickname)}</div>
            <div class="mm-id">
              <div class="mm-row"><span class="lv-chip">Lv.${lv}</span><b class="mm-nick">${esc(p.nickname || '')}</b>${p.title ? `<span class="title-chip">${esc(p.title)}</span>` : ''}</div>
              <div class="mm-row mm-sub"><span>${ico('coin', 'ico-sm')}${fmt(s.coin || 0)}</span><span>${ico('book', 'ico-sm')}${fmt(s.edu || 0)}</span>
                <span class="mode-chip${G.save.adapter?.name === 'server' ? ' server' : ''}">${G.save.adapter?.name === 'server' ? '서버 저장' : '로컬 저장'}</span>
                <span class="chip">${esc(kindLabel(auth.current?.kind))}</span>${isAdmin() ? '<span class="chip chip-gold">관리자</span>' : ''}</div>
            </div>
          </div>
          <div class="mm-grid">${tiles.map((t) => `<button type="button" class="mm-tile ${t.cls || ''}" data-mm="${t.act}"${t.tint ? ` style="--tint:${t.tint}"` : ''}>
              <span class="mm-ico">${ico(t.icon)}</span><span class="mm-txt"><b>${esc(t.label)}</b><small>${esc(t.desc)}</small></span>${t.key && !touchUI() ? `<kbd>${t.key}</kbd>` : ''}</button>`).join('')}</div>
          <p class="mm-foot tiny muted">전통발효체험관 메타버스 v${esc(G.VERSION)} · ${isServer() ? '서버 모드' : '로컬 모드'}</p>`;
        G.ui.hydrateIcons(body);
        body.addEventListener('click', async (e) => {
          const b = e.target.closest('[data-mm]');
          if (!b) return;
          const act = b.dataset.mm;
          if (act === 'save') {
            b.disabled = true;
            const ok = await saveNow('manual', true);
            b.disabled = false;
            const sm = b.querySelector('small');
            if (sm) sm.textContent = ok ? lastSavedText() : '저장하지 못했어요';
            return;
          }
          if (act === 'logout') { m.close(); app.logout({ confirm: true }); return; }
          m.close();
          menuAction(act);
        });
      },
      onClose: () => G.ui.setActive('menu', false),
    });
    G.ui.setActive('menu', true);
    return m;
  }

  function menuAction(act) {
    const P = G.sys.progression;
    switch (act) {
      case 'resume': return;
      case 'profile': if (P?.openProfile) P.openProfile(); else G.ui.toast('프로필 기능을 불러오지 못했어요.', { type: 'warn' }); return;
      case 'avatar': openAvatar(); return;
      case 'collection': if (P?.openCollection) P.openCollection(); else G.ui.toast('도감 기능을 불러오지 못했어요.', { type: 'warn' }); return;
      case 'achievements': if (P?.openAchievements) P.openAchievements(); else G.ui.toast('업적 기능을 불러오지 못했어요.', { type: 'warn' }); return;
      case 'settings': openSettings(); return;
      case 'help': openHelp(); return;
      case 'admin': openAdmin(); return;
      case 'debug': Debug.toggle(); return;
      default:
    }
  }

  async function saveNow(reason = 'manual', notify = false) {
    if (!G.state || !G.save.profile) return false;
    await waitUntil(() => !G.save.saving, 4000);
    return G.save.save({ reason, notify });
  }

  // ================================================================ settings
  function openSettings(tab = 'sound') {
    const ex = G.ui.modal.get('app-settings');
    if (ex) ex.close();
    let current = tab;
    const m = G.ui.modal.open({
      id: 'app-settings', title: '설정', icon: 'settings', size: 'lg', className: 'app-settings-modal',
      body: (body) => {
        const tabsEl = h('div', { class: 'set-tabs' });
        const pane = h('div', { class: 'set-pane' });
        body.append(tabsEl, pane);
        const render = (id) => {
          current = id;
          pane.innerHTML = '';
          pane.dataset.tab = id;
          try { pane.appendChild(SETTINGS_PANES[id]()); } catch (e) { G.log.error('UI', 'settings pane failed', e); pane.textContent = '설정을 표시하지 못했어요.'; }
          G.ui.hydrateIcons(pane);
        };
        m._renderPane = () => render(current);
        G.ui.tabs(tabsEl, [
          { id: 'sound', label: '소리', icon: '🔊' }, { id: 'graphics', label: '그래픽', icon: '🖥️' }, { id: 'controls', label: '조작', icon: '🎮' },
          { id: 'access', label: '접근성', icon: '🧏' }, { id: 'data', label: '데이터', icon: '💾' },
        ], render, SETTINGS_PANES[tab] ? tab : 'sound');
      },
      actions: [
        {
          label: '이 탭 기본값으로', class: 'btn-ghost', icon: 'refresh', onClick: () => {
            const keys = SETTINGS_KEYS[current] || [];
            for (const k of keys) if (k in (G.settingsDefaults || {})) G.setSetting(k, G.settingsDefaults[k]);
            m._renderPane?.();
            if (keys.length) G.ui.toast('기본값으로 되돌렸어요.', { type: 'info', sound: false });
            return false;
          },
        },
        { label: '닫기', class: 'btn-primary' },
      ],
    });
    return m;
  }
  const SETTINGS_KEYS = {
    sound: ['volumeMaster', 'volumeMusic', 'volumeSfx', 'volumeAmbient', 'muted'],
    graphics: ['quality', 'shadows', 'bloom', 'showFps'],
    controls: ['sensitivity', 'invertY', 'clickToMove', 'cameraShake'],
    access: ['uiScale', 'highContrast', 'largeText', 'reduceMotion', 'voiceOver'],
    data: [],
  };
  const sfxPreview = U.throttle(() => G.sfx('click'), 160);
  const SETTINGS_PANES = {
    sound() {
      const f = document.createDocumentFragment();
      f.append(
        settingRow('전체 볼륨', '게임의 모든 소리', sliderCtl('volumeMaster', { label: '전체 볼륨', after: sfxPreview })),
        settingRow('배경음악', '가야금 느낌의 잔잔한 음악', sliderCtl('volumeMusic', { label: '배경음악' })),
        settingRow('효과음', '버튼·물 주기·수확 소리', sliderCtl('volumeSfx', { label: '효과음', after: sfxPreview })),
        settingRow('환경음', '바람·새·풀벌레·계곡 물소리', sliderCtl('volumeAmbient', { label: '환경음' })),
        settingRow('음소거', '모든 소리를 끕니다', switchCtl('muted', { label: '음소거' })),
        h('p', { class: 'set-note', html: `${ico('info', 'ico-sm')}브라우저 정책상 화면을 한 번 클릭하거나 키를 누른 뒤부터 소리가 나요.` }),
      );
      return f;
    },
    graphics() {
      const E = G.sys.engine;
      const f = document.createDocumentFragment();
      const curLabel = E?.preset?.label || E?.quality || '-';
      const qNote = h('small', { class: 'set-inline-note' }, `현재 적용: ${curLabel}${G.flags.quality ? ' (주소 설정 고정)' : ''}`);
      f.append(
        settingRow('그래픽 품질', '자동은 기기 성능과 프레임에 맞춰 조절해요', h('div', { class: 'col' },
          segCtl('quality', [{ v: 'auto', l: '자동' }, { v: 'low', l: '낮음' }, { v: 'medium', l: '중간' }, { v: 'high', l: '높음' }], {
            label: '그래픽 품질', after: () => setTimeout(() => { qNote.textContent = `현재 적용: ${G.sys.engine?.preset?.label || '-'} · 나무·풀 밀도는 새로고침 후 반영돼요`; }, 60),
          }), qNote)),
        settingRow('그림자', '끄면 프레임이 좋아져요 (낮음 품질에서는 항상 꺼짐)', switchCtl('shadows', { label: '그림자' })),
        settingRow('빛 번짐 (블룸)', '등불·햇빛이 은은하게 번져요 (높음 품질에서 적용)', switchCtl('bloom', { label: '블룸' })),
        settingRow('FPS 표시', '초당 프레임과 그리기 호출 수를 보여 줘요', switchCtl('showFps', { label: 'FPS 표시' })),
      );
      if (E?.renderer) {
        const info = E.renderer.info?.render;
        f.append(h('p', { class: 'set-note', html: `${ico('chart', 'ico-sm')}현재 ${Math.round(E.fps || 0)} FPS · 그리기 호출 ${fmt(info?.calls || 0)}회 · 삼각형 ${fmt(Math.round((info?.triangles || 0) / 1000))}천 개` }));
      }
      return f;
    },
    controls() {
      const f = document.createDocumentFragment();
      f.append(
        settingRow('시점 감도', '마우스·화면을 끌 때 시점이 도는 빠르기', sliderCtl('sensitivity', { min: 0.3, max: 2.5, step: 0.1, fmt: (v) => `${v.toFixed(1)}배`, label: '시점 감도' })),
        settingRow('Y축 반전', '위아래 시점 방향을 뒤집어요', switchCtl('invertY', { label: 'Y축 반전' })),
        settingRow('클릭해서 이동', '땅을 클릭하면 그곳까지 걸어가요', switchCtl('clickToMove', { label: '클릭해서 이동' })),
        settingRow('카메라 흔들림', '수확·효과 때 화면이 살짝 흔들려요', switchCtl('cameraShake', { label: '카메라 흔들림' })),
      );
      return f;
    },
    access() {
      const f = document.createDocumentFragment();
      const speakBtn = h('button', { type: 'button', class: 'btn btn-sm btn-soft' }, '들어보기');
      speakBtn.addEventListener('click', () => {
        if (G.sys.audio?.speak) G.sys.audio.speak('안녕하세요! 전통발효체험관에 오신 것을 환영합니다.');
        else if ('speechSynthesis' in window) { try { const u = new SpeechSynthesisUtterance('안녕하세요! 전통발효체험관에 오신 것을 환영합니다.'); u.lang = 'ko-KR'; speechSynthesis.cancel(); speechSynthesis.speak(u); } catch (e) { /* ignore */ } }
        else G.ui.toast('이 브라우저는 음성 읽기를 지원하지 않아요.', { type: 'warn' });
      });
      f.append(
        settingRow('UI 크기', '글자와 창 크기를 조절해요 (85%~130%)', sliderCtl('uiScale', { min: 0.85, max: 1.3, step: 0.05, live: false, label: 'UI 크기' })),
        settingRow('고대비', '창 배경을 더 어둡고 선명하게 해요', switchCtl('highContrast', { label: '고대비' })),
        settingRow('큰 글자', '본문 글자를 크게 키워요', switchCtl('largeText', { label: '큰 글자' })),
        settingRow('움직임 줄이기', '화면 효과와 애니메이션을 줄여요', switchCtl('reduceMotion', { label: '움직임 줄이기' })),
        settingRow('음성 읽어주기', 'NPC 대사를 소리 내어 읽어 줘요 (자막은 항상 표시)', h('div', { class: 'row' }, speakBtn, switchCtl('voiceOver', { label: '음성 읽어주기' }))),
      );
      return f;
    },
    data() {
      const f = document.createDocumentFragment();
      if (!G.state || !app.loggedIn) {
        f.append(h('div', { class: 'empty' }, '로그인한 뒤에 저장 데이터를 관리할 수 있어요.'));
        return f;
      }
      const server = G.save.adapter?.name === 'server';
      let size = 0;
      if (!server) { const raw = store.raw(`tfm.v1.save.${G.save.profile?.id}`); size = raw ? new Blob([raw]).size : 0; }
      const kv = h('dl', { class: 'kv set-kv' });
      kv.innerHTML = `<dt>프로필</dt><dd>${esc(G.state.profile?.nickname || '')} <span class="chip">${esc(kindLabel(auth.current?.kind))}</span></dd>
        <dt>저장 위치</dt><dd>${server ? '계정 서버 (자동 저장)' : '이 브라우저 (localStorage · 자동 저장)'}</dd>
        <dt>마지막 저장</dt><dd class="set-last">${esc(lastSavedText().replace('마지막 저장 ', ''))}</dd>
        ${server ? '' : `<dt>저장 크기</dt><dd>${bytesLabel(size)}</dd>`}`;
      const saveBtn = h('button', { type: 'button', class: 'btn btn-primary' }, h('span', { class: 'ico ico-sm', 'data-icon': 'save' }), '지금 저장');
      saveBtn.addEventListener('click', async () => {
        saveBtn.disabled = true;
        await saveNow('manual', true);
        saveBtn.disabled = false;
        const d = kv.querySelector('.set-last'); if (d) d.textContent = lastSavedText().replace('마지막 저장 ', '');
      });
      const exportBtn = h('button', { type: 'button', class: 'btn btn-soft' }, h('span', { class: 'ico ico-sm', 'data-icon': 'download' }), '내보내기 (.json)');
      exportBtn.addEventListener('click', () => {
        try {
          const nick = String(G.state.profile?.nickname || 'player').replace(/[^\w가-힣-]+/g, '_');
          download(`전통발효체험관_저장_${nick}_${stamp()}.json`, G.save.exportJSON());
          G.ui.toast('저장 파일을 내려받았어요.', { type: 'success', icon: 'download' });
        } catch (e) { G.log.error('SAVE', 'export failed', e); G.ui.toast('저장 파일을 만들지 못했어요.', { type: 'error' }); }
      });
      const file = h('input', { type: 'file', accept: '.json,application/json', hidden: true });
      const importBtn = h('button', { type: 'button', class: 'btn btn-soft' }, h('span', { class: 'ico ico-sm', 'data-icon': 'upload' }), '가져오기');
      importBtn.addEventListener('click', () => file.click());
      file.addEventListener('change', async () => {
        const fl = file.files?.[0];
        file.value = '';
        if (!fl) return;
        if (fl.size > 5 * 1024 * 1024) { G.ui.toast('파일이 너무 커요. 5MB 이하의 저장 파일만 가져올 수 있어요.', { type: 'error' }); return; }
        let text = '';
        try { text = await fl.text(); } catch (e) { G.ui.toast('파일을 읽지 못했어요.', { type: 'error' }); return; }
        let obj = null;
        try { obj = JSON.parse(text); } catch (e) { G.ui.toast('JSON 형식의 저장 파일이 아니에요.', { type: 'error' }); return; }
        if (!obj || obj.app !== 'tfm-metaverse' || !obj.state || typeof obj.state !== 'object') { G.ui.toast('전통발효체험관 저장 파일이 아니에요.', { type: 'error' }); return; }
        const st = obj.state;
        const when = obj.exportedAt ? Date.parse(obj.exportedAt) : 0;
        const info = `${esc(st.profile?.nickname || '알 수 없음')} · Lv.${Number(st.stats?.level) || 1} · 코인 ${fmt(st.stats?.coin || 0)}${when ? ` · ${U.formatDate(when, true)} 저장` : ''}`;
        const ok = await G.ui.confirm(`이 저장 파일로 지금의 진행 상황을 덮어쓸까요?<br><b>${info}</b><br><span class="small dim">닉네임과 계정 정보는 지금 계정 그대로 유지돼요.</span>`, { title: '저장 파일 가져오기', icon: 'upload', okText: '가져오기', danger: true, html: true });
        if (!ok) return;
        try {
          await G.save.importJSON(text);
          G.ui.modal.get('app-settings')?.close();
          Portrait.schedule(400);
        } catch (e) { G.log.error('SAVE', 'import failed', e); G.ui.toast(e?.message || '저장 파일을 가져오지 못했어요.', { type: 'error' }); }
      });
      const resetBtn = h('button', { type: 'button', class: 'btn btn-danger' }, h('span', { class: 'ico ico-sm', 'data-icon': 'trash' }), '진행 초기화');
      resetBtn.addEventListener('click', async () => {
        const ok = await G.ui.confirm('레벨·코인·가방·퀘스트·농장·장독·작업일지·사진 등 <b>모든 진행 상황</b>이 지워지고 처음부터 다시 시작해요.<br>이 작업은 되돌릴 수 없어요. 정말 초기화할까요?', { title: '진행 초기화', icon: 'trash', okText: '모두 지우고 초기화', danger: true, html: true });
        if (!ok) return;
        G.ui.modal.closeAll();
        try {
          await G.save.resetProgress();
          G.ui.toast('진행 상황을 초기화했어요. 처음부터 다시 시작해요!', { type: 'success', emoji: '🌱' });
          Portrait.schedule(400);
        } catch (e) { G.log.error('SAVE', 'reset failed', e); G.ui.toast('초기화하지 못했어요.', { type: 'error' }); }
      });
      f.append(
        h('div', { class: 'card set-card' }, kv),
        settingRow('지금 저장', '자동 저장은 변경 후 몇 초 안에, 그리고 30초마다 이루어져요', saveBtn),
        settingRow('저장 파일 내보내기', '진행 상황을 파일로 내려받아 백업하거나 다른 기기로 옮겨요', exportBtn),
        settingRow('저장 파일 가져오기', '내보낸 .json 파일로 진행 상황을 되살려요', h('div', null, importBtn, file)),
        settingRow('진행 초기화', '모든 기록을 지우고 처음부터 시작해요', resetBtn, 'danger-row'),
      );
      return f;
    },
  };

  // ================================================================ help / credits / terms
  const HELP_KB = [
    [['W', 'A', 'S', 'D'], '이동 (방향키도 돼요)'], [['Shift'], '누른 채 이동하면 달리기'], [['Space'], '점프'],
    [['E'], '상호작용 — 대화·물 주기·수확·장독 확인·안내판'], [['M'], '전체 지도'], [['Q'], '퀘스트 목록 (L도 가능)'],
    [['I'], '가방'], [['C'], '도감'], [['J'], '작업일지'], [['P'], '사진 모드'], [['Enter'], '채팅 입력'],
    [['T'], '이모지'], [['G'], '제스처'], [['H'], '도움말'], [['Esc'], '메뉴 열기 · 창 닫기'], [['F9'], '디버그 패널 (관리자·디버그 모드)'],
  ];
  const HELP_MOUSE = [
    ['🖱️', '왼쪽 버튼 끌기', '시점 돌리기'], ['🖲️', '휠 굴리기', '확대 · 축소'], ['📍', '땅 클릭', '그곳까지 걸어가기 (설정에서 끌 수 있어요)'],
    ['✨', '사물·NPC 클릭', '가까이 걸어가서 상호작용'], ['🎮', '오른쪽 아래 방향 패드', '버튼으로 이동 · 가운데 버튼은 상호작용'],
  ];
  const HELP_TOUCH = [
    ['🕹️', '왼쪽 조이스틱', '이동 (끝까지 밀면 달리기)'], ['👆', '화면 끌기', '시점 돌리기'], ['🤏', '두 손가락 벌리기·오므리기', '확대 · 축소'],
    ['Ⓔ', 'E 버튼', '상호작용'], ['⬆️', '점프 · 달리기 · 사진 버튼', '오른쪽 아래 버튼 묶음'],
  ];
  const HELP_LOOP = [
    ['🌱', '씨앗 심기', '전통작물 구역과 허브 구역의 빈 밭에 씨앗을 심어요.'],
    ['💧', '물 주기', '수분이 부족하면 성장이 느려지고 건강이 떨어져요.'],
    ['🧺', '수확하기', '성장률 100%가 되면 수확해서 가방에 담아요.'],
    ['🧱', '재료 만들기', '발효식품 구역 작업대에서 콩으로 메주를, 고추로 고춧가루를 만들어요.'],
    ['🏺', '장독 발효', '장독대의 내 장독에 재료를 넣고 발효를 시작해요. 환기·햇볕·닦기로 돌봐 주세요.'],
    ['✨', '완성·수령', '발효가 끝나면 품질에 따라 된장·간장 같은 발효식품을 받아요.'],
    ['📖', '배우기·퀴즈', '안내판과 키오스크에서 전통발효를 배우고 퀴즈로 확인해요.'],
    ['📋', '작업일지', '오늘 한 체험과 배운 점을 기록해요.'],
    ['🏅', '보상·성장', '퀘스트 보상으로 코인·경험치·칭호를 얻고 도감을 채워요.'],
  ];

  function openHelp(tab = 'controls') {
    const ex = G.ui.modal.get('app-help');
    if (ex) { ex.close(); return null; }
    return G.ui.modal.open({
      id: 'app-help', title: '도움말', icon: 'help', size: 'lg', className: 'app-help-modal',
      body: (body) => {
        const tabsEl = h('div');
        const pane = h('div', { class: 'help-pane' });
        body.append(tabsEl, pane);
        G.ui.tabs(tabsEl, [
          { id: 'controls', label: '조작법', icon: '⌨️' }, { id: 'loop', label: '게임 방법', icon: '🔄' },
          { id: 'zones', label: '구역 안내', icon: '🗺️' }, { id: 'faq', label: '자주 묻는 질문', icon: '💬' },
        ], (id) => { pane.innerHTML = ''; pane.appendChild(HELP_PANES[id]()); G.ui.hydrateIcons(pane); pane.scrollTop = 0; }, HELP_PANES[tab] ? tab : 'controls');
      },
      actions: [{ label: '닫기', class: 'btn-primary' }],
    });
  }
  const HELP_PANES = {
    controls() {
      const touch = touchUI();
      const kb = h('section', { class: 'help-sec' });
      kb.innerHTML = `<h3>${ico('keyboard', 'ico-sm')}키보드</h3><div class="keys-table">${HELP_KB.map(([keys, d]) => `<div class="kt-row"><span class="kt-keys">${keys.map((k) => `<kbd>${esc(k)}</kbd>`).join('')}</span><span class="kt-desc">${esc(d)}</span></div>`).join('')}</div>`;
      const mouse = h('section', { class: 'help-sec' });
      mouse.innerHTML = `<h3>🖱️ 마우스</h3><div class="keys-table">${HELP_MOUSE.map(([e, k, d]) => `<div class="kt-row"><span class="kt-keys"><span class="emoji">${e}</span>${esc(k)}</span><span class="kt-desc">${esc(d)}</span></div>`).join('')}</div>`;
      const tc = h('section', { class: 'help-sec' });
      tc.innerHTML = `<h3>📱 터치 (휴대폰·태블릿)</h3><div class="keys-table">${HELP_TOUCH.map(([e, k, d]) => `<div class="kt-row"><span class="kt-keys"><span class="emoji">${e}</span>${esc(k)}</span><span class="kt-desc">${esc(d)}</span></div>`).join('')}</div>`;
      const wrap = h('div', { class: `help-controls ${touch ? 'touch-first' : ''}` });
      if (touch) wrap.append(tc, kb, mouse); else wrap.append(kb, mouse, tc);
      return wrap;
    },
    loop() {
      const wrap = h('div', { class: 'help-loop' });
      wrap.innerHTML = `<p class="dim">농사로 재료를 키우고, 전통 방식으로 발효시키고, 배우고 기록하는 것이 체험관의 기본 흐름이에요.</p>
        <ol class="loop-steps">${HELP_LOOP.map(([e, t, d], i) => `<li><span class="ls-num">${i + 1}</span><span class="emoji ls-ico">${e}</span><div><b>${esc(t)}</b><small>${esc(d)}</small></div></li>`).join('')}</ol>
        <div class="notice-box">${esc(G.data.meta?.disclaimer || '')}</div>`;
      return wrap;
    },
    zones() {
      const wrap = h('div', { class: 'help-zones' });
      const canGo = app.loggedIn && !!G.sys.minimap?.travelTo;
      const visited = G.state?.visited || {};
      wrap.innerHTML = `<p class="dim">체험관은 9개 구역으로 나뉘어 있어요.${canGo ? ' ‘이동’을 누르면 그 구역으로 바로 갈 수 있어요.' : ''}</p>
        <div class="zone-grid">${(G.data.zones || []).map((z) => `<div class="zone-card" style="--zc:${esc(z.color || '#9aa88f')}">
          <div class="zc-head"><span class="zc-dot"></span><b>${esc(z.name)}</b>${visited[z.id] ? '<span class="chip chip-green">방문함</span>' : ''}</div>
          <p>${esc(z.desc || '')}</p>${canGo ? `<button type="button" class="btn btn-sm btn-soft" data-zone="${esc(z.id)}">${ico('teleport', 'ico-sm')}이동</button>` : ''}</div>`).join('')}</div>
        <p class="tiny muted">${esc(G.data.meta?.address || '')} — ${esc(G.data.meta?.addressNote || '')}</p>`;
      wrap.addEventListener('click', (e) => {
        const b = e.target.closest('[data-zone]');
        if (!b) return;
        G.ui.modal.get('app-help')?.close();
        G.sys.minimap?.travelTo?.(b.dataset.zone);
      });
      return wrap;
    },
    faq() {
      const server = isServer();
      const qa = [
        ['진행 상황은 어디에 저장되나요?', server ? '서버 모드에서는 계정 서버에 저장돼요. 게스트로 둘러볼 때는 이 브라우저에만 저장돼요.' : '로컬 모드에서는 이 브라우저(localStorage)에 자동으로 저장돼요. 무언가 바뀌면 몇 초 안에, 그리고 30초마다, 창을 닫을 때도 저장해요.'],
        ['다른 기기에서 이어서 할 수 있나요?', '메뉴 → 설정 → 데이터에서 저장 파일을 내보낸 뒤, 다른 기기에서 같은 메뉴의 ‘가져오기’로 불러오면 돼요.'],
        ['브라우저 기록을 지우면 어떻게 되나요?', '로컬 모드의 계정과 진행 상황도 함께 지워져요. 중요한 기록은 저장 파일로 백업해 두세요.'],
        ['발효·재배 수치는 실제와 같나요?', G.data.meta?.disclaimer || '교육용 가상 시뮬레이션이에요.'],
        ['칭호는 자격증인가요?', G.data.meta?.titleDisclaimer || '게임 내 칭호예요.'],
        ['화면이 끊기거나 느려요.', '설정 → 그래픽에서 품질을 ‘낮음’으로 바꾸고 그림자를 꺼 보세요. 자동 품질은 프레임이 낮으면 스스로 품질을 낮춰요.'],
        ['소리가 안 나요.', '화면을 한 번 클릭한 뒤 설정 → 소리에서 음소거와 볼륨을 확인해 주세요.'],
      ];
      const wrap = h('div', { class: 'help-faq' });
      wrap.innerHTML = qa.map(([q, a]) => `<details class="faq"><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join('');
      return wrap;
    },
  };

  function openCredits() {
    const M = G.data.meta || {};
    return G.ui.modal.open({
      id: 'app-credits', title: '안내 및 고지', icon: 'info', size: 'md', className: 'app-credits-modal',
      body: `<div class="credits">
        <section><h4>교육용 시뮬레이션 안내</h4><p>${esc(M.disclaimer || '')}</p><p>${esc(M.titleDisclaimer || '')}</p>
          <p>교육 콘텐츠는 널리 알려진 일반적인 내용을 짧게 정리한 것이며, 식품 제조·건강 정보로 활용하기 전에 전문 자료를 확인해 주세요.</p></section>
        <section><h4>장소 정보</h4><p>${esc(M.address || '')}</p><p class="dim">${esc(M.addressNote || '')}</p></section>
        <section><h4>데이터 저장</h4><p>${isServer() ? '서버 모드: 계정(이메일·닉네임·암호화된 비밀번호)과 진행 상황이 체험관 서버에 저장돼요.' : '로컬 모드: 계정과 진행 상황이 이 브라우저(localStorage)에만 저장되며 외부로 전송되지 않아요.'}</p></section>
        <section><h4>만든 도구</h4><p>3D 그래픽: three.js r${esc(String(THREE.REVISION || ''))} (MIT License) · 글꼴: Pretendard (SIL Open Font License 1.1, 포함된 경우) · 모든 3D 모델·소리·아이콘은 코드로 직접 생성했어요.</p></section>
        <p class="tiny muted">전통발효체험관 메타버스 v${esc(G.VERSION)}</p></div>`,
      actions: [{ label: '확인', class: 'btn-primary' }],
    });
  }

  function openTerms() {
    const server = isServer();
    return G.ui.modal.open({
      id: 'app-terms', title: '이용약관 · 개인정보 처리 안내', icon: 'shield', size: 'md', className: 'app-terms-modal',
      body: `<div class="terms">
        <h4>1. 서비스 소개</h4><p>전통발효체험관 메타버스는 한국 전통발효문화와 농업을 배우는 교육용 체험 게임이에요. 게임 속 발효·재배 수치와 결과물은 가상 시뮬레이션이에요.</p>
        <h4>2. 계정과 저장</h4><p>${server ? '이메일·닉네임·비밀번호(암호화하여 보관)와 게임 진행 데이터가 체험관 서버에 저장돼요. 비밀번호는 원문으로 보관하지 않아요.' : '로컬 모드의 계정과 진행 데이터는 이 브라우저에만 저장되고 외부로 전송되지 않아요. 비밀번호는 무작위 값과 함께 해시(SHA-256)로 변환해 보관해요. 브라우저 데이터를 지우면 계정도 함께 지워져요.'}</p>
        <h4>3. 개인정보</h4><p>이메일은 로그인 확인 용도로만 쓰여요. 닉네임은 다른 체험객에게 보일 수 있어요. 실명·연락처 등 불필요한 개인정보를 닉네임이나 채팅에 쓰지 마세요.</p>
        <h4>4. 이용 규칙</h4><p>욕설·비방·도배·광고는 금지돼요. 부적절한 채팅은 가려지며, 신고된 내용은 관리자가 확인할 수 있어요.</p>
        <h4>5. 칭호와 보상</h4><p>${esc(G.data.meta?.titleDisclaimer || '게임 내 칭호예요.')}</p></div>`,
      actions: [
        { label: '닫기', class: 'btn-ghost' },
        { label: '동의하고 닫기', class: 'btn-primary', onClick: () => {
          const cb = Title.el?.querySelector('[data-form=register] [name=agree]');
          if (cb && !cb.checked) { cb.checked = true; cb.dispatchEvent(new Event('input', { bubbles: true })); }
        } },
      ],
    });
  }

  // ================================================================ avatar customizer
  const AV_SECTIONS = [
    { title: '얼굴', emoji: '😊', rows: [['skin', 'swatch'], ['face', 'chip']] },
    { title: '헤어', emoji: '💇', rows: [['hair', 'chip'], ['hairColor', 'swatch']] },
    { title: '상의', emoji: '👕', rows: [['top', 'chip'], ['topColor', 'swatch']] },
    { title: '하의 · 신발', emoji: '👖', rows: [['bottom', 'chip'], ['bottomColor', 'swatch'], ['shoes', 'swatch']] },
    { title: '가방', emoji: '🎒', rows: [['bag', 'chip'], ['bagColor', 'swatch', 'bag']] },
    { title: '액세서리', emoji: '👓', rows: [['accessory', 'chip'], ['accessoryColor', 'swatch', 'accessory']] },
    { title: '키', emoji: '📏', rows: [['height', 'height']] },
  ];
  const AV_ANIMS = [['wave', '👋 인사'], ['celebrate', '🙌 만세'], ['dance', '💃 춤'], ['photo', '✌️ 브이'], ['heart', '❤️ 하트']];
  const _avV = new THREE.Vector3();

  /** small separate WebGLRenderer turntable (disposed with the modal) */
  class AvatarPreview {
    constructor(host, appearance) {
      this.host = host;
      this.yaw = 0.42; this._drag = null; this._idle = 0; this._t = 0;
      this.view = 'full';
      this._camPos = new THREE.Vector3(0, 0.9, 4.2); this._camLook = new THREE.Vector3(0, 0.7, 0);
      this._raf = 0; this._last = 0; this.disposed = false;
      const canvas = document.createElement('canvas');
      canvas.className = 'av-canvas';
      canvas.setAttribute('aria-label', '아바타 미리보기 (끌어서 돌리기)');
      host.appendChild(canvas);
      this.canvas = canvas;
      try {
        this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'low-power', preserveDrawingBuffer: false });
      } catch (e) {
        G.log.warn('UI', 'avatar preview renderer failed', e);
        this.failed = true;
        canvas.remove();
        host.insertAdjacentHTML('beforeend', '<div class="av-fallback"><span class="emoji">🧑‍🌾</span><p>이 기기에서는 3D 미리보기를 표시할 수 없어요.<br>저장하면 게임 속 캐릭터에 바로 적용돼요.</p></div>');
        return;
      }
      const r = this.renderer;
      r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      r.outputColorSpace = THREE.SRGBColorSpace;
      r.toneMapping = THREE.ACESFilmicToneMapping;
      r.toneMappingExposure = 1.0;
      r.setClearColor(0x000000, 0);
      const scene = new THREE.Scene();
      this.scene = scene;
      const hemi = new THREE.HemisphereLight(0xfff4e2, 0x5b6b48, 1.7);
      const key = new THREE.DirectionalLight(0xfff0d8, 2.6); key.position.set(1.8, 3, 3.2);
      const fill = new THREE.DirectionalLight(0xcfe2ff, 0.9); fill.position.set(-2.6, 1.4, 1.8);
      const rim = new THREE.DirectionalLight(0xffe2b0, 1.6); rim.position.set(-1.4, 2.6, -2.8);
      scene.add(hemi, key, fill, rim);
      this.camera = new THREE.PerspectiveCamera(27, 1, 0.05, 40);
      // pedestal: stone disc + soft contact shadow
      const discTex = G.gfx.canvasTexture(256, 256, (ctx, w) => {
        const g = ctx.createRadialGradient(w / 2, w / 2, w * 0.05, w / 2, w / 2, w / 2);
        g.addColorStop(0, '#e9dfc6'); g.addColorStop(0.78, '#cbbd9b'); g.addColorStop(0.92, '#a8987a'); g.addColorStop(1, 'rgba(120,105,80,0)');
        ctx.fillStyle = g; ctx.fillRect(0, 0, w, w);
        ctx.strokeStyle = 'rgba(120,100,70,.35)'; ctx.lineWidth = 3;
        for (let i = 1; i <= 3; i++) { ctx.beginPath(); ctx.arc(w / 2, w / 2, w * 0.12 * i + 8, 0, Math.PI * 2); ctx.stroke(); }
      });
      const shadowTex = G.gfx.radialTexture(128, 'rgba(0,0,0,0.55)', 'rgba(0,0,0,0)');
      this._own = [discTex, shadowTex];
      const disc = new THREE.Mesh(new THREE.CircleGeometry(0.95, 48), new THREE.MeshStandardMaterial({ map: discTex, roughness: 0.95, transparent: true }));
      disc.rotation.x = -Math.PI / 2; disc.position.y = -0.005;
      const shadow = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.1), new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false }));
      shadow.rotation.x = -Math.PI / 2; shadow.position.y = 0.004;
      scene.add(disc, shadow);
      this._meshes = [disc, shadow];
      this.turn = new THREE.Group();
      scene.add(this.turn);
      try {
        this.rig = G.avatar.create(appearance, { shadow: false });
        this.turn.add(this.rig.group);
      } catch (e) { G.log.error('UI', 'avatar preview rig failed', e); this.rig = null; }
      this._bind();
      this._resize();
      this._frameCamera(true);
      this._loop = this._loop.bind(this);
      this._raf = requestAnimationFrame(this._loop);
    }
    _bind() {
      const c = this.canvas;
      c.addEventListener('pointerdown', (e) => { this._drag = { id: e.pointerId, x: e.clientX }; try { c.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ } });
      c.addEventListener('pointermove', (e) => { const d = this._drag; if (!d || d.id !== e.pointerId) return; this.yaw += (e.clientX - d.x) * 0.012; d.x = e.clientX; this._idle = 0; });
      const up = (e) => { if (this._drag && this._drag.id === e.pointerId) this._drag = null; };
      c.addEventListener('pointerup', up);
      c.addEventListener('pointercancel', up);
      c.addEventListener('wheel', (e) => { e.preventDefault(); this.setView(e.deltaY < 0 ? 'face' : 'full'); }, { passive: false });
      if (typeof ResizeObserver === 'function') { this._ro = new ResizeObserver(() => this._resize()); this._ro.observe(this.host); }
    }
    _resize() {
      if (!this.renderer) return;
      const w = Math.max(80, this.host.clientWidth), hh = Math.max(80, this.host.clientHeight);
      this.renderer.setSize(w, hh, false);
      this.camera.aspect = w / hh;
      this.camera.updateProjectionMatrix();
    }
    _frameCamera(snap) {
      const hs = Number(this.rig?.appearance?.height) || 1;
      let px, py, pz, lx, ly;
      if (this.view === 'face' && this.rig) {
        this.rig.group.updateMatrixWorld(true);
        this.rig.headAnchor.getWorldPosition(_avV);
        const hy = _avV.y - 0.32;
        px = 0; py = hy + 0.05; pz = 1.55; lx = 0; ly = hy;
      } else { px = 0; py = 0.95 * hs; pz = 4.1; lx = 0; ly = 0.68 * hs; }
      this._tPos = this._tPos || new THREE.Vector3(); this._tLook = this._tLook || new THREE.Vector3();
      this._tPos.set(px, py, pz); this._tLook.set(lx, ly, 0);
      if (snap) { this._camPos.copy(this._tPos); this._camLook.copy(this._tLook); }
    }
    setView(v) { if (this.view === v) return; this.view = v; this._frameCamera(false); this.onView?.(v); }
    setAppearance(app) { if (!this.rig) return; this.rig.setAppearance(app); this._frameCamera(false); }
    play(name) {
      if (!this.rig) return;
      const def = G.avatar.actions?.[name];
      const dur = def?.loop ? 4.2 : (def?.duration || 2.2);
      this.rig.setAnim(name, { loop: false, duration: dur, restart: true });
      this._idle = 0;
    }
    _loop(t) {
      if (this.disposed) return;
      this._raf = requestAnimationFrame(this._loop);
      if (document.hidden) { this._last = t; return; }
      let dt = this._last ? (t - this._last) / 1000 : 0.016;
      this._last = t;
      if (!(dt > 0)) dt = 0.016;
      if (dt > 0.1) dt = 0.1;
      this._t += dt;
      this._idle += dt;
      if (!this._drag && this._idle > 2.5) this.yaw += G.util.angleDiff(this.yaw, 0.42 + Math.sin(this._t * 0.5) * 0.55) * Math.min(1, dt * 1.2);
      this.turn.rotation.y = this.yaw;
      if (this.rig) this.rig.update(dt, IDLE);
      if (this.view === 'face') this._frameCamera(false);
      const k = 1 - Math.exp(-6 * dt);
      this._camPos.lerp(this._tPos, k);
      this._camLook.lerp(this._tLook, k);
      this.camera.position.copy(this._camPos);
      this.camera.lookAt(this._camLook);
      try { this.renderer.render(this.scene, this.camera); } catch (e) { G.log.warn('UI', 'avatar preview render failed', e); this.dispose(); }
    }
    dispose() {
      if (this.disposed) return;
      this.disposed = true;
      cancelAnimationFrame(this._raf);
      this._ro?.disconnect();
      try { this.rig?.dispose(); } catch (e) { /* ignore */ }
      for (const m of this._meshes || []) { m.geometry.dispose(); m.material.dispose(); }
      for (const t of this._own || []) t.dispose();
      try { this.renderer?.dispose(); this.renderer?.forceContextLoss?.(); } catch (e) { /* ignore */ }
      this.canvas?.remove();
      this.renderer = null; this.scene = null; this.rig = null;
    }
  }

  const AvatarEditor = {
    m: null, preview: null, work: null, orig: null,

    open() {
      if (!G.state || !app.loggedIn) return null;
      const ex = G.ui.modal.get('app-avatar');
      if (ex) { ex.close(); return null; }
      const A = G.avatar;
      this.orig = A ? A.normalize(G.state.profile?.avatar || A.defaultAppearance) : null;
      this.work = this.orig ? { ...this.orig } : null;
      const m = G.ui.modal.open({
        id: 'app-avatar', title: '아바타 꾸미기', icon: 'smile', size: 'xl', className: 'avatar-modal', backdropClose: false, autofocus: false,
        body: (body) => this._build(body),
        actions: A ? [
          { label: '무작위', icon: 'refresh', class: 'btn-soft av-random', onClick: () => { this.randomize(); return false; } },
          { label: '처음대로', class: 'btn-ghost', onClick: () => { this.set({ ...this.orig }); return false; } },
          { label: '취소', class: 'btn-ghost' },
          { label: '저장하기', icon: 'check', class: 'btn-primary', onClick: () => this.save() },
        ] : [{ label: '닫기', class: 'btn-primary' }],
        onClose: () => { this.preview?.dispose(); this.preview = null; this.m = null; G.ui.setActive('avatar', false); },
      });
      this.m = m;
      G.ui.setActive('avatar', true);
      return m;
    },

    _build(body) {
      const A = G.avatar;
      const nickRow = this._nickHtml();
      if (!A) {
        body.innerHTML = `<div class="notice-box">아바타 꾸미기 기능을 불러오지 못했어요. 페이지를 새로고침한 뒤 다시 시도해 주세요.</div>${nickRow}`;
        this._bindNick(body);
        return;
      }
      const L = A.labels || {};
      const sections = AV_SECTIONS.map((sec) => {
        const rows = sec.rows.map(([k, type, dep]) => {
          let opts = '';
          if (type === 'swatch') opts = (A.options[k] || []).map((c) => `<button type="button" class="av-swatch" data-k="${k}" data-v="${c}" style="--c:${c}" title="${esc(L.colors?.[c] || c)}" aria-label="${esc(L.colors?.[c] || c)}"></button>`).join('');
          else if (type === 'chip') opts = (A.options[k] || []).map((v) => `<button type="button" class="av-chip" data-k="${k}" data-v="${esc(v)}">${esc(L[k]?.[v] || v)}</button>`).join('');
          else if (type === 'height') {
            const hr = A.heightRange || { min: 0.9, max: 1.1, step: 0.05 };
            const vals = [];
            for (let v = hr.min; v <= hr.max + 1e-6; v += hr.step) vals.push(Math.round(v * 100) / 100);
            opts = vals.map((v) => `<button type="button" class="av-chip" data-k="height" data-v="${v}">${esc(L.height?.[v] || `${Math.round(v * 100)}%`)}</button>`).join('');
          }
          return `<div class="av-row" data-row="${k}"${dep ? ` data-dep="${dep}"` : ''}><span class="av-row-label">${esc(L.keys?.[k] || k)}</span><div class="av-opts ${type === 'swatch' ? 'swatches' : 'chips'}">${opts}</div></div>`;
        }).join('');
        return `<section class="av-sec"><h4><span class="emoji">${sec.emoji}</span>${esc(sec.title)}</h4>${rows}</section>`;
      }).join('');
      body.innerHTML = `<div class="av-layout">
          <div class="av-stage-col">
            <div class="av-stage"><div class="av-stage-tools"><div class="seg av-view" role="radiogroup" aria-label="보기"><button type="button" data-view="full" class="active">전신</button><button type="button" data-view="face">얼굴</button></div></div></div>
            <div class="av-anims">${AV_ANIMS.map(([a, l]) => `<button type="button" class="av-anim" data-anim="${a}">${l}</button>`).join('')}</div>
            <p class="tiny muted av-tip">미리보기를 끌어서 돌려 볼 수 있어요.</p>
          </div>
          <div class="av-options">${sections}${nickRow}</div>
        </div>`;
      const stage = body.querySelector('.av-stage');
      this.preview = new AvatarPreview(stage, this.work);
      this.preview.onView = (v) => { for (const b of body.querySelectorAll('.av-view [data-view]')) b.classList.toggle('active', b.dataset.view === v); };
      body.querySelector('.av-view').addEventListener('click', (e) => { const b = e.target.closest('[data-view]'); if (b) this.preview?.setView(b.dataset.view); });
      body.querySelector('.av-anims').addEventListener('click', (e) => { const b = e.target.closest('[data-anim]'); if (b) { this.preview?.play(b.dataset.anim); G.sfx('emote'); } });
      body.querySelector('.av-options').addEventListener('click', (e) => {
        const b = e.target.closest('[data-k]');
        if (!b || b.disabled) return;
        const k = b.dataset.k;
        const v = k === 'height' ? Number(b.dataset.v) : b.dataset.v;
        if (this.work[k] === v) return;
        this.work[k] = v;
        G.sfx('click');
        this._sync();
        this.preview?.setAppearance(this.work);
        if (k === 'face') this.preview?.setView('face');
      });
      this._bindNick(body);
      this._sync();
    },

    _nickHtml() {
      const cur = auth.current;
      const server = cur?.kind === 'server';
      return `<section class="av-sec av-nick"><h4><span class="emoji">🏷️</span>닉네임</h4>
        <div class="av-nick-row"><input class="input" name="av-nick" type="text" maxlength="24" value="${esc(G.state?.profile?.nickname || '')}" ${server ? 'disabled' : ''} aria-label="닉네임">
          <button type="button" class="btn btn-soft" data-nick ${server ? 'disabled' : ''}>바꾸기</button></div>
        <small class="av-nick-msg ${server ? 'muted' : 'muted'}">${server ? '서버 계정의 닉네임은 이곳에서 바꿀 수 없어요.' : '2~12자 · 한글·영문·숫자·밑줄(_) · 다른 체험객에게 보여요.'}</small></section>`;
    },
    _bindNick(body) {
      const input = body.querySelector('[name=av-nick]');
      const btn = body.querySelector('[data-nick]');
      if (!input || !btn) return;
      btn.addEventListener('click', () => this._applyNick(body, true));
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); this._applyNick(body, true); } });
    },
    /** -> true when ok (or unchanged) */
    _applyNick(body, notify) {
      const input = body?.querySelector('[name=av-nick]');
      const msg = body?.querySelector('.av-nick-msg');
      if (!input || input.disabled) return true;
      const v = input.value.trim();
      if (v === (G.state?.profile?.nickname || '')) { if (notify && msg) { msg.textContent = '지금 쓰고 있는 닉네임이에요.'; msg.className = 'av-nick-msg muted'; } return true; }
      const err = auth.changeNickname(v);
      if (msg) { msg.textContent = err || `닉네임을 「${v}」${josa(v, '으로/로').slice(v.length)} 바꿨어요.`; msg.className = `av-nick-msg ${err ? 'red' : 'green'}`; }
      if (err) { G.sfx('error'); input.focus(); return false; }
      if (notify) G.sfx('correct');
      return true;
    },

    _sync() {
      const body = this.m?.body;
      if (!body || !this.work) return;
      for (const b of body.querySelectorAll('.av-options [data-k]')) {
        const k = b.dataset.k;
        const on = k === 'height' ? Math.abs(Number(b.dataset.v) - Number(this.work.height)) < 0.001 : String(this.work[k]) === b.dataset.v;
        b.classList.toggle('active', on);
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
      }
      for (const row of body.querySelectorAll('.av-row[data-dep]')) {
        const off = this.work[row.dataset.dep] === 'none';
        row.classList.toggle('disabled', off);
        for (const b of row.querySelectorAll('button')) b.disabled = off;
      }
    },

    set(app) {
      this.work = G.avatar.normalize(app);
      this._sync();
      this.preview?.setAppearance(this.work);
    },
    randomize() {
      this.set(G.avatar.random());
      this.preview?.play('celebrate');
      G.sfx('pop');
    },
    save() {
      if (!G.state || !this.work) return true;
      const body = this.m?.body;
      if (!this._applyNick(body, false)) return false; // keep the modal open on a bad nickname
      const appN = G.avatar.normalize(this.work);
      const changed = JSON.stringify(appN) !== JSON.stringify(this.orig);
      if (changed) {
        if (G.sys.player?.setAppearance) G.sys.player.setAppearance(appN);
        else { G.state.profile.avatar = { ...appN }; G.dirty('avatar'); G.bus.emit('player:appearance', { appearance: appN }); }
        G.ui.toast('새 모습을 저장했어요!', { type: 'success', emoji: '👕' });
        try { G.sys.player?.playAction?.('celebrate', { duration: 1.8 }); } catch (e) { /* cosmetic */ }
        Portrait.schedule(250);
      }
      return true;
    },
  };

  // ================================================================ debug panel
  const Debug = {
    el: null, open: false, _t: 0, _colliders: false,
    allowed() { return canDebug(); },
    toggle() {
      if (!app.loggedIn) return false;
      if (!this.allowed()) { G.ui.toast('디버그 패널은 관리자나 디버그 모드(?debug=1)에서만 쓸 수 있어요.', { type: 'info', sound: false }); return false; }
      if (this.open) this.hide(); else this.show();
      return true;
    },
    show() {
      if (!this.el) this._build();
      this.el.hidden = false;
      this.open = true;
      this._sync();
      this._info(true);
      G.log.info('UI', 'debug panel open');
    },
    hide() {
      if (!this.el) return;
      this.el.hidden = true;
      this.open = false;
    },
    _build() {
      const zones = (G.data.zones || []).map((z) => `<button type="button" data-dbg="tp" data-arg="${esc(z.id)}">${esc(z.short || z.name)}</button>`).join('');
      const weathers = Object.entries(G.data.weather || {}).map(([id, w]) => `<button type="button" data-dbg="weather" data-arg="${id}">${esc(w.name)}</button>`).join('');
      const el = h('aside', { class: 'app-debug glass', 'aria-label': '디버그 패널', hidden: true });
      el.innerHTML = `
        <header class="dbg-head"><span>${ico('bug', 'ico-sm')}디버그 패널</span><button type="button" class="icon-btn" data-dbg="close" aria-label="닫기">${ico('x', 'ico-sm')}</button></header>
        <div class="dbg-info"></div>
        <div class="dbg-body">
          <h5>자원</h5><div class="dbg-grid">
            <button type="button" data-dbg="coin">+1,000 코인</button><button type="button" data-dbg="exp">+500 EXP</button><button type="button" data-dbg="edu">+50 교육</button>
            <button type="button" data-dbg="seeds">씨앗 모두 ×5</button><button type="button" data-dbg="ingredients">재료·작물 ×5</button><button type="button" data-dbg="save">즉시 저장</button></div>
          <h5>퀘스트 · 튜토리얼</h5><div class="dbg-grid">
            <button type="button" data-dbg="objective">현재 목표 완료</button><button type="button" data-dbg="claimall">완료 보상 모두 받기</button><button type="button" data-dbg="tutorial">튜토리얼 다시</button></div>
          <h5>농장 · 발효</h5><div class="dbg-grid">
            <button type="button" data-dbg="grow">작물 100% 성장</button><button type="button" data-dbg="water">밭 물 100%</button><button type="button" data-dbg="ferment">내 장독 발효 완료</button>
            <button type="button" data-dbg="ff">발효 +1분</button></div>
          <h5>날씨 · 시간</h5><div class="dbg-grid">${weathers}</div>
          <div class="dbg-grid"><button type="button" data-dbg="hour" data-arg="6.5">아침 6:30</button><button type="button" data-dbg="hour" data-arg="12">낮 12:00</button><button type="button" data-dbg="hour" data-arg="18.5">저녁 18:30</button><button type="button" data-dbg="hour" data-arg="22">밤 22:00</button></div>
          <h5>순간이동</h5><div class="dbg-grid">${zones}</div>
          <h5>표시 · 품질</h5><div class="dbg-grid">
            <button type="button" data-dbg="colliders" class="tog">충돌체 보기</button><button type="button" data-dbg="fps" class="tog">FPS 표시</button>
            <button type="button" data-dbg="quality" data-arg="low">품질 낮음</button><button type="button" data-dbg="quality" data-arg="medium">품질 중간</button><button type="button" data-dbg="quality" data-arg="high">품질 높음</button><button type="button" data-dbg="quality" data-arg="auto">품질 자동</button></div>
        </div>`;
      G.ui.hydrateIcons(el);
      const saved = store.get(KEYS.debugPos, null);
      if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) { el.style.left = `${U.clamp(saved.x, 0, innerWidth - 120)}px`; el.style.top = `${U.clamp(saved.y, 0, innerHeight - 60)}px`; el.style.right = 'auto'; }
      el.addEventListener('click', (e) => {
        const b = e.target.closest('[data-dbg]');
        if (!b) return;
        try { this.run(b.dataset.dbg, b.dataset.arg); } catch (err) { G.log.error('UI', 'debug command failed', err); G.ui.toast(`명령 실패: ${err?.message || err}`, { type: 'error' }); }
        this._sync();
      });
      // drag by header
      const head = el.querySelector('.dbg-head');
      head.addEventListener('pointerdown', (e) => {
        if (e.target.closest('button')) return;
        const r = el.getBoundingClientRect();
        const ox = e.clientX - r.left, oy = e.clientY - r.top;
        try { head.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
        const move = (ev) => { el.style.left = `${U.clamp(ev.clientX - ox, 0, innerWidth - 80)}px`; el.style.top = `${U.clamp(ev.clientY - oy, 0, innerHeight - 40)}px`; el.style.right = 'auto'; };
        const up = () => { head.removeEventListener('pointermove', move); head.removeEventListener('pointerup', up); head.removeEventListener('pointercancel', up); const rr = el.getBoundingClientRect(); store.set(KEYS.debugPos, { x: Math.round(rr.left), y: Math.round(rr.top) }); };
        head.addEventListener('pointermove', move);
        head.addEventListener('pointerup', up);
        head.addEventListener('pointercancel', up);
      });
      ($('#app') || document.body).appendChild(el);
      this.el = el;
    },
    _sync() {
      if (!this.el) return;
      this.el.querySelector('[data-dbg=colliders]')?.classList.toggle('on', this._colliders);
      this.el.querySelector('[data-dbg=fps]')?.classList.toggle('on', !!G.settings.showFps);
      const q = G.settings.quality || 'auto';
      for (const b of this.el.querySelectorAll('[data-dbg=quality]')) b.classList.toggle('on', b.dataset.arg === q);
      const w = G.sys.weather?.current;
      for (const b of this.el.querySelectorAll('[data-dbg=weather]')) b.classList.toggle('on', b.dataset.arg === w);
    },
    _info(force) {
      if (!this.open || !this.el) return;
      const p = G.sys.player?.position;
      const E = G.sys.engine;
      const zone = p ? G.world.zoneAt(p.x, p.z) : null;
      const info = E?.renderer?.info?.render;
      const W = G.sys.weather;
      this.el.querySelector('.dbg-info').innerHTML = `
        <span>📍 ${p ? `${p.x.toFixed(1)}, ${p.y.toFixed(2)}, ${p.z.toFixed(1)}` : '-'}</span><span>🗺️ ${esc(zone?.name || '-')}</span>
        <span>⚡ ${Math.round(E?.fps || 0)} FPS · ${esc(E?.quality || '-')}</span><span>🎨 ${fmt(info?.calls || 0)} draw · ${fmt(Math.round((info?.triangles || 0) / 1000))}k tri</span>
        <span>🌤️ ${esc(W?.current || '-')} · ${W?.timeString ? esc(W.timeString()) : '-'}</span><span>👥 ${fmt(G.sys.social?.online || 1)}명 · ${esc(G.save.adapter?.name || '-')}</span>`;
      if (force) this._sync();
    },
    update(dt) {
      if (!this.open) return;
      this._t -= dt;
      if (this._t <= 0) { this._t = 0.5; this._info(); }
    },
    run(cmd, arg) {
      const P = G.sys.progression, I = G.sys.inventory, Q = G.sys.quest, F = G.sys.farming, J = G.sys.fermentation, Wt = G.sys.weather;
      const ok = (m) => G.ui.toast(m, { type: 'success', emoji: '🛠️', sound: false });
      const warn = (m) => G.ui.toast(m, { type: 'warn' });
      const st = G.state;
      if (cmd === 'close') return this.hide();
      if (!st) return warn('로그인 후 사용할 수 있어요.');
      switch (cmd) {
        case 'coin': if (P?.addCoin) P.addCoin(1000); else { st.stats.coin += 1000; G.dirty('debug'); } return ok('코인 +1,000');
        case 'exp': if (P?.addExp) P.addExp(500); else { st.stats.exp += 500; G.dirty('debug'); } return ok('EXP +500');
        case 'edu': if (P?.addEdu) P.addEdu(50); else { st.stats.edu += 50; G.dirty('debug'); } return ok('교육 포인트 +50');
        case 'seeds':
        case 'ingredients': {
          const types = cmd === 'seeds' ? ['seed'] : ['ingredient', 'crop'];
          let n = 0;
          for (const [id, it] of Object.entries(G.data.items || {})) {
            if (!types.includes(it.type)) continue;
            if (I?.add) I.add(id, 5, { source: 'debug', silent: true }); else { st.inventory[id] = (st.inventory[id] || 0) + 5; }
            n++;
          }
          G.dirty('debug');
          return ok(`${cmd === 'seeds' ? '씨앗' : '재료·작물'} ${n}종을 5개씩 넣었어요`);
        }
        case 'save': saveNow('debug', true); return null;
        case 'objective': {
          if (!Q) return warn('퀘스트 시스템이 없어요.');
          if (typeof Q.debugCompleteObjective === 'function') { Q.debugCompleteObjective(); return ok('현재 목표를 완료했어요'); }
          const f = Q.focus?.();
          if (f?.mode === 'objective' && f.questId != null && f.objective >= 0) {
            const o = G.data.quests?.[f.questId]?.objectives?.[f.objective];
            if (o && typeof Q._advance === 'function') { Q._advance(f.questId, f.objective, 0, null, { set: o.count || 1 }); return ok(`목표 완료: ${o.text || ''}`); }
          }
          if (f?.mode === 'claim') { Q.claim?.(f.questId); return ok('완료된 퀘스트 보상을 받았어요'); }
          if (f?.mode === 'giver') { Q.accept?.(f.questId); return ok('새 퀘스트를 수락했어요'); }
          return warn('진행 중인 목표가 없어요.');
        }
        case 'claimall': {
          let n = 0;
          for (const id of Object.keys(G.data.quests || {})) if (Q?.status?.(id) === 'completed' && Q.claim(id)) n++;
          return n ? ok(`보상 ${n}개를 받았어요`) : warn('받을 보상이 없어요.');
        }
        case 'tutorial':
          st.tutorial = { step: 0, done: false };
          G.dirty('tutorial');
          if (G.flags.noTutorial) return warn('주소에 notutorial=1이 있어 튜토리얼이 꺼져 있어요.');
          Onboarding.start(0);
          return ok('튜토리얼을 처음부터 다시 시작해요');
        case 'grow':
          if (F?.growAll) F.growAll(100);
          else return warn('농장 시스템이 없어요.');
          return ok('모든 작물을 다 키웠어요');
        case 'water': {
          if (!F?.setPlot) return warn('농장 시스템이 없어요.');
          for (const id of F.plotIds?.() || Object.keys(st.farm?.plots || {})) F.setPlot(id, { water: 100, health: 100 });
          return ok('모든 밭에 물을 듬뿍 줬어요');
        }
        case 'ferment': {
          if (!J?.setJar) return warn('발효 시스템이 없어요.');
          const s = st.jars?.J1;
          if (!s?.recipeId || s.status === 'CLAIMED' || s.status === 'EMPTY') return warn('내 장독(J1)에 진행 중인 발효가 없어요.');
          J.setJar('J1', { progress: 100 });
          return ok('내 장독의 발효를 완료했어요');
        }
        case 'ff': if (J?.fastForward) { J.fastForward(60); return ok('발효 시간을 1분 앞당겼어요'); } return warn('발효 시스템이 없어요.');
        case 'weather': if (Wt?.set) { if (G.settings.autoWeather) Wt.setAuto?.(false); Wt.set(arg, { source: 'debug' }); return ok(`날씨: ${G.data.weather?.[arg]?.name || arg} (자동 날씨 꺼짐)`); } return warn('날씨 시스템이 없어요.');
        case 'hour': if (Wt?.setHour) { Wt.setHour(Number(arg)); return ok(`시간: ${Wt.timeString?.() || arg}`); } return warn('날씨 시스템이 없어요.');
        case 'tp': {
          const z = G.world.zoneById?.(arg);
          if (G.sys.minimap?.travelTo) G.sys.minimap.travelTo(arg);
          else if (z && G.sys.player?.teleport) G.sys.player.teleport(z.center[0], z.center[1] + 3);
          else return warn('이동할 수 없어요.');
          return null;
        }
        case 'colliders': this._colliders = !this._colliders; G.world.debugDraw?.(this._colliders); return null;
        case 'fps': G.setSetting('showFps', !G.settings.showFps); return null;
        case 'quality': G.setSetting('quality', arg); return ok(`그래픽 품질: ${({ low: '낮음', medium: '중간', high: '높음', auto: '자동' })[arg] || arg}`);
        default: return null;
      }
    },
  };

  // ================================================================ admin dashboard
  const QUEST_CAT = { main: '메인', farm: '농사', journal: '작업일지', explore: '탐험', ferment: '발효', edu: '교육', social: '소통' };
  const STATUS_KO = { locked: '잠김', available: '수락 가능', accepted: '진행 중', progress: '진행 중', completed: '보상 대기', claimed: '완료' };
  function barRows(rows, opts = {}) {
    // single series, one hue; values in text ink; tooltip via title
    const max = opts.max ?? Math.max(1, ...rows.map((r) => r.value));
    return `<div class="adm-bars">${rows.map((r) => {
      const pct = Math.max(0, Math.min(100, (r.value / max) * 100));
      return `<div class="adm-bar" title="${esc(r.tip || `${r.label}: ${r.text ?? r.value}`)}"><span class="ab-label">${esc(r.label)}</span><span class="ab-track"><i style="width:${pct.toFixed(1)}%"></i></span><span class="ab-val">${esc(String(r.text ?? r.value))}</span></div>`;
    }).join('')}</div>`;
  }
  function tile(label, value, sub, cls = '') {
    return `<div class="adm-tile ${cls}"><span class="at-label">${esc(label)}</span><b class="at-val">${value}</b>${sub ? `<small>${sub}</small>` : ''}</div>`;
  }

  function openAdmin(tab = 'overview') {
    if (!G.state || !app.loggedIn) return null;
    if (!canDashboard()) { G.ui.toast('관리자 권한이 있는 계정만 볼 수 있어요.', { type: 'warn' }); return null; }
    const ex = G.ui.modal.get('app-admin');
    if (ex) ex.close();
    const tabs = [{ id: 'overview', label: '개요', icon: '📊' }, { id: 'quests', label: '퀘스트·구역', icon: '📜' }, { id: 'activity', label: '활동 기록', icon: '🕘' }];
    if (isAdmin() && !isServer()) tabs.push({ id: 'accounts', label: '로컬 계정', icon: '👥' });
    tabs.push({ id: 'server', label: '서버 통계', icon: '🛰️' });
    const head = h('span', { class: `chip ${isServer() ? 'chip-blue' : 'chip-green'}` }, isServer() ? '서버 모드' : '로컬 분석');
    return G.ui.modal.open({
      id: 'app-admin', title: '관리자 대시보드', icon: 'chart', size: 'xl', className: 'admin-modal', headExtra: head,
      body: (body) => {
        const tabsEl = h('div');
        const pane = h('div', { class: 'adm-pane' });
        body.append(tabsEl, pane);
        G.ui.tabs(tabsEl, tabs, (id) => {
          pane.innerHTML = '';
          try { ADMIN_PANES[id](pane); } catch (e) { G.log.error('UI', 'admin pane failed', e); pane.innerHTML = '<div class="empty">이 화면을 표시하지 못했어요.</div>'; }
          G.ui.hydrateIcons(pane);
        }, tabs.some((t) => t.id === tab) ? tab : 'overview');
      },
      actions: [{ label: '닫기', class: 'btn-primary' }],
    });
  }

  const ADMIN_PANES = {
    overview(pane) {
      const st = G.state, s = st.stats || {};
      const P = G.sys.progression;
      const zones = G.data.visitZones || [];
      const zv = zones.filter((z) => st.visited?.[z]).length;
      const achT = Object.keys(G.data.achievements || {}).length, achN = Object.keys(st.achievements || {}).length;
      const colT = Object.keys(G.data.collection || {}).length, colN = Object.keys(st.collection || {}).filter((k) => G.data.collection?.[k]).length;
      const eduT = (G.data.educationIds || []).length, eduN = Object.keys(st.education?.completed || {}).length;
      const qIds = Object.keys(G.data.quests || {});
      const qDone = qIds.filter((id) => st.quests?.[id]?.status === 'claimed').length;
      const quizRate = s.quizAnswered ? Math.round((s.quizCorrect / s.quizAnswered) * 100) : 0;
      const dist = s.distance >= 1000 ? `${(s.distance / 1000).toFixed(2)}km` : `${fmt(Math.round(s.distance || 0))}m`;
      pane.innerHTML = `
        <p class="dim small">${isServer() ? '이 화면의 수치는 지금 로그인한 계정의 기록이에요. 전체 사용자 통계는 ‘서버 통계’ 탭에서 볼 수 있어요.' : '로컬 모드에서는 이 브라우저에 저장된 지금 프로필의 체험 기록을 분석해요.'}</p>
        <div class="adm-tiles hero">
          ${tile('레벨', `Lv.${fmt(s.level || 1)}`, P?.expToNext ? `다음 레벨까지 ${fmt(P.expToNext())} EXP` : '')}
          ${tile('누적 경험치', fmt(s.expTotal || s.exp || 0), 'EXP')}
          ${tile('코인', fmt(s.coin || 0), '보유 중')}
          ${tile('교육 포인트', fmt(s.edu || 0), `교육 완료 ${eduN}/${eduT}`)}
        </div>
        <div class="adm-tiles">
          ${tile('플레이 시간', esc(U.formatDuration(s.playTime || 0)))}${tile('접속 횟수', `${fmt(s.logins || 0)}회`)}${tile('이동 거리', dist)}
          ${tile('퀘스트 완료', `${qDone}/${qIds.length}`)}${tile('방문 구역', `${zv}/${zones.length}`)}${tile('퀴즈 정답률', s.quizAnswered ? `${quizRate}%` : '-', `${fmt(s.quizCorrect || 0)}/${fmt(s.quizAnswered || 0)}`)}
          ${tile('작업일지', `${fmt((st.journal || []).length)}편`)}${tile('사진', `${fmt((st.photos || []).length)}장`, `누적 촬영 ${fmt(s.photos || 0)}장`)}${tile('업적', `${achN}/${achT}`)}${tile('도감', `${colN}/${colT}`)}
        </div>
        <h4 class="adm-h">체험 활동량</h4>
        ${barRows([
          { label: '물 주기', value: s.waters || 0, text: `${fmt(s.waters || 0)}회` }, { label: '씨앗 심기', value: s.plants || 0, text: `${fmt(s.plants || 0)}회` },
          { label: '수확', value: s.harvests || 0, text: `${fmt(s.harvests || 0)}회` }, { label: '장독 확인', value: s.fermentChecks || 0, text: `${fmt(s.fermentChecks || 0)}회` },
          { label: '발효 완성', value: s.fermentsClaimed || 0, text: `${fmt(s.fermentsClaimed || 0)}회` }, { label: '재료 만들기', value: s.crafts || 0, text: `${fmt(s.crafts || 0)}회` },
          { label: 'NPC 대화', value: s.talks || 0, text: `${fmt(s.talks || 0)}회` }, { label: '이모지·제스처', value: (s.emotes || 0) + (s.gestures || 0), text: `${fmt((s.emotes || 0) + (s.gestures || 0))}회` },
        ])}`;
    },
    quests(pane) {
      const st = G.state;
      const qs = Object.entries(G.data.quests || {});
      const byCat = {};
      for (const [id, q] of qs) {
        const c = q.category || 'etc';
        const e = byCat[c] || (byCat[c] = { total: 0, done: 0 });
        e.total++;
        if (st.quests?.[id]?.status === 'claimed') e.done++;
      }
      const catRows = Object.entries(byCat).map(([c, e]) => ({ label: QUEST_CAT[c] || c, value: e.total ? (e.done / e.total) * 100 : 0, text: `${e.done}/${e.total}`, tip: `${QUEST_CAT[c] || c} 퀘스트 ${e.done}/${e.total} 완료` }));
      const counts = {};
      for (const [id] of qs) { const s = G.sys.quest?.status?.(id) || st.quests?.[id]?.status || 'locked'; const k = s === 'accepted' ? 'progress' : s; counts[k] = (counts[k] || 0) + 1; }
      const zones = (G.data.visitZones || []).map((id) => G.world.zoneById?.(id) || (G.data.zones || []).find((z) => z.id === id)).filter(Boolean);
      pane.innerHTML = `
        <div class="adm-tiles">${['claimed', 'completed', 'progress', 'available', 'locked'].map((k) => tile(STATUS_KO[k], fmt(counts[k] || 0), '개', k === 'completed' && counts[k] ? 'warn' : '')).join('')}</div>
        <div class="adm-cols">
          <section><h4 class="adm-h">분야별 퀘스트 완료율</h4>${barRows(catRows, { max: 100 })}</section>
          <section><h4 class="adm-h">구역 방문 (${zones.filter((z) => st.visited?.[z.id]).length}/${zones.length})</h4>
            <ul class="adm-zones">${zones.map((z) => { const t = st.visited?.[z.id]; return `<li class="${t ? 'on' : ''}"><span class="zc-dot" style="--zc:${esc(z.color || '#999')}"></span><b>${esc(z.name)}</b><small>${t ? `첫 방문 ${esc(U.formatDate(t, true))}` : '아직 방문 전'}</small></li>`; }).join('')}</ul></section>
        </div>
        <h4 class="adm-h">퀘스트 목록</h4>
        <div class="adm-table-wrap"><table class="adm-table"><thead><tr><th>퀘스트</th><th>분야</th><th>상태</th><th>진행</th><th>완료 시각</th></tr></thead><tbody>
          ${qs.map(([id, q]) => {
            const e = st.quests?.[id];
            const s = G.sys.quest?.status?.(id) || e?.status || 'locked';
            const pr = G.sys.quest?.progress?.(id);
            const prog = pr ? `${pr.done}/${pr.total}` : '-';
            return `<tr><td><span class="emoji">${esc(q.icon || '📜')}</span> ${esc(q.title)}</td><td>${esc(QUEST_CAT[q.category] || q.category || '-')}</td><td><span class="chip ${s === 'claimed' ? 'chip-green' : s === 'completed' ? 'chip-gold' : s === 'locked' ? '' : 'chip-blue'}">${esc(STATUS_KO[s] || s)}</span></td><td>${prog}</td><td>${e?.claimedAt ? esc(U.formatDate(e.claimedAt, true)) : e?.completedAt ? esc(U.formatDate(e.completedAt, true)) : '-'}</td></tr>`;
          }).join('')}</tbody></table></div>`;
    },
    activity(pane) {
      const list = (G.state.activity || []).slice().reverse();
      if (!list.length) { pane.innerHTML = '<div class="empty">아직 기록된 활동이 없어요.</div>'; return; }
      const zn = (id) => G.world.zoneById?.(id)?.name || '-';
      pane.innerHTML = `<p class="dim small">최근 활동 ${list.length}건 (최대 60건 보관)</p>
        <div class="adm-table-wrap"><table class="adm-table"><thead><tr><th>시각</th><th>종류</th><th>내용</th><th>구역</th></tr></thead><tbody>
        ${list.map((a) => `<tr><td class="nowrap">${esc(U.formatDate(a.t, true))}</td><td><span class="chip">${esc(a.type || '-')}</span></td><td>${esc(a.text || '')}</td><td class="nowrap">${esc(zn(a.zoneId))}</td></tr>`).join('')}
        </tbody></table></div>`;
    },
    accounts(pane) {
      const accs = Accounts.publicList();
      const idx = Profiles.all();
      const guest = idx.find((p) => p.kind === 'guest');
      pane.innerHTML = `<p class="dim small">이 브라우저에 만들어진 로컬 계정 ${accs.length}개${guest ? ' + 게스트 1명' : ''}. 비밀번호는 해시로만 보관되어 볼 수 없어요.</p>
        <div class="adm-table-wrap"><table class="adm-table"><thead><tr><th>닉네임</th><th>이메일</th><th>권한</th><th>레벨</th><th>가입</th><th>마지막 접속</th><th>저장 크기</th></tr></thead><tbody>
        ${accs.map((a) => {
          const p = idx.find((x) => x.id === a.id);
          const raw = store.raw(`tfm.v1.save.${a.id}`);
          return `<tr><td><b>${esc(a.nickname)}</b>${a.id === auth.current?.id ? ' <span class="chip chip-green">나</span>' : ''}</td><td>${esc(a.email)}</td><td>${a.role === 'admin' ? '<span class="chip chip-gold">관리자</span>' : '사용자'}</td><td>${p?.level ? `Lv.${p.level}` : '-'}</td><td class="nowrap">${esc(U.formatDate(a.createdAt))}</td><td class="nowrap">${a.lastLogin ? esc(ago(a.lastLogin)) : '-'}</td><td>${raw ? bytesLabel(new Blob([raw]).size) : '-'}</td></tr>`;
        }).join('') || '<tr><td colspan="7" class="center muted">로컬 계정이 없어요.</td></tr>'}
        ${guest ? `<tr class="muted"><td>${esc(guest.nickname)}</td><td>-</td><td>게스트</td><td>${guest.level ? `Lv.${guest.level}` : '-'}</td><td class="nowrap">${esc(U.formatDate(guest.createdAt))}</td><td class="nowrap">${esc(ago(guest.lastPlayed))}</td><td>${(() => { const r = store.raw('tfm.v1.save.guest'); return r ? bytesLabel(new Blob([r]).size) : '-'; })()}</td></tr>` : ''}
        </tbody></table></div>`;
    },
    server(pane) {
      if (!isServer()) {
        pane.innerHTML = `<div class="empty">${ico('info')}<p>서버 통계는 <b>서버 모드</b>(PHP API와 함께 웹 서버에서 실행)에서만 볼 수 있어요.<br>지금은 로컬 모드라 이 브라우저의 기록만 분석해요.</p></div>`;
        return;
      }
      const load = async () => {
        pane.innerHTML = '<div class="adm-loading"><span class="spin"></span>서버 통계를 불러오는 중…</div>';
        let d;
        try { d = await G.net.request('admin/stats.php', { timeout: 10000 }); }
        catch (e) {
          if (!pane.isConnected) return;
          const denied = e?.status === 401 || e?.status === 403 || /FORBIDDEN|UNAUTHORIZED|ADMIN/.test(String(e?.code || ''));
          pane.innerHTML = `<div class="empty">${ico('shield')}<p>${denied ? '관리자 권한이 있는 서버 계정으로 로그인해야 볼 수 있어요.' : esc(e?.message || '서버 통계를 불러오지 못했어요.')}</p><button type="button" class="btn btn-soft btn-sm adm-retry">다시 시도</button></div>`;
          G.ui.hydrateIcons(pane);
          pane.querySelector('.adm-retry')?.addEventListener('click', load);
          return;
        }
        if (!pane.isConnected) return;
        ADMIN_PANES._renderServer(pane, d || {}, load);
      };
      load();
    },
    _renderServer(pane, d, reload) {
      const LABEL = {
        users: '가입자', usersToday: '오늘 가입', online: '접속 중', activeToday: '오늘 접속', questCompletions: '퀘스트 완료', quests: '퀘스트 완료',
        chatMessages: '채팅 메시지', messages: '채팅 메시지', chatReports: '채팅 신고', reports: '신고', saves: '저장 데이터', journals: '작업일지',
        uploads: '업로드 사진', photos: '사진', harvests: '수확', ferments: '발효 체험', education: '교육 이용', zoneVisits: '구역 방문',
      };
      const nums = Object.entries(d).filter(([, v]) => typeof v === 'number' || (typeof v === 'string' && /^\d+$/.test(v)));
      const arrays = Object.entries(d).filter(([, v]) => Array.isArray(v));
      const objs = Object.entries(d).filter(([, v]) => v && typeof v === 'object' && !Array.isArray(v));
      const cell = (v) => (v == null ? '-' : typeof v === 'object' ? esc(JSON.stringify(v)) : esc(String(v)));
      const tableOf = (rows) => {
        const cols = Array.from(new Set(rows.flatMap((r) => (r && typeof r === 'object' ? Object.keys(r) : ['value'])))).slice(0, 6);
        return `<div class="adm-table-wrap"><table class="adm-table"><thead><tr>${cols.map((c) => `<th>${esc(LABEL[c] || c)}</th>`).join('')}</tr></thead><tbody>${rows.slice(0, 50).map((r) => `<tr>${cols.map((c) => `<td>${cell(r && typeof r === 'object' ? r[c] : r)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
      };
      pane.innerHTML = `
        <div class="row-between"><p class="dim small">서버 전체 통계 · ${esc(U.formatDate(G.time.now(), true))} 기준</p><button type="button" class="btn btn-soft btn-sm adm-retry">${ico('refresh', 'ico-sm')}새로고침</button></div>
        <div class="adm-tiles">${nums.map(([k, v]) => tile(LABEL[k] || k, fmt(Number(v)))).join('') || '<div class="empty">표시할 수치가 없어요.</div>'}</div>
        ${objs.map(([k, v]) => {
          const ent = Object.entries(v).filter(([, x]) => typeof x === 'number');
          return ent.length ? `<h4 class="adm-h">${esc(LABEL[k] || k)}</h4>${barRows(ent.map(([a, x]) => ({ label: G.world.zoneById?.(a)?.name || G.data.quests?.[a]?.title || a, value: x, text: fmt(x) })))}` : '';
        }).join('')}
        ${arrays.map(([k, v]) => `<h4 class="adm-h">${esc(LABEL[k] || k)} (${v.length})</h4>${v.length ? tableOf(v) : '<div class="empty">없음</div>'}`).join('')}`;
      G.ui.hydrateIcons(pane);
      pane.querySelector('.adm-retry')?.addEventListener('click', reload);
    },
  };

  // ================================================================ mobile helpers
  function buildMobileToggles() {
    const hud = $('#hud');
    if (!hud || hud.querySelector('.app-mobile-toggles')) return;
    const box = h('div', { class: 'app-mobile-toggles', role: 'group', 'aria-label': '패널 보기' });
    box.innerHTML = `<button type="button" data-mt="chat" aria-label="채팅 보기" aria-pressed="false">${ico('chat')}<small>채팅</small></button>
      <button type="button" data-mt="quests" aria-label="퀘스트 보기" aria-pressed="false">${ico('quest')}<small>퀘스트</small></button>`;
    G.ui.hydrateIcons(box);
    box.addEventListener('click', (e) => {
      const b = e.target.closest('[data-mt]');
      if (!b) return;
      const cls = b.dataset.mt === 'chat' ? 'show-chat' : 'show-quests';
      if (b.dataset.mt === 'chat' && G.sys.social?.toggleChat) G.sys.social.toggleChat();
      else document.body.classList.toggle(cls);
      if (b.dataset.mt === 'quests' && document.body.classList.contains('show-quests')) document.body.classList.remove('show-chat');
      if (b.dataset.mt === 'chat' && document.body.classList.contains('show-chat')) document.body.classList.remove('show-quests');
      syncMobileToggles();
      G.sfx('click');
    });
    hud.appendChild(box);
    // keep the pressed state in sync with other code paths (chat button in the left menu etc.)
    if (typeof MutationObserver === 'function') new MutationObserver(syncMobileToggles).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  }
  function syncMobileToggles() {
    const box = $('.app-mobile-toggles');
    if (!box) return;
    for (const b of box.querySelectorAll('[data-mt]')) {
      const on = document.body.classList.contains(b.dataset.mt === 'chat' ? 'show-chat' : 'show-quests');
      if (b.classList.contains('on') !== on) { b.classList.toggle('on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); }
    }
  }

  // ================================================================ app core
  const app = {
    loggedIn: false,
    _entering: false,
    _leaving: false,
    _booted: false,
    _applying: false,
    title: Title,
    onboarding: Onboarding,
    portrait: Portrait,
    debug: Debug,
    avatarEditor: AvatarEditor,
    auth,
    profiles: Profiles,
    get version() { return G.VERSION; },

    async start() {
      if (this._booted) return;
      this._booted = true;
      const L = G.ui.loading;
      try {
        L.show();
        L.set(0.02, '네트워크 확인 중');
        try { await G.net.detect(); } catch (e) { G.log.warn('NETWORK', 'detect failed', e); }
        if (isServer()) { L.set(0.04, '계정 확인 중'); await auth.checkServer(); }
        await G.initSystems((f, label) => L.set(0.05 + f * 0.85, `${label} 준비 중`));
        L.set(0.93, '체험관 문을 여는 중');
        G.ui.setHudVisible(false);
        try { G.sys.camera?.cinematic?.({ ...CINE, duration: 0 }); } catch (e) { G.log.warn('UI', 'cinematic failed', e); }
        G.loop.start();
        // the first frames compile shaders: keep them behind the loading screen
        await U.nextFrame();
        await U.nextFrame();
        if (G.flags.autostart) {
          L.set(0.97, '게스트로 입장하는 중');
          const profile = await auth.guest();
          const ok = await this.enterGame(profile, { auto: true });
          L.set(1, '입장!');
          L.hide();
          if (!ok) Title.show();
          return;
        }
        Title.show();
        L.set(1, '준비 완료');
        L.hide();
      } catch (e) {
        G.log.error('CORE', 'app start failed', e);
        G.showFatal(e);
      }
    },

    /** the single login path (title buttons, forms, autostart) */
    async enterGame(profile, opts = {}) {
      if (this._entering || !profile) return false;
      if (this.loggedIn) { G.log.warn('AUTH', 'enterGame while logged in -> ignored'); return false; }
      this._entering = true;
      const mode = profile.kind === 'server' ? 'server' : 'local';
      try {
        auth.current = profile;
        if (mode === 'server') {
          // never start from an empty state because the server was briefly unreachable (autosave would overwrite it)
          try { await G.net.request('player/get.php', { timeout: 9000 }); }
          catch (e) { if (e?.code === 'NETWORK_ERROR' || !(e?.status >= 400 && e?.status < 500) || e?.status === 401) throw new AuthError(e?.status === 401 ? '로그인이 만료되었어요. 다시 로그인해 주세요.' : '서버에서 저장 데이터를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.'); }
        }
        Title.hide();
        G.save.useProfile({ id: profile.id, nickname: profile.nickname, email: profile.email || '', role: profile.role || 'user', guest: profile.kind === 'guest', kind: profile.kind }, mode);
        const state = await G.save.load();
        G.state = state;
        const isNew = !!state._isNew;
        if (!state.tutorial || typeof state.tutorial !== 'object') state.tutorial = { step: 0, done: false };
        this._applying = true;
        try { G.applyState(); } finally { this._applying = false; }
        try { G.sys.camera?.setMode?.('follow'); } catch (e) { G.log.warn('UI', 'camera follow failed', e); }
        G.ui.setHudVisible(true);
        if (!G.loop.running) G.loop.start();
        G.save.startAutosave();
        G.ready = true;
        this.loggedIn = true;
        const pub = { id: profile.id, nickname: profile.nickname, email: profile.email || '', role: profile.role || 'user', kind: profile.kind };
        Profiles.upsert({ id: indexId(profile), kind: profile.kind, nickname: profile.nickname, email: profile.email || '', role: pub.role, level: state.stats?.level || 1, lastPlayed: now(), playTime: state.stats?.playTime || 0 });
        Profiles.setLast(indexId(profile));
        G.log.info('AUTH', `enter game: ${profile.kind} ${profile.id}${isNew ? ' (new profile)' : ''} · save=${mode}`);
        G.bus.emit('game:login', { profile: pub, isNew });
        G.bus.emit('game:ready');
        if (isNew) G.dirty('new-profile');
        const nick = profile.nickname;
        setTimeout(() => {
          if (!this.loggedIn) return;
          G.ui.toast(isNew ? `${nick}님, 전통발효체험관에 오신 것을 환영해요!` : `${nick}님, 다시 오신 것을 환영해요!`, { type: 'success', emoji: '🏮' });
        }, opts.auto ? 400 : 900);
        setTimeout(() => { if (this.loggedIn && G.state === state) Onboarding.sync(state, isNew); }, opts.auto ? 600 : 1500);
        Portrait.schedule(1400);
        return true;
      } catch (e) {
        G.log.error('AUTH', 'enter game failed', e);
        auth.current = null;
        if (!this.loggedIn) {
          G.save.stopAutosave();
          G.state = null;
          if (!Title.open) Title.show();
        }
        G.ui.toast(e?.message || '게임에 들어가지 못했어요. 잠시 후 다시 시도해 주세요.', { type: 'error' });
        return false;
      } finally { this._entering = false; }
    },

    async logout(opts = {}) {
      if (!this.loggedIn || this._leaving) return false;
      if (opts.confirm !== false) {
        const ok = await G.ui.confirm('로그아웃할까요?<br><span class="small dim">진행 상황은 저장되고, 다시 로그인하면 이어서 할 수 있어요.</span>', { title: '로그아웃', icon: 'logout', okText: '로그아웃', html: true });
        if (!ok) return false;
      }
      if (!this.loggedIn || this._leaving) return false;
      this._leaving = true;
      try {
        try { if (G.sys.photo?.active) G.sys.photo.exit?.(); } catch (e) { /* ignore */ }
        try { if (G.sys.dialogue?.active) G.sys.dialogue.close?.(); } catch (e) { /* ignore */ }
        G.ui.modal.closeAll();
        G.ui.popover.close();
        Onboarding.stop();
        Debug.hide();
        const saved = await saveNow('logout', false);
        if (!saved && G.state) {
          const go = await G.ui.confirm('진행 상황을 저장하지 못했어요. 그래도 로그아웃할까요?<br><span class="small dim">마지막 저장 이후의 기록이 사라질 수 있어요.</span>', { title: '저장 실패', icon: 'save', okText: '그래도 로그아웃', danger: true, html: true });
          if (!go) return false;
        }
        G.save.stopAutosave();
        const prof = auth.current;
        if (prof && G.state) Profiles.upsert({ id: indexId(prof), level: G.state.stats?.level || 1, lastPlayed: now(), playTime: G.state.stats?.playTime || 0 });
        G.logoutSystems();
        G.state = null;
        this.loggedIn = false;
        G.ui.setHudVisible(false);
        G.ui.objective?.(null);
        G.ui.banner?.(null);
        document.body.classList.remove('show-chat', 'show-quests');
        Portrait.reset();
        await auth.logout();
        G.bus.emit('game:logout', { profile: prof ? { id: prof.id, nickname: prof.nickname, kind: prof.kind } : null });
        Title.show();
        G.ui.toast('로그아웃했어요. 다음에 또 만나요!', { type: 'info', emoji: '👋' });
        return true;
      } catch (e) {
        G.log.error('AUTH', 'logout failed', e);
        G.ui.toast('로그아웃 중 문제가 생겼어요.', { type: 'error' });
        return false;
      } finally { this._leaving = false; }
    },

    showTitle(view) { if (!this.loggedIn) Title.show(view); },
    openMenu, openSettings, openHelp, openCredits, openTerms, openAdmin,
    openAvatar() { return AvatarEditor.open(); },
    toggleDebug() { return Debug.toggle(); },
    closeMenu() { G.ui.modal.get('app-menu')?.close(); },
    saveNow,
  };
  G.app = app;

  // ================================================================ system (actions, hotkeys, per-frame onboarding/debug)
  G.register({
    name: 'app', order: 90, label: '메뉴·설정',

    init() {
      Onboarding.init();
      buildMobileToggles();
      const A = G.ui.onAction;
      A('menu', () => { if (app.loggedIn) openMenu(); });
      A('avatar', () => { if (app.loggedIn) AvatarEditor.open(); });
      A('help', () => openHelp());
      A('settings', () => openSettings());
      A('logout', () => app.logout({ confirm: true }));
      A('save', () => saveNow('manual', true));
      G.bus.on('input:menu', () => {
        if (Title.open || !app.loggedIn || app._entering || app._leaving) return;
        if (G.sys.photo?.active || Onboarding.final) return;
        openMenu();
      });
      // H: help (works over the title screen too); toggles when help is the top window
      G.input?.onKey?.('KeyH', () => {
        const top = G.ui.modal.top();
        if (top && top.id !== 'app-help') return false;
        if (G.sys.photo?.active || G.sys.dialogue?.active) return false;
        openHelp();
        return true;
      }, { allowInModal: true });
      const dbg = () => { if (!app.loggedIn) return false; Debug.toggle(); return true; };
      G.input?.onKey?.('F9', dbg, { allowInModal: true });
      G.input?.onKey?.('Backquote', dbg, { allowInModal: true });
      // title screen: Esc goes back from the forms and never reaches the game menu
      G.ui.onEscape(() => {
        if (!Title.open) return false;
        if (Title.view !== 'home') { Title.setView('home'); G.sfx('close'); }
        return true;
      }, 60);
      G.bus.on('state:saved', () => {
        const cur = auth.current;
        if (!cur || !G.state || !app.loggedIn) return;
        Profiles.upsert({ id: indexId(cur), level: G.state.stats?.level || 1, playTime: G.state.stats?.playTime || 0, lastPlayed: now(), nickname: G.state.profile?.nickname || cur.nickname });
      });
      G.bus.on('player:appearance', () => { if (app.loggedIn && !app._applying) Portrait.schedule(500); });
      G.bus.on('engine:quality', () => {
        const m = G.ui.modal.get('app-settings');
        if (m && m.body.querySelector('.set-pane')?.dataset.tab === 'graphics') m._renderPane?.();
        if (Debug.open) Debug._sync();
      });
      G.bus.on('settings:changed', ({ key } = {}) => { if (Debug.open && (key === 'showFps' || key === 'quality')) Debug._sync(); });
      G.bus.on('weather:changed', () => { if (Debug.open) Debug._sync(); });
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && Title.open) Title.renderHome(); });
    },

    onStateLoaded(state) {
      if (!state) return;
      if (!state.tutorial || typeof state.tutorial !== 'object') state.tutorial = { step: 0, done: false };
      // re-applied state during a session (reset / import / server restore): re-evaluate onboarding + portrait
      if (!app._applying && app.loggedIn) {
        Onboarding.sync(state, !!state._isNew);
        Portrait.schedule(600);
      }
    },

    update(dt) {
      Onboarding.update(dt);
      Debug.update(dt);
    },

    onLogout() {
      Onboarding.stop();
      Debug.hide();
      for (const id of ['app-menu', 'app-settings', 'app-avatar', 'app-admin', 'app-help']) G.ui.modal.get(id)?.close();
    },
  });
})();
