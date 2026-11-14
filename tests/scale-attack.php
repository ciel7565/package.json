<?php
/**
 * tests/scale-attack.php — attacks on the scale work of CONTRACT §16.9, unit level (the independent verification of
 * lib/Cache.php, lib/Gate.php, lib/Sync.php and the hot-path changes). Every check here is an attack that worked — or
 * could have worked — against the first version; it stays as a regression guard.
 *
 *   php tests/scale-attack.php
 *   php -d extension=<apcu.so> -d apc.enable_cli=1 tests/scale-attack.php      also the APCu checks
 *   TFM_UNIT_ONLY=<text>   only the checks whose name contains <text>
 *
 *   cache     lock files stay inside the data folder (APCu driver) · a record that exists is never reported missing
 *             because readers met it half-written · two command-line changes in one second both reach the web server
 *   token     an old token is dead once its account was signed out / banned and seated again · the seat record
 *             outlives a day of play · a seated player is never sent to the waiting room
 *   queue     one place per account (reload keeps it) · a used ticket is spent · a no-show loses its ticket · a ticket of
 *             an older line is no ticket · a full house stays full when a read fails
 *   meters    only real password checks use the login meter · refused requests are not "load"
 *   looks     one account cannot fill the cache with avatar looks · an unused look expires, a used one stays · a look
 *             stored under another look's id does not replace it
 * No web server; a throw-away data folder with SQLite. Real parallel processes for the cache races (`--worker`).
 * CLI only; never deployed (tests/ is not part of the web root). Developer tooling: runs on the dev PHP (8.x).
 */
declare(strict_types=1);

if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }

/** a channel record the size of a busy one: $n members of 21 fields each (about 200 bytes per member) */
function blobOf(int $n, int $tick): array
{
    $m = [];
    for ($i = 1; $i <= $n; $i++) $m[$i] = [$tick, $i * 1.25, 0, $i * 2.5, 0.5, 1.2, 'walk', 'ZONE_MAIN', null, 0, 'Player' . $i, 'ab12cd34', 1234, $tick, 0, 1000, 0, 0, 1, $tick, 0];
    return ['m' => $m, 'fl' => $tick, 'rg' => $tick, 'rn' => $n, 'cid' => $tick, 'tick' => $tick, 'sum' => $tick * $n];
}

// ------------------------------------------------------------------ worker mode (a child process of a race check)
if (isset($argv[1]) && $argv[1] === '--worker') {
    $job = (string) ($argv[2] ?? '');
    $dir = (string) ($argv[3] ?? '');
    putenv('TFM_DATA_DIR=' . $dir . '/data');
    require __DIR__ . '/../server/lib/bootstrap.php';
    Tfm\Cache::configure(['driver' => 'file', 'dir' => $dir . '/cache', 'prefix' => 'w', 'web' => true]);
    $a = array_slice($argv, 4);
    $end = microtime(true) + ((int) ($a[1] ?? 1000)) / 1000;
    switch ($job) {
        case 'chan-writer': {              // <key> <ms> <members> — what a sync call does to its channel record
            $n = 0;
            $members = (int) ($a[2] ?? 60);
            while (microtime(true) < $end) {
                $r = Tfm\Cache::mutate($a[0], static function ($old) use ($members) {
                    $t = is_array($old) && isset($old['tick']) ? (int) $old['tick'] + 1 : 1;
                    return blobOf($members, $t);
                }, 600);
                if (is_array($r)) $n++;
            }
            echo $n;
            break;
        }
        case 'chan-reader': {              // <key> <ms> <members> — lock-free reads, as the checked path does
            $r = ['ok' => 0, 'miss' => 0, 'bad' => 0, 'torn' => 0];
            $members = (int) ($a[2] ?? 60);
            while (microtime(true) < $end) {
                $v = Tfm\Cache::get($a[0]);
                if ($v === null) $r['miss']++;
                elseif (is_array($v) && isset($v['m'], $v['tick'], $v['sum']) && count($v['m']) === $members && $v['sum'] === $v['tick'] * $members && $v['m'][$members][0] === $v['tick']) $r['ok']++;
                else $r['bad']++;
            }
            $r['torn'] = Tfm\Cache::stats()['torn'];
            echo json_encode($r);
            break;
        }
        default:
            fwrite(STDERR, "unknown worker job\n");
            exit(2);
    }
    exit(0);
}

// ------------------------------------------------------------------ the suite
$tmp = sys_get_temp_dir() . '/tfm-scale-attack-' . bin2hex(random_bytes(6));
mkdir($tmp, 0700, true);
putenv("TFM_DATA_DIR=$tmp");
putenv("TFM_UPLOAD_DIR=$tmp/uploads");
require __DIR__ . '/../server/lib/bootstrap.php';

$failed = 0;
$passed = 0;
$skipped = 0;
/** $test returns true (pass), false or a string (fail + detail), or ['skip' => why]; a thrown error is a fail */
function check(string $name, callable $test): void
{
    global $failed, $passed, $skipped;
    $only = (string) getenv('TFM_UNIT_ONLY');
    if ($only !== '' && strpos($name, $only) === false) return;
    try {
        $r = $test();
        if (is_array($r) && isset($r['skip'])) { $skipped++; echo 'SKIP  ' . $name . '  — ' . $r['skip'] . PHP_EOL; return; }
        $ok = $r === true;
        $detail = is_string($r) ? $r : ($ok ? '' : 'assertion is false');
    } catch (Throwable $e) {
        $ok = false;
        $detail = get_class($e) . ': ' . $e->getMessage() . ' @' . basename($e->getFile()) . ':' . $e->getLine();
    }
    if ($ok) $passed++; else $failed++;
    echo ($ok ? 'PASS  ' : 'FAIL  ') . $name . ($ok || $detail === '' ? '' : "  — $detail") . PHP_EOL;
}
/** the ApiException a call throws as "status CODE" ('' = none) */
function apiCode(callable $fn): string
{
    try { $fn(); } catch (Tfm\ApiException $e) { return $e->status . ' ' . $e->errorCode; }
    return '';
}
/** the waiting-room answer a call throws (503 QUEUE): its data.queue, else null */
function queued(callable $fn): ?array
{
    try { $fn(); } catch (Tfm\ApiException $e) { return $e->status === 503 && $e->errorCode === 'QUEUE' && isset($e->data['queue']) ? $e->data['queue'] : ['error' => $e->status . ' ' . $e->errorCode]; }
    return null;
}
$CLOCK = 0;   // 0 = the real clock; else a fixed "now" in ms for the cache
$now = static function () use (&$CLOCK): int { return $CLOCK > 0 ? $CLOCK : (int) floor(microtime(true) * 1000); };
/** one simulated request from $ip to $script (what the gate and the limits look at) */
function request(string $ip, string $script = '/api/ranking/top.php', string $method = 'GET', array $extra = []): void
{
    foreach (['HTTP_X_FORWARDED_FOR', 'HTTP_ORIGIN', 'HTTP_SEC_FETCH_SITE', 'HTTP_COOKIE', 'HTTP_X_SYNC_TOKEN', 'HTTP_X_CSRF_TOKEN'] as $k) unset($_SERVER[$k]);
    $_SERVER['REMOTE_ADDR'] = $ip;
    $_SERVER['REQUEST_METHOD'] = $method;
    $_SERVER['SCRIPT_NAME'] = $script;
    $_SERVER['HTTP_HOST'] = $ip === '127.0.0.1' ? '127.0.0.1' : 'play.example.test';
    foreach ($extra as $k => $v) $_SERVER[$k] = $v;
    $_COOKIE = [];
    Tfm\Http::resetRequestCache();
    Tfm\Gate::reset();
    Tfm\Db::resetStats();
}
$WORLD = '';
/** a fresh cache (and channel world) for a check; $more: extra Cache::configure settings (a read hook) */
function world(array $conf = [], array $more = []): string
{
    global $tmp, $now, $WORLD;
    static $n = 0;
    $WORLD = "$tmp/world-" . (++$n);
    Tfm\Cache::configure(['driver' => 'file', 'dir' => $WORLD, 'prefix' => 'w', 'web' => true, 'now' => $now] + $more);
    foreach (['channels.size' => 60, 'channels.hard' => 90, 'capacity.max_online' => 0, 'capacity.seat_ttl' => 180, 'capacity.shed_rps' => 0, 'capacity.sample' => 4, 'capacity.target_rps' => 150,
        'capacity.login_per_sec' => 5, 'capacity.login_concurrent' => 4, 'sync.max_near' => 40, 'sync.aoi_radius' => 90, 'sync.min_gap_ms' => 350, 'rate_limits.sync' => [150, 60]] as $k => $v) {
        Tfm\Config::override($k, $conf[$k] ?? $v);
    }
    Tfm\Sync::reset();
    Tfm\Gate::reset();
    return $WORLD;
}
/** the same world again (the files stay), with other cache settings — "the next request" */
function again(array $more = []): void
{
    global $now, $WORLD;
    Tfm\Cache::configure(['driver' => 'file', 'dir' => $WORLD, 'prefix' => 'w', 'web' => true, 'now' => $now] + $more);
    Tfm\Sync::reset();
    Tfm\Gate::reset();
}
/** the record file of a cache key in the current world */
function fileOf(string $key): string
{
    global $WORLD;
    $h = sha1('w:' . $key);
    return $WORLD . DIRECTORY_SEPARATOR . substr($h, 0, 2) . DIRECTORY_SEPARATOR . $h . '.php';
}
/** fake accounts (no database rows needed for the channel logic) */
function acct(int $id, string $role = 'user'): array { return ['id' => $id, 'nickname' => 'P' . $id, 'role' => $role, 'muted_until' => 0]; }
/** the body of a sync call at (x, z) */
function body(float $x = 0, float $z = 0, array $more = []): array
{
    return ['p' => [$x, 0, $z, 0, 0, 'idle', 'ZONE_MAIN', null, 0]] + $more;
}
/** the normalised input of a sync call */
function inp(float $x = 0, float $z = 0, array $more = []): array { return Tfm\Sync::input(body($x, $z, $more)); }
/** seat an account the way a checked call does and hand out the claims of its token */
function seat(int $uid, int $at, array $more = [], string $sid = ''): array
{
    $j = Tfm\Sync::join(acct($uid), inp($uid * 1.0, $uid * 1.0, $more), $at);
    $sid = $sid === '' ? 'sid-' . $uid : $sid;
    $tok = Tfm\Sync::token($uid, $j['ch'], $at, $sid, 'csrf-' . $sid, (string) $j['meta']['b']);
    return ['ch' => $j['ch'], 'token' => $tok[0], 'claims' => Tfm\Sync::claims($tok[0], $sid, 'csrf-' . $sid, $at + 1), 'out' => $j['out']];
}
/** start worker processes of this file: [[job, count, args…]] → [job => [stdout…]] */
function race(string $dir, array $specs): array
{
    $procs = [];
    foreach ($specs as $spec) {
        for ($i = 0; $i < $spec[1]; $i++) {
            $cmd = array_merge([PHP_BINARY, __FILE__, '--worker', $spec[0], $dir], array_map('strval', array_slice($spec, 2)));
            $p = proc_open($cmd, [1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes, null, getenv());
            if (!is_resource($p)) throw new RuntimeException('cannot start a worker process');
            $procs[] = [$spec[0], $p, $pipes];
        }
    }
    $out = [];
    foreach ($procs as $pp) {
        $o = stream_get_contents($pp[2][1]);
        $e = stream_get_contents($pp[2][2]);
        fclose($pp[2][1]);
        fclose($pp[2][2]);
        proc_close($pp[1]);
        if (trim((string) $e) !== '') throw new RuntimeException('worker error: ' . substr(trim((string) $e), 0, 300));
        $out[$pp[0]][] = (string) $o;
    }
    return $out;
}

Tfm\Db::pdo(); // creates the schema
$APCU = function_exists('apcu_enabled') && apcu_enabled();
echo 'driver: ' . Tfm\Db::driver() . ' · PHP ' . PHP_VERSION . ' · APCu ' . ($APCU ? 'on' : 'off') . PHP_EOL;
$T = (int) floor(microtime(true) * 1000);
request('203.0.113.10');

// =============================================================================================== 1. cache
check('cache[apcu] — mutate() keeps its lock files inside the cache folder, never at the root of the file system', function () use ($tmp, $APCU, $now) {
    if (!$APCU) return ['skip' => 'APCu is not enabled for the command line'];
    $dir = "$tmp/apcu-locks";
    $rootBefore = count(glob(DIRECTORY_SEPARATOR . '_l' . DIRECTORY_SEPARATOR . '*.lock') ?: []);
    Tfm\Cache::configure(['driver' => 'apcu', 'dir' => $dir, 'prefix' => 'al' . bin2hex(random_bytes(2)), 'web' => true, 'now' => $now]);
    if (Tfm\Cache::driver() !== 'apcu') return 'driver() = ' . Tfm\Cache::driver();
    for ($i = 0; $i < 300; $i++) Tfm\Cache::mutate('lk:' . $i, static function ($o) { return ['n' => 1]; }, 30);
    $own = count(glob($dir . DIRECTORY_SEPARATOR . '_l' . DIRECTORY_SEPARATOR . '*.lock') ?: []);
    $rootAfter = count(glob(DIRECTORY_SEPARATOR . '_l' . DIRECTORY_SEPARATOR . '*.lock') ?: []);
    return $own > 0 && $rootAfter === $rootBefore ? true : "lock files in the cache folder: $own · new lock files in /_l: " . ($rootAfter - $rootBefore);
});
check('cache[apcu] — a web server that cannot write the lock folder still mutates correctly (the flag fall-back), and says so in info()', function () use ($tmp, $APCU, $now) {
    if (!$APCU) return ['skip' => 'APCu is not enabled for the command line'];
    $dir = "$tmp/apcu-nolock";
    mkdir($dir, 0700, true);
    file_put_contents($dir . DIRECTORY_SEPARATOR . '_l', 'not a folder');      // the lock folder cannot be made
    Tfm\Cache::configure(['driver' => 'apcu', 'dir' => $dir, 'prefix' => 'an' . bin2hex(random_bytes(2)), 'web' => true, 'now' => $now]);
    $v = null;
    for ($i = 0; $i < 50; $i++) $v = Tfm\Cache::mutate('ctr', static function ($o) { return (int) $o + 1; }, 30);
    $info = Tfm\Cache::info();
    return $v === 50 && isset($info['locks']) && $info['locks'] === 'flag' ? true : 'counter ' . json_encode($v) . ' · info.locks = ' . json_encode($info['locks'] ?? null);
});
check('cache[file] — a record that exists is not reported missing when three lock-free reads in a row meet it half-written', function () use ($tmp, $now) {
    world();
    Tfm\Cache::set('torn:k', ['v' => 1, 'pad' => str_repeat('x', 6000)], 600);
    $file = fileOf('torn:k');
    $calls = 0;
    again(['read' => static function (string $f) use ($file, &$calls) {
        $raw = @file_get_contents($f);
        if ($f !== $file || !is_string($raw)) return $raw;
        return ++$calls <= 3 ? substr($raw, 0, intdiv(strlen($raw), 2)) : $raw;      // a writer is in the middle of it, three times
    }]);
    $v = Tfm\Cache::get('torn:k');
    $absent = Tfm\Cache::get('torn:none', 'dflt');
    return is_array($v) && $v['v'] === 1 && $absent === 'dflt' ? true : 'get() = ' . substr((string) json_encode($v), 0, 60) . " after $calls reads";
});
check('cache[file] — 6 processes rewrite a channel record (60 members, 12 KB) while 6 processes read it without a lock: no miss, no damaged read', function () use ($tmp) {
    $wd = "$tmp/race1";
    @mkdir($wd, 0700, true);
    Tfm\Cache::configure(['driver' => 'file', 'dir' => "$wd/cache", 'prefix' => 'w', 'web' => true]);
    Tfm\Cache::set('chan', blobOf(60, 1), 600);
    $out = race($wd, [['chan-writer', 6, 'chan', 2500, 60], ['chan-reader', 6, 'chan', 2500, 60]]);
    $writes = array_sum(array_map('intval', $out['chan-writer']));
    $sum = ['ok' => 0, 'miss' => 0, 'bad' => 0, 'torn' => 0];
    foreach ($out['chan-reader'] as $o) foreach ((array) json_decode($o, true) as $k => $v) $sum[$k] += (int) $v;
    $final = Tfm\Cache::get('chan');
    echo "      ($writes rewrites, {$sum['ok']} whole reads, {$sum['torn']} second looks at a record in mid-write, {$sum['miss']} misses)" . PHP_EOL;
    if ($sum['bad'] !== 0) return "{$sum['bad']} reads returned damaged data";
    if ($writes < 200 || $sum['ok'] < 200) return "too little traffic to mean anything: $writes writes, {$sum['ok']} reads";
    if (!is_array($final) || (int) $final['tick'] !== $writes + 1) return 'lost updates: tick ' . json_encode($final['tick'] ?? null) . " after $writes rewrites";
    return $sum['miss'] === 0 ? true : "{$sum['miss']} misses of a record that always exists (of {$sum['ok']} reads)";
});
check('cache[apcu] — two command-line security changes inside one second both reach the web server', function () use ($tmp, $APCU, $now) {
    if (!$APCU) return ['skip' => 'APCu is not enabled for the command line'];
    $dir = "$tmp/apcu-bust";
    $prefix = 'ab' . bin2hex(random_bytes(2));
    $web = static function () use ($dir, $prefix, $now): void { Tfm\Cache::configure(['driver' => 'apcu', 'dir' => $dir, 'prefix' => $prefix, 'web' => true, 'now' => $now]); };
    for ($try = 0; $try < 5; $try++) {
        $web();
        Tfm\Cache::set('s:u:1', ['id' => 1, 'status' => 'active'], 60);
        Tfm\Cache::set('s:u:2', ['id' => 2, 'status' => 'active'], 60);
        while ((int) (microtime(true) * 1000) % 1000 > 150) usleep(2000);      // the start of a clock second
        $sec = time();
        Tfm\Cache::bust();                                                       // the command line bans account 1 …
        $web();                                                                  // … the web server's next request notices
        $first = Tfm\Cache::get('s:u:1');
        Tfm\Cache::set('s:u:2', ['id' => 2, 'status' => 'active'], 60);          // account 2 is read (and remembered) again
        Tfm\Cache::bust();                                                       // … the command line bans account 2, same second
        $same = time() === $sec;
        $web();
        $second = Tfm\Cache::get('s:u:2');
        if (!$same) continue;                                                    // the second turned in between: again
        return $first === null && $second === null ? true : 'after the 1st change: ' . json_encode($first) . ' · after the 2nd (same second): ' . json_encode($second);
    }
    return ['skip' => 'could not fit both changes into one clock second'];
});

// =============================================================================================== 2. tokens and seats
check('token — an old token is dead once its account was signed out and seated again (a stolen cookie + CSRF token + sync token)', function () use ($T) {
    world();
    $a = seat(7, $T, [], 'old-session');
    $b = body(1, 1);
    $live = Tfm\Sync::hot($a['claims'], $b, $T + 1000);
    if (!is_array($live)) return 'the fresh token was refused';
    Tfm\Sync::revoke(7);                                                  // logout, a ban, a new password, "sign out everywhere"
    if (Tfm\Sync::hot($a['claims'], $b, $T + 2000) !== null) return 'the token survived the revocation';
    $n = seat(7, $T + 3000, [], 'new-session');                           // the owner signs in again
    $replay = Tfm\Sync::hot($a['claims'], $b, $T + 4000);                 // the thief presents the old triple
    $mine = Tfm\Sync::hot($n['claims'], $b, $T + 5000);                   // the owner's own token keeps working
    return $replay === null && is_array($mine) ? true : 'old token after the new login: ' . ($replay === null ? 'refused' : 'ACCEPTED') . ' · new token: ' . (is_array($mine) ? 'ok' : 'refused');
});
check('token — a second browser of the same account keeps its token when the first one renews (only a revocation ends tokens)', function () use ($T) {
    world();
    $a = seat(9, $T, [], 'tab-a');
    $b = seat(9, $T + 1000, [], 'tab-b');                                 // a second tab: the same seat, its own token
    $ra = Tfm\Sync::hot($a['claims'], body(1, 1), $T + 2000);
    $rb = Tfm\Sync::hot($b['claims'], body(1, 1), $T + 3000);
    return is_array($ra) && is_array($rb) ? true : 'tab a: ' . (is_array($ra) ? 'ok' : 'refused') . ' · tab b: ' . (is_array($rb) ? 'ok' : 'refused');
});
check('seat — after 25 hours of play the seat record is still there: a renewal at a full house is not sent to the waiting room and a ban still ends the token', function () use ($T) {
    global $CLOCK;
    world(['capacity.max_online' => 1]);
    $CLOCK = $T;
    try {
        $a = seat(8, $CLOCK);
        for ($i = 1; $i <= 600; $i++) {                                   // 600 renewals, 150 s apart
            $CLOCK = $T + $i * 150000;
            $q = queued(static function () use ($CLOCK) { Tfm\Sync::join(acct(8), inp(1, 1), $CLOCK); });
            if ($q !== null) return 'the seated player was sent to the waiting room after ' . round($i * 150 / 3600, 1) . ' h: ' . json_encode($q);
        }
        if (Tfm\Sync::online($CLOCK) !== 1) return 'seats after 25 h: ' . Tfm\Sync::online($CLOCK);
        $t = seat(8, $CLOCK + 1000);
        Tfm\Sync::revoke(8);
        return Tfm\Sync::hot($t['claims'], body(1, 1), $CLOCK + 2000) === null ? true : 'a ban after 25 h did not end the token';
    } finally { $CLOCK = 0; }
});

// =============================================================================================== 3. the waiting room
check('queue — a full house stays full when the read of the channel list fails three times in a row', function () use ($T) {
    world(['capacity.max_online' => 2]);
    seat(1, $T);
    seat(2, $T + 10);
    $file = fileOf('sy:chans');
    $calls = 0;
    again(['read' => static function (string $f) use ($file, &$calls) {
        $raw = @file_get_contents($f);
        if ($f !== $file || !is_string($raw)) return $raw;
        return ++$calls <= 3 ? substr($raw, 0, intdiv(strlen($raw), 2)) : $raw;
    }]);
    $q = queued(static function () use ($T) { Tfm\Sync::join(acct(3), inp(3, 3), $T + 1000); });
    again();
    return $q !== null && isset($q['pos']) && Tfm\Sync::online($T + 1000) === 2 ? true : 'the third visitor ' . ($q === null ? 'was let in' : json_encode($q)) . ' · seats ' . Tfm\Sync::online($T + 1000) . ' of 2';
});
check('queue — one place per account: asking again without the ticket (a reload) gives the same place, not a new one at the end', function () use ($T) {
    world(['capacity.max_online' => 2]);
    seat(1, $T);
    seat(2, $T + 10);
    $first = queued(static function () use ($T) { Tfm\Sync::join(acct(20), inp(), $T + 100); });
    $other = queued(static function () use ($T) { Tfm\Sync::join(acct(21), inp(), $T + 200); });
    $again = [];
    for ($i = 0; $i < 5; $i++) $again[] = queued(static function () use ($T, $i) { Tfm\Sync::join(acct(20), inp(), $T + 300 + $i * 100); });
    $late = queued(static function () use ($T) { Tfm\Sync::join(acct(22), inp(), $T + 1000); });
    $pos = array_map(static function ($q) { return $q['pos'] ?? null; }, $again);
    $st = Tfm\Gate::status();
    return ($first['pos'] ?? 0) === 1 && ($other['pos'] ?? 0) === 2 && $pos === [1, 1, 1, 1, 1] && ($late['pos'] ?? 0) === 3 && $st['ticketsIssued'] === 3
        ? true : 'first ' . json_encode($first['pos'] ?? $first) . ' · other ' . json_encode($other['pos'] ?? $other) . ' · the same account again ' . json_encode($pos) . ' · a later visitor ' . json_encode($late['pos'] ?? $late) . " · places handed out {$st['ticketsIssued']}";
});
check('queue — a ticket that was used is spent: coming back with it later is a new place behind everybody who waits, not the next free seat', function () use ($T) {
    world(['capacity.max_online' => 2]);
    seat(1, $T);
    seat(2, $T + 10);
    $q20 = queued(static function () use ($T) { Tfm\Sync::join(acct(20), inp(), $T + 100); });
    if (!isset($q20['t'])) return 'no ticket: ' . json_encode($q20);
    Tfm\Sync::revoke(1);                                                  // a seat is free
    $go = Tfm\Gate::poll($q20['t'], $T + 2000);
    if (empty($go['go'])) return 'the turn did not come: ' . json_encode($go);
    $in = queued(static function () use ($T, $q20) { Tfm\Sync::join(acct(20), inp(0, 0, ['qt' => $q20['t']]), $T + 2100); });
    if ($in !== null) return 'not let in with the ticket: ' . json_encode($in);
    $q22 = queued(static function () use ($T) { Tfm\Sync::join(acct(22), inp(), $T + 3000); });      // the house is full again: 22 and 23 wait
    $q23 = queued(static function () use ($T) { Tfm\Sync::join(acct(23), inp(), $T + 3100); });
    Tfm\Sync::revoke(20);                                                 // 20 leaves: its seat goes to 22, the first in line
    $back = queued(static function () use ($T, $q20) { Tfm\Sync::join(acct(20), inp(0, 0, ['qt' => $q20['t']]), $T + 4000); });   // 20 comes back with the old ticket
    if ($back === null) return 'the old ticket let its holder straight in, past the visitors who wait';
    $in22 = queued(static function () use ($T, $q22) { Tfm\Sync::join(acct(22), inp(0, 0, ['qt' => $q22['t']]), $T + 4500); });
    if ($in22 !== null) return 'the first in line was not let in: ' . json_encode($in22);
    Tfm\Sync::revoke(2);                                                  // the next free seat: 23 has waited longest
    $p23 = Tfm\Gate::poll($q23['t'], $T + 6000);
    return ($back['pos'] ?? 0) === 2 && !empty($p23['go']) ? true : 'the old ticket: place ' . json_encode($back['pos'] ?? $back) . ' (behind the one visitor who waits would be 2) · that visitor at the next free seat: ' . json_encode($p23);
});
check('queue — an account cannot hold several places: six calls and six polled tickets are one place, the visitor behind is second', function () use ($T) {
    world(['capacity.max_online' => 2]);
    seat(1, $T);
    seat(2, $T + 10);
    $mine = [];
    for ($i = 0; $i < 6; $i++) { $q = queued(static function () use ($T, $i) { Tfm\Sync::join(acct(30), inp(), $T + 100 + $i * 50); }); if (isset($q['t'])) $mine[$q['t']] = true; }
    $legit = queued(static function () use ($T) { Tfm\Sync::join(acct(31), inp(), $T + 1000); });
    foreach (array_keys($mine) as $i => $t) { try { Tfm\Gate::poll((string) $t, $T + 2000 + $i); } catch (Tfm\ApiException $e) { /* refused */ } }
    Tfm\Sync::revoke(1);                                                  // one seat becomes free
    foreach (array_keys($mine) as $i => $t) { try { Tfm\Gate::poll((string) $t, $T + 4000 + $i); } catch (Tfm\ApiException $e) { /* refused */ } }
    $q = (array) Tfm\Cache::get('g:q');
    $reserved = 0;
    foreach ((array) ($q['adm'] ?? []) as $k => $exp) if (ctype_digit((string) $k)) $reserved++;
    return count($mine) === 1 && ($legit['pos'] ?? 0) === 2 && $reserved <= 1 ? true : 'different tickets for one account: ' . count($mine) . ' · the visitor behind got place ' . json_encode($legit['pos'] ?? $legit) . " · turns reserved at once: $reserved";
});
check('queue — a no-show loses its ticket: a turn that was kept twice and never taken is over; the visitors behind get the seats', function () use ($T) {
    world(['capacity.max_online' => 2]);
    seat(1, $T);
    seat(2, $T + 10);
    $ghost = queued(static function () use ($T) { Tfm\Sync::join(acct(40), inp(), $T + 100); });       // asks and never enters
    $q41 = queued(static function () use ($T) { Tfm\Sync::join(acct(41), inp(), $T + 200); });
    $q42 = queued(static function () use ($T) { Tfm\Sync::join(acct(42), inp(), $T + 300); });
    if (!isset($ghost['t'], $q41['t'], $q42['t'])) return 'no tickets';
    $poll = static function (string $t, int $at): array { try { return Tfm\Gate::poll($t, $at); } catch (Tfm\ApiException $e) { return ['error' => $e->status . ' ' . $e->errorCode]; } };
    /** from $from to $to every 5 s: the waiting visitors ask, and enter when told to; the ghost only asks */
    $entered = [];
    $offers = 0;
    $ghostEnd = '';
    $run = static function (int $from, int $to) use (&$entered, &$offers, &$ghostEnd, $poll, $ghost, $q41, $q42): void {
        for ($t = $from; $t <= $to; $t += 5000) {
            foreach ([41 => $q41, 42 => $q42] as $uid => $q) {
                if (isset($entered[$uid])) continue;
                $r = $poll($q['t'], $t + $uid);
                if (!empty($r['go']) && queued(static function () use ($uid, $q, $t) { Tfm\Sync::join(acct($uid), inp(0, 0, ['qt' => $q['t']]), $t + $uid + 100); }) === null) $entered[$uid] = $t;
            }
            if ($ghostEnd !== '') continue;
            $g = $poll($ghost['t'], $t + 500);
            if (isset($g['error'])) $ghostEnd = $g['error'];
            elseif (!empty($g['go'])) { if (empty($GLOBALS['ghostHeld'])) $offers++; $GLOBALS['ghostHeld'] = true; } else $GLOBALS['ghostHeld'] = false;
        }
    };
    $GLOBALS['ghostHeld'] = false;
    Tfm\Sync::revoke(1);                                                  // a seat is free: the ghost is first in line
    $run($T + 2000, $T + 62000);                                          // its turn is kept 45 s, then the seat goes to 41
    Tfm\Sync::revoke(2);                                                  // another seat: the ghost comes back "late" and is served first once more
    $run($T + 67000, $T + 200000);                                        // … 45 s again, then 42; after that the ghost's ticket is over
    $again = queued(static function () use ($T) { Tfm\Sync::join(acct(40), inp(), $T + 205000); });
    $ok = $offers === 2 && isset($entered[41], $entered[42]) && $ghostEnd === '400 QUEUE_TICKET' && ($again === null || (isset($again['t']) && $again['t'] !== $ghost['t']));
    return $ok ? true : "the no-show was offered a seat $offers times and then: '" . $ghostEnd . "' · entered: " . json_encode($entered) . ' · the ghost asking anew: ' . ($again === null ? 'let in' : (isset($again['t']) && $again['t'] !== $ghost['t'] ? 'a new place' : json_encode($again)));
});
check('queue — a ticket of an older line (the cache was emptied) is no ticket: it neither waits for ever nor takes the turn of the new holder of its number', function () use ($T) {
    world(['capacity.max_online' => 2]);
    seat(1, $T);
    seat(2, $T + 10);
    $old = queued(static function () use ($T) { Tfm\Sync::join(acct(50), inp(), $T + 100); });        // number 1 of the old line
    if (!isset($old['t'])) return 'no ticket';
    Tfm\Cache::del('g:q');                                                // the line is lost (the cache was emptied / restarted)
    $new = queued(static function () use ($T) { Tfm\Sync::join(acct(51), inp(), $T + 1000); });       // number 1 of the new line
    $polled = apiCode(static function () use ($old, $T) { Tfm\Gate::poll($old['t'], $T + 1500); });
    Tfm\Sync::revoke(1);
    $go = Tfm\Gate::poll($new['t'], $T + 3000);                           // 51's turn has come (a seat is reserved for number 1)
    $steal = queued(static function () use ($T, $old) { Tfm\Sync::join(acct(50), inp(0, 0, ['qt' => $old['t']]), $T + 3100); });
    $still = Tfm\Gate::poll($new['t'], $T + 4200);
    return $polled === '400 QUEUE_TICKET' && !empty($go['go']) && $steal !== null && ($steal['pos'] ?? 0) >= 1 && !empty($still['go'])
        ? true : "polling the old ticket: '$polled' · the new holder's turn: " . json_encode($go) . ' · the old ticket at the door: ' . ($steal === null ? 'LET IN' : json_encode($steal['pos'] ?? $steal)) . ' · the new holder afterwards: ' . json_encode($still);
});

// =============================================================================================== 4. meters
check('meters — posts to the login address that never reach a password check do not use up the login meter', function () use ($T) {
    world(['capacity.login_per_sec' => 3, 'capacity.login_concurrent' => 2]);
    for ($try = 0; $try < 3; $try++) {
        $sec = time();
        $refused = 0;
        for ($i = 0; $i < 40; $i++) {                                     // no cookie, no token: each of these ends as 401 / 403 / 429 further on
            request('203.0.113.66', '/api/auth/login.php', 'POST');
            if (apiCode(static function () { Tfm\Gate::enter([]); }) !== '') $refused++;
        }
        request('198.51.100.7', '/api/auth/login.php', 'POST');           // a visitor whose password is about to be checked
        $legit = apiCode(static function () { Tfm\Gate::loginSlot(); });
        Tfm\Gate::loginDone();
        if (time() !== $sec) continue;
        return $refused === 0 && $legit === '' ? true : "$refused of 40 posts were answered LOGIN_BUSY at the door · the real login: '" . $legit . "'";
    }
    return ['skip' => 'the clock second kept turning'];
});
check('meters — the login meter still works where the password is checked: the 4th check of a second and the 3rd at once get 503 LOGIN_BUSY', function () use ($T) {
    world(['capacity.login_per_sec' => 3, 'capacity.login_concurrent' => 0]);
    $codes = [];
    for ($try = 0; $try < 3; $try++) {
        $codes = [];
        $sec = time();
        for ($i = 0; $i < 5; $i++) { request('198.51.100.' . (10 + $i), '/api/auth/login.php', 'POST'); $codes[] = apiCode(static function () { Tfm\Gate::loginSlot(); }); Tfm\Gate::loginDone(); }
        if (time() === $sec) break;
    }
    world(['capacity.login_per_sec' => 0, 'capacity.login_concurrent' => 2]);
    $now = Tfm\Clock::ms();
    $held = [];
    for ($i = 0; $i < 3; $i++) { request('198.51.100.' . (20 + $i), '/api/auth/login.php', 'POST'); $held[] = apiCode(static function () use ($now, $i) { Tfm\Gate::loginSlot($now + $i); }); }
    Tfm\Cache::del('g:lc');
    return $codes === ['', '', '', '503 LOGIN_BUSY', '503 LOGIN_BUSY'] && $held === ['', '', '503 LOGIN_BUSY'] ? true : json_encode($codes) . ' ' . json_encode($held);
});
check('meters — requests that are refused (a flood of one address answered 429 / 401 / 403) are not counted as load: nobody else is shed for them', function () use ($T) {
    world(['capacity.sample' => 1, 'capacity.shed_rps' => 50, 'capacity.target_rps' => 50]);
    for ($i = 0; $i < 300; $i++) {                                        // 300 requests in a second that go no further than the door
        request('203.0.113.70', '/api/ping.php', 'GET');
        try { Tfm\Gate::enter([]); } catch (Tfm\ApiException $e) { /* shed */ }
    }
    request('198.51.100.8', '/api/ping.php', 'GET');                      // a newcomer at another address
    $rps = Tfm\Gate::rps();
    $newcomer = apiCode(static function () { Tfm\Gate::enter([]); });
    if ($newcomer !== '' || $rps >= 50) return "300 refused requests count as $rps requests per second · a newcomer: '$newcomer'";
    for ($i = 0; $i < 300; $i++) Tfm\Gate::count();                       // 300 requests that were really served
    request('198.51.100.9', '/api/ping.php', 'GET');
    $busy = apiCode(static function () { Tfm\Gate::enter([]); });
    return Tfm\Gate::rps() >= 250 && $busy === '503 BUSY' ? true : 'served requests: rps ' . Tfm\Gate::rps() . " · a newcomer then: '$busy'";
});

// =============================================================================================== 5. looks
/** how many records the file cache of the current world holds */
function entries(): int { return (int) (Tfm\Cache::info(true)['entries'] ?? -1); }
check('looks — one account cannot fill the cache with avatar looks: 200 different looks in 80 seconds leave a bounded number of records', function () use ($T) {
    global $CLOCK;
    world();
    $CLOCK = $T;
    try {
        seat(50, $CLOCK, ['ap' => ['hair' => 'short', 'topColor' => '#000000']]);
        $before = entries();
        for ($i = 1; $i <= 200; $i++) {
            $CLOCK += 400;
            Tfm\Sync::join(acct(50), inp(1, 1, ['ap' => ['hair' => 'short', 'topColor' => sprintf('#%06x', $i * 7919)]]), $CLOCK);
        }
        $grown = entries() - $before;
        return $grown >= 1 && $grown <= 60 ? true : "$grown new cache records for 200 looks of one account";
    } finally { $CLOCK = 0; }
});
check('looks — a look nobody wears any more expires within the hour; the look of a player who stays is kept and still served', function () use ($T) {
    global $CLOCK;
    world();
    $CLOCK = $T;
    try {
        $lookA = ['hair' => 'bun', 'topColor' => '#a1b2c3'];
        $lookB = ['hair' => 'curly', 'topColor' => '#0f0e0d'];
        seat(60, $CLOCK, ['ap' => $lookA]);                               // stays for two hours
        seat(61, $CLOCK + 10, ['ap' => $lookB]);                          // leaves at once
        $who = Tfm\Sync::hot(seat(62, $CLOCK + 20)['claims'], body(2, 2, ['q' => ['60', '61']]), $CLOCK + 1000);
        $idA = $who['who']['60'][1] ?? '';
        $idB = $who['who']['61'][1] ?? '';
        if ($idA === '' || $idB === '' || !isset($who['ap'][$idA], $who['ap'][$idB])) return 'looks were not served: ' . substr((string) json_encode($who), 0, 200);
        Tfm\Sync::revoke(61);
        for ($i = 1; $i <= 48; $i++) {                                    // two hours: 60 and 62 renew every 150 s
            $CLOCK = $T + $i * 150000;
            Tfm\Sync::join(acct(60), inp(1, 1), $CLOCK);
            Tfm\Sync::join(acct(62), inp(2, 2), $CLOCK + 5);
        }
        $c62 = seat(62, $CLOCK + 10)['claims'];
        again();                                                          // the next request: nothing is remembered in this process
        $later = Tfm\Sync::hot($c62, body(2, 2, ['q' => ['60'], 'w' => [$idB]]), $CLOCK + 1000);
        $kept = isset($later['ap'][$idA]) && $later['ap'][$idA] === $lookA;
        $gone = Tfm\Cache::get('sy:a:' . $idB) === null;
        return $kept && $gone ? true : 'the look in use: ' . ($kept ? 'served' : 'LOST') . ' · the abandoned look after two hours: ' . ($gone ? 'expired' : 'still stored');
    } finally { $CLOCK = 0; }
});
check('looks — a look stored under the id of another look does not replace it: everybody still sees the player\'s own look', function () use ($T) {
    world();
    $victim = ['hair' => 'bun', 'topColor' => '#112233'];
    $id = substr(sha1((string) Tfm\Presence::appearance($victim)), 0, 8);
    Tfm\Cache::set('sy:a:' . $id, ['hair' => 'buzz', 'topColor' => '#ff0000'], 3600);   // another look got there first (a prepared collision)
    seat(70, $T, ['ap' => $victim]);
    $c71 = seat(71, $T + 10)['claims'];
    again();                                                              // the next request: nothing is remembered in this process
    $r = Tfm\Sync::hot($c71, body(1, 1, ['q' => ['70']]), $T + 1000);
    $got = $r['who']['70'][1] ?? '';
    $look = $r['ap'][$got] ?? null;
    return $look === $victim ? true : 'the others are shown ' . json_encode($look) . ' instead of ' . json_encode($victim);
});

// =============================================================================================== done
foreach (['channels.size', 'channels.hard', 'capacity.max_online', 'capacity.seat_ttl', 'capacity.shed_rps', 'capacity.sample', 'capacity.target_rps', 'capacity.login_per_sec', 'capacity.login_concurrent',
    'sync.max_near', 'sync.aoi_radius', 'sync.min_gap_ms', 'rate_limits.sync'] as $k) Tfm\Config::override($k, null);
Tfm\Cache::reset();
// the throw-away folder: remove what this run wrote
$rm = static function (string $d) use (&$rm): void {
    foreach (@scandir($d) ?: [] as $f) {
        if ($f === '.' || $f === '..') continue;
        $p = $d . DIRECTORY_SEPARATOR . $f;
        if (is_dir($p) && !is_link($p)) $rm($p); else @unlink($p);
    }
    @rmdir($d);
};
if (strpos($tmp, 'tfm-scale-attack-') !== false) $rm($tmp);
echo PHP_EOL . "$passed passed, $failed failed" . ($skipped ? ", $skipped skipped" : '') . PHP_EOL;
exit($failed > 0 ? 1 : 0);
