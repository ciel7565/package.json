#!/usr/bin/env node
// =============================================================================
// tests/heal-hall-unit.mjs — the house of the 힐링관 (69-healing-hall.js, CONTRACT §19.6) without a browser:
//   the station registry line, G.healHall (door states, corridor table, room keys), the plan (one corridor, ten doors on
//   bay centres inside it, 15 m apart, ≈ 330 m² rooms, ≈ 3,300 m² together), the places it defines (ids, zones,
//   nested exits, origins that collide with no other place of the game), the [heal] plot in 02-layout.js.
//   node tests/heal-hall-unit.mjs [--json]          exit 0 = all passed, 1 = a check failed
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
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail: String(detail) }); if (!jsonOut) console.log(`${ok ? '  ✔' : '  ✖'} ${name}${detail !== '' ? ` — ${String(detail).slice(0, 240)}` : ''}`); };
const src = (f) => fs.readFileSync(path.join(ROOT, 'src/game', f), 'utf8');

// ---- a small world: G with a bus, a places stub that records definitions, a register that keeps systems
const events = [];
const defs = new Map();
const G = {
  data: {}, sys: {}, settings: { easyMode: true }, easy: { on: true },
  log: { warn: (...a) => events.push(['warn', a.join(' ')]), info() {}, debug() {}, error: (...a) => events.push(['error', a.join(' ')]) },
  bus: { on() {}, emit: (n, d) => events.push(['emit', n, d]) },
  util: { rng: () => { let s = 7; return () => ((s = (s * 16807) % 2147483647) / 2147483647); } },
  register(sys) { G.sys[sys.name] = sys; },
};
G.sys.places = {
  current: null,
  define(d) { defs.set(d.id, d); return d; },
  def: (id) => defs.get(id) || null,
  is(id) { return this.current === id; },
  doorOf(id) {
    const b = (G.data.layout?.buildings || []).find((x) => x.id === id);
    if (!b) return null;
    const front = b.d / 2 + 0.3;
    return { buildingId: id, x: b.x, z: b.z + front, rotY: 0, exit: { x: b.x, z: b.z + front + 2.6, rotY: 0 } };
  },
  hideRoot() {},
  enter(id) { this.current = id; return Promise.resolve(true); },
};
G.hanok = { room() {} };
const ctx = vm.createContext({ G, THREE, console, Math, Map, Set, Number, String, Object, Array, JSON, Promise, document: undefined });
vm.runInContext(src('02-layout.js'), ctx, { filename: '02-layout.js' });
vm.runInContext(src('69-healing-hall.js'), ctx, { filename: '69-healing-hall.js' });
G.sys.healHall.init();

// ---- the station line of §19.6
{
  const S = G.healStations;
  check('G.healStations exists with map / set / get', !!S && S.map instanceof Map && typeof S.set === 'function' && typeof S.get === 'function');
  const o = { x: 1 };
  S.set('R1', 'body', o);
  check('set(room, key, at) stores under "room:key" and emits heal:station', S.get('R1', 'body') === o && S.map.has('R1:body') && events.some((e) => e[0] === 'emit' && e[1] === 'heal:station' && e[2].room === 'R1' && e[2].key === 'body'));
  check('get() of an unknown station is null', S.get('R2', 'nope') === null);
  S.map.clear();
  const line = /G\.healStations = G\.healStations \|\| \{ map: new Map\(\),\s*set\(room, key, at\) \{ this\.map\.set\(room \+ ':' \+ key, at\); G\.bus && G\.bus\.emit\('heal:station', \{ room, key \}\); \},\s*get\(room, key\) \{ return this\.map\.get\(room \+ ':' \+ key\) \|\| null; \} \};/;
  check('the fragment carries the station line word for word', line.test(src('69-healing-hall.js')));
}

// ---- the places
const H = G.healHall, P = G.sys.places;
const ids = ['PL_HEAL', 'PL_HEAL_STAY', 'PL_HEAL_TALK', ...Array.from({ length: 10 }, (_, i) => 'PL_HEAL_R' + (i + 1))];
check('thirteen places are defined: the hall, 숙소, 상담실 and ten rooms', ids.every((id) => defs.has(id)) && H.PLACES.length === 13, [...defs.keys()].join(' '));
check('every place has its own ZONE_PL_* zone', ids.every((id) => /^ZONE_PL_[A-Z0-9_]+$/.test(defs.get(id).zoneId)) && new Set(ids.map((id) => defs.get(id).zoneId)).size === 13);
const hall = defs.get('PL_HEAL');
check('the hall has a door on B_HEAL in the valley and a way out 2.6 m in front of it', hall.door && hall.door.buildingId === 'B_HEAL' && Math.abs(Math.hypot(hall.exit.x - hall.door.x, hall.exit.z - hall.door.z) - 2.6) < 0.01, JSON.stringify({ door: hall.door, exit: hall.exit }));
check('indoor places with a view distance the place suite allows (≤ 400)', ids.every((id) => defs.get(id).indoor === true && (defs.get(id).far || 150) <= 400));
check('nested rooms have no door outside and the hall\'s valley exit as their save spot', ids.slice(1).every((id) => !defs.get(id).door && defs.get(id).exit && defs.get(id).exit.x === hall.exit.x && defs.get(id).exit.z === hall.exit.z));
// the way out: back into the corridor when entered from the hall, out to the valley otherwise
{
  const r3 = defs.get('PL_HEAL_R3');
  P.current = 'PL_HEAL'; r3.canEnter({});
  const back = r3.exitTo({});
  P.current = null; r3.canEnter({});
  const out = r3.exitTo({});
  P.current = 'PL_HEAL'; r3.canEnter({});
  const told = r3.exitTo({ to: { x: 1, z: 2 } });
  const c3 = H.corridor().find((d) => d.room === 'R3');
  check('entered from the hall: the way out leads back to the corridor in front of its own door', back && back.place === 'PL_HEAL' && Math.abs(back.spawn.x - c3.x) < 1e-6 && Math.abs(back.spawn.z - c3.z) < 1e-6, JSON.stringify(back));
  check('entered from the valley (가기 menu): the way out is the valley (no redirect)', out === null);
  check('an explicit destination (exit({ to })) is honoured', told === null);
}
// origins: far from the valley and from every other place of the game
{
  const others = [];
  for (const f of fs.readdirSync(path.join(ROOT, 'src/game'))) {
    if (!f.endsWith('.js') || f === '69-healing-hall.js') continue;
    for (const m of src(f).matchAll(/origin: \{ x: (-?[\d.]+), z: (-?[\d.]+) \}/g)) others.push({ f, x: Number(m[1]), z: Number(m[2]) });
  }
  others.push({ f: 'district', x: 0, z: 2600, r: 260 });
  const clash = [];
  for (const id of ids) {
    const d = defs.get(id), r = Math.hypot(d.size.w, d.size.d) / 2 + (id === 'PL_HEAL' ? 170 : 20);
    for (const o of others) if (Math.hypot(o.x - d.origin.x, o.z - d.origin.z) < r + (o.r || 30)) clash.push(`${id}~${o.f}(${o.x},${o.z})`);
    for (const id2 of ids) if (id2 !== id && defs.get(id2).origin.x === d.origin.x && defs.get(id2).origin.z === d.origin.z) clash.push(`${id}=${id2}`);
  }
  check('place origins collide with no other place (rooms 200 m apart, the hall row of its own)', clash.length === 0, clash.slice(0, 6).join(' ') || `${others.length} other origins`);
}

// ---- the plan
{
  const L = H.HALL, list = H.corridor();
  const rooms = list.filter((d) => /^R\d+$/.test(d.room));
  check('corridor(): ten rooms then 숙소 and 상담실, with name, place, minutes and positions', list.length === 12 && rooms.length === 10 && list[10].room === 'STAY' && list[11].room === 'TALK' && rooms.every((d) => d.place === 'PL_HEAL_' + d.room && d.minutes > 0 && Number.isFinite(d.wx) && Number.isFinite(d.wz)));
  check('corridor() also tells the lobby, the entrance, the desk and the bounds', list.lobby && list.entrance && list.desk && list.bounds && list.place === 'PL_HEAL');
  const bay = 3, W = L.length;
  const onBay = list.every((d) => Math.abs(((d.door.x + W / 2) % bay) - bay / 2) < 1e-6);
  check('every door sits on the middle of a 3 m bay of the corridor\'s north wall', onBay, list.map((d) => d.door.x).join(' '));
  check('every door is inside the corridor and in front of it the visitor stands inside too', list.every((d) => Math.abs(d.door.x) < W / 2 - 1 && d.z > -L.depth / 2 && d.z < L.depth / 2));
  const xs = rooms.map((d) => d.door.x).sort((a, b) => a - b), gaps = xs.slice(1).map((x, i) => x - xs[i]);
  check('room doors 15 m apart on each wing, the lobby (21 m) in the middle', gaps.filter((g) => Math.abs(g - 15) < 1e-6).length === 8 && gaps.some((g) => Math.abs(g - 36) < 1e-6), gaps.join(' '));
  const r1 = defs.get('PL_HEAL_R1').size;
  const area = rooms.reduce((s, d) => s + defs.get(d.place).size.w * defs.get(d.place).size.d, 0);
  check('each room ≈ 100 평 (330 m²), the ten together ≈ 1,000 평 (3,300 m²)', Math.abs(r1.w * r1.d - 330) < 5 && Math.abs(area - 3300) < 50, `${r1.w} × ${r1.d} = ${r1.w * r1.d} m² · ${area} m²`);
  check('the corridor runs the length of the ten room fronts plus the lobby (one storey)', W === 171 && L.depth === 9);
}

// ---- door states
{
  check('door(room, state) takes R1 · 3 · PL_HEAL_R2 and the four states', H.door('R1', 'done') && H.door(3, 'next') && H.door('PL_HEAL_R2', 'run') && H.door('R10', 'idle'));
  check('door() refuses unknown states and rooms', !H.door('R4', 'blink') && !H.door('R11', 'next') && !H.door('STAY', 'next') && !H.door(null, 'next'));
  const d = H.doors();
  check('doors() reports every room', Object.keys(d).length === 10 && d.R1 === 'done' && d.R3 === 'next' && d.R2 === 'run' && d.R4 === 'idle');
  check('corridor() carries the door states', H.corridor().find((x) => x.room === 'R3').state === 'next');
  check('place(room) maps keys to place ids', H.place('R7') === 'PL_HEAL_R7' && H.place(10) === 'PL_HEAL_R10' && H.place('STAY') === 'PL_HEAL_STAY' && H.place('x') === null);
}

// ---- 제10관 for children: gentle unless the program opens the full sequence
{
  G.easy.on = true; delete G.sys.healing;
  const a = H.gentle();
  G.easy.on = false;
  const b = H.gentle();
  G.sys.healing = { room10Full: () => false };
  const c = H.gentle();
  G.sys.healing = { room10Full: () => true }; G.easy.on = true;
  const d = H.gentle();
  delete G.sys.healing; G.easy.on = true;
  check('제10관 is gentle in easy mode, full in normal mode, and the program decides when it answers', a === true && b === false && c === true && d === false, JSON.stringify([a, b, c, d]));
  check('the easy name of 제10관 says no word about death (마음 돌아보기)', defs.get('PL_HEAL_R10').kidName === '제10관 마음 돌아보기');
}

// ---- the plot in the valley
{
  const L = G.data.layout, b = L.buildings.find((x) => x.id === 'B_HEAL');
  check('[heal] B_HEAL stands on its plot (x 8 … 68, z −126 … −110, front to the south)', b && b.x === 38 && b.z === -118 && b.w === 60 && b.d === 16 && (b.rot || 0) === 0);
  const overlap = L.buildings.filter((o) => o.id !== 'B_HEAL').filter((o) => {
    const c = Math.abs(Math.cos(o.rot || 0)), sn = Math.abs(Math.sin(o.rot || 0));
    const hw = (c * o.w + sn * o.d) / 2 + 3, hd = (sn * o.w + c * o.d) / 2 + 3;     // the other's extents, turned
    return Math.abs(o.x - b.x) < hw + b.w / 2 && Math.abs(o.z - b.z) < hd + b.d / 2;
  });
  check('no other building within 3 m of the plot', overlap.length === 0, overlap.map((o) => o.id).join(' '));
  const inBox = b.x - b.w / 2 >= L.bounds.minX + 5 && b.x + b.w / 2 <= L.bounds.maxX - 5 && b.z - b.d / 2 >= L.bounds.minZ + 5;
  check('the plot lies inside the walkable valley', inBox);
  const river = (z) => { const p = L.river.points; for (let i = 1; i < p.length; i++) if (z <= p[i][1]) { const t = (z - p[i - 1][1]) / (p[i][1] - p[i - 1][1]); return p[i - 1][0] + (p[i][0] - p[i - 1][0]) * t; } return p[p.length - 1][0]; };
  check('the river (16 m wide) stays clear of the plot', river(b.z) - L.river.width / 2 > b.x + b.w / 2 + 8, `river centre ${river(b.z).toFixed(1)}`);
  check('a stone path leads to the door', L.paths.some((p) => p.id === 'PATH_HEAL' && Math.hypot(p.points.at(-1)[0] - b.x, p.points.at(-1)[1] - (b.z + b.d / 2)) < 2));
}
check('no error was logged while defining', !events.some((e) => e[0] === 'error'), events.filter((e) => e[0] === 'error').map((e) => e[1]).join(' | '));

const failed = results.filter((r) => !r.ok);
if (jsonOut) console.log(JSON.stringify({ passed: results.length - failed.length, failed: failed.length, results }, null, 1));
else console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
