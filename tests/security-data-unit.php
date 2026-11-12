<?php
/**
 * tests/security-data-unit.php — unit checks for the data / payment / secrets half of the phase-7 security lock-down
 * (CONTRACT §15.7 items 1, 7, 8, 15, 20, 21). No web server: a throw-away SQLite database in the temp dir.
 *
 *   php tests/security-data-unit.php                 prints PASS/FAIL per check, exits 1 when one fails
 *   TFM_DB_DRIVER=mysql TFM_DB_HOST=127.0.0.1 TFM_DB_PORT=33106 TFM_DB_USER=root TFM_DB_NAME=tfm_secdata php tests/security-data-unit.php
 *                                                    the same checks plus the MariaDB-only ones (dedicated account, grants)
 *
 * Every check runs inside its own try/catch: a missing class / method is that check's FAIL (with the error message)
 * instead of the end of the run, so one run shows every behaviour that is still missing.
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
// A private copy of the server tree: the installer checks write config/config.local.php and rename files, which must
// never happen inside the repository. The data directory is separate (like TFM_DATA_DIR outside the web root).
$root = sys_get_temp_dir() . '/tfm-secdata-' . bin2hex(random_bytes(6));
$srv = $root . '/srv';
$tmp = $root . '/data';
mkdir($tmp, 0700, true);
copyTree(__DIR__ . '/../server', $srv);
putenv("TFM_DATA_DIR=$tmp");
putenv('TFM_TOSS_MOCK=1');
require $srv . '/lib/bootstrap.php';

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
/** MariaDB-only checks are reported as skipped on SQLite (they run in the second invocation, see the header) */
function mysqlOnly(string $name, callable $test): void
{
    if (Tfm\Db::driverSafe() !== 'mysql') { echo "SKIP  $name  (MariaDB only)" . PHP_EOL; return; }
    check($name, $test);
}

$IS_MYSQL = strtolower((string) Tfm\Config::get('db.driver', 'sqlite')) === 'mysql';
Tfm\Db::pdo(); // creates the schema

// ------------------------------------------------------------------ Crypto (item 1f: secrets inside rows are sealed)
check('Crypto::available — openssl with aes-256-gcm is there', function () {
    return Tfm\Crypto::available() === true;
});
check('Crypto::seal — enc:v1: + base64(nonce 12 | tag 16 | ciphertext)', function () {
    $s = Tfm\Crypto::seal('billing-key-123');
    if (strpos($s, 'enc:v1:') !== 0) return 'no prefix: ' . substr($s, 0, 12);
    $bin = base64_decode(substr($s, 7), true);
    if ($bin === false) return 'body is not base64';
    return strlen($bin) === 12 + 16 + strlen('billing-key-123') && strpos($s, 'billing-key-123') === false;
});
check('Crypto::seal — a new random nonce every time (the same text never seals to the same value)', function () {
    return Tfm\Crypto::seal('same') !== Tfm\Crypto::seal('same');
});
check('Crypto::open — round trip: empty, ASCII, Korean, binary, 10 kB', function () {
    foreach (['', 'abc', '한글 비밀 🔐', random_bytes(64), str_repeat('x', 10000)] as $p) {
        if (Tfm\Crypto::open(Tfm\Crypto::seal($p)) !== $p) return 'mismatch for a ' . strlen($p) . '-byte value';
    }
    return true;
});
check('Crypto::open — a value without the prefix is legacy plaintext and comes back unchanged', function () {
    return Tfm\Crypto::open('Z_t5vOvQxrj4499PeiJcjen28-V2RyqgYTwN44Rdzk0=') === 'Z_t5vOvQxrj4499PeiJcjen28-V2RyqgYTwN44Rdzk0=' && Tfm\Crypto::open('') === '';
});
check('Crypto::isSealed — true only for enc:v1: values', function () {
    return Tfm\Crypto::isSealed(Tfm\Crypto::seal('x')) === true && Tfm\Crypto::isSealed('plain') === false && Tfm\Crypto::isSealed('') === false;
});
check('Crypto::open — one changed byte in the nonce, the tag or the ciphertext gives null (tampering)', function () {
    $s = Tfm\Crypto::seal('do not touch');
    $bin = (string) base64_decode(substr($s, 7), true);
    foreach ([0, 13, 30] as $i) {
        $t = $bin;
        $t[$i] = chr(ord($t[$i]) ^ 1);
        if (Tfm\Crypto::open('enc:v1:' . base64_encode($t)) !== null) return "byte $i changed but the value still opened";
    }
    return true;
});
check('Crypto::open — garbage after the prefix gives null (no warning, no exception)', function () {
    foreach (['enc:v1:', 'enc:v1:!!!not-base64!!!', 'enc:v1:' . base64_encode('short'), 'enc:v1:' . base64_encode(random_bytes(40))] as $g) {
        if (Tfm\Crypto::open($g) !== null) return 'opened: ' . $g;
    }
    return true;
});
check('Crypto — the key is data_key (32 random bytes, 64 hex) in data/secret.php; app_key and db_file are untouched', function () use ($tmp) {
    $before = Tfm\Config::secret('app_key');
    Tfm\Crypto::seal('x');
    $s = Tfm\Secrets::read(true);
    if (!isset($s['data_key']) || !preg_match('/^[0-9a-f]{64}$/', (string) $s['data_key'])) return 'data_key missing or not 64 hex';
    if ($s['app_key'] !== $before || !isset($s['db_file'])) return 'the existing secrets changed';
    $raw = (string) file_get_contents($tmp . '/secret.php');
    return strpos($raw, '<?php') === 0 && strpos($raw, "if (!defined('TFM_BOOT'))") !== false ? true : 'secret.php lost its PHP guard';
});
check('Secrets — secret.php is private after a rewrite (mode 0600 where the OS has modes)', function () use ($tmp) {
    if (DIRECTORY_SEPARATOR === '\\') return true;
    clearstatcache();
    $mode = fileperms($tmp . '/secret.php') & 0777;
    return $mode === 0600 ? true : sprintf('mode %o', $mode);
});
check('Secrets::update — no temp file is left next to secret.php', function () use ($tmp) {
    $left = array_values(array_filter(scandir($tmp) ?: [], function ($f) { return (bool) preg_match('/tmp|\.read-/', $f); }));
    return $left === [] ? true : 'left: ' . implode(', ', $left);
});
check('Crypto::open — another data key gives null (wrong key); the old key opens it again', function () {
    $sealed = Tfm\Crypto::seal('only the right key');
    $orig = Tfm\Secrets::read(true)['data_key'];
    Tfm\Secrets::update(function (array $s) { $s['data_key'] = bin2hex(random_bytes(32)); return $s; });
    Tfm\Crypto::reset();
    $wrong = Tfm\Crypto::open($sealed);
    Tfm\Secrets::update(function (array $s) use ($orig) { $s['data_key'] = $orig; return $s; });
    Tfm\Crypto::reset();
    return $wrong === null && Tfm\Crypto::open($sealed) === 'only the right key';
});
check('Crypto::open — during a key change the previous key (data_key_prev) still opens old values; needsReseal says so', function () {
    $old = Tfm\Crypto::seal('sealed before the change');
    $orig = Tfm\Secrets::read(true)['data_key'];
    Tfm\Secrets::update(function (array $s) use ($orig) { $s['data_key_prev'] = $orig; $s['data_key'] = bin2hex(random_bytes(32)); return $s; });
    Tfm\Crypto::reset();
    $opened = Tfm\Crypto::open($old);
    $stale = Tfm\Crypto::needsReseal($old);
    $fresh = Tfm\Crypto::needsReseal(Tfm\Crypto::seal('new'));
    Tfm\Secrets::update(function (array $s) use ($orig) { $s['data_key'] = $orig; unset($s['data_key_prev']); return $s; });
    Tfm\Crypto::reset();
    return $opened === 'sealed before the change' && $stale === true && $fresh === false;
});
check('Crypto::needsReseal — true for non-empty legacy plaintext, false for an empty value', function () {
    return Tfm\Crypto::needsReseal('plain-billing-key') === true && Tfm\Crypto::needsReseal('') === false;
});
check('Crypto::seal — a 158-character key still fits a VARCHAR(255) column; fits() tells before it is stored', function () {
    return strlen(Tfm\Crypto::seal(str_repeat('k', 158))) <= 255 && Tfm\Crypto::fits(str_repeat('k', 158), 255) === true && Tfm\Crypto::fits(str_repeat('k', 159), 255) === false;
});

// ------------------------------------------------------------------ Installer: config/config.local.php (items 1, 21)
$cfgFile = $srv . '/config/config.local.php';
check('Installer::mergeLocalConfig — creates config.local.php with the patch; Config sees it at once', function () use ($cfgFile) {
    if (is_file($cfgFile)) return 'the private copy already has a config.local.php';
    Tfm\Installer::mergeLocalConfig(['security' => ['admin_dir' => 'manage-7f3a']]);
    return is_file($cfgFile) && Tfm\Config::get('security.admin_dir') === 'manage-7f3a';
});
check('Installer::mergeLocalConfig — deep merge: other keys and sibling keys stay, plain values and lists are replaced', function () {
    Tfm\Installer::mergeLocalConfig(['db' => ['mysql' => ['username' => 'tfm_ab12cd34', 'password' => 'p1']], 'security' => ['admin_ip_allowlist' => ['10.0.0.1', '10.0.0.2']]]);
    Tfm\Installer::mergeLocalConfig(['db' => ['mysql' => ['password' => 'p2']], 'security' => ['admin_ip_allowlist' => ['10.0.0.9']]]);
    $c = Tfm\Installer::readLocalConfig();
    return $c['security']['admin_dir'] === 'manage-7f3a' && $c['db']['mysql'] === ['username' => 'tfm_ab12cd34', 'password' => 'p2']
        && $c['security']['admin_ip_allowlist'] === ['10.0.0.9'] && Tfm\Config::get('db.mysql.password') === 'p2';
});
check('Installer::mergeLocalConfig — the file is a guarded PHP file, mode 0600, no temp file left in config/', function () use ($cfgFile, $srv) {
    $raw = (string) file_get_contents($cfgFile);
    if (strpos($raw, '<?php') !== 0 || strpos($raw, "if (!defined('TFM_BOOT')) { http_response_code(404); exit; }") === false) return 'no PHP guard';
    clearstatcache();
    if (DIRECTORY_SEPARATOR !== '\\' && (fileperms($cfgFile) & 0777) !== 0600) return sprintf('mode %o', fileperms($cfgFile) & 0777);
    $left = array_values(array_filter(scandir($srv . '/config') ?: [], function ($f) { return (bool) preg_match('/tmp|\.read-/', $f); }));
    return $left === [] ? true : 'left: ' . implode(', ', $left);
});
check('Installer::mergeLocalConfig — a config.local.php that does not return an array is never overwritten (CONFIG_READ)', function () use ($cfgFile) {
    $good = (string) file_get_contents($cfgFile);
    file_put_contents($cfgFile, "<?php\nif (!defined('TFM_BOOT')) { http_response_code(404); exit; }\n\$handWritten = ['db' => ['driver' => 'mysql']];\n");
    $refused = throwsApi(function () { Tfm\Installer::mergeLocalConfig(['security' => ['admin_dir' => 'x']]); }, 'CONFIG_READ');
    $kept = strpos((string) file_get_contents($cfgFile), '$handWritten') !== false;
    file_put_contents($cfgFile, $good);
    return $refused && $kept;
});
check('Installer::writeConfig — still writes the whole array (as before), now 0600', function () use ($cfgFile) {
    $cur = Tfm\Installer::readLocalConfig();
    $cur['security']['admin_dir'] = 'admin';
    Tfm\Installer::writeConfig($cur);
    Tfm\Config::reset();
    clearstatcache();
    return Tfm\Installer::readLocalConfig() === $cur && Tfm\Config::get('security.admin_dir') === 'admin' && (DIRECTORY_SEPARATOR === '\\' || (fileperms($cfgFile) & 0777) === 0600);
});
// the following sections start from a clean local configuration (SQLite / the environment's MariaDB, mock payments)
@unlink($cfgFile);
Tfm\Config::reset();

// ------------------------------------------------------------------ (sections are appended above this line)
echo PHP_EOL . ($failed === 0 ? "✔ all security-data unit checks passed" : "✖ $failed check(s) failed") . PHP_EOL;
exit($failed === 0 ? 0 : 1);
