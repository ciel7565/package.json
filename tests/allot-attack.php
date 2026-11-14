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

// =============================================================================================== 2 · state machines
/** units ↔ contracts ↔ waiting list as one text: two equal fingerprints = nothing was written */
function ledgerPrint(): string
{
    $out = '';
    foreach (['allot_units' => 'id, status, contract_id, hold_until, label, label_show', 'allot_contracts' => '*', 'allot_payments' => '*', 'allot_waitlist' => '*', 'allot_customers' => '*',
        'allot_notices' => 'id, contract_id, customer_id, user_id, kind, dedupe_key, title, body, status, send_at, sent_at, seen_at', 'allot_zones' => 'id, capacity, is_open, price, period, term_months'] as $t => $cols) {
        foreach (Tfm\Db::all('SELECT ' . $cols . ' FROM ' . $t . ' ORDER BY 1') as $r) $out .= $t . ':' . implode("\x1f", array_map('strval', array_values($r))) . "\n";
    }
    return $out;
}
check('state — decide: only pending → active | canceled; every other target and every second decision is refused and changes nothing', function () use ($ADM, $NOADM, $fresh) {
    $u = newUser();
    $unit = $fresh('A1');
    $a = Tfm\Allot::apply($u, $unit, form());
    $cid = (int) conRow($a['contractNo'])['id'];
    foreach (['pending', 'ended', 'overdue', 'leased', 'held', '', 'ACTIVE', ' active', 'active ', "active\0", '1', 'true'] as $st) {
        $code = apiCode(function () use ($ADM, $cid, $st) { Tfm\Allot::decide($ADM, $cid, $st, ''); });
        if (strpos($code, '400 ') !== 0) return "decide('" . addcslashes($st, "\0") . "') → '$code'";
    }
    if (conById($cid)['status'] !== 'pending') return 'a refused decision changed the status';
    if (apiCode(function () use ($NOADM, $cid) { Tfm\Allot::decide($NOADM, $cid, 'active', ''); }) !== '403 FORBIDDEN') return 'a non-admin decided';
    if (apiCode(function () use ($u, $cid) { Tfm\Allot::decide($u, $cid, 'active', ''); }) !== '403 FORBIDDEN') return 'the applicant approved the own application';
    foreach ([0, -1, 999999999, PHP_INT_MAX] as $id) if (strpos(apiCode(function () use ($ADM, $id) { Tfm\Allot::decide($ADM, $id, 'active', ''); }), '404 ') !== 0) return "decide(id $id) is not a 404";
    Tfm\Allot::decide($ADM, $cid, 'active', '');
    $p1 = ledgerPrint();
    foreach (['active', 'canceled'] as $st) if (strpos(apiCode(function () use ($ADM, $cid, $st) { Tfm\Allot::decide($ADM, $cid, $st, ''); }), '409 ') !== 0) return "second decide('$st') on an active contract is not a 409";
    if (ledgerPrint() !== $p1) return 'a refused second decision wrote something';
    // a rejected application never comes back
    $u2 = newUser();
    $unit2 = $fresh('A1');
    $b = Tfm\Allot::apply($u2, $unit2, form());
    $cid2 = (int) conRow($b['contractNo'])['id'];
    Tfm\Allot::decide($ADM, $cid2, 'canceled', '');
    $p2 = ledgerPrint();
    $back = apiCode(function () use ($ADM, $cid2) { Tfm\Allot::decide($ADM, $cid2, 'active', ''); });
    $row = conById($cid2);
    return strpos($back, '409 ') === 0 && ledgerPrint() === $p2 && $row['status'] === 'canceled' && $row['end_reason'] === 'rejected' && unitRow($unit2)['status'] === 'open' && inv() === '' ? true
        : json_encode([$back, $row['status'], $row['end_reason'], unitRow($unit2)['status'], inv()]);
});

check('state — closed contracts are final: renew, transfer, payment, nameplate, cancel, end, auto-renew on an ended / canceled contract are refused and write nothing', function () use ($ADM, $offline, $fresh, $idem) {
    $unit = $fresh('A2');
    $c = $offline($unit);
    $id = (int) $c['id'];
    Tfm\Allot::endContract($ADM, $id, 'attack');
    $u = newUser();
    $unit2 = $fresh('A1');
    $a = Tfm\Allot::apply($u, $unit2, form());
    Tfm\Allot::cancelByUser($u, $a['contractNo']);
    $id2 = (int) conRow($a['contractNo'])['id'];
    $free = $fresh('A2');
    $before = ledgerPrint();
    $calls = [
        'renew' => function () use ($ADM, $id) { Tfm\Allot::renew($ADM, $id, 1); },
        'transfer' => function () use ($ADM, $id, $free) { Tfm\Allot::transfer($ADM, $id, $free); },
        'recordPayment' => function () use ($ADM, $id, $idem) { Tfm\Allot::recordPayment($ADM, $id, 10000, 'bank', $idem()); },
        'endContract' => function () use ($ADM, $id) { Tfm\Allot::endContract($ADM, $id, 'again'); },
        'setAutoRenew' => function () use ($ADM, $id) { Tfm\Allot::setAutoRenew($ADM, $id, true); },
        'renew(canceled)' => function () use ($ADM, $id2) { Tfm\Allot::renew($ADM, $id2, 1); },
        'transfer(canceled)' => function () use ($ADM, $id2, $free) { Tfm\Allot::transfer($ADM, $id2, $free); },
        'recordPayment(canceled)' => function () use ($ADM, $id2, $idem) { Tfm\Allot::recordPayment($ADM, $id2, 10000, 'bank', $idem()); },
        'cancelByUser(canceled)' => function () use ($u, $a) { Tfm\Allot::cancelByUser($u, $a['contractNo']); },
        'setLabelByUser(canceled)' => function () use ($u, $a) { Tfm\Allot::setLabelByUser($u, $a['contractNo'], '다시', true); },
        'payPrepare(canceled)' => function () use ($u, $a) { Tfm\Allot::payPrepare($u, $a['contractNo']); },
    ];
    $bad = [];
    foreach ($calls as $name => $fn) {
        $code = apiCode($fn);
        if (!preg_match('/^(409|403|404) /', $code)) $bad[] = "$name → '$code'";
    }
    if ($bad) return implode('; ', $bad);
    if (ledgerPrint() !== $before) return 'a refused call on a closed contract wrote to the ledger';
    return unitRow($unit)['status'] === 'open' && unitRow($free)['status'] === 'open' && inv() === '' ? true : inv();
});

check('state — units: an admin cannot open / close / hold a unit that carries a contract; unknown states, hours and ids are refused', function () use ($ADM, $offline, $fresh) {
    $leased = $fresh('A1');
    $offline($leased);
    $u = newUser();
    $held = $fresh('A1');
    Tfm\Allot::apply($u, $held, form());
    $before = ledgerPrint();
    foreach ([$leased, $held] as $code) {
        $id = (int) unitRow($code)['id'];
        foreach (['open', 'closed', 'held'] as $st) {
            $r = apiCode(function () use ($ADM, $id, $st) { Tfm\Allot::setUnitState($ADM, $id, $st, 5); });
            if ($r !== '409 UNIT_IN_USE') return "setUnitState($code, $st) → '$r'";
        }
    }
    $free = (int) unitRow($fresh('A1'))['id'];
    foreach (['leased', 'pending', '', 'OPEN', 'open ', 'o'] as $st) if (strpos(apiCode(function () use ($ADM, $free, $st) { Tfm\Allot::setUnitState($ADM, $free, $st); }), '400 ') !== 0) return "state '$st' accepted";
    foreach ([-1, 100000000] as $h) if (strpos(apiCode(function () use ($ADM, $free, $h) { Tfm\Allot::setUnitState($ADM, $free, 'held', $h); }), '400 ') !== 0) return "hold hours $h accepted";
    foreach ([0, -5, 987654321] as $id) if (strpos(apiCode(function () use ($ADM, $id) { Tfm\Allot::setUnitState($ADM, $id, 'closed'); }), '404 ') !== 0) return "unit id $id is not a 404";
    return ledgerPrint() === $before && inv() === '' ? true : 'a refused unit change wrote something; ' . inv();
});

check('state — an admin hold without an end (0 hours) or with an end is never given away by the automation before its time, and is released after it', function () use ($ADM, $fresh, $H) {
    $code = $fresh('A1');
    $id = (int) unitRow($code)['id'];
    $now = Tfm\Clock::ms();
    $h = Tfm\Allot::setUnitState($ADM, $id, 'held', 24, $now);
    Tfm\Allot::tick($now + 23 * $H, 'cli');
    $mid = unitRow($code)['status'];
    $u = newUser();
    $taken = apiCode(function () use ($u, $code) { Tfm\Allot::apply($u, $code, form()); });
    Tfm\Allot::tick($now + 25 * $H, 'cli');
    $after = unitRow($code)['status'];
    $code2 = $fresh('A1');
    $id2 = (int) unitRow($code2)['id'];
    Tfm\Allot::setUnitState($ADM, $id2, 'held', 0, $now);
    Tfm\Allot::tick($now + 5000 * $H, 'cli');
    $forever = unitRow($code2)['status'];
    Tfm\Allot::setUnitState($ADM, $id2, 'open');
    return $h['status'] === 'held' && $mid === 'held' && strpos($taken, '409 ') === 0 && $after === 'open' && $forever === 'held' && inv() === '' ? true : json_encode([$mid, $taken, $after, $forever, inv()]);
});

check('state — zones: shrinking never removes a unit with history, a closed zone takes no application, kind and code never change, capacity is bounded', function () use ($ADM, $offline) {
    Tfm\Allot::saveZone($ADM, ['code' => 'A7', 'kind' => 'store', 'name' => '줄이는 구역', 'capacity' => 6, 'cols' => 3, 'price' => 5000, 'period' => 'once', 'termMonths' => 3, 'isOpen' => true]);
    $c = $offline('A7-0005');
    Tfm\Allot::endContract($ADM, (int) $c['id'], 'attack');   // A7-0005 now has history but is free
    $shrink = apiCode(function () use ($ADM) { Tfm\Allot::seedUnits($ADM, 'A7', 3); });
    $n = (int) Tfm\Db::value("SELECT COUNT(*) FROM allot_units WHERE code LIKE 'A7-%'");
    $orphans = (int) Tfm\Db::value('SELECT COUNT(*) FROM allot_contracts c LEFT JOIN allot_units u ON u.id = c.unit_id WHERE u.id IS NULL');
    if ($orphans !== 0) return "shrinking left $orphans contracts without a unit row";
    if ($shrink === '' && $n < 5) return "seedUnits(3) removed a unit that has a contract in its history ($n rows left)";
    foreach ([-1, 5001, PHP_INT_MAX] as $cap) if (strpos(apiCode(function () use ($ADM, $cap) { Tfm\Allot::seedUnits($ADM, 'A7', $cap); }), '400 ') !== 0) return "seedUnits($cap) accepted";
    $z = Tfm\Allot::zone('A7');
    Tfm\Allot::saveZone($ADM, ['id' => $z['id'], 'isOpen' => false]);
    $u = newUser();
    $closed = apiCode(function () use ($u) { Tfm\Allot::apply($u, 'A7-0001', form()); });
    $auto = apiCode(function () use ($u) { Tfm\Allot::apply($u, ['kind' => 'store', 'zone' => 'A7', 'auto' => true], form()); });
    $wait = apiCode(function () use ($u) { Tfm\Allot::waitJoin($u, 'store', 'A7', form()); });
    $z2 = Tfm\Allot::saveZone($ADM, ['id' => $z['id'], 'kind' => 'jar', 'code' => 'HACK']);
    return $closed === '409 NOT_OPEN' && preg_match('/^409 (NOT_OPEN|SOLD_OUT)$/', $auto) && strpos($wait, '409 ') === 0 && $z2['kind'] === 'store' && $z2['code'] === 'A7' && inv() === '' ? true
        : json_encode([$shrink, $n, $closed, $auto, $wait, $z2['kind'], $z2['code'], inv()]);
});

check('state — the per-account limit counts applications, running contracts and waiting rows together, and frees a slot when one closes', function () use ($ADM, $fresh) {
    $u = newUser();
    $max = (int) Tfm\Allot::conf('apply_per_user');
    $nos = [];
    for ($i = 0; $i < $max - 1; $i++) $nos[] = Tfm\Allot::apply($u, $fresh('A1'), form())['contractNo'];
    $w = Tfm\Allot::waitJoin($u, 'store', 'A3', form());   // A3 is full (set-up of the race checks)
    $over = '';
    $data = null;
    try { Tfm\Allot::apply($u, $fresh('A1'), form()); } catch (Tfm\ApiException $e) { $over = $e->status . ' ' . $e->errorCode; $data = $e->data; }
    $overWait = apiCode(function () use ($u) { Tfm\Allot::waitJoin($u, 'jar', 'A1', form()); });
    Tfm\Allot::waitLeave($u, (int) $w['id']);
    $again = apiCode(function () use ($u, $fresh) { Tfm\Allot::apply($u, $fresh('A1'), form()); });
    $m = Tfm\Allot::mine((int) $u['id']);
    return $over === '429 APPLY_LIMIT' && is_array($data) && $data['max'] === $max && $data['used'] === $max && strpos($overWait, '4') === 0 && $again === '' && $m['limit'] === ['max' => $max, 'used' => $max] ? true
        : json_encode([$over, $data, $overWait, $again, $m['limit']]);
});

check('state — waiting list: no joining while a unit is free, no accepting without an offer, a stranger\'s row is a 404, an expired offer cannot be accepted', function () use ($ADM, $H) {
    $u = newUser();
    $free = apiCode(function () use ($u) { Tfm\Allot::waitJoin($u, 'jar', 'A1', form()); });
    $noZone = apiCode(function () use ($u) { Tfm\Allot::waitJoin($u, 'jar', 'NOPE', form()); });
    $wrongKind = apiCode(function () use ($u) { Tfm\Allot::waitJoin($u, 'jar', 'A3', form()); });   // A3 is a store zone
    $badKind = apiCode(function () use ($u) { Tfm\Allot::waitJoin($u, 'pond', 'A3', form()); });
    $w = Tfm\Allot::waitJoin($u, 'store', 'A3', form());
    $wid = (int) $w['id'];
    $early = apiCode(function () use ($u, $wid) { Tfm\Allot::waitAccept($u, $wid); });
    $s = newUser();
    $idor = [apiCode(function () use ($s, $wid) { Tfm\Allot::waitAccept($s, $wid); }), apiCode(function () use ($s, $wid) { Tfm\Allot::waitLeave($s, $wid); }), apiCode(function () use ($s) { Tfm\Allot::waitLeave($s, 987654321); })];
    // free A3-0003 → the offer goes to $u; let it expire, then accept
    $c = conOn('A3-0003');
    $now = Tfm\Clock::ms();
    Tfm\Allot::endContract($ADM, (int) $c['id'], 'attack', $now);
    Tfm\Allot::tick($now + 1000, 'cli');
    $row = Tfm\Db::one('SELECT * FROM allot_waitlist WHERE id = ?', [$wid]);
    if ($row['status'] !== 'offered') return 'set-up: no offer — row ' . json_encode($row) . ', unit ' . unitRow('A3-0003')['status'];
    $offerUntil = (int) $row['offer_until'];
    $late = apiCode(function () use ($u, $wid, $offerUntil) { Tfm\Allot::waitAccept($u, $wid, $offerUntil + 1000); });
    Tfm\Allot::tick($offerUntil + 2000, 'cli');
    $row2 = Tfm\Db::one('SELECT * FROM allot_waitlist WHERE id = ?', [$wid]);
    $unit = unitRow('A3-0003');
    // nobody waits any more → the unit must be free again, and the offline customer of the set-up comes back
    $cu = Tfm\Allot::saveCustomer($ADM, ['name' => '돌아온고객', 'phone' => '010-4503-0001']);
    $back = apiCode(function () use ($ADM, $cu) { Tfm\Allot::createContract($ADM, 'A3-0003', $cu['id'], []); });
    return strpos($free, '409 ') === 0 && strpos($noZone, '404 ') === 0 && preg_match('/^(400|404|409) /', $wrongKind) && strpos($badKind, '400 ') === 0 && $early === '409 OFFER_GONE'
        && $idor === ['404 NOT_FOUND', '404 NOT_FOUND', '404 NOT_FOUND'] && $late === '409 OFFER_GONE' && $row2['status'] === 'expired' && $unit['status'] === 'open' && $back === '' && inv() === '' ? true
        : json_encode([$free, $noZone, $wrongKind, $badKind, $early, $idor, $late, $row2['status'], $unit['status'], $back, inv()]);
});

check('state — with allotment switched off nothing can be written by an app account (apply, waiting list, nameplate, cancel, pay) and nothing changes', function () use ($ADM, $fresh) {
    $u = newUser();
    $a = Tfm\Allot::apply($u, $fresh('A1'), form());
    Tfm\Allot::saveSettings($ADM, ['enabled' => false]);
    $before = ledgerPrint();
    $calls = [
        'apply' => function () use ($u, $fresh) { Tfm\Allot::guard(); Tfm\Allot::apply($u, $fresh('A1'), form()); },
        'guard' => function () { Tfm\Allot::guard(); },
    ];
    $bad = [];
    foreach ($calls as $n => $fn) { $c = apiCode($fn); if ($c !== '403 ALLOT_DISABLED') $bad[] = "$n → '$c'"; }
    $direct = apiCode(function () use ($u, $fresh) { Tfm\Allot::apply($u, $fresh('A1'), form()); });   // the library itself, without the endpoint's guard
    $same = ledgerPrint() === $before;
    Tfm\Allot::saveSettings($ADM, ['enabled' => true]);
    if ($bad) return implode('; ', $bad);
    return $direct === '403 ALLOT_DISABLED' && $same ? true : "Allot::apply() while disabled → '" . $direct . "'" . ($same ? '' : ' and the ledger changed');
});

// =============================================================================================== 3 · money
check('money — recordPayment refuses 0, negative, huge amounts, unknown methods, bad / empty / oversized keys, non-admins; nothing is written', function () use ($ADM, $NOADM, $offline, $fresh, $idem) {
    $c = $offline($fresh('A2'));
    $id = (int) $c['id'];
    $before = ledgerPrint();
    $bad = [];
    foreach ([0, -1, -10000, Tfm\Allot::MAX_AMOUNT + 1, PHP_INT_MAX, PHP_INT_MIN] as $amt) {
        $r = apiCode(function () use ($ADM, $id, $amt, $idem) { Tfm\Allot::recordPayment($ADM, $id, $amt, 'bank', $idem()); });
        if (strpos($r, '400 ') !== 0) $bad[] = "amount $amt → '$r'";
    }
    foreach (['bitcoin', '', 'BANK', 'toss ', "bank\n"] as $m) {
        $r = apiCode(function () use ($ADM, $id, $m, $idem) { Tfm\Allot::recordPayment($ADM, $id, 10000, $m, $idem()); });
        if (strpos($r, '400 ') !== 0) $bad[] = "method '" . trim($m) . "' → '$r'";
    }
    foreach (['', ' ', 'short', str_repeat('k', 200), "atk-key-\nline", "atk-key-\0nul", 'atk key with space', "atk-키-한글키입니다"] as $k) {
        $r = apiCode(function () use ($ADM, $id, $k) { Tfm\Allot::recordPayment($ADM, $id, 10000, 'bank', $k); });
        if (strpos($r, '400 ') !== 0) $bad[] = "idem '" . substr(addcslashes($k, "\0..\37"), 0, 24) . "' → '$r'";
    }
    $r = apiCode(function () use ($NOADM, $id, $idem) { Tfm\Allot::recordPayment($NOADM, $id, 10000, 'bank', $idem()); });
    if ($r !== '403 FORBIDDEN') $bad[] = "non-admin → '$r'";
    if ($bad) return implode('; ', $bad);
    return ledgerPrint() === $before ? true : 'a refused payment wrote to the ledger';
});

check('money — an idempotency key replayed with another amount or on another contract never counts twice and never reports a payment that was not made', function () use ($ADM, $offline, $fresh, $idem) {
    $c1 = $offline($fresh('A2'));
    $c2 = $offline($fresh('A2'));
    $k = $idem();
    $first = Tfm\Allot::recordPayment($ADM, (int) $c1['id'], 10000, 'bank', $k);
    $again = Tfm\Allot::recordPayment($ADM, (int) $c1['id'], 10000, 'bank', $k);
    $otherAmount = null;
    $oa = apiCode(function () use ($ADM, $c1, $k, &$otherAmount) { $otherAmount = Tfm\Allot::recordPayment($ADM, (int) $c1['id'], 30000, 'cash', $k); });
    $oc = apiCode(function () use ($ADM, $c2, $k) { Tfm\Allot::recordPayment($ADM, (int) $c2['id'], 10000, 'bank', $k); });
    $r1 = conById((int) $c1['id']);
    $r2 = conById((int) $c2['id']);
    if ((int) $r1['paid_total'] !== 10000 || (int) $r2['paid_total'] !== 0) return 'totals ' . $r1['paid_total'] . ' / ' . $r2['paid_total'];
    if ($first['duplicate'] !== false || $again['duplicate'] !== true) return 'duplicate flags ' . json_encode([$first['duplicate'], $again['duplicate']]);
    if (strpos($oc, '409 ') !== 0) return "the key of contract 1 on contract 2 → '$oc' (the admin must be told that nothing was recorded)";
    // the same key with another amount: either refused, or answered as a duplicate that shows the ORIGINAL amount
    if ($oa === '' && (!is_array($otherAmount) || $otherAmount['duplicate'] !== true || $otherAmount['payment']['amount'] !== 10000)) return 'another amount under a used key: ' . json_encode($otherAmount);
    return inv() === '' ? true : inv();
});

check('money — refunds: once per payment, never of a refund row, never by a non-admin; the contract total follows; a refund never makes money', function () use ($ADM, $NOADM, $offline, $fresh, $idem) {
    $c = $offline($fresh('A2'));
    $id = (int) $c['id'];
    $p1 = Tfm\Allot::recordPayment($ADM, $id, 10000, 'bank', $idem())['payment'];
    $p2 = Tfm\Allot::recordPayment($ADM, $id, 10000, 'bank', $idem())['payment'];
    $paidUntil2 = (int) conById($id)['paid_until'];
    if (apiCode(function () use ($NOADM, $p2) { Tfm\Allot::refund($NOADM, (int) $p2['id'], 'x'); }) !== '403 FORBIDDEN') return 'a non-admin refunded';
    Tfm\Allot::refund($ADM, (int) $p2['id'], '사유');
    $twice = apiCode(function () use ($ADM, $p2) { Tfm\Allot::refund($ADM, (int) $p2['id'], '사유'); });
    $refRow = (int) Tfm\Db::value("SELECT id FROM allot_payments WHERE contract_id = ? AND kind = 'refund' ORDER BY id DESC LIMIT 1", [$id]);
    $ofRefund = apiCode(function () use ($ADM, $refRow) { Tfm\Allot::refund($ADM, $refRow, '사유'); });
    $none = apiCode(function () use ($ADM) { Tfm\Allot::refund($ADM, 987654321, '사유'); });
    $r = conById($id);
    $refunds = Tfm\Db::all("SELECT amount FROM allot_payments WHERE contract_id = ? AND kind = 'refund'", [$id]);
    if (strpos($twice, '409 ') !== 0 || strpos($ofRefund, '409 ') !== 0 || strpos($none, '404 ') !== 0) return json_encode([$twice, $ofRefund, $none]);
    if ((int) $r['paid_total'] !== 10000 || count($refunds) !== 1 || (int) $refunds[0]['amount'] !== 10000) return 'after one refund: total ' . $r['paid_total'] . ', refund rows ' . json_encode($refunds);
    // the period that was paid back is no longer counted as paid
    if ((int) $r['paid_until'] >= $paidUntil2) return 'paid_until stays at ' . $r['paid_until'] . ' after the refund of the second month (was ' . $paidUntil2 . ')';
    return inv() === '' ? true : inv();
});

check('money — the price of a contract is fixed when it is made: a later zone price change, a hostile form field or a transfer does not change what is owed', function () use ($ADM, $fresh) {
    Tfm\Allot::saveSettings($ADM, ['toss_enabled' => true]);
    $u = newUser();
    $unit = $fresh('A1');
    $a = Tfm\Allot::apply($u, $unit, form(['price' => 1, 'amount' => 1, 'status' => 'active', 'userId' => 1, 'paidTotal' => 999999, 'period' => 'once', 'termMonths' => 1200]));
    $row = conRow($a['contractNo']);
    if ((int) $row['price'] !== 120000 || $row['status'] !== 'pending' || (int) $row['paid_total'] !== 0 || $row['period'] !== 'year' || (int) $row['user_id'] !== (int) $u['id']) return 'hostile form fields took effect: ' . json_encode($row);
    $z = Tfm\Allot::zone('A1');
    Tfm\Allot::saveZone($ADM, ['id' => $z['id'], 'price' => 5]);
    $p = Tfm\Allot::payPrepare($u, $a['contractNo']);
    Tfm\Allot::saveZone($ADM, ['id' => $z['id'], 'price' => 120000]);
    return $p['amount'] === 120000 && (int) conRow($a['contractNo'])['price'] === 120000 ? true : 'order amount ' . $p['amount'];
});

check('money — 토스: a tampered amount, a gateway that answers another amount / order / currency / state never credits the contract; the order cannot be reused to pay twice', function () use ($ADM, $fresh) {
    $bad = [];
    foreach (['client-1', 'client+1', 'client0', 'clientNeg', 'clientHuge', 'amount1_', 'amount119999_', 'noamount_', 'otherorder_', 'usd_', 'waiting_'] as $case) {
        $u = newUser();
        $a = Tfm\Allot::apply($u, $fresh('A1'), form());
        $p = Tfm\Allot::payPrepare($u, $a['contractNo']);
        $amt = $p['amount'];
        $key = 'mock_' . $p['orderId'];
        if ($case === 'client-1') $amt--; elseif ($case === 'client+1') $amt++; elseif ($case === 'client0') $amt = 0; elseif ($case === 'clientNeg') $amt = -$amt; elseif ($case === 'clientHuge') $amt = PHP_INT_MAX;
        else $key = 'mock_' . $case . $p['orderId'];
        $r = apiCode(function () use ($u, $key, $p, $amt) { Tfm\Allot::payConfirm($u, $key, $p['orderId'], $amt); });
        $row = conRow($a['contractNo']);
        $paid = (int) Tfm\Db::value("SELECT COUNT(*) FROM allot_payments WHERE contract_id = ? AND status = 'paid'", [(int) $row['id']]);
        if ($r === '' || (int) $row['paid_total'] !== 0 || $paid !== 0) { $bad[] = "$case → '$r', total {$row['paid_total']}, paid rows $paid"; continue; }
        if (strpos($r, 'ERR') === 0) { $bad[] = "$case → $r"; continue; }
        // afterwards the honest confirm either works exactly once or the order is dead — never two credits
        $ok1 = apiCode(function () use ($u, $p) { Tfm\Allot::payConfirm($u, 'mock_' . $p['orderId'], $p['orderId'], $p['amount']); });
        $ok2 = apiCode(function () use ($u, $p) { Tfm\Allot::payConfirm($u, 'mock_' . $p['orderId'], $p['orderId'], $p['amount']); });
        $row = conRow($a['contractNo']);
        if ((int) $row['paid_total'] > 120000 || ($ok1 === '' && $ok2 === '')) $bad[] = "$case then honest ×2 → '$ok1' / '$ok2', total {$row['paid_total']}";
    }
    if ($bad) return implode('; ', $bad);
    return inv() === '' ? true : inv();
});

check('money — 토스: another account cannot prepare or confirm a stranger\'s contract / order (404, same text as an unknown one), a subscription-style or malformed order id is a 404 / 400', function () use ($ADM, $fresh) {
    $u = newUser();
    $s = newUser();
    $a = Tfm\Allot::apply($u, $fresh('A1'), form());
    $p = Tfm\Allot::payPrepare($u, $a['contractNo']);
    $t1 = apiText(function () use ($s, $a) { Tfm\Allot::payPrepare($s, $a['contractNo']); });
    $t2 = apiText(function () use ($s) { Tfm\Allot::payPrepare($s, 'A26-ZZZZZ-ZZZZZ'); });
    $c1 = apiCode(function () use ($s, $a) { Tfm\Allot::payPrepare($s, $a['contractNo']); });
    $x1 = apiCode(function () use ($s, $p) { Tfm\Allot::payConfirm($s, 'mock_' . $p['orderId'], $p['orderId'], $p['amount']); });
    $x1t = apiText(function () use ($s, $p) { Tfm\Allot::payConfirm($s, 'mock_' . $p['orderId'], $p['orderId'], $p['amount']); });
    $x2t = apiText(function () use ($s, $p) { Tfm\Allot::payConfirm($s, 'mock_x', 'AL' . str_repeat('Z', 30), $p['amount']); });
    $weird = [];
    foreach (['', 'AL', 'ord_123', str_repeat('A', 65), "AL\0" . str_repeat('a', 29), 'al' . strtolower(substr($p['orderId'], 2)), $p['orderId'] . ' ', ' ' . $p['orderId'], $p['orderId'] . '%'] as $oid) {
        $r = apiCode(function () use ($u, $oid, $p) { Tfm\Allot::payConfirm($u, 'mock_' . $p['orderId'], $oid, $p['amount']); });
        if (!preg_match('/^(400|404) /', $r)) $weird[] = "'" . addcslashes(substr($oid, 0, 12), "\0") . "…' → '$r'";
    }
    $row = conRow($a['contractNo']);
    if ($weird) return 'order ids: ' . implode('; ', $weird);
    return $c1 === '404 NOT_FOUND' && $t1 === $t2 && $x1 === '404 ORDER_NOT_FOUND' && $x1t === $x2t && (int) $row['paid_total'] === 0
        && (string) Tfm\Db::value('SELECT status FROM allot_payments WHERE order_id = ?', [$p['orderId']]) === 'created' ? true : json_encode([$c1, $t1, $t2, $x1, $x1t, $x2t, $row['paid_total']], JSON_UNESCAPED_UNICODE);
});

check('money — 토스: money never stays on a closed contract — pay × cancel in every order ends with "paid and live" or "nothing paid / paid back"', function () use ($ADM, $fresh, $par, $ROUNDS, $H) {
    // (a) prepare → cancel → confirm
    $u = newUser();
    $a = Tfm\Allot::apply($u, $fresh('A1'), form());
    $p = Tfm\Allot::payPrepare($u, $a['contractNo']);
    Tfm\Allot::cancelByUser($u, $a['contractNo']);
    $late = apiCode(function () use ($u, $p) { Tfm\Allot::payConfirm($u, 'mock_' . $p['orderId'], $p['orderId'], $p['amount']); });
    $row = conRow($a['contractNo']);
    if ($late === '' || (int) $row['paid_total'] !== 0) return "(a) confirm after cancel → '$late', total {$row['paid_total']}";
    if ((string) Tfm\Db::value('SELECT status FROM allot_payments WHERE order_id = ?', [$p['orderId']]) === 'paid') return '(a) the order of a canceled contract is marked paid';
    // (b) the same at the same instant, several rounds: confirm (slow gateway) × user cancel × reject × hold expiry
    for ($r = 0; $r < $ROUNDS * 2; $r++) {
        $u = newUser();
        $t0 = Tfm\Clock::ms();
        $a = Tfm\Allot::apply($u, $fresh('A1'), form(), $t0);
        $p = Tfm\Allot::payPrepare($u, $a['contractNo']);
        $cid = (int) conRow($a['contractNo'])['id'];
        $out = $par([
            child('$u = Tfm\\Users::byId(' . (int) $u['id'] . '); Tfm\\Allot::payConfirm($u, ' . var_export('mock_slow' . (40 * ($r % 3)) . '_' . $p['orderId'], true) . ', ' . var_export($p['orderId'], true) . ', ' . (int) $p['amount'] . '); echo "paid";'),
            child('$u = Tfm\\Users::byId(' . (int) $u['id'] . '); usleep(' . (15000 * ($r % 4)) . '); Tfm\\Allot::cancelByUser($u, ' . var_export($a['contractNo'], true) . '); echo "canceled";'),
            child('usleep(' . (10000 * ($r % 3)) . '); Tfm\\Allot::decide($ADM, ' . $cid . ', "canceled", ""); echo "rejected";'),
            child('usleep(' . (8000 * ($r % 5)) . '); Tfm\\Allot::tick(' . ($t0 + 49 * $H) . ', "cli"); echo "ticked";'),
        ]);
        if (strays($out, ['paid', 'canceled', 'rejected', 'ticked', 'NOT_LIVE', 'NOT_PENDING', 'CONTRACT_CLOSED', 'ORDER_NOT_OPEN', 'NOT_FOUND', 'PAYMENT_PENDING', 'PAYMENT_FAILED', 'CONFLICT'])) return "(b) round $r: unexpected output " . json_encode($out, JSON_UNESCAPED_UNICODE);
        $row = conById($cid);
        $pay = Tfm\Db::one('SELECT status, toss_status FROM allot_payments WHERE order_id = ?', [$p['orderId']]);
        $live = in_array($row['status'], ['pending', 'active', 'overdue'], true);
        if (inv() !== '') return "(b) round $r: " . inv() . ' after ' . json_encode($out);
        if (!$live && ((int) $row['paid_total'] !== 0 || $pay['status'] === 'paid')) return "(b) round $r: contract {$row['status']} keeps money — total {$row['paid_total']}, payment {$pay['status']} — " . json_encode($out);
        if (in_array('paid', $out, true) && $live && (int) $row['paid_total'] !== 120000) return "(b) round $r: 'paid' but the live contract shows {$row['paid_total']}";
        if (in_array('paid', $out, true) && !$live && !in_array($pay['status'], ['refunded', 'canceled'], true)) return "(b) round $r: 'paid', the contract was closed, the payment is '{$pay['status']}' (not paid back)";
    }
    return true;
});

check('money — 토스: the network fails after the gateway took the money (timeout) → 503 PAYMENT_PENDING; the retry credits exactly once', function () use ($ADM, $fresh) {
    $u = newUser();
    $a = Tfm\Allot::apply($u, $fresh('A1'), form());
    $p = Tfm\Allot::payPrepare($u, $a['contractNo']);
    $key = 'mock_timeout_' . $p['orderId'];
    $first = apiCode(function () use ($u, $key, $p) { Tfm\Allot::payConfirm($u, $key, $p['orderId'], $p['amount']); });
    $mid = (int) conRow($a['contractNo'])['paid_total'];
    Tfm\Config::override('toss.confirm_retry_after', 0);
    try {
        $second = apiCode(function () use ($u, $key, $p) { Tfm\Allot::payConfirm($u, $key, $p['orderId'], $p['amount']); });
        $third = apiCode(function () use ($u, $key, $p) { Tfm\Allot::payConfirm($u, $key, $p['orderId'], $p['amount']); });
    } finally { Tfm\Config::override('toss.confirm_retry_after', null); }
    $row = conRow($a['contractNo']);
    return $first === '503 PAYMENT_PENDING' && $mid === 0 && $second === '' && strpos($third, '409 ') === 0 && (int) $row['paid_total'] === 120000 && inv() === '' ? true : json_encode([$first, $mid, $second, $third, $row['paid_total'], inv()]);
});

check('money — 토스: a one-time contract cannot be paid twice (second order / second confirm), a fully paid term has nothing due', function () use ($ADM, $offline) {
    Tfm\Allot::saveZone($ADM, ['code' => 'A6', 'kind' => 'store', 'name' => '한 번 내는 창고', 'capacity' => 8, 'cols' => 4, 'price' => 220000, 'period' => 'once', 'termMonths' => 12, 'isOpen' => true]);
    $u = newUser();
    $a = Tfm\Allot::apply($u, 'A6-0001', form());
    $p1 = Tfm\Allot::payPrepare($u, $a['contractNo']);
    $p2 = Tfm\Allot::payPrepare($u, $a['contractNo']);
    $r1 = apiCode(function () use ($u, $p1) { Tfm\Allot::payConfirm($u, 'mock_' . $p1['orderId'], $p1['orderId'], $p1['amount']); });
    $r2 = $p2['orderId'] === $p1['orderId'] ? 'same order' : apiCode(function () use ($u, $p2) { Tfm\Allot::payConfirm($u, 'mock_' . $p2['orderId'], $p2['orderId'], $p2['amount']); });
    $again = apiCode(function () use ($u, $a) { Tfm\Allot::payPrepare($u, $a['contractNo']); });
    Tfm\Allot::decide($ADM, (int) conRow($a['contractNo'])['id'], 'active', '');
    $after = apiCode(function () use ($u, $a) { Tfm\Allot::payPrepare($u, $a['contractNo']); });
    $row = conRow($a['contractNo']);
    return $r1 === '' && $r2 !== '' && $again === '409 NOTHING_DUE' && $after === '409 NOTHING_DUE' && (int) $row['paid_total'] === 220000 && (int) $row['paid_until'] === (int) $row['ends_at'] && inv() === '' ? true
        : json_encode([$r1, $r2, $again, $after, $row['paid_total'], $row['paid_until'], $row['ends_at'], inv()]);
});

check('money — the webhook can only take money away with the right payment key: DONE never credits, a forged CANCELED is ignored, a real one is refunded once', function () use ($ADM) {
    $u = newUser();
    $a = Tfm\Allot::apply($u, 'A6-0002', form());
    $p = Tfm\Allot::payPrepare($u, $a['contractNo']);
    $ev = function (string $k, string $o, string $st) { return ['eventType' => 'PAYMENT_STATUS_CHANGED', 'data' => ['paymentKey' => $k, 'orderId' => $o, 'status' => $st]]; };
    $done = Tfm\Allot::webhook($ev('mock_' . $p['orderId'], $p['orderId'], 'DONE'));
    $t0 = (int) conRow($a['contractNo'])['paid_total'];
    Tfm\Allot::payConfirm($u, 'mock_' . $p['orderId'], $p['orderId'], $p['amount']);
    $forged = Tfm\Allot::webhook($ev('mock_other', $p['orderId'], 'CANCELED'));
    $t1 = (int) conRow($a['contractNo'])['paid_total'];
    $junk = [];
    foreach ([[], ['eventType' => 'x'], ['data' => 'str'], ['data' => ['paymentKey' => ['a'], 'orderId' => ['b'], 'status' => ['c']]], ['data' => ['paymentKey' => 5, 'orderId' => 6, 'status' => 7]],
        ['eventType' => 'PAYMENT_STATUS_CHANGED', 'data' => ['paymentKey' => str_repeat('k', 5000), 'orderId' => $p['orderId'], 'status' => 'CANCELED']]] as $payload) {
        try { $r = Tfm\Allot::webhook($payload); if (empty($r['ignored'])) $junk[] = json_encode($payload); } catch (Throwable $e) { $junk[] = get_class($e) . ' ' . $e->getMessage(); }
    }
    $real = Tfm\Allot::webhook($ev('mock_' . $p['orderId'], $p['orderId'], 'CANCELED'));
    $dup = Tfm\Allot::webhook($ev('mock_' . $p['orderId'], $p['orderId'], 'CANCELED'));
    $t2 = (int) conRow($a['contractNo'])['paid_total'];
    $refunds = (int) Tfm\Db::value("SELECT COUNT(*) FROM allot_payments WHERE contract_id = ? AND kind = 'refund'", [(int) conRow($a['contractNo'])['id']]);
    if ($junk) return 'junk payloads: ' . implode('; ', array_map(function ($x) { return substr($x, 0, 120); }, $junk));
    return $done['ignored'] === true && $t0 === 0 && $forged['ignored'] === true && $t1 === 220000 && $real['ignored'] === false && $dup['ignored'] === true && $t2 === 0 && $refunds === 1 && inv() === '' ? true
        : json_encode([$done, $t0, $forged, $t1, $real, $dup, $t2, $refunds, inv()]);
});

check('money — 토스 secrets: the payment key is sealed in the table and no key, order secret or amount appears in a notice, an audit detail or a log line', function () use ($ADM, $tmp) {
    $u = newUser();
    $a = Tfm\Allot::apply($u, 'A6-0003', form());
    $p = Tfm\Allot::payPrepare($u, $a['contractNo']);
    $key = 'mock_SECRETKEY' . bin2hex(random_bytes(6)) . '_' . $p['orderId'];
    apiCode(function () use ($u, $key, $p) { Tfm\Allot::payConfirm($u, 'mock_' . $p['orderId'], $p['orderId'], $p['amount'] - 7); });
    Tfm\Allot::payConfirm($u, $key, $p['orderId'], $p['amount']);
    $stored = (string) Tfm\Db::value('SELECT payment_key_enc FROM allot_payments WHERE order_id = ?', [$p['orderId']]);
    $hay = '';
    foreach (['audit_log', 'security_events', 'allot_notices', 'job_runs'] as $t) foreach (Tfm\Db::all('SELECT * FROM ' . $t) as $r) $hay .= implode("\x1f", array_map('strval', array_values($r))) . "\n";
    $it = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($tmp, FilesystemIterator::SKIP_DOTS));
    foreach ($it as $f) if ($f->isFile() && !preg_match('/\.sqlite(-wal|-shm)?$/', $f->getFilename())) $hay .= (string) file_get_contents($f->getPathname());
    if (strpos($stored, 'enc:') !== 0 || strpos($stored, 'SECRETKEY') !== false) return 'the payment key is stored as ' . substr($stored, 0, 20);
    if (strpos($hay, 'SECRETKEY') !== false) return 'the payment key appears in audit / events / notices / logs';
    $inbox = json_encode(Tfm\Allot::inbox((int) $u['id']), JSON_UNESCAPED_UNICODE);
    if (preg_match('/220[,.]?000|원\b/u', $inbox)) return 'a notice names the amount: ' . mb_substr($inbox, 0, 300);
    return true;
});

check('money — months: month ends, leap days and the Seoul day line (Jan 31 + 1, + 2, Feb 29 + 12, 00:30 on the 1st, Dec 31 23:59:59.999)', function () {
    $ms = function (string $s): int { return (int) (new DateTimeImmutable($s, new DateTimeZone('Asia/Seoul')))->format('U') * 1000; };
    $cases = [
        ['2027-01-31 12:00:00', 1, '2027-02-28 12:00:00'], ['2027-01-31 12:00:00', 2, '2027-03-31 12:00:00'], ['2028-01-31 12:00:00', 1, '2028-02-29 12:00:00'], ['2028-02-29 12:00:00', 12, '2029-02-28 12:00:00'],
        ['2028-02-29 12:00:00', 48, '2032-02-29 12:00:00'], ['2027-03-01 00:30:00', 1, '2027-04-01 00:30:00'], ['2027-02-28 23:59:59', 1, '2027-03-28 23:59:59'], ['2027-12-31 23:59:59', 1, '2028-01-31 23:59:59'],
        ['2027-05-31 09:00:00', 9, '2028-02-29 09:00:00'], ['2027-10-31 00:00:00', 1, '2027-11-30 00:00:00'], ['2027-08-31 08:59:59', 6, '2028-02-29 08:59:59'], ['2027-03-31 09:00:00', 0, '2027-03-31 09:00:00'],
        ['2099-12-31 23:00:00', 2, '2100-02-28 23:00:00'],
    ];
    $bad = [];
    foreach ($cases as $c) {
        $got = Tfm\Allot::addMonths($ms($c[0]), $c[1]);
        if ($got !== $ms($c[2])) $bad[] = "{$c[0]} + {$c[1]} → " . (new DateTimeImmutable('@' . intdiv($got, 1000)))->setTimezone(new DateTimeZone('Asia/Seoul'))->format('Y-m-d H:i:s') . " (want {$c[2]})";
    }
    // milliseconds survive, and the result does not depend on the process time zone
    $x = $ms('2027-01-31 12:00:00') + 987;
    if (Tfm\Allot::addMonths($x, 1) !== $ms('2027-02-28 12:00:00') + 987) $bad[] = 'milliseconds are lost';
    // (the day line is the site's configured zone, app.timezone — Asia/Seoul by default; the checks above run in it)
    return $bad ? implode('; ', $bad) : true;
});

check('money — a monthly payer who starts on the 31st: twelve payments end exactly one year later (no creeping loss of days), each period joins the next without a gap', function () use ($ADM, $fresh, $idem) {
    $start = (int) (new DateTimeImmutable('2027-01-31 10:00:00', new DateTimeZone('Asia/Seoul')))->format('U') * 1000;
    $cu = Tfm\Allot::saveCustomer($ADM, ['name' => '말일고객', 'phone' => '010-4504-0001']);
    $unit = $fresh('A2');
    Tfm\Allot::createContract($ADM, $unit, $cu['id'], ['startsAt' => $start], $start);
    $id = (int) conOn($unit)['id'];
    $ends = [];
    for ($i = 0; $i < 12; $i++) { Tfm\Allot::recordPayment($ADM, $id, 10000, 'bank', $idem(), [], $start + $i * 1000); $ends[] = (int) conById($id)['paid_until']; }
    $rows = Tfm\Db::all("SELECT period_from, period_to FROM allot_payments WHERE contract_id = ? AND status = 'paid' ORDER BY id", [$id]);
    $gaps = 0;
    for ($i = 1; $i < count($rows); $i++) if ((int) $rows[$i]['period_from'] !== (int) $rows[$i - 1]['period_to']) $gaps++;
    $want = (int) (new DateTimeImmutable('2028-01-31 10:00:00', new DateTimeZone('Asia/Seoul')))->format('U') * 1000;
    $fmt = function (int $t): string { return (new DateTimeImmutable('@' . intdiv($t, 1000)))->setTimezone(new DateTimeZone('Asia/Seoul'))->format('m-d'); };
    echo '      paid-until after each of 12 monthly payments from 01-31: ' . implode(' ', array_map($fmt, $ends)) . PHP_EOL;
    return $gaps === 0 && $ends[11] === $want ? true : "after 12 payments paid-until is " . $fmt($ends[11]) . ' ' . date('Y', intdiv($ends[11], 1000)) . " (want 01-31 2028), gaps $gaps";
});

check('money — parseDate: real calendar days only (no Feb 30, month 13, year 0 / 9999, other orders), always midnight in Seoul', function () {
    $ms = function (string $s): int { return (int) (new DateTimeImmutable($s . ' 00:00:00', new DateTimeZone('Asia/Seoul')))->format('U') * 1000; };
    $bad = [];
    foreach (['2027-02-30', '2027-02-29', '2027-13-01', '2027-00-10', '2027-01-00', '2027-01-32', '10/03/2027', '03-10-2027', '', 'abc', '9999-12-31', '0000-00-00', '-2027-01-01', '2027-01-01; DROP', '１２３４-01-01', '2027-1e1-01', '2027-01-01-01', '99999999'] as $d) {
        $v = Tfm\Allot::parseDate($d);
        if ($v !== 0) $bad[] = "'$d' → " . date('Y-m-d', intdiv($v, 1000));
    }
    foreach (['2027-03-10' => '2027-03-10', '2028-02-29' => '2028-02-29', '2027.03.10' => '2027-03-10', ' 2027-03-10 ' => '2027-03-10'] as $in => $want) {
        if (Tfm\Allot::parseDate((string) $in) !== $ms($want)) $bad[] = "'$in' → " . Tfm\Allot::parseDate((string) $in);
    }
    return $bad ? implode('; ', $bad) : true;
});
Tfm\Allot::saveSettings($ADM, ['toss_enabled' => false]);

// =============================================================================================== 4 · personal data
$SECRET_NAME = '금강호랑이';
$SECRET_PHONE = '010-9876-5432';
$SECRET_ADDR = '강원도 정선군 비밀고갯길 77-3';
/** every form the secret person could leak in */
$needles = function () use ($SECRET_NAME, $SECRET_ADDR): array {
    return [$SECRET_NAME, mb_substr($SECRET_NAME, 1), '010-9876-5432', '01098765432', '9876-5432', '98765432', '010 9876 5432', '+821098765432', '비밀고갯길', '77-3'];
};
/** which needles appear in $text ('' = none) */
$leaks = function (string $text) use ($needles): string {
    $hit = [];
    foreach ($needles() as $n) if ($n !== '' && mb_strpos($text, $n) !== false) $hit[] = $n;
    return implode(', ', $hit);
};
/** all non-database files under the data directory (logs, caches, …) as one text */
$dataFiles = function () use ($tmp): string {
    $hay = '';
    $it = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($tmp, FilesystemIterator::SKIP_DOTS));
    foreach ($it as $f) if ($f->isFile() && !preg_match('/\.sqlite(-wal|-shm)?$/', $f->getFilename())) $hay .= $f->getPathname() . "\n" . (string) file_get_contents($f->getPathname()) . "\n";
    return $hay;
};
$PII_USER = newUser();
$PII_OTHER = newUser();
$PII = ['unit' => $fresh('A1'), 'no' => '', 'cid' => 0, 'cust' => 0];
check('pii — set-up: a person with a telling name, phone and address goes through the whole life of a contract (apply, approve, pay, nameplate, cancel request, waiting list, notices, errors)', function () use ($ADM, $PII_USER, $PII_OTHER, &$PII, $SECRET_NAME, $SECRET_PHONE, $SECRET_ADDR, $idem, $fresh) {
    Tfm\Allot::saveSettings($ADM, ['collect_address' => true]);
    $a = Tfm\Allot::apply($PII_USER, $PII['unit'], form(['name' => $SECRET_NAME, 'phone' => $SECRET_PHONE, 'addr' => $SECRET_ADDR, 'nameplate' => '호랑이네 장독', 'nameplateShow' => true, 'guardian' => true]));
    $PII['no'] = $a['contractNo'];
    $row = conRow($a['contractNo']);
    $PII['cid'] = (int) $row['id'];
    $PII['cust'] = (int) $row['customer_id'];
    Tfm\Allot::decide($ADM, $PII['cid'], 'active', '환영해요');
    Tfm\Allot::recordPayment($ADM, $PII['cid'], 120000, 'bank', $idem(), ['memo' => '입금자명 확인']);
    Tfm\Allot::setMemo($ADM, $PII['cid'], '전화로 확인함');
    Tfm\Allot::cancelByUser($PII_USER, $a['contractNo']);
    Tfm\Allot::waitJoin($PII_USER, 'store', 'A3', form(['name' => $SECRET_NAME, 'phone' => $SECRET_PHONE, 'addr' => $SECRET_ADDR, 'guardian' => true]));
    Tfm\Allot::notify($ADM, ['contract' => $PII['cid']], '안내', '곧 장 담그는 날이에요.');
    Tfm\Allot::addCare($ADM, ['unit' => $PII['unit']], 'check', '뚜껑을 살폈어요');
    // error paths that touch the person: a second application with the same phone from another account, bad forms next to the real data
    apiCode(function () use ($PII_OTHER, $SECRET_NAME, $SECRET_PHONE, $fresh) { Tfm\Allot::apply($PII_OTHER, $fresh('A1'), form(['name' => $SECRET_NAME, 'phone' => $SECRET_PHONE])); });
    apiCode(function () use ($PII_USER, $SECRET_NAME, $SECRET_PHONE, $PII) { Tfm\Allot::apply($PII_USER, $PII['unit'], form(['name' => $SECRET_NAME, 'phone' => $SECRET_PHONE])); });
    apiCode(function () use ($PII_USER, $SECRET_NAME, $SECRET_PHONE, $fresh) { Tfm\Allot::apply($PII_USER, $fresh('A1'), form(['name' => $SECRET_NAME, 'phone' => $SECRET_PHONE, 'consentVersion' => 'old'])); });
    apiCode(function () use ($PII_USER, $SECRET_NAME, $SECRET_PHONE, $SECRET_ADDR, $fresh) { Tfm\Allot::apply($PII_USER, $fresh('A1'), form(['name' => $SECRET_NAME, 'phone' => $SECRET_PHONE . '9', 'addr' => $SECRET_ADDR])); });
    Tfm\Allot::tick(null, 'cli');
    $c = Tfm\Db::one('SELECT * FROM allot_customers WHERE id = ?', [$PII['cust']]);
    return strpos((string) $c['name_enc'], 'enc:') === 0 && strpos((string) $c['phone_enc'], 'enc:') === 0 && strpos((string) $c['addr_enc'], 'enc:') === 0 && $c['phone_tail'] === '5432' && (int) $c['guardian'] === 1 ? true : json_encode($c);
});

check('pii — the database holds the name, phone and address only sealed: no table cell and no byte of the database file carries them', function () use ($leaks, $tmp, $IS_MYSQL) {
    $hit = [];
    $tables = $IS_MYSQL ? array_map(function ($r) { return array_values($r)[0]; }, Tfm\Db::all('SHOW TABLES')) : array_map(function ($r) { return $r['name']; }, Tfm\Db::all("SELECT name FROM sqlite_master WHERE type = 'table'"));
    foreach ($tables as $t) {
        if (!preg_match('/^[a-z0-9_]+$/', (string) $t)) continue;
        foreach (Tfm\Db::all('SELECT * FROM ' . $t) as $r) {
            $l = $leaks(implode("\x1f", array_map('strval', array_values($r))));
            if ($l !== '') { $hit[] = "$t: $l"; break; }
        }
    }
    if (!$IS_MYSQL) {
        // the bytes are read in ANOTHER process: closing a descriptor of the database file in this process would drop this
        // process's SQLite (POSIX) locks, and the next child that closes its connection would take the WAL away from us
        foreach (glob($tmp . '/*.sqlite*') ?: [] as $f) {
            $bytes = (string) shell_exec(escapeshellarg(PHP_BINARY) . ' -r ' . escapeshellarg('echo base64_encode((string) file_get_contents($argv[1]));') . ' ' . escapeshellarg($f));
            $l = $leaks((string) base64_decode($bytes));
            if ($l !== '') $hit[] = basename($f) . ' (file bytes): ' . $l;
        }
    }
    return $hit ? implode('; ', $hit) : true;
});

check('pii — nothing public or masked carries the person: map, summary, unit, logs, plans, lists, exports (default), admin summary, statistics, job history, automation result', function () use ($ADM, $PII, $PII_OTHER, $leaks) {
    $out = [
        'map' => Tfm\Allot::map(), 'summary' => Tfm\Allot::summary(), 'unitView guest' => Tfm\Allot::unitView($PII['unit'], 0), 'unitView stranger' => Tfm\Allot::unitView($PII['unit'], (int) $PII_OTHER['id']),
        'unit' => Tfm\Allot::unit($PII['unit']), 'careLogs' => Tfm\Allot::careLogs(['unit' => $PII['unit']]), 'plans' => Tfm\Allot::plans(), 'mine stranger' => Tfm\Allot::mine((int) $PII_OTHER['id']),
        'inbox stranger' => Tfm\Allot::inbox((int) $PII_OTHER['id']), 'listUnits' => Tfm\Allot::listUnits(['q' => $PII['unit']], 50, 0), 'listContracts' => Tfm\Allot::listContracts(['q' => $PII['no']], 50, 0),
        'contract' => Tfm\Allot::contract($PII['cid']), 'listCustomers' => Tfm\Allot::listCustomers([], 500, 0), 'customer' => Tfm\Allot::customer($PII['cust']), 'listWait' => Tfm\Allot::listWait([], 500, 0),
        'listNotices' => Tfm\Allot::listNotices([], 500, 0), 'listPayments' => Tfm\Allot::listPayments([], 500, 0), 'adminSummary' => Tfm\Allot::adminSummary(), 'stats' => Tfm\Allot::stats(30),
        'jobRuns' => Tfm\Allot::jobRuns(50), 'tick' => Tfm\Allot::tick(null, 'cli'), 'integrity' => Tfm\Allot::integrity(500, false),
    ];
    foreach (Tfm\Allot::EXPORTS as $w) {
        $after = 0;
        $rows = [];
        do { $page = Tfm\Allot::exportRows($w, $after, 500); $rows = array_merge($rows, $page['rows']); $after = (int) $page['next']; } while ($after > 0 && count($rows) < 5000);
        $out["export $w"] = $rows;
    }
    $hit = [];
    foreach ($out as $name => $v) { $l = $leaks((string) json_encode($v, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)); if ($l !== '') $hit[] = "$name: $l"; }
    // the owner's own screens show the unit and the nameplate, never the stored name / phone / address either (the app does not need them back)
    $own = json_encode([Tfm\Allot::mine((int) Tfm\Db::value('SELECT user_id FROM allot_contracts WHERE id = ?', [$PII['cid']])), Tfm\Allot::inbox((int) Tfm\Db::value('SELECT user_id FROM allot_contracts WHERE id = ?', [$PII['cid']]))], JSON_UNESCAPED_UNICODE);
    if ($leaks($own) !== '') $hit[] = 'mine / inbox of the owner: ' . $leaks($own);
    return $hit ? implode('; ', $hit) : true;
});

check('pii — audit rows, security events, notices, settings, job history and every file in the data directory (logs) are free of the name, phone and address', function () use ($leaks, $dataFiles) {
    $hit = [];
    foreach (['audit_log', 'security_events', 'allot_notices', 'settings', 'job_runs', 'allot_care_logs', 'allot_payments', 'allot_contracts', 'allot_waitlist', 'allot_units', 'cache_kv'] as $t) {
        foreach (Tfm\Db::all('SELECT * FROM ' . $t) as $r) { $l = $leaks(implode("\x1f", array_map('strval', array_values($r)))); if ($l !== '') { $hit[] = "$t: $l"; break; } }
    }
    $l = $leaks($dataFiles());
    if ($l !== '') $hit[] = 'files in the data directory: ' . $l;
    return $hit ? implode('; ', $hit) : true;
});

check('pii — error texts never repeat what was typed (name, phone, address) — for bad phones, names, addresses, versions and limits', function () use ($PII_OTHER, $SECRET_NAME, $SECRET_PHONE, $SECRET_ADDR, $leaks, $fresh) {
    $texts = '';
    $forms = [
        ['name' => $SECRET_NAME, 'phone' => $SECRET_PHONE . '99'], ['name' => $SECRET_NAME . str_repeat('가', 60), 'phone' => $SECRET_PHONE], ['name' => $SECRET_NAME, 'phone' => $SECRET_PHONE, 'addr' => $SECRET_ADDR . str_repeat('나', 300)],
        ['name' => $SECRET_NAME, 'phone' => $SECRET_PHONE, 'consentVersion' => 'x'], ['name' => $SECRET_NAME, 'phone' => $SECRET_PHONE, 'consent' => false], ['name' => $SECRET_NAME, 'phone' => $SECRET_PHONE, 'adult' => false],
        ['name' => $SECRET_NAME, 'phone' => $SECRET_PHONE, 'nameplate' => str_repeat('다', 80)], ['name' => "$SECRET_NAME\n$SECRET_PHONE", 'phone' => $SECRET_PHONE], ['name' => $SECRET_NAME, 'phone' => [$SECRET_PHONE]],
    ];
    foreach ($forms as $f) $texts .= apiText(function () use ($PII_OTHER, $f, $fresh) { Tfm\Allot::apply($PII_OTHER, $fresh('A1'), form($f)); }) . "\n";
    $texts .= apiText(function () use ($PII_OTHER, $SECRET_NAME, $SECRET_PHONE) { Tfm\Allot::waitJoin($PII_OTHER, 'store', 'A3', form(['name' => $SECRET_NAME, 'phone' => $SECRET_PHONE . 'x'])); });
    return $leaks($texts) === '' && strpos($texts, 'ERR ') === false ? true : mb_substr($leaks($texts) . ' | ' . $texts, 0, 400);
});

check('pii — revealing needs an admin and leaves an audit row with a LISTED reason (free text never reaches the audit detail), without the data; exports reveal only on the same terms', function () use ($ADM, $NOADM, $PII, $PII_USER, $SECRET_NAME, $SECRET_PHONE, $SECRET_ADDR, $leaks) {
    $id = $PII['cust'];
    $bad = [];
    foreach ([
        'no actor' => function () use ($id) { return Tfm\Allot::customer($id, true); },
        'no actor, reason' => function () use ($id) { return Tfm\Allot::customer($id, true, null, 'call'); },
        'non-admin' => function () use ($id, $NOADM) { return Tfm\Allot::customer($id, true, $NOADM, 'call'); },
        'the customer\'s own account' => function () use ($id, $PII_USER) { return Tfm\Allot::customer($id, true, $PII_USER, 'call'); },
        'export without an actor' => function () { return Tfm\Allot::exportRows('customers', 0, 50, true); },
        'export by a non-admin' => function () use ($NOADM) { return Tfm\Allot::exportRows('customers', 0, 50, true, $NOADM, 'call'); },
        'ledger export by the customer' => function () use ($PII_USER) { return Tfm\Allot::exportRows('ledger', 0, 50, true, $PII_USER, 'call'); },
    ] as $name => $fn) {
        $got = null;
        $code = apiCode(function () use ($fn, &$got) { $got = $fn(); });
        if ($code === '' && $leaks((string) json_encode($got, JSON_UNESCAPED_UNICODE)) !== '') $bad[] = "$name → revealed";
        elseif ($code !== '' && !preg_match('/^(400|403) /', $code)) $bad[] = "$name → '$code'";
    }
    if ($bad) return implode('; ', $bad);
    $n0 = (int) Tfm\Db::value('SELECT COUNT(*) FROM audit_log');
    $c = Tfm\Allot::customer($id, true, $ADM, 'call');
    $n1 = (int) Tfm\Db::value('SELECT COUNT(*) FROM audit_log');
    $x = Tfm\Allot::exportRows('customers', 0, 500, true, $ADM, 'report');
    $n2 = (int) Tfm\Db::value('SELECT COUNT(*) FROM audit_log');
    // a reason that is not on the list (or a free text with personal data in it) is recorded as a listed key, never verbatim
    Tfm\Allot::customer($id, true, $ADM, 'curious <b>' . $SECRET_PHONE . '</b>');
    Tfm\Allot::exportRows('ledger', 0, 5, true, $ADM, $SECRET_NAME . ' 찾기');
    Tfm\Allot::customer($id, true, $ADM, '');
    $json = json_encode($c, JSON_UNESCAPED_UNICODE);
    $rows = Tfm\Db::all('SELECT event, detail, severity FROM audit_log ORDER BY id DESC LIMIT 5');
    $auditText = implode("\n", array_map(function ($r) { return implode('|', array_map('strval', $r)); }, $rows));
    if (mb_strpos($json, $SECRET_NAME) === false || strpos($json, '9876') === false || mb_strpos($json, '비밀고갯길') === false) return 'the reveal does not show the person: ' . $json;
    if ($n1 - $n0 < 1 || $n2 - $n1 < 1) return 'no audit row for a reveal (' . ($n1 - $n0) . ') / a revealed export (' . ($n2 - $n1) . ')';
    if (mb_strpos(json_encode($x, JSON_UNESCAPED_UNICODE), $SECRET_NAME) === false) return 'the revealed export does not contain the person';
    foreach (array_slice($rows, 0, 3) as $r) {
        $d = json_decode((string) $r['detail'], true);
        if (!is_array($d) || !isset($d['why']) || !array_key_exists($d['why'], Tfm\Allot::REVEAL_REASONS)) return 'an audit row of a reveal carries the reason ' . json_encode($d['why'] ?? null, JSON_UNESCAPED_UNICODE);
    }
    if (strpos($auditText, 'curious') !== false) return 'the free-text reason reached the audit detail';
    return $leaks($auditText) === '' ? true : 'the audit rows of the reveal carry: ' . $leaks($auditText);
});

check('pii — nameplates: a phone number in any dress (spaces, dots, full-width, zero-width, Korean digit words), an e-mail or a bad word never reaches the public unit view; ≤ 12 characters, one line, no control or direction characters', function () use ($ADM, $PII, $PII_USER) {
    $bad = [];
    $view = function () use ($PII): string { return (string) (Tfm\Allot::unitView($PII['unit'], 0)['nameplate'] ?? ''); };
    foreach (['010-9876-5432', '01098765432', '010 9876 5432', '010.9876.5432', '０１０－９８７６－５４３２', "010-9876-\u{200B}5432", "0\u{200D}1\u{200D}0\u{200D}9\u{200D}8\u{200D}7\u{200D}6\u{200D}5\u{200D}4\u{200D}3\u{200D}2",
        '공일공구팔칠육오사삼이', '☎9876-5432', '9876-5432', 'tel:01098765432', 'a@b.kr 연락', '카톡 tiger77'] as $in) {
        $code = apiCode(function () use ($PII_USER, $PII, $in) { Tfm\Allot::setLabelByUser($PII_USER, $PII['no'], $in, true); });
        $got = $view();
        $folded = class_exists('Normalizer') ? (string) Normalizer::normalize($got, Normalizer::FORM_KC) : $got;
        $digits = preg_match_all('/\d/u', $folded);
        $words = preg_match_all('/[공영일이삼사오육칠팔구]/u', $got);
        if ($code !== '' && strpos($code, '400 ') !== 0) $bad[] = "'$in' → '$code'";
        elseif ($digits >= 7 || ($in === '공일공구팔칠육오사삼이' && $words >= 7) || strpos($got, '@') !== false) $bad[] = "'$in' is shown as '$got'";
    }
    foreach (["줄\n바꿈", "탭\t문자", "널\0문자", "뒤집\u{202E}기", "띄\u{2028}움", "<b>굵게</b>", "'; DROP--", '&lt;script&gt;'] as $in) {
        apiCode(function () use ($PII_USER, $PII, $in) { Tfm\Allot::setLabelByUser($PII_USER, $PII['no'], $in, true); });
        $got = $view();
        if (preg_match('/[\x00-\x1F\x7F]|\x{202A}|\x{202B}|\x{202C}|\x{202D}|\x{202E}|\x{2028}|\x{2029}|\x{2066}|\x{2067}|\x{2068}|\x{2069}|\x{200B}|\x{200D}/u', $got)) $bad[] = "control / direction characters survive in '" . addcslashes($in, "\0..\37") . "' → " . bin2hex($got);
        if (mb_strlen($got) > 12) $bad[] = "'" . addcslashes($in, "\0..\37") . "' is " . mb_strlen($got) . ' characters';
    }
    apiCode(function () use ($PII_USER, $PII) { Tfm\Allot::setLabelByUser($PII_USER, $PII['no'], str_repeat('가', 40), true); });
    if (mb_strlen($view()) > 12) $bad[] = '40 characters are shown as ' . mb_strlen($view());
    $long = apiCode(function () use ($PII_USER, $PII) { Tfm\Allot::setLabelByUser($PII_USER, $PII['no'], str_repeat('가', 41), true); });
    if (strpos($long, '400 ') !== 0) $bad[] = "41 characters → '$long'";
    $zalgo = 'a' . str_repeat("\u{0301}", 300);
    $z = apiCode(function () use ($PII_USER, $PII, $zalgo) { Tfm\Allot::setLabelByUser($PII_USER, $PII['no'], $zalgo, true); });
    if ($z === '' && mb_strlen($view()) > 12) $bad[] = 'a letter with 300 combining marks is shown with ' . mb_strlen($view()) . ' code points';
    $words = (array) Tfm\Config::get('chat.bad_words', []);
    if ($words) {
        $w = (string) $words[0];
        apiCode(function () use ($PII_USER, $PII, $w) { Tfm\Allot::setLabelByUser($PII_USER, $PII['no'], $w . '항아리', true); });
        if (mb_strpos($view(), $w) !== false) $bad[] = 'a word of the bad-word list is shown on the nameplate';
    }
    // hidden means hidden; the admin's setLabel follows the same cleaning
    Tfm\Allot::setLabelByUser($PII_USER, $PII['no'], '우리집', false);
    if (Tfm\Allot::unitView($PII['unit'], 0)['nameplate'] !== null) $bad[] = 'a hidden nameplate is shown: ' . json_encode(Tfm\Allot::unitView($PII['unit'], 0)['nameplate'], JSON_UNESCAPED_UNICODE);
    Tfm\Allot::setLabel($ADM, (int) unitRow($PII['unit'])['id'], '문의 010-9876-5432', true);
    $adminView = $view();
    if (preg_match_all('/\d/', $adminView) >= 7) $bad[] = "the admin's nameplate with a phone number is shown as '$adminView'";
    Tfm\Allot::setLabelByUser($PII_USER, $PII['no'], '호랑이네 장독', true);
    return $bad ? implode('; ', $bad) : true;
});

check('pii — care logs are public text: a phone number or bad word typed by the operator is masked, hidden logs stay hidden, the text is one bounded line', function () use ($ADM, $PII) {
    $l = Tfm\Allot::addCare($ADM, ['unit' => $PII['unit']], 'notice', '주인께 전화 010-9876-5432 드렸어요');
    $hidden = Tfm\Allot::addCare($ADM, ['unit' => $PII['unit']], 'check', '안 보이는 기록 XHIDDENX', false);
    $pub = json_encode(Tfm\Allot::careLogs(['unit' => $PII['unit']], 20, 0, false), JSON_UNESCAPED_UNICODE);
    $view = json_encode(Tfm\Allot::unitView($PII['unit'], 0), JSON_UNESCAPED_UNICODE);
    $long = apiCode(function () use ($ADM, $PII) { Tfm\Allot::addCare($ADM, ['unit' => $PII['unit']], 'check', str_repeat('긴', 5000)); });
    $badKind = apiCode(function () use ($ADM, $PII) { Tfm\Allot::addCare($ADM, ['unit' => $PII['unit']], 'gossip', 'x'); });
    $none = apiCode(function () use ($ADM) { Tfm\Allot::addCare($ADM, ['unit' => 'ZZ-0001'], 'check', 'x'); });
    $both = apiCode(function () use ($ADM, $PII) { Tfm\Allot::addCare($ADM, [], 'check', 'x'); });
    if (strpos($pub, '9876-5432') !== false || strpos($view, '9876-5432') !== false || strpos($pub, '98765432') !== false) return 'a phone number typed into a care log is public: ' . mb_substr($pub, 0, 200);
    if (strpos($pub, 'XHIDDENX') !== false || strpos($view, 'XHIDDENX') !== false) return 'a hidden log is public';
    return strpos($long, '400 ') === 0 && strpos($badKind, '400 ') === 0 && preg_match('/^(400|404) /', $none) && preg_match('/^(400|404) /', $both) ? true : json_encode([$long, $badKind, $none, $both]);
});

// =============================================================================================== 5 · other people's things (IDOR), guessing numbers
check('idor — a stranger gets the same 404 for another account\'s contract as for a made-up number: cancel, nameplate, pay; nothing changes', function () use ($PII, $PII_OTHER, $ADM) {
    Tfm\Allot::saveSettings($ADM, ['toss_enabled' => true]);
    $before = ledgerPrint();
    $fake = 'A26-AAAAA-AAAAA';
    $bad = [];
    foreach ([
        'cancel' => function (string $no) use ($PII_OTHER) { Tfm\Allot::cancelByUser($PII_OTHER, $no); },
        'nameplate' => function (string $no) use ($PII_OTHER) { Tfm\Allot::setLabelByUser($PII_OTHER, $no, '내꺼', true); },
        'payPrepare' => function (string $no) use ($PII_OTHER) { Tfm\Allot::payPrepare($PII_OTHER, $no); },
    ] as $name => $fn) {
        $real = apiCode(function () use ($fn, $PII) { $fn($PII['no']); }) . ' ' . apiText(function () use ($fn, $PII) { $fn($PII['no']); });
        $made = apiCode(function () use ($fn, $fake) { $fn($fake); }) . ' ' . apiText(function () use ($fn, $fake) { $fn($fake); });
        if ($real !== $made || strpos($real, '404 ') !== 0) $bad[] = "$name: real '$real' / made-up '$made'";
        foreach ([strtolower($PII['no']), $PII['no'] . ' ', ' ' . $PII['no'], $PII['no'] . '%', substr($PII['no'], 0, -1) . '_', '%', '', str_repeat('A', 500)] as $v) {
            $r = apiCode(function () use ($fn, $v) { $fn($v); });
            if (!preg_match('/^(400|404) /', $r)) $bad[] = "$name('" . substr($v, 0, 20) . "') → '$r'";
        }
    }
    Tfm\Allot::saveSettings($ADM, ['toss_enabled' => false]);
    if ($bad) return implode('; ', $bad);
    return ledgerPrint() === $before ? true : 'a stranger\'s refused call changed the ledger';
});

check('idor — inbox and "seen": an account reads and marks only its own notices (ids of others, negative, huge, duplicated, nested are ignored)', function () use ($PII, $PII_USER, $PII_OTHER) {
    $mineIds = array_map(function ($n) { return $n['id']; }, Tfm\Allot::inbox((int) $PII_USER['id'])['notices']);
    if (!$mineIds) return 'set-up: the owner has no notices';
    $otherBox = Tfm\Allot::inbox((int) $PII_OTHER['id']);
    foreach ($otherBox['notices'] as $n) if (in_array($n['id'], $mineIds, true)) return 'a stranger\'s inbox lists the notice ' . $n['id'];
    $unseen0 = (int) Tfm\Db::value("SELECT COUNT(*) FROM allot_notices WHERE user_id = ? AND seen_at = 0", [(int) $PII_USER['id']]);
    $n = Tfm\Allot::markSeen((int) $PII_OTHER['id'], $mineIds);
    $junk = 0;
    foreach ([[-1, 0, PHP_INT_MAX], array_fill(0, 50, $mineIds[0]), [], ['1 OR 1=1'], [[1, 2]], [1.5, '2', true, null]] as $ids) {
        try { $junk += Tfm\Allot::markSeen((int) $PII_OTHER['id'], $ids); } catch (Tfm\ApiException $e) { /* a refusal is fine */ } catch (TypeError $e) { /* typed away is fine */ }
    }
    $unseen1 = (int) Tfm\Db::value("SELECT COUNT(*) FROM allot_notices WHERE user_id = ? AND seen_at = 0", [(int) $PII_USER['id']]);
    $guest = Tfm\Allot::inbox(0);
    $neg = Tfm\Allot::inbox(-5);
    return $n === 0 && $junk === 0 && $unseen1 === $unseen0 && $guest['notices'] === [] && $neg['notices'] === [] ? true : json_encode([$n, $junk, $unseen0, $unseen1, count($guest['notices'])]);
});

check('idor — notices without an account (offline customers) are never served to account 0 / NULL, and "mine" of account 0 is empty', function () use ($ADM, $offline, $fresh) {
    $c = $offline($fresh('A1'));
    Tfm\Allot::notify($ADM, ['contract' => (int) $c['id']], '오프라인 고객 안내', '창구에서 알려 드려요 OFFLINEONLY');
    $box = json_encode([Tfm\Allot::inbox(0), Tfm\Allot::mine(0), Tfm\Allot::unread(0)], JSON_UNESCAPED_UNICODE);
    return strpos($box, 'OFFLINEONLY') === false && Tfm\Allot::mine(0)['contracts'] === [] ? true : mb_substr($box, 0, 300);
});

check('idor — contract numbers cannot be guessed: 400 fresh numbers are unique, 10 random characters from a wide alphabet, no counter, no time order', function () {
    $nos = [];
    $now = Tfm\Clock::ms();
    for ($i = 0; $i < 400; $i++) $nos[] = Tfm\Allot::newContractNo($now + $i);
    if (count(array_unique($nos)) !== 400) return 'duplicates';
    $alpha = [];
    $sortedLikeTime = 0;
    foreach ($nos as $i => $n) {
        if (!preg_match('/^A\d\d-([0-9A-Z]{5})-([0-9A-Z]{5})$/', $n, $m)) return "format: $n";
        foreach (str_split($m[1] . $m[2]) as $ch) $alpha[$ch] = true;
        if ($i > 0 && strcmp($nos[$i - 1], $n) < 0) $sortedLikeTime++;
    }
    // per position, the characters must be spread (a counter or a timestamp shows as a constant column)
    $constant = 0;
    for ($pos = 4; $pos < 15; $pos++) {
        if ($pos === 9) continue;
        $col = [];
        foreach ($nos as $n) $col[$n[$pos]] = true;
        if (count($col) < 12) $constant++;
    }
    return count($alpha) >= 24 && $constant === 0 && $sortedLikeTime > 120 && $sortedLikeTime < 280 ? true : json_encode(['alphabet' => count($alpha), 'narrow columns' => $constant, 'ascending pairs' => $sortedLikeTime]);
});

check('idor — the public unit view tells a guest nothing about the holder: no contract number, account, customer id, dates or payment state; "mine" only for the holder of the LIVE contract', function () use ($ADM, $PII, $PII_USER, $PII_OTHER, $offline, $fresh) {
    $g = Tfm\Allot::unitView($PII['unit'], 0);
    $allowed = ['code', 'kind', 'zone', 'seq', 'status', 'canApply', 'nameplate', 'logs', 'mine'];
    $extra = array_diff(array_keys($g), $allowed);
    if ($extra) return 'extra fields: ' . implode(', ', $extra);
    if (Tfm\Allot::unitView($PII['unit'], (int) $PII_USER['id'])['mine'] !== true || Tfm\Allot::unitView($PII['unit'], (int) $PII_OTHER['id'])['mine'] !== false || $g['mine'] !== false) return 'mine flags';
    // a former holder is no longer "mine"; the old nameplate does not stay on the freed unit
    $u = newUser();
    $unit = $fresh('A1');
    $a = Tfm\Allot::apply($u, $unit, form(['nameplate' => '옛주인표', 'nameplateShow' => true]));
    Tfm\Allot::cancelByUser($u, $a['contractNo']);
    $v = Tfm\Allot::unitView($unit, (int) $u['id']);
    $bad = [];
    if ($v['mine'] !== false) $bad[] = 'the former applicant still sees "mine"';
    if ($v['nameplate'] !== null) $bad[] = 'the old nameplate stays on the free unit: ' . json_encode($v['nameplate'], JSON_UNESCAPED_UNICODE);
    $c = $offline($fresh('A1'));
    Tfm\Allot::setLabel($ADM, (int) $c['unit_id'], '떠난사람표', true);
    Tfm\Allot::endContract($ADM, (int) $c['id'], 'attack');
    $code = (string) Tfm\Db::value('SELECT code FROM allot_units WHERE id = ?', [(int) $c['unit_id']]);
    $v2 = Tfm\Allot::unitView($code, 0);
    if ($v2['nameplate'] !== null) $bad[] = 'the nameplate of an ended contract stays on the unit for the next holder: ' . json_encode($v2['nameplate'], JSON_UNESCAPED_UNICODE);
    foreach (['', ' ', 'ZZ-0001', "A1-0001' OR '1'='1", 'A1-0001%', str_repeat('A', 300), "A1-\0001"] as $bogus) {
        $r = apiCode(function () use ($bogus) { Tfm\Allot::unitView($bogus, 0); });
        if (!preg_match('/^(400|404) /', $r)) $bad[] = "unitView('" . addcslashes(substr($bogus, 0, 16), "\0") . "') → '$r'";
    }
    return $bad ? implode('; ', $bad) : true;
});

// =============================================================================================== 6 · validation: types, sizes, Unicode
check('input — apply: every malformed name / phone / consent / address / nameplate is a clean 400 (never an error of another kind) and writes nothing; what is accepted is stored clean', function () use ($ADM, $fresh) {
    $u = newUser();
    $before = ledgerPrint();
    $bad = [];
    $try = function (string $what, array $over) use ($u, $fresh, &$bad) {
        $f = form($over);
        foreach ($over as $k => $v) if ($v === '__UNSET__') unset($f[$k]);
        $r = apiCode(function () use ($u, $fresh, $f) { Tfm\Allot::apply($u, $fresh('A1'), $f); });
        if (strpos($r, '400 ') !== 0) $bad[] = "$what → '" . mb_substr($r, 0, 90) . "'";
    };
    foreach (['empty' => '', 'spaces' => '   ', '41 characters' => str_repeat('가', 41), 'digits only' => '12345', 'symbols only' => '!!!', 'array' => ['홍길동'], 'int' => 12345, 'null' => null,
        'bool' => true, 'float' => 1.5, 'zero-width only' => "\u{200B}\u{200B}", '1 MB' => str_repeat('가', 350000), 'invalid UTF-8' => "홍\xFF\xFE길동"] as $w => $v) $try("name $w", ['name' => $v]);
    foreach (['empty' => '', 'short' => '010-123', 'one digit long' => '010-1234-56789', 'letters' => '010-abcd-efgh', 'sql' => "010-1234-5678' OR 1=1", 'array' => ['010-1234-5678'], 'null' => null,
        'bool' => true, 'service number' => '1588-1234', 'float' => 1012345678.5, '100 digits' => str_repeat('1', 100), 'two numbers' => '010-1234-5678,010-8765-4321'] as $w => $v) $try("phone $w", ['phone' => $v]);
    foreach (['string true' => 'true', 'one' => 1, 'yes' => 'yes', 'false' => false, 'null' => null, 'array' => [true], 'missing' => '__UNSET__'] as $w => $v) { $try("consent $w", ['consent' => $v]); $try("adult $w", ['adult' => $v]); }
    foreach (['old' => '2020-01', 'empty' => '', 'array' => ['x'], 'int' => 202611, 'missing' => '__UNSET__', 'long' => str_repeat('v', 500)] as $w => $v) $try("consentVersion $w", ['consentVersion' => $v]);
    foreach (['201 characters' => str_repeat('주', 201), 'array' => ['서울'], 'int' => 5] as $w => $v) $try("addr $w", ['addr' => $v]);
    foreach (['41 characters' => str_repeat('표', 41), 'array' => ['표'], 'int' => 7, 'bool' => true] as $w => $v) $try("nameplate $w", ['nameplate' => $v]);
    if ($bad) return count($bad) . ' cases: ' . implode('; ', array_slice($bad, 0, 12));
    if (ledgerPrint() !== $before) return 'a refused application wrote to the ledger';
    // lenient cases: accepted or refused, but never another kind of error, and what is stored has no control / direction / zero-width characters
    foreach (['name line break' => ['name' => "홍\n길동"], 'name NUL' => ['name' => "홍\0길동"], 'name direction override' => ['name' => "홍길동\u{202E}"], 'name tag' => ['name' => '<i>홍길동</i>'], 'name zero-width' => ['name' => "홍\u{200B}길\u{200D}동"],
        'phone line break' => ['phone' => "010-1234\n-5678"], 'phone NUL' => ['phone' => "010-1234-5678\0"], 'guardian string' => ['guardian' => 'yes'], 'guardian array' => ['guardian' => [true]], 'nameplateShow null' => ['nameplateShow' => null],
        'addr NUL' => ['addr' => "서울\0시 중구"], 'nameplate line break' => ['nameplate' => "첫줄\n둘째줄", 'nameplateShow' => true]] as $w => $over) {
        $unit = $fresh('A1');
        $a = null;
        $r = apiCode(function () use ($u, $unit, $over, &$a) { $a = Tfm\Allot::apply($u, $unit, form($over)); });
        if ($r !== '' && strpos($r, '400 ') !== 0) { $bad[] = "$w → '" . mb_substr($r, 0, 90) . "'"; continue; }
        if ($r !== '') continue;
        $row = conRow($a['contractNo']);
        $rev = json_encode(Tfm\Allot::customer((int) $row['customer_id'], true, $ADM, 'correction'), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) . json_encode(Tfm\Allot::unitView($unit, (int) $u['id']), JSON_UNESCAPED_UNICODE);
        if (preg_match('/\\\\u00[01][0-9a-f]|\\\\n|\\\\r|\\\\t|\x{202E}|\x{200B}|\x{200D}|\\\\u202e|\\\\u200b|\\\\u200d/iu', $rev)) $bad[] = "$w is stored with control / direction / zero-width characters: " . mb_substr($rev, 0, 160);
        Tfm\Allot::cancelByUser($u, $a['contractNo']);
    }
    return $bad ? implode('; ', $bad) : true;
});

check('input — apply targets: unknown, malformed, wrong-typed and hostile unit references are 400 / 404 (a cleaned-up code may answer 409); "any free unit" never crosses into another kind or a closed zone', function () use ($ADM, $fresh) {
    $u = newUser();
    $taken = $fresh('A1');
    Tfm\Allot::apply(newUser(), $taken, form());
    $before = ledgerPrint();
    $bad = [];
    foreach (['empty' => '', 'spaces' => '  ', 'no such unit' => 'A1-9999', 'no such zone' => 'QQ-0001', 'sql' => "$taken' OR '1'='1", 'wildcard' => 'A1-%', 'underscore' => substr($taken, 0, -1) . '_', 'int' => 12, 'zero' => 0, 'null' => null, 'bool' => true, 'float' => 1.5,
        'empty array' => [], 'list' => [$taken], 'auto false' => ['kind' => 'jar', 'auto' => false], 'auto string' => ['kind' => 'jar', 'auto' => 'true'], 'no kind' => ['auto' => true], 'bad kind' => ['kind' => 'pond', 'auto' => true],
        'kind array' => ['kind' => ['jar'], 'auto' => true], 'unknown zone' => ['kind' => 'jar', 'zone' => 'QQ', 'auto' => true], 'zone array' => ['kind' => 'jar', 'zone' => ['A1'], 'auto' => true],
        'long' => str_repeat('A', 5000), 'NUL' => "$taken\0", 'newline' => "$taken\n"] as $w => $t) {
        $r = apiCode(function () use ($u, $t) { Tfm\Allot::apply($u, $t, form()); });
        if (!preg_match('/^(400|404|409) /', $r)) $bad[] = "$w → '" . mb_substr($r, 0, 80) . "'";
    }
    if ($bad) return implode('; ', $bad);
    if (ledgerPrint() !== $before) return 'a refused target wrote to the ledger';
    // a jar wish with a plot zone must not hand out a plot; a closed zone is skipped by "any"
    $r = null;
    $code = apiCode(function () use ($u, &$r) { $r = Tfm\Allot::apply($u, ['kind' => 'jar', 'zone' => 'A2', 'auto' => true], form()); });
    if ($code === '' && strpos((string) $r['unit'], 'A2-') === 0) return 'asked for a jar, got the plot ' . $r['unit'];
    $any = Tfm\Allot::apply($u, ['kind' => 'store', 'auto' => true], form());
    $z = substr($any['unit'], 0, 2);
    return in_array($z, ['A3', 'A6'], true) ? true : 'any free store unit came from zone ' . $z . ' (A7 is closed)';
});

check('input — both drivers treat codes and numbers alike: lower case, a trailing space and wildcards behave the same on MariaDB and SQLite', function () use ($PII, $PII_USER, $fresh) {
    $unit = $fresh('A1');
    $facts = [
        'unit lower' => Tfm\Allot::unit(strtolower($unit)) !== null,
        'unit trailing space' => Tfm\Allot::unit($unit . ' ') !== null,
        'unit leading space' => Tfm\Allot::unit(' ' . $unit) !== null,
        'zone lower' => Tfm\Allot::zone('a1') !== null,
        'zone trailing space' => Tfm\Allot::zone('A1 ') !== null,
        'unitView lower' => apiCode(function () use ($unit) { Tfm\Allot::unitView(strtolower($unit), 0); }) === '',
        'unitView trailing space' => apiCode(function () use ($unit) { Tfm\Allot::unitView($unit . ' ', 0); }) === '',
        'contract no lower' => apiCode(function () use ($PII, $PII_USER) { Tfm\Allot::setLabelByUser($PII_USER, strtolower($PII['no']), '호랑이네 장독', true); }) === '',
        'contract no trailing space' => apiCode(function () use ($PII, $PII_USER) { Tfm\Allot::setLabelByUser($PII_USER, $PII['no'] . ' ', '호랑이네 장독', true); }) === '',
        'listUnits q wildcard %' => count(Tfm\Allot::listUnits(['q' => '%'], 5, 0)['rows']),
        'listUnits q wildcard _' => count(Tfm\Allot::listUnits(['q' => 'A1-000_'], 50, 0)['rows']),
        'listContracts q wildcard' => count(Tfm\Allot::listContracts(['q' => '%'], 5, 0)['rows']),
        'map zone lower' => count(Tfm\Allot::map(null, 'a1')['zones'] ?? []),
    ];
    // the expected behaviour is the same on both drivers: codes are folded to upper case and trimmed by the library (or refused) — never left to the collation
    $want = ['unit lower' => true, 'zone lower' => true, 'unitView lower' => true, 'listUnits q wildcard %' => 0, 'listUnits q wildcard _' => 0, 'listContracts q wildcard' => 0];
    $diff = [];
    foreach ($want as $k => $v) if ($facts[$k] !== $v) $diff[] = $k . ' = ' . json_encode($facts[$k]);
    echo '      ' . Tfm\Db::driver() . ': ' . json_encode($facts) . PHP_EOL;
    return $diff ? implode('; ', $diff) : true;
});

check('input — admin-side numbers are bounded: list limits, cursors, filters and the settings cannot ask for an unbounded page, a zero batch or a negative time', function () use ($ADM) {
    $bad = [];
    foreach ([['listUnits', function ($l, $a) { return Tfm\Allot::listUnits([], $l, $a); }], ['listContracts', function ($l, $a) { return Tfm\Allot::listContracts([], $l, $a); }],
        ['listCustomers', function ($l, $a) { return Tfm\Allot::listCustomers([], $l, $a); }], ['listPayments', function ($l, $a) { return Tfm\Allot::listPayments([], $l, $a); }],
        ['listWait', function ($l, $a) { return Tfm\Allot::listWait([], $l, $a); }], ['listNotices', function ($l, $a) { return Tfm\Allot::listNotices([], $l, $a); }]] as $x) {
        foreach ([[1000000, 0], [0, 0], [-5, 0], [50, -1], [50, PHP_INT_MAX]] as $la) {
            $r = null;
            $code = apiCode(function () use ($x, $la, &$r) { $r = $x[1]($la[0], $la[1]); });
            if ($code !== '' && strpos($code, '400 ') !== 0) $bad[] = "{$x[0]}({$la[0]}, {$la[1]}) → '$code'";
            elseif ($code === '' && count($r['rows']) > 500) $bad[] = "{$x[0]}(limit {$la[0]}) returned " . count($r['rows']) . ' rows';
        }
    }
    foreach ([['status' => 'bogus'], ['kind' => 'pond'], ['zone' => "A1' OR 1=1"], ['q' => str_repeat('x', 5000)], ['status' => ['open']], ['q' => ['a']], ['nope' => 1]] as $f) {
        foreach (['listUnits', 'listContracts', 'listCustomers', 'listWait', 'listPayments', 'listNotices'] as $fn) {
            $code = apiCode(function () use ($fn, $f) { call_user_func(['Tfm\\Allot', $fn], $f, 5, 0); });
            if ($code !== '' && strpos($code, '400 ') !== 0) $bad[] = "$fn(" . substr(json_encode($f), 0, 30) . ") → '" . mb_substr($code, 0, 80) . "'";
        }
    }
    $inbox = Tfm\Allot::inbox(1, 0, 1000000);
    if (count($inbox['notices']) > 50) $bad[] = 'inbox limit';
    foreach (['hold_hours' => [-1, 100000000], 'apply_per_user' => [0, -1, 100000], 'grace_days' => [-1, 100000], 'overdue_end_days' => [-1], 'waitlist_offer_hours' => [0, -1, 100000000], 'retention_days' => [-1, 0, 1],
        'lazy_tick_minutes' => [0, -1], 'tick_batch' => [0, -1, 100000000], 'notice_days' => [[-1], [100000], 'a,b', [1.5]], 'auto_approve' => ['yes', true, 1], 'enabled' => ['maybe', 2], 'consent_version' => ['', 'a b', '<b>', str_repeat('v', 200)]] as $k => $vals) {
        foreach ($vals as $v) {
            $code = apiCode(function () use ($ADM, $k, $v) { Tfm\Allot::saveSettings($ADM, [$k => $v]); });
            if (strpos($code, '400 ') !== 0) { $bad[] = "saveSettings($k = " . json_encode($v) . ") → '" . mb_substr($code, 0, 60) . "' (now " . json_encode(Tfm\Allot::conf($k)) . ')'; Tfm\Allot::saveSettings($ADM, [$k => Tfm\Config::get('allot.' . $k)]); }
        }
    }
    foreach (['terms_text', 'privacy_text', 'refund_text', 'pay_guide'] as $k) {
        $code = apiCode(function () use ($ADM, $k) { Tfm\Allot::saveSettings($ADM, [$k => str_repeat('글', 100000)]); });
        if (strpos($code, '400 ') !== 0) { $bad[] = "$k of 100,000 characters → '$code'"; Tfm\Allot::saveSettings($ADM, [$k => '']); }
    }
    return $bad ? count($bad) . ' cases: ' . implode('; ', array_slice($bad, 0, 10)) : true;
});

check('input — the map and the summary answer hostile parameters with 400 / 404 or an empty answer, never an error of another kind; an old or future version gets the full map', function () {
    $bad = [];
    foreach ([['pond', null, null], ['jar', 'QQ', null], [null, "A1' --", null], [null, str_repeat('Z', 500), null], ['JAR', null, null], [null, null, -1], [null, null, PHP_INT_MAX], [null, null, 0], ['jar', 'A2', null]] as $a) {
        $r = null;
        $code = apiCode(function () use ($a, &$r) { $r = Tfm\Allot::map($a[0], $a[1], $a[2]); });
        if ($code !== '' && !preg_match('/^(400|404) /', $code)) $bad[] = 'map(' . substr(json_encode($a), 0, 40) . ") → '$code'";
        if ($code === '' && $a[2] !== null && !empty($r['same'])) $bad[] = 'map(have ' . $a[2] . ') answered "same"';
    }
    $m = Tfm\Allot::map();
    foreach ($m['zones'] as $z) {
        if (strlen($z['s']) !== $z['cap'] || preg_match('/[^ohlc]/', $z['s'])) $bad[] = "zone {$z['code']}: " . strlen($z['s']) . ' characters for capacity ' . $z['cap'];
        if (array_diff(array_keys($z), ['code', 'kind', 'name', 'cap', 'cols', 'open', 's'])) $bad[] = 'extra zone fields: ' . implode(',', array_keys($z));
    }
    $same = Tfm\Allot::map(null, null, $m['v']);
    if (empty($same['same']) || isset($same['zones'])) $bad[] = 'the current version does not answer {v, same}';
    return $bad ? implode('; ', $bad) : true;
});

// =============================================================================================== 7 · CSV
check('csv — a cell that a spreadsheet would run (= + - @, tab, carriage return, also after leading spaces or a line break) is neutralised; quotes, commas and line breaks stay inside one cell', function () {
    $bad = [];
    foreach (['=1+1', '+1+1', '-1+1', '@SUM(A1)', "\t=1+1", "\r=1+1", '=HYPERLINK("http://x","y")', '=cmd|\' /C calc\'!A0', '+82-10-1234-5678', '-5000원', '@홍길동', ' =1+1', "\n=1+1", '  +1', '＝1+1'] as $v) {
        $cell = Tfm\Allot::csvCell($v);
        $inner = preg_match('/^"(.*)"$/s', $cell, $m) ? str_replace('""', '"', $m[1]) : $cell;
        $first = ltrim($inner, " \n")[0] ?? '';
        if (in_array($v[0], ['=', '+', '-', '@', "\t", "\r"], true) && $inner[0] !== "'") $bad[] = json_encode($v) . ' → ' . json_encode($cell);
        elseif (in_array($first, ['=', '+', '-', '@'], true) && $inner[0] !== "'") $bad[] = json_encode($v) . ' (after leading blanks) → ' . json_encode($cell);
    }
    // numbers stay numbers (a negative amount is not text), text survives a round trip
    if (Tfm\Allot::csvCell(-5000) !== '-5000' && Tfm\Allot::csvCell(-5000) !== '"-5000"') $bad[] = 'the integer -5000 → ' . Tfm\Allot::csvCell(-5000);
    $nasty = ['a,b', 'he said "hi"', "two\r\nlines", "tab\there", '', ' lead', 'trail ', '한글, "따옴표"', "'already quoted", '0012', '1e5', 'null', "NUL\0byte"];
    $line = Tfm\Allot::csvLine($nasty);
    if (substr($line, -2) !== "\r\n") $bad[] = 'a line does not end with CRLF';
    $back = Tfm\Allot::csvParse($line);
    $rows = isset($back['rows']) ? $back['rows'] : $back;
    $row = $rows[0] ?? null;
    $want = $nasty;
    $want[12] = isset($row[12]) && $row[12] === 'NULbyte' ? 'NULbyte' : $want[12];   // dropping the NUL is fine
    if ($row !== $want) $bad[] = 'round trip: ' . json_encode($row, JSON_UNESCAPED_UNICODE);
    return $bad ? implode('; ', $bad) : true;
});

check('csv — the parser: BOM, CRLF / LF / CR, quoted line breaks, a missing last line break, empty lines; random bytes do not break it; 10,000 rows in bounded time', function () use ($BIG) {
    $rowsOf = function ($r) { return isset($r['rows']) ? $r['rows'] : $r; };
    $bad = [];
    $a = $rowsOf(Tfm\Allot::csvParse("\xEF\xBB\xBFa,b\r\n1,\"x\r\ny\"\r\n\r\n2,z"));
    if ($a !== [['a', 'b'], ['1', "x\r\ny"], ['2', 'z']] && $a !== [['a', 'b'], ['1', "x\ny"], ['2', 'z']]) $bad[] = 'BOM / CRLF: ' . json_encode($a);
    $b = $rowsOf(Tfm\Allot::csvParse("a,b\n1,2\n"));
    $c = $rowsOf(Tfm\Allot::csvParse("a,b\r1,2\r"));
    if ($b !== [['a', 'b'], ['1', '2']]) $bad[] = 'LF: ' . json_encode($b);
    if ($c !== [['a', 'b'], ['1', '2']]) $bad[] = 'CR only: ' . json_encode($c);
    $junk = apiCode(function () { Tfm\Allot::csvParse(random_bytes(20000)); });
    if ($junk !== '' && strpos($junk, '400 ') !== 0) $bad[] = "random bytes → '$junk'";
    if ($BIG) {
        $csv = '';
        for ($i = 0; $i < 10000; $i++) $csv .= "2026-11-01,\"이름 $i\",010-5000-" . str_pad((string) $i, 4, '0', STR_PAD_LEFT) . ",\"주소, \"\"$i\"\"\",메모 $i,A1-0001,\r\n";
        $t = microtime(true);
        $m0 = memory_get_usage();
        $r = $rowsOf(Tfm\Allot::csvParse($csv));
        $ms = (int) round((microtime(true) - $t) * 1000);
        $mb = round((memory_get_peak_usage() - $m0) / 1048576, 1);
        echo "      csvParse 10,000 rows (" . round(strlen($csv) / 1024) . " KB): {$ms} ms, +{$mb} MB peak" . PHP_EOL;
        if (count($r) !== 10000 || $r[9999][3] !== '주소, "9999"') $bad[] = '10,000 rows: ' . count($r);
        if ($ms > 5000) $bad[] = "10,000 rows took $ms ms";
    }
    return $bad ? implode('; ', $bad) : true;
});

check('csv — exports: text typed by people (nameplate, zone name, memo, care note, customer name) cannot become a formula in the exported file', function () use ($ADM, $offline, $fresh, $idem) {
    Tfm\Allot::saveZone($ADM, ['code' => 'A8', 'kind' => 'plot', 'name' => '=SUM(1;2)', 'capacity' => 3, 'cols' => 3, 'price' => 1000, 'period' => 'month', 'termMonths' => 0, 'isOpen' => true]);
    $cu = Tfm\Allot::saveCustomer($ADM, ['name' => '=cmd|x', 'phone' => '010-4505-0001', 'addr' => '+주소 1', 'memo' => '@memo']);
    $cuCode = '';
    if (!isset($cu['id'])) return 'saveCustomer: ' . json_encode($cu);
    Tfm\Allot::createContract($ADM, 'A8-0001', $cu['id'], ['memo' => '-memo of the contract']);
    $c = conOn('A8-0001');
    Tfm\Allot::setLabel($ADM, (int) $c['unit_id'], '=1+1', true);
    Tfm\Allot::recordPayment($ADM, (int) $c['id'], 1000, 'bank', $idem(), ['memo' => '+입금 메모']);
    Tfm\Allot::setMemo($ADM, (int) $c['id'], '=2*3');
    $bad = [];
    foreach (Tfm\Allot::EXPORTS as $w) {
        foreach ([false, true] as $reveal) {
            $after = 0;
            do {
                $page = $reveal ? Tfm\Allot::exportRows($w, $after, 500, true, $ADM, 'report') : Tfm\Allot::exportRows($w, $after, 500);
                foreach ($page['rows'] as $row) {
                    $line = Tfm\Allot::csvLine($row);
                    $cells = Tfm\Allot::csvParse($line);
                    $cells = isset($cells['rows']) ? $cells['rows'][0] : $cells[0];
                    foreach ($cells as $i => $cell) {
                        if (is_int($row[$i]) || is_float($row[$i])) continue;
                        if ($cell !== '' && in_array($cell[0], ['=', '+', '-', '@', "\t", "\r"], true)) $bad[] = "$w" . ($reveal ? ' (revealed)' : '') . ': ' . json_encode($cell, JSON_UNESCAPED_UNICODE);
                    }
                }
                $after = (int) $page['next'];
            } while ($after > 0);
        }
    }
    return $bad ? implode('; ', array_slice(array_values(array_unique($bad)), 0, 8)) : true;
});

check('csv — import (ledger): a dry run writes nothing; a file with one bad line (leased unit, the same unit twice, unknown unit, bad phone / date, no name) commits NOTHING; the clean file commits once — never a second holder', function () use ($ADM, $fresh, $offline) {
    $leased = $fresh('A1');
    $offline($leased);
    $f1 = $fresh('A1'); $f2 = $fresh('A1'); $f3 = $fresh('A1');
    $head = Tfm\Allot::csvLine(Tfm\Allot::exportHeader('ledger'));
    $good = [
        ['2026-11-01', '수입하나', '010-4600-0001', '', '첫 줄', $f1, '', ''],
        ['2026-11-01', '수입셋', '010-4600-0003', '', '같은 자리 1', $f2, '', ''],
    ];
    $poison = [
        'a leased unit' => ['2026-11-01', '수입둘', '010-4600-0002', '', '분양된 자리', $leased, '', ''],
        'the same unit twice in the file' => ['2026-11-01', '수입넷', '010-4600-0004', '', '같은 자리 2', $f2, '', ''],
        'an unknown unit' => ['2026-11-01', '수입다섯', '010-4600-0005', '', '없는 자리', 'QQ-0001', '', ''],
        'Feb 30' => ['2026-02-30', '수입여섯', '010-4600-0006', '', '없는 날', $f3, '', ''],
        'a bad phone' => ['2026-11-01', '수입일곱', '010-46', '', '짧은 전화', $f3, '', ''],
        'no name' => ['2026-11-01', '', '010-4600-0008', '', '이름 없음', $f3, '', ''],
    ];
    $before = ledgerPrint();
    foreach ($poison as $what => $row) {
        $csv = $head . Tfm\Allot::csvLine($good[0]) . Tfm\Allot::csvLine($row) . Tfm\Allot::csvLine($good[1]);
        $dry = Tfm\Allot::importCsv($ADM, 'ledger', $csv, true);
        $real = Tfm\Allot::importCsv($ADM, 'ledger', $csv, false);
        if (ledgerPrint() !== $before) return "a file with $what wrote to the ledger";
        if ($dry['ok'] !== false || $real['ok'] !== false || $real['created']['contracts'] !== 0) return "a file with $what: ok " . json_encode([$dry['ok'], $real['ok'], $real['created']]);
        $badLines = array_map(function ($r) { return $r['line']; }, array_values(array_filter($dry['rows'], function ($r) { return !$r['ok']; })));
        // a unit named twice: blaming either of the two lines is right (the importer blames the second one)
        if ($badLines !== [3] && !($what === 'the same unit twice in the file' && $badLines === [4])) return "a file with $what: the report blames the lines " . json_encode($badLines) . ' (want line 3)';
        $json = json_encode([$dry, $real], JSON_UNESCAPED_UNICODE);
        if (preg_match('/010-4600-000\d|수입하나|수입둘|수입셋/u', $json)) return 'the import report repeats a name or phone: ' . mb_substr($json, 0, 300);
    }
    $csv = $head . Tfm\Allot::csvLine($good[0]) . Tfm\Allot::csvLine($good[1]);
    $real = Tfm\Allot::importCsv($ADM, 'ledger', $csv, false);
    $n = (int) Tfm\Db::value("SELECT COUNT(*) FROM allot_contracts WHERE source = 'import'");
    $again = Tfm\Allot::importCsv($ADM, 'ledger', $csv, false);   // the same file once more: nothing new, no second holder
    $n2 = (int) Tfm\Db::value("SELECT COUNT(*) FROM allot_contracts WHERE source = 'import'");
    return $real['ok'] === true && $real['created']['contracts'] === 2 && $n === 2 && $n2 === 2 && $again['created']['contracts'] === 0 && unitRow($f1)['status'] === 'leased' && unitRow($f2)['status'] === 'leased'
        && unitRow($f3)['status'] === 'open' && inv() === '' ? true : json_encode([$real['ok'], $real['created'], $n, $n2, unitRow($f1)['status'], unitRow($f2)['status'], unitRow($f3)['status'], inv()]);
});

check('csv — import (payments): unknown / closed contracts, negative / zero / huge / text / exponent amounts and bad dates are refused line by line; a clean file credits once, the same file again credits nothing', function () use ($ADM, $fresh, $offline) {
    $unit = $fresh('A2');
    $c = $offline($unit);
    $closedUnit = $fresh('A2');
    $closed = $offline($closedUnit);
    Tfm\Allot::endContract($ADM, (int) $closed['id'], 'attack');
    $hdr = Tfm\Allot::exportHeader('payments');
    $head = Tfm\Allot::csvLine($hdr);
    $mk = function (string $no, string $unitCode, $amount, string $date = '2026-11-02', string $method = '계좌이체') use ($hdr) {
        $row = array_fill(0, count($hdr), '');
        foreach ($hdr as $i => $h) {
            if ($h === '계약번호') $row[$i] = $no; elseif ($h === '단위') $row[$i] = $unitCode; elseif ($h === '금액') $row[$i] = $amount; elseif ($h === '입금 일시') $row[$i] = $date; elseif ($h === '방법') $row[$i] = $method; elseif ($h === '비고') $row[$i] = '수입 입금';
        }
        return $row;
    };
    $goodLine = Tfm\Allot::csvLine($mk($c['contract_no'], $unit, 10000));
    $before = ledgerPrint();
    foreach (['an unknown contract' => $mk('A26-ZZZZZ-ZZZZZ', '', 10000), 'a closed contract' => $mk($closed['contract_no'], $closedUnit, 10000), 'a negative amount' => $mk($c['contract_no'], $unit, -10000),
        'zero' => $mk($c['contract_no'], $unit, 0), 'a huge amount' => $mk($c['contract_no'], $unit, '99999999999'), 'a text amount' => $mk($c['contract_no'], $unit, '만원'), 'an exponent' => $mk($c['contract_no'], $unit, '1e4'),
        'a float' => $mk($c['contract_no'], $unit, '10000.5'), 'a hex amount' => $mk($c['contract_no'], $unit, '0x2710'), 'a bad date' => $mk($c['contract_no'], $unit, 10000, '2026-13-45'),
        'an unknown method' => $mk($c['contract_no'], $unit, 10000, '2026-11-02', '비트코인')] as $what => $row) {
        $csv = $head . $goodLine . Tfm\Allot::csvLine($row);
        $dry = Tfm\Allot::importCsv($ADM, 'payments', $csv, true);
        $real = Tfm\Allot::importCsv($ADM, 'payments', $csv, false);
        if (ledgerPrint() !== $before) return "a file with $what credited something";
        if ($real['ok'] !== false) return "a file with $what is accepted";
        $badLines = array_map(function ($r) { return $r['line']; }, array_values(array_filter($dry['rows'], function ($r) { return !$r['ok']; })));
        if ($badLines !== [3]) return "a file with $what: the report blames the lines " . json_encode($badLines);
    }
    $real = Tfm\Allot::importCsv($ADM, 'payments', $head . $goodLine, false);
    $t1 = (int) conById((int) $c['id'])['paid_total'];
    $again = Tfm\Allot::importCsv($ADM, 'payments', $head . $goodLine, false);
    $t2 = (int) conById((int) $c['id'])['paid_total'];
    return $real['ok'] === true && $t1 === 10000 && $t2 === 10000 && (int) conById((int) $closed['id'])['paid_total'] === 0 && inv() === '' ? true
        : json_encode(['ok' => $real['ok'], 'after the file' => $t1, 'after the same file again' => $t2, 'inv' => inv(), 'again' => $again['created'] ?? null], JSON_UNESCAPED_UNICODE);
});

check('csv — import: wrong files are refused as a whole (no header, unknown columns, 0 rows of data is fine, a binary file, a file over the row limit) and non-admins cannot import', function () use ($ADM, $NOADM) {
    $before = ledgerPrint();
    $bad = [];
    $head = Tfm\Allot::csvLine(Tfm\Allot::exportHeader('ledger'));
    foreach (['empty' => '', 'only a BOM' => "\xEF\xBB\xBF", 'no header' => "2026-11-01,누구,010-1234-5678,,,A1-0001,,\r\n", 'unknown columns' => "가,나,다\r\n1,2,3\r\n", 'binary' => random_bytes(4000),
        'duplicate header columns' => "일자,성명,성명,연락처,단위\r\n2026-11-01,가,나,010-1234-5678,A1-0001\r\n", 'unclosed quote' => $head . "2026-11-01,\"누구,010-1234-5678,,,A1-0001,,\r\n"] as $w => $csv) {
        $r = null;
        $code = apiCode(function () use ($ADM, $csv, &$r) { $r = Tfm\Allot::importCsv($ADM, 'ledger', $csv, false); });
        if ($code !== '' && strpos($code, '400 ') !== 0) $bad[] = "$w → '" . mb_substr($code, 0, 80) . "'";
        if ($code === '' && ($r['created']['contracts'] ?? 0) > 0) $bad[] = "$w created contracts";
    }
    if (apiCode(function () use ($NOADM, $head) { Tfm\Allot::importCsv($NOADM, 'ledger', $head, false); }) !== '403 FORBIDDEN') $bad[] = 'a non-admin imported';
    if ($bad) return implode('; ', $bad);
    return ledgerPrint() === $before ? true : 'a refused import wrote to the ledger';
});

// =============================================================================================== 8 · defects found by reading the code (each check failed before its fix)
Tfm\Allot::saveSettings($ADM, ['toss_enabled' => true]);
/** an approved monthly contract (zone A2, 10,000 a month) of a fresh account, approved at $t0 → [user, contract number, contract id, unit code] */
$monthly = function (int $t0) use ($ADM, $fresh): array {
    $u = newUser();
    $unit = $fresh('A2');
    $a = Tfm\Allot::apply($u, $unit, form(), $t0);
    $cid = (int) conRow($a['contractNo'])['id'];
    Tfm\Allot::decide($ADM, $cid, 'active', '', $t0);
    return [$u, $a['contractNo'], $cid, $unit];
};
/** status of the payment row of an order */
$orderStatus = function (string $orderId): string { return (string) Tfm\Db::value('SELECT status FROM allot_payments WHERE order_id = ?', [$orderId]); };

check('defect D1 — a stale order paid after the contract ended is refused BEFORE the gateway is asked, and the earlier, earned payments are not given back', function () use ($ADM, $monthly, $orderStatus, $DAY) {
    $t0 = Tfm\Clock::ms() - 10 * $DAY;
    list($u, $no, $cid) = $monthly($t0);
    $p1 = Tfm\Allot::payPrepare($u, $no, $t0 + 1000);
    Tfm\Allot::payConfirm($u, 'mock_' . $p1['orderId'], $p1['orderId'], $p1['amount'], $t0 + 2000);
    $p2 = Tfm\Allot::payPrepare($u, $no, $t0 + 2 * $DAY);
    if ($p2['orderId'] === $p1['orderId']) return 'set-up: no second order';
    Tfm\Allot::endContract($ADM, $cid, 'attack', $t0 + 3 * $DAY);
    // "mock_timeout_" makes the mock gateway fail with a network error: a 503 here means the gateway WAS asked to take money for a dead contract
    $r = apiCode(function () use ($u, $p2, $t0, $DAY) { Tfm\Allot::payConfirm($u, 'mock_timeout_' . $p2['orderId'], $p2['orderId'], $p2['amount'], $t0 + 3 * $DAY + 1000); });
    $r2 = apiCode(function () use ($u, $p2, $t0, $DAY) { Tfm\Allot::payConfirm($u, 'mock_' . $p2['orderId'], $p2['orderId'], $p2['amount'], $t0 + 3 * $DAY + 2000); });
    $c = conById($cid);
    $first = $orderStatus($p1['orderId']);
    $second = $orderStatus($p2['orderId']);
    $refunds = (int) Tfm\Db::value("SELECT COUNT(*) FROM allot_payments WHERE contract_id = ? AND kind = 'refund'", [$cid]);
    return $r === '409 CONTRACT_CLOSED' && strpos($r2, '409 ') === 0 && $first === 'paid' && in_array($second, ['canceled', 'failed'], true) && (int) $c['paid_total'] === 10000 && $refunds === 0 && inv() === '' ? true
        : json_encode(['confirm (gateway would time out)' => $r, 'again' => $r2, 'first payment' => $first, 'stale order' => $second, 'paid_total' => $c['paid_total'], 'refund rows' => $refunds, 'inv' => inv()]);
});

check('defect D1 — the contract ends WHILE the gateway takes the money: only that payment goes back (refunded + refund row), the earlier one stays paid', function () use ($ADM, $monthly, $orderStatus, $par, $DAY, $ROUNDS) {
    for ($r = 0; $r < $ROUNDS; $r++) {
        $t0 = Tfm\Clock::ms() - 10 * $DAY;
        list($u, $no, $cid) = $monthly($t0);
        $p1 = Tfm\Allot::payPrepare($u, $no, $t0 + 1000);
        Tfm\Allot::payConfirm($u, 'mock_' . $p1['orderId'], $p1['orderId'], $p1['amount'], $t0 + 2000);
        $p2 = Tfm\Allot::payPrepare($u, $no, $t0 + 2 * $DAY);
        $out = $par([
            child('$u = Tfm\\Users::byId(' . (int) $u['id'] . '); Tfm\\Allot::payConfirm($u, ' . var_export('mock_slow700_' . $p2['orderId'], true) . ', ' . var_export($p2['orderId'], true) . ', ' . (int) $p2['amount'] . ', ' . ($t0 + 3 * $DAY) . '); echo "paid";'),
            child('usleep(200000); Tfm\\Allot::endContract($ADM, ' . $cid . ', "attack", ' . ($t0 + 3 * $DAY) . '); echo "ended";'),
        ]);
        $c = conById($cid);
        $first = $orderStatus($p1['orderId']);
        $second = $orderStatus($p2['orderId']);
        $refunds = Tfm\Db::all("SELECT amount FROM allot_payments WHERE contract_id = ? AND kind = 'refund'", [$cid]);
        if ($out !== ['CONTRACT_CLOSED', 'ended']) return "round $r: set-up — the race did not close the contract during the gateway call: " . json_encode($out);
        if ($first !== 'paid' || $second !== 'refunded' || count($refunds) !== 1 || (int) $refunds[0]['amount'] !== 10000 || (int) $c['paid_total'] !== 10000 || inv() !== '') {
            return "round $r: " . json_encode(['first payment' => $first, 'late payment' => $second, 'refund rows' => $refunds, 'paid_total' => $c['paid_total'], 'inv' => inv()]);
        }
    }
    return true;
});

check('defect D1 — two payment windows for one application (the second opened 31 minutes later): the second is refused before the gateway is asked; never double money', function () use ($ADM, $orderStatus, $par) {
    Tfm\Allot::saveZone($ADM, ['code' => 'A5', 'kind' => 'store', 'name' => '두 번 결제 창고', 'capacity' => 12, 'cols' => 4, 'price' => 220000, 'period' => 'once', 'termMonths' => 12, 'isOpen' => true]);
    $mk = function (int $n): array {
        $u = newUser();
        $t0 = Tfm\Clock::ms() - 3600000;
        $a = Tfm\Allot::apply($u, sprintf('A5-%04d', $n), form(), $t0);
        $p1 = Tfm\Allot::payPrepare($u, $a['contractNo'], $t0 + 1000);
        $p2 = Tfm\Allot::payPrepare($u, $a['contractNo'], $t0 + 31 * 60000);
        return [$u, $a['contractNo'], $p1, $p2, $t0];
    };
    list($u, $no, $p1, $p2, $t0) = $mk(1);
    if ($p1['orderId'] === $p2['orderId']) return 'set-up: the second window reuses the first order';
    $a1 = apiCode(function () use ($u, $p1, $t0) { Tfm\Allot::payConfirm($u, 'mock_' . $p1['orderId'], $p1['orderId'], $p1['amount'], $t0 + 32 * 60000); });
    $a2 = apiCode(function () use ($u, $p2, $t0) { Tfm\Allot::payConfirm($u, 'mock_timeout_' . $p2['orderId'], $p2['orderId'], $p2['amount'], $t0 + 33 * 60000); });
    $c = conRow($no);
    if ($a1 !== '' || $a2 !== '409 NOTHING_DUE' || (int) $c['paid_total'] !== 220000 || $orderStatus($p2['orderId']) !== 'canceled') {
        return json_encode(['first' => $a1, 'second (gateway would time out)' => $a2, 'paid_total' => $c['paid_total'], 'second order' => $orderStatus($p2['orderId'])]);
    }
    // both windows are paid at the same instant: one credit; the other payment is given back
    list($u, $no, $p1, $p2, $t0) = $mk(2);
    $at = $t0 + 32 * 60000;
    $out = $par([
        child('$u = Tfm\\Users::byId(' . (int) $u['id'] . '); Tfm\\Allot::payConfirm($u, ' . var_export('mock_slow300_' . $p1['orderId'], true) . ', ' . var_export($p1['orderId'], true) . ', 220000, ' . $at . '); echo "paid";'),
        child('$u = Tfm\\Users::byId(' . (int) $u['id'] . '); Tfm\\Allot::payConfirm($u, ' . var_export('mock_slow300_' . $p2['orderId'], true) . ', ' . var_export($p2['orderId'], true) . ', 220000, ' . $at . '); echo "paid";'),
    ]);
    $c = conRow($no);
    $st = [$orderStatus($p1['orderId']), $orderStatus($p2['orderId'])];
    sort($st);
    sort($out);
    return (int) $c['paid_total'] === 220000 && $out === ['NOTHING_DUE', 'paid'] && $st === ['paid', 'refunded'] && inv() === '' ? true
        : json_encode(['answers' => $out, 'orders' => $st, 'paid_total' => $c['paid_total'], 'inv' => inv()]);
});

check('defect D1 — an application that was paid through 토스 and is then rejected by the operator (or ended while pending) gets its 토스 money back like a user cancel does', function () use ($ADM, $fresh, $orderStatus) {
    $bad = [];
    foreach (['reject' => function (int $cid) use ($ADM) { Tfm\Allot::decide($ADM, $cid, 'canceled', ''); }, 'end' => function (int $cid) use ($ADM) { Tfm\Allot::endContract($ADM, $cid, '정리'); }] as $how => $fn) {
        $u = newUser();
        $a = Tfm\Allot::apply($u, $fresh('A1'), form());
        $p = Tfm\Allot::payPrepare($u, $a['contractNo']);
        Tfm\Allot::payConfirm($u, 'mock_' . $p['orderId'], $p['orderId'], $p['amount']);
        $cid = (int) conRow($a['contractNo'])['id'];
        $fn($cid);
        $c = conById($cid);
        if ($c['status'] !== 'canceled' || (int) $c['paid_total'] !== 0 || $orderStatus($p['orderId']) !== 'refunded') $bad[] = "$how: contract {$c['status']}, paid_total {$c['paid_total']}, payment " . $orderStatus($p['orderId']);
    }
    return $bad ? implode('; ', $bad) : (inv() === '' ? true : inv());
});

check('defect D1 — when the gateway cannot give a late payment back, the money is not hidden: it stays on the books and the integrity scan reports refund_due', function () use ($ADM, $monthly, $DAY) {
    if (!method_exists('Tfm\\Allot', 'voidTossPayment')) return 'Tfm\\Allot::voidTossPayment() does not exist (the late-payment path still refunds every 토스 payment of the contract)';
    $t0 = Tfm\Clock::ms() - 10 * $DAY;
    list($u, $no, $cid) = $monthly($t0);
    $p = Tfm\Allot::payPrepare($u, $no, $t0 + 1000);
    // the state right after the gateway took the money for a contract that ended meanwhile: the order is 'paid', nothing was credited
    Tfm\Allot::endContract($ADM, $cid, 'attack', $t0 + 2000);
    $key = 'mock_' . $p['orderId'];
    Tfm\Db::exec("UPDATE allot_payments SET status = 'paid', claim = 'x', payment_key_enc = ?, paid_at = ? WHERE order_id = ?", [Tfm\Crypto::seal($key), $t0 + 3000, $p['orderId']]);
    $payId = (int) Tfm\Db::value('SELECT id FROM allot_payments WHERE order_id = ?', [$p['orderId']]);
    $m = new ReflectionMethod('Tfm\\Allot', 'voidTossPayment');
    $m->setAccessible(true);
    Tfm\Config::override('toss.mock', false);   // no mock and no keys: the gateway call fails
    try { $ok = $m->invoke(null, $payId, $key, 'CONTRACT_CLOSED', $t0 + 4000); } finally { Tfm\Config::override('toss.mock', null); }
    $row = Tfm\Db::one('SELECT status, toss_status FROM allot_payments WHERE id = ?', [$payId]);
    $c = conById($cid);
    $issues = json_encode(Tfm\Allot::integrity(500, false)['issues'], JSON_UNESCAPED_UNICODE);
    return $ok === false && $row['status'] === 'paid' && (int) $c['paid_total'] === 10000 && strpos($issues, 'refund_due') !== false && strpos($issues, $no) !== false && inv() === '' ? true
        : json_encode(['returned' => $ok, 'payment' => $row, 'paid_total' => $c['paid_total'], 'issues' => $issues, 'inv' => inv()], JSON_UNESCAPED_UNICODE);
});

check('defect D2 — a refund takes the paid period back: the newest payment exactly, an older one by its length; the due notice can fire again; a refund never lengthens anything', function () use ($ADM, $offline, $fresh, $idem, $DAY) {
    $start = (int) (new DateTimeImmutable('2027-01-31 10:00:00', new DateTimeZone('Asia/Seoul')))->format('U') * 1000;
    $cu = Tfm\Allot::saveCustomer($ADM, ['name' => '환불고객', 'phone' => '010-4506-0001']);
    $unit = $fresh('A2');
    Tfm\Allot::createContract($ADM, $unit, $cu['id'], ['startsAt' => $start], $start);
    $id = (int) conOn($unit)['id'];
    $pay = [];
    $until = [(int) conById($id)['paid_until']];
    for ($i = 0; $i < 3; $i++) { $pay[] = Tfm\Allot::recordPayment($ADM, $id, 10000, 'bank', $idem(), [], $start + $i * 1000)['payment']; $until[] = (int) conById($id)['paid_until']; }
    // newest first: back to the state after two payments
    Tfm\Allot::refund($ADM, (int) $pay[2]['id'], '잘못 입력', $start + 5000);
    $afterNewest = conById($id);
    if ((int) $afterNewest['paid_until'] !== $until[2] || (int) $afterNewest['paid_total'] !== 20000) return 'after the refund of the newest payment paid_until is ' . date('Y-m-d', intdiv((int) $afterNewest['paid_until'], 1000)) . ' (want ' . date('Y-m-d', intdiv($until[2], 1000)) . '), total ' . $afterNewest['paid_total'];
    // then an older one (the first month): one month comes off the end
    Tfm\Allot::refund($ADM, (int) $pay[0]['id'], '잘못 입력', $start + 6000);
    $afterOld = conById($id);
    if ((int) $afterOld['paid_until'] !== $until[1] || (int) $afterOld['paid_total'] !== 10000) return 'after the refund of an older payment paid_until is ' . date('Y-m-d', intdiv((int) $afterOld['paid_until'], 1000)) . ' (want ' . date('Y-m-d', intdiv($until[1], 1000)) . '), total ' . $afterOld['paid_total'];
    if ((int) $afterOld['due_stage'] !== 999) return 'the due stage is not reset (' . $afterOld['due_stage'] . '): the reminder for the re-opened period would never be sent';
    Tfm\Allot::refund($ADM, (int) $pay[1]['id'], '잘못 입력', $start + 7000);
    $none = conById($id);
    if ((int) $none['paid_until'] !== $until[0] || (int) $none['paid_total'] !== 0) return 'after every refund paid_until is ' . date('Y-m-d', intdiv((int) $none['paid_until'], 1000)) . ' (want the start), total ' . $none['paid_total'];
    // the webhook path (a payment canceled at the gateway) follows the same rule
    $u = newUser();
    $unit2 = $fresh('A2');
    $t0 = Tfm\Clock::ms() - 5 * $DAY;
    $a = Tfm\Allot::apply($u, $unit2, form(), $t0);
    $cid = (int) conRow($a['contractNo'])['id'];
    Tfm\Allot::decide($ADM, $cid, 'active', '', $t0);
    $p = Tfm\Allot::payPrepare($u, $a['contractNo'], $t0 + 1000);
    Tfm\Allot::payConfirm($u, 'mock_' . $p['orderId'], $p['orderId'], $p['amount'], $t0 + 2000);
    $paid = (int) conById($cid)['paid_until'];
    Tfm\Allot::webhook(['eventType' => 'PAYMENT_STATUS_CHANGED', 'data' => ['paymentKey' => 'mock_' . $p['orderId'], 'orderId' => $p['orderId'], 'status' => 'CANCELED']]);
    $w = conById($cid);
    return $paid > $t0 && (int) $w['paid_until'] === $t0 && (int) $w['paid_total'] === 0 && inv() === '' ? true : 'webhook cancel: paid_until ' . $w['paid_until'] . ' (was ' . $paid . ', start ' . $t0 . '), total ' . $w['paid_total'] . ' ' . inv();
});

check('defect D3 — renewals and imported ledgers keep the day of the month too (a term that starts on the 31st does not slide to the 28th)', function () use ($ADM, $fresh) {
    Tfm\Allot::saveZone($ADM, ['code' => 'A4', 'kind' => 'plot', 'name' => '석 달 텃밭', 'capacity' => 6, 'cols' => 3, 'price' => 0, 'period' => 'year', 'termMonths' => 1, 'isOpen' => true]);
    $ms = function (string $s): int { return (int) (new DateTimeImmutable($s, new DateTimeZone('Asia/Seoul')))->format('U') * 1000; };
    $start = $ms('2027-01-31 10:00:00');
    $cu = Tfm\Allot::saveCustomer($ADM, ['name' => '말일연장', 'phone' => '010-4507-0001']);
    Tfm\Allot::createContract($ADM, 'A4-0001', $cu['id'], ['startsAt' => $start], $start);
    $id = (int) conOn('A4-0001')['id'];
    $ends = [(int) conById($id)['ends_at']];
    for ($i = 0; $i < 3; $i++) { Tfm\Allot::renew($ADM, $id, 1, $start + $i); $ends[] = (int) conById($id)['ends_at']; }
    $want = [$ms('2027-02-28 10:00:00'), $ms('2027-03-31 10:00:00'), $ms('2027-04-30 10:00:00'), $ms('2027-05-31 10:00:00')];
    $fmt = function (int $t): string { return (new DateTimeImmutable('@' . intdiv($t, 1000)))->setTimezone(new DateTimeZone('Asia/Seoul'))->format('m-d'); };
    return $ends === $want ? true : 'ends after 0…3 renewals of a one-month term from 01-31: ' . implode(' ', array_map($fmt, $ends)) . ' (want 02-28 03-31 04-30 05-31)';
});

check('defect D8 — the lazy automation is not frozen by a start stamp from the future (a clock that was wrong for a while): it runs again and repairs the stamp', function () use ($ADM, $DAY) {
    $now = Tfm\Clock::ms();
    $old = Tfm\Allot::lastTickAt();
    Tfm\Db::upsert('settings', ['k' => 'allot.tick_at', 'v' => (string) ($now + 400 * $DAY), 'updated_at' => $now, 'updated_by' => null], ['k']);
    Tfm\Allot::forget();
    $ran = Tfm\Allot::lazyTick($now);
    $stamp = Tfm\Allot::lastTickAt();
    $again = Tfm\Allot::lazyTick($now + 1000);
    // a stamp slightly ahead (another web server whose clock runs a few seconds fast) is NOT a reason to run again
    Tfm\Db::upsert('settings', ['k' => 'allot.tick_at', 'v' => (string) ($now + 5000), 'updated_at' => $now, 'updated_by' => null], ['k']);
    Tfm\Allot::forget();
    $skew = Tfm\Allot::lazyTick($now);
    Tfm\Db::upsert('settings', ['k' => 'allot.tick_at', 'v' => (string) max($old, $now), 'updated_at' => $now, 'updated_by' => null], ['k']);
    Tfm\Allot::forget();
    return $ran === true && $stamp === $now && $again === false && $skew === false ? true : json_encode(['ran with a stamp 400 days ahead' => $ran, 'stamp repaired' => $stamp === $now, 'ran again a second later' => $again, 'ran with a stamp 5 s ahead' => $skew]);
});

check('defect D9 — the contracts export leaves "끝난 까닭" empty for a contract that has not ended', function () use ($ADM, $offline, $fresh) {
    $c = $offline($fresh('A1'));
    $hdr = Tfm\Allot::exportHeader('contracts');
    $col = array_search('끝난 까닭', $hdr, true);
    $noCol = array_search('계약번호', $hdr, true);
    $after = 0;
    do {
        $page = Tfm\Allot::exportRows('contracts', $after, 500);
        foreach ($page['rows'] as $row) if ($row[$noCol] === $c['contract_no']) return $row[$col] === '' ? true : "a running contract is exported with the end reason '" . $row[$col] . "'";
        $after = (int) $page['next'];
    } while ($after > 0);
    return 'the contract is not in the export';
});

check('defect D10 — order ids and idempotency keys are exact on both drivers: another letter case or a trailing line break is another (unknown) id', function () use ($ADM, $fresh, $offline, $orderStatus) {
    $u = newUser();
    $a = Tfm\Allot::apply($u, $fresh('A1'), form());
    $p = Tfm\Allot::payPrepare($u, $a['contractNo']);
    $swap = strtolower($p['orderId']) === $p['orderId'] ? strtoupper($p['orderId']) : strtolower($p['orderId']);
    $r1 = apiCode(function () use ($u, $p, $swap) { Tfm\Allot::payConfirm($u, 'mock_' . $p['orderId'], $swap, $p['amount']); });
    $r2 = apiCode(function () use ($u, $p) { Tfm\Allot::payConfirm($u, 'mock_' . $p['orderId'], $p['orderId'] . "\n", $p['amount']); });
    $wh = Tfm\Allot::webhook(['eventType' => 'PAYMENT_STATUS_CHANGED', 'data' => ['paymentKey' => 'mock_' . $p['orderId'], 'orderId' => $swap, 'status' => 'CANCELED']]);
    $st = $orderStatus($p['orderId']);
    $c = $offline($fresh('A2'));
    $k = 'atk-case-' . bin2hex(random_bytes(6));
    $nl = apiCode(function () use ($ADM, $c, $k) { Tfm\Allot::recordPayment($ADM, (int) $c['id'], 10000, 'bank', $k . "\n"); });
    return $r1 === '404 ORDER_NOT_FOUND' && preg_match('/^(400|404) /', $r2) && $wh['ignored'] === true && $st === 'created' && strpos($nl, '400 ') === 0 ? true
        : json_encode(['other case' => $r1, 'trailing line break' => $r2, 'webhook other case' => $wh, 'order' => $st, 'idem with line break' => $nl]);
});
Tfm\Allot::saveSettings($ADM, ['toss_enabled' => false]);

check('defect D7 — a crash between "stage moved" and "notice written" (the notices table fails in the middle of a tick) loses no notice: the next tick sends it, exactly once', function () use ($ADM, $fresh, $DAY, $IS_MYSQL) {
    $now = Tfm\Clock::ms();
    $mk = function (int $paidUntil) use ($ADM, $fresh, $now) {
        $unit = $fresh('A2');
        $cu = Tfm\Allot::saveCustomer($ADM, ['name' => '중단고객', 'phone' => '010-4508-' . str_pad((string) random_int(0, 9999), 4, '0', STR_PAD_LEFT)]);
        Tfm\Allot::createContract($ADM, $unit, $cu['id'], ['startsAt' => $now - 60 * 86400000, 'paidUntil' => $paidUntil], $now);
        return (int) conOn($unit)['id'];
    };
    $due = $mk($now + 2 * $DAY);              // inside the 7-day stage: a "time to pay" notice
    $late = $mk($now - 20 * $DAY);            // past the 14 grace days: becomes overdue + one notice
    $count = function (int $cid, string $kind): int { return (int) Tfm\Db::value('SELECT COUNT(*) FROM allot_notices WHERE contract_id = ? AND kind = ?', [$cid, $kind]); };
    $ren = function (string $a, string $b) use ($IS_MYSQL) { Tfm\Db::exec($IS_MYSQL ? "RENAME TABLE $a TO $b" : "ALTER TABLE $a RENAME TO $b"); };
    $ren('allot_notices', 'allot_notices_gone');
    try { $r1 = Tfm\Allot::tick($now, 'admin'); } finally { $ren('allot_notices_gone', 'allot_notices'); }
    for ($i = 0; $i < 6; $i++) { $r2 = Tfm\Allot::tick($now + 1000 + $i, 'admin'); if (!$r2['more']) break; }
    $res = ['first tick ok' => $r1['ok'], 'due notices' => $count($due, 'due'), 'overdue notices' => $count($late, 'overdue'), 'late status' => conById($late)['status']];
    return $r1['ok'] === false && $res['due notices'] === 1 && $res['overdue notices'] === 1 && $res['late status'] === 'overdue' && inv() === '' ? true : json_encode($res + ['inv' => inv()]);
});

check('defect D12 — a 토스 cancel webhook that fails half-way (the refund cannot be written) is not "already seen" on the retry: the retry records the refund, exactly once', function () use ($ADM, $fresh, $IS_MYSQL) {
    Tfm\Allot::saveSettings($ADM, ['toss_enabled' => true]);
    $u = newUser();
    $a = Tfm\Allot::apply($u, $fresh('A1'), form());
    $p = Tfm\Allot::payPrepare($u, $a['contractNo']);
    Tfm\Allot::payConfirm($u, 'mock_' . $p['orderId'], $p['orderId'], $p['amount']);
    $hook = ['eventType' => 'PAYMENT_STATUS_CHANGED', 'data' => ['paymentKey' => 'mock_' . $p['orderId'], 'orderId' => $p['orderId'], 'status' => 'CANCELED']];
    // the refund row cannot be written (a crash, a full disk): a trigger refuses it
    if ($IS_MYSQL) Tfm\Db::exec("CREATE TRIGGER atk_norefund BEFORE INSERT ON allot_payments FOR EACH ROW BEGIN IF NEW.kind = 'refund' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'disk full'; END IF; END");
    else Tfm\Db::exec("CREATE TRIGGER atk_norefund BEFORE INSERT ON allot_payments WHEN NEW.kind = 'refund' BEGIN SELECT RAISE(ABORT, 'disk full'); END");
    $first = '';
    try { $first = json_encode(Tfm\Allot::webhook($hook)); } catch (Throwable $e) { $first = 'threw ' . get_class($e); } finally { Tfm\Db::exec('DROP TRIGGER atk_norefund'); }
    $retry = Tfm\Allot::webhook($hook);
    $again = Tfm\Allot::webhook($hook);
    $st = (string) Tfm\Db::value('SELECT status FROM allot_payments WHERE order_id = ?', [$p['orderId']]);
    $refunds = (int) Tfm\Db::value("SELECT COUNT(*) FROM allot_payments WHERE contract_id = ? AND kind = 'refund'", [(int) conRow($a['contractNo'])['id']]);
    Tfm\Allot::saveSettings($ADM, ['toss_enabled' => false]);
    return $st === 'refunded' && $refunds === 1 && ($retry['refunded'] ?? null) === true && ($again['ignored'] ?? null) === true && inv() === '' ? true
        : json_encode(['first' => $first, 'retry' => $retry, 'again' => $again, 'payment' => $st, 'refund rows' => $refunds, 'inv' => inv()]);
});

// SECTION-MARK (the next sections are appended above this line)

echo PHP_EOL . "allot-attack: $passed passed, $failed failed" . ($skipped ? ", $skipped skipped" : '') . ' (' . Tfm\Db::driverSafe() . ')' . PHP_EOL;
exit($failed ? 1 : 0);
