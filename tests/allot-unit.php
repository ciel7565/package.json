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

// =============================================================================================== 3 · customers, applications, contracts
/** the allot_units row of a code */
function unitRow(string $code): array { return (array) Tfm\Db::one('SELECT * FROM allot_units WHERE code = ?', [$code]); }
/** the allot_contracts row of a contract number */
function conRow(string $no): array { return (array) Tfm\Db::one('SELECT * FROM allot_contracts WHERE contract_no = ?', [$no]); }
/** every stored value of the allot tables + audit + security events as one text (leak checks) */
function dumpAll(): string
{
    $out = '';
    foreach (array_merge(ALLOT_TABLES, ['audit_log', 'security_events', 'settings']) as $t) {
        if ($t === 'cache_kv' || $t === 'allot_terms') continue;
        foreach (Tfm\Db::all('SELECT * FROM ' . $t) as $r) $out .= implode("\x1f", array_map('strval', array_values($r))) . "\n";
    }
    return $out;
}
$T0 = Tfm\Clock::ms();
$U1 = newUser();
$PHONE1 = '010-7391-4625';
$NAME1 = '설문대할망';
$A1 = null;
check('apply — a pending contract: the unit is held for hold_hours, the plan is copied, the contract number is not guessable, the map shows h', function () use ($U1, $PHONE1, $NAME1, $T0, &$A1, $DAY) {
    $v0 = Tfm\Allot::mapVersion();
    $A1 = Tfm\Allot::apply($U1, 'T1-0001', form(['name' => $NAME1, 'phone' => $PHONE1]), $T0);
    $u = unitRow('T1-0001');
    $c = conRow($A1['contractNo']);
    $m = Tfm\Allot::map(null, 'T1');
    if (!preg_match('/^A\d\d-[2-9A-HJKMNP-TV-Z]{5}-[2-9A-HJKMNP-TV-Z]{5}$/', $A1['contractNo'])) return 'number: ' . $A1['contractNo'];
    return $A1['status'] === 'pending' && $A1['unit'] === 'T1-0001' && $A1['holdUntil'] === $T0 + 48 * 3600000 && $u['status'] === 'held' && (int) $u['contract_id'] === (int) $c['id']
        && (int) $u['hold_until'] === $T0 + 48 * 3600000 && (int) $c['live_unit_id'] === (int) $u['id'] && $c['status'] === 'pending' && $c['period'] === 'year' && (int) $c['price'] === 130000
        && (int) $c['term_months'] === 12 && $c['source'] === 'app' && (int) $c['user_id'] === (int) $U1['id'] && (int) $c['starts_at'] === 0 && $m['zones'][0]['s'][0] === 'h' && $m['v'] > $v0
        && is_array($A1['pay']) && $A1['pay']['toss'] === false && !isset($A1['pay']['amount']) ? true : json_encode([$A1, $u, $c]);
});
check('apply — name, phone and the customer row: sealed at rest (enc:v1:), blind index + last 4 digits only, consent recorded with its version', function () use ($U1, $PHONE1, $NAME1, $T0) {
    $c = (array) Tfm\Db::one('SELECT * FROM allot_customers WHERE user_id = ?', [(int) $U1['id']]);
    $dump = dumpAll();
    foreach ([$NAME1, '01073914625', '7391-4625', '73914625'] as $plain) if (strpos($dump, $plain) !== false) return "plaintext '$plain' is stored";
    return strpos($c['name_enc'], 'enc:v1:') === 0 && strpos($c['phone_enc'], 'enc:v1:') === 0 && Tfm\Crypto::open($c['name_enc']) === $NAME1 && Tfm\Crypto::open($c['phone_enc']) === '01073914625'
        && $c['phone_tail'] === '4625' && strlen($c['phone_hash']) === 32 && strlen($c['name_hash']) === 32 && (int) $c['consent_at'] === $T0 && $c['consent_ver'] === Tfm\Allot::consentVersion()
        && $c['addr_enc'] === null && (int) Tfm\Db::value('SELECT COUNT(*) FROM allot_terms WHERE ver = ?', [$c['consent_ver']]) === 1 ? true : json_encode($c);
});
check('apply — the applicant gets a notice in the inbox (no amount in it); mine() lists the contract without any price', function () use ($U1, $A1) {
    $in = Tfm\Allot::inbox((int) $U1['id']);
    $mine = Tfm\Allot::mine((int) $U1['id']);
    $flat = json_encode([$in, $mine], JSON_UNESCAPED_UNICODE);
    $c = $mine['contracts'][0];
    return count($in['notices']) === 1 && $in['notices'][0]['kind'] === 'applied' && $in['unread'] === 1 && $in['notices'][0]['seen'] === false && $in['notices'][0]['contractNo'] === $A1['contractNo']
        && count($mine['contracts']) === 1 && $c['contractNo'] === $A1['contractNo'] && $c['status'] === 'pending' && $c['unit']['code'] === 'T1-0001' && $c['unit']['kind'] === 'jar'
        && $mine['limit'] === ['max' => 3, 'used' => 1] && $mine['unread'] === 1
        && !preg_match('/price|amount|130000|13만|원\b/u', $flat) ? true : $flat;
});
check('apply — consent === true, adult === true and the current consent version are required (400 CONSENT_REQUIRED, nothing stored)', function () {
    $u = newUser();
    $before = (int) Tfm\Db::value('SELECT COUNT(*) FROM allot_customers');
    $codes = [];
    foreach ([['consent' => false], ['consent' => 'true'], ['consent' => 1], ['adult' => false], ['adult' => 'yes'], ['consentVersion' => 'old.00000000'], ['consentVersion' => null]] as $bad) {
        $f = form($bad);
        $codes[] = apiCode(function () use ($u, $f) { Tfm\Allot::apply($u, 'T1-0002', $f); });
    }
    $missing = form(); unset($missing['adult']);
    $codes[] = apiCode(function () use ($u, $missing) { Tfm\Allot::apply($u, 'T1-0002', $missing); });
    return array_unique($codes) === ['400 CONSENT_REQUIRED'] && (int) Tfm\Db::value('SELECT COUNT(*) FROM allot_customers') === $before && unitRow('T1-0002')['status'] === 'open' ? true : json_encode($codes);
});
check('apply — bad name / phone are 400 INVALID_INPUT; an unknown unit 404; a held unit 409 UNIT_TAKEN; a closed unit or zone 409 NOT_OPEN', function () use ($ADM) {
    $u = newUser();
    $r = [];
    foreach ([['name' => ''], ['name' => str_repeat('가', 41)], ['name' => '12345'], ['phone' => '010-12'], ['phone' => '010-****-1234'], ['phone' => 'call me'], ['phone' => 1012345678], ['name' => ['x']]] as $bad) {
        $f = form($bad);
        $r[] = apiCode(function () use ($u, $f) { Tfm\Allot::apply($u, 'T1-0002', $f); });
    }
    $unknown = apiCode(function () use ($u) { Tfm\Allot::apply($u, 'T1-9999', form()); });
    $taken = apiCode(function () use ($u) { Tfm\Allot::apply($u, 'T1-0001', form()); });
    Tfm\Allot::setUnitState($ADM, unitRow('T1-0004')['id'], 'closed');
    $closedUnit = apiCode(function () use ($u) { Tfm\Allot::apply($u, 'T1-0004', form()); });
    Tfm\Allot::setUnitState($ADM, unitRow('T1-0004')['id'], 'open');
    $closedZone = apiCode(function () use ($u) { Tfm\Allot::apply($u, 'J02-0001', form()); });
    return array_unique($r) === ['400 INVALID_INPUT'] && $unknown === '404 NOT_FOUND' && $taken === '409 UNIT_TAKEN' && $closedUnit === '409 NOT_OPEN' && $closedZone === '409 NOT_OPEN'
        ? true : json_encode([$r, $unknown, $taken, $closedUnit, $closedZone]);
});
check('apply — 403 ALLOT_DISABLED while the operator has switched allotment off', function () use ($ADM) {
    $u = newUser();
    Tfm\Allot::saveSettings($ADM, ['enabled' => false]);
    try { $code = apiCode(function () use ($u) { Tfm\Allot::apply($u, 'T1-0002', form()); }); }
    finally { Tfm\Allot::saveSettings($ADM, ['enabled' => true]); }
    return $code === '403 ALLOT_DISABLED' && unitRow('T1-0002')['status'] === 'open' ? true : $code;
});
check('apply — the per-account limit: the 4th live application of one account is 429 APPLY_LIMIT', function () use ($U1, $NAME1, $PHONE1) {
    $same = ['name' => $NAME1, 'phone' => $PHONE1];   // a later form refreshes the account's customer row: keep the same person
    Tfm\Allot::apply($U1, 'T1-0005', form($same));
    Tfm\Allot::apply($U1, 'T1-0006', form($same));
    $code = apiCode(function () use ($U1) { Tfm\Allot::apply($U1, 'T1-0007', form()); });
    return $code === '429 APPLY_LIMIT' && unitRow('T1-0007')['status'] === 'open' && (int) Tfm\Db::value('SELECT COUNT(*) FROM allot_customers WHERE user_id = ?', [(int) $U1['id']]) === 1 ? true : $code;
});
check('apply — auto-assign {kind, zone, auto}: the lowest free seq of the zone; without a zone the first open zone of the kind', function () {
    $u = newUser();
    $a = Tfm\Allot::apply($u, ['kind' => 'jar', 'zone' => 'T1', 'auto' => true], form());
    $b = Tfm\Allot::apply($u, ['kind' => 'jar', 'auto' => true], form());
    $bad = apiCode(function () use ($u) { Tfm\Allot::apply($u, ['kind' => 'pond', 'auto' => true], form()); });
    $noAuto = apiCode(function () use ($u) { Tfm\Allot::apply($u, ['kind' => 'jar'], form()); });
    // T1 sorts before the preset zones? (it was created first) — J01 is open too; the first open zone by (sort, id) wins
    $first = (string) Tfm\Db::value("SELECT code FROM allot_zones WHERE kind = 'jar' AND is_open = 1 ORDER BY sort, id LIMIT 1");
    return $a['unit'] === 'T1-0002' && strpos($b['unit'], $first . '-') === 0 && $bad === '400 INVALID_INPUT' && $noAuto === '400 INVALID_INPUT' ? true : json_encode([$a['unit'], $b['unit'], $first, $bad, $noAuto]);
});
check('apply — 409 SOLD_OUT when auto-assign finds no free unit', function () use ($ADM) {
    Tfm\Allot::saveZone($ADM, ['code' => 'T2', 'kind' => 'store', 'name' => '작은 창고', 'capacity' => 2, 'cols' => 2, 'price' => 0, 'period' => 'month', 'termMonths' => 0, 'isOpen' => true]);
    $u = newUser();
    Tfm\Allot::apply($u, ['kind' => 'store', 'zone' => 'T2', 'auto' => true], form());
    Tfm\Allot::apply($u, ['kind' => 'store', 'zone' => 'T2', 'auto' => true], form());
    $code = apiCode(function () use ($u) { Tfm\Allot::apply($u, ['kind' => 'store', 'zone' => 'T2', 'auto' => true], form()); });
    return $code === '409 SOLD_OUT' ? true : $code;
});
check('contract numbers — 300 numbers: all different, all in the documented shape, no visible order', function () {
    $seen = [];
    $prev = '';
    $ordered = 0;
    for ($i = 0; $i < 300; $i++) {
        $n = Tfm\Allot::newContractNo();
        if (!preg_match('/^A\d\d-[2-9A-HJKMNP-TV-Z]{5}-[2-9A-HJKMNP-TV-Z]{5}$/', $n)) return "shape: $n";
        if (isset($seen[$n])) return "repeat: $n";
        $seen[$n] = true;
        if ($prev !== '' && strcmp($n, $prev) > 0) $ordered++;
        $prev = $n;
    }
    return $ordered > 100 && $ordered < 200 ? true : "ascending pairs: $ordered of 299";
});

$C1 = null;
check('decide — approve: active, the unit is leased, the term starts now and ends term_months later, the applicant is told (memo masked)', function () use ($ADM, $NOADM, $U1, $A1, $T0, &$C1, $DAY) {
    $id = (int) conRow($A1['contractNo'])['id'];
    if (!throwsApi(function () use ($NOADM, $id) { Tfm\Allot::decide($NOADM, $id, 'active', ''); }, 'FORBIDDEN', 403)) return 'a non-admin decided';
    if (!throwsApi(function () use ($ADM, $id) { Tfm\Allot::decide($ADM, $id, 'ended', ''); }, 'INVALID_INPUT', 400)) return 'bad status accepted';
    $t = $T0 + 3600000;
    $C1 = Tfm\Allot::decide($ADM, $id, 'active', '환영해요! 문의는 010-1234-5678 로 주세요', $t);
    $u = unitRow('T1-0001');
    $c = conRow($A1['contractNo']);
    $n = Tfm\Allot::inbox((int) $U1['id'])['notices'][0];
    $again = apiCode(function () use ($ADM, $id) { Tfm\Allot::decide($ADM, $id, 'active', ''); });
    return $C1['status'] === 'active' && $u['status'] === 'leased' && (int) $u['hold_until'] === 0 && (int) $c['starts_at'] === $t && (int) $c['ends_at'] === Tfm\Allot::addMonths($t, 12)
        && (int) $c['paid_until'] === $t && (int) $c['decided_at'] === $t && (int) $c['live_unit_id'] === (int) $u['id'] && $n['kind'] === 'approved' && strpos($n['body'], '5678') === false
        && strpos($n['body'], '환영해요') !== false && Tfm\Allot::map(null, 'T1')['zones'][0]['s'][0] === 'l' && $again === '409 NOT_PENDING' ? true : json_encode([$C1, $u, $n, $again], JSON_UNESCAPED_UNICODE);
});
check('decide — reject: canceled, the unit is free again, live_unit_id is cleared, the applicant is told', function () use ($ADM, $U1) {
    $c = (array) Tfm\Db::one("SELECT c.* FROM allot_contracts c JOIN allot_units u ON u.id = c.unit_id WHERE u.code = 'T1-0005'");
    $r = Tfm\Allot::decide($ADM, (int) $c['id'], 'canceled', '입금이 확인되지 않았어요');
    $u = unitRow('T1-0005');
    $c2 = conRow($c['contract_no']);
    $n = Tfm\Allot::inbox((int) $U1['id'])['notices'][0];
    return $r['status'] === 'canceled' && $u['status'] === 'open' && $u['contract_id'] === null && $c2['live_unit_id'] === null && $c2['end_reason'] === 'rejected' && (int) $c2['ended_at'] > 0
        && $n['kind'] === 'rejected' && Tfm\Allot::mine((int) $U1['id'])['limit']['used'] === 2 ? true : json_encode([$r, $u, $c2, $n], JSON_UNESCAPED_UNICODE);
});
check('customer — lists and views are masked; reveal needs an admin and writes an audit row without the data', function () use ($ADM, $NOADM, $U1, $NAME1) {
    $cid = (int) Tfm\Db::value('SELECT id FROM allot_customers WHERE user_id = ?', [(int) $U1['id']]);
    $m = Tfm\Allot::customer($cid);
    if (strpos(json_encode($m, JSON_UNESCAPED_UNICODE), $NAME1) !== false || strpos(json_encode($m), '7391') !== false) return 'the masked view leaks: ' . json_encode($m, JSON_UNESCAPED_UNICODE);
    if ($m['name'] !== '설****' || $m['phone'] !== '***-****-4625') return 'mask: ' . json_encode($m, JSON_UNESCAPED_UNICODE);
    if (!throwsApi(function () use ($cid, $NOADM) { Tfm\Allot::customer($cid, true, $NOADM); }, 'FORBIDDEN', 403)) return 'a non-admin revealed';
    if (!throwsApi(function () use ($cid) { Tfm\Allot::customer($cid, true, null); }, 'FORBIDDEN', 403)) return 'revealed without an actor';
    $before = (int) Tfm\Db::value("SELECT COUNT(*) FROM audit_log WHERE event = 'allot_customer_revealed'");
    $full = Tfm\Allot::customer($cid, true, $ADM, '환불 전화 확인');
    $row = (array) Tfm\Db::one("SELECT detail, severity FROM audit_log WHERE event = 'allot_customer_revealed' ORDER BY id DESC LIMIT 1");
    return $full['nameFull'] === $NAME1 && $full['phoneFull'] === '010-7391-4625' && (int) Tfm\Db::value("SELECT COUNT(*) FROM audit_log WHERE event = 'allot_customer_revealed'") === $before + 1
        && strpos($row['detail'], $NAME1) === false && strpos($row['detail'], '7391') === false && strpos($row['detail'], '"customer":' . $cid) !== false && $row['severity'] === 'warn'
        ? true : json_encode([$full, $row], JSON_UNESCAPED_UNICODE);
});
$OFF = null;
check('saveCustomer + createContract — the operator enters an offline customer and a contract that is active at once (dates as given)', function () use ($ADM, $NOADM, &$OFF, $T0, $DAY) {
    if (!throwsApi(function () use ($NOADM) { Tfm\Allot::saveCustomer($NOADM, ['name' => '가', 'phone' => '010-1111-2222']); }, 'FORBIDDEN', 403)) return 'non-admin';
    $cu = Tfm\Allot::saveCustomer($ADM, ['name' => '바리데기', 'phone' => '+82 10-8642-9753', 'addr' => '강원도 정선군 가상로 12', 'memo' => '전화는 오후에', 'consent' => true]);
    $dupe = apiCode(function () use ($ADM) { Tfm\Allot::saveCustomer($ADM, ['name' => '바리데기', 'phone' => '010-8642-9753']); });
    $start = $T0 - 40 * $DAY;
    $OFF = Tfm\Allot::createContract($ADM, 'T1-0010', $cu['id'], ['startsAt' => $start, 'memo' => '현장 접수']);
    $u = unitRow('T1-0010');
    $row = (array) Tfm\Db::one('SELECT * FROM allot_customers WHERE id = ?', [$cu['id']]);
    $taken = apiCode(function () use ($ADM, $cu) { Tfm\Allot::createContract($ADM, 'T1-0010', $cu['id']); });
    return $cu['name'] === '바***' && $cu['phone'] === '***-****-9753' && $cu['userId'] === 0 && $dupe === '409 CUSTOMER_EXISTS' && $OFF['status'] === 'active' && $OFF['source'] === 'admin'
        && $OFF['startsAt'] === $start && $OFF['endsAt'] === Tfm\Allot::addMonths($start, 12) && $OFF['paidUntil'] === $start && $u['status'] === 'leased' && $OFF['memo'] === '현장 접수'
        && strpos($row['addr_enc'], 'enc:v1:') === 0 && strpos($row['memo'], 'enc:v1:') === 0 && $taken === '409 UNIT_TAKEN' ? true : json_encode([$cu, $OFF, $dupe, $taken], JSON_UNESCAPED_UNICODE);
});
check('listCustomers — found by the whole phone number, by its last 4 digits and by the exact name (blind indexes); rows are masked; keyset paging', function () use ($ADM) {
    $byPhone = Tfm\Allot::listCustomers(['q' => '010 8642 9753']);
    $byTail = Tfm\Allot::listCustomers(['q' => '9753']);
    $byName = Tfm\Allot::listCustomers(['q' => '바리데기']);
    $none = Tfm\Allot::listCustomers(['q' => '바리']);
    $all = Tfm\Allot::listCustomers([], 2);
    $all2 = Tfm\Allot::listCustomers([], 2, $all['next']);
    $flat = json_encode([$byPhone, $byTail, $byName, $all], JSON_UNESCAPED_UNICODE);
    return count($byPhone['rows']) === 1 && count($byTail['rows']) === 1 && count($byName['rows']) === 1 && $byPhone['rows'][0]['id'] === $byName['rows'][0]['id'] && $none['rows'] === []
        && $byPhone['rows'][0]['contracts'] === 1 && count($all['rows']) === 2 && $all['next'] > 0 && $all2['rows'][0]['id'] < $all['rows'][1]['id']
        && strpos($flat, '바리데기') === false && strpos($flat, '8642') === false ? true : $flat;
});
check('renew — the term is extended by one more term; the customer row has no account, so the notice waits for the operator (queued, user_id NULL)', function () use ($ADM, &$OFF) {
    $r = Tfm\Allot::renew($ADM, $OFF['id'], 1);
    $n = (array) Tfm\Db::one('SELECT kind, status, user_id FROM allot_notices WHERE contract_id = ? ORDER BY id DESC LIMIT 1', [$OFF['id']]);
    $ok = $r['endsAt'] === Tfm\Allot::addMonths($OFF['endsAt'], 12) && $r['status'] === 'active' && $n['kind'] === 'renewed' && $n['status'] === 'queued' && $n['user_id'] === null;
    $OFF = $r;
    return $ok ? true : json_encode([$r, $n]);
});
check('transfer — the contract moves to a free unit with its nameplate; the old unit is free; a taken target is 409 UNIT_TAKEN', function () use ($ADM, &$OFF) {
    Tfm\Allot::setLabel($ADM, (int) unitRow('T1-0010')['id'], '바리네 장독', true);
    $taken = apiCode(function () use ($ADM, $OFF) { Tfm\Allot::transfer($ADM, $OFF['id'], 'T1-0001'); });
    $v0 = Tfm\Allot::mapVersion();
    $r = Tfm\Allot::transfer($ADM, $OFF['id'], 'T1-0011');
    $old = unitRow('T1-0010');
    $new = unitRow('T1-0011');
    $c = (array) Tfm\Db::one('SELECT unit_id, live_unit_id FROM allot_contracts WHERE id = ?', [$OFF['id']]);
    $OFF = $r;
    return $taken === '409 UNIT_TAKEN' && $r['unitCode'] === 'T1-0011' && $old['status'] === 'open' && $old['contract_id'] === null && $old['label'] === '' && (int) $old['label_show'] === 0
        && $new['status'] === 'leased' && (int) $new['contract_id'] === $r['id'] && $new['label'] === '바리네 장독' && (int) $new['label_show'] === 1 && (int) $c['unit_id'] === (int) $new['id']
        && (int) $c['live_unit_id'] === (int) $new['id'] && Tfm\Allot::mapVersion() > $v0 ? true : json_encode([$taken, $r, $old, $new, $c], JSON_UNESCAPED_UNICODE);
});
check('endContract — ended with a reason: the unit is free, the nameplate is gone, live_unit_id is NULL; ending twice is 409', function () use ($ADM, &$OFF) {
    $r = Tfm\Allot::endContract($ADM, $OFF['id'], '기간 만료 후 수령');
    $u = unitRow('T1-0011');
    $c = (array) Tfm\Db::one('SELECT live_unit_id, ended_at, end_reason FROM allot_contracts WHERE id = ?', [$OFF['id']]);
    $again = apiCode(function () use ($ADM, $OFF) { Tfm\Allot::endContract($ADM, $OFF['id'], 'x'); });
    return $r['status'] === 'ended' && $u['status'] === 'open' && $u['contract_id'] === null && $u['label'] === '' && $c['live_unit_id'] === null && (int) $c['ended_at'] > 0
        && $c['end_reason'] === '기간 만료 후 수령' && $again === '409 NOT_LIVE' ? true : json_encode([$r, $u, $c, $again], JSON_UNESCAPED_UNICODE);
});
check('cancelByUser — the owner cancels a pending application at once; for an active contract the request is recorded for the operator; a stranger gets 404', function () use ($U1, $A1) {
    $stranger = newUser();
    $pend = (string) Tfm\Db::value("SELECT c.contract_no FROM allot_contracts c JOIN allot_units u ON u.id = c.unit_id WHERE u.code = 'T1-0006'");
    $idor = apiCode(function () use ($stranger, $pend) { Tfm\Allot::cancelByUser($stranger, $pend); });
    $idor2 = apiCode(function () use ($stranger, $A1) { Tfm\Allot::cancelByUser($stranger, $A1['contractNo']); });
    $bogus = apiCode(function () use ($U1) { Tfm\Allot::cancelByUser($U1, 'A00-AAAAA-AAAAA'); });
    $a = Tfm\Allot::cancelByUser($U1, $pend);
    $b = Tfm\Allot::cancelByUser($U1, $A1['contractNo']);
    $c = conRow($A1['contractNo']);
    return $idor === '404 NOT_FOUND' && $idor2 === '404 NOT_FOUND' && $bogus === '404 NOT_FOUND' && $a['status'] === 'canceled' && unitRow('T1-0006')['status'] === 'open'
        && conRow($pend)['end_reason'] === 'user' && $b['status'] === 'active' && $b['requested'] === true && (int) $c['cancel_req_at'] > 0 && unitRow('T1-0001')['status'] === 'leased'
        ? true : json_encode([$idor, $idor2, $bogus, $a, $b]);
});
check('auto_approve = always — an application is active at once (the unit is leased, never held)', function () use ($ADM) {
    Tfm\Allot::saveSettings($ADM, ['auto_approve' => 'always']);
    try {
        $u = newUser();
        $r = Tfm\Allot::apply($u, 'T1-0012', form());
    } finally { Tfm\Allot::saveSettings($ADM, ['auto_approve' => 'off']); }
    $c = conRow($r['contractNo']);
    return $r['status'] === 'active' && unitRow('T1-0012')['status'] === 'leased' && (int) $c['starts_at'] > 0 && (int) $c['decided_by'] === 0 ? true : json_encode([$r, $c]);
});
check('listContracts — keyset pages newest first; filters by status, zone, unit code, contract number and phone', function () use ($A1, $PHONE1) {
    $p1 = Tfm\Allot::listContracts([], 3);
    $p2 = Tfm\Allot::listContracts([], 3, $p1['next']);
    $act = Tfm\Allot::listContracts(['status' => 'active', 'zone' => 'T1'], 50);
    $byNo = Tfm\Allot::listContracts(['q' => $A1['contractNo']]);
    $byUnit = Tfm\Allot::listContracts(['q' => 'T1-0001']);
    $byPhone = Tfm\Allot::listContracts(['q' => $PHONE1]);
    $flat = json_encode($act, JSON_UNESCAPED_UNICODE);
    return count($p1['rows']) === 3 && $p1['rows'][0]['id'] > $p1['rows'][2]['id'] && $p2['rows'][0]['id'] < $p1['rows'][2]['id'] && count($act['rows']) === 2
        && count($byNo['rows']) === 1 && $byNo['rows'][0]['contractNo'] === $A1['contractNo'] && count($byUnit['rows']) === 1 && count($byPhone['rows']) === 3
        && $byNo['rows'][0]['customer'] === '설****' && strpos($flat, '설문대') === false ? true : json_encode([count($p1['rows']), count($act['rows']), count($byNo['rows']), count($byUnit['rows']), count($byPhone['rows'])]);
});
check('Allot::addMonths — calendar months in the server time zone, the day is clamped to the end of a shorter month', function () {
    $ms = function (string $d) { return strtotime($d) * 1000; };
    return Tfm\Allot::addMonths($ms('2027-01-31 10:20:30'), 1) === $ms('2027-02-28 10:20:30') && Tfm\Allot::addMonths($ms('2028-01-31 00:00:00'), 1) === $ms('2028-02-29 00:00:00')
        && Tfm\Allot::addMonths($ms('2026-11-14 09:00:00'), 12) === $ms('2027-11-14 09:00:00') && Tfm\Allot::addMonths($ms('2026-12-15 09:00:00'), 2) === $ms('2027-02-15 09:00:00')
        && Tfm\Allot::addMonths(1234567, 0) === 1234567;
});

// =============================================================================================== 4 · payments (manual), periods
Tfm\Allot::saveZone($ADM, ['code' => 'T3', 'kind' => 'plot', 'name' => '시험 텃밭', 'capacity' => 20, 'cols' => 5, 'price' => 10000, 'period' => 'month', 'termMonths' => 0, 'isOpen' => true]);
Tfm\Allot::saveZone($ADM, ['code' => 'T4', 'kind' => 'jar', 'name' => '한 해 장독', 'capacity' => 60, 'cols' => 10, 'price' => 220000, 'period' => 'once', 'termMonths' => 12, 'isOpen' => true]);
$idem = function (): string { return 'unit-' . bin2hex(random_bytes(8)); };
/** an offline customer + an active contract on $unit (the term starts at $start) */
$offline = function (string $unit, int $start) use ($ADM): array {
    static $n = 0;
    $n++;
    $cu = Tfm\Allot::saveCustomer($ADM, ['name' => '시험고객' . chr(0x41 + ($n % 26)) . $n, 'phone' => '010-4400-' . str_pad((string) $n, 4, '0', STR_PAD_LEFT)]);
    return Tfm\Allot::createContract($ADM, $unit, $cu['id'], ['startsAt' => $start]);
};
check('recordPayment (year) — one price covers one year from the start; the same idempotency key again changes nothing; the notice names no amount', function () use ($ADM, $NOADM, $U1, $A1, $idem) {
    $c = conRow($A1['contractNo']);
    $id = (int) $c['id'];
    $k = $idem();
    if (!throwsApi(function () use ($NOADM, $id, $k) { Tfm\Allot::recordPayment($NOADM, $id, 130000, 'bank', $k); }, 'FORBIDDEN', 403)) return 'non-admin';
    foreach ([[0, 'bank', $k], [130000, 'toss', $k], [130000, 'card', $k], [130000, 'bank', 'short'], [20000000, 'bank', $k]] as $bad) {
        if (!throwsApi(function () use ($ADM, $id, $bad) { Tfm\Allot::recordPayment($ADM, $id, $bad[0], $bad[1], $bad[2]); }, 'INVALID_INPUT', 400)) return 'accepted ' . json_encode($bad);
    }
    $r = Tfm\Allot::recordPayment($ADM, $id, 130000, 'bank', $k, ['memo' => '11월 입금']);
    $again = Tfm\Allot::recordPayment($ADM, $id, 130000, 'bank', $k);
    $other = (int) Tfm\Db::value("SELECT id FROM allot_contracts WHERE status = 'pending' LIMIT 1");
    $conflict = apiCode(function () use ($ADM, $other, $k) { Tfm\Allot::recordPayment($ADM, $other, 130000, 'bank', $k); });
    $n = Tfm\Allot::inbox((int) $U1['id'])['notices'][0];
    $c2 = conRow($A1['contractNo']);
    return $r['duplicate'] === false && $r['payment']['kind'] === 'first' && $r['payment']['periods'] === 1 && $r['payment']['status'] === 'paid' && $r['payment']['periodFrom'] === (int) $c['starts_at']
        && $r['contract']['paidUntil'] === Tfm\Allot::addMonths((int) $c['starts_at'], 12) && $r['contract']['paidTotal'] === 130000 && $again['duplicate'] === true && $again['payment']['id'] === $r['payment']['id']
        && (int) $c2['paid_total'] === 130000 && (int) Tfm\Db::value('SELECT COUNT(*) FROM allot_payments WHERE contract_id = ?', [$id]) === 1 && $conflict === '409 IDEM_CONFLICT'
        && $n['kind'] === 'paid' && !preg_match('/130|원/u', $n['title'] . $n['body']) ? true : json_encode([$r, $again['duplicate'], $conflict, $n], JSON_UNESCAPED_UNICODE);
});
check('recordPayment (month) — part payments add up to whole months; several months at once; the operator may set the months himself', function () use ($ADM, $offline, $idem, $T0, $DAY) {
    $start = $T0 - 10 * $DAY;
    $c = $offline('T3-0001', $start);
    $id = $c['id'];
    $p1 = Tfm\Allot::recordPayment($ADM, $id, 4000, 'cash', $idem());
    $p2 = Tfm\Allot::recordPayment($ADM, $id, 6000, 'cash', $idem());
    $p3 = Tfm\Allot::recordPayment($ADM, $id, 30000, 'cms', $idem());
    $p4 = Tfm\Allot::recordPayment($ADM, $id, 5000, 'etc', $idem(), ['periods' => 2]);
    return $c['paidUntil'] === $start && $c['endsAt'] === 0 && $p1['payment']['periods'] === 0 && $p1['payment']['kind'] === 'manual' && $p1['contract']['paidUntil'] === $start
        && $p2['payment']['periods'] === 1 && $p2['contract']['paidUntil'] === Tfm\Allot::addMonths($start, 1) && $p3['payment']['periods'] === 3 && $p3['contract']['paidUntil'] === Tfm\Allot::addMonths($start, 4)
        && $p3['payment']['kind'] === 'renewal' && $p4['payment']['periods'] === 2 && $p4['contract']['paidUntil'] === Tfm\Allot::addMonths($start, 6) && $p4['contract']['paidTotal'] === 45000
        ? true : json_encode([$p1['payment'], $p2['contract']['paidUntil'], $p3['payment'], $p4['contract']]);
});
check('recordPayment (once) — the one price covers the whole term (paid_until = ends_at); a free unit owes nothing (paid_until = forever)', function () use ($ADM, $offline, $idem, $T0) {
    $c = $offline('T4-0001', $T0);
    $half = Tfm\Allot::recordPayment($ADM, $c['id'], 100000, 'bank', $idem());
    $full = Tfm\Allot::recordPayment($ADM, $c['id'], 120000, 'bank', $idem());
    $free = (array) Tfm\Db::one("SELECT c.* FROM allot_contracts c JOIN allot_units u ON u.id = c.unit_id WHERE u.code = 'T2-0001'");
    $f = Tfm\Allot::decide($ADM, (int) $free['id'], 'active', '');
    $mine = Tfm\Allot::mine((int) $free['user_id']);
    $m = null;
    foreach ($mine['contracts'] as $x) if ($x['unit']['code'] === 'T2-0001') $m = $x;
    return $c['endsAt'] === Tfm\Allot::addMonths($T0, 12) && $half['contract']['paidUntil'] === $T0 && $half['payment']['periods'] === 0 && $full['payment']['periods'] === 1
        && $full['contract']['paidUntil'] === $c['endsAt'] && $f['paidUntil'] === Tfm\Allot::FOREVER && $m['paidUntil'] === 0 && $m['payDue'] === false ? true : json_encode([$half['contract'], $full['contract'], $f, $m]);
});
check('auto_approve = on_payment — a recorded payment that covers a period approves the pending application in the same step', function () use ($ADM, $idem) {
    $u = newUser();
    $a = Tfm\Allot::apply($u, 'T4-0002', form());
    $id = (int) conRow($a['contractNo'])['id'];
    Tfm\Allot::saveSettings($ADM, ['auto_approve' => 'on_payment']);
    try {
        $part = Tfm\Allot::recordPayment($ADM, $id, 100000, 'bank', $idem());
        $full = Tfm\Allot::recordPayment($ADM, $id, 120000, 'bank', $idem());
    } finally { Tfm\Allot::saveSettings($ADM, ['auto_approve' => 'off']); }
    $kinds = array_map(function ($n) { return $n['kind']; }, Tfm\Allot::inbox((int) $u['id'])['notices']);
    return $part['contract']['status'] === 'pending' && $full['contract']['status'] === 'active' && $full['contract']['paidUntil'] === $full['contract']['endsAt'] && $full['contract']['endsAt'] > 0
        && unitRow('T4-0002')['status'] === 'leased' && in_array('approved', $kinds, true) && in_array('paid', $kinds, true) ? true : json_encode([$part['contract'], $full['contract'], $kinds]);
});
check('recordPayment — an overdue contract that is paid up is active again; a contract that ended takes no payment (409 NOT_LIVE)', function () use ($ADM, $offline, $idem, $T0, $DAY) {
    $c = $offline('T3-0002', $T0 - 70 * $DAY);
    Tfm\Db::exec("UPDATE allot_contracts SET status = 'overdue' WHERE id = ?", [$c['id']]);
    $one = Tfm\Allot::recordPayment($ADM, $c['id'], 10000, 'bank', $idem());   // paid to 40 days ago: still outside the 14 days of grace
    $two = Tfm\Allot::recordPayment($ADM, $c['id'], 20000, 'bank', $idem());   // paid into the future
    Tfm\Allot::endContract($ADM, $c['id'], '시험');
    $dead = apiCode(function () use ($ADM, $c, $idem) { Tfm\Allot::recordPayment($ADM, $c['id'], 10000, 'bank', $idem()); });
    return $one['contract']['status'] === 'overdue' && $two['contract']['status'] === 'active' && $two['contract']['paidUntil'] > $T0 && $dead === '409 NOT_LIVE' ? true : json_encode([$one['contract'], $two['contract'], $dead]);
});
check('refund (bank) — the payment is marked refunded, a refund row is written, paid_total goes down; a second refund is 409; listPayments pages by key', function () use ($ADM, $NOADM, $A1) {
    $id = (int) conRow($A1['contractNo'])['id'];
    $pay = Tfm\Allot::listPayments(['contractId' => $id]);
    $pid = $pay['rows'][0]['id'];
    if (!throwsApi(function () use ($NOADM, $pid) { Tfm\Allot::refund($NOADM, $pid, 'x'); }, 'FORBIDDEN', 403)) return 'non-admin';
    $r = Tfm\Allot::refund($ADM, $pid, '고객 요청');
    $again = apiCode(function () use ($ADM, $pid) { Tfm\Allot::refund($ADM, $pid, 'x'); });
    $rows = Tfm\Allot::listPayments(['contractId' => $id])['rows'];
    $all = Tfm\Allot::listPayments([], 2);
    $all2 = Tfm\Allot::listPayments([], 2, $all['next']);
    return $r['status'] === 'refunded' && $again === '409 NOT_REFUNDABLE' && count($rows) === 2 && $rows[0]['kind'] === 'refund' && $rows[0]['amount'] === 130000 && (int) conRow($A1['contractNo'])['paid_total'] === 0
        && count($all['rows']) === 2 && $all['next'] > 0 && $all2['rows'][0]['id'] < $all['rows'][1]['id'] ? true : json_encode([$r, $again, $rows]);
});

// =============================================================================================== 5 · 토스 one-time payment (mock mode, TFM_TOSS_MOCK=1)
$payCase = function () use ($ADM): array {
    $u = newUser();
    $a = Tfm\Allot::apply($u, ['kind' => 'jar', 'zone' => 'T4', 'auto' => true], form());
    Tfm\Allot::decide($ADM, (int) conRow($a['contractNo'])['id'], 'active', '');
    return [$u, $a['contractNo']];
};
$secEvents = function (string $kind): int { return (int) Tfm\Db::value('SELECT COUNT(*) FROM security_events WHERE kind = ?', [$kind]); };
check('payPrepare — 403 PAY_DISABLED unless allot.toss_enabled; with it: the server\'s own price, a random order id, the same open order again', function () use ($ADM, $payCase) {
    list($u, $no) = $payCase();
    $off = apiCode(function () use ($u, $no) { Tfm\Allot::payPrepare($u, $no); });
    Tfm\Allot::saveSettings($ADM, ['toss_enabled' => true]);
    $p = Tfm\Allot::payPrepare($u, $no);
    $p2 = Tfm\Allot::payPrepare($u, $no);
    $stranger = newUser();
    $idor = apiCode(function () use ($stranger, $no) { Tfm\Allot::payPrepare($stranger, $no); });
    return $off === '403 PAY_DISABLED' && $p['amount'] === 220000 && preg_match('/^AL[A-Za-z0-9]{30}$/', $p['orderId']) && $p['mock'] === true && $p2['orderId'] === $p['orderId'] && $p['contractNo'] === $no
        && $idor === '404 NOT_FOUND' && Tfm\Allot::plans()['toss'] === true ? true : json_encode([$off, $p, $idor]);
});
check('payConfirm — paid: the contract moves on, the paymentKey is stored sealed; a replay is 409 ORDER_NOT_OPEN; then nothing is due (409 NOTHING_DUE)', function () use ($payCase) {
    list($u, $no) = $payCase();
    $p = Tfm\Allot::payPrepare($u, $no);
    $key = 'mock_' . $p['orderId'];
    $r = Tfm\Allot::payConfirm($u, $key, $p['orderId'], $p['amount']);
    $row = (array) Tfm\Db::one('SELECT * FROM allot_payments WHERE order_id = ?', [$p['orderId']]);
    $c = conRow($no);
    $replay = apiCode(function () use ($u, $key, $p) { Tfm\Allot::payConfirm($u, $key, $p['orderId'], $p['amount']); });
    $nothing = apiCode(function () use ($u, $no) { Tfm\Allot::payPrepare($u, $no); });
    return $r['status'] === 'active' && $r['paidUntil'] === (int) $c['ends_at'] && $row['status'] === 'paid' && $row['method'] === 'toss' && (int) $row['periods'] === 1 && strpos($row['payment_key_enc'], 'enc:v1:') === 0
        && Tfm\Crypto::open($row['payment_key_enc']) === $key && strpos(dumpAll(), $key) === false && $replay === '409 ORDER_NOT_OPEN' && $nothing === '409 NOTHING_DUE' ? true : json_encode([$r, $row, $replay, $nothing]);
});
check('payConfirm — another account\'s order is 404 + payment_tamper; another amount is 400 AMOUNT_MISMATCH + payment_tamper; nothing is paid', function () use ($payCase, $secEvents) {
    list($u, $no) = $payCase();
    $p = Tfm\Allot::payPrepare($u, $no);
    $stranger = newUser();
    $before = $secEvents('payment_tamper');
    $foreign = apiCode(function () use ($stranger, $p) { Tfm\Allot::payConfirm($stranger, 'mock_' . $p['orderId'], $p['orderId'], $p['amount']); });
    $amount = apiCode(function () use ($u, $p) { Tfm\Allot::payConfirm($u, 'mock_' . $p['orderId'], $p['orderId'], 1000); });
    $unknown = apiCode(function () use ($u) { Tfm\Allot::payConfirm($u, 'mock_x', 'ALnotAnOrder00000000000000000000', 1000); });
    $st = (string) Tfm\Db::value('SELECT status FROM allot_payments WHERE order_id = ?', [$p['orderId']]);
    return $foreign === '404 ORDER_NOT_FOUND' && $amount === '400 AMOUNT_MISMATCH' && $unknown === '404 ORDER_NOT_FOUND' && $st === 'created' && $secEvents('payment_tamper') >= $before + 3 && (int) conRow($no)['paid_total'] === 0
        ? true : json_encode([$foreign, $amount, $unknown, $st]);
});
check('payConfirm — the gateway answers another amount / order / currency / status: 402 PAYMENT_FAILED, the row is failed, the contract is unchanged, payment_tamper', function () use ($payCase, $secEvents) {
    $out = [];
    foreach (['amount1_', 'noamount_', 'otherorder_', 'usd_', 'waiting_'] as $flag) {
        list($u, $no) = $payCase();
        $p = Tfm\Allot::payPrepare($u, $no);
        $before = $secEvents('payment_tamper');
        $code = apiCode(function () use ($u, $p, $flag) { Tfm\Allot::payConfirm($u, 'mock_' . $flag . $p['orderId'], $p['orderId'], $p['amount']); });
        $st = (string) Tfm\Db::value('SELECT status FROM allot_payments WHERE order_id = ?', [$p['orderId']]);
        if ($code !== '402 PAYMENT_FAILED' || $st !== 'failed' || (int) conRow($no)['paid_total'] !== 0 || $secEvents('payment_tamper') <= $before) $out[] = "$flag → $code / $st";
    }
    return $out === [] ? true : implode('; ', $out);
});
check('payConfirm — no answer from the gateway: 503 PAYMENT_PENDING, the row stays claimed; a quick retry is 409; a later one looks it up and pays once', function () use ($payCase) {
    list($u, $no) = $payCase();
    $p = Tfm\Allot::payPrepare($u, $no);
    $k = 'mock_timeout_' . $p['orderId'];
    $c1 = apiCode(function () use ($u, $k, $p) { Tfm\Allot::payConfirm($u, $k, $p['orderId'], $p['amount']); });
    $row = (array) Tfm\Db::one('SELECT status, claim, toss_status, payment_key_enc FROM allot_payments WHERE order_id = ?', [$p['orderId']]);
    $c2 = apiCode(function () use ($u, $k, $p) { Tfm\Allot::payConfirm($u, $k, $p['orderId'], $p['amount']); });
    $otherKey = apiCode(function () use ($u, $p) { Tfm\Allot::payConfirm($u, 'mock_' . $p['orderId'], $p['orderId'], $p['amount']); });
    Tfm\Config::override('toss.confirm_retry_after', 0);
    try { $r = Tfm\Allot::payConfirm($u, $k, $p['orderId'], $p['amount']); } finally { Tfm\Config::override('toss.confirm_retry_after', null); }
    return $c1 === '503 PAYMENT_PENDING' && $row['status'] === 'created' && strlen($row['claim']) === 64 && $row['toss_status'] === 'CONFIRMING' && $row['payment_key_enc'] === '' && $c2 === '409 ORDER_NOT_OPEN'
        && $otherKey === '409 ORDER_NOT_OPEN' && $r['status'] === 'active' && (int) conRow($no)['paid_total'] === 220000 ? true : json_encode([$c1, $row, $c2, $otherKey]);
});
/** run PHP code in $n parallel processes against this test's database (the private server copy): the outputs, sorted */
$parallel = function (string $code, int $n) use ($srv): array {
    $procs = [];
    for ($i = 0; $i < $n; $i++) {
        $p = proc_open([PHP_BINARY, '-r', 'require $argv[1]; $I = (int) $argv[2]; ' . $code, $srv . '/lib/bootstrap.php', (string) $i], [1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes);
        $procs[] = [$p, $pipes];
    }
    $out = [];
    foreach ($procs as $pp) { $out[] = trim(stream_get_contents($pp[1][1]) . stream_get_contents($pp[1][2])); fclose($pp[1][1]); fclose($pp[1][2]); proc_close($pp[0]); }
    sort($out);
    return $out;
};
check('payConfirm — 4 processes confirm the same order at the same moment: exactly one pays, the term is counted once', function () use ($payCase, $parallel) {
    list($u, $no) = $payCase();
    $p = Tfm\Allot::payPrepare($u, $no);
    $code = '$u = Tfm\\Users::byId(' . (int) $u['id'] . '); try { Tfm\\Allot::payConfirm($u, ' . var_export('mock_slow300_' . $p['orderId'], true) . ', ' . var_export($p['orderId'], true) . ', ' . (int) $p['amount'] . '); echo "ok"; } catch (Tfm\\ApiException $e) { echo $e->errorCode; }';
    $out = $parallel($code, 4);
    $ok = count(array_filter($out, function ($x) { return $x === 'ok'; }));
    $c = conRow($no);
    return $ok === 1 && (int) $c['paid_total'] === 220000 && (int) $c['paid_until'] === (int) $c['ends_at'] && (int) Tfm\Db::value("SELECT COUNT(*) FROM allot_payments WHERE contract_id = ? AND status = 'paid'", [(int) $c['id']]) === 1
        ? true : json_encode([$out, $c['paid_total']]);
});
check('webhook — a canceled allot payment is recorded as a refund once; a wrong key, an unknown order and a repeat are ignored; nothing can be marked paid', function () use ($payCase) {
    list($u, $no) = $payCase();
    $p = Tfm\Allot::payPrepare($u, $no);
    $key = 'mock_' . $p['orderId'];
    Tfm\Allot::payConfirm($u, $key, $p['orderId'], $p['amount']);
    $ev = function (string $k, string $o, string $st) { return ['eventType' => 'PAYMENT_STATUS_CHANGED', 'data' => ['paymentKey' => $k, 'orderId' => $o, 'status' => $st]]; };
    $sub = Tfm\Subscription::webhook($ev($key, $p['orderId'], 'CANCELED'));   // the subscription side does not know allot orders
    $wrong = Tfm\Allot::webhook($ev('mock_forged', $p['orderId'], 'CANCELED'));
    $unknown = Tfm\Allot::webhook($ev($key, 'ALunknown000000000000000000000000', 'CANCELED'));
    $r = Tfm\Allot::webhook($ev($key, $p['orderId'], 'CANCELED'));
    $dup = Tfm\Allot::webhook($ev($key, $p['orderId'], 'CANCELED'));
    list($u2, $no2) = $payCase();
    $p2 = Tfm\Allot::payPrepare($u2, $no2);
    $done = Tfm\Allot::webhook($ev('mock_' . $p2['orderId'], $p2['orderId'], 'DONE'));
    $st = (string) Tfm\Db::value('SELECT status FROM allot_payments WHERE order_id = ?', [$p['orderId']]);
    return $sub['ignored'] === true && $wrong['ignored'] === true && $unknown['ignored'] === true && $r['ignored'] === false && $r['refunded'] === true && $dup['ignored'] === true && $st === 'refunded'
        && (int) conRow($no)['paid_total'] === 0 && $done['ignored'] === true && (string) Tfm\Db::value('SELECT status FROM allot_payments WHERE order_id = ?', [$p2['orderId']]) === 'created'
        ? true : json_encode([$sub, $wrong, $unknown, $r, $dup, $st, $done]);
});
check('cancelByUser — a pending application that was paid through 토스 gets its money back by itself (payment refunded, refund row)', function () use ($ADM) {
    $u = newUser();
    $a = Tfm\Allot::apply($u, ['kind' => 'jar', 'zone' => 'T4', 'auto' => true], form());
    $p = Tfm\Allot::payPrepare($u, $a['contractNo']);
    Tfm\Allot::payConfirm($u, 'mock_' . $p['orderId'], $p['orderId'], $p['amount']);
    $mid = conRow($a['contractNo']);
    $r = Tfm\Allot::cancelByUser($u, $a['contractNo']);
    $rows = Tfm\Db::all('SELECT kind, status, method FROM allot_payments WHERE contract_id = ? ORDER BY id', [(int) $mid['id']]);
    Tfm\Allot::saveSettings($ADM, ['toss_enabled' => false]);
    return $mid['status'] === 'pending' && (int) $mid['paid_total'] === 220000 && $r['status'] === 'canceled' && count($rows) === 2 && $rows[0]['status'] === 'refunded' && $rows[1]['kind'] === 'refund'
        && (int) conRow($a['contractNo'])['paid_total'] === 0 ? true : json_encode([$mid['status'], $r, $rows]);
});

// =============================================================================================== 6 · the waiting list
$W = [];
check('waitJoin — refused while a unit is free (409 HAS_FREE); on a full zone: first come first, one live row per person and place, it counts toward the limit', function () use (&$W, $ADM) {
    $u1 = newUser(); $u2 = newUser(); $u3 = newUser();
    $free = apiCode(function () use ($u1) { Tfm\Allot::waitJoin($u1, 'store', 'T3', form()); });
    $kindZone = apiCode(function () use ($u1) { Tfm\Allot::waitJoin($u1, 'store', 'T1', form()); });
    $hasFree = apiCode(function () use ($u1) { Tfm\Allot::waitJoin($u1, 'jar', 'T1', form()); });
    $consent = apiCode(function () use ($u1) { Tfm\Allot::waitJoin($u1, 'store', 'T2', form(['consent' => false])); });
    $a = Tfm\Allot::waitJoin($u1, 'store', 'T2', form());     // T2: 2 units, both taken above
    $b = Tfm\Allot::waitJoin($u2, 'store', 'T2', form());
    $dup = apiCode(function () use ($u1) { Tfm\Allot::waitJoin($u1, 'store', 'T2', form()); });
    $mine = Tfm\Allot::mine((int) $u1['id']);
    $W = ['u1' => $u1, 'u2' => $u2, 'u3' => $u3, 'a' => $a, 'b' => $b];
    return $free === '400 INVALID_INPUT' && $kindZone === '400 INVALID_INPUT' && $hasFree === '409 HAS_FREE' && $consent === '400 CONSENT_REQUIRED' && $a['status'] === 'waiting' && $a['position'] === 1
        && $b['position'] === 2 && $dup === '409 ALREADY_WAITING' && count($mine['waitlist']) === 1 && $mine['waitlist'][0]['zone'] === 'T2' && $mine['waitlist'][0]['position'] === 1 && $mine['limit']['used'] === 1
        ? true : json_encode([$free, $kindZone, $hasFree, $consent, $a, $b, $dup, $mine]);
});
check('offerNext — when a unit is freed the first in line is offered it: held for waitlist_offer_hours, a notice, the map shows h', function () use (&$W, $ADM) {
    $t = Tfm\Clock::ms();
    $c = (array) Tfm\Db::one("SELECT c.* FROM allot_contracts c JOIN allot_units u ON u.id = c.unit_id WHERE u.code = 'T2-0002'");
    Tfm\Allot::decide($ADM, (int) $c['id'], 'canceled', '', $t);       // frees T2-0002 → offered to u1
    $u = unitRow('T2-0002');
    $w = (array) Tfm\Db::one('SELECT * FROM allot_waitlist WHERE id = ?', [$W['a']['id']]);
    $n = Tfm\Allot::inbox((int) $W['u1']['id'])['notices'][0];
    $m = Tfm\Allot::mine((int) $W['u1']['id'])['waitlist'][0];
    $second = (string) Tfm\Db::value('SELECT status FROM allot_waitlist WHERE id = ?', [$W['b']['id']]);
    return $u['status'] === 'held' && $u['contract_id'] === null && (int) $u['hold_until'] === $t + 48 * 3600000 && $w['status'] === 'offered' && (int) $w['unit_id'] === (int) $u['id']
        && (int) $w['offer_until'] === $t + 48 * 3600000 && $n['kind'] === 'offer' && $m['status'] === 'offered' && $m['unit'] === 'T2-0002' && $second === 'waiting'
        && Tfm\Allot::map(null, 'T2')['zones'][0]['s'] === 'lh' ? true : json_encode([$u, $w, $n, $m, $second]);
});
check('waitLeave — declining an offer hands the unit to the next in line; a stranger cannot leave for someone else (404)', function () use (&$W) {
    $idor = apiCode(function () use ($W) { Tfm\Allot::waitLeave($W['u3'], $W['a']['id']); });
    $r = Tfm\Allot::waitLeave($W['u1'], $W['a']['id']);
    $w1 = (array) Tfm\Db::one('SELECT status, live_key FROM allot_waitlist WHERE id = ?', [$W['a']['id']]);
    $w2 = (array) Tfm\Db::one('SELECT status, unit_id FROM allot_waitlist WHERE id = ?', [$W['b']['id']]);
    $again = apiCode(function () use ($W) { Tfm\Allot::waitLeave($W['u1'], $W['a']['id']); });
    return $idor === '404 NOT_FOUND' && $r['status'] === 'canceled' && $w1['status'] === 'canceled' && $w1['live_key'] === null && $w2['status'] === 'offered' && (int) $w2['unit_id'] === (int) unitRow('T2-0002')['id']
        && unitRow('T2-0002')['status'] === 'held' && $again === '404 NOT_FOUND' ? true : json_encode([$idor, $r, $w1, $w2, $again]);
});
check('waitAccept — only the offered account can confirm: a pending contract on that unit, the row is converted; the offer cannot be used twice', function () use (&$W) {
    $idor = apiCode(function () use ($W) { Tfm\Allot::waitAccept($W['u3'], $W['b']['id']); });
    $r = Tfm\Allot::waitAccept($W['u2'], $W['b']['id']);
    $u = unitRow('T2-0002');
    $c = conRow($r['contractNo']);
    $again = apiCode(function () use ($W) { Tfm\Allot::waitAccept($W['u2'], $W['b']['id']); });
    return $idor === '404 NOT_FOUND' && $r['status'] === 'pending' && $r['unit'] === 'T2-0002' && $u['status'] === 'held' && (int) $u['contract_id'] === (int) $c['id'] && (int) $c['user_id'] === (int) $W['u2']['id']
        && (string) Tfm\Db::value('SELECT status FROM allot_waitlist WHERE id = ?', [$W['b']['id']]) === 'converted' && $again === '404 NOT_FOUND' ? true : json_encode([$idor, $r, $u, $again]);
});
check('listWait / waitCancel — the operator sees the line in order (masked) and can remove a row', function () use (&$W, $ADM, $NOADM) {
    $w = Tfm\Allot::waitJoin($W['u3'], 'store', null, form(['name' => '대기자삼', 'phone' => '010-3003-3003']));
    $list = Tfm\Allot::listWait(['status' => 'waiting']);
    $flat = json_encode($list, JSON_UNESCAPED_UNICODE);
    if (!throwsApi(function () use ($NOADM, $w) { Tfm\Allot::waitCancel($NOADM, $w['id']); }, 'FORBIDDEN', 403)) return 'non-admin';
    $r = Tfm\Allot::waitCancel($ADM, $w['id']);
    return count($list['rows']) === 1 && $list['rows'][0]['id'] === $w['id'] && $list['rows'][0]['customer'] === '대***' && $list['rows'][0]['phoneTail'] === '3003' && $list['rows'][0]['zoneCode'] === ''
        && strpos($flat, '대기자삼') === false && strpos($flat, '3003-3003') === false && $r['status'] === 'canceled' && Tfm\Allot::listWait(['status' => 'waiting'])['rows'] === [] ? true : $flat;
});

// =============================================================================================== 7 · notices from the operator, care logs, nameplates, the public unit view
check('notify — one notice per customer with a live contract in the zone; text is cleaned and masked; a later send time waits in the queue', function () use ($ADM, $NOADM, $U1) {
    if (!throwsApi(function () use ($NOADM) { Tfm\Allot::notify($NOADM, ['all' => true], 'x', 'y'); }, 'FORBIDDEN', 403)) return 'non-admin';
    if (!throwsApi(function () use ($ADM) { Tfm\Allot::notify($ADM, [], 'x', 'y'); }, 'INVALID_INPUT', 400)) return 'no target';
    $live = (int) Tfm\Db::value("SELECT COUNT(DISTINCT c.customer_id) FROM allot_contracts c JOIN allot_units u ON u.id = c.unit_id JOIN allot_zones z ON z.id = u.zone_id WHERE z.code = 'T1' AND c.status IN ('pending', 'active', 'overdue')");
    $r = Tfm\Allot::notify($ADM, ['zone' => 'T1'], '장 가르는 날 <b>안내</b>', '토요일 10시예요. 문의 010-2222-3333');
    $n = Tfm\Allot::inbox((int) $U1['id'])['notices'][0];
    $later = Tfm\Allot::notify($ADM, ['contract' => (int) Tfm\Db::value("SELECT id FROM allot_contracts WHERE user_id = ? AND status = 'active'", [(int) $U1['id']])], '다음 달 안내', '미리 알려 드려요', Tfm\Clock::ms() + 3600000);
    $in2 = Tfm\Allot::inbox((int) $U1['id'])['notices'][0];
    $queued = (int) Tfm\Db::value("SELECT COUNT(*) FROM allot_notices WHERE user_id = ? AND status = 'queued'", [(int) $U1['id']]);
    $audit = (string) Tfm\Db::value("SELECT detail FROM audit_log WHERE event = 'allot_notice_sent' ORDER BY id DESC LIMIT 1");
    return $r['count'] === $live && $live >= 2 && $n['kind'] === 'info' && strpos($n['body'], '3333') === false && strpos($n['body'], '토요일') !== false && $later['count'] === 1 && $in2['id'] === $n['id']
        && $queued === 1 && strpos($audit, '토요일') === false ? true : json_encode([$r, $live, $n, $later, $queued], JSON_UNESCAPED_UNICODE);
});
check('listNotices / noticeDone — the outbox; notices for customers without an app account wait for the operator, who marks them done', function () use ($ADM) {
    $off = Tfm\Allot::listNotices(['offline' => true, 'status' => 'queued'], 5);
    if (!$off['rows']) return 'no offline notice';
    $first = $off['rows'][0];
    Tfm\Allot::noticeDone($ADM, $first['id'], 'sent');
    $again = apiCode(function () use ($ADM, $first) { Tfm\Allot::noticeDone($ADM, $first['id'], 'sent'); });
    $all = Tfm\Allot::listNotices([], 3);
    return $first['hasAccount'] === false && $first['status'] === 'queued' && (string) Tfm\Db::value('SELECT status FROM allot_notices WHERE id = ?', [$first['id']]) === 'sent' && $again === '409 NOT_QUEUED'
        && count($all['rows']) === 3 && $all['next'] > 0 && $all['rows'][0]['id'] > $all['rows'][1]['id'] ? true : json_encode([$first, $again]);
});
check('markSeen — only the caller\'s own notices change (ids of another account are ignored)', function () use ($U1) {
    $other = newUser();
    $in = Tfm\Allot::inbox((int) $U1['id']);
    $ids = array_map(function ($n) { return $n['id']; }, $in['notices']);
    $foreign = Tfm\Allot::markSeen((int) $other['id'], $ids);
    $own = Tfm\Allot::markSeen((int) $U1['id'], array_slice($ids, 0, 2));
    $after = Tfm\Allot::inbox((int) $U1['id']);
    $newer = Tfm\Allot::inbox((int) $U1['id'], $ids[1]);
    return $foreign === 0 && $own === 2 && $after['unread'] === $in['unread'] - 2 && $after['notices'][0]['seen'] === true && count($newer['notices']) === 1 && Tfm\Allot::inbox((int) $other['id'])['notices'] === []
        ? true : json_encode([$foreign, $own, $in['unread'], $after['unread'], count($newer['notices'])]);
});
check('addCare / careLogs — lines for a unit, its zone and everywhere reach the unit (newest first); hidden lines and personal information never do', function () use ($ADM, $NOADM) {
    if (!throwsApi(function () use ($NOADM) { Tfm\Allot::addCare($NOADM, ['all' => true], 'care', 'x'); }, 'FORBIDDEN', 403)) return 'non-admin';
    if (!throwsApi(function () use ($ADM) { Tfm\Allot::addCare($ADM, ['all' => true], 'party', 'x'); }, 'INVALID_INPUT', 400)) return 'bad kind';
    if (!throwsApi(function () use ($ADM) { Tfm\Allot::addCare($ADM, ['unit' => 'T1-7777'], 'care', 'x'); }, 'NOT_FOUND', 404)) return 'unknown unit';
    $a = Tfm\Allot::addCare($ADM, ['all' => true], 'weather', '오늘은 비가 와서 장독 뚜껑을 덮었어요');
    $b = Tfm\Allot::addCare($ADM, ['zone' => 'T1'], 'clean', '1구역 장독을 닦았어요. 담당 010-9999-8888');
    $c = Tfm\Allot::addCare($ADM, ['unit' => 'T1-0001'], 'check', '장이 잘 익고 있어요');
    $h = Tfm\Allot::addCare($ADM, ['unit' => 'T1-0001'], 'check', '안 보이는 메모', false);
    $pub = Tfm\Allot::careLogs(['unit' => 'T1-0001']);
    $other = Tfm\Allot::careLogs(['unit' => 'T3-0001']);
    $adm = Tfm\Allot::careLogs(['unit' => 'T1-0001'], 20, 0, true);
    $page = Tfm\Allot::careLogs(['unit' => 'T1-0001'], 2);
    $page2 = Tfm\Allot::careLogs(['unit' => 'T1-0001'], 2, $page['logs'][1]['id']);
    $scopes = array_map(function ($l) { return $l['scope']; }, $pub['logs']);
    Tfm\Allot::setCareVisible($ADM, $h['id'], true);
    $shown = count(Tfm\Allot::careLogs(['unit' => 'T1-0001'])['logs']);
    Tfm\Allot::setCareVisible($ADM, $h['id'], false);
    return $scopes === ['unit', 'zone', 'all'] && strpos($pub['logs'][1]['text'], '8888') === false && count($other['logs']) === 1 && $other['logs'][0]['scope'] === 'all' && count($adm['logs']) === 4
        && $page['more'] === true && count($page2['logs']) === 1 && $page2['more'] === false && $shown === 4 && $c['scope'] === 'unit' ? true : json_encode([$scopes, $pub, count($adm['logs']), $shown], JSON_UNESCAPED_UNICODE);
});
check('setLabelByUser — the owner names the unit: cleaned, masked, at most 12 characters; shown publicly only when the owner says so; strangers get 404', function () use ($U1, $A1) {
    $stranger = newUser();
    $idor = apiCode(function () use ($stranger, $A1) { Tfm\Allot::setLabelByUser($stranger, $A1['contractNo'], '내 것', true); });
    $long = apiCode(function () use ($U1, $A1) { Tfm\Allot::setLabelByUser($U1, $A1['contractNo'], str_repeat('가', 41), true); });
    $r = Tfm\Allot::setLabelByUser($U1, $A1['contractNo'], '  우리집   장독 010-1234-5678 최고예요  ', true);
    $shown = Tfm\Allot::unitView('T1-0001')['nameplate'];
    $r2 = Tfm\Allot::setLabelByUser($U1, $A1['contractNo'], '할망네 장독', false);
    $hidden = Tfm\Allot::unitView('T1-0001')['nameplate'];
    $bad = Tfm\Allot::setLabelByUser($U1, $A1['contractNo'], '씨발장독', true);
    Tfm\Allot::setLabelByUser($U1, $A1['contractNo'], '할망네 장독', true);
    return $idor === '404 NOT_FOUND' && $long === '400 INVALID_INPUT' && mb_strlen($r['nameplate']['text']) <= 12 && strpos($r['nameplate']['text'], '1234') === false && strpos($r['nameplate']['text'], '우리집 장독') === 0
        && $shown === $r['nameplate']['text'] && $r2['nameplate'] === ['text' => '할망네 장독', 'show' => false] && $hidden === null && strpos($bad['nameplate']['text'], '씨발') === false
        ? true : json_encode([$idor, $long, $r, $shown, $r2, $hidden, $bad], JSON_UNESCAPED_UNICODE);
});
check('unitView — status, the shown nameplate, visible care logs, "mine" for the owner only; no contract, customer or date fields; 404 for an unknown code', function () use ($U1) {
    $pub = Tfm\Allot::unitView('t1-0001');
    $own = Tfm\Allot::unitView('T1-0001', (int) $U1['id']);
    $free = Tfm\Allot::unitView('T1-0020');
    $keys = array_keys($pub);
    sort($keys);
    $unknown = apiCode(function () { Tfm\Allot::unitView('T1-9999'); });
    $bad = apiCode(function () { Tfm\Allot::unitView('<script>'); });
    return $keys === ['canApply', 'code', 'kind', 'logs', 'mine', 'nameplate', 'seq', 'status', 'zone'] && $pub['status'] === 'leased' && $pub['nameplate'] === '할망네 장독' && $pub['mine'] === false
        && $own['mine'] === true && count($pub['logs']) === 3 && $pub['canApply'] === false && $free['canApply'] === true && $free['nameplate'] === null && $unknown === '404 NOT_FOUND' && $bad === '404 NOT_FOUND'
        ? true : json_encode([$keys, $pub, $free, $unknown, $bad], JSON_UNESCAPED_UNICODE);
});

// =============================================================================================== 8 · CSV (RFC 4180), export, import
check('csvLine — formula guard (an apostrophe before = + - @ TAB CR), quotes doubled, cells with a comma / quote / line break quoted, CRLF at the end', function () {
    $line = Tfm\Allot::csvLine(['=1+1', '+82 10', '-5', '@SUM(A1)', "\tx", "\ry", '보통 글', 'a,b', 'say "hi"', "two\nlines", '', null, 42, ' pad ']);
    $want = "'=1+1,'+82 10,'-5,'@SUM(A1),'\tx,\"'\ry\",보통 글,\"a,b\",\"say \"\"hi\"\"\",\"two\nlines\",,,42,\" pad \"\r\n";
    return $line === $want && Tfm\Allot::csvBom() === "\xEF\xBB\xBF" ? true : json_encode($line);
});
check('csvParse — BOM, CRLF / LF / CR, quoted cells with commas, quotes and line breaks, empty cells, tab-separated and CP949 files', function () {
    $csv = "\xEF\xBB\xBF일자,성명,비고\r\n2024-03-15,\"김, 철수\",\"말했다 \"\"좋아요\"\"\"\r\n,,\r\n\r\n2024-04-01,이영희,\"두 줄\n메모\"\n\"\",x,\n";
    $r = Tfm\Allot::csvParse($csv);
    $tab = Tfm\Allot::csvParse("a\tb;c\tx\r1\t2\t3");
    $cp = Tfm\Allot::csvParse((string) mb_convert_encoding("성명,연락처\n홍길동,010-1111-2222\n", 'CP949', 'UTF-8'));
    $round = Tfm\Allot::csvParse(Tfm\Allot::csvBom() . Tfm\Allot::csvLine(['a', 'b,c', "d\"e", "f\r\ng"]) . Tfm\Allot::csvLine(['1', '', '3', '4']));
    return $r === [['일자', '성명', '비고'], ['2024-03-15', '김, 철수', '말했다 "좋아요"'], ['', '', ''], ['2024-04-01', '이영희', "두 줄\n메모"], ['', 'x', '']]
        && $tab === [['a', 'b;c', 'x'], ['1', '2', '3']] && $cp === [['성명', '연락처'], ['홍길동', '010-1111-2222']] && $round === [['a', 'b,c', 'd"e', "f\r\ng"], ['1', '', '3', '4']]
        ? true : json_encode([$r, $tab, $cp, $round], JSON_UNESCAPED_UNICODE);
});
check('parseDate — the date spellings of a hand-kept book', function () {
    $d = function (string $s) { return strtotime($s) * 1000; };
    return Tfm\Allot::parseDate('2024-03-15') === $d('2024-03-15') && Tfm\Allot::parseDate('2024.3.5') === $d('2024-03-05') && Tfm\Allot::parseDate('2024/03/15') === $d('2024-03-15')
        && Tfm\Allot::parseDate('20240315') === $d('2024-03-15') && Tfm\Allot::parseDate('24.3.15') === $d('2024-03-15') && Tfm\Allot::parseDate('2024년 3월 15일') === $d('2024-03-15')
        && Tfm\Allot::parseDate('2024. 3. 15.') === $d('2024-03-15') && Tfm\Allot::parseDate('2024-02-30') === 0 && Tfm\Allot::parseDate('어제') === 0 && Tfm\Allot::parseDate('') === 0;
});
check('exportRows — keyset chunks; names and phones masked unless revealed by an admin (audited, with the reason, without the data)', function () use ($ADM, $NOADM, $NAME1) {
    $h = Tfm\Allot::exportHeader('contracts');
    $c1 = Tfm\Allot::exportRows('contracts', 0, 3);
    $c2 = Tfm\Allot::exportRows('contracts', $c1['next'], 500);
    $flat = json_encode([$c1, $c2], JSON_UNESCAPED_UNICODE);
    if (strpos($flat, $NAME1) !== false || strpos($flat, '7391') !== false) return 'the masked export leaks';
    if (!throwsApi(function () use ($NOADM) { Tfm\Allot::exportRows('contracts', 0, 3, true, $NOADM); }, 'FORBIDDEN', 403)) return 'non-admin reveal';
    if (!throwsApi(function () { Tfm\Allot::exportRows('contracts', 0, 3, true, null); }, 'FORBIDDEN', 403)) return 'reveal without an actor';
    if (!throwsApi(function () { Tfm\Allot::exportRows('passwords'); }, 'INVALID_INPUT', 400)) return 'unknown export';
    $before = (int) Tfm\Db::value("SELECT COUNT(*) FROM audit_log WHERE event = 'allot_export'");
    $full = Tfm\Allot::exportRows('ledger', 0, 500, true, $ADM, '세무 자료');
    $audit = (string) Tfm\Db::value("SELECT detail FROM audit_log WHERE event = 'allot_export' ORDER BY id DESC LIMIT 1");
    $fflat = json_encode($full, JSON_UNESCAPED_UNICODE);
    $kinds = [];
    foreach (Tfm\Allot::EXPORTS as $w) { $r = Tfm\Allot::exportRows($w, 0, 5); $kinds[$w] = count($r['rows']) > 0 && count($r['rows'][0]) === count(Tfm\Allot::exportHeader($w)); }
    return count($h) === 18 && count($c1['rows']) === 3 && $c1['next'] > 0 && count($c1['rows'][0]) === 18 && $c2['next'] === 0 && strpos($fflat, $NAME1) !== false && strpos($fflat, '010-7391-4625') !== false
        && (int) Tfm\Db::value("SELECT COUNT(*) FROM audit_log WHERE event = 'allot_export'") === $before + 1 && strpos($audit, $NAME1) === false && strpos($audit, '세무 자료') !== false
        && !in_array(false, $kinds, true) ? true : json_encode([count($h), count($c1['rows']), $c1['next'], $c2['next'], $kinds, $audit], JSON_UNESCAPED_UNICODE);
});
$LEDGER = "\xEF\xBB\xBF일자,성명,연락처,주소,비고,단위\r\n"
    . "2025-03-10,연오랑,010-6101-0001,강원도 정선군 가상길 1,첫 손님,T1-0021\r\n"
    . "2025.3.11,세오녀,010-6101-0002,,\"쉼표, 있는 비고\",T1\r\n"
    . "2025/03/12,연오랑,010-6101-0001,,둘째 독,T1\r\n"
    . "20250313,해모수,010-6101-0004,,,T3\r\n";
check('importCsv (ledger) — dry run: every row is reported with what would happen and what is wrong; nothing is written; no whole name or phone in the report', function () use ($ADM, $NOADM, $LEDGER) {
    if (!throwsApi(function () use ($NOADM, $LEDGER) { Tfm\Allot::importCsv($NOADM, 'ledger', $LEDGER); }, 'FORBIDDEN', 403)) return 'non-admin';
    if (!throwsApi(function () use ($ADM) { Tfm\Allot::importCsv($ADM, 'ledger', "성명,연락처\n가,010-1111-2222\n"); }, 'INVALID_INPUT', 400)) return 'a file without the unit column was accepted';
    $bad = $LEDGER
        . "2025-03-14,,010-6101-0005,,,T1\r\n"                       // 6: no name
        . "2025-03-14,주몽,010-****-0006,,,T1\r\n"                    // 7: masked phone
        . "2025-03-14,유화,010-6101-0007,,,T1-9999\r\n"               // 8: unknown unit
        . "2025-03-14,금와,010-6101-0008,,,T1-0021\r\n"               // 9: the unit of line 2 again
        . "3월 14일,대소,010-6101-0009,,,T1\r\n"                       // 10: unreadable date
        . "2025-03-14,비류,010-6101-0010,,,T1-0001\r\n"               // 11: a unit in use
        . "2025-03-14,온조,010-6101-0011,,,ZZ\r\n";                   // 12: neither a unit nor a zone
    $before = [(int) Tfm\Db::value('SELECT COUNT(*) FROM allot_customers'), (int) Tfm\Db::value('SELECT COUNT(*) FROM allot_contracts')];
    $r = Tfm\Allot::importCsv($ADM, 'ledger', $bad, true);
    $after = [(int) Tfm\Db::value('SELECT COUNT(*) FROM allot_customers'), (int) Tfm\Db::value('SELECT COUNT(*) FROM allot_contracts')];
    $byLine = [];
    foreach ($r['rows'] as $row) $byLine[$row['line']] = $row;
    $flat = json_encode($r, JSON_UNESCAPED_UNICODE);
    foreach (['연오랑', '세오녀', '6101-0001', '01061010002'] as $leak) if (strpos($flat, $leak) !== false) return "the report shows '$leak'";
    $commit = Tfm\Allot::importCsv($ADM, 'ledger', $bad, false);   // a file with problems is never imported in part
    $still = [(int) Tfm\Db::value('SELECT COUNT(*) FROM allot_customers'), (int) Tfm\Db::value('SELECT COUNT(*) FROM allot_contracts')];
    return $r['ok'] === false && $r['dryRun'] === true && $r['total'] === 11 && $r['valid'] === 4 && $r['invalid'] === 7 && $before === $after && $before === $still && $commit['ok'] === false && $commit['dryRun'] === true
        && $byLine[2]['action'] === 'new' && $byLine[2]['unit'] === 'T1-0021' && $byLine[3]['action'] === 'new' && preg_match('/^T1-\d{4}$/', $byLine[3]['unit']) && $byLine[3]['unit'] !== $byLine[4]['unit']
        && preg_match('/^T3-\d{4}$/', $byLine[5]['unit']) && $byLine[2]['who'] === '연** · 0001' && $r['rows'][0]['ok'] === false && $byLine[6]['unit'] === 'T1' && $byLine[10]['unit'] === 'T1'
        && count($byLine[6]['problems']) === 1 && strpos($byLine[7]['problems'][0], '가려져') !== false && strpos($byLine[8]['problems'][0], '없는 단위') !== false && strpos($byLine[9]['problems'][0], '2번째 줄') !== false
        && strpos($byLine[10]['problems'][0], '일자') !== false && strpos($byLine[11]['problems'][0], '이미 쓰고') !== false && strpos($byLine[12]['problems'][0], '알아볼 수 없어요') !== false
        ? true : $flat;
});
check('importCsv (ledger) — a clean file: customers (one per phone + name) and active contracts are made; importing the same file again makes nothing', function () use ($ADM, $LEDGER) {
    $r = Tfm\Allot::importCsv($ADM, 'ledger', $LEDGER, false);
    $u = unitRow('T1-0021');
    $c = (array) Tfm\Db::one('SELECT c.*, cu.name_enc, cu.addr_enc, cu.memo AS cmemo, cu.consent_ver FROM allot_contracts c JOIN allot_customers cu ON cu.id = c.customer_id WHERE c.unit_id = ?', [(int) $u['id']]);
    $again = Tfm\Allot::importCsv($ADM, 'ledger', $LEDGER, false);
    $dry = Tfm\Allot::importCsv($ADM, 'ledger', $LEDGER, true);
    $actions = array_map(function ($x) { return $x['action']; }, $dry['rows']);
    $monthly = (array) Tfm\Db::one("SELECT c.* FROM allot_contracts c JOIN allot_units u ON u.id = c.unit_id JOIN allot_zones z ON z.id = u.zone_id WHERE z.code = 'T3' AND c.source = 'import'");
    $more = Tfm\Allot::importCsv($ADM, 'ledger', "성명,연락처,단위\n연오랑,010-6101-0001,T1-0022\n", false);   // a known customer, one more unit
    $dump = dumpAll();
    foreach (['연오랑', '세오녀', '01061010001', '가상길'] as $plain) if (strpos($dump, $plain) !== false) return "plaintext '$plain' is stored";
    return $r['ok'] === true && $r['dryRun'] === false && $r['created'] === ['customers' => 3, 'contracts' => 4, 'payments' => 0] && $u['status'] === 'leased' && $c['status'] === 'active' && $c['source'] === 'import'
        && (int) $c['starts_at'] === strtotime('2025-03-10') * 1000 && Tfm\Crypto::open($c['name_enc']) === '연오랑' && Tfm\Crypto::open($c['addr_enc']) === '강원도 정선군 가상길 1' && Tfm\Crypto::open($c['cmemo']) === '첫 손님'
        && $c['consent_ver'] === 'import' && $c['user_id'] === null && (int) $monthly['paid_until'] > Tfm\Clock::ms() && (int) $monthly['ends_at'] === 0
        && $again['created'] === ['customers' => 0, 'contracts' => 0, 'payments' => 0] && $again['skipped'] === 4 && $actions === ['duplicate', 'duplicate', 'duplicate', 'duplicate']
        && $more['created'] === ['customers' => 0, 'contracts' => 1, 'payments' => 0] && $more['rows'][0]['action'] === 'existing' && unitRow('T1-0022')['status'] === 'leased'
        ? true : json_encode([$r, $again, $actions, $more, $c['status']]);
});
check('importCsv (payments) — by contract number or by unit; the same file twice pays once; a bad row stops the whole file', function () use ($ADM) {
    $c = (array) Tfm\Db::one("SELECT c.id, c.contract_no, c.paid_total, c.paid_until, u.code AS unit FROM allot_contracts c JOIN allot_units u ON u.id = c.unit_id JOIN allot_zones z ON z.id = u.zone_id WHERE z.code = 'T3' AND c.source = 'import'");
    $csv = "계약번호,단위,금액,일자,방법,비고\r\n{$c['contract_no']},,\"10,000\",2026-10-25,자동이체,10월\r\n,{$c['unit']},10000원,2026-10-25,자동이체,같은 날 두 번째\r\n,T1-0021,130000,2026.11.1,계좌이체,\r\n";
    $dry = Tfm\Allot::importCsv($ADM, 'payments', $csv, true);
    $r = Tfm\Allot::importCsv($ADM, 'payments', $csv, false);
    $again = Tfm\Allot::importCsv($ADM, 'payments', $csv, false);
    $c2 = (array) Tfm\Db::one('SELECT paid_total, paid_until FROM allot_contracts WHERE id = ?', [(int) $c['id']]);
    $bad = Tfm\Allot::importCsv($ADM, 'payments', $csv . ",T1-0021,많이,2026-11-02,계좌이체,\r\n,T9-0001,1000,2026-11-02,현금,\r\n", false);
    return $dry['valid'] === 3 && $dry['created']['payments'] === 0 && $r['ok'] === true && $r['created']['payments'] === 3 && $again['created']['payments'] === 0 && $again['skipped'] === 3
        && (int) $c2['paid_total'] === (int) $c['paid_total'] + 20000 && (int) $c2['paid_until'] === Tfm\Allot::addMonths((int) $c['paid_until'], 2) && $bad['ok'] === false && $bad['invalid'] === 2
        && $bad['created']['payments'] === 0 ? true : json_encode([$dry, $r['created'], $again, $c2, $bad['invalid']], JSON_UNESCAPED_UNICODE);
});

// SECTION-MARK (the following sections are appended as the library grows)

echo PHP_EOL . ($failed === 0 ? "✔ all $passed allot unit checks passed" : "✖ $failed of " . ($failed + $passed) . " allot check(s) failed") . ' (driver ' . Tfm\Db::driverSafe() . ')' . PHP_EOL;
exit($failed === 0 ? 0 : 1);
