<?php
/**
 * Chat text hygiene: normalization and bad-word masking (mirrors the client filter in 60-social.js).
 *  - letters may be glued with punctuation anywhere ("s.h.i.t", "시.발", "bullshit"),
 *  - whitespace may split a word only when the whole word stands alone ("f u c k", "개 새끼"), so innocent
 *    text such as "this hit" or "그 병 신경" is left alone,
 *  - allow-listed real words (시발점, 시발역, …) are never masked; matches are replaced with '♡♡'.
 */
declare(strict_types=1);

namespace Tfm;

if (!defined('TFM_BOOT')) { http_response_code(404); exit; }

final class ChatFilter
{
    private static ?string $re = null;
    private const DEFAULT_ALLOW = ['시발점', '시발역', '시발택시', '시발자동차'];

    private static function regex(): ?string
    {
        if (self::$re !== null) return self::$re === '' ? null : self::$re;
        $words = array_values(array_filter(array_map(fn ($w) => trim((string) $w), (array) Config::get('chat.bad_words', [])), 'strlen'));
        if (!$words) { self::$re = ''; return null; }
        usort($words, fn ($a, $b) => mb_strlen($b) <=> mb_strlen($a));
        $tight = '[._\-*~!@#^]*';
        $loose = '(?:\s+|[._\-*~!@#^]+)?';
        $parts = [];
        foreach ($words as $w) {
            $chars = array_map(fn ($c) => preg_quote($c, '/'), preg_split('//u', $w, -1, PREG_SPLIT_NO_EMPTY) ?: []);
            if (!$chars) continue;
            $parts[] = implode($tight, $chars);
            if (count($chars) > 1) $parts[] = '(?<![\p{L}\p{N}])' . implode($loose, $chars) . '(?![\p{L}\p{N}])';
        }
        self::$re = $parts ? '/' . implode('|', $parts) . '/iu' : '';
        return self::$re === '' ? null : self::$re;
    }

    /** byte ranges of allow-listed words in $text */
    private static function allowRanges(string $text): array
    {
        $ranges = [];
        foreach ((array) Config::get('chat.allow_words', self::DEFAULT_ALLOW) as $w) {
            $w = (string) $w;
            if ($w === '') continue;
            for ($i = strpos($text, $w); $i !== false; $i = strpos($text, $w, $i + 1)) $ranges[] = [$i, $i + strlen($w)];
        }
        return $ranges;
    }

    private static function allowed(array $ranges, int $start, int $len): bool
    {
        foreach ($ranges as [$a, $b]) if ($start >= $a && $start + $len <= $b) return true;
        return false;
    }

    public static function mask(string $text): string
    {
        $re = self::regex();
        if (!$re) return $text;
        $allow = self::allowRanges($text);
        $out = preg_replace_callback($re, fn ($m) => self::allowed($allow, $m[0][1], strlen($m[0][0])) ? $m[0][0] : '♡♡', $text, -1, $count, PREG_OFFSET_CAPTURE);
        return $out ?? $text;
    }

    public static function containsBadWord(string $text): bool
    {
        $re = self::regex();
        if (!$re || !preg_match_all($re, $text, $all, PREG_OFFSET_CAPTURE)) return false;
        $allow = self::allowRanges($text);
        foreach ($all[0] as [$s, $off]) if (!self::allowed($allow, $off, strlen($s))) return true;
        return false;
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
