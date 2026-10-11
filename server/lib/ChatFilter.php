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

    // ------------------------------------------------------------------ personal information (kid safety, CONTRACT §12.4)
    public const PII_MARK = '🔒';
    private const CITY = '(?:서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|충청북|충청남|전북|전남|전라북|전라남|경북|경남|경상북|경상남|제주)';
    /** messenger / SNS names: Korean names may be followed directly by an id, latin ones need "id", ":" or "@" */
    private const SNS_KO = '(?:카톡|카카오톡|카카오|오픈채팅|오픈톡|인스타(?:그램)?|틱톡|디엠|텔레그램|텔레|라인|디코|디스코드|페메|페북|페이스북|유튜브|트위터|스냅챗|위챗|왓츠앱)';
    private const SNS_EN = '(?:insta(?:gram)?|tiktok|dm|telegram|line|discord|facebook|fb|youtube|twitter|snapchat|wechat|whatsapp|kakao(?:talk)?)';

    /** separators people put between digit groups: spaces . - _ / ~ * · – — ㅡ ( ) [ ] (ᅳ = ㅡ after NFKC) */
    private const SEP = '[\s.\-_\/~*·–—ㅡᅳ()\[\]]';
    /** a digit written as a numeral or as a Korean digit word (공/영 일 이 삼 사 오 육 칠 팔 구) */
    private const KDIGIT = '[공영일이삼사오육칠팔구]';

    /**
     * Ordered patterns (most specific first). Each match is replaced with 🔒. The client mirror is
     * G.sys.social.maskPII (60-social.js); keep both lists in sync (docs/HANDOVER.md "어린이 안전",
     * shared test vectors in tests/pii-vectors.json).
     * Deliberately conservative where Korean grammar collides (…으로 3번, 새로 30개, 서울 친구, 유치원 가기 싫어).
     * A pattern given as [regex, predicate] only masks matches the predicate accepts.
     */
    private static function piiPatterns(): array
    {
        static $p = null;
        if ($p !== null) return $p;
        $c = self::CITY;
        $sep = self::SEP;
        $kd = self::KDIGIT;
        // number followed by a counter word is a count, not an address ("새로 30개", "2층으로 3번")
        $notCount = '(?![0-9개번명층살점분초시원마리등위레렙일월년주판칸장권%])';
        $lotTail = '(?:\s*[0-9]{1,5}(?:\s*-\s*[0-9]{1,5})?' . $notCount . '(?:\s*번지)?)?';
        $tld = '(?:com|net|org|kr|io|me|gg|tv|ly|app|xyz|info|biz|link|site|shop|jp|cn|us|co|to|be|fm|so|ai)';
        return $p = [
            // e-mail, also spelled out: "abc 골뱅이 naver 닷 com", "abc(at)gmail(dot)com", "dino at gmail dot com", "… 지메일 닷컴"
            'email' => '/[\p{L}\p{N}._%+\-]+\s*(?:@|＠|\(at\)|\[at\]|골뱅이)\s*[\p{L}\p{N}\-]+(?:\s*(?:\.|。|．|\(dot\)|\[dot\]|\(\.\)|\[\.\]|닷|쩜)\s*(?:[a-z]{2,}|컴|넷|케이알))+/iu',
            // fully spelled in English: "dinokid at gmail dot com" (needs both words, so "I'm at home. so" stays)
            'emailWords' => '/[\p{L}\p{N}._%+\-]+\s+at\s+[\p{L}\p{N}\-]+(?:\s+dot\s+[a-z]{2,})+/iu',
            // URL / bare domain / mail provider
            'url' => '/(?:https?:\/\/|hxxps?:\/\/|www\.)[^\s<>"]+|(?<![\p{L}\p{N}@.\-])[a-z0-9](?:[a-z0-9\-]{0,61}[a-z0-9])?(?:\.[a-z0-9\-]{1,63})*\.' . $tld . '(?![a-z0-9])(?:\/[^\s<>"]*)?/iu',
            // domain with a disguised dot: "bad[.]com", "bad(.)com", "bad . com", "bad dot com", "bad 닷 com"
            'urlDot' => '/(?<![\p{L}\p{N}@.\-])[a-z0-9](?:[a-z0-9\-]{0,61}[a-z0-9])?\s*(?:\[\s*\.\s*\]|\(\s*\.\s*\)|\{\s*\.\s*\}|\[dot\]|\(dot\)|\s\.\s|\s+dot\s+|\s*닷\s*|\s*쩜\s*)' . $tld . '(?![a-z0-9])/iu',
            'mailHost' => '/(?:naver|gmail|daum|hanmail|kakao|nate|hotmail|outlook|yahoo|icloud)\s*(?:\.|닷|쩜|점)\s*(?:com|net|co\s*\.\s*kr)(?![a-z])/iu',
            // messenger / SNS handle: "카톡 아이디 abc123", "인스타 @dino_kid", "discord: kid#1234", "kakao id dino12"
            'handleKo' => '/' . self::SNS_KO . '\s*(?:아이디|아디|id|계정|주소|닉네임|닉)?\s*(?:은|는|이|:|：)?\s*@?[a-z0-9][a-z0-9._#\-]{2,}/iu',
            'handleEn' => '/(?<![a-z0-9])' . self::SNS_EN . '\s*(?:id\s*[:：]?|[:：]|@)\s*@?[a-z0-9][a-z0-9._#\-]{2,}/iu',
            // phone numbers: mobile / +82 / landline, any common separator ("010/1234/5678", "010ㅡ1234ㅡ5678")
            'phone' => '/(?<![0-9])(?:\+\s?82' . $sep . '{0,3}0?|0)1[016789]' . $sep . '{0,3}[0-9]{3,4}' . $sep . '{0,3}[0-9]{4}(?![0-9])/u',
            'landline' => '/(?<![0-9])0(?:2|[3-6][1-5]|70|50[0-9]?)' . $sep . '{0,3}[0-9]{3,4}' . $sep . '{0,3}[0-9]{4}(?![0-9])/u',
            'digits' => '/(?<![0-9])(?:[0-9]' . $sep . '{0,3}){8,}[0-9](?![0-9])/u', // ≥ 9 digits in a row: phone, ID, card numbers
            // a local number without area code: "1234-5678" (dash/dot-like separators only; "1000 2000" stays)
            'localNumber' => '/(?<![0-9])[0-9]{3,4}[.\-–—ㅡᅳ]+[0-9]{4}(?![0-9])/u',
            // phone spelled with Korean digit words, separators allowed: "공일공-일이삼사-오육칠팔", "일이삼사 오육칠팔"
            'koreanDigits' => '/(?:' . $kd . $sep . '{0,2}){7,}' . $kd . '|공일공/u',
            // numerals and digit words mixed: "010 일이삼사 5678", "공1공 1234 5678"
            'mixedDigits' => ['/(?:[0-9]|' . $kd . ')(?:' . $sep . '{0,2}(?:[0-9]|' . $kd . ')){7,}/u', fn (string $m): bool => (bool) preg_match('/[0-9]/', $m) && (bool) preg_match('/' . self::KDIGIT . '/u', $m)],
            // street addresses (a trailing lot number goes with them: "서울시 강남구 역삼동 123-4")
            'cityDistrict' => '/' . $c . '(?:(?:특별시|광역시|특별자치시|특별자치도|시|도)\s*[가-힣]{1,5}|\s*[가-힣]{2,5})(?:시|군|구)(?![가-힣])(?:\s*[가-힣]{1,5}(?:구|읍|면|동|리)(?![가-힣]))*' . $lotTail . '/u',
            'districtDong' => '/[가-힣]{2,5}(?:구|군)\s*[가-힣]{1,6}(?:동|읍|면|리)(?![가-힣])' . $lotTail . '/u',
            'road' => '/[가-힣0-9]{1,10}(?<![으새서별주바따실])(?:로|길)\s*(?:[0-9]{1,4}\s*번길\s*)?[0-9]{1,4}(?:\s*-\s*[0-9]{1,4})?' . $notCount . '(?:\s*번지)?/u',
            'lot' => '/[가-힣]{1,8}(?:동|리|가)\s*[0-9]{1,5}(?:\s*-\s*[0-9]{1,5})?\s*번지|[가-힣]{1,8}(?:동|리)\s*[0-9]{1,5}\s*-\s*[0-9]{1,5}/u',
            'apartment' => '/[0-9]{1,4}\s*동\s*[0-9]{1,4}\s*호|(?<![0-9])[0-9]{3,4}\s*호(?![선기실점])|[가-힣a-z0-9]{1,12}(?:아파트|빌라|오피스텔|맨션)(?![가-힣])/iu',
            // school / kindergarten / class ("해바라기 초등학교" with a space too; "유치원 가기 싫어" stays)
            'school' => '/[가-힣]{1,10}(?:초등학교|초교|중학교|고등학교|유치원|어린이집)|[가-힣]{2,10}\s(?:초등학교|중학교|고등학교)|[0-9]\s*학년\s*[0-9]{1,2}\s*반/u',
        ];
    }

    /** one masking pass over $text with every pattern; $hits += masked fragments */
    private static function maskPass(string $text, int &$hits): string
    {
        $out = $text;
        foreach (self::piiPatterns() as $pat) {
            if (is_array($pat)) {
                [$re, $ok] = $pat;
                $n = 0;
                $r = preg_replace_callback($re, function (array $m) use ($ok, &$n): string {
                    if (!$ok($m[0])) return $m[0];
                    $n++;
                    return self::PII_MARK;
                }, $out);
            } else {
                $r = preg_replace($pat, self::PII_MARK, $out, -1, $n);
            }
            if ($r === null) continue; // PCRE limit (pathological input): keep what we have, other patterns still run
            $out = $r;
            $hits += $n;
        }
        return $out;
    }

    /**
     * Compatibility fold used to see through disguises: NFKC (full-width ０１０ / ＠ / ．, 𝟎𝟏𝟎 …), keycap emoji
     * (0️⃣ → 0) and every other decimal digit script (٠١٠ → 010) to ASCII digits.
     */
    public static function fold(string $text): string
    {
        $t = $text;
        if (class_exists(\Normalizer::class)) {
            // NFKC everything except Hangul compatibility jamo (ㅋㅋ, ㅠㅠ, ㅡ stay as typed when the folded text is shown)
            $t = preg_replace_callback('/[^\x{3130}-\x{318F}]+/u', function (array $m): string {
                $n = \Normalizer::normalize($m[0], \Normalizer::FORM_KC);
                return is_string($n) ? $n : $m[0];
            }, $t) ?? $t;
        } else {
            // no intl extension: the common compatibility forms by hand (full-width ASCII, ideographic space, math digits)
            $t = preg_replace_callback('/[\x{FF01}-\x{FF5E}\x{3000}\x{1D7CE}-\x{1D7FF}\x{1FBF0}-\x{1FBF9}]/u', function (array $m): string {
                $cp = mb_ord($m[0], 'UTF-8');
                if ($cp === 0x3000) return ' ';
                if ($cp >= 0x1D7CE && $cp <= 0x1D7FF) return (string) (($cp - 0x1D7CE) % 10);
                if ($cp >= 0x1FBF0) return (string) ($cp - 0x1FBF0);
                return mb_chr($cp - 0xFEE0, 'UTF-8');
            }, $t) ?? $t;
        }
        $t = preg_replace('/[\x{FE0E}\x{FE0F}\x{20E3}]/u', '', $t) ?? $t;
        // any remaining non-ASCII decimal digit: Unicode encodes each digit set as 10 contiguous code points 0..9
        $t = preg_replace_callback('/(?![0-9])\p{Nd}/u', function (array $m): string {
            $cp = mb_ord($m[0], 'UTF-8');
            $z = $cp;
            while ($cp - $z < 9 && $z > 0 && preg_match('/^\p{Nd}$/u', mb_chr($z - 1, 'UTF-8'))) $z--;
            return (string) (($cp - $z) % 10);
        }, $t) ?? $t;
        return $t;
    }

    /**
     * Mask personal information with 🔒 (consecutive locks collapse into one).
     * $hits receives the number of masked fragments (0 = unchanged).
     * Pass 1 masks the text as written; pass 2 masks the folded text (full-width / keycap / other-script digits)
     * and, when the fold revealed more, the folded masked text is returned.
     */
    public static function maskPII(string $text, ?int &$hits = null): string
    {
        $hits = 0;
        if ($text === '') return $text;
        $out = self::maskPass($text, $hits);
        $folded = self::fold($out);
        if ($folded !== $out) {
            $more = 0;
            $f = self::maskPass($folded, $more);
            if ($more > 0) { $out = $f; $hits += $more; }
        }
        if ($hits > 0) {
            $m = preg_quote(self::PII_MARK, '/');
            $out = preg_replace('/' . $m . '(?:[\s,.\-·_\/~*ㅡᅳ–—()\[\]]*' . $m . ')+/u', self::PII_MARK, $out) ?? $out;
        }
        return $out;
    }

    /** true when the text contains something that looks like personal information */
    public static function hasPII(string $text): bool
    {
        self::maskPII($text, $hits);
        return $hits > 0;
    }

    /** nicknames are public and permanent: stricter than chat (any phone-like digits, SNS names, addresses) */
    public static function nicknameLooksPersonal(string $nick): bool
    {
        if (self::hasPII($nick)) return true;
        if (preg_match_all('/[0-9]/', $nick) >= 7) return true;
        if (preg_match('/01[016789][0-9]{3,}|공일공/u', $nick)) return true;
        // "인스타dino123", "kakao_kid77": a messenger name + an id-like tail (latin words such as "line"/"dm" are too common in names)
        if (preg_match('/카톡|카카오톡|인스타|틱톡|디코|디스코드|텔레그램|페메|유튜브|insta|kakao|tiktok|discord|telegram|youtube|snapchat/iu', $nick) && preg_match('/[0-9a-z_]{3,}/i', $nick)) return true;
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
