#!/usr/bin/env node
// =============================================================================
// Release packager:  node tools/package.mjs
//   1) strict release build  -> dist/metaverse/ (index.html + PHP server files)
//   2) zip                   -> release/fermentation-metaverse.zip
//        metaverse/            ready to run (double-click index.html, or drop into XAMPP htdocs)
//        전통발효체험관.html     same single file at the top level for convenience
//        README.md, docs/, src/, tools/, vendor/, tests/, package.json  (source for developers)
// =============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { cwd: ROOT, stdio: 'inherit', ...opts });

run('node', ['tools/build.mjs', '--strict']);

const stage = path.join(ROOT, '.cache', 'package');
fs.rmSync(stage, { recursive: true, force: true });
fs.mkdirSync(stage, { recursive: true });

// The server's runtime folders ship only what their own .gitignore whitelists: never a child's uploaded journal
// photo (uploads/journal/…) or anything the server wrote into data/ — even after `php -S … -t dist/metaverse`.
const RUNTIME_KEEP = { data: ['.gitignore', '.htaccess', 'index.php', 'game-data.json'], uploads: ['.gitignore', '.htaccess', 'index.html'] };
// p is matched relative to the repo with '/' separators (also on Windows, where cpSync passes '\' paths)
const shipped = (abs) => {
  const p = path.relative(ROOT, abs).split(path.sep).join('/');
  const rt = /^(?:dist\/metaverse|server)\/(data|uploads)\/([^/]+)/.exec(p);
  if (rt && !RUNTIME_KEEP[rt[1]].includes(rt[2])) return false;
  // skip deps/caches, runtime DBs/logs/secrets, and every hidden file or folder (tool state such as .omc/, .claude/)
  // except the .htaccess / .gitignore guards that the server folders need
  return !/(^|\/)(node_modules|test-output)(\/|$)/.test(p)
    && !/(^|\/)\.(?!htaccess$|gitignore$)[^/]+(\/|$)/.test(p)
    && !/\.sqlite(-wal|-shm|-journal)?$|\/(logs|sessions|backups)\/|\/secret\.php$|config\.local\.php$/.test(p);
};
const copy = (src, dst) => {
  const s = path.join(ROOT, src);
  if (!fs.existsSync(s)) return;
  fs.cpSync(s, path.join(stage, dst ?? src), { recursive: true, filter: shipped });
};
copy('dist/metaverse', 'metaverse');
fs.copyFileSync(path.join(ROOT, 'dist/metaverse/index.html'), path.join(stage, '전통발효체험관.html'));
for (const f of ['README.md', 'package.json', 'package-lock.json', '.gitignore']) copy(f);
for (const d of ['docs', 'src', 'tools', 'vendor', 'tests', 'server']) copy(d);

fs.mkdirSync(path.join(ROOT, 'release'), { recursive: true });
const zipPath = path.join(ROOT, 'release', 'fermentation-metaverse.zip');
fs.rmSync(zipPath, { force: true });
run('zip', ['-r', '-q', '-X', zipPath, '.'], { cwd: stage });
const size = fs.statSync(zipPath).size;
console.log(`✔ ${path.relative(ROOT, zipPath)} (${(size / 1024 / 1024).toFixed(2)} MB)`);
