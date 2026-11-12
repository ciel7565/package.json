<?php
/**
 * tests/security-unit.php — unit checks for the phase-7 security lock-down (CONTRACT §15.7), request-pipeline half:
 * Validator (V), SecEvent / Firewall, HTTPS + CORS policy, security headers, session rules, upload pipeline,
 * rate-limit table, production lock for debug switches, ConfigAudit, the security CLI handlers.
 * No web server: a throw-away SQLite database in the temp dir (the request-level checks live in tests/security-e2e.mjs).
 *
 *   php tests/security-unit.php                 prints PASS/FAIL per check, exits 1 when one fails
 *   php tests/security-unit.php --only=V::      run only the checks whose name contains the text
 *
 * Every check runs inside its own try/catch: a missing class / method is that check's FAIL (with the error message)
 * instead of the end of the run, so one run lists every behaviour that is still missing.
 * CLI only; never deployed (tests/ is not part of the web root). Developer tooling: runs on the dev PHP (8.x).
 */
declare(strict_types=1);

if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
$tmp = sys_get_temp_dir() . '/tfm-sec-' . bin2hex(random_bytes(6));
mkdir($tmp, 0700, true);
putenv("TFM_DATA_DIR=$tmp");
putenv("TFM_UPLOAD_DIR=$tmp/uploads");
require __DIR__ . '/../server/lib/bootstrap.php';

$failed = 0;
$ran = 0;
$only = '';
foreach (array_slice($argv, 1) as $a) { if (strpos($a, '--only=') === 0) $only = substr($a, 7); }
/** $test returns true (pass), false or a string (fail + detail); a thrown error is a fail with its message */
function check(string $name, callable $test): void
{
    global $failed, $ran, $only;
    if ($only !== '' && stripos($name, $only) === false) return;
    $ran++;
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
/** the ApiException $fn throws (null when it does not throw one) */
function apiError(callable $fn): ?Tfm\ApiException
{
    try { $fn(); } catch (Tfm\ApiException $e) { return $e; }
    return null;
}
/** run $fn with $_SERVER entries replaced, then restore them (and the per-request caches of Http) */
function withServer(array $server, callable $fn)
{
    $keep = $_SERVER;
    foreach ($server as $k => $v) { if ($v === null) unset($_SERVER[$k]); else $_SERVER[$k] = $v; }
    if (method_exists('Tfm\Http', 'resetRequestCache')) Tfm\Http::resetRequestCache();
    try { return $fn(); }
    finally {
        $_SERVER = $keep;
        if (method_exists('Tfm\Http', 'resetRequestCache')) Tfm\Http::resetRequestCache();
    }
}

Tfm\Db::pdo(); // creates the schema (v6)

// ================================================================== #3 server-side validation — Tfm\V (lib/Validator.php)
check('V::str — returns the string unchanged when it fits', function () {
    return Tfm\V::str('발효 abc', 'memo', 20) === '발효 abc';
});
check('V::str — counts characters, not bytes (Korean)', function () {
    return Tfm\V::str('가나다라마', 'nick', 5) === '가나다라마' && throwsApi(function () { Tfm\V::str('가나다라마바', 'nick', 5); }, 'INVALID_INPUT');
});
check('V::str — array / number / bool / null are refused (INVALID_INPUT, never a type error)', function () {
    foreach ([['a'], 12, 1.5, true, null, new stdClass()] as $bad) {
        if (!throwsApi(function () use ($bad) { Tfm\V::str($bad, 'text', 10); }, 'INVALID_INPUT')) return 'accepted ' . gettype($bad);
    }
    return true;
});
check('V::str — shorter than min is refused', function () {
    return throwsApi(function () { Tfm\V::str('a', 'password', 64, 8); }, 'INVALID_INPUT') && Tfm\V::str('', 'memo', 10) === '';
});
check('V::str — NUL bytes and invalid UTF-8 are refused', function () {
    return throwsApi(function () { Tfm\V::str("ab\0cd", 'text', 10); }, 'INVALID_INPUT')
        && throwsApi(function () { Tfm\V::str("\xff\xfe\xfa", 'text', 10); }, 'INVALID_INPUT');
});
check('V — every failure is 400 INVALID_INPUT with a Korean message naming the field and data.field', function () {
    $e = apiError(function () { Tfm\V::int('x', 'tier', 2, 4); });
    if (!$e) return 'no exception';
    return $e->status === 400 && $e->errorCode === 'INVALID_INPUT' && is_array($e->data) && $e->data['field'] === 'tier'
        && strpos($e->getMessage(), 'tier') !== false && preg_match('/[\x{AC00}-\x{D7A3}]/u', $e->getMessage()) === 1
        ? true : $e->status . ' ' . $e->errorCode . ' ' . $e->getMessage();
});
check('V::int — integers and canonical digit strings (query parameters) are accepted', function () {
    return Tfm\V::int(3, 'tier', 2, 4) === 3 && Tfm\V::int('60', 'limit', 1, 100) === 60 && Tfm\V::int('-5', 'dx', -10, 10) === -5 && Tfm\V::int(0, 'after', 0, 10) === 0;
});
check('V::int — out of range, floats, exponent / hex / padded strings, bools, arrays are refused', function () {
    foreach ([5, 1, 2.5, '3.0', '1e2', '0x10', ' 3', '3 ', '+3', '', '03', true, [3], null, '99999999999999999999999'] as $bad) {
        if (!throwsApi(function () use ($bad) { Tfm\V::int($bad, 'tier', 2, 4); }, 'INVALID_INPUT')) return 'accepted ' . var_export($bad, true);
    }
    return true;
});
check('V::num — finite numbers inside the range', function () {
    return Tfm\V::num(1.5, 'x', -400, 400) === 1.5 && Tfm\V::num(7, 'x', -400, 400) === 7.0;
});
check('V::num — out of range, INF / NAN, strings, bools, arrays are refused', function () {
    foreach ([401, -400.01, INF, -INF, NAN, '1.5', true, [1], null] as $bad) {
        if (!throwsApi(function () use ($bad) { Tfm\V::num($bad, 'x', -400, 400); }, 'INVALID_INPUT')) return 'accepted ' . var_export($bad, true);
    }
    return true;
});
check('V::bool — only real booleans', function () {
    if (Tfm\V::bool(true, 'agree') !== true || Tfm\V::bool(false, 'remember') !== false) return 'bools';
    foreach ([1, 0, 'true', 'on', '', null, [true]] as $bad) {
        if (!throwsApi(function () use ($bad) { Tfm\V::bool($bad, 'agree'); }, 'INVALID_INPUT')) return 'accepted ' . var_export($bad, true);
    }
    return true;
});
check('V::enum — strict membership (no type juggling)', function () {
    if (Tfm\V::enum('local', 'channel', ['all', 'local']) !== 'local' || Tfm\V::enum(3, 'tier', [2, 3, 4]) !== 3) return 'members';
    foreach (['LOCAL', 'all ', 0, '3', true, null, ['all']] as $bad) {
        if (!throwsApi(function () use ($bad) { Tfm\V::enum($bad, 'channel', ['all', 'local', 3]); }, 'INVALID_INPUT')) return 'accepted ' . var_export($bad, true);
    }
    return true;
});
check('V::hex — exact length, hex only, returned in lower case', function () {
    if (Tfm\V::hex('ABCDEF0123456789abcdef0123456789', 'id', 32) !== 'abcdef0123456789abcdef0123456789') return 'case';
    foreach (['abc', str_repeat('g', 32), str_repeat('a', 33), 12345678, null, [str_repeat('a', 32)]] as $bad) {
        if (!throwsApi(function () use ($bad) { Tfm\V::hex($bad, 'id', 32); }, 'INVALID_INPUT')) return 'accepted ' . var_export($bad, true);
    }
    return true;
});
check('V::id — positive integer ids (number or digit string)', function () {
    if (Tfm\V::id(7, 'userId') !== 7 || Tfm\V::id('123', 'userId') !== 123) return 'ids';
    foreach ([0, -1, '0', '1 OR 1=1', '1.0', 1.5, '', null, [1], true, '99999999999999999999'] as $bad) {
        if (!throwsApi(function () use ($bad) { Tfm\V::id($bad, 'userId'); }, 'INVALID_INPUT')) return 'accepted ' . var_export($bad, true);
    }
    return true;
});
check('V::arr — arrays up to maxItems', function () {
    if (Tfm\V::arr([1, 2], 'items', 2) !== [1, 2] || Tfm\V::arr(['a' => 1], 'obj', 4) !== ['a' => 1]) return 'arrays';
    foreach ([[1, 2, 3], 'x', 1, null, true] as $bad) {
        if (!throwsApi(function () use ($bad) { Tfm\V::arr($bad, 'items', 2); }, 'INVALID_INPUT')) return 'accepted ' . var_export($bad, true);
    }
    return true;
});
check('V::keys — unknown keys of a request body are refused (unknown shapes), known ones pass', function () {
    Tfm\V::keys(['text' => 'a', 'channel' => 'all'], ['text', 'channel']);
    Tfm\V::keys([], ['text']);
    $e = apiError(function () { Tfm\V::keys(['text' => 'a', 'isAdmin' => true], ['text', 'channel']); });
    return $e && $e->errorCode === 'INVALID_INPUT' && $e->data['field'] === 'isAdmin';
});
check('V::keys — a list (JSON array) where an object is expected is refused', function () {
    return throwsApi(function () { Tfm\V::keys(['a', 'b'], ['text']); }, 'INVALID_INPUT');
});
check('V::query — one string per query parameter; arrays (?after[]=1) are refused, missing gives the default', function () {
    $_GET = ['after' => '12', 'bad' => ['1']];
    try {
        if (Tfm\V::query('after') !== '12' || Tfm\V::query('nope') !== null || Tfm\V::query('nope', '0') !== '0') return 'values';
        return throwsApi(function () { Tfm\V::query('bad'); }, 'INVALID_INPUT');
    } finally { $_GET = []; }
});
check('V::probe — obvious SQL injection strings', function () {
    foreach (["' OR '1'='1", "1' or 1=1 --", 'x UNION SELECT password FROM users', "1; DROP TABLE users", "admin'--", 'id=1 AND SLEEP(5)', "1' WAITFOR DELAY '0:0:5'", '1 union all select null,null'] as $s) {
        if (Tfm\V::probe($s) !== 'probe_sqli') return 'missed: ' . $s . ' → ' . var_export(Tfm\V::probe($s), true);
    }
    return true;
});
check('V::probe — obvious XSS strings', function () {
    foreach (['<script>alert(1)</script>', '<img src=x onerror=alert(1)>', '<svg/onload=alert(1)>', 'javascript:alert(document.cookie)', '"><iframe src=//evil.example>', '<body onload=x()>', '<a href="javascript:void(0)">'] as $s) {
        if (Tfm\V::probe($s) !== 'probe_xss') return 'missed: ' . $s . ' → ' . var_export(Tfm\V::probe($s), true);
    }
    return true;
});
check('V::probe — obvious path traversal strings', function () {
    foreach (['../../etc/passwd', '..\\..\\windows\\win.ini', '/etc/passwd', '..%2f..%2fconfig', 'php://filter/convert.base64-encode/resource=index', "file\0.png", '....//....//etc/hosts'] as $s) {
        if (Tfm\V::probe($s) !== 'probe_traversal') return 'missed: ' . json_encode($s) . ' → ' . var_export(Tfm\V::probe($s), true);
    }
    return true;
});
check('V::probe — ordinary kid sentences, e-mails, nicknames and numbers are not flagged', function () {
    foreach (['오늘 콩 3개 심었어요! 레벨 12 😊', 'kid@example.com', '발효왕_12', 'I select the union of beans and rice', '1 + 1 = 2', '사과 or 배?', 'a < b and b > c', '물 주기 -- 완료', '오이/가지/고추', 'https://example.com/a/b?x=1', '../', "it's ok", 'script 를 배웠어요', 'onerror', '..', 'drop the bean', '100% 완료'] as $s) {
        if (Tfm\V::probe($s) !== null) return 'false positive: ' . $s . ' → ' . Tfm\V::probe($s);
    }
    return true;
});

// ------------------------------------------------------------------ (sections are appended above this line)
echo PHP_EOL . ($failed === 0 ? "✔ all $ran security unit checks passed" : "✖ $failed of $ran check(s) failed") . PHP_EOL;
exit($failed === 0 ? 0 : 1);
