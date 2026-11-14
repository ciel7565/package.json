#!/usr/bin/env node
// =============================================================================
// 전통발효체험관 메타버스 — single-file HTML builder
//
//   node tools/build.mjs                      -> dist/metaverse/index.html (+ server files)
//   node tools/build.mjs --out /tmp/a.html    -> custom output path (no server copy)
//   node tools/build.mjs --only 11,12         -> core + only fragments whose name starts with 11 / 12
//   node tools/build.mjs --exclude 70         -> everything except fragments starting with 70
//   node tools/build.mjs --no-font            -> skip embedding the Pretendard webfont (smaller/faster dev build)
//   node tools/build.mjs --no-assets          -> skip embedding the asset pack (assets/pack, CONTRACT §16.1): the page is
//                                                ~3.9 MB smaller and G.pack is empty (procedural fallbacks everywhere)
//   node tools/build.mjs --strict             -> fail if any fragment has a syntax error (default: skip it + warn)
//   node tools/build.mjs --out <dir>/index.html --data-out <dir>/data/game-data.json
//                                             -> also export the server's game data (a server copy outside dist/:
//                                                cp -r server/. <dir>/ first; the default build writes server/data/)
//   node tools/build.mjs --no-precompress     -> [scale-server] do not write index.gz.html / index.br.html. A server copy
//                                                (the default output, or --out …/index.html with --data-out) gets these
//                                                precompressed copies of the page (CONTRACT §16.9: .htaccess serves them
//                                                by Accept-Encoding) and data/page.json, which names the page they belong
//                                                to. --brotli <0-11> sets the brotli quality (default 11, 9 with --out).
//
// Each src/game/*.js file is a "fragment": plain script code (no import/export, no top-level
// await). Fragments are concatenated in filename order inside ONE closure and each one is
// wrapped in its own try { ... } block, so its top-level const/let/class names are private and
// a crash in one fragment cannot stop the others. Fragments share state only through `G`.
// =============================================================================
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';
import crypto from 'node:crypto';
import zlib from 'node:zlib'; // [scale-server] precompressed copies of the page

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
const EMBED_ASSETS = !flag('--no-assets');   // [render-assets] the licence-checked asset pack (CONTRACT §16.1)
const DATA_OUT = opt('--data-out') ? path.resolve(opt('--data-out')) : null;
const STRICT = flag('--strict');
const QUIET = flag('--quiet');
// Core fragments are always included, even with --only.
// 07-speed.js (CONTRACT §14.1, G.sys.speed) is core too: everything that moves or grows reads it.
// [render-assets] 09-pack.js (G.pack) and 14-materials.js (G.mat) are core as well: the world fragments ask them for
// textures and materials, and an isolated module build must look like the full one.
const CORE_PREFIXES = ['00', '01', '02', '03', '04', '05', '06', '07', '09', '10', '14'];
// Fragments run in filename order (see listSorted). These pairs document the orderings other fragments rely on
// (CONTRACT §14.1 / §14.6): the build fails loudly when a rename breaks one instead of booting a broken game.
const ORDER_RULES = [
  ['03-state.js', '07-speed.js'],          // G.state.sub default before the speed mirror
  ['07-speed.js', '08-easy.js'],           // speed before every system that moves or grows
  ['07-speed.js', '21-player.js'],
  ['70-app.js', '72-subscription.js'],     // the app shell (menus, settings) before the subscription screen
  ['72-subscription.js', '80-devcenter.js'], // the dev center's 구독·속도 panel reads G.sys.subscription
  ['09-pack.js', '14-materials.js'],       // [render-assets] G.pack before G.mat …
  ['14-materials.js', '15-buildings.js'],  // … and G.mat before the building kit that maps its material keys onto it
  ['33-complex-plan.js', '43-allot.js'],   // [complex-plan] G.data.complex (the master plan) before the 분양 panel …
  ['33-complex-plan.js', '44-allot-district.js'], // … the 10,000 instanced units …
  ['33-complex-plan.js', '53-complex-site.js'],   // … and the 3D complex that build on it
];

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
// fragment order sanity (ORDER_RULES): only pairs that are both in this build are checked
{
  const idx = new Map(fragments.map((f, i) => [f.name, i]));
  for (const [a, b] of ORDER_RULES) {
    if (idx.has(a) && idx.has(b) && idx.get(a) > idx.get(b)) { console.error(`✖ fragment order: ${a} must come before ${b}`); process.exit(1); }
  }
}

// --strict: the server's PII rule file must match the client engine (one rule list, CONTRACT §12.4)
if (STRICT && fs.existsSync(path.join(ROOT, 'tests/pii-sync.mjs'))) {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'tests/pii-sync.mjs'), '--check'], { encoding: 'utf8' });
  if (r.status !== 0) { console.error((r.stderr || r.stdout || '').trim() || '✖ pii-sync check failed'); console.error('✖ run: node tests/pii-sync.mjs'); process.exit(1); }
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
    // condition {stat, gte} for the stats the client keeps as plain counters in state.stats (SaveValidator checks a newly
    // claimed achievement against them); derived ones (zonesVisited, npcsTalked, cropKinds, socials) are left out
    achievements: pick(d.achievements, (a) => {
      const c = a.condition;
      const derived = ['zonesVisited', 'npcsTalked', 'cropKinds', 'socials'];
      const cond = c && typeof c.stat === 'string' && Number.isFinite(Number(c.gte)) && !derived.includes(c.stat) ? { stat: c.stat, gte: Number(c.gte) } : undefined;
      return cond ? { reward: a.reward || {}, condition: cond } : { reward: a.reward || {} };
    }),
    quizzes: pick(d.quizzes, (q) => ({ reward: q.reward || {} })),
    crops: pick(d.crops, (c) => ({ growthTime: c.growthTime, exp: c.exp || 0, coin: c.coin || 0, harvestItem: c.harvestItem, harvestAmount: c.harvestAmount })),
    recipes: pick(d.recipes, (r) => ({ baseDuration: r.baseDuration, exp: r.exp || 0, coin: r.coin || 0, resultItem: r.resultItem })),
    items: pick(d.items, (i) => ({ price: i.price || 0, sell: i.sell || 0, type: i.type })),
    // every title a player can legitimately equip (level titles + reward titles): the ranking shows only these,
    // so the save's free-text profile.title can never carry chat-filter-bypassing text to other players
    titles: [...new Set([
      ...Object.values(d.levels?.titles || {}),
      ...[d.quests, d.achievements, d.quizzes].flatMap((m) => Object.values(m || {}).map((x) => x?.reward?.title)),
    ].filter((t) => typeof t === 'string' && t.trim()).map((t) => t.trim()))].sort(),
    limits: d.serverLimits || {},
    // real-time beds + storage (CONTRACT §15.1 / §15.2): the server computes ready times and checks harvests / the 곳간
    rtfarm: d.rtfarm ? {
      beds: d.rtfarm.beds, careCooldownMin: d.rtfarm.careCooldownMin, carePerAction: d.rtfarm.carePerAction,
      starAt: d.rtfarm.starAt, bonusAtStars: d.rtfarm.bonusAtStars, reportNotes: d.rtfarm.reportNotes,
      crops: pick(d.rtfarm.crops, (c) => ({ minutes: c.minutes, exp: c.exp || 0, coin: c.coin || 0 })),
    } : {},
    storage: d.storage ? { cap: d.storage.cap, itemIds: d.storage.itemIds } : {},
  };
}

// docs for the admin site's developer tab (CONTRACT §15.5), copied into lib/docs/ of a server copy. lib/ is never
// web-readable (lib/.htaccess denies it); Tfm\Markdown renders them for signed-in admins only.
const ADMIN_DOCS = ['docs/HANDOVER.md', 'docs/ARCHITECTURE.md', 'docs/SERVER-INSTALL-KO.md', 'docs/SECURITY-REPORT-KO.md', 'server/README-SERVER.md'];
function copyAdminDocs(serverDir) {
  const dst = path.join(serverDir, 'lib', 'docs');
  fs.mkdirSync(dst, { recursive: true });
  let n = 0;
  for (const rel of ADMIN_DOCS) {
    const src = path.join(ROOT, rel);
    if (fs.existsSync(src)) { fs.copyFileSync(src, path.join(dst, path.basename(rel))); n++; }
  }
  return n;
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

// ---------------------------------------------------------------- asset pack (CONTRACT §16.1) [render-assets]
// assets/pack/<file> + MANIFEST.json { version: 1, files: [{ name, file, kind, w, h, bytes, sha256, license, source, … }] }.
// Every build verifies the pack (also with --no-assets): an image that is not in the manifest, a file whose bytes or
// sha256 differ, a licence that is not CC0 / public domain or a pack over the budget stops the build with a clear message.
const PACK_DIR = path.resolve(opt('--pack', path.join(ROOT, 'assets/pack')));   // --pack <dir>: another pack directory (tests)
const PACK_BUDGET = 3000000;   // bytes of binary (CONTRACT §16.0: pack <= 3.0 MB)
const PACK_KINDS = new Set(['color', 'normal', 'rough', 'art', 'sky', 'alpha', 'noise']);
const PACK_MIME = { '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.avif': 'image/avif' };
const PACK_ASSET_EXT = /\.(webp|png|jpe?g|avif|gif|bmp|tga|tiff?|hdr|exr|ktx2?|basis|dds|glb|gltf|bin|svg|mp3|ogg|wav|mp4|webm)$/i;
// what the page needs at run time (G.pack.meta / credits, the integrity self-test); evidence and the recipe's notes stay in the repository
const PACK_RUNTIME_KEYS = ['name', 'kind', 'w', 'h', 'bytes', 'sha256', 'license', 'source', 'title', 'credit', 'titleKo', 'artist', 'date', 'culture', 'period',
  'medium', 'avg', 'enc', 'alias', 'use', 'peak', 'mean', 'sunDir', 'sunElevation'];
function loadPack() {
  const fail = (msg) => { console.error(`✖ asset pack: ${msg}`); process.exit(1); };
  if (!fs.existsSync(PACK_DIR)) return null;
  const present = fs.readdirSync(PACK_DIR, { withFileTypes: true }).filter((e) => e.isFile()).map((e) => e.name);
  const manifestFile = path.join(PACK_DIR, 'MANIFEST.json');
  if (!fs.existsSync(manifestFile)) {
    const stray = present.filter((f) => PACK_ASSET_EXT.test(f));
    if (stray.length) fail(`assets/pack holds ${stray.length} file(s) but no MANIFEST.json (CONTRACT §16.1) — e.g. ${stray[0]}`);
    return null;
  }
  let manifest;
  try { manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8')); } catch (e) { fail(`MANIFEST.json is not valid JSON: ${e.message}`); }
  if (!manifest || manifest.version !== 1 || !Array.isArray(manifest.files)) fail('MANIFEST.json must be { version: 1, files: [...] }');
  const names = new Set(), listed = new Set(), files = [];
  let total = 0;
  for (const e of manifest.files) {
    const where = `MANIFEST.json entry ${JSON.stringify(e && e.name)}`;
    if (!e || typeof e.name !== 'string' || !/^(mat\/[a-z0-9_]+\/[cnr]|art\/[a-z0-9_]+|sky\/[a-z0-9_]+|alpha\/[a-z0-9_]+|noise\/[a-z0-9_]+)$/.test(e.name)) fail(`${where}: the name must be mat/<set>/c|n|r, art/<id>, sky/<id>, alpha/<id> or noise/<id>`);
    if (names.has(e.name)) fail(`${where}: listed twice`);
    if (typeof e.file !== 'string' || !/^[\w.-]+$/.test(e.file) || listed.has(e.file)) fail(`${where}: bad or repeated file name ${JSON.stringify(e.file)}`);
    if (!PACK_KINDS.has(e.kind)) fail(`${where}: unknown kind ${JSON.stringify(e.kind)}`);
    const mime = PACK_MIME[path.extname(e.file).toLowerCase()];
    if (!mime) fail(`${where}: ${e.file} is not a WebP / PNG / JPEG / AVIF image`);
    if (!Number.isInteger(e.w) || !Number.isInteger(e.h) || e.w < 1 || e.h < 1) fail(`${where}: w / h missing`);
    if (typeof e.license !== 'string' || !/^(CC0|Public Domain)/i.test(e.license)) fail(`${where}: licence ${JSON.stringify(e.license)} — only CC0 / public domain material may be embedded (docs/ASSET-CREDITS.md)`);
    if (typeof e.source !== 'string' || !/^https:\/\//.test(e.source)) fail(`${where}: the source URL is missing`);
    if (typeof e.title !== 'string' || !e.title || typeof e.credit !== 'string' || !e.credit) fail(`${where}: title / credit missing`);
    for (const a of e.alias || []) { if (names.has(a)) fail(`${where}: alias ${a} is taken`); names.add(a); }
    const abs = path.join(PACK_DIR, e.file);
    if (!fs.existsSync(abs)) fail(`${where}: assets/pack/${e.file} is missing`);
    const data = fs.readFileSync(abs);
    if (data.length !== e.bytes) fail(`${where}: assets/pack/${e.file} has ${data.length} bytes, the manifest says ${e.bytes} (run assets/pack/src/make_pack.py again)`);
    const digest = crypto.createHash('sha256').update(data).digest('hex');
    if (digest !== e.sha256) fail(`${where}: sha256 of assets/pack/${e.file} does not match the manifest (run assets/pack/src/make_pack.py again)`);
    names.add(e.name); listed.add(e.file); total += data.length;
    files.push({ entry: e, mime, data });
  }
  const stray = present.filter((f) => f !== 'MANIFEST.json' && !listed.has(f) && PACK_ASSET_EXT.test(f));
  if (stray.length) fail(`assets/pack/${stray[0]}${stray.length > 1 ? ` (+ ${stray.length - 1} more)` : ''} is not in MANIFEST.json — register it with its source and licence (docs/ASSET-CREDITS.md) or remove it`);
  if (total > PACK_BUDGET) fail(`${total} bytes of binary — the budget is ${PACK_BUDGET} (CONTRACT §16.0)`);
  return { files, bytes: total };
}
const pack = loadPack();
/** inert blocks: one manifest (JSON) + one base64 block per file — never executed, not covered by script-src */
function packBlocks() {
  const runtime = {
    version: 1, bytes: pack.bytes,
    files: pack.files.map(({ entry, mime }) => {
      const o = { mime };
      for (const k of PACK_RUNTIME_KEYS) if (entry[k] !== undefined && entry[k] !== null) o[k] = entry[k];
      return o;
    }),
  };
  const out = [`<script type="application/json" id="pack-manifest">${JSON.stringify(runtime).replace(/</g, '\\u003c')}</script>`];
  for (const { entry, mime, data } of pack.files) out.push(`<script type="application/octet-stream" data-pack="${entry.name}" data-mime="${mime}">${data.toString('base64')}</script>`);
  return out.join('\n');
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
  // [render-assets] the asset pack of this page (CONTRACT §16.1): embedded = the base64 blocks are in the page
  pack: { embedded: !!(pack && EMBED_ASSETS), files: pack ? pack.files.length : 0, bytes: pack ? pack.bytes : 0 },
  // kid-safety test vectors shared by the server e2e and the developer center self-tests (CONTRACT §12.4)
  piiVectors: (() => {
    try {
      const v = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests/pii-vectors.json'), 'utf8'));
      const list = (a) => (Array.isArray(a) ? a.filter((x) => typeof x === 'string').slice(0, 400) : []);
      return { whole: list(v.whole), partial: list(v.partial), keep: list(v.keep) };
    } catch (e) { return null; }
  })(),
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
// buildInfo carries strings from files (manifest names, tests/pii-vectors.json): '<' is escaped so nothing can close the script
replaceOnce('/*@GAME*/', `window.__BUILD__ = ${JSON.stringify(buildInfo).replace(/</g, '\\u003c')};\n` + gameScript().replace(/<\/script/gi, '<\\/script'));

// ---------------------------------------------------------------- docs for the in-game developer center (non-executed JSON)
const docsDir = path.join(ROOT, 'docs');
const docs = {};
for (const f of listSorted(docsDir, '.md')) docs[f] = fs.readFileSync(path.join(docsDir, f), 'utf8');
if (fs.existsSync(path.join(ROOT, 'README.md'))) docs['README.md'] = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
if (fs.existsSync(path.join(ROOT, 'server/README-SERVER.md'))) docs['README-SERVER.md'] = fs.readFileSync(path.join(ROOT, 'server/README-SERVER.md'), 'utf8');
const docsJson = JSON.stringify(docs).replace(/</g, '\\u003c');
html = html.replace('</body>', () => `<script type="application/json" id="build-docs">${docsJson}</script>\n</body>`);

// ---------------------------------------------------------------- asset pack blocks, after the main script [render-assets]
// (the parser reaches them after the game script has run its fragments; G.pack.ready resolves at DOMContentLoaded)
if (pack && EMBED_ASSETS) {
  const i = html.lastIndexOf('</body>');
  if (i < 0) throw new Error('template has no </body>');
  html = html.slice(0, i) + packBlocks() + '\n' + html.slice(i);
}

// ---------------------------------------------------------------- Content-Security-Policy with script hashes
// Inline scripts are allowed only by their exact SHA-256 hash: injected markup can never run script.
const scriptHashes = [];
html.replace(/<script>([\s\S]*?)<\/script>/g, (m, body) => { scriptHashes.push(`'sha256-${crypto.createHash('sha256').update(body, 'utf8').digest('base64')}'`); return m; });
// 토스페이먼츠 (CONTRACT §14.6): the payment SDK (js.tosspayments.com/v2/standard) is loaded on demand, only in server
// mode after a grown-up action; it talks to api.tosspayments.com, its payment window is an iframe on *.tosspayments.com,
// and on phones it may hand the page over to that window with a form submit (the browser comes back through
// api/sub/return.php, a same-origin top-level GET, which needs nothing here). The same HTML is the standalone file,
// where nothing ever loads it — the allowance is inert offline. Everything else stays as strict: only these Toss hosts
// are added (script-src, connect-src, frame-src, form-action) and nothing else is loosened.
const TOSS_SCRIPT = 'https://js.tosspayments.com';
const TOSS_API = 'https://api.tosspayments.com';
const TOSS_HOSTS = 'https://*.tosspayments.com';
const csp = [
  "default-src 'none'",
  `script-src ${scriptHashes.join(' ')} ${TOSS_SCRIPT}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src 'self' ${TOSS_API} ${TOSS_HOSTS}`,
  `frame-src ${TOSS_HOSTS}`,
  "media-src 'self' data: blob:",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  `form-action 'self' ${TOSS_HOSTS}`,
].join('; ');
replaceOnce('<!--@CSP-->', `<meta http-equiv="Content-Security-Policy" content="${csp}">`);

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, html);

// [scale-server] CONTRACT §16.9 — precompressed copies of the page for a server copy (.htaccess serves them by
// Accept-Encoding; lib/Api.php removes a copy that does not belong to the index.html next to it, using data/page.json).
// Copies of an earlier build are removed first, so a build that writes none never leaves a stale one behind.
const PRE = { 'index.gz.html': 'gzip', 'index.br.html': 'br' };
let precompressed = null;
if (path.basename(OUT) === 'index.html') {
  for (const name of Object.keys(PRE)) fs.rmSync(path.join(path.dirname(OUT), name), { force: true });
  if ((DEFAULT_OUT || DATA_OUT) && !flag('--no-precompress')) {
    const page = Buffer.from(html, 'utf8');
    const q = Math.max(0, Math.min(11, Number(opt('--brotli', DEFAULT_OUT ? 11 : 9)) || 0));
    const made = {
      'index.gz.html': zlib.gzipSync(page, { level: 9 }),
      'index.br.html': zlib.brotliCompressSync(page, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: q, [zlib.constants.BROTLI_PARAM_LGWIN]: 24, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: page.length } }),
    };
    precompressed = { page: 'index.html', bytes: page.length, sha1: crypto.createHash('sha1').update(page).digest('hex'), copies: {} };
    for (const [name, buf] of Object.entries(made)) {
      fs.writeFileSync(path.join(path.dirname(OUT), name), buf);
      precompressed.copies[name] = { encoding: PRE[name], bytes: buf.length, sha1: crypto.createHash('sha1').update(buf).digest('hex') };
    }
  }
}
/** data/page.json of a server copy: which index.html the precompressed copies were made from */
const writePageInfo = (dataDir) => {
  const file = path.join(dataDir, 'page.json');
  if (!precompressed) { fs.rmSync(file, { force: true }); return; }
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(precompressed, null, 2));
};

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
  if (fs.existsSync(path.join(ROOT, 'server'))) serverFiles += copyAdminDocs(path.dirname(OUT));
  writePageInfo(path.join(path.dirname(OUT), 'data')); // [scale-server]
}
// a server copy built elsewhere (tests, a scratch php -S): the same game data (and admin docs) the release copy gets
if (DATA_OUT) {
  fs.mkdirSync(path.dirname(DATA_OUT), { recursive: true });
  fs.writeFileSync(DATA_OUT, JSON.stringify(exportGameData(), null, 2));
  log(`  game data: ${DATA_OUT}`);
  if (path.dirname(path.dirname(DATA_OUT)) === path.dirname(OUT)) writePageInfo(path.dirname(DATA_OUT)); // [scale-server]
  // <copy>/data/game-data.json → <copy>/lib/docs/ (only for that layout, so a stray --data-out path never gets a lib/;
  // never into the source tree server/ itself — its docs live in docs/ and are copied only into built copies)
  const copyRoot = path.dirname(path.dirname(DATA_OUT));
  if (path.basename(path.dirname(DATA_OUT)) === 'data' && path.resolve(copyRoot) !== path.join(ROOT, 'server')) {
    log(`  admin docs: ${copyAdminDocs(copyRoot)} → ${path.join(copyRoot, 'lib', 'docs')}`);
  }
}

const kb = (n) => (n / 1024).toFixed(0) + ' KB';
log(`✔ built ${path.relative(ROOT, OUT) || OUT} — ${kb(Buffer.byteLength(html))} in ${Date.now() - t0} ms`);
log(`  fragments: ${fragments.map((f) => f.name).join(', ')}`);
if (skipped.filter((s) => s.reason !== 'filtered').length) log(`  skipped: ${skipped.filter((s) => s.reason !== 'filtered').map((s) => `${s.name} (${s.reason})`).join('; ')}`);
log(`  css: ${cssFiles.join(', ')}`);
if (DEFAULT_OUT) log(`  server files copied: ${serverFiles}`);
if (precompressed) log(`  precompressed copies: ${Object.entries(precompressed.copies).map(([n, c]) => `${n} ${kb(c.bytes)} (${(c.bytes / precompressed.bytes * 100).toFixed(0)}%)`).join(', ')}`);
if (pack) log(`  asset pack: ${pack.files.length} files, ${kb(pack.bytes)}${EMBED_ASSETS ? ' embedded (base64)' : ' — NOT embedded (--no-assets)'}`);
