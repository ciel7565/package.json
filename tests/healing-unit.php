<?php
/**
 * tests/healing-unit.php — the [healing] block of Tfm\SaveValidator and the 🌿 힐링관 settings (CONTRACT §19.6).
 * The `healing` part of a save is judged against the room table that tools/build.mjs exports into game-data.json: a
 * clean visit passes; an unknown room, numbers or counts out of range, a time in the future, an id or a look that is
 * not plain are HEAL_BAD_SHAPE; a NEW course shorter than the operator's healing.time_scale allows (or stamped before
 * its end) is HEAL_TOO_FAST; a course that is already in the server's copy is never judged again (lowering the scale
 * cannot break an old visit); a wrong container is malformed (400). The settings are registered (group 🌿 힐링관, the
 * public subset) and typed. Nothing about the letter or the portrait is accepted in the save.
 *
 *   php tests/healing-unit.php                         (SQLite; builds a fresh game-data.json — needs node)
 *   TFM_DB_DRIVER=mysql TFM_DB_HOST=127.0.0.1 TFM_DB_PORT=33106 TFM_DB_USER=root TFM_DB_NAME=tfm_p11hp_unit php tests/healing-unit.php
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
$root = sys_get_temp_dir() . '/tfm-healing-' . bin2hex(random_bytes(6));
$srv = $root . '/srv';
$tmp = $root . '/data';
mkdir($tmp, 0700, true);
copyTree(__DIR__ . '/../server', $srv);
$repo = realpath(__DIR__ . '/..');
$cmd = 'node ' . escapeshellarg($repo . '/tools/build.mjs') . ' --no-font --no-assets --quiet --out ' . escapeshellarg($root . '/x.html') . ' --data-out ' . escapeshellarg($srv . '/data/game-data.json') . ' 2>&1';
exec($cmd, $buildOut, $rc);
if ($rc !== 0 || !is_file($srv . '/data/game-data.json')) { fwrite(STDERR, "✖ build failed:\n" . implode("\n", $buildOut) . "\n"); exit(2); }
putenv("TFM_DATA_DIR=$tmp");
putenv("TFM_UPLOAD_DIR=$tmp/uploads");
putenv('TFM_TOSS_MOCK=1');
require $srv . '/lib/bootstrap.php';
Tfm\Db::migrate();

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
const MIN = 60000;
$T0 = 1790000000000;
$u = ['id' => 7, 'nickname' => '쉼손님', 'email' => 'rest@example.test', 'role' => 'user'];
function state(array $u, int $t, $healing = null): stdClass
{
    $s = [
        'version' => 1, 'createdAt' => 1790000000000, 'savedAt' => $t,
        'profile' => ['id' => (string) $u['id'], 'nickname' => $u['nickname'], 'email' => $u['email'], 'role' => $u['role'], 'avatar' => null, 'title' => '', 'titles' => []],
        'stats' => ['level' => 1, 'exp' => 0, 'coin' => 3000, 'edu' => 0, 'logins' => 1, 'playTime' => 0, 'distance' => 0, 'harvests' => 0, 'crafts' => 0, 'fermentsClaimed' => 0, 'rtHarvests' => 0],
        'player' => ['x' => 0, 'y' => 0, 'z' => 9, 'zoneId' => 'ZONE_MAIN'],
        'inventory' => ['ITEM_MEJU' => 1], 'quests' => new stdClass(), 'farm' => ['plots' => new stdClass()], 'jars' => new stdClass(),
        'education' => ['viewed' => new stdClass(), 'completed' => new stdClass(), 'quiz' => new stdClass()],
        'journal' => [], 'photos' => [], 'achievements' => new stdClass(), 'collection' => new stdClass(), 'visited' => ['ZONE_MAIN' => $t],
        'flags' => new stdClass(), 'activity' => [],
        'rtfarm' => ['beds' => new stdClass(), 'last' => [], 'reports' => []],
        'storage' => ['items' => new stdClass(), 'cap' => 300],
    ];
    if ($healing !== null) $s['healing'] = $healing;
    return json_decode((string) json_encode($s), false);
}
function codes(array $res): array { return array_values(array_unique(array_map(function ($v) { return $v['code']; }, $res['violations']))); }
/** n: the new save at $at; p: the server's copy at $at - 60 s */
$judge = function (stdClass $n, stdClass $p, int $at) use ($u) { return Tfm\SaveValidator::validate(cl($n), cl($p), ['v' => 1, 'tier' => 1], $u, $at - 60000, $at, 1, null); };
$at0 = $T0;
$visit = function (array $rooms = [], array $extra = []) use ($at0) {
    return array_merge([
        'id' => 'H' . base_convert((string) $at0, 10, 36), 'at' => $at0, 'band' => $at0 + MIN, 'stow' => 3, 'changed' => $at0 + 2 * MIN,
        'ask' => ['mood' => 1, 'ache' => 2, 'sleep' => 1, 'wish' => 0], 'base' => ['stress' => 40, 'fatigue' => 62, 'vital' => 56, 'calm' => 48, 'warm' => 44, 'stamina' => 52],
        'rooms' => $rooms ?: new stdClass(), 'r9' => ['plates' => 0, 'drums' => 0, 'cans' => 0, 'bottles' => 0], 'rep' => 0, 'out' => 0,
    ], $extra);
};
$block = function ($v, array $extra = []) { return array_merge(['v' => 1, 'visit' => $v, 'visits' => 0, 'stamps' => 0], $extra); };
$gd = Tfm\GameData::all();
$setScale = function (int $k) { Tfm\Settings::set('healing.time_scale', $k, null); Tfm\Settings::reset(); };

check('game-data.json carries the healing table (ten rooms with their minutes, bundle, nums, limits)', function () use ($gd) {
    $h = isset($gd['healing']) ? $gd['healing'] : [];
    return isset($h['rooms']['R1'], $h['rooms']['R10']) && count($h['rooms']) === 10 && (int) $h['rooms']['R2'] === 60 && (int) $h['rooms']['R1'] === 10 && (int) $h['bundle'] === 3 && (int) $h['scaleMax'] === 120 ? true : j($h);
});
check('the settings are registered in the group 🌿 힐링관 with their public subset', function () {
    $rows = Tfm\Settings::rows('healing');
    $want = ['healing.enabled', 'healing.time_scale', 'healing.overlap', 'healing.room10', 'healing.rooms'];
    foreach ($want as $k) if (!isset($rows[$k]) || $rows[$k]['public'] !== true) return 'missing or not public: ' . $k;
    return isset(Tfm\Settings::GROUPS['healing']) && Tfm\Settings::get('healing.time_scale') === 1 && Tfm\Settings::get('healing.room10') === 'gate' ? true : j([Tfm\Settings::get('healing.time_scale'), Tfm\Settings::get('healing.room10')]);
});
check('a time scale outside 1 … 120 is refused by the registry', function () {
    try { Tfm\Settings::set('healing.time_scale', 500, null); return 'accepted 500'; } catch (Throwable $e) { /* refused */ }
    try { Tfm\Settings::set('healing.room10', 'scary', null); return 'accepted a bad enum'; } catch (Throwable $e) { /* refused */ }
    Tfm\Settings::reset();
    return Tfm\Settings::get('healing.time_scale') === 1 ? true : 'changed';
});
check('an older client without the block passes', function () use ($judge, $u, $at0) {
    $r = $judge(state($u, $at0 + 90 * MIN), state($u, $at0 + 89 * MIN), $at0 + 90 * MIN);
    return $r['ok'] ? true : j(codes($r));
});
check('a clean visit with a running and a finished course passes (scale 1)', function () use ($judge, $u, $at0, $visit, $block) {
    $t = $at0 + 80 * MIN;
    $rooms = ['R1' => ['at' => $at0 + 5 * MIN, 'end' => $at0 + 15 * MIN, 'done' => $at0 + 15 * MIN, 'step' => 4], 'R2' => ['at' => $at0 + 16 * MIN, 'end' => $at0 + 76 * MIN, 'done' => $at0 + 76 * MIN, 'small' => 3], 'R3' => ['at' => $at0 + 77 * MIN, 'end' => $at0 + 107 * MIN, 'done' => 0]];
    $v = $visit($rooms, ['r1' => ['balance' => 61, 'breath' => 58, 'posture' => 63, 'microbes' => 40, 'salt' => 50, 'pat' => 'ATGC'], 'r10' => 'gentle', 'wear' => ['top' => 'hanbok', 'topColor' => '#f1ece1', 'height' => 1]]);
    $r = $judge(state($u, $t, $block($v, ['visits' => 2, 'stamps' => 14])), state($u, $t - MIN), $t);
    return $r['ok'] ? true : j(codes($r) ?: $r);
});
$expect = function (string $name, string $code, callable $mut, int $tOff = 0) use ($judge, $u, $at0, $visit, $block) {
    check($code . ' — ' . $name, function () use ($judge, $u, $at0, $visit, $block, $mut, $code, $tOff) {
        $t = $at0 + 100 * MIN + $tOff;
        $v = $visit(['R5' => ['at' => $at0 + 10 * MIN, 'end' => $at0 + 70 * MIN, 'done' => $at0 + 70 * MIN]]);
        $b = $block($v);
        $mut($b);
        $r = $judge(state($u, $t, $b), state($u, $t - MIN), $t);
        return !$r['ok'] && in_array($code, codes($r), true) ? true : j(codes($r) ?: 'passed');
    });
};
$expect('an unknown room', 'HEAL_BAD_SHAPE', function (&$b) { $b['visit']['rooms']['R11'] = ['at' => 1, 'end' => 2, 'done' => 0]; });
$expect('a number above 100', 'HEAL_BAD_SHAPE', function (&$b) { $b['visit']['base']['stress'] = 140; });
$expect('an unknown number', 'HEAL_BAD_SHAPE', function (&$b) { $b['visit']['base']['luck'] = 50; });
$expect('a counselling answer out of range', 'HEAL_BAD_SHAPE', function (&$b) { $b['visit']['ask']['mood'] = 9; });
$expect('a bundle bigger than the shelf', 'HEAL_BAD_SHAPE', function (&$b) { $b['visit']['stow'] = 7; });
$expect('a check-in in the future', 'HEAL_BAD_SHAPE', function (&$b) use ($at0) { $b['visit']['band'] = $at0 + 400 * MIN; });
$expect('an id that is not plain', 'HEAL_BAD_SHAPE', function (&$b) { $b['visit']['id'] = '<b>x</b>'; });
$expect('a look with markup', 'HEAL_BAD_SHAPE', function (&$b) { $b['visit']['wear'] = ['top' => '<script>']; });
$expect('room 10 in an unknown version', 'HEAL_BAD_SHAPE', function (&$b) { $b['visit']['r10'] = 'scary'; });
$expect('a negative room-9 count', 'HEAL_BAD_SHAPE', function (&$b) { $b['visit']['r9']['plates'] = -3; });
$expect('too many small things', 'HEAL_BAD_SHAPE', function (&$b) { $b['visit']['rooms']['R5']['small'] = 9999; });
$expect('a new 60-minute course of 20 minutes (scale 1)', 'HEAL_TOO_FAST', function (&$b) use ($at0) { $b['visit']['rooms']['R7'] = ['at' => $at0 + 75 * MIN, 'end' => $at0 + 95 * MIN, 'done' => $at0 + 95 * MIN]; });
$expect('a stamp before the end', 'HEAL_TOO_FAST', function (&$b) use ($at0) { $b['visit']['rooms']['R6'] = ['at' => $at0 + 60 * MIN, 'end' => $at0 + 90 * MIN, 'done' => $at0 + 70 * MIN]; });
$expect('a thousand hits in a minute', 'HEAL_TOO_FAST', function (&$b) { $b['visit']['r9']['plates'] = 1000; });
check('malformed containers are refused (400)', function () use ($judge, $u, $at0) {
    foreach ([['healing' => 'x'], ['healing' => ['visit' => 5]], ['healing' => ['visit' => ['at' => $at0, 'rooms' => 'x']]]] as $i => $bad) {
        $n = state($u, $at0 + MIN); foreach ($bad as $k => $v) $n->$k = json_decode((string) json_encode($v), false);
        try { $judge($n, state($u, $at0), $at0 + MIN); return 'accepted #' . $i; } catch (Throwable $e) { /* refused */ }
    }
    return true;
});
check('scale 60: a 60-minute course of one real minute passes; of 30 seconds it does not', function () use ($judge, $u, $at0, $visit, $block, $setScale) {
    $setScale(60);
    $t = $at0 + 30 * MIN;
    $ok = $judge(state($u, $t, $block($visit(['R2' => ['at' => $t - 2 * MIN, 'end' => $t - MIN, 'done' => $t - MIN]]))), state($u, $t - MIN), $t);
    $bad = $judge(state($u, $t, $block($visit(['R2' => ['at' => $t - 2 * MIN, 'end' => $t - 2 * MIN + 30000, 'done' => $t - 2 * MIN + 30000]]))), state($u, $t - MIN), $t);
    $setScale(1);
    return $ok['ok'] && !$bad['ok'] && in_array('HEAL_TOO_FAST', codes($bad), true) ? true : j([codes($ok), codes($bad)]);
});
check('a course already in the server\'s copy is not judged again (the operator lowered the scale)', function () use ($judge, $u, $at0, $visit, $block) {
    $t = $at0 + 30 * MIN;
    $old = ['R2' => ['at' => $t - 3 * MIN, 'end' => $t - 2 * MIN, 'done' => $t - 2 * MIN]];   // made at scale 60, now the scale is 1
    $p = state($u, $t - MIN, $block($visit($old)));
    $n = state($u, $t, $block($visit($old)));
    $r = $judge($n, $p, $t);
    return $r['ok'] ? true : j(codes($r));
});
check('the letter, the portrait and typed words are not part of the healing block (unknown keys carry no value and are never read)', function () {
    $src = (string) file_get_contents(__DIR__ . '/../server/lib/SaveValidator.php');
    $a = strpos($src, 'private function healing('); $b = strpos($src, '[fishing] 낚시', $a);
    $body = substr($src, $a, $b - $a);
    return $a !== false && strpos($body, 'portrait') === false && strpos($body, 'letter') === false ? true : 'the validator reads a letter / portrait field';
});
check('the healing block moves no value (the hall pays nothing)', function () use ($judge, $u, $at0, $visit, $block) {
    $t = $at0 + 80 * MIN;
    $r = $judge(state($u, $t, $block($visit(['R1' => ['at' => $at0, 'end' => $at0 + 10 * MIN, 'done' => $at0 + 10 * MIN]]), ['visits' => 5, 'stamps' => 50])), state($u, $t - MIN), $t);
    return $r['ok'] ? true : j(codes($r));
});

echo "\nhealing-unit: $passed passed, $failed failed (" . (getenv('TFM_DB_DRIVER') ?: 'sqlite') . ")\n";
exit($failed ? 1 : 0);
