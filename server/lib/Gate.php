<?php
/**
 * Tfm\Gate — capacity control (CONTRACT §16.9). Everything here works on the shared cache only (no SQL), so it can
 * run before the heavy part of a request and on the light endpoints (api/sync.php, api/queue.php).
 *
 *   load figures   every request is counted (one in capacity.sample) → Gate::rps() requests per second,
 *                  Gate::load() = how far above capacity.target_rps (the sync endpoint stretches its `next` by it).
 *   shedding       above capacity.shed_rps an overloaded server answers 503 BUSY + Retry-After instead of queueing
 *                  work it cannot finish: first visitors without a session and new logins (tier 1), from twice that
 *                  rate also other read requests (tier 2). Saves, chat sends, payments, uploads, logout, the admin
 *                  endpoints and the sync calls of seated players are never shed.
 *   login meter    at most capacity.login_per_sec password checks per second (each costs a quarter of a CPU second):
 *                  the rest gets 503 LOGIN_BUSY + Retry-After and tries again by itself.
 *   seats          capacity.max_online players can be in the village at once. A seat is a place in a sync channel
 *                  (Tfm\Sync keeps the list); it is kept while the player's browser keeps calling and is freed
 *                  capacity.seat_ttl seconds after the last call. A seated player is never asked to leave.
 *   waiting room   when the house is full a newcomer gets 503 QUEUE with a signed ticket {pos, eta}. The waiting
 *                  browser calls GET api/queue.php?t=<ticket> (the only thing it calls); when its turn has come the
 *                  answer says go:true and the next sync call with the ticket is let in. Tickets are served in the
 *                  order they were issued; a ticket whose browser stopped asking loses its turn.
 *
 * Requests from the server machine itself (a loopback connection that is not a configured proxy) are never shed or
 * metered — the operator's own browser always gets through, and local test runs do not trip the limits. Seats count
 * for everyone; an admin account is always let in.
 * Sizing: docs/SCALING-KO.md. `php cli/tfm.php capacity` prints the live numbers.
 * PHP 7.2 syntax only.
 */
declare(strict_types=1);

namespace Tfm;

if (!defined('TFM_BOOT')) { if (function_exists('header_remove')) header_remove('X-Powered-By'); http_response_code(404); exit; }

final class Gate
{
    /** tickets within this many places of the front are watched (did their browser ask lately?) */
    private const WINDOW = 64;
    /** a ticket near the front whose browser did not ask for this long has left */
    private const DEAD_MS = 25000;
    /** a turn that has come is kept this long for its browser to enter */
    private const RESERVE_MS = 45000;
    /** a newcomer who was let in directly counts as "entering" this long (until its seat shows in the channel list) */
    private const ENTER_MS = 6000;

    /** @var float|null requests per second, read once per request */
    private static $rps = null;
    /** @var array|null */
    private static $conf = null;

    /** the capacity block with its defaults (one XAMPP-class machine; docs/SCALING-KO.md explains how to size it) */
    public static function conf(): array
    {
        if (self::$conf !== null) return self::$conf;
        $c = (array) Config::get('capacity', []);
        $n = static function (string $k, int $d) use ($c): int { return isset($c[$k]) && is_numeric($c[$k]) ? (int) $c[$k] : $d; };
        return self::$conf = [
            'max_online'    => max(0, $n('max_online', 300)),
            'target_rps'    => max(1, $n('target_rps', 150)),
            'shed_rps'      => max(0, $n('shed_rps', 400)),
            'login_per_sec' => max(0, $n('login_per_sec', 5)),
            'seat_ttl'      => max(30, $n('seat_ttl', 180)),
            'ticket_ttl'    => max(60, $n('ticket_ttl', 1800)),
            'sample'        => max(1, $n('sample', 4)),
        ];
    }

    /** tests: forget what was read for this request */
    public static function reset(): void { self::$rps = null; self::$conf = null; }

    private static function local(): bool
    {
        try { return Http::isLoopbackRequest(); } catch (\Throwable $e) { return false; }
    }

    // ------------------------------------------------------------------ load figures and shedding
    /**
     * First thing of every API request (Api::run): count it, meter logins, shed when the server is overloaded.
     * $opt['shed']: 0 = never, 1 = with the first wave, 2 = only at twice the shed rate (default: by endpoint).
     * @throws ApiException 503 BUSY / LOGIN_BUSY with Retry-After
     */
    public static function enter(array $opt = []): void
    {
        try {
            if (!Cache::available()) return;
            $c = self::conf();
            if ($c['sample'] === 1 || mt_rand(1, $c['sample']) === 1) Cache::hitWindow('g:rps', time(), 10);
            $script = Http::scriptPath();
            if ($script === 'api/auth/login.php' && Http::method() === 'POST') self::loginSlot();
            if ($c['shed_rps'] <= 0) return;
            $tier = isset($opt['shed']) ? (int) $opt['shed'] : self::tier($script);
            if ($tier <= 0 || self::rps() < $c['shed_rps'] * ($tier >= 2 ? 2 : 1) || self::local()) return;
        } catch (ApiException $e) {
            throw $e;
        } catch (\Throwable $e) {
            return; // the gate never breaks a request by itself
        }
        $wait = 2 + mt_rand(0, 4);
        throw new ApiException(503, 'BUSY', '지금 마을에 친구들이 많아요. 잠시 후에 다시 연결할게요.', ['retryAfter' => $wait], ['Retry-After: ' . $wait]);
    }

    /** which wave a request belongs to when the server sheds: 0 never, 1 first, 2 last */
    private static function tier(string $script): int
    {
        if (preg_match('#^api/(?:sub/|admin/|player/save\.php|auth/logout\.php|trap\.php|journal/|farm/report|chat/(?:send|report)\.php|allot/(?:apply|cancel|pay-|nameplate|waitlist|seen)|ai/)#', $script)) return 0;
        if ($script === 'api/auth/login.php' || $script === 'api/auth/register.php') return 1;
        $m = Http::method();
        if ($m !== 'GET' && $m !== 'HEAD') return 0;
        $name = (string) Config::get('session.name', 'TFMSESSID');
        return isset($_COOKIE[$name]) && is_string($_COOKIE[$name]) && $_COOKIE[$name] !== '' ? 2 : 1;
    }

    /** requests per second right now (the last whole second, or the running one when it is already busier) */
    public static function rps(): float
    {
        if (self::$rps !== null) return self::$rps;
        $r = Cache::peekWindow('g:rps', time());
        return self::$rps = (float) max($r[0], $r[1]) * self::conf()['sample'];
    }

    /** 1.0 while the server is below capacity.target_rps, else how many times above it (at most 20) */
    public static function load(): float
    {
        $c = self::conf();
        return max(1.0, min(20.0, self::rps() / $c['target_rps']));
    }

    /** a password check is about to run: more than login_per_sec in this second → 503 LOGIN_BUSY + Retry-After */
    public static function loginSlot(): void
    {
        $c = self::conf();
        if ($c['login_per_sec'] <= 0 || self::local()) return;
        $r = Cache::hitWindow('g:login', time(), 10);
        if (!is_array($r) || $r[0] <= $c['login_per_sec']) return;
        $wait = 1 + min(8, intdiv($r[0] - $c['login_per_sec'], max(1, $c['login_per_sec']))) + mt_rand(0, 2);
        throw new ApiException(503, 'LOGIN_BUSY', '지금 들어오려는 친구가 많아요. 잠시 후에 다시 해 볼게요.', ['retryAfter' => $wait], ['Retry-After: ' . $wait]);
    }

    // ------------------------------------------------------------------ seats and the waiting room
    /** players seated right now (members of the sync channels) */
    public static function seats(?int $now = null): int
    {
        try { return class_exists('Tfm\Sync') ? Sync::online($now) : 0; } catch (\Throwable $e) { return 0; }
    }

    private static function key(): string
    {
        return hash_hmac('sha256', 'tfm-gate-v1', Config::secret('app_key'), true);
    }

    private static function b64(string $bin): string { return rtrim(strtr(base64_encode($bin), '+/', '-_'), '='); }

    /** a signed ticket for place $seq in the line of account $uid */
    private static function sign(int $seq, int $uid, int $now): string
    {
        $c = self::conf();
        $body = self::b64((string) json_encode([$seq, intdiv($now, 1000), intdiv($now, 1000) + $c['ticket_ttl'], substr(hash_hmac('sha256', 'u' . $uid, self::key()), 0, 12)]));
        return 'q1.' . $body . '.' . self::b64(substr(hash_hmac('sha256', 'q1.' . $body, self::key(), true), 0, 16));
    }

    /** [seq, issued s, expires s, account mark] of a genuine, unexpired ticket, else null */
    private static function open($ticket, int $now): ?array
    {
        if (!is_string($ticket) || strlen($ticket) > 200 || !preg_match('/^q1\.([A-Za-z0-9_-]{10,120})\.([A-Za-z0-9_-]{22})$/', $ticket, $m)) return null;
        if (!hash_equals(self::b64(substr(hash_hmac('sha256', 'q1.' . $m[1], self::key(), true), 0, 16)), $m[2])) return null;
        $p = json_decode((string) base64_decode(strtr($m[1], '-_', '+/')), true);
        if (!is_array($p) || count($p) !== 4 || !is_int($p[0]) || !is_int($p[1]) || !is_int($p[2]) || !is_string($p[3])) return null;
        if ($p[2] * 1000 < $now || $p[0] < 1) return null;
        return $p;
    }

    private static function fresh(): array
    {
        return ['h' => 0, 't' => 0, 'adm' => [], 'alive' => [], 'late' => [], 'rate' => 0.0, 'rt' => 0, 'n' => 0];
    }

    /** bring a stored line up to date: forget turns that ran out, hand free seats to the next tickets in order */
    private static function advance(array $q, int $now, int $seats, int $max): array
    {
        foreach (['adm', 'alive', 'late'] as $k) if (!isset($q[$k]) || !is_array($q[$k])) $q[$k] = [];
        foreach ($q['adm'] as $k => $exp) if ((int) $exp <= $now) unset($q['adm'][$k]);
        foreach ($q['late'] as $k => $at) if ($now - (int) $at > self::DEAD_MS) unset($q['late'][$k]);
        $free = $max - $seats - count($q['adm']);
        $admitted = 0;
        // tickets whose turn passed while their browser was quiet, and that are back: first
        if ($free > 0 && $q['late']) {
            ksort($q['late'], SORT_NUMERIC);
            foreach (array_keys($q['late']) as $seq) {
                if ($free <= 0) break;
                $q['adm'][(string) $seq] = $now + self::RESERVE_MS;
                unset($q['late'][$seq]);
                $free--;
                $admitted++;
            }
        }
        while ($free > 0 && (int) $q['h'] < (int) $q['t']) {
            $cand = (int) $q['h'] + 1;
            $q['h'] = $cand;
            $last = isset($q['alive'][$cand]) ? (int) $q['alive'][$cand] : 0;
            unset($q['alive'][$cand]);
            if ($last > 0 && $now - $last <= self::DEAD_MS) {
                $q['adm'][(string) $cand] = $now + self::RESERVE_MS;
                $free--;
                $admitted++;
            }
            // else: nobody asked for this ticket lately — its turn passes (should it come back, it is served first)
        }
        foreach ($q['alive'] as $k => $at) if ((int) $k <= (int) $q['h']) unset($q['alive'][$k]);
        // how fast the line moves (people let in per second, smoothed) — for the "about N minutes" hint
        $rt = (int) (isset($q['rt']) ? $q['rt'] : 0);
        $q['n'] = (int) (isset($q['n']) ? $q['n'] : 0) + $admitted;
        if ($rt === 0) { $q['rt'] = $now; }
        elseif ($now - $rt >= 10000) {
            $inst = $q['n'] / (($now - $rt) / 1000);
            $q['rate'] = round((float) (isset($q['rate']) ? $q['rate'] : 0.0) * 0.6 + $inst * 0.4, 4);
            $q['rt'] = $now;
            $q['n'] = 0;
        }
        return $q;
    }

    /** the answer for a ticket that still waits */
    private static function waiting(array $q, int $seq, string $ticket): array
    {
        $pos = max(1, $seq - (int) $q['h']);
        $rate = (float) (isset($q['rate']) ? $q['rate'] : 0.0);
        return [
            't' => $ticket,
            'pos' => $pos,
            'eta' => $rate > 0.004 ? (int) min(3600, ceil($pos / $rate)) : 0,     // seconds; 0 = not known yet
            'next' => $pos <= 10 ? 3000 : ($pos <= 100 ? 5000 : 10000),          // ms until the next api/queue.php call
        ];
    }

    /**
     * A logged-in account wants a seat (the first sync call, or an old client's first presence call).
     * null = come in. Otherwise the waiting-room answer ['t' => ticket, 'pos', 'eta', 'next'] for a 503 QUEUE.
     * $ticket: the ticket the browser holds (a turn that has come is used up here).
     */
    public static function admit(int $uid, $ticket = null, bool $admin = false, ?int $now = null): ?array
    {
        $c = self::conf();
        if ($c['max_online'] <= 0 || $admin || !Cache::available()) return null;
        if ($now === null) $now = Clock::ms();
        $seats = self::seats($now);
        $mark = substr(hash_hmac('sha256', 'u' . $uid, self::key()), 0, 12);
        $t = self::open($ticket, $now);
        if ($t !== null && !hash_equals($t[3], $mark)) $t = null;         // somebody else's ticket
        $out = null;
        $max = $c['max_online'];
        $res = Cache::mutate('g:q', function ($q) use ($now, $seats, $max, $t, $uid, $ticket, &$out) {
            $q = self::advance(is_array($q) ? $q : self::fresh(), $now, $seats, $max);
            $me = 'u' . $uid;
            if ($t !== null && isset($q['adm'][(string) $t[0]])) {         // my turn has come: use it
                unset($q['adm'][(string) $t[0]]);
                $q['adm'][$me] = $now + self::ENTER_MS;
                return $q;
            }
            if (isset($q['adm'][$me])) return $q;                           // let in a moment ago (a second tab, a retry)
            $nobodyWaits = (int) $q['h'] >= (int) $q['t'] && !$q['late'];
            if ($nobodyWaits && $seats + count($q['adm']) < $max) {
                $q['adm'][$me] = $now + self::ENTER_MS;
                return $q;
            }
            if ($t !== null && $t[0] > (int) $q['h']) {                     // still in the line with a good ticket
                if ($t[0] - (int) $q['h'] <= 2 * self::WINDOW) $q['alive'][$t[0]] = $now;
                $out = self::waiting($q, $t[0], (string) $ticket);
                return $q;
            }
            if ($t !== null) {                                              // its turn passed while it was quiet
                $q['late'][$t[0]] = $now;
                $out = ['t' => (string) $ticket, 'pos' => 1, 'eta' => 0, 'next' => 3000];
                return $q;
            }
            $q['t'] = (int) $q['t'] + 1;                                    // a new place at the end of the line
            $seq = (int) $q['t'];
            if ($seq - (int) $q['h'] <= 2 * self::WINDOW) $q['alive'][$seq] = $now;
            $out = self::waiting($q, $seq, self::sign($seq, $uid, $now));
            return $q;
        }, 86400);
        if ($res === false) return null;      // the cache failed just now: nobody is kept outside because of it
        return $out;
    }

    /** the account's seat shows in the channel list now: its "entering" mark is no longer needed */
    public static function settled(int $uid): void
    {
        if (self::conf()['max_online'] <= 0 || !Cache::available()) return;
        Cache::mutate('g:q', static function ($q) use ($uid) {
            if (is_array($q) && isset($q['adm']['u' . $uid])) unset($q['adm']['u' . $uid]);
            return $q;
        }, 86400);
    }

    /**
     * GET api/queue.php?t=<ticket> — where does this ticket stand? ['go' => true] when its turn has come (the browser
     * then calls api/sync.php with the ticket), else ['go' => false, 'pos', 'eta', 'next'].
     * @throws ApiException 400 QUEUE_TICKET (not a ticket / expired: ask api/sync.php for a new one) · 429 (asked again
     *         within a second)
     */
    public static function poll($ticket, ?int $now = null): array
    {
        if ($now === null) $now = Clock::ms();
        $t = self::open($ticket, $now);
        if ($t === null) throw new ApiException(400, 'QUEUE_TICKET', '대기표가 올바르지 않거나 시간이 지났어요. 다시 줄을 설게요.');
        $c = self::conf();
        $seats = self::seats($now);
        $max = $c['max_online'];
        $out = ['go' => false];
        $tooFast = false;
        $seq = $t[0];
        $res = Cache::mutate('g:q', function ($q) use ($now, $seats, $max, $seq, $ticket, &$out, &$tooFast) {
            $q = is_array($q) ? $q : self::fresh();
            if (isset($q['alive'][$seq]) && $now - (int) $q['alive'][$seq] < 900) { $tooFast = true; return $q; }
            if ($seq > (int) $q['h'] && $seq - (int) $q['h'] <= 2 * self::WINDOW) $q['alive'][$seq] = $now;
            elseif ($seq <= (int) $q['h'] && !isset($q['adm'][(string) $seq])) $q['late'][$seq] = $now;
            $q = self::advance($q, $now, $seats, $max);
            if (isset($q['adm'][(string) $seq])) { $out = ['go' => true, 'pos' => 0, 'eta' => 0, 'next' => 0]; return $q; }
            if ($seq > (int) $q['t']) { $out = null; return $q; }           // a ticket from before the line was reset
            $w = $seq > (int) $q['h'] ? self::waiting($q, $seq, (string) $ticket) : ['pos' => 1, 'eta' => 0, 'next' => 3000];
            $out = ['go' => false, 'pos' => $w['pos'], 'eta' => $w['eta'], 'next' => $w['next']];
            return $q;
        }, 86400);
        if ($tooFast) throw new ApiException(429, 'RATE_LIMITED', '조금만 천천히 물어봐 주세요.', ['retryAfter' => 1], ['Retry-After: 1']);
        if ($res === false) return ['go' => true, 'pos' => 0, 'eta' => 0, 'next' => 0];   // no line can be kept: nobody waits
        if ($out === null) throw new ApiException(400, 'QUEUE_TICKET', '대기표가 올바르지 않거나 시간이 지났어요. 다시 줄을 설게요.');
        return $out;
    }

    /** the live numbers for `php cli/tfm.php capacity` and the admin health page */
    public static function status(): array
    {
        $c = self::conf();
        self::$rps = null;
        $q = Cache::get('g:q');
        $q = is_array($q) ? $q : self::fresh();
        $now = Clock::ms();
        $login = Cache::peekWindow('g:login', time());
        $adm = 0;
        foreach ((array) (isset($q['adm']) ? $q['adm'] : []) as $exp) if ((int) $exp > $now) $adm++;
        return [
            'cache' => Cache::driver(),
            'seats' => self::seats(),
            'maxOnline' => $c['max_online'],
            'entering' => $adm,
            'waiting' => max(0, (int) $q['t'] - (int) $q['h']) + count((array) (isset($q['late']) ? $q['late'] : [])),
            'ticketsIssued' => (int) $q['t'],
            'admitPerMinute' => round((float) (isset($q['rate']) ? $q['rate'] : 0) * 60, 1),
            'rps' => self::rps(),
            'targetRps' => $c['target_rps'],
            'shedRps' => $c['shed_rps'],
            'load' => round(self::load(), 2),
            'shedding' => $c['shed_rps'] > 0 && self::rps() >= $c['shed_rps'] ? (self::rps() >= 2 * $c['shed_rps'] ? 2 : 1) : 0,
            'loginsLastSecond' => max($login[0], $login[1]),
            'loginPerSec' => $c['login_per_sec'],
            'seatTtl' => $c['seat_ttl'],
        ];
    }
}
