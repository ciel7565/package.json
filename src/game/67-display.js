// =============================================================================
// 67-display.js — the player's graphics and system options (CONTRACT §18.2, lane gfx): G.sys.display
//
// The settings window (68-settings.js) shows the rows; what a row DOES lives here and in the engine. Every option is
// declared through the options registry — this fragment loads earlier, so the defs go to G.settingsQueue — and is also
// applied by this system itself (init, 'settings:changed'), so a page without the registry behaves the same.
// Values are kept in G.settings[<id>] (the device store of 03-state; the registry adds the account).
//
//   그래픽 해상도   resolution   'auto' | 'native' | '1920x1080' …  the size the 3D picture is drawn at (engine.setResolution).
//                               The list comes from the monitor (screen.width × devicePixelRatio) and the common sizes
//                               that fit it; the picture keeps the window's shape. info(): the honest line
//                               "창 1536×864 · 그리는 크기 1920×1080".
//   화면 모드       windowMode   'window' | 'fullscreen'  — the Fullscreen API on the option's own press; a saved wish that
//                               the browser will not grant without a press is offered as a chip in the game
//   출력될 모니터   monitor      'auto' | '1' | '2' …  from window.getScreenDetails() where it exists and is allowed (the
//                               screen for the full-screen view); otherwise "1 모니터", disabled, with the reason
//   화면 밝기       brightness   0 … 100 (50 = unchanged)                         engine.setBrightness
//   이펙트 퀄리티   fxQuality    low | medium | high   particle counts (66-fx) and which weather effects run (engine.setEffects)
//   텍스쳐 퀄리티   texQuality   low | medium | high   anisotropy and a size cap of the photographed maps (no restart)
//   가시거리 퀄리티 viewQuality  low | medium | high   far plane, fog, cull distance of small scenery, forest levels
//   이펙트 가시거리 fxDistance   1 … 10                how far from the character (or the camera) effects are still made (66-fx)
//   수직동기화      frameLimit   'display' | '60' | '30'   a browser always follows the display; this is the frame limit
//   최대 시야 확장  wideView     bool                  field of view 55° → 70° and a longer zoom-out (22-camera)
//   이펙트 투명화   selfFxFade   0 … 5                 the player's own dust, speed lines, trails and sparkles fade (66-fx)
//   DOF             dof          bool                  depth of field while playing (medium / high)
//   + antialias · ao (ambient shadow) · dynRes (dynamic resolution) · grassDensity 0 … 100 · crowdSize few|normal|many
//   스크린샷 포맷   shotFormat   jpg | png | webp, shotQuality 50 … 100           52-photo.js
// (그래픽 퀄리티 = the preset `quality`, shadows, bloom and the frame counter keep their rows of the older pane.)
//
// Public: G.sys.display { get(id), set(id, v), defaults, options(), info(), resolutionList(), toggleFullscreen(why),
//   fullscreen (bool), wide (bool), fxRange() (m), selfAlpha() (0 … 1), shot() → { format, mime, ext, quality },
//   crowdScale, screens() }, events 'display:changed' { id, value }, 'display:fullscreen' { on }.
// Pure helpers for tests (Node-evaluable): G.display { resolutionOptions, defaultResolution, parseResolution, drawSize,
//   VIEW, TEX, FX, fxRange(n), selfAlpha(n), DEFAULTS }.
// Automation (navigator.webdriver): wideView defaults to off unless ?wide=1 (the phase-8 budgets and pictures were
// taken at 55°) — as the mouse look and the clock do; everything else has the same default everywhere.
// =============================================================================
(function () {
  // ------------------------------------------------------------------ pure part (no DOM, no THREE)
  const COMMON = [[3840, 2160], [2560, 1440], [1920, 1080], [1600, 900], [1366, 768], [1280, 720], [960, 540]];
  /** the monitor's own pixels, long side first */
  function screenPixels(scr, dpr) {
    const k = Number(dpr) > 0 && Number.isFinite(Number(dpr)) ? Number(dpr) : 1;
    const w = Math.round((Number(scr && scr.width) || 0) * k), h = Math.round((Number(scr && scr.height) || 0) * k);
    return [Math.max(w, h), Math.min(w, h)];
  }
  /** the choices of 그래픽 해상도 for a monitor: 자동, the monitor's own size (when it is not one of the common ones) and
   *  every common size the monitor can show */
  function resolutionOptions(scr, dpr) {
    const [nw, nh] = screenPixels(scr, dpr);
    const out = [{ v: 'auto', w: 0, h: 0, l: '자동 (품질에 맞춤)' }];
    if (nw < 320 || nh < 200) return out;
    const isCommon = COMMON.some(([w, h]) => w === nw && h === nh);
    if (!isCommon) out.push({ v: 'native', w: nw, h: nh, l: `${nw}×${nh} (모니터 그대로)` });
    for (const [w, h] of COMMON) {
      if (w > nw + 1 || h > nh + 1) continue;
      out.push({ v: `${w}x${h}`, w, h, l: `${w}×${h}${w === 1920 ? ' (Wide)' : ''}${w === nw && h === nh ? ' · 모니터 그대로' : ''}` });
    }
    return out;
  }
  /** the owner's default: 1920×1080 where the monitor allows it, else the monitor's own size; touch devices: 자동 */
  function defaultResolution(list, touch) {
    if (touch) return 'auto';
    const has = (v) => list.some((o) => o.v === v);
    if (has('1920x1080')) return '1920x1080';
    if (has('native')) return 'native';
    return list.length > 1 ? list[1].v : 'auto';
  }
  /** 'auto' → null · 'native' → the monitor · '1280x720' → { w, h } */
  function parseResolution(v, scr, dpr) {
    if (v === 'native') { const [w, h] = screenPixels(scr, dpr); return w >= 320 ? { w, h } : null; }
    const m = /^(\d{3,5})x(\d{3,5})$/.exec(String(v || ''));
    return m ? { w: Number(m[1]), h: Number(m[2]) } : null;
  }
  /** what the engine will draw for a wish in a window (the same rule as engine._pixelRatio): → { w, h, ratio, limit } */
  function drawSize(wish, win, dpr, low) {
    const ww = Math.max(1, win.w), wh = Math.max(1, win.h), native = Number(dpr) > 0 ? Number(dpr) : 1;
    if (!wish) return null;
    const land = ww >= wh, rw = land ? Math.max(wish.w, wish.h) : Math.min(wish.w, wish.h), rh = land ? Math.min(wish.w, wish.h) : Math.max(wish.w, wish.h);
    const top = low ? Math.min(native, 1) : native;
    let pr = Math.min(rw / ww, rh / wh), limit = null;
    if (pr > top + 1e-6) { pr = top; limit = top < native ? 'low' : 'screen'; }
    if (pr < 0.25) { pr = 0.25; limit = 'min'; }
    return { w: Math.floor(ww * pr), h: Math.floor(wh * pr), ratio: pr, limit };
  }
  // 가시거리 퀄리티 → far plane (m), fog factor, cull-distance factor of small scenery, forest level factor
  const VIEW = { low: { far: 800, fog: 1.35, cull: 0.55, veg: 0.6 }, medium: { far: 1300, fog: 1.15, cull: 0.75, veg: 0.8 }, high: { far: 3000, fog: 1, cull: 1, veg: 1 } };
  // 텍스쳐 퀄리티 → anisotropy cap, size cap of the photographed maps (px; 0 = as they are)
  const TEX = { low: { aniso: 1, cap: 256 }, medium: { aniso: 4, cap: 384 }, high: { aniso: 16, cap: 0 } };
  // 이펙트 퀄리티 → particle share (66-fx), the level the weather effects may reach (engine.setEffects)
  const FX = { low: { particles: 0.4, level: 0 }, medium: { particles: 0.7, level: 1 }, high: { particles: 1, level: 2 } };
  /** 이펙트 가시거리 1 … 10 → metres from the character (or the camera, whichever is nearer): 8 m, then × 1.4 a step (9 → 118 m, 10 → 165 m) */
  const fxRange = (n) => { const k = Math.min(10, Math.max(1, Math.round(Number(n) || 9))); return Math.round(8 * Math.pow(1.4, k - 1)); };
  /** 이펙트 투명화(자신) 0 … 5 → how much of the player's own effects is left */
  const SELF_ALPHA = [1, 0.8, 0.6, 0.42, 0.26, 0.1];
  const selfAlpha = (n) => SELF_ALPHA[Math.min(5, Math.max(0, Math.round(Number(n) || 0)))];
  const WIDE_FOV = 70, WIDE_ZOOM = { normal: 30, easy: 16 };
  const DEFAULTS = {
    resolution: 'auto', windowMode: 'window', monitor: 'auto', brightness: 50, fxQuality: 'high', texQuality: 'high', viewQuality: 'high', fxDistance: 9,
    frameLimit: 'display', wideView: true, selfFxFade: 0, dof: false, antialias: true, ao: true, dynRes: true, grassDensity: 100, crowdSize: 'normal',
    shotFormat: 'jpg', shotQuality: 90,
  };
  const CROWD = { few: 0.6, normal: 1, many: 1.5 };
  const SHOT = { jpg: { mime: 'image/jpeg', ext: 'jpg' }, png: { mime: 'image/png', ext: 'png' }, webp: { mime: 'image/webp', ext: 'webp' } };
  G.display = { COMMON, screenPixels, resolutionOptions, defaultResolution, parseResolution, drawSize, VIEW, TEX, FX, fxRange, selfAlpha, SELF_ALPHA, WIDE_FOV, WIDE_ZOOM, DEFAULTS, CROWD, SHOT };
  if (typeof document === 'undefined' || typeof G.register !== 'function') return;   // a Node test stops here

  // ------------------------------------------------------------------ the system
  const E = () => G.sys.engine;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const autoRun = (() => { try { return !!navigator.webdriver; } catch (e) { return false; } })();
  const touch = () => !!G.input?.touchUI;
  const easyOn = () => (G.easy ? !!G.easy.on : G.settings?.easyMode !== false);
  const dpr = () => { const d = Number(window.devicePixelRatio); return d > 0 && Number.isFinite(d) ? d : 1; };
  const low = () => (E()?.preset?.name || 'low') === 'low';
  const hasPost = () => !!E()?.composer;
  const LOW_WHY = '그래픽 퀄리티가 ‘낮음’일 때는 쓸 수 없어요. 낮음은 추가 처리가 없는 가장 가벼운 단계예요.';
  const wideAsked = (() => { try { const v = new URLSearchParams(location.search).get('wide'); return v === '1' ? true : v === '0' ? false : null; } catch (e) { return null; } })();

  const display = {
    name: 'display', order: 4, label: '화면·그래픽 설정',
    defaults: Object.assign({}, DEFAULTS),
    fullscreen: false, wide: false, crowdScale: 1,
    _mon: { supported: typeof window.getScreenDetails === 'function', details: null, state: 'unknown', extended: null },
    _fsWish: false, _fsChip: null, _dofOn: false, _zoomK: -1, _applied: {},

    // ---------------------------------------------------------------- values
    get(id) {
      const v = G.settings ? G.settings[id] : undefined;
      return v === undefined || v === null ? this.defaults[id] : v;
    },
    set(id, v) {
      const S = G.sys.settings;
      if (S && typeof S.set === 'function' && typeof S.has === 'function' && S.has(id)) return S.set(id, v);
      if (typeof G.setSetting === 'function') G.setSetting(id, v); else if (G.settings) G.settings[id] = v;
      return this.get(id);
    },

    // ---------------------------------------------------------------- resolution
    resolutionList() { return resolutionOptions(window.screen || {}, dpr()); },
    /** the honest line under 그래픽 해상도 */
    info() {
      const eng = E();
      if (!eng || !eng.renderer) return '이 기기에서는 3D 화면을 그릴 수 없어요.';
      const R = eng.resolutionInfo, why = { screen: '모니터가 낼 수 있는 만큼', low: '낮음 품질은 창 크기까지', memory: '그래픽 메모리에 맞춰 줄였어요', min: '가장 작은 크기' }[R.limit] || '';
      const dynamic = R.dynamic && R.scale < 0.999 ? '자동 해상도가 잠시 줄였어요' : '';
      const note = [why, dynamic].filter(Boolean).join(' · ');
      return `창 ${R.window[0]}×${R.window[1]} · 그리는 크기 ${R.drawn[0]}×${R.drawn[1]}${note ? ` (${note})` : ''}`;
    },

    // ---------------------------------------------------------------- full screen + monitors
    _fsEl() { return document.fullscreenElement || document.webkitFullscreenElement || null; },
    _fsOn() { return this._fsEl() === document.documentElement; },
    /** the screen the player picked for the full-screen view (a ScreenDetailed) | null */
    _pickedScreen() {
      const d = this._mon.details, v = String(this.get('monitor'));
      if (!d || !Array.isArray(d.screens) && !(d.screens && d.screens.length)) return null;
      const i = Number(v) - 1;
      return Number.isInteger(i) && i >= 0 && i < d.screens.length ? d.screens[i] : null;
    },
    /** go full screen (needs a press: call it from a click / key handler) → 'ok' | 'refused' | 'unsupported' */
    async enterFullscreen() {
      const root = document.documentElement, req = root.requestFullscreen || root.webkitRequestFullscreen;
      if (typeof req !== 'function') return 'unsupported';
      if (this._fsOn()) return 'ok';
      const scr = this._pickedScreen();
      // a request the browser neither grants nor refuses (seen without a press in some builds) counts as refused after 3 s
      const ask = (o) => Promise.race([Promise.resolve(req.call(root, o)), new Promise((res, rej) => setTimeout(() => rej(new Error('fullscreen: no answer')), 3000))]);
      try {
        try { await ask(scr ? { navigationUI: 'hide', screen: scr } : { navigationUI: 'hide' }); }
        catch (e) { if (!scr || this._fsOn()) throw e; await ask({ navigationUI: 'hide' }); }   // the chosen screen was refused: this one
        return 'ok';
      } catch (e) { return this._fsOn() ? 'ok' : 'refused'; }
    },
    exitFullscreen() {
      if (!this._fsOn()) return;
      try { const p = (document.exitFullscreen || document.webkitExitFullscreen).call(document); if (p && p.catch) p.catch(() => {}); } catch (e) { /* already out */ }
    },
    /** the key (F by default) and the chip: switch, and remember the wish */
    toggleFullscreen(why) {
      const on = !this._fsOn(), v = on ? 'fullscreen' : 'window';
      // (this call is the press the browser asks for: the option's apply — or, when the wish already stands, we — act now)
      if (this.get('windowMode') !== v) this.set('windowMode', v); else this._applyWindowMode(v);
      return on;
    },
    _applyWindowMode(v) {
      if (v === 'fullscreen') {
        if (this._fsOn()) { this._fsWish = false; this._chipSync(); return; }
        if (this._fsBusy) return;   // one request at a time (the registry and our own listener may both apply a change)
        this._fsBusy = true;
        this.enterFullscreen().then((r) => {
          this._fsBusy = false;
          this._fsWish = r !== 'ok' && r !== 'unsupported' && this.get('windowMode') === 'fullscreen';
          if (r === 'unsupported' && !this._fsToldNo) { this._fsToldNo = true; G.ui?.toast?.('이 브라우저는 전체 화면을 지원하지 않아요.', { type: 'info' }); }
          this._chipSync();
        });
      } else { this._fsWish = false; this.exitFullscreen(); this._chipSync(); }
    },
    _onFsChange() {
      const on = this._fsOn();
      if (on === this.fullscreen) return;
      this.fullscreen = on;
      // in full screen the browser lets a page keep keys it otherwise takes: Ctrl + W / T / N no longer close or open tabs
      try { const kb = navigator.keyboard; if (kb && typeof kb.lock === 'function') { if (on) { const p = kb.lock(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyT', 'KeyN']); if (p && p.catch) p.catch(() => {}); } else kb.unlock(); } } catch (e) { /* not supported */ }
      // left with Esc while the wish stands: offer the way back as a chip (✕ on it = window mode)
      this._fsWish = !on && this.get('windowMode') === 'fullscreen';
      this._chipSync();
      G.bus.emit('display:fullscreen', { on });
    },
    /** the chip "🖥️ 전체 화면으로 보기": only in a running game, while the saved wish could not be granted without a press */
    _chipSync() {
      const want = this._fsWish && !!G.state && !G.ui?.isBlocking?.() && !document.body.classList.contains('hud-hidden') && !this._fsOn();
      let c = this._fsChip;
      if (!want) { if (c && !c.hidden) c.hidden = true; return; }
      const easy = easyOn();
      if (!c) {
        c = document.createElement('div');
        c.id = 'display-fs-chip';
        Object.assign(c.style, { position: 'fixed', right: '12px', bottom: '150px', display: 'flex', gap: '6px', alignItems: 'stretch', zIndex: '40' });
        const go = document.createElement('button');
        go.type = 'button'; go.className = 'dfs-go'; go.textContent = '🖥️ 전체 화면으로 보기';
        go.dataset.say = '여기를 누르면 화면을 크게 채워서 보여 줘요.'; go.title = go.dataset.say;
        go.addEventListener('click', () => { this.enterFullscreen().then((r) => { if (r === 'ok') { this._fsWish = false; this._chipSync(); } }); });
        const no = document.createElement('button');
        no.type = 'button'; no.className = 'dfs-no'; no.textContent = '✕';
        no.setAttribute('aria-label', '창 모드로 두기'); no.title = '창 모드로 두기'; no.dataset.say = '지금처럼 창으로 볼게요.';
        no.addEventListener('click', () => this.set('windowMode', 'window'));
        for (const b of [go, no]) Object.assign(b.style, { border: '0', borderRadius: '999px', background: 'rgba(32,24,16,0.78)', color: '#fff8e6', cursor: 'pointer' });
        c.append(go, no);
        document.body.appendChild(c);
        this._fsChip = c;
      }
      c.hidden = false;
      if (c._easy !== easy) {
        c._easy = easy;
        for (const b of c.children) Object.assign(b.style, { minHeight: easy ? '56px' : '36px', minWidth: easy ? '56px' : '36px', padding: easy ? '0 20px' : '0 14px', font: `600 ${easy ? 18 : 13}px/1.3 system-ui, sans-serif` });
      }
    },
    /** the monitors as far as the browser tells: → { supported, state: 'single' | 'ready' | 'ask' | 'denied' | 'unsupported', list } */
    screens() {
      const M = this._mon;
      const list = M.details && M.details.screens ? Array.from(M.details.screens).map((s, i) => ({ i: i + 1, w: s.width, h: s.height, primary: !!s.isPrimary, current: s === M.details.currentScreen, label: String(s.label || '').slice(0, 24) })) : [];
      let ext = null;
      try { ext = typeof window.screen.isExtended === 'boolean' ? window.screen.isExtended : null; } catch (e) { ext = null; }
      M.extended = ext;
      const state = !M.supported ? 'unsupported' : list.length > 1 ? 'ready' : (list.length === 1 || ext === false) ? 'single' : M.state === 'denied' ? 'denied' : 'ask';
      return { supported: M.supported, state, list };
    },
    _monitorWhy() {
      const s = this.screens().state;
      return s === 'ready' ? true
        : s === 'single' ? '모니터가 하나라서 고를 것이 없어요.'
        : s === 'unsupported' ? '이 브라우저는 모니터를 골라 주는 기능이 없어요. 창을 원하는 모니터로 옮긴 뒤 전체 화면을 켜 주세요.'
        : s === 'denied' ? '모니터 정보를 보는 것을 허락하지 않았어요. 브라우저 주소창의 사이트 설정에서 허락하면 고를 수 있어요.'
        : '아래 ‘모니터 찾기’를 누르고 허락하면 고를 수 있어요.';
    },
    _monitorOptions() {
      const s = this.screens();
      if (s.state !== 'ready') return [{ v: 'auto', l: '1 모니터' }];
      return [{ v: 'auto', l: '지금 창이 있는 모니터' }].concat(s.list.map((m) => ({ v: String(m.i), l: `${m.i} 모니터 · ${m.w}×${m.h}${m.primary ? ' (주 모니터)' : ''}` })));
    },
    /** ask the browser for the monitors (a permission question: call it from a press) → the state */
    async findScreens() {
      const M = this._mon;
      if (!M.supported) return 'unsupported';
      try {
        const d = await window.getScreenDetails();
        M.details = d; M.state = 'granted';
        if (!M.bound && d && d.addEventListener) { M.bound = true; d.addEventListener('screenschange', () => this._defineMonitor()); }
      } catch (e) { M.state = 'denied'; }
      this._defineMonitor();
      return this.screens().state;
    },
    _defineMonitor() {
      const def = this._defs && this._defs.monitor;
      if (!def) return;
      def.options = this._monitorOptions();
      if (G.settingsEnums && G.settingsEnums.monitor) G.settingsEnums.monitor = def.options.map((o) => o.v);   // (03-state checks a stored choice against the list)
      this._push(def);
    },

    // ---------------------------------------------------------------- applying
    /** one option → the engine / the modules. Safe to call again with the same value. */
    apply(id, v) {
      const eng = E();
      if (v === undefined) v = this.get(id);
      this._applied[id] = v;
      switch (id) {
        case 'resolution': eng?.setResolution?.(parseResolution(v, window.screen || {}, dpr())); break;
        case 'windowMode': this._applyWindowMode(v === 'fullscreen' ? 'fullscreen' : 'window'); break;
        case 'monitor': break;   // read when the full-screen view is asked for
        case 'brightness': eng?.setBrightness?.(Number(v)); break;
        case 'fxQuality': { const q = FX[v] || FX.high; eng?.setEffects?.(q.level); try { G.fx?.setQuality?.(q.particles); } catch (e) { /* fx optional */ } break; }
        case 'texQuality': eng?.setTextureQuality?.(TEX[v] || TEX.high); break;
        case 'viewQuality': case 'wideView': case 'grassDensity': this._applyView(); break;
        case 'fxDistance': try { G.fx?.setRange?.(fxRange(v)); } catch (e) { /* fx optional */ } break;
        case 'frameLimit': eng?.setFrameLimit?.(v === 'display' || !Number(v) ? 0 : Number(v)); break;
        case 'selfFxFade': try { G.fx?.setSelfAlpha?.(selfAlpha(v)); } catch (e) { /* fx optional */ } break;
        case 'dof': if (!v && this._dofOn) { this._dofOn = false; if (!G.sys.photo?.active) eng?.dof?.(null); } break;
        case 'antialias': eng?.setOption?.('aa', v !== false); break;
        case 'ao': eng?.setOption?.('ao', v !== false); break;
        case 'dynRes': eng?.setOption?.('drs', v !== false); break;
        case 'crowdSize': this.crowdScale = CROWD[v] || 1; this._crowdHook(); break;
        default: break;   // shotFormat / shotQuality are read when a picture is taken
      }
      G.bus.emit('display:changed', { id, value: v });
    },
    _wideNow() { const v = this.get('wideView'); return v === true; },
    _applyView() {
      const eng = E(), V = VIEW[this.get('viewQuality')] || VIEW.high;
      this.wide = this._wideNow();
      const g = clamp(Number(this.get('grassDensity')), 0, 100);
      // a wider view shows more of the horizon: the far plane of the shorter view distances reaches a little further
      this._viewBase = { far: this.wide && V.far < 3000 ? Math.round(V.far * 1.12) : V.far, fog: V.fog, cull: V.cull, veg: V.veg, grass: (Number.isFinite(g) ? g : 100) / 100 };
      this._zoomK = -1;
      eng?.setView?.(this._viewBase);
    },
    applyAll() { for (const id of Object.keys(this.defaults)) { try { this.apply(id); } catch (e) { G.log.warn('ENGINE', `display option ${id} failed`, e?.message || e); } } },
    /** 주변 사람 수: 60-social draws visitors past a distance as light far figures; that distance follows the option */
    _crowdHook() {
      const S = G.sys.social;
      if (!S || S.crowdAware || typeof S._farDist !== 'function' || S._farDist._display) return;
      const orig = S._farDist.bind(S), self = this;
      const wrapped = function () { const d = Number(orig()); return Number.isFinite(d) ? d * (self.crowdScale || 1) : d; };
      wrapped._display = true;
      try { S._farDist = wrapped; } catch (e) { /* frozen: the option then only informs */ }
    },
    /** what a picture is saved as: { format, mime, ext, quality 0.5 … 1 } (WebP falls back to JPG where a browser cannot write it) */
    shot() {
      let f = String(this.get('shotFormat'));
      if (!SHOT[f]) f = 'jpg';
      if (f === 'webp' && this._webp === undefined) { try { this._webp = document.createElement('canvas').toDataURL('image/webp').indexOf('data:image/webp') === 0; } catch (e) { this._webp = false; } }
      if (f === 'webp' && this._webp === false) f = 'jpg';
      const q = clamp(Number(this.get('shotQuality')) || 90, 50, 100) / 100;
      return { format: f, mime: SHOT[f].mime, ext: SHOT[f].ext, quality: f === 'png' ? 1 : q };
    },
    fxRange() { return fxRange(this.get('fxDistance')); },
    selfAlpha() { return selfAlpha(this.get('selfFxFade')); },

    // ---------------------------------------------------------------- the rows of the settings window
    _push(def) { (G.settingsQueue = G.settingsQueue || []).push(def); },
    options() { return this._defs ? Object.values(this._defs) : []; },
    _declare() {
      const self = this, D = this.defaults;
      const Q3 = (lo, mid, hi) => [{ v: 'low', l: '낮음', hint: lo }, { v: 'medium', l: '보통', hint: mid }, { v: 'high', l: '높음', hint: hi }];
      const row = (id, d) => Object.assign({ id, key: id, scope: 'device', default: D[id], apply: (v) => self.apply(id, v) }, d);
      const postOnly = () => (hasPost() ? true : LOW_WHY);
      const res = this.resolutionList();
      D.resolution = defaultResolution(res, touch());
      D.fxQuality = 'high';
      D.wideView = wideAsked != null ? wideAsked : !autoRun;
      const defs = {
        // ---- 화면
        resolution: row('resolution', { tab: 'display', group: '화면', type: 'select', label: '그래픽 해상도', order: 10, options: res.map((o) => ({ v: o.v, l: o.l })), words: '해상도 resolution 1920 1080 wide 크기 픽셀',
          hint: '3D 그림을 그리는 크기예요. 작게 고르면 빨라지고, 크게 고르면 또렷해져요. 창의 모양에 맞춰서 그려요.' }),
        resolutionInfo: { id: 'resolutionInfo', tab: 'display', group: '화면', type: 'info', label: '지금 그리는 크기', order: 11, hint: '창의 크기와 실제로 그리는 크기예요.', fmt: () => self.info(), value: () => self.info(),
          render(ctl) { const t = self.info(); try { const el = ctl && (ctl.value || ctl.el || ctl.body || ctl); if (el && typeof el === 'object' && 'textContent' in el) el.textContent = t; } catch (e) { /* the window draws fmt() */ } return t; } },
        windowMode: row('windowMode', { tab: 'display', group: '화면', type: 'select', label: '화면 모드', order: 12, options: [{ v: 'window', l: '창 모드', e: '🪟' }, { v: 'fullscreen', l: '전체 화면', e: '🖥️' }], words: '전체화면 창모드 fullscreen window F',
          hint: '전체 화면은 누른 그때 바로 켜져요. 다음에 들어오면 브라우저가 한 번 더 눌러 달라고 해서, 화면에 ‘전체 화면으로 보기’ 단추가 나와요.',
          available: () => (typeof (document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen) === 'function' ? true : '이 브라우저는 전체 화면을 지원하지 않아요.') }),
        monitor: row('monitor', { tab: 'display', group: '화면', type: 'select', label: '출력될 모니터', order: 13, options: this._monitorOptions(), words: '모니터 monitor 듀얼 screen',
          hint: '모니터가 여러 대일 때, 전체 화면을 어느 모니터에 띄울지 골라요. 창 모드에서는 창을 직접 옮겨 주세요.', available: () => self._monitorWhy() }),
        monitorFind: { id: 'monitorFind', tab: 'display', group: '화면', type: 'action', label: '모니터 찾기', order: 14, hint: '브라우저가 모니터 정보를 봐도 되는지 물어요. 허락하면 위에서 모니터를 고를 수 있어요.',
          available: () => (self._mon.supported ? (self.screens().state === 'single' ? '모니터가 하나예요.' : true) : '이 브라우저에는 이 기능이 없어요.'),
          run: () => self.findScreens().then((s) => { G.ui?.toast?.(s === 'ready' ? '모니터를 찾았어요. 위에서 골라 주세요.' : s === 'single' ? '모니터가 하나예요.' : '모니터 정보를 받지 못했어요.', { type: 'info' }); }) },
        brightness: row('brightness', { tab: 'display', group: '화면', type: 'slider', label: '화면 밝기', order: 15, min: 0, max: 100, step: 5, unit: '', words: '밝기 brightness 감마 gamma 어둡 밝',
          hint: '50이 원래 밝기예요. 가장 어두운 곳과 가장 밝은 곳은 그대로 두고 가운데 밝기를 바꿔요. 빠르기는 그대로예요.' }),
        frameLimit: row('frameLimit', { tab: 'display', group: '화면', type: 'select', label: '수직동기화 · 프레임 제한', order: 16, options: [{ v: 'display', l: '미선택 · 화면에 맞춤' }, { v: '60', l: '초당 60장' }, { v: '30', l: '초당 30장' }], words: '수직동기화 vsync 프레임 fps 제한 60 30',
          hint: '브라우저는 언제나 모니터에 맞춰서 그려요(수직동기화는 끌 수 없어요). 여기서는 1초에 그리는 장면 수의 위쪽 끝만 골라요. 30장은 기기가 덜 뜨거워져요.' }),
        shotFormat: row('shotFormat', { tab: 'display', group: '사진', type: 'select', label: '스크린샷 포맷', order: 30, scope: 'account', options: [{ v: 'jpg', l: 'JPG' }, { v: 'png', l: 'PNG' }, { v: 'webp', l: 'WebP' }], words: '스크린샷 사진 저장 jpg png webp 포맷 형식',
          hint: 'JPG는 파일이 작아요. PNG는 가장 또렷하지만 커요. WebP는 작고 또렷해요(못 쓰는 브라우저에서는 JPG로 저장해요).' }),
        shotQuality: row('shotQuality', { tab: 'display', group: '사진', type: 'slider', label: '스크린샷 화질', order: 31, scope: 'account', min: 50, max: 100, step: 5, unit: '%', words: '스크린샷 화질 품질 quality',
          hint: 'JPG · WebP 사진의 화질이에요. 높을수록 또렷하고 파일이 커져요. PNG는 언제나 가장 또렷해요.', available: () => (self.shot().format === 'png' ? 'PNG는 화질을 고르지 않아요.' : true) }),
        // ---- 그래픽
        fxQuality: row('fxQuality', { tab: 'graphics', group: '품질', type: 'select', label: '이펙트 퀄리티', order: 20, options: Q3('반짝이·먼지가 적고 날씨 효과가 줄어요 (가장 빨라요)', '조금 줄여요', '모두 보여요'), words: '이펙트 효과 파티클 particle effect',
          hint: '반짝이·먼지·꽃잎 같은 입자의 수와, 물안개·연기·물무늬 같은 날씨 효과를 얼마나 그릴지예요. 낮출수록 빨라져요.' }),
        texQuality: row('texQuality', { tab: 'graphics', group: '품질', type: 'select', label: '텍스쳐 퀄리티', order: 21, options: Q3('사진 재질을 작게 써요 (그래픽 메모리 절약)', '중간 크기로 써요', '원래 크기로 또렷하게'), words: '텍스쳐 texture 재질 질감 anisotropy',
          hint: '땅·나무·기와의 사진 재질을 얼마나 또렷하게 쓸지예요. 낮추면 그래픽 메모리를 덜 써요. 바로 바뀌어요(다시 시작하지 않아도 돼요).',
          available: () => (low() ? '그래픽 퀄리티가 ‘낮음’일 때는 사진 재질을 쓰지 않아서 바뀌는 것이 없어요.' : true) }),
        viewQuality: row('viewQuality', { tab: 'graphics', group: '품질', type: 'select', label: '가시거리 퀄리티', order: 22, options: Q3('가까운 곳만 그리고 먼 산은 안개에 묻혀요 (빨라요)', '조금 가까이까지 그려요', '멀리까지 그려요'), words: '가시거리 시야 거리 view distance far 안개',
          hint: '얼마나 먼 곳까지 그릴지예요. 낮추면 먼 산과 숲, 작은 물건을 덜 그려서 빨라지고, 안개가 조금 짙어져요.' }),
        fxDistance: row('fxDistance', { tab: 'graphics', group: '품질', type: 'steps', label: '이펙트 가시거리', order: 23, min: 1, max: 10, step: 1, words: '이펙트 가시거리 효과 거리',
          hint: '내 캐릭터에서 얼마나 먼 곳까지 반짝이·먼지 같은 효과를 만들지예요 (1 = 8 m, 9 = 118 m, 10 = 165 m). 낮추면 먼 곳의 효과를 건너뛰어 빨라져요. 내 둘레의 효과는 언제나 보여요.', fmt: (v) => `${v}단계 · ${fxRange(v)} m` }),
        wideView: row('wideView', { tab: 'graphics', group: '보기', type: 'toggle', label: '최대 시야 확장', order: 24, words: '시야 fov 넓게 광각 확대 축소 zoom',
          hint: `화면에 더 넓은 풍경이 들어오고(시야각 55° → ${WIDE_FOV}°), 마우스 휠로 더 멀리 물러날 수 있어요. 한 번에 더 많이 그려서 조금 느려질 수 있어요.` }),
        selfFxFade: row('selfFxFade', { tab: 'graphics', group: '보기', type: 'steps', label: '이펙트 투명화(자신)', order: 25, min: 0, max: 5, step: 1, scope: 'account', words: '투명 이펙트 자신 내 효과',
          hint: '내 캐릭터의 발 먼지·달리기 선·잔상·반짝이를 얼마나 옅게 할지예요. 0은 그대로, 5는 거의 보이지 않아요.', fmt: (v) => `${v}단계` }),
        dof: row('dof', { tab: 'graphics', group: '보기', type: 'toggle', label: 'DOF (먼 곳 흐리게)', order: 26, words: 'dof 심도 흐림 blur 아웃포커스',
          hint: '사진기처럼 먼 배경을 부드럽게 흐려요. 화면 전체를 한 번 더 처리해서 조금 느려져요.', available: postOnly }),
        antialias: row('antialias', { tab: 'graphics', group: '세부', type: 'toggle', label: '계단 현상 줄이기 (안티에일리어싱)', order: 40, words: 'aa msaa 안티 계단',
          hint: '비스듬한 선의 계단 모양을 매끄럽게 해요. 끄면 그래픽 메모리를 덜 쓰고 조금 빨라져요.', available: postOnly }),
        ao: row('ao', { tab: 'graphics', group: '세부', type: 'toggle', label: '구석 그림자 (앰비언트 섀도)', order: 41, words: 'ao ssao 앰비언트 그림자 구석',
          hint: '처마 밑·벽 모서리·물건 아래가 살짝 어두워져서 입체감이 살아요. 화면 전체를 한 번 더 처리해요.',
          available: () => (E()?.preset?.ao ? true : '그래픽 퀄리티가 ‘높음’일 때만 켤 수 있어요.') }),
        dynRes: row('dynRes', { tab: 'graphics', group: '세부', type: 'toggle', label: '자동 해상도', order: 42, words: '동적 해상도 dynamic resolution 자동',
          hint: '화면이 느려지면 그리는 크기를 잠시 줄였다가, 여유가 생기면 되돌려요. 끄면 고른 크기로만 그려요.', available: postOnly }),
        grassDensity: row('grassDensity', { tab: 'graphics', group: '세부', type: 'slider', label: '풀 밀도', order: 43, min: 0, max: 100, step: 10, unit: '%', words: '풀 잔디 grass 밀도',
          hint: '땅에 난 풀을 얼마나 촘촘하게 그릴지예요. 줄이면 빨라져요.', available: () => (low() ? '그래픽 퀄리티가 ‘낮음’일 때는 풀을 그리지 않아요.' : true) }),
        crowdSize: row('crowdSize', { tab: 'graphics', group: '세부', type: 'select', label: '주변 사람 수', order: 44, options: [{ v: 'few', l: '적게' }, { v: 'normal', l: '보통' }, { v: 'many', l: '많이' }], words: '사람 군중 crowd 방문객',
          hint: '가까이 있는 다른 사람을 몇 걸음 밖까지 자세히 그릴지예요. 그보다 먼 사람은 가벼운 모습으로 그려요. ‘적게’가 가장 빨라요.' }),
      };
      this._defs = defs;
      for (const d of Object.values(defs)) this._push(d);
    },

    // ---------------------------------------------------------------- lifecycle
    init() {
      this._declare();
      // without the registry (or when someone writes the key directly) the option still applies
      G.bus.on('settings:changed', ({ key } = {}) => {
        if (key === 'easyMode') this._chipSync();
        if (typeof key !== 'string' || !(key in this.defaults)) return;
        const S = G.sys.settings;
        if (S && typeof S.has === 'function' && S.has(key) && S.initialized) return;   // the registry calls the row's apply itself
        this.apply(key);
      });
      // what an option may do depends on the preset: the same values are applied again after a quality change
      G.bus.on('engine:quality', () => { for (const id of ['resolution', 'brightness', 'texQuality', 'fxQuality']) this.apply(id); this._applyView(); });
      for (const ev of ['fullscreenchange', 'webkitfullscreenchange']) document.addEventListener(ev, () => this._onFsChange());
      // a window moved to another monitor / a changed zoom: the list of sizes and the wish are read again
      window.addEventListener('resize', () => { this._resT = this._resT || setTimeout(() => { this._resT = 0; this._redefineResolution(); }, 400); });
      G.bus.on('state:loaded', () => { this._chipSync(); this._crowdHook(); });
      // the monitors, when the player already allowed it earlier (no question is asked here)
      try { navigator.permissions?.query?.({ name: 'window-management' }).then((p) => { if (p && p.state === 'granted') this.findScreens(); else if (p && p.state === 'denied') { this._mon.state = 'denied'; this._defineMonitor(); } }, () => {}); } catch (e) { /* no permissions API */ }
    },
    postInit() { this.applyAll(); },
    onStateLoaded() { this._applyView(); },
    onLogout() { if (this._fsChip) this._fsChip.hidden = true; },
    _redefineResolution() {
      const def = this._defs && this._defs.resolution;
      if (!def) return;
      const list = this.resolutionList(), key = list.map((o) => o.v).join();
      if (key !== this._resKey) {
        this._resKey = key; def.options = list.map((o) => ({ v: o.v, l: o.l }));
        if (G.settingsEnums && G.settingsEnums.resolution) G.settingsEnums.resolution = list.map((o) => o.v);
        this._push(def);
      }
      this.apply('resolution');
    },
    update(dt) {
      const eng = E();
      if (!eng || !eng.renderer) return;
      // DOF while playing: the focus sits on the character, the far background softens (the photo mode has its own)
      const ph = G.sys.photo, cam = G.sys.camera;
      if (this.get('dof') === true && eng.composer && !(ph && ph.active)) {
        const pl = G.sys.player?.position, c = eng.camera;
        if (cam && cam.mode === 'follow' && pl && c) {
          const d = Math.hypot(c.position.x - pl.x, c.position.y - (pl.y + 1), c.position.z - pl.z);
          if (d > 0.3 && Number.isFinite(d)) { eng.dof({ focus: d, range: 6 + d * 1.2, amount: 0.55 }); this._dofOn = true; }
        } else if (this._dofOn) { eng.dof(null); this._dofOn = false; }
      } else if (this._dofOn) { this._dofOn = false; if (!(ph && ph.active)) eng.dof(null); }
      // the wide view's longer zoom-out: the fog follows the camera back, so the place round the character stays as clear
      if (this.wide && this._viewBase && cam && cam.mode === 'follow') {
        const k = Math.round(clamp((Number(cam.distance) - 22) / 8, 0, 1) * 4) / 4;
        if (k !== this._zoomK) { this._zoomK = k; eng.setView({ fog: this._viewBase.fog * (1 - 0.06 * k) }); }
      }
      this._chipT = (this._chipT || 0) + dt;
      if (this._chipT > 0.5) { this._chipT = 0; if (this._fsWish || (this._fsChip && !this._fsChip.hidden)) this._chipSync(); }
    },
  };
  G.register(display);
})();
