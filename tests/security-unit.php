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

// ================================================================== #5 suspicious activity — SecEvent + Firewall (lib/SecurityEvents.php)
/** a new simulated request from $ip: per-request caches are forgotten */
function asIp(string $ip, callable $fn, array $more = [])
{
    return withServer(['REMOTE_ADDR' => $ip, 'REQUEST_METHOD' => 'POST', 'SCRIPT_NAME' => '/api/auth/login.php', 'HTTP_HOST' => 'play.example.org', 'HTTP_X_FORWARDED_FOR' => null] + $more, function () use ($fn) {
        if (method_exists('Tfm\SecEvent', 'resetRequest')) Tfm\SecEvent::resetRequest();
        if (method_exists('Tfm\V', 'resetWatch')) Tfm\V::resetWatch();
        return $fn();
    });
}
function evCount(string $where = '1=1', array $p = []): int { return (int) Tfm\Db::value("SELECT COUNT(*) FROM security_events WHERE $where", $p); }
function wipeSec(): void { Tfm\Db::exec('DELETE FROM security_events'); Tfm\Db::exec('DELETE FROM ip_blocks'); Tfm\Db::exec("DELETE FROM rate_limits WHERE bucket LIKE 'secalert%'"); }

check('SecEvent::log — writes one security_events row (ms time, ip, ip_hash = Sec::hashId(ip), kind, severity, path, detail JSON)', function () {
    wipeSec();
    $t0 = Tfm\Clock::ms();
    asIp('203.0.113.7', function () { Tfm\SecEvent::log('csrf_fail', 'warn', ['why' => 'missing'], 42); });
    $r = Tfm\Db::one('SELECT * FROM security_events ORDER BY id DESC LIMIT 1');
    if (!$r) return 'no row';
    $d = json_decode((string) $r['detail'], true);
    return $r['kind'] === 'csrf_fail' && $r['severity'] === 'warn' && $r['ip'] === '203.0.113.7' && $r['ip_hash'] === Tfm\Sec::hashId('203.0.113.7')
        && (int) $r['user_id'] === 42 && (int) $r['created_at'] >= $t0 && $r['path'] === 'api/auth/login.php' && is_array($d) && $d['why'] === 'missing'
        ? true : json_encode($r);
});
check('SecEvent::log — default severity is warn; an unknown severity becomes warn; a long kind is cut to 40 characters', function () {
    wipeSec();
    asIp('203.0.113.7', function () { Tfm\SecEvent::log('honeypot'); Tfm\SecEvent::log('probe_xss', 'loud'); Tfm\SecEvent::log(str_repeat('k', 90), 'info'); });
    $rows = Tfm\Db::all('SELECT kind, severity FROM security_events ORDER BY id');
    return count($rows) === 3 && $rows[0]['severity'] === 'warn' && $rows[1]['severity'] === 'warn' && strlen($rows[2]['kind']) === 40 && $rows[2]['severity'] === 'info' ? true : json_encode($rows);
});
check('SecEvent::log — never throws (unencodable detail, missing table) and never stores raw markup in detail', function () {
    wipeSec();
    asIp('203.0.113.7', function () {
        Tfm\SecEvent::log('probe_xss', 'warn', ['sample' => '<script>alert(1)</script>', 'bin' => "\xff\xfe", 'deep' => ['a' => ['b' => ['c' => str_repeat('x', 9000)]]]]);
    });
    $raw = (string) Tfm\Db::value('SELECT detail FROM security_events ORDER BY id DESC LIMIT 1');
    if ($raw === '' || strpos($raw, '<') !== false || strpos($raw, '>') !== false) return 'raw markup in the stored JSON: ' . substr($raw, 0, 80);
    if (strlen($raw) > 4000) return 'detail not bounded: ' . strlen($raw);
    $d = json_decode($raw, true);
    if (!is_array($d) || $d['sample'] !== '<script>alert(1)</script>') return 'decoded value changed';
    Tfm\Db::exec('ALTER TABLE security_events RENAME TO security_events_gone');
    try { asIp('203.0.113.7', function () { Tfm\SecEvent::log('honeypot', 'warn', ['x' => 1]); }); }
    finally { Tfm\Db::exec('ALTER TABLE security_events_gone RENAME TO security_events'); }
    return true;
});
check('SecEvent::log — the event also reaches the file log (data/logs)', function () use ($tmp) {
    asIp('203.0.113.7', function () { Tfm\SecEvent::log('honeypot', 'warn', ['marker' => 'filelog-check']); });
    foreach (glob($tmp . '/logs/app-*.log.php') ?: [] as $f) { if (strpos((string) file_get_contents($f), 'filelog-check') !== false) return true; }
    return 'marker not in data/logs';
});
check('SecEvent::recent — newest first, filters kind / severity / ipHash / sinceMs, limit + offset', function () {
    wipeSec();
    asIp('203.0.113.7', function () { Tfm\SecEvent::log('csrf_fail', 'warn'); });
    asIp('203.0.113.8', function () { Tfm\SecEvent::log('honeypot', 'alert'); });
    asIp('203.0.113.8', function () { Tfm\SecEvent::log('honeypot', 'warn', ['n' => 2]); });
    $all = Tfm\SecEvent::recent([]);
    if (count($all) !== 3 || $all[0]['kind'] !== 'honeypot' || (int) $all[0]['id'] < (int) $all[2]['id']) return 'order';
    if (!is_string($all[0]['detail']) || !is_array($all[0]['detailData']) || $all[0]['detailData']['n'] !== 2) return 'detail / detailData';
    if (count(Tfm\SecEvent::recent(['kind' => 'honeypot'])) !== 2) return 'kind';
    if (count(Tfm\SecEvent::recent(['severity' => 'alert'])) !== 1) return 'severity';
    if (count(Tfm\SecEvent::recent(['ipHash' => Tfm\Sec::hashId('203.0.113.7')])) !== 1) return 'ipHash';
    if (count(Tfm\SecEvent::recent(['sinceMs' => Tfm\Clock::ms() + 5000])) !== 0) return 'sinceMs';
    if (count(Tfm\SecEvent::recent([], 2)) !== 2 || count(Tfm\SecEvent::recent([], 2, 2)) !== 1) return 'limit / offset';
    return count(Tfm\SecEvent::recent(['kind' => "x' OR '1'='1"])) === 0 ? true : 'filter value is not bound';
});
check('SecEvent::counts — kind → n since a time', function () {
    $c = Tfm\SecEvent::counts(0);
    return isset($c['honeypot'], $c['csrf_fail']) && $c['honeypot'] === 2 && $c['csrf_fail'] === 1 && Tfm\SecEvent::counts(Tfm\Clock::ms() + 5000) === [] ? true : json_encode($c);
});
check('SecEvent::cleanup — removes events older than security.events_days (90)', function () {
    Tfm\Db::exec('UPDATE security_events SET created_at = ? WHERE kind = ?', [Tfm\Clock::ms() - 91 * 86400000, 'csrf_fail']);
    $n = Tfm\SecEvent::cleanup();
    return $n === 1 && evCount() === 2 ? true : "deleted $n, left " . evCount();
});
check('SecEvent::log — a flood from one address stops being stored (security.events_per_minute)', function () {
    wipeSec();
    Tfm\Config::override('security.events_per_minute', 10);
    try { for ($i = 0; $i < 30; $i++) asIp('198.51.100.9', function () { Tfm\SecEvent::log('login_locked', 'info'); }); }
    finally { Tfm\Config::override('security.events_per_minute', null); }
    $n = evCount();
    return $n === 10 ? true : "stored $n";
});

check('Firewall::ipInList — IPv4 single addresses and CIDR ranges', function () {
    $l = ['203.0.113.7', '10.0.0.0/8', '192.168.1.0/24', '172.16.5.4/32'];
    foreach (['203.0.113.7', '10.255.1.2', '192.168.1.200', '172.16.5.4'] as $in) if (!Tfm\Firewall::ipInList($in, $l)) return "should match $in";
    foreach (['203.0.113.8', '11.0.0.1', '192.168.2.1', '172.16.5.5'] as $out) if (Tfm\Firewall::ipInList($out, $l)) return "should not match $out";
    return true;
});
check('Firewall::ipInList — IPv6 single addresses and CIDR ranges, IPv4-mapped addresses', function () {
    $l = ['2001:db8::1', '2001:db8:abcd::/48', '::1', '192.0.2.0/24'];
    foreach (['2001:db8::1', '2001:0db8:0000:0000:0000:0000:0000:0001', '2001:db8:abcd:12::9', '::1', '::ffff:192.0.2.5'] as $in) if (!Tfm\Firewall::ipInList($in, $l)) return "should match $in";
    foreach (['2001:db8::2', '2001:db8:abce::1', '::2', '::ffff:192.0.3.5'] as $out) if (Tfm\Firewall::ipInList($out, $l)) return "should not match $out";
    return true;
});
check('Firewall::ipInList — invalid entries, invalid addresses and impossible prefixes never match', function () {
    foreach (['', 'abc', '1.2.3', '999.1.1.1', "1.2.3.4\n"] as $bad) if (Tfm\Firewall::ipInList($bad, ['0.0.0.0/0', '::/0'])) return 'matched invalid address ' . json_encode($bad);
    return !Tfm\Firewall::ipInList('1.2.3.4', ['1.2.3.4/33', '1.2.3.4/-1', 'x/8', '', '1.2.3.4/', '1.2.3/8', ['1.2.3.4']])
        && Tfm\Firewall::ipInList('1.2.3.4', ['0.0.0.0/0']) && Tfm\Firewall::ipInList('2001:db8::5', ['::/0']) && !Tfm\Firewall::ipInList('1.2.3.4', ['::/0']);
});
check('Firewall::block → isBlocked, check() answers 403 IP_BLOCKED with Retry-After, other addresses pass', function () {
    wipeSec();
    Tfm\Firewall::block('198.51.100.20', 600, 'manual test', 1);
    if (!Tfm\Firewall::isBlocked('198.51.100.20') || Tfm\Firewall::isBlocked('198.51.100.21')) return 'isBlocked';
    $e = asIp('198.51.100.20', function () { return apiError(function () { Tfm\Firewall::check(); }); });
    if (!$e || $e->status !== 403 || $e->errorCode !== 'IP_BLOCKED') return 'check did not refuse';
    $ra = implode('|', $e->headers);
    if (!preg_match('/Retry-After: (\d+)/', $ra, $m) || (int) $m[1] < 590 || (int) $m[1] > 600) return 'Retry-After: ' . $ra;
    return asIp('198.51.100.21', function () { Tfm\Firewall::check(); return true; });
});
check('Firewall::check — counts hits and logs ip_blocked once at first (not once per request)', function () {
    for ($i = 0; $i < 6; $i++) asIp('198.51.100.20', function () { apiError(function () { Tfm\Firewall::check(); }); });
    $hits = (int) Tfm\Db::value('SELECT hits FROM ip_blocks WHERE ip_hash = ?', [Tfm\Sec::hashId('198.51.100.20')]);
    $ev = evCount("kind = 'ip_blocked'");
    return $hits === 7 && $ev === 1 ? true : "hits=$hits events=$ev";
});
check('Firewall::listBlocks — active blocks with ip, reason, until_at, hits, strikes', function () {
    $l = Tfm\Firewall::listBlocks();
    return count($l) === 1 && $l[0]['ip'] === '198.51.100.20' && $l[0]['reason'] === 'manual test' && (int) $l[0]['until_at'] > Tfm\Clock::ms() && (int) $l[0]['hits'] === 7 && (int) $l[0]['strikes'] >= 1 && (int) $l[0]['created_by'] === 1
        ? true : json_encode($l);
});
check('Firewall::unblock — by address and by hash; false when nothing was blocked', function () {
    if (Tfm\Firewall::unblock('198.51.100.99')) return 'unblocked a free address';
    if (!Tfm\Firewall::unblock('198.51.100.20', 1) || Tfm\Firewall::isBlocked('198.51.100.20')) return 'by address';
    Tfm\Firewall::block('2001:db8::77', 600, 'v6', null);
    if (!Tfm\Firewall::isBlocked('2001:0db8:0:0:0:0:0:77')) return 'IPv6 spelling';
    return Tfm\Firewall::unblock(Tfm\Sec::hashId('2001:db8::77')) && !Tfm\Firewall::isBlocked('2001:db8::77') && Tfm\Firewall::listBlocks() === [];
});
check('Firewall::block — an expired block no longer blocks; a bad address is INVALID_INPUT', function () {
    Tfm\Firewall::block('198.51.100.30', 600, 'short', null);
    Tfm\Db::exec('UPDATE ip_blocks SET until_at = ? WHERE ip = ?', [Tfm\Clock::ms() - 1000, '198.51.100.30']);
    if (Tfm\Firewall::isBlocked('198.51.100.30')) return 'expired block still active';
    asIp('198.51.100.30', function () { Tfm\Firewall::check(); });
    return throwsApi(function () { Tfm\Firewall::block('not-an-ip', 600, 'x', null); }, 'INVALID_INPUT')
        && throwsApi(function () { Tfm\Firewall::block('198.51.100.31', 0, 'x', null); }, 'INVALID_INPUT');
});
check('Firewall auto-block — 24 attack-like events do nothing, the 25th blocks the address for 1800 s', function () {
    wipeSec();
    for ($i = 0; $i < 24; $i++) asIp('198.51.100.40', function () { Tfm\SecEvent::log('csrf_fail', 'warn'); });
    if (Tfm\Firewall::isBlocked('198.51.100.40')) return 'blocked too early';
    asIp('198.51.100.40', function () { Tfm\SecEvent::log('probe_sqli', 'warn'); });
    $row = Tfm\Db::one('SELECT * FROM ip_blocks WHERE ip = ?', ['198.51.100.40']);
    if (!$row || !Tfm\Firewall::isBlocked('198.51.100.40')) return 'not blocked after 25';
    $secs = (int) round(((int) $row['until_at'] - Tfm\Clock::ms()) / 1000);
    return $secs >= 1795 && $secs <= 1800 && (int) $row['strikes'] === 1 && Tfm\Firewall::isBlocked('198.51.100.41') === false ? true : "secs=$secs strikes={$row['strikes']}";
});
check('Firewall auto-block — the block doubles per strike (3600 s, …) and is capped at 24 h', function () {
    $again = function () {
        Tfm\Db::exec('UPDATE ip_blocks SET until_at = ? WHERE ip = ?', [Tfm\Clock::ms() - 1000, '198.51.100.40']); // the block ran out
        Tfm\Db::exec('DELETE FROM security_events');
        for ($i = 0; $i < 25; $i++) asIp('198.51.100.40', function () { Tfm\SecEvent::log('honeypot', 'warn'); });
        $row = Tfm\Db::one('SELECT * FROM ip_blocks WHERE ip = ?', ['198.51.100.40']);
        return [(int) round(((int) $row['until_at'] - Tfm\Clock::ms()) / 1000), (int) $row['strikes']];
    };
    list($s2, $k2) = $again();
    if ($k2 !== 2 || $s2 < 3595 || $s2 > 3600) return "2nd strike: {$s2}s strikes=$k2";
    list($s3, $k3) = $again();
    if ($k3 !== 3 || $s3 < 7195 || $s3 > 7200) return "3rd strike: {$s3}s strikes=$k3";
    Tfm\Db::exec('UPDATE ip_blocks SET strikes = 12 WHERE ip = ?', ['198.51.100.40']);
    list($s, $k) = $again();
    return $k === 13 && $s >= 86395 && $s <= 86400 ? true : "cap: {$s}s strikes=$k";
});
check('Firewall auto-block — only attack-like kinds of severity warn / alert count (not login_locked, save_rejected, https_required, info events)', function () {
    wipeSec();
    for ($i = 0; $i < 40; $i++) asIp('198.51.100.50', function () use ($i) {
        Tfm\SecEvent::log(['login_locked', 'save_rejected', 'https_required', 'ip_blocked'][$i % 4], 'warn');
        Tfm\SecEvent::log('csrf_fail', 'info', ['stale' => true]);
        Tfm\SecEvent::log('upload_rejected', 'info', ['why' => 'type']);
    });
    return !Tfm\Firewall::isBlocked('198.51.100.50');
});
check('Firewall auto-block — events outside the window (600 s) do not count', function () {
    wipeSec();
    for ($i = 0; $i < 24; $i++) asIp('198.51.100.60', function () { Tfm\SecEvent::log('honeypot', 'warn'); });
    Tfm\Db::exec('UPDATE security_events SET created_at = created_at - 601000');
    asIp('198.51.100.60', function () { Tfm\SecEvent::log('honeypot', 'warn'); });
    return !Tfm\Firewall::isBlocked('198.51.100.60');
});
check('Firewall auto-block — localhost and security.block.exempt entries are never blocked automatically', function () {
    wipeSec();
    Tfm\Config::override('security.block.exempt', ['198.51.100.0/28', '2001:db8:5::/64']);
    try {
        foreach (['127.0.0.1', '::1', '198.51.100.3', '2001:db8:5::9'] as $ip) {
            for ($i = 0; $i < 30; $i++) asIp($ip, function () { Tfm\SecEvent::log('honeypot', 'warn'); }, ['HTTP_HOST' => 'localhost']);
            if (Tfm\Firewall::isBlocked($ip)) return "$ip was blocked";
        }
        for ($i = 0; $i < 30; $i++) asIp('198.51.100.77', function () { Tfm\SecEvent::log('honeypot', 'warn'); });
        return Tfm\Firewall::isBlocked('198.51.100.77') ? true : 'a non-exempt address was not blocked';
    } finally { Tfm\Config::override('security.block.exempt', null); }
});
check('Firewall::noteAttack — records the attack itself when no event was logged; log + noteAttack in one request is one row', function () {
    wipeSec();
    asIp('198.51.100.80', function () { Tfm\Firewall::noteAttack('honeypot'); });
    if (evCount("kind = 'honeypot'") !== 1) return 'noteAttack alone: ' . evCount() . ' rows';
    asIp('198.51.100.80', function () { Tfm\SecEvent::log('honeypot', 'warn', ['uri' => '/.env']); Tfm\Firewall::noteAttack('honeypot'); Tfm\Firewall::noteAttack('honeypot'); });
    if (evCount("kind = 'honeypot'") !== 2) return 'log + noteAttack: ' . evCount() . ' rows';
    for ($i = 0; $i < 23; $i++) asIp('198.51.100.80', function () { Tfm\Firewall::noteAttack('admin_denied'); });
    return Tfm\Firewall::isBlocked('198.51.100.80') ? true : 'noteAttack ×25 did not block';
});
check('Firewall::noteAttack — a kind that is not attack-like is ignored; thresholds come from security.block.*', function () {
    wipeSec();
    for ($i = 0; $i < 30; $i++) asIp('198.51.100.90', function () { Tfm\Firewall::noteAttack('login_locked'); });
    if (Tfm\Firewall::isBlocked('198.51.100.90')) return 'login_locked blocked the address';
    Tfm\Config::override('security.block', ['threshold' => 3, 'window' => 600, 'duration' => 60, 'exempt' => []]);
    try { for ($i = 0; $i < 3; $i++) asIp('198.51.100.91', function () { Tfm\Firewall::noteAttack('payment_tamper'); }); }
    finally { Tfm\Config::override('security.block', null); }
    $row = Tfm\Db::one('SELECT * FROM ip_blocks WHERE ip = ?', ['198.51.100.91']);
    $secs = $row ? (int) round(((int) $row['until_at'] - Tfm\Clock::ms()) / 1000) : -1;
    return $secs >= 55 && $secs <= 60 ? true : "secs=$secs";
});
check('Firewall auto-block — the block itself is one alert event and one audit line', function () {
    $a = evCount("kind = 'auto_block' AND severity = 'alert'");
    $b = (int) Tfm\Db::value("SELECT COUNT(*) FROM audit_log WHERE event = 'ip_auto_blocked'");
    return $a === 1 && $b >= 1 ? true : "auto_block events=$a audit=$b";
});
check('Firewall::check — never breaks a request when the block table is missing (fails open)', function () {
    Tfm\Db::exec('ALTER TABLE ip_blocks RENAME TO ip_blocks_gone');
    try { asIp('198.51.100.91', function () { Tfm\Firewall::check(); }); return Tfm\Firewall::isBlocked('198.51.100.91') === false; }
    finally { Tfm\Db::exec('ALTER TABLE ip_blocks_gone RENAME TO ip_blocks'); }
});
check('SecEvent alerts — off by default; the webhook must be https and is never taken from the request', function () {
    if (Tfm\Config::get('security.alert_email', 'x') !== '' || Tfm\Config::get('security.alert_webhook', 'x') !== '') return 'alerts are not off by default';
    return Tfm\SecEvent::alertTargets() === ['email' => '', 'webhook' => '']
        && Tfm\SecEvent::alertTargets(['alert_email' => "ops@example.org\r\nBcc: x@evil.example", 'alert_webhook' => 'http://hooks.example.org/x']) === ['email' => '', 'webhook' => '']
        && Tfm\SecEvent::alertTargets(['alert_email' => 'ops@example.org', 'alert_webhook' => 'https://hooks.example.org/x?y=1']) === ['email' => 'ops@example.org', 'webhook' => 'https://hooks.example.org/x?y=1'];
});

// ================================================================== #2 HTTPS forced — Tfm\Http (lib/Core.php)
check('Http::forceHttpsMode — auto by default; on / off honoured; unknown falls back to auto', function () {
    $modes = [];
    foreach (['auto' => 'auto', 'on' => 'on', 'off' => 'off', 'weird' => 'auto', '' => 'auto'] as $set => $want) {
        Tfm\Config::override('security.force_https', $set === '' ? null : $set);
        $modes[$set] = Tfm\Http::forceHttpsMode();
    }
    Tfm\Config::override('security.force_https', null);
    return $modes === ['auto' => 'auto', 'on' => 'on', 'off' => 'off', 'weird' => 'auto', '' => 'auto'] ? true : json_encode($modes);
});
check('Http::httpsRequired — auto: a localhost request is exempt, a public host is required; off: never; on: always', function () {
    $r = function (array $server) { return withServer($server, function () { return Tfm\Http::httpsRequired(); }); };
    Tfm\Config::override('security.force_https', 'auto');
    $localhost = $r(['REMOTE_ADDR' => '127.0.0.1', 'HTTP_HOST' => '127.0.0.1:8080', 'HTTPS' => null]);
    $public = $r(['REMOTE_ADDR' => '127.0.0.1', 'HTTP_HOST' => 'play.example.test', 'HTTPS' => null]);
    Tfm\Config::override('security.force_https', 'off');
    $off = $r(['REMOTE_ADDR' => '203.0.113.9', 'HTTP_HOST' => 'play.example.test', 'HTTPS' => null]);
    Tfm\Config::override('security.force_https', 'on');
    $on = $r(['REMOTE_ADDR' => '127.0.0.1', 'HTTP_HOST' => '127.0.0.1', 'HTTPS' => null]);
    Tfm\Config::override('security.force_https', null);
    return (!$localhost && $public && !$off && $on) ? true : "localhost=$localhost public=$public off=$off on=$on";
});
check('Http::isLoopbackRequest — ignores a spoofed X-Forwarded-Proto when no proxy is configured', function () {
    return withServer(['REMOTE_ADDR' => '127.0.0.1', 'HTTP_HOST' => 'localhost', 'HTTP_X_FORWARDED_PROTO' => 'https', 'HTTPS' => null], function () {
        return Tfm\Http::isLoopbackRequest() === true;
    });
});

// ================================================================== #10 CORS — Tfm\Http::corsAllowedOrigins
check('Http::corsAllowedOrigins — exact scheme://host[:port] only; "*" and malformed entries dropped', function () {
    Tfm\Config::override('security.cors_allowed_origins', ['https://allowed.test', 'https://ok.test:8443', '*', 'http://x', 'not a url', 'https://a b.test']);
    $out = Tfm\Http::corsAllowedOrigins();
    Tfm\Config::override('security.cors_allowed_origins', null);
    return $out === ['https://allowed.test', 'https://ok.test:8443', 'http://x'] ? true : json_encode($out);
});

// ================================================================== #16 production lock — Tfm\Config
check('Config production lock — on a non-local production host, mock / admin_bypass are forced off; rawGet keeps the written value', function () {
    Tfm\Config::override('app.env', 'production');
    Tfm\Config::override('toss.mock', true);
    Tfm\Config::override('anthropic.mock', true);
    Tfm\Config::override('save.admin_bypass', true);
    try {
        $public = withServer(['REMOTE_ADDR' => '203.0.113.9', 'HTTP_HOST' => 'play.example.test', 'REQUEST_METHOD' => 'GET'], function () {
            return [Tfm\Config::get('toss.mock'), Tfm\Config::get('anthropic.mock'), Tfm\Config::get('save.admin_bypass'), Tfm\Config::rawGet('toss.mock')];
        });
        // a request from the server machine itself keeps the mock (local demos)
        $local = withServer(['REMOTE_ADDR' => '127.0.0.1', 'HTTP_HOST' => 'localhost', 'REQUEST_METHOD' => 'GET'], function () {
            return Tfm\Config::get('toss.mock');
        });
    } finally {
        foreach (['app.env', 'toss.mock', 'anthropic.mock', 'save.admin_bypass'] as $k) Tfm\Config::override($k, null);
    }
    return ($public === [false, false, false, true] && $local === true) ? true : json_encode(['public' => $public, 'local' => $local]);
});
check('Config production lock — development env is never locked', function () {
    Tfm\Config::override('app.env', 'development');
    Tfm\Config::override('toss.mock', true);
    try {
        $v = withServer(['REMOTE_ADDR' => '203.0.113.9', 'HTTP_HOST' => 'play.example.test', 'REQUEST_METHOD' => 'GET'], function () { return Tfm\Config::get('toss.mock'); });
    } finally { Tfm\Config::override('app.env', null); Tfm\Config::override('toss.mock', null); }
    return $v === true ? true : 'development was locked';
});

// ================================================================== #8 ConfigAudit (lib/ConfigAudit.php)
check('ConfigAudit::run — returns rows {id,label,status,value,hint}; status is ok|warn|fail; never a secret value', function () {
    $rows = Tfm\ConfigAudit::run();
    if (!is_array($rows) || !$rows) return 'no rows';
    foreach ($rows as $r) {
        foreach (['id', 'label', 'status', 'value', 'hint'] as $k) if (!array_key_exists($k, $r)) return "row missing $k";
        if (!in_array($r['status'], ['ok', 'warn', 'fail'], true)) return 'bad status ' . $r['status'];
        if (!is_string($r['label']) || !is_string($r['hint'])) return 'label/hint not strings';
    }
    // the app key value must never appear verbatim in any row
    $key = Tfm\Config::secret('app_key');
    foreach ($rows as $r) if (is_string($r['value']) && strpos($r['value'], $key) !== false) return 'a row printed the app_key';
    return true;
});
check('ConfigAudit::run — admin_emails set → warn (F2); toss.mock on a non-local prod host → fail; root DB account → fail', function () {
    $find = function (array $rows, string $id) { foreach ($rows as $r) if ($r['id'] === $id) return $r; return null; };
    Tfm\Config::override('security.admin_emails', ['teacher@example.com']);
    Tfm\Config::override('app.env', 'production');
    Tfm\Config::override('toss.mock', true);
    Tfm\Config::override('db.driver', 'mysql');
    Tfm\Config::override('db.mysql', ['username' => 'root', 'password' => '']);
    try {
        $rows = withServer(['REMOTE_ADDR' => '203.0.113.9', 'HTTP_HOST' => 'play.example.test', 'REQUEST_METHOD' => 'GET'], function () { return Tfm\ConfigAudit::run(); });
    } finally {
        foreach (['security.admin_emails', 'app.env', 'toss.mock', 'db.driver', 'db.mysql'] as $k) Tfm\Config::override($k, null);
    }
    $emails = $find($rows, 'admin_emails');
    $mock = $find($rows, 'sw_toss_mock');
    $db = $find($rows, 'db_account');
    if (!$emails || $emails['status'] !== 'warn') return 'admin_emails not warned';
    if (!$mock || $mock['status'] !== 'fail') return 'toss.mock not failed on a prod host';
    if (!$db || $db['status'] !== 'fail') return 'root DB account not failed';
    return true;
});
check('ConfigAudit::run — on a development / local host the same switches are warn (not fail)', function () {
    Tfm\Config::override('app.env', 'development');
    Tfm\Config::override('toss.mock', true);
    try {
        $rows = withServer(['REMOTE_ADDR' => '127.0.0.1', 'HTTP_HOST' => 'localhost', 'REQUEST_METHOD' => 'GET'], function () { return Tfm\ConfigAudit::run(); });
    } finally { Tfm\Config::override('app.env', null); Tfm\Config::override('toss.mock', null); }
    foreach ($rows as $r) if ($r['id'] === 'sw_toss_mock') return $r['status'] === 'warn' ? true : 'status ' . $r['status'];
    return 'no toss.mock row';
});

// ================================================================== #12 Session::regenerate / #14 Upload::image exist
check('Session::regenerate — exists (admin elevation anti-fixation) and Upload::image — exists (reusable photo core)', function () {
    return method_exists('Tfm\Session', 'regenerate')
        && method_exists('Tfm\Upload', 'image')
        && method_exists('Tfm\Upload', 'journalPhoto')
        && method_exists('Tfm\Http', 'enforceHttps')
        && method_exists('Tfm\Http', 'cors')
        && method_exists('Tfm\Http', 'refuseUpload')
        && method_exists('Tfm\Firewall', 'guardPage');
});

// ------------------------------------------------------------------ (sections are appended above this line)
echo PHP_EOL . ($failed === 0 ? "✔ all $ran security unit checks passed" : "✖ $failed of $ran check(s) failed") . PHP_EOL;
exit($failed === 0 ? 0 : 1);
