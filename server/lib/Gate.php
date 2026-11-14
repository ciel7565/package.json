<?php
/**
 * Tfm\Gate — capacity control (CONTRACT §16.9). Everything here works on the shared cache only (no SQL), so it can
 * run before the heavy part of a request and on the light endpoints (api/sync.php, api/queue.php).
 *
 *   load figures   every request that was served is counted (one in capacity.sample; Gate::count, called by Api::run
 *                  after the handler) → Gate::rps() requests per second, Gate::load() = how far above
 *                  capacity.target_rps (the sync endpoint stretches its `next` by it). A request that was refused —
 *                  over a rate limit, without a login, shed — is not load: one address answered 429 four hundred
 *                  times a second must not close the door for everybody else.
 *   shedding       above capacity.shed_rps an overloaded server answers 503 BUSY + Retry-After instead of queueing
 *                  work it cannot finish: first visitors without a session and new logins (tier 1), from twice that
 *                  rate also other read requests (tier 2). Saves, chat sends, payments, uploads, logout, the admin
 *                  endpoints and the sync calls of seated players are never shed.
 *   login meter    at most capacity.login_per_sec password checks per second (each costs a quarter of a CPU second):
 *                  the rest gets 503 LOGIN_BUSY + Retry-After and tries again by itself. The meter is taken where
 *                  the password is checked (Auth::attemptLogin), after the CSRF token, the address limit and the
 *                  lock-outs — never at the door, where a handful of posts a second would use it up for everybody.
 *   seats          capacity.max_online players can be in the village at once. A seat is a place in a sync channel
 *                  (Tfm\Sync keeps the list); it is kept while the player's browser keeps calling and is freed
 *                  capacity.seat_ttl seconds after the last call. A seated player is never asked to leave.
 *   waiting room   when the house is full a newcomer gets 503 QUEUE with a signed ticket {pos, eta}. The waiting
 *                  browser calls GET api/queue.php?t=<ticket> (the only thing it calls); when its turn has come the
 *                  answer says go:true and the next sync call with the ticket is let in. Tickets are served in the
 *                  order they were issued; a ticket whose browser stopped asking loses its turn.
 *                  One place per account: the server remembers it (g:t:<account mark>), so asking again without the
 *                  ticket — a reload, a second tab — is the same place, and only the remembered ticket counts. A
 *                  ticket is over when it was used, when its turn was kept twice and not taken, and when the line it
 *                  belongs to is gone (every line has an id; an emptied cache starts a new one).
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
    /** a ticket whose turn was kept this many times and never taken is over */
    private const NO_SHOWS = 2;

    /** @var float|null requests per second, read once per request */
    private static $rps = null;
    /** @var array|null */
    private static $conf = null;
    /** @var string|null the slot this request holds while its password check runs (loginSlot) */
    private static $loginId = null;

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
            'login_concurrent' => max(0, $n('login_concurrent', 4)),
            'seat_ttl'      => max(30, $n('seat_ttl', 180)),
            'ticket_ttl'    => max(60, $n('ticket_ttl', 1800)),
            'sample'        => max(1, $n('sample', 4)),
        ];
    }

    /** tests: forget what was read for this request */
    public static function reset(): void { self::$rps = null; self::$conf = null; self::$loginId = null; }

    private static function local(): bool
    {
        try { return Http::isLoopbackRequest(); } catch (\Throwable $e) { return false; }
    }

    // ------------------------------------------------------------------ load figures and shedding
    /**
     * First thing of every API request (Api::run): shed when the server is overloaded.
     * $opt['shed']: 0 = never, 1 = with the first wave, 2 = only at twice the shed rate (default: by endpoint).
     * @throws ApiException 503 BUSY with Retry-After
     */
    public static function enter(array $opt = []): void
    {
        try {
            if (!Cache::available()) return;
            $c = self::conf();
            if ($c['shed_rps'] <= 0) return;
            $tier = isset($opt['shed']) ? (int) $opt['shed'] : self::tier(Http::scriptPath());
            if ($tier <= 0 || self::rps() < $c['shed_rps'] * ($tier >= 2 ? 2 : 1) || self::local()) return;
        } catch (\Throwable $e) {
            return; // the gate never breaks a request by itself
        }
        $wait = 2 + mt_rand(0, 4);
        throw new ApiException(503, 'BUSY', '지금 마을에 친구들이 많아요. 잠시 후에 다시 연결할게요.', ['retryAfter' => $wait], ['Retry-After: ' . $wait]);
    }

    /**
     * A request was served (Api::run calls this after the handler returned): it counts as load, one in
     * capacity.sample. Refused requests never get here — see "load figures" at the top.
     */
    public static function count(): void
    {
        try {
            if (!Cache::available()) return;
            $c = self::conf();
            if ($c['sample'] === 1 || mt_rand(1, $c['sample']) === 1) Cache::hitWindow('g:rps', time(), 10);
        } catch (\Throwable $e) { /* figures only */ }
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

    /**
     * A password check is about to run. Two limits, both answered with 503 LOGIN_BUSY + Retry-After:
     *   · login_per_sec — not more checks than this start in one second;
     *   · login_concurrent — not more than this run at the same time. One check costs about a quarter of a second of
     *     CPU and 64 MB (argon2id). A server that cannot finish them as fast as they start would otherwise collect
     *     them: measured on a starved machine, 5 starts a second became 120 checks at once and a login took 24 s. With
     *     this limit the server paces itself on any hardware. The slot is given back when the request ends (and after
     *     20 s when a process died).
     */
    public static function loginSlot(?int $now = null): void
    {
        $c = self::conf();
        if (self::local()) return;
        if ($c['login_per_sec'] > 0) {
            $r = Cache::hitWindow('g:login', time(), 10);
            if (is_array($r) && $r[0] > $c['login_per_sec']) {
                $wait = 1 + min(8, intdiv($r[0] - $c['login_per_sec'], max(1, $c['login_per_sec']))) + mt_rand(0, 2);
                throw new ApiException(503, 'LOGIN_BUSY', '지금 들어오려는 친구가 많아요. 잠시 후에 다시 해 볼게요.', ['retryAfter' => $wait], ['Retry-After: ' . $wait]);
            }
        }
        $max = $c['login_concurrent'];
        if ($max <= 0) return;
        $now = $now === null ? Clock::ms() : $now;
        $id = bin2hex(random_bytes(6));
        $got = false;
        $r = Cache::mutate('g:lc', static function ($v) use ($now, $max, $id, &$got) {
            $v = is_array($v) ? $v : [];
            foreach ($v as $k => $until) {
                if ((int) $until <= $now) unset($v[$k]);              // a check that never reported back
            }
            if (count($v) < $max) { $v[$id] = $now + 20000; $got = true; }
            return $v ? $v : null;
        }, 60);
        if ($r === false) return;                                       // no cache: nothing is gated
        if (!$got) {
            // the more are being turned away right now, the later each is asked to come back (1–3 s when a few wait,
            // up to 15 s when hundreds do): the waiting visitors do not become the load themselves
            $busy = Cache::hitWindow('g:lbusy', time(), 10);
            $wait = 1 + min(12, intdiv(is_array($busy) ? max($busy[0], $busy[1]) : 0, max(1, $max))) + mt_rand(0, 2);
            throw new ApiException(503, 'LOGIN_BUSY', '지금 들어오려는 친구가 많아요. 잠시 후에 다시 해 볼게요.', ['retryAfter' => $wait], ['Retry-After: ' . $wait]);
        }
        self::$loginId = $id;
        register_shutdown_function([self::class, 'loginDone']);
    }

    /** the password check of this request is over (the request ended): its slot is free again */
    public static function loginDone(): void
    {
        $id = self::$loginId;
        if ($id === null) return;
        self::$loginId = null;
        try {
            Cache::mutate('g:lc', static function ($v) use ($id) {
                if (!is_array($v)) return null;
                unset($v[$id]);
                return $v ? $v : null;
            }, 60);
        } catch (\Throwable $e) { /* the slot ends by itself after 20 s */ }
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

    /** the keyed mark of an account (what a ticket and the remembered place carry instead of the account number) */
    private static function mark(int $uid): string
    {
        return substr(hash_hmac('sha256', 'u' . $uid, self::key()), 0, 12);
    }

    /** a signed ticket: place $seq of line $line for the account with mark $mark, issued $iat, good until $exp (s) */
    private static function sign(int $seq, string $mark, int $iat, int $exp, string $line): string
    {
        $body = self::b64((string) json_encode([$seq, $iat, $exp, $mark, $line]));
        return 'q1.' . $body . '.' . self::b64(substr(hash_hmac('sha256', 'q1.' . $body, self::key(), true), 0, 16));
    }

    /** [seq, issued s, expires s, account mark, line id] of a genuine, unexpired ticket, else null */
    private static function open($ticket, int $now): ?array
    {
        if (!is_string($ticket) || strlen($ticket) > 200 || !preg_match('/^q1\.([A-Za-z0-9_-]{10,140})\.([A-Za-z0-9_-]{22})$/', $ticket, $m)) return null;
        if (!hash_equals(self::b64(substr(hash_hmac('sha256', 'q1.' . $m[1], self::key(), true), 0, 16)), $m[2])) return null;
        $p = json_decode((string) base64_decode(strtr($m[1], '-_', '+/')), true);
        if (!is_array($p) || count($p) !== 5 || !is_int($p[0]) || !is_int($p[1]) || !is_int($p[2]) || !is_string($p[3]) || !is_string($p[4])) return null;
        if ($p[2] * 1000 < $now || $p[0] < 1) return null;
        return $p;
    }

    /**
     * The account mark of a genuine, unexpired ticket, else null — the identity api/queue.php is limited by
     * (RateLimit::forTicket): every waiting account has its own budget, so a class behind one address can wait.
     */
    public static function ticketOwner($ticket, ?int $now = null): ?string
    {
        try {
            $t = self::open($ticket, $now === null ? Clock::ms() : $now);
            return $t === null ? null : (string) $t[3];
        } catch (\Throwable $e) { return null; }
    }

    /** the one place the server remembers for an account mark, in the shape of an opened ticket, or null */
    private static function place(string $mark, int $now): ?array
    {
        $p = Cache::get('g:t:' . $mark);
        if (!is_array($p) || count($p) !== 4 || !is_int($p[0]) || !is_string($p[1]) || !is_int($p[2]) || !is_int($p[3]) || $p[0] < 1 || $p[3] * 1000 < $now) return null;
        return [$p[0], $p[2], $p[3], $mark, $p[1]];
    }

    /** an empty line with a new id: tickets of an earlier line do not belong to it */
    private static function fresh(): array
    {
        return ['e' => bin2hex(random_bytes(3)), 'h' => 0, 't' => 0, 'adm' => [], 'alive' => [], 'late' => [], 'miss' => [], 'rate' => 0.0, 'rt' => 0, 'n' => 0];
    }

    /** bring a stored line up to date: forget turns that ran out, hand free seats to the next tickets in order */
    private static function advance(array $q, int $now, int $seats, int $max): array
    {
        foreach (['adm', 'alive', 'late', 'miss'] as $k) if (!isset($q[$k]) || !is_array($q[$k])) $q[$k] = [];
        if (!isset($q['e']) || !is_string($q['e']) || $q['e'] === '') $q['e'] = bin2hex(random_bytes(3));   // a line stored before lines had ids
        foreach ($q['adm'] as $k => $exp) {
            if ((int) $exp > $now) continue;
            unset($q['adm'][$k]);
            // a turn that was kept for a ticket and not taken: NO_SHOWS of them and the ticket is over (admit / poll)
            if (ctype_digit((string) $k)) $q['miss'][$k] = (int) (isset($q['miss'][$k]) ? $q['miss'][$k] : 0) + 1;
        }
        if (count($q['miss']) > 256) { ksort($q['miss'], SORT_NUMERIC); $q['miss'] = array_slice($q['miss'], -256, null, true); }
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
     * $ticket: the ticket the browser holds. It is not needed to find the account's place — the server remembers the
     * one place of an account — and a ticket the server does not remember is no ticket.
     */
    public static function admit(int $uid, $ticket = null, bool $admin = false, ?int $now = null): ?array
    {
        $c = self::conf();
        if ($c['max_online'] <= 0 || $admin || !Cache::available()) return null;
        if ($now === null) $now = Clock::ms();
        $seats = self::seats($now);
        $mark = self::mark($uid);
        // One place per account. Every call without a ticket used to open a new place at the end of the line: a reload
        // lost the visitor's turn, and one account could collect hundreds of places, keep them "alive" through
        // api/queue.php and have every seat that became free reserved for a ticket nobody would use.
        $t = self::place($mark, $now);
        $out = null;
        $max = $c['max_online'];
        $ttl = $c['ticket_ttl'];
        $state = '';                // 'used' | 'gone' | 'new': what became of the remembered place
        $made = null;
        $res = Cache::mutate('g:q', function ($q) use ($now, $seats, $max, $t, $uid, $mark, $ttl, &$out, &$state, &$made) {
            $q = self::advance(is_array($q) ? $q : self::fresh(), $now, $seats, $max);
            $me = 'u' . $uid;
            if ($t !== null && $t[4] !== $q['e']) { $t = null; $state = 'gone'; }   // a place in a line that no longer exists
            if ($t !== null && isset($q['adm'][(string) $t[0]])) {                  // my turn has come: use it
                unset($q['adm'][(string) $t[0]], $q['miss'][$t[0]]);
                $q['adm'][$me] = $now + self::ENTER_MS;
                $state = 'used';
                return $q;
            }
            if (isset($q['adm'][$me])) return $q;                                   // let in a moment ago (a second tab, a retry)
            $nobodyWaits = (int) $q['h'] >= (int) $q['t'] && !$q['late'];
            if ($nobodyWaits && $seats + count($q['adm']) < $max) {
                $q['adm'][$me] = $now + self::ENTER_MS;
                if ($t !== null) $state = 'used';
                return $q;
            }
            if ($t !== null && $t[0] > (int) $q['h']) {                             // still in the line
                if ($t[0] - (int) $q['h'] <= 2 * self::WINDOW) $q['alive'][$t[0]] = $now;
                $out = self::waiting($q, $t[0], self::sign($t[0], $mark, $t[1], $t[2], $t[4]));
                return $q;
            }
            if ($t !== null && (int) (isset($q['miss'][$t[0]]) ? $q['miss'][$t[0]] : 0) < self::NO_SHOWS) {   // its turn passed while it was quiet
                $q['late'][$t[0]] = $now;
                $out = ['t' => self::sign($t[0], $mark, $t[1], $t[2], $t[4]), 'pos' => 1, 'eta' => 0, 'next' => 3000];
                return $q;
            }
            if ($t !== null) unset($q['miss'][$t[0]], $q['late'][$t[0]]);           // offered twice, never taken: over
            $q['t'] = (int) $q['t'] + 1;                                            // a new place at the end of the line
            $seq = (int) $q['t'];
            if ($seq - (int) $q['h'] <= 2 * self::WINDOW) $q['alive'][$seq] = $now;
            $iat = intdiv($now, 1000);
            $made = [$seq, (string) $q['e'], $iat, $iat + $ttl];
            $state = 'new';
            $out = self::waiting($q, $seq, self::sign($seq, $mark, $iat, $iat + $ttl, (string) $q['e']));
            return $q;
        }, 86400);
        if ($res === false) return null;      // the cache failed just now: nobody is kept outside because of it
        if ($state === 'new' && $made !== null) Cache::set('g:t:' . $mark, $made, $ttl);
        elseif ($state !== '') Cache::del('g:t:' . $mark);
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
     * @throws ApiException 400 QUEUE_TICKET (not a ticket / expired / not the place the server remembers for its
     *         account / used / given up / of an older line: ask api/sync.php for the place) · 429 (asked again within
     *         a second)
     */
    public static function poll($ticket, ?int $now = null): array
    {
        if ($now === null) $now = Clock::ms();
        $t = self::open($ticket, $now);
        $mine = $t === null ? null : self::place((string) $t[3], $now);
        if ($t === null || $mine === null || $mine[0] !== $t[0] || $mine[4] !== $t[4]) {
            throw new ApiException(400, 'QUEUE_TICKET', '대기표가 올바르지 않거나 시간이 지났어요. 다시 줄을 설게요.');
        }
        $c = self::conf();
        $seats = self::seats($now);
        $max = $c['max_online'];
        $out = ['go' => false];
        $tooFast = false;
        $over = false;
        $seq = $t[0];
        $line = (string) $t[4];
        $res = Cache::mutate('g:q', function ($q) use ($now, $seats, $max, $seq, $line, $ticket, &$out, &$tooFast, &$over) {
            $q = is_array($q) ? $q : self::fresh();
            if (!isset($q['e']) || $q['e'] !== $line) { $out = null; $over = true; return $q; }           // a ticket of a line that is gone
            if (isset($q['alive'][$seq]) && $now - (int) $q['alive'][$seq] < 900) { $tooFast = true; return $q; }
            if ($seq > (int) $q['h'] && $seq - (int) $q['h'] <= 2 * self::WINDOW) $q['alive'][$seq] = $now;
            elseif ($seq <= (int) $q['h'] && !isset($q['adm'][(string) $seq])) {
                if ((int) (isset($q['miss'][$seq]) ? $q['miss'][$seq] : 0) >= self::NO_SHOWS) {           // offered twice, never taken
                    unset($q['miss'][$seq], $q['late'][$seq]);
                    $out = null;
                    $over = true;
                    return $q;
                }
                $q['late'][$seq] = $now;
            }
            $q = self::advance($q, $now, $seats, $max);
            if (isset($q['adm'][(string) $seq])) { $out = ['go' => true, 'pos' => 0, 'eta' => 0, 'next' => 0]; return $q; }
            if ($seq > (int) $q['t']) { $out = null; $over = true; return $q; }
            $w = $seq > (int) $q['h'] ? self::waiting($q, $seq, (string) $ticket) : ['pos' => 1, 'eta' => 0, 'next' => 3000];
            $out = ['go' => false, 'pos' => $w['pos'], 'eta' => $w['eta'], 'next' => $w['next']];
            return $q;
        }, 86400);
        if ($tooFast) throw new ApiException(429, 'RATE_LIMITED', '조금만 천천히 물어봐 주세요.', ['retryAfter' => 1], ['Retry-After: 1']);
        if ($res === false) return ['go' => true, 'pos' => 0, 'eta' => 0, 'next' => 0];   // no line can be kept: nobody waits
        if ($over) Cache::del('g:t:' . (string) $t[3]);
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
        $locks = '';
        try { $ci = Cache::info(); $locks = (string) (isset($ci['locks']) ? $ci['locks'] : ''); } catch (\Throwable $e) { $locks = ''; }
        return [
            'cache' => Cache::driver(),
            // how channel updates queue: 'file' (a lock file in data/cache/_l) — or, APCu only, 'flag' when the web
            // server may not write there (correct, but waiting costs CPU: check the owner of data/cache)
            'locks' => $locks,
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
            'loginsRunning' => count(array_filter((array) Cache::get('g:lc', []), static function ($until) use ($now) { return (int) $until > $now; })),
            'loginConcurrent' => $c['login_concurrent'],
            'seatTtl' => $c['seat_ttl'],
        ];
    }
}
