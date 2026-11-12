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
     * create_db (bool), admin_email, admin_nickname, admin_password, toss_client, toss_secret, toss_mock (bool).
     * Returns a summary; throws ApiException with a Korean message on any problem.
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

        $local = [];
        $cfgFile = self::configPath();
        if (is_file($cfgFile)) { $prev = @include $cfgFile; if (is_array($prev)) $local = $prev; }
        $local['db'] = isset($local['db']) && is_array($local['db']) ? $local['db'] : [];
        $local['db']['driver'] = $driver;
        if ($driver === 'mysql') {
            $m = [
                'host' => $str('host', '127.0.0.1') !== '' ? $str('host', '127.0.0.1') : '127.0.0.1',
                'port' => (int) ($str('port', '3306') !== '' ? $str('port', '3306') : '3306'),
                'socket' => $str('socket'),
                'database' => $str('database', 'fermentation_metaverse') !== '' ? $str('database', 'fermentation_metaverse') : 'fermentation_metaverse',
                'username' => $str('username', 'root') !== '' ? $str('username', 'root') : 'root',
                'password' => isset($in['password']) && is_string($in['password']) ? $in['password'] : '',
            ];
            if (!preg_match('/^[A-Za-z0-9_]{1,64}$/', $m['database'])) throw new ApiException(400, 'DB_NAME', '데이터베이스 이름은 영문·숫자·밑줄만 쓸 수 있어요 (64자 이하).');
            if ($m['port'] < 1 || $m['port'] > 65535) throw new ApiException(400, 'DB_PORT', '포트 번호가 올바르지 않아요.');
            try {
                // connect without a database first: create it when the account may (XAMPP root can), else it must exist
                try {
                    $pdo = Db::connectMysql($m, false);
                    if (!empty($in['create_db'])) $pdo->exec('CREATE DATABASE IF NOT EXISTS `' . $m['database'] . '` DEFAULT CHARACTER SET utf8mb4 DEFAULT COLLATE utf8mb4_unicode_ci');
                } catch (\PDOException $e) {
                    // some hosts refuse a connection without a database name: try directly
                    Db::connectMysql($m, true);
                }
                $pdo = Db::connectMysql($m, true);
                $ver = (string) $pdo->getAttribute(\PDO::ATTR_SERVER_VERSION);
            } catch (\PDOException $e) {
                Log::warn('INSTALL', 'mysql connection failed', ['code' => (string) $e->getCode()]);
                throw new ApiException(400, 'DB_CONNECT', 'MySQL/MariaDB 에 연결하지 못했어요: ' . mb_substr(self::dbError($e), 0, 200) . ' — 호스트·포트·사용자·비밀번호와 MySQL 이 켜져 있는지 확인하세요.');
            }
            $local['db']['mysql'] = $m;
        } else {
            $ver = 'SQLite';
            if (!extension_loaded('pdo_sqlite')) throw new ApiException(400, 'DB_DRIVER', 'pdo_sqlite 확장이 없어요.');
        }
        $local['toss'] = isset($local['toss']) && is_array($local['toss']) ? $local['toss'] : [];
        $tc = $str('toss_client');
        $ts = $str('toss_secret');
        if ($tc !== '' && !preg_match('/^(test|live)_(ck|gck)_[A-Za-z0-9]{10,80}$/', $tc)) throw new ApiException(400, 'TOSS_KEY', '토스 클라이언트 키 형식이 올바르지 않아요 (test_ck_… 또는 live_ck_…).');
        if ($ts !== '' && !preg_match('/^(test|live)_(sk|gsk)_[A-Za-z0-9]{10,80}$/', $ts)) throw new ApiException(400, 'TOSS_KEY', '토스 시크릿 키 형식이 올바르지 않아요 (test_sk_… 또는 live_sk_…).');
        if (($tc === '') !== ($ts === '')) throw new ApiException(400, 'TOSS_KEY', '토스 키는 클라이언트 키와 시크릿 키를 함께 넣어 주세요.');
        if ($tc !== '') { $local['toss']['client_key'] = $tc; $local['toss']['secret_key'] = $ts; }
        $local['toss']['mock'] = !empty($in['toss_mock']);

        self::writeConfig($local);
        Config::reset();
        Db::reset();
        try {
            Db::pdo();
            Db::migrate();
        } catch (\Throwable $e) {
            throw new ApiException(500, 'SCHEMA', '테이블을 만들지 못했어요: ' . mb_substr($e->getMessage(), 0, 200));
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
        Audit::log('install', (int) $admin['id'], ['driver' => $driver, 'created' => $created, 'schema' => $version, 'mock' => !empty($in['toss_mock'])], 'alert', (int) $admin['id']);
        if (@file_put_contents(self::lockPath(), 'installed ' . gmdate('c') . ' by ' . (PHP_SAPI === 'cli' ? 'cli' : 'web') . "\n", LOCK_EX) === false) {
            throw new ApiException(500, 'LOCK', 'data/install.lock 파일을 만들지 못했어요 (data 폴더 쓰기 권한).');
        }
        return ['driver' => $driver, 'server' => $ver, 'schema' => $version, 'adminId' => (int) $admin['id'], 'adminNickname' => (string) $admin['nickname'], 'adminCreated' => $created, 'mock' => !empty($in['toss_mock']), 'tossKeys' => $tc !== ''];
    }

    private static function dbError(\PDOException $e): string
    {
        $m = $e->getMessage();
        // never echo a password that could be part of the DSN message
        return (string) preg_replace('/password[^,;]*/i', 'password …', $m);
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
