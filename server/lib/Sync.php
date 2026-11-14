<?php
/**
 * Tfm\Sync — one request instead of three (CONTRACT §16.9): POST api/sync.php carries my presence up and brings the
 * players around me, new chat lines, moderation, the online count and the time of the next call back.
 *
 * ============================================================================================================
 * WIRE FORMAT v1  (the client side — src/game/60-social.js — implements exactly this)
 * ============================================================================================================
 * Request   POST api/sync.php     Content-Type: application/json   (cookies as always)
 *   headers  X-CSRF-Token: <token>          always (as for every POST)
 *            X-Sync-Token: <t>              when the client holds one that is not about to expire (see "t" below)
 *   body  {
 *     "p":  [x, y, z, rotY, speed, anim, zoneId, emote, emoteAt]     my presence — REQUIRED
 *             x, y, z   numbers −1000 … 1000 (place-local inside a room / district, as presence/update.php)
 *             rotY      radians · speed 0 … 40 (m/s) · anim: one of Presence::ANIMS or null
 *             zoneId    "ZONE_…" or null · emote "EMO_…" or null · emoteAt ms (0 = none)
 *     "h":  0 | 1            1 = this tab is hidden (the server answers with a long "n"; others do not see me)
 *     "c":  1234             chat cursor: the highest message id I have (0 = send me the recent lines)
 *     "r":  17               moderation cursor (the "r" of the last answer); leave out on the first call
 *     "ap": { … }            my avatar look (the appearance object) — on the first call and whenever it changes
 *     "q":  ["12", "40"]     player ids I have no name / look for (≤ 24): the answer describes them in "who"
 *     "w":  ["ab12cd34"]     look hashes I do not know (≤ 24): the answer brings them in "ap"
 *     "f":  1                send every player row in full (first call, after an error, when "st" named an unknown id)
 *     "ns": 123              the notice number I have shown (leave out when none)
 *     "qt": "q1.…"           my waiting-room ticket (only after a 503 QUEUE answer)
 *   }
 *   Unknown keys, wrong types and bodies over 4 KB are refused (400 INVALID_INPUT / 413).
 *
 * Answer  200  {"success":true,"data":{ … },"serverTime":…}        data:
 *     "t":  "s1.….…", "te": 1731580000     a token and its expiry (unix seconds) — ONLY when the server issued one:
 *                                           the first call, and whenever a call came without a usable token.
 *                                           Send it as X-Sync-Token until 20 s before "te", then call once without
 *                                           it (that call is checked against the session and brings the next token).
 *     "ch": 3            my channel (players only see their own channel)
 *     "n":  1200         call again in this many ms (apply ±15 % jitter; never sooner)
 *     "sv": 60000        save hint: do not save more often than this many ms unless something important happened
 *     "on": 412          players online (all channels) · "cn": 57 players in my channel (me included)
 *     "pl": [ [id, x, y, z, rotY, speed, anim, zone, emote, emoteAt, age, tag], … ]
 *                        players in my area of interest — same place, within sync.aoi_radius metres, nearest first,
 *                        at most sync.max_near. id: string · zone: 0 = the same zoneId as mine, else the id string
 *                        emote: 0 = none · age: ms since that player's last report reached the server
 *                        tag: a number that changes when the player's name or look changes
 *     "st": ["12", "40"] players still in my area whose row did not change since my last call (keep drawing them);
 *                        a player that is in neither "pl" nor "st" has left my area. An id here that the client does
 *                        not know → send "f": 1 with the next call.
 *     "who": { "12": [nickname, lookHash] }     for the ids asked with "q" (and their looks come along in "ap")
 *     "ap":  { "ab12cd34": { … appearance … } } looks asked with "w" or needed by "who"
 *     "m":  [ [id, userId, nickname, text, kind, createdAt], … ]   chat after my cursor, oldest first
 *                        kind 0 = everyone in my channel · 1 = "주변" (near the sender); the text is already filtered
 *     "c":  1240         my new chat cursor
 *     "rt": { "m": [ids], "u": [userIds], "up": {userId: highest id to take back}, "r": 18 }
 *                        moderation since my "r": take these lines back ("reset":1 instead: forget the chat log and
 *                        ask again with "c": 0). Always carries the new cursor "r".
 *     "mu": 0            my chat pause ends at this ms time (0 = none)
 *     "nt": [123, "…"]   an operator notice (number, text) — only when it differs from my "ns"
 * Errors (the usual envelope {"success":false,"error":{code,message},"data":…}):
 *     401 AUTH_REQUIRED       the session is gone (data.why as everywhere) → drop the token, show the login card
 *     403 CSRF_INVALID        refresh the CSRF token (api/ping.php) and call again without X-Sync-Token
 *     429 RATE_LIMITED        + Retry-After (seconds) — called sooner than "n" allowed, or too often
 *     503 QUEUE               the village is full: data.queue = {t, pos, eta, next} → show the waiting room and call
 *                             GET api/queue.php?t=<t> every data.queue.next ms; when it answers go:true call
 *                             api/sync.php again with "qt": <t>
 *     503 BUSY                + Retry-After — the server is overloaded; wait and call again
 * A lost or refused X-Sync-Token is never an error of its own: the call is then checked against the session and the
 * answer simply carries a new "t".
 * ============================================================================================================
 *
 * How it works
 *   token      "s1." + base64url(JSON [uid, channel, issued ms, expires s, session mark, csrf mark, boot id]) + "." +
 *              base64url(first 16 bytes of HMAC-SHA256 with a key derived from the app key). The marks are keyed
 *              hashes of the session cookie and of the CSRF token, so a token is only good together with the very
 *              session and CSRF token it was issued for. It lives sync.token_ttl seconds (300, at most 600). The call
 *              that carries a good token touches no session file and no database: the hot path.
 *   revocation a token is good only while its account sits in its channel. Logout, a ban, a role / password / name
 *              change and a chat pause remove the account from the channel at once (Sync::revoke, called from
 *              Users::update and Presence::remove); the next call then has to pass the session check again. A cache
 *              that lost its content has another boot id: every token ends.
 *   channels   players are spread over channels of channels.size (60; a channel accepts returning members up to
 *              channels.hard 90). A newcomer joins the fullest channel that still has room, so channels stay lively;
 *              nobody is ever moved to another channel ("rebalancing only on join"). A seat is kept for
 *              capacity.seat_ttl seconds after the last call. The channel list is the seat count of Tfm\Gate.
 *   state      one cache entry per channel (sy:c:<n>) holds its members; a call rewrites it in one locked step
 *              (Cache::mutate). Chat lines live in a ring per channel (sy:r:<n>) — the database insert happens on send
 *              only (api/chat/send.php, with ChatFilter) — plus one ring for the old chat/list.php (sy:r:0).
 *   write-behind the presence table is updated in one multi-row statement per channel, at most every
 *              sync.flush_every seconds, by a call that passes the session check anyway (never by a hot-path call),
 *              after its answer has gone out.
 *   old clients api/presence/update.php and api/chat/list.php work on the same channel state (Tfm\Presence delegates
 *              here), so old and new pages see each other.
 * Without a usable cache (cache.driver off) Sync::enabled() is false: the old endpoints use the database as before
 * and api/sync.php answers 503 SYNC_OFF.
 * PHP 7.2 syntax only.
 */
declare(strict_types=1);

namespace Tfm;

if (!defined('TFM_BOOT')) { if (function_exists('header_remove')) header_remove('X-Powered-By'); http_response_code(404); exit; }

final class Sync
{
    public const VERSION = 1;
    // member entry (a list): what a channel remembers about one player
    private const SEEN = 0, X = 1, Y = 2, Z = 3, ROT = 4, SPEED = 5, ANIM = 6, ZONE = 7, EMOTE = 8, EMOTE_AT = 9, NICK = 10, APP = 11,
        TAG = 12, CHANGED = 13, HIDDEN = 14, NEXT = 15, RWIN = 16, RN = 17, DIRTY = 18, JOINED = 19, MUTED = 20;

    /** @var array|null */
    private static $conf = null;
    /** @var array hash => appearance of this request */
    private static $looks = [];

    public static function conf(): array
    {
        if (self::$conf !== null) return self::$conf;
        $s = (array) Config::get('sync', []);
        $ch = (array) Config::get('channels', []);
        $n = static function (array $a, string $k, int $d): int { return isset($a[$k]) && is_numeric($a[$k]) ? (int) $a[$k] : $d; };
        $size = max(2, min(500, $n($ch, 'size', 60)));
        return self::$conf = [
            'enabled'     => !isset($s['enabled']) || (bool) $s['enabled'],
            'size'        => $size,
            'hard'        => max($size, min(1000, $n($ch, 'hard', 90))),
            'min_ms'      => max(250, $n($s, 'min_ms', 1000)),
            'walk_ms'     => max(250, $n($s, 'walk_ms', 1500)),
            'alone_ms'    => max(250, $n($s, 'alone_ms', 2500)),
            'idle_ms'     => max(500, $n($s, 'idle_ms', 4000)),
            'hidden_ms'   => max(1000, $n($s, 'hidden_ms', 20000)),
            'max_ms'      => max(2000, $n($s, 'max_ms', 30000)),
            'min_gap_ms'  => max(0, $n($s, 'min_gap_ms', 350)),
            'token_ttl'   => max(30, min(600, $n($s, 'token_ttl', 300))),
            'aoi_radius'  => max(5, $n($s, 'aoi_radius', 90)),
            'max_near'    => max(1, min(200, $n($s, 'max_near', 40))),
            'flush_every' => max(5, $n($s, 'flush_every', 30)),
            'chat_ring'   => max(10, min(200, $n($s, 'chat_ring', 50))),
            'save_every'  => max(10, $n($s, 'save_every', 60)),
        ];
    }

    /** tests: forget what was derived for this process */
    public static function reset(): void { self::$conf = null; self::$looks = []; }

    /** is the channel store usable (a cache, and sync.enabled)? The old endpoints use the database when it is not. */
    public static function enabled(): bool
    {
        try { return self::conf()['enabled'] && Cache::available(); } catch (\Throwable $e) { return false; }
    }

    /** what api/ping.php and api/auth/me.php advertise: {sync: wire format version or 0, queue: 0|1, saveEvery: ms} */
    public static function features(): array
    {
        $on = self::enabled();
        $max = class_exists('Tfm\\Gate') ? Gate::conf()['max_online'] : 0;
        return ['sync' => $on ? self::VERSION : 0, 'queue' => $on && $max > 0 ? 1 : 0, 'saveEvery' => self::conf()['save_every'] * 1000];
    }

    private static function seatMs(): int { return (class_exists('Tfm\Gate') ? Gate::conf()['seat_ttl'] : 180) * 1000; }

    // ------------------------------------------------------------------ token
    private static function key(): string { return hash_hmac('sha256', 'tfm-sync-v1', Config::secret('app_key'), true); }
    private static function b64(string $bin): string { return rtrim(strtr(base64_encode($bin), '+/', '-_'), '='); }
    private static function mark(string $what, string $value): string { return substr(hash_hmac('sha256', $what . '|' . $value, self::key()), 0, 16); }

    /** [token, expires (unix s)] for an account that sits in channel $ch, bound to this session and CSRF token */
    public static function token(int $uid, int $ch, int $now, string $sid, string $csrf, string $boot): array
    {
        $exp = intdiv($now, 1000) + self::conf()['token_ttl'];
        $body = self::b64((string) json_encode([$uid, $ch, $now, $exp, self::mark('sid', $sid), self::mark('csrf', $csrf), $boot]));
        return ['s1.' . $body . '.' . self::b64(substr(hash_hmac('sha256', 's1.' . $body, self::key(), true), 0, 16)), $exp];
    }

    /**
     * The claims of a token that is genuine, unexpired and belongs to the session cookie and CSRF token of THIS request
     * ['uid', 'ch', 'iat' (ms), 'exp' (s), 'boot'], else null. Pure computation: no session file, no cache, no database.
     */
    public static function claims($token, $sid, $csrf, int $now): ?array
    {
        if (!is_string($token) || strlen($token) > 400 || !preg_match('/^s1\.([A-Za-z0-9_-]{20,340})\.([A-Za-z0-9_-]{22})$/', $token, $m)) return null;
        if (!hash_equals(self::b64(substr(hash_hmac('sha256', 's1.' . $m[1], self::key(), true), 0, 16)), $m[2])) return null;
        $p = json_decode((string) base64_decode(strtr($m[1], '-_', '+/')), true);
        if (!is_array($p) || count($p) !== 7 || !is_int($p[0]) || !is_int($p[1]) || !is_int($p[2]) || !is_int($p[3]) || !is_string($p[4]) || !is_string($p[5]) || !is_string($p[6])) return null;
        if ($p[0] < 1 || $p[1] < 1 || $p[3] * 1000 < $now || $p[2] > $now + 5000) return null;
        if (!is_string($sid) || $sid === '' || !hash_equals($p[4], self::mark('sid', $sid))) return null;
        if (!is_string($csrf) || $csrf === '' || !hash_equals($p[5], self::mark('csrf', $csrf))) return null;
        return ['uid' => $p[0], 'ch' => $p[1], 'iat' => $p[2], 'exp' => $p[3], 'boot' => $p[6]];
    }

    /** the claims of the X-Sync-Token header of this request, or null */
    private static function requestClaims(int $now): ?array
    {
        $tok = isset($_SERVER['HTTP_X_SYNC_TOKEN']) ? $_SERVER['HTTP_X_SYNC_TOKEN'] : null;
        if (!is_string($tok) || $tok === '') return null;
        $name = (string) Config::get('session.name', 'TFMSESSID');
        return self::claims($tok, isset($_COOKIE[$name]) ? $_COOKIE[$name] : null, isset($_SERVER['HTTP_X_CSRF_TOKEN']) ? $_SERVER['HTTP_X_CSRF_TOKEN'] : null, $now);
    }

    // ------------------------------------------------------------------ the endpoint
    /** api/sync.php: the whole endpoint */
    public static function serve(): void
    {
        $claims = null;
        try { if (self::enabled()) $claims = self::requestClaims(Clock::ms()); } catch (\Throwable $e) { $claims = null; }
        if ($claims === null) {
            Api::run(['method' => 'POST', 'auth' => true, 'rate' => 'sync_issue'], function (Ctx $c): array {
                return Sync::issue($c, $c->json(4096));
            });
            return;
        }
        // a good token: no session, no CSRF look-up (the token is bound to both), never shed — the seat is this player's
        Api::run(['method' => 'POST', 'session' => 'none', 'csrf' => false, 'shed' => 0], function (Ctx $c) use ($claims): array {
            $b = $c->json(4096);
            $r = Sync::hot($claims, $b, $c->now);
            if ($r !== null) return $r;
            // the seat of this token is gone (logout elsewhere, a ban, a pause, a long silence, an emptied cache):
            // everything is checked again, as for a call without a token
            Api::withSession($c, 'sync_issue');
            return Sync::issue($c, $b);
        });
    }

    /** typed, range-checked request body → the normalised input (throws 400 INVALID_INPUT) */
    public static function input(array $b): array
    {
        V::keys($b, ['p', 'h', 'c', 'r', 'ap', 'q', 'w', 'f', 'ns', 'qt']);
        if (!V::has($b, 'p')) V::fail('p', '값이 필요해요.');
        $p = V::arr($b['p'], 'p', 9);
        if (count($p) !== 9 || !Arr::isList($p)) V::fail('p', '값은 9개짜리 목록이어야 해요.');
        $in = self::presence([
            'x' => $p[0], 'y' => $p[1], 'z' => $p[2], 'rotY' => $p[3], 'speed' => $p[4], 'anim' => $p[5], 'zoneId' => $p[6], 'emote' => $p[7], 'emoteAt' => $p[8],
        ], 'p');
        $flag = static function ($v, string $f): int {
            if (is_bool($v)) return $v ? 1 : 0;
            return V::int($v, $f, 0, 1);
        };
        $in['h'] = V::has($b, 'h') ? $flag($b['h'], 'h') : 0;
        $in['f'] = V::has($b, 'f') ? $flag($b['f'], 'f') : 0;
        $in['c'] = V::has($b, 'c') ? V::int($b['c'], 'c', 0, V::INT_MAX) : 0;
        $in['r'] = V::has($b, 'r') ? V::int($b['r'], 'r', 0, V::INT_MAX) : null;
        $in['ns'] = V::has($b, 'ns') ? V::int($b['ns'], 'ns', 0, V::INT_MAX) : null;
        $in['ap'] = null;
        if (V::has($b, 'ap')) {
            if (!is_array($b['ap']) || ($b['ap'] !== [] && Arr::isList($b['ap']))) V::fail('ap', '값은 { } 모양으로 보내 주세요.');
            $in['ap'] = $b['ap'];
        }
        $in['q'] = [];
        if (V::has($b, 'q')) {
            foreach (V::arr($b['q'], 'q', 24) as $id) $in['q'][] = V::id($id, 'q');
        }
        $in['w'] = [];
        if (V::has($b, 'w')) {
            foreach (V::arr($b['w'], 'w', 24) as $h) $in['w'][] = V::hex($h, 'w', 8);
        }
        $in['qt'] = V::has($b, 'qt') ? V::str($b['qt'], 'qt', 200) : null;
        return $in;
    }

    /**
     * The presence fields of a body, typed and range-checked the way api/presence/update.php always did (a string
     * where a number belongs, an out-of-world coordinate or an unknown animation / zone / emote id is a 400), then
     * rounded and clamped to what is stored. $b: x, y, z, rotY, speed, anim, zoneId, emote, emoteAt.
     */
    public static function presence(array $b, string $prefix = ''): array
    {
        $f = static function (string $k) use ($prefix): string { return $prefix === '' ? $k : $prefix . '.' . $k; };
        foreach (['x', 'y', 'z'] as $k) V::num(V::has($b, $k) ? $b[$k] : null, $f($k), -1000, 1000);
        if (V::has($b, 'rotY')) V::num($b['rotY'], $f('rotY'), -1000000, 1000000);
        if (V::has($b, 'speed')) V::num($b['speed'], $f('speed'), 0, 40);
        if (V::has($b, 'emoteAt')) V::num($b['emoteAt'], $f('emoteAt'), 0, 9.9e15);
        if (V::has($b, 'anim')) V::enum($b['anim'], $f('anim'), Presence::ANIMS);
        if (V::has($b, 'zoneId') && !preg_match('/^ZONE_[A-Z0-9_]{1,30}$/', V::str($b['zoneId'], $f('zoneId'), 40))) V::fail($f('zoneId'), '구역 값이 올바르지 않아요.');
        if (V::has($b, 'emote') && !preg_match('/^EMO_[A-Z0-9_]{1,30}$/', V::str($b['emote'], $f('emote'), 40))) V::fail($f('emote'), '값이 올바르지 않아요.');
        $num = static function ($v, float $min, float $max): float { return is_int($v) || is_float($v) ? max($min, min($max, (float) $v)) : 0.0; };
        $emote = V::has($b, 'emote') ? (string) $b['emote'] : null;
        return [
            'x' => round($num($b['x'], -400, 400), 2), 'y' => round($num($b['y'], -50, 200), 2), 'z' => round($num($b['z'], -400, 400), 2),
            'rot' => round(fmod($num(isset($b['rotY']) ? $b['rotY'] : 0, -1000, 1000), 2 * M_PI), 2),
            'speed' => round($num(isset($b['speed']) ? $b['speed'] : 0, 0, 40), 1),
            'anim' => V::has($b, 'anim') ? (string) $b['anim'] : null,
            'zone' => V::has($b, 'zoneId') ? (string) $b['zoneId'] : null,
            'emote' => $emote,
            'emoteAt' => $emote !== null ? (int) $num(isset($b['emoteAt']) ? $b['emoteAt'] : 0, 0, 9.9e15) : 0,
        ];
    }

    /**
     * The hot path: a call with a good token. Cache only — no session, no SQL (tests/scale-unit.php counts).
     * null = the seat of this token is gone: the caller falls back to the session check.
     * @throws ApiException 429 RATE_LIMITED (sooner than allowed / too many calls)
     */
    public static function hot(array $claims, array $body, int $now): ?array
    {
        $in = self::input($body);
        $meta = Cache::get('sy:meta');
        if (!is_array($meta) || !isset($meta['b']) || $meta['b'] !== $claims['boot']) return null;       // the cache started over
        if (Cache::driver() === 'apcu' && (int) Cache::get('s:revall', 0) >= $claims['iat']) return null;  // a command-line change
        $x = self::exchange($claims['ch'], $claims['uid'], $in, $now, ['load' => (float) (isset($meta['ld']) ? $meta['ld'] : 1.0)]);
        if ($x['state'] === 'gone') return null;
        if ($x['state'] !== 'ok') {
            throw new ApiException(429, 'RATE_LIMITED', '요청이 너무 많아요. 잠시 후 다시 시도해 주세요.', ['retryAfter' => $x['retry']], ['Retry-After: ' . $x['retry']]);
        }
        return self::answer($claims['ch'], $claims['uid'], $in, $x, $meta, $now);
    }

    /**
     * The checked path: the session, the CSRF token and the account were verified by Api::run. Seats the account
     * (or answers 503 QUEUE), refreshes what the channel knows about it (name, look, chat pause), issues a token.
     */
    public static function issue(Ctx $c, array $body): array
    {
        if (!self::enabled()) throw new ApiException(503, 'SYNC_OFF', '이 서버는 한꺼번에 주고받기(sync)를 쓰지 않아요.');
        $in = self::input($body);
        $u = (array) $c->user;
        $now = $c->now;
        $j = self::join($u, $in, $now);
        $out = $j['out'];
        $tok = self::token((int) $u['id'], $j['ch'], $now, Session::id(), (string) Session::currentCsrf(), (string) $j['meta']['b']);
        $out['t'] = $tok[0];
        $out['te'] = $tok[1];
        if ($j['flush']) {
            $rows = $j['flush'];
            Api::after(static function () use ($rows): void { Sync::flush($rows); });
        }
        return $out;
    }

    /**
     * Seat a checked account (users row: id, nickname, role, muted_until) and do its exchange:
     * ['ch' => channel, 'out' => the answer without a token, 'meta', 'flush' => rows for the presence table or null].
     * @throws ApiException 503 QUEUE when the house is full
     */
    public static function join(array $u, array $in, int $now): array
    {
        $uid = (int) $u['id'];
        $meta = self::meta($now);
        $muted = (int) (isset($u['muted_until']) ? $u['muted_until'] : 0);
        $ch = self::seat($uid, isset($in['qt']) ? $in['qt'] : null, (isset($u['role']) ? $u['role'] : '') === 'admin', $now);
        $x = self::exchange($ch, $uid, $in, $now, ['join' => ['nick' => (string) $u['nickname'], 'muted' => $muted > $now ? $muted : 0], 'load' => (float) $meta['ld'], 'flush' => true]);
        return ['ch' => $ch, 'out' => self::answer($ch, $uid, $in, $x, $meta, $now), 'meta' => $meta, 'flush' => $x['flush']];
    }

    // ------------------------------------------------------------------ seats and channels
    /** players seated right now (the sum of the channel list) */
    public static function online(?int $now = null): int
    {
        $n = 0;
        foreach (self::channels($now) as $c) $n += $c[0];
        return $n;
    }

    /** channel id → [members, last report ms] of the live channels */
    public static function channels(?int $now = null): array
    {
        $reg = Cache::get('sy:chans');
        $out = [];
        if ($now === null) $now = Clock::ms();
        $dead = self::seatMs() + 15000;      // a live channel reports at least every 10 s per caller; nobody called for a whole seat time: empty
        foreach (is_array($reg) ? $reg : [] as $id => $c) {
            if (is_array($c) && isset($c[0], $c[1]) && (int) $c[0] > 0 && $now - (int) $c[1] <= $dead) $out[(int) $id] = [(int) $c[0], (int) $c[1]];
        }
        return $out;
    }

    /** which channel does this account sit in (0 = none known) */
    public static function channelOf(int $uid): int
    {
        return (int) Cache::get('sy:u:' . $uid, 0);
    }

    /**
     * The channel for this account: the one it already sits in, the one it sat in when that still has room, else a
     * seat from the gate (503 QUEUE when the house is full) in the fullest channel below channels.size.
     * @throws ApiException 503 QUEUE
     */
    private static function seat(int $uid, $ticket, bool $admin, int $now): int
    {
        $c = self::conf();
        $ch = self::channelOf($uid);
        if ($ch > 0) {
            $blob = Cache::get('sy:c:' . $ch);
            $members = is_array($blob) && isset($blob['m']) && is_array($blob['m']) ? $blob['m'] : [];
            if (isset($members[$uid]) && $now - (int) $members[$uid][self::SEEN] <= self::seatMs()) return $ch;   // still seated
        }
        // a new seat: the gate decides (the waiting room when the house is full)
        if (class_exists('Tfm\Gate')) {
            $q = Gate::admit($uid, $ticket, $admin, $now);
            if ($q !== null) {
                $wait = max(1, (int) ceil($q['next'] / 1000));
                throw new ApiException(503, 'QUEUE', '지금 마을에 친구들이 많아요. 차례가 되면 바로 들어갈 수 있어요.', ['queue' => $q, 'retryAfter' => $wait], ['Retry-After: ' . $wait]);
            }
        }
        $dead = self::seatMs() + 15000;
        $picked = 0;
        Cache::mutate('sy:chans', static function ($reg) use ($c, $ch, $now, $dead, &$picked) {
            $reg = is_array($reg) ? $reg : [];
            foreach ($reg as $id => $e) if (!is_array($e) || !isset($e[0], $e[1]) || (int) $e[0] <= 0 || $now - (int) $e[1] > $dead) unset($reg[$id]);
            // back to the channel it knew, when that still takes returning members
            if ($ch > 0 && isset($reg[$ch]) && (int) $reg[$ch][0] < $c['hard']) $picked = $ch;
            if ($picked === 0) {
                $best = -1;
                foreach ($reg as $id => $e) {
                    if ((int) $e[0] < $c['size'] && (int) $e[0] > $best) { $best = (int) $e[0]; $picked = (int) $id; }
                }
            }
            if ($picked === 0) {
                $picked = 1;
                while (isset($reg[$picked])) $picked++;
            }
            $reg[$picked] = [isset($reg[$picked]) ? (int) $reg[$picked][0] + 1 : 1, $now];
            return $reg;
        }, 86400);
        if ($picked === 0) $picked = 1;
        Cache::set('sy:u:' . $uid, $picked, 86400);
        if (class_exists('Tfm\Gate')) Gate::settled($uid);
        return $picked;
    }

    /**
     * The account changed, or left: its seat ends now (and with it every sync token of the account). Called from
     * Users::update (ban, role, password, name, chat pause, "sign out everywhere"), Presence::remove (logout, ban).
     */
    public static function revoke(int $uid): void
    {
        if (!self::enabled()) return;
        $ch = self::channelOf($uid);
        Cache::del('sy:u:' . $uid);
        Cache::del('s:rev:' . $uid);   // a security key: on the command line this also tells a web cache in memory
        if ($ch <= 0) return;
        $left = null;
        Cache::mutate('sy:c:' . $ch, static function ($blob) use ($uid, &$left) {
            if (is_array($blob) && isset($blob['m'][$uid])) {
                unset($blob['m'][$uid]);
                $left = count($blob['m']);
                $blob['rn'] = $left;
            }
            return $blob;
        }, 86400);
        if ($left !== null) self::report($ch, $left, Clock::ms());      // the freed seat shows in the channel list at once
    }

    // ------------------------------------------------------------------ the exchange (one locked step per call)
    private static function place($zone): string
    {
        return is_string($zone) && strncmp($zone, 'ZONE_PL_', 8) === 0 ? $zone : '';
    }

    /**
     * Put my report into my channel and read the players around me — one Cache::mutate.
     * $o: 'join' => ['nick', 'muted'] (the checked path: seat me, refresh my name) · 'load' => float · 'legacy' => true
     *     (an old presence call: no pacing checks, rows are not built) · 'flush' => true (may claim the write-behind)
     * Returns ['state' => ok | gone | fast | rate, 'retry' => s, 'rows', 'still', 'count', 'next', 'cid', 'me', 'flush',
     *          'report' => members to report to the channel list or null].
     */
    public static function exchange(int $ch, int $uid, array $in, int $now, array $o = []): array
    {
        $c = self::conf();
        $join = isset($o['join']) ? $o['join'] : null;
        $legacy = !empty($o['legacy']);
        $load = max(1.0, (float) (isset($o['load']) ? $o['load'] : 1.0));
        $seatMs = self::seatMs();
        $ttlMin = max(5, (int) Config::get('presence.ttl', 15)) * 1000;
        $limit = (array) Config::get('rate_limits.sync', [150, 60]);
        $perMin = (int) (isset($limit[0]) ? $limit[0] : 150);
        $look = null;
        if ($in['ap'] !== null) $look = self::storeLook($in['ap']);
        $res = ['state' => 'ok', 'retry' => 1, 'rows' => [], 'still' => [], 'count' => 0, 'next' => $c['idle_ms'], 'cid' => 0, 'me' => null, 'flush' => null, 'report' => null];
        $ok = Cache::mutate('sy:c:' . $ch, static function ($blob) use (&$res, $c, $uid, $in, $now, $join, $legacy, $load, $seatMs, $ttlMin, $perMin, $look, $o) {
            if (!is_array($blob) || !isset($blob['m']) || !is_array($blob['m'])) {
                if ($join === null) { $res['state'] = 'gone'; return is_array($blob) ? $blob : null; }
                $blob = ['m' => [], 'fl' => $now, 'rg' => 0, 'rn' => -1, 'cid' => 0];
            }
            $prev = isset($blob['m'][$uid]) && is_array($blob['m'][$uid]) && count($blob['m'][$uid]) >= 21 ? $blob['m'][$uid] : null;
            if ($prev === null && $join === null) { $res['state'] = 'gone'; return $blob; }
            if ($prev !== null && $now - (int) $prev[self::SEEN] > $seatMs && $join === null) { unset($blob['m'][$uid]); $res['state'] = 'gone'; return $blob; }
            $rwin = $prev !== null ? (int) $prev[self::RWIN] : 0;
            $rn = $prev !== null ? (int) $prev[self::RN] : 0;
            if ($prev !== null && $join === null && !$legacy) {
                // pacing without a database: not sooner than the minimum gap, not more than rate_limits.sync a minute
                if ($now - (int) $prev[self::SEEN] < $c['min_gap_ms']) { $res['state'] = 'fast'; $res['retry'] = 1; return $blob; }
                $win = intdiv($now, 60000);
                if ($rwin === $win) $rn++; else { $rwin = $win; $rn = 1; }
                if ($rn > $perMin) {
                    $blob['m'][$uid][self::RWIN] = $rwin;
                    $blob['m'][$uid][self::RN] = $rn;
                    $res['state'] = 'rate';
                    $res['retry'] = max(1, 60 - (intdiv($now, 1000) % 60));
                    return $blob;
                }
            }
            $me = [
                $now, $in['x'], $in['y'], $in['z'], $in['rot'], $in['speed'], $in['anim'], $in['zone'], $in['emote'], $in['emoteAt'],
                $join !== null ? $join['nick'] : (string) $prev[self::NICK],
                $look !== null ? $look : ($prev !== null ? $prev[self::APP] : ''),
                0, $now, (int) $in['h'], 0, $rwin, $rn, 1, $prev !== null ? (int) $prev[self::JOINED] : $now,
                $join !== null ? (int) $join['muted'] : (int) $prev[self::MUTED],
            ];
            $me[self::TAG] = hexdec(substr(sha1($me[self::NICK] . '|' . $me[self::APP]), 0, 6));
            if ($prev !== null) {
                $same = true;
                foreach ([self::X, self::Y, self::Z, self::ROT, self::SPEED, self::ANIM, self::ZONE, self::EMOTE, self::EMOTE_AT, self::HIDDEN, self::TAG] as $k) {
                    if ($prev[$k] !== $me[$k] && !(is_numeric($prev[$k]) && is_numeric($me[$k]) && (float) $prev[$k] === (float) $me[$k])) { $same = false; break; }
                }
                if ($same) { $me[self::CHANGED] = (int) $prev[self::CHANGED]; $me[self::DIRTY] = (int) $prev[self::DIRTY]; }
            }
            // the players around me: same place, inside the radius, nearest first
            $myPlace = Sync::placeOf($me[self::ZONE]);
            $prevSeen = $prev !== null ? (int) $prev[self::SEEN] : 0;
            $prevPlace = $prev !== null ? Sync::placeOf($prev[self::ZONE]) : null;
            $r2 = (float) $c['aoi_radius'] * $c['aoi_radius'];
            $near = [];
            $count = 1;
            $anyMoving = false;
            foreach ($blob['m'] as $id => $m) {
                if ((int) $id === $uid) continue;
                if (!is_array($m) || count($m) < 21 || $now - (int) $m[self::SEEN] > $seatMs) { unset($blob['m'][$id]); continue; }
                $count++;
                if ($legacy && empty($o['rows'])) continue;
                if ((int) $m[self::HIDDEN] === 1 || $now - (int) $m[self::SEEN] > max($ttlMin, (int) (2.5 * (int) $m[self::NEXT]))) continue;   // not shown: hidden tab / silent
                if (Sync::placeOf($m[self::ZONE]) !== $myPlace) continue;
                $dx = (float) $m[self::X] - (float) $me[self::X];
                $dz = (float) $m[self::Z] - (float) $me[self::Z];
                $d2 = $dx * $dx + $dz * $dz;
                if ($d2 > $r2 && !$legacy) continue;
                $near[] = [$d2, (int) $id, $m];
            }
            usort($near, static function ($a, $b) { return $a[0] <=> $b[0] ?: $a[1] <=> $b[1]; });
            $cap = $legacy ? max(1, min(200, (int) Config::get('presence.max_players', 60))) : $c['max_near'];
            if (count($near) > $cap) $near = array_slice($near, 0, $cap);
            $full = !empty($in['f']) || $prev === null || $join !== null || $legacy;
            foreach ($near as $n) {
                $m = $n[2];
                if ((float) $m[self::SPEED] > 0.2) $anyMoving = true;
                if (!$full && (int) $m[self::CHANGED] <= $prevSeen && $prevPlace === $myPlace) {
                    // nothing new about this player since my last call — and it was inside my radius then, too
                    $px = (float) $m[self::X] - (float) $prev[self::X];
                    $pz = (float) $m[self::Z] - (float) $prev[self::Z];
                    if ($px * $px + $pz * $pz <= $r2) { $res['still'][] = (string) $n[1]; continue; }
                }
                $res['rows'][] = [
                    (string) $n[1], $m[self::X], $m[self::Y], $m[self::Z], $m[self::ROT], $m[self::SPEED], $m[self::ANIM],
                    $m[self::ZONE] === $me[self::ZONE] ? 0 : $m[self::ZONE], $m[self::EMOTE] === null ? 0 : $m[self::EMOTE], (int) $m[self::EMOTE_AT],
                    max(0, min(60000, $now - (int) $m[self::SEEN])), (int) $m[self::TAG],
                ];
            }
            // when to call again: about a second while moving in company, slower when alone or idle, long when hidden
            $moving = (float) $me[self::SPEED] > 0.2;
            if ((int) $me[self::HIDDEN] === 1) $base = $c['hidden_ms'];
            elseif ($near && ($moving || $anyMoving)) $base = (float) $me[self::SPEED] > 3.2 || $anyMoving ? $c['min_ms'] : $c['walk_ms'];
            elseif ($moving) $base = $c['alone_ms'];
            else $base = $c['idle_ms'];
            $me[self::NEXT] = (int) min($c['max_ms'], round($base * $load));
            $blob['m'][$uid] = $me;
            // write-behind: a checked call may take the changed rows of this channel for the presence table
            if (!empty($o['flush']) && $now - (int) (isset($blob['fl']) ? $blob['fl'] : 0) >= $c['flush_every'] * 1000) {
                $rows = [];
                foreach ($blob['m'] as $id => $m) {
                    if ((int) $m[self::DIRTY] !== 1) continue;
                    $rows[] = [(int) $id, (string) $m[self::NICK], $m[self::X], $m[self::Y], $m[self::Z], $m[self::ROT], $m[self::ANIM], $m[self::SPEED], $m[self::ZONE], $m[self::EMOTE], (int) $m[self::EMOTE_AT], (int) $m[self::SEEN]];
                    $blob['m'][$id][self::DIRTY] = 0;
                }
                $blob['fl'] = $now;
                if ($rows) $res['flush'] = $rows;
            }
            // tell the channel list when the head count changed, and every 10 s that this channel is alive
            if ($count !== (int) (isset($blob['rn']) ? $blob['rn'] : -1) || $now - (int) (isset($blob['rg']) ? $blob['rg'] : 0) >= 10000) {
                $blob['rn'] = $count;
                $blob['rg'] = $now;
                $res['report'] = $count;
            }
            $res['count'] = $count;
            $res['next'] = $me[self::NEXT];
            $res['cid'] = (int) (isset($blob['cid']) ? $blob['cid'] : 0);
            $res['me'] = $me;
            return $blob;
        }, max(600, intdiv($seatMs, 1000) * 4));
        if ($ok === false && $res['state'] === 'ok' && $res['me'] === null) $res['state'] = 'gone';   // the cache failed just now
        if ($res['report'] !== null) self::report($ch, (int) $res['report'], $now);
        return $res;
    }

    /** @internal used inside the exchange */
    public static function placeOf($zone): string { return self::place($zone); }

    /** a channel reports its head count: the channel list and the small "meta" entry every call reads */
    private static function report(int $ch, int $count, int $now): void
    {
        $dead = self::seatMs() + 15000;
        $online = 0;
        Cache::mutate('sy:chans', static function ($reg) use ($ch, $count, $now, $dead, &$online) {
            $reg = is_array($reg) ? $reg : [];
            if ($count > 0) $reg[$ch] = [$count, $now]; else unset($reg[$ch]);
            foreach ($reg as $id => $e) {
                if (!is_array($e) || !isset($e[0], $e[1]) || (int) $e[0] <= 0 || $now - (int) $e[1] > $dead) { unset($reg[$id]); continue; }
                $online += (int) $e[0];
            }
            return $reg ?: null;
        }, 86400);
        $load = class_exists('Tfm\Gate') ? round(Gate::load(), 2) : 1.0;
        Cache::mutate('sy:meta', static function ($m) use ($online, $load, $now) {
            if (!is_array($m) || !isset($m['b'])) return $m;           // made by the checked path only
            $m['on'] = $online;
            $m['ld'] = $load;
            $m['at'] = $now;
            return $m;
        }, 0);
    }

    /**
     * The small entry every call reads: boot id, online count, load factor, moderation cursor, operator notice.
     * The checked path makes it when it is missing (a new boot id: older tokens end) and refreshes the notice once a
     * minute (the only part that needs the database).
     */
    public static function meta(int $now): array
    {
        $m = Cache::get('sy:meta');
        if (is_array($m) && isset($m['b'], $m['na']) && $now - (int) $m['na'] < 60000 && isset($m['rt'])) return $m + ['ld' => 1.0, 'on' => 0, 'nt' => null];
        $notice = null;
        try {
            $text = class_exists('Tfm\Settings') ? Settings::get('security.notice', '') : '';
            if (is_string($text) && trim($text) !== '') $notice = [(int) sprintf('%u', crc32($text)) % 1000000000, mb_substr($text, 0, 200)];
        } catch (\Throwable $e) { $notice = null; }
        $rt = self::retractions();
        $r = Cache::mutate('sy:meta', static function ($old) use ($notice, $now, $rt) {
            $m = is_array($old) && isset($old['b']) ? $old : ['b' => bin2hex(random_bytes(6)), 'on' => 0, 'ld' => 1.0, 'at' => $now];
            $m['nt'] = $notice;
            $m['na'] = $now;
            $m['rt'] = (int) $rt['id'];
            return $m;
        }, 0);
        if (!is_array($r)) throw new ApiException(503, 'SYNC_OFF', '이 서버는 한꺼번에 주고받기(sync)를 쓰지 않아요.');
        return $r + ['ld' => 1.0, 'on' => 0, 'nt' => null];
    }

    /** build the answer of a call from what the exchange found */
    private static function answer(int $ch, int $uid, array $in, array $x, array $meta, int $now): array
    {
        $c = self::conf();
        $me = $x['me'];
        $out = [
            'ch' => $ch,
            'n' => (int) $x['next'],
            'sv' => (int) round($c['save_every'] * 1000 * max(1.0, (float) (isset($meta['ld']) ? $meta['ld'] : 1.0))),
            'on' => max((int) (isset($meta['on']) ? $meta['on'] : 0), (int) $x['count']),
            'cn' => (int) $x['count'],
            'pl' => $x['rows'],
        ];
        if ($x['still']) $out['st'] = $x['still'];
        // names and looks the client asked for
        $want = $in['w'];
        if ($in['q']) {
            $blob = Cache::get('sy:c:' . $ch);
            $who = [];
            foreach ($in['q'] as $id) {
                if (!is_array($blob) || !isset($blob['m'][$id]) || !is_array($blob['m'][$id])) continue;
                $m = $blob['m'][$id];
                $who[(string) $id] = [(string) $m[self::NICK], (string) $m[self::APP]];
                if ($m[self::APP] !== '') $want[] = (string) $m[self::APP];
            }
            if ($who) $out['who'] = $who;
        }
        if ($want) {
            $ap = [];
            foreach (array_slice(array_values(array_unique($want)), 0, 48) as $h) {
                $l = self::look($h);
                if ($l !== null) $ap[$h] = $l;
            }
            if ($ap) $out['ap'] = $ap;
        }
        // chat: the ring is read only when the channel has something newer than my cursor (or I ask for the history)
        $out['c'] = $in['c'];
        if ($in['c'] === 0 || (int) $x['cid'] > $in['c']) {
            $chat = self::chatFor($ch, $uid, $in['c'], $me, $now);
            $out['m'] = $chat['rows'];
            $out['c'] = max($in['c'], $chat['last'], $in['c'] === 0 ? 0 : (int) $x['cid']);
        }
        // moderation since my cursor
        $rtId = (int) (isset($meta['rt']) ? $meta['rt'] : 0);
        if ($in['r'] === null) $out['rt'] = ['m' => [], 'u' => [], 'up' => new \stdClass(), 'r' => $rtId];
        elseif ($rtId > $in['r']) { $rt = self::retractedSince($in['r']); if ($rt !== null) $out['rt'] = $rt; }
        $out['mu'] = (int) $me[self::MUTED] > $now ? (int) $me[self::MUTED] : 0;
        $nt = isset($meta['nt']) && is_array($meta['nt']) ? $meta['nt'] : null;
        if ($nt !== null && $in['ns'] !== (int) $nt[0]) $out['nt'] = [(int) $nt[0], (string) $nt[1]];
        return $out;
    }

    // ------------------------------------------------------------------ looks (hash-addressed appearance)
    /** whitelist an appearance object, store it under its hash, return the 8-hex hash ('' = nothing usable) */
    private static function storeLook($appearance): string
    {
        $json = Presence::appearance($appearance);
        if ($json === null) return '';
        $h = substr(sha1($json), 0, 8);
        if (!isset(self::$looks[$h])) {
            $a = json_decode($json, true);
            self::$looks[$h] = is_array($a) ? $a : [];
            if (Cache::get('sy:a:' . $h) === null) Cache::set('sy:a:' . $h, self::$looks[$h], 86400 * 7);
        }
        return $h;
    }

    /** the appearance stored under a hash, or null */
    public static function look(string $hash): ?array
    {
        if ($hash === '' || !preg_match('/^[0-9a-f]{8}$/', $hash)) return null;
        if (array_key_exists($hash, self::$looks)) return self::$looks[$hash];
        $a = Cache::get('sy:a:' . $hash);
        return self::$looks[$hash] = is_array($a) ? $a : null;
    }

    // ------------------------------------------------------------------ chat rings
    /**
     * A chat line was stored (api/chat/send.php, after ChatFilter and the database insert): hand it to the sender's
     * channel and to the ring of the old chat/list.php. $row: id, user_id, nickname, text, channel ('all' | 'local'),
     * created_at, x, z (the position of a local line or null), zone.
     */
    public static function chatPush(array $row): void
    {
        if (!self::enabled()) return;
        $uid = (int) $row['user_id'];
        $ch = self::channelOf($uid);
        $e = [(int) $row['id'], $uid, (string) $row['nickname'], (string) $row['text'], $row['channel'] === 'local' ? 1 : 0, (int) $row['created_at'],
            isset($row['x']) && $row['x'] !== null ? (float) $row['x'] : null, isset($row['z']) && $row['z'] !== null ? (float) $row['z'] : null,
            self::place(isset($row['zone']) ? $row['zone'] : null), $ch];
        $keep = self::conf()['chat_ring'];
        $push = static function (int $max) use ($e) {
            return static function ($ring) use ($e, $max) {
                $ring = is_array($ring) && isset($ring['rows']) && is_array($ring['rows']) ? $ring : ['rows' => [], 'seeded' => false, 'from' => 0];
                $ring['rows'][] = $e;
                if (count($ring['rows']) > $max) {
                    $ring['rows'] = array_slice($ring['rows'], -$max);
                    $ring['from'] = (int) $ring['rows'][0][0];      // older lines are in the database only
                }
                return $ring;
            };
        };
        Cache::mutate('sy:r:0', $push(max(80, (int) Config::get('chat.page_size', 60) + 20)), 6 * 3600);
        if ($ch <= 0) return;
        Cache::mutate('sy:r:' . $ch, $push($keep), 6 * 3600);
        $id = $e[0];
        Cache::mutate('sy:c:' . $ch, static function ($blob) use ($id) {
            if (is_array($blob) && isset($blob['m'])) $blob['cid'] = max((int) (isset($blob['cid']) ? $blob['cid'] : 0), $id);
            return $blob;
        }, max(600, intdiv(self::seatMs(), 1000) * 4));
    }

    /** the lines of my channel after my cursor that I may see: ['rows' => [[id, uid, nick, text, kind, at]], 'last' => id] */
    private static function chatFor(int $ch, int $uid, int $after, array $me, int $now): array
    {
        $ring = Cache::get('sy:r:' . $ch);
        $rows = is_array($ring) && isset($ring['rows']) && is_array($ring['rows']) ? $ring['rows'] : [];
        $radius = (float) Config::get('chat.local_radius', 30);
        $out = [];
        $last = 0;
        if ($after === 0) $rows = array_slice($rows, -max(1, (int) Config::get('chat.history', 40)));
        foreach ($rows as $r) {
            if (!is_array($r) || count($r) < 10) continue;
            $last = max($last, (int) $r[0]);
            if ((int) $r[0] <= $after) continue;
            if ($after === 0 && $now - (int) $r[5] > 6 * 3600000) continue;
            if ((int) $r[4] === 1 && (int) $r[1] !== $uid) {
                if ($r[6] === null || $r[7] === null || (string) $r[8] !== self::place($me[self::ZONE])) continue;
                if (hypot((float) $r[6] - (float) $me[self::X], (float) $r[7] - (float) $me[self::Z]) > $radius) continue;
            }
            $out[] = [(int) $r[0], (string) $r[1], (string) $r[2], (string) $r[3], (int) $r[4], (int) $r[5]];
        }
        return ['rows' => $out, 'last' => $last];
    }

    /**
     * The ring behind the old api/chat/list.php: its rows when the ring is known to hold every line after $after
     * ($after = 0: the recent history), else null — the endpoint then asks the database and hands the history to
     * seedGlobal(). Each row: [id, userId, nickname, text, kind, createdAt, x, z, place, channel].
     */
    public static function globalRows(int $after): ?array
    {
        if (!self::enabled()) return null;
        $ring = Cache::get('sy:r:0');
        if (!is_array($ring) || empty($ring['seeded']) || !isset($ring['rows']) || !is_array($ring['rows'])) return null;
        if ($after > 0 && $after + 1 < (int) (isset($ring['from']) ? $ring['from'] : PHP_INT_MAX)) return null;   // lines between my cursor and the ring are in the database only
        return $ring['rows'];
    }

    /**
     * The database history (oldest first: id, user_id, nickname, channel, text, x, z, created_at) becomes the ring.
     * $from: the ring holds every visible line with an id of at least this (the first history row, or the next id
     * when there is no history).
     */
    public static function seedGlobal(array $dbRows, int $from): void
    {
        if (!self::enabled()) return;
        $max = max(80, (int) Config::get('chat.page_size', 60) + 20);
        Cache::mutate('sy:r:0', static function ($ring) use ($dbRows, $max, $from) {
            $have = [];
            foreach (is_array($ring) && isset($ring['rows']) && is_array($ring['rows']) ? $ring['rows'] : [] as $r) $have[(int) $r[0]] = $r;
            foreach ($dbRows as $r) {
                $id = (int) $r['id'];
                if (isset($have[$id])) continue;
                $have[$id] = [$id, (int) $r['user_id'], (string) $r['nickname'], (string) $r['text'], $r['channel'] === 'local' ? 1 : 0, (int) $r['created_at'],
                    $r['x'] === null ? null : (float) $r['x'], $r['z'] === null ? null : (float) $r['z'], '', 0];
            }
            ksort($have, SORT_NUMERIC);
            $rows = array_values($have);
            if (count($rows) > $max) { $rows = array_slice($rows, -$max); $from = max($from, (int) $rows[0][0]); }
            return ['rows' => $rows, 'seeded' => true, 'from' => $from];
        }, 6 * 3600);
    }

    // ------------------------------------------------------------------ moderation feed (hidden lines, banned accounts)
    /** the stored feed {id: last retraction id, rows: [[rid, messageId|null, userId|null, uptoId|null]]} — from the cache, else rebuilt from the table */
    public static function retractions(bool $rebuild = true): ?array
    {
        $rt = Cache::get('s:rt');
        if (is_array($rt) && isset($rt['id'], $rt['rows']) && is_array($rt['rows'])) return $rt;
        if (!$rebuild) return null;      // the hot path asks the cache only
        $rows = [];
        $id = 0;
        try {
            foreach (array_reverse(Db::all('SELECT id, message_id, user_id, upto_id FROM chat_retractions ORDER BY id DESC LIMIT 100')) as $r) {
                $rows[] = [(int) $r['id'], $r['message_id'] === null ? null : (int) $r['message_id'], $r['user_id'] === null ? null : (int) $r['user_id'], $r['upto_id'] === null ? null : (int) $r['upto_id']];
                $id = (int) $r['id'];
            }
        } catch (\Throwable $e) { /* no table yet */ }
        $rt = ['id' => $id, 'rows' => $rows];
        Cache::set('s:rt', $rt, 0);
        return $rt;
    }

    /**
     * A line was hidden or an account banned (Retractions::add): the feed, the rings and the "meta" cursor follow at
     * once, so players online take the lines back with their next call.
     */
    public static function retracted(int $rid, ?int $mid, ?int $uid, ?int $upto): void
    {
        if (!self::enabled()) return;
        self::retractions();
        Cache::mutate('s:rt', static function ($rt) use ($rid, $mid, $uid, $upto) {
            $rt = is_array($rt) && isset($rt['rows']) && is_array($rt['rows']) ? $rt : ['id' => 0, 'rows' => []];
            $rt['rows'][] = [$rid, $mid, $uid, $upto];
            if (count($rt['rows']) > 100) $rt['rows'] = array_slice($rt['rows'], -100);
            $rt['id'] = max((int) $rt['id'], $rid);
            return $rt;
        }, 0);
        Cache::mutate('sy:meta', static function ($m) use ($rid) {
            if (is_array($m) && isset($m['b'])) $m['rt'] = max((int) (isset($m['rt']) ? $m['rt'] : 0), $rid);
            return $m;
        }, 0);
        $drop = static function ($ring) use ($mid, $uid) {
            if (!is_array($ring) || !isset($ring['rows']) || !is_array($ring['rows'])) return $ring;
            $rows = [];
            foreach ($ring['rows'] as $r) {
                if ($mid !== null && (int) $r[0] === $mid) continue;
                if ($uid !== null && (int) $r[1] === $uid) continue;
                $rows[] = $r;
            }
            $ring['rows'] = $rows;
            return $ring;
        };
        Cache::mutate('sy:r:0', $drop, 6 * 3600);
        foreach (array_keys(self::channels()) as $ch) {
            if (Cache::get('sy:r:' . $ch) !== null) Cache::mutate('sy:r:' . $ch, $drop, 6 * 3600);
        }
    }

    /** what was taken back after cursor $r, in the compact shape of the sync answer */
    private static function retractedSince(int $r): ?array
    {
        $rt = self::retractions(false);
        if ($rt === null) return null;
        $rows = $rt['rows'];
        if ($rows && (int) $rows[0][0] > $r + 1 && count($rows) >= 100) return ['reset' => 1, 'm' => [], 'u' => [], 'up' => new \stdClass(), 'r' => (int) $rt['id']];
        $out = ['m' => [], 'u' => [], 'up' => new \stdClass(), 'r' => (int) $rt['id']];
        $marks = [];
        foreach ($rows as $row) {
            if ((int) $row[0] <= $r) continue;
            if ($row[1] !== null) $out['m'][] = (int) $row[1];
            if ($row[2] !== null) {
                $uid = (string) $row[2];
                if (!in_array($uid, $out['u'], true)) $out['u'][] = $uid;
                if (!array_key_exists($uid, $marks)) $marks[$uid] = $row[3];
                elseif ($marks[$uid] !== null) $marks[$uid] = $row[3] === null ? null : max($marks[$uid], (int) $row[3]);
            }
        }
        foreach ($marks as $uid => $w) if ($w !== null) $out['up']->{$uid} = (int) $w;
        return $out;
    }

    /**
     * The same feed in the shape of the old chat/list.php ({messages, users, upTo, retractId}); null = the cache cannot
     * answer this cursor (the endpoint then asks Retractions::since).
     */
    public static function retractionsLegacy(?int $cursor): ?array
    {
        if (!self::enabled()) return null;
        $rt = self::retractions();
        if ($cursor === null) return ['messages' => [], 'users' => [], 'upTo' => new \stdClass(), 'retractId' => (int) $rt['id']];
        $x = self::retractedSince($cursor);
        if ($x === null || !empty($x['reset'])) return null;
        return ['messages' => $x['m'], 'users' => $x['u'], 'upTo' => $x['up'], 'retractId' => $x['r']];
    }

    // ------------------------------------------------------------------ write-behind
    /**
     * Presence rows of one channel into the table, in one statement (a row whose account was deleted in the meantime is
     * skipped by writing the rest one by one). $rows: [uid, nick, x, y, z, rot, anim, speed, zone, emote, emoteAt, seen].
     * The stored avatar look is left alone. Returns the number of rows written.
     */
    public static function flush(array $rows): int
    {
        if (!$rows) return 0;
        $names = ['user_id', 'nickname', 'x', 'y', 'z', 'rot_y', 'anim', 'speed', 'zone_id', 'emote', 'emote_at', 'updated_at'];
        // SQLite (one small machine; an old library has no native upsert): the portable row upsert, in one transaction
        $single = static function (array $r) use ($names): void {
            $row = array_combine($names, $r) + ['appearance' => null];
            Db::upsert('presence', $row, ['user_id'], array_values(array_diff($names, ['user_id'])));
        };
        if (Db::driver() !== 'mysql') {
            return (int) Db::tx(static function () use ($rows, $single) {
                $n = 0;
                foreach ($rows as $r) { try { $single($r); $n++; } catch (\PDOException $e) { /* the account was deleted meanwhile */ } }
                return $n;
            });
        }
        try {
            $params = [];
            foreach ($rows as $r) foreach ($r as $v) $params[] = $v;
            // the only varying part is the number of "(?, …)" groups — one per row; every value is bound
            Db::exec('INSERT INTO presence (user_id, nickname, x, y, z, rot_y, anim, speed, zone_id, emote, emote_at, appearance, updated_at) VALUES '
                . implode(', ', array_fill(0, count($rows), '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)'))
                . ' ON DUPLICATE KEY UPDATE nickname = VALUES(nickname), x = VALUES(x), y = VALUES(y), z = VALUES(z), rot_y = VALUES(rot_y), anim = VALUES(anim), speed = VALUES(speed), zone_id = VALUES(zone_id), emote = VALUES(emote), emote_at = VALUES(emote_at), updated_at = VALUES(updated_at)', $params);
            return count($rows);
        } catch (\Throwable $e) {
            // one of the accounts was deleted meanwhile (the foreign key refuses the whole statement): row by row
            $n = 0;
            foreach ($rows as $r) { try { $single($r); $n++; } catch (\Throwable $e2) { /* skipped */ } }
            return $n;
        }
    }

    /** every channel's changed rows into the table now (`php cli/tfm.php cleanup`); returns the rows written */
    public static function flushAll(): int
    {
        if (!self::enabled()) return 0;
        $n = 0;
        foreach (array_keys(self::channels()) as $ch) {
            $rows = [];
            Cache::mutate('sy:c:' . $ch, static function ($blob) use (&$rows) {
                if (!is_array($blob) || !isset($blob['m']) || !is_array($blob['m'])) return $blob;
                foreach ($blob['m'] as $id => $m) {
                    if (!is_array($m) || count($m) < 21 || (int) $m[self::DIRTY] !== 1) continue;
                    $rows[] = [(int) $id, (string) $m[self::NICK], $m[self::X], $m[self::Y], $m[self::Z], $m[self::ROT], $m[self::ANIM], $m[self::SPEED], $m[self::ZONE], $m[self::EMOTE], (int) $m[self::EMOTE_AT], (int) $m[self::SEEN]];
                    $blob['m'][$id][self::DIRTY] = 0;
                }
                return $blob;
            }, max(600, intdiv(self::seatMs(), 1000) * 4));
            $n += self::flush($rows);
        }
        return $n;
    }

    // ------------------------------------------------------------------ the old endpoints on the same state (Tfm\Presence)
    /**
     * An old client's presence report (api/presence/update.php): seat the account like a sync call would and return
     * the players of its channel in the old shape (nearest first, at most presence.max_players).
     * @throws ApiException 503 QUEUE when the house is full
     */
    public static function legacyUpdate(array $user, array $in, int $now): array
    {
        $uid = (int) $user['id'];
        $muted = (int) (isset($user['muted_until']) ? $user['muted_until'] : 0);
        $ch = self::seat($uid, null, (isset($user['role']) ? $user['role'] : '') === 'admin', $now);
        self::meta($now);
        $x = self::exchange($ch, $uid, $in + ['h' => 0, 'f' => 1], $now, ['join' => ['nick' => (string) $user['nickname'], 'muted' => $muted > $now ? $muted : 0], 'legacy' => true, 'rows' => true, 'flush' => true]);
        if ($x['flush']) {
            $rows = $x['flush'];
            Api::after(static function () use ($rows): void { Sync::flush($rows); });
        }
        $blob = Cache::get('sy:c:' . $ch);
        $out = [];
        foreach ($x['rows'] as $r) {
            $m = is_array($blob) && isset($blob['m'][(int) $r[0]]) ? $blob['m'][(int) $r[0]] : null;
            $out[] = [
                'id' => (string) $r[0], 'nickname' => $m !== null ? (string) $m[self::NICK] : '',
                'x' => (float) $r[1], 'y' => (float) $r[2], 'z' => (float) $r[3], 'rotY' => (float) $r[4],
                'anim' => $r[6], 'speed' => (float) $r[5], 'zoneId' => $r[7] === 0 ? $in['zone'] : $r[7],
                'emote' => $r[8] === 0 ? null : $r[8], 'emoteAt' => (int) $r[9], 'age' => (int) $r[10],
                'appearance' => $m !== null ? self::look((string) $m[self::APP]) : null,
            ];
        }
        return ['players' => $out, 'online' => max(self::online(), count($out) + 1)];
    }

    /** where the channel last saw this account: ['x', 'z', 'zone'] or null (older than a minute / not seated) */
    public static function position(int $uid, int $now): ?array
    {
        $ch = self::channelOf($uid);
        if ($ch <= 0) return null;
        $blob = Cache::get('sy:c:' . $ch);
        if (!is_array($blob) || !isset($blob['m'][$uid]) || !is_array($blob['m'][$uid])) return null;
        $m = $blob['m'][$uid];
        if ($now - (int) $m[self::SEEN] > 60000) return null;
        return ['x' => (float) $m[self::X], 'z' => (float) $m[self::Z], 'zone' => $m[self::ZONE]];
    }

    /** the members of a channel that count as present: [['id', 'nick', 'zone', 'seen', 'hidden']] */
    public static function members(int $ch, int $now): array
    {
        $blob = Cache::get('sy:c:' . $ch);
        $out = [];
        $seat = self::seatMs();
        foreach (is_array($blob) && isset($blob['m']) && is_array($blob['m']) ? $blob['m'] : [] as $id => $m) {
            if (!is_array($m) || count($m) < 21 || $now - (int) $m[self::SEEN] > $seat) continue;
            $out[] = ['id' => (int) $id, 'nick' => (string) $m[self::NICK], 'zone' => $m[self::ZONE] === null ? null : (string) $m[self::ZONE], 'seen' => (int) $m[self::SEEN], 'hidden' => (int) $m[self::HIDDEN] === 1];
        }
        return $out;
    }

    /** channel sizes and what the endpoint hands out — for `php cli/tfm.php capacity` */
    public static function status(): array
    {
        $ch = self::channels();
        $sizes = array_map(static function ($c) { return $c[0]; }, $ch);
        $meta = Cache::get('sy:meta');
        return [
            'enabled' => self::enabled(),
            'channels' => count($ch),
            'online' => array_sum($sizes),
            'largest' => $sizes ? max($sizes) : 0,
            'smallest' => $sizes ? min($sizes) : 0,
            'load' => is_array($meta) && isset($meta['ld']) ? (float) $meta['ld'] : 1.0,
            'size' => self::conf()['size'],
            'hard' => self::conf()['hard'],
        ];
    }
}
