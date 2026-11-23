<?php
/**
 * tests/fishing-unit.php — the server side of a catch (CONTRACT §18.3, §18.0 "protected animals"):
 *   · the fish table that tools/build.mjs exports into game-data.json (31 species, the 16 items FISH_<ID>, neighbours,
 *     spots, baits, limits, quests, achievements) as Tfm\GameData reads it;
 *   · the [fishing] block of Tfm\SaveValidator: a save that holds G.state.fishing and FISH_<ID> items is accepted; an
 *     unknown species, a protected species as an item (bag or 곳간) or marked as taken along, counts and lengths out of
 *     range, a counter ahead of the 도감, more fish than the hard daily ceiling, more catches than time allows are
 *     violations (the client is handed the server's copy back); a wrong container is malformed (400); the exp / edu of
 *     catches is explained;
 *   · the operator settings fishing.enabled / fishing.keep_per_day / fishing.trap_minutes: registered, typed, ranged,
 *     public — they are part of the `site` object that api/ping.php, api/auth/me.php and api/auth/login.php send
 *     (Tfm\Entitle::siteOut), and a change moves the stamp a save answers with.
 *
 *   php tests/fishing-unit.php            (builds a fresh game-data.json for a private copy of server/ — needs node)
 *   TFM_DB_DRIVER=mysql TFM_DB_HOST=127.0.0.1 TFM_DB_PORT=33106 TFM_DB_USER=root TFM_DB_NAME=<a database of yours> php tests/fishing-unit.php
 *   TFM_FISH_REPO=<dir>  build the export from another checkout (a snapshot) instead of this one
 *
 * CLI only; never deployed. Developer tooling: runs on the dev PHP (8.x); the code under test is PHP 7.2.
 */
declare(strict_types=1);

if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
function copyTree(string $from, string $to): void
{
    if (!is_dir($to)) mkdir($to, 0700, true);
    foreach (scandir($from) ?: [] as $f) {
        if ($f === '.' || $f === '..') continue;
        if (is_dir("$from/$f")) copyTree("$from/$f", "$to/$f");
        elseif (!preg_match('/\.sqlite(-wal|-shm)?$|config\.local\.php$|secret\.php$|install\.lock$/', $f)) copy("$from/$f", "$to/$f");
    }
}
$repo = (string) getenv('TFM_FISH_REPO');
$repo = $repo !== '' && is_dir($repo . '/server') ? (string) realpath($repo) : (string) realpath(__DIR__ . '/..');
$root = sys_get_temp_dir() . '/tfm-fishing-' . bin2hex(random_bytes(6));
$srv = $root . '/srv';
$tmp = $root . '/data';
mkdir($tmp, 0700, true);
copyTree($repo . '/server', $srv);
// the export of this tree (the tracked game-data.json belongs to the release step and may predate the fish)
$cmd = 'node ' . escapeshellarg($repo . '/tools/build.mjs') . ' --no-font --no-assets --quiet --out ' . escapeshellarg($root . '/x.html') . ' --data-out ' . escapeshellarg($srv . '/data/game-data.json') . ' 2>&1';
exec($cmd, $buildOut, $rc);
if ($rc !== 0 || !is_file($srv . '/data/game-data.json')) { fwrite(STDERR, "✖ build failed:\n" . implode("\n", $buildOut) . "\n"); exit(2); }
putenv("TFM_DATA_DIR=$tmp");
putenv("TFM_UPLOAD_DIR=$tmp/uploads");
putenv('TFM_TOSS_MOCK=1');
require $srv . '/lib/bootstrap.php';

$failed = 0; $passed = 0;
function check(string $name, callable $test): void
{
    global $failed, $passed;
    try { $r = $test(); $ok = $r === true; $detail = is_string($r) ? $r : ($ok ? '' : 'assertion is false'); }
    catch (Throwable $e) { $ok = false; $detail = get_class($e) . ': ' . $e->getMessage() . ' @' . basename($e->getFile()) . ':' . $e->getLine(); }
    if ($ok) $passed++; else $failed++;
    echo ($ok ? '✔ ' : '✖ ') . $name . ($ok ? '' : ' — ' . $detail) . "\n";
}
function cl($o) { return json_decode((string) json_encode($o), false); }
function j($v): string { return (string) json_encode($v, JSON_UNESCAPED_UNICODE); }
function apiCode(callable $fn): string
{
    try { $fn(); } catch (Tfm\ApiException $e) { return $e->status . ' ' . $e->errorCode; }
    return '';
}
$T0 = 1790000000000;
$u = ['id' => 7, 'nickname' => '강가손님', 'email' => 'angler@example.test', 'role' => 'user'];
/** a small, clean save; $over replaces top-level keys (fishing, inventory, storage, stats are merged in by the caller) */
function state(array $u, int $t, $fishing = null, array $stats = [], array $bag = [], array $store = []): stdClass
{
    $s = [
        'version' => 1, 'createdAt' => $t, 'savedAt' => $t,
        'profile' => ['id' => (string) $u['id'], 'nickname' => $u['nickname'], 'email' => $u['email'], 'role' => $u['role'], 'avatar' => null, 'title' => '', 'titles' => []],
        'stats' => array_merge(['level' => 1, 'exp' => 0, 'coin' => 3000, 'edu' => 0, 'logins' => 1, 'playTime' => 0, 'distance' => 0, 'harvests' => 0, 'crafts' => 0, 'fermentsClaimed' => 0, 'rtHarvests' => 0], $stats),
        'player' => ['x' => 0, 'y' => 0, 'z' => 9, 'zoneId' => 'ZONE_MAIN'],
        'inventory' => array_merge(['ITEM_MEJU' => 1], $bag), 'quests' => new stdClass(), 'farm' => ['plots' => new stdClass()], 'jars' => new stdClass(),
        'education' => ['viewed' => new stdClass(), 'completed' => new stdClass(), 'quiz' => new stdClass()],
        'journal' => [], 'photos' => [], 'achievements' => new stdClass(), 'collection' => new stdClass(), 'visited' => ['ZONE_MAIN' => $t],
        'flags' => new stdClass(), 'activity' => [],
        'rtfarm' => ['beds' => new stdClass(), 'last' => [], 'reports' => []],
        'storage' => ['items' => $store ? $store : new stdClass(), 'cap' => 300],
    ];
    if ($fishing !== null) $s['fishing'] = $fishing;
    return json_decode((string) json_encode($s), false);
}
function codes(array $res): array { return array_values(array_unique(array_map(function ($v) { return $v['code']; }, $res['violations']))); }
$judge = function (stdClass $n, stdClass $p, int $seconds = 60) use ($u, $T0) { return Tfm\SaveValidator::validate(cl($n), cl($p), ['v' => 1, 'tier' => 1], $u, $T0, $T0 + $seconds * 1000, 1, null); };

$gd = Tfm\GameData::all();
$F = Tfm\GameData::fish();
$protected = []; $keepable = [];
foreach ($F['species'] as $id => $s) { if ($s['p']) $protected[] = $id; else $keepable[] = $id; }
$P1 = in_array('YEOLMOGEO', $protected, true) ? 'YEOLMOGEO' : (isset($protected[0]) ? $protected[0] : 'NONE');   // 열목어
$P2 = in_array('EOREUMCHI', $protected, true) ? 'EOREUMCHI' : (isset($protected[1]) ? $protected[1] : 'NONE');   // 어름치
$K1 = in_array('SANCHEONEO', $keepable, true) ? 'SANCHEONEO' : (isset($keepable[0]) ? $keepable[0] : 'NONE');   // 산천어
$K2 = in_array('BEODEULCHI', $keepable, true) ? 'BEODEULCHI' : (isset($keepable[1]) ? $keepable[1] : 'NONE');   // 버들치
$SPOT = isset($F['spots'][0]) ? $F['spots'][0] : 'FS_V_DECK';
$NB = isset($F['neighbours'][0]) ? $F['neighbours'][0] : 'GAJAE';
$mm = function (string $id) use ($F): int { return (int) min(120, $F['species'][$id]['max']); };

// a day at the river: two 산천어 (one taken along), a 버들치 taken along, a 열목어 and an 어름치 met and released
$good = [
    'v' => 1,
    'book' => [
        $K1 => ['n' => 2, 'kept' => 1, 'rel' => 1, 'max' => $mm($K1), 'first' => $T0 + 1000],
        $K2 => ['n' => 1, 'kept' => 1, 'rel' => 0, 'max' => $mm($K2), 'first' => $T0 + 2000],
        $P1 => ['n' => 1, 'kept' => 0, 'rel' => 1, 'max' => $mm($P1), 'first' => $T0 + 3000],
        $P2 => ['n' => 1, 'kept' => 0, 'rel' => 1, 'max' => $mm($P2), 'first' => $T0 + 4000],
    ],
    'seen' => [$NB => 1],
    'day' => ['key' => 20260610, 'kept' => 2],
    'traps' => [$SPOT => ['at' => $T0 + 5000, 'bait' => 'paste']],
    'tut' => 1,
];
$goodStats = ['fishCaught' => 5, 'fishKept' => 2, 'fishReleased' => 3, 'fishSpecies' => 4, 'fishGuarded' => 2];
$goodBag = ['FISH_' . $K1 => 1, 'FISH_' . $K2 => 1];

// =============================================================================================== 1 · the export
check('game-data.json carries the fish table: 31 species (id → protected, longest length, difficulty), 7 neighbours, 7 spots, baits, the limits', function () use ($gd, $F) {
    $raw = isset($gd['fish']) ? $gd['fish'] : [];
    $ok = count($F['species']) === 31 && count($F['neighbours']) === 7 && count($F['spots']) === 7 && count($F['baits']) >= 4
        && (int) (isset($raw['keepPerDay']) ? $raw['keepPerDay'] : 0) === 6 && $F['keepPerDayMax'] === 20
        && $F['exp']['catchMax'] >= 6 && $F['exp']['first'] > 0 && $F['exp']['release'] > 0 && $F['exp']['firstEdu'] > 0;
    foreach ($F['species'] as $s) if ($s['max'] < 30 || $s['max'] > 1000 || $s['d'] < 1 || $s['d'] > 5) $ok = false;
    return $ok ? true : j(['species' => count($F['species']), 'nb' => count($F['neighbours']), 'spots' => count($F['spots']), 'baits' => count($F['baits']), 'max' => $F['keepPerDayMax'], 'exp' => $F['exp']]);
});
check('15 species are protected (천연기념물 · 멸종위기 · 보호 대상) and 16 may be taken along', function () use ($protected, $keepable) {
    return count($protected) === 15 && count($keepable) === 16 ? true : count($protected) . ' / ' . count($keepable);
});
check('exactly the 16 keepable species are items FISH_<ID> (type fish, no price: a catch moves no wealth); no protected species is an item', function () use ($gd, $protected, $keepable) {
    $items = isset($gd['items']) ? $gd['items'] : [];
    $fish = array_values(array_filter(array_keys($items), function ($k) { return strncmp((string) $k, 'FISH_', 5) === 0; }));
    if (count($fish) !== 16) return 'fish items: ' . count($fish);
    foreach ($keepable as $id) {
        if (!isset($items['FISH_' . $id])) return 'missing FISH_' . $id;
        if ((isset($items['FISH_' . $id]['type']) ? $items['FISH_' . $id]['type'] : '') !== 'fish') return 'type of FISH_' . $id;
        if (Tfm\GameData::itemValue('FISH_' . $id) !== 0) return 'FISH_' . $id . ' has a value';
    }
    foreach ($protected as $id) if (isset($items['FISH_' . $id])) return 'a protected species is an item: ' . $id;
    return true;
});
check('the fishing quests and achievements are exported (their rewards are what the validator pays)', function () use ($gd) {
    $q = isset($gd['quests']) ? $gd['quests'] : []; $a = isset($gd['achievements']) ? $gd['achievements'] : [];
    foreach (['Q_FISH_FIRST', 'Q_FISH_METHODS', 'Q_FISH_GUARD', 'Q_FISH_BOOK'] as $id) if (!isset($q[$id]['reward'])) return 'quest ' . $id;
    $n = 0; foreach ($a as $id => $x) if (strncmp((string) $id, 'ACH_FISH_', 9) === 0) { $n++; if (!isset($x['condition']['stat']) || strncmp((string) $x['condition']['stat'], 'fish', 4) !== 0) return 'achievement ' . $id; }
    return $n >= 3 ? true : 'achievements: ' . $n;
});

// =============================================================================================== 2 · the save validator
check('a save with the fishing block, two fish in the bag and the counters passes', function () use ($judge, $u, $T0, $good, $goodStats, $goodBag) {
    $r = $judge(state($u, $T0 + 60000, $good, $goodStats, $goodBag), state($u, $T0));
    return $r['ok'] ? true : j(codes($r) ?: $r);
});
check('… and its exp / edu is explained by the catches: 5 landed, 4 first meetings, 3 released', function () use ($judge, $u, $T0, $good, $goodStats, $goodBag, $F) {
    $want = 5 * $F['exp']['catchMax'] + 4 * $F['exp']['first'] + 3 * $F['exp']['release'];
    $gain = 4 * $F['exp']['first'] + 5 * 6 + 3 * $F['exp']['release'];      // what the page really grants at least
    $n = state($u, $T0 + 60000, $good, array_merge($goodStats, ['exp' => min($gain, 99), 'edu' => 4 * $F['exp']['firstEdu']]), $goodBag);
    $r = $judge($n, state($u, $T0));
    $x = $r['summary']['explained'];
    return $r['ok'] && $x['exp'] >= $want && $x['edu'] >= 4 * $F['exp']['firstEdu'] ? true : j([codes($r), $x, $want]);
});
check('a fish that may be taken along is no protected fish in the 곳간 either — there the 곳간\'s own rule speaks (a catch is not a stored harvest: STORAGE_BAD_ITEM)', function () use ($judge, $u, $T0, $good, $goodStats, $goodBag, $K1) {
    $r = $judge(state($u, $T0 + 60000, $good, $goodStats, $goodBag, ['FISH_' . $K1 => 1]), state($u, $T0));
    $c = codes($r);
    return !in_array('FISH_PROTECTED', $c, true) && (Tfm\GameData::storable('FISH_' . $K1) ? $r['ok'] : in_array('STORAGE_BAD_ITEM', $c, true)) ? true : j($c);
});
check('an older client without the block passes; an empty block passes', function () use ($judge, $u, $T0) {
    $a = $judge(state($u, $T0 + 60000), state($u, $T0));
    $b = $judge(state($u, $T0 + 60000, ['v' => 1, 'book' => new stdClass(), 'seen' => new stdClass(), 'day' => ['key' => 0, 'kept' => 0], 'traps' => new stdClass(), 'tut' => 0]), state($u, $T0));
    return $a['ok'] && $b['ok'] ? true : j([codes($a), codes($b)]);
});
/** $mut changes a copy of the good block / stats / bag / 곳간; the save must be refused with $code */
$bad = function (string $code, string $name, callable $mut, int $seconds = 60) use ($judge, $u, $T0, $good, $goodStats, $goodBag) {
    check($code . ' — ' . $name, function () use ($judge, $u, $T0, $good, $goodStats, $goodBag, $mut, $code, $seconds) {
        $f = json_decode((string) json_encode($good), true); $st = $goodStats; $bag = $goodBag; $store = [];
        $mut($f, $st, $bag, $store);
        $r = $judge(state($u, $T0 + $seconds * 1000, $f, $st, $bag, $store), state($u, $T0), $seconds);
        return !$r['ok'] && in_array($code, codes($r), true) ? true : j(codes($r) ?: 'accepted');
    });
};
$bad('FISH_BAD_SHAPE', 'an unknown species in the 도감', function (&$f) { $f['book']['PIRANHA'] = ['n' => 1, 'kept' => 0, 'rel' => 1, 'max' => 100]; });
$bad('FISH_BAD_SHAPE', 'a species id that is not an id', function (&$f) { $f['book']['<script>'] = ['n' => 1, 'kept' => 0, 'rel' => 1, 'max' => 100]; });
$bad('FISH_PROTECTED', 'an unknown species as an item in the bag (FISH_PIRANHA)', function (&$f, &$st, &$bag) { $bag['FISH_PIRANHA'] = 1; });
$bad('FISH_PROTECTED', 'a protected species as an item in the bag (열목어)', function (&$f, &$st, &$bag) use ($P1) { $bag['FISH_' . $P1] = 1; });
$bad('FISH_PROTECTED', 'a protected species as an item in the bag (어름치)', function (&$f, &$st, &$bag) use ($P2) { $bag['FISH_' . $P2] = 1; });
$bad('FISH_PROTECTED', 'a protected species lying in the 곳간', function (&$f, &$st, &$bag, &$store) use ($P1) { $store['FISH_' . $P1] = 1; });
$bad('FISH_PROTECTED', 'a protected species marked as taken along in the 도감', function (&$f) use ($P1) { $f['book'][$P1]['kept'] = 1; $f['book'][$P1]['rel'] = 0; });
foreach ($protected as $pid) {
    $bad('FISH_PROTECTED', 'every protected species is refused as an item: ' . $pid, function (&$f, &$st, &$bag) use ($pid) { $bag['FISH_' . $pid] = 1; });
}
$bad('FISH_BAD_SHAPE', 'more taken along and released than met', function (&$f) use ($K1) { $f['book'][$K1]['kept'] = 2; $f['book'][$K1]['rel'] = 1; });
$bad('FISH_BAD_SHAPE', 'a fish in the 도감 that was never met (n = 0)', function (&$f) use ($K2) { $f['book'][$K2] = ['n' => 0, 'kept' => 0, 'rel' => 0, 'max' => 0]; });
$bad('FISH_BAD_SHAPE', 'a fractional count', function (&$f) use ($K1) { $f['book'][$K1]['n'] = 2.5; });
$bad('FISH_BAD_SHAPE', 'a negative count', function (&$f) use ($K1) { $f['book'][$K1]['rel'] = -1; });
$bad('FISH_BAD_SHAPE', 'a fish longer than its species grows', function (&$f) use ($K2, $F) { $f['book'][$K2]['max'] = $F['species'][$K2]['max'] + 1; });
$bad('FISH_BAD_SHAPE', 'an unknown neighbour', function (&$f) { $f['seen']['KRAKEN'] = 1; });
$bad('FISH_BAD_SHAPE', 'an 어항 at an unknown spot', function (&$f) { $f['traps']['FS_X_NOWHERE'] = ['at' => 1790000000000, 'bait' => 'paste']; });
$bad('FISH_BAD_SHAPE', 'an 어항 without the time it was set', function (&$f) use ($SPOT) { $f['traps'][$SPOT] = ['bait' => 'paste']; });
$bad('FISH_BAD_SHAPE', 'more 어항 than there are spots', function (&$f) { for ($i = 0; $i < 9; $i++) $f['traps']['FS_V_T' . $i] = ['at' => 1790000000000]; });
$bad('FISH_BAD_SHAPE', 'a day key that is not a date number', function (&$f) { $f['day']['key'] = 1.5; });
$bad('FISH_KEEP_LIMIT', 'more fish taken along in one day than the hard ceiling (21 > 20)', function (&$f) { $f['day']['kept'] = 21; });
$bad('FISH_KEEP_LIMIT', 'a hoard in the bag (41 fish > two days of the ceiling)', function (&$f, &$st, &$bag) use ($K1, $K2) { $bag['FISH_' . $K1] = 30; $bag['FISH_' . $K2] = 11; });
$bad('FISH_BAD_SHAPE', 'fishSpecies ahead of the 도감', function (&$f, &$st) { $st['fishSpecies'] = 5; });
$bad('FISH_BAD_SHAPE', 'fishGuarded ahead of the protected fish in the 도감', function (&$f, &$st) { $st['fishGuarded'] = 3; });
$bad('FISH_BAD_SHAPE', 'fishCaught ahead of the 도감', function (&$f, &$st) { $st['fishCaught'] = 6; });
$bad('FISH_BAD_SHAPE', 'fishReleased ahead of the 도감', function (&$f, &$st) { $st['fishReleased'] = 4; });
$bad('FISH_COUNT', 'more catches than a minute allows (14 > 3 + one per six seconds)', function (&$f, &$st) use ($K1) { $f['book'][$K1]['n'] = 11; $f['book'][$K1]['rel'] = 10; $st['fishCaught'] = 14; $st['fishReleased'] = 12; });
check('… while the same 14 catches over two minutes pass', function () use ($judge, $u, $T0, $good, $goodStats, $goodBag, $K1) {
    $f = json_decode((string) json_encode($good), true);
    $f['book'][$K1]['n'] = 11; $f['book'][$K1]['rel'] = 10;
    $st = array_merge($goodStats, ['fishCaught' => 14, 'fishReleased' => 12]);
    $r = $judge(state($u, $T0 + 120000, $f, $st, $goodBag), state($u, $T0), 120);
    return $r['ok'] ? true : j(codes($r));
});
check('a full basket as the page allows it (rules.bagMax fish, exported) is an honest save; the page\'s limit is below the server\'s hoard line', function () use ($judge, $u, $T0, $good, $goodStats, $gd, $F, $K1, $K2) {
    $bagMax = isset($gd['fish']['bagMax']) ? (int) $gd['fish']['bagMax'] : 0;
    if ($bagMax < 12 || $bagMax >= 2 * $F['keepPerDayMax']) return 'bagMax ' . $bagMax . ' vs ' . (2 * $F['keepPerDayMax']);
    $r = $judge(state($u, $T0 + 60000, $good, $goodStats, ['FISH_' . $K1 => $bagMax - 5, 'FISH_' . $K2 => 5]), state($u, $T0));
    return $r['ok'] ? true : j(codes($r));
});
foreach (['the block is a string' => 'trout', 'the 도감 is a number' => ['v' => 1, 'book' => 5], 'the 어항 list is a string' => ['v' => 1, 'book' => new stdClass(), 'traps' => 'x']] as $name => $blk) {
    check('malformed (400) — ' . $name, function () use ($judge, $u, $T0, $blk) {
        try { $judge(state($u, $T0 + 60000, $blk), state($u, $T0)); return 'accepted'; }
        catch (Throwable $e) { return $e instanceof Tfm\ApiException && $e->status === 400 ? true : get_class($e) . ' ' . $e->getMessage(); }
    });
}
check('the daily number an operator sets (fishing.keep_per_day) is the page\'s rule; the server\'s own ceiling stays 20 whatever is stored', function () use ($judge, $u, $T0, $good, $goodStats, $goodBag) {
    $f = json_decode((string) json_encode($good), true);
    $f['day']['kept'] = 20;
    $r = $judge(state($u, $T0 + 60000, $f, $goodStats, $goodBag), state($u, $T0));
    return $r['ok'] ? true : j(codes($r));
});

// =============================================================================================== 3 · operator settings
Tfm\Db::pdo();
echo 'driver: ' . Tfm\Db::driverSafe() . "\n";
foreach (['fishing.enabled', 'fishing.keep_per_day', 'fishing.trap_minutes'] as $k) { try { Tfm\Settings::clear($k, null); } catch (Throwable $e) { /* a fresh database */ } }
check('the three settings are registered in ⚙️ 설정 (group 기타), typed, ranged and public', function () {
    $d = Tfm\Settings::defs();
    $want = ['fishing.enabled' => ['bool', true, null], 'fishing.keep_per_day' => ['int', 6, [0, 20]], 'fishing.trap_minutes' => ['int', 10, [1, 240]]];
    foreach ($want as $k => $w) {
        if (!isset($d[$k])) return 'not registered: ' . $k;
        if ($d[$k]['type'] !== $w[0] || $d[$k]['default'] !== $w[1] || $d[$k]['range'] !== $w[2] || $d[$k]['group'] !== 'etc' || $d[$k]['public'] !== true || trim((string) $d[$k]['label']) === '' || trim((string) $d[$k]['hint']) === '') return j([$k => $d[$k]]);
    }
    return true;
});
check('their defaults reach every visitor in `site` (ping, auth/me, auth/login send Entitle::siteOut)', function () {
    $o = Tfm\Entitle::siteOut();
    $s = $o['site'];
    return isset($s['fishing.enabled'], $s['fishing.keep_per_day'], $s['fishing.trap_minutes']) && $s['fishing.enabled'] === true && $s['fishing.keep_per_day'] === 6 && $s['fishing.trap_minutes'] === 10 && preg_match('/^[0-9a-f]{6,40}$/', (string) $o['siteV']) === 1
        ? true : j(array_intersect_key($s, ['fishing.enabled' => 1, 'fishing.keep_per_day' => 1, 'fishing.trap_minutes' => 1]));
});
check('an operator\'s change is stored, comes back typed, reaches `site` and moves the stamp a save answers with', function () {
    $before = Tfm\Settings::publicStamp();
    Tfm\Settings::set('fishing.keep_per_day', '3', null);       // a form field arrives as text
    Tfm\Settings::set('fishing.trap_minutes', 25, null);
    Tfm\Settings::set('fishing.enabled', 'off', null);
    Tfm\Settings::reset();                                      // the next request reads the database
    $s = Tfm\Entitle::siteOut();
    $ok = $s['site']['fishing.keep_per_day'] === 3 && $s['site']['fishing.trap_minutes'] === 25 && $s['site']['fishing.enabled'] === false && $s['siteV'] !== $before
        && Tfm\Settings::get('fishing.keep_per_day') === 3 && Tfm\Settings::get('fishing.enabled') === false;
    return $ok ? true : j([$s['site']['fishing.keep_per_day'], $s['site']['fishing.trap_minutes'], $s['site']['fishing.enabled'], $s['siteV'] !== $before]);
});
check('0 fish a day is allowed (everything goes back); values outside the ranges and other types are refused, nothing is stored', function () {
    Tfm\Settings::set('fishing.keep_per_day', 0, null);
    $refused = [
        apiCode(function () { Tfm\Settings::set('fishing.keep_per_day', 21, null); }),
        apiCode(function () { Tfm\Settings::set('fishing.keep_per_day', -1, null); }),
        apiCode(function () { Tfm\Settings::set('fishing.keep_per_day', '6 OR 1=1', null); }),
        apiCode(function () { Tfm\Settings::set('fishing.trap_minutes', 0, null); }),
        apiCode(function () { Tfm\Settings::set('fishing.trap_minutes', 241, null); }),
        apiCode(function () { Tfm\Settings::set('fishing.trap_minutes', 2.5, null); }),
        apiCode(function () { Tfm\Settings::set('fishing.enabled', 'maybe', null); }),
        apiCode(function () { Tfm\Settings::set('fishing.unknown', 1, null); }),
    ];
    Tfm\Settings::reset();
    foreach ($refused as $c) if ($c !== '400 INVALID_SETTING') return j($refused);
    return Tfm\Settings::get('fishing.keep_per_day') === 0 && Tfm\Settings::get('fishing.trap_minutes') === 25 ? true : j([Tfm\Settings::get('fishing.keep_per_day'), Tfm\Settings::get('fishing.trap_minutes')]);
});
check('a row edited by hand to a value outside its range never reaches the page (the default stands in)', function () {
    Tfm\Db::upsert('settings', ['k' => 'fishing.keep_per_day', 'v' => '999', 'updated_at' => 1, 'updated_by' => null], ['k']);
    Tfm\Db::upsert('settings', ['k' => 'fishing.trap_minutes', 'v' => '"soon"', 'updated_at' => 1, 'updated_by' => null], ['k']);
    Tfm\Settings::reset();
    $s = Tfm\Entitle::site();
    return $s['fishing.keep_per_day'] === 6 && $s['fishing.trap_minutes'] === 10 ? true : j([$s['fishing.keep_per_day'], $s['fishing.trap_minutes']]);
});
check('the admin tab ⚙️ 설정 shows the three rows in 기타 with their words, ranges and the mark "화면에 전달" (AdminSettings::view)', function () {
    foreach (['fishing.keep_per_day', 'fishing.trap_minutes'] as $k) Tfm\Settings::clear($k, null);
    Tfm\Settings::reset();
    $h = Tfm\AdminSettings::view(new Tfm\Ctx(), [], 'tok');
    $a = strpos($h, 'id="set-etc"');
    if ($a === false) return 'no 기타 card';
    $card = substr($h, $a, (strpos($h, '</section>', $a) ?: strlen($h)) - $a);
    foreach (['v[fishing.enabled]', 'v[fishing.keep_per_day]', 'v[fishing.trap_minutes]', '강가 낚시 열기', '하루에 데려갈 수 있는 물고기 수', '어항에 물고기가 드는 데 걸리는 시간', '화면에 전달'] as $needle) {
        if (strpos($card, $needle) === false) return 'missing in the card: ' . $needle;
    }
    return preg_match('/<script|\son[a-z]+=|style=/i', $card) ? 'script / inline style in the card' : true;
});
check('saving the 기타 form as the tab does (AdminSettings::action settings_save): the values are stored and reach `site`; one bad value stores nothing', function () {
    $c = new Tfm\Ctx();
    $r = Tfm\AdminSettings::action('settings_save', $c, ['group' => 'etc', 'v' => ['fishing.keep_per_day' => '2', 'fishing.trap_minutes' => '30', 'fishing.enabled' => '1']]);
    Tfm\Settings::reset();
    $s = Tfm\Entitle::site();
    if (!($s['fishing.keep_per_day'] === 2 && $s['fishing.trap_minutes'] === 30 && $s['fishing.enabled'] === true)) return 'not stored: ' . j([$s['fishing.keep_per_day'], $s['fishing.trap_minutes']]);
    if (strpos((string) $r['msg'], '하루에 데려갈 수 있는 물고기 수') === false) return 'the answer does not name the change: ' . $r['msg'];
    $bad = apiCode(function () use ($c) { Tfm\AdminSettings::action('settings_save', $c, ['group' => 'etc', 'v' => ['fishing.keep_per_day' => '5', 'fishing.trap_minutes' => '9999']]); });
    Tfm\Settings::reset();
    $s = Tfm\Entitle::site();
    if ($bad !== '400 INVALID_SETTING' || $s['fishing.keep_per_day'] !== 2 || $s['fishing.trap_minutes'] !== 30) return 'a bad value: ' . $bad . ' ' . j([$s['fishing.keep_per_day'], $s['fishing.trap_minutes']]);
    $back = Tfm\AdminSettings::action('settings_reset', $c, ['key' => 'fishing.keep_per_day']);
    Tfm\Settings::reset();
    return Tfm\Entitle::site()['fishing.keep_per_day'] === 6 && strpos((string) $back['msg'], '기본값') !== false ? true : 'reset: ' . $back['msg'];
});
check('기본값으로: clearing the rows gives the defaults back', function () {
    foreach (['fishing.enabled', 'fishing.keep_per_day', 'fishing.trap_minutes'] as $k) Tfm\Settings::clear($k, null);
    Tfm\Settings::reset();
    $s = Tfm\Entitle::site();
    return $s['fishing.enabled'] === true && $s['fishing.keep_per_day'] === 6 && $s['fishing.trap_minutes'] === 10 ? true : j($s);
});

echo "\n$passed passed, $failed failed\n";
exit($failed ? 1 : 0);
