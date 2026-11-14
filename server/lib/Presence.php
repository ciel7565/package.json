<?php
/**
 * Presence (who is online and where) + avatar appearance whitelist.
 * Everything other players receive about you passes through here, so every field is validated:
 * positions are clamped to the world, animation/zone/emote ids must match known patterns,
 * and appearance keeps only known keys with whitelisted values (no free text).
 *
 * Phase 8 (CONTRACT §16.9): with a usable cache the state lives in the sync channels (Tfm\Sync) — update() seats the
 * account in a channel and others() answers from that channel (stable membership: the same neighbours every time,
 * nearest first), without a database statement; the presence table is written behind (Sync::flush). Old pages that
 * still call api/presence/update.php and new pages that call api/sync.php therefore see each other. Without a cache
 * (cache.driver off) everything below works on the table exactly as before.
 * PHP 7.2 syntax only.
 */
declare(strict_types=1);

namespace Tfm;

if (!defined('TFM_BOOT')) { if (function_exists('header_remove')) header_remove('X-Powered-By'); http_response_code(404); exit; }

final class Presence
{
    public const ANIMS = ['idle', 'walk', 'run', 'jump', 'fall', 'sit', 'wave', 'bow', 'clap', 'thumbsup', 'point', 'photo', 'celebrate',
        'surprise', 'nod', 'heart', 'dance', 'think', 'water', 'harvest', 'interact', 'talk'];
    private const ENUMS = [
        'hair' => ['short', 'long', 'bun', 'ponytail', 'buzz', 'curly'],
        'top' => ['tshirt', 'hoodie', 'shirt', 'hanbok', 'apron', 'jacket'],
        'bottom' => ['pants', 'shorts', 'skirt'],
        'bag' => ['none', 'backpack', 'basket', 'pouch'],
        'accessory' => ['none', 'glasses', 'strawhat', 'headband', 'cap', 'beard', 'gat'],
        'face' => ['smile', 'calm', 'cheer'],
    ];
    private const COLORS = ['skin', 'hairColor', 'topColor', 'bottomColor', 'shoes', 'bagColor', 'accessoryColor'];

    /** whitelist-sanitized appearance as a JSON string, or null */
    public static function appearance($a): ?string
    {
        if ($a instanceof \stdClass) $a = get_object_vars($a);
        if (!is_array($a)) return null;
        $out = [];
        foreach (self::ENUMS as $k => $allowed) {
            if (isset($a[$k]) && is_string($a[$k]) && in_array($a[$k], $allowed, true)) $out[$k] = $a[$k];
        }
        foreach (self::COLORS as $k) {
            if (isset($a[$k]) && is_string($a[$k]) && preg_match('/^#[0-9a-fA-F]{6}$/', $a[$k])) $out[$k] = strtolower($a[$k]);
        }
        if (isset($a['height']) && (is_int($a['height']) || is_float($a['height'])) && is_finite((float) $a['height'])) {
            $out['height'] = round(max(0.9, min(1.1, (float) $a['height'])), 2);
        }
        if (!$out) return null;
        $j = json_encode($out, JSON_UNESCAPED_SLASHES);
        return is_string($j) ? $j : null;
    }

    private static function num($v, float $min, float $max, float $def = 0.0): float
    {
        if (!(is_int($v) || is_float($v)) || !is_finite((float) $v)) return $def;
        return max($min, min($max, (float) $v));
    }

    /** @var array|null [uid, players, online] of the channel update() just did (others() / onlineCount() hand it out) */
    private static $last = null;

    /** is the channel store in use? */
    private static function shared(): bool
    {
        return class_exists('Tfm\\Sync') && Sync::enabled();
    }

    /** upsert my presence row from a client body */
    public static function update(array $user, array $b, int $now): void
    {
        if (self::shared()) {
            // [scale-server] the same typing and clamping as below, then one locked step in the account's channel
            $in = Sync::presence($b) + ['ap' => array_key_exists('appearance', $b) && is_array($b['appearance']) ? $b['appearance'] : null, 'q' => [], 'w' => [], 'c' => 0, 'r' => null, 'ns' => null, 'qt' => null];
            $r = Sync::legacyUpdate($user, $in, $now);
            self::$last = [(int) $user['id'], $r['players'], (int) $r['online']];
            return;
        }
        $anim = isset($b['anim']) && is_string($b['anim']) && in_array($b['anim'], self::ANIMS, true) ? $b['anim'] : null;
        $zone = isset($b['zoneId']) && is_string($b['zoneId']) && preg_match('/^ZONE_[A-Z0-9_]{1,30}$/', $b['zoneId']) ? $b['zoneId'] : null;
        $emote = isset($b['emote']) && is_string($b['emote']) && preg_match('/^EMO_[A-Z0-9_]{1,30}$/', $b['emote']) ? $b['emote'] : null;
        $emoteAt = (int) self::num(isset($b['emoteAt']) ? $b['emoteAt'] : 0, 0, 9.9e15);
        if ($emoteAt && abs($emoteAt - $now) > 86400000) $emoteAt = 0; // client clock wildly off → ignore
        $rot = self::num(isset($b['rotY']) ? $b['rotY'] : 0, -1000, 1000);
        $rot = fmod($rot, 2 * M_PI);
        $row = [
            'user_id' => (int) $user['id'],
            'nickname' => (string) $user['nickname'],
            'x' => round(self::num(isset($b['x']) ? $b['x'] : 0, -400, 400), 2),
            'y' => round(self::num(isset($b['y']) ? $b['y'] : 0, -50, 200), 2),
            'z' => round(self::num(isset($b['z']) ? $b['z'] : 0, -400, 400), 2),
            'rot_y' => round($rot, 3),
            'anim' => $anim,
            'speed' => round(self::num(isset($b['speed']) ? $b['speed'] : 0, 0, 40), 1),
            'zone_id' => $zone,
            'emote' => $emote,
            'emote_at' => $emote ? $emoteAt : 0,
            'updated_at' => $now,
        ];
        $app = array_key_exists('appearance', $b) ? self::appearance($b['appearance']) : null;
        Db::tx(function () use ($row, $app) {
            if ($app !== null) {
                $row['appearance'] = $app;
                Db::upsert('presence', $row, ['user_id']);
            } else {
                // keep the stored appearance when the client did not resend it
                Db::upsert('presence', $row + ['appearance' => null], ['user_id'], array_values(array_diff(array_keys($row), ['user_id'])));
            }
        });
        if (random_int(1, 100) <= 2) {
            $hours = (int) Config::get('retention.presence_hours', 24);
            Db::exec('DELETE FROM presence WHERE updated_at < ?', [$now - $hours * 3600000]);
        }
    }

    /** other active players seen within ttl seconds (never includes emails or internal fields) */
    public static function others(int $myId, int $now): array
    {
        if (self::$last !== null && self::$last[0] === $myId) return self::$last[1];   // [scale-server] the channel of update()
        $ttl = (int) Config::get('presence.ttl', 15);
        $max = (int) Config::get('presence.max_players', 60);
        $rows = Db::all(
            "SELECT p.user_id, p.nickname, p.x, p.y, p.z, p.rot_y, p.anim, p.speed, p.zone_id, p.emote, p.emote_at, p.appearance, p.updated_at
             FROM presence p JOIN users u ON u.id = p.user_id
             WHERE p.updated_at >= ? AND p.user_id <> ? AND u.status = 'active'
             ORDER BY p.updated_at DESC LIMIT " . max(1, min(200, $max)),
            [$now - $ttl * 1000, $myId]
        );
        $out = [];
        foreach ($rows as $r) {
            $app = $r['appearance'] ? Json::tryDecode((string) $r['appearance'], true) : null;
            $out[] = [
                'id' => (string) $r['user_id'],
                'nickname' => (string) $r['nickname'],
                'x' => (float) $r['x'], 'y' => (float) $r['y'], 'z' => (float) $r['z'], 'rotY' => (float) $r['rot_y'],
                'anim' => $r['anim'], 'speed' => (float) $r['speed'], 'zoneId' => $r['zone_id'],
                'emote' => $r['emote'], 'emoteAt' => (int) $r['emote_at'],
                // ms since that report arrived: lets clients extrapolate a moving player from the right moment
                'age' => max(0, min(60000, $now - (int) $r['updated_at'])),
                'appearance' => is_array($app) ? $app : null,
            ];
        }
        return $out;
    }

    public static function onlineCount(int $now): int
    {
        // [scale-server] the seat count of the channels: no statement, no O(online) join per chat poll
        if (self::shared()) return self::$last !== null ? self::$last[2] : Sync::online();
        $ttl = (int) Config::get('presence.ttl', 15);
        return (int) Db::value("SELECT COUNT(*) FROM presence p JOIN users u ON u.id = p.user_id WHERE p.updated_at >= ? AND u.status = 'active'", [$now - $ttl * 1000]);
    }

    /** my last known position (for 'local' chat) */
    public static function position(int $userId, int $now): ?array
    {
        if (self::shared()) {                                           // [scale-server]
            $p = Sync::position($userId, $now);
            return $p === null ? null : ['x' => $p['x'], 'z' => $p['z']];
        }
        $r = Db::one('SELECT x, z, updated_at FROM presence WHERE user_id = ?', [$userId]);
        if (!$r || (int) $r['updated_at'] < $now - 60000) return null;
        return ['x' => (float) $r['x'], 'z' => (float) $r['z']];
    }

    public static function remove(int $userId): void
    {
        // [scale-server] the seat in the channel ends now (and with it the account's sync tokens)
        try { if (class_exists('Tfm\\Sync')) Sync::revoke($userId); } catch (\Throwable $e) { /* the seat runs out by itself */ }
        try { Db::exec('DELETE FROM presence WHERE user_id = ?', [$userId]); } catch (\Throwable $e) { /* ignore */ }
    }

    /** players per zone right now: zone id → count (the admin dashboard) */
    public static function zones(int $now): array
    {
        $out = [];
        if (self::shared()) {
            foreach (array_keys(Sync::channels()) as $ch) {
                foreach (Sync::members($ch, $now) as $m) {
                    if ($m['zone'] !== null) $out[$m['zone']] = (isset($out[$m['zone']]) ? $out[$m['zone']] : 0) + 1;
                }
            }
            arsort($out);
            return $out;
        }
        foreach (Db::all('SELECT zone_id, COUNT(*) AS n FROM presence WHERE updated_at >= ? AND zone_id IS NOT NULL GROUP BY zone_id', [$now - (int) Config::get('presence.ttl', 15) * 1000]) as $r) {
            $out[(string) $r['zone_id']] = (int) $r['n'];
        }
        return $out;
    }
}
