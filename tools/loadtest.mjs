#!/usr/bin/env node
/**
 * tools/loadtest.mjs — simulated visitors against a built server copy (CONTRACT §16.9: the evidence behind docs/SCALING-KO.md).
 *
 *   node tools/loadtest.mjs --docroot <server copy> [options]
 *
 *   What a simulated visitor does (mode sync, the phase-8 page): ping → login (obeys 503 LOGIN_BUSY / Retry-After) →
 *   auth/me → player/get → api/sync.php (a full house: waits in the queue with api/queue.php, then enters) → then
 *   it walks at random inside ±135 m and calls api/sync.php when the server's "n" says so (±15 % jitter, token sent,
 *   token refreshed before it runs out, Retry-After obeyed), says something about once a minute (api/chat/send.php),
 *   saves a valid state (cyrb53 checksum, 20–400 KB) when the server's save hint allows, and hides its tab now and then.
 *   Mode legacy is the phase-7 page: presence/update every 1–2 s, chat/list every 3 s, a save every 30 s.
 *   Every visitor has its own address (X-Forwarded-For through security.trusted_proxies = 127.0.0.1), so per-address
 *   limits and the "server PC is never shed" rule behave as they would for real visitors — and its own connections
 *   (keep-alive, two at most, like a browser tab), so a server that ties one worker to every open connection (Apache
 *   with mod_php) is loaded the way real browsers load it.
 *   The report also says how busy the machine was with other work (load average, CPU of other processes): on a shared
 *   machine the latencies are pessimistic, the CPU time per request is the figure to trust.
 *
 *   options
 *     --server apache|php     Apache 2.4 prefork + mod_php (default when apache2 is installed) or `php -S` with workers
 *     --workers 32            MaxRequestWorkers / PHP_CLI_SERVER_WORKERS
 *     --opcache on|off        (default on)
 *     --cache auto|file|apcu|db|off   cache.driver of the instance (default auto) · --apcu-so <file> loads APCu from that file
 *     --driver sqlite|mysql   mysql: TFM_DB_HOST / PORT / USER / PASS from the environment, database tfm_load_<run> (dropped afterwards)
 *     --users 200 --ramp 20 --duration 60     visitors, seconds to bring them in, seconds to run after the ramp
 *     --mode sync|legacy
 *     --max-online N --target-rps N --shed-rps N --login-per-sec N    capacity block of the instance
 *     --hidden 0.2            share of visitors whose tab is hidden at any time
 *     --save-kb 20,400        size range of the saved state
 *     --reconnect-at 30 --reconnect-share 0.5   at second 30 of the run half of the visitors lose their page and come back at once
 *     --keepalive 5           Apache's KeepAliveTimeout in seconds (XAMPP's httpd-default.conf: 5); 0 = KeepAlive Off
 *     --no-save --no-chat     visitors only walk and sync (the cost of the hot path alone)
 *     --port 18860            the instance's port · --keep keeps the temp folder · --json out.json writes the report
 *     --probe                 no load: one visitor, every endpoint 30 times in a row → cost per request (SQL, ms, bytes)
 *
 *   Report: requests per second, per endpoint count / status codes / p50 p95 p99 (ms) / SQL statements per request (the
 *   server's X-Tfm-Stats header, capacity.stats_header) / bytes; bytes per visitor-minute; 429 and 503 counts; queue
 *   waits and order; CPU of the server processes. Read only for the repository.
 */
import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const optv = (n, d = null) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] !== undefined && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };
const flag = (n) => argv.includes(n);
const DOCROOT = path.resolve(optv('--docroot') || path.join(ROOT, 'dist/metaverse'));
const HAVE_APACHE = spawnSync('apache2', ['-v']).status === 0;
const O = {
  server: optv('--server', HAVE_APACHE ? 'apache' : 'php'), workers: Number(optv('--workers', 32)), opcache: optv('--opcache', 'on') !== 'off',
  cache: optv('--cache', 'auto'), apcuSo: optv('--apcu-so'), driver: optv('--driver', 'sqlite'), users: Number(optv('--users', 200)), ramp: Number(optv('--ramp', 20)),
  duration: Number(optv('--duration', 60)), mode: optv('--mode', 'sync'), maxOnline: optv('--max-online'), targetRps: optv('--target-rps'), shedRps: optv('--shed-rps'),
  loginPerSec: optv('--login-per-sec'), hidden: Number(optv('--hidden', 0.2)), saveKb: (optv('--save-kb', '20,400')).split(',').map(Number), reconnectAt: optv('--reconnect-at') ? Number(optv('--reconnect-at')) : null,
  reconnectShare: Number(optv('--reconnect-share', 0.5)), port: Number(optv('--port', 18860)), keep: flag('--keep'), json: optv('--json'), probe: flag('--probe'), label: optv('--label', ''),
  keepalive: Number(optv('--keepalive', 5)), noSave: flag('--no-save'), noChat: flag('--no-chat'),
};
if (!fs.existsSync(path.join(DOCROOT, 'api/ping.php'))) { console.error(`✖ ${DOCROOT} is not a server copy (no api/ping.php)`); process.exit(2); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const RUN = crypto.randomBytes(3).toString('hex');
const PASSWORD = 'Ferment2026ok';
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'tfm-load-'));
fs.chmodSync(TMP, 0o755);
const DATA = path.join(TMP, 'data');
fs.mkdirSync(DATA);
const MY = { host: process.env.TFM_DB_HOST || '127.0.0.1', port: Number(process.env.TFM_DB_PORT || 33106), user: process.env.TFM_DB_USER || 'root', pass: process.env.TFM_DB_PASS || '', db: `tfm_load_${RUN}` };

// ------------------------------------------------------------------ the instance
const ENV = {
  TFM_DATA_DIR: DATA, TFM_TOSS_MOCK: '1', TFM_STATS_HEADER: '1', TFM_TRUSTED_PROXIES: '127.0.0.1', TFM_FORCE_HTTPS: 'off', TFM_CACHE_DRIVER: O.cache,
  ...(O.maxOnline !== null ? { TFM_MAX_ONLINE: String(O.maxOnline) } : {}), ...(O.targetRps !== null ? { TFM_TARGET_RPS: String(O.targetRps) } : {}),
  ...(O.shedRps !== null ? { TFM_SHED_RPS: String(O.shedRps) } : {}), ...(O.loginPerSec !== null ? { TFM_LOGIN_PER_SEC: String(O.loginPerSec) } : {}),
  ...(O.driver === 'mysql' ? { TFM_DB_DRIVER: 'mysql', TFM_DB_HOST: MY.host, TFM_DB_PORT: String(MY.port), TFM_DB_NAME: MY.db, TFM_DB_USER: MY.user, TFM_DB_PASS: MY.pass } : {}),
};
const CHILDREN = [];
let WEB_USER = '';     // the account Apache's workers run as when this tool runs as root: CLI helpers must write as the same account
function php(code, args = [], extraEnv = {}) {
  return spawnSync('php', ['-r', code, ...args], { env: { ...process.env, ...ENV, ...extraEnv }, encoding: 'utf8', maxBuffer: 64 << 20 });
}
function mysqlRoot(stmts) {
  const r = spawnSync('php', ['-r', `$p = new PDO('mysql:host=${MY.host};port=${MY.port};charset=utf8mb4', getenv('U'), getenv('P'), [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]); foreach (json_decode(getenv('Q'), true) as $q) { $r = $p->query($q); if ($r && $r->columnCount()) echo json_encode($r->fetchAll(PDO::FETCH_NUM)), "\\n"; }`], { env: { ...process.env, U: MY.user, P: MY.pass, Q: JSON.stringify(stmts) }, encoding: 'utf8' });
  if (r.status !== 0) throw new Error('MariaDB: ' + String(r.stderr || r.stdout).slice(0, 300));
  return r.stdout;
}
let cleaned = false;
function cleanup() {
  if (cleaned) return;
  cleaned = true;
  for (const c of CHILDREN) { try { process.kill(c.pid, 'SIGTERM'); } catch { /* gone */ } }
  if (O.driver === 'mysql') { try { mysqlRoot([`DROP DATABASE IF EXISTS \`${MY.db}\``]); } catch { /* ignore */ } }
  if (!O.keep) { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* ignore */ } } else console.log(`(kept ${TMP})`);
}
process.on('exit', cleanup);
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => { cleanup(); process.exit(130); });
const canConnect = (port) => new Promise((res) => { const c = net.connect(port, '127.0.0.1'); c.once('connect', () => { c.destroy(); res(true); }); c.once('error', () => res(false)); });

/** N accounts with one password (hashed once: the hashing cost belongs to the logins of the run, not to the set-up) */
function seed(n) {
  const code = `require $argv[1] . '/lib/bootstrap.php'; $n = (int) $argv[2]; $run = $argv[3]; $h = Tfm\\Users::hashPassword($argv[4]); $now = Tfm\\Clock::ms();
    Tfm\\Db::tx(function () use ($n, $run, $h, $now) { for ($i = 1; $i <= $n; $i++) {
      $id = Tfm\\Db::insert('users', ['email' => "load{$run}_{$i}@example.com", 'nickname' => "L{$run}{$i}", 'nickname_key' => strtolower("L{$run}{$i}"), 'password_hash' => $h, 'role' => 'user', 'status' => 'active', 'muted_until' => 0, 'session_epoch' => 0, 'created_at' => $now, 'updated_at' => $now, 'last_login_at' => $now, 'last_login_ip' => '', 'password_changed_at' => $now]);
      Tfm\\Db::insert('user_profiles', ['user_id' => $id, 'level' => 1, 'exp_total' => 0, 'coin' => 0, 'edu' => 0, 'title' => '', 'updated_at' => $now]);
    } }); echo Tfm\\Db::driver(), ' ', Tfm\\Users::algoName(), ' ', class_exists('Tfm\\\\Cache') ? 'cache ' . Tfm\\Cache::driver() : 'no shared cache';`;
  const r = php(code, [DOCROOT, String(n), RUN, PASSWORD]);
  if (r.status !== 0) throw new Error('seeding failed: ' + String(r.stderr || r.stdout).slice(0, 400));
  return r.stdout.trim();
}
async function startServer() {
  if (await canConnect(O.port)) throw new Error(`port ${O.port} is in use (--port)`);
  if (O.server !== 'apache') {
    const args = ['-d', `opcache.enable=${O.opcache ? 1 : 0}`, '-d', 'opcache.enable_cli=0', ...(O.apcuSo ? ['-d', `extension=${O.apcuSo}`, '-d', 'apc.shm_size=256M'] : []), '-S', `127.0.0.1:${O.port}`, '-t', DOCROOT];
    const p = spawn('php', args, { env: { ...process.env, ...ENV, PHP_CLI_SERVER_WORKERS: String(O.workers) }, stdio: ['ignore', 'ignore', 'ignore'] });
    CHILDREN.push(p);
    for (let i = 0; i < 100 && !(await canConnect(O.port)); i++) await sleep(75);
    return { pid: p.pid, kind: `php -S (${O.workers} workers)` };
  }
  const MOD = '/usr/lib/apache2/modules';
  const phpSo = fs.readdirSync(MOD).find((f) => /^libphp[\d.]*\.so$/.test(f));
  const A = path.join(TMP, 'apache');
  for (const d of ['run', 'logs', 'ini']) fs.mkdirSync(path.join(A, d), { recursive: true });
  // Apache's worker account must be able to walk to the files: serve a copy inside this run's temp folder
  const HTDOCS = path.join(TMP, 'htdocs');
  fs.cpSync(DOCROOT, HTDOCS, { recursive: true, filter: (src) => !/[\\/]data[\\/](cache|sessions|logs|backups)([\\/]|$)/.test(src) && !/\.sqlite(-wal|-shm)?$/.test(src) });
  // php.ini of this instance: the system's file + what the run asks for
  let ini = '';
  try { ini = fs.readFileSync('/etc/php/8.3/apache2/php.ini', 'utf8'); } catch { ini = ''; }
  ini += `\n; tools/loadtest.mjs\nopcache.enable=${O.opcache ? 1 : 0}\nopcache.validate_timestamps=1\nopcache.revalidate_freq=2\nopcache.memory_consumption=128\nmemory_limit=128M\n`;
  if (O.apcuSo) ini += `extension=${O.apcuSo}\napc.enabled=1\napc.shm_size=256M\n`;
  fs.writeFileSync(path.join(A, 'ini/php.ini'), ini);
  let user = '';
  if (process.getuid && process.getuid() === 0) {
    user = ['www-data', 'apache', 'daemon', 'nobody'].find((u) => spawnSync('id', ['-u', u]).status === 0) || '';
    if (user) spawnSync('chown', ['-R', `${user}:`, DATA, A]);
    WEB_USER = user;
  }
  const mod = (id, file) => `LoadModule ${id}_module ${MOD}/${file}`;
  const conf = [
    `ServerRoot "${A}"`, `PidFile "${A}/run/httpd.pid"`, `DefaultRuntimeDir "${A}/run"`, `Mutex file:${A}/run default`, `Listen 127.0.0.1:${O.port}`, 'ServerName 127.0.0.1',
    mod('mpm_prefork', 'mod_mpm_prefork.so'), mod('authz_core', 'mod_authz_core.so'), mod('authz_host', 'mod_authz_host.so'), mod('dir', 'mod_dir.so'), mod('mime', 'mod_mime.so'),
    mod('env', 'mod_env.so'), mod('setenvif', 'mod_setenvif.so'), mod('headers', 'mod_headers.so'), mod('rewrite', 'mod_rewrite.so'), mod('alias', 'mod_alias.so'), mod('php', phpSo),
    user ? `User ${user}\nGroup ${user}` : '', `ErrorLog "${A}/logs/error.log"`, 'LogLevel warn', 'TypesConfig /etc/mime.types', `PHPIniDir "${A}/ini"`,
    // prefork, sized for the run: every worker is one PHP process
    `ServerLimit ${O.workers}`, `StartServers ${Math.min(O.workers, 16)}`, `MinSpareServers ${Math.min(O.workers, 8)}`, `MaxSpareServers ${O.workers}`, `MaxRequestWorkers ${O.workers}`, 'MaxConnectionsPerChild 0',
    O.keepalive > 0 ? `KeepAlive On\nMaxKeepAliveRequests 100\nKeepAliveTimeout ${O.keepalive}` : 'KeepAlive Off', 'ListenBacklog 1024', 'Timeout 30',
    `DocumentRoot "${HTDOCS}"`, `<Directory "${HTDOCS}">\n  AllowOverride All\n  Require all granted\n  Options FollowSymLinks\n</Directory>`,
    '<FilesMatch "\\.php$">\n  SetHandler application/x-httpd-php\n</FilesMatch>',
    ...Object.entries(ENV).map(([k, v]) => `SetEnv ${k} "${v}"`),
  ].filter(Boolean).join('\n') + '\n';
  fs.writeFileSync(path.join(A, 'httpd.conf'), conf);
  const p = spawn('apache2', ['-f', path.join(A, 'httpd.conf'), '-DFOREGROUND'], { stdio: ['ignore', 'ignore', 'ignore'], env: { PATH: process.env.PATH, LANG: 'C' }, detached: true });
  CHILDREN.push(p);
  let up = false;
  for (let i = 0; i < 100 && !up; i++) { up = await canConnect(O.port); if (!up) await sleep(75); }
  if (!up) throw new Error('apache2 did not start: ' + (fs.existsSync(path.join(A, 'logs/error.log')) ? fs.readFileSync(path.join(A, 'logs/error.log'), 'utf8').slice(-400) : ''));
  return { pid: p.pid, kind: `Apache 2.4 prefork + mod_php (${O.workers} workers, ${O.keepalive > 0 ? `keep-alive ${O.keepalive} s` : 'no keep-alive'})` };
}
/** CPU seconds used so far by the server's processes (the parent and its children), from /proc */
function serverCpu(pid) {
  let ticks = 0;
  try {
    for (const d of fs.readdirSync('/proc')) {
      if (!/^\d+$/.test(d)) continue;
      let st;
      try { st = fs.readFileSync(`/proc/${d}/stat`, 'utf8'); } catch { continue; }
      const f = st.slice(st.lastIndexOf(')') + 2).split(' ');
      if (Number(d) === pid || Number(f[1]) === pid) ticks += Number(f[11]) + Number(f[12]);
    }
  } catch { /* not Linux */ }
  return ticks / 100;
}

// ------------------------------------------------------------------ HTTP + measurements
const BASE = `http://127.0.0.1:${O.port}/`;
const sharedAgent = new http.Agent({ keepAlive: true, maxSockets: 8 });   // the tool's own calls (first ping, probe)
// endpoint → {n, st: {code: n}, ok: answers 2xx, lat: [ms of the 2xx answers], sql / srvMs / statN: of the 2xx answers,
//             sqlAll / statAll: of every answer, wire: bytes received (headers + body as sent), up: bytes sent}
const M = new Map();
const rec = (key) => { if (!M.has(key)) M.set(key, { n: 0, st: {}, ok: 0, lat: [], sql: 0, sqlMax: 0, srvMs: 0, statN: 0, sqlAll: 0, statAll: 0, wire: 0, up: 0, closed: 0 }); return M.get(key); };
let netErrors = 0;
function call(key, p, o = {}) {
  const headers = { Accept: 'application/json', 'Accept-Encoding': 'gzip', 'User-Agent': 'tfm-loadtest/1.0', ...(o.headers || {}) };
  let body = o.body;
  if (o.json !== undefined) { body = Buffer.from(JSON.stringify(o.json), 'utf8'); headers['Content-Type'] = 'application/json'; }
  if (body) headers['Content-Length'] = String(body.length);
  const method = o.method || (body ? 'POST' : 'GET');
  let reqHead = method.length + p.length + 13 + 23 + 26;            // request line + Host + Connection: keep-alive
  for (const [k, v] of Object.entries(headers)) reqHead += k.length + String(v).length + 4;
  const t0 = process.hrtime.bigint();
  return new Promise((resolve) => {
    const req = http.request(BASE + p, { method, headers, agent: o.agent || sharedAgent }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const ms = Number(process.hrtime.bigint() - t0) / 1e6;
        const buf = Buffer.concat(chunks);
        let text = '';
        try { text = (res.headers['content-encoding'] === 'gzip' ? zlib.gunzipSync(buf) : buf).toString('utf8'); } catch { text = ''; }
        let json = null;
        try { json = JSON.parse(text); } catch { /* not JSON */ }
        const m = rec(key);
        const good = res.statusCode >= 200 && res.statusCode < 300;
        m.n++; m.st[res.statusCode] = (m.st[res.statusCode] || 0) + 1;
        if (good) { m.ok++; m.lat.push(ms); }
        if (/\bclose\b/i.test(String(res.headers.connection || ''))) m.closed++;   // the server gave the connection (its worker) back
        let hin = 17;                                                 // status line, then the header lines as received
        for (let i = 0; i < res.rawHeaders.length; i += 2) hin += res.rawHeaders[i].length + res.rawHeaders[i + 1].length + 4;
        m.wire += buf.length + hin + 2;
        m.up += (body ? body.length : 0) + reqHead;
        const sh = res.headers['x-tfm-stats'];
        if (sh) {
            const k = Object.fromEntries(String(sh).split(';').map((x) => x.split('=')));
            const q = Number(k.sql) || 0;
            m.sqlAll += q; m.statAll++;
            if (good) { m.sql += q; m.sqlMax = Math.max(m.sqlMax, q); m.srvMs += Number(k.ms) || 0; m.statN++; }
        }
        resolve({ status: res.statusCode, headers: res.headers, setCookie: res.headers['set-cookie'] || [], json, data: json && json.data, error: json && json.error, ms, wire: buf.length, plain: text.length });
      });
    });
    req.on('error', () => { netErrors++; const m = rec(key); m.n++; m.st.ERR = (m.st.ERR || 0) + 1; resolve({ status: 0, headers: {}, setCookie: [], json: null, data: null, error: null, ms: 0, wire: 0, plain: 0 }); });
    req.setTimeout(30000, () => req.destroy(new Error('timeout')));
    if (body) req.write(body);
    req.end();
  });
}
function cyrb53(str) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0, ch; i < str.length; i++) { ch = str.charCodeAt(i); h1 = Math.imul(h1 ^ ch, 2654435761); h2 = Math.imul(h2 ^ ch, 1597334677); }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0');
}
/** a state the save validator accepts for a new account, padded with activity lines to about `kb` kilobytes */
function freshState(user, kb, t = Date.now()) {
  const crops = { CROP_BEAN: 120, CROP_PEPPER: 150, CROP_CABBAGE: 140, CROP_PERILLA: 130, CROP_CORN: 160, CROP_RADISH: 110, CROP_MINT: 90, CROP_LAVENDER: 150, CROP_LEMONBALM: 100 };
  const pre = [['P1', 'CROP_BEAN', 65], ['P2', 'CROP_PEPPER', 70], ['P3', 'CROP_CABBAGE', 60], ['P4', 'CROP_PERILLA', 79], ['P5', 'CROP_CORN', 50], ['P6', 'CROP_RADISH', 96], ['H1', 'CROP_MINT', 75], ['H2', 'CROP_LAVENDER', 40], ['H3', null, 0], ['H4', 'CROP_LEMONBALM', 90]];
  const plots = {};
  for (const [id, crop, g] of pre) plots[id] = crop ? { cropId: crop, growth: g, water: 60, health: 80, plantedAt: t - Math.round((g / 100) * crops[crop] * 1000), lastUpdate: t, lastWaterAt: 0, harvests: 0 } : { cropId: null, growth: 0, water: 40, health: 100, plantedAt: 0, lastUpdate: t, lastWaterAt: 0, harvests: 0 };
  const jar = (owned, extra = {}) => ({ owned, recipeId: null, status: 'EMPTY', progress: 0, quality: 0, hygiene: 100, temp: 22, humidity: 60, tempOff: 0, humOff: 0, startedAt: 0, lastUpdate: t, care: {}, completedAt: 0, claimedAt: 0, acc: { t: 0, temp: 0, hum: 0, hyg: 0 }, ...extra });
  const activity = [{ t, type: 'login', text: 'load test' }];
  const line = '장독대를 둘러보고 텃밭에 물을 주었어요. '.repeat(8);                // about 500 bytes of text a line
  for (let i = 0; activity.length < 1900 && i * 520 < kb * 1024 - 4000; i++) activity.push({ t: t - i * 1000, type: 'note', text: line });
  return {
    version: 1, createdAt: t, savedAt: t,
    profile: { id: String(user.id), nickname: user.nickname, email: user.email, role: user.role, avatar: null, title: '', titles: [] },
    stats: { level: 1, exp: 0, coin: 0, edu: 0, logins: 1, playTime: 0, distance: 0, waters: 0, plants: 0, harvests: 0, harvestedItems: 0, fermentsStarted: 0, fermentsClaimed: 0, fermentChecks: 0, quizCorrect: 0, quizAnswered: 0, eduCompleted: 0, journals: 0, photos: 0, emotes: 0, gestures: 0, chats: 0, talks: 0, crafts: 0, interacts: 0, expTotal: 0 },
    player: { x: 0, y: 0, z: 9, rotY: Math.PI, zoneId: 'ZONE_MAIN' },
    inventory: { ITEM_SEED_BEAN: 3, ITEM_SEED_PEPPER: 2, ITEM_SEED_CABBAGE: 2, ITEM_SEED_MINT: 2, ITEM_WATERING_CAN: 1, ITEM_HOMI: 1, ITEM_MEJU: 1, ITEM_SALT: 2, ITEM_GUIDEBOOK: 1 },
    quests: {}, farm: { plots },
    jars: { J1: jar(true, { recipeId: 'FER001', status: 'FERMENTING', progress: 35, hygiene: 82, startedAt: t - 63000 }), J2: jar(false), J3: jar(false) },
    education: { viewed: {}, completed: {}, quiz: {} },
    journal: [], photos: [], achievements: {}, collection: {}, visited: { ZONE_MAIN: t }, poisVisited: {}, npcsTalked: {}, cropKinds: {},
    flags: {}, tutorial: { step: 0, done: false }, activity, settings: {}, blocked: [],
  };
}

// ------------------------------------------------------------------ one simulated visitor
const Q = { waits: [], maxPos: 0, entered: [], tickets: 0 };   // waiting-room observations
const SAVE_REFUSED = {};   // refusal codes of saves seen in this run (a correct visitor should see none)
const SAVES = { written: 0, unchanged: 0 };   // accepted saves: judged and written / answered from the unchanged fast path
let ENDS = 0;       // ms timestamp when the run stops
let active = 0, seatedNow = 0;
class Visitor {
  constructor(i) {
    this.i = i; this.email = `load${RUN}_${i}@example.com`; this.ip = `10.${(i >> 16) & 255}.${(i >> 8) & 255}.${i & 255}`;
    this.jar = new Map(); this.csrf = null; this.tok = null; this.te = 0; this.user = null; this.rev = null;
    this.x = (Math.random() - 0.5) * 270; this.z = (Math.random() - 0.5) * 270; this.dir = Math.random() * 6.28; this.speed = 0;
    this.hiddenUntil = 0; this.cursor = 0; this.rcur = null; this.saveKb = O.saveKb[0] + Math.random() ** 3 * (O.saveKb[1] - O.saveKb[0]); this.stop = false; this.gen = 0;
    this.agent = new http.Agent({ keepAlive: true, maxSockets: 2, maxFreeSockets: 2 });   // this visitor's own connections, like a browser tab
  }
  hdr(extra = {}) { const h = { 'X-Forwarded-For': this.ip, ...extra }; if (this.jar.size) h.Cookie = [...this.jar].map(([k, v]) => `${k}=${v}`).join('; '); return h; }
  take(r) {
    for (const line of r.setCookie) { const pair = line.split(';')[0]; const k = pair.indexOf('='); const name = pair.slice(0, k).trim(), value = pair.slice(k + 1).trim(); if (/max-age=0/i.test(line) || value === '' || value === 'deleted') this.jar.delete(name); else this.jar.set(name, value); }
    if (r.json && typeof r.json.csrf === 'string') this.csrf = r.json.csrf;
    return r;
  }
  async get(key, p) { return this.take(await call(key, p, { headers: this.hdr(), agent: this.agent })); }
  async post(key, p, json, extra = {}) { return this.take(await call(key, p, { json, agent: this.agent, headers: this.hdr({ ...(this.csrf ? { 'X-CSRF-Token': this.csrf } : {}), ...extra }) })); }
  alive(gen) { return !this.stop && gen === this.gen && Date.now() < ENDS; }
  /** wait as the server said (Retry-After header or data.retryAfter), with jitter */
  async backoff(r, dflt = 2) { const s = Number(r.headers['retry-after']) || (r.data && r.data.retryAfter) || dflt; await sleep(s * 1000 * (0.9 + Math.random() * 0.4)); }
  walk(dt) {
    if (Math.random() < 0.1) this.speed = Math.random() < 0.35 ? 0 : Math.random() < 0.7 ? 3 : 7;
    if (Math.random() < 0.2) this.dir += (Math.random() - 0.5) * 1.5;
    this.x = Math.max(-135, Math.min(135, this.x + Math.cos(this.dir) * this.speed * dt));
    this.z = Math.max(-135, Math.min(135, this.z + Math.sin(this.dir) * this.speed * dt));
    if (Math.abs(this.x) >= 135 || Math.abs(this.z) >= 135) this.dir += Math.PI;
  }
  async enter(gen) {
    const ping = await this.get('ping', 'api/ping.php');
    if (ping.status !== 200) { this.lastRefusal = `ping → ${ping.status} ${ping.error ? ping.error.code : ''}`; await this.backoff(ping, 3); return false; }
    for (let tries = 0; this.alive(gen); tries++) {
      const r = await this.post('login', 'api/auth/login.php', { login: this.email, password: PASSWORD, remember: false });
      if (r.status === 200) { this.user = r.data.user; break; }
      this.lastRefusal = `login → ${r.status} ${r.error ? r.error.code + ' ' + (r.error.message || '') : ''}`;
      if (r.status === 503 || r.status === 429) { await this.backoff(r); continue; }
      return false;
    }
    if (!this.alive(gen) || !this.user) return false;
    await this.get('me', 'api/auth/me.php');
    const got = await this.get('player/get', 'api/player/get.php');
    this.rev = got.data && got.data.save ? got.data.save.revision : null;
    return true;
  }
  /**
   * A save like the page's: one state per visit, moved forward a little each time (time played, position, one more
   * activity line) — or sent again unchanged (`same`), which is what a heartbeat of an idle page looks like.
   */
  async save(same = false, key = 'player/save') {
    const now = Date.now();
    if (!this.state || this.stateFor !== this.user.id) { this.state = freshState(this.user, this.saveKb, now); this.stateFor = this.user.id; this.stateAt = now; }
    else if (!same) {
      const dt = Math.min(600, (now - this.stateAt) / 1000);
      this.stateAt = now;
      this.state.savedAt = now;
      this.state.stats.playTime += Math.round(dt);
      this.state.stats.distance += Math.round(dt * 1.5);
      this.state.player.x = Math.round(Math.max(-60, Math.min(60, this.x)) * 100) / 100;
      this.state.player.z = Math.round(Math.max(-60, Math.min(60, this.z)) * 100) / 100;
      this.state.activity.push({ t: now, type: 'note', text: '마을을 한 바퀴 둘러보았어요.' });
      if (this.state.activity.length > 1950) this.state.activity.splice(1, 50);
    }
    const state = this.state;
    const data = JSON.stringify(state);
    const body = { version: 1, checksum: cyrb53(data), ...(this.rev !== null ? { base: this.rev } : {}), data: state };
    const r = await this.post(key, 'api/player/save.php', body);
    if (r.status === 200 && r.data) { this.rev = r.data.revision; if (r.data.unchanged) SAVES.unchanged++; else SAVES.written++; }
    else if (r.status === 409 && r.data && r.data.save) { this.rev = r.data.save.revision; this.state = null; SAVE_REFUSED[r.error ? r.error.code + (r.data.violations ? ' ' + r.data.violations.join(',') : '') : '409'] = 1; }
    return r;
  }
  async runSync(gen) {
    let t0 = Date.now(), nextSave = Date.now() + 20000 + Math.random() * 40000, nextChat = Date.now() + Math.random() * 60000, saveEvery = 60000, ticket = null, waitFrom = 0, seated = false, first = true;
    while (this.alive(gen)) {
      const now = Date.now();
      this.walk(Math.min(5, (now - t0) / 1000));
      t0 = now;
      if (now > this.hiddenUntil && Math.random() < O.hidden / 20) this.hiddenUntil = now + 20000 + Math.random() * 60000;
      const hidden = now < this.hiddenUntil ? 1 : 0;
      const body = { p: [Math.round(this.x * 100) / 100, 0, Math.round(this.z * 100) / 100, Math.round(this.dir * 100) / 100, hidden ? 0 : this.speed, this.speed > 5 ? 'run' : this.speed > 0 ? 'walk' : 'idle', 'ZONE_MAIN', null, 0], h: hidden, c: this.cursor };
      if (this.rcur !== null) body.r = this.rcur;
      if (first) { body.f = 1; body.ap = { hair: ['short', 'long', 'bun'][this.i % 3], topColor: '#' + ((this.i * 2654435761) >>> 8 & 0xffffff).toString(16).padStart(6, '0') }; }
      if (ticket) body.qt = ticket;
      const useTok = this.tok && this.te - now / 1000 > 20;
      const r = await this.post(useTok ? 'sync (token)' : 'sync (checked)', 'api/sync.php', body, useTok ? { 'X-Sync-Token': this.tok } : {});
      if (r.status === 200 && r.data) {
        if (!seated) { seated = true; seatedNow++; if (waitFrom) { Q.waits.push((Date.now() - waitFrom) / 1000); Q.entered.push(this.qseq); } }
        first = false; ticket = null;
        if (typeof r.data.t === 'string') { this.tok = r.data.t; this.te = r.data.te; }
        if (Number.isInteger(r.data.c)) this.cursor = r.data.c;
        if (r.data.rt && Number.isInteger(r.data.rt.r)) this.rcur = r.data.rt.r;
        if (r.data.sv) saveEvery = r.data.sv;
        if (!O.noChat && Date.now() >= nextChat && !hidden) { nextChat = Date.now() + 45000 + Math.random() * 30000; await this.post('chat/send', 'api/chat/send.php', { text: `안녕하세요 ${this.i} ${Math.floor(Math.random() * 1e6)}`, channel: Math.random() < 0.3 ? 'local' : 'all' }); }
        if (!O.noSave && Date.now() >= nextSave) {                    // the page saves when something changed; an idle page sends a heartbeat
          const idle = hidden || this.speed === 0;
          if (!idle || Date.now() - (this.lastSaveAt || 0) >= 300000) { this.lastSaveAt = Date.now(); await this.save(idle && !!this.state); }
          nextSave = Date.now() + saveEvery * (0.9 + Math.random() * 0.3);
        }
        await sleep(r.data.n * (0.85 + Math.random() * 0.3));
      } else if (r.status === 503 && r.error && r.error.code === 'QUEUE') {
        if (!waitFrom) { waitFrom = Date.now(); Q.tickets++; }
        ticket = r.data.queue.t;
        this.qseq = JSON.parse(Buffer.from(ticket.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'))[0];
        Q.maxPos = Math.max(Q.maxPos, r.data.queue.pos);
        let next = r.data.queue.next;
        while (this.alive(gen)) {                                   // the waiting room: only api/queue.php
          await sleep(next * (0.9 + Math.random() * 0.2));
          const q = await call('queue', `api/queue.php?t=${encodeURIComponent(ticket)}`, { headers: { 'X-Forwarded-For': this.ip }, agent: this.agent });
          if (q.status === 200 && q.data.go) break;
          if (q.status === 200) { next = q.data.next; Q.maxPos = Math.max(Q.maxPos, q.data.pos); } else if (q.status === 400) { ticket = null; break; } else next = 3000;
        }
      } else if (r.status === 429 || r.status === 503) { await this.backoff(r, 1);
      } else if (r.status === 401 || r.status === 403) { if (seated) { seated = false; seatedNow--; } this.tok = null; if (!(await this.enter(gen))) await sleep(2000);
      } else await sleep(1000 + Math.random() * 1000);
    }
    if (seated) seatedNow--;
  }
  async runLegacy(gen) {
    let nextPres = 0, nextChat = Date.now() + Math.random() * 3000, nextSave = Date.now() + Math.random() * 30000, nextSay = Date.now() + Math.random() * 60000, t0 = Date.now(), last = 0, rafter = null;
    while (this.alive(gen)) {
      const now = Date.now();
      this.walk((now - t0) / 1000);
      t0 = now;
      if (now >= nextPres) {
        nextPres = now + (this.speed > 3.2 ? 1000 : 2000) * (0.85 + Math.random() * 0.3);
        const r = await this.post('presence/update', 'api/presence/update.php', { x: Math.round(this.x * 100) / 100, y: 0, z: Math.round(this.z * 100) / 100, rotY: 0, anim: this.speed > 0 ? 'walk' : 'idle', speed: this.speed, zoneId: 'ZONE_MAIN', emote: null, emoteAt: 0, appearance: { hair: 'short' } });
        if (r.status === 401) { if (!(await this.enter(gen))) await sleep(2000); } else if (r.status === 429 || r.status === 503) await this.backoff(r, 1);
      }
      if (now >= nextChat) { nextChat = now + 3000 * (0.85 + Math.random() * 0.3); const r = await this.get('chat/list', `api/chat/list.php?after=${last}${rafter !== null && last ? `&rafter=${rafter}` : ''}`); if (r.status === 200) { last = r.data.lastId; rafter = r.data.retractId; } }
      if (now >= nextSay) { nextSay = now + 45000 + Math.random() * 30000; await this.post('chat/send', 'api/chat/send.php', { text: `안녕하세요 ${this.i} ${Math.floor(Math.random() * 1e6)}`, channel: 'all' }); }
      if (now >= nextSave) { nextSave = now + 30000; await this.save(); }
      await sleep(200);
    }
  }
  async run() {
    active++;
    while (!this.stop && Date.now() < ENDS) {
      const gen = ++this.gen;
      if (await this.enter(gen)) await (O.mode === 'legacy' ? this.runLegacy(gen) : this.runSync(gen));
      else await sleep(1000 + Math.random() * 2000);
      this.jar.clear(); this.csrf = null; this.tok = null; this.user = null; this.state = null;   // a new page
      this.agent.destroy(); this.agent = new http.Agent({ keepAlive: true, maxSockets: 2, maxFreeSockets: 2 });
    }
    active--;
  }
}

// ------------------------------------------------------------------ reports
const pct = (a, p) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * p))]; };
function table(seconds) {
  const rows = [];
  let total = 0, wire = 0, up = 0, s429 = 0, s503 = 0, s5xx = 0, sqlAll = 0, statAll = 0;
  for (const [key, m] of [...M].sort((a, b) => b[1].n - a[1].n)) {
    total += m.n; wire += m.wire; up += m.up; s429 += m.st[429] || 0; s503 += m.st[503] || 0; sqlAll += m.sqlAll; statAll += m.statAll;
    for (const [c, n] of Object.entries(m.st)) if (c === 'ERR' || (Number(c) >= 500 && Number(c) !== 503)) s5xx += n;
    rows.push({ endpoint: key, n: m.n, rps: +(m.n / seconds).toFixed(1), status: m.st, p50: +pct(m.lat, 0.5).toFixed(1), p95: +pct(m.lat, 0.95).toFixed(1), p99: +pct(m.lat, 0.99).toFixed(1),
      sqlPerReq: m.statN ? +(m.sql / m.statN).toFixed(3) : null, sqlMax: m.sqlMax, serverMs: m.statN ? +(m.srvMs / m.statN).toFixed(2) : null, bytesIn: Math.round(m.wire / Math.max(1, m.n)), bytesOut: Math.round(m.up / Math.max(1, m.n)),
      released: m.n ? Math.round((m.closed / m.n) * 100) : 0 });
  }
  return { rows, total, wire, up, s429, s503, s5xx, sqlAll, statAll, sqlPerReq: statAll ? +(sqlAll / statAll).toFixed(3) : null };
}
function print(rows) {
  const pad = (s, n) => String(s).padEnd(n);
  // "freed" = share of answers after which the server closed the connection (Connection: close): its worker is free at once
  console.log(pad('endpoint', 18) + pad('requests', 10) + pad('/s', 8) + pad('p50 ms', 9) + pad('p95 ms', 9) + pad('p99 ms', 9) + pad('SQL/req', 9) + pad('srv ms', 8) + pad('in B', 8) + pad('freed', 7) + 'status');
  for (const r of rows) console.log(pad(r.endpoint, 18) + pad(r.n, 10) + pad(r.rps, 8) + pad(r.p50, 9) + pad(r.p95, 9) + pad(r.p99, 9) + pad(r.sqlPerReq === null ? '-' : r.sqlPerReq, 9) + pad(r.serverMs === null ? '-' : r.serverMs, 8) + pad(r.bytesIn, 8) + pad(r.released + '%', 7) + Object.entries(r.status).map(([c, n]) => `${c}×${n}`).join(' '));
}

/**
 * The instance's own numbers — seats, channels, load, waiting room, and the SQL of after-response work: from api/ping.php
 * (capacity.stats_header adds them; this works with every cache driver), else from 'php cli/tfm.php capacity --json'.
 */
async function liveStats() {
  const r = await rawGet('api/ping.php', { 'X-Forwarded-For': '10.250.0.1' });
  if (r && r.data && r.data.stats) return r.data.stats;
  const cli = [path.join(DOCROOT, 'cli/tfm.php'), 'capacity', '--json'];
  const c = WEB_USER && spawnSync('runuser', ['--version']).status === 0
    ? spawnSync('runuser', ['-u', WEB_USER, '--', 'env', ...Object.entries(ENV).map(([k, v]) => `${k}=${v}`), 'php', ...cli], { encoding: 'utf8' })
    : spawnSync('php', cli, { env: { ...process.env, ...ENV }, encoding: 'utf8' });
  try { return JSON.parse(String(c.stdout || '').trim().split('\n').pop()); } catch { return null; }
}
/** a request that is not part of the measurements */
function rawGet(p, headers = {}) {
  return new Promise((resolve) => {
    const req = http.request(BASE + p, { method: 'GET', headers: { Accept: 'application/json', ...headers } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { resolve(null); } });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(15000, () => req.destroy(new Error('timeout')));
    req.end();
  });
}
/** CPU seconds the whole machine has been busy so far (all processes; /proc/stat: everything but idle and iowait) */
function machineCpu() {
  try {
    const f = fs.readFileSync('/proc/stat', 'utf8').split('\n')[0].trim().split(/\s+/).slice(1).map(Number);
    return (f.reduce((a, b) => a + b, 0) - f[3] - (f[4] || 0)) / 100;
  } catch { return 0; }
}
/** CPU seconds used so far by the database server process, when there is one on this machine (MariaDB / MySQL) */
function dbCpu() {
  let ticks = 0;
  try {
    for (const d of fs.readdirSync('/proc')) {
      if (!/^\d+$/.test(d)) continue;
      let st;
      try { st = fs.readFileSync(`/proc/${d}/stat`, 'utf8'); } catch { continue; }
      const name = st.slice(st.indexOf('(') + 1, st.lastIndexOf(')'));
      if (name !== 'mariadbd' && name !== 'mysqld') continue;
      const f = st.slice(st.lastIndexOf(')') + 2).split(' ');
      ticks += Number(f[11]) + Number(f[12]);
    }
  } catch { /* not Linux */ }
  return ticks / 100;
}

// ------------------------------------------------------------------ main
if (O.driver === 'mysql') mysqlRoot([`DROP DATABASE IF EXISTS \`${MY.db}\``, `CREATE DATABASE \`${MY.db}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`]);
const seeded = seed(O.probe ? 3 : O.users);
const srv = await startServer();
const report = { label: O.label, docroot: DOCROOT, server: srv.kind, opcache: O.opcache, cacheAsked: O.cache, driver: O.driver, seeded, mode: O.mode, users: O.users, ramp: O.ramp, duration: O.duration, cpus: os.cpus().length };
const first = await call('ping', 'api/ping.php', { headers: { 'X-Forwarded-For': '10.250.0.1' } });
if (first.status !== 200) { console.error(`✖ the instance does not answer: ping → ${first.status} ${first.error ? first.error.code : ''}`); process.exit(2); }
report.features = first.data.features || null;
M.clear();

if (O.probe) {
  // one visitor, each call 30 times in a row (saves 16, sync 60): what one request costs
  const v = new Visitor(1);
  ENDS = Date.now() + 3600000;
  v.gen = 1;
  if (!(await v.enter(1))) { console.error(`✖ probe: could not sign in (${v.lastRefusal || 'no answer'})`); process.exit(2); }
  const plan = [
    ['ping', () => v.get('ping', 'api/ping.php')],
    ['me', () => v.get('me', 'api/auth/me.php')], ['player/get', () => v.get('player/get', 'api/player/get.php')], ['ranking/top', () => v.get('ranking/top', 'api/ranking/top.php')],
    ['chat/list', () => v.get('chat/list', 'api/chat/list.php?after=0')],
    ['presence/update', () => v.post('presence/update', 'api/presence/update.php', { x: 1, y: 0, z: 1, rotY: 0, anim: 'idle', speed: 0, zoneId: 'ZONE_MAIN' })],
  ];
  for (const [key, fn] of plan) {
    for (let i = 0; i < 30; i++) { await fn(); await sleep(key === 'presence/update' ? 360 : 20); }   // 30: below every per-minute limit
  }
  for (let i = 0; i < 16; i++) { await v.save(); await sleep(1300); }
  for (let i = 0; i < 8; i++) { await v.save(true, 'save (unchanged)'); await sleep(1300); }
  if (report.features && report.features.sync) {
    for (let i = 0; i < 60; i++) {
      const useTok = v.tok && i > 0;
      const r = await v.post(useTok ? 'sync (token)' : 'sync (checked)', 'api/sync.php', { p: [1 + i / 100, 0, 1, 0, 2, 'walk', 'ZONE_MAIN', null, 0], c: v.cursor }, useTok ? { 'X-Sync-Token': v.tok } : {});
      if (r.status === 200 && typeof r.data.t === 'string') v.tok = r.data.t;
      await sleep(360);
    }
  }
  const t = table(1);
  console.log(`\nper-request cost — ${srv.kind} · opcache ${O.opcache ? 'on' : 'off'} · ${seeded}${O.label ? ' · ' + O.label : ''}\n`);
  print(t.rows.map((r) => ({ ...r, rps: '-' })));
  report.probe = t.rows;
} else {
  const cpu0 = serverCpu(srv.pid), tStart = Date.now();
  ENDS = tStart + (O.ramp + O.duration) * 1000;
  const visitors = Array.from({ length: O.users }, (_, i) => new Visitor(i + 1));
  const runs = visitors.map((v, i) => sleep((O.ramp * 1000 * i) / Math.max(1, O.users)).then(() => v.run()));
  let peakSeated = 0;
  const tick = setInterval(() => { peakSeated = Math.max(peakSeated, seatedNow); }, 500);
  if (O.reconnectAt !== null) {
    setTimeout(() => { const n = Math.floor(O.users * O.reconnectShare); for (const v of visitors.slice(0, n)) v.gen++; report.reconnected = n; }, (O.ramp + O.reconnectAt) * 1000);
  }
  // the measured window starts when everyone is in: the ramp's logins are reported apart
  await sleep(O.ramp * 1000);
  const rampTable = table(O.ramp);
  const loginRamp = rampTable.rows.find((r) => r.endpoint === 'login') || null;
  M.clear();
  const s1 = await liveStats();
  const cpu1 = serverCpu(srv.pid), db1 = dbCpu(), gen1 = process.cpuUsage(), all1 = machineCpu(), t1 = Date.now();
  let mid = null;
  setTimeout(async () => { mid = await liveStats(); }, Math.max(1000, O.duration * 500));
  await Promise.all(runs);
  clearInterval(tick);
  const seconds = (Date.now() - t1) / 1000, cpu2 = serverCpu(srv.pid), db2 = dbCpu(), gen2 = process.cpuUsage(gen1), all2 = machineCpu();
  const t = table(seconds);
  const s2 = await liveStats();
  const afterSql = s1 && s2 ? Math.max(0, s2.after.sql - s1.after.sql) : null;
  // how far anyone got in ahead of an earlier ticket: 0 = strictly in ticket order
  let top = 0, overtake = 0;
  for (const q of Q.entered) { if (q < top) overtake = Math.max(overtake, top - q); else top = q; }
  Object.assign(report, {
    seconds: +seconds.toFixed(1), requests: t.total, rps: +(t.total / seconds).toFixed(1), perVisitorMinute: +((t.total / seconds) * 60 / O.users).toFixed(1),
    bytesPerVisitorMinute: { down: Math.round((t.wire / seconds) * 60 / O.users), up: Math.round((t.up / seconds) * 60 / O.users) },
    http429: t.s429, http503: t.s503, errors: t.s5xx, netErrors,
    sqlPerRequest: t.statAll ? +((t.sqlAll + (afterSql || 0)) / t.statAll).toFixed(3) : null, sqlInAnswers: t.sqlAll, sqlAfterAnswers: afterSql,
    serverCpuCores: +((cpu2 - cpu1) / seconds).toFixed(2), rampCpuCores: +((cpu1 - cpu0) / Math.max(1, O.ramp)).toFixed(2),
    dbCpuCores: O.driver === 'mysql' ? +((db2 - db1) / seconds).toFixed(2) : null,
    generatorCpuCores: +((gen2.user + gen2.system) / 1e6 / seconds).toFixed(2), peakSeated, loginRamp,
    serverCpuMsPerRequest: t.total ? +(((cpu2 - cpu1) * 1000) / t.total).toFixed(2) : null,
    // what else the machine was doing: CPU of every other process, and the load average (runnable processes) at the end
    otherCpuCores: +Math.max(0, (all2 - all1 - (cpu2 - cpu1) - (O.driver === 'mysql' ? db2 - db1 : 0) - (gen2.user + gen2.system) / 1e6) / seconds).toFixed(2), loadAverage: os.loadavg().map((x) => +x.toFixed(1)),
    queue: { tickets: Q.tickets, maxPos: Q.maxPos, entered: Q.waits.length, waitP50: +pct(Q.waits, 0.5).toFixed(1), waitMax: +Math.max(0, ...Q.waits).toFixed(1), largestOvertake: overtake },
    live: mid ? { seats: mid.gate.seats, maxOnline: mid.gate.maxOnline, waiting: mid.gate.waiting, rps: mid.gate.rps, load: mid.gate.load, shedding: mid.gate.shedding, channels: mid.sync.channels, largest: mid.sync.largest, smallest: mid.sync.smallest, cache: mid.gate.cache } : null,
    saves: { ...SAVES, refused: Object.keys(SAVE_REFUSED) },
    endpoints: t.rows,
  });
  console.log(`\nload test — ${O.users} visitors (${O.mode}) · ${srv.kind} · opcache ${O.opcache ? 'on' : 'off'} · ${seeded}${O.label ? ' · ' + O.label : ''}`);
  console.log(`  ${report.requests} requests in ${report.seconds} s = ${report.rps} req/s (${report.perVisitorMinute} per visitor-minute) · SQL per request ${report.sqlPerRequest} (${t.sqlAll} in answers + ${afterSql === null ? '?' : afterSql} after answers)`);
  console.log(`  CPU: server ${report.serverCpuCores} of ${report.cpus} cores (ramp ${report.rampCpuCores}) = ${report.serverCpuMsPerRequest} ms of CPU per request${report.dbCpuCores !== null ? ` · database ${report.dbCpuCores}` : ''} · this load generator ${report.generatorCpuCores} · other processes on this machine ${report.otherCpuCores} (load average ${report.loadAverage.join(' / ')})`);
  console.log(`  bytes per visitor-minute: ${report.bytesPerVisitorMinute.down} down, ${report.bytesPerVisitorMinute.up} up · 429: ${report.http429} · 503: ${report.http503} · 5xx / network errors: ${report.errors} / ${netErrors} · seated at peak (as the visitors saw it): ${peakSeated}`);
  if (report.live) console.log(`  server at half time: ${report.live.seats} seated of ${report.live.maxOnline || '∞'} · ${report.live.channels} channels (largest ${report.live.largest}, smallest ${report.live.smallest}) · waiting ${report.live.waiting} · ${report.live.rps} req/s · load ${report.live.load} · shedding ${report.live.shedding} · cache ${report.live.cache}`);
  if (Q.tickets) console.log(`  waiting room: ${Q.tickets} tickets, longest line ${Q.maxPos}, ${Q.waits.length} entered (wait p50 ${report.queue.waitP50} s, max ${report.queue.waitMax} s), largest overtaking ${overtake} places`);
  console.log(`  saves: ${SAVES.written} written, ${SAVES.unchanged} unchanged (fast path)${Object.keys(SAVE_REFUSED).length ? ' · refused: ' + Object.keys(SAVE_REFUSED).join(' | ') : ''}`);
  if (loginRamp) console.log(`  logins during the ramp: ${loginRamp.n} (p50 ${loginRamp.p50} ms, p95 ${loginRamp.p95} ms) ${JSON.stringify(loginRamp.status)}`);
  console.log('');
  print(t.rows);
}
if (O.json) fs.writeFileSync(path.resolve(O.json), JSON.stringify(report, null, 1));
cleanup();
process.exit(0);
