<?php
/**
 * Tiny endpoint framework. Every api/*.php file is:
 *
 *   require __DIR__ . '/../../lib/bootstrap.php';
 *   Tfm\Api::run(['method' => 'POST', 'auth' => true, 'rate' => 'chat_send'], function (Tfm\Ctx $c) { ...; return [...]; });
 *
 * It enforces: allowed methods (405), same-origin + CSRF for state-changing requests (403), login (401),
 * admin role (403), per-endpoint rate limits (429), JSON-only output with security headers, and turns
 * any unexpected error into a generic 500 (details only in data/logs).
 * Response: {success, data | error:{code,message}, csrf, serverTime}
 * PHP 7.2 syntax only.
 */
declare(strict_types=1);

namespace Tfm;

if (!defined('TFM_BOOT')) { if (function_exists('header_remove')) header_remove('X-Powered-By'); http_response_code(404); exit; }

final class Ctx
{
    /** @var array|null the logged-in users row */
    public $user = null;
    /** @var int */
    public $now;
    /** @var bool */
    public $csrfPending = false;

    public function __construct() { $this->now = Clock::ms(); }

    public function uid(): int { return (int) (isset($this->user['id']) ? $this->user['id'] : 0); }
    public function isAdmin(): bool { return (isset($this->user['role']) ? $this->user['role'] : '') === 'admin'; }
    /** rate-limit identity: the account when logged in, else this browser session, else a keyed hash of the IP */
    public function ident(): string
    {
        if ($this->user) return 'u:' . $this->uid();
        $sid = Session::id();
        return $sid !== '' ? 's:' . Sec::hashId($sid) : 'ip:' . Sec::hashId(Http::clientIp());
    }
    public function json(int $max = 65536): array { return Http::json($max); }

    /** for navigator.sendBeacon requests that cannot set headers: the token travels in the JSON body */
    public function checkBodyCsrf($token): void
    {
        if (!$this->csrfPending) return;
        if (!Session::checkCsrf(is_string($token) ? $token : null)) Api::csrfFail();
        $this->csrfPending = false;
    }
}

final class Api
{
    public static function run(array $opt, callable $fn)
    {
        Boot::forApi();
        try {
            // CONTRACT §15.7 #5 / #2 / #10 / #14: the request-level guards run first, before the session, body or
            // credentials are touched — a blocked address, a plain-HTTP request or a stray file never gets that far.
            if (class_exists('Tfm\Firewall')) Firewall::check();        // #5  blocked address → 403 IP_BLOCKED
            Http::enforceHttps();                                       // #2  http GET → 308, other http → 403 HTTPS_REQUIRED
            $public = !empty($opt['public']);
            Http::cors($public);                                        // #10 OPTIONS preflight handled here; public GET gets ACAO
            $method = Http::method();
            $allowed = array_map('strtoupper', (array) (isset($opt['method']) ? $opt['method'] : 'GET'));
            if (!in_array($method, $allowed, true)) {
                throw new ApiException(405, 'METHOD_NOT_ALLOWED', '허용되지 않은 요청 방식이에요.', null, ['Allow: ' . implode(', ', $allowed)]);
            }
            Http::refuseUpload(!empty($opt['upload']));                 // #14 a file to a non-upload endpoint → 400 UPLOAD_NOT_ALLOWED
            if (class_exists('Tfm\V')) V::watch($_GET, 'query');        // #5  log hostile-looking query strings (never the protection)
            $ctx = new Ctx();
            $write = !in_array($method, ['GET', 'HEAD'], true);
            $needsLogin = !empty($opt['auth']) || !empty($opt['admin']);
            // only ping (and pages that must hand out a CSRF token) create sessions; everything else resumes one
            Session::start((isset($opt['session']) ? $opt['session'] : 'resume') === 'create');
            if ($write) {
                Sec::checkOrigin();
                if ((isset($opt['csrf']) ? $opt['csrf'] : true) !== false) {
                    // R3-runtime-1: a write request that carries no session at all (cookies cleared while the tab stayed open)
                    // has no session a CSRF token could protect. For an endpoint that needs a login the truthful answer is
                    // 401 AUTH_REQUIRED — the client shows its re-login card — never a 403 CSRF_INVALID it would retry forever.
                    if ($needsLogin && !Session::started()) {
                        Log::info('AUTH', 'write without a session', ['path' => basename((string) (isset($_SERVER['SCRIPT_NAME']) ? $_SERVER['SCRIPT_NAME'] : ''))]);
                        throw new ApiException(401, 'AUTH_REQUIRED', '로그인이 필요해요. 다시 로그인해 주세요.');
                    }
                    $hdr = isset($_SERVER['HTTP_X_CSRF_TOKEN']) ? $_SERVER['HTTP_X_CSRF_TOKEN'] : null;
                    if ($hdr === null && !empty($opt['csrfBody'])) $ctx->csrfPending = true;
                    elseif (!Session::checkCsrf(is_string($hdr) ? $hdr : null)) self::csrfFail();
                }
            }
            $ctx->user = Auth::current();
            if ($needsLogin) {
                // data.why when this request found the session invalid ('epoch' | 'banned' | 'deleted' | 'other account')
                if (!$ctx->user) throw new ApiException(401, 'AUTH_REQUIRED', '로그인이 필요해요. 다시 로그인해 주세요.', Auth::$lostWhy !== null ? ['why' => Auth::$lostWhy] : null);
            }
            if (!empty($opt['admin']) && !$ctx->isAdmin()) {
                $path = Http::scriptPath();
                // CONTRACT §15.7 #5: a player knocking on an admin endpoint is a security event (+ the audit row admin.php reads)
                if (class_exists('Tfm\SecEvent')) SecEvent::log('admin_denied', 'warn', ['path' => $path], $ctx->uid() ?: null);
                Audit::log('admin_denied', $ctx->uid(), ['path' => $path], 'warn');
                throw new ApiException(403, 'FORBIDDEN', '관리자 권한이 필요해요.');
            }
            if (!empty($opt['rate'])) RateLimit::forRequest((string) $opt['rate'], $ctx, (string) (isset($opt['rateBy']) ? $opt['rateBy'] : 'auto'));
            $data = $fn($ctx);
            if ($ctx->csrfPending) self::csrfFail(); // handler forgot to verify the body token
            self::send(200, ['success' => true, 'data' => $data]);
        } catch (ApiException $e) {
            $payload = ['success' => false, 'error' => ['code' => $e->errorCode, 'message' => $e->getMessage()]];
            if ($e->data !== null) $payload['data'] = $e->data;
            self::send($e->status, $payload, $e->headers);
        } catch (\Throwable $e) {
            self::fail($e);
        }
    }

    public static function csrfFail()
    {
        // CONTRACT §15.7 #5: recorded as a security event. Logged at 'info', not 'warn': a stale token after the session
        // ran out is the common cause (a classroom's tabs left open), so it must not count toward the automatic block —
        // a genuinely cross-site forgery is caught one step earlier by the Origin check (origin_mismatch, 'warn').
        if (class_exists('Tfm\SecEvent')) SecEvent::log('csrf_fail', 'info', ['path' => Http::scriptPath()]);
        Log::security('CSRF', 'csrf token missing or invalid', ['path' => basename((string) (isset($_SERVER['SCRIPT_NAME']) ? $_SERVER['SCRIPT_NAME'] : ''))]);
        throw new ApiException(403, 'CSRF_INVALID', '보안 토큰이 만료되었어요. 다시 시도해 주세요.');
    }

    /** generic 500 — the reference id lets an admin find the details in data/logs */
    public static function fail(\Throwable $e)
    {
        $ref = Log::requestId();
        $trace = array_map(function ($f) {
            return (isset($f['class']) ? $f['class'] : '') . (isset($f['type']) ? $f['type'] : '') . (isset($f['function']) ? $f['function'] : '') . '@' . basename(isset($f['file']) ? $f['file'] : '?') . ':' . (isset($f['line']) ? $f['line'] : 0);
        }, array_slice($e->getTrace(), 0, 8));
        Log::error('API', get_class($e) . ': ' . $e->getMessage(), [
            'at' => basename($e->getFile()) . ':' . $e->getLine(),
            'trace' => $trace,
            'path' => (string) (isset($_SERVER['SCRIPT_NAME']) ? $_SERVER['SCRIPT_NAME'] : ''),
        ]);
        self::send(500, ['success' => false, 'error' => ['code' => 'SERVER_ERROR', 'message' => '서버에서 문제가 생겼어요. 잠시 후 다시 시도해 주세요.', 'ref' => $ref]]);
    }

    public static function send(int $status, array $payload, array $headers = [])
    {
        while (ob_get_level() > 0) @ob_end_clean(); // never leak stray output (warnings, BOMs)
        try { $t = Session::currentCsrf(); if ($t !== null) $payload['csrf'] = $t; } catch (\Throwable $e) { /* ignore */ }
        $payload['serverTime'] = Clock::ms();
        $json = json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT | JSON_INVALID_UTF8_SUBSTITUTE | JSON_PARTIAL_OUTPUT_ON_ERROR);
        if (!is_string($json)) { $status = 500; $json = '{"success":false,"error":{"code":"SERVER_ERROR","message":"응답을 만들지 못했어요."}}'; }
        if (!headers_sent()) {
            http_response_code($status);
            Http::securityHeaders('api');
            header('Content-Type: application/json; charset=utf-8');
            foreach ($headers as $h) header($h);
        }
        Session::close();
        echo $json;
        exit;
    }
}

final class Auth
{
    /** @var array|null */
    private static $cached = null;
    /** @var bool */
    private static $loaded = false;
    /** @var string|null why current() just ended this request's session (null: it was fine, or there was none) */
    public static $lostWhy = null;

    /** the logged-in user, re-validated against the DB on every request (ban, epoch, role changes) */
    public static function current(): ?array
    {
        if (self::$loaded) return self::$cached;
        self::$loaded = true;
        $uid = Session::userId();
        if ($uid <= 0) return null;
        $u = Users::byId($uid);
        if (!$u || $u['status'] !== 'active' || (int) $u['session_epoch'] !== Session::epoch() || !Session::ownsAccount($u)) {
            self::$lostWhy = !$u ? 'deleted' : ($u['status'] !== 'active' ? 'banned' : ((int) $u['session_epoch'] !== Session::epoch() ? 'epoch' : 'other account'));
            Log::info('AUTH', 'session invalidated', ['uid' => $uid, 'why' => self::$lostWhy]);
            Session::logout();
            return self::$cached = null;
        }
        return self::$cached = $u;
    }

    public static function forget(): void { self::$cached = null; self::$loaded = false; self::$lostWhy = null; }

    /**
     * The one login path (api/auth/login.php and admin.php): throttling with exponential lockout, constant-time
     * verification for unknown accounts, transparent rehash, config admin_emails promotion, session rotation.
     * Returns the fresh users row; throws ApiException (400/401/403/429) on failure.
     */
    public static function attemptLogin(string $login, string $pw, bool $remember): array
    {
        $login = trim($login);
        if ($login === '') throw new ApiException(400, 'LOGIN_REQUIRED', '아이디(닉네임) 또는 이메일을 입력해 주세요.');
        if ($pw === '') throw new ApiException(400, 'PASSWORD_REQUIRED', '비밀번호를 입력해 주세요.');
        if (mb_strlen($login) > 120 || strlen($pw) > 512) throw new ApiException(400, 'INVALID_CREDENTIALS', '아이디 또는 비밀번호가 올바르지 않아요.');
        $login = mb_strtolower($login);
        $wait = LoginThrottle::check($login);
        if ($wait > 0) {
            Audit::log('login_locked', null, ['wait' => $wait], 'warn');
            // CONTRACT §15.7 #5: a lock-out is a security event. Not attack-like — the login throttle already handles the
            // guessing, so repeated lock-outs (a classroom getting a password wrong together) must not auto-block the address.
            if (class_exists('Tfm\SecEvent')) SecEvent::log('login_locked', 'warn', ['wait' => $wait]);
            throw new ApiException(429, 'TOO_MANY_ATTEMPTS', "로그인 시도가 너무 많아요. {$wait}초 후에 다시 시도해 주세요.", ['retryAfter' => $wait], ['Retry-After: ' . $wait]);
        }
        $u = Users::byLogin($login);
        $ok = Users::verifyPassword($u, $pw);
        if (!$ok || !$u || $u['status'] !== 'active') {
            LoginThrottle::record($login, false);
            Audit::log('login_failed', $u ? (int) $u['id'] : null, ['known' => (bool) $u], 'info');
            if ($ok && $u && $u['status'] === 'banned') throw new ApiException(403, 'ACCOUNT_BANNED', '이용이 정지된 계정이에요. 운영자에게 문의해 주세요.');
            $left = LoginThrottle::remaining($login);
            $hint = $left <= 2 ? ($left > 0 ? " (남은 시도 {$left}회)" : ' (잠시 후 다시 시도해 주세요)') : '';
            throw new ApiException(401, 'INVALID_CREDENTIALS', '아이디(닉네임·이메일) 또는 비밀번호가 올바르지 않아요.' . $hint, ['attemptsLeft' => $left]);
        }
        LoginThrottle::record($login, true);
        Users::maybeRehash($u, $pw);
        $fields = ['last_login_at' => Clock::ms(), 'last_login_ip' => substr(Http::clientIp(), 0, 64)];
        // F2 (CONTRACT §15.7 #6): no automatic admin promotion by e-mail. security.admin_emails has no proof that the
        // person who registered an address owns it, so whoever claimed it first would become admin. An admin is made
        // only by the installer's first account, or by `php cli/tfm.php promote <e-mail>` on the server machine.
        Users::update((int) $u['id'], $fields);
        $u = Users::byId((int) $u['id']);
        if (!$u) throw new \RuntimeException('user vanished');
        Session::login($u, $remember);
        self::$cached = $u;
        self::$loaded = true;
        Audit::log('login', (int) $u['id'], ['remember' => $remember]);
        return $u;
    }
}

final class Boot
{
    /** @var bool */
    private static $done = false;

    /** error handling: warnings become exceptions, nothing is ever displayed, fatals still answer in JSON */
    public static function forApi(): void
    {
        if (self::$done) return;
        self::$done = true;
        ob_start();
        set_error_handler(static function (int $no, string $msg, string $file = '', int $line = 0): bool {
            if (!(error_reporting() & $no)) return false;
            throw new \ErrorException($msg, 0, $no, $file, $line);
        });
        set_exception_handler(static function (\Throwable $e): void { Api::fail($e); });
        register_shutdown_function(static function (): void {
            $err = error_get_last();
            if ($err && in_array($err['type'], [E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR, E_USER_ERROR], true)) {
                Log::error('FATAL', $err['message'], ['at' => basename((string) $err['file']) . ':' . $err['line']]);
                while (ob_get_level() > 0) @ob_end_clean();
                if (!headers_sent()) {
                    http_response_code(500);
                    header('Content-Type: application/json; charset=utf-8');
                    header('X-Content-Type-Options: nosniff');
                }
                echo '{"success":false,"error":{"code":"SERVER_ERROR","message":"서버에서 문제가 생겼어요. 잠시 후 다시 시도해 주세요."}}';
            }
        });
    }
}
