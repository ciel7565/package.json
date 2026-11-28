<?php
/**
 * tests/fix10-unit.php — the server faults the first orchestrator pass listed for phase 11's lane "fix10" (CONTRACT §19.10):
 *   · ChatFilter::maskPII kept only the first 400 code points of a longer text (a 700-character report to the operator,
 *     a 500-character memo) — the rest was silently dropped
 *   · Allot::apply: a second application overwrote the stored name / phone / guardian flag of the account's customer
 *     without a trace → an audit row (field names only)
 *   · Allot::transfer moved a contract to a unit of another kind (jar → plot)
 *   · Allot::tick('cli' / 'lazy') ran holds / approvals / overdue while allot.enabled is false (the operator's button still works)
 *   · Allot::tick with the real clock after a long silence (a clock that jumped, a machine that slept) expired holds, ended
 *     contracts and erased personal data at once → the destructive steps wait for one more tick and the gap is listed
 *   · nameplates and public notes kept '<' and '>' → stripped (defence in depth; the app shows them as text anyway)
 *   · Db::ensureIndexes: a database that reached schema v7 before ix_aunits_state / ix_apay_paid existed gets them
 * No web server: a throw-away SQLite database in the temp dir (MariaDB: the TFM_DB_* variables as in tests/allot-unit.php).
 *   php tests/fix10-unit.php
 * CLI only; never deployed. PHP 8.x on the developer machine.
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
$root = sys_get_temp_dir() . '/tfm-fix10-' . bin2hex(random_bytes(6));
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
function check(string $name, callable $test): void
{
    global $failed, $passed;
    try {
        $r = $test();
        $ok = $r === true;
        $detail = is_string($r) ? $r : ($ok ? '' : 'assertion is false');
    } catch (Throwable $e) {
        $ok = false;
        $detail = get_class($e) . ': ' . $e->getMessage() . ' @' . basename($e->getFile()) . ':' . $e->getLine();
    }
    if ($ok) $passed++; else $failed++;
    echo ($ok ? 'PASS  ' : 'FAIL  ') . $name . ($ok || $detail === '' ? '' : "  — $detail") . PHP_EOL;
}
function apiCode(callable $fn): string
{
    try { $fn(); } catch (Tfm\ApiException $e) { return $e->status . ' ' . $e->errorCode; }
    return '';
}

$ADM = ['id' => 0, 'role' => 'admin'];
$RUN = bin2hex(random_bytes(3));
$nUsers = 0;
function newUser(): array
{
    global $RUN, $nUsers;
    $nUsers++;
    return Tfm\Users::create("fx{$RUN}{$nUsers}@example.com", 'Fx' . substr($RUN, 0, 4) . $nUsers, 'Ferment2026ok', '');
}
function form(array $over = []): array
{
    global $nUsers;
    return $over + ['name' => '홍길동', 'phone' => '010-5550-' . str_pad((string) (1000 + $nUsers), 4, '0', STR_PAD_LEFT), 'consent' => true, 'consentVersion' => Tfm\Allot::consentVersion(), 'adult' => true];
}
function conRow(string $no): array { return (array) Tfm\Db::one('SELECT * FROM allot_contracts WHERE contract_no = ?', [$no]); }
function unitRow(string $code): array { return (array) Tfm\Db::one('SELECT * FROM allot_units WHERE code = ?', [$code]); }
Tfm\Db::pdo();
$H = 3600000;
$DAY = 86400000;

// ---------------------------------------------------------------------------------------------- ChatFilter, long texts
check('maskPII — a 700-character text keeps all its characters (it used to stop at 400)', function () {
    $t = str_repeat('가나다라마바사 ', 100);           // 700 code points
    $m = Tfm\ChatFilter::maskPII($t);
    return mb_strlen($m) === mb_strlen($t) ? true : 'in ' . mb_strlen($t) . ' out ' . mb_strlen($m);
});
check('maskPII — a phone number at character 850 of a 1000-character text is masked and the text after it stays', function () {
    $t = str_repeat('가', 850) . ' 010-1234-5678 ' . str_repeat('나', 120);
    $m = Tfm\ChatFilter::maskPII($t, $hits);
    return $hits === 1 && strpos($m, '5678') === false && mb_strpos($m, Tfm\ChatFilter::PII_MARK) !== false && mb_substr($m, -120) === str_repeat('나', 120) ? true : 'hits ' . $hits . ' len ' . mb_strlen($m);
});
check('a 500-character admin memo (Farm::decide) and a 1000-character report body (Support) are not cut at 400', function () {
    $ref = new ReflectionMethod('Tfm\Farm', 'cleanNote');
    $ref->setAccessible(true);
    $memo = $ref->invoke(null, str_repeat('다', 500), 500);
    return mb_strlen($memo) === 500 ? true : 'memo ' . mb_strlen($memo);
});

// ---------------------------------------------------------------------------------------------- Allot fixtures
Tfm\Allot::saveZone($ADM, ['code' => 'F1', 'kind' => 'jar', 'name' => '시험 장독대', 'capacity' => 20, 'cols' => 10, 'price' => 0, 'period' => 'year', 'termMonths' => 12, 'isOpen' => true]);
Tfm\Allot::saveZone($ADM, ['code' => 'F2', 'kind' => 'plot', 'name' => '시험 텃밭', 'capacity' => 10, 'cols' => 5, 'price' => 0, 'period' => 'year', 'termMonths' => 12, 'isOpen' => true]);

check('apply — a second application with another name / phone leaves an audit row naming the changed fields (never the values)', function () {
    $u = newUser();
    $a = Tfm\Allot::apply($u, 'F1-0001', form(['name' => '김시험', 'phone' => '010-4444-1111']));
    $before = (int) Tfm\Db::value("SELECT COUNT(*) FROM audit_log WHERE event = 'allot_customer_changed'");
    Tfm\Allot::apply($u, 'F1-0002', form(['name' => '박다른', 'phone' => '010-4444-2222']));
    $rows = Tfm\Db::all("SELECT detail FROM audit_log WHERE event = 'allot_customer_changed' ORDER BY id DESC LIMIT 3");
    $d = $rows ? (string) $rows[0]['detail'] : '';
    $leak = strpos($d, '박다른') !== false || strpos($d, '2222') !== false || strpos($d, '김시험') !== false;
    $after = (int) Tfm\Db::value("SELECT COUNT(*) FROM audit_log WHERE event = 'allot_customer_changed'");
    // the same data again changes nothing and writes nothing
    Tfm\Allot::apply($u, 'F1-0003', form(['name' => '박다른', 'phone' => '010-4444-2222']));
    $same = (int) Tfm\Db::value("SELECT COUNT(*) FROM audit_log WHERE event = 'allot_customer_changed'");
    return $a['status'] === 'pending' && $after === $before + 1 && strpos($d, 'name') !== false && strpos($d, 'phone') !== false && !$leak && $same === $after ? true : json_encode([$before, $after, $same, $d], JSON_UNESCAPED_UNICODE);
});

check('transfer — a contract may not move to a unit of another kind (jar → plot): 409 KIND_MISMATCH, nothing changes', function () use ($ADM) {
    $u = newUser();
    $a = Tfm\Allot::apply($u, 'F1-0010', form());
    $id = (int) conRow($a['contractNo'])['id'];
    $code = apiCode(function () use ($ADM, $id) { Tfm\Allot::transfer($ADM, $id, 'F2-0001'); });
    $c = conRow($a['contractNo']);
    $plot = unitRow('F2-0001');
    $ok = Tfm\Allot::transfer($ADM, $id, 'F1-0011');
    return $code === '409 KIND_MISMATCH' && (int) $c['unit_id'] === (int) unitRow('F1-0010')['id'] && $plot['status'] === 'open' && unitRow('F1-0011')['status'] === 'held' && (int) conRow($a['contractNo'])['unit_id'] === (int) unitRow('F1-0011')['id'] && is_array($ok) ? true : json_encode([$code, $plot['status'], unitRow('F1-0011')['status']]);
});

check('cleanPublic / setLabel — < and > never stay in a nameplate', function () use ($ADM) {
    $r = Tfm\Allot::setLabel($ADM, (int) unitRow('F1-0012')['id'], '<b>꽃밭</b> & 별', true);
    return strpos($r['text'], '<') === false && strpos($r['text'], '>') === false && strpos($r['text'], '꽃밭') !== false ? true : $r['text'];
});

// ---------------------------------------------------------------------------------------------- the automation
check('tick — with allot.enabled off the cli / lazy automation changes nothing (an expired hold stays), the admin button still runs everything', function () use ($ADM, $H, $DAY) {
    $u = newUser();
    $t0 = Tfm\Clock::ms() - 5 * $DAY;
    $a = Tfm\Allot::apply($u, 'F1-0020', form(), $t0);           // held until t0 + 48 h: long over
    Tfm\Allot::saveSettings($ADM, ['enabled' => false]);
    try {
        $r = Tfm\Allot::tick($t0 + 100 * $H, 'cli');
        $still = conRow($a['contractNo'])['status'];
        $lazy = Tfm\Allot::tick($t0 + 100 * $H, 'lazy');
        $still2 = conRow($a['contractNo'])['status'];
        $btn = Tfm\Allot::tick($t0 + 100 * $H, 'admin');
        $after = conRow($a['contractNo'])['status'];
    } finally { Tfm\Allot::saveSettings($ADM, ['enabled' => true]); }
    return $still === 'pending' && $still2 === 'pending' && $after === 'canceled' && ($r['paused'] ?? false) === true && $r['steps']['holds'] === 0 && $btn['steps']['holds'] >= 1 ? true : json_encode([$still, $still2, $after, $r['paused'] ?? null, $btn['steps']['holds'] ?? null]);
});

check('tick — real clock, a gap of days since the last run: holds / auto-end / purge wait one tick and the gap is listed as an issue; an injected clock (tests, tools) is not guarded', function () use ($ADM, $H, $DAY) {
    $u = newUser();
    $now = Tfm\Clock::ms();
    $a = Tfm\Allot::apply($u, 'F1-0016', form(), $now - 6 * $DAY);   // its hold ended four days ago
    // the automation last started five days ago
    Tfm\Db::exec("UPDATE settings SET v = ? WHERE k = 'allot.tick_at'", [(string) ($now - 5 * $DAY)]);
    if ((int) Tfm\Db::value("SELECT COUNT(*) FROM settings WHERE k = 'allot.tick_at'") === 0) Tfm\Db::insert('settings', ['k' => 'allot.tick_at', 'v' => (string) ($now - 5 * $DAY), 'updated_at' => $now, 'updated_by' => null]);
    $r1 = Tfm\Allot::tick(null, 'cli');
    $mid = conRow($a['contractNo'])['status'];
    $gap = array_values(array_filter($r1['issues'], function ($i) { return $i['kind'] === 'clock_gap'; }));
    $r2 = Tfm\Allot::tick(null, 'cli');
    $end = conRow($a['contractNo'])['status'];
    return $mid === 'pending' && count($gap) === 1 && $end === 'canceled' && $r2['steps']['holds'] >= 1 ? true : json_encode([$mid, count($gap), $end, $r2['steps']['holds'] ?? null]);
});

// ---------------------------------------------------------------------------------------------- Db::ensureIndexes
check('Db::ensureIndexes — an index that a v7 database lacks is created again; the call is idempotent', function () {
    if (Tfm\Db::driver() === 'sqlite') Tfm\Db::exec('DROP INDEX IF EXISTS ix_apay_paid'); else { try { Tfm\Db::exec('DROP INDEX ix_apay_paid ON allot_payments'); } catch (Throwable $e) { /* none */ } }
    $had = Tfm\Db::hasIndex('allot_payments', 'ix_apay_paid');
    $n1 = Tfm\Db::ensureIndexes();
    $has = Tfm\Db::hasIndex('allot_payments', 'ix_apay_paid') && Tfm\Db::hasIndex('allot_units', 'ix_aunits_state');
    $n2 = Tfm\Db::ensureIndexes();
    return !$had && $n1 >= 1 && $has && $n2 === 0 ? true : json_encode([$had, $n1, $has, $n2]);
});

echo PHP_EOL . ($failed === 0 ? "✔ all $passed fix10 unit checks passed (driver " . Tfm\Db::driverSafe() . ')' : "✖ $failed of " . ($passed + $failed) . ' fix10 unit checks FAILED') . PHP_EOL;
exit($failed === 0 ? 0 : 1);
