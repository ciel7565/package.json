// =============================================================================
// 63-gugak.js — 국악 synthesis library (G.gugak, CONTRACT §17.6): instruments, modes, 장단, folk motifs, moods and a
// small composer. Nothing is sampled and nothing comes from the network: every voice is built from oscillators,
// filtered noise and Karplus–Strong strings. The library holds no audio context of its own — it works on ANY
// BaseAudioContext (the live AudioContext of 61-audio.js and the OfflineAudioContext of tests/audio-client.mjs).
//
//   G.gugak.kit(ac, dest, {channels = true}) -> K
//       K = { ac, dest, buf {white, pink, brown}, ch {<instrument>: input node}, live, made, ended }
//       builds the persistent instrument strips (body / formant filters + seat in the stereo field) once per context.
//   G.gugak.INST.<name>(K, t, o) -> end time (s)          one note / stroke from time t
//       strings  gayageum · geomungo        (o: f, dur, vel, vib (cents), vibRate, bend (cents), bendAt (s), slide (cents))
//       winds    daegeum · piri             (o: f, dur, vel, vib, slide, fall, buzz 0..1 (대금의 청 울림))
//       bowed    haegeum · ajaeng           (o: f, dur, vel, vib, from (Hz, portamento))
//       drums    janggu (o.stroke: deong kung deok gi gideok dereoreo tta) · buk (kung ttak hap)
//       metal    jing (long inharmonic tail) · kkwaenggwari (gaen open / ji damped) · pungkyeong (wind bell under eaves)
//       wood     bak (6-slab clapper) · moktak
//   G.gugak.MODES     pyeong 평조 (황 태 중 임 남) · gyemyeon 계면조 (황 협 중 임 무) · menari 메나리조
//                     { name, names, cents, roles {vib: {deg: cents}, bend: {deg: cents}}, finals, center }
//   G.gugak.freq(mode, base, deg) -> Hz                   deg counts scale steps (0 = 황 of the octave of base)
//   G.gugak.JANGDAN   jinyang 진양조 · jungmori 중모리 · jungjung 중중모리 · gutgeori 굿거리 · jajin 자진모리 · semachi 세마치
//                     { name, beats, sub, grid [stroke per 소박], accent [per beat], bpm [min, max], mgrid, cycles }
//   G.gugak.FOLK      arirang (본조 아리랑, 세마치) · jeongseon (정선아리랑 가락에서 따온 동기, 메나리조)
//   G.gugak.MOODS     day · morning · evening · night · room · complex · rain · snow · festival
//   new G.gugak.Composer({rng}) .section(moodId, t0) -> { events [{t, inst, f, dur, vel, ...}], end, info }
//   G.gugak.play(K, ev) -> end time                        schedule one composer event
//   G.gugak.stinger(name, t0) -> events                    short phrases: reward · levelup · festival · quest · welcome
//   G.gugak.rng(seed)                                       deterministic random source (tests)
//
// Kid rules (CONTRACT §12): nothing shrill — the metal voices are low-passed and quiet, the 꽹과리 plays only in the
// festival mood and softly; every voice has a soft attack and a calm release; the composer leaves silences so the
// sounds of nature come through, and changes its mode, 장단 and register over minutes, never looping a short tune.
// Every scheduled source counts itself in K.live / K.made / K.ended and disconnects its chain when it ends.
// =============================================================================
(function () {
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const f2m = (f) => 69 + 12 * Math.log2(f / 440);
  const m2f = (m) => 440 * Math.pow(2, (m - 69) / 12);
  const cr = (c) => Math.pow(2, c / 1200);

  /** mulberry32: a small deterministic random source (tests give a seed; the live system uses Math.random) */
  function rng(seed) {
    if (seed == null) return Math.random;
    let a = (seed >>> 0) || 1;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const R = (r, a, b) => a + r() * (b - a);
  function wpick(r, list) {
    let tot = 0;
    for (const it of list) tot += Math.max(0, it[1]);
    let x = r() * tot;
    for (const it of list) { x -= Math.max(0, it[1]); if (x <= 0) return it[0]; }
    return list[0][0];
  }

  // ================================================================= modes (Pythagorean cents, 삼분손익 tuning)
  const MODES = {
    // 평조: 황 태 중 임 남 — bright, open (솔 라 도 레 미 in movable names). Gentle 농현 on 임 and 황 when long.
    pyeong: { id: 'pyeong', name: '평조', names: ['황', '태', '중', '임', '남'], cents: [0, 204, 498, 702, 906],
      roles: { vib: { 0: 16, 3: 22, 2: 10 }, bend: {} }, finals: [0, 3], center: 5 },
    // 계면조: 황 협 중 임 무 — the sad, sung mode. 임 is the shaking tone (떠는 음, wide 농현), 협 is the bent tone
    // (꺾는 음: sung from above and broken downwards), 황 is the plain, resting tone.
    gyemyeon: { id: 'gyemyeon', name: '계면조', names: ['황', '협', '중', '임', '무'], cents: [0, 294, 498, 702, 996],
      roles: { vib: { 3: 48, 0: 12 }, bend: { 1: -110 } }, finals: [0, 3], center: 5 },
    // 메나리조 (강원 · 경상의 소리, 정선아리랑): 미 솔 라 도 레 — the cadence falls 레 도 라 and rests on 라 or 미.
    menari: { id: 'menari', name: '메나리조', names: ['미', '솔', '라', '도', '레'], cents: [0, 294, 498, 792, 996],
      roles: { vib: { 2: 34, 0: 18 }, bend: { 4: -90 } }, finals: [2, 0], center: 5 },
  };
  /** frequency of scale degree `deg` (any integer) of `mode` above `base` (the 황 of the base octave) */
  function freq(mode, base, deg) {
    const M = typeof mode === 'string' ? MODES[mode] : mode;
    const n = M.cents.length;
    const o = Math.floor(deg / n), i = ((deg % n) + n) % n;
    return base * Math.pow(2, o) * cr(M.cents[i]);
  }

  // ================================================================= noise buffers, curves, the kit
  function noiseBuffer(ac, kind, seconds) {
    const sr = ac.sampleRate, len = Math.max(1, Math.floor(sr * seconds));
    const b = ac.createBuffer(1, len, sr);
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
    // remove the DC of the brown walk and crossfade the loop seam
    if (kind === 'brown') { let m = 0; for (let i = 0; i < len; i++) m += d[i]; m /= len; for (let i = 0; i < len; i++) d[i] -= m; }
    const xf = Math.floor(sr * 0.05);
    for (let i = 0; i < xf; i++) { const k = i / xf; d[i] = d[i] * k + d[len - xf + i] * (1 - k); }
    return b;
  }
  const CURVES = {};
  /** the 청 (reed membrane) of the 대금: an asymmetric soft clip that adds buzzing upper partials when blown hard */
  function buzzCurve() {
    if (CURVES.buzz) return CURVES.buzz;
    const n = 1024, c = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      c[i] = Math.tanh(x * 3.2 + 0.35) - Math.tanh(0.35) + 0.12 * Math.sin(x * 9);
    }
    let m = 0; for (let i = 0; i < n; i++) m = Math.max(m, Math.abs(c[i]));
    for (let i = 0; i < n; i++) c[i] /= m;
    CURVES.buzz = c;
    return c;
  }
  /** harmonic tables (PeriodicWave), cached per context */
  const WAVES = {
    flute: [0, 1, 0.42, 0.19, 0.085, 0.045, 0.02],                        // 대금: round, a little breathy 2nd
    piri: [0, 1, 0.46, 0.62, 0.3, 0.34, 0.15, 0.14, 0.06, 0.05],           // 피리: double reed, odd-rich but capped
    bow: [0, 1, 0.62, 0.45, 0.33, 0.26, 0.2, 0.15, 0.11, 0.08, 0.06, 0.04], // 해금: bowed string (soft saw)
  };
  function wave(K, name) {
    K.waves = K.waves || {};
    if (K.waves[name] !== undefined) return K.waves[name];
    let w = null;
    try {
      const h = WAVES[name];
      const re = new Float32Array(h.length), im = new Float32Array(h);
      w = K.ac.createPeriodicWave(re, im, { disableNormalization: false });
    } catch (e) { w = null; }
    K.waves[name] = w;
    return w;
  }

  function gainNode(ac, v) { const g = ac.createGain(); g.gain.value = v; return g; }
  function biquad(ac, type, f, q, db) {
    const n = ac.createBiquadFilter();
    n.type = type; n.frequency.value = f;
    if (q != null) n.Q.value = q;
    if (db != null) n.gain.value = db;
    return n;
  }
  function panner(ac, p) {
    if (typeof ac.createStereoPanner !== 'function') return null;
    const n = ac.createStereoPanner(); n.pan.value = clamp(p || 0, -1, 1); return n;
  }

  /**
   * the kit of one context: noise buffers + persistent instrument strips. Every strip ends in `dest`.
   * Strips are seated like a small 국악 ensemble (strings left, winds right, drums centre).
   */
  function kit(ac, dest, opts = {}) {
    const K = { ac, dest: dest || ac.destination, sr: ac.sampleRate, ch: {}, live: 0, made: 0, ended: 0, ks: new Map(), ksOrder: [], buf: null };
    K.buf = opts.buf || { white: noiseBuffer(ac, 'white', 2.5), pink: noiseBuffer(ac, 'pink', 2.5), brown: noiseBuffer(ac, 'brown', 2.5) };
    if (opts.channels === false) return K;
    const strip = (name, pan, build) => {
      const input = gainNode(ac, 1);
      let last = input;
      for (const f of build) { last.connect(f); last = f; }
      const p = panner(ac, pan);
      if (p) { last.connect(p); last = p; }
      last.connect(K.dest);
      K.ch[name] = input;
    };
    strip('gayageum', -0.28, [biquad(ac, 'peaking', 240, 1.1, 3.5), biquad(ac, 'peaking', 1900, 1.4, 1.2), biquad(ac, 'lowpass', 4300, 0.6)]);
    strip('geomungo', -0.42, [biquad(ac, 'peaking', 130, 1.0, 4), biquad(ac, 'lowpass', 2200, 0.6)]);
    strip('daegeum', 0.3, [biquad(ac, 'highpass', 120, 0.6), biquad(ac, 'lowpass', 5200, 0.6)]);
    strip('piri', 0.36, [biquad(ac, 'peaking', 1150, 1.6, 4), biquad(ac, 'highshelf', 3000, 0.7, -6), biquad(ac, 'lowpass', 3600, 0.6)]);
    // 해금: two body formants make the nasal, singing colour; the bow's edge is rounded off above 3.4 kHz
    strip('haegeum', 0.2, [biquad(ac, 'peaking', 1050, 2.2, 6), biquad(ac, 'peaking', 2600, 3, 1.5), biquad(ac, 'peaking', 420, 1, -3), biquad(ac, 'lowpass', 3000, 0.7)]);
    strip('ajaeng', -0.12, [biquad(ac, 'peaking', 520, 1.5, 3), biquad(ac, 'lowpass', 1500, 0.6)]);
    strip('janggu', 0.02, [biquad(ac, 'lowpass', 7000, 0.6)]);
    strip('buk', 0.12, [biquad(ac, 'lowpass', 5000, 0.6)]);
    strip('jing', -0.08, [biquad(ac, 'lowpass', 3800, 0.5)]);
    strip('kkwaenggwari', 0.16, [biquad(ac, 'highshelf', 3500, 0.7, -9), biquad(ac, 'lowpass', 4800, 0.6)]);
    strip('bak', 0, [biquad(ac, 'lowpass', 7500, 0.6)]);
    strip('moktak', 0, [biquad(ac, 'lowpass', 6000, 0.6)]);
    strip('pungkyeong', 0, [biquad(ac, 'lowpass', 6500, 0.6)]);
    return K;
  }
  function chOf(K, name, o) { return (o && o.dest) || K.ch[name] || K.dest; }

  /** every scheduled source counts itself and frees its private chain when it has ended */
  function track(K, src, chain) {
    K.live++; K.made++;
    src.onended = () => {
      K.live--; K.ended++;
      if (chain) for (const n of chain) { try { n.disconnect(); } catch (e) { /* gone */ } }
      try { src.disconnect(); } catch (e) { /* gone */ }
    };
  }
  function osc(K, type, f, t, end, chain, w) {
    const o = K.ac.createOscillator();
    if (w) o.setPeriodicWave(w); else o.type = type || 'sine';
    o.frequency.setValueAtTime(f, t);
    o.start(t); o.stop(end);
    track(K, o, chain);
    return o;
  }
  function noiseSrc(K, kind, t, end, chain, rate) {
    const s = K.ac.createBufferSource();
    s.buffer = K.buf[kind || 'white']; s.loop = true;
    if (rate) s.playbackRate.value = rate;
    s.start(t, Math.random() * 1.5); s.stop(end);
    track(K, s, chain);
    return s;
  }
  /** percussive envelope: silence → peak in a → ~1 % after d (exponential) */
  function perc(p, t, peak, a, d) {
    p.setValueAtTime(0.0001, t);
    p.linearRampToValueAtTime(Math.max(0.0001, peak), t + a);
    p.setTargetAtTime(0.0001, t + a, Math.max(0.004, d / 4.6));
  }
  /** a damped sine mode (drum heads, wood, metal): f → f2 over the decay */
  function mode(K, dest, t, f, f2, d, g, a = 0.002) {
    const end = t + a + d + 0.05;
    const env = K.ac.createGain();
    const o = osc(K, 'sine', f, t, end, [env]);
    if (f2 && f2 !== f) o.frequency.exponentialRampToValueAtTime(f2, t + Math.min(d, 0.25));
    perc(env.gain, t, g, a, d);
    o.connect(env); env.connect(dest);
    return end;
  }
  /** a filtered noise burst */
  function burst(K, dest, t, o) {
    const end = t + (o.a ?? 0.002) + o.d + 0.05;
    const f = biquad(K.ac, o.type || 'bandpass', o.f, o.q ?? 1);
    const env = K.ac.createGain();
    const s = noiseSrc(K, o.kind || 'white', t, end, [f, env]);
    perc(env.gain, t, o.g, o.a ?? 0.002, o.d);
    s.connect(f); f.connect(env); env.connect(dest);
    return end;
  }

  // ================================================================= Karplus–Strong strings (one buffer per semitone)
  const KS_SR = 16000;   // the strings are low-passed below 4.3 kHz: 16 kHz keeps the cache small
  const KS_MAX = 72;     // cached buffers per kit (oldest dropped first)
  function ksRender(ac, f, o) {
    const sr = KS_SR;
    const P = sr / f;
    let N = Math.floor(P - 0.5 - 0.15);
    if (N < 2) N = 2;
    const delta = P - N - 0.5;
    const C = (1 - delta) / (1 + delta);
    const t60 = o.t60, rho = Math.pow(10, (-3 * P) / (sr * t60));
    const dur = Math.min(o.maxDur || 4, t60 * 1.05);
    const len = Math.max(64, Math.floor(sr * dur));
    const buffer = ac.createBuffer(1, len, sr);
    const out = buffer.getChannelData(0);
    const line = new Float32Array(N);
    let lp = 0, mean = 0;
    for (let i = 0; i < N; i++) { lp += (Math.random() * 2 - 1 - lp) * o.bright; line[i] = lp; }
    const pk = Math.max(1, Math.floor(N * (o.pick || 0.14)));
    const ex = line.slice();
    for (let i = 0; i < N; i++) { line[i] = ex[i] - (i >= pk ? ex[i - pk] * 0.85 : 0); mean += line[i]; }
    mean /= N;
    for (let i = 0; i < N; i++) line[i] -= mean;
    let idx = 0, prev = 0, apx = 0, apy = 0, peak = 0, dc = 0;
    const loss = o.loss ?? 0.5;
    for (let n = 0; n < len; n++) {
      const x = line[idx];
      const avg = loss * x + (1 - loss) * prev; prev = x;
      const ap = C * avg + apx - C * apy; apx = avg; apy = ap;
      line[idx] = ap * rho;
      idx++; if (idx >= N) idx = 0;
      out[n] = x; dc += x;
      const ax = x < 0 ? -x : x; if (ax > peak) peak = ax;
    }
    dc /= len;
    const fade = Math.floor(sr * 0.08), norm = peak > 0 ? 0.8 / peak : 1;
    for (let n = 0; n < len; n++) { out[n] = (out[n] - dc) * norm; if (n > len - fade) out[n] *= (len - n) / fade; }
    return buffer;
  }
  function ksBuf(K, key, midi, o) {
    const id = key + ':' + midi;
    let b = K.ks.get(id);
    if (b) return b;
    b = ksRender(K.ac, m2f(midi), o);
    K.ks.set(id, b); K.ksOrder.push(id);
    while (K.ksOrder.length > KS_MAX) K.ks.delete(K.ksOrder.shift());
    return b;
  }
  /** pitch helpers for a buffer source tuned by detune (cents) */
  function centsOf(f) { const m = f2m(f), mi = Math.round(m); return { mi, c: (m - mi) * 100 }; }
  function vibrato(K, param, t, rate, depth, delay, rise, end, chain) {
    const lg = K.ac.createGain();
    const l = osc(K, 'sine', rate, t, end, [lg]);
    lg.gain.setValueAtTime(0, t);
    lg.gain.setValueAtTime(0, t + delay);
    lg.gain.linearRampToValueAtTime(depth, t + delay + rise);
    l.connect(lg); lg.connect(param);
    if (chain) chain.push(lg);
    return lg;
  }

  // ================================================================= instruments
  const INST = {
    /** 가야금: silk strings plucked with the fingers; 농현 (vibrato made by pressing the string left of the bridge) */
    gayageum(K, t, o) {
      const ac = K.ac, f = o.f || 293.7, vel = clamp(o.vel ?? 0.6, 0, 1);
      const { mi, c } = centsOf(f);
      const k = clamp((mi - 48) / 36, 0, 1);
      const b = ksBuf(K, 'gy', mi, { t60: lerp(3.3, 1.2, k), bright: lerp(0.4, 0.62, k), pick: 0.13, loss: 0.5 });
      const src = ac.createBufferSource(); src.buffer = b;
      const g = gainNode(ac, 0.0001);
      const len = Math.min(b.duration, Math.max(0.35, (o.dur ?? 1) + (o.ring ?? 1.4)));
      const peak = 0.95 * Math.pow(vel, 1.35);
      g.gain.setValueAtTime(peak, t);
      if (len < b.duration - 0.05) g.gain.setTargetAtTime(0.0001, t + len - 0.22, 0.06);
      const chain = [g];
      const det = src.detune;
      if (det) {
        det.setValueAtTime(c + 9, t); det.linearRampToValueAtTime(c, t + 0.05);  // the string settles after the pluck
        if (o.slide) { det.setValueAtTime(c + o.slide, t); det.linearRampToValueAtTime(c, t + 0.16); }
        if (o.bend) { const ba = t + (o.bendAt ?? Math.min(0.6, (o.dur ?? 1) * 0.6)); det.setValueAtTime(c, ba); det.linearRampToValueAtTime(c + o.bend, ba + 0.24); }
        if (o.vib) vibrato(K, det, t, o.vibRate || 4.8, o.vib, 0.16, 0.5, t + len, chain);
      } else if (c) src.playbackRate.value = cr(c);
      src.connect(g); g.connect(chOf(K, 'gayageum', o));
      src.start(t); src.stop(t + len);
      track(K, src, chain);
      return t + len;
    },
    /** 거문고: thick silk strings struck with the 술대 (bamboo stick) that also knocks the leather 대모 */
    geomungo(K, t, o) {
      const ac = K.ac, f = o.f || 98, vel = clamp(o.vel ?? 0.6, 0, 1);
      const { mi, c } = centsOf(f);
      const b = ksBuf(K, 'gm', mi, { t60: 3.6, bright: 0.3, pick: 0.2, loss: 0.56, maxDur: 3.8 });
      const dest = chOf(K, 'geomungo', o);
      const src = ac.createBufferSource(); src.buffer = b;
      const g = gainNode(ac, 0.0001);
      const len = Math.min(b.duration, Math.max(0.5, (o.dur ?? 1.5) + (o.ring ?? 1.8)));
      g.gain.setValueAtTime(1.05 * Math.pow(vel, 1.3), t);
      if (len < b.duration - 0.05) g.gain.setTargetAtTime(0.0001, t + len - 0.3, 0.08);
      const chain = [g];
      if (src.detune) {
        src.detune.setValueAtTime(c + 14, t); src.detune.linearRampToValueAtTime(c, t + 0.07);
        if (o.slide) { src.detune.setValueAtTime(c + o.slide, t); src.detune.linearRampToValueAtTime(c, t + 0.22); }
        if (o.bend) { const ba = t + (o.bendAt ?? 0.7); src.detune.setValueAtTime(c, ba); src.detune.linearRampToValueAtTime(c + o.bend, ba + 0.3); }
        if (o.vib) vibrato(K, src.detune, t, o.vibRate || 3.9, o.vib, 0.25, 0.7, t + len, chain);
      }
      src.connect(g); g.connect(dest);
      src.start(t); src.stop(t + len);
      track(K, src, chain);
      // the 술대 against the 대모: a dull wooden knock and a short low thump
      burst(K, dest, t, { f: 760, q: 1.4, d: 0.03, g: 0.22 * vel, kind: 'pink' });
      mode(K, dest, t, 92, 58, 0.07, 0.16 * vel);
      return t + len;
    },
    /** 대금: the great transverse bamboo flute — breath, a scoop into the note, late 농음 vibrato, and the 청 buzz */
    daegeum(K, t, o) {
      const ac = K.ac, f = o.f || 587, vel = clamp(o.vel ?? 0.55, 0, 1), dur = Math.max(0.25, o.dur ?? 1.4);
      const rel = 0.28, end = t + dur + rel + 0.05;
      const env = gainNode(ac, 0.0001);
      const chain = [env];
      const tone = osc(K, 'sine', f * cr(-(o.slide ?? 70)), t, end, chain, wave(K, 'flute'));
      tone.frequency.exponentialRampToValueAtTime(f, t + 0.16);
      if (o.fall) { tone.frequency.setValueAtTime(f, t + dur * 0.8); tone.frequency.exponentialRampToValueAtTime(f * cr(o.fall), t + dur + rel * 0.6); }
      if (o.vib !== 0 && dur > 0.6) vibrato(K, tone.frequency, t, o.vibRate || 4.6, f * (cr(o.vib || 22) - 1), dur * 0.35, dur * 0.35, end, chain);
      const peak = 0.34 * Math.pow(vel, 1.2);
      env.gain.setValueAtTime(0.0001, t);
      env.gain.linearRampToValueAtTime(peak * 0.78, t + 0.12);
      env.gain.linearRampToValueAtTime(peak, t + dur * 0.65);             // the breath swells through the note
      env.gain.setValueAtTime(peak, t + dur);
      env.gain.linearRampToValueAtTime(0.0001, t + dur + rel);
      tone.connect(env);
      // breath: noise around the 2nd partial + a short chiff at the onset
      const bf = biquad(ac, 'bandpass', f * 2, 1.4), bg = gainNode(ac, 0.11);
      const br = noiseSrc(K, 'white', t, end, [bf, bg]);
      br.connect(bf); bf.connect(bg); bg.connect(env);
      burst(K, chOf(K, 'daegeum', o), t, { f: 2600, q: 0.8, d: 0.07, g: 0.05 * vel, kind: 'white', a: 0.01 });
      // 청: when blown strongly (or high) the membrane buzzes — a soft clip of the tone, band-limited, rising with the breath
      const buzz = clamp(o.buzz ?? (f > 640 ? 0.55 : 0.25) * vel, 0, 1);
      if (buzz > 0.05) {
        const sh = ac.createWaveShaper(); sh.curve = buzzCurve();
        const pre = gainNode(ac, 1.6), bp = biquad(ac, 'bandpass', 2300, 1.5), bz = gainNode(ac, 0.0001);
        tone.connect(pre); pre.connect(sh); sh.connect(bp); bp.connect(bz); bz.connect(env);
        bz.gain.setValueAtTime(0.0001, t); bz.gain.linearRampToValueAtTime(0.2 * buzz, t + dur * 0.7);
        chain.push(pre, sh, bp, bz);
      }
      env.connect(chOf(K, 'daegeum', o));
      return end;
    },
    /** 피리: the double-reed pipe — a nasal, singing line; kept low-passed and quieter than in a real band */
    piri(K, t, o) {
      const ac = K.ac, f = o.f || 440, vel = clamp(o.vel ?? 0.5, 0, 1), dur = Math.max(0.2, o.dur ?? 1);
      const rel = 0.16, end = t + dur + rel + 0.05;
      const env = gainNode(ac, 0.0001), chain = [env];
      const tone = osc(K, 'sawtooth', f * cr(-(o.slide ?? 90)), t, end, chain, wave(K, 'piri'));
      tone.frequency.exponentialRampToValueAtTime(f, t + 0.1);
      if (dur > 0.5 && o.vib !== 0) vibrato(K, tone.frequency, t, o.vibRate || 5.8, f * (cr(o.vib || 35) - 1), dur * 0.3, dur * 0.3, end, chain);
      const peak = 0.12 * Math.pow(vel, 1.2);
      env.gain.setValueAtTime(0.0001, t);
      env.gain.linearRampToValueAtTime(peak, t + 0.05);
      env.gain.setValueAtTime(peak, t + dur);
      env.gain.linearRampToValueAtTime(0.0001, t + dur + rel);
      tone.connect(env);
      env.connect(chOf(K, 'piri', o));
      return end;
    },
    /** 해금: two silk strings bowed between them — portamento from the previous note, wide vibrato, bow noise */
    haegeum(K, t, o) {
      const ac = K.ac, f = o.f || 440, vel = clamp(o.vel ?? 0.5, 0, 1), dur = Math.max(0.2, o.dur ?? 1);
      const rel = 0.18, end = t + dur + rel + 0.05;
      const env = gainNode(ac, 0.0001), chain = [env];
      const w = wave(K, 'bow');
      const a = osc(K, 'sawtooth', o.from || f, t, end, chain, w);
      const b2 = osc(K, 'sawtooth', o.from || f, t, end, chain, w); b2.detune.value = 5;
      if (o.from && o.from !== f) { a.frequency.exponentialRampToValueAtTime(f, t + 0.13); b2.frequency.exponentialRampToValueAtTime(f, t + 0.13); }
      if (dur > 0.45 && o.vib !== 0) {
        const lg = vibrato(K, a.frequency, t, o.vibRate || 5.4, f * (cr(o.vib || 38) - 1), dur * 0.25, dur * 0.35, end, chain);
        lg.connect(b2.frequency);
      }
      if (o.bend) { const ba = t + (o.bendAt ?? dur * 0.6); for (const s of [a, b2]) { s.frequency.setValueAtTime(f, ba); s.frequency.exponentialRampToValueAtTime(f * cr(o.bend), ba + 0.22); } }
      const mix = gainNode(ac, 0.5); chain.push(mix);
      a.connect(mix); b2.connect(mix); mix.connect(env);
      const peak = 0.16 * Math.pow(vel, 1.2);
      env.gain.setValueAtTime(0.0001, t);
      env.gain.linearRampToValueAtTime(peak * 1.08, t + 0.09);     // the bow bites …
      env.gain.linearRampToValueAtTime(peak * 0.9, t + 0.22);      // … and settles
      env.gain.linearRampToValueAtTime(peak, t + dur * 0.7);
      env.gain.setValueAtTime(peak, t + dur);
      env.gain.linearRampToValueAtTime(0.0001, t + dur + rel);
      const nf = biquad(ac, 'bandpass', Math.min(6000, f * 4), 0.7), ng = gainNode(ac, 0.05);
      const ns = noiseSrc(K, 'pink', t, end, [nf, ng]);
      ns.connect(nf); nf.connect(ng); ng.connect(env);
      env.connect(chOf(K, 'haegeum', o));
      return end;
    },
    /** 아쟁: the low bowed zither — used as a quiet drone under the night and rain moods */
    ajaeng(K, t, o) {
      const ac = K.ac, f = o.f || 110, vel = clamp(o.vel ?? 0.4, 0, 1), dur = Math.max(0.5, o.dur ?? 4);
      const att = Math.min(1.2, dur * 0.3), rel = 1.2, end = t + dur + rel + 0.05;
      const env = gainNode(ac, 0.0001), chain = [env];
      const a = osc(K, 'sawtooth', f, t, end, chain, wave(K, 'bow'));
      const b2 = osc(K, 'sawtooth', f, t, end, chain, wave(K, 'bow')); b2.detune.value = -6;
      const lp = biquad(ac, 'lowpass', 900, 0.7); chain.push(lp);
      a.connect(lp); b2.connect(lp); lp.connect(env);
      const peak = 0.12 * Math.pow(vel, 1.1);
      env.gain.setValueAtTime(0.0001, t);
      env.gain.linearRampToValueAtTime(peak, t + att);
      env.gain.setValueAtTime(peak, t + dur);
      env.gain.linearRampToValueAtTime(0.0001, t + dur + rel);
      env.connect(chOf(K, 'ajaeng', o));
      return end;
    },
    /** 장구: 채편 (right, thin head, struck with the 열채) and 북편 (left, thick head, palm) */
    janggu(K, t, o) {
      const dest = chOf(K, 'janggu', o), vel = clamp(o.vel ?? 0.6, 0, 1), s = o.stroke || 'deong';
      const kung = (tt, v) => { // 북편: a low, round palm stroke
        let e = mode(K, dest, tt, 108, 76, 0.42, 0.62 * v, 0.004);
        e = Math.max(e, mode(K, dest, tt, 180, 150, 0.12, 0.12 * v, 0.003));
        burst(K, dest, tt, { type: 'lowpass', f: 380, q: 0.7, d: 0.045, g: 0.3 * v, kind: 'brown' });
        return e;
      };
      const deok = (tt, v) => { // 채편: the stick's crack, the thin head's pitch and the body ring
        let e = mode(K, dest, tt, 372, 330, 0.15, 0.3 * v);
        e = Math.max(e, mode(K, dest, tt, 640, 610, 0.07, 0.1 * v));
        burst(K, dest, tt, { f: 3300, q: 1.3, d: 0.014, g: 0.3 * v });
        burst(K, dest, tt, { f: 1150, q: 2, d: 0.03, g: 0.13 * v, kind: 'pink' });
        return Math.max(e, mode(K, dest, tt, 205, 200, 0.09, 0.06 * v));
      };
      switch (s) {
        case 'kung': return kung(t, vel);
        case 'deok': return deok(t, vel);
        case 'gi': case 'ki': return deok(t, vel * 0.42);
        case 'gideok': deok(t, vel * 0.4); return deok(t + (o.grace ?? 0.075), vel);
        case 'tta': return burst(K, dest, t, { f: 2800, q: 1.6, d: 0.02, g: 0.26 * vel });
        case 'dereoreo': { // 더러러: a soft roll on the 채편 that dies away
          const span = Math.max(0.18, (o.dur ?? 0.4) * 0.9), n = 6;
          let e = t;
          for (let i = 0; i < n; i++) e = Math.max(e, deok(t + (i / n) * span, vel * (0.55 - i * 0.06)));
          return e;
        }
        default: kung(t, vel); return deok(t + 0.004, vel); // 덩: both heads at once
      }
    },
    /** 북 (소리북): the 고수's drum — 궁 (left palm on the head) and 딱 (stick on the wooden frame) */
    buk(K, t, o) {
      const dest = chOf(K, 'buk', o), vel = clamp(o.vel ?? 0.6, 0, 1), s = o.stroke || 'kung';
      const kung = () => {
        const e = mode(K, dest, t, 80, 56, 0.6, 0.8 * vel, 0.005);
        burst(K, dest, t, { type: 'lowpass', f: 260, q: 0.7, d: 0.07, g: 0.35 * vel, kind: 'brown' });
        return e;
      };
      const ttak = () => {
        burst(K, dest, t, { f: 1800, q: 4, d: 0.03, g: 0.32 * vel });
        mode(K, dest, t, 930, 900, 0.05, 0.16 * vel);
        return mode(K, dest, t, 2150, 2100, 0.03, 0.05 * vel);
      };
      if (s === 'ttak') return ttak();
      if (s === 'hap') { ttak(); return kung(); }
      return kung();
    },
    /** 징: the great gong — soft mallet, inharmonic partials that bloom and beat slowly, a tail of many seconds */
    jing(K, t, o) {
      const ac = K.ac, f0 = o.f || 146, vel = clamp(o.vel ?? 0.5, 0, 1);
      const tail = clamp(o.dur ?? 9, 2, 11);
      const dest = chOf(K, 'jing', o);
      const out = gainNode(ac, 0.42 * Math.pow(vel, 1.2));
      out.connect(dest);
      const P = [[1, 1, 1], [1.992, 0.5, 0.74], [2.71, 0.34, 0.55], [3.31, 0.26, 0.42], [4.07, 0.17, 0.3], [5.42, 0.1, 0.2], [6.83, 0.05, 0.13]];
      let end = t;
      const chain = [];
      P.forEach(([r, amp, dk], i) => {
        const d = tail * dk, e = t + d + 0.1;
        const g = ac.createGain(); chain.push(g);
        const s = osc(K, 'sine', f0 * r, t, e, [g]);
        s.detune.value = (i % 2 ? 3 : -2);
        if (i === 0) s.frequency.exponentialRampToValueAtTime(f0 * 0.994, t + 1.5); // the low hum sags a little
        const att = 0.01 + i * 0.012;                                               // higher partials bloom later
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(amp, t + att);
        g.gain.setTargetAtTime(0.0001, t + att, d / 6.9);
        s.connect(g); g.connect(out);
        if (i < 2) { // a twin mode a fraction of a hertz away: the slow "웅 웅" beating of a big gong
          const g2 = ac.createGain();
          const s2 = osc(K, 'sine', f0 * r + 0.55 + i * 0.3, t, e, [g2]);
          g2.gain.setValueAtTime(0.0001, t); g2.gain.linearRampToValueAtTime(amp * 0.55, t + att + 0.05);
          g2.gain.setTargetAtTime(0.0001, t + att, d / 6.9);
          s2.connect(g2); g2.connect(out);
        }
        end = Math.max(end, e);
      });
      burst(K, out, t, { type: 'lowpass', f: 320, q: 0.7, d: 0.06, g: 0.35, kind: 'brown' });   // the padded mallet
      // free the shared output gain once the tail has gone
      const keep = ac.createConstantSource ? ac.createConstantSource() : null;
      if (keep) { const z = gainNode(ac, 0); keep.connect(z); z.connect(out); keep.start(t); keep.stop(end); track(K, keep, [z, out]); }
      return end;
    },
    /** 꽹과리: the small brass gong — 갠 rings open, 지 is muted by the hand. Quiet and low-passed for small ears */
    kkwaenggwari(K, t, o) {
      const dest = chOf(K, 'kkwaenggwari', o), vel = clamp(o.vel ?? 0.4, 0, 1), f0 = o.f || 600;
      const open = (o.stroke || 'gaen') !== 'ji';
      const d = open ? 0.75 : 0.09;
      let e = t;
      [[1, 1], [1.47, 0.7], [2.09, 0.5], [2.63, 0.34], [3.36, 0.2]].forEach(([r, a], i) => {
        e = Math.max(e, mode(K, dest, t, f0 * r, f0 * r * 0.998, d * (1 - i * 0.12), 0.1 * a * vel, 0.001));
      });
      burst(K, dest, t, { f: 3000, q: 1, d: 0.012, g: 0.08 * vel });
      return e;
    },
    /** 박: six slabs of hard wood clapped together — the signal that starts and ends a piece of court music */
    bak(K, t, o) {
      const dest = chOf(K, 'bak', o), vel = clamp(o.vel ?? 0.6, 0, 1);
      burst(K, dest, t, { f: 2300, q: 1.1, d: 0.025, g: 0.42 * vel });
      burst(K, dest, t + 0.004, { f: 1200, q: 2.5, d: 0.04, g: 0.18 * vel, kind: 'pink' });
      mode(K, dest, t, 830, 815, 0.08, 0.2 * vel);
      mode(K, dest, t, 1470, 1450, 0.05, 0.1 * vel);
      mode(K, dest, t, 2380, 2360, 0.03, 0.05 * vel);
      return mode(K, dest, t, 385, 380, 0.06, 0.12 * vel);
    },
    /** 목탁: the hollow wooden fish — a round "똑" (UI taps of the easy mode use it) */
    moktak(K, t, o) {
      const dest = chOf(K, 'moktak', o), vel = clamp(o.vel ?? 0.6, 0, 1), f = o.f || 640;
      burst(K, dest, t, { f: f * 3, q: 1.5, d: 0.012, g: 0.12 * vel });
      mode(K, dest, t, f * 2.03, f * 2, 0.04, 0.07 * vel);
      return mode(K, dest, t, f, f * 0.97, 0.13, 0.34 * vel, 0.0015);
    },
    /** 풍경: the small bronze wind bell under the eaves, its fish-shaped clapper swinging in the wind */
    pungkyeong(K, t, o) {
      const dest = chOf(K, 'pungkyeong', o), vel = clamp(o.vel ?? 0.4, 0, 1), f = o.f || 1650;
      const d = o.dur ?? 3.2;
      let e = t;
      [[1, 1, 1], [2.57, 0.42, 0.55], [4.38, 0.2, 0.32], [6.1, 0.08, 0.2]].forEach(([r, a, dk]) => {
        e = Math.max(e, mode(K, dest, t, f * r, f * r * 0.999, d * dk, 0.12 * a * vel, 0.0015));
      });
      if (o.double) {
        const t2 = t + (o.double === true ? 0.16 : o.double);
        [[1, 0.6, 1], [2.57, 0.25, 0.5]].forEach(([r, a, dk]) => { e = Math.max(e, mode(K, dest, t2, f * r, f * r, d * dk, 0.12 * a * vel * 0.55, 0.0015)); });
      }
      return e;
    },
  };

  // ================================================================= 장단 (rhythmic cycles)
  // grid: one stroke per 소박 ('' = silence). accent: weight per 박 (beat). bpm: beats per minute (slow … fast).
  // mgrid: melody steps per beat. cycles: how many cycles a phrase takes. buk: the 소리북 version of each stroke.
  const _ = '';
  const JANGDAN = {
    jinyang: { id: 'jinyang', name: '진양조', beats: 24, sub: 1, bpm: [30, 38], mgrid: 3, cycles: 1, group: 6,
      // 4 각 of 6 박: 기 (덩) · 경 (쿵 … 덕) · 결 — the binding 각 with its tense 덕 · 해 — the loosening 각 (쿵)
      grid: ['deong', _, _, _, _, _, 'kung', _, _, 'deok', _, _, 'deong', _, _, 'deok', _, 'gideok', 'kung', _, _, _, _, _],
      accent: [1, 0.4, 0.5, 0.4, 0.5, 0.4, 0.8, 0.4, 0.5, 0.7, 0.4, 0.4, 0.9, 0.4, 0.5, 0.8, 0.5, 0.6, 0.8, 0.4, 0.5, 0.4, 0.5, 0.4] },
    jungmori: { id: 'jungmori', name: '중모리', beats: 12, sub: 1, bpm: [56, 72], mgrid: 2, cycles: 2,
      grid: ['deong', _, 'kung', 'deok', 'kung', _, 'deok', _, 'kung', 'deok', 'kung', _],
      accent: [1, 0.4, 0.6, 0.7, 0.6, 0.4, 0.8, 0.4, 0.9, 0.7, 0.6, 0.4] },
    jungjung: { id: 'jungjung', name: '중중모리', beats: 4, sub: 3, bpm: [62, 78], mgrid: 3, cycles: 4,
      grid: ['deong', _, 'deok', 'kung', 'deok', _, 'kung', _, 'deok', 'kung', 'deok', _],
      accent: [1, 0.7, 0.85, 0.7] },
    gutgeori: { id: 'gutgeori', name: '굿거리', beats: 4, sub: 3, bpm: [58, 72], mgrid: 3, cycles: 4,
      grid: ['deong', _, 'gideok', 'kung', _, 'dereoreo', 'kung', _, 'gideok', 'kung', _, 'dereoreo'],
      accent: [1, 0.7, 0.85, 0.7] },
    jajin: { id: 'jajin', name: '자진모리', beats: 4, sub: 3, bpm: [88, 104], mgrid: 3, cycles: 4,
      grid: ['deong', _, 'kung', _, 'kung', _, 'deok', _, 'kung', _, 'kung', _],
      accent: [1, 0.7, 0.9, 0.7] },
    semachi: { id: 'semachi', name: '세마치', beats: 3, sub: 3, bpm: [64, 80], mgrid: 3, cycles: 4,
      grid: ['deong', _, 'deong', _, 'deok', _, 'kung', 'deok', _],
      accent: [1, 0.7, 0.8] },
  };
  const BUK_OF = { deong: 'hap', kung: 'kung', deok: 'ttak', gideok: 'ttak', gi: '', dereoreo: '', tta: 'ttak' };
  /** seconds of one cycle at a tempo factor (0 … 1 between the slow and the fast end of the 장단's range) */
  function cycleSeconds(J, tempo) { const bpm = lerp(J.bpm[0], J.bpm[1], clamp(tempo, 0, 1)); return (J.beats * 60) / bpm; }

  // ================================================================= folk motifs (public domain)
  // notes: [degree, beats] in the given mode (degree 5 = 황 one octave up, negative = rest). 본조 아리랑 after the usual
  // 계이름 "솔 라솔 라 도 레도레 미 레미레도 라 솔 라 솔라" (평조: 솔 = 황): 4 lines of 4 bars in 세마치 (3 박 a bar).
  const FOLK = {
    arirang: { id: 'arirang', name: '아리랑', mode: 'pyeong', jangdan: 'semachi',
      lines: [
        [[0, 1.5], [1, 0.5], [0, 1], [1, 3], [2, 1.5], [3, 0.5], [2, 1], [3, 3], [4, 1.5], [3, 0.5], [4, 0.5], [2, 0.5], [1, 1.5], [0, 0.5], [1, 1], [0, 3]],
        [[2, 1.5], [3, 0.5], [2, 1], [3, 1.5], [4, 0.5], [3, 1], [2, 1], [1, 1], [0, 1], [1, 3]],
        [[4, 1], [5, 2], [5, 1], [5, 1], [4, 1], [3, 1], [4, 0.5], [3, 0.5], [4, 0.5], [2, 0.5], [1, 1], [0, 3]],
        [[2, 1.5], [3, 0.5], [2, 1], [3, 1.5], [4, 0.5], [3, 1], [2, 1], [1, 1], [0, 1], [2, 1.5], [3, 0.5], [2, 1], [2, 3]],
      ] },
    // 정선아리랑 (강원도의 아라리): slow and free; the cadence falls 레 도 라 (메나리조 degrees 4 3 2) and rests on 라.
    // A motif in its manner (the long rise to 레, the fall to 라, the closing 미) — not a note-for-note transcription.
    jeongseon: { id: 'jeongseon', name: '정선아리랑', mode: 'menari', jangdan: 'jinyang',
      lines: [
        [[2, 3], [3, 1.5], [4, 1.5], [4, 3], [3, 1], [2, 2], [3, 1.5], [2, 1.5], [1, 1], [2, 4]],
        [[4, 2], [5, 1], [4, 1.5], [3, 1.5], [2, 3], [1, 1.5], [2, 1.5], [0, 2], [1, 1], [0, 4]],
      ] },
  };

  // ================================================================= moods (situation → music)
  // Every number is a weight or a level; levels are relative to the music bus.
  const MOODS = {
    day: { label: '낮의 골짜기', modes: [['pyeong', 4], ['menari', 1]], base: { pyeong: 196, menari: 164.8, gyemyeon: 220 },
      jangdan: [['jungjung', 3], ['gutgeori', 2], ['semachi', 2]], tempo: [0.25, 0.6],
      lead: [['gayageum', 4], ['daegeum', 2]], answer: [['daegeum', 3], ['gayageum', 1], ['haegeum', 1]],
      drone: 'geomungo', drum: { inst: 'janggu', level: 0.3, density: 0.75 }, jing: 0.08, bak: 0.15, kkw: 0,
      quote: { arirang: 0.14, jeongseon: 0.04 }, rest: [3, 9], silence: 0.22, level: 0.9, range: [2, 10] },
    morning: { label: '아침', modes: [['pyeong', 1]], base: { pyeong: 196, menari: 164.8 },
      jangdan: [['semachi', 2], ['jungjung', 1]], tempo: [0.1, 0.35],
      lead: [['daegeum', 3], ['gayageum', 2]], answer: [['gayageum', 3], ['haegeum', 1]],
      drone: 'geomungo', drum: { inst: 'janggu', level: 0.2, density: 0.55 }, jing: 0, bak: 0.1, kkw: 0,
      quote: { arirang: 0.1 }, rest: [5, 12], silence: 0.3, level: 0.78, range: [3, 10] },
    evening: { label: '저녁', modes: [['gyemyeon', 3], ['menari', 1]], base: { gyemyeon: 220, menari: 164.8 },
      jangdan: [['jungmori', 3], ['jinyang', 1]], tempo: [0.15, 0.45],
      lead: [['haegeum', 3], ['gayageum', 2]], answer: [['gayageum', 3], ['daegeum', 2]],
      drone: 'geomungo', drum: { inst: 'janggu', level: 0.24, density: 0.6 }, jing: 0.15, bak: 0, kkw: 0,
      quote: { jeongseon: 0.12, arirang: 0.05 }, rest: [4, 10], silence: 0.25, level: 0.82, range: [1, 9] },
    night: { label: '밤', modes: [['gyemyeon', 2], ['menari', 2]], base: { gyemyeon: 196, menari: 146.8 },
      jangdan: [['jinyang', 3], ['jungmori', 1]], tempo: [0, 0.25],
      lead: [['daegeum', 3], ['geomungo', 1]], answer: [['geomungo', 2], ['gayageum', 2]],
      drone: 'ajaeng', drum: { inst: 'buk', level: 0.16, density: 0.4 }, jing: 0.05, bak: 0, kkw: 0,
      quote: { jeongseon: 0.18 }, rest: [8, 18], silence: 0.4, level: 0.62, range: [0, 8] },
    room: { label: '한옥 방 안', modes: [['pyeong', 3], ['gyemyeon', 1]], base: { pyeong: 174.6, gyemyeon: 196 },
      jangdan: [['jinyang', 2], ['jungmori', 1]], tempo: [0, 0.3],
      lead: [['gayageum', 4], ['daegeum', 1]], answer: [['geomungo', 2], ['gayageum', 1]],
      drone: 'geomungo', drum: { inst: 'janggu', level: 0.12, density: 0.35 }, jing: 0, bak: 0.25, kkw: 0,
      quote: { arirang: 0.08 }, rest: [6, 14], silence: 0.3, level: 0.6, range: [2, 9] },
    complex: { label: '만장대 단지', modes: [['pyeong', 3], ['menari', 1]], base: { pyeong: 220, menari: 164.8 },
      jangdan: [['gutgeori', 3], ['jungjung', 2], ['semachi', 1]], tempo: [0.35, 0.7],
      lead: [['gayageum', 3], ['haegeum', 2], ['daegeum', 1]], answer: [['daegeum', 2], ['piri', 1], ['haegeum', 1]],
      drone: 'geomungo', drum: { inst: 'janggu', level: 0.38, density: 0.9 }, jing: 0.2, bak: 0.12, kkw: 0,
      quote: { arirang: 0.12, jeongseon: 0.06 }, rest: [3, 8], silence: 0.15, level: 0.92, range: [2, 10] },
    rain: { label: '비 오는 날', modes: [['gyemyeon', 3], ['pyeong', 1]], base: { gyemyeon: 196, pyeong: 174.6 },
      jangdan: [['jungmori', 2], ['jinyang', 2]], tempo: [0, 0.3],
      lead: [['haegeum', 2], ['daegeum', 2]], answer: [['gayageum', 3], ['geomungo', 1]],
      drone: 'ajaeng', drum: { inst: 'buk', level: 0.12, density: 0.35 }, jing: 0.04, bak: 0, kkw: 0,
      quote: { jeongseon: 0.1 }, rest: [6, 14], silence: 0.35, level: 0.66, range: [1, 8] },
    snow: { label: '눈 오는 날', modes: [['pyeong', 2], ['menari', 1]], base: { pyeong: 196, menari: 164.8 },
      jangdan: [['jinyang', 3], ['semachi', 1]], tempo: [0, 0.2],
      lead: [['gayageum', 3], ['daegeum', 1]], answer: [['gayageum', 2], ['geomungo', 1]],
      drone: 'geomungo', drum: { inst: 'buk', level: 0.08, density: 0.25 }, jing: 0.12, bak: 0, kkw: 0,
      quote: { arirang: 0.06 }, rest: [8, 16], silence: 0.4, level: 0.58, range: [4, 11] },
    festival: { label: '잔치', modes: [['pyeong', 1]], base: { pyeong: 220 },
      jangdan: [['jajin', 3], ['gutgeori', 1]], tempo: [0.3, 0.6],
      lead: [['piri', 2], ['haegeum', 1], ['daegeum', 1]], answer: [['gayageum', 2], ['haegeum', 1]],
      drone: 'geomungo', drum: { inst: 'janggu', level: 0.48, density: 1 }, buk: 0.2, jing: 0.6, bak: 0.3, kkw: 0.5,
      quote: { arirang: 0.25 }, rest: [2, 5], silence: 0.05, level: 0.9, range: [3, 10] },
  };

  // ================================================================= composer
  // A SECTION = a call (the lead voice, the first half of the cycles) and its response (the answer voice, a varied
  // repeat that ends on a final tone), over a 장단 played by the drum, a drone on the cycle starts, and then a breath
  // (a rest; sometimes a long silence for the nature sounds). The section level follows a slow arc over minutes.
  const RHYTHM = { // melody cells in melody steps for one beat (negative = rest, 0 = tie to the previous note)
    3: [[[3], 3], [[2, 1], 3], [[1, 2], 1.6], [[1, 1, 1], 1], [[-3], 0.8], [[2, -1], 1], [[0], 1.2]],
    2: [[[2], 3], [[1, 1], 2.2], [[-2], 0.9], [[0], 1.6], [[1, -1], 0.6]],
  };
  class Composer {
    constructor(opts = {}) {
      this.r = opts.rng || Math.random;
      this.sections = 0;
      this.history = [];
      this.arc = R(this.r, 0, Math.PI * 2);
      this.lastQuote = -99;
      this.prevF = { };
    }
    /** pick the 장단 / mode / base / tempo of the next section of `moodId` (varied, never twice the same signature) */
    plan(moodId, force) {
      const r = this.r, M = MOODS[moodId] || MOODS.day;
      let quote = null;
      if (!force?.noQuote && this.sections - this.lastQuote >= 6) {
        for (const [id, p] of Object.entries(M.quote || {})) if (r() < p) { quote = FOLK[id]; break; }
      }
      const modeId = quote ? quote.mode : (force?.mode || wpick(r, M.modes));
      const jId = quote ? quote.jangdan : (force?.jangdan || wpick(r, M.jangdan));
      const base = (M.base && M.base[modeId]) || 196;
      return { M, moodId, quote, mode: MODES[modeId], J: JANGDAN[jId], base, tempo: R(r, M.tempo[0], M.tempo[1]) };
    }
    section(moodId, t0, force) {
      const r = this.r;
      const P = this.plan(moodId, force);
      const { M, J, mode: MO, base } = P;
      const cyc = cycleSeconds(J, P.tempo), beat = cyc / J.beats, step = beat / J.mgrid;
      let cycles = force?.cycles || J.cycles;
      let quoteSplit = 0;
      if (P.quote) { // the folk tune decides the length: its first half is the call, the second half the response
        const lines = P.quote.lines, h = Math.ceil(lines.length / 2);
        const beatsOf = (ls) => ls.reduce((s, l) => s + l.reduce((a, n) => a + n[1], 0) + 1, 0);
        const callC = Math.ceil(beatsOf(lines.slice(0, h)) / J.beats), respC = Math.ceil(beatsOf(lines.slice(h)) / J.beats);
        quoteSplit = callC; cycles = callC + respC;
      }
      const ev = [];
      const lead = force?.lead || wpick(r, M.lead), answer = force?.answer || wpick(r, M.answer.filter(([n]) => n !== lead).length ? M.answer.filter(([n]) => n !== lead) : M.answer);
      // the slow arc of the music over minutes (0.72 … 1) times a little life per section
      this.arc += R(r, 0.35, 0.8);
      const lvl = M.level * (0.86 + 0.14 * Math.sin(this.arc)) * R(r, 0.94, 1.03);
      const total = cycles * cyc;
      // ---- 박: the start of a section (court-music manner) in some moods
      if (r() < (M.bak || 0)) ev.push({ t: t0, inst: 'bak', vel: 0.45 * lvl, prio: 2 });
      // ---- 징 on the first beat, now and then (long tail)
      if (r() < (M.jing || 0)) ev.push({ t: t0, inst: 'jing', f: base * 0.75, vel: 0.42 * lvl, dur: 9, prio: 2 });
      // ---- drum: the 장단 for every cycle, with a fill in the last one
      const D = M.drum;
      if (D && D.level > 0) {
        for (let c = 0; c < cycles; c++) {
          const last = c === cycles - 1;
          J.grid.forEach((s, i) => {
            if (!s) return;
            const bi = Math.floor(i / J.sub), acc = J.accent[bi] ?? 0.6;
            if (acc < 0.75 && r() > D.density) return;
            let stroke = s;
            if (last && i >= J.grid.length - J.sub && J.sub === 3 && s === 'kung' && r() < 0.5) stroke = 'dereoreo';
            const tt = t0 + c * cyc + i * (beat / J.sub) + R(r, -0.008, 0.008);
            if (D.inst === 'buk') {
              const bs = BUK_OF[stroke];
              if (bs) ev.push({ t: tt, inst: 'buk', stroke: bs, vel: D.level * acc * lvl * R(r, 0.9, 1.05), prio: acc > 0.85 ? 2 : 1 });
            } else {
              ev.push({ t: tt, inst: 'janggu', stroke, vel: D.level * acc * lvl * R(r, 0.88, 1.05), dur: beat / J.sub, prio: acc > 0.85 ? 2 : 1 });
              if (M.buk && (stroke === 'deong' || stroke === 'kung') && acc > 0.8) ev.push({ t: tt, inst: 'buk', stroke: 'kung', vel: M.buk * lvl, prio: 1 });
            }
            if (M.kkw && J.sub === 3) { // 꽹과리 in the festival: 갠 on the strong beats, 지 between, softly
              ev.push({ t: tt, inst: 'kkwaenggwari', stroke: acc > 0.85 ? 'gaen' : 'ji', vel: M.kkw * (acc > 0.85 ? 0.6 : 0.35) * lvl, prio: 1 });
            }
          });
        }
      }
      // ---- drone on the cycle starts (the tonic low, sometimes the fifth)
      const droneDeg = (c) => (c % 2 === 1 && r() < 0.4 ? 3 : 0) - 5;
      for (let c = 0; c < cycles; c++) {
        const tt = t0 + c * cyc;
        if (M.drone === 'ajaeng') ev.push({ t: tt + 0.05, inst: 'ajaeng', f: freq(MO, base, droneDeg(c)), dur: Math.min(cyc * 0.85, 16), vel: 0.5 * lvl, prio: 2 });
        else if (r() < 0.85) ev.push({ t: tt + 0.02, inst: M.drone || 'geomungo', f: freq(MO, base, droneDeg(c)), dur: Math.min(cyc * 0.6, 3), vel: 0.42 * lvl, vib: r() < 0.5 ? 28 : 0, prio: 2 });
        if (J.beats >= 12 && r() < 0.5) { // a second drone stroke mid-cycle in the slow 장단
          const half = J.group ? J.group * 2 : J.beats / 2;
          ev.push({ t: tt + half * beat, inst: 'geomungo', f: freq(MO, base, -5 + (r() < 0.5 ? 3 : 2)), dur: 2.5, vel: 0.3 * lvl, prio: 1 });
        }
      }
      // ---- melody: call and response
      const half = quoteSplit || Math.max(1, Math.floor(cycles / 2));
      let call, resp;
      if (P.quote) {
        const lines = P.quote.lines;
        call = this.fromFolk(lines.slice(0, Math.ceil(lines.length / 2)), step, J.mgrid);
        resp = this.fromFolk(lines.slice(Math.ceil(lines.length / 2)), step, J.mgrid);
        this.lastQuote = this.sections;
      } else {
        let tries = 0, sig;
        do {
          call = this.phrase(P, half * J.beats, false);
          sig = MO.id + J.id + call.slice(0, 6).map((n) => n.deg).join('');
          tries++;
        } while (this.history.includes(sig) && tries < 5);
        this.history.push(sig); if (this.history.length > 8) this.history.shift();
        resp = this.answerOf(P, call, (cycles - half) * J.beats);
      }
      const t1 = t0 + half * cyc;
      this.voiceLine(ev, P, call, lead, t0 + R(r, 0, beat * 0.25), step, lvl, 3);
      this.voiceLine(ev, P, resp, answer, t1 + R(r, 0, beat * 0.2), step, lvl * 0.92, 3);
      // the lead answers the answer with one or two soft notes (추임새 of the instruments)
      if (resp.length > 3 && r() < 0.6) {
        const k = resp[Math.floor(resp.length * 0.6)];
        ev.push(this.noteEvent(P, lead, t1 + k.pos * step + beat * 0.5, k.deg + 5, Math.min(beat * 1.5, 2.2), 0.42 * lvl, 1));
      }
      ev.sort((a, b) => a.t - b.t);
      this.sections++;
      // ---- the breath after the section; now and then a long silence for the birds and the stream
      let rest = R(r, M.rest[0], M.rest[1]);
      if (r() < (M.silence || 0)) rest += R(r, 14, 36);
      const info = { mood: moodId, label: M.label, mode: MO.name, jangdan: J.name, lead, answer, quote: P.quote?.name || null, cycles, seconds: +total.toFixed(1), rest: +rest.toFixed(1), base: +base.toFixed(1), level: +lvl.toFixed(2) };
      return { events: ev, end: t0 + total + rest, musicEnd: t0 + total, info };
    }
    /** a new melodic phrase over `beats` beats: notes {pos (melody steps), len, deg} — rises, peaks late, falls home */
    phrase(P, beats, isAnswer) {
      const r = this.r, J = P.J, MO = P.mode, [lo, hi] = P.M.range, g = J.mgrid;
      const cells = RHYTHM[g] || RHYTHM[3];
      const notes = [];
      const n5 = MO.cents.length;
      let deg = clamp(MO.center + Math.round(R(r, -2, 2)), lo, hi);
      const peakAt = R(r, 0.45, 0.72), amp = R(r, 1.5, 3.5);
      const endBeats = Math.max(1, Math.round(beats * (J.beats >= 12 ? 0.16 : 0.2)));
      // a breath in the middle of the phrase (the call takes its time to "sing")
      const breathAt = Math.floor(beats * R(r, 0.42, 0.58));
      for (let b = 0; b < beats - endBeats; b++) {
        if (b === breathAt && r() < 0.7) continue;
        const cell = wpick(r, cells);
        let pos = b * g;
        for (const len of cell) {
          if (len < 0) { pos += -len; continue; }
          if (len === 0) { if (notes.length) notes[notes.length - 1].len += g; pos += g; continue; }
          const x = b / beats;
          const target = MO.center + amp * Math.sin(Math.PI * Math.min(1, x / peakAt) * 0.5) * (x < peakAt ? 1 : 1 - (x - peakAt) / (1 - peakAt) * 1.4);
          const stepv = wpick(r, [[-2, 0.7], [-1, 3], [0, 0.5], [1, 3], [2, 0.7], [3, 0.25]]);
          deg = clamp(Math.round(deg + stepv + (target - deg) * 0.35), lo, hi);
          notes.push({ pos, len, deg });
          pos += len;
        }
      }
      // the cadence: approach from a step above, rest long on a final tone of the mode
      const fin = MO.finals[Math.floor(r() * MO.finals.length)] + (deg >= MO.center ? n5 : 0);
      const cpos = (beats - endBeats) * g;
      const approach = r() < 0.75;
      if (approach) notes.push({ pos: cpos, len: g, deg: clamp(fin + 1, lo, hi + 1) });
      notes.push({ pos: cpos + (approach ? g : 0), len: Math.max(g, endBeats * g - (approach ? g : 0)), deg: fin, final: true });
      void isAnswer;
      return notes;
    }
    /** the response: the call's rhythm, its contour moved by a step (or mirrored), ending on the other final */
    answerOf(P, call, beats) {
      const r = this.r, MO = P.mode, [lo, hi] = P.M.range, g = P.J.mgrid;
      const span = beats * g;
      const shift = r() < 0.5 ? 1 : -1, mirror = r() < 0.25;
      const pivot = call.length ? call[0].deg : MO.center;
      const out = call.filter((n) => n.pos < span).map((n) => ({ ...n, deg: clamp(mirror ? pivot - (n.deg - pivot) : n.deg + shift, lo, hi) }));
      if (!out.length) return this.phrase(P, beats, true);
      const last = out[out.length - 1];
      const fins = MO.finals;
      const fin = fins[(fins.indexOf(((call[call.length - 1].deg % 5) + 5) % 5) + 1) % fins.length] ?? fins[0];
      last.deg = fin + (last.deg >= MO.center ? 5 : 0); last.final = true;
      last.len = Math.max(last.len, Math.min(span - last.pos, g * 3));
      // thin the answer a little (it breathes more than the call)
      return out.filter((n, i) => n.final || i === 0 || r() > 0.15);
    }
    fromFolk(lines, step, g) {
      const notes = [];
      let pos = 0;
      lines.forEach((line, li) => {
        line.forEach(([deg, beats], i) => {
          const len = beats * g;   // exact (a dotted beat is 1.5 beats), positions may fall between steps
          if (deg >= 0) notes.push({ pos, len, deg: deg + 5, final: i === line.length - 1 });
          pos += len;
        });
        if (li < lines.length - 1) pos += g; // a breath between the lines
      });
      void step;
      return notes;
    }
    noteEvent(P, inst, t, deg, dur, vel, prio) {
      const MO = P.mode;
      const f = freq(MO, P.base, deg);
      const role = ((deg % 5) + 5) % 5;
      const e = { t, inst, f, dur, vel, prio };
      const vib = MO.roles.vib[role];
      if (vib && dur > 0.55) e.vib = vib * (inst === 'gayageum' || inst === 'geomungo' ? 1 : 0.8);
      return e;
    }
    /** turn notes into events of one voice, with the ornaments of the mode: 농현 on the shaking tones, 꺾는 음 on the
     *  bent tone, a scoop into big leaps upwards, portamento for the bowed voice */
    voiceLine(ev, P, notes, inst, t0, step, lvl, prio) {
      const r = this.r, MO = P.mode;
      const reg = inst === 'geomungo' ? -5 : 0;   // 대금 / 피리 in their low, soft register (저취): nothing shrill
      let prevF = null;
      notes.forEach((n, i) => {
        const deg = n.deg + reg;
        const f = freq(MO, P.base, deg);
        const dur = n.len * step;
        const role = ((n.deg % 5) + 5) % 5;
        const accent = (n.pos % (P.J.mgrid * (P.J.sub === 3 ? 1 : 2))) === 0 ? 1.06 : 0.94;
        const e = { t: t0 + n.pos * step + R(r, -0.01, 0.012), inst, f, dur, vel: (n.final ? 0.62 : 0.56) * accent * lvl * R(r, 0.9, 1.06), prio: n.final ? prio : prio - (i % 3 === 2 ? 1 : 0) };
        const vib = MO.roles.vib[role];
        if (vib && (dur > 0.7 || n.final)) e.vib = vib * (n.final ? 1.15 : 1) * (inst === 'haegeum' ? 0.9 : 1);
        else if (dur > 1.2) e.vib = 10;
        const bend = MO.roles.bend[role];
        const next = notes[i + 1];
        if (bend && next && next.deg < n.deg && dur > 0.35) { e.bend = bend; e.bendAt = Math.min(dur * 0.55, 0.9); }
        if (prevF && f / prevF > 1.3 && inst !== 'haegeum') e.slide = -Math.round(R(r, 60, 120));
        if (inst === 'haegeum' && prevF && Math.abs(f / prevF - 1) < 0.5) e.from = prevF;
        if (inst === 'daegeum' && n.final) e.fall = -Math.round(R(r, 40, 90));
        ev.push(e);
        // a long tone on a plucked string is struck again (or touched with a neighbour) so the line keeps singing
        if ((inst === 'gayageum' || inst === 'geomungo') && dur > 2) {
          const k = Math.max(1, Math.floor(dur / 1.8));
          for (let j = 1; j <= k; j++) {
            const neigh = r() < 0.3 && j === k ? freq(MO, P.base, deg + (r() < 0.5 ? 1 : -1)) : f;
            ev.push({ t: e.t + (dur * j) / (k + 1), inst, f: neigh, dur: dur / (k + 1), vel: e.vel * (0.62 - j * 0.05), vib: e.vib, prio: 1 });
          }
        }
        // the gayageum doubles strong tones an octave below now and then (both hands)
        if (inst === 'gayageum' && (n.final || n.pos === 0) && r() < 0.4) ev.push({ t: e.t + 0.004, inst, f: f / 2, dur, vel: e.vel * 0.5, prio: 1 });
        prevF = f;
      });
    }
  }

  // ================================================================= playing events
  function play(K, e) {
    const fn = INST[e.inst];
    if (!fn) return e.t;
    return fn(K, e.t, e);
  }
  /** short traditional phrases for moments (rewards, level ups, festivals) — events from t0 */
  function stinger(name, t0 = 0, opts = {}) {
    const MO = MODES.pyeong, base = opts.base || 220, v = opts.vel ?? 0.7;
    const f = (d) => freq(MO, base, d);
    const ev = [];
    switch (name) {
      case 'reward': // a 가야금 sweep up the 평조 (술대 없이 손가락으로 훑기) + 박
        [5, 6, 7, 8, 9, 10].forEach((d, i) => ev.push({ t: t0 + i * 0.055, inst: 'gayageum', f: f(d), dur: 0.5, vel: v * (0.55 + i * 0.05), ring: 1.0 }));
        ev.push({ t: t0 + 0.36, inst: 'gayageum', f: f(10), dur: 0.9, vel: v * 0.7, vib: 18 });
        ev.push({ t: t0, inst: 'bak', vel: v * 0.45 });
        break;
      case 'levelup': { // 굿거리 one bar on the 장구 under a 가야금 run, a soft 징 to close
        const b = 0.32;
        [['deong', 0], ['gideok', 2], ['kung', 3], ['dereoreo', 5]].forEach(([s, i]) => ev.push({ t: t0 + i * (b / 3) * 1.0, inst: 'janggu', stroke: s, vel: v * 0.6, dur: b / 3 }));
        [5, 7, 8, 9, 10].forEach((d, i) => ev.push({ t: t0 + 0.08 + i * 0.11, inst: 'gayageum', f: f(d), dur: 0.5, vel: v * 0.62 }));
        ev.push({ t: t0 + 0.7, inst: 'gayageum', f: f(10), dur: 1.4, vel: v * 0.7, vib: 22 });
        ev.push({ t: t0 + 0.7, inst: 'gayageum', f: f(5), dur: 1.4, vel: v * 0.45 });
        ev.push({ t: t0 + 0.7, inst: 'jing', f: 146, vel: v * 0.38, dur: 5 });
        break;
      }
      case 'festival': { // 자진모리 two cycles: 장구 + 북 + 꽹과리 softly + 징 + a 피리 line
        const J = JANGDAN.jajin, cyc = cycleSeconds(J, 0.4), sb = cyc / J.grid.length;
        for (let c = 0; c < 2; c++) J.grid.forEach((s, i) => {
          if (!s) return;
          const tt = t0 + c * cyc + i * sb;
          ev.push({ t: tt, inst: 'janggu', stroke: s, vel: v * 0.55, dur: sb });
          ev.push({ t: tt, inst: 'kkwaenggwari', stroke: i % 6 === 0 ? 'gaen' : 'ji', vel: v * 0.3 });
          if (s === 'deong') ev.push({ t: tt, inst: 'buk', stroke: 'kung', vel: v * 0.4 });
        });
        ev.push({ t: t0, inst: 'jing', f: 146, vel: v * 0.42, dur: 6 });
        [[7, 3], [8, 1.5], [7, 1.5], [6, 3], [5, 3]].reduce((tt, [d, n]) => { ev.push({ t: tt, inst: 'piri', f: f(d), dur: n * sb * 0.95, vel: v * 0.5 }); return tt + n * sb; }, t0 + 0.02);
        break;
      }
      case 'quest': // 박 once, then a 가야금 four-note strum and a 대금 answer
        ev.push({ t: t0, inst: 'bak', vel: v * 0.4 });
        [5, 7, 8, 10].forEach((d, i) => ev.push({ t: t0 + 0.12 + i * 0.05, inst: 'gayageum', f: f(d), dur: 0.8, vel: v * 0.58 }));
        ev.push({ t: t0 + 0.42, inst: 'daegeum', f: f(8), dur: 0.9, vel: v * 0.5, vib: 18 });
        break;
      case 'welcome': // entering a place: 거문고 low + 가야금 answer
        ev.push({ t: t0, inst: 'geomungo', f: f(0) / 2, dur: 2, vel: v * 0.5, vib: 24 });
        [5, 8, 7].forEach((d, i) => ev.push({ t: t0 + 0.45 + i * 0.22, inst: 'gayageum', f: f(d), dur: 0.8, vel: v * 0.48 }));
        break;
      default: break;
    }
    return ev;
  }

  G.gugak = {
    version: 1,
    MODES, JANGDAN, FOLK, MOODS, INST, Composer,
    kit, play, stinger, freq, rng, cycleSeconds,
    noiseBuffer, ksRender,
    /** the instrument names a test should render */
    instruments: Object.keys(INST),
  };
})();
