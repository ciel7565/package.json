<?php
/**
 * Hardened PHP sessions + CSRF tokens.
 *   - custom cookie name, HttpOnly, SameSite=Lax, Secure on https, path limited to the installation
 *   - use_strict_mode (unknown ids are rejected), cookies only, no trans-sid
 *   - private save path (data/sessions), session_regenerate_id on login/logout/privilege change
 *   - idle timeout + absolute lifetime, User-Agent fingerprint, per-user epoch (sign out everywhere)
 *   - CSRF token per session, compared with hash_equals; rotated on login/logout
 */
declare(strict_types=1);

namespace Tfm;

if (!defined('TFM_BOOT')) { http_response_code(404); exit; }

final class Session
{
    private static bool $started = false;

    public static function started(): bool { return self::$started && session_status() === PHP_SESSION_ACTIVE; }

    /** session id of the active session ('' when none) */
    public static function id(): string { return self::$started ? (string) session_id() : ''; }

    /**
     * @param bool $create false = only resume an existing session (requests without our cookie never create
     *                     session files — prevents session-file flooding by cookie-less clients)
     */
    public static function start(bool $create = true): void
    {
        if (self::$started) return;
        if (PHP_SAPI === 'cli' && !isset($_SERVER['REQUEST_METHOD'])) return;
        $cfg = (array) Config::get('session', []);
        $cookie = $_COOKIE[(string) ($cfg['name'] ?? 'TFMSESSID')] ?? null;
        if (!$create && (!is_string($cookie) || $cookie === '')) return;
        $https = Http::isHttps();
        ini_set('session.use_strict_mode', '1');
        ini_set('session.use_cookies', '1');
        ini_set('session.use_only_cookies', '1');
        ini_set('session.use_trans_sid', '0');
        ini_set('session.cookie_httponly', '1');
        ini_set('session.cookie_samesite', 'Lax');
        ini_set('session.cookie_secure', $https ? '1' : '0');
        ini_set('session.lazy_write', '1');
        ini_set('session.cache_limiter', '');
        ini_set('session.gc_maxlifetime', (string) max(3600, (int) ($cfg['remember_idle'] ?? 604800), (int) ($cfg['idle_timeout'] ?? 7200)));
        ini_set('session.gc_probability', '1');
        ini_set('session.gc_divisor', '200');
        if (PHP_VERSION_ID < 80400) {
            ini_set('session.sid_length', '48');
            ini_set('session.sid_bits_per_character', '6');
        }
        $dir = Config::dataDir() . '/sessions';
        if (!is_dir($dir)) Config::ensureDir($dir, true);
        session_save_path($dir);
        session_name((string) ($cfg['name'] ?? 'TFMSESSID'));
        session_set_cookie_params([
            'lifetime' => 0,
            'path'     => Http::basePath(),
            'domain'   => '',
            'secure'   => $https,
            'httponly' => true,
            'samesite' => 'Lax',
        ]);
        if (!@session_start()) {
            // corrupt/locked session file: start over with a fresh id
            @session_regenerate_id(true);
            if (session_status() !== PHP_SESSION_ACTIVE && !@session_start()) throw new \RuntimeException('session start failed');
        }
        self::$started = true;
        self::checkLifetime($cfg);
        if (random_int(1, 150) === 1) self::gcAnonymous($dir, (int) ($cfg['idle_timeout'] ?? 7200));
    }

    /**
     * PHP's own GC keeps files for the longest lifetime ("로그인 유지" = days). Anonymous / plain sessions that went
     * idle are removed much sooner so cookie-less floods cannot pile up session files. Bounded work per call.
     */
    public static function gcAnonymous(string $dir, int $idle): int
    {
        $limit = time() - max(600, $idle);
        $n = 0;
        $seen = 0;
        $me = session_status() === PHP_SESSION_ACTIVE ? 'sess_' . session_id() : '';
        foreach (new \DirectoryIterator($dir) as $f) {
            if ($seen++ > 4000 || $n >= 1000) break;
            if (!$f->isFile() || !str_starts_with($f->getFilename(), 'sess_') || $f->getFilename() === $me) continue;
            if ($f->getMTime() >= $limit) continue;
            $head = @file_get_contents($f->getPathname(), false, null, 0, 4096);
            if ($head === false || str_contains($head, 's:8:"remember";b:1;')) continue;
            if (@unlink($f->getPathname())) $n++;
        }
        return $n;
    }

    private static function fingerprint(): string
    {
        return substr(hash('sha256', (string) ($_SERVER['HTTP_USER_AGENT'] ?? '')), 0, 32);
    }

    private static function checkLifetime(array $cfg): void
    {
        $now = time();
        $s = $_SESSION['_tfm'] ?? null;
        if (!is_array($s)) { self::fresh(); return; }
        $remember = !empty($s['remember']);
        $idle = $remember ? (int) ($cfg['remember_idle'] ?? 604800) : (int) ($cfg['idle_timeout'] ?? 7200);
        $abs = $remember ? (int) ($cfg['remember_days'] ?? 30) * 86400 : (int) ($cfg['absolute_lifetime'] ?? 86400);
        $reason = null;
        if ($now - (int) ($s['last'] ?? 0) > $idle) $reason = 'idle';
        elseif ($now - (int) ($s['created'] ?? 0) > $abs) $reason = 'expired';
        elseif (!empty($cfg['bind_user_agent']) && !hash_equals((string) ($s['fp'] ?? ''), self::fingerprint())) $reason = 'fingerprint';
        if ($reason) {
            if (!empty($s['uid'])) {
                Log::info('AUTH', "session ended ($reason)", ['uid' => (int) $s['uid']]);
                if ($reason === 'fingerprint') Audit::log('session_fingerprint_mismatch', (int) $s['uid'], [], 'warn');
            }
            $_SESSION = [];
            @session_regenerate_id(true);
            self::fresh();
            return;
        }
        // keep the session alive without rewriting the file on every poll
        if ($now - (int) ($s['last'] ?? 0) >= 20) $_SESSION['_tfm']['last'] = $now;
    }

    private static function fresh(): void
    {
        $now = time();
        $_SESSION['_tfm'] = [
            'created'  => $now,
            'last'     => $now,
            'fp'       => self::fingerprint(),
            'csrf'     => bin2hex(random_bytes(32)),
            'uid'      => 0,
            'epoch'    => 0,
            'remember' => false,
        ];
    }

    public static function csrf(): string
    {
        self::start();
        if (empty($_SESSION['_tfm']['csrf'])) $_SESSION['_tfm']['csrf'] = bin2hex(random_bytes(32));
        return (string) $_SESSION['_tfm']['csrf'];
    }

    /** token for the response envelope (still readable after close()) */
    public static function currentCsrf(): ?string
    {
        if (!self::$started) return null;
        $t = $_SESSION['_tfm']['csrf'] ?? null;
        return is_string($t) && $t !== '' ? $t : null;
    }

    public static function checkCsrf(?string $token): bool
    {
        if (!self::started() || !is_string($token) || $token === '' || strlen($token) > 128) return false;
        $expected = (string) ($_SESSION['_tfm']['csrf'] ?? '');
        return $expected !== '' && hash_equals($expected, $token);
    }

    public static function userId(): int { return self::started() ? (int) ($_SESSION['_tfm']['uid'] ?? 0) : 0; }
    public static function epoch(): int { return (int) ($_SESSION['_tfm']['epoch'] ?? 0); }
    public static function get(string $k, mixed $d = null): mixed { return $_SESSION['_tfm']['data'][$k] ?? $d; }
    public static function set(string $k, mixed $v): void { $_SESSION['_tfm']['data'][$k] = $v; }

    /** new session id + new CSRF token, bound to the user (prevents fixation) */
    public static function login(array $user, bool $remember): void
    {
        self::start();
        session_regenerate_id(true);
        $now = time();
        $_SESSION['_tfm'] = [
            'created'  => $now,
            'last'     => $now,
            'fp'       => self::fingerprint(),
            'csrf'     => bin2hex(random_bytes(32)),
            'uid'      => (int) $user['id'],
            'epoch'    => (int) ($user['session_epoch'] ?? 0),
            'remember' => $remember,
            'role'     => (string) ($user['role'] ?? 'user'),
        ];
        if ($remember) {
            $cfg = (array) Config::get('session', []);
            setcookie(session_name(), session_id(), [
                'expires'  => $now + (int) ($cfg['remember_days'] ?? 30) * 86400,
                'path'     => Http::basePath(),
                'domain'   => '',
                'secure'   => Http::isHttps(),
                'httponly' => true,
                'samesite' => 'Lax',
            ]);
        }
    }

    /** privilege change for the current user (role update): new id, keep login */
    public static function refresh(array $user): void
    {
        if (!self::started()) return;
        session_regenerate_id(true);
        $_SESSION['_tfm']['epoch'] = (int) ($user['session_epoch'] ?? 0);
        $_SESSION['_tfm']['role'] = (string) ($user['role'] ?? 'user');
        $_SESSION['_tfm']['csrf'] = bin2hex(random_bytes(32));
    }

    public static function logout(): void
    {
        self::start();
        $_SESSION = [];
        session_regenerate_id(true);
        self::fresh();
        // drop a persistent "remember" cookie: the next response carries a session cookie again
        setcookie(session_name(), session_id(), [
            'expires' => 0, 'path' => Http::basePath(), 'domain' => '', 'secure' => Http::isHttps(), 'httponly' => true, 'samesite' => 'Lax',
        ]);
    }

    /** release the session lock early for read-only endpoints (polling must not serialize requests) */
    public static function close(): void
    {
        if (session_status() === PHP_SESSION_ACTIVE) session_write_close();
    }
}
