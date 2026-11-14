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
        'allot_customers' => ['id', 'user_id', 'name_enc', 'phone_enc', 'phone_hash', 'phone_tail', 'name_hash', 'addr_enc', 'memo', 'consent_at', 'consent_ver', 'guardian', 'purged_at', 'created_at', 'updated_at'],
        'allot_contracts' => ['id', 'contract_no', 'unit_id', 'live_unit_id', 'customer_id', 'user_id', 'status', 'period', 'price', 'term_months', 'starts_at', 'ends_at', 'paid_until', 'paid_total',
            'auto_renew', 'source', 'memo', 'created_by', 'decided_by', 'decided_at', 'cancel_req_at', 'due_stage', 'end_stage', 'ended_at', 'end_reason', 'created_at', 'updated_at'],
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

// =============================================================================================== 2 · settings, zones, the 10,000-unit seed, units, the map
$ADM = ['id' => 0, 'role' => 'admin'];          // the operator at the server machine (CLI) — no account row needed
$NOADM = ['id' => 7, 'role' => 'user'];
$RUN = bin2hex(random_bytes(3));
$nUsers = 0;
/** a fresh app account (unique per run, so a shared MariaDB database can be reused) */
function newUser(string $role = 'user'): array
{
    global $RUN, $nUsers;
    $nUsers++;
    return Tfm\Users::create("allot{$RUN}{$nUsers}@example.com", 'Al' . substr($RUN, 0, 4) . $nUsers, 'Ferment2026ok', $role === 'admin' ? 'admin' : '');
}
/** a valid application form (synthetic person) */
function form(array $over = []): array
{
    global $nUsers;
    return $over + ['name' => '홍길동', 'phone' => '010-5550-' . str_pad((string) (1000 + $nUsers), 4, '0', STR_PAD_LEFT), 'consent' => true, 'consentVersion' => Tfm\Allot::consentVersion(), 'adult' => true];
}

check('Allot::conf — the documented defaults (hold 48 h, 3 per account, approval off, grace 14, notices 30/7/0, never auto-end, offers 48 h, 5 years, …)', function () {
    $r = Tfm\Allot::rules();
    $want = ['enabled' => true, 'hold_hours' => 48, 'apply_per_user' => 3, 'auto_approve' => 'off', 'grace_days' => 14, 'notice_days' => [30, 7, 0], 'overdue_end_days' => 0, 'waitlist_offer_hours' => 48,
        'retention_days' => 1825, 'collect_address' => false, 'nameplate_default_show' => false, 'toss_enabled' => false, 'lazy_tick_minutes' => 15, 'tick_batch' => 500, 'daily_report_mail' => false];
    foreach ($want as $k => $v) if (!array_key_exists($k, $r) || $r[$k] !== $v) return "$k = " . json_encode($r[$k] ?? null);
    return Tfm\Allot::conf('hold_hours') === 48 && is_string($r['consent_version']) && $r['consent_version'] !== '';
});
check('Allot::saveSettings — an admin changes rules and texts (stored in settings, audited without the text); bad values and non-admins are refused', function () use ($ADM, $NOADM) {
    if (!throwsApi(function () use ($NOADM) { Tfm\Allot::saveSettings($NOADM, ['grace_days' => 3]); }, 'FORBIDDEN', 403)) return 'a non-admin could save';
    if (!throwsApi(function () use ($ADM) { Tfm\Allot::saveSettings($ADM, ['auto_approve' => 'sometimes']); }, 'INVALID_INPUT', 400)) return 'bad enum accepted';
    if (!throwsApi(function () use ($ADM) { Tfm\Allot::saveSettings($ADM, ['no_such_rule' => 1]); }, 'INVALID_INPUT', 400)) return 'unknown key accepted';
    $v0 = Tfm\Allot::consentVersion();
    $r = Tfm\Allot::saveSettings($ADM, ['grace_days' => '21', 'notice_days' => '14, 3,0, 3', 'privacy_text' => "첫 줄이에요\r\n둘째 줄 SECRETTEXT-9911"]);
    $ok = Tfm\Allot::conf('grace_days') === 21 && Tfm\Allot::conf('notice_days') === [14, 3, 0] && strpos(Tfm\Allot::texts()['privacy'], "첫 줄이에요\n둘째 줄") === 0
        && Tfm\Allot::consentVersion() !== $v0 && in_array('privacy_text', $r['changed'], true);
    $audit = (string) Tfm\Db::value("SELECT detail FROM audit_log WHERE event = 'allot_settings' ORDER BY id DESC LIMIT 1");
    $leak = strpos($audit, 'SECRETTEXT') !== false;
    Tfm\Allot::saveSettings($ADM, ['grace_days' => 14, 'notice_days' => [30, 7, 0], 'privacy_text' => '']);   // back to the defaults
    return $ok && !$leak && Tfm\Allot::conf('grace_days') === 14 && Tfm\Allot::texts()['sample'] === true && Tfm\Allot::consentVersion() === $v0 ? true : json_encode([$ok, $leak, Tfm\Allot::rules()]);
});
check('Allot::texts — example texts are marked 예시 and make no health claim; the consent version follows the texts', function () {
    $t = Tfm\Allot::texts();
    foreach (['terms', 'privacy', 'refund', 'payGuide'] as $k) {
        if (!isset($t[$k]) || mb_strpos($t[$k], '예시') === false) return "$k is not marked 예시";
        if (preg_match('/치료|예방|낫|효능|면역/u', $t[$k])) return "$k carries a health claim";
    }
    return $t['sample'] === true && preg_match('/^[\w.\-]{3,40}$/', Tfm\Allot::consentVersion()) === 1;
});

check('Allot::saveZone — creates a zone (code upper-cased, validated), updates it, refuses non-admins, bad codes / periods / prices', function () use ($ADM, $NOADM) {
    if (!throwsApi(function () use ($NOADM) { Tfm\Allot::saveZone($NOADM, ['code' => 'X1', 'kind' => 'jar', 'name' => 'x']); }, 'FORBIDDEN', 403)) return 'non-admin';
    foreach ([['code' => 'bad code!', 'kind' => 'jar'], ['code' => 'T1', 'kind' => 'pond'], ['code' => 'T1', 'kind' => 'jar', 'period' => 'week'], ['code' => 'T1', 'kind' => 'jar', 'price' => -5],
        ['code' => 'T1', 'kind' => 'jar', 'price' => 20000000], ['code' => 'T1', 'kind' => 'jar', 'period' => 'once', 'termMonths' => 0], ['code' => 'T1', 'kind' => 'jar', 'capacity' => 6000]] as $bad) {
        if (!throwsApi(function () use ($ADM, $bad) { Tfm\Allot::saveZone($ADM, $bad + ['name' => '시험']); }, 'INVALID_INPUT', 400)) return 'accepted: ' . json_encode($bad);
    }
    $z = Tfm\Allot::saveZone($ADM, ['code' => 't1', 'kind' => 'jar', 'name' => '시험 장독대', 'capacity' => 30, 'cols' => 10, 'price' => 120000, 'period' => 'year', 'termMonths' => 12, 'isOpen' => true]);
    if ($z['code'] !== 'T1' || $z['capacity'] !== 30 || $z['isOpen'] !== true || $z['units'] !== 30) return json_encode($z);
    $z2 = Tfm\Allot::saveZone($ADM, ['id' => $z['id'], 'name' => '시험 장독대 A', 'price' => 130000, 'kind' => 'plot', 'code' => 'ZZ9']);   // kind / code never change
    return $z2['name'] === '시험 장독대 A' && $z2['price'] === 130000 && $z2['kind'] === 'jar' && $z2['code'] === 'T1' && $z2['ver'] > $z['ver'] ? true : json_encode($z2);
});
check('Allot::seedUnits — idempotent; growing appends seq; shrinking removes only free units at the end that never had a contract', function () use ($ADM) {
    $z = Tfm\Allot::zone('T1');
    $again = Tfm\Allot::seedUnits($ADM, 'T1', 30);
    $more = Tfm\Allot::seedUnits($ADM, 'T1', 40);
    $codes = array_map(function ($r) { return $r['code']; }, Tfm\Db::all('SELECT code FROM allot_units WHERE zone_id = ? ORDER BY seq', [$z['id']]));
    $less = Tfm\Allot::seedUnits($ADM, 'T1', 35);
    $n = (int) Tfm\Db::value('SELECT COUNT(*) FROM allot_units WHERE zone_id = ?', [$z['id']]);
    return $again === 0 && $more === 10 && count($codes) === 40 && $codes[0] === 'T1-0001' && $codes[39] === 'T1-0040' && $less === -5 && $n === 35 && Tfm\Allot::zone('T1')['capacity'] === 35
        ? true : json_encode([$again, $more, $less, $n]);
});
check('Allot::listUnits — keyset pages (afterId), filters by zone / status / code, no OFFSET', function () use ($ADM) {
    $p1 = Tfm\Allot::listUnits(['zone' => 'T1'], 20, 0);
    $p2 = Tfm\Allot::listUnits(['zone' => 'T1'], 20, $p1['next']);
    $one = Tfm\Allot::listUnits(['q' => 'T1-0007'], 5, 0);
    $none = Tfm\Allot::listUnits(['zone' => 'T1', 'status' => 'leased'], 5, 0);
    return count($p1['rows']) === 20 && $p1['next'] === $p1['rows'][19]['id'] && count($p2['rows']) === 15 && $p2['next'] === 0 && $p2['rows'][0]['id'] > $p1['rows'][19]['id']
        && count($one['rows']) === 1 && $one['rows'][0]['code'] === 'T1-0007' && $one['rows'][0]['status'] === 'open' && $none['rows'] === [] ? true : json_encode([count($p1['rows']), $p1['next'], count($p2['rows']), $p2['next']]);
});
check('Allot::setUnitState — an admin closes / re-opens / holds a free unit; each change bumps the map version', function () use ($ADM, $NOADM) {
    $u = Tfm\Allot::unit('T1-0035');
    $v0 = Tfm\Allot::mapVersion();
    if (!throwsApi(function () use ($NOADM, $u) { Tfm\Allot::setUnitState($NOADM, $u['id'], 'closed'); }, 'FORBIDDEN')) return 'non-admin';
    $c = Tfm\Allot::setUnitState($ADM, $u['id'], 'closed');
    $v1 = Tfm\Allot::mapVersion();
    $o = Tfm\Allot::setUnitState($ADM, $u['id'], 'open');
    $h = Tfm\Allot::setUnitState($ADM, $u['id'], 'held', 24);
    $v2 = Tfm\Allot::mapVersion();
    Tfm\Allot::setUnitState($ADM, $u['id'], 'open');
    return $c['status'] === 'closed' && $o['status'] === 'open' && $h['status'] === 'held' && $h['holdUntil'] > Tfm\Clock::ms() && $v1 > $v0 && $v2 > $v1 ? true : json_encode([$c, $o, $h, $v0, $v1, $v2]);
});
check('Allot::map — one character per unit (o / h / l / c), no personal data, an unchanged version answers {v, same}', function () use ($ADM) {
    $u = Tfm\Allot::unit('T1-0003');
    Tfm\Allot::setUnitState($ADM, $u['id'], 'closed');
    $m = Tfm\Allot::map();
    $z = null;
    foreach ($m['zones'] as $x) if ($x['code'] === 'T1') $z = $x;
    if (!$z) return 'zone T1 missing';
    $same = Tfm\Allot::map(null, null, $m['v']);
    $old = Tfm\Allot::map(null, null, $m['v'] - 1);
    Tfm\Allot::setUnitState($ADM, $u['id'], 'open');
    $keys = array_keys($z);
    sort($keys);
    return strlen($z['s']) === 35 && $z['s'][2] === 'c' && $z['s'][0] === 'o' && $z['cap'] === 35 && $z['cols'] === 10 && $z['open'] === true && $z['kind'] === 'jar'
        && $keys === ['cap', 'code', 'cols', 'kind', 'name', 'open', 's'] && $same === ['v' => $m['v'], 'same' => true] && isset($old['zones']) && Tfm\Allot::map()['v'] > $m['v']
        ? true : json_encode([$z, $same]);
});
check('Allot::map — filters by kind and by zone code; an unknown zone is an empty list', function () {
    $k = Tfm\Allot::map('plot');
    $z = Tfm\Allot::map(null, 'T1');
    $x = Tfm\Allot::map(null, 'NOPE');
    return $k['zones'] === [] && count($z['zones']) === 1 && $z['zones'][0]['code'] === 'T1' && $x['zones'] === [] ? true : json_encode([$k, $x]);
});

// ---- the default preset: 10,000 units (6 jar zones × 1,000, 3 plot zones × 1,000, 2 store zones × 500)
$seedMs = 0.0;
check('allot:seed (default preset) — 11 zones, exactly 10,000 units, example prices, zones closed until the operator opens them', function () use ($ADM, &$seedMs) {
    $t = microtime(true);
    $r = Tfm\Allot::seedPreset($ADM, 'default');
    $seedMs = (microtime(true) - $t) * 1000;
    $byKind = [];
    foreach (Tfm\Db::all("SELECT kind, COUNT(*) AS n FROM allot_units WHERE code NOT LIKE 'T1-%' GROUP BY kind") as $x) $byKind[$x['kind']] = (int) $x['n'];
    $zones = Tfm\Db::all("SELECT code, kind, capacity, is_open, note FROM allot_zones WHERE code <> 'T1' ORDER BY sort, id");
    $closed = count(array_filter($zones, function ($z) { return (int) $z['is_open'] === 0; }));
    $sample = count(array_filter($zones, function ($z) { return mb_strpos((string) $z['note'], '예시') !== false; }));
    return $r['units'] === 10000 && $r['zones'] === 11 && $byKind === ['jar' => 6000, 'plot' => 3000, 'store' => 1000] && count($zones) === 11 && $closed === 11 && $sample === 11
        ? true : json_encode([$r, $byKind, count($zones), $closed, $sample]);
});
check('allot:seed — measured: 10,000 units in under 5 s (SQLite; MariaDB is reported)', function () use (&$seedMs) {
    echo '      seed of 10,000 units: ' . round($seedMs) . ' ms (' . Tfm\Db::driver() . ')' . PHP_EOL;
    return Tfm\Db::driver() !== 'sqlite' || $seedMs < 5000 ? true : round($seedMs) . ' ms';
});
check('allot:seed — a second run adds nothing (idempotent) and keeps what the operator changed', function () use ($ADM) {
    Tfm\Allot::saveZone($ADM, ['code' => 'J01', 'price' => 99000, 'isOpen' => true]);
    $r = Tfm\Allot::seedPreset($ADM, 'default');
    $z = Tfm\Allot::zone('J01');
    return $r['added'] === 0 && (int) Tfm\Db::value("SELECT COUNT(*) FROM allot_units WHERE code NOT LIKE 'T1-%'") === 10000 && $z['price'] === 99000 && $z['isOpen'] === true ? true : json_encode([$r, $z]);
});
check('Allot::map — measured: the whole 10,000-unit map under 50 ms cold (rebuilt from the units) and warm (stored strings) on SQLite', function () {
    Tfm\Db::exec('UPDATE allot_zones SET map_ver = 0, map_s = NULL');
    Tfm\Allot::forget();
    $t = microtime(true);
    $cold = Tfm\Allot::map();
    $coldMs = (microtime(true) - $t) * 1000;
    Tfm\Allot::forget();
    $t = microtime(true);
    $warm = Tfm\Allot::map();
    $warmMs = (microtime(true) - $t) * 1000;
    Tfm\Allot::forget();
    $t = microtime(true);
    $same = Tfm\Allot::map(null, null, $warm['v']);
    $sameMs = (microtime(true) - $t) * 1000;
    $units = 0;
    foreach ($warm['zones'] as $z) $units += strlen($z['s']);
    $bytes = strlen((string) json_encode($warm));
    echo sprintf('      map: cold %.1f ms, warm %.1f ms, unchanged-version answer %.2f ms, %d units, %d bytes JSON (%s)', $coldMs, $warmMs, $sameMs, $units, $bytes, Tfm\Db::driver()) . PHP_EOL;
    $fast = Tfm\Db::driver() !== 'sqlite' || ($coldMs < 50 && $warmMs < 50);
    return $units === 10035 && $cold['zones'] === $warm['zones'] && $same === ['v' => $warm['v'], 'same' => true] && $fast ? true : "cold $coldMs ms, warm $warmMs ms, units $units";
});
check('Allot::summary — public numbers per kind and status, no prices, no personal data', function () {
    $s = Tfm\Allot::summary();
    $flat = json_encode($s);
    return $s['total'] === 10035 && $s['open'] === 10035 && $s['byKind']['jar']['total'] === 6035 && $s['byKind']['store']['open'] === 1000 && $s['leased'] === 0
        && strpos($flat, 'price') === false && $s['v'] === Tfm\Allot::mapVersion() ? true : $flat;
});

// SECTION-MARK (the following sections are appended as the library grows)

echo PHP_EOL . ($failed === 0 ? "✔ all $passed allot unit checks passed" : "✖ $failed of " . ($failed + $passed) . " allot check(s) failed") . ' (driver ' . Tfm\Db::driverSafe() . ')' . PHP_EOL;
exit($failed === 0 ? 0 : 1);
