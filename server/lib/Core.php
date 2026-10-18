<?php
/**
 * Core helpers: Config, Clock, Log, ApiException, Http (request facts + security headers).
 * Every file in lib/ refuses to run unless included through lib/bootstrap.php.
 */
declare(strict_types=1);

namespace Tfm;

if (!defined('TFM_BOOT')) { http_response_code(404); exit; }

/** An error that becomes a JSON error response {success:false, error:{code,message}, data?}. */
final class ApiException extends \RuntimeException
{
    public function __construct(
        public readonly int $status,
        public readonly string $errorCode,
        string $message,
        public readonly mixed $data = null,
        public readonly array $headers = [],
    ) {
        parent::__construct($message, $status);
    }
}

final class Clock
{
    /** server time in milliseconds (the client syncs G.time to this) */
    public static function ms(): int { return (int) floor(microtime(true) * 1000); }
    /** calendar day in the configured time zone, e.g. 2026-10-10 */
    public static function day(?int $ms = null): string { return date('Y-m-d', intdiv($ms ?? self::ms(), 1000)); }
    public static function startOfDayMs(): int { return strtotime('today') * 1000; }
}

final class Config
{
    private static ?array $cfg = null;
    private static ?array $secret = null;

    public static function all(): array
    {
        if (self::$cfg === null) {
            $base = require TFM_ROOT . '/config/config.php';
            $local = TFM_ROOT . '/config/config.local.php';
            if (is_file($local)) {
                $over = require $local;
                if (is_array($over)) $base = self::merge($base, $over);
            }
            self::$cfg = $base;
        }
        return self::$cfg;
    }

    /** dotted lookup: Config::get('chat.max_length', 120) */
    public static function get(string $path, mixed $default = null): mixed
    {
        $v = self::all();
        foreach (explode('.', $path) as $k) {
            if (!is_array($v) || !array_key_exists($k, $v)) return $default;
            $v = $v[$k];
        }
        return $v;
    }

    /** recursive merge: associative arrays merge, lists and scalars are replaced */
    private static function merge(array $a, array $b): array
    {
        foreach ($b as $k => $v) {
            if (is_array($v) && isset($a[$k]) && is_array($a[$k]) && !array_is_list($v) && !array_is_list($a[$k])) $a[$k] = self::merge($a[$k], $v);
            else $a[$k] = $v;
        }
        return $a;
    }

    public static function dataDir(): string
    {
        static $dir = null;
        if ($dir !== null) return $dir;
        $d = (string) self::get('paths.data', '');
        $d = $d !== '' ? rtrim($d, '/\\') : TFM_ROOT . '/data';
        self::ensureDir($d, true);
        return $dir = $d;
    }

    public static function uploadDir(): string
    {
        static $dir = null;
        if ($dir !== null) return $dir;
        $d = (string) self::get('paths.uploads', '');
        $d = $d !== '' ? rtrim($d, '/\\') : TFM_ROOT . '/uploads';
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
            $ht = $dir . '/.htaccess';
            if (!is_file($ht)) @file_put_contents($ht, "# deny all web access\n<IfModule mod_authz_core.c>\n  Require all denied\n</IfModule>\n<IfModule !mod_authz_core.c>\n  Order allow,deny\n  Deny from all\n</IfModule>\n");
            $ix = $dir . '/index.php';
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
            $file = self::dataDir() . '/secret.php';
            if (!is_file($file)) {
                $lock = fopen(self::dataDir() . '/.init.lock', 'c');
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
        $v = self::$secret[$key] ?? '';
        if (!is_string($v) || $v === '') throw new \RuntimeException("secret '$key' missing");
        return $v;
    }
}

final class Log
{
    private const LEVELS = ['debug' => 10, 'info' => 20, 'warn' => 30, 'error' => 40, 'security' => 35];
    private static ?string $requestId = null;

    public static function requestId(): string
    {
        return self::$requestId ??= bin2hex(random_bytes(6));
    }

    public static function debug(string $cat, string $msg, array $ctx = []): void { self::write('debug', $cat, $msg, $ctx); }
    public static function info(string $cat, string $msg, array $ctx = []): void { self::write('info', $cat, $msg, $ctx); }
    public static function warn(string $cat, string $msg, array $ctx = []): void { self::write('warn', $cat, $msg, $ctx); }
    public static function error(string $cat, string $msg, array $ctx = []): void { self::write('error', $cat, $msg, $ctx); }
    public static function security(string $cat, string $msg, array $ctx = []): void { self::write('security', $cat, $msg, $ctx); }

    public static function dir(): string
    {
        $d = Config::dataDir() . '/logs';
        if (!is_dir($d)) Config::ensureDir($d, true);
        return $d;
    }

    /**
     * One JSON object per line in data/logs/app-YYYY-MM-DD.log.php. The file starts with a PHP exit guard, so
     * a misconfigured server that exposes data/ still cannot show it. Never logs passwords or tokens.
     */
    public static function write(string $level, string $cat, string $msg, array $ctx = []): void
    {
        try {
            $min = self::LEVELS[strtolower((string) Config::get('logs.level', 'info'))] ?? 20;
            if ((self::LEVELS[$level] ?? 20) < $min) return;
            $dir = self::dir();
            $file = $dir . '/app-' . date('Y-m-d') . '.log.php';
            $max = (int) Config::get('logs.max_file_bytes', 5242880);
            clearstatcache(true, $file);
            if (is_file($file) && filesize($file) > $max) {
                for ($i = 1; $i < 100 && is_file($rot = $dir . '/app-' . date('Y-m-d') . ".$i.log.php"); $i++);
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
        foreach (glob(self::dir() . '/app-*.log.php') ?: [] as $f) {
            if (@filemtime($f) < $limit && @unlink($f)) $n++;
        }
        return $n;
    }
}

final class Http
{
    private static ?string $ip = null;

    public static function method(): string { return strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET')); }

    /** HTTPS directly, or through a configured trusted proxy */
    public static function isHttps(): bool
    {
        if (!empty($_SERVER['HTTPS']) && strtolower((string) $_SERVER['HTTPS']) !== 'off') return true;
        if ((string) ($_SERVER['SERVER_PORT'] ?? '') === '443') return true;
        if (self::fromTrustedProxy()) {
            $p = strtolower((string) ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? ''));
            if ($p === 'https') return true;
        }
        return false;
    }

    private static function fromTrustedProxy(): bool
    {
        $remote = (string) ($_SERVER['REMOTE_ADDR'] ?? '');
        $trusted = (array) Config::get('security.trusted_proxies', []);
        return $remote !== '' && in_array($remote, $trusted, true);
    }

    /** client IP: REMOTE_ADDR, or the right-most untrusted X-Forwarded-For hop when behind a trusted proxy */
    public static function clientIp(): string
    {
        if (self::$ip !== null) return self::$ip;
        $ip = (string) ($_SERVER['REMOTE_ADDR'] ?? '');
        if (PHP_SAPI === 'cli' && $ip === '') $ip = 'cli';
        try {
            if (self::fromTrustedProxy() && !empty($_SERVER['HTTP_X_FORWARDED_FOR'])) {
                $trusted = (array) Config::get('security.trusted_proxies', []);
                $hops = array_reverse(array_map('trim', explode(',', (string) $_SERVER['HTTP_X_FORWARDED_FOR'])));
                foreach ($hops as $hop) {
                    if (filter_var($hop, FILTER_VALIDATE_IP) && !in_array($hop, $trusted, true)) { $ip = $hop; break; }
                }
            }
        } catch (\Throwable) { /* config not ready */ }
        if ($ip !== 'cli' && !filter_var($ip, FILTER_VALIDATE_IP)) $ip = '0.0.0.0';
        return self::$ip = $ip;
    }

    /**
     * A browser on the server machine talking to it directly (first-admin bootstrap, anonymous health check).
     * A reverse proxy, tunnel (ngrok, cloudflared) or CDN on the same machine also connects from loopback, so a
     * relayed request never counts: the socket must be loopback AND not a trusted proxy AND carry no forwarding
     * header AND be addressed to a loopback host name (a tunnel or proxy forwards the public Host).
     */
    public static function isLocalhost(): bool
    {
        $ip = (string) ($_SERVER['REMOTE_ADDR'] ?? '');
        if (!in_array($ip, ['127.0.0.1', '::1', '::ffff:127.0.0.1'], true)) return false;
        try { if (self::fromTrustedProxy()) return false; } catch (\Throwable) { return false; }
        foreach (['HTTP_X_FORWARDED_FOR', 'HTTP_FORWARDED', 'HTTP_X_REAL_IP', 'HTTP_X_FORWARDED_HOST', 'HTTP_X_FORWARDED_PROTO',
                  'HTTP_X_FORWARDED_SERVER', 'HTTP_VIA', 'HTTP_CF_CONNECTING_IP', 'HTTP_CF_RAY', 'HTTP_TRUE_CLIENT_IP',
                  'HTTP_X_CLIENT_IP', 'HTTP_X_CLUSTER_CLIENT_IP', 'HTTP_FASTLY_CLIENT_IP', 'HTTP_X_ORIGINAL_FORWARDED_FOR'] as $h) {
            if (isset($_SERVER[$h]) && trim((string) $_SERVER[$h]) !== '') return false;
        }
        $host = strtolower(trim((string) ($_SERVER['HTTP_HOST'] ?? '')));
        if (!preg_match('/^(?:\[::1\]|(?:[a-z0-9-]+\.)*localhost|127(?:\.\d{1,3}){3})(?::\d{1,5})?$/', $host)) return false;
        return true;
    }

    /**
     * URL path of the installation root (the folder that holds index.html), e.g. "/metaverse/".
     * Derived from SCRIPT_NAME minus the script's path relative to TFM_ROOT — never from the Host header.
     */
    public static function basePath(): string
    {
        static $base = null;
        if ($base !== null) return $base;
        $script = str_replace('\\', '/', (string) ($_SERVER['SCRIPT_NAME'] ?? '/'));
        // both paths below are resolved by PHP itself (no web-server formatting differences, e.g. drive-letter case)
        $entry = str_replace('\\', '/', (string) (get_included_files()[0] ?? ''));
        $root = str_replace('\\', '/', (string) TFM_ROOT);
        $ci = PHP_OS_FAMILY === 'Windows';
        $inRoot = $entry !== '' && ($ci ? stripos($entry, $root . '/') === 0 : str_starts_with($entry, $root . '/'));
        $rel = $inRoot ? substr($entry, strlen($root)) : '';
        $tail = $rel !== '' ? substr($script, -strlen($rel)) : '';
        if ($rel !== '' && ($ci ? strcasecmp($tail, $rel) === 0 : $tail === $rel)) {
            $b = substr($script, 0, -strlen($rel)) . '/';
        } elseif (preg_match('#^(.*/)(?:api/.+\.php|admin\.php|cli/.+)$#i', $script, $m)) {
            $b = $m[1]; // known layout fallback
        } else {
            $b = rtrim(dirname($script), '/') . '/';
        }
        $b = (string) preg_replace('#/+#', '/', '/' . ltrim($b, '/'));
        if (!preg_match('#^/[A-Za-z0-9._~/%-]*$#', $b)) $b = '/';
        return $base = $b;
    }

    /** raw request body, refusing anything larger than $max bytes */
    public static function body(int $max): string
    {
        $len = (int) ($_SERVER['CONTENT_LENGTH'] ?? 0);
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
        $ct = strtolower((string) ($_SERVER['CONTENT_TYPE'] ?? $_SERVER['HTTP_CONTENT_TYPE'] ?? ''));
        return str_starts_with($ct, 'application/json'); // never text/plain (that would be a CORS "simple" request)
    }

    /** decode a JSON request body into an associative array (objects only) */
    public static function json(int $max = 65536): array
    {
        if (!self::isJsonRequest()) throw new ApiException(415, 'UNSUPPORTED_MEDIA_TYPE', 'JSON 형식으로 보내 주세요.');
        $raw = self::body($max);
        if (trim($raw) === '') return [];
        try { $v = json_decode($raw, true, 32, JSON_THROW_ON_ERROR | JSON_BIGINT_AS_STRING); }
        catch (\JsonException) { throw new ApiException(400, 'INVALID_JSON', '요청 형식이 올바르지 않아요.'); }
        if (!is_array($v) || (array_is_list($v) && $v !== [])) throw new ApiException(400, 'INVALID_JSON', '요청 형식이 올바르지 않아요.');
        return $v;
    }

    /**
     * Security headers.
     *   api   : JSON endpoints — nothing may be rendered or framed
     *   admin : server-rendered admin page with a nonce-based CSP
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
        } catch (\Throwable) { /* ignore */ }
    }
}
