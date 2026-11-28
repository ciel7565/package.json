#!/usr/bin/env node
// tests/controls-player.mjs — CONTRACT §19.3 (lane move), Node only: the REAL 06-world.js + 21-player.js in a vm (a small THREE
// stand-in, a fake camera / input) driven frame by frame —
//   the dash (distance outdoors 3.2 m / indoors 2.2 m / speed tier ≤ × 1.5, eased, 0.22 s, 0.6 s cooldown, the same distance at
//   1, 2, 5, 10, 30 and 60 frames per second, relative to the camera, stopped by a wall, a thin fence, water and the edge of the
//   play area, refused while sitting / airborne / in a window / in a cinematic / during a walkTo), the run's burst, moveState and
//   its events, jump buffering and coyote time (and their easy-mode defaults), low fences cleared while running, stepping round
//   a small thing without drifting along walls.
// Usage: node tests/controls-player.mjs [--json]    exit 0 = all green, 1 = a check failed
import { loadPlayer } from './helpers/player-world.mjs';
import { page as inputPage } from './helpers/input-page.mjs';

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail: String(detail) }); if (!process.argv.includes('--json')) console.log(`${ok ? '✓' : '✗'} ${name}${detail !== '' ? ' — ' + detail : ''}`); };
const near = (a, b, e) => Math.abs(a - b) <= e;
const J = (v) => JSON.stringify(v);
const f2 = (v) => (Math.round(v * 100) / 100).toString();
const FPS = [60, 30, 10, 5, 2];

/** dash from the origin; returns { dist, h, started, endAt } */
function dashOnce(dir, opts = {}, fps = 60, seconds = 1) {
  const h = loadPlayer(opts);
  h.place(0, 0);
  h.G.bus.emit('input:dash', { dir });
  const started = h.P._dash !== null;
  let endAt = null, maxStep = 0, px = h.P.position.x, pz = h.P.position.z;
  h.run(seconds, fps, () => { });
  void px; void pz;
  const dx = h.P.position.x, dz = h.P.position.z;
  return { dist: Math.hypot(dx, dz), dx, dz, h, started, endAt, maxStep };
}

// ----------------------------------------------------------------------------------------------- the distance of a dash
{
  const r = dashOnce('left');
  check('a left dash outdoors starts and goes 3.2 m (to the camera\'s left)', r.started && near(r.dist, 3.2, 0.06) && r.dx < -3.1 && Math.abs(r.dz) < 0.05, `${f2(r.dx)}, ${f2(r.dz)}`);
  const rr = dashOnce('right'), rb = dashOnce('back');
  check('right and back dashes: 3.2 m to the right / towards the viewer (the camera looks to −z)', near(rr.dist, 3.2, 0.06) && rr.dx > 3.1 && near(rb.dist, 3.2, 0.06) && rb.dz > 3.1, `${f2(rr.dx)} · ${f2(rb.dz)}`);
  const ds = FPS.map((f) => dashOnce('left', {}, f).dist);
  check('the same 3.2 m at 60, 30, 10, 5 and 2 frames per second (distance from the eased curve, not from speed × dt)', ds.every((d) => near(d, 3.2, 0.08)), ds.map(f2).join(' · '));
  const t = loadPlayer({}); t.place(0, 0); t.G.bus.emit('input:dash', { dir: 'left' });
  t.run(0.11, 60); const half = Math.abs(t.P.position.x); t.run(0.12, 60); const full = Math.abs(t.P.position.x); t.run(0.3, 60);
  check('eased: 0.75 of the distance in the first half, all of it after 0.22 s, nothing more afterwards', near(half, 3.2 * 0.75, 0.15) && near(full, 3.2, 0.08) && near(Math.abs(t.P.position.x), full, 0.01) && t.P.speed < 0.5, `${f2(half)} → ${f2(full)} → ${f2(Math.abs(t.P.position.x))} speed ${f2(t.P.speed)}`);
  const ind = dashOnce('left', { indoor: true });
  check('indoors (a roofed place) the dash is 2.2 m', near(ind.dist, 2.2, 0.06), f2(ind.dist));
  const t2 = dashOnce('left', { tier: 2 }), t3 = dashOnce('left', { tier: 3 });
  check('speed tier 2 → 1.25 ×, tier 3 → 1.5 × (never more)', near(t2.dist, 4.0, 0.08) && near(t3.dist, 4.8, 0.08), `${f2(t2.dist)} · ${f2(t3.dist)}`);
  const y = loadPlayer({ yaw: Math.PI / 2 }); y.place(0, 0); y.G.bus.emit('input:dash', { dir: 'left' }); y.run(0.5, 60);
  check('relative to the camera: yawed a quarter turn, "left" goes along +z', near(y.P.position.z, 3.2, 0.08) && Math.abs(y.P.position.x) < 0.05, `${f2(y.P.position.x)}, ${f2(y.P.position.z)}`);
  const ev = loadPlayer({}); ev.place(0, 0); ev.G.bus.emit('input:dash', { dir: 'right' }); ev.run(0.5, 60);
  const e1 = ev.ev('player:dash');
  check('player:dash {dir, pos} once; sound "dash" once; the camera kick once', e1.length === 1 && e1[0].dir === 'right' && ev.G._sfx.filter((n) => n === 'dash').length === 1 && ev.camera.kicks.length === 1, JSON.stringify(e1[0]));
  check('moveState is "dash" during it and "walk" after it', (() => { const q = loadPlayer({}); q.place(0, 0); q.G.bus.emit('input:dash', { dir: 'left' }); q.run(0.05, 60); const a = q.P.moveState; q.run(0.5, 60); return a === 'dash' && q.P.moveState === 'walk'; })());
}

// ----------------------------------------------------------------------------------------------- cooldown and the "never" list
{
  const h = loadPlayer({}); h.place(0, 0);
  h.G.bus.emit('input:dash', { dir: 'left' }); h.run(0.3, 60);
  const x1 = h.P.position.x;
  h.G.bus.emit('input:dash', { dir: 'left' }); h.run(0.2, 60);
  check('0.6 s between two dashes: a second one 0.3 s after the first is ignored', near(h.P.position.x, x1, 0.01) && h.ev('player:dash').length === 1);
  h.run(0.2, 60); h.G.bus.emit('input:dash', { dir: 'left' }); h.run(0.4, 60);
  check('… and 0.7 s after the start it works', h.ev('player:dash').length === 2 && h.P.position.x < x1 - 3);
  const refuse = (name, prep) => { const q = loadPlayer({}); q.place(0, 0); prep(q); q.G.bus.emit('input:dash', { dir: 'left' }); q.run(0.5, 60); check(`no dash: ${name}`, q.ev('player:dash').length === 0 && Math.abs(q.P.position.x) < 0.05, f2(q.P.position.x)); };
  refuse('in the air', (q) => { q.P.grounded = false; q.P.position.y = 30; });
  refuse('while sitting', (q) => { q.P.sitting = { bench: null }; });
  refuse('in a window (input blocked)', (q) => { q.I.blocked = true; });
  refuse('in a cinematic', (q) => { q.camera.mode = 'cinematic'; });
  refuse('during a guided walk (walkTo)', (q) => { q.P._walk = { id: 1 }; });
  refuse('while sliding onto a seat', (q) => { q.P._slide = { t: 0, dur: 1, fx: 0, fy: 0, fz: 0, x: 0, y: 0, z: 0 }; });
  refuse('player disabled', (q) => { q.P.enabled = false; });
  const q = loadPlayer({}); q.place(0, 0); q.G.bus.emit('input:dash', { dir: 'forward' }); q.run(0.4, 60);
  check('"forward" is no dash (forward runs, it does not dash)', Math.abs(q.P.position.z) < 0.05 && q.ev('player:dash').length === 0);
  const m = loadPlayer({}); m.place(0, 0); m.G.bus.emit('input:dash', { dir: 'left' }); m.run(0.1, 60); m.I.blocked = true; m.run(0.3, 60);
  check('a window that opens in the middle of a dash stops it', Math.abs(m.P.position.x) < 3.0 && m.P._dash === null, f2(m.P.position.x));
}

// ----------------------------------------------------------------------------------------------- walls, fences, water, the edge
{
  for (const fps of FPS) {
    const h = loadPlayer({});
    h.W.addCollider({ shape: 'box', x: -1.6, z: 0, hw: 0.06, hd: 4, tag: 'fence', maxY: 5 });   // a thin, tall fence 1.6 m to the left
    h.place(0, 0); h.G.bus.emit('input:dash', { dir: 'left' });
    let minX = 0; h.run(1, fps, () => { minX = Math.min(minX, h.P.position.x); });
    minX = Math.min(minX, h.P.position.x);
    check(`a thin fence 1.6 m away is never passed (${fps} fps)`, minX > -1.6 - 0.06 + 1e-3 && minX < -1.1, f2(minX));
  }
  for (const fps of [60, 5]) {
    const h = loadPlayer({ indoor: true });
    h.W.addCollider({ shape: 'box', x: 0, z: -1.2, hw: 3, hd: 0.2, tag: 'B_WALL' });         // a room wall ahead ("back" is +z, so use left)
    h.W.addCollider({ shape: 'box', x: -1.5, z: 0, hw: 0.2, hd: 3, tag: 'B_WALL' });
    h.place(0, 0); h.G.bus.emit('input:dash', { dir: 'left' });
    let minX = 0; h.run(1, fps, () => { minX = Math.min(minX, h.P.position.x); });
    check(`indoors a wall at 1.5 m stops the dash at the wall (${fps} fps)`, minX >= -1.5 + 0.2 + 0.35 - 0.02, f2(minX));
  }
  {
    const h = loadPlayer({});
    h.W.setWaterFn((x) => x < -1.5);
    h.place(0, 0); h.G.bus.emit('input:dash', { dir: 'left' }); h.run(1, 60);
    check('water is not entered: a dash towards a river stops on the bank', h.P.position.x >= -1.5 - 1e-6 && h.P.position.x < -1.0, f2(h.P.position.x));
    const g = loadPlayer({}); g.place(-134, 0); g.G.bus.emit('input:dash', { dir: 'left' }); g.run(1, 60);
    check('the edge of the play area is not passed', g.P.position.x >= g.W.bounds.minX - 1e-6, f2(g.P.position.x));
    const s = loadPlayer({}); s.W.setTerrain((x) => (x < -1.5 ? (-1.5 - x) * 4 : 0)); s.place(0, 0); s.G.bus.emit('input:dash', { dir: 'left' }); s.run(1, 60);
    check('a steep bank (more than 40°) is not climbed by a dash', s.P.position.x > -1.5 - 0.5 && s.P.position.y < 1.0, `${f2(s.P.position.x)} y ${f2(s.P.position.y)}`);
  }
}

// ----------------------------------------------------------------------------------------------- the run: burst, state, events
{
  const peak = (opts) => {
    const h = loadPlayer(opts); h.place(0, 0, Math.PI);
    h.keys(0, 1, false); h.run(0.5, 60);                 // walking first (the two taps of the double tap walk a little)
    h.keys(0, 1, true);
    if (opts.burst) h.G.bus.emit('input:run', { on: true, via: 'key' });
    let max = 0; h.run(1.5, 60, () => { max = Math.max(max, h.P.speed); });
    return { max, end: h.P.speed, h };
  };
  const a = peak({ easy: false }), b = peak({ easy: false, burst: true }), c = peak({ easy: true, burst: true });
  check('a plain Shift run reaches 14.4 m/s and never more', near(a.max, 14.4, 0.05) && near(a.end, 14.4, 0.05), `${f2(a.max)}`);
  check('the double-tap run starts with a short burst above 14.4 (≤ 1.4 ×) and settles at 14.4', b.max > 15.5 && b.max <= 14.4 * 1.41 && near(b.end, 14.4, 0.05), `peak ${f2(b.max)} → ${f2(b.end)}`);
  check('easy mode: a gentler burst (≤ 1.18 ×)', c.max > 14.6 && c.max <= 14.4 * 1.19 && near(c.end, 14.4, 0.05), `peak ${f2(c.max)}`);
  const h = loadPlayer({ easy: false }); h.place(0, 0, Math.PI); h.keys(0, 1, false);
  h.run(0.6, 60); const w = h.P.moveState; const s1 = h.P.speed;
  h.keys(0, 1, true); h.run(0.8, 60); const r = h.P.moveState;
  h.keys(0, 0, false); h.run(0.8, 60); const st = h.P.moveState;
  const runEv = h.ev('player:run');
  check('moveState walk → run → walk and player:run {on} on the changes', w === 'walk' && near(s1, 7.68, 0.05) && r === 'run' && st === 'walk' && runEv.length === 2 && runEv[0].on === true && runEv[1].on === false, `${w} ${r} ${st} ${JSON.stringify(runEv)}`);
  const j = loadPlayer({}); j.place(0, 0); j.I.queueJump(); j.run(0.1, 60);
  check('moveState is "air" while jumping', j.P.moveState === 'air', j.P.moveState);
  const t3 = peak({ easy: false, tier: 3 });
  check('the speed tier multiplies a run as before (tier 3: 43.2 m/s)', near(t3.end, 43.2, 0.2), f2(t3.end));
  check('running and dashing drain nothing (runDrains is false)', h.P.runDrains === false);
}

// ----------------------------------------------------------------------------------------------- jump buffer, coyote time
{
  /** drop from 1.5 m; press jump `before` seconds before the landing; did the player jump on landing? */
  const buffered = (opts, before) => {
    const h = loadPlayer(opts); h.place(0, 0); h.P.grounded = false; h.P.position.y = 1.5; h.P.velocity.set(0, 0, 0);
    const tLand = Math.sqrt(2 * 1.5 / 22); let pressed = false;
    h.run(1, 120, (i, t) => { if (!pressed && t >= tLand - before - 1e-6) { pressed = true; h.I.queueJump(); } });
    return h.ev('player:jump').length > 0;
  };
  check('jump buffer: a press 90 ms before landing jumps on landing (normal mode, 120 ms)', buffered({ easy: false }, 0.09) === true);
  check('… a press 200 ms before landing does not', buffered({ easy: false }, 0.2) === false);
  check('… easy mode (180 ms): 160 ms before counts, 260 ms does not', buffered({ easy: true }, 0.16) === true && buffered({ easy: true }, 0.26) === false);
  check('… the option: 0 ms = no buffer (a press 50 ms before does nothing), 200 ms = a press 190 ms before counts', buffered({ easy: false, settings: { jumpBuffer: 0 } }, 0.05) === false && buffered({ easy: false, settings: { jumpBuffer: 200 } }, 0.19) === true);
  const coyote = (opts, after) => {
    const h = loadPlayer(opts); h.place(0, 0); h.run(0.05, 60);     // a grounded frame sets the coyote time
    h.P.grounded = false; h.P.position.y = 30; h.P.velocity.set(0, 0, 0);
    let pressed = false; h.run(0.5, 120, (i, t) => { if (!pressed && i >= Math.round(after * 120)) { pressed = true; h.I.queueJump(); } });
    return h.ev('player:jump').length > 0;
  };
  check('coyote time: 70 ms after walking off an edge a jump still works (100 ms, normal)', coyote({ easy: false }, 0.07) === true);
  check('… 150 ms after it does not; easy mode (150 ms) still allows 130 ms', coyote({ easy: false }, 0.15) === false && coyote({ easy: true }, 0.13) === true);
  check('… the option: 0 ms = none (a press 20 ms after the edge does nothing)', coyote({ easy: false, settings: { coyoteMs: 0 } }, 0.02) === false);
  const g = loadPlayer({ easy: false, settings: { jumpBuffer: 0, coyoteMs: 0 } }); g.place(0, 0); g.I.queueJump(); g.run(0.2, 60);
  check('with both at 0 a jump from the ground still works', g.ev('player:jump').length === 1);
}

// ----------------------------------------------------------------------------------------------- low fences while running
{
  const fenceRun = (opts, fps, running = true) => {
    const h = loadPlayer(opts);
    h.W.addCollider({ shape: 'box', x: 0, z: -9, hw: 6, hd: 0.06, tag: 'fence' });          // a low fence (top 1.1) across the way
    h.place(0, 0, Math.PI); h.keys(0, 1, running);
    h.run(2, fps);
    return { z: h.P.position.z, jumps: h.ev('player:jump').length };
  };
  const a = fenceRun({ easy: true }, 60), b = fenceRun({ easy: true }, 30), c = fenceRun({ easy: true }, 10);
  check('running into a low fence (easy mode: on) goes over it without a jump key — 60, 30, 10 fps', a.z < -10 && b.z < -10 && c.z < -10 && a.jumps >= 1, `${f2(a.z)} · ${f2(b.z)} · ${f2(c.z)}`);
  const d = fenceRun({ easy: true, settings: { lowFences: false } }, 60);
  check('with the option off the fence stops the runner', d.z > -9 + 0.06 + 0.35 - 0.05 && d.jumps === 0, f2(d.z));
  const e = fenceRun({ easy: true }, 60, false);
  check('walking (not running) never jumps by itself', e.z > -9 + 0.06 + 0.35 - 0.05 && e.jumps === 0, f2(e.z));
  const f = loadPlayer({ easy: true }); f.W.addCollider({ shape: 'box', x: 0, z: -9, hw: 6, hd: 3, tag: 'B_HOUSE' }); f.place(0, 0, Math.PI); f.keys(0, 1, true); f.run(2, 60);
  check('a building is no fence: running into it never jumps', f.ev('player:jump').length === 0 && f.P.position.z > -6, f2(f.P.position.z));
  const jr = loadPlayer({ easy: true }); jr.W.addCollider({ shape: 'circle', x: 0, z: -9, r: 0.9, tag: 'onggi' }); jr.place(0, 0, Math.PI); jr.keys(0, 1, true); jr.run(2, 60);
  check('a big jar (a wide obstacle, 1.9 m deep) is no fence: no automatic hop', jr.ev('player:jump').length === 0, f2(jr.P.position.z));
  const g = loadPlayer({ easy: true }); g.W.addCollider({ shape: 'box', x: 0, z: -9, hw: 6, hd: 0.1, tag: 'stonewall' }); g.place(0, 0, Math.PI); g.keys(0, 1, true); g.run(2, 60);
  check('a stone wall (1.9 m) is too high for the automatic hop', g.ev('player:jump').length === 0 && g.P.position.z > -9, f2(g.P.position.z));
}

// ----------------------------------------------------------------------------------------------- stepping round a small thing
{
  const walkInto = (opts, build, steps = 4) => {
    const h = loadPlayer(opts); build(h); h.place(0, 0, Math.PI); h.keys(0, 1, false);
    let maxX = 0; h.run(steps, 60, () => { maxX = Math.max(maxX, Math.abs(h.P.position.x)); });
    return { x: h.P.position.x, z: h.P.position.z, maxX, h };
  };
  const pot = (h) => h.W.addCollider({ shape: 'circle', x: 0, z: -4, r: 0.3, tag: 'onggi' });
  const a = walkInto({ easy: false }, pot);
  const b = walkInto({ easy: false, settings: { stepAround: false, wallSlide: false } }, pot);
  check('a jar dead ahead: the player steps round it and walks on', a.z < -6, `${f2(a.x)}, ${f2(a.z)}`);
  check('… with the option off the player stays against it', b.z > -4 + 0.3 + 0.35 - 0.1 && Math.abs(b.x) < 0.05, `${f2(b.x)}, ${f2(b.z)}`);
  const w = walkInto({ easy: false }, (h) => h.W.addCollider({ shape: 'box', x: 0, z: -4, hw: 10, hd: 0.1, tag: 'stonewall' }));
  check('a long wall dead ahead: no drifting sideways along it, the player just stops', Math.abs(w.x) < 0.1 && w.z > -4 + 0.1 + 0.35 - 0.1 && w.z < -3, `${f2(w.x)}, ${f2(w.z)}`);
  const o = walkInto({ easy: false }, () => {}, 1);
  check('in the open nobody is nudged sideways (starting from a standstill, 1 s)', Math.abs(o.x) < 1e-9 && o.z < -6, `${f2(o.x)}, ${f2(o.z)}`);
  const r = walkInto({ easy: false }, (h) => { h.W.addCollider({ shape: 'circle', x: 0, z: -4, r: 0.3, tag: 'onggi' }); h.W.addCollider({ shape: 'circle', x: 1.0, z: -4, r: 0.3, tag: 'onggi' }); h.W.addCollider({ shape: 'circle', x: -1.0, z: -4, r: 0.3, tag: 'onggi' }); });
  check('a row of three jars: it finds the gap or stops — it never ends up inside one', r.h.W.blocked(r.x, r.z, 0.35 - 0.03, 0) === false, `${f2(r.x)}, ${f2(r.z)}`);
  const d = loadPlayer({ easy: false }); d.W.addCollider({ shape: 'circle', x: 0, z: -4, r: 0.3, tag: 'onggi' }); d.place(0, 0, Math.PI); d.keys(0, 1, true); d.run(3, 60);
  check('running into a jar: round it too', d.P.position.z < -7, f2(d.P.position.z));
}

// ----------------------------------------------------------------------------------------------- key events → input → player, at any frame rate
{
  /** the real 05-input.js and the real 21-player.js together: timestamped key events are delivered at the first frame after
   *  their time (as a browser does at a low frame rate), the frames run at `fps`; script = [[ms, 'down' | 'up', code], ...] */
  function combo(fps, script, seconds, opts = {}) {
    const p = inputPage({ easy: false, ...opts });
    const h = loadPlayer({ easy: false, ...opts });
    h.G.input = p.G.input;                                           // the player reads the real input
    p.G.bus.on('input:dash', (d) => h.G.bus.emit('input:dash', d)); p.G.bus.on('input:run', (d) => h.G.bus.emit('input:run', d));
    h.place(0, 0, Math.PI);
    const dt = 1 / fps, ev = script.slice().sort((a, b) => a[0] - b[0]);
    let i = 0, ms = 1000; const tl = [];
    const t0 = ms;
    for (let f = 0; f < Math.round(seconds * fps); f++) {
      ms += dt * 1000; p.T.now = ms; h.G.time.elapsed += dt;
      while (i < ev.length && t0 + ev[i][0] <= ms) { const [at, ty, code] = ev[i++]; p[ty](code, { ts: t0 + at }); }
      h.P.update(dt, h.G.time.elapsed);
      tl.push({ x: h.P.position.x, z: h.P.position.z, v: h.P.speed, st: h.P.moveState });
    }
    return { p, h, tl, end: tl[tl.length - 1] };
  }
  const near2 = (a, b, e) => Math.abs(a - b) <= e;
  // a left double tap (press 0, release 60, press 130, release 190) at 60 / 30 / 10 / 5 fps
  const dashes = [60, 30, 10, 5].map((fps) => combo(fps, [[100, 'down', 'KeyA'], [160, 'up', 'KeyA'], [230, 'down', 'KeyA'], [290, 'up', 'KeyA']], 1.5));
  const dd = dashes.map((c) => { const e = c.h.ev('player:dash')[0]; return e ? -(c.end.x - e.pos.x) : NaN; });   // from where the dash began (the first tap walked a step already)
  check('end to end: A A dashes 3.2 m to the left at 60, 30, 10 and 5 frames per second, the same distance from where it began', dd.every((d) => near2(d, 3.2, 0.1)) && dashes.every((c) => c.h.ev('player:dash').length === 1 && Math.abs(c.end.z) < 0.05), dd.map(f2).join(' · ') + ` (total with the first tap's step: ${dashes.map((c) => f2(-c.end.x)).join(' · ')})`);
  // a forward double tap with the second press held for 1.5 s, then released
  const runs = [60, 30, 10, 5].map((fps) => combo(fps, [[100, 'down', 'KeyW'], [160, 'up', 'KeyW'], [230, 'down', 'KeyW'], [1730, 'up', 'KeyW']], 3.0));
  check('end to end: W W (second held) runs at 14.4 m/s at every frame rate and ends when W is let go', runs.every((c) => { const mid = c.tl[Math.round(c.tl.length * 0.45)]; return near2(mid.v, 14.4, 0.4) && mid.st === 'run' && c.end.st === 'walk' && c.end.v < 0.5; }), runs.map((c) => `${f2(c.tl[Math.round(c.tl.length * 0.45)].v)} ${c.end.st}`).join(' · '));
  const dz = runs.map((c) => -c.end.z);
  check('end to end: …and it covers the same ground (± 3 m) at 60 and at 5 frames per second', Math.abs(dz[0] - dz[3]) < 3 && dz[0] > 18, dz.map(f2).join(' · '));
  // a single press, then one 600 ms later: nothing
  const slow = combo(60, [[100, 'down', 'KeyA'], [150, 'up', 'KeyA'], [700, 'down', 'KeyA'], [750, 'up', 'KeyA']], 1.5);
  check('end to end: A … A 600 ms apart is no dash (walks a little only)', slow.h.ev('player:dash').length === 0);
  // while a window is open nothing starts (the input is blocked)
  const blk = (() => { const q = inputPage({ easy: false }); const h = loadPlayer({ easy: false }); h.G.input = q.G.input; q.G.bus.on('input:dash', (d) => h.G.bus.emit('input:dash', d)); h.place(0, 0); q.T.blocking = true; h.I = q.G.input;
    for (const [ms, ty] of [[100, 'down'], [150, 'up'], [230, 'down'], [290, 'up']]) { q.T.now = 1000 + ms; q[ty]('KeyA', { ts: 1000 + ms }); } h.run(1, 60); return { n: h.ev('player:dash').length, x: h.P.position.x }; })();
  check('end to end: with a window open (input blocked) the same four events do nothing', blk.n === 0 && Math.abs(blk.x) < 0.01, J(blk));
}

// ----------------------------------------------------------------------------------------------- nothing odd
{
  const h = loadPlayer({}); h.place(0, 0);
  h.G.bus.emit('input:dash', { dir: 'left' }); h.run(0.25, 60, (i) => { if (i === 3) h.P.update(0, h.G.time.elapsed); });
  check('a frame with dt = 0 in the middle of a dash breaks nothing (no NaN)', Number.isFinite(h.P.position.x) && Number.isFinite(h.P.velocity.x) && h.log.error.length === 0 && h.log.warn.length === 0, `${h.log.warn.concat(h.log.error).join('|')}`);
}

const bad = results.filter((r) => !r.ok);
if (process.argv.includes('--json')) console.log(JSON.stringify({ total: results.length, failed: bad.length, results }, null, 1));
else console.log(`\n${results.length - bad.length}/${results.length} checks green${bad.length ? ' — FAILED: ' + bad.map((b) => b.name).join(' | ') : ''}`);
process.exit(bad.length ? 1 : 0);
