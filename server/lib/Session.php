<?php
/**
 * Hardened PHP sessions + CSRF tokens.
 *   - custom cookie name, HttpOnly, SameSite=Lax (also on PHP 7.2: Cookie::session), Secure on https, path = installation
 *   - use_strict_mode (unknown ids are rejected), cookies only, no trans-sid
 *   - private save path (data/sessions), session_regenerate_id on login/logout/privilege change
 *   - idle timeout + absolute lifetime, User-Agent fingerprint, per-user epoch (sign out everywhere)
 *   - CSRF token per session, compared with hash_equals; rotated on login/logout
 *   - phase 8 (CONTRACT §16.9): read endpoints load the session without keeping its file locked (read_and_close) and
 *     write it only once a minute (the idle timeout needs a "last seen"); anything that changes the session reopens
 *     it for writing first; old session files are removed by the cleanup job, not by a random request
 * PHP 7.2 syntax only.
 */
declare(strict_types=1);

namespace Tfm;

if (!defined('TFM_BOOT')) { if (function_exists('header_remove')) header_remove('X-Powered-By'); http_response_code(404); exit; }

final class Session
{
    /** @var bool the session data of this request is loaded (the file may already be closed again) */
    private static $started = false;
    /** @var bool loaded with read_and_close: nothing is written unless a call reopens the session */
    private static $readOnly = false;
    /** @var bool the session was reopened without the cookie header: a new id has to be sent by hand */
    private static $manualCookie = false;

    /** is there a session for this request? (true also after close(): the data stays readable) */
    public static function started(): bool { return self::$started; }

    /** session id of the active session ('' when none) */
    public static function id(): string { return self::$started ? (string) session_id() : ''; }

    /** did the request carry our session cookie at all? (a write request without one has no session to protect) */
    public static function hasCookie(): bool
    {
        $name = (string) Config::get('session.name', 'TFMSESSID');
        return isset($_COOKIE[$name]) && is_string($_COOKIE[$name]) && $_COOKIE[$name] !== '';
    }

    /**
     * @param bool $create false = only resume an existing session (requests without our cookie never create
     *                     session files — prevents session-file flooding by cookie-less clients)
     * @param bool $readOnly resume mode only: load the data and let go of the file at once (PHP read_and_close), so
     *                     parallel polls of one browser do not queue behind each other's session lock. The file is
     *                     written only when the "last seen" time is a minute old, the session ran out, or the
     *                     endpoint changes something (every changing call reopens the session by itself).
     */
    public static function start(bool $create = true, bool $readOnly = false): void
    {
        if (self::$started) return;
        if (PHP_SAPI === 'cli' && !isset($_SERVER['REQUEST_METHOD'])) return;
        $cfg = (array) Config::get('session', []);
        $name = (string) (isset($cfg['name']) ? $cfg['name'] : 'TFMSESSID');
        $cookie = isset($_COOKIE[$name]) ? $_COOKIE[$name] : null;
        if (!$create && (!is_string($cookie) || $cookie === '')) return;
        $https = Http::isHttps();
        ini_set('session.use_strict_mode', '1');
        ini_set('session.use_cookies', '1');
        ini_set('session.use_only_cookies', '1');
        ini_set('session.use_trans_sid', '0');
        ini_set('session.cookie_httponly', '1');
        ini_set('session.cookie_secure', $https ? '1' : '0');
        ini_set('session.lazy_write', '1');
        ini_set('session.cache_limiter', '');
        ini_set('session.gc_maxlifetime', (string) max(3600, (int) (isset($cfg['remember_idle']) ? $cfg['remember_idle'] : 604800), (int) (isset($cfg['idle_timeout']) ? $cfg['idle_timeout'] : 7200)));
        // old files are removed by Session::gc() — `php cli/tfm.php cleanup`, and once an hour after a request
        // (Api::run) — never by a random request that then scans the whole folder while its visitor waits
        ini_set('session.gc_probability', '0');
        ini_set('session.gc_divisor', '200');
        if (PHP_VERSION_ID < 80400) {
            ini_set('session.sid_length', '48');
            ini_set('session.sid_bits_per_character', '6');
        }
        $dir = Config::dataDir() . DIRECTORY_SEPARATOR . 'sessions';
        if (!is_dir($dir)) Config::ensureDir($dir, true);
        session_save_path($dir);
        session_name($name);
        // CONTRACT §15.7 #9: in resume mode, adopt a cookie only when it names a session we actually issued. A bogus
        // or rotated id would otherwise make use_strict_mode mint a brand-new session on every request — a fresh
        // data/sessions file and a new per-session rate bucket each time — so a client sending a different TFMSESSID
        // per request could defeat the per-session limit and pile up session files. An id with no stored file is
        // treated as no session (guest): no file is written, no Set-Cookie is sent, and the per-address rate bucket
        // (the generous aggregate) is what bounds the flood. Sessions are still created where they must be (ping and
        // the pages that hand out a token pass $create = true).
        if (!$create && !self::issuedSessionExists($dir, (string) $cookie)) return;
        Cookie::session(Http::basePath(), $https);
        $ro = $readOnly && !$create && @session_start(['read_and_close' => true]);
        if (!$ro && !@session_start()) {
            // corrupt/locked session file: start over with a fresh id
            @session_regenerate_id(true);
            if (session_status() !== PHP_SESSION_ACTIVE && !@session_start()) throw new \RuntimeException('session start failed');
        }
        self::$started = true;
        self::$readOnly = $ro;
        self::checkLifetime($cfg);
        // a read-only start that had to write (the minute touch, a session that ran out): let go of the file again
        if ($ro && session_status() === PHP_SESSION_ACTIVE) self::close();
    }

    /**
     * The session is about to change: when its file was closed (a read-only start, or an early close()) open it again.
     * The browser already has this cookie, so it is not sent a second time — PHP would send it as a plain session
     * cookie and a "로그인 유지" cookie would lose its expiry date. A new id made after this (login, logout, a
     * privilege change) is sent by rotateId().
     */
    private static function writable(): void
    {
        if (!self::$started || session_status() === PHP_SESSION_ACTIVE) return;
        if (headers_sent()) throw new \RuntimeException('session cannot be reopened after the answer started');
        @ini_set('session.use_cookies', '0');
        self::$manualCookie = true;
        if (!@session_start()) throw new \RuntimeException('session reopen failed');
        self::$readOnly = false;
    }

    /** a new session id (the old file is deleted); the cookie is sent by PHP, or by hand after writable() */
    private static function rotateId(): void
    {
        self::writable();
        session_regenerate_id(true);
        if (self::$manualCookie) Cookie::set((string) session_name(), (string) session_id(), 0, Http::basePath(), Http::isHttps());
    }

    /** the folder of the session files (created private on first use) */
    public static function dir(): string
    {
        $dir = Config::dataDir() . DIRECTORY_SEPARATOR . 'sessions';
        if (!is_dir($dir)) Config::ensureDir($dir, true);
        return $dir;
    }

    /**
     * Housekeeping (the cleanup job; Api::run once an hour after its answer): PHP's own collection — files untouched
     * for longer than the longest lifetime — plus the sooner removal of idle anonymous sessions (gcAnonymous).
     * $seconds > 0 stops after that long. Returns the number of files removed.
     */
    public static function gc(float $seconds = 0): int
    {
        $cfg = (array) Config::get('session', []);
        $idle = (int) (isset($cfg['idle_timeout']) ? $cfg['idle_timeout'] : 7200);
        $max = max(3600, (int) (isset($cfg['remember_idle']) ? $cfg['remember_idle'] : 604800), $idle);
        $dir = self::dir();
        $t0 = microtime(true);
        $limit = time() - $max;
        $me = self::$started ? 'sess_' . session_id() : '';
        $n = 0;
        try {
            foreach (new \DirectoryIterator($dir) as $f) {
                if ($seconds > 0 && microtime(true) - $t0 > $seconds) return $n;
                if (!$f->isFile() || !Str::startsWith($f->getFilename(), 'sess_') || $f->getFilename() === $me) continue;
                if ($f->getMTime() < $limit && @unlink($f->getPathname())) $n++;
            }
        } catch (\Throwable $e) { /* the folder went away */ }
        return $n + self::gcAnonymous($dir, $idle, $seconds > 0 ? max(0.05, $seconds - (microtime(true) - $t0)) : 0.0);
    }

    /**
     * Does a stored session file exist for this id? Resume-mode guard against bogus / rotated session cookies: a
     * well-formed id (the files handler names its file sess_<id>; with sid_bits_per_character = 6 an id is made of
     * [0-9a-zA-Z,-]) with no file under the save path was never issued by us, so it must not start a session.
     */
    private static function issuedSessionExists(string $dir, string $id): bool
    {
        if ($id === '' || preg_match('/^[A-Za-z0-9,\\-]{20,64}$/', $id) !== 1) return false;
        return is_file($dir . DIRECTORY_SEPARATOR . 'sess_' . $id);
    }

    /**
     * PHP's own GC keeps files for the longest lifetime ("로그인 유지" = days). Anonymous / plain sessions that went
     * idle are removed much sooner so cookie-less floods cannot pile up session files. Bounded work per call.
     */
    public static function gcAnonymous(string $dir, int $idle, float $seconds = 0): int
    {
        $limit = time() - max(600, $idle);
        $n = 0;
        $seen = 0;
        $t0 = microtime(true);
        // the command line may take its time (ten thousand visitors leave ten thousand files); a web request is bounded
        $cli = PHP_SAPI === 'cli' && !isset($_SERVER['REQUEST_METHOD']);
        $maxSeen = $cli ? 2000000 : 20000;
        $maxDel = $cli ? 2000000 : 5000;
        $me = self::$started ? 'sess_' . session_id() : '';
        foreach (new \DirectoryIterator($dir) as $f) {
            if ($seen++ > $maxSeen || $n >= $maxDel) break;
            if ($seconds > 0 && microtime(true) - $t0 > $seconds) break;
            if (!$f->isFile() || !Str::startsWith($f->getFilename(), 'sess_') || $f->getFilename() === $me) continue;
            if ($f->getMTime() >= $limit) continue;
            $head = @file_get_contents($f->getPathname(), false, null, 0, 4096);
            if ($head === false || Str::contains($head, 's:8:"remember";b:1;')) continue;
            if (@unlink($f->getPathname())) $n++;
        }
        return $n;
    }

    private static function fingerprint(): string
    {
        return substr(hash('sha256', (string) (isset($_SERVER['HTTP_USER_AGENT']) ? $_SERVER['HTTP_USER_AGENT'] : '')), 0, 32);
    }

    private static function checkLifetime(array $cfg): void
    {
        $now = time();
        $s = isset($_SESSION['_tfm']) ? $_SESSION['_tfm'] : null;
        if (!is_array($s)) {
            if (session_status() !== PHP_SESSION_ACTIVE) { self::writable(); self::checkLifetime($cfg); return; }
            self::fresh();
            return;
        }
        $remember = !empty($s['remember']);
        $idle = $remember ? (int) (isset($cfg['remember_idle']) ? $cfg['remember_idle'] : 604800) : (int) (isset($cfg['idle_timeout']) ? $cfg['idle_timeout'] : 7200);
        $abs = $remember ? (int) (isset($cfg['remember_days']) ? $cfg['remember_days'] : 30) * 86400 : (int) (isset($cfg['absolute_lifetime']) ? $cfg['absolute_lifetime'] : 86400);
        $reason = null;
        if ($now - (int) (isset($s['last']) ? $s['last'] : 0) > $idle) $reason = 'idle';
        elseif ($now - (int) (isset($s['created']) ? $s['created'] : 0) > $abs) $reason = 'expired';
        elseif (!empty($cfg['bind_user_agent']) && !hash_equals((string) (isset($s['fp']) ? $s['fp'] : ''), self::fingerprint())) $reason = 'fingerprint';
        // read-only start: how old "last seen" may get before it is written (a minute; less for a short idle timeout)
        $touch = self::$readOnly ? min(60, max(1, intdiv(max(1, $idle), 4))) : 20;
        if (($reason || $now - (int) (isset($s['last']) ? $s['last'] : 0) >= $touch) && session_status() !== PHP_SESSION_ACTIVE) {
            // the file was only read: open it for writing and judge again on what is stored now
            self::writable();
            self::checkLifetime($cfg);
            return;
        }
        if ($reason) {
            if (!empty($s['uid'])) {
                Log::info('AUTH', "session ended ($reason)", ['uid' => (int) $s['uid']]);
                if ($reason === 'fingerprint') Audit::log('session_fingerprint_mismatch', (int) $s['uid'], [], 'warn');
            }
            $_SESSION = [];
            try { self::rotateId(); } catch (\Throwable $e) { @session_regenerate_id(true); }
            self::fresh();
            return;
        }
        // keep the session alive without rewriting the file on every poll
        if ($now - (int) (isset($s['last']) ? $s['last'] : 0) >= $touch) $_SESSION['_tfm']['last'] = $now;
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
        if (empty($_SESSION['_tfm']['csrf'])) {
            self::writable();
            if (empty($_SESSION['_tfm']['csrf'])) $_SESSION['_tfm']['csrf'] = bin2hex(random_bytes(32));
        }
        return (string) $_SESSION['_tfm']['csrf'];
    }

    /** token for the response envelope (still readable after close()) */
    public static function currentCsrf(): ?string
    {
        if (!self::$started) return null;
        $t = isset($_SESSION['_tfm']['csrf']) ? $_SESSION['_tfm']['csrf'] : null;
        return is_string($t) && $t !== '' ? $t : null;
    }

    public static function checkCsrf(?string $token): bool
    {
        if (!self::started() || !is_string($token) || $token === '' || strlen($token) > 128) return false;
        $expected = (string) (isset($_SESSION['_tfm']['csrf']) ? $_SESSION['_tfm']['csrf'] : '');
        return $expected !== '' && hash_equals($expected, $token);
    }

    public static function userId(): int { return self::started() ? (int) (isset($_SESSION['_tfm']['uid']) ? $_SESSION['_tfm']['uid'] : 0) : 0; }
    public static function epoch(): int { return (int) (isset($_SESSION['_tfm']['epoch']) ? $_SESSION['_tfm']['epoch'] : 0); }

    /**
     * Is this login for this very account row? An id alone is not: after a database restore (README §9) the id counter
     * goes back and the next new account gets the id of one that disappeared, while remembered sessions survive in
     * data/sessions. A login keeps the row's creation time ('born', it never changes); a session from before that key
     * existed only accepts an account that is older than the login itself.
     */
    public static function ownsAccount(array $user): bool
    {
        $born = (int) (isset($user['created_at']) ? $user['created_at'] : 0);
        $s = isset($_SESSION['_tfm']) && is_array($_SESSION['_tfm']) ? $_SESSION['_tfm'] : [];
        if (isset($s['born'])) return (int) $s['born'] === $born;
        return $born <= ((int) (isset($s['created']) ? $s['created'] : 0) + 1) * 1000;
    }

    public static function get(string $k, $d = null) { return isset($_SESSION['_tfm']['data'][$k]) ? $_SESSION['_tfm']['data'][$k] : $d; }
    public static function set(string $k, $v): void { self::writable(); $_SESSION['_tfm']['data'][$k] = $v; }

    /** new session id + new CSRF token, bound to the user (prevents fixation) */
    public static function login(array $user, bool $remember): void
    {
        self::start();
        self::rotateId();
        $now = time();
        $_SESSION['_tfm'] = [
            'created'  => $now,
            'last'     => $now,
            'fp'       => self::fingerprint(),
            'csrf'     => bin2hex(random_bytes(32)),
            'uid'      => (int) $user['id'],
            'born'     => (int) (isset($user['created_at']) ? $user['created_at'] : 0), // which account row this id meant (ownsAccount)
            'epoch'    => (int) (isset($user['session_epoch']) ? $user['session_epoch'] : 0),
            'remember' => $remember,
            'role'     => (string) (isset($user['role']) ? $user['role'] : 'user'),
        ];
        if ($remember) {
            $cfg = (array) Config::get('session', []);
            Cookie::set(session_name(), session_id(), $now + (int) (isset($cfg['remember_days']) ? $cfg['remember_days'] : 30) * 86400, Http::basePath(), Http::isHttps());
        }
    }

    /**
     * New session id + fresh CSRF token, keeping the current logged-in state. Used on admin elevation / a privilege
     * step-up where the account itself does not change (CONTRACT §15.4, admin agent) — a plain anti-fixation rotation.
     */
    public static function regenerate(): void
    {
        if (!self::started()) self::start();
        if (!self::started()) return;
        self::rotateId();
        if (isset($_SESSION['_tfm']) && is_array($_SESSION['_tfm'])) $_SESSION['_tfm']['csrf'] = bin2hex(random_bytes(32));
    }

    /** privilege change for the current user (role update): new id, keep login */
    public static function refresh(array $user): void
    {
        if (!self::started()) return;
        self::rotateId();
        $_SESSION['_tfm']['epoch'] = (int) (isset($user['session_epoch']) ? $user['session_epoch'] : 0);
        $_SESSION['_tfm']['role'] = (string) (isset($user['role']) ? $user['role'] : 'user');
        $_SESSION['_tfm']['csrf'] = bin2hex(random_bytes(32));
    }

    public static function logout(): void
    {
        self::start();
        self::writable();
        $_SESSION = [];
        self::rotateId();
        self::fresh();
        // drop a persistent "remember" cookie: the next response carries a session cookie again
        Cookie::set(session_name(), session_id(), 0, Http::basePath(), Http::isHttps());
    }

    /** release the session lock early for read-only endpoints (polling must not serialize requests) */
    public static function close(): void
    {
        if (session_status() === PHP_SESSION_ACTIVE) session_write_close();
    }
}
