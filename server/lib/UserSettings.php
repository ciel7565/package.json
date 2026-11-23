<?php
/**
 * Tfm\UserSettings — what a player chose in the settings window, kept for the next login and the next device
 * (CONTRACT §18.2, lane settings).
 *
 * WHAT IS KEPT: one JSON blob per account (table user_settings, schema v9):
 *     { acct: { <option id>: value, … },                         account-scope options (sound, text size, keys …)
 *       dev:  { <device id>: { t: <unix seconds>, s: { <option id>: value } }, … } }   device-scope options per device
 *   ≤ 8 KB, ≤ 5 devices (the newest t win), ≤ 200 options per map. Nothing anybody typed, no personal data.
 * CHECKED AGAINST: the option table of this build (data/game-data.json → settings, exported from
 *   src/game/68-settings.js): a known id keeps only a value of its type and range (b: true / false, n: a JSON number
 *   inside [min, max], e: one of its words); key_<action> ids keep a list of ≤ 4 key codes; an id the table does not know
 *   (an option a later part of the app declared) keeps only a short plain value (bool, a finite number, ≤ 40 letters of
 *   [A-Za-z0-9_.:-]). Anything else is dropped, never stored. A device id is a letter and 11 of [a-z0-9].
 * VERSIONS: a save carries v; it is taken only when v is higher than the stored version (the last write wins, in one
 *   statement), else 409 SETTINGS_STALE with data {v: the stored version} — the app then sends again with a higher v.
 *
 *   UserSettings::get(int $uid): array                 api/settings/get.php  → { v, data, updatedAt }
 *   UserSettings::save(array $user, array $body): array api/settings/save.php → { v, dropped }
 *   UserSettings::clean($data, int &$dropped): array   → ['acct' => …, 'dev' => …] | ApiException 400 SETTINGS_INVALID
 *   UserSettings::forget(int $uid): void               the row of an account goes (account deletion, tests)
 *   UserSettings::ensure(): void                       the table exists (a database migrated to v9 before it was added)
 * PHP 7.2 syntax only.
 */
declare(strict_types=1);

namespace Tfm;

if (!defined('TFM_BOOT')) { if (function_exists('header_remove')) header_remove('X-Powered-By'); http_response_code(404); exit; }

final class UserSettings
{
    public const MAX_BYTES = 8192;
    public const DEVICES = 5;
    public const MAX_OPTIONS = 200;
    private const ID_RE = '/^[A-Za-z][A-Za-z0-9_]{0,39}$/';
    private const DEV_RE = '/^[a-z][a-z0-9]{11}$/';
    private const CODE_RE = '/^[A-Za-z0-9]{1,24}$/';
    private const WORD_RE = '/^[A-Za-z0-9_.:\-]{0,40}$/';
    private const BAD_IDS = ['__proto__', 'constructor', 'prototype'];

    /** @var array|null the option table of this request */
    private static $table = null;
    /** @var bool the table was checked this request */
    private static $ensured = false;

    /** the option table as game-data.json has it ([] when this build has none: then only plain values are kept) */
    public static function table(): array
    {
        if (self::$table !== null) return self::$table;
        $all = GameData::all();
        $t = isset($all['settings']) && is_array($all['settings']) ? $all['settings'] : [];
        self::$table = isset($t['options']) && is_array($t['options']) ? $t['options'] : [];
        return self::$table;
    }

    /** tests: forget the cached table */
    public static function resetCache(): void { self::$table = null; self::$ensured = false; }

    /** the table exists (CREATE TABLE IF NOT EXISTS: a database that reached v9 before this lane added it) */
    public static function ensure(): void
    {
        if (self::$ensured) return;
        self::$ensured = true;
        if (Db::hasTable('user_settings')) return;
        if (Db::driver() === 'mysql') {
            Db::exec('CREATE TABLE IF NOT EXISTS user_settings (user_id BIGINT UNSIGNED NOT NULL PRIMARY KEY, v INT NOT NULL DEFAULT 0, data TEXT NOT NULL, updated_at BIGINT NOT NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC');
        } else {
            Db::exec("CREATE TABLE IF NOT EXISTS user_settings (user_id INTEGER PRIMARY KEY, v INTEGER NOT NULL DEFAULT 0, data TEXT NOT NULL DEFAULT '', updated_at INTEGER NOT NULL)");
        }
        Log::info('DB', 'user_settings created on first use');
    }

    /** the stored blob of an account: { v, data: {acct, dev}, updatedAt } (v 0 and empty maps when nothing was saved) */
    public static function get(int $uid): array
    {
        self::ensure();
        $row = $uid > 0 ? Db::one('SELECT v, data, updated_at FROM user_settings WHERE user_id = ?', [$uid]) : null;
        $data = ['acct' => new \stdClass(), 'dev' => new \stdClass()];
        if ($row) {
            $d = Json::tryDecode((string) $row['data']);
            if (is_array($d)) {
                $n = 0;
                try { $c = self::clean($d, $n); } catch (ApiException $e) { $c = ['acct' => [], 'dev' => []]; }
                $data = ['acct' => $c['acct'] ? $c['acct'] : new \stdClass(), 'dev' => $c['dev'] ? $c['dev'] : new \stdClass()];
            }
        }
        return ['v' => $row ? (int) $row['v'] : 0, 'data' => $data, 'updatedAt' => $row ? (int) $row['updated_at'] : 0];
    }

    private static function bad(string $field, string $why = '설정 값이 올바르지 않아요.')
    {
        $f = (string) preg_replace('/[^A-Za-z0-9_.\-\[\]]/', '', $field);
        throw new ApiException(400, 'SETTINGS_INVALID', '설정을 저장할 수 없어요. ' . $why, ['field' => substr($f === '' ? '?' : $f, 0, 40)]);
    }

    /** a JSON object decoded as a PHP array with string keys (an empty JSON object / array both count as empty) */
    private static function isMap($v): bool
    {
        if (!is_array($v)) return false;
        if (!$v) return true;
        foreach ($v as $k => $_) { if (!is_string($k)) return false; }
        return true;
    }

    /** one value made fit for its option, or null (= dropped) */
    private static function fit(string $id, $v)
    {
        $t = self::table();
        if (isset($t[$id]) && is_array($t[$id])) {
            $o = $t[$id];
            $type = isset($o['t']) ? (string) $o['t'] : '';
            if ($type === 'b') return is_bool($v) ? $v : null;
            if ($type === 'n') {
                if ((!is_int($v) && !is_float($v)) || !is_finite((float) $v)) return null;
                $min = isset($o['min']) ? (float) $o['min'] : -1e9;
                $max = isset($o['max']) ? (float) $o['max'] : 1e9;
                $f = (float) $v;
                if ($f < $min - 1e-9 || $f > $max + 1e-9) return null;
                return is_int($v) ? $v : round($f, 6);
            }
            if ($type === 'e') {
                $vals = isset($o['values']) && is_array($o['values']) ? $o['values'] : [];
                return is_string($v) && in_array($v, $vals, true) ? $v : null;
            }
            return null;
        }
        if (strpos($id, 'key_') === 0) {
            if (!is_array($v) || count($v) > 4) return null;
            $out = [];
            foreach ($v as $k => $c) {
                if (!is_int($k) || !is_string($c) || !preg_match(self::CODE_RE, $c)) return null;
                if (!in_array($c, $out, true)) $out[] = $c;
            }
            return $out;
        }
        if (is_bool($v)) return $v;
        if (is_int($v)) return ($v >= -1000000 && $v <= 1000000) ? $v : null;
        if (is_float($v)) return (is_finite($v) && abs($v) <= 1e6) ? round($v, 6) : null;
        if (is_string($v)) return preg_match(self::WORD_RE, $v) ? $v : null;
        return null;
    }

    /** one option map { id: value } → the kept part; $dropped counts what was left out */
    private static function cleanMap($m, string $field, int &$dropped): array
    {
        if (!self::isMap($m)) self::bad($field, '설정 묶음의 모양이 달라요.');
        if (count($m) > self::MAX_OPTIONS) self::bad($field, '설정이 너무 많아요.');
        $out = [];
        foreach ($m as $id => $v) {
            $id = (string) $id;
            if (!preg_match(self::ID_RE, $id) || in_array($id, self::BAD_IDS, true)) { $dropped++; continue; }
            $f = self::fit($id, $v);
            if ($f === null) { $dropped++; continue; }
            $out[$id] = $f;
        }
        return $out;
    }

    /** the whole blob checked: ['acct' => map, 'dev' => [id => ['t' => int, 's' => map]]] (≤ 5 newest devices) */
    public static function clean($data, int &$dropped): array
    {
        if (!self::isMap($data)) self::bad('data', '설정 묶음의 모양이 달라요.');
        foreach (array_keys($data) as $k) { if ($k !== 'acct' && $k !== 'dev') self::bad('data', '모르는 칸이 있어요.'); }
        $acct = self::cleanMap(isset($data['acct']) ? $data['acct'] : [], 'acct', $dropped);
        $dev = [];
        $rawDev = isset($data['dev']) ? $data['dev'] : [];
        if (!self::isMap($rawDev) || count($rawDev) > 16) self::bad('dev', '기기 묶음의 모양이 달라요.');
        foreach ($rawDev as $id => $e) {
            $id = (string) $id;
            if (!preg_match(self::DEV_RE, $id)) { $dropped++; continue; }
            if (!self::isMap($e)) { $dropped++; continue; }
            foreach (array_keys($e) as $k) { if ($k !== 't' && $k !== 's') self::bad('dev.' . $id, '모르는 칸이 있어요.'); }
            $t = isset($e['t']) && is_int($e['t']) && $e['t'] >= 0 && $e['t'] <= 4102444800 ? $e['t'] : 0;
            $dev[$id] = ['t' => $t, 's' => self::cleanMap(isset($e['s']) ? $e['s'] : [], 'dev.' . $id . '.s', $dropped)];
        }
        if (count($dev) > self::DEVICES) {
            uasort($dev, static function ($a, $b) { return $b['t'] <=> $a['t']; });
            $dropped += count($dev) - self::DEVICES;
            $dev = array_slice($dev, 0, self::DEVICES, true);
        }
        return ['acct' => $acct, 'dev' => $dev];
    }

    /** api/settings/save.php: the caller's own blob (there is no way to name another account) */
    public static function save(array $user, array $body): array
    {
        $uid = (int) (isset($user['id']) ? $user['id'] : 0);
        if ($uid <= 0) throw new ApiException(401, 'AUTH_REQUIRED', '로그인이 필요해요.');
        if (!isset($body['v']) || !is_int($body['v'])) V::fail('v', '값은 1 이상의 정수여야 해요.');
        $v = V::int($body['v'], 'v', 1, 2000000000);
        if (!array_key_exists('data', $body)) V::fail('data', '설정 묶음이 없어요.');
        $dropped = 0;
        $c = self::clean($body['data'], $dropped);
        $data = Json::encode(['acct' => $c['acct'] ? $c['acct'] : new \stdClass(), 'dev' => $c['dev'] ? $c['dev'] : new \stdClass()], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
        if (strlen($data) > self::MAX_BYTES) throw new ApiException(413, 'PAYLOAD_TOO_LARGE', '설정이 너무 커요.');
        if ($dropped > 20) SecEvent::log('settings_dropped', 'info', ['dropped' => $dropped], $uid);
        self::ensure();
        $now = Clock::ms();
        // the last write wins: taken only when this v is higher than the stored one (v always changes → rows changed = 1)
        if (Db::exec('UPDATE user_settings SET v = ?, data = ?, updated_at = ? WHERE user_id = ? AND v < ?', [$v, $data, $now, $uid, $v]) === 1) {
            return ['v' => $v, 'dropped' => $dropped];
        }
        $cur = Db::value('SELECT v FROM user_settings WHERE user_id = ?', [$uid]);
        if ($cur === null) {
            try {
                Db::exec('INSERT INTO user_settings (user_id, v, data, updated_at) VALUES (?, ?, ?, ?)', [$uid, $v, $data, $now]);
                return ['v' => $v, 'dropped' => $dropped];
            } catch (\PDOException $e) {
                if ((string) $e->getCode() !== '23000') throw $e;
                $cur = Db::value('SELECT v FROM user_settings WHERE user_id = ?', [$uid]); // another request made the row first
            }
        }
        throw new ApiException(409, 'SETTINGS_STALE', '설정이 다른 기기에서 바뀌었어요. 다시 보낼게요.', ['v' => $cur === null ? 0 : (int) $cur]);
    }

    /** the row of an account goes (account deletion, tests) */
    public static function forget(int $uid): void
    {
        if ($uid <= 0) return;
        self::ensure();
        Db::exec('DELETE FROM user_settings WHERE user_id = ?', [$uid]);
    }
}
