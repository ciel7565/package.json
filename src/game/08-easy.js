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
//   G.easy.gate({reason, title}) -> Promise<bool>   parent gate (2-digit × 1-digit, 4 choices, cool-down)
//   G.easy.gateStatus() / G.easy.lockGate()
//   G.easy.pick({title, say, emoji, items:[{id, emoji, label, color?, disabled?, badge?, say?, sub?}], columns})
//        -> Promise<id|null>              big picture chooser (Esc / ⬅️ → null)
//   G.easy.confirm({emoji, title, text, say, yes, no, danger}) -> Promise<bool>
//   G.easy.alert({emoji, title, text, say, ok}) -> Promise<void>
//   G.easy.celebrate(text, {emoji, say, duration, sound}) -> Promise
//   G.easy.point(target, {label, say, duration=6000, offsetY}) -> {stop(), active}   target: Element | selector |
//        {x, y?, z} | Object3D ; one hand at a time ; G.easy.stopPoint()
//   G.easy.nextStep() -> {key, emoji, text, say, target:{x,z,label}|null, act?, actLabel?, actEmoji?, progress?}
//   G.easy.goTo(target {x,z} | zoneOrPoiId, {label, stopDistance}) -> Promise<bool>   (auto-walk / travel)
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
  const GATE_UNLOCK = 5 * 60 * 1000;
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
  /** josa('콩', '을/를') -> '콩을' */
  function josa(word, pair) { const [a, b] = String(pair).split('/'); return `${word}${hasJong(word) ? a : b}`; }

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
    q: [], cur: null, recent: new Map(), voice: null, cancelAt: -1e9, mutedHintAt: -1e9,
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
      Voice.recent.set(clean, t);
      emit('easy:say', { text: clean });
      if (!Voice.ok()) return Promise.resolve(false);
      return new Promise((resolve) => Voice.enqueue({ text: clean, resolve, priority: Number(opts.priority) || 0, interrupt: opts.interrupt !== false, rate: opts.rate }));
    } catch (e) {
      G.log.debug('UI', 'easy.say failed', e);
      return Promise.resolve(false);
    }
  }

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
  const Gate = { unlockUntil: 0, wrong: 0, pending: null };
  /** persisted gate state: cool-down end, failed rounds (doubling) and the wrong answers of the current round
   *  (so a reload between wrong taps does not hand out fresh tries). Wrong answers older than 10 min expire. */
  const GATE_WRONG_TTL = 10 * 60 * 1000;
  function gateLoad() {
    try {
      const o = JSON.parse(localStorage.getItem(LS_GATE) || 'null');
      if (o && typeof o === 'object') {
        const wt = Number(o.wt) || 0;
        const fresh = wt > 0 && Date.now() - wt < GATE_WRONG_TTL && Date.now() >= wt;
        return { until: Number(o.until) || 0, strikes: clamp(Math.floor(Number(o.strikes) || 0), 0, 10), wrong: fresh ? clamp(Math.floor(Number(o.wrong) || 0), 0, GATE_TRIES) : 0, wt: fresh ? wt : 0 };
      }
    } catch (e) { /* corrupt -> reset */ }
    return { until: 0, strikes: 0, wrong: 0, wt: 0 };
  }
  function gateSave(o) {
    const wrong = clamp(Math.floor(Number(o.wrong) || 0), 0, GATE_TRIES);
    try {
      localStorage.setItem(LS_GATE, JSON.stringify({
        until: Math.round(Number(o.until) || 0), strikes: clamp(Math.floor(Number(o.strikes) || 0), 0, 10),
        wrong, wt: wrong > 0 ? Date.now() : 0,
      }));
    } catch (e) { /* storage blocked */ }
  }
  /** remaining cool-down (ms). A clock moved backwards cannot make it longer than the cap. */
  function cooldownLeft() { return clamp(gateLoad().until - Date.now(), 0, GATE_COOLDOWN_MAX); }

  /** a × b with a 2-digit and b 1-digit; 4 shuffled, plausible, positive, distinct choices */
  function gateQuestion() {
    const a = U.randInt(12, 98), b = U.randInt(3, 9);
    const answer = a * b;
    const pool = [];
    for (const c of U.shuffle([answer + b, answer - b, answer + 10, answer - 10, answer + a, answer - a, answer + 2 * b, answer - 2 * b, answer + 20, answer - 20])) {
      if (c > 0 && c !== answer && !pool.includes(c)) pool.push(c);
      if (pool.length >= 3) break;
    }
    return { a, b, answer, choices: U.shuffle([answer, ...pool]) };
  }

  function gateStatus() {
    Gate.wrong = Math.max(Gate.wrong, gateLoad().wrong);
    return { unlocked: nowMs() < Gate.unlockUntil, unlockLeft: Math.max(0, Gate.unlockUntil - nowMs()), cooldownLeft: cooldownLeft(), wrong: Gate.wrong, open: !!Gate.pending, required: isOn() && S().parentGate !== false };
  }
  function lockGate() { Gate.unlockUntil = 0; }

  function gate(opts = {}) {
    const reason = String(opts.reason || 'settings').slice(0, 40);
    const finish = (ok, extra) => { emit('easy:gate', { reason, ok, ...(extra || {}) }); return ok; };
    if (!isOn() || S().parentGate === false) return Promise.resolve(finish(true, { skipped: true }));
    if (nowMs() < Gate.unlockUntil) return Promise.resolve(finish(true, { cached: true }));
    if (Gate.pending) return Gate.pending;
    if (!G.ui?.modal) return Promise.resolve(finish(false, { error: 'no-ui' }));
    Gate.pending = new Promise((resolve) => {
      try {
        openGate(opts, (ok) => { Gate.pending = null; resolve(finish(ok)); });
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
    const fin = (ok) => { if (finished) return; finished = true; clearInterval(coolTimer); clearTimeout(armTimer); done(ok); };
    Gate.wrong = Math.max(Gate.wrong, gateLoad().wrong);
    const qEl = h('div', { class: 'easy-gate-q' });
    const grid = h('div', { class: 'easy-gate-choices', role: 'group', 'aria-label': '답을 골라요' });
    const status = h('p', { class: 'easy-gate-status', role: 'status', 'aria-live': 'polite' });
    const coolNum = h('b', null, '30');
    const cool = h('div', { class: 'easy-gate-cool', hidden: true },
      h('span', { class: 'emoji', 'aria-hidden': 'true' }, '⏳'), h('span', null, coolNum, '초 뒤에 다시 해요'));
    const body = h('div', { class: 'easy-gate' },
      faceEl('think', 76, '🤔'),
      h('p', { class: 'easy-gate-lead' }, '어른과 함께 해요!'),
      h('p', { class: 'easy-gate-sub' }, String(opts.text || '보호자만 풀 수 있는 문제예요. 맞는 답을 눌러 주세요.').slice(0, 120)),
      qEl, grid, status, cool);

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
      qEl.hidden = false; grid.hidden = false; cool.hidden = true;
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
      qEl.hidden = true; grid.hidden = true; cool.hidden = false;
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
        Gate.unlockUntil = nowMs() + GATE_UNLOCK;
        Gate.wrong = 0;
        gateSave({ until: 0, strikes: 0, wrong: 0 });
        b.classList.add('ok');
        status.textContent = '✅ 확인했어요!';
        G.sfx('correct');
        setTimeout(() => { fin(true); m?.close(); }, 320);
        return;
      }
      Gate.wrong = Math.max(Gate.wrong, gateLoad().wrong) + 1;
      G.sfx('wrong');
      b.classList.add('bad');
      shake(grid);
      const st = gateLoad();
      if (Gate.wrong >= GATE_TRIES) {
        const wait = Math.min(GATE_COOLDOWN_MAX, GATE_COOLDOWN * Math.pow(2, st.strikes));
        gateSave({ until: Date.now() + wait, strikes: st.strikes + 1, wrong: 0 });
        Gate.wrong = 0;
        status.textContent = '조금 쉬었다가 어른과 다시 해요.';
        showCool();
      } else {
        gateSave({ until: st.until, strikes: st.strikes, wrong: Gate.wrong });
        status.textContent = `앗, 아니에요. ${GATE_TRIES - Gate.wrong}번 더 할 수 있어요.`;
        const my = qid;
        setTimeout(() => { if (!finished && cool.hidden && my === qid) render(600); }, 450);
      }
    });
    body.addEventListener('keydown', (e) => {
      const btns = Array.from(grid.querySelectorAll('.easy-gate-choice'));
      if (!btns.length || grid.hidden || !armed) return;
      const n = /^(Digit|Numpad)([1-4])$/.exec(e.code);
      if (n) { e.preventDefault(); btns[Number(n[2]) - 1]?.click(); return; }
      const i = btns.indexOf(document.activeElement);
      const move = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 2, ArrowUp: -2 }[e.key];
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
      const cx = r.left + r.width / 2;
      if (r.bottom + 96 < innerHeight) return { x: cx, y: r.bottom + 2, rot: 0, edge: false };
      return { x: cx, y: r.top - 2, rot: 180, edge: false };
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
    if (s.visible && s.y > 60 && s.y < innerHeight - 40 && s.x > 30 && s.x < innerWidth - 30) return { x: s.x, y: s.y - 4, rot: 180, edge: false };
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
      if (!c.shown) { c.shown = true; c.el.style.opacity = ''; if (c.lbl) c.lbl.style.opacity = ''; }
      const x = Math.round(p.x), y = Math.round(p.y), rot = Math.round(p.rot);
      if (x !== c.x || y !== c.y || rot !== c.rot) {
        c.x = x; c.y = y; c.rot = rot;
        c.el.style.transform = `translate3d(${x}px, ${y}px, 0) rotate(${rot}deg)`;
        c.el.classList.toggle('edge', !!p.edge);
        if (c.lbl) {
          const a = rot / 57.29578, d = 104;
          const lx = Math.round(x - Math.sin(a) * d), ly = Math.round(y + Math.cos(a) * d);
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
      case 'ferment_claim': return { text: '다 익은 장을 꺼내요' };
      case 'edu': return { text: '그림 이야기를 봐요' };
      case 'quiz': return { text: '퀴즈를 풀어요' };
      case 'journal': return { text: '오늘 일기를 써요', act: () => G.ui.triggerAction('journal'), actLabel: '일기 쓰기', actEmoji: '📝' };
      case 'photo': return { text: '사진을 찍어요', act: () => G.ui.triggerAction('photo'), actLabel: '사진 찍기', actEmoji: '📸' };
      case 'emote': case 'gesture': return { text: '내 마음을 보여 줘요', act: () => openExpress(), actLabel: '표현하기', actEmoji: '😊' };
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
      say(w.label ? `${w.label}에 도착했어요!` : '도착했어요!', { priority: 1 });
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
          const w = { id: 0, target: dest, label, resolve };
          Walk.cur = w;
          const id = pl.walkTo(dest, {
            stopDistance: Number.isFinite(opts.stopDistance) ? opts.stopDistance : 1.8, run: d > 10,
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
        if (far > 70) travelFirst().then(() => start(true), () => start(true));
        else start(true);
        if (label) say(`${label}${hasJong(label) ? '으로' : '로'} 같이 가요!`, { priority: 1 });
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
      return { id: z.id, emoji: ZONE_EMOJI[z.id] || '📍', label: name, color: KID_COLORS[i % KID_COLORS.length], badge: here === z.id ? '📍' : goal ? '⭐' : null, selected: here === z.id, say: here === z.id ? `${name}. 지금 여기 있어요.` : goal ? `${name}. 금빛 별이 있는 곳이에요.` : name };
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
  const Play = { active: 0, lastInput: nowMs(), saveAcc: 0, card: null, cardTimer: 0 };
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
  function playTick(dt) {
    const min = Number(S().playReminderMin) || 0;
    if (!min || !isOn() || !G.state || !G.ready || document.hidden || Play.card || Rest.el) return;
    if (!document.body.classList.contains('in-game')) return;
    if (nowMs() - Play.lastInput > 90000) return; // idle: not active play
    Play.active += dt;
    Play.saveAcc += dt;
    if (Play.saveAcc > 15) { Play.saveAcc = 0; persistPlay(); }
    if (Play.active >= min * 60) { Play.active = 0; persistPlay(); showReminder(); }
  }

  // ================================================================ HUD wiring (easy-mode layout, §12.3)
  // throttles use wall-clock time (not the clamped frame dt) so slow devices still refresh promptly
  const Hud = { bound: false, el: null, emo: null, text: null, pips: null, go: null, goEmo: null, goLbl: null, mode: '', key: '', speakKey: '', pendingSay: null, pendingAt: 0, stepAt: -1e9, badgeAt: -1e9, badge: -1, step: null, lvObs: null };
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
    _speechText: speechText,
    _voice: Voice,
  };

  G.register({
    name: 'easy', order: 88, label: '쉬운 모드',
    init() { bindHud(); },
    onStateLoaded() { hudRefreshSoon(); Hud.speakKey = ''; Hud.badge = -1; Hud.badgeAt = -1e9; syncLevelChip(); },
    update(dt) {
      hudTick(dt);
      playTick(dt);
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
