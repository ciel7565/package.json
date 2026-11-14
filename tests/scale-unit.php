<?php
/**
 * tests/scale-unit.php — unit checks for the scale work of CONTRACT §16.9 (server side):
 *   Tfm\Cache (file and db drivers; APCu when the extension is enabled for the command line), the hot-path diet
 *   (rate limits, IP blocks, the cached account row, sessions), Tfm\Sync (token, channels, area of interest, wire
 *   format, the statement budget of the hot path), Tfm\Gate (seats, queue tickets, login metering, shedding) and saves.
 * No web server. A throw-away data folder with SQLite — or MariaDB with the TFM_DB_* variables:
 *
 *   php tests/scale-unit.php
 *   TFM_DB_DRIVER=mysql TFM_DB_HOST=127.0.0.1 TFM_DB_PORT=33106 TFM_DB_USER=root TFM_DB_NAME=tfm_ss_unit php tests/scale-unit.php
 *   TFM_UNIT_ONLY=<text>   only the checks whose name contains <text>
 *
 * Concurrency checks start several PHP processes of this very file (`--worker <job> …`): the counters, add(), the
 * named lock and half-written files are exercised by real parallel processes, not by a simulation.
 * CLI only; never deployed (tests/ is not part of the web root). Developer tooling: runs on the dev PHP (8.x).
 */
declare(strict_types=1);

if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }

// ------------------------------------------------------------------ worker mode (a child process of a concurrency check)
if (isset($argv[1]) && $argv[1] === '--worker') {
    $job = (string) ($argv[2] ?? '');
    $dir = (string) ($argv[3] ?? '');
    putenv('TFM_DATA_DIR=' . $dir . '/data');
    require __DIR__ . '/../server/lib/bootstrap.php';
    Tfm\Cache::configure(['driver' => (string) ($argv[4] ?? 'file'), 'dir' => $dir . '/cache', 'prefix' => 'w']);
    $a = array_slice($argv, 5);
    $until = static function (float $t): void { while (microtime(true) < $t) usleep(200); };
    switch ($job) {
        case 'inc': {                      // <key> <n> <startAt>
            $until((float) $a[2]);
            $ok = 0;
            for ($i = 0; $i < (int) $a[1]; $i++) if (Tfm\Cache::inc($a[0], 1, 60) !== false) $ok++;
            echo $ok;
            break;
        }
        case 'win': {                      // <key> <n> <startAt>
            $until((float) $a[2]);
            $ok = 0;
            for ($i = 0; $i < (int) $a[1]; $i++) if (Tfm\Cache::hitWindow($a[0], 7, 60) !== false) $ok++;
            echo $ok;
            break;
        }
        case 'mut': {                      // <key> <n> <startAt> — every process adds 1 to a field of a 3 KB array
            $until((float) $a[2]);
            $ok = 0;
            for ($i = 0; $i < (int) $a[1]; $i++) {
                $r = Tfm\Cache::mutate($a[0], static function ($old) { $o = is_array($old) ? $old : ['n' => 0, 'pad' => str_repeat('x', 3000)]; $o['n']++; return $o; }, 60);
                if (is_array($r)) $ok++;
            }
            echo $ok;
            break;
        }
        case 'add': {                      // <key> <startAt>
            $until((float) $a[1]);
            echo Tfm\Cache::add($a[0], getmypid(), 60) ? '1' : '0';
            break;
        }
        case 'hold': {                     // <name> <ms>
            if (!Tfm\Cache::lock($a[0], 10, 0)) { echo 'X'; break; }
            echo 'L';
            flush();
            usleep((int) $a[1] * 1000);
            Tfm\Cache::unlock($a[0]);
            break;
        }
        case 'writer': {                   // <key> <ms> — rewrites one key with records of very different sizes
            $end = microtime(true) + (int) $a[1] / 1000;
            $n = 0;
            $vals = [['tag' => 'A', 'body' => str_repeat('a', 700)], ['tag' => 'B', 'body' => str_repeat('b', 30000)], ['tag' => 'C', 'body' => str_repeat('c', 5000)]];
            while (microtime(true) < $end) {
                $v = $vals[$n % 3];
                if ($n % 2) Tfm\Cache::set($a[0], $v, 60); else Tfm\Cache::mutate($a[0], static function () use ($v) { return $v; }, 60);
                $n++;
            }
            echo $n;
            break;
        }
        case 'reader': {                   // <key> <ms>
            $end = microtime(true) + (int) $a[1] / 1000;
            $r = ['ok' => 0, 'miss' => 0, 'bad' => 0, 'torn' => 0];
            $len = ['A' => 700, 'B' => 30000, 'C' => 5000];
            while (microtime(true) < $end) {
                $v = Tfm\Cache::get($a[0]);
                if ($v === null) $r['miss']++;
                elseif (is_array($v) && isset($v['tag'], $v['body'], $len[$v['tag']]) && $v['body'] === str_repeat(strtolower($v['tag']), $len[$v['tag']])) $r['ok']++;
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
$tmp = sys_get_temp_dir() . '/tfm-scale-' . bin2hex(random_bytes(6));
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
/** start $n worker processes of this file and wait for them: [stdout of each] */
function workers(int $n, string $job, string $dir, string $driver, array $args): array
{
    $procs = [];
    for ($i = 0; $i < $n; $i++) {
        $cmd = array_merge([PHP_BINARY, __FILE__, '--worker', $job, $dir, $driver], array_map('strval', $args));
        $p = proc_open($cmd, [1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes, null, getenv());
        if (!is_resource($p)) throw new RuntimeException('cannot start a worker process');
        $procs[] = [$p, $pipes];
    }
    $out = [];
    foreach ($procs as $pp) {
        $o = stream_get_contents($pp[1][1]);
        $e = stream_get_contents($pp[1][2]);
        fclose($pp[1][1]);
        fclose($pp[1][2]);
        proc_close($pp[0]);
        if (trim((string) $e) !== '') throw new RuntimeException('worker error: ' . substr(trim((string) $e), 0, 300));
        $out[] = (string) $o;
    }
    return $out;
}
$CLOCK = 0;   // 0 = the real clock; else a fixed "now" in ms for the cache
$now = static function () use (&$CLOCK): int { return $CLOCK > 0 ? $CLOCK : (int) floor(microtime(true) * 1000); };
$cacheDir = $tmp . '/c1';
/** a fresh cache of one driver for a check */
function useCache(string $driver, string $dir, string $prefix = 'u'): void
{
    global $now;
    Tfm\Cache::configure(['driver' => $driver, 'dir' => $dir, 'prefix' => $prefix, 'now' => $now]);
}

Tfm\Db::pdo(); // creates the schema
echo 'driver: ' . Tfm\Db::driver() . ' · PHP ' . PHP_VERSION . ' · APCu ' . (function_exists('apcu_enabled') && apcu_enabled() ? 'on' : 'off') . PHP_EOL;
$RUN = bin2hex(random_bytes(3));

// =============================================================================================== 1. Tfm\Cache
$drivers = ['file', 'db'];
if (function_exists('apcu_enabled') && apcu_enabled()) $drivers[] = 'apcu';
foreach ($drivers as $drv) {
    $d = "$tmp/cache-$drv";
    $p = 'u' . $RUN;
    check("cache[$drv] — the configured driver is the one in use", function () use ($drv, $d, $p) {
        useCache($drv, $d, $p);
        return Tfm\Cache::driver() === $drv && Tfm\Cache::available() ? true : 'driver() = ' . Tfm\Cache::driver();
    });
    check("cache[$drv] — get / set / del round trip for scalars, lists, maps, Korean text and markup characters", function () use ($drv, $d, $p) {
        useCache($drv, $d, $p);
        $vals = ['int' => 42, 'neg' => -7, 'float' => 1.5, 'whole' => 2.0, 'true' => true, 'false' => false, 'str' => '장독대 <b>&amp;</b> "따옴표" \' <?php echo 1; ?>', 'empty' => '', 'zero' => 0,
            'list' => [1, 'two', [3, 4]], 'map' => ['a' => 1, 'nested' => ['x' => 'y', 'n' => null]], 'big' => str_repeat('가나다라', 5000)];
        foreach ($vals as $k => $v) if (!Tfm\Cache::set("rt:$k", $v, 60)) return "set($k) failed";
        foreach ($vals as $k => $v) {
            $got = Tfm\Cache::get("rt:$k");
            if ($got !== $v) return "get($k) = " . substr((string) json_encode($got), 0, 80);
        }
        if (Tfm\Cache::get('rt:none') !== null || Tfm\Cache::get('rt:none', 'dflt') !== 'dflt') return 'a missing key did not give the default';
        Tfm\Cache::del('rt:int');
        if (Tfm\Cache::get('rt:int') !== null) return 'del did not remove the entry';
        Tfm\Cache::set('rt:neg', null);
        return Tfm\Cache::get('rt:neg') === null ? true : 'set(null) did not delete';
    });
    check("cache[$drv] — TTL: an entry is gone after its time, an entry without TTL stays", function () use ($drv, $d, $p) {
        global $CLOCK;
        if ($drv === 'apcu') return ['skip' => 'APCu keeps its own clock'];
        useCache($drv, $d, $p);
        $CLOCK = 1800000000000;
        Tfm\Cache::set('ttl:a', 'x', 10);
        Tfm\Cache::set('ttl:b', 'y', 0);
        $CLOCK += 9999;
        $before = Tfm\Cache::get('ttl:a');
        $CLOCK += 2;
        $after = Tfm\Cache::get('ttl:a');
        $CLOCK += 86400000 * 400;
        $forever = Tfm\Cache::get('ttl:b');
        $CLOCK = 0;
        return $before === 'x' && $after === null && $forever === 'y' ? true : json_encode([$before, $after, $forever]);
    });
    check("cache[$drv] — add() stores only when the key is absent or expired", function () use ($drv, $d, $p) {
        global $CLOCK;
        useCache($drv, $d, $p);
        $k = 'add:' . bin2hex(random_bytes(3));
        $a = Tfm\Cache::add($k, 'first', 5);
        $b = Tfm\Cache::add($k, 'second', 5);
        $v = Tfm\Cache::get($k);
        if ($drv === 'apcu') return $a && !$b && $v === 'first' ? true : json_encode([$a, $b, $v]);
        $CLOCK = (int) floor(microtime(true) * 1000) + 6000;
        $c = Tfm\Cache::add($k, 'third', 5);
        $v2 = Tfm\Cache::get($k);
        $CLOCK = 0;
        return $a && !$b && $v === 'first' && $c && $v2 === 'third' ? true : json_encode([$a, $b, $v, $c, $v2]);
    });
    check("cache[$drv] — inc() counts from 1, keeps the first TTL and starts over after it", function () use ($drv, $d, $p) {
        global $CLOCK;
        useCache($drv, $d, $p);
        $k = 'inc:' . bin2hex(random_bytes(3));
        $r = [Tfm\Cache::inc($k, 1, 10), Tfm\Cache::inc($k, 1, 10), Tfm\Cache::inc($k, 5, 10)];
        if ($r !== [1, 2, 7]) return 'counted ' . json_encode($r);
        if ($drv === 'apcu') return true;
        $CLOCK = (int) floor(microtime(true) * 1000) + 9000;
        $late = Tfm\Cache::inc($k, 1, 10);              // still inside the first window: the TTL was not pushed back
        $CLOCK += 2000;
        $fresh = Tfm\Cache::inc($k, 1, 10);
        $CLOCK = 0;
        return $late === 8 && $fresh === 1 ? true : "late $late, fresh $fresh";
    });
    check("cache[$drv] — mutate() reads, changes and deletes in one step; remember() computes once", function () use ($drv, $d, $p) {
        useCache($drv, $d, $p);
        $k = 'mut:' . bin2hex(random_bytes(3));
        $a = Tfm\Cache::mutate($k, function ($old) { return ['n' => ($old['n'] ?? 0) + 1]; }, 60);
        $b = Tfm\Cache::mutate($k, function ($old) { return ['n' => ($old['n'] ?? 0) + 1]; }, 60);
        $c = Tfm\Cache::mutate($k, function ($old) { return null; }, 60);
        $gone = Tfm\Cache::get($k);
        $calls = 0;
        $make = function () use (&$calls) { $calls++; return ['made' => $calls]; };
        $r1 = Tfm\Cache::remember("$k:r", 60, $make);
        $r2 = Tfm\Cache::remember("$k:r", 60, $make);
        return $a === ['n' => 1] && $b === ['n' => 2] && $c === null && $gone === null && $calls === 1 && $r1 === $r2 ? true : json_encode([$a, $b, $c, $gone, $calls]);
    });
    check("cache[$drv] — hitWindow() counts this window and remembers the one before", function () use ($drv, $d, $p) {
        useCache($drv, $d, $p);
        $k = 'win:' . bin2hex(random_bytes(3));
        $r = [];
        foreach ([100, 100, 100, 101, 101, 103] as $w) $r[] = Tfm\Cache::hitWindow($k, $w, 120);
        return $r === [[1, 0], [2, 0], [3, 0], [1, 3], [2, 3], [1, 0]] ? true : json_encode($r);
    });
    check("cache[$drv] — the key prefix separates two installations in one store", function () use ($drv, $d, $p) {
        useCache($drv, $d, $p . 'a');
        Tfm\Cache::set('pfx', 'mine', 60);
        useCache($drv, $d, $p . 'b');
        $other = Tfm\Cache::get('pfx');
        Tfm\Cache::set('pfx', 'theirs', 60);
        useCache($drv, $d, $p . 'a');
        $mine = Tfm\Cache::get('pfx');
        return $other === null && $mine === 'mine' ? true : json_encode([$other, $mine]);
    });
    check("cache[$drv] — a very long key and a key with odd characters work", function () use ($drv, $d, $p) {
        useCache($drv, $d, $p);
        $long = str_repeat('k', 600);
        $odd = "a/b\\c:d e\n\0\u{AC00}|*?";
        Tfm\Cache::set($long, 1, 60);
        Tfm\Cache::set($long . 'x', 2, 60);
        Tfm\Cache::set($odd, 3, 60);
        return Tfm\Cache::get($long) === 1 && Tfm\Cache::get($long . 'x') === 2 && Tfm\Cache::get($odd) === 3 ? true : 'values mixed up';
    });
    check("cache[$drv] — a named lock is exclusive between processes and times out", function () use ($drv, $d, $p, $tmp) {
        if ($drv !== 'file') {
            useCache($drv, $d, $p);
            $n = 'lk' . bin2hex(random_bytes(3));
            $a = Tfm\Cache::lock($n, 5, 0);
            $again = Tfm\Cache::lock($n, 5, 0);           // the holder itself
            Tfm\Cache::unlock($n);
            $b = Tfm\Cache::lock($n, 5, 0);
            Tfm\Cache::unlock($n);
            return $a && $again && $b ? true : json_encode([$a, $again, $b]);
        }
        $wd = "$tmp/wl";
        @mkdir($wd, 0700, true);
        $name = 'lk' . bin2hex(random_bytes(3));
        $cmd = [PHP_BINARY, __FILE__, '--worker', 'hold', $wd, 'file', $name, '1500'];
        $h = proc_open($cmd, [1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes, null, getenv());
        $first = fread($pipes[1], 1);                    // 'L' once the other process holds the lock
        Tfm\Cache::configure(['driver' => 'file', 'dir' => "$wd/cache", 'prefix' => 'w']);
        $t0 = microtime(true);
        $refused = Tfm\Cache::lock($name, 10, 300);       // must give up after about 300 ms
        $waited = (microtime(true) - $t0) * 1000;
        $t1 = microtime(true);
        $got = Tfm\Cache::lock($name, 10, 5000);          // the holder lets go after 1.5 s
        $waited2 = (microtime(true) - $t1) * 1000;
        Tfm\Cache::unlock($name);
        fclose($pipes[1]); fclose($pipes[2]); proc_close($h);
        return $first === 'L' && $refused === false && $waited >= 250 && $waited < 1200 && $got === true && $waited2 < 4000
            ? true : json_encode(['first' => $first, 'refused' => $refused, 'waitedMs' => round($waited), 'got' => $got, 'waited2Ms' => round($waited2)]);
    });
}

// ---- real parallel processes (file driver: the default on XAMPP)
check('cache[file] — inc() is atomic: 8 processes × 400 increments of one counter = 3,200', function () use ($tmp) {
    $wd = "$tmp/w1";
    @mkdir($wd, 0700, true);
    $out = workers(8, 'inc', $wd, 'file', ['ctr', 400, microtime(true) + 0.25]);
    Tfm\Cache::configure(['driver' => 'file', 'dir' => "$wd/cache", 'prefix' => 'w']);
    $v = Tfm\Cache::get('ctr');
    return $v === 3200 && array_sum(array_map('intval', $out)) === 3200 ? true : "counter = " . json_encode($v) . ', successes ' . implode('+', $out);
});
check('cache[file] — hitWindow() is atomic: 6 processes × 300 hits = 1,800 in the window', function () use ($tmp) {
    $wd = "$tmp/w2";
    @mkdir($wd, 0700, true);
    workers(6, 'win', $wd, 'file', ['rl', 300, microtime(true) + 0.25]);
    Tfm\Cache::configure(['driver' => 'file', 'dir' => "$wd/cache", 'prefix' => 'w']);
    $r = Tfm\Cache::hitWindow('rl', 7, 60);
    return $r === [1801, 0] ? true : json_encode($r);
});
check('cache[file] — mutate() is atomic: 6 processes × 200 read-modify-writes of a 3 KB record lose nothing', function () use ($tmp) {
    $wd = "$tmp/w3";
    @mkdir($wd, 0700, true);
    workers(6, 'mut', $wd, 'file', ['blob', 200, microtime(true) + 0.25]);
    Tfm\Cache::configure(['driver' => 'file', 'dir' => "$wd/cache", 'prefix' => 'w']);
    $v = Tfm\Cache::get('blob');
    return is_array($v) && $v['n'] === 1200 && strlen($v['pad']) === 3000 ? true : 'n = ' . json_encode($v['n'] ?? null);
});
check('cache[file] — add() is exclusive: of 12 processes released at the same instant exactly one wins', function () use ($tmp) {
    $wins = [];
    for ($round = 0; $round < 5; $round++) {
        $wd = "$tmp/w4-$round";
        @mkdir($wd, 0700, true);
        $out = workers(12, 'add', $wd, 'file', ['once', microtime(true) + 0.3]);
        $wins[] = array_sum(array_map('intval', $out));
    }
    return $wins === [1, 1, 1, 1, 1] ? true : 'winners per round: ' . implode(', ', $wins);
});
check('cache[file] — a half-written file is never read: 3 writers rewrite one key (0.7 / 5 / 30 KB records) while 4 readers read it', function () use ($tmp) {
    $wd = "$tmp/w5";
    @mkdir($wd, 0700, true);
    Tfm\Cache::configure(['driver' => 'file', 'dir' => "$wd/cache", 'prefix' => 'w']);
    Tfm\Cache::set('hot', ['tag' => 'A', 'body' => str_repeat('a', 700)], 60);
    $procs = [];
    foreach ([['writer', 3], ['reader', 4]] as $spec) {
        for ($i = 0; $i < $spec[1]; $i++) {
            $p = proc_open([PHP_BINARY, __FILE__, '--worker', $spec[0], $wd, 'file', 'hot', '1500'], [1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes, null, getenv());
            $procs[] = [$spec[0], $p, $pipes];
        }
    }
    $writes = 0;
    $sum = ['ok' => 0, 'miss' => 0, 'bad' => 0, 'torn' => 0];
    foreach ($procs as $pp) {
        $o = stream_get_contents($pp[2][1]);
        $e = stream_get_contents($pp[2][2]);
        fclose($pp[2][1]); fclose($pp[2][2]); proc_close($pp[1]);
        if (trim((string) $e) !== '') return 'worker error: ' . substr(trim((string) $e), 0, 200);
        if ($pp[0] === 'writer') $writes += (int) $o;
        else foreach ((array) json_decode((string) $o, true) as $k => $v) $sum[$k] += (int) $v;
    }
    echo "      ($writes writes, {$sum['ok']} whole reads, {$sum['torn']} re-reads of a record in mid-write, {$sum['miss']} misses)" . PHP_EOL;
    if ($sum['bad'] !== 0) return "{$sum['bad']} reads returned damaged data";
    if ($writes < 300 || $sum['ok'] < 300) return "too little traffic to mean anything: $writes writes, {$sum['ok']} reads";
    return $sum['miss'] <= (int) ($sum['ok'] / 200) ? true : "{$sum['miss']} misses of an entry that always exists (of {$sum['ok']} reads)";
});
check('cache[file] — damaged files (cut short, wrong checksum, wrong length, empty, foreign text, no header) are misses and get replaced', function () use ($tmp) {
    $wd = "$tmp/w6";
    Tfm\Cache::configure(['driver' => 'file', 'dir' => $wd, 'prefix' => 'w']);
    Tfm\Cache::set('dmg', ['v' => str_repeat('z', 500)], 60);
    $files = glob("$wd/??/*.php");
    if (count($files) !== 1) return 'expected one record file, found ' . count($files);
    $good = file_get_contents($files[0]);
    $guardEnd = strpos($good, "?>\n") + 3;
    $bad = [
        'cut short' => substr($good, 0, strlen($good) - 40),
        'wrong checksum' => substr($good, 0, -1) . 'y',
        'wrong length' => preg_replace('/^(TFC1 \d+ )\d+/m', '${1}9999', $good),
        'empty' => '',
        'guard only' => substr($good, 0, $guardEnd),
        'foreign text' => "<?php echo 'x';\n",
        'no payload' => substr($good, 0, $guardEnd) . "TFC1 0 5 00000000\n",
        'header garbage' => substr($good, 0, $guardEnd) . "TFC1 x y z\n{}",
    ];
    foreach ($bad as $what => $content) {
        file_put_contents($files[0], $content);
        if (Tfm\Cache::get('dmg') !== null) return "$what: get() returned a value";
        if (Tfm\Cache::inc('dmg', 1, 60) !== 1) return "$what: inc() did not start a fresh counter";
        if (Tfm\Cache::get('dmg') !== 1) return "$what: the replaced record is not readable";
    }
    return true;
});
check('cache[file] — the record file is PHP-guarded, private and hides markup: requested over the web it prints nothing', function () use ($tmp) {
    $wd = "$tmp/w7";
    Tfm\Cache::configure(['driver' => 'file', 'dir' => $wd, 'prefix' => 'w']);
    Tfm\Cache::set('guard', ['text' => '<?php echo "RAN"; ?><script>alert(1)</script>'], 60);
    $f = glob("$wd/??/*.php")[0];
    $raw = file_get_contents($f);
    if (strpos($raw, '<?php if (function_exists(\'header_remove\')) header_remove(\'X-Powered-By\'); http_response_code(404); exit; ?>') !== 0) return 'no exit guard at the first byte';
    if (substr_count($raw, '<?') !== 1 || strpos($raw, '<script') !== false) return 'markup characters reached the file raw';
    if (!preg_match('#/[0-9a-f]{2}/[0-9a-f]{40}\.php$#', $f)) return 'unexpected file name ' . basename($f);
    $out = shell_exec(escapeshellarg(PHP_BINARY) . ' ' . escapeshellarg($f) . ' 2>&1');
    return trim((string) $out) === '' ? true : 'running the file printed: ' . substr((string) $out, 0, 80);
});
check('cache[file] — Windows-safe writes: a refused rename is retried and then written in place; a refused delete leaves an expired mark', function () use ($tmp) {
    $wd = "$tmp/w8";
    $tries = 0;
    Tfm\Cache::configure(['driver' => 'file', 'dir' => $wd, 'prefix' => 'w', 'rename' => function ($from, $to, $i) use (&$tries) { $tries++; return $tries >= 3 ? rename($from, $to) : false; }]);
    $big = ['body' => str_repeat('r', 20000)];
    if (!Tfm\Cache::set('ren', $big, 60) || Tfm\Cache::get('ren') !== $big || $tries !== 3) return "retry: the value was not stored after $tries rename tries";
    $tries2 = 0;
    Tfm\Cache::configure(['driver' => 'file', 'dir' => $wd, 'prefix' => 'w', 'rename' => function () use (&$tries2) { $tries2++; return false; }]);
    $big2 = ['body' => str_repeat('s', 21000)];
    if (!Tfm\Cache::set('ren', $big2, 60) || Tfm\Cache::get('ren') !== $big2) return 'fallback: the value was not written in place when every rename failed';
    if ($tries2 !== 4) return "fallback after $tries2 tries (expected 4)";
    if (glob("$wd/??/*.tmp") || glob("$wd/??/*.tmp.php")) return 'a temp file was left behind';
    Tfm\Cache::configure(['driver' => 'file', 'dir' => $wd, 'prefix' => 'w', 'unlink' => function () { return false; }]);
    if (!Tfm\Cache::del('ren') || Tfm\Cache::get('ren') !== null) return 'a file that cannot be removed still answered';
    if (!Tfm\Cache::add('ren', 'again', 60) || Tfm\Cache::get('ren') !== 'again') return 'the expired mark blocks a new value';
    $src = file_get_contents(__DIR__ . '/../server/lib/Cache.php');
    foreach (['posix_', 'symlink(', 'chmod('] as $bad) if (strpos($src, $bad) !== false) return "Cache.php uses $bad";
    return strpos($src, 'DIRECTORY_SEPARATOR') !== false ? true : 'paths are not built with DIRECTORY_SEPARATOR';
});
check('cache[file] — a reader that cannot open the file for a moment (Windows sharing) looks again', function () use ($tmp) {
    $wd = "$tmp/w9";
    Tfm\Cache::configure(['driver' => 'file', 'dir' => $wd, 'prefix' => 'w']);
    Tfm\Cache::set('busy', 'value', 60);
    $n = 0;
    Tfm\Cache::configure(['driver' => 'file', 'dir' => $wd, 'prefix' => 'w', 'read' => function ($file) use (&$n) { $n++; return $n <= 2 ? false : file_get_contents($file); }]);
    $v = Tfm\Cache::get('busy');
    return $v === 'value' && $n === 3 && Tfm\Cache::stats()['torn'] === 2 ? true : json_encode([$v, $n, Tfm\Cache::stats()]);
});
check('cache[file] — purge() removes expired records and stale temp files, keeps live ones; the folder is closed to the web', function () use ($tmp) {
    global $CLOCK;
    $wd = "$tmp/w10";
    $CLOCK = 1800000000000;
    useCache('file', $wd, 'w');
    for ($i = 0; $i < 40; $i++) Tfm\Cache::set("old:$i", $i, 5);
    for ($i = 0; $i < 25; $i++) Tfm\Cache::set("live:$i", $i, 3600);
    for ($i = 0; $i < 5; $i++) Tfm\Cache::set("keep:$i", $i, 0);
    $stale = glob("$wd/??")[0] . '/' . str_repeat('a', 40) . '.1-2.tmp.php';   // a writer died before its rename
    $staleOld = glob("$wd/??")[0] . '/' . str_repeat('b', 40) . '.php.1-2.tmp'; // the same, named as an earlier build did
    foreach ([$stale, $staleOld] as $f) { file_put_contents($f, 'x'); touch($f, time() - 3600); }
    $CLOCK += 60000;
    $r = Tfm\Cache::purge();
    $left = count(glob("$wd/??/*.php"));
    $ok = $r['removed'] === 42 && $r['kept'] === 30 && $left === 30 && !file_exists($stale) && !file_exists($staleOld) && Tfm\Cache::get('live:3') === 3 && Tfm\Cache::get('keep:4') === 4 && Tfm\Cache::get('old:3') === null;
    $CLOCK = 0;
    if (!$ok) return json_encode($r) . " left $left";
    Tfm\Cache::reset();                                   // the real configuration: data/cache with its deny files
    Tfm\Cache::set('x', 1, 5);
    $real = Tfm\Config::dataDir() . '/cache';
    return Tfm\Cache::driver() === 'file' && is_file("$real/.htaccess") && is_file("$real/index.php") && strpos((string) file_get_contents("$real/.htaccess"), 'denied') !== false ? true : 'data/cache has no deny files';
});
check('cache — driver "off" answers every call with a miss and never throws; an unusable folder turns the cache off', function () use ($tmp) {
    Tfm\Cache::configure(['driver' => 'off']);
    $r = [Tfm\Cache::set('a', 1), Tfm\Cache::get('a', 'd'), Tfm\Cache::add('a', 1), Tfm\Cache::inc('a'), Tfm\Cache::del('a'), Tfm\Cache::mutate('a', function () { return 1; }), Tfm\Cache::hitWindow('a', 1, 60), Tfm\Cache::lock('a'), Tfm\Cache::available()];
    if ($r !== [false, 'd', false, false, false, false, false, false, false]) return json_encode($r);
    $made = 0;
    $v = Tfm\Cache::remember('a', 60, function () use (&$made) { $made++; return 'fresh'; });
    $v2 = Tfm\Cache::remember('a', 60, function () use (&$made) { $made++; return 'fresh'; });
    if ($v !== 'fresh' || $v2 !== 'fresh' || $made !== 2) return 'remember() must compute every time when nothing can be cached';
    file_put_contents("$tmp/notadir", 'x');
    Tfm\Cache::configure(['driver' => 'file', 'dir' => "$tmp/notadir/cache"]);
    $drv = Tfm\Cache::driver();
    $s = @Tfm\Cache::set('a', 1, 5);
    Tfm\Cache::reset();
    return $drv === 'off' && $s === false ? true : "driver $drv, set " . json_encode($s);
});
check('cache — the command line tells an in-memory web cache about security changes (bust file), other keys do not', function () use ($tmp) {
    $wd = "$tmp/w11";
    Tfm\Cache::configure(['driver' => 'file', 'dir' => $wd, 'prefix' => 'w']);
    Tfm\Cache::set('plain', 1, 60);
    Tfm\Cache::del('plain');
    if (file_exists("$wd/bust")) return 'an ordinary key touched the bust file';
    Tfm\Cache::del('s:u:5');
    if (!file_exists("$wd/bust")) return 'deleting a security key on the command line left no bust file';
    unlink("$wd/bust");
    Tfm\Cache::set('s:rev:5', 123, 60);
    if (!file_exists("$wd/bust")) return 'setting a security key on the command line left no bust file';
    unlink("$wd/bust");
    Tfm\Cache::configure(['driver' => 'file', 'dir' => $wd, 'prefix' => 'w', 'web' => true]);   // a web request shares the files: no bust needed
    Tfm\Cache::del('s:u:5');
    return !file_exists("$wd/bust") ? true : 'a web request wrote the bust file';
});


// =============================================================================================== 2. the hot-path diet
Tfm\Cache::reset();
$nUsers = 0;
/** a fresh account (unique per run, so a shared MariaDB database can be reused) */
function newUser(string $role = ''): array
{
    global $RUN, $nUsers;
    $nUsers++;
    return Tfm\Users::create("scale{$RUN}{$nUsers}@example.com", 'Sc' . substr($RUN, 0, 4) . $nUsers, 'Ferment2026ok', $role);
}
/** pretend the next calls belong to a request from $ip for $script */
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
/** statements run by $fn */
function sqlOf(callable $fn): int
{
    $a = Tfm\Db::stats()['statements'];
    $fn();
    return Tfm\Db::stats()['statements'] - $a;
}
request('203.0.113.10');

check('diet — a short-window rate limit is counted in the cache: the same 429 + Retry-After at limit + 1, no table row, no statement', function () {
    $ident = 'u:' . random_int(100000, 999999);
    $n = sqlOf(function () use ($ident) { for ($i = 0; $i < 5; $i++) Tfm\RateLimit::hit('unit_short', $ident, 5, 60); });
    if ($n !== 0) return "$n statements for 5 hits";
    try { Tfm\RateLimit::hit('unit_short', $ident, 5, 60); return 'the 6th hit was not refused'; }
    catch (Tfm\ApiException $e) {
        if ($e->status !== 429 || $e->errorCode !== 'RATE_LIMITED' || !preg_grep('/^Retry-After: [1-9]\d*$/', $e->headers) || (int) $e->data['retryAfter'] < 1) return 'unexpected refusal: ' . $e->status . ' ' . json_encode($e->headers);
    }
    $rows = (int) Tfm\Db::value("SELECT COUNT(*) FROM rate_limits WHERE bucket LIKE 'unit_short|%'");
    Tfm\RateLimit::hit('unit_short', $ident . 'x', 5, 60);                      // another identity has its own bucket
    return $rows === 0 ? true : "$rows rate_limits rows";
});
check('diet — a long window (an hourly limit) stays in the rate_limits table and survives an emptied cache', function () {
    $ident = 'u:' . random_int(100000, 999999);
    Tfm\Db::exec("DELETE FROM rate_limits WHERE bucket LIKE 'unit_long|%'");   // a database kept from an earlier run (MariaDB) still has that run's row
    for ($i = 0; $i < 3; $i++) Tfm\RateLimit::hit('unit_long', $ident, 3, 3600);
    $rows = (int) Tfm\Db::value("SELECT COUNT(*) FROM rate_limits WHERE bucket LIKE 'unit_long|%'");
    Tfm\Cache::configure(['driver' => 'file', 'dir' => Tfm\Config::dataDir() . '/cache-other']);   // "the cache was emptied"
    $code = apiCode(function () use ($ident) { Tfm\RateLimit::hit('unit_long', $ident, 3, 3600); });
    Tfm\Cache::reset();
    return $rows === 1 && $code === '429 RATE_LIMITED' ? true : "$rows rows, 4th hit: '$code'";
});
check('diet — the same bucket is shared by endpoints that name the same limit; without a cache the table counts as before', function () {
    $ctx = new Tfm\Ctx();
    $u = newUser();
    $ctx->user = $u;
    Tfm\Config::override('rate_limits.unit_shared', [4, 60]);
    for ($i = 0; $i < 4; $i++) Tfm\RateLimit::forRequest('unit_shared', $ctx);      // "endpoint A" twice, "endpoint B" twice
    $shared = apiCode(function () use ($ctx) { Tfm\RateLimit::forRequest('unit_shared', $ctx); });
    Tfm\Cache::configure(['driver' => 'off']);
    $ident = 'u:' . random_int(100000, 999999);
    for ($i = 0; $i < 4; $i++) Tfm\RateLimit::hit('unit_off', $ident, 4, 60);
    $off = apiCode(function () use ($ident) { Tfm\RateLimit::hit('unit_off', $ident, 4, 60); });
    $rows = (int) Tfm\Db::value("SELECT hits FROM rate_limits WHERE bucket LIKE 'unit_off|%' ORDER BY hits DESC LIMIT 1");
    Tfm\Cache::reset();
    return $shared === '429 RATE_LIMITED' && $off === '429 RATE_LIMITED' && $rows === 5 ? true : "shared '$shared', off '$off', table hits $rows";
});
check('diet — "this address is not blocked" is remembered (no statement); a new block works at the very next request; a lifted block is gone at once', function () {
    request('203.0.113.77');
    Tfm\Firewall::check();
    $n = sqlOf(function () { for ($i = 0; $i < 5; $i++) Tfm\Firewall::check(); });
    if ($n !== 0) return "$n statements for 5 checks of an unblocked address";
    Tfm\Firewall::block('203.0.113.77', 600, 'unit');
    $blocked = apiCode(function () { Tfm\Firewall::check(); });
    Tfm\Firewall::unblock('203.0.113.77');
    $after = apiCode(function () { Tfm\Firewall::check(); });
    request('203.0.113.78');
    $other = apiCode(function () { Tfm\Firewall::check(); });
    return $blocked === '403 IP_BLOCKED' && $after === '' && $other === '' ? true : "blocked '$blocked', after unblock '$after', other address '$other'";
});
check('diet — the automatic block (25 attack events) still closes the address although "not blocked" was remembered a moment before', function () {
    request('198.51.100.61', '/api/trap.php');
    Tfm\Firewall::check();                                                      // remembered: not blocked
    Tfm\SecEvent::resetRequest();
    for ($i = 0; $i < 26; $i++) { Tfm\SecEvent::resetRequest(); Tfm\SecEvent::log('honeypot', 'warn', ['n' => $i]); }
    return apiCode(function () { Tfm\Firewall::check(); }) === '403 IP_BLOCKED' ? true : 'the address still gets through';
});
check('diet — a thousand different addresses cost one statement in all (the shared list of live blocks); one block among them closes only that address', function () {
    Tfm\Cache::del('s:ipb:live');
    $walk = function (int $count) {                                            // request() would reset the statement counter
        for ($i = 0; $i < $count; $i++) { $_SERVER['REMOTE_ADDR'] = '198.18.' . intdiv($i, 250) . '.' . ($i % 250 + 1); Tfm\Http::resetRequestCache(); Tfm\Firewall::check(); }
    };
    $n = sqlOf(function () use ($walk) { $walk(1000); });
    Tfm\Firewall::block('198.18.9.9', 600, 'unit');
    request('198.18.9.9');
    $blocked = apiCode(function () { Tfm\Firewall::check(); });
    $m = sqlOf(function () use ($walk) { $walk(200); });
    Tfm\Firewall::unblock('198.18.9.9');
    request('198.18.9.9');
    $lifted = apiCode(function () { Tfm\Firewall::check(); });
    return $n === 1 && $blocked === '403 IP_BLOCKED' && $m === 0 && $lifted === '' ? true : "$n statements for 1000 addresses, blocked '$blocked', $m statements for 200 others meanwhile, after the release '$lifted'";
});
check('ranking — the top list and my place come from the cache (no statement); my own save, a save that reaches the top 20 and a ban show at once', function () {
    request('203.0.113.10');
    $mk = function (string $nick, int $level, int $exp): array {
        $u = Tfm\Users::create($nick . '@example.com', $nick, 'Ferment2026ok');
        Tfm\Db::upsert('user_profiles', ['user_id' => (int) $u['id'], 'level' => $level, 'exp_total' => $exp, 'coin' => 0, 'edu' => 0, 'title' => '', 'updated_at' => Tfm\Clock::ms()], ['user_id']);
        return $u;
    };
    $tag = substr(bin2hex(random_bytes(3)), 0, 5);
    $ace = $mk("Ra{$tag}", 90, 900000);                                         // certainly on the list
    $low = $mk("Rb{$tag}", 1, 3);                                               // certainly not (when the list is full), or its last row
    Tfm\Ranking::forget();
    $now = Tfm\Clock::ms();
    $first = Tfm\Ranking::top($now);
    $warm = sqlOf(function () use ($now, $ace, $low) { for ($i = 0; $i < 10; $i++) { $t = Tfm\Ranking::top($now + $i); Tfm\Ranking::mine((int) $ace['id'], $t); } });
    $mineLow = Tfm\Ranking::mine((int) $low['id'], $first);
    $again = sqlOf(function () use ($first, $low) { Tfm\Ranking::mine((int) $low['id'], $first); });
    if ($first['rows'][0][1] !== "Ra{$tag}" || $warm !== 0 || $again !== 0 || !$mineLow || $mineLow['rank'] < 2) return "first row {$first['rows'][0][1]}, $warm statements warm, $again for my place again, my place " . json_encode($mineLow);
    // my own save: my place is asked again (the list stays when I am not on it and do not reach it)
    Tfm\Db::exec('UPDATE user_profiles SET exp_total = ? WHERE user_id = ?', [4, (int) $low['id']]);
    Tfm\Ranking::saved((int) $low['id'], 1, 4);
    $kept = Tfm\Ranking::top($now + 100);
    $mine2 = Tfm\Ranking::mine((int) $low['id'], $kept);
    $onList = false;
    foreach ($kept['rows'] as $r) if ((int) $r[0] === (int) $low['id']) $onList = true;
    if (!$mine2 || $mine2['exp'] !== 4) return 'my own save did not show in my place: ' . json_encode($mine2);
    if (!$onList && $kept['at'] !== $first['at']) return 'a save far below the top 20 renewed the shared list';
    // a save that reaches the top: the shared list is renewed by the next request
    Tfm\Db::exec('UPDATE user_profiles SET level = ?, exp_total = ? WHERE user_id = ?', [95, 990000, (int) $low['id']]);
    Tfm\Ranking::saved((int) $low['id'], 95, 990000);
    $risen = Tfm\Ranking::top($now + 200);
    if ($risen['rows'][0][1] !== "Rb{$tag}" || $risen['at'] !== $now + 200) return 'a save that reaches the top did not renew the list: first row ' . $risen['rows'][0][1];
    // after cache.ranking_ttl the list is read again; within it, not
    $stmts = sqlOf(function () use ($now) { Tfm\Ranking::top($now + 30000); });
    $due = sqlOf(function () use ($now) { Tfm\Ranking::top($now + 200 + 61000); });
    if ($stmts !== 0 || $due !== 2) return "$stmts statements within the minute, $due after it";
    // a ban takes the account off the list at once
    Tfm\Users::update((int) $low['id'], ['status' => 'banned'], true);
    $after = Tfm\Ranking::top($now + 200 + 62000);
    foreach ($after['rows'] as $r) if ((int) $r[0] === (int) $low['id']) return 'a banned account is still on the list';
    // without the cache every call asks the database
    Tfm\Cache::configure(['driver' => 'off']);
    $off = sqlOf(function () use ($now, $ace) { $t = Tfm\Ranking::top($now); Tfm\Ranking::mine((int) $ace['id'], $t); });
    Tfm\Cache::reset();
    Tfm\Users::update((int) $ace['id'], ['status' => 'banned'], true);          // leave the list as it was for the checks below
    return $off === 2 ? true : "$off statements with the cache off";
});
check('static — the precompressed copies of the page are kept only while they belong to index.html (a broken upload or a page replaced by hand removes them)', function () {
    $dir = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'tfm-page-' . bin2hex(random_bytes(4));
    mkdir($dir . DIRECTORY_SEPARATOR . 'data', 0755, true);
    $p = function (string $name) use ($dir): string { return $dir . DIRECTORY_SEPARATOR . $name; };
    $page = '<!doctype html><title>t</title>' . str_repeat('<p>장독대</p>', 400);
    $write = function () use ($p, $page) {
        file_put_contents($p('index.html'), $page);
        file_put_contents($p('index.gz.html'), gzencode($page, 9));
        file_put_contents($p('index.br.html'), 'not really brotli, only its length matters here');
        file_put_contents($p('data/page.json'), json_encode(['page' => 'index.html', 'bytes' => strlen($page), 'sha1' => sha1($page), 'copies' => [
            'index.gz.html' => ['encoding' => 'gzip', 'bytes' => filesize($p('index.gz.html'))], 'index.br.html' => ['encoding' => 'br', 'bytes' => filesize($p('index.br.html'))]]]));
    };
    $write();
    $ok = Tfm\Api::pageCopies($dir);
    file_put_contents($p('index.gz.html'), substr((string) file_get_contents($p('index.gz.html')), 0, 20));   // an upload that broke off
    $cut = Tfm\Api::pageCopies($dir);
    $afterCut = [is_file($p('index.gz.html')), is_file($p('index.br.html'))];
    $write();
    file_put_contents($p('index.html'), $page . '<!-- edited by hand -->');
    $edited = Tfm\Api::pageCopies($dir);
    $afterEdit = [is_file($p('index.gz.html')), is_file($p('index.br.html')), is_file($p('index.html'))];
    $write();
    unlink($p('data/page.json'));                                                                             // copies nobody vouches for
    $noRecord = Tfm\Api::pageCopies($dir);
    $none = Tfm\Api::pageCopies($dir);
    foreach (['index.html', 'index.gz.html', 'index.br.html', 'data/page.json'] as $f) @unlink($p($f));
    @rmdir($p('data')); @rmdir($dir);
    return $ok === ['state' => 'ok', 'removed' => 0] && $cut === ['state' => 'stale', 'removed' => 1] && $afterCut === [false, true]
        && $edited === ['state' => 'stale', 'removed' => 2] && $afterEdit === [false, false, true] && $noRecord['removed'] === 2 && $none['state'] === 'none'
        ? true : json_encode([$ok, $cut, $afterCut, $edited, $afterEdit, $noRecord, $none]);
});
check('diet — the account row of an API request comes from the cache (no statement) and never holds the password hash', function () {
    $u = newUser();
    $id = (int) $u['id'];
    $first = Tfm\Auth::userRow($id);
    $n = sqlOf(function () use ($id) { for ($i = 0; $i < 5; $i++) Tfm\Auth::userRow($id); });
    if ($n !== 0) return "$n statements for 5 cached look-ups";
    if (isset($first['password_hash']) || $first['nickname'] !== $u['nickname'] || (int) $first['session_epoch'] !== 0 || $first['status'] !== 'active') return 'unexpected row: ' . json_encode(array_keys($first));
    $hash = (string) Tfm\Db::value('SELECT password_hash FROM users WHERE id = ?', [$id]);
    foreach (new RecursiveIteratorIterator(new RecursiveDirectoryIterator(Tfm\Config::dataDir() . '/cache', FilesystemIterator::SKIP_DOTS)) as $f) {
        if (strpos((string) file_get_contents($f->getPathname()), substr($hash, 10, 30)) !== false) return 'the password hash is in a cache file';
    }
    return true;
});
check('diet — a ban, an unban, a role change, a new password, a chat pause and "sign out everywhere" reach the very next request', function () {
    $u = newUser();
    $id = (int) $u['id'];
    $admin = ['id' => 0, 'nickname' => 'unit'];
    $seen = [];
    Tfm\Auth::userRow($id);
    Tfm\AdminOps::setBanned($admin, $id, true);
    $seen['ban'] = Tfm\Auth::userRow($id)['status'];
    Tfm\AdminOps::setBanned($admin, $id, false);
    $r = Tfm\Auth::userRow($id);
    $seen['unban'] = $r['status'] . '/' . $r['session_epoch'];
    Tfm\AdminOps::setRole($admin, $id, 'admin');
    $r = Tfm\Auth::userRow($id);
    $seen['role'] = $r['role'] . '/' . $r['session_epoch'];
    Tfm\Users::update($id, ['password_hash' => Tfm\Users::hashPassword('Another2026pw'), 'password_changed_at' => 123456], true);
    $r = Tfm\Auth::userRow($id);
    $seen['password'] = $r['password_changed_at'] . '/' . $r['session_epoch'];
    Tfm\AdminOps::mute($admin, $id, 10);
    $seen['mute'] = (int) Tfm\Auth::userRow($id)['muted_until'] > Tfm\Clock::ms() ? 'muted' : 'not muted';
    Tfm\Users::update($id, [], true);                                           // sign out everywhere
    $seen['epoch'] = (int) Tfm\Auth::userRow($id)['session_epoch'];
    $want = ['ban' => 'banned', 'unban' => 'active/2', 'role' => 'admin/3', 'password' => '123456/4', 'mute' => 'muted', 'epoch' => 5];
    return $seen == $want ? true : json_encode($seen);
});
check('diet — the same holds when the change is made by another process (the command line): the web side sees it at once', function () {
    $u = newUser();
    $id = (int) $u['id'];
    Tfm\Auth::userRow($id);                                                     // cached here
    $cmd = escapeshellarg(PHP_BINARY) . ' ' . escapeshellarg(__DIR__ . '/../server/cli/tfm.php') . ' ban ' . escapeshellarg((string) $u['email']) . ' 2>&1';
    $out = (string) shell_exec($cmd);
    $row = Tfm\Auth::userRow($id);
    return $row['status'] === 'banned' && is_file(Tfm\Config::dataDir() . '/cache/bust') ? true : 'status ' . $row['status'] . ' · cli said: ' . substr(trim($out), 0, 120);
});
check('diet — settings come from the cache after the first read and a change shows at once; the schema check is remembered', function () {
    Tfm\Settings::reset();
    Tfm\Settings::get('farm.rt_scale', 1.0);
    Tfm\Settings::reset();
    Tfm\Cache::set('cfg:settings', ['farm.rt_scale' => 7.0], 30);               // what another request cached
    $cached = Tfm\Settings::get('farm.rt_scale', 1.0);
    Tfm\Settings::set('farm.rt_scale', 3.5, null);
    $fresh = Tfm\Settings::get('farm.rt_scale', 1.0);
    Tfm\Settings::set('farm.rt_scale', 1.0, null);
    $ref = new ReflectionMethod('Tfm\Db', 'schemaRemembered');
    $ref->setAccessible(true);
    $remembered = $ref->invoke(null);
    Tfm\Db::reset();
    $forgot = !$ref->invoke(null);
    Tfm\Db::pdo();
    return $cached === 7.0 && $fresh === 3.5 && $remembered === true && $forgot ? true : json_encode([$cached, $fresh, $remembered, $forgot]);
});
check('diet — Db::stats() counts statements, commits and connections', function () {
    Tfm\Db::resetStats();
    Tfm\Db::value('SELECT 1');
    Tfm\Db::tx(function () { Tfm\Db::value('SELECT 2'); Tfm\Db::value('SELECT 3'); });
    $s = Tfm\Db::stats();
    return $s['statements'] === 3 && $s['commits'] === 1 && $s['connects'] === 0 ? true : json_encode($s);
});

// =============================================================================================== 3. Tfm\Sync
$T = (int) floor(microtime(true) * 1000);
/** the normalised input of a sync call at (x, z) */
function at(float $x, float $z, array $more = []): array
{
    return $more + Tfm\Sync::input(['p' => [$x, 0, $z, 0, $more['speed'] ?? 0, 'idle', $more['zone'] ?? 'ZONE_MAIN', null, 0]] + array_intersect_key($more, ['h' => 1, 'c' => 1, 'r' => 1, 'f' => 1, 'q' => 1, 'w' => 1, 'ap' => 1, 'ns' => 1]));
}
/** a fresh cache (and channel world) for a group of checks */
function world(array $conf = []): void
{
    global $tmp;
    static $n = 0;
    Tfm\Cache::configure(['driver' => 'file', 'dir' => "$tmp/world-" . (++$n), 'prefix' => 'w', 'web' => true]);
    foreach (['channels.size' => 60, 'channels.hard' => 90, 'capacity.max_online' => 0, 'sync.max_near' => 40, 'sync.aoi_radius' => 90, 'sync.min_gap_ms' => 350, 'rate_limits.sync' => [150, 60]] as $k => $v) Tfm\Config::override($k, $conf[$k] ?? $v);
    Tfm\Sync::reset();
    Tfm\Gate::reset();
}
/** fake accounts (no database rows needed for the channel logic) */
function acct(int $id, string $role = 'user'): array { return ['id' => $id, 'nickname' => 'P' . $id, 'role' => $role, 'muted_until' => 0]; }

check('sync — a token is accepted only while it is genuine, unexpired and presented with its own session cookie and CSRF token', function () use ($T) {
    world();
    $t = Tfm\Sync::token(41, 3, $T, 'sid-abc', 'csrf-abc', 'boot1');
    $ok = Tfm\Sync::claims($t[0], 'sid-abc', 'csrf-abc', $T + 1000);
    if ($ok === null || $ok['uid'] !== 41 || $ok['ch'] !== 3 || $ok['boot'] !== 'boot1' || $t[1] !== intdiv($T, 1000) + 300) return 'a good token was refused or misread: ' . json_encode($ok);
    $parts = explode('.', $t[0]);
    $flip = static function (string $x): string { return substr($x, 0, -1) . (substr($x, -1) === 'A' ? 'B' : 'A'); };
    $forged = $parts[0] . '.' . rtrim(strtr(base64_encode((string) json_encode([42, 3, $T, intdiv($T, 1000) + 300, 'x', 'y', 'boot1'])), '+/', '-_'), '=') . '.' . $parts[2];
    $bad = [
        'expired' => Tfm\Sync::claims($t[0], 'sid-abc', 'csrf-abc', $T + 301000),
        'another session' => Tfm\Sync::claims($t[0], 'sid-xyz', 'csrf-abc', $T),
        'another csrf token' => Tfm\Sync::claims($t[0], 'sid-abc', 'csrf-xyz', $T),
        'no cookie' => Tfm\Sync::claims($t[0], null, 'csrf-abc', $T),
        'no csrf' => Tfm\Sync::claims($t[0], 'sid-abc', null, $T),
        'flipped signature' => Tfm\Sync::claims($parts[0] . '.' . $parts[1] . '.' . $flip($parts[2]), 'sid-abc', 'csrf-abc', $T),
        'flipped payload' => Tfm\Sync::claims($parts[0] . '.' . $flip($parts[1]) . '.' . $parts[2], 'sid-abc', 'csrf-abc', $T),
        'another account, old signature' => Tfm\Sync::claims($forged, 'sid-abc', 'csrf-abc', $T),
        'garbage' => Tfm\Sync::claims('s1.aaaa.bbbb', 'sid-abc', 'csrf-abc', $T),
        'an array' => Tfm\Sync::claims(['s1'], 'sid-abc', 'csrf-abc', $T),
        'issued in the future' => Tfm\Sync::claims(Tfm\Sync::token(41, 3, $T + 60000, 'sid-abc', 'csrf-abc', 'boot1')[0], 'sid-abc', 'csrf-abc', $T),
    ];
    foreach ($bad as $what => $r) if ($r !== null) return "$what: accepted";
    Tfm\Config::override('sync.token_ttl', 99999);
    Tfm\Sync::reset();
    $long = Tfm\Sync::token(41, 3, $T, 's', 'c', 'b')[1] - intdiv($T, 1000);
    Tfm\Config::override('sync.token_ttl', null);
    Tfm\Sync::reset();
    return $long === 600 ? true : "token_ttl is not capped at 600 s ($long)";
});
check('sync — the hot path (a call with a token) runs 0 SQL statements and opens no database connection — 300 calls of 30 players with chat, names and looks', function () use ($T) {
    world();
    $now = $T;
    $tokens = [];
    for ($i = 1; $i <= 30; $i++) {
        $j = Tfm\Sync::join(acct($i), at($i * 2.0, $i * 1.5, ['ap' => ['hair' => 'short', 'topColor' => sprintf('#%06x', $i * 1000)]]), $now);
        $tokens[$i] = ['uid' => $i, 'ch' => $j['ch'], 'iat' => $now, 'exp' => intdiv($now, 1000) + 300, 'boot' => $j['meta']['b']];
    }
    Tfm\Sync::chatPush(['id' => 501, 'user_id' => 3, 'nickname' => 'P3', 'text' => '안녕하세요', 'channel' => 'all', 'created_at' => $now, 'x' => null, 'z' => null, 'zone' => null]);
    Tfm\Db::reset();                                    // no connection is open: a statement would have to open one
    Tfm\Db::resetStats();
    $calls = 0;
    $rows = 0;
    $chat = 0;
    $looks = 0;
    for ($round = 0; $round < 10; $round++) {
        $now += 1200;
        for ($i = 1; $i <= 30; $i++) {
            $body = ['p' => [$i * 2.0 + $round, 0, $i * 1.5, 0.5, 3.5, 'run', 'ZONE_MAIN', null, 0], 'c' => $round === 0 ? 0 : 501, 'r' => 0];
            if ($round === 1) { $body['q'] = [1, 2, 3]; $body['w'] = ['00000000']; }
            $r = Tfm\Sync::hot($tokens[$i], $body, $now);
            if ($r === null) return "call $calls: the seat was reported gone";
            $calls++;
            $rows += count($r['pl']) + count($r['st'] ?? []);
            $chat += count($r['m'] ?? []);
            $looks += count($r['ap'] ?? []);
        }
    }
    $s = Tfm\Db::stats();
    Tfm\Db::pdo();
    if ($s['statements'] !== 0 || $s['connects'] !== 0) return 'the hot path touched the database: ' . json_encode($s);
    return $calls === 300 && $rows === 300 * 29 && $chat === 30 && $looks >= 30 ? true : "calls $calls, rows $rows (expected 8700), chat lines $chat (expected 30), looks $looks";
});
check('sync — area of interest: only players of my place within the radius, nearest first, capped; a hidden tab and a silent player are not shown', function () use ($T) {
    world(['sync.max_near' => 5]);
    $now = $T;
    $me = Tfm\Sync::join(acct(1), at(0, 0), $now);
    $spots = [2 => [10, 0], 3 => [80, 0], 4 => [0, 89], 5 => [91, 0], 6 => [64, 64], 7 => [3, 4], 8 => [20, 20], 9 => [1, 1], 10 => [30, 0], 11 => [0, 50]];
    foreach ($spots as $id => $xy) Tfm\Sync::join(acct($id), at($xy[0], $xy[1]), $now);
    Tfm\Sync::join(acct(20), at(2, 2, ['zone' => 'ZONE_PL_DAECHEONG']), $now);          // in a room: another place
    Tfm\Sync::join(acct(21), at(2, 3, ['h' => 1]), $now);                                // a hidden tab
    Tfm\Sync::join(acct(22), at(2, 4), $now - 40000);                                    // has not called for 40 s
    $r = Tfm\Sync::exchange($me['ch'], 1, at(0, 0, ['f' => 1]), $now + 1000);
    $ids = array_map(static function ($row) { return $row[0]; }, $r['rows']);
    if ($ids !== ['9', '7', '2', '8', '10']) return 'valley, cap 5: ' . implode(',', $ids);
    Tfm\Config::override('sync.max_near', 40);
    Tfm\Sync::reset();
    $r = Tfm\Sync::exchange($me['ch'], 1, at(0, 0, ['f' => 1]), $now + 2000);
    $ids = array_map(static function ($row) { return $row[0]; }, $r['rows']);
    if ($ids !== ['9', '7', '2', '8', '10', '11', '3', '4']) return 'valley, radius 90: ' . implode(',', $ids) . ' (5 at 91 m, 6 at 90.5 m, the room, the hidden tab and the silent player must be missing)';
    $room = Tfm\Sync::exchange($me['ch'], 1, at(0, 0, ['f' => 1, 'zone' => 'ZONE_PL_DAECHEONG']), $now + 3000);
    $ids = array_map(static function ($row) { return $row[0]; }, $room['rows']);
    return $ids === ['20'] && $room['rows'][0][7] === 0 && $r['count'] === 14 ? true : 'in the room I see ' . implode(',', $ids) . '; head count ' . $r['count'];
});
check('sync — rows are compact; a player that did not change is listed in "st" only; names and looks come when asked ("q", "w")', function () use ($T) {
    world();
    $now = $T;
    $a = Tfm\Sync::join(acct(1), at(0, 0), $now);
    Tfm\Sync::join(acct(2), at(5, 5, ['ap' => ['hair' => 'long', 'skin' => '#AABBCC', 'evil' => '<script>']]), $now);
    $tok = ['uid' => 1, 'ch' => $a['ch'], 'iat' => $now, 'exp' => intdiv($now, 1000) + 300, 'boot' => $a['meta']['b']];
    $first = Tfm\Sync::hot($tok, ['p' => [0, 0, 0, 0, 0, 'idle', 'ZONE_MAIN', null, 0], 'f' => 1, 'q' => [2, 999]], $now + 1000);
    $row = $first['pl'][0] ?? null;
    if (!is_array($row) || count($row) !== 12 || $row[0] !== '2' || $row[1] != 5 || $row[6] !== 'idle' || $row[7] !== 0 || $row[8] !== 0 || !is_int($row[11])) return 'row: ' . json_encode($row);
    if (($first['who']['2'][0] ?? '') !== 'P2' || !preg_match('/^[0-9a-f]{8}$/', $first['who']['2'][1] ?? '') || isset($first['who']['999'])) return 'who: ' . json_encode($first['who'] ?? null);
    $look = $first['ap'][$first['who']['2'][1]] ?? null;
    if ($look !== ['hair' => 'long', 'skin' => '#aabbcc']) return 'look: ' . json_encode($look);
    $second = Tfm\Sync::hot($tok, ['p' => [0, 0, 0, 0, 0, 'idle', 'ZONE_MAIN', null, 0]], $now + 2500);
    if ($second['pl'] !== [] || ($second['st'] ?? null) !== ['2']) return 'unchanged player: ' . json_encode([$second['pl'], $second['st'] ?? null]);
    Tfm\Sync::exchange($a['ch'], 2, at(6, 5), $now + 3000);                              // player 2 moves
    $third = Tfm\Sync::hot($tok, ['p' => [0, 0, 0, 0, 0, 'idle', 'ZONE_MAIN', null, 0], 'w' => [$first['who']['2'][1], 'ffffffff']], $now + 4000);
    return count($third['pl']) === 1 && $third['pl'][0][1] == 6 && !isset($third['st']) && array_keys($third['ap']) === [$first['who']['2'][1]] ? true : 'after a move: ' . json_encode([$third['pl'], $third['st'] ?? null, array_keys($third['ap'] ?? [])]);
});
check('sync — channels: 150 players fill channels of 60 / 60 / 30; nobody is ever moved; a newcomer joins the fullest channel with room', function () use ($T) {
    world();
    $now = $T;
    $ch = [];
    for ($i = 1; $i <= 150; $i++) $ch[$i] = Tfm\Sync::join(acct($i), at($i % 50, 0), $now)['ch'];
    $sizes = array_count_values($ch);
    ksort($sizes);
    if (array_values($sizes) !== [60, 60, 30]) return 'sizes ' . json_encode($sizes);
    $now += 5000;
    for ($i = 1; $i <= 150; $i++) { if (Tfm\Sync::join(acct($i), at($i % 50, 1), $now)['ch'] !== $ch[$i]) return "player $i changed channel on its next checked call"; }
    // five players of channel 1 close their tabs: after the seat time (180 s) their seats are free
    for ($t = 60000; $t <= 185000; $t += 60000 + ($t === 120000 ? 5000 : 0)) {
        for ($i = 1; $i <= 150; $i++) { if (!in_array($i, [5, 6, 7, 8, 9], true)) Tfm\Sync::exchange($ch[$i], $i, at($i % 50, 2), $now + $t); }
    }
    $later = $now + 186000;
    $new = [];
    for ($i = 201; $i <= 208; $i++) $new[] = Tfm\Sync::join(acct($i), at(1, 1), $later)['ch'];
    if ($new !== [1, 1, 1, 1, 1, 3, 3, 3]) return 'newcomers went to ' . implode(',', $new) . ' (expected the five free places of channel 1, then channel 3)';
    $back = Tfm\Sync::join(acct(5), at(1, 1), $later + 1000)['ch'];                      // one of them returns: its old channel takes it back (up to "hard")
    for ($i = 1; $i <= 150; $i++) { if (!in_array($i, [5, 6, 7, 8, 9], true) && Tfm\Sync::join(acct($i), at($i % 50, 3), $later + 2000)['ch'] !== $ch[$i]) return "player $i was moved"; }
    $sizes = array_map(static function ($c) { return $c[0]; }, Tfm\Sync::channels($later + 2000));
    ksort($sizes);
    return $back === 1 && $sizes === [1 => 61, 2 => 60, 3 => 33] ? true : "returning member → channel $back; sizes " . json_encode($sizes);
});
check('sync — pacing without SQL: a call sooner than the minimum gap and more calls than rate_limits.sync a minute are refused with 429 + Retry-After', function () use ($T) {
    world(['rate_limits.sync' => [5, 60]]);
    $now = intdiv($T, 60000) * 60000 + 1000;
    $a = Tfm\Sync::join(acct(1), at(0, 0), $now);
    $tok = ['uid' => 1, 'ch' => $a['ch'], 'iat' => $now, 'exp' => intdiv($now, 1000) + 300, 'boot' => $a['meta']['b']];
    $body = ['p' => [0, 0, 0, 0, 0, 'idle', 'ZONE_MAIN', null, 0]];
    $fast = null;
    try { Tfm\Sync::hot($tok, $body, $now + 100); } catch (Tfm\ApiException $e) { $fast = $e; }
    if (!$fast || $fast->status !== 429 || $fast->headers !== ['Retry-After: 1']) return 'a call 100 ms after the last was not refused';
    $ok = 0;
    $rate = null;
    for ($i = 1; $i <= 7; $i++) {
        try { Tfm\Sync::hot($tok, $body, $now + $i * 1000); $ok++; } catch (Tfm\ApiException $e) { $rate = $e; break; }
    }
    if ($ok !== 5 || !$rate || $rate->status !== 429 || !preg_match('/^Retry-After: ([1-9]\d?)$/', $rate->headers[0], $m) || (int) $m[1] > 60) return "served $ok calls in the minute (limit 5); " . json_encode($rate ? $rate->headers : null);
    $next = Tfm\Sync::hot($tok, $body, $now + 61000);                                    // the next minute
    return is_array($next) ? true : 'still refused in the next minute';
});
check('sync — the seat (and with it the token) ends at once: logout, a ban, a role change, a chat pause, a silent browser, an emptied cache', function () use ($T) {
    world();
    $now = $T;
    $body = ['p' => [0, 0, 0, 0, 0, 'idle', 'ZONE_MAIN', null, 0]];
    $out = [];
    $admin = ['id' => 0, 'nickname' => 'unit'];
    foreach (['logout', 'ban', 'role', 'mute', 'password', 'silent', 'cache'] as $how) {
        $u = newUser();
        $id = (int) $u['id'];
        $j = Tfm\Sync::join($u, at(0, 0), $now);
        $tok = ['uid' => $id, 'ch' => $j['ch'], 'iat' => $now, 'exp' => intdiv($now, 1000) + 300, 'boot' => $j['meta']['b']];
        if (!is_array(Tfm\Sync::hot($tok, $body, $now + 1000))) return "$how: the token did not work before";
        $t = $now + 2000;
        if ($how === 'logout') Tfm\Presence::remove($id);
        elseif ($how === 'ban') Tfm\AdminOps::setBanned($admin, $id, true);
        elseif ($how === 'role') Tfm\AdminOps::setRole($admin, $id, 'admin');
        elseif ($how === 'mute') Tfm\AdminOps::mute($admin, $id, 5);
        elseif ($how === 'password') Tfm\Users::update($id, ['password_hash' => Tfm\Users::hashPassword('Another2026pw')], true);
        elseif ($how === 'silent') $t = $now + 1000 + 181000;
        elseif ($how === 'cache') Tfm\Cache::del('sy:meta');
        $out[$how] = Tfm\Sync::hot($tok, $body, $t) === null ? 'ended' : 'STILL GOOD';
        if ($how === 'cache') Tfm\Sync::meta($now);
    }
    return count(array_unique($out)) === 1 && reset($out) === 'ended' ? true : json_encode($out);
});
check('sync — chat: a stored line reaches the sender\'s channel only; "주변" lines only players of that place within 30 m; the cursor moves on', function () use ($T) {
    world(['channels.size' => 3, 'channels.hard' => 3]);
    $now = $T;
    $ch = [];
    foreach ([1 => [0, 0], 2 => [10, 0], 3 => [80, 0], 4 => [0, 0], 5 => [1, 1]] as $id => $xy) $ch[$id] = Tfm\Sync::join(acct($id), at($xy[0], $xy[1]), $now);
    if ($ch[1]['ch'] !== $ch[3]['ch'] || $ch[4]['ch'] === $ch[1]['ch']) return 'the test channels are not 1,2,3 | 4,5';
    $tok = static function (int $id) use ($ch, $now) { return ['uid' => $id, 'ch' => $ch[$id]['ch'], 'iat' => $now, 'exp' => intdiv($now, 1000) + 300, 'boot' => $ch[$id]['meta']['b']]; };
    $pos = [1 => [0, 0], 2 => [10, 0], 3 => [80, 0], 4 => [0, 0]];
    $ask = static function (int $id, int $c, int $t) use ($tok, $pos) { return Tfm\Sync::hot($tok($id), ['p' => [$pos[$id][0], 0, $pos[$id][1], 0, 0, 'idle', 'ZONE_MAIN', null, 0], 'c' => $c], $t); };
    Tfm\Sync::chatPush(['id' => 700, 'user_id' => 1, 'nickname' => 'P1', 'text' => '모두 안녕', 'channel' => 'all', 'created_at' => $now, 'x' => null, 'z' => null, 'zone' => null]);
    Tfm\Sync::chatPush(['id' => 701, 'user_id' => 1, 'nickname' => 'P1', 'text' => '가까이만', 'channel' => 'local', 'created_at' => $now, 'x' => 0.0, 'z' => 0.0, 'zone' => 'ZONE_MAIN']);
    $r2 = $ask(2, 0, $now + 1000);
    $r3 = $ask(3, 0, $now + 1000);
    $r4 = $ask(4, 0, $now + 1000);
    $r1 = $ask(1, 0, $now + 1000);
    $ids = static function ($r) { return array_map(static function ($m) { return $m[0]; }, $r['m'] ?? []); };
    if ($ids($r2) !== [700, 701] || $ids($r3) !== [700] || $ids($r4) !== [] || $ids($r1) !== [700, 701]) return 'delivery: near ' . json_encode($ids($r2)) . ' far ' . json_encode($ids($r3)) . ' other channel ' . json_encode($ids($r4)) . ' sender ' . json_encode($ids($r1));
    if ($r2['m'][0] !== [700, '1', 'P1', '모두 안녕', 0, $now] || $r2['m'][1][4] !== 1 || $r2['c'] !== 701 || $r3['c'] !== 701) return 'row or cursor: ' . json_encode([$r2['m'][0], $r2['c'], $r3['c']]);
    $quiet = $ask(2, 701, $now + 2500);
    Tfm\Sync::chatPush(['id' => 702, 'user_id' => 2, 'nickname' => 'P2', 'text' => '또 만나요', 'channel' => 'all', 'created_at' => $now + 3000, 'x' => null, 'z' => null, 'zone' => null]);
    $more = $ask(3, 701, $now + 4000);
    return !isset($quiet['m']) && $quiet['c'] === 701 && $ids($more) === [702] && $more['c'] === 702 ? true : 'after the cursor: ' . json_encode([$quiet['m'] ?? null, $ids($more)]);
});
check('sync — moderation: a hidden line and a banned account are taken back with the next call (feed + rings), without a statement on the hot path', function () use ($T) {
    world();
    $now = $T;
    $bad = newUser();
    $a = Tfm\Sync::join(acct(1), at(0, 0), $now);
    Tfm\Sync::join($bad, at(1, 1), $now);
    $tok = ['uid' => 1, 'ch' => $a['ch'], 'iat' => $now, 'exp' => intdiv($now, 1000) + 300, 'boot' => $a['meta']['b']];
    $mid = Tfm\Db::insert('chat_messages', ['user_id' => (int) $bad['id'], 'nickname' => (string) $bad['nickname'], 'channel' => 'all', 'text' => '나쁜 말', 'text_key' => 'k' . $now, 'x' => null, 'z' => null, 'hidden' => 0, 'created_at' => $now]);
    Tfm\Sync::chatPush(['id' => $mid, 'user_id' => (int) $bad['id'], 'nickname' => (string) $bad['nickname'], 'text' => '나쁜 말', 'channel' => 'all', 'created_at' => $now, 'x' => null, 'z' => null, 'zone' => null]);
    $first = Tfm\Sync::hot($tok, ['p' => [0, 0, 0, 0, 0, 'idle', 'ZONE_MAIN', null, 0], 'c' => 0], $now + 1000);
    if (count($first['m'] ?? []) !== 1 || !isset($first['rt']['r'])) return 'before: ' . json_encode([$first['m'] ?? null, $first['rt'] ?? null]);
    $r0 = $first['rt']['r'];
    Tfm\AdminOps::hideMessage(['id' => 0, 'nickname' => 'unit'], $mid, true);
    Tfm\AdminOps::setBanned(['id' => 0, 'nickname' => 'unit'], (int) $bad['id'], true);
    $n = sqlOf(function () use (&$second, $tok, $now, $mid, $r0) { $second = Tfm\Sync::hot($tok, ['p' => [0, 0, 0, 0, 0, 'idle', 'ZONE_MAIN', null, 0], 'c' => $mid, 'r' => $r0], $now + 2500); });
    $rt = $second['rt'] ?? null;
    if ($n !== 0) return "$n statements on the hot path";
    if (!$rt || $rt['m'] !== [$mid] || $rt['u'] !== [(string) $bad['id']] || $rt['r'] <= $r0) return 'feed: ' . json_encode($rt);
    $fresh = Tfm\Sync::hot($tok, ['p' => [0, 0, 0, 0, 0, 'idle', 'ZONE_MAIN', null, 0], 'c' => 0, 'f' => 1], $now + 4000);
    return ($fresh['m'] ?? []) === [] && $fresh['pl'] === [] ? true : 'the hidden line or the banned player is still handed out: ' . json_encode([$fresh['m'] ?? null, $fresh['pl']]);
});
check('sync — old and new clients share the state: api/presence/update.php (Tfm\Presence) and api/sync.php see each other; the old answer keeps its shape', function () use ($T) {
    world();
    $now = $T;
    $old = newUser();
    $new = newUser();
    $j = Tfm\Sync::join($new, at(3, 4, ['ap' => ['hair' => 'bun', 'topColor' => '#112233']]), $now);
    $n = sqlOf(function () use ($old, $now) { Tfm\Presence::update($old, ['x' => 0, 'y' => 0, 'z' => 0, 'rotY' => 0, 'anim' => 'walk', 'speed' => 2, 'zoneId' => 'ZONE_MAIN', 'appearance' => ['hair' => 'short']], $now + 500); });
    $others = Tfm\Presence::others((int) $old['id'], $now + 500);
    $want = ['id', 'nickname', 'x', 'y', 'z', 'rotY', 'anim', 'speed', 'zoneId', 'emote', 'emoteAt', 'age', 'appearance'];
    if (count($others) !== 1 || array_keys($others[0]) !== $want) return 'old shape: ' . json_encode($others);
    $o = $others[0];
    if ($o['id'] !== (string) $new['id'] || $o['nickname'] !== $new['nickname'] || $o['x'] !== 3.0 || $o['z'] !== 4.0 || $o['zoneId'] !== 'ZONE_MAIN' || $o['appearance'] !== ['hair' => 'bun', 'topColor' => '#112233'] || $o['emote'] !== null) return 'old client sees: ' . json_encode($o);
    $seen = Tfm\Sync::exchange($j['ch'], (int) $new['id'], at(3, 4, ['f' => 1]), $now + 1500);
    $row = $seen['rows'][0] ?? null;
    if (!$row || $row[0] !== (string) $old['id'] || $row[6] !== 'walk' || $row[5] != 2) return 'new client sees: ' . json_encode($row);
    $pos = Tfm\Presence::position((int) $new['id'], $now + 1500);
    return $n === 0 && Tfm\Presence::onlineCount($now) === 2 && $pos === ['x' => 3.0, 'z' => 4.0] ? true : "$n statements for the old presence call; online " . Tfm\Presence::onlineCount($now) . '; position ' . json_encode($pos);
});
check('sync — write-behind: a checked call takes the changed rows of its channel once per flush interval; they reach the presence table in one statement', function () use ($T) {
    world();
    $now = $T;
    $users = [newUser(), newUser(), newUser()];
    $first = Tfm\Sync::join($users[0], at(1, 1), $now);
    Tfm\Sync::join($users[1], at(2, 2), $now + 100);
    if ($first['flush'] !== null) return 'the first call of a new channel must not flush';
    $soon = Tfm\Sync::join($users[2], at(3, 3), $now + 5000);
    if ($soon['flush'] !== null) return 'flushed after 5 s (interval 30 s)';
    $due = Tfm\Sync::join($users[0], at(1, 5), $now + 31000);
    if (!is_array($due['flush']) || count($due['flush']) !== 3) return 'rows claimed after 31 s: ' . json_encode($due['flush']);
    $again = Tfm\Sync::join($users[1], at(2, 2), $now + 32000);
    if ($again['flush'] !== null) return 'the same rows were claimed twice';
    $n = sqlOf(function () use ($due, &$written) { $written = Tfm\Sync::flush($due['flush']); });
    $row = Tfm\Db::one('SELECT nickname, x, z, zone_id, updated_at FROM presence WHERE user_id = ?', [(int) $users[0]['id']]);
    $budget = Tfm\Db::driver() === 'mysql' ? 1 : 12;
    if ($written !== 3 || $n > $budget || !$row || (float) $row['x'] !== 1.0 || (float) $row['z'] !== 5.0 || $row['zone_id'] !== 'ZONE_MAIN') return "written $written with $n statements; row " . json_encode($row);
    $gone = $due['flush'];
    $gone[] = [999999999, 'ghost', 0, 0, 0, 0, null, 0, null, null, 0, $now];           // an account that does not exist any more
    return Tfm\Sync::flush($gone) === 3 ? true : 'a deleted account broke the whole flush';
});
check('sync — "next": about a second moving in company, slower alone or idle, long when hidden, stretched by the load factor, never above the cap', function () use ($T) {
    world();
    $now = $T;
    $a = Tfm\Sync::join(acct(1), at(0, 0), $now);
    $n = [];
    $n['idle alone'] = Tfm\Sync::exchange($a['ch'], 1, at(0, 0), $now + 1000)['next'];
    $n['moving alone'] = Tfm\Sync::exchange($a['ch'], 1, at(1, 0, ['speed' => 4]), $now + 2000)['next'];
    Tfm\Sync::join(acct(2), at(5, 5), $now + 2000);
    $n['running in company'] = Tfm\Sync::exchange($a['ch'], 1, at(2, 0, ['speed' => 6]), $now + 3000)['next'];
    $n['strolling in company'] = Tfm\Sync::exchange($a['ch'], 1, at(3, 0, ['speed' => 2]), $now + 4000)['next'];
    $n['idle in company'] = Tfm\Sync::exchange($a['ch'], 1, at(3, 0), $now + 5000)['next'];
    $n['hidden'] = Tfm\Sync::exchange($a['ch'], 1, at(3, 0, ['h' => 1]), $now + 6000)['next'];
    $n['running, load 3'] = Tfm\Sync::exchange($a['ch'], 1, at(4, 0, ['speed' => 6]), $now + 7000, ['load' => 3.0])['next'];
    $n['hidden, load 9'] = Tfm\Sync::exchange($a['ch'], 1, at(4, 0, ['h' => 1]), $now + 8000, ['load' => 9.0])['next'];
    $want = ['idle alone' => 4000, 'moving alone' => 2500, 'running in company' => 1000, 'strolling in company' => 1500, 'idle in company' => 4000, 'hidden' => 20000, 'running, load 3' => 3000, 'hidden, load 9' => 30000];
    return $n === $want ? true : json_encode($n);
});
check('sync — input: a body that is not exactly the documented shape is refused (400), a good one is rounded and clamped', function () {
    $good = ['p' => [12.3456, -1, 399.999, 7.5, 3.14159, 'run', 'ZONE_MAIN', 'EMO_WAVE', 1700000000000], 'h' => true, 'c' => 5, 'q' => ['7', 8], 'w' => ['ABCDEF12']];
    $in = Tfm\Sync::input($good);
    if ($in['x'] !== 12.35 || $in['z'] !== 400.0 || $in['speed'] !== 3.1 || $in['anim'] !== 'run' || $in['emote'] !== 'EMO_WAVE' || $in['h'] !== 1 || $in['q'] !== [7, 8] || $in['w'] !== ['abcdef12'] || abs($in['rot'] - 1.22) > 0.01) return 'normalised: ' . json_encode($in);
    $bad = [[], ['p' => 'x'], ['p' => [1, 2, 3]], ['p' => [1, 0, 1, 0, 0, 'idle', 'ZONE_MAIN', null, 0], 'x' => 1], ['p' => ['1', 0, 1, 0, 0, null, null, null, 0]], ['p' => [1e9, 0, 1, 0, 0, null, null, null, 0]],
        ['p' => [1, 0, 1, 0, 0, 'fly', null, null, 0]], ['p' => [1, 0, 1, 0, 0, null, 'zone', null, 0]], ['p' => [1, 0, 1, 0, 0, null, null, null, 0], 'c' => -1], ['p' => [1, 0, 1, 0, 0, null, null, null, 0], 'w' => ['xyz']],
        ['p' => [1, 0, 1, 0, 0, null, null, null, 0], 'q' => range(1, 25)], ['p' => [1, 0, 1, 0, 0, null, null, null, 0], 'ap' => 'x'], ['p' => [1, 0, 1, 0, 0, null, null, null, 0], 'h' => 2]];
    foreach ($bad as $i => $b) if (apiCode(function () use ($b) { Tfm\Sync::input($b); }) !== '400 INVALID_INPUT') return "bad body #$i was accepted: " . json_encode($b);
    return true;
});

// =============================================================================================== 4. Tfm\Gate
check('gate — seats: a full house hands out signed, ordered tickets; freed seats go to the tickets in order; a seated player is never asked to leave', function () use ($T) {
    world(['capacity.max_online' => 3]);
    $now = $T;
    $seated = [];
    for ($i = 1; $i <= 3; $i++) $seated[$i] = Tfm\Sync::join(acct($i), at($i, 0), $now)['ch'];
    $q4 = Tfm\Gate::admit(4, null, false, $now + 1000);
    $q5 = Tfm\Gate::admit(5, null, false, $now + 1010);
    $q6 = Tfm\Gate::admit(6, null, false, $now + 1020);
    if (!$q4 || !$q5 || !$q6 || [$q4['pos'], $q5['pos'], $q6['pos']] !== [1, 2, 3] || !preg_match('/^q1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{22}$/', $q4['t'])) return 'tickets: ' . json_encode([$q4, $q5, $q6]);
    if (apiCode(function () use ($now) { Tfm\Sync::join(acct(7), at(0, 0), $now + 1300); }) !== '503 QUEUE') return 'a 7th account got a seat in a full house';
    for ($t = 2000; $t <= 8000; $t += 2000) {                                            // the seated keep playing, the others keep asking
        for ($i = 1; $i <= 3; $i++) if (Tfm\Sync::exchange($seated[$i], $i, at($i, 0), $now + $t)['state'] !== 'ok') return "seated player $i lost its seat";
        foreach ([$q4, $q5, $q6] as $k => $q) { $p = Tfm\Gate::poll($q['t'], $now + $t + 10 * $k); if ($p['go'] || $p['pos'] !== $k + 1) return 'while full: ' . json_encode($p); }
    }
    Tfm\Sync::revoke(2);                                                                  // one seat becomes free
    Tfm\Sync::exchange($seated[1], 1, at(1, 0), $now + 9000);
    Tfm\Sync::exchange($seated[3], 3, at(3, 0), $now + 9000);
    $p6 = Tfm\Gate::poll($q6['t'], $now + 10000);                                        // the last in line asks first: not its turn
    $p5 = Tfm\Gate::poll($q5['t'], $now + 10010);
    $p4 = Tfm\Gate::poll($q4['t'], $now + 10020);
    if ($p6['go'] || $p5['go'] || !$p4['go'] || $p5['pos'] !== 1 || $p6['pos'] !== 2) return 'after one seat was freed: ' . json_encode([$p4, $p5, $p6]);
    if (apiCode(function () use ($now, $q5) { Tfm\Sync::join(acct(5), at(0, 0, ['qt' => $q5['t']]), $now + 10500); }) !== '503 QUEUE') return 'ticket 5 entered out of turn';
    if (apiCode(function () use ($now, $q4) { Tfm\Sync::join(acct(9), at(0, 0, ['qt' => $q4['t']]), $now + 10600); }) !== '503 QUEUE') return 'another account entered with ticket 4';
    $in = Tfm\Sync::join(acct(4), at(0, 0, ['qt' => $q4['t']]), $now + 11000);
    $s = Tfm\Gate::status();
    return $in['ch'] > 0 && Tfm\Sync::online($now + 11000) === 3 ? true : 'ticket 4 could not enter: ' . json_encode($s);
});
check('gate — a ticket is refused when it is forged, altered, expired or asked too fast; an admin and a second tab of a seated account always get in', function () use ($T) {
    world(['capacity.max_online' => 1]);
    $now = $T;
    Tfm\Sync::join(acct(1), at(0, 0), $now);
    $q = Tfm\Gate::admit(2, null, false, $now + 1000);
    $parts = explode('.', $q['t']);
    $forged = 'q1.' . rtrim(strtr(base64_encode((string) json_encode([1, intdiv($now, 1000), intdiv($now, 1000) + 1800, 'x'])), '+/', '-_'), '=') . '.' . $parts[2];
    $codes = [
        'forged' => apiCode(function () use ($forged, $now) { Tfm\Gate::poll($forged, $now + 3000); }),
        'altered' => apiCode(function () use ($parts, $now) { Tfm\Gate::poll($parts[0] . '.' . $parts[1] . 'A.' . $parts[2], $now + 3000); }),
        'expired' => apiCode(function () use ($q, $now) { Tfm\Gate::poll($q['t'], $now + 1801000 + 1000); }),
        'garbage' => apiCode(function () use ($now) { Tfm\Gate::poll('hello', $now + 3000); }),
        'an array' => apiCode(function () use ($now) { Tfm\Gate::poll(['q1'], $now + 3000); }),
    ];
    foreach ($codes as $what => $code) if ($code !== '400 QUEUE_TICKET') return "$what → '$code'";
    Tfm\Gate::poll($q['t'], $now + 4000);
    if (apiCode(function () use ($q, $now) { Tfm\Gate::poll($q['t'], $now + 4300); }) !== '429 RATE_LIMITED') return 'a second poll after 300 ms was served';
    $admin = Tfm\Sync::join(acct(50, 'admin'), at(0, 0), $now + 5000);
    $tab = Tfm\Sync::join(acct(1), at(0, 0), $now + 5500);                               // the seated account again
    return $admin['ch'] > 0 && $tab['ch'] > 0 ? true : 'an admin or a seated account was kept outside';
});
check('gate — a ticket whose browser stopped asking loses its turn (the line does not wait for it); when it comes back it is served first', function () use ($T) {
    world(['capacity.max_online' => 1]);
    $now = $T;
    $ch = Tfm\Sync::join(acct(1), at(0, 0), $now)['ch'];
    $qa = Tfm\Gate::admit(2, null, false, $now + 1000);                                  // leaves at once
    $qb = Tfm\Gate::admit(3, null, false, $now + 1100);
    $qc = Tfm\Gate::admit(4, null, false, $now + 1200);
    for ($t = 4000; $t <= 40000; $t += 4000) { Tfm\Sync::exchange($ch, 1, at(0, 0), $now + $t); Tfm\Gate::poll($qb['t'], $now + $t); Tfm\Gate::poll($qc['t'], $now + $t + 10); }
    Tfm\Sync::revoke(1);                                                                  // the seat is free; ticket A has been silent for 40 s
    $pc = Tfm\Gate::poll($qc['t'], $now + 44000);
    $pb = Tfm\Gate::poll($qb['t'], $now + 44010);
    if (!$pb['go'] || $pc['go']) return 'B must be let in (A is gone), C must wait: ' . json_encode([$pb, $pc]);
    $back = Tfm\Gate::poll($qa['t'], $now + 45000);                                      // A comes back: no seat right now, first in line
    Tfm\Sync::join(acct(3), at(0, 0, ['qt' => $qb['t']]), $now + 46000);
    Tfm\Sync::revoke(3);
    $pa = Tfm\Gate::poll($qa['t'], $now + 50000);
    $pc2 = Tfm\Gate::poll($qc['t'], $now + 50010);
    return !$back['go'] && $back['pos'] === 1 && $pa['go'] && !$pc2['go'] ? true : 'returning ticket: ' . json_encode([$back, $pa, $pc2]);
});
check('gate — load figures: requests are counted (sampled), the load factor follows target_rps, the sync answer stretches "next" and the save hint', function () use ($T) {
    world();
    Tfm\Config::override('capacity.sample', 1);
    Tfm\Config::override('capacity.target_rps', 50);
    Tfm\Config::override('capacity.shed_rps', 0);
    Tfm\Gate::reset();
    $sec = time();
    for ($i = 0; $i < 150; $i++) Tfm\Cache::hitWindow('g:rps', $sec, 10);
    $rps = Tfm\Gate::rps();
    $load = Tfm\Gate::load();
    if ($rps < 150 || $rps > 160 || $load < 3.0 || $load > 3.2) return "rps $rps, load $load (150 requests in this second, target 50)";
    $now = Tfm\Clock::ms();
    $a = Tfm\Sync::join(acct(1), at(0, 0), $now);                                        // the channel report stores the load factor
    $tok = ['uid' => 1, 'ch' => $a['ch'], 'iat' => $now, 'exp' => intdiv($now, 1000) + 300, 'boot' => $a['meta']['b']];
    $r = Tfm\Sync::hot($tok, ['p' => [0, 0, 0, 0, 0, 'idle', 'ZONE_MAIN', null, 0]], $now + 1000);
    foreach (['capacity.sample', 'capacity.target_rps', 'capacity.shed_rps'] as $k) Tfm\Config::override($k, null);
    return $r['n'] >= 12000 && $r['n'] <= 12800 && $r['sv'] >= 180000 ? true : 'next ' . $r['n'] . ' ms (idle 4000 × load 3), save hint ' . $r['sv'];
});
check('gate — shedding: above shed_rps new visitors and logins get 503 BUSY + Retry-After, saves and seated calls never; twice the rate also sheds reads; the server PC is never shed', function () use ($T) {
    world();
    foreach (['capacity.sample' => 1, 'capacity.target_rps' => 50, 'capacity.shed_rps' => 100, 'capacity.login_per_sec' => 0] as $k => $v) Tfm\Config::override($k, $v);
    $burn = static function (int $n): void { $sec = time(); for ($i = 0; $i < $n; $i++) Tfm\Cache::hitWindow('g:rps', $sec, 10); };
    $try = static function (string $ip, string $script, string $method = 'GET', bool $cookie = false, array $opt = []): string {
        request($ip, $script, $method);
        if ($cookie) $_COOKIE['TFMSESSID'] = 'abc';
        return apiCode(function () use ($opt) { Tfm\Gate::enter($opt); });
    };
    $calm = $try('203.0.113.5', '/api/ranking/top.php');
    $burn(130);
    $r = [
        'visitor' => $try('203.0.113.5', '/api/ranking/top.php'),
        'login' => $try('203.0.113.5', '/api/auth/login.php', 'POST', true),
        'logged-in read' => $try('203.0.113.5', '/api/ranking/top.php', 'GET', true),
        'save' => $try('203.0.113.5', '/api/player/save.php', 'POST', true),
        'chat send' => $try('203.0.113.5', '/api/chat/send.php', 'POST', true),
        'token sync' => $try('203.0.113.5', '/api/sync.php', 'POST', true, ['shed' => 0]),
        'payment hook' => $try('203.0.113.5', '/api/sub/webhook.php', 'POST'),
        'server PC' => $try('127.0.0.1', '/api/ranking/top.php'),
    ];
    $want = ['visitor' => '503 BUSY', 'login' => '503 BUSY', 'logged-in read' => '', 'save' => '', 'chat send' => '', 'token sync' => '', 'payment hook' => '', 'server PC' => ''];
    if ($calm !== '' || $r !== $want) return 'at 1.3 × shed_rps: ' . json_encode($r) . " (calm: '$calm')";
    $burn(120);
    $hard = ['logged-in read' => $try('203.0.113.5', '/api/ranking/top.php', 'GET', true), 'save' => $try('203.0.113.5', '/api/player/save.php', 'POST', true)];
    request('203.0.113.5', '/api/ranking/top.php');
    $hdr = null;
    try { Tfm\Gate::enter([]); } catch (Tfm\ApiException $e) { $hdr = $e->headers; }
    foreach (['capacity.sample', 'capacity.target_rps', 'capacity.shed_rps', 'capacity.login_per_sec'] as $k) Tfm\Config::override($k, null);
    return $hard === ['logged-in read' => '503 BUSY', 'save' => ''] && is_array($hdr) && preg_match('/^Retry-After: [2-6]$/', $hdr[0]) ? true : 'at 2.5 × shed_rps: ' . json_encode($hard) . ' ' . json_encode($hdr);
});
check('gate — logins are metered: more password checks in one second than login_per_sec get 503 LOGIN_BUSY + Retry-After (not the server PC)', function () {
    world();
    foreach (['capacity.login_per_sec' => 3, 'capacity.shed_rps' => 0] as $k => $v) Tfm\Config::override($k, $v);
    $codes = [];
    $hdr = null;
    for ($try = 0; $try < 3; $try++) {                                                    // again when the clock second turned in the middle
        $codes = [];
        $sec = time();
        for ($i = 0; $i < 6; $i++) {
            request('203.0.113.9', '/api/auth/login.php', 'POST');
            try { Tfm\Gate::enter([]); $codes[] = 'ok'; } catch (Tfm\ApiException $e) { $codes[] = $e->status . ' ' . $e->errorCode; $hdr = $e->headers; }
        }
        if (time() === $sec) break;
    }
    request('127.0.0.1', '/api/auth/login.php', 'POST');
    $local = apiCode(function () { for ($i = 0; $i < 10; $i++) Tfm\Gate::enter([]); });
    foreach (['capacity.login_per_sec', 'capacity.shed_rps'] as $k) Tfm\Config::override($k, null);
    return $codes === ['ok', 'ok', 'ok', '503 LOGIN_BUSY', '503 LOGIN_BUSY', '503 LOGIN_BUSY'] && $local === '' && preg_match('/^Retry-After: [1-9]\d?$/', $hdr[0]) ? true : json_encode($codes) . " local '$local'";
});
check('gate — without a cache nothing is gated and the old presence code path answers from the table', function () use ($T) {
    Tfm\Cache::configure(['driver' => 'off']);
    Tfm\Sync::reset();
    Tfm\Gate::reset();
    request('203.0.113.5', '/api/ranking/top.php');
    $enter = apiCode(function () { Tfm\Gate::enter([]); });
    $u = newUser();
    $v = newUser();
    $now = Tfm\Clock::ms();
    Tfm\Presence::update($u, ['x' => 1, 'y' => 0, 'z' => 2, 'zoneId' => 'ZONE_MAIN'], $now);
    Tfm\Presence::update($v, ['x' => 3, 'y' => 0, 'z' => 4, 'zoneId' => 'ZONE_MAIN'], $now);
    $others = Tfm\Presence::others((int) $u['id'], $now);
    $row = Tfm\Db::one('SELECT x, z FROM presence WHERE user_id = ?', [(int) $u['id']]);
    $f = Tfm\Sync::features();
    Tfm\Cache::reset();
    Tfm\Sync::reset();
    $ids = array_map(static function ($o) { return $o['id']; }, $others);
    return $enter === '' && Tfm\Gate::admit(1) === null && in_array((string) $v['id'], $ids, true) && !in_array((string) $u['id'], $ids, true) && $row && (float) $row['z'] === 2.0 && $f['sync'] === 0 && $f['queue'] === 0
        ? true : json_encode([$enter, $ids, $row, $f]);
});
foreach (['channels.size', 'channels.hard', 'capacity.max_online', 'sync.max_near', 'sync.aoi_radius', 'sync.min_gap_ms', 'rate_limits.sync'] as $k) Tfm\Config::override($k, null);

Tfm\Cache::reset();
echo PHP_EOL . ($failed === 0 ? '✔' : '✖') . " scale-unit: $passed passed, $failed failed" . ($skipped ? ", $skipped skipped" : '') . PHP_EOL;
exit($failed === 0 ? 0 : 1);
