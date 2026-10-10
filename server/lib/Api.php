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
 */
declare(strict_types=1);

namespace Tfm;

if (!defined('TFM_BOOT')) { http_response_code(404); exit; }

final class Ctx
{
    public ?array $user = null;
    public int $now;
    public bool $csrfPending = false;

    public function __construct() { $this->now = Clock::ms(); }

    public function uid(): int { return (int) ($this->user['id'] ?? 0); }
    public function isAdmin(): bool { return ($this->user['role'] ?? '') === 'admin'; }
    /** rate-limit identity: the account when logged in, else this browser session, else a keyed hash of the IP */
    public function ident(): string
    {
        if ($this->user) return 'u:' . $this->uid();
        $sid = Session::id();
        return $sid !== '' ? 's:' . Sec::hashId($sid) : 'ip:' . Sec::hashId(Http::clientIp());
    }
    public function json(int $max = 65536): array { return Http::json($max); }

    /** for navigator.sendBeacon requests that cannot set headers: the token travels in the JSON body */
    public function checkBodyCsrf(mixed $token): void
    {
        if (!$this->csrfPending) return;
        if (!Session::checkCsrf(is_string($token) ? $token : null)) Api::csrfFail();
        $this->csrfPending = false;
    }
}

final class Api
{
    public static function run(array $opt, callable $fn): never
    {
        Boot::forApi();
        try {
            $method = Http::method();
            $allowed = array_map('strtoupper', (array) ($opt['method'] ?? 'GET'));
            if (!in_array($method, $allowed, true)) {
                throw new ApiException(405, 'METHOD_NOT_ALLOWED', '허용되지 않은 요청 방식이에요.', null, ['Allow: ' . implode(', ', $allowed)]);
            }
            $ctx = new Ctx();
            $write = !in_array($method, ['GET', 'HEAD'], true);
            // only ping (and pages that must hand out a CSRF token) create sessions; everything else resumes one
            Session::start(($opt['session'] ?? 'resume') === 'create');
            if ($write) {
                Sec::checkOrigin();
                if (($opt['csrf'] ?? true) !== false) {
                    $hdr = $_SERVER['HTTP_X_CSRF_TOKEN'] ?? null;
                    if ($hdr === null && !empty($opt['csrfBody'])) $ctx->csrfPending = true;
                    elseif (!Session::checkCsrf(is_string($hdr) ? $hdr : null)) self::csrfFail();
                }
            }
            $ctx->user = Auth::current();
            if (!empty($opt['auth']) || !empty($opt['admin'])) {
                if (!$ctx->user) throw new ApiException(401, 'AUTH_REQUIRED', '로그인이 필요해요. 다시 로그인해 주세요.');
            }
            if (!empty($opt['admin']) && !$ctx->isAdmin()) {
                Audit::log('admin_denied', $ctx->uid(), ['path' => basename((string) ($_SERVER['SCRIPT_NAME'] ?? ''))], 'warn');
                throw new ApiException(403, 'FORBIDDEN', '관리자 권한이 필요해요.');
            }
            if (!empty($opt['rate'])) RateLimit::forRequest((string) $opt['rate'], $ctx, (string) ($opt['rateBy'] ?? 'auto'));
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

    public static function csrfFail(): never
    {
        Log::security('CSRF', 'csrf token missing or invalid', ['path' => basename((string) ($_SERVER['SCRIPT_NAME'] ?? ''))]);
        throw new ApiException(403, 'CSRF_INVALID', '보안 토큰이 만료되었어요. 다시 시도해 주세요.');
    }

    /** generic 500 — the reference id lets an admin find the details in data/logs */
    public static function fail(\Throwable $e): never
    {
        $ref = Log::requestId();
        Log::error('API', get_class($e) . ': ' . $e->getMessage(), [
            'at' => basename($e->getFile()) . ':' . $e->getLine(),
            'trace' => array_slice(array_map(fn ($f) => ($f['class'] ?? '') . ($f['type'] ?? '') . ($f['function'] ?? '') . '@' . basename($f['file'] ?? '?') . ':' . ($f['line'] ?? 0), $e->getTrace()), 0, 8),
            'path' => (string) ($_SERVER['SCRIPT_NAME'] ?? ''),
        ]);
        self::send(500, ['success' => false, 'error' => ['code' => 'SERVER_ERROR', 'message' => '서버에서 문제가 생겼어요. 잠시 후 다시 시도해 주세요.', 'ref' => $ref]]);
    }

    public static function send(int $status, array $payload, array $headers = []): never
    {
        while (ob_get_level() > 0) @ob_end_clean(); // never leak stray output (warnings, BOMs)
        try { $t = Session::currentCsrf(); if ($t !== null) $payload['csrf'] = $t; } catch (\Throwable) { /* ignore */ }
        $payload['serverTime'] = Clock::ms();
        $json = json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT | JSON_INVALID_UTF8_SUBSTITUTE | JSON_PARTIAL_OUTPUT_ON_ERROR);
        if ($json === false) { $status = 500; $json = '{"success":false,"error":{"code":"SERVER_ERROR","message":"응답을 만들지 못했어요."}}'; }
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
    private static ?array $cached = null;
    private static bool $loaded = false;

    /** the logged-in user, re-validated against the DB on every request (ban, epoch, role changes) */
    public static function current(): ?array
    {
        if (self::$loaded) return self::$cached;
        self::$loaded = true;
        $uid = Session::userId();
        if ($uid <= 0) return null;
        $u = Users::byId($uid);
        if (!$u || $u['status'] !== 'active' || (int) $u['session_epoch'] !== Session::epoch()) {
            Log::info('AUTH', 'session invalidated', ['uid' => $uid, 'why' => !$u ? 'deleted' : ($u['status'] !== 'active' ? 'banned' : 'epoch')]);
            Session::logout();
            return self::$cached = null;
        }
        return self::$cached = $u;
    }

    public static function forget(): void { self::$cached = null; self::$loaded = false; }

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
        if ($u['role'] !== 'admin' && Users::isConfiguredAdmin((string) $u['email'])) {
            $fields['role'] = 'admin';
            Audit::log('role_changed', (int) $u['id'], ['from' => 'user', 'to' => 'admin', 'via' => 'config admin_emails'], 'warn');
        }
        Users::update((int) $u['id'], $fields);
        $u = Users::byId((int) $u['id']) ?? throw new \RuntimeException('user vanished');
        Session::login($u, $remember);
        self::$cached = $u;
        self::$loaded = true;
        Audit::log('login', (int) $u['id'], ['remember' => $remember]);
        return $u;
    }
}

final class Boot
{
    private static bool $done = false;

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
