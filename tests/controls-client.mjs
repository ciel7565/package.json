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
//
//   node tests/controls-client.mjs                       builds a private page (--no-assets) in a temp directory
//   node tests/controls-client.mjs --file /abs/page.html test an already built page
//   options: --json · --headed · --timeout <ms> · --skip-phone · --only <a,b> (groups: pace, jump, walkto, look, keys,
//            zoom, settings, phone)
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
