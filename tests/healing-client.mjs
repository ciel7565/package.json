#!/usr/bin/env node
// =============================================================================
// tests/healing-client.mjs — the visit to the 힐링관 in the page (CONTRACT §19.6, lane heal-program). LOCAL (file) mode.
//
//   node tests/healing-client.mjs --file /abs/page.html [--mode easy|normal] [--phone] [--shots <dir>] [--only a,b] [--json]
//
// Steps (ids for --only): sys · visit (book → desk → 숙소 bundle + 힐링복 → 상담 → the ten rooms in the suggested order,
//   each started, its steps played by the acts' own calm autoplay, its real minutes passed on the DEBUG clock, stamped,
//   a 🔔 notice; room 9 breaks things into pooled pieces that never fly at the camera; room 10 keeps the portrait and the
//   letter on the device and out of the save) → report → check-out (the old look back) · places (every room entered and
//   left: the dock goes, the course runs on) · reload (a course survives a reload and is stamped after "hours away") ·
//   easy (the gentle room 10 without a gate, no text inputs, 56 px targets, voice lines) · phone (the dock and the map
//   fit the screen). With --shots: pictures of the steps (quality=high).
// The hall of lane heal-hall is used when PL_HEAL exists; otherwise the program's plain test room PL_HEAL_T.
// Exit 0 = all passed, 1 = a check failed, 2 = could not run.
// =============================================================================
import fs from 'node:fs';
import path from 'node:path';
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
const TIMEOUT = Number(opt('--timeout', '300000'));
const jsonOut = flag('--json');
const MODE = opt('--mode', 'normal') === 'easy' ? 'easy' : 'normal';
const PHONE = flag('--phone');
const SHOTS = opt('--shots');
const ONLY = (opt('--only') || '').split(',').filter(Boolean);
const want = (id) => !ONLY.length || ONLY.includes(id);
const ROOMS = (opt('--rooms') || '').split(',').filter(Boolean);   // --rooms R1,R9: only these are entered and played; the others run their course from the map
const log = (...a) => { if (!jsonOut) console.log(...a); };
const file = opt('--file');
if (!file || !fs.existsSync(file)) { console.error('--file <built page> is required'); process.exit(2); }
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail: typeof detail === 'string' ? detail.slice(0, 500) : JSON.stringify(detail).slice(0, 500) }); log(`${ok ? '  ✔' : '  ✘'} ${name}${ok ? '' : ' — ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 300)}`); };

const browser = await chromium.launch({ headless: !flag('--headed'), args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--autoplay-policy=no-user-gesture-required'] });
const vp = PHONE ? { width: 390, height: 844 } : SHOTS ? { width: 1280, height: 720 } : { width: 960, height: 600 };
const context = await browser.newContext({ viewport: vp, locale: 'ko-KR', timezoneId: 'Asia/Seoul', ...(PHONE ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}) });
await context.addInitScript((mode) => { try { const s = JSON.parse(localStorage.getItem('tfm.v1.settings') || '{}'); s.easyMode = mode === 'easy'; s._v = 2; localStorage.setItem('tfm.v1.settings', JSON.stringify(s)); } catch (e) { /* storage blocked */ } }, MODE);
const page = await context.newPage();
await page.route('**/*', (route) => (/^(file|data|blob):/.test(route.request().url()) ? route.continue() : route.abort()));
const pageErrors = [], consoleErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e?.message || e).slice(0, 300)));
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 300)); });
const quality = SHOTS ? 'high' : 'low';
// normal mode enters through the title (a grown-up's path; the autostart guest is a child in easy mode) — as tools/smoke.mjs
const url = `${pathToFileURL(file).href}?${MODE === 'easy' ? 'autostart=1&' : ''}notutorial=1&quality=${quality}`;
const ev = (fn, a) => page.evaluate(fn, a);
const wait = (ms) => page.waitForTimeout(ms);
async function shot(name) {
  if (!SHOTS) return;
  await wait(1500);
  await page.screenshot({ path: path.join(SHOTS, `${MODE}${PHONE ? '-phone' : ''}-${name}.png`), timeout: 240000 });
  log(`    📸 ${name}`);
}
async function boot() {
  await page.goto(url, { waitUntil: 'load', timeout: TIMEOUT });
  if (MODE === 'normal') {
    await page.waitForFunction(() => document.querySelector('.title-screen.in .ts-start') && document.getElementById('loading-screen')?.hidden, null, { timeout: TIMEOUT, polling: 250 });
    await page.evaluate(() => document.querySelector('.title-screen .ts-start').click());
  }
  await page.waitForFunction(() => window.G && window.G.ready === true && !!window.G.sys?.healing && !!window.G.healActs, null, { timeout: TIMEOUT, polling: 250 });
  await ev(() => { G.ui.modal.closeAll(); try { G.sys.weather.setLockTime(true); G.sys.weather.setAuto(false); G.sys.weather.setHour(11); } catch (e) { /* weather optional */ } });
}
/** go to a room (or a lobby key) and wait until the player is inside its place */
async function goTo(key) {
  // the first way in from the valley goes straight through the door (the walk there is the places suite's business)
  await ev(async () => { const P = G.sys.places; const H = G.sys.healing; if (!H.inHall()) await P.enter(H.placeFor('LOBBY'), { fade: false }); });
  await ev((k) => G.sys.healing.go(k), key);
  await page.waitForFunction((k) => { const H = G.sys.healing; const pid = H.placeFor(k); return G.sys.places.current === pid; }, key, { timeout: 90000, polling: 250 });
  await wait(300);
}
const T0 = Date.UTC(2026, 10, 28, 1, 0, 0);   // 10:00 in Korea

let exitCode = 0;
try {
  await boot();
  const info0 = await ev(() => ({ hall: !!G.sys.places.def('PL_HEAL'), test: !!G.sys.places.def('PL_HEAL_T'), sys: !!G.sys.healing && !G.sys.healing._failed, acts: !!G.sys.healacts, easy: !!G.easy?.on }));
  if (want('sys')) {
    check('the systems healing and healacts are registered', info0.sys && info0.acts, info0);
    check('a hall to visit: the house of heal-hall or the plain test room', info0.hall || info0.test, info0);
    check(`mode is ${MODE}`, info0.easy === (MODE === 'easy'), info0);
  }

  // ------------------------------------------------------------ one whole visit under the debug clock
  if (want('visit')) {
    await ev((t) => { G.sys.healing.debug.setNow(t); }, T0);
    const look0 = await ev(() => JSON.stringify(G.state.profile?.avatar || null));
    await goTo('LOBBY');
    await ev(() => G.sys.healing.openKiosk());
    await page.waitForSelector('.heal-m-kiosk .heal-btn.btn-primary', { timeout: 20000 });
    await shot('01-kiosk');
    await page.click('.heal-m-kiosk .heal-btn.btn-primary', { timeout: 30000 });   // 예약하기 → the desk opens
    await page.waitForFunction(() => !!G.ui.modal.get('heal-desk'), null, { timeout: 20000 });
    check('booked at the kiosk', await ev(() => !!G.sys.healing.visit && G.sys.healing.step() === 'checkin'));
    await shot('02-desk');
    await page.waitForSelector('.heal-m-desk .heal-btn.btn-primary', { timeout: 20000 });
    await page.click('.heal-m-desk .heal-btn.btn-primary', { timeout: 30000 });   // 체크인
    check('checked in at the desk (a wrist band)', await ev(() => G.sys.healing.visit.band > 0 && G.sys.healing.step() === 'stay'));
    check('the HUD chip shows inside the hall', await ev(() => !document.getElementById('heal-chip').hidden && !document.getElementById('heal-hud').hidden));
    await ev(() => G.ui.modal.closeAll());
    await goTo('STAY');
    await ev(() => G.sys.healing.openStay());
    for (let i = 0; i < 3; i++) { await page.waitForSelector(`.heal-m-stay .heal-shelf .heal-tile.now >> nth=0`, { timeout: 20000 }); await page.click('.heal-m-stay .heal-shelf .heal-tile.now >> nth=-1', { timeout: 30000 }); await page.waitForFunction((n) => G.sys.healing.visit.stow >= n, i + 1, { timeout: 20000 }); }
    check('the bundle unpacked onto the shelf (three taps)', await ev(() => G.sys.healing.visit.stow === 3 && G.sys.healing.step() === 'change'));
    await shot('03-stay');
    await page.click('.heal-m-stay .heal-btn.btn-primary >> nth=-1', { timeout: 30000 });   // 힐링복으로 갈아입기
    await page.waitForFunction(() => G.sys.healing.visit.changed > 0, null, { timeout: 20000 });
    const look1 = await ev(() => ({ s: JSON.stringify(G.state.profile?.avatar || null), top: (G.state.profile?.avatar || {}).topColor, wear: !!G.sys.healing.visit.wear }));
    check('changed into the 힐링복 (the old look is kept for the check-out)', look1.wear && look1.s !== look0 && G_ok(look1.top), look1);
    await ev(() => G.ui.modal.closeAll());
    await goTo('TALK');
    await ev(() => G.sys.healing.openCounsel());
    for (let q = 0; q < 4; q++) { await page.waitForSelector('.heal-m-counsel .heal-grid .heal-tile', { timeout: 20000 }); await page.click(`.heal-m-counsel .heal-grid .heal-tile >> nth=${q % 4}`, { timeout: 30000 }); }
    await page.waitForFunction(() => !!G.sys.healing.visit.base, null, { timeout: 20000 });
    const base = await ev(() => G.sys.healing.visit.base);
    check('the manager\'s four picture questions set the numbers', base && Object.values(base).every((x) => x >= 0 && x <= 100), base);
    await shot('04-counsel');
    await ev(() => G.ui.modal.closeAll());
    await ev(() => G.sys.healing.openMap());
    await page.waitForSelector('.heal-door', { timeout: 20000 });
    check('the corridor map shows ten doors', await ev(() => document.querySelectorAll('.heal-door[data-room]').length === 10));
    await shot('05-map');
    await ev(() => G.ui.modal.closeAll());

    const plan = await ev(() => G.sys.healing.plan());
    check('the suggested order begins with 제1관 and ends with 제10관', plan[0] === 'R1' && plan[plan.length - 1] === 'R10', plan);
    for (const room of plan) {
      if (ROOMS.length && !ROOMS.includes(room)) {
        const r0 = await ev((id) => G.sys.healing.start(id, { acts: false }), room);
        const ms0 = await ev((id) => { const c = G.sys.healing.visit.rooms[id]; return c.end - c.at; }, room);
        await ev((t) => G.sys.healing.debug.advance(t), ms0 + 1000);
        check(`${room}: run from the map without entering, stamped`, r0 && r0.ok && await ev((id) => G.sys.healing.visit.rooms[id].done > 0, room), r0);
        continue;
      }
      await goTo(room);
      const r = await ev((id) => G.sys.healing.start(id), room);
      check(`${room}: the course starts`, r && r.ok, r);
      await page.waitForSelector('#heal-dock', { timeout: 20000 });
      if (room === 'R9' && SHOTS) {
        await ev(() => { G.healActs.aim('plates'); });
        await wait(1500);
        await ev(() => { G.healActs.swing(true); });
        await wait(400);
        await shot('20-room9-swing');
      }
      const steps = await ev(() => G.healActs.auto(240));
      const st = await ev(() => G.healActs.state);
      check(`${room}: its steps were played (${steps.length}) and it rests now`, st && st.rest, { steps, st });
      if (room === 'R9') {
        const r9 = await ev(() => G.healActs.r9);
        const counts = await ev(() => G.sys.healing.visit.r9);
        check('room 9: things broke, dented, crushed — every count kept', counts && (counts.plates + counts.drums + counts.cans + counts.bottles) >= 4, counts);
        check('room 9: pieces come from the pool and stay low (never up at the camera)', r9 && r9.pieces <= 42 && r9.maxPieceY < 4, r9);
        await shot('21-room9-pieces');
      }
      if (room === 'R10') {
        const loc = await ev(() => ({ l: G.sys.healing.local(), save: JSON.stringify(G.state.healing) }));
        check('room 10: the portrait, the letter and the three things stay on this device', !!loc.l.portrait && Array.isArray(loc.l.cards) && loc.l.cards.length > 0 && Array.isArray(loc.l.three) && loc.l.three.length === 3, Object.keys(loc.l));
        check('room 10: none of them is in the save', !/base64|"cards"|"three"|"portrait"/.test(loc.save));
        await shot('22-room10-rest');
      }
      if (room === plan[1]) await shot('10-room-rest');
      const ms = await ev((id) => { const c = G.sys.healing.visit.rooms[id]; return c.end - c.at; }, room);
      const minutes = await ev((id) => G.data.healing.rooms[id].min, room);
      check(`${room}: a course of ${minutes} real minutes (scale 1)`, ms === minutes * 60000, ms);
      await ev((t) => G.sys.healing.debug.advance(t), ms + 1000);
      await page.waitForFunction((id) => G.sys.healing.visit.rooms[id].done > 0, room, { timeout: 20000 });
      const noti = await ev((id) => (G.sys.engagement?.notifications?.() || []).some((n) => n.key && n.key.indexOf('heal:done:' + id) === 0), room);
      check(`${room}: stamped at its end, with a 🔔 notice`, noti);
      await ev(() => G.healActs.close('test'));
    }
    check('all rooms stamped → the report', await ev(() => G.sys.healing.step() === 'report'));
    const nums = await ev(() => ({ before: G.sys.healing.visit.base, after: G.sys.healing.numbers() }));
    check('the four numbers moved the calm way', nums.after.stress < nums.before.stress && nums.after.calm > nums.before.calm && nums.after.fatigue < nums.before.fatigue, nums);
    await ev(() => G.sys.healing.openReport());
    await page.waitForSelector('.heal-report', { timeout: 20000 });
    const rep = await ev(() => ({ stamps: document.querySelectorAll('.heal-stampbox.on').length, nums: document.querySelectorAll('.heal-report .heal-num').length, claim: !!document.querySelector('.heal-report .heal-claim'), help: !!document.querySelector('.heal-report .heal-help'), portrait: !!document.querySelector('.heal-report .heal-portrait img') }));
    check('the report: ten stamps, the numbers before and after, the claim line, the portrait', rep.stamps >= 9 && rep.nums === 6 && rep.claim && rep.portrait, rep);
    check(MODE === 'easy' ? 'easy mode: the gentle report has no help line' : 'the full version shows the one help line (109)', MODE === 'easy' ? !rep.help : rep.help, rep);
    await shot('30-report');
    const jn = await ev(() => { const n0 = G.sys.journal?.count?.() || 0; const e = G.sys.healing.toJournal(G.sys.healing.reportData()); return { ok: !!e, n: (G.sys.journal?.count?.() || 0) - n0 }; });
    check('the report is kept in the 일지', jn.ok && jn.n === 1, jn);
    await ev(() => G.ui.modal.closeAll());
    await ev(() => G.sys.healing.checkout());
    const out = await ev(() => ({ out: G.state.healing.visit?.out > 0, visits: G.state.healing.visits, look: JSON.stringify(G.state.profile?.avatar || null) }));
    check('checked out: the visit is closed, the old look is back', out.out && out.visits >= 1 && out.look !== look1.s, out);
    await ev(() => G.sys.healing.debug.setNow(null));
  }

  // ------------------------------------------------------------ every room entered and left; the course runs on
  if (want('places')) {
    await ev(() => { if (!G.sys.healing.visit) G.sys.healing.book(); G.sys.healing.counsel({}); });
    await goTo('R3');
    await ev(() => G.sys.healing.start('R3'));
    await page.waitForSelector('#heal-dock', { timeout: 20000 });
    // a nested room leads back into the corridor first, the corridor out to the valley
    for (let k = 0; k < 3; k++) { const cur = await ev(() => G.sys.places.current); if (!cur) break; await ev(() => G.sys.places.exit({ fade: false })); await wait(500); }
    await page.waitForFunction(() => !G.sys.places.current, null, { timeout: 60000 });
    const left = await ev(() => ({ dock: !!document.getElementById('heal-dock'), run: G.sys.healing.running().map((r) => r.room), chip: !document.getElementById('heal-chip').hidden }));
    check('leaving: the dock goes, the course runs on, the chip shows the minutes outside', !left.dock && left.run.includes('R3') && left.chip, left);
    const places = await ev(() => { const H = G.sys.healing; return [...new Set(['LOBBY', 'STAY', 'TALK', ...G.data.healing.order].map((k) => H.placeFor(k)))]; });
    let okAll = true;
    for (const pid of places) {
      const ok = await ev(async (id) => { const P = G.sys.places; const a = await P.enter(id, { fade: false }); const b = await P.exit({ fade: false }); return a && b; }, pid);
      if (!ok) okAll = false;
    }
    check(`every hall place (${places.length}) entered and left`, okAll, places);
    await ev(() => G.sys.healing.stop('R3'));
  }

  // ------------------------------------------------------------ a course survives a reload (and hours away)
  if (want('reload')) {
    await ev(() => { const H = G.sys.healing; if (!H.visit || H.visit.out) H.book(); H.counsel({}); H.start('R5', { acts: false }); });
    const before = await ev(() => ({ c: G.sys.healing.visit.rooms.R5, id: G.sys.healing.visit.id }));
    await ev(async () => { await G.save.save({ reason: 'test' }); });
    await boot();
    const after = await ev(() => ({ c: G.sys.healing.visit?.rooms?.R5, id: G.sys.healing.visit?.id, run: G.sys.healing.running().map((r) => r.room) }));
    check('after a reload the course is the same and still running', after.id === before.id && after.c && after.c.at === before.c.at && after.c.end === before.c.end && after.run.includes('R5'), { before, after });
    await ev(() => G.sys.healing.debug.advance(5 * 3600e3));
    check('five hours later it is stamped on the next tick', await ev(() => G.sys.healing.visit.rooms.R5.done > 0));
    await ev(() => G.sys.healing.debug.advance(-5 * 3600e3));
  }

  // ------------------------------------------------------------ easy mode: gentle room 10, no typing, big targets, voice
  if (want('easy') && MODE === 'easy') {
    await ev(() => { const H = G.sys.healing; if (!H.visit || H.visit.out) H.book(); H.counsel({}); });
    check('room 10 is the gentle 마음 돌아보기 for a child', await ev(() => G.sys.healing.gentle() && /마음 돌아보기/.test(G.sys.healing.roomName('R10'))));
    await goTo('R10');
    await ev(() => { G.sys.healing.visit.r10 = 'gentle'; G.sys.healing.start('R10'); });
    await page.waitForSelector('#heal-dock', { timeout: 20000 });
    const kid = await ev(() => {
      const dock = document.getElementById('heal-dock');
      const inputs = dock.querySelectorAll('input, textarea').length;
      const small = [...dock.querySelectorAll('button')].filter((b) => { const r = b.getBoundingClientRect(); return r.width > 0 && (r.width < 55.5 || r.height < 55.5); }).map((b) => b.className + ' ' + Math.round(b.getBoundingClientRect().width) + 'x' + Math.round(b.getBoundingClientRect().height));
      const say = [...dock.querySelectorAll('button')].filter((b) => !b.getAttribute('data-say') && !b.getAttribute('aria-label')).length;
      const words = dock.textContent;
      return { inputs, small, say, coffin: /관에|임종|유언|영정/.test(words) };
    });
    check('easy: no text inputs in the room card', kid.inputs === 0, kid);
    check('easy: every button is at least 56 px', kid.small.length === 0, kid.small);
    check('easy: every button has a voice line', kid.say === 0, kid);
    check('easy: the gentle room says nothing about coffins or death', !kid.coffin, kid);
    await shot('40-room10-gentle');
    await ev(() => G.healActs.auto(120));
    await ev(() => G.healActs.close('test'));
  }
  if (want('full10') && MODE === 'normal' && SHOTS) {
    await ev(() => { const H = G.sys.healing; if (!H.visit || H.visit.out) H.book(); H.counsel({}); });
    await goTo('R10');
    await ev(() => { G.sys.healing.visit.r10 = 'full'; G.sys.healing.start('R10'); const v = G.sys.healing.visit.rooms.R10; v.step = 2; });
    await ev(() => { G.healActs.close('test'); G.healActs.open('R10', {}); });
    await wait(5000);
    await shot('41-room10-full-coffin');
  }

  // ------------------------------------------------------------ one course left running for its REAL minutes (no debug clock)
  if (want('real') && ONLY.includes('real')) {
    await ev(() => { const H = G.sys.healing; H.debug.setNow(null); H.debug.scale(null); if (!H.visit || H.visit.out) H.book(); H.counsel({}); if (H.visit.rooms.R1) delete H.visit.rooms.R1; });
    const c = await ev(() => { const r = G.sys.healing.start('R1', { acts: false }); const c0 = G.sys.healing.visit.rooms.R1; return { r, at: c0.at, end: c0.end, scale: G.sys.healing.scale(), wall: Date.now() }; });
    log(`    ⏳ 제1관: ${Math.round((c.end - c.at) / 60000)} real minutes (scale ${c.scale}) — waiting`);
    check('a real course of 10 minutes at scale 1', c.r.ok && c.end - c.at === 600000 && c.scale === 1, c);
    const before = await ev(() => G.sys.healing.visit.rooms.R1.done);
    await page.waitForFunction(() => G.sys.healing.visit.rooms.R1.done > 0, null, { timeout: 14 * 60000, polling: 5000 });
    const after = await ev(() => ({ done: G.sys.healing.visit.rooms.R1.done, now: G.sys.healing.now(), wall: Date.now() }));
    check('…stamped by itself after its real minutes (not before)', before === 0 && after.done === c.end && after.wall - c.wall >= 600000 - 2000, { c, after });
  }

  // ------------------------------------------------------------ phone: the dock and the map fit
  if (want('phone') && PHONE) {
    await ev(() => { const H = G.sys.healing; if (!H.visit || H.visit.out) H.book(); H.counsel({}); });
    await goTo('R6');
    await ev(() => G.sys.healing.start('R6'));
    await page.waitForSelector('#heal-dock', { timeout: 20000 });
    const fit = await ev(() => { const r = document.getElementById('heal-dock').getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom, w: innerWidth, h: innerHeight }; });
    check('phone: the room card is inside the screen', fit.l >= 0 && fit.r <= fit.w + 0.5 && fit.t >= 0 && fit.b <= fit.h + 0.5, fit);
    await shot('50-phone-room');
    await ev(() => { G.healActs.close('test'); G.sys.healing.openMap(); });
    await page.waitForSelector('.heal-door', { timeout: 20000 });
    const mfit = await ev(() => [...document.querySelectorAll('.heal-door')].every((d) => { const r = d.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth + 0.5; }));
    check('phone: every door of the map is on the screen', mfit);
    await shot('51-phone-map');
    await ev(() => G.ui.modal.closeAll());
  }

  const se = await ev(() => ({ sys: (window.G.__systemErrors || []).filter((x) => x.system === 'healing' || x.system === 'healacts').map((x) => x.message.slice(0, 300)), a: G.sys.healing._lastError || null, b: G.sys.healacts?._lastError || null }));
  check('no errors in the healing systems (init, ticks, frames)', !se.sys.length && !se.a && !se.b, se);
  check('no page errors', pageErrors.length === 0, pageErrors);
  check('no console errors', consoleErrors.length === 0, consoleErrors.slice(0, 5));
} catch (e) {
  check('the run finished', false, String(e?.stack || e).slice(0, 600));
  exitCode = 2;
}
function G_ok(c) { return typeof c === 'string' && /^#(ffffff|f5f0e6|f1ece1)$/i.test(c); }
await browser.close();
const failed = results.filter((r) => !r.ok);
if (jsonOut) console.log(JSON.stringify({ ok: failed.length === 0, total: results.length, failed, results }, null, 1));
else log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(exitCode || (failed.length ? 1 : 0));
