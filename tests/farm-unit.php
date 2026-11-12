<?php
/**
 * tests/farm-unit.php — unit checks for the real-time farm server (CONTRACT §15.1–15.3, workflow interfaces 2–4):
 * GameData rtfarm / storage accessors, the SaveValidator rt / storage rules, Tfm\Farm (sync, view, reports, admin API).
 * No web server: a throw-away SQLite database in the temp dir — or MariaDB with the TFM_DB_* variables:
 *
 *   php tests/farm-unit.php
 *   TFM_DB_DRIVER=mysql TFM_DB_HOST=127.0.0.1 TFM_DB_PORT=33106 TFM_DB_USER=root TFM_DB_NAME=tfm_fs_unit php tests/farm-unit.php
 *   (the MariaDB database must exist; every run uses fresh random accounts, so it can be repeated)
 *
 * Every check runs inside its own try/catch: a missing class / method is that check's FAIL (with the error message)
 * instead of the end of the run, so one run shows every behaviour that is still missing. TFM_UNIT_ONLY=<text> runs only
 * the checks whose name contains <text>.
 * CLI only; never deployed (tests/ is not part of the web root). Developer tooling: runs on the dev PHP (8.x).
 */
declare(strict_types=1);

if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
$tmp = sys_get_temp_dir() . '/tfm-farm-' . bin2hex(random_bytes(6));
mkdir($tmp, 0700, true);
putenv("TFM_DATA_DIR=$tmp");
require __DIR__ . '/../server/lib/bootstrap.php';

$failed = 0;
$passed = 0;
/** $test returns true (pass), false or a string (fail + detail); a thrown error is a fail with its message */
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
/** did $fn throw an ApiException with $code (and, when given, HTTP $status) */
function throwsApi(callable $fn, string $code, int $status = 0): bool
{
    try { $fn(); } catch (Tfm\ApiException $e) { return $e->errorCode === $code && ($status === 0 || $e->status === $status); }
    return false;
}
/** the ApiException code a call throws ('' = none) */
function apiCode(callable $fn): string
{
    try { $fn(); } catch (Tfm\ApiException $e) { return $e->status . ' ' . $e->errorCode; }
    return '';
}

Tfm\Db::pdo(); // creates the schema (v6)
echo 'driver: ' . Tfm\Db::driver() . PHP_EOL;
$RUN = bin2hex(random_bytes(3));
$nUsers = 0;
/** a fresh account (unique per run, so a shared MariaDB database can be reused) */
function newUser(string $role = 'user'): array
{
    global $RUN, $nUsers;
    $nUsers++;
    $u = Tfm\Users::create("farm{$RUN}{$nUsers}@example.com", 'Farm' . substr($RUN, 0, 4) . $nUsers, 'Ferment2026ok', $role === 'admin' ? 'admin' : '');
    return $u;
}
/** deep copy of a stdClass save tree */
function cl($o) { return json_decode(json_encode($o), false); }
/** a realistic fresh client state as a stdClass tree (the e2e fixture, plus the phase-7 rtfarm / storage) */
function fresh(array $u, int $t): stdClass
{
    $plots = [];
    foreach ([['P1', 'CROP_BEAN', 65, 120], ['P6', 'CROP_RADISH', 96, 110], ['H3', null, 0, 0]] as $p) {
        list($id, $crop, $g, $gt) = $p;
        $plots[$id] = $crop
            ? ['cropId' => $crop, 'growth' => $g, 'water' => 60, 'health' => 80, 'plantedAt' => $t - (int) round($g / 100 * $gt * 1000), 'lastUpdate' => $t, 'lastWaterAt' => 0, 'harvests' => 0]
            : ['cropId' => null, 'growth' => 0, 'water' => 40, 'health' => 100, 'plantedAt' => 0, 'lastUpdate' => $t, 'lastWaterAt' => 0, 'harvests' => 0];
    }
    $s = [
        'version' => 1, 'createdAt' => $t, 'savedAt' => $t,
        'profile' => ['id' => (string) $u['id'], 'nickname' => $u['nickname'], 'email' => $u['email'], 'role' => $u['role'], 'avatar' => null, 'title' => '', 'titles' => []],
        'stats' => ['level' => 1, 'exp' => 0, 'coin' => 0, 'edu' => 0, 'logins' => 1, 'playTime' => 0, 'distance' => 0, 'harvests' => 0, 'crafts' => 0, 'fermentsClaimed' => 0, 'rtHarvests' => 0],
        'player' => ['x' => 0, 'y' => 0, 'z' => 9, 'zoneId' => 'ZONE_MAIN'],
        'inventory' => ['ITEM_SEED_BEAN' => 3, 'ITEM_WATERING_CAN' => 1, 'ITEM_RADISH' => 3, 'ITEM_MEJU' => 1],
        'quests' => new stdClass(), 'farm' => ['plots' => $plots], 'jars' => new stdClass(),
        'education' => ['viewed' => new stdClass(), 'completed' => new stdClass(), 'quiz' => new stdClass()],
        'journal' => [], 'photos' => [], 'achievements' => new stdClass(), 'collection' => new stdClass(), 'visited' => ['ZONE_MAIN' => $t],
        'flags' => new stdClass(), 'activity' => [],
        'rtfarm' => ['beds' => new stdClass(), 'last' => [], 'reports' => []],
        'storage' => ['items' => new stdClass(), 'cap' => 300],
    ];
    return json_decode(json_encode($s), false);
}
/** violation codes of a validate() result */
function codes(array $res): array { return array_values(array_unique(array_map(function ($v) { return $v['code']; }, $res['violations']))); }
/** SaveValidator::validate with the usual arguments; $p = previous accepted state */
function validate(stdClass $n, ?stdClass $p, array $u, int $prevAt, int $now, array $meta = [], ?callable $hook = null, int $tier = 1): array
{
    return Tfm\SaveValidator::validate(cl($n), $p ? cl($p) : null, $meta, $u, $prevAt, $now, $tier, $hook);
}
/** a 16-hex planting id */
function pid(): string { return bin2hex(random_bytes(8)); }

// =============================================================================================== 1 · GameData
check('GameData::rtBeds — the four real-time beds of the export', function () {
    return Tfm\GameData::rtBeds() === ['RB1', 'RB2', 'RB3', 'RB4'];
});
check('GameData::rtCrop — minutes / exp / coin of a real-time crop, null for an unknown one', function () {
    $m = Tfm\GameData::rtCrop('CROP_MINT');
    return is_array($m) && (int) $m['minutes'] === 10 && (int) $m['exp'] === 60 && (int) $m['coin'] === 45
        && (int) Tfm\GameData::rtCrop('CROP_CORN')['minutes'] === 480 && Tfm\GameData::rtCrop('CROP_NOPE') === null;
});
check('GameData::rtfarm — the whole block (crops, starAt, bonusAtStars, reportNotes)', function () {
    $r = Tfm\GameData::rtfarm();
    return count($r['crops']) === 10 && $r['starAt'] === [0, 40, 75] && (int) $r['bonusAtStars'] === 3 && count($r['reportNotes']) === 4;
});
check('GameData::storage / storageCap / storable — cap 300, crop + fermented goods only', function () {
    $s = Tfm\GameData::storage();
    return Tfm\GameData::storageCap() === 300 && (int) $s['cap'] === 300 && in_array('ITEM_BEAN', $s['itemIds'], true)
        && Tfm\GameData::storable('ITEM_DOENJANG') && Tfm\GameData::storable('ITEM_MINT') && !Tfm\GameData::storable('ITEM_SEED_BEAN')
        && !Tfm\GameData::storable('ITEM_MEJU') && !Tfm\GameData::storable('');
});

// =============================================================================================== 1 · SaveValidator
$U1 = newUser();
$T0 = Tfm\Clock::ms() - 3600000;
$base = fresh($U1, $T0);
$first = validate($base, null, $U1, $T0 - 1000, $T0);
check('SaveValidator — a fresh state with an empty rtfarm / storage is accepted', function () use ($first) {
    return $first['ok'] ? true : 'violations: ' . implode(',', codes($first));
});
$meta1 = $first['meta'];
check('SaveValidator — an older client without rtfarm / storage / rtHarvests is still accepted', function () use ($U1, $T0) {
    $s = fresh($U1, $T0);
    unset($s->rtfarm, $s->storage, $s->stats->rtHarvests);
    $r = validate($s, null, $U1, $T0 - 1000, $T0);
    return $r['ok'] ? true : implode(',', codes($r));
});
/** one modification of the accepted base save, validated 2 s later */
$mod = function (callable $m) use ($base, $U1, $T0, $meta1): array {
    $n = cl($base);
    $m($n);
    return validate($n, $base, $U1, $T0, $T0 + 2000, $meta1);
};
check('SaveValidator — RT_BAD_BED: a bed id that is not RB1–RB4', function () use ($mod) {
    $r = $mod(function ($n) { $n->rtfarm->beds->RB9 = (object) ['cropId' => 'CROP_MINT', 'pid' => pid(), 'plantedAt' => 1, 'readyAt' => 2, 'dur' => 1, 'tier' => 1, 'care' => 0, 'lastCareAt' => 0]; });
    return in_array('RT_BAD_BED', codes($r), true) ? true : implode(',', codes($r));
});
check('SaveValidator — RT_BAD_CROP: a crop that is not a real-time crop', function () use ($mod, $T0) {
    $r = $mod(function ($n) use ($T0) { $n->rtfarm->beds->RB1 = (object) ['cropId' => 'CROP_DRAGONFRUIT', 'pid' => pid(), 'plantedAt' => $T0, 'readyAt' => $T0, 'dur' => 1, 'tier' => 1, 'care' => 0, 'lastCareAt' => 0]; });
    return in_array('RT_BAD_CROP', codes($r), true) ? true : implode(',', codes($r));
});
check('SaveValidator — RT_BAD_SHAPE: pid / times / tier / care / bed / last / reports / rtHarvests of the wrong shape', function () use ($mod, $T0) {
    $bed = function (array $o) use ($T0) { return (object) ($o + ['cropId' => 'CROP_MINT', 'pid' => pid(), 'plantedAt' => $T0, 'readyAt' => $T0 + 600000, 'dur' => 600000, 'tier' => 1, 'care' => 0, 'lastCareAt' => 0]); };
    $cases = [
        'pid 15 hex' => function ($n) use ($bed) { $n->rtfarm->beds->RB1 = $bed(['pid' => substr(pid(), 1)]); },
        'pid upper case' => function ($n) use ($bed) { $n->rtfarm->beds->RB1 = $bed(['pid' => strtoupper(pid())]); },
        'pid not hex' => function ($n) use ($bed) { $n->rtfarm->beds->RB1 = $bed(['pid' => 'zzzzzzzzzzzzzzzz']); },
        'pid a number' => function ($n) use ($bed) { $n->rtfarm->beds->RB1 = $bed(['pid' => 1234567890123456]); },
        'plantedAt a word' => function ($n) use ($bed) { $n->rtfarm->beds->RB1 = $bed(['plantedAt' => 'yesterday']); },
        'readyAt negative' => function ($n) use ($bed) { $n->rtfarm->beds->RB1 = $bed(['readyAt' => -5]); },
        'tier 7' => function ($n) use ($bed) { $n->rtfarm->beds->RB1 = $bed(['tier' => 7]); },
        'care 150' => function ($n) use ($bed) { $n->rtfarm->beds->RB1 = $bed(['care' => 150]); },
        'cropId a number' => function ($n) use ($bed) { $n->rtfarm->beds->RB1 = $bed(['cropId' => 5]); },
        'bed a string' => function ($n) { $n->rtfarm->beds->RB1 = 'mint'; },
        'beds a list' => function ($n) use ($bed) { $n->rtfarm->beds = [$bed([])]; },
        'rtfarm a string' => function ($n) { $n->rtfarm = 'farm'; },
        'last an object' => function ($n) { $n->rtfarm->last = (object) ['a' => 1]; },
        'last 9 entries' => function ($n) use ($T0) { $n->rtfarm->last = array_fill(0, 9, (object) ['pid' => pid(), 'bedId' => 'RB1', 'cropId' => 'CROP_MINT', 'amount' => 3, 'stars' => 1, 'at' => $T0]); },
        'last amount negative' => function ($n) use ($T0) { $n->rtfarm->last = [(object) ['pid' => pid(), 'bedId' => 'RB1', 'cropId' => 'CROP_MINT', 'amount' => -1, 'stars' => 1, 'at' => $T0]]; },
        'last stars 9' => function ($n) use ($T0) { $n->rtfarm->last = [(object) ['pid' => pid(), 'bedId' => 'RB1', 'cropId' => 'CROP_MINT', 'amount' => 3, 'stars' => 9, 'at' => $T0]]; },
        'last bed unknown' => function ($n) use ($T0) { $n->rtfarm->last = [(object) ['pid' => pid(), 'bedId' => 'RB7', 'cropId' => 'CROP_MINT', 'amount' => 3, 'stars' => 1, 'at' => $T0]]; },
        'reports a string' => function ($n) { $n->rtfarm->reports = 'x'; },
        'rtHarvests a float' => function ($n) { $n->stats->rtHarvests = 1.5; },
    ];
    $bad = [];
    foreach ($cases as $label => $m) { $c = codes($mod($m)); if (!in_array('RT_BAD_SHAPE', $c, true)) $bad[] = "$label → " . (implode(',', $c) ?: 'accepted'); }
    return $bad ? implode(' | ', $bad) : true;
});
check('SaveValidator — STORAGE_BAD_ITEM: a seed, a tool or a made-up id in the 곳간', function () use ($mod) {
    $bad = [];
    foreach (['ITEM_SEED_BEAN', 'ITEM_WATERING_CAN', 'ITEM_NOPE', 'b-o-g-u-s'] as $id) {
        $c = codes($mod(function ($n) use ($id) { $n->storage->items->$id = 1; }));
        if (!in_array('STORAGE_BAD_ITEM', $c, true)) $bad[] = "$id → " . (implode(',', $c) ?: 'accepted');
    }
    return $bad ? implode(' | ', $bad) : true;
});
check('SaveValidator — STORAGE_BAD_QTY: negative, fractional, text and over-9999 quantities', function () use ($mod) {
    $bad = [];
    foreach ([-1, 1.5, '3', 10000, true] as $q) {
        $c = codes($mod(function ($n) use ($q) { $n->storage->items->ITEM_RADISH = $q; }));
        if (!in_array('STORAGE_BAD_QTY', $c, true)) $bad[] = json_encode($q) . ' → ' . (implode(',', $c) ?: 'accepted');
    }
    return $bad ? implode(' | ', $bad) : true;
});
check('SaveValidator — STORAGE_OVER_CAP: the total is measured against the server cap (a client cap of 9999 changes nothing)', function () use ($mod) {
    $c = codes($mod(function ($n) { $n->storage->items->ITEM_RADISH = 3; $n->inventory->ITEM_RADISH = 0; $n->storage->items->ITEM_BEAN = 298; $n->storage->cap = 9999; }));
    return in_array('STORAGE_OVER_CAP', $c, true) ? true : (implode(',', $c) ?: 'accepted');
});
check('SaveValidator — storage / items of the wrong container type (a string, a list with values) → STORAGE_BAD_*', function () use ($mod) {
    $a = codes($mod(function ($n) { $n->storage = 'barn'; }));
    $b = codes($mod(function ($n) { $n->storage->items = [1, 2]; }));
    $ok = function (array $c) { return (bool) array_filter($c, function ($x) { return strpos($x, 'STORAGE_') === 0; }); };
    return $ok($a) && $ok($b) ? true : 'storage string → ' . implode(',', $a) . ' · items list → ' . implode(',', $b);
});
check('SaveValidator — the client cap is stored as the server cap (300), like the account role', function () use ($base, $U1, $T0, $meta1) {
    $n = cl($base);
    $n->storage->cap = 500;
    $r = Tfm\SaveValidator::validate($n, cl($base), $meta1, $U1, $T0, $T0 + 2000, 1, null);
    return $r['ok'] && $n->storage->cap === 300 ? true : 'ok=' . json_encode($r['ok']) . ' cap=' . json_encode($n->storage->cap) . ' ' . implode(',', codes($r));
});
check('SaveValidator — net worth includes the 곳간: moving 3 radishes from the bag into the 곳간 changes nothing', function () use ($mod) {
    $r = $mod(function ($n) { $n->inventory->ITEM_RADISH = 0; $n->storage->items->ITEM_RADISH = 3; });
    return $r['ok'] && $r['summary']['dValue'] === 0 ? true : 'ok=' . json_encode($r['ok']) . ' dValue=' . $r['summary']['dValue'] . ' ' . implode(',', codes($r));
});
check('SaveValidator — net worth includes the 곳간: and back again (taking out) changes nothing either', function () use ($base, $U1, $T0, $meta1) {
    $p = cl($base);
    $p->inventory->ITEM_RADISH = 0;
    $p->storage->items->ITEM_RADISH = 3;
    $n = cl($base);
    $r = validate($n, $p, $U1, $T0, $T0 + 2000, $meta1);
    return $r['ok'] && $r['summary']['dValue'] === 0 ? true : 'dValue=' . $r['summary']['dValue'] . ' ' . implode(',', codes($r));
});
check('SaveValidator — goods that appear in the 곳간 from nowhere (20 고추장 = 10,000) → UNEXPLAINED_VALUE', function () use ($mod) {
    $r = $mod(function ($n) { $n->storage->items->ITEM_GOCHUJANG = 20; });
    return in_array('UNEXPLAINED_VALUE', codes($r), true) ? true : (implode(',', codes($r)) ?: 'accepted') . ' dValue=' . $r['summary']['dValue'];
});
/** a real-time corn harvest: 5 corn into the 곳간, +250 coin, +320 exp (more than the per-save exp allowance) */
$cornHarvest = function ($n) {
    $n->storage->items->ITEM_CORN = 5;
    $n->stats->coin += 250;
    $n->stats->level = 2;   // +320 exp from level 1 / 0: level 1 needs 120, so level 2 with 200 (exp total 320)
    $n->stats->exp = 200;
    $n->stats->rtHarvests = 1;
};
check('SaveValidator — a real-time harvest nobody explains (no farm hook) is refused (UNEXPLAINED_EXP)', function () use ($mod, $cornHarvest) {
    $r = $mod($cornHarvest);
    return in_array('UNEXPLAINED_EXP', codes($r), true) ? true : (implode(',', codes($r)) ?: 'accepted');
});
check('SaveValidator — the farm hook\'s explained reward (item value × amount + rt coin / exp) makes the same harvest pass', function () use ($base, $U1, $T0, $meta1, $cornHarvest) {
    $n = cl($base);
    $cornHarvest($n);
    $seen = null;
    $hook = function ($nn, $pp) use (&$seen) { $seen = [$nn !== null, $pp !== null]; return ['violations' => [], 'explain' => ['value' => 250 + 5 * 50, 'exp' => 320], 'harvests' => 1]; };
    $r = validate($n, $base, $U1, $T0, $T0 + 2000, $meta1, $hook);
    return $r['ok'] && $seen === [true, true] && $r['summary']['rt']['value'] === 500 ? true : 'ok=' . json_encode($r['ok']) . ' seen=' . json_encode($seen) . ' ' . implode(',', codes($r)) . ' ' . json_encode($r['summary']['rt'] ?? null);
});
check('SaveValidator — the farm hook\'s violations refuse the whole save', function () use ($base, $U1, $T0, $meta1) {
    $hook = function () { return ['violations' => [['code' => 'RT_HARVEST_TOO_EARLY', 'bed' => 'RB1']], 'explain' => ['value' => 0, 'exp' => 0], 'harvests' => 0]; };
    $r = validate(cl($base), $base, $U1, $T0, $T0 + 2000, $meta1, $hook);
    return !$r['ok'] && codes($r) === ['RT_HARVEST_TOO_EARLY'] ? true : 'ok=' . json_encode($r['ok']) . ' ' . implode(',', codes($r));
});
check('SaveValidator — the farm hook is not called when the rt shape is already wrong (it cannot trust the data)', function () use ($mod, $base, $U1, $T0, $meta1) {
    $called = false;
    $hook = function () use (&$called) { $called = true; return ['violations' => [], 'explain' => ['value' => 0, 'exp' => 0], 'harvests' => 0]; };
    $n = cl($base);
    $n->rtfarm->beds->RB1 = 'mint';
    $r = validate($n, $base, $U1, $T0, $T0 + 2000, $meta1, $hook);
    return !$called && in_array('RT_BAD_SHAPE', codes($r), true) ? true : 'called=' . json_encode($called) . ' ' . implode(',', codes($r));
});
check('SaveValidator — stats.harvests may grow by the validated real-time harvests too (two rt harvests, no plot harvest)', function () use ($base, $U1, $T0, $meta1) {
    $n = cl($base);
    $n->stats->harvests = 2;
    $n->stats->rtHarvests = 2;
    $n->storage->items->ITEM_MINT = 8;
    $n->stats->coin += 90; $n->stats->exp += 120;
    $hook = function () { return ['violations' => [], 'explain' => ['value' => 2 * (45 + 4 * 40), 'exp' => 120], 'harvests' => 2]; };
    $r = validate($n, $base, $U1, $T0, $T0 + 2000, $meta1, $hook);
    return $r['ok'] ? true : implode(',', codes($r));
});
check('SaveValidator — crop items kept in the 곳간 count as crafting ingredients (no CRAFT_COUNT for 3 crafts)', function () use ($base, $U1, $T0, $meta1) {
    $p = cl($base);
    $p->inventory->ITEM_RADISH = 0;
    $p->storage->items->ITEM_RADISH = 3;
    $p->storage->items->ITEM_BEAN = 27;
    $n = cl($p);
    $n->stats->crafts = 3;
    $r = validate($n, $p, $U1, $T0, $T0 + 2000, $meta1);
    return !in_array('CRAFT_COUNT', codes($r), true) ? true : implode(',', codes($r));
});
check('SaveValidator — Object.prototype names as bed / 곳간 ids are a malformed save (400 INVALID_SAVE)', function () use ($base) {
    $a = cl($base); $a->rtfarm->beds->constructor = (object) ['cropId' => 'CROP_MINT'];
    $b = cl($base); $b->storage->items->__proto__ = 1;
    return throwsApi(function () use ($a) { Tfm\SaveValidator::assertNoProtoKeys($a); }, 'INVALID_SAVE', 400)
        && throwsApi(function () use ($b) { Tfm\SaveValidator::assertNoProtoKeys($b); }, 'INVALID_SAVE', 400);
});

echo PHP_EOL . ($failed === 0 ? "✔ all $passed farm unit checks passed" : "✖ $failed of " . ($failed + $passed) . " farm check(s) failed") . " (driver " . Tfm\Db::driver() . ')' . PHP_EOL;
exit($failed === 0 ? 0 : 1);
