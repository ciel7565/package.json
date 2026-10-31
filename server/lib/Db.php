<?php
/**
 * PDO wrapper — prepared statements only. SQLite (default, WAL) or MySQL/MariaDB (10.3+).
 * Schema is created/upgraded automatically from database/schema(.sqlite).sql (schema_version table).
 * PHP 7.2 syntax only.
 */
declare(strict_types=1);

namespace Tfm;

use PDO;

if (!defined('TFM_BOOT')) { http_response_code(404); exit; }

final class Db
{
    public const SCHEMA_VERSION = 5;
    /** @var PDO|null */
    private static $pdo = null;
    /** @var string */
    private static $driver = 'sqlite';
    /** @var int */
    private static $txDepth = 0;
    /** @var bool|null SQLite ≥ 3.24 (INSERT … ON CONFLICT DO UPDATE); older libraries get UPDATE-then-INSERT */
    private static $nativeUpsert = null;

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
    }

    public static function pdo(): PDO
    {
        if (self::$pdo) return self::$pdo;
        $driver = strtolower((string) Config::get('db.driver', 'sqlite'));
        if ($driver === 'mysql') {
            $pdo = self::connectMysql((array) Config::get('db.mysql', []));
            self::$driver = 'mysql';
        } else {
            if (!extension_loaded('pdo_sqlite')) throw new \RuntimeException('pdo_sqlite extension missing');
            $path = self::dbFilePath();
            $pdo = new PDO('sqlite:' . $path, null, null, self::options(8)); // busy timeout (seconds) while another request holds the write lock
            @chmod($path, 0640);
            $pdo->exec('PRAGMA journal_mode = WAL');
            $pdo->exec('PRAGMA synchronous = NORMAL');
            $pdo->exec('PRAGMA foreign_keys = ON');
            $pdo->exec('PRAGMA secure_delete = ON');
            try { $pdo->exec('PRAGMA trusted_schema = OFF'); } catch (\Throwable $e) { /* SQLite < 3.31 */ }
            $pdo->exec('PRAGMA busy_timeout = 8000');
            self::$driver = 'sqlite';
        }
        self::$pdo = $pdo;
        if (Config::get('db.auto_migrate', true)) self::migrate();
        return $pdo;
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

    /** a MySQL/MariaDB connection from a db.mysql-style array (also used by the installer to test credentials) */
    public static function connectMysql(array $m, bool $selectDb = true): PDO
    {
        if (!extension_loaded('pdo_mysql')) throw new \RuntimeException('pdo_mysql extension missing');
        $db = (string) (isset($m['database']) && $m['database'] !== '' ? $m['database'] : 'fermentation_metaverse');
        $dsn = !empty($m['socket'])
            ? sprintf('mysql:unix_socket=%s;%scharset=utf8mb4', $m['socket'], $selectDb ? 'dbname=' . $db . ';' : '')
            : sprintf('mysql:host=%s;port=%d;%scharset=utf8mb4', isset($m['host']) && $m['host'] !== '' ? $m['host'] : '127.0.0.1', (int) (isset($m['port']) ? $m['port'] : 3306), $selectDb ? 'dbname=' . $db . ';' : '');
        $opts = self::options(5);
        if (defined('PDO::MYSQL_ATTR_MULTI_STATEMENTS')) $opts[PDO::MYSQL_ATTR_MULTI_STATEMENTS] = false;
        $pdo = new PDO($dsn, (string) (isset($m['username']) ? $m['username'] : 'root'), (string) (isset($m['password']) ? $m['password'] : ''), $opts);
        $pdo->exec("SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci");
        $pdo->exec("SET SESSION sql_mode = 'STRICT_ALL_TABLES,NO_ZERO_DATE,NO_ENGINE_SUBSTITUTION,ERROR_FOR_DIVISION_BY_ZERO'");
        return $pdo;
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
        if ($update === null) $update = array_values(array_diff($cols, $keys));
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

    // ------------------------------------------------------------------ schema
    public static function schemaVersion(): int
    {
        try { $v = self::value('SELECT MAX(version) FROM schema_version'); return (int) ($v === null ? 0 : $v); }
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
