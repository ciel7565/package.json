<?php
/**
 * tests/env-unit.php — Korea in real time (CONTRACT §17.5): Tfm\Env and the real-time beds' calendar basis.
 *   · the 기상청 grid (Lambert conformal conic) against known cells
 *   · sunrise / sunset / solar noon of 정선 against the USNO values (≤ 3 minutes), the moon's illumination (≤ 5 %),
 *     the solstice / equinox noon sun, the season and the 24 절기
 *   · the climatology model: ranges by month over a year, rain / snow / fog where they belong, deterministic per day
 *   · provider 'kma' against tests/stubs/kma-stub.php (php -S 127.0.0.1:25346): every answer shape of the agency
 *     (normal, rain, snow, sleet, fog, NO_DATA, INVALID_REQUEST_PARAMETER, the gateway's XML key / limit errors, HTTP 500,
 *     a 5-second answer = the 3-second timeout, damaged JSON, missing values, the forecast failing alone), the request
 *     itself (base_date / base_time / nx / ny / the key's encoding), the shared cache (10 minutes, no second call), the
 *     back-off after a failure, the stale value kept for 3 hours, the model as the fallback; the key never in a log,
 *     an answer or the cache
 *   · the crop calendar and the gentle factor; Farm::durationMs on the calendar basis; the server-truth rule: a save
 *     that plants gets ready_at = first_seen_at + Env::bedMs(…) whatever the client claims
 *
 *   php tests/env-unit.php            (SQLite in a temp dir; MariaDB with TFM_DB_* like the other unit tests)
 * CLI only; never deployed. TFM_UNIT_ONLY=<text> runs only matching checks. KMA_STUB_PORT overrides 25346.
 */
declare(strict_types=1);

if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
$tmp = sys_get_temp_dir() . '/tfm-env-' . bin2hex(random_bytes(6));
mkdir($tmp, 0700, true);
putenv("TFM_DATA_DIR=$tmp");
putenv("TFM_UPLOAD_DIR=$tmp/uploads");
putenv('TFM_KMA_KEY');            // the environment of the shell must not leak a real key into the test
require __DIR__ . '/../server/lib/bootstrap.php';

use Tfm\Env;

$failed = 0;
$passed = 0;
function check(string $name, callable $test): void
{
    global $failed, $passed;
    $only = (string) getenv('TFM_UNIT_ONLY');
    if ($only !== '' && strpos($name, $only) === false) return;
    try {
        $r = $test();
        $ok = $r === true;
        $detail = is_string($r) ? $r : ($ok ? '' : 'assertion is false');
    } catch (Throwable $e) {
        $ok = false;
        $detail = get_class($e) . ': ' . $e->getMessage() . ' @' . basename($e->getFile()) . ':' . $e->getLine();
    }
    if ($ok) $passed++; else $failed++;
    echo ($ok ? "PASS  " : "FAIL  ") . $name . ($ok || $detail === '' ? '' : "  — $detail") . PHP_EOL;
}
/** ms of a KST wall-clock time 'Y-m-d H:i' */
function kstMs(string $s): int { return (strtotime($s . ' +0900') ?: 0) * 1000; }
/** 'HH:MM' of a KST ms */
function hm(?int $ms): string { if ($ms === null) return 'null'; $k = Env::kst($ms); return sprintf('%02d:%02d', $k['h'], $k['mi']); }
function minutesOf(string $hhmm): int { return (int) substr($hhmm, 0, 2) * 60 + (int) substr($hhmm, 3, 2); }

Tfm\Db::pdo();
echo 'driver: ' . Tfm\Db::driver() . PHP_EOL;

// ============================================================================ 1 · grid, sun, moon, season
check('kmaGrid — Seoul (60,127), Daejeon (67,100), Busan (98,76), 정선 (89,123) by the agency formula', function () {
    $g = [Env::kmaGrid(37.5665, 126.978), Env::kmaGrid(36.3504, 127.3845), Env::kmaGrid(35.1796, 129.0756), Env::kmaGrid(Env::LAT, Env::LON)];
    $want = [[60, 127], [67, 100], [98, 76], [89, 123]];
    foreach ($g as $i => $c) if ([$c['nx'], $c['ny']] !== $want[$i]) return json_encode($g);
    return true;
});
// USNO rstt/oneday for coords 37.38,128.66, tz +9 (fetched 2026-11-15; see the env lane's crop notes)
$USNO = [
    ['2026-01-01', '07:40', '17:18', '12:29', 92], ['2026-03-20', '06:30', '18:37', '12:33', 2], ['2026-06-21', '05:05', '19:49', '12:27', 42],
    ['2026-09-23', '06:14', '18:21', '12:18', 87], ['2026-11-15', '07:04', '17:15', '12:10', 28], ['2026-12-22', '07:36', '17:11', '12:24', 94],
];
check('sunTimes — sunrise / sunset of 정선 within 3 minutes and solar noon within 2 minutes of the USNO values (6 dates)', function () use ($USNO) {
    $worst = 0; $out = [];
    foreach ($USNO as $r) {
        $t = Env::sunTimes(kstMs($r[0] . ' 12:00'));
        $d = [abs(minutesOf(hm($t['rise'])) - minutesOf($r[1])), abs(minutesOf(hm($t['set'])) - minutesOf($r[2])), abs(minutesOf(hm($t['noon'])) - minutesOf($r[3]))];
        $out[] = $r[0] . ' ' . hm($t['rise']) . '/' . hm($t['set']) . '/' . hm($t['noon']);
        if ($d[0] > 3 || $d[1] > 3 || $d[2] > 2) return 'off: ' . implode(' · ', $out);
        $worst = max($worst, $d[0], $d[1]);
    }
    return true;
});
check('moon — illumination at 12:00 KST within 5 % of USNO; waxing before a full moon', function () use ($USNO) {
    foreach ($USNO as $r) {
        $m = Env::moon(kstMs($r[0] . ' 12:00'));
        if (abs($m['illum'] * 100 - $r[4]) > 5) return $r[0] . ' illum ' . round($m['illum'] * 100, 1) . ' vs ' . $r[4];
    }
    $w = Env::moon(kstMs('2026-12-22 12:00'));
    return $w['waxing'] === true ? true : 'waxing ' . json_encode($w);
});
check('sunPos — noon sun of the June solstice ≈ 76.1°, of the March equinox ≈ 52.7°, due south; below the horizon at midnight', function () {
    $s = Env::sunPos(kstMs('2026-06-21 12:27'));
    $e = Env::sunPos(kstMs('2026-03-20 12:33'));
    $n = Env::sunPos(kstMs('2026-06-21 00:30'));
    return abs($s['elev'] - 76.1) < 0.4 && abs($s['az'] - 180) < 2 && abs($e['elev'] - 52.7) < 0.6 && $n['elev'] < -20
        ? true : json_encode([$s, $e, $n]);
});
check('season — 11-15 가을 입동, 12-22 겨울 동지, 03-21 봄 춘분, 07-10 여름 소서', function () {
    $a = Env::season(kstMs('2026-11-15 12:00')); $b = Env::season(kstMs('2026-12-22 12:00'));
    $c = Env::season(kstMs('2026-03-21 12:00')); $d = Env::season(kstMs('2026-07-10 12:00'));
    return [$a['id'], $a['term'], $b['id'], $b['term'], $c['id'], $c['term'], $d['id'], $d['term']] === ['autumn', '입동', 'winter', '동지', 'spring', '춘분', 'summer', '소서']
        ? true : json_encode([$a, $b, $c, $d], JSON_UNESCAPED_UNICODE);
});
check('kst — the KST calendar of a UTC timestamp (2026-12-31 15:30 UTC = 2027-01-01 00:30 KST)', function () {
    $k = Env::kst((int) (gmmktime(15, 30, 0, 12, 31, 2026) * 1000));
    return [$k['y'], $k['mo'], $k['d'], $k['h'], $k['mi'], $k['doy'], $k['key']] === [2027, 1, 1, 0, 30, 1, 20270101] ? true : json_encode($k);
});

// ============================================================================ 2 · the model
check('model — a year of hours: monthly mean temperature near the 정선 normals, extremes plausible, humidity 20–100, wind 0.2–8', function () {
    $mx = [2, 5, 11, 19, 24, 27, 29, 29, 25, 19, 11, 4]; $mn = [-11, -8, -3, 3, 9, 15, 20, 20, 14, 6, -1, -8];
    $sum = array_fill(1, 12, 0.0); $n = array_fill(1, 12, 0); $lo = array_fill(1, 12, 99.0); $hi = array_fill(1, 12, -99.0);
    $t0 = kstMs('2026-01-01 00:00');
    for ($i = 0; $i < 365 * 24; $i++) {
        $ms = $t0 + $i * 3600000; $m = Env::modelAt($ms); $mo = Env::kst($ms)['mo'];
        $sum[$mo] += $m['temp']; $n[$mo]++; $lo[$mo] = min($lo[$mo], $m['temp']); $hi[$mo] = max($hi[$mo], $m['temp']);
        if ($m['humidity'] < 20 || $m['humidity'] > 100 || $m['wind'] < 0.2 || $m['wind'] > 8) return "hour $i " . json_encode($m);
    }
    for ($mo = 1; $mo <= 12; $mo++) {
        $mean = $sum[$mo] / $n[$mo]; $normal = ($mx[$mo - 1] + $mn[$mo - 1]) / 2;
        if (abs($mean - $normal) > 3.5) return "month $mo mean " . round($mean, 1) . " vs $normal";
        if ($lo[$mo] < $mn[$mo - 1] - 9 || $hi[$mo] > $mx[$mo - 1] + 7) return "month $mo range {$lo[$mo]}…{$hi[$mo]}";
    }
    return true;
});
check('model — wet days per month follow the normals (summer wettest), snow only in the cold months, fog only on mornings', function () {
    $wet = array_fill(1, 12, 0); $snow = array_fill(1, 12, 0); $fogBad = 0; $snowWarm = 0;
    $t0 = kstMs('2026-01-01 00:00');
    for ($d = 0; $d < 365; $d++) {
        $day = $t0 + $d * 86400000; $mo = Env::kst($day)['mo'];
        if (Env::dayPlan($day)['wet']) $wet[$mo]++;
        for ($h = 0; $h < 24; $h++) {
            $m = Env::modelAt($day + $h * 3600000);
            if ($m['weather'] === 'SNOW') { $snow[$mo]++; if ($m['temp'] > 1) $snowWarm++; }
            if ($m['weather'] === 'FOG' && ($h < 4 || $h >= 10)) $fogBad++;
        }
    }
    $summer = $wet[7] + $wet[8]; $winter = $wet[1] + $wet[2];
    $snowSummer = $snow[5] + $snow[6] + $snow[7] + $snow[8] + $snow[9];
    $total = array_sum($wet);
    return $summer > $winter && $snowSummer === 0 && $snowWarm === 0 && $fogBad === 0 && $total >= 60 && $total <= 150 && ($snow[1] + $snow[2] + $snow[12]) > 0
        ? true : 'wet ' . json_encode($wet) . ' snow ' . json_encode($snow) . " fogBad $fogBad snowWarm $snowWarm";
});
check('model — the same moment gives the same weather (everyone sees one 정선 that day); modelSnap has the answer shape', function () {
    $ms = kstMs('2026-11-15 17:40');
    $a = Env::modelSnap($ms); $b = Env::modelSnap($ms);
    $keys = ['t', 'tz', 'weather', 'temp', 'humidity', 'wind', 'rain1h', 'source', 'sunrise', 'sunset', 'season', 'seasonName', 'term', 'next'];
    return $a === $b && array_keys($a) === $keys && in_array($a['weather'], Env::IDS, true) && $a['source'] === 'model' && $a['tz'] === 'Asia/Seoul'
        && is_int($a['sunrise']) && is_int($a['sunset']) && $a['sunrise'] < $a['sunset'] && $a['next']['t'] === $ms + 3600000 ? true : json_encode($a, JSON_UNESCAPED_UNICODE);
});
check('model — 32-bit mixing equals JavaScript Math.imul: imul(0x7feb352d, 0x846ca68b) and mix32 of known inputs', function () {
    // values computed with node: Math.imul(0x7feb352d, 0x846ca68b) >>> 0 = 2620198255, Math.imul(-1, 3) >>> 0 = 4294967293
    return Env::imul(0x7feb352d, 0x846ca68b) === 2620198255 && Env::imul(-1, 3) === 4294967293 && Env::imul(0xffffffff, 0xffffffff) === 1 ? true
        : Env::imul(0x7feb352d, 0x846ca68b) . ' ' . Env::imul(-1, 3) . ' ' . Env::imul(0xffffffff, 0xffffffff);
});

// ============================================================================ 3 · settings, provider, base address
check('provider — no key → model; a key → kma; env.weather_source = model → model; the base address must be https (http only on this machine)', function () {
    Tfm\Config::override('env.kma_key', '');
    $a = Env::provider();
    Tfm\Config::override('env.kma_key', 'k');
    $b = Env::provider();
    Tfm\Config::override('env.weather_source', 'model');
    $c = Env::provider();
    Tfm\Config::override('env.weather_source', 'auto');
    $bases = [];
    foreach (['https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/', 'http://evil.example/x', 'http://127.0.0.1:25346/ok', 'ftp://x/y', 'javascript:alert(1)'] as $u) {
        Tfm\Config::override('env.kma_base', $u); $bases[] = Env::base();
    }
    Tfm\Config::override('env.kma_key', '');
    return $a === 'model' && $b === 'kma' && $c === 'model'
        && $bases === ['https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0', '', 'http://127.0.0.1:25346/ok', '', ''] ? true : json_encode([$a, $b, $c, $bases]);
});
check('baseTimes — 초단기실황 HH00 from HH:40, 초단기예보 HH30 from HH:45; past midnight it is the day before', function () {
    $a = Env::baseTimes(kstMs('2026-11-15 17:39')); $b = Env::baseTimes(kstMs('2026-11-15 17:46')); $c = Env::baseTimes(kstMs('2026-11-16 00:20'));
    return $a === ['ncst' => ['20261115', '1600'], 'fcst' => ['20261115', '1630']] && $b === ['ncst' => ['20261115', '1700'], 'fcst' => ['20261115', '1730']]
        && $c === ['ncst' => ['20261115', '2300'], 'fcst' => ['20261115', '2330']] ? true : json_encode([$a, $b, $c]);
});
check('settings — night brightness 0.6–1.6 (default 1.25, garbage → default), clock default kst|fast|fixed, basis calendar|short', function () {
    $out = [Env::nightBrightness(), Env::clockDefault(), Env::basis()];
    Tfm\Config::override('env.night_brightness', 9); $out[] = Env::nightBrightness();
    Tfm\Config::override('env.night_brightness', 0.8); $out[] = Env::nightBrightness();
    Tfm\Config::override('env.clock_default', '<b>'); $out[] = Env::clockDefault();
    Tfm\Config::override('env.clock_default', 'fast'); $out[] = Env::clockDefault();
    Tfm\Config::override('farm.rt_basis', 'short'); $out[] = Env::basis();
    Tfm\Config::override('farm.rt_basis', 'x'); $out[] = Env::basis();
    Tfm\Config::override('env.night_brightness', 1.25); Tfm\Config::override('env.clock_default', 'kst'); Tfm\Config::override('farm.rt_basis', 'calendar');
    return $out === [1.25, 'kst', 'calendar', 1.25, 0.8, 'kst', 'fast', 'short', 'calendar'] ? true : json_encode($out);
});

// ============================================================================ 4 · provider 'kma' against the stub
$PORT = (int) (getenv('KMA_STUB_PORT') ?: 25346);
$KEY = 'test+key/한=1';           // a decoded key with characters that need encoding
$stubLog = $tmp . '/kma-stub.log';
$stub = proc_open([PHP_BINARY, '-S', "127.0.0.1:$PORT", __DIR__ . '/stubs/kma-stub.php'], [0 => ['pipe', 'r'], 1 => ['file', $tmp . '/stub.out', 'a'], 2 => ['file', $tmp . '/stub.err', 'a']], $pipes, null,
    array_merge(getenv(), ['KMA_STUB_LOG' => $stubLog, 'KMA_STUB_KEY' => $KEY]));
$up = false;
for ($i = 0; $i < 60 && !$up; $i++) { $fp = @fsockopen('127.0.0.1', $PORT, $en, $es, 0.2); if ($fp) { fclose($fp); $up = true; } else usleep(100000); }
echo $up ? "stub: 127.0.0.1:$PORT\n" : "stub: NOT UP on $PORT\n";
$T = kstMs('2026-11-15 17:50');
$useStub = function (string $mode) use ($PORT, $KEY): void {
    Tfm\Config::override('env.kma_key', $KEY);
    Tfm\Config::override('env.kma_base', "http://127.0.0.1:$PORT/$mode");
    Tfm\Cache::del('env:kma:v1'); Tfm\Cache::del('env:kma:fail'); Tfm\Cache::unlock('env:kma');
};
$lastReq = function () use ($stubLog): array { $l = @file($stubLog, FILE_IGNORE_NEW_LINES) ?: []; return $l ? (json_decode((string) end($l), true) ?: []) : []; };

check('kma ok — two calls (실황 + 예보) with base_date / base_time / nx 89 / ny 123 / JSON and the key correctly encoded; the snapshot is the observation', function () use ($useStub, $T, $lastReq, $stubLog) {
    $useStub('ok'); @unlink($stubLog); Env::$calls = 0;
    $ok = Env::refreshKma($T);
    $lines = array_map(function ($l) { return json_decode($l, true); }, @file($stubLog, FILE_IGNORE_NEW_LINES) ?: []);
    $n = Env::now($T);
    $req = count($lines) === 2 && $lines[0]['q']['base_time'] === '1700' && $lines[1]['q']['base_time'] === '1730' && $lines[0]['keyMatched'] === true && $lines[1]['keyMatched'] === true
        && $lines[0]['q']['nx'] === '89' && $lines[0]['q']['ny'] === '123' && $lines[0]['q']['dataType'] === 'JSON';
    return $ok && $req && Env::$calls === 2 && $n['source'] === 'kma' && $n['weather'] === 'CLEAR' && $n['temp'] === 8.2 && $n['humidity'] === 55 && $n['wind'] === 2.1
        && $n['rain1h'] === 0.0 && $n['next']['weather'] === 'CLEAR' && $n['next']['temp'] === 9.2 && $n['next']['t'] === kstMs('2026-11-15 18:00') && isset($n['cfg']['nightBrightness']) ? true : json_encode(['ok' => $ok, 'lines' => $lines, 'now' => $n], JSON_UNESCAPED_UNICODE);
});
check('kma cache — within 10 minutes no second call; the answer keeps its 기상청 values', function () use ($T) {
    $c0 = Env::$calls;
    $a = Env::now($T + 60000); $b = Env::now($T + 9 * 60000);
    return Env::$calls === $c0 && $a['source'] === 'kma' && $b['source'] === 'kma' && $b['t'] === $T + 9 * 60000 ? true : 'calls ' . (Env::$calls - $c0);
});
check('kma weathers — rain (PTY 1), snow (PTY 3), sleet at 0.3 °C (PTY 2 → snow), fog (REH 98, wind 0.6, 06:30), cloudy (SKY 4)', function () use ($useStub) {
    $want = ['rain' => ['RAIN', '2026-11-15 17:50'], 'snow' => ['SNOW', '2026-11-15 17:50'], 'sleet' => ['SNOW', '2026-11-15 17:50'], 'fog' => ['FOG', '2026-11-15 06:30'], 'cloudy' => ['CLOUDY', '2026-11-15 17:50']];
    $got = [];
    foreach ($want as $mode => $w) {
        $useStub($mode);
        $t = kstMs($w[1]);
        $ok = Env::refreshKma($t);
        $got[$mode] = $ok ? Env::now($t)['weather'] : 'refresh failed';
    }
    foreach ($want as $mode => $w) if ($got[$mode] !== $w[0]) return json_encode($got);
    $useStub('rain'); Env::refreshKma(kstMs('2026-11-15 17:50'));
    $r = Env::now(kstMs('2026-11-15 17:50'));
    return $r['rain1h'] === 2.5 && $r['humidity'] === 93 ? true : json_encode($r);
});
$errorModes = ['nodata' => 'resultCode 03', 'badparam' => 'resultCode 10', 'xmlkey' => 'gateway error 30', 'limit' => 'gateway error 22', 'http500' => 'HTTP 500', 'garbage' => 'not the agency JSON', 'missing' => 'T1H out of range'];
check('kma error shapes — NO_DATA, INVALID_REQUEST_PARAMETER, the XML key / limit errors, HTTP 500, damaged JSON, missing values: refused, logged without the key, the model answers', function () use ($useStub, $T, $errorModes, $KEY, $tmp) {
    $bad = [];
    foreach ($errorModes as $mode => $why) {
        $useStub($mode);
        $ok = Env::refreshKma($T);
        $n = Env::now($T);
        if ($ok || $n['source'] !== 'model') $bad[] = "$mode ok=" . json_encode($ok) . ' src=' . $n['source'];
    }
    // the reasons are in the log, the key is not (neither plain nor encoded)
    $logs = '';
    foreach (glob(Tfm\Log::dir() . DIRECTORY_SEPARATOR . '*') ?: [] as $f) $logs .= (string) @file_get_contents($f);
    foreach ($errorModes as $mode => $why) if (strpos($logs, $why) === false) $bad[] = "log lacks '$why'";
    if (strpos($logs, $KEY) !== false || strpos($logs, rawurlencode($KEY)) !== false) $bad[] = 'KEY IN LOG';
    if (strpos($logs, '127.0.0.1:') !== false) $bad[] = 'address in log';
    return $bad ? implode(' · ', $bad) : true;
});
check('kma timeout — an answer that takes 5 s is cut at 3 s (one call), refused, and the next 2 minutes do not call again (back-off)', function () use ($useStub, $T) {
    $useStub('slow');
    $c0 = Env::$calls; $t0 = microtime(true);
    $ok = Env::refreshKma($T);
    $dt = microtime(true) - $t0;
    $c1 = Env::$calls;
    $n = Env::now($T + 30000);                   // backing off: the CLI path does not fetch again
    return !$ok && $dt >= 2.5 && $dt < 4.5 && $c1 - $c0 === 1 && Env::$calls === $c1 && $n['source'] === 'model' ? true : "ok=$ok dt=" . round($dt, 2) . ' calls=' . ($c1 - $c0) . '/' . (Env::$calls - $c1) . ' src=' . $n['source'];
});
check('kma stale — a good value stays the answer for up to 3 hours when later fetches fail; after that the model answers', function () use ($useStub, $T, $PORT) {
    $useStub('ok');
    if (!Env::refreshKma($T)) return 'first fetch failed';
    Tfm\Config::override('env.kma_base', "http://127.0.0.1:$PORT/http500");
    $f = Env::refreshKma($T + 15 * 60000);
    $a = Env::now($T + 2 * 3600000)['source'];
    $b = Env::now($T + 3 * 3600000 + 120000)['source'];
    return !$f && $a === 'kma' && $b === 'model' ? true : "refresh=$f 2h=$a 3h+=$b";
});
check('kma forecast fails alone — the observation is still used (weather by humidity, next = now)', function () use ($useStub, $T) {
    $useStub('fcstfail');
    $ok = Env::refreshKma($T);
    $n = Env::now($T);
    return $ok && $n['source'] === 'kma' && $n['temp'] === 9.0 && in_array($n['weather'], ['CLEAR', 'CLOUDY'], true) ? true : json_encode($n);
});
check('kma secrets — the key is in no answer and in no cache record; a wrong key gets the gateway error (the stub checks it like the agency)', function () use ($useStub, $T, $KEY, $PORT) {
    $useStub('ok');
    Env::refreshKma($T);
    $ans = json_encode(Env::now($T), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    $cache = json_encode(Tfm\Cache::get('env:kma:v1'), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    Tfm\Config::override('env.kma_key', 'wrong-key');
    Tfm\Cache::del('env:kma:v1'); Tfm\Cache::del('env:kma:fail');
    $wrong = Env::refreshKma($T);
    return strpos($ans, $KEY) === false && strpos((string) $cache, $KEY) === false && strpos($ans, (string) $PORT) === false && !$wrong ? true : 'leak or wrong key accepted';
});
check('weatherFor — the farm reads the cache or the model, never the network', function () use ($useStub, $T) {
    $useStub('rain'); Env::refreshKma($T);
    $c0 = Env::$calls;
    $a = Env::weatherFor($T + 60000);                 // fresh kma value → RAIN
    $b = Env::weatherFor($T + 3600000);               // more than 30 min away → the model
    Tfm\Cache::del('env:kma:v1');
    $c = Env::weatherFor($T);                          // no cache → the model, no call
    return $a === 'RAIN' && $b === Env::modelAt($T + 3600000)['weather'] && $c === Env::modelAt($T)['weather'] && Env::$calls === $c0 ? true : json_encode([$a, $b, $c, Env::$calls - $c0]);
});
if (is_resource($stub)) { proc_terminate($stub); proc_close($stub); }
Tfm\Config::override('env.kma_key', '');
Tfm\Config::override('env.kma_base', Env::DEFAULT_BASE);

// ============================================================================ 5 · the crop calendar and the real-time beds
$calJson = shell_exec('node -e ' . escapeshellarg("const fs=require('fs'),vm=require('vm');const G={data:{}};const c={G};vm.createContext(c);vm.runInContext(fs.readFileSync(" . json_encode(realpath(__DIR__ . '/../src/game/01-data.js')) . ",'utf8'),c);process.stdout.write(JSON.stringify(G.data.cropCalendar||{}))") . ' 2>/dev/null');
$CAL = is_string($calJson) ? json_decode($calJson, true) : null;
Env::$calendar = is_array($CAL) ? $CAL : null;
check('calendar — every real-time crop has sow / harvest months and days (read from src/game/01-data.js, the same table the build exports)', function () use ($CAL) {
    if (!is_array($CAL) || !$CAL) return 'node could not read 01-data.js';
    foreach (array_keys(Tfm\GameData::rtfarm()['crops']) as $id) {
        $c = Env::cal($id);
        if (!$c || !$c['sow'] || !$c['harvest'] || $c['days'] < 30 || $c['days'] > 200) return "$id " . json_encode($c);
    }
    return Env::cal('CROP_CABBAGE')['sow'] === [3, 4, 8] && Env::cal('CROP_CABBAGE')['days'] === 85.0 ? true : json_encode(Env::cal('CROP_CABBAGE'));
});
check('cropFactor — in season 1 × weather (clear 1.05), a month off 0.85, summer off-season 0.7, winter 0.55 × snow 0.92 → 0.506, never below 0.5', function () {
    $cab = Env::cal('CROP_CABBAGE');
    $f = [Env::cropFactor($cab, kstMs('2026-08-15 10:00'), 'CLEAR'), Env::cropFactor($cab, kstMs('2026-08-15 10:00'), 'CLOUDY'), Env::cropFactor($cab, kstMs('2026-09-10 10:00'), 'CLOUDY'),
        Env::cropFactor($cab, kstMs('2026-06-10 10:00'), 'CLOUDY'), Env::cropFactor($cab, kstMs('2026-12-10 10:00'), 'SNOW'), Env::cropFactor(null, kstMs('2026-12-10 10:00'), 'SNOW')];
    return $f === [1.05, 1.0, 0.85, 0.7, 0.506, 1.0] ? true : json_encode($f);
});
check('Farm::durationMs (calendar) — 배추 on 8-15 at tier 1: 85 days ÷ factor; tier 2 halves; scale 60; 2 h before a weather change the same', function () {
    $t = kstMs('2026-08-15 10:00');
    $w = Env::weatherFor($t); $f = Env::cropFactor(Env::cal('CROP_CABBAGE'), $t, $w);
    $d1 = Tfm\Farm::durationMs('CROP_CABBAGE', 1, 1.0, $t, 'calendar');
    $d2 = Tfm\Farm::durationMs('CROP_CABBAGE', 2, 1.0, $t, 'calendar');
    $d60 = Tfm\Farm::durationMs('CROP_CABBAGE', 1, 60.0, $t, 'calendar');
    $short = Tfm\Farm::durationMs('CROP_CABBAGE', 1, 1.0, $t, 'short');
    $exp = (int) floor(85 * 86400000 / $f + 0.5);
    return $d1 === $exp && abs($d2 * 2 - $d1) <= 1 && abs($d60 * 60 - $d1) <= 60 && $short === 120 * 60000 ? true : json_encode([$d1, $exp, $d2, $d60, $short, $f, $w]);
});
check('server truth — a save that plants 배추 on the calendar basis: ready_at = first_seen_at + Env::bedMs(…) by the server clock; the client\'s readyAt is ignored; view() says basis calendar', function () use ($tmp) {
    Tfm\Config::override('farm.rt_basis', 'calendar'); Tfm\Config::override('farm.rt_scale', 1.0);
    if (class_exists('Tfm\Settings')) Tfm\Settings::reset();
    $u = Tfm\Users::create('env' . bin2hex(random_bytes(3)) . '@example.com', 'Env' . bin2hex(random_bytes(2)), 'Ferment2026ok', '');
    $now = Tfm\Clock::ms();
    $mk = function (?array $bed) use ($now) {
        $s = ['rtfarm' => ['beds' => $bed ? ['RB1' => $bed] : new stdClass(), 'last' => [], 'reports' => []], 'stats' => ['rtHarvests' => 0], 'farm' => ['plots' => new stdClass()], 'storage' => ['items' => new stdClass(), 'cap' => 300]];
        return json_decode(json_encode($s), false);
    };
    $pid = bin2hex(random_bytes(8));
    $p = $mk(null);
    $n = $mk(['cropId' => 'CROP_CABBAGE', 'pid' => $pid, 'plantedAt' => $now - 99 * 86400000, 'readyAt' => $now - 1, 'dur' => 1, 'tier' => 1, 'care' => 0, 'lastCareAt' => 0]);
    $plan = Tfm\Farm::sync((int) $u['id'], $n, $p, $now, 1);
    if (!$plan['ok']) return 'violations ' . json_encode($plan['violations']);
    $row = Tfm\Db::one('SELECT first_seen_at, ready_at FROM farm_beds WHERE user_id = ? AND pid = ?', [(int) $u['id'], $pid]);
    $want = Env::bedMs(['basis' => 'calendar', 'cal' => Env::cal('CROP_CABBAGE'), 'tier' => 1, 'scale' => 1.0, 't' => $now, 'weather' => Env::weatherFor($now)]);
    $v = Tfm\Farm::view((int) $u['id'], 1, $now + 1000);
    return $row && (int) $row['first_seen_at'] === $now && (int) $row['ready_at'] === $now + $want && $want > 30 * 86400000 && $v['basis'] === 'calendar'
        && $v['beds']['RB1']['readyAt'] === $now + $want ? true : json_encode(['row' => $row, 'want' => $want, 'view' => $v]);
});
check('server truth — an early harvest of that planting is refused (RT_HARVEST_TOO_EARLY): the calendar never makes a crop ready sooner than the server says', function () {
    $r = Tfm\Db::one("SELECT user_id, pid, ready_at FROM farm_beds WHERE kind = 'rt' AND crop_id = 'CROP_CABBAGE' ORDER BY id DESC LIMIT 1");
    if (!$r) return 'no planting';
    $now = Tfm\Clock::ms();
    $mk = function (?array $bed, int $h, array $last) {
        $s = ['rtfarm' => ['beds' => $bed ? ['RB1' => $bed] : new stdClass(), 'last' => $last, 'reports' => []], 'stats' => ['rtHarvests' => $h], 'farm' => ['plots' => new stdClass()], 'storage' => ['items' => ['ITEM_CABBAGE' => 3], 'cap' => 300]];
        return json_decode(json_encode($s), false);
    };
    $bed = ['cropId' => 'CROP_CABBAGE', 'pid' => $r['pid'], 'plantedAt' => $now, 'readyAt' => $now, 'dur' => 1, 'tier' => 1, 'care' => 0, 'lastCareAt' => 0];
    $p = $mk($bed, 0, []);
    $n = $mk(null, 1, [['pid' => $r['pid'], 'bedId' => 'RB1', 'cropId' => 'CROP_CABBAGE', 'amount' => 3, 'stars' => 1, 'at' => $now]]);
    $plan = Tfm\Farm::plan((int) $r['user_id'], $n, $p, $now + 1000, 1);
    $codes = array_map(function ($v) { return $v['code']; }, $plan['violations']);
    return !$plan['ok'] && in_array('RT_HARVEST_TOO_EARLY', $codes, true) ? true : json_encode($codes);
});

echo PHP_EOL . "env-unit: $passed passed, $failed failed" . PHP_EOL;
exit($failed ? 1 : 0);
