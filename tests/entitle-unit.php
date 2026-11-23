<?php
/**
 * tests/entitle-unit.php — unit checks for entitlements, the default administrator and the operator settings
 * (CONTRACT §17.2): schema v8 (users.login_id, users.pw_default) and the migration of a v7 site, the settings registry
 * (types, ranges, defaults, the public subset), Tfm\Entitle (the rules table: free · paid 2 / 3 / 4 · expiry · refund ·
 * revoke · administrator = everything free; operator settings change every number; nothing a client sends counts), the
 * jar limit in the save validator (JAR_LIMIT / JAR_LOCKED — a plan change never loses a jar), login by id, the
 * default-password flag, the password change (policy, every session ends, audited) and the first-run seed.
 * No web server: a throw-away SQLite database in the temp dir — or MariaDB with the TFM_DB_* variables:
 *
 *   php tests/entitle-unit.php
 *   TFM_DB_DRIVER=mysql TFM_DB_HOST=127.0.0.1 TFM_DB_PORT=33106 TFM_DB_USER=root TFM_DB_NAME=tfm_p9en_unit php tests/entitle-unit.php
 *   (the MariaDB database must exist and be FRESH — the seed checks need a database without accounts; the migration
 *    checks create and drop <TFM_DB_NAME>_mig)
 *
 * Every check runs inside its own try/catch: a missing class / method is that check's FAIL (with the error message).
 * TFM_UNIT_ONLY=<text> runs only the checks whose name contains <text> (the set-up between checks still runs).
 * CLI only; never deployed (tests/ is not part of the web root). Developer tooling: runs on the dev PHP (8.x).
 */
declare(strict_types=1);

if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
/** copy a directory tree (the server sources are ~1 MB) */
function copyTree(string $from, string $to): void
{
    if (!is_dir($to)) mkdir($to, 0700, true);
    foreach (scandir($from) ?: [] as $f) {
        if ($f === '.' || $f === '..') continue;
        if (is_dir("$from/$f")) copyTree("$from/$f", "$to/$f");
        elseif (!preg_match('/\.sqlite(-wal|-shm)?$|config\.local\.php$|secret\.php$|install\.lock$/', $f)) copy("$from/$f", "$to/$f");
    }
}
// a private copy of the server tree and its own data directory (the installer check writes config.local.php there)
$root = sys_get_temp_dir() . '/tfm-entitle-' . bin2hex(random_bytes(6));
$srv = $root . '/srv';
$tmp = $root . '/data';
mkdir($tmp, 0700, true);
copyTree(__DIR__ . '/../server', $srv);
putenv("TFM_DATA_DIR=$tmp");
putenv("TFM_UPLOAD_DIR=$tmp/uploads");
putenv('TFM_TOSS_MOCK=1');
require $srv . '/lib/bootstrap.php';

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
/** the ApiException a call throws as "status CODE" ('' = none) */
function apiCode(callable $fn): string
{
    try { $fn(); } catch (Tfm\ApiException $e) { return $e->status . ' ' . $e->errorCode; }
    return '';
}
function j($v): string { return (string) json_encode($v, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES); }

$IS_MYSQL = strtolower((string) Tfm\Config::get('db.driver', 'sqlite')) === 'mysql';
$RUN = bin2hex(random_bytes(3));
$DAY = 86400000;
$CLI = ['id' => 0, 'nickname' => 'CLI'];

// =============================================================================================== 1 · schema v8, the migration, the seed marker
check('schema — Db::SCHEMA_VERSION is 8 or newer (9 since phase 10) and a fresh database is created at that version with users.login_id and users.pw_default', function () {
    Tfm\Db::pdo();
    return Tfm\Db::SCHEMA_VERSION >= 8 && Tfm\Db::schemaVersion() === Tfm\Db::SCHEMA_VERSION && Tfm\Db::hasColumn('users', 'login_id') && Tfm\Db::hasColumn('users', 'pw_default')
        ? true : 'code ' . Tfm\Db::SCHEMA_VERSION . ', database ' . Tfm\Db::schemaVersion();
});
echo 'driver: ' . Tfm\Db::driverSafe() . PHP_EOL;
check('seed marker — a database born without accounts is marked site.default_admin = pending (Users::defaultAdminState)', function () {
    return Tfm\Users::defaultAdminState() === 'pending' ? true : 'state ' . var_export(Tfm\Users::defaultAdminState(), true) . ' (a MariaDB database must be fresh)';
});
check('schema — re-running the schema file changes nothing (idempotent; the marker is not written twice)', function () {
    $file = TFM_ROOT . '/database/' . (Tfm\Db::driver() === 'mysql' ? 'schema.sql' : 'schema.sqlite.sql');
    $v = (int) Tfm\Db::value('SELECT COUNT(*) FROM schema_version');
    $s = (int) Tfm\Db::value('SELECT COUNT(*) FROM settings');
    foreach (Tfm\Db::splitSql((string) file_get_contents($file)) as $stmt) Tfm\Db::pdo()->exec($stmt);
    return (int) Tfm\Db::value('SELECT COUNT(*) FROM schema_version') === $v && (int) Tfm\Db::value('SELECT COUNT(*) FROM settings') === $s && Tfm\Db::schemaVersion() === Tfm\Db::SCHEMA_VERSION;
});

/**
 * A v7 site: the schema file up to the "-- v8 (" block with the two v8 columns taken out of CREATE TABLE users, on a
 * new database. $withUser: one account and one setting are stored first. Returns [use, back].
 */
$v7Site = function (bool $withUser) use ($IS_MYSQL, $tmp): array {
    $file = TFM_ROOT . '/database/' . ($IS_MYSQL ? 'schema.sql' : 'schema.sqlite.sql');
    $sql = (string) file_get_contents($file);
    $cut = strpos($sql, "\n-- v8 (");
    if ($cut === false) throw new RuntimeException('the schema file has no "-- v8 (" block');
    $head = substr($sql, 0, $cut);
    if ($IS_MYSQL) {
        $head = (string) preg_replace('/^\s+login_id\s+VARCHAR\(20\) NULL,\n/m', '', $head, 1, $a);
        $head = (string) preg_replace('/^\s+pw_default\s+TINYINT NOT NULL DEFAULT 0,\n/m', '', $head, 1, $b);
        $head = (string) preg_replace('/^\s+UNIQUE KEY ux_users_login \(login_id\),\n/m', '', $head, 1, $c);
    } else {
        $head = (string) preg_replace('/(password_changed_at INTEGER NOT NULL DEFAULT 0),\n\s+login_id\s+TEXT,[^\n]*\n\s+pw_default[^\n]*\n\);/', "$1\n);", $head, 1, $a);
        $b = $c = $a;
    }
    if ($a !== 1 || $b !== 1 || $c !== 1) throw new RuntimeException('could not take the v8 columns out of CREATE TABLE users');
    $now = Tfm\Clock::ms();
    $fill = function (PDO $pdo) use ($withUser, $now): void {
        if (!$withUser) return;
        $pdo->exec("INSERT INTO users (email, nickname, nickname_key, password_hash, created_at, updated_at) VALUES ('old@example.com', 'OldSite', 'oldsite', 'x', $now, $now)");
        $pdo->exec("INSERT INTO settings (k, v, updated_at) VALUES ('farm.rt_scale', '2', $now)");
    };
    if ($IS_MYSQL) {
        $m = (array) Tfm\Config::get('db.mysql', []);
        $name = (string) $m['database'] . '_mig';
        $adminPdo = Tfm\Db::connectMysql($m, false);
        $adminPdo->exec('DROP DATABASE IF EXISTS `' . $name . '`');
        $adminPdo->exec('CREATE DATABASE `' . $name . '` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci');
        $pdo = Tfm\Db::connectMysql(['database' => $name] + $m);
        foreach (Tfm\Db::splitSql($head) as $s) $pdo->exec($s);
        $fill($pdo);
        $use = function () use ($name) { Tfm\Config::override('db.mysql.database', $name); Tfm\Db::reset(); Tfm\Settings::reset(); };
        $back = function () use ($adminPdo, $name) { Tfm\Config::override('db.mysql.database', null); Tfm\Config::override('db.auto_migrate', null); Tfm\Db::reset(); Tfm\Settings::reset(); $adminPdo->exec('DROP DATABASE IF EXISTS `' . $name . '`'); };
        return [$use, $back];
    }
    $path = $tmp . '/v7-' . bin2hex(random_bytes(4)) . '.sqlite';
    $pdo = new PDO('sqlite:' . $path, null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
    foreach (Tfm\Db::splitSql($head) as $s) $pdo->exec($s);
    $fill($pdo);
    $pdo = null;
    $use = function () use ($path) { Tfm\Config::override('db.sqlite_path', $path); Tfm\Db::reset(); Tfm\Settings::reset(); };
    $back = function () use ($path) { Tfm\Config::override('db.sqlite_path', null); Tfm\Config::override('db.auto_migrate', null); Tfm\Db::reset(); Tfm\Settings::reset(); foreach (['', '-wal', '-shm'] as $x) @unlink($path . $x); };
    return [$use, $back];
};
check('migration — a v7 site with accounts is upgraded to v8 on the first request: its rows stay, login_id is NULL, pw_default 0, the unique key works, and it is NOT marked for the default administrator', function () use ($v7Site) {
    list($use, $back) = $v7Site(true);
    try {
        $use();
        Tfm\Db::pdo(); // migrates
        $v = Tfm\Db::schemaVersion();
        $row = Tfm\Db::one("SELECT nickname, login_id, pw_default FROM users WHERE email = 'old@example.com'");
        $set = (string) Tfm\Db::value("SELECT v FROM settings WHERE k = 'farm.rt_scale'");
        $state = Tfm\Users::defaultAdminState();
        $now = Tfm\Clock::ms();
        Tfm\Db::exec("UPDATE users SET login_id = 'boss' WHERE email = 'old@example.com'");
        $dup = '';
        try { Tfm\Db::exec("INSERT INTO users (email, nickname, nickname_key, password_hash, created_at, updated_at, login_id) VALUES ('b@example.com', 'Bb', 'bb', 'x', $now, $now, 'boss')"); } catch (PDOException $e) { $dup = (string) $e->getCode(); }
        Tfm\Db::exec("INSERT INTO users (email, nickname, nickname_key, password_hash, created_at, updated_at) VALUES ('c@example.com', 'Cc', 'cc', 'x', $now, $now)");
        Tfm\Db::exec("INSERT INTO users (email, nickname, nickname_key, password_hash, created_at, updated_at) VALUES ('d@example.com', 'Dd', 'dd', 'x', $now, $now)");
        Tfm\Users::ensureDefaultAdmin('admin'); // must do nothing here
        $admins = (int) Tfm\Db::value("SELECT COUNT(*) FROM users WHERE role = 'admin'");
        return $v === Tfm\Db::SCHEMA_VERSION && $row && $row['nickname'] === 'OldSite' && $row['login_id'] === null && (int) $row['pw_default'] === 0 && $set === '2' && $state === '' && $dup === '23000' && $admins === 0
            ? true : j([$v, $row, $set, $state, $dup, $admins]);
    } finally { $back(); }
});
check('migration — a v7 site without any account becomes v8 and is marked pending (it is as good as new)', function () use ($v7Site) {
    list($use, $back) = $v7Site(false);
    try {
        $use();
        Tfm\Db::pdo();
        return Tfm\Db::schemaVersion() === Tfm\Db::SCHEMA_VERSION && Tfm\Users::defaultAdminState() === 'pending' ? true : Tfm\Db::schemaVersion() . ' ' . Tfm\Users::defaultAdminState();
    } finally { $back(); }
});
check('migration — with db.auto_migrate off a v7 site answers 503 SCHEMA_OUTDATED until the upgrade runs (cli migrate)', function () use ($v7Site) {
    list($use, $back) = $v7Site(true);
    try {
        $use();
        Tfm\Config::override('db.auto_migrate', false);
        $code = apiCode(function () { Tfm\Db::pdo(); });
        $after = Tfm\Db::upgrade();
        return $code === '503 SCHEMA_OUTDATED' && $after === Tfm\Db::SCHEMA_VERSION && Tfm\Db::hasColumn('users', 'login_id') ? true : j([$code, $after]);
    } finally { $back(); }
});
check('migration — back on the test database (the current version, still pending)', function () {
    return Tfm\Db::schemaVersion() === Tfm\Db::SCHEMA_VERSION && Tfm\Users::defaultAdminState() === 'pending';
});

// =============================================================================================== 2 · the settings registry
check('registry — every row has a known type and group, a label, and a default that passes its own rule', function () {
    $bad = [];
    foreach (Tfm\Settings::defs() as $k => $d) {
        if (!in_array($d['type'], ['bool', 'int', 'float', 'enum', 'list', 'str'], true) || !isset(Tfm\Settings::GROUPS[$d['group']]) || trim((string) $d['label']) === '') { $bad[] = "$k (shape)"; continue; }
        try { if (Tfm\Settings::cleanValue($k, $d['default']) !== $d['default']) $bad[] = "$k (default " . j($d['default']) . ' cleans to ' . j(Tfm\Settings::cleanValue($k, $d['default'])) . ')'; }
        catch (Throwable $e) { $bad[] = "$k (default refused)"; }
    }
    return $bad === [] && count(Tfm\Settings::defs()) >= 24 ? true : count(Tfm\Settings::defs()) . ' rows; ' . implode(', ', $bad);
});
check('registry — the rows CONTRACT §17.2 names exist: tiers on sale, three prices, the multipliers, jar and room limits, the notice, the mouse-look defaults', function () {
    $want = ['sub.tiers_on', 'sub.price_2', 'sub.price_3', 'sub.price_4', 'sub.move_2', 'sub.grow_2', 'sub.move_3', 'sub.grow_3', 'sub.move_4', 'sub.grow_4', 'limits.jars_free', 'limits.jars_paid',
        'limits.room_items_free', 'limits.room_items_paid', 'security.notice', 'controls.mouse_look_normal', 'controls.mouse_look_easy', 'admin.twofa_required', 'farm.rt_scale'];
    $missing = array_values(array_filter($want, function ($k) { return !Tfm\Settings::isDefined($k); }));
    return $missing === [] ? true : 'missing: ' . implode(', ', $missing);
});
check('registry — defaults: tiers on sale [2, 3], prices from the config file, 3 / 12 jars, 80 / 160 room items', function () {
    $got = [Tfm\Settings::get('sub.tiers_on'), Tfm\Settings::get('sub.price_2'), Tfm\Settings::get('sub.price_3'), Tfm\Settings::get('sub.price_4'), Tfm\Settings::get('limits.jars_free'),
        Tfm\Settings::get('limits.jars_paid'), Tfm\Settings::get('limits.room_items_free'), Tfm\Settings::get('limits.room_items_paid')];
    return $got === [[2, 3], 2900, 4900, 6900, 3, 12, 80, 160] ? true : j($got);
});
check('registry types — int: a digit string is taken, a value outside the range, a fraction, a word and an array are refused (INVALID_SETTING)', function () {
    $ok = Tfm\Settings::cleanValue('limits.jars_free', '5') === 5 && Tfm\Settings::cleanValue('limits.jars_free', 12) === 12 && Tfm\Settings::cleanValue('sub.price_2', ' 3900 ') === 3900;
    $bad = [];
    foreach (['0', '13', '-1', '2.5', 'abc', '1e2', '', '3; DROP TABLE users', ['3'], null, true, 99999999999999] as $v) {
        if (apiCode(function () use ($v) { Tfm\Settings::cleanValue('limits.jars_free', $v); }) !== '400 INVALID_SETTING') $bad[] = j($v);
    }
    return $ok && $bad === [] ? true : 'accepted: ' . implode(' ', $bad);
});
check('registry types — float: 0.6 … 1.6 only (night brightness); enum: only the listed words; bool: on / off words only', function () {
    $f = Tfm\Settings::cleanValue('env.night_brightness', '1.4') === 1.4 && Tfm\Settings::cleanValue('env.night_brightness', 0.6) === 0.6;
    $fb = [];
    foreach (['0.59', '1.61', 'NaN', 'INF', '1,4', 'bright', [1.2]] as $v) if (apiCode(function () use ($v) { Tfm\Settings::cleanValue('env.night_brightness', $v); }) !== '400 INVALID_SETTING') $fb[] = j($v);
    $e = Tfm\Settings::cleanValue('controls.mouse_look_normal', 'walk') === 'walk';
    $eb = [];
    foreach (['WALK!', 'fly', '', '<script>', 3, ['lock']] as $v) if (apiCode(function () use ($v) { Tfm\Settings::cleanValue('controls.mouse_look_normal', $v); }) !== '400 INVALID_SETTING') $eb[] = j($v);
    $b = Tfm\Settings::cleanValue('ai.kid_helper', 'on') === true && Tfm\Settings::cleanValue('ai.kid_helper', '0') === false && Tfm\Settings::cleanValue('ai.kid_helper', true) === true;
    $bb = [];
    foreach (['banana', '2', ['1'], 1.5] as $v) if (apiCode(function () use ($v) { Tfm\Settings::cleanValue('ai.kid_helper', $v); }) !== '400 INVALID_SETTING') $bb[] = j($v);
    return $f && $fb === [] && $e && $eb === [] && $b && $bb === [] ? true : j([$f, $fb, $e, $eb, $b, $bb]);
});
check('registry types — list: values come back once each in the registry order as integers; an unknown value refuses the whole list; an empty list is a value', function () {
    $a = Tfm\Settings::cleanValue('sub.tiers_on', ['4', '2', '2']) === [2, 4];
    $b = Tfm\Settings::cleanValue('sub.tiers_on', '3,2') === [2, 3];
    $c = Tfm\Settings::cleanValue('sub.tiers_on', []) === [];
    $bad = [];
    foreach ([['2', '5'], ['1'], [['2']], 'two', [2, 'x']] as $v) if (apiCode(function () use ($v) { Tfm\Settings::cleanValue('sub.tiers_on', $v); }) !== '400 INVALID_SETTING') $bad[] = j($v);
    return $a && $b && $c && $bad === [] ? true : j([$a, $b, $c, $bad]);
});
check('registry types — str: control characters go, the length is capped by the rule, a bad word is refused', function () {
    $clean = Tfm\Settings::cleanValue('security.notice', "  내일은 \x07쉬어요\u{202E}  ");
    $long = apiCode(function () { Tfm\Settings::cleanValue('security.notice', str_repeat('가', 2000)); });
    $cut = mb_strlen(Tfm\Settings::cleanValue('security.notice', str_repeat('나', 230)));
    $rude = apiCode(function () { Tfm\Settings::cleanValue('security.notice', '시발 공지'); });
    return strpos($clean, "\x07") === false && strpos($clean, "\u{202E}") === false && strpos($clean, '내일은') === 0 && $long === '400 INVALID_SETTING' && $cut === 200 && $rude === '400 INVALID_SETTING'
        ? true : j([$clean, $long, $cut, $rude]);
});
check('registry — set stores and audits, get returns the stored value, clear goes back to the default (audited); an unknown key and a secret are refused', function () {
    $a0 = (int) Tfm\Db::value("SELECT COUNT(*) FROM audit_log WHERE event IN ('setting_changed', 'setting_reset')");
    Tfm\Settings::set('limits.jars_free', '5', null);
    $five = Tfm\Settings::get('limits.jars_free');
    $has = Tfm\Settings::has('limits.jars_free');
    $was = Tfm\Settings::clear('limits.jars_free', null);
    $again = Tfm\Settings::clear('limits.jars_free', null);
    $back = Tfm\Settings::get('limits.jars_free');
    $a1 = (int) Tfm\Db::value("SELECT COUNT(*) FROM audit_log WHERE event IN ('setting_changed', 'setting_reset')");
    $unknown = apiCode(function () { Tfm\Settings::set('toss.secret_key', 'x', null); }) . ' / ' . apiCode(function () { Tfm\Settings::set('anthropic.api_key', 'x', null); }) . ' / ' . apiCode(function () { Tfm\Settings::clear('db.mysql.password', null); });
    $none = (int) Tfm\Db::value("SELECT COUNT(*) FROM settings WHERE k LIKE 'toss.%' OR k LIKE 'anthropic.%' OR k LIKE 'db.%'");
    return $five === 5 && $has && $was === true && $again === false && $back === 3 && $a1 === $a0 + 2 && $unknown === '400 INVALID_SETTING / 400 INVALID_SETTING / 400 INVALID_SETTING' && $none === 0
        ? true : j([$five, $has, $was, $again, $back, $a1 - $a0, $unknown, $none]);
});
check('registry — a stored row that was edited by hand to a value outside its rule counts as missing (the default applies)', function () {
    $now = Tfm\Clock::ms();
    Tfm\Db::upsert('settings', ['k' => 'limits.jars_paid', 'v' => '9999', 'updated_at' => $now, 'updated_by' => null], ['k']);
    Tfm\Db::upsert('settings', ['k' => 'sub.tiers_on', 'v' => '"everything"', 'updated_at' => $now, 'updated_by' => null], ['k']);
    Tfm\Settings::reset();
    $got = [Tfm\Settings::get('limits.jars_paid'), Tfm\Settings::get('sub.tiers_on')];
    Tfm\Db::exec("DELETE FROM settings WHERE k IN ('limits.jars_paid', 'sub.tiers_on')");
    Tfm\Settings::reset();
    return $got === [12, [2, 3]] ? true : j($got);
});
check('registry — the config file is the documented default: a value at the same path wins over the registry default, a stored one over both', function () {
    Tfm\Config::override('limits.room_items_free', 60);
    $cfg = Tfm\Settings::get('limits.room_items_free');
    $def = Tfm\Settings::defaultOf('limits.room_items_free');
    Tfm\Settings::set('limits.room_items_free', 100, null);
    $stored = Tfm\Settings::get('limits.room_items_free');
    Tfm\Settings::clear('limits.room_items_free', null);
    Tfm\Config::override('limits.room_items_free', null);
    return $cfg === 60 && $def === 60 && $stored === 100 && Tfm\Settings::get('limits.room_items_free') === 80 ? true : j([$cfg, $def, $stored]);
});
check('site — the public subset holds only public rows: no price, no multiplier, nothing of the secrets; the notice masks personal data', function () {
    Tfm\Settings::set('security.notice', '문의는 010-1234-5678 로 주세요', null);
    $site = Tfm\Entitle::site();
    $keys = array_keys($site);
    $leak = array_values(array_filter($keys, function ($k) { return (bool) preg_match('/price|move_|grow_|secret|key|password|twofa/', $k); }));
    $notice = (string) $site['security.notice'];
    Tfm\Settings::clear('security.notice', null);
    return $leak === [] && isset($site['sub.tiers_on'], $site['limits.jars_free'], $site['limits.jars_paid'], $site['limits.room_items_paid'], $site['controls.mouse_look_normal'])
        && strpos($notice, '1234') === false && strpos($notice, '문의는') === 0 ? true : j([$keys, $notice]);
});
check('site — the stamp changes with a public value and stays with a private one', function () {
    $s0 = Tfm\Settings::publicStamp();
    Tfm\Settings::set('sub.price_2', 3900, null);
    $s1 = Tfm\Settings::publicStamp();
    Tfm\Settings::set('limits.jars_free', 4, null);
    $s2 = Tfm\Settings::publicStamp();
    Tfm\Settings::clear('sub.price_2', null);
    Tfm\Settings::clear('limits.jars_free', null);
    return $s0 === $s1 && $s1 !== $s2 && Tfm\Settings::publicStamp() === $s0 && preg_match('/^[0-9a-f]{12}$/', $s0) === 1 ? true : "$s0 $s1 $s2";
});

// =============================================================================================== 3 · the rules table (Tfm\Entitle)
$n = 0;
/** a fresh account (unique per run) */
$mk = function (string $role = '') use (&$n, $RUN): array {
    $n++;
    return Tfm\Users::create("en{$RUN}{$n}@example.com", 'En' . substr($RUN, 0, 4) . $n, 'Ferment2026ok', $role);
};
$FREE = ['v' => 1, 'role' => 'user', 'admin' => false, 'tier' => 1, 'paid' => false, 'until' => 0, 'speed' => ['move' => 1, 'grow' => 1], 'limits' => ['jars' => 3, 'roomItems' => 80], 'features' => ['myroom' => false]];
check('rules — a guest and a free account: tier 1, × 1 / × 1, 3 jars, 80 room items, no room, and no administrator fields at all', function () use ($mk, $FREE) {
    $u = $mk();
    $g = Tfm\Entitle::guest();
    $e = Tfm\Entitle::forUser($u);
    return $g === $FREE && $e === $FREE && Tfm\Entitle::forUser(null) === $FREE && Tfm\Entitle::forUser(['id' => 0, 'role' => 'admin']) === $FREE ? true : j([$g, $e]);
});
$paid = function (int $tier) use ($mk, $CLI): array {
    $u = $mk();
    Tfm\Subscription::grant($CLI, (int) $u['id'], $tier, 30);
    return $u;
};
check('rules — paid tier 2: moves and grows × 2, 12 jars, 160 room items, paid with its end date', function () use ($paid) {
    $u = $paid(2);
    $e = Tfm\Entitle::forUser($u);
    $exp = (int) Tfm\Subscription::state((int) $u['id'])['expiresAt'];
    return $e['tier'] === 2 && $e['paid'] === true && $e['until'] === $exp && $exp > Tfm\Clock::ms() + 29 * 86400000 && $e['speed'] === ['move' => 2, 'grow' => 2] && $e['limits'] === ['jars' => 12, 'roomItems' => 160]
        && $e['admin'] === false && !isset($e['adminUrl']) && !isset($e['pwDefault']) ? true : j($e);
});
check('rules — paid tier 3: × 3 / × 3; a granted tier 4: moves × 3 (the ceiling), grows × 4', function () use ($paid) {
    $e3 = Tfm\Entitle::forUser($paid(3));
    $e4 = Tfm\Entitle::forUser($paid(4));
    return $e3['tier'] === 3 && $e3['speed'] === ['move' => 3, 'grow' => 3] && $e4['tier'] === 4 && $e4['speed'] === ['move' => 3, 'grow' => 4] && $e4['limits']['jars'] === 12 ? true : j([$e3, $e4]);
});
check('rules — expiry: the day after the period ends the same account is tier 1 with 3 jars again (nothing else changes)', function () use ($paid, $FREE, $DAY) {
    $u = $paid(2);
    $before = Tfm\Entitle::forUser($u);
    $after = Tfm\Entitle::forUser($u, null, Tfm\Clock::ms() + 31 * $DAY);
    return $before['tier'] === 2 && $after === $FREE ? true : j($after);
});
check('rules — a refund (토스 webhook CANCELED on the paid order) and an operator revoke both go back to the free values at once', function () use ($mk, $paid, $FREE, $CLI) {
    $u = $mk();
    $o = Tfm\Subscription::prepare($u, 2, 'card');
    Tfm\Subscription::confirm($u, 'mock_' . $o['orderId'], $o['orderId'], (int) $o['amount']);
    $on = Tfm\Entitle::forUser($u);
    $w = Tfm\Subscription::webhook(['eventType' => 'PAYMENT_STATUS_CHANGED', 'data' => ['paymentKey' => 'mock_' . $o['orderId'], 'orderId' => $o['orderId'], 'status' => 'CANCELED']]);
    $refunded = Tfm\Entitle::forUser($u);
    $r = $paid(3);
    Tfm\Subscription::revoke($CLI, (int) $r['id']);
    $revoked = Tfm\Entitle::forUser($r);
    return $on['tier'] === 2 && $on['limits']['jars'] === 12 && !empty($w['downgraded']) && $refunded === $FREE && $revoked === $FREE ? true : j([$on, $w, $refunded, $revoked]);
});
check('rules — an administrator has everything without paying: the top tier on sale (3), 12 jars, 160 room items, a room, the admin address; paid is false', function () use ($mk) {
    $a = $mk('admin');
    $e = Tfm\Entitle::forUser($a);
    return $e['role'] === 'admin' && $e['admin'] === true && $e['tier'] === 3 && $e['paid'] === false && $e['until'] === 0 && $e['speed'] === ['move' => 3, 'grow' => 3]
        && $e['limits'] === ['jars' => 12, 'roomItems' => 160] && $e['features'] === ['myroom' => true] && isset($e['adminUrl']) && preg_match('#^[a-z0-9-]+/$#', $e['adminUrl']) === 1 && !isset($e['pwDefault'])
        ? true : j($e);
});
check('rules — the administrator follows what is on sale: [2, 3, 4] → tier 4, [2] → tier 2, nothing on sale → tier 3; a plan the administrator paid for is never lowered', function () use ($mk, $CLI) {
    $a = $mk('admin');
    Tfm\Settings::set('sub.tiers_on', [2, 3, 4], null);
    $t4 = Tfm\Entitle::forUser($a);
    Tfm\Settings::set('sub.tiers_on', [2], null);
    $t2 = Tfm\Entitle::forUser($a)['tier'];
    Tfm\Subscription::grant($CLI, (int) $a['id'], 3, 30);
    $own = Tfm\Entitle::forUser($a);
    Tfm\Settings::set('sub.tiers_on', [], null);
    $none = Tfm\Entitle::forUser($mk('admin'))['tier'];
    Tfm\Settings::clear('sub.tiers_on', null);
    return $t4['tier'] === 4 && $t4['speed'] === ['move' => 3, 'grow' => 4] && $t2 === 2 && $own['tier'] === 3 && $own['paid'] === true && $none === 3 && Tfm\Entitle::tiersOnSale() === [2, 3] ? true : j([$t4, $t2, $own, $none]);
});
check('rules — every number is an operator setting: jar and room limits, the multipliers of a tier (kept inside × 3 movement / × 4 growth)', function () use ($mk, $paid) {
    $free = $mk();
    $p2 = $paid(2);
    Tfm\Settings::set('limits.jars_free', 5, null);
    Tfm\Settings::set('limits.jars_paid', 9, null);
    Tfm\Settings::set('limits.room_items_free', 40, null);
    Tfm\Settings::set('limits.room_items_paid', 200, null);
    Tfm\Settings::set('sub.move_2', 3, null);
    Tfm\Settings::set('sub.grow_2', 4, null);
    $f = Tfm\Entitle::forUser($free);
    $p = Tfm\Entitle::forUser($p2);
    $tooFast = apiCode(function () { Tfm\Settings::set('sub.move_2', 4, null); }) . ' ' . apiCode(function () { Tfm\Settings::set('sub.grow_2', 5, null); }) . ' ' . apiCode(function () { Tfm\Settings::set('limits.jars_paid', 13, null); });
    foreach (['limits.jars_free', 'limits.jars_paid', 'limits.room_items_free', 'limits.room_items_paid', 'sub.move_2', 'sub.grow_2'] as $k) Tfm\Settings::clear($k, null);
    return $f['limits'] === ['jars' => 5, 'roomItems' => 40] && $p['limits'] === ['jars' => 9, 'roomItems' => 200] && $p['speed'] === ['move' => 3, 'grow' => 4]
        && $tooFast === '400 INVALID_SETTING 400 INVALID_SETTING 400 INVALID_SETTING' && Tfm\Entitle::forUser($p2)['speed'] === ['move' => 2, 'grow' => 2] ? true : j([$f, $p, $tooFast]);
});
check('rules — nothing a client could send is read: extra fields on the account row (tier, ent, limits, admin, paid) change nothing; only the role column counts', function () use ($mk, $FREE) {
    $u = $mk();
    $forged = $u + ['tier' => 4, 'paid' => true, 'admin' => true, 'ent' => ['tier' => 4, 'limits' => ['jars' => 12]], 'limits' => ['jars' => 99], 'sub' => ['tier' => 4]];
    $forged['role'] = 'user';
    $e = Tfm\Entitle::forUser($forged);
    $e2 = Tfm\Entitle::forUser($u, ['tier' => 99, 'status' => 'active', 'expiresAt' => 1]); // a broken plan object is clamped to 1..4
    return $e === $FREE && $e2['tier'] === 4 && $e2['limits']['jars'] === 12 ? true : j([$e, $e2]);
});
check('rules — a room of one\'s own: a live allotment contract or a room the operator granted gives features.myroom; an ended contract does not', function () use ($mk) {
    $a = $mk(); $b = $mk(); $c = $mk();
    $now = Tfm\Clock::ms();
    $row = function (int $uid, string $status, ?int $live) use ($now): void {
        Tfm\Db::insert('allot_contracts', ['contract_no' => 'E' . bin2hex(random_bytes(6)), 'unit_id' => 880000 + $uid, 'live_unit_id' => $live, 'customer_id' => 1, 'user_id' => $uid, 'status' => $status,
            'period' => 'year', 'price' => 0, 'term_months' => 12, 'source' => 'admin', 'created_at' => $now, 'updated_at' => $now]);
    };
    $row((int) $a['id'], 'active', 880000 + (int) $a['id']);
    $row((int) $b['id'], 'ended', null);
    $granted = null;
    if (Tfm\Db::hasTable('user_rooms')) {
        Tfm\Db::insert('user_rooms', ['user_id' => (int) $c['id'], 'v' => 0, 'data' => '{}', 'granted' => 1, 'granted_at' => $now, 'updated_at' => $now]);
        $granted = Tfm\Entitle::forUser($c)['features']['myroom'];
    }
    $got = [Tfm\Entitle::forUser($a)['features']['myroom'], Tfm\Entitle::forUser($b)['features']['myroom'], $granted];
    Tfm\Db::exec('DELETE FROM allot_contracts WHERE unit_id >= 880000 AND unit_id < 890000');
    return $got === [true, false, true] || $got === [true, false, null] ? true : j($got);
});
check('토스 — only a tier on sale can be ordered (tier 4: 400 INVALID_TIER by default), an administrator is refused an order (409 ADMIN_FREE), the price is the operator\'s setting', function () use ($mk) {
    $u = $mk();
    $adm = $mk('admin');
    $t4 = apiCode(function () use ($u) { Tfm\Subscription::prepare($u, 4, 'card'); });
    $free = apiCode(function () use ($adm) { Tfm\Subscription::prepare($adm, 2, 'card'); });
    $orders = (int) Tfm\Db::value('SELECT COUNT(*) FROM orders WHERE user_id IN (?, ?)', [(int) $u['id'], (int) $adm['id']]);
    Tfm\Settings::set('sub.price_2', 3900, null);
    Tfm\Settings::set('sub.tiers_on', [2, 3, 4], null);
    $o = Tfm\Subscription::prepare($u, 2, 'card');
    $o4 = Tfm\Subscription::prepare($u, 4, 'card');
    $tiers = Tfm\Subscription::publicTiers();
    Tfm\Settings::clear('sub.price_2', null);
    Tfm\Settings::clear('sub.tiers_on', null);
    $back = Tfm\Subscription::publicTiers();
    return $t4 === '400 INVALID_TIER' && $free === '409 ADMIN_FREE' && $orders === 0 && (int) $o['amount'] === 3900 && (int) $o4['amount'] === 6900
        && array_column($tiers, 'tier') === [2, 3, 4] && $tiers[0]['price'] === 3900 && $tiers[2]['move'] === 3 && $tiers[2]['grow'] === 4
        && array_column($back, 'tier') === [2, 3] && $back[0]['price'] === 2900 ? true : j([$t4, $free, $orders, $o['amount'], $tiers, $back]);
});

// =============================================================================================== 4 · the jar limit in the save validator
/** deep copy of a stdClass save tree */
function cl($o) { return json_decode((string) json_encode($o), false); }
/** a small client state with $owned own jars J1 … and the coins a jar costs taken off (the economy stays explained) */
function state(array $u, int $t, int $owned, int $coin = 40000): stdClass
{
    $jars = [];
    for ($i = 1; $i <= 12; $i++) {
        $jars['J' . $i] = ['owned' => $i <= $owned, 'recipeId' => null, 'status' => 'EMPTY', 'progress' => 0, 'quality' => 0, 'hygiene' => 100, 'startedAt' => 0, 'lastUpdate' => $t];
    }
    $s = [
        'version' => 1, 'createdAt' => $t, 'savedAt' => $t,
        'profile' => ['id' => (string) $u['id'], 'nickname' => $u['nickname'], 'email' => $u['email'], 'role' => $u['role'], 'avatar' => null, 'title' => '', 'titles' => []],
        'stats' => ['level' => 1, 'exp' => 0, 'coin' => $coin - 1500 * max(0, $owned - 1), 'edu' => 0, 'logins' => 1, 'playTime' => 0, 'distance' => 0, 'harvests' => 0, 'crafts' => 0, 'fermentsClaimed' => 0, 'rtHarvests' => 0],
        'player' => ['x' => 0, 'y' => 0, 'z' => 9, 'zoneId' => 'ZONE_MAIN'],
        'inventory' => ['ITEM_MEJU' => 6], 'quests' => new stdClass(), 'farm' => ['plots' => new stdClass()], 'jars' => $jars,
        'education' => ['viewed' => new stdClass(), 'completed' => new stdClass(), 'quiz' => new stdClass()],
        'journal' => [], 'photos' => [], 'achievements' => new stdClass(), 'collection' => new stdClass(), 'visited' => ['ZONE_MAIN' => $t],
        'flags' => new stdClass(), 'activity' => [],
        'rtfarm' => ['beds' => new stdClass(), 'last' => [], 'reports' => []],
        'storage' => ['items' => new stdClass(), 'cap' => 300],
    ];
    return json_decode((string) json_encode($s), false);
}
/** violation codes of a validate() result */
function codes(array $res): array { return array_values(array_unique(array_map(function ($v) { return $v['code']; }, $res['violations']))); }
/** one save: $n against the accepted $p, judged with $ent (growth multiplier = ent.speed.grow, as player/save.php does) */
function judge(stdClass $n, ?stdClass $p, array $u, int $prevAt, int $now, array $meta, ?array $ent): array
{
    return Tfm\SaveValidator::validate(cl($n), $p ? cl($p) : null, $meta, $u, $prevAt, $now, $ent ? (int) $ent['speed']['grow'] : 1, null, $ent);
}
$RECIPE = (string) array_keys((array) Tfm\GameData::all()['recipes'])[0];
$T0 = Tfm\Clock::ms() - 3600000;
/** the ledger of an accepted save of this entitlement (what player/save.php stored with the previous save) */
function ledger(array $ent): array { return ['v' => 1, 'tier' => (int) $ent['speed']['grow'], 'move' => (int) $ent['speed']['move'], 'jars' => (int) $ent['limits']['jars']]; }
check('validator — a brand-new free account: its first save (one jar, nothing else) is accepted; a first save that arrives with four own jars is refused (JAR_LIMIT)', function () use ($mk, $T0) {
    $u = $mk();
    $ent = Tfm\Entitle::forUser($u);
    $one = state($u, $T0, 1, 0);
    $one->inventory = new stdClass();
    $first = judge($one, null, $u, $T0 - 1000, $T0, [], $ent);
    $four = state($u, $T0, 4, 4500);
    $four->inventory = new stdClass();
    $bad = judge($four, null, $u, $T0 - 1000, $T0, [], $ent);
    return $first['ok'] && $first['meta']['jars'] === 3 && $first['meta']['move'] === 1 && !$bad['ok'] && in_array('JAR_LIMIT', codes($bad), true) ? true : j([codes($first), codes($bad)]);
});
check('validator — a free account (limit 3): buying the second and third jar is accepted, a fourth is refused (JAR_LIMIT)', function () use ($mk, $T0) {
    $u = $mk();
    $ent = Tfm\Entitle::forUser($u);
    $p = state($u, $T0, 1); // the accepted state: one jar, coins to spend
    $three = judge(state($u, $T0 + 60000, 3), $p, $u, $T0, $T0 + 60000, ledger($ent), $ent);
    $four = judge(state($u, $T0 + 120000, 4), state($u, $T0 + 60000, 3), $u, $T0 + 60000, $T0 + 120000, $three['meta'], $ent);
    return $three['ok'] && !$four['ok'] && codes($four) === ['JAR_LIMIT'] && $three['meta']['jars'] === 3 ? true : j([codes($three), codes($four)]);
});
check('validator — a paid plan and an administrator (limit 12): twelve own jars are accepted, a thirteenth owned jar is not', function () use ($mk, $paid, $T0) {
    $out = [];
    foreach ([$paid(2), $mk('admin')] as $u) {
        $ent = Tfm\Entitle::forUser($u);
        $p = state($u, $T0, 3);
        $twelve = judge(state($u, $T0 + 60000, 12), $p, $u, $T0, $T0 + 60000, ledger($ent), $ent);
        $n13 = state($u, $T0 + 120000, 12);
        $n13->jars->J13 = cl($n13->jars->J12);
        $n13->stats->coin -= 1500;
        $thirteen = judge($n13, state($u, $T0 + 60000, 12), $u, $T0 + 60000, $T0 + 120000, $twelve['meta'], $ent);
        $out[] = [$ent['limits']['jars'], $twelve['ok'], codes($thirteen)];
    }
    return $out === [[12, true, ['JAR_LIMIT']], [12, true, ['JAR_LIMIT']]] ? true : j($out);
});
check('validator — the plan ends with seven own jars: every save is still accepted and nothing is lost (the jars and what is in them stay in the stored state)', function () use ($paid, $T0, $RECIPE, $DAY) {
    $u = $paid(2);
    $entPaid = Tfm\Entitle::forUser($u);
    $p = state($u, $T0, 7); // accepted while the plan was on
    $p->jars->J5->recipeId = $RECIPE; $p->jars->J5->status = 'FERMENTING'; $p->jars->J5->progress = 40; $p->jars->J5->startedAt = $T0 - 600000;
    $entFree = Tfm\Entitle::forUser($u, null, Tfm\Clock::ms() + 31 * $DAY); // the same account after its period
    $same = cl($p); $same->savedAt = $T0 + 60000;
    $a = judge($same, $p, $u, $T0, $T0 + 60000, ledger($entPaid), $entFree);
    $same2 = cl($same); $same2->savedAt = $T0 + 120000;
    $b = judge($same2, $same, $u, $T0 + 60000, $T0 + 120000, $a['meta'], $entFree);
    $kept = 0;
    foreach ((array) $same2->jars as $jar) if ($jar->owned === true) $kept++;
    return $entPaid['limits']['jars'] === 12 && $entFree['limits']['jars'] === 3 && $a['ok'] && $b['ok'] && $kept === 7 && $same2->jars->J5->recipeId === $RECIPE && $b['meta']['jars'] === 3
        ? true : j([codes($a), codes($b), $kept]);
});
check('validator — locked jars (beyond the first three) keep ripening, but a NEW batch in one is refused (JAR_LOCKED) while a new batch in an unlocked jar is fine', function () use ($paid, $T0, $RECIPE, $DAY) {
    $u = $paid(2);
    $entFree = Tfm\Entitle::forUser($u, null, Tfm\Clock::ms() + 31 * $DAY);
    $p = state($u, $T0, 7);
    $p->jars->J5->recipeId = $RECIPE; $p->jars->J5->status = 'FERMENTING'; $p->jars->J5->progress = 10; $p->jars->J5->startedAt = $T0 - 600000;
    $meta = ['v' => 1, 'tier' => 1, 'move' => 1, 'jars' => 3]; // the plan ended some saves ago
    $ripen = cl($p); $ripen->savedAt = $T0 + 600000; $ripen->jars->J5->progress = 12;
    $r1 = judge($ripen, $p, $u, $T0, $T0 + 600000, $meta, $entFree);
    $locked = cl($p); $locked->savedAt = $T0 + 600000;
    $locked->jars->J6->recipeId = $RECIPE; $locked->jars->J6->status = 'PREPARING'; $locked->jars->J6->startedAt = $T0 + 590000;
    $r2 = judge($locked, $p, $u, $T0, $T0 + 600000, $meta, $entFree);
    $open = cl($p); $open->savedAt = $T0 + 600000;
    $open->jars->J2->recipeId = $RECIPE; $open->jars->J2->status = 'PREPARING'; $open->jars->J2->startedAt = $T0 + 590000;
    $r3 = judge($open, $p, $u, $T0, $T0 + 600000, $meta, $entFree);
    return $r1['ok'] && !$r2['ok'] && codes($r2) === ['JAR_LOCKED'] && $r3['ok'] ? true : j([codes($r1), codes($r2), codes($r3)]);
});
check('validator — the save right after the plan ended is judged once more with the old limit (a jar bought at that very moment is not thrown back), the next one with the new limit', function () use ($paid, $T0, $DAY) {
    $u = $paid(2);
    $entFree = Tfm\Entitle::forUser($u, null, Tfm\Clock::ms() + 31 * $DAY);
    $p = state($u, $T0, 4);
    $n = state($u, $T0 + 60000, 5);
    $once = judge($n, $p, $u, $T0, $T0 + 60000, ['v' => 1, 'tier' => 2, 'move' => 2, 'jars' => 12], $entFree);
    $n2 = state($u, $T0 + 120000, 6);
    $then = judge($n2, $n, $u, $T0 + 60000, $T0 + 120000, $once['meta'], $entFree);
    return $once['ok'] && $once['meta']['jars'] === 3 && !$then['ok'] && codes($then) === ['JAR_LIMIT'] ? true : j([codes($once), $once['meta'], codes($then)]);
});
check('validator — a forged entitlement inside the save (data.ent / data.sub claiming 12 jars) is not read: the fourth jar of a free account stays refused', function () use ($mk, $T0) {
    $u = $mk();
    $ent = Tfm\Entitle::forUser($u);
    $p = state($u, $T0, 3);
    $n = state($u, $T0 + 60000, 4);
    $n->ent = (object) ['v' => 1, 'tier' => 4, 'admin' => true, 'limits' => (object) ['jars' => 12], 'speed' => (object) ['move' => 3, 'grow' => 4]];
    $n->sub = (object) ['tier' => 4, 'status' => 'active', 'expiresAt' => Tfm\Clock::ms() + 9e9, 'autoRenew' => true, 'source' => 'server'];
    $r = judge($n, $p, $u, $T0, $T0 + 60000, ['v' => 1, 'tier' => 1, 'move' => 1, 'jars' => 3], $ent);
    return !$r['ok'] && in_array('JAR_LIMIT', codes($r), true) ? true : j(codes($r));
});
check('validator — movement follows the entitlement: + 600 m in 6 s is refused for a free account and accepted for an administrator (× 3 without a plan)', function () use ($mk, $T0) {
    $free = $mk();
    $adm = $mk('admin');
    $out = [];
    foreach ([$free, $adm] as $u) {
        $ent = Tfm\Entitle::forUser($u);
        $p = state($u, $T0, 1);
        $n = cl($p); $n->savedAt = $T0 + 6000; $n->stats->distance = 600;
        $out[] = codes(judge($n, $p, $u, $T0, $T0 + 6000, ['v' => 1, 'tier' => (int) $ent['speed']['grow'], 'move' => (int) $ent['speed']['move'], 'jars' => (int) $ent['limits']['jars']], $ent));
    }
    return $out === [['DISTANCE_TOO_FAST'], []] ? true : j($out);
});
check('validator — callers that pass no entitlement (older code, tests) are judged exactly as before: no jar rule, movement from the tier', function () use ($mk, $T0) {
    $u = $mk();
    $p = state($u, $T0, 3);
    $n = state($u, $T0 + 60000, 4);
    $r = Tfm\SaveValidator::validate(cl($n), cl($p), ['v' => 1, 'tier' => 1], $u, $T0, $T0 + 60000, 1, null);
    return $r['ok'] && !isset($r['meta']['jars']) ? true : j(codes($r));
});

// =============================================================================================== 5 · login by id, the default administrator, the password
check('login id — 3 to 20 of a-z 0-9 _ in lower case; anything else is refused', function () {
    $ok = array_filter(['admin', 'boss_1', 'abc', str_repeat('a', 20)], function ($s) { return Tfm\Users::validLoginId($s) === null; });
    $bad = array_filter(['', 'ab', 'Admin', 'ad min', 'ad-min', '관리자', str_repeat('a', 21), "admin\n", 'a@b', "admin'--"], function ($s) { return Tfm\Users::validLoginId($s) !== null; });
    return count($ok) === 4 && count($bad) === 10 ? true : count($ok) . ' / ' . count($bad);
});
check('first-run seed — signing in with another name creates nothing; the default id creates admin / admin1234 exactly once (pw_default = 1, audited) and closes the marker', function () {
    $before = (int) Tfm\Db::value("SELECT COUNT(*) FROM users WHERE login_id = 'admin'");
    Tfm\Users::ensureDefaultAdmin('someone');
    Tfm\Users::ensureDefaultAdmin('admin@example.com');
    $still = (int) Tfm\Db::value("SELECT COUNT(*) FROM users WHERE login_id = 'admin'");
    $adminsBefore = Tfm\Users::adminAny();
    // the rules checks above made administrators already: the seed must NOT add one next to them
    Tfm\Users::ensureDefaultAdmin('admin');
    $afterWithAdmins = (int) Tfm\Db::value("SELECT COUNT(*) FROM users WHERE login_id = 'admin'");
    $state = Tfm\Users::defaultAdminState();
    return $before === 0 && $still === 0 && $adminsBefore === true && $afterWithAdmins === 0 && $state === 'done' ? true : j([$before, $still, $adminsBefore, $afterWithAdmins, $state]);
});
check('first-run seed — on a database without an administrator the default id creates the account: login id admin, the default password, the nickname 관리자, pw_default = 1; a second call adds nothing; security.default_admin = false switches it off', function () use ($v7Site) {
    list($use, $back) = $v7Site(false); // an empty v7 database → born into v8 without accounts
    try {
        $use();
        Tfm\Db::pdo();
        Tfm\Config::override('security.default_admin', false);
        Tfm\Users::ensureDefaultAdmin('admin');
        $off = (int) Tfm\Db::value('SELECT COUNT(*) FROM users');
        Tfm\Config::override('security.default_admin', null);
        Tfm\Users::ensureDefaultAdmin(' ADMIN ');
        Tfm\Users::ensureDefaultAdmin('admin');
        $u = Tfm\Users::byLogin('admin');
        $n = (int) Tfm\Db::value('SELECT COUNT(*) FROM users');
        $audit = (int) Tfm\Db::value("SELECT COUNT(*) FROM audit_log WHERE event = 'default_admin_created' AND severity = 'alert'");
        $ent = $u ? Tfm\Entitle::forUser($u) : [];
        return $off === 0 && $n === 1 && $u && $u['login_id'] === 'admin' && $u['role'] === 'admin' && (int) $u['pw_default'] === 1 && $u['nickname'] === '관리자' && $u['email'] === 'admin@local.invalid'
            && Tfm\Users::verifyPassword($u, 'admin1234') && Tfm\Users::defaultAdminState() === 'done' && $audit === 1 && !empty($ent['pwDefault']) && $ent['admin'] === true && Tfm\Users::defaultPasswordCount() === 1
            ? true : j([$off, $n, $u ? [$u['login_id'], $u['role'], $u['pw_default'], $u['nickname'], $u['email']] : null, $audit, $ent]);
    } finally { Tfm\Config::override('security.default_admin', null); $back(); }
});
check('login by id — the form\'s one field finds an account by e-mail, by login id and by nickname; the id is tried before a nickname; an unknown id finds nothing', function () use ($mk) {
    $a = Tfm\Users::createDefaultAdmin('boss_' . bin2hex(random_bytes(2)));
    $byId = Tfm\Users::byLogin((string) $a['login_id']);
    $byMail = Tfm\Users::byLogin((string) $a['email']);
    $byNick = Tfm\Users::byLogin((string) $a['nickname']);
    $u = $mk();
    $plain = Tfm\Users::byLogin((string) $u['nickname']);
    $none = Tfm\Users::byLogin('nobody_here') === null && Tfm\Users::byLoginId("x' OR '1'='1") === null && Tfm\Users::byLoginId('') === null;
    return $byId && $byMail && $byNick && (int) $byId['id'] === (int) $a['id'] && (int) $byMail['id'] === (int) $a['id'] && (int) $byNick['id'] === (int) $a['id']
        && $plain && (int) $plain['id'] === (int) $u['id'] && $u['login_id'] === null && $none && apiCode(function () use ($a) { Tfm\Users::createDefaultAdmin((string) $a['login_id']); }) === '409 LOGIN_ID_TAKEN'
        ? true : 'lookups differ';
});
check('login by id — the throttle is the same as for an e-mail: five wrong passwords for an id lock that id from this address, a login that does not exist locks the same way (no enumeration)', function () {
    $ids = ['admin', 'ghost_' . bin2hex(random_bytes(3))];
    $waits = [];
    foreach ($ids as $id) {
        for ($i = 0; $i < 5; $i++) Tfm\LoginThrottle::record($id, false);
        $waits[] = Tfm\LoginThrottle::ipWait($id) > 0;
        Tfm\LoginThrottle::record($id, true); // a success clears the streak (clean up)
    }
    return $waits === [true, true] ? true : j($waits);
});
check('default password — it can never be chosen again, nor a password with the login id in it; the normal policy applies to the new one', function () {
    $a = Tfm\Users::createDefaultAdmin('keeper' . random_int(100, 999));
    $codes = [];
    foreach (['admin1234', 'short1', 'onlyletters', '12345678', 'xx' . $a['login_id'] . '99', 'password123'] as $pw) {
        $codes[] = apiCode(function () use ($a, $pw) { Tfm\Users::changePassword($a, $pw, 'test'); });
    }
    $still = (int) Tfm\Db::value('SELECT pw_default FROM users WHERE id = ?', [(int) $a['id']]);
    return $codes === array_fill(0, 6, '400 WEAK_PASSWORD') && $still === 1 ? true : j($codes);
});
check('password change — a good new password clears pw_default, ends every session of the account (session_epoch + 1), is audited without the password, and the old one stops working; the same password again is refused', function () {
    $a = Tfm\Users::createDefaultAdmin('owner' . random_int(100, 999));
    $before = (int) Tfm\Db::value("SELECT COUNT(*) FROM audit_log WHERE event = 'password_changed' AND user_id = ?", [(int) $a['id']]);
    $f = Tfm\Users::changePassword($a, 'Hanok2026ferment', 'test');
    $row = Tfm\Db::one("SELECT detail, severity FROM audit_log WHERE event = 'password_changed' AND user_id = ? ORDER BY id DESC LIMIT 1", [(int) $a['id']]);
    $same = apiCode(function () use ($f) { Tfm\Users::changePassword($f, 'Hanok2026ferment', 'test'); });
    $ent = Tfm\Entitle::forUser($f);
    return (int) $f['pw_default'] === 0 && (int) $f['session_epoch'] === (int) $a['session_epoch'] + 1 && (int) $f['password_changed_at'] >= (int) $a['password_changed_at']
        && Tfm\Users::verifyPassword($f, 'Hanok2026ferment') && !Tfm\Users::verifyPassword($f, 'admin1234') && $row && $row['severity'] === 'warn'
        && strpos((string) $row['detail'], 'Hanok') === false && strpos((string) $row['detail'], 'admin1234') === false && strpos((string) $row['detail'], '"wasDefault":true') !== false
        && (int) Tfm\Db::value("SELECT COUNT(*) FROM audit_log WHERE event = 'password_changed' AND user_id = ?", [(int) $a['id']]) === $before + 1 && $same === '400 SAME_PASSWORD' && !isset($ent['pwDefault'])
        ? true : j([$f['pw_default'], $f['session_epoch'], $row, $same]);
});
check('password change — the present password is checked with the login throttle: a wrong one is 401 and five of them lock the form (429)', function () use ($mk) {
    $u = $mk();
    $wrong = apiCode(function () use ($u) { Tfm\Users::confirmPassword($u, 'not-the-password1'); });
    $empty = apiCode(function () use ($u) { Tfm\Users::confirmPassword($u, ''); });
    for ($i = 0; $i < 4; $i++) apiCode(function () use ($u) { Tfm\Users::confirmPassword($u, 'guess' . random_int(1000, 9999)); });
    $locked = apiCode(function () use ($u) { Tfm\Users::confirmPassword($u, 'Ferment2026ok'); });
    Tfm\LoginThrottle::record(mb_strtolower((string) $u['email']), true);
    $right = apiCode(function () use ($u) { Tfm\Users::confirmPassword($u, 'Ferment2026ok'); });
    return $wrong === '401 INVALID_CREDENTIALS' && $empty === '401 INVALID_CREDENTIALS' && $locked === '429 TOO_MANY_ATTEMPTS' && $right === '' ? true : j([$wrong, $empty, $locked, $right]);
});
check('any new password hash ends the default state: Users::update with password_hash (what cli reset-password does) clears pw_default', function () {
    $a = Tfm\Users::createDefaultAdmin('reset' . random_int(100, 999));
    Tfm\Users::update((int) $a['id'], ['password_hash' => Tfm\Users::hashPassword('Onggi2026jangdok'), 'password_changed_at' => Tfm\Clock::ms()], true);
    return (int) Tfm\Db::value('SELECT pw_default FROM users WHERE id = ?', [(int) $a['id']]) === 0;
});
check('health — the row admin_default_password fails while an administrator still uses the default password and is fine once nobody does', function () {
    $find = function (): array { foreach (Tfm\Health::collect(false, null, false)['checks'] as $c) if ($c['id'] === 'admin_default_password') return $c; return []; };
    $a = Tfm\Users::createDefaultAdmin('health' . random_int(100, 999));
    $bad = $find();
    Tfm\Db::exec('UPDATE users SET pw_default = 0 WHERE pw_default = 1');
    $good = $find();
    return isset($bad['status'], $good['status']) && $bad['status'] === 'fail' && strpos((string) $bad['value'], 'admin1234') === false && $bad['hint'] !== '' && $good['status'] === 'ok' ? true : j([$bad, $good]);
});
check('registration rule — an address at the reserved host .invalid is refused for visitors (only the installer\'s placeholder may carry it)', function () {
    return Tfm\Users::validEmail('admin@local.invalid') !== null && Tfm\Users::validEmail('x@y.INVALID') !== null && Tfm\Users::validEmail('admin@local.invalid', true) === null && Tfm\Users::validEmail('kid@example.com') === null;
});

// =============================================================================================== 6 · the installer, the 2-step setting
check('2-step setting — admin.twofa_required: stored on → required; stored off → a config file that says required is relaxed to optional; nothing stored → the config file decides', function () {
    $base = Tfm\AdminTotp::mode();
    Tfm\Settings::set('admin.twofa_required', true, null);
    $on = Tfm\AdminTotp::mode();
    Tfm\Config::override('security.admin_2fa', 'required');
    Tfm\Settings::set('admin.twofa_required', false, null);
    $off = Tfm\AdminTotp::mode();
    Tfm\Settings::clear('admin.twofa_required', null);
    $cfg = Tfm\AdminTotp::mode();
    Tfm\Config::override('security.admin_2fa', null);
    return $base === 'optional' && $on === 'required' && $off === 'optional' && $cfg === 'required' && Tfm\AdminTotp::mode() === 'optional' ? true : j([$base, $on, $off, $cfg]);
});
/** run the command line of the private copy with its own data directory; → [exit code, output] */
$cli = function (string $data, array $args, array $env = [], string $stdin = '') use ($srv): array {
    $cmd = array_merge([PHP_BINARY, $srv . '/cli/tfm.php'], $args);
    $p = proc_open($cmd, [0 => ['pipe', 'r'], 1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes, null, $env + ['TFM_DATA_DIR' => $data, 'TFM_UPLOAD_DIR' => $data . '/uploads', 'PATH' => (string) getenv('PATH')]);
    fwrite($pipes[0], $stdin);
    fclose($pipes[0]);
    $out = stream_get_contents($pipes[1]) . stream_get_contents($pipes[2]);
    return [proc_close($p), (string) $out];
};
check('cli install without any admin value (SQLite): the default administrator admin / admin1234 with pw_default = 1, a loud warning, the marker closed; `cli status` fails on the default password', function () use ($cli, $root, $srv) {
    $data = $root . '/data-cli-a';
    mkdir($data, 0700, true);
    list($code, $out) = $cli($data, ['install', '--driver=sqlite']);
    @unlink($srv . '/config/config.local.php'); // the copy stays unconfigured for the next check
    $pdo = new PDO('sqlite:' . (glob($data . '/*.sqlite') ?: [''])[0], null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
    $u = $pdo->query("SELECT login_id, email, nickname, role, pw_default, password_hash FROM users")->fetchAll(PDO::FETCH_ASSOC);
    $mark = (string) $pdo->query("SELECT v FROM settings WHERE k = 'site.default_admin'")->fetchColumn();
    list($sc, $status) = $cli($data, ['status']);
    return $code === 0 && count($u) === 1 && $u[0]['login_id'] === 'admin' && $u[0]['role'] === 'admin' && (int) $u[0]['pw_default'] === 1 && $u[0]['nickname'] === '관리자' && $u[0]['email'] === 'admin@local.invalid'
        && password_verify('admin1234', (string) $u[0]['password_hash']) && strpos($out, '기본값') !== false && strpos($out, 'reset-password admin --ask') !== false && $mark === '"done"'
        && $sc === 2 && strpos($status, '관리자 기본 비밀번호') !== false ? true : j([$code, $u ? array_diff_key($u[0], ['password_hash' => 1]) : null, $mark, $sc, mb_substr($out, 0, 300)]);
});
check('cli install with other values: the typed id, e-mail, nickname and password are used, pw_default stays 0 and no warning is printed; a weak typed password is refused', function () use ($cli, $root, $srv) {
    $data = $root . '/data-cli-b';
    mkdir($data, 0700, true);
    list($weakCode, $weak) = $cli($data, ['install', '--driver=sqlite', '--admin-id=boss'], ['TFM_ADMIN_PASS' => 'admin1234']);
    @unlink($srv . '/config/config.local.php');
    list($code, $out) = $cli($data, ['install', '--driver=sqlite', '--admin-id=boss', '--admin-email=boss@example.com', '--admin-nick=운영자'], ['TFM_ADMIN_PASS' => 'Hanok2026ferment']);
    @unlink($srv . '/config/config.local.php');
    $pdo = new PDO('sqlite:' . (glob($data . '/*.sqlite') ?: [''])[0], null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
    $u = $pdo->query("SELECT login_id, email, nickname, role, pw_default, password_hash FROM users")->fetchAll(PDO::FETCH_ASSOC);
    return $weakCode !== 0 && strpos($weak, '비밀번호') !== false && $code === 0 && count($u) === 1 && $u[0]['login_id'] === 'boss' && $u[0]['email'] === 'boss@example.com' && $u[0]['nickname'] === '운영자'
        && (int) $u[0]['pw_default'] === 0 && password_verify('Hanok2026ferment', (string) $u[0]['password_hash']) && strpos($out, '기본값') === false && strpos($out, '관리자 로그인 아이디: boss') !== false
        ? true : j([$weakCode, mb_substr($weak, 0, 160), $code, $u ? array_diff_key($u[0], ['password_hash' => 1]) : null, mb_substr($out, 0, 200)]);
});
check('admin tab — AdminSettings::view renders every group with typed inputs and no script, no inline style, no secret value; the banner appears only for an account with pw_default', function () use ($mk) {
    $c = new Tfm\Ctx();
    $c->user = Tfm\Users::byId((int) $mk('admin')['id']);
    $h = Tfm\AdminSettings::view($c, [], 'tok<>"');
    $groups = 0;
    foreach (array_keys(Tfm\Settings::GROUPS) as $g) if (strpos($h, 'id="set-' . $g . '"') !== false) $groups++;
    $noBanner = Tfm\AdminSettings::banner($c, 't') === '';
    $c2 = new Tfm\Ctx();
    $c2->user = Tfm\Users::createDefaultAdmin('tab' . random_int(100, 999));
    $banner = Tfm\AdminSettings::banner($c2, 't');
    $acct = Tfm\AdminSettings::accountView($c2, 't');
    $clean = function (string $x): bool { return !preg_match('/<script|\son[a-z]+\s*=|\sstyle\s*=|javascript:/i', $x); };
    return $groups === count(Tfm\Settings::GROUPS) && $clean($h) && $clean($banner) && $clean($acct) && strpos($h, 'tok&lt;&gt;&quot;') !== false && strpos($h, 'tok<>') === false
        && strpos($h, 'type="number"') !== false && strpos($h, 'name="v[sub.price_2]"') !== false && strpos($h, 'name="v[sub.tiers_on][]"') !== false && strpos($h, 'min="100"') !== false
        && $noBanner && strpos($banner, 'banner danger') !== false && strpos($banner, 'name="password"') !== false && strpos($banner, 'name="current"') === false
        && strpos($acct, 'name="login_id"') !== false ? true : 'groups ' . $groups . ' / ' . mb_substr($banner, 0, 120);
});
check('admin tab — settings_save stores nothing when one value is wrong, stores only what changed, and keeps free ≤ paid; settings_reset restores one value', function () use ($mk) {
    $c = new Tfm\Ctx();
    $c->user = Tfm\Users::byId((int) $mk('admin')['id']);
    $bad = apiCode(function () use ($c) { Tfm\AdminSettings::action('settings_save', $c, ['group' => 'sub', 'v' => ['sub.price_2' => '3900', 'sub.price_3' => '5']]); });
    $kept = Tfm\Settings::get('sub.price_2');
    $order = apiCode(function () use ($c) { Tfm\AdminSettings::action('settings_save', $c, ['group' => 'sub', 'v' => ['limits.jars_free' => '10', 'limits.jars_paid' => '6']]); });
    $r = Tfm\AdminSettings::action('settings_save', $c, ['group' => 'sub', 'v' => ['sub.price_2' => '3900', 'sub.price_3' => '4900'], 'has' => ['sub.tiers_on' => '1']]);
    $stored = [Tfm\Settings::get('sub.price_2'), Tfm\Settings::has('sub.price_3'), Tfm\Settings::get('sub.tiers_on')];
    $none = Tfm\AdminSettings::action('settings_save', $c, ['group' => 'sub', 'v' => ['sub.price_2' => '3900']])['msg'];
    $unknown = apiCode(function () use ($c) { Tfm\AdminSettings::action('settings_save', $c, ['group' => 'nope', 'v' => []]); });
    $reset = Tfm\AdminSettings::action('settings_reset', $c, ['key' => 'sub.price_2'])['msg'];
    $after = Tfm\Settings::get('sub.price_2');
    Tfm\Settings::clear('sub.tiers_on', null);
    $by = (int) Tfm\Db::value("SELECT actor_id FROM audit_log WHERE event = 'setting_changed' ORDER BY id DESC LIMIT 1");
    return $bad === '400 INVALID_SETTING' && $kept === 2900 && $order === '400 INVALID_SETTING' && $stored === [3900, false, []] && strpos($r['msg'], '2개') !== false && $none === '바뀐 값이 없어요.'
        && $unknown === '400 INVALID_SETTING' && strpos($reset, '2,900') !== false && $after === 2900 && $by === (int) $c->user['id'] ? true : j([$bad, $kept, $order, $stored, $r['msg'], $none, $unknown, $reset, $after, $by]);
});

echo PHP_EOL . ($failed === 0 ? "✔ all $passed entitle unit checks passed (driver " . Tfm\Db::driverSafe() . ')' : "✖ $failed of " . ($passed + $failed) . ' entitle unit checks failed (driver ' . Tfm\Db::driverSafe() . ')') . PHP_EOL;
exit($failed === 0 ? 0 : 1);
