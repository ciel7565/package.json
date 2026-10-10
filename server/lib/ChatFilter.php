<?php
/**
 * Chat text hygiene: normalization and bad-word masking (mirrors the client filter in 60-social.js:
 * letters may be separated by spaces/punctuation, matches are replaced with '♡♡').
 */
declare(strict_types=1);

namespace Tfm;

if (!defined('TFM_BOOT')) { http_response_code(404); exit; }

final class ChatFilter
{
    private static ?string $re = null;

    private static function regex(): ?string
    {
        if (self::$re !== null) return self::$re === '' ? null : self::$re;
        $words = array_values(array_filter(array_map(fn ($w) => trim((string) $w), (array) Config::get('chat.bad_words', [])), 'strlen'));
        if (!$words) { self::$re = ''; return null; }
        usort($words, fn ($a, $b) => mb_strlen($b) <=> mb_strlen($a));
        $parts = [];
        foreach ($words as $w) {
            $chars = preg_split('//u', $w, -1, PREG_SPLIT_NO_EMPTY) ?: [];
            $parts[] = implode('[\s._\-*~!@#^]*', array_map(fn ($c) => preg_quote($c, '/'), $chars));
        }
        self::$re = '/' . implode('|', $parts) . '/iu';
        return self::$re;
    }

    public static function mask(string $text): string
    {
        $re = self::regex();
        if (!$re) return $text;
        $out = preg_replace($re, '♡♡', $text);
        return $out ?? $text;
    }

    public static function containsBadWord(string $text): bool
    {
        $re = self::regex();
        return $re ? (bool) preg_match($re, $text) : false;
    }

    /** key for repeat-spam detection: case-folded, no spaces/punctuation, repeated chars squashed */
    public static function key(string $text): string
    {
        $k = mb_strtolower($text);
        $k = preg_replace('/[\s\p{P}\p{S}]+/u', '', $k) ?? $k;
        $k = preg_replace('/(.)\1{2,}/u', '$1$1', $k) ?? $k;
        if ($k === '') $k = mb_strtolower($text); // emoji-only messages
        return mb_substr($k, 0, 200);
    }
}
