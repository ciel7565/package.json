<?php
/**
 * tests/allot-unit.php — unit checks for the allotment (분양) server (CONTRACT §16.7): schema v7 and the migration of a v6
 * site, Tfm\Allot (zones, the 10,000-unit seed, the double-allocation guard, periods, customers with sealed personal
 * data, the waiting list, notices, care logs, nameplates, the map, CSV, statistics), every step of Allot::tick with an
 * injected clock, the parallel race, the 토스 one-time payment in mock mode and the key rotation.
 * No web server: a throw-away SQLite database in the temp dir — or MariaDB with the TFM_DB_* variables:
 *
 *   php tests/allot-unit.php
 *   TFM_DB_DRIVER=mysql TFM_DB_HOST=127.0.0.1 TFM_DB_PORT=33106 TFM_DB_USER=root TFM_DB_NAME=tfm_as_unit php tests/allot-unit.php
 *   (the MariaDB database must exist and be EMPTY of allot rows: the seed / timing checks count on a fresh database;
 *    the migration check creates and drops <TFM_DB_NAME>_mig)
 *
 * Every check runs inside its own try/catch: a missing class / method is that check's FAIL (with the error message)
 * instead of the end of the run. TFM_UNIT_ONLY=<text> runs only the checks whose name contains <text> (the set-up
 * between checks still runs).
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
// A private copy of the server tree (the CLI checks and the parallel processes run from it; the key rotation rewrites
// data/secret.php, which must never happen inside the repository). The data directory is separate.
$root = sys_get_temp_dir() . '/tfm-allot-' . bin2hex(random_bytes(6));
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
/** did $fn throw an ApiException with $code (and, when given, HTTP $status) */
function throwsApi(callable $fn, string $code, int $status = 0): bool
{
    try { $fn(); } catch (Tfm\ApiException $e) { return $e->errorCode === $code && ($status === 0 || $e->status === $status); }
    return false;
}
/** the ApiException a call throws as "status CODE" ('' = none) */
function apiCode(callable $fn): string
{
    try { $fn(); } catch (Tfm\ApiException $e) { return $e->status . ' ' . $e->errorCode; }
    return '';
}

$IS_MYSQL = strtolower((string) Tfm\Config::get('db.driver', 'sqlite')) === 'mysql';
$DAY = 86400000;

// =============================================================================================== 1 · schema v7
/** does the table exist on the current connection */
function hasTable(string $t): bool
{
    try { Tfm\Db::run('SELECT 1 FROM ' . preg_replace('/[^a-z_]/', '', $t) . ' WHERE 1 = 0'); return true; } catch (Throwable $e) { return false; }
}
const ALLOT_TABLES = ['allot_zones', 'allot_units', 'allot_customers', 'allot_contracts', 'allot_payments', 'allot_waitlist', 'allot_notices',
    'allot_care_logs', 'allot_stats_daily', 'allot_terms', 'job_runs', 'cache_kv'];

check('schema — Db::SCHEMA_VERSION is 7 and a fresh database is created at version 7', function () {
    Tfm\Db::pdo();
    return Tfm\Db::SCHEMA_VERSION === 7 && Tfm\Db::schemaVersion() === 7 ? true : 'code ' . Tfm\Db::SCHEMA_VERSION . ', database ' . Tfm\Db::schemaVersion();
});
echo 'driver: ' . Tfm\Db::driverSafe() . PHP_EOL;
check('schema — every v7 table exists (allot_*, job_runs, cache_kv)', function () {
    $missing = array_values(array_filter(ALLOT_TABLES, function ($t) { return !hasTable($t); }));
    return $missing === [] ? true : 'missing: ' . implode(', ', $missing);
});
check('schema — the columns the library relies on exist (both schema files agree)', function () {
    $want = [
        'allot_zones' => ['id', 'code', 'kind', 'name', 'capacity', 'cols', 'sort', 'price', 'period', 'term_months', 'is_open', 'note', 'ver', 'map_ver', 'map_s', 'created_at', 'updated_at'],
        'allot_units' => ['id', 'zone_id', 'kind', 'code', 'seq', 'status', 'contract_id', 'hold_until', 'label', 'label_show', 'created_at', 'updated_at'],
        'allot_customers' => ['id', 'user_id', 'name_enc', 'phone_enc', 'phone_hash', 'phone_tail', 'addr_enc', 'memo', 'consent_at', 'consent_ver', 'guardian', 'purged_at', 'created_at', 'updated_at'],
        'allot_contracts' => ['id', 'contract_no', 'unit_id', 'live_unit_id', 'customer_id', 'user_id', 'status', 'period', 'price', 'term_months', 'starts_at', 'ends_at', 'paid_until', 'paid_total',
            'auto_renew', 'source', 'memo', 'created_by', 'decided_by', 'decided_at', 'cancel_req_at', 'ended_at', 'end_reason', 'created_at', 'updated_at'],
        'allot_payments' => ['id', 'contract_id', 'customer_id', 'kind', 'method', 'amount', 'periods', 'order_id', 'payment_key_enc', 'claim', 'claimed_at', 'idem', 'status', 'toss_status',
            'paid_at', 'period_from', 'period_to', 'memo', 'created_by', 'created_at', 'updated_at'],
        'allot_waitlist' => ['id', 'kind', 'zone_id', 'customer_id', 'user_id', 'live_key', 'status', 'unit_id', 'offer_until', 'created_at', 'updated_at'],
        'allot_notices' => ['id', 'contract_id', 'customer_id', 'user_id', 'kind', 'dedupe_key', 'title', 'body', 'status', 'send_at', 'sent_at', 'seen_at', 'created_by', 'created_at'],
        'allot_care_logs' => ['id', 'zone_id', 'unit_id', 'kind', 'text', 'visible', 'created_by', 'created_at'],
        'allot_stats_daily' => ['day', 'zone_id', 'n_open', 'n_held', 'n_leased', 'n_closed', 'n_pending', 'n_active', 'n_overdue', 'n_ended', 'revenue', 'updated_at'],
        'allot_terms' => ['id', 'ver', 'privacy_text', 'terms_text', 'refund_text', 'created_at'],
        'job_runs' => ['id', 'job', 'source', 'started_at', 'finished_at', 'ok', 'summary'],
        'cache_kv' => ['k', 'v', 'expires_at'],
    ];
    $bad = [];
    foreach ($want as $t => $cols) foreach ($cols as $c) if (!Tfm\Db::hasColumn($t, $c)) $bad[] = "$t.$c";
    return $bad === [] ? true : 'missing: ' . implode(', ', $bad);
});
check('schema — the nullable unique keys accept many NULLs and refuse a second live value (live_unit_id, order_id, idem, dedupe_key, live_key, user_id)', function () {
    $now = Tfm\Clock::ms();
    return Tfm\Db::tx(function () use ($now) {
        $mk = function (?int $live) use ($now): int {
            return Tfm\Db::insert('allot_contracts', ['contract_no' => 'T' . bin2hex(random_bytes(6)), 'unit_id' => 999001, 'live_unit_id' => $live, 'customer_id' => 1, 'user_id' => null, 'status' => 'ended',
                'period' => 'year', 'price' => 0, 'term_months' => 12, 'source' => 'admin', 'created_at' => $now, 'updated_at' => $now]);
        };
        $a = $mk(null); $b = $mk(null); $c = $mk(999001);
        $dup = '';
        try { $mk(999001); } catch (PDOException $e) { $dup = (string) $e->getCode(); }
        Tfm\Db::exec('DELETE FROM allot_contracts WHERE unit_id = 999001');
        return $a > 0 && $b > $a && $c > $b && $dup === '23000' ? true : "second live row → SQLSTATE '$dup'";
    });
});
check('schema — re-running the schema file on a v7 database changes nothing (idempotent)', function () {
    $file = TFM_ROOT . '/database/' . (Tfm\Db::driver() === 'mysql' ? 'schema.sql' : 'schema.sqlite.sql');
    $before = (int) Tfm\Db::value('SELECT COUNT(*) FROM schema_version');
    foreach (Tfm\Db::splitSql((string) file_get_contents($file)) as $s) Tfm\Db::pdo()->exec($s);
    return (int) Tfm\Db::value('SELECT COUNT(*) FROM schema_version') === $before && Tfm\Db::schemaVersion() === 7;
});

/**
 * A v6 site: the schema file up to the "-- v7" block on a new database, with a row in users / settings. Returns a
 * function that points Tfm\Db at it and one that goes back to the test database (and removes the v6 one).
 */
$v6Site = function () use ($IS_MYSQL, $tmp): array {
    $file = TFM_ROOT . '/database/' . ($IS_MYSQL ? 'schema.sql' : 'schema.sqlite.sql');
    $sql = (string) file_get_contents($file);
    $cut = strpos($sql, "\n-- v7 (");
    if ($cut === false) throw new RuntimeException('the schema file has no "-- v7 (" block');
    $head = substr($sql, 0, $cut);
    $now = Tfm\Clock::ms();
    if ($IS_MYSQL) {
        $m = (array) Tfm\Config::get('db.mysql', []);
        $name = (string) $m['database'] . '_mig';
        $adminPdo = Tfm\Db::connectMysql($m, false);
        $adminPdo->exec('DROP DATABASE IF EXISTS `' . $name . '`');
        $adminPdo->exec('CREATE DATABASE `' . $name . '` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci');
        $pdo = Tfm\Db::connectMysql(['database' => $name] + $m);
        foreach (Tfm\Db::splitSql($head) as $s) $pdo->exec($s);
        $pdo->exec("INSERT INTO users (email, nickname, nickname_key, password_hash, created_at, updated_at) VALUES ('old@example.com', 'OldSite', 'oldsite', 'x', $now, $now)");
        $pdo->exec("INSERT INTO settings (k, v, updated_at) VALUES ('farm.rt_scale', '2', $now)");
        $use = function () use ($name) { Tfm\Config::override('db.mysql.database', $name); Tfm\Db::reset(); };
        $back = function () use ($adminPdo, $name) { Tfm\Config::override('db.mysql.database', null); Tfm\Config::override('db.auto_migrate', null); Tfm\Db::reset(); $adminPdo->exec('DROP DATABASE IF EXISTS `' . $name . '`'); };
        return [$use, $back];
    }
    $path = $tmp . '/v6-' . bin2hex(random_bytes(4)) . '.sqlite';
    $pdo = new PDO('sqlite:' . $path, null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
    foreach (Tfm\Db::splitSql($head) as $s) $pdo->exec($s);
    $pdo->exec("INSERT INTO users (email, nickname, nickname_key, password_hash, created_at, updated_at) VALUES ('old@example.com', 'OldSite', 'oldsite', 'x', $now, $now)");
    $pdo->exec("INSERT INTO settings (k, v, updated_at) VALUES ('farm.rt_scale', '2', $now)");
    $pdo = null;
    $use = function () use ($path) { Tfm\Config::override('db.sqlite_path', $path); Tfm\Db::reset(); };
    $back = function () use ($path) { Tfm\Config::override('db.sqlite_path', null); Tfm\Config::override('db.auto_migrate', null); Tfm\Db::reset(); foreach (['', '-wal', '-shm'] as $x) @unlink($path . $x); };
    return [$use, $back];
};
check('migration — a v6 site (auto_migrate on) is upgraded to v7 on the first request; its rows stay', function () use ($v6Site) {
    list($use, $back) = $v6Site();
    try {
        $use();
        $pdo = Tfm\Db::pdo(); // migrates
        $v = Tfm\Db::schemaVersion();
        $missing = array_values(array_filter(ALLOT_TABLES, function ($t) { return !hasTable($t); }));
        $old = (string) Tfm\Db::value("SELECT nickname FROM users WHERE email = 'old@example.com'");
        $set = (string) Tfm\Db::value("SELECT v FROM settings WHERE k = 'farm.rt_scale'");
        $rows6 = (int) Tfm\Db::value('SELECT COUNT(*) FROM schema_version WHERE version = 6');
        return $v === 7 && $missing === [] && $old === 'OldSite' && $set === '2' && $rows6 === 1 ? true : json_encode([$v, $missing, $old, $set, $rows6]);
    } finally { $back(); }
});
check('migration — a v6 site with db.auto_migrate off answers 503 SCHEMA_OUTDATED until the upgrade (cli migrate) runs', function () use ($v6Site) {
    list($use, $back) = $v6Site();
    try {
        $use();
        Tfm\Config::override('db.auto_migrate', false);
        $code = apiCode(function () { Tfm\Db::pdo(); });
        $again = apiCode(function () { Tfm\Db::one('SELECT 1'); });
        $after = Tfm\Db::upgrade(); // what `php cli/tfm.php migrate` does with the configured account
        $ok = hasTable('allot_units') && Tfm\Db::schemaVersion() === 7;
        return $code === '503 SCHEMA_OUTDATED' && $again === '503 SCHEMA_OUTDATED' && $after === 7 && $ok ? true : json_encode([$code, $again, $after, $ok]);
    } finally { $back(); }
});
check('migration — back on the test database (version 7)', function () {
    return Tfm\Db::schemaVersion() === 7 && hasTable('allot_units');
});

// SECTION-MARK (the following sections are appended as the library grows)

echo PHP_EOL . ($failed === 0 ? "✔ all $passed allot unit checks passed" : "✖ $failed of " . ($failed + $passed) . " allot check(s) failed") . ' (driver ' . Tfm\Db::driverSafe() . ')' . PHP_EOL;
exit($failed === 0 ? 0 : 1);
