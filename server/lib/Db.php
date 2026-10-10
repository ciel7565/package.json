<?php
/**
 * PDO wrapper — prepared statements only. SQLite (default, WAL) or MySQL/MariaDB.
 * Schema is created/upgraded automatically from database/schema(.sqlite).sql (schema_version table).
 */
declare(strict_types=1);

namespace Tfm;

use PDO;

if (!defined('TFM_BOOT')) { http_response_code(404); exit; }

final class Db
{
    public const SCHEMA_VERSION = 1;
    private static ?PDO $pdo = null;
    private static string $driver = 'sqlite';
    private static int $txDepth = 0;

    public static function driver(): string { self::pdo(); return self::$driver; }
    /** configured driver name without connecting (never throws) */
    public static function driverSafe(): string
    {
        try { return self::driver(); } catch (\Throwable) { return strtolower((string) Config::get('db.driver', 'sqlite')); }
    }

    public static function pdo(): PDO
    {
        if (self::$pdo) return self::$pdo;
        $driver = strtolower((string) Config::get('db.driver', 'sqlite'));
        $opts = [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES => false,
            PDO::ATTR_STRINGIFY_FETCHES => false,
        ];
        if ($driver === 'mysql') {
            if (!extension_loaded('pdo_mysql')) throw new \RuntimeException('pdo_mysql extension missing');
            $m = (array) Config::get('db.mysql', []);
            $dsn = !empty($m['socket'])
                ? sprintf('mysql:unix_socket=%s;dbname=%s;charset=utf8mb4', $m['socket'], $m['database'] ?? 'fermentation_metaverse')
                : sprintf('mysql:host=%s;port=%d;dbname=%s;charset=utf8mb4', $m['host'] ?? '127.0.0.1', (int) ($m['port'] ?? 3306), $m['database'] ?? 'fermentation_metaverse');
            if (defined('PDO::MYSQL_ATTR_MULTI_STATEMENTS')) $opts[PDO::MYSQL_ATTR_MULTI_STATEMENTS] = false;
            $opts[PDO::ATTR_TIMEOUT] = 5;
            $pdo = new PDO($dsn, (string) ($m['username'] ?? 'root'), (string) ($m['password'] ?? ''), $opts);
            $pdo->exec("SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci");
            $pdo->exec("SET SESSION sql_mode = 'STRICT_ALL_TABLES,NO_ZERO_DATE,NO_ENGINE_SUBSTITUTION,ERROR_FOR_DIVISION_BY_ZERO'");
            self::$driver = 'mysql';
        } else {
            if (!extension_loaded('pdo_sqlite')) throw new \RuntimeException('pdo_sqlite extension missing');
            $path = self::sqlitePath();
            $opts[PDO::ATTR_TIMEOUT] = 8; // busy timeout (seconds) while another request holds the write lock
            $pdo = new PDO('sqlite:' . $path, null, null, $opts);
            @chmod($path, 0640);
            $pdo->exec('PRAGMA journal_mode = WAL');
            $pdo->exec('PRAGMA synchronous = NORMAL');
            $pdo->exec('PRAGMA foreign_keys = ON');
            $pdo->exec('PRAGMA secure_delete = ON');
            $pdo->exec('PRAGMA trusted_schema = OFF');
            $pdo->exec('PRAGMA busy_timeout = 8000');
            self::$driver = 'sqlite';
        }
        self::$pdo = $pdo;
        if (Config::get('db.auto_migrate', true)) self::migrate();
        return $pdo;
    }

    public static function sqlitePath(): string
    {
        $p = (string) Config::get('db.sqlite_path', '');
        if ($p === '') $p = Config::dataDir() . '/' . Config::secret('db_file');
        $dir = dirname($p);
        if (!is_dir($dir)) Config::ensureDir($dir, true);
        return $p;
    }

    // ------------------------------------------------------------------ queries (always prepared)
    public static function run(string $sql, array $params = []): \PDOStatement
    {
        $st = self::pdo()->prepare($sql);
        foreach (array_values($params) as $i => $v) {
            $type = is_int($v) ? PDO::PARAM_INT : (is_bool($v) ? PDO::PARAM_INT : ($v === null ? PDO::PARAM_NULL : PDO::PARAM_STR));
            $st->bindValue($i + 1, is_bool($v) ? (int) $v : $v, $type);
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

    public static function value(string $sql, array $params = []): mixed
    {
        $r = self::run($sql, $params)->fetchColumn();
        return $r === false ? null : $r;
    }

    public static function exec(string $sql, array $params = []): int { return self::run($sql, $params)->rowCount(); }

    public static function insert(string $table, array $row): int
    {
        self::ident($table);
        $cols = array_keys($row);
        array_walk($cols, [self::class, 'ident']);
        $sql = 'INSERT INTO ' . $table . ' (' . implode(', ', $cols) . ') VALUES (' . implode(', ', array_fill(0, count($cols), '?')) . ')';
        self::run($sql, array_values($row));
        return (int) self::pdo()->lastInsertId();
    }

    /** INSERT or UPDATE on primary/unique key conflict (portable between SQLite ≥ 3.24 and MySQL/MariaDB) */
    public static function upsert(string $table, array $row, array $keys, ?array $update = null): void
    {
        self::ident($table);
        $cols = array_keys($row);
        array_walk($cols, [self::class, 'ident']);
        $update ??= array_values(array_diff($cols, $keys));
        $ph = implode(', ', array_fill(0, count($cols), '?'));
        if (self::driver() === 'mysql') {
            $set = implode(', ', array_map(fn ($c) => "$c = VALUES($c)", $update));
            $sql = "INSERT INTO $table (" . implode(', ', $cols) . ") VALUES ($ph) ON DUPLICATE KEY UPDATE $set";
        } else {
            $set = implode(', ', array_map(fn ($c) => "$c = excluded.$c", $update));
            $sql = "INSERT INTO $table (" . implode(', ', $cols) . ") VALUES ($ph) ON CONFLICT(" . implode(', ', $keys) . ") DO UPDATE SET $set";
        }
        self::run($sql, array_values($row));
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
    public static function tx(callable $fn): mixed
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
            try { if (self::$driver === 'sqlite') $pdo->exec('ROLLBACK'); elseif ($pdo->inTransaction()) $pdo->rollBack(); } catch (\Throwable) { /* ignore */ }
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
        try { return (int) (self::value('SELECT MAX(version) FROM schema_version') ?? 0); }
        catch (\Throwable) { return 0; }
    }

    public static function migrate(): void
    {
        $pdo = self::$pdo;
        if (!$pdo) return;
        $have = self::schemaVersion();
        if ($have >= self::SCHEMA_VERSION) return;
        $file = TFM_ROOT . '/database/' . (self::$driver === 'mysql' ? 'schema.sql' : 'schema.sqlite.sql');
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
                    if (self::schemaVersion() < self::SCHEMA_VERSION) foreach ($stmts as $s) $pdo->exec($s);
                    $pdo->exec('COMMIT');
                } catch (\Throwable $e) { $pdo->exec('ROLLBACK'); throw $e; }
            } else {
                foreach ($stmts as $s) $pdo->exec($s); // MySQL DDL auto-commits; statements are idempotent (IF NOT EXISTS)
            }
            Log::info('DB', 'schema installed/upgraded', ['from' => $have, 'to' => self::SCHEMA_VERSION, 'driver' => self::$driver]);
        } finally {
            if ($locked) self::value("SELECT RELEASE_LOCK('tfm_migrate')");
        }
    }

    /** split a schema file into statements; skips comments and CREATE DATABASE/USE (the DSN selects the DB) */
    private static function splitSql(string $sql): array
    {
        $sql = preg_replace('/^\s*--.*$/m', '', $sql);
        $out = [];
        foreach (preg_split('/;\s*(\r?\n|$)/', $sql) as $s) {
            $s = trim($s);
            if ($s === '' || preg_match('/^(CREATE\s+DATABASE|USE\s)/i', $s)) continue;
            $out[] = $s;
        }
        return $out;
    }
}
