#!/usr/bin/env node
// =============================================================================
// Release packager:  node tools/package.mjs [--dist <built folder>] [--out <zip>] [--no-build]
//   1) strict release build  -> dist/metaverse/ (index.html + PHP server files)       (skipped with --no-build / --dist)
//   2) zip                   -> release/fermentation-metaverse.zip
//        metaverse/            ready to run (double-click index.html, or drop into XAMPP htdocs → open install.php)
//        전통발효체험관.html     same single file at the top level for convenience
//        README.md, docs/ (incl. SERVER-INSTALL-KO.md), src/, tools/, vendor/three-entry.js, tests/, package.json  (source)
//   Never shipped: data/*.sqlite(+wal/shm), data/install.lock, config/config.local.php, data/secret.php, sessions/, logs/,
//   backups/, uploads/journal/*, any composer vendor/ folder, hidden tool state. The zip is verified after writing.
// =============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name, def = null) => { const i = args.indexOf(name); return i >= 0 && i + 1 < args.length ? args[i + 1] : def; };
const run = (cmd, a, opts = {}) => execFileSync(cmd, a, { cwd: ROOT, stdio: 'inherit', ...opts });

const DIST = path.resolve(opt('--dist', path.join(ROOT, 'dist/metaverse')));
const ZIP = path.resolve(opt('--out', path.join(ROOT, 'release', 'fermentation-metaverse.zip')));
if (!args.includes('--no-build') && !opt('--dist')) run('node', ['tools/build.mjs', '--strict']);
if (!fs.existsSync(path.join(DIST, 'index.html')) || !fs.existsSync(path.join(DIST, 'api/ping.php'))) {
  console.error(`✖ ${DIST} is not a built server folder (index.html + api/ping.php expected)`);
  process.exit(2);
}

const stage = path.join(path.dirname(ZIP), '.package-stage');
fs.rmSync(stage, { recursive: true, force: true });
fs.mkdirSync(stage, { recursive: true });

// The server's runtime folders ship only what their own .gitignore whitelists: never a child's uploaded journal
// photo (uploads/journal/…) or anything the server wrote into data/ — even after `php -S … -t dist/metaverse`.
const RUNTIME_KEEP = { data: ['.gitignore', '.htaccess', 'index.php', 'game-data.json'], uploads: ['.gitignore', '.htaccess', 'index.html'] };
// p is matched with '/' separators (also on Windows, where cpSync passes '\' paths)
const shipped = (abs, base) => {
  const p = path.relative(base, abs).split(path.sep).join('/');
  if (p === '') return true;
  const rt = /^(data|uploads)\/([^/]+)/.exec(p);
  if (rt && !RUNTIME_KEEP[rt[1]].includes(rt[2])) return false;
  // skip deps/caches, composer vendor folders, runtime DBs/logs/secrets/locks, and every hidden file or folder
  // (tool state such as .omc/, .claude/) except the .htaccess / .gitignore guards that the server folders need
  return !/(^|\/)(node_modules|test-output|vendor)(\/|$)/.test(p)
    && !/(^|\/)\.(?!htaccess$|gitignore$)[^/]+(\/|$)/.test(p)
    && !/\.sqlite(-wal|-shm|-journal)?$|\/(logs|sessions|backups)\/|\/secret\.php$|config\.local\.php$|install\.lock$|\.lock$|\.tmp$/.test(p);
};
const copy = (srcAbs, dst) => {
  if (!fs.existsSync(srcAbs)) return;
  fs.cpSync(srcAbs, path.join(stage, dst), { recursive: true, filter: (s) => shipped(s, srcAbs) });
};
copy(DIST, 'metaverse');
fs.copyFileSync(path.join(DIST, 'index.html'), path.join(stage, '전통발효체험관.html'));
for (const f of ['README.md', 'package.json', 'package-lock.json', '.gitignore']) copy(path.join(ROOT, f), f);
for (const d of ['docs', 'src', 'tools', 'tests', 'server']) copy(path.join(ROOT, d), d);
// the three.js esbuild entry is source (not a composer folder): ship it explicitly
if (fs.existsSync(path.join(ROOT, 'vendor/three-entry.js'))) { fs.mkdirSync(path.join(stage, 'vendor'), { recursive: true }); fs.copyFileSync(path.join(ROOT, 'vendor/three-entry.js'), path.join(stage, 'vendor/three-entry.js')); }

fs.mkdirSync(path.dirname(ZIP), { recursive: true });
fs.rmSync(ZIP, { force: true });
run('zip', ['-r', '-q', '-X', ZIP, '.'], { cwd: stage });
fs.rmSync(stage, { recursive: true, force: true });

// ---------------------------------------------------------------- verify the archive (CONTRACT §14.10)
const list = execFileSync('unzip', ['-Z1', ZIP], { encoding: 'utf8' }).split('\n').filter(Boolean);
const must = ['전통발효체험관.html', 'metaverse/index.html', 'metaverse/install.php', 'metaverse/admin.php', 'metaverse/.htaccess', 'metaverse/api/ping.php',
  'metaverse/api/sub/status.php', 'metaverse/database/schema.sql', 'metaverse/database/schema.sqlite.sql', 'metaverse/lib/compat.php',
  'metaverse/lib/pii-rules.json', 'metaverse/data/game-data.json', 'metaverse/data/.htaccess', 'metaverse/cli/tfm.php', 'docs/SERVER-INSTALL-KO.md', 'README.md', 'server/README-SERVER.md'];
const missing = must.filter((m) => !list.includes(m));
const forbidden = list.filter((p) => /\.sqlite(-wal|-shm|-journal)?$|install\.lock$|config\.local\.php$|\/secret\.php$|\/(sessions|logs|backups)\/|\/vendor\/(?!three-entry\.js$)|\/uploads\/journal\/|\/node_modules\//.test(p));
const size = fs.statSync(ZIP).size;
if (missing.length || forbidden.length) {
  if (missing.length) console.error('✖ missing from the zip: ' + missing.join(', '));
  if (forbidden.length) console.error('✖ must not ship: ' + forbidden.slice(0, 20).join(', '));
  process.exit(1);
}
console.log(`✔ ${path.relative(ROOT, ZIP) || ZIP} (${(size / 1024 / 1024).toFixed(2)} MB, ${list.length} entries) — install.php · schema.sql · .htaccess · SERVER-INSTALL-KO.md present; no sqlite / lock / local config / sessions / logs / vendor`);
