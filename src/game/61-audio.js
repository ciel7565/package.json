// =============================================================================
// 61-audio.js — the sound of the whole experience (G.sys.audio, order 85, CONTRACT §17.6): generative 국악 as
// background music (63-gugak.js), effects in traditional timbres, and a world filled with the sounds of nature.
// Everything is synthesised in the browser — no samples, no network.
//
//   G.sys.audio.play(name, {volume, pan, at:{x,z}, surface, run, exact, force}) -> bool
//       UI      click open close notify error coin reward quest levelup achievement correct wrong page slide chat emote
//               teleport shutter camera screen lecture lock unlock bell sparkle stamp tap oops pop whoosh festival
//       body    step jump jump2 vault land land_wood land_stone land_earth land_grass land_gravel splash
//       work    water harvest plant pickup jar lid craft bubble drip
//       room    door_open door_close door_slide place pick turn
//       (쉬운 모드: click → tap (목탁), error / wrong → oops (대금): never a harsh buzzer; fanfares a little softer)
//   G.sys.audio.speak(text, {rate, pitch, force}) / stopSpeaking() / speaking   ko-KR speechSynthesis (쉬운 모드: G.easy.say)
//   G.sys.audio.duck(key, gain, seconds?, {nature}) / unduck(key) / duck(true|false)   lower the music (the lowest duck
//       wins; 'lecture' and 'voice' also lower nature by default) — 'tts' 'speech' 'dialogue' 'easy-voice' 'lecture' …
//   G.sys.audio.stinger(name)                  a short 국악 phrase on the effects bus (reward · levelup · festival · quest · welcome)
//   G.sys.audio.emitter({kind: 'fire'|'jar'|'bell'|'water', x, z, place?, gain?}) -> {move(x, z), remove()}
//       a point source of nature sound (world coordinates; `place` = only while the player is in that place)
//   G.sys.audio.voiceGain() -> 0..1            the 목소리 level (TTS); levels {master, music, sfx, ambient, voice}
//   G.sys.audio.unlock() (also automatic on the first pointer / key) · ready · ctx · mood · moodInfo · stats · debug()
//   G.sys.audio.analyze(names, opts) -> Promise<{peak, peakDb, rms, duration}>   (offline render of effects)
//   G.sys.audio.lab                             offline renders for tests (instruments, 장단, moods, nature, effects,
//                                              a 120 s simulation of the whole engine) — see the bottom of this file
//
// Graph (one engine per context; the live AudioContext and every OfflineAudioContext of the tests use the same code):
//   instruments (63-gugak strips) ─> moodFade ─> music ─> duck ─┐
//   sfx (one gain per call) ─────────────────────────> sfx ─────┼─> master ─> trim ─> limiter ─> soft clip ─> out
//   nature beds + calls ─> outdoor (low-pass indoors) ─┬> amb ─> ambDuck ─┘          └─ reverb (generated IR) ─┘
//   room tone · fire ──────────────────────────────────┘
// Voices (one-shot sounds) are capped at 24 (music 10 · nature 6 · sfx 8); continuous beds are not voices. Every
// scheduled source frees its chain when it ends, so the node count stays flat (tests/audio-client.mjs measures it).
// The context is created on the first user gesture, suspended while the tab is hidden or everything is muted, and
// nothing throws without Web Audio (every entry point is a no-op then).
// Settings: volumeMaster · volumeMusic (음악) · volumeSfx (효과) · volumeAmbient (자연) · volumeVoice (목소리) ·
//   musicGugak (전통 음악 on / off) · muted. Operator defaults: G.site.get('sound.music_on' | 'sound.volume_music' |
//   'sound.volume_sfx' | 'sound.volume_nature' | 'sound.volume_voice' | 'sound.nature_on') — used while the device still
//   has the built-in default.
// =============================================================================
(function () {
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const rand = (a, b) => a + Math.random() * (b - a);
  const randInt = (a, b) => Math.floor(a + Math.random() * (b - a + 1));
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const AC = window.AudioContext || window.webkitAudioContext || null;
  const OAC = () => window.OfflineAudioContext || window.webkitOfflineAudioContext || null;
  const GK = () => G.gugak || null;

  // ---------------------------------------------------------------- tuning constants
  const CAPS = { music: 10, nature: 6, sfx: 8 };   // ≤ 24 voices in all (CONTRACT §17.6)
  // bus make-up gains (the old values: effects stay as loud as before, measured by tests/audio-client.mjs)
  const BASE = { music: 2.5, sfx: 1.7, ambient: 2.3 };
  const THROTTLE = {                // minimum seconds between two plays of the same sfx
    click: 0.045, open: 0.08, close: 0.08, notify: 0.12, error: 0.2, coin: 0.06, step: 0.07, land: 0.12, jump: 0.1, jump2: 0.12,
    chat: 0.09, emote: 0.15, page: 0.07, slide: 0.07, water: 0.25, harvest: 0.15, plant: 0.15, jar: 0.15, lid: 0.15, bubble: 0.03,
    drip: 0.02, reward: 0.3, quest: 0.4, levelup: 0.8, achievement: 0.5, correct: 0.25, wrong: 0.25, teleport: 0.4, shutter: 0.12,
    camera: 0.12, tap: 0.06, oops: 0.3, sparkle: 0.3, stamp: 0.2, pickup: 0.12, door_open: 0.3, door_close: 0.3, door_slide: 0.3,
    place: 0.1, pick: 0.1, turn: 0.08, vault: 0.2, screen: 0.4, lecture: 0.5, lock: 0.2, unlock: 0.3, bell: 0.2, festival: 2,
  };
  const FANFARE = { levelup: 2.6, achievement: 2.0, quest: 1.6, reward: 1.4, festival: 4 }; // duck the music under these (s)
  const WET = { notify: 0.5, coin: 0.4, reward: 0.7, quest: 0.7, levelup: 0.8, achievement: 0.8, correct: 0.5, emote: 0.3, teleport: 0.8, open: 0.25, close: 0.2,
    craft: 0.4, jar: 0.35, lid: 0.3, tap: 0.15, sparkle: 0.7, stamp: 0.4, oops: 0.3, jump2: 0.35, vault: 0.3, bell: 0.7, lecture: 0.6, screen: 0.4, unlock: 0.5,
    door_open: 0.3, door_close: 0.35, door_slide: 0.25, festival: 0.5, chat: 0.25, error: 0.25, wrong: 0.3, harvest: 0.4, pickup: 0.3 };
  // 쉬운 모드 (CONTRACT §12): buzzers become a gentle "uh-oh", clicks a soft 목탁; big fanfares a little softer
  const EASY_SWAP = { click: 'tap', error: 'oops', wrong: 'oops' };
  const EASY_GAIN = { levelup: 0.8, achievement: 0.85, reward: 0.9, quest: 0.9, teleport: 0.85, shutter: 0.75, camera: 0.75, splash: 0.85, land: 0.85, festival: 0.8, door_close: 0.85 };
  const easyOn = () => !!(G.easy ? G.easy.on : G.settings?.easyMode !== false);

  // ================================================================= synth helpers (any BaseAudioContext)
  // S = { ac, out (AudioNode), wet (AudioNode|null), buf {white,pink,brown}, K (the counting kit) }
  function gainNode(ac, v) { const g = ac.createGain(); g.gain.value = v; return g; }
  function perc(param, t, peak, a, d) {
    param.cancelScheduledValues(t);
    param.setValueAtTime(0.0001, t);
    param.linearRampToValueAtTime(Math.max(0.0001, peak), t + a);
    param.setTargetAtTime(0.0001, t + a, Math.max(0.004, d / 4.6));
  }
  function filter(ac, type, f, q, gainDb) {
    const n = ac.createBiquadFilter();
    n.type = type; n.frequency.value = f;
    if (q != null) n.Q.value = q;
    if (gainDb != null) n.gain.value = gainDb;
    return n;
  }
  function panNode(ac, pan) {
    if (!pan || typeof ac.createStereoPanner !== 'function') return null;
    const p = ac.createStereoPanner();
    p.pan.value = clamp(pan, -1, 1);
    return p;
  }
  /** count a started source and free its private chain when it ends (flat node count) */
  function trackSrc(S, src, chain) {
    const K = S.K || (S.K = { live: 0, made: 0, ended: 0 });
    K.live++; K.made++;
    src.onended = () => {
      K.live--; K.ended++;
      for (const n of chain) { try { n.disconnect(); } catch (e) { /* gone */ } }
      try { src.disconnect(); } catch (e) { /* gone */ }
    };
  }
  /** filters → pan → dest (+ a send to the reverb); returns the private nodes it created */
  function route(S, node, o, chain) {
    let last = node;
    if (o.lp) { const f = filter(S.ac, 'lowpass', o.lp, o.lpq ?? 0.7); last.connect(f); last = f; chain.push(f); }
    if (o.hp) { const f = filter(S.ac, 'highpass', o.hp, 0.7); last.connect(f); last = f; chain.push(f); }
    const p = panNode(S.ac, o.pan);
    if (p) { last.connect(p); last = p; chain.push(p); }
    last.connect(o.dest || S.out);
    if (o.wet && S.wet) { const s = gainNode(S.ac, o.wet); last.connect(s); s.connect(S.wet); chain.push(s); }
  }
  /** oscillator voice: {type, f, f2, glide, exp, f3, glide2, t, a, d, sus, g, detune, vib:{rate, depth, delay}, lp, hp, pan, wet, dest} */
  function tone(S, o) {
    const ac = S.ac, t = o.t, a = o.a ?? 0.005, d = o.d ?? 0.2;
    const os = ac.createOscillator();
    os.type = o.type || 'sine';
    os.frequency.setValueAtTime(o.f, t);
    if (o.f2 && o.f2 !== o.f) {
      const gt = t + (o.glide ?? a + d * 0.6);
      if (o.exp === false) os.frequency.linearRampToValueAtTime(o.f2, gt); else os.frequency.exponentialRampToValueAtTime(o.f2, gt);
      if (o.f3) os.frequency.exponentialRampToValueAtTime(o.f3, gt + (o.glide2 ?? 0.1));
    }
    if (o.detune) os.detune.value = o.detune;
    const end = t + a + d + 0.05 + (o.sus || 0);
    const g = ac.createGain();
    const chain = [g];
    if (o.vib) {
      const l = ac.createOscillator(); l.frequency.value = o.vib.rate || 5;
      const lg = ac.createGain();
      lg.gain.setValueAtTime(0, t);
      lg.gain.linearRampToValueAtTime(o.vib.depth || 6, t + (o.vib.delay ?? 0.08));
      l.connect(lg); lg.connect(os.frequency);
      l.start(t); l.stop(end);
      chain.push(lg);
      trackSrc(S, l, [lg]);
    }
    if (o.sus) {
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(o.g ?? 0.2, t + a);
      g.gain.setValueAtTime(o.g ?? 0.2, t + a + o.sus);
      g.gain.setTargetAtTime(0.0001, t + a + o.sus, Math.max(0.01, d / 4.6));
    } else perc(g.gain, t, o.g ?? 0.2, a, d);
    os.connect(g);
    route(S, g, o, chain);
    os.start(t); os.stop(end);
    trackSrc(S, os, chain);
    return end;
  }
  /** filtered noise burst: {kind, ft, f, f2, sweep, q, t, a, d, g, rate, lp, hp, pan, wet, dest} */
  function noise(S, o) {
    const ac = S.ac, t = o.t, a = o.a ?? 0.005, d = o.d ?? 0.2;
    const buf = S.buf[o.kind || 'white'];
    if (!buf) return t;
    const src = ac.createBufferSource();
    src.buffer = buf; src.loop = true;
    if (o.rate) src.playbackRate.value = o.rate;
    const f = filter(ac, o.ft || 'bandpass', o.f || 1000, o.q ?? 1);
    if (o.f2) f.frequency.exponentialRampToValueAtTime(o.f2, t + (o.sweep ?? a + d * 0.7));
    const g = ac.createGain();
    perc(g.gain, t, o.g ?? 0.1, a, d);
    src.connect(f); f.connect(g);
    const chain = [f, g];
    route(S, g, o, chain);
    const end = t + a + d + 0.05;
    src.start(t, Math.random() * Math.max(0, buf.duration - 1));
    src.stop(end);
    trackSrc(S, src, chain);
    return end;
  }
  /** struck bell / chime: inharmonic partials with faster decay up high */
  function bell(S, f, t, g, d, o = {}) {
    const parts = o.parts || [[1, 1, 1], [2.0, 0.42, 0.62], [3.01, 0.2, 0.42], [4.17, 0.1, 0.3]];
    let end = t;
    for (const [m, gm, dm] of parts) end = Math.max(end, tone(S, { type: 'sine', f: f * m, t, a: 0.002, d: d * dm, g: g * gm, pan: o.pan, wet: o.wet, dest: o.dest }));
    return end;
  }
  /** a 국악 instrument note on the current synth context (63-gugak), routed to S.out; v = velocity */
  function gk(S, inst, t, o) {
    const L = GK();
    if (!L || !S.K || !S.K.buf) return tone(S, { type: 'triangle', f: o.f || 440, t, a: 0.004, d: 0.4, g: 0.08 * (o.vel ?? 0.6), lp: 2400 });
    return L.INST[inst](S.K, t, { ...o, dest: o.dest || S.out });
  }
  const PY = (deg, base = 392) => (GK() ? GK().freq('pyeong', base, deg) : base * Math.pow(2, deg / 5));

  // ---------------------------------------------------------------- step sounds by surface
  function step(S, t, o) {
    const run = !!o.run, k = 1.9 * (run ? 1.25 : 1) * (o.heavy ? 2.1 : 1) * rand(0.85, 1.1), pf = rand(0.9, 1.1);
    const pan = (Math.random() - 0.5) * 0.12;
    let end = t;
    let surf = o.surface || 'grass';
    if (o.snowy && (surf === 'grass' || surf === 'dirt' || surf === 'earth' || surf === 'sand')) surf = 'snow';
    switch (surf) {
      case 'stone': case 'road': case 'asphalt':
        end = noise(S, { kind: 'white', ft: 'bandpass', f: (surf === 'stone' ? 2800 : 1700) * pf, q: 1.3, t, a: 0.001, d: 0.04, g: 0.11 * k, pan });
        noise(S, { kind: 'pink', ft: 'bandpass', f: 850 * pf, q: 0.9, t: t + 0.004, a: 0.004, d: 0.06, g: 0.07 * k, pan });
        if (surf === 'stone') tone(S, { type: 'sine', f: 2300 * pf, t, a: 0.001, d: 0.014, g: 0.018 * k, pan });
        break;
      case 'gravel': // 자갈: a short cluster of tiny stone ticks over a crunch
        end = noise(S, { kind: 'white', ft: 'bandpass', f: 2100 * pf, q: 0.8, t, a: 0.004, d: 0.09, g: 0.08 * k, pan });
        for (let i = 0; i < 4; i++) noise(S, { kind: 'white', ft: 'bandpass', f: rand(3000, 5200), q: 4, t: t + rand(0, 0.06), a: 0.001, d: 0.012, g: 0.05 * k, pan });
        break;
      case 'wood': // 마루: a hollow knock, sometimes a soft creak of the board
        end = tone(S, { type: 'sine', f: 190 * pf, f2: 135 * pf, t, a: 0.002, d: 0.1, g: 0.16 * k, pan });
        tone(S, { type: 'triangle', f: 390 * pf, t, a: 0.001, d: 0.045, g: 0.05 * k, pan });
        noise(S, { kind: 'pink', ft: 'bandpass', f: 720 * pf, q: 2, t, a: 0.002, d: 0.05, g: 0.08 * k, pan });
        if (Math.random() < 0.08) tone(S, { type: 'triangle', f: rand(260, 340), f2: rand(220, 280), glide: 0.12, t: t + 0.03, a: 0.03, d: 0.16, g: 0.012 * k, pan, lp: 1200 });
        break;
      case 'dirt': case 'earth':
        end = noise(S, { kind: 'brown', ft: 'lowpass', f: 650 * pf, q: 0.7, t, a: 0.003, d: 0.085, g: 0.32 * k, pan });
        tone(S, { type: 'sine', f: 95 * pf, f2: 62, t, a: 0.002, d: 0.06, g: 0.08 * k, pan });
        break;
      case 'sand':
        end = noise(S, { kind: 'white', ft: 'highpass', f: 1600 * pf, q: 0.6, t, a: 0.012, d: 0.12, g: 0.05 * k, lp: 6500, pan });
        break;
      case 'snow': // 눈: a soft, squeaky crunch
        end = noise(S, { kind: 'pink', ft: 'bandpass', f: 1400 * pf, q: 0.9, t, a: 0.02, d: 0.13, g: 0.1 * k, pan });
        noise(S, { kind: 'white', ft: 'bandpass', f: 3200 * pf, q: 3, t: t + 0.03, a: 0.01, d: 0.05, g: 0.025 * k, pan });
        break;
      case 'mat': case 'paper':   // 장판 / 멍석 inside a room: a soft, dry pad
        end = noise(S, { kind: 'brown', ft: 'lowpass', f: 420 * pf, q: 0.6, t, a: 0.004, d: 0.07, g: 0.2 * k, pan });
        noise(S, { kind: 'pink', ft: 'bandpass', f: 1500 * pf, q: 0.8, t: t + 0.006, a: 0.004, d: 0.03, g: 0.018 * k, pan });
        break;
      case 'water':
        end = noise(S, { kind: 'white', ft: 'bandpass', f: 1150 * pf, f2: 650, q: 1.1, t, a: 0.006, d: 0.15, g: 0.13 * k, pan });
        tone(S, { type: 'sine', f: rand(380, 520), f2: rand(800, 1000), glide: 0.04, t: t + 0.03, a: 0.003, d: 0.05, g: 0.035 * k, pan });
        break;
      default: // grass
        end = noise(S, { kind: 'pink', ft: 'bandpass', f: 1250 * pf, q: 0.7, t, a: 0.004, d: 0.09, g: 0.1 * k, lp: 2600, pan });
        noise(S, { kind: 'white', ft: 'bandpass', f: 2600 * pf, q: 0.8, t: t + 0.028, a: 0.004, d: 0.045, g: 0.022 * k, pan });
    }
    return end;
  }
  function landOn(surface) { return (S, t, o) => SFX.land(S, t, { ...o, surface }); }
  /** play a list of 63-gugak events on the effects bus */
  function stingerSfx(name) {
    return (S, t, o) => {
      const L = GK();
      if (!L || !S.K?.buf) return SFX.correct(S, t);
      let end = t;
      for (const e of L.stinger(name, t, { vel: 0.7 * (o.vel ?? 1) })) end = Math.max(end, L.INST[e.inst](S.K, e.t, { ...e, dest: S.out }));
      return end;
    };
  }

  // ================================================================= the sound-effect library (traditional timbres)
  // each fn(S, t, opts) schedules nodes from time t and returns its approximate end time
  const SFX = {
    /** 목탁-like soft wooden tick (the most frequent sound: short and quiet) */
    click(S, t) { return gk(S, 'moktak', t, { f: 1180, vel: 0.42 }); },
    /** 가야금: two notes rising (a panel opens) / falling (it closes) */
    open(S, t) { gk(S, 'gayageum', t, { f: PY(0), dur: 0.15, vel: 0.5, ring: 0.5 }); return gk(S, 'gayageum', t + 0.065, { f: PY(3), dur: 0.3, vel: 0.46, ring: 0.6 }); },
    close(S, t) { gk(S, 'gayageum', t, { f: PY(3), dur: 0.15, vel: 0.46, ring: 0.45 }); return gk(S, 'gayageum', t + 0.07, { f: PY(0), dur: 0.25, vel: 0.42, ring: 0.5 }); },
    /** 풍경 — the wind bell under the eaves, twice */
    notify(S, t) { gk(S, 'pungkyeong', t, { f: 1568, vel: 0.5, dur: 1.4 }); return gk(S, 'pungkyeong', t + 0.11, { f: 1975, vel: 0.36, dur: 1.2 }); },
    bell(S, t) { return gk(S, 'pungkyeong', t, { f: rand(1500, 1800), vel: 0.45, dur: 2.2, double: Math.random() < 0.4 }); },
    /** 거문고: two low, dull notes — "not like that", never a buzzer */
    error(S, t) { gk(S, 'geomungo', t, { f: 146.8, dur: 0.25, vel: 0.5, ring: 0.6 }); return gk(S, 'geomungo', t + 0.17, { f: 130.8, dur: 0.35, vel: 0.5, ring: 0.8 }); },
    /** 해금: a short sigh downwards */
    wrong(S, t) { return gk(S, 'haegeum', t, { f: 440, dur: 0.32, vel: 0.42, vib: 0, bend: -180, bendAt: 0.1 }); },
    /** 대금: a gentle falling "uh-oh" */
    oops(S, t) { gk(S, 'daegeum', t, { f: 587.3, dur: 0.18, vel: 0.42, vib: 0, slide: 40 }); return gk(S, 'daegeum', t + 0.2, { f: 493.9, dur: 0.3, vel: 0.4, vib: 14, fall: -60, slide: 30 }); },
    /** 엽전: two brass coins clink */
    coin(S, t) {
      tone(S, { type: 'sine', f: 2093, t, a: 0.001, d: 0.12, g: 0.06, wet: 0.35 });
      tone(S, { type: 'sine', f: 3290, t, a: 0.001, d: 0.06, g: 0.025 });
      tone(S, { type: 'sine', f: 2637, t: t + 0.075, a: 0.001, d: 0.3, g: 0.07, wet: 0.4 });
      tone(S, { type: 'sine', f: 4180, t: t + 0.075, a: 0.001, d: 0.1, g: 0.02 });
      return gk(S, 'gayageum', t + 0.075, { f: PY(5), dur: 0.3, vel: 0.35, ring: 0.5 });
    },
    reward: stingerSfx('reward'),
    quest: stingerSfx('quest'),
    levelup: stingerSfx('levelup'),
    festival: stingerSfx('festival'),
    achievement(S, t) {
      [1568, 1975.5, 2349].forEach((f, i) => gk(S, 'pungkyeong', t + i * 0.07, { f, vel: 0.4 - i * 0.05, dur: 1.6 }));
      gk(S, 'bak', t, { vel: 0.4 });
      let end = t;
      for (const d of [5, 7, 8]) end = Math.max(end, gk(S, 'gayageum', t + 0.2, { f: PY(d), dur: 1.2, vel: 0.45, vib: 14 }));
      return end;
    },
    water(S, t) {
      const end = noise(S, { kind: 'white', ft: 'bandpass', f: 2600, f2: 950, sweep: 0.55, q: 0.9, t, a: 0.06, d: 0.6, g: 0.16, lp: 5000 });
      for (let i = 0; i < 7; i++) {
        const f = rand(480, 1150);
        tone(S, { type: 'sine', f, f2: f * rand(1.6, 2.2), glide: 0.03, t: t + rand(0.08, 0.6), a: 0.003, d: 0.045, g: rand(0.02, 0.035) });
      }
      return end;
    },
    /** 박 (softly) + a high 가야금 note — something comes out of the earth */
    harvest(S, t) {
      noise(S, { kind: 'pink', ft: 'bandpass', f: 1900, q: 0.8, t, a: 0.01, d: 0.18, g: 0.08 });
      gk(S, 'bak', t + 0.06, { vel: 0.32 });
      return gk(S, 'gayageum', t + 0.14, { f: PY(8), dur: 0.5, vel: 0.45, vib: 12 });
    },
    plant(S, t) {
      noise(S, { kind: 'brown', ft: 'lowpass', f: 520, q: 0.7, t, a: 0.004, d: 0.13, g: 0.36 });
      tone(S, { type: 'sine', f: 145, f2: 80, t, a: 0.003, d: 0.13, g: 0.12 });
      return gk(S, 'moktak', t + 0.13, { f: 820, vel: 0.3 });
    },
    /** a basket of straw — something is picked up */
    pickup(S, t) {
      noise(S, { kind: 'pink', ft: 'bandpass', f: 2300, f2: 3200, q: 0.9, t, a: 0.01, d: 0.12, g: 0.07 });
      noise(S, { kind: 'white', ft: 'bandpass', f: 4200, q: 2, t: t + 0.04, a: 0.004, d: 0.05, g: 0.025 });
      return gk(S, 'gayageum', t + 0.08, { f: PY(7), dur: 0.25, vel: 0.36, ring: 0.5 });
    },
    jar(S, t) { // 옹기: a hollow ceramic knock and the lid settling
      tone(S, { type: 'sine', f: 520, t, a: 0.001, d: 0.26, g: 0.09, wet: 0.35 });
      tone(S, { type: 'sine', f: 1310, t, a: 0.001, d: 0.11, g: 0.035 });
      tone(S, { type: 'sine', f: 182, t, a: 0.003, d: 0.32, g: 0.07 });
      noise(S, { kind: 'white', ft: 'bandpass', f: 1650, q: 6, t, a: 0.001, d: 0.05, g: 0.06 });
      tone(S, { type: 'sine', f: 560, t: t + 0.1, a: 0.001, d: 0.14, g: 0.035 });
      return t + 0.45;
    },
    /** the lid of an onggi jar: a ceramic scrape and a small knock */
    lid(S, t) {
      noise(S, { kind: 'white', ft: 'bandpass', f: 1800, f2: 2300, q: 4, t, a: 0.02, d: 0.16, g: 0.05 });
      tone(S, { type: 'sine', f: 740, t: t + 0.16, a: 0.001, d: 0.16, g: 0.07, wet: 0.3 });
      tone(S, { type: 'sine', f: 1630, t: t + 0.16, a: 0.001, d: 0.06, g: 0.025 });
      return tone(S, { type: 'sine', f: 240, t: t + 0.16, a: 0.002, d: 0.2, g: 0.05 });
    },
    /** 장구 덕 덕 for work, then three soft notes */
    craft(S, t) {
      gk(S, 'janggu', t, { stroke: 'deok', vel: 0.5 });
      gk(S, 'janggu', t + 0.17, { stroke: 'deok', vel: 0.55 });
      let end = t;
      [5, 7, 8].forEach((d, i) => { end = Math.max(end, gk(S, 'gayageum', t + 0.34 + i * 0.07, { f: PY(d), dur: 0.4, vel: 0.42, ring: 0.6 })); });
      return end;
    },
    shutter(S, t) {
      noise(S, { kind: 'white', ft: 'highpass', f: 2600, q: 0.7, t, a: 0.0008, d: 0.025, g: 0.22 });
      noise(S, { kind: 'white', ft: 'bandpass', f: 1250, q: 1, t: t + 0.004, a: 0.002, d: 0.05, g: 0.08 });
      tone(S, { type: 'sawtooth', f: 170, t: t + 0.015, a: 0.004, d: 0.05, g: 0.025, lp: 650 });
      noise(S, { kind: 'white', ft: 'highpass', f: 3000, q: 0.7, t: t + 0.075, a: 0.0008, d: 0.022, g: 0.15 });
      return t + 0.18;
    },
    /** the camera of the lecture screen: a softer shutter */
    camera(S, t) {
      noise(S, { kind: 'white', ft: 'bandpass', f: 2400, q: 0.8, t, a: 0.001, d: 0.03, g: 0.1 });
      noise(S, { kind: 'pink', ft: 'bandpass', f: 1100, q: 1, t: t + 0.006, a: 0.002, d: 0.05, g: 0.06 });
      return noise(S, { kind: 'white', ft: 'bandpass', f: 2800, q: 0.8, t: t + 0.07, a: 0.001, d: 0.025, g: 0.07 });
    },
    /** a lecture screen comes on: one clap of the 박 (the sign that a piece begins) and a low wooden tone */
    screen(S, t) { gk(S, 'bak', t, { vel: 0.4 }); return gk(S, 'moktak', t + 0.05, { f: 520, vel: 0.28 }); },
    lecture(S, t) { return gk(S, 'bak', t, { vel: 0.5 }); },
    lock(S, t) { // a wooden bolt slides home
      noise(S, { kind: 'pink', ft: 'bandpass', f: 900, f2: 600, q: 1.5, t, a: 0.01, d: 0.08, g: 0.07 });
      return gk(S, 'moktak', t + 0.08, { f: 420, vel: 0.4 });
    },
    unlock(S, t) {
      noise(S, { kind: 'pink', ft: 'bandpass', f: 600, f2: 950, q: 1.5, t, a: 0.01, d: 0.08, g: 0.07 });
      gk(S, 'moktak', t + 0.08, { f: 560, vel: 0.32 });
      [5, 7, 8].forEach((d, i) => gk(S, 'gayageum', t + 0.16 + i * 0.06, { f: PY(d), dur: 0.35, vel: 0.4, ring: 0.6 }));
      return t + 1.2;
    },
    step(S, t, o) { return step(S, t, o); },
    land(S, t, o) {
      step(S, t, { ...o, heavy: true });
      return tone(S, { type: 'sine', f: 85, f2: 46, t, a: 0.003, d: 0.14, g: 0.2 });
    },
    land_wood: landOn('wood'), land_stone: landOn('stone'), land_earth: landOn('dirt'), land_grass: landOn('grass'), land_gravel: landOn('gravel'),
    /** the 한복 sleeves through the air */
    jump(S, t) {
      noise(S, { kind: 'pink', ft: 'bandpass', f: 480, f2: 1450, sweep: 0.16, q: 0.8, t, a: 0.02, d: 0.18, g: 0.17 });
      return tone(S, { type: 'sine', f: 260, f2: 430, glide: 0.09, t, a: 0.006, d: 0.1, g: 0.05 });
    },
    /** double jump (CONTRACT §14.2): the jump whoosh plus a 가야금 harmonic going up */
    jump2(S, t) {
      noise(S, { kind: 'pink', ft: 'bandpass', f: 620, f2: 1900, sweep: 0.14, q: 0.9, t, a: 0.012, d: 0.16, g: 0.13 });
      return gk(S, 'gayageum', t + 0.04, { f: PY(8), dur: 0.3, vel: 0.36, slide: -150, ring: 0.5 });
    },
    /** vault over an obstacle (CONTRACT §17.1): a fuller whoosh and a light bamboo flick */
    vault(S, t) {
      noise(S, { kind: 'pink', ft: 'bandpass', f: 420, f2: 1700, sweep: 0.22, q: 0.7, t, a: 0.03, d: 0.24, g: 0.16 });
      return gk(S, 'janggu', t + 0.05, { stroke: 'gi', vel: 0.5 });
    },
    splash(S, t) {
      const end = noise(S, { kind: 'white', ft: 'bandpass', f: 1500, f2: 600, sweep: 0.3, q: 0.7, t, a: 0.003, d: 0.38, g: 0.2 });
      tone(S, { type: 'sine', f: 125, f2: 70, t, a: 0.003, d: 0.15, g: 0.11 });
      for (let i = 0; i < 6; i++) { const f = rand(420, 1000); tone(S, { type: 'sine', f, f2: f * 2, glide: 0.035, t: t + rand(0.08, 0.45), a: 0.003, d: 0.05, g: 0.03 }); }
      return end;
    },
    /** a 가야금 harmonic, softly — a message came */
    chat(S, t) { return gk(S, 'gayageum', t, { f: PY(9), dur: 0.2, vel: 0.36, ring: 0.4 }); },
    /** 장구 기덕 — a playful flick */
    emote(S, t) { gk(S, 'janggu', t, { stroke: 'gideok', vel: 0.5 }); return gk(S, 'pungkyeong', t + 0.14, { f: 1760, vel: 0.25, dur: 0.8 }); },
    /** 대금 rising + the wind bell: on the way */
    teleport(S, t) {
      gk(S, 'daegeum', t, { f: PY(5), dur: 0.5, vel: 0.45, slide: 500, vib: 0 });
      noise(S, { kind: 'white', ft: 'highpass', f: 1800, f2: 6000, sweep: 0.45, q: 0.7, t, a: 0.1, d: 0.5, g: 0.02, wet: 0.6 });
      [1568, 1975, 2349].forEach((f, i) => gk(S, 'pungkyeong', t + 0.32 + i * 0.05, { f, vel: 0.3, dur: 1.4 }));
      return t + 1.6;
    },
    /** 한지: a paper page turns */
    page(S, t) {
      noise(S, { kind: 'white', ft: 'bandpass', f: 2900, f2: 1500, sweep: 0.17, q: 0.9, t, a: 0.035, d: 0.16, g: 0.11 });
      noise(S, { kind: 'pink', ft: 'lowpass', f: 900, q: 0.7, t: t + 0.06, a: 0.02, d: 0.1, g: 0.09 });
      return t + 0.3;
    },
    /** the next slide of a lecture deck: a light paper swish and a tiny tap */
    slide(S, t) {
      noise(S, { kind: 'white', ft: 'bandpass', f: 2400, f2: 1600, sweep: 0.12, q: 1, t, a: 0.02, d: 0.1, g: 0.07 });
      return gk(S, 'moktak', t + 0.09, { f: 980, vel: 0.2 });
    },
    /** 가야금: three notes up the 평조 */
    correct(S, t) {
      let end = t;
      [5, 7, 8].forEach((d, i) => { end = Math.max(end, gk(S, 'gayageum', t + i * 0.08, { f: PY(d), dur: i === 2 ? 0.7 : 0.25, vel: 0.5, vib: i === 2 ? 14 : 0, ring: 0.8 })); });
      return end;
    },
    // ---- 쉬운 모드 (CONTRACT §12): soft, round, never harsh
    /** big kid buttons / tiles: a soft round 목탁 */
    tap(S, t) { return gk(S, 'moktak', t, { f: 680, vel: 0.45 }); },
    /** twinkle for kid celebrations: three wind bells */
    sparkle(S, t) {
      let end = t;
      [1568, 1760, 2093].forEach((f, i) => { end = Math.max(end, gk(S, 'pungkyeong', t + i * 0.08, { f, vel: 0.36 - i * 0.05, dur: 1.4 })); });
      return end;
    },
    /** 도장 on 한지: a soft press + a tiny 목탁 */
    stamp(S, t) {
      noise(S, { kind: 'brown', ft: 'lowpass', f: 420, q: 0.7, t, a: 0.003, d: 0.12, g: 0.3 });
      tone(S, { type: 'sine', f: 180, f2: 110, t, a: 0.004, d: 0.14, g: 0.12 });
      return gk(S, 'moktak', t + 0.12, { f: 900, vel: 0.28 });
    },
    // ---- the rooms (doors, decorating)
    /** a hinged wooden door (여닫이): the hinge creaks, the door swings, the latch knocks */
    door_open(S, t) {
      tone(S, { type: 'triangle', f: 210, f2: 290, glide: 0.38, exp: false, t, a: 0.05, d: 0.34, g: 0.018, lp: 1400, vib: { rate: 23, depth: 14, delay: 0.02 } });
      noise(S, { kind: 'pink', ft: 'bandpass', f: 500, f2: 900, sweep: 0.35, q: 0.8, t: t + 0.05, a: 0.1, d: 0.3, g: 0.05 });
      return gk(S, 'moktak', t + 0.02, { f: 380, vel: 0.35 });
    },
    door_close(S, t) {
      noise(S, { kind: 'pink', ft: 'bandpass', f: 800, f2: 450, sweep: 0.25, q: 0.8, t, a: 0.08, d: 0.2, g: 0.05 });
      tone(S, { type: 'sine', f: 120, f2: 82, t: t + 0.26, a: 0.003, d: 0.18, g: 0.15 });
      noise(S, { kind: 'brown', ft: 'lowpass', f: 600, q: 0.7, t: t + 0.26, a: 0.002, d: 0.1, g: 0.22 });
      return gk(S, 'moktak', t + 0.36, { f: 460, vel: 0.3 });
    },
    /** a sliding paper door (미닫이): wood rubbing in its track, a soft knock at the end */
    door_slide(S, t) {
      noise(S, { kind: 'pink', ft: 'bandpass', f: 700, f2: 1150, sweep: 0.42, q: 1.1, t, a: 0.08, d: 0.4, g: 0.07 });
      noise(S, { kind: 'brown', ft: 'lowpass', f: 300, q: 0.7, t, a: 0.08, d: 0.4, g: 0.12 });
      return gk(S, 'moktak', t + 0.46, { f: 560, vel: 0.26 });
    },
    /** a thing is set down on the 장판 (decorating the room) */
    place(S, t) {
      tone(S, { type: 'sine', f: 160, f2: 110, t, a: 0.003, d: 0.12, g: 0.13 });
      noise(S, { kind: 'brown', ft: 'lowpass', f: 700, q: 0.7, t, a: 0.002, d: 0.06, g: 0.18 });
      return gk(S, 'moktak', t + 0.02, { f: 760, vel: 0.2 });
    },
    pick(S, t) {
      noise(S, { kind: 'pink', ft: 'bandpass', f: 1600, f2: 2400, q: 1, t, a: 0.01, d: 0.08, g: 0.05 });
      return gk(S, 'moktak', t, { f: 980, vel: 0.22 });
    },
    turn(S, t) {
      noise(S, { kind: 'pink', ft: 'bandpass', f: 1100, f2: 1500, q: 2, t, a: 0.01, d: 0.07, g: 0.045 });
      return gk(S, 'moktak', t + 0.05, { f: 1240, vel: 0.16 });
    },
    // small extras used internally / by other modules
    bubble(S, t, o) { const f = o.f || rand(450, 1100); return tone(S, { type: 'sine', f, f2: f * rand(1.6, 2.2), glide: 0.03, t, a: 0.003, d: 0.045, g: 0.04 }); },
    drip(S, t, o) { const f = o.f || rand(1800, 3800); return tone(S, { type: 'sine', f, f2: f * 0.7, glide: 0.03, t, a: 0.001, d: 0.04, g: 0.03 }); },
    pop(S, t) { return gk(S, 'moktak', t, { f: 900, vel: 0.34 }); },
    whoosh(S, t) { return noise(S, { kind: 'pink', ft: 'bandpass', f: 400, f2: 1600, sweep: 0.25, q: 0.8, t, a: 0.08, d: 0.25, g: 0.08 }); },
  };
  SFX.levelUp = SFX.levelup;
  SFX.welcome = stingerSfx('welcome');
  SFX.jing = (S, t) => gk(S, 'jing', t, { f: 146, vel: 0.3, dur: 4 });
  SFX.bak = (S, t) => gk(S, 'bak', t, { vel: 0.45 });
  SFX.moktak = (S, t) => gk(S, 'moktak', t, { vel: 0.4 });
  /** per-effect trim (the timbre changed — the loudness must not: measured against the old effects) */
  const TRIM = {
    click: 0.45, tap: 0.45, open: 0.21, close: 0.14, notify: 0.7, error: 0.26, oops: 0.24, coin: 0.58, reward: 0.36, quest: 0.4, welcome: 0.4,
    levelup: 0.5, levelUp: 0.5, festival: 0.45, achievement: 0.27, harvest: 0.39, plant: 0.32, craft: 0.41, shutter: 0.66, jump2: 0.34, chat: 0.44,
    emote: 0.25, teleport: 0.25, correct: 0.34, sparkle: 0.4, stamp: 0.45, pop: 0.34, unlock: 0.45, lock: 0.6, pickup: 0.6,
    land_wood: 0.5, land_earth: 0.5, land_stone: 0.8,
  };

  // ================================================================= nature calls (ambient bus)
  // each fn(S, t, g, pan, extra) → end time. g already holds the distance / time-of-day level.
  const NAT = {
    // ---- birds (several species, each with its own call shape)
    sparrow(S, t, g, pan) {        // 참새: short chirps
      const n = randInt(3, 7), f0 = rand(3900, 4800), gap = rand(0.09, 0.15);
      for (let i = 0; i < n; i++) { const f = f0 * rand(0.92, 1.06); tone(S, { type: 'sine', f, f2: f * rand(0.72, 0.84), glide: 0.025, t: t + i * gap + rand(0, 0.02), a: 0.003, d: rand(0.03, 0.05), g: g * rand(0.7, 1), pan, wet: 0.4, lp: 6800 }); }
      return t + n * gap + 0.1;
    },
    tit(S, t, g, pan) {            // 박새: "쯔삐 쯔삐" — high, then lower
      const reps = randInt(3, 5), f1 = rand(5000, 5600), sp = rand(0.3, 0.38);
      for (let r = 0; r < reps; r++) {
        tone(S, { type: 'sine', f: f1, f2: f1 * 0.97, t: t + r * sp, a: 0.004, d: 0.07, g: g * 0.8, pan, wet: 0.4, lp: 6500 });
        tone(S, { type: 'sine', f: f1 * 0.74, f2: f1 * 0.71, t: t + r * sp + 0.12, a: 0.005, d: 0.1, g: g * 0.75, pan, wet: 0.4, lp: 6500 });
      }
      return t + reps * sp + 0.2;
    },
    magpie(S, t, g, pan) {         // 까치: "깍깍깍" — a dry chatter, kept soft
      const n = randInt(3, 6), gap = rand(0.13, 0.17);
      for (let i = 0; i < n; i++) {
        const tt = t + i * gap;
        tone(S, { type: 'sawtooth', f: rand(1150, 1350), f2: rand(950, 1050), glide: 0.08, t: tt, a: 0.008, d: 0.09, g: g * 0.35, lp: 2200, lpq: 2.5, pan, wet: 0.35 });
        noise(S, { kind: 'pink', ft: 'bandpass', f: 1800, q: 2, t: tt, a: 0.006, d: 0.08, g: g * 0.6, pan });
      }
      return t + n * gap + 0.1;
    },
    warbler(S, t, g, pan) {        // 휘파람새: a long rising whistle, then the quick flourish
      tone(S, { type: 'sine', f: rand(1050, 1200), f2: rand(1300, 1450), glide: 1.0, exp: false, t, a: 0.25, d: 0.5, sus: 0.6, g: g * 0.7, pan, wet: 0.5 });
      const t2 = t + 1.55;
      [[2300, 0.07], [2950, 0.06], [2100, 0.2]].reduce((tt, [f, d]) => { tone(S, { type: 'sine', f, f2: f * 0.96, t: tt, a: 0.006, d, g: g * 0.75, pan, wet: 0.5 }); return tt + d + 0.04; }, t2);
      return t2 + 0.6;
    },
    oriole(S, t, g, pan) {         // 꾀꼬리: a fluty, melodious phrase
      let tt = t;
      for (const f of [1500, 2100, 1720, 2280, 1800].slice(0, randInt(3, 5))) {
        const d = rand(0.1, 0.18);
        tone(S, { type: 'sine', f: f * rand(0.97, 1.03), f2: f * rand(1.02, 1.1), t: tt, a: 0.02, d, g: g * 0.8, pan, wet: 0.5, vib: { rate: 22, depth: 25, delay: 0.02 } });
        tt += d + rand(0.03, 0.08);
      }
      return tt + 0.1;
    },
    cuckoo(S, t, g, pan) {         // 뻐꾸기: "뻐-꾹" across the valley (a falling minor third), distant
      const reps = randInt(3, 6);
      for (let r = 0; r < reps; r++) {
        tone(S, { pan, wet: 0.9, type: 'sine', f: 690, f2: 680, t: t + r * 0.92, a: 0.02, d: 0.28, g: g * 0.9, lp: 2000 });
        tone(S, { pan, wet: 0.9, type: 'sine', f: 575, f2: 562, t: t + r * 0.92 + 0.32, a: 0.02, d: 0.4, g: g * 0.85, lp: 2000 });
      }
      return t + reps * 0.92 + 0.5;
    },
    dove(S, t, g, pan) {           // 멧비둘기: "구구 구구" — low soft coos
      let tt = t;
      [0.3, 0.2, 0.18, 0.32].forEach((d, i) => { tone(S, { type: 'sine', f: i === 0 ? 470 : 500, f2: 455, t: tt, a: 0.06, d, g: g * 0.9, lp: 1200, pan, wet: 0.6 }); tt += d + 0.12; });
      return tt + 0.2;
    },
    woodpecker(S, t, g, pan) {     // 딱따구리: a drumming roll on a dead trunk, in the forest
      const n = randInt(14, 22), rate = rand(16, 20), f = rand(1100, 1500);
      for (let i = 0; i < n; i++) noise(S, { kind: 'white', ft: 'bandpass', f, q: 5, t: t + i / rate, a: 0.001, d: 0.016, g: g * (1 - i / n * 0.6) * 1.4, pan, wet: 0.7 });
      return t + n / rate + 0.1;
    },
    scops(S, t, g, pan) {          // 소쩍새 at night: "소쩍 … 소쩍"
      const reps = randInt(4, 9), sp = rand(1.8, 2.4);
      for (let r = 0; r < reps; r++) {
        tone(S, { type: 'sine', f: 720, f2: 700, t: t + r * sp, a: 0.02, d: 0.12, g: g * 0.8, lp: 1600, pan, wet: 0.8 });
        tone(S, { type: 'sine', f: 860, f2: 830, t: t + r * sp + 0.2, a: 0.015, d: 0.1, g: g * 0.75, lp: 1600, pan, wet: 0.8 });
      }
      return t + reps * sp + 0.4;
    },
    owl(S, t, g, pan) {            // 수리부엉이 on winter nights: a deep "부-엉"
      const reps = randInt(2, 3);
      for (let r = 0; r < reps; r++) {
        tone(S, { type: 'sine', f: 330, f2: 320, t: t + r * 2.4, a: 0.05, d: 0.25, g: g * 1.1, lp: 900, pan, wet: 0.9 });
        tone(S, { type: 'sine', f: 296, f2: 286, t: t + r * 2.4 + 0.45, a: 0.06, d: 0.4, g: g, lp: 900, pan, wet: 0.9 });
      }
      return t + reps * 2.4 + 0.6;
    },
    // ---- insects and frogs
    cricket(S, t, g, pan, f) { for (let k = 0; k < 3; k++) tone(S, { type: 'sine', f, t: t + k * 0.044, a: 0.003, d: 0.026, g, pan }); return t + 0.17; },
    bellCricket(S, t, g, pan) {    // 방울벌레: a pure, bell-like trill
      const f = rand(4200, 4500), dur = rand(1.1, 2.2), n = Math.floor(dur * 26);
      for (let i = 0; i < n; i++) tone(S, { type: 'sine', f, t: t + i / 26, a: 0.003, d: 0.022, g: g * (0.6 + 0.4 * Math.sin(Math.PI * i / n)), pan });
      return t + dur + 0.1;
    },
    cicada(S, t, g, pan, dur) {    // 참매미: "맴맴맴 …" pulses through a resonant band-pass
      const ac = S.ac;
      const os = ac.createOscillator(); os.type = 'square'; os.frequency.value = rand(4100, 4700);
      const bp = filter(ac, 'bandpass', os.frequency.value, 5), lp = filter(ac, 'lowpass', 5600, 0.7);
      const gg = ac.createGain(); gg.gain.setValueAtTime(0, t);
      const n = Math.max(1, Math.floor(dur / 0.36));
      for (let i = 0; i < n; i++) {
        const tt = t + i * 0.36, sw = Math.sin((i / n) * Math.PI);
        gg.gain.setValueAtTime(0.0001, tt);
        gg.gain.linearRampToValueAtTime(g * (0.25 + 0.75 * sw), tt + 0.05);
        gg.gain.setValueAtTime(g * (0.25 + 0.75 * sw), tt + 0.22);
        gg.gain.linearRampToValueAtTime(0.0001, tt + 0.3);
      }
      const chain = [bp, lp, gg];
      os.connect(bp); bp.connect(lp); lp.connect(gg); route(S, gg, { pan, wet: 0.3 }, chain);
      os.start(t); os.stop(t + n * 0.36 + 0.1);
      trackSrc(S, os, chain);
      return t + n * 0.36;
    },
    cicadaChorus(S, t, g, pan, dur) { // 말매미: a hot afternoon's rushing chorus (a band of noise that swells and fades)
      const ac = S.ac, end = t + dur + 0.2;
      const src = ac.createBufferSource(); src.buffer = S.buf.white; src.loop = true;
      const bp = filter(ac, 'bandpass', rand(4600, 5400), 3), lp = filter(ac, 'lowpass', 6000, 0.7), gg = ac.createGain();
      gg.gain.setValueAtTime(0.0001, t);
      gg.gain.linearRampToValueAtTime(g, t + dur * 0.35);
      gg.gain.linearRampToValueAtTime(g * 0.8, t + dur * 0.7);
      gg.gain.linearRampToValueAtTime(0.0001, t + dur);
      const chain = [bp, lp, gg];
      src.connect(bp); bp.connect(lp); lp.connect(gg); route(S, gg, { pan, wet: 0.2 }, chain);
      src.start(t, Math.random()); src.stop(end);
      trackSrc(S, src, chain);
      return end;
    },
    frog(S, t, g, pan) {           // 참개구리 near water
      const reps = randInt(2, 4), f = rand(105, 165);
      for (let r = 0; r < reps; r++) tone(S, { type: 'sawtooth', f, f2: f * 0.86, t: t + r * rand(0.17, 0.24), a: 0.012, d: 0.11, g, lp: 650, lpq: 3.5, pan, wet: 0.3 });
      return t + reps * 0.24;
    },
    treefrog(S, t, g, pan) {       // 청개구리: "개굴개굴" — bright, quick rattles
      const bursts = randInt(2, 3);
      let tt = t;
      for (let b = 0; b < bursts; b++) {
        const n = randInt(5, 9);
        for (let i = 0; i < n; i++) tone(S, { type: 'sawtooth', f: rand(620, 760), t: tt + i * 0.085, a: 0.004, d: 0.04, g: g * 0.7, lp: 1500, lpq: 4, pan });
        tt += n * 0.085 + rand(0.25, 0.5);
      }
      return tt;
    },
    maengkkong(S, t, g, pan) {     // 맹꽁이 in the early-summer rain: "맹 … 꽁"
      tone(S, { type: 'triangle', f: 385, f2: 370, t, a: 0.02, d: 0.14, g, lp: 900, pan, wet: 0.4 });
      tone(S, { type: 'triangle', f: 300, f2: 285, t: t + rand(0.4, 0.7), a: 0.02, d: 0.16, g: g * 0.9, lp: 900, pan: -pan, wet: 0.4 });
      return t + 1;
    },
    // ---- weather, fire, jars, bells
    thunder(S, t, g, pan) {        // a soft, distant roll (never a crack in the ears)
      const ac = S.ac, dur = rand(3.5, 6.5), end = t + dur + 0.5;
      const src = ac.createBufferSource(); src.buffer = S.buf.brown; src.loop = true;
      const lp = filter(ac, 'lowpass', rand(140, 220), 0.8), gg = ac.createGain();
      gg.gain.setValueAtTime(0.0001, t);
      gg.gain.linearRampToValueAtTime(g * 0.5, t + 0.5);
      for (let k = 0.6; k < dur; k += rand(0.35, 0.8)) gg.gain.linearRampToValueAtTime(g * rand(0.3, 1), t + k);
      gg.gain.linearRampToValueAtTime(0.0001, t + dur);
      lp.frequency.setValueAtTime(lp.frequency.value * 1.6, t); lp.frequency.exponentialRampToValueAtTime(lp.frequency.value, t + 1.2);
      const chain = [lp, gg];
      src.connect(lp); lp.connect(gg); route(S, gg, { pan, wet: 0.6 }, chain);
      src.start(t, Math.random()); src.stop(end);
      trackSrc(S, src, chain);
      return end;
    },
    crackle(S, t, g, pan) {        // a log in the 아궁이 cracks
      const n = randInt(1, 4);
      for (let i = 0; i < n; i++) noise(S, { kind: 'white', ft: 'bandpass', f: rand(2200, 5200), q: 2, t: t + rand(0, 0.08), a: 0.0006, d: rand(0.005, 0.02), g: g * rand(0.5, 1), pan });
      if (Math.random() < 0.25) tone(S, { type: 'sine', f: rand(240, 420), f2: rand(150, 200), t, a: 0.002, d: 0.05, g: g * 0.5, pan });
      return t + 0.15;
    },
    bubbleJar(S, t, g, pan) {      // a fermenting jar breathes: a slow "블룹"
      const f = rand(180, 420);
      tone(S, { type: 'sine', f, f2: f * rand(1.5, 1.9), glide: 0.05, t, a: 0.006, d: 0.07, g, pan, lp: 1400, wet: 0.3 });
      if (Math.random() < 0.3) tone(S, { type: 'sine', f: f * 1.3, f2: f * 2, glide: 0.04, t: t + rand(0.1, 0.25), a: 0.005, d: 0.05, g: g * 0.6, pan, lp: 1400 });
      return t + 0.4;
    },
    windbell(S, t, g, pan) {       // 풍경 under the eaves
      const L = GK();
      if (!L || !S.K?.buf) return bell(S, rand(1500, 1900), t, g * 0.3, 2.4, { pan, wet: 0.7 });
      const p = panNode(S.ac, pan), out = gainNode(S.ac, 1);
      if (p) { out.connect(p); p.connect(S.out); } else out.connect(S.out);
      if (S.wet) { const s = gainNode(S.ac, 0.6); out.connect(s); s.connect(S.wet); }
      const end = L.INST.pungkyeong(S.K, t, { f: rand(1450, 1850), vel: clamp(g * 25, 0, 1), dur: rand(2.4, 3.6), double: Math.random() < 0.5 ? rand(0.12, 0.25) : 0, dest: out });
      // the private out / pan are freed with a silent keeper source
      const keep = S.ac.createBufferSource(); keep.buffer = S.buf.white; const z = gainNode(S.ac, 0); keep.connect(z); z.connect(out);
      keep.start(t); keep.stop(end); trackSrc(S, keep, [z, out, ...(p ? [p] : [])]);
      return end;
    },
    tileDrip(S, t, g, pan) {       // rain on 기와 tiles / dripping from the eaves
      return tone(S, { type: 'sine', f: rand(1900, 3300), f2: rand(1300, 2000), glide: 0.03, t, a: 0.001, d: rand(0.025, 0.05), g, pan });
    },
  };

  // ================================================================= reverb + mastering
  function makeImpulse(ac, seconds = 2.4) {
    const sr = ac.sampleRate, len = Math.floor(sr * seconds);
    const b = ac.createBuffer(2, len, sr);
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        const tt = i / sr;
        const env = Math.pow(1 - i / len, 2.2) * Math.exp(-tt * 1.6);
        const coef = lerp(0.85, 0.12, Math.min(1, tt / seconds));
        lp += (Math.random() * 2 - 1 - lp) * coef;
        d[i] = lp * env * (i < sr * 0.012 ? i / (sr * 0.012) : 1);
      }
    }
    return b;
  }
  let SOFT_CURVE = null;
  function softClipCurve() {
    if (SOFT_CURVE) return SOFT_CURVE;
    const n = 2048, c = new Float32Array(n), knee = 0.7, room = 1 - knee - 0.02;
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1, ax = Math.abs(x);
      const y = ax <= knee ? ax : knee + room * Math.tanh((ax - knee) / room);
      c[i] = x < 0 ? -y : y;
    }
    SOFT_CURVE = c;
    return c;
  }
  /** trim → limiter → soft clip → dest; returns {input, limiter, clip} */
  function buildMaster(ac, dest) {
    const input = gainNode(ac, 0.92);
    const limiter = ac.createDynamicsCompressor();
    limiter.threshold.value = -9; limiter.knee.value = 6; limiter.ratio.value = 12;
    limiter.attack.value = 0.002; limiter.release.value = 0.22;
    let clip = null;
    try { clip = ac.createWaveShaper(); clip.curve = softClipCurve(); clip.oversample = '2x'; } catch (e) { clip = null; }
    input.connect(limiter);
    if (clip) { limiter.connect(clip); clip.connect(dest); } else limiter.connect(dest);
    return { input, limiter, clip };
  }

  // ================================================================= season / month helpers
  const SEASONS = { spring: 'spring', summer: 'summer', autumn: 'autumn', fall: 'autumn', winter: 'winter', 봄: 'spring', 여름: 'summer', 가을: 'autumn', 겨울: 'winter' };
  function kstMonth() { // 1..12 by the Korean wall clock
    try { const n = G.env?.now?.(); const ms = typeof n === 'number' ? n : n instanceof Date ? n.getTime() : Date.now(); return new Date(ms + 9 * 3600e3).getUTCMonth() + 1; } catch (e) { return new Date().getMonth() + 1; }
  }
  function seasonOf(month) { return month >= 3 && month <= 5 ? 'spring' : month >= 6 && month <= 8 ? 'summer' : month >= 9 && month <= 11 ? 'autumn' : 'winter'; }
  function seasonNow(month) {
    try { const s = G.env?.season?.(); const v = typeof s === 'string' ? s : s?.id || s?.name; if (v && SEASONS[v]) return SEASONS[v]; } catch (e) { /* fallback */ }
    return seasonOf(month);
  }
  const inMonths = (m, a, b) => (a <= b ? m >= a && m <= b : m >= a || m <= b);

  // ================================================================= the engine (one per context)
  /**
   * createEngine(ac, {dest, offline, rng}) -> E
   *   E.update(dt, W)   music + nature for the situation W (see situation()); W.now = ac.currentTime
   *   E.playSfx(name, o) · E.setLevels(levels, instant) · E.setDuck(music, nature) · E.n (nodes) · E.stats()
   */
  function createEngine(ac, opts = {}) {
    const n = {};
    n.out = buildMaster(ac, opts.dest || ac.destination);
    n.limiter = n.out.limiter;
    n.master = gainNode(ac, 0); n.master.connect(n.out.input);
    n.music = gainNode(ac, 0); n.duck = gainNode(ac, 1); n.music.connect(n.duck); n.duck.connect(n.master);
    n.moodFade = gainNode(ac, 1); n.moodFade.connect(n.music);
    n.sfx = gainNode(ac, 0); n.sfx.connect(n.master);
    n.amb = gainNode(ac, 0); n.ambDuck = gainNode(ac, 1); n.amb.connect(n.ambDuck); n.ambDuck.connect(n.master);
    // the sounds of the outside pass a low-pass that closes when the player is indoors (walls and paper windows)
    n.outdoor = gainNode(ac, 1); n.outLp = filter(ac, 'lowpass', 18000, 0.5); n.outdoor.connect(n.outLp); n.outLp.connect(n.amb);
    n.verb = ac.createConvolver();
    try { n.verb.buffer = makeImpulse(ac, 2.4); } catch (e) { /* no reverb */ }
    n.verbOut = gainNode(ac, 0.9); n.verb.connect(n.verbOut); n.verbOut.connect(n.master);
    n.sfxWet = gainNode(ac, 0); n.sfxWet.connect(n.verb);
    n.ambWet = gainNode(ac, 0); n.ambWet.connect(n.verb);
    n.musicWet = gainNode(ac, 0.42); n.duck.connect(n.musicWet); n.musicWet.connect(n.verb);
    const L = GK();
    const buf = L ? { white: L.noiseBuffer(ac, 'white', 2.5), pink: L.noiseBuffer(ac, 'pink', 2.5), brown: L.noiseBuffer(ac, 'brown', 2.5) } : null;
    const K = L ? L.kit(ac, n.moodFade, { buf }) : { live: 0, made: 0, ended: 0, buf: null };
    // the effects and nature contexts share the buffers and the string cache of the music kit, but route to their buses
    const mk = (out, wet) => {
      const Kx = L ? L.kit(ac, out, { buf, channels: false }) : { live: 0, made: 0, ended: 0, buf: null };
      if (L) { Kx.ks = K.ks; Kx.ksOrder = K.ksOrder; Kx.waves = K.waves = K.waves || {}; }
      return { ac, out, wet, buf: buf || {}, K: Kx };
    };
    const S = mk(n.sfx, n.sfxWet), SA = mk(n.outdoor, n.ambWet);
    const r = opts.rng || Math.random;
    const E = {
      ac, n, K, S, SA, offline: !!opts.offline,
      voices: { music: [], nature: [], sfx: [] }, dropped: { music: 0, nature: 0, sfx: 0 }, maxVoices: 0,
      levels: { master: 0, music: 0, sfx: 0, ambient: 0 },
      mus: { comp: L ? new L.Composer({ rng: opts.rng }) : null, queue: [], cursor: ac.currentTime + (opts.musicDelay ?? 1.2), musicEnd: 0, mood: null, want: opts.mood || 'day', wantSince: 0, fading: false, info: null, playing: false, forced: opts.mood || null },
      nat: null, emitters: opts.emitters || null,
    };
    // ---------------------------------------------------------------- voices
    E.count = function (bus, now) {
      const a = E.voices[bus];
      let i = 0;
      while (i < a.length) { if (a[i] <= now) { a[i] = a[a.length - 1]; a.pop(); } else i++; }
      return a.length;
    };
    E.total = function (now) { return E.count('music', now) + E.count('nature', now) + E.count('sfx', now); };
    E.admit = function (bus, now, prio = 2) {
      const c = E.count(bus, now), cap = CAPS[bus];
      if (c >= cap || (prio <= 1 && c >= cap - 3)) { E.dropped[bus]++; return false; }
      return true;
    };
    E.hold = function (bus, end, now) {
      E.voices[bus].push(Math.max(now + 0.05, Math.min(end, now + 12)));
      const tot = E.total(now); if (tot > E.maxVoices) E.maxVoices = tot;
    };
    // ---------------------------------------------------------------- levels and ducks
    E.setLevels = function (lv, instant) {
      E.levels = lv;
      const now = ac.currentTime, tc = instant ? 0.001 : 0.06;
      const set = (p, v) => { p.cancelScheduledValues(now); p.setTargetAtTime(v, now, tc); };
      set(n.master.gain, lv.master);
      set(n.music.gain, lv.music * BASE.music);
      set(n.sfx.gain, lv.sfx * BASE.sfx);
      set(n.amb.gain, lv.ambient * BASE.ambient);
      set(n.sfxWet.gain, lv.sfx * BASE.sfx * 0.5);
      set(n.ambWet.gain, lv.ambient * BASE.ambient * 0.4);
    };
    E.setDuck = function (gm, ga) {
      const now = ac.currentTime;
      n.duck.gain.cancelScheduledValues(now); n.duck.gain.setTargetAtTime(gm, now, gm < 1 ? 0.12 : 0.6);
      n.ambDuck.gain.cancelScheduledValues(now); n.ambDuck.gain.setTargetAtTime(ga, now, ga < 1 ? 0.25 : 0.8);
    };
    // ---------------------------------------------------------------- effects
    E.playSfx = function (name, o = {}) {
      const fn = SFX[name];
      if (!fn) return null;
      const now = ac.currentTime;
      if (!E.admit('sfx', now, 3)) return null;
      const out = gainNode(ac, clamp((o.volume ?? 1) * (TRIM[name] ?? 1), 0, 2));
      let head = out;
      const p = panNode(ac, o.pan || 0);
      if (p) { out.connect(p); head = p; }
      head.connect(n.sfx);
      S.out = out;
      S.wet = WET[name] ? n.sfxWet : null;
      const t = (o.t ?? now) + 0.006;
      let end = fn(S, t, o) || t + 0.4;
      if (!Number.isFinite(end)) end = t + 0.5;
      E.hold('sfx', end, now);
      // free the per-call gain / pan once everything under it has ended (a silent keeper source)
      const keep = ac.createBufferSource(); keep.buffer = buf?.white || ac.createBuffer(1, 16, ac.sampleRate);
      const z = gainNode(ac, 0); keep.connect(z); z.connect(out);
      keep.start(t); keep.stop(Math.min(end, t + 12) + 0.3);
      trackSrc(S, keep, [z, out, ...(p ? [p] : [])]);
      S.out = n.sfx;
      return end;
    };
    E.playEvents = function (events, dest) { // stingers etc. on a bus
      if (!L) return 0;
      let end = 0;
      for (const e of events) end = Math.max(end, L.INST[e.inst](K, e.t, { ...e, dest: dest || undefined }));
      return end;
    };
    // ---------------------------------------------------------------- music
    E.moodFor = function (W) {
      if (W.festival) return 'festival';
      if (W.indoor) return 'room';
      if (W.snow > 0.4) return 'snow';
      if (W.rain > 0.4) return 'rain';
      if (W.night > 0.55) return 'night';
      const h = W.hour;
      if (W.phase === 'EVENING' || (h >= 17.2 && h < 19.6)) return 'evening';
      if (h >= 4.8 && h < 8.2) return 'morning';
      return W.complex ? 'complex' : 'day';
    };
    E.updateMusic = function (W) {
      const M = E.mus, now = ac.currentTime;
      if (!M.comp) return;
      const audible = E.levels.music > 0.002 && E.levels.master > 0.0001 && W.musicOn !== false;
      if (!audible) {
        if (M.playing) { M.playing = false; M.queue.length = 0; n.moodFade.gain.cancelScheduledValues(now); n.moodFade.gain.setTargetAtTime(0.0001, now, 0.4); }
        M.cursor = now + 1.5; M.mood = null;
        return;
      }
      M.playing = true;
      const want = M.forced || E.moodFor(W);
      if (want !== M.want) { M.want = want; M.wantSince = now; }
      // a mood change (stable for 4 s): fade the running section out over ~3 s, then begin the new mood
      if (M.mood && M.want !== M.mood && now - M.wantSince > (M.forced ? 0 : 4) && !M.fading) {
        M.fading = true;
        n.moodFade.gain.cancelScheduledValues(now);
        n.moodFade.gain.setTargetAtTime(0.0001, now, 0.9);
        M.queue = M.queue.filter((e) => e.t < now + 0.4);
        M.cursor = now + 3.6;
      }
      if (!M.queue.length && now >= M.cursor - 0.6) {
        const t0 = Math.max(M.cursor, now + 0.3);
        if (M.fading || M.mood !== M.want) { M.mood = M.want; M.fading = false; }
        n.moodFade.gain.cancelScheduledValues(t0 - 0.05);
        n.moodFade.gain.setTargetAtTime(1, t0 - 0.05, 0.7);
        const sec = M.comp.section(M.mood, t0, M.force || null);
        M.queue = sec.events; M.cursor = sec.end; M.musicEnd = sec.musicEnd; M.info = sec.info;
      }
      // dispatch what falls into the next 0.6 s
      while (M.queue.length && M.queue[0].t < now + 0.6) {
        const ev = M.queue.shift();
        if (ev.t < now - 0.03) continue;
        if (!E.admit('music', now, ev.prio ?? 2)) continue;
        let end = ev.t + 1;
        try { end = L.play(K, ev); } catch (e) { G.log.debug('AUDIO', 'note failed', ev.inst, e); }
        E.hold('music', end, now);
      }
    };
    // ---------------------------------------------------------------- nature beds (persistent)
    E.buildNature = function () {
      if (!buf) return;
      const loop = (b, rate = 1) => { const s = ac.createBufferSource(); s.buffer = b; s.loop = true; s.playbackRate.value = rate; s.start(ac.currentTime, Math.random() * 1.5); return s; };
      const A = {};
      const bed = (src, filters, dest, pan) => {
        let last = src;
        for (const f of filters) { last.connect(f); last = f; }
        const g = gainNode(ac, 0.0001); last.connect(g);
        let p = null;
        if (pan) { p = panNode(ac, 0.001); }
        if (p) { g.connect(p); p.connect(dest); } else g.connect(dest);
        return { g, p, f: filters };
      };
      // wind: pink noise, slowly wandering low-pass (+ flutter)
      A.wind = bed(loop(buf.pink, 0.9), [filter(ac, 'lowpass', 520, 0.9)], n.outdoor);
      A.windLfo = ac.createOscillator(); A.windLfo.frequency.value = 0.055;
      A.windLfoG = gainNode(ac, 260); A.windLfo.connect(A.windLfoG); A.windLfoG.connect(A.wind.f[0].frequency); A.windLfo.start();
      // 솔바람: the soughing of the wind in pine needles — a breathy band that wanders
      A.pine = bed(loop(buf.white, 0.8), [filter(ac, 'bandpass', 1050, 0.9), filter(ac, 'lowpass', 3200, 0.6)], n.outdoor);
      // leaves of broad-leaved trees: high rustle, modulated in gusts
      A.leaves = bed(loop(buf.pink, 1.1), [filter(ac, 'highpass', 2200, 0.6), filter(ac, 'lowpass', 7000, 0.6)], n.outdoor);
      // the stream / river: babble (band-pass that wanders) + the deep body of the river, panned to the water
      A.stream = bed(loop(buf.white), [filter(ac, 'bandpass', 950, 0.55), filter(ac, 'lowpass', 3400, 0.5)], n.outdoor, true);
      A.river = bed(loop(buf.brown, 0.8), [filter(ac, 'lowpass', 380, 0.6)], n.outdoor, true);
      A.riverBody = bed(loop(buf.pink, 0.7), [filter(ac, 'bandpass', 620, 0.5)], n.outdoor, true);
      A.fall = bed(loop(buf.white, 0.7), [filter(ac, 'highpass', 280, 0.6), filter(ac, 'lowpass', 4600, 0.6)], n.outdoor);
      // rain: on leaves (soft broadband), on the ground (low), on roofs / tiles (bright patter — loud under a roof)
      A.rainLeaves = bed(loop(buf.white, 1.1), [filter(ac, 'highpass', 900, 0.5), filter(ac, 'lowpass', 6500, 0.5)], n.outdoor);
      A.rainGround = bed(loop(buf.pink, 1), [filter(ac, 'lowpass', 1100, 0.6)], n.outdoor);
      A.rainRoof = bed(loop(buf.white, 1.2), [filter(ac, 'bandpass', 2600, 0.7)], n.amb);
      A.rainLow = bed(loop(buf.brown, 1), [filter(ac, 'lowpass', 240, 0.6)], n.outdoor);
      // snow: the hush — a faint, very dark breath of the air
      A.hush = bed(loop(buf.pink, 0.6), [filter(ac, 'lowpass', 380, 0.5)], n.outdoor);
      // room tone of a timber room (only indoors) and the fire of the 아궁이 (panned to it)
      A.room = bed(loop(buf.brown, 0.55), [filter(ac, 'lowpass', 210, 0.5)], n.amb);
      A.fire = bed(loop(buf.brown, 1.3), [filter(ac, 'lowpass', 800, 0.6)], n.amb, true);
      const t = ac.currentTime;
      A.next = { bird: t + rand(1, 3), gust: t + rand(5, 10), babble: t, bubble: t + 1, drip: t + 1, frog: t + rand(3, 8), cicada: t + rand(20, 50), chorus: t + rand(40, 90),
        creak: t + rand(8, 20), crackle: t, jar: t + 2, bell: t + rand(3, 8), bellCricket: t + rand(4, 9), maeng: t + rand(3, 6), tree: t + rand(5, 10), pine: t, leaves: t };
      A.crickets = [0, 1, 2, 3].map((i) => ({ f: rand(4300, 5300), period: rand(0.55, 0.95), pan: (i - 1.5) * 0.4 + rand(-0.1, 0.1), g: rand(0.012, 0.022), next: t + rand(0.2, 1.5), on: true, toggle: t + rand(6, 20) }));
      A.gusting = false; A.gustEnd = 0; A.lastLight = 0; A.thunderAt = 0;
      E.nat = A;
    };
    // the situation is applied every 0.25 s; events are scheduled on the audio clock
    E.updateNature = function (W, dt) {
      const A = E.nat;
      if (!A) return;
      const now = ac.currentTime;
      const set = (p, v, tc) => p.setTargetAtTime(v, now, tc);
      E._natT = (E._natT ?? 0) - dt;
      const on = W.natureOn !== false;
      if (E._natT <= 0) {
        E._natT = 0.25;
        const inside = W.indoor ? 1 : 0;
        // indoors: the outside comes through walls and paper windows — quieter and duller
        set(n.outLp.frequency, inside ? 760 : 18000, 0.5);
        set(n.outdoor.gain, on ? (inside ? 0.5 : 1) : 0.0001, 0.6);
        const wind = clamp(W.wind ?? 1, 0, 3);
        const windBase = ({ CLEAR: 0.055, CLOUDY: 0.08, RAIN: 0.095, FOG: 0.04, SNOW: 0.1 }[W.weather] ?? 0.06) * (0.55 + wind * 0.45) * (1 + W.night * 0.12);
        A.windBase = windBase;
        if (!A.gusting || now > A.gustEnd) { A.gusting = false; set(A.wind.g.gain, windBase, 1.5); }
        const forest = clamp(W.forest ?? 0.3, 0, 1);
        A.pineLevel = 0.06 * forest * clamp(wind, 0.2, 2.5) * (W.season === 'winter' ? 1.15 : 1);
        set(A.pine.g.gain, A.pineLevel * (A.gusting ? 1.6 : 1), 1.2);
        A.leafLevel = (W.season === 'winter' ? 0.004 : 0.018) * forest * clamp(wind, 0, 2.5);
        // water by distance (river, streams, ponds) + its direction
        const dw = Number.isFinite(W.waterDist) ? W.waterDist : Infinity;
        const near = Number.isFinite(dw) ? clamp(1 - dw / 45, 0, 1) : 0;
        const far = Number.isFinite(dw) ? clamp(1 - dw / 140, 0, 1) : 0;
        A.water = near;
        const rainDamp = 1 - W.rain * 0.3;
        set(A.stream.g.gain, 0.34 * Math.pow(near, 1.7) * rainDamp * (W.waterSmall ? 1.2 : 1), 0.4);
        set(A.river.g.gain, (0.2 * Math.pow(far, 2) + 0.12 * Math.pow(near, 1.5)) * (W.waterSmall ? 0.3 : 1), 0.6);
        set(A.riverBody.g.gain, 0.08 * Math.pow(far, 2.2) * (W.waterSmall ? 0.3 : 1), 0.6);
        const wp = clamp(W.waterPan ?? 0, -0.8, 0.8) * (1 - near * 0.4);
        for (const b of [A.stream, A.river, A.riverBody]) if (b.p) set(b.p.pan, wp, 0.5);
        set(A.fall.g.gain, 0.28 * Math.pow(clamp(W.fall ?? 0, 0, 1), 1.6), 0.4);
        // rain
        const rain = W.rain;
        set(A.rainLeaves.g.gain, 0.15 * rain * (0.4 + forest * 0.6), 1.2);
        set(A.rainGround.g.gain, 0.12 * rain, 1.2);
        set(A.rainRoof.g.gain, 0.09 * rain * (inside ? 1.2 : (W.eaves ? 0.6 : 0.05)), 0.8);
        set(A.rainLow.g.gain, 0.3 * rain * rain, 1.5);
        set(A.hush.g.gain, 0.05 * W.snow, 2);
        set(A.room.g.gain, inside ? 0.05 : 0.0001, 0.6);
        // fire (the 아궁이 / 화로 within ~10 m)
        const fire = W.fire;
        A.fireNear = fire ? clamp(1 - fire.d / 10, 0, 1) : 0;
        set(A.fire.g.gain, 0.13 * Math.pow(A.fireNear, 1.4), 0.5);
        if (A.fire.p && fire) set(A.fire.p.pan, clamp(fire.pan ?? 0, -0.8, 0.8), 0.4);
      }
      if (!on) return;
      const S2 = SA;
      S2.out = n.outdoor;
      const call = (fnName, gl, pan, extra, prio = 2) => {
        if (!E.admit('nature', now, prio)) return;
        const end = NAT[fnName](S2, now + 0.05, gl, pan, extra);
        E.hold('nature', end, now);
      };
      // babbling: wander the band-pass centre; small bubbles close to the water
      if (A.water > 0.02 && now >= A.next.babble) { A.next.babble = now + rand(0.12, 0.35); A.stream.f[0].frequency.setTargetAtTime(rand(700, 1500), now, 0.12); }
      if (A.water > 0.3 && now >= A.next.bubble) {
        A.next.bubble = now + rand(0.15, 0.6) / A.water;
        if (E.admit('nature', now, 1)) { S2.out = A.stream.p || n.outdoor; const f = rand(450, 1150); E.hold('nature', tone(S2, { type: 'sine', f, f2: f * rand(1.6, 2.1), glide: 0.03, t: now + 0.02, a: 0.003, d: 0.045, g: 0.026 * A.water }), now); S2.out = n.outdoor; }
      }
      // the pine band wanders slowly (the 솔바람 rises and falls)
      if (now >= A.next.pine) { A.next.pine = now + rand(1.5, 4); A.pine.f[0].frequency.setTargetAtTime(rand(800, 1400), now, 1.2); }
      // leaves rustle in waves
      if (now >= A.next.leaves) {
        A.next.leaves = now + rand(0.3, 1.2);
        const lv = (A.leafLevel || 0) * rand(0.3, 1.4) * (A.gusting ? 1.8 : 1);
        A.leaves.g.gain.setTargetAtTime(lv, now, rand(0.15, 0.5));
      }
      // wind gusts
      if (now >= A.next.gust) {
        A.next.gust = now + rand(7, 18) / clamp(W.wind ?? 1, 0.5, 2);
        const peak = A.windBase * rand(1.6, 2.4), len = rand(2, 4.5);
        A.gusting = true; A.gustEnd = now + len * 2;
        A.wind.g.gain.cancelScheduledValues(now);
        A.wind.g.gain.setTargetAtTime(peak, now, len * 0.3);
        A.wind.g.gain.setTargetAtTime(A.windBase, now + len, len * 0.4);
        A.wind.f[0].frequency.cancelScheduledValues(now);
        A.wind.f[0].frequency.setTargetAtTime(rand(700, 1000), now, len * 0.3);
        A.wind.f[0].frequency.setTargetAtTime(520, now + len, len * 0.4);
      }
      const m = W.month, season = W.season, hour = W.hour;
      const quiet = W.rain > 0.3 || W.snow > 0.5;
      const dawn = hour >= 4.6 && hour < 7.6 ? 1 : 0;
      const indoorK = W.indoor ? 0.45 : 1;
      // ---- birds by day (and owls at night)
      if (now >= A.next.bird) {
        const winter = season === 'winter';
        const rate = (dawn ? 2.8 : 1) * (winter ? 0.45 : 1) * (W.fog > 0.5 ? 0.6 : 1) * (quiet ? 0.15 : 1);
        A.next.bird = now + rand(2, 6) / Math.max(0.15, rate);
        const day = 1 - W.night;
        const forest = W.forest ?? 0.3;
        if (day > 0.45 && !quiet) {
          const list = [
            ['sparrow', 3.5 * (1 - forest * 0.6)], ['tit', 2.5], ['magpie', 1.2 * (1 - forest * 0.5)], ['dove', hour < 11 ? 1.4 : 0.6],
            ['warbler', inMonths(m, 3, 7) ? 2 * (0.4 + forest) : 0], ['oriole', inMonths(m, 5, 7) ? 1.4 * (0.4 + forest) : 0],
            ['cuckoo', inMonths(m, 5, 7) && (hour < 11 || hour > 15) ? 1.3 : 0], ['woodpecker', (season === 'spring' ? 1.4 : 0.6) * forest * 1.6],
          ];
          let tot = 0; for (const [, w] of list) tot += w;
          let x = Math.random() * tot, kind = 'sparrow';
          for (const [k, w] of list) { x -= w; if (x <= 0) { kind = k; break; } }
          const dist = rand(8, 60), g = 0.05 * day * indoorK * clamp(1.4 - dist / 60, 0.25, 1) * (kind === 'cuckoo' || kind === 'woodpecker' ? 0.7 : 1);
          call(kind, g, rand(-0.85, 0.85));
        } else if (W.night > 0.6 && !quiet) {
          if (inMonths(m, 4, 8) && Math.random() < 0.35) call('scops', 0.04 * indoorK, rand(-0.8, 0.8));
          else if (inMonths(m, 11, 2) && Math.random() < 0.2) call('owl', 0.045 * indoorK, rand(-0.8, 0.8));
        }
      }
      // ---- inside a timber room: now and then a beam settles
      if (W.indoor && now >= A.next.creak) {
        A.next.creak = now + rand(14, 34);
        if (E.admit('nature', now, 1)) { S2.out = n.amb; const f = rand(150, 230); E.hold('nature', tone(S2, { type: 'triangle', f, f2: f * rand(0.82, 0.93), glide: 0.12, t: now + 0.05, a: 0.02, d: 0.22, g: 0.012, pan: rand(-0.7, 0.7) }), now); S2.out = n.outdoor; }
      }
      // ---- crickets on late-summer and autumn nights (also a little in the evening)
      const cricketSeason = inMonths(m, 8, 10) ? 1 : m === 7 || m === 11 ? 0.35 : 0;
      const eve = W.night > 0.5 ? 1 : hour > 18 && hour < 20 ? 0.4 : 0;
      if (cricketSeason * eve > 0.2 && W.rain < 0.5) {
        for (const c of A.crickets) {
          if (now >= c.toggle) { c.on = Math.random() < 0.75 * cricketSeason; c.toggle = now + rand(5, 18); }
          if (now >= c.next) {
            c.next = now + c.period * rand(0.92, 1.08);
            if (c.on && c.next - now < 2 && E.admit('nature', now, 1)) E.hold('nature', NAT.cricket(S2, now + 0.03, c.g * eve * 1.4 * indoorK, c.pan, c.f), now);
          }
        }
        if (now >= A.next.bellCricket) { A.next.bellCricket = now + rand(5, 14); if (Math.random() < cricketSeason * 0.8) call('bellCricket', 0.012 * eve * indoorK, rand(-0.7, 0.7), null, 1); }
      } else for (const c of A.crickets) c.next = Math.max(c.next, now);
      // ---- frogs: near water on spring / early-summer nights and in rain; tree frogs before the rain; 맹꽁이 in rain
      const wet = clamp((A.water || 0) * 1.6, 0, 1);
      if (now >= A.next.frog) {
        A.next.frog = now + rand(2.5, 7);
        const want = (inMonths(m, 4, 7) ? 1 : inMonths(m, 8, 9) ? 0.3 : 0) * Math.max(W.night, W.rain * 0.6) * wet;
        if (want > 0.25) call('frog', 0.035 * want * indoorK, rand(-0.7, 0.7));
      }
      if (now >= A.next.tree) {
        A.next.tree = now + rand(6, 16);
        const want = inMonths(m, 5, 8) ? (W.weather === 'CLOUDY' || W.rain > 0.1 ? 1 : 0.3) * Math.max(0.3, wet) * (W.night > 0.4 || W.rain > 0.1 ? 1 : 0.35) : 0;
        if (want > 0.3 && Math.random() < want) call('treefrog', 0.03 * want * indoorK, rand(-0.7, 0.7));
      }
      if (now >= A.next.maeng) {
        A.next.maeng = now + rand(2, 5);
        if (inMonths(m, 6, 7) && W.rain > 0.3 && wet > 0.2) call('maengkkong', 0.03 * W.rain * indoorK, rand(-0.6, 0.6), null, 1);
      }
      // ---- cicadas on clear summer days (참매미 in turns; 말매미 choruses in the hot afternoon)
      const cicadaSeason = inMonths(m, 7, 8) ? 1 : m === 6 || m === 9 ? 0.25 : 0;
      if (now >= A.next.cicada) {
        A.next.cicada = now + rand(25, 70) / Math.max(0.2, cicadaSeason);
        if (cicadaSeason && W.weather !== 'RAIN' && W.night < 0.2 && hour >= 9 && hour <= 18) call('cicada', 0.011 * indoorK, rand(-0.6, 0.6), rand(5, 9));
      }
      if (now >= A.next.chorus) {
        A.next.chorus = now + rand(60, 150);
        if (cicadaSeason >= 1 && W.weather === 'CLEAR' && hour >= 12 && hour <= 17) call('cicadaChorus', 0.008 * indoorK, rand(-0.4, 0.4), rand(5, 9));
      }
      // ---- rain drips (outdoors under trees / tiles; from the eaves when indoors)
      if (W.rain > 0.15 && now >= A.next.drip) {
        A.next.drip = now + rand(0.05, 0.25) / W.rain;
        if (E.admit('nature', now, 1)) { S2.out = W.indoor ? n.amb : n.outdoor; E.hold('nature', NAT.tileDrip(S2, now + 0.02, 0.012 * W.rain * (W.indoor ? 0.6 : 1), rand(-0.8, 0.8)), now); S2.out = n.outdoor; }
      }
      // ---- thunder after lightning (soft, distant, 1.5–5 s later)
      if ((W.lightning || 0) > 0.5 && A.lastLight <= 0.5 && !A.thunderAt) A.thunderAt = now + rand(1.5, 5);
      A.lastLight = W.lightning || 0;
      if (A.thunderAt && now >= A.thunderAt) { A.thunderAt = 0; call('thunder', 0.4 * indoorK, rand(-0.6, 0.6), null, 3); }
      // ---- fire crackles, fermenting jars, wind bells
      if (A.fireNear > 0.05 && now >= A.next.crackle) {
        A.next.crackle = now + rand(0.08, 0.5) / A.fireNear;
        if (E.admit('nature', now, 1)) { S2.out = n.amb; E.hold('nature', NAT.crackle(S2, now + 0.02, 0.11 * A.fireNear, clamp(W.fire?.pan ?? 0, -0.8, 0.8)), now); S2.out = n.outdoor; }
      }
      if (W.jar && now >= A.next.jar) {
        const near = clamp(1 - W.jar.d / 7, 0, 1);
        A.next.jar = now + rand(0.8, 3) / Math.max(0.2, near);
        if (near > 0.05 && E.admit('nature', now, 1)) { S2.out = n.amb; E.hold('nature', NAT.bubbleJar(S2, now + 0.02, 0.03 * near, clamp(W.jar.pan ?? 0, -0.8, 0.8)), now); S2.out = n.outdoor; }
      }
      if (W.bell && now >= A.next.bell) {
        const wind = clamp(W.wind ?? 1, 0, 3) * (A.gusting ? 1.6 : 1);
        A.next.bell = now + rand(2.5, 9) / Math.max(0.3, wind);
        const near = clamp(1 - W.bell.d / 28, 0, 1);
        if (near > 0.05 && wind > 0.55 && W.rain < 0.6) call('windbell', 0.012 * near * indoorK, clamp(W.bell.pan ?? 0, -0.8, 0.8));
      }
    };
    E.update = function (dt, W) {
      try { E.updateNature(W, dt); } catch (e) { G.log.debug('AUDIO', 'nature', e); }
      try { E.updateMusic(W); } catch (e) { G.log.debug('AUDIO', 'music', e); }
    };
    E.stats = function () {
      const now = ac.currentTime;
      return { live: K.live + S.K.live + SA.K.live, made: K.made + S.K.made + SA.K.made, ended: K.ended + S.K.ended + SA.K.ended,
        voices: { music: E.count('music', now), nature: E.count('nature', now), sfx: E.count('sfx', now) }, maxVoices: E.maxVoices, dropped: { ...E.dropped } };
    };
    E.buildNature();
    return E;
  }

  // ================================================================= the situation (what the player hears now)
  /** a neutral situation (tests start from it) */
  function baseSituation() {
    return { hour: 12, phase: 'DAY', night: 0, month: 5, season: 'spring', weather: 'CLEAR', rain: 0, snow: 0, fog: 0, wind: 1, lightning: 0,
      indoor: false, place: null, complex: false, forest: 0.35, waterDist: Infinity, waterPan: 0, waterSmall: false, fall: 0, fire: null, jar: null, bell: null,
      eaves: false, musicOn: true, natureOn: true, festival: false };
  }

  // ================================================================= the live system
  const audio = {
    name: 'audio', order: 85, label: '사운드',
    supported: !!AC, ctx: null, ready: false, unlocked: false,
    levels: { master: 0, music: 0, sfx: 0, ambient: 0, voice: 1 },
    stats: { played: 0, dropped: 0, last: null, byName: {} },
    mood: 'day', moodInfo: null,
    _E: null, _last: new Map(), _ducks: new Map(), _listener: { x: 0, z: 0 }, _W: null, _sitT: 0, _emitters: new Set(),
    _voice: null, _voicesList: [], _speaking: false, _suspendedByUs: false,

    init() {
      // [audio] device settings that are new in phase 9 (03-state keeps unknown keys as they are)
      const D = G.settingsDefaults || {};
      for (const [k, v] of Object.entries({ volumeVoice: 0.9, musicGugak: true, natureSounds: true })) {
        if (!(k in D)) D[k] = v;
        if (G.settings && G.settings[k] === undefined) G.settings[k] = v;
      }
      if (!AC) { G.log.info('AUDIO', 'Web Audio not supported - sound disabled'); }
      else this._armGesture();
      G.bus.on('settings:changed', ({ key } = {}) => {
        if (/^volume|^muted$|^musicGugak$|^natureSounds$/.test(String(key))) { this._applyVolumes(); if (key === 'muted' && G.settings.muted) this.stopSpeaking(); }
        else if (key === 'easyMode') this._applyVolumes();
      });
      G.bus.on('easy:changed', () => this._applyVolumes());
      G.bus.on('site:changed', () => this._applyVolumes());
      // 쉬운 모드: every big kid button / tile answers the finger right away with a soft 목탁
      const KID_TAP = '.easy-tile, .easy-big-btn, .easy-back, .easy-speak, .skc-cat, .skc-emo, .eng-k-tap, .ong-rad-item, .ong-rad-center';
      document.addEventListener('pointerdown', (e) => {
        try {
          if (!easyOn() || (e.pointerType === 'mouse' && e.button !== 0)) return;
          const el = e.target?.closest?.(KID_TAP);
          if (!el || el.disabled || el.closest('[data-action]')) return;
          this.play('tap');
        } catch (err) { /* sound is optional */ }
      }, { capture: true, passive: true });
      document.addEventListener('visibilitychange', () => this._syncSuspend());
      try {
        const ss = window.speechSynthesis;
        if (ss) {
          const load = () => { try { this._voicesList = ss.getVoices() || []; this._voice = null; } catch (e) { /* ignore */ } };
          load();
          ss.addEventListener?.('voiceschanged', load);
        }
      } catch (e) { /* no TTS */ }
      G.bus.on('time:phase', () => { this._sitT = 0; });
      G.bus.on('weather:changed', () => { this._sitT = 0; });
      G.bus.on('place:enter', () => { this._sitT = 0; });
      G.bus.on('place:exit', () => { this._sitT = 0; });
      // dialogue: keep the music under the conversation (TTS ducks further while speaking)
      G.bus.on('npc:talk', () => this.duck('dialogue', 0.55));
      G.bus.on('dialogue:end', () => this.unduck('dialogue'));
      G.bus.on('photo:mode', ({ active } = {}) => { if (active) this.duck('photo', 0.75); else this.unduck('photo'); });
      // lectures (74-lecture.js): the music steps back while a video or a deck plays (the lane may also call duck itself)
      const lecOn = () => this.duck('lecture', 0.12);
      const lecOff = () => this.unduck('lecture');
      G.bus.on('lecture:play', lecOn); G.bus.on('lecture:open', lecOn);
      G.bus.on('lecture:pause', lecOff); G.bus.on('lecture:close', lecOff); G.bus.on('lecture:end', lecOff);
      // festive moments: a 잔치 stinger
      G.bus.on('audio:festival', () => this.stinger('festival'));
    },

    // ------------------------------------------------------------ context / graph
    unlock() {
      if (!AC) return false;
      try {
        if (!this.ctx) this._create();
        if (this.ctx && this.ctx.state === 'suspended' && !this._suspendedByUs) {
          this.ctx.resume().then(() => { if (this.ctx.state === 'running') this._onRunning(); }).catch(() => { /* needs another gesture */ });
        } else if (this.ctx?.state === 'running') this._onRunning();
      } catch (e) {
        G.log.warn('AUDIO', 'unlock failed', e);
        this.supported = false;
        this._removeGesture();
      }
      return !!this.ctx;
    },
    _onRunning() {
      this._removeGesture();
      if (this.unlocked) return;
      this.unlocked = true;
      this._syncSuspend();
      G.log.info('AUDIO', `audio unlocked (${this.ctx.sampleRate} Hz)`);
    },
    _armGesture() {
      if (this._gesture || !AC) return;
      const onGesture = () => { this.unlock(); };
      this._gesture = onGesture;
      for (const ev of ['pointerdown', 'keydown', 'touchstart']) window.addEventListener(ev, onGesture, { capture: true, passive: true });
    },
    _removeGesture() {
      if (!this._gesture) return;
      for (const ev of ['pointerdown', 'keydown', 'touchstart']) window.removeEventListener(ev, this._gesture, { capture: true });
      this._gesture = null;
    },
    _create() {
      let ac;
      try { ac = new AC({ latencyHint: 'playback' }); } catch (e) { ac = new AC(); }
      this.ctx = ac;
      ac.onstatechange = () => {
        if (ac.state === 'running') { const M = this._E?.mus; if (M) M.cursor = Math.max(M.cursor, ac.currentTime + 0.3); return; }
        if (ac.state !== 'closed' && !this._suspendedByUs) this._armGesture(); // interrupted by the system
      };
      this._E = createEngine(ac, { emitters: this._emitters });
      this._nodes = this._E.n;
      this._applyVolumes(true);
      this._applyDuck();
      this.ready = true;
    },

    /** a setting with the operator's default: the device value wins once it differs from the built-in default */
    _setting(key, siteKey, dflt) {
      const s = G.settings || {}, D = G.settingsDefaults || {};
      const v = s[key];
      const builtIn = D[key] ?? dflt;
      if (v === undefined || v === builtIn) {
        try { const sv = G.site?.get?.(siteKey, undefined); if (sv !== undefined && sv !== null) return sv; } catch (e) { /* no site settings */ }
      }
      return v === undefined ? builtIn : v;
    },
    _applyVolumes(instant) {
      const s = G.settings || {};
      const lv = (v) => { v = clamp(Number(v), 0, 1); return Number.isFinite(v) ? Math.pow(v, 1.6) : 0; };
      const master = s.muted ? 0 : lv(s.volumeMaster ?? 0.8);
      const kid = easyOn();
      const musicOn = !!this._setting('musicGugak', 'sound.music_on', true);
      const natureOn = !!this._setting('natureSounds', 'sound.nature_on', true);
      this._musicOn = musicOn; this._natureOn = natureOn;
      this.levels = {
        master,
        music: musicOn ? lv(this._setting('volumeMusic', 'sound.volume_music', 0.45)) * (kid ? 0.8 : 1) : 0,
        sfx: lv(this._setting('volumeSfx', 'sound.volume_sfx', 0.8)),
        ambient: natureOn ? lv(this._setting('volumeAmbient', 'sound.volume_nature', 0.6)) * (kid ? 0.9 : 1) : 0,
        voice: clamp(Number(this._setting('volumeVoice', 'sound.volume_voice', 0.9)), 0, 1) || 0,
      };
      if (!Number.isFinite(this.levels.voice)) this.levels.voice = 0.9;
      if (this._E) this._E.setLevels(this.levels, instant);
      this._syncSuspend();
    },
    /** the 목소리 level for speech (08-easy's voice guide and speak()) */
    voiceGain() { return this.levels.voice ?? 0.9; },

    /** suspend the context while the tab is hidden or everything is silent (saves CPU) */
    _syncSuspend() {
      const ac = this.ctx;
      if (!ac || !this.unlocked || ac.state === 'closed') return;
      const silent = this.levels.master <= 0.0001;
      const want = document.hidden || silent ? 'suspended' : 'running';
      if (want === 'suspended' && ac.state === 'running') { this._suspendedByUs = true; ac.suspend().catch(() => {}); }
      else if (want === 'running' && ac.state === 'suspended') {
        this._suspendedByUs = false;
        ac.resume().then(() => { const M = this._E?.mus; if (M) M.cursor = Math.max(M.cursor, ac.currentTime + 0.4); }).catch(() => {});
      }
    },

    // ------------------------------------------------------------ public: sfx
    play(name, opts) {
      try {
        const ac = this.ctx, E = this._E;
        if (!ac || !this.ready || !E || ac.state === 'closed') return false;
        if (this.levels.master <= 0.0001 || this.levels.sfx <= 0.0001) return false;
        const o = opts && typeof opts === 'object' ? opts : {};
        const kid = easyOn();
        if (kid && EASY_SWAP[name] && !o.exact) name = EASY_SWAP[name];
        if (!SFX[name]) { G.log.debug('AUDIO', `unknown sfx "${name}"`); return false; }
        const now = ac.currentTime;
        if (name === 'tap' && !o.force && now - (this._tapAt ?? -1) < 0.3) return false;
        const min = THROTTLE[name] ?? 0.03;
        const last = this._last.get(name);
        if (last != null && now - last < min && !o.force) return false;
        let vol = (o.volume ?? 1) * (kid ? (EASY_GAIN[name] ?? 1) : 1), pan = o.pan || 0;
        if (o.at && Number.isFinite(o.at.x)) { // distance attenuation + panning from the camera
          const cam = G.sys.engine?.camera;
          if (cam) {
            const dx = o.at.x - cam.position.x, dz = o.at.z - cam.position.z;
            const d = Math.hypot(dx, dz);
            vol *= clamp(1 - (d - 6) / 40, 0, 1);
            if (vol <= 0.01) return false;
            const e = cam.matrixWorld.elements;
            const rl = Math.hypot(e[0], e[2]) || 1;
            if (d > 0.5) pan = clamp(((dx * e[0] + dz * e[2]) / rl / d) * 0.7, -0.8, 0.8);
          }
        }
        const snowy = (this._W?.snow || 0) > 0.3 && !this._W?.indoor;
        const end = E.playSfx(name, { ...o, volume: vol, pan, snowy });
        if (end == null) { this.stats.dropped++; return false; }
        this._last.set(name, now);
        if (name === 'tap') this._tapAt = now;
        if (FANFARE[name]) this.duck('fanfare', 0.38, FANFARE[name]);
        this.stats.played++; this.stats.last = name; this.stats.byName[name] = (this.stats.byName[name] || 0) + 1;
        return true;
      } catch (e) { G.log.debug('AUDIO', 'play failed', name, e); return false; }
    },
    /** a short 국악 phrase (reward · levelup · festival · quest · welcome) on the effects bus */
    stinger(name) { return this.play(SFX[name] ? name : 'reward', { force: true }); },

    /** a point source of nature sound: fire, a fermenting jar, a wind bell, water — world coordinates */
    emitter(spec) {
      try {
        const e = { kind: String(spec?.kind || 'bell'), x: Number(spec?.x) || 0, z: Number(spec?.z) || 0, place: spec?.place ?? null, gain: clamp(Number(spec?.gain ?? 1), 0, 2) };
        this._emitters.add(e);
        this._sitT = 0;
        return { move: (x, z) => { e.x = Number(x) || 0; e.z = Number(z) || 0; }, remove: () => { this._emitters.delete(e); } };
      } catch (err) { return { move() {}, remove() {} }; }
    },

    /** music ducking: the lowest active duck wins; seconds = auto release. duck(true|false) = the shared 'tts' duck */
    duck(key, gain = 0.4, seconds, opt) {
      try {
        if (typeof key === 'boolean') { if (key) this.duck('tts', 0.4); else this.unduck('tts'); return; }
        if (typeof key !== 'string' || !key) return;
        const g = Number(gain), s = Number(seconds);
        const now = performance.now() / 1000;
        const nat = opt && Number.isFinite(Number(opt.nature)) ? clamp(Number(opt.nature), 0, 1) : key === 'lecture' ? 0.45 : key === 'voice' ? 0.6 : 1;
        this._ducks.set(key, { gain: clamp(Number.isFinite(g) ? g : 0.4, 0, 1), nature: nat, until: Number.isFinite(s) && s > 0 ? now + s : Infinity });
        this._applyDuck();
      } catch (e) { G.log.debug('AUDIO', 'duck failed', e); }
    },
    unduck(key) { try { if (this._ducks.delete(key)) this._applyDuck(); } catch (e) { G.log.debug('AUDIO', 'unduck failed', e); } },
    _applyDuck() {
      let g = 1, a = 1;
      for (const d of this._ducks.values()) { g = Math.min(g, d.gain); a = Math.min(a, d.nature ?? 1); }
      this._duckLevel = g; this._duckNature = a;
      if (this._E) this._E.setDuck(g, a);
    },

    // ------------------------------------------------------------ public: speech (TTS)
    speak(text, opts = {}) {
      try {
        opts = opts && typeof opts === 'object' ? opts : {};
        if (easyOn() && typeof G.easy?.say === 'function') {
          if (!String(text ?? '').trim()) return false;
          G.easy.say(String(text), { priority: 1, force: opts.force !== false, rate: opts.rate });
          return true;
        }
        const ss = window.speechSynthesis;
        if (!ss || typeof window.SpeechSynthesisUtterance !== 'function') return false;
        if (G.settings.muted) return false;
        const clean = String(text ?? '')
          .replace(/<[^>]*>/g, ' ')
          .replace(/[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{FE0F}\u{200D}]/gu, '')
          .replace(/[~♡♥★☆]+/g, ' ')
          .replace(/\s+/g, ' ').trim();
        if (!clean) return false;
        ss.cancel();
        const u = new SpeechSynthesisUtterance(clean.slice(0, 400));
        u.lang = 'ko-KR';
        const v = this._koVoice();
        if (v) u.voice = v;
        u.rate = clamp(opts.rate ?? 1.02, 0.5, 2);
        u.pitch = clamp(opts.pitch ?? 1.05, 0, 2);
        u.volume = clamp((this.levels.master || 0.6) * 1.15 * this.voiceGain(), 0, 1);
        u.onstart = () => { this._speaking = true; this.duck('speech', 0.45); };
        const done = () => { this._speaking = false; this.unduck('speech'); };
        u.onend = done; u.onerror = done;
        ss.speak(u);
        return true;
      } catch (e) { G.log.debug('AUDIO', 'speak failed', e); return false; }
    },
    stopSpeaking() {
      if (easyOn() && typeof G.easy?.stop === 'function') { try { G.easy.stop(); } catch (e) { /* ignore */ } }
      else { try { window.speechSynthesis?.cancel(); } catch (e) { /* ignore */ } }
      this._speaking = false;
      this.unduck('speech');
    },
    get speaking() { return this._speaking; },
    _koVoice() {
      if (this._voice) return this._voice;
      const list = this._voicesList || [];
      const ko = list.filter((v) => /^ko(-|_|$)/i.test(v.lang || ''));
      if (!ko.length) return null;
      const score = (v) => (/google/i.test(v.name) ? 3 : 0) + (/yuna|heami|sunhi|seoyeon|jimin|female|여성/i.test(v.name) ? 2 : 0) + (v.localService ? 1 : 0);
      ko.sort((a, b) => score(b) - score(a));
      this._voice = ko[0];
      return this._voice;
    },

    // ------------------------------------------------------------ the situation of the player
    _listenerPos() {
      const pl = G.sys.player;
      if (G.state && pl?._ready && pl.position) return pl.position;
      return G.sys.engine?.camera?.position || this._listener;
    },
    /** pan of a world point seen from the camera (−0.8 … 0.8) */
    _panOf(x, z, p) {
      const cam = G.sys.engine?.camera;
      if (!cam) return 0;
      const e = cam.matrixWorld.elements, dx = x - p.x, dz = z - p.z, d = Math.hypot(dx, dz) || 1, rl = Math.hypot(e[0], e[2]) || 1;
      return clamp(((dx * e[0] + dz * e[2]) / rl / d) * 0.75, -0.8, 0.8);
    },
    _situation() {
      const W = this._W || baseSituation();
      const p = this._listenerPos();
      const Wx = G.sys.weather;
      W.night = clamp(Number(Wx?.nightFactor ?? G.world?.nightFactor ?? 0) || 0, 0, 1);
      W.hour = Number(Wx?.hour ?? 12);
      W.phase = Wx?.phase || 'DAY';
      W.weather = Wx?.current || 'CLEAR';
      W.rain = clamp(Number(Wx?.precipitation?.rain ?? (W.weather === 'RAIN' ? 1 : 0)) || 0, 0, 1);
      W.snow = clamp(Number(Wx?.precipitation?.snow ?? (W.weather === 'SNOW' ? 1 : 0)) || 0, 0, 1);
      W.fog = clamp(Number(Wx?.mix?.FOG ?? (W.weather === 'FOG' ? 1 : 0)) || 0, 0, 1);
      W.lightning = Number(Wx?.lightning) || 0;
      const ew = G.sys.engine?.wind;
      W.wind = clamp(Number(ew?.strength ?? 1) || 1, 0, 3);
      W.month = kstMonth();
      W.season = seasonNow(W.month);
      W.musicOn = this._musicOn !== false; W.natureOn = this._natureOn !== false;
      const PLc = G.sys.places;
      const place = PLc?.current || null;
      W.place = place; W.indoor = !!PLc?.indoor; W.complex = place === 'PL_ALLOT';
      // water: distance + direction (a gradient of the distance field when no polyline is known)
      W.waterDist = Infinity; W.waterPan = 0; W.waterSmall = false; W.fall = 0;
      const L = G.data.layout || {};
      try {
        if (W.complex && typeof G.complexLandscape?.waterDistance === 'function') {
          const lp = PLc.toLocal(p.x, p.z), wd = G.complexLandscape.waterDistance;
          const d = Number(wd(lp.x, lp.z));
          if (Number.isFinite(d)) {
            W.waterDist = d;
            const gx = Number(wd(lp.x + 4, lp.z)) - Number(wd(lp.x - 4, lp.z)), gz = Number(wd(lp.x, lp.z + 4)) - Number(wd(lp.x, lp.z - 4));
            if (Number.isFinite(gx) && Number.isFinite(gz) && (gx || gz)) W.waterPan = this._panOf(p.x - gx * 10, p.z - gz * 10, p);
          }
        } else if (!place) {
          const d = G.sys.water?.distanceToWater?.(p.x, p.z);
          if (Number.isFinite(d)) W.waterDist = d;
          if (L.river?.points && G.util?.distToPolyline) {
            const r = G.util.distToPolyline(p.x, p.z, L.river.points);
            if (!Number.isFinite(W.waterDist)) W.waterDist = Math.max(0, r.d - (L.river.width || 16) / 2);
            const pts = L.river.points, i = r.i, a = pts[i], b = pts[Math.min(i + 1, pts.length - 1)];
            const ax = b[0] - a[0], az = b[1] - a[1], ll = ax * ax + az * az || 1;
            const tt = clamp(((p.x - a[0]) * ax + (p.z - a[1]) * az) / ll, 0, 1);
            W.waterPan = this._panOf(a[0] + ax * tt, a[1] + az * tt, p);
          }
          for (const pd of L.ponds || []) {
            const d2 = Math.hypot(p.x - pd.x, p.z - pd.z) - pd.r;
            if (d2 < W.waterDist) { W.waterDist = Math.max(0, d2); W.waterSmall = true; W.waterPan = this._panOf(pd.x, pd.z, p); }
            if (pd.waterfall) W.fall = Math.max(W.fall, clamp(1 - Math.hypot(p.x - pd.waterfall.x, p.z - pd.waterfall.z) / 30, 0, 1));
          }
        }
      } catch (e) { /* optional */ }
      // forest: the valley is wrapped in forest — far from every zone circle means among the trees; in the complex,
      // the forested slopes begin at the edge of the plan
      try {
        if (W.complex) {
          const B = G.data.complex?.bounds, lp = PLc.toLocal(p.x, p.z);
          if (B) { const edge = Math.min(lp.x - B.minX, B.maxX - lp.x, lp.z - B.minZ, B.maxZ - lp.z); W.forest = clamp(1 - edge / 70, 0.15, 1); }
        } else if (!place) {
          let best = Infinity;
          for (const zn of G.data.zones || []) { const c = zn.center || [0, 0]; best = Math.min(best, Math.hypot(p.x - c[0], p.z - c[1]) - (zn.r || 0)); }
          W.forest = clamp(smooth(4, 40, best), 0.12, 1);
        } else W.forest = 0.3;
      } catch (e) { W.forest = 0.3; }
      // point sources: the nearest fire, fermenting jar and wind bell
      W.fire = null; W.jar = null; W.bell = null; W.eaves = false;
      const nearest = (kind, x, z, maxD, extra) => {
        const d = Math.hypot(p.x - x, p.z - z);
        if (d > maxD) return;
        const cur = W[kind];
        if (!cur || d < cur.d) W[kind] = { d, pan: this._panOf(x, z, p), ...(extra || {}) };
      };
      try {
        if (!place) {
          const hour = W.hour;
          // the 아궁이 of the 초가집 is lit for breakfast and dinner
          const th = (L.buildings || []).find((b) => b.id === 'B_THATCH');
          if (th && ((hour >= 5.5 && hour < 8.5) || (hour >= 16.5 && hour < 19.5))) nearest('fire', th.x, th.z, 12);
          const jars = G.state?.jars || {};
          for (const J of L.jars || []) { const s = jars[J.id]; if (s && s.recipeId && (Number(s.progress) || 0) < 100) nearest('jar', J.x, J.z, 8); }
          // 풍경 at the corners of the tiled roofs
          for (const b of L.buildings || []) {
            if (!/hanok|pavilion|gate|hall/.test(b.type)) continue;
            const c = Math.cos(b.rot || 0), s = Math.sin(b.rot || 0), hw = (b.w || 8) / 2 + 0.6, hd = (b.d || 6) / 2 + 0.6;
            for (const [lx, lz] of [[hw, hd], [-hw, hd], [hw, -hd], [-hw, -hd]]) nearest('bell', b.x + lx * c + lz * s, b.z - lx * s + lz * c, 30);
            if (Math.hypot(p.x - b.x, p.z - b.z) < Math.max(b.w || 8, b.d || 6) * 0.7) W.eaves = true;
          }
        } else if (place === 'PL_BUEOK') {
          W.fire = { d: 4, pan: 0 };   // the kitchen's 아궁이 (until the room registers an exact emitter)
        }
        for (const e of this._emitters) {
          if ((e.place || null) !== (place || null)) continue;
          const k = e.kind === 'water' ? null : e.kind;
          if (e.kind === 'water') { const d = Math.hypot(p.x - e.x, p.z - e.z); if (d < W.waterDist) { W.waterDist = d; W.waterSmall = true; W.waterPan = this._panOf(e.x, e.z, p); } }
          else if (k === 'fire' || k === 'jar' || k === 'bell') nearest(k, e.x, e.z, k === 'bell' ? 30 : 12);
        }
      } catch (e) { /* optional */ }
      this._W = W;
      return W;
    },

    // ------------------------------------------------------------ frame
    update(dt) {
      if (this._ducks.has('dialogue')) {
        const wall = performance.now();
        if (G.sys.dialogue?.active) this._dlgIdleAt = 0;
        else if (!this._dlgIdleAt) this._dlgIdleAt = wall;
        else if (wall - this._dlgIdleAt > 1500) { this._dlgIdleAt = 0; this.unduck('dialogue'); }
      }
      if (!this.ready || !this.ctx || this.ctx.state !== 'running' || !this._E) return;
      if (this._ducks.size) {
        const now = performance.now() / 1000;
        let changed = false;
        for (const [k, d] of this._ducks) if (d.until <= now) { this._ducks.delete(k); changed = true; }
        if (changed) this._applyDuck();
      }
      this._sitT -= dt;
      if (this._sitT <= 0 || !this._W) { this._sitT = 0.25; try { this._situation(); } catch (e) { G.log.debug('AUDIO', 'situation', e); } }
      this._E.update(Math.min(0.25, dt || 0.016), this._W || baseSituation());
      const M = this._E.mus;
      if (M.mood) { this.mood = M.mood; this.moodInfo = M.info; }
    },

    onLogout() { this.stopSpeaking(); this._ducks.clear(); this._applyDuck(); },

    // ------------------------------------------------------------ diagnostics (tests / debug panel)
    /**
     * render effects offline and measure the output: {peak, peakDb, rms, duration}. names: one name or a list played
     * together (opts.gap seconds apart) — through the real bus gains + limiter + soft clip at the current settings.
     */
    async analyze(names, opts = {}) {
      const O = OAC();
      const list = (Array.isArray(names) ? names : [names]).filter((x) => SFX[x]);
      if (!O || !list.length) return null;
      const sr = 44100;
      const oac = new O(2, Math.ceil(sr * (opts.seconds || 3)), sr);
      const E = createEngine(oac, { offline: true });
      const lv = (v, d) => { v = clamp(Number(v ?? d), 0, 1); return Number.isFinite(v) ? Math.pow(v, 1.6) : 0; };
      const st = G.settings || {};
      E.setLevels({ master: opts.master ?? lv(st.volumeMaster, 0.8), music: 0, sfx: opts.sfx ?? lv(st.volumeSfx, 0.8), ambient: 0 }, true);
      list.forEach((x, i) => E.playSfx(x, { ...opts, t: 0.01 + i * (opts.gap || 0) }));
      const rb = await oac.startRendering();
      const m = measure(rb);
      // the RMS as the phase-8 analyze() measured it (channel 0, up to the last sample above 0.002) — for comparisons
      const d = rb.getChannelData(0);
      let sum = 0, lastLoud = 0;
      for (let c = 0; c < rb.numberOfChannels; c++) { const x = rb.getChannelData(c); for (let i = 0; i < x.length; i++) { const a = Math.abs(x[i]); if (a > 0.002 && i > lastLoud) lastLoud = i; } }
      for (let i = 0; i < d.length; i++) sum += d[i] * d[i];
      return { name: list.join('+'), peak: +m.peak.toFixed(3), peakDb: m.peakDb, rms: +Math.sqrt(sum / Math.max(1, lastLoud)).toFixed(4), rmsAct: m.rmsAct, duration: +(lastLoud / sr).toFixed(2), dc: m.dc, nonFinite: m.nonFinite };
    },
    names() { return Object.keys(SFX); },
    meter() {
      const n = this._nodes;
      if (!n) return null;
      if (!n.meter) { n.meter = this.ctx.createAnalyser(); n.meter.fftSize = 2048; n.master.connect(n.meter); n._mbuf = new Float32Array(n.meter.fftSize); }
      n.meter.getFloatTimeDomainData(n._mbuf);
      let peak = 0, sum = 0;
      for (const x of n._mbuf) { const a = Math.abs(x); if (a > peak) peak = a; sum += x * x; }
      return { rms: +Math.sqrt(sum / n._mbuf.length).toFixed(4), peak: +peak.toFixed(3) };
    },
    debug() {
      const E = this._E;
      return {
        supported: this.supported, state: this.ctx?.state || 'none', unlocked: this.unlocked, levels: { ...this.levels }, mood: this.mood, moodInfo: this.moodInfo,
        musicPlaying: !!E?.mus?.playing, queued: E?.mus?.queue.length || 0, engine: E ? E.stats() : null,
        situation: this._W ? { hour: this._W.hour, month: this._W.month, season: this._W.season, weather: this._W.weather, indoor: this._W.indoor, place: this._W.place, water: this._W.waterDist, forest: +(this._W.forest || 0).toFixed(2), fire: !!this._W.fire, jar: !!this._W.jar, bell: !!this._W.bell } : null,
        duck: this._duckLevel ?? 1, duckNature: this._duckNature ?? 1, stats: { ...this.stats, byName: { ...this.stats.byName } },
      };
    },
  };

  // ================================================================= measurements + the offline lab (tests)
  /** peak, RMS over the audible part, DC offset, non-finite samples, duration of an AudioBuffer */
  function measure(rb) {
    let peak = 0, sum = 0, cnt = 0, dc = 0, bad = 0, last = 0, first = -1, all = 0;
    const ch = rb.numberOfChannels, len = rb.length;
    for (let c = 0; c < ch; c++) {
      const d = rb.getChannelData(c);
      for (let i = 0; i < len; i++) {
        const v = d[i];
        if (!Number.isFinite(v)) { bad++; continue; }
        const a = v < 0 ? -v : v;
        if (a > peak) peak = a;
        dc += v; all++;
        if (a > 0.0015) { if (i > last) last = i; if (first < 0 || i < first) first = i; }
      }
    }
    // RMS of 50 ms windows that are not silent (a "loudness" of what is actually heard)
    const win = Math.max(1, Math.floor(rb.sampleRate * 0.05));
    let loud = 0, loudN = 0;
    const d0 = rb.getChannelData(0), d1 = ch > 1 ? rb.getChannelData(1) : d0;
    for (let i = 0; i + win <= len; i += win) {
      let s = 0;
      for (let k = i; k < i + win; k++) { const v = (d0[k] + d1[k]) * 0.5; if (Number.isFinite(v)) s += v * v; }
      const r = Math.sqrt(s / win);
      if (r > 0.001) { loud += s; loudN += win; }
      sum += s; cnt += win;
    }
    const rmsAct = loudN ? Math.sqrt(loud / loudN) : 0;
    return {
      peak: +peak.toFixed(4), peakDb: +(20 * Math.log10(Math.max(peak, 1e-6))).toFixed(1), rms: +Math.sqrt(sum / Math.max(1, cnt)).toFixed(5),
      rmsAct: +rmsAct.toFixed(5), rmsDb: +(20 * Math.log10(Math.max(rmsAct, 1e-7))).toFixed(1), dc: +(dc / Math.max(1, all)).toFixed(6), nonFinite: bad,
      duration: +(Math.max(0, last - Math.max(0, first)) / rb.sampleRate).toFixed(2), audibleFrom: +(Math.max(0, first) / rb.sampleRate).toFixed(2),
      activeShare: +(loudN / Math.max(1, cnt)).toFixed(3),
    };
  }
  function toB64Int16(rb, seconds) {
    const n = Math.min(rb.length, Math.floor((seconds || 1e9) * rb.sampleRate)), ch = Math.min(2, rb.numberOfChannels);
    const out = new Int16Array(n * ch);
    for (let c = 0; c < ch; c++) { const d = rb.getChannelData(c); for (let i = 0; i < n; i++) out[i * ch + c] = Math.round(clamp(d[i], -1, 1) * 32767); }
    const bytes = new Uint8Array(out.buffer);
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return { b64: btoa(s), sampleRate: rb.sampleRate, channels: ch, frames: n };
  }
  /** drive an engine on an OfflineAudioContext: update() every `step` seconds through suspend / resume */
  async function runOffline(seconds, sr, setup, opts = {}) {
    const O = OAC();
    if (!O) return null;
    const oac = new O(2, Math.ceil(sr * seconds), sr);
    const E = createEngine(oac, { offline: true, mood: opts.mood, rng: opts.rng, musicDelay: opts.musicDelay ?? 0.1 });
    E.setLevels(opts.levels || { master: 0.6, music: opts.music ?? 0.28, sfx: opts.sfx ?? 0.7, ambient: opts.ambient ?? 0.44 }, true);
    const W = Object.assign(baseSituation(), opts.W || {});
    const step = opts.step || 0.25;
    const samples = [];
    if (setup) setup(E, oac, W);
    for (let t = step; t < seconds - step; t += step) {
      const tq = Math.round((t * sr) / 128) * 128 / sr;
      oac.suspend(tq).then(() => {
        try {
          if (opts.onStep) opts.onStep(E, oac, W, tq);
          E.update(step, W);
          if (opts.sample && Math.abs(tq / opts.sample - Math.round(tq / opts.sample)) < step / 2 / opts.sample) samples.push({ t: +tq.toFixed(2), ...E.stats() });
        } catch (e) { /* recorded by the caller through the result */ }
        oac.resume();
      });
    }
    const rb = await oac.startRendering();
    await new Promise((res) => setTimeout(res, 150));
    return { rb, E, samples, oac };
  }
  audio.lab = {
    measure,
    /** one instrument: a short phrase of notes (or strokes for the drums) through its strip + the mastering stage */
    async renderInstrument(name, opts = {}) {
      const L = GK(), O = OAC();
      if (!L || !O || !L.INST[name]) return null;
      const sr = opts.sr || 32000, secs = opts.seconds || 6;
      const oac = new O(2, Math.ceil(sr * secs), sr);
      const m = buildMaster(oac, oac.destination);
      const bus = gainNode(oac, (opts.bus ?? 0.28) * BASE.music); bus.connect(m.input);
      const K = L.kit(oac, bus);
      const drums = { janggu: ['deong', 'kung', 'deok', 'gideok', 'dereoreo', 'kung', 'deok', 'tta'], buk: ['kung', 'ttak', 'hap', 'kung'], kkwaenggwari: ['gaen', 'ji', 'ji', 'gaen'] };
      const base = opts.base || (name === 'geomungo' || name === 'ajaeng' ? 98 : name === 'jing' ? 146 : 220);
      let t = 0.05;
      if (drums[name]) for (const s of drums[name]) { L.INST[name](K, t, { stroke: s, vel: 0.7, dur: 0.4 }); t += 0.45; }
      else if (name === 'jing') L.INST.jing(K, t, { f: base, vel: 0.6, dur: 9 });
      else if (name === 'bak' || name === 'moktak' || name === 'pungkyeong') for (let i = 0; i < 4; i++) { L.INST[name](K, t, { vel: 0.6, f: name === 'pungkyeong' ? 1650 : undefined }); t += name === 'pungkyeong' ? 1.2 : 0.6; }
      else for (const d of [0, 1, 2, 3, 4, 3, 2, 0]) { const f = L.freq('pyeong', base, d + (name === 'geomungo' || name === 'ajaeng' ? 0 : 5)); L.INST[name](K, t, { f, dur: 0.55, vel: 0.65, vib: 22 }); t += 0.6; }
      const rb = await oac.startRendering();
      await new Promise((res) => setTimeout(res, 120));   // let the ended events arrive
      return { name, ...measure(rb), made: K.made, live: K.live, wav: opts.wav ? toB64Int16(rb) : undefined };
    },
    /** one 장단 played on its drum for `cycles` cycles */
    async renderJangdan(id, cycles = 2, opts = {}) {
      const L = GK(), O = OAC();
      if (!L || !O || !L.JANGDAN[id]) return null;
      const J = L.JANGDAN[id], cyc = L.cycleSeconds(J, 0.5), sb = cyc / J.grid.length, secs = cyc * cycles + 1.5, sr = opts.sr || 22050;
      const oac = new O(2, Math.ceil(sr * secs), sr);
      const m = buildMaster(oac, oac.destination);
      const bus = gainNode(oac, 0.28 * BASE.music); bus.connect(m.input);
      const K = L.kit(oac, bus);
      const onsets = [];
      for (let c = 0; c < cycles; c++) J.grid.forEach((s, i) => {
        if (!s) return;
        const t = 0.05 + c * cyc + i * sb;
        L.INST[opts.inst || 'janggu'](K, t, { stroke: opts.inst === 'buk' ? ({ deong: 'hap', kung: 'kung', deok: 'ttak', gideok: 'ttak' }[s] || 'kung') : s, vel: 0.4 * (J.accent[Math.floor(i / J.sub)] ?? 0.6) + 0.2, dur: sb });
        onsets.push(+t.toFixed(3));
      });
      const rb = await oac.startRendering();
      return { id, name: J.name, cycleSeconds: +cyc.toFixed(2), strokes: onsets.length, onsets, ...measure(rb) };
    },
    /** a mood for `seconds` through the real engine (music only) — events, info and optionally the samples (WAV) */
    async renderMood(id, seconds = 30, opts = {}) {
      const L = GK();
      if (!L || !L.MOODS[id]) return null;
      const R0 = await runOffline(seconds, opts.sr || 22050, (E) => { E.mus.forced = id; E.mus.want = id; E.nat = null; }, { mood: id, ambient: 0, sfx: 0, music: 0.28, rng: opts.seed != null ? L.rng(opts.seed) : undefined, W: opts.W });
      if (!R0) return null;
      const { rb, E } = R0;
      return { id, ...measure(rb), info: E.mus.info, stats: E.stats(), wav: opts.wav ? toB64Int16(rb, opts.wavSeconds) : undefined };
    },
    /** a nature layer: W = a situation (time, season, weather, water, forest, fire …) for `seconds` */
    async renderNature(W, seconds = 12, opts = {}) {
      const R0 = await runOffline(seconds, opts.sr || 22050, (E) => { E.mus.comp = null; }, { W, music: 0, sfx: 0, ambient: 0.44 });
      if (!R0) return null;
      return { ...measure(R0.rb), stats: R0.E.stats(), wav: opts.wav ? toB64Int16(R0.rb) : undefined };
    },
    /** one effect (alone) through the effects bus + mastering at the default levels */
    async renderSfx(name, opts = {}) {
      if (!SFX[name]) return null;
      const R0 = await runOffline(opts.seconds || 4, opts.sr || 44100, (E) => { E.mus.comp = null; E.nat = null; E.playSfx(name, { surface: opts.surface, t: 0.01 }); }, { music: 0, ambient: 0, sfx: Math.pow(0.8, 1.6), levels: { master: Math.pow(0.8, 1.6), music: 0, sfx: Math.pow(0.8, 1.6), ambient: 0 } });
      return R0 ? { name, ...measure(R0.rb) } : null;
    },
    /** the whole engine for `seconds` simulated seconds (music + nature + random effects): node / voice counts over time */
    async simulate(seconds = 120, opts = {}) {
      const names = Object.keys(SFX).filter((x) => !FANFARE[x]);
      const R0 = await runOffline(seconds, opts.sr || 8000, null, {
        W: Object.assign({ hour: 6.2, month: 6, season: 'summer', waterDist: 12, waterPan: 0.3, forest: 0.7, jar: { d: 3, pan: 0.2 }, bell: { d: 6, pan: -0.4 }, fire: { d: 5, pan: 0.1 }, wind: 1.4 }, opts.W || {}),
        sample: opts.sample || 5, music: 0.28, ambient: 0.44, sfx: 0.7,
        onStep: (E, oac, W, t) => {
          if (Math.random() < (opts.sfxRate ?? 2) * 0.25) E.playSfx(pick(names), { surface: pick(['grass', 'stone', 'wood', 'gravel']) });
          if (opts.cycleSituation) { const k = Math.floor(t / 20) % 4; W.hour = [6.2, 13, 18, 23][k]; W.night = k === 3 ? 1 : 0; W.rain = k === 2 ? 0.8 : 0; W.weather = k === 2 ? 'RAIN' : 'CLEAR'; W.indoor = t > seconds * 0.75; W.lightning = k === 2 && (t % 7) < 0.3 ? 1 : 0; }
        },
      });
      if (!R0) return null;
      return { ...measure(R0.rb), samples: R0.samples, final: R0.E.stats(), sections: R0.E.mus.comp ? R0.E.mus.comp.sections : 0, info: R0.E.mus.info };
    },
    baseSituation,
    createEngine,
  };

  G.register(audio);
})();
