<?php
/**
 * Suspicious activity: logged, watched and — when one address keeps attacking — blocked (CONTRACT §15.7 #5).
 *
 *   SecEvent::log(kind, severity, detail, userId)   one row in security_events (+ the file log); never throws
 *   SecEvent::recent(filter, limit, offset) / counts(sinceMs) / cleanup()        for the admin 🛡️ tab and the CLI
 *   Firewall::check()                               first thing in every entry point: a blocked address gets 403 IP_BLOCKED
 *   Firewall::guardPage()                           the same for server-rendered pages (+ HTTPS, no uploads): plain page, exit
 *   Firewall::block / unblock / isBlocked / listBlocks / ipInList / noteAttack
 *
 * Kinds: csrf_fail, origin_mismatch, admin_denied, admin_ip_denied, admin_2fa_fail, login_locked, probe_sqli, probe_xss,
 * probe_traversal, honeypot, payment_tamper, upload_rejected, save_rejected, https_required, ip_blocked, ai_abuse,
 * auto_block. Severity: info | warn | alert.
 *
 * Automatic block: ≥ security.block.threshold (25) attack-like events of severity warn / alert from one address within
 * security.block.window (600 s) → blocked for security.block.duration (1800 s), doubling per strike up to 24 h. The
 * server PC (loopback) and security.block.exempt entries are never blocked automatically. Ordinary rate limits, wrong
 * passwords and rejected saves have their own throttles and do not count; benign refusals are logged as 'info' (a stale
 * CSRF token after a session ran out, a photo of an unsupported type) so a classroom behind one address is not locked out.
 * PHP 7.2 syntax only.
 */
declare(strict_types=1);

namespace Tfm;

if (!defined('TFM_BOOT')) { if (function_exists('header_remove')) header_remove('X-Powered-By'); http_response_code(404); exit; }

final class SecEvent
{
    public const SEVERITIES = ['info', 'warn', 'alert'];
    /** kinds that count towards the automatic block (keep COUNT_SQL below in step — tests/security-unit.php checks it) */
    public const ATTACK_KINDS = ['csrf_fail', 'origin_mismatch', 'admin_denied', 'admin_ip_denied', 'admin_2fa_fail', 'probe_sqli',
        'probe_xss', 'probe_traversal', 'honeypot', 'payment_tamper', 'upload_rejected'];
    public const COUNT_SQL = "SELECT COUNT(*) FROM security_events WHERE ip_hash = ? AND created_at > ? AND severity IN ('warn', 'alert')"
        . " AND kind IN ('csrf_fail', 'origin_mismatch', 'admin_denied', 'admin_ip_denied', 'admin_2fa_fail', 'probe_sqli',"
        . " 'probe_xss', 'probe_traversal', 'honeypot', 'payment_tamper', 'upload_rejected')";
    /**
     * Attack kinds a third party can make a victim's own browser emit (a forced cross-site <img> / <form> / navigation
     * to this server): a honeypot bait URL, a cross-site write (origin_mismatch), or an injection string in a GET URL.
     * For these, a request the browser marks cross-site (Http::isCrossSiteRequest) is stored at 'info' — still logged
     * and visible to an admin, but non-counting — so it cannot drive the automatic IP block (CONTRACT §15.7 #5). A
     * direct attack (curl / a scanner, no Sec-Fetch-Site header) from the real source keeps its warn/alert severity
     * and still counts, so the auto-block still stops a genuine attacker.
     */
    public const FORCED_REACHABLE_KINDS = ['honeypot', 'origin_mismatch', 'probe_sqli', 'probe_xss', 'probe_traversal'];

    /** @var array kind => highest severity rank logged in this request (0 info, 1 warn, 2 alert) */
    private static $seen = [];

    /** tests: a new simulated request */
    public static function resetRequest(): void { self::$seen = []; }

    /** was an event of this kind (at least $severity) logged in this request? */
    public static function seen(string $kind, string $severity = 'info'): bool
    {
        $need = (int) array_search($severity, self::SEVERITIES, true);
        return isset(self::$seen[$kind]) && self::$seen[$kind] >= $need;
    }

    /** the client address in one spelling (IPv4-mapped IPv6 → IPv4); 'cli' on the command line */
    public static function ip(): string
    {
        $ip = Http::clientIp();
        $n = Http::normIp($ip);
        return $n !== '' ? $n : $ip;
    }

    /**
     * Record one event. $detail is small structured data chosen by the caller (stored as JSON with < > & ' " escaped,
     * so an admin page can never be handed raw markup). Never throws: a failing database only loses the row.
     */
    public static function log(string $kind, string $severity = 'warn', array $detail = [], ?int $userId = null): void
    {
        try {
            $kind = substr((string) preg_replace('/[^A-Za-z0-9_.:-]/', '', $kind), 0, 40);
            if ($kind === '') $kind = 'unknown';
            if (!in_array($severity, self::SEVERITIES, true)) $severity = 'warn';
            $intentRank = (int) array_search($severity, self::SEVERITIES, true);
            // a forced cross-site request (victim's browser, lured to an attacker page) must not drive the IP block:
            // keep the event but store it at 'info' (non-counting), the way a stale csrf_fail is already treated.
            if ($intentRank >= 1 && in_array($kind, self::FORCED_REACHABLE_KINDS, true) && Http::isCrossSiteRequest()) $severity = 'info';
            $rank = (int) array_search($severity, self::SEVERITIES, true);
            // remember the caller's intent (the un-downgraded rank), not the stored rank, so Firewall::noteAttack()
            // treats the attack as already recorded and never adds a second, counting row for the same request
            self::$seen[$kind] = max(isset(self::$seen[$kind]) ? self::$seen[$kind] : 0, $intentRank);
            $ip = self::ip();
            $hash = Sec::hashId($ip);
            $now = Clock::ms();
            $path = Http::scriptPath();
            if ($userId === null) {
                try { $uid = Session::userId(); if ($uid > 0) $userId = $uid; } catch (\Throwable $e) { /* no session */ }
            }
            $stored = false;
            try {
                $cap = (int) Config::get('security.events_per_minute', 120);
                $recent = $cap > 0 ? (int) Db::value('SELECT COUNT(*) FROM security_events WHERE ip_hash = ? AND created_at > ?', [$hash, $now - 60000]) : 0;
                if ($cap > 0 && $recent >= $cap) {
                    if ($recent === $cap) Log::security('SEC', 'event flood: further events from this address are not stored for a minute', ['kind' => $kind]);
                    return;
                }
                Db::insert('security_events', [
                    'created_at' => $now,
                    'ip'         => substr($ip, 0, 64),
                    'ip_hash'    => $hash,
                    'user_id'    => $userId ?: null,
                    'kind'       => $kind,
                    'severity'   => $severity,
                    'path'       => substr($path, 0, 190),
                    'detail'     => self::encode($detail),
                ]);
                $stored = true;
            } catch (\Throwable $e) {
                Log::error('SEC', 'security event not stored: ' . get_class($e));
            }
            Log::security('SEC', $kind, ['sev' => $severity, 'uid' => $userId, 'path' => $path] + self::brief($detail));
            if (!$stored) return;
            if ($rank >= 1 && in_array($kind, self::ATTACK_KINDS, true)) Firewall::evaluate($ip, $hash, $now);
            if ($severity === 'alert') self::alert($kind, $ip, $path, $now);
            if (random_int(1, 400) === 1) self::cleanup();
        } catch (\Throwable $e) {
            @error_log('[tfm] security event failed: ' . get_class($e));
        }
    }

    /** scalars only, short — what goes into the one-line file log */
    private static function brief(array $detail): array
    {
        $out = [];
        foreach ($detail as $k => $v) {
            if (count($out) >= 8) break;
            if (is_string($v)) $out[(string) $k] = mb_substr(mb_check_encoding($v, 'UTF-8') ? $v : '(binary)', 0, 120);
            elseif (is_int($v) || is_float($v) || is_bool($v)) $out[(string) $k] = $v;
        }
        return $out;
    }

    /** bounded JSON (≤ 2000 bytes) with markup characters escaped */
    private static function encode(array $detail): string
    {
        $flags = JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT | JSON_INVALID_UTF8_SUBSTITUTE | JSON_PARTIAL_OUTPUT_ON_ERROR;
        $json = json_encode(self::trim($detail, 0), $flags);
        if (!is_string($json) || $json === '' || $json === 'null' || $json === '[]') return '{}';
        if (strlen($json) > 2000) $json = (string) json_encode(['truncated' => true, 'keys' => array_slice(array_map('strval', array_keys($detail)), 0, 20)], $flags);
        return $json;
    }

    private static function trim($v, int $depth)
    {
        if (is_string($v)) return mb_strlen($v) > 300 ? mb_substr($v, 0, 300) . '…' : $v;
        if (is_array($v)) {
            if ($depth >= 3) return '…';
            $out = [];
            foreach ($v as $k => $x) {
                if (count($out) >= 20) break;
                $out[is_int($k) ? $k : mb_substr((string) $k, 0, 40)] = self::trim($x, $depth + 1);
            }
            return $out;
        }
        if (is_int($v) || is_float($v) || is_bool($v) || $v === null) return $v;
        return '(' . gettype($v) . ')';
    }

    /**
     * Newest first. $filter keys: kind, severity, ipHash, sinceMs. Each row: id, created_at (ms), ip, ip_hash, user_id,
     * kind, severity, path, detail (the stored JSON text) and detailData (the same decoded — escape it when printing).
     */
    public static function recent(array $filter, int $limit = 100, int $offset = 0): array
    {
        $kind = isset($filter['kind']) && is_string($filter['kind']) ? substr($filter['kind'], 0, 40) : '';
        $sev = isset($filter['severity']) && is_string($filter['severity']) && in_array($filter['severity'], self::SEVERITIES, true) ? $filter['severity'] : '';
        $hash = isset($filter['ipHash']) && is_string($filter['ipHash']) ? substr($filter['ipHash'], 0, 32) : '';
        $since = isset($filter['sinceMs']) && (is_int($filter['sinceMs']) || is_float($filter['sinceMs'])) ? (int) $filter['sinceMs'] : 0;
        $rows = Db::all(
            "SELECT id, created_at, ip, ip_hash, user_id, kind, severity, path, detail FROM security_events
              WHERE (? = '' OR kind = ?) AND (? = '' OR severity = ?) AND (? = '' OR ip_hash = ?) AND created_at >= ?
              ORDER BY id DESC LIMIT ? OFFSET ?",
            [$kind, $kind, $sev, $sev, $hash, $hash, $since, max(1, min(500, $limit)), max(0, $offset)]
        );
        foreach ($rows as &$r) {
            $r['id'] = (int) $r['id'];
            $r['created_at'] = (int) $r['created_at'];
            $r['user_id'] = $r['user_id'] === null ? null : (int) $r['user_id'];
            $d = Json::tryDecode((string) $r['detail'], true);
            $r['detailData'] = is_array($d) ? $d : [];
        }
        unset($r);
        return $rows;
    }

    /** [kind => number of events] since $sinceMs, most frequent first */
    public static function counts(int $sinceMs): array
    {
        $out = [];
        foreach (Db::all('SELECT kind, COUNT(*) AS n FROM security_events WHERE created_at >= ? GROUP BY kind ORDER BY n DESC, kind ASC', [$sinceMs]) as $r) {
            $out[(string) $r['kind']] = (int) $r['n'];
        }
        return $out;
    }

    /** retention: events older than security.events_days (90) and blocks that ended more than 30 days ago; returns the events removed */
    public static function cleanup(): int
    {
        try {
            $days = max(1, (int) Config::get('security.events_days', 90));
            $now = Clock::ms();
            $n = Db::exec('DELETE FROM security_events WHERE created_at < ?', [$now - $days * 86400000]);
            Db::exec('DELETE FROM ip_blocks WHERE until_at < ?', [$now - 30 * 86400000]);
            return $n;
        } catch (\Throwable $e) {
            return 0;
        }
    }

    // ------------------------------------------------------------------ optional alerts (off by default)

    /**
     * Where alerts go: ONLY from the configuration (security.alert_email / security.alert_webhook), validated —
     * an address with line breaks or a webhook that is not https is dropped. $cfg is for tests.
     */
    public static function alertTargets(?array $cfg = null): array
    {
        if ($cfg === null) $cfg = (array) Config::get('security', []);
        $email = isset($cfg['alert_email']) && is_string($cfg['alert_email']) ? trim($cfg['alert_email']) : '';
        if ($email !== '' && (strlen($email) > 190 || preg_match('/[\r\n\0,;<>]/', $email) || !filter_var($email, FILTER_VALIDATE_EMAIL))) $email = '';
        $hook = isset($cfg['alert_webhook']) && is_string($cfg['alert_webhook']) ? trim($cfg['alert_webhook']) : '';
        if ($hook !== '') {
            $u = parse_url($hook);
            $ok = is_array($u) && isset($u['scheme'], $u['host']) && strtolower((string) $u['scheme']) === 'https' && !isset($u['user']) && !isset($u['pass'])
                && strlen($hook) <= 400 && !preg_match('/[\s\x00-\x1f]/', $hook);
            if (!$ok) $hook = '';
        }
        return ['email' => $email, 'webhook' => $hook];
    }

    /** one message per kind per security.alert_interval; the text holds server-side facts only (kind, time, address, script) */
    private static function alert(string $kind, string $ip, string $path, int $now): void
    {
        try {
            $t = self::alertTargets();
            if ($t['email'] === '' && $t['webhook'] === '') return;
            try { RateLimit::hit('secalert:' . $kind, 'all', 1, max(60, (int) Config::get('security.alert_interval', 600))); }
            catch (ApiException $e) { return; } // already sent in this interval
            $app = (string) Config::get('app.name', TFM_APP);
            $when = date('Y-m-d H:i:s', intdiv($now, 1000));
            if ($t['email'] !== '' && function_exists('mail')) {
                $subject = '[' . $app . '] 보안 알림: ' . $kind;
                $body = "보안 알림이에요.\n\n종류: {$kind}\n시각: {$when}\n주소: {$ip}\n위치: {$path}\n\n관리자 화면의 보안 탭에서 자세히 볼 수 있어요.\n";
                $subj = function_exists('mb_encode_mimeheader') ? mb_encode_mimeheader($subject, 'UTF-8', 'B') : $subject;
                @mail($t['email'], $subj, $body, "MIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: 8bit");
            }
            if ($t['webhook'] !== '' && function_exists('curl_init')) {
                $ch = curl_init($t['webhook']);
                if ($ch) {
                    $opts = [
                        CURLOPT_POST => true,
                        CURLOPT_POSTFIELDS => (string) json_encode(['app' => TFM_APP, 'kind' => $kind, 'at' => $now, 'time' => $when, 'ip' => $ip, 'path' => $path]),
                        CURLOPT_HTTPHEADER => ['Content-Type: application/json'],
                        CURLOPT_RETURNTRANSFER => true,
                        CURLOPT_FOLLOWLOCATION => false,
                        CURLOPT_CONNECTTIMEOUT => 2,
                        CURLOPT_TIMEOUT => 3,
                        CURLOPT_SSL_VERIFYPEER => true,
                        CURLOPT_SSL_VERIFYHOST => 2,
                    ];
                    if (defined('CURLOPT_PROTOCOLS') && defined('CURLPROTO_HTTPS')) $opts[CURLOPT_PROTOCOLS] = CURLPROTO_HTTPS;
                    curl_setopt_array($ch, $opts);
                    @curl_exec($ch);
                    $ch = null;
                }
            }
            Log::info('SEC', 'alert sent', ['kind' => $kind, 'email' => $t['email'] !== '', 'webhook' => $t['webhook'] !== '']);
        } catch (\Throwable $e) {
            Log::error('SEC', 'alert failed: ' . get_class($e));
        }
    }
}

final class Firewall
{
    /** the longest automatic block (24 h) */
    private const MAX_AUTO = 86400;

    /** the active ip_blocks row for an address, or null (also when the table cannot be read: the firewall fails open) */
    private static function active(string $ip): ?array
    {
        $n = Http::normIp($ip);
        if ($n === '') return null;
        $hash = Sec::hashId($n);
        // [scale-server] CONTRACT §16.9: the addresses that are blocked right now (normally none) are remembered as one
        // short list for cache.block_ttl seconds (15): an ordinary request asks the database nothing here, and the whole
        // server asks once per 15 s instead of once per visitor. An address on the list is still read fresh (its hit
        // counter and its end), and block() / evaluate() / unblock() drop the list, so a new block works at once. With
        // more than 500 live blocks no list is kept and "not blocked" is remembered per address instead.
        $ttl = 0;
        try {
            $ttl = class_exists('Tfm\\Cache') ? (int) Config::get('cache.block_ttl', 15) : 0;
            if ($ttl > 0) {
                $list = Cache::get('s:ipb:live');
                if (!is_array($list) || !isset($list['n'], $list['h']) || !is_array($list['h'])) {
                    $rows = Db::all('SELECT ip_hash, until_at FROM ip_blocks WHERE until_at > ? LIMIT 501', [Clock::ms()]);
                    $list = ['n' => count($rows), 'h' => []];
                    if ($list['n'] <= 500) foreach ($rows as $r) $list['h'][(string) $r['ip_hash']] = (int) $r['until_at'];
                    Cache::set('s:ipb:live', $list, $ttl);
                }
                if ((int) $list['n'] <= 500) {
                    if (!isset($list['h'][$hash]) || (int) $list['h'][$hash] <= Clock::ms()) return null;
                    $ttl = 0; // on the list: read fresh below, remember nothing
                } elseif (Cache::get('s:ipb:' . $hash) === 0) return null;
            }
        } catch (\Throwable $e) { $ttl = 0; }
        try {
            $row = Db::one('SELECT ip_hash, ip, reason, until_at, created_at, created_by, hits, strikes FROM ip_blocks WHERE ip_hash = ?', [$hash]);
        } catch (\Throwable $e) {
            return null;
        }
        $live = $row && (int) $row['until_at'] > Clock::ms() ? $row : null;
        if ($live === null && $ttl > 0) { try { Cache::set('s:ipb:' . $hash, 0, $ttl); } catch (\Throwable $e) { /* asked again next time */ } }
        return $live;
    }

    /** [scale-server] a block was written or lifted for this address: forget the remembered list and "not blocked" */
    private static function forget(string $hash): void
    {
        try { if (class_exists('Tfm\\Cache')) { Cache::del('s:ipb:live'); Cache::del('s:ipb:' . $hash); } } catch (\Throwable $e) { /* expires in seconds */ }
    }

    /**
     * First thing in every entry point (Api::run calls it; pages call guardPage()). A blocked address gets
     * ApiException 403 IP_BLOCKED (+ Retry-After). Hits are counted; the event log gets one line at the 1st, 10th,
     * 100th … hit instead of one per request.
     */
    public static function check(): void
    {
        if (PHP_SAPI === 'cli' && !isset($_SERVER['REMOTE_ADDR'])) return;
        $row = self::active(SecEvent::ip());
        if ($row === null) return;
        $secs = max(1, (int) ceil(((int) $row['until_at'] - Clock::ms()) / 1000));
        try {
            Db::exec('UPDATE ip_blocks SET hits = hits + 1 WHERE ip_hash = ?', [(string) $row['ip_hash']]);
            $hits = (int) $row['hits'] + 1;
            if (in_array($hits, [1, 10, 100, 1000, 10000, 100000], true)) SecEvent::log('ip_blocked', 'info', ['hits' => $hits, 'until' => (int) $row['until_at']]);
        } catch (\Throwable $e) { /* counting is best effort */ }
        throw new ApiException(403, 'IP_BLOCKED', '이 인터넷 주소에서는 잠시 접속할 수 없어요. 조금 뒤에 다시 시도해 주세요.', ['retryAfter' => $secs], ['Retry-After: ' . $secs]);
    }

    /**
     * For server-rendered pages (admin, install, payment return): one line at the top of the script.
     * A blocked address, plain HTTP where HTTPS is required, or a file upload gets a small plain page and the script ends.
     */
    public static function guardPage(): void
    {
        try {
            self::check();
            Http::enforceHttps();
            Http::refuseUpload(false);
        } catch (ApiException $e) {
            Http::plainPage($e->status, $e->getMessage(), $e->headers);
        }
    }

    public static function isBlocked(?string $ip = null): bool
    {
        return self::active($ip === null ? SecEvent::ip() : $ip) !== null;
    }

    /** block an address for $seconds (admin 🛡️ tab, cli ip:block). An invalid address or duration is 400 INVALID_INPUT. */
    public static function block(string $ip, int $seconds, string $reason, ?int $actorId = null): void
    {
        $n = Http::normIp(trim($ip));
        if ($n === '') V::fail('ip', '값이 인터넷 주소(IP) 모양이 아니에요.');
        if ($seconds < 1 || $seconds > 366 * 86400) V::fail('seconds', '값은 1초부터 366일 사이여야 해요.');
        $reason = mb_substr(Users::cleanText($reason, 120), 0, 120);
        $now = Clock::ms();
        $hash = Sec::hashId($n);
        $old = Db::one('SELECT strikes FROM ip_blocks WHERE ip_hash = ?', [$hash]);
        Db::upsert('ip_blocks', [
            'ip_hash' => $hash, 'ip' => $n, 'reason' => $reason, 'until_at' => $now + $seconds * 1000, 'created_at' => $now,
            'created_by' => $actorId ?: null, 'hits' => 0, 'strikes' => $old ? max(1, (int) $old['strikes']) : 1,
        ], ['ip_hash']); // strikes are remembered: an automatic block after a manual one still doubles
        self::forget($hash); // [scale-server]
        Audit::log('ip_blocked', null, ['ip' => $n, 'seconds' => $seconds, 'reason' => $reason], 'warn', $actorId);
    }

    /** lift a block by address or by ip_hash (32 hex); false when there was none */
    public static function unblock(string $ipOrHash, ?int $actorId = null): bool
    {
        $v = trim($ipOrHash);
        if (preg_match('/^[0-9a-f]{32}$/', $v)) $hash = $v;
        else {
            $n = Http::normIp($v);
            if ($n === '') return false;
            $hash = Sec::hashId($n);
        }
        $now = Clock::ms();
        $row = Db::one('SELECT ip FROM ip_blocks WHERE ip_hash = ? AND until_at > ?', [$hash, $now]);
        if (!$row) return false;
        // the row stays (ended now, strikes forgiven): what led to this block is not counted again after the release
        Db::exec('UPDATE ip_blocks SET until_at = ?, strikes = 0 WHERE ip_hash = ?', [$now, $hash]);
        self::forget($hash); // [scale-server]
        Audit::log('ip_unblocked', null, ['ip' => (string) $row['ip']], 'warn', $actorId);
        return true;
    }

    /** blocks that are active now (newest end first): ip_hash, ip, reason, until_at, created_at, created_by, hits, strikes */
    public static function listBlocks(bool $includeExpired = false): array
    {
        $rows = Db::all('SELECT ip_hash, ip, reason, until_at, created_at, created_by, hits, strikes FROM ip_blocks WHERE until_at > ? ORDER BY until_at DESC LIMIT 500',
            [$includeExpired ? 0 : Clock::ms()]);
        foreach ($rows as &$r) {
            foreach (['until_at', 'created_at', 'hits', 'strikes'] as $k) $r[$k] = (int) $r[$k];
            $r['created_by'] = $r['created_by'] === null ? null : (int) $r['created_by'];
        }
        unset($r);
        return $rows;
    }

    /** single addresses and CIDR ranges, IPv4 + IPv6 (the admin allow-list, trusted proxies and the exempt list use it) */
    public static function ipInList(string $ip, array $cidrs): bool
    {
        return Http::ipInList($ip, $cidrs);
    }

    /**
     * An attack-like thing happened in this request (see SecEvent::ATTACK_KINDS). When the caller did not log an event
     * of that kind itself, one is recorded here, so calling this after SecEvent::log() — or instead of it — both give
     * exactly one row and one evaluation of the automatic block. Other kinds are ignored. Never throws.
     */
    public static function noteAttack(string $kind): void
    {
        try {
            if (!in_array($kind, SecEvent::ATTACK_KINDS, true)) return;
            if (!SecEvent::seen($kind, 'warn')) SecEvent::log($kind, 'warn', ['via' => 'noteAttack']);
        } catch (\Throwable $e) { /* never breaks a request */ }
    }

    /** called by SecEvent::log() after an attack-like event was stored: block the address when the window is full */
    public static function evaluate(string $ip, string $hash, int $now): void
    {
        try {
            $cfg = (array) Config::get('security.block', []);
            $threshold = (int) (isset($cfg['threshold']) ? $cfg['threshold'] : 25);
            if ($threshold <= 0 || Http::normIp($ip) === '') return;
            if (Http::isLoopbackIp($ip)) return; // the server PC (also: everyone, when a local proxy is not configured as trusted)
            $exempt = isset($cfg['exempt']) && is_array($cfg['exempt']) ? $cfg['exempt'] : [];
            if ($exempt && Http::ipInList($ip, $exempt)) return;
            $window = max(10, (int) (isset($cfg['window']) ? $cfg['window'] : 600));
            $duration = max(10, (int) (isset($cfg['duration']) ? $cfg['duration'] : 1800));
            $old = Db::one('SELECT until_at, strikes FROM ip_blocks WHERE ip_hash = ?', [$hash]);
            if ($old && (int) $old['until_at'] > $now) return; // already blocked
            // only what happened after the previous block ended (or was lifted) counts: nothing is counted twice
            $since = max($now - $window * 1000, $old ? (int) $old['until_at'] - 1 : 0);
            $n = (int) Db::value(SecEvent::COUNT_SQL, [$hash, $since]);
            if ($n < $threshold) return;
            $strikes = $old ? max(0, (int) $old['strikes']) + 1 : 1;
            $secs = (int) min(self::MAX_AUTO, $duration * (2 ** min(16, $strikes - 1)));
            Db::upsert('ip_blocks', [
                'ip_hash' => $hash, 'ip' => substr($ip, 0, 64), 'reason' => "자동 차단: {$window}초 안에 수상한 요청 {$n}번", 'until_at' => $now + $secs * 1000,
                'created_at' => $now, 'created_by' => null, 'hits' => 0, 'strikes' => $strikes,
            ], ['ip_hash']);
            self::forget($hash); // [scale-server]
            Audit::log('ip_auto_blocked', null, ['ip' => $ip, 'events' => $n, 'seconds' => $secs, 'strikes' => $strikes], 'alert');
            SecEvent::log('auto_block', 'alert', ['events' => $n, 'seconds' => $secs, 'strikes' => $strikes]);
        } catch (\Throwable $e) {
            Log::error('SEC', 'auto-block failed: ' . get_class($e));
        }
    }
}
