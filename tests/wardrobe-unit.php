<?php
/**
 * tests/wardrobe-unit.php — the server side of the 옷장 (CONTRACT §19.1, lane wardrobe):
 *   · the wardrobe table that tools/build.mjs exports into game-data.json (one item WEAR_<KEY>_<ID> of type wear per
 *     value of a slot key, the free starter kit, the words / homes / faces of 기본 정보, the limits);
 *   · the [wardrobe] block of Tfm\SaveValidator: a missing block is fine; a clean block passes; buying (coins → a
 *     piece) and selling back (a piece → half its price) pass; pieces that appear without coins beyond the allowance are
 *     unexplained value; a look that wears a piece the save does not own is a violation (not the free kit, not for an
 *     administrator); unknown pieces, too many outfits, a name with markup, unknown words / homes / faces are
 *     violations; a wrong container is malformed (400); the migration of an existing look and a new profile's chosen
 *     look are explained;
 *   · a save with the block goes through the database of the configured driver and comes back unchanged (Hangul names).
 *
 *   php tests/wardrobe-unit.php            (builds a fresh game-data.json for a private copy of server/ — needs node)
 *   TFM_DB_DRIVER=mysql TFM_DB_HOST=127.0.0.1 TFM_DB_PORT=33106 TFM_DB_USER=root TFM_DB_NAME=<a database of yours> php tests/wardrobe-unit.php
 *   TFM_WARDROBE_REPO=<dir>  build the export from another checkout (a snapshot) instead of this one
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
$repo = (string) getenv('TFM_WARDROBE_REPO');
$repo = $repo !== '' && is_dir($repo . '/server') ? (string) realpath($repo) : (string) realpath(__DIR__ . '/..');
$root = sys_get_temp_dir() . '/tfm-wardrobe-' . bin2hex(random_bytes(6));
$srv = $root . '/srv';
$tmp = $root . '/data';
mkdir($tmp, 0700, true);
copyTree($repo . '/server', $srv);
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
function codes(array $res): array { return array_values(array_unique(array_map(function ($v) { return $v['code']; }, $res['violations']))); }

$gd = Tfm\GameData::all();
$W = isset($gd['wardrobe']) ? $gd['wardrobe'] : [];
$items = isset($W['items']) ? $W['items'] : [];
$starter = isset($W['starter']) ? $W['starter'] : [];
$slots = isset($W['slots']) ? $W['slots'] : [];
$T0 = 1790000000000;
$u = ['id' => 9, 'nickname' => '옷장손님', 'email' => 'wardrobe@example.test', 'role' => 'user'];
$admin = ['id' => 9, 'nickname' => '옷장손님', 'email' => 'wardrobe@example.test', 'role' => 'admin'];

// pieces by slot (non-starter, cheapest first) and the free kit
$bySlot = [];
foreach ($items as $iid => $row) if (!in_array($iid, $starter, true)) $bySlot[$row[0]][] = $iid;
foreach ($bySlot as $k => $list) usort($bySlot[$k], function ($a, $b) { return Tfm\GameData::itemValue($a) - Tfm\GameData::itemValue($b); });
$val = function (string $iid) use ($items): string { return $items[$iid][1]; };
$key = function (string $iid) use ($items): string { return $items[$iid][0]; };
$freeOf = function (string $slot) use ($starter, $items) { foreach ($starter as $iid) if ($items[$iid][0] === $slot) return $items[$iid][1]; return null; };
// a plain look: the free kit where a slot cannot be empty, nothing elsewhere
$plain = ['style' => 'real'];
foreach ($slots as $s) $plain[$s['key']] = $s['empty'] !== null ? $s['empty'] : $freeOf($s['key']);
$hat = isset($bySlot['hat'][0]) ? $bySlot['hat'][0] : array_keys($items)[0];
$dear = []; // the dearest piece of each slot
foreach ($bySlot as $k => $list) $dear[] = end($list);

function state(array $u, int $t, array $avatar, $wardrobe, int $coin = 3000): stdClass
{
    $s = [
        'version' => 1, 'createdAt' => 1790000000000, 'savedAt' => $t, // one profile (a later createdAt reads as a progress reset)
        'profile' => ['id' => (string) $u['id'], 'nickname' => $u['nickname'], 'email' => $u['email'], 'role' => $u['role'], 'avatar' => $avatar, 'title' => '', 'titles' => []],
        'stats' => ['level' => 1, 'exp' => 0, 'coin' => $coin, 'edu' => 0, 'logins' => 1, 'playTime' => 0, 'distance' => 0, 'harvests' => 0, 'crafts' => 0, 'fermentsClaimed' => 0, 'rtHarvests' => 0],
        'player' => ['x' => 0, 'y' => 0, 'z' => 9, 'zoneId' => 'ZONE_MAIN'],
        'inventory' => ['ITEM_MEJU' => 1], 'quests' => new stdClass(), 'farm' => ['plots' => new stdClass()], 'jars' => new stdClass(),
        'education' => ['viewed' => new stdClass(), 'completed' => new stdClass(), 'quiz' => new stdClass()],
        'journal' => [], 'photos' => [], 'achievements' => new stdClass(), 'collection' => new stdClass(), 'visited' => ['ZONE_MAIN' => $t],
        'flags' => new stdClass(), 'activity' => [],
        'rtfarm' => ['beds' => new stdClass(), 'last' => [], 'reports' => []],
        'storage' => ['items' => new stdClass(), 'cap' => 300],
    ];
    if ($wardrobe !== null) $s['wardrobe'] = $wardrobe;
    return json_decode((string) json_encode($s), false);
}
function wd(array $own = [], array $more = []): array
{
    $o = [];
    foreach ($own as $iid) $o[$iid] = 1;
    return array_merge(['v' => 1, 'own' => $o ? $o : new stdClass(), 'migrated' => true, 'sets' => [], 'sheet' => ['traits' => [], 'home' => null], 'expr' => null], $more);
}
$judge = function (stdClass $n, ?stdClass $p, array $user, int $seconds = 60) use ($T0) { return Tfm\SaveValidator::validate(cl($n), $p ? cl($p) : null, ['v' => 1, 'tier' => 1], $user, $T0, $T0 + $seconds * 1000, 1, null); };
$with = function (array $look, array $over) { return array_merge($look, $over); };

// =============================================================================================== 1 · the export
check('game-data.json carries the wardrobe table: every WEAR item of the items has [slot, value, sell], slots, the starter kit', function () use ($gd, $W, $items, $slots, $starter) {
    $wear = array_filter($gd['items'], function ($i) { return isset($i['type']) && $i['type'] === 'wear'; });
    if (count($items) < 30 || count($wear) !== count($items)) return 'items ' . count($items) . ' / wear ' . count($wear);
    foreach ($items as $iid => $row) {
        if (!isset($wear[$iid]) || (int) $wear[$iid]['sell'] !== (int) $row[2]) return 'sell of ' . $iid;
        if (!preg_match('/^WEAR_[A-Z0-9_]+$/', $iid)) return 'id ' . $iid;
    }
    if (count($slots) < 6 || !$starter) return 'slots / starter';
    foreach ($starter as $iid) if (Tfm\GameData::itemValue($iid) !== 0) return 'starter has a value: ' . $iid;
    return count($W['traits']) >= 20 && count($W['homes']) >= 6 && count($W['expressions']) >= 9 && (int) $W['limits']['sets'] === 12 ? true : 'lists';
});
check('the first quest carries a gift piece (it is part of the reward the validator pays)', function () use ($gd) {
    $r = isset($gd['quests']['QUEST001']['reward']['items']) ? $gd['quests']['QUEST001']['reward']['items'] : [];
    foreach ($r as $iid => $q) if (strncmp((string) $iid, 'WEAR_', 5) === 0) return true;
    return j($r);
});

// =============================================================================================== 2 · the save validator
check('a save without the wardrobe block passes (an older client)', function () use ($judge, $u, $T0, $plain) {
    $r = $judge(state($u, $T0 + 60000, $plain, null), state($u, $T0, $plain, null), $u);
    return $r['ok'] ? true : j(codes($r));
});
check('a clean block passes (an owned piece worn, an outfit, three words, a home, a face)', function () use ($judge, $u, $T0, $plain, $hat, $val, $key, $W, $with) {
    $look = $with($plain, [$key($hat) => $val($hat)]);
    $b = wd([$hat], ['sets' => [['id' => 's1', 'name' => '나들이 옷', 'app' => [$key($hat) => $val($hat), 'topColor' => '#ffd766']]], 'sheet' => ['traits' => array_slice($W['traits'], 0, 3), 'home' => $W['homes'][0]], 'expr' => $W['expressions'][1]]);
    $r = $judge(state($u, $T0 + 60000, $look, $b), state($u, $T0, $look, $b), $u);
    return $r['ok'] ? true : j($r['violations']);
});
check('buying: coins go down by the price, the piece appears — passes', function () use ($judge, $u, $T0, $plain, $dear) {
    $piece = $dear[0]; $price = Tfm\GameData::itemValue($piece);
    $r = $judge(state($u, $T0 + 60000, $plain, wd([$piece]), 30000 - $price), state($u, $T0, $plain, wd([]), 30000), $u);
    return $r['ok'] ? true : j($r['violations']);
});
check('selling back: the piece goes, coins rise by half the price — passes', function () use ($judge, $u, $T0, $plain, $dear, $items) {
    $piece = $dear[0];
    $r = $judge(state($u, $T0 + 60000, $plain, wd([]), 3000 + (int) $items[$piece][2]), state($u, $T0, $plain, wd([$piece]), 3000), $u);
    return $r['ok'] ? true : j($r['violations']);
});
check('pieces that appear without coins beyond the allowance are unexplained value', function () use ($judge, $u, $T0, $plain, $dear) {
    $sum = 0; foreach ($dear as $x) $sum += Tfm\GameData::itemValue($x);
    $r = $judge(state($u, $T0 + 60000, $plain, wd($dear)), state($u, $T0, $plain, wd([])), $u);
    return in_array('UNEXPLAINED_VALUE', codes($r), true) ? true : 'worth ' . $sum . ' · ' . j(codes($r));
});
check('a look that wears a piece the save does not own is a violation', function () use ($judge, $u, $T0, $plain, $hat, $val, $key, $with) {
    $look = $with($plain, [$key($hat) => $val($hat)]);
    $r = $judge(state($u, $T0 + 60000, $look, wd([])), state($u, $T0, $plain, wd([])), $u);
    return in_array('WARDROBE_NOT_OWNED', codes($r), true) ? true : j(codes($r));
});
check('… an administrator owns every piece (wears it without owning)', function () use ($judge, $admin, $T0, $plain, $hat, $val, $key, $with) {
    $look = $with($plain, [$key($hat) => $val($hat)]);
    $r = $judge(state($admin, $T0 + 60000, $look, wd([])), state($admin, $T0, $plain, wd([])), $admin);
    return $r['ok'] ? true : j($r['violations']);
});
check('… the free kit is worn without owning it', function () use ($judge, $u, $T0, $plain, $starter, $items, $with) {
    $look = $plain;
    foreach ($starter as $iid) $look[$items[$iid][0]] = $items[$iid][1];
    $r = $judge(state($u, $T0 + 60000, $look, wd([])), state($u, $T0, $plain, wd([])), $u);
    return $r['ok'] ? true : j($r['violations']);
});
check('a value the table does not know (a legacy id) is left to the look whitelist', function () use ($judge, $u, $T0, $plain) {
    $look = array_merge($plain, ['top' => 'zzlegacy']);
    $r = $judge(state($u, $T0 + 60000, $look, wd([])), state($u, $T0, $plain, wd([])), $u);
    return !in_array('WARDROBE_NOT_OWNED', codes($r), true) ? true : j(codes($r));
});
$shape = [
    'an unknown piece' => function ($b) { $b['own'] = ['WEAR_HAT_NOPE' => 1]; return $b; },
    'a piece marked other than 1' => function ($b) use ($hat) { $b['own'] = [$hat => 2]; return $b; },
    'thirteen outfits' => function ($b) { $b['sets'] = array_fill(0, 13, ['id' => 's', 'name' => '옷', 'app' => ['topColor' => '#ffffff']]); return $b; },
    'an outfit name with markup' => function ($b) { $b['sets'] = [['id' => 's1', 'name' => '<b>옷</b>', 'app' => ['topColor' => '#ffffff']]]; return $b; },
    'an outfit name that is too long' => function ($b) { $b['sets'] = [['id' => 's1', 'name' => str_repeat('가', 13), 'app' => ['topColor' => '#ffffff']]]; return $b; },
    'an outfit key that is not a look key' => function ($b) { $b['sets'] = [['id' => 's1', 'name' => '옷', 'app' => ['nickname' => 'x']]]; return $b; },
    'a word that is not in the list' => function ($b) { $b['sheet'] = ['traits' => ['나쁜 말'], 'home' => null]; return $b; },
    'four words' => function ($b) use ($W) { $b['sheet'] = ['traits' => array_slice($W['traits'], 0, 4), 'home' => null]; return $b; },
    'a repeated word' => function ($b) use ($W) { $b['sheet'] = ['traits' => [$W['traits'][0], $W['traits'][0]], 'home' => null]; return $b; },
    'an unknown home' => function ($b) { $b['sheet'] = ['traits' => [], 'home' => 'mars']; return $b; },
    'an unknown face' => function ($b) { $b['expr'] = 'angry'; return $b; },
    'a version other than 1' => function ($b) { $b['v'] = 2; return $b; },
];
foreach ($shape as $what => $mk) {
    check("violation: $what", function () use ($judge, $u, $T0, $plain, $mk) {
        $r = $judge(state($u, $T0 + 60000, $plain, $mk(wd([]))), state($u, $T0, $plain, wd([])), $u);
        return in_array('WARDROBE_BAD_SHAPE', codes($r), true) ? true : j(codes($r));
    });
}
check('a wardrobe that is not an object is malformed (400)', function () use ($judge, $u, $T0, $plain) {
    $c = apiCode(function () use ($judge, $u, $T0, $plain) { $judge(state($u, $T0 + 60000, $plain, null) , null, $u); });
    $n = state($u, $T0 + 60000, $plain, null); $n->wardrobe = 'x';
    $c = apiCode(function () use ($judge, $n, $u, $T0, $plain) { $judge($n, state($u, $T0, $plain, null), $u); });
    return strpos($c, '400') === 0 ? true : 'got ' . $c;
});
check('the migration: an existing look keeps (and is given) every piece it wears — explained, passes', function () use ($judge, $u, $T0, $plain, $dear, $val, $key) {
    $look = $plain; $own = [];
    foreach ($dear as $iid) { $look[$key($iid)] = $val($iid); $own[] = $iid; }
    $r = $judge(state($u, $T0 + 60000, $look, wd($own)), state($u, $T0, $look, null), $u);
    return $r['ok'] ? true : j($r['violations']);
});
check('… but only once: the same jump after a migrated copy is unexplained', function () use ($judge, $u, $T0, $plain, $dear, $val, $key) {
    $look = $plain; $own = [];
    foreach ($dear as $iid) { $look[$key($iid)] = $val($iid); $own[] = $iid; }
    $r = $judge(state($u, $T0 + 60000, $look, wd($own)), state($u, $T0, $plain, wd([])), $u);
    return in_array('UNEXPLAINED_VALUE', codes($r), true) ? true : j([codes($r), isset($r['notes']) ? $r['notes'] : null]);
});
check('a new profile owns what its chosen look wears (first save) — passes', function () use ($judge, $u, $T0, $plain, $bySlot, $val, $key) {
    $look = $plain; $own = [];
    foreach (['outer', 'hat', 'footwear', 'pouch', 'norigae', 'bag'] as $k) if (isset($bySlot[$k][1])) { $look[$k] = $val($bySlot[$k][1]); $own[] = $bySlot[$k][1]; }
    $r = $judge(state($u, $T0 + 60000, $look, wd($own)), null, $u);
    return $r['ok'] ? true : j($r['violations']);
});

// =============================================================================================== 3 · through the database
Tfm\Db::pdo();
echo 'driver: ' . Tfm\Db::driverSafe() . "\n";
check('a save with the block goes into player_saves and comes back unchanged (Hangul names, the driver ' . Tfm\Db::driverSafe() . ')', function () use ($u, $T0, $plain, $hat, $W) {
    $now = (int) round(microtime(true) * 1000);
    $mail = 'wardrobe-' . bin2hex(random_bytes(4)) . '@example.test';
    $uid = (int) Tfm\Db::insert('users', ['email' => $mail, 'nickname' => 'wd' . bin2hex(random_bytes(3)), 'nickname_key' => 'wd' . bin2hex(random_bytes(3)), 'password_hash' => 'x', 'role' => 'user', 'created_at' => $now, 'updated_at' => $now]);
    $b = wd([$hat], ['sets' => [['id' => 's1', 'name' => '설빔 나들이', 'app' => ['topColor' => '#ffd766']]], 'sheet' => ['traits' => array_slice($W['traits'], 0, 2), 'home' => $W['homes'][1]]]);
    $s = state(['id' => $uid] + $u, $T0, $plain, $b);
    $json = (string) json_encode($s, JSON_UNESCAPED_UNICODE);
    Tfm\Db::upsert('player_saves', ['user_id' => $uid, 'version' => 1, 'revision' => 1, 'data' => $json, 'checksum' => '', 'size_bytes' => strlen($json), 'meta' => '{}', 'saved_at' => $now, 'created_at' => $now], ['user_id']);
    $row = Tfm\Db::one('SELECT data FROM player_saves WHERE user_id = ?', [$uid]);
    $back = json_decode((string) $row['data'], true);
    Tfm\Db::exec('DELETE FROM player_saves WHERE user_id = ?', [$uid]);
    Tfm\Db::exec('DELETE FROM users WHERE id = ?', [$uid]);
    return $back['wardrobe'] === json_decode($json, true)['wardrobe'] && $back['wardrobe']['sets'][0]['name'] === '설빔 나들이' ? true : j($back['wardrobe'] ?? null);
});

echo "\nwardrobe-unit: $passed passed, $failed failed\n";
exit($failed ? 1 : 0);
