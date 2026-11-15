<?php
/**
 * Tfm\Entitle — the one answer to "what may this account do" (CONTRACT §17.2). Computed on the server from the account
 * row (role), the subscription (Tfm\Subscription::state — the effective plan after expiry / refunds) and the operator's
 * settings (Tfm\Settings registry, group 구독·혜택). Nothing a browser sends is read here: a client can never raise it.
 *
 *   Entitle::forUser(?array $user, ?array $sub = null, ?int $now = null): array      the `ent` object
 *     { v: 1, role: 'user'|'admin', admin: bool, tier: 1..4, paid: bool, until: ms | 0,
 *       speed: { move: 1..3, grow: 1..4 }, limits: { jars: int, roomItems: int }, features: { myroom: bool },
 *       adminUrl?: string, pwDefault?: true }
 *     tier      the plan that counts: a paid plan's tier; an administrator: the highest tier on sale (never lower than a
 *               plan the administrator paid for); everybody else 1
 *     paid      an active 토스 plan (or a manual grant) — false for an administrator who simply has everything for free
 *     until     when the paid plan ends (ms), 0 without one
 *     speed     the multipliers of that tier (settings sub.move_N / sub.grow_N; tier 1 = 1 / 1)
 *     limits    jars: own jars that may be used (free 3 · paid and administrators 12); roomItems: things in my room
 *     features  myroom: an administrator, a live allotment contract, or a room the operator granted (user_rooms.granted)
 *     adminUrl  the admin site's folder ("admin-1a2b3c4d5e/") — ADMINISTRATORS ONLY
 *     pwDefault true while the administrator still uses the installer's default password — ADMINISTRATORS ONLY
 *   Entitle::guest(): array                       the same object for a visitor without an account (the free values)
 *   Entitle::tiersOnSale(): int[]                 setting sub.tiers_on (default [2, 3]); only these can be bought
 *   Entitle::topTier(): int                       the highest tier on sale (3 when nothing is on sale)
 *   Entitle::speedFor(int $tier): array           ['move' => 1..3, 'grow' => 1..4]
 *   Entitle::price(int $tier): int                the operator's price of a tier in KRW (setting sub.price_N)
 *   Entitle::limits(bool $plus): array            ['jars' => int, 'roomItems' => int] for a free / a paid-or-admin account
 *   Entitle::hasRoom(int $uid): bool              a live allotment contract or a granted room
 *   Entitle::site(): array                        the public settings (`site` of api/ping.php and api/auth/me.php)
 *
 * Sent with auth/me.php, auth/login.php, player/get.php, player/save.php, sub/status.php, sub/confirm.php (and the other
 * api/sub writes). The save validator and the real-time farm take their multipliers and the jar limit from it.
 * PHP 7.2 syntax only.
 */
declare(strict_types=1);

namespace Tfm;

if (!defined('TFM_BOOT')) { if (function_exists('header_remove')) header_remove('X-Powered-By'); http_response_code(404); exit; }

final class Entitle
{
    public const V = 1;
    /** the hard ceiling of own jars (the 장독대 has places J1 … J12) */
    public const MAX_JARS = 12;
    /** @var bool the user_rooms table (lane myroom, schema v8) is missing on this database: asked once per request */
    private static $noRooms = false;

    /** the tiers that can be bought, ascending — setting sub.tiers_on (a subset of 2, 3, 4) */
    public static function tiersOnSale(): array
    {
        $v = Settings::get('sub.tiers_on', [2, 3]);
        $out = [];
        foreach ((array) $v as $t) { $t = (int) $t; if ($t >= 2 && $t <= 4 && !in_array($t, $out, true)) $out[] = $t; }
        sort($out);
        return $out;
    }

    public static function isOnSale(int $tier): bool { return in_array($tier, self::tiersOnSale(), true); }

    /** what an administrator gets for free: the highest tier on sale (3 while the operator sells nothing) */
    public static function topTier(): int
    {
        $on = self::tiersOnSale();
        return $on ? (int) max($on) : 3;
    }

    /** the multipliers of a tier: movement 1..3 (collision and camera are tuned up to ×3), growth / fermentation 1..4 */
    public static function speedFor(int $tier): array
    {
        $tier = max(1, min(4, $tier));
        if ($tier === 1) return ['move' => 1, 'grow' => 1];
        $move = (int) Settings::get('sub.move_' . $tier, min($tier, 3));
        $grow = (int) Settings::get('sub.grow_' . $tier, $tier);
        return ['move' => max(1, min(3, $move)), 'grow' => max(1, min(4, $grow))];
    }

    /** the price of a tier in KRW: the operator's setting (⚙️ 설정), else the config file's toss.tiers */
    public static function price(int $tier): int
    {
        return Toss::price($tier); // a stored sub.price_N wins there over the config file's toss.tiers
    }

    /** jar and room-item limits: $plus = a paid plan or an administrator */
    public static function limits(bool $plus): array
    {
        $jars = (int) Settings::get($plus ? 'limits.jars_paid' : 'limits.jars_free', $plus ? 12 : 3);
        $items = (int) Settings::get($plus ? 'limits.room_items_paid' : 'limits.room_items_free', $plus ? 160 : 80);
        return ['jars' => max(1, min(self::MAX_JARS, $jars)), 'roomItems' => max(0, min(300, $items))];
    }

    /**
     * May this account have a room of its own (CONTRACT §17.4)? A live allotment contract (the operator named the
     * person in 🏺 분양 관리) or a room the operator granted directly (user_rooms.granted = 1). Administrators are
     * handled by the caller. A database without the tables answers false.
     */
    public static function hasRoom(int $uid): bool
    {
        if ($uid <= 0) return false;
        try {
            if (Db::value("SELECT id FROM allot_contracts WHERE user_id = ? AND status IN ('active', 'overdue') LIMIT 1", [$uid]) !== null) return true;
        } catch (\Throwable $e) { /* a database older than v7 */ }
        if (self::$noRooms) return false;
        try {
            $g = Db::value('SELECT granted FROM user_rooms WHERE user_id = ?', [$uid]);
            return $g !== null && (int) $g === 1;
        } catch (\Throwable $e) {
            self::$noRooms = true; // the table of lane myroom is not there (yet)
            return false;
        }
    }

    /** a visitor without an account: the free values */
    public static function guest(): array
    {
        return ['v' => self::V, 'role' => 'user', 'admin' => false, 'tier' => 1, 'paid' => false, 'until' => 0,
            'speed' => ['move' => 1, 'grow' => 1], 'limits' => self::limits(false), 'features' => ['myroom' => false]];
    }

    /**
     * The `ent` of an account. $user = the users row (the role decides, nothing else of it is trusted to a client);
     * $sub = Subscription::state() when the caller already has it (it is asked for otherwise).
     */
    public static function forUser(?array $user, ?array $sub = null, ?int $now = null): array
    {
        $uid = $user ? (int) (isset($user['id']) ? $user['id'] : 0) : 0;
        if ($uid <= 0) return self::guest();
        $admin = (isset($user['role']) ? $user['role'] : '') === 'admin';
        if ($sub === null) $sub = Subscription::state($uid, $now);
        $subTier = max(1, min(4, (int) (isset($sub['tier']) ? $sub['tier'] : 1)));
        $paid = $subTier > 1;
        $tier = $admin ? max($subTier, self::topTier()) : $subTier;
        $ent = [
            'v' => self::V,
            'role' => $admin ? 'admin' : 'user',
            'admin' => $admin,
            'tier' => $tier,
            'paid' => $paid,
            'until' => $paid ? (int) (isset($sub['expiresAt']) ? $sub['expiresAt'] : 0) : 0,
            'speed' => self::speedFor($tier),
            'limits' => self::limits($admin || $paid),
            'features' => ['myroom' => $admin || self::hasRoom($uid)],
        ];
        if ($admin) {
            // administrators only: where the admin site is, and whether the default password is still in use
            $url = class_exists('Tfm\\AdminPath') ? AdminPath::relUrl() : '';
            if ($url !== '') $ent['adminUrl'] = $url;
            if (!empty($user['pw_default'])) $ent['pwDefault'] = true;
        }
        return $ent;
    }

    /** the public settings every page gets as `site` (never a price, never a secret) */
    public static function site(): array
    {
        return Settings::publicValues();
    }

    /**
     * `site` together with its stamp, as ping.php, auth/me.php and auth/login.php send it: the page compares the stamp
     * with the `siteV` of every save answer and asks for `site` again when an operator changed a public setting.
     */
    public static function siteOut(): array
    {
        return ['site' => self::site(), 'siteV' => Settings::publicStamp()];
    }
}
