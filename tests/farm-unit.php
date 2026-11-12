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
putenv("TFM_UPLOAD_DIR=$tmp/uploads");   // report-photo files of these checks never land in the repository's server/uploads
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

// =============================================================================================== 2 · Farm::sync (server authority)
/** a growing real-time bed as the client stores it */
function bed(string $crop, string $pid, int $t, array $o = []): stdClass
{
    return (object) ($o + ['cropId' => $crop, 'pid' => $pid, 'plantedAt' => $t, 'readyAt' => $t + 600000, 'dur' => 600000, 'tier' => 1, 'care' => 0, 'lastCareAt' => 0]);
}
/** $s with bed $bedId harvested on the client: bed gone, a `last` entry, stats.rtHarvests + 1 */
function harvested(stdClass $s, string $bedId, int $amount, int $stars, int $t): stdClass
{
    $n = cl($s);
    $b = $n->rtfarm->beds->$bedId;
    unset($n->rtfarm->beds->$bedId);
    array_unshift($n->rtfarm->last, (object) ['pid' => $b->pid, 'bedId' => $bedId, 'cropId' => $b->cropId, 'amount' => $amount, 'stars' => $stars, 'at' => $t]);
    $n->rtfarm->last = array_slice($n->rtfarm->last, 0, 8);
    $n->stats->rtHarvests++;
    return $n;
}
/** the farm_beds rows of a planting */
function row(int $uid, string $pid): ?array { return Tfm\Db::one('SELECT * FROM farm_beds WHERE user_id = ? AND pid = ? ORDER BY id DESC', [$uid, $pid]); }
function vcodes(array $plan): array { return array_values(array_unique(array_map(function ($v) { return $v['code']; }, $plan['violations']))); }
Tfm\Config::override('farm.rt_scale', 1.0);
if (class_exists('Tfm\Settings')) Tfm\Settings::reset();

check('Farm::durationMs — minutes × 60000 ÷ (tier × scale): mint 10 min, tier 2 halves it, scale 60 makes it 10 s', function () {
    return Tfm\Farm::durationMs('CROP_MINT', 1, 1.0) === 600000 && Tfm\Farm::durationMs('CROP_MINT', 2, 1.0) === 300000
        && Tfm\Farm::durationMs('CROP_MINT', 1, 60.0) === 10000 && Tfm\Farm::durationMs('CROP_CORN', 4, 2.0) === 3600000;
});
$ADM = newUser('admin');
check('Farm::scale / setScale — the config default, an admin sets 60, out-of-range and NaN are refused, a player cannot', function () use ($ADM, $U1) {
    if (Tfm\Farm::scale() !== 1.0) return 'default ' . Tfm\Farm::scale();
    $player = apiCode(function () use ($U1) { Tfm\Farm::setScale($U1, 5.0); });
    Tfm\Farm::setScale($ADM, 60.0);
    $set = Tfm\Farm::scale();
    $low = apiCode(function () use ($ADM) { Tfm\Farm::setScale($ADM, 0.05); });
    $high = apiCode(function () use ($ADM) { Tfm\Farm::setScale($ADM, 3601.0); });
    $nan = apiCode(function () use ($ADM) { Tfm\Farm::setScale($ADM, NAN); });
    $audit = (int) Tfm\Db::value("SELECT COUNT(*) FROM audit_log WHERE event = 'setting_changed' AND actor_id = ?", [(int) $ADM['id']]);
    Tfm\Farm::setScale($ADM, 1.0);
    return $player === '403 FORBIDDEN' && $set === 60.0 && $low === '400 INVALID_SETTING' && $high === '400 INVALID_SETTING' && $nan === '400 INVALID_SETTING' && $audit >= 1 && Tfm\Farm::scale() === 1.0
        ? true : "player=$player set=$set low=$low high=$high nan=$nan audit=$audit now=" . Tfm\Farm::scale();
});

$U2 = newUser();
$T = Tfm\Clock::ms();
$s0 = fresh($U2, $T - 60000);
$X = pid();
$s1 = cl($s0);
// the client claims the mint was planted a day ago and is ready already: the server ignores plantedAt / readyAt / dur
$s1->rtfarm->beds->RB1 = bed('CROP_MINT', $X, $T - 86400000, ['readyAt' => $T - 1, 'dur' => 1]);
$plant = null;
check('Farm::sync — (1) a new planting: first_seen_at = now, ready_at = now + 10 min by the server clock (a faked plantedAt in the past changes nothing)', function () use (&$plant, $U2, $s0, $s1, $T, $X) {
    $plant = Tfm\Farm::sync((int) $U2['id'], cl($s1), cl($s0), $T, 1);
    $r = row((int) $U2['id'], $X);
    if (!$plant['ok']) return 'violations ' . implode(',', vcodes($plant));
    return $r && (int) $r['first_seen_at'] === $T && (int) $r['ready_at'] === $T + 600000 && $r['status'] === 'growing' && $r['kind'] === 'rt'
        && $r['bed_id'] === 'RB1' && $r['crop_id'] === 'CROP_MINT' && (int) $r['tier'] === 1 ? true : json_encode($r);
});
check('Farm::view — data.rt: {scale, tier, beds:{RB1:{pid, cropId, firstSeenAt, readyAt, status}}} from the server records', function () use ($U2, $T, $X) {
    $v = Tfm\Farm::view((int) $U2['id'], 1, $T + 1000);
    $b = $v['beds']['RB1'] ?? null;
    return $v['scale'] === 1.0 && $v['tier'] === 1 && $b && $b['pid'] === $X && $b['cropId'] === 'CROP_MINT' && $b['firstSeenAt'] === $T && $b['readyAt'] === $T + 600000 && $b['status'] === 'growing'
        ? true : json_encode($v);
});
check('Farm::view — no bed growing: beds is an empty JSON object ({}), not a list', function () {
    $u = newUser();
    return json_encode(Tfm\Farm::view((int) $u['id'], 1)['beds']) === '{}';
});
check('Farm::sync — a save that keeps the planting changes nothing (same ready_at, still growing)', function () use ($U2, $s1, $T, $X) {
    $r = Tfm\Farm::sync((int) $U2['id'], cl($s1), cl($s1), $T + 30000, 1);
    $row = row((int) $U2['id'], $X);
    return $r['ok'] && (int) $row['ready_at'] === $T + 600000 && $row['status'] === 'growing' ? true : implode(',', vcodes($r)) . ' ' . json_encode($row);
});
$h1 = harvested($s1, 'RB1', 4, 1, $T + 60000);
check('Farm::sync — (2) a harvest before ready_at − 5 s → RT_HARVEST_TOO_EARLY, nothing is written', function () use ($U2, $s1, $h1, $T, $X) {
    $r = Tfm\Farm::sync((int) $U2['id'], cl($h1), cl($s1), $T + 60000, 1);
    $row = row((int) $U2['id'], $X);
    return !$r['ok'] && in_array('RT_HARVEST_TOO_EARLY', vcodes($r), true) && !in_array('RT_HARVEST_COUNT', vcodes($r), true) && $row['status'] === 'growing'
        ? true : implode(',', vcodes($r)) . ' ' . $row['status'];
});
check('Farm::sync — (2) the same harvest at ready_at − 5.5 s is still too early (the slack is 5 s)', function () use ($U2, $s1, $h1, $T) {
    $r = Tfm\Farm::plan((int) $U2['id'], cl($h1), cl($s1), $T + 600000 - 5500, 1);
    return vcodes($r) === ['RT_HARVEST_TOO_EARLY'] ? true : implode(',', vcodes($r));
});
$harv = null;
check('Farm::sync — (2) at ready_at − 4 s the harvest is accepted: row harvested (harvested_at, amount, stars), reward explained (4 × 40 + 45, 60 exp)', function () use (&$harv, $U2, $s1, $h1, $T, $X) {
    $harv = Tfm\Farm::sync((int) $U2['id'], cl($h1), cl($s1), $T + 600000 - 4000, 1);
    $row = row((int) $U2['id'], $X);
    return $harv['ok'] && $harv['harvests'] === 1 && $harv['explain'] === ['value' => 4 * 40 + 45, 'exp' => 60] && $row['status'] === 'harvested'
        && (int) $row['harvested_at'] === $T + 600000 - 4000 && (int) $row['amount'] === 4 && (int) $row['stars'] === 1
        ? true : implode(',', vcodes($harv)) . ' ' . json_encode($harv['explain']) . ' ' . json_encode($row);
});
check('Farm::sync — a second harvest of the same pid is refused (the bed put back → RT_PID_REUSE; the harvest counted again → RT_HARVEST_COUNT)', function () use ($U2, $h1, $T, $X) {
    $back = cl($h1);
    $back->rtfarm->beds->RB1 = bed('CROP_MINT', $X, $T);
    $a = Tfm\Farm::plan((int) $U2['id'], $back, cl($h1), $T + 700000, 1);
    $again = cl($h1);
    array_unshift($again->rtfarm->last, cl($again->rtfarm->last[0]));
    $again->stats->rtHarvests++;
    $b = Tfm\Farm::plan((int) $U2['id'], $again, cl($h1), $T + 700000, 1);
    return in_array('RT_PID_REUSE', vcodes($a), true) && in_array('RT_HARVEST_COUNT', vcodes($b), true) ? true : 'put back: ' . implode(',', vcodes($a)) . ' · counted again: ' . implode(',', vcodes($b));
});
check('Farm::sync — (3) stats.rtHarvests that grows without a harvested planting → RT_HARVEST_COUNT', function () use ($U2, $h1, $T) {
    $n = cl($h1);
    $n->stats->rtHarvests += 1;
    $r = Tfm\Farm::plan((int) $U2['id'], $n, cl($h1), $T + 700000, 1);
    return vcodes($r) === ['RT_HARVEST_COUNT'] ? true : implode(',', vcodes($r));
});
check('Farm::sync — an amount above harvestAmount.max + 1 → RT_HARVEST_COUNT (mint: max 5 + 1 = 6)', function () use ($U2, $T) {
    $uid = (int) $U2['id'];
    $p = pid();
    $a = fresh($U2, $T);
    $a->rtfarm->beds->RB2 = bed('CROP_MINT', $p, $T);
    Tfm\Farm::sync($uid, cl($a), null, $T, 1);
    $seven = Tfm\Farm::plan($uid, harvested($a, 'RB2', 7, 3, $T), cl($a), $T + 600000, 1);
    $six = Tfm\Farm::plan($uid, harvested($a, 'RB2', 6, 3, $T), cl($a), $T + 600000, 1);
    return vcodes($seven) === ['RT_HARVEST_COUNT'] && $six['ok'] ? true : '7 → ' . implode(',', vcodes($seven)) . ' · 6 → ' . implode(',', vcodes($six));
});
check('Farm::sync — RT_PID_REUSE: a planting id seen before on another bed or with another crop', function () use ($U2, $T) {
    $uid = (int) $U2['id'];
    $p = pid();
    $a = fresh($U2, $T);
    $a->rtfarm->beds->RB3 = bed('CROP_BEAN', $p, $T);
    Tfm\Farm::sync($uid, cl($a), null, $T, 1);
    $moved = cl($a); unset($moved->rtfarm->beds->RB3); $moved->rtfarm->beds->RB4 = bed('CROP_BEAN', $p, $T);
    $other = cl($a); $other->rtfarm->beds->RB3 = bed('CROP_CORN', $p, $T);
    $m = Tfm\Farm::plan($uid, $moved, cl($a), $T + 1000, 1);
    $o = Tfm\Farm::plan($uid, $other, cl($a), $T + 1000, 1);
    return in_array('RT_PID_REUSE', vcodes($m), true) && in_array('RT_PID_REUSE', vcodes($o), true) ? true : 'moved: ' . implode(',', vcodes($m)) . ' · other crop: ' . implode(',', vcodes($o));
});
check('Farm::sync — a planting pulled out without a harvest (뽑기) → row cleared, no reward', function () use ($U2, $T) {
    $uid = (int) $U2['id'];
    $p = pid();
    $a = fresh($U2, $T);
    $a->rtfarm->beds->RB4 = bed('CROP_RADISH', $p, $T);
    Tfm\Farm::sync($uid, cl($a), null, $T, 1);
    $b = cl($a); unset($b->rtfarm->beds->RB4);
    $r = Tfm\Farm::sync($uid, $b, cl($a), $T + 5000, 1);
    return $r['ok'] && $r['harvests'] === 0 && $r['explain'] === ['value' => 0, 'exp' => 0] && row($uid, $p)['status'] === 'cleared' ? true : json_encode(row($uid, $p));
});
check('Farm::sync — tier 2 halves the time: a mint planted at tier 2 is ready after 5 minutes', function () use ($T) {
    $u = newUser();
    $p = pid();
    $a = fresh($u, $T);
    $a->rtfarm->beds->RB1 = bed('CROP_MINT', $p, $T, ['tier' => 2]);
    Tfm\Farm::sync((int) $u['id'], cl($a), null, $T, 2);
    $row = row((int) $u['id'], $p);
    return (int) $row['ready_at'] === $T + 300000 && (int) $row['tier'] === 2 ? true : json_encode($row);
});
check('Farm::sync — (5) a tier change re-times a growing row: 500 s left at tier 1 → 250 s at tier 2', function () use ($T) {
    $u = newUser();
    $uid = (int) $u['id'];
    $p = pid();
    $a = fresh($u, $T);
    $a->rtfarm->beds->RB1 = bed('CROP_MINT', $p, $T);
    Tfm\Farm::sync($uid, cl($a), null, $T, 1);
    $r = Tfm\Farm::sync($uid, cl($a), cl($a), $T + 100000, 2);
    $row = row($uid, $p);
    return $r['ok'] && (int) $row['ready_at'] === $T + 100000 + 250000 && (int) $row['tier'] === 2 ? true : json_encode($row);
});
check('Farm::sync — (6) a row whose ready_at has passed becomes ready on the next save', function () use ($T) {
    $u = newUser();
    $uid = (int) $u['id'];
    $p = pid();
    $a = fresh($u, $T);
    $a->rtfarm->beds->RB2 = bed('CROP_MINT', $p, $T);
    Tfm\Farm::sync($uid, cl($a), null, $T, 1);
    Tfm\Farm::sync($uid, cl($a), cl($a), $T + 600001, 1);
    return row($uid, $p)['status'] === 'ready' && Tfm\Farm::view($uid, 1, $T + 600001)['beds']['RB2']['status'] === 'ready' ? true : json_encode(row($uid, $p));
});
check('Farm::sync — a progress reset (fresh state, no previous save) clears the plantings the server still had', function () use ($T) {
    $u = newUser();
    $uid = (int) $u['id'];
    $p = pid();
    $a = fresh($u, $T);
    $a->rtfarm->beds->RB1 = bed('CROP_MINT', $p, $T);
    Tfm\Farm::sync($uid, cl($a), null, $T, 1);
    $r = Tfm\Farm::sync($uid, fresh($u, $T + 9000), null, $T + 9000, 1);
    return $r['ok'] && row($uid, $p)['status'] === 'cleared' ? true : implode(',', vcodes($r)) . ' ' . json_encode(row($uid, $p));
});
check('Farm::sync — an operator-restored copy that still shows a harvested bed is tolerated (no RT_PID_REUSE), and cannot be harvested twice', function () use ($U2, $s1, $h1, $T, $X) {
    // the stored copy ($s1, restored by the operator) still has the mint that the server already saw harvested
    $r = Tfm\Farm::plan((int) $U2['id'], cl($s1), cl($s1), $T + 900000, 1);
    $twice = Tfm\Farm::plan((int) $U2['id'], cl($h1), cl($s1), $T + 900000, 1);
    return $r['ok'] && row((int) $U2['id'], $X)['status'] === 'harvested' && in_array('RT_HARVEST_COUNT', vcodes($twice), true)
        ? true : 'restored: ' . implode(',', vcodes($r)) . ' · harvest again: ' . implode(',', vcodes($twice));
});
check('Farm::sync — (7) quick plots are mirrored: one row per planting (pid = String(plantedAt)), growth, ready at 100, harvested when gone', function () use ($T) {
    $u = newUser();
    $uid = (int) $u['id'];
    $a = fresh($u, $T);
    $planted = (int) $a->farm->plots->P1->plantedAt;
    Tfm\Farm::sync($uid, cl($a), null, $T, 1);
    $r0 = Tfm\Db::one("SELECT * FROM farm_beds WHERE user_id = ? AND kind = 'plot' AND bed_id = 'P1'", [$uid]);
    $b = cl($a); $b->farm->plots->P1->growth = 100;
    Tfm\Farm::sync($uid, cl($b), cl($a), $T + 60000, 1);
    $r1 = Tfm\Db::one("SELECT * FROM farm_beds WHERE user_id = ? AND kind = 'plot' AND bed_id = 'P1'", [$uid]);
    $c = cl($b); $c->farm->plots->P1 = (object) ['cropId' => null, 'growth' => 0, 'water' => 40, 'health' => 100, 'plantedAt' => 0, 'lastUpdate' => $T, 'lastWaterAt' => 0, 'harvests' => 1];
    Tfm\Farm::sync($uid, cl($c), cl($b), $T + 70000, 1);
    $r2 = Tfm\Db::one("SELECT * FROM farm_beds WHERE user_id = ? AND kind = 'plot' AND bed_id = 'P1'", [$uid]);
    $n = (int) Tfm\Db::value("SELECT COUNT(*) FROM farm_beds WHERE user_id = ? AND kind = 'plot'", [$uid]);
    return $r0 && $r0['pid'] === (string) $planted && (int) $r0['growth'] === 65 && $r0['status'] === 'growing' && $r0['crop_id'] === 'CROP_BEAN'
        && $r1['status'] === 'ready' && (int) $r1['growth'] === 100 && $r2['status'] === 'harvested' && (int) $r2['harvested_at'] === $T + 70000 && $n === 2
        ? true : json_encode([$r0, $r1, $r2, $n]);
});
check('Farm::plotPid — String(Math.round(plantedAt)) like 42-realfarm.js; nothing for 0, negatives, text or NaN', function () {
    return Tfm\Farm::plotPid(1731400000000) === '1731400000000' && Tfm\Farm::plotPid(1731400000000.5) === '1731400000001' && Tfm\Farm::plotPid(1731400000000.4) === '1731400000000'
        && Tfm\Farm::plotPid(0) === null && Tfm\Farm::plotPid(-5) === null && Tfm\Farm::plotPid('1731400000000') === null && Tfm\Farm::plotPid(NAN) === null && Tfm\Farm::plotPid(1e16) === null;
});
check('Farm::sync — (7) a quick plot emptied without a harvest → cleared; a herb regrown (new plantedAt) → a new row', function () use ($T) {
    $u = newUser();
    $uid = (int) $u['id'];
    $a = fresh($u, $T);
    Tfm\Farm::sync($uid, cl($a), null, $T, 1);
    $b = cl($a);
    $b->farm->plots->P6 = (object) ['cropId' => null, 'growth' => 0, 'water' => 40, 'health' => 100, 'plantedAt' => 0, 'lastUpdate' => $T, 'lastWaterAt' => 0, 'harvests' => 0];
    $b->farm->plots->P1->plantedAt = $T - 1000;
    $b->farm->plots->P1->growth = 30;
    $b->farm->plots->P1->harvests = 1;
    Tfm\Farm::sync($uid, cl($b), cl($a), $T + 5000, 1);
    $p6 = Tfm\Db::one("SELECT status FROM farm_beds WHERE user_id = ? AND kind = 'plot' AND bed_id = 'P6'", [$uid]);
    $p1 = Tfm\Db::all("SELECT pid, status FROM farm_beds WHERE user_id = ? AND kind = 'plot' AND bed_id = 'P1' ORDER BY id", [$uid]);
    return $p6['status'] === 'cleared' && count($p1) === 2 && $p1[0]['status'] === 'harvested' && $p1[1]['pid'] === (string) ($T - 1000) && $p1[1]['status'] === 'growing'
        ? true : json_encode([$p6, $p1]);
});
check('Farm::sync — (8) the 곳간 is mirrored into farm_storage on every accepted save (added, changed and removed items)', function () use ($T) {
    $u = newUser();
    $uid = (int) $u['id'];
    $a = fresh($u, $T);
    $a->storage->items = (object) ['ITEM_MINT' => 4, 'ITEM_BEAN' => 2];
    Tfm\Farm::sync($uid, cl($a), null, $T, 1);
    $m1 = Tfm\Db::all('SELECT item_id, qty FROM farm_storage WHERE user_id = ? ORDER BY item_id', [$uid]);
    $b = cl($a);
    $b->storage->items = (object) ['ITEM_MINT' => 1, 'ITEM_KIMCHI' => 3];
    Tfm\Farm::sync($uid, cl($b), cl($a), $T + 1000, 1);
    $m2 = Tfm\Db::all('SELECT item_id, qty FROM farm_storage WHERE user_id = ? ORDER BY item_id', [$uid]);
    $norm = function (array $rows) { $o = []; foreach ($rows as $r) $o[$r['item_id']] = (int) $r['qty']; return $o; };
    return $norm($m1) === ['ITEM_BEAN' => 2, 'ITEM_MINT' => 4] && $norm($m2) === ['ITEM_KIMCHI' => 3, 'ITEM_MINT' => 1] ? true : json_encode([$m1, $m2]);
});
check('Farm::sync — a refused farm check writes nothing (no planting row, no mirror change)', function () use ($T) {
    $u = newUser();
    $uid = (int) $u['id'];
    $a = fresh($u, $T);
    $a->rtfarm->beds->RB1 = bed('CROP_MINT', pid(), $T);
    $a->storage->items = (object) ['ITEM_MINT' => 4];
    $a->stats->rtHarvests = 3;   // harvests the server never saw
    $r = Tfm\Farm::sync($uid, cl($a), null, $T, 1);
    $rows = (int) Tfm\Db::value('SELECT COUNT(*) FROM farm_beds WHERE user_id = ?', [$uid]);
    $st = (int) Tfm\Db::value('SELECT COUNT(*) FROM farm_storage WHERE user_id = ?', [$uid]);
    return !$r['ok'] && vcodes($r) === ['RT_HARVEST_COUNT'] && $rows === 0 && $st === 0 ? true : implode(',', vcodes($r)) . " rows=$rows storage=$st";
});
check('Farm::plan as the SaveValidator hook — a validated corn harvest passes the economy check; the same harvest early is refused', function () use ($T) {
    $u = newUser();
    $uid = (int) $u['id'];
    $p = pid();
    $a = fresh($u, $T);
    $first = Tfm\SaveValidator::validate(cl($a), null, [], $u, $T - 1000, $T, 1, null);
    $a2 = cl($a);
    $a2->rtfarm->beds->RB1 = bed('CROP_CORN', $p, $T);
    $hook = function ($t) use ($uid) { return function ($n, $pp) use ($uid, $t) { return Tfm\Farm::plan($uid, $n, $pp, $t, 1); }; };
    $planted = Tfm\SaveValidator::validate(cl($a2), cl($a), $first['meta'], $u, $T, $T + 1000, 1, $hook($T + 1000));
    Tfm\Farm::sync($uid, cl($a2), cl($a), $T + 1000, 1);
    $h = harvested($a2, 'RB1', 5, 3, $T);
    $h->storage->items = (object) ['ITEM_CORN' => 5];
    $h->stats->coin += 250; $h->stats->level = 2; $h->stats->exp = 200;
    $early = Tfm\SaveValidator::validate(cl($h), cl($a2), $planted['meta'], $u, $T + 1000, $T + 2000, 1, $hook($T + 2000));
    $late = Tfm\SaveValidator::validate(cl($h), cl($a2), $planted['meta'], $u, $T + 1000, $T + 1000 + 28800000, 1, $hook($T + 1000 + 28800000));
    return $planted['ok'] && !$early['ok'] && in_array('RT_HARVEST_TOO_EARLY', codes($early), true) && $late['ok'] && $late['summary']['rt'] === ['harvests' => 1, 'value' => 250 + 5 * 50, 'exp' => 320]
        ? true : 'planted ' . implode(',', codes($planted)) . ' · early ' . implode(',', codes($early)) . ' · late ' . implode(',', codes($late)) . ' ' . json_encode($late['summary']['rt']);
});

// =============================================================================================== 3 · completion requests (재배 완료 확인)
/** a user with one real-time planting synced at $t (ready at $t + duration) — returns [user, state, pid] */
function planted(string $crop, string $bedId, int $t, int $tier = 1): array
{
    $u = newUser();
    $p = pid();
    $s = fresh($u, $t);
    $s->rtfarm->beds->$bedId = bed($crop, $p, $t, ['care' => 80]);
    Tfm\Farm::sync((int) $u['id'], cl($s), null, $t, $tier);
    return [$u, $s, $p];
}
/** store $s as the account's accepted save (what player/save.php would have written) */
function storeSave(array $u, stdClass $s, int $t): void
{
    Tfm\Db::upsert('player_saves', ['user_id' => (int) $u['id'], 'version' => 1, 'revision' => 1, 'data' => json_encode($s, JSON_UNESCAPED_UNICODE),
        'checksum' => '', 'size_bytes' => 0, 'meta' => '{}', 'backup_data' => null, 'backup_saved_at' => 0, 'saved_at' => $t, 'created_at' => $t,
        'rejects' => 0, 'last_reject_at' => 0], ['user_id']);
}
$TR = Tfm\Clock::ms();
list($RU, $RS, $RP) = planted('CROP_MINT', 'RB1', $TR - 600000 - 1000);
$rep = null;
check('Farm::report — a bed the SERVER clock calls ready (ready_at passed, row not flipped yet) → a pending report; crop / stars from the server records', function () use (&$rep, $RU, $RP) {
    $rep = Tfm\Farm::report($RU, 'rt', 'RB1', $RP, '');
    $row = Tfm\Db::one('SELECT * FROM crop_reports WHERE id = ?', [$rep['id']]);
    return $rep['status'] === 'pending' && $rep['kind'] === 'rt' && $rep['bedId'] === 'RB1' && $rep['cropId'] === 'CROP_MINT' && $rep['stars'] === 3
        && $rep['note'] === '' && $rep['memo'] === '' && $rep['decidedAt'] === 0 && $rep['photoUrl'] === null && is_int($rep['requestedAt'])
        && $row && (int) $row['user_id'] === (int) $RU['id'] && $row['pid'] === $RP ? true : json_encode([$rep, $row]);
});
check('Farm::report — the same planting again → 409 ALREADY_REPORTED', function () use ($RU, $RP) {
    return apiCode(function () use ($RU, $RP) { Tfm\Farm::report($RU, 'rt', 'RB1', $RP, ''); }) === '409 ALREADY_REPORTED';
});
check('Farm::report — a growing bed (ready_at in the future) → 409 NOT_READY, nothing stored', function () {
    list($u, $s, $p) = planted('CROP_CORN', 'RB2', Tfm\Clock::ms());
    $code = apiCode(function () use ($u, $p) { Tfm\Farm::report($u, 'rt', 'RB2', $p, ''); });
    return $code === '409 NOT_READY' && (int) Tfm\Db::value('SELECT COUNT(*) FROM crop_reports WHERE user_id = ?', [(int) $u['id']]) === 0 ? true : $code;
});
check('Farm::report — another account\'s planting id → 409 NOT_READY (the same answer as a growing bed: no way to probe other accounts), nothing stored', function () use ($RP) {
    list($other, $s, $p) = planted('CROP_MINT', 'RB3', Tfm\Clock::ms() - 700000);
    $mine = apiCode(function () use ($other, $RP) { Tfm\Farm::report($other, 'rt', 'RB1', $RP, ''); });
    return $mine === '409 NOT_READY' && (int) Tfm\Db::value('SELECT COUNT(*) FROM crop_reports WHERE user_id = ?', [(int) $other['id']]) === 0 ? true : $mine;
});
check('Farm::report — a harvest within farm.harvest_keep_days (7) may still be reported; an older one → NOT_READY', function () {
    $u = newUser();
    $now = Tfm\Clock::ms();
    $ins = function (string $bed, string $p, int $harvestedAt) use ($u) {
        Tfm\Db::insert('farm_beds', ['user_id' => (int) $u['id'], 'bed_id' => $bed, 'kind' => 'rt', 'pid' => $p, 'crop_id' => 'CROP_BEAN', 'tier' => 1, 'first_seen_at' => $harvestedAt - 3600000,
            'ready_at' => $harvestedAt - 1000, 'growth' => 0, 'care' => 40, 'status' => 'harvested', 'harvested_at' => $harvestedAt, 'amount' => 5, 'stars' => 2, 'updated_at' => $harvestedAt]);
    };
    $fresh = pid(); $old = pid();
    $ins('RB1', $fresh, $now - 6 * 86400000);
    $ins('RB2', $old, $now - 8 * 86400000);
    $r = Tfm\Farm::report($u, 'rt', 'RB1', $fresh, '');
    $o = apiCode(function () use ($u, $old) { Tfm\Farm::report($u, 'rt', 'RB2', $old, ''); });
    return $r['status'] === 'pending' && $r['amount'] === 5 && $r['stars'] === 2 && $o === '409 NOT_READY' ? true : json_encode($r) . " old=$o";
});
check('Farm::report — the note is cleaned, PII-masked and bad-word-filtered like chat, and capped at farm.report_note_max', function () {
    list($u, $s, $p) = planted('CROP_MINT', 'RB4', Tfm\Clock::ms() - 700000);
    $r = Tfm\Farm::report($u, 'rt', 'RB4', $p, "  물을 줬어요\u{200B} 010-1234-5678 시발 kid@example.com  ");
    $stored = (string) Tfm\Db::value('SELECT note FROM crop_reports WHERE id = ?', [$r['id']]);
    $long = planted('CROP_MINT', 'RB1', Tfm\Clock::ms() - 700000);
    $l = Tfm\Farm::report($long[0], 'rt', 'RB1', $long[2], str_repeat('가', 200));
    return $stored === $r['note'] && strpos($stored, '010') === false && strpos($stored, '1234') === false && strpos($stored, 'example.com') === false && strpos($stored, '시발') === false
        && strpos($stored, '🔒') !== false && strpos($stored, '물을 줬어요') === 0 && mb_strlen($l['note']) === (int) Tfm\Config::get('farm.report_note_max', 80)
        ? true : json_encode([$stored, mb_strlen($l['note'])], JSON_UNESCAPED_UNICODE);
});
check('Farm::report — farm.report_daily per account per day → 429 REPORT_LIMIT (+ Retry-After)', function () {
    Tfm\Config::override('farm.report_daily', 2);
    try {
        $u = newUser();
        $t = Tfm\Clock::ms() - 700000;
        $s = fresh($u, $t);
        $ps = [];
        foreach (['RB1', 'RB2', 'RB3'] as $b) { $ps[$b] = pid(); $s->rtfarm->beds->$b = bed('CROP_MINT', $ps[$b], $t); }
        Tfm\Farm::sync((int) $u['id'], cl($s), null, $t, 1);
        Tfm\Farm::report($u, 'rt', 'RB1', $ps['RB1'], '');
        Tfm\Farm::report($u, 'rt', 'RB2', $ps['RB2'], '');
        $headers = [];
        try { Tfm\Farm::report($u, 'rt', 'RB3', $ps['RB3'], ''); $code = ''; } catch (Tfm\ApiException $e) { $code = $e->status . ' ' . $e->errorCode; $headers = $e->headers; }
        $retry = (bool) array_filter($headers, function ($h) { return preg_match('/^Retry-After: [1-9]\d*$/', $h) === 1; });
        return $code === '429 REPORT_LIMIT' && $retry ? true : $code . ' ' . json_encode($headers);
    } finally {
        Tfm\Config::override('farm.report_daily', null);
    }
});
check('Farm::report — a quick plot at 100 % in the stored save (no mirror row) → accepted; at 96 % → NOT_READY', function () {
    $u = newUser();
    $t = Tfm\Clock::ms();
    $s = fresh($u, $t);
    $s->farm->plots->P1->growth = 100;
    storeSave($u, $s, $t);
    $ok = Tfm\Farm::report($u, 'plot', 'P1', (string) $s->farm->plots->P1->plantedAt, '');
    $no = apiCode(function () use ($u, $s) { Tfm\Farm::report($u, 'plot', 'P6', (string) $s->farm->plots->P6->plantedAt, ''); });
    $wrong = apiCode(function () use ($u, $s) { Tfm\Farm::report($u, 'plot', 'P1', (string) ($s->farm->plots->P1->plantedAt + 1), ''); });
    return $ok['kind'] === 'plot' && $ok['cropId'] === 'CROP_BEAN' && $ok['status'] === 'pending' && $no === '409 NOT_READY' && $wrong === '409 ALREADY_REPORTED' || ($ok['kind'] === 'plot' && $no === '409 NOT_READY' && $wrong === '409 NOT_READY')
        ? true : json_encode($ok) . " P6=$no wrongPid=$wrong";
});
check('Farm::report — a quick plot the mirror saw at 100 % (ready row) → accepted without looking at the save', function () {
    $u = newUser();
    $t = Tfm\Clock::ms();
    $s = fresh($u, $t);
    $s->farm->plots->P1->growth = 100;
    Tfm\Farm::sync((int) $u['id'], cl($s), null, $t, 1);
    $r = Tfm\Farm::report($u, 'plot', 'P1', (string) $s->farm->plots->P1->plantedAt, '');
    return $r['status'] === 'pending' && $r['bedId'] === 'P1' ? true : json_encode($r);
});
check('Farm::report — kind / bedId / pid of the wrong shape → 400 INVALID_INPUT (nothing looked up)', function () use ($RU) {
    $bad = [];
    foreach ([['field', 'RB1', pid()], ['rt', 'RB9', pid()], ['rt', 'RB1', 'nothex'], ['rt', '<b>', pid()], ['plot', 'P1', 'abc'], ['plot', str_repeat('P', 17), '123'], ['plot', 'P1', '12345678901234567']] as $c) {
        $code = apiCode(function () use ($RU, $c) { Tfm\Farm::report($RU, $c[0], $c[1], $c[2], ''); });
        if ($code !== '400 INVALID_INPUT') $bad[] = implode('/', $c) . " → $code";
    }
    return $bad ? implode(' | ', $bad) : true;
});
check('Farm::reports — the caller\'s own reports only (newest first, ≤ 50) with unseen = decided but not yet seen', function () use ($RU, $rep) {
    $list = Tfm\Farm::reports((int) $RU['id']);
    $other = Tfm\Farm::reports((int) newUser()['id']);
    Tfm\Db::exec("UPDATE crop_reports SET status = 'approved', memo = '잘 키웠어요', decided_at = ?, seen_at = 0 WHERE id = ?", [Tfm\Clock::ms(), $rep['id']]);
    $after = Tfm\Farm::reports((int) $RU['id']);
    return count($list['reports']) === 1 && $list['reports'][0]['id'] === $rep['id'] && $list['unseen'] === 0 && $other['reports'] === [] && $other['unseen'] === 0
        && $after['unseen'] === 1 && $after['reports'][0]['status'] === 'approved' && $after['reports'][0]['memo'] === '잘 키웠어요'
        ? true : json_encode([$list, $other, $after], JSON_UNESCAPED_UNICODE);
});
check('Farm::markSeen — marks only the caller\'s decided reports; another account\'s ids and pending ones stay untouched', function () use ($RU, $rep) {
    $intruder = newUser();
    $n0 = Tfm\Farm::markSeen((int) $intruder['id'], [$rep['id']]);
    $still = (int) Tfm\Db::value('SELECT seen_at FROM crop_reports WHERE id = ?', [$rep['id']]);
    list($u, $s, $p) = planted('CROP_MINT', 'RB2', Tfm\Clock::ms() - 700000);
    $pending = Tfm\Farm::report($u, 'rt', 'RB2', $p, '');
    $n1 = Tfm\Farm::markSeen((int) $u['id'], [$pending['id']]);
    $n2 = Tfm\Farm::markSeen((int) $RU['id'], [$rep['id'], $rep['id'], 999999999]);
    return $n0 === 0 && $still === 0 && $n1 === 0 && $n2 === 1 && (int) Tfm\Db::value('SELECT seen_at FROM crop_reports WHERE id = ?', [$rep['id']]) > 0 && Tfm\Farm::reports((int) $RU['id'])['unseen'] === 0
        ? true : "intruder=$n0 still=$still pending=$n1 own=$n2";
});
check('Farm::photoTarget / setPhoto — own pending report only (another account / a decided one → 404 NOT_FOUND); one photo per report (409 PHOTO_EXISTS)', function () use ($RU, $rep) {
    list($u, $s, $p) = planted('CROP_MINT', 'RB3', Tfm\Clock::ms() - 700000);
    $mine = Tfm\Farm::report($u, 'rt', 'RB3', $p, '');
    $foreign = apiCode(function () use ($RU, $mine) { Tfm\Farm::photoTarget((int) $RU['id'], $mine['id']); });
    $decided = apiCode(function () use ($RU, $rep) { Tfm\Farm::photoTarget((int) $RU['id'], $rep['id']); });
    $row = Tfm\Farm::photoTarget((int) $u['id'], $mine['id']);
    Tfm\Farm::setPhoto((int) $u['id'], $mine['id'], 'uploads/reports/2026/11/' . str_repeat('a', 32) . '.jpg');
    $again = apiCode(function () use ($u, $mine) { Tfm\Farm::photoTarget((int) $u['id'], $mine['id']); });
    $twice = apiCode(function () use ($u, $mine) { Tfm\Farm::setPhoto((int) $u['id'], $mine['id'], 'uploads/reports/2026/11/' . str_repeat('b', 32) . '.jpg'); });
    $list = Tfm\Farm::reports((int) $u['id'])['reports'][0];
    return $foreign === '404 NOT_FOUND' && $decided === '404 NOT_FOUND' && (int) $row['id'] === $mine['id'] && $again === '409 PHOTO_EXISTS' && $twice === '409 PHOTO_EXISTS'
        && $list['photoUrl'] === 'uploads/reports/2026/11/' . str_repeat('a', 32) . '.jpg'
        ? true : "foreign=$foreign decided=$decided again=$again twice=$twice url=" . json_encode($list['photoUrl']);
});
check('Farm::state — {scale, tier, beds:[rt + plot rows], storage:{items, total, cap}, reports:{pending, unseen}} of the caller only', function () {
    $u = newUser();
    $t = Tfm\Clock::ms() - 700000;
    $s = fresh($u, $t);
    $p = pid();
    $s->rtfarm->beds->RB1 = bed('CROP_MINT', $p, $t);
    $s->storage->items = (object) ['ITEM_MINT' => 4, 'ITEM_KIMCHI' => 2];
    Tfm\Farm::sync((int) $u['id'], cl($s), null, $t, 1);
    Tfm\Farm::report($u, 'rt', 'RB1', $p, '');
    $st = Tfm\Farm::state((int) $u['id'], 1);
    $kinds = array_count_values(array_map(function ($b) { return $b['kind']; }, $st['beds']));
    $rb1 = array_values(array_filter($st['beds'], function ($b) { return $b['bedId'] === 'RB1'; }))[0] ?? null;
    return $st['scale'] === 1.0 && $st['tier'] === 1 && ($kinds['rt'] ?? 0) === 1 && ($kinds['plot'] ?? 0) === 2 && $rb1 && $rb1['status'] === 'ready' && $rb1['pid'] === $p
        && $st['storage'] === ['items' => ['ITEM_KIMCHI' => 2, 'ITEM_MINT' => 4], 'total' => 6, 'cap' => 300] && $st['reports'] === ['pending' => 1, 'unseen' => 0]
        ? true : json_encode($st, JSON_UNESCAPED_UNICODE);
});

// =============================================================================================== 4 · the admin site API (interface 4)
$TA = Tfm\Clock::ms();
$A1 = newUser(); $A2 = newUser();
$a1 = fresh($A1, $TA - 700000);
$a1p = pid(); $a1q = pid();
$a1->rtfarm->beds->RB1 = bed('CROP_MINT', $a1p, $TA - 700000, ['care' => 80]);   // ready by the clock
$a1->rtfarm->beds->RB2 = bed('CROP_CORN', $a1q, $TA - 700000);                   // growing for hours
$a1->storage->items = (object) ['ITEM_MINT' => 5, 'ITEM_DOENJANG' => 1];
Tfm\Farm::sync((int) $A1['id'], cl($a1), null, $TA - 700000, 1);
$a2 = fresh($A2, $TA);
$a2->storage->items = (object) ['ITEM_MINT' => 2];
Tfm\Farm::sync((int) $A2['id'], cl($a2), null, $TA, 1);
$adminRep = Tfm\Farm::report($A1, 'rt', 'RB1', $a1p, '쑥쑥 자라서 기뻐요!');
check('Farm::listBeds — every account\'s beds with nickname, crop name, server times, live status, ★ and the request status; filters', function () use ($A1, $A2, $a1p, $a1q, $TA) {
    $mine = Tfm\Farm::listBeds(['userId' => (int) $A1['id']], 50, 0);
    $byPid = [];
    foreach ($mine as $r) $byPid[$r['pid']] = $r;
    $m = $byPid[$a1p] ?? null; $c = $byPid[$a1q] ?? null;
    if (!$m || !$c) return 'rows missing: ' . json_encode(array_keys($byPid));
    $ok = $m['nickname'] === $A1['nickname'] && $m['userId'] === (int) $A1['id'] && $m['cropName'] === '박하' && $m['status'] === 'ready' && $m['stars'] === 3 && $m['report'] === 'pending'
        && $m['firstSeenAt'] === $TA - 700000 && $m['readyAt'] === $TA - 100000 && $m['leftMs'] === 0 && $c['status'] === 'growing' && $c['leftMs'] > 27000000 && $c['cropName'] === '옥수수' && $c['report'] === '';
    $ready = Tfm\Farm::listBeds(['userId' => (int) $A1['id'], 'status' => 'ready', 'kind' => 'rt'], 50, 0);
    $growing = Tfm\Farm::listBeds(['userId' => (int) $A1['id'], 'status' => 'growing', 'kind' => 'rt'], 50, 0);
    $plots = Tfm\Farm::listBeds(['userId' => (int) $A2['id'], 'kind' => 'plot'], 50, 0);
    $byNick = Tfm\Farm::listBeds(['q' => mb_strtoupper($A2['nickname'])], 50, 0);
    $byId = Tfm\Farm::listBeds(['q' => '#' . $A2['id']], 50, 0);
    $sqli = Tfm\Farm::listBeds(['q' => "' OR 1=1 --", 'status' => "active' OR '1'='1", 'kind' => 'rt; DROP TABLE farm_beds'], 50, 0);
    $page = Tfm\Farm::listBeds(['userId' => (int) $A1['id']], 1, 1);
    $ok = $ok && count($ready) === 1 && $ready[0]['pid'] === $a1p && count($growing) === 1 && $growing[0]['pid'] === $a1q && count($plots) === 2 && $plots[0]['kind'] === 'plot'
        && $byNick && count(array_filter($byNick, function ($r) use ($A2) { return $r['userId'] !== (int) $A2['id']; })) === 0 && count($byId) === count($plots)
        && $sqli === [] && count($page) === 1 && (int) Tfm\Db::value('SELECT COUNT(*) FROM farm_beds') > 0;
    return $ok ? true : json_encode(['m' => $m, 'c' => $c, 'ready' => count($ready), 'growing' => count($growing), 'plots' => count($plots), 'nick' => count($byNick), 'id' => count($byId), 'sqli' => count($sqli), 'page' => count($page)], JSON_UNESCAPED_UNICODE);
});
check('Farm::listStorage / storageTotals — the 곳간 per account (items, names, total, cap) and the totals per item', function () use ($A1, $A2) {
    $rows = Tfm\Farm::listStorage(50, 0, $A1['nickname']);
    $r = $rows[0] ?? null;
    $tot = [];
    foreach (Tfm\Farm::storageTotals() as $t) $tot[$t['itemId']] = $t;
    $none = Tfm\Farm::listStorage(50, 0, "%' UNION SELECT 1 --");
    return count($rows) === 1 && $r['userId'] === (int) $A1['id'] && $r['nickname'] === $A1['nickname'] && $r['items'] === ['ITEM_DOENJANG' => 1, 'ITEM_MINT' => 5] && $r['total'] === 6 && $r['cap'] === 300
        && $r['itemList'][1] === ['itemId' => 'ITEM_MINT', 'name' => '박하', 'qty' => 5] && isset($tot['ITEM_MINT']) && $tot['ITEM_MINT']['qty'] >= 7 && $tot['ITEM_MINT']['accounts'] >= 2 && $tot['ITEM_MINT']['name'] === '박하' && $none === []
        ? true : json_encode([$rows, $tot['ITEM_MINT'] ?? null, $none], JSON_UNESCAPED_UNICODE);
});
check('Farm::listReports / countReports — pending first with the account, crop, bed times measured by the server and the note; status filter and search', function () use ($A1, $adminRep, $a1p, $TA) {
    $all = Tfm\Farm::listReports('', 500, 0, '');
    $pendingFirst = true; $seenDecided = false;
    foreach ($all as $r) { if ($r['status'] !== 'pending') $seenDecided = true; elseif ($seenDecided) $pendingFirst = false; }
    $mine = Tfm\Farm::listReports('pending', 50, 0, $A1['nickname']);
    $r = $mine[0] ?? null;
    $counts = Tfm\Farm::countReports();
    return $pendingFirst && count($mine) === 1 && $r['id'] === $adminRep['id'] && $r['nickname'] === $A1['nickname'] && $r['cropName'] === '박하' && $r['bedId'] === 'RB1' && $r['note'] === '쑥쑥 자라서 기뻐요!'
        && $r['firstSeenAt'] === $TA - 700000 && $r['readyAt'] === $TA - 100000 && $r['status'] === 'pending' && $r['hasPhoto'] === false && $r['decidedByNick'] === ''
        && Tfm\Farm::listReports('approved', 50, 0, $A1['nickname']) === [] && array_keys($counts) === ['pending', 'approved', 'rejected'] && $counts['pending'] >= 1
        ? true : json_encode([$pendingFirst, $r, $counts], JSON_UNESCAPED_UNICODE);
});
check('Farm::decide — approve with a memo (PII-masked, bad words masked): decided_at / decided_by set, audit crop_report_decided, the child sees it (unseen)', function () use ($ADM, $A1, $adminRep) {
    $r = Tfm\Farm::decide($ADM, $adminRep['id'], 'approved', '참 잘했어요! 010-9876-5432 로 연락 시발');
    $row = Tfm\Db::one('SELECT * FROM crop_reports WHERE id = ?', [$adminRep['id']]);
    $audit = (int) Tfm\Db::value("SELECT COUNT(*) FROM audit_log WHERE event = 'crop_report_decided' AND actor_id = ? AND user_id = ?", [(int) $ADM['id'], (int) $A1['id']]);
    $kid = Tfm\Farm::reports((int) $A1['id']);
    return $r['status'] === 'approved' && $r['decidedAt'] > 0 && $r['decidedBy'] === (int) $ADM['id'] && $r['decidedByNick'] === $ADM['nickname'] && strpos($r['memo'], '9876') === false && strpos($r['memo'], '시발') === false
        && strpos($r['memo'], '참 잘했어요!') === 0 && $row['status'] === 'approved' && (int) $row['decided_by'] === (int) $ADM['id'] && (int) $row['seen_at'] === 0 && $audit === 1 && $kid['unseen'] === 1 && $kid['reports'][0]['memo'] === $r['memo']
        ? true : json_encode([$r, $audit, $kid['unseen']], JSON_UNESCAPED_UNICODE);
});
check('Farm::decide — a decided report can get its memo edited (the stamp time stays); a changed decision gets a new stamp', function () use ($ADM, $A1, $adminRep) {
    $before = (int) Tfm\Db::value('SELECT decided_at FROM crop_reports WHERE id = ?', [$adminRep['id']]);
    Tfm\Farm::markSeen((int) $A1['id'], [$adminRep['id']]);
    usleep(2000);
    $e = Tfm\Farm::decide($ADM, $adminRep['id'], 'approved', '메모를 고쳤어요. 다음에도 또 키워요!');
    $after = Tfm\Db::one('SELECT decided_at, memo, seen_at, status FROM crop_reports WHERE id = ?', [$adminRep['id']]);
    $back = Tfm\Farm::decide($ADM, $adminRep['id'], 'rejected', '사진을 다시 찍어 볼까요?');
    $audits = (int) Tfm\Db::value("SELECT COUNT(*) FROM audit_log WHERE event = 'crop_report_decided' AND user_id = ?", [(int) $A1['id']]);
    return (int) $after['decided_at'] === $before && $after['memo'] === '메모를 고쳤어요. 다음에도 또 키워요!' && (int) $after['seen_at'] === 0 && $after['status'] === 'approved' && $e['memo'] === $after['memo']
        && $back['status'] === 'rejected' && $back['decidedAt'] >= $before && $back['memo'] === '사진을 다시 찍어 볼까요?' && $audits === 3
        ? true : json_encode([$before, $after, $back, $audits], JSON_UNESCAPED_UNICODE);
});
check('Farm::decide — refused: a player (403), an unknown status (400), an over-long memo (400), an unknown report (404)', function () use ($ADM, $A1, $adminRep) {
    $player = apiCode(function () use ($A1, $adminRep) { Tfm\Farm::decide($A1, $adminRep['id'], 'approved', 'x'); });
    $status = apiCode(function () use ($ADM, $adminRep) { Tfm\Farm::decide($ADM, $adminRep['id'], 'pending', 'x'); });
    $long = apiCode(function () use ($ADM, $adminRep) { Tfm\Farm::decide($ADM, $adminRep['id'], 'approved', str_repeat('가', (int) Tfm\Config::get('farm.memo_max', 500) + 1)); });
    $none = apiCode(function () use ($ADM) { Tfm\Farm::decide($ADM, 987654321, 'approved', 'x'); });
    return $player === '403 FORBIDDEN' && $status === '400 INVALID_INPUT' && $long === '400 INVALID_INPUT' && $none === '404 NOT_FOUND' ? true : "player=$player status=$status long=$long none=$none";
});
check('Farm::dashboard — growing / ready / harvested today / pending requests / 곳간 total', function () {
    $d = Tfm\Farm::dashboard();
    $keys = ['growing', 'ready', 'harvestedToday', 'reportsPending', 'storageTotal'];
    foreach ($keys as $k) if (!isset($d[$k]) || !is_int($d[$k])) return "missing $k: " . json_encode($d);
    $growing = (int) Tfm\Db::value("SELECT COUNT(*) FROM farm_beds WHERE kind = 'rt' AND status = 'growing' AND ready_at > ?", [Tfm\Clock::ms()]);
    $stored = (int) Tfm\Db::value('SELECT COALESCE(SUM(qty), 0) FROM farm_storage');
    return $d['growing'] === $growing && $d['ready'] >= 1 && $d['harvestedToday'] >= 1 && $d['storageTotal'] === $stored && $d['reportsPending'] === Tfm\Farm::countReports()['pending'] ? true : json_encode($d);
});
check('Farm::photoPath — null without a photo or for a path that is not a report photo; the absolute file path otherwise', function () use ($ADM) {
    list($u, $s, $p) = planted('CROP_MINT', 'RB1', Tfm\Clock::ms() - 700000);
    $r = Tfm\Farm::report($u, 'rt', 'RB1', $p, '');
    $none = Tfm\Farm::photoPath($r['id']);
    $rel = 'uploads/reports/2026/11/' . bin2hex(random_bytes(16)) . '.jpg';
    $abs = Tfm\Config::uploadDir() . DIRECTORY_SEPARATOR . 'reports' . DIRECTORY_SEPARATOR . '2026' . DIRECTORY_SEPARATOR . '11';
    if (!is_dir($abs)) mkdir($abs, 0755, true);
    file_put_contents(Tfm\Config::uploadDir() . DIRECTORY_SEPARATOR . str_replace('/', DIRECTORY_SEPARATOR, substr($rel, 8)), "\xFF\xD8\xFF");
    Tfm\Farm::setPhoto((int) $u['id'], $r['id'], $rel);
    $path = Tfm\Farm::photoPath($r['id']);
    Tfm\Db::exec('UPDATE crop_reports SET photo = ? WHERE id = ?', ['uploads/reports/../../config/config.php', $r['id']]);
    $tampered = Tfm\Farm::photoPath($r['id']);
    @unlink(Tfm\Config::uploadDir() . DIRECTORY_SEPARATOR . str_replace('/', DIRECTORY_SEPARATOR, substr($rel, 8)));
    return $none === null && is_string($path) && substr(str_replace('\\', '/', $path), -strlen($rel) + 8) === substr($rel, 8) && $tampered === null && Tfm\Farm::photoPath(987654321) === null
        ? true : json_encode([$none, $path, $tampered]);
});

check('Farm::cleanup — finished rows older than N days go (no request refers to them); growing / ready / reported / recent rows stay', function () {
    $u = newUser();
    $uid = (int) $u['id'];
    $old = Tfm\Clock::ms() - 40 * 86400000;
    $mk = function (string $bed, string $kind, string $status, int $at) use ($uid) {
        $p = $kind === 'rt' ? pid() : (string) random_int(1000000000000, 1999999999999);
        Tfm\Db::insert('farm_beds', ['user_id' => $uid, 'bed_id' => $bed, 'kind' => $kind, 'pid' => $p, 'crop_id' => 'CROP_MINT', 'tier' => 1, 'first_seen_at' => $at, 'ready_at' => $at,
            'growth' => 100, 'care' => 0, 'status' => $status, 'harvested_at' => $status === 'harvested' ? $at : 0, 'amount' => 3, 'stars' => 1, 'updated_at' => $at]);
        return $p;
    };
    $gone1 = $mk('P1', 'plot', 'harvested', $old); $gone2 = $mk('RB1', 'rt', 'cleared', $old);
    $keepGrowing = $mk('RB2', 'rt', 'growing', $old); $keepRecent = $mk('P2', 'plot', 'harvested', Tfm\Clock::ms());
    $keepReported = $mk('RB3', 'rt', 'harvested', $old);
    Tfm\Db::insert('crop_reports', ['user_id' => $uid, 'kind' => 'rt', 'bed_id' => 'RB3', 'pid' => $keepReported, 'crop_id' => 'CROP_MINT', 'stars' => 1, 'amount' => 3, 'note' => '', 'photo' => '',
        'status' => 'approved', 'memo' => null, 'requested_at' => $old, 'decided_at' => $old, 'decided_by' => null, 'seen_at' => 0]);
    $n = Tfm\Farm::cleanup(30);
    $left = array_map(function ($r) { return $r['pid']; }, Tfm\Db::all('SELECT pid FROM farm_beds WHERE user_id = ? ORDER BY id', [$uid]));
    return $n >= 2 && !in_array($gone1, $left, true) && !in_array($gone2, $left, true) && $left === [$keepGrowing, $keepRecent, $keepReported] ? true : "removed $n, left " . json_encode($left);
});

echo PHP_EOL . ($failed === 0 ? "✔ all $passed farm unit checks passed" : "✖ $failed of " . ($failed + $passed) . " farm check(s) failed") . " (driver " . Tfm\Db::driver() . ')' . PHP_EOL;
exit($failed === 0 ? 0 : 1);
