// =============================================================================
// 61-audio.js — procedural Web Audio: sound effects, ambient beds, generative BGM, TTS (G.sys.audio, order 85)
//
//   G.sys.audio.play(name, {volume, pan, at:{x,z}, surface, run}) -> bool
//       click open close notify error coin reward quest levelup achievement water harvest plant jar craft
//       shutter step jump land splash chat emote teleport page correct wrong   (+ bubble pop drip whoosh)
//   G.sys.audio.speak(text, {rate, pitch}) / stopSpeaking()     speechSynthesis with a ko-KR voice
//   G.sys.audio.duck(key, gain, seconds?) / unduck(key)          lower the music (dialogue TTS, voice input…)
//   G.sys.audio.unlock()                                         (also automatic on the first pointer / key)
//   G.sys.audio.ready, ctx, levels, mood, stats, analyze(name) -> Promise<{peak, rms, duration}>
//
// Graph:  sfx ─┐                      ┌─> reverb (generated IR) ─┐
//         amb ─┼─> master ─> limiter ─┴──────────────────────────┴─> destination
//         music ─> duck ─┘
// Nothing is sampled: every sound is synthesised (oscillators, filtered noise, Karplus–Strong plucked
// strings for a gayageum-like voice). The AudioContext is created on the first user gesture (browsers block
// autoplay) and suspended while the tab is hidden or everything is muted. Never throws when Web Audio is
// unavailable — every entry point is a no-op then.
// =============================================================================
(function () {
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const rand = (a, b) => a + Math.random() * (b - a);
  const randInt = (a, b) => Math.floor(a + Math.random() * (b - a + 1));
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
  const AC = window.AudioContext || window.webkitAudioContext || null;

  // ---------------------------------------------------------------- tuning constants
  const MAX_VOICES = 40;            // simultaneous sfx calls (each is a handful of nodes)
  // bus make-up gains (measured with analyze() through the mastering stage at the default settings:
  // UI clicks ≈ -29 dBFS peak, footsteps ≈ -36, pickups/rewards ≈ -17, fanfares ≈ -12; a pile-up of eight
  // fanfares at full volume stays below -2 dBFS thanks to the limiter + soft clip)
  const BASE = { music: 2.5, sfx: 1.7, ambient: 2.3 };
  const THROTTLE = {                // minimum seconds between two plays of the same sfx
    click: 0.045, open: 0.08, close: 0.08, notify: 0.12, error: 0.2, coin: 0.06, step: 0.07, land: 0.12, jump: 0.1,
    chat: 0.09, emote: 0.15, page: 0.07, water: 0.25, harvest: 0.15, plant: 0.15, jar: 0.15, bubble: 0.03, drip: 0.02,
    reward: 0.3, quest: 0.4, levelup: 0.8, achievement: 0.5, correct: 0.25, wrong: 0.25, teleport: 0.4, shutter: 0.12,
  };
  const FANFARE = { levelup: 2.6, achievement: 2.0, quest: 1.6, reward: 1.4 }; // duck the music under these (s)
  const WET = { notify: 0.5, coin: 0.4, reward: 0.7, quest: 0.7, levelup: 0.8, achievement: 0.8, correct: 0.5, emote: 0.3, teleport: 0.8, open: 0.25, craft: 0.4, jar: 0.35 };

  // ================================================================= synth helpers (any BaseAudioContext)
  // S = { ac, out (AudioNode), wet (AudioNode|null), buf {white,pink,brown}, pluck(midi) }
  function gainNode(ac, v) { const g = ac.createGain(); g.gain.value = v; return g; }
  /** percussive envelope on an AudioParam: silence -> peak (attack a) -> ~1% after d */
  function perc(param, t, peak, a, d) {
    param.cancelScheduledValues(t);
    param.setValueAtTime(0.0001, t);
    param.linearRampToValueAtTime(peak, t + a);
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
  function route(S, node, o) {
    let last = node;
    if (o.lp) { const f = filter(S.ac, 'lowpass', o.lp, o.lpq ?? 0.7); last.connect(f); last = f; }
    if (o.hp) { const f = filter(S.ac, 'highpass', o.hp, 0.7); last.connect(f); last = f; }
    const p = panNode(S.ac, o.pan);
    if (p) { last.connect(p); last = p; }
    last.connect(o.dest || S.out);
    if (o.wet && S.wet) { const s = gainNode(S.ac, o.wet); last.connect(s); s.connect(S.wet); }
  }
  /**
   * oscillator voice: {type, f, f2, glide, exp=true, t, a, d, g, detune, vib:{rate, depth(Hz), delay}, lp, hp, pan, wet, dest}
   * returns the end time
   */
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
    if (o.vib) {
      const l = ac.createOscillator(); l.frequency.value = o.vib.rate || 5;
      const lg = ac.createGain();
      lg.gain.setValueAtTime(0, t);
      lg.gain.linearRampToValueAtTime(o.vib.depth || 6, t + (o.vib.delay ?? 0.08));
      l.connect(lg); lg.connect(os.frequency);
      l.start(t); l.stop(end);
    }
    const g = ac.createGain();
    if (o.sus) { // sustained: attack, hold at g, release over d
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(o.g ?? 0.2, t + a);
      g.gain.setValueAtTime(o.g ?? 0.2, t + a + o.sus);
      g.gain.setTargetAtTime(0.0001, t + a + o.sus, Math.max(0.01, d / 4.6));
    } else perc(g.gain, t, o.g ?? 0.2, a, d);
    os.connect(g);
    route(S, g, o);
    os.start(t); os.stop(end);
    return end;
  }
  /** filtered noise burst: {kind:'white'|'pink'|'brown', ft:'bandpass', f, f2, sweep, q, t, a, d, g, rate, lp, hp, pan, wet, dest} */
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
    route(S, g, o);
    const end = t + a + d + 0.05;
    src.start(t, Math.random() * Math.max(0, buf.duration - 1));
    src.stop(end);
    return end;
  }
  /** struck bell / chime: inharmonic partials with faster decay up high */
  function bell(S, f, t, g, d, o = {}) {
    const parts = o.parts || [[1, 1, 1], [2.0, 0.42, 0.62], [3.01, 0.2, 0.42], [4.17, 0.1, 0.3]];
    let end = t;
    for (const [m, gm, dm] of parts) end = Math.max(end, tone(S, { type: 'sine', f: f * m, t, a: 0.002, d: d * dm, g: g * gm, pan: o.pan, wet: o.wet, dest: o.dest }));
    return end;
  }
  /** plucked string from the Karplus–Strong cache */
  function pluck(S, midi, t, g, o = {}) {
    const b = S.pluck?.(midi);
    if (!b) return tone(S, { type: 'triangle', f: mtof(midi), t, a: 0.003, d: 0.9, g: g * 0.6, lp: 2400, pan: o.pan, wet: o.wet, dest: o.dest });
    const src = S.ac.createBufferSource();
    src.buffer = b;
    if (src.detune) { src.detune.setValueAtTime(14, t); src.detune.linearRampToValueAtTime(0, t + 0.06); }
    const gn = gainNode(S.ac, g);
    src.connect(gn);
    route(S, gn, o);
    src.start(t); src.stop(t + b.duration);
    return t + Math.min(b.duration, 1.6);
  }

  // ---------------------------------------------------------------- step sounds by surface
  function step(S, t, o) {
    const run = !!o.run, k = 1.9 * (run ? 1.25 : 1) * (o.heavy ? 2.1 : 1) * rand(0.85, 1.1), pf = rand(0.9, 1.1);
    const pan = (Math.random() - 0.5) * 0.12;
    let end = t;
    switch (o.surface) {
      case 'stone': case 'road':
        end = noise(S, { kind: 'white', ft: 'bandpass', f: (o.surface === 'road' ? 1700 : 2800) * pf, q: 1.3, t, a: 0.001, d: 0.04, g: 0.11 * k, pan });
        noise(S, { kind: 'pink', ft: 'bandpass', f: 850 * pf, q: 0.9, t: t + 0.004, a: 0.004, d: 0.06, g: 0.07 * k, pan });
        if (o.surface === 'stone') tone(S, { type: 'sine', f: 2300 * pf, t, a: 0.001, d: 0.014, g: 0.018 * k, pan });
        break;
      case 'wood':
        end = tone(S, { type: 'sine', f: 190 * pf, f2: 135 * pf, t, a: 0.002, d: 0.1, g: 0.16 * k, pan });
        tone(S, { type: 'triangle', f: 390 * pf, t, a: 0.001, d: 0.045, g: 0.05 * k, pan });
        noise(S, { kind: 'pink', ft: 'bandpass', f: 720 * pf, q: 2, t, a: 0.002, d: 0.05, g: 0.08 * k, pan });
        break;
      case 'dirt':
        end = noise(S, { kind: 'brown', ft: 'lowpass', f: 650 * pf, q: 0.7, t, a: 0.003, d: 0.085, g: 0.32 * k, pan });
        tone(S, { type: 'sine', f: 95 * pf, f2: 62, t, a: 0.002, d: 0.06, g: 0.08 * k, pan });
        break;
      case 'sand':
        end = noise(S, { kind: 'white', ft: 'highpass', f: 1600 * pf, q: 0.6, t, a: 0.012, d: 0.12, g: 0.05 * k, lp: 6500, pan });
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

  // ================================================================= the sound-effect library
  // each fn(S, t, opts) schedules nodes from time t and returns its approximate end time
  const SFX = {
    click(S, t) {
      tone(S, { type: 'sine', f: 1750, f2: 1150, glide: 0.025, t, a: 0.0015, d: 0.032, g: 0.12 });
      return tone(S, { type: 'triangle', f: 880, t, a: 0.001, d: 0.022, g: 0.05 });
    },
    open(S, t) {
      tone(S, { type: 'sine', f: 440, f2: 660, glide: 0.07, t, a: 0.006, d: 0.15, g: 0.11, wet: 0.25 });
      return tone(S, { type: 'sine', f: 880, t: t + 0.055, a: 0.004, d: 0.2, g: 0.04, wet: 0.3 });
    },
    close(S, t) {
      tone(S, { type: 'sine', f: 660, f2: 430, glide: 0.08, t, a: 0.005, d: 0.14, g: 0.11 });
      return tone(S, { type: 'triangle', f: 330, t: t + 0.04, a: 0.004, d: 0.08, g: 0.03 });
    },
    notify(S, t) {
      bell(S, 1046.5, t, 0.055, 0.5, { wet: 0.5 });
      return bell(S, 1318.5, t + 0.09, 0.05, 0.65, { wet: 0.5 });
    },
    error(S, t) {
      tone(S, { type: 'triangle', f: 311, f2: 290, t, a: 0.008, d: 0.16, g: 0.12, lp: 1300 });
      return tone(S, { type: 'triangle', f: 262, f2: 240, t: t + 0.15, a: 0.008, d: 0.24, g: 0.12, lp: 1100 });
    },
    coin(S, t) {
      tone(S, { type: 'sine', f: 987.8, t, a: 0.002, d: 0.11, g: 0.11, wet: 0.35 });
      tone(S, { type: 'sine', f: 1975.5, t, a: 0.002, d: 0.06, g: 0.03 });
      tone(S, { type: 'sine', f: 1318.5, t: t + 0.075, a: 0.002, d: 0.38, g: 0.12, wet: 0.4 });
      return tone(S, { type: 'sine', f: 2637, t: t + 0.075, a: 0.002, d: 0.16, g: 0.03 });
    },
    reward(S, t) {
      const notes = [523.3, 659.3, 784, 1046.5, 1318.5, 1568];
      let end = t;
      notes.forEach((f, i) => { end = Math.max(end, bell(S, f, t + i * 0.065, 0.06 - i * 0.004, 0.55, { wet: 0.7 })); });
      noise(S, { kind: 'white', ft: 'highpass', f: 6500, t: t + 0.1, a: 0.08, d: 0.7, g: 0.016, wet: 0.6 });
      return end;
    },
    quest(S, t) {
      // gayageum strum (pentatonic) + a bright bell on top
      [67, 71, 74, 79].forEach((m, i) => pluck(S, m, t + i * 0.045, 0.34, { wet: 0.6, pan: -0.15 + i * 0.1 }));
      bell(S, 1568, t + 0.22, 0.05, 0.9, { wet: 0.8 });
      return bell(S, 2093, t + 0.3, 0.035, 0.9, { wet: 0.8 });
    },
    levelup(S, t) {
      const run = [392, 523.3, 659.3, 784];
      run.forEach((f, i) => {
        tone(S, { type: 'sawtooth', f, t: t + i * 0.1, a: 0.01, d: 0.16, g: 0.05, lp: 2400, wet: 0.5 });
        tone(S, { type: 'triangle', f, t: t + i * 0.1, a: 0.008, d: 0.2, g: 0.07, wet: 0.5 });
      });
      const t2 = t + 0.44;
      let end = t2;
      for (const f of [523.3, 659.3, 784, 1046.5]) {
        end = Math.max(end, tone(S, { type: 'sawtooth', f, t: t2, a: 0.03, d: 0.9, sus: 0.35, g: 0.032, lp: 2600, vib: { rate: 5.5, depth: f * 0.006, delay: 0.3 }, wet: 0.6 }));
        tone(S, { type: 'triangle', f: f / 2, t: t2, a: 0.03, d: 0.8, sus: 0.3, g: 0.04, wet: 0.4 });
      }
      [1568, 2093, 2637].forEach((f, i) => bell(S, f, t2 + 0.08 + i * 0.07, 0.03, 0.8, { wet: 0.8 }));
      noise(S, { kind: 'white', ft: 'highpass', f: 7000, t: t2, a: 0.1, d: 1.0, g: 0.018, wet: 0.7 });
      return end;
    },
    achievement(S, t) {
      [1568, 2093, 2637, 3136].forEach((f, i) => bell(S, f, t + i * 0.055, 0.035, 0.5, { wet: 0.7 }));
      let end = t;
      for (const f of [523.3, 659.3, 784]) end = Math.max(end, tone(S, { type: 'sine', f, t: t + 0.18, a: 0.04, d: 1.1, sus: 0.25, g: 0.045, wet: 0.7 }));
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
    harvest(S, t) {
      noise(S, { kind: 'pink', ft: 'bandpass', f: 1900, q: 0.8, t, a: 0.01, d: 0.18, g: 0.1 });
      tone(S, { type: 'sine', f: 220, f2: 540, glide: 0.06, t: t + 0.08, a: 0.003, d: 0.09, g: 0.13 });
      return bell(S, 1568, t + 0.16, 0.04, 0.35, { wet: 0.4 });
    },
    plant(S, t) {
      noise(S, { kind: 'brown', ft: 'lowpass', f: 520, q: 0.7, t, a: 0.004, d: 0.13, g: 0.38 });
      tone(S, { type: 'sine', f: 145, f2: 80, t, a: 0.003, d: 0.13, g: 0.13 });
      return bell(S, 1760, t + 0.13, 0.025, 0.35, { wet: 0.5 });
    },
    jar(S, t) { // onggi: hollow ceramic knock + lid settling
      tone(S, { type: 'sine', f: 520, t, a: 0.001, d: 0.26, g: 0.09, wet: 0.35 });
      tone(S, { type: 'sine', f: 1310, t, a: 0.001, d: 0.11, g: 0.035 });
      tone(S, { type: 'sine', f: 182, t, a: 0.003, d: 0.32, g: 0.07 });
      noise(S, { kind: 'white', ft: 'bandpass', f: 1650, q: 6, t, a: 0.001, d: 0.05, g: 0.06 });
      tone(S, { type: 'sine', f: 560, t: t + 0.1, a: 0.001, d: 0.14, g: 0.035 });
      return t + 0.45;
    },
    craft(S, t) {
      for (const dt of [0, 0.17]) {
        tone(S, { type: 'triangle', f: 310 * rand(0.95, 1.05), t: t + dt, a: 0.001, d: 0.07, g: 0.12 });
        noise(S, { kind: 'pink', ft: 'bandpass', f: 950, q: 3, t: t + dt, a: 0.001, d: 0.045, g: 0.1 });
      }
      [1318.5, 1760, 2093].forEach((f, i) => bell(S, f, t + 0.34 + i * 0.06, 0.035, 0.45, { wet: 0.5 }));
      return t + 0.9;
    },
    shutter(S, t) {
      noise(S, { kind: 'white', ft: 'highpass', f: 2600, q: 0.7, t, a: 0.0008, d: 0.025, g: 0.22 });
      noise(S, { kind: 'white', ft: 'bandpass', f: 1250, q: 1, t: t + 0.004, a: 0.002, d: 0.05, g: 0.08 });
      tone(S, { type: 'sawtooth', f: 170, t: t + 0.015, a: 0.004, d: 0.05, g: 0.025, lp: 650 });
      noise(S, { kind: 'white', ft: 'highpass', f: 3000, q: 0.7, t: t + 0.075, a: 0.0008, d: 0.022, g: 0.15 });
      return t + 0.18;
    },
    step(S, t, o) { return step(S, t, o); },
    land(S, t, o) {
      step(S, t, { ...o, heavy: true });
      return tone(S, { type: 'sine', f: 85, f2: 46, t, a: 0.003, d: 0.14, g: 0.2 });
    },
    jump(S, t) {
      noise(S, { kind: 'pink', ft: 'bandpass', f: 480, f2: 1450, sweep: 0.16, q: 0.8, t, a: 0.02, d: 0.18, g: 0.17 });
      return tone(S, { type: 'sine', f: 260, f2: 430, glide: 0.09, t, a: 0.006, d: 0.1, g: 0.06 });
    },
    splash(S, t) {
      const end = noise(S, { kind: 'white', ft: 'bandpass', f: 1500, f2: 600, sweep: 0.3, q: 0.7, t, a: 0.003, d: 0.38, g: 0.2 });
      tone(S, { type: 'sine', f: 125, f2: 70, t, a: 0.003, d: 0.15, g: 0.11 });
      for (let i = 0; i < 6; i++) { const f = rand(420, 1000); tone(S, { type: 'sine', f, f2: f * 2, glide: 0.035, t: t + rand(0.08, 0.45), a: 0.003, d: 0.05, g: 0.03 }); }
      return end;
    },
    chat(S, t) {
      tone(S, { type: 'sine', f: 784, f2: 1046.5, glide: 0.045, t, a: 0.003, d: 0.09, g: 0.085 });
      return tone(S, { type: 'sine', f: 1568, t: t + 0.04, a: 0.002, d: 0.08, g: 0.028 });
    },
    emote(S, t) { // cartoon "boing"
      tone(S, { type: 'sine', f: 420, f2: 860, glide: 0.07, f3: 690, glide2: 0.12, t, a: 0.005, d: 0.26, g: 0.09, vib: { rate: 11, depth: 25, delay: 0.1 }, wet: 0.3 });
      return bell(S, 1760, t + 0.06, 0.025, 0.3, { wet: 0.3 });
    },
    teleport(S, t) {
      tone(S, { type: 'sine', f: 300, f2: 1250, glide: 0.42, t, a: 0.05, d: 0.5, g: 0.06, wet: 0.7 });
      tone(S, { type: 'triangle', f: 452, f2: 1880, glide: 0.42, t, a: 0.05, d: 0.45, g: 0.025, wet: 0.7 });
      noise(S, { kind: 'white', ft: 'highpass', f: 1800, f2: 7500, sweep: 0.45, q: 0.7, t, a: 0.1, d: 0.5, g: 0.025, wet: 0.6 });
      [1046.5, 1318.5, 1568].forEach((f, i) => bell(S, f, t + 0.32 + i * 0.05, 0.035, 0.5, { wet: 0.8 }));
      return t + 1.0;
    },
    page(S, t) {
      noise(S, { kind: 'white', ft: 'bandpass', f: 2900, f2: 1500, sweep: 0.17, q: 0.9, t, a: 0.035, d: 0.16, g: 0.11 });
      noise(S, { kind: 'pink', ft: 'lowpass', f: 900, q: 0.7, t: t + 0.06, a: 0.02, d: 0.1, g: 0.09 });
      return t + 0.3;
    },
    correct(S, t) {
      [1046.5, 1318.5, 1568].forEach((f, i) => bell(S, f, t + i * 0.075, 0.06, 0.42, { wet: 0.5 }));
      return t + 0.7;
    },
    wrong(S, t) {
      tone(S, { type: 'triangle', f: 330, t, a: 0.006, d: 0.14, g: 0.11, lp: 1500 });
      return tone(S, { type: 'triangle', f: 247, f2: 233, t: t + 0.16, a: 0.006, d: 0.26, g: 0.11, lp: 1300 });
    },
    // small extras used internally / by other modules
    bubble(S, t, o) { const f = o.f || rand(450, 1100); return tone(S, { type: 'sine', f, f2: f * rand(1.6, 2.2), glide: 0.03, t, a: 0.003, d: 0.045, g: 0.04 }); },
    drip(S, t, o) { const f = o.f || rand(1800, 3800); return tone(S, { type: 'sine', f, f2: f * 0.7, glide: 0.03, t, a: 0.001, d: 0.04, g: 0.03 }); },
    pop(S, t) { return tone(S, { type: 'sine', f: 600, f2: 1200, glide: 0.04, t, a: 0.002, d: 0.06, g: 0.06 }); },
    whoosh(S, t) { return noise(S, { kind: 'pink', ft: 'bandpass', f: 400, f2: 1600, sweep: 0.25, q: 0.8, t, a: 0.08, d: 0.25, g: 0.08 }); },
  };
  SFX.levelUp = SFX.levelup;

  // ================================================================= ambience one-shots (ambient bus)
  const AMB = {
    bird(S, t, kind, g, pan) {
      const o = { pan, wet: 0.45 };
      if (kind === 'chirps') {
        const n = randInt(3, 6), f0 = rand(2800, 4300), up = Math.random() < 0.5, gap = rand(0.085, 0.14);
        for (let i = 0; i < n; i++) {
          const f = f0 * rand(0.96, 1.04);
          tone(S, { ...o, type: 'sine', f, f2: f * (up ? rand(1.15, 1.35) : rand(0.72, 0.85)), glide: 0.05, t: t + i * gap, a: 0.004, d: rand(0.04, 0.07), g });
        }
        return t + n * gap + 0.1;
      }
      if (kind === 'warble') {
        const f = rand(2500, 3500), dur = rand(0.45, 0.8);
        const os = S.ac.createOscillator(); os.frequency.setValueAtTime(f, t); os.frequency.linearRampToValueAtTime(f * rand(0.85, 1.2), t + dur);
        const l = S.ac.createOscillator(); l.frequency.value = rand(16, 28);
        const lg = gainNode(S.ac, rand(250, 520)); l.connect(lg); lg.connect(os.frequency);
        const gg = S.ac.createGain();
        gg.gain.setValueAtTime(0.0001, t); gg.gain.linearRampToValueAtTime(g * 0.8, t + 0.04);
        gg.gain.setValueAtTime(g * 0.8, t + dur - 0.08); gg.gain.linearRampToValueAtTime(0.0001, t + dur);
        os.connect(gg); route(S, gg, o);
        os.start(t); l.start(t); os.stop(t + dur + 0.02); l.stop(t + dur + 0.02);
        return t + dur;
      }
      if (kind === 'twonote') {
        const reps = randInt(2, 3), f1 = rand(3500, 4200), sp = rand(0.34, 0.44);
        for (let r = 0; r < reps; r++) {
          tone(S, { ...o, type: 'sine', f: f1, f2: f1 * 1.03, t: t + r * sp, a: 0.006, d: 0.1, g });
          tone(S, { ...o, type: 'sine', f: f1 * 0.77, f2: f1 * 0.74, t: t + r * sp + 0.14, a: 0.006, d: 0.12, g: g * 0.9 });
        }
        return t + reps * sp + 0.2;
      }
      if (kind === 'trill') {
        const n = randInt(10, 18), f = rand(4200, 5600), gap = rand(0.024, 0.034);
        for (let i = 0; i < n; i++) tone(S, { ...o, type: 'sine', f: f * (1 - i * 0.004), t: t + i * gap, a: 0.002, d: 0.018, g: g * 0.7 });
        return t + n * gap + 0.05;
      }
      // distant cuckoo (뻐꾸기) across the valley
      const reps = randInt(2, 3);
      for (let r = 0; r < reps; r++) {
        tone(S, { pan, wet: 0.9, type: 'sine', f: 690, f2: 680, t: t + r * 0.95, a: 0.02, d: 0.3, g: g * 0.9, lp: 2000 });
        tone(S, { pan, wet: 0.9, type: 'sine', f: 565, f2: 555, t: t + r * 0.95 + 0.33, a: 0.02, d: 0.42, g: g * 0.85, lp: 2000 });
      }
      return t + reps * 0.95 + 0.5;
    },
    cricket(S, t, f, g, pan) {
      for (let k = 0; k < 3; k++) tone(S, { type: 'sine', f, t: t + k * 0.044, a: 0.003, d: 0.026, g, pan });
      return t + 0.17;
    },
    frog(S, t, g, pan) {
      const reps = randInt(2, 4), f = rand(105, 165);
      for (let r = 0; r < reps; r++) tone(S, { type: 'sawtooth', f, f2: f * 0.86, t: t + r * rand(0.17, 0.24), a: 0.012, d: 0.11, g, lp: 650, lpq: 3.5, pan, wet: 0.3 });
      return t + reps * 0.24;
    },
    cicada(S, t, dur, g) { // 참매미 "맴맴" pulses: band-limited square through a resonant band-pass
      const ac = S.ac;
      const os = ac.createOscillator(); os.type = 'square'; os.frequency.value = rand(4100, 4700);
      const bp = filter(ac, 'bandpass', os.frequency.value, 5);
      const gg = ac.createGain(); gg.gain.setValueAtTime(0, t);
      const n = Math.floor(dur / 0.36);
      for (let i = 0; i < n; i++) {
        const tt = t + i * 0.36, sw = Math.sin((i / n) * Math.PI);
        gg.gain.setValueAtTime(0.0001, tt);
        gg.gain.linearRampToValueAtTime(g * (0.25 + 0.75 * sw), tt + 0.05);
        gg.gain.setValueAtTime(g * (0.25 + 0.75 * sw), tt + 0.22);
        gg.gain.linearRampToValueAtTime(0.0001, tt + 0.3);
      }
      os.connect(bp); bp.connect(gg); route(S, gg, { pan: rand(-0.6, 0.6), wet: 0.3 });
      os.start(t); os.stop(t + n * 0.36 + 0.1);
      return t + n * 0.36;
    },
  };

  // ================================================================= Karplus–Strong plucked string
  function renderPluck(ac, midi) {
    // 22.05 kHz is plenty for a string that is low-passed at 4.2 kHz and keeps the note cache ~4x smaller
    const sr = 22050;
    const f = mtof(midi);
    const P = sr / f;
    let N = Math.floor(P - 0.5 - 0.15);
    if (N < 2) N = 2;
    const delta = P - N - 0.5;
    const C = (1 - delta) / (1 + delta);
    const k = clamp((midi - 48) / 36, 0, 1);
    const t60 = lerp(3.3, 1.3, k);
    const rho = Math.pow(10, (-3 * P) / (sr * t60));
    const dur = Math.min(3.4, t60 * 1.05);
    const len = Math.floor(sr * dur);
    const buffer = typeof AudioBuffer === 'function' ? new AudioBuffer({ length: len, sampleRate: sr, numberOfChannels: 1 }) : ac.createBuffer(1, len, sr);
    const out = buffer.getChannelData(0);
    // excitation: low-passed noise burst + pick-position comb (silk string, plucked near the bridge)
    const line = new Float32Array(N);
    const bright = lerp(0.42, 0.62, k);
    let lp = 0, mean = 0;
    for (let i = 0; i < N; i++) { lp += (Math.random() * 2 - 1 - lp) * bright; line[i] = lp; }
    const pk = Math.max(1, Math.floor(N * 0.14));
    const ex = line.slice();
    for (let i = 0; i < N; i++) { line[i] = ex[i] - (i >= pk ? ex[i - pk] * 0.85 : 0); mean += line[i]; }
    mean /= N;
    for (let i = 0; i < N; i++) line[i] -= mean;
    let idx = 0, prev = 0, apx = 0, apy = 0, peak = 0;
    for (let n = 0; n < len; n++) {
      const x = line[idx];
      const avg = 0.5 * (x + prev); prev = x;
      const ap = C * avg + apx - C * apy; apx = avg; apy = ap;
      line[idx] = ap * rho;
      idx++; if (idx >= N) idx = 0;
      out[n] = x;
      const ax = x < 0 ? -x : x; if (ax > peak) peak = ax;
    }
    // gentle fade at the end + normalise
    const fade = Math.floor(sr * 0.08);
    const norm = peak > 0 ? 0.8 / peak : 1;
    for (let n = 0; n < len; n++) { out[n] *= norm; if (n > len - fade) out[n] *= (len - n) / fade; }
    return buffer;
  }

  function makeNoise(ac, kind, seconds = 2.5) {
    const sr = ac.sampleRate, len = Math.floor(sr * seconds);
    const b = typeof AudioBuffer === 'function' ? new AudioBuffer({ length: len, sampleRate: sr, numberOfChannels: 1 }) : ac.createBuffer(1, len, sr);
    const d = b.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      if (kind === 'pink') { // Paul Kellet's filter
        b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
        b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
        d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11; b6 = w * 0.115926;
      } else if (kind === 'brown') { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; }
      else d[i] = w * 0.9;
    }
    // crossfade the loop seam
    const xf = Math.floor(sr * 0.05);
    for (let i = 0; i < xf; i++) { const k = i / xf; d[i] = d[i] * k + d[len - xf + i] * (1 - k); }
    return b;
  }

  function makeImpulse(ac, seconds = 2.4) {
    const sr = ac.sampleRate, len = Math.floor(sr * seconds);
    const b = ac.createBuffer(2, len, sr);
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        const tt = i / sr;
        const env = Math.pow(1 - i / len, 2.2) * Math.exp(-tt * 1.6);
        const coef = lerp(0.85, 0.12, Math.min(1, tt / seconds)); // tail gets darker
        lp += (Math.random() * 2 - 1 - lp) * coef;
        d[i] = lp * env * (i < sr * 0.012 ? i / (sr * 0.012) : 1);
      }
    }
    return b;
  }

  // ================================================================= mastering: trim -> limiter -> soft clip
  // The limiter catches fanfares stacking on top of music/ambience; the soft clipper (transparent below
  // ~-3 dBFS) guarantees that nothing ever reaches digital full scale, even if many sounds coincide.
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
  /** builds the output stage on ac; returns {input, limiter, clip} (input is where the master bus connects) */
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

  // ================================================================= music (generative, Korean pentatonic)
  const MOODS = {
    // 평조 (pyeongjo) colour: G major pentatonic, 12/8 굿거리-like lilt
    day: { root: 55, scale: [0, 2, 4, 7, 9], bpm: 50, range: [3, 10], start: [5, 8], tonic: [5, 10], rest: 0.12, dyads: [[43, 50], [45, 52], [40, 47], [43, 50]], vel: 0.32 },
    // 계면조 (gyemyeonjo) colour: E minor pentatonic, slower, lower, sparser, with a bamboo-flute answer
    night: { root: 52, scale: [0, 3, 5, 7, 10], bpm: 41, range: [2, 8], start: [4, 6], tonic: [5, 0], rest: 0.26, dyads: [[40, 47], [45, 52], [43, 50], [40, 47]], vel: 0.27, flute: 0.4 },
  };
  const CELLS = { // rhythm cells (in eighths) for one dotted-quarter beat; negative = rest
    day: [[[3], 3], [[2, 1], 3], [[1, 2], 1.5], [[1, 1, 1], 1.4], [[-3], 0.9], [[2, -1], 1]],
    night: [[[3], 4], [[2, 1], 2], [[1, 2], 1], [[1, 1, 1], 0.5], [[-3], 1.6], [[2, -1], 1.2]],
  };
  function wpick(list) { let tot = 0; for (const [, w] of list) tot += w; let x = Math.random() * tot; for (const [v, w] of list) { x -= w; if (x <= 0) return v; } return list[0][0]; }
  function degMidi(M, deg) { const n = M.scale.length; const o = Math.floor(deg / n); return M.root + 12 * o + M.scale[((deg % n) + n) % n]; }

  // ================================================================= the system
  const audio = {
    name: 'audio', order: 85, label: '사운드',
    supported: !!AC, ctx: null, ready: false, unlocked: false,
    levels: { master: 0, music: 0, sfx: 0, ambient: 0 },
    stats: { played: 0, dropped: 0, last: null, byName: {} },
    mood: 'day',
    _nodes: null, _S: null, _bufs: null, _plucks: new Map(), _pluckQueue: [],
    _last: new Map(), _voices: 0, _ducks: new Map(), _amb: null, _mus: null, _ambT: 0, _listener: { x: 0, z: 0 },
    _voice: null, _voicesList: [], _speaking: false, _suspendedByUs: false,

    init() {
      if (!AC) { G.log.info('AUDIO', 'Web Audio not supported - sound disabled'); }
      else this._armGesture();
      G.bus.on('settings:changed', ({ key }) => {
        if (/^volume|^muted$/.test(key)) { this._applyVolumes(); if (key === 'muted' && G.settings.muted) this.stopSpeaking(); }
      });
      document.addEventListener('visibilitychange', () => this._syncSuspend());
      // speech voices load asynchronously
      try {
        const ss = window.speechSynthesis;
        if (ss) {
          const load = () => { try { this._voicesList = ss.getVoices() || []; this._voice = null; } catch (e) { /* ignore */ } };
          load();
          ss.addEventListener?.('voiceschanged', load);
        }
      } catch (e) { /* no TTS */ }
      // music reacts to the time of day immediately at phase changes
      G.bus.on('time:phase', () => { if (this._mus) this._mus.moodCheck = 0; });
      G.bus.on('game:ready', () => { if (this._mus) this._mus.cursor = Math.max(this._mus.cursor, (this.ctx?.currentTime || 0) + 0.6); });
      // dialogue: keep the music under the conversation (TTS ducks further while speaking)
      G.bus.on('npc:talk', () => this.duck('dialogue', 0.55));
      G.bus.on('dialogue:end', () => this.unduck('dialogue'));
      G.bus.on('photo:mode', ({ active } = {}) => { if (active) this.duck('photo', 0.75); else this.unduck('photo'); });
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
    /** resume on the next user gesture (first start, or after the OS/browser interrupted the context) */
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
      try { ac = new AC({ latencyHint: 'interactive' }); } catch (e) { ac = new AC(); }
      this.ctx = ac;
      ac.onstatechange = () => {
        if (ac.state === 'running') { if (this._mus) this._mus.cursor = Math.max(this._mus.cursor, ac.currentTime + 0.3); return; }
        if (ac.state !== 'closed' && !this._suspendedByUs) this._armGesture(); // interrupted by the system
      };
      const n = {};
      n.out = buildMaster(ac, ac.destination);
      n.limiter = n.out.limiter;
      n.master = gainNode(ac, 0); n.master.connect(n.out.input);
      n.music = gainNode(ac, 0); n.duck = gainNode(ac, 1); n.music.connect(n.duck); n.duck.connect(n.master);
      n.sfx = gainNode(ac, 0); n.sfx.connect(n.master);
      n.amb = gainNode(ac, 0); n.amb.connect(n.master);
      // shared reverb (valley ambience)
      n.verb = ac.createConvolver();
      try { n.verb.buffer = makeImpulse(ac, 2.4); } catch (e) { G.log.warn('AUDIO', 'reverb disabled', e); }
      n.verbOut = gainNode(ac, 0.9); n.verb.connect(n.verbOut); n.verbOut.connect(n.master);
      n.sfxWet = gainNode(ac, 0); n.sfxWet.connect(n.verb);
      n.ambWet = gainNode(ac, 0); n.ambWet.connect(n.verb);
      n.musicWet = gainNode(ac, 0.42); n.duck.connect(n.musicWet); n.musicWet.connect(n.verb);
      // instrument body for the plucked strings (warm wooden resonance)
      n.inst = gainNode(ac, 1);
      n.instBody = filter(ac, 'peaking', 240, 1.1, 3.5);
      n.instTop = filter(ac, 'lowpass', 4200, 0.6);
      n.inst.connect(n.instBody); n.instBody.connect(n.instTop); n.instTop.connect(n.music);
      n.pad = gainNode(ac, 1);
      n.padLp = filter(ac, 'lowpass', 850, 0.5);
      n.pad.connect(n.padLp); n.padLp.connect(n.music);
      this._nodes = n;
      this._bufs = { white: makeNoise(ac, 'white'), pink: makeNoise(ac, 'pink'), brown: makeNoise(ac, 'brown') };
      const self = this;
      this._S = { ac, out: n.sfx, wet: n.sfxWet, buf: this._bufs, t: 0, pluck: (m) => self._pluck(m) };
      this._SA = { ac, out: n.amb, wet: n.ambWet, buf: this._bufs, t: 0, pluck: null };
      this._SM = { ac, out: n.inst, wet: null, buf: this._bufs, t: 0, pluck: (m) => self._pluck(m) };
      this._buildAmbience();
      this._mus = { cursor: ac.currentTime + 1.2, queue: [], phrase: 0, prev: null, dyad: -1, padVoices: [], moodCheck: 0, mood: null, playing: false };
      this._applyVolumes(true);
      this.ready = true;
      // pre-render the strings over the next frames (no hitch at the first phrase)
      for (const M of [MOODS.day, MOODS.night]) for (let d = 0; d <= 12; d++) this._pluckQueue.push(degMidi(M, d));
      this._pluckQueue.push(67, 71, 74, 79);
    },

    _pluck(midi) {
      const m = Math.round(clamp(midi, 36, 96));
      let b = this._plucks.get(m);
      if (!b && this.ctx) { try { b = renderPluck(this.ctx, m); this._plucks.set(m, b); } catch (e) { b = null; } }
      return b || null;
    },

    _applyVolumes(instant) {
      const s = G.settings || {};
      const lv = (v) => { v = clamp(Number(v), 0, 1); return Number.isFinite(v) ? Math.pow(v, 1.6) : 0; };
      const master = s.muted ? 0 : lv(s.volumeMaster ?? 0.8);
      this.levels = { master, music: lv(s.volumeMusic ?? 0.45), sfx: lv(s.volumeSfx ?? 0.8), ambient: lv(s.volumeAmbient ?? 0.6) };
      const n = this._nodes;
      if (!n) return;
      const now = this.ctx.currentTime, tc = instant ? 0.001 : 0.06;
      const set = (p, v) => { p.cancelScheduledValues(now); p.setTargetAtTime(v, now, tc); };
      set(n.master.gain, master);
      set(n.music.gain, this.levels.music * BASE.music);
      set(n.sfx.gain, this.levels.sfx * BASE.sfx);
      set(n.amb.gain, this.levels.ambient * BASE.ambient);
      set(n.sfxWet.gain, this.levels.sfx * BASE.sfx * 0.5);
      set(n.ambWet.gain, this.levels.ambient * BASE.ambient * 0.4);
      this._syncSuspend();
    },

    /** suspend the context while the tab is hidden or everything is silent (saves CPU) */
    _syncSuspend() {
      const ac = this.ctx;
      if (!ac || !this.unlocked || ac.state === 'closed') return;
      const silent = this.levels.master <= 0.0001;
      const want = document.hidden || silent ? 'suspended' : 'running';
      if (want === 'suspended' && ac.state === 'running') { this._suspendedByUs = true; ac.suspend().catch(() => {}); }
      else if (want === 'running' && ac.state === 'suspended') {
        this._suspendedByUs = false;
        ac.resume().then(() => { if (this._mus) this._mus.cursor = Math.max(this._mus.cursor, ac.currentTime + 0.4); }).catch(() => {});
      }
    },

    // ------------------------------------------------------------ public: sfx
    play(name, opts) {
      try {
        const ac = this.ctx;
        if (!ac || !this.ready || ac.state === 'closed') return false;
        if (this.levels.master <= 0.0001 || this.levels.sfx <= 0.0001) return false;
        const fn = SFX[name];
        if (!fn) { G.log.debug('AUDIO', `unknown sfx "${name}"`); return false; }
        const o = opts && typeof opts === 'object' ? opts : {};
        const now = ac.currentTime;
        const min = THROTTLE[name] ?? 0.03;
        const last = this._last.get(name);
        if (last != null && now - last < min && !o.force) return false;
        if (this._voices >= MAX_VOICES) { this.stats.dropped++; return false; }
        let vol = o.volume ?? 1, pan = o.pan || 0;
        if (o.at && Number.isFinite(o.at.x)) { // simple distance attenuation + panning from the camera
          const cam = G.sys.engine?.camera;
          if (cam) {
            const dx = o.at.x - cam.position.x, dz = o.at.z - cam.position.z;
            const d = Math.hypot(dx, dz);
            vol *= clamp(1 - (d - 6) / 40, 0, 1);
            if (vol <= 0.01) return false;
            const e = cam.matrixWorld.elements; // camera right = column 0
            const rl = Math.hypot(e[0], e[2]) || 1;
            if (d > 0.5) pan = clamp(((dx * e[0] + dz * e[2]) / rl / d) * 0.7, -0.8, 0.8);
          }
        }
        this._last.set(name, now);
        const out = gainNode(ac, clamp(vol, 0, 2));
        let head = out;
        const p = panNode(ac, pan);
        if (p) { out.connect(p); head = p; }
        head.connect(this._nodes.sfx);
        const S = this._S;
        S.out = out;
        S.wet = WET[name] ? this._nodes.sfxWet : null;
        const t = now + 0.006;
        let end = fn(S, t, o) || t + 0.4;
        if (!Number.isFinite(end)) end = t + 0.5;
        this._voices++;
        const life = Math.min(4, Math.max(0.15, end - now)) + 0.35;
        setTimeout(() => { this._voices--; try { out.disconnect(); p?.disconnect(); } catch (e) { /* gone */ } }, life * 1000);
        if (FANFARE[name]) this.duck('fanfare', 0.38, FANFARE[name]);
        this.stats.played++; this.stats.last = name; this.stats.byName[name] = (this.stats.byName[name] || 0) + 1;
        return true;
      } catch (e) { G.log.debug('AUDIO', 'play failed', name, e); return false; }
    },

    /** music ducking: the lowest active duck wins; seconds = auto release */
    duck(key, gain = 0.4, seconds) {
      const now = performance.now() / 1000;
      this._ducks.set(key, { gain: clamp(gain, 0, 1), until: seconds ? now + seconds : Infinity });
      this._applyDuck();
    },
    unduck(key) { if (this._ducks.delete(key)) this._applyDuck(); },
    _applyDuck() {
      const n = this._nodes;
      let g = 1;
      for (const d of this._ducks.values()) g = Math.min(g, d.gain);
      this._duckLevel = g;
      if (!n) return;
      const now = this.ctx.currentTime;
      n.duck.gain.cancelScheduledValues(now);
      n.duck.gain.setTargetAtTime(g, now, g < 1 ? 0.12 : 0.6);
    },

    // ------------------------------------------------------------ public: speech (TTS)
    speak(text, opts = {}) {
      try {
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
        u.volume = clamp((this.levels.master || 0.6) * 1.15, 0.1, 1);
        u.onstart = () => { this._speaking = true; this.duck('speech', 0.45); };
        const done = () => { this._speaking = false; this.unduck('speech'); };
        u.onend = done; u.onerror = done;
        ss.speak(u);
        return true;
      } catch (e) { G.log.debug('AUDIO', 'speak failed', e); return false; }
    },
    stopSpeaking() {
      try { window.speechSynthesis?.cancel(); } catch (e) { /* ignore */ }
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

    // ------------------------------------------------------------ ambience beds
    _buildAmbience() {
      const ac = this.ctx, n = this._nodes, B = this._bufs;
      const loop = (buf, rate = 1) => { const s = ac.createBufferSource(); s.buffer = buf; s.loop = true; s.playbackRate.value = rate; s.start(ac.currentTime, Math.random() * 1.5); return s; };
      const A = {};
      // wind: pink noise, slowly wandering low-pass + amplitude flutter
      A.windSrc = loop(B.pink, 0.9);
      A.windF = filter(ac, 'lowpass', 520, 0.9);
      A.windG = gainNode(ac, 0.0001);
      A.windSrc.connect(A.windF); A.windF.connect(A.windG); A.windG.connect(n.amb);
      A.windLfo = ac.createOscillator(); A.windLfo.frequency.value = 0.055;
      A.windLfoG = gainNode(ac, 260); A.windLfo.connect(A.windLfoG); A.windLfoG.connect(A.windF.frequency); A.windLfo.start();
      // stream / river: band-passed white noise whose centre wanders (babbling) + panning
      A.waterSrc = loop(B.white);
      A.waterBp = filter(ac, 'bandpass', 950, 0.55);
      A.waterLp = filter(ac, 'lowpass', 3400, 0.5);
      A.waterG = gainNode(ac, 0.0001);
      A.waterPan = panNode(ac, 0.001);
      A.waterSrc.connect(A.waterBp); A.waterBp.connect(A.waterLp); A.waterLp.connect(A.waterG);
      if (A.waterPan) { A.waterG.connect(A.waterPan); A.waterPan.connect(n.amb); } else A.waterG.connect(n.amb);
      A.waterRumble = loop(B.brown, 0.8);
      A.waterRumbleF = filter(ac, 'lowpass', 300, 0.6);
      A.waterRumbleG = gainNode(ac, 0.0001);
      A.waterRumble.connect(A.waterRumbleF); A.waterRumbleF.connect(A.waterRumbleG); A.waterRumbleG.connect(A.waterPan || n.amb);
      // waterfall (hall garden)
      A.fallSrc = loop(B.white, 0.7);
      A.fallHp = filter(ac, 'highpass', 280, 0.6);
      A.fallLp = filter(ac, 'lowpass', 4600, 0.6);
      A.fallG = gainNode(ac, 0.0001);
      A.fallSrc.connect(A.fallHp); A.fallHp.connect(A.fallLp); A.fallLp.connect(A.fallG); A.fallG.connect(n.amb);
      // rain
      A.rainSrc = loop(B.white, 1.1);
      A.rainHp = filter(ac, 'highpass', 650, 0.5);
      A.rainLp = filter(ac, 'lowpass', 7200, 0.5);
      A.rainG = gainNode(ac, 0.0001);
      A.rainSrc.connect(A.rainHp); A.rainHp.connect(A.rainLp); A.rainLp.connect(A.rainG); A.rainG.connect(n.amb);
      A.rainLow = loop(B.brown, 1);
      A.rainLowF = filter(ac, 'lowpass', 240, 0.6);
      A.rainLowG = gainNode(ac, 0.0001);
      A.rainLow.connect(A.rainLowF); A.rainLowF.connect(A.rainLowG); A.rainLowG.connect(n.amb);
      // scheduling state (ctx time)
      const t = ac.currentTime;
      A.nextBird = t + rand(1, 3); A.nextGust = t + rand(5, 10); A.nextBabble = t; A.nextBubble = t + 1; A.nextDrip = t + 1;
      A.nextFrog = t + rand(3, 8); A.nextCicada = t + rand(25, 60);
      A.crickets = [0, 1, 2].map((i) => ({ f: rand(4300, 5300), period: rand(0.55, 0.95), pan: (i - 1) * 0.55 + rand(-0.1, 0.1), g: rand(0.012, 0.022), next: t + rand(0.2, 1.5), on: true, toggle: t + rand(6, 20) }));
      A.windBase = 0.07; A.water = 0; A.rain = 0; A.night = 0; A.day = 1;
      this._amb = A;
    },

    _listenerPos() {
      const pl = G.sys.player;
      if (G.state && pl?._ready && pl.position) return pl.position;
      return G.sys.engine?.camera?.position || this._listener;
    },

    _updateAmbience(dt) {
      const A = this._amb, ac = this.ctx;
      if (!A) return;
      const now = ac.currentTime;
      this._ambT -= dt;
      if (this._ambT <= 0) {
        this._ambT = 0.25;
        const p = this._listenerPos();
        const W = G.sys.weather;
        const night = clamp(Number(W?.nightFactor ?? G.world?.nightFactor ?? 0) || 0, 0, 1);
        const wid = W?.current || 'CLEAR';
        const rain = clamp(Number(W?.precipitation?.rain ?? (wid === 'RAIN' ? 1 : 0)) || 0, 0, 1);
        const snow = clamp(Number(W?.precipitation?.snow ?? (wid === 'SNOW' ? 1 : 0)) || 0, 0, 1);
        A.night = night; A.day = 1 - night; A.rain = rain; A.snow = snow; A.weather = wid;
        A.hour = Number(W?.hour ?? 12);
        // wind
        const windBase = { CLEAR: 0.06, CLOUDY: 0.09, RAIN: 0.1, FOG: 0.045, SNOW: 0.11 }[wid] ?? 0.06;
        A.windBase = windBase * (1 + night * 0.15);
        if (!A.gusting) A.windG.gain.setTargetAtTime(A.windBase, now, 1.5);
        // water by distance (river, ponds) + waterfall
        let dw = Infinity;
        try { const d = G.sys.water?.distanceToWater?.(p.x, p.z); if (Number.isFinite(d)) dw = d; } catch (e) { /* optional */ }
        const L = G.data.layout || {};
        let rx = null, rz = null;
        if (L.river?.points) {
          const r = G.util.distToPolyline(p.x, p.z, L.river.points);
          if (!Number.isFinite(dw)) dw = Math.max(0, r.d - (L.river.width || 16) / 2);
          const pts = L.river.points, i = r.i;
          const a = pts[i], b = pts[Math.min(i + 1, pts.length - 1)];
          const ax = b[0] - a[0], az = b[1] - a[1], ll = ax * ax + az * az || 1;
          const tt = clamp(((p.x - a[0]) * ax + (p.z - a[1]) * az) / ll, 0, 1);
          rx = a[0] + ax * tt; rz = a[1] + az * tt;
        }
        for (const pd of L.ponds || []) { const d = Math.hypot(p.x - pd.x, p.z - pd.z) - pd.r; if (!Number.isFinite(dw) || d < dw) dw = Math.max(0, d); }
        const near = Number.isFinite(dw) ? clamp(1 - dw / 42, 0, 1) : 0;
        A.water = near;
        const wg = 0.36 * Math.pow(near, 1.7) * (1 - rain * 0.3);
        A.waterG.gain.setTargetAtTime(wg, now, 0.4);
        A.waterRumbleG.gain.setTargetAtTime(wg * 0.55, now, 0.5);
        if (A.waterPan && rx != null) {
          const cam = G.sys.engine?.camera;
          let pan = 0;
          if (cam) {
            const e = cam.matrixWorld.elements, dx = rx - p.x, dz = rz - p.z, d = Math.hypot(dx, dz) || 1, rl = Math.hypot(e[0], e[2]) || 1;
            pan = clamp(((dx * e[0] + dz * e[2]) / rl / d) * 0.65 * (1 - near * 0.45), -0.8, 0.8);
          }
          A.waterPan.pan.setTargetAtTime(pan, now, 0.5);
        }
        let fall = 0;
        for (const pd of L.ponds || []) {
          if (!pd.waterfall) continue;
          const d = Math.hypot(p.x - pd.waterfall.x, p.z - pd.waterfall.z);
          fall = Math.max(fall, clamp(1 - d / 30, 0, 1));
        }
        A.fallG.gain.setTargetAtTime(0.28 * Math.pow(fall, 1.6), now, 0.4);
        // rain bed
        A.rainG.gain.setTargetAtTime(0.2 * rain, now, 1.2);
        A.rainLowG.gain.setTargetAtTime(0.32 * rain * rain, now, 1.5);
      }
      // ---- events scheduled on the audio clock
      const S = this._SA;
      // babbling: wander the band-pass centre
      if (A.water > 0.02 && now >= A.nextBabble) {
        A.nextBabble = now + rand(0.12, 0.35);
        A.waterBp.frequency.setTargetAtTime(rand(700, 1500), now, 0.12);
      }
      if (A.water > 0.25 && now >= A.nextBubble) {
        A.nextBubble = now + rand(0.08, 0.5) / A.water;
        S.out = A.waterPan || this._nodes.amb;
        const f = rand(450, 1150);
        tone(S, { type: 'sine', f, f2: f * rand(1.6, 2.1), glide: 0.03, t: now + 0.02, a: 0.003, d: 0.045, g: 0.028 * A.water });
        S.out = this._nodes.amb;
      }
      // wind gusts
      if (now >= A.nextGust) {
        A.nextGust = now + rand(7, 18);
        const peak = A.windBase * rand(1.6, 2.4), len = rand(2, 4.5);
        A.gusting = true;
        A.windG.gain.cancelScheduledValues(now);
        A.windG.gain.setTargetAtTime(peak, now, len * 0.3);
        A.windG.gain.setTargetAtTime(A.windBase, now + len, len * 0.4);
        A.windF.frequency.cancelScheduledValues(now);
        A.windF.frequency.setTargetAtTime(rand(700, 1000), now, len * 0.3);
        A.windF.frequency.setTargetAtTime(520, now + len, len * 0.4);
        setTimeout(() => { A.gusting = false; }, (len * 2.2) * 1000);
      }
      // birds by day
      const quiet = A.rain > 0.3 || A.snow > 0.5;
      if (now >= A.nextBird) {
        A.nextBird = now + rand(1.6, 5.5) / Math.max(0.3, A.day);
        if (A.day > 0.45 && !quiet) {
          const kind = wpick([['chirps', 4], ['twonote', 3], ['warble', 2], ['trill', 1.5], ['cuckoo', A.hour > 6 && A.hour < 11 ? 1.2 : 0.5]]);
          AMB.bird(S, now + 0.05, kind, rand(0.022, 0.05) * A.day, rand(-0.85, 0.85));
        }
      }
      // crickets at night
      if (A.night > 0.5 && A.rain < 0.5) {
        for (const c of A.crickets) {
          if (now >= c.toggle) { c.on = Math.random() < 0.75; c.toggle = now + rand(5, 18); }
          if (now >= c.next) {
            c.next = now + c.period * rand(0.92, 1.08);
            if (c.on && c.next - now < 2) AMB.cricket(S, now + 0.03, c.f, c.g * (A.night - 0.4) * 1.6, c.pan);
          }
        }
      } else for (const c of A.crickets) c.next = Math.max(c.next, now);
      // frogs near water at night (and a little in the rain)
      if (now >= A.nextFrog) {
        A.nextFrog = now + rand(2.5, 7);
        const want = Math.max(A.night, A.rain * 0.6) * clamp(A.water * 1.6, 0, 1);
        if (want > 0.25) AMB.frog(S, now + 0.04, 0.035 * want, rand(-0.7, 0.7));
      }
      // cicadas on clear summer afternoons
      if (now >= A.nextCicada) {
        A.nextCicada = now + rand(50, 130);
        if (A.weather === 'CLEAR' && A.day > 0.8 && A.hour >= 10.5 && A.hour <= 17) AMB.cicada(S, now + 0.1, rand(5, 9), 0.012);
      }
      // rain drips
      if (A.rain > 0.15 && now >= A.nextDrip) {
        A.nextDrip = now + rand(0.04, 0.22) / A.rain;
        tone(S, { type: 'sine', f: rand(1800, 3900), f2: rand(1200, 2000), glide: 0.03, t: now + 0.02, a: 0.001, d: 0.035, g: 0.012 * A.rain, pan: rand(-0.8, 0.8) });
      }
    },

    // ------------------------------------------------------------ generative music
    _updateMusic() {
      const M = this._mus, ac = this.ctx;
      if (!M) return;
      const now = ac.currentTime;
      const audible = this.levels.music > 0.002 && this.levels.master > 0.0001;
      if (!audible) {
        if (M.playing) { M.playing = false; M.queue.length = 0; this._padRelease(now); }
        M.cursor = now + 0.5;
        return;
      }
      M.playing = true;
      if (M.cursor < now - 0.5) { M.queue.length = 0; M.cursor = now + 0.3; } // resumed after a pause
      // mood (with hysteresis) — checked at phrase boundaries
      if (--M.moodCheck <= 0) {
        M.moodCheck = 30;
        const nf = Number(G.sys.weather?.nightFactor ?? G.world?.nightFactor ?? 0) || 0;
        const rainy = (G.sys.weather?.precipitation?.rain || 0) > 0.5;
        const want = nf > 0.55 || rainy ? 'night' : nf < 0.4 ? 'day' : (M.mood || 'day');
        M.wantMood = want;
      }
      while (M.queue.length && M.queue[0].t < now + 0.35) {
        const ev = M.queue.shift();
        if (ev.t < now - 0.05) continue;
        try { this._playEvent(ev); } catch (e) { G.log.debug('AUDIO', 'note failed', e); }
      }
      if (!M.queue.length && M.cursor < now + 1.0) this._queuePhrase(Math.max(M.cursor, now + 0.1));
      // render pending plucks (one per frame)
      if (this._pluckQueue.length) this._pluck(this._pluckQueue.shift());
    },

    _queuePhrase(t0) {
      const M = this._mus;
      if (M.wantMood && M.wantMood !== M.mood && M.phrase % 2 === 0) { M.mood = M.wantMood; M.prev = null; }
      if (!M.mood) M.mood = M.wantMood || 'day';
      this.mood = M.mood;
      const mood = MOODS[M.mood], cells = CELLS[M.mood];
      const e8 = 60 / (mood.bpm * 3); // eighth-note length (dotted-quarter beat)
      const q = M.queue;
      // pad dyad: change every second phrase
      if (M.phrase % 2 === 0) {
        M.dyad = (M.dyad + 1) % mood.dyads.length;
        q.push({ t: t0, kind: 'pad', notes: mood.dyads[M.dyad], dur: e8 * 48 });
      }
      // phrase A (new) or A' (answer: same rhythm, contour shifted, ends on the tonic)
      let notes;
      const answer = M.prev && M.phrase % 2 === 1;
      if (answer) {
        const shift = Math.random() < 0.5 ? 1 : -1;
        notes = M.prev.map((n, i, arr) => ({ ...n, deg: i === arr.length - 1 ? n.deg : clamp(n.deg + shift, mood.range[0], mood.range[1]) }));
        const last = notes[notes.length - 1];
        last.deg = mood.tonic[0]; last.final = true;
      } else {
        notes = [];
        let pos = 0, deg = mood.start[0] + Math.floor(Math.random() * (mood.start[1] - mood.start[0] + 1));
        for (let beat = 0; beat < 7; beat++) {
          const cell = wpick(cells);
          for (const len of cell) {
            if (len < 0) { pos += -len; continue; }
            notes.push({ pos, len, deg });
            const stepv = wpick([[-2, 1], [-1, 3], [0, 0.6], [1, 3], [2, 1], [3, 0.35]]);
            deg = clamp(deg + stepv, mood.range[0], mood.range[1]);
            pos += len;
          }
        }
        notes.push({ pos: 21, len: 3, deg: pick(mood.tonic), final: true });
      }
      M.prev = notes.map((n) => ({ ...n }));
      const vel = mood.vel;
      for (const n of notes) {
        if (Math.random() < mood.rest && !n.final) continue; // breathe
        const t = t0 + n.pos * e8 + rand(-0.012, 0.012);
        const midi = degMidi(mood, n.deg);
        const ev = { t, kind: 'pluck', midi, g: vel * rand(0.8, 1.08) * (n.pos % 3 === 0 ? 1.1 : 0.92), len: n.len * e8 };
        if (n.len >= 3) ev.vib = n.final ? 38 : 26;
        if (n.final && Math.random() < 0.4) { ev.bend = -(Math.random() < 0.5 ? 1 : 2); ev.bendAt = e8 * 1.6; }
        else if (!n.final && n.len >= 2 && Math.random() < 0.18) ev.slide = -1;
        q.push(ev);
        if ((n.final || n.pos === 0) && Math.random() < 0.45) q.push({ t: t + 0.004, kind: 'pluck', midi: midi - 12, g: ev.g * 0.55, len: ev.len });
        if (n.final && mood.flute && Math.random() < mood.flute) q.push({ t: t + e8 * 0.5, kind: 'flute', midi: midi + 12, dur: e8 * 5, g: 0.04 });
      }
      q.sort((a, b) => a.t - b.t);
      M.phrase++;
      // rest between phrase pairs
      const restBars = M.phrase % 2 === 0 ? (Math.random() < (M.mood === 'night' ? 0.6 : 0.35) ? 12 : 6) : 0;
      M.cursor = t0 + (24 + restBars) * e8;
    },

    _playEvent(ev) {
      const ac = this.ctx, S = this._SM;
      if (ev.kind === 'pad') { this._padChord(ev.notes, ev.t, ev.dur); return; }
      if (ev.kind === 'flute') { this._flute(ev.midi, ev.t, ev.dur, ev.g); return; }
      const b = this._pluck(ev.midi);
      if (!b) return;
      const src = ac.createBufferSource();
      src.buffer = b;
      const g = gainNode(ac, ev.g);
      src.connect(g); g.connect(this._nodes.inst);
      const det = src.detune;
      if (det) {
        if (ev.slide) { det.setValueAtTime(ev.slide * 100, ev.t); det.linearRampToValueAtTime(0, ev.t + 0.13); }
        else { det.setValueAtTime(14, ev.t); det.linearRampToValueAtTime(0, ev.t + 0.06); }
        if (ev.bend) { det.setValueAtTime(0, ev.t + ev.bendAt); det.linearRampToValueAtTime(ev.bend * 100, ev.t + ev.bendAt + 0.28); }
        if (ev.vib) { // 농현: slow, wide vibrato that blooms after the attack
          const l = ac.createOscillator(); l.frequency.value = rand(4.2, 5.2);
          const lg = ac.createGain();
          lg.gain.setValueAtTime(0, ev.t); lg.gain.linearRampToValueAtTime(ev.vib, ev.t + 0.55);
          l.connect(lg); lg.connect(det);
          l.start(ev.t + 0.1); l.stop(ev.t + b.duration);
        }
      }
      src.start(ev.t); src.stop(ev.t + b.duration);
      void S;
    },

    _padChord(notes, t, dur) {
      const ac = this.ctx, M = this._mus;
      this._padRelease(t);
      const voices = [];
      for (const m of notes) {
        for (const det of [-7, 6]) {
          const os = ac.createOscillator(); os.type = 'triangle'; os.frequency.value = mtof(m); os.detune.value = det;
          const g = ac.createGain();
          g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(m < 45 ? 0.03 : 0.022, t + 2.8);
          os.connect(g); g.connect(this._nodes.pad);
          os.start(t); os.stop(t + dur + 6);
          voices.push({ os, g });
        }
      }
      M.padVoices = voices;
    },
    _padRelease(t) {
      const M = this._mus;
      if (!M?.padVoices?.length) return;
      for (const v of M.padVoices) {
        try { v.g.gain.cancelScheduledValues(t); v.g.gain.setTargetAtTime(0.0001, t, 1.1); v.os.stop(t + 5); } catch (e) { /* already stopped */ }
      }
      M.padVoices = [];
    },
    _flute(midi, t, dur, g) { // 대금-like breathy answer
      const ac = this.ctx, f = mtof(midi), out = this._nodes.inst;
      const os = ac.createOscillator(); os.type = 'sine'; os.frequency.value = f;
      const l = ac.createOscillator(); l.frequency.value = 4.6;
      const lg = ac.createGain(); lg.gain.setValueAtTime(0, t); lg.gain.linearRampToValueAtTime(f * 0.009, t + dur * 0.6);
      l.connect(lg); lg.connect(os.frequency);
      const h2 = ac.createOscillator(); h2.type = 'sine'; h2.frequency.value = f * 2;
      const g2 = gainNode(ac, 0.18);
      const env = ac.createGain();
      env.gain.setValueAtTime(0.0001, t); env.gain.linearRampToValueAtTime(g, t + 0.45);
      env.gain.setValueAtTime(g, t + dur * 0.7); env.gain.linearRampToValueAtTime(0.0001, t + dur);
      os.connect(env); h2.connect(g2); g2.connect(env);
      const br = ac.createBufferSource(); br.buffer = this._bufs.white; br.loop = true;
      const bf = filter(ac, 'bandpass', f * 2, 2.2);
      const bg = gainNode(ac, 0.14);
      br.connect(bf); bf.connect(bg); bg.connect(env);
      env.connect(out);
      for (const s of [os, l, h2]) { s.start(t); s.stop(t + dur + 0.1); }
      br.start(t, Math.random()); br.stop(t + dur + 0.1);
    },

    // ------------------------------------------------------------ frame
    update(dt) {
      // safety net: release the dialogue duck if a conversation closed without 'dialogue:end'
      if (this._ducks.has('dialogue')) {
        const wall = performance.now();
        if (G.sys.dialogue?.active) this._dlgIdleAt = 0;
        else if (!this._dlgIdleAt) this._dlgIdleAt = wall;
        else if (wall - this._dlgIdleAt > 1500) { this._dlgIdleAt = 0; this.unduck('dialogue'); }
      }
      if (!this.ready || !this.ctx || this.ctx.state !== 'running') return;
      // timed ducks
      if (this._ducks.size) {
        const now = performance.now() / 1000;
        let changed = false;
        for (const [k, d] of this._ducks) if (d.until <= now) { this._ducks.delete(k); changed = true; }
        if (changed) this._applyDuck();
      }
      try { this._updateAmbience(dt); } catch (e) { G.log.debug('AUDIO', 'ambience', e); }
      try { this._updateMusic(); } catch (e) { G.log.debug('AUDIO', 'music', e); }
    },

    onLogout() { this.stopSpeaking(); this._ducks.clear(); this._applyDuck(); },

    // ------------------------------------------------------------ diagnostics (tests / debug panel)
    /**
     * render sfx offline and measure the output: {peak, rms, duration}. names: one name or a list played together
     * (opts.gap seconds apart) — by default through the real bus gains + limiter + soft clip at the current settings;
     * opts.raw skips the mastering stage.
     */
    async analyze(names, opts = {}) {
      const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
      const list = (Array.isArray(names) ? names : [names]).filter((n) => SFX[n]);
      if (!OAC || !list.length) return null;
      const sr = 44100, len = Math.ceil(sr * (opts.seconds || 3));
      const oac = new OAC(2, len, sr);
      const bufs = { white: makeNoise(oac, 'white'), pink: makeNoise(oac, 'pink'), brown: makeNoise(oac, 'brown') };
      let out = oac.destination;
      if (!opts.raw) {
        const lv = (v, d) => { v = clamp(Number(v ?? d), 0, 1); return Number.isFinite(v) ? Math.pow(v, 1.6) : 0; };
        const st = G.settings || {};
        const m = buildMaster(oac, oac.destination);
        const master = gainNode(oac, opts.master ?? lv(st.volumeMaster, 0.8)); master.connect(m.input);
        out = gainNode(oac, (opts.sfx ?? lv(st.volumeSfx, 0.8)) * BASE.sfx); out.connect(master);
      }
      const verb = oac.createConvolver();
      try { verb.buffer = makeImpulse(oac, 2.4); } catch (e) { /* ignore */ }
      verb.connect(out);
      const wet = gainNode(oac, 0.5); wet.connect(verb);
      const plucks = new Map();
      const S = { ac: oac, out, wet: null, buf: bufs, t: 0, pluck: (mi) => { if (!plucks.has(mi)) plucks.set(mi, renderPluck(oac, mi)); return plucks.get(mi); } };
      list.forEach((n, i) => { S.wet = WET[n] ? wet : null; SFX[n](S, 0.01 + i * (opts.gap || 0), opts); });
      const rb = await oac.startRendering();
      let peak = 0, sum = 0, lastLoud = 0;
      for (let c = 0; c < rb.numberOfChannels; c++) {
        const d = rb.getChannelData(c);
        for (let i = 0; i < d.length; i++) { const v = d[i], a = v < 0 ? -v : v; if (a > peak) peak = a; if (c === 0) sum += v * v; if (a > 0.002 && i > lastLoud) lastLoud = i; }
      }
      return { name: list.join('+'), peak: +peak.toFixed(3), peakDb: +(20 * Math.log10(Math.max(peak, 1e-6))).toFixed(1), rms: +Math.sqrt(sum / Math.max(1, lastLoud)).toFixed(4), duration: +(lastLoud / sr).toFixed(2) };
    },
    names() { return Object.keys(SFX); },
    /** live output level (post master, pre limiter): {rms, peak} over the last ~46 ms */
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
      return {
        supported: this.supported, state: this.ctx?.state || 'none', unlocked: this.unlocked, levels: { ...this.levels }, mood: this.mood,
        musicPlaying: !!this._mus?.playing, queued: this._mus?.queue.length || 0, plucks: this._plucks.size, voices: this._voices,
        ambience: this._amb ? { water: +this._amb.water.toFixed(2), rain: this._amb.rain, night: +this._amb.night.toFixed(2), wind: +this._amb.windBase.toFixed(3) } : null,
        duck: this._duckLevel ?? 1, stats: { ...this.stats, byName: { ...this.stats.byName } },
      };
    },
  };

  G.register(audio);
})();
