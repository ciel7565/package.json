// =============================================================================
// 08-easy.js — 쉬운 모드 (CONTRACT §12): the kid toolkit every module uses + the easy HUD.
// Core fragment: no 3D at load time, safe to call before any system has initialised.
//
//   G.easy.on                              (getter) easy mode active (G.settings.easyMode, default true)
//   G.easy.set(bool) -> Promise<bool>      turning OFF asks G.easy.gate first (it re-enables free-text chat)
//   G.easy.say(text, {interrupt=true, priority=0, force, rate}) -> Promise<bool>   voice guide (ko-KR TTS)
//   G.easy.stop() / G.easy.speaking
//   G.easy.speakable(el, text|fn?) -> 🔊 button appended to el (long-press on touch reads it too)
//   G.easy.textOf(el)                      the text a long-press / 🔊 reads for an element
//   G.easy.gate({reason, title}) -> Promise<bool>   parent gate (2 × 2-digit·1-digit in a row, 6 choices, cool-down,
//        unlock scoped to the screen it opens; logout / devcenter always ask)
//   G.easy.gateStatus(reason?) / G.easy.lockGate()
//   G.easy.pick({title, say, emoji, items:[{id, emoji, label, color?, disabled?, badge?, say?, sub?}], columns})
//        -> Promise<id|null>              big picture chooser (Esc / ⬅️ → null)
//   G.easy.confirm({emoji, title, text, say, yes, no, danger}) -> Promise<bool>
//   G.easy.alert({emoji, title, text, say, ok}) -> Promise<void>
//   G.easy.celebrate(text, {emoji, say, duration, sound}) -> Promise
//   G.easy.point(target, {label, say, duration=6000, offsetY}) -> {stop(), active}   target: Element | selector |
//        {x, y?, z} | Object3D ; one hand at a time ; G.easy.stopPoint() ; the hand picks the side of the target
//        (8 directions, round buttons touched on their rim) and the label spot (behind or beside the hand) that
//        cover the least of the fixed HUD, and keeps the label on screen
//   G.easy.nextStep() -> {key, emoji, text, say, target:{x,z,label}|null, act?, actLabel?, actEmoji?, progress?}
//   G.easy.goTo(target {x,z} | zoneOrPoiId, {label, stopDistance, person}) -> Promise<bool>   (auto-walk / travel;
//        person: the label is someone, not a place — "친구에게 같이 가요!")
//   G.easy.travelMenu() -> Promise<zoneId|null>   picture "어디 갈까?" menu
//   G.easy.t(normalText, easyText)         easyText while easy mode is on
//   G.easy.nameIdeas(n=6) -> ['용감한다람쥐', ...]   kid-safe nicknames (valid for the 2–12 char nickname rule)
//   G.easy.rest() / G.easy.remind()        healthy-play: rest overlay / reminder card (auto every playReminderMin)
// HUD (template.html): #easy-next "다음 할 일" card, left tiles 🎒 📖 🔔 ☰, bottom bar 😊 📸 📝 🔊, 💬 button,
//   🗺️ 어디 갈까?. This fragment OWNS the actions: easy-go, easy-read, express, sound, stickerbook, today, where.
// Events: easy:changed {on} · easy:say {text} · easy:gate {reason, ok} · easy:point {label}
// Security (§11.1): text only via textContent / G.ui.h children; mascot SVG is generated in-code; no eval,
//   no inline handlers, no external URLs. The gate is a UX barrier for small children, not an auth boundary.
// =============================================================================
(function () {
  const U = G.util;
  const clamp = U.clamp;
  const h = (...a) => G.ui.h(...a);
  const S = () => G.settings || {};
  const isOn = () => S().easyMode !== false;
  const nowMs = () => performance.now();
  const emit = (name, payload) => { try { G.bus.emit(name, payload); } catch (e) { /* bus is core */ } };
  const reduceMotion = () => !!S().reduceMotion || !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const LS_GATE = 'tfm.v1.gate';
  const SS_PLAY = 'tfm.v1.playActive';
  const GATE_TRIES = 3;
  const GATE_COOLDOWN = 30000;      // first cool-down after 3 wrong answers
  const GATE_COOLDOWN_MAX = 300000; // repeated failures double the wait, capped at 5 minutes
  const KID_COLORS = ['#ff8a5c', '#ffc93c', '#55d187', '#4fb3ff', '#b48bff', '#ff7eb6', '#36cfc0', '#ff9f43', '#8fd14f', '#6c8cff', '#f4a7ff', '#ffd166'];
  const RX_COLOR = /^(#[0-9a-f]{3,8}|(rgb|hsl)a?\([\d\s.,%+-]{3,40}\))$/i;

  // ---------------------------------------------------------------- small helpers
  /** does the last syllable have a final consonant (받침)? digits are read in Sino-Korean */
  function hasJong(word) {
    const s = String(word ?? '').trim();
    if (!s) return false;
    const c = s.charCodeAt(s.length - 1);
    if (c >= 0xac00 && c <= 0xd7a3) return (c - 0xac00) % 28 !== 0;
    if (/[0-9]$/.test(s)) return /[013678]$/.test(s);
    return false;
  }
  /** '으로/로' follows its own rule: no final consonant OR ㄹ takes 로 (한옥마을로, 참가자1로), any other 으로 (밭으로) */
  function roJosa(word) {
    const s = String(word ?? '').trim();
    if (!s) return '로';
    const c = s.charCodeAt(s.length - 1);
    if (c >= 0xac00 && c <= 0xd7a3) { const j = (c - 0xac00) % 28; return j === 0 || j === 8 ? '로' : '으로'; }
    if (/[0-9]$/.test(s)) return /[036]$/.test(s) ? '으로' : '로'; // 영·삼·육 end in a consonant other than ㄹ
    return '로';
  }
  /** josa('콩', '을/를') -> '콩을' */
  function josa(word, pair) {
    if (pair === '으로/로') return `${word}${roJosa(word)}`;
    const [a, b] = String(pair).split('/');
    return `${word}${hasJong(word) ? a : b}`;
  }

  function mascot(mood, size) {
    try { const s = G.mascot?.svg?.(mood, size); return typeof s === 'string' && s.trim().startsWith('<svg') ? s : ''; } catch (e) { return ''; }
  }
  function faceEl(mood, size, fallback = '🏺') {
    const svg = mascot(mood, size);
    return svg ? h('span', { class: 'easy-face', 'aria-hidden': 'true', html: svg }) : h('span', { class: 'easy-face emoji', 'aria-hidden': 'true' }, fallback);
  }
  function safeColor(c, i) { return typeof c === 'string' && RX_COLOR.test(c.trim()) ? c.trim() : KID_COLORS[Math.abs(i | 0) % KID_COLORS.length]; }
  function safeQuery(sel) { try { return document.querySelector(sel); } catch (e) { return null; } }
  function shake(el) { if (!el) return; el.classList.remove('easy-shake'); void el.offsetWidth; el.classList.add('easy-shake'); }

  let layerEl = null;
  /** fixed overlay layer for the hand pointer, celebrations and the rest screen (above toasts, below rewards) */
  function layer() {
    if (layerEl && layerEl.isConnected) return layerEl;
    layerEl = document.getElementById('easy-layer');
    if (!layerEl) {
      layerEl = h('div', { id: 'easy-layer', class: 'easy-layer', 'aria-live': 'polite' });
      (document.getElementById('app') || document.body).appendChild(layerEl);
    }
    return layerEl;
  }

  // ================================================================ voice guide (speechSynthesis ko-KR)
  const RX_PICTO = /[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{1F3FB}-\u{1F3FF}\u{FE0E}\u{FE0F}\u{200D}\u{20E3}]/gu;
  /** what the voice actually reads: no markup, no emoji, no symbols; ≤ 140 chars, cut at a sentence end */
  function speechText(text) {
    let s = String(text ?? '');
    if (!s) return '';
    s = s.replace(/<[^>]*>/g, ' ')
      .replace(/&(?:[a-z]+|#\d+);/gi, ' ')
      .replace(RX_PICTO, ' ')
      .replace(/\bLv\.?\s?(\d+)/gi, '레벨 $1')
      .replace(/[←-⇿➔-➿]/g, ' ')
      .replace(/[*_#`^|<>[\]{}\\=+@]+/g, ' ')
      .replace(/[·•]/g, ', ')
      .replace(/…|\.{3,}/g, '. ')
      .replace(/\s+/g, ' ')
      .replace(/^[\s,.!?]+/, '')
      .trim();
    if (s.length > 140) {
      const cut = s.slice(0, 140);
      const i = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '), cut.lastIndexOf('요 '));
      s = (i > 50 ? cut.slice(0, i + 1) : cut).trim();
    }
    return s;
  }

  const Voice = {
    q: [], cur: null, recent: new Map(), voice: null, cancelAt: -1e9, mutedHintAt: -1e9, held: [],
    ok() {
      try { return !!window.speechSynthesis && typeof window.SpeechSynthesisUtterance === 'function'; } catch (e) { return false; }
    },
    pickVoice() {
      if (this.voice) return this.voice;
      let list = [];
      try { list = window.speechSynthesis.getVoices() || []; } catch (e) { list = []; }
      const ko = list.filter((v) => /^ko([-_]|$)/i.test(v.lang || ''));
      if (!ko.length) return null;
      const score = (v) => (/natural|neural|online/i.test(v.name) ? 6 : 0) + (/google/i.test(v.name) ? 4 : 0)
        + (/yuna|sunhi|seoyeon|heami|jimin|nara|sora|female|여성/i.test(v.name) ? 2 : 0) + (/^ko[-_]KR$/i.test(v.lang) ? 1 : 0) + (v.default ? 0.5 : 0);
      ko.sort((a, b) => score(b) - score(a));
      this.voice = ko[0];
      return this.voice;
    },
    enqueue(item) {
      if (item.interrupt) {
        if (this.cur && this.cur.priority > item.priority) { this.q.push(item); this.trim(); return; }
        this.flush();
      }
      this.q.push(item);
      this.trim();
      if (!this.cur) this.next();
    },
    trim() { while (this.q.length > 4) this.q.shift().resolve(false); },
    flush() {
      for (const x of this.q) x.resolve(false);
      this.q.length = 0;
      const c = this.cur;
      if (c) {
        this.cur = null; c.dead = true; clearTimeout(c.timer); c.resolve(false);
        try { window.speechSynthesis.cancel(); } catch (e) { /* unsupported */ }
        this.cancelAt = nowMs();
      }
    },
    next() {
      const item = this.q.shift();
      if (!item) { this.unduck(); return; }
      this.cur = item;
      const start = () => {
        if (item.dead || this.cur !== item) return;
        try {
          const ss = window.speechSynthesis;
          const u = new window.SpeechSynthesisUtterance(item.text);
          u.lang = 'ko-KR';
          const v = this.pickVoice();
          if (v) u.voice = v;
          u.rate = clamp(Number(item.rate || S().voiceRate) || 0.95, 0.6, 1.4);
          u.pitch = 1.1;
          u.volume = clamp((Number(S().volumeMaster) || 0.8) * 1.15, 0.25, 1);
          u.onend = () => this.done(item, true);
          u.onerror = () => this.done(item, false);
          item.u = u; // keep a reference: some engines drop onend for garbage-collected utterances
          try { G.sys.audio?.duck?.('easy-voice', 0.4); } catch (e) { /* audio optional */ }
          if (ss.paused) ss.resume();
          ss.speak(u);
          // safety net: engines without voices (headless, some Linux) never fire onend
          item.timer = setTimeout(() => this.done(item, false), Math.min(30000, 1600 + item.text.length * 240 / u.rate));
        } catch (e) { this.done(item, false); }
      };
      // right after cancel() some engines drop the next utterance: give them a moment
      if (nowMs() - this.cancelAt < 120) item.timer = setTimeout(start, 90); else start();
    },
    done(item, ok) {
      if (this.cur !== item) return;
      clearTimeout(item.timer);
      this.cur = null;
      item.resolve(ok);
      this.next();
    },
    stop() { this.flush(); this.unduck(); },
    unduck() { try { G.sys.audio?.unduck?.('easy-voice'); } catch (e) { /* audio optional */ } },
  };
  try {
    const ss = window.speechSynthesis;
    if (ss && typeof ss.addEventListener === 'function') ss.addEventListener('voiceschanged', () => { Voice.voice = null; });
  } catch (e) { /* speech unsupported */ }

  function mutedHint() {
    const t = nowMs();
    if (t - Voice.mutedHintAt < 8000) return;
    Voice.mutedHintAt = t;
    G.ui?.toast?.('소리가 꺼져 있어요. 🔊 소리 버튼을 눌러요!', { emoji: '🔇', type: 'info', sound: false });
  }

  /** read text aloud (easy mode + voiceGuide + not muted, or opts.force for explicit 🔊 taps) */
  function say(text, opts = {}) {
    try {
      const clean = speechText(text);
      if (!clean) return Promise.resolve(false);
      const force = !!opts.force;
      if (!force && !(isOn() && S().voiceGuide !== false)) return Promise.resolve(false);
      if (S().muted) { if (force) mutedHint(); return Promise.resolve(false); }
      const t = nowMs();
      for (const [k, at] of Voice.recent) if (t - at > 4000) Voice.recent.delete(k);
      if (Voice.cur && Voice.cur.text === clean) return Promise.resolve(false);       // already reading it
      if (!force && Voice.recent.has(clean)) return Promise.resolve(false);           // same line within 4 s
      // a cinematic owns the screen (정선 만장대 intro / telescope view): only its own lines are read; the rest waits
      if (!opts.intro && !force && (document.body.classList.contains('md-intro') || document.body.classList.contains('md-scoping'))) {
        if (!Voice.held.includes(clean)) Voice.held.push(clean);
        while (Voice.held.length > 2) Voice.held.shift();
        return Promise.resolve(false);
      }
      Voice.recent.set(clean, t);
      emit('easy:say', { text: clean });
      if (!Voice.ok()) return Promise.resolve(false);
      return new Promise((resolve) => Voice.enqueue({ text: clean, resolve, priority: Number(opts.priority) || 0, interrupt: opts.interrupt !== false, rate: opts.rate }));
    } catch (e) {
      G.log.debug('UI', 'easy.say failed', e);
      return Promise.resolve(false);
    }
  }

  // lines held back during the 정선 만장대 intro are read (newest two, in order) once it ends
  const releaseHeld = ({ phase } = {}) => {
    if (phase !== 'end') return;
    const lines = Voice.held.splice(0);
    if (lines.length) setTimeout(() => { for (const l of lines) say(l, { interrupt: false }); }, 700);
  };
  G.bus.on('manjangdae:intro', releaseHeld);
  G.bus.on('manjangdae:tour', releaseHeld);
  G.bus.on('game:logout', () => { Voice.held.length = 0; });

  /** the text a 🔊 button / long-press reads for an element */
  function textOf(el) {
    if (!el || !(el instanceof Element)) return '';
    const st = el.__easySpeak;
    if (st && st.text != null) { try { const v = typeof st.text === 'function' ? st.text() : st.text; if (v != null && String(v).trim()) return String(v); } catch (e) { /* fall through */ } }
    const ds = el.getAttribute('data-say');
    if (ds) return ds;
    let t = '';
    try { t = String(el.innerText || el.textContent || ''); } catch (e) { t = ''; }
    t = t.replace(/\s+/g, ' ').trim().slice(0, 400);
    if (!speechText(t)) t = el.getAttribute('aria-label') || el.getAttribute('title') || '';
    return t;
  }

  function speakable(el, text) {
    if (!el || !(el instanceof Element)) return null;
    if (el.__easySpeak) { if (text !== undefined) el.__easySpeak.text = text; return el.__easySpeak.btn; }
    const btn = h('button', { type: 'button', class: 'easy-speak', 'aria-label': '소리로 듣기', title: '소리로 듣기' }, h('span', { class: 'emoji', 'aria-hidden': 'true' }, '🔊'));
    const st = { btn, text: text === undefined ? null : text };
    el.__easySpeak = st;
    btn.addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation();
      let t = st.text;
      try { if (typeof t === 'function') t = t(); } catch (err) { t = null; }
      if (t == null || !String(t).trim()) { st.text = null; t = textOf(el); }
      btn.classList.remove('easy-speak-on'); void btn.offsetWidth; btn.classList.add('easy-speak-on');
      say(t, { force: true, priority: 1 });
    });
    el.appendChild(btn);
    return btn;
  }

  // ================================================================ parent gate
  // A UX barrier for small children (not an adult security boundary), made hard to beat by blind tapping:
  //   · 6 big choices, the answer's rank among them is uniform (no "it is usually a middle value" tell)
  //   · TWO correct answers in a row are needed; a wrong answer starts the streak again
  //   · 3 wrong answers → cool-down 30 s, doubling per failed round (max 5 min), persisted across reloads
  //   · one answer per question (a tap locks the grid; the next question arms after a short pause)
  //   Blind odds per round ≈ 8 % (see G.easy._gateSim), so mashing through the cool-downs takes ~45 minutes.
  // Unlock scope: a pass opens a short grown-up SESSION bound to the grown-up screen it opened — 어른 메뉴, 어른 설정,
  // 계정 삭제, 관리자 (GATE_ROOT_CLASS), or the title's 어른 메뉴 view. Screens a child can open themselves (가방, 도움말,
  // 스티커북, kid menu…) are never adopted, and dialogs opened on top of a grown-up screen do not keep the session
  // alive on their own. The session ends when the last grown-up screen closes (650 ms grace for a hop between two of
  // them), on logout / login / profile load, easy-mode switch, tab hide, or after GATE_IDLE. A pass for an action that
  // opens no screen (unblock, export…) only serves that action. Logout / developer center / admin / account deletion
  // always ask again; dangerous switches (아이 채팅 끄기, 보호자 확인 끄기, 쉬운 모드 끄기, 초기화, 가져오기) need a pass from
  // the last GATE_FRESH.
  const GATE_NEED = 2;
  const GATE_CHOICES = 6;
  const GATE_FRESH = 90 * 1000;
  const GATE_IDLE = 3 * 60 * 1000;
  const GATE_NO_CACHE = new Set(['logout', 'devcenter', 'admin', 'delete-account']);
  const GATE_DANGER = new Set(['kid-chat', 'parent-gate', 'easy-off', 'reset', 'import', 'forget']);
  // gated actions that open a grown-up screen right after the pass (the others only serve their own action)
  const GATE_SCREEN = new Set(['parents', 'settings', 'admin', 'delete-account', 'login', 'register']);
  // the grown-up screens a session may live on (04-ui passes the modal's className with ui:modal-open)
  const GATE_ROOT_CLASS = /(^|\s)(app-menu-modal|app-settings-modal|app-delete-modal|admin-modal)(\s|$)/;
  // wrong / wt / until: the in-memory copy of the persisted round (used when site storage is blocked)
  const Gate = { sess: null, wrong: 0, wt: 0, until: 0, pending: null, streak: 0, tick: 0 };
  /** persisted gate state: cool-down end, failed rounds (doubling) and the wrong answers of the current round
   *  (so a reload between wrong taps does not hand out fresh tries). Wrong answers older than 10 min expire. */
  const GATE_WRONG_TTL = 10 * 60 * 1000;
  const freshWrong = (wt) => wt > 0 && Date.now() - wt < GATE_WRONG_TTL && Date.now() >= wt;
  function gateLoad() {
    try {
      const o = JSON.parse(localStorage.getItem(LS_GATE) || 'null');
      if (o && typeof o === 'object') {
        const wt = Number(o.wt) || 0;
        const fresh = freshWrong(wt);
        let until = Number(o.until) || 0;
        // a cool-down never lies more than GATE_COOLDOWN_MAX ahead: after the device clock moved back (time sync of a
        // fast tablet clock, a reset battery) the stored end could be hours or days away and would never run down
        const cap = Date.now() + GATE_COOLDOWN_MAX;
        if (until > cap) { until = cap; try { localStorage.setItem(LS_GATE, JSON.stringify({ ...o, until })); } catch (e) { /* storage blocked */ } }
        return { until, strikes: clamp(Math.floor(Number(o.strikes) || 0), 0, 10), wrong: fresh ? clamp(Math.floor(Number(o.wrong) || 0), 0, GATE_TRIES) : 0, wt: fresh ? wt : 0 };
      }
    } catch (e) { /* corrupt -> reset */ }
    return { until: 0, strikes: 0, wrong: 0, wt: 0 };
  }
  function gateSave(o) {
    const wrong = clamp(Math.floor(Number(o.wrong) || 0), 0, GATE_TRIES);
    Gate.wrong = wrong; Gate.wt = wrong > 0 ? Date.now() : 0; Gate.until = Math.round(Number(o.until) || 0);
    try {
      localStorage.setItem(LS_GATE, JSON.stringify({
        until: Gate.until, strikes: clamp(Math.floor(Number(o.strikes) || 0), 0, 10),
        wrong, wt: Gate.wt,
      }));
    } catch (e) { /* storage blocked: the in-memory copy still counts for this page */ }
  }
  /** wrong answers of the current round (storage, or memory when storage is blocked); both expire after 10 min */
  function curWrong() {
    if (Gate.wrong && !freshWrong(Gate.wt)) { Gate.wrong = 0; Gate.wt = 0; }
    return Math.max(Gate.wrong, gateLoad().wrong);
  }
  /** remaining cool-down (ms); the end is capped the same way in memory, so it always runs down */
  function cooldownLeft() {
    if (Gate.until > Date.now() + GATE_COOLDOWN_MAX) Gate.until = Date.now() + GATE_COOLDOWN_MAX;
    return clamp(Math.max(gateLoad().until, Gate.until) - Date.now(), 0, GATE_COOLDOWN_MAX);
  }

  /** unbiased integer in [a, b] (crypto when available: the next question cannot be guessed from the last) */
  function gateRand(a, b) {
    const n = b - a + 1;
    try {
      const buf = new Uint32Array(1);
      const lim = Math.floor(0x100000000 / n) * n;
      do crypto.getRandomValues(buf); while (buf[0] >= lim);
      return a + (buf[0] % n);
    } catch (e) { return U.randInt(a, b); }
  }
  function gateShuffle(arr) { for (let i = arr.length - 1; i > 0; i--) { const j = gateRand(0, i); [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; }
  /**
   * a × b with a 2-digit and b 1-digit; 6 shuffled, plausible, positive, distinct choices. How many choices are
   * SMALLER than the answer is drawn uniformly (0…5), so the answer is the smallest, a middle or the largest value
   * equally often.
   */
  function gateQuestion() {
    const a = gateRand(12, 98), b = gateRand(3, 9);
    const answer = a * b;
    const n = GATE_CHOICES - 1;
    const below = gateRand(0, n);
    const offs = gateShuffle([b, 2 * b, 3 * b, 4 * b, 10, 20, 30, 10 + b, 20 + b, 10 - b > 0 ? 10 - b : 11, a, 2 * b + 10, 1, 2]);
    const pick = (sign, want, used) => {
      const out = [];
      for (const o of offs) {
        if (out.length >= want) break;
        const v = answer + sign * o;
        if (v > 0 && v !== answer && !used.has(v)) { used.add(v); out.push(v); }
      }
      for (let k = 3; out.length < want && k < 200; k++) { const v = answer + sign * k; if (v > 0 && !used.has(v)) { used.add(v); out.push(v); } }
      return out;
    };
    const used = new Set([answer]);
    const lows = pick(-1, below, used);
    const highs = pick(1, n - lows.length, used);
    return { a, b, answer, choices: gateShuffle([answer, ...lows, ...highs]) };
  }
  /** Monte-Carlo blind-tapping pass rate per round with the real rules (dev-center / tests: must stay ≤ 10 %) */
  function gateSim(rounds = 20000) {
    let pass = 0;
    for (let r = 0; r < rounds; r++) {
      let streak = 0, wrong = 0;
      while (wrong < GATE_TRIES) {
        const q = gateQuestion();
        if (q.choices[gateRand(0, q.choices.length - 1)] === q.answer) { if (++streak >= GATE_NEED) { pass++; break; } }
        else { streak = 0; wrong++; }
      }
    }
    return pass / rounds;
  }

  // ---- grown-up session (what a pass unlocks, and for how long)
  function sessAlive() {
    // apply the screen rules right now as well (the 400 ms timer can lag behind on a busy main thread)
    if (Gate.sess) sessTick();
    const s = Gate.sess;
    if (!s) return false;
    if (nowMs() > s.until) { lockGate('expired'); return false; }
    return true;
  }
  function canReuse(reason) {
    if (!sessAlive()) return false;
    if (GATE_NO_CACHE.has(reason)) return false;
    if (GATE_DANGER.has(reason) && nowMs() - Gate.sess.at > GATE_FRESH) return false;
    return true;
  }
  function unlock(reason) {
    const t = nowMs();
    const s = sessAlive() ? Gate.sess : { modals: new Set(), title: false, closedAt: 0 };
    s.reason = reason; s.at = t; s.until = t + GATE_IDLE; s.closedAt = 0;
    // the screen of a screen-opening action may take a moment to appear; any other pass serves only its own action
    s.adoptUntil = t + (GATE_SCREEN.has(reason) ? 3000 : 600);
    Gate.sess = s;
    if (!Gate.tick) Gate.tick = setInterval(sessTick, 400);
  }
  /** the session follows its grown-up screen (s.modals = the open grown-up screens, or the title's 어른 메뉴 view) */
  function sessTick() {
    const s = Gate.sess;
    if (!s) { clearInterval(Gate.tick); Gate.tick = 0; return; }
    const t = nowMs();
    if (t > s.until) { lockGate('expired'); return; }
    if (document.querySelector('.title-screen.parent')) { s.title = true; s.closedAt = 0; return; }
    if (s.title && !s.modals.size) { lockGate('screen-closed'); return; }
    if (s.modals.size) return;
    if (s.closedAt) { if (t - s.closedAt > 650) lockGate('screen-closed'); return; }
    if (t > s.adoptUntil && !G.ui?.modal?.get?.('easy-gate')) lockGate('no-screen'); // the pass only served its own action
  }
  G.bus.on('ui:modal-open', ({ id, className } = {}) => {
    const s = Gate.sess;
    if (!s || !id || id === 'easy-gate' || !sessAlive()) return;
    // only a grown-up screen can carry the session (a child-openable screen opened meanwhile never does)
    if (GATE_ROOT_CLASS.test(String(className || ''))) { s.modals.add(String(id)); s.closedAt = 0; }
  });
  G.bus.on('ui:modal-close', ({ id } = {}) => {
    const s = Gate.sess;
    if (!s || !id) return;
    if (s.modals.delete(String(id)) && !s.modals.size) s.closedAt = nowMs();
  });
  for (const ev of ['game:login', 'state:loaded', 'easy:changed']) G.bus.on(ev, () => lockGate(ev));
  document.addEventListener('visibilitychange', () => { if (document.hidden) lockGate('hidden'); });

  function gateStatus(reason) {
    const alive = sessAlive();
    const s = Gate.sess;
    return {
      unlocked: reason ? canReuse(String(reason)) : alive, unlockLeft: alive ? Math.max(0, s.until - nowMs()) : 0,
      screens: alive ? [...s.modals] : [], cooldownLeft: cooldownLeft(), wrong: curWrong(), streak: Gate.streak, need: GATE_NEED,
      choices: GATE_CHOICES, tries: GATE_TRIES, open: !!Gate.pending, required: isOn() && S().parentGate !== false,
    };
  }
  function lockGate(why = 'manual') {
    if (Gate.sess) G.log.info('UI', `parent gate locked (${String(why).slice(0, 20)})`);
    Gate.sess = null;
    if (Gate.tick) { clearInterval(Gate.tick); Gate.tick = 0; }
  }

  function gate(opts = {}) {
    const reason = String(opts.reason || 'settings').slice(0, 40);
    const finish = (ok, extra) => { emit('easy:gate', { reason, ok, ...(extra || {}) }); return ok; };
    if (!isOn() || S().parentGate === false) return Promise.resolve(finish(true, { skipped: true }));
    if (canReuse(reason)) { Gate.sess.until = nowMs() + GATE_IDLE; return Promise.resolve(finish(true, { cached: true })); }
    if (Gate.pending) return Gate.pending;
    if (!G.ui?.modal) return Promise.resolve(finish(false, { error: 'no-ui' }));
    Gate.pending = new Promise((resolve) => {
      try {
        openGate(opts, (ok) => { Gate.pending = null; if (ok) unlock(reason); resolve(finish(ok)); });
      } catch (e) {
        G.log.error('UI', 'easy.gate failed', e);
        Gate.pending = null;
        resolve(finish(false, { error: 'exception' }));
      }
    });
    return Gate.pending;
  }

  function openGate(opts, done) {
    // anti-mashing: every question has an id; a tap locks the grid at once (stale/second taps are ignored) and a
    // new question only becomes tappable after a short pause, so rapid tapping gets ONE guess per question.
    let finished = false, q = null, qid = 0, armed = false, coolTimer = 0, armTimer = 0, m = null;
    const fin = (ok) => { if (finished) return; finished = true; clearInterval(coolTimer); clearTimeout(armTimer); Gate.streak = 0; done(ok); };
    Gate.streak = 0;
    const qEl = h('div', { class: 'easy-gate-q' });
    const grid = h('div', { class: 'easy-gate-choices', role: 'group', 'aria-label': '답을 골라요' });
    const steps = h('p', { class: 'easy-gate-steps', 'aria-live': 'polite' });
    const status = h('p', { class: 'easy-gate-status', role: 'status', 'aria-live': 'polite' });
    const coolNum = h('b', null, '30');
    const cool = h('div', { class: 'easy-gate-cool', hidden: true },
      h('span', { class: 'emoji', 'aria-hidden': 'true' }, '⏳'), h('span', null, coolNum, '초 뒤에 다시 해요'));
    const body = h('div', { class: 'easy-gate' },
      faceEl('think', 76, '🤔'),
      h('p', { class: 'easy-gate-lead' }, '어른과 함께 해요!'),
      h('p', { class: 'easy-gate-sub' }, String(opts.text || `보호자만 풀 수 있는 문제예요. ${GATE_NEED}문제를 연달아 맞혀 주세요.`).slice(0, 120)),
      steps, qEl, grid, status, cool);
    const showSteps = () => { steps.textContent = `${'●'.repeat(Gate.streak)}${'○'.repeat(Math.max(0, GATE_NEED - Gate.streak))}  ${Gate.streak + 1}/${GATE_NEED}번째 문제`; };

    const setArmed = (on) => {
      armed = !!on;
      grid.classList.toggle('is-locked', !armed);
      grid.setAttribute('aria-busy', armed ? 'false' : 'true');
      for (const b of grid.querySelectorAll('.easy-gate-choice')) { b.disabled = !armed; b.setAttribute('aria-disabled', armed ? 'false' : 'true'); }
    };
    const render = (delay = 350) => {
      q = gateQuestion();
      qid++;
      qEl.textContent = '';
      qEl.append(h('span', null, String(q.a)), h('span', { class: 'op' }, '×'), h('span', null, String(q.b)), h('span', { class: 'op' }, '='), h('span', { class: 'qm' }, '?'));
      qEl.setAttribute('aria-label', `${q.a} 곱하기 ${q.b}는?`);
      grid.textContent = '';
      q.choices.forEach((c, i) => grid.appendChild(h('button', { type: 'button', class: 'easy-gate-choice', dataset: { v: String(c), q: String(qid) }, 'aria-label': `${i + 1}번, ${c}` }, String(c))));
      qEl.hidden = false; grid.hidden = false; cool.hidden = true; steps.hidden = false;
      showSteps();
      setArmed(false);
      const my = qid;
      clearTimeout(armTimer);
      armTimer = setTimeout(() => {
        if (finished || my !== qid || !cool.hidden) return;
        setArmed(true);
        grid.querySelector('button')?.focus({ preventScroll: true });
      }, delay);
    };
    const showCool = () => {
      setArmed(false);
      qEl.hidden = true; grid.hidden = true; cool.hidden = false; steps.hidden = true;
      const tick = () => {
        const left = cooldownLeft();
        coolNum.textContent = String(Math.ceil(left / 1000));
        if (left <= 0) { clearInterval(coolTimer); coolTimer = 0; status.textContent = '다시 해 볼까요?'; render(); }
      };
      clearInterval(coolTimer);
      coolTimer = setInterval(tick, 500);
      tick();
    };
    grid.addEventListener('click', (e) => {
      const b = e.target.closest('.easy-gate-choice');
      // one answer per question: ignore taps while locked, on a stale question, during a cool-down or after the end
      if (!b || finished || !q || !armed || b.disabled || Number(b.dataset.q) !== qid || !cool.hidden || cooldownLeft() > 0) return;
      setArmed(false);
      if (Number(b.dataset.v) === q.answer) {
        b.classList.add('ok');
        Gate.streak++;
        if (Gate.streak >= GATE_NEED) {
          gateSave({ until: 0, strikes: 0, wrong: 0 });
          status.textContent = '✅ 확인했어요!';
          steps.textContent = '●'.repeat(GATE_NEED);
          G.sfx('correct');
          setTimeout(() => { fin(true); m?.close(); }, 320);
          return;
        }
        status.textContent = '맞았어요! 한 문제 더 풀어요.';
        G.sfx('tap');
        const my = qid;
        setTimeout(() => { if (!finished && cool.hidden && my === qid) render(450); }, 380);
        return;
      }
      Gate.streak = 0;
      const wrong = curWrong() + 1;
      G.sfx('wrong');
      b.classList.add('bad');
      shake(grid);
      const st = gateLoad();
      if (wrong >= GATE_TRIES) {
        const wait = Math.min(GATE_COOLDOWN_MAX, GATE_COOLDOWN * Math.pow(2, st.strikes));
        gateSave({ until: Date.now() + wait, strikes: st.strikes + 1, wrong: 0 });
        status.textContent = '조금 쉬었다가 어른과 다시 해요.';
        showCool();
      } else {
        gateSave({ until: st.until, strikes: st.strikes, wrong });
        status.textContent = `앗, 아니에요. 처음부터 다시 해요. (${GATE_TRIES - wrong}번 더 할 수 있어요)`;
        const my = qid;
        setTimeout(() => { if (!finished && cool.hidden && my === qid) render(600); }, 450);
      }
    });
    body.addEventListener('keydown', (e) => {
      const btns = Array.from(grid.querySelectorAll('.easy-gate-choice'));
      if (!btns.length || grid.hidden || !armed) return;
      const n = /^(Digit|Numpad)([1-9])$/.exec(e.code);
      if (n) { e.preventDefault(); if (!e.repeat) btns[Number(n[2]) - 1]?.click(); return; }
      const i = btns.indexOf(document.activeElement);
      const move = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 3, ArrowUp: -3 }[e.key];
      if (move && i >= 0) { e.preventDefault(); btns[clamp(i + move, 0, btns.length - 1)].focus(); }
    });
    m = G.ui.modal.open({
      id: 'easy-gate', size: 'sm', className: 'easy-gate-modal', title: String(opts.title || '어른 확인').slice(0, 30), icon: '🔒',
      say: '어른에게 보여 주세요. 보호자 확인이 필요해요.',
      body, actions: [{ label: '그만두기', class: 'btn-ghost', onClick: () => fin(false) }],
      onClose: () => fin(false),
    });
    if (cooldownLeft() > 0) { status.textContent = '조금 쉬었다가 어른과 다시 해요.'; showCool(); } else render();
  }

  // ================================================================ picture chooser / confirm / alert
  function pick(opts = {}) {
    return new Promise((resolve) => {
      let done = false;
      const fin = (v) => { if (!done) { done = true; resolve(v); } };
      try {
        if (!G.ui?.modal) return fin(null);
        const items = (Array.isArray(opts.items) ? opts.items : []).filter((it) => it && it.id != null).slice(0, 48);
        if (!items.length) return fin(null);
        const n = items.length;
        const cols = clamp(Math.round(Number(opts.columns) || (n <= 2 ? 2 : n <= 6 ? 3 : 4)), 2, 4);
        const grid = h('div', { class: 'easy-pick', role: 'listbox', 'aria-label': String(opts.title || '골라요').slice(0, 40) });
        grid.style.setProperty('--cols', String(cols));
        grid.style.setProperty('--cols-s', String(Math.min(cols, 3)));
        grid.style.setProperty('--cols-xs', String(Math.min(cols, 2)));
        items.forEach((it, i) => {
          const label = String(it.label ?? it.id).slice(0, 24);
          const b = h('button', {
            type: 'button', class: `easy-tile${it.disabled ? ' is-disabled' : ''}${it.selected ? ' is-selected' : ''}`, role: 'option',
            'aria-disabled': it.disabled ? 'true' : null, 'aria-selected': it.selected ? 'true' : 'false', dataset: { i: String(i) },
          },
          h('span', { class: 'et-emoji emoji', 'aria-hidden': 'true' }, String(it.emoji || '⭐').slice(0, 16)),
          h('span', { class: 'et-label' }, label),
          it.sub ? h('span', { class: 'et-sub' }, String(it.sub).slice(0, 40)) : null,
          it.badge != null && it.badge !== '' ? h('span', { class: 'et-badge' }, String(it.badge).slice(0, 6)) : null,
          it.disabled ? h('span', { class: 'et-lock emoji', 'aria-hidden': 'true' }, '🔒') : null);
          b.style.setProperty('--tile', safeColor(it.color, i));
          b.style.setProperty('--i', String(i));
          b.__easySpeak = { btn: null, text: it.say || label };
          grid.appendChild(b);
        });
        const choose = (b) => {
          const it = items[Number(b.dataset.i)];
          if (!it) return;
          if (it.disabled) { shake(b); G.sfx('wrong'); say(it.disabledSay || `${label0(it)}${hasJong(label0(it)) ? '은' : '는'} 아직 못 골라요.`, { force: true }); return; }
          b.classList.add('is-chosen');
          fin(it.id);
          setTimeout(() => m.close(), reduceMotion() ? 0 : 140);
        };
        const label0 = (it) => String(it.label ?? it.id);
        grid.addEventListener('click', (e) => { const b = e.target.closest('.easy-tile'); if (b) choose(b); });
        let sayT = 0;
        grid.addEventListener('focusin', (e) => {
          const b = e.target.closest('.easy-tile');
          let kbd = false;
          try { kbd = b ? b.matches(':focus-visible') : false; } catch (err) { kbd = false; }
          if (!kbd) return;
          clearTimeout(sayT);
          sayT = setTimeout(() => { const it = items[Number(b.dataset.i)]; if (it) say(it.say || label0(it), { force: false }); }, 140);
        });
        grid.addEventListener('keydown', (e) => {
          const tiles = Array.from(grid.querySelectorAll('.easy-tile'));
          const i = tiles.indexOf(document.activeElement);
          if (i < 0) return;
          let c = cols;
          try { const tpl = getComputedStyle(grid).gridTemplateColumns; if (tpl && tpl !== 'none') c = tpl.split(' ').filter(Boolean).length || cols; } catch (err) { c = cols; }
          const move = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: c, ArrowUp: -c, Home: -1e3, End: 1e3 }[e.key];
          if (move == null) return;
          e.preventDefault();
          tiles[clamp(i + move, 0, tiles.length - 1)].focus();
        });
        const body = h('div', { class: 'easy-pick-wrap' },
          opts.text ? h('p', { class: 'easy-pick-text' }, String(opts.text).slice(0, 160)) : null,
          grid);
        const m = G.ui.modal.open({
          id: String(opts.id || 'easy-pick').slice(0, 40), title: String(opts.title || '골라요').slice(0, 40), icon: opts.emoji || '👆',
          say: String(opts.say || opts.title || '골라요').slice(0, 140),
          size: opts.size || (n > 6 || cols >= 4 ? 'lg' : 'md'), className: `easy-pick-modal ${opts.className || ''}`, body,
          actions: [], onClose: () => fin(null),
        });
        setTimeout(() => { if (!done) (grid.querySelector('.easy-tile.is-selected') || grid.querySelector('.easy-tile:not(.is-disabled)') || grid.querySelector('.easy-tile'))?.focus({ preventScroll: true }); }, 60);
      } catch (e) {
        G.log.error('UI', 'easy.pick failed', e);
        fin(null);
      }
    });
  }

  function confirm(opts = {}) {
    return new Promise((resolve) => {
      let done = false;
      const fin = (v) => { if (!done) { done = true; resolve(v); } };
      try {
        if (!G.ui?.modal) return fin(false);
        const title = String(opts.title || '할까요?').slice(0, 80);
        const yes = h('button', { type: 'button', class: `easy-big-btn ${opts.danger ? 'easy-btn-danger' : 'easy-btn-yes'}` }, h('span', { class: 'emoji', 'aria-hidden': 'true' }, opts.danger ? '🗑️' : '⭕'), h('span', null, String(opts.yes || '좋아요').slice(0, 12)));
        const no = h('button', { type: 'button', class: 'easy-big-btn easy-btn-no' }, h('span', { class: 'emoji', 'aria-hidden': 'true' }, '❌'), h('span', null, String(opts.no || '아니요').slice(0, 12)));
        const body = h('div', { class: `easy-confirm${opts.danger ? ' danger' : ''}` },
          h('div', { class: 'ec-big emoji', 'aria-hidden': 'true' }, String(opts.emoji || (opts.danger ? '⚠️' : '🤔')).slice(0, 16)),
          h('p', { class: 'ec-title' }, title),
          opts.text ? h('p', { class: 'ec-text' }, String(opts.text).slice(0, 300)) : null,
          h('div', { class: 'ec-btns' }, no, yes));
        const m = G.ui.modal.open({ id: 'easy-confirm', size: 'sm', className: 'easy-confirm-modal', title: String(opts.heading || '확인해요').slice(0, 30), icon: opts.danger ? '⚠️' : '🙋', say: String(opts.say || title).slice(0, 140), body, actions: [], onClose: () => fin(false) });
        yes.addEventListener('click', () => { fin(true); m.close(); });
        no.addEventListener('click', () => { fin(false); m.close(); });
        setTimeout(() => (opts.danger ? no : yes).focus({ preventScroll: true }), 50);
      } catch (e) { G.log.error('UI', 'easy.confirm failed', e); fin(false); }
    });
  }

  function alertKid(opts = {}) {
    return new Promise((resolve) => {
      try {
        if (!G.ui?.modal) return resolve();
        const title = String(opts.title || '알려 줄게요').slice(0, 80);
        const ok = h('button', { type: 'button', class: 'easy-big-btn easy-btn-yes' }, h('span', { class: 'emoji', 'aria-hidden': 'true' }, '👍'), h('span', null, String(opts.ok || '알았어요').slice(0, 12)));
        const body = h('div', { class: 'easy-confirm' },
          h('div', { class: 'ec-big emoji', 'aria-hidden': 'true' }, String(opts.emoji || '💡').slice(0, 16)),
          h('p', { class: 'ec-title' }, title),
          opts.text ? h('p', { class: 'ec-text' }, String(opts.text).slice(0, 300)) : null,
          h('div', { class: 'ec-btns one' }, ok));
        const m = G.ui.modal.open({ id: 'easy-alert', size: 'sm', className: 'easy-confirm-modal', title: String(opts.heading || '알림').slice(0, 30), icon: '💬', say: String(opts.say || title).slice(0, 140), body, actions: [], onClose: () => resolve() });
        ok.addEventListener('click', () => m.close());
        setTimeout(() => ok.focus({ preventScroll: true }), 50);
      } catch (e) { G.log.error('UI', 'easy.alert failed', e); resolve(); }
    });
  }

  // ================================================================ celebrate
  let celebEl = null;
  function celebrate(text, opts = {}) {
    try {
      const rm = reduceMotion();
      if (celebEl) { celebEl.remove(); celebEl = null; }
      const emoji = String(opts.emoji || '🎉').slice(0, 16);
      const el = h('div', { class: `easy-celebrate${rm ? ' rm' : ''}`, role: 'status' },
        rm ? null : h('div', { class: 'ec-rays', 'aria-hidden': 'true' }),
        h('div', { class: 'ec-pop emoji', 'aria-hidden': 'true' }, emoji),
        text ? h('div', { class: 'ec-msg' }, String(text).slice(0, 60)) : null);
      layer().appendChild(el);
      celebEl = el;
      emit('easy:celebrate', { text: String(text || '').slice(0, 60), emoji, reduced: rm });
      if (!rm) {
        try {
          const p = G.sys.player?.position;
          if (p && G.fx?.burst) G.fx.burst({ x: p.x, y: p.y + 1.5, z: p.z }, { type: 'confetti', count: 36 });
        } catch (e) { /* fx optional */ }
      }
      G.sfx(opts.sound || 'correct');
      if (text || opts.say) say(opts.say || text, { priority: 1 });
      const dur = clamp(Number(opts.duration) || 2200, 800, 8000);
      return new Promise((resolve) => {
        setTimeout(() => {
          el.classList.add('out');
          setTimeout(() => { el.remove(); if (celebEl === el) celebEl = null; resolve(true); }, rm ? 60 : 380);
        }, dur);
      });
    } catch (e) { G.log.warn('UI', 'easy.celebrate failed', e); return Promise.resolve(false); }
  }

  // ================================================================ hand pointer (one at a time)
  const Hand = { cur: null, raf: 0 };
  let _hv = null, _hc = null;
  function resolveTarget(t) {
    if (t == null) return null;
    if (typeof t === 'string') return { sel: t };
    if (typeof Element !== 'undefined' && t instanceof Element) return { el: t };
    if (t.isObject3D) return { obj: t };
    if (Number.isFinite(t.x) && Number.isFinite(t.z)) return { x: t.x, y: Number.isFinite(t.y) ? t.y : null, z: t.z };
    return null;
  }
  function stopPoint() {
    cancelAnimationFrame(Hand.raf);
    Hand.raf = 0;
    const c = Hand.cur;
    if (!c) return;
    Hand.cur = null;
    if (c.tapEl && c.onTap) c.tapEl.removeEventListener('pointerdown', c.onTap, true);
    c.el.remove();
    c.lbl?.remove();
  }
  // ---- collision-aware placement (NEW-4): the hand and its label keep clear of the fixed HUD boxes
  const HAND_OBST = '#hud-left-menu > *, #hud-profile, #easy-next, #minimap-panel, #easy-where, #easy-chat-btn, #bottom-bar > *, #mobile-controls .joystick, #mobile-controls button, #dpad button, #chat-panel, #quest-panel, #interact-prompt, .coach-layer .coach';
  /** tip position on the target box + rotation (0 = 👆 pointing up; the hand's body extends away from the tip) */
  const HAND_DIRS = [
    { f: (r) => [r.cx, r.bottom + 2], rot: 0 },            // 0 below, pointing up
    { f: (r) => [r.cx, r.top - 2], rot: 180 },             // 1 above, pointing down
    { f: (r) => [r.right + 2, r.cy], rot: -90 },           // 2 right, pointing left
    { f: (r) => [r.left - 2, r.cy], rot: 90 },             // 3 left, pointing right
    // diagonals: a round / square-ish target is touched on its 45° rim (closer to the button, less HUD covered in a
    // crowded corner such as the phone's 👆 between 달리기 and 점프); a wide bar near its corner
    { f: (r) => (r.round ? [r.cx + r.ex, r.cy - r.ey] : [r.right - r.qx, r.top - 2]), rot: -135 },   // 4 above-right, pointing down-left
    { f: (r) => (r.round ? [r.cx - r.ex, r.cy - r.ey] : [r.left + r.qx, r.top - 2]), rot: 135 },     // 5 above-left, pointing down-right
    { f: (r) => (r.round ? [r.cx + r.ex, r.cy + r.ey] : [r.right - r.qx, r.bottom + 2]), rot: -45 },  // 6 below-right, pointing up-left
    { f: (r) => (r.round ? [r.cx - r.ex, r.cy + r.ey] : [r.left + r.qx, r.bottom + 2]), rot: 45 },   // 7 below-left, pointing up-right
  ];
  /** [distance from the fingertip along the hand, half size] of the squares that approximate the glyph */
  const HAND_CAPS = [[24, 20], [42, 22], [60, 18]];
  const HAND_PREFER_BELOW = [0, 6, 7, 2, 3, 1, 4, 5];
  const HAND_PREFER_ABOVE = [1, 4, 5, 2, 3, 0, 6, 7];
  function handObstacles(c, targetEl) {
    const t = nowMs();
    if (c.obs && t - c.obsAt < 250) return c.obs;
    const out = [];
    let list = [];
    try { list = document.querySelectorAll(HAND_OBST); } catch (e) { list = []; }
    for (const el of list) {
      if (targetEl && (el === targetEl || el.contains(targetEl) || targetEl.contains(el))) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 4 || r.height < 4 || r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) continue;
      const st = getComputedStyle(el);
      if (st.visibility === 'hidden' || st.display === 'none' || Number(st.opacity) < 0.05) continue;
      out.push(r);
    }
    c.obs = out; c.obsAt = t;
    return out;
  }
  function boxOverlap(a, b) {
    const w = Math.min(a.r, b.right) - Math.max(a.l, b.left), hh = Math.min(a.b, b.bottom) - Math.max(a.t, b.top);
    return w > 0 && hh > 0 ? w * hh : 0;
  }
  function boxOffscreen(a) {
    const vis = Math.max(0, Math.min(a.r, innerWidth) - Math.max(a.l, 0)) * Math.max(0, Math.min(a.b, innerHeight) - Math.max(a.t, 0));
    return (a.r - a.l) * (a.b - a.t) - vis;
  }
  /** the compact hand (phone bottom controls, 08-easy.css .compact) is ~2/3 the size: placement scores it as such */
  const handK = (c) => (c.compact ? 0.66 : 1);
  /** label centre distance from the tip along the hand's axis (clears the hand for sideways hands too) */
  function labelDist(c, rot) {
    const a = rot / 57.29578;
    return 84 * handK(c) + Math.max(((c.lh || 38) / 2) * Math.abs(Math.cos(a)), ((c.lw || 120) / 2) * Math.abs(Math.sin(a)));
  }
  /** sideways steps (in label half-sizes) tried for the label when the spot straight along the hand is taken */
  const LABEL_SHIFTS = [0, 0.75, -0.75, 1.4, -1.4];
  const _sb = { l: 0, r: 0, t: 0, b: 0 }, _lb = { left: 0, right: 0, top: 0, bottom: 0 }; // scratch boxes (placement runs every frame)
  function scoreBox(cx, cy, hw, hh, box, obs, wObs) {
    _sb.l = cx - hw; _sb.r = cx + hw; _sb.t = cy - hh; _sb.b = cy + hh;
    let s = boxOffscreen(_sb) * 3 + boxOverlap(_sb, box) * 1.5;
    for (const o of obs) s += boxOverlap(_sb, o) * wObs;
    return s;
  }
  /** the 👆 glyph (52 px, bobbing 2–14 px) as a short capsule of squares along the hand's axis: right for diagonal
   *  hands too (one rotated box's bounding square would reach back over the very target the finger touches) */
  function handScore(x, y, dx, dy, box, obs, k = 1) {
    let s = 0;
    for (const [d, hs] of HAND_CAPS) s += scoreBox(x + dx * d * k, y + dy * d * k, hs * k, hs * k, box, obs, 1);
    return s;
  }
  /** best label spot for a hand at (x, y) pointing along (dx, dy): straight behind the hand, else a little to the
   *  side (a label is wider than the hand, so it is usually the label that would sit on a neighbouring button) */
  function labelSpot(c, x, y, rot, dx, dy, box, obs, out) {
    const d = labelDist(c, rot), hw = c.lw / 2, hh = c.lh / 2;
    const px = -dy, py = dx; // perpendicular to the hand
    const unit = Math.abs(px) * (hw + 10) + Math.abs(py) * (hh + 10);
    let best = Infinity;
    for (const k of LABEL_SHIFTS) {
      const lx = x + dx * d + px * unit * k, ly = y + dy * d + py * unit * k;
      let sc = scoreBox(lx, ly, hw, hh, box, obs, 1.2) + Math.abs(k) * 40;
      // a shifted label must not sit on its own hand
      _lb.left = lx - hw; _lb.right = lx + hw; _lb.top = ly - hh; _lb.bottom = ly + hh;
      const hk = handK(c);
      for (const [hd, hs] of HAND_CAPS) {
        _sb.l = x + dx * hd * hk - hs * hk; _sb.r = x + dx * hd * hk + hs * hk; _sb.t = y + dy * hd * hk - hs * hk; _sb.b = y + dy * hd * hk + hs * hk;
        sc += boxOverlap(_sb, _lb) * 1.5;
      }
      if (sc < best) { best = sc; if (out) { out[0] = lx - x; out[1] = ly - y; } }
    }
    return best;
  }
  function placeScore(c, x, y, rot, box, obs, rank, lo) {
    const a = rot / 57.29578, dx = -Math.sin(a), dy = Math.cos(a);
    let s = rank * 60 + handScore(x, y, dx, dy, box, obs, handK(c));
    if (c.lbl) s += labelSpot(c, x, y, rot, dx, dy, box, obs, lo);
    return s;
  }
  /** the side of the target where hand + label cover the least HUD; sticky (switches only when clearly better) */
  function bestPlace(c, rect, targetEl, prefer) {
    const obs = handObstacles(c, targetEl);
    const box = { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
    const w = rect.right - rect.left, hgt = rect.bottom - rect.top;
    const r = {
      ...box, cx: (rect.left + rect.right) / 2, cy: (rect.top + rect.bottom) / 2, qx: Math.min(w * 0.25, 24),
      round: hgt > 0 && w / hgt >= 0.75 && w / hgt <= 1.33, ex: w * 0.3536 + 1.5, ey: hgt * 0.3536 + 1.5,
    };
    let best = null;
    prefer.forEach((di, rank) => {
      const d = HAND_DIRS[di];
      const [x, y] = d.f(r);
      const sc = placeScore(c, x, y, d.rot, box, obs, rank, null);
      if (!best || sc < best.s) best = { di, x, y, rot: d.rot, s: sc };
    });
    let di = best.di;
    if (c.place != null && c.place !== best.di && prefer.includes(c.place)) {
      const d = HAND_DIRS[c.place];
      const [x, y] = d.f(r);
      if (placeScore(c, x, y, d.rot, box, obs, prefer.indexOf(c.place), null) <= best.s + 600) di = c.place;
    }
    c.place = di;
    const d = HAND_DIRS[di];
    const [x, y] = d.f(r);
    const lo = c.lo || (c.lo = [0, 0]);
    let lblHide = false;
    if (c.lbl) {
      placeScore(c, x, y, d.rot, box, obs, 0, lo);
      // the crowded phone corner (compact hand): a "눌러요!" that would sit on another control is left out — the
      // fingertip ring shows the button and the coach card / voice say the words
      if (c.compact) {
        const lx = x + lo[0], ly = y + lo[1];
        _sb.l = lx - c.lw / 2; _sb.r = lx + c.lw / 2; _sb.t = ly - c.lh / 2; _sb.b = ly + c.lh / 2;
        lblHide = obs.some((o) => boxOverlap(_sb, o) > 24);
      }
    }
    return { x, y, rot: d.rot, edge: false, lo: c.lbl ? lo : null, lblHide };
  }
  function handPos(c) {
    const t = c.target;
    if (t.sel || t.el) {
      const el = t.el || safeQuery(t.sel);
      if (!el || !el.isConnected) return null;
      if (t.sel && !c.tapEl) { c.tapEl = el; el.addEventListener('pointerdown', c.onTap, true); }
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return null;
      const st = getComputedStyle(el);
      if (st.visibility === 'hidden' || Number(st.opacity) === 0) return null;
      // (compact first: the placement below scores the hand at the size it will be drawn)
      if (c.compactEl !== el) { c.compactEl = el; c.compact = innerWidth < 700 && !!el.closest?.('#mobile-controls, #bottom-bar, .mobile-controls, .bottom-bar'); }
      // below the target when there is room, otherwise above — then whichever side covers the least HUD (NEW-4)
      const p = bestPlace(c, r, el, r.bottom + 96 < innerHeight ? HAND_PREFER_BELOW : HAND_PREFER_ABOVE);
      p.compact = c.compact;
      return p;
    }
    const eng = G.sys.engine;
    if (!eng || !eng.camera) return null;
    if (!_hv) { _hv = new THREE.Vector3(); _hc = new THREE.Vector3(); }
    if (t.obj) {
      if (!t.obj.parent && !t.obj.isScene) return null;
      t.obj.getWorldPosition(_hv);
      _hv.y += c.offsetY ?? 1.6;
    } else {
      let y = t.y;
      if (y == null) { try { y = G.world?.heightAt?.(t.x, t.z); } catch (e) { y = 0; } y = (Number.isFinite(y) ? y : 0) + (c.offsetY ?? 1.2); }
      _hv.set(t.x, y, t.z);
    }
    const s = eng.worldToScreen(_hv);
    if (s.visible && s.y > 60 && s.y < innerHeight - 40 && s.x > 30 && s.x < innerWidth - 30) {
      return bestPlace(c, { left: s.x - 6, right: s.x + 6, top: s.y + 2, bottom: s.y + 14 }, null, HAND_PREFER_ABOVE);
    }
    // off-screen / behind the camera: an edge hand pointing towards the target (camera space direction)
    eng.camera.updateMatrixWorld();
    _hc.copy(_hv).applyMatrix4(eng.camera.matrixWorldInverse);
    let dx = _hc.x, dy = -_hc.y;
    if (!(Math.abs(dx) + Math.abs(dy) > 1e-6)) { dx = 0; dy = 1; }
    const W = innerWidth, H = innerHeight, cx = W / 2, cy = H / 2, m = 74;
    const k = Math.min((cx - m) / Math.max(1e-6, Math.abs(dx)), (cy - m) / Math.max(1e-6, Math.abs(dy)));
    return { x: cx + dx * k, y: cy + dy * k, rot: Math.atan2(dx, -dy) * 57.29578, edge: true };
  }
  function tickHand() {
    Hand.raf = 0;
    const c = Hand.cur;
    if (!c) return;
    if (c.dur && nowMs() - c.start > c.dur) { stopPoint(); return; }
    let p = null;
    try { p = handPos(c); } catch (e) { p = null; }
    if (!p) {
      c.missing++;
      if (c.missing > 150) { stopPoint(); return; }
      if (c.shown) { c.shown = false; c.el.style.opacity = '0'; if (c.lbl) c.lbl.style.opacity = '0'; }
    } else {
      c.missing = 0;
      if (!c.shown) { c.shown = true; c.el.style.opacity = ''; c.lblHide = null; }
      if (c.lbl && c.lblHide !== !!p.lblHide) { c.lblHide = !!p.lblHide; c.lbl.style.opacity = c.lblHide ? '0' : ''; }
      const x = Math.round(p.x), y = Math.round(p.y), rot = Math.round(p.rot);
      const lox = p.lo ? Math.round(p.lo[0]) : 1e9, loy = p.lo ? Math.round(p.lo[1]) : 1e9; // 1e9 = straight behind
      if (x !== c.x || y !== c.y || rot !== c.rot || lox !== c.lox || loy !== c.loy) {
        c.x = x; c.y = y; c.rot = rot; c.lox = lox; c.loy = loy;
        c.el.style.transform = `translate3d(${x}px, ${y}px, 0) rotate(${rot}deg)`;
        c.el.classList.toggle('edge', !!p.edge);
        c.el.classList.toggle('compact', !!p.compact);
        if (c.lbl) {
          // the spot chosen with the hand (bestPlace), or straight behind an edge hand
          let lx = x + lox, ly = y + loy;
          if (!p.lo) { const a = rot / 57.29578, d = labelDist(c, rot); lx = x - Math.sin(a) * d; ly = y + Math.cos(a) * d; }
          // keep the whole label on screen (8 px margin) when the hand sits near an edge
          const hw = (c.lw || 120) / 2 + 8, hh = (c.lh || 38) / 2 + 8;
          lx = Math.round(clamp(lx, hw, Math.max(hw, innerWidth - hw)));
          ly = Math.round(clamp(ly, hh, Math.max(hh, innerHeight - hh)));
          c.lbl.style.transform = `translate3d(${lx}px, ${ly}px, 0) translate(-50%, -50%)`;
        }
      }
    }
    Hand.raf = requestAnimationFrame(tickHand);
  }
  function point(target, opts = {}) {
    stopPoint();
    const t = resolveTarget(target);
    const none = { stop() {}, get active() { return false; } };
    if (!t) return none;
    try {
      const el = h('div', { class: `easy-hand${reduceMotion() ? ' rm' : ''}`, 'aria-hidden': 'true' },
        h('span', { class: 'eh-ring' }), h('span', { class: 'eh-glyph emoji' }, '👆'));
      el.style.opacity = '0';
      const lbl = opts.label ? h('div', { class: 'easy-hand-label' }, String(opts.label).slice(0, 30)) : null;
      if (lbl) lbl.style.opacity = '0';
      const L = layer();
      L.appendChild(el);
      if (lbl) L.appendChild(lbl);
      const c = {
        el, lbl, target: t, start: nowMs(), dur: opts.duration == null ? 6000 : Math.max(0, Number(opts.duration) || 0),
        x: NaN, y: NaN, rot: NaN, missing: 0, shown: false, offsetY: Number.isFinite(opts.offsetY) ? opts.offsetY : undefined, tapEl: null,
        lw: lbl ? (lbl.offsetWidth || 120) : 0, lh: lbl ? (lbl.offsetHeight || 38) : 0, place: null, obs: null, obsAt: -1e9,
      };
      const handle = { stop() { if (Hand.cur === c) stopPoint(); }, get active() { return Hand.cur === c; } };
      c.onTap = () => setTimeout(() => handle.stop(), 0); // the child followed the hint
      if (t.el) { c.tapEl = t.el; t.el.addEventListener('pointerdown', c.onTap, true); }
      Hand.cur = c;
      emit('easy:point', { label: String(opts.label || '') });
      if (opts.say) say(opts.say, { priority: 1 });
      tickHand();
      return handle;
    } catch (e) { G.log.warn('UI', 'easy.point failed', e); stopPoint(); return none; }
  }

  // ================================================================ next step (from the quest focus)
  const TYPE_EMOJI = {
    talk: '💬', visit: '🚶', visit_all: '🗺️', water: '💧', plant: '🌱', harvest: '🧺', collect: '🧺', ferment_check: '🏺',
    ferment_start: '🫙', ferment_claim: '🎉', edu: '📖', quiz: '❓', journal: '📝', photo: '📸', emote: '😊', gesture: '🙌',
    interact: '👆', craft: '🔨', chat: '💬', level: '⭐',
  };
  const ZONE_EMOJI = {
    ZONE_MAIN: '⛲', ZONE_CROP: '🌱', ZONE_HALL: '🏛️', ZONE_HERB: '🌿', ZONE_EDUCATION: '📖', ZONE_FERMENTATION: '🍲',
    ZONE_JANGDOKDAE: '🏺', ZONE_REST: '🌸', ZONE_ENTRANCE: '🚪',
  };
  const npcName = (id) => String(G.data.npcs?.[id]?.name || '안내원');
  const zoneShort = (id) => { const z = (G.data.zones || []).find((x) => x.id === id); return z ? String(z.short || z.name) : ''; };
  const itemName = (id) => String(G.data.items?.[id]?.name || '');
  const cropName = (id) => String(G.data.crops?.[id]?.name || '');

  function objectiveStep(o) {
    // an objective with authored kid wording (e.g. QUEST001 "산에서 내려가 발효마스터랑 이야기해요") keeps its pictures/actions
    let authored = typeof o.easyText === 'string' && o.easyText.trim() ? o.easyText.trim() : '';
    // "산에서 내려가 …" only makes sense while the child is still up on 정선 만장대
    if (authored && /산에서|만장대/.test(authored)) {
      const md = G.data.layout?.manjangdae, p = G.sys.player?.position;
      if (!md || !p || Math.hypot(p.x - md.x, p.z - md.z) > md.r + 4) authored = '';
    }
    if (authored && o.type !== 'craft') { const b = objectiveStepByType(o); return { ...b, text: authored, say: b.say && b.say !== b.text ? b.say : authored }; }
    return objectiveStepByType(o);
  }
  function objectiveStepByType(o) {
    switch (o.type) {
      case 'talk': { const n = npcName(o.npc); return { text: `${josa(n, '이랑/랑')} 이야기해요` }; }
      case 'visit': {
        if (o.zone) { const z = zoneShort(o.zone); if (z) return { text: `${z}에 가 봐요` }; }
        const poi = (G.data.pois || []).find((p) => p.id === o.poi);
        return { text: poi ? `${poi.name}에 가 봐요` : '반짝이는 곳에 가 봐요' };
      }
      case 'visit_all': return { text: '새로운 곳에 가 봐요' };
      case 'water': return { text: '밭에 물을 줘요' };
      case 'plant': { const c = cropName(o.crop); return { text: c ? `${c} 씨앗을 심어요` : '씨앗을 심어요' }; }
      case 'harvest': { const c = cropName(o.crop); return { text: c ? `${josa(c, '을/를')} 거둬요` : '다 자란 채소를 거둬요' }; }
      case 'collect': { const n = itemName(o.item); return { text: n ? `${josa(n, '을/를')} 모아요` : '재료를 모아요' }; }
      case 'ferment_check': return { text: '내 장독을 살펴봐요' };
      case 'ferment_start': return { text: '장독에 장을 담가요' };
      case 'ferment_claim': return fermentClaimStep(o);
      case 'edu': return { text: '그림 이야기를 봐요' };
      case 'quiz': return { text: '퀴즈를 풀어요' };
      case 'journal': return { text: '오늘 일기를 써요', act: () => G.ui.triggerAction('journal'), actLabel: '일기 쓰기', actEmoji: '📝' };
      case 'photo': {
        // a photo only counts inside a photo zone ('*' = any of them): outside one, the step walks there first
        if (o.photoZone) {
          const p = G.sys.player?.position;
          let pz = null;
          try { pz = p ? G.sys.photo?.photoZoneAt?.(p.x, p.z) : null; } catch (e) { pz = null; }
          if (!pz || (o.photoZone !== '*' && pz.id !== o.photoZone)) return { text: '사진 찍는 곳으로 가요', say: '사진 찍는 곳으로 같이 가요. 거기서 사진을 찍어요!', keyX: ':go', speakX: ':go' };
        }
        return { text: '사진을 찍어요', act: () => G.ui.triggerAction('photo'), actLabel: '사진 찍기', actEmoji: '📸', keyX: ':snap', speakX: ':snap' };
      }
      case 'emote': case 'gesture': {
        // a quest that wants ONE emote / gesture (반가운 인사 = 👋) does exactly that on the button
        const soc = G.sys.social;
        const want = o.type === 'emote' ? o.emote : o.gesture;
        const def = want ? ((o.type === 'emote' ? G.data.emotes : G.data.gestures) || []).find((x) => x.id === want) : null;
        if (def && typeof soc?.[o.type] === 'function') {
          const hello = want === 'EMO_HELLO';
          return {
            text: hello ? '손 흔들어 인사해요' : `${josa(String(def.name), '을/를')} 해 봐요`, emoji: def.icon || null,
            act: () => { if (!soc[o.type](want)) openExpress(); }, actLabel: hello ? '인사하기' : String(def.name).slice(0, 8), actEmoji: def.icon || '😊',
          };
        }
        return { text: '내 마음을 보여 줘요', act: () => openExpress(), actLabel: '표현하기', actEmoji: '😊' };
      }
      case 'chat': return { text: '친구에게 인사해요', act: () => (isOn() ? openKidChat() : G.ui.triggerAction('chat')), actLabel: '인사하기', actEmoji: '💬' };
      case 'craft': {
        // short of an ingredient (메주 = 콩 3개): collect it first — 31-quest points the marker at its bed or the shop
        const need = o.craft ? G.sys.quest?.craftNeed?.(o.craft) : null;
        const n = need ? itemName(need.item) : '';
        if (need && n) {
          const what = String(G.data.crafts?.[o.craft]?.name || '').replace(/\s*빚기$|\s*만들기$/, '');
          return {
            text: `${josa(n, '을/를')} 모아요`, say: `${what ? `${josa(what, '을/를')} 만들려면 ` : ''}${josa(n, '이/가')} ${need.need}개 필요해요. ${josa(n, '을/를')} 모아요!`,
            emoji: G.data.items?.[need.item]?.icon || null, progress: { value: Math.min(need.have, need.need), target: need.need }, keyX: `:need${need.have}`, speakX: ':need',
          };
        }
        return { text: '작업대에서 만들어요' };
      }
      case 'interact': return { text: '반짝이는 것을 눌러 봐요' };
      case 'level': return { text: '더 놀면서 별을 모아요' };
      default: return { text: '금빛 표시를 따라가요' };
    }
  }
  /** "다 익은 장을 꺼내요" only when one of MY jars holds it ripe; a batch on the way says wait, no batch says start one */
  function fermentClaimStep(o) {
    const fe = G.sys.fermentation;
    let jars = [];
    try { jars = (fe?.myJarIds?.() || ['J1']).map((id) => fe?.getJar?.(id)).filter(Boolean); } catch (e) { jars = []; }
    const recipe = String(G.data.recipes?.[o.recipe]?.name || '').replace(/\s*체험$/, '').trim() || '장';
    if (!jars.length) return { text: `다 익은 ${josa(recipe, '을/를')} 꺼내요` };
    // jar 1 holds the gifted starter batch before its state exists
    const rid = (j) => j.recipeId ?? (j.id === 'J1' && !j.state ? (G.data.fermentation?.starterRecipe || 'FER001') : null);
    const ours = jars.filter((j) => !o.recipe || rid(j) === o.recipe);
    if (ours.some((j) => j.status === 'COMPLETE')) return { text: `다 익은 ${josa(recipe, '을/를')} 꺼내요`, keyX: ':ripe', speakX: ':ripe' };
    if (ours.some((j) => ['PREPARING', 'FERMENTING', 'AGING'].includes(j.status))) {
      return { text: `${josa(recipe, '이/가')} 익을 때까지 기다려요`, emoji: '⏳', say: `${josa(recipe, '이/가')} 익고 있어요. 다른 놀이를 하다가 다시 와요!`, keyX: ':wait', speakX: ':wait' };
    }
    return { text: `장독에 ${josa(recipe, '을/를')} 담가요`, emoji: '🫙', say: `장독에 ${josa(recipe, '을/를')} 담가요. 다 익으면 꺼내요!`, keyX: ':start', speakX: ':start' };
  }
  function exploreStep() {
    return { key: 'explore', speakKey: 'explore', emoji: '🗺️', text: '구경해요', say: '어디로 가 볼까요? 지도를 눌러 골라요.', target: null, act: () => openWhere(), actLabel: '어디 갈까?', actEmoji: '🗺️', progress: null };
  }
  function nextStep() {
    try {
      if (!G.state) return exploreStep();
      const f = G.sys.quest?.focus?.();
      if (!f || !f.questId) return exploreStep();
      const q = G.data.quests?.[f.questId];
      if (!q) return exploreStep();
      const e = G.state.quests?.[f.questId] || {};
      const tg = f.target && Number.isFinite(f.target.x) && Number.isFinite(f.target.z) ? { x: f.target.x, z: f.target.z, label: String(f.target.label || '') } : null;
      if (f.mode === 'claim') {
        const qid = f.questId;
        return {
          key: `claim:${qid}`, speakKey: `claim:${qid}`, emoji: '🎁', text: '잘했어요! 선물을 받아요', say: '잘했어요! 선물 받기를 눌러요.', target: null,
          act: () => { try { G.sys.quest?.claim?.(qid); } catch (err) { G.log.warn('QUEST', 'claim failed', err); } }, actLabel: '선물 받기', actEmoji: '🎁', progress: null,
        };
      }
      if (f.mode === 'giver') {
        const n = npcName(q.giver);
        return { key: `giver:${f.questId}`, speakKey: `giver:${f.questId}`, emoji: '🙋', text: `${n}에게 가요`, say: `${n}에게 가서 인사해요.`, target: tg, progress: null };
      }
      const i = Number(f.objective);
      const o = q.objectives?.[i];
      if (!o) return exploreStep();
      const base = objectiveStep(o);
      const target = Number(o.count) > 1 ? Math.round(Number(o.count)) : 1;
      const value = clamp(Math.round(Number(e.progress?.[i]) || 0), 0, target);
      return {
        key: `obj:${f.questId}:${i}:${value}${base.keyX || ''}`, speakKey: `obj:${f.questId}:${i}${base.speakX || ''}`,
        emoji: base.emoji || TYPE_EMOJI[o.type] || '⭐', text: base.text, say: base.say || base.text,
        target: base.act ? null : tg, act: base.act || null, actLabel: base.actLabel, actEmoji: base.actEmoji,
        progress: base.progress || (target > 1 ? { value, target } : null), questId: f.questId, type: o.type,
      };
    } catch (err) {
      G.log.warn('UI', 'easy.nextStep failed', err);
      return exploreStep();
    }
  }

  // ================================================================ go to (auto-walk / travel)
  const Walk = { cur: null };
  function finishWalk(ok, reason) {
    const w = Walk.cur;
    if (!w) return;
    Walk.cur = null;
    hudRefreshSoon();
    try { w.resolve(ok); } catch (e) { /* ignore */ }
    if (ok) {
      say(!w.label ? '도착했어요!' : w.person ? `${w.label} 옆에 왔어요!` : `${w.label}에 도착했어요!`, { priority: 1 });
      setTimeout(() => {
        const p = document.getElementById('interact-prompt');
        if (p && !p.hidden && isOn()) point(p, { label: '눌러요!', duration: 4500 });
      }, 420);
    } else if (reason === 'stuck') {
      say('앗, 길이 막혔어요. 다른 길로 가 봐요!', { priority: 1 });
    }
  }
  function goTo(target, opts = {}) {
    return new Promise((resolve) => {
      try {
        const pl = G.sys.player;
        if (!G.state || !pl) return resolve(false);
        if (G.sys.dialogue?.active) { G.ui.toast('이야기가 끝나면 같이 가요.', { emoji: '💬', type: 'info' }); return resolve(false); }
        const mm = G.sys.minimap;
        if (typeof target === 'string') {
          if (mm?.travelTo) { Promise.resolve(mm.travelTo(target)).then((ok) => resolve(!!ok), () => resolve(false)); return; }
          const z = G.world?.zoneById?.(target);
          if (!z || !Array.isArray(z.center)) return resolve(false);
          target = { x: z.center[0], z: z.center[1], label: z.short || z.name };
        }
        if (!target || !Number.isFinite(target.x) || !Number.isFinite(target.z) || typeof pl.walkTo !== 'function') return resolve(false);
        if (Walk.cur) finishWalk(false, 'replaced');
        const label = String(opts.label ?? target.label ?? '').slice(0, 20);
        const person = !!opts.person; // walking to a friend: "친구에게 같이 가요!" / "친구 옆에 왔어요!" (places: 로 / 에)
        const dest = { x: target.x, z: target.z };
        const zoneFor = () => { try { const z = G.world?.zoneAt?.(dest.x, dest.z); return z && (G.data.zones || []).some((x) => x.id === z.id) ? z : null; } catch (e) { return null; } };
        const travelFirst = async () => {
          const z = zoneFor();
          if (!z || !mm?.travelTo) return false;
          const a = mm.arrivalFor?.(z.id);
          const p = pl.position;
          if (a && Math.hypot(a.x - dest.x, a.z - dest.z) >= Math.hypot(p.x - dest.x, p.z - dest.z) * 0.6) return false;
          return !!(await mm.travelTo(z.id));
        };
        const start = (allowRetry) => {
          const d = Math.hypot(dest.x - pl.position.x, dest.z - pl.position.z);
          const w = { id: 0, target: dest, label, person, resolve };
          Walk.cur = w;
          const id = pl.walkTo(dest, {
            stopDistance: Number.isFinite(opts.stopDistance) ? opts.stopDistance : 1.8, run: d > (Number(pl.WALK) || 9.6) * 2.5,
            onArrive: () => { if (Walk.cur === w) finishWalk(true); },
            onFail: (reason) => {
              if (Walk.cur !== w) return;
              if (reason === 'stuck' && allowRetry) {
                Walk.cur = null;
                travelFirst().then((ok) => { if (ok) start(false); else { Walk.cur = w; finishWalk(false, 'stuck'); } }, () => { Walk.cur = w; finishWalk(false, 'stuck'); });
                return;
              }
              finishWalk(false, reason);
            },
          });
          if (!id) { finishWalk(false, 'refused'); return; }
          w.id = id;
          try { (G.interact?.showDest || G.interact?._showDest)?.call(G.interact, dest.x, dest.z, false); } catch (e) { /* marker optional */ }
          hudRefreshSoon();
        };
        const far = Math.hypot(dest.x - pl.position.x, dest.z - pl.position.z);
        // up on 정선 만장대 the guided trip walks down the switchback path (it is the point of starting there, and
        // takes ~12 s at the new speed); farther goals, or a walk that gets stuck, still use fast travel
        const md = G.data.layout?.manjangdae;
        const onHill = !!md && Math.hypot(pl.position.x - md.x, pl.position.z - md.z) < md.r + 3;
        if (far > (onHill ? 170 : 70)) travelFirst().then(() => start(true), () => start(true));
        else start(true);
        if (label) say(person ? `${label}에게 같이 가요!` : `${josa(label, '으로/로')} 같이 가요!`, { priority: 1 });
        else say('같이 가요!', { priority: 1 });
      } catch (e) {
        G.log.warn('PLAYER', 'easy.goTo failed', e);
        resolve(false);
      }
    });
  }

  async function travelMenu() {
    if (!G.state) return null;
    const here = G.sys.minimap?.currentZone?.id || G.state.player?.zoneId || null;
    let marks = [];
    try { marks = G.sys.quest?.getMarkers?.() || []; } catch (e) { marks = []; }
    const zs = (G.data.zones || []).filter((z) => z && z.id && Array.isArray(z.center) && z.r > 0);
    const items = zs.map((z, i) => {
      const goal = marks.some((m) => m && m.primary && Number.isFinite(m.x) && Math.hypot(m.x - z.center[0], m.z - z.center[1]) <= z.r + 2);
      const name = String(z.short || z.name);
      return { id: z.id, emoji: ZONE_EMOJI[z.id] || z.emoji || '📍', label: name, color: KID_COLORS[i % KID_COLORS.length], badge: here === z.id ? '📍' : goal ? '⭐' : null, selected: here === z.id, say: here === z.id ? `${name}. 지금 여기 있어요.` : goal ? `${name}. 금빛 별이 있는 곳이에요.` : name };
    });
    if (!items.length) return null;
    const id = await pick({ id: 'easy-where', title: '어디 갈까?', emoji: '🗺️', say: '어디로 갈까요? 그림을 눌러요.', items, columns: 3 });
    if (!id) return null;
    if (id === here) { say('지금 여기에 있어요!', { force: true }); return id; }
    await goTo(id);
    return id;
  }

  // ================================================================ kid-safe nickname ideas
  const NAME_ADJ = ['용감한', '씩씩한', '반짝이는', '신나는', '노래하는', '춤추는', '웃는', '행복한', '다정한', '똑똑한', '날쌘', '포근한', '귀여운', '상냥한', '부지런한', '튼튼한', '말랑한', '동글동글', '꼬마', '명랑한', '폴짝', '방긋', '깡충', '보들보들'];
  const NAME_NOUN = ['다람쥐', '토끼', '고양이', '강아지', '펭귄', '판다', '코알라', '햄스터', '병아리', '오리', '거북이', '아기곰', '여우', '사슴', '수달', '고래', '돌고래', '부엉이', '너구리', '메주', '콩알', '항아리', '장독', '누룩', '김치', '고추', '배추', '된장', '옹기', '감자', '고구마', '당근', '호박'];
  const RX_NICK_OK = /^[가-힣A-Za-z0-9_]{2,12}$/;
  function nameIdeas(n = 6) {
    const count = clamp(Math.floor(Number(n) || 6), 1, 24);
    const bad = (G.data.badWords || []).map((w) => String(w).toLowerCase()).filter(Boolean);
    const out = new Set();
    let guard = 0;
    while (out.size < count && guard++ < 400) {
      const name = U.pick(NAME_ADJ) + U.pick(NAME_NOUN);
      if (!RX_NICK_OK.test(name) || Array.from(name).length > 12) continue;
      const low = name.toLowerCase();
      if (bad.some((w) => low.includes(w))) continue;
      out.add(name);
    }
    return Array.from(out);
  }

  // ================================================================ healthy play: reminder card + rest screen
  const Play = { active: 0, lastInput: nowMs(), saveAcc: 0, card: null, cardTimer: 0, last: 0 };
  try { const v = Number(sessionStorage.getItem(SS_PLAY)); if (Number.isFinite(v) && v > 0) Play.active = Math.min(v, 6 * 3600); } catch (e) { /* storage blocked */ }
  const markInput = () => { Play.lastInput = nowMs(); };
  for (const ev of ['pointerdown', 'keydown', 'wheel', 'touchstart']) window.addEventListener(ev, markInput, { capture: true, passive: true });
  function persistPlay() { try { sessionStorage.setItem(SS_PLAY, String(Math.round(Play.active))); } catch (e) { /* storage blocked */ } }
  function hideReminder() {
    clearTimeout(Play.cardTimer);
    if (!Play.card) return;
    const c = Play.card; Play.card = null;
    c.classList.add('out');
    setTimeout(() => c.remove(), 260);
    emit('easy:remind', { open: false });
  }
  function showReminder() {
    hideReminder();
    const min = Math.round(Number(S().playReminderMin) || 30);
    const rest = h('button', { type: 'button', class: 'easy-big-btn easy-btn-yes' }, h('span', { class: 'emoji', 'aria-hidden': 'true' }, '😴'), h('span', null, '쉬기'));
    const goOn = h('button', { type: 'button', class: 'easy-big-btn easy-btn-no' }, h('span', { class: 'emoji', 'aria-hidden': 'true' }, '▶️'), h('span', null, '계속'));
    const card = h('div', { class: 'easy-rest-card', role: 'dialog', 'aria-label': '쉬는 시간 알림' },
      faceEl('sleepy', 64, '😴'),
      h('div', { class: 'erc-main' }, h('b', null, `${min}분 동안 신나게 놀았어요!`), h('span', null, '잠깐 눈을 쉬어 볼까요?')),
      h('div', { class: 'erc-btns' }, rest, goOn));
    rest.addEventListener('click', () => { openRest(); }); // openRest hides this card once the rest screen is up
    goOn.addEventListener('click', () => { hideReminder(); say('좋아요! 조금만 더 놀아요.', { priority: 1 }); });
    layer().appendChild(card);
    Play.card = card;
    Play.cardTimer = setTimeout(hideReminder, 45000);
    emit('easy:remind', { open: true });
    G.sfx('notify');
    say(`${min}분 동안 신나게 놀았어요! 잠깐 쉬어 볼까요?`, { priority: 1 });
    return card;
  }
  const Rest = { el: null, timers: [], offEsc: null };
  function closeRest() {
    if (!Rest.el) return;
    for (const t of Rest.timers) clearInterval(t);
    Rest.timers.length = 0;
    Rest.offEsc?.(); Rest.offEsc = null;
    const el = Rest.el; Rest.el = null;
    el.classList.add('out');
    setTimeout(() => el.remove(), 320);
    G.ui.unblock('easy-rest');
    try { G.sys.audio?.unduck?.('easy-rest'); } catch (e) { /* audio optional */ }
    Play.active = 0; persistPlay();
    emit('easy:rest', { open: false });
  }
  function openRest() {
    if (Rest.el) return Rest.el;
    let left = 20;
    const step = h('p', { class: 'er-step' }, '숨을 크게 들이쉬어요');
    const btnLbl = h('span', null, `다시 놀기 (${left})`);
    const btn = h('button', { type: 'button', class: 'easy-big-btn easy-btn-yes er-done' }, h('span', { class: 'emoji', 'aria-hidden': 'true' }, '▶️'), btnLbl);
    const el = h('div', { class: `easy-rest${reduceMotion() ? ' rm' : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': '쉬는 시간' },
      h('div', { class: 'er-card' },
        h('div', { class: 'er-face' }, faceEl('sleepy', 112, '😴')),
        h('h2', null, '쉬는 시간이에요'),
        h('div', { class: 'er-breath', 'aria-hidden': 'true' }, h('span', { class: 'er-ball' })),
        step,
        h('ul', { class: 'er-tips' },
          h('li', null, h('span', { class: 'emoji' }, '👀'), '먼 곳을 바라봐요'),
          h('li', null, h('span', { class: 'emoji' }, '🙆'), '기지개를 켜요'),
          h('li', null, h('span', { class: 'emoji' }, '💧'), '물을 마셔요')),
        btn));
    btn.addEventListener('click', closeRest);
    layer().appendChild(el);
    Rest.el = el;
    hideReminder(); // after the rest screen exists, so listeners see card -> rest (not card -> nothing -> rest)
    G.ui.block('easy-rest');
    emit('easy:rest', { open: true });
    Rest.offEsc = G.ui.onEscape(() => { closeRest(); return true; }, 160);
    try { G.sys.audio?.duck?.('easy-rest', 0.2); } catch (e) { /* audio optional */ }
    let inhale = true;
    Rest.timers.push(setInterval(() => { inhale = !inhale; step.textContent = inhale ? '숨을 크게 들이쉬어요' : '천천히 내쉬어요'; }, 4000));
    Rest.timers.push(setInterval(() => { left = Math.max(0, left - 1); btnLbl.textContent = left ? `다시 놀기 (${left})` : '다시 놀기'; }, 1000));
    setTimeout(() => btn.focus({ preventScroll: true }), 60);
    say('쉬는 시간이에요. 숨을 크게 들이쉬고, 천천히 내쉬어요.', { priority: 2 });
    return el;
  }
  function playTick() {
    // real (wall-clock) seconds, not the frame dt: the engine clamps dt to 0.1 s, so a device under 10 fps would count
    // play time too slowly and the "take a rest" card would come late. A longer gap (hidden tab, stall) counts 5 s.
    const t = nowMs();
    const dt = Play.last ? Math.min(5, Math.max(0, (t - Play.last) / 1000)) : 0;
    Play.last = t;
    const min = Number(S().playReminderMin) || 0;
    if (!min || !isOn() || !G.state || !G.ready || document.hidden || Play.card || Rest.el) return;
    if (!document.body.classList.contains('in-game')) return;
    if (t - Play.lastInput > 90000) return; // idle: not active play
    Play.active += dt;
    Play.saveAcc += dt;
    if (Play.saveAcc > 15) { Play.saveAcc = 0; persistPlay(); }
    if (Play.active >= min * 60) { Play.active = 0; persistPlay(); showReminder(); }
  }

  // ================================================================ HUD wiring (easy-mode layout, §12.3)
  // throttles use wall-clock time (not the clamped frame dt) so slow devices still refresh promptly
  const Hud = { bound: false, el: null, emo: null, text: null, pips: null, go: null, goEmo: null, goLbl: null, mode: '', key: '', speakKey: '', pendingSay: null, pendingAt: 0, stepAt: -1e9, badgeAt: -1e9, badge: -1, step: null, lvObs: null, goAt: -1e9 };
  function hudRefreshSoon() { Hud.key = ''; Hud.stepAt = -1e9; }

  function openExpress(anchor) {
    const soc = G.sys.social;
    const a = anchor && anchor.isConnected ? anchor : document.querySelector('#bottom-bar [data-action="express"]');
    if (soc?.openExpress) return soc.openExpress(a);
    if (soc?.openEmotes) return soc.openEmotes(a);
    G.ui.toast('지금은 표현하기를 쓸 수 없어요.', { emoji: '😊', type: 'info' });
    return null;
  }
  function openWhere() {
    const mm = G.sys.minimap;
    if (mm?.openPictureTravel) return mm.openPictureTravel();
    return travelMenu();
  }
  function openStickerbook() {
    const pr = G.sys.progression;
    if (pr?.openHub) return pr.openHub();
    if (pr?.openCollection) return pr.openCollection();
    G.ui.toast('스티커북을 준비하고 있어요.', { emoji: '📖', type: 'info' });
    return null;
  }
  /** 💬 (easy mode): the social module's kid phrase picker when it has one, otherwise the chat log via body.show-chat */
  function openKidChat(anchor) {
    const soc = G.sys.social;
    if (soc?.openKidChat) return soc.openKidChat(anchor);
    const b = document.body;
    const on = !b.classList.contains('show-chat');
    b.classList.toggle('show-chat', on);
    b.classList.remove('show-quests');
    G.ui.setActive('kid-chat', on);
    if (on) { try { soc?._markRead?.(); } catch (e) { /* social optional */ } }
    return on;
  }
  function openToday() {
    const en = G.sys.engagement;
    if (en?.open) return en.open();
    G.ui.toast('오늘의 놀이를 준비하고 있어요.', { emoji: '🔔', type: 'info' });
    return null;
  }
  function syncSoundBtn() {
    const b = document.getElementById('easy-sound-btn');
    if (!b) return;
    const muted = !!S().muted;
    const e = b.querySelector('.bb-emo');
    if (e) e.textContent = muted ? '🔇' : '🔊';
    const l = b.querySelector('.lbl');
    if (l) l.textContent = muted ? '조용히' : '소리';
    b.setAttribute('aria-pressed', muted ? 'false' : 'true');
    b.setAttribute('aria-label', muted ? '소리 켜기' : '소리 끄기');
    b.classList.toggle('is-muted', muted);
  }
  function toggleSound() {
    const muted = !S().muted;
    G.setSetting('muted', muted);
    syncSoundBtn();
    if (muted) Voice.stop();
    else setTimeout(() => say('소리를 켰어요!', { force: true }), 60);
  }
  function syncLevelChip() {
    const el = document.getElementById('hud-level');
    if (!el) return;
    const m = /(\d+)/.exec(el.textContent || '');
    const n = m ? m[1] : '1';
    if (el.dataset.n !== n) el.dataset.n = n;
  }

  function bindHud() {
    if (Hud.bound) return;
    Hud.bound = true;
    const A = G.ui;
    A.onAction('easy-go', () => onGo());
    A.onAction('easy-read', () => { const st = Hud.step || nextStep(); say(st.say || st.text, { force: true, priority: 1 }); });
    A.onAction('express', (el) => openExpress(el));
    A.onAction('sound', () => toggleSound());
    A.onAction('stickerbook', () => openStickerbook());
    A.onAction('today', () => openToday());
    A.onAction('where', () => openWhere());
    A.onAction('kid-chat', (el) => openKidChat(el));
    Hud.el = document.getElementById('easy-next');
    if (Hud.el) {
      Hud.emo = Hud.el.querySelector('.en-emoji');
      Hud.text = Hud.el.querySelector('.en-text');
      Hud.pips = Hud.el.querySelector('.en-pips');
      Hud.go = Hud.el.querySelector('.en-go');
      Hud.goEmo = Hud.go?.querySelector('.emoji');
      Hud.goLbl = Hud.go?.querySelector('.en-go-lbl');
      Hud.el.__easySpeak = { btn: null, text: () => (Hud.step ? Hud.step.say || Hud.step.text : '') };
    }
    const lv = document.getElementById('hud-level');
    if (lv && typeof MutationObserver !== 'undefined') {
      Hud.lvObs = new MutationObserver(syncLevelChip);
      Hud.lvObs.observe(lv, { childList: true, characterData: true, subtree: true });
    }
    syncLevelChip();
    syncSoundBtn();
  }

  function onGo() {
    // children double tap: the second tap (40–500 ms later) must not stop the walk the first one just started
    const t = nowMs();
    if (t - Hud.goAt < 650) return;
    Hud.goAt = t;
    const st = Hud.step || nextStep();
    if (Walk.cur) {
      const w = Walk.cur;
      try { G.sys.player?.cancelWalk?.('manual'); } catch (e) { /* ignore */ }
      if (Walk.cur === w) finishWalk(false, 'manual');
      say('멈췄어요.', { force: true });
      return;
    }
    if (st.act) { try { st.act(); } catch (e) { G.log.warn('UI', 'next step action failed', e); } return; }
    if (st.target) { goTo(st.target, { label: '' }); return; }
    openWhere();
  }

  function renderStep(st) {
    if (!Hud.el) return;
    const changed = st.speakKey !== Hud.speakKey;
    Hud.emo.textContent = st.emoji;
    Hud.text.textContent = st.text;
    // progress as pictures (●●○) instead of numbers where it fits
    if (Hud.pips) {
      Hud.pips.textContent = '';
      const p = st.progress;
      if (p && p.target > 1) {
        Hud.pips.hidden = false;
        if (p.target <= 6) for (let i = 0; i < p.target; i++) Hud.pips.appendChild(h('i', { class: i < p.value ? 'on' : '' }));
        else Hud.pips.appendChild(h('b', null, `${p.value} / ${p.target}`));
        Hud.pips.setAttribute('aria-label', `${p.target}개 중에 ${p.value}개 했어요`);
      } else Hud.pips.hidden = true;
    }
    let mode = '';
    if (Walk.cur) mode = 'stop';
    else if (st.act) mode = 'act';
    else if (st.target) mode = 'go';
    Hud.mode = mode;
    if (Hud.go) {
      Hud.go.hidden = !mode;
      Hud.go.dataset.mode = mode;
      if (Hud.goEmo) Hud.goEmo.textContent = mode === 'stop' ? '✋' : mode === 'act' ? (st.actEmoji || '👉') : '👉';
      if (Hud.goLbl) Hud.goLbl.textContent = mode === 'stop' ? '멈춰' : mode === 'act' ? (st.actLabel || '하기') : '같이 가기';
    }
    Hud.el.dataset.type = st.type || st.key.split(':')[0];
    Hud.el.hidden = false;
    if (changed) {
      Hud.el.classList.remove('bump'); void Hud.el.offsetWidth; Hud.el.classList.add('bump');
      Hud.speakKey = st.speakKey;
      Hud.pendingSay = st.say || st.text;
      Hud.pendingAt = nowMs();
    }
  }

  function hudTick(dt) {
    if (!isOn() || !G.state) return;
    // a walk replaced by a click elsewhere / a teleport never calls our callbacks: notice it here
    const w = Walk.cur;
    if (w && w.id) {
      const pl = G.sys.player;
      const pw = pl ? pl._walk : null;
      const still = pw !== undefined ? !!(pw && pw.id === w.id) : !!pl?.isWalking;
      if (!still) finishWalk(false, 'replaced');
    }
    const t = nowMs();
    if (t - Hud.stepAt >= 450) {
      Hud.stepAt = t;
      const st = nextStep();
      Hud.step = st;
      const key = `${st.key}|${Walk.cur ? 'w' : ''}`;
      if (key !== Hud.key) { Hud.key = key; renderStep(st); }
    }
    // speak a new step when nothing else is on screen (modal / dialogue / coach)
    if (Hud.pendingSay) {
      if (nowMs() - Hud.pendingAt > 20000) Hud.pendingSay = null;
      else if (!G.ui.isBlocking() && !G.sys.dialogue?.active && !document.querySelector('.coach-layer .coach') && !Voice.cur) {
        const t = Hud.pendingSay; Hud.pendingSay = null;
        say(t, { interrupt: false });
      }
    }
    if (t - Hud.badgeAt >= 2000) {
      Hud.badgeAt = t;
      let n = 0;
      try { n = Number(G.sys.engagement?.unreadCount?.()) || 0; } catch (e) { n = 0; }
      if (n !== Hud.badge) { Hud.badge = n; G.ui.setBadge('today', n); }
    }
  }

  // ================================================================ on/off
  let lastOn = isOn();
  function syncOn() {
    const on = isOn();
    if (on === lastOn) return;
    lastOn = on;
    hudRefreshSoon(); Hud.speakKey = ''; Hud.pendingSay = null;
    if (!on) { Voice.stop(); stopPoint(); hideReminder(); if (celebEl) { celebEl.remove(); celebEl = null; } }
    try { G.ui.popover?.close?.(); } catch (e) { /* ignore */ }
    emit('easy:changed', { on });
  }
  async function setEasy(on) {
    on = !!on;
    if (on === isOn()) { syncOn(); return true; }
    if (!on) {
      const ok = await gate({ reason: 'easy-off', title: '쉬운 모드 끄기' });
      if (!ok) return false;
    }
    G.setSetting('easyMode', on);
    syncOn();
    if (on) say('쉬운 모드를 켰어요!', { priority: 1 });
    return true;
  }

  G.bus.on('settings:changed', ({ key } = {}) => {
    if (key === 'easyMode') syncOn();
    else if (key === 'muted') { syncSoundBtn(); if (S().muted) Voice.stop(); }
    else if (key === 'voiceGuide' && S().voiceGuide === false) Voice.stop();
    else if (key === 'playReminderMin' && !(Number(S().playReminderMin) > 0)) hideReminder();
  });
  G.bus.on('state:loaded', () => { syncOn(); syncSoundBtn(); hudRefreshSoon(); Hud.speakKey = ''; });
  // quest changes re-render the card right away instead of waiting for the next poll
  for (const ev of ['quest:accepted', 'quest:progress', 'quest:completed', 'quest:claimed']) G.bus.on(ev, () => { Hud.stepAt = -1e9; });
  document.addEventListener('visibilitychange', () => { if (document.hidden) Voice.stop(); });

  // ================================================================ public API
  G.easy = {
    get on() { return isOn(); },
    set: setEasy,
    say,
    stop: () => Voice.stop(),
    get speaking() { return !!Voice.cur; },
    speakable,
    textOf,
    gate,
    gateStatus,
    lockGate,
    pick,
    confirm,
    alert: alertKid,
    celebrate,
    point,
    stopPoint,
    nextStep,
    goTo,
    travelMenu,
    t: (normalText, easyText) => (isOn() && easyText != null ? easyText : normalText),
    nameIdeas,
    rest: openRest,
    remind: showReminder,
    get playSeconds() { return Math.round(Play.active); },
    josa,
    // internals exposed for the developer center self-tests
    _gateQuestion: gateQuestion,
    _gateSim: gateSim,
    _speechText: speechText,
    _voice: Voice,
  };

  G.register({
    name: 'easy', order: 88, label: '쉬운 모드',
    init() { bindHud(); },
    onStateLoaded() { hudRefreshSoon(); Hud.speakKey = ''; Hud.badge = -1; Hud.badgeAt = -1e9; syncLevelChip(); },
    update(dt) {
      hudTick(dt);
      playTick();
    },
    onLogout() {
      Voice.stop();
      stopPoint();
      hideReminder();
      closeRest();
      if (Walk.cur) { const w = Walk.cur; Walk.cur = null; try { w.resolve(false); } catch (e) { /* ignore */ } }
      lockGate();
      Hud.key = ''; Hud.speakKey = ''; Hud.step = null; Hud.pendingSay = null; Hud.badge = -1;
      if (Hud.el) Hud.el.hidden = true;
    },
  });
})();
