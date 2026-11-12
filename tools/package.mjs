#!/usr/bin/env node
// =============================================================================
// Release packager:  node tools/package.mjs [--dist <built folder>] [--out <zip>] [--no-build] [--dry-run] [--list]
//   1) strict release build  -> dist/metaverse/ (index.html + PHP server files)       (skipped with --no-build / --dist)
//   2) zip                   -> release/fermentation-metaverse.zip
//        metaverse/            ready to run (double-click index.html, or drop into XAMPP htdocs → open install.php)
//        전통발효체험관.html     same single file at the top level for convenience
//        README.md, docs/ (incl. SERVER-INSTALL-KO.md), src/, tools/, server/, vendor/three-entry.js, package.json  (source)
//   Never shipped: tests/ (developer test suites — the e2e scripts, PII vectors and tests/server-unit.php, which is
//   PHP 8 dev tooling and not a PHP 7.2 compatibility proof), data/*.sqlite(+wal/shm), data/install.lock,
//   config/config.local.php, data/secret.php, sessions/, logs/, backups/, uploads/journal/*, any composer vendor/ folder
//   (only the three.js entry vendor/three-entry.js, which is source), node_modules/, hidden tool state.
//   The zip is verified after writing (required entries present, forbidden ones absent).
//
//   --dry-run   stage and verify exactly what would ship, print the summary (and every path with --list), write no zip.
//               Use with --dist <built folder> to check a server copy without building into dist/.
// =============================================================================
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name, def = null) => { const i = args.indexOf(name); return i >= 0 && i + 1 < args.length ? args[i + 1] : def; };
const run = (cmd, a, opts = {}) => execFileSync(cmd, a, { cwd: ROOT, stdio: 'inherit', ...opts });
const DRY = args.includes('--dry-run');
/** a path for the log: relative inside the repo, absolute outside it */
const show = (p) => (p === ROOT || p.startsWith(ROOT + path.sep) ? path.relative(ROOT, p) || '.' : p);
const LIST = args.includes('--list');

const DIST = path.resolve(opt('--dist', path.join(ROOT, 'dist/metaverse')));
const ZIP = path.resolve(opt('--out', path.join(ROOT, 'release', 'fermentation-metaverse.zip')));
if (!args.includes('--no-build') && !opt('--dist')) run('node', ['tools/build.mjs', '--strict']);
if (!fs.existsSync(path.join(DIST, 'index.html')) || !fs.existsSync(path.join(DIST, 'api/ping.php'))) {
  console.error(`✖ ${DIST} is not a built server folder (index.html + api/ping.php expected)`);
  process.exit(2);
}

// a dry run stages in the temp dir (nothing is written next to --out)
const stage = DRY ? fs.mkdtempSync(path.join(os.tmpdir(), 'tfm-package-')) : path.join(path.dirname(ZIP), '.package-stage');
fs.rmSync(stage, { recursive: true, force: true });
fs.mkdirSync(stage, { recursive: true });

// The server's runtime folders ship only what their own .gitignore whitelists: never a child's uploaded journal
// photo (uploads/journal/…) or anything the server wrote into data/ — even after `php -S … -t dist/metaverse`.
const RUNTIME_KEEP = { data: ['.gitignore', '.htaccess', 'index.php', 'game-data.json'], uploads: ['.gitignore', '.htaccess', 'index.html'] };
/** why a path is left out (null = it ships); p is relative to the copied folder, with '/' separators (also on Windows) */
const skipReason = (p) => {
  const rt = /^(data|uploads)\/([^/]+)/.exec(p);
  if (/(^|\/)node_modules(\/|$)/.test(p)) return 'node_modules/';
  if (/(^|\/)vendor(\/|$)/.test(p)) return 'composer vendor/';
  if (/(^|\/)test-output(\/|$)/.test(p)) return 'test-output/';
  // hidden files and folders (tool state such as .omc/, .claude/) — except the .htaccess / .gitignore guards and the
  // .user.ini that caps PHP upload sizes per folder (PHP-FPM / CGI read it; CONTRACT §15.7 #14)
  if (/(^|\/)\.(?!htaccess$|gitignore$|user\.ini$)[^/]+(\/|$)/.test(p)) return 'hidden tool state';
  if (/\.sqlite(-wal|-shm|-journal)?$/.test(p)) return '*.sqlite';
  if (/install\.lock$/.test(p)) return 'install.lock';
  if (/config\.local\.php$/.test(p)) return 'config.local.php';
  if (/(^|\/)secret\.php$/.test(p)) return 'secret.php';
  if (/(^|\/)sessions(\/|$)/.test(p)) return 'sessions/';
  if (/(^|\/)logs(\/|$)/.test(p)) return 'logs/';
  if (/(^|\/)backups(\/|$)/.test(p)) return 'backups/';
  if (/\.lock$|\.tmp$/.test(p)) return '*.lock / *.tmp';
  if (rt && !RUNTIME_KEEP[rt[1]].includes(rt[2])) return rt[1] === 'uploads' ? 'uploads/ (children\'s photos)' : 'data/ runtime files';
  return null;
};
const skipped = new Map(); // reason -> [paths]
const copy = (srcAbs, dst) => {
  if (!fs.existsSync(srcAbs)) return;
  fs.cpSync(srcAbs, path.join(stage, dst), {
    recursive: true,
    filter: (s) => {
      const p = path.relative(srcAbs, s).split(path.sep).join('/');
      if (p === '') return true;
      const why = skipReason(p);
      if (why) { if (!skipped.has(why)) skipped.set(why, []); skipped.get(why).push(`${dst}/${p}`); }
      return !why;
    },
  });
};
copy(DIST, 'metaverse');
fs.copyFileSync(path.join(DIST, 'index.html'), path.join(stage, '전통발효체험관.html'));
for (const f of ['README.md', 'package.json', 'package-lock.json', '.gitignore']) copy(path.join(ROOT, f), f);
// source copies; tests/ is developer tooling and never ships (CONTRACT §14.10: no test suites in the release)
for (const d of ['docs', 'src', 'tools', 'server']) copy(path.join(ROOT, d), d);
// the three.js esbuild entry is source (not a composer folder): ship it explicitly
if (fs.existsSync(path.join(ROOT, 'vendor/three-entry.js'))) { fs.mkdirSync(path.join(stage, 'vendor'), { recursive: true }); fs.copyFileSync(path.join(ROOT, 'vendor/three-entry.js'), path.join(stage, 'vendor/three-entry.js')); }
const testsLeftOut = fs.existsSync(path.join(ROOT, 'tests')) ? walk(path.join(ROOT, 'tests')).length : 0;

/** every file below dir, relative, '/' separated */
function walk(dir, base = dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) walk(abs, base, out);
    else out.push(path.relative(base, abs).split(path.sep).join('/'));
  }
  return out;
}

// ---------------------------------------------------------------- what ships (CONTRACT §14.10)
// metaverse/admin.php is the 404 stub of the phase-6 address (copying a release over an old install replaces the old page);
// the admin site itself is the admin/ folder (CONTRACT §15.4 — the operator may rename it after installing)
const MUST = ['전통발효체험관.html', 'metaverse/index.html', 'metaverse/install.php', 'metaverse/admin.php', 'metaverse/admin/index.php', 'metaverse/admin/.htaccess',
  'metaverse/admin/admin.css', 'metaverse/lib/Totp.php', 'metaverse/cli/admin-path.php', 'metaverse/.htaccess', 'metaverse/.user.ini', 'metaverse/api/ping.php',
  'metaverse/api/sub/status.php', 'metaverse/database/schema.sql', 'metaverse/database/schema.sqlite.sql', 'metaverse/lib/compat.php',
  'metaverse/lib/pii-rules.json', 'metaverse/data/game-data.json', 'metaverse/data/.htaccess', 'metaverse/cli/tfm.php', 'docs/SERVER-INSTALL-KO.md', 'README.md', 'server/README-SERVER.md'];
/** a shipped path that must never be in the release (secrets, locks, databases, sessions, logs, test suites, deps) */
const FORBIDDEN = (p) => /^tests\//.test(p)
  || /\.sqlite(-wal|-shm|-journal)?$|install\.lock$|config\.local\.php$|(^|\/)secret\.php$/.test(p)
  || /(^|\/)(sessions|logs|backups|node_modules)\//.test(p)
  || (/(^|\/)vendor\//.test(p) && p !== 'vendor/three-entry.js')
  || /(^|\/)uploads\/journal\//.test(p);
function verify(list) {
  const files = list.filter((p) => !p.endsWith('/'));
  const missing = MUST.filter((m) => !files.includes(m));
  const forbidden = files.filter(FORBIDDEN);
  return { files, missing, forbidden };
}
function report(files) {
  const top = new Map();
  for (const p of files) { const k = p.includes('/') ? p.slice(0, p.indexOf('/') + 1) : p; top.set(k, (top.get(k) || 0) + 1); }
  console.log(`  ships ${files.length} files: ${[...top].map(([k, n]) => `${k} ${n}`).join(' · ')}`);
  console.log(`  required: ${MUST.map((m) => `${files.includes(m) ? '✔' : '✖'} ${m}`).join('  ')}`);
  console.log(`  not shipped: tests/ (${testsLeftOut} files: developer suites; tests/server-unit.php is PHP 8 dev tooling)`
    + (skipped.size ? ' · ' + [...skipped].map(([why, ps]) => `${why} ${ps.length} (${ps.slice(0, 2).join(', ')}${ps.length > 2 ? ', …' : ''})`).join(' · ') : ''));
  if (LIST) for (const p of files) console.log(`    ${p}`);
}

if (DRY) {
  const { files, missing, forbidden } = verify(walk(stage));
  fs.rmSync(stage, { recursive: true, force: true });
  console.log(`▶ dry run — ${show(DIST)} → would write ${show(ZIP)} (nothing written)`);
  report(files);
  if (missing.length || forbidden.length) {
    if (missing.length) console.error('✖ missing: ' + missing.join(', '));
    if (forbidden.length) console.error('✖ must not ship: ' + forbidden.slice(0, 20).join(', '));
    process.exit(1);
  }
  console.log('✔ dry run: install.php · schema.sql · .htaccess · SERVER-INSTALL-KO.md present; no tests/ · vendor/ · sqlite · install.lock · config.local.php · sessions · logs');
  process.exit(0);
}

fs.mkdirSync(path.dirname(ZIP), { recursive: true });
fs.rmSync(ZIP, { force: true });
run('zip', ['-r', '-q', '-X', ZIP, '.'], { cwd: stage });
fs.rmSync(stage, { recursive: true, force: true });

// ---------------------------------------------------------------- verify the archive
const { files, missing, forbidden } = verify(execFileSync('unzip', ['-Z1', ZIP], { encoding: 'utf8' }).split('\n').filter(Boolean));
const size = fs.statSync(ZIP).size;
report(files);
if (missing.length || forbidden.length) {
  if (missing.length) console.error('✖ missing from the zip: ' + missing.join(', '));
  if (forbidden.length) console.error('✖ must not ship: ' + forbidden.slice(0, 20).join(', '));
  process.exit(1);
}
console.log(`✔ ${show(ZIP)} (${(size / 1024 / 1024).toFixed(2)} MB, ${files.length} files) — install.php · schema.sql · .htaccess · SERVER-INSTALL-KO.md present; no tests/ · sqlite · lock · local config · sessions · logs · vendor`);
