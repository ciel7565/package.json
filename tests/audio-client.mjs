#!/usr/bin/env node
// =============================================================================
// tests/audio-client.mjs — the sound of the experience (CONTRACT §17.6): 국악 instruments, 장단, moods, nature, effects
// and the live graph, in the page with OfflineAudioContext.
//
//   node tests/audio-client.mjs                        builds a small private page (tools/build.mjs --only 61,63 --out <tmp>)
//   node tests/audio-client.mjs --file /abs/page.html  tests an already built page (a full build works too)
//   options: --json · --keep · --headed · --timeout <ms> · --wav-dir <dir> (20 s of every mood as WAV, a listening aid)
//            --quick (skip the 120 s simulation)
//
// Offline (every render goes through the real mastering stage): each instrument, each 장단 for two cycles, each mood
// for 30 s, each nature layer and each effect must be audible (not silent), bounded (peak ≤ 0.98), finite (no NaN /
// Infinity), with a small DC offset, and its loudness inside the band of its family; effects must not be louder
// than the phase-8 effects (table BASELINE below, measured with analyze() on the phase-8 page); a pile-up of every
// fanfare stays under the limit; 120 simulated seconds of the whole engine (music + nature + an effect every half
// second, situation changing) keep the number of live sources flat and never exceed 24 voices.
// Live graph: unlock on a click, the scheduler runs and picks a mood, a hidden tab suspends the context and a visible
// one resumes it, mute silences (master 0 + suspended), easy mode is softer, ducks lower music (and nature for
// lectures) and release, every effect name plays, no page error.
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
const TIMEOUT = Number(opt('--timeout', '600000'));
const jsonOut = flag('--json');
const wavDir = opt('--wav-dir');
const log = (...a) => { if (!jsonOut) console.log(...a); };

let file = opt('--file');
let tmpDir = null;
if (!file) {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tfm-audio-'));
  file = path.join(tmpDir, 'index.html');
  const b = spawnSync(process.execPath, [path.join(ROOT, 'tools/build.mjs'), '--no-font', '--no-assets', '--quiet', '--strict', '--only', '61,63', '--out', file], { encoding: 'utf8' });
  if (b.status !== 0) { console.error(b.stderr || b.stdout); process.exit(2); }
}
if (!fs.existsSync(file)) { console.error(`page not found: ${file}`); process.exit(2); }

// the phase-8 effects through analyze() (peak, RMS up to the last sample above 0.002): the new timbres may not be louder
const BASELINE = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests/audio-baseline.json'), 'utf8'));
// loudness bands (dBFS RMS of the audible 50 ms windows, through the mastering stage) per family
const BANDS = {
  strings: [-40, -12], winds: [-42, -12], bowed: [-42, -12], drums: [-40, -10], metal: [-46, -12], wood: [-44, -12],
  jangdan: [-40, -12], mood: [-44, -14], nature: [-62, -18], sfx: [-60, -10],
};
const FAMILY = { gayageum: 'strings', geomungo: 'strings', daegeum: 'winds', piri: 'winds', haegeum: 'bowed', ajaeng: 'bowed', janggu: 'drums', buk: 'drums',
  jing: 'metal', kkwaenggwari: 'metal', pungkyeong: 'metal', bak: 'wood', moktak: 'wood' };

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail: String(detail ?? '').slice(0, 500) }); log(`${ok ? '  ✔' : '  ✖'} ${name}${detail !== '' && detail != null ? ` — ${String(detail).slice(0, 220)}` : ''}`); };
const sane = (label, r, band) => {
  if (!r) { check(`${label}: rendered`, false, 'no result'); return; }
  const inBand = r.rmsDb >= band[0] && r.rmsDb <= band[1];
  check(`${label}: audible, bounded, finite, no DC, loudness in band`, r.peak > 0.01 && r.rmsAct > 0.0008 && r.peak <= 0.98 && r.nonFinite === 0 && Math.abs(r.dc) < 0.01 && inBand,
    `peak ${r.peak} (${r.peakDb} dB) · rms ${r.rmsDb} dB [${band}] · dc ${r.dc} · nan ${r.nonFinite} · active ${r.activeShare}`);
};

const browser = await chromium.launch({ headless: !flag('--headed'), args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const context = await browser.newContext({ viewport: { width: 960, height: 600 }, locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
const page = await context.newPage();
await page.route('**/*', (route) => (/^(file|data|blob):/.test(route.request().url()) ? route.continue() : route.abort()));
const pageErrors = [], consoleErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e?.message || e).slice(0, 300)));
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 300)); });
const ev = (fn, arg) => page.evaluate(fn, arg);
let exitCode = 0;
try {
  await page.goto(`${pathToFileURL(file).href}?autostart=1&notutorial=1&quality=low`, { waitUntil: 'load', timeout: TIMEOUT });
  await page.waitForFunction(() => window.G && G.sys?.audio && G.gugak, null, { timeout: TIMEOUT, polling: 250 });
  log('▶ offline renders');
  // ---------------------------------------------------------------- instruments
  const inst = await ev(async () => { const o = {}; for (const n of G.gugak.instruments) o[n] = await G.sys.audio.lab.renderInstrument(n); return o; });
  for (const [n, r] of Object.entries(inst)) sane(`instrument ${n}`, r, BANDS[FAMILY[n] || 'strings']);
  check('instrument sources all ended (no leak)', Object.values(inst).every((r) => r && r.live === 0), Object.entries(inst).map(([n, r]) => `${n}:${r?.live}`).join(' '));
  // ---------------------------------------------------------------- 장단
  const jd = await ev(async () => { const o = {}; for (const id of Object.keys(G.gugak.JANGDAN)) { o[id] = await G.sys.audio.lab.renderJangdan(id, 2); o[id + '_buk'] = await G.sys.audio.lab.renderJangdan(id, 2, { inst: 'buk' }); } return o; });
  for (const [id, r] of Object.entries(jd)) {
    sane(`장단 ${r?.name || id}${id.endsWith('_buk') ? ' (북)' : ''} × 2`, r, BANDS.jangdan);
    if (r) check(`장단 ${r.name}${id.endsWith('_buk') ? ' (북)' : ''}: strokes and length of two cycles`, r.strokes >= 4 && Math.abs(r.duration - r.cycleSeconds * 2) < r.cycleSeconds * 0.5 + 2, `${r.strokes} strokes · cycle ${r.cycleSeconds} s · heard ${r.duration} s`);
  }
  // ---------------------------------------------------------------- moods (30 s through the real engine)
  const moods = await ev(async () => { const o = {}; for (const id of Object.keys(G.gugak.MOODS)) o[id] = await G.sys.audio.lab.renderMood(id, 30, { seed: 7 }); return o; });
  for (const [id, r] of Object.entries(moods)) {
    sane(`mood ${id} 30 s`, r, BANDS.mood);
    if (r) check(`mood ${id}: a section with mode / 장단 / voices, music most of the time, voices ≤ 24`, !!(r.info?.mode && r.info?.jangdan && r.info?.lead) && r.activeShare > 0.4 && r.stats.maxVoices <= 24,
      `${r.info?.label} · ${r.info?.mode} · ${r.info?.jangdan} · ${r.info?.lead}/${r.info?.answer}${r.info?.quote ? ' · ' + r.info.quote : ''} · active ${r.activeShare} · max voices ${r.stats.maxVoices}`);
  }
  // ---------------------------------------------------------------- nature layers
  const NATURE = {
    'dawn chorus (spring, forest)': { hour: 5.6, month: 5, season: 'spring', forest: 0.9 },
    'summer noon cicadas': { hour: 13.5, month: 8, season: 'summer', forest: 0.6, weather: 'CLEAR' },
    'summer night frogs by the water': { hour: 22.5, night: 1, month: 6, season: 'summer', waterDist: 6, waterPan: -0.4 },
    'autumn night crickets': { hour: 21, night: 1, month: 9, season: 'autumn' },
    'winter night owl + wind': { hour: 23, night: 1, month: 1, season: 'winter', wind: 2, weather: 'CLOUDY', forest: 0.9 },
    'rain on leaves and ground': { hour: 14, month: 7, season: 'summer', rain: 1, weather: 'RAIN', forest: 0.8 },
    'rain on the roof, indoors': { hour: 14, month: 7, season: 'summer', rain: 1, weather: 'RAIN', indoor: true },
    'thunder': { hour: 16, month: 7, season: 'summer', rain: 0.9, weather: 'RAIN', lightning: 1 },
    'snow hush': { hour: 15, month: 1, season: 'winter', snow: 1, weather: 'SNOW' },
    'the river close by': { hour: 11, month: 10, season: 'autumn', waterDist: 3, waterPan: 0.5 },
    'pine wind (gusty)': { hour: 11, month: 11, season: 'autumn', forest: 1, wind: 2.5 },
    'fire in the 아궁이': { hour: 18, month: 12, season: 'winter', indoor: true, place: 'PL_BUEOK', fire: { d: 2, pan: 0.3 } },
    'a fermenting jar': { hour: 12, month: 4, season: 'spring', jar: { d: 1.2, pan: -0.2 }, forest: 0.15, wind: 0.2 },
    'wind bells under the eaves': { hour: 12, month: 4, season: 'spring', bell: { d: 4, pan: 0.5 }, wind: 2, forest: 0.15 },
  };
  const nat = await ev(async (N) => { const o = {}; for (const [k, W] of Object.entries(N)) o[k] = await G.sys.audio.lab.renderNature(W, 14); return o; }, NATURE);
  for (const [k, r] of Object.entries(nat)) sane(`nature: ${k}`, r, BANDS.nature);
  // a specific sound is really there: compare with the same situation without it
  const contrast = await ev(async () => {
    const lab = G.sys.audio.lab;
    const pairs = {
      thunder: [{ hour: 16, month: 7, rain: 0.9, weather: 'RAIN', lightning: 1 }, { hour: 16, month: 7, rain: 0.9, weather: 'RAIN', lightning: 0 }],
      fire: [{ indoor: true, fire: { d: 2, pan: 0 }, hour: 18, month: 12 }, { indoor: true, hour: 18, month: 12 }],
      river: [{ waterDist: 3, hour: 11, month: 10 }, { hour: 11, month: 10 }],
      rain: [{ rain: 1, weather: 'RAIN', hour: 14, month: 7 }, { hour: 14, month: 7, weather: 'CLOUDY' }],
    };
    const o = {};
    for (const [k, [a, b]] of Object.entries(pairs)) { const ra = await lab.renderNature(a, 10), rb = await lab.renderNature(b, 10); o[k] = [ra.rms, rb.rms]; }
    return o;
  });
  for (const [k, [a, b]] of Object.entries(contrast)) check(`nature: ${k} adds energy`, a > b * 1.15, `${a} vs ${b} without`);
  // ---------------------------------------------------------------- effects vs the phase-8 loudness
  const names = await ev(() => G.sys.audio.names());
  const sfx = await ev(async (list) => { const o = {}; for (const n of list) o[n] = await G.sys.audio.analyze(n, { seconds: 4 }); return o; }, names);
  for (const n of names) {
    const r = sfx[n];
    if (!r) { check(`sfx ${n}: rendered`, false); continue; }
    const m = { ...r, rmsDb: +(20 * Math.log10(Math.max(r.rmsAct, 1e-7))).toFixed(1), activeShare: 1 };
    sane(`sfx ${n}`, m, BANDS.sfx);
    const b = BASELINE[n];
    if (b) check(`sfx ${n}: not louder than before`, r.peak <= b.peak * 1.12 + 0.004 && r.rms <= b.rms * 1.12 + 0.0005, `peak ${r.peak} (was ${b.peak}) · rms ${r.rms} (was ${b.rms})`);
  }
  const added = ['door_open', 'door_close', 'door_slide', 'place', 'pick', 'turn', 'lid', 'slide', 'camera', 'vault', 'land_wood', 'land_stone', 'land_earth', 'land_grass', 'land_gravel', 'pickup', 'lecture', 'screen'];
  check('the new effect names exist', added.every((n) => names.includes(n)), added.filter((n) => !names.includes(n)).join(', ') || 'all');
  const surf = await ev(async () => { const o = {}; for (const s of ['grass', 'dirt', 'stone', 'road', 'wood', 'sand', 'gravel', 'snow', 'mat', 'water', 'asphalt']) o[s] = await G.sys.audio.analyze('step', { surface: s, seconds: 1 }); return o; });
  check('footsteps on every surface are audible and soft', Object.values(surf).every((r) => r && r.peak > 0.005 && r.peak < 0.5), Object.entries(surf).map(([s, r]) => `${s} ${r?.peakDb}`).join(' · '));
  const pile = await ev(() => G.sys.audio.analyze(['levelup', 'achievement', 'reward', 'quest', 'festival', 'levelup', 'achievement', 'reward'], { seconds: 6, master: 1, sfx: 1 }));
  check('limiter: every fanfare at once at full volume stays below clipping', pile && pile.peak <= 0.98 && pile.nonFinite === 0, `peak ${pile?.peak}`);
  // ---------------------------------------------------------------- 120 simulated seconds of the whole engine
  if (!flag('--quick')) {
    const sim = await ev(() => G.sys.audio.lab.simulate(120, { sfxRate: 2, cycleSituation: true, sample: 5 }));
    const s = sim?.samples || [];
    const live = s.map((x) => x.live);
    const mean = (a) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
    const firstHalf = mean(live.slice(0, Math.floor(live.length / 2))), secondHalf = mean(live.slice(Math.floor(live.length / 2)));
    check('simulation: 120 s rendered, bounded and finite', sim && sim.peak <= 0.98 && sim.nonFinite === 0 && sim.rmsAct > 0.001, `peak ${sim?.peak} · rms ${sim?.rmsDb} dB · sections ${sim?.sections}`);
    check('simulation: live sources stay flat (no leak)', s.length >= 20 && secondHalf <= firstHalf * 1.5 + 10 && Math.max(...live) < 220 && sim.final.made - sim.final.ended === sim.final.live, `mean ${firstHalf.toFixed(0)} → ${secondHalf.toFixed(0)} · live ${live.join(',')} · made ${sim?.final?.made} ended ${sim?.final?.ended}`);
    check('simulation: never more than 24 voices', sim && sim.final.maxVoices <= 24, `max ${sim?.final?.maxVoices} · dropped ${JSON.stringify(sim?.final?.dropped)}`);
  }
  // ---------------------------------------------------------------- the live graph
  log('▶ live graph');
  await page.mouse.click(480, 300);
  await page.waitForFunction(() => G.sys.audio.ctx && G.sys.audio.ctx.state === 'running' && G.sys.audio.unlocked, null, { timeout: 20000 }).catch(() => {});
  const st0 = await ev(() => ({ state: G.sys.audio.ctx?.state, ready: G.sys.audio.ready }));
  check('live: the context starts on the first click', st0.state === 'running' && st0.ready, JSON.stringify(st0));
  await page.waitForFunction(() => G.sys.audio.debug().musicPlaying && !!G.sys.audio.moodInfo, null, { timeout: 20000 }).catch(() => {});
  const dbg = await ev(() => G.sys.audio.debug());
  check('live: the scheduler plays a mood', dbg.musicPlaying && !!dbg.moodInfo, `${dbg.mood} · ${dbg.moodInfo?.mode} · ${dbg.moodInfo?.jangdan} · live ${dbg.engine?.live}`);
  const playList = names.filter((n) => !['festival', 'levelup', 'levelUp', 'achievement'].includes(n));
  const played = await ev(async (list) => { const ok = []; for (const n of list) { if (G.sys.audio.play(n, { force: true })) ok.push(n); await new Promise((r) => setTimeout(r, 260)); } return ok; }, playList);
  check('live: every effect name plays (one after another, under the voice cap)', played.length >= playList.length - 2, `${played.length}/${playList.length} · missing ${playList.filter((n) => !played.includes(n)).join(',')}`);
  // hidden tab → suspended; visible → running
  await ev(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
  await page.waitForFunction(() => G.sys.audio.ctx.state === 'suspended', null, { timeout: 8000 }).catch(() => {});
  const hid = await ev(() => G.sys.audio.ctx.state);
  await ev(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); document.dispatchEvent(new Event('visibilitychange')); });
  await page.waitForFunction(() => G.sys.audio.ctx.state === 'running', null, { timeout: 8000 }).catch(() => {});
  const vis = await ev(() => G.sys.audio.ctx.state);
  check('live: a hidden tab suspends, a visible one resumes', hid === 'suspended' && vis === 'running', `${hid} → ${vis}`);
  // mute
  await ev(() => G.setSetting('muted', true));
  await page.waitForFunction(() => G.sys.audio.ctx.state === 'suspended', null, { timeout: 8000 }).catch(() => {});
  const mu = await ev(() => ({ state: G.sys.audio.ctx.state, master: G.sys.audio.levels.master, gain: G.sys.audio._E.n.master.gain.value, played: G.sys.audio.play('notify', { force: true }) }));
  await ev(() => G.setSetting('muted', false));
  check('live: mute silences everything', mu.master === 0 && mu.state === 'suspended' && mu.played === false, JSON.stringify(mu));
  // easy mode softer
  const easy = await ev(() => { const a = G.sys.audio; G.setSetting('easyMode', false); const off = { ...a.levels }; G.setSetting('easyMode', true); const on = { ...a.levels }; return { off, on }; });
  check('live: easy mode is softer (music and nature)', easy.on.music < easy.off.music && easy.on.ambient < easy.off.ambient, `music ${easy.on.music.toFixed(3)} < ${easy.off.music.toFixed(3)} · nature ${easy.on.ambient.toFixed(3)} < ${easy.off.ambient.toFixed(3)}`);
  // ducks
  await ev(() => G.sys.audio.duck('lecture', 0.12));
  await page.waitForTimeout(1600);
  const dk = await ev(() => ({ m: G.sys.audio._E.n.duck.gain.value, a: G.sys.audio._E.n.ambDuck.gain.value }));
  await ev(() => G.sys.audio.unduck('lecture'));
  await page.waitForTimeout(3500);
  const dk2 = await ev(() => ({ m: G.sys.audio._E.n.duck.gain.value, a: G.sys.audio._E.n.ambDuck.gain.value }));
  check('live: a lecture ducks music and nature, unduck releases', dk.m < 0.2 && dk.a < 0.6 && dk2.m > 0.9 && dk2.a > 0.9, `duck ${dk.m.toFixed(2)} / ${dk.a.toFixed(2)} → ${dk2.m.toFixed(2)} / ${dk2.a.toFixed(2)}`);
  // music off (전통 음악) + operator defaults
  const off = await ev(() => { G.setSetting('musicGugak', false); const a = G.sys.audio.levels.music; G.setSetting('musicGugak', true); return { a, b: G.sys.audio.levels.music }; });
  check('live: 전통 음악 off silences the music bus', off.a === 0 && off.b > 0, JSON.stringify(off));
  const site = await ev(() => {
    const prev = G.site; G.site = { get: (k, d) => (k === 'sound.volume_music' ? 0.1 : d) };
    G.sys.audio._applyVolumes(); const a = G.sys.audio.levels.music; G.site = prev; G.sys.audio._applyVolumes(); return { a, b: G.sys.audio.levels.music };
  });
  check('live: the operator default applies while the device keeps the built-in value', site.a < site.b, JSON.stringify(site));
  const W = await ev(() => G.sys.audio.debug().situation);
  check('live: the situation is read (month, season, place)', W && W.month >= 1 && W.month <= 12 && !!W.season, JSON.stringify(W));
  // the WAV listening aid
  if (wavDir) {
    fs.mkdirSync(wavDir, { recursive: true });
    const ids = await ev(() => Object.keys(G.gugak.MOODS));
    for (const id of ids) {
      const r = await ev(async (m) => G.sys.audio.lab.renderMood(m, 20, { wav: true, seed: 11, sr: 22050 }), id);
      if (!r?.wav) continue;
      const pcm = Buffer.from(r.wav.b64, 'base64');
      const hdr = Buffer.alloc(44);
      hdr.write('RIFF', 0); hdr.writeUInt32LE(36 + pcm.length, 4); hdr.write('WAVE', 8); hdr.write('fmt ', 12); hdr.writeUInt32LE(16, 16); hdr.writeUInt16LE(1, 20);
      hdr.writeUInt16LE(r.wav.channels, 22); hdr.writeUInt32LE(r.wav.sampleRate, 24); hdr.writeUInt32LE(r.wav.sampleRate * r.wav.channels * 2, 28); hdr.writeUInt16LE(r.wav.channels * 2, 32); hdr.writeUInt16LE(16, 34);
      hdr.write('data', 36); hdr.writeUInt32LE(pcm.length, 40);
      fs.writeFileSync(path.join(wavDir, `mood-${id}.wav`), Buffer.concat([hdr, pcm]));
      fs.writeFileSync(path.join(wavDir, `mood-${id}.json`), JSON.stringify({ info: r.info, peak: r.peak, rmsDb: r.rmsDb }, null, 1));
    }
    log(`  WAV files in ${wavDir}`);
  }
  check('no page errors', pageErrors.length === 0, pageErrors.join(' | '));
  check('no console errors', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));
} catch (e) {
  check('suite ran to the end', false, String(e?.stack || e).slice(0, 400));
  exitCode = 2;
} finally {
  await browser.close();
  if (tmpDir && !flag('--keep')) { try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* keep */ } }
}
const failed = results.filter((r) => !r.ok);
if (jsonOut) console.log(JSON.stringify({ passed: results.length - failed.length, failed: failed.length, results }, null, 1));
else log(`\n${results.length - failed.length}/${results.length} passed${failed.length ? ` — failed: ${failed.map((f) => f.name).join('; ')}` : ''}`);
process.exit(exitCode || (failed.length ? 1 : 0));
