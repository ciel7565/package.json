<?php
/**
 * Core helpers: Config, Clock, Log, ApiException, Json, Cookie, Http (request facts + security headers).
 * Every file in lib/ refuses to run unless included through lib/bootstrap.php.
 * PHP 7.2 syntax only (CONTRACT §14.5).
 */
declare(strict_types=1);

namespace Tfm;

if (!defined('TFM_BOOT')) { http_response_code(404); exit; }

/** An error that becomes a JSON error response {success:false, error:{code,message}, data?}. */
final class ApiException extends \RuntimeException
{
    /** @var int */
    public $status;
    /** @var string */
    public $errorCode;
    /** @var mixed */
    public $data;
    /** @var string[] */
    public $headers;

    public function __construct(int $status, string $errorCode, string $message, $data = null, array $headers = [])
    {
        parent::__construct($message, $status);
        $this->status = $status;
        $this->errorCode = $errorCode;
        $this->data = $data;
        $this->headers = $headers;
    }
}

final class Clock
{
    /** server time in milliseconds (the client syncs G.time to this) */
    public static function ms(): int { return (int) floor(microtime(true) * 1000); }
    /** calendar day in the configured time zone, e.g. 2026-10-10 */
    public static function day(?int $ms = null): string { return date('Y-m-d', intdiv($ms === null ? self::ms() : $ms, 1000)); }
    public static function startOfDayMs(): int { return (int) strtotime('today') * 1000; }
}

/**
 * json_encode / json_decode with json_last_error() checks (JSON_THROW_ON_ERROR / JsonException are PHP 7.3+).
 * decode() / encode() throw \UnexpectedValueException on failure; tryDecode() returns null instead.
 */
final class Json
{
    public static function decode(string $json, bool $assoc = true, int $depth = 512, int $flags = 0)
    {
        $v = json_decode($json, $assoc, max(1, $depth), $flags);
        if (json_last_error() !== JSON_ERROR_NONE) throw new \UnexpectedValueException('invalid JSON: ' . json_last_error_msg());
        return $v;
    }

    /** null when the text is not valid JSON (a valid "null" also yields null) */
    public static function tryDecode(string $json, bool $assoc = true, int $depth = 512, int $flags = 0)
    {
        $v = json_decode($json, $assoc, max(1, $depth), $flags);
        return json_last_error() === JSON_ERROR_NONE ? $v : null;
    }

    public static function encode($value, int $flags = 0, int $depth = 512): string
    {
        $s = json_encode($value, $flags, max(1, $depth));
        if ($s === false || json_last_error() !== JSON_ERROR_NONE) {
            // with JSON_PARTIAL_OUTPUT_ON_ERROR json_encode still returns a (partial) string: keep it
            if (is_string($s) && ($flags & JSON_PARTIAL_OUTPUT_ON_ERROR)) return $s;
            throw new \UnexpectedValueException('json encode failed: ' . json_last_error_msg());
        }
        return $s;
    }
}

/**
 * Cookies with SameSite on every PHP version. setcookie() / session_set_cookie_params() learnt the options array
 * (and SameSite) only in PHP 7.3: on 7.2 the session cookie gets its attribute through the path parameter (the
 * session module copies it verbatim into Set-Cookie) and other cookies are written as a raw Set-Cookie header.
 */
final class Cookie
{
    /** parameters for the session cookie — call before session_start() */
    public static function session(string $path, bool $secure): void
    {
        if (PHP_VERSION_ID >= 70300) {
            session_set_cookie_params(['lifetime' => 0, 'path' => $path, 'domain' => '', 'secure' => $secure, 'httponly' => true, 'samesite' => 'Lax']);
            return;
        }
        session_set_cookie_params(0, $path . '; SameSite=Lax', '', $secure, true);
    }

    /**
     * Set-Cookie header by hand. $expires: unix seconds (> 0 persistent, 0 = session cookie, < 0 = delete).
     * The value is sent raw when it is cookie-safe (session ids are), percent-encoded otherwise (PHP decodes $_COOKIE).
     */
    public static function set(string $name, string $value, int $expires, string $path, bool $secure, bool $httpOnly = true, string $sameSite = 'Lax'): void
    {
        if (headers_sent()) return;
        if (!preg_match('/^[A-Za-z0-9!#$%&\'*+.^_`|~-]+$/', $name)) throw new \InvalidArgumentException('cookie name');
        $v = preg_match('/^[A-Za-z0-9,_.-]*$/', $value) ? $value : rawurlencode($value);
        $h = $name . '=' . $v;
        if ($expires > 0) $h .= '; expires=' . gmdate('D, d-M-Y H:i:s', $expires) . ' GMT; Max-Age=' . max(0, $expires - time());
        elseif ($expires < 0) $h .= '; expires=Thu, 01-Jan-1970 00:00:01 GMT; Max-Age=0';
        if ($path !== '') $h .= '; path=' . str_replace([';', ',', ' ', "\r", "\n"], '', $path);
        if ($secure) $h .= '; secure';
        if ($httpOnly) $h .= '; HttpOnly';
        if ($sameSite !== '') $h .= '; SameSite=' . $sameSite;
        header('Set-Cookie: ' . $h, false);
    }
}

final class Config
{
    /** @var array|null config.php + config.local.php as written */
    private static $cfg = null;
    /** @var array|null the configuration this request works with (files + overrides) */
    private static $eff = null;
    /** @var array runtime overrides by dotted path (unit tests, CLI tools) */
    private static $over = [];
    /** @var array|null */
    private static $secret = null;

    private static function files(): array
    {
        if (self::$cfg === null) {
            $base = require TFM_ROOT . '/config/config.php';
            $local = TFM_ROOT . '/config/config.local.php';
            if (is_file($local)) {
                $over = require $local;
                if (is_array($over)) $base = self::merge($base, $over);
            }
            self::$cfg = is_array($base) ? $base : [];
        }
        return self::$cfg;
    }

    public static function all(): array
    {
        if (self::$eff === null) {
            $c = self::files();
            foreach (self::$over as $path => $value) $c = self::put($c, explode('.', (string) $path), $value);
            self::$eff = $c;
        }
        return self::$eff;
    }

    /** forget the cached configuration (the installer wrote config.local.php) */
    public static function reset(): void { self::$cfg = null; self::$eff = null; }

    /** forget what was derived for the current request only (the files stay cached) */
    public static function resetRequest(): void { self::$eff = null; }

    /**
     * Replace one value for the rest of this process (unit tests, CLI tools); null removes the override again.
     * Never fed from request data.
     */
    public static function override(string $path, $value): void
    {
        if ($value === null) unset(self::$over[$path]);
        else self::$over[$path] = $value;
        self::$eff = null;
    }

    private static function put(array $a, array $keys, $value): array
    {
        $k = array_shift($keys);
        if (!$keys) { $a[$k] = $value; return $a; }
        $a[$k] = self::put(isset($a[$k]) && is_array($a[$k]) ? $a[$k] : [], $keys, $value);
        return $a;
    }

    private static function dig(array $v, string $path, $default)
    {
        foreach (explode('.', $path) as $k) {
            if (!is_array($v) || !array_key_exists($k, $v)) return $default;
            $v = $v[$k];
        }
        return $v;
    }

    /** dotted lookup: Config::get('chat.max_length', 120) */
    public static function get(string $path, $default = null)
    {
        return self::dig(self::all(), $path, $default);
    }

    /** recursive merge: associative arrays merge, lists and scalars are replaced */
    private static function merge(array $a, array $b): array
    {
        foreach ($b as $k => $v) {
            if (is_array($v) && isset($a[$k]) && is_array($a[$k]) && !Arr::isList($v) && !Arr::isList($a[$k])) $a[$k] = self::merge($a[$k], $v);
            else $a[$k] = $v;
        }
        return $a;
    }

    public static function dataDir(): string
    {
        static $dir = null;
        if ($dir !== null) return $dir;
        $d = (string) self::get('paths.data', '');
        $d = $d !== '' ? rtrim($d, '/\\') : TFM_ROOT . DIRECTORY_SEPARATOR . 'data';
        self::ensureDir($d, true);
        return $dir = $d;
    }

    public static function uploadDir(): string
    {
        static $dir = null;
        if ($dir !== null) return $dir;
        $d = (string) self::get('paths.uploads', '');
        $d = $d !== '' ? rtrim($d, '/\\') : TFM_ROOT . DIRECTORY_SEPARATOR . 'uploads';
        self::ensureDir($d, false);
        return $dir = $d;
    }

    /** create a directory (0750) and, for private dirs, drop deny rules in case it sits inside the web root */
    public static function ensureDir(string $dir, bool $private): void
    {
        if (!is_dir($dir) && !@mkdir($dir, 0750, true) && !is_dir($dir)) {
            throw new \RuntimeException('cannot create directory');
        }
        if ($private) {
            $ht = $dir . DIRECTORY_SEPARATOR . '.htaccess';
            if (!is_file($ht)) @file_put_contents($ht, "# deny all web access\n<IfModule mod_authz_core.c>\n  Require all denied\n</IfModule>\n<IfModule !mod_authz_core.c>\n  Order allow,deny\n  Deny from all\n</IfModule>\n");
            $ix = $dir . DIRECTORY_SEPARATOR . 'index.php';
            if (!is_file($ix)) @file_put_contents($ix, "<?php http_response_code(404); exit;\n");
        }
    }

    /**
     * Per-installation secrets in data/secret.php (a PHP file: if it is ever requested over the web it
     * executes and prints nothing). Created once with an exclusive lock.
     *   app_key  — HMAC key (IP hashing, upload names)
     *   db_file  — unguessable SQLite file name
     */
    public static function secret(string $key): string
    {
        if (self::$secret === null) {
            $file = self::dataDir() . DIRECTORY_SEPARATOR . 'secret.php';
            if (!is_file($file)) {
                $lock = fopen(self::dataDir() . DIRECTORY_SEPARATOR . '.init.lock', 'c');
                if ($lock) flock($lock, LOCK_EX);
                try {
                    clearstatcache(true, $file);
                    if (!is_file($file)) {
                        $s = [
                            'app_key' => bin2hex(random_bytes(32)),
                            'db_file' => 'db-' . bin2hex(random_bytes(12)) . '.sqlite',
                            'created' => gmdate('c'),
                        ];
                        $php = "<?php\n// generated secrets — keep private, do not commit, back up together with the database\nif (!defined('TFM_BOOT')) { http_response_code(404); exit; }\nreturn " . var_export($s, true) . ";\n";
                        $tmp = $file . '.' . bin2hex(random_bytes(4)) . '.tmp';
                        if (file_put_contents($tmp, $php, LOCK_EX) === false || !rename($tmp, $file)) {
                            @unlink($tmp);
                            throw new \RuntimeException('cannot write secret file (is data/ writable?)');
                        }
                        @chmod($file, 0640);
                    }
                } finally {
                    if ($lock) { flock($lock, LOCK_UN); fclose($lock); }
                }
            }
            $s = require $file;
            self::$secret = is_array($s) ? $s : [];
        }
        $v = isset(self::$secret[$key]) ? self::$secret[$key] : '';
        if (!is_string($v) || $v === '') throw new \RuntimeException("secret '$key' missing");
        return $v;
    }
}

final class Log
{
    private const LEVELS = ['debug' => 10, 'info' => 20, 'warn' => 30, 'error' => 40, 'security' => 35];
    /** @var string|null */
    private static $requestId = null;

    public static function requestId(): string
    {
        if (self::$requestId === null) self::$requestId = bin2hex(random_bytes(6));
        return self::$requestId;
    }

    public static function debug(string $cat, string $msg, array $ctx = []): void { self::write('debug', $cat, $msg, $ctx); }
    public static function info(string $cat, string $msg, array $ctx = []): void { self::write('info', $cat, $msg, $ctx); }
    public static function warn(string $cat, string $msg, array $ctx = []): void { self::write('warn', $cat, $msg, $ctx); }
    public static function error(string $cat, string $msg, array $ctx = []): void { self::write('error', $cat, $msg, $ctx); }
    public static function security(string $cat, string $msg, array $ctx = []): void { self::write('security', $cat, $msg, $ctx); }

    public static function dir(): string
    {
        $d = Config::dataDir() . DIRECTORY_SEPARATOR . 'logs';
        if (!is_dir($d)) Config::ensureDir($d, true);
        return $d;
    }

    /**
     * One JSON object per line in data/logs/app-YYYY-MM-DD.log.php. The file starts with a PHP exit guard, so
     * a misconfigured server that exposes data/ still cannot show it. Never logs passwords, tokens or payment keys.
     */
    public static function write(string $level, string $cat, string $msg, array $ctx = []): void
    {
        try {
            $lvl = strtolower((string) Config::get('logs.level', 'info'));
            $min = isset(self::LEVELS[$lvl]) ? self::LEVELS[$lvl] : 20;
            if ((isset(self::LEVELS[$level]) ? self::LEVELS[$level] : 20) < $min) return;
            $dir = self::dir();
            $file = $dir . DIRECTORY_SEPARATOR . 'app-' . date('Y-m-d') . '.log.php';
            $max = (int) Config::get('logs.max_file_bytes', 5242880);
            clearstatcache(true, $file);
            if (is_file($file) && filesize($file) > $max) {
                for ($i = 1; $i < 100 && is_file($rot = $dir . DIRECTORY_SEPARATOR . 'app-' . date('Y-m-d') . ".$i.log.php"); $i++);
                @rename($file, $rot);
            }
            $line = json_encode([
                't'   => date('c'),
                'lvl' => $level,
                'cat' => $cat,
                'msg' => mb_substr($msg, 0, 2000),
                'rid' => self::requestId(),
                'ip'  => Http::clientIp(),
                'ctx' => $ctx ?: null,
            ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE | JSON_PARTIAL_OUTPUT_ON_ERROR);
            if (!is_string($line)) $line = '{"lvl":"' . $level . '","msg":"(unencodable log line)"}';
            $new = !is_file($file);
            $fh = @fopen($file, 'ab');
            if (!$fh) { @error_log('[tfm] ' . $level . ' ' . $cat . ': ' . $msg . ' (data/logs not writable)'); return; }
            if (flock($fh, LOCK_EX)) {
                if ($new) fwrite($fh, "<?php http_response_code(404); exit; ?>\n");
                fwrite($fh, $line . "\n");
                flock($fh, LOCK_UN);
            }
            fclose($fh);
            if ($new) { @chmod($file, 0640); self::cleanup(); }
        } catch (\Throwable $e) {
            // logging must never break a request; leave a trace in the web server's PHP error log
            @error_log('[tfm] ' . $level . ' ' . $cat . ': ' . $msg . ' (log failed: ' . $e->getMessage() . ')');
        }
    }

    /** delete log files older than logs.retention_days */
    public static function cleanup(): int
    {
        $days = max(1, (int) Config::get('logs.retention_days', 14));
        $limit = time() - $days * 86400;
        $n = 0;
        foreach (glob(self::dir() . DIRECTORY_SEPARATOR . 'app-*.log.php') ?: [] as $f) {
            if (@filemtime($f) < $limit && @unlink($f)) $n++;
        }
        return $n;
    }
}

final class Http
{
    /** @var string|null */
    private static $ip = null;

    public static function method(): string { return strtoupper((string) (isset($_SERVER['REQUEST_METHOD']) ? $_SERVER['REQUEST_METHOD'] : 'GET')); }

    /** HTTPS directly, or through a configured trusted proxy */
    public static function isHttps(): bool
    {
        if (!empty($_SERVER['HTTPS']) && strtolower((string) $_SERVER['HTTPS']) !== 'off') return true;
        if ((string) (isset($_SERVER['SERVER_PORT']) ? $_SERVER['SERVER_PORT'] : '') === '443') return true;
        if (self::fromTrustedProxy()) {
            $p = strtolower((string) (isset($_SERVER['HTTP_X_FORWARDED_PROTO']) ? $_SERVER['HTTP_X_FORWARDED_PROTO'] : ''));
            if ($p === 'https') return true;
        }
        return false;
    }

    /** the connection comes from a configured reverse proxy (security.trusted_proxies: addresses or CIDR ranges) */
    private static function fromTrustedProxy(): bool
    {
        $remote = (string) (isset($_SERVER['REMOTE_ADDR']) ? $_SERVER['REMOTE_ADDR'] : '');
        $trusted = (array) Config::get('security.trusted_proxies', []);
        return $remote !== '' && $trusted && self::ipInList($remote, $trusted);
    }

    /** client IP: REMOTE_ADDR, or the right-most untrusted X-Forwarded-For hop when behind a trusted proxy */
    public static function clientIp(): string
    {
        if (self::$ip !== null) return self::$ip;
        $ip = (string) (isset($_SERVER['REMOTE_ADDR']) ? $_SERVER['REMOTE_ADDR'] : '');
        if (PHP_SAPI === 'cli' && $ip === '') $ip = 'cli';
        try {
            if (self::fromTrustedProxy() && !empty($_SERVER['HTTP_X_FORWARDED_FOR']) && is_string($_SERVER['HTTP_X_FORWARDED_FOR'])) {
                $trusted = (array) Config::get('security.trusted_proxies', []);
                $hops = array_reverse(array_map('trim', explode(',', substr($_SERVER['HTTP_X_FORWARDED_FOR'], 0, 1000))));
                foreach ($hops as $hop) {
                    if (filter_var($hop, FILTER_VALIDATE_IP) && !self::ipInList($hop, $trusted)) { $ip = $hop; break; }
                }
            }
        } catch (\Throwable $e) { /* config not ready */ }
        if ($ip !== 'cli') {
            $norm = self::normIp($ip);
            $ip = $norm !== '' ? $norm : '0.0.0.0';
        }
        return self::$ip = $ip;
    }

    /** forget what was derived from $_SERVER (unit tests simulate several requests in one process) */
    public static function resetRequestCache(): void
    {
        self::$ip = null;
        Config::resetRequest();
    }

    /** packed address (4 or 16 bytes); an IPv4-mapped IPv6 address becomes its IPv4 form; null when it is not an address */
    private static function ipBin(string $ip): ?string
    {
        if ($ip === '' || strlen($ip) > 64 || !filter_var($ip, FILTER_VALIDATE_IP)) return null;
        $bin = @inet_pton($ip);
        if (!is_string($bin)) return null;
        if (strlen($bin) === 16 && strncmp($bin, "\0\0\0\0\0\0\0\0\0\0\xff\xff", 12) === 0) $bin = substr($bin, 12);
        return $bin;
    }

    /** one spelling per address ('' when it is not an IP address): 2001:0db8::0001 → 2001:db8::1, ::ffff:1.2.3.4 → 1.2.3.4 */
    public static function normIp(string $ip): string
    {
        $bin = self::ipBin($ip);
        if ($bin === null) return '';
        $s = @inet_ntop($bin);
        return is_string($s) ? $s : '';
    }

    /** is $ip one of the entries: single addresses or CIDR ranges, IPv4 and IPv6 (invalid entries never match) */
    public static function ipInList(string $ip, array $cidrs): bool
    {
        $bin = self::ipBin($ip);
        if ($bin === null) return false;
        foreach ($cidrs as $c) {
            if (!is_string($c)) continue;
            $c = trim($c);
            $bits = null;
            $p = strpos($c, '/');
            if ($p !== false) {
                $m = substr($c, $p + 1);
                if (!preg_match('/^\d{1,3}$/', (string) $m)) continue;
                $bits = (int) $m;
                $c = substr($c, 0, $p);
            }
            $net = self::ipBin((string) $c);
            if ($net === null || strlen($net) !== strlen($bin)) continue;
            $max = strlen($net) * 8;
            if ($bits === null) $bits = $max;
            if ($bits > $max) continue;
            $bytes = intdiv($bits, 8);
            if ($bytes > 0 && strncmp($bin, $net, $bytes) !== 0) continue;
            $rest = $bits % 8;
            if ($rest > 0) {
                $mask = (0xff << (8 - $rest)) & 0xff;
                if ((ord($bin[$bytes]) & $mask) !== (ord($net[$bytes]) & $mask)) continue;
            }
            return true;
        }
        return false;
    }

    /** 127.0.0.0/8 or ::1 */
    public static function isLoopbackIp(string $ip): bool
    {
        return self::ipInList($ip, ['127.0.0.0/8', '::1']);
    }

    /** the running script relative to the installation folder, e.g. "api/auth/login.php" (for logs and events) */
    public static function scriptPath(): string
    {
        $s = str_replace('\\', '/', (string) (isset($_SERVER['SCRIPT_NAME']) ? $_SERVER['SCRIPT_NAME'] : ''));
        if (preg_match('#(?:^|/)((?:api|admin|cli)/[A-Za-z0-9_./-]{1,150})$#', $s, $m)) return $m[1];
        return substr((string) preg_replace('/[^A-Za-z0-9_.-]/', '', basename($s)), 0, 80);
    }

    /**
     * A browser on the server machine talking to it directly (first-admin bootstrap, anonymous health check).
     * A reverse proxy, tunnel (ngrok, cloudflared) or CDN on the same machine also connects from loopback, so a
     * relayed request never counts: the socket must be loopback AND not a trusted proxy AND carry no forwarding
     * header AND be addressed to a loopback host name (a tunnel or proxy forwards the public Host).
     */
    public static function isLocalhost(): bool
    {
        $ip = (string) (isset($_SERVER['REMOTE_ADDR']) ? $_SERVER['REMOTE_ADDR'] : '');
        if (!in_array($ip, ['127.0.0.1', '::1', '::ffff:127.0.0.1'], true)) return false;
        try { if (self::fromTrustedProxy()) return false; } catch (\Throwable $e) { return false; }
        foreach (['HTTP_X_FORWARDED_FOR', 'HTTP_FORWARDED', 'HTTP_X_REAL_IP', 'HTTP_X_FORWARDED_HOST', 'HTTP_X_FORWARDED_PROTO',
                  'HTTP_X_FORWARDED_SERVER', 'HTTP_VIA', 'HTTP_CF_CONNECTING_IP', 'HTTP_CF_RAY', 'HTTP_TRUE_CLIENT_IP',
                  'HTTP_X_CLIENT_IP', 'HTTP_X_CLUSTER_CLIENT_IP', 'HTTP_FASTLY_CLIENT_IP', 'HTTP_X_ORIGINAL_FORWARDED_FOR'] as $h) {
            if (isset($_SERVER[$h]) && trim((string) $_SERVER[$h]) !== '') return false;
        }
        $host = strtolower(trim((string) (isset($_SERVER['HTTP_HOST']) ? $_SERVER['HTTP_HOST'] : '')));
        if (!preg_match('/^(?:\[::1\]|(?:[a-z0-9-]+\.)*localhost|127(?:\.\d{1,3}){3})(?::\d{1,5})?$/', $host)) return false;
        return true;
    }

    /**
     * URL path of the installation root (the folder that holds index.html), e.g. "/metaverse/".
     * Derived from SCRIPT_NAME minus the script's path relative to TFM_ROOT — never from the Host header.
     * Windows safe: both paths are normalised to forward slashes and compared without case.
     */
    public static function basePath(): string
    {
        static $base = null;
        if ($base !== null) return $base;
        $script = str_replace('\\', '/', (string) (isset($_SERVER['SCRIPT_NAME']) ? $_SERVER['SCRIPT_NAME'] : '/'));
        // both paths below are resolved by PHP itself (no web-server formatting differences, e.g. drive-letter case)
        $included = get_included_files();
        $entry = str_replace('\\', '/', (string) (isset($included[0]) ? $included[0] : ''));
        $root = str_replace('\\', '/', (string) TFM_ROOT);
        $ci = PHP_OS_FAMILY === 'Windows';
        $inRoot = $entry !== '' && ($ci ? stripos($entry, $root . '/') === 0 : Str::startsWith($entry, $root . '/'));
        $rel = $inRoot ? Str::sub($entry, strlen($root)) : '';
        $tail = $rel !== '' ? Str::sub($script, -strlen($rel)) : '';
        if ($rel !== '' && ($ci ? strcasecmp($tail, $rel) === 0 : $tail === $rel)) {
            $b = Str::sub($script, 0, -strlen($rel)) . '/';
        } elseif (preg_match('#^(.*/)(?:api/.+\.php|admin\.php|install\.php|cli/.+)$#i', $script, $m)) {
            $b = $m[1]; // known layout fallback
        } else {
            $b = rtrim(dirname($script), '/') . '/';
        }
        $b = (string) preg_replace('#/+#', '/', '/' . ltrim($b, '/'));
        if (!preg_match('#^/[A-Za-z0-9._~/%-]*$#', $b)) $b = '/';
        return $base = $b;
    }

    /** absolute URL of the installation root for redirects (scheme + host from the request, path from basePath) */
    public static function baseUrl(): string
    {
        $host = (string) (isset($_SERVER['HTTP_HOST']) ? $_SERVER['HTTP_HOST'] : 'localhost');
        if (!preg_match('/^[A-Za-z0-9.\-\[\]:]{1,253}$/', $host)) $host = 'localhost';
        return (self::isHttps() ? 'https' : 'http') . '://' . $host . self::basePath();
    }

    /** raw request body, refusing anything larger than $max bytes */
    public static function body(int $max): string
    {
        $len = (int) (isset($_SERVER['CONTENT_LENGTH']) ? $_SERVER['CONTENT_LENGTH'] : 0);
        if ($len > $max) throw new ApiException(413, 'PAYLOAD_TOO_LARGE', '보낸 데이터가 너무 커요.');
        $in = fopen('php://input', 'rb');
        if (!$in) return '';
        $raw = stream_get_contents($in, $max + 1);
        fclose($in);
        if ($raw === false) return '';
        if (strlen($raw) > $max) throw new ApiException(413, 'PAYLOAD_TOO_LARGE', '보낸 데이터가 너무 커요.');
        return $raw;
    }

    public static function isJsonRequest(): bool
    {
        $ct = isset($_SERVER['CONTENT_TYPE']) ? $_SERVER['CONTENT_TYPE'] : (isset($_SERVER['HTTP_CONTENT_TYPE']) ? $_SERVER['HTTP_CONTENT_TYPE'] : '');
        return Str::startsWith(strtolower((string) $ct), 'application/json'); // never text/plain (that would be a CORS "simple" request)
    }

    /** decode a JSON request body into an associative array (objects only) */
    public static function json(int $max = 65536): array
    {
        if (!self::isJsonRequest()) throw new ApiException(415, 'UNSUPPORTED_MEDIA_TYPE', 'JSON 형식으로 보내 주세요.');
        $raw = self::body($max);
        if (trim($raw) === '') return [];
        try { $v = Json::decode($raw, true, 32, JSON_BIGINT_AS_STRING); }
        catch (\UnexpectedValueException $e) { throw new ApiException(400, 'INVALID_JSON', '요청 형식이 올바르지 않아요.'); }
        if (!is_array($v) || (Arr::isList($v) && $v !== [])) throw new ApiException(400, 'INVALID_JSON', '요청 형식이 올바르지 않아요.');
        return $v;
    }

    /**
     * Security headers.
     *   api   : JSON endpoints — nothing may be rendered or framed
     *   admin : server-rendered pages (admin.php, install.php, sub/return.php) with a nonce-based CSP
     */
    public static function securityHeaders(string $kind, string $nonce = ''): void
    {
        if (headers_sent()) return;
        header_remove('X-Powered-By');
        header('X-Content-Type-Options: nosniff');
        header('Referrer-Policy: no-referrer');
        header('Permissions-Policy: camera=(), microphone=(self), geolocation=(), payment=(), usb=()');
        header('Cross-Origin-Opener-Policy: same-origin');
        header('Cross-Origin-Resource-Policy: same-origin');
        header('X-Permitted-Cross-Domain-Policies: none');
        if ($kind === 'admin') {
            header("Content-Security-Policy: default-src 'none'; style-src 'nonce-$nonce'; img-src 'self' data:; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
            header('X-Frame-Options: DENY');
            header('Cache-Control: no-store, max-age=0');
            header('Content-Type: text/html; charset=utf-8');
        } else {
            header("Content-Security-Policy: default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
            header('X-Frame-Options: DENY');
            header('Cache-Control: no-store, max-age=0');
            header('Pragma: no-cache');
        }
        try {
            if (self::isHttps() && Config::get('security.hsts', true)) header('Strict-Transport-Security: max-age=31536000');
        } catch (\Throwable $e) { /* ignore */ }
    }
}
