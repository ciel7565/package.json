#!/usr/bin/env node
// =============================================================================
// tests/fishing-data.mjs — the fish table of CONTRACT §18.3, checked in Node (no browser):
//   · G.data.fish from 01-data.js + 02-layout.js + 34-fish-data.js (+ 45-education-data.js for the merge block), in a vm
//   · ≥ 30 species, every one complete (names, Latin name, family, sizes, habitats, water grade, home, look, texts,
//     sources that exist), ids unique and item-safe
//   · protected ⇒ release only: no item, never `keepable`, canKeep() says no; every other fish has its item FISH_<ID>
//     with no price; the protection list of the law (2022-12-09) is the one in the data — nothing protected is missing
//   · the calendar is sane: months 1–12, a spawning season, hours known, the closed season of 은어 (강원) works by day,
//     every month and every method has someone to meet at every spot that offers the method; a keepable fish can be
//     met in every month; the picker is deterministic for a seeded generator; rolled lengths stay inside the species
//   · look: body curves are finite and positive, fins and marks use known kinds (what 35-fishing.js can build)
//   · the save block: emptyState / sanitizeState drop unknown ids, clamp numbers, keep protected fish out of `kept`
//   · quests / achievements / sticker book / learning cards / quizzes / the deck are well formed; a quiz has exactly
//     one right answer; kid versions exist
//   · no Chinese characters, never the word §14.3 forbids, no health-claim phrase
//   · the server side (php on PATH): game-data.json built from this tree carries `fish` and the items; the PHP
//     SaveValidator accepts an honest save with catches and refuses a protected fish in the bag
// Usage: node tests/fishing-data.mjs [--json] [--no-php]      exit 0 = all pass, 1 = a check failed
// =============================================================================
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const JSON_OUT = args.includes('--json');
const NO_PHP = args.includes('--no-php');
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail: String(detail || '') });
  if (!JSON_OUT) console.log(`${ok ? '✔' : '✘'} ${name}${detail ? ` — ${detail}` : ''}`);
}
function skip(name, detail) { results.push({ name, ok: true, skip: true, detail }); if (!JSON_OUT) console.log(`– ${name} — ${detail}`); }
const list = (a, n = 6) => (a.length ? a.slice(0, n).join('; ') + (a.length > n ? ` … (+${a.length - n})` : '') : '');

// ------------------------------------------------------------------ load the data
const G = { data: {} };
const ctx = vm.createContext({ G, window: {}, console, Math, JSON, Object, Array, Number, String, Date });
for (const f of ['01-data.js', '02-layout.js', '34-fish-data.js', '45-education-data.js']) {
  const code = fs.readFileSync(path.join(ROOT, 'src/game', f), 'utf8');
  try { vm.runInContext(`(function(){'use strict';\n${code}\n})()`, ctx, { timeout: 4000, filename: f }); check(`data fragment ${f} evaluates`, true); }
  catch (e) { check(`data fragment ${f} evaluates`, false, e.message); }
}
const D = G.data, F = D.fish || {};
const S = F.species || [];
const HAB = Object.keys(F.habitats || {}), METH = Object.keys(F.methods || {}), BAIT = Object.keys(F.baits || {}), BANDS = Object.keys(F.hourBands || {});
const WEATHER = ['CLEAR', 'CLOUDY', 'RAIN', 'FOG', 'SNOW'];

// ------------------------------------------------------------------ species: complete
check('≥ 30 species', S.length >= 30, `${S.length}`);
check('ids are unique, upper-case, item-safe', new Set(S.map((s) => s.id)).size === S.length && S.every((s) => /^[A-Z]{3,24}$/.test(s.id)), S.map((s) => s.id).filter((id) => !/^[A-Z]{3,24}$/.test(id)).join(', '));
check('names are unique', new Set(S.map((s) => s.name)).size === S.length);
{
  const bad = [];
  for (const s of S) {
    const b = (m) => bad.push(`${s.id}: ${m}`);
    if (F.byId[s.id] !== s) b('byId');
    if (typeof s.name !== 'string' || !/^[가-힣]{2,8}$/.test(s.name)) b('name');
    if (typeof s.sci !== 'string' || !/^[A-Z][a-z]+ [a-z]+( [a-z]+)?$/.test(s.sci)) b(`Latin name "${s.sci}"`);
    if (typeof s.family !== 'string' || !/과$/.test(s.family)) b('family');
    const u = s.size && s.size.usual;
    if (!Array.isArray(u) || !(u[0] > 0 && u[1] >= u[0] && s.size.max >= u[1] && s.size.max <= 120)) b('size');
    if (!Array.isArray(s.habitat) || !s.habitat.length || s.habitat.some((h) => !HAB.includes(h))) b('habitat');
    if (!['west', 'east', 'both'].includes(s.basin)) b('basin');
    if (!['Ia', 'Ib'].includes(s.water)) b('water grade (only first-grade water)');
    if (typeof s.endemic !== 'boolean') b('endemic');
    if (typeof s.home !== 'string' || s.home.length < 8) b('home');
    if (!Array.isArray(s.months) || !s.months.length || s.months.some((m) => !(Number.isInteger(m) && m >= 1 && m <= 12))) b('months');
    if (!Array.isArray(s.absent) || s.absent.some((m) => !(Number.isInteger(m) && m >= 1 && m <= 12)) || s.absent.some((m) => s.months.includes(m))) b('absent');
    if (!Array.isArray(s.spawn) || !s.spawn.length || s.spawn.some((m) => !(m >= 1 && m <= 12))) b('spawn');
    if (!Array.isArray(s.hours) || !s.hours.length || s.hours.some((h) => !BANDS.includes(h))) b('hours');
    if (!s.weather || WEATHER.some((w) => !(s.weather[w] > 0 && s.weather[w] <= 2))) b('weather');
    if (!Array.isArray(s.bait) || s.bait.some((x) => !BAIT.includes(x))) b('bait');
    if (!Array.isArray(s.method) || !s.method.length || s.method.some((x) => !METH.includes(x))) b('method');
    if ((s.method.includes('rod') || s.method.includes('gyeonji') || s.method.includes('trap')) && !s.bait.length) b('a hook or a trap needs a bait');
    if (!(Number.isInteger(s.difficulty) && s.difficulty >= 1 && s.difficulty <= 5)) b('difficulty');
    if (!(s.rarity >= 1 && s.rarity <= 10)) b('rarity');
    for (const k of ['kid', 'sign', 'food', 'clean']) if (typeof s[k] !== 'string' || s[k].length < 8) b(k);
    if (!Array.isArray(s.facts) || s.facts.length < 3 || s.facts.some((t) => typeof t !== 'string' || t.length < 10)) b('facts (≥ 3)');
    if (!Array.isArray(s.sources) || !s.sources.length || s.sources.some((k) => !F.sources[k] || !F.sources[k].label)) b('sources');
    if (s.kid.split(/(?<=[.!?])\s+/).some((sent) => sent.trim().split(/\s+/).length > 13)) b('kid sentence longer than 13 words');
  }
  check('every species is complete and sourced', !bad.length, list(bad));
}

// ------------------------------------------------------------------ protection ⇒ release only
// the fish of the law's list (별표 1, 2022-12-09) that live in 강원's clean streams and are in this table
const LAW_II = ['YEOLMOGEO', 'YEONJUNMOCHI', 'BEODEULGAJI', 'SAEMI', 'EOREUMCHI', 'GANEUNDOLGOGI', 'DOLSANGEO', 'KKUGURI', 'MUKNAPJARU', 'HANGANGNAPJULGAE', 'DUKJUNGGAE', 'HANDUKJUNGGAE', 'DAMUKJANGEO', 'CHILSEONGJANGEO'];
{
  const prot = S.filter((s) => s.protected), free = S.filter((s) => !s.protected);
  const bad = [];
  for (const id of LAW_II) { const s = F.byId[id]; if (!s) bad.push(`${id} missing`); else if (!s.protected || !/endangered2/.test(s.protected.kind)) bad.push(`${id} is not marked 멸종위기 Ⅱ급`); }
  check('the 14 fish of the law\'s list (Ⅱ급, 2022-12-09) are all marked', !bad.length, list(bad));
  check('어름치 is a natural monument too', /monument/.test(F.byId.EOREUMCHI?.protected?.kind || ''));
  check('nothing else claims a legal status', prot.filter((s) => s.protected.kind !== 'care').every((s) => LAW_II.includes(s.id)), prot.filter((s) => s.protected.kind !== 'care' && !LAW_II.includes(s.id)).map((s) => s.id).join(', '));
  check('a protected fish carries label, note and who guards it', prot.every((s) => s.protected.label && s.protected.note && s.guard), prot.filter((s) => !(s.protected.label && s.protected.note && s.guard)).map((s) => s.id).join(', '));
  check('the app\'s own promise (care) says it is not the law', prot.filter((s) => s.protected.kind === 'care').every((s) => /법이 정한 보호종은 아니/.test(s.protected.note)));
  check('protected ⇒ no item, not keepable, canKeep says no', prot.every((s) => !D.items[`FISH_${s.id}`] && !F.keepable.includes(s.id) && F.itemId(s.id) === null && F.canKeep(s, 7, 1).ok === false && F.canKeep(s, 7, 1).why === 'protected'), prot.filter((s) => D.items[`FISH_${s.id}`]).map((s) => s.id).join(', '));
  check('every other fish has its item FISH_<ID> (type fish, no price, never sold)', free.every((s) => { const it = D.items[`FISH_${s.id}`]; return it && it.type === 'fish' && it.price === 0 && it.sell === 0 && it.fish === s.id && it.name === s.name && F.itemId(s.id) === `FISH_${s.id}`; }), free.filter((s) => !D.items[`FISH_${s.id}`]).map((s) => s.id).join(', '));
  check('keepable = the unprotected ones', F.keepable.length === free.length && free.every((s) => F.keepable.includes(s.id)), `${F.keepable.length} keepable, ${prot.length} release only`);
  check('no shop buys fish', Object.values(D.shops || {}).every((sh) => !(sh.buysTypes || []).includes('fish') && !(sh.sells || []).some((id) => /^FISH_/.test(id))));
}

// ------------------------------------------------------------------ calendar, closed season, candidates
{
  const eu = F.byId.EUNEO;
  check('은어: the closed season of 강원 works by day', !!eu && F.closedOn(eu, 4, 19) === false && F.closedOn(eu, 4, 20) === true && F.closedOn(eu, 5, 20) === true && F.closedOn(eu, 5, 21) === false && F.closedOn(eu, 9, 1) === true && F.closedOn(eu, 10, 31) === true && F.closedOn(eu, 11, 1) === false);
  check('은어: release only on a closed day, keepable on an open one', F.canKeep('EUNEO', 9, 15).why === 'closed' && F.canKeep('EUNEO', 7, 15).ok === true);
  check('hourBand covers the day', [0, 4.9].every((h) => F.hourBand(h) === 'night') && F.hourBand(5) === 'dawn' && F.hourBand(12) === 'day' && F.hourBand(17) === 'dusk' && F.hourBand(20) === 'night' && F.hourBand(23.9) === 'night');
  const spots = F.spots || [];
  check('≥ 6 spots on the two rivers, ids FS_…', spots.length >= 6 && spots.every((x) => /^FS_[A-Z0-9_]+$/.test(x.id)) && spots.some((x) => x.river === 'valley') && spots.some((x) => x.river === 'complex') && new Set(spots.map((x) => x.id)).size === spots.length, `${spots.length}`);
  check('spots are well formed', spots.every((x) => Number.isFinite(x.z) && ['east', 'west'].includes(x.side) && x.habitat.every((h) => HAB.includes(h)) && x.methods.length && x.methods.every((m) => METH.includes(m)) && x.name && x.kidName && x.basins.every((b) => ['east', 'west'].includes(b))));
  check('every method can be tried somewhere', METH.every((m) => spots.some((x) => x.methods.includes(m))));
  const holes = [], noKeep = [];
  let minPool = 99;
  for (const x of spots) for (const m of x.methods) for (let month = 1; month <= 12; month++) for (const hour of [6, 12, 18, 23]) {
    const c = F.candidates({ spot: x.id, method: m, month, hour, weather: 'CLEAR' });
    if (!c.length) holes.push(`${x.id}/${m}/${month}월/${hour}시`);
    minPool = Math.min(minPool, c.length);
  }
  check('someone can be met at every spot, with every method it offers, in every month and at every hour', !holes.length, list(holes));
  for (let month = 1; month <= 12; month++) {
    const ids = new Set();
    for (const x of spots) for (const m of x.methods) for (const hour of [6, 12, 18, 23]) for (const c of F.candidates({ spot: x.id, method: m, month, hour, weather: 'CLEAR' })) ids.add(c.id);
    const keep = [...ids].filter((id) => F.canKeep(id, month, 15).ok);
    if (keep.length < 5) noKeep.push(`${month}월: ${keep.length}`);
  }
  check('in every month at least five kinds can be taken along (the kitchen never starves)', !noKeep.length, list(noKeep));
  const reach = new Set();
  for (const x of spots) for (const m of x.methods) for (let month = 1; month <= 12; month++) for (const hour of [6, 12, 18, 23]) for (const c of F.candidates({ spot: x.id, method: m, month, hour, weather: 'CLEAR' })) reach.add(c.id);
  check('every species can be met somewhere in the year', S.every((s) => reach.has(s.id)), S.filter((s) => !reach.has(s.id)).map((s) => s.id).join(', '));
  check('a fish that is away is never offered', S.filter((s) => s.absent.length).every((s) => s.absent.every((mo) => spots.every((x) => x.methods.every((m) => !F.candidates({ spot: x.id, method: m, month: mo, hour: 12 }).some((c) => c.id === s.id))))));
  check('a method a spot does not offer gives nobody', F.candidates({ spot: 'FS_V_STONE', method: 'rod', month: 6, hour: 12 }).length === 0 && F.candidates({ spot: 'NOPE', method: 'rod' }).length === 0);
  // east-slope fish stay out of the valley (the 한강 윗물)
  const east = S.filter((s) => s.basin === 'east').map((s) => s.id);
  const inValley = new Set();
  for (const x of spots.filter((y) => y.river === 'valley')) for (const m of x.methods) for (let month = 1; month <= 12; month++) for (const c of F.candidates({ spot: x.id, method: m, month, hour: 12 })) inValley.add(c.id);
  check('fish of the east-coast rivers are not offered in the valley (한강 윗물)', east.every((id) => !inValley.has(id)), east.filter((id) => inValley.has(id)).join(', '));
  // the picker
  const mul = (seed) => () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const c0 = F.candidates({ spot: 'FS_V_DECK', method: 'net', month: 6, hour: 12, weather: 'CLEAR' });
  const a = [], b = [];
  let r1 = mul(7), r2 = mul(7);
  for (let i = 0; i < 40; i++) { a.push(F.pick(c0, r1)); b.push(F.pick(c0, r2)); }
  check('the picker is deterministic for a seeded generator and only returns candidates', a.join() === b.join() && a.every((id) => c0.some((c) => c.id === id)) && F.pick([], r1) === null, `${new Set(a).size} kinds in 40 picks of ${c0.length}`);
  const bad = [];
  for (const s of S) { const r = mul(s.id.length * 977); for (let i = 0; i < 300; i++) { const mm = F.rollLength(s, r); if (!(mm >= s.size.usual[0] * 8 && mm <= s.size.max * 10)) { bad.push(`${s.id}: ${mm} mm`); break; } } }
  check('rolled lengths stay inside the species (≤ the largest known)', !bad.length, list(bad));
  check('the bait matters (the favourite bait weighs more)', (() => { const q = { spot: 'FS_V_POOL', method: 'rod', month: 6, hour: 18 }; const w = (bait) => (F.candidates({ ...q, bait }).find((c) => c.id === 'KKEOKJI') || {}).w || 0; return w('worm') > w('paste'); })());
}

// ------------------------------------------------------------------ look: what the 3D builder gets
{
  const FIN_KEYS = ['dorsal', 'dorsal2', 'adipose', 'anal', 'pelvic', 'pectoral', 'tail', 'fringe'];
  const MARKS = new Set(['band', 'bars', 'parr', 'spots', 'rows', 'saddles', 'mottle', 'blotch', 'fin']);
  const FIN_MARK = new Set(['spots', 'bands', 'band', 'edge', 'tint', 'base']);
  const HEX = /^#[0-9a-f]{6}$/;
  const bad = [];
  for (const s of S) {
    const b = (m) => bad.push(`${s.id}: ${m}`);
    const L = s.look || {}, P = L.profile || {};
    for (const k of ['depth', 'width']) {
      const c = P[k];
      if (!Array.isArray(c) || c.length < 8 || c[0][0] !== 0 || c[c.length - 1][0] !== 1 || c.some(([x, d], i) => !(Number.isFinite(x) && d > 0 && d < 0.6 && (i === 0 || x > c[i - 1][0])))) b(`${k} curve`);
    }
    if (!['fish', 'lamprey'].includes(P.kind)) b('kind');
    if (!(P.head > 0.1 && P.head < 0.4) || !(P.snout >= 0 && P.snout <= 1) || !(P.arch >= -0.3 && P.arch <= 0.6)) b('head / snout / arch');
    if (!['end', 'under', 'low', 'up', 'sucker'].includes(P.mouth)) b('mouth');
    if (!Array.isArray(P.eye) || P.eye.length !== 3 || !(P.eye[0] > 0 && P.eye[0] < P.head && P.eye[2] > 0.005 && P.eye[2] < 0.09)) b('eye');
    if (!(Number.isInteger(P.barbels) && P.barbels >= 0 && P.barbels <= 4)) b('barbels');
    const Fi = L.fins || {};
    if (Object.keys(Fi).some((k) => !FIN_KEYS.includes(k))) b('unknown fin');
    if (!Fi.tail || !(Fi.tail.len > 0 && Fi.tail.fork >= 0 && Fi.tail.fork <= 1) || !['fork', 'notch', 'flat', 'round', 'point'].includes(Fi.tail.shape)) b('tail');
    if (!Fi.dorsal || !(Fi.dorsal.at > 0.2 && Fi.dorsal.at < 0.8 && Fi.dorsal.base > 0 && Fi.dorsal.h > 0)) b('dorsal');
    if (P.kind === 'fish' && !(Fi.pectoral && Fi.anal)) b('a fish has pectoral and anal fins');
    if (P.kind === 'lamprey' && (Fi.pectoral || Fi.pelvic)) b('a lamprey has no paired fins');
    const C = L.colours || {};
    for (const k of ['back', 'side', 'belly', 'fin', 'eye', 'sheen']) if (!HEX.test(C[k] || '')) b(`colour ${k}`);
    if (!Array.isArray(L.marks)) b('marks');
    for (const m of [...(L.marks || []), ...((L.breeding && L.breeding.marks) || [])]) {
      if (!MARKS.has(m.t)) b(`mark ${m.t}`);
      if (m.t === 'fin' && (!FIN_KEYS.includes(m.fin) || !FIN_MARK.has(m.kind) || !Fi[m.fin])) b(`fin mark ${m.fin}/${m.kind}`);
      if (m.c && !HEX.test(m.c)) b(`mark colour ${m.c}`);
      if (m.a != null && !(m.a > 0 && m.a <= 1)) b('mark alpha');
    }
    if (L.breeding && (!Array.isArray(L.breeding.months) || L.breeding.months.some((mo) => !(mo >= 1 && mo <= 12)))) b('breeding months');
    if (!['none', 'fine', 'medium', 'large'].includes(L.scales)) b('scales');
  }
  check('every look can be built (curves, fins, colours, marks)', !bad.length, list(bad));
  // species must not look alike: the tuple (max depth, head, tail shape, first mark) differs between any two
  const sig = (s) => `${Math.max(...s.look.profile.depth.map((p) => p[1]))}|${s.look.profile.head}|${s.look.fins.tail.shape}|${s.look.colours.side}|${(s.look.marks[0] || {}).t || '-'}`;
  check('no two species share body, tail, colour and first mark', new Set(S.map(sig)).size === S.length);
  check('the telling marks are there (산천어 parr · 어름치 dotted rows · 쉬리 bands · 열목어 dots · 금강모치 two orange bands)',
    F.byId.SANCHEONEO.look.marks.some((m) => m.t === 'parr' && m.n >= 8 && m.n <= 12)
    && F.byId.EOREUMCHI.look.marks.some((m) => m.t === 'rows' && m.rows >= 7 && m.rows <= 8)
    && F.byId.SWIRI.look.marks.filter((m) => m.t === 'band').length >= 4
    && F.byId.YEOLMOGEO.look.marks.some((m) => m.t === 'spots' && m.n >= 80)
    && F.byId.GEUMGANGMOCHI.look.marks.filter((m) => m.t === 'band' && m.c === '#e58a2a').length === 2);
  check('연어과 carry an adipose fin; 둑중개 two dorsal fins; lampreys seven gill pores', ['YEOLMOGEO', 'SANCHEONEO', 'SONGEO', 'EUNEO'].every((id) => F.byId[id].look.fins.adipose) && F.byId.DUKJUNGGAE.look.fins.dorsal2 && F.byId.DAMUKJANGEO.look.profile.gills === 7 && F.byId.CHILSEONGJANGEO.look.profile.gills === 7);
}

// ------------------------------------------------------------------ neighbours, vocabulary
{
  const N = F.neighbours || [];
  check('clean-water neighbours are observation only (≥ 3, incl. 가재 · 다슬기 · 옆새우; no items)', N.length >= 3 && ['GAJAE', 'DASEULGI', 'YEOPSAEU'].every((id) => N.some((n) => n.id === id)) && N.every((n) => n.name && n.kid && Array.isArray(n.facts) && n.facts.length >= 2 && n.sources.every((k) => F.sources[k]) && !D.items[`FISH_${n.id}`] && ['Ia', 'Ib'].includes(n.grade)));
  check('methods, baits and habitats have names and kid lines', METH.length === 4 && METH.every((m) => F.methods[m].name && F.methods[m].kid && F.methods[m].desc && F.methods[m].habitats.every((h) => HAB.includes(h)) && F.methods[m].baits.every((b) => BAIT.includes(b))) && BAIT.every((b) => F.baits[b].name && F.baits[b].kid) && HAB.every((h) => F.habitats[h].name && F.habitats[h].kid));
  check('rules: a daily keep limit, a real-time trap, wide bite windows', F.rules.keepPerDay >= 1 && F.rules.keepPerDay <= 20 && F.rules.trapMinutes >= 1 && F.rules.biteWindow.easy >= 1.2 && F.rules.biteWindow.min >= 1.2 && F.rules.biteWindow.normal >= 1.2);
  check('knowledge lines (protection, closed season, gear, enough, the learning river)', ['K_PROTECT', 'K_CLOSED', 'K_GEAR', 'K_ENOUGH', 'K_RIVER', 'K_WATER'].every((id) => (F.knowledge || []).some((k) => k.id === id && k.text.length > 20)));
  check('every source has a label and an https address', Object.values(F.sources).every((s) => s.label && /^https:\/\//.test(s.url)));
}

// ------------------------------------------------------------------ the save block
{
  const e = F.emptyState();
  check('emptyState has the documented shape', JSON.stringify(Object.keys(e).sort()) === JSON.stringify(['book', 'day', 'seen', 'traps', 'tut', 'v']) && e.v === 1);
  check('sanitizeState: junk → empty', [null, 7, 'x', [], { book: 5, traps: [], day: 'no' }].every((x) => JSON.stringify(F.sanitizeState(x)) === JSON.stringify(e)));
  const dirty = {
    v: 9, tut: 'yes', extra: 1,
    book: { BEODEULCHI: { n: 3, kept: 9, rel: -4, max: 99999, first: 1700000000000 }, YEOLMOGEO: { n: 2, kept: 2, rel: 0, max: 400 }, NOPE: { n: 1 }, __proto__: { n: 1 }, SWIRI: { n: 0 }, KKEOKJI: 'x' },
    seen: { GAJAE: true, NOPE: 1 }, day: { key: 20261123.7, kept: 1000 },
    traps: { FS_V_POOL: { at: 1700000000000, bait: 'doenjang' }, FS_NOPE: { at: 5 }, 'bad id': { at: 5 }, FS_V_DECK: { at: -1 }, FS_C_POOL: { at: 1700000000001, bait: 'gold' } },
  };
  const c = F.sanitizeState(dirty);
  check('sanitizeState keeps known ids only and clamps numbers', Object.keys(c.book).sort().join() === 'BEODEULCHI,YEOLMOGEO' && c.book.BEODEULCHI.kept === 3 && c.book.BEODEULCHI.rel >= 0 && c.book.BEODEULCHI.max === 140 && c.v === 1 && c.tut === 1 && !('extra' in c), JSON.stringify(c.book));
  check('sanitizeState: a protected fish is never "kept"', c.book.YEOLMOGEO.kept === 0 && c.book.YEOLMOGEO.rel === 2);
  check('sanitizeState: neighbours, the day and the traps', JSON.stringify(c.seen) === '{"GAJAE":1}' && c.day.key === 20261124 && c.day.kept === 99 && Object.keys(c.traps).sort().join() === 'FS_C_POOL,FS_V_POOL' && c.traps.FS_C_POOL.bait === 'paste' && c.traps.FS_V_POOL.bait === 'doenjang', JSON.stringify(c.traps));
  check('sanitizeState is idempotent', JSON.stringify(F.sanitizeState(c)) === JSON.stringify(c));
  const t = F.serverTable();
  check('serverTable: every species with its protected flag and size limit', Object.keys(t.species).length === S.length && S.every((s) => t.species[s.id].p === (s.protected ? 1 : 0) && t.species[s.id].max === Math.round(s.size.max * 10)) && t.keepPerDay === F.rules.keepPerDay && t.spots.length === F.spots.length);
}

// ------------------------------------------------------------------ quests, achievements, sticker book
{
  const QS = Object.entries(D.quests || {}).filter(([id]) => /^Q_FISH_/.test(id));
  check('fishing quests are well formed (ids, indexed objectives, rewards)', QS.length >= 3 && QS.every(([id, q]) => q.id === id && q.title && q.desc && q.easyDesc && q.objectives.length && q.objectives.every((o, i) => o.index === i && o.count >= 1 && o.text && o.easyText && ['interact', 'edu', 'fish'].includes(o.type) && (o.type !== 'fish' || ['catch', 'method', 'guard', 'release'].includes(o.what)) && (o.type !== 'interact' || (F.spots || []).some((x) => x.id === o.id))) && q.reward && q.reward.exp > 0), QS.map(([id]) => id).join(', '));
  check('quest chains point at quests that exist', QS.every(([, q]) => (q.requires || []).every((r) => D.quests[r])));
  check('the quest that needs a lesson names a lesson that exists', QS.flatMap(([, q]) => q.objectives).filter((o) => o.type === 'edu').every((o) => F.edu.cards[o.edu]));
  const AS = Object.entries(D.achievements || {}).filter(([id]) => /^ACH_FISH_/.test(id));
  const STATS = ['fishCaught', 'fishSpecies', 'fishReleased', 'fishGuarded', 'fishKept'];
  check('fishing achievements read plain counters', AS.length >= 4 && AS.every(([id, a]) => a.id === id && a.name && a.desc && STATS.includes(a.condition.stat) && a.condition.gte >= 1 && a.reward), AS.map(([id]) => id).join(', '));
  check('the "all species" achievement asks for exactly the species count', D.achievements.ACH_FISH_SPECIES_ALL?.condition.gte === S.length);
  check('the sticker book has a page for every fish', (D.collectionCategories || []).some((c) => c.id === 'fish') && S.every((s) => { const c = D.collection[`COL_FISH_${s.id}`]; return c && c.category === 'fish' && c.name === s.name && c.unlock[0].on === 'interact' && c.unlock[0].fish === s.id && !c.unlock[0].id; }));
  check('every fish that can be taken along names the kind of dish it suits; a protected one names none', S.every((s) => (s.protected ? s.cook === null : ['small', 'trout', 'bottom'].includes(s.cook))) && ['small', 'trout', 'bottom'].every((c) => S.some((s) => s.cook === c)));
  check('titles are plain words', [...QS.map(([, q]) => q.reward.title), ...AS.map(([, a]) => a.reward.title)].filter(Boolean).every((t) => /^[가-힣 0-9]{2,16}$/.test(t)));
}

// ------------------------------------------------------------------ learning cards, quizzes, the deck
{
  const E = F.edu || {}, cards = Object.entries(E.cards || {}), quizzes = Object.entries(E.quizzes || {});
  check('≥ 6 learning cards and ≥ 8 quiz items', cards.length >= 6 && quizzes.length >= 8, `${cards.length} cards, ${quizzes.length} quizzes`);
  const bad = [];
  for (const [id, c] of cards) {
    const b = (m) => bad.push(`${id}: ${m}`);
    if (c.id !== id || !/^EDU_FISH_[A-Z]+$/.test(id)) b('id');
    if (!c.title || !c.summary || !c.icon || !c.color || !c.category) b('head');
    if (!Array.isArray(c.pages) || c.pages.length < 2 || c.pages.some((p, i) => p.index !== i || !p.title || !p.text || !p.visual || !Array.isArray(p.points))) b('pages');
    if (!c.kid || !c.kid.title || !c.kid.summary || !Array.isArray(c.kid.slides) || c.kid.slides.length < 2 || c.kid.slides.some((s) => !s.text || !(s.emoji || s.steps))) b('kid version');
    if (!Array.isArray(c.sources) || !c.sources.length || c.sources.some((s) => !s.label || !/^https:\/\//.test(s.url))) b('sources');
    if (!c.quizzes.length || c.quizzes.some((q) => !E.quizzes[q]) || c.quiz === null) b('quizzes');
    if ((c.related || []).some((r) => !E.cards[r] && !(D.education || {})[r])) b('related');
  }
  check('learning cards are complete (pages, kid version, sources, a quiz)', !bad.length, list(bad));
  const qbad = [];
  for (const [id, q] of quizzes) {
    const b = (m) => qbad.push(`${id}: ${m}`);
    if (q.id !== id || !E.cards[q.edu]) b('id / card');
    if (!Array.isArray(q.choices) || q.choices.length !== 4 || new Set(q.choices).size !== 4) b('four distinct choices');
    if (!(Number.isInteger(q.answer) && q.answer >= 0 && q.answer < 4)) b('answer');
    if (!q.question || !q.explain) b('question / explain');
    if (!q.reward || !(q.reward.exp > 0 && q.reward.exp <= 100 && q.reward.edu <= 10)) b('reward within the server default');
    const k = q.kid;
    if (!k || !k.q || !k.hint || !k.why) b('kid');
    else if (k.ox) { if (typeof k.answer !== 'boolean') b('kid ox answer'); }
    else if (!Array.isArray(k.choices) || k.choices.length !== 3 || !(k.answer >= 0 && k.answer < 3) || k.choices.some((ch) => !ch.e || !ch.t)) b('kid choices');
  }
  check('quiz items have one right answer and a kid version', !qbad.length, list(qbad));
  const dk = E.deck || {};
  check('the deck 강원도 1급수 물고기 has 10–16 slides in the lecture shape', dk.id === 'DECK_FISH' && dk.title === '강원도 1급수 물고기' && dk.audience === 'all' && dk.slides.length >= 10 && dk.slides.length <= 16 && dk.slides.every((s) => s.title && s.emoji && s.picture && Array.isArray(s.lines) && s.lines.length >= 1 && s.lines.length <= 3) && !!E.cards[dk.edu], `${(dk.slides || []).length} slides`);
  // after 45-education-data.js: merged?
  const merged = cards.every(([id]) => (D.education || {})[id]) && quizzes.every(([id]) => (D.quizzes || {})[id]) && (D.lectureDecks || []).some((d) => d.id === 'DECK_FISH');
  check('45-education-data.js merges the cards, the quizzes and the deck (block [fishing])', merged, merged ? '' : 'the marked block at the end of 45-education-data.js is missing');
  if (merged) {
    check('merged cards carry their first quiz and the category', cards.every(([id]) => D.education[id].quiz === D.education[id].quizzes[0]) && !!(D.educationCategories || {}).fish);
    check('the merge does not duplicate the deck', D.lectureDecks.filter((d) => d.id === 'DECK_FISH').length === 1);
  }
}

// ------------------------------------------------------------------ text rules
{
  const src = fs.readFileSync(path.join(ROOT, 'src/game/34-fish-data.js'), 'utf8');
  const han = /[㐀-鿿豈-﫿]/;
  const forbidden = String.fromCharCode(0xac8c, 0xc784);
  check('no Chinese characters in the data file', !han.test(src), (src.match(new RegExp(han.source, 'g')) || []).slice(0, 5).join(' '));
  check('the forbidden word of §14.3 is not in the data file', !src.includes(forbidden));
  const strings = [];
  (function walk(v) { if (typeof v === 'string') strings.push(v); else if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === 'object') Object.values(v).forEach(walk); })({ s: S, n: F.neighbours, k: F.knowledge, e: F.edu, m: F.methods, b: F.baits, h: F.habitats });
  const claim = /(몸에 좋|건강에 좋|병을 고|치료|효능|보약|정력|면역)/;
  check('no health-claim phrase in any text', !strings.some((t) => claim.test(t)), strings.filter((t) => claim.test(t)).slice(0, 3).join(' | '));
  check('no price words in the kid lines', !S.some((s) => /(코인|원\b|값|팔아)/.test(s.kid)));
  check('Latin names stay in Latin letters', S.every((s) => /^[A-Za-z ]+$/.test(s.sci)) && (F.neighbours || []).every((n) => /^[A-Za-z ]+$/.test(n.sci)));
}

// ------------------------------------------------------------------ the server side
if (NO_PHP) skip('server checks', '--no-php');
else {
  const php = spawnSync('php', ['-v'], { encoding: 'utf8' });
  if (php.status !== 0) skip('server checks', 'php is not on PATH');
  else {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tfm-fish-'));
    const srv = path.join(tmp, 'srv');
    fs.cpSync(path.join(ROOT, 'server'), srv, { recursive: true, filter: (x) => !/\.sqlite(-wal|-shm)?$|config\.local\.php$|install\.lock$/.test(x) });
    const out = path.join(srv, 'data', 'game-data.json');
    const b = spawnSync(process.execPath, [path.join(ROOT, 'tools/build.mjs'), '--no-font', '--no-assets', '--quiet', '--no-precompress', '--out', path.join(tmp, 'page.html'), '--data-out', out], { encoding: 'utf8', cwd: ROOT });
    const gd = fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, 'utf8')) : null;
    check('game-data.json is built with a `fish` table', !!gd && !!gd.fish && Object.keys(gd.fish.species || {}).length === S.length, gd ? `${Object.keys((gd.fish || {}).species || {}).length} species` : (b.stderr || b.stdout || '').slice(0, 200));
    if (gd && gd.fish && gd.fish.species) {
      check('game-data.json: fish items (type fish, value 0) and no item for a protected fish', F.keepable.every((id) => gd.items[`FISH_${id}`] && gd.items[`FISH_${id}`].type === 'fish' && !gd.items[`FISH_${id}`].price && !gd.items[`FISH_${id}`].sell) && S.filter((s) => s.protected).every((s) => !gd.items[`FISH_${s.id}`]));
      check('game-data.json: fishing quests, achievements with conditions, quiz rewards, titles', !!gd.quests.Q_FISH_FIRST && gd.achievements.ACH_FISH_FIRST?.condition?.stat === 'fishCaught' && !!gd.quizzes.QZ_FISH_WATER_1 && gd.titles.includes('물고기 박사'));
      const script = path.join(tmp, 'judge.php');
      fs.writeFileSync(script, `<?php
putenv('TFM_DATA_DIR=${tmp.replace(/\\/g, '/')}/data');
require '${srv.replace(/\\/g, '/')}/lib/bootstrap.php';
function cl($o) { return json_decode((string) json_encode($o), false); }
$u = ['id' => 7, 'nickname' => 'tester', 'email' => 't@example.com', 'role' => 'user'];
$t0 = Tfm\\Clock::ms() - 3600000;
$CREATED = $t0 - 7200000;
function save($u, $t, $stats, $inv, $fishing) {
  $s = [
    'version' => 1, 'createdAt' => $GLOBALS['CREATED'], 'savedAt' => $t,
    'profile' => ['id' => (string) $u['id'], 'nickname' => $u['nickname'], 'email' => $u['email'], 'role' => $u['role'], 'avatar' => null, 'title' => '', 'titles' => []],
    'stats' => $stats + ['level' => 3, 'exp' => 0, 'coin' => 500, 'edu' => 0, 'logins' => 1, 'playTime' => 0, 'distance' => 0, 'harvests' => 0, 'crafts' => 0, 'fermentsClaimed' => 0, 'rtHarvests' => 0],
    'player' => ['x' => 0, 'y' => 0, 'z' => 9, 'zoneId' => 'ZONE_MAIN'],
    'inventory' => $inv ? $inv : new stdClass(), 'quests' => new stdClass(), 'farm' => ['plots' => new stdClass()], 'jars' => new stdClass(),
    'education' => ['viewed' => new stdClass(), 'completed' => new stdClass(), 'quiz' => new stdClass()],
    'journal' => [], 'photos' => [], 'achievements' => new stdClass(), 'collection' => new stdClass(), 'visited' => ['ZONE_MAIN' => $t],
    'flags' => new stdClass(), 'activity' => [], 'rtfarm' => ['beds' => new stdClass(), 'last' => [], 'reports' => []], 'storage' => ['items' => new stdClass(), 'cap' => 300],
  ];
  if ($fishing !== null) $s['fishing'] = $fishing;
  return json_decode((string) json_encode($s), false);
}
function codes($r) { return array_values(array_unique(array_map(function ($v) { return $v['code']; }, $r['violations']))); }
function judge($n, $p, $u, $t0, $t1) {
  try { $r = Tfm\\SaveValidator::validate(cl($n), cl($p), ['v' => 1, 'tier' => 1], $u, $t0, $t1, 1, null); return ['ok' => $r['ok'], 'codes' => codes($r), 'explained' => $r['summary']['explained'], 'unexplained' => $r['summary']['unexplained']]; }
  catch (Tfm\\ApiException $e) { return ['ok' => false, 'codes' => ['HTTP_' . $e->getCode()], 'explained' => null, 'unexplained' => null]; }
  catch (Throwable $e) { return ['ok' => false, 'codes' => ['THROW ' . get_class($e) . ' ' . $e->getMessage()], 'explained' => null, 'unexplained' => null]; }
}
$out = [];
$empty = ['v' => 1, 'book' => new stdClass(), 'seen' => new stdClass(), 'day' => ['key' => 0, 'kept' => 0], 'traps' => new stdClass(), 'tut' => 0];
$p = save($u, $t0, ['fishCaught' => 0, 'fishSpecies' => 0, 'fishReleased' => 0, 'fishKept' => 0, 'fishGuarded' => 0], [], $empty);
// ten minutes of honest fishing: six fish of three kinds, four taken along, a 열목어 sent back twice
$t1 = $t0 + 600000;
$book = ['BEODEULCHI' => ['n' => 3, 'kept' => 3, 'rel' => 0, 'max' => 112, 'first' => $t0 + 60000], 'SWIRI' => ['n' => 1, 'kept' => 1, 'rel' => 0, 'max' => 118, 'first' => $t0 + 200000], 'YEOLMOGEO' => ['n' => 2, 'kept' => 0, 'rel' => 2, 'max' => 320, 'first' => $t0 + 400000]];
$fish = ['v' => 1, 'book' => $book, 'seen' => ['GAJAE' => 1], 'day' => ['key' => 20261123, 'kept' => 4], 'traps' => ['FS_V_POOL' => ['at' => $t1 - 1000, 'bait' => 'doenjang']], 'tut' => 1];
$st = ['fishCaught' => 6, 'fishSpecies' => 3, 'fishReleased' => 2, 'fishKept' => 4, 'fishGuarded' => 1, 'exp' => 190, 'edu' => 6];
$inv = ['FISH_BEODEULCHI' => 3, 'FISH_SWIRI' => 1];
$n = save($u, $t1, $st, $inv, $fish);
$out['honest'] = judge($n, $p, $u, $t0, $t1);
// a save without the block (an older client) is fine
$out['older'] = judge(save($u, $t1, [], [], null), save($u, $t0, [], [], null), $u, $t0, $t1);
// a protected fish in the bag
$out['bag'] = judge(save($u, $t1, $st, $inv + ['FISH_YEOLMOGEO' => 1], $fish), $p, $u, $t0, $t1);
// … or in the 곳간
$g = save($u, $t1, $st, $inv, $fish); $g->storage->items = (object) ['FISH_EOREUMCHI' => 2];
$out['storage'] = judge($g, $p, $u, $t0, $t1);
// a protected fish marked as taken along in the book
$b2 = $book; $b2['YEOLMOGEO'] = ['n' => 2, 'kept' => 1, 'rel' => 1, 'max' => 320, 'first' => 1];
$out['keptProtected'] = judge(save($u, $t1, $st, $inv, ['book' => $b2] + $fish), $p, $u, $t0, $t1);
// an unknown species, a length above the largest known, a counter ahead of the book
$out['unknown'] = judge(save($u, $t1, $st, $inv, ['book' => $book + ['SHARK' => ['n' => 1, 'kept' => 0, 'rel' => 1, 'max' => 10, 'first' => 1]]] + $fish), $p, $u, $t0, $t1);
$b3 = $book; $b3['BEODEULCHI']['max'] = 900;
$out['tooLong'] = judge(save($u, $t1, $st, $inv, ['book' => $b3] + $fish), $p, $u, $t0, $t1);
$out['counter'] = judge(save($u, $t1, ['fishSpecies' => 9] + $st, $inv, $fish), $p, $u, $t0, $t1);
$out['guardCounter'] = judge(save($u, $t1, ['fishGuarded' => 4] + $st, $inv, $fish), $p, $u, $t0, $t1);
// 200 catches in five seconds
$t2 = $t0 + 5000;
$b4 = ['BEODEULCHI' => ['n' => 200, 'kept' => 0, 'rel' => 200, 'max' => 112, 'first' => $t0 + 1000]];
$out['tooFast'] = judge(save($u, $t2, ['fishCaught' => 200, 'fishSpecies' => 1, 'fishReleased' => 200], [], ['book' => $b4] + $empty), $p, $u, $t0, $t2);
// more fish in the bag than a day's limit allows at its largest setting
$out['hoard'] = judge(save($u, $t1, $st, ['FISH_BEODEULCHI' => 90], $fish), $p, $u, $t0, $t1);
// a day's count above the largest limit
$out['dayKept'] = judge(save($u, $t1, $st, $inv, ['day' => ['key' => 20261123, 'kept' => 77]] + $fish), $p, $u, $t0, $t1);
// wrong containers are malformed
$out['malformed'] = judge(save($u, $t1, $st, $inv, 'x'), $p, $u, $t0, $t1);
$out['malformedBook'] = judge(save($u, $t1, $st, $inv, ['book' => 5] + $fish), $p, $u, $t0, $t1);
echo json_encode($out, JSON_UNESCAPED_UNICODE);
`);
      const pr = spawnSync('php', [script], { encoding: 'utf8', env: { ...process.env, TFM_DATA_DIR: path.join(tmp, 'data') } });
      let o = null;
      try { o = JSON.parse(pr.stdout.slice(pr.stdout.indexOf('{'))); } catch (e) { o = null; }
      if (!o) check('PHP SaveValidator runs', false, (pr.stderr || pr.stdout).slice(0, 400));
      else {
        const has = (k, code) => !o[k].ok && o[k].codes.includes(code);
        check('PHP: ten honest minutes (six fish, three kinds, a 열목어 sent back) are accepted', o.honest.ok, JSON.stringify(o.honest.codes));
        check('PHP: the exp of the catches is explained, not waved through', o.honest.ok && o.honest.explained.exp >= 190 && o.honest.unexplained.exp === 0 && o.honest.unexplained.edu === 0, JSON.stringify([o.honest.explained, o.honest.unexplained]));
        check('PHP: a save without the fishing block (an older client) is accepted', o.older.ok, JSON.stringify(o.older.codes));
        check('PHP: a protected fish in the bag is refused', has('bag', 'FISH_PROTECTED'), JSON.stringify(o.bag.codes));
        check('PHP: a protected fish in the 곳간 is refused', has('storage', 'FISH_PROTECTED'), JSON.stringify(o.storage.codes));
        check('PHP: a protected fish marked "taken along" in the book is refused', has('keptProtected', 'FISH_PROTECTED'), JSON.stringify(o.keptProtected.codes));
        check('PHP: an unknown species in the book is refused', has('unknown', 'FISH_BAD_SHAPE'), JSON.stringify(o.unknown.codes));
        check('PHP: a length above the species\' largest is refused', has('tooLong', 'FISH_BAD_SHAPE'), JSON.stringify(o.tooLong.codes));
        check('PHP: counters cannot run ahead of the book (species, guarded)', has('counter', 'FISH_BAD_SHAPE') && has('guardCounter', 'FISH_BAD_SHAPE'), JSON.stringify([o.counter.codes, o.guardCounter.codes]));
        check('PHP: 200 catches in five seconds are refused', has('tooFast', 'FISH_COUNT'), JSON.stringify(o.tooFast.codes));
        check('PHP: more fish in the bag than the largest daily limit allows is refused', has('hoard', 'FISH_KEEP_LIMIT') && has('dayKept', 'FISH_KEEP_LIMIT'), JSON.stringify([o.hoard.codes, o.dayKept.codes]));
        check('PHP: a wrong container is malformed (400)', o.malformed.codes.includes('HTTP_400') && o.malformedBook.codes.includes('HTTP_400'), JSON.stringify([o.malformed.codes, o.malformedBook.codes]));
      }
    }
  }
}

// ------------------------------------------------------------------ summary
const failed = results.filter((r) => !r.ok);
if (JSON_OUT) console.log(JSON.stringify({ ok: !failed.length, pass: results.length - failed.length, fail: failed.length, skipped: results.filter((r) => r.skip).length, results }, null, 2));
else console.log(`\n${failed.length ? '✘' : '✔'} ${results.length - failed.length}/${results.length} checks passed${failed.length ? ` — ${failed.length} failed` : ''}`);
process.exit(failed.length ? 1 : 0);
