<?php
/**
 * tests/phase7-unit.php — unit checks for the phase-7 server libraries (CONTRACT §15) that need no web server:
 * a throw-away SQLite database in the temp dir. Each owner appends its own section.
 *
 *   php tests/phase7-unit.php                                   prints PASS/FAIL per check, exits 1 when one fails
 *   node tools/tdd-report.mjs tests/phase7-unit.php -- php tests/phase7-unit.php     same + records for tdd-guard
 *
 * Every check runs inside its own try/catch: a missing class / method is reported as that check's FAIL (with the
 * error message) instead of ending the whole run, so one run shows every behaviour that is still missing.
 * CLI only; never deployed (tests/ is not part of the web root). Developer tooling: runs on the dev PHP (8.x).
 */
declare(strict_types=1);

if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
$tmp = sys_get_temp_dir() . '/tfm-p7-' . bin2hex(random_bytes(6));
mkdir($tmp, 0700, true);
putenv("TFM_DATA_DIR=$tmp");
require __DIR__ . '/../server/lib/bootstrap.php';

$failed = 0;
/** $test returns true (pass), false or a string (fail + detail); a thrown error is a fail with its message */
function check(string $name, callable $test): void
{
    global $failed;
    try {
        $r = $test();
        $ok = $r === true;
        $detail = is_string($r) ? $r : ($ok ? '' : 'assertion is false');
    } catch (Throwable $e) {
        $ok = false;
        $detail = get_class($e) . ': ' . $e->getMessage();
    }
    if (!$ok) $failed++;
    echo ($ok ? "PASS  " : "FAIL  ") . $name . ($ok || $detail === '' ? '' : "  — $detail") . PHP_EOL;
}
/** did $fn throw an ApiException with $code */
function throwsApi(callable $fn, string $code): bool
{
    try { $fn(); } catch (Tfm\ApiException $e) { return $e->errorCode === $code; }
    return false;
}

Tfm\Db::pdo(); // creates the schema (v6)

// ------------------------------------------------------------------ Settings (operator settings in the DB, config fallback)
check('Settings::get — no row: falls back to the config value at the same path', function () {
    return (float) Tfm\Settings::get('farm.rt_scale', 0) === (float) Tfm\Config::get('farm.rt_scale', 1.0);
});
check('Settings::get — unknown key: returns the given default', function () {
    return Tfm\Settings::get('nope.nothing', 'dflt') === 'dflt';
});
check('Settings::set — stored value wins over the config default', function () {
    Tfm\Settings::set('farm.rt_scale', '60', null);
    return (float) Tfm\Settings::get('farm.rt_scale') === 60.0;
});
check('Settings::has — true after set, false for a key that was never stored', function () {
    return Tfm\Settings::has('farm.rt_scale') === true && Tfm\Settings::has('security.notice') === false;
});
check('Settings::reset — the value survives a cache reset (it is in the database)', function () {
    Tfm\Settings::reset();
    return (float) Tfm\Settings::get('farm.rt_scale') === 60.0;
});
check('Settings::set — out-of-range number is refused (INVALID_SETTING)', function () {
    return throwsApi(function () { Tfm\Settings::set('farm.rt_scale', 99999, null); }, 'INVALID_SETTING');
});
check('Settings::set — not-a-number is refused and nothing is stored', function () {
    $refused = throwsApi(function () { Tfm\Settings::set('farm.rt_scale', '1; DROP TABLE users', null); }, 'INVALID_SETTING');
    return $refused && (float) Tfm\Settings::get('farm.rt_scale') === 60.0;
});
check('Settings::set — unknown key is refused (no arbitrary rows, no secrets in the table)', function () {
    return throwsApi(function () { Tfm\Settings::set('toss.secret_key', 'x', null); }, 'INVALID_SETTING');
});
check('Settings::set — bool accepts on / 1 / true and 0 / off', function () {
    Tfm\Settings::set('ai.kid_helper', 'on', null);
    $on = Tfm\Settings::get('ai.kid_helper') === true;
    Tfm\Settings::set('ai.kid_helper', '0', null);
    return $on && Tfm\Settings::get('ai.kid_helper') === false;
});
check('Settings::set — every change is in the audit log', function () {
    $n = (int) Tfm\Db::value("SELECT COUNT(*) FROM audit_log WHERE event = 'setting_changed'");
    return $n === 3 ? true : "rows=$n";
});

// ------------------------------------------------------------------ (owners append their sections above this line)
echo PHP_EOL . ($failed === 0 ? "✔ all phase-7 unit checks passed" : "✖ $failed check(s) failed") . PHP_EOL;
exit($failed === 0 ? 0 : 1);
