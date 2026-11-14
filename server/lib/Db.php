<?php
/**
 * PDO wrapper — prepared statements only. SQLite (default, WAL) or MySQL/MariaDB (10.3+).
 * Schema is created/upgraded automatically from database/schema(.sqlite).sql (schema_version table).
 * PHP 7.2 syntax only.
 */
declare(strict_types=1);

namespace Tfm;

use PDO;

if (!defined('TFM_BOOT')) { if (function_exists('header_remove')) header_remove('X-Powered-By'); http_response_code(404); exit; }

final class Db
{
    public const SCHEMA_VERSION = 7;
    /** @var PDO|null */
    private static $pdo = null;
    /** @var string */
    private static $driver = 'sqlite';
    /** @var int */
    private static $txDepth = 0;
    /** @var bool|null SQLite ≥ 3.24 (INSERT … ON CONFLICT DO UPDATE); older libraries get UPDATE-then-INSERT */
    private static $nativeUpsert = null;
    /** @var bool the schema is older than this code and the account may not change it (db.auto_migrate off) */
    private static $outdated = false;

    public static function driver(): string { self::pdo(); return self::$driver; }
    /** configured driver name without connecting (never throws) */
    public static function driverSafe(): string
    {
        try { return self::driver(); } catch (\Throwable $e) { return strtolower((string) Config::get('db.driver', 'sqlite')); }
    }

    /** drop the connection (the installer switches configuration at runtime) */
    public static function reset(): void
    {
        self::$pdo = null;
        self::$txDepth = 0;
        self::$nativeUpsert = null;
        self::$outdated = false;
    }

    /**
     * The connection of the configured account. With db.auto_migrate (default) the schema is created / upgraded here.
     * An installation with a dedicated account that may only read and write rows has auto_migrate off: when the
     * schema is older than this code every use answers 503 SCHEMA_OUTDATED (run `php cli/tfm.php migrate --admin-user …`)
     * instead of failing later on a missing table.
     */
    public static function pdo(): PDO
    {
        if (self::$pdo) {
            if (self::$outdated) throw self::outdatedError();
            return self::$pdo;
        }
        self::$pdo = self::open();
        if (Config::get('db.auto_migrate', true)) {
            self::migrate();
        } elseif (self::schemaVersion() < self::SCHEMA_VERSION) {
            self::$outdated = true;
            Log::error('DB', 'schema is older than the code and db.auto_migrate is off: run php cli/tfm.php migrate --admin-user <database administrator>', ['have' => self::schemaVersionRaw(), 'need' => self::SCHEMA_VERSION]);
            throw self::outdatedError();
        }
        return self::$pdo;
    }

    private static function outdatedError(): ApiException
    {
        return new ApiException(503, 'SCHEMA_OUTDATED', '서버를 업데이트하는 중이에요. 잠시 후 다시 와 주세요. (운영자: 서버에서 php cli/tfm.php migrate --admin-user <DB 관리자 계정> 을 실행해 데이터베이스를 새 버전으로 올려 주세요.)');
    }

    /** connect with the configured account (no schema work) */
    private static function open(): PDO
    {
        $driver = strtolower((string) Config::get('db.driver', 'sqlite'));
        if ($driver === 'mysql') {
            $pdo = self::connectMysql((array) Config::get('db.mysql', []));
            self::$driver = 'mysql';
            return $pdo;
        }
        if (!extension_loaded('pdo_sqlite')) throw new \RuntimeException('pdo_sqlite extension missing');
        $path = self::dbFilePath();
        $pdo = new PDO('sqlite:' . $path, null, null, self::options(8)); // busy timeout (seconds) while another request holds the write lock
        PrivateFile::tighten($path); // 0600 before the -wal / -shm files exist: SQLite gives them the mode of the main file
        $pdo->exec('PRAGMA journal_mode = WAL');
        $pdo->exec('PRAGMA synchronous = NORMAL');
        $pdo->exec('PRAGMA foreign_keys = ON');
        $pdo->exec('PRAGMA secure_delete = ON');
        try { $pdo->exec('PRAGMA trusted_schema = OFF'); } catch (\Throwable $e) { /* SQLite < 3.31 */ }
        $pdo->exec('PRAGMA busy_timeout = 8000');
        foreach (['-wal', '-shm'] as $suffix) if (is_file($path . $suffix)) PrivateFile::tighten($path . $suffix); // files of an older installation
        self::$driver = 'sqlite';
        return $pdo;
    }

    /**
     * Use $pdo — a connection made with other credentials (the database administrator the installer or `cli migrate
     * --admin-user` was given) — for the calls that follow. No schema guard, no auto-migration. reset() returns to the
     * configured account. The administrator's credentials are never stored.
     */
    public static function adopt(PDO $pdo, string $driver = 'mysql'): void
    {
        self::reset();
        self::$pdo = $pdo;
        self::$driver = $driver === 'sqlite' ? 'sqlite' : 'mysql';
    }

    /** connect with the configured account and create / upgrade the schema now, whatever db.auto_migrate says (cli migrate) */
    public static function upgrade(): int
    {
        self::reset();
        self::$pdo = self::open();
        self::migrate();
        return self::schemaVersionRaw();
    }

    private static function options(int $timeout): array
    {
        return [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES => false,
            PDO::ATTR_STRINGIFY_FETCHES => false,
            PDO::ATTR_TIMEOUT => $timeout,
        ];
    }

    /** is the database on this machine? (a socket, localhost or a loopback address) */
    public static function isLocalDb(array $m): bool
    {
        if (!empty($m['socket'])) return true;
        $h = strtolower(trim((string) (isset($m['host']) ? $m['host'] : ''), " \t[]"));
        return $h === '' || $h === 'localhost' || $h === '::1' || (bool) preg_match('/^127(\.\d{1,3}){3}$/', $h);
    }

    /**
     * PDO options for a db.mysql-style array: real prepared statements (no emulation), one statement per query, no
     * LOAD DATA LOCAL INFILE (a hostile server could otherwise ask the client for any file PHP can read), TLS when
     * db.mysql.ssl_ca names a CA file (ssl_verify = false keeps the encryption but does not check the certificate).
     * A database on another machine without TLS is refused unless db.mysql.allow_insecure_remote is true: the
     * password and every row would cross the network in clear text.
     */
    public static function mysqlOptions(array $m): array
    {
        $opts = self::options(5);
        if (defined('PDO::MYSQL_ATTR_MULTI_STATEMENTS')) $opts[PDO::MYSQL_ATTR_MULTI_STATEMENTS] = false;
        if (defined('PDO::MYSQL_ATTR_LOCAL_INFILE')) $opts[PDO::MYSQL_ATTR_LOCAL_INFILE] = false;
        $ca = isset($m['ssl_ca']) && is_string($m['ssl_ca']) ? trim($m['ssl_ca']) : '';
        if ($ca !== '') {
            if (!defined('PDO::MYSQL_ATTR_SSL_CA')) throw new \RuntimeException('이 PHP 의 pdo_mysql 은 암호화 연결(TLS)을 지원하지 않아요 (db.mysql.ssl_ca 를 쓸 수 없어요).');
            $opts[PDO::MYSQL_ATTR_SSL_CA] = $ca;
            if (defined('PDO::MYSQL_ATTR_SSL_VERIFY_SERVER_CERT')) $opts[PDO::MYSQL_ATTR_SSL_VERIFY_SERVER_CERT] = !(isset($m['ssl_verify']) && $m['ssl_verify'] === false);
        } elseif (!self::isLocalDb($m) && empty($m['allow_insecure_remote'])) {
            throw new \RuntimeException('데이터베이스가 다른 컴퓨터에 있는데 암호화(TLS) 설정이 없어 연결하지 않았어요. config/config.local.php 의 db.mysql.ssl_ca 에 CA 인증서 파일 경로를 넣어 주세요. 같은 내부망이라 암호화 없이 써도 된다면 db.mysql.allow_insecure_remote 를 true 로 바꾸세요.');
        }
        return $opts;
    }

    /** a MySQL/MariaDB connection from a db.mysql-style array (also used by the installer to test credentials) */
    public static function connectMysql(array $m, bool $selectDb = true): PDO
    {
        if (!extension_loaded('pdo_mysql')) throw new \RuntimeException('pdo_mysql extension missing');
        $opts = self::mysqlOptions($m);
        $db = (string) (isset($m['database']) && $m['database'] !== '' ? $m['database'] : 'fermentation_metaverse');
        $dsn = !empty($m['socket'])
            ? sprintf('mysql:unix_socket=%s;%scharset=utf8mb4', $m['socket'], $selectDb ? 'dbname=' . $db . ';' : '')
            : sprintf('mysql:host=%s;port=%d;%scharset=utf8mb4', isset($m['host']) && $m['host'] !== '' ? $m['host'] : '127.0.0.1', (int) (isset($m['port']) ? $m['port'] : 3306), $selectDb ? 'dbname=' . $db . ';' : '');
        $user = (string) (isset($m['username']) ? $m['username'] : '');
        if ($user === '') throw new \RuntimeException('db.mysql.username is empty: run install.php or php cli/tfm.php install (no default account)');
        $pdo = new PDO($dsn, $user, (string) (isset($m['password']) ? $m['password'] : ''), $opts);
        $pdo->exec("SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci");
        $pdo->exec("SET SESSION sql_mode = 'STRICT_ALL_TABLES,NO_ZERO_DATE,NO_ENGINE_SUBSTITUTION,ERROR_FOR_DIVISION_BY_ZERO'");
        return $pdo;
    }

    // ------------------------------------------------------------------ who are we connected as (admin health, config audit)
    /**
     * The runtime database account and what it may do — for the admin health page and the configuration audit.
     *   MySQL / MariaDB: user, host, isRoot, emptyPassword (the configured password is empty), globalPrivileges
     *     (anything but USAGE on *.*), ddlPrivileges (more than SELECT / INSERT / UPDATE / DELETE anywhere; the names
     *     are in extraPrivileges), otherDatabases, remote, tls, grants (SHOW GRANTS with every password hash removed),
     *     publicGrants (grants of the PUBLIC role: every account has them), visibleDatabases (databases besides its own the
     *     account can see), testDatabaseOpen (the "test" databases of a default installation are open to every account:
     *     a server setting to remove — DB-HARDENING).
     *   SQLite: file (name only), mode, worldReadable, randomName, insideWebRoot.
     * Never throws: `error` holds the exception class when the database cannot be asked.
     */
    public static function accountAudit(): array
    {
        $out = ['driver' => strtolower((string) Config::get('db.driver', 'sqlite')) === 'mysql' ? 'mysql' : 'sqlite', 'user' => '', 'host' => '', 'isRoot' => false,
            'emptyPassword' => false, 'globalPrivileges' => false, 'ddlPrivileges' => false, 'grants' => []];
        try {
            return self::driver() === 'mysql' ? self::auditMysql($out) : self::auditSqlite($out);
        } catch (\Throwable $e) {
            $out['error'] = get_class($e); // the class only: a PDO message can carry connection details
            return $out;
        }
    }

    private static function auditMysql(array $out): array
    {
        $m = (array) Config::get('db.mysql', []);
        $cur = (string) self::value('SELECT CURRENT_USER()');
        $at = strrpos($cur, '@');
        $out['driver'] = 'mysql';
        $out['user'] = $at === false ? $cur : (string) substr($cur, 0, $at);
        $out['host'] = $at === false ? '' : (string) substr($cur, $at + 1);
        $out['database'] = (string) self::value('SELECT DATABASE()');
        $out['isRoot'] = strtolower($out['user']) === 'root';
        $out['emptyPassword'] = (string) (isset($m['password']) ? $m['password'] : '') === '';
        $out['remote'] = !self::isLocalDb($m);
        $out['otherDatabases'] = false;
        $out['publicGrants'] = [];
        $out['testDatabaseOpen'] = false;
        $extra = [];
        foreach (self::all('SHOW GRANTS') as $row) {
            $g = (string) reset($row);
            // MariaDB 10.11+: grants of the PUBLIC role apply to every account — usually the "test" databases of a default
            // installation. They are a server setting (docs: DB-HARDENING), reported apart from this account's own rights.
            if (preg_match('/\sTO\s+PUBLIC\s*$/i', $g)) {
                $out['publicGrants'][] = self::redactGrant($g);
                if (preg_match('/\sON\s+`?test(?:\\\\?_%)?`?\./i', $g)) $out['testDatabaseOpen'] = true;
                continue;
            }
            $out['grants'][] = self::redactGrant($g);
            if (stripos($g, 'WITH GRANT OPTION') !== false) $extra[] = 'GRANT OPTION';
            if (!preg_match('/^GRANT\s+(.+?)\s+ON\s+(.+?)\s+TO\s/i', $g, $mm)) { $extra[] = 'ROLE'; continue; } // GRANT `role` TO …
            $privs = array_filter(array_map('trim', explode(',', strtoupper((string) preg_replace('/\([^)]*\)/', '', $mm[1])))), 'strlen');
            $more = array_values(array_diff($privs, ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'USAGE']));
            $extra = array_merge($extra, $more);
            $object = str_replace(['`', '\\'], '', $mm[2]);
            if ($object === '*.*') {
                if (array_diff($privs, ['USAGE'])) $out['globalPrivileges'] = true;
            } elseif (strcasecmp((string) strtok($object, '.'), $out['database']) !== 0) {
                $out['otherDatabases'] = true;
            }
        }
        $out['extraPrivileges'] = array_values(array_unique($extra));
        $out['ddlPrivileges'] = $out['extraPrivileges'] !== [];
        // the databases this account can see besides its own: older servers grant the "test" databases to every account
        // through anonymous rows in mysql.db, which SHOW GRANTS does not list
        try {
            $vis = [];
            foreach (self::all('SHOW DATABASES') as $row) {
                $d = (string) reset($row);
                if (strcasecmp($d, 'information_schema') !== 0 && strcasecmp($d, $out['database']) !== 0) $vis[] = $d;
            }
            $out['visibleDatabases'] = $vis;
            foreach ($vis as $d) if (preg_match('/^test(?:_|$)/i', $d)) $out['testDatabaseOpen'] = true;
        } catch (\Throwable $e) { $out['visibleDatabases'] = []; }
        try {
            $ssl = self::one("SHOW SESSION STATUS LIKE 'Ssl_cipher'");
            $out['tls'] = $ssl !== null && (string) (isset($ssl['Value']) ? $ssl['Value'] : '') !== '';
        } catch (\Throwable $e) { $out['tls'] = false; }
        return $out;
    }

    /** SHOW GRANTS prints the password hash on MariaDB (IDENTIFIED BY PASSWORD '*…'): never pass it on */
    private static function redactGrant(string $g): string
    {
        $g = (string) preg_replace("/IDENTIFIED\s+(?:BY\s+PASSWORD|BY|WITH\s+\S+\s+AS|VIA\s+\S+\s+(?:USING|AS))\s+'[^']*'/i", 'IDENTIFIED BY (hidden)', $g);
        return (string) preg_replace("/'\*?[0-9A-Fa-f]{32,}'/", "'(hidden)'", $g);
    }

    private static function auditSqlite(array $out): array
    {
        $f = self::dbFilePath();
        clearstatcache(false, $f);
        $mode = @fileperms($f);
        $out['driver'] = 'sqlite';
        $out['file'] = basename($f);
        $out['mode'] = $mode === false ? '' : sprintf('%04o', $mode & 0777);
        $out['worldReadable'] = DIRECTORY_SEPARATOR !== '\\' && $mode !== false && ($mode & 0004) !== 0;
        $out['randomName'] = (bool) preg_match('/[0-9a-f]{16,}/i', basename($f));
        $out['insideWebRoot'] = self::insideWebRoot(dirname($f));
        return $out;
    }

    /** is $dir inside the installation folder (which is served by the web server) or the document root? */
    private static function insideWebRoot(string $dir): bool
    {
        $norm = function (string $p): string {
            $r = realpath($p);
            $p = rtrim(str_replace('\\', '/', $r !== false ? $r : $p), '/');
            return DIRECTORY_SEPARATOR === '\\' ? strtolower($p) : $p;
        };
        $roots = [$norm((string) TFM_ROOT)];
        if (PHP_SAPI !== 'cli' && !empty($_SERVER['DOCUMENT_ROOT'])) $roots[] = $norm((string) $_SERVER['DOCUMENT_ROOT']);
        $d = $norm($dir) . '/';
        foreach ($roots as $r) if ($r !== '' && strpos($d, $r . '/') === 0) return true;
        return false;
    }

    public static function dbFilePath(): string
    {
        $p = (string) Config::get('db.sqlite_path', '');
        if ($p === '') $p = Config::dataDir() . DIRECTORY_SEPARATOR . Config::secret('db_file');
        $dir = dirname($p);
        if (!is_dir($dir)) Config::ensureDir($dir, true);
        return $p;
    }

    // ------------------------------------------------------------------ queries (always prepared)
    public static function run(string $sql, array $params = []): \PDOStatement
    {
        $st = self::pdo()->prepare($sql);
        foreach (array_values($params) as $i => $v) {
            if (is_bool($v)) { $type = PDO::PARAM_INT; $v = (int) $v; }
            elseif (is_int($v)) $type = PDO::PARAM_INT;
            elseif ($v === null) $type = PDO::PARAM_NULL;
            else $type = PDO::PARAM_STR;
            $st->bindValue($i + 1, $v, $type);
        }
        $st->execute();
        return $st;
    }

    public static function one(string $sql, array $params = []): ?array
    {
        $r = self::run($sql, $params)->fetch();
        return $r === false ? null : $r;
    }

    public static function all(string $sql, array $params = []): array { return self::run($sql, $params)->fetchAll(); }

    public static function value(string $sql, array $params = [])
    {
        $r = self::run($sql, $params)->fetchColumn();
        return $r === false ? null : $r;
    }

    public static function exec(string $sql, array $params = []): int { return self::run($sql, $params)->rowCount(); }

    public static function insert(string $table, array $row): int
    {
        self::ident($table);
        $cols = array_keys($row);
        foreach ($cols as $c) self::ident((string) $c);
        $sql = 'INSERT INTO ' . $table . ' (' . implode(', ', $cols) . ') VALUES (' . implode(', ', array_fill(0, count($cols), '?')) . ')';
        self::run($sql, array_values($row));
        return (int) self::pdo()->lastInsertId();
    }

    /**
     * INSERT or UPDATE on primary/unique key conflict (portable between SQLite and MySQL/MariaDB 10.3).
     * Always call inside tx() when the result must be atomic on an old SQLite (< 3.24 falls back to UPDATE then INSERT).
     */
    public static function upsert(string $table, array $row, array $keys, ?array $update = null): void
    {
        self::ident($table);
        $cols = array_keys($row);
        foreach ($cols as $c) self::ident((string) $c);
        // finding F14: the conflict keys and an explicit update list are identifiers too, and must be columns of the row
        foreach ($keys as $k) { self::ident((string) $k); if (!array_key_exists($k, $row)) throw new \InvalidArgumentException('upsert key is not a column of the row'); }
        if ($update === null) $update = array_values(array_diff($cols, $keys));
        foreach ($update as $u) { self::ident((string) $u); if (!array_key_exists($u, $row)) throw new \InvalidArgumentException('upsert update column is not a column of the row'); }
        $ph = implode(', ', array_fill(0, count($cols), '?'));
        if (self::driver() === 'mysql') {
            $set = implode(', ', array_map(function ($c) { return "$c = VALUES($c)"; }, $update));
            $sql = "INSERT INTO $table (" . implode(', ', $cols) . ") VALUES ($ph) ON DUPLICATE KEY UPDATE $set";
            self::run($sql, array_values($row));
            return;
        }
        if (self::nativeUpsert()) {
            $set = implode(', ', array_map(function ($c) { return "$c = excluded.$c"; }, $update));
            $sql = "INSERT INTO $table (" . implode(', ', $cols) . ") VALUES ($ph) ON CONFLICT(" . implode(', ', $keys) . ") DO UPDATE SET $set";
            self::run($sql, array_values($row));
            return;
        }
        // old SQLite library (XAMPP PHP 7.2 bundles 3.2x): update first, insert when nothing was there
        $where = [];
        $wv = [];
        foreach ($keys as $k) { $where[] = "$k = ?"; $wv[] = $row[$k]; }
        if ($update) {
            $uv = [];
            foreach ($update as $c) $uv[] = $row[$c];
            $n = self::exec("UPDATE $table SET " . implode(', ', array_map(function ($c) { return "$c = ?"; }, $update)) . ' WHERE ' . implode(' AND ', $where), array_merge($uv, $wv));
            if ($n > 0) return;
        } elseif (self::one("SELECT 1 FROM $table WHERE " . implode(' AND ', $where), $wv)) {
            return;
        }
        self::run("INSERT INTO $table (" . implode(', ', $cols) . ") VALUES ($ph)", array_values($row));
    }

    private static function nativeUpsert(): bool
    {
        if (self::$nativeUpsert === null) {
            $v = (string) self::value('SELECT sqlite_version()');
            self::$nativeUpsert = version_compare($v, '3.24.0', '>=');
        }
        return self::$nativeUpsert;
    }

    /** identifiers are never user input; this guards against programming mistakes */
    private static function ident(string $name): void
    {
        if (!preg_match('/^[a-z_][a-z0-9_]{0,63}$/', $name)) throw new \InvalidArgumentException('bad identifier');
    }

    /**
     * Transaction. SQLite takes the write lock up front (BEGIN IMMEDIATE) so read-validate-write sequences
     * (save validation, rate limits) cannot interleave. Nested calls join the outer transaction.
     */
    public static function tx(callable $fn)
    {
        $pdo = self::pdo();
        if (self::$txDepth > 0) { self::$txDepth++; try { return $fn(); } finally { self::$txDepth--; } }
        if (self::$driver === 'sqlite') $pdo->exec('BEGIN IMMEDIATE'); else $pdo->beginTransaction();
        self::$txDepth = 1;
        try {
            $r = $fn();
            if (self::$driver === 'sqlite') $pdo->exec('COMMIT'); else $pdo->commit();
            return $r;
        } catch (\Throwable $e) {
            try { if (self::$driver === 'sqlite') $pdo->exec('ROLLBACK'); elseif ($pdo->inTransaction()) $pdo->rollBack(); } catch (\Throwable $e2) { /* ignore */ }
            throw $e;
        } finally {
            self::$txDepth = 0;
        }
    }

    /** row-lock suffix for SELECTs inside tx() (SQLite already holds the database write lock) */
    public static function forUpdate(): string { return self::driver() === 'mysql' ? ' FOR UPDATE' : ''; }

    /**
     * Did the database give up on this transaction for a reason that goes away on a new try? InnoDB deadlock
     * (SQLSTATE 40001 / error 1213), lock wait timeout (1205), SQLite busy / locked (5 / 6).
     */
    public static function isRetryable(\Throwable $e): bool
    {
        if (!($e instanceof \PDOException)) return false;
        if ((string) $e->getCode() === '40001') return true;
        $no = isset($e->errorInfo[1]) ? (int) $e->errorInfo[1] : 0;
        return self::$driver === 'mysql' ? ($no === 1213 || $no === 1205) : ($no === 5 || $no === 6);
    }

    /**
     * tx() that runs $fn again (a new transaction, so a new snapshot) when the database reports a deadlock / lock timeout —
     * at most $tries times, with a short random pause. $fn must be safe to run again (everything it did was rolled back).
     * Inside an outer transaction it simply joins it: a deadlock has already undone the outer work, so only the
     * outermost caller may try again.
     */
    public static function txRetry(callable $fn, int $tries = 4)
    {
        self::pdo();
        if (self::$txDepth > 0) return self::tx($fn);
        for ($i = 1; ; $i++) {
            try {
                return self::tx($fn);
            } catch (\Throwable $e) {
                if ($i >= $tries || !self::isRetryable($e)) throw $e;
                usleep(random_int(4000, 20000) * $i);
            }
        }
    }

    // ------------------------------------------------------------------ schema
    public static function schemaVersion(): int
    {
        try { $v = self::value('SELECT MAX(version) FROM schema_version'); return (int) ($v === null ? 0 : $v); }
        catch (\Throwable $e) { return 0; }
    }

    /** the stored schema version on the current connection, also while the schema guard refuses normal use */
    private static function schemaVersionRaw(): int
    {
        if (!self::$pdo) return 0;
        try { $v = self::$pdo->query('SELECT MAX(version) FROM schema_version')->fetchColumn(); return (int) ($v === false || $v === null ? 0 : $v); }
        catch (\Throwable $e) { return 0; }
    }

    public static function migrate(): void
    {
        $pdo = self::$pdo;
        if (!$pdo) return;
        $have = self::schemaVersion();
        if ($have >= self::SCHEMA_VERSION) return;
        $file = TFM_ROOT . DIRECTORY_SEPARATOR . 'database' . DIRECTORY_SEPARATOR . (self::$driver === 'mysql' ? 'schema.sql' : 'schema.sqlite.sql');
        $sql = @file_get_contents($file);
        if ($sql === false) throw new \RuntimeException('schema file missing: database/' . basename($file));
        $locked = false;
        if (self::$driver === 'mysql') {
            $locked = (int) self::value("SELECT GET_LOCK('tfm_migrate', 15)") === 1;
        }
        try {
            if (self::schemaVersion() >= self::SCHEMA_VERSION) return; // another request finished first
            $stmts = self::splitSql($sql);
            if (self::$driver === 'sqlite') {
                $pdo->exec('BEGIN IMMEDIATE');
                try {
                    if (self::schemaVersion() < self::SCHEMA_VERSION) {
                        foreach ($stmts as $s) $pdo->exec($s);
                        self::ensureColumns(); // same transaction: the version rows commit only with the columns
                    }
                    $pdo->exec('COMMIT');
                } catch (\Throwable $e) { $pdo->exec('ROLLBACK'); throw $e; }
            } else {
                foreach ($stmts as $s) $pdo->exec($s); // MySQL DDL auto-commits; statements are idempotent (IF NOT EXISTS)
                self::ensureColumns(); // schema.sql already adds them (information_schema check); this is the safety net
            }
            Log::info('DB', 'schema installed/upgraded', ['from' => $have, 'to' => self::SCHEMA_VERSION, 'driver' => self::$driver]);
        } finally {
            if ($locked) self::value("SELECT RELEASE_LOCK('tfm_migrate')");
        }
    }

    /**
     * Columns added to an existing table by a later schema version. CREATE TABLE IF NOT EXISTS gives a new database
     * every column; an older table gets the missing ones here (SQLite has no "ADD COLUMN IF NOT EXISTS"; on MySQL /
     * MariaDB schema.sql adds them itself and this only repairs a partial import). Nullable columns only.
     */
    private const ADDED_COLUMNS = [
        // v5: the ban watermark of a user retraction (highest chat_messages.id at ban time)
        ['chat_retractions', 'upto_id', 'INTEGER', 'BIGINT UNSIGNED NULL'],
    ];

    private static function ensureColumns(): void
    {
        foreach (self::ADDED_COLUMNS as $c) {
            list($table, $col, $sqliteType, $mysqlType) = $c;
            self::ident($table);
            self::ident($col);
            if (self::hasColumn($table, $col)) continue;
            self::$pdo->exec('ALTER TABLE ' . $table . ' ADD COLUMN ' . $col . ' ' . (self::$driver === 'mysql' ? $mysqlType : $sqliteType));
            Log::info('DB', 'column added', ['table' => $table, 'column' => $col]);
        }
    }

    /** does $table have $column (PRAGMA table_info / information_schema) */
    public static function hasColumn(string $table, string $column): bool
    {
        self::ident($table);
        if (self::driver() === 'mysql') {
            return (int) self::value('SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?', [$table, $column]) > 0;
        }
        foreach (self::all('PRAGMA table_info(' . $table . ')') as $r) {
            if (isset($r['name']) && (string) $r['name'] === $column) return true;
        }
        return false;
    }

    /** split a schema file into statements; skips comments and CREATE DATABASE/USE (the DSN selects the DB) */
    public static function splitSql(string $sql): array
    {
        $sql = (string) preg_replace('/^\s*--.*$/m', '', $sql);
        $out = [];
        foreach (preg_split('/;\s*(\r?\n|$)/', $sql) ?: [] as $s) {
            $s = trim($s);
            if ($s === '' || preg_match('/^(CREATE\s+DATABASE|USE\s)/i', $s)) continue;
            $out[] = $s;
        }
        return $out;
    }
}
