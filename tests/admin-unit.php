<?php
/**
 * tests/admin-unit.php — unit checks for the admin path lock (CONTRACT §15.4, security item 6) that need no web server:
 *   Tfm\Totp       RFC 6238 codes (SHA-1, 30 s, 6 digits), base32, ±1 step window, replay floor, otpauth:// URI
 *   Tfm\AdminTotp  enrolment in admin_totp: sealed secret, confirmation, replay through last_step, one-time backup
 *                  codes stored as hashes, the wrong-code lock, reset
 *   Tfm\AdminGate  the IP allow-list matcher (IPv4 + IPv6, single address + CIDR), the plain 404 body
 *   Tfm\AdminPath  folder names, the folder that holds the admin entry
 *   Tfm\Health     the admin-lock rows of the system check
 *
 *   php tests/admin-unit.php                                              PASS/FAIL per check, exit 1 when one fails
 *   node tools/tdd-report.mjs tests/admin-unit.php -- php tests/admin-unit.php      same + records for tdd-guard
 *
 * A throw-away SQLite database in the temp dir. CLI only; never deployed. Runs on the dev PHP (8.x).
 */
declare(strict_types=1);

if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
$tmp = sys_get_temp_dir() . '/tfm-adm-' . bin2hex(random_bytes(6));
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

// RFC 6238 appendix B: the SHA-1 secret is the ASCII text "12345678901234567890"; 6 digits = the last 6 of the 8 listed
const RFC_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
const RFC_VECTORS = [59 => '287082', 1111111109 => '081804', 1111111111 => '050471', 1234567890 => '005924', 2000000000 => '279037', 20000000000 => '353130'];

// ------------------------------------------------------------------ Totp (RFC 6238)
check('Totp::code — the six RFC 6238 SHA-1 vectors (6 digits, 30 s steps, also beyond 2038)', function () {
    foreach (RFC_VECTORS as $t => $want) {
        $got = Tfm\Totp::code(RFC_SECRET, $t);
        if ($got !== $want) return "t=$t: got $got, want $want";
    }
    return true;
});
check('Totp::code — an unusable secret gives an empty code (never a guessable constant)', function () {
    return Tfm\Totp::code('not base32 !!', 59) === '' && Tfm\Totp::code('', 59) === '';
});
check('Totp::base32 — RFC 4648 vectors encode without padding and decode back', function () {
    foreach (['' => '', 'f' => 'MY', 'fo' => 'MZXQ', 'foo' => 'MZXW6', 'foob' => 'MZXW6YQ', 'fooba' => 'MZXW6YTB', 'foobar' => 'MZXW6YTBOI'] as $raw => $b32) {
        if (Tfm\Totp::base32Encode((string) $raw) !== $b32) return "encode($raw) = " . Tfm\Totp::base32Encode((string) $raw);
        if (Tfm\Totp::base32Decode($b32) !== (string) $raw) return "decode($b32)";
    }
    return true;
});
check('Totp::base32Decode — accepts lower case, spaces, dashes and = padding; refuses other characters', function () {
    return Tfm\Totp::base32Decode('mzxw 6ytb-oi======') === 'foobar' && Tfm\Totp::base32Decode('MZXW6YTB0I') === null && Tfm\Totp::base32Decode('MZ!W') === null;
});
check('Totp::secret — base32 of 20 random bytes (32 characters), different every time', function () {
    $a = Tfm\Totp::secret();
    $b = Tfm\Totp::secret();
    $raw = Tfm\Totp::base32Decode($a);
    return preg_match('/^[A-Z2-7]{32}$/', $a) === 1 && is_string($raw) && strlen($raw) === 20 && $a !== $b;
});
check('Totp::verify — the current code is accepted and reports its time step', function () {
    $step = 0;
    $ok = Tfm\Totp::verify(RFC_SECRET, '005924', $step, 1, 1234567890);
    return $ok === true && $step === intdiv(1234567890, 30) ? true : 'ok=' . var_export($ok, true) . " step=$step";
});
check('Totp::verify — one step of clock drift either way is accepted, two steps are not', function () {
    $prev = Tfm\Totp::code(RFC_SECRET, 1234567890 - 30);
    $next = Tfm\Totp::code(RFC_SECRET, 1234567890 + 30);
    $old = Tfm\Totp::code(RFC_SECRET, 1234567890 - 60);
    $s1 = 0; $s2 = 0; $s3 = 0; $s4 = 0;
    $a = Tfm\Totp::verify(RFC_SECRET, $prev, $s1, 1, 1234567890);
    $b = Tfm\Totp::verify(RFC_SECRET, $next, $s2, 1, 1234567890);
    $c = Tfm\Totp::verify(RFC_SECRET, $old, $s3, 1, 1234567890);
    $d = Tfm\Totp::verify(RFC_SECRET, $prev, $s4, 0, 1234567890); // window 0: only the current step
    $now = intdiv(1234567890, 30);
    return $a && $s1 === $now - 1 && $b && $s2 === $now + 1 && !$c && $s3 === 0 && !$d ? true : json_encode([$a, $s1, $b, $s2, $c, $s3, $d]);
});
check('Totp::verify — replay floor: a code at or before the last accepted step is refused, the next step works', function () {
    $t = 1234567890;
    $step = 0;
    $first = Tfm\Totp::verify(RFC_SECRET, Tfm\Totp::code(RFC_SECRET, $t), $step, 1, $t);
    $accepted = $step;
    $again = Tfm\Totp::verify(RFC_SECRET, Tfm\Totp::code(RFC_SECRET, $t), $step, 1, $t);          // the same code once more
    $older = Tfm\Totp::verify(RFC_SECRET, Tfm\Totp::code(RFC_SECRET, $t - 30), $step, 1, $t);     // an earlier step that is still inside the window
    $keeps = $step === $accepted;                                                                  // a refusal never moves the floor
    $next = Tfm\Totp::verify(RFC_SECRET, Tfm\Totp::code(RFC_SECRET, $t + 30), $step, 1, $t + 30);
    return $first && !$again && !$older && $keeps && $next && $step === $accepted + 1 ? true : json_encode([$first, $again, $older, $keeps, $next, $step, $accepted]);
});
check('Totp::verify — malformed input is refused (empty, 5 or 7 digits, letters); spaces between the digits are fine', function () {
    $t = 59;
    foreach (['', '28708', '2870820', 'abcdef', '28708a', "287082\n1", '-87082'] as $bad) {
        $s = 0;
        if (Tfm\Totp::verify(RFC_SECRET, $bad, $s, 1, $t)) return 'accepted ' . json_encode($bad);
    }
    $s = 0;
    return Tfm\Totp::verify(RFC_SECRET, ' 287 082 ', $s, 1, $t) === true;
});
check('Totp::verify — a wrong code and an unusable secret are refused', function () {
    $s = 0;
    $wrong = Tfm\Totp::verify(RFC_SECRET, '000000', $s, 1, 59);
    $s2 = 0;
    $bad = Tfm\Totp::verify('!!', Tfm\Totp::code('!!', 59), $s2, 1, 59);
    return !$wrong && !$bad && $s === 0;
});
check('Totp::uri — otpauth://totp/Issuer:account with secret, issuer, SHA1, 6 digits, 30 s (label percent-encoded)', function () {
    $u = Tfm\Totp::uri(RFC_SECRET, 'ad min@example.com', '전통발효체험관');
    $q = [];
    parse_str((string) parse_url($u, PHP_URL_QUERY), $q);
    $label = rawurlencode('전통발효체험관') . ':' . rawurlencode('ad min@example.com');
    return strpos($u, 'otpauth://totp/' . $label . '?') === 0 && !preg_match('/[\s<>"\']/', $u)
        && $q['secret'] === RFC_SECRET && $q['issuer'] === '전통발효체험관' && $q['algorithm'] === 'SHA1' && $q['digits'] === '6' && $q['period'] === '30' ? true : $u;
});
check('Totp::grouped — the secret in groups of four for reading it off the screen', function () {
    return Tfm\Totp::grouped(RFC_SECRET) === 'GEZD GNBV GY3T QOJQ GEZD GNBV GY3T QOJQ';
});

// ------------------------------------------------------------------ AdminGate: the IP allow-list matcher
check('AdminGate::cidrMatch — IPv4 single address', function () {
    return Tfm\AdminGate::cidrMatch('203.0.113.7', ['203.0.113.7']) && !Tfm\AdminGate::cidrMatch('203.0.113.8', ['203.0.113.7']) && Tfm\AdminGate::cidrMatch('203.0.113.7', ['198.51.100.1', ' 203.0.113.7 ']);
});
check('AdminGate::cidrMatch — IPv4 CIDR (/24, /8, /12 not on an octet border, /32, /0)', function () {
    $m = function (string $ip, string $rule): bool { return Tfm\AdminGate::cidrMatch($ip, [$rule]); };
    return $m('192.168.0.77', '192.168.0.0/24') && !$m('192.168.1.77', '192.168.0.0/24') && $m('10.1.2.3', '10.0.0.0/8') && !$m('11.1.2.3', '10.0.0.0/8')
        && $m('172.20.5.5', '172.16.0.0/12') && $m('172.31.255.255', '172.16.0.0/12') && !$m('172.32.0.1', '172.16.0.0/12')
        && $m('203.0.113.7', '203.0.113.7/32') && !$m('203.0.113.6', '203.0.113.7/32') && $m('8.8.8.8', '0.0.0.0/0');
});
check('AdminGate::cidrMatch — IPv6 single address (short and long spelling are the same address)', function () {
    return Tfm\AdminGate::cidrMatch('2001:db8::1', ['2001:0db8:0000:0000:0000:0000:0000:0001']) && Tfm\AdminGate::cidrMatch('::1', ['::1']) && !Tfm\AdminGate::cidrMatch('2001:db8::2', ['2001:db8::1']);
});
check('AdminGate::cidrMatch — IPv6 CIDR (/64, /128, /61 not on a byte border)', function () {
    $m = function (string $ip, string $rule): bool { return Tfm\AdminGate::cidrMatch($ip, [$rule]); };
    return $m('2001:db8:abcd:12::9', '2001:db8:abcd:12::/64') && !$m('2001:db8:abcd:13::9', '2001:db8:abcd:12::/64') && $m('::1', '::1/128') && !$m('::2', '::1/128')
        && $m('2001:db8:abcd:17::1', '2001:db8:abcd:10::/61') && !$m('2001:db8:abcd:18::1', '2001:db8:abcd:10::/61');
});
check('AdminGate::cidrMatch — an IPv4 address that arrives IPv6-mapped (::ffff:a.b.c.d) matches its IPv4 rule', function () {
    return Tfm\AdminGate::cidrMatch('::ffff:192.168.0.5', ['192.168.0.0/24']) && Tfm\AdminGate::cidrMatch('::ffff:203.0.113.7', ['203.0.113.7']) && !Tfm\AdminGate::cidrMatch('::ffff:192.168.9.5', ['192.168.0.0/24']);
});
check('AdminGate::cidrMatch — address families never match each other', function () {
    return !Tfm\AdminGate::cidrMatch('192.168.0.5', ['::/0']) && !Tfm\AdminGate::cidrMatch('2001:db8::1', ['0.0.0.0/0']);
});
check('AdminGate::cidrMatch — broken rules and broken addresses match nothing (and raise no warning)', function () {
    set_error_handler(function (int $no, string $msg) { throw new ErrorException($msg); });
    try {
        $bad = ['', 'abc', '10.0.0.0/33', '10.0.0.0/-1', '10.0.0.0/x', '10.0.0.0/', '::/129', '300.1.1.1', '1.2.3', '/24', '10.0.0.0/8/8', null, 12, ['10.0.0.0/8']];
        $r = Tfm\AdminGate::cidrMatch('10.0.0.1', $bad) || Tfm\AdminGate::cidrMatch('::1', $bad) || Tfm\AdminGate::cidrMatch('not-an-ip', ['0.0.0.0/0', '::/0']) || Tfm\AdminGate::cidrMatch('', ['0.0.0.0/0']);
    } finally { restore_error_handler(); }
    return $r === false;
});
check('AdminGate::ipAllowed — an empty allow-list lets every address in; a list only its members', function () {
    putenv('TFM_ADMIN_IPS');
    Tfm\Config::reset();
    $open = Tfm\AdminGate::ipAllowed('198.51.100.9');
    putenv('TFM_ADMIN_IPS=203.0.113.7, 192.168.0.0/24 ,2001:db8::/32');
    Tfm\Config::reset();
    $r = [Tfm\AdminGate::ipAllowed('203.0.113.7'), Tfm\AdminGate::ipAllowed('192.168.0.200'), Tfm\AdminGate::ipAllowed('2001:db8:1::5'), Tfm\AdminGate::ipAllowed('198.51.100.9'), Tfm\AdminGate::ipAllowed('127.0.0.1')];
    putenv('TFM_ADMIN_IPS');
    Tfm\Config::reset();
    return $open === true && $r === [true, true, true, false, false] ? true : json_encode([$open, $r]);
});
check('AdminGate::notFoundBody — a plain "404 Not Found" page that says nothing about an admin area', function () {
    $b = Tfm\AdminGate::notFoundBody();
    return stripos($b, '404 Not Found') !== false && stripos($b, 'admin') === false && strpos($b, '관리') === false && stripos($b, 'href') === false && stripos($b, '<script') === false;
});
check('server/admin.php — the old address is only a stub (marker, no page code, no redirect, no folder name)', function () {
    $src = (string) file_get_contents(TFM_ROOT . '/admin.php');
    return strpos($src, 'TFM-ADMIN-STUB') !== false && strlen($src) < 3000 && strpos($src, 'Session::') === false && stripos($src, 'Location') === false
        && strpos($src, "'admin/") === false && strpos($src, '"admin/') === false ? true : 'length ' . strlen($src);
});

// ------------------------------------------------------------------ AdminPath: the folder name is free
check('AdminPath::valid — 4 to 40 of a-z 0-9 -, starts and ends with a letter or digit', function () {
    foreach (['abcd', 'admin-1a2b3c4d5e', 'my-office-2026', str_repeat('a', 40)] as $ok) if (!Tfm\AdminPath::valid($ok)) return "refused $ok";
    foreach (['abc', str_repeat('a', 41), 'Admin', 'my_admin', 'a/bc', '../x', 'admin.php', '-abc', 'abc-', 'ab cd', "abcd\n", '관리자페이지', ''] as $bad) if (Tfm\AdminPath::valid($bad)) return 'accepted ' . json_encode($bad);
    return true;
});
check('AdminPath::random — "admin-" + 10 random hex characters, different every time', function () {
    $a = Tfm\AdminPath::random();
    return preg_match('/^admin-[0-9a-f]{10}$/', $a) === 1 && Tfm\AdminPath::valid($a) && $a !== Tfm\AdminPath::random();
});
check('AdminPath::dirName / relUrl — the folder that holds the admin entry (found by its marker, not by a fixed name)', function () {
    $d = Tfm\AdminPath::dirName();
    $entry = (string) file_get_contents(TFM_ROOT . '/' . $d . '/index.php');
    return $d !== '' && strpos($entry, Tfm\AdminPath::MARK) !== false && Tfm\AdminPath::relUrl() === $d . '/' ? true : "dir=$d";
});
check('AdminPath::extraFiles — what else lies in an admin folder besides index.php and .htaccess (an old admin.css, an editor copy, a folder)', function () {
    $d = sys_get_temp_dir() . '/tfm-admx-' . bin2hex(random_bytes(4));
    mkdir($d);
    file_put_contents("$d/index.php", "<?php // TFM-ADMIN-ENTRY\n");
    file_put_contents("$d/.htaccess", "# rules\n");
    $none = Tfm\AdminPath::extraFiles($d);
    file_put_contents("$d/admin.css", 'body{}');
    file_put_contents("$d/index.php~", 'x');
    mkdir("$d/parts");
    $some = Tfm\AdminPath::extraFiles($d);
    foreach (['index.php', '.htaccess', 'admin.css', 'index.php~'] as $f) @unlink("$d/$f");
    @rmdir("$d/parts");
    @rmdir($d);
    return $none === [] && $some === ['admin.css', 'index.php~', 'parts/'] ? true : json_encode([$none, $some]);
});
check('finding (item 6): the admin stylesheet lives in lib/ (never web-readable) — the admin folder holds only index.php and .htaccess, so no file of it answers before the address check', function () {
    $dir = TFM_ROOT . '/' . Tfm\AdminPath::dirName();
    $css = (string) @file_get_contents(TFM_ROOT . '/lib/admin.css');
    return strlen($css) > 2000 && !is_file($dir . '/admin.css') && Tfm\AdminPath::extraFiles($dir) === [] ? true : json_encode(['css' => strlen($css), 'extra' => Tfm\AdminPath::extraFiles($dir)]);
});
check('AdminPath::rename — a bad name is refused before anything is touched (ADMIN_PATH_INVALID)', function () {
    $before = Tfm\AdminPath::dirName();
    $r = throwsApi(function () { Tfm\AdminPath::rename('Bad Name'); }, 'ADMIN_PATH_INVALID') && throwsApi(function () { Tfm\AdminPath::rename('../outside'); }, 'ADMIN_PATH_INVALID')
        && throwsApi(function () { Tfm\AdminPath::rename('abc'); }, 'ADMIN_PATH_INVALID');
    return $r && Tfm\AdminPath::dirName() === $before && is_file(TFM_ROOT . '/' . $before . '/index.php');
});
check('AdminPath::rename — a name that is already a folder or file of the installation is refused (ADMIN_PATH_TAKEN)', function () {
    $before = Tfm\AdminPath::dirName();
    $r = throwsApi(function () { Tfm\AdminPath::rename('config'); }, 'ADMIN_PATH_TAKEN') && throwsApi(function () { Tfm\AdminPath::rename('database'); }, 'ADMIN_PATH_TAKEN')
        && throwsApi(function () { Tfm\AdminPath::rename('uploads'); }, 'ADMIN_PATH_TAKEN');
    return $r && Tfm\AdminPath::dirName() === $before && is_dir(TFM_ROOT . '/config') && is_file(TFM_ROOT . '/config/config.php');
});

// ------------------------------------------------------------------ AdminTotp: enrolment in admin_totp
$admin = null;
$T = 1234567890; // a fixed clock for the store checks (the store takes the time as its last argument)
check('AdminTotp::mode — off | optional | required from security.admin_2fa; anything else means optional', function () {
    $seen = [];
    foreach (['off', 'optional', 'required', 'REQUIRED', 'banana', ''] as $v) {
        putenv('TFM_ADMIN_2FA' . ($v === '' ? '' : "=$v"));
        Tfm\Config::reset();
        $seen[] = Tfm\AdminTotp::mode();
    }
    putenv('TFM_ADMIN_2FA');
    Tfm\Config::reset();
    return $seen === ['off', 'optional', 'required', 'required', 'optional', 'optional'] ? true : json_encode($seen);
});
check('AdminTotp::begin — a new secret is stored sealed (enc:v1:…), not yet enabled, and comes back as base32', function () use (&$admin) {
    $admin = Tfm\Db::tx(function () { return Tfm\Users::create('lock-admin@example.com', '잠금관리자', 'Ferment2026ok', 'admin'); });
    $secret = Tfm\AdminTotp::begin((int) $admin['id']);
    $row = Tfm\Db::one('SELECT * FROM admin_totp WHERE user_id = ?', [(int) $admin['id']]);
    return preg_match('/^[A-Z2-7]{32}$/', $secret) === 1 && $row && (int) $row['enabled'] === 0 && strpos((string) $row['secret_enc'], 'enc:v1:') === 0
        && strpos((string) $row['secret_enc'], $secret) === false && Tfm\AdminTotp::enabled((int) $admin['id']) === false && Tfm\AdminTotp::pendingSecret((int) $admin['id']) === $secret;
});
check('AdminTotp::begin — asking again before the confirmation hands out a fresh secret', function () use (&$admin) {
    $a = Tfm\AdminTotp::pendingSecret((int) $admin['id']);
    $b = Tfm\AdminTotp::begin((int) $admin['id']);
    return $a !== $b && Tfm\AdminTotp::pendingSecret((int) $admin['id']) === $b;
});
check('AdminTotp::confirm — a wrong code changes nothing (TWOFA_CODE)', function () use (&$admin, $T) {
    $r = throwsApi(function () use ($admin, $T) { Tfm\AdminTotp::confirm((int) $admin['id'], '000000', $T); }, 'TWOFA_CODE');
    return $r && Tfm\AdminTotp::enabled((int) $admin['id']) === false;
});
$backup = [];
check('AdminTotp::confirm — the current code turns it on and returns 10 one-time backup codes (stored only as hashes)', function () use (&$admin, &$backup, $T) {
    $uid = (int) $admin['id'];
    $secret = (string) Tfm\AdminTotp::pendingSecret($uid);
    $backup = Tfm\AdminTotp::confirm($uid, Tfm\Totp::code($secret, $T), $T);
    $row = Tfm\Db::one('SELECT * FROM admin_totp WHERE user_id = ?', [$uid]);
    $stored = json_decode((string) $row['backup_codes'], true);
    if (count($backup) !== 10 || count(array_unique($backup)) !== 10) return 'codes: ' . json_encode($backup);
    foreach ($backup as $c) {
        if (!preg_match('/^[a-z2-9]{4}-[a-z2-9]{4}$/', $c)) return "format $c";
        if (strpos((string) $row['backup_codes'], $c) !== false || strpos((string) $row['backup_codes'], str_replace('-', '', $c)) !== false) return 'a plain code is in the database';
    }
    if (!is_array($stored) || count($stored) !== 10) return 'stored: ' . (string) $row['backup_codes'];
    foreach ($stored as $h) if (!is_string($h) || password_get_info($h)['algo'] === null || password_get_info($h)['algo'] === 0) return 'not a password hash';
    return (int) $row['enabled'] === 1 && (int) $row['confirmed_at'] > 0 && (int) $row['last_step'] === intdiv($T, 30) && Tfm\AdminTotp::enabled($uid) === true
        && Tfm\AdminTotp::pendingSecret($uid) === null && Tfm\AdminTotp::backupLeft($uid) === 10;
});
check('AdminTotp::begin — refused while 2-step sign-in is on (TWOFA_ALREADY)', function () use (&$admin) {
    return throwsApi(function () use ($admin) { Tfm\AdminTotp::begin((int) $admin['id']); }, 'TWOFA_ALREADY');
});
check('AdminTotp::attempt — the code that confirmed the enrolment cannot be used again (replay through last_step)', function () use (&$admin, $T) {
    $uid = (int) $admin['id'];
    $secret = (string) Tfm\Crypto::open((string) Tfm\Db::value('SELECT secret_enc FROM admin_totp WHERE user_id = ?', [$uid]));
    return Tfm\AdminTotp::attempt($uid, Tfm\Totp::code($secret, $T), $T) === 'fail';
});
check('AdminTotp::attempt — the next code works once ("totp"), then it is a replay too', function () use (&$admin, $T) {
    $uid = (int) $admin['id'];
    $secret = (string) Tfm\Crypto::open((string) Tfm\Db::value('SELECT secret_enc FROM admin_totp WHERE user_id = ?', [$uid]));
    $next = Tfm\Totp::code($secret, $T + 30);
    $a = Tfm\AdminTotp::attempt($uid, $next, $T + 30);
    $b = Tfm\AdminTotp::attempt($uid, $next, $T + 30);
    $c = Tfm\AdminTotp::attempt($uid, Tfm\Totp::code($secret, $T), $T + 30); // an older step that is still inside the window
    return $a === 'totp' && $b === 'fail' && $c === 'fail' && (int) Tfm\Db::value('SELECT last_step FROM admin_totp WHERE user_id = ?', [$uid]) === intdiv($T + 30, 30) ? true : json_encode([$a, $b, $c]);
});
check('AdminTotp::attempt — a backup code works exactly once (typed with or without the dash, any case)', function () use (&$admin, &$backup, $T) {
    $uid = (int) $admin['id'];
    $a = Tfm\AdminTotp::attempt($uid, $backup[0], $T + 60);
    $b = Tfm\AdminTotp::attempt($uid, $backup[0], $T + 60);
    $c = Tfm\AdminTotp::attempt($uid, strtoupper(str_replace('-', ' ', $backup[1])), $T + 60);
    return $a === 'backup' && $b === 'fail' && $c === 'backup' && Tfm\AdminTotp::backupLeft($uid) === 8 ? true : json_encode([$a, $b, $c, Tfm\AdminTotp::backupLeft($uid)]);
});
check('AdminTotp::attempt — a success clears the wrong-code count', function () use (&$admin) {
    $f = Tfm\AdminTotp::failures((int) $admin['id']);
    return $f['count'] === 0 && $f['wait'] === 0 ? true : json_encode($f);
});
check('AdminTotp::attempt — 5 wrong codes lock the code step: even the right code answers "locked"', function () use (&$admin, &$backup, $T) {
    $uid = (int) $admin['id'];
    $secret = (string) Tfm\Crypto::open((string) Tfm\Db::value('SELECT secret_enc FROM admin_totp WHERE user_id = ?', [$uid]));
    $seen = [];
    for ($i = 0; $i < 5; $i++) $seen[] = Tfm\AdminTotp::attempt($uid, '00000' . $i, $T + 90);
    $f = Tfm\AdminTotp::failures($uid);
    $right = Tfm\AdminTotp::attempt($uid, Tfm\Totp::code($secret, $T + 120), $T + 120);
    $bk = Tfm\AdminTotp::attempt($uid, $backup[2], $T + 120);
    $n = (int) Tfm\Db::value("SELECT COUNT(*) FROM audit_log WHERE event = 'admin_2fa_fail' AND user_id = ?", [$uid]);
    return $seen === ['fail', 'fail', 'fail', 'fail', 'fail'] && $f['count'] >= 5 && $f['wait'] > 0 && $right === 'locked' && $bk === 'locked' && Tfm\AdminTotp::backupLeft($uid) === 8 && $n >= 5
        ? true : json_encode([$seen, $f, $right, $bk, $n]);
});
check('AdminTotp::attempt — a correct password sign-in does not clear the wrong-code count (only a correct code does)', function () use (&$admin) {
    Tfm\LoginThrottle::record('lock-admin@example.com', true);
    return Tfm\AdminTotp::failures((int) $admin['id'])['wait'] > 0;
});
check('AdminTotp::regenerateBackup — 10 new codes; the old ones stop working', function () use (&$admin, &$backup, $T) {
    $uid = (int) $admin['id'];
    Tfm\Db::exec("DELETE FROM audit_log WHERE event = 'admin_2fa_fail'"); // lift the lock of the previous check
    $old = $backup[3];
    $backup = Tfm\AdminTotp::regenerateBackup($uid);
    return count($backup) === 10 && !in_array($old, $backup, true) && Tfm\AdminTotp::backupLeft($uid) === 10 && Tfm\AdminTotp::attempt($uid, $old, $T + 150) === 'fail' && Tfm\AdminTotp::attempt($uid, $backup[9], $T + 150) === 'backup';
});
check('AdminTotp::admins / enrolledCount — every admin account with its 2-step state', function () use (&$admin) {
    $other = Tfm\Db::tx(function () { return Tfm\Users::create('lock-admin2@example.com', '둘째관리자', 'Ferment2026ok', 'admin'); });
    Tfm\Db::tx(function () { return Tfm\Users::create('lock-user@example.com', '보통사용자', 'Ferment2026ok'); });
    $list = Tfm\AdminTotp::admins();
    $by = [];
    foreach ($list as $r) $by[(int) $r['id']] = $r;
    $c = Tfm\AdminTotp::enrolledCount();
    return count($list) === 2 && $by[(int) $admin['id']]['enabled'] === true && $by[(int) $admin['id']]['backupLeft'] === 9 && $by[(int) $other['id']]['enabled'] === false
        && $c === ['enrolled' => 1, 'admins' => 2] ? true : json_encode([$list, $c], JSON_UNESCAPED_UNICODE);
});
check('AdminTotp::disable — the enrolment is gone, a code is no longer asked', function () use (&$admin) {
    $uid = (int) $admin['id'];
    Tfm\AdminTotp::disable($uid);
    return Tfm\AdminTotp::enabled($uid) === false && Tfm\Db::one('SELECT 1 AS x FROM admin_totp WHERE user_id = ?', [$uid]) === null;
});
check('AdminTotp::reset — recovery from the server PC: true when an enrolment was removed, false when there was none', function () use (&$admin, $T) {
    $uid = (int) $admin['id'];
    $secret = Tfm\AdminTotp::begin($uid);
    Tfm\AdminTotp::confirm($uid, Tfm\Totp::code($secret, $T), $T);
    $a = Tfm\AdminTotp::reset($uid);
    $b = Tfm\AdminTotp::reset($uid);
    $audit = (int) Tfm\Db::value("SELECT COUNT(*) FROM audit_log WHERE event = 'admin_2fa_reset' AND user_id = ?", [$uid]);
    return $a === true && $b === false && Tfm\AdminTotp::enabled($uid) === false && $audit === 1 ? true : json_encode([$a, $b, $audit]);
});

// ------------------------------------------------------------------ AdminTotp: the wrong-code lock against an attacker who knows the password
/** a new admin with 2-step sign-in on: [user id, secret] */
function enrolledAdmin(string $tag): array
{
    $u = Tfm\Db::tx(function () use ($tag) { return Tfm\Users::create("guess-$tag@example.com", '추측' . $tag, 'Ferment2026ok', 'admin'); });
    $uid = (int) $u['id'];
    $secret = Tfm\AdminTotp::begin($uid);
    Tfm\AdminTotp::confirm($uid, Tfm\Totp::code($secret), null);
    return [$uid, $secret];
}
/**
 * Finding (reviewer-auth, item 6): someone who knows an admin's password sends wrong 6-digit codes as fast as the lock
 * lets them through, for $seconds of virtual time — time passes by moving this account's audit rows into the past (as
 * the reviewer's harness did), one second per request. Returns the number of wrong codes that were checked and the
 * shortest wait seen right after a wrong code once at least $capAt wrong codes were counted (PHP_INT_MAX: never got there).
 */
function guessRun(int $uid, string $secret, int $seconds, int $stopAt, int $capAt = 16): array
{
    $t = time();
    $valid = [Tfm\Totp::code($secret, $t - 30), Tfm\Totp::code($secret, $t), Tfm\Totp::code($secret, $t + 30), Tfm\Totp::code($secret, $t + 60)];
    $wrong = '000000';
    for ($i = 0; in_array($wrong, $valid, true); $i++) $wrong = (string) (123457 + $i); // never one of the codes that are valid now
    $virtual = 0;
    $checked = 0;
    $capWait = PHP_INT_MAX;
    $move = function (int $s) use ($uid) { Tfm\Db::exec('UPDATE audit_log SET created_at = created_at - ? WHERE user_id = ?', [$s * 1000, $uid]); };
    while ($virtual < $seconds && $checked < $stopAt) {
        $f = Tfm\AdminTotp::failures($uid);
        if ($f['wait'] > 0) { $move($f['wait']); $virtual += $f['wait']; continue; }
        $r = Tfm\AdminTotp::attempt($uid, $wrong);
        if ($r !== 'fail') throw new RuntimeException("a wrong code answered \"$r\"");
        $checked++;
        $after = Tfm\AdminTotp::failures($uid);
        if ($after['count'] >= $capAt) $capWait = min($capWait, $after['wait']);
        $move(1);
        $virtual += 1;
    }
    return ['checked' => $checked, 'capWait' => $capWait, 'virtual' => $virtual];
}
check('AdminTotp lock — someone who knows the password gets at most 16 wrong codes checked in the first 24 hours (it was ~600 a day)', function () {
    list($uid, $secret) = enrolledAdmin('day');
    $r = guessRun($uid, $secret, 86400, 40);
    return $r['checked'] <= 16 ? true : "{$r['checked']}+ wrong codes were checked within 24 h";
});
check('AdminTotp lock — over 365 days at most ~1 wrong code a day after the first day (≤ 400: chance to hit one of the 3 valid codes ≤ 0.12 %), and a long lock never falls back to a short one', function () {
    list($uid, $secret) = enrolledAdmin('year');
    $r = guessRun($uid, $secret, 365 * 86400, 500);
    $chance = 100 * (1 - pow(1 - 3e-6, $r['checked']));
    if ($r['checked'] > 400) return "{$r['checked']}+ wrong codes in a year (chance " . round($chance, 2) . ' %)';
    if ($r['capWait'] === PHP_INT_MAX) return 'the lock never reached its longest step (16 wrong codes counted at once)';
    return $r['capWait'] >= 86400 - 2 ? true : "after the 16th wrong code a further one waited only {$r['capWait']} s";
});
check('AdminTotp::lockSeconds — 4 wrong codes are free, from the 5th: 1 min doubling with each one, at most 1 day', function () {
    $got = [];
    foreach ([0, 1, 4, 5, 6, 7, 10, 15, 16, 17, 40, 10000] as $n) $got[$n] = Tfm\AdminTotp::lockSeconds($n);
    $want = [0 => 0, 1 => 0, 4 => 0, 5 => 60, 6 => 120, 7 => 240, 10 => 1920, 15 => 61440, 16 => 86400, 17 => 86400, 40 => 86400, 10000 => 86400];
    return $got === $want ? true : json_encode($got);
});
check('AdminTotp::lockPolicy — security.admin_2fa_lock is honoured; broken values fall back to safe ones; the memory always outlasts the escalation', function () {
    $d = Tfm\AdminTotp::lockPolicy();
    Tfm\Config::override('security.admin_2fa_lock', ['free' => 3, 'base' => 120, 'max' => 3600, 'memory' => 10]);
    $o = Tfm\AdminTotp::lockPolicy();
    $l = [Tfm\AdminTotp::lockSeconds(2), Tfm\AdminTotp::lockSeconds(3), Tfm\AdminTotp::lockSeconds(4), Tfm\AdminTotp::lockSeconds(9)];
    Tfm\Config::override('security.admin_2fa_lock', ['free' => 'x', 'base' => -5, 'max' => 0, 'memory' => []]);
    $b = Tfm\AdminTotp::lockPolicy();
    Tfm\Config::override('security.admin_2fa_lock', 'nonsense');
    $s = Tfm\AdminTotp::lockPolicy();
    Tfm\Config::override('security.admin_2fa_lock', null);
    $okDefault = $d === ['free' => 5, 'base' => 60, 'max' => 86400, 'memory' => 2592000];
    // free 3 · base 120 · max 3600 → the cap is reached at the 8th wrong code: the memory is at least (8 + 1) × 3600 s and at least a day
    $okOver = $o['free'] === 3 && $o['base'] === 120 && $o['max'] === 3600 && $o['memory'] >= 86400 && $o['memory'] >= 9 * 3600 && $l === [0, 120, 240, 3600];
    $okBroken = $b['free'] >= 1 && $b['base'] >= 30 && $b['max'] >= $b['base'] && $b['memory'] >= 86400 && $s === $d;
    return $okDefault && $okOver && $okBroken ? true : json_encode([$d, $o, $l, $b, $s]);
});
check('AdminTotp::unlock — lifts the lock (cli admin:2fa-unlock) without removing the enrolment; the right code works again; nothing to lift → false', function () {
    list($uid, $secret) = enrolledAdmin('unlock');
    for ($i = 0; $i < 5; $i++) Tfm\AdminTotp::attempt($uid, '00000' . $i, time());
    $locked = Tfm\AdminTotp::failures($uid)['wait'] > 0 && Tfm\AdminTotp::attempt($uid, Tfm\Totp::code($secret, time() + 30), time() + 30) === 'locked';
    $a = Tfm\AdminTotp::unlock($uid);
    $f = Tfm\AdminTotp::failures($uid);
    $right = Tfm\AdminTotp::attempt($uid, Tfm\Totp::code($secret, time() + 30), time() + 30);
    $b = Tfm\AdminTotp::unlock($uid);
    $audit = (int) Tfm\Db::value("SELECT COUNT(*) FROM audit_log WHERE event = 'admin_2fa_unlocked' AND user_id = ?", [$uid]);
    return $locked && $a === true && $f === ['count' => 0, 'wait' => 0] && $right === 'totp' && $b === false && Tfm\AdminTotp::enabled($uid) && $audit === 1
        ? true : json_encode([$locked, $a, $f, $right, $b, $audit]);
});
check('AdminTotp::waitText — the wait in plain words (초 · 분 · 시간 · 일)', function () {
    $got = [];
    foreach ([0, 1, 59, 60, 61, 3599, 3600, 3660, 7322, 86399, 86400, 90000, 200000] as $s) $got[] = Tfm\AdminTotp::waitText($s);
    // minutes are rounded up (a wait is never shown shorter than it is): 3599 s → 1시간, 86399 s → 1일
    $want = ['1초', '1초', '59초', '1분', '2분', '1시간', '1시간', '1시간 1분', '2시간 3분', '1일', '1일', '1일 1시간', '2일 7시간'];
    return $got === $want ? true : json_encode($got, JSON_UNESCAPED_UNICODE);
});

// ------------------------------------------------------------------ Health: the admin-lock rows of the system check
check('Health::collect — admin-lock rows: folder name (warn while it is "admin"), allow-list, 2-step, old address, install lock', function () {
    $h = Tfm\Health::collect(false);
    $by = [];
    foreach ($h['checks'] as $c) $by[$c['id']] = $c;
    foreach (['admin_dir', 'admin_dir_files', 'admin_ip_allowlist', 'admin_2fa', 'admin_old_path', 'install_lock'] as $id) {
        if (!isset($by[$id])) return "missing row $id";
        if (!in_array($by[$id]['status'], ['ok', 'warn', 'fail'], true) || !is_string($by[$id]['label']) || $by[$id]['label'] === '') return "bad row $id";
    }
    $dirWarn = Tfm\AdminPath::dirName() === 'admin' ? $by['admin_dir']['status'] === 'warn' : $by['admin_dir']['status'] === 'ok';
    return $dirWarn && $by['admin_ip_allowlist']['status'] === 'warn' && $by['admin_old_path']['status'] === 'ok' && $by['admin_2fa']['status'] === 'warn' && $by['admin_dir_files']['status'] === 'ok'
        ? true : json_encode([$by['admin_dir'], $by['admin_dir_files'], $by['admin_ip_allowlist'], $by['admin_old_path'], $by['admin_2fa']], JSON_UNESCAPED_UNICODE);
});
check('Health::collect — the old address check fails when a real page is still at admin.php (file content, not the name)', function () {
    $stub = Tfm\AdminGate::oldPathState(TFM_ROOT . '/admin.php');
    $page = tempnam(sys_get_temp_dir(), 'tfm');
    file_put_contents($page, "<?php\nrequire __DIR__ . '/lib/bootstrap.php';\nTfm\\Session::start(true);\necho 'old admin page';\n");
    $old = Tfm\AdminGate::oldPathState($page);
    @unlink($page);
    $none = Tfm\AdminGate::oldPathState(TFM_ROOT . '/no-such-file.php');
    return $stub === 'stub' && $old === 'page' && $none === 'missing' ? true : json_encode([$stub, $old, $none]);
});

echo PHP_EOL . ($failed === 0 ? "✔ all admin-lock unit checks passed" : "✖ $failed check(s) failed") . PHP_EOL;
exit($failed === 0 ? 0 : 1);
