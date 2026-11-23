#!/usr/bin/env node
// tests/display-unit.mjs — CONTRACT §18.2 (lane gfx), the maths of the graphics options in Node (no browser, no GPU):
//   G.display (67-display.js, its pure part): the list of drawing sizes for a monitor, the owner's default, the size a
//     wish becomes in a window, the tables of 가시거리 / 텍스쳐 / 이펙트 퀄리티, 이펙트 가시거리, 이펙트 투명화(자신)
//   G.sys.engine (10-engine.js, loaded with the real three.js but without a renderer): the pixel ratio of a chosen
//     size, the frame limit with a fake clock, the far plane with and without a place, the fog factor that hides the far
//     plane, the option switches, the effect cap, the texture sweep (anisotropy, size cap and back), and the
//     screen-brightness block of the output pass — patched into three's real OutputPass, and its curve checked value
//     by value against the screen watchdog's two thresholds (black < 6, white > 250).
//   G.sys.camera (22-camera.js with the real three.js): the wide view's 70° and longer zoom-out.
//   G.fx (66-fx.js with the real three.js): particle share, the effect distance from the character and the camera,
//     what is left of the player's own effects.
//   G.sys.display (67-display.js, its system part with a small fake DOM, a recording engine and the real options
//     registry 68-settings.js): the rows of the settings window, the owner's defaults, what each option tells the engine,
//     the reasons of unavailable options, the full-screen wish and its chip, the monitors, what the server keeps.
// The browser suite tests/display-client.mjs measures the same things on drawn frames.
// Usage: node tests/display-unit.mjs [--json]    exit 0 = all green, 1 = a check failed
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail: String(detail) }); if (!process.argv.includes('--json')) console.log(`${ok ? '✓' : '✗'} ${name}${detail !== '' ? ' — ' + detail : ''}`); };
const J = (v) => JSON.stringify(v);
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;

// ----------------------------------------------------------------------------------------------- G.display (pure)
{
  const G = { data: {} };
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'src/game/67-display.js'), 'utf8'), vm.createContext({ G, Math, Number, Object, Array, String, console }), { filename: '67-display.js' });
  const D = G.display;
  check('67-display.js evaluates without a DOM (its pure part)', !!D && typeof D.resolutionOptions === 'function');
  const fhd = D.resolutionOptions({ width: 1920, height: 1080 }, 1), ids = (l) => l.map((o) => o.v);
  check('a 1920×1080 monitor: 자동 · 1920×1080 (Wide) · 1600×900 · 1366×768 · 1280×720 · 960×540 — nothing larger', J(ids(fhd)) === J(['auto', '1920x1080', '1600x900', '1366x768', '1280x720', '960x540']) && /1920×1080 \(Wide\)/.test(fhd[1].l), J(fhd.map((o) => o.l)));
  check('the owner\'s default there: 1920×1080 (Wide)', D.defaultResolution(fhd, false) === '1920x1080');
  const k4 = D.resolutionOptions({ width: 3840, height: 2160 }, 1), lap = D.resolutionOptions({ width: 1536, height: 864 }, 1.25), odd = D.resolutionOptions({ width: 1440, height: 900 }, 2), small = D.resolutionOptions({ width: 1366, height: 768 }, 1), phone = D.resolutionOptions({ width: 390, height: 844 }, 3);
  check('a 4K monitor offers every size up to 3840×2160, default still 1920×1080', ids(k4).includes('3840x2160') && ids(k4).includes('2560x1440') && D.defaultResolution(k4, false) === '1920x1080');
  check('a laptop panel behind 125 % scaling (1536×864 CSS) is seen as its real 1920×1080', ids(lap).includes('1920x1080') && !ids(lap).includes('native') && !ids(lap).includes('2560x1440'), J(ids(lap)));
  check('a monitor with its own size (2880×1800) gets "모니터 그대로" on top of the common ones', odd[1].v === 'native' && odd[1].w === 2880 && odd[1].h === 1800 && ids(odd).includes('2560x1440'), J(odd.slice(0, 3)));
  check('a monitor smaller than 1920×1080: default = its own size', D.defaultResolution(small, false) === '1366x768' && !ids(small).includes('1920x1080'), `${D.defaultResolution(small, false)} of ${J(ids(small))}`);
  check('touch devices keep 자동 (the preset\'s own ratio)', D.defaultResolution(phone, true) === 'auto');
  check('parseResolution: auto → null · native → the monitor · 1280x720 · nonsense → null', D.parseResolution('auto') === null && J(D.parseResolution('native', { width: 1440, height: 900 }, 2)) === J({ w: 2880, h: 1800 }) && J(D.parseResolution('1280x720')) === J({ w: 1280, h: 720 }) && D.parseResolution('12x') === null && D.parseResolution('<script>') === null);
  const ds = (wish, win, dpr, low) => { const r = D.drawSize(wish, win, dpr, low); return r && [r.w, r.h, r.limit]; };
  check('drawSize: 1920×1080 in a 1536×864 window at 1.25 → 1920×1080', J(ds({ w: 1920, h: 1080 }, { w: 1536, h: 864 }, 1.25)) === J([1920, 1080, null]));
  check('drawSize: 1280×720 in a 1920×1080 window → 1280×720 (drawn smaller, stretched)', J(ds({ w: 1280, h: 720 }, { w: 1920, h: 1080 }, 1)) === J([1280, 720, null]));
  check('drawSize: a wish above the screen\'s own pixels stops at them (limit: screen)', J(ds({ w: 3840, h: 2160 }, { w: 1280, h: 720 }, 1)) === J([1280, 720, 'screen']));
  check('drawSize: the picture keeps the window\'s shape (a square window, a tall phone)', J(ds({ w: 1280, h: 720 }, { w: 1000, h: 1000 }, 2)) === J([720, 720, null]) && J(ds({ w: 1280, h: 720 }, { w: 390, h: 844 }, 3)) === J([591, 1280, null]), `${J(ds({ w: 1280, h: 720 }, { w: 1000, h: 1000 }, 2))} ${J(ds({ w: 1280, h: 720 }, { w: 390, h: 844 }, 3))}`);
  check('drawSize: on `low` never above the window\'s own size (limit: low)', J(ds({ w: 1920, h: 1080 }, { w: 1536, h: 864 }, 1.25, true)) === J([1536, 864, 'low']));
  check('가시거리 퀄리티: far plane 800 / 1300 / 3000 m, more fog and nearer culling when lower', D.VIEW.low.far === 800 && D.VIEW.medium.far === 1300 && D.VIEW.high.far === 3000 && D.VIEW.low.fog > D.VIEW.medium.fog && D.VIEW.medium.fog > D.VIEW.high.fog && D.VIEW.high.fog === 1 && D.VIEW.low.cull < D.VIEW.medium.cull && D.VIEW.high.cull === 1 && D.VIEW.high.veg === 1);
  check('텍스쳐 퀄리티: anisotropy 1 / 4 / 16, size cap 256 / 384 / none', D.TEX.low.aniso === 1 && D.TEX.low.cap === 256 && D.TEX.medium.aniso === 4 && D.TEX.medium.cap === 384 && D.TEX.high.cap === 0);
  check('이펙트 퀄리티: particle share 0.4 / 0.7 / 1, weather-effect level 0 / 1 / 2', D.FX.low.particles === 0.4 && D.FX.medium.particles === 0.7 && D.FX.high.particles === 1 && D.FX.low.level === 0 && D.FX.high.level === 2);
  const R = Array.from({ length: 10 }, (_, i) => D.fxRange(i + 1));
  check('이펙트 가시거리 1 … 10: 8 m … 165 m, each step farther; 9 (the default) = 118 m', R[0] === 8 && R[8] === 118 && R[9] === 165 && R.every((v, i) => i === 0 || v > R[i - 1]) && D.fxRange(99) === 165 && D.fxRange(-3) === 8 && D.fxRange('x') === 118, J(R));
  const A = [0, 1, 2, 3, 4, 5].map(D.selfAlpha);
  check('이펙트 투명화(자신) 0 … 5: 1 → 0.1, each step fainter', A[0] === 1 && A[5] === 0.1 && A.every((v, i) => i === 0 || v < A[i - 1]) && D.selfAlpha(9) === 0.1 && D.selfAlpha(-1) === 1, J(A));
  const X = D.DEFAULTS;
  check('defaults as the owner listed: 창 모드 · 밝기 50 · 이펙트/텍스쳐/가시거리 높음 · 이펙트 가시거리 9 · JPG · 수직동기화 미선택 · 최대 시야 확장 선택 · 투명화 0 · DOF 미선택',
    X.windowMode === 'window' && X.brightness === 50 && X.fxQuality === 'high' && X.texQuality === 'high' && X.viewQuality === 'high' && X.fxDistance === 9 && X.shotFormat === 'jpg' && X.frameLimit === 'display' && X.wideView === true && X.selfFxFade === 0 && X.dof === false, J(X));
}

// ----------------------------------------------------------------------------------------------- the engine without a renderer
function loadEngine(win = {}) {
  const bus = { _l: {}, on(t, fn) { (this._l[t] = this._l[t] || []).push(fn); return () => {}; }, emit(t, d) { (this.seen = this.seen || []).push(t); for (const fn of (this._l[t] || []).slice()) fn(d); } };
  const systems = [];
  const G = {
    data: {}, sys: {}, settings: { quality: 'high', shadows: true, bloom: true }, flags: { quality: null }, params: new URLSearchParams(''), bus, ready: true, state: {},
    util: { clamp: (v, a, b) => (v < a ? a : v > b ? b : v) }, log: { warn() {}, info() {}, error() {}, debug() {} },
    register(s) { systems.push(s); G.sys[s.name] = s; return s; },
  };
  const window = Object.assign({ innerWidth: 1536, innerHeight: 864, devicePixelRatio: 1.25, addEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {} }) }, win);
  const T = { now: 0 };
  class OffscreenCanvas {
    constructor(w, h) { this.width = w; this.height = h; }
    getContext() { return { drawImage() {}, translate() {}, scale() {}, putImageData() {} }; }
    transferToImageBitmap() { return { width: this.width, height: this.height, small: true }; }
  }
  const ctx = vm.createContext({ G, THREE, ADDONS: { OutputPass }, window, document: { getElementById: () => null, addEventListener() {}, createElement: () => ({ getContext: () => null, style: {} }), body: { classList: { contains: () => false } }, hidden: false },
    performance: { now: () => T.now }, navigator: { deviceMemory: 8, hardwareConcurrency: 8 }, console, Math, Number, Object, Array, String, JSON, Map, Set, WeakMap, Promise, Error, RegExp, Infinity, NaN, Uint8Array, Int32Array, Float32Array, Float64Array, Uint16Array,
    setTimeout: (fn) => { (T.timers = T.timers || []).push(fn); return T.timers.length; }, clearTimeout() {}, OffscreenCanvas, URLSearchParams });
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'src/game/10-engine.js'), 'utf8'), ctx, { filename: '10-engine.js' });
  return { G, E: G.sys.engine, window, T, bus };
}
{
  const { G, E, window, T, bus } = loadEngine();
  check('10-engine.js loads with the real three.js and registers the engine', !!E && E.name === 'engine' && typeof E.setResolution === 'function');
  // ---- the pixel ratio of a chosen size
  const PR = (preset, res, w, h, dpr) => { E.preset = { name: preset, pixelRatio: preset === 'low' ? 1 : preset === 'medium' ? 1.25 : 2 }; E._res = res; window.innerWidth = w; window.innerHeight = h; window.devicePixelRatio = dpr; const r = E._pixelRatio(); return [Math.round(r * 1000) / 1000, E._resLimit]; };
  check('no wish: the preset\'s ratio as before (min(device, preset))', J(PR('high', null, 1536, 864, 1.25)) === J([1.25, null]) && J(PR('medium', null, 1920, 1080, 2)) === J([1.25, null]) && J(PR('low', null, 1920, 1080, 2)) === J([1, null]));
  check('1920×1080 in a 1536×864 window (device ratio 1.25) → ratio 1.25', J(PR('high', { w: 1920, h: 1080 }, 1536, 864, 1.25)) === J([1.25, null]));
  check('1280×720 in a 1920×1080 window → ratio 0.667 (a smaller picture, on every preset)', J(PR('high', { w: 1280, h: 720 }, 1920, 1080, 1)) === J([0.667, null]) && J(PR('low', { w: 1280, h: 720 }, 1920, 1080, 1)) === J([0.667, null]));
  check('1920×1080 on a 4K screen at 200 % (1920×1080 CSS) → ratio 1, not the preset\'s 2', J(PR('high', { w: 1920, h: 1080 }, 1920, 1080, 2)) === J([1, null]));
  check('a wish above the screen stops at the screen; `low` stops at the window', J(PR('high', { w: 3840, h: 2160 }, 1280, 720, 1)) === J([1, 'screen']) && J(PR('low', { w: 1920, h: 1080 }, 1536, 864, 1.25)) === J([1, 'low']));
  check('the engine and G.display.drawSize agree (1280×720 wish, 1000×1000 window, ratio 2)', J(PR('high', { w: 1280, h: 720 }, 1000, 1000, 2)) === J([0.72, null]));
  E._res = null; E.preset = { name: 'high', pixelRatio: 2, antialias: true, drs: [0.7, 1], atmos: 2, bloom: true, ao: 1, godrays: true };
  window.innerWidth = 1536; window.innerHeight = 864; window.devicePixelRatio = 1.25;
  // ---- the frame limit with a fake clock
  const run = (hz, limit, ms) => { E.setFrameLimit(limit, () => T.now); T.now = 1000; let drawn = 0; const step = 1000 / hz, n = Math.round(ms / step); for (let i = 0; i < n; i++) { if (E._frameGate()) drawn++; T.now += step; } return drawn; };
  const f = { d60: run(60, 0, 1000), l30on60: run(60, 30, 2000), l60on60: run(60, 60, 2000), l60on144: run(144, 60, 2000), l30on144: run(144, 30, 2000), l60on75: run(75, 60, 2000), l60on30: run(30, 60, 2000) };
  check('frame limit off: every display frame is drawn', f.d60 === 60, f.d60);
  check('limit 30 on a 60 Hz display: 30 a second', Math.abs(f.l30on60 - 60) <= 1, `${f.l30on60} in 2 s`);
  check('limit 60 on a 60 Hz display: nothing is dropped', Math.abs(f.l60on60 - 120) <= 1, `${f.l60on60} in 2 s`);
  check('limit 60 on a 144 Hz display: 60 a second (the cadence is kept, not 48)', Math.abs(f.l60on144 - 120) <= 2, `${f.l60on144} in 2 s`);
  check('limit 30 on 144 Hz · 60 on 75 Hz · 60 on a slow 30 fps device', Math.abs(f.l30on144 - 60) <= 2 && Math.abs(f.l60on75 - 120) <= 3 && Math.abs(f.l60on30 - 60) <= 1, J(f));
  check('setFrameLimit: nonsense and tiny values mean "off"; the gate counts what it skipped', E.setFrameLimit('abc') === 0 && E.setFrameLimit(2) === 0 && E.setFrameLimit(30) === 30 && E.frameLimit.skipped > 0);
  E.setFrameLimit(0, null);
  // ---- brightness numbers
  const b0 = { ...E.setBrightness(0) }, b50 = { ...E.setBrightness(50) }, b100 = { ...E.setBrightness(100) }, bx = { ...E.setBrightness('junk') }, by = { ...E.setBrightness(1e9) };
  check('brightness: 50 = gamma 1 exactly; 0 darker (gamma > 1), 100 brighter (gamma < 1); junk → 50; clamped', b50.gamma === 1 && b0.gamma > 1.5 && b0.gamma < 1.7 && b100.gamma < 0.65 && b100.gamma > 0.6 && bx.value === 50 && by.value === 100, J([b0.gamma, b50.gamma, b100.gamma]));
  check('brightness on `low` (CSS): 0.62 … 1 … 1.4', near(b0.css, 0.62) && b50.css === 1 && near(b100.css, 1.4), J([b0.css, b100.css]));
  E.setBrightness(50);
  check('cssFilter joins the named filters in a fixed order (brightness, then the photo filter)', E.cssFilter('photo', 'sepia(0.5)') === 'sepia(0.5)' && E.cssFilter('display', 'brightness(1.2)') === 'brightness(1.2) sepia(0.5)' && E.cssFilter('photo', '') === 'brightness(1.2)' && E.cssFilter('display', 'none') === '');
  E.setBrightness(50);
  // ---- the output pass block, on three's real OutputPass
  const S = G.gfx.displayShader, pass = new OutputPass(), before = pass.material.fragmentShader;
  const ok1 = S.patch(pass), after = pass.material.fragmentShader, ok2 = S.patch(pass);
  const braces = (s) => (s.match(/{/g) || []).length - (s.match(/}/g) || []).length;
  check('the brightness block goes into three\'s OutputPass: one uniform, one block before the last brace, only once', ok1 === true && ok2 === false && after.includes('uniform vec3 uTfmDisp;') && after.indexOf('uTfmDisp.x != 1.0') > after.indexOf('sRGBTransferOETF( gl_FragColor )') && braces(after) === 0 && braces(before) === 0 && after.trim().endsWith('}') && pass.uniforms.uTfmDisp.value.x === 1, `${after.length - before.length} characters added`);
  check('a shader without the expected head is left alone (the CSS filter stands in)', S.patch({ material: { fragmentShader: 'void main() {}' }, uniforms: {} }) === false && S.patch(null) === false);
  // the curve, value by value (a mirror of the GLSL block): what the watchdog calls black / white never changes
  const curve = (v, g) => { const lo = S.lo, hi = S.hi; if (g === 1) return v; const x = Math.min(1, Math.max(0, v)); if (x < lo || x > hi) return v; const u = Math.min(1, Math.max(0, (x - lo) / (hi - lo))); return lo + (hi - lo) * Math.pow(Math.max(u, 1e-5), g); };
  let bad = 0, mono = 0, mid = [];
  for (const b of [0, 10, 25, 40, 50, 60, 75, 90, 100]) {
    const g = E.setBrightness(b).gamma;
    let prev = -1;
    for (let i = 0; i <= 255; i++) {
      const o = curve(i / 255, g) * 255;
      if (i < 6 && Math.abs(o - i) > 1e-9) bad++;             // black stays the same black
      if (i > 250 && Math.abs(o - i) > 1e-9) bad++;           // white stays the same white
      if (i >= 6 && i <= 250 && (o < 6 - 1e-9 || o > 250 + 1e-9)) bad++;   // nothing becomes black or white
      if (o < prev - 1e-9) mono++;
      prev = o;
    }
    mid.push(Math.round(curve(128 / 255, g) * 255));
  }
  check('the curve at 9 brightness values × 256 levels: black (< 6) and white (> 250) are untouched, nothing in between becomes either, and it never folds back', bad === 0 && mono === 0, `${bad} / ${mono}`);
  check('middle grey 128 goes from about 88 (밝기 0) through 128 (50) to about 163 (100), step by step', mid[0] >= 84 && mid[0] <= 92 && mid[4] === 128 && mid[8] >= 159 && mid[8] <= 167 && mid.every((v, i) => i === 0 || v > mid[i - 1]), J(mid));
  check('the protected ends are 10/255 and 242/255 (wider than the watchdog\'s 6 and 250)', near(S.lo, 10 / 255) && near(S.hi, 242 / 255));
  E.setBrightness(50);
  // ---- view distance
  E._initScene();
  const cam = E.camera, fog = E.scene.fog;
  check('a fresh engine: far plane 3000 m, fog factor 1 (the picture of phase 9)', cam.far === 3000 && E._viewFogNow() === 1 && E.viewFog === 1);
  fog.density = 0.0024;
  const v1 = { ...E.setView({ far: 800, fog: 1.35, cull: 0.55, veg: 0.6 }) };
  check('setView(낮음): camera.far 800, fog × 1.35, cull × 0.55, forest levels × 0.6, and \'engine:view\' is told', cam.far === 800 && near(E.viewFog, 1.35) && E._view.cull === 0.55 && E.viewVeg === 0.6 && bus.seen.includes('engine:view'), J(v1));
  fog.density = 0.0012;
  check('thin air (clear weather): the fog factor rises so that the far plane cuts nothing visible (density ≥ 2.1 / far)', near(E._viewFogNow(), 2.1 / 800 / 0.0012, 1e-9) && E._viewFogNow() * fog.density >= 2.1 / 800 - 1e-12, E._viewFogNow().toFixed(3));
  G.sys.places = { current: 'PL_ROOM', def: () => ({ far: 150 }) };
  E._applyViewFar();
  const inRoom = cam.far;
  check('inside a place the nearer far plane wins (a room\'s 150 m), and the valley\'s fog rule rests', inRoom === 150 && near(E._viewFogNow(), 1.35), `${inRoom} · ${E._viewFogNow()}`);
  G.sys.places = { current: 'PL_ALLOT', def: () => ({ far: 1600 }) };
  E._applyViewFar();
  const inDistrict = cam.far;
  G.sys.places = { current: null, def: () => null };
  bus.emit('place:exit', {});
  E._applyViewFar();
  check('a district\'s 1600 m is cut to the player\'s 800 m; leaving puts the player\'s far plane back', inDistrict === 800 && cam.far === 800 && E._view.placeFar === null, `${inDistrict} → ${cam.far}`);
  E.indoor = 1;
  const indoorFog = E._viewFogNow();
  E.indoor = 0;
  E.setView({ far: 3000, fog: 1, cull: 1, veg: 1 });
  check('rooms keep their own air (factor 1 indoors); 높음 puts 3000 m / factor 1 back', indoorFog === 1 && cam.far === 3000 && E.viewFog === 1);
  check('setView clamps nonsense (far 200 … 6000, fog 0.5 … 4, grass 0 … 1)', E.setView({ far: -5, fog: 99, grass: 7 }).far === 200 && E._view.fog === 4 && E._view.grass === 1 && E.setView({ far: NaN, fog: 'x', grass: 1 }).far === 3000 && E._view.fog === 1);
  E.setView({ far: 3000, fog: 1, cull: 1, veg: 1, grass: 1 });
  // ---- switches
  const lay = (aa) => { E._opt.aa = aa; return E._postLayout(1536, 864, 1.25).samples; };
  check('anti-aliasing switch: 4 samples on, 0 off', lay(true) === 4 && lay(false) === 0);
  E._opt.aa = true;
  check('setOption knows aa / ao / drs only', E.setOption('ao', false) === true && E._opt.ao === false && E.setOption('nope', true) === false && E.setOption('ao', true) === true);
  const dw = () => E._drsWanted();
  const w1 = dw(); E._opt.drs = false; const w2 = dw(); E._opt.drs = true; G.flags.quality = 'high'; const w3 = dw(); G.flags.quality = null; E.preset = { ...E.preset, drs: null }; const w4 = dw();
  check('dynamic resolution runs only with the preset\'s range, the player\'s switch, and no pinned test quality', w1 === true && w2 === false && w3 === false && w4 === false, J([w1, w2, w3, w4]));
  E.preset = { name: 'high', pixelRatio: 2, antialias: true, drs: [0.7, 1], atmos: 2 };
  // ---- 이펙트 퀄리티 caps the weather effects
  const feats = () => ['petals', 'mist', 'smoke', 'caustics', 'rainRings', 'splashes', 'sway', 'grade'].filter((n) => E.feature(n));
  const f2 = feats(); E.setEffects(1); const f1 = feats(); E.setEffects(0); const f0 = feats(); E.setEffects(2);
  check('이펙트 퀄리티 on a `high` preset: 높음 all · 보통 no valley mist · 낮음 no petals / smoke / caustics / rain rings; splashes, sway and the grade stay', f2.includes('mist') && f2.includes('petals') && !f1.includes('mist') && f1.includes('petals') && f1.includes('smoke') && J(f0) === J(['splashes', 'sway', 'grade']), `${J(f2)} | ${J(f1)} | ${J(f0)}`);
  check('setEffects tells the modules (engine:features)', bus.seen.includes('engine:features'));
  // ---- the texture sweep
  const tex = (o) => Object.assign(new THREE.Texture(), o);
  const packT = tex({ anisotropy: 8, image: { width: 512, height: 512 }, userData: { pack: { name: 'mat/grass/c', ready: true } } });
  const smallT = tex({ anisotropy: 4, image: { width: 256, height: 256 }, userData: { pack: { name: 'mat/grass/r', ready: true } } });
  const waiting = tex({ anisotropy: 8, image: { width: 1, height: 1 }, userData: { pack: { name: 'mat/x', ready: false } } });
  const board = tex({ anisotropy: 4, image: { width: 1024, height: 512 } });     // a drawn sign: never resized
  const uni = tex({ anisotropy: 8, image: { width: 512, height: 512 }, userData: { pack: { name: 'mat/u', ready: true } } });
  const m1 = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial({ map: packT, roughnessMap: smallT, normalMap: waiting }));
  const m2 = new THREE.Mesh(new THREE.BufferGeometry(), [new THREE.MeshBasicMaterial({ map: board }), new THREE.ShaderMaterial({ uniforms: { tA: { value: uni }, n: { value: 3 } } })]);
  E.scene.add(m1, m2);
  const s1 = { ...E.setTextureQuality({ aniso: 1, cap: 256 }) };
  check('텍스쳐 낮음: every map gets anisotropy 1; the pack\'s 512 px maps are swapped for 256 px copies; signs and undecoded maps keep their image', packT.anisotropy === 1 && board.anisotropy === 1 && packT.image.width === 256 && packT.image.small === true && uni.image.width === 256 && smallT.image.width === 256 && !smallT.image.small && board.image.width === 1024 && waiting.image.width === 1 && s1.capped === 2 && s1.seen === 5, J(s1));
  const s2 = { ...E.setTextureQuality({ aniso: 4, cap: 384 }) };
  check('텍스쳐 보통: anisotropy up to 4, 384 px copies (made from the full image, not from the small one)', packT.anisotropy === 4 && smallT.anisotropy === 4 && packT.image.width === 384 && uni.image.width === 384, J(s2));
  const s3 = { ...E.setTextureQuality({ aniso: 16, cap: 0 }) };
  check('텍스쳐 높음: the full images and the authored anisotropy are back — no restart', packT.anisotropy === 8 && board.anisotropy === 4 && packT.image.width === 512 && !packT.image.small && uni.image.width === 512 && packT.userData._full === null, J(s3));
  check('nothing to do the second time (a sweep changes only what differs)', E.setTextureQuality({ aniso: 16, cap: 0 }).changed === 0);
  // ---- the summary
  const I = E.displayInfo;
  check('displayInfo sums it up (resolution, brightness, switches, frame limit, view, effects, textures, preset)', !!I.resolution && I.brightness.value === 50 && I.options.aa === true && I.frameLimit.fps === 0 && I.view.far === 3000 && I.effects === 2 && I.textures.cap === 0 && I.preset === 'high' && I.post === null);
}

// ----------------------------------------------------------------------------------------------- one drawn frame with a stub renderer
// engine.render() itself (the code every frame runs), with a renderer that only records: the frame limit thins the draws,
// the fog of the view distance is in force exactly during the draw and the weather's own value is back afterwards — also
// when the draw throws.
{
  const { G, E, T } = loadEngine();
  const seen = [];
  E.scene = new THREE.Scene(); E.scene.fog = new THREE.FogExp2(0xffffff, 0.002);
  E.camera = new THREE.PerspectiveCamera(55, 16 / 9, 0.1, 3000);
  let boom = false;
  E.renderer = { info: { reset() { this.render.calls = 0; this.render.triangles = 0; }, render: { calls: 0, triangles: 0 }, memory: { geometries: 0, textures: 0 }, programs: [] },
    render(scene) { seen.push(scene.fog.density); this.info.render.calls++; if (boom) throw new Error('draw failed'); }, getRenderTarget: () => null, setRenderTarget() {},
    getContext: () => ({ isContextLost: () => false }), getDrawingBufferSize: (v) => (v ? v.set(1920, 1080) : { x: 1920, y: 1080 }), domElement: { width: 1920, height: 1080, style: {} } };
  let threw = null;
  const draw = (o) => { try { E.render(o); } catch (e) { threw = e; } };
  T.now = 1000; E.viewFog = 1; draw();
  check('engine.render() runs with a recording renderer: one draw, the fog untouched at view factor 1', threw === null && seen.length === 1 && seen[0] === 0.002 && E.scene.fog.density === 0.002 && E.frameInfo.calls === 1, threw ? String(threw.stack).split('\n').slice(0, 3).join(' | ') : J(seen));
  E.viewFog = 1.35; T.now += 16; draw();
  check('가시거리 낮음 (fog × 1.35): the draw sees 0.0027, the weather\'s 0.002 is back right after it', threw === null && near(seen[seen.length - 1], 0.0027, 1e-12) && E.scene.fog.density === 0.002, J([seen[seen.length - 1], E.scene.fog.density]));
  boom = true; T.now += 16; draw(); boom = false;
  check('… also when the draw throws (the value never stays scaled, nothing compounds)', E.scene.fog.density === 0.002 && threw && /draw failed/.test(threw.message), String(threw && threw.message));
  threw = null; E.viewFog = 1;
  // the frame limit on the real render path: 2 s of a 60 Hz display at "초당 30장"
  E.setFrameLimit(30, () => T.now);
  let n0 = seen.length;
  for (let i = 0; i < 120; i++) { T.now += 1000 / 60; draw(); }
  const d30 = seen.length - n0;
  check('초당 30장 on a 60 Hz display: 120 display frames → 60 draws (every other frame)', threw === null && d30 >= 59 && d30 <= 61, `${d30} draws`);
  n0 = seen.length; for (let i = 0; i < 10; i++) { T.now += 1000 / 60; draw({ force: true }); }
  check('a forced draw (a photo, a test) is never thinned', seen.length - n0 === 10);
  // the rest of a frame: the engine's own update (view fog of the moment, drawn frames per second), the dynamic-resolution tick, the culling
  let upErr = null; try { for (let i = 0; i < 30; i++) { T.now += 1000 / 60; E.update(1 / 60); draw(); } E._drsTick(1 / 60); E._updateCull(); } catch (e) { upErr = e; }
  check('a whole frame — update, draw, dynamic-resolution tick, culling — runs without an error', upErr === null && threw === null && Number.isFinite(E.viewFog) && E.cullStats.dist === 210, upErr ? String(upErr.stack).split('\n').slice(0, 3).join(' | ') : '');
  E.setFrameLimit(0); n0 = seen.length; for (let i = 0; i < 60; i++) { T.now += 1000 / 60; draw(); }
  check('미선택 · 화면에 맞춤: every display frame is drawn again', seen.length - n0 === 60 && threw === null, `${seen.length - n0} draws`);
}

// ----------------------------------------------------------------------------------------------- the effect module (66-fx.js)
// The real module with the real three.js (no renderer): 이펙트 퀄리티 = the share of particles a burst makes, 이펙트 가시거리 =
// measured from the character AND the camera (what happens round the character is made however far the camera is),
// 이펙트 투명화(자신) = what is left of the player's own effects.
{
  const T = { now: 1000 };
  const ctx2d = new Proxy({}, { get: (t, k) => (k === 'measureText' ? () => ({ width: 10 }) : k === 'getImageData' ? () => ({ data: new Uint8ClampedArray(4) }) : /^create.*Gradient$/.test(String(k)) ? () => ({ addColorStop() {} }) : typeof k === 'string' ? () => {} : undefined), set: () => true });
  const mkEl = () => ({ style: {}, dataset: {}, width: 64, height: 64, getContext: () => ctx2d, classList: { add() {}, remove() {}, toggle() {}, contains: () => false }, appendChild() {}, append() {}, remove() {}, setAttribute() {}, addEventListener() {}, querySelector: () => null, getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 40 }) });
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(55, 16 / 9, 0.1, 3000);
  camera.position.set(0, 3, 9); camera.updateMatrixWorld();
  const systems = [], errors = [];
  const tex = () => new THREE.Texture();
  const G = { data: {}, gfx: { canvasTexture: tex, radialTexture: tex, guard: null },
    sys: { engine: { scene, camera, preset: { name: 'high' }, quality: 'high', renderer: null, feature: () => 2, uniforms: {} }, player: { position: new THREE.Vector3(0, 0, 0), velocity: new THREE.Vector3() }, camera: { mode: 'follow' } },
    bus: { _l: {}, on(t, fn) { (this._l[t] = this._l[t] || []).push(fn); return () => {}; }, emit(t, d) { for (const fn of (this._l[t] || []).slice()) fn(d); } },
    settings: { fxLevel: 'high', reduceMotion: false, easyMode: false }, state: {}, util: { clamp: (v, a, b) => Math.min(b, Math.max(a, v)), lerp: (a, b, t) => a + (b - a) * t, rand: Math.random },
    register(x) { systems.push(x); G.sys[x.name] = x; }, log: { warn() {}, error(...a) { errors.push(a.map(String).join(' ').slice(0, 200)); }, info() {}, debug() {} },
    ui: { toast() {}, isBlocking: () => false }, easy: { on: false }, osReducedMotion: () => false, flags: {}, params: new URLSearchParams('') };
  const ctx = vm.createContext({ G, THREE, window: { innerWidth: 1280, innerHeight: 720, devicePixelRatio: 1, addEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {} }) },
    document: { body: mkEl(), documentElement: mkEl(), head: mkEl(), createElement: mkEl, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, hidden: false },
    console, Math, Number, Object, Map, Set, WeakMap, Array, String, JSON, Promise, Error, RegExp, Infinity, NaN, Float32Array, Uint8Array, Uint16Array, Uint32Array, Int8Array, Float64Array, Uint8ClampedArray, URLSearchParams, Symbol,
    performance: { now: () => T.now }, navigator: { webdriver: false }, setTimeout: () => 0, clearTimeout() {}, requestAnimationFrame: () => 0, location: { search: '' }, localStorage: { getItem: () => null, setItem() {} } });
  let loadErr = null;
  try { vm.runInContext(fs.readFileSync(path.join(ROOT, 'src/game/66-fx.js'), 'utf8'), ctx, { filename: '66-fx.js' }); for (const x of systems) if (x.init) x.init(); } catch (e) { loadErr = e; }
  const F = G.fx;
  check('66-fx.js loads with the real three.js; the options are neutral until the settings set them (share 1, no range, own effects whole)', !loadErr && !!F && F.options().quality === 1 && F.options().range === Infinity && F.options().selfAlpha === 1, loadErr ? String(loadErr.stack).split('\n').slice(0, 2).join(' | ') : J(F && F.options()));
  const burst = (p) => { F.clear(); return F.burst('confetti', p, { count: 40 }); };
  const AT = { x: 0, y: 1, z: 0 }, CAMSIDE = { x: 5, y: 3, z: 9 }, FAR = { x: 60, y: 1, z: 0 };
  const q = [1, 0.7, 0.4].map((v) => { F.setQuality(v); return burst(AT); }); F.setQuality(1);
  check('이펙트 퀄리티 높음 / 보통 / 낮음: a burst of 40 makes 40 / 28 / 16 particles', J(q) === J([40, 28, 16]), J(q));
  F.setRange(8);
  const near = [burst(AT), burst(CAMSIDE), burst(FAR)];
  check('이펙트 가시거리 1 (8 m): made at the character (9.5 m from the camera) and beside the camera, not 60 m away', near[0] === 40 && near[1] === 40 && near[2] === 0 && J([F.inRange(AT), F.inRange(CAMSIDE), F.inRange(FAR)]) === J([true, true, false]), J(near));
  camera.position.set(0, 12, 28); camera.updateMatrixWorld();
  check('… and still at the character with the camera zoomed all the way out (30 m)', burst(AT) === 40 && burst({ x: 0, y: 1, z: 14 }) === 0);
  camera.position.set(0, 3, 9); camera.updateMatrixWorld();
  check('… floating emoji and ground rings obey the same rule', !!F.emoji3d({ x: 1, y: 1, z: 0 }, '⭐') === true && !!F.emoji3d({ x: 80, y: 1, z: 0 }, '⭐') === false && F.ripple({ x: 1, y: 0, z: 0 }) > 0 && F.ripple({ x: 80, y: 0, z: 0 }) === 0);
  check('the range has a floor of 4 m and "none" means everywhere', F.setRange(1) === 4 && F.setRange(0) === Infinity && F.setRange('x') === Infinity && burst(FAR) === 40);
  const dj = [1, 0.6, 0.1, 0].map((a) => { F.setSelfAlpha(a); F.clear(); T.now += 1000; return F.doubleJump({ x: 0, y: 0, z: 0 }); }); F.setSelfAlpha(1);
  check('이펙트 투명화(자신): the double-jump sparkles thin out with it and are gone at the end (0 → none)', dj[0] > 0 && dj[1] > 0 && dj[1] <= dj[0] && dj[3] === 0 && dj[2] <= dj[1], J(dj));
  let upErr = null; try { for (let i = 0; i < 30; i++) { T.now += 16; for (const x of systems) if (x.update) x.update(1 / 60, T.now / 1000); } } catch (e) { upErr = e; }
  check('thirty frames of the effect module run without an error', upErr === null && errors.length === 0, upErr ? String(upErr.stack).split('\n').slice(0, 2).join(' | ') : errors.slice(0, 2).join(' | '));
}

// ----------------------------------------------------------------------------------------------- the camera with the wide view
// The real 22-camera.js with the real three.js: 최대 시야 확장 opens the follow view from 55° to 70° and lets the wheel
// zoom out to 30 m (easy mode 16 m); switched off while far out, the camera comes back inside the usual range.
{
  const camPage = (easy) => {
    const camera = new THREE.PerspectiveCamera(55, 16 / 9, 0.1, 3000), systems = [], Z = { zoom: 0 }, errors = [];
    const G = { data: {}, sys: { engine: { camera, scene: new THREE.Scene(), renderer: { domElement: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 720 }) } }, preset: { name: 'high' } },
        player: { position: new THREE.Vector3(0, 0, 0), velocity: new THREE.Vector3(), yaw: 0, _ready: true, group: new THREE.Group() }, display: { wide: false } },
      bus: { on: () => () => {}, emit() {} }, settings: { easyMode: easy, sensitivity: 1, lookSpeed: 1, invertY: false, cameraShake: true, reduceMotion: false }, state: {}, ready: true,
      util: { clamp: (v, a, b) => Math.min(b, Math.max(a, v)), lerp: (a, b, t) => a + (b - a) * t, damp: (l, dt) => 1 - Math.exp(-l * dt),
        angleDiff(a, b) { let d = (b - a) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return d; } },
      register(x) { systems.push(x); G.sys[x.name] = x; }, log: { warn() {}, error(...a) { errors.push(a.map(String).join(' ')); }, info() {}, debug() {} },
      ui: { isBlocking: () => false }, easy: { on: easy }, flags: {}, params: new URLSearchParams(''), world: new Proxy({ heightAt: () => 0, isWater: () => false, colliders: [] }, { get: (o, k) => (k in o ? o[k] : () => null) }),   // (flat dry ground, nothing in the way)
      input: { consumeLook: () => ({ dx: 0, dy: 0 }), consumeZoom: () => { const z = Z.zoom; Z.zoom = 0; return z; }, gameplay: () => true, touchUI: false, isDown: () => false },
      display: { WIDE_FOV: 70, WIDE_ZOOM: { normal: 30, easy: 16 } } };
    const ctx = vm.createContext({ G, THREE, window: { innerWidth: 1280, innerHeight: 720, addEventListener() {}, matchMedia: () => ({ matches: false }) }, document: { body: { classList: { contains: () => false } }, getElementById: () => null, addEventListener() {} },
      console, Math, Number, Object, Map, Set, WeakMap, Array, String, JSON, Promise, Error, RegExp, Infinity, NaN, Float32Array, URLSearchParams, performance: { now: () => 0 }, navigator: {}, setTimeout: () => 0, clearTimeout() {} });
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'src/game/22-camera.js'), 'utf8'), ctx, { filename: '22-camera.js' });
    const C = G.sys.camera; if (C.init) C.init();
    let t = 0;
    const run = (frames, zoom = 0) => { for (let k = 0; k < frames; k++) { Z.zoom = zoom; t += 1 / 60; C.update(1 / 60, t); } return { fov: Math.round(camera.fov * 10) / 10, dist: Math.round(C.distance * 10) / 10 }; };
    return { G, C, camera, run, errors };
  };
  let err = null, n, e;
  try { n = camPage(false); e = camPage(true); } catch (x) { err = x; }
  check('22-camera.js loads with the real three.js and follows the character', !err && n.C.mode === 'follow', err ? String(err.stack).split('\n').slice(0, 2).join(' | ') : '');
  if (!err) try {
    const base = n.run(120), out0 = n.run(400, 1);
    n.G.sys.display.wide = true;
    const wide = n.run(300), out1 = n.run(400, 1);
    n.G.sys.display.wide = false;
    const back = n.run(400);
    check('최대 시야 확장 off: 55°, the wheel zooms out to 22 m', base.fov === 55 && out0.dist === 22, J([base, out0]));
    check('최대 시야 확장 on: the view opens to 70°, the wheel zooms out to 30 m', wide.fov === 70 && wide.dist === 22 && out1.dist === 30 && out1.fov === 70, J([wide, out1]));
    check('switched off while far out: back to 55° and inside 22 m', back.fov === 55 && back.dist === 22, J(back));
    const eb = e.run(120), eo = e.run(400, 1); e.G.sys.display.wide = true; const ew = e.run(400, 1);
    check('easy mode: 12.5 m, with the wide view 16 m and 70°', eo.dist === 12.5 && ew.dist === 16 && ew.fov === 70 && eb.fov === 55, J([eb, eo, ew]));
    check('the camera reported no error', n.errors.length === 0 && e.errors.length === 0, n.errors.concat(e.errors).slice(0, 2).join(' | '));
  } catch (x) { check('the camera runs its frames in this test', false, String(x.stack).split('\n').slice(0, 3).join(' | ')); }
}

// ----------------------------------------------------------------------------------------------- G.sys.display (system)
// The system part of 67-display.js in a vm with a small fake DOM, a recording engine and — when it evaluates there — the
// REAL options registry (68-settings.js): the rows as the settings window will get them, the owner's defaults, what
// each option tells the engine, the reasons an option gives when it cannot be used, the full-screen wish and its chip,
// the monitors, and that every value an option can take is one the server keeps (Tfm\UserSettings).
async function systemPage(opts = {}) {
  const tick = () => new Promise((r) => setImmediate(r));
  const listeners = (o) => { o._l = {}; o.addEventListener = (t, fn) => { (o._l[t] = o._l[t] || []).push(fn); }; o.removeEventListener = () => {}; o.fire = (t, e = {}) => { for (const fn of (o._l[t] || []).slice()) fn(e); }; return o; };
  const mkStyle = () => Object.defineProperties({}, { setProperty: { value(k, v) { this[k] = String(v); } }, removeProperty: { value(k) { delete this[k]; } } });
  const mkEl = (tag) => listeners({ tagName: String(tag).toUpperCase(), style: mkStyle(), dataset: {}, attrs: {}, children: [], hidden: false, textContent: '',
    classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); }, toggle() {}, contains(c) { return this._s.has(c); } },
    setAttribute(k, v) { this.attrs[k] = String(v); }, getAttribute(k) { return this.attrs[k] ?? null; },
    append(...n) { this.children.push(...n); }, appendChild(n) { this.children.push(n); return n; }, remove() {}, querySelector: () => null, querySelectorAll: () => [],
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 40 }), toDataURL: (m) => (m === 'image/webp' && !opts.webp ? 'data:image/png;base64,' : `data:${m || 'image/png'};base64,`), click() { this.fire('click', {}); } });
  const body = mkEl('body'), root = mkEl('html');
  const fs_ = { el: null, asked: [], refuse: !!opts.refuseFs, exits: 0, locks: [] };
  const document = listeners({ body, documentElement: root, head: mkEl('head'), createElement: mkEl, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], readyState: 'complete',
    exitFullscreen() { fs_.exits++; fs_.el = null; document.fire('fullscreenchange'); return Promise.resolve(); } });
  Object.defineProperty(document, 'fullscreenElement', { get: () => fs_.el });
  if (!opts.noFs) root.requestFullscreen = (o) => { fs_.asked.push(o || null); if (fs_.refuse || (o && o.screen && o.screen.refuse)) return Promise.reject(new TypeError('Permissions check failed')); fs_.el = root; document.fire('fullscreenchange'); return Promise.resolve(); };
  const window = listeners({ devicePixelRatio: opts.dpr || 1, screen: Object.assign({ width: 1920, height: 1080 }, opts.screen || {}), matchMedia: () => ({ matches: false, addEventListener() {} }), innerWidth: 1536, innerHeight: 864 });
  if (opts.monitors) window.getScreenDetails = () => (opts.monitors === 'deny' ? Promise.reject(new Error('denied')) : Promise.resolve({ screens: opts.monitors, currentScreen: opts.monitors[0], addEventListener() {} }));
  window.window = window;
  const bus = { _l: {}, seen: [], on(t, fn) { (this._l[t] = this._l[t] || []).push(fn); return () => {}; }, emit(t, d) { this.seen.push([t, d]); for (const fn of (this._l[t] || []).slice()) fn(d); } };
  const calls = [];
  const rec = (name) => (...a) => { calls.push([name, ...a]); return name === 'setTextureQuality' ? { changed: 0 } : undefined; };
  const preset = opts.preset || 'high';
  const engine = { preset: { name: preset, ao: preset === 'high' }, composer: preset === 'low' ? null : {}, renderer: {}, camera: { position: { x: 0, y: 6, z: 10 }, far: 3000 },
    resolutionInfo: Object.assign({ window: [1536, 864], ratio: 1.25, canvas: [1920, 1080], drawn: [1920, 1080], scale: 1, wanted: [1920, 1080], limit: null, dynamic: true }, opts.res || {}) };
  for (const m of ['setResolution', 'setBrightness', 'setEffects', 'setTextureQuality', 'setView', 'setFrameLimit', 'setOption', 'dof']) engine[m] = rec(m);
  const fx = {}; for (const m of ['setQuality', 'setRange', 'setSelfAlpha']) fx[m] = rec('fx.' + m);
  const settings = Object.assign({ easyMode: !!opts.easy }, opts.settings || {});
  const systems = [], toasts = [], warns = [];
  const G = { data: {}, sys: { engine, camera: { mode: 'follow', distance: 9 }, player: { position: { x: 0, y: 0, z: 0 } }, photo: { active: false } }, bus, settings, fx, state: null,
    settingsDefaults: {}, settingsRanges: {}, settingsEnums: {}, settingsDeviceKeys: new Set(), util: { clamp: (v, a, b) => Math.min(b, Math.max(a, v)) },
    setSetting(k, v) { settings[k] = v; bus.emit('settings:changed', { key: k, value: v }); }, register(s) { systems.push(s); G.sys[s.name] = s; },
    log: { warn(...a) { warns.push(a.map(String).join(' ')); }, error(...a) { warns.push(a.map(String).join(' ')); }, info() {}, debug() {} }, ui: { toast: (m) => { toasts.push(m); }, isBlocking: () => false },
    easy: { on: !!opts.easy }, input: { touchUI: !!opts.touch } };
  const navigator = { webdriver: !!opts.webdriver, keyboard: { lock(k) { fs_.locks.push(k); return Promise.resolve(); }, unlock() { fs_.locks.push('unlock'); } } };
  if (opts.permission) navigator.permissions = { query: () => Promise.resolve({ state: opts.permission }) };
  const ctx = vm.createContext({ G, window, document, console, Math, Number, Object, Map, Set, Array, String, JSON, Promise, Error, RegExp, Infinity, NaN, URLSearchParams, navigator, screen: window.screen,
    location: { search: opts.search || '' }, localStorage: { getItem: () => null, setItem() {} }, setTimeout, clearTimeout, performance: { now: () => 0 }, requestAnimationFrame: () => 0 });
  let registry = false;
  if (!opts.noRegistry) {
    try { vm.runInContext(fs.readFileSync(path.join(ROOT, 'src/game/68-settings.js'), 'utf8'), ctx, { filename: '68-settings.js' }); registry = typeof G.sys.settings?.define === 'function'; }
    catch (e) { registry = false; delete G.sys.settings; systems.length = 0; }
  }
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'src/game/67-display.js'), 'utf8'), ctx, { filename: '67-display.js' });
  systems.sort((a, b) => (a.order || 0) - (b.order || 0));
  for (const s of systems) if (s.init) s.init();
  await tick(); await tick();
  for (const s of systems) if (s.postInit) s.postInit();
  await tick();
  const last = (name) => { for (let i = calls.length - 1; i >= 0; i--) if (calls[i][0] === name) return calls[i].slice(1); return null; };
  const count = (name) => calls.filter((c) => c[0] === name).length;
  return { G, D: G.sys.display, S: G.sys.settings, registry, engine, calls, last, count, fs: fs_, body, root, document, window, bus, toasts, warns, tick, settings };
}
{
  const P = await systemPage();
  const { D, S, G } = P;
  // (warnings of the other lanes' rows in this small fake DOM are not ours to judge: only lines that name one of our rows count)
  const OURS = /ENGINE|display|resolution|windowMode|monitor|brightness|frameLimit|shot(Format|Quality)|(fx|tex|view)Quality|fxDistance|wideView|selfFxFade|\bdof\b|antialias|\bao\b|dynRes|grassDensity|crowdSize/;
  const ourWarns = P.warns.filter((w) => OURS.test(w));
  check('the display system registers itself (order 4, after the options registry at 3) and starts without an error', !!D && D.order === 4 && ourWarns.length === 0, ourWarns.join(' | '));
  check('the real options registry evaluates in this test and takes the rows', P.registry === true && !!S && S.has('brightness'), `registry ${P.registry}`);
  const mine = D.options(), ids = mine.map((d) => d.id);
  const WANT = ['resolution', 'resolutionInfo', 'windowMode', 'monitor', 'monitorFind', 'brightness', 'frameLimit', 'shotFormat', 'shotQuality', 'fxQuality', 'texQuality', 'viewQuality', 'fxDistance', 'wideView', 'selfFxFade', 'dof', 'antialias', 'ao', 'dynRes', 'grassDensity', 'crowdSize'];
  check('21 rows: 그래픽 해상도 … 스크린샷 화질 on the tab 화면, 이펙트 퀄리티 … 주변 사람 수 on the tab 그래픽', J(ids) === J(WANT) && mine.slice(0, 9).every((d) => d.tab === 'display') && mine.slice(9).every((d) => d.tab === 'graphics'), J(ids));
  const inReg = WANT.filter((id) => S.has(id));
  check('every row is in the registry', inReg.length === WANT.length, `${inReg.length} / ${WANT.length}`);
  // nothing the registry cuts: hint ≤ 200, label ≤ 60, group ≤ 40, choice ≤ 30, choice hint ≤ 120 characters
  const cut = [];
  for (const raw of mine) {
    const d = S.def(raw.id);
    if (!raw.hint || raw.hint.length > 200 || d.hint !== raw.hint) cut.push(`${raw.id}.hint(${(raw.hint || '').length})`);
    if (raw.label.length > 60 || d.label !== raw.label) cut.push(`${raw.id}.label`);
    if ((raw.group || '').length > 40) cut.push(`${raw.id}.group`);
    for (const o of raw.options || []) { if (String(o.l).length > 30) cut.push(`${raw.id}:${o.v}.l(${String(o.l).length})`); if (o.hint && o.hint.length > 120) cut.push(`${raw.id}:${o.v}.hint`); }
  }
  check('every row says in one line what it does, and the registry keeps the whole line (no text is cut)', cut.length === 0, cut.join(' '));
  // the server keeps ids /^[A-Za-z][A-Za-z0-9_]{0,39}$/ and, for ids it has no table row for, booleans, numbers within ±1e6 and words /^[A-Za-z0-9_.:\-]{0,40}$/
  const ID_RE = /^[A-Za-z][A-Za-z0-9_]{0,39}$/, WORD_RE = /^[A-Za-z0-9_.:\-]{0,40}$/, bad = [];
  const keeps = (v) => typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 1e6) || (typeof v === 'string' && WORD_RE.test(v));
  for (const d of mine) {
    if (d.type === 'info' || d.type === 'action') continue;
    if (!ID_RE.test(d.id) || d.key !== d.id) bad.push(d.id);
    const vals = d.type === 'toggle' ? [true, false] : d.type === 'slider' ? [d.min, d.max, d.default] : (S.def(d.id).options || []).map((o) => o.v).concat([d.default]);
    for (const v of vals) if (!keeps(v)) bad.push(`${d.id}=${J(v)}`);
  }
  for (const v of ['native', '3840x2160', '2560x1440', '1', '8']) if (!keeps(v)) bad.push(v);
  check('every id and every value an option can take is one the server keeps for the next login (Tfm\\UserSettings)', bad.length === 0, bad.join(' '));
  const scopes = Object.fromEntries(mine.filter((d) => d.scope).map((d) => [d.id, S.def(d.id).scope]));
  check('kept per device: size, window mode, monitor, brightness, qualities, frame limit · kept with the account: picture format and quality, 이펙트 투명화(자신)',
    ['resolution', 'windowMode', 'monitor', 'brightness', 'fxQuality', 'texQuality', 'viewQuality', 'frameLimit', 'fxDistance', 'wideView', 'dof', 'antialias', 'ao', 'dynRes', 'grassDensity', 'crowdSize'].every((id) => scopes[id] === 'device' && G.settingsDeviceKeys.has(id))
    && ['shotFormat', 'shotQuality', 'selfFxFade'].every((id) => scopes[id] === 'account'), J(scopes));
  // ---- the owner's defaults
  const dv = Object.fromEntries(WANT.filter((id) => !/Info|Find/.test(id)).map((id) => [id, S.get(id)]));
  check('defaults as the owner listed: 1920×1080 (Wide) · 창 모드 · 1 모니터 · 밝기 50 · 이펙트/텍스쳐/가시거리 높음 · 이펙트 가시거리 9 · 수직동기화 미선택 · 최대 시야 확장 선택 · 투명화 0 · DOF 미선택 · JPG',
    dv.resolution === '1920x1080' && dv.windowMode === 'window' && dv.monitor === 'auto' && dv.brightness === 50 && dv.fxQuality === 'high' && dv.texQuality === 'high' && dv.viewQuality === 'high' && dv.fxDistance === 9
    && dv.frameLimit === 'display' && dv.wideView === true && dv.selfFxFade === 0 && dv.dof === false && dv.shotFormat === 'jpg' && dv.shotQuality === 90 && dv.antialias === true && dv.ao === true && dv.dynRes === true && dv.grassDensity === 100 && dv.crowdSize === 'normal', J(dv));
  const lab = (id, v) => (S.def(id).options.find((o) => o.v === v) || {}).l;
  check('the words on the choices: "1920×1080 (Wide)", "창 모드", "1 모니터", "미선택 · 화면에 맞춤", "JPG", "높음"', /1920×1080 \(Wide\)/.test(lab('resolution', '1920x1080')) && lab('windowMode', 'window') === '창 모드' && lab('monitor', 'auto') === '1 모니터' && lab('frameLimit', 'display') === '미선택 · 화면에 맞춤' && lab('shotFormat', 'jpg') === 'JPG' && lab('viewQuality', 'high') === '높음',
    J([lab('resolution', '1920x1080'), lab('monitor', 'auto'), lab('frameLimit', 'display')]));
  check('이펙트 가시거리 has the steps 1 … 10, 이펙트 투명화(자신) the steps 0 … 5', J(S.def('fxDistance').options.map((o) => o.v)) === J([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) && J(S.def('selfFxFade').options.map((o) => o.v)) === J([0, 1, 2, 3, 4, 5]));
  // ---- what the start tells the engine
  check('at the start the engine gets: size 1920×1080, brightness 50, every effect, full textures, far plane 3000 m, no frame limit, AA / AO / auto size on',
    J(P.last('setResolution')) === J([{ w: 1920, h: 1080 }]) && J(P.last('setBrightness')) === J([50]) && J(P.last('setEffects')) === J([2]) && J(P.last('setTextureQuality')) === J([{ aniso: 16, cap: 0 }]) && P.last('setView')[0].far === 3000 && P.last('setView')[0].grass === 1
    && J(P.last('setFrameLimit')) === J([0]) && P.calls.some((c) => J(c) === J(['setOption', 'aa', true])) && P.calls.some((c) => J(c) === J(['setOption', 'ao', true])) && P.calls.some((c) => J(c) === J(['setOption', 'drs', true])),
    J([P.last('setResolution'), P.last('setBrightness'), P.last('setEffects'), P.last('setView')]));
  check('… and the effects: every particle, out to 118 m, the own effects fully visible', J(P.last('fx.setQuality')) === J([1]) && J(P.last('fx.setRange')) === J([118]) && J(P.last('fx.setSelfAlpha')) === J([1]));
  check('the honest line: 창 1536×864 · 그리는 크기 1920×1080', D.info() === '창 1536×864 · 그리는 크기 1920×1080', D.info());
  // ---- each option, through the registry (as the window does it)
  let n = P.count('setBrightness'); S.set('brightness', 80);
  check('화면 밝기 80 → engine.setBrightness(80), once', J(P.last('setBrightness')) === J([80]) && P.count('setBrightness') === n + 1 && S.get('brightness') === 80, `${P.count('setBrightness') - n} call(s)`);
  S.set('brightness', 83); check('the slider keeps its steps of 5 (83 → 85) and its ends (-20 → 0, 400 → 100)', S.get('brightness') === 85 && (S.set('brightness', -20), S.get('brightness')) === 0 && (S.set('brightness', 400), S.get('brightness')) === 100, String(S.get('brightness')));
  S.set('brightness', 50);
  S.set('fxQuality', 'low'); const fl = [P.last('setEffects')[0], P.last('fx.setQuality')[0]]; S.set('fxQuality', 'medium'); const fm = [P.last('setEffects')[0], P.last('fx.setQuality')[0]]; S.set('fxQuality', 'high');
  check('이펙트 퀄리티 낮음 / 보통 / 높음 → weather-effect level 0 / 1 / 2, particle share 0.4 / 0.7 / 1', J(fl) === J([0, 0.4]) && J(fm) === J([1, 0.7]) && J([P.last('setEffects')[0], P.last('fx.setQuality')[0]]) === J([2, 1]), J([fl, fm]));
  S.set('texQuality', 'low'); const tl = P.last('setTextureQuality')[0]; S.set('texQuality', 'medium'); const tm = P.last('setTextureQuality')[0]; S.set('texQuality', 'high');
  check('텍스쳐 퀄리티 낮음 / 보통 → anisotropy 1 / 4, size cap 256 / 384', J(tl) === J({ aniso: 1, cap: 256 }) && J(tm) === J({ aniso: 4, cap: 384 }), J([tl, tm]));
  S.set('viewQuality', 'low'); const vl = P.last('setView')[0]; S.set('wideView', false); const vl0 = P.last('setView')[0]; S.set('viewQuality', 'medium'); const vm0 = P.last('setView')[0]; S.set('viewQuality', 'high'); S.set('wideView', true);
  check('가시거리 퀄리티 낮음 → far plane 800 m (896 m with the wide view), more fog, nearer culling, thinner forests; 보통 → 1300 m', vl.far === 896 && vl0.far === 800 && vl0.fog === 1.35 && vl0.cull === 0.55 && vl0.veg === 0.6 && vm0.far === 1300 && P.last('setView')[0].far === 3000, J([vl, vl0, vm0]));
  check('최대 시야 확장 is what the camera reads (G.sys.display.wide)', D.wide === true && (S.set('wideView', false), D.wide) === false && (S.set('wideView', true), D.wide) === true);
  S.set('fxDistance', 1); const r1 = P.last('fx.setRange')[0]; S.set('fxDistance', 10); const r10 = P.last('fx.setRange')[0]; S.set('fxDistance', 9);
  check('이펙트 가시거리 1 → 8 m, 10 → 165 m, back to 9 → 118 m', r1 === 8 && r10 === 165 && P.last('fx.setRange')[0] === 118 && D.fxRange() === 118);
  S.set('frameLimit', '30'); const f30 = P.last('setFrameLimit')[0]; S.set('frameLimit', '60'); const f60 = P.last('setFrameLimit')[0]; S.set('frameLimit', 'display');
  check('프레임 제한 30 / 60 / 화면에 맞춤 → engine.setFrameLimit(30 / 60 / 0)', f30 === 30 && f60 === 60 && P.last('setFrameLimit')[0] === 0);
  const al = [0, 1, 2, 3, 4, 5].map((k) => (S.set('selfFxFade', k), P.last('fx.setSelfAlpha')[0])); S.set('selfFxFade', 0);
  check('이펙트 투명화(자신) 0 … 5 → 1, 0.8, 0.6, 0.42, 0.26, 0.1', J(al) === J([1, 0.8, 0.6, 0.42, 0.26, 0.1]), J(al));
  S.set('antialias', false); S.set('ao', false); S.set('dynRes', false);
  check('the switches: 안티에일리어싱 · 구석 그림자 · 자동 해상도 off → engine.setOption(aa / ao / drs, false)', ['aa', 'ao', 'drs'].every((k) => { for (let i = P.calls.length - 1; i >= 0; i--) if (P.calls[i][0] === 'setOption' && P.calls[i][1] === k) return P.calls[i][2] === false; return false; }));
  S.set('antialias', true); S.set('ao', true); S.set('dynRes', true);
  S.set('grassDensity', 40); check('풀 밀도 40 % → view.grass 0.4', P.last('setView')[0].grass === 0.4, J(P.last('setView')[0])); S.set('grassDensity', 100);
  S.set('resolution', '1280x720'); const rs = P.last('setResolution')[0]; S.set('resolution', 'auto'); const ra = P.last('setResolution')[0]; S.set('resolution', '9999x9999');
  check('그래픽 해상도 1280×720 → that size; 자동 → null (the preset\'s own ratio); a size the monitor does not offer falls back to the default', J(rs) === J({ w: 1280, h: 720 }) && ra === null && S.get('resolution') === '1920x1080', J([rs, ra, S.get('resolution')]));
  // ---- pictures
  check('스크린샷 포맷: JPG at 90 % by default; PNG always at its best; WebP falls back to JPG where the browser cannot write it', J(D.shot()) === J({ format: 'jpg', mime: 'image/jpeg', ext: 'jpg', quality: 0.9 })
    && (S.set('shotFormat', 'png'), J(D.shot())) === J({ format: 'png', mime: 'image/png', ext: 'png', quality: 1 }) && S.available('shotQuality') !== true && (S.set('shotFormat', 'webp'), D.shot().format) === 'jpg', J(D.shot()));
  S.set('shotFormat', 'jpg'); S.set('shotQuality', 60); check('스크린샷 화질 60 % → 0.6', D.shot().quality === 0.6 && S.available('shotQuality') === true); S.set('shotQuality', 90);
  // ---- DOF while playing, the wide zoom-out
  S.set('dof', true); D.update(0.016); const d1 = P.last('dof')[0];
  check('DOF on: the focus sits on the character (camera distance), the far background softens', d1 && near(d1.focus, Math.hypot(0, 5, 10), 1e-9) && d1.amount === 0.55 && d1.range > 6, J(d1));
  S.set('dof', false); D.update(0.016); check('DOF off: the engine is told once (dof(null))', P.last('dof')[0] === null);
  n = P.count('setView'); G.sys.camera.distance = 30; D.update(0.016); const z = P.last('setView')[0];
  check('zoomed all the way out in the wide view: the fog thins a little (× 0.94) so the place round the character stays clear', P.count('setView') === n + 1 && near(z.fog, 0.94, 1e-9) && z.far === undefined, J(z));
  G.sys.camera.distance = 9; D.update(0.016);
  // ---- the people round you
  const soc = { _farDist() { return 40; } }; G.sys.social = soc; S.set('crowdSize', 'few'); const few = soc._farDist(); S.set('crowdSize', 'many'); const many = soc._farDist(); S.set('crowdSize', 'normal');
  check('주변 사람 수 적게 / 많이: the distance of fully drawn visitors × 0.6 / × 1.5 (crowdScale for modules that read it themselves)', few === 24 && many === 60 && soc._farDist() === 40 && D.crowdScale === 1, J([few, many]));
  // ---- full screen needs a press: granted → no chip
  S.set('windowMode', 'fullscreen'); await P.tick(); await P.tick();
  check('화면 모드 전체 화면 (a press on the option): requestFullscreen on the page, the keys W A S D T N kept, event display:fullscreen', P.fs.asked.length === 1 && D.fullscreen === true && J(P.fs.locks[0]) === J(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyT', 'KeyN']) && P.bus.seen.some(([t, d]) => t === 'display:fullscreen' && d.on === true), J([P.fs.asked.length, D.fullscreen]));
  // left with Esc: the wish stands, the chip offers the way back
  G.state = {}; P.fs.el = null; P.document.fire('fullscreenchange'); await P.tick();
  const chip = () => P.body.children.find((c) => c.id === 'display-fs-chip');
  check('left with Esc while the wish stands: the chip "🖥️ 전체 화면으로 보기" with ✕, both with a voice line', !!chip() && !chip().hidden && chip().children[0].textContent === '🖥️ 전체 화면으로 보기' && !!chip().children[0].dataset.say && chip().children[1].textContent === '✕' && !!chip().children[1].dataset.say && chip().children[1].attrs['aria-label'] === '창 모드로 두기' && S.get('windowMode') === 'fullscreen');
  chip().children[0].click(); await P.tick(); await P.tick();
  check('a press on the chip goes full screen again and the chip leaves', D.fullscreen === true && chip().hidden === true && P.fs.asked.length === 2);
  check('the key (F): out of full screen and the option says 창 모드', D.toggleFullscreen('key') === false && (await P.tick(), S.get('windowMode')) === 'window' && D.fullscreen === false && P.fs.locks.includes('unlock'));
}
{
  // the saved wish at the next visit: the browser refuses without a press → the chip; ✕ = window mode
  const P = await systemPage({ settings: { windowMode: 'fullscreen' }, refuseFs: true, easy: true });
  const { D, S, G } = P;
  const chip = () => P.body.children.find((c) => c.id === 'display-fs-chip');
  check('a saved 전체 화면 at the next visit: asked once, refused (no press yet), nothing shown before the game runs', P.fs.asked.length === 1 && D.fullscreen === false && (!chip() || chip().hidden), `asked ${P.fs.asked.length}`);
  G.state = {}; G.bus.emit('state:loaded', {});
  check('… after login the chip offers it (easy mode: 56 px tall, 18 px letters)', !!chip() && !chip().hidden && chip().children[0].style.minHeight === '56px' && chip().children[1].style.minWidth === '56px' && /18px/.test(chip().children[0].style.font), chip() ? J(chip().children[0].style) : 'no chip');
  P.fs.refuse = false; chip().children[1].click(); await P.tick();
  check('✕ on the chip: 창 모드 is kept as the choice, the chip leaves', S.get('windowMode') === 'window' && chip().hidden === true);
  D.onLogout();
}
{
  // `low`: no post chain — the options that need it say why, the others still work
  const P = await systemPage({ preset: 'low' });
  const { S } = P;
  const why = (id) => S.available(id);
  check('on 낮음: DOF · 안티에일리어싱 · 자동 해상도 say that 낮음 has no extra processing; 구석 그림자 needs 높음; 텍스쳐 · 풀 밀도 say nothing would change',
    [why('dof'), why('antialias'), why('dynRes')].every((w) => typeof w === 'string' && /낮음/.test(w)) && /높음/.test(why('ao')) && /낮음/.test(why('texQuality')) && /낮음/.test(why('grassDensity')) && why('brightness') === true && why('viewQuality') === true && why('resolution') === true, J([why('dof'), why('ao')]));
  S.set('dof', true); P.D.update(0.016);
  check('on 낮음 a stored DOF does nothing (no composer)', P.count('dof') === 0);
}
{
  // the monitors
  const one = await systemPage();
  check('출력될 모니터 without the browser feature: "1 모니터", disabled with the reason, 모니터 찾기 says so too', one.D.screens().state === 'unsupported' && J(one.S.def('monitor').options.map((o) => o.l)) === J(['1 모니터']) && /기능이 없어요/.test(one.S.available('monitor')) && /없어요/.test(one.S.available('monitorFind')), String(one.S.available('monitor')));
  const mons = [{ width: 1920, height: 1080, isPrimary: true, label: 'A' }, { width: 2560, height: 1440, isPrimary: false, label: 'B' }];
  const two = await systemPage({ monitors: mons, settings: { monitor: '2' } });
  check('before the player allows it: one choice, the reason "모니터 찾기를 누르고 허락하면 …"', two.D.screens().state === 'ask' && /모니터 찾기/.test(two.S.available('monitor')) && two.S.available('monitorFind') === true, String(two.S.available('monitor')));
  const st = await two.D.findScreens();
  check('모니터 찾기 (allowed): "1 모니터 · 1920×1080 (주 모니터)", "2 모니터 · 2560×1440" can be chosen', st === 'ready' && two.S.available('monitor') === true && J(two.S.def('monitor').options.map((o) => o.l)) === J(['지금 창이 있는 모니터', '1 모니터 · 1920×1080 (주 모니터)', '2 모니터 · 2560×1440']) && J(two.G.settingsEnums.monitor) === J(['auto', '1', '2']), J(two.S.def('monitor').options.map((o) => o.l)));
  two.S.set('monitor', '2'); two.S.set('windowMode', 'fullscreen'); await two.tick(); await two.tick();
  check('전체 화면 with 2 모니터 chosen: requestFullscreen({ screen: that monitor })', two.fs.asked.length === 1 && two.fs.asked[0].screen === mons[1] && two.D.fullscreen === true);
  const gone = await systemPage({ monitors: [{ width: 1920, height: 1080, isPrimary: true }, { width: 1280, height: 1024, refuse: true }], settings: { monitor: '2' } });
  await gone.D.findScreens(); gone.S.set('monitor', '2'); gone.S.set('windowMode', 'fullscreen'); await gone.tick(); await gone.tick(); await gone.tick();
  check('a chosen monitor the browser refuses: full screen on the monitor of the window instead', gone.fs.asked.length === 2 && !gone.fs.asked[1].screen && gone.D.fullscreen === true, `asked ${gone.fs.asked.length}`);
  const deny = await systemPage({ monitors: 'deny' }); const ds = await deny.D.findScreens();
  check('not allowed: the row says where to allow it', ds === 'denied' && /허락하지 않았어요/.test(deny.S.available('monitor')), String(deny.S.available('monitor')));
  const granted = await systemPage({ monitors: mons, permission: 'granted' }); await granted.tick(); await granted.tick();
  check('allowed at an earlier visit: the monitors are there at the start without a question', granted.D.screens().state === 'ready' && granted.S.def('monitor').options.length === 3);
}
{
  // other devices and starts
  const auto = await systemPage({ webdriver: true }), asked = await systemPage({ webdriver: true, search: '?wide=1' }), off = await systemPage({ search: '?wide=0' });
  check('automation (navigator.webdriver) keeps the 55° view unless ?wide=1 — the measured budgets of the older suites stay comparable', auto.S.get('wideView') === false && auto.D.wide === false && asked.S.get('wideView') === true && off.S.get('wideView') === false);
  const phone = await systemPage({ touch: true, screen: { width: 390, height: 844 }, dpr: 3 });
  check('a phone: 그래픽 해상도 자동 (the preset\'s own ratio), no chip, the same rows', phone.S.get('resolution') === 'auto' && phone.last('setResolution')[0] === null && phone.D.options().length === 21, J(phone.S.get('resolution')));
  const small = await systemPage({ screen: { width: 1366, height: 768 } });
  check('a 1366×768 monitor: the default is its own size, nothing larger is offered', small.S.get('resolution') === '1366x768' && !small.S.def('resolution').options.some((o) => o.v === '1920x1080'));
  const noFs = await systemPage({ noFs: true });
  check('a browser without full screen: 화면 모드 says so', /지원하지 않아요/.test(noFs.S.available('windowMode')));
  // without the registry: the rows wait in G.settingsQueue and a written key still applies
  const bare = await systemPage({ noRegistry: true });
  bare.G.setSetting('brightness', 20); bare.G.setSetting('viewQuality', 'low');
  check('without the options registry: 21 rows wait in G.settingsQueue, and G.setSetting(key) still reaches the engine', bare.registry === false && bare.G.settingsQueue.length === 21 && J(bare.last('setBrightness')) === J([20]) && bare.last('setView')[0].far === 896 && bare.D.get('fxDistance') === 9, `${bare.G.settingsQueue.length} rows`);
}

const failed = results.filter((r) => !r.ok);
if (process.argv.includes('--json')) console.log(JSON.stringify({ pass: results.length - failed.length, fail: failed.length, results }, null, 1));
else console.log(`\n${results.length - failed.length} / ${results.length} passed`);
process.exit(failed.length ? 1 : 0);
