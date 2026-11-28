#!/usr/bin/env node
// [opt] tests/opt-minify.mjs — the minified fragments mean what the source means (tools/minify.mjs, CONTRACT §19.4)
//
//   node tests/opt-minify.mjs [--root <checkout>]
//
// Browser-free proof for the build's minification:
//   M1  every fragment minifies (none falls back to its source text) and parses again in the build's wrapper
//   M2  the data fragments (the ones tools/build.mjs evaluates in Node for server/data/game-data.json) give the same
//       G.data, key for key and value for value, minified and as source (functions compared by name of the key only)
//   M3  every Korean text survives: each Hangul word of a fragment (comments removed) is still in the minified text —
//       strings, data-say lines and labels are never shortened (two equal strings may become one: `a ? b || '할 일' : '할 일'`)
//   M4  the free names a fragment uses are not renamed (G, THREE, ADDONS, window, document, __fragErr …): the minified
//       text still refers to G where the source does, and no local is renamed to G / THREE / ADDONS
//   M5  property names survive: every `G.<name>` and `G.sys.<name>` of the source is in the minified text
//   M6  without --no-mangle the page is smaller than whitespace-only minification, which is smaller than the source
// Exit 0 = all pass, 1 = a check failed, 2 = could not run.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';
import { minifyFragment, wrapFragment } from '../tools/minify.mjs';

const args = process.argv.slice(2);
const ROOT = path.resolve(args.includes('--root') ? args[args.indexOf('--root') + 1] : path.join(path.dirname(fileURLToPath(import.meta.url)), '..'));
const dir = path.join(ROOT, 'src/game');
let failed = 0, passed = 0;
const check = (name, ok, detail = '') => { if (ok) passed++; else failed++; console.log(`${ok ? '✔' : '✖'} ${name}${detail ? ' — ' + detail : ''}`); };

let files;
try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.js')).sort((a, b) => a.localeCompare(b, 'en')); } catch (e) { console.error(e.message); process.exit(2); }
const frags = files.map((name) => ({ name, code: fs.readFileSync(path.join(dir, name), 'utf8') }));

// M1
const notMin = [];
for (const f of frags) {
  const r = minifyFragment(f.name, f.code);
  if (!r.minified) notMin.push(`${f.name}: ${r.reason}`);
  f.min = r.code;
  f.ws = minifyFragment(f.name, f.code, { mangle: false }).code;
}
check('M1 every fragment minifies and parses again', notMin.length === 0, notMin.join('; ') || `${frags.length} fragments`);

// M2 — the build's data export, once with the source and once with the minified text
const dataSel = (n) => /^0[12]-/.test(n) || /education-data/.test(n) || /^34-fish-data/.test(n) || /myroom-data/.test(n) || /^68-settings/.test(n) || /cooking-data/.test(n) || /^24-wardrobe/.test(n) || /^38-healing-data/.test(n);
function evalData(useMin) {
  const G = { data: {} };
  const errors = [];
  const ctx = vm.createContext({ G, window: {}, console: { log() {}, warn() {}, error() {}, info() {} }, Math, JSON, Object, Array, Number, String, Date, __fragErr: (n, e) => errors.push(`${n}: ${e && e.message}`) });
  // the same order as exportGameData: 0x data, the fish table before the education data, then the later data fragments
  const order = frags.filter((f) => /^0[12]-/.test(f.name) || /education-data/.test(f.name));
  for (const f of frags.filter((x) => /^34-fish-data/.test(x.name))) { const at = order.findIndex((x) => x.name > f.name); order.splice(at < 0 ? order.length : at, 0, f); }
  for (const re of [/myroom-data/, /^68-settings/, /cooking-data/, /^24-wardrobe/, /^38-healing-data/]) for (const f of frags.filter((x) => re.test(x.name))) order.push(f);
  for (const f of order) {
    const text = useMin ? f.min : wrapFragment(f.name, f.code);
    try { vm.runInContext(`(function(){'use strict';\n${text}\n})()`, ctx, { timeout: 4000 }); } catch (e) { errors.push(`${f.name}: ${e.message}`); }
    if (/^24-wardrobe/.test(f.name)) { try { G.data.wardrobe?.applyGifts?.(G.data); } catch (e) { errors.push(`applyGifts: ${e.message}`); } }
  }
  const seen = new WeakSet();
  const json = JSON.stringify(G.data, (k, v) => {
    if (typeof v === 'function') return '[fn]';
    if (v && typeof v === 'object') { if (seen.has(v)) return '[ref]'; seen.add(v); }
    return v;
  });
  // the server table functions are part of what the build exports: compare their results too
  const tables = {};
  for (const [k, v] of Object.entries(G.data)) if (v && typeof v.serverTable === 'function') { try { tables[k] = JSON.stringify(v.serverTable()); } catch (e) { tables[k] = 'throws ' + e.message; } }
  return { json, tables, errors, n: order.length };
}
const a = evalData(false), b = evalData(true);
check('M2 data fragments evaluate without errors (source)', a.errors.length === 0, a.errors.join('; ') || `${a.n} fragments`);
check('M2 data fragments evaluate without errors (minified)', b.errors.length === 0, b.errors.join('; '));
let firstDiff = -1;
if (a.json !== b.json) { for (let i = 0; i < Math.max(a.json.length, b.json.length); i++) if (a.json[i] !== b.json[i]) { firstDiff = i; break; } }
check('M2 G.data is the same minified and as source', a.json === b.json, a.json === b.json ? `${(a.json.length / 1024).toFixed(0)} KB of data` : `first difference at ${firstDiff}: …${a.json.slice(firstDiff - 60, firstDiff + 60)}… vs …${b.json.slice(firstDiff - 60, firstDiff + 60)}…`);
const tdiff = Object.keys(a.tables).filter((k) => a.tables[k] !== b.tables[k]);
check('M2 server tables are the same minified and as source', tdiff.length === 0 && Object.keys(a.tables).length > 0, tdiff.join(', ') || Object.keys(a.tables).join(', '));

// M3 — Hangul multiset of the comment-free source (esbuild whitespace-only, no syntax rewrites) vs the minified text
const words = (s) => new Set(s.match(/[\u3131-\u318e\uac00-\ud7a3]+/g) || []);
const lost = [];
for (const f of frags) {
  try { f.plain = esbuild.transformSync(`"use strict";\n${wrapFragment(f.name, f.code)}`, { loader: 'js', charset: 'utf8', minifyWhitespace: true, legalComments: 'none', logLevel: 'silent' }).code; } catch (e) { lost.push(`${f.name}: ${e.message}`); continue; }
  const have = words(f.min);
  const miss = [...words(f.plain)].filter((w) => !have.has(w));
  if (miss.length) lost.push(`${f.name}: ${miss.slice(0, 4).join(' · ')}`);
}
check('M3 every Korean text survives minification', lost.length === 0, lost.slice(0, 5).join('; ') || 'all fragments');

// M4 — free names stay, nothing local is renamed to them
const bad4 = [];
for (const f of frags) {
  const uses = (s, id) => new RegExp(`(^|[^\\w$.])${id}(?![\\w$])`).test(s);
  for (const id of ['G', 'THREE', 'ADDONS']) {
    if (uses(f.plain || f.code, id) && !uses(f.min, id)) bad4.push(`${f.name} lost ${id}`);
    if (new RegExp(`(?:const|let|var|function|class)\\s+${id}(?![\\w$])|[,(]${id}=>`).test(f.min) && !new RegExp(`(?:const|let|var|function|class)\\s+${id}(?![\\w$])`).test(f.code)) bad4.push(`${f.name} declares ${id}`);
  }
}
check('M4 free names are kept and never shadowed', bad4.length === 0, bad4.slice(0, 5).join('; ') || 'G · THREE · ADDONS');

// M5 — G.<name> / G.sys.<name> property names survive
const bad5 = [];
for (const f of frags) {
  const names = new Set([...(f.plain || f.code).matchAll(/\bG\.(?:sys\.)?([A-Za-z_$][\w$]*)/g)].map((m) => m[1]));
  for (const n of names) if (!new RegExp(`\\.${n.replace(/\$/g, '\\$')}(?![\\w$])`).test(f.min) && !new RegExp(`["']${n}["']`).test(f.min)) bad5.push(`${f.name}: .${n}`);
}
check('M5 G.* and G.sys.* property names survive', bad5.length === 0, bad5.slice(0, 8).join('; ') || 'all property names found');

// M6 — sizes
const raw = frags.reduce((n, f) => n + Buffer.byteLength(wrapFragment(f.name, f.code)), 0);
const ws = frags.reduce((n, f) => n + Buffer.byteLength(f.ws), 0);
const mn = frags.reduce((n, f) => n + Buffer.byteLength(f.min), 0);
check('M6 minified < whitespace-only < source', mn < ws && ws < raw, `source ${(raw / 1e6).toFixed(3)} MB · whitespace + syntax ${(ws / 1e6).toFixed(3)} MB · + local names ${(mn / 1e6).toFixed(3)} MB (${(100 - mn / raw * 100).toFixed(1)} % smaller)`);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
