#!/usr/bin/env node
// =============================================================================
// 전통발효체험관 메타버스 — single-file HTML builder
//
//   node tools/build.mjs                      -> dist/metaverse/index.html (+ server files)
//   node tools/build.mjs --out /tmp/a.html    -> custom output path (no server copy)
//   node tools/build.mjs --only 11,12         -> core + only fragments whose name starts with 11 / 12
//   node tools/build.mjs --exclude 70         -> everything except fragments starting with 70
//   node tools/build.mjs --no-font            -> skip embedding the Pretendard webfont (smaller/faster dev build)
//   node tools/build.mjs --strict             -> fail if any fragment has a syntax error (default: skip it + warn)
//
// Each src/game/*.js file is a "fragment": plain script code (no import/export, no top-level
// await). Fragments are concatenated in filename order inside ONE closure and each one is
// wrapped in its own try { ... } block, so its top-level const/let/class names are private and
// a crash in one fragment cannot stop the others. Fragments share state only through `G`.
// =============================================================================
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';
import crypto from 'node:crypto';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name, def = null) => {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : def;
};

const OUT = path.resolve(opt('--out', path.join(ROOT, 'dist/metaverse/index.html')));
const DEFAULT_OUT = OUT === path.join(ROOT, 'dist/metaverse/index.html');
const ONLY = opt('--only') ? opt('--only').split(',').map((s) => s.trim()).filter(Boolean) : null;
const EXCLUDE = opt('--exclude') ? opt('--exclude').split(',').map((s) => s.trim()).filter(Boolean) : [];
const EMBED_FONT = !flag('--no-font');
const STRICT = flag('--strict');
const QUIET = flag('--quiet');
// Core fragments are always included, even with --only.
const CORE_PREFIXES = ['00', '01', '02', '03', '04', '05', '06', '10'];

const log = (...a) => { if (!QUIET) console.log(...a); };

// ---------------------------------------------------------------- vendor bundle (cached)
async function buildVendor() {
  const cacheDir = path.join(ROOT, '.cache');
  fs.mkdirSync(cacheDir, { recursive: true });
  const entry = path.join(ROOT, 'vendor/three-entry.js');
  const threePkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'node_modules/three/package.json'), 'utf8'));
  const key = `${threePkg.version}-${fs.statSync(entry).mtimeMs}`;
  const cacheFile = path.join(cacheDir, `vendor-${key.replace(/[^\w.-]/g, '_')}.js`);
  if (fs.existsSync(cacheFile)) return { code: fs.readFileSync(cacheFile, 'utf8'), version: threePkg.version };
  const res = await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    minify: true,
    format: 'iife',
    target: ['es2020'],
    legalComments: 'inline',
    write: false,
    logLevel: 'silent',
  });
  const code = res.outputFiles[0].text;
  fs.writeFileSync(cacheFile, code);
  return { code, version: threePkg.version };
}

// ---------------------------------------------------------------- fragments
function listSorted(dir, ext) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith(ext)).sort((a, b) => a.localeCompare(b, 'en'));
}

function selected(name) {
  if (CORE_PREFIXES.some((p) => name.startsWith(p))) return true;
  if (EXCLUDE.some((p) => name.startsWith(p))) return false;
  if (ONLY) return ONLY.some((p) => name.startsWith(p));
  return true;
}

function checkSyntax(name, code) {
  try {
    // Wrap like the real build does so `return`/strict-mode rules match runtime.
    esbuild.transformSync(`(function(){'use strict';{\n${code}\n}})`, { loader: 'js', logLevel: 'silent' });
    return null;
  } catch (e) {
    const msg = (e.errors || []).map((er) => `${er.text} (line ${er.location ? er.location.line - 1 : '?'})`).join('; ') || String(e.message || e);
    return msg;
  }
}

const gameDir = path.join(ROOT, 'src/game');
const styleDir = path.join(ROOT, 'src/styles');
const fragments = [];
const skipped = [];
for (const f of listSorted(gameDir, '.js')) {
  if (!selected(f)) { skipped.push({ name: f, reason: 'filtered' }); continue; }
  const code = fs.readFileSync(path.join(gameDir, f), 'utf8');
  const err = checkSyntax(f, code);
  if (err) {
    if (STRICT) { console.error(`✖ syntax error in ${f}: ${err}`); process.exit(1); }
    console.warn(`⚠ skipping ${f} (syntax error): ${err}`);
    skipped.push({ name: f, reason: 'syntax: ' + err });
    continue;
  }
  fragments.push({ name: f, code });
}

const cssFiles = listSorted(styleDir, '.css').filter((f) => {
  if (/^0\d-/.test(f)) return true; // base styles always
  if (EXCLUDE.some((p) => f.startsWith(p))) return false;
  if (ONLY) return ONLY.some((p) => f.startsWith(p));
  return true;
});
const css = cssFiles.map((f) => `/* ==== ${f} ==== */\n` + fs.readFileSync(path.join(styleDir, f), 'utf8')).join('\n');

// ---------------------------------------------------------------- font
function fontFace() {
  if (!EMBED_FONT) return '';
  const dir = path.join(ROOT, 'node_modules/pretendard/dist/web/static/woff2-subset');
  const faces = [
    ['Pretendard-Regular.subset.woff2', 400],
    ['Pretendard-Bold.subset.woff2', 700],
  ];
  const out = [];
  for (const [file, weight] of faces) {
    const p = path.join(dir, file);
    if (!fs.existsSync(p)) continue;
    const b64 = fs.readFileSync(p).toString('base64');
    out.push(`@font-face{font-family:'PretendardEmbed';font-style:normal;font-weight:${weight};font-display:swap;src:url(data:font/woff2;base64,${b64}) format('woff2');}`);
  }
  return out.length ? `<style id="embedded-font">/* Pretendard (SIL Open Font License 1.1) — https://github.com/orioncactus/pretendard */\n${out.join('\n')}</style>` : '';
}

// ---------------------------------------------------------------- game script
function gameScript() {
  const parts = [];
  parts.push(`(function () {
'use strict';
const THREE = window.THREE;
const ADDONS = window.THREE_ADDONS || {};
const G = (window.G = window.G || {});
G.__fragmentErrors = [];
G.__fragments = ${JSON.stringify(fragments.map((f) => f.name))};
function __fragErr(name, e) {
  G.__fragmentErrors.push({ name: name, message: String((e && e.stack) || e) });
  console.error('[FRAGMENT] ' + name + ' failed to load:', e);
}`);
  for (const f of fragments) {
    parts.push(`// =============================================================== ${f.name}
try {
${f.code}
} catch (e) { __fragErr(${JSON.stringify(f.name)}, e); }`);
  }
  parts.push(`function __boot() {
  if (typeof G.start === 'function') {
    Promise.resolve().then(() => G.start()).catch((e) => { console.error('[BOOT] start failed', e); if (G.showFatal) G.showFatal(e); });
  } else console.error('[BOOT] G.start is missing (core failed to load?)');
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', __boot); else __boot();
})();`);
  return parts.join('\n');
}

// ---------------------------------------------------------------- data export for PHP server
function exportGameData() {
  const dataFrags = fragments.filter((f) => /^0[12]-/.test(f.name) || /education-data/.test(f.name));
  const G = { data: {} };
  const ctx = vm.createContext({ G, window: {}, console, Math, JSON, Object, Array, Number, String, Date });
  for (const f of dataFrags) {
    try { vm.runInContext(`(function(){'use strict';\n${f.code}\n})()`, ctx, { timeout: 2000 }); }
    catch (e) { console.warn(`⚠ data export: ${f.name} could not be evaluated in Node: ${e.message}`); }
  }
  const d = G.data || {};
  // Only what the server needs to validate rewards / timings.
  const pick = (obj, fn) => Object.fromEntries(Object.entries(obj || {}).map(([k, v]) => [k, fn(v)]));
  return {
    exportedAt: new Date().toISOString(),
    quests: pick(d.quests, (q) => ({ reward: q.reward || {} })),
    achievements: pick(d.achievements, (a) => ({ reward: a.reward || {} })),
    quizzes: pick(d.quizzes, (q) => ({ reward: q.reward || {} })),
    crops: pick(d.crops, (c) => ({ growthTime: c.growthTime, exp: c.exp || 0, coin: c.coin || 0, harvestItem: c.harvestItem, harvestAmount: c.harvestAmount })),
    recipes: pick(d.recipes, (r) => ({ baseDuration: r.baseDuration, exp: r.exp || 0, coin: r.coin || 0, resultItem: r.resultItem })),
    items: pick(d.items, (i) => ({ price: i.price || 0, sell: i.sell || 0, type: i.type })),
    limits: d.serverLimits || {},
  };
}

function copyDir(src, dst) {
  if (!fs.existsSync(src)) return 0;
  let n = 0;
  fs.mkdirSync(dst, { recursive: true });
  for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, ent.name), d = path.join(dst, ent.name);
    if (ent.isDirectory()) n += copyDir(s, d);
    else { fs.copyFileSync(s, d); n++; }
  }
  return n;
}

// ---------------------------------------------------------------- assemble
const t0 = Date.now();
const vendor = await buildVendor();
let html = fs.readFileSync(path.join(ROOT, 'src/template.html'), 'utf8');
const sha = (str) => crypto.createHash('sha256').update(str).digest('hex').slice(0, 12);
const buildInfo = {
  version: JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version,
  three: vendor.version,
  builtAt: new Date().toISOString(),
  fragments: fragments.length,
  manifest: {
    js: fragments.map((f) => ({ name: f.name, bytes: Buffer.byteLength(f.code), lines: f.code.split('\n').length, sha: sha(f.code) })),
    css: cssFiles.map((f) => { const c = fs.readFileSync(path.join(styleDir, f), 'utf8'); return { name: f, bytes: Buffer.byteLength(c), lines: c.split('\n').length, sha: sha(c) }; }),
    skipped: skipped.filter((x) => x.reason !== 'filtered'),
    fontEmbedded: EMBED_FONT,
  },
};
// Markers appear exactly once; slice-based replacement avoids `$` pattern surprises.
const replaceOnce = (marker, value) => {
  const i = html.indexOf(marker);
  if (i < 0) throw new Error(`template marker ${marker} missing`);
  html = html.slice(0, i) + value + html.slice(i + marker.length);
};
replaceOnce('<!--@FONTFACE-->', fontFace());
replaceOnce('/*@CSS*/', css);
replaceOnce('/*@VENDOR*/', `/*! three.js r${vendor.version.split('.')[1]} — MIT License — https://threejs.org */\n` + vendor.code.replace(/<\/script/gi, '<\\/script'));
replaceOnce('/*@GAME*/', `window.__BUILD__ = ${JSON.stringify(buildInfo)};\n` + gameScript().replace(/<\/script/gi, '<\\/script'));

// ---------------------------------------------------------------- docs for the in-game developer center (non-executed JSON)
const docsDir = path.join(ROOT, 'docs');
const docs = {};
for (const f of listSorted(docsDir, '.md')) docs[f] = fs.readFileSync(path.join(docsDir, f), 'utf8');
if (fs.existsSync(path.join(ROOT, 'README.md'))) docs['README.md'] = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
if (fs.existsSync(path.join(ROOT, 'server/README-SERVER.md'))) docs['README-SERVER.md'] = fs.readFileSync(path.join(ROOT, 'server/README-SERVER.md'), 'utf8');
const docsJson = JSON.stringify(docs).replace(/</g, '\\u003c');
html = html.replace('</body>', () => `<script type="application/json" id="build-docs">${docsJson}</script>\n</body>`);

// ---------------------------------------------------------------- Content-Security-Policy with script hashes
// Inline scripts are allowed only by their exact SHA-256 hash: injected markup can never run script.
const scriptHashes = [];
html.replace(/<script>([\s\S]*?)<\/script>/g, (m, body) => { scriptHashes.push(`'sha256-${crypto.createHash('sha256').update(body, 'utf8').digest('base64')}'`); return m; });
const csp = [
  "default-src 'none'",
  `script-src ${scriptHashes.join(' ')}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "media-src 'self' data: blob:",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
].join('; ');
replaceOnce('<!--@CSP-->', `<meta http-equiv="Content-Security-Policy" content="${csp}">`);

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, html);

// Server copy + data export only for the default (release) output.
let serverFiles = 0;
if (DEFAULT_OUT) {
  const data = exportGameData();
  const dataDir = path.join(ROOT, 'server/data');
  if (fs.existsSync(path.join(ROOT, 'server'))) {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(path.join(dataDir, 'game-data.json'), JSON.stringify(data, null, 2));
  }
  serverFiles = copyDir(path.join(ROOT, 'server'), path.dirname(OUT));
}

const kb = (n) => (n / 1024).toFixed(0) + ' KB';
log(`✔ built ${path.relative(ROOT, OUT) || OUT} — ${kb(Buffer.byteLength(html))} in ${Date.now() - t0} ms`);
log(`  fragments: ${fragments.map((f) => f.name).join(', ')}`);
if (skipped.filter((s) => s.reason !== 'filtered').length) log(`  skipped: ${skipped.filter((s) => s.reason !== 'filtered').map((s) => `${s.name} (${s.reason})`).join('; ')}`);
log(`  css: ${cssFiles.join(', ')}`);
if (DEFAULT_OUT) log(`  server files copied: ${serverFiles}`);
