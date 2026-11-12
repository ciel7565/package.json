<?php
/**
 * PHP 7.2 compatibility layer — loaded first by lib/bootstrap.php (CONTRACT §14.5).
 *
 *  - Global polyfills (guarded by function_exists) for the string / array helpers that newer PHP versions ship,
 *    so anything that calls them keeps working on PHP 7.2 (XAMPP 7.2.10 is the target hosting).
 *  - The Tfm\Str / Tfm\Arr helpers the server code itself uses. The code never calls the 8.x names directly:
 *    every file under server/ must lint clean against PHP 7.2 (tools/php-compat.sh → PHPCompatibility 7.2-).
 *
 * Only PHP ≥ 7.2 syntax is allowed anywhere under server/: no arrow functions, match, ??=, typed properties,
 * union types, nullsafe operator, named arguments, constructor promotion, trailing commas in calls, enums…
 */
declare(strict_types=1);

namespace {
    if (!defined('TFM_BOOT')) { if (function_exists('header_remove')) header_remove('X-Powered-By'); http_response_code(404); exit; }

    if (!function_exists('str_contains')) {
        function str_contains(string $haystack, string $needle): bool { return $needle === '' || strpos($haystack, $needle) !== false; }
    }
    if (!function_exists('str_starts_with')) {
        function str_starts_with(string $haystack, string $needle): bool { return $needle === '' || strncmp($haystack, $needle, strlen($needle)) === 0; }
    }
    if (!function_exists('str_ends_with')) {
        function str_ends_with(string $haystack, string $needle): bool
        {
            if ($needle === '') return true;
            $n = strlen($needle);
            return strlen($haystack) >= $n && substr_compare($haystack, $needle, -$n) === 0;
        }
    }
    if (!function_exists('array_key_first')) {
        function array_key_first(array $a) { foreach ($a as $k => $v) return $k; return null; }
    }
    if (!function_exists('array_key_last')) {
        function array_key_last(array $a) { return $a ? key(array_slice($a, -1, 1, true)) : null; }
    }
    if (!function_exists('array_is_list')) {
        function array_is_list(array $a): bool { $i = 0; foreach ($a as $k => $v) { if ($k !== $i++) return false; } return true; }
    }
    if (!function_exists('is_countable')) {
        function is_countable($v): bool { return is_array($v) || $v instanceof \Countable; }
    }
    if (!function_exists('mb_str_split')) {
        function mb_str_split(string $s, int $len = 1, string $enc = 'UTF-8'): array
        {
            if ($len < 1) return [];
            $chars = preg_split('//u', $s, -1, PREG_SPLIT_NO_EMPTY);
            if ($chars === false) return [];
            if ($len === 1) return $chars;
            return array_map('implode', array_chunk($chars, $len));
        }
    }
}

namespace Tfm {
    /** string helpers (PHP 7.2 safe; the 8.x built-ins are never called by server code) */
    final class Str
    {
        public static function contains(string $haystack, string $needle): bool { return $needle === '' || strpos($haystack, $needle) !== false; }
        public static function startsWith(string $haystack, string $needle): bool { return $needle === '' || strncmp($haystack, $needle, strlen($needle)) === 0; }
        public static function endsWith(string $haystack, string $needle): bool
        {
            if ($needle === '') return true;
            $n = strlen($needle);
            return strlen($haystack) >= $n && substr_compare($haystack, $needle, -$n) === 0;
        }
        /** one array element per code point (what mb_str_split($s, 1) gives on 7.4+) */
        public static function chars(string $s): array
        {
            $c = preg_split('//u', $s, -1, PREG_SPLIT_NO_EMPTY);
            return $c === false ? [] : $c;
        }
        /** substr() that always returns a string (PHP 7 returns false for an empty result; strict_types would then break strtolower() etc.) */
        public static function sub(string $s, int $start, ?int $len = null): string
        {
            $r = $len === null ? substr($s, $start) : substr($s, $start, $len);
            return $r === false ? '' : $r;
        }
    }

    /** array helpers */
    final class Arr
    {
        public static function isList(array $a): bool { $i = 0; foreach ($a as $k => $v) { if ($k !== $i++) return false; } return true; }
        public static function firstKey(array $a) { foreach ($a as $k => $v) return $k; return null; }
        public static function lastKey(array $a) { return $a ? key(array_slice($a, -1, 1, true)) : null; }
    }
}
