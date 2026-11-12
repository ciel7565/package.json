<?php
/**
 * Tfm\V — server-side input validation (CONTRACT §15.7 #3). Nothing the browser checked is trusted: every endpoint
 * passes every input through these helpers (type, length, range, enum, known keys). Every failure is the same error:
 * ApiException 400 INVALID_INPUT with a Korean message that names the field and data.field — never a PHP type error.
 *
 *   $b = $c->json(4096);                          // JSON object, depth ≤ 32, size cap (Http::json)
 *   V::keys($b, ['text', 'channel']);             // unknown keys are refused
 *   $text = V::str($b['text'] ?? null, 'text', 1000);
 *   $channel = V::has($b, 'channel') ? V::enum($b['channel'], 'channel', ['all', 'local']) : 'all';
 *   $after = V::int(V::query('after', '0'), 'after', 0, V::INT_MAX);
 *
 * V::probe() recognises obviously hostile strings (SQL injection, XSS, path traversal). It is used for logging only
 * (SecEvent probe_* events, Firewall::noteAttack) — the protection is prepared statements, output escaping and fixed
 * paths, never this pattern list.
 * PHP 7.2 syntax only.
 */
declare(strict_types=1);

namespace Tfm;

if (!defined('TFM_BOOT')) { if (function_exists('header_remove')) header_remove('X-Powered-By'); http_response_code(404); exit; }

final class V
{
    /** the largest integer a JSON number carries exactly (2^53 − 1) */
    public const INT_MAX = 9007199254740991;

    /** @var bool one probe event per request is enough */
    private static $probed = false;

    /** field names are code constants; a key taken from the request is reduced to harmless characters */
    private static function name(string $field): string
    {
        $f = (string) preg_replace('/[^A-Za-z0-9_.\-\[\]]/', '', $field);
        return $f === '' ? '?' : substr($f, 0, 40);
    }

    /** @throws ApiException always */
    public static function fail(string $field, string $why)
    {
        $f = self::name($field);
        throw new ApiException(400, 'INVALID_INPUT', "‘{$f}’ " . $why, ['field' => $f]);
    }

    /** a string of $min..$max characters (code points), valid UTF-8, no NUL byte; returned unchanged */
    public static function str($v, string $field, int $max, int $min = 0): string
    {
        if (!is_string($v)) self::fail($field, '값은 글자로 보내 주세요.');
        if (strpos($v, "\0") !== false || !mb_check_encoding($v, 'UTF-8')) self::fail($field, '값에 쓸 수 없는 글자가 들어 있어요.');
        // strlen first: a huge string never reaches mb_strlen (4 bytes per character at most)
        if (strlen($v) > $max * 4 || mb_strlen($v) > $max) self::fail($field, "값이 너무 길어요. (최대 {$max}자)");
        if ($min > 0 && mb_strlen($v) < $min) self::fail($field, $v === '' ? '값을 입력해 주세요.' : "값이 너무 짧아요. (최소 {$min}자)");
        return $v;
    }

    /** an integer in $min..$max: a JSON integer, or a canonical digit string (query parameters) */
    public static function int($v, string $field, int $min, int $max): int
    {
        if (is_string($v) && preg_match('/^(?:0|-?[1-9]\d{0,17})$/', $v)) $v = (int) $v;
        if (!is_int($v) || $v < $min || $v > $max) self::fail($field, "값은 {$min}~{$max} 사이의 정수여야 해요.");
        return $v;
    }

    /** a finite JSON number in $min..$max */
    public static function num($v, string $field, float $min, float $max): float
    {
        if ((!is_int($v) && !is_float($v)) || !is_finite((float) $v) || $v < $min || $v > $max) {
            self::fail($field, '값은 ' . self::fmt($min) . '~' . self::fmt($max) . ' 사이의 숫자여야 해요.');
        }
        return (float) $v;
    }

    private static function fmt(float $n): string
    {
        return rtrim(rtrim(number_format($n, 3, '.', ''), '0'), '.');
    }

    /** a real boolean (true / false) */
    public static function bool($v, string $field): bool
    {
        if (!is_bool($v)) self::fail($field, '값은 참(true) 또는 거짓(false)으로 보내 주세요.');
        return $v;
    }

    /** one of $allowed, compared strictly (no type juggling) */
    public static function enum($v, string $field, array $allowed)
    {
        if ((!is_string($v) && !is_int($v)) || !in_array($v, $allowed, true)) self::fail($field, '값이 올바르지 않아요.');
        return $v;
    }

    /** exactly $len hexadecimal characters, returned in lower case */
    public static function hex($v, string $field, int $len): string
    {
        if (!is_string($v) || strlen($v) !== $len || !ctype_xdigit($v)) self::fail($field, "값은 {$len}자리 16진수여야 해요.");
        return strtolower($v);
    }

    /** a positive row id: a JSON integer or a digit string */
    public static function id($v, string $field): int
    {
        if (is_string($v) && preg_match('/^[1-9]\d{0,15}$/', $v)) $v = (int) $v;
        if (!is_int($v) || $v < 1 || $v > self::INT_MAX) self::fail($field, '값은 번호(1 이상의 정수)여야 해요.');
        return $v;
    }

    /** an array (list or object) with at most $maxItems entries */
    public static function arr($v, string $field, int $maxItems): array
    {
        if (!is_array($v)) self::fail($field, '값은 목록으로 보내 주세요.');
        if (count($v) > $maxItems) self::fail($field, "항목이 너무 많아요. (최대 {$maxItems}개)");
        return $v;
    }

    // ------------------------------------------------------------------ request shapes

    /** is the key present with a value (JSON null counts as "not sent") */
    public static function has(array $b, string $key): bool
    {
        return array_key_exists($key, $b) && $b[$key] !== null;
    }

    /** a decoded JSON object may only carry the keys this endpoint knows (an unknown shape is refused) */
    public static function keys(array $b, array $allowed, string $what = 'body'): void
    {
        if ($b !== [] && Arr::isList($b)) self::fail($what, '값은 { } 모양으로 보내 주세요.');
        foreach ($b as $k => $unused) {
            if (!in_array((string) $k, $allowed, true)) self::fail((string) $k, '항목은 여기에서 쓸 수 없어요.');
        }
    }

    /** one query-string value: a string (≤ 2048 bytes) or $default when absent; ?key[]=… is refused */
    public static function query(string $key, ?string $default = null): ?string
    {
        if (!isset($_GET[$key])) return $default;
        $v = $_GET[$key];
        if (!is_string($v) || strlen($v) > 2048 || strpos($v, "\0") !== false) self::fail($key, '값이 올바르지 않아요.');
        return $v;
    }

    // ------------------------------------------------------------------ hostile-looking input (logging only)

    private const SQLI = '/\bunion\b(?:\s+all)?\s+select\b'
        . '|\'\s*(?:or|and)\s+[\'"]?\w+[\'"]?\s*(?:=|<|>|\blike\b)\s*[\'"]?\w+'
        . '|\b(?:or|and)\s+\d+\s*=\s*\d+\b'
        . '|\'\s*(?:--(?:\s|$)|\/\*|;\s*--)'
        . '|;\s*(?:drop|truncate|alter|create)\s+(?:table|database|user)\b'
        . '|;\s*(?:delete\s+from|insert\s+into|update\s+\w+\s+set)\b'
        . '|\b(?:sleep|benchmark|pg_sleep)\s*\(\s*\d'
        . '|\bwaitfor\s+delay\b|\binformation_schema\b|\bxp_cmdshell\b|\bload_file\s*\(|\binto\s+(?:out|dump)file\b/i';

    private const XSS = '/<\s*\/?\s*script\b'
        . '|<[a-z][^>]{0,300}\bon[a-z]{3,24}\s*='
        . '|<\s*(?:iframe|object|embed|svg|math|base|meta|link)\b'
        . '|\b(?:java|vb)script\s*:\s*[\w(\/\[]'
        . '|\bdata\s*:\s*text\/html|\bsrcdoc\s*=|\bdocument\s*\.\s*(?:cookie|domain|write)\b|\bexpression\s*\(/i';

    private const TRAVERSAL = '/(?:\.{2,}[\/\\\\]+){2,}'
        . '|\.\.(?:%2f|%5c|%252f|%255c)|%2e%2e(?:%2f|%5c|\/|\\\\)'
        . '|\/etc\/(?:passwd|shadow|hosts|group)\b|\/proc\/self\/|[\/\\\\]windows[\/\\\\](?:win\.ini|system32)|\bboot\.ini\b'
        . '|\b(?:php:\/\/(?:filter|input|stdin|memory|temp)|file:\/\/\/|expect:\/\/|phar:\/\/|zip:\/\/)'
        . '|\x00|%00/i';

    /** 'probe_sqli' | 'probe_xss' | 'probe_traversal' for obviously hostile input, else null */
    public static function probe(string $value): ?string
    {
        if ($value === '') return null;
        $s = strlen($value) > 4096 ? substr($value, 0, 4096) : $value;
        if (preg_match(self::SQLI, $s) === 1) return 'probe_sqli';
        if (preg_match(self::XSS, $s) === 1) return 'probe_xss';
        if (preg_match(self::TRAVERSAL, $s) === 1) return 'probe_traversal';
        return null;
    }

    /**
     * Look at the strings of a small request (JSON body, query string) and return the first hit:
     * ['kind' => probe_*, 'field' => key, 'sample' => first 80 characters] or null. Bounded work: 200 strings, depth 6.
     */
    public static function scan($data, string $field = '', int $depth = 0, int &$budget = 200): ?array
    {
        if (is_string($data)) {
            if ($budget-- <= 0) return null;
            $kind = self::probe($data);
            if ($kind === null) return null;
            $sample = (string) preg_replace('/[\x00-\x1f\x7f]+/', ' ', substr($data, 0, 80));
            if (!mb_check_encoding($sample, 'UTF-8')) $sample = (string) mb_convert_encoding($sample, 'UTF-8', 'UTF-8');
            return ['kind' => $kind, 'field' => self::name($field), 'sample' => $sample];
        }
        if (!is_array($data) || $depth >= 6) return null;
        foreach ($data as $k => $v) {
            if ($budget <= 0) return null;
            if (is_string($k) && strlen($k) > 2 && ($kind = self::probe($k)) !== null) return ['kind' => $kind, 'field' => 'key', 'sample' => substr(self::name($k), 0, 80)];
            $hit = self::scan($v, $field === '' ? (string) $k : $field . '.' . $k, $depth + 1, $budget);
            if ($hit !== null) return $hit;
        }
        return null;
    }

    /**
     * Log hostile-looking input of this request once (SecEvent probe_* + Firewall::noteAttack). The request itself
     * continues: validation, prepared statements and escaping are the protection. Never throws.
     */
    public static function watch($data, string $source): void
    {
        if (self::$probed) return;
        try {
            $hit = self::scan($data);
            if ($hit === null) return;
            self::$probed = true;
            if (class_exists('Tfm\SecEvent')) {
                SecEvent::log($hit['kind'], 'warn', ['in' => $source, 'field' => $hit['field'], 'sample' => $hit['sample']]);
            } else {
                Log::security('PROBE', $hit['kind'], ['in' => $source, 'field' => $hit['field']]);
            }
        } catch (\Throwable $e) { /* logging only */ }
    }

    /** tests: forget that this process already reported a probe */
    public static function resetWatch(): void { self::$probed = false; }
}
