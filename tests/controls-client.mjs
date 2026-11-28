#!/usr/bin/env node
// =============================================================================
// tests/controls-client.mjs — CONTRACT §17.1 controls in the browser (LOCAL mode, file:// page, quality=low):
//   pace × 1.2 measured as distance over time at tier 1 (walk 7.68, run 14.4 m/s) · jumps that clear a fence, a jar
//   row and a rock, the double jump over a 1.9 m stone wall (a single jump does not), landing on a wall top and stepping
//   off, a building that never yields · walkTo still plans round a fence · the three mouse-look modes through the seam
//   G.input.mouseLook (requestPointerLock / exitPointerLock replaced by fakes: headless Chromium cannot lock), hover-look
//   fallback with edge turning, release on a blocking UI, Esc, a click in lock = interact · [phase 10, §18.2] the
//   state chip, the Ctrl tap (fixed ↔ free) and the card that explains it · + / − and 0 (turn speed)
//   · wheel zoom range 2 … 22 m (easy 4.5 … 12.5) also while locked · the settings tiles · finite numbers · the phone
//   is unchanged (drag, no lock requests).
//   [phase 11, §19.3] group `dash`: REAL key events (page.keyboard, fired without waiting for each other so the browser stamps
//   them a few ms apart whatever the frame rate) — forward tapped twice and held runs until it is let go, left / right / back
//   tapped twice dash ≈ 3.2 m relative to the camera and never run, a window or a fence stops it, the events' own timestamps
//   decide (two synthetic events stamped 1 ms apart but handled 600 ms later still count), the sound, the camera kick (not
//   with reduce-motion), the options; on the phone the same with two quick flicks of the stick.
//
//   node tests/controls-client.mjs                       builds a private page (--no-assets) in a temp directory
//   node tests/controls-client.mjs --file /abs/page.html test an already built page
//   options: --json · --headed · --timeout <ms> · --skip-phone · --set <k=v,…> · --only <a,b> (groups: pace, jump, walkto, look, keys,
//            zoom, settings, dash, phone)
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
const TIMEOUT = Number(opt('--timeout', '300000'));
const jsonOut = flag('--json');
const only = (opt('--only', '') || '').split(',').filter(Boolean);
const presets = (opt('--set', '') || '').split(',').filter(Boolean).map((kv) => kv.split('=')).map(([k, v]) => [k, v === 'true' ? true : v === 'false' ? false : Number.isFinite(Number(v)) ? Number(v) : v]);   // --set a=1,b=false: settings applied after the page is up (to tell which option changes a result)
const want = (g) => !only.length || only.includes(g);
const log = (...a) => { if (!jsonOut) console.log(...a); };

let file = opt('--file');
if (!file) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tfm-controls-'));
  file = path.join(tmp, 'index.html');
  const b = spawnSync(process.execPath, [path.join(ROOT, 'tools/build.mjs'), '--no-font', '--quiet', '--no-assets', '--out', file], { encoding: 'utf8' });
  if (b.status !== 0) { console.error(b.stderr || b.stdout); process.exit(2); }
}
if (!fs.existsSync(file)) { console.error(`page not found: ${file}`); process.exit(2); }

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail: String(detail ?? '').slice(0, 500) }); log(`${ok ? '  ✔' : '  ✖'} ${name}${detail !== '' && detail != null ? ` — ${String(detail).slice(0, 300)}` : ''}`); };

const browser = await chromium.launch({ headless: !flag('--headed'), args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--autoplay-policy=no-user-gesture-required'] });
const pageErrors = [], consoleErrors = [];
async function open(tag, ctxOpts) {
  const context = await browser.newContext({ locale: 'ko-KR', timezoneId: 'Asia/Seoul', viewport: { width: 960, height: 540 }, ...ctxOpts });
  const page = await context.newPage();
  await page.route('**/*', (route) => (/^(file|data|blob):/.test(route.request().url()) ? route.continue() : route.abort()));
  page.on('pageerror', (e) => pageErrors.push(`[${tag}] ${String(e?.message || e).slice(0, 300)}`));
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(`[${tag}] ${m.text().slice(0, 300)}`); });
  return { page, context };
}
async function boot(page, extra = '') {
  await page.goto(`${pathToFileURL(file).href}?autostart=1&notutorial=1&quality=low${extra}`, { waitUntil: 'load', timeout: TIMEOUT });
  await page.waitForFunction(() => window.G && window.G.ready === true && !!window.G.state && !!window.G.sys?.player?._ready, null, { timeout: TIMEOUT, polling: 250 });
  await page.evaluate(() => { try { G.ui.modal.closeAll(); } catch (e) { /* nothing open */ } });
  if (presets.length) await page.evaluate((kv) => { for (const [k, v] of kv) G.setSetting(k, v); }, presets);
}

/** in-page helpers (installed once per page) */
const HELPERS = () => {
  /** a mousemove with movementX / Y set (Chromium ignores them in MouseEventInit) */
  window.__mm = (target, o) => { const e = new MouseEvent('mousemove', { bubbles: true, clientX: o.clientX ?? 0, clientY: o.clientY ?? 0, buttons: o.buttons ?? 0 }); Object.defineProperty(e, 'movementX', { value: o.movementX || 0 }); Object.defineProperty(e, 'movementY', { value: o.movementY || 0 }); target.dispatchEvent(e); };
  const P = () => G.sys.player, W = G.world;
  const raf = () => new Promise((r) => requestAnimationFrame(() => r()));
  const H = window.__ct = {
    raf,
    /** game time (the player's own dt, summed): software GL here runs at 2–10 fps and the engine clamps dt */
    gt() { return P().__gt || 0; },
    async waitGame(sec, maxWall = 60000) { const g0 = H.gt(), t0 = performance.now(); while (H.gt() - g0 < sec && performance.now() - t0 < maxWall) await raf(); },
    async ready(maxWall = 90000) {
      const t0 = performance.now();
      while (performance.now() - t0 < maxWall) {
        try { G.ui.modal.closeAll(); } catch (e) { /* none */ }
        if (G.input.gameplay() && P().enabled && P()._ready && !G.sys.manjangdae?.introActive && G.sys.camera?.mode === 'follow') return true;
        await raf();
      }
      return false;
    },
    diag() { const p = P(); return { gameplay: G.input.gameplay(), enabled: p.enabled, cam: G.sys.camera?.mode, intro: !!G.sys.manjangdae?.introActive, axis: { ...G.input.axis }, gt: +H.gt().toFixed(2), blocking: !!G.ui?.isBlocking?.() }; },
    async wait(ms) { const t0 = performance.now(); while (performance.now() - t0 < ms) await raf(); },
    key(code, down, key) { window.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code, key: key || code, bubbles: true, cancelable: true })); },
    release() { for (const c of ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ShiftLeft', 'Space']) H.key(c, false); G.input.reset(); },
    /** stand at (x, z) facing (dx, dz), the camera behind, still */
    async place(x, z, dx, dz) {
      const p = P();
      p.cancelWalk?.('test');
      if (p.sitting) p.standUp?.();
      const y = W.heightAt(x, z, Infinity);
      p.position.set(x, y, z); p.velocity.set(0, 0, 0); p.grounded = true; p._vaultUntil = 0; p.lastVault = null;
      const ry = Math.atan2(dx, dz);
      p.rotY = ry; G.sys.camera.behind(ry, true); G.sys.camera.snap?.();
      await H.raf(); await H.raf();
      p.position.set(x, W.heightAt(x, z, Infinity), z); p.velocity.set(0, 0, 0);
      G.sys.camera.behind(ry, true);
      await H.raf();
    },
    /** free at (x, z) for a standing walker? (no collider, no water, inside the bounds) */
    free(x, z, r = 0.5) { const b = W.bounds; if (!(x > b.minX + 2 && x < b.maxX - 2 && z > b.minZ + 2 && z < b.maxZ - 2)) return false; return !W.isWater(x, z) && !W.blocked(x, z, r, W.heightAt(x, z, Infinity)); },
    /** a straight run of `len` m from (x, z) along (dx, dz) with no blocker, no water, gentle ground */
    clearRun(x, z, dx, dz, len) {
      let y0 = W.heightAt(x, z, Infinity);
      for (let d = 0; d <= len; d += 0.5) {
        const px = x + dx * d, pz = z + dz * d;
        if (!H.free(px, pz, 0.9)) return false;
        const y = W.heightAt(px, pz, Infinity);
        if (Math.abs(y - y0) > 0.22) return false;
        y0 = y;
      }
      return true;
    },
    findRun(len) {
      const sp = G.data.layout?.spawn || { x: 0, z: 9 };
      for (let rad = 0; rad <= 110; rad += 10) for (let a = 0; a < 16; a++) {
        const cx = sp.x + Math.cos(a * 0.39) * rad, cz = sp.z + Math.sin(a * 0.39) * rad;
        if (!H.free(cx, cz, 1)) continue;
        for (let k = 0; k < 16; k++) { const dx = Math.cos(k * Math.PI / 8), dz = Math.sin(k * Math.PI / 8); if (H.clearRun(cx, cz, dx, dz, len)) return { x: cx, z: cz, dx, dz }; }
      }
      return null;
    },
    /** hold the movement key (and Shift) for ms; samples (t, x, z) every frame */
    async hold(ms, run) {
      const s = [];
      H.key('KeyW', true); if (run) H.key('ShiftLeft', true);
      const g0 = H.gt(), t0 = performance.now();
      while ((H.gt() - g0) * 1000 < ms && performance.now() - t0 < ms * 12) { await raf(); const p = P().position; s.push([(H.gt() - g0) * 1000, p.x, p.z]); }
      H.key('KeyW', false); if (run) H.key('ShiftLeft', false);
      return s;
    },
    /** a jump while walking at (dx, dz): Space after `delay` ms, optional second Space near the top; holds W `ms` */
    async jump({ x, z, dx, dz, delay = 160, dbl = false, ms = 1600 }) {
      await H.place(x, z, dx, dz);
      const p = P();
      let maxY = -Infinity, y0 = p.position.y, sent2 = false, vault1 = null, vault2 = null;
      H.key('KeyW', true);
      const g0 = H.gt(), t0 = performance.now();
      let jumped = false, jumpAt = 0, leftGround = false;
      // presses come from the player's own frame (game time), so a 2 fps page still double-jumps near the top
      H.onTick = (pl) => {
        const t = (H.gt() - g0) * 1000;
        if (!jumped && t >= delay) { H.key('Space', true); H.key('Space', false); jumped = true; jumpAt = t; return; }
        if (jumped && !pl.grounded) leftGround = true;
        if (dbl && leftGround && !sent2 && !pl.grounded && pl.velocity.y < 2.2) { H.key('Space', true); H.key('Space', false); sent2 = true; }
      };
      while ((H.gt() - g0) * 1000 < ms && performance.now() - t0 < ms * 15) {
        await raf();
        if (jumped && !vault1 && p.lastVault) vault1 = { ...p.lastVault };
        if (sent2 && !vault2 && p.lastVault && p.lastVault.n === 2) vault2 = { ...p.lastVault };
        if (p.position.y > maxY) maxY = p.position.y;
        if (leftGround && p.grounded && (H.gt() - g0) * 1000 > jumpAt + 500) break;
      }
      H.onTick = null;
      H.key('KeyW', false);
      for (let i = 0; i < 6; i++) await raf();
      const q = p.position;
      return { x: q.x, y: q.y, z: q.z, maxY, y0, grounded: p.grounded, vault1, vault2, sent2, finite: [q.x, q.y, q.z, p.velocity.x, p.velocity.y, p.velocity.z, p.rotY].every(Number.isFinite) };
    },
    cols(pred) { const out = []; for (const c of W.colliders.values()) if (!c.disabled && pred(c)) out.push(c); return out; },
    normalZ(c) { const r = c.rot || 0; return [Math.sin(r), Math.cos(r)]; },   // local +z in world (06-world toWorld)
    normalX(c) { const r = c.rot || 0; return [Math.cos(r), -Math.sin(r)]; },  // local +x in world
  };
  const p0 = P();
  if (!p0.__ctWrapped) {
    const orig = p0.update;
    p0.__gt = 0; p0.__ctWrapped = true;
    p0.update = function (dt, t) { if (dt > 0 && Number.isFinite(dt)) p0.__gt += dt; try { H.onTick?.(p0); } catch (e) { /* test hook */ } return orig.call(this, dt, t); };
  }
  return true;
};

async function mainPage() {
  const { page, context } = await open('main');
  await boot(page, '&mouselook=lock');
  await page.evaluate(HELPERS);
  await page.evaluate(() => { G.sys.weather?.setAuto?.(false); });
  // ------------------------------------------------------------------------------------------------ pace
  if (want('pace')) {
    const r = await page.evaluate(async () => {
      const H = window.__ct, p = G.sys.player;
      const rdy = await H.ready();
      const run = H.findRun(56);
      if (!run) return { err: 'no clear straight run of 56 m found' };
      const speed = (s) => { const a = s.find((q) => q[0] >= 900) || s[0], b = s[s.length - 1]; return Math.hypot(b[1] - a[1], b[2] - a[2]) / Math.max(1e-3, (b[0] - a[0]) / 1000); };
      await H.place(run.x, run.z, run.dx, run.dz);
      const w = await H.hold(3200, false);
      await H.wait(500);
      await H.place(run.x, run.z, run.dx, run.dz);
      const rr = await H.hold(3200, true);
      return { rdy, diag: H.diag(), run, walk: speed(w), runV: speed(rr), mul: G.sys.speed?.movement?.() ?? 1, WALK: p.WALK, RUN: p.RUN, frames: w.length, scale: p.speedScale };
    });
    if (r.err) check('pace: a clear straight run for the measurement', false, r.err);
    else {
      check('pace constants: WALK 7.68 / RUN 14.4 (× 1.2), speedScale 2.4', r.WALK === 7.68 && r.RUN === 14.4 && r.scale === 2.4, `${r.WALK} / ${r.RUN} · ${r.scale}`);
      check('pace: walking measured ≈ 7.68 m/s at tier 1 (distance over time)', r.mul === 1 && Math.abs(r.walk - 7.68) <= 7.68 * 0.1, `${r.walk.toFixed(2)} m/s (game time) over ${r.frames} frames, tier ×${r.mul} · ${JSON.stringify(r.diag)}`);
      check('pace: running measured ≈ 14.4 m/s at tier 1', Math.abs(r.runV - 14.4) <= 14.4 * 0.1, `${r.runV.toFixed(2)} m/s`);
    }
  }
  // ------------------------------------------------------------------------------------------------ jumps
  if (want('jump')) {
    // a fence of the crop field: a plain walk stops at it, a jump clears it
    const f = await page.evaluate(async () => {
      const H = window.__ct, W = G.world;
      for (const c of H.cols((c) => c.tag === 'fence' && c.shape === 'box' && c.hw > 1.2)) {
        const [nx, nz] = H.normalZ(c);
        for (const s of [1, -1]) {
          const d0 = c.hd + 0.35 + 1.0, d1 = c.hd + 0.35 + 1.8;
          const sx = c.x + nx * s * d0, sz = c.z + nz * s * d0, lx = c.x - nx * s * d1, lz = c.z - nz * s * d1;
          if (!H.free(sx, sz) || !H.free(lx, lz) || !H.free(c.x - nx * s * (d1 + 1.5), c.z - nz * s * (d1 + 1.5))) continue;
          if (Math.abs(W.heightAt(sx, sz, Infinity) - W.heightAt(lx, lz, Infinity)) > 0.3) continue;
          const o = W.obstacleAhead(sx, sz, -nx * s, -nz * s, 0.35, W.heightAt(sx, sz, Infinity), 1.6, 4.5);
          if (!o || o.tall) continue;
          const side = (q) => ((q.x - c.x) * nx + (q.z - c.z) * nz) * s;
          // control: walk into it without jumping
          await H.place(sx, sz, -nx * s, -nz * s);
          await H.hold(1300, false);
          const plain = side(G.sys.player.position);
          const j = await H.jump({ x: sx, z: sz, dx: -nx * s, dz: -nz * s });
          return { ok: true, plain, after: side(j), j, top: W.topOf(c), ground: W.heightAt(sx, sz, Infinity), hd: c.hd };
        }
      }
      return { ok: false };
    });
    if (!f.ok) check('jump: a crop-field fence to try', false, 'no fence with free ground on both sides');
    else {
      check('fence: walking into it without a jump stops in front of it', f.plain > f.hd + 0.3, f.plain.toFixed(2));
      check('fence: top inferred ≈ 1.1 m above the ground', Math.abs(f.top - f.ground - 1.1) < 0.35, (f.top - f.ground).toFixed(2));
      check('fence: a jump while walking clears it (vault assist)', f.after < -(f.hd + 0.3) && f.j.finite, `side ${f.after.toFixed(2)} · peak +${(f.j.maxY - f.j.y0).toFixed(2)} m · vault ${JSON.stringify(f.j.vault1)}`);
    }
    // a jar row (jangdokdae rows on stone slabs, else a ring of jars)
    const jr = await page.evaluate(async () => {
      const H = window.__ct, W = G.world;
      const rows = H.cols((c) => c.tag === 'jars' && c.shape === 'box');
      for (const c of rows) {
        const [nx, nz] = H.normalX(c), half = c.hw;
        for (const s of [1, -1]) {
          const d0 = half + 0.35 + 1.0, d1 = half + 0.35 + 0.45;
          const sx = c.x + nx * s * d0, sz = c.z + nz * s * d0, lx = c.x - nx * s * d1, lz = c.z - nz * s * d1;
          if (!H.free(sx, sz, 0.4) || !H.free(lx, lz, 0.38) || !H.free(c.x + nx * s * (half + 0.5), c.z + nz * s * (half + 0.5), 0.38)) continue;
          const y0 = W.heightAt(sx, sz, Infinity);
          if (Math.abs(y0 - W.heightAt(lx, lz, Infinity)) > 0.3) continue;
          const side = (q) => ((q.x - c.x) * nx + (q.z - c.z) * nz) * s;
          const j = await H.jump({ x: sx, z: sz, dx: -nx * s, dz: -nz * s });
          return { ok: true, after: side(j), j, half, top: W.topOf(c) - y0, n: rows.length };
        }
      }
      // no row with room on both sides: a test row of five jars (r 0.45, 1.25 m apart) in an open field
      const run = H.findRun(10);
      if (!run) return { ok: false, n: rows.length };
      const cx = run.x + run.dx * 4, cz = run.z + run.dz * 4, px = -run.dz, pz = run.dx, ids = [];
      for (let k = -2; k <= 2; k++) ids.push(W.addCollider({ shape: 'circle', x: cx + px * k * 1.25, z: cz + pz * k * 1.25, r: 0.45, tag: 'jar' }));
      const side = (q) => (q.x - cx) * run.dx + (q.z - cz) * run.dz;
      const y0 = W.heightAt(run.x, run.z, Infinity);
      const top = W.topOf(W.colliders.get(ids[2])) - W.heightAt(cx, cz, Infinity);
      const j = await H.jump({ x: cx - run.dx * 1.8, z: cz - run.dz * 1.8, dx: run.dx, dz: run.dz });
      for (const id of ids) W.removeCollider(id);
      return { ok: true, synthetic: true, after: -side(j), j, half: 0.45, top, n: rows.length };
    });
    if (!jr.ok) check('jump: a jar row to try', false, `rows ${jr.n}, none with free ground on both sides`);
    else check(`jar row${jr.synthetic ? ' (a test row of 5 jars)' : ''}: a jump while walking clears the row of jars`, jr.after < -(jr.half + 0.3) && jr.j.finite, `side ${jr.after.toFixed(2)} · top +${jr.top.toFixed(2)} · peak +${(jr.j.maxY - jr.j.y0).toFixed(2)} · ${JSON.stringify(jr.j.vault1)}`);
    // a rock
    const rk = await page.evaluate(async () => {
      const H = window.__ct, W = G.world;
      const rocks = H.cols((c) => c.tag === 'rock' && c.shape === 'circle' && c.r >= 0.35 && c.r <= 1.3 && Number.isFinite(c.maxY));
      for (const c of rocks) {
        const g = W.heightAt(c.x, c.z, Infinity), hgt = c.maxY - g;
        if (!(hgt > 0.35 && hgt < 1.5)) continue;
        for (let k = 0; k < 8; k++) {
          const dx = Math.cos(k * Math.PI / 4), dz = Math.sin(k * Math.PI / 4);
          const d0 = c.r + 0.35 + 1.0, d1 = c.r + 0.35 + 1.4;
          const sx = c.x - dx * d0, sz = c.z - dz * d0, lx = c.x + dx * d1, lz = c.z + dz * d1;
          const gs = W.heightAt(sx, sz, Infinity);
          if (!H.free(sx, sz) || !H.free(lx, lz) || Math.abs(gs - W.heightAt(lx, lz, Infinity)) > 0.25 || Math.abs(gs - g) > 0.2) continue;
          if (!(c.maxY - gs > 0.35 && c.maxY - gs < 1.5)) continue;
          const o = W.obstacleAhead(sx, sz, dx, dz, 0.35, W.heightAt(sx, sz, Infinity), 1.6, 4.5);
          if (!o || o.tall) continue;
          const j = await H.jump({ x: sx, z: sz, dx, dz });
          const along = (j.x - c.x) * dx + (j.z - c.z) * dz;
          return { ok: true, along, onTop: Math.abs(j.y - c.maxY) < 0.15 && Math.hypot(j.x - c.x, j.z - c.z) <= c.r + 0.05, r: c.r, hgt, j };
        }
      }
      return { ok: false, n: rocks.length };
    });
    if (!rk.ok) check('jump: a rock to try', false, `rocks ${rk.n}`);
    else check('rock: a jump clears it (or lands on its top)', (rk.along > rk.r + 0.3 || rk.onTop) && rk.j.finite, `along ${rk.along.toFixed(2)} r ${rk.r.toFixed(2)} h ${rk.hgt.toFixed(2)} onTop ${rk.onTop} · ${JSON.stringify(rk.j.vault1)}`);
    // a 1.9 m stone wall (a test wall in an open field): single fails, double clears; a deep wall: land on its top
    const sw = await page.evaluate(async () => {
      const H = window.__ct, W = G.world;
      const run = H.findRun(16);
      if (!run) return { ok: false };
      const cx = run.x + run.dx * 8, cz = run.z + run.dz * 8, rot = Math.atan2(run.dx, run.dz);
      const id = W.addCollider({ shape: 'box', x: cx, z: cz, hw: 3, hd: 0.3, rot, tag: 'stonewall' });
      const c = W.colliders.get(id);
      const [nx, nz] = H.normalZ(c);   // local +z = the run direction
      const side = (q) => (q.x - cx) * nx + (q.z - cz) * nz;
      const sx = cx - nx * (0.3 + 0.35 + 1.0), sz = cz - nz * (0.3 + 0.35 + 1.0);
      const g = W.heightAt(sx, sz, Infinity);
      let gmax = -Infinity;
      for (const [a, b] of [[0, 0], [-3, -0.3], [3, -0.3], [3, 0.3], [-3, 0.3]]) { const x = cx + a * Math.cos(rot) + b * Math.sin(rot), z = cz - a * Math.sin(rot) + b * Math.cos(rot); gmax = Math.max(gmax, W.heightAt(x, z, Infinity)); }
      const single = await H.jump({ x: sx, z: sz, dx: nx, dz: nz });
      const dbl = await H.jump({ x: sx, z: sz, dx: nx, dz: nz, dbl: true, ms: 2200 });
      W.removeCollider(id);
      // the deep wall: one may land on its top and walk off it
      const id2 = W.addCollider({ shape: 'box', x: cx, z: cz + 0, hw: 3, hd: 2.6, rot, tag: 'stonewall' });
      const c2 = W.colliders.get(id2);
      const sx2 = cx - nx * (2.6 + 0.35 + 0.9), sz2 = cz - nz * (2.6 + 0.35 + 0.9);
      const land = await H.jump({ x: sx2, z: sz2, dx: nx, dz: nz, dbl: true, ms: 1700 });
      const top = W.topOf(c2);
      const onTop = Math.abs(land.y - top) < 0.12 && land.grounded;
      // walk off the far edge
      H.key('KeyW', true); await H.waitGame(1.4); H.key('KeyW', false); await H.waitGame(0.9);
      const p = G.sys.player.position, off = { y: p.y, side: (p.x - cx) * nx + (p.z - cz) * nz, grounded: G.sys.player.grounded };
      W.removeCollider(id2);
      return { ok: true, g, gmax, top: W.topOf(c), single: side(single), dbl: side(dbl), dblRes: dbl, onTop, landY: land.y, top2: top, off, land };
    });
    if (!sw.ok) check('jump: an open field for the stone wall', false);
    else {
      check('stone wall: top inferred 1.9 m above the highest ground under it', Math.abs(sw.top - sw.gmax - 1.9) < 0.05, `${(sw.top - sw.gmax).toFixed(2)} (${(sw.top - sw.g).toFixed(2)} above the take-off)`);
      check('stone wall: a single jump does not get over 1.9 m', sw.single < 0, sw.single.toFixed(2));
      check('stone wall: the double jump clears it', sw.dbl > 0.3 + 0.3 && sw.dblRes.sent2 && sw.dblRes.finite, `side ${sw.dbl.toFixed(2)} · peak +${(sw.dblRes.maxY - sw.dblRes.y0).toFixed(2)} · ${JSON.stringify(sw.dblRes.vault2)}`);
      check('wall top: a double jump lands ON a deep wall (stand)', sw.onTop, `y ${sw.landY.toFixed(2)} top ${sw.top2.toFixed(2)} grounded ${sw.land.grounded}`);
      check('wall top: walking off it brings the feet back to the ground', sw.off.grounded && sw.off.y < sw.top2 - 1 && sw.off.side > 2.6, JSON.stringify(sw.off));
    }
    // a building never yields (single + double jump straight at it)
    const bd = await page.evaluate(async () => {
      const H = window.__ct, W = G.world;
      for (const c of H.cols((c) => /^B_/.test(String(c.tag || '')) && c.shape === 'box' && c.hw > 1.5 && c.hd > 1.5 && !Number.isFinite(c.maxY))) {
        const [nx, nz] = H.normalZ(c);
        const d0 = c.hd + 0.35 + 0.8, sx = c.x + nx * d0, sz = c.z + nz * d0;
        if (!H.free(sx, sz)) continue;
        const o = W.obstacleAhead(sx, sz, -nx, -nz, 0.35, W.heightAt(sx, sz, Infinity), 1.6, 4.5);
        if (!o || !o.tall) continue;
        const j = await H.jump({ x: sx, z: sz, dx: -nx, dz: -nz, dbl: true, ms: 2000 });
        const side = (j.x - c.x) * nx + (j.z - c.z) * nz;
        return { ok: true, tag: c.tag, side, hd: c.hd, j };
      }
      return { ok: false };
    });
    if (!bd.ok) check('jump: a building wall to try', false);
    else check(`building (${bd.tag}): a double jump at its wall never gets in`, bd.side >= bd.hd + 0.3 && bd.j.finite && !bd.j.vault2?.vy, `side ${bd.side.toFixed(2)} (wall at ${bd.hd.toFixed(2)}) · ${JSON.stringify(bd.j.vault2)}`);
  }
  // ------------------------------------------------------------------------------------------------ walkTo still plans
  if (want('walkto')) {
    const wt = await page.evaluate(async () => {
      const H = window.__ct, W = G.world, P = G.sys.player;
      for (const c of H.cols((c) => c.tag === 'fence' && c.shape === 'box' && c.hw > 2)) {
        const [nx, nz] = H.normalZ(c);
        const sx = c.x + nx * 2.2, sz = c.z + nz * 2.2, tx = c.x - nx * 2.2, tz = c.z - nz * 2.2;
        if (!H.free(sx, sz) || !H.free(tx, tz)) continue;
        await H.place(sx, sz, -nx, -nz);
        const route = P.planPath({ x: sx, z: sz }, { x: tx, z: tz }, 0.6);
        if (!route || route.length < 2) continue;
        let len = 0, through = false;
        for (let i = 1; i < route.length; i++) {
          const a = route[i - 1], b = route[i], L = Math.hypot(b.x - a.x, b.z - a.z); len += L;
          for (let t = 0; t <= 1; t += 0.05) { const x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t; const r = (x - c.x) * (Math.cos(c.rot || 0)) - (z - c.z) * Math.sin(c.rot || 0), q = (x - c.x) * Math.sin(c.rot || 0) + (z - c.z) * Math.cos(c.rot || 0); if (Math.abs(r) <= c.hw && Math.abs(q) <= c.hd) through = true; }
        }
        let minY = Infinity, maxY = -Infinity, arrived = null, failed = null;
        await H.ready(20000);
        const off = G.bus.on('player:arrived', (e) => { arrived = e; });
        const id = P.walkTo({ x: tx, z: tz }, { rescue: false, trail: false, stopDistance: 0.8, onFail: (r) => { failed = r || 'fail'; } });
        const t0 = performance.now(), g0 = H.gt();
        while (!arrived && !failed && H.gt() - g0 < 12 && performance.now() - t0 < 120000) { await H.raf(); const y = P.position.y - W.heightAt(P.position.x, P.position.z, Infinity); if (y < minY) minY = y; if (y > maxY) maxY = y; }
        try { off?.(); } catch (e) { /* bus off */ }
        return { ok: true, len, straight: 4.4, through, arrived: !!arrived, rescued: !!arrived?.rescued, maxY, pts: route.length, id, failed: String(failed || ''), diag: H.diag(), pos: { x: +P.position.x.toFixed(2), z: +P.position.z.toFixed(2) }, to: { x: +tx.toFixed(2), z: +tz.toFixed(2) } };
      }
      return { ok: false };
    });
    if (!wt.ok) check('walkTo: a fence to plan round', false);
    else {
      check('walkTo: the planner still goes round the fence (no route through it)', !wt.through && wt.len > wt.straight * 1.05, `${wt.pts} corners, ${wt.len.toFixed(1)} m vs 4.4 m straight`);
      check('walkTo: arrives on foot (no rescue, never airborne)', wt.arrived && !wt.rescued && wt.maxY < 0.4, `arrived ${wt.arrived} rescued ${wt.rescued} maxY ${wt.maxY.toFixed(2)} id ${wt.id} fail ${wt.failed} at ${JSON.stringify(wt.pos)} → ${JSON.stringify(wt.to)} ${JSON.stringify(wt.diag)}`);
    }
  }
  // ------------------------------------------------------------------------------------------------ mouse look
  if (want('look')) {
    const lk = await page.evaluate(async () => {
      const H = window.__ct, ML = G.input.mouseLook, cam = G.sys.camera, el = document.getElementById('game-container');
      const out = {};
      out.query = ML.state();
      let locked = null, req = 0, ex = 0;
      ML.setApi({ request: (e) => { req++; locked = e; setTimeout(() => ML.lockChanged(), 0); return true; }, exit: () => { ex++; locked = null; setTimeout(() => ML.lockChanged(), 0); }, element: () => locked });
      H.release(); await H.wait(150);
      // ---- lock: a movement key captures, the mouse turns yaw + pitch, dot + chip
      ML.setMode('lock');
      H.key('KeyW', true); await H.wait(120); H.key('KeyW', false); await H.wait(150);
      const s1 = ML.state();
      out.lockKey = { locked: s1.locked, req, mode: s1.mode, dot: !document.getElementById('ml-dot')?.hidden, chip: document.getElementById('ml-chip')?.textContent || '', coach: s1.coach };
      // ---- [phase 10] the card that explains the key (shown at the first calm moment; again on request)
      ML.coach();
      out.card = { text: document.querySelector('#ml-coach .ml-coach-text')?.textContent || '', key: !!document.querySelector('#ml-coach svg text'), say: document.getElementById('ml-coach')?.dataset.say || '' };
      // ---- [phase 10] a clean tap of Ctrl frees the pointer; the keys then walk with a free pointer; another tap fixes it
      // (down and up back to back: on software GL a 60 ms timer can fire a whole frame — over a second — later)
      const tap = async (code) => { H.key(code, true, 'Control'); H.key(code, false, 'Control'); await H.wait(120); };
      await tap('ControlLeft');
      const f1 = ML.state(), reqFree = req;
      H.key('KeyW', true); await H.wait(100); H.key('KeyW', false); await H.wait(120);
      const keyRelock = req > reqFree;
      // not a tap: another key between down and up
      H.key('ControlLeft', true, 'Control'); H.key('KeyV', true); H.key('KeyV', false); H.key('ControlLeft', false, 'Control'); await H.wait(120);   // (V: a key no window listens to)
      const chord = ML.state();
      await tap('ControlRight');
      const f2 = ML.state();
      out.ctrl = { freed: !f1.locked && f1.free === 'ctrl', chipFree: f1.chip, keyRelock, chordLocked: chord.locked, relocked: f2.locked && f2.free === null, chipFixed: f2.chip, taps: f2.taps };
      const y0 = cam._yawT, p0 = cam._pitchT;
      __mm(document, { movementX: 120, movementY: 40 });
      await H.raf(); await H.raf();
      out.turn = { dyaw: cam._yawT - y0, dpitch: cam._pitchT - p0 };
      // a hostile delta never poisons the camera
      __mm(document, { movementX: 1e12, movementY: -1e12 });
      ML.feed(NaN, Infinity);
      await H.wait(100);
      out.finite = [cam.yaw, cam.pitch, cam._yawT, cam._pitchT, cam.distance].every(Number.isFinite);
      // ---- a click while locked is the interact key (no walk-to)
      let interact = 0, clicks = 0;
      const o1 = G.bus.on('input:interact', () => interact++), o2 = G.bus.on('input:click', () => clicks++);
      el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 7, pointerType: 'mouse', button: 0, buttons: 1, clientX: 400, clientY: 300 }));
      el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 7, pointerType: 'mouse', button: 0, buttons: 0, clientX: 400, clientY: 300 }));
      await H.wait(60);
      out.lockClick = { interact, clicks };
      // ---- a blocking UI (modal / gate / chat) releases at once; the next movement key takes it again
      G.ui.block('ct-test'); await H.wait(200);
      out.blocked = { locked: ML.state().locked, ex };
      G.ui.unblock('ct-test'); await H.wait(60);
      H.key('KeyD', true); await H.wait(120); H.key('KeyD', false); await H.wait(150);
      out.relock = { locked: ML.state().locked, req };
      // ---- Esc (the browser takes the pointer back): keys no longer re-take it, a click on the view does
      locked = null; ML.lockChanged(); await H.wait(60);
      const reqBefore = req;
      H.key('KeyW', true); await H.wait(100); H.key('KeyW', false); await H.wait(150);
      out.esc = { userReleased: ML.state().userReleased, keyRelock: req > reqBefore };
      el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 8, pointerType: 'mouse', button: 0, buttons: 1, clientX: 420, clientY: 300 }));
      el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 8, pointerType: 'mouse', button: 0, buttons: 0, clientX: 420, clientY: 300 }));
      await H.wait(150);
      out.escClick = { locked: ML.state().locked, clicks };
      try { o1?.(); o2?.(); } catch (e) { /* off */ }
      // ---- wheel zoom works while locked
      const d0 = cam._distT;
      for (let i = 0; i < 3; i++) el.dispatchEvent(new WheelEvent('wheel', { deltaY: 180, bubbles: true, cancelable: true }));
      await H.wait(100);
      out.wheelLocked = cam._distT - d0;
      // ---- walk: locked only while a movement key is held (+ 1.2 s)
      ML.setMode('walk'); await H.wait(100);
      out.walkModeReleased = !ML.state().locked;
      H.key('KeyW', true); await H.wait(400);
      const wl = ML.state().locked;
      H.key('KeyW', false); const tUp = performance.now(); await H.raf();
      const stillHeld = ML.state().locked, why05 = ML.state().lastReason, dtUp = Math.round(performance.now() - tUp);
      await H.wait(1500);
      out.walk = { whileHeld: wl, after05: stillHeld, after18: ML.state().locked, why05, dtUp, why: ML.state().lastReason };
      // ---- drag: no lock on keys; a press-and-drag turns as before
      ML.setMode('drag');
      const r0 = req;
      H.key('KeyW', true); await H.wait(150); H.key('KeyW', false);
      const yd = cam._yawT;
      el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 9, pointerType: 'mouse', button: 0, buttons: 1, clientX: 300, clientY: 300 }));
      el.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 9, pointerType: 'mouse', buttons: 1, clientX: 380, clientY: 300 }));
      el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 9, pointerType: 'mouse', button: 0, buttons: 0, clientX: 380, clientY: 300 }));
      await H.wait(60);
      out.drag = { noRequest: req === r0, dyaw: cam._yawT - yd };
      // ---- refused lock → hover look (+ edge turning), lock mode
      ML.setMode('lock'); ML.refuse(); await H.wait(60);
      const yh = cam._yawT;
      __mm(el, { clientX: 420, clientY: 270 });   // (the first move over the view only places the pointer)
      const yh1 = cam._yawT;
      __mm(el, { clientX: 480, clientY: 270 });   // a plain move (no movementX): the position change turns
      await H.raf(); await H.raf();
      const hoverPlain = cam._yawT - yh1;
      const yh3 = cam._yawT;
      __mm(el, { movementX: 60, clientX: 540, clientY: 270 });
      await H.raf(); await H.raf();
      const hoverTurn = cam._yawT - yh3;
      const hud = document.querySelector('#bottom-bar, #hud-left-menu, #minimap-panel') || document.body;
      const yh2 = cam._yawT;
      __mm(hud, { movementX: 60, clientX: 10, clientY: 10 });
      await H.raf(); await H.raf();
      const hudTurn = cam._yawT - yh2;
      const r = el.getBoundingClientRect();
      __mm(el, { clientX: r.right - 30, clientY: r.top + r.height / 2 });
      __mm(el, { clientX: r.right - 4, clientY: r.top + r.height / 2 });
      const ye = cam._yawT; await H.wait(700);
      const edgeTurn = cam._yawT - ye;
      const hs = ML.state();
      ML.setMode('drag');
      out.hover = { state: hs, hoverTurn, hoverPlain, hudTurn, edgeTurn };
      ML.setMode(null); ML.refresh();
      out.after = ML.state();
      return out;
    });
    check('look: ?mouselook=lock is honoured; the automation default is drag', lk.query.mode === 'lock' && lk.query.defaultMode === 'drag', JSON.stringify(lk.query));
    check('look lock: the first movement key requests the pointer and it is locked', lk.lockKey.locked && lk.lockKey.req >= 1, JSON.stringify(lk.lockKey));
    check('look lock: the centre dot and the state chip "🖱️ 고정" show', lk.lockKey.dot && lk.lockKey.chip === '🖱️ 고정', lk.lockKey.chip);
    check('Ctrl card: "Ctrl 키를 누르면 마우스가 풀려요. 한 번 더 누르면 다시 캐릭터를 따라 돌아요." with a drawn key', lk.card.text === 'Ctrl 키를 누르면 마우스가 풀려요. 한 번 더 누르면 다시 캐릭터를 따라 돌아요.' && lk.card.key && lk.card.say === lk.card.text, JSON.stringify(lk.card));
    check('Ctrl tap: frees the pointer (chip "🖱️ 자유 · Ctrl"), movement keys do not take it back', lk.ctrl.freed && lk.ctrl.chipFree === '🖱️ 자유 · Ctrl' && !lk.ctrl.keyRelock, JSON.stringify(lk.ctrl));
    check('Ctrl tap: Ctrl with another key is no tap; a second tap fixes the view again', !lk.ctrl.chordLocked && lk.ctrl.relocked && lk.ctrl.chipFixed === '🖱️ 고정' && lk.ctrl.taps === 2, JSON.stringify(lk.ctrl));
    check('look lock: moving the mouse turns yaw and pitch (no button)', lk.turn.dyaw < -0.2 && lk.turn.dpitch > 0.05, JSON.stringify(lk.turn));
    check('look: hostile / NaN deltas leave every camera number finite', lk.finite);
    check('look lock: a left click is the interact key, never a walk-to', lk.lockClick.interact >= 1 && lk.lockClick.clicks === 0, JSON.stringify(lk.lockClick));
    check('look lock: a blocking UI releases the pointer at once', !lk.blocked.locked && lk.blocked.ex >= 1, JSON.stringify(lk.blocked));
    check('look lock: the next movement key takes it again', lk.relock.locked, JSON.stringify(lk.relock));
    check('look lock: after Esc the keys walk with a free pointer', lk.esc.userReleased && !lk.esc.keyRelock, JSON.stringify(lk.esc));
    check('look lock: after Esc a click on the view captures again (that click is no walk-to)', lk.escClick.locked && lk.escClick.clicks === 0, JSON.stringify(lk.escClick));
    check('zoom: the wheel zooms while the pointer is locked', lk.wheelLocked > 0.05, lk.wheelLocked.toFixed(3));
    check('look walk: locked while a movement key is held, still a moment after, free 1.75 s after', lk.walk.whileHeld && lk.walk.after05 && !lk.walk.after18, JSON.stringify(lk.walk));
    check('look drag: keys never ask for the pointer; press-and-drag turns', lk.drag.noRequest && lk.drag.dyaw < -0.1, JSON.stringify(lk.drag));
    check('look fallback: a refused lock gives hover look over the view (not over the HUD)', lk.hover.state.refused && lk.hover.state.hover && lk.hover.hoverTurn < -0.1 && lk.hover.hoverPlain < -0.1 && Math.abs(lk.hover.hudTurn) < 1e-9, JSON.stringify({ h: lk.hover.hoverTurn, plain: lk.hover.hoverPlain, hud: lk.hover.hudTurn }));
    check('look fallback: resting in the outer 6 % of the view turns slowly', lk.hover.edgeTurn < -0.1, lk.hover.edgeTurn.toFixed(3));
  }
  // ------------------------------------------------------------------------------------------------ + / − / 0
  if (want('keys')) {
    const ks = await page.evaluate(async () => {
      const H = window.__ct, cam = G.sys.camera;
      H.key('Digit0', true); H.key('Digit0', false); await H.wait(60);
      const out = { start: G.settings.lookSpeed };
      H.key('Equal', true, '='); H.key('Equal', false); await H.wait(60);
      out.plus = G.settings.lookSpeed;
      out.toast = [...document.querySelectorAll('#toast-root .toast')].map((t) => t.textContent.trim()).filter((t) => /회전 속도/.test(t)).pop() || '';
      H.key('NumpadAdd', true); H.key('NumpadAdd', false); await H.wait(40);
      out.plus2 = G.settings.lookSpeed;
      for (let i = 0; i < 4; i++) { H.key('Minus', true, '-'); H.key('Minus', false); }
      H.key('NumpadSubtract', true); H.key('NumpadSubtract', false); await H.wait(40);
      out.minus = G.settings.lookSpeed;
      for (let i = 0; i < 40; i++) { H.key('Equal', true); H.key('Equal', false); }
      out.max = G.settings.lookSpeed;
      for (let i = 0; i < 60; i++) { H.key('Minus', true); H.key('Minus', false); }
      out.min = G.settings.lookSpeed;
      H.key('Digit0', true); H.key('Digit0', false); await H.wait(40);
      out.reset = G.settings.lookSpeed;
      let stored = null; try { stored = JSON.parse(localStorage.getItem('tfm.v1.settings') || '{}').lookSpeed; } catch (e) { stored = 'ERR'; }
      out.stored = stored;
      // the gain scales the look: 2× speed → 2× the turn for the same mouse delta
      G.input.lookSpeed.set(1); await H.raf(); const y1 = cam._yawT; G.input.mouseLook.feed(50, 0); await H.raf(); await H.raf(); const d1 = cam._yawT - y1;
      G.input.lookSpeed.set(2); const y2 = cam._yawT; G.input.mouseLook.feed(50, 0); await H.raf(); await H.raf(); const d2 = cam._yawT - y2;
      G.input.lookSpeed.set(1);
      out.scale = { d1, d2 };
      return out;
    });
    check('turn speed: + makes it × 1.15 with a toast "🖱️ 회전 속도 …배"', Math.abs(ks.plus - 1.15) < 1e-3 && /🖱️\s*회전 속도 1\.15배/.test(ks.toast), `${ks.plus} · "${ks.toast}"`);
    check('turn speed: NumpadAdd too; − and NumpadSubtract slow it', Math.abs(ks.plus2 - 1.3225) < 1e-3 && ks.minus < 1 && ks.minus > 0.6, `${ks.plus2} → ${ks.minus}`);
    check('turn speed: clamped to 0.25 … 4.0', ks.max === 4 && ks.min === 0.25, `${ks.min} … ${ks.max}`);
    check('turn speed: 0 resets to 1, saved on this device', ks.reset === 1 && ks.stored === 1, `${ks.reset} stored ${ks.stored}`);
    check('turn speed: it scales the turn (2× → about 2× the yaw)', ks.scale.d1 < 0 && Math.abs(ks.scale.d2 / ks.scale.d1 - 2) < 0.25, JSON.stringify(ks.scale));
  }
  // ------------------------------------------------------------------------------------------------ zoom range
  if (want('zoom')) {
    const zm = await page.evaluate(async () => {
      const H = window.__ct, cam = G.sys.camera, el = document.getElementById('game-container');
      const spin = async (dy, n) => { for (let i = 0; i < n; i++) { el.dispatchEvent(new WheelEvent('wheel', { deltaY: dy, bubbles: true, cancelable: true })); await H.raf(); } await H.wait(400); return cam._distT; };
      const out = { easy: G.easy?.on };
      out.easyMax = await spin(240, 40); out.easyMin = await spin(-240, 40);
      G.setSetting('easyMode', false); await H.wait(200);
      out.normal = G.easy?.on === false;
      out.max = await spin(240, 60); out.dist = cam.distance; out.min = await spin(-240, 60);
      G.setSetting('easyMode', true); await H.wait(200);
      return out;
    });
    check('zoom: normal mode wheel range 2 … 22 m', zm.normal && Math.abs(zm.max - 22) < 0.01 && Math.abs(zm.min - 2) < 0.01, `${zm.min} … ${zm.max}`);
    check('zoom: smoothed (the distance eases towards the target)', zm.dist > 2 && zm.dist <= 22.001, zm.dist.toFixed(2));
    check('zoom: easy mode keeps its gentle 4.5 … 12.5 m', zm.easy && Math.abs(zm.easyMax - 12.5) < 0.01 && Math.abs(zm.easyMin - 4.5) < 0.01, `${zm.easyMin} … ${zm.easyMax}`);
  }
  // ------------------------------------------------------------------------------------------------ settings tiles
  if (want('settings')) {
    const st = await page.evaluate(async () => {
      const H = window.__ct;
      G.setSetting('parentGate', false);
      G.app.openSettings('controls');
      await H.wait(900);
      const grp = document.querySelector('[role="radiogroup"][aria-label="마우스로 둘러보기"]');
      const tiles = grp ? [...grp.querySelectorAll('[role="radio"]')].map((b) => b.textContent.trim()) : [];
      const walk = grp ? [...grp.querySelectorAll('[role="radio"]')].find((b) => /걸을 때만/.test(b.textContent)) : null;
      walk?.click(); await H.wait(100);
      const chosen = G.settings.mouseLook;
      const slider = document.querySelector('input[type="range"][aria-label="회전 속도"]');
      const emoji = grp ? [...grp.querySelectorAll('.emoji')].length : 0;
      G.setSetting('mouseLook', 'auto');
      try { G.ui.modal.closeAll(); } catch (e) { /* closed */ }
      await H.wait(200);
      return { tiles, chosen, slider: !!slider, emoji };
    });
    check('settings → 조작: the mouse-look picture tiles (기본 · 늘 돌리기 · 걸을 때만 · 끌어서)', st.tiles.length === 4 && st.emoji === 4, st.tiles.join(' | '));
    check('settings → 조작: a tile changes G.settings.mouseLook', st.chosen === 'walk', st.chosen);
    check('settings → 조작: the turn-speed slider', st.slider);
  }
  // ------------------------------------------------------------------------------------------------ [move] §19.3 dash
  if (want('dash')) {
    const ev = (fn, arg) => page.evaluate(fn, arg);
    // a clear open spot (no collider, no water within 6 m all round), the camera behind the player looking along -z
    const setup = await ev(async () => {
      const H = window.__ct, W = G.world;
      await H.ready();
      G.setSetting('easyMode', false); G.setSetting('reduceMotion', false); G.setSetting('alwaysRun', false);
      G.input.mouseLook.setMode('drag');   // (the page was opened with mouselook=lock: its hover-look edge turning would swing the camera under the test)
      G.sys.weather?.setAuto?.(false);
      window.__ks = [];
      for (const t of ['keydown', 'keyup']) window.addEventListener(t, (e) => { if (e.isTrusted) window.__ks.push([t, e.code, e.timeStamp, e.repeat]); }, true);   // the browser's own stamps of REAL key events
      const sp = G.data.layout?.spawn || { x: 0, z: 9 };
      let spot = null;
      for (let rad = 0; rad <= 110 && !spot; rad += 10) for (let a = 0; a < 16 && !spot; a++) {
        const cx = sp.x + Math.cos(a * 0.39) * rad, cz = sp.z + Math.sin(a * 0.39) * rad;
        let ok = true;
        for (let k = 0; k < 16 && ok; k++) for (let d = 0; d <= 6 && ok; d += 1) if (!H.free(cx + Math.cos(k * Math.PI / 8) * d, cz + Math.sin(k * Math.PI / 8) * d, 0.9)) ok = false;
        if (ok) spot = { x: cx, z: cz };
      }
      // record every sound and the camera kick
      window.__dash = { sfx: [], kick: 0, dashes: [], runs: [], states: [] };
      const sfx0 = G.sfx; G.sfx = function (n, ...r) { window.__dash.sfx.push(n); return sfx0.call(this, n, ...r); };
      G.bus.on('player:dash', (d) => window.__dash.dashes.push(d));
      G.bus.on('player:run', (d) => window.__dash.runs.push(d));
      H.onTick = (pl) => { window.__dash.kick = Math.max(window.__dash.kick, G.sys.camera?._kick || 0); window.__dash.states.push(pl.moveState); };
      return { spot, run: H.findRun(48), easy: G.easy.on };
    });
    check('dash: an open spot (nothing within 6 m) and a clear straight run of 48 m exist for the test', !!setup.spot && !!setup.run && setup.easy === false, JSON.stringify(setup));
    const reset = async (spot) => ev(async ({ sp, dx, dz }) => {
      const H = window.__ct; G.input.reset(); H.release();
      await H.place(sp.x, sp.z, dx, dz);
      await H.waitGame(0.5);
      window.__dash.sfx.length = 0; window.__dash.dashes.length = 0; window.__dash.runs.length = 0; window.__dash.states.length = 0; window.__dash.kick = 0;
      G.sys.player._dashAt = -1e9;
      const b = G.sys.camera.getMoveBasis();
      const p = G.sys.player.position;
      return { x: p.x, z: p.z, fx: b.forward.x, fz: b.forward.z, rx: b.right.x, rz: b.right.z };
    }, { sp: spot || setup.spot, dx: spot && spot.dx !== undefined ? spot.dx : 0, dz: spot && spot.dz !== undefined ? spot.dz : -1 });
    const after = (sec) => ev(async (s) => { await window.__ct.waitGame(s); const p = G.sys.player; return { x: p.position.x, z: p.position.z, speed: p.speed, state: p.moveState, running: G.input.running, tapRun: G.input.tapRun, gt: window.__ct.gt() }; }, sec);
    // REAL key events from the browser process (Input.dispatchKeyEvent) with explicit times: the CDP `timestamp` is what the page
    // sees as event.timeStamp, so all events of a tap can be sent at once, 50 / 60 ms apart, whatever the frame rate is doing.
    // If this browser ignores the stamps (checked below) the taps fall back to awaited page.keyboard calls and a wider window.
    const cdp = await page.context().newCDPSession(page);
    const VK = { KeyA: [65, 'a'], KeyD: [68, 'd'], KeyS: [83, 's'], KeyW: [87, 'w'] };
    let stamped = true;
    const send = async (code, seq) => {         // seq: [['down' | 'up', ms after the first], ...]
      if (stamped) {
        const base = Date.now() / 1000 + 0.05;
        await Promise.all(seq.map(([ty, ms]) => cdp.send('Input.dispatchKeyEvent', { type: ty === 'down' ? 'rawKeyDown' : 'keyUp', code, key: VK[code][1], windowsVirtualKeyCode: VK[code][0], timestamp: base + ms / 1000 })));
      } else {
        for (const [ty] of seq) { if (ty === 'down') await page.keyboard.down(code); else await page.keyboard.up(code); }
      }
    };
    /** a double tap: down, up, down (+ up unless the second press is held) — presses 110 ms apart, 50 ms held */
    const tap2 = (code, hold2 = false) => send(code, [['down', 0], ['up', 50], ['down', 110], ...(hold2 ? [] : [['up', 160]])]);
    {
      await ev(() => { window.__ks.length = 0; });
      await send('KeyD', [['down', 0], ['up', 50], ['down', 340], ['up', 390]]);   // (340 ms: just outside the default window — no dash from this one)
      await ev(() => window.__ct.wait(300));
      const ks = await ev(() => window.__ks.filter((k) => k[1] === 'KeyD'));
      const gap = ks.length >= 3 ? ks[2][2] - ks[0][2] : -1;
      stamped = Math.abs(gap - 340) < 25;
      check('dash: real key events carry the stamps they were sent with (two presses stamped 340 ms apart arrive ~340 ms apart)', stamped, `gap ${gap.toFixed ? gap.toFixed(1) : gap} ms · ${JSON.stringify(ks.map((k) => k.slice(0, 3)))}`);
      if (!stamped) await ev(() => { G.setSetting('tapWindow', 450); });   // (a fallback: awaited calls are slow under load)
      await ev(async () => { G.input.reset(); window.__ct.release(); window.__dash.dashes.length = 0; await window.__ct.waitGame(1.0); });
    }

    // ---- left, right, back: one dash of about 3.2 m relative to the camera, real key events
    for (const [code, name, sx, sz] of [['KeyA', 'left', -1, 0], ['KeyD', 'right', 1, 0], ['KeyS', 'back', 0, 1]]) {
      const b0 = await reset();
      await tap2(code);
      const r = await after(1.2);
      const dx = r.x - b0.x, dz = r.z - b0.z;
      const d = await ev(() => ({ n: window.__dash.dashes.length, dir: window.__dash.dashes[0]?.dir, ex: window.__dash.dashes[0]?.dx, ez: window.__dash.dashes[0]?.dz, sfx: window.__dash.sfx.filter((x) => x === 'dash').length, runs: window.__dash.runs.length }));
      // the camera's own axis for this direction, read before the keys; the dash must go along it (the camera stands still in drag mode)
      const ax = name === 'left' ? [-b0.rx, -b0.rz] : name === 'right' ? [b0.rx, b0.rz] : [-b0.fx, -b0.fz];
      const along = dx * ax[0] + dz * ax[1], side = dx * -ax[1] + dz * ax[0];
      const ang = d.ex === undefined ? 999 : Math.acos(Math.max(-1, Math.min(1, ((d.ex || 0) * ax[0] + (d.ez || 0) * ax[1])))) * 180 / Math.PI;
      check(`dash ${name}: the key tapped twice goes 3.2 m (3.0 – 3.4) relative to the camera, straight`, along > 3.0 && along < 3.4 && Math.abs(side) < 0.4 && ang < 10, `${along.toFixed(2)} m, sideways ${side.toFixed(2)}, ${ang.toFixed(1)}° off the camera axis`);
      check(`dash ${name}: one player:dash {dir: ${name}}, the soft sound once, no run`, d.n === 1 && d.dir === name && d.sfx === 1 && d.runs === 0, JSON.stringify(d));
    }

    // ---- the second press held after a dash only walks
    {
      const b0 = await reset();
      await tap2('KeyA', true);
      await after(0.9);
      const r = await after(0.9);
      await page.keyboard.up('KeyA');
      const d = await ev(() => ({ running: G.input.running, runs: window.__dash.runs.length, dashes: window.__dash.dashes.length }));
      check('dash: holding the key afterwards only walks (≈ 7.7 m/s, no run, one dash)', r.speed > 5 && r.speed < 9.5 && !r.running && d.runs === 0 && d.dashes === 1, `speed ${r.speed.toFixed(2)} ${JSON.stringify(d)}`);
      void b0;
    }

    // ---- forward: two presses, the second held → runs until forward is let go
    {
      const b0 = await reset(setup.run);
      await tap2('KeyW', true);
      const r1 = await after(1.5);
      const r2 = await after(1.0);
      const run = { running: r2.running, tap: r2.tapRun, state: r2.state, speed: r2.speed };
      await page.keyboard.up('KeyW');
      const r3 = await after(0.8);
      const d = await ev(() => ({ dashes: window.__dash.dashes.length, runs: window.__dash.runs.map((x) => x.on), kick: window.__dash.kick }));
      const prog = Math.hypot(r2.x - b0.x, r2.z - b0.z);
      check('run: forward tapped twice and held → running (state "run", about 14.4 m/s) and still running a second later', run.running && run.tap === 'key' && run.state === 'run' && run.speed > 13 && run.speed < 16.5 && r1.speed > 12, JSON.stringify(run) + ` r1 ${r1.speed.toFixed(1)}`);
      check('run: it covered the ground of a run (≥ 18 m in 2.5 s) and made no dash', prog > 18 && d.dashes === 0, `${prog.toFixed(1)} m ${JSON.stringify(d)}`);
      check('run: letting go of forward ends it (not running, walking state, stopped)', !r3.running && r3.tapRun === false && r3.state === 'walk' && r3.speed < 1, JSON.stringify({ running: r3.running, state: r3.state, speed: r3.speed.toFixed(2) }));
      check('run: player:run {on: true} then {on: false}', JSON.stringify(d.runs) === JSON.stringify([true, false]), JSON.stringify(d.runs));
    }
    // ---- steering sideways keeps the run, a single press does not run
    {
      await reset(setup.run);
      await tap2('KeyW', true);
      await after(0.8);
      await page.keyboard.down('KeyA');
      const r = await after(0.8);
      await page.keyboard.up('KeyA'); await page.keyboard.up('KeyW');
      check('run: steering left while forward is held keeps the run', r.running && r.state === 'run', JSON.stringify({ running: r.running, state: r.state }));
      await reset(setup.run);
      await send('KeyW', [['down', 0], ['up', 50], ['down', 1000]]);   // two presses a second apart, the second held
      const r2 = await after(1.2);
      const r3 = await after(0.6);
      await send('KeyW', [['up', 0]]);
      check('run: two presses 1 s apart are not a run; the key held just walks', !r3.running && r3.speed < 9.5 && r2.state !== 'dash', JSON.stringify({ running: r3.running, speed: r3.speed.toFixed(2) }));
    }

    // ---- the events' own timestamps decide, not the moment the page gets round to them
    {
      await reset();
      const t = await ev(async () => {
        const mk = (type) => new KeyboardEvent(type, { code: 'KeyD', key: 'd', bubbles: true, cancelable: true });
        const spin = (ms) => { const t0 = performance.now(); while (performance.now() - t0 < ms) { /* busy */ } };
        // a human double tap: press, 40 ms, release, 40 ms, press, 40 ms, release — the events are stamped when they are made
        const a = mk('keydown'); spin(40); const b = mk('keyup'); spin(40); const c = mk('keydown'); spin(40); const d = mk('keyup');
        spin(700);                                              // … then the page is busy for 700 ms (a very long frame) before it sees them
        for (const e of [a, b, c, d]) window.dispatchEvent(e);
        await window.__ct.waitGame(0.3);
        const n1 = window.__dash.dashes.length;
        await window.__ct.waitGame(0.8);
        // the same keys, the second press STAMPED 740 ms after the first: no dash, however soon the page handles them
        const e1 = mk('keydown'); spin(40); const e2 = mk('keyup'); spin(700); const e3 = mk('keydown'); spin(40); const e4 = mk('keyup');
        for (const e of [e1, e2, e3, e4]) window.dispatchEvent(e);
        await window.__ct.waitGame(0.8);
        return { n1, n2: window.__dash.dashes.length };
      });
      check('timestamps: two presses stamped 80 ms apart still count when the page handles them 700 ms later (a long frame)', t.n1 === 1, JSON.stringify(t));
      check('… and two stamped 740 ms apart do not, however quickly the page handles them', t.n2 === 1, JSON.stringify(t));
    }

    // ---- never through a thin fence, never in a window
    {
      const b0 = await reset();
      const w = await ev(async (b) => {
        const W = G.world, y = W.heightAt(b.x, b.z, Infinity);
        // a thin tall fence 1.6 m to the camera's left, running along the camera's forward direction
        const cx = b.x - b.rx * 1.6, cz = b.z - b.rz * 1.6;
        const id = W.addCollider({ shape: 'box', x: cx, z: cz, hw: 0.06, hd: 3, rot: Math.atan2(b.fx, b.fz) , tag: 'B_TESTFENCE', maxY: y + 5 });
        window.__fenceId = id;
        return { id };
      }, b0);
      await tap2('KeyA');
      const r = await after(1.2);
      const dist = -((r.x - b0.x) * b0.rx + (r.z - b0.z) * b0.rz);
      await ev(() => { G.world.removeCollider(window.__fenceId); });
      check('dash: a thin fence 1.6 m away stops it (no further than 1.6 − 0.06 − 0.35 + a little)', w.id && dist < 1.25 + 0.3 && dist > 0.6, dist.toFixed(2));
    }
    {
      const b0 = await reset();
      const blocked = await ev(() => { G.ui.block('dashtest'); return !G.input.gameplay(); });
      await tap2('KeyA');
      const r = await after(0.9);
      const d = await ev(() => { G.ui.unblock('dashtest'); return window.__dash.dashes.length; });
      check('dash: nothing happens while a window is open (input blocked)', blocked && d === 0 && Math.hypot(r.x - b0.x, r.z - b0.z) < 0.3, `blocked ${blocked} dashes ${d} moved ${Math.hypot(r.x - b0.x, r.z - b0.z).toFixed(2)}`);
      await after(0.4);
      await tap2('KeyA'); await after(0.6);
      const d2 = await ev(() => window.__dash.dashes.length);
      check('dash: and works again when it closes', d2 === 1, String(d2));
    }
    // ---- the camera kick (normal mode only) and reduce-motion
    {
      await reset();
      await tap2('KeyD'); await after(0.6);
      const k1 = await ev(() => window.__dash.kick);
      await ev(() => { G.setSetting('reduceMotion', true); });
      await reset();
      await tap2('KeyD'); await after(0.6);
      const k2 = await ev(() => window.__dash.kick);
      await ev(() => { G.setSetting('reduceMotion', false); });
      check('camera: a dash gives the view a small kick; reduce-motion drops it', k1 > 0.3 && k2 === 0, `kick ${k1.toFixed(2)} / with reduce-motion ${k2}`);
    }
    // ---- the options: off means off, easy mode keeps the same keys
    {
      await ev(() => { G.setSetting('dashOn', false); G.setSetting('tapRun', false); });
      const b0 = await reset();
      await tap2('KeyA'); await after(0.5);
      await tap2('KeyW', true); const r = await after(1.0); await page.keyboard.up('KeyW');
      const d = await ev(() => ({ dashes: window.__dash.dashes.length, runs: window.__dash.runs.length }));
      check('options: 대시 off and 두 번 눌러 달리기 off → neither happens', d.dashes === 0 && d.runs === 0 && !r.running, JSON.stringify(d));
      await ev(() => { G.setSetting('dashOn', true); G.setSetting('tapRun', true); });
      void b0;
      await ev(() => { G.setSetting('alwaysRun', true); });
      await reset(setup.run);
      await page.keyboard.down('KeyW'); const r2 = await after(1.4); await page.keyboard.up('KeyW');
      await ev(() => { G.setSetting('alwaysRun', false); });
      check('options: 항상 달리기 on → a plain W runs (≈ 14.4 m/s)', r2.running && r2.speed > 12.5, JSON.stringify({ running: r2.running, speed: r2.speed.toFixed(1) }));
      const rows = await ev(() => ['tapRun', 'dashOn', 'tapWindow', 'alwaysRun', 'jumpBuffer', 'coyoteMs', 'wallSlide', 'stepAround', 'lowFences', 'runFree'].map((id) => !!G.sys.settings?.list?.().find((d) => d.id === id && d.tab === 'controls')));
      check('options: the ten rows of the 조작 tab exist in the registry', rows.every(Boolean), JSON.stringify(rows));
      const keyrow = await ev(() => { const l = G.input.bindings.list().find((a) => a.id === 'autoForward'); return l ? { codes: l.codes, group: l.group } : null; });
      check('key table: "앞으로 계속 가기" (K) is a move action', !!keyrow && keyrow.codes[0] === 'KeyK' && keyrow.group === 'move', JSON.stringify(keyrow));
    }
    await ev(() => { window.__ct.onTick = null; try { G.input.mouseLook.setMode(null); G.setSetting('easyMode', true); } catch (e) { /* ok */ } });
  }
  await context.close();
}

async function phonePage() {
  const { page, context } = await open('phone', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await boot(page, '');
  const r = await page.evaluate(async () => {
    const ML = G.input.mouseLook;
    const s0 = ML.state();
    const el = document.getElementById('game-container');
    el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 3, pointerType: 'touch', button: 0, buttons: 1, clientX: 200, clientY: 400, isPrimary: true }));
    el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 3, pointerType: 'touch', button: 0, buttons: 0, clientX: 200, clientY: 400, isPrimary: true }));
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW', bubbles: true })); window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW', bubbles: true }));
    await new Promise((r) => setTimeout(r, 300));
    return { s0, s1: ML.state(), touchUI: G.input.touchUI, dot: !!document.getElementById('ml-dot') && !document.getElementById('ml-dot').hidden, WALK: G.sys.player.WALK };
  });
  check('phone: touch UI keeps the drag look, never asks for the pointer', r.touchUI && r.s0.mode === 'drag' && r.s1.requests === 0 && !r.dot, JSON.stringify({ mode: r.s0.mode, req: r.s1.requests, touch: r.touchUI }));
  check('phone: the same pace constants (7.68 m/s)', r.WALK === 7.68);
  if (want('dash')) {
    // [move] §19.3: two quick flicks of the stick — forward held = run, left = dash; the run button stays
    const t = await page.evaluate(async () => {
      const raf = () => new Promise((r) => requestAnimationFrame(() => r()));
      const frames = async (n) => { for (let i = 0; i < n; i++) await raf(); };
      for (let i = 0; i < 400 && !(G.input.gameplay() && G.sys.player.enabled && G.sys.camera?.mode === 'follow'); i++) { try { G.ui.modal.closeAll(); } catch (e) { /* none */ } await raf(); }
      const spin = (ms) => { const t0 = performance.now(); while (performance.now() - t0 < ms) { /* a human's pace: events are stamped when they are made */ } };
      const st = document.getElementById('joystick'), rc = st.getBoundingClientRect();
      const cx = rc.left + rc.width / 2, cy = rc.top + rc.height / 2, R = rc.width * 0.36;
      const ptr = (type, id, x, y) => st.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: id, pointerType: 'touch', isPrimary: true, clientX: x, clientY: y, buttons: type === 'pointerup' ? 0 : 1 }));
      const out = { stick: !!st, runBtn: !!document.querySelector('[data-mobile=run]') };
      const dashes = [], runs = [];
      G.bus.on('player:dash', (d) => dashes.push(d.dir)); G.bus.on('player:run', (d) => runs.push(d.on));
      const P = G.sys.player;
      P._dashAt = -1e9;
      // forward, forward (held)
      const x0 = P.position.x, z0 = P.position.z;
      ptr('pointerdown', 11, cx, cy - R * 0.95); spin(40); ptr('pointerup', 11, cx, cy - R * 0.95); spin(40);
      ptr('pointerdown', 12, cx, cy - R * 0.95);
      await frames(24);
      out.run = { tap: G.input.tapRun, running: G.input.running, state: P.moveState, speed: P.speed, moved: Math.hypot(P.position.x - x0, P.position.z - z0) };
      ptr('pointerup', 12, cx, cy - R * 0.95);
      await frames(10);
      out.after = { running: G.input.running, tap: G.input.tapRun };
      // left, left → a dash (no run)
      await frames(30);
      P._dashAt = -1e9;
      const n0 = dashes.length;
      ptr('pointerdown', 13, cx - R * 0.95, cy); spin(40); ptr('pointerup', 13, cx - R * 0.95, cy); spin(40);
      ptr('pointerdown', 14, cx - R * 0.95, cy); spin(40); ptr('pointerup', 14, cx - R * 0.95, cy);
      await frames(20);
      out.dash = { n: dashes.length - n0, dir: dashes[dashes.length - 1], running: G.input.running };
      out.runs = runs;
      return out;
    });
    check('phone: the stick and the run button are there', t.stick && t.runBtn, JSON.stringify({ stick: t.stick, run: t.runBtn }));
    check('phone: two quick flicks of the stick forward, the second held → running (via stick)', t.run.tap === 'stick' && t.run.running && t.run.moved > 3, JSON.stringify(t.run));
    check('phone: letting go of the stick ends the run', t.after.running === false && t.after.tap === false, JSON.stringify(t.after));
    check('phone: two flicks to the left → one dash left, no run', t.dash.n === 1 && t.dash.dir === 'left' && t.dash.running === false, JSON.stringify(t.dash));
  }
  await context.close();
}

try {
  await mainPage();
  if (!flag('--skip-phone') && want('phone')) await phonePage();
} catch (e) {
  check('the run finished', false, String(e?.stack || e).slice(0, 400));
}
check('no page errors', pageErrors.length === 0, pageErrors.slice(0, 4).join(' | '));
check('no console errors', consoleErrors.length === 0, consoleErrors.slice(0, 4).join(' | '));
await browser.close();
const failed = results.filter((r) => !r.ok);
if (jsonOut) console.log(JSON.stringify({ pass: results.length - failed.length, fail: failed.length, results }, null, 1));
else log(`\n${results.length - failed.length} / ${results.length} passed`);
process.exit(failed.length ? 1 : 0);
