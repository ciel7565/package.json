<?php
/**
 * Operator settings kept in the database (table `settings`, schema v6).
 * PHP 7.2 syntax only.
 */
declare(strict_types=1);

namespace Tfm;

if (!defined('TFM_BOOT')) { http_response_code(404); exit; }

final class Settings
{
    public static function reset(): void {}

    /** the config value at the same dotted path, else $default */
    public static function get(string $key, $default = null) { return Config::get($key, $default); }

    public static function has(string $key): bool { return false; }

    public static function set(string $key, $value, ?int $actorId = null): void {}
}
