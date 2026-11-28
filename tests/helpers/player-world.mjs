// tests/helpers/player-world.mjs — the real src/game/06-world.js and src/game/21-player.js in a Node vm (no browser, no three.js):
// a small THREE stand-in, a fake input / camera / rig, and a driver that runs player.update(dt, t) frame by frame.
//   loadPlayer(opts) → { G, W, P (the player system), I (the fake input), run(seconds, fps, fn?), place(x, z), ... }
//   opts: { settings, easy, tier (speed multiplier 1..3), indoor (G.sys.places.noDoubleJump() → true), yaw (camera, rad) }
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SRC = (f) => fs.readFileSync(path.join(ROOT, 'src/game', f), 'utf8');

class V3 {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  copy(o) { this.x = o.x; this.y = o.y; this.z = o.z; return this; }
  clone() { return new V3(this.x, this.y, this.z); }
  length() { return Math.hypot(this.x, this.y, this.z); }
}
class M4 { constructor() { this.elements = new Array(16).fill(0); } makeRotationY() { return this; } setPosition() { return this; } }

export function loadPlayer(opts = {}) {
  const log = { warn: [], error: [] };
  const settings = Object.assign({ easyMode: opts.easy !== false, reduceMotion: false }, opts.settings || {});
  const events = [];
  const handlers = {};
  const bus = { on(t, fn) { (handlers[t] = handlers[t] || []).push(fn); return () => {}; }, emit(t, d) { events.push({ t, d }); for (const fn of (handlers[t] || []).slice()) fn(d); } };
  const camera = { mode: 'follow', yaw: opts.yaw || 0, kicks: [], getMoveBasis() { const s = Math.sin(this.yaw), c = Math.cos(this.yaw); return { forward: new V3(-s, 0, -c), right: new V3(c, 0, -s) }; }, kick(a) { this.kicks.push(a); }, shake() {} };
  // the fake input: the same surface 21-player reads (axis, running, gameplay, consumeJump, comfort)
  const I = {
    axis: { x: 0, y: 0 }, running: false, blocked: false, _jump: false,
    update() {}, gameplay() { return !I.blocked; }, consumeJump() { const j = I._jump; I._jump = false; return j; }, queueJump() { I._jump = true; },
    comfort: null,
  };
  const G = {
    util: { clamp: (v, a, b) => (v < a ? a : v > b ? b : v), angleDiff: (a, b) => { let d = b - a; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; }, escapeHtml: (s) => String(s) },
    data: {}, sys: { speed: { movement: () => opts.tier || 1 }, camera, places: { noDoubleJump: () => !!opts.indoor, current: null }, engine: { focus: new V3() } },
    log: { warn: (...a) => log.warn.push(a.map(String).join(' ')), error: (...a) => log.error.push(a.map(String).join(' ')), debug() {}, info() {} },
    bus, settings, state: { player: {}, profile: {} }, easy: { on: opts.easy !== false },
    time: { elapsed: 0 }, sfx: (n) => { G._sfx.push(n); }, _sfx: [], input: I, register(sys) { G._registered = sys; },
    fx: {}, ui: { label: () => ({ setVisible() {}, setHTML() {} }) }, avatar: {}, save: {},
  };
  const THREE = new Proxy({ Vector3: V3, Matrix4: M4 }, { get(t, k) { return k in t ? t[k] : class {}; } });
  const ctx = vm.createContext({ G, THREE, console, Math, Number, Object, Map, Array, String, Infinity, NaN, JSON, Set, performance: { now: () => G.time.elapsed * 1000 }, Float32Array, Uint8Array, Int32Array, Symbol, isFinite, parseInt, parseFloat });
  vm.runInContext(SRC('06-world.js'), ctx, { filename: '06-world.js' });
  const W = G.world;
  W.setTerrain(opts.terrain || (() => 0));
  vm.runInContext(SRC('21-player.js'), ctx, { filename: '21-player.js' });
  const P = G._registered;
  // the comfort options come from the real 05-input.js function when asked for (a Node vm with the fake DOM is too heavy here)
  const has = (k) => Object.prototype.hasOwnProperty.call(settings, k);
  const num = (k, d, dE) => (has(k) ? Number(settings[k]) : (settings.easyMode ? dE : d));
  const bool = (k, d, dE = d) => (has(k) ? !!settings[k] : (settings.easyMode ? dE : d));
  I.comfort = () => ({ alwaysRun: bool('alwaysRun', false), tapRun: bool('tapRun', true), dash: bool('dashOn', true), tapMs: num('tapWindow', 300, 360), jumpBufMs: num('jumpBuffer', 120, 180), coyoteMs: num('coyoteMs', 100, 150), wallSlide: bool('wallSlide', true), stepAround: bool('stepAround', true), lowFences: bool('lowFences', true) });
  // a player standing at the origin, ready
  P.position = new V3(0, 0, 0);
  P.object = { rotation: { y: 0 }, visible: true };
  P.rig = { update() {}, steps: 0, stopAction() {}, actionFullBody: null };
  P.nametag = { setVisible() {}, setHTML() {} };
  P._ready = true; P.grounded = true;
  P._writeState = () => {}; P._refreshTag = () => {};
  P._bindMoveEvents();   // what init() does for the double tap's events
  const d = {
    G, W, P, I, camera, events, log, settings,
    /** put the player at (x, z) on the ground, standing still, facing yaw */
    place(x, z, rotY = 0) { P.position.set(x, W.heightAt(x, z, 1), z); P.velocity.set(0, 0, 0); P.grounded = true; P.rotY = rotY; P._dash = null; P._dashAt = -1e9; P._burst = 0; P._coyote = 0; P._jumpBuf = 0; P.speed = 0; },
    /** advance `seconds` at `fps` frames per second; fn(frameIndex, t) runs before each frame (set the input there) */
    run(seconds, fps, fn) {
      const dt = 1 / fps, n = Math.round(seconds * fps);
      for (let i = 0; i < n; i++) { if (fn) fn(i, G.time.elapsed); G.time.elapsed += dt; P.update(dt, G.time.elapsed); }
    },
    ev(name) { return events.filter((e) => e.t === name).map((e) => e.d); },
    keys(x, y, running = false) { I.axis.x = x; I.axis.y = y; I.running = !!running; },
  };
  return d;
}
