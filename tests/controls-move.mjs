#!/usr/bin/env node
// tests/controls-move.mjs — CONTRACT §19.3 (lane move), Node only (no browser): the double-tap detector as pure logic and as the
// real src/game/05-input.js fed with timestamped key / pointer events (a Node vm with a small fake DOM), then the player's
// run burst / dash / comfort rules (part 2, see below).
//   - two presses inside the window count; key auto-repeat never does; a press still held from before never does; remapped
//     bindings; WASD and the arrows; the window option (200 – 450, easy mode starts at 360); frame-rate independence (the same
//     events give the same answer whether a frame runs every 16 ms or every 200 ms)
//   - forward: the run latches while the second press is held and ends with the release; left / right / back: one dash event,
//     never a run; nothing while a window is open; chords; options off; touch: stick flicks and d-pad buttons
// Usage: node tests/controls-move.mjs [--json]    exit 0 = all green, 1 = a check failed
import { page } from './helpers/input-page.mjs';

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail: String(detail) }); if (!process.argv.includes('--json')) console.log(`${ok ? '✓' : '✗'} ${name}${detail !== '' ? ' — ' + detail : ''}`); };
const J = (v) => JSON.stringify(v);

/** a page with a log of 'input:run' / 'input:dash' events; ts = the clock of the key events */
function mk(opts = {}) {
  const p = page({ easy: false, ...opts });
  p.runs = []; p.dashes = [];
  p.G.bus.on('input:run', (d) => p.runs.push(d));
  p.G.bus.on('input:dash', (d) => p.dashes.push(d));
  return p;
}
/** press and release a key; the press at t, the release `hold` ms later (events carry timeStamp) */
const tapKey = (p, code, t, hold = 50) => { p.down(code, { ts: t }); p.up(code, { ts: t + hold }); };

// ----------------------------------------------------------------------------------------------- the pure detector
{
  const p = mk();
  const mkT = (w = 300) => p.I.makeTapDetector(() => w);
  let d = mkT();
  check('detector: first press is nothing, second within 300 ms answers { dir }', d.down('f', 'KeyW', 1000, false) === null && (d.up('f', 'KeyW', 1050), J(d.down('f', 'KeyW', 1200, false)) === J({ dir: 'f' })));
  d = mkT();
  d.down('f', 'KeyW', 1000, false); d.up('f', 'KeyW', 1050);
  check('detector: 400 ms later it is a new first press, not a double', d.down('f', 'KeyW', 1400, false) === null);
  d = mkT();
  d.down('l', 'KeyA', 0, false); d.up('l', 'KeyA', 40);
  const a2 = d.down('l', 'KeyA', 150, false); d.up('l', 'KeyA', 190);
  check('detector: a third press right after a double starts a new count', a2 && d.down('l', 'KeyA', 300, false) === null);
  d = mkT();
  d.down('f', 'KeyW', 0, false);
  let hit = null; for (let t = 30; t < 600; t += 30) hit = hit || d.down('f', 'KeyW', t, true);
  check('detector: auto-repeat (repeat = true) never counts, a held key never doubles', hit === null);
  d = mkT();
  d.down('f', 'KeyW', 0, false); d.up('f', 'KeyW', 60);
  check('detector: a press 30 ms after the last one is a bounce, not a tap', d.down('f', 'KeyW', 30, false) === null);
  d = mkT();
  d.down('f', 'KeyW', 0, false);   // W is still held …
  check('detector: a second key of the direction while one is held is no new press (still held from before)', d.down('f', 'ArrowUp', 100, false) === null);
  d.up('f', 'KeyW', 150); d.up('f', 'ArrowUp', 160);
  check('detector: … and after both are up a press later than the window is a new first press', d.down('f', 'KeyW', 450, false) === null);
  d = mkT();
  d.down('f', 'KeyW', 0, false); d.up('f', 'KeyW', 50);
  check('detector: W then the arrow key (both forward) in the window is a double', J(d.down('f', 'ArrowUp', 160, false)) === J({ dir: 'f' }));
  d = mkT();
  d.down('l', 'KeyA', 0, false); d.up('l', 'KeyA', 40);
  d.down('r', 'KeyD', 80, false); d.up('r', 'KeyD', 120);
  check('detector: another direction in between spoils the count (A D A is no double A)', d.down('l', 'KeyA', 200, false) === null);
  d = mkT();
  d.down('b', 'KeyS', 0, false); d.up('b', 'KeyS', 10);
  check('detector: an X11-style repeat pair (up, then down 5 ms later) is ignored', d.down('b', 'KeyS', 15, false) === null && d.down('b', 'KeyS', 17, false) === null);
  d = mkT();
  d.down('f', 'KeyW', 500, false); d.up('f', 'KeyW', 550);
  check('detector: time running backwards (a stale stamp) never makes a double', d.down('f', 'KeyW', 100, false) === null);
  d = mkT(200);
  d.down('f', 'KeyW', 0, false); d.up('f', 'KeyW', 20);
  check('detector: a window of 200 ms refuses a gap of 250', d.down('f', 'KeyW', 250, false) === null);
  d = mkT(450);
  d.down('f', 'KeyW', 0, false); d.up('f', 'KeyW', 20);
  check('detector: a window of 450 ms accepts a gap of 400', d.down('f', 'KeyW', 400, false) !== null);
  d = mkT();
  d.down('f', 'KeyW', 0, false); d.up('f', 'KeyW', 20);
  d.reset();
  check('detector: reset() forgets a pending first press', d.down('f', 'KeyW', 100, false) === null);
  check('detector: bad input (unknown direction, NaN time) is ignored', d.down('x', 'KeyW', 1, false) === null && d.down('f', 'KeyW', NaN, false) === null);
}

// ----------------------------------------------------------------------------------------------- the real input fragment: run
{
  const p = mk();
  p.down('KeyW', { ts: 1000 }); p.up('KeyW', { ts: 1060 });
  p.down('KeyW', { ts: 1180 });
  p.frame();
  check('forward double tap, second held → input:run on, input.running true, axis forward', p.runs.length === 1 && p.runs[0].on === true && p.I.running === true && p.I.tapRun === 'key' && p.I.axis.y === 1, J(p.runs));
  p.T.now += 2000;
  for (let t = 1230; t < 3000; t += 33) p.down('KeyW', { ts: t, repeat: true });   // the OS repeats the held key
  p.frame();
  check('… it keeps running while forward stays down (auto-repeat changes nothing)', p.I.running === true && p.runs.length === 1);
  p.down('KeyA', { ts: 3100 }); p.frame();
  check('… steering left keeps it', p.I.running === true && p.I.axis.x < -0.5 && p.I.axis.y > 0.5);
  p.up('KeyA', { ts: 3200 }); p.up('KeyW', { ts: 3300 }); p.frame();
  check('… letting go of forward ends it (input:run off, running false, nothing latched)', p.I.running === false && p.I.tapRun === false && p.runs.length === 2 && p.runs[1].on === false, J(p.runs));
}
{
  const p = mk();
  tapKey(p, 'KeyW', 1000); p.down('KeyW', { ts: 1200 }); p.frame();
  p.up('KeyW', { ts: 1240 }); p.frame();
  p.down('KeyW', { ts: 1400 }); p.frame();
  check('a run that ended with the release does not come back by a single press', p.I.running === false && p.runs.length === 2, J(p.runs));
  p.up('KeyW', { ts: 1450 });
}
{
  const p = mk();
  p.down('ArrowUp', { ts: 100 }); p.up('ArrowUp', { ts: 150 }); p.down('ArrowUp', { ts: 300 }); p.frame();
  check('the arrow keys work like W', p.I.running === true && p.runs.length === 1);
  p.up('ArrowUp', { ts: 400 }); p.frame();
  check('… and end the same way', p.I.running === false);
}
{
  const p = mk();
  p.down('KeyW', { ts: 100 }); p.up('KeyW', { ts: 150 }); p.down('KeyW', { ts: 700 }); p.frame();
  check('two presses 600 ms apart are not a run', p.I.running === false && p.runs.length === 0);
  p.up('KeyW', { ts: 760 });
  p.down('KeyW', { ts: 900 }); p.frame();   // 200 ms after the second one: that pair (700, 900) IS a double
  check('… but the 2nd and 3rd press (200 ms apart) are', p.I.running === true && p.runs.length === 1);
}
{
  const p = mk();
  p.B.set('forward', ['KeyU']);
  tapKey(p, 'KeyW', 100); p.down('KeyW', { ts: 250 }); p.frame();
  check('remapped bindings: W is no longer forward, so W W does nothing', p.I.running === false && p.runs.length === 0);
  p.up('KeyW', { ts: 300 });
  tapKey(p, 'KeyU', 1000); p.down('KeyU', { ts: 1150 }); p.frame();
  check('remapped bindings: the new key runs', p.I.running === true && p.runs.length === 1);
  p.up('KeyU', { ts: 1300 }); p.frame();
}
{
  const p = mk();
  p.press('KeyW', { ts: 100 }); p.down('KeyW', { ts: 250, ctrl: true }); p.frame();
  check('Ctrl + W (a chord) is no game key and never counts', p.I.running === false && p.runs.length === 0);
  p.up('KeyW', { ts: 300 });
}
{
  const p = mk({ settings: { tapRun: false, dashOn: false } });
  tapKey(p, 'KeyW', 100); p.down('KeyW', { ts: 250 }); p.frame();
  tapKey(p, 'KeyA', 1000); tapKey(p, 'KeyA', 1150);
  check('options off: 두 번 눌러 달리기 off → no run; 대시 off → no dash', p.I.running === false && p.runs.length === 0 && p.dashes.length === 0);
}
{
  // the window option and the easy-mode default
  const q = mk({ easy: false }), e = mk({ easy: true });
  for (const [P, name] of [[q, 'normal'], [e, 'easy']]) { tapKey(P, 'KeyW', 100); P.down('KeyW', { ts: 440 }); P.frame(); P.name = name; }
  check('window default: 300 ms in normal mode (a 340 gap fails), 360 ms in easy mode (it works)', q.I.running === false && e.I.running === true, `normal ${q.I.running} easy ${e.I.running}`);
  const w = mk({ settings: { tapWindow: 450 } }); tapKey(w, 'KeyW', 100); w.down('KeyW', { ts: 520 }); w.frame();
  const n = mk({ settings: { tapWindow: 200 } }); tapKey(n, 'KeyW', 100); n.down('KeyW', { ts: 350 }); n.frame();
  check('window option 450 accepts a 420 gap, 200 refuses a 250 gap', w.I.running === true && n.I.running === false);
}

// ----------------------------------------------------------------------------------------------- dash
{
  const p = mk();
  tapKey(p, 'KeyA', 1000); p.down('KeyA', { ts: 1150 }); p.frame();
  check('left double tap → one input:dash {dir: left}; no run', p.dashes.length === 1 && p.dashes[0].dir === 'left' && p.dashes[0].via === 'key' && p.I.running === false && p.runs.length === 0, J(p.dashes));
  p.T.now += 3000; for (let t = 1200; t < 3200; t += 33) p.down('KeyA', { ts: t, repeat: true });
  p.frame();
  check('… holding the key afterwards only walks (still one dash, no running, axis left)', p.dashes.length === 1 && p.I.running === false && p.I.axis.x === -1);
  p.up('KeyA', { ts: 3300 });
}
{
  const p = mk();
  tapKey(p, 'KeyD', 100); tapKey(p, 'KeyD', 260);
  tapKey(p, 'ArrowDown', 1000); tapKey(p, 'KeyS', 1120);
  check('right and back dash too (arrow and letter keys of a direction count together)', J(p.dashes.map((d) => d.dir)) === J(['right', 'back']), J(p.dashes));
}
{
  const p = mk();
  p.T.blocking = true;
  tapKey(p, 'KeyA', 100); tapKey(p, 'KeyA', 250); p.frame();
  p.T.blocking = false;
  check('a window is open: no dash and nothing half-counted', p.dashes.length === 0);
  tapKey(p, 'KeyA', 400);   // a first press only
  check('… after the window closes a single press is still just a first press', p.dashes.length === 0);
  p.T.blocking = true; p.frame(); p.T.blocking = false;
  tapKey(p, 'KeyA', 480);
  check('… and a press before the window opened does not pair with one after it', p.dashes.length === 0);
}
{
  const p = mk({ easy: false });
  // frame-rate independence: the same key events, a frame every 16 ms versus every 200 ms
  const run = (frameMs) => {
    const q = mk({ easy: false });
    const evs = [['down', 'KeyW', 1000], ['up', 'KeyW', 1070], ['down', 'KeyW', 1230], ['up', 'KeyW', 2500], ['down', 'KeyD', 2600], ['up', 'KeyD', 2660], ['down', 'KeyD', 2780], ['up', 'KeyD', 2820]];
    let clock = 900, i = 0; const log = [];
    while (clock < 3000) {
      clock += frameMs; q.T.now = clock;
      while (i < evs.length && evs[i][2] <= clock) { q[evs[i][0]](evs[i][1], { ts: evs[i][2] }); i++; }
      q.frame(); log.push(q.I.running ? 1 : 0);
    }
    return { runs: q.runs.length, dashes: q.dashes.length, running: log.some(Boolean) };
  };
  const a = run(16), b = run(200), c = run(1000);
  check('frame-rate independence: 60 fps, 5 fps and 1 fps give the same run and the same dash', J(a) === J(b) && J(b) === J(c) && a.runs === 2 && a.dashes === 1, `${J(a)} ${J(b)} ${J(c)}`);
  void p;
}

// ----------------------------------------------------------------------------------------------- always run, auto-forward
{
  const p = mk({ settings: { alwaysRun: true } });
  p.frame();
  check('항상 달리기: running without any key', p.I.running === true);
  p.down('ShiftLeft', { ts: 10 }); p.frame();
  check('… Shift then walks', p.I.running === false);
  p.up('ShiftLeft', { ts: 20 });
  const q = mk(); q.frame();
  check('default: not running without a key; Shift runs', q.I.running === false && (q.down('ShiftLeft', { ts: 1 }), q.frame(), q.I.running === true));
}
{
  const p = mk();
  p.press('KeyK', { ts: 100 }); p.frame();
  check('the auto-forward key (K) walks on by itself: axis forward, no key held', p.I.autoForward === true && p.I.axis.y === 1 && p.I.axis.x === 0 && p.I.running === false);
  p.press('KeyK', { ts: 300 }); p.frame();
  check('… K again stops it', p.I.autoForward === false && p.I.axis.y === 0);
  p.press('KeyK', { ts: 400 }); p.frame(); p.down('KeyS', { ts: 500 }); p.frame();
  check('… pressing back stops it too', p.I.autoForward === false);
  p.up('KeyS', { ts: 550 });
  p.press('KeyK', { ts: 700 }); p.T.blocking = true; p.frame(); p.T.blocking = false;
  check('… a window that opens stops it', p.I.autoForward === false);
  p.B.set('autoForward', ['KeyY']); p.press('KeyY', { ts: 900 }); p.frame();
  check('… the key can be rebound', p.I.autoForward === true);
}

// ----------------------------------------------------------------------------------------------- touch
{
  const stickEl = { id: 'joystick' };
  let down, move, up;
  const p = mk({ touch: true, pre: ({ mkEl, body }) => {
    const st = mkEl('div'); st.id = 'joystick'; st.querySelector = () => ({ style: {} });
    st.getBoundingClientRect = () => ({ left: 0, top: 0, width: 200, height: 200, right: 200, bottom: 200 });
    body.appendChild(st); Object.assign(stickEl, { el: st });
  } });
  const st = stickEl.el;
  const ptr = (t, x, y) => ({ pointerId: 1, clientX: x, clientY: y, timeStamp: t, isTrusted: true, preventDefault() {} });
  // the stick is 200 px wide: centre (100,100), radius 72; "forward" = well above the centre
  const flick = (t0, x, y, ms = 60) => { st.dispatch('pointerdown', ptr(t0, x, y)); st.dispatch('pointerup', ptr(t0 + ms, x, y)); };
  flick(1000, 100, 20); st.dispatch('pointerdown', ptr(1160, 100, 20));   // the second one stays down
  p.frame();
  check('touch: two quick flicks of the stick forward, the second held → run (via stick)', p.I.tapRun === 'stick' && p.I.running === true && p.runs.length === 1 && p.runs[0].via === 'stick', J(p.runs));
  down = st; down.dispatch('pointerup', ptr(1300, 100, 20)); p.frame();
  check('… releasing the stick ends it', p.I.running === false && p.I.tapRun === false);
  flick(2000, 20, 100); flick(2150, 20, 100);
  check('touch: two flicks to the left → a dash left (via stick), never a run', p.dashes.length === 1 && p.dashes[0].dir === 'left' && p.dashes[0].via === 'stick' && p.I.tapRun === false, J(p.dashes));
  flick(3000, 100, 20); flick(3100, 20, 100); flick(3200, 100, 20);
  check('touch: forward, left, forward is no double forward (another direction between)', p.runs.length === 2 && p.I.tapRun === false, J(p.runs));
  flick(4000, 100, 120); flick(4150, 100, 120);   // barely off the centre: below 55 %
  check('touch: a nudge below 55 % of the travel is not a flick', p.dashes.length === 1 && p.runs.length === 2);
  void move; void up;
}

const bad = results.filter((r) => !r.ok);
if (process.argv.includes('--json')) console.log(JSON.stringify({ total: results.length, failed: bad.length, results }, null, 1));
else console.log(`\n${results.length - bad.length}/${results.length} checks green${bad.length ? ' — FAILED: ' + bad.map((b) => b.name).join(' | ') : ''}`);
process.exit(bad.length ? 1 : 0);
