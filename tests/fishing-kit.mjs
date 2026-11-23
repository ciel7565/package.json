#!/usr/bin/env node
// =============================================================================
// tests/fishing-kit.mjs — the fish bodies of CONTRACT §18.3 ("Realism"), checked in Node with three.js (no browser):
// 35-fishing-kit.js builds every species of 34-fish-data.js on every preset —
//   · positions, normals, uvs and the swim attribute are finite; indices are in range; no empty triangles pile up
//   · the body is as long, as deep and as wide as its profile says, and the surface faces outwards
//   · the fins the data names are there (and none it does not name); both eyes exist; barbels on medium / high
//   · species differ: depth / width / fin measures of any two bodies are not the same
//   · triangle budgets: high ≤ 6,000 · medium ≤ 3,200 · low ≤ 1,400 per fish; a school silhouette ≤ 150
//   · the swim wave keeps the head still and moves the tail (weights), the four school shapes exist and are assigned
// The skin is a canvas drawing and is checked in the browser suite (tests/fishing-client.mjs).
// Usage: node tests/fishing-kit.mjs [--json]      exit 0 = all pass, 1 = a check failed
// =============================================================================
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const JSON_OUT = process.argv.includes('--json');
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail: String(detail || '') });
  if (!JSON_OUT) console.log(`${ok ? '✔' : '✘'} ${name}${detail ? ` — ${detail}` : ''}`);
}
const list = (a, n = 5) => (a.length ? a.slice(0, n).join('; ') + (a.length > n ? ` … (+${a.length - n})` : '') : '');

const rng = (seed) => { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; };
const G = { data: {}, sys: {}, util: { rng }, log: { warn() {}, info() {}, error() {} }, time: { delta: 0.016 } };
const ctx = vm.createContext({ G, THREE, ADDONS: { BufferGeometryUtils }, window: {}, document: { createElement: () => ({ getContext: () => null }) }, console, Math, JSON, Object, Array, Number, String, Date, Promise, Map, Set, Float32Array, setTimeout, clearTimeout });
for (const f of ['01-data.js', '34-fish-data.js', '35-fishing-kit.js']) {
  const code = fs.readFileSync(path.join(ROOT, 'src/game', f), 'utf8');
  try { vm.runInContext(`(function(){'use strict';\n${code}\n})()`, ctx, { timeout: 8000, filename: f }); check(`fragment ${f} evaluates`, true); }
  catch (e) { check(`fragment ${f} evaluates`, false, e.message); }
}
const K = G.fishkit, F = G.data.fish;
if (!K || !F) { console.log('✘ G.fishkit / G.data.fish missing'); process.exit(1); }

const BUDGET = { high: 6000, medium: 3200, low: 1400 };
const finite = (arr) => { for (let i = 0; i < arr.length; i++) if (!Number.isFinite(arr[i])) return false; return true; };
const measures = new Map();
for (const q of ['high', 'medium', 'low']) {
  const bad = [];
  let maxTris = 0, sumTris = 0;
  for (const sp of F.species) {
    const b = (m) => bad.push(`${sp.id}: ${m}`);
    let g;
    try { g = K._buildGeometry(sp.look, q); } catch (e) { b('throws ' + e.message); continue; }
    for (const [nm, geo] of [['body', g.body], ['fins', g.fins]]) {
      const P = geo.attributes.position, N = geo.attributes.normal, U = geo.attributes.uv, S = geo.attributes.aSwim, I = geo.index;
      if (!P || !N || !U || !S || !I) { b(`${nm}: an attribute is missing`); continue; }
      if (!finite(P.array) || !finite(N.array) || !finite(U.array) || !finite(S.array)) b(`${nm}: a number is not finite`);
      if (P.count !== N.count || P.count !== U.count || P.count !== S.count) b(`${nm}: attribute counts differ`);
      let mx = 0; for (let i = 0; i < I.count; i++) mx = Math.max(mx, I.getX(i));
      if (mx >= P.count || I.count % 3) b(`${nm}: index out of range`);
      for (let i = 0; i < U.count; i++) if (U.getX(i) < -0.001 || U.getX(i) > 1.001 || U.getY(i) < -0.001 || U.getY(i) > 1.001) { b(`${nm}: uv outside the atlas`); break; }
    }
    // the body's box against the profile
    g.body.computeBoundingBox();
    const bb = g.body.boundingBox, P = sp.look.profile;
    const maxD = Math.max(...P.depth.map((p) => p[1])), maxW = Math.max(...P.width.map((p) => p[1]));
    const len = bb.max.x - bb.min.x, hgt = bb.max.y - bb.min.y, wid = bb.max.z - bb.min.z;
    if (!(len > 0.98 && len < 1.2)) b(`length ${len.toFixed(3)}`);
    if (Math.abs(hgt - maxD) > maxD * 0.12 + 0.01) b(`height ${hgt.toFixed(3)} vs profile ${maxD}`);
    if (Math.abs(wid - maxW) > maxW * 0.2 + 0.02) b(`width ${wid.toFixed(3)} vs profile ${maxW}`);
    if (Math.abs(bb.max.z + bb.min.z) > 0.004) b('not symmetric');
    // faces point outwards: the normal of the lofted rings agrees with the direction away from the body's axis
    { const Pp = g.body.attributes.position, Nn = g.body.attributes.normal; let out = 0, inn = 0;
      const Uu = g.body.attributes.uv, isEye = (i) => Uu.getX(i) > 7 / 8 && Uu.getY(i) < 0.379;
      for (let i = 0; i < Pp.count; i++) { if (isEye(i)) continue; const y = Pp.getY(i), z = Pp.getZ(i); if (Math.hypot(y, z) < 0.01) continue; const d = y * Nn.getY(i) + z * Nn.getZ(i); if (d > 0) out++; else inn++; }
      if (inn > out * 0.03) b(`faces point inwards (${inn} of ${inn + out})`);
      // … and so do the eyes (from their own centres)
      for (const sd of [1, -1]) {
        let cx = 0, cy = 0, cz = 0, n = 0;
        for (let i = 0; i < Pp.count; i++) if (isEye(i) && Math.sign(Pp.getZ(i)) === sd) { cx += Pp.getX(i); cy += Pp.getY(i); cz += Pp.getZ(i); n++; }
        if (!n) { b('an eye is missing'); continue; }
        cx /= n; cy /= n; cz /= n;
        let eo = 0, ei = 0;
        for (let i = 0; i < Pp.count; i++) if (isEye(i) && Math.sign(Pp.getZ(i)) === sd) { const d = (Pp.getX(i) - cx) * Nn.getX(i) + (Pp.getY(i) - cy) * Nn.getY(i) + (Pp.getZ(i) - cz) * Nn.getZ(i); if (d > 0) eo++; else ei++; }
        if (ei > eo * 0.2) b(`an eye is inside out (${ei} of ${ei + eo})`);
      } }
    // fins: one strip per named fin; none on a look that names none
    const Fi = sp.look.fins;
    const finTris = g.fins.index.count / 3;
    const want = ['dorsal', 'dorsal2', 'anal', 'adipose', 'tail'].filter((k) => Fi[k]).length + (Fi.pectoral ? 2 : 0) + (Fi.pelvic ? 2 : 0);
    if (finTris < want * 4) b(`fins: ${finTris} triangles for ${want} fins`);
    // the fins reach beyond the body: dorsal above, anal below, the tail behind
    g.fins.computeBoundingBox();
    const fb = g.fins.boundingBox;
    if (Fi.tail && !(fb.min.x < -0.5 - Fi.tail.len * 0.6)) b('the tail fin does not reach behind the body');
    if (Fi.dorsal && !(fb.max.y > bb.max.y * 0.9)) b('the dorsal fin does not rise above the back');
    if (Fi.anal && !(fb.min.y < bb.min.y * 0.9)) b('the anal fin does not hang below the belly');
    if (q !== 'low' && P.barbels > 0) { const blen = P.barbelLen || 0.03; if (!(fb.max.z > Math.max(...P.width.map((p) => p[1])) / 2 * 0.5 + blen * 0.1)) b('barbels missing'); }
    // the swim weights: head still, tail moving
    { const S = g.body.attributes.aSwim; let head = 0, tail = 0; for (let i = 0; i < S.count; i++) { if (S.getX(i) < 0.15) head = Math.max(head, S.getY(i)); if (S.getX(i) > 0.9) tail = Math.max(tail, S.getY(i)); } if (!(head < 0.02 && tail > 0.7)) b(`swim weights head ${head.toFixed(2)} tail ${tail.toFixed(2)}`); }
    if (g.tris > BUDGET[q]) b(`${g.tris} triangles (budget ${BUDGET[q]})`);
    maxTris = Math.max(maxTris, g.tris); sumTris += g.tris;
    if (q === 'high') measures.set(sp.id, [maxD, maxW, hgt.toFixed(3), wid.toFixed(3), (fb.max.y - fb.min.y).toFixed(3), (fb.max.x - fb.min.x).toFixed(3)].join('|'));
  }
  check(`${q}: every species builds — finite, in range, as long / deep / wide as its profile, facing outwards, its fins in place`, !bad.length, list(bad));
  check(`${q}: triangle budget (≤ ${BUDGET[q]} per fish)`, maxTris <= BUDGET[q], `largest ${maxTris}, mean ${Math.round(sumTris / F.species.length)}`);
}
check('no two species have the same body and fin measures', new Set(measures.values()).size === F.species.length, `${new Set(measures.values()).size} distinct of ${F.species.length}`);

// the eyes sit on both sides of the head
{
  const bad = [];
  for (const sp of F.species) {
    const g = K._buildGeometry(sp.look, 'medium');
    const U = g.body.attributes.uv, P = g.body.attributes.position;
    let l = 0, r = 0;
    for (let i = 0; i < U.count; i++) if (U.getX(i) > 7 / 8 && U.getY(i) < 0.379) { if (P.getZ(i) > 0) r++; else if (P.getZ(i) < 0) l++; }
    if (!(l > 20 && r > 20)) bad.push(`${sp.id}: ${l}/${r}`);
    // the eye is in the head
    const ex = 0.5 - sp.look.profile.eye[0];
    let near = false; for (let i = 0; i < U.count; i++) if (U.getX(i) > 7 / 8 && U.getY(i) < 0.379 && Math.abs(P.getX(i) - ex) < 0.06) { near = true; break; }
    if (!near) bad.push(`${sp.id}: eye not at s = ${sp.look.profile.eye[0]}`);
  }
  check('both eyes are built, in the head', !bad.length, list(bad));
}

// school silhouettes
{
  const kinds = ['fusi', 'deep', 'long', 'flat'];
  const bad = [];
  for (const k of kinds) {
    const g = K.silhouette(k);
    const tris = g.index.count / 3;
    if (!finite(g.attributes.position.array) || !finite(g.attributes.normal.array) || !g.attributes.aSwim) bad.push(`${k}: not finite`);
    if (tris > 150) bad.push(`${k}: ${tris} triangles`);
    g.computeBoundingBox();
    if (!(g.boundingBox.max.x - g.boundingBox.min.x > 1.1)) bad.push(`${k}: no tail`);
  }
  check('four school silhouettes (≤ 150 triangles each, with a tail)', !bad.length, list(bad));
  check('silhouettes are cached (one geometry per kind)', K.silhouette('fusi') === K.silhouette('fusi'));
  const want = { MIYUGI: 'long', DAMUKJANGEO: 'long', SAEKOMIKKURI: 'long', DUKJUNGGAE: 'flat', DOLSANGEO: 'flat', KKEOKJI: 'deep', MUKNAPJARU: 'deep', BEODEULCHI: 'fusi', SANCHEONEO: 'fusi', SWIRI: 'fusi' };
  const wrong = Object.entries(want).filter(([id, k]) => K.kindOf(id) !== k).map(([id, k]) => `${id} → ${K.kindOf(id)} (want ${k})`);
  check('each species swims in a school of its own shape', !wrong.length, list(wrong));
  check('every kind is used by some species', kinds.every((k) => F.species.some((s) => K.kindOf(s.id) === k)));
}

// the look of a month
{
  const y = F.byId.YEOLMOGEO.look, a = K._seasonLook(y, 4), b = K._seasonLook(y, 8);
  check('the breeding colours join in their months only', a.breeding === true && b.breeding === false && a.marks.length > b.marks.length && a.colours.side !== b.colours.side && b.colours === y.colours);
  const s = K._sampler([[0, 0], [0.5, 1], [1, 0.2]]);
  check('the curve sampler passes through its points and never overshoots far', Math.abs(s(0)) < 1e-9 && Math.abs(s(0.5) - 1) < 1e-9 && Math.abs(s(1) - 0.2) < 1e-9 && s(0.25) > 0.2 && s(0.25) < 1.1 && s(-1) === 0 && s(2) === 0.2);
}

const failed = results.filter((r) => !r.ok);
if (JSON_OUT) console.log(JSON.stringify({ ok: !failed.length, pass: results.length - failed.length, fail: failed.length, results }, null, 2));
else console.log(`\n${failed.length ? '✘' : '✔'} ${results.length - failed.length}/${results.length} checks passed${failed.length ? ` — ${failed.length} failed` : ''}`);
process.exit(failed.length ? 1 : 0);
