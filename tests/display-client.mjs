#!/usr/bin/env node
// =============================================================================
// tests/display-client.mjs — CONTRACT §18.2 (lane gfx) in the browser (LOCAL mode, file:// page, software WebGL):
// every graphics / system option changes what it says it changes, measured on the engine and on drawn frames.
//   low page     the rows of the settings window · 그래픽 해상도 (drawing-buffer size, the honest line) · 화면 밝기 on `low`
//                (a CSS filter, the frame itself untouched, the watchdog quiet) · the frame limit with a fake clock ·
//                가시거리 퀄리티 (far plane, fog factor, cull distance; a room keeps its own far plane) · 최대 시야 확장
//                (field of view, zoom-out) · 이펙트 퀄리티 / 가시거리 / 투명화 (particle counts, the distance gate) ·
//                스크린샷 포맷 (blob types, the album picture) · 화면 모드 (F key, the chip for a saved wish) · 출력될 모니터 ·
//                DOF says why it cannot run on `low` · the zoom keys · every value survives a reload
//   medium page  화면 밝기 through the output pass (mean brightness 0 < 50 < 100, by day and by night; black / white
//                shares and the watchdog unchanged) · anti-aliasing (MSAA samples) · dynamic resolution · DOF · a
//                chosen size on a device ratio of 2 · forest levels and grass density · weather-effect cap · anisotropy
//   high page    (--shots <dir>) ambient shadow switch, then before / after pictures: brightness 0 / 50 / 100 by day,
//                0 / 100 by night, view distance 높음 / 낮음, field of view 55° / 70°, effect distance 2 / 10, DOF
//
//   node tests/display-client.mjs                        builds a private page (--no-assets) in a temp directory
//   node tests/display-client.mjs --file /abs/page.html  test an already built page
//   options: --json · --headed · --timeout <ms> · --only <a,b> (groups: rows, resolution, brightness, frame, view, wide,
//            fx, photo, window, persist, medium, high) · --skip-medium · --shots <dir> (the high page + pictures) ·
//            --shots-file <page> (a page WITH the asset pack for the pictures) · --shot-size 1280x720
//   Run it through the shared browser lock (at most two browsers on the build machine).
// Exit 0 = all passed, 1 = a check failed, 2 = could not run.
// =============================================================================
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); }
catch {
  try { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
  catch { console.error('playwright 가 필요해요 (npm install)'); process.exit(2); }
}
const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n, d = null) => { const i = args.indexOf(n); return i >= 0 && i + 1 < args.length ? args[i + 1] : d; };
const TIMEOUT = Number(opt('--timeout', '420000'));
const jsonOut = flag('--json');
const only = (opt('--only', '') || '').split(',').filter(Boolean);
const want = (g) => !only.length || only.includes(g);
const log = (...a) => { if (!jsonOut) console.log(...a); };
const SHOTS = opt('--shots');
const [SW, SH] = String(opt('--shot-size', '1280x720')).split('x').map(Number);

let file = opt('--file');
if (!file) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tfm-display-'));
  file = path.join(tmp, 'index.html');
  const b = spawnSync(process.execPath, [path.join(ROOT, 'tools/build.mjs'), '--no-font', '--quiet', '--no-assets', '--out', file], { encoding: 'utf8' });
  if (b.status !== 0) { console.error(b.stderr || b.stdout); process.exit(2); }
}
if (!fs.existsSync(file)) { console.error(`page not found: ${file}`); process.exit(2); }
const shotsFile = opt('--shots-file', file);
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });

const results = [], numbers = {};
// (lazy checks) a check may get functions: a condition that cannot be judged (a missing measurement) is a failed check with
// the reason, and the run goes on to the next one
const check = (name, okIn, detailIn = '') => {
  let ok = false, detail = '';
  try { ok = typeof okIn === 'function' ? okIn() : okIn; } catch (e) { ok = false; detail = `could not be judged: ${String(e && e.message || e).slice(0, 200)}`; }
  if (detail === '') { try { detail = typeof detailIn === 'function' ? detailIn() : detailIn; } catch (e) { detail = ''; } }
  results.push({ name, ok: !!ok, detail: String(detail ?? '').slice(0, 600) }); log(`${ok ? '  ✔' : '  ✖'} ${name}${detail !== '' && detail != null ? ` — ${String(detail).slice(0, 400)}` : ''}`); };
const J = (v) => JSON.stringify(v);

const browser = await chromium.launch({ headless: !flag('--headed'), args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--autoplay-policy=no-user-gesture-required'] });
const pageErrors = [], consoleErrors = [];
async function open(tag, ctxOpts) {
  const context = await browser.newContext({ locale: 'ko-KR', timezoneId: 'Asia/Seoul', viewport: { width: 1280, height: 720 }, screen: { width: 1920, height: 1080 }, ...ctxOpts });
  const page = await context.newPage();
  await page.route('**/*', (route) => (/^(file|data|blob):/.test(route.request().url()) ? route.continue() : route.abort()));
  page.on('pageerror', (e) => pageErrors.push(`[${tag}] ${String(e?.message || e).slice(0, 300)}`));
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(`[${tag}] ${m.text().slice(0, 300)}`); });
  return { page, context };
}
async function boot(page, quality, extra = '', src = file) {
  await page.goto(`${pathToFileURL(src).href}?autostart=1&notutorial=1&quality=${quality}${extra}`, { waitUntil: 'load', timeout: TIMEOUT });
  await page.waitForFunction(() => window.G && window.G.ready === true && !!window.G.state && !!window.G.sys?.player?._ready, null, { timeout: TIMEOUT, polling: 250 });
  await page.evaluate(() => { try { G.ui.modal.closeAll(); } catch (e) { /* nothing open */ } });
  await page.evaluate(HELPERS);
}

/** in-page helpers */
const HELPERS = () => {
  const raf = () => new Promise((r) => requestAnimationFrame(() => r()));
  const E = () => G.sys.engine;
  window.__dt = {
    raf,
    async frames(n) { for (let i = 0; i < n; i++) await raf(); },
    async wait(ms) { const t0 = performance.now(); while (performance.now() - t0 < ms) await raf(); },
    async ready(maxWall = 90000) {
      const t0 = performance.now();
      while (performance.now() - t0 < maxWall) {
        try { G.ui.modal.closeAll(); } catch (e) { /* none */ }
        if (G.input.gameplay() && G.sys.player._ready && !G.sys.manjangdae?.introActive && G.sys.camera?.mode === 'follow') return true;
        await raf();
      }
      return false;
    },
    set(id, v) { return G.sys.display.set(id, v); },
    get(id) { return G.sys.display.get(id); },
    /** a fresh frame, read in the same task: mean brightness and the shares the watchdog would call black / white */
    luma() {
      E().render({ force: true });
      const src = E().renderer.domElement, c = document.createElement('canvas');
      c.width = 192; c.height = 108;
      const x = c.getContext('2d', { willReadFrequently: true });
      x.drawImage(src, 0, 0, c.width, c.height);
      const d = x.getImageData(0, 0, c.width, c.height).data, n = d.length / 4;
      let s = 0, b = 0, w = 0;
      for (let i = 0; i < d.length; i += 4) { const r = d[i], g = d[i + 1], bl = d[i + 2]; s += 0.2126 * r + 0.7152 * g + 0.0722 * bl; if (r < 6 && g < 6 && bl < 6) b++; if (r > 250 && g > 250 && bl > 250) w++; }
      return { mean: +(s / n).toFixed(2), black: +(b / n).toFixed(4), white: +(w / n).toFixed(4) };
    },
    /** the watchdog's own probe of a fresh frame */
    probe() { const W = G.gfx.guard.watchdog, r = W.probeNow(); return r ? { black: +r.black.toFixed(4), white: +r.white.toFixed(4), anomaly: !!r.anomaly, state: W.state, step: W.step } : null; },
    calm() { const W = G.gfx.guard.watchdog; W.suspect = 0; if (W.step === 0) W.state = 'watching'; },
    async view(x, z, rot, hour) {
      try { const w = G.sys.weather; w.setLockTime(true); w.setAuto(false); w.setHour(hour); const ids = Object.keys(G.data.weather || {}); const clear = ids.find((i) => /CLEAR|SUNNY|FINE/i.test(i)) || ids[0]; if (clear) w.set(clear, { instant: true }); } catch (e) { /* weather optional */ }
      await G.sys.player.teleport(x, z, rot, { fade: false });
      G.sys.camera.behind(rot, true); G.sys.camera.snap();
    },
    frame() { E().render({ force: true }); const f = E().frameInfo; return { calls: f.calls, tris: f.triangles }; },
    info() { return JSON.parse(JSON.stringify(E().displayInfo)); },
  };
  return true;
};

// ============================================================================================== low page
async function lowPage() {
  const { page, context } = await open('low');
  await boot(page, 'low');
  await page.evaluate(() => window.__dt.ready());
  // ------------------------------------------------------------------------------------------------ the rows
  if (want('rows')) try {
    const r = await page.evaluate(() => {
      const D = G.sys.display, rows = D.options(), S = G.sys.settings;
      const need = ['resolution', 'windowMode', 'monitor', 'brightness', 'fxQuality', 'texQuality', 'viewQuality', 'fxDistance', 'frameLimit', 'wideView', 'selfFxFade', 'dof', 'shotFormat', 'shotQuality', 'antialias', 'ao', 'dynRes', 'grassDensity', 'crowdSize'];
      const by = Object.fromEntries(rows.map((d) => [d.id, d]));
      return {
        missing: need.filter((id) => !by[id]), noHint: rows.filter((d) => !d.hint || d.hint.length < 12 || !/[가-힣]/.test(d.label)).map((d) => d.id),
        defaults: Object.fromEntries(need.map((id) => [id, D.get(id)])), resList: by.resolution ? by.resolution.options.map((o) => o.v) : [],
        fd: by.fxDistance ? [by.fxDistance.min, by.fxDistance.max] : null, sf: by.selfFxFade ? [by.selfFxFade.min, by.selfFxFade.max] : null,
        registry: S && typeof S.has === 'function' ? need.filter((id) => !S.has(id)) : 'no registry in this page', keys: S && S.has ? ['key_jump', 'key_mouseToggle', 'key_bag'].filter((id) => !S.has(id)) : [],
        info: D.info(), wideDefault: D.defaults.wideView, quality: G.sys.engine.quality,
      };
    });
    numbers.rows = r;
    check('every option of the owner\'s list has a row (label in Korean, one line that says what it costs or saves)', () => (r.missing.length === 0 && r.noHint.length === 0), () => (`missing ${J(r.missing)} · weak ${J(r.noHint)}`));
    const d = r.defaults;
    check('defaults as listed: 1920×1080 · 창 모드 · 밝기 50 · 퀄리티 높음 · 이펙트 가시거리 9 · JPG · 수직동기화 미선택 · 투명화 0 · DOF 미선택',
      d.resolution === '1920x1080' && d.windowMode === 'window' && d.brightness === 50 && d.fxQuality === 'high' && d.texQuality === 'high' && d.viewQuality === 'high' && d.fxDistance === 9 && d.shotFormat === 'jpg' && d.frameLimit === 'display' && d.selfFxFade === 0 && d.dof === false, J(d));
    check('최대 시야 확장: on for people, off under automation unless ?wide=1 (the 55° budgets stay comparable)', () => (r.wideDefault === false && d.wideView === false), () => (`${r.wideDefault}`));
    check('이펙트 가시거리 1 … 10 and 이펙트 투명화(자신) 0 … 5', () => (J(r.fd) === J([1, 10]) && J(r.sf) === J([0, 5])));
    check('the list of sizes comes from the monitor (1920×1080 here): nothing larger is offered', () => (J(r.resList) === J(['auto', '1920x1080', '1600x900', '1366x768', '1280x720', '960x540'])), () => (J(r.resList)));
    if (Array.isArray(r.registry)) check('the options registry knows every row (and the key rows of the bindings)', r.registry.length === 0 && r.keys.length === 0, `${J(r.registry)} ${J(r.keys)}`);
    else log(`  · ${r.registry}`);
  } catch (e) { check('[low] the group "rows" ran to its end', false, String(e && e.message || e).slice(0, 400)); }   // (group isolation)
  // ------------------------------------------------------------------------------------------------ resolution
  if (want('resolution')) try {
    const r = await page.evaluate(async () => {
      const H = window.__dt, E = G.sys.engine, cv = E.renderer.domElement, out = {};
      const at = async (v) => { H.set('resolution', v); await H.frames(2); return { canvas: [cv.width, cv.height], info: E.resolutionInfo, line: G.sys.display.info() }; };
      out.def = await at('1920x1080');     // window 1280×720, device ratio 1: the screen's own pixels are the limit
      out.small = await at('960x540');
      out.auto = await at('auto');
      out.mid = await at('1280x720');
      out.css = [cv.clientWidth, cv.clientHeight];
      out.back = await at('1920x1080');
      return out;
    });
    numbers.resolution = r;
    check('그래픽 해상도 960×540 in a 1280×720 window: the drawing buffer IS 960×540 (stretched over the window)', () => (J(r.small.canvas) === J([960, 540]) && J(r.css) === J([1280, 720]) && Math.abs(r.small.info.ratio - 0.75) < 1e-6), () => (`${J(r.small.canvas)} css ${J(r.css)}`));
    check('1280×720 and 자동 draw the window\'s own 1280×720', () => (J(r.mid.canvas) === J([1280, 720]) && J(r.auto.canvas) === J([1280, 720])));
    check('1920×1080 cannot exceed this window\'s pixels: 1280×720, and the line says so', () => (J(r.def.canvas) === J([1280, 720]) && r.def.info.limit === 'screen' && /창 1280×720 · 그리는 크기 1280×720/.test(r.def.line)), () => (r.def.line));
    check('the honest line: "창 1280×720 · 그리는 크기 960×540"', () => (r.small.line === '창 1280×720 · 그리는 크기 960×540'), () => (r.small.line));
  } catch (e) { check('[low] the group "resolution" ran to its end', false, String(e && e.message || e).slice(0, 400)); }   // (group isolation)
  // ------------------------------------------------------------------------------------------------ brightness on low
  if (want('brightness')) try {
    const r = await page.evaluate(async () => {
      const H = window.__dt, E = G.sys.engine, cv = E.renderer.domElement, out = {};
      await H.view(0, 14, Math.PI, 10); await H.wait(1500);
      const at = async (b) => { H.set('brightness', b); await H.frames(2); H.calm(); const p1 = H.probe(), p2 = H.probe(); return { filter: cv.style.filter, path: E.brightnessInfo.path, luma: H.luma(), p1, p2 }; };
      out.b50 = await at(50); out.b0 = await at(0); out.b100 = await at(100); out.back = await at(50);
      out.composer = !!E.composer;
      return out;
    });
    numbers.brightnessLow = r;
    check('밝기 on `low`: a CSS filter on the canvas (0 → brightness(0.620), 100 → brightness(1.400)), none at 50', () => (!r.composer && r.b0.filter === 'brightness(0.620)' && r.b100.filter === 'brightness(1.400)' && r.b50.filter === '' && r.back.filter === '' && r.b0.path === 'css' && r.b50.path === 'none'), () => (J([r.b0.filter, r.b50.filter, r.b100.filter])));
    check('… the frame itself is the same frame (low stays frozen): mean brightness within 1.5 of 255', () => (Math.abs(r.b0.luma.mean - r.b50.luma.mean) < 1.5 && Math.abs(r.b100.luma.mean - r.b50.luma.mean) < 1.5), () => (J([r.b0.luma.mean, r.b50.luma.mean, r.b100.luma.mean])));
    check('… and the watchdog stays quiet at 0, 50 and 100', () => ([r.b0, r.b50, r.b100].every((x) => x.p1 && !x.p1.anomaly && !x.p2.anomaly && x.p2.step === 0)), () => (J([r.b0.p2, r.b100.p2])));
  } catch (e) { check('[low] the group "brightness" ran to its end', false, String(e && e.message || e).slice(0, 400)); }   // (group isolation)
  // ------------------------------------------------------------------------------------------------ frame limit
  if (want('frame')) try {
    const r = await page.evaluate(async () => {
      const H = window.__dt, E = G.sys.engine, out = {};
      // through the option: the engine takes the limit
      H.set('frameLimit', '30'); out.opt30 = E.frameLimit.fps; H.set('frameLimit', '60'); out.opt60 = E.frameLimit.fps; H.set('frameLimit', 'display'); out.optOff = E.frameLimit.fps;
      // pacing with a fake clock: the engine's own render() is called the way the loop calls it, 120 display frames at 60 Hz
      const run = (limit, hz, n) => { let t = 5000; E.setFrameLimit(limit, () => t); const d0 = E.frameLimit.drawn; for (let i = 0; i < n; i++) { E.render(0.016); t += 1000 / hz; } const d = E.frameLimit.drawn - d0; E.setFrameLimit(0, null); return d; };
      out.l30 = run(30, 60, 60); out.l60 = run(60, 60, 30); out.l60on144 = run(60, 144, 72); out.off = run(0, 60, 10);
      // a forced frame (a photo, the watchdog) is never held back
      let t = 9000; E.setFrameLimit(30, () => t); const d0 = E.frameLimit.drawn; E.render({ force: true }); E.render({ force: true }); out.forced = E.frameLimit.drawn - d0; E.setFrameLimit(0, null);
      H.set('frameLimit', 'display');
      await H.frames(2);
      return out;
    });
    numbers.frame = r;
    check('수직동기화 · 프레임 제한: the choices reach the engine (30 · 60 · 화면에 맞춤 = no limit)', () => (r.opt30 === 30 && r.opt60 === 60 && r.optOff === 0), () => (J(r)));
    check('limit 30 with a fake 60 Hz clock: 30 of 60 display frames are drawn', () => (Math.abs(r.l30 - 30) <= 1), () => (r.l30));
    check('limit 60 on 60 Hz draws all 30 of 30; on 144 Hz it draws 30 of 72; no limit draws all', () => (Math.abs(r.l60 - 30) <= 1 && Math.abs(r.l60on144 - 30) <= 2 && r.off === 10), () => (J([r.l60, r.l60on144, r.off])));
    check('a forced frame (photo, watchdog probe) is never held back', () => (r.forced === 2), () => (r.forced));
  } catch (e) { check('[low] the group "frame" ran to its end', false, String(e && e.message || e).slice(0, 400)); }   // (group isolation)
  // ------------------------------------------------------------------------------------------------ view distance
  if (want('view')) try {
    const r = await page.evaluate(async () => {
      const H = window.__dt, E = G.sys.engine, out = {};
      await H.view(52, 109.4, Math.PI, 10); await H.wait(1500);
      const at = async (v) => { H.set('viewQuality', v); await H.wait(700); const f = H.frame(); return { far: E.camera.far, fog: +E.viewFog.toFixed(3), cull: E.cullStats.dist, culled: E.cullStats.culled, calls: f.calls, tris: f.tris }; };
      out.high = await at('high'); out.low = await at('low'); out.medium = await at('medium');
      // a room keeps its own, shorter far plane; leaving puts the player's back
      H.set('viewQuality', 'low');
      const P = G.sys.places, ids = (P.list() || []).map((d) => (d && d.id) || d).filter((x) => typeof x === 'string');
      const room = ids.includes('PL_DAECHEONG') ? 'PL_DAECHEONG' : ids.find((id) => P.def(id) && P.def(id).far <= 300);
      out.room = room || null;
      if (room) {
        try { await P.enter(room, { fade: false }); await H.frames(3); out.roomFar = E.camera.far; out.roomDef = P.def(room).far; out.roomFog = E.viewFog; await P.exit({ fade: false }); await H.frames(3); out.afterFar = E.camera.far; }
        catch (e) { out.roomErr = String(e && e.message || e); }
      }
      H.set('viewQuality', 'high'); await H.frames(3);
      out.end = { far: E.camera.far, fog: E.viewFog };
      return out;
    });
    numbers.view = r;
    check('가시거리 퀄리티: far plane 3000 / 1300 / 800 m', () => (r.high.far === 3000 && r.medium.far === 1300 && r.low.far === 800), () => (J([r.high.far, r.medium.far, r.low.far])));
    check('… the fog thickens as the far plane comes in (factor 1 → ≥ 1.15 → ≥ 1.35), so nothing is cut in view', () => (r.high.fog === 1 && r.medium.fog >= 1.15 && r.low.fog >= 1.35 && r.low.fog >= r.medium.fog), () => (J([r.high.fog, r.medium.fog, r.low.fog])));
    check('… small scenery is culled nearer (72 m → 54 m → 39.6 m on `low`) and the frame does not get heavier', () => (Math.abs(r.high.cull - 72) < 0.01 && Math.abs(r.medium.cull - 54) < 0.01 && Math.abs(r.low.cull - 39.6) < 0.01 && r.low.calls <= r.high.calls && r.low.tris <= r.high.tris), () => (`calls ${r.high.calls} → ${r.low.calls}, triangles ${r.high.tris} → ${r.low.tris}, culled ${r.high.culled} → ${r.low.culled}`));
    if (r.room && !r.roomErr) check(`a room (${r.room}) keeps its own far plane (${r.roomDef} m) and its own air; leaving puts 800 m back`, r.roomFar === Math.min(r.roomDef, 800) && r.roomFog === 1 && r.afterFar === 800, J([r.roomFar, r.roomFog, r.afterFar]));
    else check('a room to walk into for the far-plane check', false, r.roomErr || 'no place found');
    check('높음 again: 3000 m, fog factor 1', () => (r.end.far === 3000 && r.end.fog === 1));
  } catch (e) { check('[low] the group "view" ran to its end', false, String(e && e.message || e).slice(0, 400)); }   // (group isolation)
  // ------------------------------------------------------------------------------------------------ wide view
  if (want('wide')) try {
    const r = await page.evaluate(async () => {
      const H = window.__dt, E = G.sys.engine, cam = G.sys.camera, el = document.getElementById('game-container'), out = {};
      await H.view(0, 14, Math.PI, 10);
      const spin = async (dy, n) => { for (let i = 0; i < n; i++) { el.dispatchEvent(new WheelEvent('wheel', { deltaY: dy, bubbles: true, cancelable: true })); await H.raf(); } await H.wait(300); return cam._distT; };
      const settle = async (target) => { const t0 = performance.now(); await H.raf(); while (Math.abs(E.camera.fov - target) > 0.2 && performance.now() - t0 < 40000) await H.raf(); return +E.camera.fov.toFixed(2); };
      out.easy = G.easy?.on;
      out.fov0 = await settle(55); out.max0 = await spin(240, 50);
      H.set('wideView', true);
      out.fov1 = await settle(70); out.max1 = await spin(240, 50); out.wide = G.sys.display.wide;
      G.setSetting('easyMode', false); await H.wait(300);
      out.maxN1 = await spin(240, 70);
      H.set('wideView', false); await H.wait(400);
      out.maxN0 = cam._distT; out.fov2 = await settle(55);
      G.setSetting('easyMode', true); await H.wait(300);
      out.maxE0 = cam._distT;
      await spin(-240, 20);
      // a scripted shot keeps its own field of view whatever the option says
      H.set('wideView', true); cam.shot({ x: 0, y: 20, z: 40 }, { x: 0, y: 0, z: 0 }, { fov: 48, duration: 0 }); out.shotFov = await settle(48);
      cam.setMode('follow'); H.set('wideView', false); await H.wait(600);
      return out;
    });
    numbers.wide = r;
    check('최대 시야 확장: the follow view opens from 55° to 70°, and back', () => (Math.abs(r.fov0 - 55) < 0.6 && Math.abs(r.fov1 - 70) < 0.8 && Math.abs(r.fov2 - 55) < 0.8 && r.wide === true), () => (J([r.fov0, r.fov1, r.fov2])));
    check('… the wheel zooms out further: easy mode 12.5 → 16 m, normal mode 22 → 30 m; off brings a far camera back in', () => (Math.abs(r.max0 - 12.5) < 0.01 && Math.abs(r.max1 - 16) < 0.01 && Math.abs(r.maxN1 - 30) < 0.01 && Math.abs(r.maxN0 - 22) < 0.01 && r.maxE0 <= 12.51), () => (J([r.max0, r.max1, r.maxN1, r.maxN0, r.maxE0])));
    check('… scripted shots keep their own field of view (48° stays 48°)', () => (Math.abs(r.shotFov - 48) < 0.6), () => (r.shotFov));
  } catch (e) { check('[low] the group "wide" ran to its end', false, String(e && e.message || e).slice(0, 400)); }   // (group isolation)
  // ------------------------------------------------------------------------------------------------ effects
  if (want('fx')) try {
    const r = await page.evaluate(async () => {
      const H = window.__dt, E = G.sys.engine, out = {};
      await H.view(0, 14, Math.PI, 10); await H.wait(600);
      const c = E.camera.position, f = new THREE.Vector3(0, 0, -1).applyQuaternion(E.camera.quaternion);
      const spot = (d) => ({ x: c.x + f.x * d, y: c.y + f.y * d, z: c.z + f.z * d });   // exactly d metres from the camera, along the view
      out.level = G.fx.level();
      const burst = (d) => G.fx.burst('confetti', spot(d), { count: 40 });
      // 이펙트 퀄리티: the share of particles
      H.set('fxQuality', 'high'); G.fx.clear(); out.qh = burst(6); H.set('fxQuality', 'medium'); G.fx.clear(); out.qm = burst(6); H.set('fxQuality', 'low'); G.fx.clear(); out.ql = burst(6); G.fx.clear();
      out.share = { high: (H.set('fxQuality', 'high'), G.fx.options().quality), medium: (H.set('fxQuality', 'medium'), G.fx.options().quality), low: (H.set('fxQuality', 'low'), G.fx.options().quality) };
      out.features = { low: ['petals', 'smoke', 'rainRings', 'splashes'].filter((n) => E.feature(n)) };
      H.set('fxQuality', 'high');
      out.opts = G.fx.options();
      // 이펙트 가시거리: nothing is made farther than the range from the character AND from the camera (the nearer one counts)
      const pp = G.sys.player.position, d3 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
      const nearOf = (p) => Math.round(Math.min(d3(p, c), d3(p, pp)) * 10) / 10;
      out.camToPlayer = Math.round(d3(c, pp) * 10) / 10;
      const ranges = {};
      for (const n of [1, 3, 6, 9, 10]) {
        H.set('fxDistance', n); G.fx.clear();
        ranges[n] = { range: G.fx.options().range, at: [5, 12, 40, 100, 150].map((d) => [nearOf(spot(d)), burst(d) > 0 ? 1 : 0]), near40: nearOf(spot(40)), emoji: G.fx.emoji3d(spot(40), '🎉') ? 1 : 0, ripple: G.fx.ripple(spot(40)) > 0 ? 1 : 0,
          own: G.fx.burst('confetti', { x: pp.x, y: pp.y + 1, z: pp.z }, { count: 40 }) > 0 ? 1 : 0 };
      }
      out.ranges = ranges;
      // … with the camera 27 m away from the character (the wide view's zoom-out) and the range at 8 m
      { H.set('fxDistance', 1); G.fx.clear(); const keep = c.clone(); c.set(pp.x, pp.y + 10, pp.z + 25); out.ownFar = G.fx.burst('confetti', { x: pp.x, y: pp.y + 1, z: pp.z }, { count: 40 }) > 0 ? 1 : 0; out.midFar = G.fx.burst('confetti', { x: pp.x, y: pp.y + 5, z: pp.z + 12.5 }, { count: 40 }) > 0 ? 1 : 0; c.copy(keep); G.fx.clear(); }
      H.set('fxDistance', 9);
      // 이펙트 투명화(자신)
      out.self = [0, 1, 2, 3, 4, 5].map((n) => { H.set('selfFxFade', n); return G.fx.options().selfAlpha; });
      H.set('selfFxFade', 0);
      await H.wait(400);
      G.fx.setSelfAlpha(0); out.djOff = G.fx.doubleJump(); await H.wait(300); G.fx.setSelfAlpha(1); out.djOn = G.fx.doubleJump();
      G.fx.clear();
      return out;
    });
    numbers.fx = r;
    check('이펙트 퀄리티: the particle share is 1 · 0.7 · 0.4, and a burst of 40 makes about 40 · 28 · 16 particles (높음 · 보통 · 낮음)', () => (J(r.share) === J({ high: 1, medium: 0.7, low: 0.4 }) && r.qh >= 20 && Math.abs(r.qm / r.qh - 0.7) <= 0.1 && Math.abs(r.ql / r.qh - 0.4) <= 0.1), () => (J([r.qh, r.qm, r.ql, r.level])));
    const R = r.ranges;
    check('이펙트 가시거리: 1 = 8 m … 9 = 118 m … 10 = 165 m', () => (R[1].range === 8 && R[3].range === 16 && R[6].range === 43 && R[9].range === 118 && R[10].range === 165), () => (J(Object.values(R).map((x) => x.range))));
    const byRule = Object.values(R).every((x) => x.at.every(([near, made]) => (made === 1) === (near <= x.range)));
    check('… bursts 5 / 12 / 40 / 100 / 150 m along the view are made exactly where the nearer of character and camera is inside the range; more of them with every step', byRule && R[1].at.some((a) => a[1] === 0) && R[10].at.every((a) => a[1] === 1)
      && [1, 3, 6, 9, 10].map((n) => R[n].at.filter((a) => a[1]).length).every((v, i, l) => i === 0 || v >= l[i - 1]), J(Object.values(R).map((x) => `${x.range}m:${x.at.map((a) => `${a[0]}→${a[1]}`).join(' ')}`)));
    check('… the character\'s own spot is made at every step — also at 1 (8 m) with the camera 27 m away, where a spot halfway between them is not', () => (Object.values(R).every((x) => x.own === 1) && r.ownFar === 1 && r.midFar === 0), () => (`camera ${r.camToPlayer} m from the character · far: own ${r.ownFar}, halfway ${r.midFar}`));
    check('… floating emoji and ground rings obey the same rule (a spot 40 m along the view: not at 3, yes at 6)', () => ((R[3].emoji === 1) === (R[3].near40 <= R[3].range) && R[3].ripple === R[3].emoji && R[3].emoji === 0 && R[6].emoji === 1 && R[6].ripple === 1), () => (`near ${R[3].near40} m`));
    check('이펙트 투명화(자신) 0 … 5: what is left of the own effects is 1 · 0.8 · 0.6 · 0.42 · 0.26 · 0.1', () => (J(r.self) === J([1, 0.8, 0.6, 0.42, 0.26, 0.1])), () => (J(r.self)));
    check('… the double-jump sparkles are the player\'s own: none when nothing is left, there again at full', () => (r.djOff === 0 && r.djOn > 0), () => (`${r.djOff} / ${r.djOn}`));
  } catch (e) { check('[low] the group "fx" ran to its end', false, String(e && e.message || e).slice(0, 400)); }   // (group isolation)
  // ------------------------------------------------------------------------------------------------ photo formats
  if (want('photo')) try {
    const r = await page.evaluate(async () => {
      const H = window.__dt, P = G.sys.photo, out = {};
      const blob = async (o) => { const b = await P.snapshot(o); return b ? { type: b.type, size: b.size } : null; };
      out.def = await blob();
      out.png = await blob({ format: 'png' }); out.webp = await blob({ format: 'webp' });
      out.q50 = await blob({ format: 'jpg', quality: 0.5 }); out.q100 = await blob({ format: 'jpg', quality: 1 });
      const viaCapture = await P.capture({ format: 'jpeg', quality: 80, maxWidth: 320 });
      out.cap = viaCapture ? { type: viaCapture.type, size: viaCapture.size, isBlob: viaCapture instanceof Blob } : null;
      if (viaCapture) { const bmp = await createImageBitmap(viaCapture); out.capW = bmp.width; }
      out.shot = G.sys.display.shot();
      H.set('shotFormat', 'png'); out.shotPng = G.sys.display.shot(); out.defPng = await blob();
      H.set('shotFormat', 'jpg'); H.set('shotQuality', 60); out.q60 = G.sys.display.shot().quality; H.set('shotQuality', 90);
      // the album shutter keeps the format too
      G.setSetting('easyMode', false); await H.wait(300);
      const n0 = (G.state.photos || []).length;
      if (P.enter() !== false) {
        await H.frames(3);
        const ph = await P.capture();
        await H.wait(600);
        const full = ph ? P._full.get(ph.id) : null;
        out.album = { n: (G.state.photos || []).length - n0, fmt: ph && ph.fmt, name: full && full.name };
        P.exit({ silent: true });
      } else out.album = { n: -1 };
      G.setSetting('easyMode', true); await H.wait(300);
      return out;
    });
    numbers.photo = r;
    check('스크린샷 포맷: snapshot() gives a JPG by default, PNG and WebP on request', () => (r.def && r.def.type === 'image/jpeg' && r.png.type === 'image/png' && (r.webp.type === 'image/webp' || r.webp.type === 'image/jpeg') && r.def.size > 2000), () => (J([r.def, r.png, r.webp])));
    check('… the quality counts (JPG 50 % is smaller than 100 %), and the option reaches it (60 % → 0.6)', () => (r.q50.size < r.q100.size && r.q60 === 0.6), () => (`${r.q50.size} < ${r.q100.size}`));
    check('… capture({ format, quality, maxWidth }) is the same call and gives a Blob (lane support\'s picture)', () => (r.cap && r.cap.isBlob && r.cap.type === 'image/jpeg' && r.capW === 320), () => (J([r.cap, r.capW])));
    check('… the option changes the default (PNG) and back', () => (r.shotPng.format === 'png' && r.defPng.type === 'image/png' && r.shot.format === 'jpg' && r.shot.mime === 'image/jpeg'));
    check('… the album shutter saves its full-size picture in that format (.jpg)', () => (r.album.n === 1 && r.album.fmt === 'jpg' && /\.jpg$/.test(r.album.name || '')), () => (J(r.album)));
  } catch (e) { check('[low] the group "photo" ran to its end', false, String(e && e.message || e).slice(0, 400)); }   // (group isolation)
  // ------------------------------------------------------------------------------------------------ window mode, monitor, DOF, zoom keys
  if (want('window')) try {
    await page.evaluate(() => window.__dt.ready());
    const before = await page.evaluate(() => ({ fs: !!document.fullscreenElement, mode: window.__dt.get('windowMode'), mon: G.sys.display.screens(), monWhy: G.sys.display.options().find((d) => d.id === 'monitor').available(), monOpts: G.sys.display.options().find((d) => d.id === 'monitor').options.map((o) => o.l) }));
    // the key of the 'fullscreen' action (F): a real key press is the gesture the browser asks for
    await page.keyboard.press('f');
    await page.waitForTimeout(1500);
    const on = await page.evaluate(() => ({ fs: document.fullscreenElement === document.documentElement, mode: window.__dt.get('windowMode'), flag: G.sys.display.fullscreen }));
    await page.keyboard.press('f');
    await page.waitForTimeout(1500);
    const off = await page.evaluate(() => ({ fs: !!document.fullscreenElement, mode: window.__dt.get('windowMode') }));
    numbers.window = { before, on, off };
    if (on.fs) {
      check('화면 모드: the F key goes full screen (the option says 전체 화면) and F again comes back to 창 모드', () => (on.mode === 'fullscreen' && on.flag === true && !off.fs && off.mode === 'window'), () => (J([on, off])));
    } else {
      // this browser refused the full-screen request: the wish is kept and the chip offers it
      check('화면 모드: F asks for full screen; where the browser refuses, the wish is kept as 전체 화면', () => (on.mode === 'fullscreen' && off.mode === 'window'), () => (J([on, off])));
    }
    // a saved wish without a press (as after a login): the browser refuses, a chip offers it, ✕ puts 창 모드 back
    await page.waitForTimeout(6000);   // (the key presses above count as a press for about five seconds)
    const chip = await page.evaluate(async () => {
      const H = window.__dt;
      G.setSetting('windowMode', 'fullscreen'); await H.wait(1200);
      const c = document.getElementById('display-fs-chip');
      const out = { fs: !!document.fullscreenElement, chip: !!c && !c.hidden, text: c ? c.querySelector('.dfs-go')?.textContent : '', say: c ? c.querySelector('.dfs-go')?.dataset.say : '', h: c ? c.querySelector('.dfs-go').getBoundingClientRect().height : 0 };
      if (c) c.querySelector('.dfs-no').click();
      await H.wait(400);
      out.after = { mode: H.get('windowMode'), chip: !!c && !c.hidden };
      return out;
    });
    numbers.window.chip = chip;
    if (chip.fs) { check('a saved 전체 화면 wish was granted at once here (no chip needed)', true); await page.evaluate(async () => { window.__dt.set('windowMode', 'window'); await window.__dt.wait(800); }); }
    else check('a saved 전체 화면 wish without a press: the chip "🖥️ 전체 화면으로 보기" (56 px in easy mode, with a voice line); ✕ = 창 모드', chip.chip && /전체 화면으로 보기/.test(chip.text) && chip.say.length > 5 && chip.h >= 56 && chip.after.mode === 'window' && !chip.after.chip, J(chip));
    check('출력될 모니터: one monitor (or no browser support) → "1 모니터", disabled, with the reason in Korean', () => (before.monOpts.length === 1 ? (before.monOpts[0] === '1 모니터' && typeof before.monWhy === 'string' && /[가-힣]/.test(before.monWhy)) : before.mon.state === 'ready'), () => (J([before.mon.state, before.monOpts, before.monWhy])));
    const misc = await page.evaluate(async () => {
      const H = window.__dt, E = G.sys.engine, cam = G.sys.camera, row = (id) => G.sys.display.options().find((d) => d.id === id), out = {};
      out.dofWhy = row('dof').available(); out.aaWhy = row('antialias').available(); out.drWhy = row('dynRes').available(); out.texWhy = row('texQuality').available(); out.aoWhy = row('ao').available();
      H.set('dof', true); await H.frames(3); out.dofOn = !!(E.dofPass && E.dofPass.enabled); H.set('dof', false);
      out.d0 = cam._distT;
      return out;
    });
    await page.keyboard.press('x'); await page.keyboard.press('x');
    await page.waitForTimeout(600);
    const zOut = await page.evaluate(() => G.sys.camera._distT);
    await page.keyboard.press('z'); await page.keyboard.press('z'); await page.keyboard.press('z');
    await page.waitForTimeout(600);
    const zIn = await page.evaluate(() => G.sys.camera._distT);
    numbers.window.misc = { ...misc, zOut, zIn };
    check('`low` says why DOF, anti-aliasing, dynamic resolution, textures and ambient shadow cannot be used there (and DOF stays off)', () => ([misc.dofWhy, misc.aaWhy, misc.drWhy, misc.texWhy, misc.aoWhy].every((w) => typeof w === 'string' && /[가-힣]/.test(w)) && misc.dofOn === false), () => (J([misc.dofWhy, misc.aoWhy])));
    check('zoom keys: X steps back, Z comes closer', () => (zOut > misc.d0 + 0.05 && zIn < zOut - 0.05), () => (`${misc.d0.toFixed(2)} → ${zOut.toFixed(2)} → ${zIn.toFixed(2)}`));
  } catch (e) { check('[low] the group "window" ran to its end', false, String(e && e.message || e).slice(0, 400)); }   // (group isolation)
  // ------------------------------------------------------------------------------------------------ kept for the next visit
  if (want('persist')) try {
    await page.evaluate(async () => {
      const H = window.__dt;
      H.set('brightness', 70); H.set('viewQuality', 'medium'); H.set('fxDistance', 4); H.set('frameLimit', '30'); H.set('resolution', '960x540'); H.set('selfFxFade', 3); H.set('fxQuality', 'medium'); H.set('shotFormat', 'webp');
      G.input.bindings.set('bag', ['KeyU']);
      await H.wait(400);
      try { await G.save?.save?.({ reason: 'test' }); } catch (e) { /* local save optional */ }
    });
    await page.waitForTimeout(2200);   // (a Ctrl key was never pressed: no leave-page question)
    await boot(page, 'low');
    const r = await page.evaluate(async () => {
      const H = window.__dt, E = G.sys.engine;
      await H.frames(3);
      const out = { v: ['brightness', 'viewQuality', 'fxDistance', 'frameLimit', 'resolution', 'selfFxFade', 'fxQuality', 'shotFormat'].map((id) => H.get(id)), bag: G.input.bindings.get('bag'),
        applied: { css: E.renderer.domElement.style.filter, far: E.camera.far, range: G.fx.options().range, limit: E.frameLimit.fps, canvas: [E.renderer.domElement.width, E.renderer.domElement.height], self: G.fx.options().selfAlpha, share: G.fx.options().quality } };
      // … and everything back to the defaults
      for (const [id, v] of Object.entries(G.sys.display.defaults)) H.set(id, v);
      G.input.bindings.reset();
      await H.frames(3);
      out.reset = { css: E.renderer.domElement.style.filter, far: E.camera.far, limit: E.frameLimit.fps, bag: G.input.bindings.get('bag'), custom: G.input.bindings.custom };
      return out;
    });
    numbers.persist = r;
    check('after a reload every chosen value is still chosen (and the rebound key)', () => (J(r.v) === J([70, 'medium', 4, '30', '960x540', 3, 'medium', 'webp']) && J(r.bag) === J(['KeyU'])), () => (J([r.v, r.bag])));
    check('… and applied without anyone opening the settings: filter, far plane, effect range, frame limit, drawing size, own-effect share, particle share', () => (r.applied.css === 'brightness(1.160)' && r.applied.far === 1300 && r.applied.range === 22 && r.applied.limit === 30 && J(r.applied.canvas) === J([960, 540]) && r.applied.self === 0.42 && r.applied.share === 0.7), () => (J(r.applied)));
    check('back to the defaults: no filter, 3000 m, no limit, I opens the bag again', () => (r.reset.css === '' && r.reset.far === 3000 && r.reset.limit === 0 && J(r.reset.bag) === J(['KeyI']) && r.reset.custom === false), () => (J(r.reset)));
  } catch (e) { check('[low] the group "persist" ran to its end', false, String(e && e.message || e).slice(0, 400)); }   // (group isolation)
  const end = await page.evaluate(() => { const W = G.gfx.guard.watchdog; return { step: W.step, state: W.state, quality: G.sys.engine.quality, composer: !!G.sys.engine.composer }; });
  check('`low` is still the frozen direct render at the end (no post chain) and the watchdog never stepped', () => (end.quality === 'low' && !end.composer && end.step === 0), () => (J(end)));
  await context.close();
}

// ============================================================================================== medium page
async function mediumPage() {
  const { page, context } = await open('medium', { viewport: { width: 640, height: 360 }, deviceScaleFactor: 2, screen: { width: 1920, height: 1080 } });
  await boot(page, 'medium', '&drs=1');
  await page.evaluate(() => window.__dt.ready());
  const r = await page.evaluate(async () => {
    const H = window.__dt, E = G.sys.engine, cv = E.renderer.domElement, out = {};
    out.start = { composer: !!E.composer, quality: E.quality, patched: !!(E._outPass && E._outPass.uniforms.uTfmDisp), info: H.info() };
    // ---- a chosen size on a device ratio of 2 (window 640×360)
    const at = async (v) => { H.set('resolution', v); await H.frames(2); return { canvas: [cv.width, cv.height], drawn: E.resolutionInfo.drawn, line: G.sys.display.info(), ratio: E.resolutionInfo.ratio }; };
    out.res = { r1280: await at('1280x720'), r960: await at('960x540'), auto: await at('auto') };
    await at('960x540');
    // ---- brightness through the output pass, by day
    await H.view(0, 14, Math.PI, 10); await H.wait(2500);
    const bright = async (b) => { H.set('brightness', b); await H.frames(2); H.calm(); const p1 = H.probe(), p2 = H.probe(); return { b, path: E.brightnessInfo.path, gamma: +E.brightnessInfo.gamma.toFixed(3), filter: cv.style.filter, luma: H.luma(), p1, p2 }; };
    out.day = []; for (const b of [50, 0, 25, 75, 100, 50]) out.day.push(await bright(b));
    // ---- … and by night
    await H.view(0, 14, Math.PI, 21); await H.wait(5000);
    out.night = []; for (const b of [50, 0, 100, 50]) out.night.push(await bright(b));
    await H.view(0, 14, Math.PI, 10); await H.wait(2500);
    // ---- anti-aliasing
    out.aa = { on: E.postInfo.samples };
    H.set('antialias', false); await H.frames(2); out.aa.off = E.postInfo.samples; out.aa.frameOff = H.luma();
    H.set('antialias', true); await H.frames(2); out.aa.back = E.postInfo.samples;
    // ---- dynamic resolution (this page asks for it with ?drs=1)
    out.drs = { on: E.drs.on, why: G.sys.display.options().find((d) => d.id === 'dynRes').available() };
    H.set('dynRes', false); await H.frames(2); out.drs.off = E.drs.on; out.drs.scaleOff = E.drs.scale; out.drs.cap = E.drs.cap;
    H.set('dynRes', true); await H.frames(2); out.drs.back = E.drs.on;
    // ---- DOF while playing
    out.dof = { why: G.sys.display.options().find((d) => d.id === 'dof').available(), before: !!(E.dofPass && E.dofPass.enabled) };
    H.set('dof', true); await H.frames(3); out.dof.on = !!(E.dofPass && E.dofPass.enabled); out.dof.focus = E.dofPass ? +E.dofPass.uniforms.uFocus.value.toFixed(2) : 0; out.dof.cam = +G.sys.camera.distance.toFixed(2);
    H.set('dof', false); await H.frames(3); out.dof.off = !!(E.dofPass && E.dofPass.enabled);
    // ---- forests and grass (medium has the real vegetation)
    await H.view(52, 109.4, Math.PI, 10); await H.wait(3000);
    const N = G.sys.nature, veg = () => { const s = N.lodStats(); const f = (s.forests || []).reduce((a, x) => ({ near: a.near + (x.near || 0), mid: a.mid + (x.mid || 0) }), { near: 0, mid: 0 }); return { real: s.real, near: f.near, mid: f.mid, grass: s.grass ? s.grass.drawn : null, total: s.grass ? s.grass.total : null }; };
    const steady = async () => { let last = '', same = 0; for (let i = 0; i < 60 && same < 4; i++) { await H.raf(); const s = JSON.stringify(veg()); if (s === last) same++; else { same = 0; last = s; } } };
    const viewAt = async (v) => { H.set('viewQuality', v); await H.wait(1500); await steady(); const f = H.frame(); return { far: E.camera.far, fog: +E.viewFog.toFixed(3), veg: E.viewVeg, cull: E.cullStats.dist, ...veg(), calls: f.calls, tris: f.tris }; };
    out.view = { high: await viewAt('high'), low: await viewAt('low') };
    H.set('viewQuality', 'high'); await H.wait(1500);
    const g100 = veg().grass; H.set('grassDensity', 50); await H.frames(2); const g50 = veg().grass; H.set('grassDensity', 0); await H.frames(2); const g0 = veg().grass; H.set('grassDensity', 100); await H.frames(2);
    out.grass = { g100, g50, g0, back: veg().grass, total: veg().total };
    // ---- 이펙트 퀄리티 caps the weather effects of the preset
    const feats = () => ['petals', 'mist', 'smoke', 'caustics', 'rainRings', 'splashes'].filter((n) => E.feature(n));
    out.feat = { high: feats() }; H.set('fxQuality', 'low'); out.feat.low = feats(); H.set('fxQuality', 'high');
    // ---- 텍스쳐 퀄리티: anisotropy of what the scene holds (this page has no asset pack: the size cap is in display-unit)
    const maxAniso = () => { let m = 0, n = 0; E.scene.traverse((o) => { const mat = o.material; if (!mat) return; for (const x of Array.isArray(mat) ? mat : [mat]) for (const k of ['map', 'normalMap', 'roughnessMap']) { const t = x && x[k]; if (t && t.isTexture) { n++; if (t.anisotropy > m) m = t.anisotropy; } } }); return { max: m, n }; };
    out.tex = { high: maxAniso() }; H.set('texQuality', 'low'); await H.frames(2); out.tex.low = maxAniso(); out.tex.info = E.textureInfo; out.tex.frame = H.luma();
    H.set('texQuality', 'medium'); await H.frames(2); out.tex.medium = maxAniso(); H.set('texQuality', 'high'); await H.frames(2); out.tex.back = maxAniso();
    out.end = { step: G.gfx.guard.watchdog.step, state: G.gfx.guard.watchdog.state, info: H.info() };
    return out;
  });
  numbers.medium = r;
  check('[medium] the post chain is up and the output pass carries the brightness block', () => (r.start.composer && r.start.patched && r.start.quality === 'medium'));
  check('[medium] 1280×720 in a 640×360 window on a device ratio of 2: drawn at 1280×720; 960×540 → 960×540', () => (J(r.res.r1280.canvas) === J([1280, 720]) && J(r.res.r960.canvas) === J([960, 540]) && /창 640×360 · 그리는 크기 960×540/.test(r.res.r960.line)), () => (J([r.res.r1280.canvas, r.res.r960.canvas, r.res.r960.line])));
  check('[medium] 자동 keeps the preset\'s ratio (1.25 → 800×450)', () => (J(r.res.auto.canvas) === J([800, 450])), () => (J(r.res.auto.canvas)));
  const D = r.day || [], byB = (list, b) => list.find((x) => x.b === b);
  const d0 = byB(D, 0), d25 = byB(D, 25), d50 = D[0], d75 = byB(D, 75), d100 = byB(D, 100), d50b = D[D.length - 1];
  check('[medium] 밝기 through the shader (no CSS filter): gamma 1.625 at 0, exactly off at 50, 0.616 at 100', () => (d0.path === 'shader' && d50.path === 'none' && d100.path === 'shader' && d0.gamma === 1.625 && d100.gamma === 0.616 && D.every((x) => x.filter === '')), () => (J(D.map((x) => [x.b, x.path, x.gamma]))));
  check('[medium] day: the frame gets brighter with every step — 0 < 25 < 50 < 75 < 100 (mean of 255)', () => (d0.luma.mean < d25.luma.mean - 2 && d25.luma.mean < d50.luma.mean - 2 && d50.luma.mean < d75.luma.mean - 2 && d75.luma.mean < d100.luma.mean - 2 && Math.abs(d50b.luma.mean - d50.luma.mean) < 3), () => (J(D.map((x) => x.luma.mean))));
  check('[medium] day: what the watchdog calls black / white is the same share at every brightness, and it stays quiet', () => (D.every((x) => !x.p1.anomaly && !x.p2.anomaly && x.p2.step === 0 && Math.abs(x.p2.black - d50.p2.black) < 0.02 && Math.abs(x.p2.white - d50.p2.white) < 0.02)), () => (J(D.map((x) => [x.b, x.p2.black, x.p2.white]))));
  const Nn = r.night || [], n50 = Nn[0], n0 = byB(Nn, 0), n100 = byB(Nn, 100);
  check('[medium] night: darker at 0, brighter at 100', () => (n0.luma.mean < n50.luma.mean - 0.5 && n100.luma.mean > n50.luma.mean + 0.5), () => (J(Nn.map((x) => x.luma.mean))));
  check('[medium] night: black / white shares unchanged and the watchdog quiet at 0, 50 and 100', () => (Nn.every((x) => !x.p1.anomaly && !x.p2.anomaly && x.p2.step === 0 && Math.abs(x.p2.black - n50.p2.black) < 0.02 && Math.abs(x.p2.white - n50.p2.white) < 0.02)), () => (J(Nn.map((x) => [x.b, x.p2.black, x.p2.white, x.luma.black]))));
  check('[medium] anti-aliasing switch: 4 samples → 0 → 4 (the frame is still a picture)', () => (r.aa.on === 4 && r.aa.off === 0 && r.aa.back === 4 && r.aa.frameOff.mean > 20 && r.aa.frameOff.black < 0.05), () => (J(r.aa)));
  check('[medium] dynamic resolution switch: on → off (the scale goes to its cap) → on', () => (r.drs.on === true && r.drs.off === false && Math.abs(r.drs.scaleOff - r.drs.cap) < 1e-6 && r.drs.back === true && r.drs.why === true), () => (J(r.drs)));
  check('[medium] DOF while playing: the pass runs with the focus on the character, and stops when switched off', () => (r.dof.why === true && !r.dof.before && r.dof.on && !r.dof.off && r.dof.focus > 1 && Math.abs(r.dof.focus - r.dof.cam) < r.dof.cam * 0.6 + 1.5), () => (J(r.dof)));
  const V = r.view || {};
  check('[medium] every part of the page could be measured', () => !r.errors, () => J(r.errors));
  check('[medium] 가시거리 낮음 from 만장대: far 800 m, forest levels × 0.6 — fewer trees in full / reduced detail, fewer triangles', () => (V.low.far === 800 && V.low.veg === 0.6 && V.high.veg === 1 && V.low.near <= V.high.near && V.low.mid < V.high.mid && V.low.tris < V.high.tris), () => (`near ${V.high.near} → ${V.low.near}, mid ${V.high.mid} → ${V.low.mid}, triangles ${V.high.tris} → ${V.low.tris}, calls ${V.high.calls} → ${V.low.calls}`));
  check('[medium] 풀 밀도 100 → 50 → 0 %: the grass instances halve and go (and come back)', () => (r.grass.g100 > 100 && Math.abs(r.grass.g50 - r.grass.g100 / 2) <= r.grass.g100 * 0.02 + 2 && r.grass.g0 <= 1 && r.grass.back === r.grass.g100), () => (J(r.grass)));
  check('[medium] 이펙트 퀄리티 낮음 switches the lighter weather effects off (petals, smoke, caustics, rain rings); splashes stay', () => (r.feat.high.includes('petals') && r.feat.high.includes('smoke') && J(r.feat.low) === J(['splashes'])), () => (`${J(r.feat.high)} → ${J(r.feat.low)}`));
  check('[medium] 텍스쳐 퀄리티: anisotropy of the scene\'s maps ≤ 1 at 낮음, ≤ 4 at 보통, as authored again at 높음', () => (r.tex.high.n > 0 && r.tex.low.max <= 1 && r.tex.medium.max <= 4 && r.tex.back.max === r.tex.high.max && r.tex.frame.mean > 20), () => (J([r.tex.high, r.tex.low, r.tex.medium, r.tex.back])));
  check('[medium] the watchdog never stepped', () => (r.end.step === 0), () => (J([r.end.step, r.end.state])));
  await context.close();
}

// ============================================================================================== high page + pictures
async function highPage() {
  const { page, context } = await open('high', { viewport: { width: SW, height: SH }, screen: { width: 1920, height: 1080 } });
  await boot(page, 'high', '', shotsFile);
  await page.evaluate(() => window.__dt.ready());
  await page.evaluate(() => { try { G.ui.setHudVisible(false); } catch (e) { /* no HUD switch */ } });
  await page.addStyleTag({ content: '#hud, .hud, .easy-coach, .zone-banner, .toast-wrap, .companion-card, [class*="easy-"], [class*="banner"], [class*="coach"], #ml-chip { visibility: hidden !important; }' });
  const shot = async (name) => { await page.screenshot({ path: path.join(SHOTS, `${name}.png`), timeout: 600000 }); };
  const ev = (fn, arg) => page.evaluate(fn, arg);
  // ---- ambient shadow switch (the pass of `high`)
  const ao = await ev(async () => {
    const H = window.__dt, E = G.sys.engine, out = { has: !!E.aoPass, on: !!(E.aoPass && E.aoPass.enabled), why: G.sys.display.options().find((d) => d.id === 'ao').available() };
    H.set('ao', false); await H.frames(2); out.off = !!(E.aoPass && E.aoPass.enabled); H.set('ao', true); await H.frames(2); out.back = !!(E.aoPass && E.aoPass.enabled);
    return out;
  });
  numbers.high = { ao };
  check('[high] ambient shadow switch: the pass runs → off → runs', () => (ao.has && ao.on && !ao.off && ao.back && ao.why === true), () => (J(ao)));
  // ---- brightness by day and by night
  const lum = {};
  await ev(async () => { await window.__dt.view(0, 14, Math.PI, 10); await window.__dt.wait(9000); });
  for (const b of [50, 0, 100]) { lum['day' + b] = await ev(async (v) => { const H = window.__dt; H.set('brightness', v); await H.frames(1); H.calm(); const p2 = H.probe(); return { luma: H.luma(), p: p2, a: p2.anomaly }; }, b); await shot(`bright-day-${String(b).padStart(3, '0')}`); }
  await ev(async () => { window.__dt.set('brightness', 50); await window.__dt.view(0, 14, Math.PI, 21); await window.__dt.wait(9000); });
  for (const b of [50, 0, 100]) { lum['night' + b] = await ev(async (v) => { const H = window.__dt; H.set('brightness', v); await H.frames(1); H.calm(); const p2 = H.probe(); return { luma: H.luma(), p: p2, a: p2.anomaly }; }, b); await shot(`bright-night-${String(b).padStart(3, '0')}`); }
  await ev(async () => { window.__dt.set('brightness', 50); });
  numbers.high.brightness = lum;
  check('[high] 밝기 0 / 50 / 100 by day: darker / as before / brighter, the watchdog quiet', () => (lum.day0.luma.mean < lum.day50.luma.mean - 4 && lum.day100.luma.mean > lum.day50.luma.mean + 4 && !lum.day0.a && !lum.day50.a && !lum.day100.a), () => (J([lum.day0.luma, lum.day50.luma, lum.day100.luma])));
  check('[high] 밝기 0 / 50 / 100 by night: darker / as before / brighter, the watchdog quiet, black share unchanged', () => (lum.night0.luma.mean < lum.night50.luma.mean && lum.night100.luma.mean > lum.night50.luma.mean && !lum.night0.a && !lum.night50.a && !lum.night100.a && Math.abs(lum.night0.p.black - lum.night50.p.black) < 0.02), () => (J([lum.night0.luma, lum.night50.luma, lum.night100.luma])));
  // ---- view distance from 만장대
  const vd = {};
  await ev(async () => { await window.__dt.view(52, 109.4, Math.PI, 10); await window.__dt.wait(9000); });
  for (const v of ['high', 'low']) { vd[v] = await ev(async (q) => { const H = window.__dt, E = G.sys.engine; H.set('viewQuality', q); await H.wait(6000); const f = H.frame(); return { far: E.camera.far, fog: +E.viewFog.toFixed(3), calls: f.calls, tris: f.tris }; }, v); await shot(`view-${v}`); }
  await ev(async () => { window.__dt.set('viewQuality', 'high'); });
  numbers.high.view = vd;
  check('[high] 가시거리 낮음 from 만장대: 800 m, thicker fog, a lighter frame', () => (vd.low.far === 800 && vd.low.fog >= 1.35 && vd.low.tris < vd.high.tris && vd.low.calls <= vd.high.calls), () => (J(vd)));
  // ---- field of view on the plaza
  const fv = {};
  await ev(async () => { await window.__dt.view(0, 14, Math.PI, 10); await window.__dt.wait(6000); });
  for (const w of [false, true]) { fv[w ? 'wide' : 'normal'] = await ev(async (on) => { const H = window.__dt, E = G.sys.engine; H.set('wideView', on); await H.frames(1); for (let i = 0; i < 4; i++) G.sys.camera.snap(); await H.frames(1); const f = H.frame(); return { fov: +E.camera.fov.toFixed(1), calls: f.calls, tris: f.tris }; }, w); await shot(`fov-${w ? '70-wide' : '55'}`); }
  numbers.high.fov = fv;
  check('[high] 최대 시야 확장 on the plaza: 55° → 70° (what it costs: draw calls and triangles of the frame are reported)', () => (Math.abs(fv.normal.fov - 55) < 1 && Math.abs(fv.wide.fov - 70) < 1.2), () => (`calls ${fv.normal.calls} → ${fv.wide.calls}, triangles ${fv.normal.tris} → ${fv.wide.tris}`));
  await ev(async () => { window.__dt.set('wideView', false); await window.__dt.wait(3000); });
  // ---- effect distance: the same bursts and floating marks 7 … 100 m along the view, with the range at 2 (11 m) and at 10 (165 m)
  const fxd = {};
  for (const n of [2, 10]) {
    fxd[n] = await ev(async (k) => {
      const H = window.__dt, E = G.sys.engine;
      H.set('fxDistance', k); G.fx.clear();
      const c = E.camera.position, f = new THREE.Vector3(0, 0, -1).applyQuaternion(E.camera.quaternion); f.y = 0; f.normalize();
      const made = [];
      for (const d of [7, 16, 32, 60, 100]) {
        const p = { x: c.x + f.x * d, y: G.world.heightAt(c.x + f.x * d, c.z + f.z * d, Infinity), z: c.z + f.z * d };
        const b = G.fx.burst('confetti', p, { count: 90, size: 1.6 + d / 30, up: 2.2, spread: 1.2 + d / 40 }) + G.fx.burst('stars', p, { count: 60, size: 1.4 + d / 30, lift: 1.5 });
        const e = G.fx.emoji3d({ x: p.x, y: p.y + 1.5 + d / 25, z: p.z }, '🎉', { scale: 1.5 + d / 12, duration: 6, rise: 0.4 });
        G.fx.ripple(p, { radius: 2 + d / 12, duration: 5, rings: 3 });
        made.push([d, b, e ? 1 : 0, Math.round(Math.min(d, Math.hypot(p.x - G.sys.player.position.x, p.y - G.sys.player.position.y, p.z - G.sys.player.position.z)) * 10) / 10]);
      }
      await H.frames(2);
      return { range: G.fx.options().range, made, pools: G.fx.stats() };
    }, n);
    await shot(`fxdist-${String(n).padStart(2, '0')}`);
  }
  await ev(async () => { window.__dt.set('fxDistance', 9); G.fx.clear(); });
  numbers.high.fxDistance = fxd;
  check('[high] 이펙트 가시거리 2 (11 m) makes only the effects near the character and the camera; 10 makes all five (7 … 100 m)', () => (fxd[2].made.every((m) => (m[1] > 0) === (m[3] <= fxd[2].range)) && fxd[2].made.some((m) => m[1] > 0) && fxd[2].made.some((m) => m[1] === 0) && fxd[10].made.every((m) => m[1] > 0 && m[2] === 1)), () => (J([fxd[2].made, fxd[10].made])));
  // ---- DOF while playing
  const dof = {};
  for (const on of [false, true]) { dof[on ? 'on' : 'off'] = await ev(async (v) => { const H = window.__dt, E = G.sys.engine; H.set('dof', v); await H.wait(4000); return { pass: !!(E.dofPass && E.dofPass.enabled), luma: H.luma() }; }, on); await shot(`dof-${on ? 'on' : 'off'}`); }
  await ev(async () => { window.__dt.set('dof', false); });
  numbers.high.dof = dof;
  check('[high] DOF while playing: off → the pass runs', () => (!dof.off.pass && dof.on.pass), () => (J(dof)));
  const end = await ev(() => ({ step: G.gfx.guard.watchdog.step, state: G.gfx.guard.watchdog.state }));
  check('[high] the watchdog never stepped', () => (end.step === 0), () => (J(end)));
  await context.close();
}

const runPage = async (tag, fn) => { try { await fn(); } catch (e) { check(`the ${tag} page ran to its end`, false, String(e?.stack || e).slice(0, 500)); } };
if (['rows', 'resolution', 'brightness', 'frame', 'view', 'wide', 'fx', 'photo', 'window', 'persist'].some(want)) await runPage('low', lowPage);
if (!flag('--skip-medium') && want('medium')) await runPage('medium', mediumPage);
if (SHOTS && want('high')) await runPage('high', highPage);
check('no page errors', () => (pageErrors.length === 0), () => (pageErrors.slice(0, 4).join(' | ')));
check('no console errors', () => (consoleErrors.length === 0), () => (consoleErrors.slice(0, 4).join(' | ')));
await browser.close();
const failed = results.filter((r) => !r.ok);
if (jsonOut) console.log(JSON.stringify({ pass: results.length - failed.length, fail: failed.length, results, numbers }, null, 1));
else log(`\n${results.length - failed.length} / ${results.length} passed`);
process.exit(failed.length ? 1 : 0);
