<?php
/**
 * Tfm\Cache — the small shared store behind the hot paths (CONTRACT §16.9).
 *
 *   Cache::get($key, $default = null)            the stored value, or $default (missing, expired, damaged, cache off)
 *   Cache::set($key, $value, $ttl = 0)           store for $ttl seconds (0 = until deleted); null deletes
 *   Cache::add($key, $value, $ttl = 0)           store only when the key is absent — exactly one caller wins
 *   Cache::inc($key, $by = 1, $ttl = 0)          atomic counter; the first hit starts the $ttl; int, or false = unavailable
 *   Cache::del($key)
 *   Cache::remember($key, $ttl, callable $make)  get, or make + set
 *   Cache::lock($name, $ttl = 10, $waitMs = 0)   a named mutex (true = this request holds it) · Cache::unlock($name)
 *   Cache::mutate($key, callable $fn, $ttl = 0)  atomic read-modify-write: $fn(old | null) → new value (null = delete)
 *   Cache::hitWindow($key, $window, $ttl)        one hit in a counting window → [hits in it, hits in the one before]
 *   Cache::peekWindow($key, $window)             the same two numbers without counting a hit
 *   Cache::purge($maxSeconds = 0)                remove expired entries (the CLI `cleanup`, and lazily once an hour)
 *   Cache::driver() / info() / stats()           which store is in use, its size, what this request did
 *
 * Drivers (config cache.driver = auto | apcu | file | db | off):
 *   apcu  shared memory of the PHP processes of ONE web server. Chosen by `auto` when the extension is loaded and
 *         enabled (never for CGI / FastCGI-per-process set-ups, where every process would have a cache of its own).
 *   file  one small file per key under data/cache — the default on XAMPP. Works on every PHP; see "Files" below.
 *   db    table cache_kv (schema v7): for several web servers behind one database. Every call is one or two SQL
 *         statements, so it is slower than the other two; it exists so that rate limits, seats and channels are shared.
 *   off   every call answers "not cached": the callers then use the database exactly as before phase 8.
 *
 * Keys are prefixed per installation (a keyed hash of the app key), so two installations on one machine — or one
 * APCu segment — never see each other's entries, and a rotated app key empties the cache.
 * Values are JSON data: scalars and arrays (an object comes back as an array). Never put a secret into the cache.
 * A cache call never throws: when the store cannot be used the answer is the "miss" / false of that call.
 *
 * Files (the file driver):
 *   data/cache/<2 hex>/<sha1 of the key>.php  =  a PHP exit guard (requested over the web it answers 404 and prints
 *   nothing) + one header line "TFC1 <expires ms> <payload bytes> <crc32>" + the JSON payload ('<' and '>' escaped).
 *   · Every writer holds the lock of its stripe (data/cache/_l/<2 hex>.lock, flock) — counters, add and mutate are
 *     therefore atomic between processes and threads; the lock is released by the system when a process dies.
 *   · Records up to 4 KB, and everything written by mutate(), are rewritten in place with ONE write call: no new file
 *     per update (nothing for an antivirus to scan, no rename over a file that another process holds open — the
 *     Windows problem). Larger records are written to a temp file and renamed over the old one; when the rename is
 *     refused it is retried, then the record is written in place.
 *   · Readers take no lock. A record is used only when its length and checksum match, so a half-written ("torn") file
 *     is never read: the reader looks again a moment later and otherwise reports a miss.
 *
 * The command line and APCu: `php cli/tfm.php ban …` runs in another process and cannot reach the web server's
 * memory. A CLI change to a security entry (keys starting with "s:") therefore also touches data/cache/bust; the web
 * side notices the newer file on its next request, drops its "s:" entries and remembers the moment as s:revall
 * (Tfm\Sync treats every sync token issued before it as revoked).
 * PHP 7.2 syntax only.
 */
declare(strict_types=1);

namespace Tfm;

if (!defined('TFM_BOOT')) { if (function_exists('header_remove')) header_remove('X-Powered-By'); http_response_code(404); exit; }

final class Cache
{
    private const GUARD = "<?php if (function_exists('header_remove')) header_remove('X-Powered-By'); http_response_code(404); exit; ?>\n";
    private const MAGIC = 'TFC1';
    /** records up to this many payload bytes are rewritten in place (one write call) */
    private const INPLACE_MAX = 4096;
    private const JSON_FLAGS = JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_HEX_TAG | JSON_PRESERVE_ZERO_FRACTION;

    /** @var string|null resolved driver of this request */
    private static $driver = null;
    /** @var string|null key prefix of this installation */
    private static $prefix = null;
    /** @var string|null directory of the file driver */
    private static $dir = null;
    /** @var array stripe => [handle, depth] of the stripe locks this request holds */
    private static $held = [];
    /** @var array stripe => handle (kept open for the request) */
    private static $lockFh = [];
    /** @var array name => handle | true of the named locks this request holds */
    private static $named = [];
    /** @var array what this request did */
    private static $stat = ['get' => 0, 'hit' => 0, 'set' => 0, 'del' => 0, 'torn' => 0, 'fail' => 0];
    /** @var array test settings: driver, dir, prefix, now (callable), rename / unlink / read (callables) */
    private static $test = [];
    /** @var bool the bust file was looked at in this request */
    private static $bustSeen = false;

    // ------------------------------------------------------------------ set-up
    /** tests / tools: replace settings for this process (['driver' => 'file', 'dir' => …, 'prefix' => …, 'now' => fn]) */
    public static function configure(array $o): void
    {
        self::reset();
        self::$test = $o;
    }

    /** forget everything derived for this process (tests; the installer after it wrote a new configuration) */
    public static function reset(): void
    {
        foreach (self::$held as $h) { @flock($h[0], LOCK_UN); }
        foreach (self::$lockFh as $fh) { @fclose($fh); }
        foreach (self::$named as $fh) { if (is_resource($fh)) { @flock($fh, LOCK_UN); @fclose($fh); } }
        self::$driver = null;
        self::$prefix = null;
        self::$dir = null;
        self::$held = [];
        self::$lockFh = [];
        self::$named = [];
        self::$test = [];
        self::$bustSeen = false;
        self::$stat = ['get' => 0, 'hit' => 0, 'set' => 0, 'del' => 0, 'torn' => 0, 'fail' => 0];
    }

    private static function now(): int
    {
        return isset(self::$test['now']) ? (int) call_user_func(self::$test['now']) : Clock::ms();
    }

    private static function cli(): bool
    {
        return PHP_SAPI === 'cli' && !isset($_SERVER['REQUEST_METHOD']) && empty(self::$test['web']);
    }

    private static function apcuUsable(bool $explicit): bool
    {
        if (!function_exists('apcu_enabled') || !function_exists('apcu_fetch')) return false;
        try { if (!apcu_enabled()) return false; } catch (\Throwable $e) { return false; }
        // one cache per process is no shared cache: plain CGI, and FastCGI servers that start PHP processes one by one
        if (!$explicit && in_array(PHP_SAPI, ['cgi', 'cgi-fcgi', 'cli', 'phpdbg'], true)) return false;
        return true;
    }

    /** 'apcu' | 'file' | 'db' | 'off' */
    public static function driver(): string
    {
        if (self::$driver !== null) return self::$driver;
        try {
            $want = strtolower(trim((string) (isset(self::$test['driver']) ? self::$test['driver'] : Config::get('cache.driver', 'auto'))));
            if ($want === 'off' || $want === 'none' || $want === '0' || $want === 'false') return self::$driver = 'off';
            if ($want === 'apcu' && self::apcuUsable(true)) return self::$driver = 'apcu';
            if ($want === 'auto' && self::apcuUsable(false)) return self::$driver = 'apcu';
            if ($want === 'db') return self::$driver = 'db';
            $dir = isset(self::$test['dir']) ? (string) self::$test['dir'] : Config::dataDir() . DIRECTORY_SEPARATOR . 'cache';
            if (!is_dir($dir)) Config::ensureDir($dir, true);
            self::$dir = rtrim($dir, '/\\');
            return self::$driver = 'file';
        } catch (\Throwable $e) {
            return self::$driver = 'off';
        }
    }

    /** can anything be cached at all? */
    public static function available(): bool { return self::driver() !== 'off'; }

    private static function prefix(): string
    {
        if (self::$prefix !== null) return self::$prefix;
        if (isset(self::$test['prefix'])) return self::$prefix = (string) self::$test['prefix'];
        return self::$prefix = substr(hash_hmac('sha256', 'tfm-cache-v1', Config::secret('app_key')), 0, 12);
    }

    /** the stored name of a key (prefix + key; long keys are hashed so the db column and APCu stay small) */
    private static function k(string $key): string
    {
        $k = self::prefix() . ':' . $key;
        return strlen($k) <= 180 ? $k : self::prefix() . ':#' . sha1($key);
    }

    private static function fail(): void { self::$stat['fail']++; }

    // ------------------------------------------------------------------ the public calls
    public static function get(string $key, $default = null)
    {
        self::$stat['get']++;
        try {
            switch (self::driver()) {
                case 'apcu':
                    self::bustCheck();
                    $v = apcu_fetch(self::k($key), $ok);
                    if (!$ok) return $default;
                    break;
                case 'file':
                    $r = self::fRead(self::fPath(sha1(self::k($key))));
                    if ($r === null) return $default;
                    $v = $r[0];
                    break;
                case 'db':
                    $row = Db::one('SELECT v, expires_at FROM cache_kv WHERE k = ?', [self::k($key)]);
                    if (!$row || ((int) $row['expires_at'] !== 0 && (int) $row['expires_at'] <= self::now())) return $default;
                    $v = json_decode((string) $row['v'], true, 64);
                    if ($v === null) return $default;
                    break;
                default:
                    return $default;
            }
            self::$stat['hit']++;
            return $v;
        } catch (\Throwable $e) {
            self::fail();
            return $default;
        }
    }

    public static function set(string $key, $value, int $ttl = 0): bool
    {
        if ($value === null) return self::del($key);
        self::$stat['set']++;
        try {
            switch (self::driver()) {
                case 'apcu':
                    self::bustCheck();
                    return (bool) apcu_store(self::k($key), $value, max(0, $ttl));
                case 'file':
                    $h = sha1(self::k($key));
                    if (!self::fLock($h)) { self::fail(); return false; }
                    try { $ok = self::fWrite($h, $value, self::expiry($ttl), false); } finally { self::fUnlock($h); }
                    if ($ok) self::bustMaybe($key);
                    return $ok;
                case 'db':
                    $json = json_encode($value, self::JSON_FLAGS);
                    if (!is_string($json)) return false;
                    Db::upsert('cache_kv', ['k' => self::k($key), 'v' => $json, 'expires_at' => self::expiry($ttl)], ['k']);
                    return true;
            }
        } catch (\Throwable $e) {
            self::fail();
        }
        return false;
    }

    /** store only when absent (or expired): exactly one of several callers gets true */
    public static function add(string $key, $value, int $ttl = 0): bool
    {
        if ($value === null) return false;
        self::$stat['set']++;
        try {
            switch (self::driver()) {
                case 'apcu':
                    self::bustCheck();
                    return (bool) apcu_add(self::k($key), $value, max(0, $ttl));
                case 'file':
                    $h = sha1(self::k($key));
                    if (!self::fLock($h)) { self::fail(); return false; }
                    try {
                        if (self::fRead(self::fPath($h), true) !== null) return false;
                        return self::fWrite($h, $value, self::expiry($ttl), false);
                    } finally { self::fUnlock($h); }
                case 'db':
                    $json = json_encode($value, self::JSON_FLAGS);
                    if (!is_string($json)) return false;
                    $k = self::k($key);
                    Db::exec('DELETE FROM cache_kv WHERE k = ? AND expires_at > 0 AND expires_at <= ?', [$k, self::now()]);
                    $n = Db::exec(Db::driver() === 'mysql'
                        ? 'INSERT IGNORE INTO cache_kv (k, v, expires_at) VALUES (?, ?, ?)'
                        : 'INSERT OR IGNORE INTO cache_kv (k, v, expires_at) VALUES (?, ?, ?)', [$k, $json, self::expiry($ttl)]);
                    return $n === 1;
            }
        } catch (\Throwable $e) {
            self::fail();
        }
        return false;
    }

    /** @return int|false the counter after adding $by; the first hit (or the first after the expiry) starts the $ttl */
    public static function inc(string $key, int $by = 1, int $ttl = 0)
    {
        self::$stat['set']++;
        try {
            switch (self::driver()) {
                case 'apcu':
                    self::bustCheck();
                    $k = self::k($key);
                    $v = apcu_inc($k, $by, $ok);
                    if ($ok) return (int) $v;
                    if (apcu_add($k, $by, max(0, $ttl))) return $by;
                    $v = apcu_inc($k, $by, $ok);          // another process created it between the two calls
                    if ($ok) return (int) $v;
                    apcu_store($k, $by, max(0, $ttl));    // the stored value was not a number
                    return $by;
                case 'file':
                    $h = sha1(self::k($key));
                    if (!self::fLock($h)) { self::fail(); return false; }
                    try {
                        $r = self::fRead(self::fPath($h), true);
                        $new = ($r !== null && is_int($r[0]) ? $r[0] : 0) + $by;
                        $exp = $r !== null && is_int($r[0]) ? $r[1] : self::expiry($ttl);
                        return self::fWrite($h, $new, $exp, true) ? $new : false;
                    } finally { self::fUnlock($h); }
                case 'db':
                    return self::dbInc(self::k($key), $by, $ttl);
            }
        } catch (\Throwable $e) {
            self::fail();
        }
        return false;
    }

    public static function del(string $key): bool
    {
        self::$stat['del']++;
        try {
            switch (self::driver()) {
                case 'apcu':
                    apcu_delete(self::k($key));
                    return true;
                case 'file':
                    $h = sha1(self::k($key));
                    self::bustMaybe($key);
                    if (!self::fLock($h)) { self::fail(); return false; }
                    try { return self::fDelete(self::fPath($h)); } finally { self::fUnlock($h); }
                case 'db':
                    Db::exec('DELETE FROM cache_kv WHERE k = ?', [self::k($key)]);
                    return true;
            }
        } catch (\Throwable $e) {
            self::fail();
        }
        return false;
    }

    /** the cached value, or $make() stored for $ttl seconds (a null result is returned but not stored) */
    public static function remember(string $key, int $ttl, callable $make)
    {
        $v = self::get($key);
        if ($v !== null) return $v;
        $v = $make();
        if ($v !== null) self::set($key, $v, $ttl);
        return $v;
    }

    /**
     * Atomic read-modify-write. $fn gets the stored value (null when there is none) and returns the new one (null
     * deletes the entry); it must be quick and must not call the cache for the same key. Returns the new value, or
     * false when the store could not be used (nothing was changed; $fn may not have run).
     */
    public static function mutate(string $key, callable $fn, int $ttl = 0)
    {
        self::$stat['set']++;
        try {
            switch (self::driver()) {
                case 'apcu':
                    self::bustCheck();
                    $k = self::k($key);
                    if (!self::apcuSpin($k . "\x01m", 3, 1500)) { self::fail(); return false; }
                    try {
                        $old = apcu_fetch($k, $ok);
                        $new = $fn($ok ? $old : null);
                        if ($new === null) apcu_delete($k); else apcu_store($k, $new, max(0, $ttl));
                        return $new;
                    } finally { apcu_delete($k . "\x01m"); }
                case 'file':
                    $h = sha1(self::k($key));
                    if (!self::fLock($h)) { self::fail(); return false; }
                    try {
                        $r = self::fRead(self::fPath($h), true);
                        $new = $fn($r === null ? null : $r[0]);
                        if ($new === null) { self::fDelete(self::fPath($h)); return null; }
                        return self::fWrite($h, $new, self::expiry($ttl), true) ? $new : false;
                    } finally { self::fUnlock($h); }
                case 'db':
                    $k = self::k($key);
                    $exp = self::expiry($ttl);
                    $now = self::now();
                    return Db::txRetry(function () use ($k, $fn, $exp, $now) {
                        $row = Db::one('SELECT v, expires_at FROM cache_kv WHERE k = ?' . Db::forUpdate(), [$k]);
                        $old = $row && ((int) $row['expires_at'] === 0 || (int) $row['expires_at'] > $now) ? json_decode((string) $row['v'], true, 64) : null;
                        $new = $fn($old);
                        if ($new === null) { Db::exec('DELETE FROM cache_kv WHERE k = ?', [$k]); return null; }
                        $json = json_encode($new, self::JSON_FLAGS);
                        if (!is_string($json)) return false;
                        Db::upsert('cache_kv', ['k' => $k, 'v' => $json, 'expires_at' => $exp], ['k']);
                        return $new;
                    });
            }
        } catch (\Throwable $e) {
            self::fail();
        }
        return false;
    }

    /**
     * One hit in counting window number $window (callers pass intdiv(now, window length)). Returns
     * [hits in this window (this one included), hits in the window before], or false when the store is unavailable.
     * One entry per key is reused from window to window (no new file per window); it lives $ttl seconds after the
     * last hit — callers pass two window lengths.
     */
    public static function hitWindow(string $key, int $window, int $ttl)
    {
        if (self::driver() === 'apcu') {
            // two lock-free counters (APCu expires them by itself)
            $cur = self::inc($key . '|' . $window, 1, $ttl);
            if ($cur === false) return false;
            return [(int) $cur, (int) self::get($key . '|' . ($window - 1), 0)];
        }
        $r = self::mutate($key, static function ($old) use ($window) {
            $w = is_array($old) && isset($old[0], $old[1], $old[2]) ? (int) $old[0] : null;
            if ($w === $window) return [$window, (int) $old[1] + 1, (int) $old[2]];
            if ($w === $window - 1) return [$window, 1, (int) $old[1]];
            return [$window, 1, 0];
        }, $ttl);
        return is_array($r) ? [(int) $r[1], (int) $r[2]] : false;
    }

    /** [hits in window $window so far, hits in the one before] without counting a hit (what hitWindow() stored) */
    public static function peekWindow(string $key, int $window): array
    {
        if (self::driver() === 'apcu') return [(int) self::get($key . '|' . $window, 0), (int) self::get($key . '|' . ($window - 1), 0)];
        $v = self::get($key);
        if (!is_array($v) || !isset($v[0], $v[1], $v[2])) return [0, 0];
        if ((int) $v[0] === $window) return [(int) $v[1], (int) $v[2]];
        if ((int) $v[0] === $window - 1) return [0, (int) $v[1]];
        return [0, 0];
    }

    /**
     * A named mutex. true = this request holds it now (calling it again for a held name is true as well).
     * $waitMs = how long to keep trying (0: one try). The file driver's lock ends at unlock() or with the process;
     * the others also end after $ttl seconds, so a crashed holder never blocks for longer than that.
     */
    public static function lock(string $name, int $ttl = 10, int $waitMs = 0): bool
    {
        if (isset(self::$named[$name])) return true;
        try {
            $deadline = microtime(true) + max(0, $waitMs) / 1000;
            switch (self::driver()) {
                case 'file':
                    $dir = self::$dir . DIRECTORY_SEPARATOR . '_l';
                    $file = $dir . DIRECTORY_SEPARATOR . 'n-' . sha1(self::k($name)) . '.lock';
                    $fh = @fopen($file, 'cb');
                    if (!$fh) { self::fMkdir($dir); $fh = @fopen($file, 'cb'); }
                    if (!$fh) { self::fail(); return false; }
                    while (!@flock($fh, LOCK_EX | LOCK_NB)) {
                        if (microtime(true) >= $deadline) { @fclose($fh); return false; }
                        usleep(2000);
                    }
                    self::$named[$name] = $fh;
                    return true;
                case 'apcu':
                case 'db':
                    while (!self::add('lock:' . $name, 1, max(1, $ttl))) {
                        if (microtime(true) >= $deadline) return false;
                        usleep(2000);
                    }
                    self::$named[$name] = true;
                    return true;
            }
        } catch (\Throwable $e) {
            self::fail();
        }
        return false;
    }

    public static function unlock(string $name): void
    {
        if (!isset(self::$named[$name])) return;
        $h = self::$named[$name];
        unset(self::$named[$name]);
        try {
            if (is_resource($h)) { @flock($h, LOCK_UN); @fclose($h); }
            else self::del('lock:' . $name);
        } catch (\Throwable $e) { /* released with the process */ }
    }

    /**
     * Remove expired entries. $maxSeconds > 0 stops the scan after that long (the lazy hourly run of a web request).
     * Returns ['removed' => n, 'kept' => n, 'driver' => name].
     */
    public static function purge(float $maxSeconds = 0): array
    {
        $out = ['removed' => 0, 'kept' => 0, 'driver' => self::driver()];
        try {
            if ($out['driver'] === 'db') {
                $out['removed'] = Db::exec('DELETE FROM cache_kv WHERE expires_at > 0 AND expires_at <= ?', [self::now()]);
            } elseif ($out['driver'] === 'file') {
                $t0 = microtime(true);
                $now = self::now();
                $glen = strlen(self::GUARD);
                foreach (@scandir(self::$dir) ?: [] as $sub) {
                    if (!preg_match('/^[0-9a-f]{2}$/', $sub)) continue;
                    foreach (@scandir(self::$dir . DIRECTORY_SEPARATOR . $sub) ?: [] as $f) {
                        if ($maxSeconds > 0 && microtime(true) - $t0 > $maxSeconds) return $out;
                        $path = self::$dir . DIRECTORY_SEPARATOR . $sub . DIRECTORY_SEPARATOR . $f;
                        if (substr($f, -4) === '.tmp') {            // the leftover of a writer that died
                            if ((int) @filemtime($path) < time() - 600 && @unlink($path)) $out['removed']++;
                            continue;
                        }
                        if (!preg_match('/^[0-9a-f]{40}\.php$/', $f)) continue;
                        $head = @file_get_contents($path, false, null, $glen, 64);
                        $h = is_string($head) ? explode(' ', (string) strtok($head, "\n")) : [];
                        $exp = count($h) === 4 && $h[0] === self::MAGIC ? (int) $h[1] : -1;
                        if ($exp === 0 || $exp > $now) { $out['kept']++; continue; }
                        // look again under the stripe lock: the entry may have been renewed a moment ago
                        $hash = substr($f, 0, 40);
                        if (!self::fLock($hash)) continue;
                        try {
                            if (self::fRead($path, true) === null && self::fDelete($path)) $out['removed']++; else $out['kept']++;
                        } finally { self::fUnlock($hash); }
                    }
                }
            }
        } catch (\Throwable $e) {
            self::fail();
        }
        return $out;
    }

    /** what this request did: get / hit / set / del / torn (re-reads of half-written files) / fail */
    public static function stats(): array { return self::$stat; }

    /** driver, where it keeps things and how much (the entry count walks the folder: for the CLI, not for requests) */
    public static function info(bool $count = false): array
    {
        $d = self::driver();
        $out = ['driver' => $d, 'configured' => (string) Config::get('cache.driver', 'auto'), 'apcuLoaded' => function_exists('apcu_enabled')];
        try {
            if ($d === 'file') {
                $out['dir'] = self::$dir;
                $out['writable'] = is_writable(self::$dir);
                if ($count) {
                    $n = 0;
                    $bytes = 0;
                    foreach (@scandir(self::$dir) ?: [] as $sub) {
                        if (!preg_match('/^[0-9a-f]{2}$/', $sub)) continue;
                        foreach (@scandir(self::$dir . DIRECTORY_SEPARATOR . $sub) ?: [] as $f) {
                            if (substr($f, -4) !== '.php') continue;
                            $n++;
                            $bytes += (int) @filesize(self::$dir . DIRECTORY_SEPARATOR . $sub . DIRECTORY_SEPARATOR . $f);
                        }
                    }
                    $out['entries'] = $n;
                    $out['bytes'] = $bytes;
                }
            } elseif ($d === 'apcu') {
                $m = @apcu_sma_info(true);
                $c = @apcu_cache_info(true);
                $out['memory'] = is_array($m) ? (int) $m['seg_size'] * (int) $m['num_seg'] : 0;
                $out['free'] = is_array($m) ? (int) $m['avail_mem'] : 0;
                $out['entries'] = is_array($c) && isset($c['num_entries']) ? (int) $c['num_entries'] : 0;
            } elseif ($d === 'db' && $count) {
                $out['entries'] = (int) Db::value('SELECT COUNT(*) FROM cache_kv');
            }
        } catch (\Throwable $e) { /* information only */ }
        return $out;
    }

    private static function expiry(int $ttl): int { return $ttl > 0 ? self::now() + $ttl * 1000 : 0; }

    // ------------------------------------------------------------------ the bust file (command line ↔ APCu)
    private static function bustFile(): string
    {
        $dir = isset(self::$test['dir']) ? (string) self::$test['dir'] : Config::dataDir() . DIRECTORY_SEPARATOR . 'cache';
        if (!is_dir($dir)) Config::ensureDir($dir, true);
        return $dir . DIRECTORY_SEPARATOR . 'bust';
    }

    /** the command line changed a security entry: tell a web server that keeps its cache in memory */
    private static function bustMaybe(string $key): void
    {
        if (strncmp($key, 's:', 2) !== 0 || !self::cli()) return;
        try { self::bust(); } catch (\Throwable $e) { /* the entries still expire by themselves */ }
    }

    /** drop every security entry ("s:…") of a web server that caches in memory, at its next request */
    public static function bust(): void
    {
        $f = self::bustFile();
        @file_put_contents($f, (string) self::now(), LOCK_EX);
        @touch($f);
        clearstatcache(true, $f);
    }

    /** APCu only, once per request: a newer bust file → the "s:" entries go, s:revall remembers when */
    private static function bustCheck(): void
    {
        if (self::$bustSeen) return;
        self::$bustSeen = true;
        try {
            $m = (int) @filemtime(self::bustFile());
            if ($m <= 0) return;
            $seenKey = self::prefix() . ':bust-seen';
            $seen = apcu_fetch($seenKey, $ok);
            if ($ok && (int) $seen >= $m) return;
            apcu_store($seenKey, $m, 0);
            if (class_exists('APCUIterator')) {
                foreach (new \APCUIterator('/^' . preg_quote(self::prefix() . ':s:', '/') . '/', APC_ITER_KEY) as $e) apcu_delete($e['key']);
            }
            apcu_store(self::k('s:revall'), self::now(), 0);
        } catch (\Throwable $e) { /* the entries still expire by themselves */ }
    }

    private static function apcuSpin(string $lockKey, int $ttl, int $waitMs): bool
    {
        $deadline = microtime(true) + $waitMs / 1000;
        while (!apcu_add($lockKey, 1, $ttl)) {
            if (microtime(true) >= $deadline) return false;
            usleep(100);
        }
        return true;
    }

    // ------------------------------------------------------------------ db driver
    /** @return int|false */
    private static function dbInc(string $k, int $by, int $ttl)
    {
        $now = self::now();
        $exp = self::expiry($ttl);
        if (Db::driver() === 'mysql') {
            // every statement is atomic by itself; LAST_INSERT_ID(expr) hands the new value back on this connection
            Db::exec('DELETE FROM cache_kv WHERE k = ? AND expires_at > 0 AND expires_at <= ?', [$k, $now]);
            for ($i = 0; $i < 3; $i++) {
                if (Db::exec('UPDATE cache_kv SET v = LAST_INSERT_ID(CAST(v AS SIGNED) + ?) WHERE k = ?', [$by, $k]) > 0) return (int) Db::value('SELECT LAST_INSERT_ID()');
                if (Db::exec('INSERT IGNORE INTO cache_kv (k, v, expires_at) VALUES (?, ?, ?)', [$k, (string) $by, $exp]) === 1) return $by;
            }
            return false;
        }
        return Db::tx(function () use ($k, $by, $now, $exp) {
            Db::exec('DELETE FROM cache_kv WHERE k = ? AND expires_at > 0 AND expires_at <= ?', [$k, $now]);
            if (Db::exec('UPDATE cache_kv SET v = CAST(v AS INTEGER) + ? WHERE k = ?', [$by, $k]) === 0) {
                Db::exec('INSERT OR IGNORE INTO cache_kv (k, v, expires_at) VALUES (?, ?, ?)', [$k, (string) $by, $exp]);
                return $by;
            }
            return (int) Db::value('SELECT v FROM cache_kv WHERE k = ?', [$k]);
        });
    }

    // ------------------------------------------------------------------ file driver
    private static function fPath(string $hash): string
    {
        return self::$dir . DIRECTORY_SEPARATOR . substr($hash, 0, 2) . DIRECTORY_SEPARATOR . $hash . '.php';
    }

    private static function fMkdir(string $dir): void
    {
        if (!is_dir($dir)) @mkdir($dir, 0750, true);
        // made by the command line as another account (root): hand it to the owner of the data folder, or the web
        // server could not use this part of the cache
        if (self::cli() && DIRECTORY_SEPARATOR === '/' && function_exists('chown')) {
            $o = @fileowner(self::$dir);
            $g = @filegroup(self::$dir);
            if ($o !== false && $o !== @fileowner($dir)) { @chown($dir, $o); if ($g !== false) @chgrp($dir, $g); }
        }
    }

    /**
     * [value, expires ms] of a whole, unexpired record, else null. Lock-free: a record whose length or checksum does
     * not match is being rewritten right now (or is damaged) — look again shortly, then give up (a miss).
     * $locked: the caller holds the stripe lock, so nobody is writing — a mismatch is damage, no second look.
     */
    private static function fRead(string $file, bool $locked = false): ?array
    {
        $glen = strlen(self::GUARD);
        for ($try = 0; $try < 3; $try++) {
            $raw = isset(self::$test['read']) ? call_user_func(self::$test['read'], $file) : @file_get_contents($file);
            if ($raw === false) {
                clearstatcache(true, $file);
                if (!@file_exists($file)) return null;          // the usual miss: one failed open, one stat
                // it exists but could not be read (Windows: another process is replacing it): look again
            } elseif (strlen($raw) > $glen + 10 && strncmp($raw, self::GUARD, $glen) === 0) {
                $nl = strpos($raw, "\n", $glen);
                $h = $nl === false ? [] : explode(' ', substr($raw, $glen, $nl - $glen));
                if (count($h) === 4 && $h[0] === self::MAGIC && ctype_digit($h[1]) && ctype_digit($h[2])) {
                    $len = (int) $h[2];
                    $payload = (string) substr($raw, $nl + 1, $len);
                    if (strlen($payload) === $len && sprintf('%08x', crc32($payload)) === $h[3]) {
                        $exp = (int) $h[1];
                        if ($exp !== 0 && $exp <= self::now()) return null;
                        $v = json_decode($payload, true, 64);
                        return $v === null ? null : [$v, $exp];
                    }
                }
            }
            if ($locked) return null;
            self::$stat['torn']++;
            usleep(200 * ($try + 1));
        }
        return null;
    }

    /** the caller holds the stripe lock */
    private static function fWrite(string $hash, $value, int $expMs, bool $inPlace): bool
    {
        $payload = json_encode($value, self::JSON_FLAGS);
        if (!is_string($payload)) return false;
        $rec = self::GUARD . self::MAGIC . ' ' . $expMs . ' ' . strlen($payload) . ' ' . sprintf('%08x', crc32($payload)) . "\n" . $payload;
        $file = self::fPath($hash);
        if (!$inPlace && strlen($payload) > self::INPLACE_MAX && self::fReplace($file, $rec)) return true;
        return self::fInPlace($file, $rec);
    }

    /** overwrite from the first byte with one write call, then cut what is left of a longer old record */
    private static function fInPlace(string $file, string $rec): bool
    {
        $fh = @fopen($file, 'cb');
        if (!$fh) { self::fMkdir(dirname($file)); $fh = @fopen($file, 'cb'); }
        if (!$fh) return false;
        $len = strlen($rec);
        // PHP before 7.4 hands a write to the system in pieces of the stream's chunk size (8 KB): one piece = one write
        if ($len > 8192 && function_exists('stream_set_chunk_size')) @stream_set_chunk_size($fh, $len);
        $ok = @fwrite($fh, $rec) === $len;
        if ($ok) @ftruncate($fh, $len);
        @fclose($fh);
        return $ok;
    }

    /** temp file + rename over the old record (atomic); a refused rename (Windows: a reader has it open) is retried */
    private static function fReplace(string $file, string $rec): bool
    {
        $tmp = $file . '.' . getmypid() . '-' . mt_rand(0, 0xfffffff) . '.tmp';
        $n = @file_put_contents($tmp, $rec);
        if ($n === false) { self::fMkdir(dirname($file)); $n = @file_put_contents($tmp, $rec); }
        if ($n !== strlen($rec)) { @unlink($tmp); return false; }
        for ($i = 0; $i < 4; $i++) {
            $ok = isset(self::$test['rename']) ? (bool) call_user_func(self::$test['rename'], $tmp, $file, $i) : @rename($tmp, $file);
            if ($ok) return true;
            usleep(400 << $i);
        }
        @unlink($tmp);
        return false;
    }

    /** remove a record; where the file cannot be removed right now (Windows: open elsewhere) it is marked expired */
    private static function fDelete(string $file): bool
    {
        $ok = isset(self::$test['unlink']) ? (bool) call_user_func(self::$test['unlink'], $file) : @unlink($file);
        if ($ok) return true;
        clearstatcache(true, $file);
        if (!@file_exists($file)) return true;
        return self::fInPlace($file, self::GUARD . self::MAGIC . ' 1 4 ' . sprintf('%08x', crc32('null')) . "\nnull");
    }

    private static function fLock(string $hash): bool
    {
        $s = substr($hash, 0, 2);
        if (isset(self::$held[$s])) { self::$held[$s][1]++; return true; }
        if (isset(self::$lockFh[$s])) {
            $fh = self::$lockFh[$s];
        } else {
            $dir = self::$dir . DIRECTORY_SEPARATOR . '_l';
            $fh = @fopen($dir . DIRECTORY_SEPARATOR . $s . '.lock', 'cb');
            if (!$fh) { self::fMkdir($dir); $fh = @fopen($dir . DIRECTORY_SEPARATOR . $s . '.lock', 'cb'); }
            if (!$fh) return false;
            self::$lockFh[$s] = $fh;
        }
        // blocking: the critical sections are a few file calls long, and the system frees the lock of a dead process
        if (!@flock($fh, LOCK_EX)) return false;
        self::$held[$s] = [$fh, 1];
        return true;
    }

    private static function fUnlock(string $hash): void
    {
        $s = substr($hash, 0, 2);
        if (!isset(self::$held[$s])) return;
        if (--self::$held[$s][1] > 0) return;
        @flock(self::$held[$s][0], LOCK_UN);
        unset(self::$held[$s]);
    }
}
