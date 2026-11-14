<?php
/**
 * Tfm\Ranking — the top list of api/ranking/top.php, kept in the shared cache (CONTRACT §16.9).
 *
 * Without the cache every call ran four statements, two of them counts over all profiles. Now:
 *   · the top 20 and the number of active players are one cache entry for cache.ranking_ttl seconds (60). When it is
 *     older than that, ONE request renews it (a short lock); the others keep answering from the copy they have.
 *   · a player's own place is one entry per account for the same time.
 *   · an accepted save (api/player/save.php → saved()) drops the player's own entry, and the shared list when the save
 *     can change it: the player is on the list, or now reaches its last row. A player therefore sees the own save in the
 *     ranking at once; everybody else sees a change of the top 20 at once too, and a change below it within a minute.
 *   · a ban, a role change or a new name (Auth::forgetUser) drops the shared list, so a banned account leaves it at once.
 * With cache.driver = off, or when the cache cannot be used, every call asks the database as before.
 * Only nicknames leave this class through the endpoint (no ids, no e-mail addresses); the cached rows carry the account
 * id so the endpoint can mark "me".
 */
declare(strict_types=1);

namespace Tfm;

if (!defined('TFM_BOOT')) { if (function_exists('header_remove')) header_remove('X-Powered-By'); http_response_code(404); exit; }

final class Ranking
{
    const KEY = 'rank:top';
    const SIZE = 20;

    private static function ttl(): int
    {
        return max(0, (int) Config::get('cache.ranking_ttl', 60));
    }

    private static function cached(): bool
    {
        return self::ttl() > 0 && class_exists('Tfm\\Cache') && Cache::available();
    }

    /** ['at' => ms, 'total' => active players, 'rows' => [[userId, nickname, level, exp, title], …]] (at most 20 rows) */
    public static function top(int $now): array
    {
        $use = false;
        try { $use = self::cached(); } catch (\Throwable $e) { $use = false; }
        $old = null;
        $locked = false;
        if ($use) {
            try {
                $old = Cache::get(self::KEY);
                if (!is_array($old) || !isset($old['at'], $old['rows'], $old['total']) || !is_array($old['rows'])) $old = null;
                if ($old !== null) {
                    if ($now - (int) $old['at'] < self::ttl() * 1000) return $old;
                    // due: this request renews it when it gets the lock; the others answer from the copy meanwhile
                    $locked = Cache::lock(self::KEY, 15);
                    if (!$locked) return $old;
                }
            } catch (\Throwable $e) { $old = null; }
        }
        try {
            $rows = [];
            foreach (Db::all("SELECT p.user_id, u.nickname, p.level, p.exp_total, p.title
                FROM user_profiles p JOIN users u ON u.id = p.user_id
                WHERE u.status = 'active' AND (p.exp_total > 0 OR p.level > 1)
                ORDER BY p.level DESC, p.exp_total DESC, p.updated_at ASC, p.user_id ASC LIMIT 20") as $r) { // 20 = self::SIZE
                $rows[] = [(int) $r['user_id'], (string) $r['nickname'], (int) $r['level'], (int) $r['exp_total'], (string) $r['title']];
            }
            $top = ['at' => $now, 'total' => (int) Db::value("SELECT COUNT(*) FROM user_profiles p JOIN users u ON u.id = p.user_id WHERE u.status = 'active'"), 'rows' => $rows];
            if ($use) { try { Cache::set(self::KEY, $top, self::ttl() * 5 + 60); } catch (\Throwable $e) { /* asked again next time */ } }
            return $top;
        } finally {
            if ($locked) { try { Cache::unlock(self::KEY); } catch (\Throwable $e) { /* the lock ends by itself */ } }
        }
    }

    /**
     * The player's own place in the same order as the list (ties: who got there first, then the lower id), or null
     * when the account has no profile row. ['rank', 'level', 'exp'].
     */
    public static function mine(int $uid, array $top): ?array
    {
        foreach ($top['rows'] as $i => $r) {
            if ((int) $r[0] === $uid) return ['rank' => $i + 1, 'level' => (int) $r[2], 'exp' => (int) $r[3]];
        }
        $use = false;
        try { $use = self::cached(); } catch (\Throwable $e) { $use = false; }
        if ($use) {
            try {
                $m = Cache::get('rank:me:' . $uid);
                if (is_array($m) && isset($m['rank'], $m['level'], $m['exp'])) return ['rank' => (int) $m['rank'], 'level' => (int) $m['level'], 'exp' => (int) $m['exp']];
            } catch (\Throwable $e) { /* ask the database */ }
        }
        $p = Db::one('SELECT level, exp_total, updated_at FROM user_profiles WHERE user_id = ?', [$uid]);
        if (!$p) return null;
        $lv = (int) $p['level'];
        $xp = (int) $p['exp_total'];
        $up = (int) $p['updated_at'];
        $above = (int) Db::value("SELECT COUNT(*) FROM user_profiles p JOIN users u ON u.id = p.user_id WHERE u.status = 'active' AND p.user_id <> ?
            AND (p.level > ? OR (p.level = ? AND (p.exp_total > ? OR (p.exp_total = ? AND (p.updated_at < ? OR (p.updated_at = ? AND p.user_id < ?))))))",
            [$uid, $lv, $lv, $xp, $xp, $up, $up, $uid]);
        $mine = ['rank' => $above + 1, 'level' => $lv, 'exp' => $xp];
        if ($use) { try { Cache::set('rank:me:' . $uid, $mine, self::ttl()); } catch (\Throwable $e) { /* asked again next time */ } }
        return $mine;
    }

    /** an accepted save of this player (level and cumulative exp as stored): see the header */
    public static function saved(int $uid, int $level, int $exp): void
    {
        try {
            if (!self::cached()) return;
            Cache::del('rank:me:' . $uid);
            $top = Cache::get(self::KEY);
            if (!is_array($top) || !isset($top['rows']) || !is_array($top['rows'])) return;
            $rows = $top['rows'];
            $drop = false;
            foreach ($rows as $r) {
                if ((int) $r[0] === $uid) { $drop = true; break; }
            }
            if (!$drop && ($exp > 0 || $level > 1)) {
                if (count($rows) < self::SIZE) $drop = true;
                else {
                    $last = $rows[count($rows) - 1];
                    $drop = $level > (int) $last[2] || ($level === (int) $last[2] && $exp >= (int) $last[3]);
                }
            }
            // not deleted but marked due: the next request renews it (one at a time), nobody waits meanwhile
            if ($drop) {
                Cache::mutate(self::KEY, static function ($v) { return is_array($v) ? ['at' => 0] + $v : null; }, self::ttl() * 5 + 60);
            }
        } catch (\Throwable $e) { /* the list renews itself within a minute */ }
    }

    /** an account was banned, renamed or changed its role: the shared list is asked again */
    public static function forget(): void
    {
        try { if (class_exists('Tfm\\Cache')) Cache::del(self::KEY); } catch (\Throwable $e) { /* expires by itself */ }
    }
}
