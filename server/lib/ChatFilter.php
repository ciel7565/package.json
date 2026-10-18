<?php
/**
 * Chat text hygiene: bad-word masking and personal-information masking (mirrors the client filter in 60-social.js).
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

    // ------------------------------------------------------------------ personal information (kid safety, CONTRACT §12.4)
    // Mirror of the client engine in src/game/60-social.js ("PII ENGINE"). The ORDERED RULES are generated from the
    // client by tests/pii-sync.mjs into lib/pii-rules.json (one list for both sides); the fold below and the two
    // predicates (notCounting, wordDigits) are hand-mirrored and checked by the shared vectors in tests/pii-vectors.json
    // (tests/server-e2e.mjs + tests/pii-client.mjs, which also diff client vs server output).
    //
    // The text is cut into units, one per code point, each with the "folded" form the rules see (invisible / format
    // characters and combining marks vanish, NFKC, every digit script + dingbat / CJK numerals → ASCII digits,
    // lower case, O/l look-alikes inside digit tokens → 0/1, "k i d d i n o" spaced letters join). Every match is
    // mapped back to the ORIGINAL characters it covers, so only the masked part changes.
    public const PII_MARK = '🔒';
    private const PII_MAX = 400; // code points looked at (chat ≤ 120, reports ≤ 300)
    /** invisible characters removed by Users::cleanText (same list as INVISIBLE_RANGES in 60-social.js) */
    public const INVISIBLE_CLASS = '\x{0000}-\x{001F}\x{007F}-\x{009F}\x{00AD}\x{034F}\x{061C}\x{115F}-\x{1160}\x{17B4}-\x{17B5}\x{180E}\x{200B}-\x{200F}\x{202A}-\x{202E}\x{2060}-\x{206F}\x{3164}\x{FEFF}\x{FFA0}\x{FFF0}-\x{FFFB}\x{E0000}-\x{E007F}';

    private static ?array $rules = null;
    private static array $foldCache = [];

    /**
     * Ordered rules from lib/pii-rules.json: [name => [pcre, predicate|null]]. A missing / broken file is a deploy
     * error: it is logged and the built-in fallback (phones, e-mails, URLs) keeps the most important cases covered.
     */
    private static function piiPatterns(): array
    {
        if (self::$rules !== null) return self::$rules;
        $out = [];
        $file = __DIR__ . '/pii-rules.json';
        $j = is_file($file) ? json_decode((string) file_get_contents($file), true) : null;
        $list = is_array($j) && is_array($j['rules'] ?? null) ? $j['rules'] : [];
        foreach ($list as $r) {
            if (!is_array($r) || !is_string($r['src'] ?? null) || !is_string($r['name'] ?? null)) continue;
            $flags = preg_replace('/[^iu]/', '', (string) ($r['flags'] ?? 'u')) ?: 'u';
            if (!str_contains($flags, 'u')) $flags .= 'u';
            $re = '/' . $r['src'] . '/' . $flags;
            if (@preg_match($re, '') === false) { Log::error('CHAT', 'PII rule does not compile', ['rule' => $r['name']]); continue; }
            $pred = match ($r['pred'] ?? null) { 'piiNotCounting' => [self::class, 'notCounting'], 'piiWordDigits' => [self::class, 'wordDigits'], default => null };
            $out[$r['name']] = [$re, $pred];
        }
        if (!$out) {
            Log::error('CHAT', 'lib/pii-rules.json missing or empty — using the minimal fallback (run node tests/pii-sync.mjs)');
            $out = [
                'email' => ['/[\p{L}\p{N}._%+\-]+\s*(?:@|골뱅이)\s*[\p{L}\p{N}\-]+(?:\s*(?:\.|닷|쩜|점)\s*[a-z0-9]{2,})+/iu', null],
                'url' => ['/(?:https?:\/\/|www\.)[^\s<>"]+/iu', null],
                'phone' => ['/(?<![0-9])0[0-9](?:[^\p{L}\p{N}]{0,6}[0-9]){7,10}(?![0-9])/u', null],
            ];
        }
        return self::$rules = $out;
    }

    /** names of the loaded rules in order (admin health / tests) */
    public static function piiRuleNames(): array { return array_keys(self::piiPatterns()); }

    // ---- predicates (60-social piiNotCounting / piiWordDigits)
    /** counting, not contact data: the same group repeated, 1 2 3 … / 10 20 30 …, a round number, 123456789, a date */
    public static function notCounting(string $m): bool
    {
        $g = array_values(array_filter(preg_split('/[^0-9]+/', $m) ?: [], 'strlen'));
        if (!$g) return false;
        $all = implode('', $g);
        if (preg_match('/^([0-9])\1+$/', $all)) return false;
        if (preg_match('/^\s*[0-9]+\.[0-9]+\s*$/u', $m)) return false;
        if (preg_match('/^\s*(?:[0-2]?[0-9]:[0-5][0-9][^0-9]*)+$/u', $m)) return false;
        if (count($g) === 1) return !(preg_match('/^[1-9]0+$/', $all) || self::isRun($all));
        if (count($g) >= 3) {
            if (count(array_unique($g)) === 1) return false;
            $v = array_map('intval', $g);
            $d = $v[1] - $v[0];
            if ($d !== 0) {
                $ap = true;
                for ($i = 1, $n = count($v); $i < $n; $i++) if ($v[$i] - $v[$i - 1] !== $d) { $ap = false; break; }
                if ($ap) return false;
            }
            if ($v[0] >= 1900 && $v[0] <= 2099 && $v[1] >= 1 && $v[1] <= 12 && $v[2] >= 1 && $v[2] <= 31) return false;
        }
        return true;
    }

    /** 123456789 / 987654321 (each digit one up or one down) */
    private static function isRun(string $s): bool
    {
        $n = strlen($s);
        if ($n < 3) return false;
        $up = $dn = true;
        for ($i = 1; $i < $n; $i++) {
            $a = ord($s[$i - 1]) - 48;
            $b = ord($s[$i]) - 48;
            if ($b !== ($a + 1) % 10) $up = false;
            if ($b !== ($a + 9) % 10) $dn = false;
        }
        return $up || $dn;
    }

    private const WORD_DIGITS = ['다섯' => '5', '여섯' => '6', '일곱' => '7', '여덟' => '8', '아홉' => '9', '하나' => '1', '둘' => '2', '셋' => '3', '넷' => '4',
        'zero' => '0', 'oh' => '0', 'one' => '1', 'two' => '2', 'three' => '3', 'four' => '4', 'five' => '5', 'six' => '6', 'seven' => '7', 'eight' => '8', 'nine' => '9',
        '공' => '0', '영' => '0', '빵' => '0', '일' => '1', '이' => '2', '삼' => '3', '사' => '4', '오' => '5', '육' => '6', '륙' => '6', '칠' => '7', '팔' => '8', '구' => '9'];
    private const WORD_DIGIT_RE = '/다섯|여섯|일곱|여덟|아홉|하나|둘|셋|넷|zero|one|two|three|four|five|six|seven|eight|nine|oh|[공영빵일이삼사오육륙칠팔구]/u';

    /** a run of digit words (maybe with numerals) shaped like a phone / local number, not counting */
    public static function wordDigits(string $m): bool
    {
        $t = preg_replace('/하고|이랑|그리고|랑|and/u', ' ', mb_strtolower($m)) ?? '';
        if (!preg_match(self::WORD_DIGIT_RE, $t)) return false; // numerals only: the digit rules decide
        $d = preg_replace_callback(self::WORD_DIGIT_RE, fn (array $x): string => self::WORD_DIGITS[$x[0]] ?? $x[0], $t) ?? '';
        $d = trim(preg_replace('/[^0-9]+/', ' ', $d) ?? '');
        $g = array_values(array_filter(explode(' ', $d), 'strlen'));
        $all = implode('', $g);
        $len = strlen($all);
        if ($len < 8 || $len > 14 || !self::notCounting($d)) return false;
        if ($all[0] === '0' && $len >= 9) return true;
        $n = count($g);
        if ($n >= 2 && strlen($g[$n - 1]) === 4 && strlen($g[$n - 2]) >= 3) return true;
        return preg_match('/[0-9]/', $m) === 1 && $len >= 9;
    }

    // ---- fold (60-social piiFoldChar)
    /** dingbat / double-circled digits that NFKC leaves alone */
    private static function digitLike(int $cp): ?string
    {
        if ($cp >= 0x2776 && $cp <= 0x277F) return (string) ($cp - 0x2775);
        if ($cp >= 0x2780 && $cp <= 0x2789) return (string) ($cp - 0x277F);
        if ($cp >= 0x278A && $cp <= 0x2793) return (string) ($cp - 0x2789);
        if ($cp >= 0x24EB && $cp <= 0x24F4) return (string) ($cp - 0x24EB + 11);
        if ($cp >= 0x24F5 && $cp <= 0x24FE) return (string) ($cp - 0x24F4);
        if ($cp === 0x24FF) return '0';
        return null;
    }

    private const CJK_DIGITS = ['〇' => '0', '零' => '0', '一' => '1', '二' => '2', '三' => '3', '四' => '4', '五' => '5', '六' => '6', '七' => '7', '八' => '8', '九' => '9',
        '壹' => '1', '貳' => '2', '參' => '3', '肆' => '4', '伍' => '5', '陸' => '6', '柒' => '7', '捌' => '8', '玖' => '9']; // + banking (갖은자) forms

    /** NFKC of one character; without the intl extension the common compatibility forms by hand */
    private static function nfkc(string $c): string
    {
        if (class_exists(\Normalizer::class)) {
            $n = \Normalizer::normalize($c, \Normalizer::FORM_KC);
            return is_string($n) ? $n : $c;
        }
        $cp = mb_ord($c, 'UTF-8');
        if ($cp === false) return $c;
        if ($cp >= 0xFF01 && $cp <= 0xFF5E) return mb_chr($cp - 0xFEE0, 'UTF-8');                       // full-width ASCII
        if ($cp === 0x3000 || $cp === 0x00A0 || ($cp >= 0x2000 && $cp <= 0x200A) || $cp === 0x202F || $cp === 0x205F) return ' ';
        if ($cp >= 0x1D7CE && $cp <= 0x1D7FF) return (string) (($cp - 0x1D7CE) % 10);                    // math digits
        if ($cp >= 0x1FBF0 && $cp <= 0x1FBF9) return (string) ($cp - 0x1FBF0);
        if ($cp === 0x2070) return '0';
        if ($cp === 0x00B9) return '1';
        if ($cp === 0x00B2) return '2';
        if ($cp === 0x00B3) return '3';
        if ($cp >= 0x2074 && $cp <= 0x2079) return (string) ($cp - 0x2070);                               // superscripts
        if ($cp >= 0x2080 && $cp <= 0x2089) return (string) ($cp - 0x2080);                               // subscripts
        if ($cp >= 0x2460 && $cp <= 0x2473) return (string) ($cp - 0x245F);                               // ① … ⑳
        if ($cp >= 0x2474 && $cp <= 0x2487) return '(' . ($cp - 0x2473) . ')';
        if ($cp >= 0x2488 && $cp <= 0x249B) return ($cp - 0x2487) . '.';
        if ($cp === 0x24EA) return '0';
        if ($cp >= 0x24B6 && $cp <= 0x24CF) return chr(0x61 + $cp - 0x24B6);                             // Ⓐ … Ⓩ
        if ($cp >= 0x24D0 && $cp <= 0x24E9) return chr(0x61 + $cp - 0x24D0);                             // ⓐ … ⓩ
        if ($cp === 0xFE6B) return '@';
        if ($cp === 0xFE52) return '.';
        if ($cp === 0xFE63) return '-';
        if ($cp === 0xFF61) return '。';
        return $c;
    }

    /** what the rules see for one original character ('' = invisible) */
    private static function foldChar(string $c): string
    {
        if (isset(self::$foldCache[$c])) return self::$foldCache[$c];
        $cp = mb_ord($c, 'UTF-8');
        if ($cp === false) $f = $c;
        elseif (preg_match('/^[\p{Cf}\p{Mn}\p{Me}\x{3164}\x{115F}\x{1160}\x{FFA0}]$/u', $c)) $f = '';
        elseif (preg_match('/^[\p{Cc}\p{Zl}\p{Zp}\x{2800}]$/u', $c)) $f = ' ';
        elseif (($cp >= 0x3131 && $cp <= 0x318E) || ($cp >= 0xFFA0 && $cp <= 0xFFDC)) $f = $c; // Hangul jamo as typed
        elseif (($dl = self::digitLike($cp)) !== null) $f = $dl;
        elseif (isset(self::CJK_DIGITS[$c])) $f = self::CJK_DIGITS[$c];
        else {
            $f = '';
            foreach (mb_str_split(self::nfkc($c), 1, 'UTF-8') as $ch) {
                if (preg_match('/^[\p{Cf}\p{Mn}\p{Me}\x{3164}\x{115F}\x{1160}\x{FFA0}]$/u', $ch)) continue;
                if (preg_match('/^\p{Nd}$/u', $ch) && !($ch >= '0' && $ch <= '9' && strlen($ch) === 1)) {
                    // Unicode encodes every decimal digit set as 10 contiguous code points 0..9
                    $z0 = mb_ord($ch, 'UTF-8');
                    $z = $z0;
                    while ($z0 - $z < 9 && $z > 0 && preg_match('/^\p{Nd}$/u', mb_chr($z - 1, 'UTF-8'))) $z--;
                    $f .= (string) (($z0 - $z) % 10);
                } else {
                    $f .= mb_strtolower($ch, 'UTF-8');
                }
            }
        }
        if (count(self::$foldCache) < 4000) self::$foldCache[$c] = $f;
        return $f;
    }

    /** units: [['s' => folded, 'a' => first cp, 'b' => end cp, 'm' => masked?]] */
    private static function units(array $cps): array
    {
        $u = [];
        foreach ($cps as $i => $c) $u[] = ['s' => self::foldChar($c), 'a' => $i, 'b' => $i + 1, 'm' => false];
        $n = count($u);
        $one = function (int $k) use (&$u, $n): bool { return $k >= 0 && $k < $n && mb_strlen($u[$k]['s'], 'UTF-8') === 1; };
        // O / l / I / S look-alikes inside a digit token: "O1O-1234", "o1o", "010-l234", "S678"
        for ($i = 0; $i < $n;) {
            if (!$one($i) || !preg_match('/^[0-9olis|]$/', $u[$i]['s'])) { $i++; continue; }
            $j = $i;
            while ($j < $n && $one($j) && preg_match('/^[0-9olis|]$/', $u[$j]['s'])) $j++;
            $before = $i > 0 ? $u[$i - 1]['s'] : '';
            $after = $j < $n ? $u[$j]['s'] : '';
            $hasDigit = $hasLook = false;
            for ($k = $i; $k < $j; $k++) { if (preg_match('/[0-9]/', $u[$k]['s'])) $hasDigit = true; else $hasLook = true; }
            if ($j - $i >= 3 && !preg_match('/[a-z]$/', $before) && !preg_match('/^[a-z]/', $after) && $hasDigit && $hasLook) {
                for ($k = $i; $k < $j; $k++) {
                    $s = $u[$k]['s'];
                    $u[$k]['s'] = $s === 'o' ? '0' : ($s === 's' ? '5' : (preg_match('/^[li|]$/', $s) ? '1' : $s));
                }
            }
            $i = $j;
        }
        // "k i d d i n o @ g m a i l . c o m": ≥ 4 single letters / @ . _ - separated by single spaces join up
        $isTok = function (int $k) use (&$u, $n, $one): bool { return $one($k) && preg_match('/^[a-z@._\-]$/', $u[$k]['s']) === 1 && ($k === 0 || $u[$k - 1]['s'] === ' ') && ($k + 1 >= $n || $u[$k + 1]['s'] === ' '); };
        for ($i = 0; $i < $n;) {
            if (!$isTok($i)) { $i++; continue; }
            $j = $i;
            $cnt = 1;
            while ($j + 2 < $n && $u[$j + 1]['s'] === ' ' && $isTok($j + 2)) { $j += 2; $cnt++; }
            if ($cnt >= 4) for ($k = $i + 1; $k < $j; $k += 2) $u[$k]['s'] = '';
            $i = $j + 1;
        }
        return $u;
    }

    /** one rule over the units: every match becomes one 🔒 unit covering the original characters it spans */
    private static function applyRule(array &$units, string $re, ?callable $pred): int
    {
        $s = '';
        $pos = [];
        foreach ($units as $i => $x) {
            $len = strlen($x['s']);
            for ($k = 0; $k < $len; $k++) $pos[] = $i;
            $s .= $x['s'];
        }
        $pos[] = count($units);
        if ($s === '' || !preg_match_all($re, $s, $all, PREG_OFFSET_CAPTURE)) return 0;
        $spans = [];
        foreach ($all[0] as [$m, $off]) {
            if ($m === '') continue;
            if ($pred && !$pred($m)) continue;
            $spans[] = [$pos[$off], $pos[$off + strlen($m) - 1]];
        }
        for ($k = count($spans) - 1; $k >= 0; $k--) {
            [$i, $j] = $spans[$k];
            while ($j + 1 < count($units) && $units[$j + 1]['s'] === '' && !$units[$j + 1]['m']) $j++; // marks right after go too
            array_splice($units, $i, $j - $i + 1, [['s' => self::PII_MARK, 'a' => $units[$i]['a'], 'b' => $units[$j]['b'], 'm' => true]]);
        }
        return count($spans);
    }

    /**
     * Mask personal information with 🔒 (consecutive locks collapse into one); the rest of the text stays exactly
     * as written. $hits receives the number of masked fragments (0 = unchanged).
     */
    public static function maskPII(string $text, ?int &$hits = null): string
    {
        $hits = 0;
        if ($text === '') return $text;
        if (!mb_check_encoding($text, 'UTF-8')) $text = mb_convert_encoding($text, 'UTF-8', 'UTF-8');
        if (class_exists(\Normalizer::class)) $text = \Normalizer::normalize($text, \Normalizer::FORM_C) ?: $text;
        $cps = mb_str_split($text, 1, 'UTF-8');
        if (count($cps) > self::PII_MAX) $cps = array_slice($cps, 0, self::PII_MAX);
        $units = self::units($cps);
        foreach (self::piiPatterns() as [$re, $pred]) $hits += self::applyRule($units, $re, $pred);
        $out = '';
        foreach ($units as $x) $out .= $x['m'] ? self::PII_MARK : implode('', array_slice($cps, $x['a'], $x['b'] - $x['a']));
        if ($hits > 0) $out = preg_replace('/🔒(?:(?:[^\p{L}\p{N}🔒]|[ㄱ-ㆎ]){0,8}🔒)+/u', self::PII_MARK, $out) ?? $out;
        return $out;
    }

    /** true when the text contains something that looks like personal information */
    public static function hasPII(string $text): bool
    {
        self::maskPII($text, $hits);
        return $hits > 0;
    }

    /** the folded matching copy of a whole string (tests / admin tools) */
    public static function fold(string $text): string
    {
        return implode('', array_map(fn ($u) => $u['s'], self::units(mb_str_split($text, 1, 'UTF-8'))));
    }

    /**
     * nicknames are public and permanent: stricter than chat (60-social nicknameLooksPersonal) — any PII, ≥ 7 digits,
     * 010…, messenger / game platform + an id-like tail ("로블록스dino12", "인스타dino"), school / grade / class.
     */
    public static function nicknameLooksPersonal(string $nick): bool
    {
        if ($nick === '') return false;
        if (self::hasPII($nick)) return true;
        $f = self::fold(class_exists(\Normalizer::class) ? (\Normalizer::normalize($nick, \Normalizer::FORM_C) ?: $nick) : $nick);
        if (preg_match_all('/[0-9공영빵일이삼사오육륙칠팔구]/u', $f) >= 7) return true; // digits, also as words
        if (preg_match('/01[016789][0-9]{3,}|공일공|영일영/u', $f)) return true;
        $platform = '/카톡|카카오톡|인스타|틱톡|디코|디스코드|텔레그램|페메|유튜브|로블록스|로블|제페토|마인크래프트|마크|포트나이트|브롤|insta|kakao|tiktok|discord|telegram|youtube|snapchat|roblox|zepeto|minecraft|fortnite/iu';
        $tail = preg_replace('/insta|kakao|tiktok|discord|telegram|youtube|snapchat|roblox|zepeto|minecraft|fortnite/iu', '', $f) ?? $f;
        if (preg_match($platform, $f) && preg_match('/[0-9a-z_]{3,}|[0-9]{2,}/i', $tail)) return true;
        if (preg_match('/학년|[0-9일이삼사오육칠팔구]반$|초등|중학|고등|유치원|어린이집|[가-힣]{2,}초[0-9일이삼사오육]/u', $f)) return true;
        if (preg_match('/^(?:ig|yt|tt|dc|snap|kt|insta|fb|tw|tg|dm)[._]/u', $f)) return true;                 // "ig_dino", "snap.dino77"
        if (preg_match('/[가-힣]{2,}(?<!식)초$|[가-힣]{2,}(?:중|고)[0-9일이삼]|[가-힣]{1,6}동[0-9]{2,}/u', $f)) return true; // 해바라기초 · 해바라기중1 · 정자동123
        // school + a person's name ("행복초김민준": 초 + surname + 1–2 syllables; 초코 · 초록 · 초원 … are words, not schools)
        if (preg_match('/[가-힣]{2,}초(?!코|록|롱|밥|원|승|대|보|콜|가|침|기|등|점|여|저|성|청|상|식|빙|과|월|봄)(?:김|이|박|최|정|강|조|윤|장|임|한|오|서|신|권|황|안|송|류|유|전|홍|고|문|양|손|배|백|허|남|심|노|하|곽|성|차|주|우|구|민|진|나|지|엄|채|원|천|방|공|현|함|변|염|여|추|도|소|석|선|설|마|길|연|위|표|명|기|반|왕|금|옥|육|인|맹|제|모|탁|국|어|은|편|용|예|봉|경)[가-힣]{1,2}/u', $f)) return true;
        // a district ("강남구민준", "해운대구", "분당구")
        if (preg_match('/(?:강남|강동|강북|강서|관악|광진|구로|금천|노원|도봉|동대문|동작|마포|서대문|서초|성동|성북|송파|양천|영등포|용산|은평|종로|중랑|해운대|수영|연수|부평|계양|미추홀|분당|수지|기흥|일산동|일산서|덕양|유성|달서|수성|부산진|사하|사상|금정|기장|동래|연제|영도|광산|만안|동안|팔달|권선|장안|영통|처인|원미|소사|오정)구/u', $f)) return true;
        // an apartment block in digit words ("일공일동" = 101동, "이공삼동")
        if (preg_match('/(?:[일이삼사오육칠팔구][공영][일이삼사오육칠팔구공영]{1,2}|[일이삼사오육칠팔구]{1,2}[공영]{1,2}[일이삼사오육칠팔구])동/u', $f)) return true;
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
