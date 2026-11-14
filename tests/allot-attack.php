<?php
/**
 * tests/allot-attack.php — adversarial checks for the allotment (분양) server (CONTRACT §16.7), written by the
 * independent verifier from the public interface BEFORE reading the library: real races between several PHP
 * processes that start at the same instant (a barrier file), state machines pushed towards impossible states, money
 * (tampered amounts, replays, payments for closed contracts, month ends, leap days, the Seoul day line), personal
 * data (every public answer, error text, log line, audit detail, export default, nameplate), IDOR / enumeration,
 * validation (types, sizes, Unicode), CSV (formula cells, quoting, big files, duplicates, re-assignment), the
 * automation (idempotence, batches, a crash in the middle, two runs at once, a clock that goes backwards), driver
 * differences (MariaDB 10.3 / SQLite) and the query plans of the hot paths with 10,000 units and contracts.
 *
 *   php tests/allot-attack.php
 *   TFM_DB_DRIVER=mysql TFM_DB_HOST=127.0.0.1 TFM_DB_PORT=33106 TFM_DB_USER=root TFM_DB_NAME=tfm_va_attack php tests/allot-attack.php
 *   (the MariaDB database must exist and be EMPTY)
 *
 * TFM_UNIT_ONLY=<text> runs only the checks whose name contains <text> (the set-up between checks still runs).
 * TFM_ATTACK_ROUNDS=<n> repeats the race rounds n times (default 3). TFM_ATTACK_BIG=0 skips the 10,000-row checks.
 * Independent of the library's own integrity scan: invariants() below reads the tables directly.
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
// A private copy of the server tree (the child processes and the CLI run from it) and a separate data directory.
$root = sys_get_temp_dir() . '/tfm-attack-' . bin2hex(random_bytes(6));
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
$skipped = 0;
/** $test returns true (pass), 'SKIP: why', false or a string (fail + detail); a thrown error is a fail with its message */
function check(string $name, callable $test): void
{
    global $failed, $passed, $skipped;
    $only = (string) getenv('TFM_UNIT_ONLY');
    if ($only !== '' && strpos($name, $only) === false) return;
    $t = microtime(true);
    try {
        $r = $test();
        $ok = $r === true;
        $detail = is_string($r) ? $r : ($ok ? '' : 'assertion is false');
    } catch (Throwable $e) {
        $ok = false;
        $detail = get_class($e) . ': ' . $e->getMessage() . ' @' . basename($e->getFile()) . ':' . $e->getLine();
    }
    $ms = (int) round((microtime(true) - $t) * 1000);
    if (!$ok && strpos($detail, 'SKIP:') === 0) { $skipped++; echo "SKIP  $name  — " . trim(substr($detail, 5)) . PHP_EOL; return; }
    if ($ok) $passed++; else $failed++;
    echo ($ok ? 'PASS  ' : 'FAIL  ') . $name . ($ms >= 2000 ? "  [{$ms} ms]" : '') . ($ok || $detail === '' ? '' : "  — $detail") . PHP_EOL;
}
/** did $fn throw an ApiException with $code (and, when given, HTTP $status) */
function throwsApi(callable $fn, string $code, int $status = 0): bool
{
    try { $fn(); } catch (Tfm\ApiException $e) { return $e->errorCode === $code && ($status === 0 || $e->status === $status); }
    return false;
}
/** what a call throws: "status CODE" of an ApiException, "ERR class: message" of anything else, '' = nothing */
function apiCode(callable $fn): string
{
    try { $fn(); } catch (Tfm\ApiException $e) { return $e->status . ' ' . $e->errorCode; } catch (Throwable $e) { return 'ERR ' . get_class($e) . ': ' . $e->getMessage(); }
    return '';
}
/** the message + data of the ApiException a call throws ('' = none) — what a client would be shown */
function apiText(callable $fn): string
{
    try { $fn(); } catch (Tfm\ApiException $e) { return $e->getMessage() . ' ' . json_encode(isset($e->data) ? $e->data : null, JSON_UNESCAPED_UNICODE); } catch (Throwable $e) { return 'ERR ' . get_class($e) . ': ' . $e->getMessage(); }
    return '';
}

$IS_MYSQL = strtolower((string) Tfm\Config::get('db.driver', 'sqlite')) === 'mysql';
$DAY = 86400000;
$H = 3600000;
$ROUNDS = max(1, (int) (getenv('TFM_ATTACK_ROUNDS') ?: 3));
$BIG = getenv('TFM_ATTACK_BIG') !== '0';
$ADM = ['id' => 0, 'role' => 'admin'];
$NOADM = ['id' => 7, 'role' => 'user'];
$RUN = bin2hex(random_bytes(3));
$nUsers = 0;
Tfm\Db::pdo();
echo 'driver: ' . Tfm\Db::driverSafe() . ', rounds: ' . $ROUNDS . PHP_EOL;

/** a fresh app account (unique per run) */
function newUser(string $role = 'user'): array
{
    global $RUN, $nUsers;
    $nUsers++;
    return Tfm\Users::create("atk{$RUN}{$nUsers}@example.com", 'Ak' . substr($RUN, 0, 4) . $nUsers, 'Ferment2026ok', $role === 'admin' ? 'admin' : '');
}
/** a valid application form (synthetic person; a different phone per call) */
function form(array $over = []): array
{
    static $n = 0;
    $n++;
    return $over + ['name' => '공격자' . chr(0x41 + $n % 26), 'phone' => '010-6600-' . str_pad((string) ($n % 10000), 4, '0', STR_PAD_LEFT), 'consent' => true,
        'consentVersion' => Tfm\Allot::consentVersion(), 'adult' => true];
}
/** PHP source of a valid form for a child process ($I = the child's number) */
function formPhp(int $salt): string
{
    return '["name" => "경쟁자" . chr(65 + $I % 26), "phone" => "010-77' . str_pad((string) ($salt % 100), 2, '0', STR_PAD_LEFT) . '-" . str_pad((string) (' . ($salt * 37 % 9000) . ' + $I), 4, "0", STR_PAD_LEFT), '
        . '"consent" => true, "consentVersion" => Tfm\\Allot::consentVersion(), "adult" => true]';
}
function unitRow(string $code): array { return (array) Tfm\Db::one('SELECT * FROM allot_units WHERE code = ?', [$code]); }
function conRow(string $no): array { return (array) Tfm\Db::one('SELECT * FROM allot_contracts WHERE contract_no = ?', [$no]); }
function conById(int $id): array { return (array) Tfm\Db::one('SELECT * FROM allot_contracts WHERE id = ?', [$id]); }
/** the newest contract on a unit code */
function conOn(string $unitCode): array
{
    return (array) Tfm\Db::one('SELECT c.* FROM allot_contracts c JOIN allot_units u ON u.id = c.unit_id WHERE u.code = ? ORDER BY c.id DESC LIMIT 1', [$unitCode]);
}
/** PHP source of a child body: $body echoes its own "ok…" token; an ApiException prints its code, anything else "ERR …" */
function child(string $body): string
{
    return 'try { ' . $body . ' } catch (Tfm\\ApiException $e) { echo $e->errorCode; } '
        . 'catch (Throwable $e) { echo "ERR " . get_class($e) . " " . $e->getMessage() . " @" . basename($e->getFile()) . ":" . $e->getLine(); }';
}
/**
 * Run PHP snippets in parallel processes against this test's database. Every child boots the server, opens its
 * database connection and then WAITS at a barrier file; the parent releases all of them at the same instant, so the
 * snippets really overlap (process start-up alone spreads "parallel" children over tens of milliseconds).
 * Returns the outputs in the order of $codes. In a child: $I = its number, $ADM = the CLI admin actor.
 */
$par = function (array $codes) use ($srv, $root): array {
    static $seq = 0;
    $seq++;
    $go = $root . '/go' . $seq;
    $procs = [];
    $codes = array_values($codes);
    foreach ($codes as $i => $code) {
        $boot = 'require $argv[1]; $I = (int) $argv[2]; $GO = $argv[3]; $ADM = ["id" => 0, "role" => "admin"]; Tfm\\Db::pdo(); Tfm\\Allot::rules(); touch($GO . ".r" . $I); '
            . '$__t = microtime(true); while (!file_exists($GO)) { if (microtime(true) - $__t > 180) { echo "ERR no go"; exit(3); } usleep(200); } ';
        $p = proc_open([PHP_BINARY, '-r', $boot . $code, $srv . '/lib/bootstrap.php', (string) $i, $go], [1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes);
        if (!is_resource($p)) throw new RuntimeException('proc_open failed');
        $procs[] = [$p, $pipes];
    }
    $n = count($procs);
    $t = microtime(true);
    while (microtime(true) - $t < 180) {
        $ready = 0;
        for ($i = 0; $i < $n; $i++) if (file_exists($go . '.r' . $i)) $ready++;
        if ($ready === $n) break;
        usleep(2000);
    }
    touch($go);
    $out = [];
    foreach ($procs as $pp) { $out[] = trim(stream_get_contents($pp[1][1]) . stream_get_contents($pp[1][2])); fclose($pp[1][1]); fclose($pp[1][2]); proc_close($pp[0]); }
    for ($i = 0; $i < $n; $i++) @unlink($go . '.r' . $i);
    @unlink($go);
    return $out;
};
/** the outputs that are neither an expected token nor a known error code: unexpected exceptions, warnings, fatals */
function strays(array $out, array $allowed): array
{
    $bad = [];
    foreach ($out as $x) {
        $ok = false;
        foreach ($allowed as $a) if ($x === $a || ($a !== '' && substr($a, -1) === '*' && strpos($x, substr($a, 0, -1)) === 0)) { $ok = true; break; }
        if (!$ok) $bad[] = $x;
    }
    return $bad;
}

/**
 * The verifier's own consistency rules, read straight from the tables (not Allot::integrity). [] = consistent.
 * A unit and its contract must tell the same story, a unit never has two live contracts, a waiting-list offer holds
 * its unit, and the money on a contract equals its paid payments.
 */
function invariants(): array
{
    $bad = [];
    $q = function (string $name, string $sql) use (&$bad) {
        $rows = Tfm\Db::all($sql);
        if ($rows) $bad[] = $name . ' ' . json_encode(array_slice($rows, 0, 3));
    };
    $q('two live contracts on one unit', "SELECT unit_id, COUNT(*) AS n FROM allot_contracts WHERE status IN ('pending','active','overdue') GROUP BY unit_id HAVING COUNT(*) > 1");
    $q('live contract without its live_unit_id', "SELECT id, status, unit_id, live_unit_id FROM allot_contracts WHERE status IN ('pending','active','overdue') AND (live_unit_id IS NULL OR live_unit_id <> unit_id)");
    $q('closed contract keeps live_unit_id', "SELECT id, status, live_unit_id FROM allot_contracts WHERE status IN ('ended','canceled') AND live_unit_id IS NOT NULL");
    $q('pending contract whose unit is not held by it', "SELECT c.id, u.code, u.status, u.contract_id FROM allot_contracts c JOIN allot_units u ON u.id = c.unit_id WHERE c.status = 'pending' AND (u.status <> 'held' OR u.contract_id IS NULL OR u.contract_id <> c.id)");
    $q('running contract whose unit is not leased by it', "SELECT c.id, c.status AS cs, u.code, u.status, u.contract_id FROM allot_contracts c JOIN allot_units u ON u.id = c.unit_id WHERE c.status IN ('active','overdue') AND (u.status <> 'leased' OR u.contract_id IS NULL OR u.contract_id <> c.id)");
    $q('unit points at a contract that is not live on it', "SELECT u.id, u.code, u.status, u.contract_id, c.status AS cs, c.unit_id FROM allot_units u LEFT JOIN allot_contracts c ON c.id = u.contract_id WHERE u.contract_id IS NOT NULL AND (c.id IS NULL OR c.unit_id <> u.id OR c.status NOT IN ('pending','active','overdue'))");
    $q('leased unit without a contract', "SELECT id, code FROM allot_units WHERE status = 'leased' AND contract_id IS NULL");
    $q('open / closed unit with a contract', "SELECT id, code, status, contract_id FROM allot_units WHERE status IN ('open','closed') AND contract_id IS NOT NULL");
    $q('waiting-list row: live key does not match its status', "SELECT id, status, live_key FROM allot_waitlist WHERE (status IN ('waiting','offered') AND live_key IS NULL) OR (status NOT IN ('waiting','offered') AND live_key IS NOT NULL)");
    $q('offer on a unit that is not held for it', "SELECT w.id, w.unit_id, u.code, u.status, u.contract_id FROM allot_waitlist w JOIN allot_units u ON u.id = w.unit_id WHERE w.status = 'offered' AND (u.status <> 'held' OR u.contract_id IS NOT NULL)");
    $q('offered row without a unit', "SELECT id FROM allot_waitlist WHERE status = 'offered' AND (unit_id IS NULL OR unit_id = 0)");
    $q('two offers for one unit', "SELECT unit_id, COUNT(*) AS n FROM allot_waitlist WHERE status = 'offered' GROUP BY unit_id HAVING COUNT(*) > 1");
    $q('paid_total differs from the paid payments', "SELECT c.id, c.status, c.paid_total, COALESCE(p.s, 0) AS paid FROM allot_contracts c LEFT JOIN (SELECT contract_id, SUM(amount) AS s FROM allot_payments WHERE status = 'paid' AND kind <> 'refund' GROUP BY contract_id) p ON p.contract_id = c.id WHERE c.paid_total <> COALESCE(p.s, 0)");
    $q('negative money', 'SELECT id, paid_total, price FROM allot_contracts WHERE paid_total < 0 OR price < 0');
    $q('closed contract without an end time', "SELECT id, status, ended_at FROM allot_contracts WHERE status IN ('ended','canceled') AND (ended_at IS NULL OR ended_at <= 0)");
    return $bad;
}
/** invariants() as one text ('' = consistent) */
function inv(): string { return implode(' | ', invariants()); }

// =============================================================================================== 0 · set-up
Tfm\Allot::saveSettings($ADM, ['enabled' => true]);
Tfm\Allot::saveZone($ADM, ['code' => 'A1', 'kind' => 'jar', 'name' => '공격 장독대', 'capacity' => 400, 'cols' => 20, 'price' => 120000, 'period' => 'year', 'termMonths' => 12, 'isOpen' => true]);
Tfm\Allot::saveZone($ADM, ['code' => 'A2', 'kind' => 'plot', 'name' => '공격 텃밭', 'capacity' => 200, 'cols' => 20, 'price' => 10000, 'period' => 'month', 'termMonths' => 0, 'isOpen' => true]);
Tfm\Allot::saveZone($ADM, ['code' => 'A3', 'kind' => 'store', 'name' => '공격 창고', 'capacity' => 4, 'cols' => 2, 'price' => 220000, 'period' => 'once', 'termMonths' => 12, 'isOpen' => true]);
$nextUnit = ['A1' => 0, 'A2' => 0];
/** a unit code of A1 / A2 that no check has used yet */
$fresh = function (string $zone) use (&$nextUnit): string { $nextUnit[$zone]++; return sprintf('%s-%04d', $zone, $nextUnit[$zone]); };
$idem = function (): string { return 'atk-' . bin2hex(random_bytes(8)); };
/** an offline customer + an active contract on $unit */
$offline = function (string $unit, ?int $start = null) use ($ADM): array {
    static $n = 0;
    $n++;
    $cu = Tfm\Allot::saveCustomer($ADM, ['name' => '현장고객' . chr(0x41 + ($n % 26)), 'phone' => '010-4500-' . str_pad((string) $n, 4, '0', STR_PAD_LEFT)]);
    Tfm\Allot::createContract($ADM, $unit, $cu['id'], $start === null ? [] : ['startsAt' => $start]);
    return conOn($unit);
};

check('set-up — three zones with units, an empty ledger is consistent', function () {
    $n = (int) Tfm\Db::value('SELECT COUNT(*) FROM allot_units');
    return $n === 604 && inv() === '' ? true : "$n units; " . inv();
});

// =============================================================================================== 1 · races between processes
check('race — approve × user cancel × reject × hold expiry (tick) × a second applicant on ONE pending application: a legal end state every round', function () use ($par, $fresh, $ROUNDS, $H) {
    $seen = [];
    for ($r = 0; $r < $ROUNDS * 2; $r++) {
        $unit = $fresh('A1');
        $u = newUser();
        $u2 = newUser();
        $t0 = Tfm\Clock::ms();
        $a = Tfm\Allot::apply($u, $unit, form(), $t0);
        $cid = (int) conRow($a['contractNo'])['id'];
        $out = $par([
            child('Tfm\\Allot::decide($ADM, ' . $cid . ', "active", ""); echo "approved";'),
            child('$u = Tfm\\Users::byId(' . (int) $u['id'] . '); Tfm\\Allot::cancelByUser($u, ' . var_export($a['contractNo'], true) . '); echo "canceled";'),
            child('Tfm\\Allot::tick(' . ($t0 + 49 * $H) . ', "cli"); echo "ticked";'),
            child('$u = Tfm\\Users::byId(' . (int) $u2['id'] . '); Tfm\\Allot::apply($u, ' . var_export($unit, true) . ', ' . formPhp($r) . '); echo "applied";'),
            child('Tfm\\Allot::decide($ADM, ' . $cid . ', "canceled", ""); echo "rejected";'),
        ]);
        $stray = strays($out, ['approved', 'canceled', 'ticked', 'applied', 'rejected', 'UNIT_TAKEN', 'NOT_LIVE', 'NOT_PENDING', 'CONFLICT', 'NOT_FOUND', 'NOT_OPEN']);
        $c = conById($cid);
        $un = unitRow($unit);
        $state = $c['status'] . '/' . $un['status'];
        $seen[$state] = ($seen[$state] ?? 0) + 1;
        if ($stray) return "round $r: unexpected output " . json_encode($out, JSON_UNESCAPED_UNICODE);
        if (inv() !== '') return "round $r: " . inv() . ' after ' . json_encode($out);
        // "approved" and a cancel can both report success only if the cancel then became a request on a running contract
        if ($c['status'] === 'active' && (int) $un['contract_id'] !== $cid) return "round $r: active but the unit belongs to " . json_encode($un['contract_id']);
        if ($c['status'] === 'canceled' && $un['status'] === 'leased') return "round $r: canceled but the unit stays leased";
        if (in_array('applied', $out, true) && $c['status'] !== 'canceled') return "round $r: a second applicant got the unit while the first contract is {$c['status']}";
    }
    echo '      end states (contract/unit): ' . json_encode($seen) . PHP_EOL;
    return true;
});

check('race — one account sends 10 applications for 10 units at the same instant: never more than apply_per_user live contracts', function () use ($par, $fresh, $ROUNDS) {
    $max = (int) Tfm\Allot::conf('apply_per_user');
    for ($r = 0; $r < $ROUNDS; $r++) {
        $u = newUser();
        $codes = [];
        for ($i = 0; $i < 10; $i++) $codes[] = child('$u = Tfm\\Users::byId(' . (int) $u['id'] . '); Tfm\\Allot::apply($u, ' . var_export($fresh('A1'), true) . ', ' . formPhp(40 + $r) . '); echo "ok";');
        $out = $par($codes);
        $live = (int) Tfm\Db::value("SELECT COUNT(*) FROM allot_contracts WHERE user_id = ? AND status IN ('pending','active','overdue')", [(int) $u['id']]);
        $ok = count(array_filter($out, function ($x) { return $x === 'ok'; }));
        if (strays($out, ['ok', 'APPLY_LIMIT'])) return "round $r: unexpected output " . json_encode($out, JSON_UNESCAPED_UNICODE);
        if ($live > $max || $ok !== $live) return "round $r: $live live contracts (limit $max), $ok × ok — " . json_encode(array_count_values($out));
        if (inv() !== '') return "round $r: " . inv();
        $cust = (int) Tfm\Db::value('SELECT COUNT(*) FROM allot_customers WHERE user_id = ?', [(int) $u['id']]);
        if ($cust !== 1) return "round $r: $cust customer rows for one account";
    }
    return true;
});

check('race — one account joins the same waiting list 6 times at once: one row; and the list counts towards apply_per_user', function () use ($par, $ADM, $offline) {
    // A3 has 4 units: fill them so that a waiting list makes sense
    for ($i = 1; $i <= 4; $i++) $offline(sprintf('A3-%04d', $i));
    $u = newUser();
    $codes = [];
    for ($i = 0; $i < 6; $i++) $codes[] = child('$u = Tfm\\Users::byId(' . (int) $u['id'] . '); $w = Tfm\\Allot::waitJoin($u, "store", "A3", ' . formPhp(60) . '); echo "ok";');
    $out = $par($codes);
    $rows = Tfm\Db::all("SELECT id, status FROM allot_waitlist WHERE user_id = ?", [(int) $u['id']]);
    $live = count(array_filter($rows, function ($r) { return in_array($r['status'], ['waiting', 'offered'], true); }));
    if (strays($out, ['ok', 'ALREADY_WAITING', 'APPLY_LIMIT'])) return 'unexpected output ' . json_encode($out, JSON_UNESCAPED_UNICODE);
    return $live === 1 && count(array_filter($out, function ($x) { return $x === 'ok'; })) === 1 && inv() === '' ? true : json_encode([$out, $rows, inv()]);
});

check('race — a freed unit: the waiting-list offer × 5 direct applicants × tick: the unit goes to exactly one side', function () use ($par, $ADM, $ROUNDS) {
    for ($r = 0; $r < $ROUNDS; $r++) {
        // A3-0001 is leased (set-up above) and at least one account waits for a store unit
        $w = newUser();
        $wj = apiCode(function () use ($w) { Tfm\Allot::waitJoin($w, 'store', 'A3', form()); });
        if ($wj !== '') return "round $r: waitJoin → $wj";
        $unit = 'A3-0001';
        $c = conOn($unit);
        if (!in_array($c['status'], ['active', 'overdue', 'pending'], true)) return "round $r: set-up, {$unit} has no live contract (" . json_encode($c['status'] ?? null) . ')';
        $codes = [child('Tfm\\Allot::endContract($ADM, ' . (int) $c['id'] . ', "attack"); $o = Tfm\\Allot::offerNext(' . var_export($unit, true) . '); echo "ended";')];
        $ids = [];
        for ($i = 0; $i < 5; $i++) { $x = newUser(); $ids[] = (int) $x['id']; }
        for ($i = 0; $i < 5; $i++) {
            $codes[] = child('$u = Tfm\\Users::byId(' . $ids[$i] . '); for ($k = 0; $k < 40; $k++) { try { Tfm\\Allot::apply($u, ' . var_export($unit, true) . ', ' . formPhp(70 + $r) . '); echo "applied"; break; } '
                . 'catch (Tfm\\ApiException $e) { if ($e->errorCode !== "UNIT_TAKEN") throw $e; usleep(3000); } } if ($k === 40) echo "UNIT_TAKEN";');
        }
        $codes[] = child('usleep(20000); Tfm\\Allot::tick(null, "cli"); echo "ticked";');
        $codes[] = child('usleep(5000); $o = Tfm\\Allot::offerNext(' . var_export($unit, true) . '); echo "offer";');
        $out = $par($codes);
        if (strays($out, ['ended', 'applied', 'UNIT_TAKEN', 'ticked', 'offer', 'APPLY_LIMIT'])) return "round $r: unexpected output " . json_encode($out, JSON_UNESCAPED_UNICODE);
        if (inv() !== '') return "round $r: " . inv() . ' after ' . json_encode($out);
        $un = unitRow($unit);
        $offers = Tfm\Db::all("SELECT id, user_id FROM allot_waitlist WHERE status = 'offered' AND unit_id = ?", [(int) $un['id']]);
        $live = Tfm\Db::all("SELECT id, user_id, status FROM allot_contracts WHERE unit_id = ? AND status IN ('pending','active','overdue')", [(int) $un['id']]);
        $applied = count(array_filter($out, function ($x) { return $x === 'applied'; }));
        if (count($offers) + count($live) > 1) return "round $r: the unit is promised twice — offers " . json_encode($offers) . ', contracts ' . json_encode($live);
        if ($applied > 1) return "round $r: $applied direct applicants were told they got the unit";
        if ($applied === 1 && count($live) !== 1) return "round $r: an applicant was told 'applied' but no live contract exists";
        if ($un['status'] === 'open' && (count($offers) || count($live))) return "round $r: unit open but promised";
        // give the unit back to an offline customer for the next round
        foreach ($live as $l) Tfm\Allot::endContract($ADM, (int) $l['id'], 'round over');
        foreach (Tfm\Db::all("SELECT id FROM allot_waitlist WHERE status IN ('waiting','offered') AND kind = 'store'") as $wr) Tfm\Allot::waitCancel($ADM, (int) $wr['id']);
        $un = unitRow($unit);
        if ($un['status'] !== 'open') return "round $r: after ending every contract and cancelling every waiting row the unit is '{$un['status']}' (stuck)";
        $cu = Tfm\Allot::saveCustomer($ADM, ['name' => '다음고객' . $r, 'phone' => '010-4501-' . str_pad((string) $r, 4, '0', STR_PAD_LEFT)]);
        Tfm\Allot::createContract($ADM, $unit, $cu['id'], []);
    }
    return true;
});

check('race — the offered account accepts twice × leaves × the admin cancels the row × the offer expires (tick) × a stranger applies: one story', function () use ($par, $ADM, $ROUNDS, $H) {
    for ($r = 0; $r < $ROUNDS; $r++) {
        $unit = 'A3-0002';
        $w = newUser();
        $j = Tfm\Allot::waitJoin($w, 'store', 'A3', form());
        $c = conOn($unit);
        Tfm\Allot::endContract($ADM, (int) $c['id'], 'attack');
        Tfm\Allot::offerNext($unit);
        Tfm\Allot::tick(null, 'cli');
        $row = Tfm\Db::one('SELECT * FROM allot_waitlist WHERE id = ?', [(int) $j['id']]);
        if (!$row || $row['status'] !== 'offered') return "round $r: set-up — the waiting account was not offered the freed unit (row " . json_encode($row) . ', unit ' . json_encode(unitRow($unit)['status']) . ')';
        $s = newUser();
        $wid = (int) $j['id'];
        $out = $par([
            child('$u = Tfm\\Users::byId(' . (int) $w['id'] . '); Tfm\\Allot::waitAccept($u, ' . $wid . '); echo "accepted";'),
            child('$u = Tfm\\Users::byId(' . (int) $w['id'] . '); Tfm\\Allot::waitAccept($u, ' . $wid . '); echo "accepted";'),
            child('$u = Tfm\\Users::byId(' . (int) $w['id'] . '); Tfm\\Allot::waitLeave($u, ' . $wid . '); echo "left";'),
            child('Tfm\\Allot::waitCancel($ADM, ' . $wid . '); echo "admincancel";'),
            child('Tfm\\Allot::tick(' . (Tfm\Clock::ms() + 50 * $H) . ', "cli"); echo "ticked";'),
            child('$u = Tfm\\Users::byId(' . (int) $s['id'] . '); Tfm\\Allot::apply($u, ' . var_export($unit, true) . ', ' . formPhp(80 + $r) . '); echo "applied";'),
        ]);
        if (strays($out, ['accepted', 'left', 'admincancel', 'ticked', 'applied', 'OFFER_GONE', 'NOT_FOUND', 'UNIT_TAKEN', 'NOT_LIVE', 'CONFLICT', 'ALREADY_WAITING', 'NOT_OPEN'])) return "round $r: unexpected output " . json_encode($out, JSON_UNESCAPED_UNICODE);
        if (inv() !== '') return "round $r: " . inv() . ' after ' . json_encode($out);
        $un = unitRow($unit);
        $row = Tfm\Db::one('SELECT * FROM allot_waitlist WHERE id = ?', [$wid]);
        $live = Tfm\Db::all("SELECT id, user_id, status FROM allot_contracts WHERE unit_id = ? AND status IN ('pending','active','overdue')", [(int) $un['id']]);
        $acc = count(array_filter($out, function ($x) { return $x === 'accepted'; }));
        if ($acc > 1) return "round $r: two accepts both succeeded — " . json_encode($out);
        if (count($live) > 1) return "round $r: two live contracts";
        $mine = array_values(array_filter($live, function ($l) use ($w) { return (int) $l['user_id'] === (int) $w['id']; }));
        if ($acc === 1 && (!$mine || $row['status'] !== 'converted')) {
            // the accept succeeded: the contract may have been closed afterwards by the tick 50 h in the future, but never handed to somebody else at the same time
            $any = Tfm\Db::one('SELECT id, status, end_reason FROM allot_contracts WHERE unit_id = ? AND user_id = ? ORDER BY id DESC LIMIT 1', [(int) $un['id'], (int) $w['id']]);
            if (!$any) return "round $r: 'accepted' but the account has no contract on the unit; row " . json_encode($row);
        }
        if ($acc === 0 && $mine) return "round $r: no accept succeeded but the waiting account holds a contract";
        if ($row['status'] === 'offered' && $live) return "round $r: still offered while a contract lives on the unit";
        foreach ($live as $l) Tfm\Allot::endContract($ADM, (int) $l['id'], 'round over');
        foreach (Tfm\Db::all("SELECT id FROM allot_waitlist WHERE status IN ('waiting','offered') AND kind = 'store'") as $wr) Tfm\Allot::waitCancel($ADM, (int) $wr['id']);
        if (unitRow($unit)['status'] !== 'open') return "round $r: the unit is stuck in '" . unitRow($unit)['status'] . "' after everything was closed";
        $cu = Tfm\Allot::saveCustomer($ADM, ['name' => '다시고객' . $r, 'phone' => '010-4502-' . str_pad((string) $r, 4, '0', STR_PAD_LEFT)]);
        Tfm\Allot::createContract($ADM, $unit, $cu['id'], []);
    }
    return true;
});

check('race — 8 processes record a payment with the SAME idempotency key: one payment, one period', function () use ($par, $offline, $fresh, $idem) {
    $c = $offline($fresh('A2'));
    $k = $idem();
    $before = (int) $c['paid_until'];
    $codes = [];
    for ($i = 0; $i < 8; $i++) $codes[] = child('Tfm\\Allot::recordPayment($ADM, ' . (int) $c['id'] . ', 10000, "bank", ' . var_export($k, true) . '); echo "ok";');
    $out = $par($codes);
    $n = (int) Tfm\Db::value("SELECT COUNT(*) FROM allot_payments WHERE contract_id = ? AND status = 'paid'", [(int) $c['id']]);
    $c2 = conById((int) $c['id']);
    if (strays($out, ['ok', 'DUPLICATE', 'CONFLICT', 'IDEM_REPLAY'])) return 'unexpected output ' . json_encode($out, JSON_UNESCAPED_UNICODE);
    $one = Tfm\Allot::addMonths($before > 0 ? $before : (int) $c['starts_at'], 1);
    return $n === 1 && (int) $c2['paid_total'] === 10000 && (int) $c2['paid_until'] === $one && inv() === '' ? true
        : json_encode(['payments' => $n, 'paid_total' => $c2['paid_total'], 'paid_until' => $c2['paid_until'], 'want' => $one, 'out' => array_count_values($out), 'inv' => inv()]);
});

check('race — 8 processes record 8 DIFFERENT payments on one contract: nothing is lost (total = 8 × price, 8 periods)', function () use ($par, $offline, $fresh) {
    $c = $offline($fresh('A2'));
    $codes = [];
    for ($i = 0; $i < 8; $i++) $codes[] = child('Tfm\\Allot::recordPayment($ADM, ' . (int) $c['id'] . ', 10000, "bank", "atk-diff-' . bin2hex(random_bytes(5)) . '-" . $I); echo "ok";');
    $out = $par($codes);
    $n = (int) Tfm\Db::value("SELECT COUNT(*) FROM allot_payments WHERE contract_id = ? AND status = 'paid'", [(int) $c['id']]);
    $c2 = conById((int) $c['id']);
    if (strays($out, ['ok'])) return 'unexpected output ' . json_encode($out, JSON_UNESCAPED_UNICODE);
    $want = Tfm\Allot::addMonths((int) $c['paid_until'] > 0 ? (int) $c['paid_until'] : (int) $c['starts_at'], 8);
    return $n === 8 && (int) $c2['paid_total'] === 80000 && (int) $c2['paid_until'] === $want && inv() === '' ? true
        : json_encode(['payments' => $n, 'paid_total' => $c2['paid_total'], 'paid_until' => $c2['paid_until'], 'want' => $want, 'inv' => inv()]);
});

check('race — two contracts move to the same free unit while a stranger applies for it: one winner, the losers keep their old units', function () use ($par, $offline, $fresh, $ROUNDS) {
    for ($r = 0; $r < $ROUNDS; $r++) {
        $ua = $fresh('A1'); $ub = $fresh('A1'); $target = $fresh('A1');
        $ca = $offline($ua); $cb = $offline($ub);
        $s = newUser();
        $out = $par([
            child('Tfm\\Allot::transfer($ADM, ' . (int) $ca['id'] . ', ' . var_export($target, true) . '); echo "movedA";'),
            child('Tfm\\Allot::transfer($ADM, ' . (int) $cb['id'] . ', ' . var_export($target, true) . '); echo "movedB";'),
            child('$u = Tfm\\Users::byId(' . (int) $s['id'] . '); Tfm\\Allot::apply($u, ' . var_export($target, true) . ', ' . formPhp(90 + $r) . '); echo "applied";'),
        ]);
        if (strays($out, ['movedA', 'movedB', 'applied', 'UNIT_TAKEN', 'CONFLICT', 'NOT_OPEN'])) return "round $r: unexpected output " . json_encode($out, JSON_UNESCAPED_UNICODE);
        if (inv() !== '') return "round $r: " . inv() . ' after ' . json_encode($out);
        $wins = count(array_filter($out, function ($x) { return in_array($x, ['movedA', 'movedB', 'applied'], true); }));
        $a2 = conById((int) $ca['id']); $b2 = conById((int) $cb['id']);
        $tu = unitRow($target);
        if ($wins !== 1) return "round $r: $wins winners — " . json_encode($out);
        foreach ([[$a2, $ua, 'movedA'], [$b2, $ub, 'movedB']] as $x) {
            $moved = in_array($x[2], $out, true);
            $on = (string) Tfm\Db::value('SELECT code FROM allot_units WHERE id = ?', [(int) $x[0]['unit_id']]);
            if ($moved && ($on !== $target || unitRow($x[1])['status'] !== 'open')) return "round $r: {$x[2]} but the contract is on $on and the old unit is " . unitRow($x[1])['status'];
            if (!$moved && ($on !== $x[1] || unitRow($x[1])['status'] !== 'leased')) return "round $r: the loser lost its unit ($on, " . unitRow($x[1])['status'] . ')';
        }
        if ($tu['status'] === 'open') return "round $r: the target is still open after a winner";
    }
    return true;
});

check('race — the admin closes / holds / re-opens a unit while 4 accounts apply for it: a closed or admin-held unit never carries a contract', function () use ($par, $fresh, $ROUNDS) {
    for ($r = 0; $r < $ROUNDS; $r++) {
        $unit = $fresh('A1');
        $uid = (int) unitRow($unit)['id'];
        $codes = [
            child('Tfm\\Allot::setUnitState($ADM, ' . $uid . ', "closed"); echo "closed";'),
            child('Tfm\\Allot::setUnitState($ADM, ' . $uid . ', "held", 24); echo "held";'),
        ];
        for ($i = 0; $i < 4; $i++) { $x = newUser(); $codes[] = child('$u = Tfm\\Users::byId(' . (int) $x['id'] . '); Tfm\\Allot::apply($u, ' . var_export($unit, true) . ', ' . formPhp(100 + $r) . '); echo "applied";'); }
        $out = $par($codes);
        if (strays($out, ['closed', 'held', 'applied', 'UNIT_TAKEN', 'UNIT_IN_USE', 'NOT_OPEN', 'CONFLICT'])) return "round $r: unexpected output " . json_encode($out, JSON_UNESCAPED_UNICODE);
        if (inv() !== '') return "round $r: " . inv() . ' after ' . json_encode($out);
        $applied = count(array_filter($out, function ($x) { return $x === 'applied'; }));
        $live = (int) Tfm\Db::value("SELECT COUNT(*) FROM allot_contracts WHERE unit_id = ? AND status IN ('pending','active','overdue')", [$uid]);
        if ($applied > 1 || $applied !== $live) return "round $r: $applied × applied, $live live — " . json_encode($out);
    }
    return true;
});

check('race — end × renew × payment × user cancel-request on one running contract: consistent, an ended contract never gains a term', function () use ($par, $offline, $fresh, $ROUNDS) {
    for ($r = 0; $r < $ROUNDS; $r++) {
        $unit = $fresh('A2');
        $c = $offline($unit);
        $id = (int) $c['id'];
        $out = $par([
            child('Tfm\\Allot::endContract($ADM, ' . $id . ', "attack"); echo "ended";'),
            child('Tfm\\Allot::renew($ADM, ' . $id . ', 1); echo "renewed";'),
            child('Tfm\\Allot::recordPayment($ADM, ' . $id . ', 10000, "cash", "atk-er-' . bin2hex(random_bytes(5)) . '"); echo "paid";'),
            child('Tfm\\Allot::recordPayment($ADM, ' . $id . ', 10000, "cash", "atk-er-' . bin2hex(random_bytes(5)) . '"); echo "paid";'),
            child('Tfm\\Allot::setAutoRenew($ADM, ' . $id . ', true); echo "auto";'),
        ]);
        if (strays($out, ['ended', 'renewed', 'paid', 'auto', 'NOT_LIVE', 'NOT_RENEWABLE', 'CONFLICT', 'NOT_FOUND', 'CONTRACT_CLOSED'])) return "round $r: unexpected output " . json_encode($out, JSON_UNESCAPED_UNICODE);
        if (inv() !== '') return "round $r: " . inv() . ' after ' . json_encode($out);
        $c2 = conById($id);
        if ($c2['status'] !== 'ended' || unitRow($unit)['status'] !== 'open') return "round $r: not ended (" . $c2['status'] . ', unit ' . unitRow($unit)['status'] . ') — ' . json_encode($out);
    }
    return true;
});

check('race — three processes grow one zone (seedUnits 300 / 300 / 250) at once: the seqs stay 1…n without holes, capacity = rows', function () use ($par, $ADM) {
    Tfm\Allot::saveZone($ADM, ['code' => 'A9', 'kind' => 'jar', 'name' => '자라는 구역', 'capacity' => 10, 'cols' => 10, 'price' => 1000, 'period' => 'year', 'termMonths' => 12, 'isOpen' => false]);
    $out = $par([
        child('echo "n" . Tfm\\Allot::seedUnits($ADM, "A9", 300);'),
        child('echo "n" . Tfm\\Allot::seedUnits($ADM, "A9", 300);'),
        child('echo "n" . Tfm\\Allot::seedUnits($ADM, "A9", 250);'),
    ]);
    $z = Tfm\Allot::zone('A9');
    $rows = Tfm\Db::all('SELECT seq, code FROM allot_units WHERE zone_id = ? ORDER BY seq', [(int) $z['id']]);
    $n = count($rows);
    $holes = 0;
    foreach ($rows as $i => $row) if ((int) $row['seq'] !== $i + 1 || $row['code'] !== sprintf('A9-%04d', $i + 1)) $holes++;
    if (strays($out, ['n*', 'CONFLICT', 'UNITS_IN_USE'])) return 'unexpected output ' . json_encode($out, JSON_UNESCAPED_UNICODE);
    return ($n === 300 || $n === 250) && $holes === 0 && (int) $z['capacity'] === $n ? true : json_encode(['rows' => $n, 'capacity' => $z['capacity'], 'holes' => $holes, 'out' => $out]);
});

check('race — 6 requests reach the lazy automation at the same instant: it runs once', function () use ($par, $ADM) {
    $before = (int) Tfm\Db::value("SELECT COUNT(*) FROM job_runs WHERE job = 'allot:tick'");
    $last = Tfm\Allot::lastTickAt();
    $at = max(Tfm\Clock::ms(), $last) + 16 * 60000;   // lazy_tick_minutes = 15 → due
    $codes = [];
    for ($i = 0; $i < 6; $i++) $codes[] = child('echo Tfm\\Allot::lazyTick(' . $at . ') ? "ran" : "no";');
    $out = $par($codes);
    $ran = count(array_filter($out, function ($x) { return $x === 'ran'; }));
    $after = (int) Tfm\Db::value("SELECT COUNT(*) FROM job_runs WHERE job = 'allot:tick'");
    if (strays($out, ['ran', 'no'])) return 'unexpected output ' . json_encode($out, JSON_UNESCAPED_UNICODE);
    return $ran === 1 && $after - $before === 1 ? true : json_encode(['ran' => $ran, 'new job rows' => $after - $before, 'out' => $out]);
});

// SECTION-MARK (the next sections are appended above this line)

echo PHP_EOL . "allot-attack: $passed passed, $failed failed" . ($skipped ? ", $skipped skipped" : '') . ' (' . Tfm\Db::driverSafe() . ')' . PHP_EOL;
exit($failed ? 1 : 0);
