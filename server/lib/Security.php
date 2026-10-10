<?php
/**
 * Security primitives: rate limiting (rate_limits), login throttling with exponential lockout
 * (login_attempts), audit log (audit_log), origin checks, privacy-preserving identifiers.
 */
declare(strict_types=1);

namespace Tfm;

if (!defined('TFM_BOOT')) { http_response_code(404); exit; }

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
        $site = strtolower((string) ($_SERVER['HTTP_SEC_FETCH_SITE'] ?? ''));
        if ($site === 'cross-site') throw new ApiException(403, 'CROSS_SITE_REQUEST', '허용되지 않은 요청이에요.');
        $origin = (string) ($_SERVER['HTTP_ORIGIN'] ?? '');
        if ($origin === '' || $origin === 'null') return;
        $host = strtolower((string) ($_SERVER['HTTP_HOST'] ?? ''));
        $o = parse_url($origin);
        $oh = strtolower(($o['host'] ?? '') . (isset($o['port']) ? ':' . $o['port'] : ''));
        if ($host === '' || $oh !== $host) {
            Log::security('CSRF', 'origin mismatch', ['origin' => mb_substr($origin, 0, 120)]);
            throw new ApiException(403, 'CROSS_SITE_REQUEST', '허용되지 않은 요청이에요.');
        }
    }
}

final class RateLimit
{
    /**
     * Fixed-window counter. Throws 429 RATE_LIMITED (+ Retry-After) when exceeded.
     * $ident: "u:<id>" for logged-in users, otherwise "ip:<hash>".
     */
    public static function hit(string $name, string $ident, ?int $limit = null, ?int $window = null): void
    {
        $conf = Config::get("rate_limits.$name");
        $limit ??= (int) ($conf[0] ?? 60);
        $window ??= (int) ($conf[1] ?? 60);
        if ($limit <= 0) return;
        $now = Clock::ms();
        $win = intdiv($now, $window * 1000);
        $bucket = substr($name . '|' . $ident . '|' . $win, 0, 190);
        $expires = ($win + 1) * $window * 1000;
        $hits = Db::tx(function () use ($bucket, $expires) {
            if (Db::exec('UPDATE rate_limits SET hits = hits + 1 WHERE bucket = ?', [$bucket]) === 0) {
                Db::exec(Db::driver() === 'mysql'
                    ? 'INSERT IGNORE INTO rate_limits (bucket, hits, expires_at) VALUES (?, 1, ?)'
                    : 'INSERT OR IGNORE INTO rate_limits (bucket, hits, expires_at) VALUES (?, 1, ?)', [$bucket, $expires]);
            }
            return (int) Db::value('SELECT hits FROM rate_limits WHERE bucket = ?', [$bucket]);
        });
        if (random_int(1, 100) <= 2) self::cleanup();
        if ($hits > $limit) {
            $retry = max(1, (int) ceil(($expires - $now) / 1000));
            if ($hits === $limit + 1) Log::security('RATE', "rate limit '$name' exceeded", ['ident' => substr($ident, 0, 40)]);
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
            self::hit($name . '@ip', $ipId, (int) ($conf[0] ?? 60) * $mult, (int) ($conf[1] ?? 60));
        }
    }

    public static function cleanup(): void
    {
        try { Db::exec('DELETE FROM rate_limits WHERE expires_at < ?', [Clock::ms()]); } catch (\Throwable) { /* ignore */ }
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
        $since = $now - (int) ($c['window'] ?? 900) * 1000;
        $ip = Sec::hashId(Http::clientIp());
        $acct = Sec::hashId('acct:' . mb_strtolower($login));
        $wait = 0;
        // per ip + account
        $rows = Db::all('SELECT created_at FROM login_attempts WHERE ip_hash = ? AND account_key = ? AND success = 0 AND created_at > ? ORDER BY created_at DESC LIMIT 40', [$ip, $acct, $since]);
        $wait = max($wait, self::lockFor(count($rows), $rows[0]['created_at'] ?? 0, (int) ($c['max_failures'] ?? 5), $c, $now));
        // per account (any ip)
        $n = (int) Db::value('SELECT COUNT(*) FROM login_attempts WHERE account_key = ? AND success = 0 AND created_at > ?', [$acct, $since]);
        if ($n >= (int) ($c['account_max'] ?? 15)) {
            $last = (int) Db::value('SELECT MAX(created_at) FROM login_attempts WHERE account_key = ? AND success = 0', [$acct]);
            $wait = max($wait, self::lockFor($n, $last, (int) ($c['account_max'] ?? 15), $c, $now));
        }
        // per ip (any account)
        $n = (int) Db::value('SELECT COUNT(*) FROM login_attempts WHERE ip_hash = ? AND success = 0 AND created_at > ?', [$ip, $since]);
        if ($n >= (int) ($c['ip_max_failures'] ?? 30)) {
            $last = (int) Db::value('SELECT MAX(created_at) FROM login_attempts WHERE ip_hash = ? AND success = 0', [$ip]);
            $wait = max($wait, (int) ceil(($last + (int) ($c['ip_lock'] ?? 900) * 1000 - $now) / 1000));
        }
        return max(0, $wait);
    }

    private static function lockFor(int $failures, int|string $lastAt, int $threshold, array $c, int $now): int
    {
        if ($failures < $threshold) return 0;
        $lock = min((int) ($c['max_lock'] ?? 3600), (int) ($c['base_lock'] ?? 30) * (2 ** min(16, $failures - $threshold)));
        return (int) ceil(((int) $lastAt + $lock * 1000 - $now) / 1000);
    }

    /** failures left before the next lock for this ip + account (for the "남은 시도" hint) */
    public static function remaining(string $login): int
    {
        $c = (array) Config::get('login', []);
        $since = Clock::ms() - (int) ($c['window'] ?? 900) * 1000;
        $n = (int) Db::value('SELECT COUNT(*) FROM login_attempts WHERE ip_hash = ? AND account_key = ? AND success = 0 AND created_at > ?', [Sec::hashId(Http::clientIp()), Sec::hashId('acct:' . mb_strtolower($login)), $since]);
        return max(0, (int) ($c['max_failures'] ?? 5) - $n);
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
    /** security-relevant events (auth, admin actions, rejected saves, uploads). Never throws. */
    public static function log(string $event, ?int $userId = null, array $detail = [], string $severity = 'info', ?int $actorId = null): void
    {
        try {
            Db::insert('audit_log', [
                'created_at' => Clock::ms(),
                'user_id'    => $userId ?: null,
                'actor_id'   => $actorId ?: null,
                'ip'         => substr(Http::clientIp(), 0, 64),
                'event'      => substr($event, 0, 60),
                'severity'   => in_array($severity, ['info', 'warn', 'alert'], true) ? $severity : 'info',
                'detail'     => json_encode($detail, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE | JSON_PARTIAL_OUTPUT_ON_ERROR) ?: '{}',
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
