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
 *
 * Phase 8 (CONTRACT §16.9) — what a request costs before its handler runs:
 *   · the capacity gate first (Tfm\Gate: load figures, shedding with 503 + Retry-After when the server is overloaded);
 *   · 'session' => 'create' | 'resume' | 'read' | 'none' — GET / HEAD endpoints read the session without keeping its
 *     file locked ('read', the default for them); 'none' is for the sync endpoint's signed-token path;
 *   · the account row comes from the shared cache (cache.user_ttl seconds; dropped the moment the account changes);
 *   · 'gzip' => true — an endpoint with large answers (sync, player/get, chat/list, ranking) may send an answer of
 *     1 KB and more gzip-compressed when the browser accepts it. Such an answer carries no `csrf` field (a secret is
 *     never compressed together with text other people typed), so only endpoints whose callers do not depend on
 *     getting the token from that very answer ask for it; every other endpoint answers as it always did;
 *   · Api::after() runs work once the answer is out (write-behind, hourly housekeeping).
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
    /** @var callable[] work for after the answer was sent (Api::after) */
    private static $after = [];
    /** @var bool the running endpoint asked for compressed answers ('gzip' => true) */
    private static $gzipOk = false;

    /**
     * Run $fn after the answer of this request has gone out (the write-behind presence flush, hourly housekeeping).
     * It must not print anything; an error in it is logged and never reaches the visitor.
     */
    public static function after(callable $fn): void { self::$after[] = $fn; }

    public static function run(array $opt, callable $fn)
    {
        Boot::forApi();
        try {
            // CONTRACT §15.7 #5 / #2 / #10 / #14: the request-level guards run first, before the session, body or
            // credentials are touched — a blocked address, a plain-HTTP request or a stray file never gets that far.
            if (class_exists('Tfm\Firewall')) Firewall::check();        // #5  blocked address → 403 IP_BLOCKED
            if (class_exists('Tfm\Gate')) Gate::enter($opt);            // §16.9 load figures; an overloaded server sheds here (503 + Retry-After)
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
            // only ping (and pages that must hand out a CSRF token) create sessions; everything else resumes one.
            // §16.9: a GET / HEAD endpoint reads the session without holding its file ('read'); a changing call inside it
            // reopens the session by itself (Session::writable). 'none': the request is carried by a signed sync token.
            self::$gzipOk = !empty($opt['gzip']);
            $sessMode = (string) (isset($opt['session']) ? $opt['session'] : ($write ? 'resume' : 'read'));
            if ($sessMode !== 'none') Session::start($sessMode === 'create', $sessMode === 'read');
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
            Auth::$apiCache = true;                                     // §16.9: the account row may come from the shared cache
            $ctx->user = isset($opt['user']) && is_array($opt['user']) ? $opt['user'] : Auth::current();
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
            self::housekeeping();
            self::send(200, ['success' => true, 'data' => $data]);
        } catch (ApiException $e) {
            $payload = ['success' => false, 'error' => ['code' => $e->errorCode, 'message' => $e->getMessage()]];
            if ($e->data !== null) $payload['data'] = $e->data;
            // "come back in N seconds" (429 / 503 + Retry-After): the connection is not kept open for that long
            if (($e->status === 429 || $e->status === 503) && is_array($e->data) && isset($e->data['retryAfter'])) self::releaseConnection((int) $e->data['retryAfter'] * 1000);
            self::send($e->status, $payload, $e->headers);
        } catch (\Throwable $e) {
            self::fail($e);
        }
    }

    /**
     * CONTRACT §16.9: the answer tells the page when it calls next (sync: n, the waiting room: next, a refusal:
     * Retry-After; a save or a chat line: not soon). When that is capacity.close_after_ms (1000) or more away, the web
     * server is asked to close the connection after this answer instead of keeping it open. Apache with mod_php (XAMPP)
     * ties one worker — a thread or a process — to every open connection: with 150 workers the 151st visitor would wait
     * although the server is idle, because every visitor holds one for the whole KeepAliveTimeout between two calls.
     * With this a worker is busy only while it answers (measured: docs/SCALING-KO.md); the price is one TCP handshake
     * per call. Behind nginx or a CDN the header is theirs to decide and changes nothing. 0 = never ask.
     */
    public static function releaseConnection(int $nextMs): void
    {
        try {
            $min = (int) Config::get('capacity.close_after_ms', 1000);
            if ($min > 0 && $nextMs >= $min && PHP_SAPI !== 'cli' && !headers_sent()) header('Connection: close');
        } catch (\Throwable $e) { /* a hint to the web server only */ }
    }

    /**
     * §16.9: a request that came in on a signed sync token needs the full checks after all (the seat of the token is
     * gone). What run() does for a logged-in write request happens now: the session, its CSRF token, the account
     * (re-validated), the rate limit. The Origin check ran already.
     */
    public static function withSession(Ctx $ctx, string $rate): void
    {
        Session::start(false);
        if (!Session::started()) throw new ApiException(401, 'AUTH_REQUIRED', '로그인이 필요해요. 다시 로그인해 주세요.');
        $hdr = isset($_SERVER['HTTP_X_CSRF_TOKEN']) ? $_SERVER['HTTP_X_CSRF_TOKEN'] : null;
        if (!Session::checkCsrf(is_string($hdr) ? $hdr : null)) self::csrfFail();
        Auth::forget();
        Auth::$apiCache = true;
        $ctx->user = Auth::current();
        if (!$ctx->user) throw new ApiException(401, 'AUTH_REQUIRED', '로그인이 필요해요. 다시 로그인해 주세요.', Auth::$lostWhy !== null ? ['why' => Auth::$lostWhy] : null);
        RateLimit::forRequest($rate, $ctx);
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

    /**
     * Once an hour, after an answer: old session files and expired cache entries are removed (CONTRACT §16.9 — this
     * used to be a random request scanning the session folder while its visitor waited). `php cli/tfm.php cleanup`
     * does the same thoroughly; this keeps an installation without a scheduled job tidy.
     */
    private static function housekeeping(): void
    {
        try {
            if (class_exists('Tfm\Cache') && Cache::available()) {
                if (mt_rand(1, 40) !== 1 || !Cache::add('job:housekeeping', 1, 3600)) return;
            } elseif (mt_rand(1, 3000) !== 1) {
                return;
            }
            self::after(static function (): void {
                Session::gc(2.0);
                if (class_exists('Tfm\Cache')) Cache::purge(2.0);
                self::pageCopies();
            });
        } catch (\Throwable $e) { /* housekeeping never breaks a request */ }
    }

    /**
     * The precompressed copies of the page (CONTRACT §16.9: index.br.html / index.gz.html, written by tools/build.mjs
     * and served by .htaccess in place of index.html) must belong to the index.html next to them. data/page.json names
     * the page they were made from (bytes + SHA-1) and how long each copy is. A copy without that record, of another
     * page (index.html was replaced by hand) or of another length (an upload that broke off) is removed, and the plain
     * page is served again. Runs once an hour after a response (housekeeping) and in "php cli/tfm.php cleanup".
     * @return array{state:string,removed:int} state: none (no copies) | ok | stale (removed) | locked (could not remove)
     */
    public static function pageCopies(?string $dir = null): array
    {
        $root = ($dir === null ? TFM_ROOT : rtrim($dir, '/\\')) . DIRECTORY_SEPARATOR; // $dir: tests
        $found = [];
        foreach (['index.br.html', 'index.gz.html'] as $name) if (is_file($root . $name)) $found[] = $name;
        if (!$found) return ['state' => 'none', 'removed' => 0];
        $bad = $found;
        try {
            $info = null;
            foreach ($dir === null ? [$root . 'data', Config::dataDir()] : [$root . 'data'] as $d) {
                $file = $d . DIRECTORY_SEPARATOR . 'page.json';
                if (is_file($file)) { $info = json_decode((string) @file_get_contents($file), true); break; }
            }
            $page = $root . 'index.html';
            if (is_array($info) && isset($info['sha1'], $info['bytes']) && is_file($page) && (int) @filesize($page) === (int) $info['bytes']
                && hash_equals((string) $info['sha1'], (string) @sha1_file($page))) {
                $bad = [];
                foreach ($found as $name) {
                    $want = isset($info['copies'][$name]['bytes']) ? (int) $info['copies'][$name]['bytes'] : -1;
                    if ((int) @filesize($root . $name) !== $want) $bad[] = $name;
                }
            }
        } catch (\Throwable $e) { $bad = $found; }
        if (!$bad) return ['state' => 'ok', 'removed' => 0];
        $removed = 0;
        foreach ($bad as $name) if (@unlink($root . $name)) $removed++;
        try { Log::warn('STATIC', 'precompressed copies of the page did not belong to index.html', ['removed' => $removed, 'found' => count($bad)]); } catch (\Throwable $e) { /* log only */ }
        return ['state' => $removed === count($bad) ? 'stale' : 'locked', 'removed' => $removed];
    }

    /** did the browser say it reads gzip? */
    private static function acceptsGzip(): bool
    {
        $ae = (string) (isset($_SERVER['HTTP_ACCEPT_ENCODING']) ? $_SERVER['HTTP_ACCEPT_ENCODING'] : '');
        return $ae !== '' && (bool) preg_match('/(?:^|,)\s*(?:x-)?gzip\s*(?:;\s*q=(?!0(?:\.0+)?\s*(?:,|$))[0-9.]+\s*)?(?:,|$)/i', $ae);
    }

    public static function send(int $status, array $payload, array $headers = [])
    {
        while (ob_get_level() > 0) @ob_end_clean(); // never leak stray output (warnings, BOMs)
        $csrf = null;
        try { $csrf = Session::currentCsrf(); } catch (\Throwable $e) { /* ignore */ }
        unset($payload['csrf'], $payload['serverTime']);
        $json = json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT | JSON_INVALID_UTF8_SUBSTITUTE | JSON_PARTIAL_OUTPUT_ON_ERROR);
        if (!is_string($json) || $json === '' || $json[0] !== '{') { $status = 500; $json = '{"success":false,"error":{"code":"SERVER_ERROR","message":"응답을 만들지 못했어요."}}'; }
        // §16.9: an endpoint that asked for it ('gzip' => true) sends an answer of 1 KB or more gzip-compressed when the
        // browser reads gzip. The CSRF token is then left out of the body (the page keeps the token it has and gets a
        // new one with any other answer): a secret is never compressed together with text other people typed (BREACH).
        $gzip = false;
        try {
            $gzip = self::$gzipOk && strlen($json) >= 1024 && !headers_sent() && function_exists('gzencode') && self::acceptsGzip()
                && !ini_get('zlib.output_compression') && Config::get('capacity.gzip_json', true);
        } catch (\Throwable $e) { $gzip = false; }
        // the envelope ends with csrf (when a session exists) and serverTime, as before
        $tail = ',"serverTime":' . Clock::ms() . '}';
        $plain = substr($json, 0, -1) . ($csrf !== null && ctype_xdigit($csrf) ? ',"csrf":"' . $csrf . '"' : '') . $tail;
        if ($gzip) {
            $packed = @gzencode(substr($json, 0, -1) . $tail, 5);
            if (!is_string($packed) || strlen($packed) >= strlen($plain)) $gzip = false;
        }
        $json = $gzip ? $packed : $plain;
        if (!headers_sent()) {
            http_response_code($status);
            Http::securityHeaders('api');
            header('Content-Type: application/json; charset=utf-8');
            if ($gzip) { header('Content-Encoding: gzip'); header('Vary: Accept-Encoding', false); }
            foreach ($headers as $h) header($h);
            try {
                // capacity.stats_header (off by default; the load test turns it on): what this request cost
                if (Config::get('capacity.stats_header', false)) {
                    $d = class_exists('Tfm\Db', false) ? Db::stats() : ['statements' => 0, 'commits' => 0, 'connects' => 0];
                    $c = class_exists('Tfm\Cache', false) ? Cache::stats() : ['get' => 0, 'set' => 0];
                    $t0 = (float) (isset($_SERVER['REQUEST_TIME_FLOAT']) ? $_SERVER['REQUEST_TIME_FLOAT'] : microtime(true));
                    header(sprintf('X-Tfm-Stats: sql=%d;tx=%d;db=%d;cget=%d;cset=%d;ms=%.2f', $d['statements'], $d['commits'], $d['connects'], $c['get'], $c['set'], (microtime(true) - $t0) * 1000));
                }
            } catch (\Throwable $e) { /* figures only */ }
            if (self::$after) header('Content-Length: ' . strlen($json)); // the browser has the whole answer before the after-work starts
        }
        Session::close();
        echo $json;
        if (self::$after) self::runAfter();
        exit;
    }

    /** the answer is out: let the visitor go, then do the registered work */
    private static function runAfter(): void
    {
        $jobs = self::$after;
        self::$after = [];
        $count = false;
        $s0 = 0;
        try {
            $count = $jobs && Config::get('capacity.stats_header', false);
            if ($count && class_exists('Tfm\Db', false)) $s0 = Db::stats()['statements'];
        } catch (\Throwable $e) { $count = false; }
        try {
            @ignore_user_abort(true);
            if (function_exists('fastcgi_finish_request')) @fastcgi_finish_request(); else { @ob_flush(); @flush(); }
        } catch (\Throwable $e) { /* keep going */ }
        foreach ($jobs as $job) {
            try { $job(); } catch (\Throwable $e) { Log::error('API', 'after-work failed: ' . get_class($e) . ': ' . $e->getMessage()); }
        }
        // capacity.stats_header: what the after-work cost is not in the answer's header, so it is added up in the cache
        // ('php cli/tfm.php capacity --json' and tools/loadtest.mjs read it)
        try {
            if ($count && class_exists('Tfm\Cache', false)) {
                Cache::inc('st:after:n', 1, 86400);
                $d = class_exists('Tfm\Db', false) ? Db::stats()['statements'] - $s0 : 0;
                if ($d > 0) Cache::inc('st:after:sql', $d, 86400);
            }
        } catch (\Throwable $e) { /* figures only */ }
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
    /** @var bool set by Api::run: this request may take the account row from the shared cache (never the admin pages) */
    public static $apiCache = false;

    /**
     * The account row of an API request (CONTRACT §16.9): from the shared cache for cache.user_ttl seconds (15), else
     * from the database. The cached row never holds the password hash, and an API handler never gets one either.
     * Every change of an account goes through Users::update(), which calls forgetUser() — a ban, a role change, a new
     * password or "sign out everywhere" therefore reaches the very next request, not the end of the 15 seconds.
     */
    public static function userRow(int $uid): ?array
    {
        if ($uid <= 0) return null;
        $ttl = 0;
        try {
            $ttl = class_exists('Tfm\Cache') ? (int) Config::get('cache.user_ttl', 15) : 0;
            if ($ttl > 0) {
                $c = Cache::get('s:u:' . $uid);
                if (is_array($c) && isset($c['id'], $c['status'], $c['session_epoch']) && (int) $c['id'] === $uid) return $c;
            }
        } catch (\Throwable $e) { $ttl = 0; }
        $u = Users::byId($uid);
        if (!$u) return null;
        unset($u['password_hash']);
        if ($ttl > 0) { try { Cache::set('s:u:' . $uid, $u, $ttl); } catch (\Throwable $e) { /* read again next time */ } }
        return $u;
    }

    /**
     * The account changed (Users::update): drop its cached row; $revoke also ends its sync tokens at once (status,
     * role, password, a session-epoch bump).
     */
    public static function forgetUser(int $uid, bool $revoke = true): void
    {
        try { if (class_exists('Tfm\Cache')) Cache::del('s:u:' . $uid); } catch (\Throwable $e) { /* expires in seconds */ }
        try { if ($revoke && class_exists('Tfm\Sync')) Sync::revoke($uid); } catch (\Throwable $e) { /* the tokens run out by themselves */ }
        // the cached top list (lib/Ranking.php): a banned or renamed account leaves it / changes on it at once
        try { if ($revoke && class_exists('Tfm\Cache')) Cache::del('rank:top'); } catch (\Throwable $e) { /* renewed within a minute */ }
    }

    /** the logged-in user, re-validated on every request (ban, epoch, role changes — see userRow for the cache) */
    public static function current(): ?array
    {
        if (self::$loaded) return self::$cached;
        self::$loaded = true;
        $uid = Session::userId();
        if ($uid <= 0) return null;
        $u = self::$apiCache ? self::userRow($uid) : Users::byId($uid);
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
        // The requester-address lock-outs (ip+account, ip-across-accounts) run first: they only ever slow the abusive
        // address itself, so applying them before the password is verified is safe. The account-wide lock (one account
        // guessed from many addresses) is NOT applied here — it would let anyone deny a named account (or the admin)
        // sign-in; it is consulted only after a wrong password below, so the real owner's correct credential always
        // gets through (CONTRACT §15.7 #9).
        $wait = LoginThrottle::ipWait($login);
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
            // the account is under distributed guessing (many distinct addresses): slow further WRONG guesses. This is
            // reached only on a failed password, so it never refuses the owner's correct one from a clean address.
            $acctWait = LoginThrottle::accountWait($login);
            if ($acctWait > 0) {
                Audit::log('login_locked', $u ? (int) $u['id'] : null, ['wait' => $acctWait, 'scope' => 'account'], 'warn');
                if (class_exists('Tfm\SecEvent')) SecEvent::log('login_locked', 'warn', ['wait' => $acctWait, 'scope' => 'account']);
                throw new ApiException(429, 'TOO_MANY_ATTEMPTS', "이 계정에 로그인 시도가 너무 많아요. {$acctWait}초 후에 다시 시도해 주세요.", ['retryAfter' => $acctWait], ['Retry-After: ' . $acctWait]);
            }
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
