#!/usr/bin/env node
/**
 * tools/exposure-audit.mjs — CONTRACT §15.7 #19: no private file of the server can be read over the web.
 *
 *   node tools/exposure-audit.mjs [--docroot <dir>] [--apache] [--json out.json] [--port 18772] [--apache-port 18778] [--keep]
 *
 * 1. Copies the built server tree (default dist/metaverse) to a temp folder with data/ INSIDE the web root (like a
 *    plain XAMPP copy), lets the server create its real private files (api/ping.php → data/secret.php, the SQLite
 *    database, a session; cli setup-code → data/setup-code.php) and plants typical leftovers of a careless deployment
 *    (config.local.php, .env, *.bak / *.old / *~ / *.save copies, dumps, logs, notes, archives, .git/, .svn/, IDE folders,
 *    composer / package files, backups, a PHP file in uploads/) — each with a unique marker text.
 * 2. Lists every file and folder of the copy and classifies it: private (lib/ config/ database/ data/ cli/ admin/parts/,
 *    *.sqlite* *.sql *.log *.md *.lock *.ini *.env *.bak …, config.local.php, secret.php, setup-code.php, sessions,
 *    backups, logs, .htaccess, .user.ini, composer / package files, hidden folders, archives, editor copies) or public.
 * 3. Requests every path:
 *    --apache  Apache 2.4 + mod_php with the shipped .htaccess files (AllowOverride All, `Options Indexes` like XAMPP's
 *              htdocs): every private path must answer 403 / 404 without its content, folders must not be listed →
 *              exit 1 otherwise; each failure names the .htaccess rule that would close it.
 *    php -S    (always) the PHP built-in server ignores .htaccess, like nginx without the README rules: it reports which
 *              private files such a server would hand out (information), and checks what PHP itself must guarantee —
 *              no PHP file outside the entry points prints anything when requested directly, and every secret lives in a
 *              PHP-guarded file (exit 1 otherwise).
 * CONTRACT §16.9: the shared cache (data/cache/<2 hex>/<sha1>.php — account rows, channel members, counters) is created
 * by the first requests and checked like the other secrets: every entry is a PHP file with the exit guard and is denied
 * under Apache. The precompressed copies of the page (index.br.html / index.gz.html) are public by design, like
 * index.html; data/page.json (which page they belong to) sits in the private data/ folder.
 * Read only for the repository; temp files are removed unless --keep.
 */
import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const optv = (n) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : null; };
const DOCROOT = path.resolve(optv('--docroot') || path.join(ROOT, 'dist/metaverse'));
const APACHE = argv.includes('--apache');
const KEEP = argv.includes('--keep');
const JSON_OUT = optv('--json');
const PHP_PORT = Number(optv('--port') || 18772);
const APACHE_PORT = Number(optv('--apache-port') || 18778);
const APACHE_MODULES = '/usr/lib/apache2/modules';
const RUN = crypto.randomBytes(4).toString('hex');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rel = (p) => p.split(path.sep).join('/');

if (!fs.existsSync(path.join(DOCROOT, 'api/ping.php'))) { console.error(`✖ ${DOCROOT} is not a server tree (no api/ping.php)`); process.exit(2); }

// ------------------------------------------------------------------ the copy
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'tfm-expo-'));
fs.chmodSync(TMP, 0o755);
const WEB = path.join(TMP, 'htdocs');
fs.cpSync(DOCROOT, WEB, { recursive: true });
for (const f of ['config/config.local.php', 'data/secret.php', 'data/install.lock', 'data/setup-code.php']) fs.rmSync(path.join(WEB, f), { force: true });
const MARK = (name) => `TFMEXPO-${RUN}-${name}`;
/** [path, content] — a unique marker in each, so a body that carries it proves the file was served */
// config.local.php: the guard Installer::mergeLocalConfig writes (a direct hit is a 404 without the PHP version banner)
const PLANT = [
  ['config/config.local.php', `<?php\nif (!defined('TFM_BOOT')) { if (function_exists('header_remove')) header_remove('X-Powered-By'); http_response_code(404); exit; }\nreturn ['db' => ['mysql' => ['password' => '${MARK('configlocal')}']]];\n`],
  ['config/config.local.php.bak', `${MARK('configlocalbak')}\n`], ['config/config.php~', `<?php // ${MARK('configtilde')}\n`],
  ['.env', `DB_PASSWORD=${MARK('env')}\n`], ['.env.production', `SECRET=${MARK('envprod')}\n`], ['config.php.bak', `<?php $pw = '${MARK('bak')}';\n`],
  ['backup.sql', `-- ${MARK('sql')}\n`], ['dump.sql.gz', `${MARK('sqlgz')}`], ['debug.log', `${MARK('log')}\n`], ['error_log', `${MARK('errorlog')}\n`],
  ['NOTES.md', `# ${MARK('md')}\n`], ['README.txt.old', `${MARK('old')}\n`], ['index.html.orig', `${MARK('orig')}\n`],
  ['composer.json', `{"${MARK('composer')}":1}`], ['composer.lock', `{"${MARK('composerlock')}":1}`], ['package.json', `{"name":"${MARK('package')}"}`],
  ['package-lock.json', `{"name":"${MARK('packagelock')}"}`], ['php.ini', `; ${MARK('ini')}\n`], ['.user.ini', `; ${MARK('userini')}\n`],
  ['.git/config', `[core]\n\t${MARK('git')}\n`], ['.git/HEAD', `ref: refs/heads/${MARK('githead')}\n`], ['.svn/entries', `${MARK('svn')}\n`],
  ['.idea/workspace.xml', `<x>${MARK('idea')}</x>`], ['.vscode/settings.json', `{"${MARK('vscode')}":1}`], ['.DS_Store', `${MARK('dsstore')}`],
  ['backup.zip', `PK\x03\x04${MARK('zip')}`], ['site.tar.gz', `${MARK('targz')}`], ['site.tgz', `${MARK('tgz')}`], ['site.7z', `${MARK('7z')}`], ['site.rar', `${MARK('rar')}`],
  ['install.php~', `<?php // ${MARK('tilde')}\n`], ['admin.php.save', `<?php // ${MARK('save')}\n`], ['admin.php.swp', `${MARK('swp')}`], ['index.php.tmp', `${MARK('tmp')}`],
  ['lib/docs/HANDOVER.md', `# ${MARK('libdoc')}\n`], ['database/extra.sql', `-- ${MARK('dbsql')}\n`],
  ['data/backups/tfm-20261112-0000-a1b2c3d4e5f6.sqlite', `SQLite format 3\0${MARK('backup')}`], ['data/logs/extra.log', `${MARK('datalog')}\n`],
  ['data/sessions/sess_tfmexpo', `_tfm|a:1:{s:3:"uid";s:${MARK('session').length}:"${MARK('session')}";}`], ['data/install.lock', `installed ${MARK('lock')}\n`],
  ['data/notes.txt', `${MARK('datatxt')}\n`], ['uploads/shell.php', `<?php echo '${MARK('upload')}-' . 'RAN';\n`], ['uploads/note.html', `<p>${MARK('uploadhtml')}</p>`],
  ['uploads/journal/2026/11/aaaaaaaabbbbbbbbccccccccdddddddd.png', `\x89PNG\r\n\x1a\n${MARK('png')}`],
];
for (const [p, c] of PLANT) { fs.mkdirSync(path.dirname(path.join(WEB, p)), { recursive: true }); fs.writeFileSync(path.join(WEB, p), c); }
const MARKERS = new Map(PLANT.map(([p, c]) => [p, (c.match(/TFMEXPO-[0-9a-f]+-[a-z0-9]+/) || [''])[0]]));

// ------------------------------------------------------------------ classification
const PRIVATE_DIR = /^(?:lib|config|database|data|cli|admin\/parts)(?:\/|$)/;
const PRIVATE_EXT = /\.(?:sqlite3?|sqlite-wal|sqlite-shm|sqlite-journal|db|sql|gz|tgz|zip|tar|7z|rar|bz2|xz|log|md|lock|ini|env|bak|old|orig|save|swp|swo|tmp|dist|yml|yaml|sh|bat|ps1)$/i;
const PRIVATE_NAME = /(?:^|\/)(?:config\.local\.php|secret\.php|setup-code\.php|\.htaccess|\.htpasswd|\.user\.ini|composer\.(?:json|lock)|package(?:-lock)?\.json|error_log|\.DS_Store|Thumbs\.db)$|~$|\.env(?:\.[a-z]+)?$/i;
const HIDDEN = /(?:^|\/)\.(?!well-known\/)[^/]+/;
function classify(p, isDir) {
  if (p === '' ) return { private: false, why: '' };
  if (HIDDEN.test(p)) return { private: true, why: 'hidden file / folder' };
  if (PRIVATE_DIR.test(p)) return { private: true, why: `private folder ${p.split('/')[0]}/` };
  if (!isDir && PRIVATE_NAME.test(p)) return { private: true, why: 'private file name' };
  if (!isDir && PRIVATE_EXT.test(p)) return { private: true, why: 'private file type' };
  if (/^uploads\//.test(p) && !isDir && !/^uploads\/journal\/\d{4}\/\d{2}\/[a-f0-9]{32}\.(?:jpe?g|png|webp)$/i.test(p) && !/^uploads\/index\.html$/.test(p)) return { private: true, why: 'uploads: only re-encoded images may be served' };
  return { private: false, why: '' };
}
/** the .htaccess rule that would close a path the Apache run found open */
function ruleFor(p, isDir) {
  if (isDir) return 'Options -Indexes (root .htaccess and every folder .htaccess)';
  if (HIDDEN.test(p)) return 'root .htaccess: RedirectMatch 404 "(^|/)\\.(?!well-known/)"  (hidden folders such as .git/ .svn/ .idea/: FilesMatch only sees the file name)';
  if (/^uploads\//.test(p)) return 'uploads/.htaccess: <FilesMatch ".*"> Require all denied </FilesMatch> + the image-name exception (and php_flag engine off)';
  if (PRIVATE_DIR.test(p)) return `${p.split('/')[0]}/.htaccess: Require all denied (the folder needs its own deny file)`;
  if (/~$|\.(?:save|swp|swo|tmp|orig|old|bak)$/i.test(p)) return 'root .htaccess FilesMatch: add  ~$|\\.(save|swp|swo|tmp|orig|old|bak)$  (editor / backup copies)';
  if (/\.(?:gz|tgz|zip|tar|7z|rar|bz2|xz)$/i.test(p)) return 'root .htaccess FilesMatch: add  \\.(zip|tar|gz|tgz|7z|rar|bz2|xz)$  (archives)';
  if (/error_log$|\.DS_Store$|Thumbs\.db$/i.test(p)) return 'root .htaccess FilesMatch: add  ^(error_log|\\.DS_Store|Thumbs\\.db)$';
  if (/\.env(?:\.[a-z]+)?$/i.test(p)) return 'root .htaccess FilesMatch: add  ^\\.env(\\..+)?$';
  return 'root .htaccess FilesMatch: add this file name / type to the denied list';
}

// ------------------------------------------------------------------ servers
const canConnect = (port) => new Promise((res) => { const c = net.connect(port, '127.0.0.1'); c.once('connect', () => { c.destroy(); res(true); }); c.once('error', () => res(false)); });
const portFree = (port) => new Promise((res) => { const t = net.createServer(); t.once('error', () => res(false)); t.listen(port, '127.0.0.1', () => t.close(() => res(true))); });
const CHILD = [];
async function startPhp() {
  if (!(await portFree(PHP_PORT))) throw new Error(`port ${PHP_PORT} is in use (--port)`);
  const p = spawn('php', ['-d', 'display_errors=1', '-d', 'expose_php=1', '-S', `127.0.0.1:${PHP_PORT}`, '-t', WEB], { stdio: ['ignore', 'ignore', 'pipe'], env: { PATH: process.env.PATH, TFM_TOSS_MOCK: '1' } });
  CHILD.push(p);
  for (let i = 0; i < 80 && !(await canConnect(PHP_PORT)); i++) await sleep(75);
  return `http://127.0.0.1:${PHP_PORT}/`;
}
async function startApache() {
  if (spawnSync('apache2', ['-v']).status !== 0) return { unavailable: 'apache2 is not installed' };
  const phpSo = fs.existsSync(APACHE_MODULES) ? fs.readdirSync(APACHE_MODULES).find((f) => /^libphp[\d.]*\.so$/.test(f)) : null;
  if (!phpSo) return { unavailable: `no libphp*.so in ${APACHE_MODULES}` };
  if (!(await portFree(APACHE_PORT))) return { unavailable: `port ${APACHE_PORT} is in use (--apache-port)` };
  const A = path.join(TMP, 'apache');
  for (const d of ['run', 'logs']) fs.mkdirSync(path.join(A, d), { recursive: true });
  let user = '';
  if (process.getuid && process.getuid() === 0) {
    user = ['www-data', 'apache', 'daemon', 'nobody'].find((u) => spawnSync('id', ['-u', u]).status === 0) || '';
    if (!user) return { unavailable: 'running as root without an unprivileged account' };
    spawnSync('chown', ['-R', `${user}:`, path.join(WEB, 'data'), path.join(WEB, 'uploads'), A]);
  }
  const mod = (id, file) => `LoadModule ${id}_module ${APACHE_MODULES}/${file}`;
  const conf = [
    `ServerRoot "${A}"`, `PidFile "${A}/run/httpd.pid"`, `DefaultRuntimeDir "${A}/run"`, `Mutex file:${A}/run default`, `Listen 127.0.0.1:${APACHE_PORT}`, 'ServerName 127.0.0.1',
    mod('mpm_prefork', 'mod_mpm_prefork.so'), mod('authz_core', 'mod_authz_core.so'), mod('authz_host', 'mod_authz_host.so'), mod('dir', 'mod_dir.so'), mod('mime', 'mod_mime.so'),
    mod('autoindex', 'mod_autoindex.so'), mod('env', 'mod_env.so'), mod('setenvif', 'mod_setenvif.so'), mod('headers', 'mod_headers.so'), mod('rewrite', 'mod_rewrite.so'), mod('alias', 'mod_alias.so'), mod('php', phpSo),
    user ? `User ${user}\nGroup ${user}` : '', `ErrorLog "${A}/logs/error.log"`, 'LogLevel warn', 'TypesConfig /etc/mime.types',
    'StartServers 2', 'MinSpareServers 2', 'MaxSpareServers 4', 'MaxRequestWorkers 8', 'KeepAlive Off',
    // XAMPP's htdocs: listings on unless the application turns them off, every .htaccess honoured
    `DocumentRoot "${WEB}"`, `<Directory "${WEB}">\n  AllowOverride All\n  Require all granted\n  Options Indexes FollowSymLinks\n</Directory>`,
    '<FilesMatch "\\.php$">\n  SetHandler application/x-httpd-php\n</FilesMatch>', 'SetEnv TFM_TOSS_MOCK "1"',
  ].filter(Boolean).join('\n') + '\n';
  fs.writeFileSync(path.join(A, 'httpd.conf'), conf);
  const p = spawn('apache2', ['-f', path.join(A, 'httpd.conf'), '-DFOREGROUND'], { stdio: ['ignore', 'pipe', 'pipe'], env: { PATH: process.env.PATH, LANG: 'C' }, detached: true });
  CHILD.push(p);
  let out = '';
  p.stdout.on('data', (d) => { out += d; });
  p.stderr.on('data', (d) => { out += d; });
  let up = false;
  for (let i = 0; i < 80 && !up; i++) { if (p.exitCode !== null) break; up = await canConnect(APACHE_PORT); if (!up) await sleep(75); }
  if (!up) return { unavailable: `apache2 did not start: ${out.slice(0, 200)}` };
  return { base: `http://127.0.0.1:${APACHE_PORT}/`, log: path.join(A, 'logs/error.log') };
}
async function stopAll() {
  for (const p of CHILD) { if (p.exitCode === null) { try { process.kill(p.pid, 'SIGTERM'); } catch { /* gone */ } await Promise.race([new Promise((r) => p.once('exit', r)), sleep(4000)]); } }
}
async function get(base, p) {
  const url = base + p.split('/').map(encodeURIComponent).join('/');
  try {
    // identity: the bytes as they are on disk (the page has precompressed copies, CONTRACT §16.9 — nothing is to be decoded here)
    const r = await fetch(url, { redirect: 'manual', headers: { Accept: '*/*', 'Accept-Encoding': 'identity', 'User-Agent': 'tfm-exposure-audit/1.0' } });
    const buf = Buffer.from(await r.arrayBuffer());
    return { status: r.status, body: buf.toString('latin1'), len: buf.length, type: r.headers.get('content-type') || '', poweredBy: r.headers.get('x-powered-by') || '' };
  } catch (e) { return { status: 0, body: '', len: 0, type: '', error: e.message }; }
}

// ------------------------------------------------------------------ run
const report = { docroot: DOCROOT, run: RUN, php: { open: [], phpOutput: [], unguarded: [], versionHeader: [] }, apache: { mode: APACHE ? 'requested' : 'not requested', open: [], listings: [], rules: [] }, paths: 0 };
let exitCode = 0;
try {
  const phpBase = await startPhp();
  // let the server create its own private files: secret.php, the SQLite database, a session, the setup code
  await get(phpBase, 'api/ping.php');
  spawnSync('php', [path.join(WEB, 'cli/tfm.php'), 'setup-code'], { env: { PATH: process.env.PATH }, encoding: 'utf8' });
  const secretVals = (() => {
    try { const t = fs.readFileSync(path.join(WEB, 'data/secret.php'), 'utf8'); return [...t.matchAll(/'(?:app_key|data_key)' => '([0-9a-f]{32,})'/g)].map((m) => m[1]); } catch { return []; }
  })();
  // every file and folder of the copy
  const files = [];
  const dirs = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const abs = path.join(d, e.name);
      const r = rel(path.relative(WEB, abs));
      if (e.isDirectory()) { dirs.push(r); walk(abs); } else files.push(r);
    }
  })(WEB);
  report.paths = files.length + dirs.length;
  const leaks = (res, p) => {
    const m = MARKERS.get(p);
    const own = (() => { try { const t = fs.readFileSync(path.join(WEB, p), 'latin1'); return t.length >= 24 ? t.slice(0, 24) : t; } catch { return ''; } })();
    return (m && res.body.includes(m)) || secretVals.some((v) => res.body.includes(v)) || (own.length >= 12 && res.status === 200 && res.body.startsWith(own));
  };
  // ---- php -S: what a server that ignores .htaccess would hand out; what PHP itself guarantees
  const entry = (p) => /^(?:api\/.+\.php|admin\.php|install\.php|index\.php|admin\/(?!parts\/).+\.php)$/.test(p);
  for (const p of files) {
    const c = classify(p, false);
    const r = await get(phpBase, p);
    if (p.endsWith('.php') && !entry(p) && !/^uploads\//.test(p)) {
      // a library / config / data PHP file must print nothing at all when requested directly
      if (r.len > 0 && r.status !== 404) report.php.phpOutput.push({ path: p, status: r.status, bytes: r.len, sample: r.body.slice(0, 80) });
      else if (r.len > 0 && r.body.trim() !== '') report.php.phpOutput.push({ path: p, status: r.status, bytes: r.len, sample: r.body.slice(0, 80) });
      if (r.poweredBy) report.php.versionHeader.push(p);
      continue;
    }
    if (c.private && r.status === 200 && leaks(r, p)) report.php.open.push({ path: p, why: c.why, bytes: r.len });
  }
  // every secret the server keeps must be a PHP file with the exit guard (served raw it would run and print nothing)
  // everything in the cache folder except what holds no data: the folder's own deny / guard files, the stripe locks and
  // the bust stamp. Records (and a record's temp file before its rename) must be PHP files with the exit guard.
  const cacheEntries = files.filter((f) => /^data\/cache\/.+/.test(f) && !/^data\/cache\/(?:\.htaccess|index\.(?:php|html)|_l\/[0-9a-f]{2}\.lock|bust)$/.test(f));
  report.cacheEntries = cacheEntries.length;
  for (const p of cacheEntries) if (!p.endsWith('.php')) report.php.unguarded.push(p); // a record that is not a guarded PHP file
  for (const p of ['data/secret.php', 'config/config.local.php', 'data/setup-code.php', ...files.filter((f) => /^data\/logs\/.+\.log\.php$/.test(f)), ...cacheEntries.filter((f) => f.endsWith('.php'))]) {
    const abs = path.join(WEB, p);
    if (!fs.existsSync(abs)) continue;
    const t = fs.readFileSync(abs, 'utf8');
    // the guard: PHP code that ends the request before anything else (if (!defined('TFM_BOOT')) … exit; or http_response_code(404); exit;)
    if (!t.startsWith('<?php') || !/^<\?php[\s\S]{0,400}?http_response_code\(404\);\s*exit;/.test(t.slice(0, 600))) report.php.unguarded.push(p);
  }
  // ---- Apache with the shipped .htaccess files
  if (APACHE) {
    const a = await startApache();
    if (a.unavailable) { report.apache.mode = `unavailable: ${a.unavailable}`; console.log(`⚠ Apache run skipped: ${a.unavailable}`); }
    else {
      report.apache.mode = 'Apache 2.4 + mod_php, AllowOverride All, Options Indexes (XAMPP-like)';
      await get(a.base, 'api/ping.php');
      for (const p of files) {
        const c = classify(p, false);
        if (!c.private) continue;
        const r = await get(a.base, p);
        const ran = p === 'uploads/shell.php' && r.body.includes(MARK('upload') + '-RAN');
        if (![403, 404].includes(r.status) || leaks(r, p) || ran) report.apache.open.push({ path: p, why: c.why, status: r.status, bytes: r.len, executed: ran || undefined, rule: ruleFor(p, false) });
      }
      for (const d of ['', ...dirs]) {
        if (HIDDEN.test(d)) continue; // hidden folders are covered by the file checks above
        const r = await get(a.base, d ? d + '/' : '');
        if (r.status === 200 && /<title>Index of|Index of \//i.test(r.body)) report.apache.listings.push({ path: d + '/', rule: ruleFor(d, true) });
      }
      const seen = new Set();
      for (const o of [...report.apache.open, ...report.apache.listings]) if (!seen.has(o.rule)) { seen.add(o.rule); report.apache.rules.push(o.rule); }
    }
  }
} finally {
  await stopAll();
  if (!KEEP) { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* ignore */ } } else console.log(`(kept ${TMP})`);
}

// ------------------------------------------------------------------ report
console.log(`exposure-audit — ${report.paths} paths of ${path.relative(ROOT, DOCROOT) || DOCROOT} (copy with data/ inside the web root, ${PLANT.length} planted leftovers)\n`);
console.log(`php -S (ignores .htaccess — like a server without the deny rules):`);
if (report.php.open.length) {
  console.log(`  INFO  ${report.php.open.length} private file(s) would be handed out by a server that ignores .htaccess (Apache with AllowOverride None, nginx without the README rules):`);
  for (const o of report.php.open) console.log(`        ${o.path}  (${o.why})`);
  console.log('        → keep Apache with AllowOverride All, or move data/ outside the web root (TFM_DATA_DIR), and never leave copies / dumps / notes in the web folder.');
}
for (const o of report.php.phpOutput) console.log(`  FAIL  ${o.path} prints output when requested directly (${o.status}, ${o.bytes} bytes: ${JSON.stringify(o.sample)})`);
for (const p of report.php.unguarded) console.log(`  FAIL  ${p} holds secrets but is not a PHP file with the exit guard`);
if (!report.php.phpOutput.length && !report.php.unguarded.length) console.log(`  ✔ no PHP file outside the entry points prints anything; data/secret.php, config.local.php, setup-code.php, the logs and the ${report.cacheEntries || 0} cache entries are PHP-guarded`);
if (report.php.versionHeader.length) console.log(`  WARN  ${report.php.versionHeader.length} direct-access 404(s) still carry X-Powered-By (the PHP version; php.ini expose_php=On here): header_remove('X-Powered-By') before the 404 of the guard, e.g. ${report.php.versionHeader.slice(0, 3).join(', ')}`);
if (report.php.phpOutput.length || report.php.unguarded.length) exitCode = 1;
if (APACHE) {
  console.log(`\nApache (${report.apache.mode}):`);
  if (/^unavailable/.test(report.apache.mode)) exitCode = exitCode || 0;
  else {
    for (const o of report.apache.open) console.log(`  FAIL  ${o.path} → ${o.status} (${o.bytes} bytes${o.executed ? ', the PHP file RAN' : ''})  [${o.why}]`);
    for (const l of report.apache.listings) console.log(`  FAIL  ${l.path} → folder listing`);
    if (report.apache.rules.length) { console.log('  missing rules:'); for (const r of report.apache.rules) console.log(`    - ${r}`); }
    if (!report.apache.open.length && !report.apache.listings.length) console.log('  ✔ every private path answers 403 / 404 without its content; no folder is listed');
    if (report.apache.open.length || report.apache.listings.length) exitCode = 1;
  }
}
if (JSON_OUT) fs.writeFileSync(path.resolve(JSON_OUT), JSON.stringify(report, null, 1));
console.log(`\n${exitCode ? '✖' : '✔'} exposure-audit${APACHE ? '' : ' (php -S only; add --apache for the .htaccess check)'}`);
process.exit(exitCode);
