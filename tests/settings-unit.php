<?php
/**
 * tests/settings-unit.php — unit checks for the settings kept on the account (CONTRACT §18.2): table user_settings
 * (schema v9), Tfm\UserSettings — reading an empty account, saving and reading back, the version rule (the last write
 * wins, stale → 409), every value checked against the option table of src/game/68-settings.js (taken with Node as
 * tools/build.mjs exports it) through a matrix of hostile values, key lists, devices (≤ 5, the newest), the 8 KB limit,
 * one account cannot touch another's row, the table made on first use for a database that reached v9 without it, and the
 * blob the CLIENT builds (Node: snapshot of every default) is kept whole.
 * No web server: a throw-away SQLite database in the temp dir — or MariaDB with the TFM_DB_* variables:
 *
 *   php tests/settings-unit.php
 *   TFM_DB_DRIVER=mysql TFM_DB_HOST=127.0.0.1 TFM_DB_PORT=33106 TFM_DB_USER=root TFM_DB_NAME=tfm_p10se_unit php tests/settings-unit.php
 *   (the MariaDB database must exist and be empty)
 *
 * TFM_UNIT_ONLY=<text> runs only the checks whose name contains <text>. CLI only; never deployed.
 * Exit 0 = all passed, 1 = a check failed, 2 = could not run (no Node).
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
$root = sys_get_temp_dir() . '/tfm-settings-' . bin2hex(random_bytes(6));
$srv = $root . '/srv';
$tmp = $root . '/data';
mkdir($tmp, 0700, true);
copyTree(__DIR__ . '/../server', $srv);

// ---- the option table and the client's default blob, from the fragment (Node)
$js = <<<'JS'
const fs = require('fs'), vm = require('vm');
const [frag, out] = process.argv.slice(2);
const G = { data: {} };
vm.runInContext("(function(){'use strict';\n" + fs.readFileSync(frag, 'utf8') + "\n})()", vm.createContext({ G, Math, JSON, Object, Array, Number, String, Date }));
const T = G.data.settingsTable;
const acct = {}, dev = {};
for (const [id, o] of Object.entries(T.options)) (o.s === 'd' ? dev : acct)[id] = o.d;
acct.key_jump = ['Space']; acct.key_forward = ['KeyW', 'ArrowUp'];
acct.gfxEffectRange = 9; acct.shotFormat = 'jpg';   // options a later lane declares: plain values
fs.writeFileSync(out, JSON.stringify({ table: { v: T.v, bytes: T.bytes, devices: T.devices, maxOptions: T.maxOptions, tabs: T.tabs, options: T.options }, blob: { acct, dev: { a1b2c3d4e5f6: { t: 1763900000, s: dev } } } }));
JS;
file_put_contents($root . '/fixtures.js', $js);
$node = getenv('TFM_NODE') ?: 'node';
exec(escapeshellarg($node) . ' ' . escapeshellarg($root . '/fixtures.js') . ' ' . escapeshellarg(__DIR__ . '/../src/game/68-settings.js') . ' ' . escapeshellarg($root . '/fixtures.json') . ' 2>&1', $nodeOut, $nodeRc);
if ($nodeRc !== 0 || !is_file($root . '/fixtures.json')) { fwrite(STDERR, "could not run: Node is needed to read the option table (" . implode(' ', $nodeOut) . ")\n"); exit(2); }
$FX = json_decode((string) file_get_contents($root . '/fixtures.json'), true);
$gd = is_file($srv . '/data/game-data.json') ? json_decode((string) file_get_contents($srv . '/data/game-data.json'), true) : [];
if (!is_array($gd)) $gd = [];
$gd['settings'] = $FX['table'];
if (!is_dir($srv . '/data')) mkdir($srv . '/data', 0700, true);
file_put_contents($srv . '/data/game-data.json', json_encode($gd));

putenv("TFM_DATA_DIR=$tmp");
putenv("TFM_UPLOAD_DIR=$tmp/uploads");
putenv('TFM_TOSS_MOCK=1');
require $srv . '/lib/bootstrap.php';

use Tfm\ApiException;
use Tfm\Db;
use Tfm\UserSettings;

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
function apiCode(callable $fn): string
{
    try { $fn(); } catch (ApiException $e) { return $e->status . ' ' . $e->errorCode; }
    return '';
}
function apiData(callable $fn)
{
    try { $fn(); } catch (ApiException $e) { return $e->data; }
    return null;
}
$RUN = substr(bin2hex(random_bytes(4)), 0, 6);
$nUsers = 0;
function mkUser(): array
{
    global $RUN, $nUsers;
    $nUsers++;
    return Tfm\Users::create("set{$RUN}{$nUsers}@example.com", 'St' . substr($RUN, 0, 4) . $nUsers, 'Ferment2026ok', '');
}
/** a body decoded the way Ctx::json decodes the request (JSON objects → arrays) */
function asJson(array $b): array { return json_decode(json_encode($b), true); }

// =============================================================================================== 1 · schema, table
check('schema — the database is at version 9 or newer and has user_settings (user_id, v, data, updated_at)', function () {
    Db::pdo();
    if (Db::SCHEMA_VERSION < 9 || Db::schemaVersion() !== Db::SCHEMA_VERSION) return 'code ' . Db::SCHEMA_VERSION . ', database ' . Db::schemaVersion();
    foreach (['user_id', 'v', 'data', 'updated_at'] as $c) if (!Db::hasColumn('user_settings', $c)) return "column $c is missing";
    return true;
});
echo 'driver: ' . Db::driverSafe() . PHP_EOL;
check('table — game-data.json carries the option table of 68-settings.js (the six volumes, 0 – 100)', function () {
    $t = UserSettings::table();
    if (count($t) < 30) return count($t) . ' options';
    foreach (['mixMaster', 'mixMusic', 'mixSfx', 'mixUi', 'mixVoice', 'mixNature'] as $id) if (!isset($t[$id]) || $t[$id]['t'] !== 'n' || (float) $t[$id]['max'] !== 100.0) return $id;
    return true;
});

// =============================================================================================== 2 · reading, saving, versions
check('get — an account that never saved: v 0, empty maps', function () {
    $u = mkUser();
    $g = UserSettings::get((int) $u['id']);
    return $g['v'] === 0 && json_encode($g['data']) === '{"acct":{},"dev":{}}' ? true : json_encode($g);
});
check('save → get — the client\'s whole default blob is kept as it was sent', function () use ($FX) {
    $u = mkUser();
    $r = UserSettings::save($u, asJson(['v' => 1, 'data' => $FX['blob']]));
    if ($r['v'] !== 1 || $r['dropped'] !== 0) return json_encode($r);
    $g = UserSettings::get((int) $u['id']);
    $want = json_decode(json_encode($FX['blob']), true);
    $got = json_decode(json_encode($g['data']), true);
    ksort($want['acct']); ksort($got['acct']);
    return $g['v'] === 1 && $got['acct'] == $want['acct'] && $got['dev'] == $want['dev'] ? true : json_encode(array_diff_assoc(array_map('json_encode', $want['acct']), array_map('json_encode', $got['acct'])));
});
check('versions — a higher v wins; the same or a lower v is 409 SETTINGS_STALE with the stored v', function () {
    $u = mkUser();
    UserSettings::save($u, asJson(['v' => 3, 'data' => ['acct' => ['mixMusic' => 40]]]));
    $same = apiCode(function () use ($u) { UserSettings::save($u, asJson(['v' => 3, 'data' => ['acct' => ['mixMusic' => 10]]])); });
    $low = apiData(function () use ($u) { UserSettings::save($u, asJson(['v' => 2, 'data' => ['acct' => ['mixMusic' => 10]]])); });
    $hi = UserSettings::save($u, asJson(['v' => 9, 'data' => ['acct' => ['mixMusic' => 70]]]));
    $g = UserSettings::get((int) $u['id']);
    if ($same !== '409 SETTINGS_STALE') return "same v: $same";
    if (!is_array($low) || $low['v'] !== 3) return 'low v data ' . json_encode($low);
    return $hi['v'] === 9 && $g['v'] === 9 && $g['data']['acct']['mixMusic'] === 70 ? true : json_encode($g);
});
check('ownership — two accounts keep two rows; a save never names another account', function () {
    $a = mkUser(); $b = mkUser();
    UserSettings::save($a, asJson(['v' => 1, 'data' => ['acct' => ['textScale' => 5]]]));
    UserSettings::save($b, asJson(['v' => 1, 'data' => ['acct' => ['textScale' => 1]]]));
    // the endpoint refuses any field but v and data (api/settings/save.php: V::keys) — a user_id cannot be named
    $extra = apiCode(function () use ($b) { Tfm\V::keys(['v' => 2, 'data' => [], 'user_id' => (int) $b['id']], ['v', 'data']); });
    $ga = UserSettings::get((int) $a['id']); $gb = UserSettings::get((int) $b['id']);
    return $extra === '400 INVALID_INPUT' && $ga['data']['acct']['textScale'] === 5 && $gb['data']['acct']['textScale'] === 1 ? true : json_encode([$ga, $gb, $extra]);
});

// =============================================================================================== 3 · values
check('values — a matrix of hostile values is dropped, never stored', function () {
    $u = mkUser();
    $acct = [
        'mixMaster' => 101, 'mixMusic' => -1, 'mixSfx' => '50', 'mixUi' => true, 'mixVoice' => null, 'mixNature' => [1],
        'muted' => 'yes', 'musicGugak' => 1, 'nameplates' => 'ALL', 'mouseLook' => '<script>', 'quality' => 'ultra',
        'textScale' => 6, 'avatarScale' => 79, 'key_jump' => ['Space', 'Key<A>'], 'key_back' => ['A', 'B', 'C', 'D', 'E'], 'key_left' => 'KeyA',
        'laterOption' => str_repeat('x', 41), 'laterWord' => 'a b', 'laterNum' => 1e9, 'laterObj' => ['x' => 1],
        '1bad' => 1, 'constructor' => 1, 'ok_value' => 'fine-1.0', 'mixMasterOk' => 50,
    ];
    $r = UserSettings::save($u, asJson(['v' => 1, 'data' => ['acct' => $acct]]));
    $g = UserSettings::get((int) $u['id']);
    $kept = array_keys((array) $g['data']['acct']);
    sort($kept);
    return $kept === ['mixMasterOk', 'ok_value'] && $r['dropped'] === count($acct) - 2 ? true : json_encode(['kept' => $kept, 'dropped' => $r['dropped']]);
});
check('values — every option of the table accepts its own default, its min and its max', function () {
    $u = mkUser();
    $acct = []; $n = 0;
    foreach (UserSettings::table() as $id => $o) {
        if ($o['s'] !== 'a') continue;
        $acct[$id] = $o['t'] === 'n' ? (($n++ % 2) ? $o['min'] : $o['max']) : $o['d'];
    }
    $r = UserSettings::save($u, asJson(['v' => 1, 'data' => ['acct' => $acct]]));
    return $r['dropped'] === 0 ? true : 'dropped ' . $r['dropped'];
});
check('keys — key_<action> keeps a list of ≤ 4 codes without doubles', function () {
    $u = mkUser();
    UserSettings::save($u, asJson(['v' => 1, 'data' => ['acct' => ['key_jump' => ['KeyJ', 'KeyJ', 'Space'], 'key_run' => []]]]));
    $g = UserSettings::get((int) $u['id']);
    return $g['data']['acct']['key_jump'] === ['KeyJ', 'Space'] && $g['data']['acct']['key_run'] === [] ? true : json_encode($g['data']['acct']);
});
check('shape — unknown top fields, a list instead of a map, too many options → 400 SETTINGS_INVALID', function () {
    $u = mkUser();
    $a = apiCode(function () use ($u) { UserSettings::save($u, asJson(['v' => 1, 'data' => ['acct' => [], 'other' => 1]])); });
    $b = apiCode(function () use ($u) { UserSettings::save($u, asJson(['v' => 1, 'data' => ['acct' => [1, 2, 3]]])); });
    $many = []; for ($i = 0; $i < 201; $i++) $many['o' . $i] = true;
    $c = apiCode(function () use ($u, $many) { UserSettings::save($u, asJson(['v' => 1, 'data' => ['acct' => $many]])); });
    $d = apiCode(function () use ($u) { UserSettings::save($u, asJson(['v' => '2', 'data' => ['acct' => []]])); });
    $e = apiCode(function () use ($u) { UserSettings::save($u, asJson(['v' => 0, 'data' => ['acct' => []]])); });
    return $a === '400 SETTINGS_INVALID' && $b === '400 SETTINGS_INVALID' && $c === '400 SETTINGS_INVALID' && $d === '400 INVALID_INPUT' && $e === '400 INVALID_INPUT' ? true : json_encode([$a, $b, $c, $d, $e]);
});
check('devices — at most 5 kept (the newest), device ids checked, device maps checked like the account map', function () {
    $u = mkUser();
    $dev = [];
    for ($i = 0; $i < 7; $i++) $dev['d' . str_pad((string) $i, 11, '0', STR_PAD_LEFT)] = ['t' => 1763900000 + $i, 's' => ['quality' => 'high', 'stickSide' => 'right', 'shadows' => 'no']];
    $dev['BAD_ID'] = ['t' => 1, 's' => []];
    $r = UserSettings::save($u, asJson(['v' => 1, 'data' => ['dev' => $dev]]));
    $g = UserSettings::get((int) $u['id']);
    $ids = array_keys((array) $g['data']['dev']);
    sort($ids);
    $first = $g['data']['dev']['d00000000006'] ?? null;
    if ($ids !== ['d00000000002', 'd00000000003', 'd00000000004', 'd00000000005', 'd00000000006']) return json_encode($ids);
    return $first && $first['s'] === ['quality' => 'high', 'stickSide' => 'right'] ? true : json_encode($first);
});
check('size — more than 8 KB is 413 PAYLOAD_TOO_LARGE; the stored row stays as it was', function () {
    $u = mkUser();
    UserSettings::save($u, asJson(['v' => 1, 'data' => ['acct' => ['mixUi' => 30]]]));
    $dev = [];
    for ($i = 0; $i < 5; $i++) { $s = []; for ($k = 0; $k < 120; $k++) $s['laterOption' . $k] = str_repeat('a', 30); $dev['d' . str_pad((string) $i, 11, '0', STR_PAD_LEFT)] = ['t' => $i, 's' => $s]; }
    $c = apiCode(function () use ($u, $dev) { UserSettings::save($u, asJson(['v' => 2, 'data' => ['dev' => $dev]])); });
    $g = UserSettings::get((int) $u['id']);
    return $c === '413 PAYLOAD_TOO_LARGE' && $g['v'] === 1 && $g['data']['acct']['mixUi'] === 30 ? true : json_encode([$c, $g['v']]);
});
check('stored garbage — a row whose data is not valid JSON reads as empty maps, never an error', function () {
    $u = mkUser();
    UserSettings::save($u, asJson(['v' => 1, 'data' => ['acct' => ['mixUi' => 30]]]));
    Db::exec('UPDATE user_settings SET data = ? WHERE user_id = ?', ['{not json', (int) $u['id']]);
    $g = UserSettings::get((int) $u['id']);
    return $g['v'] === 1 && json_encode($g['data']) === '{"acct":{},"dev":{}}' ? true : json_encode($g);
});
check('forget — the row of an account goes', function () {
    $u = mkUser();
    UserSettings::save($u, asJson(['v' => 1, 'data' => ['acct' => ['mixUi' => 30]]]));
    UserSettings::forget((int) $u['id']);
    return Db::value('SELECT COUNT(*) FROM user_settings WHERE user_id = ?', [(int) $u['id']]) == 0;
});
check('first use — a database that reached v9 without the table gets it on the first read', function () {
    Db::exec('DROP TABLE user_settings');
    UserSettings::resetCache();
    $u = mkUser();
    $g = UserSettings::get((int) $u['id']);
    $r = UserSettings::save($u, asJson(['v' => 1, 'data' => ['acct' => ['mixUi' => 30]]]));
    return Db::hasTable('user_settings') && $g['v'] === 0 && $r['v'] === 1 ? true : 'table missing';
});
check('guests — a request without an account id is refused (401)', function () {
    return apiCode(function () { UserSettings::save([], ['v' => 1, 'data' => ['acct' => []]]); }) === '401 AUTH_REQUIRED';
});

echo PHP_EOL . "$passed passed, $failed failed" . PHP_EOL;
exit($failed ? 1 : 0);
