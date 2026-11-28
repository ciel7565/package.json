#!/usr/bin/env node
// =============================================================================
// tests/crafts-unit.mjs — the ten hanok of the 장터 거리 and the 공방 마을 (64-interiors-e.js, CONTRACT §19.2) without a
// browser: the [buildings] plots of 02-layout.js (inside the walkable box, clear of every other building, road, the river,
// the 힐링관 yard and each other; every door opens onto a street), the rows of G.data.crafts (48-interior-data.js), the
// places 64 defines at load (ids, zones, doors, exits, origins that no other place of the game uses), the keepers' named
// sets (they exist in G.data.avatar.presets), the exhibits of each house (≥ 3 to learn + the stamp of the one thing to do),
// the activities (2 – 4 steps, each with a voice line), and the text rules (no Chinese characters, no health claims, no
// prices in what a child reads).
//   node tests/crafts-unit.mjs [--json]          exit 0 = all passed, 1 = a check failed
// =============================================================================
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const THREE = require('three');
const jsonOut = process.argv.includes('--json');
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail: String(detail) }); if (!jsonOut) console.log(`${ok ? '  ✔' : '  ✖'} ${name}${detail !== '' ? ` — ${String(detail).slice(0, 300)}` : ''}`); };
const src = (f) => fs.readFileSync(path.join(ROOT, 'src/game', f), 'utf8');

const warns = [];
const defs = new Map();
const G = {
  data: {}, sys: {}, settings: { easyMode: true }, easy: { on: true },
  log: { warn: (...a) => warns.push(a.join(' ')), info() {}, debug() {}, error: (...a) => warns.push('ERROR ' + a.join(' ')) },
  bus: { on() {}, emit() {} }, util: { rng: () => Math.random },
  register(sys) { G.sys[sys.name] = sys; },
};
G.sys.places = {
  define(d) { defs.set(d.id, d); return d; },
  def: (id) => defs.get(id) || null,
  doorOf(id, o = {}) {
    const b = (G.data.layout?.buildings || []).find((x) => x.id === id);
    if (!b) return null;
    const rot = b.rot || 0, s = Math.sin(rot), c = Math.cos(rot), side = Number(o.side) || 0, out = 0.3, gap = 2.6;
    const fx = (dz) => b.x + side * c + dz * s, fz = (dz) => b.z - side * s + dz * c;
    const front = (b.d || 4) / 2 + out;
    return { buildingId: id, x: fx(front), z: fz(front), rotY: rot, exit: { x: fx(front + gap), z: fz(front + gap), rotY: rot } };
  },
};
G.hanok = { room() { throw new Error('not in this test'); } };
G.bkit = { M() {}, geo: {}, mul() {}, rngOf: () => Math.random, SignAtlas: class {}, registerMaterial() {} };
const ctx = vm.createContext({ G, THREE, Math, console, setTimeout, Promise });
for (const f of ['02-avatar-data.js', '02-layout.js', '48-interior-data.js', '64-interiors-e.js']) {
  try { vm.runInContext(src(f), ctx, { filename: f }); check(`${f} evaluates`, true); } catch (e) { check(`${f} evaluates`, false, e.message); }
}
const L = G.data.layout || {};
const crafts = (L.buildings || []).filter((b) => b.type === 'craft');
const others = (L.buildings || []).filter((b) => b.type !== 'craft');
const rows = G.data.crafts?.houses || [];

// ---------------------------------------------------------------- geometry helpers
const corners = (b, pad = 0) => { const c = Math.cos(b.rot || 0), s = Math.sin(b.rot || 0), hw = b.w / 2 + pad, hd = b.d / 2 + pad; return [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]].map(([u, v]) => [b.x + u * c + v * s, b.z - u * s + v * c]); };
function sepAxis(A, B) { // convex polygons overlap?
  for (const poly of [A, B]) for (let i = 0; i < poly.length; i++) {
    const [x1, z1] = poly[i], [x2, z2] = poly[(i + 1) % poly.length], nx = z2 - z1, nz = x1 - x2;
    let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
    for (const [x, z] of A) { const p = x * nx + z * nz; a0 = Math.min(a0, p); a1 = Math.max(a1, p); }
    for (const [x, z] of B) { const p = x * nx + z * nz; b0 = Math.min(b0, p); b1 = Math.max(b1, p); }
    if (a1 < b0 || b1 < a0) return false;
  }
  return true;
}
const segDist = (px, pz, ax, az, bx, bz) => { const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz; const t = l2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / l2)) : 0; return Math.hypot(px - ax - t * dx, pz - az - t * dz); };
const lineDist = (px, pz, pts) => { let d = Infinity; for (let i = 0; i + 1 < pts.length; i++) d = Math.min(d, segDist(px, pz, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1])); return d; };
const polyLineDist = (poly, pts) => { let d = Infinity; for (const [x, z] of poly) d = Math.min(d, lineDist(x, z, pts)); for (let k = 0; k < 4; k++) { const [x1, z1] = poly[k], [x2, z2] = poly[(k + 1) % 4]; for (let t = 0.25; t < 1; t += 0.25) d = Math.min(d, lineDist(x1 + (x2 - x1) * t, z1 + (z2 - z1) * t, pts)); } return d; };

// ---------------------------------------------------------------- plots
check('ten craft plots', crafts.length === 10, crafts.map((b) => b.id).join(' '));
check('plot ids unique', new Set(crafts.map((b) => b.id)).size === crafts.length);
const bb = L.bounds || { minX: -135, maxX: 135, minZ: -135, maxZ: 135 };
const outBox = crafts.filter((b) => corners(b, 1).some(([x, z]) => x < bb.minX + 8 || x > bb.maxX - 8 || z < bb.minZ + 8 || z > bb.maxZ - 8));
check('every plot well inside the walkable box', !outBox.length, outBox.map((b) => b.id).join(' '));
const clash = [];
for (const a of crafts) {
  for (const o of others) if (sepAxis(corners(a, 1.4), corners(o, o.type === 'heal' ? 6 : 1.6))) clash.push(`${a.id}×${o.id}`);
  for (const o of crafts) if (o !== a && a.id < o.id && sepAxis(corners(a, 0.8), corners(o, 0.8))) clash.push(`${a.id}×${o.id}`);
}
check('no plot touches another building (heal yard 6 m)', !clash.length, clash.join(' '));
const roadNear = [];
for (const a of crafts) for (const r of L.roads || []) { const d = polyLineDist(corners(a, 0.9), r.points) - r.width / 2; if (d < 4) roadNear.push(`${a.id}-${r.id} ${d.toFixed(1)}`); }
check('roads stay ≥ 4 m from every plot', !roadNear.length, roadNear.join(' '));
const riverD = Math.min(...crafts.map((a) => polyLineDist(corners(a, 0.9), L.river.points) - L.river.width / 2));
check('the river stays ≥ 6 m from every plot', riverD >= 6, riverD.toFixed(1));
const pondNear = crafts.filter((a) => (L.ponds || []).some((p) => corners(a, 1).some(([x, z]) => Math.hypot(x - p.x, z - p.z) < p.r + 3)));
check('no pond near a plot', !pondNear.length, pondNear.map((b) => b.id).join(' '));
const otherPaths = (L.paths || []).filter((p) => p.id !== 'PATH_MARKET' && p.id !== 'PATH_CRAFT');
const pathCross = [];
for (const a of crafts) for (const p of otherPaths) { const d = polyLineDist(corners(a, 0.9), p.points) - (p.width || 2) / 2; if (d < 0.5) pathCross.push(`${a.id}~${(p.id || p.points[0].join(','))}`); }
check('no older path runs into a plot', !pathCross.length, pathCross.join(' '));
const streets = (L.paths || []).filter((p) => p.id === 'PATH_MARKET' || p.id === 'PATH_CRAFT');
check('two streets', streets.length === 2);
const streetHit = [];
for (const s of streets) for (const o of others) if (polyLineDist(corners(o, 0.5), s.points) < (s.width / 2)) streetHit.push(`${s.id}×${o.id}`);
check('the streets cross no older building', !streetHit.length, streetHit.join(' '));
const doorsOff = [];
for (const a of crafts) {
  const d = G.sys.places.doorOf(a.id);
  const near = Math.min(...streets.map((s) => lineDist(d.exit.x, d.exit.z, s.points) - s.width / 2));
  if (near > 1.2) doorsOff.push(`${a.id} ${near.toFixed(1)}`);
}
check('every door opens onto a street (exit spot ≤ 1.2 m from its edge)', !doorsOff.length, doorsOff.join(' '));
const zones = [[0, 0, 16], [0, -80, 28], [0, 74, 20], [52, 118, 14], [46, 2, 30], [48, 50, 21]];
const inZone = crafts.filter((a) => corners(a).some(([x, z]) => zones.some(([cx, cz, r]) => Math.hypot(x - cx, z - cz) < r)));
check('the plots keep out of the plaza, hall, entrance, 만장대, 장독대 and rest zones', !inZone.length, inZone.map((b) => b.id).join(' '));

// ---------------------------------------------------------------- rows and places
check('ten house rows', rows.length === 10, rows.map((r) => r.id).join(' '));
const rowB = new Set(rows.map((r) => r.building));
check('every plot has a row and every row a plot', crafts.every((b) => rowB.has(b.id)) && rows.every((r) => crafts.some((b) => b.id === r.building)));
const RX_ID = /^PL_[A-Z0-9_]{2,24}$/, RX_ZONE = /^ZONE_[A-Z0-9_]{1,30}$/;
check('ten places defined at load', rows.every((r) => defs.has(r.place)), [...defs.keys()].join(' '));
check('place ids and zones are well formed', rows.every((r) => RX_ID.test(r.place) && RX_ZONE.test(r.zone)));
const badDoor = rows.filter((r) => { const d = defs.get(r.place); return !d || !d.door || !d.exit || !(d.door.label && d.door.kidLabel); });
check('every place has a door with a kid label and an exit', !badDoor.length, badDoor.map((r) => r.id).join(' '));
const sizes = rows.filter((r) => !(r.size.w >= 10 && r.size.d >= 8 && r.size.h >= 3.2 && r.size.w <= 20 && r.size.d <= 14));
check('rooms are roomy (≥ 10 × 8 × 3.2 m) and modest (≤ 20 × 14 m)', !sizes.length, sizes.map((r) => r.id).join(' '));
// origins: every other place of the game (literal origins in the sources) stays ≥ 150 m away
const others0 = [];
for (const f of fs.readdirSync(path.join(ROOT, 'src/game')).filter((f) => f.endsWith('.js') && f !== '64-interiors-e.js' && f !== '48-interior-data.js')) {
  for (const m of src(f).matchAll(/origin:\s*\{\s*x:\s*(-?[\d.]+)\s*,\s*z:\s*(-?[\d. +]+)\s*\}/g)) {
    let z; try { z = Function(`return ${m[2]}`)(); } catch { continue; }
    others0.push([Number(m[1]), Number(z), f]);
  }
}
others0.push([0, 2600, 'district'], [0, 3400, 'heal hall']);
const near = [];
for (const r of rows) for (const [x, z, f] of others0) if (Math.hypot(r.origin.x - x, r.origin.z - z) < 150) near.push(`${r.place}~${f}(${x},${z})`);
for (const a of rows) for (const b of rows) if (a !== b && a.id < b.id && Math.hypot(a.origin.x - b.origin.x, a.origin.z - b.origin.z) < 150) near.push(`${a.place}~${b.place}`);
check(`place origins are ≥ 150 m from every other place (${others0.length} known)`, !near.length, near.join(' '));
// keepers: named sets that exist
const presets = new Set((G.data.avatar?.presets || []).map((p) => p.id));
const noSet = rows.filter((r) => !(r.keeper && r.keeper.name && (r.keeper.sets || []).some((s) => presets.has(s))));
check('every keeper has a name and a named set of G.data.avatar.presets', !noSet.length, noSet.map((r) => r.id).join(' '));

// ---------------------------------------------------------------- exhibits, activities
const EX = G.data.exhibits || {};
const thin = [], noStamp = [];
for (const r of rows) {
  const list = Object.values(EX).filter((e) => e.place === r.place);
  if (list.filter((e) => !/_DO$/.test(e.id)).length < 3) thin.push(`${r.id}:${list.length}`);
  if (!EX['HX_' + r.id.toUpperCase() + '_DO']) noStamp.push(r.id);
}
check('every house has ≥ 3 things to learn', !thin.length, thin.join(' '));
const longKid = Object.values(EX).filter((e) => rows.some((r) => r.place === e.place) && !(e.kid && e.kid.length <= 40 && e.detail && e.title && Array.isArray(e.sources) && e.sources.length && e.sources.every((s) => /^https:\/\/(encykorea\.aks\.ac\.kr|folkency\.nfm\.go\.kr)\//.test(s.url))));
check('every exhibit: a kid line ≤ 40 characters, a detail, named encyclopedia sources', !longKid.length, longKid.map((e) => `${e.id}:${e.kid?.length}`).join(' '));
check('every house has the stamp exhibit of its one thing to do', !noStamp.length, noStamp.join(' '));
const ACT = G.crafts?.ACT || {};
const badAct = rows.filter((r) => { const a = ACT[r.id]; return !a || !Array.isArray(a.steps) || a.steps.length < 2 || a.steps.length > 4 || a.steps.some((s) => !s.say || !s.label || typeof s.run !== 'function'); });
check('every house has one thing to do: 2 – 4 steps, each with a label, a voice line and an action', !badAct.length, badAct.map((r) => r.id).join(' '));
const rooms = new Set((G.data.exhibitRooms || []).map((x) => x.id));
check('every house is a room of the 도감', rows.every((r) => rooms.has(r.place)), rows.filter((r) => !rooms.has(r.place)).map((r) => r.id).join(' '));

// ---------------------------------------------------------------- text rules
const texts = [];
for (const r of rows) texts.push(r.name, r.desc, r.keeper?.hello, r.keeper?.name, r.keeper?.role);
for (const e of Object.values(EX)) if (rows.some((r) => r.place === e.place)) texts.push(e.title, e.kid, e.detail);
for (const a of Object.values(ACT)) { texts.push(a.title, a.say, a.end); for (const s of a.steps || []) texts.push(s.label, s.say, s.done); }
const all = texts.filter(Boolean).join('\n');
const han = all.match(/[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/g);
check('no Chinese characters in the houses\' text', !han, han ? han.slice(0, 10).join('') : '');
const FORBID = String.fromCharCode(0xac8c, 0xc784);
check('the forbidden word is not used', !all.includes(FORBID));
const claim = all.match(/치료|효능|효과가 있|낫게|낫는|예방|약효|병을 고|몸에 좋|건강에 좋|면역|해독/g);
check('no health claims (치료 · 효능 · 예방 · 몸에 좋 …)', !claim, claim ? claim.join(' ') : '');
const price = all.match(/\d+\s*원|코인|가격|값이/g);
check('no prices in what a child reads', !price, price ? price.join(' ') : '');
const alcohol = all.match(/막걸리|술[을이은도]|소주|탁주|동동주/g);
const jumakText = texts.filter(Boolean).join('\n');
check('the 주막 serves no alcohol (식혜 · 수정과)', !alcohol, alcohol ? alcohol.join(' ') : '');
check('no warnings while loading', !warns.length, warns.slice(0, 4).join(' | '));

const failed = results.filter((r) => !r.ok);
if (jsonOut) console.log(JSON.stringify({ ok: !failed.length, passed: results.length - failed.length, failed: failed.length, results }, null, 1));
else console.log(`\n${failed.length ? '✖' : '✔'} crafts-unit: ${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
