<?php
/**
 * tests/security-data-unit.php — unit checks for the data / payment / secrets half of the phase-7 security lock-down
 * (CONTRACT §15.7 items 1, 7, 8, 15, 20, 21). No web server: a throw-away SQLite database in the temp dir.
 *
 *   php tests/security-data-unit.php                 prints PASS/FAIL per check, exits 1 when one fails
 *   TFM_DB_DRIVER=mysql TFM_DB_HOST=127.0.0.1 TFM_DB_PORT=33106 TFM_DB_USER=root TFM_DB_NAME=tfm_data_u1 php tests/security-data-unit.php
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
/** $test returns true (pass), false or a string (fail + detail); a thrown error is a fail with its message.
 *  TFM_UNIT_ONLY=<text> runs only the checks whose name contains <text> (the set-up between checks still runs). */
function check(string $name, callable $test): void
{
    global $failed;
    $only = (string) getenv('TFM_UNIT_ONLY');
    if ($only !== '' && strpos($name, $only) === false) return;
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
    return strpos($raw, '<?php') === 0 && strpos($raw, "if (!defined('TFM_BOOT')) { if (function_exists('header_remove')) header_remove('X-Powered-By'); http_response_code(404); exit; }") !== false ? true : 'secret.php lost its PHP guard';
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

// ------------------------------------------------------------------ SetupCode (finding F1/F4: proof of file-system access, not of network position)
check('SetupCode::ensure — a 12-character code from an unambiguous alphabet (no 0 O 1 I L), written to data/setup-code.php', function () use ($tmp) {
    @unlink(Tfm\SetupCode::path());
    $code = Tfm\SetupCode::ensure();
    if (!preg_match('/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{12}$/', $code)) return 'code: ' . $code;
    if (Tfm\SetupCode::path() !== $tmp . DIRECTORY_SEPARATOR . 'setup-code.php') return 'path: ' . Tfm\SetupCode::path();
    return is_file(Tfm\SetupCode::path());
});
check('SetupCode — the file is a guarded PHP file (prints nothing over the web), mode 0600, the code readable for the operator', function () {
    $f = Tfm\SetupCode::path();
    $raw = (string) file_get_contents($f);
    $code = Tfm\SetupCode::ensure();
    if (strpos($raw, '<?php') !== 0 || strpos($raw, "if (!defined('TFM_BOOT')) { if (function_exists('header_remove')) header_remove('X-Powered-By'); http_response_code(404); exit; }") === false) return 'no PHP guard';
    if (strpos($raw, $code) === false) return 'the operator cannot read the code in the file';
    $out = shell_exec(escapeshellarg(PHP_BINARY) . ' ' . escapeshellarg($f) . ' 2>&1');
    if (trim((string) $out) !== '') return 'running the file directly prints: ' . substr((string) $out, 0, 60);
    clearstatcache();
    return DIRECTORY_SEPARATOR === '\\' || (fileperms($f) & 0777) === 0600 ? true : sprintf('mode %o', fileperms($f) & 0777);
});
check('SetupCode::ensure — an unexpired code is reused (the same code until it is used or 24 h pass)', function () {
    return Tfm\SetupCode::ensure() === Tfm\SetupCode::ensure();
});
check('SetupCode::check — right code true (also lower case / with spaces or dashes), wrong / empty / partial false', function () {
    $c = Tfm\SetupCode::ensure();
    $grouped = substr($c, 0, 4) . '-' . substr($c, 4, 4) . ' ' . substr($c, 8);
    if (!Tfm\SetupCode::check($c) || !Tfm\SetupCode::check(strtolower($c)) || !Tfm\SetupCode::check($grouped)) return 'the right code was refused';
    $wrong = ($c[0] === 'A' ? 'B' : 'A') . substr($c, 1);
    foreach (['', $wrong, substr($c, 0, 11), $c . 'A', str_repeat('A', 12), "\0" . $c] as $bad) if (Tfm\SetupCode::check($bad)) return 'accepted: ' . json_encode($bad);
    return true;
});
check('SetupCode::check — an expired code is refused, and ensure() then makes a new one', function () {
    $f = Tfm\SetupCode::path();
    $old = Tfm\SetupCode::ensure();
    $raw = (string) file_get_contents($f);
    $past = (string) preg_replace("/'expires_at' => \d+/", "'expires_at' => " . (time() - 5), $raw);
    if ($past === $raw) return 'no expires_at in the file';
    file_put_contents($f, $past);
    Tfm\PrivateFile::forget($f);
    if (Tfm\SetupCode::check($old)) return 'the expired code still works';
    $new = Tfm\SetupCode::ensure();
    return $new !== $old && Tfm\SetupCode::check($new) && !Tfm\SetupCode::check($old);
});
check('SetupCode::consume — the code works once: after consume() it is refused and the file is gone', function () {
    $c = Tfm\SetupCode::ensure();
    Tfm\SetupCode::consume();
    clearstatcache();
    return !is_file(Tfm\SetupCode::path()) && Tfm\SetupCode::check($c) === false;
});
check('SetupCode::check — no file at all: false (never an error)', function () {
    @unlink(Tfm\SetupCode::path());
    return Tfm\SetupCode::check('ABCDEFGHJKMN') === false;
});
check('SetupCode — a damaged file is refused (check false) and replaced by ensure()', function () {
    file_put_contents(Tfm\SetupCode::path(), "<?php\nif (!defined('TFM_BOOT')) { http_response_code(404); exit; }\nreturn 'not an array';\n");
    Tfm\PrivateFile::forget(Tfm\SetupCode::path());
    if (Tfm\SetupCode::check('not an array')) return 'a damaged file was accepted';
    $c = Tfm\SetupCode::ensure();
    $ok = Tfm\SetupCode::check($c);
    Tfm\SetupCode::consume();
    return $ok;
});
check('cli setup-code — prints the code of data/setup-code.php (and creates it when missing)', function () use ($srv, $tmp) {
    @unlink(Tfm\SetupCode::path());
    $out = (string) shell_exec('TFM_DATA_DIR=' . escapeshellarg($tmp) . ' ' . escapeshellarg(PHP_BINARY) . ' ' . escapeshellarg($srv . '/cli/tfm.php') . ' setup-code 2>&1');
    Tfm\PrivateFile::forget(Tfm\SetupCode::path());
    $c = Tfm\SetupCode::ensure();
    $grouped = substr($c, 0, 4) . '-' . substr($c, 4, 4) . '-' . substr($c, 8);
    $ok = strpos($out, $grouped) !== false || strpos($out, $c) !== false;
    Tfm\SetupCode::consume();
    return $ok ? true : 'output: ' . substr($out, 0, 200);
});

// ------------------------------------------------------------------ cli/tfm.php plug-ins (other owners ship cli/<name>.php returning a command map)
check('cli plug-in loader — an unknown command is looked up in cli/*.php (not tfm.php / index.php) and its exit code is kept', function () use ($srv, $tmp) {
    $plug = $srv . '/cli/zz-unit-probe.php';
    file_put_contents($plug, "<?php\nif (PHP_SAPI !== 'cli') { http_response_code(404); exit; }\n/**\n * php cli/tfm.php unit:probe <word>   probe command of the unit test\n */\nreturn ['unit:probe' => function (array \$args): int { fwrite(STDOUT, 'probe:' . implode(',', \$args) . PHP_EOL); return 7; }];\n");
    $cmd = 'TFM_DATA_DIR=' . escapeshellarg($tmp) . ' ' . escapeshellarg(PHP_BINARY) . ' ' . escapeshellarg($srv . '/cli/tfm.php');
    exec($cmd . ' unit:probe alpha --beta=1 2>&1', $out, $code);
    $help = (string) shell_exec($cmd . ' help 2>&1');
    exec($cmd . ' no:such:command 2>&1', $out2, $code2);
    @unlink($plug);
    if ($code !== 7 || trim(implode("\n", $out)) !== 'probe:alpha,--beta=1') return 'run: exit ' . $code . ' ' . implode(' / ', $out);
    if (strpos($help, 'unit:probe') === false) return 'help does not list the plug-in command';
    return $code2 !== 0 ? true : 'an unknown command exited 0';
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
    if (strpos($raw, '<?php') !== 0 || strpos($raw, "if (!defined('TFM_BOOT')) { if (function_exists('header_remove')) header_remove('X-Powered-By'); http_response_code(404); exit; }") === false) return 'no PHP guard';
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

// ------------------------------------------------------------------ Db: connection hardening, account audit, schema guard (item 1b–1e)
$local = ['host' => '127.0.0.1', 'port' => 3306, 'database' => 'x', 'username' => 'u', 'password' => 'p'];
check('Db::mysqlOptions — prepared statements are real (no emulation), multi-statements off, LOCAL INFILE off', function () use ($local) {
    $o = Tfm\Db::mysqlOptions($local);
    return $o[PDO::ATTR_EMULATE_PREPARES] === false && $o[PDO::MYSQL_ATTR_MULTI_STATEMENTS] === false && $o[PDO::MYSQL_ATTR_LOCAL_INFILE] === false
        && $o[PDO::ATTR_ERRMODE] === PDO::ERRMODE_EXCEPTION;
});
check('Db::mysqlOptions — db.mysql.ssl_ca turns TLS on with certificate verification; ssl_verify = false keeps the encryption only', function () use ($local) {
    $o = Tfm\Db::mysqlOptions($local + ['ssl_ca' => '/etc/ssl/ca.pem']);
    $n = Tfm\Db::mysqlOptions($local + ['ssl_ca' => '/etc/ssl/ca.pem', 'ssl_verify' => false]);
    return $o[PDO::MYSQL_ATTR_SSL_CA] === '/etc/ssl/ca.pem' && $o[PDO::MYSQL_ATTR_SSL_VERIFY_SERVER_CERT] === true && $n[PDO::MYSQL_ATTR_SSL_VERIFY_SERVER_CERT] === false
        && !isset(Tfm\Db::mysqlOptions($local)[PDO::MYSQL_ATTR_SSL_CA]);
});
check('Db::mysqlOptions — a database on another machine without TLS is refused (clear message), unless allow_insecure_remote', function () use ($local) {
    $remote = ['host' => 'db.example.internal'] + $local;
    $msg = '';
    try { Tfm\Db::mysqlOptions($remote); } catch (RuntimeException $e) { $msg = $e->getMessage(); }
    if (strpos($msg, 'allow_insecure_remote') === false || strpos($msg, 'ssl_ca') === false) return 'no clear refusal: ' . $msg;
    Tfm\Db::mysqlOptions($remote + ['allow_insecure_remote' => true]);
    Tfm\Db::mysqlOptions($remote + ['ssl_ca' => '/etc/ssl/ca.pem']);
    foreach (['localhost', '127.0.0.1', '127.0.0.9', '::1', '[::1]', ''] as $h) Tfm\Db::mysqlOptions(['host' => $h] + $local);
    Tfm\Db::mysqlOptions(['host' => '10.1.2.3', 'socket' => '/run/mysqld/mysqld.sock'] + $local); // a socket is always local
    return true;
});
check('Db::upsert — conflict keys and the update list go through the identifier check too (F14); a normal upsert still works', function () {
    $bad = 0;
    foreach ([[['bucket = 1; DROP TABLE users; --'], null], [['bucket'], ['hits = 0, expires_at']], [['nope'], null], [['bucket'], ['nope']]] as $case) {
        try { Tfm\Db::upsert('rate_limits', ['bucket' => 'unit-upsert', 'hits' => 1, 'expires_at' => 0], $case[0], $case[1]); } catch (InvalidArgumentException $e) { $bad++; }
    }
    Tfm\Db::upsert('rate_limits', ['bucket' => 'unit-upsert', 'hits' => 2, 'expires_at' => 0], ['bucket']);
    Tfm\Db::upsert('rate_limits', ['bucket' => 'unit-upsert', 'hits' => 3, 'expires_at' => 0], ['bucket'], ['hits']);
    $hits = (int) Tfm\Db::value('SELECT hits FROM rate_limits WHERE bucket = ?', ['unit-upsert']);
    Tfm\Db::exec('DELETE FROM rate_limits WHERE bucket = ?', ['unit-upsert']);
    return $bad === 4 && $hits === 3 ? true : "refused $bad of 4, hits $hits";
});
check('Db::accountAudit — every key the health page reads is there (driver, user, host, isRoot, emptyPassword, globalPrivileges, ddlPrivileges, grants)', function () {
    $a = Tfm\Db::accountAudit();
    foreach (['driver', 'user', 'host', 'isRoot', 'emptyPassword', 'globalPrivileges', 'ddlPrivileges', 'grants'] as $k) if (!array_key_exists($k, $a)) return "missing $k";
    return is_bool($a['isRoot']) && is_bool($a['emptyPassword']) && is_bool($a['globalPrivileges']) && is_bool($a['ddlPrivileges']) && is_array($a['grants']) && $a['driver'] === Tfm\Db::driver();
});
if (!$IS_MYSQL) {
    check('SQLite — the database file has an unguessable name and mode 0600 (also the -wal / -shm files)', function () use ($tmp) {
        $f = Tfm\Db::dbFilePath();
        if (!preg_match('/^db-[0-9a-f]{24}\.sqlite$/', basename($f))) return 'name: ' . basename($f);
        if (DIRECTORY_SEPARATOR === '\\') return true;
        clearstatcache();
        foreach ([$f, $f . '-wal', $f . '-shm'] as $p) if (is_file($p) && (fileperms($p) & 0777) !== 0600) return sprintf('%s mode %o', basename($p), fileperms($p) & 0777);
        return true;
    });
    check('Db::accountAudit (SQLite) — reports the file, its mode and whether it sits inside the web root', function () {
        $a = Tfm\Db::accountAudit();
        return $a['driver'] === 'sqlite' && $a['insideWebRoot'] === false && $a['worldReadable'] === false && $a['randomName'] === true && (DIRECTORY_SEPARATOR === '\\' || $a['mode'] === '0600')
            ? true : json_encode($a);
    });
}
check('Db — schema behind + db.auto_migrate off → 503 SCHEMA_OUTDATED with the migrate command (not a missing-table error)', function () {
    $top = (int) Tfm\Db::value('SELECT MAX(version) FROM schema_version');
    Tfm\Db::exec('DELETE FROM schema_version WHERE version = ?', [$top]);
    Tfm\Installer::mergeLocalConfig(['db' => ['auto_migrate' => false]]);
    Tfm\Db::reset();
    $caught = null;
    try { Tfm\Db::pdo(); } catch (Tfm\ApiException $e) { $caught = $e; }
    $again = throwsApi(function () { Tfm\Db::one('SELECT 1'); }, 'SCHEMA_OUTDATED'); // every later use keeps saying so
    Tfm\Installer::mergeLocalConfig(['db' => ['auto_migrate' => true]]);
    Tfm\Db::reset();
    $back = Tfm\Db::schemaVersion() === Tfm\Db::SCHEMA_VERSION && $top === Tfm\Db::SCHEMA_VERSION;
    if (!$caught) return 'no exception';
    return $caught->status === 503 && $caught->errorCode === 'SCHEMA_OUTDATED' && strpos($caught->getMessage(), 'cli/tfm.php migrate') !== false && $again && $back;
});
check('Db — schema up to date + db.auto_migrate off → works without touching the schema', function () {
    Tfm\Installer::mergeLocalConfig(['db' => ['auto_migrate' => false]]);
    Tfm\Db::reset();
    $ok = (int) Tfm\Db::value('SELECT MAX(version) FROM schema_version') === Tfm\Db::SCHEMA_VERSION;
    Tfm\Installer::mergeLocalConfig(['db' => ['auto_migrate' => true]]);
    Tfm\Db::reset();
    return $ok;
});
mysqlOnly('MariaDB — the connection refuses LOAD DATA LOCAL INFILE and a second statement in one query', function () use ($tmp) {
    file_put_contents($tmp . '/infile.txt', "x\n");
    $infile = false;
    try { Tfm\Db::pdo()->exec('LOAD DATA LOCAL INFILE ' . Tfm\Db::pdo()->quote($tmp . '/infile.txt') . ' INTO TABLE rate_limits (bucket)'); } catch (Throwable $e) { $infile = true; }
    $multi = false;
    try { Tfm\Db::pdo()->exec("SELECT 1; DELETE FROM rate_limits WHERE bucket = 'never'"); } catch (Throwable $e) { $multi = true; }
    return $infile && $multi ? true : 'infile refused: ' . json_encode($infile) . ' · multi refused: ' . json_encode($multi);
});
@unlink($cfgFile);
Tfm\Config::reset();
Tfm\Db::reset();

// ------------------------------------------------------------------ payments (items 1f, 15; findings F5, F6, F10) — mock gateway, both drivers
Tfm\Db::pdo();
$payN = 0;
/** a fresh player for the payment checks */
$payUser = function () use (&$payN): array {
    $payN++;
    $tag = substr(bin2hex(random_bytes(4)), 0, 6);
    return Tfm\Db::tx(function () use ($payN, $tag) { return Tfm\Users::create("pay{$payN}_{$tag}@example.com", '결제' . $payN . 'x' . substr($tag, 0, 3), 'Sunny-Jar-4821', 'user'); });
};
$secEvents = function (string $kind): int { return (int) Tfm\Db::value('SELECT COUNT(*) FROM security_events WHERE kind = ?', [$kind]); };
check('billing — the billing key is stored sealed (enc:v1:…), opens to the gateway key, and renewals charge with it', function () use ($payUser) {
    $u = $payUser();
    $o = Tfm\Subscription::prepare($u, 3, 'billing');
    $s = Tfm\Subscription::billingIssue($u, 'mock_auth_ok', $o['customerKey'], $o['orderId']);
    $stored = (string) Tfm\Db::value('SELECT billing_key FROM subscriptions WHERE user_id = ?', [(int) $u['id']]);
    if (strpos($stored, 'enc:v1:') !== 0 || strpos($stored, 'mock_bk_') !== false) return 'stored: ' . substr($stored, 0, 20);
    if (strpos((string) Tfm\Crypto::open($stored), 'mock_bk_') !== 0) return 'does not open to the billing key';
    $r = Tfm\Subscription::renewDue((int) $u['id'], true);
    return $s['tier'] === 3 && isset($r[0]['ok']) && $r[0]['ok'] === true && $r[0]['status'] === 'active' ? true : json_encode($r);
});
check('billing — a key stored in the clear before sealing existed is sealed on its first use (and still charges)', function () use ($payUser) {
    $u = $payUser();
    $o = Tfm\Subscription::prepare($u, 2, 'billing');
    Tfm\Subscription::billingIssue($u, 'mock_auth_ok', $o['customerKey'], $o['orderId']);
    $plain = (string) Tfm\Crypto::open((string) Tfm\Db::value('SELECT billing_key FROM subscriptions WHERE user_id = ?', [(int) $u['id']]));
    Tfm\Db::exec('UPDATE subscriptions SET billing_key = ? WHERE user_id = ?', [$plain, (int) $u['id']]);
    $r = Tfm\Subscription::renewDue((int) $u['id'], true);
    $after = (string) Tfm\Db::value('SELECT billing_key FROM subscriptions WHERE user_id = ?', [(int) $u['id']]);
    return strpos($after, 'enc:v1:') === 0 && Tfm\Crypto::open($after) === $plain && $r[0]['ok'] === true ? true : json_encode([$r, substr($after, 0, 12)]);
});
check('confirm — the gateway answers another amount / no amount / another order / USD / not DONE: refused, order failed, payment_tamper, tier stays 1', function () use ($payUser, $secEvents) {
    foreach (['amount1_', 'noamount_', 'otherorder_', 'usd_', 'waiting_'] as $flag) {
        $u = $payUser();
        $o = Tfm\Subscription::prepare($u, 4, 'card');
        $before = $secEvents('payment_tamper');
        $code = '';
        try { Tfm\Subscription::confirm($u, 'mock_' . $flag . $o['orderId'], $o['orderId'], $o['amount']); } catch (Tfm\ApiException $e) { $code = $e->errorCode; }
        $st = (string) Tfm\Db::value('SELECT status FROM orders WHERE order_id = ?', [$o['orderId']]);
        if ($code !== 'PAYMENT_FAILED' || $st !== 'failed' || Tfm\Subscription::tierFor((int) $u['id']) !== 1) return "$flag: $code / order $st / tier " . Tfm\Subscription::tierFor((int) $u['id']);
        if ($secEvents('payment_tamper') <= $before) return "$flag: no payment_tamper event";
    }
    return true;
});
check('confirm — a client amount that differs is refused (payment_tamper, order untouched); the exact amount then works; a JSON non-integer never reaches it', function () use ($payUser, $secEvents) {
    $u = $payUser();
    $o = Tfm\Subscription::prepare($u, 2, 'card');
    $before = $secEvents('payment_tamper');
    $code = '';
    try { Tfm\Subscription::confirm($u, 'mock_' . $o['orderId'], $o['orderId'], $o['amount'] - 1); } catch (Tfm\ApiException $e) { $code = $e->errorCode; }
    $row = Tfm\Db::one('SELECT status, payment_key FROM orders WHERE order_id = ?', [$o['orderId']]);
    if ($code !== 'AMOUNT_MISMATCH' || $row['status'] !== 'created' || $row['payment_key'] !== '' || $secEvents('payment_tamper') <= $before) return json_encode([$code, $row]);
    $s = Tfm\Subscription::confirm($u, 'mock_' . $o['orderId'], $o['orderId'], $o['amount']);
    foreach (['2900', 2900.0, [2900], true, null] as $bad) {
        if (!throwsApi(function () use ($bad) { Tfm\Subscription::jsonInt($bad, 'amount', 1, 10000000); }, 'INVALID_INPUT')) return 'jsonInt accepted ' . json_encode($bad);
    }
    return $s['tier'] === 2;
});
check('confirm — a confirmed order is never turned into a failed one by a later request (F6); a replay is 409 and does not extend the period', function () use ($payUser) {
    $u = $payUser();
    $o = Tfm\Subscription::prepare($u, 2, 'card');
    $s = Tfm\Subscription::confirm($u, 'mock_' . $o['orderId'], $o['orderId'], $o['amount']);
    $codes = [];
    foreach (['mock_' . $o['orderId'], 'forged_' . $o['orderId'], 'mock_amount1_' . $o['orderId']] as $k) {
        try { Tfm\Subscription::confirm($u, $k, $o['orderId'], $o['amount']); $codes[] = 'ok'; } catch (Tfm\ApiException $e) { $codes[] = $e->errorCode; }
    }
    $st = (string) Tfm\Db::value('SELECT status FROM orders WHERE order_id = ?', [$o['orderId']]);
    return $codes === ['ORDER_NOT_OPEN', 'ORDER_NOT_OPEN', 'ORDER_NOT_OPEN'] && $st === 'confirmed' && Tfm\Subscription::state((int) $u['id'])['expiresAt'] === $s['expiresAt'] ? true : json_encode([$codes, $st]);
});
check('confirm — no answer from the gateway (timeout): 503 PAYMENT_PENDING, the order stays open and claimed; a quick retry is 409; a later one looks it up and activates', function () use ($payUser) {
    $u = $payUser();
    $o = Tfm\Subscription::prepare($u, 3, 'card');
    $k = 'mock_timeout_' . $o['orderId'];
    $c1 = $c2 = '';
    try { Tfm\Subscription::confirm($u, $k, $o['orderId'], $o['amount']); } catch (Tfm\ApiException $e) { $c1 = $e->errorCode . $e->status; }
    $row = Tfm\Db::one('SELECT status, payment_key, toss_status FROM orders WHERE order_id = ?', [$o['orderId']]);
    try { Tfm\Subscription::confirm($u, $k, $o['orderId'], $o['amount']); } catch (Tfm\ApiException $e) { $c2 = $e->errorCode; }
    Tfm\Config::override('toss.confirm_retry_after', 0);
    try { $s = Tfm\Subscription::confirm($u, $k, $o['orderId'], $o['amount']); } finally { Tfm\Config::override('toss.confirm_retry_after', null); }
    return $c1 === 'PAYMENT_PENDING503' && $row['status'] === 'created' && $row['payment_key'] === $k && $row['toss_status'] === 'CONFIRMING' && $c2 === 'ORDER_NOT_OPEN' && $s['tier'] === 3
        ? true : json_encode([$c1, $row, $c2]);
});
/** run PHP code in $n parallel processes against this test's database: the outputs */
$parallel = function (string $code, int $n) use ($srv): array {
    $procs = [];
    for ($i = 0; $i < $n; $i++) {
        $p = proc_open([PHP_BINARY, '-r', 'require $argv[1]; ' . $code, $srv . '/lib/bootstrap.php'], [1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes);
        $procs[] = [$p, $pipes];
    }
    $out = [];
    foreach ($procs as $pp) { $out[] = trim(stream_get_contents($pp[1][1]) . stream_get_contents($pp[1][2])); fclose($pp[1][1]); fclose($pp[1][2]); proc_close($pp[0]); }
    sort($out);
    return $out;
};
check('confirm — 4 processes confirm the same order at the same moment: exactly one succeeds, the period is added once', function () use ($payUser, $parallel) {
    $u = $payUser();
    $o = Tfm\Subscription::prepare($u, 2, 'card');
    $t0 = Tfm\Clock::ms();
    $code = '$u = Tfm\\Users::byId(' . (int) $u['id'] . '); try { Tfm\\Subscription::confirm($u, ' . var_export('mock_slow300_' . $o['orderId'], true) . ', ' . var_export($o['orderId'], true) . ', ' . (int) $o['amount'] . '); echo "ok"; } catch (Tfm\\ApiException $e) { echo $e->errorCode; }';
    $out = $parallel($code, 4);
    $ok = count(array_filter($out, function ($x) { return $x === 'ok'; }));
    $exp = (int) Tfm\Subscription::state((int) $u['id'])['expiresAt'];
    $period = Tfm\Toss::periodDays() * 86400000;
    return $ok === 1 && $exp - $t0 < $period + 120000 && (string) Tfm\Db::value('SELECT status FROM orders WHERE order_id = ?', [$o['orderId']]) === 'confirmed' ? true : json_encode([$out, ($exp - $t0) / 86400000]);
});
check('lazy renewal — 4 processes read an expired auto-renew subscription at once (me / get / status of one page load): one charge (F5)', function () use ($payUser, $parallel) {
    $u = $payUser();
    $o = Tfm\Subscription::prepare($u, 2, 'billing');
    Tfm\Subscription::billingIssue($u, 'mock_auth_ok', $o['customerKey'], $o['orderId']);
    $past = Tfm\Clock::ms() - 3600000;
    Tfm\Db::exec('UPDATE subscriptions SET expires_at = ?, checked_at = 0 WHERE user_id = ?', [$past, (int) $u['id']]);
    $out = $parallel('$s = Tfm\\Subscription::state(' . (int) $u['id'] . '); echo $s["tier"];', 4);
    $renewals = (int) Tfm\Db::value("SELECT COUNT(*) FROM orders WHERE user_id = ? AND kind = 'renewal'", [(int) $u['id']]);
    $st = Tfm\Subscription::state((int) $u['id']);
    return $renewals === 1 && $st['tier'] === 2 && $st['expiresAt'] > Tfm\Clock::ms() ? true : json_encode([$out, $renewals, $st]);
});
check('renewal — the gateway answers another amount for a renewal charge: no extension, past_due, payment_tamper', function () use ($payUser, $secEvents) {
    $u = $payUser();
    $o = Tfm\Subscription::prepare($u, 2, 'billing');
    Tfm\Subscription::billingIssue($u, 'mock_auth_ok', $o['customerKey'], $o['orderId']);
    Tfm\Db::exec('UPDATE subscriptions SET billing_key = ? WHERE user_id = ?', [Tfm\Crypto::seal('mock_bk_amount1_' . bin2hex(random_bytes(6))), (int) $u['id']]);
    $exp = (int) Tfm\Subscription::state((int) $u['id'])['expiresAt'];
    $before = $secEvents('payment_tamper');
    $r = Tfm\Subscription::renewDue((int) $u['id'], true);
    $st = Tfm\Subscription::state((int) $u['id']);
    return $r[0]['ok'] === false && $r[0]['status'] === 'past_due' && $st['expiresAt'] === $exp && $secEvents('payment_tamper') > $before ? true : json_encode([$r, $st]);
});
check('billing-issue — the first charge answers another amount (authKey mock_amount1_…): refused, nothing stored, payment_tamper', function () use ($payUser, $secEvents) {
    $u = $payUser();
    $o = Tfm\Subscription::prepare($u, 4, 'billing');
    $before = $secEvents('payment_tamper');
    $code = '';
    try { Tfm\Subscription::billingIssue($u, 'mock_amount1_auth', $o['customerKey'], $o['orderId']); } catch (Tfm\ApiException $e) { $code = $e->errorCode; }
    $stored = Tfm\Db::value('SELECT billing_key FROM subscriptions WHERE user_id = ?', [(int) $u['id']]);
    return $code === 'PAYMENT_FAILED' && ($stored === null || $stored === '') && $secEvents('payment_tamper') > $before && Tfm\Subscription::tierFor((int) $u['id']) === 1 ? true : json_encode([$code, $stored]);
});
check('payments not configured (no keys, mock off): status mode unconfigured, no client key, prepare 503 PAYMENT_NOT_CONFIGURED without an order', function () use ($payUser) {
    $u = $payUser();
    Tfm\Config::override('toss.mock', false);
    try {
        $mode = Tfm\Toss::mode();
        $ck = Tfm\Toss::clientKey();
        $n0 = (int) Tfm\Db::value('SELECT COUNT(*) FROM orders WHERE user_id = ?', [(int) $u['id']]);
        $refused = throwsApi(function () use ($u) { Tfm\Subscription::prepare($u, 2, 'card'); }, 'PAYMENT_NOT_CONFIGURED');
        $n1 = (int) Tfm\Db::value('SELECT COUNT(*) FROM orders WHERE user_id = ?', [(int) $u['id']]);
        Tfm\Config::override('toss.client_key', 'test_ck_' . str_repeat('A1', 10));
        Tfm\Config::override('toss.secret_key', 'live_sk_' . str_repeat('B2', 10));
        $mixed = Tfm\Toss::keysConfigured();
        Tfm\Config::override('toss.secret_key', 'test_sk_' . str_repeat('B2', 10));
        $own = Tfm\Toss::mode() === 'live' && Tfm\Toss::clientKey() === 'test_ck_' . str_repeat('A1', 10) && !Tfm\Toss::liveKeys();
    } finally {
        foreach (['toss.mock', 'toss.client_key', 'toss.secret_key'] as $k) Tfm\Config::override($k, null);
    }
    return $mode === 'unconfigured' && $ck === '' && $refused && $n1 === $n0 && $mixed === false && $own ? true : json_encode([$mode, $ck, $refused, $n0, $n1, $mixed, $own]);
});

// ------------------------------------------------------------------ payments, review round (item 15: lost update, auto-renew tier, forced renewal)
/** start PHP $code in a child process against this test's database (its stdout is read line by line with $waitFor) */
$child = function (string $code) use ($srv): array {
    $p = proc_open([PHP_BINARY, '-r', 'require $argv[1]; ' . $code, $srv . '/lib/bootstrap.php'], [1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes);
    return [$p, $pipes];
};
/** read the child's stdout until a line equals $marker (true) or it ends / the time is up (false) */
$waitFor = function (array $c, string $marker, float $seconds = 20.0): bool {
    $end = microtime(true) + $seconds;
    while (microtime(true) < $end) {
        $line = fgets($c[1][1]);
        if ($line === false) return false;
        if (rtrim($line, "\r\n") === $marker) return true;
    }
    return false;
};
/** the rest of the child's output (stdout + stderr) after it ended */
$finish = function (array $c): string {
    $out = stream_get_contents($c[1][1]) . stream_get_contents($c[1][2]);
    fclose($c[1][1]);
    fclose($c[1][2]);
    proc_close($c[0]);
    return trim((string) $out);
};
check('activate — two payments of one account at the same moment each add their period (no lost update; matters on MariaDB, where a plain read sees an old snapshot)', function () use ($payUser, $child, $waitFor, $finish) {
    $period = 30 * 86400000;
    foreach (['no subscription yet', 'an active subscription'] as $case) {
        $u = $payUser();
        $uid = (int) $u['id'];
        if ($case === 'an active subscription') Tfm\Subscription::grant(['id' => 0], $uid, 2, 30);
        $t0 = Tfm\Clock::ms();
        $exp0 = (int) Tfm\Db::value('SELECT expires_at FROM subscriptions WHERE user_id = ?', [$uid]);
        $base = max($t0, $exp0);
        // the first payment writes its period and keeps its transaction open for 1.5 s; the second one runs inside that window
        $a = $child('Tfm\\Db::tx(function () { Tfm\\Subscription::grant(["id" => 0], ' . $uid . ', 2, 30); echo "written\n"; fflush(STDOUT); usleep(1500000); }); echo "a-done";');
        if (!$waitFor($a, 'written')) return "$case: the first payment did not start: " . $finish($a);
        $b = $child('Tfm\\Subscription::grant(["id" => 0], ' . $uid . ', 2, 30); echo "b-done";');
        $ob = $finish($b);
        $oa = $finish($a);
        if ($oa !== 'a-done' || $ob !== 'b-done') return "$case: children said " . json_encode([$oa, $ob]);
        $exp = (int) Tfm\Db::value('SELECT expires_at FROM subscriptions WHERE user_id = ?', [$uid]);
        $added = ($exp - $base) / 86400000;
        if ($exp - $base < 2 * $period - 1000 || $exp - $base > 2 * $period + 120000) return sprintf('%s: two 30-day periods added %.2f days', $case, $added);
    }
    return true;
});
check('confirm — two different paid orders of one account confirmed at the same moment (4 rounds): both payments add their period', function () use ($payUser, $child, $finish) {
    $period = Tfm\Toss::periodDays() * 86400000;
    for ($round = 0; $round < 4; $round++) {
        $u = $payUser();
        $t0 = Tfm\Clock::ms();
        $kids = [];
        foreach ([Tfm\Subscription::prepare($u, 2, 'card'), Tfm\Subscription::prepare($u, 2, 'card')] as $o) {
            // both wait 300 ms at the (mock) gateway, so their activations meet
            $kids[] = $child('$u = Tfm\\Users::byId(' . (int) $u['id'] . '); try { Tfm\\Subscription::confirm($u, ' . var_export('mock_slow300_' . $o['orderId'], true) . ', '
                . var_export($o['orderId'], true) . ', ' . (int) $o['amount'] . '); echo "ok"; } catch (Tfm\\ApiException $e) { echo $e->errorCode; }');
        }
        $out = array_map($finish, $kids);
        $exp = (int) Tfm\Subscription::state((int) $u['id'])['expiresAt'];
        $paid = (int) Tfm\Db::value("SELECT COUNT(*) FROM orders WHERE user_id = ? AND status = 'confirmed'", [(int) $u['id']]);
        if ($out !== ['ok', 'ok'] || $paid !== 2) return "round $round: " . json_encode($out) . " · $paid confirmed";
        if ($exp - $t0 < 2 * $period - 1000) return sprintf('round %d: two paid periods but %.2f days', $round, ($exp - $t0) / 86400000);
    }
    return true;
});
/** a player with a tier-$tier auto-renew subscription (billing key, first charge done); $authKey picks the mock behaviour */
$autoRenewUser = function (int $tier, string $authKey = 'mock_auth_ok') use ($payUser): array {
    $u = $payUser();
    $o = Tfm\Subscription::prepare($u, $tier, 'billing');
    Tfm\Subscription::billingIssue($u, $authKey, $o['customerKey'], $o['orderId']);
    return $u;
};
/** the newest renewal order of a player (tier, amount, status) */
$lastRenewal = function (int $uid): ?array { return Tfm\Db::one("SELECT tier, amount, status FROM orders WHERE user_id = ? AND kind = 'renewal' ORDER BY id DESC LIMIT 1", [$uid]); };
$codeOf = function (callable $fn): string { try { $fn(); return 'ok'; } catch (Tfm\ApiException $e) { return $e->errorCode . ' ' . $e->status; } };
check('auto-renew — a one-month pass for another tier is refused while auto-renew is on (prepare, and confirm before the gateway is asked); the same tier adds a month and the renewal still charges the registered price', function () use ($payUser, $autoRenewUser, $lastRenewal, $codeOf) {
    $u = $autoRenewUser(2);
    $uid = (int) $u['id'];
    $exp0 = (int) Tfm\Subscription::state($uid)['expiresAt'];
    $n0 = (int) Tfm\Db::value('SELECT COUNT(*) FROM orders WHERE user_id = ?', [$uid]);
    $c = $codeOf(function () use ($u) { Tfm\Subscription::prepare($u, 4, 'card'); });
    $n1 = (int) Tfm\Db::value('SELECT COUNT(*) FROM orders WHERE user_id = ?', [$uid]);
    if ($c !== 'SUB_AUTO_RENEW_ON 409' || $n1 !== $n0) return "prepare tier 4 card while tier-2 auto-renew is on: $c, orders $n0 → $n1";
    // a card order made before auto-renew was turned on: refused at confirm, nothing claimed, no payment taken
    $v = $payUser();
    $card = Tfm\Subscription::prepare($v, 4, 'card');
    $ob = Tfm\Subscription::prepare($v, 2, 'billing');
    Tfm\Subscription::billingIssue($v, 'mock_auth_ok', $ob['customerKey'], $ob['orderId']);
    $c2 = $codeOf(function () use ($v, $card) { Tfm\Subscription::confirm($v, 'mock_' . $card['orderId'], $card['orderId'], $card['amount']); });
    $row = Tfm\Db::one('SELECT status, payment_key FROM orders WHERE order_id = ?', [$card['orderId']]);
    $sv = Tfm\Subscription::state((int) $v['id']);
    if ($c2 !== 'SUB_AUTO_RENEW_ON 409' || $row['status'] !== 'created' || $row['payment_key'] !== '' || $sv['tier'] !== 2 || $sv['autoRenew'] !== true) return 'confirm of an older tier-4 card order: ' . json_encode([$c2, $row, $sv]);
    // the same tier: one more month, auto-renew stays on
    $same = Tfm\Subscription::prepare($u, 2, 'card');
    $s = Tfm\Subscription::confirm($u, 'mock_' . $same['orderId'], $same['orderId'], $same['amount']);
    if ($s['tier'] !== 2 || $s['autoRenew'] !== true || abs($s['expiresAt'] - ($exp0 + 30 * 86400000)) > 60000) return 'same-tier pass: ' . json_encode($s);
    Tfm\Db::exec('UPDATE subscriptions SET expires_at = ? WHERE user_id = ?', [Tfm\Clock::ms() + 3600000, $uid]);
    $r = Tfm\Subscription::renewDue($uid);
    $ren = $lastRenewal($uid);
    return isset($r[0]['ok']) && $r[0]['ok'] === true && $ren && (int) $ren['tier'] === 2 && (int) $ren['amount'] === Tfm\Toss::price(2) && $ren['status'] === 'confirmed' ? true : 'renewal: ' . json_encode([$r, $ren]);
});
check('auto-renew — an admin grant of another tier is refused while auto-renew is on (API / admin site / cli sub:grant): the next charge and the paid days stay; the same tier only adds days; after the player turns auto-renew off any tier can be granted', function () use ($srv, $tmp, $autoRenewUser, $lastRenewal, $codeOf) {
    $u = $autoRenewUser(2);
    $uid = (int) $u['id'];
    $exp0 = (int) Tfm\Subscription::state($uid)['expiresAt'];
    $c = $codeOf(function () use ($uid) { Tfm\Subscription::grant(['id' => 0], $uid, 4, 7); });
    $st = Tfm\Subscription::state($uid);
    if ($c !== 'SUB_AUTO_RENEW_ON 409' || $st['tier'] !== 2 || $st['expiresAt'] !== $exp0 || $st['autoRenew'] !== true) return 'grant tier 4: ' . json_encode([$c, $st]);
    exec('TFM_DATA_DIR=' . escapeshellarg($tmp) . ' TFM_TOSS_MOCK=1 ' . escapeshellarg(PHP_BINARY) . ' ' . escapeshellarg($srv . '/cli/tfm.php') . ' sub:grant ' . escapeshellarg((string) $u['email']) . ' 4 7 2>&1', $cliOut, $cliCode);
    if ($cliCode === 0 || strpos(implode("\n", $cliOut), '자동 갱신') === false || Tfm\Subscription::state($uid)['tier'] !== 2) return 'cli sub:grant 4 7: exit ' . $cliCode . ' ' . implode(' / ', $cliOut);
    $g = Tfm\Subscription::grant(['id' => 0], $uid, 2, 7);
    if ($g['sub']['tier'] !== 2 || $g['sub']['autoRenew'] !== true || abs($g['sub']['expiresAt'] - ($exp0 + 7 * 86400000)) > 60000) return 'same-tier grant: ' . json_encode($g['sub']);
    Tfm\Db::exec('UPDATE subscriptions SET expires_at = ? WHERE user_id = ?', [Tfm\Clock::ms() + 3600000, $uid]);
    Tfm\Subscription::renewDue($uid);
    $ren = $lastRenewal($uid);
    if (!$ren || (int) $ren['tier'] !== 2 || (int) $ren['amount'] !== Tfm\Toss::price(2)) return 'renewal after the grant: ' . json_encode($ren);
    Tfm\Subscription::cancelAutoRenew($u);
    $g4 = Tfm\Subscription::grant(['id' => 0], $uid, 4, 7);
    return $g4['sub']['tier'] === 4 && $g4['sub']['autoRenew'] === false ? true : 'grant after auto-renew off: ' . json_encode($g4['sub']);
});
check('auto-renew — a renewal charges the tier the card was registered for, even when the stored tier was changed behind its back (a database edit): no higher price, an alert in the audit log', function () use ($autoRenewUser, $lastRenewal) {
    $u = $autoRenewUser(2);
    $uid = (int) $u['id'];
    Tfm\Db::exec('UPDATE subscriptions SET tier = 4, expires_at = ? WHERE user_id = ?', [Tfm\Clock::ms() + 3600000, $uid]);
    $r = Tfm\Subscription::renewDue($uid);
    $ren = $lastRenewal($uid);
    $st = Tfm\Subscription::state($uid);
    $alert = (int) Tfm\Db::value("SELECT COUNT(*) FROM audit_log WHERE user_id = ? AND event = 'sub_renew_tier' AND severity = 'alert'", [$uid]);
    return $ren && (int) $ren['tier'] === 2 && (int) $ren['amount'] === Tfm\Toss::price(2) && $st['tier'] === 2 && $st['autoRenew'] === true && $alert === 1 ? true : json_encode([$r, $ren, $st, $alert]);
});
check('auto-renew — turning auto-renew off while a renewal is being charged is kept (the finished renewal does not switch it back on)', function () use ($autoRenewUser, $child, $finish) {
    $u = $autoRenewUser(2, 'mock_slow1500_auth'); // its charges answer after 1.5 s
    $uid = (int) $u['id'];
    Tfm\Db::exec('UPDATE subscriptions SET expires_at = ? WHERE user_id = ?', [Tfm\Clock::ms() + 3600000, $uid]);
    $k = $child('echo json_encode(Tfm\\Subscription::renewDue(' . $uid . '));');
    $charging = false;
    for ($i = 0; $i < 100 && !$charging; $i++) {
        $charging = (int) Tfm\Db::value("SELECT COUNT(*) FROM orders WHERE user_id = ? AND kind = 'renewal' AND status = 'created'", [$uid]) === 1;
        if (!$charging) usleep(50000);
    }
    if ($charging) Tfm\Subscription::cancelAutoRenew($u);
    $out = $finish($k);
    $row = Tfm\Db::one('SELECT auto_renew, status, expires_at FROM subscriptions WHERE user_id = ?', [$uid]);
    $ren = Tfm\Db::value("SELECT status FROM orders WHERE user_id = ? AND kind = 'renewal' ORDER BY id DESC LIMIT 1", [$uid]);
    return $charging && (int) $row['auto_renew'] === 0 && $ren === 'confirmed' && $row['status'] === 'active' ? true : json_encode([$charging, $out, $row, $ren]);
});
check('auto-renew — a race the refusal cannot see (a tier-4 pass is confirmed while a tier-2 registration finishes): auto-renew ends up off, never armed at tier 4', function () use ($payUser, $child, $finish) {
    $u = $payUser();
    $uid = (int) $u['id'];
    $card = Tfm\Subscription::prepare($u, 4, 'card');
    $bill = Tfm\Subscription::prepare($u, 2, 'billing');
    // the pass passes the auto-renew check (nothing registered yet), then waits 1.5 s at the (mock) gateway
    $k = $child('$u = Tfm\\Users::byId(' . $uid . '); try { Tfm\\Subscription::confirm($u, ' . var_export('mock_slow1500_' . $card['orderId'], true) . ', ' . var_export($card['orderId'], true) . ', ' . (int) $card['amount'] . '); echo "ok"; } catch (Tfm\\ApiException $e) { echo $e->errorCode; }');
    $claimed = false;
    for ($i = 0; $i < 100 && !$claimed; $i++) {
        $claimed = (string) Tfm\Db::value('SELECT toss_status FROM orders WHERE order_id = ?', [$card['orderId']]) === 'CONFIRMING';
        if (!$claimed) usleep(20000);
    }
    Tfm\Subscription::billingIssue($u, 'mock_auth_ok', $bill['customerKey'], $bill['orderId']);
    $out = $finish($k);
    $row = Tfm\Db::one('SELECT tier, auto_renew FROM subscriptions WHERE user_id = ?', [$uid]);
    $off = (int) Tfm\Db::value("SELECT COUNT(*) FROM audit_log WHERE user_id = ? AND event = 'sub_autorenew_off'", [$uid]);
    return $claimed && $out === 'ok' && (int) $row['tier'] === 4 && (int) $row['auto_renew'] === 0 && $off === 1 ? true : json_encode([$claimed, $out, $row, $off]);
});
check('renewal — a forced renewal ("지금 갱신 시도", renew.php force, sub:renew --force) charges at most once per period: a repeat (double click, two admins, all users, cli) is skipped, also 3 at once; a failed renewal can be retried', function () use ($srv, $tmp, $autoRenewUser, $parallel) {
    $renewals = function (int $uid): array { return Tfm\Db::all("SELECT status FROM orders WHERE user_id = ? AND kind = 'renewal' ORDER BY id", [$uid]); };
    $skipOf = function (array $results, int $uid): string {
        foreach ($results as $r) if ((int) $r['userId'] === $uid) return isset($r['skipped']) ? (string) $r['skipped'] : ($r['ok'] ? 'charged' : 'failed:' . (isset($r['status']) ? $r['status'] : ''));
        return 'absent';
    };
    $u = $autoRenewUser(2);
    $uid = (int) $u['id'];
    $first = $skipOf(Tfm\Subscription::renewDue($uid, true), $uid); // one early renewal on request is allowed
    $exp1 = (int) Tfm\Subscription::state($uid)['expiresAt'];
    $again = $skipOf(Tfm\Subscription::renewDue($uid, true), $uid);
    $everyone = $skipOf(Tfm\Subscription::renewDue(null, true), $uid);
    exec('TFM_DATA_DIR=' . escapeshellarg($tmp) . ' TFM_TOSS_MOCK=1 ' . escapeshellarg(PHP_BINARY) . ' ' . escapeshellarg($srv . '/cli/tfm.php') . ' sub:renew --force ' . escapeshellarg((string) $u['email']) . ' 2>&1', $cliOut, $cliCode);
    $n = count($renewals($uid));
    $exp2 = (int) Tfm\Subscription::state($uid)['expiresAt'];
    if ($first !== 'charged' || $again !== 'already renewed' || $everyone !== 'already renewed' || strpos(implode("\n", $cliOut), 'already renewed') === false || $n !== 1 || $exp2 !== $exp1) {
        return 'repeat: ' . json_encode([$first, $again, $everyone, implode(' / ', $cliOut), $n, ($exp2 - $exp1) / 86400000]);
    }
    $v = $autoRenewUser(3);
    $parallel('echo json_encode(Tfm\\Subscription::renewDue(' . (int) $v['id'] . ', true));', 3);
    if (count($renewals((int) $v['id'])) !== 1) return '3 forced renewals at once: ' . json_encode($renewals((int) $v['id']));
    $w = $autoRenewUser(2, 'mock_auth_fail'); // the first charge works, every renewal is declined
    $f1 = $skipOf(Tfm\Subscription::renewDue((int) $w['id'], true), (int) $w['id']);
    $f2 = $skipOf(Tfm\Subscription::renewDue((int) $w['id'], true), (int) $w['id']);
    return $f1 === 'failed:past_due' && $f2 === 'failed:past_due' && count($renewals((int) $w['id'])) === 2 ? true : 'retry after a failure: ' . json_encode([$f1, $f2, $renewals((int) $w['id'])]);
});
// ------------------------------------------------------------------ secret:rotate (item 21)
check('secret:rotate --data-key — every sealed billing key is sealed again with the new key, the old key is gone, rotated_at is set', function () use ($payUser) {
    $u = $payUser();
    $o = Tfm\Subscription::prepare($u, 2, 'billing');
    Tfm\Subscription::billingIssue($u, 'mock_auth_ok', $o['customerKey'], $o['orderId']);
    $before = Tfm\Db::all("SELECT user_id, billing_key FROM subscriptions WHERE billing_key <> '' ORDER BY user_id");
    $plain = [];
    foreach ($before as $r) $plain[(int) $r['user_id']] = Tfm\Crypto::open((string) $r['billing_key']);
    $oldKey = Tfm\Secrets::read(true)['data_key'];
    $kept = Tfm\Crypto::seal('sealed with the old key');
    $r = Tfm\Installer::rotateSecrets(false, true);
    $s = Tfm\Secrets::read(true);
    if ($s['data_key'] === $oldKey || isset($s['data_key_prev']) || empty($s['rotated_at']['data_key'])) return 'secret.php: ' . json_encode(array_keys($s));
    foreach (Tfm\Db::all("SELECT user_id, billing_key FROM subscriptions WHERE billing_key <> '' ORDER BY user_id") as $row) {
        $v = (string) $row['billing_key'];
        if (strpos($v, 'enc:v1:') !== 0 || Tfm\Crypto::open($v) !== $plain[(int) $row['user_id']] || Tfm\Crypto::needsReseal($v)) return 'user ' . $row['user_id'] . ' not re-sealed';
    }
    $renew = Tfm\Subscription::renewDue((int) $u['id'], true);
    return $r['dataKey'] === true && $r['resealed'] >= count($before) && Tfm\Crypto::open($kept) === null && $renew[0]['ok'] === true ? true : json_encode([$r, $renew]);
});
check('secret:rotate --app-key — sessions end (files + session_epoch), rate-limit / login-attempt rows cleared, IP block hashes rebuilt with the new key', function () use ($tmp, $payUser) {
    $u = $payUser();
    $sessDir = Tfm\Config::dataDir() . '/sessions';
    if (!is_dir($sessDir)) mkdir($sessDir, 0700, true);
    file_put_contents($sessDir . '/sess_unitrotate', 'x');
    Tfm\RateLimit::hit('unit_rotate', 'someone', 100, 60);
    Tfm\LoginThrottle::record('rotate@example.com', false);
    $blocked = class_exists('Tfm\\Firewall');
    if ($blocked) Tfm\Firewall::block('203.0.113.99', 600, 'unit rotate');
    $epoch = (int) Tfm\Db::value('SELECT session_epoch FROM users WHERE id = ?', [(int) $u['id']]);
    $oldApp = Tfm\Secrets::read(true)['app_key'];
    $r = Tfm\Installer::rotateSecrets(true, false);
    $newApp = Tfm\Secrets::read(true)['app_key'];
    if ($newApp === $oldApp || empty(Tfm\Secrets::read(true)['rotated_at']['app_key'])) return 'app_key unchanged';
    if (is_file($sessDir . '/sess_unitrotate')) return 'a session file survived';
    if ((int) Tfm\Db::value('SELECT COUNT(*) FROM rate_limits') !== 0 || (int) Tfm\Db::value('SELECT COUNT(*) FROM login_attempts') !== 0) return 'counters not cleared';
    if ((int) Tfm\Db::value('SELECT session_epoch FROM users WHERE id = ?', [(int) $u['id']]) !== $epoch + 1) return 'session_epoch not bumped';
    if ($blocked && (string) Tfm\Db::value('SELECT ip_hash FROM ip_blocks WHERE ip = ?', ['203.0.113.99']) !== substr(hash_hmac('sha256', '203.0.113.99', $newApp), 0, 32)) return 'the block hash was not rebuilt';
    return $r['appKey'] === true && $r['sessions'] >= 1;
});
check('cli secret:rotate — prints what changed and the steps for the external keys (토스, Anthropic), never a key value', function () use ($srv, $tmp) {
    $out = (string) shell_exec('TFM_DATA_DIR=' . escapeshellarg($tmp) . ' ' . escapeshellarg(PHP_BINARY) . ' ' . escapeshellarg($srv . '/cli/tfm.php') . ' secret:rotate --data-key 2>&1');
    $s = Tfm\Secrets::read(true);
    if (strpos($out, '토스페이먼츠') === false || strpos($out, 'console.anthropic.com') === false || strpos($out, '데이터 키') === false) return 'output: ' . substr($out, 0, 300);
    foreach (['app_key', 'data_key'] as $k) if (strpos($out, (string) $s[$k]) !== false) return "$k printed";
    Tfm\Crypto::reset();
    return true;
});
Tfm\Db::reset();

// ------------------------------------------------------------------ Installer: dedicated least-privilege account (item 1a, 1b, 21) — MariaDB only
// databases and accounts of this file carry the data agent's prefix (tfm_data…); other runs share the scratch server
$DB2 = 'tfm_data_u2';
$DB1 = (string) (getenv('TFM_DB_NAME') ?: 'tfm_data_u1');
$adm = ['host' => (string) (getenv('TFM_DB_HOST') ?: '127.0.0.1'), 'port' => (int) (getenv('TFM_DB_PORT') ?: 3306), 'username' => (string) (getenv('TFM_DB_USER') ?: 'root'), 'password' => (string) getenv('TFM_DB_PASS'), 'database' => $DB2];
$adminPdo = null;
/** the accounts with a grant on $DB2 (made by this file only: the installer runs, the limited account) */
$listAccounts = function () use (&$adminPdo, $DB2): array {
    $st = $adminPdo->prepare("SELECT User, Host FROM mysql.db WHERE REPLACE(Db, '\\\\', '') = ? ORDER BY User, Host");
    $st->execute([$DB2]);
    return array_map(function ($r) { return $r['User'] . '@' . $r['Host']; }, $st->fetchAll());
};
$installInput = function (array $over = []) use ($adm, $DB2): array {
    return $over + ['driver' => 'mysql', 'host' => $adm['host'], 'port' => (string) $adm['port'], 'database' => $DB2, 'username' => $adm['username'], 'password' => $adm['password'], 'create_db' => true,
        'admin_email' => 'owner@example.com', 'admin_nickname' => '운영자', 'admin_password' => 'Sunny-Jar-4821', 'toss_mock' => true];
};
if ($IS_MYSQL) {
    $adminPdo = Tfm\Db::connectMysql($adm, false);
    $adminPdo->exec("DROP DATABASE IF EXISTS `$DB2`");
}
$run1 = null;
mysqlOnly('install — a dedicated account tfm_<8 hex> is created; only it (never the administrator) is written to config.local.php, auto_migrate off', function () use (&$run1, $installInput, $cfgFile, $adm) {
    @unlink(Tfm\Installer::lockPath());
    $run1 = Tfm\Installer::run($installInput());
    $c = Tfm\Installer::readLocalConfig();
    $raw = (string) file_get_contents($cfgFile);
    if (empty($run1['dbAccount']['dedicated'])) return 'not dedicated: ' . json_encode($run1['dbAccount']);
    if (!preg_match('/^tfm_[0-9a-f]{8}$/', (string) $c['db']['mysql']['username']) || $c['db']['mysql']['username'] !== $run1['dbAccount']['user']) return 'user: ' . $c['db']['mysql']['username'];
    if (!preg_match('/^[A-Za-z0-9]{32}$/', (string) $c['db']['mysql']['password'])) return 'the password is not 32 random letters / digits';
    if ($c['db']['auto_migrate'] !== false) return 'auto_migrate is not false';
    if (strpos($raw, "'" . $adm['username'] . "'") !== false) return 'the administrator name is in config.local.php';
    return $run1['schema'] === Tfm\Db::SCHEMA_VERSION && $run1['adminCreated'] === true;
});
mysqlOnly('install — the runtime account: not root, a password, no global and no DDL privileges, exactly SELECT / INSERT / UPDATE / DELETE on the app database', function () use ($DB2) {
    $a = Tfm\Db::accountAudit();
    if ($a['isRoot'] || $a['emptyPassword'] || $a['globalPrivileges'] || $a['ddlPrivileges'] || $a['otherDatabases']) return json_encode($a);
    $all = implode(' | ', $a['grants']);
    if (!preg_match('/GRANT SELECT, INSERT, UPDATE, DELETE ON `' . str_replace('_', '\\\\_', $DB2) . '`\.\* TO/', $all)) return 'grants (the database name must be exact: _ escaped): ' . $all;
    return !preg_match("/'\*[0-9A-F]{40}'/", $all) && $a['database'] === $DB2 ? true : 'a password hash is in the grants: ' . $all;
});
mysqlOnly('Db::accountAudit — grants every account has (PUBLIC role / the default "test" databases) are reported apart: testDatabaseOpen, not the account\'s own DDL', function () use (&$adminPdo) {
    $a = Tfm\Db::accountAudit();
    foreach (['publicGrants', 'visibleDatabases', 'testDatabaseOpen'] as $k) if (!array_key_exists($k, $a)) return "missing $k";
    $open = (bool) $adminPdo->query("SELECT COUNT(*) FROM information_schema.SCHEMATA WHERE SCHEMA_NAME LIKE 'test%'")->fetchColumn() || $a['publicGrants'] !== [];
    if ($a['ddlPrivileges'] || $a['otherDatabases']) return 'server-wide grants counted as the account\'s own: ' . json_encode($a['extraPrivileges']);
    foreach (array_merge($a['grants'], $a['publicGrants']) as $g) if (preg_match("/'\\*[0-9A-F]{40}'/", $g)) return 'a password hash in: ' . $g;
    return is_bool($a['testDatabaseOpen']) && ($open ? true : $a['testDatabaseOpen'] === false) ? true : json_encode($a);
});
mysqlOnly('install — the runtime account reads and writes rows but cannot CREATE / ALTER / DROP, read mysql.user or use another database', function () use ($DB1) {
    $pdo = Tfm\Db::pdo();
    Tfm\Db::exec('INSERT INTO rate_limits (bucket, hits, expires_at) VALUES (?, 1, 0)', ['unit-probe']);
    $n = Tfm\Db::exec('DELETE FROM rate_limits WHERE bucket = ?', ['unit-probe']);
    if ($n !== 1) return 'rows cannot be written';
    foreach (['CREATE TABLE tfm_x (id INT)', 'ALTER TABLE users ADD COLUMN x INT', 'DROP TABLE rate_limits', 'SELECT User FROM mysql.user', 'SELECT 1 FROM `' . $DB1 . '`.users LIMIT 1', "CREATE USER 'tfm_data_evil'@'localhost'", 'CREATE DATABASE tfm_data_evil'] as $sql) {
        try { $pdo->exec($sql); return 'allowed: ' . $sql; } catch (PDOException $e) { /* refused */ }
    }
    return true;
});
mysqlOnly('install again (lock removed) — the same account is kept, its password is new, the old password no longer works', function () use (&$run1, $installInput, $adm, $DB2) {
    $old = Tfm\Installer::readLocalConfig()['db']['mysql'];
    @unlink(Tfm\Installer::lockPath());
    $r = Tfm\Installer::run($installInput());
    $new = Tfm\Installer::readLocalConfig()['db']['mysql'];
    if ($new['username'] !== $old['username'] || $new['password'] === $old['password'] || empty($r['dbAccount']['dedicated'])) return 'account not reused or password unchanged';
    try { Tfm\Db::connectMysql($old, true); return 'the old password still works'; } catch (PDOException $e) { /* refused */ }
    return (int) Tfm\Db::value('SELECT COUNT(*) FROM users') === 1 && $r['adminCreated'] === false;
});
mysqlOnly('upgrade — schema behind: the runtime account answers SCHEMA_OUTDATED; migrateAsAdmin applies it with a temporary administrator connection', function () use (&$adminPdo, $adm, $DB2) {
    $adminPdo->exec("DELETE FROM `$DB2`.schema_version WHERE version = " . Tfm\Db::SCHEMA_VERSION);
    Tfm\Db::reset();
    if (!throwsApi(function () { Tfm\Db::pdo(); }, 'SCHEMA_OUTDATED')) return 'no SCHEMA_OUTDATED';
    $r = Tfm\Installer::migrateAsAdmin($adm['username'], $adm['password']);
    if ($r['from'] !== Tfm\Db::SCHEMA_VERSION - 1 || $r['to'] !== Tfm\Db::SCHEMA_VERSION) return json_encode($r);
    $a = Tfm\Db::accountAudit(); // back on the runtime account
    return preg_match('/^tfm_[0-9a-f]{8}$/', $a['user']) === 1 && !$a['ddlPrivileges'] && strpos((string) file_get_contents(Tfm\Installer::configPath()), "'" . $adm['username'] . "'") === false;
});
mysqlOnly('upgrade — migrateAsAdmin with a wrong administrator password: a Korean DB_CONNECT error, nothing changes', function () use ($adm) {
    return throwsApi(function () use ($adm) { Tfm\Installer::migrateAsAdmin($adm['username'], 'definitely-wrong-' . bin2hex(random_bytes(4))); }, 'DB_CONNECT')
        && Tfm\Db::schemaVersion() === Tfm\Db::SCHEMA_VERSION;
});
mysqlOnly('db:rotate-password — a new random password for the runtime account on every host, config.local.php rewritten (0600), the old one refused', function () use ($adm, $cfgFile) {
    $old = Tfm\Installer::readLocalConfig()['db']['mysql'];
    $r = Tfm\Installer::rotateDbPassword($adm['username'], $adm['password']);
    $new = Tfm\Installer::readLocalConfig()['db']['mysql'];
    if ($new['username'] !== $old['username'] || $new['password'] === $old['password'] || !preg_match('/^[A-Za-z0-9]{32}$/', $new['password'])) return 'password not rotated';
    try { Tfm\Db::connectMysql($old, true); return 'the old password still works'; } catch (PDOException $e) { /* refused */ }
    foreach (['127.0.0.1', 'localhost'] as $h) { try { Tfm\Db::connectMysql(['host' => $h] + $new, true); } catch (PDOException $e) { if ($h === '127.0.0.1') return 'the new password does not work'; } }
    clearstatcache();
    return count($r['hosts']) >= 1 && (int) Tfm\Db::value('SELECT COUNT(*) FROM users') === 1 && (fileperms($cfgFile) & 0777) === 0600 && Tfm\Installer::readLocalConfig()['db']['auto_migrate'] === false;
});
mysqlOnly('db:rotate-password — refuses to change the password of the administrator account itself (no dedicated account yet)', function () use ($adm) {
    $keep = Tfm\Installer::readLocalConfig();
    Tfm\Installer::mergeLocalConfig(['db' => ['mysql' => ['username' => $adm['username'], 'password' => $adm['password']]]]);
    Tfm\Db::reset();
    $refused = throwsApi(function () use ($adm) { Tfm\Installer::rotateDbPassword($adm['username'], $adm['password']); }, 'DB_SAME_ACCOUNT');
    Tfm\Installer::writeConfig($keep);
    Tfm\Config::reset();
    Tfm\Db::reset();
    return $refused;
});
mysqlOnly('db:account — an installation that runs as the administrator is moved to a dedicated account (existing data kept)', function () use ($adm, $DB2) {
    Tfm\Installer::writeConfig(['db' => ['driver' => 'mysql', 'mysql' => ['host' => $adm['host'], 'port' => $adm['port'], 'database' => $DB2, 'username' => $adm['username'], 'password' => $adm['password']]]]);
    Tfm\Config::reset();
    Tfm\Db::reset();
    if (!Tfm\Db::accountAudit()['isRoot'] && $adm['username'] === 'root') return 'setup: not running as root';
    $r = Tfm\Installer::switchToAppAccount($adm['username'], $adm['password']);
    $a = Tfm\Db::accountAudit();
    $c = Tfm\Installer::readLocalConfig();
    return preg_match('/^tfm_[0-9a-f]{8}$/', $a['user']) === 1 && $a['user'] === $r['user'] && !$a['ddlPrivileges'] && !$a['globalPrivileges'] && $c['db']['auto_migrate'] === false
        && (int) Tfm\Db::value('SELECT COUNT(*) FROM users') === 1 ? true : json_encode($a);
});
mysqlOnly('install — an administrator without CREATE USER: the typed account is used and flagged, the SQL to run by hand is returned (no password in it)', function () use (&$adminPdo, $installInput, $DB2) {
    $lim = 'tfm_data_lim' . bin2hex(random_bytes(3));
    $pw = 'Lim' . bin2hex(random_bytes(8));
    foreach (['localhost', '127.0.0.1'] as $h) {
        $adminPdo->exec("CREATE USER '$lim'@'$h' IDENTIFIED BY '$pw'");
        $adminPdo->exec("GRANT ALL PRIVILEGES ON `" . str_replace('_', '\\_', $DB2) . "`.* TO '$lim'@'$h'");
    }
    @unlink(Tfm\Installer::lockPath());
    $r = Tfm\Installer::run($installInput(['username' => $lim, 'password' => $pw, 'create_db' => false]));
    $c = Tfm\Installer::readLocalConfig();
    $acct = $r['dbAccount'];
    if ($acct['dedicated'] !== false || $acct['reason'] !== 'no_create_user') return json_encode($acct);
    $sql = implode("\n", $acct['manual']);
    if (strpos($sql, 'CREATE USER') === false || strpos($sql, 'GRANT SELECT, INSERT, UPDATE, DELETE ON') === false || strpos($sql, $pw) !== false) return 'manual SQL: ' . $sql;
    return $c['db']['mysql']['username'] === $lim && !array_key_exists('auto_migrate', $c['db']) && Tfm\Db::accountAudit()['ddlPrivileges'] === true;
});
mysqlOnly('install — the checkbox off: the typed account is used (flagged as chosen), no account is created', function () use (&$adminPdo, $installInput, $listAccounts) {
    $before = $listAccounts();
    @unlink(Tfm\Installer::lockPath());
    $r = Tfm\Installer::run($installInput(['app_account' => false]));
    return $r['dbAccount']['dedicated'] === false && $r['dbAccount']['reason'] === 'not_requested' && $listAccounts() === $before && Tfm\Db::accountAudit()['isRoot'] === true;
});
if ($IS_MYSQL) {
    // leave the scratch server as it was: the accounts with a grant on this file's own database are the ones it made
    foreach ($listAccounts() as $acct) {
        list($u, $h) = explode('@', $acct, 2);
        $adminPdo->exec('DROP USER IF EXISTS ' . $adminPdo->quote($u) . '@' . $adminPdo->quote($h));
    }
    $adminPdo->exec("DROP DATABASE IF EXISTS `$DB2`");
    $adminPdo = null;
}
@unlink(Tfm\Installer::lockPath());
@unlink($cfgFile);
Tfm\Config::reset();
Tfm\Db::reset();

// ------------------------------------------------------------------ install.php over HTTP (finding F1, attack-suite S16) — a private copy on port 18771
/** a tiny HTTP client with a cookie jar: [status, headers (lower-case name => value), body] */
function http(string $method, string $url, array $form = [], array &$jar = [], array $headers = []): array
{
    $h = $headers;
    if ($jar) $h[] = 'Cookie: ' . implode('; ', array_map(function ($k, $v) { return "$k=$v"; }, array_keys($jar), $jar));
    $opts = ['method' => $method, 'ignore_errors' => true, 'follow_location' => 0, 'timeout' => 20, 'header' => implode("\r\n", $h)];
    if ($method === 'POST') {
        $opts['content'] = http_build_query($form);
        $opts['header'] .= ($opts['header'] !== '' ? "\r\n" : '') . 'Content-Type: application/x-www-form-urlencoded';
    }
    $body = @file_get_contents($url, false, stream_context_create(['http' => $opts]));
    $status = 0;
    $out = [];
    foreach (isset($http_response_header) ? $http_response_header : [] as $line) {
        if (preg_match('#^HTTP/\S+ (\d{3})#', $line, $m)) { $status = (int) $m[1]; $out = []; continue; }
        $p = strpos($line, ':');
        if ($p === false) continue;
        $name = strtolower(trim(substr($line, 0, $p)));
        $val = trim(substr($line, $p + 1));
        $out[$name] = isset($out[$name]) ? $out[$name] . "\n" . $val : $val;
        if ($name === 'set-cookie' && preg_match('/^([^=;\s]+)=([^;]*)/', $val, $c)) $jar[$c[1]] = $c[2];
    }
    return [$status, $out, (string) $body];
}
$webRoot = sys_get_temp_dir() . '/tfm-secdata-web-' . bin2hex(random_bytes(5));
$webSrv = $webRoot . '/srv';
$webData = $webRoot . '/data';
mkdir($webData, 0700, true);
copyTree(__DIR__ . '/../server', $webSrv);
@unlink($webSrv . '/config/config.local.php');
$webPort = 18771;
$webProc = proc_open([PHP_BINARY, '-d', 'display_errors=1', '-d', 'expose_php=1', '-S', "127.0.0.1:$webPort", '-t', $webSrv],
    [0 => ['pipe', 'r'], 1 => ['file', $webRoot . '/php-s.log', 'a'], 2 => ['file', $webRoot . '/php-s.log', 'a']], $pipes, $webSrv,
    ['TFM_DATA_DIR' => $webData, 'TFM_TOSS_MOCK' => '1', 'PATH' => (string) getenv('PATH')]);
for ($i = 0; $i < 100; $i++) { $s = @fsockopen('127.0.0.1', $webPort, $en, $es, 0.2); if ($s) { fclose($s); break; } usleep(100000); }
$base = "http://127.0.0.1:$webPort/";
$jar = [];
$page = [0, [], ''];
check('install.php (open, fresh server) — the form asks for the setup code and never shows it; no PHP version, no server path', function () use ($base, &$jar, &$page, $webData, $webSrv) {
    $page = http('GET', $base . 'install.php', [], $jar);
    list($st, $hd, $body) = $page;
    if ($st !== 200) return "GET → $st " . substr($body, 0, 120);
    if (strpos($body, 'name="setup_code"') === false) return 'no setup code field';
    $code = (string) (setupCodeOf($webData));
    if ($code === '' || stripos($body, $code) !== false || stripos($body, implode('-', str_split($code, 4))) !== false) return 'the code is missing on the server or shown on the page';
    if (strpos($body, 'php cli/tfm.php setup-code') === false) return 'the page does not tell how to read the code';
    if (strpos($body, PHP_VERSION) !== false || strpos($body, $webSrv) !== false || strpos($body, $webData) !== false) return 'the page shows the PHP version or a server path';
    if (isset($hd['x-powered-by'])) return 'X-Powered-By: ' . $hd['x-powered-by'];
    return strpos((string) (isset($hd['content-security-policy']) ? $hd['content-security-policy'] : ''), "script-src 'none'") !== false || strpos($body, '<script') === false ? true : 'scripts on the page';
});
/** the code in data/setup-code.php of the web instance (read the way the operator does: from the file) */
function setupCodeOf(string $dataDir): string
{
    $raw = (string) @file_get_contents($dataDir . '/setup-code.php');
    return preg_match("/'code' => '([A-Z0-9]{12})'/", $raw, $m) ? $m[1] : '';
}
$formOf = function (string $html): array {
    $f = [];
    if (preg_match('/name="_csrf" value="([^"]+)"/', $html, $m)) $f['_csrf'] = html_entity_decode($m[1]);
    return $f + ['driver' => 'sqlite', 'admin_email' => 'owner@example.com', 'admin_nickname' => '운영자', 'admin_password' => 'Sunny-Jar-4821', 'app_account' => '1'];
};
check('install.php POST without / with a wrong setup code — 403, nothing written, no PHP version in the answer', function () use ($base, &$jar, &$page, $formOf, $webSrv) {
    foreach (['', 'ABCD-EFGH-JKMN', '" onmouseover="x'] as $wrong) {
        $r = http('POST', $base . 'install.php', ['setup_code' => $wrong] + $formOf($page[2]), $jar);
        if ($r[0] !== 403) return "code " . json_encode($wrong) . " → {$r[0]}";
        if (strpos($r[2], PHP_VERSION) !== false) return 'the answer shows the PHP version';
        if (strpos($r[2], '" onmouseover="x') !== false) return 'the posted code is printed back raw';
        if (is_file($webSrv . '/config/config.local.php')) return 'config.local.php was written';
        $page = $r;
    }
    return true;
});
check('install.php POST with the setup code — installs (SQLite), the code is used up, then GET and POST answer a plain 404', function () use ($base, &$jar, &$page, $formOf, $webSrv, $webData) {
    $code = setupCodeOf($webData);
    $r = http('POST', $base . 'install.php', ['setup_code' => strtolower($code)] + $formOf($page[2]), $jar);
    if ($r[0] !== 200 || strpos($r[2], '설치가 끝났어요') === false) return "POST → {$r[0]} " . substr(strip_tags($r[2]), 0, 200);
    if (strpos($r[2], PHP_VERSION) !== false) return 'the done page shows the PHP version';
    if (is_file($webData . '/setup-code.php')) return 'the setup code was not used up';
    if (!is_file($webSrv . '/config/config.local.php') || !is_file($webData . '/install.lock')) return 'config.local.php / install.lock missing';
    foreach (['GET', 'POST'] as $m) {
        $x = http($m, $base . 'install.php', ['driver' => 'sqlite'], $jar);
        if ($x[0] !== 404 || preg_match('/install|설치|config\.local|<form/i', $x[2])) return "$m after the install → {$x[0]} " . substr($x[2], 0, 80);
    }
    return true;
});
check('install.php — closed (404) while accounts exist or config.local.php exists, even without install.lock', function () use ($base, &$jar, $webSrv, $webData) {
    @unlink($webData . '/install.lock');
    $x = http('GET', $base . 'install.php', [], $jar);
    if ($x[0] !== 404) return "accounts + config.local.php, no lock → {$x[0]}";
    rename($webSrv . '/config/config.local.php', $webSrv . '/config/config.local.php.off');
    $y = http('GET', $base . 'install.php', [], $jar);
    rename($webSrv . '/config/config.local.php.off', $webSrv . '/config/config.local.php');
    return $y[0] === 404 ? true : "accounts only → {$y[0]}";
});
if (is_resource($webProc)) { proc_terminate($webProc); proc_close($webProc); }

// ------------------------------------------------------------------ cli/tfm.php: no secret on the command line (finding F20)
/** run cli/tfm.php of the web copy: [exit code, stdout + stderr]; $stdin is fed to the command (not a terminal) */
$cliRun = function (array $args, array $env = [], string $stdin = '') use ($webSrv, $webData): array {
    $p = proc_open(array_merge([PHP_BINARY, $webSrv . '/cli/tfm.php'], $args), [0 => ['pipe', 'r'], 1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes, $webSrv,
        $env + ['TFM_DATA_DIR' => $webData, 'TFM_TOSS_MOCK' => '1', 'PATH' => (string) getenv('PATH')]);
    fwrite($pipes[0], $stdin);
    fclose($pipes[0]);
    $out = stream_get_contents($pipes[1]) . stream_get_contents($pipes[2]);
    fclose($pipes[1]);
    fclose($pipes[2]);
    return [proc_close($p), (string) $out];
};
check('cli — a password or key as an option value is refused before anything runs (install / migrate / db:rotate-password / reset-password)', function () use ($cliRun, $webSrv) {
    $cfgBefore = (string) file_get_contents($webSrv . '/config/config.local.php');
    foreach ([['install', '--force', '--driver=sqlite', '--admin-email=x@example.com', '--admin-nick=운영자', '--admin-pass=Sunny-Jar-4821'], ['install', '--force', '--pass=hunter2xyz'],
              ['install', '--force', '--toss-client=test_ck_abcdefghij', '--toss-secret=test_sk_abcdefghij'], ['migrate', '--admin-user', 'root', '--pass=hunter2xyz'],
              ['db:rotate-password', '--admin-user=root', '--pass=hunter2xyz'], ['reset-password', 'owner@example.com', 'Brand-New-Pass-77']] as $a) {
        list($code, $out) = $cliRun($a);
        if ($code === 0 || strpos($out, '명령줄') === false) return implode(' ', $a) . " → exit $code: " . substr($out, 0, 160);
    }
    return (string) file_get_contents($webSrv . '/config/config.local.php') === $cfgBefore ? true : 'config.local.php changed';
});
check('cli reset-password — no argument: a random password shown once; --ask with TFM_NEW_PASSWORD / standard input: that one (never echoed)', function () use ($cliRun, $webData, $webSrv) {
    list($c1, $o1) = $cliRun(['reset-password', 'owner@example.com']);
    if ($c1 !== 0 || !preg_match('/새 비밀번호: (Tfm\S+)/u', $o1)) return 'generated: exit ' . $c1 . ' ' . substr($o1, 0, 160);
    list($c2, $o2) = $cliRun(['reset-password', 'owner@example.com', '--ask'], ['TFM_NEW_PASSWORD' => 'Env-Given-Pass-42']);
    list($c3, $o3) = $cliRun(['reset-password', 'owner@example.com', '--ask'], [], "Piped-Pass-Line-43\n");
    if ($c2 !== 0 || $c3 !== 0 || strpos($o2 . $o3, 'Env-Given-Pass-42') !== false || strpos($o2 . $o3, 'Piped-Pass-Line-43') !== false) return "env exit $c2 / stdin exit $c3: " . substr($o2 . $o3, 0, 200);
    // the last one (standard input) is the password now
    $probe = 'require $argv[1]; echo password_verify("Piped-Pass-Line-43", (string) Tfm\\Users::byLogin("owner@example.com")["password_hash"]) ? "yes" : "no";';
    $ok = trim((string) shell_exec('TFM_DATA_DIR=' . escapeshellarg($webData) . ' ' . escapeshellarg(PHP_BINARY) . ' -r ' . escapeshellarg($probe) . ' ' . escapeshellarg($webSrv . '/lib/bootstrap.php') . ' 2>&1'));
    return $ok === 'yes' ? true : 'the password from standard input was not set: ' . substr($ok, 0, 120);
});

// ------------------------------------------------------------------ (sections are appended above this line)
echo PHP_EOL . ($failed === 0 ? "✔ all security-data unit checks passed" : "✖ $failed check(s) failed") . PHP_EOL;
exit($failed === 0 ? 0 : 1);
