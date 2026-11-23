<?php
/**
 * tests/cooking-unit.php — the [cooking] block of Tfm\SaveValidator (CONTRACT §18.4): the `cooking` part of a save is
 * judged against the dishes / staples / limits that tools/build.mjs exports into game-data.json. A clean block passes;
 * an unknown dish or staple, stars or counts out of range, oversized lists, a counter (dishKinds, dishesCooked,
 * dishStars3) running ahead of the book are COOK_BAD_SHAPE; a wrong container is malformed (400). Cooking alone moves no
 * value: the 찬장 staples have none.
 *
 *   php tests/cooking-unit.php            (builds a fresh game-data.json for a private copy of server/ — needs node)
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
$root = sys_get_temp_dir() . '/tfm-cooking-' . bin2hex(random_bytes(6));
$srv = $root . '/srv';
$tmp = $root . '/data';
mkdir($tmp, 0700, true);
copyTree(__DIR__ . '/../server', $srv);
// the export of this tree (the tracked game-data.json belongs to the release step and may predate the kitchen)
$repo = realpath(__DIR__ . '/..');
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
$T0 = 1790000000000;
$u = ['id' => 7, 'nickname' => '부엌손님', 'email' => 'cook@example.test', 'role' => 'user'];
function state(array $u, int $t, $cooking = null, array $stats = []): stdClass
{
    $s = [
        'version' => 1, 'createdAt' => $t, 'savedAt' => $t,
        'profile' => ['id' => (string) $u['id'], 'nickname' => $u['nickname'], 'email' => $u['email'], 'role' => $u['role'], 'avatar' => null, 'title' => '', 'titles' => []],
        'stats' => array_merge(['level' => 1, 'exp' => 0, 'coin' => 3000, 'edu' => 0, 'logins' => 1, 'playTime' => 0, 'distance' => 0, 'harvests' => 0, 'crafts' => 0, 'fermentsClaimed' => 0, 'rtHarvests' => 0], $stats),
        'player' => ['x' => 0, 'y' => 0, 'z' => 9, 'zoneId' => 'ZONE_MAIN'],
        'inventory' => ['ITEM_MEJU' => 1], 'quests' => new stdClass(), 'farm' => ['plots' => new stdClass()], 'jars' => new stdClass(),
        'education' => ['viewed' => new stdClass(), 'completed' => new stdClass(), 'quiz' => new stdClass()],
        'journal' => [], 'photos' => [], 'achievements' => new stdClass(), 'collection' => new stdClass(), 'visited' => ['ZONE_MAIN' => $t],
        'flags' => new stdClass(), 'activity' => [],
        'rtfarm' => ['beds' => new stdClass(), 'last' => [], 'reports' => []],
        'storage' => ['items' => new stdClass(), 'cap' => 300],
    ];
    if ($cooking !== null) $s['cooking'] = $cooking;
    return json_decode((string) json_encode($s), false);
}
function codes(array $res): array { return array_values(array_unique(array_map(function ($v) { return $v['code']; }, $res['violations']))); }
$judge = function (stdClass $n, stdClass $p) use ($u, $T0) { return Tfm\SaveValidator::validate(cl($n), cl($p), ['v' => 1, 'tier' => 1], $u, $T0, $T0 + 60000, 1, null); };
$good = [
    'v' => 1,
    'book' => ['DISH_SOGEUMGUI' => ['n' => 2, 'best' => 3, 'first' => $T0, 'last' => $T0 + 50000], 'DISH_GONDEUREBAP' => ['n' => 1, 'best' => 2, 'first' => $T0, 'last' => $T0]],
    'pantry' => ['day' => '2026-11-23', 'got' => ['ITEM_POTATO' => 3, 'ITEM_MEMIL' => 1]],
    'catches' => ['FISH_SANCHEONEO' => [$T0 - 60000, $T0 - 30000]],
    'table' => [['d' => 'DISH_SOGEUMGUI', 's' => 3, 't' => $T0 + 50000]],
    'shared' => 1,
];
$goodStats = ['dishesCooked' => 3, 'dishKinds' => 2, 'dishesShared' => 1, 'dishStars3' => 2];
$gd = Tfm\GameData::all();

check('game-data.json carries the cooking table (dishes, kinds, staples, limits)', function () use ($gd) {
    $c = isset($gd['cooking']) ? $gd['cooking'] : [];
    return !empty($c['dishes']) && count($c['dishes']) >= 24 && in_array('DISH_GONDEUREBAP', $c['dishes'], true) && in_array('ITEM_POTATO', $c['pantry'], true) && (int) $c['limits']['tableMax'] === 6 ? true : j(array_keys($c));
});
check('the 찬장 staples are items with no value (taking them moves no wealth)', function () use ($gd) {
    foreach ($gd['cooking']['pantry'] as $id) if (Tfm\GameData::itemValue($id) !== 0 || !isset($gd['items'][$id])) return $id;
    return true;
});
check('the cooking quests and achievements are exported with their rewards', function () use ($gd) {
    return isset($gd['quests']['Q_COOK_FIRST']['reward']['coin'], $gd['achievements']['ACH_COOK_1']['condition']['stat']) && $gd['achievements']['ACH_COOK_1']['condition']['stat'] === 'dishesCooked' ? true : 'missing';
});
check('a clean cooking block passes', function () use ($judge, $u, $T0, $good, $goodStats) {
    $p = state($u, $T0);
    $n = state($u, $T0 + 60000, $good, $goodStats);
    $r = $judge($n, $p);
    return $r['ok'] ? true : j(codes($r) ?: $r);
});
check('an older client without the block passes', function () use ($judge, $u, $T0) {
    $r = $judge(state($u, $T0 + 60000), state($u, $T0));
    return $r['ok'] ? true : j(codes($r));
});
$bad = function (string $name, callable $mut, array $stats = null) use ($judge, $u, $T0, $good, $goodStats) {
    check('COOK_BAD_SHAPE — ' . $name, function () use ($judge, $u, $T0, $good, $goodStats, $mut, $stats) {
        $c = json_decode((string) json_encode($good), true);
        $mut($c);
        $n = state($u, $T0 + 60000, $c, $stats === null ? $goodStats : $stats);
        $r = $judge($n, state($u, $T0));
        return !$r['ok'] && in_array('COOK_BAD_SHAPE', codes($r), true) ? true : j(codes($r));
    });
};
$bad('an unknown dish in the book', function (&$c) { $c['book']['DISH_PIZZA'] = ['n' => 1, 'best' => 1]; });
$bad('stars above three', function (&$c) { $c['book']['DISH_SOGEUMGUI']['best'] = 4; });
$bad('a fractional count', function (&$c) { $c['book']['DISH_SOGEUMGUI']['n'] = 1.5; });
$bad('an unknown dish on the 소반', function (&$c) { $c['table'][] = ['d' => 'DISH_X', 's' => 2, 't' => 1]; });
$bad('more than six dishes on the 소반', function (&$c) { for ($i = 0; $i < 7; $i++) $c['table'][] = ['d' => 'DISH_GAMJA', 's' => 1, 't' => $i]; });
$bad('a staple that is not in the 찬장', function (&$c) { $c['pantry']['got']['ITEM_DOENJANG'] = 1; });
$bad('more staples a day than the 찬장 gives', function (&$c) { $c['pantry']['got']['ITEM_POTATO'] = 9; });
$bad('a catch key that is not a fish item', function (&$c) { $c['catches']['ITEM_SALT'] = [1]; });
$bad('more than ten stamps for one fish', function (&$c) { $c['catches']['FISH_SANCHEONEO'] = array_fill(0, 11, 1); });
$bad('dishKinds ahead of the book', function (&$c) {}, ['dishesCooked' => 3, 'dishKinds' => 5, 'dishesShared' => 1, 'dishStars3' => 0]);
$bad('dishesCooked far ahead of the book', function (&$c) {}, ['dishesCooked' => 40, 'dishKinds' => 2, 'dishesShared' => 0, 'dishStars3' => 0]);
$bad('dishStars3 ahead of the dishes cooked', function (&$c) {}, ['dishesCooked' => 3, 'dishKinds' => 2, 'dishesShared' => 0, 'dishStars3' => 9]);
check('a cooking block that is not an object is malformed (400)', function () use ($judge, $u, $T0) {
    try { $judge(state($u, $T0 + 60000, 'soup'), state($u, $T0)); return 'accepted'; }
    catch (Throwable $e) { return $e instanceof Tfm\ApiException ? true : get_class($e); }
});
check('a table that is not a list is malformed (400)', function () use ($judge, $u, $T0, $good, $goodStats) {
    $c = json_decode((string) json_encode($good), true); $c['table'] = 'x';
    try { $judge(state($u, $T0 + 60000, $c, $goodStats), state($u, $T0)); return 'accepted'; }
    catch (Throwable $e) { return $e instanceof Tfm\ApiException ? true : get_class($e); }
});
check('the staples in the bag explain nothing and cost nothing (no UNEXPLAINED_VALUE from 3 × 9 staples)', function () use ($judge, $u, $T0, $good, $goodStats, $gd) {
    $n = state($u, $T0 + 60000, $good, $goodStats);
    foreach ($gd['cooking']['pantry'] as $id) $n->inventory->$id = 3;
    $r = $judge($n, state($u, $T0));
    return $r['ok'] ? true : j(codes($r));
});

echo "\n$passed passed, $failed failed\n";
exit($failed ? 1 : 0);
