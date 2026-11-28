#!/usr/bin/env node
// =============================================================================
// tests/avatar-kit.mjs — CONTRACT §19.1 (lane hanbok) in Node, no browser: the hanbok table and the garment kit of
// src/game/20-avatar.js evaluated with three.js from node_modules (the builders are pure buffer maths).
//
//   table     the slots (keys that are things to wear) with their dye row and empty id; the counts the contract asks
//             for (겉옷 ≥ 14, 저고리 ≥ 8, 아래옷 ≥ 8, 쓰개 ≥ 22, 신 ≥ 10, 머리 ≥ 18, 꾸미개 ≥ 24, 옷감과 무늬 ≥ 10, dyes ≥ 24,
//             sets ≥ 24, nine expressions); every id has a Hangul name; no modern garment is left in `options`; no
//             Chinese character and no forbidden word in the table
//   migrate   every legacy id becomes a current id; a phase-10 look in modern clothes is dressed in hanbok; the sets and
//             normalize are idempotent; random visitors wear hanbok only
//   kit       every id of every wearable key builds on six sets in the realistic style (and on two in the round one):
//             finite positions and normals, feet on the floor, inside a 2.4 m box; the triangle budget (1.5 × the worst
//             phase-10 ready-made look); every piece of a slot draws differently from the others of that slot (its own
//             geometry, or for 옷감 its own shader code)
//   cache     the body cache stays bounded (least recently used) while hundreds of looks are built
//
//   node tests/avatar-kit.mjs [--json] [--quick]      exit 0 = all passed, 1 = a check failed, 2 = could not run
// =============================================================================
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { pathToFileURL, fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const jsonOut = args.includes('--json'), quick = args.includes('--quick');
const log = (...a) => { if (!jsonOut) console.log(...a); };
const results = [], numbers = {};
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail: String(detail ?? '').slice(0, 600) }); log(`${ok ? '  ✔' : '  ✖'} ${name}${detail !== '' && detail != null ? ` — ${String(detail).slice(0, 300)}` : ''}`); };
// phase 10 (HEAD b451f20): the worst ready-made look of the realistic style had 26 438 triangles
const BASE_WORST = 26438, BUDGET = Math.round(BASE_WORST * 1.5);

let G, THREE;
try {
  const T = await import(pathToFileURL(path.join(ROOT, 'node_modules/three/build/three.module.js')).href);
  const BGU = await import(pathToFileURL(path.join(ROOT, 'node_modules/three/examples/jsm/utils/BufferGeometryUtils.js')).href);
  const RB = await import(pathToFileURL(path.join(ROOT, 'node_modules/three/examples/jsm/geometries/RoundedBoxGeometry.js')).href);
  THREE = Object.assign({}, T);
  const rng = (seed) => { let s = (seed >>> 0) || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; };
  const warns = [];
  G = { data: {}, util: { rng }, log: { debug() {}, info() {}, warn: (...a) => warns.push(a.join(' ')), error: (...a) => warns.push('E ' + a.join(' ')) }, gfx: { canvasTexture: () => new THREE.Texture() }, sys: {}, _warns: warns };
  const cap = (...a) => warns.push(a.map((x) => (typeof x === 'string' ? x : '')).join(' ').slice(0, 200));
  console.warn = cap; console.error = cap;
  const ctx = { THREE, ADDONS: { BufferGeometryUtils: BGU, RoundedBoxGeometry: RB.RoundedBoxGeometry }, G, performance, console, window: {} };
  vm.createContext(ctx);
  for (const f of ['02-avatar-data.js', '20-avatar.js']) vm.runInContext(fs.readFileSync(path.join(ROOT, 'src/game', f), 'utf8'), ctx, { filename: f });
} catch (e) { console.error('could not load the avatar fragments:', e && e.stack || e); process.exit(2); }

const D = G.data.avatar, A = G.avatar, O = D.options;
log('👘 avatar kit — the hanbok table and the garment kit (Node)');

// ------------------------------------------------------------------ table
{
  const slots = D.slots || [];
  const bad = slots.filter((s) => !O[s.key] || (s.colorKey && !D.colorKeys.includes(s.colorKey)) || (s.empty !== null && !O[s.key].includes(s.empty)) || !/[가-힣]/.test(s.name));
  check('slots: every wearable key with its dye row and its "nothing" id', slots.length >= 12 && bad.length === 0, `${slots.length} slots; bad ${bad.map((s) => s.key)}`);
  const n = (k) => O[k].filter((v) => v !== 'none').length;
  const acc = ['norigae', 'pouch', 'fan', 'hairpin', 'ribbon', 'belt', 'bag'].reduce((t, k) => t + n(k), 0);
  const counts = { outer: n('outer'), top: n('top'), bottom: n('bottom'), hat: n('hat'), footwear: n('footwear'), hair: n('hair'), acc, pattern: n('pattern'), dyes: D.dyes.length, sets: D.presets.length, expr: D.expressions.length };
  numbers.counts = counts;
  check('counts: 겉옷 ≥ 14 · 저고리 ≥ 8 · 아래옷 ≥ 8 · 쓰개 ≥ 22 · 신 ≥ 10 · 머리 ≥ 18 · 꾸미개 ≥ 24 · 무늬 ≥ 10 · dyes ≥ 24 · 갖춤 ≥ 24 · 표정 9',
    counts.outer >= 14 && counts.top >= 8 && counts.bottom >= 8 && counts.hat >= 22 && counts.footwear >= 10 && counts.hair >= 18 && counts.acc >= 24 && counts.pattern >= 10 && counts.dyes >= 24 && counts.sets >= 24 && counts.expr === 9, JSON.stringify(counts));
  const unnamed = [];
  for (const s of slots) for (const v of O[s.key]) if (!(A.labels[s.key] && /[가-힣]/.test(A.labels[s.key][v] || ''))) unnamed.push(`${s.key}.${v}`);
  check('every piece of every slot has a Hangul name', unnamed.length === 0, unnamed.slice(0, 8).join(' '));
  const noAbout = [];
  for (const k of ['outer', 'top', 'bottom', 'hat', 'footwear']) for (const v of O[k]) if (v !== 'none' && !(D.about[k] && D.about[k][v])) noAbout.push(`${k}.${v}`);
  check('every garment, hat and shoe has its one-line story (who wore it, when)', noAbout.length === 0, noAbout.join(' '));
  const MODERN = ['tshirt', 'hoodie', 'shirt', 'jacket', 'shorts', 'sneakers', 'cap', 'backpack', 'glasses', 'headband', 'apron'];
  const left = []; for (const [k, l] of Object.entries(O)) for (const v of l) if (MODERN.includes(v)) left.push(`${k}.${v}`);
  check('hanbok only: no modern garment is left in options (they are in legacy)', left.length === 0 && MODERN.every((m) => Object.values(D.legacy).some((l) => l.includes(m))), left.join(' '));
  const txt = JSON.stringify(D);
  check('the table has no Chinese character and no forbidden word', !/[㐀-鿿豈-﫿]/.test(txt) && !txt.includes('게임'));
  const ex = D.expressions.map((e) => e.name).join(',');
  check('the nine expressions: 무표정 · 미소 · 활짝 웃음 · 놀람 · 궁금 · 뿌듯 · 수줍음 · 졸림 · 집중', ex === '무표정,미소,활짝 웃음,놀람,궁금,뿌듯,수줍음,졸림,집중' && D.expressions.every((e) => O.expr.includes(e.id)), ex);
  const firstSix = D.presets.slice(0, 6).map((p) => p.id).join();
  check('the first six sets are still the title picks (seollal seonbi farmer gungjung hogeon winter)', firstSix === 'seollal,seonbi,farmer,gungjung,hogeon,winter', firstSix);
}

// ------------------------------------------------------------------ migrate
{
  const n = A.normalize, bad = [];
  for (const [k, ids] of Object.entries(D.legacy)) for (const v of ids) {
    const o = n({ style: 'real', [k]: v });
    for (const [kk, vv] of Object.entries(o)) if (!D.colorKeys.includes(kk) && kk !== 'height' && !(O[kk] || []).includes(vv)) bad.push(`${k}.${v} → ${kk}=${vv}`);
  }
  check('every legacy id becomes current ids', bad.length === 0, bad.slice(0, 5).join(' | '));
  const modern = n({ style: 'real', top: 'hoodie', bottom: 'shorts', footwear: 'sneakers', hat: 'cap', bag: 'backpack', accessory: 'glasses', topColor: '#8b6fd6' });
  numbers.modernSave = modern;
  check('a phase-10 look in modern clothes is dressed in hanbok (누비저고리 · 잠방이 · 고무신 · 패랭이 · 괴나리봇짐)', modern.top === 'nubi' && modern.bottom === 'jambang' && modern.footwear === 'gomusin' && modern.hat === 'paeraengi' && modern.bag === 'gwaenari' && modern.topColor === '#8b6fd6' && !('accessory' in modern), JSON.stringify(modern));
  const p9 = n({ style: 'real', top: 'durumagi', topColor: '#f1ece1', outerColor: '#e8d9b5', accessory: 'norigae', accessoryColor: '#8a3b4b' });
  check('a phase-9 두루마기 becomes 민저고리 + 겉옷 두루마기; its 노리개 moves to its own slot with its colour', p9.top === 'hanbok' && p9.outer === 'durumagi' && p9.outerColor === '#e8d9b5' && p9.norigae === 'samjak' && p9.norigaeColor === '#8a3b4b', JSON.stringify([p9.top, p9.outer, p9.norigae, p9.norigaeColor]));
  const idem = D.presets.filter((p) => { const a = n(p.app); return JSON.stringify(n(a)) !== JSON.stringify(a); });
  const dropped = []; for (const p of D.presets) { const o = n(p.app); for (const [k, v] of Object.entries(p.app)) { const w = typeof v === 'string' && v[0] === '#' ? v.toLowerCase() : v; if (o[k] !== w) dropped.push(`${p.id}.${k}`); } }
  check('every set normalizes to itself (no value of a set is dropped)', idem.length === 0 && dropped.length === 0, idem.map((p) => p.id).concat(dropped).join(' '));
  const modernRand = []; for (let i = 0; i < 500; i++) { const a = A.random(i); if (D.legacy.top.includes(a.top) || a.footwear === 'sneakers' || a.bottom === 'shorts' || a.hat === 'cap') modernRand.push(i); }
  check('500 random visitors wear hanbok only', modernRand.length === 0, modernRand.slice(0, 5).join(' '));
}

// ------------------------------------------------------------------ kit
{
  const WEAR = D.slots.map((s) => s.key).concat(['beard']);
  const bases = (quick ? ['seonbi', 'gungjung'] : ['seonbi', 'gungjung', 'farmer', 'bride', 'dol', 'mugwan']).map((id) => A.presets.find((p) => p.id === id).appearance);
  const errors = [], nonFinite = [], outBox = [], overBudget = [];
  let maxReal = 0, maxCute = 0, combos = 0;
  const geoOf = (app) => { A.cache.clear(); return A._geometry(app); };
  for (const base of bases) for (const k of WEAR) for (const v of O[k]) {
    const app = { ...base, [k]: v };
    let g;
    try { g = A._geometry(A.normalize(app)); combos++; } catch (e) { errors.push(`${k}=${v}: ${e.message}`); continue; }
    const pa = g.attributes.position.array, na = g.attributes.normal.array;
    let bad = false, minY = 9, maxY = -9, maxR = 0;
    for (let i = 0; i < pa.length; i += 3) { const x = pa[i], y = pa[i + 1], z = pa[i + 2]; if (!Number.isFinite(x + y + z)) { bad = true; break; } if (y < minY) minY = y; if (y > maxY) maxY = y; const r = Math.hypot(x, z); if (r > maxR) maxR = r; }
    for (let i = 0; i < na.length && !bad; i++) if (!Number.isFinite(na[i])) bad = true;
    if (bad) nonFinite.push(`${base.top}/${k}=${v}`);
    if (!bad && (minY < -0.02 || maxY > 2.4 || maxR > 1.2)) outBox.push(`${k}=${v} y ${minY.toFixed(2)}…${maxY.toFixed(2)} r ${maxR.toFixed(2)}`);
    const t = A.triangles(app);
    maxReal = Math.max(maxReal, t);
    if (t > BUDGET) overBudget.push(`${k}=${v}: ${t}`);
  }
  for (const base of bases.slice(0, 2)) for (const k of WEAR) for (const v of O[k]) {
    try { const t = A.triangles({ ...base, [k]: v, style: 'cute' }); maxCute = Math.max(maxCute, t); combos++; } catch (e) { errors.push(`cute ${k}=${v}: ${e.message}`); }
  }
  numbers.kit = { combos, maxReal, maxCute, budget: BUDGET };
  check(`every id of every wearable key builds on ${bases.length} sets (realistic) and on 2 (round)`, errors.length === 0 && combos > 300, `${combos} bodies; ${errors.slice(0, 3).join(' | ')}`);
  check('geometry is finite (positions and normals) for every piece', nonFinite.length === 0, nonFinite.slice(0, 6).join(' '));
  check('every body stands on the floor inside a 2.4 m box', outBox.length === 0, outBox.slice(0, 4).join(' | '));
  check(`triangle budget: every realistic body ≤ ${BUDGET} (1.5 × ${BASE_WORST}, the worst phase-10 look); round ≤ 15000`, overBudget.length === 0 && maxCute <= 15000, `worst real ${maxReal}, worst round ${maxCute}; ${overBudget.slice(0, 4).join(' ')}`);
  // every piece of a slot looks different from the others of the slot (on the same set)
  const sig = (g, a) => { const p = g.attributes.position.array, sl = g.attributes.aSlot.array; let h = p.length; for (let i = 0; i < p.length; i++) h = (h * 31 + Math.round(p[i] * 1e4)) | 0; for (let i = 0; i < sl.length; i++) h = (h * 17 + sl[i]) | 0; return h + ':' + JSON.stringify(A._palette(a).fx); };
  const same = [];
  const base = A.presets.find((p) => p.id === 'seonbi').appearance;
  for (const k of WEAR) {
    if (k === 'pattern') continue;
    const seen = new Map();
    for (const v of O[k]) {
      const a = A.normalize({ ...base, [k]: v, outer: k === 'outer' ? v : 'none', hair: k === 'hair' ? v : 'jjok', hat: k === 'hat' ? v : 'none', bottom: k === 'bottom' ? v : 'skirt' });
      const h = sig(A._geometry(a), a);
      if (seen.has(h)) same.push(`${k}: ${seen.get(h)} = ${v}`); else seen.set(h, v);
    }
  }
  check('every piece of a slot draws differently (its own shape, parts or surface code)', same.length === 0, same.join(' | '));
  const fxSeen = new Map(), fxSame = [];
  for (const v of O.pattern) { const f = JSON.stringify(A._palette({ ...base, pattern: v }).fx); if (fxSeen.has(f)) fxSame.push(`${fxSeen.get(f)} = ${v}`); else fxSeen.set(f, v); }
  check('every 옷감과 무늬 has its own surface code', fxSame.length === 0, fxSame.join(' '));
  // the sets: triangles per set (before / after numbers for the report)
  const per = {}; for (const p of A.presets) per[p.id] = A.triangles(p.appearance);
  numbers.trianglesPerSet = per;
  check('every set within the budget', Object.values(per).every((t) => t <= BUDGET), JSON.stringify(per).slice(0, 300));
}

// ------------------------------------------------------------------ cache
{
  A.cache.clear();
  for (let i = 0; i < 160; i++) A.triangles(A.random(1000 + i));
  check(`the body cache is bounded (≤ ${A.cache.max}) after 160 different looks`, A.cache.size <= A.cache.max && A.cache.max <= 96, `${A.cache.size} cached, bound ${A.cache.max}`);
}

const warns = G._warns.filter((w) => /NaN|AVATAR/i.test(w));
check('no warning while building (NaN bounding spheres, builder warnings)', warns.length === 0, warns.slice(0, 3).join(' | '));
const failed = results.filter((r) => !r.ok).length;
if (jsonOut) console.log(JSON.stringify({ suite: 'avatar-kit', passed: results.length - failed, failed, results, numbers }, null, 1));
else { log(`\navatar-kit: ${results.length - failed} passed, ${failed} failed`); log(JSON.stringify(numbers.kit), JSON.stringify(numbers.counts)); }
process.exit(failed ? 1 : 0);
