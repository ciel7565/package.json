#!/usr/bin/env node
// =============================================================================
// tests/env-client.mjs — Korea in real time in the app (CONTRACT §17.5): G.env (77-env.js), the weather system's real
// clock (51-weather.js), the crop calendar of the real-time beds (42-realfarm.js).
//
//   node tests/env-client.mjs                       Node part + builds a private page and runs the browser part
//   node tests/env-client.mjs --file /abs/page.html the browser part on an already built page
//   node tests/env-client.mjs --node-only           only the Node part (no browser)
//   options: --json · --headed · --timeout <ms>
//
// Node part: the JavaScript core (src/game/77-env.js run in a vm) against server/lib/Env.php (php CLI) — the model of
//   정선 bit for bit over a year of sample hours, sun position / sunrise / sunset / season, the bed durations (crops ×
//   months × weathers × tiers × scales); the JavaScript sunrise / sunset against the USNO values.
// Browser part (?clock=kst, under automation like every suite here): the clock follows a faked wall clock through a day and
//   through a year (G.time.serverOffset moves Korea's "now"): hour = KST, the sun's height by astronomy (solstice noon,
//   a winter 17:30 = evening, a June 19:30 = still day), the season; today's weather from a faked api/env/now.php
//   (server mode, G.net.request scripted) incl. a hostile answer; the device choices (실시간(한국) / 빠른 체험 시간 / 고정
//   chips, 체험 날씨 kept while the real one changes, ⏰ 진짜 지금 in the easy card); a real-time bed planted on 8-15
//   gets the calendar's real duration and a '…월 …일쯤 수확해요' line + the season hint; the server-truth rule (a later
//   data.rt readyAt wins); the night lift follows env.night_brightness.
// Exit 0 = all passed, 1 = a check failed, 2 = could not run.
// =============================================================================
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n, d = null) => { const i = args.indexOf(n); return i >= 0 && i + 1 < args.length ? args[i + 1] : d; };
const TIMEOUT = Number(opt('--timeout', '240000'));
const jsonOut = flag('--json');
const log = (...a) => { if (!jsonOut) console.log(...a); };
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail: String(detail ?? '').slice(0, 600) }); log(`${ok ? '  ✔' : '  ✖'} ${name}${detail !== '' && detail != null ? ` — ${String(detail).slice(0, 260)}` : ''}`); };
const finish = (code) => {
  const failed = results.filter((r) => !r.ok).length;
  if (jsonOut) console.log(JSON.stringify({ passed: results.length - failed, failed, results }, null, 1));
  else log(`\nenv-client: ${results.length - failed} passed, ${failed} failed`);
  process.exit(code ?? (failed ? 1 : 0));
};
const kstMs = (s) => Date.parse(s.replace(' ', 'T') + ':00+09:00');

// =========================================================================== Node part
log('— Node: the JavaScript core against server/lib/Env.php');
const m = { exports: {} };
vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'src/game/77-env.js'), 'utf8'), { module: m });
const core = m.exports;
const php = (code) => {
  const r = spawnSync('php', ['-r', `define('TFM_BOOT', 1); require ${JSON.stringify(path.join(ROOT, 'server/lib/Env.php'))}; use Tfm\\Env; ${code}`], { encoding: 'utf8', maxBuffer: 64 << 20 });
  if (r.status !== 0) throw new Error(r.stderr || r.stdout || 'php failed');
  return JSON.parse(r.stdout);
};
try {
  const t0 = kstMs('2026-01-01 00:00');
  const times = [];
  for (let i = 0; i < 365 * 24; i += 5) times.push(t0 + i * 3600000 + ((i * 7919) % 3600000));
  fs.writeFileSync(path.join(os.tmpdir(), 'tfm-env-times.json'), JSON.stringify(times));
  const pm = php(`$t = json_decode(file_get_contents(${JSON.stringify(path.join(os.tmpdir(), 'tfm-env-times.json'))}), true); $o = []; foreach ($t as $ms) { $o[] = Env::modelAt((int) $ms); } echo json_encode($o);`);
  let bad = 0, first = '';
  times.forEach((ms, i) => {
    const j = core.modelAt(ms), p = pm[i];
    if (j.weather !== p.weather || j.temp !== p.temp || j.humidity !== p.humidity || j.wind !== p.wind || j.rain1h !== p.rain1h) { bad++; if (!first) first = `${ms}: js ${JSON.stringify(j)} php ${JSON.stringify(p)}`; }
  });
  check(`model of 정선: JavaScript = PHP for ${times.length} sample hours of a year (weather, temperature, humidity, wind, rain)`, bad === 0, bad ? `${bad} differ · ${first}` : '');
  const counts = {}; for (const ms of times) { const w = core.modelAt(ms).weather; counts[w] = (counts[w] || 0) + 1; }
  check('model of 정선: every weather occurs in a year, clear and cloudy most often', Object.keys(counts).length === 5 && counts.CLEAR > counts.RAIN && counts.CLOUDY > counts.FOG, JSON.stringify(counts));

  const samples = [kstMs('2026-01-01 07:30'), kstMs('2026-03-20 12:00'), kstMs('2026-06-21 19:30'), kstMs('2026-09-23 06:10'), kstMs('2026-11-15 17:40'), kstMs('2026-12-22 23:55')];
  const ps = php(`$o = []; foreach (${JSON.stringify(samples).replace(/\[/g, '[').replace(/\]/g, ']')} as $ms) { $o[] = ['sun' => Env::sunPos((int) $ms), 'times' => Env::sunTimes((int) $ms), 'season' => Env::season((int) $ms), 'moon' => Env::moon((int) $ms)]; } echo json_encode($o);`);
  let worst = 0, sdiff = '';
  samples.forEach((ms, i) => {
    const s = core.sunPos(ms), t = core.sunTimes(ms), se = core.season(ms), mo = core.moon(ms), p = ps[i];
    worst = Math.max(worst, Math.abs(s.elev - p.sun.elev), Math.abs(s.az - p.sun.az), Math.abs(t.rise - p.times.rise) / 60000, Math.abs(t.set - p.times.set) / 60000, Math.abs(mo.illum - p.moon.illum) * 100);
    if (se.id !== p.season.id || se.term !== p.season.term) sdiff += ` ${ms}:${se.term}/${p.season.term}`;
  });
  check('sun / moon / season: JavaScript = PHP (largest difference < 0.001 of a degree / minute / percent; same 절기)', worst < 0.001 && !sdiff, `worst ${worst}${sdiff}`);
  const USNO = [['2026-01-01', '07:40', '17:18'], ['2026-03-20', '06:30', '18:37'], ['2026-06-21', '05:05', '19:49'], ['2026-09-23', '06:14', '18:21'], ['2026-11-15', '07:04', '17:15'], ['2026-12-22', '07:36', '17:11']];
  const mins = (ms) => { const k = core.kst(ms); return k.h * 60 + k.mi + k.s / 60; };
  const hhmm = (s) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3));
  let off = 0, offTxt = '';
  for (const [d, r, st] of USNO) {
    const t = core.sunTimes(kstMs(`${d} 12:00`));
    const e = Math.max(Math.abs(mins(t.rise) - hhmm(r) - 0.5), Math.abs(mins(t.set) - hhmm(st) - 0.5));   // USNO rounds to the minute
    if (e > off) { off = e; offTxt = `${d} ${core.kst(t.rise).h}:${core.kst(t.rise).mi} / ${core.kst(t.set).h}:${core.kst(t.set).mi}`; }
  }
  check('sunrise / sunset of 정선 in the app within 3 minutes of the USNO values (6 dates)', off <= 3, `worst ${off.toFixed(2)} min · ${offTxt}`);

  const crops = { CROP_CABBAGE: { sow: [3, 4, 8], harvest: [5, 6, 10, 11], days: 85 }, CROP_BEAN: { sow: [5, 6], harvest: [10], days: 120 }, CROP_MINT: { sow: [4, 5], harvest: [6, 7, 8, 9], days: 70 } };
  const cases = [];
  for (const [id, cal] of Object.entries(crops)) for (const mo of [1, 4, 5, 8, 9, 12]) for (const w of core.IDS) for (const tier of [1, 2, 3]) for (const scale of [1, 60, 0.5]) {
    cases.push({ basis: 'calendar', cal, tier, scale, t: kstMs(`2026-${String(mo).padStart(2, '0')}-15 10:00`), weather: w, id });
  }
  fs.writeFileSync(path.join(os.tmpdir(), 'tfm-env-cases.json'), JSON.stringify(cases));
  const pb = php(`$c = json_decode(file_get_contents(${JSON.stringify(path.join(os.tmpdir(), 'tfm-env-cases.json'))}), true); $o = []; foreach ($c as $x) { $x['cal']['days'] = (float) $x['cal']['days']; $o[] = Env::bedMs($x); } echo json_encode($o);`);
  let bd = 0, bfirst = '';
  cases.forEach((c, i) => { const j = core.bedMs(c); if (j !== pb[i]) { bd++; if (!bfirst) bfirst = `${JSON.stringify(c)} js ${j} php ${pb[i]}`; } });
  check(`real-time bed durations: JavaScript = PHP for ${cases.length} cases (3 crops × 6 months × 5 weathers × 3 tiers × 3 scales)`, bd === 0, bd ? `${bd} differ · ${bfirst}` : '');
  const f = core.cropFactor(crops.CROP_CABBAGE, kstMs('2026-12-10 10:00'), 'SNOW');
  check('gentle factor: never below 0.5 (winter + snow → 0.506), in season + clear 1.05', f === 0.506 && core.cropFactor(crops.CROP_CABBAGE, kstMs('2026-08-15 10:00'), 'CLEAR') === 1.05, String(f));
} catch (e) {
  check('Node part ran', false, e && e.stack ? e.stack.split('\n').slice(0, 3).join(' ') : String(e));
}
if (flag('--node-only')) finish();

// =========================================================================== browser part
let chromium;
try { ({ chromium } = require('playwright')); }
catch {
  try { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
  catch { console.error('playwright 가 필요해요 (npm install)'); finish(2); }
}
let file = opt('--file');
if (!file) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tfm-env-'));
  file = path.join(tmpDir, 'index.html');
  const b = spawnSync(process.execPath, [path.join(ROOT, 'tools/build.mjs'), '--no-font', '--quiet', '--out', file], { encoding: 'utf8' });
  if (b.status !== 0) { console.error(b.stderr || b.stdout); finish(2); }
}
log('— Browser: ?clock=kst on ' + file);
const browser = await chromium.launch({ headless: !flag('--headed'), args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
const page = await context.newPage();
await page.route('**/*', (route) => (/^(file|data|blob):/.test(route.request().url()) ? route.continue() : route.abort()));
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e?.message || e).slice(0, 300)));
page.on('console', (msg) => { if (msg.type() === 'error') pageErrors.push('console.error: ' + msg.text().slice(0, 300)); });
try {
  await page.goto(`${pathToFileURL(file).href}?autostart=1&notutorial=1&quality=low&clock=kst`, { waitUntil: 'load', timeout: TIMEOUT });
  await page.waitForFunction(() => window.G && window.G.ready === true && !!window.G.env && !!window.G.sys?.weather, null, { timeout: TIMEOUT, polling: 250 });
  await page.evaluate(() => { G.ui.modal.closeAll(); G.setSetting('easyMode', false); });

  // ---- the clock through a day and a year (Korea's "now" moved with G.time.serverOffset)
  const day = await page.evaluate(async (stamps) => {
    const W = G.sys.weather, out = [];
    const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    for (const ms of stamps) {
      G.time.serverOffset = ms - Date.now();
      await frame(); await frame();
      out.push({ ms, mode: G.env.clockMode(), kst: W._kst, hour: W.hour, kHour: G.env.kst().hour, elev: W.sunElevation, phase: W.phase, nf: W.nightFactor, season: G.env.season().name, term: G.env.season().term });
    }
    return out;
  }, [kstMs('2026-06-21 12:27'), kstMs('2026-06-21 19:30'), kstMs('2026-06-21 21:00'), kstMs('2026-12-22 08:30'), kstMs('2026-12-22 12:24'), kstMs('2026-12-22 17:30'), kstMs('2026-12-22 18:40'), kstMs('2026-03-20 12:33'), kstMs('2026-09-23 02:00')]);
  const [sol, junEve, junNight, decMorn, decNoon, decDusk, decNight, equ, sepNight] = day;
  check('?clock=kst: the clock mode is 실시간(한국) and the weather system runs on it', sol.mode === 'kst' && sol.kst === true, JSON.stringify(sol));
  check('the hour is the KST wall clock (a faked now through the day)', day.every((d) => Math.abs(d.hour - d.kHour) < 0.02), JSON.stringify(day.map((d) => [d.hour.toFixed(2), d.kHour.toFixed(2)])));
  check('June solstice noon: the sun stands ≈ 76° high (astronomy for 정선); March equinox noon ≈ 52.7°; December noon ≈ 29°',
    Math.abs(sol.elev - 76.1) < 1 && Math.abs(equ.elev - 52.7) < 1 && Math.abs(decNoon.elev - 29.2) < 1, `${sol.elev.toFixed(2)} / ${equ.elev.toFixed(2)} / ${decNoon.elev.toFixed(2)}`);
  check('a June 19:30 is still day (sunset 19:49), a December 17:30 is evening (sunset 17:11), 18:40 in December and 21:00 in June are night',
    junEve.elev > 0 && junEve.phase !== 'NIGHT' && decDusk.elev < 0 && decDusk.phase === 'EVENING' && decNight.phase === 'NIGHT' && junNight.phase === 'NIGHT' && decNight.nf > 0.5,
    JSON.stringify([junEve.phase, junEve.elev.toFixed(1), decDusk.phase, decDusk.elev.toFixed(1), decNight.phase, junNight.phase]));
  check('a December 08:30 is morning; 02:00 in September is night', decMorn.phase === 'MORNING' && sepNight.phase === 'NIGHT', `${decMorn.phase} ${decMorn.elev.toFixed(1)} · ${sepNight.phase}`);
  // (2026: 하지 begins 06-21 17:24 KST and 춘분 03-20 23:46 KST — at those noons it is still 망종 / 경칩, as astronomy says)
  check('the season and the 절기 follow the year (여름 망종 at the solstice noon · 겨울 동지 · 봄 경칩 at the equinox noon)', sol.season === '여름' && sol.term === '망종' && decNoon.season === '겨울' && decNoon.term === '동지' && equ.season === '봄' && equ.term === '경칩',
    JSON.stringify([sol.season, sol.term, decNoon.season, decNoon.term, equ.season, equ.term]));

  // ---- today's weather from a faked api/env/now.php (server mode)
  const wx = await page.evaluate(async () => {
    const W = G.sys.weather, out = {};
    const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    G.time.serverOffset = Date.parse('2026-11-15T14:00:00+09:00') - Date.now();
    W.setAuto(true);
    let answer = { t: G.time.now(), tz: 'Asia/Seoul', weather: 'SNOW', temp: -3.5, humidity: 81, wind: 2.2, rain1h: 0.6, source: 'kma', sunrise: 0, sunset: 0, season: 'autumn', next: { t: G.time.now() + 3600000, weather: 'CLOUDY', temp: -3 }, cfg: { clock: 'kst', nightBrightness: 1.3, basis: 'calendar' } };
    const calls = [];
    const orig = G.net.request, origMode = G.net.mode;
    G.net.request = async (p) => { calls.push(p); if (p === 'env/now.php') return JSON.parse(JSON.stringify(answer)); return {}; };
    G.net.mode = 'server';
    try {
      out.ok = await G.env.refresh();
      for (let i = 0; i < 8; i++) await frame();
      W._updateTemp();
      out.a = { current: W.current, temp: W.temperature, hum: W.humidity, src: G.env.source, calls: calls.slice(), nb: G.env.nightBrightness(), real: W.realInfo() };
      // a hostile answer is dropped whole (the last good one stays)
      answer = { weather: '<img src=x onerror=alert(1)>', temp: 'NaN', humidity: 1e9, source: 'evil' };
      out.bad = await G.env.refresh();
      out.afterBad = { current: W.current, src: G.env.source, temp: G.env.now().temp };
      // the device's 체험 날씨 stays while the real one changes; auto on follows it again
      W.setAuto(false); W.set('RAIN', { source: 'user', instant: true });
      answer = { t: G.time.now(), weather: 'CLEAR', temp: 4, humidity: 50, wind: 1, rain1h: 0, source: 'kma', sunrise: 0, sunset: 0, season: 'autumn', next: null, cfg: {} };
      await G.env.refresh(); for (let i = 0; i < 4; i++) await frame();
      out.manual = W.current;
      W.setAuto(true); for (let i = 0; i < 4; i++) await frame();
      W._followEnv(true);
      out.follow = W.current;
    } finally { G.net.request = orig; G.net.mode = origMode; }
    return out;
  });
  check('a faked now.php: the weather, temperature and humidity on screen are today\'s (SNOW, −3.5 °C, 81 %), the source is 기상청', wx.ok && wx.a.current === 'SNOW' && wx.a.temp === -3.5 && wx.a.hum === 81 && wx.a.src === 'kma' && wx.a.calls.includes('env/now.php') && /기상청/.test(wx.a.real), JSON.stringify(wx.a));
  check('the operator\'s night brightness arrives with the answer (cfg.nightBrightness 1.3)', wx.a.nb === 1.3, String(wx.a.nb));
  check('a hostile now.php answer is dropped (no markup, no NaN; the last good weather stays)', wx.bad === false && wx.afterBad.current === 'SNOW' && wx.afterBad.src === 'kma' && wx.afterBad.temp === -3.5, JSON.stringify(wx.afterBad));
  check('the device\'s 체험 날씨 (RAIN) stays while the real weather changes; switching auto on follows the real one (CLEAR)', wx.manual === 'RAIN' && wx.follow === 'CLEAR', `${wx.manual} → ${wx.follow}`);

  // ---- the device choices: the three clock chips (normal popover) and ⏰ 진짜 지금 (easy card)
  const chips = await page.evaluate(async () => {
    const W = G.sys.weather, out = {};
    const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    G.setSetting('easyMode', false); await frame();
    W.openPopover(null); await frame();
    const pop = document.querySelector('.wx-pop');
    out.chips = [...(pop?.querySelectorAll('[data-wx-clock]') || [])].map((b) => [b.dataset.wxClock, b.textContent.trim(), b.getAttribute('aria-pressed')]);
    out.real = pop?.querySelector('[data-wx="real"]')?.textContent || '';
    pop?.querySelector('[data-wx-clock="fast"]')?.click(); await frame();
    const h0 = W.hour; await new Promise((r) => setTimeout(r, 1500)); await frame();
    out.fast = { mode: G.env.clockMode(), kst: W._kst, moved: W.hour - h0 };
    document.querySelector('.wx-pop [data-wx-clock="fixed"]')?.click(); await frame();
    const h1 = W.hour; await new Promise((r) => setTimeout(r, 800)); await frame();
    out.fixed = { mode: G.env.clockMode(), lock: !!G.settings.lockTime, moved: W.hour - h1 };
    document.querySelector('.wx-pop [data-wx-clock="kst"]')?.click(); await frame(); await frame();
    out.kst = { mode: G.env.clockMode(), lock: !!G.settings.lockTime, hour: W.hour, kHour: G.env.kst().hour };
    W._pop?.close?.(); await frame();
    // a chosen hour in 'kst' switches to 빠른 체험 시간 (a toast tells how to come back)
    W.setHour(22); await frame();
    out.setHour = { mode: G.env.clockMode(), hour: W.hour };
    G.env.setClockMode('kst'); await frame();
    // easy mode: the kid card has the ⏰ 진짜 지금 tile
    G.setSetting('easyMode', true); await frame();
    W.openPopover(null); await frame();
    const tile = document.querySelector('.wxk [data-kid-clock="kst"]');
    out.kid = { tile: !!tile, label: tile?.textContent.trim() || '', pressed: tile?.getAttribute('aria-pressed'), size: tile ? Math.round(tile.getBoundingClientRect().height) : 0 };
    W._pop?.close?.();
    G.setSetting('easyMode', false);
    return out;
  });
  check('the weather popover offers 실시간(한국) · 빠른 체험 시간 · 고정, 실시간 pressed, and a line about the real Korea now', chips.chips.length === 3 && chips.chips[0][2] === 'true' && /실시간/.test(chips.chips[0][1]) && /해 뜸/.test(chips.real) && /해 짐/.test(chips.real), JSON.stringify(chips.chips) + ' ' + chips.real);
  check('빠른 체험 시간: the game clock runs (≈ 1 game minute per real second); 고정: it stands still; 실시간: back to KST', chips.fast.mode === 'fast' && !chips.fast.kst && chips.fast.moved > 0.001 && chips.fixed.mode === 'fixed' && chips.fixed.lock && Math.abs(chips.fixed.moved) < 1e-6 && chips.kst.mode === 'kst' && !chips.kst.lock && Math.abs(chips.kst.hour - chips.kst.kHour) < 0.02, JSON.stringify([chips.fast, chips.fixed, chips.kst]));
  check('choosing an hour while on 실시간 switches to 빠른 체험 시간 at that hour', chips.setHour.mode === 'fast' && Math.abs(chips.setHour.hour - 22) < 0.05, JSON.stringify(chips.setHour));
  check('easy mode: the weather card has a big ⏰ 진짜 지금 tile (≥ 56 px), pressed while on real time', chips.kid.tile && /진짜 지금/.test(chips.kid.label) && chips.kid.pressed === 'true' && chips.kid.size >= 56, JSON.stringify(chips.kid));

  // ---- a real-time bed on the calendar: planted 2026-08-15 10:00 KST (배추 season)
  const bed = await page.evaluate(async () => {
    const R = G.sys.realfarm, out = {};
    const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    G.time.serverOffset = Date.parse('2026-08-15T10:00:00+09:00') - Date.now();
    G.env._set(G.env.core.modelSnap(G.time.now()));
    out.basis = G.env.basis();
    try { if (G.state.rtfarm?.beds?.RB1) delete G.state.rtfarm.beds.RB1; } catch (e) { /* fresh */ }
    out.hint = G.env.cropHint('CROP_CABBAGE');
    out.hintOff = G.env.cropHint('CROP_CORN');
    R.open('RB1'); await frame();
    const m = document.querySelector('.rt-bed-modal, .modal');
    out.season = document.querySelector('.rf-season')?.textContent || '';
    out.cards = [...document.querySelectorAll('.rf-crop')].slice(0, 4).map((c) => [c.dataset.crop, c.className.includes('in-season'), c.querySelector('.rf-crop-time')?.textContent || '']);
    G.ui.modal.closeAll();
    const t = G.time.now();
    const ok = R.plant('RB1', 'CROP_CABBAGE');
    const b = G.state.rtfarm.beds.RB1;
    out.ok = ok;
    out.dur = b ? b.readyAt - b.plantedAt : 0;
    out.want = G.env.core.bedMs({ basis: 'calendar', cal: G.data.cropCalendar.CROP_CABBAGE, tier: R.tier(), scale: R.scale(), t: b?.plantedAt ?? t, weather: G.env.weatherAt(b?.plantedAt ?? t) });
    const k = G.env.kst(b.readyAt);
    out.date = `${k.mo}월 ${k.d}일쯤`;
    R.open('RB1'); await frame(); await new Promise((r) => setTimeout(r, 1300)); await frame();
    out.clock = document.querySelector('.rf-clock')?.textContent || '';
    out.cal = document.querySelector('.rf-cal')?.textContent || '';
    out.left = document.querySelector('.rf-left')?.textContent || '';
    // the server-truth rule: the server's data.rt readyAt (measured from its own first sighting) replaces the app's
    const srvReady = b.plantedAt + 1500 + out.want + 3600000;
    out.moved = R.applyServer({ scale: 1, tier: 1, basis: 'calendar', beds: { RB1: { pid: b.pid, cropId: 'CROP_CABBAGE', firstSeenAt: b.plantedAt + 1500, readyAt: srvReady, status: 'growing' } } });
    out.after = G.state.rtfarm.beds.RB1.readyAt === srvReady;
    out.srvBasis = G.env.basis();
    G.ui.modal.closeAll();
    return out;
  });
  const days = bed.dur / 86400000;
  check('a 배추 planted on 8-15 (its season) takes the calendar\'s real time: 85 days ÷ the gentle factor (JavaScript core = the bed)', bed.ok && bed.basis === 'calendar' && bed.dur === bed.want && days > 80 && days < 86, `days ${days.toFixed(2)} want ${(bed.want / 86400000).toFixed(2)}`);
  check('the bed panel says the real harvest date (\'11월 …일쯤 수확해요\'), the count-down counts days, the calendar line names the months', bed.clock.includes(bed.date) && /수확해요/.test(bed.clock) && /일/.test(bed.left) && /8월/.test(bed.cal) && /11월/.test(bed.cal), `${bed.clock} · ${bed.left} · ${bed.cal}`);
  check('calendar hints: \'지금은 배추 심기 좋은 때예요\' in August, 옥수수 is told when to plant; the picker puts the in-season crops first with their dates', bed.hint === '지금은 배추 심기 좋은 때예요' && /4월·5월에 심으면 좋아요/.test(bed.hintOff) && /배추/.test(bed.season) && bed.cards.length > 0 && bed.cards[0][1] === true && /월 .*일쯤/.test(bed.cards[0][2]), JSON.stringify([bed.hint, bed.hintOff, bed.season, bed.cards]));
  check('server truth: a later data.rt readyAt replaces the app\'s own estimate (the basis comes with it)', bed.moved >= 1 && bed.after && bed.srvBasis === 'calendar', JSON.stringify({ moved: bed.moved, after: bed.after }));

  // ---- the night lift follows env.night_brightness (hour 22, clear)
  const night = await page.evaluate(async () => {
    const W = G.sys.weather, E = G.sys.engine, out = {};
    const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    W.setLockTime(true); W.setAuto(false); W.set('CLEAR', { instant: true });
    for (const nb of [0.6, 1.0, 1.25, 1.6]) {
      G.env._cfg = { ...(G.env._cfg || {}), nightBrightness: nb };
      W.setHour(22); await frame();
      out[nb] = { hemi: E.hemi?.intensity, key: E.sun?.intensity, nf: W.nightFactor };
    }
    W.setHour(12); await frame();
    G.env._cfg = { ...(G.env._cfg || {}), nightBrightness: 1.6 }; W.setHour(12); await frame();
    out.day16 = E.hemi?.intensity;
    G.env._cfg = { ...(G.env._cfg || {}), nightBrightness: 0.6 }; W.setHour(12); await frame();
    out.day06 = E.hemi?.intensity;
    W.setLockTime(false);
    return out;
  });
  check('night lift: the ambient and the moonlight at 22:00 rise with env.night_brightness (0.6 < 1.0 < 1.25 < 1.6); the day does not change',
    night[0.6].hemi < night[1].hemi && night[1].hemi < night[1.25].hemi && night[1.25].hemi < night[1.6].hemi && night[1].key < night[1.25].key && Math.abs(night.day16 - night.day06) < 1e-6,
    JSON.stringify(night));
  check('no page errors and no console.error during the run', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));
} catch (e) {
  check('browser part ran', false, e && e.stack ? e.stack.split('\n').slice(0, 3).join(' ') : String(e));
}
await browser.close();
finish();
