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
//   node tools/build.mjs --minify | --no-minify | --dev | --no-mangle
//                                             -> [opt] fragments and stylesheets are minified (tools/minify.mjs: whitespace,
//                                                syntax, each fragment's own local names; property names and strings never)
//                                                by default with --strict and for the release output; --minify forces it,
//                                                --no-minify / --dev keep the source text, --no-mangle keeps local names.
//                                                The page warns when it is over the budget of CONTRACT §16.0 (release page
//                                                12.5 MB raw / 7 MB brotli, test build 6.8 MB); --budget makes that an error.
//   node tools/build.mjs --no-pwa             -> [opt] a server copy gets no manifest / service worker / offline page / icons
//                                                (tools/pwa.mjs; CONTRACT §18.6 — written only next to a server copy's index.html)
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
import { minifyFragmentCached, minifyCss, pruneCache } from './minify.mjs'; // [opt]
import { writeInstallable } from './pwa.mjs'; // [opt] the installable page of a server copy

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
// [opt] minification of the fragments and stylesheets (tools/minify.mjs, CONTRACT §19.4): on for --strict and the release
// output (dist/metaverse), and with --minify; --no-minify (or --dev) keeps the source text; --no-mangle keeps local names
const MINIFY = !flag('--no-minify') && !flag('--dev') && (flag('--minify') || STRICT || DEFAULT_OUT);
const MANGLE = !flag('--no-mangle');
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
  ['03-state.js', '71-entitle.js'],        // [entitle] G.net before the tap that reads `ent` / `site` from its answers
  ['71-entitle.js', '72-subscription.js'], // [entitle] G.sys.entitle before the plan screen built on it
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
// [opt] each fragment minified on its own, exactly as gameScript() wraps it (f.min = the whole try … catch statement);
// a fragment that cannot be minified safely keeps its source text (tools/minify.mjs says why)
const minNotes = [];
if (MINIFY) {
  for (const f of fragments) {
    const r = minifyFragmentCached(f.name, f.code, { mangle: MANGLE, cacheDir: path.join(ROOT, '.cache', 'min') });
    if (r.minified) f.min = r.code;
    else { minNotes.push(`${f.name}: ${r.reason}`); console.warn(`⚠ ${f.name} is not minified: ${r.reason}`); }
  }
  pruneCache(path.join(ROOT, '.cache', 'min'));
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
const cssMin = {}; // [opt] file → minified bytes (MINIFY); the /* ==== file ==== */ markers stay (tools/weight.mjs reads them)
const css = cssFiles.map((f) => `/* ==== ${f} ==== */\n` + ((src) => { if (!MINIFY) return src; const r = minifyCss(f, src); if (r.minified) cssMin[f] = Buffer.byteLength(r.code); else console.warn(`⚠ ${f} is not minified: ${r.reason}`); return r.code; })(fs.readFileSync(path.join(styleDir, f), 'utf8'))).join('\n');

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
    if (f.min) { parts.push(`//@ ${f.name}\n${f.min}`); continue; } // [opt] minified: a short marker line + the statement
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
  // [fishing] the fish table (CONTRACT §18.3) is pure data too. It is evaluated in file-name order: its items, quests and
  // achievements join the tables below, and 45-education-data.js merges its learning cards and quiz items
  for (const f of fragments.filter((x) => /^34-fish-data/.test(x.name))) { const at = dataFrags.findIndex((x) => x.name > f.name); dataFrags.splice(at < 0 ? dataFrags.length : at, 0, f); }
  const G = { data: {} };
  const ctx = vm.createContext({ G, window: {}, console, Math, JSON, Object, Array, Number, String, Date });
  for (const f of dataFrags) {
    try { vm.runInContext(`(function(){'use strict';\n${f.code}\n})()`, ctx, { timeout: 2000 }); }
    catch (e) { console.warn(`⚠ data export: ${f.name} could not be evaluated in Node: ${e.message}`); }
  }
  // [myroom] 내 방 (CONTRACT §17.4): the catalogue is pure data + math too — Tfm\Room checks a saved room against it
  for (const f of fragments.filter((x) => /myroom-data/.test(x.name))) {
    try { vm.runInContext(`(function(){'use strict';\n${f.code}\n})()`, ctx, { timeout: 2000 }); }
    catch (e) { console.warn(`⚠ data export: ${f.name} could not be evaluated in Node: ${e.message}`); }
  }
  // [settings] the option table of the settings window (CONTRACT §18.2): Tfm\UserSettings checks a saved blob against it
  for (const f of fragments.filter((x) => /^68-settings/.test(x.name))) {
    try { vm.runInContext(`(function(){'use strict';\n${f.code}\n})()`, ctx, { timeout: 2000 }); }
    catch (e) { console.warn(`⚠ data export: ${f.name} could not be evaluated in Node: ${e.message}`); }
  }
  // [cooking] the dishes and the kitchen staples (CONTRACT §18.4): their items, quests, cards and the state limits reach
  // the server (evaluated after the education data, so its cards and quizzes merge into G.data like in the page)
  for (const f of fragments.filter((x) => /cooking-data/.test(x.name))) {
    try { vm.runInContext(`(function(){'use strict';\n${f.code}\n})()`, ctx, { timeout: 2000 }); }
    catch (e) { console.warn(`⚠ data export: ${f.name} could not be evaluated in Node: ${e.message}`); }
  }
  // [wardrobe] clothes as items (CONTRACT §19.1): 24-wardrobe.js makes one item WEAR_<KEY>_<ID> per value of a slot key of
  // the avatar table (its data half is pure); its gift pieces join the rewards of quests / achievements of every fragment above
  for (const f of fragments.filter((x) => /^24-wardrobe/.test(x.name))) {
    try { vm.runInContext(`(function(){'use strict';\n${f.code}\n})()`, ctx, { timeout: 2000 }); G.data.wardrobe?.applyGifts?.(G.data); }
    catch (e) { console.warn(`⚠ data export: ${f.name} could not be evaluated in Node: ${e.message}`); }
  }
  // [healing] the 힐링관 (CONTRACT §19.6): room ids → minutes, the bundle size and the state limits reach SaveValidator
  for (const f of fragments.filter((x) => /^38-healing-data/.test(x.name))) {
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
    // [env] the Korean crop calendar (CONTRACT §17.5): Tfm\Env measures the real-time beds with the same days / months
    cropCalendar: pick(d.cropCalendar || {}, (c) => ({ sow: c.sow, harvest: c.harvest, days: c.days })),
    // [myroom] ids → [placing kind, w, d, h, colours, sizes], the room's measures, style ids, limits (no names, no options)
    myroom: d.myroom && typeof d.myroom.serverTable === 'function' ? d.myroom.serverTable() : {},
    // [avatar] the avatar's option ids (CONTRACT §17.7): Tfm\Presence whitelists saved / shared looks against them
    avatar: d.avatar ? { v: d.avatar.v, options: d.avatar.options, legacy: d.avatar.legacy, colorKeys: d.avatar.colorKeys } : {},
    // [settings] ids → { t: b | n | e, min, max, step, values, d, s: a | d } (CONTRACT §18.2), tabs, limits
    settings: d.settingsTable ? { v: d.settingsTable.v, bytes: d.settingsTable.bytes, devices: d.settingsTable.devices, maxOptions: d.settingsTable.maxOptions, tabs: d.settingsTable.tabs, options: d.settingsTable.options } : {},
    // [cooking] dish ids, the 찬장 staples and the limits of G.state.cooking (SaveValidator's [cooking] block)
    cooking: d.cooking ? { v: d.cooking.v, dishes: Object.keys(d.cooking.dishes || {}), kinds: Object.fromEntries(Object.entries(d.cooking.dishes || {}).map(([k, x]) => [k, x.kind])), pantry: d.cooking.pantry || [], limits: d.cooking.limits || {} } : {},
    // [fishing] species ids → { p: protected 0 | 1, max: mm, d: difficulty }, neighbours, spots, baits, the daily keep limit,
    // exp per catch (CONTRACT §18.3): Tfm\SaveValidator checks the `fishing` block of a save and keeps protected fish out of the bag
    fish: d.fish && typeof d.fish.serverTable === 'function' ? d.fish.serverTable() : {},
    // [wardrobe] item ids → [slot key, value id, sell], the starter kit, the words / homes / faces of 기본 정보, the limits
    // (CONTRACT §19.1): Tfm\SaveValidator's [wardrobe] block checks G.state.wardrobe and that the look wears owned pieces
    wardrobe: d.wardrobe && typeof d.wardrobe.serverTable === 'function' ? d.wardrobe.serverTable() : {},
    // [healing] { v, rooms: { R1: minutes, … }, bundle, nums, limits, scaleMax } (CONTRACT §19.6) — Tfm\SaveValidator's [healing] block
    healing: d.healing && typeof d.healing.serverTable === 'function' ? d.healing.serverTable() : {},
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
    js: fragments.map((f) => ({ name: f.name, bytes: Buffer.byteLength(f.code), lines: f.code.split('\n').length, sha: sha(f.code), ...(f.min ? { min: Buffer.byteLength(f.min) } : {}) })), // [opt] min = bytes in the page
    css: cssFiles.map((f) => { const c = fs.readFileSync(path.join(styleDir, f), 'utf8'); return { name: f, bytes: Buffer.byteLength(c), lines: c.split('\n').length, sha: sha(c), ...(cssMin[f] ? { min: cssMin[f] } : {}) }; }),
    minified: MINIFY ? { mangle: MANGLE, js: fragments.filter((f) => f.min).length, kept: minNotes } : false, // [opt]
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
// [lecture] 강의실 (CONTRACT §17.0 / §17.3): the ONLY places the page may frame besides 토스 — this site itself (the pdf
// viewer shows api/lecture/file.php in a same-origin frame), the YouTube player (youtube-nocookie; youtube.com is what
// that player may hand over to) and the two allow-listed slide hosts — and the one outside image host, the video
// thumbnails. 74-lecture.js frames nothing else and checks ids / hosts again; connect-src stays 'self' (+ 토스).
const LECTURE_FRAMES = "'self' https://www.youtube-nocookie.com https://www.youtube.com https://docs.google.com https://view.officeapps.live.com";
const LECTURE_IMG = 'https://i.ytimg.com';
const csp = [
  "default-src 'none'",
  `script-src ${scriptHashes.join(' ')} ${TOSS_SCRIPT}`,
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: ${LECTURE_IMG}`,
  "font-src 'self' data:",
  `connect-src 'self' ${TOSS_API} ${TOSS_HOSTS}`,
  `frame-src ${TOSS_HOSTS} ${LECTURE_FRAMES}`,
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

// [opt] the installable page of a server copy (CONTRACT §18.6, tools/pwa.mjs): manifest.webmanifest, sw.js, offline.html
// and icons/ next to index.html — only for a server copy (the release output, or --out <dir>/index.html with
// --data-out <dir>/data/game-data.json); a page opened as a file never gets them (--no-pwa: none at all)
if (path.basename(OUT) === 'index.html' && !flag('--no-pwa') && (DEFAULT_OUT || (DATA_OUT && path.basename(path.dirname(DATA_OUT)) === 'data' && path.dirname(path.dirname(DATA_OUT)) === path.dirname(OUT)))) {
  const pwa = writeInstallable(path.dirname(OUT), { version: crypto.createHash('sha1').update(html).digest('hex').slice(0, 12) });
  log(`  installable page: ${pwa.files.join(', ')}`);
}

const kb = (n) => (n / 1024).toFixed(0) + ' KB';
log(`✔ built ${path.relative(ROOT, OUT) || OUT} — ${kb(Buffer.byteLength(html))} in ${Date.now() - t0} ms`);
log(`  fragments: ${fragments.map((f) => f.name).join(', ')}`);
if (skipped.filter((s) => s.reason !== 'filtered').length) log(`  skipped: ${skipped.filter((s) => s.reason !== 'filtered').map((s) => `${s.name} (${s.reason})`).join('; ')}`);
log(`  css: ${cssFiles.join(', ')}`);
if (DEFAULT_OUT) log(`  server files copied: ${serverFiles}`);
if (precompressed) log(`  precompressed copies: ${Object.entries(precompressed.copies).map(([n, c]) => `${n} ${kb(c.bytes)} (${(c.bytes / precompressed.bytes * 100).toFixed(0)}%)`).join(', ')}`);
if (pack) log(`  asset pack: ${pack.files.length} files, ${kb(pack.bytes)}${EMBED_ASSETS ? ' embedded (base64)' : ' — NOT embedded (--no-assets)'}`);
// [opt] minification summary and the page budget (CONTRACT §16.0): release page (font + pack) 12.5 MB raw / 7 MB brotli,
// test build (--no-font --no-assets) 6.8 MB raw. Brotli is measured only when a precompressed copy was made.
{
  const bytes = Buffer.byteLength(html);
  if (MINIFY) log(`  minified: ${fragments.filter((f) => f.min).length}/${fragments.length} fragments${MANGLE ? ' (local names shortened)' : ''}, ${Object.keys(cssMin).length}/${cssFiles.length} stylesheets`);
  const release = EMBED_FONT && pack && EMBED_ASSETS, test = !EMBED_FONT && !(pack && EMBED_ASSETS);
  const limit = !MINIFY ? 0 : release ? 12.5e6 : test ? 6.8e6 : 0;   // the budgets are for minified pages
  const brBytes = precompressed?.copies?.['index.br.html']?.bytes;
  const over = (limit && bytes > limit) || (release && brBytes > 7e6);
  if (over) {
    const msg = `page is over the budget of CONTRACT §16.0: ${(bytes / 1e6).toFixed(2)} MB raw${brBytes ? `, ${(brBytes / 1e6).toFixed(2)} MB brotli` : ''} (limit ${(limit / 1e6).toFixed(1)} MB${release ? ' raw / 7 MB brotli' : ''})${MINIFY ? '' : ' — not minified (--no-minify / --dev, or neither --strict nor --minify)'}`;
    if (flag('--budget')) { console.error(`✖ ${msg}`); process.exit(1); }
    console.warn(`⚠ ${msg}`);
  }
}
