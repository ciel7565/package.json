<?php
/**
 * Operator settings kept in the database (table `settings`, schema v6) — values an admin changes from the admin site
 * without editing files: the real-time farm time scale (`farm.rt_scale`), the kid AI helper switch (`ai.kid_helper`) …
 * A missing row falls back to the config file value, so config.php stays the documented default.
 * Values are JSON-encoded scalars. Never store secrets here (keys live in config.local.php / the environment).
 * PHP 7.2 syntax only.
 */
declare(strict_types=1);

namespace Tfm;

if (!defined('TFM_BOOT')) { if (function_exists('header_remove')) header_remove('X-Powered-By'); http_response_code(404); exit; }

final class Settings
{
    /** @var array|null request-local cache of every row */
    private static $cache = null;

    /** keys an admin may change, with their validators (anything else is refused) */
    private const KEYS = [
        'farm.rt_scale'   => 'float:0.1:3600',
        'ai.kid_helper'   => 'bool',
        'security.notice' => 'str:200',
    ];

    public static function reset(): void { self::$cache = null; self::forgetShared(); }

    /** [scale-server] drop the copy in the shared cache (a row was written): the next read asks the database */
    private static function forgetShared(): void
    {
        try { if (class_exists('Tfm\\Cache', false)) Cache::del('cfg:settings'); } catch (\Throwable $e) { /* expires in seconds */ }
    }

    private static function load(): array
    {
        if (self::$cache !== null) return self::$cache;
        // [scale-server] CONTRACT §16.9: the rows are kept in the shared cache for cache.settings_ttl seconds (30), so a
        // request that only needs a setting (ping: the farm time scale) asks the database nothing. set() and reset()
        // drop the copy at once; on a second web server with a memory cache a change shows after those seconds.
        $ttl = 0;
        try {
            $ttl = class_exists('Tfm\\Cache') ? (int) Config::get('cache.settings_ttl', 30) : 0;
            if ($ttl > 0) { $c = Cache::get('cfg:settings'); if (is_array($c)) return self::$cache = $c; }
        } catch (\Throwable $e) { $ttl = 0; }
        $out = [];
        try {
            foreach (Db::all('SELECT k, v FROM settings') as $r) {
                $out[(string) $r['k']] = Json::tryDecode((string) $r['v'], true);
            }
            if ($ttl > 0) { try { Cache::set('cfg:settings', $out, $ttl); } catch (\Throwable $e) { /* read again next time */ } }
        } catch (\Throwable $e) {
            $out = []; // a database that has not been upgraded to v6 yet: the config defaults apply
        }
        return self::$cache = $out;
    }

    /** the stored value, else the config value at the same dotted path, else $default */
    public static function get(string $key, $default = null)
    {
        $all = self::load();
        if (array_key_exists($key, $all) && $all[$key] !== null) return $all[$key];
        return Config::get($key, $default);
    }

    public static function has(string $key): bool
    {
        return array_key_exists($key, self::load());
    }

    /** validate + store one setting; throws ApiException 400 INVALID_SETTING for an unknown key or a bad value */
    public static function set(string $key, $value, ?int $actorId = null): void
    {
        if (!isset(self::KEYS[$key])) throw new ApiException(400, 'INVALID_SETTING', '바꿀 수 없는 설정이에요.');
        $value = self::clean(self::KEYS[$key], $value);
        $json = json_encode($value, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        if (!is_string($json)) throw new ApiException(400, 'INVALID_SETTING', '설정 값을 저장하지 못했어요.');
        Db::upsert('settings', ['k' => $key, 'v' => $json, 'updated_at' => Clock::ms(), 'updated_by' => $actorId ?: null], ['k']);
        self::$cache = null;
        self::forgetShared(); // [scale-server]
        Audit::log('setting_changed', $actorId, ['key' => $key, 'value' => $value], 'warn', $actorId);
    }

    /** @return mixed the cleaned value */
    private static function clean(string $rule, $value)
    {
        $p = explode(':', $rule);
        if ($p[0] === 'bool') {
            if (is_bool($value)) return $value;
            if (is_string($value) || is_int($value)) return in_array(strtolower(trim((string) $value)), ['1', 'true', 'on', 'yes'], true);
        } elseif ($p[0] === 'float') {
            if (is_string($value)) $value = trim($value);
            if (is_numeric($value)) {
                $f = (float) $value;
                $min = isset($p[1]) ? (float) $p[1] : -INF;
                $max = isset($p[2]) ? (float) $p[2] : INF;
                if (is_finite($f) && $f >= $min && $f <= $max) return round($f, 4);
            }
        } elseif ($p[0] === 'str') {
            if (is_string($value)) return Users::cleanText($value, isset($p[1]) ? (int) $p[1] : 200);
        }
        throw new ApiException(400, 'INVALID_SETTING', '설정 값이 올바르지 않아요.');
    }
}
