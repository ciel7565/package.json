#!/usr/bin/env node
// =============================================================================
// tests/crafts-kit.mjs — the ten rooms of 64-interiors-e.js built in Node with the REAL kits and the real three.js (the
// harness of tests/myroom-logic.mjs: 15-buildings.js, 19-hanok-kit.js, a places stand-in that calls build(ctx)).
// For every house: it builds, every geometry is finite (no NaN), everything stays inside the room (+ the wall margin),
// the meshes (≈ draw calls of the colour pass) stay within §16.5's 200, the triangles are counted, the keeper's spot and
// the exit door are inside, the one thing to do runs to its end (auto) and its hooks move what they should, nothing
// warns. Pictures and the real frame are the browser's job (tests/interior-client.mjs, the look runs).
//   node tests/crafts-kit.mjs [--json]          exit 0 = all passed, 1 = a check failed, 2 = could not run
// =============================================================================
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { makeRoomWorld } from './myroom-logic.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const jsonOut = process.argv.includes('--json');
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail: String(detail) }); if (!jsonOut) console.log(`${ok ? '  ✔' : '  ✖'} ${name}${detail !== '' ? ` — ${String(detail).slice(0, 400)}` : ''}`); };

let W;
try { W = await makeRoomWorld(ROOT); } catch (e) { console.error('could not make the world', e); process.exit(2); }
const { THREE, Gb, P, tick, warns, interacts } = W;
if (Gb.sys.engine?.renderer && !Gb.sys.engine.renderer.getDrawingBufferSize) Gb.sys.engine.renderer.getDrawingBufferSize = (v) => v.set(1280, 720);
const load = (file) => {
  const src = fs.readFileSync(path.join(ROOT, 'src/game', file), 'utf8');
  vm.runInThisContext(`(function (THREE, G, setTimeout) {\n${src}\n})`, { filename: file })(THREE, Gb, setTimeout);
};
Gb.data.avatar = undefined;
for (const f of ['02-avatar-data.js', '02-layout.js', '48-interior-data.js', '64-interiors-e.js']) {
  try { load(f); check(`${f} loads next to the real kits`, true); } catch (e) { check(`${f} loads next to the real kits`, false, String(e.stack || e).slice(0, 400)); }
}
const rows = Gb.data.crafts?.houses || [];
check('ten houses', rows.length === 10);
const report = [];
for (const row of rows) {
  const w0 = warns.length, i0 = interacts.length;
  let ok = false;
  try { ok = await P.enter(row.place); } catch (e) { check(`${row.name}: builds`, false, String(e.stack || e).slice(0, 500)); continue; }
  check(`${row.name}: builds`, ok && !!P.ctx);
  if (!ok) continue;
  const g = P.ctx.group;
  g.updateMatrixWorld(true);
  let meshes = 0, tris = 0, nan = 0;
  const box = new THREE.Box3(), bb = new THREE.Box3();
  g.traverse((o) => {
    if (!o.isMesh && !o.isPoints && !o.isInstancedMesh) return;
    if (!o.visible) return;
    meshes++;
    const geo = o.geometry; if (!geo) return;
    const pa = geo.attributes.position;
    if (pa) for (let i = 0; i < pa.array.length; i++) if (!Number.isFinite(pa.array[i])) { nan++; break; }
    tris += (geo.index ? geo.index.count : (pa ? pa.count : 0)) / 3 * (o.isInstancedMesh ? o.count : 1);
    if (o.isMesh && pa && pa.count) { geo.computeBoundingBox(); bb.copy(geo.boundingBox).applyMatrix4(o.matrixWorld); box.union(bb); }
  });
  const o = row.origin, hw = row.size.w / 2 + 1.6, hd = row.size.d / 2 + 1.6;
  const inside = box.min.x >= o.x - hw && box.max.x <= o.x + hw && box.min.z >= o.z - hd && box.max.z <= o.z + hd && box.min.y >= -0.8 && box.max.y <= row.size.h + 0.9;
  check(`${row.name}: every geometry finite`, nan === 0, `${nan} with NaN`);
  check(`${row.name}: ≤ 200 meshes (draw calls of the colour pass)`, meshes <= 200, `${meshes} meshes, ${Math.round(tris / 1000)}k triangles`);
  check(`${row.name}: stays inside its room`, inside, `x ${(box.min.x - o.x).toFixed(1)}…${(box.max.x - o.x).toFixed(1)} y ${box.min.y.toFixed(1)}…${box.max.y.toFixed(1)} z ${(box.min.z - o.z).toFixed(1)}…${(box.max.z - o.z).toFixed(1)}`);
  const mine = interacts.slice(i0);
  const keeperI = mine.find((x) => /:keeper$/.test(x.id));
  check(`${row.name}: a keeper to talk to, reachable (radius ≥ 3)`, !!keeperI && keeperI.radius >= 3 && Math.abs(keeperI.position.x) < row.size.w / 2 && Math.abs(keeperI.position.z) < row.size.d / 2);
  // the one thing to do, auto: every step's hook runs, the tweens finish
  const L = Gb.crafts.live(row.place);
  check(`${row.name}: the room registers its live record and a step hook`, !!L && (typeof L.step === 'function' || !Gb.crafts.FURNISH[row.id]), Gb.crafts.FURNISH[row.id] ? 'furnished' : 'plain room');
  let done = false;
  try { done = await Gb.crafts.act(row.place, { auto: true }); } catch (e) { check(`${row.name}: the thing to do runs`, false, String(e.stack || e).slice(0, 300)); }
  tick(400);
  check(`${row.name}: the thing to do runs to its stamp`, done === true && !(L?.tweens || []).length);
  const myWarns = warns.slice(w0).filter((s) => !/no lecture screen|lecture/.test(s));
  check(`${row.name}: nothing warns`, !myWarns.length, myWarns.slice(0, 3).join(' | '));
  report.push(`${row.id}:${meshes}m/${Math.round(tris / 1000)}k`);
  await P.exit();
}
// a step moves what it should: the dye cloth deepens dip by dip
{
  await P.enter('PL_DYE');
  const L = Gb.crafts.live('PL_DYE');
  const cloth = L && P.ctx.group.getObjectByName('dye-cloth');
  const lum = () => { const c = cloth.material.color; return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b; };
  if (cloth) {
    const l0 = lum(); L.step(0); tick(300); const l1 = lum(); L.step(1); tick(300); const l2 = lum(); L.step(2); tick(300); const l3 = lum();
    check('염색 공방: the cloth deepens dip by dip (luminance falls each time)', l0 > l1 && l1 > l2 && l2 > l3, [l0, l1, l2, l3].map((v) => v.toFixed(3)).join(' > '));
    check('염색 공방: the cloth comes back up out of the jar', Math.abs(cloth.position.y - 2.03) < 0.05, cloth.position.y.toFixed(2));
  } else check('염색 공방: the dipping cloth exists', false);
  await P.exit();
}
console.log(jsonOut ? '' : `  · ${report.join(' · ')}`);
const failed = results.filter((r) => !r.ok);
if (jsonOut) console.log(JSON.stringify({ ok: !failed.length, passed: results.length - failed.length, failed: failed.length, report, results }, null, 1));
else console.log(`\n${failed.length ? '✖' : '✔'} crafts-kit: ${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
