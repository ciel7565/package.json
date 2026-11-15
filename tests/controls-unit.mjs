#!/usr/bin/env node
// tests/controls-unit.mjs — CONTRACT §17.1, the world layer of "jumping clears obstacles" in a Node vm (no browser):
// G.world.resolve with heights, the top-inference table (G.world.TOPS / inferTop), lazy ground under inferred tops,
// standable tops (heightAt), G.world.obstacleAhead (the vault probe) and G.world.vaultVy (the vault maths) — the
// maths is also checked by integrating a jump against resolve() the way 21-player does (sub-steps of ≤ 0.25 m).
// Usage: node tests/controls-unit.mjs [--json]    exit 0 = all green, 1 = a check failed
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail: String(detail) }); if (!process.argv.includes('--json')) console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`); };
const near = (a, b, e = 1e-3) => Math.abs(a - b) <= e;

function loadWorld() {
  const G = {
    util: { clamp: (v, a, b) => (v < a ? a : v > b ? b : v) },
    data: {}, sys: {}, log: { warn() {}, debug() {} },
    bus: { emit() {}, on() {} },
  };
  const ctx = vm.createContext({ G, console, Math, Number, Object, Map, Array, String, Infinity, NaN, THREE: {} });
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'src/game/06-world.js'), 'utf8'), ctx, { filename: '06-world.js' });
  return G.world;
}

// ----------------------------------------------------------------------------------------------- inference table
{
  const W = loadWorld();
  W.setTerrain(() => 0);
  const fence = W.addCollider({ shape: 'box', x: 0, z: 5, hw: 3, hd: 0.06, tag: 'fence' });
  const jar = W.addCollider({ shape: 'circle', x: 10, z: 0, r: 0.62, tag: 'jar:J1' });
  const jarS = W.addCollider({ shape: 'circle', x: 12, z: 0, r: 0.2, tag: 'pot' });
  const jarL = W.addCollider({ shape: 'circle', x: 14, z: 0, r: 1.2, tag: 'onggi' });
  const wall = W.addCollider({ shape: 'box', x: 20, z: 0, hw: 4, hd: 0.3, tag: 'stonewall' });
  const bench = W.addCollider({ shape: 'box', x: 30, z: 0, hw: 0.9, hd: 0.25, tag: 'bench' });
  const bed = W.addCollider({ shape: 'box', x: 40, z: 0, hw: 0.5, hd: 0.75, tag: 'bed' });
  const car = W.addCollider({ shape: 'box', x: 50, z: 0, hw: 0.95, hd: 2.3, tag: 'car' });
  const npc = W.addCollider({ shape: 'circle', x: 60, z: 0, r: 0.4, tag: 'npc:N1' });
  const rock = W.addCollider({ shape: 'circle', x: 70, z: 0, r: 0.8, tag: 'rock' });
  const house = W.addCollider({ shape: 'box', x: 80, z: 0, hw: 4, hd: 3, tag: 'B_HANOK1' });
  const tree = W.addCollider({ shape: 'circle', x: 90, z: 0, r: 0.4, tag: 'tree' });
  const none = W.addCollider({ shape: 'box', x: 100, z: 0, hw: 1, hd: 1 });
  const given = W.addCollider({ shape: 'box', x: 110, z: 0, hw: 1, hd: 1, tag: 'fence', maxY: 2.2 });
  const spread = W.addCollider({ shape: 'box', x: 120, z: 0, hw: 1, hd: 1, maxY: undefined, stand: undefined, tag: 'PL_DAECHEONG' });
  const C = (id) => W.colliders.get(id);
  check('fence top 1.1, not standable', near(W.topOf(C(fence)), 1.1) && C(fence).stand === false, `${W.topOf(C(fence))} ${C(fence).stand}`);
  check('jar 0.62 m → top ≈ 1.0 (0.5 + 0.8 r)', near(W.topOf(C(jar)), 0.996), W.topOf(C(jar)));
  check('small pot clamps to 0.7, big onggi to 1.3', near(W.topOf(C(jarS)), 0.7) && near(W.topOf(C(jarL)), 1.3), `${W.topOf(C(jarS))} ${W.topOf(C(jarL))}`);
  check('stone wall 1.9 standable', near(W.topOf(C(wall)), 1.9) && C(wall).stand === true);
  check('bench 0.5, bed 0.45, car 1.6, NPC 1.5', near(W.topOf(C(bench)), 0.5) && near(W.topOf(C(bed)), 0.45) && near(W.topOf(C(car)), 1.6) && near(W.topOf(C(npc)), 1.5));
  check('rock = its size (circle r)', near(W.topOf(C(rock)), 0.8));
  check('building / tree / untagged / unknown tag stay tall', [house, tree, none, spread].every((id) => W.topOf(C(id)) === Infinity));
  check('a given maxY is kept (no inference)', near(W.topOf(C(given)), 2.2) && !C(given)._inferred);
  check('TOPS table exported with ≥ 20 kinds', Object.keys(W.TOPS).length >= 20, Object.keys(W.TOPS).length);

  // resolve with heights: feet below the top → pushed, at the top − 0.05 or above → passes
  const p = { x: 0, z: 5.2, y: 0 };
  check('resolve: a ground walker is pushed out of the fence', W.resolve(p, 0.35, 0) && Math.abs(p.z - 5) >= 0.06 + 0.35 - 1e-6, p.z.toFixed(3));
  const q = { x: 0, z: 5.1, y: 0 };
  check('resolve: feet at 1.06 (≥ 1.1 − 0.05) pass over the fence', !W.resolve(q, 0.35, 1.06) && q.z === 5.1);
  const q2 = { x: 0, z: 5.1 };
  check('resolve: feet at 1.0 are still stopped', W.resolve(q2, 0.35, 1.0));
  const h = { x: 80, z: 0.5 };
  check('resolve: a building stops feet at 50 m too', W.resolve(h, 0.35, 50));
  check('blocked(): bed blocks a ground walker, not one at 0.45', W.blocked(40, 0, 0.35, 0) && !W.blocked(40, 0, 0.35, 0.45));

  // standable tops carry a walker that is up there; non-standable ones do not
  check('heightAt on the stone wall for feet at 1.9 → 1.9', near(W.heightAt(20, 0, 1.9), 1.9));
  check('heightAt on the stone wall from the ground → ground (no step-up)', near(W.heightAt(20, 0, 0.05), 0));
  check('heightAt on the fence (stand false) → ground even from above', near(W.heightAt(0, 5, 1.2), 0));
  check('heightAt on a bench from above → 0.5', near(W.heightAt(30, 0, 0.6), 0.5));
}

// ----------------------------------------------------------------------------------------------- lazy ground
{
  const W = loadWorld();
  let slope = (x, z) => x * 0.1;   // a slope: the top follows the HIGHEST ground under the footprint
  W.setTerrain((x, z) => slope(x, z));
  const id = W.addCollider({ shape: 'box', x: 10, z: 0, hw: 2, hd: 0.5, tag: 'bed' });
  const c = W.colliders.get(id);
  check('inferred top over a slope = highest ground under it + h', near(W.topOf(c), 1.2 + 0.45), W.topOf(c));
  W.addWalkable({ shape: 'box', x: 10, z: 0, hw: 5, hd: 5, top: 3 });
  check('a walkable added later (a room floor) lifts the inferred top', near(W.topOf(c), 3.45), W.topOf(c));
  const n = W.addCollider({ shape: 'circle', x: 30, z: 0, r: 0.4, tag: 'npc:A' });
  const nc = W.colliders.get(n);
  const t0 = W.topOf(nc);
  W.moveCollider(n, 50, 0);
  check('a walking NPC: its top follows the ground where it is', near(t0, 3.028 + 1.5, 0.01) && near(W.topOf(nc), 5.028 + 1.5, 0.01), `${t0} → ${W.topOf(nc)}`);
  slope = () => -2; W.setTerrain(() => -2);
  check('a new terrain function (a place) re-reads the ground', near(W.topOf(nc), -0.5), W.topOf(nc));
  // the getter runs inside resolve()'s own loop: it must never corrupt the shared query buffer
  W.setTerrain(() => 0);
  for (let i = 0; i < 12; i++) W.addCollider({ shape: 'circle', x: 200 + i * 0.5, z: 0, r: 0.3, tag: 'jar' });
  W.addWalkable({ shape: 'box', x: 202, z: 0, hw: 4, hd: 2, top: 0 });   // invalidates every cached base
  const pp = { x: 202.6, z: 0.05 };
  const hit = W.resolve(pp, 0.35, 0);
  const still = W.blocked(pp.x, pp.z, 0.34, 0);
  check('resolve over a jar row with lazy tops: pushed out and clear afterwards', hit && !still, `${pp.x.toFixed(2)},${pp.z.toFixed(2)}`);
}

// ----------------------------------------------------------------------------------------------- vault probe + maths
{
  const W = loadWorld();
  W.setTerrain(() => 0);
  W.addCollider({ shape: 'box', x: 0, z: -2, hw: 3, hd: 0.06, tag: 'fence' });
  W.addCollider({ shape: 'box', x: 0, z: -12, hw: 3, hd: 3, tag: 'B_HOUSE' });
  for (let i = 0; i < 4; i++) W.addCollider({ shape: 'circle', x: 20, z: -2 - i * 1.25, r: 0.45, tag: 'jar' });
  const o = W.obstacleAhead(0, 0, 0, -1, 0.35, 0, 1.6, 4);
  check('obstacleAhead finds the fence 1.6 m ahead (contact at ≈ 2 − 0.06 − 0.35)', o && !o.tall && near(o.a, 1.55, 0.06) && near(o.top, 1.1), JSON.stringify(o));
  const far = W.obstacleAhead(0, 1, 0, -1, 0.35, 0, 1.6, 4);
  check('obstacleAhead: nothing within reach → null (fence 2.6 m away)', far === null);
  const hb = W.obstacleAhead(0, -7.5, 0, -1, 0.35, 0, 1.6, 4);
  check('obstacleAhead: a building ahead is tall', hb && hb.tall && hb.top === Infinity);
  const row = W.obstacleAhead(20, -1, 0, -1, 0.35, 0, 1.6, 6);
  check('obstacleAhead: a jar row is one obstacle (first → last contact)', row && !row.tall && row.b - row.a > 3.2 && row.n >= 4, JSON.stringify(row));

  const g = 22;
  const v1 = W.vaultVy(1.35, 1.0, 1.9, 7.68, g, 12);
  check('vaultVy: fence (H 1.35) at walking pace → ok and ≥ √(2gH)', v1.ok && v1.vy >= Math.sqrt(2 * g * 1.35) - 1e-9, v1.vy.toFixed(3));
  const vw = W.vaultVy(2.15, 0.5, 1.2, 7.68, g, 14);
  check('vaultVy: stone wall from the ground (H 2.15) needs more than a single jump (7.42)', vw.vy > 7.42 && vw.ok, vw.vy.toFixed(3));
  const imp = W.vaultVy(1.5, 0.1, 12, 1, g, 9);
  check('vaultVy: an impossible span at a crawl reports ok = false at the cap', !imp.ok && imp.vy === 9);
  check('vaultVy: nothing to clear → 0', W.vaultVy(0, 1, 2, 5).vy === 0);

  // integrate a jump against resolve() like 21-player (sub-steps ≤ 0.25 m, momentum kept while vaulting)
  function jump(W, sx, sz, dx, dz, s, vy, steps = 400) {
    const p = { x: sx, z: sz }; let y = 0, v = vy, t = 0, maxZ = sz, landed = false;
    const dt = 1 / 120;
    for (let i = 0; i < steps && !landed; i++) {
      const nx = p.x + dx * s * dt, nz = p.z + dz * s * dt;
      const q = { x: nx, z: nz };
      W.resolve(q, 0.35, y);
      p.x = q.x; p.z = q.z;
      v -= g * dt; y += v * dt; t += dt;
      if (y <= 0 && v < 0) { y = 0; landed = true; }
      maxZ = Math.min(maxZ, p.z);
    }
    return { x: p.x, z: p.z, t };
  }
  const o1 = W.obstacleAhead(0, 0, 0, -1, 0.35, 0, 1.6, 4);
  const r1 = W.vaultVy(o1.top + 0.25, o1.a, o1.b, 7.68, g, Math.sqrt(2 * g * (o1.top + 0.25 + 0.8)));
  const land = jump(W, 0, 0, 0, -1, 7.68, Math.max(7.42, r1.vy));
  check('simulated vault: walking at 7.68 m/s the jump lands beyond the fence', land.z < -2.41, `z ${land.z.toFixed(2)} vy ${r1.vy.toFixed(2)}`);
  const plain = jump(W, 0, 0, 0, -1, 7.68, 3.5);
  check('simulated control: a hop of 3.5 m/s stays in front of the fence', plain.z > -1.6, plain.z.toFixed(2));
  const oj = W.obstacleAhead(20, -1, 0, -1, 0.35, 0, 1.6, 6);
  const rj = W.vaultVy(oj.top + 0.25, oj.a, oj.b, 7.68, g, Math.sqrt(2 * g * (oj.top + 0.25 + 0.8)));
  const lj = jump(W, 20, -1, 0, -1, 7.68, Math.max(7.42, rj.vy));
  check('simulated vault: the jar row is cleared in one jump', lj.z < -2 - 3 * 1.25 - 0.45 - 0.35 + 0.01, `z ${lj.z.toFixed(2)} vy ${rj.vy.toFixed(2)} ok ${rj.ok}`);
  const peak1 = 7.42 * 7.42 / (2 * g);
  check('single jump peak ≈ 1.25 m (JUMP_V 7.42, g 22)', near(peak1, 1.25, 0.02), peak1.toFixed(3));
  // double jump pressed at the top: + 7.1² / 2g
  const peak2 = peak1 + 7.1 * 7.1 / (2 * g);
  check('double jump peak ≈ 2.4 m (JUMP2_V 7.1)', near(peak2, 2.4, 0.03), peak2.toFixed(3));
}

const failed = results.filter((r) => !r.ok);
if (process.argv.includes('--json')) console.log(JSON.stringify({ pass: results.length - failed.length, fail: failed.length, results }, null, 1));
else console.log(`\n${results.length - failed.length} / ${results.length} passed`);
process.exit(failed.length ? 1 : 0);
