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
  G.easy.on = true; H.setRoom10(true);
  const e = H.gentle();
  H.setRoom10(false); G.easy.on = false;
  const f2 = H.gentle();
  H.setRoom10(null);
  const g2 = H.gentle();
  G.easy.on = true;
  check('setRoom10(full) is remembered for later builds (true → full, false → gentle, null → back to the default)', e === false && f2 === true && g2 === false, JSON.stringify([e, f2, g2]));
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

// ---- [heal-look] the census: every place built with the REAL kits and three.js (the harness of tests/myroom-logic.mjs),
// at medium and at low. Per place: the pieces the layout adds by material key, the things by kind (G.healHall.census),
// the meshes (≈ draw calls of the colour pass) and triangles, the share of the floor within 2.5 m of a thing, and a free
// walking lane of 1.6 m (a walker of radius 0.8 among every collider) from the door to within 1.5 m of every station of
// the program (2 m for a raised one: a seat, a bed or a chair is sat on from its side).
const census = [];
{
  const { makeRoomWorld } = await import('./myroom-logic.mjs');
  let W = null;
  try { W = await makeRoomWorld(ROOT); } catch (e) { check('[census] the real-kit world starts', false, String(e.stack || e).slice(0, 300)); }
  if (W) {
    const { THREE: T3, Gb, colliders, warns } = W;
    const proxy2d = () => new Proxy({}, { get: (t, k) => (k in t ? t[k] : k === 'measureText' ? () => ({ width: 10 }) : /^create.*(Gradient|Pattern)$/.test(String(k)) ? () => ({ addColorStop() {} }) : () => {}), set: (t, k, v) => { t[k] = v; return true; } });
    const doc = { createElement: () => ({ width: 256, height: 256, style: {}, getContext() { return this._c || (this._c = proxy2d()); } }) };
    Gb.register = (s) => { Gb.sys[s.name] = s; };
    Gb.easy = { on: true }; Gb.settings = Object.assign(Gb.settings || {}, { easyMode: true });
    const loadReal = (file) => vm.runInThisContext(`(function (THREE, G, document, setTimeout) {\n${src(file)}\n})`, { filename: file })(T3, Gb, doc, setTimeout);
    // the avatar kit for the people of the rooms (its far figures need no textures); the two staff looks by name
    let avatarOk = false;
    try {
      const BGU = await import(new URL('../node_modules/three/examples/jsm/utils/BufferGeometryUtils.js', import.meta.url).href);
      const RB = await import(new URL('../node_modules/three/examples/jsm/geometries/RoundedBoxGeometry.js', import.meta.url).href);
      Gb.data.avatar = undefined;
      for (const f of ['02-avatar-data.js', '20-avatar.js']) vm.runInThisContext(`(function (THREE, ADDONS, G, document, window, performance) {\n${src(f)}\n})`, { filename: f })(T3, { BufferGeometryUtils: BGU, RoundedBoxGeometry: RB.RoundedBoxGeometry }, Gb, doc, {}, performance);
      const npc = src('25-npc.js'), look = (name) => { const m = new RegExp(`\\n    ${name}: \\{ label: '[^']*', app: (\\{[^\\n]*\\}) \\},`).exec(npc); return m ? { app: Function(`return (${m[1]})`)() } : null; };
      Gb.data.npcLooks = { looks: { healstaff: look('healstaff'), healstaffM: look('healstaffM') } };
      avatarOk = typeof Gb.avatar?.far?.create === 'function' && !!Gb.data.npcLooks.looks.healstaff && !!Gb.data.npcLooks.looks.healstaffM;
    } catch (e) { check('[census] the avatar kit loads (people of the rooms)', false, String(e.stack || e).slice(0, 300)); }
    try { loadReal('02-layout.js'); loadReal('69-healing-hall.js'); Gb.sys.healHall.init(); } catch (e) { check('[census] 69-healing-hall.js loads next to the real kits', false, String(e.stack || e).slice(0, 300)); }
    // record every piece a layout adds after the shell (generators call T.add on the room, so they are seen too)
    const realRoom = Gb.hanok.room, pieces = [];
    let rec = false;
    Gb.hanok.room = (c, spec) => {
      const R = realRoom(c, spec), add0 = R.add.bind(R), fin0 = R.finish.bind(R);
      R.add = (key, g, m, tint, o) => {
        if (rec && g && g.attributes?.position) {
          g.computeBoundingBox(); const bb = g.boundingBox.clone(); if (m) bb.applyMatrix4(m);
          pieces.push({ key, x0: bb.min.x, x1: bb.max.x, z0: bb.min.z, z1: bb.max.z, y0: bb.min.y, y1: bb.max.y });
        }
        return add0(key, g, m, tint, o);
      };
      R.finish = (o) => { rec = false; return fin0(o); };
      rec = true;
      return R;
    };
    const defsR = Gb.sys.places._defs;
    for (const low of [false, true]) for (const id of Gb.healHall.PLACES) {
      const def = defsR.get(id); if (!def) { check(`[census] ${id} defined in the real world`, false); continue; }
      pieces.length = 0; for (const k of [...colliders.keys()]) colliders.delete(k);
      const group = new T3.Group(); group.position.set(def.origin.x, 0, def.origin.z);
      const ctxC = new Proxy({ id, def, place: def, group, size: def.size, origin: def.origin, floorY: 0, low, quality: low ? 'low' : 'medium', preset: { shadows: !low },
        own: (x) => x, anchor() {}, lightCount: 0, light: (cfg) => ({ cfg, light: null, set() {} }), addCollider: (c) => Gb.world.addCollider(c),
        exitDoor: () => ({}), onUpdate() {}, interact: () => ({ unregister() {} }), board: () => ({}) }, { get: (t, k) => (k in t ? t[k] : typeof k === 'symbol' ? undefined : (t[k] = () => ({}))) });
      const w0 = warns.length;
      let live = null;
      try { live = def.build(ctxC); } catch (e) { check(`[census] ${id} builds (${low ? 'low' : 'medium'})`, false, String(e.stack || e).slice(0, 300)); continue; }
      group.updateMatrixWorld(true);
      let meshes = 0, tris = 0, nan = 0;
      group.traverseVisible((o) => {    // (a hidden group — the coffin or the daybed of 제10관 — is not drawn)
        if (!(o.isMesh || o.isPoints || o.isInstancedMesh)) return;
        meshes++;
        const pa = o.geometry?.attributes?.position; if (!pa) return;
        for (let i = 0; i < pa.array.length; i++) if (!Number.isFinite(pa.array[i])) { nan++; break; }
        tris += (o.geometry.index ? o.geometry.index.count : pa.count) / 3 * (o.isInstancedMesh ? o.count : 1);
      });
      const w = def.size.w, d = def.size.d, room = id === 'PL_HEAL' ? 'LOBBY' : id.replace('PL_HEAL_', '');
      // the share of the floor within 2.5 m of a thing (pieces lower than 2.6 m whose footprint is not a floor of its own)
      const things = pieces.filter((p) => p.y0 < 2.6 && (p.x1 - p.x0) * (p.z1 - p.z0) < 30);
      const st = 0.25, near = 2.5;
      let cells = 0, cov = 0, cov1 = 0;
      const rx = id === 'PL_HEAL' ? 30 : w / 2;     // the hall: the lobby only (60 m of the 171 m gallery around it)
      for (let x = -rx + st / 2; x < rx; x += st) for (let z = -d / 2 + st / 2; z < d / 2; z += st) {
        cells++;
        let m2 = Infinity;
        for (const p of things) { const dx = Math.max(p.x0 - x, 0, x - p.x1), dz = Math.max(p.z0 - z, 0, z - p.z1); m2 = Math.min(m2, dx * dx + dz * dz); if (m2 <= 1.44) break; }
        if (m2 <= near * near) cov++;
        if (m2 <= 1.44) cov1++;
      }
      // the free lane: a walker of radius 0.8 among every collider, from the door to each station (to within 1.5 m)
      const cols = [...colliders.values()].map((c) => ({ ...c, x: c.x - (Math.abs(c.x) > 300 ? def.origin.x : 0), z: c.z - (Math.abs(c.z) > 300 ? def.origin.z : 0) }));
      const freeAt = (x, z, r) => {
        if (Math.abs(x) > w / 2 - r || Math.abs(z) > d / 2 - r) return false;
        for (const c of cols) {
          if (c.maxY != null && c.maxY <= 0.05) continue;
          const dx = x - c.x, dz = z - c.z;
          if (c.shape === 'circle') { if (dx * dx + dz * dz <= (c.r + r) * (c.r + r)) return false; continue; }
          const a = c.rot || 0, co = Math.cos(a), sn = Math.sin(a);
          if (Math.abs(dx * co - dz * sn) <= c.hw + r && Math.abs(dx * sn + dz * co) <= c.hd + r) return false;
        }
        return true;
      };
      const lane = (r) => {
        const g = 0.1, nx = Math.round(w / g), nz = Math.round(d / g), seen = new Uint8Array(nx * nz), q = [];
        const at = (i, j) => [-w / 2 + (i + 0.5) * g, -d / 2 + (j + 0.5) * g];
        const ex = def.spawn || { x: 0, z: d / 2 - 2 };
        let si = Math.floor((ex.x + w / 2) / g), sj = Math.floor((ex.z + d / 2) / g);
        if (!freeAt(...at(si, sj), r)) for (let k = 1; k < 40 && !freeAt(...at(si, sj), r); k++) sj--;
        if (freeAt(...at(si, sj), r)) { seen[si * nz + sj] = 1; q.push(si * nz + sj); }
        for (let h = 0; h < q.length; h++) {
          const i = Math.floor(q[h] / nz), j = q[h] % nz;
          for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const ii = i + a, jj = j + b; if (ii < 0 || jj < 0 || ii >= nx || jj >= nz || seen[ii * nz + jj]) continue;
            seen[ii * nz + jj] = 2; if (freeAt(...at(ii, jj), r)) { seen[ii * nz + jj] = 1; q.push(ii * nz + jj); }
          }
        }
        const miss = [];
        for (const key of Gb.healHall.stations(room)) {
          const s = Gb.healStations.get(room, key); if (!s || key === 'board' || key === 'camera') continue;
          const p = s.userData.local; let best = Infinity;
          for (let i = Math.max(0, Math.floor((p.x + w / 2 - 1.6) / g)); i < Math.min(nx, Math.ceil((p.x + w / 2 + 1.6) / g)); i++)
            for (let j = Math.max(0, Math.floor((p.z + d / 2 - 1.6) / g)); j < Math.min(nz, Math.ceil((p.z + d / 2 + 1.6) / g)); j++)
              if (seen[i * nz + j] === 1) { const [x, z] = at(i, j); best = Math.min(best, Math.hypot(x - p.x, z - p.z)); }
          if (!(best <= (p.y >= 0.3 ? 2.0 : 1.5))) miss.push(key);   // a seat, bed or chair (raised) is sat on from 2 m
        }
        return { cells: q.length, miss };
      };
      const L16 = lane(0.8), L07 = lane(0.35);
      // the people: one instanced figure mesh per room, every figure finite and inside the room
      const crowd = []; group.traverse((o) => { if (/^heal-people-/.test(o.name || '')) crowd.push(o); });
      let pplBad = 0; const m4 = new T3.Matrix4(), pv = new T3.Vector3();
      for (const cm of crowd) for (let i = 0; i < cm.count; i++) { cm.getMatrixAt(i, m4); pv.setFromMatrixPosition(m4); if (!m4.elements.every(Number.isFinite) || Math.abs(pv.x) > (id === 'PL_HEAL' ? 85 : w / 2) || Math.abs(pv.z) > d / 2) pplBad++; }
      const byKey = {}; for (const p of pieces) byKey[p.key] = (byKey[p.key] || 0) + 1;
      const kinds = Gb.healHall.census?.(room) || {};
      census.push({ id, room, low, meshes, tris: Math.round(tris), nan, pieces: pieces.length, byKey, kinds, things: Object.values(kinds).reduce((s, n) => s + n, 0), cover: cells ? cov / cells : 0, cover12: cells ? cov1 / cells : 0, crowdMeshes: crowd.length, crowdCount: crowd.reduce((n, c) => n + c.count, 0), pplBad, colliders: cols.length, lane16: L16, lane07: L07, warns: warns.slice(w0) });
      try { live?.dispose?.(); } catch (e) { /* reported below */ }
    }
    // 제10관 in both variants: the gentle one shows a daybed under a quilt where the full one shows the coffin
    {
      const def = defsR.get('PL_HEAL_R10'), vis = {};
      for (const full of [false, true]) {
        Gb.healHall.setRoom10(full);
        const group = new T3.Group();
        const c2 = new Proxy({ id: def.id, def, place: def, group, size: def.size, origin: def.origin, floorY: 0, low: false, quality: 'medium', preset: { shadows: true }, own: (x) => x, anchor() {}, lightCount: 0, light: (cfg) => ({ cfg, light: null, set() {} }), addCollider: (c) => Gb.world.addCollider(c), exitDoor: () => ({}), onUpdate() {}, interact: () => ({ unregister() {} }), board: () => ({}) }, { get: (t, k) => (k in t ? t[k] : typeof k === 'symbol' ? undefined : (t[k] = () => ({}))) });
        const live = def.build(c2);
        const coffin = group.getObjectByName('heal-r10-coffin'), bed = group.getObjectByName('heal-r10-daybed');
        vis[full ? 'full' : 'gentle'] = { coffin: !!coffin?.visible, daybed: !!bed?.visible };
        Gb.healHall.setRoom10(!full);
        vis[full ? 'fullThenGentle' : 'gentleThenFull'] = { coffin: !!coffin?.visible, daybed: !!bed?.visible };
        live?.dispose?.(); for (const k of [...colliders.keys()]) colliders.delete(k);
      }
      Gb.healHall.setRoom10(null);
      check('[census] 제10관: gentle = a daybed under a quilt and no coffin; full = the coffin and no daybed; setRoom10 switches a built room', vis.gentle.daybed && !vis.gentle.coffin && vis.full.coffin && !vis.full.daybed && vis.gentleThenFull.coffin && !vis.gentleThenFull.daybed && vis.fullThenGentle.daybed && !vis.fullThenGentle.coffin, JSON.stringify(vis));
    }
    for (const c of census) {
      const tag = `${c.room} (${c.low ? 'low' : 'medium'})`;
      check(`[census] ${tag}: every geometry finite, nothing warned`, c.nan === 0 && !c.warns.length, c.warns.slice(0, 2).join(' | '));
      check(`[census] ${tag}: a 0.7 m path from the door to every station`, !c.lane07.miss.length, c.lane07.miss.join(' '));
      if (c.room === 'LOBBY') { const miss = c.lane16.miss.filter((k) => k !== 'guide'); check(`[census] ${tag}: a free 1.6 m lane from the glass doors to the desk, the kiosk and the bench (the keeper's place behind the counter is staff-only)`, !miss.length, miss.join(' ')); }
    }
    // the rooms that are full now (the rest follow, two per commit): many things, most of the floor near one, the lane free
    const FULL = new Set(['R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7', 'R8', 'R9', 'R10']);
    for (const c of census.filter((x) => FULL.has(x.room))) {
      const tag = `${c.room} (${c.low ? 'low' : 'medium'})`;
      check(`[census] ${tag}: full — ≥ 50 things, ≥ 60 % of the floor within 1.2 m of one`, c.things >= 50 && c.cover12 >= 0.6, `${c.things} things, ${(c.cover12 * 100).toFixed(0)} %`);
      check(`[census] ${tag}: a free 1.6 m lane from the door to every station`, !c.lane16.miss.length, c.lane16.miss.join(' '));
      check(`[census] ${tag}: still one mesh per material (≤ 50 meshes here, ≤ 0.35 M triangles)`, c.meshes <= 50 && c.tris <= 350000, `${c.meshes} meshes, ${c.tris} triangles`);
    }
    if (avatarOk) for (const c of census.filter((x) => !x.low && x.room !== 'STAY' && x.room !== 'TALK')) {
      const g = c.kinds.guest || 0, st = c.kinds.staff || 0;
      check(`[census] ${c.room}: people — ${c.room === 'LOBBY' ? '' : '3 … 6 guests, '}staff at work, all in ONE instanced mesh, finite and inside the room`, c.crowdMeshes === 1 && c.crowdCount === g + st && st >= 1 && (c.room === 'LOBBY' || (g >= 3 && g <= 6)) && !c.pplBad, `${g} guests, ${st} staff, ${c.crowdMeshes} mesh(es), ${c.pplBad} misplaced`);
    }
    const rows = census.filter((c) => !c.low);
    const table = rows.map((c) => `${c.room.padEnd(5)} things ${String(c.things).padStart(4)} · pieces ${String(c.pieces).padStart(5)} · cover 2.5 m ${(c.cover * 100).toFixed(0).padStart(3)}% / 1.2 m ${(c.cover12 * 100).toFixed(0).padStart(3)}% · meshes ${c.meshes}/${census.find((x) => x.low && x.id === c.id)?.meshes} · ${(c.tris / 1000).toFixed(0)}k tris · lane 1.6 m ${c.lane16.miss.length ? 'blocked: ' + c.lane16.miss.join(',') : 'free'}`);
    if (!jsonOut) console.log('  · census (medium; meshes medium/low)\n    ' + table.join('\n    '));
    const out = process.env.HEAL_CENSUS_OUT; if (out) fs.writeFileSync(out, JSON.stringify(census.map((c) => ({ ...c, warns: c.warns.length })), null, 1));
  }
}

const failed = results.filter((r) => !r.ok);
if (jsonOut) console.log(JSON.stringify({ passed: results.length - failed.length, failed: failed.length, results }, null, 1));
else console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
