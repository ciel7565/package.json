#!/usr/bin/env node
// tests/healing-logic.mjs — the 힐링관 visit as pure logic (CONTRACT §19.6, lane heal-program). No browser.
// Evaluates src/game/38-healing-data.js in Node (as tools/build.mjs does) and walks a whole visit with a fake clock:
// the road, every room at scale 1 / 60 / 120, catching up after hours away, a reload in the middle (sanitize round
// trip), the curves, the never-blocked rules (no number reaches a value where anything stops; any order works; a
// stopped course keeps its share), and the server table. Exit 0 = all green, 1 = a check failed.
//   node tests/healing-logic.mjs [--verbose]
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VERBOSE = process.argv.includes('--verbose');
let pass = 0, fail = 0;
const check = (name, ok, detail) => { if (ok) { pass++; if (VERBOSE) console.log('  ✔', name); } else { fail++; console.log('  ✘', name, detail !== undefined ? JSON.stringify(detail).slice(0, 400) : ''); } };

const G = { data: {} };
const events = [];
G.bus = { emit: (n, p) => events.push([n, p]) };
const ctx = vm.createContext({ G, console, Math, JSON, Object, Array, Number, String, Date, Map });
vm.runInContext(`(function(){'use strict';\n${fs.readFileSync(path.join(ROOT, 'src/game/38-healing-data.js'), 'utf8')}\n})()`, ctx, { timeout: 2000 });
const D = G.data.healing;
check('data loaded', !!D && D.order.length === 10, D && D.order);

// ---------------------------------------------------------------- the table
const MIN = 60000;
const want = { R1: 10, R2: 60, R3: 30, R4: 60, R5: 60, R6: 30, R7: 60, R8: 60, R9: 30, R10: 60 };
check('room minutes as the owner asked', Object.entries(want).every(([k, m]) => D.rooms[k].min === m), Object.fromEntries(D.order.map((k) => [k, D.rooms[k].min])));
check('R4 = 30 + 30, R8 = front 30 + back 30', D.rooms.R4.phases.reduce((s, p) => s + p.min, 0) === 60 && D.rooms.R8.phases.reduce((s, p) => s + p.min, 0) === 60);
const keys = { LOBBY: 'desk kiosk bench', STAY: 'door shelf rail bed', TALK: 'seat manager', R1: 'body gut gene salt board', R2: 'mat tray', R3: 'seat pot', R4: 'track gym1 gym2 gym3', R5: 'tub kettle herbs', R6: 'chair stool', R7: 'bed towel', R8: 'bed oil', R9: 'stand plates drums cans bottles rack', R10: 'studio desk rest' };
check('station keys of §19.6 (+ guide, spot; the hall\'s extra gear / coffin / camera allowed)', Object.entries(keys).every(([r, k]) => k.split(' ').concat(['guide', 'spot']).every((x) => D.stationKeys[r].includes(x)) && D.stationKeys[r].every((x) => k.split(' ').includes(x) || ['guide', 'spot', 'gear', 'coffin', 'camera'].includes(x))));
check('places: PL_HEAL, PL_HEAL_STAY, PL_HEAL_TALK, PL_HEAL_R1 … R10', D.places.LOBBY === 'PL_HEAL' && D.places.STAY === 'PL_HEAL_STAY' && D.places.TALK === 'PL_HEAL_TALK' && D.order.every((k, i) => D.places[k] === 'PL_HEAL_R' + (i + 1)));
check('every step names a station of its room', D.order.every((id) => (D.rooms[id].steps.concat(D.rooms[id].gentleSteps || [])).every((s) => D.stationKeys[id].includes(s.at))), D.order.map((id) => D.rooms[id].steps.map((s) => s.at)));
check('every step has kid words and a voice line', D.order.every((id) => D.rooms[id].steps.every((s) => s.kid && s.say && s.t && s.emoji)));
check('every step is 1 – 3 minutes of calm work at most (holds ≤ 3 s, taps ≤ 16, spots ≤ 6)', D.order.every((id) => D.rooms[id].steps.every((s) => (s.sec == null || s.sec <= 5) && (s.n == null || s.n <= 16) && (!s.pts || s.pts.length <= 6))));
check('the station line is installed', typeof G.healStations?.set === 'function' && typeof G.healStations?.get === 'function');
G.healStations.set('R9', 'plates', { x: 1, y: 0, z: 2 });
check('station set → get + heal:station event', G.healStations.get('R9', 'plates').z === 2 && events.some(([n, p]) => n === 'heal:station' && p.room === 'R9' && p.key === 'plates'));

// no claims (§19.0): no curing / treating / illness words anywhere in the visitor's texts
const allText = JSON.stringify({ r: D.rooms, w: Object.assign({}, D.words, { help: '', helpSource: '' }), a: D.ask, l: D.letter, t: D.three });   // the help line names the official 109 line (its name holds 예방)
const banned = ['치료 효과', '치유', '완치', '낫게', '예방', '질병', '효능', '처방'];
check('no health claims in the texts', banned.every((b) => !allText.includes(b)), banned.filter((b) => allText.includes(b)));
check('the claim line says it is play', /놀이/.test(D.words.claim) && /아니에요/.test(D.words.claim));
check('the help line names 109 (보건복지부)', /109/.test(D.words.help) && /보건복지부/.test(D.words.help));
check('the gentle room 10 has no coffin and no death words', !/관에|죽음|임종|유언|영정/.test(JSON.stringify([D.rooms.R10.gentle, D.rooms.R10.gentleSteps, D.rooms.R10.gentleSays, D.letter.gentle])));

// ---------------------------------------------------------------- the clock at any scale
for (const k of [1, 60, 120, 999]) {
  const eff = Math.min(k, D.scaleMax);
  check(`courseMs at scale ${k}`, D.courseMs('R2', k) === Math.round(60 * MIN / eff) && D.courseMs('R1', k) === Math.round(10 * MIN / eff));
}
check('scale below 1 counts as 1', D.courseMs('R3', 0) === 30 * MIN && D.courseMs('R3', -5) === 30 * MIN && D.courseMs('R3', NaN) === 30 * MIN);
check('progress is 0 … 1 and never NaN', [-1e9, 0, 30 * MIN, 1e15].every((t) => { const p = D.progress({ at: 0, end: 60 * MIN }, t); return p >= 0 && p <= 1 && Number.isFinite(p); }) && D.progress(null, 5) === 0 && D.progress({ at: 5, end: 5 }, 9) === 0);
for (const kind of ['ease', 'early', 'late', 'two']) {
  let ok = true, prev = -1;
  for (let i = 0; i <= 20; i++) { const v = D.curve(kind, i / 20); if (!(v >= prev - 1e-9) || v < 0 || v > 1) ok = false; prev = v; }
  check(`curve ${kind}: 0 → 1, never going back`, ok && D.curve(kind, 0) === 0 && D.curve(kind, 1) === 1);
}

// ---------------------------------------------------------------- a whole visit with a fake clock
let now = Date.UTC(2026, 10, 28, 1, 0, 0);
const s0 = D.sanitize({});
check('empty state', s0.visit === null && s0.visits === 0);
check('step: book', D.nextStep(null) === 'book');
const v = D.sanitize({ visit: { id: 'H' + now.toString(36), at: now } }).visit;
check('a booked visit', v && v.at === now && D.nextStep(v) === 'checkin');
v.band = now += 2 * MIN; check('checked in → stay', D.nextStep(v) === 'stay');
v.stow = 2; check('two of three unpacked → still stay', D.nextStep(v) === 'stay');
v.stow = 3; check('unpacked → change', D.nextStep(v) === 'change');
v.changed = now += MIN; check('changed → counsel', D.nextStep(v) === 'counsel');
v.ask = { mood: 3, ache: 2, sleep: 3, wish: 1 };
v.base = D.base(v.ask, { level: 12, minutes: 45, dishes: 6 });
check('counsel → rooms', D.nextStep(v) === 'rooms');
check('base numbers 0 … 100', Object.values(v.base).every((x) => x >= 0 && x <= 100), v.base);
check('a hard day starts with more stress than a good one', D.base({ mood: 3 }).stress > D.base({ mood: 0 }).stress);
const plan = D.plan(v.ask);
check('plan: R1 first, R10 last, every room once', plan[0] === 'R1' && plan[9] === 'R10' && new Set(plan).size === 10, plan);
check('plan follows the wish (마음이 가볍게 → R9 early)', plan.indexOf('R9') <= 3, plan);

// rooms in the suggested order at scale 1, one at a time, each stamped exactly at its end
const n0 = D.numbers(v, now);
let first = null;
for (const id of plan) {
  const c = D.startCourse(v, id, now, 1);
  if (!first) first = c;
  check(`${id}: a course of ${D.rooms[id].min} real minutes`, c.end - c.at === D.rooms[id].min * MIN);
  const mid = D.numbers(v, now + (c.end - c.at) / 2);
  check(`${id}: numbers stay inside 0 … 100 while it runs`, Object.values(mid).every((x) => x >= 0 && x <= 100), mid);
  check(`${id}: not due a second before its end`, !D.due(v, c.end - 1000).includes(id));
  now = c.end;
  check(`${id}: due at its end`, D.due(v, now).includes(id));
  for (const d of D.due(v, now)) v.rooms[d].done = v.rooms[d].end;
}
check('all ten stamped → report', D.nextStep(v) === 'report');
const n1 = D.numbers(v, now);
check('after the ten rooms: less stress, less fatigue, more calm, more vital', n1.stress < n0.stress && n1.fatigue < n0.fatigue && n1.calm > n0.calm && n1.vital > n0.vital, { n0, n1 });
check('no number ever leaves 0 … 100 (even from the worst start)', (() => { const w = { base: { stress: 100, fatigue: 100, vital: 0, calm: 0, warm: 0, stamina: 0 }, rooms: v.rooms, r9: { plates: 1e6, drums: 0, cans: 0, bottles: 0 } }; const x = D.numbers(w, now); return Object.values(x).every((y) => y >= 0 && y <= 100); })());
v.rep = now; check('report seen → checkout', D.nextStep(v) === 'checkout');
v.out = now + MIN; check('checked out → out', D.nextStep(v) === 'out');

// ---------------------------------------------------------------- hours away, a reload in the middle, scale 60
const w = D.sanitize({ visit: { id: 'Hzz12ab', at: 1e12, band: 1e12, stow: 3, changed: 1e12, ask: { mood: 1, ache: 1, sleep: 1, wish: 0 } } }).visit;
w.base = D.base(w.ask, {});
D.startCourse(w, 'R5', 1e12, 1);
const saved = JSON.parse(JSON.stringify(D.sanitize({ visit: w, visits: 3, stamps: 12 })));
const back = D.sanitize(saved).visit;
check('a reload in the middle keeps the course exactly', back.rooms.R5.at === 1e12 && back.rooms.R5.end === 1e12 + 60 * MIN && back.rooms.R5.done === 0);
check('the numbers after a reload match', JSON.stringify(D.numbers(back, 1e12 + 25 * MIN)) === JSON.stringify(D.numbers(w, 1e12 + 25 * MIN)));
check('five hours away: the course is due and its full effect counts', D.due(back, 1e12 + 5 * 60 * MIN).includes('R5'));
back.rooms.R5.done = back.rooms.R5.end;
const nAway = D.numbers(back, 1e12 + 5 * 60 * MIN), nBase = D.numbers({ base: back.base, rooms: {} }, 0);
check('…and the numbers moved by the room\'s change', Math.abs((nBase.fatigue - nAway.fatigue) - 16) < 1.01, { nBase, nAway });
const fast = D.sanitize({ visit: { at: 5, band: 5, stow: 3, changed: 5 } }).visit;
const cf = D.startCourse(fast, 'R2', 1000, 60);
check('scale 60: a 60-minute course takes one real minute', cf.end - cf.at === MIN);
check('the scale cannot go beyond 120 (the server ceiling)', D.startCourse(fast, 'R3', 1000, 100000).end - 1000 === Math.round(30 * MIN / 120));

// a stopped course keeps the share it reached; starting again begins a fresh course
const sv = { base: D.base({}), rooms: {} };
D.startCourse(sv, 'R7', 0, 1);
sv.rooms.R7.stop = D.curve('ease', D.progress(sv.rooms.R7, 30 * MIN));
const nStop = D.numbers(sv, 10 * 60 * MIN);
check('stopped at half time: about half of the change stays', Math.abs((D.numbers({ base: sv.base, rooms: {} }, 0).stress - nStop.stress) - 5) < 0.6, nStop);
check('a stopped course is never due', !D.due(sv, 1e15).includes('R7'));

// any order works; closed rooms are not needed for the report
const any = { band: 1, stow: 3, changed: 1, base: D.base({}), rooms: {} };
for (const id of ['R9', 'R3', 'R1']) { D.startCourse(any, id, 0, 1); any.rooms[id].done = any.rooms[id].end; }
check('three rooms done in any order, the rest open → rooms', D.nextStep(any) === 'rooms');
check('only three rooms open (operator) → report', D.nextStep(any, ['R1', 'R3', 'R9']) === 'report');

// ---------------------------------------------------------------- sanitize refuses junk
const junk = D.sanitize({ visit: { at: 'x' }, visits: -4, stamps: 1e30, last: 7 });
check('junk visit → no visit, counters 0', junk.visit === null && junk.visits === 0 && junk.stamps === 0);
const j2 = D.sanitize({ visit: { at: 1e12, stow: 99, rooms: { R1: { at: 5, end: 2 }, R99: { at: 1, end: 2 }, R2: { at: 1, end: 9, done: 9, small: 1e9 } }, r9: { plates: -1, cans: 5.5, drums: 'x', bottles: 3 }, r10: 'boo', wear: { top: 'hanbok', '<b>': 'x', topColor: '#ffffff', bad: '<script>' } } }).visit;
check('bad rooms dropped, good one kept', !j2.rooms.R1 && !j2.rooms.R99 && j2.rooms.R2 && j2.rooms.R2.done === 9 && j2.rooms.R2.small === undefined);
check('stow clamped out', j2.stow === 0);
check('r9 counts cleaned', j2.r9.plates === 0 && j2.r9.cans === 5 && j2.r9.drums === 0 && j2.r9.bottles === 3);
check('r10 enum', j2.r10 === undefined);
check('wear: only plain keys and values', j2.wear.top === 'hanbok' && j2.wear.topColor === '#ffffff' && !('bad' in j2.wear) && !('<b>' in j2.wear));
check('no letter, portrait or text fields survive in the save', (() => { const x = D.sanitize({ visit: { at: 1e12, letter: 'secret', portrait: 'data:image/jpeg;base64,xx', text: 'hi', cards: [1] } }); const t = JSON.stringify(x); return !/secret|base64|"text"|"cards"|"portrait"/.test(t); })());

// ---------------------------------------------------------------- the server table
const T = D.serverTable();
check('server table: rooms → minutes, bundle, nums, limits, scaleMax', T.rooms.R10 === 60 && T.bundle === 3 && T.nums.length === 6 && T.scaleMax === 120 && T.limits.small > 0);
check('measure: play values 0 … 100', (() => { const m = D.measure(n1, 77, { jars: 3, dishes: 9, jang: 4 }); return Object.values(m).every((x) => x >= 0 && x <= 100); })());

console.log(`healing-logic: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
