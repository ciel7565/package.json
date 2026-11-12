<?php
/**
 * Installer shared by install.php (web, Korean, grown-up facing) and cli/tfm.php install (headless):
 * requirement checks → database connection (MySQL/MariaDB or SQLite) → schema → first admin → config/config.local.php
 * → data/install.lock. Re-running is refused until the lock file is deleted. PHP 7.2 syntax only.
 */
declare(strict_types=1);

namespace Tfm;

if (!defined('TFM_BOOT')) { http_response_code(404); exit; }

final class Installer
{
    public static function lockPath(): string { return Config::dataDir() . DIRECTORY_SEPARATOR . 'install.lock'; }
    public static function locked(): bool { return is_file(self::lockPath()); }
    public static function configPath(): string { return TFM_ROOT . DIRECTORY_SEPARATOR . 'config' . DIRECTORY_SEPARATOR . 'config.local.php'; }

    /**
     * Why the web installer (install.php) is closed — it then answers a plain 404 like a missing page (finding F1):
     *   'locked'    data/install.lock exists
     *   'config'    config/config.local.php exists (someone configured this server already)
     *   'accounts'  the configured database already holds an account (a server in use without the lock file)
     *   'database'  the configured database cannot be read: it is not certain that nobody uses this server
     *   ''          open — and even then a POST needs the one-time setup code (SetupCode)
     * Reinstalling a server that is in use is done on the server computer: `php cli/tfm.php install`.
     */
    public static function webClosedReason(): string
    {
        if (self::locked()) return 'locked';
        clearstatcache(true, self::configPath());
        if (is_file(self::configPath())) return 'config';
        try {
            if (Db::value('SELECT id FROM users ORDER BY id LIMIT 1') !== null) return 'accounts';
        } catch (\Throwable $e) {
            Log::warn('INSTALL', 'web installer closed: the database cannot be read', ['error' => get_class($e)]);
            return 'database';
        }
        return '';
    }

    /** the web installer is reachable (health / config audit: ⛔ on a public host) */
    public static function webOpen(): bool { return self::webClosedReason() === ''; }

    /**
     * Environment checks without touching the database: [{id, label, status: ok|warn|fail, value, hint}].
     * fail = cannot install, warn = works with a missing optional feature.
     */
    public static function checks(string $driver = 'mysql'): array
    {
        $out = [];
        $add = function (string $id, string $label, string $status, string $value, string $hint = '') use (&$out): void {
            $out[] = ['id' => $id, 'label' => $label, 'status' => $status, 'value' => $value, 'hint' => $hint];
        };
        $add('php', 'PHP 버전 (7.2 이상, 64비트)', PHP_VERSION_ID >= 70200 && PHP_INT_SIZE >= 8 ? (PHP_VERSION_ID >= 70400 ? 'ok' : 'warn') : 'fail',
            PHP_VERSION . ' · ' . (PHP_INT_SIZE * 8) . '비트',
            PHP_VERSION_ID < 70200 ? 'PHP 7.2 이상이 필요해요.' : (PHP_INT_SIZE < 8 ? '64비트 PHP 가 필요해요 (XAMPP 64비트 설치).' : (PHP_VERSION_ID < 70400 ? '동작하지만 보안 업데이트가 끝난 버전이에요. 가능하면 PHP 7.4 이상으로 올리세요.' : '')));
        foreach (Health::extensions($driver) as $row) {
            $e = $row[0]; $req = $row[1]; $why = $row[2];
            if ($e === 'curl' || $e === 'openssl') $req = true; // the subscription payments and HTTPS need them
            $ok = extension_loaded($e);
            $add("ext_$e", "PHP 확장: $e", $ok ? 'ok' : ($req ? 'fail' : 'warn'), $ok ? '있음' : '없음', $ok ? '' : $why . ($req ? ' — php.ini 에서 extension=' . $e . ' 을 켜 주세요.' : ''));
        }
        $dirs = [
            'config' => [TFM_ROOT . DIRECTORY_SEPARATOR . 'config', 'config.local.php 를 쓸 폴더'],
            'data' => [Config::dataDir(), '데이터베이스(SQLite)·로그·비밀키'],
            'sessions' => [Config::dataDir() . DIRECTORY_SEPARATOR . 'sessions', '로그인 세션'],
            'uploads' => [Config::uploadDir(), '작업일지 사진'],
        ];
        foreach ($dirs as $k => $d) {
            if (!is_dir($d[0])) @mkdir($d[0], 0750, true);
            $w = is_dir($d[0]) && is_writable($d[0]);
            $add("dir_$k", "쓰기 권한: $k/", $w ? 'ok' : 'fail', $w ? '쓰기 가능' : '쓰기 불가', $w ? '' : $d[1] . ' — 웹 서버(Apache) 계정이 이 폴더에 쓸 수 있게 해 주세요.');
        }
        $add('game_data', '체험 데이터 (data/game-data.json)', is_file(TFM_ROOT . '/data/game-data.json') ? 'ok' : 'warn', is_file(TFM_ROOT . '/data/game-data.json') ? '있음' : '없음', is_file(TFM_ROOT . '/data/game-data.json') ? '' : '배포 zip 의 metaverse 폴더를 그대로 복사했는지 확인하세요 (저장 검증에 필요).');
        $add('pii_rules', '어린이 개인정보 가림 규칙 (lib/pii-rules.json)', is_file(TFM_ROOT . '/lib/pii-rules.json') ? 'ok' : 'warn', is_file(TFM_ROOT . '/lib/pii-rules.json') ? '있음' : '없음');
        return $out;
    }

    public static function checksFail(array $checks): array
    {
        $f = [];
        foreach ($checks as $c) if ($c['status'] === 'fail') $f[] = $c['label'] . ($c['hint'] !== '' ? ' — ' . $c['hint'] : '');
        return $f;
    }

    /**
     * Run the installation. $in keys: driver (mysql|sqlite), host, port, database, username, password, socket,
     * create_db (bool), app_account (bool, default true: make a dedicated least-privilege account), app_host (the host
     * the web server connects from; empty = automatic), ssl_ca, ssl_verify (bool), allow_insecure_remote (bool),
     * admin_email, admin_nickname, admin_password, toss_client, toss_secret, toss_mock (bool).
     *
     * MySQL / MariaDB (CONTRACT §15.7 #1): username / password are the database ADMINISTRATOR the operator typed (root
     * on XAMPP). With that connection the database is created, database/schema.sql applied and a dedicated account
     * tfm_<8 hex>@<host> made with a random 32-character password and only SELECT, INSERT, UPDATE, DELETE on this one
     * database (a reinstall keeps the configured tfm_ account and gives it a new password). Only that account goes into
     * config/config.local.php, with db.auto_migrate = false; the administrator's credentials are never stored.
     * When the administrator may not create accounts, the typed account is used (flagged) and dbAccount.manual holds
     * the SQL to run by hand. Returns a summary (dbAccount never holds a password); throws ApiException (Korean) on
     * any problem.
     */
    public static function run(array $in): array
    {
        if (self::locked()) throw new ApiException(403, 'INSTALL_LOCKED', '이미 설치되었어요. 다시 설치하려면 data/install.lock 파일을 지운 뒤 열어 주세요.');
        $driver = (isset($in['driver']) ? $in['driver'] : 'mysql') === 'sqlite' ? 'sqlite' : 'mysql';
        $fails = self::checksFail(self::checks($driver));
        if ($fails) throw new ApiException(400, 'REQUIREMENTS', '서버 환경을 먼저 맞춰 주세요: ' . implode(' / ', $fails));

        $str = function (string $k, string $d = '') use ($in): string { return isset($in[$k]) && is_string($in[$k]) ? trim($in[$k]) : $d; };
        $email = mb_strtolower($str('admin_email'));
        $nick = Users::cleanText($str('admin_nickname'), 40);
        $pw = isset($in['admin_password']) && is_string($in['admin_password']) ? $in['admin_password'] : '';
        if ($e = Users::validEmail($email)) throw new ApiException(400, 'ADMIN_EMAIL', '관리자 이메일: ' . $e);
        if ($e = Users::validNickname($nick, true)) throw new ApiException(400, 'ADMIN_NICK', '관리자 닉네임: ' . $e);
        if ($e = Users::validPassword($pw, $email, $nick)) throw new ApiException(400, 'ADMIN_PASSWORD', '관리자 비밀번호: ' . $e);

        $local = self::readLocalConfig(); // a damaged config.local.php is an error, never silently replaced
        $local['db'] = isset($local['db']) && is_array($local['db']) ? $local['db'] : [];
        $prevDb = $local['db'];
        $local['db']['driver'] = $driver;
        $account = ['dedicated' => false, 'user' => '', 'hosts' => [], 'reason' => 'sqlite', 'manual' => [], 'warning' => ''];
        $adminPdo = null;
        if ($driver === 'mysql') {
            $prevMysql = isset($prevDb['mysql']) && is_array($prevDb['mysql']) ? $prevDb['mysql'] : [];
            $m = [
                'host' => $str('host', '127.0.0.1') !== '' ? $str('host', '127.0.0.1') : '127.0.0.1',
                'port' => (int) ($str('port', '3306') !== '' ? $str('port', '3306') : '3306'),
                'socket' => $str('socket'),
                'database' => $str('database', 'fermentation_metaverse') !== '' ? $str('database', 'fermentation_metaverse') : 'fermentation_metaverse',
                'username' => $str('username'),
                'password' => isset($in['password']) && is_string($in['password']) ? $in['password'] : '',
            ];
            // encryption settings: from the input (cli install --ssl-ca=…) or kept from an earlier configuration
            $ca = $str('ssl_ca', isset($prevMysql['ssl_ca']) && is_string($prevMysql['ssl_ca']) ? $prevMysql['ssl_ca'] : '');
            if ($ca !== '') $m['ssl_ca'] = $ca;
            if ((isset($in['ssl_verify']) && $in['ssl_verify'] === false) || (!isset($in['ssl_verify']) && isset($prevMysql['ssl_verify']) && $prevMysql['ssl_verify'] === false)) $m['ssl_verify'] = false;
            if (!empty($in['allow_insecure_remote']) || (!isset($in['allow_insecure_remote']) && !empty($prevMysql['allow_insecure_remote']))) $m['allow_insecure_remote'] = true;
            if ($m['username'] === '') throw new ApiException(400, 'DB_USER', '데이터베이스 관리자 사용자 이름을 넣어 주세요 (XAMPP 는 보통 root).');
            if (!preg_match('/^[A-Za-z0-9_]{1,64}$/', $m['database'])) throw new ApiException(400, 'DB_NAME', '데이터베이스 이름은 영문·숫자·밑줄만 쓸 수 있어요 (64자 이하).');
            if ($m['port'] < 1 || $m['port'] > 65535) throw new ApiException(400, 'DB_PORT', '포트 번호가 올바르지 않아요.');
            if (!preg_match('/^[A-Za-z0-9.\-:\[\]]{1,253}$/', $m['host'])) throw new ApiException(400, 'DB_HOST', '호스트 이름이 올바르지 않아요.');
            $appHost = $str('app_host');
            if ($appHost !== '' && (!preg_match('/^[A-Za-z0-9.\-:%_]{1,255}$/', $appHost) || $appHost === '%')) {
                throw new ApiException(400, 'DB_APP_HOST', '웹 서버의 접속 위치(호스트)가 올바르지 않아요. 모든 곳(%)을 허용할 수는 없어요 — 보통은 비워 두면 돼요.');
            }
            try {
                // the administrator connection, first without a database: create it when the account may (XAMPP root can)
                try {
                    $pdo = Db::connectMysql($m, false);
                    if (!empty($in['create_db'])) $pdo->exec('CREATE DATABASE IF NOT EXISTS ' . self::quoteIdent($m['database']) . ' DEFAULT CHARACTER SET utf8mb4 DEFAULT COLLATE utf8mb4_unicode_ci');
                    $pdo = null;
                } catch (\PDOException $e) {
                    // some hosts refuse a connection without a database name: try directly
                    Db::connectMysql($m, true);
                }
                $adminPdo = Db::connectMysql($m, true);
                $ver = (string) $adminPdo->getAttribute(\PDO::ATTR_SERVER_VERSION);
            } catch (\PDOException $e) {
                Log::warn('INSTALL', 'mysql connection failed', ['code' => (string) $e->getCode()]);
                throw new ApiException(400, 'DB_CONNECT', 'MySQL/MariaDB 에 연결하지 못했어요: ' . mb_substr(self::dbError($e), 0, 200) . ' — 호스트·포트·사용자·비밀번호와 MySQL 이 켜져 있는지 확인하세요.');
            } catch (\RuntimeException $e) {
                throw new ApiException(400, 'DB_TLS', '데이터베이스가 다른 컴퓨터에 있으면 암호화(TLS) 연결이 필요해요. 서버 컴퓨터에서 php cli/tfm.php install --ssl-ca=<CA 인증서 파일> … 로 설치해 주세요. (같은 내부망이라 암호화 없이 써도 된다면 --allow-insecure-remote)');
            }
            // the schema with the administrator connection (the runtime account may not run DDL)
            Db::adopt($adminPdo, 'mysql');
            try {
                Db::migrate();
            } catch (\Throwable $e) {
                Db::reset();
                Log::error('INSTALL', 'schema with the administrator connection failed', ['error' => get_class($e)]);
                throw new ApiException(500, 'SCHEMA', '테이블을 만들지 못했어요: ' . mb_substr(self::scrub($e->getMessage()), 0, 200));
            }
            Db::reset();
            $wantApp = !array_key_exists('app_account', $in) || !empty($in['app_account']);
            $account = $wantApp
                ? self::provisionAppAccount($adminPdo, $m, $appHost, self::configuredAppUser($prevDb))
                : ['dedicated' => false, 'user' => '', 'hosts' => [], 'reason' => 'not_requested', 'manual' => [], 'warning' => ''];
            if ($account['dedicated']) {
                $local['db']['mysql'] = ['username' => $account['user'], 'password' => $account['password']] + $m;
                $local['db']['auto_migrate'] = false; // upgrades: php cli/tfm.php migrate --admin-user <administrator>
            } else {
                $local['db']['mysql'] = $m; // the typed account (the operator chose it, or could not create one): flagged by the health check
                unset($local['db']['auto_migrate']);
            }
            unset($account['password']);
            $adminPdo = null;
        } else {
            $ver = 'SQLite';
            if (!extension_loaded('pdo_sqlite')) throw new ApiException(400, 'DB_DRIVER', 'pdo_sqlite 확장이 없어요.');
            unset($local['db']['auto_migrate']);
        }
        $local['toss'] = isset($local['toss']) && is_array($local['toss']) ? $local['toss'] : [];
        $tc = $str('toss_client');
        $ts = $str('toss_secret');
        if ($tc !== '' && !preg_match('/^(test|live)_(ck|gck)_[A-Za-z0-9]{10,80}$/', $tc)) throw new ApiException(400, 'TOSS_KEY', '토스 클라이언트 키 형식이 올바르지 않아요 (test_ck_… 또는 live_ck_…).');
        if ($ts !== '' && !preg_match('/^(test|live)_(sk|gsk)_[A-Za-z0-9]{10,80}$/', $ts)) throw new ApiException(400, 'TOSS_KEY', '토스 시크릿 키 형식이 올바르지 않아요 (test_sk_… 또는 live_sk_…).');
        if (($tc === '') !== ($ts === '')) throw new ApiException(400, 'TOSS_KEY', '토스 키는 클라이언트 키와 시크릿 키를 함께 넣어 주세요.');
        if ($tc !== '' && Toss::isDocumentationKey($tc . ' ' . $ts)) throw new ApiException(400, 'TOSS_KEY', '토스 문서에 실린 공개 예시 키는 쓸 수 없어요. 토스페이먼츠 개발자센터에서 내 키를 발급받아 넣어 주세요.');
        if ($tc !== '') { $local['toss']['client_key'] = $tc; $local['toss']['secret_key'] = $ts; }
        $local['toss']['mock'] = !empty($in['toss_mock']);

        self::writeConfig($local);
        Config::reset();
        Db::reset();
        try {
            Db::pdo(); // SQLite / the typed account: creates the schema; the dedicated account finds it ready
            if (Db::schemaVersion() < Db::SCHEMA_VERSION) Db::migrate();
        } catch (\Throwable $e) {
            throw new ApiException(500, 'SCHEMA', '테이블을 만들지 못했어요: ' . mb_substr(self::scrub($e->getMessage()), 0, 200));
        }
        $version = Db::schemaVersion();

        // first admin (or promote the matching account)
        $created = false;
        $existing = Users::byEmail($email);
        if ($existing) {
            if ($existing['role'] !== 'admin') Users::update((int) $existing['id'], ['role' => 'admin'], true);
            $admin = Users::byId((int) $existing['id']);
        } else {
            $byNick = Users::byNickname($nick);
            if ($byNick) throw new ApiException(409, 'NICKNAME_TAKEN', '그 닉네임은 이미 다른 계정이 쓰고 있어요.');
            $admin = Db::tx(function () use ($email, $nick, $pw) { return Users::create($email, $nick, $pw, 'admin'); });
            $created = true;
        }
        Audit::log('install', (int) $admin['id'], ['driver' => $driver, 'created' => $created, 'schema' => $version, 'mock' => !empty($in['toss_mock']),
            'dbAccount' => $account['dedicated'] ? 'dedicated' : $account['reason']], 'alert', (int) $admin['id']);
        if (@file_put_contents(self::lockPath(), 'installed ' . gmdate('c') . ' by ' . (PHP_SAPI === 'cli' ? 'cli' : 'web') . "\n", LOCK_EX) === false) {
            throw new ApiException(500, 'LOCK', 'data/install.lock 파일을 만들지 못했어요 (data 폴더 쓰기 권한).');
        }
        PrivateFile::tighten(self::lockPath());
        return ['driver' => $driver, 'server' => $ver, 'schema' => $version, 'adminId' => (int) $admin['id'], 'adminNickname' => (string) $admin['nickname'], 'adminCreated' => $created,
            'mock' => !empty($in['toss_mock']), 'tossKeys' => $tc !== '', 'dbAccount' => $account];
    }

    private static function dbError(\PDOException $e): string
    {
        return self::scrub($e->getMessage());
    }

    /** an error text without passwords (a DSN message can carry one) or file paths */
    private static function scrub(string $m): string
    {
        $m = (string) preg_replace('/password[^,;]*/i', 'password …', $m);
        return (string) preg_replace('#(?:[A-Za-z]:)?[\\\\/](?:[^\\\\/\s\'"]+[\\\\/])+[^\\\\/\s\'"]*#', '…', $m);
    }

    // ------------------------------------------------------------------ secret rotation (CONTRACT §15.7 #21)
    /**
     * `php cli/tfm.php secret:rotate [--app-key] [--data-key]`: new random secrets in data/secret.php (rotated_at per key).
     *   data key: the old key stays as data_key_prev until every sealed column is sealed again with the new key inside one
     *             transaction (subscriptions.billing_key — plain legacy keys are sealed too; admin_totp.secret_enc);
     *             any failure puts the old key back. Afterwards the old key is gone.
     *   app key:  every session ends (session files removed, users.session_epoch + 1), rate-limit and login-attempt rows
     *             (keyed by the old hashes) are cleared, ip_blocks / security_events get their address hashes again.
     * → ['dataKey' => bool, 'appKey' => bool, 'resealed' => n, 'unreadable' => n, 'sessions' => n, 'ipHashes' => n]
     */
    public static function rotateSecrets(bool $appKey, bool $dataKey): array
    {
        $out = ['dataKey' => false, 'appKey' => false, 'resealed' => 0, 'unreadable' => 0, 'sessions' => 0, 'ipHashes' => 0];
        Db::pdo();
        if ($dataKey) {
            if (!Crypto::available()) throw new ApiException(500, 'NO_OPENSSL', '이 PHP 에는 openssl(aes-256-gcm)이 없어 데이터 키를 바꿀 수 없어요.');
            $old = Secrets::ensure('data_key', function () { return bin2hex(random_bytes(32)); });
            $new = bin2hex(random_bytes(32));
            Secrets::update(function (array $s) use ($old, $new) { $s['data_key_prev'] = $old; $s['data_key'] = $new; return $s; });
            Crypto::reset();
            try {
                $r = Db::tx(function () { return self::resealColumns(); });
            } catch (\Throwable $e) {
                Secrets::update(function (array $s) use ($old) { $s['data_key'] = $old; unset($s['data_key_prev']); return $s; });
                Crypto::reset();
                Log::error('SECRETS', 'data key rotation failed and was undone', ['error' => get_class($e)]);
                throw new ApiException(500, 'ROTATE_FAILED', '봉인된 값을 새 키로 바꾸지 못해서 예전 데이터 키로 되돌렸어요. 다시 해 보거나 로그를 확인하세요.');
            }
            Secrets::update(function (array $s) {
                unset($s['data_key_prev']);
                $s['rotated_at'] = isset($s['rotated_at']) && is_array($s['rotated_at']) ? $s['rotated_at'] : [];
                $s['rotated_at']['data_key'] = gmdate('c');
                return $s;
            });
            Crypto::reset();
            $out['dataKey'] = true;
            $out['resealed'] = $r['resealed'];
            $out['unreadable'] = $r['unreadable'];
        }
        if ($appKey) {
            $key = bin2hex(random_bytes(32));
            Secrets::update(function (array $s) use ($key) {
                $s['app_key'] = $key;
                $s['rotated_at'] = isset($s['rotated_at']) && is_array($s['rotated_at']) ? $s['rotated_at'] : [];
                $s['rotated_at']['app_key'] = gmdate('c');
                return $s;
            });
            // the same keyed hash as Sec::hashId(), with the new key (this process still holds the old one)
            $hash = function (string $ip) use ($key): string { return substr(hash_hmac('sha256', $ip, $key), 0, 32); };
            $out['ipHashes'] = (int) Db::tx(function () use ($hash) {
                $n = 0;
                foreach (Db::all('SELECT ip_hash, ip FROM ip_blocks') as $b) {
                    $ip = Http::normIp((string) $b['ip']);
                    if ($ip !== '') $n += Db::exec('UPDATE ip_blocks SET ip_hash = ? WHERE ip_hash = ?', [$hash($ip), (string) $b['ip_hash']]);
                }
                foreach (Db::all("SELECT DISTINCT ip FROM security_events WHERE ip <> ''") as $e) {
                    $ip = Http::normIp((string) $e['ip']);
                    if ($ip !== '') $n += Db::exec('UPDATE security_events SET ip_hash = ? WHERE ip = ?', [$hash($ip), (string) $e['ip']]);
                }
                Db::exec('DELETE FROM rate_limits');
                Db::exec('DELETE FROM login_attempts');
                Db::exec('UPDATE users SET session_epoch = session_epoch + 1');
                return $n;
            });
            $dir = Config::dataDir() . DIRECTORY_SEPARATOR . 'sessions';
            foreach (glob($dir . DIRECTORY_SEPARATOR . 'sess_*') ?: [] as $f) if (@unlink($f)) $out['sessions']++;
            $out['appKey'] = true;
        }
        Audit::log('secret_rotated', null, ['appKey' => $out['appKey'], 'dataKey' => $out['dataKey'], 'resealed' => $out['resealed'], 'unreadable' => $out['unreadable'], 'sessions' => $out['sessions']], 'alert');
        return $out;
    }

    /**
     * Seal the sealed columns with the current data key (inside the caller's transaction): billing keys that are plain
     * text or sealed with data_key_prev; TOTP secrets that are sealed with data_key_prev (their own code seals plain ones).
     */
    private static function resealColumns(): array
    {
        $done = 0;
        $bad = 0;
        foreach (Db::all("SELECT user_id, billing_key FROM subscriptions WHERE billing_key <> ''") as $r) {
            $v = (string) $r['billing_key'];
            $plain = Crypto::open($v);
            if ($plain === null) { $bad++; continue; }
            if (!Crypto::needsReseal($v)) continue;
            $done += Db::exec('UPDATE subscriptions SET billing_key = ? WHERE user_id = ? AND billing_key = ?', [Crypto::seal($plain), (int) $r['user_id'], $v]);
        }
        try {
            $totp = Db::all("SELECT user_id, secret_enc FROM admin_totp WHERE secret_enc <> ''");
        } catch (\PDOException $e) {
            $totp = []; // an older schema without the table
        }
        foreach ($totp as $r) {
            $v = (string) $r['secret_enc'];
            if (!Crypto::isSealed($v)) continue;
            $plain = Crypto::open($v);
            if ($plain === null) { $bad++; continue; }
            if (!Crypto::needsReseal($v)) continue;
            $done += Db::exec('UPDATE admin_totp SET secret_enc = ? WHERE user_id = ? AND secret_enc = ?', [Crypto::seal($plain), (int) $r['user_id'], $v]);
        }
        return ['resealed' => $done, 'unreadable' => $bad];
    }

    // ------------------------------------------------------------------ MySQL / MariaDB accounts (CONTRACT §15.7 #1, #21)
    /** `name` with the backtick doubled (names here are validated to [A-Za-z0-9_] anyway) */
    private static function quoteIdent(string $name): string { return '`' . str_replace('`', '``', $name) . '`'; }

    /**
     * the database part of a GRANT: `_` and `%` are wildcards there (fermentation_metaverse would also match
     * fermentationXmetaverse), so they are escaped — the grant covers exactly this one database
     */
    private static function grantDb(string $db): string { return self::quoteIdent(str_replace(['\\', '_', '%'], ['\\\\', '\\_', '\\%'], $db)); }

    /** 'user'@'host' with both parts quoted by the connection */
    private static function acct(\PDO $pdo, string $user, string $host): string { return $pdo->quote($user) . '@' . $pdo->quote($host); }

    /** a random password of letters and digits (no quoting problems in config files, shells or SQL) */
    public static function randomPassword(int $len = 32): string
    {
        $abc = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        $s = '';
        for ($i = 0; $i < $len; $i++) $s .= $abc[random_int(0, strlen($abc) - 1)];
        return $s;
    }

    /** the dedicated account named in a db configuration block, '' when it names another account */
    private static function configuredAppUser(array $db): string
    {
        $u = isset($db['mysql']['username']) && is_string($db['mysql']['username']) ? $db['mysql']['username'] : '';
        return preg_match('/^tfm_[0-9a-f]{8}$/', $u) ? $u : '';
    }

    /**
     * Where the web server connects from, as the database sees it: the host part of USER() of this connection (the
     * installer runs on the web server machine), plus localhost and 127.0.0.1 for a database on the same machine
     * (a socket and a TCP connection are matched against different account hosts). $appHost (typed) replaces them.
     */
    private static function accountHosts(\PDO $admin, array $m, string $appHost): array
    {
        if ($appHost !== '') return [$appHost];
        $hosts = [];
        $who = (string) $admin->query('SELECT USER()')->fetchColumn();
        $at = strrpos($who, '@');
        if ($at !== false) $hosts[] = (string) substr($who, $at + 1);
        if (Db::isLocalDb($m)) {
            $hosts[] = 'localhost';
            $hosts[] = '127.0.0.1';
            $h = strtolower(trim((string) (isset($m['host']) ? $m['host'] : ''), " []"));
            if ($h === '::1' || $h === 'localhost') $hosts[] = '::1';
        }
        $out = [];
        foreach ($hosts as $h) if ($h !== '' && $h !== '%' && preg_match('/^[A-Za-z0-9.\-:%_]{1,255}$/', $h) && !in_array($h, $out, true)) $out[] = $h;
        return $out ?: ['localhost'];
    }

    /** the statements an operator runs by hand when the installer may not create accounts (no password inside) */
    private static function manualSql(string $user, array $hosts, string $db): array
    {
        $lines = [];
        foreach ($hosts as $h) $lines[] = "CREATE USER '$user'@'$h' IDENTIFIED BY '새_비밀번호(32자_무작위)';";
        foreach ($hosts as $h) $lines[] = 'GRANT SELECT, INSERT, UPDATE, DELETE ON ' . self::grantDb($db) . ".* TO '$user'@'$h';";
        return $lines;
    }

    /** the driver error number of a PDOException (1227 = no CREATE USER privilege, …) */
    private static function mysqlErrno(\PDOException $e): int
    {
        return isset($e->errorInfo[1]) ? (int) $e->errorInfo[1] : 0;
    }

    /**
     * Create (or, for a reinstall, reuse with a new password) the dedicated account, grant it SELECT / INSERT / UPDATE /
     * DELETE on the app database only, and prove it: it reads and writes rows and cannot CREATE TABLE.
     * → ['dedicated' => bool, 'user', 'password' (only when dedicated), 'hosts', 'reason', 'manual', 'warning']
     */
    private static function provisionAppAccount(\PDO $admin, array $m, string $appHost, string $preferUser): array
    {
        $db = (string) $m['database'];
        $hosts = self::accountHosts($admin, $m, $appHost);
        $user = $preferUser !== '' ? $preferUser : 'tfm_' . bin2hex(random_bytes(4));
        $pw = self::randomPassword(32);
        $made = [];
        try {
            foreach ($hosts as $h) {
                $a = self::acct($admin, $user, $h);
                $exists = false;
                try { $exists = (bool) $admin->query('SELECT 1 FROM mysql.user WHERE User = ' . $admin->quote($user) . ' AND Host = ' . $admin->quote($h))->fetchColumn(); }
                catch (\PDOException $e) { /* no read access to mysql.user: CREATE USER below decides */ }
                if ($exists) {
                    $admin->exec('ALTER USER ' . $a . ' IDENTIFIED BY ' . $admin->quote($pw)); // reinstall: same account, new password
                } else {
                    $admin->exec('CREATE USER ' . $a . ' IDENTIFIED BY ' . $admin->quote($pw));
                    $made[] = $h;
                }
                $admin->exec('GRANT SELECT, INSERT, UPDATE, DELETE ON ' . self::grantDb($db) . '.* TO ' . $a);
            }
        } catch (\PDOException $e) {
            $no = self::mysqlErrno($e);
            foreach ($made as $h) { try { $admin->exec('DROP USER ' . self::acct($admin, $user, $h)); } catch (\PDOException $e2) { /* best effort */ } }
            if (in_array($no, [1044, 1045, 1142, 1143, 1227, 1410, 1396], true)) {
                Log::warn('INSTALL', 'no right to create the dedicated database account: the typed account is used', ['errno' => $no]);
                return ['dedicated' => false, 'user' => '', 'hosts' => $hosts, 'reason' => $no === 1410 || $no === 1044 ? 'no_grant' : 'no_create_user', 'manual' => self::manualSql($user, $hosts, $db), 'warning' => ''];
            }
            throw new ApiException(500, 'DB_ACCOUNT', '전용 DB 계정을 만들지 못했어요: ' . mb_substr(self::dbError($e), 0, 200));
        }
        $warning = self::verifyAppAccount(['username' => $user, 'password' => $pw] + $m);
        Log::info('INSTALL', 'dedicated database account ready', ['user' => $user, 'hosts' => $hosts, 'new' => count($made)]);
        return ['dedicated' => true, 'user' => $user, 'password' => $pw, 'hosts' => $hosts, 'reason' => '', 'manual' => [], 'warning' => $warning];
    }

    /** the account reads and writes rows; '' when it cannot run DDL, 'ddl' when it can (other grants: health warns) */
    private static function verifyAppAccount(array $m): string
    {
        try {
            $app = Db::connectMysql($m, true);
            $app->query('SELECT MAX(version) FROM schema_version')->fetchColumn();
            $probe = 'tfm-account-check-' . bin2hex(random_bytes(4));
            $app->prepare('INSERT INTO rate_limits (bucket, hits, expires_at) VALUES (?, 1, 0)')->execute([$probe]);
            $st = $app->prepare('DELETE FROM rate_limits WHERE bucket = ?');
            $st->execute([$probe]);
            if ($st->rowCount() !== 1) throw new \RuntimeException('row not written');
        } catch (\Throwable $e) {
            throw new ApiException(500, 'DB_ACCOUNT', '새 전용 DB 계정으로 읽고 쓰지 못했어요. 웹 서버의 접속 위치(호스트)를 직접 넣어 다시 해 보세요: ' . mb_substr(self::scrub($e->getMessage()), 0, 160));
        }
        try {
            $app->exec('CREATE TABLE tfm_account_probe (id INT)');
        } catch (\PDOException $e) {
            return '';
        }
        try { $app->exec('DROP TABLE tfm_account_probe'); } catch (\PDOException $e) { /* best effort */ }
        Log::warn('INSTALL', 'the dedicated account can run DDL through other grants (wildcard or global privileges)');
        return 'ddl';
    }

    /** an administrator connection to the configured database (cli migrate / db:account / db:rotate-password) */
    private static function adminConnection(string $adminUser, string $adminPass): \PDO
    {
        if ($adminUser === '') throw new ApiException(400, 'DB_USER', '데이터베이스 관리자 사용자 이름이 필요해요 (--admin-user root).');
        $m = (array) Config::get('db.mysql', []);
        try {
            return Db::connectMysql(['username' => $adminUser, 'password' => $adminPass] + $m, true);
        } catch (\PDOException $e) {
            throw new ApiException(400, 'DB_CONNECT', '데이터베이스 관리자 계정으로 연결하지 못했어요: ' . mb_substr(self::dbError($e), 0, 200) . ' — 사용자 이름과 비밀번호를 확인하세요.');
        } catch (\RuntimeException $e) {
            throw new ApiException(400, 'DB_CONNECT', mb_substr($e->getMessage(), 0, 300));
        }
    }

    /**
     * `php cli/tfm.php migrate --admin-user <u>`: apply the pending schema versions with a temporary administrator
     * connection (the runtime account has no DDL rights; db.auto_migrate is off). The administrator's password is
     * used for this call only. SQLite: the normal upgrade. → ['driver', 'from', 'to']
     */
    public static function migrateAsAdmin(string $adminUser, string $adminPass): array
    {
        if (strtolower((string) Config::get('db.driver', 'sqlite')) !== 'mysql') {
            Db::reset();
            $to = Db::upgrade();
            Db::reset();
            return ['driver' => 'sqlite', 'from' => $to, 'to' => $to];
        }
        $pdo = self::adminConnection($adminUser, $adminPass);
        Db::adopt($pdo, 'mysql');
        try {
            $from = Db::schemaVersion();
            Db::migrate();
            $to = Db::schemaVersion();
        } finally {
            Db::reset();
            $pdo = null;
        }
        Audit::log('db_migrate', null, ['from' => $from, 'to' => $to, 'via' => PHP_SAPI === 'cli' ? 'cli' : 'web'], 'warn');
        return ['driver' => 'mysql', 'from' => $from, 'to' => $to];
    }

    /**
     * `php cli/tfm.php db:account --admin-user <u>`: an installation that runs as the database administrator (root) is
     * moved to a dedicated least-privilege account; the data stays where it is. → ['user', 'hosts', 'warning']
     */
    public static function switchToAppAccount(string $adminUser, string $adminPass): array
    {
        if (strtolower((string) Config::get('db.driver', 'sqlite')) !== 'mysql') throw new ApiException(400, 'DB_DRIVER', 'SQLite 를 쓰는 설치에는 DB 계정이 없어요.');
        $pdo = self::adminConnection($adminUser, $adminPass);
        Db::adopt($pdo, 'mysql');
        try {
            if (Db::schemaVersion() < Db::SCHEMA_VERSION) Db::migrate();
        } finally {
            Db::reset();
        }
        $m = (array) Config::get('db.mysql', []);
        $acct = self::provisionAppAccount($pdo, $m, '', self::configuredAppUser(['mysql' => $m]));
        $pdo = null;
        if (!$acct['dedicated']) {
            throw new ApiException(400, 'DB_NO_CREATE_USER', '이 관리자 계정에는 새 계정을 만드는 권한(CREATE USER · GRANT)이 없어요. 권한이 있는 계정(보통 root)으로 다시 하거나, 다음 SQL 을 phpMyAdmin 의 SQL 탭에서 실행한 뒤 config/config.local.php 의 db.mysql 에 그 계정을 적어 주세요: ' . implode(' ', $acct['manual']), ['manual' => $acct['manual']]);
        }
        self::mergeLocalConfig(['db' => ['mysql' => ['username' => $acct['user'], 'password' => $acct['password']], 'auto_migrate' => false]]);
        Db::reset();
        Audit::log('db_account_switched', null, ['user' => $acct['user'], 'hosts' => $acct['hosts']], 'warn');
        return ['user' => $acct['user'], 'hosts' => $acct['hosts'], 'warning' => $acct['warning']];
    }

    /**
     * `php cli/tfm.php db:rotate-password --admin-user <u>` (§15.7 #21): a new random password for the runtime account
     * on every host it has, config.local.php rewritten in one step. Any failure puts the old password back.
     * Refused (DB_SAME_ACCOUNT) while the site runs as the administrator itself. → ['user', 'hosts']
     */
    public static function rotateDbPassword(string $adminUser, string $adminPass): array
    {
        if (strtolower((string) Config::get('db.driver', 'sqlite')) !== 'mysql') throw new ApiException(400, 'DB_DRIVER', 'SQLite 를 쓰는 설치에는 DB 비밀번호가 없어요.');
        $m = (array) Config::get('db.mysql', []);
        $user = (string) (isset($m['username']) ? $m['username'] : '');
        $old = (string) (isset($m['password']) ? $m['password'] : '');
        if ($user === '' || strcasecmp($user, $adminUser) === 0 || strtolower($user) === 'root') {
            throw new ApiException(400, 'DB_SAME_ACCOUNT', "체험관이 데이터베이스 관리자 계정({$user})으로 접속하고 있어요. 관리자 비밀번호는 여기서 바꾸지 않아요: 먼저 php cli/tfm.php db:account --admin-user <관리자> 로 전용 계정을 만드세요.");
        }
        $pdo = self::adminConnection($adminUser, $adminPass);
        try {
            $hosts = array_map('strval', $pdo->query('SELECT Host FROM mysql.user WHERE User = ' . $pdo->quote($user) . ' ORDER BY Host')->fetchAll(\PDO::FETCH_COLUMN));
        } catch (\PDOException $e) {
            throw new ApiException(400, 'DB_PRIVILEGES', '이 관리자 계정으로는 계정 목록(mysql.user)을 읽을 수 없어요. root 처럼 권한이 있는 계정으로 해 주세요.');
        }
        if (!$hosts) throw new ApiException(404, 'DB_NO_ACCOUNT', "데이터베이스에 {$user} 계정이 없어요.");
        $new = self::randomPassword(32);
        $changed = [];
        $undo = function () use ($pdo, $user, &$changed, $old): void {
            foreach ($changed as $h) { try { $pdo->exec('ALTER USER ' . self::acct($pdo, $user, $h) . ' IDENTIFIED BY ' . $pdo->quote($old)); } catch (\PDOException $e) { /* reported below */ } }
        };
        try {
            foreach ($hosts as $h) { $pdo->exec('ALTER USER ' . self::acct($pdo, $user, $h) . ' IDENTIFIED BY ' . $pdo->quote($new)); $changed[] = $h; }
            Db::connectMysql(['password' => $new] + $m, true); // the site's own connection works with the new password
            self::mergeLocalConfig(['db' => ['mysql' => ['password' => $new]]]);
        } catch (\Throwable $e) {
            $undo();
            Log::error('DB', 'password rotation failed and was undone', ['error' => get_class($e)]);
            throw new ApiException(500, 'DB_ROTATE', '비밀번호를 바꾸지 못해서 예전 비밀번호로 되돌렸어요: ' . mb_substr(self::scrub($e->getMessage()), 0, 160));
        }
        $pdo = null;
        Db::reset();
        Audit::log('db_password_rotated', null, ['user' => $user, 'hosts' => $hosts], 'warn');
        return ['user' => $user, 'hosts' => $hosts];
    }

    /**
     * config/config.local.php replaced in one step (temp file + rename, mode 0600 where the OS has modes), with a PHP
     * exit guard like every private file. The whole array is written; mergeLocalConfig() changes single values.
     */
    public static function writeConfig(array $local): void
    {
        $file = self::configPath();
        $php = "<?php\n// 전통발효체험관 메타버스 — 설치 마법사와 관리 명령이 쓰는 설정 (" . gmdate('c') . ")\n"
            . "// 비밀번호와 결제 키가 들어 있어요: config/.htaccess 가 웹 접근을 막고, 공개 저장소에 올리면 안 돼요.\n"
            . "// 값을 바꾼 뒤에는 새로고침만 하면 돼요 (캐시 없음).\n"
            . "if (!defined('TFM_BOOT')) { http_response_code(404); exit; }\nreturn " . var_export($local, true) . ";\n";
        try {
            PrivateFile::write($file, $php);
        } catch (\RuntimeException $e) {
            throw new ApiException(500, 'CONFIG_WRITE', 'config/config.local.php 를 쓸 수 없어요 (config 폴더 쓰기 권한).');
        }
        if (self::readLocalConfig() !== $local) throw new ApiException(500, 'CONFIG_WRITE', 'config/config.local.php 를 다시 읽지 못했어요.');
    }

    /**
     * The array config/config.local.php returns now ([] when there is no file) — from the disk, not from Config's
     * per-request copy. A file that exists but does not return an array (hand-written, damaged) is an error: it is
     * never treated as empty, because the next write would then throw its contents away.
     */
    public static function readLocalConfig(): array
    {
        $file = self::configPath();
        clearstatcache(true, $file);
        if (!is_file($file)) return [];
        $cur = PrivateFile::load($file);
        if (!is_array($cur)) throw new ApiException(500, 'CONFIG_READ', 'config/config.local.php 를 읽지 못했어요 (배열을 돌려주는 PHP 파일이어야 해요). 파일을 확인한 뒤 다시 해 주세요.');
        return $cur;
    }

    /**
     * Change values in config/config.local.php: the current array is read, $patch is merged in (arrays with names
     * merge key by key, lists and plain values are replaced — the rule Config uses for config.php + config.local.php)
     * and the file is replaced in one step. Config::get() returns the new values right away.
     */
    public static function mergeLocalConfig(array $patch): void
    {
        $lock = @fopen(Config::dataDir() . DIRECTORY_SEPARATOR . '.config.lock', 'c');
        if ($lock) flock($lock, LOCK_EX);
        try {
            self::writeConfig(self::deepMerge(self::readLocalConfig(), $patch));
        } finally {
            if ($lock) { flock($lock, LOCK_UN); fclose($lock); }
        }
        Config::reset();
    }

    private static function deepMerge(array $a, array $b): array
    {
        foreach ($b as $k => $v) {
            if (is_array($v) && isset($a[$k]) && is_array($a[$k]) && !Arr::isList($v) && !Arr::isList($a[$k])) $a[$k] = self::deepMerge($a[$k], $v);
            else $a[$k] = $v;
        }
        return $a;
    }
}

/**
 * One-time setup code (finding F1 / F4): proves that the person at the browser can read a file on the server
 * computer — which a visitor from the internet cannot — instead of trusting the network position ("the request comes
 * from localhost"), which any TCP forwarder (tunnel, port forwarding, a reverse proxy that adds no header) can fake.
 *
 *   ensure()   the current code; creates data/setup-code.php (random 12 characters from an alphabet without the
 *              look-alikes 0 O 1 I L, valid 24 hours, PHP exit guard, mode 0600) or reuses an unexpired one
 *   check()    constant-time comparison; upper / lower case, spaces and dashes do not matter; false when there is no
 *              code, it expired or the file is damaged — never throws
 *   consume()  the code was used: the file is deleted (the next ensure() makes a new one)
 * The code is never shown over HTTP: the operator reads it with `php cli/tfm.php setup-code` or opens
 * data/setup-code.php on the server PC. Used by install.php and the first-admin bootstrap of the admin site.
 */
final class SetupCode
{
    public const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
    public const LENGTH = 12;
    public const TTL = 86400;

    public static function path(): string { return Config::dataDir() . DIRECTORY_SEPARATOR . 'setup-code.php'; }

    /** the stored code when it is valid now, else null (missing, expired, damaged) */
    private static function current(): ?array
    {
        $f = self::path();
        clearstatcache(true, $f);
        if (!is_file($f)) return null;
        try { $v = PrivateFile::load($f); } catch (\Throwable $e) { return null; }
        if (!is_array($v) || !isset($v['code'], $v['expires_at']) || !is_string($v['code']) || !is_int($v['expires_at'])) return null;
        if (strlen($v['code']) !== self::LENGTH || strspn($v['code'], self::ALPHABET) !== self::LENGTH) return null;
        return $v['expires_at'] > time() ? $v : null;
    }

    public static function ensure(): string
    {
        $cur = self::current();
        if ($cur !== null) return $cur['code'];
        $lock = @fopen(Config::dataDir() . DIRECTORY_SEPARATOR . '.setup-code.lock', 'c');
        if ($lock) flock($lock, LOCK_EX);
        try {
            $cur = self::current(); // another request may have made one while this one waited
            if ($cur !== null) return $cur['code'];
            $code = '';
            $n = strlen(self::ALPHABET);
            for ($i = 0; $i < self::LENGTH; $i++) $code .= self::ALPHABET[random_int(0, $n - 1)];
            $now = time();
            $row = ['code' => $code, 'created_at' => $now, 'expires_at' => $now + self::TTL];
            $php = "<?php\n// 전통발효체험관 설치 코드 (한 번만 쓸 수 있어요): " . self::format($code) . "\n"
                . '// ' . date('Y-m-d H:i', $now + self::TTL) . " 까지 유효해요. 설치 화면이나 첫 관리자 지정 화면에 이 코드를 넣으세요.\n"
                . "// 이 파일은 서버 컴퓨터에서만 볼 수 있어요 (웹으로 열면 아무것도 나오지 않아요). 쓰고 나면 저절로 지워져요.\n"
                . "if (!defined('TFM_BOOT')) { http_response_code(404); exit; }\nreturn " . var_export($row, true) . ";\n";
            PrivateFile::write(self::path(), $php);
            return $code;
        } finally {
            if ($lock) { flock($lock, LOCK_UN); fclose($lock); }
        }
    }

    public static function check(string $code): bool
    {
        $cur = self::current();
        $given = strtoupper((string) preg_replace('/[\s\-_.]+/u', '', $code));
        if ($cur === null) {
            hash_equals(str_repeat('-', self::LENGTH), str_pad(substr($given, 0, self::LENGTH), self::LENGTH)); // same work either way
            return false;
        }
        return strlen($given) === self::LENGTH && hash_equals($cur['code'], $given);
    }

    public static function consume(): void
    {
        $f = self::path();
        @unlink($f);
        PrivateFile::forget($f);
    }

    /** ABCD-EFGH-JKMN: easier to read aloud and to type (check() ignores the dashes) */
    public static function format(string $code): string
    {
        return implode('-', str_split($code, 4));
    }
}
