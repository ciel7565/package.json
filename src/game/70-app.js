// =============================================================================
// 70-app.js — app shell: boot flow, auth, title screen, onboarding, menus, settings,
//             help, avatar customizer, fallback debug/admin tools  (G.app, G.auth; system 'app', order 90)
//
//   G.app.start()                     loading (per-system progress + tips) -> title screen over a cinematic
//                                     orbit, or ?autostart=1 -> guest login straight away
//   G.app.enterGame(profile)          useProfile -> load -> applyState -> camera follow -> HUD -> autosave ->
//                                     G.ready -> game:login {profile, isNew} + game:ready (once per login) -> onboarding
//   G.app.logout({confirm})           G.save.save -> G.logoutSystems() -> G.state = null -> title (G.ready stays true)
//   G.app.showTitle(view) / openMenu() / openSettings(tab) / openHelp(tab) / openAvatar() / openDevCenter()
//   G.app.openCredits() / openTerms() / upgradeGuest() / onboarding / portrait
//
// 쉬운 모드 (CONTRACT §12, easy mode is the default):
//   * title  : kid view — big face cards "🙂 다시 놀기" for the kid profiles of this device, a "새 친구" builder
//              (kid-safe name from G.easy.nameIdeas + 🎲, one of 6 looks) and a giant "▶ 놀러 가기!"; 옹이 greets
//              by voice; 👨‍👩‍👧 어른 메뉴 (parent gate) shows the classic title (login/register/recent list); the
//              👶 쉬운 모드 / 🧑 일반 모드 chip switches with G.easy.set (turning it off asks the gate).
//              Kid profiles are guest slots 'guest' and 'guest_xxxxxxxx' (≤ 6); a NEW profile plays in the mode it was
//              created in (title mode, or the register form's "누가 놀아요?" choice); existing saves keep their own.
//   * menu   : openMenu() = picture tiles in easy mode; openMenu({adult:true}) = the full menu (after the gate)
//   * settings: openSettings() = 4 big kid controls (소리 · 음악 · 읽어주기 · 쉬운 모드) without a gate;
//              openSettings(tab | {adult}) = full settings behind the gate, incl. the 👶 아이 보호 tab
//              (easyMode via G.easy.set, voiceGuide, voiceRate, playReminderMin, kidChat*, parentGate* — *gated)
//   * help   : picture cards with voice (openHelp(tab, {full:true}) = the adult help)
//   * onboarding: move → 👉 같이 가기 → 👆 인사 → 🎉 (voice + G.easy.point hand, auto-advance on the real action)
//   * avatar : emoji category tabs, big swatches/chips, 🎲, name ideas — no typing
//   * gated  : logout, login/register, upgradeGuest, reset, import/export, delete account, forget profile,
//              developer center / admin / debug fallback (80-devcenter gates its own open())
//   G.auth = { current, register(form), login(form), guest(), resume(entry), logout(), checkServer(),
//              changeNickname(nick), changePassword(cur, next), deleteAccount(pw), accounts(), validate,
//              strength, selfTest() }
//
// Security (CONTRACT §11.1):
//   * local accounts: PBKDF2-HMAC-SHA256 (WebCrypto, 600k iterations, 16-byte random salt, per-account params),
//     pure-JS PBKDF2 only when crypto.subtle is unavailable (insecure http origin) — same algorithm, so the
//     account works in both; legacy SHA-256 / cyrb53 hashes are verified once and upgraded on login.
//   * constant-time hash comparison, dummy derivation for unknown logins (no account enumeration by timing),
//     per-account throttle: 5 failures -> 30 s lock, doubling per repeated lock (max 15 min).
//   * plain passwords are never logged, persisted or kept after the request; "remember me" stores only the
//     profile id + an expiry; the 최근 플레이 index never stores e-mail addresses.
//   * everything rendered from storage / server / imported saves is escaped or set via textContent / style APIs.
//
// localStorage keys: tfm.v1.accounts · tfm.v1.profiles (최근 플레이) · tfm.v1.lastProfile (id only) ·
// tfm.v1.authLock (throttle) · tfm.v1.debugPanel. Onboarding state: G.state.tutorial {step, done, skipped}.
// Hotkeys: Esc (input:menu) main menu · H help · F9 / ` developer center (fallback debug panel).
// Actions: menu avatar help settings logout save devcenter. (08-easy owns stickerbook/today/express/sound/where/kid-chat)
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
  const reduceMotion = () => !!G.settings?.reduceMotion || (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);

  const CINE = { center: [0, 4, -30], radius: 95, height: 42, speed: 0.025 };
  const KEYS = {
    accounts: 'tfm.v1.accounts',
    profiles: 'tfm.v1.profiles',
    last: 'tfm.v1.lastProfile',
    lock: 'tfm.v1.authLock',
    debugPos: 'tfm.v1.debugPanel',
  };
  const SAVE_KEY = (id) => `tfm.v1.save.${id}`;
  const IDLE = { speed: 0, grounded: true, vy: 0 };
  const REMEMBER_MS = 30 * 86400000; // "로그인 상태 유지" lasts 30 days

  // ---------------------------------------------------------------- phase-2 settings (core defaults lack them)
  const EXTRA_DEFAULTS = { fxLevel: G.settingsDefaults?.fxLevel || 'high', companion: true }; // 66-fx registers 'low' on touch devices
  for (const [k, v] of Object.entries(EXTRA_DEFAULTS)) {
    if (G.settingsDefaults && !(k in G.settingsDefaults)) G.settingsDefaults[k] = v;
    if (G.settings && G.settings[k] === undefined) G.settings[k] = v;
  }
  /** repair odd values (old/imported saves, hand-edited storage) without firing change events */
  const SETTING_RULES = {
    volumeMaster: [0, 1], volumeMusic: [0, 1], volumeSfx: [0, 1], volumeAmbient: [0, 1],
    uiScale: [0.85, 1.3], sensitivity: [0.3, 2.5],
    quality: ['auto', 'low', 'medium', 'high'], fxLevel: ['off', 'low', 'high'],
  };
  const BOOL_SETTINGS = ['muted', 'shadows', 'bloom', 'invertY', 'highContrast', 'largeText', 'reduceMotion', 'subtitles', 'voiceOver',
    'showFps', 'minimapVisible', 'chatVisible', 'clickToMove', 'cameraShake', 'autoWeather', 'lockTime', 'companion'];
  function sanitizeSettings() {
    const S = G.settings, D = G.settingsDefaults || {};
    if (!S) return;
    let changed = false;
    // the core validator (03-state, §12.1) knows every default's type and range; this adds the app's enums on top
    if (typeof G.sanitizeSetting === 'function') {
      for (const k of Object.keys(D)) {
        if (!(k in S)) continue;
        const v = G.sanitizeSetting(k, S[k]);
        if (v !== S[k]) { S[k] = v; changed = true; }
      }
    }
    for (const [k, rule] of Object.entries(SETTING_RULES)) {
      const v = S[k];
      if (typeof rule[0] === 'number') {
        const n = Number(v);
        const fixed = Number.isFinite(n) ? U.clamp(n, rule[0], rule[1]) : D[k];
        if (fixed !== v) { S[k] = fixed; changed = true; }
      } else if (!rule.includes(v)) { S[k] = D[k] ?? rule[0]; changed = true; }
    }
    for (const k of BOOL_SETTINGS) if (k in S && typeof S[k] !== 'boolean') { S[k] = k in D ? !!D[k] : !!S[k]; changed = true; }
    if (changed) { try { G.applySettingsToDom?.(); } catch (e) { /* ignore */ } }
  }
  sanitizeSettings();

  // ---------------------------------------------------------------- small helpers
  const store = {
    get(k, def) { try { const r = localStorage.getItem(k); return r == null ? def : JSON.parse(r); } catch (e) { return def; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { G.log.warn('SAVE', `localStorage write failed (${k})`); return false; } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } },
    raw(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    setRaw(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } },
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
  function initialOf(name) { return Array.from(String(name || '?').trim())[0] || '?'; }
  /** only our own canvas portraits (PNG data URLs) may become CSS background images */
  const RX_PORTRAIT = /^data:image\/png;base64,[A-Za-z0-9+/]+=*$/;
  function safePortrait(url) { return typeof url === 'string' && url.length < 60000 && RX_PORTRAIT.test(url) ? url : null; }
  function setPortraitBg(el, url, fallbackText) {
    const ok = safePortrait(url);
    el.textContent = ok ? '' : fallbackText;
    el.classList.toggle('has-img', !!ok);
    el.style.backgroundImage = ok ? `url("${ok}")` : '';
  }
  function maskEmail(e) {
    const s = String(e || '');
    const at = s.indexOf('@');
    if (at < 1) return s ? '***' : '';
    const local = s.slice(0, at);
    return `${local.slice(0, Math.min(2, local.length))}${'*'.repeat(Math.max(2, local.length - 2))}${s.slice(at)}`;
  }
  /** keep Tab focus inside `root` (title screen, coach card) */
  function trapTab(root, e) {
    if (e.key !== 'Tab' || !root) return;
    const items = $$('button:not([disabled]), input:not([disabled]):not([type=hidden]), [tabindex]:not([tabindex="-1"]), a[href], select, textarea', root)
      .filter((el) => el.offsetParent !== null && !el.closest('[hidden]'));
    if (!items.length) return;
    const first = items[0], last = items[items.length - 1];
    const a = document.activeElement;
    if (e.shiftKey && (a === first || !root.contains(a))) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && (a === last || !root.contains(a))) { e.preventDefault(); first.focus(); }
  }

  // ---------------------------------------------------------------- mascot (옹이) — G.mascot (65-companion) or a built-in fallback
  function ownMascot(mood = 'happy', size = 96) {
    const ink = '#2a170d';
    let eyes;
    switch (mood) {
      case 'wink': eyes = `<circle cx="40" cy="62" r="4.4" fill="${ink}"/><path d="M55 62q5-5 10 0" stroke="${ink}" stroke-width="3.4" fill="none" stroke-linecap="round"/>`; break;
      case 'cheer': eyes = `<path d="M35 63q5-6.5 10 0M55 63q5-6.5 10 0" stroke="${ink}" stroke-width="3.4" fill="none" stroke-linecap="round"/>`; break;
      case 'surprised': eyes = `<circle cx="40" cy="61" r="5.2" fill="${ink}"/><circle cx="60" cy="61" r="5.2" fill="${ink}"/><circle cx="41.6" cy="59.4" r="1.6" fill="#fff"/><circle cx="61.6" cy="59.4" r="1.6" fill="#fff"/>`; break;
      case 'think': eyes = `<circle cx="41" cy="60" r="4.2" fill="${ink}"/><circle cx="61" cy="60" r="4.2" fill="${ink}"/><path d="M34 52l9-2M57 50l9 2" stroke="${ink}" stroke-width="2.4" stroke-linecap="round"/>`; break;
      case 'sleepy': eyes = `<path d="M35 62h10M55 62h10" stroke="${ink}" stroke-width="3.2" stroke-linecap="round"/>`; break;
      case 'sad': eyes = `<circle cx="40" cy="62" r="4.2" fill="${ink}"/><circle cx="60" cy="62" r="4.2" fill="${ink}"/><path d="M34 53l9 3M66 53l-9 3" stroke="${ink}" stroke-width="2.4" stroke-linecap="round"/>`; break;
      default: eyes = `<circle cx="40" cy="62" r="4.6" fill="${ink}"/><circle cx="60" cy="62" r="4.6" fill="${ink}"/><circle cx="41.6" cy="60.4" r="1.6" fill="#fff"/><circle cx="61.6" cy="60.4" r="1.6" fill="#fff"/>`;
    }
    const mouth = mood === 'surprised' ? `<ellipse cx="50" cy="75" rx="4.2" ry="5" fill="#6b2a16"/>`
      : mood === 'think' || mood === 'sleepy' ? `<path d="M45 75q5 2.5 10 0" stroke="#6b2a16" stroke-width="2.6" fill="none" stroke-linecap="round"/>`
        : mood === 'sad' ? `<path d="M44 77q6-5 12 0" stroke="#6b2a16" stroke-width="2.6" fill="none" stroke-linecap="round"/>`
          : `<path d="M42 71q8 10 16 0z" fill="#6b2a16"/><path d="M46 74.5q4 3 8 0" fill="#ff8a7a"/>`;
    return `<svg class="mascot-svg" viewBox="0 0 100 112" width="${size}" height="${Math.round(size * 1.12)}" aria-hidden="true">`
      + `<ellipse cx="50" cy="106" rx="30" ry="5" fill="rgba(0,0,0,.22)"/>`
      + `<path d="M50 4c2 6 9 8 9 8s-7 1.5-9 9c-2-7.5-9-9-9-9s7-2 9-8z" fill="#ffe08a"/>`
      + `<path d="M50 22c-3-6-10-8-15-6 3 6 9 8 15 6zM50 22c3-6 10-8 15-6-3 6-9 8-15 6z" fill="#6fcf73"/>`
      + `<ellipse cx="50" cy="27" rx="24" ry="6.5" fill="#3b2216"/><ellipse cx="50" cy="25.5" rx="19" ry="4" fill="#5a3a26"/>`
      + `<path d="M22 32c-15 20-13 56 9 70h38c22-14 24-50 9-70z" fill="#8d5733"/>`
      + `<path d="M22 32c-15 20-13 56 9 70h10c-16-12-20-46-8-70z" fill="#6f4126" opacity=".55"/>`
      + `<path d="M24 46h52" stroke="#f4c54a" stroke-width="3" stroke-linecap="round"/>`
      + `<ellipse cx="33" cy="58" rx="4.5" ry="12" fill="#fff" opacity=".14"/>`
      + `<ellipse cx="31" cy="72" rx="6" ry="3.6" fill="#ff8f8f" opacity=".55"/><ellipse cx="69" cy="72" rx="6" ry="3.6" fill="#ff8f8f" opacity=".55"/>`
      + eyes + mouth + `</svg>`;
  }
  /** -> SVG markup (our own generated code, trusted) */
  function mascotSvg(mood = 'happy', size = 96) {
    try {
      const s = G.mascot?.svg?.(mood, size);
      if (typeof s === 'string' && /^\s*<svg[\s>]/.test(s)) return s;
    } catch (e) { /* companion module optional */ }
    return ownMascot(mood, size);
  }

  // ================================================================ 쉬운 모드 helpers (CONTRACT §12) — every call is optional-chained
  /** easy mode on? (G.easy when 08-easy loaded, otherwise the raw setting) */
  const easyOn = () => (typeof G.easy?.on === 'boolean' ? G.easy.on : G.settings?.easyMode !== false);
  /** voice guide (no-op outside easy mode unless opts.force; never throws) */
  function say(text, opts) { try { return G.easy?.say?.(text, opts) || Promise.resolve(false); } catch (e) { return Promise.resolve(false); } }
  /**
   * parent gate before grown-up screens (§12.4). Resolves true right away outside easy mode / with parentGate off /
   * while unlocked. Without 08-easy the app stays usable for adults (the gate is a UX barrier, not an auth boundary).
   */
  async function parentGate(reason, title, text) {
    if (typeof G.easy?.gate !== 'function') return true;
    try { return (await G.easy.gate({ reason, title, text })) === true; } catch (e) { G.log.warn('UI', 'parent gate failed', e?.message || e); return false; }
  }
  /** will a gate actually be shown (vs. skipped / still unlocked)? */
  function gateWillShow() {
    try { const s = G.easy?.gateStatus?.(); return !!(s && s.required && !s.unlocked); } catch (e) { return false; }
  }
  /** picture confirm in easy mode, the regular (html) confirm otherwise */
  function askConfirm(kid, html, opts = {}) {
    if (easyOn() && typeof G.easy?.confirm === 'function') return G.easy.confirm(kid);
    return G.ui.confirm(html, { html: true, ...opts });
  }
  /** a pre-made look a child can pick on the title screen (G.avatar.presets when the avatar module ships them) */
  const KID_LOOKS = [
    { id: 'farmer', emoji: '🧑‍🌾', say: '농부 친구', app: { skin: '#f6d0b1', hair: 'short', hairColor: '#3a2a20', top: 'apron', topColor: '#9bd27a', bottom: 'pants', bottomColor: '#5a4636', shoes: '#7a4a2c', bag: 'basket', bagColor: '#b88a4a', accessory: 'strawhat', accessoryColor: '#e2c27a', face: 'cheer', height: 1 } },
    { id: 'hanbok', emoji: '👘', say: '한복 친구', app: { skin: '#f6d0b1', hair: 'bun', hairColor: '#1f1a18', top: 'hanbok', topColor: '#f08bb0', bottom: 'skirt', bottomColor: '#b45a73', shoes: '#ffffff', bag: 'pouch', bagColor: '#f4c54a', accessory: 'none', accessoryColor: '#1f1f22', face: 'smile', height: 0.95 } },
    { id: 'explorer', emoji: '🧢', say: '탐험가 친구', app: { skin: '#efc6a2', hair: 'short', hairColor: '#4a3a2c', top: 'tshirt', topColor: '#ffd766', bottom: 'shorts', bottomColor: '#2f6f8f', shoes: '#d9534f', bag: 'backpack', bagColor: '#3b5ba5', accessory: 'cap', accessoryColor: '#d9534f', face: 'cheer', height: 0.95 } },
    { id: 'cook', emoji: '🧑‍🍳', say: '요리사 친구', app: { skin: '#e6b48d', hair: 'ponytail', hairColor: '#6b4a2e', top: 'apron', topColor: '#ffffff', bottom: 'pants', bottomColor: '#2c3540', shoes: '#f5f0e6', bag: 'none', bagColor: '#8a5a3b', accessory: 'headband', accessoryColor: '#f4c54a', face: 'smile', height: 1 } },
    { id: 'hoodie', emoji: '🐻', say: '곰돌이 친구', app: { skin: '#d9a77f', hair: 'curly', hairColor: '#2f2520', top: 'hoodie', topColor: '#8b6fd6', bottom: 'pants', bottomColor: '#3b5ba5', shoes: '#ffffff', bag: 'backpack', bagColor: '#f4c54a', accessory: 'none', accessoryColor: '#1f1f22', face: 'cheer', height: 0.9 } },
    { id: 'scholar', emoji: '👓', say: '책벌레 친구', app: { skin: '#f6d0b1', hair: 'long', hairColor: '#8a5a34', top: 'shirt', topColor: '#6fc3df', bottom: 'skirt', bottomColor: '#3f5a3c', shoes: '#2a1d14', bag: 'pouch', bagColor: '#d9534f', accessory: 'glasses', accessoryColor: '#1f1f22', face: 'calm', height: 1.05 } },
  ];
  function kidLooks() {
    const pre = G.avatar?.presets;
    if (Array.isArray(pre) && pre.length >= 6) {
      const out = [];
      pre.slice(0, 6).forEach((p, i) => {
        const app = p && typeof p === 'object' ? (p.appearance && typeof p.appearance === 'object' ? p.appearance : p) : null;
        if (!app) return;
        const base = KID_LOOKS[i];
        out.push({ id: `preset${i}`, emoji: typeof p.emoji === 'string' && p.emoji.length <= 16 ? p.emoji : base.emoji, say: typeof p.label === 'string' ? p.label.slice(0, 20) : base.say, app });
      });
      if (out.length === 6) return out;
    }
    return KID_LOOKS;
  }
  /** kid guest profiles: 'guest' (first) and guest_xxxxxx — the guest_ prefix keeps 60-social treating them as guests */
  const RX_GUEST_ID = /^guest(?:_[a-z0-9]{4,16})?$/;
  const KID_MAX = 6;

  // ================================================================ validation (mirrors server/lib/Users.php)
  const RX_EMAIL = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*\.[A-Za-z]{2,24}$/;
  const RX_NICK = /^[가-힣a-zA-Z0-9_]+$/;
  const RESERVED = ['관리자', '운영자', '운영진', '시스템', 'admin', 'administrator', 'root', 'gm', 'system', 'moderator',
    '발효마스터', '산골농부', '전통사랑', '장독지기', '안내원', 'null', 'undefined', 'server', '서버', '옹이'];
  const WEAK = ['password1', 'password12', 'password123', 'qwerty123', 'qwer1234', 'asdf1234', 'abcd1234', 'abc12345', 'a1234567',
    'a12345678', 'test1234', 'admin123', 'admin1234', 'iloveyou1', 'q1w2e3r4', '1q2w3e4r', '1q2w3e4r5t', 'zxcv1234', 'aa123456', 'qwerty12'];
  function hasBadWord(s) {
    const low = String(s || '').toLowerCase();
    return (G.data.badWords || []).some((w) => w && low.includes(String(w).toLowerCase()));
  }
  const normText = (v) => String(v ?? '').normalize('NFC').trim();
  const V = {
    email(v) {
      v = normText(v);
      if (!v) return '이메일을 입력해 주세요.';
      const local = v.split('@')[0] || '';
      if (v.length > 120 || local.length > 64 || /\.\./.test(v) || /^\.|\.@/.test(v) || !RX_EMAIL.test(v)) return '이메일 형식이 올바르지 않아요. (예: name@example.com)';
      return '';
    },
    /** opts: {account: stricter rules, excludeId, checkTaken} */
    nickname(v, opts = {}) {
      v = normText(v);
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
    password(v, ctx = {}) {
      v = String(v ?? '');
      if (!v) return '비밀번호를 입력해 주세요.';
      if (/\s/.test(v)) return '비밀번호에는 공백을 쓸 수 없어요.';
      const n = Array.from(v).length;
      if (n < 8) return '비밀번호는 8자 이상이어야 해요.';
      if (n > 64) return '비밀번호는 64자 이하로 입력해 주세요.';
      if (!/[A-Za-z]/.test(v) || !/[0-9]/.test(v)) return '영문과 숫자를 모두 포함해 주세요.';
      const low = v.toLowerCase();
      if (WEAK.includes(low) || /^(.)\1{7,}$/.test(v) || /^(?:0123456789|1234567890|abcdefgh)/i.test(v)) return '너무 흔한 비밀번호예요. 다른 비밀번호를 사용해 주세요.';
      const local = normText(ctx.email).toLowerCase().split('@')[0] || '';
      const nick = normText(ctx.nickname).toLowerCase();
      if ((local.length >= 4 && low.includes(local)) || (nick.length >= 4 && low.includes(nick))) return '비밀번호에 이메일이나 닉네임을 넣지 말아 주세요.';
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
    if (v.length < 8 || V.password(v)) s = Math.min(s, 1);
    return Math.min(4, s);
  }

  // ================================================================ crypto
  // PBKDF2-HMAC-SHA256: WebCrypto when available, otherwise an equivalent pure-JS implementation (chunked).
  const PBKDF2_ITER = 600000;
  const PBKDF2_MIN = 150000;
  const ALGO = 'pbkdf2-sha256';
  const enc = new TextEncoder();
  const toHex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  function fromHex(s) {
    s = String(s || '');
    if (!/^(?:[0-9a-f]{2})+$/i.test(s)) return null;
    const out = new Uint8Array(s.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(s.substr(i * 2, 2), 16);
    return out;
  }
  const hasRandom = () => !!(window.crypto && typeof crypto.getRandomValues === 'function');
  function randomBytes(n) {
    const a = new Uint8Array(n);
    if (hasRandom()) crypto.getRandomValues(a);
    else { G.log.warn('AUTH', 'crypto.getRandomValues unavailable -> weak random salt'); for (let i = 0; i < n; i++) a[i] = Math.floor(Math.random() * 256); }
    return a;
  }
  const hasSubtle = () => !!(window.crypto && crypto.subtle && typeof crypto.subtle.importKey === 'function' && typeof crypto.subtle.deriveBits === 'function');

  // ---- pure-JS SHA-256 (FIPS 180-4) — fallback only
  const K256 = new Int32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
    0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
    0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
    0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ]);
  const IV256 = new Int32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  /** one compression round: H (8 words, in/out) over W[0..15] (message words; W is scratch of 64) */
  function compress(H, W) {
    for (let t = 16; t < 64; t++) {
      const a = W[t - 15], b = W[t - 2];
      const s0 = ((a >>> 7) | (a << 25)) ^ ((a >>> 18) | (a << 14)) ^ (a >>> 3);
      const s1 = ((b >>> 17) | (b << 15)) ^ ((b >>> 19) | (b << 13)) ^ (b >>> 10);
      W[t] = (W[t - 16] + s0 + W[t - 7] + s1) | 0;
    }
    let a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], hh = H[7];
    for (let t = 0; t < 64; t++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + S1 + ch + K256[t] + W[t]) | 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const mj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + mj) | 0;
      hh = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0; H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0;
    H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0; H[6] = (H[6] + g) | 0; H[7] = (H[7] + hh) | 0;
  }
  /** SHA-256 of bytes, optionally continuing from a state after `prefixBlocks` 64-byte blocks -> Int32Array(8) */
  function sha256Words(bytes, state = IV256, prefixBlocks = 0) {
    const H = new Int32Array(state);
    const W = new Int32Array(64);
    const len = bytes.length;
    const total = Math.ceil((len + 9) / 64) * 64;
    const buf = new Uint8Array(total);
    buf.set(bytes);
    buf[len] = 0x80;
    const bits = (len + prefixBlocks * 64) * 8;
    buf[total - 4] = (bits >>> 24) & 255; buf[total - 3] = (bits >>> 16) & 255; buf[total - 2] = (bits >>> 8) & 255; buf[total - 1] = bits & 255;
    buf[total - 5] = Math.floor(bits / 4294967296) & 255;
    for (let off = 0; off < total; off += 64) {
      for (let i = 0; i < 16; i++) { const p = off + i * 4; W[i] = (buf[p] << 24) | (buf[p + 1] << 16) | (buf[p + 2] << 8) | buf[p + 3]; }
      compress(H, W);
    }
    return H;
  }
  function wordsToBytes(words) {
    const out = new Uint8Array(words.length * 4);
    for (let i = 0; i < words.length; i++) { out[i * 4] = words[i] >>> 24; out[i * 4 + 1] = (words[i] >>> 16) & 255; out[i * 4 + 2] = (words[i] >>> 8) & 255; out[i * 4 + 3] = words[i] & 255; }
    return out;
  }
  async function pbkdf2Js(pwBytes, salt, iterations) {
    let key = pwBytes;
    if (key.length > 64) key = wordsToBytes(sha256Words(key));
    const k = new Uint8Array(64); k.set(key);
    const ip = new Uint8Array(64), op = new Uint8Array(64);
    for (let i = 0; i < 64; i++) { ip[i] = k[i] ^ 0x36; op[i] = k[i] ^ 0x5c; }
    const W = new Int32Array(64);
    const blockState = (block) => { const Hs = new Int32Array(IV256); for (let i = 0; i < 16; i++) W[i] = (block[i * 4] << 24) | (block[i * 4 + 1] << 16) | (block[i * 4 + 2] << 8) | block[i * 4 + 3]; compress(Hs, W); return Hs; };
    const istate = blockState(ip), ostate = blockState(op);
    // U1 = HMAC(P, salt || INT(1))
    const msg = new Uint8Array(salt.length + 4); msg.set(salt); msg[salt.length + 3] = 1;
    const inner1 = sha256Words(msg, istate, 1);
    let u = sha256Words(wordsToBytes(inner1), ostate, 1);
    const T = new Int32Array(u);
    const Hn = new Int32Array(8);
    const inner = new Int32Array(8);
    for (let it = 1; it < iterations; it++) {
      // inner = H(ipad || u): one block holding 32 bytes of data + padding (total length 96 bytes = 768 bits)
      for (let i = 0; i < 8; i++) W[i] = u[i]; // copy first: u may alias Hn
      Hn.set(istate);
      W[8] = 0x80000000 | 0; W[9] = 0; W[10] = 0; W[11] = 0; W[12] = 0; W[13] = 0; W[14] = 0; W[15] = 768;
      compress(Hn, W);
      inner.set(Hn);
      Hn.set(ostate);
      for (let i = 0; i < 8; i++) W[i] = inner[i];
      W[8] = 0x80000000 | 0; W[9] = 0; W[10] = 0; W[11] = 0; W[12] = 0; W[13] = 0; W[14] = 0; W[15] = 768;
      compress(Hn, W);
      u = Hn;
      for (let i = 0; i < 8; i++) T[i] ^= Hn[i];
      if ((it & 16383) === 0) await new Promise((r) => setTimeout(r, 0)); // keep the UI responsive
    }
    return wordsToBytes(T);
  }
  async function pbkdf2Hex(password, saltHex, iterations) {
    const salt = fromHex(saltHex);
    if (!salt) throw new Error('bad salt');
    const pw = enc.encode(String(password));
    if (hasSubtle()) {
      const key = await crypto.subtle.importKey('raw', pw, 'PBKDF2', false, ['deriveBits']);
      const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
      return toHex(new Uint8Array(bits));
    }
    if (!pbkdf2Hex._warned) { pbkdf2Hex._warned = true; G.log.warn('AUTH', 'crypto.subtle unavailable (insecure origin) -> pure-JS PBKDF2 fallback'); }
    return toHex(await pbkdf2Js(pw, salt, iterations));
  }
  async function sha256Hex(text) {
    const bytes = enc.encode(text);
    if (hasSubtle() && typeof crypto.subtle.digest === 'function') return toHex(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)));
    return toHex(wordsToBytes(sha256Words(bytes)));
  }
  /** legacy (pre-PBKDF2) fallback hash of the first app build — verify-only */
  function legacyCyrb(text) {
    let x = text;
    for (let i = 0; i < 4096; i++) x = U.hash(`${x}:${i}:${text.length}`) + U.hash(`${i}|${x}`);
    return x;
  }
  /** constant-time string comparison (hex digests) */
  function safeEqual(a, b) {
    a = String(a ?? ''); b = String(b ?? '');
    let diff = a.length ^ b.length;
    const n = Math.max(a.length, b.length);
    for (let i = 0; i < n; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
    return diff === 0;
  }
  async function makeHash(password) {
    const salt = toHex(randomBytes(16));
    const iter = PBKDF2_ITER;
    return { algo: ALGO, salt, iter, hash: await pbkdf2Hex(password, salt, iter) };
  }
  async function verifyHash(acc, password) {
    switch (acc.algo) {
      case ALGO: {
        const iter = Math.max(1, Math.floor(Number(acc.iter) || 0));
        if (iter < 1000 || iter > 5000000) return false;
        return safeEqual(await pbkdf2Hex(password, acc.salt, iter), acc.hash);
      }
      case 'sha256': return safeEqual(await sha256Hex(`${acc.salt}${password}`), acc.hash);
      case 'cyrb53x4096': return safeEqual(legacyCyrb(`${acc.salt}${password}`), acc.hash);
      default: return false;
    }
  }
  const needsRehash = (acc) => acc.algo !== ALGO || !(Number(acc.iter) >= PBKDF2_ITER) || !fromHex(acc.salt) || fromHex(acc.salt).length < 16;
  /** equalise timing for unknown logins */
  const DUMMY_SALT = '00112233445566778899aabbccddeeff';
  const dummyDerive = (pw) => pbkdf2Hex(pw || 'x', DUMMY_SALT, PBKDF2_ITER).catch(() => '');

  /** in-browser self test (dev center): JS PBKDF2 / SHA-256 vs WebCrypto + known vectors */
  async function cryptoSelfTest() {
    const res = [];
    const add = (name, ok, detail = '') => res.push({ name, ok: !!ok, detail });
    try {
      add('SHA-256("abc")', toHex(wordsToBytes(sha256Words(enc.encode('abc')))) === 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
      // RFC 7914 §11 PBKDF2-HMAC-SHA256 vector (P="passwd", S="salt", c=1, dkLen 64 -> first 32 bytes)
      const v = toHex(await pbkdf2Js(enc.encode('passwd'), enc.encode('salt'), 1));
      add('PBKDF2 RFC 7914 (c=1)', v === '55ac046e56e3089fec1691c22544b605f94185216dde0465e68b9d57c20dacbc', v.slice(0, 16));
      const salt = randomBytes(16);
      const js = toHex(await pbkdf2Js(enc.encode('발효Test123'), salt, 2048));
      if (hasSubtle()) {
        const key = await crypto.subtle.importKey('raw', enc.encode('발효Test123'), 'PBKDF2', false, ['deriveBits']);
        const native = toHex(new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 2048 }, key, 256)));
        add('PBKDF2 JS == WebCrypto (2048회)', js === native);
      } else add('WebCrypto 사용 가능', false, 'crypto.subtle 없음 (보안 컨텍스트가 아님) — JS 대체 구현 사용');
      add('상수 시간 비교', safeEqual('abcd', 'abcd') && !safeEqual('abcd', 'abce') && !safeEqual('abc', 'abcd'));
      // rejected: letters only, digits only, a common password, too short, spaces · accepted: a normal strong one
      add('비밀번호 정책', !!V.password('abcdefgh') && !!V.password('12345678') && !!V.password('abcd1234') && !!V.password('short1') && !!V.password('Hanok 2026') && !V.password('Hanok2026!'));
      add('닉네임 정책', !V.nickname('메주콩') && !!V.nickname('a') && !!V.nickname('<b>x</b>') && !!V.nickname('관리자'));
      add('이메일 정책', !V.email('name@example.com') && !!V.email('bad@@x') && !!V.email('a@b'));
    } catch (e) { add('self test', false, String(e?.message || e)); }
    return { ok: res.every((r) => r.ok), results: res };
  }

  // ================================================================ local accounts / recent-profile index
  const isStr = (v) => typeof v === 'string' && v.length > 0;
  const Accounts = {
    all() {
      const a = store.get(KEYS.accounts, []);
      return Array.isArray(a) ? a.filter((x) => x && typeof x === 'object' && isStr(x.id) && isStr(x.email) && isStr(x.hash) && isStr(x.salt) && isStr(x.nickname)) : [];
    },
    write(list) { return store.set(KEYS.accounts, list); },
    byId(id) { return this.all().find((a) => a.id === id) || null; },
    byLogin(login) {
      const k = normText(login).toLowerCase();
      if (!k) return null;
      return this.all().find((a) => a.email.toLowerCase() === k || a.nickname.toLowerCase() === k) || null;
    },
    emailTaken(email) { const k = normText(email).toLowerCase(); return this.all().some((a) => a.email.toLowerCase() === k); },
    nicknameTaken(nick, excludeId) {
      const k = normText(nick).toLowerCase();
      if (!k) return false;
      if (this.all().some((a) => a.id !== excludeId && a.nickname.toLowerCase() === k)) return true;
      return Profiles.all().some((p) => p.id !== excludeId && p.kind === 'guest' && String(p.nickname || '').toLowerCase() === k);
    },
    update(id, patch) {
      const list = this.all();
      const a = list.find((x) => x.id === id);
      if (!a) return null;
      Object.assign(a, patch);
      return this.write(list) ? a : null;
    },
    remove(id) { return this.write(this.all().filter((a) => a.id !== id)); },
    /** never exposes salts/hashes */
    publicList() { return this.all().map(({ id, email, nickname, role, createdAt, lastLogin, algo, iter }) => ({ id, email, nickname, role, createdAt, lastLogin, algo, iter })); },
  };

  const PROFILE_FIELDS = ['id', 'kind', 'nickname', 'role', 'level', 'lastPlayed', 'playTime', 'portrait', 'remember', 'rememberUntil', 'createdAt'];
  const Profiles = {
    all() {
      const a = store.get(KEYS.profiles, []);
      const list = Array.isArray(a) ? a.filter((p) => p && isStr(p.id) && ['guest', 'local', 'server'].includes(p.kind)) : [];
      for (const p of list) if ('email' in p) delete p.email; // older builds stored e-mail addresses here
      return list.sort((x, y) => (y.lastPlayed || 0) - (x.lastPlayed || 0));
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
      for (const k of PROFILE_FIELDS) if (entry[k] !== undefined && k !== 'id') p[k] = entry[k];
      if (p.portrait && !safePortrait(p.portrait)) delete p.portrait;
      if (typeof p.nickname === 'string') p.nickname = p.nickname.slice(0, 24);
      list.sort((x, y) => (y.lastPlayed || 0) - (x.lastPlayed || 0));
      // over the cap: drop the oldest ACCOUNT rows first (they can always log in again); a kid's guest row is the
      // only way back to its progress, so it goes last
      while (list.length > 12) {
        let i = -1;
        for (let j = list.length - 1; j >= 0; j--) if (list[j].kind !== 'guest' && list[j] !== p) { i = j; break; }
        list.splice(i >= 0 ? i : list.length - 1, 1);
      }
      store.set(KEYS.profiles, list);
      return p;
    },
    /** kid guest rows (newest first) */
    kids() { return this.all().filter((p) => p.kind === 'guest' && RX_GUEST_ID.test(p.id)); },
    remove(id) {
      store.set(KEYS.profiles, this.all().filter((p) => p.id !== id));
      if (store.get(KEYS.last, null) === id) store.del(KEYS.last);
    },
    last() { const id = store.get(KEYS.last, null); return typeof id === 'string' ? this.get(id) : null; },
    setLast(id) { store.set(KEYS.last, String(id)); }, // id only — never names, e-mails or tokens
    remembered(p) { return !!(p && p.remember && (!p.rememberUntil || p.rememberUntil > now())); },
  };
  const indexId = (p) => (p?.kind === 'server' ? `srv_${p.id}` : p?.id);

  /** failed-login throttle (per account): 5 misses -> 30 s lock, doubling per repeated lock (max 15 min) */
  const LOCK_FAILS = 5, LOCK_BASE = 30000, LOCK_MAX = 15 * 60000, LOCK_WINDOW = 15 * 60000;
  const Lock = {
    _m: null,
    _load() {
      if (!this._m) { const m = store.get(KEYS.lock, {}); this._m = m && typeof m === 'object' && !Array.isArray(m) ? m : {}; }
      return this._m;
    },
    _save() {
      const m = this._load();
      const t = now();
      // prune stale entries and cap the map size
      const keys = Object.keys(m).filter((k) => {
        const e = m[k];
        const stale = !e || typeof e !== 'object' || ((e.until || 0) < t && t - (e.last || 0) > 24 * 3600000);
        if (stale) delete m[k];
        return !stale;
      });
      if (keys.length > 64) keys.sort((a, b) => (m[a].last || 0) - (m[b].last || 0)).slice(0, keys.length - 64).forEach((k) => delete m[k]);
      store.set(KEYS.lock, m);
    },
    left(key) { const e = this._load()[key]; return e && e.until > now() ? Math.ceil((e.until - now()) / 1000) : 0; },
    fail(key) {
      const m = this._load();
      const t = now();
      const e = m[key] && typeof m[key] === 'object' ? m[key] : (m[key] = { n: 0, until: 0, strikes: 0, last: 0 });
      if (t - (e.last || 0) > LOCK_WINDOW && !(e.until > t)) e.n = 0;
      e.last = t;
      e.n = (Number(e.n) || 0) + 1;
      let res = { locked: false, left: LOCK_FAILS - e.n, wait: 0 };
      if (e.n >= LOCK_FAILS) {
        e.strikes = (Number(e.strikes) || 0) + 1;
        const ms = Math.min(LOCK_MAX, LOCK_BASE * 2 ** (e.strikes - 1));
        e.until = t + ms;
        e.n = 0;
        res = { locked: true, left: 0, wait: Math.ceil(ms / 1000) };
      }
      this._save();
      return res;
    },
    clear(key) { const m = this._load(); if (m[key]) { delete m[key]; this._save(); } },
  };
  const lockKey = (login, acc) => (acc ? `acc:${acc.id}` : `login:${normText(login).toLowerCase().slice(0, 120)}`);
  function waitText(sec) { return sec >= 60 ? `${Math.floor(sec / 60)}분 ${sec % 60 ? `${sec % 60}초 ` : ''}` : `${sec}초 `; }

  // ================================================================ auth
  class AuthError extends Error {
    constructor(message, field = null, code = null, extra = {}) { super(message); this.name = 'AuthError'; this.field = field; this.code = code; Object.assign(this, extra); }
  }
  function serverAuthError(e) {
    if (e instanceof AuthError) return e;
    const code = String(e?.code || '');
    const field = /EMAIL/.test(code) ? 'email' : /NICK/.test(code) ? 'nickname' : /MISMATCH/.test(code) ? 'confirm' : /TERMS/.test(code) ? 'agree'
      : /PASS|CREDENTIAL|LOGIN|INVALID|ATTEMPT/.test(code) ? 'password' : null;
    let msg = typeof e?.message === 'string' && e.message ? e.message.slice(0, 200) : '요청을 처리하지 못했어요. 잠시 후 다시 시도해 주세요.';
    if (code === 'NETWORK_ERROR') msg = '서버에 연결하지 못했어요. 인터넷 연결을 확인하고 다시 시도해 주세요.';
    if ((code === 'RATE_LIMITED' || e?.status === 429) && !/TOO_MANY/.test(code)) msg = '요청이 너무 많아요. 잠시 후 다시 시도해 주세요.';
    return new AuthError(msg, field, code);
  }
  function normServerUser(d) {
    const u = d && (d.user || d.profile || (d.id != null ? d : null));
    if (!u || u.id == null || !/^[\w-]{1,40}$/.test(String(u.id))) return null;
    const nick = normText(u.nickname || u.name || '체험객').slice(0, 24);
    return { id: String(u.id), kind: 'server', email: String(u.email || '').slice(0, 120), nickname: nick || '체험객', role: u.role === 'admin' ? 'admin' : 'user', guest: false };
  }
  function toProfile(acc) {
    return { id: acc.id, kind: 'local', email: acc.email, nickname: acc.nickname, role: acc.role === 'admin' ? 'admin' : 'user', guest: false };
  }
  function guestEntry(id = 'guest') {
    if (!RX_GUEST_ID.test(id)) id = 'guest';
    let p = Profiles.get(id);
    if (p && p.kind !== 'guest') p = null;
    if (!p || V.nickname(p.nickname)) p = Profiles.upsert({ id, kind: 'guest', nickname: `게스트${U.randInt(1000, 9999)}`, role: 'user' }) || p;
    return p || { id, kind: 'guest', nickname: '게스트' };
  }
  const hasGuestSave = (id = 'guest') => RX_GUEST_ID.test(id) && !!store.raw(SAVE_KEY(id));
  /** a fresh slot for a new kid: 'guest' when it was never used on this device, otherwise guest_xxxxxx */
  function newKidId() {
    if (!Profiles.get('guest') && !hasGuestSave('guest')) return 'guest';
    for (let i = 0; i < 20; i++) {
      const id = `guest_${toHex(randomBytes(4))}`;
      if (!Profiles.get(id) && !hasGuestSave(id)) return id;
    }
    return `guest_${Date.now().toString(36)}`;
  }
  /** kid-safe name ideas that are free on this device */
  function freeNameIdeas(n = 8) {
    const raw = typeof G.easy?.nameIdeas === 'function' ? G.easy.nameIdeas(n + 6) : [];
    const ok = raw.filter((s) => typeof s === 'string' && !V.nickname(s, { checkTaken: true }));
    if (!ok.length) ok.push(`꼬마친구${U.randInt(10, 99)}`);
    return ok.slice(0, n);
  }
  function rememberFields(on) { return on ? { remember: true, rememberUntil: now() + REMEMBER_MS } : { remember: false, rememberUntil: 0 }; }

  const auth = {
    current: null,
    serverUser: null,
    AuthError,
    validate: V,
    strength,
    strengthLabel: (n) => STRENGTH[n] || STRENGTH[0],
    accounts: () => Accounts.publicList(),
    isServer,
    params: { algo: ALGO, iterations: PBKDF2_ITER, minIterations: PBKDF2_MIN, saltBytes: 16, lockAfter: LOCK_FAILS, lockSeconds: LOCK_BASE / 1000 },
    selfTest: cryptoSelfTest,
    hasGuestSave,

    async register(form = {}) {
      const email = normText(form.email).toLowerCase();
      const nickname = normText(form.nickname);
      const password = String(form.password ?? '');
      const confirm = String(form.confirm ?? password);
      // the kid whose progress moves into this account may keep its name
      const from = typeof form.transferFrom === 'string' && RX_GUEST_ID.test(form.transferFrom) ? form.transferFrom : 'guest';
      const keepId = form.transferGuest && !isServer() && hasGuestSave(from) ? from : undefined;
      let err;
      if ((err = V.email(email))) throw new AuthError(err, 'email');
      if ((err = V.nickname(nickname, { account: true, checkTaken: !isServer(), excludeId: keepId }))) throw new AuthError(err, 'nickname');
      if ((err = V.password(password, { email, nickname }))) throw new AuthError(err, 'password');
      if ((err = V.confirm(password, confirm))) throw new AuthError(err, 'confirm');
      if (!form.agree) throw new AuthError('이용약관 및 개인정보 처리 안내에 동의해 주세요.', 'agree');
      if (isServer()) {
        try {
          // a remembered session of another account would make the server refuse (409 ALREADY_LOGGED_IN)
          if (this.serverUser) {
            try { await G.net.request('auth/logout.php', { body: {}, timeout: 5000 }); } catch (e) { /* the register call reports real problems */ }
            this.serverUser = null;
          }
          const d = await G.net.request('auth/register.php', { body: { email, nickname, password, password_confirm: confirm, agree: true } });
          let user = normServerUser(d);
          if (!user) user = await this._serverLogin(email, password, !!form.remember);
          this.serverUser = user;
          G.log.info('AUTH', `server account created ${user.id}`);
          return this._setCurrent(user);
        } catch (e) { throw serverAuthError(e); }
      }
      if (Accounts.emailTaken(email)) throw new AuthError('이미 가입된 이메일이에요. 로그인해 주세요.', 'email');
      if (Accounts.nicknameTaken(nickname, keepId)) throw new AuthError('이미 사용 중인 닉네임이에요.', 'nickname');
      const cred = await makeHash(password);
      const list = Accounts.all();
      const acc = { id: U.uid('u'), email, nickname, ...cred, role: list.length === 0 ? 'admin' : 'user', createdAt: now(), lastLogin: now() };
      list.push(acc);
      if (!Accounts.write(list)) throw new AuthError('저장 공간이 부족해 계정을 만들지 못했어요. 브라우저 저장 공간을 확인해 주세요.');
      G.log.info('AUTH', `local account created ${acc.id}${acc.role === 'admin' ? ' (first account -> admin)' : ''}`);
      // carry a guest's (kid profile's) progress over (local mode only)
      let transferred = false;
      if (form.transferGuest && hasGuestSave(from)) {
        const raw = store.raw(SAVE_KEY(from));
        if (raw && store.setRaw(SAVE_KEY(acc.id), raw)) {
          store.del(SAVE_KEY(from)); store.del(`${SAVE_KEY(from)}.bak`);
          const gp = Profiles.get(from);
          Profiles.remove(from);
          if (gp?.portrait) Profiles.upsert({ id: acc.id, kind: 'local', nickname, role: acc.role, portrait: gp.portrait });
          transferred = true;
          G.log.info('AUTH', 'guest progress moved to the new account');
        }
      }
      Profiles.upsert({ id: acc.id, kind: 'local', nickname, role: acc.role, ...rememberFields(!!form.remember) });
      const profile = this._setCurrent(toProfile(acc));
      profile.firstAdmin = acc.role === 'admin';
      profile.transferred = transferred;
      if (typeof form.easy === 'boolean') { profile.initialEasy = form.easy; profile.forceEasy = true; }
      return profile;
    },

    async login(form = {}) {
      const login = normText(form.login ?? form.email ?? '');
      const password = String(form.password ?? '');
      if (!login) throw new AuthError('아이디(닉네임) 또는 이메일을 입력해 주세요.', 'login');
      if (!password) throw new AuthError('비밀번호를 입력해 주세요.', 'password');
      if (login.length > 120 || password.length > 256) throw new AuthError('아이디 또는 비밀번호가 올바르지 않아요.', 'password', 'INVALID');
      if (isServer()) {
        try { return this._setCurrent(await this._serverLogin(login, password, !!form.remember)); } catch (e) { throw serverAuthError(e); }
      }
      const acc = Accounts.byLogin(login);
      const key = lockKey(login, acc);
      const wait = Lock.left(key);
      if (wait) throw new AuthError(`로그인 시도가 너무 많아요. ${waitText(wait)}후에 다시 시도해 주세요.`, 'password', 'LOCKED', { wait });
      const fail = () => {
        const r = Lock.fail(key);
        if (r.locked) return new AuthError(`로그인에 ${LOCK_FAILS}번 실패해 잠시 잠겼어요. ${waitText(r.wait)}후에 다시 시도해 주세요.`, 'password', 'LOCKED', { wait: r.wait });
        return new AuthError(`아이디 또는 비밀번호가 올바르지 않아요.${r.left <= 2 ? ` (잠기기 전 남은 시도 ${r.left}회)` : ''}`, 'password', 'INVALID');
      };
      if (!acc) { await dummyDerive(password); throw fail(); }
      let ok = false;
      try { ok = await verifyHash(acc, password); } catch (e) { G.log.error('AUTH', 'password verification failed', e?.message || e); ok = false; }
      if (!ok) throw fail();
      Lock.clear(key);
      const patch = { lastLogin: now() };
      if (needsRehash(acc)) {
        try { Object.assign(patch, await makeHash(password), { upgradedAt: now() }); G.log.info('AUTH', `password hash upgraded to ${ALGO}`); }
        catch (e) { G.log.warn('AUTH', 'hash upgrade skipped', e?.message || e); }
      }
      Accounts.update(acc.id, patch);
      Profiles.upsert({ id: acc.id, kind: 'local', nickname: acc.nickname, role: acc.role, ...rememberFields(!!form.remember) });
      G.log.info('AUTH', `local login ${acc.id}`);
      return this._setCurrent(toProfile(acc));
    },

    /**
     * guest / kid profile.
     *   guest()                          the classic single guest slot ('guest')
     *   guest({id})                      continue an existing kid profile
     *   guest({fresh, nickname, look, lookId}) a NEW kid profile (easy title "놀러 가기"): kid-safe name + picked look
     * opts.easy (bool) = play mode of a NEW profile (the title screen's mode).
     */
    async guest(opts = {}) {
      let p;
      if (opts.fresh) {
        if (Profiles.kids().length >= KID_MAX) throw new AuthError('놀이 친구 자리가 꽉 찼어요. 어른에게 정리해 달라고 해요.', null, 'KID_FULL');
        const nickname = normText(opts.nickname);
        const err = V.nickname(nickname, { checkTaken: true });
        if (err) throw new AuthError(err, 'nickname');
        const id = newKidId();
        // the face card shows the picked look right away (the in-game portrait replaces it after the first play)
        const art = typeof opts.lookId === 'string' ? safePortrait(LookArt.get(opts.lookId)) : null;
        p = Profiles.upsert({ id, kind: 'guest', nickname, role: 'user', lastPlayed: now(), portrait: art || undefined });
        if (!p) throw new AuthError('저장 공간이 부족해 새 친구를 만들지 못했어요.');
      } else p = guestEntry(typeof opts.id === 'string' ? opts.id : 'guest');
      const prof = { id: p.id, kind: 'guest', nickname: p.nickname || '게스트', email: '', role: 'user', guest: true };
      if (opts.look && typeof opts.look === 'object') prof.initialAvatar = opts.look;
      if (typeof opts.easy === 'boolean') prof.initialEasy = opts.easy;
      return this._setCurrent(prof);
    },

    /** one-click resume of a profile from the "최근 플레이" list -> profile | null (password needed) */
    async resume(entry) {
      if (!entry) return null;
      if (entry.kind === 'guest') return this.guest({ id: entry.id });
      if (entry.kind === 'local') {
        if (isServer() || !Profiles.remembered(entry)) return null;
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
      try { this.serverUser = normServerUser(await G.net.request('auth/me.php', { quiet: true, timeout: 5000 })); } catch (e) { this.serverUser = null; }
      return this.serverUser;
    },

    async _serverLogin(login, password, remember) {
      const d = await G.net.request('auth/login.php', { body: { email: login, login, password, remember: !!remember } });
      const u = normServerUser(d);
      if (!u) throw new AuthError('로그인 응답을 확인하지 못했어요. 잠시 후 다시 시도해 주세요.');
      this.serverUser = u;
      Profiles.upsert({ id: indexId(u), kind: 'server', nickname: u.nickname, role: u.role, ...rememberFields(!!remember) });
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
      if (cur.kind !== 'guest') Profiles.upsert({ id: indexId(cur), ...rememberFields(false) });
      G.log.info('AUTH', `logout ${cur.kind}`);
    },

    /** rename the current player (local accounts and guests) -> '' on success or an error message */
    changeNickname(nick) {
      const cur = this.current;
      if (!cur || !G.state) return '로그인한 뒤에 바꿀 수 있어요.';
      if (cur.kind === 'server') return '서버 계정의 닉네임은 이곳에서 바꿀 수 없어요.';
      nick = normText(nick);
      if (nick === cur.nickname) return '';
      const err = V.nickname(nick, { account: cur.kind === 'local', excludeId: cur.id, checkTaken: true });
      if (err) return err;
      if (cur.kind === 'local' && !Accounts.update(cur.id, { nickname: nick })) return '닉네임을 저장하지 못했어요. 저장 공간을 확인해 주세요.';
      cur.nickname = nick;
      if (G.save.profile) G.save.profile.nickname = nick;
      G.state.profile.nickname = nick;
      Profiles.upsert({ id: indexId(cur), nickname: nick });
      G.dirty('profile');
      G.bus.emit('profile:changed', { profile: G.state.profile, field: 'nickname' });
      try { G.sys.progression?.refreshHud?.(true); } catch (e) { /* hud optional */ }
      G.log.info('AUTH', `nickname changed (${cur.kind})`);
      return '';
    },

    /** local accounts: verify the current password, then store a fresh PBKDF2 hash -> '' or error */
    async changePassword(current, next, again) {
      const cur = this.current;
      if (!cur || cur.kind !== 'local') return { field: null, msg: cur?.kind === 'server' ? '서버 계정의 비밀번호는 체험관 관리자에게 문의해 주세요.' : '로컬 계정에서만 바꿀 수 있어요.' };
      const acc = Accounts.byId(cur.id);
      if (!acc) return { field: null, msg: '계정을 찾지 못했어요.' };
      const key = lockKey('', acc);
      const wait = Lock.left(key);
      if (wait) return { field: 'current', msg: `시도가 너무 많아요. ${waitText(wait)}후에 다시 시도해 주세요.` };
      if (!current) return { field: 'current', msg: '지금 비밀번호를 입력해 주세요.' };
      let err = V.password(next, { email: acc.email, nickname: acc.nickname });
      if (err) return { field: 'next', msg: err };
      if ((err = V.confirm(next, again))) return { field: 'again', msg: err };
      if (current === next) return { field: 'next', msg: '지금과 다른 비밀번호를 입력해 주세요.' };
      if (!(await verifyHash(acc, String(current)).catch(() => false))) {
        const r = Lock.fail(key);
        return { field: 'current', msg: r.locked ? `${LOCK_FAILS}번 틀려 잠시 잠겼어요. ${waitText(r.wait)}후에 다시 시도해 주세요.` : '지금 비밀번호가 올바르지 않아요.' };
      }
      Lock.clear(key);
      if (!Accounts.update(acc.id, { ...(await makeHash(String(next))), passwordChangedAt: now() })) return { field: null, msg: '저장하지 못했어요. 저장 공간을 확인해 주세요.' };
      G.log.info('AUTH', 'password changed (local account)');
      return { field: null, msg: '' };
    },

    /**
     * local accounts: verify the password, run opts.onVerified (the app tears the session down without saving),
     * then delete the account, its saves, throttle entry and index row -> '' or an error message
     */
    async deleteAccount(password, opts = {}) {
      const cur = this.current;
      if (!cur || cur.kind !== 'local') return '로컬 계정만 이곳에서 삭제할 수 있어요.';
      const acc = Accounts.byId(cur.id);
      if (!acc) return '계정을 찾지 못했어요.';
      const key = lockKey('', acc);
      const wait = Lock.left(key);
      if (wait) return `시도가 너무 많아요. ${waitText(wait)}후에 다시 시도해 주세요.`;
      if (!password) return '비밀번호를 입력해 주세요.';
      if (!(await verifyHash(acc, String(password)).catch(() => false))) {
        const r = Lock.fail(key);
        return r.locked ? `${LOCK_FAILS}번 틀려 잠시 잠겼어요. ${waitText(r.wait)}후에 다시 시도해 주세요.` : '비밀번호가 올바르지 않아요.';
      }
      try { await opts.onVerified?.(); } catch (e) { G.log.warn('AUTH', 'delete: teardown failed', e?.message || e); }
      Lock.clear(key);
      Accounts.remove(acc.id);
      Profiles.remove(acc.id);
      store.del(SAVE_KEY(acc.id)); store.del(`${SAVE_KEY(acc.id)}.bak`);
      if (this.current?.id === acc.id) this.current = null;
      G.log.info('AUTH', 'local account deleted');
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
        const go = () => this._run().catch((e) => G.log.warn('UI', 'portrait skipped', e?.message || e));
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
    /** render a head-and-shoulders portrait -> canvas | null. o: {dist (camera distance), drop (look-at below the head), gain} */
    async render(appearance, S = 128, o = {}) {
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
        const cy = _pv.y - (Number.isFinite(o.drop) ? o.drop : 0.36);
        const dist = Number.isFinite(o.dist) ? o.dist : 1.5;
        cam.position.set(0.3 * (dist / 1.5), cy + 0.08, dist);
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
        return encodePixels(buf, S, (Number.isFinite(o.gain) ? o.gain : 0.66) / K);
      } finally {
        rt.dispose();
        if (rig) { scene.remove(rig.group); try { rig.dispose(); } catch (e) { /* ignore */ } }
        key.dispose?.(); fill.dispose?.(); rim.dispose?.();
      }
    },
    apply(url) {
      this.url = safePortrait(url);
      for (const b of $$('.hud-avatar')) {
        if (this.url) { b.style.backgroundImage = `url("${this.url}"), linear-gradient(160deg, #8fd0ff, #3b74d6)`; b.classList.add('has-portrait'); }
        else { b.style.backgroundImage = ''; b.classList.remove('has-portrait'); }
      }
    },
    reset() { clearTimeout(this._timer); this._seq++; this.apply(null); },
  };

  /** portraits of the kid looks on the title (rendered once per session, idle time, one at a time) */
  const RX_LOOK_URL = /^data:image\/png;base64,[A-Za-z0-9+/]+=*$/;
  const LookArt = {
    cache: new Map(), _queue: [], _busy: false, _gen: 0, _fails: 0,
    get(id) { return this.cache.get(id) || null; },
    ensure(looks, onReady) {
      if (this._fails > 2 || !G.avatar?.create || !G.sys.engine?.renderer) return;
      this._onReady = onReady;
      for (const lk of looks) if (!this.cache.has(lk.id) && !this._queue.some((x) => x.id === lk.id)) this._queue.push(lk);
      this._pump();
    },
    cancel() { this._queue.length = 0; this._gen++; this._busy = false; },
    _pump() {
      if (this._busy || !this._queue.length) return;
      this._busy = true;
      const gen = this._gen;
      const lk = this._queue.shift();
      const run = async () => {
        try {
          const canvas = await Portrait.render(G.avatar.normalize(lk.app), 112, { dist: 2.35, drop: 0.5, gain: 0.6 });
          if (gen !== this._gen) return;
          const url = canvas ? canvas.toDataURL('image/png') : '';
          if (RX_LOOK_URL.test(url) && url.length < 120000) { this.cache.set(lk.id, url); this._onReady?.(); }
        } catch (e) { this._fails++; G.log.warn('UI', 'look portrait skipped', e?.message || e); }
        finally {
          if (gen === this._gen) { this._busy = false; setTimeout(() => this._pump(), 30); }
        }
      };
      if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(run, { timeout: 800 }); else setTimeout(run, 16);
    },
  };

  // ================================================================ title screen
  const EYE_SVG = G.icon('eye');
  const EYE_OFF_SVG = G.icon('eye-off');
  const MASCOT_LINES = [
    ['happy', '어서 와요! 저는 장독 요정 옹이예요 🏺'],
    ['wink', '오늘은 된장을 담가 볼까요? 콩부터 키워야 해요 🌱'],
    ['cheer', '금빛 표식만 따라오면 길을 잃지 않아요 ✨'],
    ['think', '발효는 기다림이에요. 장독을 자주 들여다봐 주세요 🫙'],
    ['happy', '사진 모드에서 기념사진도 남겨 보세요 📸'],
    ['wink', '퀴즈를 풀면 교육 포인트가 쑥쑥 올라요 📖'],
  ];
  /** short lines for children (≤ 12 words, one idea each) */
  const KID_LINES = [
    ['happy', '안녕! 나는 옹이야 🏺'],
    ['cheer', '▶ 놀러 가기를 눌러 봐요!'],
    ['wink', '🎲를 누르면 이름이 바뀌어요!'],
    ['happy', '마음에 드는 옷을 골라요 👕'],
    ['cheer', '같이 콩을 키워요 🌱'],
    ['wink', '나를 누르면 말해 줄게요!'],
  ];
  /** floating petals / leaves / sparkles (pure CSS motion, transform + opacity only) */
  function petalsHtml(n = 18) {
    const r = U.rng(20261010);
    let out = '';
    for (let i = 0; i < n; i++) {
      const kind = i % 3 === 0 ? 'leaf' : i % 3 === 1 ? 'petal' : 'spark';
      const x = (r() * 100).toFixed(1), d = (14 + r() * 16).toFixed(1), delay = (-r() * 30).toFixed(1);
      const s = (0.55 + r() * 0.9).toFixed(2), sway = (20 + r() * 60).toFixed(0), rot = (180 + r() * 540).toFixed(0);
      out += `<i class="ts-p ${kind}" style="--x:${x}%;--d:${d}s;--delay:${delay}s;--s:${s};--sway:${sway}px;--rot:${rot}deg"></i>`;
    }
    return out;
  }

  const Title = {
    el: null,
    open: false,
    view: 'home',
    busy: false,
    _hideTimer: 0,
    _lockTimer: 0,
    _mascotTimer: 0,
    _mascotIdx: 0,
    /** easy mode: the grown-up title (forms, recent list) after the parent gate */
    parent: false,
    /** kid view state: 'home' (face cards) | 'new' (name + look builder) */
    kid: { mode: 'home', ideas: [], ni: 0, look: 0 },
    _greetPending: false,
    _transferFrom: 'guest',

    /** the home view to show right now: the kid view in easy mode, the classic one for adults */
    homeView() { return easyOn() && !this.parent ? 'kid' : 'home'; },

    build() {
      const el = h('div', { class: 'title-screen', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'ts-title' });
      el.innerHTML = `
        <div class="ts-bg" aria-hidden="true">
          <div class="ts-aurora a1"></div><div class="ts-aurora a2"></div><div class="ts-aurora a3"></div>
          <div class="ts-vignette"></div>
          <div class="ts-petals">${petalsHtml()}</div>
        </div>
        <div class="ts-modebar" role="radiogroup" aria-label="놀이 방법">
          <button type="button" role="radio" data-act="mode" data-mode="easy" data-say="쉬운 모드. 그림과 소리로 쉽게 놀아요."><span class="emoji" aria-hidden="true">👶</span><span>쉬운 모드</span></button>
          <button type="button" role="radio" data-act="mode" data-mode="normal" data-say="일반 모드. 어른이 바꿀 수 있어요."><span class="emoji" aria-hidden="true">🧑</span><span>일반 모드</span></button>
        </div>
        <div class="ts-layout">
          <div class="ts-main">
            <header class="ts-brand">
              <div class="ts-eyebrow"><span class="ts-eyebrow-line"></span>METAVERSE<span class="ts-eyebrow-sep">·</span><span class="ts-eyebrow-ko">전통발효 메타버스</span></div>
              <h1 id="ts-title" class="ts-title"><span class="w w1">전통</span><span class="w w2">발효</span><span class="w w3">체험관</span></h1>
              <p class="ts-sub">밭을 일구고, 장을 담그고, 배우고 기록하는 <b>3D 전통발효 체험 여행</b></p>
              <p class="ts-kid-sub" aria-hidden="true"><span>🌱 키우고</span><span>🏺 담그고</span><span>📖 배워요</span></p>
              <div class="ts-world" aria-live="off"></div>
            </header>
            <div class="ts-stage">
              <section class="ts-card glass" aria-label="시작하기">
                <div class="ts-parent-head" hidden>
                  <button type="button" class="easy-back" data-act="kid-back" data-say="아이 화면으로 돌아가요"><span class="emoji" aria-hidden="true">⬅️</span><span class="eb-lbl">아이 화면</span></button>
                  <span class="ts-parent-tag"><span class="emoji" aria-hidden="true">👨‍👩‍👧</span>어른 메뉴</span>
                </div>
                <div class="ts-view" data-view="kid" hidden></div>
                <div class="ts-view" data-view="home"></div>
                <div class="ts-view" data-view="login" hidden></div>
                <div class="ts-view" data-view="register" hidden></div>
              </section>
              <div class="ts-mascot" data-act="mascot" role="button" tabindex="0" aria-label="옹이에게 말 걸기">
                <div class="ts-bubble" aria-live="polite"><span class="ts-bubble-text"></span></div>
                <div class="ts-mascot-body"></div>
                <span class="ts-mascot-name">옹이</span>
              </div>
            </div>
            <footer class="ts-foot">
              <span class="ts-mode"></span>
              <span class="ts-links">
                <button type="button" data-act="help">${ico('keyboard', 'ico-sm')}조작 방법</button>
                <button type="button" data-act="settings">${ico('settings', 'ico-sm')}설정</button>
                <button type="button" data-act="credits">${ico('info', 'ico-sm')}안내 및 고지</button>
              </span>
              <span class="ts-kid-links">
                <button type="button" class="ts-kid-link" data-act="help" data-say="도와줘요. 노는 방법을 그림으로 봐요."><span class="emoji" aria-hidden="true">❓</span>도와줘요</button>
                <button type="button" class="ts-kid-link" data-act="settings" data-say="소리. 소리 크기를 바꿔요."><span class="emoji" aria-hidden="true">🔊</span>소리</button>
                <button type="button" class="ts-kid-link ts-kid-parents" data-act="parents" data-say="어른 메뉴. 어른만 열 수 있어요."><span class="emoji" aria-hidden="true">👨‍👩‍👧</span>어른 메뉴</button>
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
              <h3><span class="emoji">💡</span>오늘의 발효 상식</h3>
              <p class="ts-fact-text"></p>
              <button type="button" class="ts-fact-next" data-act="fact">다른 상식 보기 ${ico('refresh', 'ico-xs')}</button>
            </section>
          </aside>
        </div>`;
      el.querySelector('[data-view="login"]').innerHTML = this._loginHtml();
      el.querySelector('[data-view="register"]').innerHTML = this._registerHtml();
      G.ui.hydrateIcons(el);
      el.addEventListener('click', (e) => this._onClick(e));
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Tab' && !G.ui.modal.isOpen()) trapTab(el, e);
        if ((e.key === 'Enter' || e.key === ' ') && e.target.closest?.('[data-act=mascot]')) { e.preventDefault(); this._mascotNext(true); }
        // kid look tiles: arrow keys move like a radio group
        const look = e.target.closest?.('[data-act=kid-look]');
        if (look) {
          const d = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
          if (d) { e.preventDefault(); const n = kidLooks().length; this._pickLook((this.kid.look + d + n) % n, true); }
        }
      });
      // speech needs a user gesture in most browsers: the greeting is retried on the first tap / key
      const retryGreet = (e) => {
        if (!this._greetPending || !this.open || this.view !== 'kid') return;
        if (e.target?.closest?.('[data-act=kid-go], [data-act=kid-resume], [data-act=mode], [data-act=parents]')) return;
        this._greet();
      };
      el.addEventListener('pointerdown', retryGreet, true);
      el.addEventListener('keydown', retryGreet, true);
      for (const f of el.querySelectorAll('form[data-form]')) this._bindForm(f);
      this.el = el;
      this._fact();
    },

    show(view = 'home', opts = {}) {
      if (!this.el) this.build();
      clearTimeout(this._hideTimer);
      const root = $('#screen-root') || document.body;
      if (!this.el.isConnected) root.appendChild(this.el);
      this.el.classList.remove('out');
      const wasOpen = this.open;
      this.open = true;
      document.body.classList.add('title-open');
      G.ui.block('title');
      G.ui.setHudVisible(false);
      G.ui.objective?.(null);
      try { G.sys.camera?.cinematic?.(CINE); } catch (e) { G.log.warn('UI', 'cinematic camera failed', e); }
      // every fresh title starts on the child's screen; only the gated paths (upgradeGuest...) pass parent:true
      if (!wasOpen) { this.parent = !!opts.parent; this.kid = { mode: 'home', ideas: [], ni: 0, look: U.randInt(0, 5) }; this._transferFrom = 'guest'; }
      else if (opts.parent) this.parent = true;
      if (opts.transferFrom && RX_GUEST_ID.test(opts.transferFrom)) this._transferFrom = opts.transferFrom;
      this._resetForms();
      this.renderHome();
      // in easy mode the login / register forms are only reachable through the parent gate (parent:true callers)
      if ((view === 'login' || view === 'register') && easyOn() && !this.parent) view = 'home';
      const v = view === 'home' ? this.homeView() : view;
      this.setView(v, { focus: false });
      if (opts.login) { const i = this.el.querySelector('[data-form=login] [name=login]'); if (i) i.value = opts.login; }
      if (opts.transfer) { const cb = this.el.querySelector('[data-form=register] [name=transferGuest]'); if (cb && !cb.closest('[hidden]')) cb.checked = true; }
      this._mascotStart();
      if (v === 'kid' && !wasOpen) { this._greetPending = true; setTimeout(() => { if (this.open && this.view === 'kid') this._greet(); }, 900); }
      requestAnimationFrame(() => requestAnimationFrame(() => {
        this.el?.classList.add('in');
        if (!touchUI() && this.open) this._focusView(this.view);
      }));
      if (isServer()) auth.checkServer().then(() => { if (this.open) this.renderHome(); });
    },

    hide() {
      if (!this.el || !this.open) return;
      this.open = false;
      document.body.classList.remove('title-open');
      G.ui.unblock('title');
      clearInterval(this._lockTimer);
      clearInterval(this._mascotTimer);
      this._greetPending = false;
      LookArt.cancel();
      this.el.classList.remove('in');
      this.el.classList.add('out');
      clearTimeout(this._hideTimer);
      this._hideTimer = setTimeout(() => { if (!this.open) { this.el?.remove(); this._resetForms(); } }, reduceMotion() ? 50 : 900);
    },

    setView(view, opts = {}) {
      if (!this.el) return;
      if (view === 'home' || view === 'kid') view = this.homeView();
      const prev = this.view;
      this.view = view;
      for (const v of this.el.querySelectorAll('.ts-view')) {
        const on = v.dataset.view === view;
        v.hidden = !on;
        if (on && prev !== view) { v.classList.remove('enter'); void v.offsetWidth; v.classList.add('enter'); }
      }
      this.el.classList.toggle('ts-form-open', view === 'login' || view === 'register');
      this.el.classList.toggle('kid', view === 'kid');
      this.el.classList.toggle('parent', easyOn() && this.parent);
      const ph = this.el.querySelector('.ts-parent-head');
      if (ph) ph.hidden = !(easyOn() && this.parent);
      if (view === 'login') this._prepLogin();
      if (view === 'register') this._prepRegister();
      if (opts.focus !== false) setTimeout(() => this._focusView(view), 60);
    },
    _focusView(view) {
      if (!this.el || touchUI() || !this.open) return;
      if (view === 'home') this.el.querySelector('.ts-start')?.focus({ preventScroll: true });
      else if (view === 'kid') this.el.querySelector('[data-view=kid] .kid-go')?.focus({ preventScroll: true });
      else this._focusFirst(view);
    },
    _focusFirst(view) {
      setTimeout(() => {
        const box = this.el?.querySelector(`.ts-view[data-view="${view}"]`);
        if (!box || touchUI()) return;
        const f = Array.from(box.querySelectorAll('input:not([type=checkbox])')).find((i) => !i.value) || box.querySelector('input');
        f?.focus({ preventScroll: true });
      }, 80);
    },

    // ------------------------------------------------------------ home
    _plan() {
      if (isServer() && auth.serverUser) return { kind: 'server', label: `${auth.serverUser.nickname}님으로 이어하기` };
      const last = Profiles.last();
      if (last?.kind === 'guest') return { kind: 'guest', entry: last, label: `${last.nickname} · Lv.${Number(last.level) || 1} 이어하기` };
      if (last?.kind === 'local' && !isServer() && Accounts.byId(last.id)) {
        if (Profiles.remembered(last)) return { kind: 'resume', entry: last, label: `${last.nickname} · Lv.${Number(last.level) || 1} 이어하기` };
        return { kind: 'login', entry: last, label: `${josa(last.nickname, '으로/로')} 로그인하기` };
      }
      if (last?.kind === 'server' && isServer()) return { kind: 'login', entry: last, label: `${josa(last.nickname, '으로/로')} 로그인하기` };
      return { kind: 'guest', label: '설치 없이 바로 체험을 시작해요' };
    },

    renderHome() {
      if (!this.el) return;
      const plan = this._plan();
      const home = this.el.querySelector('[data-view="home"]');
      const server = isServer();
      const hadFocus = home.contains(document.activeElement);
      home.innerHTML = `
        <button type="button" class="btn btn-gold btn-lg btn-block ts-start" data-act="start">
          <span class="ts-start-ico"><span class="emoji">🏺</span></span>
          <span class="ts-start-txt"><b>게임 시작</b><small></small></span>
          <span class="ts-start-arrow">${ico('chevron-right')}</span>
        </button>
        <div class="ts-row">
          <button type="button" class="btn btn-soft btn-lg" data-act="go-login">${ico('lock', 'ico-sm')}로그인</button>
          <button type="button" class="btn btn-soft btn-lg" data-act="go-register">${ico('user', 'ico-sm')}회원가입</button>
        </div>
        <button type="button" class="btn btn-ghost btn-block ts-guest" data-act="guest"><span class="emoji">👀</span>게스트로 둘러보기<small>${server ? '게스트 기록은 이 브라우저에만 저장돼요' : '가입 없이 이 브라우저에 저장돼요'}</small></button>
        <div class="ts-features" aria-label="주요 체험">
          <span class="ts-feat"><span class="emoji">🌱</span>전통작물 재배</span>
          <span class="ts-feat"><span class="emoji">🏺</span>장독 발효</span>
          <span class="ts-feat"><span class="emoji">📖</span>배움터·퀴즈</span>
          <span class="ts-feat"><span class="emoji">📸</span>포토존</span>
        </div>`;
      home.querySelector('.ts-start-txt small').textContent = plan.label;
      G.ui.hydrateIcons(home);
      if (hadFocus && !touchUI()) home.querySelector('.ts-start')?.focus({ preventScroll: true });
      const mode = this.el.querySelector('.ts-mode');
      mode.className = `ts-mode ${server ? 'server' : 'local'}`;
      mode.innerHTML = server
        ? `<span class="dot"></span><b>서버 모드</b><span>계정 서버에 저장</span>`
        : `<span class="dot"></span><b>로컬 모드</b><span>이 브라우저에 저장</span>`;
      mode.title = server ? `서버에 연결됨${G.net.serverInfo?.version ? ` (API v${String(G.net.serverInfo.version).slice(0, 12)})` : ''}` : '서버 없이 실행 중 — 진행 상황은 이 브라우저(localStorage)에 저장돼요.';
      this._renderWorld();
      this._renderProfiles();
      this._renderModebar();
      this._renderKid();
    },

    // ------------------------------------------------------------ 👶 쉬운 모드 / 🧑 일반 모드 chip
    _renderModebar() {
      const easy = easyOn();
      for (const b of this.el.querySelectorAll('.ts-modebar [data-mode]')) {
        const on = (b.dataset.mode === 'easy') === easy;
        b.classList.toggle('on', on);
        b.setAttribute('aria-checked', on ? 'true' : 'false');
      }
    },
    async _setMode(mode) {
      const want = mode === 'easy';
      if (want === easyOn()) { G.sfx('click'); say(want ? '지금 쉬운 모드예요.' : '지금 일반 모드예요.', { force: true }); return; }
      G.sfx('click');
      let ok = false;
      if (typeof G.easy?.set === 'function') ok = await G.easy.set(want); // turning it OFF asks the parent gate
      else { G.setSetting('easyMode', want); ok = true; }
      if (!ok || !this.open) return;
      this.parent = false;
      this.renderHome();
      this.setView(this.homeView());
      G.ui.toast(want ? '쉬운 모드를 켰어요. 그림과 소리로 안내해요!' : '일반 모드로 바꿨어요. 새로 만드는 프로필도 일반 모드로 시작해요.', { type: 'info', emoji: want ? '👶' : '🧑', sound: false });
    },

    // ------------------------------------------------------------ kid view (easy mode home)
    /** profiles shown as face cards: kid guests + the accounts of this mode, newest first (≤ 6) */
    _kidEntries() {
      const server = isServer();
      const all = Profiles.all(); // newest first
      const kids = all.filter((p) => p.kind === 'guest' && RX_GUEST_ID.test(p.id));
      const accounts = all.filter((p) => (server ? p.kind === 'server' : p.kind === 'local' && !!Accounts.byId(p.id)));
      return kids.concat(accounts).slice(0, KID_MAX); // the big card is the newest KID, never a grown-up's account
    },
    _kidIdeas() {
      const k = this.kid;
      if (!k.ideas.length || k.ni >= k.ideas.length) { k.ideas = freeNameIdeas(8); k.ni = 0; }
      return k.ideas[k.ni] || k.ideas[0];
    },
    _renderKid() {
      const box = this.el?.querySelector('[data-view="kid"]');
      if (!box) return;
      const entries = this._kidEntries();
      const k = this.kid;
      if (!entries.length) k.mode = 'new';
      const hadFocus = box.contains(document.activeElement) ? document.activeElement.dataset.act || '' : '';
      box.textContent = '';
      if (k.mode === 'home' && entries.length) {
        const [first, ...rest] = entries;
        const needsGrownUp = first.kind !== 'guest';
        const ava = h('span', { class: 'kf-ava' });
        setPortraitBg(ava, first.portrait, initialOf(first.nickname));
        const nick = String(first.nickname || '친구');
        const card = h('button', { type: 'button', class: 'kid-face kid-go', 'data-act': 'kid-resume', 'data-id': first.id, 'data-say': `다시 놀기. ${nick}` },
          h('span', { class: 'kf-top' }, h('span', { class: 'emoji', 'aria-hidden': 'true' }, '🙂'), '다시 놀기'),
          ava,
          h('b', { class: 'kf-name' }, nick),
          h('span', { class: 'kf-lv', 'aria-label': `레벨 ${Number(first.level) || 1}` }, h('span', { class: 'emoji', 'aria-hidden': 'true' }, '⭐'), String(Number(first.level) || 1)),
          h('span', { class: 'kf-go' }, h('span', { class: 'emoji', 'aria-hidden': 'true' }, needsGrownUp ? '🔒' : '▶'), needsGrownUp ? '어른이 열어 줘요' : '놀러 가기!'));
        box.appendChild(card);
        const row = h('div', { class: 'kid-friends', role: 'group', 'aria-label': '다른 친구' });
        for (const p of rest) {
          const fa = h('span', { class: 'kfr-ava' });
          setPortraitBg(fa, p.portrait, initialOf(p.nickname));
          const n = String(p.nickname || '친구');
          const lock = p.kind !== 'guest';
          row.appendChild(h('button', { type: 'button', class: 'kid-friend', 'data-act': 'kid-resume', 'data-id': p.id, 'data-say': `${n}${lock ? '. 어른이 열어 줘요' : ''}`, 'aria-label': n },
            fa, h('span', { class: 'kfr-name' }, n), lock ? h('span', { class: 'kfr-lock emoji', 'aria-hidden': 'true' }, '🔒') : null));
        }
        if (Profiles.kids().length < KID_MAX) {
          row.appendChild(h('button', { type: 'button', class: 'kid-friend kid-new', 'data-act': 'kid-new', 'data-say': '새 친구. 새로 만들어서 놀아요.', 'aria-label': '새 친구' },
            h('span', { class: 'kfr-ava plus', 'aria-hidden': 'true' }, '➕'), h('span', { class: 'kfr-name' }, '새 친구')));
        }
        box.appendChild(row);
      } else {
        const name = this._kidIdeas();
        const looks = kidLooks();
        k.look = U.clamp(k.look | 0, 0, looks.length - 1);
        const head = h('div', { class: 'kid-build-head' },
          entries.length ? h('button', { type: 'button', class: 'easy-back', 'data-act': 'kid-home', 'aria-label': '돌아가기' }, h('span', { class: 'emoji', 'aria-hidden': 'true' }, '⬅️'), h('span', { class: 'eb-lbl' }, '뒤로')) : null,
          h('span', { class: 'kid-build-title' }, h('span', { class: 'emoji', 'aria-hidden': 'true' }, '🌟'), '새 친구 만들기'));
        const nameRow = h('div', { class: 'kid-name' },
          h('span', { class: 'kid-label', 'aria-hidden': 'true' }, '🏷️'),
          h('button', { type: 'button', class: 'kn-text', 'data-act': 'kid-name', 'data-say': `내 이름은 ${name}`, 'aria-label': `내 이름 ${name}. 눌러서 듣기` }, name),
          h('button', { type: 'button', class: 'kn-dice', 'data-act': 'kid-dice', 'data-say': '다른 이름', 'aria-label': '다른 이름' }, h('span', { class: 'emoji', 'aria-hidden': 'true' }, '🎲'), h('span', { class: 'kn-dice-lbl' }, '다른 이름')));
        const grid = h('div', { class: 'kid-looks', role: 'radiogroup', 'aria-label': '내 모습' });
        looks.forEach((lk, i) => {
          const on = i === k.look;
          const art = h('span', { class: 'kl-art' });
          const url = LookArt.get(lk.id);
          if (url) { art.style.backgroundImage = `url("${url}")`; art.classList.add('has-img'); } else art.appendChild(h('span', { class: 'emoji', 'aria-hidden': 'true' }, lk.emoji));
          const b = h('button', { type: 'button', class: `kid-look${on ? ' on' : ''}`, role: 'radio', 'aria-checked': on ? 'true' : 'false', tabindex: on ? '0' : '-1', 'data-act': 'kid-look', 'data-i': String(i), 'data-say': lk.say, 'aria-label': lk.say },
            art, h('span', { class: 'kl-check emoji', 'aria-hidden': 'true' }, '✔️'));
          b.style.setProperty('--i', String(i));
          grid.appendChild(b);
        });
        const go = h('button', { type: 'button', class: 'kid-go kid-go-big', 'data-act': 'kid-go', 'data-say': '놀러 가기' },
          h('span', { class: 'emoji', 'aria-hidden': 'true' }, '▶'), h('span', null, '놀러 가기!'));
        box.append(head, nameRow, h('div', { class: 'kid-label-row', 'aria-hidden': 'true' }, '👕'), grid, go);
        LookArt.ensure(looks, () => { if (this.open && this.view === 'kid' && this.kid.mode === 'new') this._paintLooks(); });
      }
      if (hadFocus && !touchUI()) box.querySelector(`[data-act="${hadFocus}"]`)?.focus({ preventScroll: true });
    },
    /** a face card that opens without a grown-up (guest kids, remembered local accounts, live server session) */
    _oneClick(p) {
      if (!p) return false;
      if (p.kind === 'guest') return true;
      if (p.kind === 'local') return !isServer() && Profiles.remembered(p);
      return p.kind === 'server' && isServer() && !!auth.serverUser && indexId(auth.serverUser) === p.id;
    },
    _paintLooks() {
      const looks = kidLooks();
      for (const b of this.el?.querySelectorAll('.kid-look') || []) {
        const lk = looks[Number(b.dataset.i)];
        const art = b.querySelector('.kl-art');
        const url = lk && LookArt.get(lk.id);
        if (!art || !url || art.classList.contains('has-img')) continue;
        art.textContent = '';
        art.style.backgroundImage = `url("${url}")`;
        art.classList.add('has-img');
      }
    },
    _pickLook(i, focus) {
      const looks = kidLooks();
      this.kid.look = U.clamp(i | 0, 0, looks.length - 1);
      for (const b of this.el?.querySelectorAll('.kid-look') || []) {
        const on = Number(b.dataset.i) === this.kid.look;
        b.classList.toggle('on', on);
        b.setAttribute('aria-checked', on ? 'true' : 'false');
        b.tabIndex = on ? 0 : -1;
        if (on) {
          if (focus) b.focus({ preventScroll: true });
          if (!reduceMotion()) { b.classList.remove('pop'); void b.offsetWidth; b.classList.add('pop'); }
        }
      }
      G.sfx('pop');
      say(looks[this.kid.look]?.say || '', { force: true });
    },
    _greet() {
      if (!this.open) return;
      const nick = this._kidEntries()[0]?.nickname;
      const line = nick && this.kid.mode === 'home' ? `안녕, ${nick}! 나는 옹이야. 같이 놀자!` : '안녕! 나는 장독 요정 옹이야. 같이 놀자!';
      const b = this.el?.querySelector('.ts-bubble-text');
      if (b && this.view === 'kid') {
        b.textContent = `${line} 🏺`;
        const bub = this.el.querySelector('.ts-bubble');
        bub?.classList.remove('pop'); void bub?.offsetWidth; bub?.classList.add('pop');
      }
      this._greetPending = true;
      say(line, { force: true, priority: 1 }).then((ok) => { if (ok) this._greetPending = false; });
    },
    async _kidGo(btn) {
      if (this.busy || app._entering) return;
      const looks = kidLooks();
      const look = looks[this.kid.look] || looks[0];
      const nickname = this._kidIdeas();
      G.sfx('click');
      let created = null;
      return this._go(async () => {
        const prof = await auth.guest({ fresh: true, nickname, look: look?.app, lookId: look?.id, easy: true });
        created = prof.id;
        return prof;
      }, btn).then(() => {
        // entering failed -> drop the empty row so the face cards stay tidy
        if (created && !app.loggedIn && !hasGuestSave(created)) Profiles.remove(created);
      });
    },

    _renderWorld() {
      const box = this.el?.querySelector('.ts-world');
      if (!box) return;
      const W = G.sys.weather;
      const wd = W?.current ? G.data.weather?.[W.current] : null;
      const bits = [];
      if (wd) bits.push(`${wd.emoji || wd.icon && /\p{Extended_Pictographic}/u.test(wd.icon) ? (wd.emoji || wd.icon) : '🌤️'} ${wd.name}`);
      if (Number.isFinite(W?.temperature)) bits.push(`${Math.round(W.temperature)}°C`);
      if (typeof W?.timeString === 'function') { try { bits.push(`🕰️ ${W.timeString()}`); } catch (e) { /* ignore */ } }
      bits.push(`📍 ${G.data.meta?.address || '정선'}`);
      box.textContent = bits.join('  ·  ');
    },

    _renderProfiles() {
      const list = this.el.querySelector('.ts-plist');
      const server = isServer();
      const entries = Profiles.all().filter((p) => p.kind === 'guest' || (server ? p.kind === 'server' : p.kind === 'local')).slice(0, 5);
      list.textContent = '';
      if (!entries.length) {
        list.appendChild(h('li', { class: 'ts-pempty' }, h('span', { class: 'emoji' }, '🌱'), h('span', null, '아직 플레이 기록이 없어요.', h('br'), h('b', null, '게임 시작'), '을 눌러 첫 체험을 시작해 보세요!')));
        return;
      }
      for (const p of entries) {
        const one = p.kind === 'guest' || (p.kind === 'local' && Profiles.remembered(p)) || (p.kind === 'server' && auth.serverUser && indexId(auth.serverUser) === p.id);
        const ava = h('span', { class: 'ts-pava' });
        setPortraitBg(ava, p.portrait, initialOf(p.nickname));
        const nick = String(p.nickname || '이름 없음');
        const main = h('button', { type: 'button', class: 'ts-pmain', 'data-act': 'resume', 'data-id': p.id, title: one ? '바로 이어하기' : '비밀번호를 입력해 로그인' },
          ava,
          h('span', { class: 'ts-pinfo' }, h('b', null, nick), h('small', null, h('span', { class: 'lv' }, `Lv.${Number(p.level) || 1}`), ` · ${kindLabel(p.kind)} · ${ago(p.lastPlayed)}`)),
          h('span', { class: 'ts-pgo' }, one ? '이어하기' : '로그인', h('span', { class: 'ico ico-xs', 'data-icon': 'chevron-right' })));
        const del = h('button', { type: 'button', class: 'icon-btn ts-pdel', 'data-act': 'forget', 'data-id': p.id, 'aria-label': `${nick} 목록에서 지우기`, title: '목록에서 지우기 (저장 데이터는 남아 있어요)' }, h('span', { class: 'ico ico-sm', 'data-icon': 'x' }));
        list.appendChild(h('li', { class: 'ts-pitem' }, main, del));
      }
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
      el.classList.remove('swap'); void el.offsetWidth; el.classList.add('swap');
    },

    // ------------------------------------------------------------ mascot
    _mascotStart() {
      const body = this.el?.querySelector('.ts-mascot-body');
      if (!body) return;
      this._mascotIdx = U.randInt(0, MASCOT_LINES.length - 1);
      this._mascotShow(false);
      clearInterval(this._mascotTimer);
      this._mascotTimer = setInterval(() => { if (this.open && !document.hidden) this._mascotNext(false); }, 8000);
    },
    _mascotNext(user) {
      this._mascotIdx = (this._mascotIdx + 1) % MASCOT_LINES.length;
      this._mascotShow(user);
      if (user) {
        G.sfx('emote');
        clearInterval(this._mascotTimer);
        this._mascotTimer = setInterval(() => { if (this.open && !document.hidden) this._mascotNext(false); }, 9000);
      }
    },
    _mascotShow(hop) {
      const wrap = this.el?.querySelector('.ts-mascot');
      if (!wrap) return;
      const lines = this.view === 'kid' ? KID_LINES : MASCOT_LINES;
      const [mood, line] = lines[this._mascotIdx % lines.length];
      if (hop && this.view === 'kid') say(line, { force: true, priority: 1 });
      wrap.querySelector('.ts-mascot-body').innerHTML = mascotSvg(mood, 112); // trusted generated SVG
      const txt = wrap.querySelector('.ts-bubble-text');
      txt.textContent = line;
      const bub = wrap.querySelector('.ts-bubble');
      bub.classList.remove('pop'); void bub.offsetWidth; bub.classList.add('pop');
      if (hop) { wrap.classList.remove('hop'); void wrap.offsetWidth; wrap.classList.add('hop'); }
    },

    async _onClick(e) {
      const b = e.target.closest('[data-act]');
      if (!b || !this.el.contains(b) || b.disabled) return;
      const act = b.dataset.act;
      if (['start', 'guest', 'resume', 'kid-go', 'kid-resume'].includes(act) && (this.busy || app._entering)) return;
      switch (act) {
        case 'start': G.sfx('click'); return this._start();
        case 'guest': G.sfx('click'); return this._go(() => auth.guest({ easy: easyOn() }), b);
        case 'go-login': G.sfx('click'); return this._goForm('login');
        case 'go-register': G.sfx('click'); return this._goForm('register');
        case 'back': G.sfx('close'); return this.setView('home');
        // ---- kid view (easy mode)
        case 'mode': return this._setMode(b.dataset.mode);
        case 'parents': return this._openParents();
        case 'kid-back': G.sfx('close'); this.parent = false; this.renderHome(); return this.setView('kid');
        case 'kid-go': return this._kidGo(b);
        case 'kid-resume': return this._kidResume(b.dataset.id, b);
        case 'kid-new': G.sfx('click'); this.kid.mode = 'new'; this._renderKid(); say('이름과 옷을 골라요. 그리고 놀러 가기를 눌러요!', { force: true, priority: 1 }); setTimeout(() => this._focusView('kid'), 40); return null;
        case 'kid-home': G.sfx('close'); this.kid.mode = 'home'; this._renderKid(); setTimeout(() => this._focusView('kid'), 40); return null;
        case 'kid-dice': {
          G.sfx('pop');
          this.kid.ni++;
          const name = this._kidIdeas();
          const t = this.el.querySelector('.kn-text');
          if (t) {
            t.textContent = name; t.dataset.say = `내 이름은 ${name}`; t.setAttribute('aria-label', `내 이름 ${name}. 눌러서 듣기`);
            if (!reduceMotion()) { t.classList.remove('roll'); void t.offsetWidth; t.classList.add('roll'); }
          }
          return say(name, { force: true, priority: 1 });
        }
        case 'kid-name': return say(`내 이름은 ${this._kidIdeas()}`, { force: true, priority: 1 });
        case 'kid-look': return this._pickLook(Number(b.dataset.i), false);
        case 'play-mode': G.sfx('click'); return this._setPlayMode(b.dataset.mode, true);
        case 'help': return openHelp();
        case 'settings': return openSettings();
        case 'credits': return openCredits();
        case 'terms': return openTerms();
        case 'fact': G.sfx('page'); return this._fact();
        case 'eye': return this._toggleEye(b);
        case 'mascot': return this._mascotNext(true);
        case 'resume': return this._resume(b.dataset.id, b);
        case 'forget': {
          const p = Profiles.get(b.dataset.id);
          if (!p) return;
          if (!(await parentGate('forget', '목록에서 지우기'))) return;
          // a kid slot other than 'guest' can only be reached through this row: forgetting it deletes its progress too
          const kidSlot = p.kind === 'guest' && p.id !== 'guest' && RX_GUEST_ID.test(p.id);
          const nm = esc(p.nickname), jo = esc(josa(p.nickname, '을/를').slice(String(p.nickname).length));
          const ok = kidSlot
            ? await askConfirm({ emoji: '🗑️', heading: '친구 지우기', title: `${josa(String(p.nickname), '을/를')} 지울까요?`, text: '놀던 기록도 함께 지워져요. 되돌릴 수 없어요.', yes: '지우기', no: '그만두기', danger: true },
              `「${nm}」${jo} 목록에서 지울까요?<br><span class="small dim">이 친구(게스트)의 진행 상황도 함께 지워져요. 되돌릴 수 없어요.</span>`, { title: '친구 지우기', icon: 'trash', okText: '진행 상황까지 지우기', danger: true })
            : await G.ui.confirm(`「${nm}」${jo} 최근 플레이 목록에서 지울까요?<br><span class="small dim">저장된 진행 상황은 지워지지 않아요. 다시 로그인하면 이어서 할 수 있어요.</span>`, { title: '목록에서 지우기', icon: 'trash', okText: '지우기', html: true });
          if (!ok) return;
          Profiles.remove(p.id);
          if (kidSlot) { store.del(SAVE_KEY(p.id)); store.del(`${SAVE_KEY(p.id)}.bak`); G.log.info('AUTH', 'kid profile removed with its save'); }
          this.renderHome();
          return;
        }
        default:
      }
    },

    /** 👨‍👩‍👧 어른 메뉴: parent gate -> the classic title (forms, recent list, settings) */
    async _openParents() {
      G.sfx('click');
      if (!easyOn()) { this.parent = false; return this.setView('home'); }
      const ok = await parentGate('parents', '어른 메뉴', '로그인·회원가입·자세한 설정은 어른과 함께 해요.');
      if (!ok || !this.open) return null;
      this.parent = true;
      this.renderHome();
      this.setView('home');
      return true;
    },
    /** login / register forms: behind the parent gate in easy mode */
    async _goForm(view) {
      if (easyOn() && !this.parent) {
        const ok = await parentGate(view, view === 'login' ? '로그인은 어른과 함께' : '회원가입은 어른과 함께');
        if (!ok || !this.open) return null;
        this.parent = true;
        this.renderHome();
      }
      this.setView(view);
      return true;
    },
    /** kid face cards: kid profiles open with one tap; accounts (a grown-up's, even when remembered) need the gate */
    async _kidResume(id, btn) {
      const p = Profiles.get(id);
      if (!p) { this.renderHome(); return null; }
      if (p.kind !== 'guest') {
        G.sfx('click');
        say('어른이 열어 줘야 해요.', { force: true, priority: 1 });
        const ok = await parentGate('login', '어른 계정', `${String(p.nickname || '').slice(0, 12)} 계정은 어른이 열어 줘요.`);
        if (!ok || !this.open) return null;
        this.parent = true; // the grown-up is here: an expired remember-me falls back to the login form, not the kid view
        if (this._oneClick(p)) return this._resume(id, btn);
        this.renderHome();
        this._toLogin(p);
        return null;
      }
      return this._resume(id, btn);
    },

    async _start() {
      const plan = this._plan();
      const btn = this.el.querySelector('.ts-start');
      if (plan.kind === 'server') return this._go(() => auth.resume({ kind: 'server', id: indexId(auth.serverUser) }), btn);
      if (plan.kind === 'resume') return this._resume(plan.entry.id, btn);
      if (plan.kind === 'login') { this._toLogin(plan.entry); return null; }
      return this._go(() => auth.guest({ id: plan.entry?.id, easy: easyOn() }), btn);
    },
    _toLogin(entry) {
      if (easyOn() && !this.parent) { this.renderHome(); this.setView('kid'); return; } // forms only after the parent gate
      this.setView('login', { focus: false });
      const i = this.el.querySelector('[data-form=login] [name=login]');
      if (i && entry) i.value = entry.kind === 'local' ? (Accounts.byId(entry.id)?.email || entry.nickname || '') : (entry.nickname || '');
      setTimeout(() => { if (!touchUI()) this.el?.querySelector(i?.value ? '[data-form=login] [name=password]' : '[data-form=login] [name=login]')?.focus(); }, 80);
    },

    async _resume(id, btn) {
      const p = Profiles.get(id);
      if (!p) { this.renderHome(); return; }
      G.sfx('click');
      if (p.kind === 'server' && !isServer()) { G.ui.toast('서버 계정은 서버 모드에서만 이어할 수 있어요.', { type: 'warn' }); return; }
      if (p.kind === 'local' && isServer()) { G.ui.toast('로컬 계정은 로컬 모드에서만 이어할 수 있어요.', { type: 'warn' }); return; }
      const prof = await auth.resume(p).catch(() => null);
      if (prof) return this._go(() => prof, btn);
      this._toLogin(p);
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
        G.log.error('AUTH', 'start failed', e?.message || e);
        G.ui.toast(e instanceof AuthError ? e.message : '게임을 시작하지 못했어요. 잠시 후 다시 시도해 주세요.', { type: 'error', easy: e?.code === 'KID_FULL' ? '친구 자리가 꽉 찼어요. 어른을 불러요!' : undefined, retry: e?.code === 'KID_FULL' ? undefined : () => btn?.isConnected && btn.click() });
      } finally { this._setBusy(false, btn); }
    },

    _setBusy(on, btn) {
      this.busy = !!on;
      this.el?.classList.toggle('busy', !!on);
      if (btn) { btn.classList.toggle('loading', !!on); btn.setAttribute('aria-busy', on ? 'true' : 'false'); }
      for (const b of this.el?.querySelectorAll('.ts-card button, .ts-plist button') || []) if (b !== btn) b.disabled = !!on;
      if (!on) this._applyLock();
    },

    // ------------------------------------------------------------ forms
    _pwField(id, name, label, ac, ph, extra = '') {
      return `<div class="field" data-field="${name}">
            <label for="${id}">${label}</label>
            <div class="pw-wrap"><input id="${id}" name="${name}" type="password" autocomplete="${ac}" maxlength="64" placeholder="${ph}" spellcheck="false" autocapitalize="off">
              <button type="button" class="pw-eye" data-act="eye" aria-label="비밀번호 보기" aria-pressed="false">${EYE_SVG}</button></div>
            ${extra}
            <div class="hint caps" hidden>⇪ Caps Lock이 켜져 있어요</div>
            <div class="error" role="alert"></div>
          </div>`;
    },
    _loginHtml() {
      return `
        <div class="ts-view-head"><button type="button" class="icon-btn" data-act="back" aria-label="처음 화면으로">${ico('chevron-left')}</button><h2><span class="emoji">🔑</span>로그인</h2></div>
        <p class="ts-note" data-note="login"></p>
        <form class="ts-form" data-form="login" novalidate autocomplete="on">
          <div class="field" data-field="login">
            <label for="ts-login-id">아이디(닉네임) 또는 이메일</label>
            <input id="ts-login-id" name="login" type="text" inputmode="email" autocomplete="username" maxlength="120" placeholder="name@example.com" spellcheck="false" autocapitalize="off">
            <div class="error" role="alert"></div>
          </div>
          ${this._pwField('ts-login-pw', 'password', '비밀번호', 'current-password', '비밀번호')}
          <label class="check"><input type="checkbox" name="remember"> 이 기기에서 로그인 상태 유지 <small class="muted">(30일 · 공용 PC에서는 끄세요)</small></label>
          <div class="ts-lock" role="status" hidden></div>
          <div class="form-error" role="alert" hidden></div>
          <button type="submit" class="btn btn-primary btn-lg btn-block ts-submit"><span class="spin" aria-hidden="true"></span><span class="lbl">로그인</span></button>
          <p class="ts-switch">아직 계정이 없나요? <button type="button" class="link" data-act="go-register">회원가입</button></p>
        </form>`;
    },
    _registerHtml() {
      return `
        <div class="ts-view-head"><button type="button" class="icon-btn" data-act="back" aria-label="처음 화면으로">${ico('chevron-left')}</button><h2><span class="emoji">🌱</span>회원가입</h2></div>
        <p class="ts-note" data-note="register"></p>
        <form class="ts-form" data-form="register" novalidate autocomplete="on">
          <div class="field" data-field="email">
            <label for="ts-reg-email">이메일</label>
            <input id="ts-reg-email" name="email" type="email" inputmode="email" autocomplete="email" maxlength="120" placeholder="name@example.com" spellcheck="false" autocapitalize="off">
            <div class="error" role="alert"></div>
          </div>
          <div class="field" data-field="nickname">
            <label for="ts-reg-nick">닉네임 <small class="muted">2~12자 · 한글·영문·숫자·_</small></label>
            <input id="ts-reg-nick" name="nickname" type="text" autocomplete="nickname" maxlength="24" placeholder="예: 메주콩" spellcheck="false" autocapitalize="off">
            <div class="hint ok" hidden></div>
            <div class="error" role="alert"></div>
          </div>
          ${this._pwField('ts-reg-pw', 'password', '비밀번호', 'new-password', '영문·숫자 포함 8자 이상',
            `<div class="pw-strength" aria-live="polite"><div class="pw-meter"><i></i></div><span class="pw-label">비밀번호 강도</span></div>
            <ul class="pw-rules" aria-label="비밀번호 조건"><li data-rule="len">8자 이상</li><li data-rule="alpha">영문 포함</li><li data-rule="digit">숫자 포함</li><li data-rule="safe">흔하지 않은 조합</li></ul>`)}
          <div class="field" data-field="confirm">
            <label for="ts-reg-pw2">비밀번호 확인</label>
            <input id="ts-reg-pw2" name="confirm" type="password" autocomplete="new-password" maxlength="64" placeholder="비밀번호를 한 번 더 입력">
            <div class="error" role="alert"></div>
          </div>
          <div class="field ts-playmode" data-field="playMode">
            <span class="ts-pm-label" id="ts-pm-label">누가 놀아요? <small class="muted">나중에 설정에서 바꿀 수 있어요</small></span>
            <div class="seg ts-pm-seg" role="radiogroup" aria-labelledby="ts-pm-label">
              <button type="button" role="radio" data-act="play-mode" data-mode="easy" aria-checked="false"><span class="emoji">🧒</span>아이 <small>쉬운 모드</small></button>
              <button type="button" role="radio" data-act="play-mode" data-mode="normal" aria-checked="false"><span class="emoji">🧑</span>어른 <small>일반 모드</small></button>
            </div>
          </div>
          <div class="field ts-transfer" data-field="transferGuest" hidden>
            <label class="check"><input type="checkbox" name="transferGuest"><span><span class="emoji">🎒</span> 게스트로 하던 진행 상황 이어받기</span></label>
          </div>
          <label class="check"><input type="checkbox" name="remember"> 이 기기에서 로그인 상태 유지 <small class="muted">(30일)</small></label>
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
        ? `${ico('shield', 'ico-sm')}<span>서버 계정으로 로그인해요. 진행 상황은 계정 서버에 저장돼요.</span>`
        : `${ico('lock', 'ico-sm')}<span>이 브라우저에서 만든 로컬 계정으로 로그인해요. 5번 틀리면 잠시 잠겨요.</span>`;
      G.ui.hydrateIcons(n);
      this._applyLock();
    },
    _prepRegister() {
      // who will play on this account? defaults to the title's current mode
      const seg = this.el.querySelector('[data-field=playMode]');
      if (seg && !seg.dataset.touched) this._setPlayMode(easyOn() ? 'easy' : 'normal');
      const n = this.el.querySelector('[data-note=register]');
      n.innerHTML = isServer()
        ? `${ico('shield', 'ico-sm')}<span>계정과 진행 상황이 서버에 안전하게 저장돼요. 비밀번호는 암호화되어 보관돼요.</span>`
        : `${ico('info', 'ico-sm')}<span>로컬 모드: 계정과 진행 상황은 이 브라우저에만 저장돼요. 다른 사이트에서 쓰는 비밀번호는 사용하지 마세요.${Accounts.all().length ? '' : ' <b class="gold">첫 번째 계정에는 관리자 권한이 주어져요.</b>'}</span>`;
      G.ui.hydrateIcons(n);
      const tr = this.el.querySelector('[data-field=transferGuest]');
      if (tr) {
        const from = RX_GUEST_ID.test(this._transferFrom) ? this._transferFrom : 'guest';
        const can = !isServer() && hasGuestSave(from);
        tr.hidden = !can;
        if (can) {
          const gp = Profiles.get(from);
          tr.querySelector('span:last-child').textContent = ` 게스트(${gp?.nickname || '게스트'}${gp?.level ? ` · Lv.${Number(gp.level) || 1}` : ''}) 진행 상황 이어받기`;
        } else tr.querySelector('input').checked = false;
      }
    },
    /** register form: the kid profile whose progress is being moved over (its name may be reused) */
    _keepId(form) {
      const from = RX_GUEST_ID.test(this._transferFrom) ? this._transferFrom : 'guest';
      return form?.querySelector('[name=transferGuest]')?.checked && !isServer() && hasGuestSave(from) ? from : undefined;
    },
    _setPlayMode(mode, user) {
      const seg = this.el?.querySelector('[data-field=playMode]');
      if (!seg) return;
      seg.dataset.mode = mode === 'easy' ? 'easy' : 'normal';
      if (user) seg.dataset.touched = '1';
      for (const b of seg.querySelectorAll('[data-mode]')) {
        const on = b.dataset.mode === seg.dataset.mode;
        b.classList.toggle('active', on);
        b.setAttribute('aria-checked', on ? 'true' : 'false');
        b.tabIndex = on ? 0 : -1;
      }
    },

    /** login form: show the throttle countdown and disable submit while locked (local mode) */
    _applyLock() {
      clearInterval(this._lockTimer);
      const form = this.el?.querySelector('[data-form=login]');
      if (!form || isServer()) return;
      const box = form.querySelector('.ts-lock');
      const btn = form.querySelector('.ts-submit');
      const tick = () => {
        const login = form.querySelector('[name=login]').value;
        const left = login ? Lock.left(lockKey(login, Accounts.byLogin(login))) : 0;
        box.hidden = !left;
        if (left) box.textContent = `🔒 보안을 위해 잠시 잠겼어요. ${waitText(left)}후에 다시 시도할 수 있어요.`;
        if (!this.busy) btn.disabled = !!left;
        if (!left) clearInterval(this._lockTimer);
        return left;
      };
      if (tick()) this._lockTimer = setInterval(tick, 1000);
    },

    _resetForms() {
      if (!this.el) return;
      clearInterval(this._lockTimer);
      for (const f of this.el.querySelectorAll('form[data-form]')) {
        f.reset(); // also wipes typed passwords from the DOM
        f._touched?.clear();
        for (const fl of f.querySelectorAll('.field')) this._setError(f, fl.dataset.field, '');
        this._formError(f, '');
        const ok = f.querySelector('.hint.ok'); if (ok) ok.hidden = true;
        const lk = f.querySelector('.ts-lock'); if (lk) lk.hidden = true;
        this._updatePwUi(f);
        for (const i of f.querySelectorAll('.pw-wrap input, input[name=confirm]')) i.type = 'password';
        for (const b of f.querySelectorAll('.pw-eye')) { b.innerHTML = EYE_SVG; b.setAttribute('aria-pressed', 'false'); b.setAttribute('aria-label', '비밀번호 보기'); }
      }
      const pm = this.el.querySelector('[data-field=playMode]');
      if (pm) delete pm.dataset.touched;
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
      const c = b.closest('form')?.querySelector('[name=confirm]');
      if (c) c.type = input.type; // keep the confirm field in sync
    },

    _bindForm(form) {
      const kind = form.dataset.form;
      form._touched = new Set();
      const checkNick = U.debounce(() => this._nickStatus(form), 260);
      const checkLock = U.debounce(() => this._applyLock(), 300);
      form.addEventListener('input', (e) => {
        const n = e.target.name;
        if (!n) return;
        this._formError(form, '');
        if (n === 'password') this._updatePwUi(form);
        if (form._touched.has(n) || (n === 'agree' && e.target.checked)) this._validateField(form, n);
        if (n === 'password' && form._touched.has('confirm')) this._validateField(form, 'confirm');
        if (kind === 'register' && (n === 'nickname' || n === 'email') && form._touched.has('password')) this._validateField(form, 'password');
        if (kind === 'register' && n === 'nickname') checkNick();
        if (kind === 'login' && n === 'login') checkLock();
      });
      form.addEventListener('focusout', (e) => {
        const n = e.target.name;
        if (!n || n === 'agree' || n === 'remember' || n === 'transferGuest') return;
        if (e.target.value) { form._touched.add(n); this._validateField(form, n); }
      });
      const caps = (e) => {
        if (typeof e.getModifierState !== 'function' || !e.target.closest) return;
        const on = e.getModifierState('CapsLock');
        const hint = e.target.closest('.field')?.querySelector('.hint.caps');
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
      const err = v ? V.nickname(v, { account: true, checkTaken: !isServer(), excludeId: this._keepId(form) }) : '';
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
        meter.querySelector('i').style.transform = `scaleX(${pw ? (s + 1) / 5 : 0})`;
        meter.querySelector('.pw-label').textContent = pw ? `강도: ${STRENGTH[s]}` : '비밀번호 강도';
      }
      const low = pw.toLowerCase();
      const rules = { len: pw.length >= 8, alpha: /[A-Za-z]/.test(pw), digit: /[0-9]/.test(pw), safe: pw.length >= 8 && !WEAK.includes(low) && !/^(.)\1{7,}$/.test(pw) };
      for (const li of form.querySelectorAll('.pw-rules [data-rule]')) li.classList.toggle('ok', !!rules[li.dataset.rule]);
    },

    _value(form, name) {
      const el = form.querySelector(`[name="${name}"]`);
      if (!el) return '';
      return el.type === 'checkbox' ? el.checked : el.value;
    },

    _fieldError(form, name) {
      const v = this._value(form, name);
      if (form.dataset.form === 'login') {
        if (name === 'login') return String(v).trim() ? '' : '아이디(닉네임) 또는 이메일을 입력해 주세요.';
        if (name === 'password') return v ? '' : '비밀번호를 입력해 주세요.';
        return '';
      }
      switch (name) {
        case 'email': return V.email(v);
        case 'nickname': return V.nickname(v, { account: true, checkTaken: !isServer(), excludeId: this._keepId(form) });
        case 'password': return V.password(v, { email: this._value(form, 'email'), nickname: this._value(form, 'nickname') });
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
      if (input) {
        if (msg) { input.setAttribute('aria-invalid', 'true'); if (box) { box.id = box.id || `${input.id || name}-err`; input.setAttribute('aria-describedby', box.id); } }
        else { input.removeAttribute('aria-invalid'); input.removeAttribute('aria-describedby'); }
      }
    },

    _formError(form, msg) {
      const box = form.querySelector('.form-error');
      if (!box) return;
      box.textContent = msg || '';
      box.hidden = !msg;
    },

    _shake() {
      const c = this.el?.querySelector('.ts-card');
      if (!c || reduceMotion()) return;
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
          const pm = form.querySelector('[data-field=playMode]')?.dataset.mode;
          profile = await auth.register({
            email: this._value(form, 'email'), nickname: this._value(form, 'nickname'), password: this._value(form, 'password'),
            confirm: this._value(form, 'confirm'), agree: !!this._value(form, 'agree'), remember: !!this._value(form, 'remember'),
            transferGuest: !!this._value(form, 'transferGuest'), transferFrom: this._transferFrom,
            easy: pm === 'easy' ? true : pm === 'normal' ? false : undefined,
          });
        }
      } catch (e) {
        this._setBusy(false, btn);
        const ae = e instanceof AuthError ? e : null;
        if (!ae) G.log.error('AUTH', `${kind} failed`, e?.message || e);
        const msg = ae ? ae.message : '알 수 없는 문제로 처리하지 못했어요. 잠시 후 다시 시도해 주세요.';
        if (ae?.field && form.querySelector(`[data-field="${ae.field}"]`)) {
          this._setError(form, ae.field, msg);
          if (ae.field === 'password' && kind === 'login') { const pw = form.querySelector('[name=password]'); if (pw) pw.value = ''; }
          form.querySelector(`[name="${ae.field}"]`)?.focus();
        } else this._formError(form, msg);
        if (ae?.code === 'LOCKED') this._applyLock();
        this._shake();
        G.sfx('error');
        return;
      }
      // never keep typed passwords in the DOM longer than needed
      for (const i of form.querySelectorAll('input[type=password], .pw-wrap input')) i.value = '';
      if (kind === 'register') {
        G.ui.toast(`회원가입을 축하해요, ${profile.nickname}님!`, { type: 'success', emoji: '🎉' });
        if (profile.transferred) setTimeout(() => G.ui.toast('게스트로 하던 진행 상황을 새 계정으로 옮겼어요.', { type: 'info', emoji: '🎒', duration: 4200 }), 700);
        if (profile.firstAdmin) setTimeout(() => G.ui.toast('첫 번째 계정이라 관리자 권한이 주어졌어요. 메뉴의 ‘개발자·관리자 센터’를 이용할 수 있어요.', { type: 'info', emoji: '🛡️', duration: 5200 }), 1400);
      }
      try { await app.enterGame(profile); } finally { this._setBusy(false, btn); }
    },
  };

  // ================================================================ onboarding (coach marks for new players)
  //   normal: 0 move · 1 look · 2 golden marker · 3 talk (E) · 4 final card
  //   easy  : 0 move · 2 "👉 같이 가기" · 3 talk (👆) · 4 celebration — step 1 (camera drag) is skipped; one short
  //           sentence per step, read aloud, a pointing hand (G.easy.point) and auto-advance on the real action.
  //   Both flows share state.tutorial.step, so switching easy <-> normal mid-way just continues.
  const STEP_COUNT = 4;
  const STEP_MOOD = ['happy', 'wink', 'think', 'cheer'];
  const EASY_STEPS = [0, 2, 3];
  const _obV = new THREE.Vector3();
  const Onboarding = {
    active: false,
    step: -1,         // 0 move · 1 look · 2 marker · 3 talk · 4 final card
    layer: null, coach: null, ring: null, final: null,
    _t: 0, _start: new THREE.Vector3(), _drag: 0, _drag0: null, _talkSeen: 0, _key: '', _hidden: true,
    _waitDialogue: false, _finalTimer: 0, _offEsc: null, _hint: false, _hintKey: '',
    _hand: null, _handKey: '', _handAt: 0, _sayStep: -1, _ground: null,

    init() {
      const layer = h('div', { class: 'coach-layer', 'aria-live': 'polite' });
      const coach = h('div', { class: 'coach', role: 'status', hidden: true });
      const ring = h('div', { class: 'coach-ring', hidden: true, 'aria-hidden': 'true' });
      // the coach card is in the DOM only while visible: 08-easy holds back the "다음 할 일" voice while it is there
      layer.append(ring);
      ($('#app') || document.body).appendChild(layer);
      this.layer = layer; this.coach = coach; this.ring = ring;
      coach.addEventListener('click', (e) => {
        if (e.target.closest('[data-c=skip]')) this.skip();
        else if (e.target.closest('[data-c=say]')) { const c = this._content(); if (c) say(c.say || c.text, { force: true, priority: 1 }); }
      });
      G.bus.on('easy:changed', () => {
        if (!this.active) return;
        this._key = ''; this._sayStep = -1; this._dropHand();
        if (easyOn() && this.step === 1) this._go(2, { silent: true });
      });
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
        gc.addEventListener('wheel', () => { if (this.active && this.step === 1) this._drag += 30; }, { passive: true });
      }
      // keyboard camera control counts too (arrow keys rotate in some setups) — Q/E are not camera keys here
      G.bus.on('npc:talk', ({ npcId } = {}) => {
        if (!this.active || npcId !== 'NPC001' || this.step >= 4) return;
        this._waitDialogue = true;
        this._go(4, { silent: true });
      });
      G.bus.on('dialogue:end', () => { if (this.active && this.step === 4 && this._waitDialogue) this._queueFinal(700); });
      // easy mode: a child who already uses the gold prompt on something else (crop bed, jar, sign…) has learned
      // what the "인사" step teaches — finish with the celebration instead of nagging "같이 가기를 눌러요!" forever
      G.bus.on('interact', ({ id } = {}) => {
        if (!this.active || !easyOn() || (this.step !== 2 && this.step !== 3) || id === 'NPC001') return;
        this._go(4, { silent: true });
      });
      // a child who tapped 👉 같이 가기 is on the way: the coach stops repeating the instruction
      G.bus.on('ui:action', ({ action } = {}) => {
        if (!this.active || !easyOn() || this.step !== 2 || action !== 'easy-go') return;
        this._going = true; this._key = ''; this._dropHand();
      });
    },

    /** decide whether to run the tutorial for this freshly loaded state */
    sync(state, isNew) {
      this.stop();
      if (!state) return;
      const t = state.tutorial && typeof state.tutorial === 'object' ? state.tutorial : (state.tutorial = { step: 0, done: false });
      if (G.flags.noTutorial || t.done) return;
      if (!isNew && !(Number(t.step) > 0)) return; // existing saves from before onboarding existed
      // already talked to the master (e.g. imported save): only the final card is left
      const q = state.quests?.QUEST001;
      const talked = !!(state.npcsTalked?.NPC001) || (q && (q.status === 'completed' || q.status === 'claimed' || (Number(q.progress?.[0]) || 0) >= 1));
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
      this._celebrating = false;
      this._waitDialogue = false;
      clearTimeout(this._finalTimer);
      this._hideFinal();
      this._showCoach(false);
      if (this.ring) this.ring.hidden = true;
      this._hidden = true;
      this._key = '';
      this._sayStep = -1;
      this._dropHand();
      this._borrowHint(false);
    },

    skip() {
      if (!this.active) return;
      const t = G.state?.tutorial;
      if (t) { t.done = true; t.skipped = true; t.doneAt = G.time.now(); G.dirty('tutorial'); }
      this.stop();
      G.sfx('close');
      if (easyOn()) G.ui.toast('언제든 메뉴의 ❓ 도와줘요를 눌러요!', { type: 'info', emoji: '💡', say: '언제든 도와줘요를 눌러요!' });
      else G.ui.toast('튜토리얼을 건너뛰었어요. 조작법은 언제든 H 키(도움말)로 볼 수 있어요.', { type: 'info', emoji: '💡' });
    },

    /** attach / detach the coach card */
    _showCoach(v) {
      const co = this.coach;
      if (!co) return;
      co.hidden = !v;
      if (v) { if (!co.isConnected && this.layer) this.layer.appendChild(co); } else if (co.isConnected) co.remove();
    },
    _dropHand() { if (this._hand) { try { this._hand.stop(); } catch (e) { /* ignore */ } this._hand = null; } this._handKey = ''; },
    /** a spot on the ground ~5 m in front of the camera (desktop "tap here to walk") */
    _groundPoint() {
      const p = G.sys.player?.position, cam = G.sys.engine?.camera;
      if (!p || !cam) return null;
      cam.getWorldDirection(_obV);
      _obV.y = 0;
      if (_obV.lengthSq() < 1e-6) _obV.set(0, 0, -1); else _obV.normalize();
      for (const d of [5, 3.5, 2.5]) {
        const x = p.x + _obV.x * d, z = p.z + _obV.z * d;
        let bad = false;
        try { bad = !!G.world?.isWater?.(x, z) || !!G.world?.blocked?.(x, z); } catch (e) { bad = false; }
        if (!bad) return { x, z };
      }
      return null;
    },
    /** easy mode: keep a pointing hand on the current step's target (re-point a while after the child tapped it) */
    _handTick() {
      if (this.step === 2 && this._going) return; // walking with 👉 같이 가기: no hand (and no per-frame lookups)
      const touch = touchUI();
      const t = performance.now();
      if (this._handKey && this._hStep === this.step && this._hTouch === touch && (this._hand?.active || t - this._handAt < 7000)) return;
      const c = this._content();
      if (!c || !c.hand || typeof G.easy?.point !== 'function') return;
      this._handKey = 'h'; this._hStep = this.step; this._hTouch = touch; this._handAt = t;
      let target = c.hand;
      if (target === 'ground') { if (!this._ground) this._ground = this._groundPoint(); target = this._ground; if (!target) return; }
      else if (this.step === 2) { const go = $('#easy-next .en-go'); target = go && !go.hidden && go.offsetParent !== null ? go : '#easy-next'; }
      this._hand = G.easy.point(target, { label: c.handLabel, duration: 0, offsetY: 0.2 });
    },

    /** while a coach card explains a step the quest hint is suspended and #objective-hint stays clear (no duplicate text) */
    _borrowHint(on) {
      if (on) {
        if (!this._hint) { this._hint = true; G.sys.quest?.suspendHint?.(true); }
        if (this._hintKey !== 'off') { this._hintKey = 'off'; G.ui.objective?.(null); }
      } else if (this._hint) {
        this._hint = false; this._hintKey = '';
        G.sys.quest?.suspendHint?.(false);
      }
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
      this._ground = null;
      this._going = false;
      this._dropHand();
      const t = G.state?.tutorial;
      if (t && step <= 4 && Number(t.step || 0) !== step) { t.step = step; G.dirty('tutorial'); }
      if (!opts.silent && step > prev) { G.sfx('correct'); G.fx?.pulse?.('#f4c54a'); }
      if (step >= 4) { this._showCoach(false); if (this.ring) this.ring.hidden = true; }
      if (step === 4 && !this._waitDialogue) this._queueFinal(500);
      this._syncHint();
    },
    _syncHint() {
      if (!this.active || this.step < 0 || this.step >= 4 || this.step === 2) { this._borrowHint(false); return; }
      this._borrowHint(true);
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
      const easy = easyOn();
      if (easy && this.step === 1) { this._go(2, { silent: true }); return; }
      // 쉬운 모드: next to something else (crop bed, jar, sign…) the gold prompt is the ONE obvious action — the coach
      // card and its hand step aside until the prompt goes away (tapping it finishes the onboarding, see 'interact')
      const hidden = this._blocked() || (easy && this.step === 2 && this._otherPromptVisible());
      const p = G.sys.player?.position;
      if (!hidden) {
        if (this.step === 0 && p) {
          const dx = p.x - this._start.x, dz = p.z - this._start.z;
          if (dx * dx + dz * dz > 3.2) this._go(1);
        } else if (this.step === 1) {
          if (this._drag > 140) this._go(2);
        } else if (this.step === 2 || this.step === 3) {
          // 👉 같이 가기 was tapped but the walk ended (cancelled by the joystick, or arrived elsewhere): ask again
          if (this.step === 2 && this._going) {
            const moving = !!G.sys.player?.isWalking || !!G.sys.minimap?._travel;
            this._goingIdle = moving ? 0 : (this._goingIdle || 0) + dt;
            if (this._goingIdle > 3) { this._going = false; this._goingIdle = 0; this._key = ''; this._handKey = ''; }
          }
          const near = this._npcPromptVisible();
          if (this.step === 2 && near) this._go(3, { silent: true });
          else if (this.step === 3) { this._talkSeen = near ? 0 : this._talkSeen + dt; if (this._talkSeen > 1.6) this._go(2, { silent: true }); }
        }
      }
      if (this.step >= 4) { this._showCoach(false); this.ring.hidden = true; this._dropHand(); return; }
      if (hidden !== this._hidden) { this._hidden = hidden; this._showCoach(!hidden); if (hidden) { this.ring.hidden = true; this._dropHand(); } else this._key = ''; }
      if (hidden) return;
      this._render();
      this._posT = (this._posT || 0) - dt;
      if (this._posT <= 0) { this._posT = 0.12; this._position(); }
      if (easy) this._handTick();
    },

    _otherPromptVisible() {
      const pr = $('#interact-prompt');
      if (!pr || pr.hidden) return false;
      const cur = G.interact?.current;
      return !!cur && cur.id !== 'NPC001' && cur.kind !== 'npc';
    },
    _npcPromptVisible() {
      const pr = $('#interact-prompt');
      if (!pr || pr.hidden) return false;
      const cur = G.interact?.current;
      return !cur || cur.id === 'NPC001' || cur.kind === 'npc';
    },

    _content() {
      const touch = touchUI();
      if (easyOn()) {
        switch (this.step) {
          case 0: return touch
            ? { emoji: '🚶', text: '동그라미를 밀어서 걸어요!', say: '걸어 봐요! 동그라미를 손가락으로 밀어요.', anchor: '#joystick', hand: '#joystick', handLabel: '밀어요!' }
            : { emoji: '🚶', text: '손가락이 가리키는 땅을 눌러요!', say: '걸어 봐요! 손가락이 가리키는 땅을 눌러요.', anchor: null, hand: 'ground', handLabel: '눌러요!' };
          case 2: return this._going
            ? { emoji: '🚶', text: '같이 가고 있어요!', say: '같이 가고 있어요! 조금만 기다려요.', anchor: '#easy-next', hand: null }
            : { emoji: '👉', text: '같이 가기를 눌러요!', say: '같이 가기를 누르면 발효 할아버지에게 데려다줘요!', anchor: '#easy-next', hand: '#easy-next', handLabel: '눌러요!' };
          case 3: return touch
            ? { emoji: '👋', text: '👆 버튼을 눌러 인사해요!', say: '노란 손가락 버튼을 눌러 인사해요!', anchor: '.mb-interact', hand: '.mb-interact', handLabel: '눌러요!' }
            : { emoji: '👋', text: '반짝이는 버튼을 눌러 인사해요!', say: '반짝이는 버튼을 눌러 인사해요!', anchor: '#interact-prompt', hand: '#interact-prompt', handLabel: '눌러요!' };
          default: return null;
        }
      }
      switch (this.step) {
        case 0: return {
          title: '이동하기', emoji: '🚶',
          text: touch ? '왼쪽 조이스틱을 밀어 이동해 보세요' : 'W A S D 키로 이동해 보세요',
          sub: touch ? '조이스틱을 끝까지 밀면 달릴 수 있어요.' : '방향키도 돼요. Shift를 누른 채 움직이면 달려요.',
          visual: touch ? `<div class="cv cv-joy"><i></i></div>` : `<div class="cv cv-keys"><kbd class="k-w">W</kbd><kbd class="k-a">A</kbd><kbd class="k-s">S</kbd><kbd class="k-d">D</kbd></div>`,
          anchor: touch ? '#joystick' : null, place: touch ? 'top' : 'center',
        };
        case 1: return {
          title: '둘러보기', emoji: '👀',
          text: touch ? '화면을 손가락으로 끌어 시점을 돌려 보세요' : '마우스를 끌어 시점을 돌려 보세요',
          sub: touch ? '두 손가락으로 벌리거나 오므리면 확대·축소돼요.' : '왼쪽 버튼을 누른 채 끌어요. 휠로 확대·축소할 수 있어요.',
          visual: touch ? `<div class="cv cv-drag"><span class="emoji">👆</span></div>` : `<div class="cv cv-mouse"><svg viewBox="0 0 40 56" aria-hidden="true"><rect x="6" y="4" width="28" height="44" rx="14" fill="none" stroke="currentColor" stroke-width="3"/><path d="M20 4v16M6 20h28" stroke="currentColor" stroke-width="3"/><path d="M6 20V18a14 14 0 0 1 14-14v16z" fill="#f4c54a"/></svg><i class="arr l">‹</i><i class="arr r">›</i></div>`,
          anchor: null, place: 'center',
        };
        case 2: return {
          title: '목표 찾기', emoji: '✨',
          text: '금빛 표식을 따라 발효마스터를 찾아가세요',
          sub: '화면 위 ‘현재 목표’ 안내와 미니맵의 금빛 표시가 길을 알려 줘요.',
          visual: `<div class="cv cv-marker"><svg viewBox="0 0 40 48" aria-hidden="true"><path d="M20 2 34 18 20 34 6 18z" fill="#f4c54a" stroke="#fff3c4" stroke-width="2"/><path d="M20 36v10" stroke="#f4c54a" stroke-width="3" stroke-linecap="round" opacity=".7"/></svg></div>`,
          anchor: '#objective-hint', place: 'bottom',
        };
        case 3: return {
          title: '상호작용', emoji: '💬',
          text: touch ? 'E 버튼을 눌러 발효마스터와 대화해 보세요' : 'E 키를 눌러 발효마스터와 대화해 보세요',
          sub: '물 주기·장독 확인·안내판 보기도 모두 E 키로 해요. 대상을 클릭해도 돼요.',
          visual: `<div class="cv cv-e"><kbd>E</kbd></div>`,
          anchor: touch ? '.mb-interact' : '#interact-prompt', place: 'top',
        };
        default: return null;
      }
    },

    _render() {
      const easy = easyOn(), touch = touchUI();
      // cheap per-frame check first: nothing is built unless the step / input kind / mode changed
      const going = !!this._going;
      if (this._key && this._kStep === this.step && this._kTouch === touch && this._kEasy === easy && this._kGoing === going) return;
      const c = this._content();
      if (!c) return;
      this._key = 'k'; this._kStep = this.step; this._kTouch = touch; this._kEasy = easy; this._kGoing = going;
      this.coach.classList.toggle('kid', easy);
      this.coach.style.width = ''; // _position may narrow it again (phones: clear of the left tiles)
      if (easy) {
        const pips = EASY_STEPS.map((s) => `<i class="${s < this.step ? 'done' : s === this.step ? 'on' : ''}"></i>`).join('');
        this.coach.innerHTML = `
          <div class="coach-mascot" aria-hidden="true">${mascotSvg(STEP_MOOD[this.step] || 'happy', 64)}</div>
          <div class="coach-main">
            <div class="coach-kid-row"><span class="coach-kid-emo emoji" aria-hidden="true">${esc(c.emoji)}</span><b class="coach-kid-text">${esc(c.text)}</b></div>
            <div class="coach-kid-foot"><span class="coach-dots" aria-hidden="true">${pips}</span>
              <button type="button" class="easy-speak coach-say" data-c="say" aria-label="소리로 듣기" title="소리로 듣기"><span class="emoji" aria-hidden="true">🔊</span></button>
              <button type="button" class="coach-skip coach-kid-skip" data-c="skip" aria-label="건너뛰기" data-say="건너뛰기"><span class="emoji" aria-hidden="true">⏭️</span></button></div>
          </div>`;
        this.coach.classList.remove('pop'); void this.coach.offsetWidth; this.coach.classList.add('pop');
        this._anchor = c.anchor; this._place = 'dock';
        this._position();
        const sayKey = this.step * 2 + (going ? 1 : 0);
        if (this._sayStep !== sayKey) { this._sayStep = sayKey; say(c.say || c.text, { priority: 1 }); }
        return;
      }
      const dots = Array.from({ length: STEP_COUNT }, (_, i) => `<i class="${i < this.step ? 'done' : i === this.step ? 'on' : ''}"></i>`).join('');
      this.coach.innerHTML = `
        <div class="coach-mascot" aria-hidden="true">${mascotSvg(STEP_MOOD[this.step] || 'happy', 60)}</div>
        <div class="coach-main">
          <div class="coach-head"><span class="coach-step">${this.step + 1} / ${STEP_COUNT}</span><span class="coach-title"><span class="emoji">${c.emoji}</span> ${esc(c.title)}</span>
            <button type="button" class="coach-skip" data-c="skip">튜토리얼 건너뛰기</button></div>
          <div class="coach-body">${c.visual}<div class="coach-text"><b>${esc(c.text)}</b><small>${esc(c.sub)}</small></div></div>
          <div class="coach-dots" aria-hidden="true">${dots}</div>
        </div>
        <span class="coach-arrow" aria-hidden="true"></span>`;
      this.coach.classList.remove('pop'); void this.coach.offsetWidth; this.coach.classList.add('pop');
      this._anchor = c.anchor; this._place = c.place;
      this._position();
    },

    _position() {
      const co = this.coach;
      if (!co || co.hidden) return;
      const W = innerWidth, H = innerHeight;
      let cw = co.offsetWidth || 320;
      const ch = co.offsetHeight || 120;
      let place = this._place, r = null;
      if (this._anchor) {
        const a = $(this._anchor);
        if (a && !a.hidden && a.offsetParent !== null) { const rr = a.getBoundingClientRect(); if (rr.width > 2 && rr.height > 2) r = rr; }
      }
      if (!r && place !== 'center' && place !== 'dock') place = 'center';
      let x, y, ax = 0.5;
      if (place === 'dock') {
        // easy mode: a caption docked in the half of the screen away from what the hand points at
        const ty = r ? r.top + r.height / 2 : H * 0.62;
        x = (W - cw) / 2;
        if (ty > H * 0.45) {
          const top = $('#hud-top-center')?.getBoundingClientRect();
          y = (top && top.height > 2 ? top.bottom : 96) + 14;
        } else {
          let lim = H - 12;
          // never cover the gold interact prompt (it is what the child taps next) nor the bottom controls
          for (const sel of ['#bottom-bar', '#mobile-controls .joystick', '#mobile-controls .mobile-buttons', '#interact-prompt']) {
            const e = $(sel);
            if (!e || e.hidden || e.offsetParent === null) continue;
            const rr = e.getBoundingClientRect();
            if (rr.height > 2 && rr.top > H * 0.4) lim = Math.min(lim, rr.top);
          }
          y = lim - ch - 14;
          // no room below the HUD's top card? dock under it instead (top of the screen)
          const top = $('#hud-top-center')?.getBoundingClientRect();
          const minY = (top && top.height > 2 ? top.bottom : 96) + 10;
          if (y < minY) y = minY;
        }
        y = U.clamp(y, 8, Math.max(8, H - ch - 8));
        // phones: the big picture tiles on the left stay visible — the caption moves right of them (narrower if needed)
        const lm = $('#hud-left-menu');
        const lr = lm && lm.offsetParent !== null ? lm.getBoundingClientRect() : null;
        if (lr && lr.width > 2 && lr.right < W * 0.4 && y < lr.bottom && y + ch > lr.top) {
          const minX = lr.right + 8;
          if (W - 8 - minX < cw) { cw = Math.max(200, W - 8 - minX); co.style.width = `${cw}px`; }
          x = Math.max(minX, (W - cw) / 2);
        }
      } else if (place === 'center') { x = (W - cw) / 2; y = Math.max(H * 0.17, 92); }
      else {
        const cx = r.left + r.width / 2;
        x = U.clamp(cx - cw / 2, 12, Math.max(12, W - cw - 12));
        y = place === 'bottom' ? r.bottom + 16 : r.top - ch - 16;
        y = U.clamp(y, 8, Math.max(8, H - ch - 8));
        ax = U.clamp((cx - x) / cw, 0.08, 0.92);
      }
      co.dataset.place = place;
      co.style.setProperty('--ax', `${(ax * 100).toFixed(1)}%`);
      co.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
      // spotlight ring around the anchor
      const ring = this.ring;
      if (r && place !== 'center') {
        if (place === 'dock') co.dataset.place = 'center';
        const pad = 6;
        ring.hidden = false;
        ring.style.transform = `translate(${Math.round(r.left - pad)}px, ${Math.round(r.top - pad)}px)`;
        ring.style.width = `${Math.round(r.width + pad * 2)}px`;
        ring.style.height = `${Math.round(r.height + pad * 2)}px`;
        ring.classList.toggle('round', this._anchor === '#joystick' || this._anchor === '.mb-interact');
      } else ring.hidden = true;
    },

    _showFinal() {
      if (!this.active || this.final || this._celebrating) return;
      if (!G.state || !app.loggedIn) return;
      if (G.ui.modal.isOpen() || G.sys.dialogue?.active || document.body.classList.contains('hud-hidden')) { this._queueFinal(800); return; }
      this._showCoach(false); this.ring.hidden = true; this._dropHand();
      this._borrowHint(false);
      if (easyOn()) { this._finish(); return; } // kids get a celebration, not a list to read
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
        rings.push(h('div', { class: 'coach-hl', style: { left: `${r.left - pad}px`, top: `${r.top - pad}px`, width: `${r.width + pad * 2}px`, height: `${r.height + pad * 2}px` } }, h('span', { class: 'coach-hl-num' }, String(i + 1))));
      });
      const card = h('div', { class: 'coach-final glass', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'coach-final-title' });
      card.innerHTML = `
        <div class="cf-mascot" aria-hidden="true">${mascotSvg('cheer', 84)}</div>
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
      try { G.fx?.burst?.(G.sys.player?.position, { type: 'confetti', count: 40 }); } catch (e) { /* fx optional */ }
      const btn = card.querySelector('.cf-go');
      btn.addEventListener('click', () => this._finish());
      card.addEventListener('keydown', (e) => trapTab(card, e));
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
      if (easyOn() && typeof G.easy?.celebrate === 'function') {
        // stay "active" until the celebration is over, so pop-ups that wait for the tutorial (daily check-in...) do not cover it
        this._showCoach(false); if (this.ring) this.ring.hidden = true; this._dropHand(); this._borrowHint(false);
        this.step = Math.max(this.step, 4);
        this._celebrating = true;
        clearTimeout(this._finalTimer);
        const seq = app._loginSeq;
        Promise.resolve(G.easy.celebrate('준비 끝!', { emoji: '🎉', say: '잘했어요! 이제 위에 있는 다음 할 일을 따라 신나게 놀아요!', duration: 2600, sound: 'quest' }))
          .catch(() => {}).finally(() => { this._celebrating = false; if (app._loginSeq === seq && this.active && this.step >= 4) this.stop(); });
      } else {
        this.stop();
        G.sfx('quest');
        G.ui.banner('퀘스트 패널의 현재 목표를 따라가면 핵심 체험을 모두 해 볼 수 있어요!', { icon: 'sparkle', duration: 5200 });
        G.mascot?.say?.('궁금한 게 생기면 언제든 H 키를 눌러요. 제가 도와줄게요!', { mood: 'wink' });
      }
      G.log.info('UI', 'onboarding done');
    },
  };

  // ================================================================ shared modal helpers
  let settingsSelf = false; // a settings control is writing -> do not re-render its own pane
  const setSetting = (k, v) => { settingsSelf = true; try { G.setSetting(k, v); } finally { settingsSelf = false; } };
  function settingRow(label, desc, control, extraCls = '') {
    return h('div', { class: `set-row ${extraCls}` },
      h('div', { class: 'set-label' }, h('b', null, label), desc ? h('small', null, desc) : null),
      h('div', { class: 'set-ctl' }, control));
  }
  const settingVal = (key) => G.settings[key] ?? G.settingsDefaults?.[key] ?? EXTRA_DEFAULTS[key];
  function sliderCtl(key, o = {}) {
    const min = o.min ?? 0, max = o.max ?? 1, step = o.step ?? 0.05;
    const val = U.clamp(Number(settingVal(key) ?? min) || 0, min, max);
    const show = o.fmt || ((v) => `${Math.round(v * 100)}%`);
    const out = h('output', { class: 'set-val' }, show(val));
    const input = h('input', { type: 'range', min, max, step, 'aria-label': o.label || key });
    input.value = String(val);
    const paint = () => { const k = (Number(input.value) - min) / (max - min || 1); input.style.setProperty('--fill', `${(k * 100).toFixed(1)}%`); out.textContent = show(Number(input.value)); input.setAttribute('aria-valuetext', out.textContent); };
    paint();
    const apply = () => { paint(); setSetting(key, Number(input.value)); o.after?.(Number(input.value)); };
    if (o.live === false) { input.addEventListener('input', paint); input.addEventListener('change', apply); }
    else input.addEventListener('input', apply);
    return h('div', { class: 'set-slider' }, input, out);
  }
  function switchCtl(key, o = {}) {
    const input = h('input', { type: 'checkbox', role: 'switch', 'aria-label': o.label || key });
    input.checked = o.invert ? !settingVal(key) : !!settingVal(key);
    input.addEventListener('change', () => { const v = o.invert ? !input.checked : input.checked; setSetting(key, v); o.after?.(v); G.sfx('click'); });
    return h('label', { class: 'app-switch' }, input, h('span', { class: 'sw-track', 'aria-hidden': 'true' }, h('span', { class: 'sw-thumb' })));
  }
  function segCtl(key, options, o = {}) {
    const seg = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': o.label || key });
    const cur = String(settingVal(key));
    const btns = [];
    const select = (b, opt, focus) => {
      for (const x of btns) { x.classList.remove('active'); x.setAttribute('aria-checked', 'false'); x.tabIndex = -1; }
      b.classList.add('active'); b.setAttribute('aria-checked', 'true'); b.tabIndex = 0;
      if (focus) b.focus();
      setSetting(key, opt.v);
      o.after?.(opt.v);
    };
    options.forEach((opt, i) => {
      const on = String(opt.v) === cur;
      const b = h('button', { type: 'button', role: 'radio', 'aria-checked': String(on), class: on ? 'active' : '', tabindex: on ? '0' : '-1' }, opt.e ? h('span', { class: 'emoji' }, opt.e) : null, opt.l);
      b.addEventListener('click', () => { select(b, opt, false); G.sfx('click'); });
      b.addEventListener('keydown', (e) => {
        const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
        if (!d) return;
        e.preventDefault();
        const j = (i + d + options.length) % options.length;
        select(btns[j], options[j], true);
      });
      btns.push(b);
      seg.appendChild(b);
    });
    if (!btns.some((b) => b.tabIndex === 0) && btns[0]) btns[0].tabIndex = 0;
    return seg;
  }

  // ================================================================ permissions
  function isAdmin() { return auth.current?.role === 'admin'; } // never trust G.state.profile.role (imported saves)
  const devFlag = () => G.flags.debug || G.params?.get?.('dev') === '1';
  /** CONTRACT §11.6: dev tools in production only with ?dev=1, in local mode, or for admins */
  function canDevCenter() { return isAdmin() || !isServer() || devFlag(); }
  function canDebug() { return isAdmin() || (!isServer() && devFlag()); }
  function canDashboard() { return isAdmin() || !isServer(); }
  function lastSavedText() {
    const t = G.save.lastSavedAt || G.state?.savedAt || 0;
    return t ? `마지막 저장 ${ago(t)}` : '아직 저장 전이에요';
  }

  // ================================================================ developer center (80-devcenter.js) + fallbacks
  function devCenter() { const dc = G.sys.devcenter; return dc && !dc._failed && typeof dc.open === 'function' ? dc : null; }
  function openDevCenter(tab) {
    const dc = devCenter();
    if (dc) {
      if (!canDevCenter()) { G.ui.toast('개발자·관리자 센터는 관리자 계정이나 ?dev=1 주소에서만 열 수 있어요.', { type: 'info', sound: false }); return false; }
      try { dc.open(tab); } catch (e) { G.log.error('UI', 'devcenter open failed', e); return false; }
      return true;
    }
    // fallback: built-in admin dashboard + debug panel (only while 80-devcenter.js is missing) — parent gate in easy mode
    if (!app.loggedIn) { G.ui.toast('로그인한 뒤에 열 수 있어요.', { type: 'info', sound: false }); return false; }
    if (!canDashboard() && !canDebug()) { G.ui.toast('관리자 권한이 있는 계정만 볼 수 있어요.', { type: 'warn' }); return false; }
    return parentGate('devcenter', '개발자 센터는 어른만').then((ok) => {
      if (!ok || !app.loggedIn) return false;
      if (canDashboard()) openAdmin(tab); else Debug.toggle();
      return true;
    });
  }
  function toggleDevCenter() {
    const dc = devCenter();
    if (dc) {
      if (typeof dc.isOpen === 'function' ? dc.isOpen() : !!dc.opened) { (dc.close || dc.toggle)?.call(dc); return true; }
      return openDevCenter();
    }
    if (!app.loggedIn) return false;
    if (Debug.open) { Debug.hide(); return true; }
    if (canDebug()) return parentGate('devcenter', '디버그 도구는 어른만').then((ok) => (ok && app.loggedIn ? Debug.toggle() : false));
    return openDevCenter();
  }

  // ================================================================ main menu
  /** Esc / ☰: the kid picture menu in easy mode, the full menu for grown-ups (opts.adult — behind the gate) */
  function openMenu(opts = {}) {
    if (!app.loggedIn || !G.state) return null;
    const ex = G.ui.modal.get('app-menu');
    if (ex) { ex.close(); return null; }
    if (G.sys.photo?.active) return null;
    if (easyOn() && !(opts && opts.adult)) return openKidMenu();
    return openAdultMenu();
  }

  function kidTile(t, i) {
    const b = h('button', { type: 'button', class: `easy-tile km-tile${t.lock ? ' km-lock' : ''}`, 'data-km': t.id, role: 'menuitem', tabindex: i === 0 ? '0' : '-1' },
      h('span', { class: 'et-emoji emoji', 'aria-hidden': 'true' }, t.emoji),
      h('span', { class: 'et-label' }, t.label),
      t.badge ? h('span', { class: 'et-badge' }, t.badge > 99 ? '99+' : String(t.badge)) : null,
      t.lock ? h('span', { class: 'km-lock-ico emoji', 'aria-hidden': 'true', title: '어른 확인' }, '🔒') : null);
    b.style.setProperty('--tile', t.color);
    b.style.setProperty('--i', String(i));
    b.__easySpeak = { btn: null, text: t.say || t.label };
    if (t.lock) b.setAttribute('aria-label', `${t.label} (어른 확인)`);
    return b;
  }
  /** arrow keys move between kid tiles; a keyboard-focused tile is read aloud */
  function bindTileGrid(grid, sel) {
    let sayT = 0;
    grid.addEventListener('keydown', (e) => {
      const items = Array.from(grid.querySelectorAll(sel));
      const i = items.indexOf(document.activeElement);
      if (i < 0) return;
      let cols = 3;
      try { cols = getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean).length || 3; } catch (err) { cols = 3; }
      const d = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: cols, ArrowUp: -cols, Home: -999, End: 999 }[e.key];
      if (d == null) return;
      e.preventDefault();
      const j = U.clamp(i + d, 0, items.length - 1);
      items[i].tabIndex = -1; items[j].tabIndex = 0; items[j].focus();
    });
    grid.addEventListener('focusin', (e) => {
      const b = e.target.closest(sel);
      let kbd = false;
      try { kbd = !!b && b.matches(':focus-visible'); } catch (err) { kbd = false; }
      if (!kbd) return;
      clearTimeout(sayT);
      sayT = setTimeout(() => { if (b.isConnected) say(G.easy?.textOf?.(b) || b.textContent, { priority: 0 }); }, 160);
    });
  }

  /** 쉬운 모드 menu: big picture tiles, read aloud; grown-up things sit behind 🔒 tiles */
  function openKidMenu() {
    const st = G.state, s = st.stats || {}, p = st.profile || {};
    const eng = G.sys.engagement && !G.sys.engagement._failed && typeof G.sys.engagement.open === 'function' ? G.sys.engagement : null;
    let unread = 0;
    try { unread = Number(eng?.unreadCount?.()) || 0; } catch (e) { unread = 0; }
    const comp = G.sys.companion && !G.sys.companion._failed && typeof G.sys.companion.openMenu === 'function' && G.settings.companion !== false ? G.sys.companion : null;
    const tiles = [
      { id: 'resume', emoji: '▶️', label: '계속 놀기', color: '#55d187', say: '계속 놀기. 게임으로 돌아가요.' },
      { id: 'stickerbook', emoji: '📖', label: '스티커북', color: '#ffc93c', badge: G.ui.getBadge?.('stickerbook') || 0, say: '스티커북. 모은 스티커를 봐요.' },
      eng && { id: 'today', emoji: '🔔', label: '오늘', color: '#ff9f43', badge: unread, say: '오늘. 출석 도장과 오늘의 놀이를 봐요.' },
      { id: 'avatar', emoji: '👕', label: '꾸미기', color: '#ff7eb6', say: '꾸미기. 내 옷을 바꿔요.' },
      { id: 'where', emoji: '🗺️', label: '어디 갈까', color: '#4fb3ff', say: '어디 갈까? 가고 싶은 곳을 골라요.' },
      comp && { id: 'ongi', emoji: '🏺', label: '옹이랑', color: '#36cfc0', say: '옹이랑 놀아요.' },
      { id: 'sound', emoji: '🔊', label: '소리', color: '#b48bff', say: '소리. 소리 크기를 바꿔요.' },
      { id: 'help', emoji: '❓', label: '도와줘요', color: '#6c8cff', say: '도와줘요. 노는 방법을 봐요.' },
      typeof G.easy?.rest === 'function' && { id: 'rest', emoji: '😴', label: '쉬기', color: '#8fd14f', say: '쉬기. 잠깐 눈을 쉬어요.' },
      { id: 'parents', emoji: '👨‍👩‍👧', label: '어른 메뉴', color: '#c9d3c6', lock: true, say: '어른 메뉴. 어른만 열 수 있어요.' },
      { id: 'logout', emoji: '👋', label: '그만 놀기', color: '#ff8a5c', lock: true, say: '그만 놀기. 어른과 함께 해요.' },
    ].filter(Boolean);
    const m = G.ui.modal.open({
      id: 'app-menu', title: '메뉴', icon: '☰', size: 'lg', className: 'kid-menu-modal', autofocus: false,
      say: '무엇을 할까요? 그림을 눌러요.',
      body: (body, mm) => {
        mm._kind = 'kid';
        const ava = h('span', { class: 'km-ava' });
        setPortraitBg(ava, Portrait.url, initialOf(p.nickname));
        const lv = Number(s.level) || 1;
        const head = h('div', { class: 'km-head' }, ava,
          h('div', { class: 'km-id' },
            h('b', { class: 'km-nick' }, String(p.nickname || '')),
            h('div', { class: 'km-stats' },
              h('span', { class: 'km-stat', 'aria-label': `레벨 ${lv}` }, h('span', { class: 'emoji', 'aria-hidden': 'true' }, '⭐'), String(lv)),
              h('span', { class: 'km-stat', 'aria-label': `코인 ${fmt(s.coin || 0)}` }, h('span', { class: 'emoji', 'aria-hidden': 'true' }, '🪙'), fmt(s.coin || 0)))));
        G.easy?.speakable?.(head, `${p.nickname || ''}. 레벨 ${lv}. 코인 ${s.coin || 0}개`);
        const grid = h('div', { class: 'easy-pick km-grid', role: 'menu', 'aria-label': '메뉴' });
        tiles.forEach((t, i) => grid.appendChild(kidTile(t, i)));
        body.append(head, grid);
        bindTileGrid(grid, '.km-tile');
        grid.addEventListener('click', (e) => {
          const b = e.target.closest('[data-km]');
          if (!b) return;
          const act = b.dataset.km;
          G.sfx('click');
          b.classList.add('is-chosen');
          mm.close();
          kidMenuAction(act);
        });
        setTimeout(() => { if (!touchUI() && !mm.closed) grid.querySelector('.km-tile')?.focus({ preventScroll: true }); }, 60);
      },
      onClose: () => G.ui.setActive('menu', false),
    });
    G.ui.setActive('menu', true);
    return m;
  }
  async function kidMenuAction(act) {
    const P = G.sys.progression;
    switch (act) {
      case 'resume': return say('계속 놀아요!', { priority: 1 });
      case 'stickerbook': if (P?.openHub) return P.openHub(); if (P?.openCollection) return P.openCollection(); return G.ui.triggerAction('stickerbook');
      case 'today': return G.sys.engagement?.open?.();
      case 'avatar': return openAvatar();
      case 'where': return G.ui.triggerAction('where');
      case 'ongi': return G.sys.companion?.openMenu?.();
      case 'sound': return openSettings();
      case 'help': return openHelp();
      case 'rest': return G.easy?.rest?.();
      case 'parents': if (await parentGate('parents', '어른 메뉴')) openMenu({ adult: true }); return null;
      case 'logout': return app.logout({ confirm: true });
      default: return null;
    }
  }

  function openAdultMenu() {
    const st = G.state, s = st.stats || {}, p = st.profile || {};
    const guest = auth.current?.kind === 'guest';
    const eng = G.sys.engagement && !G.sys.engagement._failed && typeof G.sys.engagement.open === 'function' ? G.sys.engagement : null;
    const unread = Number(eng?.unreadCount?.() ?? eng?.unread ?? 0) || 0;
    const tiles = [
      { act: 'resume', emoji: '▶️', label: '계속하기', desc: '게임으로 돌아가기', key: 'Esc', cls: 'tile-primary' },
      easyOn() && { act: 'kidmenu', emoji: '👶', label: '아이 메뉴', desc: '큰 그림 메뉴로 돌아가요', tint: '#ffd766' },
      eng && { act: 'engagement', emoji: '📅', label: '오늘의 체험', desc: '출석·오늘의 미션·알림함', badge: unread, tint: '#ffb26b' },
      { act: 'profile', emoji: '🙋', label: '내 정보', desc: '레벨·칭호·체험 기록', tint: '#9b8cff' },
      { act: 'collection', emoji: '📚', label: '도감·업적', desc: '모은 작물·발효식품·업적', key: 'C', tint: '#6fe0d2' },
      { act: 'avatar', emoji: '👕', label: '아바타 꾸미기', desc: '옷차림·헤어·닉네임', tint: '#ff9fc7' },
      G.sys.minimap?.openWorldMap && { act: 'map', emoji: '🗺️', label: '지도·빠른 이동', desc: '구역 안내와 순간 이동', key: 'M', tint: '#f4c54a' },
      { act: 'settings', emoji: '⚙️', label: '설정', desc: '소리·그래픽·조작·계정', tint: '#c9d3c6' },
      { act: 'help', emoji: '❓', label: '도움말', desc: '조작법·게임 방법·구역', key: 'H', tint: '#7fc4ff' },
      { act: 'save', emoji: '💾', label: '저장하기', desc: lastSavedText(), tint: '#86e3a8' },
      (devCenter() ? canDevCenter() : (canDashboard() || canDebug())) && { act: 'devcenter', emoji: '🛠️', label: '개발자·관리자 센터', desc: devCenter() ? '점검·통계·인수인계·디버그' : (isAdmin() ? '체험 통계·디버그 도구' : '내 체험 통계 (로컬)'), key: 'F9', tint: '#ff8f8f' },
      guest && !isServer() && { act: 'upgrade', emoji: '🌟', label: '계정 만들기', desc: '게스트 기록을 계정으로 옮겨요', tint: '#ffd766' },
      { act: 'logout', emoji: '👋', label: '로그아웃', desc: '저장하고 처음 화면으로', cls: 'tile-danger' },
    ].filter(Boolean);

    const m = G.ui.modal.open({
      id: 'app-menu', title: easyOn() ? '어른 메뉴' : '메뉴', icon: 'menu', size: 'md', className: 'app-menu-modal', autofocus: false,
      body: (body, mm) => {
        mm._kind = 'adult';
        const lv = Number(s.level) || 1;
        const head = h('div', { class: 'am-head' });
        const ava = h('div', { class: 'am-ava' });
        setPortraitBg(ava, Portrait.url, initialOf(p.nickname));
        const id = h('div', { class: 'am-id' });
        id.innerHTML = `
          <div class="am-row"><span class="lv-chip">Lv.${lv}</span><b class="am-nick"></b><span class="title-chip" hidden></span></div>
          <div class="am-row am-sub"><span>${ico('coin', 'ico-sm')}${fmt(s.coin || 0)}</span><span>${ico('book', 'ico-sm')}${fmt(s.edu || 0)}</span><span>⏱️ ${esc(U.formatDuration(s.playTime || 0))}</span></div>
          <div class="am-row am-chips"><span class="mode-chip${G.save.adapter?.name === 'server' ? ' server' : ''}">${G.save.adapter?.name === 'server' ? '서버 저장' : '로컬 저장'}</span>
            <span class="chip">${esc(kindLabel(auth.current?.kind))}</span>${isAdmin() ? '<span class="chip chip-gold">관리자</span>' : ''}</div>`;
        id.querySelector('.am-nick').textContent = p.nickname || '';
        if (p.title) { const tc = id.querySelector('.title-chip'); tc.textContent = p.title; tc.hidden = false; }
        head.append(ava, id);
        const grid = h('div', { class: 'am-grid', role: 'menu' });
        tiles.forEach((t, i) => {
          const b = h('button', { type: 'button', class: `am-tile ${t.cls || ''}`, 'data-mm': t.act, role: 'menuitem', style: t.tint ? { '--tint': t.tint } : null, tabindex: i === 0 ? '0' : '-1' },
            h('span', { class: 'am-ico emoji' }, t.emoji),
            h('span', { class: 'am-txt' }, h('b', null, t.label), h('small', null, t.desc)),
            t.key && !touchUI() ? h('kbd', null, t.key) : null,
            t.badge ? h('span', { class: 'badge' }, t.badge > 99 ? '99+' : String(t.badge)) : null);
          b.style.setProperty('--i', String(i));
          grid.appendChild(b);
        });
        const foot = h('p', { class: 'am-foot tiny muted' }, `전통발효체험관 메타버스 v${G.VERSION} · ${isServer() ? '서버 모드' : '로컬 모드'}`);
        body.append(head, grid, foot);
        G.ui.hydrateIcons(body);
        // roving focus: arrow keys move between tiles
        grid.addEventListener('keydown', (e) => {
          const items = Array.from(grid.querySelectorAll('.am-tile'));
          const i = items.indexOf(document.activeElement);
          if (i < 0) return;
          const cols = getComputedStyle(grid).gridTemplateColumns.split(' ').length || 2;
          const d = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: cols, ArrowUp: -cols, Home: -999, End: 999 }[e.key];
          if (d == null) return;
          e.preventDefault();
          const j = U.clamp(i + d, 0, items.length - 1);
          items[i].tabIndex = -1; items[j].tabIndex = 0; items[j].focus();
        });
        grid.addEventListener('click', async (e) => {
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
          m.close();
          menuAction(act);
        });
        setTimeout(() => { if (!touchUI() && !m.closed) grid.querySelector('.am-tile')?.focus(); }, 40);
      },
      onClose: () => G.ui.setActive('menu', false),
    });
    G.ui.setActive('menu', true);
    return m;
  }

  function menuAction(act) {
    const P = G.sys.progression;
    const missing = (what) => G.ui.toast(`${what} 기능을 불러오지 못했어요.`, { type: 'warn' });
    switch (act) {
      case 'resume': return;
      case 'kidmenu': openMenu(); return;
      case 'engagement': if (G.sys.engagement?.open) G.sys.engagement.open(); else missing('오늘의 체험'); return;
      case 'profile': if (P?.openProfile) P.openProfile(); else missing('내 정보'); return;
      case 'collection': if (P?.openCollection) P.openCollection(); else missing('도감'); return;
      case 'avatar': openAvatar(); return;
      case 'map': G.sys.minimap?.openWorldMap?.(); return;
      case 'settings': openSettings({ adult: true }); return;
      case 'help': openHelp(null, { full: true }); return;
      case 'devcenter': openDevCenter(); return;
      case 'upgrade': upgradeGuest(); return;
      case 'logout': app.logout({ confirm: true }); return;
      default:
    }
  }

  async function saveNow(reason = 'manual', notify = false) {
    if (!G.state || !G.save.profile) return false;
    await waitUntil(() => !G.save.saving, 4000);
    return G.save.save({ reason, notify });
  }

  /** guest -> account: save, log out, open the register form with "진행 상황 이어받기" checked */
  async function upgradeGuest() {
    if (auth.current?.kind !== 'guest' || isServer()) return;
    if (!(await parentGate('register', '계정 만들기'))) return;
    const ok = await G.ui.confirm('지금까지의 게스트 진행 상황을 저장한 뒤 회원가입 화면으로 이동해요.<br><span class="small dim">가입할 때 ‘진행 상황 이어받기’를 켜 두면 레벨·가방·농장·장독이 새 계정으로 옮겨져요.</span>', { title: '계정 만들기', icon: 'user', okText: '회원가입하러 가기', html: true });
    if (!ok) return;
    const from = auth.current?.id;
    const done = await app.logout({ confirm: false, quiet: true });
    if (done) Title.show('register', { transfer: true, parent: true, transferFrom: from });
  }

  // ================================================================ settings
  const SETTINGS_TABS = [
    { id: 'sound', label: '소리', icon: '🔊' }, { id: 'graphics', label: '그래픽', icon: '🖥️' }, { id: 'controls', label: '조작', icon: '🎮' },
    { id: 'game', label: '게임', icon: '🌿' }, { id: 'access', label: '접근성', icon: '♿' }, { id: 'kids', label: '아이 보호', icon: '👶' },
    { id: 'account', label: '계정', icon: '👤' }, { id: 'data', label: '데이터', icon: '💾' },
  ];
  /**
   * openSettings()                 easy mode: the 4 big kid controls (소리 · 음악 · 읽어주기 · 쉬운 모드) — no gate
   * openSettings(tab | {adult})    the full grown-up settings (parent gate first in easy mode)
   */
  function openSettings(tab, opts = {}) {
    if (tab && typeof tab === 'object') { opts = tab; tab = opts.tab; }
    if (typeof tab !== 'string' || !tab) tab = null;
    if (easyOn() && !opts.adult && (tab == null || tab === 'kid')) return openKidSettings();
    if (easyOn()) {
      return parentGate('settings', '어른 설정', '설정은 어른과 함께 바꿔요.').then((ok) => (ok ? openFullSettings(tab || 'kids') : null));
    }
    return openFullSettings(tab || 'sound');
  }
  function openFullSettings(tab = 'sound') {
    const ex = G.ui.modal.get('app-settings');
    if (ex) ex.close();
    const tabs = easyOn() ? [SETTINGS_TABS.find((t) => t.id === 'kids'), ...SETTINGS_TABS.filter((t) => t.id !== 'kids')] : SETTINGS_TABS;
    let current = SETTINGS_PANES[tab] ? tab : 'sound';
    const m = G.ui.modal.open({
      id: 'app-settings', title: easyOn() ? '어른 설정' : '설정', icon: 'settings', size: 'lg', className: 'app-settings-modal',
      body: (body, mm) => {
        // mm is the modal being built (the outer `m` is not initialised until open() returns)
        mm._kind = 'full';
        const tabsEl = h('div', { class: 'set-tabs', role: 'tablist', 'aria-label': '설정 분류' });
        const pane = h('div', { class: 'set-pane', role: 'tabpanel' });
        body.append(tabsEl, pane);
        const render = (id) => {
          current = id;
          mm._tab = id;
          pane.textContent = '';
          pane.dataset.tab = id;
          try { pane.appendChild(SETTINGS_PANES[id]()); } catch (e) { G.log.error('UI', 'settings pane failed', e); pane.textContent = '설정을 표시하지 못했어요.'; }
          G.ui.hydrateIcons(pane);
          pane.classList.remove('enter'); void pane.offsetWidth; pane.classList.add('enter');
          for (const b of tabsEl.querySelectorAll('.tab')) b.setAttribute('aria-selected', String(b.dataset.tab === id));
        };
        mm._renderPane = () => render(current);
        mm._tabs = G.ui.tabs(tabsEl, tabs, render, current);
        for (const b of tabsEl.querySelectorAll('.tab')) { b.setAttribute('role', 'tab'); b.setAttribute('aria-selected', String(b.dataset.tab === current)); }
      },
      actions: [
        {
          label: '이 탭 기본값으로', class: 'btn-ghost', icon: 'refresh', onClick: () => {
            const keys = SETTINGS_KEYS[current] || [];
            const D = G.settingsDefaults || {};
            // easy mode itself goes through G.easy.set (§12.1); the other kid keys reset to their safe defaults
            for (const k of keys) if (k in D && k !== 'easyMode') setSetting(k, D[k]);
            if (keys.includes('easyMode') && D.easyMode !== false) G.easy?.set?.(true);
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

  // ---------------------------------------------------------------- 쉬운 모드: 4 big kid controls
  let kidMusicPrev = 0;
  function openKidSettings() {
    const ex = G.ui.modal.get('app-settings');
    if (ex) ex.close();
    return G.ui.modal.open({
      id: 'app-settings', title: '소리와 설정', icon: '🔊', size: 'md', className: 'kid-settings-modal', autofocus: false,
      say: '소리를 바꿔요. 큰 버튼을 눌러요.',
      body: (body, mm) => {
        mm._kind = 'kid';
        mm._renderPane = () => renderKidSettings(body, mm);
        renderKidSettings(body, mm);
      },
      actions: [],
    });
  }
  function renderKidSettings(body, mm) {
    const S = G.settings;
    const focusKey = body.contains(document.activeElement) ? document.activeElement.dataset.ks || '' : '';
    body.textContent = '';
    const card = (cls, emoji, title, sayText, ...kids) => {
      const c = h('section', { class: `ks-card ${cls}`, 'data-say': sayText },
        h('div', { class: 'ks-title' }, h('span', { class: 'ks-emo emoji', 'aria-hidden': 'true' }, emoji), h('b', null, title)), ...kids);
      G.easy?.speakable?.(c, sayText);
      return c;
    };
    // 1) 🔊 volume: − ▮▮▮▯▯ + (0 = muted)
    const level = S.muted ? 0 : U.clamp(Math.round((Number(S.volumeMaster) || 0) * 5), 0, 5);
    const bars = h('div', { class: 'ks-bars', role: 'img', 'aria-label': level ? `소리 크기 다섯 칸 중 ${level}칸` : '소리 꺼짐' });
    for (let i = 1; i <= 5; i++) bars.appendChild(h('i', { class: i <= level ? 'on' : '' }));
    const minus = h('button', { type: 'button', class: 'easy-big-btn ks-step', 'data-ks': 'vol-', 'aria-label': '소리 작게', 'data-say': '작게', disabled: level === 0 || null }, h('span', { class: 'emoji', 'aria-hidden': 'true' }, '➖'));
    const plus = h('button', { type: 'button', class: 'easy-big-btn ks-step', 'data-ks': 'vol+', 'aria-label': '소리 크게', 'data-say': '크게', disabled: level === 5 || null }, h('span', { class: 'emoji', 'aria-hidden': 'true' }, '➕'));
    const volCard = card('ks-vol', level ? (level >= 4 ? '🔊' : level >= 2 ? '🔉' : '🔈') : '🔇', level ? '소리 크기' : '소리 꺼짐', '소리 크기. 빼기와 더하기를 눌러요.',
      h('div', { class: 'ks-vol-row' }, minus, bars, plus));
    // 2) 🎵 music on/off
    const musicOn = !S.muted && Number(S.volumeMusic) > 0.01;
    const music = h('button', { type: 'button', class: `easy-big-btn ks-toggle ${musicOn ? 'easy-btn-yes' : 'easy-btn-no'}`, 'data-ks': 'music', 'aria-pressed': musicOn ? 'true' : 'false', 'data-say': musicOn ? '음악 켜짐' : '음악 꺼짐' },
      h('span', { class: 'emoji', 'aria-hidden': 'true' }, musicOn ? '🎵' : '🔕'), musicOn ? '켜져 있어요' : '꺼져 있어요');
    const musicCard = card('ks-music', '🎵', '음악', '음악. 눌러서 켜고 꺼요.', music);
    // 3) 🗣️ read aloud
    const voiceOn = S.voiceGuide !== false;
    const voice = h('button', { type: 'button', class: `easy-big-btn ks-toggle ${voiceOn ? 'easy-btn-yes' : 'easy-btn-no'}`, 'data-ks': 'voice', 'aria-pressed': voiceOn ? 'true' : 'false', 'data-say': voiceOn ? '읽어주기 켜짐' : '읽어주기 꺼짐' },
      h('span', { class: 'emoji', 'aria-hidden': 'true' }, voiceOn ? '🗣️' : '🤐'), voiceOn ? '켜져 있어요' : '꺼져 있어요');
    const voiceCard = card('ks-voice', '🗣️', '읽어주기', '읽어주기. 글을 소리로 읽어 줘요.', voice);
    // 4) 👶 easy mode (turning it off asks a grown-up)
    const easyBtn = h('button', { type: 'button', class: 'easy-big-btn easy-btn-no ks-toggle', 'data-ks': 'easy', 'data-say': '쉬운 모드 끄기. 어른이 해요.' },
      h('span', { class: 'emoji', 'aria-hidden': 'true' }, '🔒'), '끄기 (어른)');
    const easyCard = card('ks-easy', '👶', '쉬운 모드', '쉬운 모드가 켜져 있어요. 끄려면 어른이 해요.', h('p', { class: 'ks-state' }, h('span', { class: 'emoji', 'aria-hidden': 'true' }, '✅'), '켜져 있어요'), easyBtn);
    const grid = h('div', { class: 'ks-grid' }, volCard, musicCard, voiceCard, easyCard);
    const adult = h('button', { type: 'button', class: 'ks-adult', 'data-ks': 'adult', 'data-say': '어른 설정. 어른만 열 수 있어요.' },
      h('span', { class: 'emoji', 'aria-hidden': 'true' }, '👨‍👩‍👧'), '어른 설정', h('span', { class: 'emoji', 'aria-hidden': 'true' }, '🔒'));
    body.append(grid, adult);
    if (!body._ksBound) {
      body._ksBound = true;
      body.addEventListener('click', (e) => {
        const b = e.target.closest('[data-ks]');
        if (!b || b.disabled) return;
        kidSettingAction(b.dataset.ks, body, mm);
      });
    }
    if (focusKey && !touchUI()) body.querySelector(`[data-ks="${focusKey}"]:not([disabled])`)?.focus({ preventScroll: true });
  }
  async function kidSettingAction(key, body, mm) {
    const S = G.settings;
    switch (key) {
      case 'vol-':
      case 'vol+': {
        const level = S.muted ? 0 : U.clamp(Math.round((Number(S.volumeMaster) || 0) * 5), 0, 5);
        const next = U.clamp(level + (key === 'vol+' ? 1 : -1), 0, 5);
        if (next === 0) { setSetting('muted', true); }
        else { if (S.muted) setSetting('muted', false); setSetting('volumeMaster', next / 5); setTimeout(() => G.sfx('coin'), 30); }
        break;
      }
      case 'music': {
        const on = !S.muted && Number(S.volumeMusic) > 0.01;
        if (on) { kidMusicPrev = Number(S.volumeMusic) || 0; setSetting('volumeMusic', 0); }
        else {
          if (S.muted) setSetting('muted', false);
          setSetting('volumeMusic', kidMusicPrev > 0.05 ? kidMusicPrev : Number(G.settingsDefaults?.volumeMusic) || 0.45);
          say('음악을 켰어요!', { force: true, priority: 1 });
        }
        G.sfx('click');
        break;
      }
      case 'voice': {
        const on = S.voiceGuide !== false;
        setSetting('voiceGuide', !on);
        if (!on) setTimeout(() => say('이제 읽어 줄게요!', { force: true, priority: 1 }), 60);
        else G.easy?.stop?.();
        G.sfx('click');
        break;
      }
      case 'easy': {
        // easy:changed swaps this screen for the grown-up settings; the fallback covers a missing 08-easy
        const ok = typeof G.easy?.set === 'function' ? await G.easy.set(false) : (G.setSetting('easyMode', false), true);
        if (ok && mm && !mm.closed) { mm.close(); openSettings('kids'); }
        return;
      }
      case 'adult': mm?.close?.(); openSettings({ adult: true }); return;
      default: return;
    }
    if (!mm?.closed) renderKidSettings(body, mm);
  }

  const SETTINGS_KEYS = {
    sound: ['volumeMaster', 'volumeMusic', 'volumeSfx', 'volumeAmbient', 'muted'],
    graphics: ['quality', 'shadows', 'bloom', 'fxLevel', 'showFps'],
    controls: ['sensitivity', 'invertY', 'clickToMove', 'cameraShake'],
    game: ['autoWeather', 'lockTime', 'minimapVisible', 'companion', 'chatVisible'],
    access: ['uiScale', 'highContrast', 'largeText', 'reduceMotion', 'voiceOver'],
    kids: ['easyMode', 'voiceGuide', 'voiceRate', 'playReminderMin', 'kidChat', 'parentGate'],
    account: [], data: [],
  };
  const KEY_TO_TAB = Object.fromEntries(Object.entries(SETTINGS_KEYS).flatMap(([t, ks]) => ks.map((k) => [k, t])));
  const sfxPreview = U.throttle(() => G.sfx('click'), 160);
  const note = (html) => h('p', { class: 'set-note', html });
  const SETTINGS_PANES = {
    sound() {
      const f = document.createDocumentFragment();
      f.append(
        settingRow('🔈 전체 볼륨', '게임의 모든 소리', sliderCtl('volumeMaster', { label: '전체 볼륨', after: sfxPreview })),
        settingRow('🎵 배경음악', '가야금 느낌의 잔잔한 음악', sliderCtl('volumeMusic', { label: '배경음악' })),
        settingRow('🔔 효과음', '버튼·물 주기·수확 소리', sliderCtl('volumeSfx', { label: '효과음', after: sfxPreview })),
        settingRow('🍃 환경음', '바람·새·풀벌레·계곡 물소리', sliderCtl('volumeAmbient', { label: '환경음' })),
        settingRow('🔇 음소거', '모든 소리를 끕니다', switchCtl('muted', { label: '음소거' })),
        note(`${ico('info', 'ico-sm')}브라우저 정책상 화면을 한 번 클릭하거나 키를 누른 뒤부터 소리가 나요.`),
      );
      return f;
    },
    graphics() {
      const E = G.sys.engine;
      const f = document.createDocumentFragment();
      const curLabel = E?.preset?.label || E?.quality || '-';
      const qNote = h('small', { class: 'set-inline-note' }, `현재 적용: ${curLabel}${G.flags.quality ? ' (주소 설정 고정)' : ''}`);
      f.append(
        settingRow('🖼️ 그래픽 품질', '자동은 기기 성능과 프레임에 맞춰 조절해요', h('div', { class: 'col' },
          segCtl('quality', [{ v: 'auto', l: '자동' }, { v: 'low', l: '낮음' }, { v: 'medium', l: '중간' }, { v: 'high', l: '높음' }], {
            label: '그래픽 품질', after: () => setTimeout(() => { qNote.textContent = `현재 적용: ${G.sys.engine?.preset?.label || '-'} · 나무·풀 밀도는 새로고침 후 반영돼요`; }, 60),
          }), qNote)),
        settingRow('✨ 효과 연출', '보상·수확 때 나오는 반짝이·꽃잎·폭죽 효과', segCtl('fxLevel', [{ v: 'off', l: '끔' }, { v: 'low', l: '은은하게' }, { v: 'high', l: '풍성하게' }], { label: '효과 연출' })),
        settingRow('🌗 그림자', '끄면 프레임이 좋아져요 (낮음 품질에서는 항상 꺼짐)', switchCtl('shadows', { label: '그림자' })),
        settingRow('🌟 빛 번짐 (블룸)', '등불·햇빛이 은은하게 번져요 (높음 품질에서 적용)', switchCtl('bloom', { label: '블룸' })),
        settingRow('📈 FPS 표시', '초당 프레임과 그리기 호출 수를 보여 줘요', switchCtl('showFps', { label: 'FPS 표시' })),
      );
      if (E?.renderer) {
        const info = E.renderer.info?.render;
        f.append(note(`${ico('chart', 'ico-sm')}현재 ${Math.round(E.fps || 0)} FPS · 그리기 호출 ${fmt(info?.calls || 0)}회 · 삼각형 ${fmt(Math.round((info?.triangles || 0) / 1000))}천 개`));
      }
      return f;
    },
    controls() {
      const f = document.createDocumentFragment();
      const keysBtn = h('button', { type: 'button', class: 'btn btn-sm btn-soft' }, '⌨️ 전체 조작법 보기');
      keysBtn.addEventListener('click', () => { G.ui.modal.get('app-settings')?.close(); openHelp('controls', { full: true }); });
      f.append(
        settingRow('🖱️ 시점 감도', '마우스·화면을 끌 때 시점이 도는 빠르기', sliderCtl('sensitivity', { min: 0.3, max: 2.5, step: 0.1, fmt: (v) => `${v.toFixed(1)}배`, label: '시점 감도' })),
        settingRow('↕️ Y축 반전', '위아래 시점 방향을 뒤집어요', switchCtl('invertY', { label: 'Y축 반전' })),
        settingRow('📍 클릭해서 이동', '땅을 클릭하면 그곳까지 걸어가요', switchCtl('clickToMove', { label: '클릭해서 이동' })),
        settingRow('📳 카메라 흔들림', '수확·효과 때 화면이 살짝 흔들려요', switchCtl('cameraShake', { label: '카메라 흔들림' })),
        settingRow('⌨️ 단축키', 'E 상호작용 · M 지도 · Q 퀘스트 · I 가방 · J 작업일지 · H 도움말', keysBtn),
      );
      return f;
    },
    game() {
      const f = document.createDocumentFragment();
      const hasCompanion = !!(G.sys.companion && !G.sys.companion._failed);
      f.append(
        settingRow('🌦️ 날씨 자동 변화', '맑음·흐림·비·안개가 시간에 따라 바뀌어요', switchCtl('autoWeather', { label: '날씨 자동 변화' })),
        settingRow('🕰️ 시간 고정', '지금 시각에서 하루가 흐르지 않게 멈춰요', switchCtl('lockTime', { label: '시간 고정' })),
        settingRow('🗺️ 미니맵 표시', '오른쪽 위 미니맵을 보여 줘요 (M 키로 큰 지도)', switchCtl('minimapVisible', { label: '미니맵 표시' })),
        settingRow('🏺 동반자 옹이', hasCompanion ? '장독 요정 옹이가 따라다니며 도와줘요' : '장독 요정 옹이가 따라다니며 도와줘요 (이 버전에서는 준비 중)', switchCtl('companion', { label: '동반자 옹이' })),
        settingRow('💬 채팅 창', '왼쪽 아래 채팅 창을 보여 줘요 (Enter 키로 입력)', switchCtl('chatVisible', { label: '채팅 창' })),
      );
      return f;
    },
    access() {
      const f = document.createDocumentFragment();
      const speakBtn = h('button', { type: 'button', class: 'btn btn-sm btn-soft' }, '🔉 들어보기');
      speakBtn.addEventListener('click', () => {
        const line = '안녕하세요! 전통발효체험관에 오신 것을 환영합니다.';
        if (G.sys.audio?.speak) G.sys.audio.speak(line);
        else if ('speechSynthesis' in window) { try { const u = new SpeechSynthesisUtterance(line); u.lang = 'ko-KR'; speechSynthesis.cancel(); speechSynthesis.speak(u); } catch (e) { /* ignore */ } }
        else G.ui.toast('이 브라우저는 음성 읽기를 지원하지 않아요.', { type: 'warn' });
      });
      f.append(
        settingRow('🔠 UI 크기', '글자와 창 크기를 조절해요 (85%~130%)', sliderCtl('uiScale', { min: 0.85, max: 1.3, step: 0.05, live: false, label: 'UI 크기' })),
        settingRow('🌓 고대비', '창 배경을 더 어둡고 선명하게 해요', switchCtl('highContrast', { label: '고대비' })),
        settingRow('🔍 큰 글자', '본문 글자를 크게 키워요', switchCtl('largeText', { label: '큰 글자' })),
        settingRow('🧘 움직임 줄이기', '화면 효과와 애니메이션을 줄여요', switchCtl('reduceMotion', { label: '움직임 줄이기' })),
        settingRow('🗣️ 음성 읽어주기', 'NPC 대사를 소리 내어 읽어 줘요 (자막은 항상 표시)', h('div', { class: 'row' }, speakBtn, switchCtl('voiceOver', { label: '음성 읽어주기' }))),
      );
      return f;
    },
    kids() {
      const f = document.createDocumentFragment();
      const hasEasy = typeof G.easy?.set === 'function';
      // 👶 easy mode: always through G.easy.set (turning it OFF asks the parent gate, §12.1)
      const easyInput = h('input', { type: 'checkbox', role: 'switch', 'aria-label': '쉬운 모드' });
      easyInput.checked = easyOn();
      easyInput.addEventListener('change', async () => {
        const want = easyInput.checked;
        easyInput.checked = !want; // stays as it was until the switch really happened
        easyInput.disabled = true;
        try {
          const ok = hasEasy ? await G.easy.set(want) : (G.setSetting('easyMode', want), true);
          if (ok) G.ui.toast(want ? '쉬운 모드를 켰어요.' : '일반 모드로 바꿨어요.', { type: 'info', emoji: want ? '👶' : '🧑', sound: false });
        } finally { easyInput.disabled = false; easyInput.checked = easyOn(); }
      });
      const easySw = h('label', { class: 'app-switch' }, easyInput, h('span', { class: 'sw-track', 'aria-hidden': 'true' }, h('span', { class: 'sw-thumb' })));
      // switches whose change needs a grown-up (kid chat, the parent gate itself)
      const guarded = (key, label, reason, confirmOff) => {
        const input = h('input', { type: 'checkbox', role: 'switch', 'aria-label': label });
        input.checked = settingVal(key) !== false;
        input.addEventListener('change', async () => {
          const want = input.checked;
          input.checked = !want;
          input.disabled = true;
          try {
            if (!(await parentGate(reason, label))) return;
            if (!want && confirmOff) {
              const ok = await askConfirm(confirmOff.kid, confirmOff.html, { title: label, okText: '끄기', danger: true });
              if (!ok) return;
            }
            setSetting(key, want);
            G.sfx('click');
          } finally { input.disabled = false; input.checked = settingVal(key) !== false; }
        });
        return h('label', { class: 'app-switch' }, input, h('span', { class: 'sw-track', 'aria-hidden': 'true' }, h('span', { class: 'sw-thumb' })));
      };
      const listen = h('button', { type: 'button', class: 'btn btn-sm btn-soft' }, '🔉 들어보기');
      listen.addEventListener('click', () => {
        if (G.settings.muted) { G.ui.toast('소리가 꺼져 있어요. 소리 탭에서 음소거를 꺼 주세요.', { type: 'info', emoji: '🔇' }); return; }
        say('안녕! 나는 옹이야. 이렇게 읽어 줄게요.', { force: true, priority: 2 });
      });
      const rateFmt = (v) => `${v < 0.85 ? '천천히' : v > 1.15 ? '빠르게' : '보통'} · ${v.toFixed(2)}배`;
      let st = null;
      try { st = G.easy?.gateStatus?.() || null; } catch (e) { st = null; }
      const lockBtn = h('button', { type: 'button', class: 'btn btn-sm btn-soft' }, '🔐 지금 잠그기');
      lockBtn.addEventListener('click', () => { G.easy?.lockGate?.(); G.ui.toast('보호자 확인을 다시 잠갔어요.', { type: 'success', emoji: '🔐', sound: false }); });
      f.append(
        note(`${ico('shield', 'ico-sm')}<span><b>쉬운 모드</b>는 5살 아이도 쓸 수 있게 그림·큰 버튼·소리로 안내해요. 어른용 화면(설정·로그아웃·초기화·개발자 센터 등)은 <b>보호자 확인</b>(곱셈 문제) 뒤에만 열려요.</span>`),
        settingRow('👶 쉬운 모드', '큰 그림 메뉴와 읽어주기 · 끄면 일반(어른) 화면이 돼요 · 이 프로필에만 저장돼요', easySw),
        settingRow('🗣️ 읽어주기', '쉬운 모드에서 안내와 버튼 이름을 소리로 읽어 줘요', h('div', { class: 'row' }, listen, switchCtl('voiceGuide', { label: '읽어주기' }))),
        settingRow('🐢 읽는 빠르기', '아이가 알아듣기 쉬운 빠르기로 맞춰요', sliderCtl('voiceRate', { min: 0.6, max: 1.4, step: 0.05, live: false, fmt: rateFmt, label: '읽는 빠르기', after: () => say('이 빠르기로 읽어 줄게요.', { force: true, priority: 2 }) })),
        settingRow('⏰ 놀이 시간 알림', '이만큼 신나게 놀면 쉬는 시간을 권해요 (쉬운 모드)', segCtl('playReminderMin', [{ v: 0, l: '끔' }, { v: 15, l: '15분' }, { v: 30, l: '30분' }, { v: 45, l: '45분' }, { v: 60, l: '60분' }], { label: '놀이 시간 알림' })),
        settingRow('💬 아이 채팅', '켜면 쉬운 모드에서 정해진 인사말과 이모지로만 이야기해요 (글자 입력 없음) · 이 프로필에만 저장돼요',
          guarded('kidChat', '아이 채팅', 'kid-chat', { kid: { emoji: '💬', heading: '아이 채팅', title: '글자 채팅을 열까요?', text: '아이가 직접 글을 써서 보낼 수 있어요.', yes: '열기', no: '그대로', danger: true }, html: '아이 채팅을 끄면 쉬운 모드에서도 <b>자유롭게 글을 써서</b> 채팅할 수 있어요. 끌까요?' })),
        settingRow('🔒 보호자 확인', '어른용 화면 앞에서 곱셈 문제를 내요 · 끄면 아이가 모든 화면을 열 수 있어요 · 이 프로필에만 저장돼요',
          guarded('parentGate', '보호자 확인', 'parent-gate', { kid: { emoji: '🔓', heading: '보호자 확인', title: '보호자 확인을 끌까요?', text: '아이가 설정과 로그아웃을 열 수 있어요.', yes: '끄기', no: '그대로', danger: true }, html: '보호자 확인을 끄면 아이가 <b>설정·로그아웃·초기화</b> 화면을 바로 열 수 있어요. 끌까요?' })),
        settingRow('🔐 보호자 확인 잠그기', st?.unlocked ? `지금 풀려 있어요 (약 ${Math.max(1, Math.ceil((st.unlockLeft || 0) / 60000))}분 남음) · 다 끝나면 잠가 주세요` : '한 번 풀면 5분 동안 열려 있어요', lockBtn),
      );
      if (!hasEasy) f.append(note(`${ico('info', 'ico-sm')}쉬운 모드 모듈을 불러오지 못해 일부 기능(읽어주기·보호자 확인)이 동작하지 않아요.`));
      return f;
    },
    account() { return AccountPane.build(); },
    data() {
      const f = document.createDocumentFragment();
      if (!G.state || !app.loggedIn) {
        f.append(h('div', { class: 'empty' }, h('span', { class: 'emoji big' }, '💾'), h('p', null, '로그인한 뒤에 저장 데이터를 관리할 수 있어요.')));
        return f;
      }
      const server = G.save.adapter?.name === 'server';
      let size = 0;
      if (!server) { const raw = store.raw(SAVE_KEY(G.save.profile?.id)); size = raw ? new Blob([raw]).size : 0; }
      const kv = h('dl', { class: 'kv set-kv' });
      const row = (k, v, cls) => { kv.append(h('dt', null, k), h('dd', cls ? { class: cls } : null, v)); };
      row('프로필', `${G.state.profile?.nickname || ''} · ${kindLabel(auth.current?.kind)}`);
      row('저장 위치', server ? '계정 서버 (자동 저장)' : '이 브라우저 (localStorage · 자동 저장)');
      row('마지막 저장', lastSavedText().replace('마지막 저장 ', ''), 'set-last');
      if (!server) row('저장 크기', bytesLabel(size));
      const saveBtn = h('button', { type: 'button', class: 'btn btn-primary' }, h('span', { class: 'ico ico-sm', 'data-icon': 'save' }), '지금 저장');
      saveBtn.addEventListener('click', async () => {
        saveBtn.disabled = true;
        await saveNow('manual', true);
        saveBtn.disabled = false;
        const d = kv.querySelector('.set-last'); if (d) d.textContent = lastSavedText().replace('마지막 저장 ', '');
      });
      const exportBtn = h('button', { type: 'button', class: 'btn btn-soft' }, h('span', { class: 'ico ico-sm', 'data-icon': 'download' }), '내보내기 (.json)');
      exportBtn.addEventListener('click', async () => {
        if (!(await parentGate('export', '저장 파일 내보내기')) || !G.state) return;
        try {
          const nick = String(G.state.profile?.nickname || 'player').replace(/[^\w가-힣-]+/g, '_').slice(0, 24);
          download(`전통발효체험관_저장_${nick}_${stamp()}.json`, G.save.exportJSON());
          G.ui.toast('저장 파일을 내려받았어요.', { type: 'success', icon: 'download' });
        } catch (e) { G.log.error('SAVE', 'export failed', e); G.ui.toast('저장 파일을 만들지 못했어요.', { type: 'error' }); }
      });
      const file = h('input', { type: 'file', accept: '.json,application/json', hidden: true });
      const importBtn = h('button', { type: 'button', class: 'btn btn-soft' }, h('span', { class: 'ico ico-sm', 'data-icon': 'upload' }), '가져오기');
      // the file picker must open inside the click: gate first only when it would actually be shown
      importBtn.addEventListener('click', async () => {
        if (gateWillShow()) { if (!(await parentGate('import', '저장 파일 가져오기'))) return; G.ui.toast('확인했어요. ‘가져오기’를 한 번 더 눌러 파일을 골라 주세요.', { type: 'info', emoji: '📥', sound: false }); return; }
        file.click();
      });
      file.addEventListener('change', async () => {
        const fl = file.files?.[0];
        file.value = '';
        if (!fl) return;
        if (fl.size > 5 * 1024 * 1024) { G.ui.toast('파일이 너무 커요. 5MB 이하의 저장 파일만 가져올 수 있어요.', { type: 'error' }); return; }
        if (!/\.json$/i.test(fl.name || '') && fl.type && !/json/.test(fl.type)) { G.ui.toast('.json 저장 파일만 가져올 수 있어요.', { type: 'error' }); return; }
        let text = '';
        try { text = await fl.text(); } catch (e) { G.ui.toast('파일을 읽지 못했어요.', { type: 'error' }); return; }
        let obj = null;
        try { obj = JSON.parse(text); } catch (e) { G.ui.toast('JSON 형식의 저장 파일이 아니에요.', { type: 'error' }); return; }
        if (!obj || typeof obj !== 'object' || obj.app !== 'tfm-metaverse' || !obj.state || typeof obj.state !== 'object' || Array.isArray(obj.state)) { G.ui.toast('전통발효체험관 저장 파일이 아니에요.', { type: 'error' }); return; }
        const st = obj.state;
        const when = typeof obj.exportedAt === 'string' ? Date.parse(obj.exportedAt) : 0;
        const nick = typeof st.profile?.nickname === 'string' ? st.profile.nickname.slice(0, 24) : '알 수 없음';
        const info = `${esc(nick)} · Lv.${U.clamp(Math.floor(Number(st.stats?.level) || 1), 1, 999)} · 코인 ${fmt(Math.max(0, Number(st.stats?.coin) || 0))}${when ? ` · ${U.formatDate(when, true)} 저장` : ''}`;
        const ok = await G.ui.confirm(`이 저장 파일로 지금의 진행 상황을 덮어쓸까요?<br><b>${info}</b><br><span class="small dim">닉네임과 계정 정보는 지금 계정 그대로 유지돼요.</span>`, { title: '저장 파일 가져오기', icon: 'upload', okText: '가져오기', danger: true, html: true });
        if (!ok || !G.state || !(await parentGate('import', '저장 파일 가져오기'))) return;
        try {
          await G.save.importJSON(text);
          // the save envelope carries device settings -> repair odd values and keep the account nickname
          sanitizeSettings();
          if (G.state?.profile && auth.current) G.state.profile.nickname = auth.current.nickname;
          G.ui.modal.get('app-settings')?.close();
          Portrait.schedule(400);
        } catch (e) { G.log.error('SAVE', 'import failed', e?.message || e); G.ui.toast(typeof e?.message === 'string' ? e.message.slice(0, 120) : '저장 파일을 가져오지 못했어요.', { type: 'error' }); }
      });
      const resetBtn = h('button', { type: 'button', class: 'btn btn-danger' }, h('span', { class: 'ico ico-sm', 'data-icon': 'trash' }), '진행 초기화');
      resetBtn.addEventListener('click', async () => {
        if (!(await parentGate('reset', '진행 초기화'))) return;
        const ok = await G.ui.confirm('레벨·코인·가방·퀘스트·농장·장독·작업일지·사진 등 <b>모든 진행 상황</b>이 지워지고 처음부터 다시 시작해요.<br>이 작업은 되돌릴 수 없어요. 정말 초기화할까요?', { title: '진행 초기화', icon: 'trash', okText: '모두 지우고 초기화', danger: true, html: true });
        if (!ok || !G.state) return;
        G.ui.modal.closeAll();
        try {
          await G.save.resetProgress();
          G.ui.toast('진행 상황을 초기화했어요. 처음부터 다시 시작해요!', { type: 'success', emoji: '🌱' });
          Portrait.schedule(400);
        } catch (e) { G.log.error('SAVE', 'reset failed', e); G.ui.toast('초기화하지 못했어요.', { type: 'error' }); }
      });
      f.append(
        h('div', { class: 'card set-card' }, kv),
        settingRow('💾 지금 저장', '자동 저장은 변경 후 몇 초 안에, 그리고 30초마다 이루어져요', saveBtn),
        settingRow('📤 저장 파일 내보내기', '진행 상황을 파일로 내려받아 백업하거나 다른 기기로 옮겨요', exportBtn),
        settingRow('📥 저장 파일 가져오기', '내보낸 .json 파일로 진행 상황을 되살려요', h('div', null, importBtn, file)),
        settingRow('🧹 진행 초기화', '모든 기록을 지우고 처음부터 시작해요', resetBtn, 'danger-row'),
      );
      return f;
    },
  };

  // ---------------------------------------------------------------- 계정 tab: info, password change, delete account
  const AccountPane = {
    build() {
      const f = document.createDocumentFragment();
      const cur = auth.current;
      if (!cur || !G.state || !app.loggedIn) {
        f.append(h('div', { class: 'empty' }, h('span', { class: 'emoji big' }, '👤'), h('p', null, '로그인한 뒤에 계정을 관리할 수 있어요.')));
        return f;
      }
      const acc = cur.kind === 'local' ? Accounts.byId(cur.id) : null;
      const card = h('div', { class: 'card set-card acc-card' });
      const ava = h('div', { class: 'acc-ava' });
      setPortraitBg(ava, Portrait.url, initialOf(cur.nickname));
      const kv = h('dl', { class: 'kv set-kv' });
      const row = (k, v) => kv.append(h('dt', null, k), h('dd', null, v));
      row('닉네임', G.state.profile?.nickname || cur.nickname);
      row('계정 종류', `${kindLabel(cur.kind)}${cur.role === 'admin' ? ' · 관리자' : ''}`);
      if (cur.email) row('이메일', maskEmail(cur.email));
      if (acc) {
        row('가입일', U.formatDate(acc.createdAt || now()));
        row('비밀번호 보호', acc.algo === ALGO ? `PBKDF2-SHA256 · ${fmt(acc.iter)}회 반복 · 개별 솔트` : '이전 방식 (다음 로그인 때 자동 강화)');
      }
      card.append(ava, kv);
      f.append(card);
      const nickBtn = h('button', { type: 'button', class: 'btn btn-soft btn-sm' }, '🏷️ 닉네임·아바타 바꾸기');
      nickBtn.addEventListener('click', () => { G.ui.modal.get('app-settings')?.close(); openAvatar(); });
      f.append(settingRow('🏷️ 닉네임', cur.kind === 'server' ? '서버 계정의 닉네임은 바꿀 수 없어요' : '아바타 꾸미기 창에서 바꿀 수 있어요', nickBtn));
      if (cur.kind === 'guest') {
        if (!isServer()) {
          const up = h('button', { type: 'button', class: 'btn btn-gold btn-sm' }, '🌟 계정 만들기');
          up.addEventListener('click', () => { G.ui.modal.get('app-settings')?.close(); upgradeGuest(); });
          f.append(settingRow('🌟 계정으로 저장하기', '게스트 기록을 계정으로 옮기면 비밀번호로 안전하게 이어할 수 있어요', up));
        }
        f.append(note('🔒 게스트 기록은 이 브라우저에만 저장돼요. 공용 기기라면 계정을 만들거나 다 쓴 뒤 ‘진행 초기화’를 해 주세요.'));
      }
      if (cur.kind === 'local') {
        f.append(this._pwForm(acc));
        const del = h('button', { type: 'button', class: 'btn btn-danger btn-sm' }, h('span', { class: 'ico ico-sm', 'data-icon': 'trash' }), '계정 삭제');
        del.addEventListener('click', async () => { if (await parentGate('delete-account', '계정 삭제')) this._deleteDialog(); });
        f.append(settingRow('🗑️ 계정 삭제', '이 브라우저에서 계정과 모든 진행 상황을 영구히 지워요', del, 'danger-row'));
      }
      if (cur.kind === 'server') f.append(note(`${ico('shield', 'ico-sm')}서버 계정의 비밀번호 변경·탈퇴는 체험관 관리자에게 문의해 주세요.`));
      const out = h('button', { type: 'button', class: 'btn btn-soft btn-sm' }, h('span', { class: 'ico ico-sm', 'data-icon': 'logout' }), '로그아웃');
      out.addEventListener('click', () => { G.ui.modal.get('app-settings')?.close(); app.logout({ confirm: true }); });
      f.append(settingRow('👋 로그아웃', '저장하고 처음 화면으로 돌아가요', out));
      return f;
    },
    _pwForm(acc) {
      const form = h('form', { class: 'acc-pw card', novalidate: true, autocomplete: 'off' });
      form.innerHTML = `<h4>🔑 비밀번호 바꾸기</h4>
        <div class="field" data-f="current"><label for="acc-pw-cur">지금 비밀번호</label><input id="acc-pw-cur" type="password" name="current" autocomplete="current-password" maxlength="64"><div class="error" role="alert"></div></div>
        <div class="field" data-f="next"><label for="acc-pw-new">새 비밀번호 <small class="muted">영문·숫자 포함 8자 이상</small></label><input id="acc-pw-new" type="password" name="next" autocomplete="new-password" maxlength="64"><div class="error" role="alert"></div></div>
        <div class="field" data-f="again"><label for="acc-pw-again">새 비밀번호 확인</label><input id="acc-pw-again" type="password" name="again" autocomplete="new-password" maxlength="64"><div class="error" role="alert"></div></div>
        <div class="form-error" role="alert" hidden></div>
        <button type="submit" class="btn btn-primary btn-sm">비밀번호 바꾸기</button>`;
      const setErr = (field, msg) => {
        for (const fl of form.querySelectorAll('[data-f]')) {
          const on = fl.dataset.f === field && !!msg;
          fl.classList.toggle('invalid', on);
          fl.querySelector('.error').textContent = on ? msg : '';
          fl.querySelector('input').toggleAttribute('aria-invalid', on);
        }
        const fe = form.querySelector('.form-error');
        fe.hidden = !(msg && !field); fe.textContent = msg && !field ? msg : '';
      };
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = form.querySelector('[type=submit]');
        if (btn.disabled) return;
        btn.disabled = true;
        const v = (n) => form.querySelector(`[name=${n}]`).value;
        try {
          const r = await auth.changePassword(v('current'), v('next'), v('again'));
          if (r.msg) {
            setErr(r.field, r.msg);
            G.sfx('error');
            if (r.field === 'current') form.querySelector('[name=current]').value = ''; // never keep a rejected password around
            form.querySelector(`[name=${r.field || 'current'}]`)?.focus();
            return;
          }
          setErr(null, '');
          form.reset();
          G.ui.toast('비밀번호를 바꿨어요. 다음 로그인부터 새 비밀번호를 써 주세요.', { type: 'success', emoji: '🔐' });
        } finally { btn.disabled = false; }
      });
      return form;
    },
    _deleteDialog() {
      const cur = auth.current;
      if (!cur || cur.kind !== 'local') return;
      const m = G.ui.modal.open({
        id: 'app-delete-account', title: '계정 삭제', icon: 'trash', size: 'sm', className: 'app-delete-modal',
        body: (body) => {
          body.innerHTML = `<p>계정 <b class="del-nick"></b>과(와) <b>모든 진행 상황</b>을 이 브라우저에서 영구히 지워요. 되돌릴 수 없어요.</p>
            <p class="small dim">필요하면 먼저 설정 → 데이터에서 저장 파일을 내보내 두세요.</p>
            <div class="field"><label for="del-pw">확인을 위해 비밀번호를 입력해 주세요</label><input id="del-pw" class="input" type="password" autocomplete="current-password" maxlength="64"><div class="error" role="alert"></div></div>`;
          body.querySelector('.del-nick').textContent = cur.nickname;
        },
        actions: [
          { label: '취소', class: 'btn-ghost' },
          {
            label: '영구 삭제', class: 'btn-danger', onClick: async (mm, btn) => {
              const input = mm.body.querySelector('#del-pw');
              const errBox = mm.body.querySelector('.error');
              btn.disabled = true;
              try {
                const msg = await app.deleteAccount(input.value);
                if (msg) { errBox.textContent = msg; input.value = ''; input.focus(); G.sfx('error'); return false; }
                return true;
              } finally { btn.disabled = false; }
            },
          },
        ],
      });
      return m;
    },
  };

  // ================================================================ help / credits / terms
  const HELP_KB = [
    [['W', 'A', 'S', 'D'], '이동 (방향키도 돼요)'], [['Shift'], '누른 채 이동하면 달리기'], [['Space'], '점프'],
    [['E'], '상호작용 — 대화·물 주기·수확·장독 확인·안내판'], [['M'], '전체 지도 · 빠른 이동'], [['Q'], '퀘스트 목록 (L도 가능)'],
    [['I'], '가방'], [['C'], '도감·업적'], [['J'], '작업일지'], [['P'], '사진 모드 (Space·Enter 촬영, H 화면 정리)'], [['Enter'], '채팅 입력'],
    [['T'], '이모지 (열린 뒤 1~9로 바로 선택)'], [['G'], '제스처 (열린 뒤 1~9로 바로 선택)'], [['H'], '도움말'], [['Esc'], '메뉴 열기 · 창 닫기'],
    [['N'], '오늘의 체험 — 출석·미션·알림함·수료증·랭킹·마당 꾸미기'], [['O'], '옹이와 놀기 (동반자 메뉴)'],
    [['F9'], '개발자·관리자 센터 (권한이 있을 때)'],
  ];
  const HELP_DIALOG = [[['Space', 'Enter'], '대사 넘기기'], [['1', '2', '3', '4'], '선택지 고르기'], [['↑', '↓'], '선택지 이동'], [['Esc'], '대화 닫기']];
  const HELP_MOUSE = [
    ['🖱️', '왼쪽 버튼 끌기', '시점 돌리기'], ['🖲️', '휠 굴리기', '확대 · 축소'], ['📍', '땅 클릭', '그곳까지 걸어가기 (설정에서 끌 수 있어요)'],
    ['✨', '사물·NPC 클릭', '가까이 걸어가서 상호작용'], ['🎮', '오른쪽 아래 방향 패드', '버튼으로 이동 · 가운데 버튼은 상호작용'],
  ];
  const HELP_TOUCH = [
    ['🕹️', '왼쪽 조이스틱', '이동 (끝까지 밀면 달리기)'], ['👆', '화면 끌기', '시점 돌리기'], ['🤏', '두 손가락 벌리기·오므리기', '확대 · 축소'],
    ['🟡', 'E 버튼', '상호작용'], ['⬆️', '점프 · 달리기 · 사진 버튼', '오른쪽 아래 버튼 묶음'], ['💬', '채팅 · 퀘스트 버튼', '작은 화면에서 패널 열고 닫기'],
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

  /** kid help: one picture + one short sentence per card, tap = read aloud (§12.0) */
  function kidHelpCards() {
    const touch = touchUI();
    return [
      { e: '👆', t: '땅을 누르면 걸어가요', c: '#55d187' },
      touch ? { e: '🕹️', t: '동그라미를 밀면 걸어요', c: '#4fb3ff' } : { e: '⬆️', t: '화살표 키로도 걸어요', c: '#4fb3ff' },
      { e: '✋', t: '화면을 끌면 둘러봐요', c: '#b48bff' },
      { e: '👉', t: '같이 가기를 누르면 데려다줘요', c: '#ffc93c' },
      { e: '💬', t: '친구를 누르면 이야기해요', c: '#ff7eb6' },
      { e: '🌱', t: '빈 밭을 눌러 씨앗을 심어요', c: '#8fd14f' },
      { e: '💧', t: '밭을 눌러 물을 줘요', c: '#36cfc0' },
      { e: '🧺', t: '다 자라면 눌러서 거둬요', c: '#ff9f43' },
      { e: '🏺', t: '장독을 눌러 살펴봐요', c: '#ff8a5c' },
      { e: '📖', t: '반짝이는 판을 누르면 배워요', c: '#6c8cff' },
      { e: '📸', t: '사진 버튼으로 찰칵 찍어요', c: '#f4a7ff' },
      { e: '📝', t: '일기 버튼으로 오늘을 남겨요', c: '#ffd166' },
      { e: '😊', t: '표현하기로 기분을 보여 줘요', c: '#ffc93c' },
      { e: '🎁', t: '다 하면 선물을 받아요', c: '#55d187' },
      { e: '⬅️', t: '닫기를 누르면 돌아가요', c: '#c9d3c6' },
      { e: '😴', t: '힘들면 메뉴에서 쉬어요', c: '#8fd14f' },
    ];
  }
  function openKidHelp() {
    return G.ui.modal.open({
      id: 'app-help', title: '도와줘요', icon: '❓', size: 'lg', className: 'kid-help-modal', autofocus: false,
      say: '이렇게 놀아요. 그림을 누르면 읽어 줘요.',
      body: (body, mm) => {
        mm._kind = 'kid';
        const grid = h('div', { class: 'kid-help-grid', role: 'list' });
        kidHelpCards().forEach((c, i) => {
          const b = h('button', { type: 'button', class: 'kh-card', role: 'listitem', 'data-say': c.t, 'aria-label': c.t },
            h('span', { class: 'kh-emo emoji', 'aria-hidden': 'true' }, c.e), h('span', { class: 'kh-text' }, c.t));
          b.style.setProperty('--tile', c.c);
          b.style.setProperty('--i', String(i));
          b.tabIndex = i === 0 ? 0 : -1;
          grid.appendChild(b);
        });
        bindTileGrid(grid, '.kh-card');
        grid.addEventListener('click', (e) => {
          const b = e.target.closest('.kh-card');
          if (!b) return;
          G.sfx('pop');
          b.classList.remove('reading'); void b.offsetWidth; b.classList.add('reading');
          say(b.dataset.say, { force: true, priority: 1 });
        });
        const full = h('button', { type: 'button', class: 'easy-big-btn easy-btn-no kh-full', 'data-say': '어른용 도움말' }, h('span', { class: 'emoji', 'aria-hidden': 'true' }, '📚'), h('span', null, '어른용 도움말'));
        full.addEventListener('click', () => { mm.close(); openHelp(null, { full: true }); });
        body.append(grid, h('div', { class: 'kh-foot' }, full));
        setTimeout(() => { if (!touchUI() && !mm.closed) grid.querySelector('.kh-card')?.focus({ preventScroll: true }); }, 60);
      },
      actions: [],
    });
  }

  /** help: picture cards in easy mode, the full tabbed help for grown-ups (opts.full) */
  function openHelp(tab, opts = {}) {
    if (tab && typeof tab === 'object') { opts = tab; tab = opts.tab; }
    if (typeof tab !== 'string' || !tab) tab = 'controls';
    const ex = G.ui.modal.get('app-help');
    if (ex) { ex.close(); return null; }
    if (easyOn() && !opts.full) return openKidHelp();
    return G.ui.modal.open({
      id: 'app-help', title: '도움말', icon: 'help', size: 'lg', className: 'app-help-modal',
      body: (body, mm) => {
        mm._kind = 'full';
        const tabsEl = h('div');
        const pane = h('div', { class: 'help-pane' });
        body.append(tabsEl, pane);
        G.ui.tabs(tabsEl, [
          { id: 'controls', label: '조작법', icon: '⌨️' }, { id: 'loop', label: '게임 방법', icon: '🌱' },
          { id: 'zones', label: '구역 안내', icon: '🗺️' }, { id: 'tips', label: '꿀팁', icon: '💡' }, { id: 'faq', label: '자주 묻는 질문', icon: '💬' },
        ], (id) => { pane.textContent = ''; pane.appendChild(HELP_PANES[id]()); G.ui.hydrateIcons(pane); pane.scrollTop = 0; body.scrollTop = 0; }, HELP_PANES[tab] ? tab : 'controls');
      },
      actions: [{ label: '닫기', class: 'btn-primary' }],
    });
  }
  const keyRows = (rows) => rows.map(([keys, d]) => `<div class="kt-row"><span class="kt-keys">${keys.map((k) => `<kbd>${esc(k)}</kbd>`).join('')}</span><span class="kt-desc">${esc(d)}</span></div>`).join('');
  const iconRows = (rows) => rows.map(([e, k, d]) => `<div class="kt-row"><span class="kt-keys"><span class="emoji">${e}</span>${esc(k)}</span><span class="kt-desc">${esc(d)}</span></div>`).join('');
  const HELP_PANES = {
    controls() {
      const touch = touchUI();
      const sec = (title, inner) => { const s = h('section', { class: 'help-sec' }); s.innerHTML = `<h3>${title}</h3><div class="keys-table">${inner}</div>`; return s; };
      const kb = sec('⌨️ 키보드', keyRows(HELP_KB));
      const dlg = sec('💬 대화 중', keyRows(HELP_DIALOG));
      const mouse = sec('🖱️ 마우스', iconRows(HELP_MOUSE));
      const tc = sec('📱 터치 (휴대폰·태블릿)', iconRows(HELP_TOUCH));
      const wrap = h('div', { class: `help-controls ${touch ? 'touch-first' : ''}` });
      if (touch) wrap.append(tc, dlg, kb, mouse); else wrap.append(kb, mouse, dlg, tc);
      return wrap;
    },
    loop() {
      const wrap = h('div', { class: 'help-loop' });
      wrap.innerHTML = `<div class="help-hero"><div class="help-hero-mascot" aria-hidden="true">${mascotSvg('cheer', 72)}</div><p><b>농사로 재료를 키우고, 전통 방식으로 발효시키고, 배우고 기록하는 것</b>이 체험관의 기본 흐름이에요. 금빛 표식과 퀘스트 패널을 따라가면 하나씩 해 볼 수 있어요.</p></div>
        <ol class="loop-steps">${HELP_LOOP.map(([e, t, d], i) => `<li style="--i:${i}"><span class="ls-num">${i + 1}</span><span class="emoji ls-ico">${e}</span><div><b>${esc(t)}</b><small>${esc(d)}</small></div></li>`).join('')}</ol>
        <div class="notice-box">${esc(G.data.meta?.disclaimer || '')}</div>`;
      return wrap;
    },
    zones() {
      const wrap = h('div', { class: 'help-zones' });
      const canGo = app.loggedIn && !!G.sys.minimap?.travelTo;
      const visited = G.state?.visited || {};
      const colorOk = (c) => (typeof c === 'string' && /^#[0-9a-f]{3,8}$/i.test(c) ? c : '#9aa88f');
      wrap.innerHTML = `<p class="dim">체험관은 ${(G.data.zones || []).length}개 구역으로 나뉘어 있어요.${canGo ? ' ‘이동’을 누르면 그 구역으로 바로 갈 수 있어요.' : ''}</p>
        <div class="zone-grid">${(G.data.zones || []).map((z) => `<div class="zone-card" style="--zc:${colorOk(z.color)}">
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
    tips() {
      const wrap = h('div', { class: 'help-tips' });
      const tips = (G.data.tips || []).filter((t) => Array.isArray(t) && t.length >= 2);
      const EMO = { 상식: '📚', 팁: '💡', 농사: '🌱', 발효: '🏺', 조작: '🎮' };
      wrap.innerHTML = tips.length
        ? `<ul class="tip-list">${tips.map(([k, t]) => `<li><span class="tip-tag"><span class="emoji">${EMO[k] || '✨'}</span>${esc(k)}</span><span>${esc(t)}</span></li>`).join('')}</ul>`
        : '<div class="empty">표시할 꿀팁이 없어요.</div>';
      return wrap;
    },
    faq() {
      const server = isServer();
      const qa = [
        ['진행 상황은 어디에 저장되나요?', server ? '서버 모드에서는 계정 서버에 저장돼요. 게스트로 둘러볼 때는 이 브라우저에만 저장돼요.' : '로컬 모드에서는 이 브라우저(localStorage)에 자동으로 저장돼요. 무언가 바뀌면 몇 초 안에, 그리고 30초마다, 창을 닫을 때도 저장해요.'],
        ['다른 기기에서 이어서 할 수 있나요?', '메뉴 → 설정 → 데이터에서 저장 파일을 내보낸 뒤, 다른 기기에서 같은 메뉴의 ‘가져오기’로 불러오면 돼요.'],
        ['게스트로 하던 기록을 계정으로 옮길 수 있나요?', '네! 메뉴의 ‘계정 만들기’를 누르거나 회원가입할 때 ‘진행 상황 이어받기’를 켜면 돼요 (로컬 모드).'],
        ['비밀번호는 안전하게 보관되나요?', server ? '서버에서 강력한 해시로 변환해 보관하며 원문은 저장하지 않아요.' : '비밀번호 원문은 저장하지 않아요. 무작위 솔트와 함께 PBKDF2-SHA256(60만 회 반복)으로 변환한 값만 이 브라우저에 보관하고, 5번 틀리면 잠시 잠겨요.'],
        ['공용 컴퓨터에서 해도 되나요?', '로그인할 때 ‘로그인 상태 유지’를 끄고, 다 쓴 뒤에는 꼭 로그아웃해 주세요.'],
        ['브라우저 기록을 지우면 어떻게 되나요?', '로컬 모드의 계정과 진행 상황도 함께 지워져요. 중요한 기록은 저장 파일로 백업해 두세요.'],
        ['발효·재배 수치는 실제와 같나요?', G.data.meta?.disclaimer || '교육용 가상 시뮬레이션이에요.'],
        ['칭호는 자격증인가요?', G.data.meta?.titleDisclaimer || '게임 내 칭호예요.'],
        ['화면이 끊기거나 느려요.', '설정 → 그래픽에서 품질을 ‘낮음’으로 바꾸고 그림자·효과 연출을 꺼 보세요. 자동 품질은 프레임이 낮으면 스스로 품질을 낮춰요.'],
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
        <section><h4>📘 교육용 시뮬레이션 안내</h4><p>${esc(M.disclaimer || '')}</p><p>${esc(M.titleDisclaimer || '')}</p>
          <p>교육 콘텐츠는 널리 알려진 일반적인 내용을 짧게 정리한 것이며, 식품 제조·건강 정보로 활용하기 전에 전문 자료를 확인해 주세요.</p></section>
        <section><h4>📍 장소 정보</h4><p>${esc(M.address || '')}</p><p class="dim">${esc(M.addressNote || '')}</p></section>
        <section><h4>🔒 데이터 저장</h4><p>${isServer() ? '서버 모드: 계정(이메일·닉네임·암호화된 비밀번호)과 진행 상황이 체험관 서버에 저장돼요.' : '로컬 모드: 계정과 진행 상황이 이 브라우저(localStorage)에만 저장되며 외부로 전송되지 않아요.'}</p></section>
        <section><h4>🛠️ 만든 도구</h4><p>3D 그래픽: three.js r${esc(String(THREE.REVISION || ''))} (MIT License) · 글꼴: Pretendard (SIL Open Font License 1.1, 포함된 경우) · 모든 3D 모델·소리·아이콘은 코드로 직접 생성했어요.</p></section>
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
        <h4>2. 계정과 저장</h4><p>${server ? '이메일·닉네임·비밀번호(암호화하여 보관)와 게임 진행 데이터가 체험관 서버에 저장돼요. 비밀번호는 원문으로 보관하지 않아요.' : '로컬 모드의 계정과 진행 데이터는 이 브라우저에만 저장되고 외부로 전송되지 않아요. 비밀번호는 무작위 솔트와 함께 PBKDF2-SHA256으로 변환해 보관하며 원문은 저장하지 않아요. 브라우저 데이터를 지우면 계정도 함께 지워져요.'}</p>
        <h4>3. 개인정보</h4><p>이메일은 로그인 확인 용도로만 쓰여요. 닉네임은 다른 체험객에게 보일 수 있어요. 실명·연락처 등 불필요한 개인정보를 닉네임이나 채팅에 쓰지 마세요. 설정 → 계정에서 언제든 계정을 삭제할 수 있어요${server ? ' (서버 계정은 관리자에게 요청)' : ''}.</p>
        <h4>4. 이용 규칙</h4><p>욕설·비방·도배·광고는 금지돼요. 부적절한 채팅은 가려지며, 신고된 내용은 관리자가 확인할 수 있어요.</p>
        <h4>5. 칭호와 보상</h4><p>${esc(G.data.meta?.titleDisclaimer || '게임 내 칭호예요.')}</p></div>`,
      actions: [
        { label: '닫기', class: 'btn-ghost' },
        {
          label: '동의하고 닫기', class: 'btn-primary', onClick: () => {
            const cb = Title.el?.querySelector('[data-form=register] [name=agree]');
            if (cb && !cb.checked) { cb.checked = true; cb.dispatchEvent(new Event('input', { bubbles: true })); }
          },
        },
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
  const AV_ANIMS = [['wave', '👋', '인사'], ['celebrate', '🙌', '만세'], ['dance', '💃', '춤'], ['photo', '✌️', '브이'], ['heart', '💖', '하트'], ['bow', '🙇', '절']];
  /** 쉬운 모드: picture categories and an emoji for every style option (no reading needed) */
  const AV_KID_CATS = [
    { id: 'face', emoji: '😊', say: '얼굴', rows: [['face', 'chip'], ['skin', 'swatch']] },
    { id: 'hair', emoji: '💇', say: '머리', rows: [['hair', 'chip'], ['hairColor', 'swatch']] },
    { id: 'top', emoji: '👕', say: '윗옷', rows: [['top', 'chip'], ['topColor', 'swatch']] },
    { id: 'bottom', emoji: '👖', say: '바지와 신발', rows: [['bottom', 'chip'], ['bottomColor', 'swatch'], ['shoes', 'swatch']] },
    { id: 'bag', emoji: '🎒', say: '가방', rows: [['bag', 'chip'], ['bagColor', 'swatch', 'bag']] },
    { id: 'acc', emoji: '🎩', say: '모자와 안경', rows: [['accessory', 'chip'], ['accessoryColor', 'swatch', 'accessory']] },
    { id: 'height', emoji: '📏', say: '키', rows: [['height', 'height']] },
  ];
  const AV_KID_OPT = {
    face: { smile: '🙂', calm: '😌', cheer: '😄' },
    hair: { short: '👦', long: '👧', bun: '🍡', ponytail: '🎀', buzz: '🧑‍🦲', curly: '🌀' },
    top: { tshirt: '👕', hoodie: '🧥', shirt: '👔', hanbok: '👘', apron: '🧑‍🍳', jacket: '🥼' },
    bottom: { pants: '👖', shorts: '🩳', skirt: '👗' },
    bag: { none: '🚫', backpack: '🎒', basket: '🧺', pouch: '👝' },
    accessory: { none: '🚫', glasses: '👓', strawhat: '👒', headband: '🎀', cap: '🧢', beard: '🧔', gat: '🎩' },
  };
  const AV_KID_ROW = { face: '😊', skin: '🖐️', hair: '💇', hairColor: '🎨', top: '👕', topColor: '🎨', bottom: '👖', bottomColor: '🎨', shoes: '👟', bag: '🎒', bagColor: '🎨', accessory: '🎩', accessoryColor: '🎨', height: '📏' };
  const AV_KID_HEIGHT = [[0.9, '🐭', '아주 작게'], [0.95, '🐰', '작게'], [1, '🐻', '보통'], [1.05, '🦌', '크게'], [1.1, '🦒', '아주 크게']];
  const RX_HEX = /^#[0-9a-f]{6}$/i;
  const _avV = new THREE.Vector3();

  /** small separate WebGLRenderer turntable (disposed with the modal) */
  class AvatarPreview {
    constructor(host, appearance) {
      this.host = host;
      this.yaw = 0.42; this._drag = null; this._idle = 0; this._t = 0;
      this.view = 'full';
      this._camPos = new THREE.Vector3(0, 0.9, 4.2); this._camLook = new THREE.Vector3(0, 0.7, 0);
      this._tPos = new THREE.Vector3(); this._tLook = new THREE.Vector3();
      this._raf = 0; this._last = 0; this.disposed = false;
      const canvas = document.createElement('canvas');
      canvas.className = 'av-canvas';
      canvas.tabIndex = 0;
      canvas.setAttribute('role', 'img');
      canvas.setAttribute('aria-label', '아바타 미리보기 (끌거나 ← → 키로 돌리기)');
      host.appendChild(canvas);
      this.canvas = canvas;
      try {
        this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'low-power', preserveDrawingBuffer: false });
      } catch (e) {
        G.log.warn('UI', 'avatar preview renderer failed', e?.message || e);
        this._fallback();
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
      this._lights = [hemi, key, fill, rim];
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
    _fallback() {
      this.failed = true;
      this.canvas?.remove();
      this.canvas = null;
      const fb = h('div', { class: 'av-fallback' }, h('span', { class: 'emoji' }, '🧑‍🌾'),
        h('p', null, '이 기기에서는 3D 미리보기를 표시할 수 없어요.', h('br'), '저장하면 게임 속 캐릭터에 바로 적용돼요.'));
      this.host.appendChild(fb);
    }
    _bind() {
      const c = this.canvas;
      c.addEventListener('pointerdown', (e) => { this._drag = { id: e.pointerId, x: e.clientX }; try { c.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ } });
      c.addEventListener('pointermove', (e) => { const d = this._drag; if (!d || d.id !== e.pointerId) return; this.yaw += (e.clientX - d.x) * 0.012; d.x = e.clientX; this._idle = 0; });
      const up = (e) => { if (this._drag && this._drag.id === e.pointerId) this._drag = null; };
      c.addEventListener('pointerup', up);
      c.addEventListener('pointercancel', up);
      c.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); this.yaw += e.key === 'ArrowLeft' ? -0.35 : 0.35; this._idle = 0; }
        else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); this.setView(e.key === 'ArrowUp' ? 'face' : 'full'); }
      });
      c.addEventListener('wheel', (e) => { e.preventDefault(); this.setView(e.deltaY < 0 ? 'face' : 'full'); }, { passive: false });
      // WebGL context loss (GPU reset / too many contexts) -> static fallback instead of a black box
      c.addEventListener('webglcontextlost', (e) => { e.preventDefault(); G.log.warn('UI', 'avatar preview context lost'); this.dispose(); if (this.host?.isConnected) this._fallback(); });
      if (typeof ResizeObserver === 'function') { this._ro = new ResizeObserver(() => this._resize()); this._ro.observe(this.host); }
    }
    _resize() {
      if (!this.renderer) return;
      const w = Math.max(80, this.host.clientWidth), hh = Math.max(80, this.host.clientHeight);
      this.renderer.setSize(w, hh, false);
      this.camera.aspect = w / hh;
      this.camera.updateProjectionMatrix();
      if (this.view === 'face') this._frameCamera(false);
    }
    _frameCamera(snap) {
      const hs = Number(this.rig?.appearance?.height) || 1;
      let px, py, pz, lx, ly;
      if (this.view === 'face' && this.rig) {
        this.rig.group.updateMatrixWorld(true);
        this.rig.headAnchor.getWorldPosition(_avV);
        const hy = _avV.y - 0.34;
        // head-and-shoulders: back off on tall (portrait) stages so the head never gets cropped sideways
        const fit = Math.max(1, 0.9 / Math.max(0.35, this.camera.aspect || 1));
        px = 0; py = hy + 0.06; pz = 1.8 * fit; lx = 0; ly = hy - 0.04;
      } else { px = 0; py = 0.95 * hs; pz = 4.1; lx = 0; ly = 0.68 * hs; }
      this._tPos.set(px, py, pz); this._tLook.set(lx, ly, 0);
      if (snap) { this._camPos.copy(this._tPos); this._camLook.copy(this._tLook); }
    }
    setView(v) { if (this.view === v) return; this.view = v; this._frameCamera(false); this.onView?.(v); }
    setAppearance(app) { if (!this.rig) return; this.rig.setAppearance(app); this._frameCamera(false); }
    play(name) {
      if (!this.rig) return;
      const def = G.avatar.actions?.[name];
      const dur = def?.loop ? 4.2 : (def?.duration || 2.2);
      try { this.rig.setAnim(name, { loop: false, duration: dur, restart: true }); } catch (e) { /* unknown anim */ }
      this._idle = 0;
    }
    _loop(t) {
      if (this.disposed) return;
      this._raf = requestAnimationFrame(this._loop);
      if (document.hidden || !this.canvas?.isConnected) { this._last = t; return; }
      let dt = this._last ? (t - this._last) / 1000 : 0.016;
      this._last = t;
      if (!(dt > 0)) dt = 0.016;
      if (dt > 0.1) dt = 0.1;
      this._t += dt;
      this._idle += dt;
      if (!this._drag && this._idle > 2.5 && !reduceMotion()) this.yaw += U.angleDiff(this.yaw, 0.42 + Math.sin(this._t * 0.5) * 0.55) * Math.min(1, dt * 1.2);
      this.turn.rotation.y = this.yaw;
      if (this.rig) this.rig.update(dt, IDLE);
      if (this.view === 'face') this._frameCamera(false);
      const k = 1 - Math.exp(-6 * dt);
      this._camPos.lerp(this._tPos, k);
      this._camLook.lerp(this._tLook, k);
      this.camera.position.copy(this._camPos);
      this.camera.lookAt(this._camLook);
      try { this.renderer.render(this.scene, this.camera); } catch (e) { G.log.warn('UI', 'avatar preview render failed', e?.message || e); this.dispose(); }
    }
    dispose() {
      if (this.disposed) return;
      this.disposed = true;
      cancelAnimationFrame(this._raf);
      this._ro?.disconnect();
      try { this.rig?.dispose(); } catch (e) { /* ignore */ }
      for (const m of this._meshes || []) { m.geometry.dispose(); m.material.dispose(); }
      for (const t of this._own || []) t.dispose();
      for (const l of this._lights || []) l.dispose?.();
      try { this.renderer?.dispose(); this.renderer?.forceContextLoss?.(); } catch (e) { /* ignore */ }
      this.canvas?.remove();
      this.renderer = null; this.scene = null; this.rig = null; this._meshes = null; this._own = null; this._lights = null;
    }
  }

  const AvatarEditor = {
    m: null, preview: null, work: null, orig: null, kid: false, kidNick: null, kidCat: 'face',

    open() {
      if (!G.state || !app.loggedIn) return null;
      const ex = G.ui.modal.get('app-avatar');
      if (ex) { ex.close(); return null; }
      const A = G.avatar;
      this.orig = A ? A.normalize(G.state.profile?.avatar || A.defaultAppearance) : null;
      this.work = this.orig ? { ...this.orig } : null;
      const kid = easyOn() && !!A;
      this.kid = kid;
      this.kidNick = null;
      const m = G.ui.modal.open({
        id: 'app-avatar', title: kid ? '꾸미기' : '아바타 꾸미기', icon: kid ? '👕' : 'smile', size: 'xl', className: `avatar-modal${kid ? ' kid' : ''}`, backdropClose: false, autofocus: false,
        say: kid ? '마음에 드는 옷을 골라요!' : undefined,
        body: (body, mm) => { this.m = mm; mm._kind = kid ? 'kid' : 'full'; if (kid) this._buildKid(body); else this._build(body); },
        actions: A ? (kid ? [
          { label: '🎲 바꾸기', class: 'btn-soft av-random av-kid-btn', onClick: () => { this.randomize(); say('짜잔! 새 옷이에요!', { force: true }); return false; } },
          { label: '↩️ 처음대로', class: 'btn-ghost av-kid-btn', onClick: () => { this.set({ ...this.orig }); this.kidNick = null; this._syncKidNick(); return false; } },
          { label: '✅ 좋아요', class: 'btn-primary av-kid-btn av-kid-ok', onClick: () => this.save() },
        ] : [
          { label: '무작위', icon: 'refresh', class: 'btn-soft av-random', onClick: () => { this.randomize(); return false; } },
          { label: '처음대로', class: 'btn-ghost', onClick: () => { this.set({ ...this.orig }); return false; } },
          { label: '취소', class: 'btn-ghost' },
          { label: '저장하기', icon: 'check', class: 'btn-primary', onClick: () => this.save() },
        ]) : [{ label: '닫기', class: 'btn-primary' }],
        onClose: () => { this.preview?.dispose(); this.preview = null; this.m = null; this.work = null; this.kidNick = null; this._kidOpts = null; this._kidTabs = null; G.ui.setActive('avatar', false); },
      });
      this.m = m;
      G.ui.setActive('avatar', true);
      return m;
    },

    _build(body) {
      const A = G.avatar;
      if (!A) {
        body.appendChild(h('div', { class: 'notice-box' }, '아바타 꾸미기 기능을 불러오지 못했어요. 페이지를 새로고침한 뒤 다시 시도해 주세요.'));
        body.appendChild(this._nickSection());
        return;
      }
      const L = A.labels || {};
      const layout = h('div', { class: 'av-layout' });
      const stageCol = h('div', { class: 'av-stage-col' });
      const stage = h('div', { class: 'av-stage' });
      const viewSeg = h('div', { class: 'seg av-view', role: 'radiogroup', 'aria-label': '보기' },
        h('button', { type: 'button', 'data-view': 'full', class: 'active', role: 'radio', 'aria-checked': 'true' }, '🧍 전신'),
        h('button', { type: 'button', 'data-view': 'face', role: 'radio', 'aria-checked': 'false' }, '🙂 얼굴'));
      stage.appendChild(h('div', { class: 'av-stage-tools' }, viewSeg));
      const anims = h('div', { class: 'av-anims', role: 'group', 'aria-label': '동작 미리보기' },
        AV_ANIMS.map(([a, e, l]) => h('button', { type: 'button', class: 'av-anim', 'data-anim': a }, h('span', { class: 'emoji' }, e), l)));
      stageCol.append(stage, anims, h('p', { class: 'tiny muted av-tip' }, '미리보기를 끌어서 돌려 보세요. 휠을 올리면 얼굴을 크게 볼 수 있어요.'));
      const opts = h('div', { class: 'av-options' });
      for (const sec of AV_SECTIONS) {
        const s = h('section', { class: 'av-sec' }, h('h4', null, h('span', { class: 'emoji' }, sec.emoji), sec.title));
        for (const [k, type, dep] of sec.rows) {
          const row = h('div', { class: 'av-row', 'data-row': k, 'data-dep': dep || null }, h('span', { class: 'av-row-label' }, L.keys?.[k] || k));
          const box = h('div', { class: `av-opts ${type === 'swatch' ? 'swatches' : 'chips'}`, role: 'group', 'aria-label': L.keys?.[k] || k });
          if (type === 'swatch') {
            for (const c of A.options[k] || []) {
              if (!RX_HEX.test(c)) continue;
              const name = L.colors?.[c] || c;
              const b = h('button', { type: 'button', class: 'av-swatch', 'data-k': k, 'data-v': c, title: name, 'aria-label': name });
              b.style.setProperty('--c', c);
              box.appendChild(b);
            }
          } else if (type === 'chip') {
            for (const v of A.options[k] || []) box.appendChild(h('button', { type: 'button', class: 'av-chip', 'data-k': k, 'data-v': String(v) }, L[k]?.[v] || v));
          } else if (type === 'height') {
            const hr = A.heightRange || { min: 0.9, max: 1.1, step: 0.05 };
            for (let v = hr.min; v <= hr.max + 1e-6; v += hr.step) {
              const val = Math.round(v * 100) / 100;
              box.appendChild(h('button', { type: 'button', class: 'av-chip', 'data-k': 'height', 'data-v': String(val) }, L.height?.[val] || `${Math.round(val * 100)}%`));
            }
          }
          row.appendChild(box);
          s.appendChild(row);
        }
        opts.appendChild(s);
      }
      opts.appendChild(this._nickSection());
      layout.append(stageCol, opts);
      body.appendChild(layout);
      this.preview = new AvatarPreview(stage, this.work);
      this.preview.onView = (v) => { for (const b of viewSeg.querySelectorAll('[data-view]')) { const on = b.dataset.view === v; b.classList.toggle('active', on); b.setAttribute('aria-checked', String(on)); } };
      viewSeg.addEventListener('click', (e) => { const b = e.target.closest('[data-view]'); if (b) this.preview?.setView(b.dataset.view); });
      anims.addEventListener('click', (e) => { const b = e.target.closest('[data-anim]'); if (b) { this.preview?.play(b.dataset.anim); G.sfx('emote'); } });
      opts.addEventListener('click', (e) => {
        const b = e.target.closest('[data-k]');
        if (!b || b.disabled || !this.work) return;
        const k = b.dataset.k;
        const v = k === 'height' ? Number(b.dataset.v) : b.dataset.v;
        if (this.work[k] === v) return;
        this.work[k] = v;
        G.sfx('click');
        this._sync();
        this.preview?.setAppearance(this.work);
        if (k === 'face' || k === 'hair' || k === 'accessory' || k === 'hairColor' || k === 'skin') this.preview?.setView('face');
        else if (k === 'top' || k === 'bottom' || k === 'height' || k === 'bag' || k === 'shoes') this.preview?.setView('full');
      });
      this._bindNick(body);
      this._sync();
    },

    // ------------------------------------------------------------ 쉬운 모드 layout: big emoji chips & swatches, no reading
    _buildKid(body) {
      const layout = h('div', { class: 'av-layout av-kid' });
      const stageCol = h('div', { class: 'av-stage-col' });
      const stage = h('div', { class: 'av-stage' });
      const anims = h('div', { class: 'av-anims', role: 'group', 'aria-label': '동작 보기' },
        AV_ANIMS.filter(([a]) => a !== 'bow').map(([a, e, l]) => h('button', { type: 'button', class: 'av-anim av-anim-kid', 'data-anim': a, 'aria-label': l, 'data-say': l }, h('span', { class: 'emoji', 'aria-hidden': 'true' }, e))));
      stageCol.append(stage, anims);
      const right = h('div', { class: 'av-kid-right' });
      // 🏷️ name from kid-safe ideas (no typing); server accounts keep their name
      if (auth.current?.kind !== 'server') {
        right.appendChild(h('div', { class: 'av-kid-name' },
          h('span', { class: 'kid-label', 'aria-hidden': 'true' }, '🏷️'),
          h('span', { class: 'akn-text', 'data-say': '' }, G.state?.profile?.nickname || ''),
          h('button', { type: 'button', class: 'kn-dice', 'data-kidnick': '', 'aria-label': '다른 이름', 'data-say': '다른 이름' }, h('span', { class: 'emoji', 'aria-hidden': 'true' }, '🎲'), h('span', { class: 'kn-dice-lbl' }, '다른 이름'))));
      }
      const tabs = h('div', { class: 'av-kid-tabs', role: 'tablist', 'aria-label': '꾸밀 곳' });
      for (const c of AV_KID_CATS) {
        tabs.appendChild(h('button', { type: 'button', role: 'tab', class: 'av-kid-tab', 'data-cat': c.id, 'aria-label': c.say, 'data-say': c.say, 'aria-selected': 'false' }, h('span', { class: 'emoji', 'aria-hidden': 'true' }, c.emoji)));
      }
      const opts = h('div', { class: 'av-options av-kid-opts', role: 'tabpanel' });
      right.append(tabs, opts);
      layout.append(stageCol, right);
      body.appendChild(layout);
      this.preview = new AvatarPreview(stage, this.work);
      this._kidOpts = opts;
      this._kidTabs = tabs;
      this._renderKidCat(this.kidCat || 'face');
      tabs.addEventListener('click', (e) => {
        const b = e.target.closest('[data-cat]');
        if (!b) return;
        G.sfx('click');
        this._renderKidCat(b.dataset.cat);
        say(b.dataset.say, { force: true });
      });
      tabs.addEventListener('keydown', (e) => {
        const d = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
        if (!d) return;
        const ids = AV_KID_CATS.map((c) => c.id);
        const i = (ids.indexOf(this.kidCat) + d + ids.length) % ids.length;
        e.preventDefault();
        this._renderKidCat(ids[i]);
        tabs.querySelector(`[data-cat="${ids[i]}"]`)?.focus();
      });
      anims.addEventListener('click', (e) => { const b = e.target.closest('[data-anim]'); if (b) { this.preview?.play(b.dataset.anim); G.sfx('emote'); } });
      opts.addEventListener('click', (e) => {
        const b = e.target.closest('[data-k]');
        if (!b || b.disabled || !this.work) return;
        const k = b.dataset.k;
        const v = k === 'height' ? Number(b.dataset.v) : b.dataset.v;
        say(b.dataset.say || '', { force: true });
        if (this.work[k] === v) return;
        this.work[k] = v;
        G.sfx('pop');
        this._sync();
        this.preview?.setAppearance(this.work);
        if (k === 'face' || k === 'hair' || k === 'accessory' || k === 'hairColor' || k === 'skin' || k === 'accessoryColor') this.preview?.setView('face');
        else this.preview?.setView('full');
      });
      right.querySelector('[data-kidnick]')?.addEventListener('click', () => {
        const cur = this.kidNick || G.state?.profile?.nickname || '';
        const next = freeNameIdeas(6).find((n) => n !== cur);
        if (!next) return;
        this.kidNick = next;
        G.sfx('pop');
        this._syncKidNick(true);
        say(next, { force: true, priority: 1 });
      });
      this._syncKidNick();
    },
    _renderKidCat(id) {
      const A = G.avatar, L = A?.labels || {};
      const cat = AV_KID_CATS.find((c) => c.id === id) || AV_KID_CATS[0];
      this.kidCat = cat.id;
      for (const b of this._kidTabs?.querySelectorAll('[data-cat]') || []) {
        const on = b.dataset.cat === cat.id;
        b.classList.toggle('active', on);
        b.setAttribute('aria-selected', on ? 'true' : 'false');
        b.tabIndex = on ? 0 : -1;
      }
      const box = this._kidOpts;
      if (!box || !A) return;
      box.textContent = '';
      for (const [k, type, dep] of cat.rows) {
        const row = h('div', { class: 'av-row av-kid-row', 'data-row': k, 'data-dep': dep || null },
          h('span', { class: 'av-row-label emoji', 'aria-hidden': 'true' }, AV_KID_ROW[k] || '✨'));
        const list = h('div', { class: `av-opts ${type === 'swatch' ? 'swatches' : 'chips'}`, role: 'group', 'aria-label': L.keys?.[k] || k });
        if (type === 'swatch') {
          for (const c of A.options[k] || []) {
            if (!RX_HEX.test(c)) continue;
            const name = L.colors?.[c] || '색';
            const b = h('button', { type: 'button', class: 'av-swatch', 'data-k': k, 'data-v': c, 'aria-label': name, 'data-say': name });
            b.style.setProperty('--c', c);
            list.appendChild(b);
          }
        } else if (type === 'chip') {
          for (const v of A.options[k] || []) {
            const name = L[k]?.[v] || String(v);
            list.appendChild(h('button', { type: 'button', class: 'av-chip av-chip-kid', 'data-k': k, 'data-v': String(v), 'aria-label': name, 'data-say': name },
              h('span', { class: 'emoji', 'aria-hidden': 'true' }, AV_KID_OPT[k]?.[v] || '✨')));
          }
        } else if (type === 'height') {
          for (const [v, e, name] of AV_KID_HEIGHT) {
            list.appendChild(h('button', { type: 'button', class: 'av-chip av-chip-kid', 'data-k': 'height', 'data-v': String(v), 'aria-label': name, 'data-say': name }, h('span', { class: 'emoji', 'aria-hidden': 'true' }, e)));
          }
        }
        row.appendChild(list);
        box.appendChild(row);
      }
      box.classList.remove('enter'); void box.offsetWidth; box.classList.add('enter');
      this._sync();
    },
    _syncKidNick(roll) {
      const el = this.m?.body?.querySelector('.akn-text');
      if (!el) return;
      const n = this.kidNick || G.state?.profile?.nickname || '';
      el.textContent = n;
      el.dataset.say = `내 이름은 ${n}`;
      if (roll && !reduceMotion()) { el.classList.remove('roll'); void el.offsetWidth; el.classList.add('roll'); }
    },

    _nickSection() {
      const cur = auth.current;
      const server = cur?.kind === 'server';
      const input = h('input', { class: 'input', name: 'av-nick', type: 'text', maxlength: '24', 'aria-label': '닉네임', autocomplete: 'off', spellcheck: 'false', disabled: server || null });
      input.value = G.state?.profile?.nickname || '';
      return h('section', { class: 'av-sec av-nick' }, h('h4', null, h('span', { class: 'emoji' }, '🏷️'), '닉네임'),
        h('div', { class: 'av-nick-row' }, input, h('button', { type: 'button', class: 'btn btn-soft', 'data-nick': '', disabled: server || null }, '바꾸기')),
        h('small', { class: 'av-nick-msg muted', 'aria-live': 'polite' }, server ? '서버 계정의 닉네임은 이곳에서 바꿀 수 없어요.' : '2~12자 · 한글·영문·숫자·밑줄(_) · 다른 체험객에게 보여요.'));
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
      const v = normText(input.value);
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

    set(appearance) {
      if (!G.avatar) return;
      this.work = G.avatar.normalize(appearance);
      this._sync();
      this.preview?.setAppearance(this.work);
    },
    randomize() {
      if (!G.avatar) return;
      this.set(G.avatar.random());
      this.preview?.play('celebrate');
      G.sfx('pop');
    },
    save() {
      if (!G.state || !this.work || !G.avatar) return true;
      if (this.kid) {
        if (this.kidNick && this.kidNick !== G.state.profile?.nickname) {
          const err = auth.changeNickname(this.kidNick);
          if (err) { G.ui.toast(err, { type: 'error', easy: '이 이름은 쓸 수 없어요. 🎲를 다시 눌러요!' }); return false; }
        }
      } else if (!this._applyNick(this.m?.body, false)) return false; // keep the modal open on a bad nickname
      const appN = G.avatar.normalize(this.work);
      const changed = JSON.stringify(appN) !== JSON.stringify(this.orig);
      if (changed) {
        if (G.sys.player?.setAppearance) G.sys.player.setAppearance(appN);
        else { G.state.profile.avatar = { ...appN }; G.dirty('avatar'); G.bus.emit('player:appearance', { appearance: appN }); }
        if (this.kid && typeof G.easy?.celebrate === 'function') G.easy.celebrate('멋져요!', { emoji: '✨', say: '와, 정말 멋져요!', duration: 1800 });
        else G.ui.toast('새 모습을 저장했어요!', { type: 'success', emoji: '👕' });
        try { G.sys.player?.playAction?.('celebrate', { duration: 1.8 }); } catch (e) { /* cosmetic */ }
        try { G.fx?.burst?.(G.sys.player?.position, { type: 'sparkle', count: 24 }); } catch (e) { /* fx optional */ }
        Portrait.schedule(250);
      }
      return true;
    },
  };
  function openAvatar() { return AvatarEditor.open(); }

  // ================================================================ fallback debug panel (only while 80-devcenter.js is missing)
  const Debug = {
    el: null, open: false, _t: 0, _colliders: false,
    toggle() {
      if (!app.loggedIn) return false;
      if (!canDebug()) { G.ui.toast('디버그 도구는 관리자나 디버그 모드(?debug=1 · ?dev=1)에서만 쓸 수 있어요.', { type: 'info', sound: false }); return false; }
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
      if (this._colliders) { this._colliders = false; try { G.world.debugDraw?.(false); } catch (e) { /* ignore */ } }
    },
    _build() {
      const zones = (G.data.zones || []).map((z) => `<button type="button" data-dbg="tp" data-arg="${esc(z.id)}">${esc(z.short || z.name)}</button>`).join('');
      const weathers = Object.entries(G.data.weather || {}).map(([id, w]) => `<button type="button" data-dbg="weather" data-arg="${esc(id)}">${esc(w.name)}</button>`).join('');
      const el = h('aside', { class: 'app-debug glass', 'aria-label': '디버그 패널', hidden: true });
      el.innerHTML = `
        <header class="dbg-head"><span>${ico('bug', 'ico-sm')}디버그 패널 <small class="muted">(간이)</small></span><button type="button" class="icon-btn" data-dbg="close" aria-label="닫기">${ico('x', 'ico-sm')}</button></header>
        <div class="dbg-info"></div>
        <div class="dbg-body">
          <h5>💰 자원</h5><div class="dbg-grid">
            <button type="button" data-dbg="coin">+1,000 코인</button><button type="button" data-dbg="exp">+500 EXP</button><button type="button" data-dbg="edu">+50 교육</button>
            <button type="button" data-dbg="seeds">씨앗 모두 ×5</button><button type="button" data-dbg="ingredients">재료·작물 ×5</button><button type="button" data-dbg="save">즉시 저장</button></div>
          <h5>📜 퀘스트 · 튜토리얼</h5><div class="dbg-grid">
            <button type="button" data-dbg="objective">현재 목표 완료</button><button type="button" data-dbg="claimall">완료 보상 모두 받기</button><button type="button" data-dbg="tutorial">튜토리얼 다시</button></div>
          <h5>🌱 농장 · 발효</h5><div class="dbg-grid">
            <button type="button" data-dbg="grow">작물 100% 성장</button><button type="button" data-dbg="water">밭 물 100%</button><button type="button" data-dbg="ferment">내 장독 발효 완료</button>
            <button type="button" data-dbg="ff">발효 +1분</button></div>
          <h5>🌤️ 날씨 · 시간</h5><div class="dbg-grid">${weathers}</div>
          <div class="dbg-grid"><button type="button" data-dbg="hour" data-arg="6.5">아침 6:30</button><button type="button" data-dbg="hour" data-arg="12">낮 12:00</button><button type="button" data-dbg="hour" data-arg="18.5">저녁 18:30</button><button type="button" data-dbg="hour" data-arg="22">밤 22:00</button></div>
          <h5>📍 순간이동</h5><div class="dbg-grid">${zones}</div>
          <h5>🖥️ 표시 · 품질</h5><div class="dbg-grid">
            <button type="button" data-dbg="colliders" class="tog">충돌체 보기</button><button type="button" data-dbg="fps" class="tog">FPS 표시</button>
            <button type="button" data-dbg="quality" data-arg="low">품질 낮음</button><button type="button" data-dbg="quality" data-arg="medium">품질 중간</button><button type="button" data-dbg="quality" data-arg="high">품질 높음</button><button type="button" data-dbg="quality" data-arg="auto">품질 자동</button></div>
        </div>`;
      G.ui.hydrateIcons(el);
      const saved = store.get(KEYS.debugPos, null);
      if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) { el.style.left = `${U.clamp(saved.x, 0, innerWidth - 120)}px`; el.style.top = `${U.clamp(saved.y, 0, innerHeight - 60)}px`; el.style.right = 'auto'; }
      el.addEventListener('click', (e) => {
        const b = e.target.closest('[data-dbg]');
        if (!b) return;
        try { this.run(b.dataset.dbg, b.dataset.arg); } catch (err) { G.log.error('UI', 'debug command failed', err); G.ui.toast(`명령을 실행하지 못했어요: ${String(err?.message || err).slice(0, 80)}`, { type: 'error' }); }
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
      const zone = p ? G.world.zoneAt?.(p.x, p.z) : null;
      const info = E?.renderer?.info?.render;
      const W = G.sys.weather;
      const box = this.el.querySelector('.dbg-info');
      box.textContent = '';
      const items = [
        `📍 ${p ? `${p.x.toFixed(1)}, ${p.y.toFixed(2)}, ${p.z.toFixed(1)}` : '-'}`, `🗺️ ${zone?.name || '-'}`,
        `⚡ ${Math.round(E?.fps || 0)} FPS · ${E?.quality || '-'}`, `🎨 ${fmt(info?.calls || 0)} draw · ${fmt(Math.round((info?.triangles || 0) / 1000))}k tri`,
        `🌤️ ${W?.current || '-'} · ${typeof W?.timeString === 'function' ? W.timeString() : '-'}`, `👥 ${fmt(G.sys.social?.online || 1)}명 · ${G.save.adapter?.name || '-'}`,
      ];
      for (const t of items) box.appendChild(h('span', null, t));
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
      if (!st || !canDebug()) return warn('로그인한 관리자만 사용할 수 있어요.');
      switch (cmd) {
        case 'coin': if (P?.addCoin) P.addCoin(1000); else { st.stats.coin = (Number(st.stats.coin) || 0) + 1000; G.dirty('debug'); } return ok('코인 +1,000');
        case 'exp': if (P?.addExp) P.addExp(500); else { st.stats.exp = (Number(st.stats.exp) || 0) + 500; G.dirty('debug'); } return ok('EXP +500');
        case 'edu': if (P?.addEdu) P.addEdu(50); else { st.stats.edu = (Number(st.stats.edu) || 0) + 50; G.dirty('debug'); } return ok('교육 포인트 +50');
        case 'seeds':
        case 'ingredients': {
          const types = cmd === 'seeds' ? ['seed'] : ['ingredient', 'crop'];
          let n = 0;
          for (const [id, it] of Object.entries(G.data.items || {})) {
            if (!types.includes(it.type)) continue;
            if (I?.add) I.add(id, 5, { source: 'debug', silent: true }); else st.inventory[id] = (Number(st.inventory[id]) || 0) + 5;
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
        case 'grow': if (F?.growAll) { F.growAll(100); return ok('모든 작물을 다 키웠어요'); } return warn('농장 시스템이 없어요.');
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
        case 'quality': if (!SETTING_RULES.quality.includes(arg)) return null; G.setSetting('quality', arg); return ok(`그래픽 품질: ${({ low: '낮음', medium: '중간', high: '높음', auto: '자동' })[arg]}`);
        default: return null;
      }
    },
  };

  // ================================================================ fallback admin dashboard (only while 80-devcenter.js is missing)
  const QUEST_CAT = { main: '메인', farm: '농사', journal: '작업일지', explore: '탐험', ferment: '발효', edu: '교육', social: '소통' };
  const STATUS_KO = { locked: '잠김', available: '수락 가능', accepted: '진행 중', progress: '진행 중', completed: '보상 대기', claimed: '완료' };
  const colorOk = (c) => (typeof c === 'string' && /^#[0-9a-f]{3,8}$/i.test(c) ? c : '#9aa88f');
  const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
  function barRows(rows, opts = {}) {
    const max = opts.max ?? Math.max(1, ...rows.map((r) => num(r.value)));
    return `<div class="adm-bars">${rows.map((r) => {
      const pct = U.clamp((num(r.value) / max) * 100, 0, 100);
      return `<div class="adm-bar" title="${esc(r.tip || `${r.label}: ${r.text ?? r.value}`)}"><span class="ab-label">${esc(r.label)}</span><span class="ab-track"><i style="width:${pct.toFixed(1)}%"></i></span><span class="ab-val">${esc(String(r.text ?? r.value))}</span></div>`;
    }).join('')}</div>`;
  }
  /** value/sub are escaped here — callers pass plain text */
  function tile(label, value, sub, cls = '') {
    return `<div class="adm-tile ${esc(cls)}"><span class="at-label">${esc(label)}</span><b class="at-val">${esc(String(value))}</b>${sub ? `<small>${esc(String(sub))}</small>` : ''}</div>`;
  }

  function openAdmin(tab = 'overview') {
    if (!G.state || !app.loggedIn) return null;
    if (easyOn() && gateWillShow()) { parentGate('admin', '관리자 화면은 어른만').then((ok) => { if (ok && app.loggedIn) openAdmin(tab); }); return null; }
    if (!canDashboard()) { G.ui.toast('관리자 권한이 있는 계정만 볼 수 있어요.', { type: 'warn' }); return null; }
    const ex = G.ui.modal.get('app-admin');
    if (ex) ex.close();
    const tabs = [{ id: 'overview', label: '개요', icon: '📊' }, { id: 'quests', label: '퀘스트·구역', icon: '📜' }, { id: 'activity', label: '활동 기록', icon: '🕘' }];
    if (isAdmin() && !isServer()) tabs.push({ id: 'accounts', label: '로컬 계정', icon: '👥' });
    tabs.push({ id: 'server', label: '서버 통계', icon: '🛰️' });
    if (canDebug()) tabs.push({ id: 'tools', label: '디버그 도구', icon: '🛠️' });
    const head = h('span', { class: `chip ${isServer() ? 'chip-blue' : 'chip-green'}` }, isServer() ? '서버 모드' : '로컬 분석');
    return G.ui.modal.open({
      id: 'app-admin', title: '개발자·관리자 센터', icon: 'chart', size: 'xl', className: 'admin-modal', headExtra: head,
      body: (body) => {
        const tabsEl = h('div');
        const pane = h('div', { class: 'adm-pane' });
        body.append(tabsEl, pane);
        G.ui.tabs(tabsEl, tabs, (id) => {
          pane.textContent = '';
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
      const achT = Object.keys(G.data.achievements || {}).length, achN = Object.keys(st.achievements || {}).filter((k) => G.data.achievements?.[k]).length;
      const colT = Object.keys(G.data.collection || {}).length, colN = Object.keys(st.collection || {}).filter((k) => G.data.collection?.[k]).length;
      const eduT = Object.keys(G.data.education || {}).length, eduN = Object.keys(st.education?.completed || {}).filter((k) => G.data.education?.[k]).length;
      const qIds = Object.keys(G.data.quests || {});
      const qDone = qIds.filter((id) => st.quests?.[id]?.status === 'claimed').length;
      const quizRate = num(s.quizAnswered) ? Math.round((num(s.quizCorrect) / num(s.quizAnswered)) * 100) : 0;
      const d = num(s.distance);
      const dist = d >= 1000 ? `${(d / 1000).toFixed(2)}km` : `${fmt(Math.round(d))}m`;
      pane.innerHTML = `
        <p class="dim small">${isServer() ? '이 화면의 수치는 지금 로그인한 계정의 기록이에요. 전체 사용자 통계는 ‘서버 통계’ 탭에서 볼 수 있어요.' : '로컬 모드에서는 이 브라우저에 저장된 지금 프로필의 체험 기록을 분석해요.'}</p>
        <div class="adm-tiles hero">
          ${tile('레벨', `Lv.${fmt(num(s.level) || 1)}`, P?.expToNext ? `다음 레벨까지 ${fmt(P.expToNext())} EXP` : '')}
          ${tile('누적 경험치', fmt(num(s.expTotal) || num(s.exp)), 'EXP')}
          ${tile('코인', fmt(num(s.coin)), '보유 중')}
          ${tile('교육 포인트', fmt(num(s.edu)), `교육 완료 ${eduN}/${eduT}`)}
        </div>
        <div class="adm-tiles">
          ${tile('플레이 시간', U.formatDuration(num(s.playTime)))}${tile('접속 횟수', `${fmt(num(s.logins))}회`)}${tile('이동 거리', dist)}
          ${tile('퀘스트 완료', `${qDone}/${qIds.length}`)}${tile('방문 구역', `${zv}/${zones.length}`)}${tile('퀴즈 정답률', num(s.quizAnswered) ? `${quizRate}%` : '-', `${fmt(num(s.quizCorrect))}/${fmt(num(s.quizAnswered))}`)}
          ${tile('작업일지', `${fmt((st.journal || []).length)}편`)}${tile('사진', `${fmt((st.photos || []).length)}장`, `누적 촬영 ${fmt(num(s.photos))}장`)}${tile('업적', `${achN}/${achT}`)}${tile('도감', `${colN}/${colT}`)}
        </div>
        <h4 class="adm-h">체험 활동량</h4>
        ${barRows([
          { label: '물 주기', value: s.waters, text: `${fmt(num(s.waters))}회` }, { label: '씨앗 심기', value: s.plants, text: `${fmt(num(s.plants))}회` },
          { label: '수확', value: s.harvests, text: `${fmt(num(s.harvests))}회` }, { label: '장독 확인', value: s.fermentChecks, text: `${fmt(num(s.fermentChecks))}회` },
          { label: '발효 완성', value: s.fermentsClaimed, text: `${fmt(num(s.fermentsClaimed))}회` }, { label: '재료 만들기', value: s.crafts, text: `${fmt(num(s.crafts))}회` },
          { label: 'NPC 대화', value: s.talks, text: `${fmt(num(s.talks))}회` }, { label: '이모지·제스처', value: num(s.emotes) + num(s.gestures), text: `${fmt(num(s.emotes) + num(s.gestures))}회` },
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
      const chipCls = (s) => (s === 'claimed' ? 'chip-green' : s === 'completed' ? 'chip-gold' : s === 'locked' ? '' : 'chip-blue');
      pane.innerHTML = `
        <div class="adm-tiles">${['claimed', 'completed', 'progress', 'available', 'locked'].map((k) => tile(STATUS_KO[k], fmt(counts[k] || 0), '개', k === 'completed' && counts[k] ? 'warn' : '')).join('')}</div>
        <div class="adm-cols">
          <section><h4 class="adm-h">분야별 퀘스트 완료율</h4>${barRows(catRows, { max: 100 })}</section>
          <section><h4 class="adm-h">구역 방문 (${zones.filter((z) => st.visited?.[z.id]).length}/${zones.length})</h4>
            <ul class="adm-zones">${zones.map((z) => { const t = num(st.visited?.[z.id]); return `<li class="${t ? 'on' : ''}"><span class="zc-dot" style="--zc:${colorOk(z.color)}"></span><b>${esc(z.name)}</b><small>${t ? `첫 방문 ${esc(U.formatDate(t, true))}` : '아직 방문 전'}</small></li>`; }).join('')}</ul></section>
        </div>
        <h4 class="adm-h">퀘스트 목록</h4>
        <div class="adm-table-wrap"><table class="adm-table"><thead><tr><th>퀘스트</th><th>분야</th><th>상태</th><th>진행</th><th>완료 시각</th></tr></thead><tbody>
          ${qs.map(([id, q]) => {
            const e = st.quests?.[id];
            const s = G.sys.quest?.status?.(id) || e?.status || 'locked';
            const pr = G.sys.quest?.progress?.(id);
            const prog = pr && Number.isFinite(pr.done) ? `${pr.done}/${pr.total}` : '-';
            const when = num(e?.claimedAt) || num(e?.completedAt);
            return `<tr><td><span class="emoji">${esc(q.icon || '📜')}</span> ${esc(q.title)}</td><td>${esc(QUEST_CAT[q.category] || q.category || '-')}</td><td><span class="chip ${chipCls(s)}">${esc(STATUS_KO[s] || s)}</span></td><td>${esc(prog)}</td><td>${when ? esc(U.formatDate(when, true)) : '-'}</td></tr>`;
          }).join('')}</tbody></table></div>`;
    },
    activity(pane) {
      const list = (Array.isArray(G.state.activity) ? G.state.activity : []).slice().reverse();
      if (!list.length) { pane.innerHTML = '<div class="empty">아직 기록된 활동이 없어요.</div>'; return; }
      const zn = (id) => G.world.zoneById?.(id)?.name || '-';
      pane.innerHTML = `<p class="dim small">최근 활동 ${list.length}건 (최대 60건 보관)</p>
        <div class="adm-table-wrap"><table class="adm-table"><thead><tr><th>시각</th><th>종류</th><th>내용</th><th>구역</th></tr></thead><tbody>
        ${list.map((a) => `<tr><td class="nowrap">${esc(U.formatDate(num(a?.t), true))}</td><td><span class="chip">${esc(String(a?.type || '-'))}</span></td><td>${esc(String(a?.text || ''))}</td><td class="nowrap">${esc(zn(a?.zoneId))}</td></tr>`).join('')}
        </tbody></table></div>`;
    },
    accounts(pane) {
      const accs = Accounts.publicList();
      const idx = Profiles.all();
      const guest = idx.find((p) => p.kind === 'guest');
      const size = (id) => { const r = store.raw(SAVE_KEY(id)); return r ? bytesLabel(new Blob([r]).size) : '-'; };
      pane.innerHTML = `<p class="dim small">이 브라우저에 만들어진 로컬 계정 ${accs.length}개${guest ? ' + 게스트 1명' : ''}. 비밀번호는 PBKDF2 해시로만 보관되어 누구도 볼 수 없어요. 이메일은 일부만 표시해요.</p>
        <div class="adm-table-wrap"><table class="adm-table"><thead><tr><th>닉네임</th><th>이메일</th><th>권한</th><th>보호</th><th>레벨</th><th>가입</th><th>마지막 접속</th><th>저장 크기</th></tr></thead><tbody>
        ${accs.map((a) => {
          const p = idx.find((x) => x.id === a.id);
          return `<tr><td><b>${esc(a.nickname)}</b>${a.id === auth.current?.id ? ' <span class="chip chip-green">나</span>' : ''}</td><td>${esc(maskEmail(a.email))}</td><td>${a.role === 'admin' ? '<span class="chip chip-gold">관리자</span>' : '사용자'}</td><td>${a.algo === ALGO ? `<span class="chip chip-green">PBKDF2 ${esc(fmt(num(a.iter)))}</span>` : '<span class="chip chip-red">이전 방식</span>'}</td><td>${p?.level ? `Lv.${num(p.level)}` : '-'}</td><td class="nowrap">${esc(U.formatDate(num(a.createdAt)))}</td><td class="nowrap">${a.lastLogin ? esc(ago(num(a.lastLogin))) : '-'}</td><td>${size(a.id)}</td></tr>`;
        }).join('') || '<tr><td colspan="8" class="center muted">로컬 계정이 없어요.</td></tr>'}
        ${guest ? `<tr class="muted"><td>${esc(guest.nickname)}</td><td>-</td><td>게스트</td><td>-</td><td>${guest.level ? `Lv.${num(guest.level)}` : '-'}</td><td class="nowrap">${esc(U.formatDate(num(guest.createdAt)))}</td><td class="nowrap">${esc(ago(num(guest.lastPlayed)))}</td><td>${size('guest')}</td></tr>` : ''}
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
          pane.innerHTML = `<div class="empty">${ico('shield')}<p>${denied ? '관리자 권한이 있는 서버 계정으로 로그인해야 볼 수 있어요.' : esc(String(e?.message || '서버 통계를 불러오지 못했어요.').slice(0, 160))}</p><button type="button" class="btn btn-soft btn-sm adm-retry">다시 시도</button></div>`;
          G.ui.hydrateIcons(pane);
          pane.querySelector('.adm-retry')?.addEventListener('click', load);
          return;
        }
        if (!pane.isConnected) return;
        ADMIN_PANES._renderServer(pane, d && typeof d === 'object' ? d : {}, load);
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
      const cell = (v) => (v == null ? '-' : typeof v === 'object' ? esc(JSON.stringify(v).slice(0, 120)) : esc(String(v).slice(0, 120)));
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
    tools(pane) {
      pane.appendChild(h('p', { class: 'dim small' }, '테스트·점검용 도구예요. 진행 상황이 바로 바뀌니 실제 체험 계정에서는 조심해서 써 주세요.'));
      const btn = h('button', { type: 'button', class: 'btn btn-soft' }, '🛠️ 디버그 패널 열기·닫기');
      btn.addEventListener('click', () => { G.ui.modal.get('app-admin')?.close(); Debug.toggle(); });
      const test = h('button', { type: 'button', class: 'btn btn-soft' }, '🔐 암호화 자가 점검');
      const out = h('ul', { class: 'adm-selftest' });
      test.addEventListener('click', async () => {
        test.disabled = true;
        out.textContent = '';
        out.appendChild(h('li', null, '점검 중…'));
        const r = await cryptoSelfTest();
        out.textContent = '';
        for (const x of r.results) out.appendChild(h('li', { class: x.ok ? 'ok' : 'bad' }, `${x.ok ? '✅' : '❌'} ${x.name}${x.detail ? ` — ${x.detail}` : ''}`));
        test.disabled = false;
      });
      pane.append(h('div', { class: 'row wrap' }, btn, test), out);
    },
  };

  // ================================================================ mobile helpers (narrow / touch layouts only — hidden on desktop by CSS)
  function buildMobileToggles() {
    const hud = $('#hud');
    if (!hud || hud.querySelector('.app-mobile-toggles')) return;
    const box = h('div', { class: 'app-mobile-toggles', role: 'group', 'aria-label': '패널 보기' },
      h('button', { type: 'button', 'data-mt': 'chat', 'aria-label': '채팅 보기', 'aria-pressed': 'false' }, h('span', { class: 'ico', 'data-icon': 'chat' }), h('small', null, '채팅')),
      h('button', { type: 'button', 'data-mt': 'quests', 'aria-label': '퀘스트 보기', 'aria-pressed': 'false' }, h('span', { class: 'ico', 'data-icon': 'quest' }), h('small', null, '퀘스트')));
    box.addEventListener('click', (e) => {
      const b = e.target.closest('[data-mt]');
      if (!b) return;
      const body = document.body;
      if (b.dataset.mt === 'chat') {
        if (G.sys.social?.toggleChat) G.sys.social.toggleChat(); else body.classList.toggle('show-chat');
        if (body.classList.contains('show-chat')) body.classList.remove('show-quests');
      } else {
        body.classList.toggle('show-quests');
        if (body.classList.contains('show-quests')) body.classList.remove('show-chat');
      }
      syncMobileToggles();
      G.sfx('click');
    });
    hud.appendChild(box);
    // keep the pressed state in sync with other code paths (chat button in the left menu, Esc...)
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

  // ================================================================ HUD entrance (swoop in after the title)
  function hudEnter() {
    const hud = $('#hud');
    if (!hud || reduceMotion()) return;
    hud.classList.remove('hud-enter');
    void hud.offsetWidth;
    hud.classList.add('hud-enter');
    clearTimeout(hudEnter._t);
    hudEnter._t = setTimeout(() => hud.classList.remove('hud-enter'), 1600);
  }

  // ================================================================ app core
  const app = {
    loggedIn: false,
    _entering: false,
    _leaving: false,
    _booted: false,
    _applying: false,
    _loginSeq: 0,
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
        try { await G.net.detect(); } catch (e) { G.log.warn('NETWORK', 'detect failed', e?.message || e); }
        if (isServer()) { L.set(0.04, '계정 확인 중'); await auth.checkServer(); }
        await G.initSystems((f, label) => L.set(0.05 + f * 0.85, `${label} 준비 중`));
        L.set(0.93, '체험관 문을 여는 중');
        G.ui.setHudVisible(false);
        try { G.sys.camera?.cinematic?.({ ...CINE, duration: 0 }); } catch (e) { G.log.warn('UI', 'cinematic failed', e?.message || e); }
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

    /** the single login path (title buttons, forms, autostart). Emits game:login + game:ready exactly once per login. */
    async enterGame(profile, opts = {}) {
      if (this._entering || !profile) return false;
      if (this.loggedIn) { G.log.warn('AUTH', 'enterGame while logged in -> ignored'); return false; }
      this._entering = true;
      const seq = ++this._loginSeq;
      const mode = profile.kind === 'server' ? 'server' : 'local';
      let applied = false;
      try {
        auth.current = profile;
        let hadServerSave = false;
        if (mode === 'server') {
          // never start from an empty state because the server was briefly unreachable (autosave would overwrite it)
          try { const pre = await G.net.request('player/get.php', { timeout: 9000 }); hadServerSave = !!(pre && pre.save); }
          catch (e) {
            const st = Number(e?.status) || 0;
            if (st === 401) throw new AuthError('로그인이 만료되었어요. 다시 로그인해 주세요.');
            if (e?.code === 'NETWORK_ERROR' || !(st >= 400 && st < 500)) throw new AuthError('서버에서 저장 데이터를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.');
          }
        }
        G.save.useProfile({ id: profile.id, nickname: profile.nickname, email: profile.email || '', role: profile.role || 'user', guest: profile.kind === 'guest', kind: profile.kind }, mode);
        const state = await G.save.load();
        if (mode === 'server' && hadServerSave && state._isNew) throw new AuthError('서버의 저장 데이터를 읽지 못했어요. 진행 상황을 지키기 위해 입장을 멈췄어요. 잠시 후 다시 시도해 주세요.');
        sanitizeSettings(); // the save carries device settings -> repair odd values
        if (!state.tutorial || typeof state.tutorial !== 'object') state.tutorial = { step: 0, done: false };
        if (state.profile) { state.profile.nickname = profile.nickname; state.profile.role = profile.role === 'admin' ? 'admin' : 'user'; }
        const isNew = !!state._isNew;
        // a brand-new kid wears the look picked on the title
        if (isNew && profile.initialAvatar && G.avatar?.normalize && state.profile) state.profile.avatar = G.avatar.normalize(profile.initialAvatar);
        // play mode of a NEW profile = the mode it was created in (title screen / register form choice);
        // existing profiles always keep their own (§12.1: a parent's choice never leaks into a child's save)
        if (typeof profile.initialEasy === 'boolean' && (isNew || profile.forceEasy)) {
          state.settings = { ...(state.settings && typeof state.settings === 'object' && !Array.isArray(state.settings) ? state.settings : {}), easyMode: profile.initialEasy };
          G.save.applyProfileSettings?.(state);
        }
        delete profile.initialAvatar; delete profile.initialEasy; delete profile.forceEasy;
        Title.hide();
        G.state = state;
        this._applying = true;
        try { G.applyState(); } finally { this._applying = false; }
        applied = true;
        try { G.sys.camera?.setMode?.('follow'); } catch (e) { G.log.warn('UI', 'camera follow failed', e?.message || e); }
        G.ui.setHudVisible(true);
        hudEnter();
        if (!G.loop.running) G.loop.start();
        G.save.startAutosave();
        G.ready = true;
        this.loggedIn = true;
        const pub = { id: profile.id, nickname: profile.nickname, email: profile.email || '', role: profile.role === 'admin' ? 'admin' : 'user', kind: profile.kind };
        Profiles.upsert({ id: indexId(profile), kind: profile.kind, nickname: profile.nickname, role: pub.role, level: num(state.stats?.level) || 1, lastPlayed: now(), playTime: num(state.stats?.playTime) });
        Profiles.setLast(indexId(profile));
        G.log.info('AUTH', `enter game: ${profile.kind}${isNew ? ' (new profile)' : ''} · save=${mode}`);
        G.bus.emit('game:login', { profile: pub, isNew });
        G.bus.emit('game:ready');
        if (isNew) G.dirty('new-profile');
        const nick = profile.nickname;
        setTimeout(() => {
          if (!this.loggedIn || seq !== this._loginSeq) return;
          G.ui.toast(isNew ? `${nick}님, 전통발효체험관에 오신 것을 환영해요!` : `${nick}님, 다시 오신 것을 환영해요!`, { type: 'success', emoji: '🏮' });
        }, opts.auto ? 400 : 1100);
        setTimeout(() => { if (this.loggedIn && seq === this._loginSeq && G.state === state) Onboarding.sync(state, isNew); }, opts.auto ? 600 : 1600);
        Portrait.schedule(1400);
        return true;
      } catch (e) {
        G.log.error('AUTH', 'enter game failed', e?.message || e);
        if (!this.loggedIn) {
          G.save.stopAutosave();
          if (applied) { try { G.logoutSystems(); } catch (err) { /* ignore */ } }
          G.state = null;
          G.save.profile = null;
          G.ui.setHudVisible(false);
          if (!Title.open) Title.show();
        }
        auth.current = null;
        G.ui.toast(e instanceof AuthError ? e.message : '게임에 들어가지 못했어요. 잠시 후 다시 시도해 주세요.', { type: 'error' });
        return false;
      } finally { this._entering = false; }
    },

    /** save -> G.logoutSystems() -> G.state = null -> title */
    async logout(opts = {}) {
      if (!this.loggedIn || this._leaving) return false;
      if (opts.confirm !== false) {
        const guest = auth.current?.kind === 'guest';
        // easy mode: the parent gate IS the question; a picture confirm only when the gate is skipped / still open
        const gated = easyOn() && gateWillShow();
        if (easyOn() && !(await parentGate('logout', '그만 놀기', '처음 화면으로 돌아가요. 어른과 함께 해요.'))) return false;
        if (!gated) {
          const ok = await askConfirm({ emoji: '👋', heading: '그만 놀기', title: '그만 놀까요?', text: '놀던 것은 잘 저장돼요.', yes: '그만 놀기', no: '더 놀래요' },
            `로그아웃할까요?<br><span class="small dim">진행 상황은 저장되고, ${guest ? '같은 브라우저에서 게스트로 다시 이어할 수 있어요.' : '다시 로그인하면 이어서 할 수 있어요.'}</span>`, { title: '로그아웃', icon: 'logout', okText: '로그아웃' });
          if (!ok) return false;
        }
      }
      if (!this.loggedIn || this._leaving) return false;
      this._leaving = true;
      try {
        this._closeTransient();
        const saved = await saveNow('logout', false);
        if (!saved && G.state) {
          const go = await askConfirm({ emoji: '💾', heading: '저장 확인', title: '저장이 안 됐어요', text: '그래도 그만 놀까요? 방금 한 것이 사라질 수 있어요.', yes: '그만 놀기', no: '더 놀기', danger: true },
            '진행 상황을 저장하지 못했어요. 그래도 로그아웃할까요?<br><span class="small dim">마지막 저장 이후의 기록이 사라질 수 있어요.</span>', { title: '저장 실패', icon: 'save', okText: '그래도 로그아웃', danger: true });
          if (!go) return false;
        }
        const prof = auth.current;
        if (prof && G.state) Profiles.upsert({ id: indexId(prof), level: num(G.state.stats?.level) || 1, lastPlayed: now(), playTime: num(G.state.stats?.playTime) });
        if (!reduceMotion()) await G.ui.fade(true, 320);
        this._teardown();
        await auth.logout();
        G.bus.emit('game:logout', { profile: prof ? { id: prof.id, nickname: prof.nickname, kind: prof.kind } : null });
        Title.show();
        if (!reduceMotion()) G.ui.fade(false, 420);
        if (!opts.quiet) G.ui.toast(easyOn() ? '잘 가요! 또 놀러 와요!' : '로그아웃했어요. 다음에 또 만나요!', { type: 'info', emoji: '👋', say: easyOn() ? '잘 가요! 또 놀러 와요!' : undefined });
        return true;
      } catch (e) {
        G.log.error('AUTH', 'logout failed', e?.message || e);
        G.ui.fade(false, 200);
        G.ui.toast('로그아웃 중 문제가 생겼어요.', { type: 'error' });
        return false;
      } finally { this._leaving = false; }
    },

    /** local account deletion: verify the password, tear the session down WITHOUT saving, then purge storage */
    async deleteAccount(password) {
      if (!this.loggedIn || this._leaving || auth.current?.kind !== 'local') return '로컬 계정만 이곳에서 삭제할 수 있어요.';
      this._leaving = true;
      try {
        const msg = await auth.deleteAccount(password, {
          onVerified: () => {
            this._closeTransient();
            this._teardown();
          },
        });
        if (msg) return msg;
        G.bus.emit('game:logout', { profile: null, deleted: true });
        Title.show();
        G.ui.toast('계정과 진행 상황을 모두 지웠어요. 그동안 함께해 주셔서 고마워요!', { type: 'info', emoji: '🌿', duration: 4200 });
        return '';
      } finally { this._leaving = false; }
    },

    _closeTransient() {
      try { if (G.sys.photo?.active) G.sys.photo.exit?.(); } catch (e) { /* ignore */ }
      try { if (G.sys.dialogue?.active) G.sys.dialogue.close?.(); } catch (e) { /* ignore */ }
      try { if (devCenter()?.isOpen?.()) devCenter().close?.(); } catch (e) { /* ignore */ }
      G.ui.modal.closeAll();
      G.ui.popover.close();
      Onboarding.stop();
      Debug.hide();
    },
    /** drop the session state without saving (callers save first when they want to) */
    _teardown() {
      G.save.stopAutosave();
      G.save.dirty = false;
      G.logoutSystems();
      G.state = null;
      G.save.profile = null;
      this.loggedIn = false;
      this._loginSeq++;
      G.ui.setHudVisible(false);
      G.ui.objective?.(null);
      G.ui.banner?.(null);
      document.body.classList.remove('show-chat', 'show-quests');
      Portrait.reset();
    },

    showTitle(view) { if (!this.loggedIn) Title.show(view); },
    openMenu, openSettings, openHelp, openCredits, openTerms, openAdmin, openDevCenter, toggleDevCenter, upgradeGuest,
    openAvatar,
    // 쉬운 모드 (§12): kid screens, the grown-up versions behind the parent gate, kid looks for new profiles
    openKidMenu: () => (app.loggedIn && G.state ? openKidMenu() : null),
    openKidSettings, openKidHelp,
    openAdultMenu: () => parentGate('parents', '어른 메뉴').then((ok) => (ok ? openMenu({ adult: true }) : null)),
    openAdultSettings: (tab) => openSettings(tab || 'kids', { adult: true }),
    kidLooks,
    toggleDebug() { return toggleDevCenter(); },
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
      A('devcenter', () => openDevCenter());
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
      // F9 / ` : the developer center (80-devcenter.js) or the built-in fallback tools. Registered before the
      // dev center's own handlers (order 90 < 95) and returns true, so one key press opens it exactly once.
      const dev = () => { if (Title.open && !devFlag()) return false; toggleDevCenter(); return true; };
      G.input?.onKey?.('F9', dev, { allowInModal: true });
      G.input?.onKey?.('Backquote', dev, { allowInModal: true });
      // title screen: Esc goes back from the forms (and the kid "new friend" builder) and never reaches the game menu
      G.ui.onEscape(() => {
        if (!Title.open) return false;
        if (Title.view === 'kid') {
          if (Title.kid.mode === 'new' && Title._kidEntries().length) { Title.kid.mode = 'home'; Title._renderKid(); G.sfx('close'); }
        } else if (Title.view !== 'home') { Title.setView('home'); G.sfx('close'); }
        else if (Title.parent && easyOn()) { Title.parent = false; Title.renderHome(); Title.setView('kid'); G.sfx('close'); }
        return true;
      }, 60);
      // easy <-> normal at runtime: the title and any open app screen switch to the matching version
      G.bus.on('easy:changed', () => {
        if (Title.open) { if (easyOn()) Title.parent = false; Title.renderHome(); if (['home', 'kid'].includes(Title.view)) Title.setView(Title.homeView(), { focus: false }); }
        // kid screens cannot stay up in normal mode; grown-up screens opened behind the gate stay open in easy mode
        if (!easyOn()) {
          const swap = (id, reopen) => { const m = G.ui.modal.get(id); if (m && m._kind === 'kid') { m.close(); setTimeout(reopen, 0); } };
          swap('app-settings', () => openSettings('kids'));
          swap('app-help', () => openHelp());
          swap('app-menu', () => openMenu());
        }
        const av = G.ui.modal.get('app-avatar');
        if (av && av._kind && av._kind !== (easyOn() ? 'kid' : 'full')) av.close(); // pending picks are dropped: reopen from the menu
      });
      G.bus.on('state:saved', () => {
        const cur = auth.current;
        if (!cur || !G.state || !app.loggedIn) return;
        Profiles.upsert({ id: indexId(cur), level: num(G.state.stats?.level) || 1, playTime: num(G.state.stats?.playTime), lastPlayed: now(), nickname: G.state.profile?.nickname || cur.nickname });
      });
      G.bus.on('player:appearance', () => { if (app.loggedIn && !app._applying) Portrait.schedule(500); });
      G.bus.on('engine:quality', () => {
        const m = G.ui.modal.get('app-settings');
        if (m && m._tab === 'graphics') m._renderPane?.();
        if (Debug.open) Debug._sync();
      });
      // keep an open settings tab in sync when another module changes a setting (minimap close button, chat toggle...)
      G.bus.on('settings:changed', ({ key } = {}) => {
        if (Debug.open && (key === 'showFps' || key === 'quality')) Debug._sync();
        if (settingsSelf) return;
        const m = G.ui.modal.get('app-settings');
        if (m && KEY_TO_TAB[key] && m._tab === KEY_TO_TAB[key]) m._renderPane?.();
      });
      G.bus.on('weather:changed', () => { if (Debug.open) Debug._sync(); if (Title.open) Title._renderWorld(); });
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && Title.open) Title.renderHome(); });
    },

    onStateLoaded(state) {
      if (!state) return;
      if (!state.tutorial || typeof state.tutorial !== 'object') state.tutorial = { step: 0, done: false };
      // re-applied state during a session (reset / import / server restore): re-evaluate onboarding + portrait
      if (!app._applying && app.loggedIn) {
        if (state.profile && auth.current) state.profile.nickname = auth.current.nickname;
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
      for (const id of ['app-menu', 'app-settings', 'app-avatar', 'app-admin', 'app-help', 'app-delete-account']) G.ui.modal.get(id)?.close();
    },
  });
})();
