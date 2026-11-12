<?php
/**
 * Security primitives: rate limiting (rate_limits), login throttling with exponential lockout
 * (login_attempts), audit log (audit_log), origin checks, privacy-preserving identifiers.
 * PHP 7.2 syntax only.
 */
declare(strict_types=1);

namespace Tfm;

if (!defined('TFM_BOOT')) { if (function_exists('header_remove')) header_remove('X-Powered-By'); http_response_code(404); exit; }

final class Sec
{
    /** keyed hash of an identifier (IP, login) — lets us throttle without storing raw values */
    public static function hashId(string $value): string
    {
        return substr(hash_hmac('sha256', $value, Config::secret('app_key')), 0, 32);
    }

    /**
     * Reject cross-site state-changing requests even if a CSRF token leaked:
     * Sec-Fetch-Site must not be cross-site, and Origin (when present) must match this host.
     */
    public static function checkOrigin(): void
    {
        if (!Config::get('security.check_origin', true)) return;
        $site = strtolower((string) (isset($_SERVER['HTTP_SEC_FETCH_SITE']) ? $_SERVER['HTTP_SEC_FETCH_SITE'] : ''));
        if ($site === 'cross-site') self::originFail('sec-fetch-site: ' . $site);
        $origin = (string) (isset($_SERVER['HTTP_ORIGIN']) ? $_SERVER['HTTP_ORIGIN'] : '');
        // F16: a missing Origin, or the literal 'null' (a sandboxed iframe, a file:// page, some privacy tools), carries no
        // host to compare — the CSRF token still has to be right, so these are left to that check, not accepted outright.
        // A present Origin must match this host AND the request's scheme (an http origin on an https request is cross-site).
        if ($origin === '' || $origin === 'null') return;
        $host = strtolower((string) (isset($_SERVER['HTTP_HOST']) ? $_SERVER['HTTP_HOST'] : ''));
        $o = parse_url($origin);
        if (!is_array($o) || !isset($o['host'])) self::originFail($origin);
        $oh = strtolower((string) $o['host'] . (isset($o['port']) ? ':' . $o['port'] : ''));
        $scheme = strtolower((string) (isset($o['scheme']) ? $o['scheme'] : ''));
        // the host (incl. port) must match; on an https request an http Origin is a downgrade attempt (cross-site).
        // On a plain-http install (local, certificate-less) either scheme is accepted so same-origin posts keep working.
        if ($host === '' || $oh !== $host || (Http::isHttps() && $scheme !== '' && $scheme !== 'https')) {
            self::originFail($origin);
        }
    }

    /** one place for the cross-site refusal: a security event (origin_mismatch, attack-like) + the generic 403 */
    private static function originFail(string $origin)
    {
        if (class_exists('Tfm\SecEvent')) SecEvent::log('origin_mismatch', 'warn', ['origin' => mb_substr($origin, 0, 120), 'path' => Http::scriptPath()]);
        Log::security('CSRF', 'origin mismatch', ['origin' => mb_substr($origin, 0, 120)]);
        throw new ApiException(403, 'CROSS_SITE_REQUEST', '허용되지 않은 요청이에요.');
    }
}

final class RateLimit
{
    /**
     * Sliding-window counter. Throws 429 RATE_LIMITED (+ Retry-After) when exceeded.
     * $ident: "u:<id>" for logged-in users, otherwise "ip:<hash>".
     *
     * The classic fixed window resets its count at each window boundary, so a burst that straddles the boundary (part in
     * window N, part in N+1) is never seen as one burst and the limit does not trip. We keep one counter per window as
     * before, but on each hit we also read the previous window and estimate the rate over the trailing full window as
     * `prev × (fraction of the previous window still inside the trailing window) + current`. We round that previous-window
     * contribution UP (ceil), so the estimate never drops below the real count — a burst of `limit + 1` that straddles a
     * boundary still trips (floor would shed the fraction and quietly allow one extra request in the rolling window).
     */
    public static function hit(string $name, string $ident, ?int $limit = null, ?int $window = null): void
    {
        $conf = Config::get("rate_limits.$name");
        if ($limit === null) $limit = (int) (is_array($conf) && isset($conf[0]) ? $conf[0] : 60);
        if ($window === null) $window = (int) (is_array($conf) && isset($conf[1]) ? $conf[1] : 60);
        if ($limit <= 0) return;
        $now = Clock::ms();
        $winLen = max(1, $window) * 1000;
        $curWin = intdiv($now, $winLen);
        $curBucket = substr($name . '|' . $ident . '|' . $curWin, 0, 190);
        $prevBucket = substr($name . '|' . $ident . '|' . ($curWin - 1), 0, 190);
        // keep the row two windows: the next window needs this one as its "previous" for the weighting
        $expires = ($curWin + 2) * $winLen;
        $res = Db::tx(function () use ($curBucket, $prevBucket, $expires) {
            if (Db::exec('UPDATE rate_limits SET hits = hits + 1 WHERE bucket = ?', [$curBucket]) === 0) {
                Db::exec(Db::driver() === 'mysql'
                    ? 'INSERT IGNORE INTO rate_limits (bucket, hits, expires_at) VALUES (?, 1, ?)'
                    : 'INSERT OR IGNORE INTO rate_limits (bucket, hits, expires_at) VALUES (?, 1, ?)', [$curBucket, $expires]);
            }
            return [
                (int) Db::value('SELECT hits FROM rate_limits WHERE bucket = ?', [$curBucket]),
                (int) Db::value('SELECT hits FROM rate_limits WHERE bucket = ?', [$prevBucket]),
            ];
        });
        $cur = $res[0];
        $prev = $res[1];
        $elapsed = $now - $curWin * $winLen;                 // ms into the current window
        $prevWeight = max(0.0, 1.0 - $elapsed / $winLen);    // how much of the previous window is still in the trailing window
        $estimate = (int) ceil($prev * $prevWeight) + $cur;
        if (random_int(1, 100) <= 2) self::cleanup();
        if ($estimate > $limit) {
            // wait until the current window ends (the previous window has fully aged out by then); a full window when
            // the current count alone is already over the limit
            $retry = $cur > $limit ? $window : max(1, (int) ceil((($curWin + 1) * $winLen - $now) / 1000));
            if ($estimate === $limit + 1) Log::security('RATE', "rate limit '$name' exceeded", ['ident' => substr($ident, 0, 40)]);
            throw new ApiException(429, 'RATE_LIMITED', '요청이 너무 많아요. 잠시 후 다시 시도해 주세요.', ['retryAfter' => $retry], ['Retry-After: ' . $retry]);
        }
    }

    /**
     * Per-request policy.
     *   by = 'ip'   : one bucket per IP (login / register: identities are what an attacker would rotate)
     *   by = 'auto' : one bucket per account (logged in) or per browser session (guests); guests additionally share a
     *                 generous per-IP aggregate (limit × rate_limit_ip_multiplier) so a classroom behind one NAT
     *                 address works while a cookie-dropping flood is still capped.
     */
    public static function forRequest(string $name, Ctx $ctx, string $by = 'auto'): void
    {
        $ipId = 'ip:' . Sec::hashId(Http::clientIp());
        if ($by === 'ip') { self::hit($name, $ipId); return; }
        $ident = $ctx->ident();
        self::hit($name, $ident);
        if ($ident !== $ipId && !$ctx->user) {
            $conf = Config::get("rate_limits.$name");
            $mult = max(1, (int) Config::get('rate_limit_ip_multiplier', 25));
            self::hit($name . '@ip', $ipId, (int) (is_array($conf) && isset($conf[0]) ? $conf[0] : 60) * $mult, (int) (is_array($conf) && isset($conf[1]) ? $conf[1] : 60));
        }
    }

    public static function cleanup(): void
    {
        try { Db::exec('DELETE FROM rate_limits WHERE expires_at < ?', [Clock::ms()]); } catch (\Throwable $e) { /* ignore */ }
    }
}

final class LoginThrottle
{
    /**
     * Exponential lockout:
     *   - same IP + same account: after max_failures failures within window → locked for base_lock × 2^(extra failures),
     *     capped at max_lock
     *   - one account from many IPs (distributed guessing): account_max failures → same exponential lock for everyone
     *   - one IP against many accounts (credential stuffing): ip_max_failures → IP locked for ip_lock seconds
     * Returns seconds to wait (0 = allowed).
     */
    public static function check(string $login): int
    {
        $c = (array) Config::get('login', []);
        $now = Clock::ms();
        $since = $now - (int) (isset($c['window']) ? $c['window'] : 900) * 1000;
        $ip = Sec::hashId(Http::clientIp());
        $acct = Sec::hashId('acct:' . mb_strtolower($login));
        $wait = 0;
        // per ip + account
        $rows = Db::all('SELECT created_at FROM login_attempts WHERE ip_hash = ? AND account_key = ? AND success = 0 AND created_at > ? ORDER BY created_at DESC LIMIT 40', [$ip, $acct, $since]);
        $wait = max($wait, self::lockFor(count($rows), isset($rows[0]['created_at']) ? $rows[0]['created_at'] : 0, (int) (isset($c['max_failures']) ? $c['max_failures'] : 5), $c, $now));
        // per account (any ip)
        $n = (int) Db::value('SELECT COUNT(*) FROM login_attempts WHERE account_key = ? AND success = 0 AND created_at > ?', [$acct, $since]);
        $accountMax = (int) (isset($c['account_max']) ? $c['account_max'] : 15);
        if ($n >= $accountMax) {
            $last = (int) Db::value('SELECT MAX(created_at) FROM login_attempts WHERE account_key = ? AND success = 0', [$acct]);
            $wait = max($wait, self::lockFor($n, $last, $accountMax, $c, $now));
        }
        // per ip (any account)
        $n = (int) Db::value('SELECT COUNT(*) FROM login_attempts WHERE ip_hash = ? AND success = 0 AND created_at > ?', [$ip, $since]);
        if ($n >= (int) (isset($c['ip_max_failures']) ? $c['ip_max_failures'] : 30)) {
            $last = (int) Db::value('SELECT MAX(created_at) FROM login_attempts WHERE ip_hash = ? AND success = 0', [$ip]);
            $wait = max($wait, (int) ceil(($last + (int) (isset($c['ip_lock']) ? $c['ip_lock'] : 900) * 1000 - $now) / 1000));
        }
        return max(0, $wait);
    }

    /** @param int|string $lastAt */
    private static function lockFor(int $failures, $lastAt, int $threshold, array $c, int $now): int
    {
        if ($failures < $threshold) return 0;
        $lock = min((int) (isset($c['max_lock']) ? $c['max_lock'] : 3600), (int) (isset($c['base_lock']) ? $c['base_lock'] : 30) * (2 ** min(16, $failures - $threshold)));
        return (int) ceil(((int) $lastAt + $lock * 1000 - $now) / 1000);
    }

    /** failures left before the next lock for this ip + account (for the "남은 시도" hint) */
    public static function remaining(string $login): int
    {
        $c = (array) Config::get('login', []);
        $since = Clock::ms() - (int) (isset($c['window']) ? $c['window'] : 900) * 1000;
        $n = (int) Db::value('SELECT COUNT(*) FROM login_attempts WHERE ip_hash = ? AND account_key = ? AND success = 0 AND created_at > ?', [Sec::hashId(Http::clientIp()), Sec::hashId('acct:' . mb_strtolower($login)), $since]);
        return max(0, (int) (isset($c['max_failures']) ? $c['max_failures'] : 5) - $n);
    }

    public static function record(string $login, bool $success): void
    {
        $acct = Sec::hashId('acct:' . mb_strtolower($login));
        $ip = Sec::hashId(Http::clientIp());
        Db::insert('login_attempts', ['ip_hash' => $ip, 'account_key' => $acct, 'success' => $success ? 1 : 0, 'created_at' => Clock::ms()]);
        if ($success) {
            // a successful login clears this ip+account's failure streak
            Db::exec('DELETE FROM login_attempts WHERE ip_hash = ? AND account_key = ? AND success = 0', [$ip, $acct]);
        }
        if (random_int(1, 100) <= 3) {
            $days = (int) Config::get('retention.login_attempts_days', 30);
            Db::exec('DELETE FROM login_attempts WHERE created_at < ?', [Clock::ms() - $days * 86400000]);
        }
    }
}

final class Audit
{
    /** security-relevant events (auth, admin actions, rejected saves, uploads, subscriptions). Never throws. */
    public static function log(string $event, ?int $userId = null, array $detail = [], string $severity = 'info', ?int $actorId = null): void
    {
        try {
            $json = json_encode($detail, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE | JSON_PARTIAL_OUTPUT_ON_ERROR);
            Db::insert('audit_log', [
                'created_at' => Clock::ms(),
                'user_id'    => $userId ?: null,
                'actor_id'   => $actorId ?: null,
                'ip'         => substr(Http::clientIp(), 0, 64),
                'event'      => substr($event, 0, 60),
                'severity'   => in_array($severity, ['info', 'warn', 'alert'], true) ? $severity : 'info',
                'detail'     => is_string($json) && $json !== '' ? $json : '{}',
            ]);
            if ($severity !== 'info') Log::security('AUDIT', $event, ['uid' => $userId] + $detail);
            if (random_int(1, 500) === 1) {
                $days = (int) Config::get('retention.audit_days', 180);
                Db::exec('DELETE FROM audit_log WHERE created_at < ?', [Clock::ms() - $days * 86400000]);
            }
        } catch (\Throwable $e) {
            Log::error('AUDIT', 'audit write failed: ' . $e->getMessage());
        }
    }
}
