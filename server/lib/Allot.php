<?php
/**
 * Tfm\Allot — allotment (분양) of jars, plots and stores: the operator's ledger of 10,000 rentable units (CONTRACT §16.7).
 *
 *   zones      saveZone · zones · zone · seedUnits · seedPreset           (the units are rows; never the schema file)
 *   units      listUnits (keyset) · unit · unitView · setUnitState · map · mapVersion · summary
 *   customers  customer (masked; reveal = audit row) · saveCustomer · listCustomers (blind-index search) · linkCustomer
 *   contracts  apply · createContract · decide · renew · transfer · endContract · cancelByUser · setMemo · setAutoRenew ·
 *              contract · listContracts (keyset) · mine · plans
 *   payments   recordPayment (idempotency key) · refund · listPayments · payPrepare / payConfirm (토스, own table) · webhook
 *   waiting    waitJoin · waitLeave · waitAccept · offerNext · listWait · waitCancel
 *   notices    notify · inbox · unread · markSeen · listNotices · noticeDone
 *   care       addCare · careLogs · setLabel / setLabelByUser (nameplate: cleaned, masked, ≤ 12 characters)
 *   csv        csvBom · csvLine · csvParse · exportHeader · exportRows · importCsv (dry run first)
 *   automation tick (idempotent, injectable clock) · lazyTick · jobRuns · integrity · stats · adminSummary
 *   keys       resealAll · rehashBlind (secret:rotate)
 *
 * Rules that hold everywhere in this file:
 *  - `$a` is the acting admin row ({id, role}); the operator on the command line is ['id' => 0, 'role' => 'admin'].
 *    A non-admin actor is 403 FORBIDDEN. `$now` (milliseconds) is injectable so that tests and tick() share one clock.
 *  - No double allocation: the unit row is locked, its status moves with a compare-and-set that always changes a value
 *    (rowCount must be exactly 1 on both drivers), allot_contracts.live_unit_id is a nullable UNIQUE key, SQLSTATE 23000
 *    becomes 409 UNIT_TAKEN, and a deadlock / lock timeout runs the transaction again (Db::txRetry).
 *  - Lock order: users row → contract rows → unit rows (ascending id) → zone rows (ascending id).
 *  - Personal data (name, phone, address, the customer memo) is sealed with Tfm\Crypto, searched only by the keyed blind
 *    indexes phone_hash / name_hash, listed masked, revealed only through customer(…, true, $a) which writes an audit row.
 *    It never enters an audit detail, a log line, an exception message, a notice or a file name.
 *  - Everything a customer can read (notices, care logs, nameplates, zone names) goes through cleanPublic():
 *    Users::cleanText → ChatFilter::maskPII → ChatFilter::mask. Notices never state an amount: prices are told only by
 *    plans() (api/allot/plans.php, the endpoint easy mode never calls) and payPrepare().
 *  - Operator rules and texts are rows of the `settings` table written by saveSettings() (key "allot.<name>"); a missing
 *    row falls back to config 'allot' and then to the defaults below. The example texts are marked 예시.
 * PHP 7.2 syntax only.
 */
declare(strict_types=1);

namespace Tfm;

if (!defined('TFM_BOOT')) { if (function_exists('header_remove')) header_remove('X-Powered-By'); http_response_code(404); exit; }

/** thrown inside a transaction to run it again with a new snapshot (auto-assign lost the race for its unit) */
final class AllotRetry extends \RuntimeException
{
}

final class Allot
{
    public const KINDS = ['jar', 'plot', 'store'];
    public const KIND_NAMES = ['jar' => '항아리', 'plot' => '밭', 'store' => '창고'];
    public const DAY = 86400000;
    /** paid_until of a contract that never owes anything (a free, open-ended unit): 9999-12-31 */
    public const FOREVER = 253402214400000;
    public const MAX_ZONE_UNITS = 5000;
    public const MAX_UNITS = 100000;
    public const MAX_AMOUNT = 10000000;
    public const LABEL_MAX = 12;
    private const LIVE = ['pending', 'active', 'overdue'];
    private const STATUS_CHAR = ['open' => 'o', 'held' => 'h', 'leased' => 'l', 'closed' => 'c'];
    private const TEXT_MAX = 4000;

    /** rule → [type, min, max] | ['enum', values] — also the list of keys saveSettings() accepts */
    private const RULES = [
        'enabled' => ['bool'], 'hold_hours' => ['int', 0, 8760], 'apply_per_user' => ['int', 1, 100], 'auto_approve' => ['enum', ['off', 'on_payment', 'always']],
        'grace_days' => ['int', 0, 365], 'notice_days' => ['days'], 'overdue_end_days' => ['int', 0, 3650], 'waitlist_offer_hours' => ['int', 1, 720],
        'retention_days' => ['int', 30, 36500], 'collect_address' => ['bool'], 'nameplate_default_show' => ['bool'], 'toss_enabled' => ['bool'],
        'lazy_tick_minutes' => ['int', 1, 1440], 'tick_batch' => ['int', 10, 5000], 'consent_version' => ['label'], 'daily_report_mail' => ['bool'],
    ];
    private const DEFAULTS = [
        'enabled' => true, 'hold_hours' => 48, 'apply_per_user' => 3, 'auto_approve' => 'off', 'grace_days' => 14, 'notice_days' => [30, 7, 0], 'overdue_end_days' => 0,
        'waitlist_offer_hours' => 48, 'retention_days' => 1825, 'collect_address' => false, 'nameplate_default_show' => false, 'toss_enabled' => false, 'lazy_tick_minutes' => 15,
        'tick_batch' => 500, 'consent_version' => '2026-11', 'daily_report_mail' => false,
    ];
    /** settings key → the name in texts() */
    private const TEXT_KEYS = ['terms_text' => 'terms', 'privacy_text' => 'privacy', 'refund_text' => 'refund', 'pay_guide' => 'payGuide'];
    /** example texts (예시): the operator replaces them in the admin site; a lawyer should read the final wording */
    private const SAMPLE_TEXTS = [
        'terms_text' => "[예시 문구예요 — 운영자가 실제 내용으로 바꿔 주세요]\n1. 분양은 한 구좌(항아리 · 밭 · 창고 한 칸)를 정해진 기간 동안 쓰는 약속이에요.\n2. 신청하면 운영자가 확인한 뒤 확정돼요. 확정 전에는 언제든 취소할 수 있어요.\n3. 기간, 금액, 받는 날은 구역마다 달라요. 신청 화면에서 꼭 확인해 주세요.\n4. 운영자는 관리 일지에 돌본 내용을 남겨요.\n5. 기간이 끝나면 미리 알려 드리고, 이어서 할지 여쭤봐요.",
        'privacy_text' => "[예시 문구예요 — 운영자가 실제 내용으로 바꿔 주세요]\n개인정보 수집 · 이용 안내\n1. 모으는 까닭: 분양 신청 확인, 계약 관리, 납부 · 수령 안내\n2. 모으는 것: 이름, 전화번호 (주소는 운영자가 켠 경우에만)\n3. 보관 기간: 계약이 끝난 뒤 5년 동안 보관하고 그 뒤에 지워요.\n4. 동의하지 않을 수 있어요. 동의하지 않아도 체험관은 그대로 즐길 수 있지만, 분양 신청은 할 수 없어요.\n5. 만 14세 미만 어린이는 신청할 수 없어요. 보호자가 직접 신청해 주세요.",
        'refund_text' => "[예시 문구예요 — 운영자가 실제 내용으로 바꿔 주세요]\n1. 확정 전 신청은 언제든 취소할 수 있고, 낸 돈은 모두 돌려 드려요.\n2. 확정 뒤 해지와 환불은 운영자에게 알려 주세요. 남은 기간과 이미 받은 것을 살펴 정해요.\n3. 환불 기한과 계산 방법은 운영자가 정한 규정을 따라요.",
        'pay_guide' => "[예시 문구예요 — 운영자가 실제 내용으로 바꿔 주세요]\n신청이 확인되면 운영자가 입금 방법을 알려 드려요. 입금한 뒤에는 ‘내 분양’에서 확정 여부를 볼 수 있어요.",
    ];
    /** allot:seed presets: [code prefix, kind, zones, units per zone, columns, name pattern, example price, period, term months] */
    private const PRESETS = [
        'default' => [
            ['J', 'jar', 6, 1000, 40, '장독대 %d구역', 120000, 'year', 12],
            ['P', 'plot', 3, 1000, 40, '텃밭 %d구역', 40000, 'year', 12],
            ['S', 'store', 2, 500, 25, '창고 %d동', 30000, 'month', 0],
        ],
        'small' => [
            ['J', 'jar', 2, 60, 12, '장독대 %d구역', 120000, 'year', 12],
            ['P', 'plot', 1, 40, 10, '텃밭 %d구역', 40000, 'year', 12],
            ['S', 'store', 1, 20, 10, '창고 %d동', 30000, 'month', 0],
        ],
    ];
    public const SAMPLE_NOTE = '예시 가격 · 기간이에요. 운영자가 확인하고 바꿔 주세요.';

    /** @var array request-local memo (map version, summary) */
    private static $memo = [];

    /** forget the request-local memo (tests, long-running CLI) */
    public static function forget(): void
    {
        self::$memo = [];
        if (class_exists('Tfm\Settings')) Settings::reset();
    }

    // ------------------------------------------------------------------ small helpers
    /** the actor must be an admin → its id (0 = the operator on the command line) */
    private static function admin(array $a): int
    {
        if ((isset($a['role']) ? $a['role'] : '') !== 'admin') throw new ApiException(403, 'FORBIDDEN', '관리자 권한이 필요해요.');
        return (int) (isset($a['id']) ? $a['id'] : 0);
    }

    /** an account id for a nullable column */
    private static function idOrNull(int $id): ?int { return $id > 0 ? $id : null; }

    private static function now(?int $now): int { return $now === null ? Clock::ms() : $now; }

    /** an integer from library input: a real int or a canonical digit string (admin forms post strings) */
    private static function inInt(array $in, string $key, int $min, int $max, ?int $default = null): ?int
    {
        if (!array_key_exists($key, $in) || $in[$key] === null || $in[$key] === '') return $default;
        $v = $in[$key];
        if (is_string($v) && preg_match('/^-?(?:0|[1-9]\d{0,17})$/', trim($v))) $v = (int) trim($v);
        if (!is_int($v) || $v < $min || $v > $max) V::fail($key, "값은 {$min}~{$max} 사이의 정수여야 해요.");
        return $v;
    }

    private static function inBool(array $in, string $key, ?bool $default = null): ?bool
    {
        if (!array_key_exists($key, $in) || $in[$key] === null) return $default;
        $v = $in[$key];
        if (is_bool($v)) return $v;
        if (is_int($v) && ($v === 0 || $v === 1)) return $v === 1;
        if (is_string($v)) {
            $s = strtolower(trim($v));
            if (in_array($s, ['1', 'true', 'on', 'yes'], true)) return true;
            if (in_array($s, ['0', 'false', 'off', 'no', ''], true)) return false;
        }
        V::fail($key, '값은 참 또는 거짓이어야 해요.');
        return null;
    }

    private static function inStr(array $in, string $key, int $max, ?string $default = null): ?string
    {
        if (!array_key_exists($key, $in) || $in[$key] === null) return $default;
        return V::str($in[$key], $key, $max);
    }

    /** text a customer (maybe a child looking on) can read: cleaned, personal information masked, bad words masked */
    public static function cleanPublic(string $s, int $max): string
    {
        $t = Users::cleanText($s, min(400, max(1, $max)));
        if ($t === '') return '';
        return mb_substr(trim(ChatFilter::mask(ChatFilter::maskPII($t))), 0, $max);
    }

    /** an operator's working note (admin site only): cleaned, never masked */
    private static function cleanPrivate(string $s, int $max): string { return Users::cleanText($s, $max); }

    /** a long operator text that keeps its line breaks (terms, privacy, refund, pay guide) */
    private static function cleanLong(string $s, int $max): string
    {
        if (!mb_check_encoding($s, 'UTF-8')) $s = (string) mb_convert_encoding($s, 'UTF-8', 'UTF-8');
        $lines = [];
        foreach (preg_split('/\r\n|\r|\n/', $s) ?: [] as $line) $lines[] = Users::cleanText((string) $line, $max);
        $out = trim((string) preg_replace('/\n{3,}/', "\n\n", implode("\n", $lines)));
        return mb_substr($out, 0, $max);
    }

    /** "2026. 11. 14." in the server time zone */
    private static function fmtDate(int $ms): string { return $ms > 0 && $ms < self::FOREVER ? date('Y. n. j.', intdiv($ms, 1000)) : '-'; }

    /** $ms plus $n calendar months in the server time zone (Jan 31 + 1 month = the last day of February) */
    public static function addMonths(int $ms, int $n): int
    {
        if ($n === 0) return $ms;
        $sec = intdiv($ms, 1000);
        $t = (int) date('Y', $sec) * 12 + ((int) date('n', $sec) - 1) + $n;
        $y = intdiv($t, 12);
        $m = $t % 12 + 1;
        $last = (int) date('t', (int) mktime(0, 0, 0, $m, 1, $y));
        return (int) mktime((int) date('G', $sec), (int) date('i', $sec), (int) date('s', $sec), $m, min((int) date('j', $sec), $last), $y) * 1000 + $ms % 1000;
    }

    /**
     * addMonths() for a date that belongs to a contract: the day of the month follows $anchor (the start of the contract),
     * so a payer who started on the 31st stays on "the last day" — Jan 31 → Feb 28 → Mar 31 — instead of sliding to the
     * 28th for ever after the first February. A date that is not on that grid (the operator set it by hand) keeps its own
     * day, exactly like addMonths().
     */
    private static function addMonthsFrom(int $ms, int $n, int $anchor): int
    {
        if ($n === 0) return $ms;
        if ($anchor <= 0) return self::addMonths($ms, $n);
        $sec = intdiv($ms, 1000);
        $want = (int) date('j', intdiv($anchor, 1000));
        if ((int) date('j', $sec) !== min($want, (int) date('t', $sec))) return self::addMonths($ms, $n);
        $t = (int) date('Y', $sec) * 12 + ((int) date('n', $sec) - 1) + $n;
        $y = intdiv($t, 12);
        $m = $t % 12 + 1;
        $last = (int) date('t', (int) mktime(0, 0, 0, $m, 1, $y));
        return (int) mktime((int) date('G', $sec), (int) date('i', $sec), (int) date('s', $sec), $m, min($want, $last), $y) * 1000 + $ms % 1000;
    }

    // ---- optional shared cache (Tfm\Cache, CONTRACT §16.9): every call is guarded, a miss or an error means "ask the database"
    private static function cacheGet(string $key)
    {
        if (!class_exists('Tfm\Cache')) return null;
        try { $v = Cache::get('allot:' . $key); return $v === false ? null : $v; } catch (\Throwable $e) { return null; }
    }

    private static function cacheSet(string $key, $value, int $ttl): void
    {
        if (!class_exists('Tfm\Cache')) return;
        try { Cache::set('allot:' . $key, $value, $ttl); } catch (\Throwable $e) { /* the database is the truth */ }
    }

    private static function cacheDel(string $key): void
    {
        if (!class_exists('Tfm\Cache')) return;
        try { Cache::del('allot:' . $key); } catch (\Throwable $e) { /* ignore */ }
    }

    // ------------------------------------------------------------------ rules and texts (settings rows, config, defaults)
    /** one rule, typed and inside its range (an unusable stored value falls back to the default) */
    public static function conf(string $key)
    {
        if (!isset(self::RULES[$key])) throw new \InvalidArgumentException('unknown allot rule');
        $raw = class_exists('Tfm\Settings') ? Settings::get('allot.' . $key) : Config::get('allot.' . $key);
        try {
            $v = self::coerceRule($key, $raw);
        } catch (ApiException $e) {
            $v = null;
        }
        return $v === null ? self::DEFAULTS[$key] : $v;
    }

    /** every rule as conf() gives it (the admin 자동화 form, plans) */
    public static function rules(): array
    {
        $out = [];
        foreach (self::RULES as $k => $unused) $out[$k] = self::conf($k);
        return $out;
    }

    public static function enabled(): bool { return self::conf('enabled') === true; }

    /** 403 ALLOT_DISABLED while the operator has switched the feature off */
    public static function guard(): void
    {
        if (!self::enabled()) throw new ApiException(403, 'ALLOT_DISABLED', '지금은 분양을 쉬고 있어요.');
    }

    /** @return mixed|null the clean value, null for "not set"; throws 400 INVALID_INPUT for an unusable one */
    private static function coerceRule(string $key, $v)
    {
        if ($v === null) return null;
        $rule = self::RULES[$key];
        if ($rule[0] === 'bool') return self::inBool([$key => $v], $key);
        if ($rule[0] === 'int') return self::inInt([$key => $v], $key, $rule[1], $rule[2]);
        if ($rule[0] === 'enum') {
            if (!is_string($v) || !in_array($v, $rule[1], true)) V::fail($key, '값이 올바르지 않아요.');
            return $v;
        }
        if ($rule[0] === 'label') {
            if (!is_string($v) || !preg_match('/^[A-Za-z0-9.\-]{1,20}$/', $v)) V::fail($key, '값은 영문 · 숫자 · 점 · 줄표 1~20자여야 해요.');
            return $v;
        }
        // days: a list of 0..365 (or "30, 7, 0"), largest first, without repeats, at most 6
        if (is_string($v)) $v = $v === '' ? [] : preg_split('/[\s,]+/', trim($v));
        if (!is_array($v) || count($v) > 12) V::fail($key, '값은 날짜 수 목록이어야 해요. (예: 30, 7, 0)');
        $days = [];
        foreach ($v as $d) {
            if (is_string($d) && preg_match('/^(?:0|[1-9]\d{0,2})$/', $d)) $d = (int) $d;
            if (!is_int($d) || $d < 0 || $d > 365) V::fail($key, '값은 0~365 사이의 날짜 수 목록이어야 해요. (예: 30, 7, 0)');
            $days[$d] = true;
        }
        $days = array_keys($days);
        rsort($days);
        if (count($days) > 6) V::fail($key, '알림 날짜는 6개까지 정할 수 있어요.');
        return $days;
    }

    /** the operator texts: ['terms', 'privacy', 'refund', 'payGuide', 'sample' (true while any is still the example)] */
    public static function texts(): array
    {
        $out = [];
        $sample = false;
        foreach (self::TEXT_KEYS as $k => $name) {
            $v = class_exists('Tfm\Settings') ? Settings::get('allot.' . $k) : null;
            if (!is_string($v) || trim($v) === '') { $v = self::SAMPLE_TEXTS[$k]; $sample = true; }
            $out[$name] = $v;
        }
        $out['sample'] = $sample;
        return $out;
    }

    /**
     * The consent version an application must carry: "<consent_version label>.<8 hex of the privacy + terms texts>", so a
     * changed text is a new version by itself and the label lets the operator ask everyone again without editing a text.
     */
    public static function consentVersion(): string
    {
        $t = self::texts();
        return self::conf('consent_version') . '.' . substr(hash('sha256', $t['privacy'] . "\n\x1e" . $t['terms']), 0, 8);
    }

    /** keep the texts of the current consent version (what a customer agreed to can be shown later) */
    private static function rememberTerms(int $now): string
    {
        $ver = self::consentVersion();
        if (Db::value('SELECT id FROM allot_terms WHERE ver = ?', [$ver]) === null) {
            $t = self::texts();
            try {
                Db::insert('allot_terms', ['ver' => $ver, 'privacy_text' => $t['privacy'], 'terms_text' => $t['terms'], 'refund_text' => $t['refund'], 'created_at' => $now]);
            } catch (\PDOException $e) {
                if ((string) $e->getCode() !== '23000') throw $e; // another request stored the same version
            }
        }
        return $ver;
    }

    /**
     * The admin 자동화 form: rules (see RULES) and texts (terms_text, privacy_text, refund_text, pay_guide; '' = back to the
     * example). Unknown keys and unusable values are 400 INVALID_INPUT; nothing is stored unless everything is valid.
     * Audit allot_settings (the names of what changed and the new rule values — never a text). @return ['changed' => [keys]]
     */
    public static function saveSettings(array $a, array $in): array
    {
        $actor = self::admin($a);
        $clean = [];
        foreach ($in as $k => $v) {
            $k = (string) $k;
            if (isset(self::RULES[$k])) {
                $c = self::coerceRule($k, $v);
                if ($c === null) V::fail($k, '값을 입력해 주세요.');
                $clean[$k] = $c;
            } elseif (isset(self::TEXT_KEYS[$k])) {
                if (!is_string($v)) V::fail($k, '값은 글자로 보내 주세요.');
                if (strlen($v) > self::TEXT_MAX * 4 || mb_strlen($v) > self::TEXT_MAX) V::fail($k, '글이 너무 길어요. (최대 ' . self::TEXT_MAX . '자)');
                $clean[$k] = self::cleanLong($v, self::TEXT_MAX);
            } else {
                V::fail($k, '항목은 여기에서 쓸 수 없어요.');
            }
        }
        $now = Clock::ms();
        $changed = [];
        $values = [];
        Db::tx(function () use ($clean, $actor, $now, &$changed, &$values) {
            foreach ($clean as $k => $v) {
                $isText = isset(self::TEXT_KEYS[$k]);
                $old = Db::value('SELECT v FROM settings WHERE k = ?', ['allot.' . $k]);
                if ($isText && $v === '') {
                    if ($old !== null) { Db::exec('DELETE FROM settings WHERE k = ?', ['allot.' . $k]); $changed[] = $k; }
                    continue;
                }
                $json = (string) json_encode($v, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
                if ($old !== null && (string) $old === $json) continue;
                Db::upsert('settings', ['k' => 'allot.' . $k, 'v' => $json, 'updated_at' => $now, 'updated_by' => self::idOrNull($actor)], ['k']);
                $changed[] = $k;
                if (!$isText) $values[$k] = $v;
            }
        });
        if (class_exists('Tfm\Settings')) Settings::reset();
        self::$memo = [];
        if ($changed) Audit::log('allot_settings', null, ['changed' => $changed, 'values' => $values], 'warn', self::idOrNull($actor));
        return ['changed' => $changed];
    }

    // ------------------------------------------------------------------ zones
    private static function zoneOut(array $r, ?int $units = null): array
    {
        $out = [
            'id' => (int) $r['id'], 'code' => (string) $r['code'], 'kind' => (string) $r['kind'], 'name' => (string) $r['name'], 'capacity' => (int) $r['capacity'], 'cols' => (int) $r['cols'],
            'sort' => (int) $r['sort'], 'price' => (int) $r['price'], 'period' => (string) $r['period'], 'termMonths' => (int) $r['term_months'], 'isOpen' => (int) $r['is_open'] === 1,
            'note' => (string) $r['note'], 'ver' => (int) $r['ver'], 'updatedAt' => (int) $r['updated_at'],
        ];
        if ($units !== null) $out['units'] = $units;
        return $out;
    }

    private const ZONE_COLS = 'id, code, kind, name, capacity, cols, sort, price, period, term_months, is_open, note, ver, updated_at';

    /** a zone row by id (int / digit string) or code (any case); null when there is none */
    private static function zoneRow($ref): ?array
    {
        if (is_int($ref) || (is_string($ref) && preg_match('/^[1-9]\d{0,15}$/', $ref) && !self::isZoneCode($ref))) {
            return Db::one('SELECT ' . self::ZONE_COLS . ' FROM allot_zones WHERE id = ?', [(int) $ref]);
        }
        if (!is_string($ref) || !self::isZoneCode($ref)) return null;
        return Db::one('SELECT ' . self::ZONE_COLS . ' FROM allot_zones WHERE code = ?', [strtoupper(trim($ref))]);
    }

    /** is this text the code of an existing zone? (a code may be all digits; an id never starts a code look-up otherwise) */
    private static function isZoneCode(string $s): bool
    {
        $s = strtoupper(trim($s));
        if (!preg_match('/^[A-Z0-9]{1,12}$/', $s)) return false;
        if (!ctype_digit($s)) return true;
        return Db::value('SELECT id FROM allot_zones WHERE code = ?', [$s]) !== null;
    }

    /** one zone ({id, code, kind, name, capacity, cols, sort, price, period, termMonths, isOpen, note, ver, updatedAt, units}) or null */
    public static function zone($ref): ?array
    {
        $r = self::zoneRow($ref);
        return $r ? self::zoneOut($r, (int) Db::value('SELECT COUNT(*) FROM allot_units WHERE zone_id = ?', [(int) $r['id']])) : null;
    }

    /** every zone in display order, each with its unit counts: + open, held, leased, closed */
    public static function zones(): array
    {
        $counts = [];
        foreach (Db::all('SELECT zone_id, status, COUNT(*) AS n FROM allot_units GROUP BY zone_id, status') as $c) $counts[(int) $c['zone_id']][(string) $c['status']] = (int) $c['n'];
        $out = [];
        foreach (Db::all('SELECT ' . self::ZONE_COLS . ' FROM allot_zones ORDER BY sort ASC, id ASC') as $r) {
            $c = isset($counts[(int) $r['id']]) ? $counts[(int) $r['id']] : [];
            $z = self::zoneOut($r, array_sum($c));
            foreach (['open', 'held', 'leased', 'closed'] as $s) $z[$s] = isset($c[$s]) ? $c[$s] : 0;
            $out[] = $z;
        }
        return $out;
    }

    /**
     * Create a zone (code + kind required; code ^[A-Z0-9]{1,12}$, stored in upper case) or change one (by id or code).
     * $in: id?, code, kind 'jar'|'plot'|'store', name, capacity 0–5000, cols 1–200, sort, price 0–10,000,000 KRW per
     * period, period 'once'|'month'|'year', termMonths 0–120 (0 = open-ended, not for 'once'), isOpen, note. The code and
     * the kind of an existing zone never change. A given capacity creates / removes the units (seedUnits). A changed price
     * / period / term applies to new contracts only. Audit allot_zone_saved. 400 INVALID_INPUT, 404 NOT_FOUND.
     */
    public static function saveZone(array $a, array $in): array
    {
        $actor = self::admin($a);
        V::keys($in, ['id', 'code', 'kind', 'name', 'capacity', 'cols', 'sort', 'price', 'period', 'termMonths', 'isOpen', 'note'], 'zone');
        $now = Clock::ms();
        $cur = null;
        if (isset($in['id']) && $in['id'] !== '') {
            $cur = Db::one('SELECT ' . self::ZONE_COLS . ' FROM allot_zones WHERE id = ?', [(int) self::inInt($in, 'id', 1, V::INT_MAX)]);
            if (!$cur) throw new ApiException(404, 'NOT_FOUND', '구역을 찾을 수 없어요.');
        } else {
            $code = strtoupper(trim((string) self::inStr($in, 'code', 12, '')));
            if (!preg_match('/^[A-Z0-9]{1,12}$/', $code)) V::fail('code', '값은 영문 대문자 · 숫자 1~12자여야 해요. (예: J01)');
            $cur = Db::one('SELECT ' . self::ZONE_COLS . ' FROM allot_zones WHERE code = ?', [$code]);
        }
        $period = self::inStr($in, 'period', 10);
        if ($period !== null && !in_array($period, ['once', 'month', 'year'], true)) V::fail('period', '값은 once · month · year 가운데 하나여야 해요.');
        $price = self::inInt($in, 'price', 0, self::MAX_AMOUNT);
        $term = self::inInt($in, 'termMonths', 0, 120);
        $capacity = self::inInt($in, 'capacity', 0, self::MAX_ZONE_UNITS);
        $cols = self::inInt($in, 'cols', 1, 200);
        $sort = self::inInt($in, 'sort', -9999, 9999);
        $open = self::inBool($in, 'isOpen');
        $name = self::inStr($in, 'name', 60);
        if ($name !== null) $name = self::cleanPublic($name, 60);
        $note = self::inStr($in, 'note', 200);
        if ($note !== null) $note = self::cleanPrivate($note, 200);
        if (!$cur) {
            $kind = self::inStr($in, 'kind', 10, '');
            if (!in_array($kind, self::KINDS, true)) V::fail('kind', '값은 jar · plot · store 가운데 하나여야 해요.');
            $p = $period === null ? 'year' : $period;
            $t = $term === null ? ($p === 'month' ? 0 : 12) : $term;
            if ($p === 'once' && $t < 1) V::fail('termMonths', '한 번 내는(once) 구역은 기간이 1개월 이상이어야 해요.');
            if ($sort === null) $sort = (int) Db::value('SELECT COALESCE(MAX(sort), 0) FROM allot_zones') + 1;
            try {
                $id = Db::insert('allot_zones', [
                    'code' => $code, 'kind' => $kind, 'name' => $name === null || $name === '' ? self::KIND_NAMES[$kind] . ' ' . $code : $name, 'capacity' => 0, 'cols' => $cols === null ? 40 : $cols,
                    'sort' => $sort, 'price' => $price === null ? 0 : $price, 'period' => $p, 'term_months' => $t, 'is_open' => $open ? 1 : 0, 'note' => $note === null ? '' : $note,
                    'ver' => 1, 'map_ver' => 0, 'map_s' => null, 'created_at' => $now, 'updated_at' => $now,
                ]);
            } catch (\PDOException $e) {
                if ((string) $e->getCode() === '23000') throw new ApiException(409, 'ZONE_EXISTS', '같은 번호의 구역이 이미 있어요.');
                throw $e;
            }
            self::$memo = [];
            self::cacheDel('mapv');
            Audit::log('allot_zone_saved', null, ['zone' => $code, 'kind' => $kind, 'new' => true], 'info', self::idOrNull($actor));
        } else {
            $id = (int) $cur['id'];
            $p = $period === null ? (string) $cur['period'] : $period;
            $t = $term === null ? (int) $cur['term_months'] : $term;
            if ($p === 'once' && $t < 1) V::fail('termMonths', '한 번 내는(once) 구역은 기간이 1개월 이상이어야 해요.');
            Db::exec('UPDATE allot_zones SET name = ?, cols = ?, sort = ?, price = ?, period = ?, term_months = ?, is_open = ?, note = ?, ver = ver + 1, updated_at = ? WHERE id = ?', [
                $name === null || $name === '' ? (string) $cur['name'] : $name, $cols === null ? (int) $cur['cols'] : $cols, $sort === null ? (int) $cur['sort'] : $sort,
                $price === null ? (int) $cur['price'] : $price, $p, $t, $open === null ? (int) $cur['is_open'] : ($open ? 1 : 0), $note === null ? (string) $cur['note'] : $note, $now, $id,
            ]);
            self::$memo = [];
            self::cacheDel('mapv');
            Audit::log('allot_zone_saved', null, ['zone' => (string) $cur['code'], 'price' => $price, 'period' => $period, 'open' => $open], 'info', self::idOrNull($actor));
        }
        if ($capacity !== null) self::seedUnits($a, $id, $capacity);
        return (array) self::zone($id);
    }

    /**
     * Make the zone hold exactly $count units (null = its capacity): new units are appended with the next seq and the code
     * "<zone>-<seq, 4 digits>"; a smaller number removes units from the end — only free ones that never had a contract
     * (409 UNITS_IN_USE otherwise, nothing changes). One transaction per zone; calling it again adds nothing.
     * @return int units added (negative: removed)
     */
    public static function seedUnits(array $a, $zone, ?int $count = null): int
    {
        $actor = self::admin($a);
        $z = self::zoneRow($zone);
        if (!$z) throw new ApiException(404, 'NOT_FOUND', '구역을 찾을 수 없어요.');
        $zid = (int) $z['id'];
        if ($count === null) $count = (int) $z['capacity'];
        if ($count < 0 || $count > self::MAX_ZONE_UNITS) V::fail('capacity', '값은 0~' . self::MAX_ZONE_UNITS . ' 사이의 정수여야 해요.');
        $now = Clock::ms();
        $delta = Db::txRetry(function () use ($zid, $count, $now) {
            $zr = Db::one('SELECT id, code, kind, capacity FROM allot_zones WHERE id = ?' . Db::forUpdate(), [$zid]);
            if (!$zr) throw new ApiException(404, 'NOT_FOUND', '구역을 찾을 수 없어요.');
            $have = (int) Db::value('SELECT COUNT(*) FROM allot_units WHERE zone_id = ?', [$zid]);
            $delta = 0;
            if ($count > $have) {
                $all = (int) Db::value('SELECT COUNT(*) FROM allot_units');
                if ($all + $count - $have > self::MAX_UNITS) throw new ApiException(400, 'INVALID_INPUT', '단위는 모두 ' . self::MAX_UNITS . '개까지 만들 수 있어요.', ['field' => 'capacity']);
                $seq = (int) Db::value('SELECT COALESCE(MAX(seq), 0) FROM allot_units WHERE zone_id = ?', [$zid]);
                $st = Db::pdo()->prepare("INSERT INTO allot_units (zone_id, kind, code, seq, status, hold_until, label, label_show, created_at, updated_at) VALUES (?, ?, ?, ?, 'open', 0, '', 0, ?, ?)");
                $st->bindValue(1, $zid, \PDO::PARAM_INT);
                $st->bindValue(2, (string) $zr['kind'], \PDO::PARAM_STR);
                $st->bindValue(5, $now, \PDO::PARAM_INT);
                $st->bindValue(6, $now, \PDO::PARAM_INT);
                while ($have + $delta < $count) {
                    $seq++;
                    $st->bindValue(3, sprintf('%s-%04d', (string) $zr['code'], $seq), \PDO::PARAM_STR);
                    $st->bindValue(4, $seq, \PDO::PARAM_INT);
                    $st->execute();
                    $delta++;
                }
            } elseif ($count < $have) {
                $cut = $have - $count;
                $first = (int) Db::value('SELECT seq FROM allot_units WHERE zone_id = ? ORDER BY seq DESC LIMIT 1 OFFSET ?', [$zid, $cut - 1]);
                $busy = (int) Db::value("SELECT COUNT(*) FROM allot_units WHERE zone_id = ? AND seq >= ? AND status <> 'open'", [$zid, $first])
                    + (int) Db::value('SELECT COUNT(*) FROM allot_contracts c JOIN allot_units u ON u.id = c.unit_id WHERE u.zone_id = ? AND u.seq >= ?', [$zid, $first]);
                if ($busy > 0) throw new ApiException(409, 'UNITS_IN_USE', '줄이려는 자리 가운데 쓰고 있거나 계약 기록이 있는 자리가 있어요. 그 자리는 지울 수 없어요.');
                $delta = -Db::exec('DELETE FROM allot_units WHERE zone_id = ? AND seq >= ?', [$zid, $first]);
            }
            if ($delta !== 0 || (int) $zr['capacity'] !== $count) {
                Db::exec('UPDATE allot_zones SET capacity = ?, ver = ver + 1, updated_at = ? WHERE id = ?', [$count, $now, $zid]);
            }
            return $delta;
        });
        self::$memo = [];
        self::cacheDel('mapv');
        if ($delta !== 0) Audit::log('allot_units_seeded', null, ['zone' => (string) $z['code'], 'delta' => $delta, 'units' => $count], 'info', self::idOrNull($actor));
        return $delta;
    }

    /**
     * `allot:seed`: the zones of a preset that do not exist yet are created (closed for applications unless $open, with
     * example prices marked 예시) and every zone of the preset is filled up to its capacity. Zones that exist keep whatever
     * the operator changed. default = 6 jar zones × 1,000 + 3 plot zones × 1,000 + 2 store zones × 500 = 10,000 units.
     * @return array ['preset', 'zones', 'created', 'units', 'added']
     */
    public static function seedPreset(array $a, string $preset = 'default', bool $open = false): array
    {
        self::admin($a);
        if (!isset(self::PRESETS[$preset])) throw new ApiException(400, 'INVALID_INPUT', '모르는 묶음 이름이에요. (default · small)', ['field' => 'preset']);
        $out = ['preset' => $preset, 'zones' => 0, 'created' => 0, 'units' => 0, 'added' => 0];
        foreach (self::PRESETS[$preset] as $p) {
            list($prefix, $kind, $n, $cap, $cols, $pattern, $price, $period, $term) = $p;
            for ($i = 1; $i <= $n; $i++) {
                $code = sprintf('%s%02d', $prefix, $i);
                $z = self::zoneRow($code);
                if (!$z) {
                    $made = self::saveZone($a, ['code' => $code, 'kind' => $kind, 'name' => sprintf($pattern, $i), 'cols' => $cols, 'price' => $price, 'period' => $period, 'termMonths' => $term,
                        'isOpen' => $open, 'note' => self::SAMPLE_NOTE]);
                    Db::exec('UPDATE allot_zones SET capacity = ? WHERE id = ?', [$cap, $made['id']]);
                    $out['created']++;
                }
                $out['added'] += max(0, self::seedUnits($a, $code, null));
                $out['zones']++;
                $out['units'] += (int) Db::value('SELECT COUNT(*) FROM allot_units u JOIN allot_zones z ON z.id = u.zone_id WHERE z.code = ?', [$code]);
            }
        }
        return $out;
    }

    // ------------------------------------------------------------------ units
    private const UNIT_SELECT = 'SELECT u.id, u.zone_id, z.code AS zone_code, z.name AS zone_name, z.is_open AS zone_open, u.kind, u.code, u.seq, u.status, u.contract_id, u.hold_until, u.label, u.label_show,
            u.updated_at, c.contract_no, c.status AS contract_status
        FROM allot_units u LEFT JOIN allot_zones z ON z.id = u.zone_id LEFT JOIN allot_contracts c ON c.id = u.contract_id';
    // [verify-allot] LEFT JOINs on purpose (every unit has its zone, every contract its unit — none is ever deleted): an inner
    // join lets MariaDB start from the 11-row zones table and sort ALL units / contracts for a 50-row page (47 ms → 1.4 ms)

    private static function unitOut(array $r): array
    {
        return [
            'id' => (int) $r['id'], 'code' => (string) $r['code'], 'kind' => (string) $r['kind'], 'zoneId' => (int) $r['zone_id'], 'zoneCode' => (string) $r['zone_code'], 'zoneName' => (string) $r['zone_name'],
            'seq' => (int) $r['seq'], 'status' => (string) $r['status'], 'contractId' => $r['contract_id'] === null ? 0 : (int) $r['contract_id'],
            'contractNo' => $r['contract_no'] === null ? '' : (string) $r['contract_no'], 'contractStatus' => $r['contract_status'] === null ? '' : (string) $r['contract_status'],
            'holdUntil' => (int) $r['hold_until'], 'label' => (string) $r['label'], 'labelShow' => (int) $r['label_show'] === 1, 'updatedAt' => (int) $r['updated_at'],
        ];
    }

    /** a well-formed unit code in upper case, or '' */
    private static function unitCode($code): string
    {
        if (!is_string($code)) return '';
        $c = strtoupper(trim($code));
        return preg_match('/^[A-Z0-9]{1,12}-\d{1,6}$/', $c) ? $c : '';
    }

    /** one unit by code (admin view: {id, code, kind, zoneId, zoneCode, zoneName, seq, status, contractId, contractNo, contractStatus, holdUntil, label, labelShow, updatedAt}) or null */
    public static function unit($ref): ?array
    {
        if (is_int($ref)) $r = Db::one(self::UNIT_SELECT . ' WHERE u.id = ?', [$ref]);
        else { $c = self::unitCode($ref); $r = $c === '' ? null : Db::one(self::UNIT_SELECT . ' WHERE u.code = ?', [$c]); }
        return $r ? self::unitOut($r) : null;
    }

    /**
     * Units by id (keyset: $afterId = the `next` of the page before; 0 = from the start). $filter: kind, zone (id or code),
     * status, q (the beginning of a unit code). @return ['rows' => [unit …], 'next' => id of the last row, or 0 on the last page]
     */
    public static function listUnits(array $filter, int $limit = 50, int $afterId = 0): array
    {
        $kind = isset($filter['kind']) && in_array($filter['kind'], self::KINDS, true) ? (string) $filter['kind'] : '';
        // [verify-allot] a filter value from a query string can be an array (status[]=…): only a string is a status
        $status = isset($filter['status']) && is_string($filter['status']) && isset(self::STATUS_CHAR[$filter['status']]) ? (string) $filter['status'] : '';
        $zid = 0;
        if (isset($filter['zone']) && $filter['zone'] !== '' && $filter['zone'] !== 0) {
            $z = self::zoneRow($filter['zone']);
            if (!$z) return ['rows' => [], 'next' => 0];
            $zid = (int) $z['id'];
        }
        $q = isset($filter['q']) && is_string($filter['q']) ? strtoupper(trim(mb_substr($filter['q'], 0, 24))) : '';
        $like = $q === '' ? '' : str_replace(['!', '%', '_'], ['!!', '!%', '!_'], $q) . '%';
        $limit = max(1, min(500, $limit));
        $rows = Db::all(self::UNIT_SELECT . " WHERE u.id > ? AND (? = '' OR u.kind = ?) AND (? = 0 OR u.zone_id = ?) AND (? = '' OR u.status = ?) AND (? = '' OR u.code LIKE ? ESCAPE '!')
            ORDER BY u.id ASC LIMIT ?", [max(0, $afterId), $kind, $kind, $zid, $zid, $status, $status, $like, $like, $limit + 1]);
        $more = count($rows) > $limit;
        if ($more) array_pop($rows);
        $out = array_map(function ($r) { return self::unitOut($r); }, $rows);
        return ['rows' => $out, 'next' => $more && $out ? $out[count($out) - 1]['id'] : 0];
    }

    /**
     * The one statement that moves a unit between states. It always changes `status` ($from !== $to), so "exactly one row"
     * means the same on MariaDB (changed rows) and SQLite (matched rows). $guard: 'any' | 'free' (no contract on it) |
     * 'contract' (it carries $guardId).
     */
    private static function unitCas(int $unitId, string $from, string $to, ?int $contractId, int $holdUntil, int $now, string $guard = 'any', int $guardId = 0): bool
    {
        if ($from === $to) throw new \LogicException('a unit compare-and-set must change the status');
        if ($guard === 'free') {
            return Db::exec('UPDATE allot_units SET status = ?, contract_id = ?, hold_until = ?, updated_at = ? WHERE id = ? AND status = ? AND contract_id IS NULL', [$to, $contractId, $holdUntil, $now, $unitId, $from]) === 1;
        }
        if ($guard === 'contract') {
            return Db::exec('UPDATE allot_units SET status = ?, contract_id = ?, hold_until = ?, updated_at = ? WHERE id = ? AND status = ? AND contract_id = ?', [$to, $contractId, $holdUntil, $now, $unitId, $from, $guardId]) === 1;
        }
        return Db::exec('UPDATE allot_units SET status = ?, contract_id = ?, hold_until = ?, updated_at = ? WHERE id = ? AND status = ?', [$to, $contractId, $holdUntil, $now, $unitId, $from]) === 1;
    }

    /**
     * A held unit without a contract (an operator hold, a waiting-list offer) gets its contract. The status stays 'held',
     * so the value that changes is contract_id (NULL → id): still exactly one row on both drivers.
     */
    private static function heldAttach(int $unitId, int $contractId, int $holdUntil, int $now): bool
    {
        return Db::exec("UPDATE allot_units SET contract_id = ?, hold_until = ?, updated_at = ? WHERE id = ? AND status = 'held' AND contract_id IS NULL", [$contractId, $holdUntil, $now, $unitId]) === 1;
    }

    /** a status of a unit of this zone changed: the map version moves on */
    private static function bumpZone(int $zoneId, int $now): void
    {
        Db::exec('UPDATE allot_zones SET ver = ver + 1, updated_at = ? WHERE id = ?', [$now, $zoneId]);
        self::$memo = [];
        self::cacheDel('mapv');
    }

    /**
     * The operator's switch for a unit without a contract: 'closed' (not for allotment), 'open', or 'held' for $holdHours
     * (0 = until it is opened again). 409 UNIT_IN_USE for a unit with a live contract or a waiting-list offer.
     * Audit allot_unit_state. @return array the unit
     */
    public static function setUnitState(array $a, int $unitId, string $state, int $holdHours = 0, ?int $now = null): array
    {
        $actor = self::admin($a);
        if (!in_array($state, ['open', 'closed', 'held'], true)) V::fail('state', '값은 open · closed · held 가운데 하나여야 해요.');
        if ($holdHours < 0 || $holdHours > 87600) V::fail('holdHours', '값은 0~87600 사이의 정수여야 해요.');
        $now = self::now($now);
        $code = Db::txRetry(function () use ($unitId, $state, $holdHours, $now) {
            $u = Db::one('SELECT id, zone_id, code, status, contract_id FROM allot_units WHERE id = ?' . Db::forUpdate(), [$unitId]);
            if (!$u) throw new ApiException(404, 'NOT_FOUND', '자리를 찾을 수 없어요.');
            $from = (string) $u['status'];
            $offered = (int) Db::value("SELECT COUNT(*) FROM allot_waitlist WHERE unit_id = ? AND status = 'offered'", [$unitId]) > 0;
            if ($u['contract_id'] !== null || $from === 'leased' || $offered) throw new ApiException(409, 'UNIT_IN_USE', '계약이나 대기자 제안이 걸려 있는 자리예요. 계약 · 대기자 화면에서 먼저 정리해 주세요.');
            if ($from !== $state) {
                if (!self::unitCas($unitId, $from, $state, null, $state === 'held' && $holdHours > 0 ? $now + $holdHours * 3600000 : 0, $now, 'free')) {
                    throw new ApiException(409, 'UNIT_TAKEN', '방금 다른 곳에서 이 자리를 바꿨어요. 다시 확인해 주세요.');
                }
                self::bumpZone((int) $u['zone_id'], $now);
            }
            return (string) $u['code'];
        });
        Audit::log('allot_unit_state', null, ['unit' => $code, 'state' => $state, 'holdHours' => $holdHours], 'info', self::idOrNull($actor));
        return (array) self::unit($unitId);
    }

    // ------------------------------------------------------------------ the map (identical for every user, no personal data)
    /** the map version: the sum of the zone counters — it grows with every status change of any unit and every zone edit */
    public static function mapVersion(): int
    {
        if (isset(self::$memo['v'])) return self::$memo['v'];
        $v = self::cacheGet('mapv');
        if (!is_int($v)) {
            $v = (int) Db::value('SELECT COALESCE(SUM(ver), 0) FROM allot_zones');
            self::cacheSet('mapv', $v, 2);
        }
        return self::$memo['v'] = $v;
    }

    /**
     * {v, zones: [{code, kind, name, cap, cols, open, s}]} — `s` has one character per unit in seq order: o open, h held,
     * l leased, c closed. $have = the version the caller already has: an unchanged map answers {v, same: true}.
     * $kind / $zone (code) narrow the list; v is always the version of the whole map. The strings are kept per zone
     * (allot_zones.map_s, rebuilt on the first read after a change) and, when Tfm\Cache exists, the answer per version.
     */
    public static function map(?string $kind = null, $zone = null, ?int $have = null): array
    {
        $v = self::mapVersion();
        if ($have !== null && $have === $v) return ['v' => $v, 'same' => true];
        $kind = $kind !== null && in_array($kind, self::KINDS, true) ? $kind : '';
        $code = '';
        if ($zone !== null && $zone !== '') {
            $code = is_string($zone) ? strtoupper(trim($zone)) : '';
            if (!preg_match('/^[A-Z0-9]{1,12}$/', $code)) return ['v' => $v, 'zones' => []];
        }
        $ck = 'map:' . $v . ':' . $kind . ':' . $code;
        $hit = self::cacheGet($ck);
        if (is_array($hit) && isset($hit['zones'])) return $hit;
        $zones = [];
        foreach (Db::all("SELECT id, code, kind, name, cols, is_open, ver, map_ver, map_s FROM allot_zones WHERE (? = '' OR kind = ?) AND (? = '' OR code = ?) ORDER BY sort ASC, id ASC", [$kind, $kind, $code, $code]) as $z) {
            $s = (int) $z['map_ver'] === (int) $z['ver'] && is_string($z['map_s']) ? $z['map_s'] : self::rebuildMap((int) $z['id'], (int) $z['ver']);
            $zones[] = ['code' => (string) $z['code'], 'kind' => (string) $z['kind'], 'name' => (string) $z['name'], 'cap' => strlen($s), 'cols' => (int) $z['cols'], 'open' => (int) $z['is_open'] === 1, 's' => $s];
        }
        $out = ['v' => $v, 'zones' => $zones];
        self::cacheSet($ck, $out, 30);
        return $out;
    }

    /** the status string of one zone from its units; stored for the version it was read at */
    private static function rebuildMap(int $zoneId, int $ver): string
    {
        $s = '';
        $n = 0;
        foreach (Db::all('SELECT seq, status FROM allot_units WHERE zone_id = ? ORDER BY seq ASC', [$zoneId]) as $u) {
            $seq = (int) $u['seq'];
            while ($n < $seq - 1) { $s .= 'c'; $n++; } // a hole in the numbering (never made by this code) reads as closed
            $s .= isset(self::STATUS_CHAR[$u['status']]) ? self::STATUS_CHAR[$u['status']] : 'c';
            $n++;
        }
        try {
            Db::exec('UPDATE allot_zones SET map_s = ?, map_ver = ? WHERE id = ? AND ver = ? AND map_ver <> ?', [$s, $ver, $zoneId, $ver, $ver]);
        } catch (\Throwable $e) {
            // a busy database: the next reader stores it
        }
        return $s;
    }

    /**
     * Public numbers (api/allot/summary.php): {enabled, total, open, held, leased, closed, byKind: {jar|plot|store: {total,
     * open, held, leased, closed}}, zones, waiting, v}. No prices, no personal data.
     */
    public static function summary(): array
    {
        $v = self::mapVersion();
        if (isset(self::$memo['sum']) && self::$memo['sum']['v'] === $v) return self::$memo['sum'];
        $hit = self::cacheGet('sum:' . $v);
        if (is_array($hit) && isset($hit['byKind'])) return self::$memo['sum'] = $hit;
        $zero = ['total' => 0, 'open' => 0, 'held' => 0, 'leased' => 0, 'closed' => 0];
        $out = ['enabled' => self::enabled()] + $zero + ['byKind' => ['jar' => $zero, 'plot' => $zero, 'store' => $zero]];
        foreach (Db::all('SELECT kind, status, COUNT(*) AS n FROM allot_units GROUP BY kind, status') as $r) {
            $k = (string) $r['kind'];
            $s = (string) $r['status'];
            $n = (int) $r['n'];
            if (!isset($out['byKind'][$k]) || !isset($zero[$s])) continue;
            $out['byKind'][$k][$s] += $n;
            $out['byKind'][$k]['total'] += $n;
            $out[$s] += $n;
            $out['total'] += $n;
        }
        $out['zones'] = (int) Db::value('SELECT COUNT(*) FROM allot_zones');
        $out['waiting'] = (int) Db::value("SELECT COUNT(*) FROM allot_waitlist WHERE status = 'waiting'");
        $out['v'] = $v;
        self::cacheSet('sum:' . $v, $out, 10);
        return self::$memo['sum'] = $out;
    }

    // ------------------------------------------------------------------ customers (sealed personal data, blind indexes)
    /** digits of a Korean phone number ("010-1234-5678", "+82 10 1234 5678" → "01012345678"), or '' when it is not one */
    public static function normPhone($v): string
    {
        if (!is_string($v)) return '';
        $s = (string) preg_replace('/[\s\-.()]+/u', '', trim($v));
        if (strncmp($s, '+82', 3) === 0) $s = '0' . ltrim(substr($s, 3), '0');
        if (!preg_match('/^0\d{8,10}$/', $s)) return '';
        return $s;
    }

    /** "010-1234-5678" from the digits */
    private static function fmtPhone(string $d): string
    {
        $n = strlen($d);
        if (strncmp($d, '02', 2) === 0 && ($n === 9 || $n === 10)) return '02-' . substr($d, 2, $n - 6) . '-' . substr($d, -4);
        if ($n === 10 || $n === 11) return substr($d, 0, 3) . '-' . substr($d, 3, $n - 7) . '-' . substr($d, -4);
        return $d;
    }

    /** the keyed blind indexes (the same construction as Sec::hashId, with their own label) */
    private static function phoneHash(string $digits): string { return $digits === '' ? '' : Sec::hashId('allot-phone:' . $digits); }
    private static function nameKey(string $name): string { return mb_strtolower((string) preg_replace('/\s+/u', '', $name)); }
    private static function nameHash(string $name): string { $k = self::nameKey($name); return $k === '' ? '' : Sec::hashId('allot-name:' . $k); }

    /** "김**" — the first character and stars */
    private static function maskName(string $name): string
    {
        $n = mb_strlen($name);
        return $n === 0 ? '' : mb_substr($name, 0, 1) . str_repeat('*', max(1, min(4, $n - 1)));
    }

    private static function maskPhone(string $tail): string { return $tail === '' ? '' : '***-****-' . $tail; }

    /** seal one value; '' stays '' */
    private static function seal(string $plain): string { return $plain === '' ? '' : Crypto::seal($plain); }

    /** the plaintext of a sealed column ('' when empty or unreadable — a lost data key never throws here) */
    private static function unseal($stored): string
    {
        if (!is_string($stored) || $stored === '') return '';
        $p = Crypto::open($stored);
        return $p === null ? '' : $p;
    }

    /** a person's name as typed: 1–40 characters with at least one letter → the cleaned name */
    private static function cleanName($v): string
    {
        if (!is_string($v)) V::fail('name', '값은 글자로 보내 주세요.');
        V::str($v, 'name', 40);
        $name = Users::cleanText($v, 40);
        if ($name === '' || !preg_match('/\p{L}/u', $name)) V::fail('name', '이름을 적어 주세요.');
        return $name;
    }

    /**
     * The applicant's part of an application / waiting-list form: consent === true, adult === true and the current consent
     * version (400 CONSENT_REQUIRED, data.field + data.version), then name, phone (400 INVALID_INPUT) and — only when
     * collect_address is on — the address. → ['name', 'phone' (digits), 'addr', 'guardian']
     */
    private static function applicantForm(array $form): array
    {
        $ver = self::consentVersion();
        foreach (['consent' => '개인정보 수집 · 이용에 동의해 주세요.', 'adult' => '만 14세 이상 본인이거나 보호자인지 확인해 주세요.'] as $k => $msg) {
            if (!isset($form[$k]) || $form[$k] !== true) throw new ApiException(400, 'CONSENT_REQUIRED', $msg, ['field' => $k, 'version' => $ver]);
        }
        if (!isset($form['consentVersion']) || !is_string($form['consentVersion']) || !hash_equals($ver, $form['consentVersion'])) {
            throw new ApiException(400, 'CONSENT_REQUIRED', '안내문이 바뀌었어요. 새 안내문을 읽고 다시 동의해 주세요.', ['field' => 'consentVersion', 'version' => $ver]);
        }
        $name = self::cleanName(isset($form['name']) ? $form['name'] : null);
        $phone = self::normPhone(isset($form['phone']) ? $form['phone'] : null);
        if ($phone === '') V::fail('phone', '전화번호를 다시 확인해 주세요. (예: 010-1234-5678)');
        $addr = '';
        if (self::conf('collect_address') && isset($form['addr']) && $form['addr'] !== null) {
            if (!is_string($form['addr'])) V::fail('addr', '값은 글자로 보내 주세요.');
            V::str($form['addr'], 'addr', 200);
            $addr = Users::cleanText($form['addr'], 200);
        }
        return ['name' => $name, 'phone' => $phone, 'addr' => $addr, 'guardian' => isset($form['guardian']) && $form['guardian'] === true];
    }

    /** the customer row of an app account: created or refreshed from the form (inside the caller's transaction) → id */
    private static function upsertOwnCustomer(int $uid, array $f, int $now): int
    {
        $ver = self::rememberTerms($now);
        if (!Crypto::fits($f['name'], 255)) V::fail('name', '이름이 너무 길어요.');
        $row = [
            'name_enc' => self::seal($f['name']), 'phone_enc' => self::seal($f['phone']), 'phone_hash' => self::phoneHash($f['phone']), 'phone_tail' => substr($f['phone'], -4),
            'name_hash' => self::nameHash($f['name']), 'consent_at' => $now, 'consent_ver' => $ver, 'guardian' => $f['guardian'] ? 1 : 0, 'purged_at' => 0, 'updated_at' => $now,
        ];
        $cur = Db::one('SELECT id, addr_enc FROM allot_customers WHERE user_id = ?' . Db::forUpdate(), [$uid]);
        if ($cur) {
            $addr = $f['addr'] !== '' ? self::seal($f['addr']) : $cur['addr_enc'];
            Db::exec('UPDATE allot_customers SET name_enc = ?, phone_enc = ?, phone_hash = ?, phone_tail = ?, name_hash = ?, addr_enc = ?, consent_at = ?, consent_ver = ?, guardian = ?, purged_at = 0, updated_at = ? WHERE id = ?',
                [$row['name_enc'], $row['phone_enc'], $row['phone_hash'], $row['phone_tail'], $row['name_hash'], $addr, $now, $ver, $row['guardian'], $now, (int) $cur['id']]);
            return (int) $cur['id'];
        }
        return Db::insert('allot_customers', $row + ['user_id' => $uid, 'addr_enc' => $f['addr'] !== '' ? self::seal($f['addr']) : null, 'memo' => null, 'created_at' => $now]);
    }

    private static function customerOut(array $r, bool $reveal): array
    {
        $name = self::unseal($r['name_enc']);
        $out = [
            'id' => (int) $r['id'], 'userId' => $r['user_id'] === null ? 0 : (int) $r['user_id'], 'name' => self::maskName($name), 'phone' => self::maskPhone((string) $r['phone_tail']),
            'phoneTail' => (string) $r['phone_tail'], 'hasAddr' => is_string($r['addr_enc']) && $r['addr_enc'] !== '', 'hasMemo' => is_string($r['memo']) && $r['memo'] !== '',
            'consentAt' => (int) $r['consent_at'], 'consentVer' => (string) $r['consent_ver'], 'guardian' => (int) $r['guardian'] === 1, 'purged' => (int) $r['purged_at'] > 0,
            'createdAt' => (int) $r['created_at'], 'updatedAt' => (int) $r['updated_at'],
        ];
        if (isset($r['contracts'])) $out['contracts'] = (int) $r['contracts'];
        if ($reveal) {
            $phone = self::unseal($r['phone_enc']);
            $out += ['nameFull' => $name, 'phoneFull' => self::fmtPhone($phone), 'addr' => self::unseal($r['addr_enc']), 'memo' => self::unseal($r['memo'])];
        }
        return $out;
    }

    /**
     * Why an operator looks at personal data: a code from this list (the admin form offers them as a choice). Free text is
     * not accepted on purpose — a typed reason would sooner or later carry a name or a number into the audit log.
     */
    public const REVEAL_REASONS = ['call' => '전화 · 방문 응대', 'payment' => '입금 · 환불 확인', 'delivery' => '수령 · 배송 안내', 'correction' => '정보 고치기',
        'request' => '본인 요청 (열람 · 삭제)', 'report' => '세무 · 법적 자료', 'other' => '기타'];

    private static function revealReason(string $why): string { return isset(self::REVEAL_REASONS[$why]) ? $why : 'other'; }

    /**
     * One customer. Masked by default: {id, userId, name "김**", phone "***-****-1234", phoneTail, hasAddr, hasMemo,
     * consentAt, consentVer, guardian, purged, createdAt, updatedAt, contracts}. $reveal adds nameFull, phoneFull, addr,
     * memo — only for an admin actor (403 FORBIDDEN otherwise; the admin site asks for the password again before it
     * calls this) and every reveal writes the audit row allot_customer_revealed (customer id + the reason code $why — one
     * of REVEAL_REASONS, anything else is recorded as 'other' — never the data).
     */
    public static function customer(int $id, bool $reveal = false, ?array $a = null, string $why = ''): array
    {
        $actor = 0;
        if ($reveal) {
            if ($a === null) throw new ApiException(403, 'FORBIDDEN', '관리자 권한이 필요해요.');
            $actor = self::admin($a);
        }
        $r = Db::one('SELECT cu.*, (SELECT COUNT(*) FROM allot_contracts c WHERE c.customer_id = cu.id) AS contracts FROM allot_customers cu WHERE cu.id = ?', [$id]);
        if (!$r) throw new ApiException(404, 'NOT_FOUND', '고객을 찾을 수 없어요.');
        if ($reveal) {
            Audit::log('allot_customer_revealed', $r['user_id'] === null ? null : (int) $r['user_id'], ['customer' => (int) $r['id'], 'why' => self::revealReason($why)], 'warn', self::idOrNull($actor));
        }
        return self::customerOut($r, $reveal);
    }

    /**
     * The operator enters or corrects a customer. $in: id? (change that one), name, phone ('' allowed for a customer
     * without one), addr, memo (sealed; the operator's note about the person), guardian, consent (true = the operator
     * holds the person's consent on paper → consent_at = now). A second customer with the same phone AND name is
     * 409 CUSTOMER_EXISTS (data.id). Audit allot_customer_saved (id only). @return array the masked view
     */
    public static function saveCustomer(array $a, array $in, ?int $now = null): array
    {
        $actor = self::admin($a);
        V::keys($in, ['id', 'name', 'phone', 'addr', 'memo', 'guardian', 'consent'], 'customer');
        $now = self::now($now);
        $id = self::inInt($in, 'id', 1, V::INT_MAX);
        $cur = $id === null ? null : Db::one('SELECT * FROM allot_customers WHERE id = ?', [$id]);
        if ($id !== null && !$cur) throw new ApiException(404, 'NOT_FOUND', '고객을 찾을 수 없어요.');
        $name = array_key_exists('name', $in) || !$cur ? self::cleanName(isset($in['name']) ? $in['name'] : null) : null;
        $phone = null;
        if (array_key_exists('phone', $in) || !$cur) {
            $raw = isset($in['phone']) ? $in['phone'] : '';
            $phone = $raw === '' ? '' : self::normPhone($raw);
            if ($raw !== '' && $phone === '') V::fail('phone', '전화번호를 다시 확인해 주세요. (예: 010-1234-5678)');
        }
        $addr = self::inStr($in, 'addr', 200);
        $memo = self::inStr($in, 'memo', 500);
        $guardian = self::inBool($in, 'guardian');
        $consent = self::inBool($in, 'consent');
        $saved = Db::tx(function () use ($cur, $name, $phone, $addr, $memo, $guardian, $consent, $now) {
            $n = $name !== null ? $name : self::unseal($cur['name_enc']);
            $p = $phone !== null ? $phone : self::unseal($cur['phone_enc']);
            if ($p !== '') {
                $dup = Db::value('SELECT id FROM allot_customers WHERE phone_hash = ? AND name_hash = ? AND purged_at = 0 AND id <> ?', [self::phoneHash($p), self::nameHash($n), $cur ? (int) $cur['id'] : 0]);
                if ($dup !== null) throw new ApiException(409, 'CUSTOMER_EXISTS', '같은 이름과 전화번호의 고객이 이미 있어요.', ['id' => (int) $dup]);
            }
            $row = ['updated_at' => $now];
            if ($name !== null || !$cur) { $row['name_enc'] = self::seal($n); $row['name_hash'] = self::nameHash($n); }
            if ($phone !== null || !$cur) { $row['phone_enc'] = self::seal($p); $row['phone_hash'] = self::phoneHash($p); $row['phone_tail'] = $p === '' ? '' : substr($p, -4); }
            if ($addr !== null) $row['addr_enc'] = $addr === '' ? null : self::seal(Users::cleanText($addr, 200));
            if ($memo !== null) $row['memo'] = $memo === '' ? null : self::seal(self::cleanPrivate($memo, 500));
            if ($guardian !== null) $row['guardian'] = $guardian ? 1 : 0;
            if ($consent === true) { $row['consent_at'] = $now; $row['consent_ver'] = 'paper:' . self::conf('consent_version'); }
            if (!$cur) return Db::insert('allot_customers', $row + ['user_id' => null, 'consent_at' => 0, 'consent_ver' => '', 'guardian' => 0, 'purged_at' => 0, 'created_at' => $now]);
            // one UPDATE per changed column keeps every statement constant (no SQL is ever assembled from names)
            $cid = (int) $cur['id'];
            if (isset($row['name_enc'])) Db::exec('UPDATE allot_customers SET name_enc = ?, name_hash = ?, purged_at = 0 WHERE id = ?', [$row['name_enc'], $row['name_hash'], $cid]);
            if (isset($row['phone_enc'])) Db::exec('UPDATE allot_customers SET phone_enc = ?, phone_hash = ?, phone_tail = ? WHERE id = ?', [$row['phone_enc'], $row['phone_hash'], $row['phone_tail'], $cid]);
            if (array_key_exists('addr_enc', $row)) Db::exec('UPDATE allot_customers SET addr_enc = ? WHERE id = ?', [$row['addr_enc'], $cid]);
            if (array_key_exists('memo', $row)) Db::exec('UPDATE allot_customers SET memo = ? WHERE id = ?', [$row['memo'], $cid]);
            if (isset($row['guardian'])) Db::exec('UPDATE allot_customers SET guardian = ? WHERE id = ?', [$row['guardian'], $cid]);
            if (isset($row['consent_at'])) Db::exec('UPDATE allot_customers SET consent_at = ?, consent_ver = ? WHERE id = ?', [$row['consent_at'], $row['consent_ver'], $cid]);
            Db::exec('UPDATE allot_customers SET updated_at = ? WHERE id = ?', [$now, $cid]);
            return $cid;
        });
        Audit::log('allot_customer_saved', null, ['customer' => (int) $saved, 'new' => !$cur], 'info', self::idOrNull($actor));
        return self::customer((int) $saved);
    }

    /**
     * Customers, newest first (keyset: pass `next` as $afterId). $filter['q']: a whole phone number or a whole name (blind
     * indexes — a part of a name cannot be searched: the names are sealed), the last 4 digits of a phone, or #id.
     * Rows are masked. @return ['rows' => [...], 'next' => cursor or 0]
     */
    public static function listCustomers(array $filter = [], int $limit = 50, int $afterId = 0): array
    {
        $q = isset($filter['q']) && is_string($filter['q']) ? trim(mb_substr($filter['q'], 0, 60)) : '';
        $id = 0; $ph = ''; $tail = ''; $nh = '';
        if ($q !== '') {
            $digits = (string) preg_replace('/[\s\-.()]+/u', '', $q);
            if (preg_match('/^#(\d{1,15})$/', $q, $m)) $id = (int) $m[1];
            elseif (preg_match('/^\d{4}$/', $digits)) $tail = $digits;
            elseif (self::normPhone($q) !== '') $ph = self::phoneHash(self::normPhone($q));
            else $nh = self::nameHash(Users::cleanText($q, 40));
            if ($id === 0 && $ph === '' && $tail === '' && $nh === '') return ['rows' => [], 'next' => 0];
        }
        $limit = max(1, min(500, $limit));
        $rows = Db::all("SELECT cu.*, (SELECT COUNT(*) FROM allot_contracts c WHERE c.customer_id = cu.id) AS contracts FROM allot_customers cu
            WHERE (? = 0 OR cu.id < ?) AND (? = 0 OR cu.id = ?) AND (? = '' OR cu.phone_hash = ?) AND (? = '' OR cu.phone_tail = ?) AND (? = '' OR cu.name_hash = ?)
            ORDER BY cu.id DESC LIMIT ?", [$afterId, $afterId, $id, $id, $ph, $ph, $tail, $tail, $nh, $nh, $limit + 1]);
        $more = count($rows) > $limit;
        if ($more) array_pop($rows);
        $out = array_map(function ($r) { return self::customerOut($r, false); }, $rows);
        return ['rows' => $out, 'next' => $more && $out ? $out[count($out) - 1]['id'] : 0];
    }

    /**
     * Tie a customer the operator entered (or imported) to an app account, so its contracts show up in that account's
     * "내 분양". Never done by matching phone numbers automatically — whoever knows a phone number must not be able to
     * claim a contract. 409 ALREADY_LINKED when the account or the customer already has a partner. Audit allot_customer_linked.
     */
    public static function linkCustomer(array $a, int $customerId, int $userId, ?int $now = null): array
    {
        $actor = self::admin($a);
        $now = self::now($now);
        if (!Users::byId($userId)) throw new ApiException(404, 'NOT_FOUND', '계정을 찾을 수 없어요.');
        Db::tx(function () use ($customerId, $userId, $now) {
            $cu = Db::one('SELECT id, user_id FROM allot_customers WHERE id = ?' . Db::forUpdate(), [$customerId]);
            if (!$cu) throw new ApiException(404, 'NOT_FOUND', '고객을 찾을 수 없어요.');
            if ($cu['user_id'] !== null || Db::value('SELECT id FROM allot_customers WHERE user_id = ?', [$userId]) !== null) throw new ApiException(409, 'ALREADY_LINKED', '이미 다른 쪽과 이어져 있어요.');
            Db::exec('UPDATE allot_customers SET user_id = ?, updated_at = ? WHERE id = ? AND user_id IS NULL', [$userId, $now, $customerId]);
            Db::exec('UPDATE allot_contracts SET user_id = ?, updated_at = ? WHERE customer_id = ? AND user_id IS NULL', [$userId, $now, $customerId]);
            Db::exec("UPDATE allot_notices SET user_id = ? WHERE customer_id = ? AND user_id IS NULL AND status = 'queued'", [$userId, $customerId]);
            Db::exec('UPDATE allot_waitlist SET user_id = ?, updated_at = ? WHERE customer_id = ? AND user_id IS NULL', [$userId, $now, $customerId]);
        });
        Audit::log('allot_customer_linked', $userId, ['customer' => $customerId], 'warn', self::idOrNull($actor));
        return self::customer($customerId);
    }

    // ------------------------------------------------------------------ notices (the in-app inbox)
    /**
     * One notice row. $title / $body are final text: callers pass their own fixed sentences and run anything a person
     * typed through cleanPublic() first. A notice for an account that is due now is 'sent' at once; one without an
     * account (the operator calls that customer) or with a later send_at waits as 'queued'. A used $dedupe key → false.
     */
    private static function note(int $now, ?int $contractId, ?int $customerId, ?int $userId, string $kind, string $title, string $body, ?string $dedupe = null, ?int $actor = null, ?int $sendAt = null): bool
    {
        $sendAt = $sendAt === null ? $now : $sendAt;
        $direct = $userId !== null && $sendAt <= $now;
        try {
            Db::insert('allot_notices', [
                'contract_id' => $contractId, 'customer_id' => $customerId, 'user_id' => $userId, 'kind' => substr($kind, 0, 24), 'dedupe_key' => $dedupe === null ? null : substr($dedupe, 0, 80),
                'title' => mb_substr($title, 0, 80), 'body' => mb_substr($body, 0, 400), 'status' => $direct ? 'sent' : 'queued', 'send_at' => $sendAt, 'sent_at' => $direct ? $now : 0, 'seen_at' => 0,
                'created_by' => $actor, 'created_at' => $now,
            ]);
            return true;
        } catch (\PDOException $e) {
            if ((string) $e->getCode() === '23000') return false; // this notice was already made (dedupe key)
            throw $e;
        }
    }

    /** a notice about a contract row (customer and account come from the row) */
    private static function noteContract(array $c, int $now, string $kind, string $title, string $body, ?string $dedupe = null, ?int $actor = null): bool
    {
        return self::note($now, (int) $c['id'], (int) $c['customer_id'], $c['user_id'] === null ? null : (int) $c['user_id'], $kind, $title, $body, $dedupe, $actor);
    }

    private static function noticeOut(array $r): array
    {
        return ['id' => (int) $r['id'], 'kind' => (string) $r['kind'], 'title' => (string) $r['title'], 'body' => (string) $r['body'], 'at' => (int) ((int) $r['sent_at'] > 0 ? $r['sent_at'] : $r['send_at']),
            'seen' => (string) $r['status'] === 'seen', 'contractNo' => isset($r['contract_no']) && $r['contract_no'] !== null ? (string) $r['contract_no'] : ''];
    }

    public static function unread(int $uid): int
    {
        return (int) Db::value("SELECT COUNT(*) FROM allot_notices WHERE user_id = ? AND status = 'sent'", [$uid]);
    }

    /** the caller's notices, newest first (≤ 50): {notices: [{id, kind, title, body, at, seen, contractNo}], unread, last}; $afterId = only newer ones */
    public static function inbox(int $uid, int $afterId = 0, int $limit = 50): array
    {
        $rows = Db::all("SELECT n.id, n.kind, n.title, n.body, n.status, n.send_at, n.sent_at, c.contract_no FROM allot_notices n LEFT JOIN allot_contracts c ON c.id = n.contract_id
            WHERE n.user_id = ? AND n.status IN ('sent', 'seen') AND n.id > ? ORDER BY n.id DESC LIMIT ?", [$uid, max(0, $afterId), max(1, min(50, $limit))]);
        $out = array_map(function ($r) { return self::noticeOut($r); }, $rows);
        return ['notices' => $out, 'unread' => self::unread($uid), 'last' => $out ? $out[0]['id'] : max(0, $afterId)];
    }

    /** mark the caller's own notices seen (ids of other accounts change nothing) → rows changed */
    public static function markSeen(int $uid, array $ids, ?int $now = null): int
    {
        $now = self::now($now);
        $n = 0;
        foreach (array_unique(array_map('intval', array_slice(array_values($ids), 0, 50))) as $id) {
            if ($id < 1) continue;
            $n += Db::exec("UPDATE allot_notices SET status = 'seen', seen_at = ? WHERE id = ? AND user_id = ? AND status = 'sent'", [$now, $id, $uid]);
        }
        return $n;
    }

    // ------------------------------------------------------------------ contracts
    /** a new contract number: "A" + two-digit year + two groups of five from an alphabet without 0 1 I L O U (30^10 values) */
    public static function newContractNo(?int $now = null): string
    {
        $alphabet = '23456789ABCDEFGHJKMNPQRSTVWXYZ';
        $s = 'A' . date('y', intdiv(self::now($now), 1000));
        for ($g = 0; $g < 2; $g++) {
            $s .= '-';
            for ($i = 0; $i < 5; $i++) $s .= $alphabet[random_int(0, 29)];
        }
        return $s;
    }

    /** a well-formed contract number in upper case, or '' */
    private static function contractNo($v): string
    {
        if (!is_string($v)) return '';
        $s = strtoupper(trim($v));
        return preg_match('/^A\d\d-[2-9A-Z]{5}-[2-9A-Z]{5}$/', $s) ? $s : '';
    }

    /**
     * How far a contract is paid when its term starts: a free one to the end of the term (or forever); otherwise $periods
     * paid periods from the start (once = the whole term, year = 12 months, month = 1 month); nothing paid = the start
     * itself, i.e. due at once.
     */
    private static function paidUntilFor(string $period, int $price, int $term, int $starts, int $ends, int $periods): int
    {
        if ($price <= 0) return $ends > 0 ? $ends : self::FOREVER;
        if ($periods <= 0) return $starts;
        if ($period === 'once') return $ends > 0 ? $ends : self::addMonths($starts, max(1, $term));
        return self::addMonths($starts, $period === 'year' ? 12 * $periods : $periods);
    }

    /** the periods the recorded payments of a contract cover */
    private static function paidPeriods(int $contractId): int
    {
        return (int) Db::value("SELECT COALESCE(SUM(periods), 0) FROM allot_payments WHERE contract_id = ? AND kind <> 'refund' AND status = 'paid'", [$contractId]);
    }

    /** insert a contract row under a new number (a number collision is tried again; a second live contract on the unit is 409 UNIT_TAKEN) → [id, number] */
    private static function insertContract(array $row): array
    {
        for ($i = 0; $i < 4; $i++) {
            $row['contract_no'] = self::newContractNo((int) $row['created_at']);
            try {
                return [Db::insert('allot_contracts', $row), $row['contract_no']];
            } catch (\PDOException $e) {
                if ((string) $e->getCode() !== '23000') throw $e;
                if ($row['live_unit_id'] !== null && Db::value('SELECT id FROM allot_contracts WHERE live_unit_id = ?', [$row['live_unit_id']]) !== null) {
                    Log::error('ALLOT', 'a live contract exists on a unit that looked free (the unique key refused the second one)', ['unit' => (int) $row['unit_id']]);
                    throw new ApiException(409, 'UNIT_TAKEN', '방금 다른 분이 먼저 신청한 자리예요. 다른 자리를 골라 주세요.');
                }
            }
        }
        throw new \RuntimeException('could not make a contract number');
    }

    /** live contracts + live waiting-list rows of an account against apply_per_user (429 APPLY_LIMIT) */
    private static function checkLimit(int $uid): void
    {
        $max = (int) self::conf('apply_per_user');
        $used = (int) Db::value("SELECT COUNT(*) FROM allot_contracts WHERE user_id = ? AND status IN ('pending', 'active', 'overdue')", [$uid])
            + (int) Db::value("SELECT COUNT(*) FROM allot_waitlist WHERE user_id = ? AND status IN ('waiting', 'offered')", [$uid]);
        if ($used >= $max) throw new ApiException(429, 'APPLY_LIMIT', "한 계정은 {$max}자리까지 신청할 수 있어요.", ['max' => $max, 'used' => $used]);
    }

    /** the plan a new contract copies from its zone */
    private static function zonePlan(int $zoneId): array
    {
        $z = Db::one('SELECT id, code, name, kind, is_open, price, period, term_months FROM allot_zones WHERE id = ?', [$zoneId]);
        if (!$z) throw new ApiException(404, 'NOT_FOUND', '구역을 찾을 수 없어요.');
        return $z;
    }

    /** what apply() was asked for: ['code' => unit code] or ['kind' => …, 'zone' => zone code or ''] (400 INVALID_INPUT) */
    private static function applyTarget($target): array
    {
        if (is_string($target)) {
            $code = self::unitCode($target);
            if ($code === '') V::fail('unit', '자리 번호가 올바르지 않아요.');
            return ['code' => $code];
        }
        if (!is_array($target)) V::fail('unit', '자리를 골라 주세요.');
        if (!isset($target['kind']) || !is_string($target['kind']) || !in_array($target['kind'], self::KINDS, true)) V::fail('kind', '값은 jar · plot · store 가운데 하나여야 해요.');
        if (!isset($target['auto']) || $target['auto'] !== true) V::fail('auto', '자리를 고르거나 auto 를 true 로 보내 주세요.');
        $zone = '';
        if (isset($target['zone']) && $target['zone'] !== null && $target['zone'] !== '') {
            $zone = is_string($target['zone']) ? strtoupper(trim($target['zone'])) : '';
            if (!preg_match('/^[A-Z0-9]{1,12}$/', $zone)) V::fail('zone', '구역 번호가 올바르지 않아요.');
        }
        return ['kind' => $target['kind'], 'zone' => $zone];
    }

    /** lock the named unit for an application: [unit row, zone plan] (404 NOT_FOUND, 409 NOT_OPEN, 409 UNIT_TAKEN) */
    private static function lockNamedUnit(string $code): array
    {
        $u = Db::one('SELECT id, zone_id, kind, code, status, contract_id FROM allot_units WHERE code = ?' . Db::forUpdate(), [$code]);
        if (!$u) throw new ApiException(404, 'NOT_FOUND', '그런 자리가 없어요.');
        $z = self::zonePlan((int) $u['zone_id']);
        if ((int) $z['is_open'] !== 1 || (string) $u['status'] === 'closed') throw new ApiException(409, 'NOT_OPEN', '지금은 신청을 받지 않는 자리예요.');
        if ((string) $u['status'] !== 'open') throw new ApiException(409, 'UNIT_TAKEN', '방금 다른 분이 먼저 신청한 자리예요. 다른 자리를 골라 주세요.');
        return [$u, $z];
    }

    /**
     * Auto-assign: lock the lowest free seq of the zone (or of the first open zone of the kind that has a free unit).
     * The candidate is read with a locking read, so a unit another transaction took a moment ago is never seen as free.
     * 404 NOT_FOUND (unknown zone), 409 NOT_OPEN (the zone is closed), 409 SOLD_OUT (nothing free).
     */
    private static function lockFreeUnit(string $kind, string $zoneCode): array
    {
        if ($zoneCode !== '') {
            $z = Db::one('SELECT id, code, name, kind, is_open, price, period, term_months FROM allot_zones WHERE code = ?', [$zoneCode]);
            if (!$z) throw new ApiException(404, 'NOT_FOUND', '그런 구역이 없어요.');
            if ((string) $z['kind'] !== $kind) V::fail('zone', '고른 종류의 구역이 아니에요.');
            if ((int) $z['is_open'] !== 1) throw new ApiException(409, 'NOT_OPEN', '지금은 신청을 받지 않는 구역이에요.');
            $zones = [$z];
        } else {
            $zones = Db::all('SELECT id, code, name, kind, is_open, price, period, term_months FROM allot_zones WHERE kind = ? AND is_open = 1 ORDER BY sort ASC, id ASC', [$kind]);
            if (!$zones) throw new ApiException(409, 'NOT_OPEN', '지금은 신청을 받는 구역이 없어요.');
        }
        foreach ($zones as $z) {
            $u = Db::one("SELECT id, zone_id, kind, code, status, contract_id FROM allot_units WHERE zone_id = ? AND status = 'open' ORDER BY seq ASC LIMIT 1" . Db::forUpdate(), [(int) $z['id']]);
            if ($u) return [$u, $z];
        }
        throw new ApiException(409, 'SOLD_OUT', '빈 자리가 없어요. 대기 신청을 할 수 있어요.');
    }

    /** nameplate of an application: ['text' (cleaned, masked, ≤ 12), 'show'] */
    private static function formLabel(array $form): array
    {
        $text = '';
        if (isset($form['nameplate']) && $form['nameplate'] !== null) {
            if (!is_string($form['nameplate'])) V::fail('nameplate', '값은 글자로 보내 주세요.');
            V::str($form['nameplate'], 'nameplate', 40);
            $text = self::cleanPublic($form['nameplate'], self::LABEL_MAX);
        }
        $show = (bool) self::conf('nameplate_default_show');
        if (array_key_exists('nameplateShow', $form) && $form['nameplateShow'] !== null) {
            if (!is_bool($form['nameplateShow'])) V::fail('nameplateShow', '값은 참(true) 또는 거짓(false)으로 보내 주세요.');
            $show = $form['nameplateShow'];
        }
        return ['text' => $text, 'show' => $text !== '' && $show];
    }

    /** what the applicant is told about paying (never an amount: plans() and payPrepare() tell prices) */
    private static function payInfo(int $holdUntil): array
    {
        return ['toss' => self::tossOn(), 'guide' => self::texts()['payGuide'], 'until' => $holdUntil];
    }

    /** is the 토스 one-time payment switched on and usable? */
    public static function tossOn(): bool
    {
        return self::conf('toss_enabled') === true && Toss::available();
    }

    /**
     * An application from the app (api/allot/apply.php). $target: a unit code, or ['kind' => jar|plot|store, 'zone' =>
     * code (optional), 'auto' => true] for "any free unit" (the lowest free seq; a lost race is simply tried again).
     * $form: name, phone, addr (kept only with collect_address), consent === true, consentVersion (= consentVersion()),
     * adult === true, nameplate (optional text), nameplateShow (optional bool), guardian (optional bool).
     * The contract is 'pending' (the unit is held for hold_hours) until an admin approves — or 'active' at once with
     * auto_approve = always. → {contractNo, status, unit, holdUntil, pay: {toss, guide, until}}.
     * 403 ALLOT_DISABLED · 400 CONSENT_REQUIRED · 400 INVALID_INPUT · 404 NOT_FOUND · 409 UNIT_TAKEN · 409 NOT_OPEN ·
     * 409 SOLD_OUT · 429 APPLY_LIMIT.
     */
    public static function apply(array $user, $target, array $form, ?int $now = null): array
    {
        self::guard();
        $uid = (int) (isset($user['id']) ? $user['id'] : 0);
        if ($uid < 1) throw new ApiException(401, 'AUTH_REQUIRED', '로그인이 필요해요. 다시 로그인해 주세요.');
        $now = self::now($now);
        $f = self::applicantForm($form);
        $label = self::formLabel($form);
        $pick = self::applyTarget($target);
        $always = self::conf('auto_approve') === 'always';
        $hold = (int) self::conf('hold_hours');
        $holdUntil = $hold > 0 ? $now + $hold * 3600000 : 0;
        for ($try = 1; ; $try++) {
            try {
                return Db::txRetry(function () use ($uid, $now, $f, $label, $pick, $always, $holdUntil) {
                    Db::one('SELECT id FROM users WHERE id = ?' . Db::forUpdate(), [$uid]); // one account's applications one after another
                    self::checkLimit($uid);
                    list($u, $z) = isset($pick['code']) ? self::lockNamedUnit($pick['code']) : self::lockFreeUnit($pick['kind'], $pick['zone']);
                    $unitId = (int) $u['id'];
                    $cid = self::upsertOwnCustomer($uid, $f, $now);
                    list($conId, $no) = self::insertContract([
                        'unit_id' => $unitId, 'live_unit_id' => $unitId, 'customer_id' => $cid, 'user_id' => $uid, 'status' => 'pending', 'period' => (string) $z['period'], 'price' => (int) $z['price'],
                        'term_months' => (int) $z['term_months'], 'starts_at' => 0, 'ends_at' => 0, 'paid_until' => 0, 'paid_total' => 0, 'auto_renew' => 0, 'source' => 'app', 'memo' => null,
                        'created_by' => $uid, 'decided_by' => null, 'decided_at' => 0, 'cancel_req_at' => 0, 'due_stage' => 999, 'end_stage' => 999, 'ended_at' => 0, 'end_reason' => '',
                        'created_at' => $now, 'updated_at' => $now,
                    ]);
                    if (!self::unitCas($unitId, 'open', 'held', $conId, $holdUntil, $now, 'free')) {
                        if (isset($pick['code'])) throw new ApiException(409, 'UNIT_TAKEN', '방금 다른 분이 먼저 신청한 자리예요. 다른 자리를 골라 주세요.');
                        throw new AllotRetry('the free unit was taken');
                    }
                    Db::exec('UPDATE allot_units SET label = ?, label_show = ? WHERE id = ?', [$label['text'], $label['show'] ? 1 : 0, $unitId]);
                    self::bumpZone((int) $u['zone_id'], $now);
                    $c = (array) Db::one('SELECT * FROM allot_contracts WHERE id = ?', [$conId]);
                    Audit::log('allot_applied', $uid, ['contract' => $no, 'unit' => (string) $u['code'], 'auto' => !isset($pick['code'])]);
                    if ($always) {
                        self::approveLocked($c, null, $now, '');
                        return ['contractNo' => $no, 'status' => 'active', 'unit' => (string) $u['code'], 'holdUntil' => 0, 'pay' => self::payInfo(0)];
                    }
                    $tail = $holdUntil > 0 ? ' ' . self::fmtDate($holdUntil) . '까지 확정되지 않으면 신청이 자동으로 취소돼요.' : '';
                    self::noteContract($c, $now, 'applied', '분양 신청을 받았어요', $u['code'] . ' 자리 신청을 받았어요. 운영자가 확인하면 알려 드릴게요.' . $tail, 'applied:' . $conId);
                    return ['contractNo' => $no, 'status' => 'pending', 'unit' => (string) $u['code'], 'holdUntil' => $holdUntil, 'pay' => self::payInfo($holdUntil)];
                });
            } catch (AllotRetry $e) {
                if ($try >= 8) throw new ApiException(409, 'SOLD_OUT', '지금 신청이 몰리고 있어요. 잠시 뒤 다시 해 주세요.');
                usleep(random_int(2000, 12000));
            }
        }
    }

    /** pending → active inside the caller's transaction (the contract row is the caller's; the unit moves held → leased) */
    private static function approveLocked(array $c, ?int $actor, int $now, string $memo): void
    {
        $cid = (int) $c['id'];
        $starts = (int) $c['starts_at'] > 0 ? (int) $c['starts_at'] : $now;
        $term = (int) $c['term_months'];
        $ends = (int) $c['ends_at'] > 0 ? (int) $c['ends_at'] : ($term > 0 ? self::addMonths($starts, $term) : 0);
        $paid = self::paidUntilFor((string) $c['period'], (int) $c['price'], $term, $starts, $ends, self::paidPeriods($cid));
        $u = Db::one('SELECT id, zone_id, code FROM allot_units WHERE id = ?' . Db::forUpdate(), [(int) $c['unit_id']]);
        if (!$u || !self::unitCas((int) $c['unit_id'], 'held', 'leased', $cid, 0, $now, 'contract', $cid)) {
            throw new ApiException(409, 'CONFLICT', '이 자리의 상태가 계약과 맞지 않아요. 분양 관리 → 자동화에서 점검을 돌려 주세요.');
        }
        if (Db::exec("UPDATE allot_contracts SET status = 'active', starts_at = ?, ends_at = ?, paid_until = ?, due_stage = 999, end_stage = 999, decided_by = ?, decided_at = ?, updated_at = ? WHERE id = ? AND status = 'pending'",
            [$starts, $ends, $paid, $actor, $now, $now, $cid]) !== 1) {
            throw new ApiException(409, 'NOT_PENDING', '이미 처리한 신청이에요.');
        }
        self::bumpZone((int) $u['zone_id'], $now);
        self::noteContract($c, $now, 'approved', '분양이 확정되었어요', $u['code'] . ' 자리 분양이 확정되었어요. ‘내 분양’에서 볼 수 있어요.' . ($memo !== '' ? ' ' . $memo : ''), 'approved:' . $cid, $actor);
        Audit::log('allot_decided', $c['user_id'] === null ? null : (int) $c['user_id'], ['contract' => (string) $c['contract_no'], 'unit' => (string) $u['code'], 'status' => 'active'], 'info', $actor);
    }

    /**
     * A live contract stops inside the caller's transaction: 'canceled' (it was pending) or 'ended' (it was active /
     * overdue). The unit is free again (nameplate removed), live_unit_id is cleared. → the unit id (for offerNext).
     */
    private static function closeLocked(array $c, string $to, string $reason, ?int $actor, int $now, string $noticeKind, string $title, string $body): int
    {
        $cid = (int) $c['id'];
        $was = (string) $c['status'];
        $u = Db::one('SELECT id, zone_id, code, status FROM allot_units WHERE id = ?' . Db::forUpdate(), [(int) $c['unit_id']]);
        if (Db::exec('UPDATE allot_contracts SET status = ?, live_unit_id = NULL, ended_at = ?, end_reason = ?, updated_at = ? WHERE id = ? AND status = ?', [$to, $now, mb_substr($reason, 0, 40), $now, $cid, $was]) !== 1) {
            throw new ApiException(409, 'NOT_LIVE', '이미 끝난 계약이에요.');
        }
        if ($u) {
            if (self::unitCas((int) $u['id'], $was === 'pending' ? 'held' : 'leased', 'open', null, 0, $now, 'contract', $cid)) {
                Db::exec("UPDATE allot_units SET label = '', label_show = 0 WHERE id = ?", [(int) $u['id']]);
                self::bumpZone((int) $u['zone_id'], $now);
            } else {
                Log::error('ALLOT', 'a contract ended but its unit was not in the expected state (the integrity scan will look at it)', ['contract' => $cid, 'unit' => (int) $u['id']]);
            }
        }
        if ($title !== '') self::noteContract($c, $now, $noticeKind, $title, str_replace('{unit}', $u ? (string) $u['code'] : '', $body), $noticeKind . ':' . $cid, $actor);
        Audit::log($to === 'canceled' ? 'allot_canceled' : 'allot_ended', $c['user_id'] === null ? null : (int) $c['user_id'],
            ['contract' => (string) $c['contract_no'], 'unit' => $u ? (string) $u['code'] : '', 'was' => $was, 'reason' => self::reasonCode($reason)], 'info', $actor);
        return $u ? (int) $u['id'] : 0;
    }

    /** the fixed reason codes; an operator's own wording is reported as 'admin' (it may say anything) */
    private static function reasonCode(string $reason): string
    {
        return in_array($reason, ['rejected', 'user', 'hold_expired', 'overdue_auto', 'offer_declined', 'moved'], true) ? $reason : 'admin';
    }

    /** lock one contract row (404 NOT_FOUND) */
    private static function lockContract(int $id): array
    {
        $c = Db::one('SELECT * FROM allot_contracts WHERE id = ?' . Db::forUpdate(), [$id]);
        if (!$c) throw new ApiException(404, 'NOT_FOUND', '계약을 찾을 수 없어요.');
        return $c;
    }

    /** run offerNext() after a unit became free; automation must never fail the action that freed it */
    private static function offerQuietly(int $unitId, int $now): void
    {
        if ($unitId < 1) return;
        try { self::offerNext($unitId, $now); } catch (\Throwable $e) { Log::error('ALLOT', 'waiting-list offer failed: ' . get_class($e), ['unit' => $unitId]); }
    }

    /**
     * The operator decides a pending application: 'active' (approve — the term starts now) or 'canceled' (reject — the unit
     * is free again). $memo is a short message FOR THE CUSTOMER (≤ 300 characters; cleaned, personal information and bad
     * words masked) that is added to the notice. 400 INVALID_INPUT · 404 NOT_FOUND · 409 NOT_PENDING. @return array the contract
     */
    public static function decide(array $a, int $contractId, string $status, string $memo = '', ?int $now = null): array
    {
        $actor = self::admin($a);
        if (!in_array($status, ['active', 'canceled'], true)) V::fail('status', '값은 active(승인) 또는 canceled(반려)여야 해요.');
        V::str($memo, 'memo', 300);
        $memo = self::cleanPublic($memo, 300);
        $now = self::now($now);
        $freed = Db::txRetry(function () use ($contractId, $status, $memo, $actor, $now) {
            $c = self::lockContract($contractId);
            if ((string) $c['status'] !== 'pending') throw new ApiException(409, 'NOT_PENDING', '이미 처리한 신청이에요.');
            if ($status === 'active') { self::approveLocked($c, self::idOrNull($actor), $now, $memo); return 0; }
            return self::closeLocked($c, 'canceled', 'rejected', self::idOrNull($actor), $now, 'rejected', '신청을 진행하지 못했어요', '{unit} 자리 신청을 진행하지 못했어요.' . ($memo !== '' ? ' ' . $memo : ''));
        });
        if ($status === 'canceled') self::refundTossQuietly($contractId, $now); // [verify-allot] a rejected application gets its 토스 money back
        self::offerQuietly((int) $freed, $now);
        return (array) self::contract($contractId);
    }

    /**
     * The operator makes a contract for a customer (walk-in, phone, the old ledger). $unit: id or code (free, or held by
     * the operator); $customer: customer id. $opt: status 'active' (default) | 'pending', startsAt, endsAt, paidUntil,
     * price, period, termMonths (default: the zone's plan), autoRenew, memo (the operator's note), source 'admin' |
     * 'import', notify (default true). 404 NOT_FOUND · 409 UNIT_TAKEN · 409 NOT_OPEN (a closed unit) · 400 INVALID_INPUT.
     */
    public static function createContract(array $a, $unit, $customer, array $opt = [], ?int $now = null): array
    {
        $actor = self::admin($a);
        V::keys($opt, ['status', 'startsAt', 'endsAt', 'paidUntil', 'price', 'period', 'termMonths', 'autoRenew', 'memo', 'source', 'notify'], 'contract');
        $now = self::now($now);
        $status = isset($opt['status']) ? (string) $opt['status'] : 'active';
        if (!in_array($status, ['active', 'pending'], true)) V::fail('status', '값은 active 또는 pending 이어야 해요.');
        $source = isset($opt['source']) ? (string) $opt['source'] : 'admin';
        if (!in_array($source, ['admin', 'import'], true)) V::fail('source', '값은 admin 또는 import 여야 해요.');
        $period = self::inStr($opt, 'period', 10);
        if ($period !== null && !in_array($period, ['once', 'month', 'year'], true)) V::fail('period', '값은 once · month · year 가운데 하나여야 해요.');
        $price = self::inInt($opt, 'price', 0, self::MAX_AMOUNT);
        $term = self::inInt($opt, 'termMonths', 0, 120);
        $startsAt = self::inInt($opt, 'startsAt', 1, self::FOREVER);
        $endsAt = self::inInt($opt, 'endsAt', 0, self::FOREVER);
        $paidUntil = self::inInt($opt, 'paidUntil', 0, self::FOREVER);
        $auto = self::inBool($opt, 'autoRenew', false);
        $memo = self::inStr($opt, 'memo', 500);
        $notify = self::inBool($opt, 'notify', true);
        $customerId = (int) $customer;
        $id = Db::txRetry(function () use ($unit, $customerId, $status, $source, $period, $price, $term, $startsAt, $endsAt, $paidUntil, $auto, $memo, $notify, $actor, $now) {
            $cu = Db::one('SELECT id, user_id, purged_at FROM allot_customers WHERE id = ?', [$customerId]);
            if (!$cu || (int) $cu['purged_at'] > 0) throw new ApiException(404, 'NOT_FOUND', '고객을 찾을 수 없어요.');
            $u = is_int($unit) ? Db::one('SELECT id, zone_id, kind, code, status, contract_id FROM allot_units WHERE id = ?' . Db::forUpdate(), [$unit])
                : Db::one('SELECT id, zone_id, kind, code, status, contract_id FROM allot_units WHERE code = ?' . Db::forUpdate(), [self::unitCode($unit)]);
            if (!$u) throw new ApiException(404, 'NOT_FOUND', '그런 자리가 없어요.');
            $from = (string) $u['status'];
            if ($from === 'closed') throw new ApiException(409, 'NOT_OPEN', '닫아 둔 자리예요. 먼저 자리를 열어 주세요.');
            $offered = $from === 'held' && (int) Db::value("SELECT COUNT(*) FROM allot_waitlist WHERE unit_id = ? AND status = 'offered'", [(int) $u['id']]) > 0;
            if (($from !== 'open' && $from !== 'held') || $u['contract_id'] !== null || $offered) throw new ApiException(409, 'UNIT_TAKEN', '이미 쓰고 있는 자리예요.');
            $z = self::zonePlan((int) $u['zone_id']);
            $p = $period === null ? (string) $z['period'] : $period;
            $pr = $price === null ? (int) $z['price'] : $price;
            $t = $term === null ? (int) $z['term_months'] : $term;
            if ($p === 'once' && $t < 1) V::fail('termMonths', '한 번 내는(once) 계약은 기간이 1개월 이상이어야 해요.');
            $active = $status === 'active';
            $starts = $startsAt === null ? ($active ? $now : 0) : $startsAt;
            $ends = $endsAt === null ? ($starts > 0 && $t > 0 ? self::addMonths($starts, $t) : 0) : $endsAt;
            if ($ends > 0 && $ends <= $starts) V::fail('endsAt', '끝나는 날은 시작하는 날보다 뒤여야 해요.');
            $paid = $paidUntil === null ? ($active ? self::paidUntilFor($p, $pr, $t, $starts, $ends, 0) : 0) : $paidUntil;
            $unitId = (int) $u['id'];
            $uid = $cu['user_id'] === null ? null : (int) $cu['user_id'];
            list($conId, $no) = self::insertContract([
                'unit_id' => $unitId, 'live_unit_id' => $unitId, 'customer_id' => $customerId, 'user_id' => $uid, 'status' => $status, 'period' => $p, 'price' => $pr, 'term_months' => $t,
                'starts_at' => $starts, 'ends_at' => $ends, 'paid_until' => $paid, 'paid_total' => 0, 'auto_renew' => $auto ? 1 : 0, 'source' => $source,
                'memo' => $memo === null || $memo === '' ? null : self::cleanPrivate($memo, 500), 'created_by' => self::idOrNull($actor), 'decided_by' => $active ? self::idOrNull($actor) : null,
                'decided_at' => $active ? $now : 0, 'cancel_req_at' => 0, 'due_stage' => 999, 'end_stage' => 999, 'ended_at' => 0, 'end_reason' => '', 'created_at' => $now, 'updated_at' => $now,
            ]);
            $hold = (int) self::conf('hold_hours');
            $holdUntil = !$active && $hold > 0 ? $now + $hold * 3600000 : 0;
            // an operator hold that becomes the hold of a pending contract keeps its status: attach the contract instead
            $moved = !$active && $from === 'held' ? self::heldAttach($unitId, $conId, $holdUntil, $now) : self::unitCas($unitId, $from, $active ? 'leased' : 'held', $conId, $holdUntil, $now, 'free');
            if (!$moved) throw new ApiException(409, 'UNIT_TAKEN', '방금 다른 곳에서 이 자리를 바꿨어요. 다시 확인해 주세요.');
            self::bumpZone((int) $u['zone_id'], $now);
            if ($notify && $source !== 'import') {
                $c = (array) Db::one('SELECT * FROM allot_contracts WHERE id = ?', [$conId]);
                if ($active) self::noteContract($c, $now, 'approved', '분양이 확정되었어요', $u['code'] . ' 자리 분양이 확정되었어요. ‘내 분양’에서 볼 수 있어요.', 'approved:' . $conId, self::idOrNull($actor));
                else self::noteContract($c, $now, 'applied', '분양 신청을 받았어요', $u['code'] . ' 자리 신청을 받았어요. 운영자가 확인하면 알려 드릴게요.', 'applied:' . $conId, self::idOrNull($actor));
            }
            Audit::log('allot_contract_created', $uid, ['contract' => $no, 'unit' => (string) $u['code'], 'status' => $status, 'source' => $source], 'info', self::idOrNull($actor));
            return $conId;
        });
        return (array) self::contract((int) $id);
    }

    /**
     * One more term (× $terms) for an active / overdue contract with a fixed term: ends_at moves on from where it was,
     * so no gap opens. A free contract is paid for the new term at once. 409 NOT_LIVE · 409 NOT_RENEWABLE (open-ended).
     */
    public static function renew(array $a, int $contractId, int $terms = 1, ?int $now = null): array
    {
        $actor = self::admin($a);
        if ($terms < 1 || $terms > 20) V::fail('terms', '값은 1~20 사이의 정수여야 해요.');
        $now = self::now($now);
        Db::txRetry(function () use ($contractId, $terms, $actor, $now) {
            $c = self::lockContract($contractId);
            self::renewLocked($c, $terms, self::idOrNull($actor), $now, 'manual');
        });
        return (array) self::contract($contractId);
    }

    /** the extension itself (also used by tick for auto_renew contracts); the compare-and-set is on the old ends_at */
    private static function renewLocked(array $c, int $terms, ?int $actor, int $now, string $how): void
    {
        if (!in_array((string) $c['status'], ['active', 'overdue'], true)) throw new ApiException(409, 'NOT_LIVE', '진행 중인 계약만 연장할 수 있어요.');
        $term = (int) $c['term_months'];
        $old = (int) $c['ends_at'];
        if ($term < 1 || $old < 1) throw new ApiException(409, 'NOT_RENEWABLE', '기간이 정해지지 않은 계약이라 연장할 것이 없어요.');
        $new = self::addMonthsFrom($old, $term * $terms, (int) $c['starts_at']);
        $paid = (int) $c['price'] <= 0 ? $new : (int) $c['paid_until'];
        if (Db::exec('UPDATE allot_contracts SET ends_at = ?, paid_until = ?, end_stage = 999, updated_at = ? WHERE id = ? AND ends_at = ?', [$new, $paid, $now, (int) $c['id'], $old]) !== 1) {
            throw new ApiException(409, 'CONFLICT', '방금 다른 곳에서 이 계약을 바꿨어요. 다시 확인해 주세요.');
        }
        $code = (string) Db::value('SELECT code FROM allot_units WHERE id = ?', [(int) $c['unit_id']]);
        self::noteContract($c, $now, 'renewed', '분양 기간이 늘어났어요', $code . ' 자리 분양 기간이 ' . self::fmtDate($new) . ' 까지로 늘어났어요.', 'renewed:' . $c['id'] . ':' . $new, $actor);
        Audit::log('allot_renewed', $c['user_id'] === null ? null : (int) $c['user_id'], ['contract' => (string) $c['contract_no'], 'endsAt' => $new, 'how' => $how], 'info', $actor);
    }

    /**
     * Move a live contract to another free unit (the jar was moved, a plot was swapped). The nameplate goes along, the old
     * unit is free (and offered to the waiting list). The contract keeps its own price and dates.
     * 404 NOT_FOUND · 409 NOT_LIVE · 409 UNIT_TAKEN · 409 NOT_OPEN (the target is closed).
     */
    public static function transfer(array $a, int $contractId, $toUnit, ?int $now = null): array
    {
        $actor = self::admin($a);
        $now = self::now($now);
        $to = is_int($toUnit) ? Db::one('SELECT id, code FROM allot_units WHERE id = ?', [$toUnit]) : Db::one('SELECT id, code FROM allot_units WHERE code = ?', [self::unitCode($toUnit)]);
        if (!$to) throw new ApiException(404, 'NOT_FOUND', '옮겨 갈 자리를 찾을 수 없어요.');
        $toId = (int) $to['id'];
        $old = Db::txRetry(function () use ($contractId, $toId, $actor, $now) {
            $c = self::lockContract($contractId);
            if (!in_array((string) $c['status'], self::LIVE, true)) throw new ApiException(409, 'NOT_LIVE', '진행 중인 계약만 옮길 수 있어요.');
            $fromId = (int) $c['unit_id'];
            if ($fromId === $toId) throw new ApiException(409, 'UNIT_TAKEN', '지금 쓰고 있는 자리예요.');
            $rows = [];
            foreach ([min($fromId, $toId), max($fromId, $toId)] as $uid) { // ascending id: the same order everywhere
                $rows[$uid] = Db::one('SELECT id, zone_id, code, status, contract_id, hold_until, label, label_show FROM allot_units WHERE id = ?' . Db::forUpdate(), [$uid]);
            }
            $from = $rows[$fromId];
            $dst = $rows[$toId];
            if (!$from || !$dst) throw new ApiException(404, 'NOT_FOUND', '자리를 찾을 수 없어요.');
            if ((string) $dst['status'] === 'closed') throw new ApiException(409, 'NOT_OPEN', '닫아 둔 자리로는 옮길 수 없어요.');
            if ((string) $dst['status'] !== 'open' || $dst['contract_id'] !== null) throw new ApiException(409, 'UNIT_TAKEN', '이미 쓰고 있는 자리예요.');
            $state = (string) $c['status'] === 'pending' ? 'held' : 'leased';
            $cid = (int) $c['id'];
            // free the old unit first: live_unit_id is unique, the contract row then points at the new one
            if (!self::unitCas($fromId, $state, 'open', null, 0, $now, 'contract', $cid)) throw new ApiException(409, 'CONFLICT', '이 자리의 상태가 계약과 맞지 않아요. 분양 관리 → 자동화에서 점검을 돌려 주세요.');
            if (!self::unitCas($toId, 'open', $state, $cid, $state === 'held' ? (int) $from['hold_until'] : 0, $now, 'free')) throw new ApiException(409, 'UNIT_TAKEN', '방금 다른 분이 먼저 잡은 자리예요.');
            Db::exec('UPDATE allot_units SET label = ?, label_show = ? WHERE id = ?', [(string) $from['label'], (int) $from['label_show'], $toId]);
            Db::exec("UPDATE allot_units SET label = '', label_show = 0 WHERE id = ?", [$fromId]);
            Db::exec('UPDATE allot_contracts SET unit_id = ?, live_unit_id = ?, updated_at = ? WHERE id = ? AND unit_id = ?', [$toId, $toId, $now, $cid, $fromId]);
            foreach (array_unique([(int) $from['zone_id'], (int) $dst['zone_id']]) as $zid) self::bumpZone($zid, $now);
            self::noteContract($c, $now, 'moved', '자리가 바뀌었어요', $from['code'] . ' → ' . $dst['code'] . ' 자리로 옮겼어요.', 'moved:' . $cid . ':' . $toId, self::idOrNull($actor));
            Audit::log('allot_transferred', $c['user_id'] === null ? null : (int) $c['user_id'], ['contract' => (string) $c['contract_no'], 'from' => (string) $from['code'], 'to' => (string) $dst['code']], 'info', self::idOrNull($actor));
            return $fromId;
        });
        self::offerQuietly((int) $old, $now);
        return (array) self::contract($contractId);
    }

    /**
     * The operator ends a contract: a pending one is canceled, an active / overdue one is ended; the unit is free again
     * and offered to the waiting list. $why is the operator's own note (≤ 40 characters, kept in end_reason, never shown
     * to the customer). Money already paid is NOT given back by this call: see refund(). 409 NOT_LIVE.
     */
    public static function endContract(array $a, int $contractId, string $why = '', ?int $now = null): array
    {
        $actor = self::admin($a);
        V::str($why, 'why', 40);
        $why = self::cleanPrivate($why, 40);
        $now = self::now($now);
        $res = Db::txRetry(function () use ($contractId, $why, $actor, $now) {
            $c = self::lockContract($contractId);
            $st = (string) $c['status'];
            if (!in_array($st, self::LIVE, true)) throw new ApiException(409, 'NOT_LIVE', '이미 끝난 계약이에요.');
            if ($st === 'pending') return [self::closeLocked($c, 'canceled', $why === '' ? 'admin' : $why, self::idOrNull($actor), $now, 'rejected', '신청을 진행하지 못했어요', '{unit} 자리 신청을 진행하지 못했어요.'), true];
            return [self::closeLocked($c, 'ended', $why === '' ? 'admin' : $why, self::idOrNull($actor), $now, 'ended', '분양이 끝났어요', '{unit} 자리 분양이 끝났어요. 그동안 고마웠어요.'), false];
        });
        if ($res[1]) self::refundTossQuietly($contractId, $now); // [verify-allot] a pending application never started: its 토스 money goes back
        self::offerQuietly((int) $res[0], $now);
        return (array) self::contract($contractId);
    }

    /**
     * api/allot/cancel.php: the owner cancels a PENDING application at once (the unit is free again; a 토스 payment made
     * for it is given back automatically). For an active / overdue contract the wish is recorded (cancel_req_at) and the
     * operator settles it — a jar is never emptied by a click. Another account's number, an unknown one and a malformed
     * one are the same 404 NOT_FOUND. → {contractNo, status, requested}
     */
    public static function cancelByUser(array $user, string $contractNo, ?int $now = null): array
    {
        $uid = (int) (isset($user['id']) ? $user['id'] : 0);
        $now = self::now($now);
        $no = self::contractNo($contractNo);
        $own = $no === '' ? null : Db::one('SELECT id, user_id FROM allot_contracts WHERE contract_no = ?', [$no]);
        if (!$own || (int) $own['user_id'] !== $uid || $uid < 1) {
            if ($own && class_exists('Tfm\SecEvent')) SecEvent::log('allot_foreign', 'info', ['what' => 'cancel'], $uid > 0 ? $uid : null);
            throw new ApiException(404, 'NOT_FOUND', '계약을 찾을 수 없어요.');
        }
        $conId = (int) $own['id'];
        $res = Db::txRetry(function () use ($conId, $uid, $now) {
            $c = self::lockContract($conId);
            $st = (string) $c['status'];
            if ($st === 'pending') {
                $unit = self::closeLocked($c, 'canceled', 'user', null, $now, 'canceled', '신청을 취소했어요', '{unit} 자리 신청을 취소했어요.');
                return ['status' => 'canceled', 'requested' => false, 'unit' => $unit];
            }
            if ($st !== 'active' && $st !== 'overdue') throw new ApiException(409, 'NOT_LIVE', '이미 끝난 계약이에요.');
            if (Db::exec('UPDATE allot_contracts SET cancel_req_at = ?, auto_renew = 0, updated_at = ? WHERE id = ? AND cancel_req_at = 0', [$now, $now, $conId]) === 1) {
                self::noteContract($c, $now, 'cancel_requested', '해지 요청을 받았어요', '운영자가 확인하고 연락드릴게요.', 'cancelreq:' . $conId);
                Audit::log('allot_cancel_requested', $uid, ['contract' => (string) $c['contract_no']]);
            }
            return ['status' => $st, 'requested' => true, 'unit' => 0];
        });
        if ($res['status'] === 'canceled') {
            self::refundTossQuietly($conId, $now);
            self::offerQuietly((int) $res['unit'], $now);
        }
        return ['contractNo' => $no, 'status' => $res['status'], 'requested' => $res['requested']];
    }

    /** the operator's working note on a contract (≤ 500 characters, never shown to the customer; '' clears it) */
    public static function setMemo(array $a, int $contractId, string $memo): array
    {
        self::admin($a);
        V::str($memo, 'memo', 500);
        $memo = self::cleanPrivate($memo, 500);
        if (Db::value('SELECT id FROM allot_contracts WHERE id = ?', [$contractId]) === null) throw new ApiException(404, 'NOT_FOUND', '계약을 찾을 수 없어요.');
        Db::exec('UPDATE allot_contracts SET memo = ?, updated_at = ? WHERE id = ?', [$memo === '' ? null : $memo, Clock::ms(), $contractId]);
        return (array) self::contract($contractId);
    }

    /** switch "extend by itself at the end of the term" on or off for a live contract */
    public static function setAutoRenew(array $a, int $contractId, bool $on): array
    {
        $actor = self::admin($a);
        $c = Db::one('SELECT id, status, contract_no, user_id FROM allot_contracts WHERE id = ?', [$contractId]);
        if (!$c) throw new ApiException(404, 'NOT_FOUND', '계약을 찾을 수 없어요.');
        if (!in_array((string) $c['status'], self::LIVE, true)) throw new ApiException(409, 'NOT_LIVE', '이미 끝난 계약이에요.');
        Db::exec('UPDATE allot_contracts SET auto_renew = ?, end_stage = 999, updated_at = ? WHERE id = ?', [$on ? 1 : 0, Clock::ms(), $contractId]);
        Audit::log('allot_auto_renew', $c['user_id'] === null ? null : (int) $c['user_id'], ['contract' => (string) $c['contract_no'], 'on' => $on], 'info', self::idOrNull($actor));
        return (array) self::contract($contractId);
    }

    private const CON_SELECT = 'SELECT c.*, u.code AS unit_code, u.kind AS unit_kind, u.seq AS unit_seq, u.hold_until, u.label, u.label_show, z.code AS zone_code, z.name AS zone_name,
            cu.name_enc, cu.phone_tail, cu.purged_at
        FROM allot_contracts c LEFT JOIN allot_units u ON u.id = c.unit_id LEFT JOIN allot_zones z ON z.id = u.zone_id LEFT JOIN allot_customers cu ON cu.id = c.customer_id';

    /** the admin view of a contract row (the customer masked) */
    private static function contractOut(array $r): array
    {
        $live = in_array((string) $r['status'], self::LIVE, true);
        return [
            'id' => (int) $r['id'], 'contractNo' => (string) $r['contract_no'], 'status' => (string) $r['status'], 'unitId' => (int) $r['unit_id'], 'unitCode' => (string) $r['unit_code'],
            'kind' => (string) $r['unit_kind'], 'zoneCode' => (string) $r['zone_code'], 'zoneName' => (string) $r['zone_name'], 'customerId' => (int) $r['customer_id'],
            'userId' => $r['user_id'] === null ? 0 : (int) $r['user_id'], 'customer' => self::maskName(self::unseal($r['name_enc'])), 'phoneTail' => (string) $r['phone_tail'],
            'period' => (string) $r['period'], 'price' => (int) $r['price'], 'termMonths' => (int) $r['term_months'], 'startsAt' => (int) $r['starts_at'], 'endsAt' => (int) $r['ends_at'],
            'paidUntil' => (int) $r['paid_until'], 'paidTotal' => (int) $r['paid_total'], 'autoRenew' => (int) $r['auto_renew'] === 1, 'source' => (string) $r['source'],
            'memo' => $r['memo'] === null ? '' : (string) $r['memo'], 'createdBy' => $r['created_by'] === null ? 0 : (int) $r['created_by'], 'decidedBy' => $r['decided_by'] === null ? 0 : (int) $r['decided_by'],
            'decidedAt' => (int) $r['decided_at'], 'cancelReqAt' => (int) $r['cancel_req_at'], 'endedAt' => (int) $r['ended_at'], 'endReason' => (string) $r['end_reason'],
            'holdUntil' => $live && (string) $r['status'] === 'pending' ? (int) $r['hold_until'] : 0, 'label' => $live ? (string) $r['label'] : '', 'labelShow' => $live && (int) $r['label_show'] === 1,
            'createdAt' => (int) $r['created_at'], 'updatedAt' => (int) $r['updated_at'],
        ];
    }

    /**
     * One contract for the admin site: {id, contractNo, status, unitId, unitCode, kind, zoneCode, zoneName, customerId,
     * userId, customer (masked), phoneTail, period, price, termMonths, startsAt, endsAt, paidUntil, paidTotal, autoRenew,
     * source, memo, createdBy, decidedBy, decidedAt, cancelReqAt, endedAt, endReason, holdUntil, label, labelShow,
     * createdAt, updatedAt} or null.
     */
    public static function contract(int $id): ?array
    {
        $r = Db::one(self::CON_SELECT . ' WHERE c.id = ?', [$id]);
        return $r ? self::contractOut($r) : null;
    }

    /**
     * Contracts, newest first (keyset: pass `next` as $afterId). $filter: status (pending | active | overdue | ended |
     * canceled | 'live'), kind, zone (id or code), customerId, userId, flag ('cancelreq' | 'expiring' — ends within 30
     * days), q (a contract number, a unit code, a whole phone number, the last 4 digits of one, or a whole name).
     * @return ['rows' => [contract …], 'next' => cursor or 0]
     */
    public static function listContracts(array $filter = [], int $limit = 50, int $afterId = 0, ?int $now = null): array
    {
        $now = self::now($now);
        $status = isset($filter['status']) && in_array($filter['status'], ['pending', 'active', 'overdue', 'ended', 'canceled'], true) ? (string) $filter['status'] : '';
        $live = isset($filter['status']) && $filter['status'] === 'live' ? 1 : 0;
        $kind = isset($filter['kind']) && in_array($filter['kind'], self::KINDS, true) ? (string) $filter['kind'] : '';
        $zid = 0;
        if (isset($filter['zone']) && $filter['zone'] !== '' && $filter['zone'] !== 0) {
            $z = self::zoneRow($filter['zone']);
            if (!$z) return ['rows' => [], 'next' => 0];
            $zid = (int) $z['id'];
        }
        $cust = isset($filter['customerId']) ? max(0, (int) $filter['customerId']) : 0;
        $user = isset($filter['userId']) ? max(0, (int) $filter['userId']) : 0;
        $flag = isset($filter['flag']) && is_string($filter['flag']) ? $filter['flag'] : '';
        $no = ''; $code = ''; $ph = ''; $tail = ''; $nh = '';
        $q = isset($filter['q']) && is_string($filter['q']) ? trim(mb_substr($filter['q'], 0, 60)) : '';
        if ($q !== '') {
            $digits = (string) preg_replace('/[\s\-.()]+/u', '', $q);
            if (self::contractNo($q) !== '') $no = self::contractNo($q);
            elseif (self::unitCode($q) !== '') $code = self::unitCode($q);
            elseif (preg_match('/^\d{4}$/', $digits)) $tail = $digits;
            elseif (self::normPhone($q) !== '') $ph = self::phoneHash(self::normPhone($q));
            else $nh = self::nameHash(Users::cleanText($q, 40));
            if ($no === '' && $code === '' && $ph === '' && $tail === '' && $nh === '') return ['rows' => [], 'next' => 0];
        }
        $limit = max(1, min(500, $limit));
        $rows = Db::all(self::CON_SELECT . " WHERE (? = 0 OR c.id < ?) AND (? = '' OR c.status = ?) AND (? = 0 OR c.status IN ('pending', 'active', 'overdue'))
              AND (? = '' OR u.kind = ?) AND (? = 0 OR u.zone_id = ?) AND (? = 0 OR c.customer_id = ?) AND (? = 0 OR c.user_id = ?)
              AND (? = '' OR c.contract_no = ?) AND (? = '' OR u.code = ?) AND (? = '' OR cu.phone_hash = ?) AND (? = '' OR cu.phone_tail = ?) AND (? = '' OR cu.name_hash = ?)
              AND (? <> 'cancelreq' OR (c.cancel_req_at > 0 AND c.status IN ('active', 'overdue')))
              AND (? <> 'expiring' OR (c.status IN ('active', 'overdue') AND c.ends_at > 0 AND c.ends_at < ?))
            ORDER BY c.id DESC LIMIT ?", [$afterId, $afterId, $status, $status, $live, $kind, $kind, $zid, $zid, $cust, $cust, $user, $user, $no, $no, $code, $code, $ph, $ph, $tail, $tail, $nh, $nh,
                $flag, $flag, $now + 30 * self::DAY, $limit + 1]);
        $more = count($rows) > $limit;
        if ($more) array_pop($rows);
        $out = array_map(function ($r) { return self::contractOut($r); }, $rows);
        return ['rows' => $out, 'next' => $more && $out ? $out[count($out) - 1]['id'] : 0];
    }

    /**
     * api/allot/mine.php — the caller's own contracts (the 20 newest; no price anywhere), live waiting-list rows, the
     * unread notice count and the per-account limit: {contracts: [{contractNo, status, unit: {code, kind, zone, zoneName,
     * seq}, period, termMonths, startsAt, endsAt, paidUntil, autoRenew, holdUntil, payDue, cancelRequested, nameplate:
     * {text, show}, createdAt, decidedAt, endedAt, endReason, timeline: [{k, at, done}]}], waitlist: [{id, kind, zone,
     * status, position, unit, offerUntil, createdAt}], unread, limit: {max, used}}
     */
    public static function mine(int $uid, ?int $now = null): array
    {
        $now = self::now($now);
        $contracts = [];
        $used = 0;
        foreach (Db::all(self::CON_SELECT . ' WHERE c.user_id = ? ORDER BY c.id DESC LIMIT 20', [$uid]) as $r) {
            $st = (string) $r['status'];
            $live = in_array($st, self::LIVE, true);
            if ($live) $used++;
            $price = (int) $r['price'];
            $paidUntil = (int) $r['paid_until'];
            $tl = [['k' => 'applied', 'at' => (int) $r['created_at']]];
            if ((int) $r['decided_at'] > 0 && $st !== 'pending' && $st !== 'canceled') $tl[] = ['k' => 'approved', 'at' => (int) $r['decided_at']];
            foreach (array_reverse(Db::all("SELECT paid_at FROM allot_payments WHERE contract_id = ? AND status = 'paid' AND kind <> 'refund' ORDER BY id DESC LIMIT 6", [(int) $r['id']])) as $p) $tl[] = ['k' => 'paid', 'at' => (int) $p['paid_at']];
            if ($live && $st !== 'pending' && $price > 0 && $paidUntil > 0 && $paidUntil < self::FOREVER) $tl[] = ['k' => 'due', 'at' => $paidUntil];
            if ($live && (int) $r['ends_at'] > 0) $tl[] = ['k' => 'ends', 'at' => (int) $r['ends_at']];
            if (!$live) $tl[] = ['k' => $st, 'at' => (int) $r['ended_at']];
            foreach ($tl as $i => $e) $tl[$i]['done'] = $e['at'] > 0 && $e['at'] <= $now;
            $contracts[] = [
                'contractNo' => (string) $r['contract_no'], 'status' => $st,
                'unit' => ['code' => (string) $r['unit_code'], 'kind' => (string) $r['unit_kind'], 'zone' => (string) $r['zone_code'], 'zoneName' => (string) $r['zone_name'], 'seq' => (int) $r['unit_seq']],
                'period' => (string) $r['period'], 'termMonths' => (int) $r['term_months'], 'startsAt' => (int) $r['starts_at'], 'endsAt' => (int) $r['ends_at'],
                'paidUntil' => $paidUntil >= self::FOREVER ? 0 : $paidUntil, 'autoRenew' => (int) $r['auto_renew'] === 1, 'holdUntil' => $st === 'pending' ? (int) $r['hold_until'] : 0,
                'payDue' => $price > 0 && (($st === 'pending' && (int) $r['paid_total'] < $price) || (($st === 'active' || $st === 'overdue') && $paidUntil <= $now)),
                'cancelRequested' => (int) $r['cancel_req_at'] > 0, 'nameplate' => ['text' => $live ? (string) $r['label'] : '', 'show' => $live && (int) $r['label_show'] === 1],
                'createdAt' => (int) $r['created_at'], 'decidedAt' => (int) $r['decided_at'], 'endedAt' => (int) $r['ended_at'],
                'endReason' => $live ? '' : self::reasonCode((string) $r['end_reason']), 'timeline' => $tl,
            ];
        }
        $wait = self::waitOf($uid);
        $max = (int) self::conf('apply_per_user');
        // the limit counts every live contract of the account, also beyond the 20 shown
        $used = (int) Db::value("SELECT COUNT(*) FROM allot_contracts WHERE user_id = ? AND status IN ('pending', 'active', 'overdue')", [$uid]) + count($wait);
        return ['contracts' => $contracts, 'waitlist' => $wait, 'unread' => self::unread($uid), 'limit' => ['max' => $max, 'used' => $used]];
    }

    /**
     * api/allot/plans.php — the one place that tells prices (login; easy mode never calls it): {enabled, consentVersion,
     * collectAddress, nameplateDefaultShow, applyPerUser, holdHours, graceDays, autoApprove, toss, zones: [{code, kind,
     * name, price, period, termMonths, open, free, cap}], texts: {terms, privacy, refund, payGuide}, sample}
     */
    public static function plans(): array
    {
        $free = [];
        foreach (Db::all("SELECT zone_id, COUNT(*) AS n FROM allot_units WHERE status = 'open' GROUP BY zone_id") as $r) $free[(int) $r['zone_id']] = (int) $r['n'];
        $zones = [];
        foreach (Db::all('SELECT ' . self::ZONE_COLS . ' FROM allot_zones ORDER BY sort ASC, id ASC') as $z) {
            $zones[] = ['code' => (string) $z['code'], 'kind' => (string) $z['kind'], 'name' => (string) $z['name'], 'price' => (int) $z['price'], 'period' => (string) $z['period'],
                'termMonths' => (int) $z['term_months'], 'open' => (int) $z['is_open'] === 1, 'free' => isset($free[(int) $z['id']]) ? $free[(int) $z['id']] : 0, 'cap' => (int) $z['capacity']];
        }
        $t = self::texts();
        return [
            'enabled' => self::enabled(), 'consentVersion' => self::consentVersion(), 'collectAddress' => (bool) self::conf('collect_address'),
            'nameplateDefaultShow' => (bool) self::conf('nameplate_default_show'), 'applyPerUser' => (int) self::conf('apply_per_user'), 'holdHours' => (int) self::conf('hold_hours'),
            'graceDays' => (int) self::conf('grace_days'), 'autoApprove' => (string) self::conf('auto_approve'), 'toss' => self::tossOn(), 'zones' => $zones,
            'texts' => ['terms' => $t['terms'], 'privacy' => $t['privacy'], 'refund' => $t['refund'], 'payGuide' => $t['payGuide']], 'sample' => $t['sample'],
        ];
    }

    // ------------------------------------------------------------------ payments
    private const PAY_SELECT = 'SELECT p.*, c.contract_no, c.status AS contract_status, u.code AS unit_code
        FROM allot_payments p JOIN allot_contracts c ON c.id = p.contract_id JOIN allot_units u ON u.id = c.unit_id';

    private static function paymentOut(array $r): array
    {
        return [
            'id' => (int) $r['id'], 'contractId' => (int) $r['contract_id'], 'contractNo' => (string) $r['contract_no'], 'unitCode' => (string) $r['unit_code'], 'kind' => (string) $r['kind'],
            'method' => (string) $r['method'], 'amount' => (int) $r['amount'], 'periods' => (int) $r['periods'], 'status' => (string) $r['status'], 'orderId' => $r['order_id'] === null ? '' : (string) $r['order_id'],
            'paidAt' => (int) $r['paid_at'], 'periodFrom' => (int) $r['period_from'], 'periodTo' => (int) $r['period_to'], 'memo' => (string) $r['memo'],
            'createdBy' => $r['created_by'] === null ? 0 : (int) $r['created_by'], 'createdAt' => (int) $r['created_at'],
        ];
    }

    /**
     * A paid amount moves the contract on (inside the caller's transaction; $c is the locked contract row).
     * $periods null = worked out from the totals (once: the payment that completes the price; month / year: every full
     * price the running total passes — part payments add up); a number = what the operator decided (a discount).
     * A pending contract only collects the money: its paid_until is set when it is approved. An overdue contract that is
     * inside the grace time again becomes active. → [periods, from, to]
     */
    private static function applyPayment(array $c, int $payId, int $amount, ?int $periods, int $now): array
    {
        $cid = (int) $c['id'];
        $price = (int) $c['price'];
        $before = (int) $c['paid_total'];
        $after = $before + $amount;
        $period = (string) $c['period'];
        if ($periods === null) {
            if ($price <= 0) $periods = 0;
            elseif ($period === 'once') $periods = $before < $price && $after >= $price ? 1 : 0;
            else $periods = intdiv($after, $price) - intdiv($before, $price);
        }
        $from = 0;
        $to = 0;
        if ((string) $c['status'] === 'pending') {
            Db::exec('UPDATE allot_contracts SET paid_total = ?, updated_at = ? WHERE id = ?', [$after, $now, $cid]);
        } else {
            $from = (int) $c['paid_until'] > 0 ? (int) $c['paid_until'] : (int) $c['starts_at'];
            $to = $from;
            if ($periods > 0 && $from < self::FOREVER) {
                if ($period === 'once') $to = max($from, (int) $c['ends_at'] > 0 ? (int) $c['ends_at'] : self::addMonths((int) $c['starts_at'], max(1, (int) $c['term_months'])));
                else $to = self::addMonthsFrom($from, ($period === 'year' ? 12 : 1) * $periods, (int) $c['starts_at']);
            }
            $status = (string) $c['status'] === 'overdue' && $to + (int) self::conf('grace_days') * self::DAY >= $now ? 'active' : (string) $c['status'];
            Db::exec('UPDATE allot_contracts SET paid_total = ?, paid_until = ?, status = ?, due_stage = ?, updated_at = ? WHERE id = ?', [$after, $to, $status, $to !== $from ? 999 : (int) $c['due_stage'], $now, $cid]);
        }
        Db::exec('UPDATE allot_payments SET periods = ?, period_from = ?, period_to = ? WHERE id = ?', [$periods, $from, $to, $payId]);
        return [$periods, $from, $to];
    }

    /** after a payment on a pending contract: auto_approve = on_payment approves it once a period is covered (or it is free) */
    private static function approveIfPaid(int $contractId, ?int $actor, int $now): bool
    {
        if (self::conf('auto_approve') !== 'on_payment') return false;
        $c = Db::one("SELECT * FROM allot_contracts WHERE id = ? AND status = 'pending'", [$contractId]);
        if (!$c || ((int) $c['price'] > 0 && self::paidPeriods($contractId) < 1)) return false;
        self::approveLocked($c, $actor, $now, '');
        return true;
    }

    /** the "paid" notice (no amount) */
    private static function notePaid(array $c, int $payId, int $to, int $now, ?int $actor): void
    {
        $code = (string) Db::value('SELECT code FROM allot_units WHERE id = ?', [(int) $c['unit_id']]);
        $tail = $to > 0 && $to < self::FOREVER ? ' ' . self::fmtDate($to) . ' 까지 납부가 확인되었어요.' : '';
        self::noteContract($c, $now, 'paid', '납부를 확인했어요', $code . ' 자리 납부를 확인했어요.' . $tail, 'paid:' . $payId, $actor);
    }

    /**
     * The operator records money that arrived outside the app (bank transfer, cash, CMS auto-transfer …).
     * $method: bank | cash | cms | etc. $idem: the idempotency key of this form / file row (8–64 of A–Z a–z 0–9 _ - : .):
     * the same key again changes nothing and returns the first payment with duplicate = true; the same key for another
     * contract is 409 IDEM_CONFLICT. $opt: periods (0–120; default: worked out from the totals), memo (≤ 200), paidAt (ms).
     * With auto_approve = on_payment a covered pending contract is approved in the same transaction.
     * → {payment, contract, duplicate}. 400 INVALID_INPUT · 404 NOT_FOUND · 409 NOT_LIVE.
     */
    public static function recordPayment(array $a, int $contractId, int $amount, string $method, string $idem, array $opt = [], ?int $now = null): array
    {
        $actor = self::admin($a);
        V::keys($opt, ['periods', 'memo', 'paidAt'], 'payment');
        if (!in_array($method, ['bank', 'cash', 'cms', 'etc'], true)) V::fail('method', '값은 bank · cash · cms · etc 가운데 하나여야 해요.');
        if ($amount < 1 || $amount > self::MAX_AMOUNT) V::fail('amount', '금액은 1~' . self::MAX_AMOUNT . ' 사이의 정수여야 해요.');
        if (!preg_match('/^[A-Za-z0-9_\-:.]{8,64}\z/', $idem)) V::fail('idem', '중복 방지 키가 올바르지 않아요.');
        $now = self::now($now);
        $periods = self::inInt($opt, 'periods', 0, 120);
        $memo = self::cleanPrivate((string) self::inStr($opt, 'memo', 200, ''), 200);
        $paidAt = self::inInt($opt, 'paidAt', 1, $now + self::DAY, $now);
        $res = Db::txRetry(function () use ($contractId, $amount, $method, $idem, $periods, $memo, $paidAt, $actor, $now) {
            $c = self::lockContract($contractId);
            $old = Db::one('SELECT id, contract_id FROM allot_payments WHERE idem = ?', [$idem]);
            if ($old) {
                if ((int) $old['contract_id'] !== $contractId) throw new ApiException(409, 'IDEM_CONFLICT', '이 키는 다른 계약의 입금에 이미 쓰였어요. 화면을 새로 고친 뒤 다시 해 주세요.');
                return [(int) $old['id'], true];
            }
            if (!in_array((string) $c['status'], self::LIVE, true)) throw new ApiException(409, 'NOT_LIVE', '이미 끝난 계약에는 입금을 기록할 수 없어요.');
            $first = (int) Db::value("SELECT COUNT(*) FROM allot_payments WHERE contract_id = ? AND kind <> 'refund' AND status IN ('paid', 'refunded')", [$contractId]) === 0;
            $payId = Db::insert('allot_payments', [
                'contract_id' => $contractId, 'customer_id' => (int) $c['customer_id'], 'kind' => $periods === 0 ? 'manual' : ($first ? 'first' : 'renewal'), 'method' => $method, 'amount' => $amount,
                'periods' => 0, 'order_id' => null, 'payment_key_enc' => '', 'claim' => '', 'claimed_at' => 0, 'idem' => $idem, 'status' => 'paid', 'toss_status' => '', 'paid_at' => $paidAt,
                'period_from' => 0, 'period_to' => 0, 'memo' => $memo, 'created_by' => self::idOrNull($actor), 'created_at' => $now, 'updated_at' => $now,
            ]);
            list($n, , $to) = self::applyPayment($c, $payId, $amount, $periods, $now);
            if ($n === 0 && $periods === null) Db::exec("UPDATE allot_payments SET kind = 'manual' WHERE id = ?", [$payId]);
            self::notePaid($c, $payId, $to, $now, self::idOrNull($actor));
            Audit::log('allot_payment', $c['user_id'] === null ? null : (int) $c['user_id'], ['contract' => (string) $c['contract_no'], 'payment' => $payId, 'method' => $method, 'amount' => $amount, 'periods' => $n], 'info', self::idOrNull($actor));
            self::approveIfPaid($contractId, self::idOrNull($actor), $now);
            return [$payId, false];
        });
        return ['payment' => self::paymentOut((array) Db::one(self::PAY_SELECT . ' WHERE p.id = ?', [$res[0]])), 'contract' => (array) self::contract($contractId), 'duplicate' => $res[1]];
    }

    /** payments, newest first (keyset). $filter: contractId, status, method. @return ['rows', 'next'] */
    public static function listPayments(array $filter = [], int $limit = 50, int $afterId = 0): array
    {
        $cid = isset($filter['contractId']) ? max(0, (int) $filter['contractId']) : 0;
        $status = isset($filter['status']) && in_array($filter['status'], ['created', 'paid', 'failed', 'canceled', 'refunded'], true) ? (string) $filter['status'] : '';
        $method = isset($filter['method']) && in_array($filter['method'], ['toss', 'bank', 'cash', 'cms', 'etc'], true) ? (string) $filter['method'] : '';
        $limit = max(1, min(500, $limit));
        $rows = Db::all(self::PAY_SELECT . " WHERE (? = 0 OR p.id < ?) AND (? = 0 OR p.contract_id = ?) AND (? = '' OR p.status = ?) AND (? = '' OR p.method = ?) ORDER BY p.id DESC LIMIT ?",
            [$afterId, $afterId, $cid, $cid, $status, $status, $method, $method, $limit + 1]);
        $more = count($rows) > $limit;
        if ($more) array_pop($rows);
        $out = array_map(function ($r) { return self::paymentOut($r); }, $rows);
        return ['rows' => $out, 'next' => $more && $out ? $out[count($out) - 1]['id'] : 0];
    }

    /** mark a paid payment refunded and write the refund row (inside the caller's transaction) → the refund row id, 0 when it was not 'paid' any more */
    private static function refundLocked(array $p, string $reason, ?int $actor, int $now): int
    {
        // the contract row first, then the payment row: the same lock order as recordPayment() and payConfirm()
        $c = Db::one('SELECT id, status, period, starts_at, paid_until, paid_total, due_stage FROM allot_contracts WHERE id = ?' . Db::forUpdate(), [(int) $p['contract_id']]);
        if (Db::exec("UPDATE allot_payments SET status = 'refunded', updated_at = ? WHERE id = ? AND status = 'paid'", [$now, (int) $p['id']]) !== 1) return 0;
        $rid = Db::insert('allot_payments', [
            'contract_id' => (int) $p['contract_id'], 'customer_id' => (int) $p['customer_id'], 'kind' => 'refund', 'method' => (string) $p['method'], 'amount' => (int) $p['amount'], 'periods' => 0,
            'order_id' => null, 'payment_key_enc' => '', 'claim' => '', 'claimed_at' => 0, 'idem' => null, 'status' => 'paid', 'toss_status' => '', 'paid_at' => $now, 'period_from' => 0, 'period_to' => 0,
            'memo' => self::cleanPrivate($reason, 200), 'created_by' => $actor, 'created_at' => $now, 'updated_at' => $now,
        ]);
        if ($c) {
            // the money leaves the contract: the total goes down and — on a running contract — the period this payment
            // bought is no longer paid (the reminder for it can go out again)
            $paid = (int) $c['paid_until'];
            $back = self::paidUntilWithout($c, $p);
            Db::exec('UPDATE allot_contracts SET paid_total = ?, paid_until = ?, due_stage = ?, updated_at = ? WHERE id = ?',
                [max(0, (int) $c['paid_total'] - (int) $p['amount']), $back, $back !== $paid ? 999 : (int) $c['due_stage'], $now, (int) $c['id']]);
        }
        return $rid;
    }

    /**
     * paid_until of a contract once the payment $p is given back. Only a running contract and only a payment that bought
     * periods move the date: the newest payment (and the one payment of a "once" contract) is undone exactly — back to
     * where its period began; an older one takes the same number of periods off the end. Never later than before, never
     * before the start of the contract.
     */
    private static function paidUntilWithout(array $c, array $p): int
    {
        $paid = (int) $c['paid_until'];
        $from = (int) (isset($p['period_from']) ? $p['period_from'] : 0);
        $to = (int) (isset($p['period_to']) ? $p['period_to'] : 0);
        $n = (int) (isset($p['periods']) ? $p['periods'] : 0);
        if (!in_array((string) $c['status'], ['active', 'overdue'], true) || $n < 1 || $to <= $from || $paid <= 0 || $paid >= self::FOREVER) return $paid;
        $starts = (int) $c['starts_at'];
        if ($paid === $to || (string) $c['period'] === 'once') $back = $from;
        else $back = self::addMonthsFrom($paid, -$n * ((string) $c['period'] === 'year' ? 12 : 1), $starts);
        return max(min($back, $paid), min($paid, $starts));
    }

    /**
     * A 토스 payment that was taken for nothing — the contract ended, or another payment covered what was due, while the
     * payment window was open — goes back: canceled at the gateway, then recorded as 'refunded' with a refund row. It was
     * never credited, so the totals and dates of the contract do not move and no OTHER payment of the contract is touched.
     * When the gateway cannot cancel it the money is not hidden: it is credited (paid_total), marked REFUND_FAILED and
     * reported — as an alert and by the integrity scan (refund_due) — until the operator gives it back with refund().
     * → true when the money went back
     */
    private static function voidTossPayment(int $payId, string $paymentKey, string $why, int $now): bool
    {
        $back = true;
        try {
            Toss::cancel($paymentKey, '분양 결제 자동 취소');
        } catch (\Throwable $e) {
            $back = false;
            Log::error('ALLOT', 'automatic refund failed: ' . get_class($e), ['payment' => $payId, 'why' => $why]);
        }
        try {
            $p = Db::txRetry(function () use ($payId, $back, $why, $now) {
                $p = Db::one('SELECT * FROM allot_payments WHERE id = ?', [$payId]);
                if (!$p || (string) $p['status'] !== 'paid') return null;
                self::lockContract((int) $p['contract_id']);
                if ($back) {
                    if (Db::exec("UPDATE allot_payments SET status = 'refunded', toss_status = 'CANCELED', updated_at = ? WHERE id = ? AND status = 'paid'", [$now, $payId]) !== 1) return null;
                    Db::insert('allot_payments', [
                        'contract_id' => (int) $p['contract_id'], 'customer_id' => (int) $p['customer_id'], 'kind' => 'refund', 'method' => 'toss', 'amount' => (int) $p['amount'], 'periods' => 0,
                        'order_id' => null, 'payment_key_enc' => '', 'claim' => '', 'claimed_at' => 0, 'idem' => null, 'status' => 'paid', 'toss_status' => '', 'paid_at' => $now, 'period_from' => 0, 'period_to' => 0,
                        'memo' => $why === 'CONTRACT_CLOSED' ? '끝난 계약에 들어온 결제 — 자동 환불' : '이미 납부된 뒤에 들어온 결제 — 자동 환불', 'created_by' => null, 'created_at' => $now, 'updated_at' => $now,
                    ]);
                } else {
                    if (Db::exec("UPDATE allot_payments SET toss_status = 'REFUND_FAILED', updated_at = ? WHERE id = ? AND status = 'paid' AND toss_status <> 'REFUND_FAILED'", [$now, $payId]) !== 1) return null;
                    Db::exec('UPDATE allot_contracts SET paid_total = paid_total + ?, updated_at = ? WHERE id = ?', [(int) $p['amount'], $now, (int) $p['contract_id']]);
                }
                return $p;
            });
        } catch (\Throwable $e) {
            Log::error('ALLOT', 'recording an automatic refund failed: ' . get_class($e), ['payment' => $payId]);
            return false;
        }
        if ($p) {
            $detail = ['payment' => $payId, 'contract' => (int) $p['contract_id'], 'method' => 'toss', 'amount' => (int) $p['amount'], 'auto' => true, 'why' => strtolower($why), 'done' => $back];
            Audit::log('allot_refund', null, $detail, $back ? 'warn' : 'alert');
            if (!$back && class_exists('Tfm\SecEvent')) SecEvent::log('allot_refund_failed', 'alert', ['payment' => $payId, 'contract' => (int) $p['contract_id']]);
        }
        return $back && $p !== null;
    }

    /**
     * Give a payment back. A 토스 payment is canceled at the gateway first (502 REFUND_FAILED when that does not work —
     * nothing is recorded then); bank / cash / CMS money is returned by the operator by hand and this call records it.
     * The payment becomes 'refunded', a row of kind 'refund' is added, paid_total goes down. The contract's dates do not
     * move: end or change the contract separately. Audit allot_refund. 404 NOT_FOUND · 409 NOT_REFUNDABLE.
     */
    public static function refund(array $a, int $paymentId, string $reason = '', ?int $now = null): array
    {
        $actor = self::admin($a);
        V::str($reason, 'reason', 200);
        $now = self::now($now);
        $p = Db::one('SELECT * FROM allot_payments WHERE id = ?', [$paymentId]);
        if (!$p) throw new ApiException(404, 'NOT_FOUND', '입금 기록을 찾을 수 없어요.');
        if ((string) $p['status'] !== 'paid' || (string) $p['kind'] === 'refund') throw new ApiException(409, 'NOT_REFUNDABLE', '돌려줄 수 있는 입금이 아니에요.');
        if ((string) $p['method'] === 'toss') {
            $key = self::unseal($p['payment_key_enc']);
            if ($key === '') throw new ApiException(409, 'NOT_REFUNDABLE', '결제 키를 읽을 수 없어 자동으로 취소하지 못해요. 토스 상점관리자에서 취소한 뒤 다시 눌러 주세요.');
            try {
                Toss::cancel($key, '분양 환불');
            } catch (TossException $e) {
                Log::error('ALLOT', 'refund at the gateway failed', ['payment' => $paymentId, 'code' => $e->tossCode]);
                throw new ApiException(502, 'REFUND_FAILED', '결제 취소가 되지 않았어요: ' . $e->getMessage(), ['tossCode' => $e->tossCode]);
            }
        }
        $rid = Db::tx(function () use ($p, $reason, $actor, $now) { return self::refundLocked($p, $reason, self::idOrNull($actor), $now); });
        if ($rid === 0) throw new ApiException(409, 'NOT_REFUNDABLE', '방금 다른 곳에서 이미 처리했어요.');
        Audit::log('allot_refund', null, ['payment' => $paymentId, 'contract' => (int) $p['contract_id'], 'method' => (string) $p['method'], 'amount' => (int) $p['amount']], 'warn', self::idOrNull($actor));
        return self::paymentOut((array) Db::one(self::PAY_SELECT . ' WHERE p.id = ?', [$paymentId]));
    }

    /** a canceled application gives its 토스 payments back by itself (best effort: what fails stays 'paid' and shows up in the integrity report) */
    private static function refundTossQuietly(int $contractId, int $now): void
    {
        try {
            foreach (Db::all("SELECT * FROM allot_payments WHERE contract_id = ? AND method = 'toss' AND status = 'paid' AND kind <> 'refund'", [$contractId]) as $p) {
                $key = self::unseal($p['payment_key_enc']);
                if ($key === '') continue;
                try { Toss::cancel($key, '분양 신청 취소'); } catch (\Throwable $e) { Log::error('ALLOT', 'automatic refund failed: ' . get_class($e), ['payment' => (int) $p['id']]); continue; }
                Db::tx(function () use ($p, $now) { return self::refundLocked($p, '신청 취소 — 자동 환불', null, $now); });
                Audit::log('allot_refund', null, ['payment' => (int) $p['id'], 'contract' => $contractId, 'method' => 'toss', 'amount' => (int) $p['amount'], 'auto' => true], 'warn');
            }
        } catch (\Throwable $e) {
            Log::error('ALLOT', 'automatic refund pass failed: ' . get_class($e), ['contract' => $contractId]);
        }
    }

    // ---- 토스페이먼츠 one-time payment (only with allot.toss_enabled; the same rules as Subscription::confirm, its own table)
    /** the keyed hash of a paymentKey: what claims a confirmation (the key itself is stored sealed) */
    private static function claimOf(string $paymentKey): string { return hash_hmac('sha256', 'allot-pay:' . $paymentKey, Config::secret('app_key')); }

    private static function tamper(int $uid, string $why, array $detail, string $severity = 'alert'): void
    {
        $detail = ['why' => $why] + $detail;
        if (class_exists('Tfm\SecEvent')) SecEvent::log('payment_tamper', $severity, $detail, $uid > 0 ? $uid : null);
        Audit::log('allot_payment_tamper', $uid > 0 ? $uid : null, $detail, $severity === 'info' ? 'info' : 'alert');
    }

    /** the caller's own live contract by number (another account's / unknown / malformed → 404 NOT_FOUND) */
    private static function ownContract(int $uid, string $contractNo, string $what): array
    {
        $no = self::contractNo($contractNo);
        $c = $no === '' ? null : Db::one('SELECT * FROM allot_contracts WHERE contract_no = ?', [$no]);
        if (!$c || $uid < 1 || (int) $c['user_id'] !== $uid) {
            if ($c && class_exists('Tfm\SecEvent')) SecEvent::log('allot_foreign', 'info', ['what' => $what], $uid > 0 ? $uid : null);
            throw new ApiException(404, 'NOT_FOUND', '계약을 찾을 수 없어요.');
        }
        return $c;
    }

    /** is one period of this contract payable now? (pending: not covered yet; running: inside the notice lead time) */
    private static function payable(array $c, int $now): bool
    {
        if ((int) $c['price'] <= 0 || !in_array((string) $c['status'], self::LIVE, true)) return false;
        if ((string) $c['status'] === 'pending') return self::paidPeriods((int) $c['id']) < 1;
        $paid = (int) $c['paid_until'];
        if ((string) $c['period'] === 'once' && (int) $c['ends_at'] > 0 && $paid >= (int) $c['ends_at']) return false;
        $days = (array) self::conf('notice_days');
        $lead = max(1, $days ? (int) max($days) : 0) * self::DAY;
        return $paid <= $now + $lead;
    }

    /**
     * api/allot/pay-prepare.php {contractNo} → {orderId, amount, orderName, contractNo, customerKey, clientKey, successUrl,
     * failUrl, mock}: a 'created' payment row for one period of the caller's own contract, to be paid through the 토스 SDK.
     * The amount is always the contract's own price. 403 PAY_DISABLED (toss_enabled off) · 503 PAYMENT_NOT_CONFIGURED ·
     * 404 NOT_FOUND · 409 NOTHING_DUE.
     */
    public static function payPrepare(array $user, string $contractNo, ?int $now = null): array
    {
        self::guard();
        $uid = (int) (isset($user['id']) ? $user['id'] : 0);
        if (self::conf('toss_enabled') !== true) throw new ApiException(403, 'PAY_DISABLED', '여기에서는 온라인 결제를 받지 않아요. 입금 안내를 확인해 주세요.');
        $c = self::ownContract($uid, $contractNo, 'pay');
        Toss::requireAvailable();
        $now = self::now($now);
        if (!self::payable($c, $now)) throw new ApiException(409, 'NOTHING_DUE', '지금 낼 것이 없어요.');
        $amount = (int) $c['price'];
        $cid = (int) $c['id'];
        // a payment window opened a moment ago and never used is handed out again instead of piling up rows
        $open = Db::one("SELECT order_id FROM allot_payments WHERE contract_id = ? AND method = 'toss' AND status = 'created' AND claim = '' AND amount = ? AND created_at > ? ORDER BY id DESC LIMIT 1", [$cid, $amount, $now - 1800000]);
        if ($open) {
            $orderId = (string) $open['order_id'];
        } else {
            $orderId = 'AL' . substr(Subscription::orderId(), 0, 30);
            $first = (int) Db::value("SELECT COUNT(*) FROM allot_payments WHERE contract_id = ? AND kind <> 'refund' AND status IN ('paid', 'refunded')", [$cid]) === 0;
            Db::insert('allot_payments', [
                'contract_id' => $cid, 'customer_id' => (int) $c['customer_id'], 'kind' => $first ? 'first' : 'renewal', 'method' => 'toss', 'amount' => $amount, 'periods' => 0, 'order_id' => $orderId,
                'payment_key_enc' => '', 'claim' => '', 'claimed_at' => 0, 'idem' => null, 'status' => 'created', 'toss_status' => '', 'paid_at' => 0, 'period_from' => 0, 'period_to' => 0, 'memo' => '',
                'created_by' => $uid, 'created_at' => $now, 'updated_at' => $now,
            ]);
            Audit::log('allot_pay_prepare', $uid, ['contract' => (string) $c['contract_no'], 'order' => $orderId, 'amount' => $amount]);
        }
        $code = (string) Db::value('SELECT code FROM allot_units WHERE id = ?', [(int) $c['unit_id']]);
        $base = Http::baseUrl();
        return ['orderId' => $orderId, 'amount' => $amount, 'orderName' => '전통발효체험관 분양 ' . $code, 'contractNo' => (string) $c['contract_no'], 'customerKey' => Subscription::customerKey($uid),
            'clientKey' => Toss::clientKey(), 'successUrl' => $base . '?allot=pay', 'failUrl' => $base . '?allot=payfail', 'mock' => Toss::mock()];
    }

    /** a payment row with its contract's account by order id (well-formed ids only) */
    private static function payOrder(string $orderId): ?array
    {
        if (!preg_match('/^[A-Za-z0-9_\-]{8,64}\z/', $orderId)) return null;
        $r = Db::one('SELECT p.*, c.user_id, c.contract_no FROM allot_payments p JOIN allot_contracts c ON c.id = p.contract_id WHERE p.order_id = ?', [$orderId]);
        // [verify-allot] MariaDB compares by collation (another letter case finds the row): the id must be byte-exact
        return $r && hash_equals((string) $r['order_id'], $orderId) ? $r : null;
    }

    /** claim a 'created' payment for one confirmation → 'claimed' | 'resume' (the same key, no answer for a while) | 'busy' | 'closed' */
    private static function claimPayment(string $orderId, string $claim, int $now): string
    {
        return Db::tx(function () use ($orderId, $claim, $now) {
            $r = Db::one('SELECT status, claim, claimed_at, toss_status FROM allot_payments WHERE order_id = ?' . Db::forUpdate(), [$orderId]);
            if (!$r || (string) $r['status'] !== 'created') return 'closed';
            if ((string) $r['claim'] === '') {
                return Db::exec("UPDATE allot_payments SET claim = ?, claimed_at = ?, toss_status = 'CONFIRMING', updated_at = ? WHERE order_id = ? AND status = 'created' AND claim = ''", [$claim, $now, $now, $orderId]) === 1 ? 'claimed' : 'busy';
            }
            if (hash_equals((string) $r['claim'], $claim) && (string) $r['toss_status'] === 'CONFIRMING' && $now - (int) $r['claimed_at'] >= (int) Config::get('toss.confirm_retry_after', 30) * 1000) return 'resume';
            return 'busy';
        });
    }

    /** close a claimed payment row: only the confirmation that claimed it moves it, and only out of 'created' */
    private static function finishPayment(string $orderId, string $status, string $claim, string $paymentKey, string $tossStatus, int $now): bool
    {
        $sealed = '';
        if ($status === 'paid') {
            if (!Crypto::fits($paymentKey, 500)) throw new ApiException(500, 'PAYMENT_KEY_TOO_LONG', '결제 정보가 너무 길어 저장하지 못했어요. 운영자에게 알려 주세요.');
            $sealed = Crypto::seal($paymentKey);
        }
        return Db::exec("UPDATE allot_payments SET status = ?, payment_key_enc = ?, toss_status = ?, paid_at = ?, updated_at = ? WHERE order_id = ? AND status = 'created' AND claim = ?",
            [$status, $sealed, mb_substr($tossStatus, 0, 40), $status === 'paid' ? $now : 0, $now, $orderId, $claim]) === 1;
    }

    /** what the gateway answered must be exactly this order: '' or the reason (status | amount_missing | amount | order | currency | payment_key) */
    private static function paymentMismatch(array $p, string $orderId, int $amount, string $paymentKey): string
    {
        if ((string) (isset($p['status']) ? $p['status'] : '') !== 'DONE') return 'status';
        if (!array_key_exists('totalAmount', $p)) return 'amount_missing';
        if (!is_int($p['totalAmount']) || $p['totalAmount'] !== $amount) return 'amount';
        if (!isset($p['orderId']) || !is_string($p['orderId']) || !hash_equals($orderId, $p['orderId'])) return 'order';
        if (!isset($p['currency']) || $p['currency'] !== 'KRW') return 'currency';
        if (isset($p['paymentKey']) && (!is_string($p['paymentKey']) || !hash_equals($paymentKey, $p['paymentKey']))) return 'payment_key';
        return '';
    }

    /**
     * api/allot/pay-confirm.php {paymentKey, orderId, amount}: the order must belong to the caller's contract, be
     * 'created' and carry exactly this amount; it is claimed for this confirmation (a double click / a second tab finds it
     * taken), confirmed at 토스 (mock: paymentKey "mock_…"), the answer must be DONE with the same integer amount, order,
     * currency and key — anything else is recorded as failed, reported as payment_tamper and money that moved is canceled.
     * Then the payment is 'paid' and the contract moves on (approved with auto_approve = on_payment).
     * → {contractNo, status, paidUntil}. 404 ORDER_NOT_FOUND · 400 AMOUNT_MISMATCH · 409 ORDER_NOT_OPEN ·
     * 503 PAYMENT_PENDING (no answer: try again later) · 402 PAYMENT_FAILED · 409 CONTRACT_CLOSED (paid for a contract
     * that ended meanwhile: the payment is canceled automatically).
     */
    public static function payConfirm(array $user, string $paymentKey, string $orderId, int $amount, ?int $now = null): array
    {
        $uid = (int) (isset($user['id']) ? $user['id'] : 0);
        if (!preg_match('/^[A-Za-z0-9_\-]{1,200}$/', $paymentKey)) throw new ApiException(400, 'INVALID_PAYMENT_KEY', '결제 키가 올바르지 않아요.');
        $o = self::payOrder($orderId);
        if (!$o || $uid < 1 || (int) $o['user_id'] !== $uid) {
            self::tamper($uid, 'foreign_order', ['order' => mb_substr($orderId, 0, 64)], 'warn');
            throw new ApiException(404, 'ORDER_NOT_FOUND', '주문을 찾을 수 없어요.');
        }
        if ($amount !== (int) $o['amount']) {
            self::tamper($uid, 'amount', ['order' => $orderId, 'sent' => $amount, 'stored' => (int) $o['amount']]);
            throw new ApiException(400, 'AMOUNT_MISMATCH', '결제 금액이 주문과 달라요.');
        }
        if ((string) $o['status'] !== 'created') {
            self::tamper($uid, 'replay', ['order' => $orderId, 'status' => (string) $o['status']], 'info');
            throw new ApiException(409, 'ORDER_NOT_OPEN', '이미 처리된 주문이에요.');
        }
        $now = self::now($now);
        $cid = (int) $o['contract_id'];
        // [verify-allot] nothing is taken for a contract that ended or has nothing due any more (a stale window, a second
        // window for one application): an order nobody claimed yet is closed here, BEFORE the gateway is asked for money
        if ((string) $o['claim'] === '') {
            $c0 = Db::one('SELECT * FROM allot_contracts WHERE id = ?', [$cid]);
            $stop = !$c0 || !in_array((string) $c0['status'], self::LIVE, true) ? 'CONTRACT_CLOSED' : (self::payable($c0, $now) ? '' : 'NOTHING_DUE');
            if ($stop !== '') {
                Db::exec("UPDATE allot_payments SET status = 'canceled', toss_status = ?, updated_at = ? WHERE order_id = ? AND status = 'created' AND claim = ''", [$stop, $now, $orderId]);
                Audit::log('allot_pay_refused', $uid, ['order' => $orderId, 'why' => strtolower($stop)], 'info');
                throw new ApiException(409, $stop, $stop === 'CONTRACT_CLOSED' ? '이 계약은 이미 끝났어요. 결제하지 않았어요.' : '지금 낼 것이 없어요. 결제하지 않았어요.');
            }
        }
        $claim = self::claimOf($paymentKey);
        $state = self::claimPayment($orderId, $claim, $now);
        if ($state === 'closed' || $state === 'busy') {
            throw new ApiException(409, 'ORDER_NOT_OPEN', $state === 'busy' ? '이 주문은 지금 확인하고 있어요. 잠시 뒤 ‘내 분양’에서 확인해 주세요.' : '이미 처리된 주문이에요.');
        }
        try {
            $payment = $state === 'resume' ? Toss::lookup($paymentKey, $orderId, (int) $o['amount']) : Toss::confirm($paymentKey, $orderId, (int) $o['amount']);
        } catch (TossException $e) {
            if (in_array($e->tossCode, ['NETWORK_ERROR', 'BAD_RESPONSE'], true)) {
                // no answer: the money may have moved — the row stays claimed and is looked up on the next try
                Audit::log('allot_pay_pending', $uid, ['order' => $orderId, 'code' => $e->tossCode], 'warn');
                throw new ApiException(503, 'PAYMENT_PENDING', '결제 서버의 답이 늦어지고 있어요. 결제가 되었다면 잠시 뒤 다시 확인할 때 반영돼요.', null, ['Retry-After: 30']);
            }
            self::finishPayment($orderId, 'failed', $claim, '', $e->tossCode, $now);
            Audit::log('allot_pay_failed', $uid, ['order' => $orderId, 'code' => $e->tossCode], 'warn');
            throw new ApiException(402, 'PAYMENT_FAILED', '결제가 완료되지 않았어요: ' . $e->getMessage(), ['tossCode' => $e->tossCode]);
        }
        $why = self::paymentMismatch($payment, $orderId, (int) $o['amount'], $paymentKey);
        if ($why !== '') {
            self::finishPayment($orderId, 'failed', $claim, '', 'MISMATCH_' . $why, $now);
            self::tamper($uid, 'gateway_' . $why, ['order' => $orderId, 'stored' => (int) $o['amount'], 'answered' => isset($payment['totalAmount']) && is_int($payment['totalAmount']) ? $payment['totalAmount'] : null]);
            if ((string) (isset($payment['status']) ? $payment['status'] : '') === 'DONE') {
                try { Toss::cancel($paymentKey, '주문 정보와 결제 정보가 달라 자동으로 취소했어요 (' . $why . ')'); }
                catch (\Throwable $e) { Log::error('ALLOT', 'automatic cancel failed', ['why' => $why, 'error' => get_class($e)]); }
            }
            throw new ApiException(402, 'PAYMENT_FAILED', '결제 정보가 주문과 달라서 처리하지 않았어요. 결제가 되었다면 자동으로 취소를 요청했어요.');
        }
        $payId = (int) $o['id'];
        $done = Db::txRetry(function () use ($orderId, $claim, $paymentKey, $payment, $cid, $payId, $o, $uid, $now) {
            $c = self::lockContract($cid);
            // [verify-allot] decided under the lock and BEFORE this payment counts: the contract ended, or another payment
            // covered what was due, while the gateway took the money
            $stop = !in_array((string) $c['status'], self::LIVE, true) ? 'CONTRACT_CLOSED' : (self::payable($c, $now) ? '' : 'NOTHING_DUE');
            if (!self::finishPayment($orderId, 'paid', $claim, $paymentKey, (string) (isset($payment['status']) ? $payment['status'] : ''), $now)) throw new ApiException(409, 'ORDER_NOT_OPEN', '이미 처리된 주문이에요.');
            if ($stop !== '') return $stop;
            list($n, , $to) = self::applyPayment($c, $payId, (int) $o['amount'], null, $now);
            self::notePaid($c, $payId, $to, $now, null);
            Audit::log('allot_payment', $uid, ['contract' => (string) $c['contract_no'], 'payment' => $payId, 'method' => 'toss', 'amount' => (int) $o['amount'], 'periods' => $n]);
            self::approveIfPaid($cid, null, $now);
            return '';
        });
        if ($done !== '') {
            // only THIS payment goes back; earlier, earned payments of the contract are not touched
            self::voidTossPayment($payId, $paymentKey, $done, $now);
            throw new ApiException(409, $done, $done === 'CONTRACT_CLOSED' ? '이 계약은 이미 끝났어요. 결제는 자동으로 취소를 요청했어요.' : '이미 낸 기간이에요. 이번 결제는 자동으로 취소를 요청했어요.');
        }
        $c = (array) Db::one('SELECT contract_no, status, paid_until FROM allot_contracts WHERE id = ?', [$cid]);
        return ['contractNo' => (string) $c['contract_no'], 'status' => (string) $c['status'], 'paidUntil' => (int) $c['paid_until'] >= self::FOREVER ? 0 : (int) $c['paid_until']];
    }

    /**
     * 토스 webhook for an allot order (api/sub/webhook.php hands over what Subscription does not know). The body is never
     * trusted: the payment is fetched again by the stored key (mock: the key must match). A canceled / refunded payment
     * is recorded as a refund; nothing here can mark anything paid. Idempotent per (order, event, status).
     */
    public static function webhook(array $payload): array
    {
        $event = isset($payload['eventType']) && is_string($payload['eventType']) ? mb_substr($payload['eventType'], 0, 60) : 'UNKNOWN';
        $data = isset($payload['data']) && is_array($payload['data']) ? $payload['data'] : $payload;
        $orderId = isset($data['orderId']) && is_string($data['orderId']) ? $data['orderId'] : '';
        $paymentKey = isset($data['paymentKey']) && is_string($data['paymentKey']) ? $data['paymentKey'] : '';
        $o = $orderId !== '' ? self::payOrder($orderId) : null;
        if (!$o || $paymentKey === '') return ['ignored' => true, 'why' => 'unknown order'];
        $stored = self::unseal($o['payment_key_enc']);
        if ($stored === '' || !hash_equals($stored, $paymentKey)) return ['ignored' => true, 'why' => 'payment key mismatch'];
        if (Toss::mock()) {
            $status = isset($data['status']) && is_string($data['status']) ? mb_substr($data['status'], 0, 40) : '';
        } else {
            try { $p = Toss::payment($stored); } catch (TossException $e) { return ['ignored' => true, 'why' => 'unverifiable']; }
            if ((string) (isset($p['orderId']) ? $p['orderId'] : '') !== $orderId) return ['ignored' => true, 'why' => 'order mismatch'];
            $status = (string) (isset($p['status']) ? $p['status'] : '');
        }
        if ($status === '') return ['ignored' => true, 'why' => 'no status'];
        $now = Clock::ms();
        // [verify-allot] "seen", the refund and the new status in ONE transaction under the contract lock: a webhook that
        // fails half-way leaves nothing behind, so the gateway's retry is not taken for a duplicate (and two at once refund once)
        $refunded = Db::txRetry(function () use ($o, $orderId, $event, $status, $now) {
            self::lockContract((int) $o['contract_id']);
            if (Db::one('SELECT id FROM payment_events WHERE order_id = ? AND event = ? AND status = ?', [$orderId, $event, $status])) return null;
            Db::insert('payment_events', ['order_id' => $orderId, 'event' => $event, 'status' => $status, 'payload' => '', 'created_at' => $now]);
            $done = in_array($status, ['CANCELED', 'PARTIAL_CANCELED'], true) && self::refundLocked($o, '결제 취소 (토스 알림)', null, $now) > 0;
            Db::exec('UPDATE allot_payments SET toss_status = ?, updated_at = ? WHERE id = ?', [$status, $now, (int) $o['id']]);
            return $done;
        });
        if ($refunded === null) return ['ignored' => true, 'why' => 'duplicate'];
        if ($refunded) Audit::log('allot_refund', $o['user_id'] === null ? null : (int) $o['user_id'], ['payment' => (int) $o['id'], 'contract' => (int) $o['contract_id'], 'method' => 'toss', 'amount' => (int) $o['amount'], 'webhook' => true], 'warn');
        return ['ignored' => false, 'status' => $status, 'refunded' => $refunded, 'allot' => true];
    }

    // ------------------------------------------------------------------ waiting list
    /** are there free units for this target right now? */
    private static function hasFree(string $kind, int $zoneId): bool
    {
        if ($zoneId > 0) return Db::value("SELECT id FROM allot_units WHERE zone_id = ? AND status = 'open' LIMIT 1", [$zoneId]) !== null;
        foreach (Db::all('SELECT id FROM allot_zones WHERE kind = ? AND is_open = 1', [$kind]) as $z) {
            if (Db::value("SELECT id FROM allot_units WHERE zone_id = ? AND status = 'open' LIMIT 1", [(int) $z['id']]) !== null) return true;
        }
        return false;
    }

    /** how many wait in front of (and including) this row for the same kind of place */
    private static function waitPosition(array $w): int
    {
        return (int) Db::value("SELECT COUNT(*) FROM allot_waitlist WHERE kind = ? AND status = 'waiting' AND id <= ? AND (? = 0 OR zone_id IN (0, ?))", [(string) $w['kind'], (int) $w['id'], (int) $w['zone_id'], (int) $w['zone_id']]);
    }

    /** the live waiting-list rows of an account (mine()) */
    private static function waitOf(int $uid): array
    {
        $out = [];
        foreach (Db::all("SELECT w.id, w.kind, w.zone_id, w.status, w.unit_id, w.offer_until, w.created_at, z.code AS zone_code, u.code AS unit_code
            FROM allot_waitlist w LEFT JOIN allot_zones z ON z.id = w.zone_id LEFT JOIN allot_units u ON u.id = w.unit_id
            WHERE w.user_id = ? AND w.status IN ('waiting', 'offered') ORDER BY w.id ASC", [$uid]) as $w) {
            $out[] = ['id' => (int) $w['id'], 'kind' => (string) $w['kind'], 'zone' => $w['zone_code'] === null ? null : (string) $w['zone_code'], 'status' => (string) $w['status'],
                'position' => (string) $w['status'] === 'waiting' ? self::waitPosition($w) : 0, 'unit' => $w['unit_code'] === null ? null : (string) $w['unit_code'],
                'offerUntil' => (int) $w['offer_until'], 'createdAt' => (int) $w['created_at']];
        }
        return $out;
    }

    /**
     * api/allot/waitlist.php (join): wait for a free unit of a kind (any zone) or of one zone. $form as in apply() (name,
     * phone, consent, consentVersion, adult). One live row per customer and target; it counts toward apply_per_user.
     * → {id, status: 'waiting', position}. 409 HAS_FREE (there is a free unit: apply instead) · 409 ALREADY_WAITING ·
     * 404 NOT_FOUND · 409 NOT_OPEN · 429 APPLY_LIMIT · 400 CONSENT_REQUIRED / INVALID_INPUT · 403 ALLOT_DISABLED.
     */
    public static function waitJoin(array $user, string $kind, $zone, array $form, ?int $now = null): array
    {
        self::guard();
        $uid = (int) (isset($user['id']) ? $user['id'] : 0);
        if ($uid < 1) throw new ApiException(401, 'AUTH_REQUIRED', '로그인이 필요해요. 다시 로그인해 주세요.');
        if (!in_array($kind, self::KINDS, true)) V::fail('kind', '값은 jar · plot · store 가운데 하나여야 해요.');
        $now = self::now($now);
        $f = self::applicantForm($form);
        $zid = 0;
        if ($zone !== null && $zone !== '') {
            $code = is_string($zone) ? strtoupper(trim($zone)) : '';
            if (!preg_match('/^[A-Z0-9]{1,12}$/', $code)) V::fail('zone', '구역 번호가 올바르지 않아요.');
            $z = Db::one('SELECT id, kind, is_open FROM allot_zones WHERE code = ?', [$code]);
            if (!$z) throw new ApiException(404, 'NOT_FOUND', '그런 구역이 없어요.');
            if ((string) $z['kind'] !== $kind) V::fail('zone', '고른 종류의 구역이 아니에요.');
            if ((int) $z['is_open'] !== 1) throw new ApiException(409, 'NOT_OPEN', '지금은 신청을 받지 않는 구역이에요.');
            $zid = (int) $z['id'];
        }
        $id = Db::txRetry(function () use ($uid, $kind, $zid, $f, $now) {
            Db::one('SELECT id FROM users WHERE id = ?' . Db::forUpdate(), [$uid]);
            self::checkLimit($uid);
            if (self::hasFree($kind, $zid)) throw new ApiException(409, 'HAS_FREE', '빈 자리가 있어요. 바로 신청할 수 있어요.');
            $cid = self::upsertOwnCustomer($uid, $f, $now);
            try {
                $id = Db::insert('allot_waitlist', ['kind' => $kind, 'zone_id' => $zid, 'customer_id' => $cid, 'user_id' => $uid, 'live_key' => $cid . ':' . $kind . ':' . $zid, 'status' => 'waiting',
                    'unit_id' => null, 'offer_until' => 0, 'created_at' => $now, 'updated_at' => $now]);
            } catch (\PDOException $e) {
                if ((string) $e->getCode() === '23000') throw new ApiException(409, 'ALREADY_WAITING', '벌써 기다리고 있어요.');
                throw $e;
            }
            Audit::log('allot_wait_joined', $uid, ['wait' => $id, 'kind' => $kind, 'zone' => $zid]);
            return $id;
        });
        $w = (array) Db::one('SELECT id, kind, zone_id FROM allot_waitlist WHERE id = ?', [$id]);
        return ['id' => (int) $id, 'status' => 'waiting', 'position' => self::waitPosition($w)];
    }

    /** a live waiting-list row stops ('canceled' | 'expired'); an offered unit is free again → the unit id to offer on, or 0 */
    private static function waitClose(array $w, string $to, int $now): int
    {
        $was = (string) $w['status'];
        if (Db::exec('UPDATE allot_waitlist SET status = ?, live_key = NULL, updated_at = ? WHERE id = ? AND status = ?', [$to, $now, (int) $w['id'], $was]) !== 1) return 0;
        if ($was !== 'offered' || $w['unit_id'] === null) return 0;
        $u = Db::one('SELECT id, zone_id FROM allot_units WHERE id = ?' . Db::forUpdate(), [(int) $w['unit_id']]);
        if (!$u || !self::unitCas((int) $u['id'], 'held', 'open', null, 0, $now, 'free')) return 0;
        self::bumpZone((int) $u['zone_id'], $now);
        return (int) $u['id'];
    }

    /** the caller's own live waiting-list row, locked (another account's / unknown → 404 NOT_FOUND) */
    private static function ownWait(int $uid, int $id): array
    {
        $w = Db::one("SELECT * FROM allot_waitlist WHERE id = ? AND status IN ('waiting', 'offered')" . Db::forUpdate(), [$id]);
        if (!$w || $uid < 1 || (int) $w['user_id'] !== $uid) throw new ApiException(404, 'NOT_FOUND', '대기 신청을 찾을 수 없어요.');
        return $w;
    }

    /** api/allot/waitlist.php (leave): stop waiting, or decline an offer (the unit goes to the next in line) → {id, status: 'canceled'} */
    public static function waitLeave(array $user, int $id, ?int $now = null): array
    {
        $uid = (int) (isset($user['id']) ? $user['id'] : 0);
        $now = self::now($now);
        $unit = Db::txRetry(function () use ($uid, $id, $now) {
            $w = self::ownWait($uid, $id);
            $unit = self::waitClose($w, 'canceled', $now);
            Audit::log('allot_wait_left', $uid, ['wait' => $id, 'was' => (string) $w['status']]);
            return $unit;
        });
        self::offerQuietly((int) $unit, $now);
        return ['id' => $id, 'status' => 'canceled'];
    }

    /** the operator removes a waiting-list row (the same effect as the customer leaving). Audit allot_wait_left. */
    public static function waitCancel(array $a, int $id, ?int $now = null): array
    {
        $actor = self::admin($a);
        $now = self::now($now);
        $unit = Db::txRetry(function () use ($id, $actor, $now) {
            $w = Db::one("SELECT * FROM allot_waitlist WHERE id = ? AND status IN ('waiting', 'offered')" . Db::forUpdate(), [$id]);
            if (!$w) throw new ApiException(404, 'NOT_FOUND', '대기 신청을 찾을 수 없어요.');
            $unit = self::waitClose($w, 'canceled', $now);
            Audit::log('allot_wait_left', $w['user_id'] === null ? null : (int) $w['user_id'], ['wait' => $id, 'was' => (string) $w['status'], 'byAdmin' => true], 'info', self::idOrNull($actor));
            return $unit;
        });
        self::offerQuietly((int) $unit, $now);
        return ['id' => $id, 'status' => 'canceled'];
    }

    /**
     * api/allot/waitlist.php (accept): the offered unit becomes the caller's application — pending (the hold starts
     * again) or active at once with auto_approve = always. → as apply(). 404 NOT_FOUND · 409 OFFER_GONE (no offer, or its
     * time is over).
     */
    public static function waitAccept(array $user, int $id, ?int $now = null): array
    {
        self::guard();
        $uid = (int) (isset($user['id']) ? $user['id'] : 0);
        $now = self::now($now);
        $always = self::conf('auto_approve') === 'always';
        $hold = (int) self::conf('hold_hours');
        $holdUntil = $hold > 0 ? $now + $hold * 3600000 : 0;
        return Db::txRetry(function () use ($uid, $id, $now, $always, $holdUntil) {
            Db::one('SELECT id FROM users WHERE id = ?' . Db::forUpdate(), [$uid]);
            $w = self::ownWait($uid, $id);
            if ((string) $w['status'] !== 'offered' || $w['unit_id'] === null || ((int) $w['offer_until'] > 0 && (int) $w['offer_until'] < $now)) throw new ApiException(409, 'OFFER_GONE', '확정할 수 있는 자리가 없어요. 기한이 지났을 수 있어요.');
            $u = Db::one('SELECT id, zone_id, code, status, contract_id FROM allot_units WHERE id = ?' . Db::forUpdate(), [(int) $w['unit_id']]);
            if (!$u || (string) $u['status'] !== 'held' || $u['contract_id'] !== null) throw new ApiException(409, 'OFFER_GONE', '확정할 수 있는 자리가 없어요.');
            $z = self::zonePlan((int) $u['zone_id']);
            $unitId = (int) $u['id'];
            list($conId, $no) = self::insertContract([
                'unit_id' => $unitId, 'live_unit_id' => $unitId, 'customer_id' => (int) $w['customer_id'], 'user_id' => $uid, 'status' => 'pending', 'period' => (string) $z['period'], 'price' => (int) $z['price'],
                'term_months' => (int) $z['term_months'], 'starts_at' => 0, 'ends_at' => 0, 'paid_until' => 0, 'paid_total' => 0, 'auto_renew' => 0, 'source' => 'app', 'memo' => null,
                'created_by' => $uid, 'decided_by' => null, 'decided_at' => 0, 'cancel_req_at' => 0, 'due_stage' => 999, 'end_stage' => 999, 'ended_at' => 0, 'end_reason' => '',
                'created_at' => $now, 'updated_at' => $now,
            ]);
            if (!self::heldAttach($unitId, $conId, $holdUntil, $now)) throw new ApiException(409, 'OFFER_GONE', '확정할 수 있는 자리가 없어요.');
            if (Db::exec("UPDATE allot_waitlist SET status = 'converted', live_key = NULL, updated_at = ? WHERE id = ? AND status = 'offered'", [$now, $id]) !== 1) throw new ApiException(409, 'OFFER_GONE', '확정할 수 있는 자리가 없어요.');
            $c = (array) Db::one('SELECT * FROM allot_contracts WHERE id = ?', [$conId]);
            Audit::log('allot_applied', $uid, ['contract' => $no, 'unit' => (string) $u['code'], 'wait' => $id]);
            if ($always) {
                self::approveLocked($c, null, $now, '');
                return ['contractNo' => $no, 'status' => 'active', 'unit' => (string) $u['code'], 'holdUntil' => 0, 'pay' => self::payInfo(0)];
            }
            self::noteContract($c, $now, 'applied', '분양 신청을 받았어요', $u['code'] . ' 자리 신청을 받았어요. 운영자가 확인하면 알려 드릴게요.', 'applied:' . $conId);
            return ['contractNo' => $no, 'status' => 'pending', 'unit' => (string) $u['code'], 'holdUntil' => $holdUntil, 'pay' => self::payInfo($holdUntil)];
        });
    }

    /**
     * A unit is free: offer it to the first in line (lowest id) that waits for its kind in any zone or in its zone. The
     * unit is held until now + waitlist_offer_hours, the row becomes 'offered' and the customer gets a notice.
     * → {id, unit, offerUntil} or null (nobody waits, the unit is not free, its zone is closed). $unit: id or code.
     */
    public static function offerNext($unit, ?int $now = null): ?array
    {
        $now = self::now($now);
        $until = $now + (int) self::conf('waitlist_offer_hours') * 3600000;
        return Db::txRetry(function () use ($unit, $now, $until) {
            $u = is_int($unit) ? Db::one('SELECT id, zone_id, kind, code, status, contract_id FROM allot_units WHERE id = ?' . Db::forUpdate(), [$unit])
                : Db::one('SELECT id, zone_id, kind, code, status, contract_id FROM allot_units WHERE code = ?' . Db::forUpdate(), [self::unitCode($unit)]);
            if (!$u || (string) $u['status'] !== 'open') return null;
            if ((int) Db::value('SELECT is_open FROM allot_zones WHERE id = ?', [(int) $u['zone_id']]) !== 1) return null;
            $w = Db::one("SELECT id, customer_id, user_id FROM allot_waitlist WHERE kind = ? AND status = 'waiting' AND zone_id IN (0, ?) ORDER BY id ASC LIMIT 1" . Db::forUpdate(), [(string) $u['kind'], (int) $u['zone_id']]);
            if (!$w) return null;
            if (!self::unitCas((int) $u['id'], 'open', 'held', null, $until, $now, 'free')) return null;
            if (Db::exec("UPDATE allot_waitlist SET status = 'offered', unit_id = ?, offer_until = ?, updated_at = ? WHERE id = ? AND status = 'waiting'", [(int) $u['id'], $until, $now, (int) $w['id']]) !== 1) {
                throw new \RuntimeException('a locked waiting-list row changed');
            }
            self::bumpZone((int) $u['zone_id'], $now);
            self::note($now, null, (int) $w['customer_id'], $w['user_id'] === null ? null : (int) $w['user_id'], 'offer', '기다리던 자리가 났어요!',
                $u['code'] . ' 자리가 났어요. ' . self::fmtDate($until) . ' 까지 ‘내 분양’에서 확정해 주세요.', 'offer:' . $w['id'] . ':' . $u['id']);
            Audit::log('allot_wait_offer', $w['user_id'] === null ? null : (int) $w['user_id'], ['wait' => (int) $w['id'], 'unit' => (string) $u['code']]);
            return ['id' => (int) $w['id'], 'unit' => (string) $u['code'], 'offerUntil' => $until];
        });
    }

    /**
     * The waiting list in order (first in line first; keyset ascending). $filter: kind, zone (id or code), status.
     * Rows: {id, kind, zoneCode, status, customerId, customer (masked), phoneTail, userId, unitCode, offerUntil, createdAt}.
     */
    public static function listWait(array $filter = [], int $limit = 50, int $afterId = 0): array
    {
        $kind = isset($filter['kind']) && in_array($filter['kind'], self::KINDS, true) ? (string) $filter['kind'] : '';
        $status = isset($filter['status']) && in_array($filter['status'], ['waiting', 'offered', 'converted', 'expired', 'canceled'], true) ? (string) $filter['status'] : '';
        $zid = -1;
        if (isset($filter['zone']) && $filter['zone'] !== '' && $filter['zone'] !== 0) {
            $z = self::zoneRow($filter['zone']);
            if (!$z) return ['rows' => [], 'next' => 0];
            $zid = (int) $z['id'];
        }
        $limit = max(1, min(500, $limit));
        $rows = Db::all("SELECT w.*, z.code AS zone_code, u.code AS unit_code, cu.name_enc, cu.phone_tail
            FROM allot_waitlist w LEFT JOIN allot_zones z ON z.id = w.zone_id LEFT JOIN allot_units u ON u.id = w.unit_id LEFT JOIN allot_customers cu ON cu.id = w.customer_id
            WHERE w.id > ? AND (? = '' OR w.kind = ?) AND (? = '' OR w.status = ?) AND (? < 0 OR w.zone_id = ?) ORDER BY w.id ASC LIMIT ?", [max(0, $afterId), $kind, $kind, $status, $status, $zid, $zid, $limit + 1]);
        $more = count($rows) > $limit;
        if ($more) array_pop($rows);
        $out = array_map(function ($w) {
            return ['id' => (int) $w['id'], 'kind' => (string) $w['kind'], 'zoneCode' => $w['zone_code'] === null ? '' : (string) $w['zone_code'], 'status' => (string) $w['status'],
                'customerId' => (int) $w['customer_id'], 'customer' => self::maskName(self::unseal($w['name_enc'])), 'phoneTail' => (string) $w['phone_tail'], 'userId' => $w['user_id'] === null ? 0 : (int) $w['user_id'],
                'unitCode' => $w['unit_code'] === null ? '' : (string) $w['unit_code'], 'offerUntil' => (int) $w['offer_until'], 'createdAt' => (int) $w['created_at']];
        }, $rows);
        return ['rows' => $out, 'next' => $more && $out ? $out[count($out) - 1]['id'] : 0];
    }

    // ------------------------------------------------------------------ nameplates, the public unit view, care logs
    /** the operator sets (or clears) the nameplate of a unit: cleaned, personal information and bad words masked, ≤ 12 characters */
    public static function setLabel(array $a, int $unitId, string $text, bool $show): array
    {
        $actor = self::admin($a);
        V::str($text, 'text', 40);
        $u = Db::one('SELECT id, code FROM allot_units WHERE id = ?', [$unitId]);
        if (!$u) throw new ApiException(404, 'NOT_FOUND', '자리를 찾을 수 없어요.');
        $label = self::cleanPublic($text, self::LABEL_MAX);
        Db::exec('UPDATE allot_units SET label = ?, label_show = ?, updated_at = ? WHERE id = ?', [$label, $label !== '' && $show ? 1 : 0, Clock::ms(), $unitId]);
        Audit::log('allot_label_set', null, ['unit' => (string) $u['code'], 'chars' => mb_strlen($label), 'show' => $label !== '' && $show], 'info', self::idOrNull($actor));
        return ['unit' => (string) $u['code'], 'text' => $label, 'show' => $label !== '' && $show];
    }

    /** api/allot/nameplate.php: the owner of a live contract names the unit (same cleaning) → {contractNo, nameplate: {text, show}}; another account's number is 404 */
    public static function setLabelByUser(array $user, string $contractNo, string $text, bool $show): array
    {
        $uid = (int) (isset($user['id']) ? $user['id'] : 0);
        V::str($text, 'text', 40);
        $c = self::ownContract($uid, $contractNo, 'nameplate');
        if (!in_array((string) $c['status'], self::LIVE, true)) throw new ApiException(409, 'NOT_LIVE', '이미 끝난 계약이에요.');
        $label = self::cleanPublic($text, self::LABEL_MAX);
        Db::exec('UPDATE allot_units SET label = ?, label_show = ?, updated_at = ? WHERE id = ? AND contract_id = ?', [$label, $label !== '' && $show ? 1 : 0, Clock::ms(), (int) $c['unit_id'], (int) $c['id']]);
        Audit::log('allot_label_set', $uid, ['contract' => (string) $c['contract_no'], 'chars' => mb_strlen($label), 'show' => $label !== '' && $show]);
        return ['contractNo' => (string) $c['contract_no'], 'nameplate' => ['text' => $label, 'show' => $label !== '' && $show]];
    }

    /**
     * api/allot/unit.php — what anyone may know about a unit: {code, kind, zone: {code, name}, seq, status, canApply,
     * nameplate (only when its owner chose to show it, else null), logs (the 5 newest visible care logs), mine (the
     * caller holds it)}. No contract, no customer, no dates. 404 NOT_FOUND.
     */
    public static function unitView(string $code, int $uid = 0): array
    {
        $c = self::unitCode($code);
        $u = $c === '' ? null : Db::one('SELECT u.id, u.zone_id, u.kind, u.code, u.seq, u.status, u.contract_id, u.label, u.label_show, z.code AS zone_code, z.name AS zone_name, z.is_open
            FROM allot_units u JOIN allot_zones z ON z.id = u.zone_id WHERE u.code = ?', [$c]);
        if (!$u) throw new ApiException(404, 'NOT_FOUND', '그런 자리가 없어요.');
        $taken = in_array((string) $u['status'], ['held', 'leased'], true);
        $mine = $uid > 0 && $u['contract_id'] !== null && (int) Db::value('SELECT user_id FROM allot_contracts WHERE id = ?', [(int) $u['contract_id']]) === $uid;
        $logs = self::careLogs(['unit' => (int) $u['id']], 5);
        return [
            'code' => (string) $u['code'], 'kind' => (string) $u['kind'], 'zone' => ['code' => (string) $u['zone_code'], 'name' => (string) $u['zone_name']], 'seq' => (int) $u['seq'],
            'status' => (string) $u['status'], 'canApply' => (string) $u['status'] === 'open' && (int) $u['is_open'] === 1 && self::enabled(),
            'nameplate' => $taken && (int) $u['label_show'] === 1 && (string) $u['label'] !== '' ? (string) $u['label'] : null, 'logs' => $logs['logs'], 'mine' => $mine,
        ];
    }

    public const CARE_KINDS = ['care', 'water', 'clean', 'check', 'weather', 'event', 'photo', 'notice'];

    /** $target → [zone id, unit id]: ['unit' => id | code] · ['zone' => id | code] · ['all' => true] */
    private static function careTarget(array $target): array
    {
        if (isset($target['unit'])) {
            $u = is_int($target['unit']) ? Db::one('SELECT id, zone_id FROM allot_units WHERE id = ?', [$target['unit']]) : Db::one('SELECT id, zone_id FROM allot_units WHERE code = ?', [self::unitCode($target['unit'])]);
            if (!$u) throw new ApiException(404, 'NOT_FOUND', '그런 자리가 없어요.');
            return [(int) $u['zone_id'], (int) $u['id']];
        }
        if (isset($target['zone'])) {
            $z = self::zoneRow($target['zone']);
            if (!$z) throw new ApiException(404, 'NOT_FOUND', '그런 구역이 없어요.');
            return [(int) $z['id'], 0];
        }
        if (isset($target['all']) && $target['all'] === true) return [0, 0];
        V::fail('target', '자리 · 구역 · 전체 가운데 하나를 골라 주세요.');
        return [0, 0];
    }

    /**
     * A care-log line ("3구역 장독을 닦았어요") for one unit, a whole zone or every zone. $kind: one of CARE_KINDS.
     * $text ≤ 300 characters; it is public when $visible, so it is cleaned and masked like every customer-visible text.
     * Audit allot_care_added. → {id, kind, text, at, scope, visible}
     */
    public static function addCare(array $a, array $target, string $kind, string $text, bool $visible = true, ?int $now = null): array
    {
        $actor = self::admin($a);
        if (!in_array($kind, self::CARE_KINDS, true)) V::fail('kind', '값이 올바르지 않아요.');
        V::str($text, 'text', 300);
        $clean = self::cleanPublic($text, 300);
        if ($clean === '') V::fail('text', '내용을 적어 주세요.');
        list($zid, $uid) = self::careTarget($target);
        $now = self::now($now);
        $id = Db::insert('allot_care_logs', ['zone_id' => $zid, 'unit_id' => $uid, 'kind' => $kind, 'text' => $clean, 'visible' => $visible ? 1 : 0, 'created_by' => self::idOrNull($actor), 'created_at' => $now]);
        Audit::log('allot_care_added', null, ['log' => $id, 'zone' => $zid, 'unit' => $uid, 'kind' => $kind, 'chars' => mb_strlen($clean)], 'info', self::idOrNull($actor));
        return ['id' => $id, 'kind' => $kind, 'text' => $clean, 'at' => $now, 'scope' => $uid > 0 ? 'unit' : ($zid > 0 ? 'zone' : 'all'), 'visible' => $visible];
    }

    /** show or hide a care-log line */
    public static function setCareVisible(array $a, int $id, bool $visible): void
    {
        $actor = self::admin($a);
        if (Db::value('SELECT id FROM allot_care_logs WHERE id = ?', [$id]) === null) throw new ApiException(404, 'NOT_FOUND', '관리 일지를 찾을 수 없어요.');
        Db::exec('UPDATE allot_care_logs SET visible = ? WHERE id = ?', [$visible ? 1 : 0, $id]);
        Audit::log('allot_care_visible', null, ['log' => $id, 'visible' => $visible], 'info', self::idOrNull($actor));
    }

    /**
     * Care logs, newest first: for a unit its own lines + its zone's + the ones for every zone; for a zone the zone's +
     * every zone's; ['all' => true] = every line (the admin list). Hidden lines only with $all. $beforeId pages back.
     * → {logs: [{id, kind, text, at, scope, visible}], more}
     */
    public static function careLogs(array $target, int $limit = 20, int $beforeId = 0, bool $all = false): array
    {
        $limit = max(1, min(100, $limit));
        $h = $all ? 1 : 0;
        $b = max(0, $beforeId);
        if (isset($target['all']) && $target['all'] === true) {
            $rows = Db::all('SELECT id, zone_id, unit_id, kind, text, visible, created_at FROM allot_care_logs WHERE (? = 1 OR visible = 1) AND (? = 0 OR id < ?) ORDER BY id DESC LIMIT ?', [$h, $b, $b, $limit + 1]);
        } else {
            list($zid, $uid) = self::careTarget($target);
            if ($uid > 0) {
                $rows = Db::all('SELECT id, zone_id, unit_id, kind, text, visible, created_at FROM allot_care_logs WHERE (unit_id = ? OR (unit_id = 0 AND zone_id IN (0, ?))) AND (? = 1 OR visible = 1) AND (? = 0 OR id < ?)
                    ORDER BY id DESC LIMIT ?', [$uid, $zid, $h, $b, $b, $limit + 1]);
            } else {
                $rows = Db::all('SELECT id, zone_id, unit_id, kind, text, visible, created_at FROM allot_care_logs WHERE unit_id = 0 AND zone_id IN (0, ?) AND (? = 1 OR visible = 1) AND (? = 0 OR id < ?)
                    ORDER BY id DESC LIMIT ?', [$zid, $h, $b, $b, $limit + 1]);
            }
        }
        $more = count($rows) > $limit;
        if ($more) array_pop($rows);
        return ['logs' => array_map(function ($r) {
            return ['id' => (int) $r['id'], 'kind' => (string) $r['kind'], 'text' => (string) $r['text'], 'at' => (int) $r['created_at'],
                'scope' => (int) $r['unit_id'] > 0 ? 'unit' : ((int) $r['zone_id'] > 0 ? 'zone' : 'all'), 'visible' => (int) $r['visible'] === 1];
        }, $rows), 'more' => $more];
    }

    // ------------------------------------------------------------------ operator notices (compose, outbox)
    /** example messages for the compose form (예시): [{key, title, body}] */
    public static function noticeTemplates(): array
    {
        return [
            ['key' => 'make', 'title' => '장 담그는 날 안내', 'body' => '[예시] 장 담그는 날이 다가와요. 날짜와 준비물은 체험관 안내소에서 알려 드려요.'],
            ['key' => 'split', 'title' => '장 가르는 날 안내', 'body' => '[예시] 메주를 건져 된장과 간장으로 가르는 날이에요. 함께 오시면 직접 해 볼 수 있어요.'],
            ['key' => 'pickup', 'title' => '받는 날 안내', 'body' => '[예시] 잘 익은 장을 받아 가는 날이에요. 담아 갈 그릇을 준비해 주세요.'],
            ['key' => 'pay', 'title' => '납부 안내', 'body' => '[예시] 납부 기한이 다가와요. 금액과 방법은 ‘안내’에서 어른과 함께 확인해 주세요.'],
            ['key' => 'closed', 'title' => '쉬는 날 안내', 'body' => '[예시] 이번 주는 체험관이 쉬어요. 장독은 평소처럼 돌보고 있어요.'],
        ];
    }

    /**
     * The operator writes to customers. $target: ['contract' => id] · ['customer' => id] · ['zone' => id | code] (everyone
     * with a live contract there) · ['kind' => jar | plot | store] · ['all' => true]. $title ≤ 80, $body ≤ 300 characters,
     * cleaned and masked. One notice per customer; $sendAt (ms) schedules it. Customers without an app account get a
     * 'queued' notice the operator handles by phone (listNotices(['offline' => true])). Audit allot_notice_sent (count
     * only). → {batch, count}
     */
    public static function notify(array $a, array $target, string $title, string $body, ?int $sendAt = null, ?int $now = null): array
    {
        $actor = self::admin($a);
        V::str($title, 'title', 80);
        V::str($body, 'body', 300);
        $t = self::cleanPublic($title, 80);
        $b = self::cleanPublic($body, 300);
        if ($t === '') V::fail('title', '제목을 적어 주세요.');
        $now = self::now($now);
        if ($sendAt !== null && ($sendAt < $now - self::DAY || $sendAt > $now + 366 * self::DAY)) V::fail('sendAt', '보내는 때는 지금부터 1년 안이어야 해요.');
        $cid = 0; $cu = 0; $zid = 0; $kind = ''; $all = 0;
        if (isset($target['contract'])) $cid = (int) $target['contract'];
        elseif (isset($target['customer'])) $cu = (int) $target['customer'];
        elseif (isset($target['zone'])) { $z = self::zoneRow($target['zone']); if (!$z) throw new ApiException(404, 'NOT_FOUND', '그런 구역이 없어요.'); $zid = (int) $z['id']; }
        elseif (isset($target['kind']) && in_array($target['kind'], self::KINDS, true)) $kind = (string) $target['kind'];
        elseif (isset($target['all']) && $target['all'] === true) $all = 1;
        else V::fail('target', '받는 사람을 골라 주세요.');
        $batch = bin2hex(random_bytes(4));
        $count = Db::tx(function () use ($cid, $cu, $zid, $kind, $all, $t, $b, $sendAt, $batch, $actor, $now) {
            if ($cu > 0) {
                $rows = Db::all('SELECT 0 AS contract_id, id AS customer_id, user_id FROM allot_customers WHERE id = ? AND purged_at = 0', [$cu]);
            } else {
                $rows = Db::all("SELECT MIN(c.id) AS contract_id, c.customer_id, MAX(c.user_id) AS user_id FROM allot_contracts c JOIN allot_units u ON u.id = c.unit_id
                    WHERE c.status IN ('pending', 'active', 'overdue') AND (? = 0 OR c.id = ?) AND (? = 0 OR u.zone_id = ?) AND (? = '' OR u.kind = ?) AND (? = 1 OR ? > 0 OR ? > 0 OR ? <> '')
                    GROUP BY c.customer_id", [$cid, $cid, $zid, $zid, $kind, $kind, $all, $cid, $zid, $kind]);
            }
            $n = 0;
            foreach ($rows as $r) {
                if (self::note($now, (int) $r['contract_id'] > 0 ? (int) $r['contract_id'] : null, (int) $r['customer_id'], $r['user_id'] === null ? null : (int) $r['user_id'], 'info', $t, $b,
                    'bc:' . $batch . ':' . $r['customer_id'], self::idOrNull($actor), $sendAt)) $n++;
            }
            return $n;
        });
        Audit::log('allot_notice_sent', null, ['batch' => $batch, 'count' => $count, 'scheduled' => $sendAt !== null && $sendAt > $now], 'info', self::idOrNull($actor));
        return ['batch' => $batch, 'count' => (int) $count];
    }

    /**
     * Queued notices that are due are delivered (accounts only; the rest waits for the operator) → rows sent.
     * A delivered notice is written as a NEW row and the queued one removed: the inbox is read "newer than id N"
     * (api/allot/inbox.php?after=), so a notice that was scheduled long ago must not arrive with an old id.
     */
    private static function flushNotices(int $now, int $limit): int
    {
        $n = 0;
        foreach (Db::all("SELECT * FROM allot_notices WHERE status = 'queued' AND send_at <= ? AND user_id IS NOT NULL ORDER BY send_at ASC, id ASC LIMIT ?", [$now, $limit]) as $r) {
            $n += (int) Db::tx(function () use ($r, $now) {
                if (Db::exec("DELETE FROM allot_notices WHERE id = ? AND status = 'queued'", [(int) $r['id']]) !== 1) return 0; // another run delivered it
                Db::insert('allot_notices', [
                    'contract_id' => $r['contract_id'] === null ? null : (int) $r['contract_id'], 'customer_id' => $r['customer_id'] === null ? null : (int) $r['customer_id'], 'user_id' => (int) $r['user_id'],
                    'kind' => (string) $r['kind'], 'dedupe_key' => $r['dedupe_key'] === null ? null : (string) $r['dedupe_key'], 'title' => (string) $r['title'], 'body' => (string) $r['body'], 'status' => 'sent',
                    'send_at' => (int) $r['send_at'], 'sent_at' => $now, 'seen_at' => 0, 'created_by' => $r['created_by'] === null ? null : (int) $r['created_by'], 'created_at' => (int) $r['created_at'],
                ]);
                return 1;
            });
        }
        return $n;
    }

    /**
     * The outbox, newest first (keyset). $filter: status, kind, contractId, customerId, offline (true = customers without
     * an app account: the operator calls them). Rows: {id, kind, title, body, status, sendAt, sentAt, seenAt, contractNo,
     * customerId, customer (masked), phoneTail, hasAccount}.
     */
    public static function listNotices(array $filter = [], int $limit = 50, int $afterId = 0): array
    {
        $status = isset($filter['status']) && in_array($filter['status'], ['queued', 'sent', 'seen', 'canceled'], true) ? (string) $filter['status'] : '';
        $kind = isset($filter['kind']) && is_string($filter['kind']) && preg_match('/^[a-z_]{1,24}$/', $filter['kind']) ? $filter['kind'] : '';
        $cid = isset($filter['contractId']) ? max(0, (int) $filter['contractId']) : 0;
        $cu = isset($filter['customerId']) ? max(0, (int) $filter['customerId']) : 0;
        $off = !empty($filter['offline']) ? 1 : 0;
        $limit = max(1, min(500, $limit));
        $rows = Db::all("SELECT n.*, c.contract_no, cu.name_enc, cu.phone_tail FROM allot_notices n LEFT JOIN allot_contracts c ON c.id = n.contract_id LEFT JOIN allot_customers cu ON cu.id = n.customer_id
            WHERE (? = 0 OR n.id < ?) AND (? = '' OR n.status = ?) AND (? = '' OR n.kind = ?) AND (? = 0 OR n.contract_id = ?) AND (? = 0 OR n.customer_id = ?) AND (? = 0 OR n.user_id IS NULL)
            ORDER BY n.id DESC LIMIT ?", [$afterId, $afterId, $status, $status, $kind, $kind, $cid, $cid, $cu, $cu, $off, $limit + 1]);
        $more = count($rows) > $limit;
        if ($more) array_pop($rows);
        $out = array_map(function ($r) {
            return ['id' => (int) $r['id'], 'kind' => (string) $r['kind'], 'title' => (string) $r['title'], 'body' => (string) $r['body'], 'status' => (string) $r['status'], 'sendAt' => (int) $r['send_at'],
                'sentAt' => (int) $r['sent_at'], 'seenAt' => (int) $r['seen_at'], 'contractNo' => $r['contract_no'] === null ? '' : (string) $r['contract_no'],
                'customerId' => $r['customer_id'] === null ? 0 : (int) $r['customer_id'], 'customer' => self::maskName(self::unseal($r['name_enc'])), 'phoneTail' => (string) $r['phone_tail'],
                'hasAccount' => $r['user_id'] !== null];
        }, $rows);
        return ['rows' => $out, 'next' => $more && $out ? $out[count($out) - 1]['id'] : 0];
    }

    /** the operator closes a queued notice: 'sent' (told the customer by phone) or 'canceled' (no longer needed). 409 NOT_QUEUED */
    public static function noticeDone(array $a, int $id, string $status = 'sent', ?int $now = null): void
    {
        $actor = self::admin($a);
        if (!in_array($status, ['sent', 'canceled'], true)) V::fail('status', '값은 sent 또는 canceled 여야 해요.');
        $now = self::now($now);
        if (Db::exec("UPDATE allot_notices SET status = ?, sent_at = ? WHERE id = ? AND status = 'queued'", [$status, $status === 'sent' ? $now : 0, $id]) !== 1) {
            throw new ApiException(409, 'NOT_QUEUED', '기다리는 알림이 아니에요.');
        }
        Audit::log('allot_notice_done', null, ['notice' => $id, 'status' => $status], 'info', self::idOrNull($actor));
    }

    // ------------------------------------------------------------------ CSV (RFC 4180; PHP 7.2's fputcsv / fgetcsv are not used)
    /** the UTF-8 byte order mark Excel needs to read Korean text */
    public static function csvBom(): string { return "\xEF\xBB\xBF"; }

    /**
     * One cell. Formula guard: a value that starts with = + - @ TAB or CR gets an apostrophe in front, so a spreadsheet
     * shows it as text instead of running it. Cells with a quote, a comma, a line break or outer spaces are quoted.
     */
    public static function csvCell($v): string
    {
        if ($v === null) return '';
        if (is_int($v)) return (string) $v; // [verify-allot] a number stays a number (a negative amount is not a formula)
        $s = is_bool($v) ? ($v ? '1' : '0') : (string) $v;
        if ($s === '') return '';
        // [verify-allot] also after leading blanks / line breaks: spreadsheets trim them before they look for a formula
        if (strpos("=+-@\t\r", $s[0]) !== false || preg_match('/^[ \t\r\n]+[=+\-@]/', $s)) $s = "'" . $s;
        if (strpbrk($s, "\",\r\n") !== false || $s[0] === ' ' || substr($s, -1) === ' ') return '"' . str_replace('"', '""', $s) . '"';
        return $s;
    }

    /** one line ending in CRLF */
    public static function csvLine(array $cells): string
    {
        $out = [];
        foreach ($cells as $c) $out[] = self::csvCell($c);
        return implode(',', $out) . "\r\n";
    }

    /**
     * Rows of a CSV text: BOM removed, UTF-8 (a file that is not valid UTF-8 is read as CP949, what Korean Excel writes),
     * delimiter comma / tab / semicolon (taken from the first line), CRLF / LF / CR line ends, quoted cells with "" and
     * line breaks inside. Empty lines are skipped. @return array[] at most $maxRows rows
     */
    public static function csvParse(string $csv, int $maxRows = 50000): array
    {
        if (strncmp($csv, "\xEF\xBB\xBF", 3) === 0) $csv = (string) substr($csv, 3);
        if (!mb_check_encoding($csv, 'UTF-8')) $csv = (string) mb_convert_encoding($csv, 'UTF-8', 'CP949');
        $n = strlen($csv);
        // the delimiter: whichever of , TAB ; is most frequent outside quotes on the first line
        $counts = [',' => 0, "\t" => 0, ';' => 0];
        $q = false;
        for ($i = 0; $i < $n; $i++) {
            $ch = $csv[$i];
            if ($ch === '"') $q = !$q;
            elseif (!$q && ($ch === "\n" || $ch === "\r")) break;
            elseif (!$q && isset($counts[$ch])) $counts[$ch]++;
        }
        $d = ',';
        foreach ($counts as $k => $c) if ($c > $counts[$d]) $d = $k;
        $rows = [];
        $row = [];
        $cell = '';
        $i = 0;
        $quoted = false;   // inside a quoted cell
        $wasQuoted = false; // the current cell had quotes (an empty quoted cell still makes the line non-empty)
        $special = '"' . $d . "\r\n";
        while ($i < $n) {
            if ($quoted) {
                $j = strpos($csv, '"', $i);
                if ($j === false) { $cell .= substr($csv, $i); $i = $n; break; }
                $cell .= substr($csv, $i, $j - $i);
                if ($j + 1 < $n && $csv[$j + 1] === '"') { $cell .= '"'; $i = $j + 2; continue; }
                $quoted = false;
                $i = $j + 1;
                continue;
            }
            $len = strcspn($csv, $special, $i);
            if ($len > 0) { $cell .= substr($csv, $i, $len); $i += $len; if ($i >= $n) break; }
            $ch = $csv[$i];
            if ($ch === '"') {
                if (trim($cell) === '') { $cell = ''; $quoted = true; $wasQuoted = true; } else { $cell .= '"'; } // a quote in the middle of a bare cell is kept
                $i++;
            } elseif ($ch === $d) {
                $row[] = $cell;
                $cell = '';
                $i++;
            } else {
                $row[] = $cell;
                $cell = '';
                if ($ch === "\r" && $i + 1 < $n && $csv[$i + 1] === "\n") $i++;
                $i++;
                if (count($row) > 1 || $row[0] !== '' || $wasQuoted) { $rows[] = $row; if (count($rows) >= $maxRows) return $rows; }
                $row = [];
                $wasQuoted = false;
            }
        }
        if ($cell !== '' || $row) {
            $row[] = $cell;
            if (count($row) > 1 || $row[0] !== '' || $wasQuoted) $rows[] = $row;
        }
        return $rows;
    }

    public const EXPORTS = ['units', 'contracts', 'customers', 'payments', 'waitlist', 'ledger'];
    private const KO_UNIT = ['open' => '빈자리', 'held' => '보류', 'leased' => '분양', 'closed' => '닫힘'];
    private const KO_CONTRACT = ['pending' => '신청', 'active' => '진행', 'overdue' => '연체', 'ended' => '종료', 'canceled' => '취소'];
    private const KO_PERIOD = ['once' => '한번', 'month' => '매달', 'year' => '매년'];
    private const KO_METHOD = ['toss' => '토스', 'bank' => '계좌이체', 'cash' => '현금', 'cms' => '자동이체', 'etc' => '기타'];
    private const KO_PAY = ['created' => '대기', 'paid' => '입금', 'failed' => '실패', 'canceled' => '취소', 'refunded' => '환불함'];
    private const KO_PAYKIND = ['first' => '첫 납부', 'renewal' => '이어서 납부', 'manual' => '기타 입금', 'refund' => '환불'];
    private const KO_WAIT = ['waiting' => '대기', 'offered' => '제안함', 'converted' => '신청함', 'expired' => '기한 지남', 'canceled' => '취소'];

    private static function day(int $ms): string { return $ms > 0 && $ms < self::FOREVER ? date('Y-m-d', intdiv($ms, 1000)) : ''; }
    private static function stamp(int $ms): string { return $ms > 0 ? date('Y-m-d H:i', intdiv($ms, 1000)) : ''; }

    /** the header line of an export (Korean column names; 'ledger' is the operator's own book: 일자 · 성명 · 연락처 · 주소 · 비고 + 단위) */
    public static function exportHeader(string $what, bool $reveal = false): array
    {
        switch ($what) {
            case 'units': return ['단위', '종류', '구역', '순번', '상태', '계약번호', '이름표', '이름표 공개', '보류 기한'];
            case 'contracts': return ['계약번호', '단위', '상태', '납부 주기', '금액', '기간(개월)', '시작일', '종료일', '납부 기한', '낸 금액', '자동 연장', '경로', '성명', '연락처', '신청 일시', '확정 일시', '끝난 일시', '끝난 까닭'];
            case 'customers': return ['고객번호', '성명', '연락처', '주소', '동의 일시', '동의 판', '보호자', '계정 번호', '계약 수'];
            case 'payments': return ['입금번호', '계약번호', '단위', '구분', '방법', '금액', '상태', '입금 일시', '기간 시작', '기간 끝', '비고'];
            case 'waitlist': return ['대기번호', '종류', '구역', '상태', '성명', '연락처', '제안 단위', '제안 기한', '신청 일시'];
            case 'ledger': return ['일자', '성명', '연락처', '주소', '비고', '단위', '계약번호', '상태'];
        }
        throw new ApiException(400, 'INVALID_INPUT', '내보낼 수 없는 종류예요.', ['field' => 'what']);
    }

    /**
     * Rows of an export as plain cells, ascending by id (keyset: pass `next` as $afterId until it is 0). $what: one of
     * EXPORTS. Names and phone numbers are masked ("김**", "***-****-1234") and addresses / customer memos left out unless
     * $reveal — which needs an admin actor and writes the audit row allot_export (what, how many rows, the reason code
     * $why of REVEAL_REASONS; never the data) for every chunk. → ['rows' => [[cell, …], …], 'next' => cursor or 0]
     */
    public static function exportRows(string $what, int $afterId = 0, int $limit = 500, bool $reveal = false, ?array $a = null, string $why = ''): array
    {
        if (!in_array($what, self::EXPORTS, true)) throw new ApiException(400, 'INVALID_INPUT', '내보낼 수 없는 종류예요.', ['field' => 'what']);
        $actor = 0;
        if ($reveal) {
            if ($a === null) throw new ApiException(403, 'FORBIDDEN', '관리자 권한이 필요해요.');
            $actor = self::admin($a);
        }
        $limit = max(1, min(2000, $limit));
        $after = max(0, $afterId);
        $name = function ($enc) use ($reveal) { $n = self::unseal($enc); return $reveal ? $n : self::maskName($n); };
        $phone = function ($enc, $tail) use ($reveal) { return $reveal ? self::fmtPhone(self::unseal($enc)) : self::maskPhone((string) $tail); };
        $out = [];
        $last = 0;
        if ($what === 'units') {
            $rows = Db::all('SELECT u.id, u.code, u.kind, z.code AS zone_code, u.seq, u.status, u.hold_until, u.label, u.label_show, c.contract_no
                FROM allot_units u JOIN allot_zones z ON z.id = u.zone_id LEFT JOIN allot_contracts c ON c.id = u.contract_id WHERE u.id > ? ORDER BY u.id ASC LIMIT ?', [$after, $limit + 1]);
            foreach ($rows as $r) $out[(int) $r['id']] = [$r['code'], self::KIND_NAMES[$r['kind']], $r['zone_code'], (int) $r['seq'], self::KO_UNIT[$r['status']], (string) $r['contract_no'], $r['label'],
                (int) $r['label_show'] === 1 ? '예' : '', self::stamp((int) $r['hold_until'])];
        } elseif ($what === 'contracts' || $what === 'ledger') {
            $rows = Db::all("SELECT c.*, u.code AS unit_code, cu.name_enc, cu.phone_enc, cu.phone_tail, cu.addr_enc, cu.memo AS cu_memo
                FROM allot_contracts c JOIN allot_units u ON u.id = c.unit_id LEFT JOIN allot_customers cu ON cu.id = c.customer_id
                WHERE c.id > ? AND (? = 0 OR c.status IN ('pending', 'active', 'overdue')) ORDER BY c.id ASC LIMIT ?", [$after, $what === 'ledger' ? 1 : 0, $limit + 1]);
            foreach ($rows as $r) {
                if ($what === 'ledger') {
                    $out[(int) $r['id']] = [self::day((int) ((int) $r['starts_at'] > 0 ? $r['starts_at'] : $r['created_at'])), $name($r['name_enc']), $phone($r['phone_enc'], $r['phone_tail']),
                        $reveal ? self::unseal($r['addr_enc']) : '', $reveal ? self::unseal($r['cu_memo']) : '', $r['unit_code'], $r['contract_no'], self::KO_CONTRACT[$r['status']]];
                } else {
                    $out[(int) $r['id']] = [$r['contract_no'], $r['unit_code'], self::KO_CONTRACT[$r['status']], self::KO_PERIOD[$r['period']], (int) $r['price'], (int) $r['term_months'], self::day((int) $r['starts_at']),
                        self::day((int) $r['ends_at']), self::day((int) $r['paid_until']), (int) $r['paid_total'], (int) $r['auto_renew'] === 1 ? '예' : '', $r['source'], $name($r['name_enc']),
                        $phone($r['phone_enc'], $r['phone_tail']), self::stamp((int) $r['created_at']), self::stamp((int) $r['decided_at']), self::stamp((int) $r['ended_at']), in_array((string) $r['status'], self::LIVE, true) ? '' : self::reasonCode((string) $r['end_reason'])];
                }
            }
        } elseif ($what === 'customers') {
            $rows = Db::all('SELECT cu.*, (SELECT COUNT(*) FROM allot_contracts c WHERE c.customer_id = cu.id) AS contracts FROM allot_customers cu WHERE cu.id > ? AND cu.purged_at = 0 ORDER BY cu.id ASC LIMIT ?', [$after, $limit + 1]);
            foreach ($rows as $r) $out[(int) $r['id']] = [(int) $r['id'], $name($r['name_enc']), $phone($r['phone_enc'], $r['phone_tail']), $reveal ? self::unseal($r['addr_enc']) : '', self::stamp((int) $r['consent_at']),
                $r['consent_ver'], (int) $r['guardian'] === 1 ? '예' : '', $r['user_id'] === null ? '' : (int) $r['user_id'], (int) $r['contracts']];
        } elseif ($what === 'payments') {
            $rows = Db::all(self::PAY_SELECT . ' WHERE p.id > ? ORDER BY p.id ASC LIMIT ?', [$after, $limit + 1]);
            foreach ($rows as $r) $out[(int) $r['id']] = [(int) $r['id'], $r['contract_no'], $r['unit_code'], self::KO_PAYKIND[$r['kind']], self::KO_METHOD[$r['method']], (int) $r['amount'], self::KO_PAY[$r['status']],
                self::stamp((int) $r['paid_at']), self::day((int) $r['period_from']), self::day((int) $r['period_to']), $r['memo']];
        } else {
            $rows = Db::all('SELECT w.*, z.code AS zone_code, u.code AS unit_code, cu.name_enc, cu.phone_enc, cu.phone_tail
                FROM allot_waitlist w LEFT JOIN allot_zones z ON z.id = w.zone_id LEFT JOIN allot_units u ON u.id = w.unit_id LEFT JOIN allot_customers cu ON cu.id = w.customer_id
                WHERE w.id > ? ORDER BY w.id ASC LIMIT ?', [$after, $limit + 1]);
            foreach ($rows as $r) $out[(int) $r['id']] = [(int) $r['id'], self::KIND_NAMES[$r['kind']], (string) $r['zone_code'], self::KO_WAIT[$r['status']], $name($r['name_enc']), $phone($r['phone_enc'], $r['phone_tail']),
                (string) $r['unit_code'], self::stamp((int) $r['offer_until']), self::stamp((int) $r['created_at'])];
        }
        $more = count($out) > $limit;
        if ($more) array_pop($out);
        foreach ($out as $id => $unused) $last = $id;
        if ($reveal) Audit::log('allot_export', null, ['what' => $what, 'reveal' => true, 'from' => $after, 'rows' => count($out), 'why' => self::revealReason($why)], 'warn', self::idOrNull($actor));
        return ['rows' => array_values($out), 'next' => $more ? $last : 0];
    }

    /** "2024-03-15", "2024.3.15", "2024/03/15", "20240315", "24.3.15", "2024년 3월 15일" → 00:00 of that day in ms; 0 when it is not a date */
    public static function parseDate(string $s): int
    {
        $s = trim($s);
        // [verify-allot] ASCII digits only: under /u \d also matches full-width and other scripts' digits, which (int) reads as 0
        if (preg_match('/^([0-9]{4})([0-9]{2})([0-9]{2})$/', $s, $m) || preg_match('/^([0-9]{2}|[0-9]{4})\s*[.\-\/년]\s*([0-9]{1,2})\s*[.\-\/월]\s*([0-9]{1,2})\s*[.일]?(?:\s.*)?$/u', $s, $m)) {
            $y = (int) $m[1];
            if ($y < 100) $y += 2000;
            if ($y >= 1990 && $y <= 2200 && checkdate((int) $m[2], (int) $m[3], $y)) return (int) mktime(0, 0, 0, (int) $m[2], (int) $m[3], $y) * 1000;
        }
        return 0;
    }

    /** column names of an import file → field (compared without spaces, case and brackets) */
    private const IMPORT_COLS = [
        'date' => ['일자', '날짜', '신청일', '계약일', '시작일', '입금일', '입금일시', 'date'],
        'name' => ['성명', '이름', '고객명', 'name'],
        'phone' => ['연락처', '전화', '전화번호', '휴대폰', '핸드폰', 'phone', 'tel'],
        'addr' => ['주소', 'address', 'addr'],
        'memo' => ['비고', '메모', 'memo', 'note'],
        'unit' => ['단위', '단위번호', '번호', '구좌', '구좌번호', '자리', '자리번호', '항아리', '항아리번호', '코드', 'unit', 'code'],
        'paid' => ['납부기한', '납부일', 'paiduntil'],
        'contract' => ['계약번호', 'contract', 'contractno'],
        'amount' => ['금액', '입금액', 'amount'],
        'method' => ['방법', '입금방법', '결제방법', 'method'],
    ];

    /** header cells → [field => column index] */
    private static function importColumns(array $header): array
    {
        $map = [];
        foreach ($header as $i => $h) {
            $k = mb_strtolower((string) preg_replace('/[\s()\[\]·_\-]+/u', '', (string) $h));
            foreach (self::IMPORT_COLS as $field => $names) {
                if (!in_array($k, $names, true)) continue;
                // [verify-allot] a column named twice is ambiguous (which 성명 is the person?): the file is refused as a whole
                if (isset($map[$field])) V::fail('csv', '첫 줄에 ‘' . $names[0] . '’ 열이 두 번 있어요. 하나만 남겨 주세요.');
                $map[$field] = $i;
                break;
            }
        }
        return $map;
    }

    /** a cell of an import row (an apostrophe our own export put in front of = + - @ is taken off again) */
    private static function importCell(array $row, array $cols, string $field): string
    {
        if (!isset($cols[$field]) || !isset($row[$cols[$field]])) return '';
        $v = trim((string) $row[$cols[$field]]);
        if (strlen($v) > 1 && $v[0] === "'" && strpos('=+-@', $v[1]) !== false) $v = substr($v, 1);
        return $v;
    }

    /**
     * Import a CSV text. $what = 'ledger': the operator's existing book — columns 일자 · 성명 · 연락처 · 주소 · 비고 and a unit
     * column (단위 / 번호 / 구좌 …: a unit code such as J01-0012, or a zone code such as J01 = "the next free unit of that
     * zone"); each row becomes a customer (an operator-entered one with the same phone + name is used again; customers of
     * app accounts are never matched — see linkCustomer) and an ACTIVE contract (source import) that starts on 일자. $what = 'payments': 계약번호 (or 단위) · 금액 · 일자 · 방법 · 비고 — each row is recorded like recordPayment() with
     * an idempotency key made from the row, so the same file can be imported twice without paying twice.
     * $dryRun (the default) changes nothing and reports every row; a real run imports only when NO row has a problem
     * (all or nothing). The report never contains a whole name or phone number.
     * → {ok, dryRun, what, total, valid, invalid, skipped, created: {customers, contracts, payments}, columns, rows:
     *    [{line, ok, action: new | existing | duplicate | payment | problem, unit, who, problems: […]}] (≤ 1000 rows; rows
     *    with problems first)}. 400 INVALID_INPUT for a file without the needed columns / more than 20,000 rows.
     */
    public static function importCsv(array $a, string $what, string $csv, bool $dryRun = true, ?int $now = null): array
    {
        $actor = self::admin($a);
        if (!in_array($what, ['ledger', 'payments'], true)) V::fail('what', '값은 ledger 또는 payments 여야 해요.');
        if (strlen($csv) > 8 * 1024 * 1024) V::fail('csv', '파일이 너무 커요. (최대 8 MB)');
        $now = self::now($now);
        $rows = self::csvParse($csv, 20002);
        if (count($rows) > 20001) V::fail('csv', '한 번에 20,000줄까지 가져올 수 있어요. 파일을 나눠 주세요.');
        if (count($rows) < 1) V::fail('csv', '빈 파일이에요.');
        $cols = self::importColumns($rows[0]);
        $need = $what === 'ledger' ? ['name', 'phone', 'unit'] : ['amount'];
        foreach ($need as $f) if (!isset($cols[$f])) V::fail('csv', '첫 줄에 ‘' . self::IMPORT_COLS[$f][0] . '’ 열이 없어요.');
        if ($what === 'payments' && !isset($cols['contract']) && !isset($cols['unit'])) V::fail('csv', '첫 줄에 ‘계약번호’ 또는 ‘단위’ 열이 없어요.');
        $plan = $what === 'ledger' ? self::planLedger($rows, $cols, $now) : self::planPayments($rows, $cols, $now);
        $report = $plan['report'];
        $invalid = 0; $valid = 0; $skipped = 0;
        foreach ($report as $r) { if (!$r['ok']) $invalid++; elseif ($r['action'] === 'duplicate') $skipped++; else $valid++; }
        $created = ['customers' => 0, 'contracts' => 0, 'payments' => 0];
        $done = false;
        if (!$dryRun && $invalid === 0) {
            $created = $what === 'ledger' ? self::commitLedger($plan['todo'], $actor, $now) : self::commitPayments($plan['todo'], $a, $now);
            $done = true;
            Audit::log('allot_import', null, ['what' => $what, 'rows' => count($report), 'created' => $created, 'skipped' => $skipped], 'warn', self::idOrNull($actor));
        }
        usort($report, function ($x, $y) { return $x['ok'] === $y['ok'] ? $x['line'] - $y['line'] : ($x['ok'] ? 1 : -1); });
        return ['ok' => $invalid === 0, 'dryRun' => !$done, 'what' => $what, 'total' => count($report), 'valid' => $valid, 'invalid' => $invalid, 'skipped' => $skipped, 'created' => $created,
            'columns' => array_keys($cols), 'rows' => array_slice($report, 0, 1000)];
    }

    /** look at every ledger row: what would be made, what is wrong (nothing is written) */
    private static function planLedger(array $rows, array $cols, int $now): array
    {
        $report = [];
        $todo = [];
        $usedUnits = [];
        $matched = [];   // contracts already recognised as an earlier import of a row of this file
        $free = [];      // zone id → free units [id, code] in seq order (taken from the front as rows claim them)
        $zoneByCode = [];
        foreach (Db::all('SELECT id, code, price, period, term_months FROM allot_zones') as $z) $zoneByCode[(string) $z['code']] = $z;
        for ($i = 1, $n = count($rows); $i < $n; $i++) {
            $row = $rows[$i];
            $line = $i + 1;
            $p = [];
            $name = Users::cleanText(self::importCell($row, $cols, 'name'), 60);
            if ($name === '' || !preg_match('/\p{L}/u', $name)) $p[] = '이름이 비어 있어요';
            elseif (mb_strlen($name) > 40) $p[] = '이름이 너무 길어요 (40자까지)';
            $rawPhone = self::importCell($row, $cols, 'phone');
            $phone = self::normPhone($rawPhone);
            if ($phone === '') $p[] = $rawPhone === '' ? '전화번호가 비어 있어요' : (strpbrk($rawPhone, '*xX○●＊') !== false ? '전화번호가 가려져 있어요 (전체 번호가 필요해요)' : '전화번호가 올바르지 않아요');
            $rawDate = self::importCell($row, $cols, 'date');
            $starts = $rawDate === '' ? $now : self::parseDate($rawDate);
            if ($starts === 0) $p[] = '일자를 읽을 수 없어요 (예: 2024-03-15)';
            elseif ($starts > $now + self::DAY) $p[] = '일자가 오늘보다 뒤예요';
            $addr = Users::cleanText(self::importCell($row, $cols, 'addr'), 250);
            if (mb_strlen($addr) > 200) $p[] = '주소가 너무 길어요 (200자까지)';
            $memo = Users::cleanText(self::importCell($row, $cols, 'memo'), 600);
            if (mb_strlen($memo) > 500) $p[] = '비고가 너무 길어요 (500자까지)';
            $rawPaid = self::importCell($row, $cols, 'paid');
            $paid = $rawPaid === '' ? 0 : self::parseDate($rawPaid);
            if ($rawPaid !== '' && $paid === 0) $p[] = '납부 기한을 읽을 수 없어요';
            $ref = strtoupper(self::importCell($row, $cols, 'unit'));
            $unit = null;
            $action = 'new';
            $existing = 0;
            if ($phone !== '' && $name !== '') {
                // only customers the operator entered / imported are matched: a row that belongs to an app account carries a name and
                // a phone number its holder typed — matching it would hand this contract to whoever typed someone else's details
                $e = Db::value('SELECT id FROM allot_customers WHERE phone_hash = ? AND name_hash = ? AND purged_at = 0 AND user_id IS NULL ORDER BY id ASC LIMIT 1', [self::phoneHash($phone), self::nameHash($name)]);
                if ($e !== null) { $existing = (int) $e; $action = 'existing'; }
            }
            if ($ref === '') {
                $p[] = '단위 번호가 비어 있어요';
            } elseif (self::unitCode($ref) !== '') {
                $u = Db::one('SELECT id, zone_id, code, status, contract_id FROM allot_units WHERE code = ?', [$ref]);
                if (!$u) $p[] = '없는 단위 번호예요';
                elseif (isset($usedUnits[(int) $u['id']])) $p[] = '이 파일의 ' . $usedUnits[(int) $u['id']] . '번째 줄과 같은 단위예요';
                elseif ((string) $u['status'] !== 'open') {
                    $same = $existing > 0 && $u['contract_id'] !== null && (int) Db::value('SELECT customer_id FROM allot_contracts WHERE id = ?', [(int) $u['contract_id']]) === $existing;
                    if ($same) $action = 'duplicate'; else $p[] = '이미 쓰고 있거나 닫아 둔 단위예요';
                    $unit = $u;
                } else $unit = $u;
            } elseif (isset($zoneByCode[$ref])) {
                $zid = (int) $zoneByCode[$ref]['id'];
                // "the next free unit of the zone" cannot be recognised by its unit the second time the same file comes in:
                // the same person with a live contract in this zone that started on the same day is that row, already imported
                $twin = null;
                if ($existing > 0 && $starts > 0) {
                    foreach (Db::all("SELECT c.id, u.code FROM allot_contracts c JOIN allot_units u ON u.id = c.unit_id WHERE c.customer_id = ? AND u.zone_id = ? AND c.starts_at = ? AND c.status IN ('pending', 'active', 'overdue')
                        ORDER BY c.id ASC", [$existing, $zid, $starts]) as $t) {
                        if (!isset($matched[(int) $t['id']])) { $twin = $t; break; }
                    }
                }
                if ($twin) {
                    $matched[(int) $twin['id']] = true;
                    $action = 'duplicate';
                    $unit = ['id' => 0, 'zone_id' => $zid, 'code' => (string) $twin['code']];
                } else {
                    if (!isset($free[$zid])) $free[$zid] = Db::all("SELECT id, zone_id, code, status, contract_id FROM allot_units WHERE zone_id = ? AND status = 'open' ORDER BY seq ASC", [$zid]);
                    while ($free[$zid] && isset($usedUnits[(int) $free[$zid][0]['id']])) array_shift($free[$zid]);
                    if (!$free[$zid]) $p[] = '이 구역에 빈 자리가 없어요';
                    elseif (!$p) $unit = array_shift($free[$zid]); // a row with a problem does not use up a free unit
                }
            } else {
                $p[] = '단위 번호를 알아볼 수 없어요 (예: J01-0012 또는 구역 번호 J01)';
            }
            if ($unit && !$p && $action !== 'duplicate') $usedUnits[(int) $unit['id']] = $line;
            $ok = !$p;
            $report[] = ['line' => $line, 'ok' => $ok, 'action' => $ok ? $action : 'problem', 'unit' => $unit ? (string) $unit['code'] : $ref,
                'who' => self::maskName($name) . ($phone !== '' ? ' · ' . substr($phone, -4) : ''), 'problems' => $p];
            if ($ok && $action !== 'duplicate') $todo[] = ['line' => $line, 'name' => $name, 'phone' => $phone, 'addr' => $addr, 'memo' => $memo, 'starts' => $starts, 'paid' => $paid, 'unit' => $unit, 'customer' => $existing];
        }
        return ['report' => $report, 'todo' => $todo];
    }

    /** write the planned ledger rows in one transaction (a unit that was taken meanwhile undoes the whole import) */
    private static function commitLedger(array $todo, int $actor, int $now): array
    {
        return Db::txRetry(function () use ($todo, $actor, $now) {
            $made = ['customers' => 0, 'contracts' => 0, 'payments' => 0];
            $byKey = [];
            $zones = [];
            $plans = [];
            foreach ($todo as $t) {
                $key = self::phoneHash($t['phone']) . ':' . self::nameHash($t['name']);
                $cid = $t['customer'] > 0 ? $t['customer'] : (isset($byKey[$key]) ? $byKey[$key] : 0);
                if ($cid === 0) {
                    $cid = Db::insert('allot_customers', [
                        'user_id' => null, 'name_enc' => self::seal($t['name']), 'phone_enc' => self::seal($t['phone']), 'phone_hash' => self::phoneHash($t['phone']), 'phone_tail' => substr($t['phone'], -4),
                        'name_hash' => self::nameHash($t['name']), 'addr_enc' => $t['addr'] === '' ? null : self::seal($t['addr']), 'memo' => $t['memo'] === '' ? null : self::seal($t['memo']),
                        'consent_at' => 0, 'consent_ver' => 'import', 'guardian' => 0, 'purged_at' => 0, 'created_at' => $now, 'updated_at' => $now,
                    ]);
                    $made['customers']++;
                }
                $byKey[$key] = $cid;
                $zid = (int) $t['unit']['zone_id'];
                if (!isset($plans[$zid])) $plans[$zid] = self::zonePlan($zid);
                $z = $plans[$zid];
                $term = (int) $z['term_months'];
                $starts = (int) $t['starts'];
                $ends = $term > 0 ? self::addMonths($starts, $term) : 0;
                // a row of the running book is a contract that is running today: an old 일자 means it was renewed term after
                // term, so the end is the end of the term that is running now (never a date in the past)
                for ($k = 0; $term > 0 && $ends <= $now && $k < 600; $k++) $ends = self::addMonthsFrom($ends, $term, $starts);
                $paid = (int) $t['paid'];
                if ($paid === 0) {
                    // nothing is known about old payments: the book counts as paid up to the period that is running now
                    $paid = self::paidUntilFor((string) $z['period'], (int) $z['price'], $term, $starts, $ends, 1);
                    $step = (string) $z['period'] === 'year' ? 12 : 1;
                    for ($k = 0; (string) $z['period'] !== 'once' && (int) $z['price'] > 0 && $paid <= $now && $k < 600; $k++) $paid = self::addMonthsFrom($paid, $step, $starts);
                }
                $unitId = (int) $t['unit']['id'];
                list($conId, ) = self::insertContract([
                    'unit_id' => $unitId, 'live_unit_id' => $unitId, 'customer_id' => $cid, 'user_id' => null, 'status' => 'active', 'period' => (string) $z['period'], 'price' => (int) $z['price'],
                    'term_months' => $term, 'starts_at' => $starts, 'ends_at' => $ends, 'paid_until' => $paid, 'paid_total' => 0, 'auto_renew' => 0, 'source' => 'import', 'memo' => null,
                    'created_by' => self::idOrNull($actor), 'decided_by' => self::idOrNull($actor), 'decided_at' => $now, 'cancel_req_at' => 0, 'due_stage' => 999, 'end_stage' => 999, 'ended_at' => 0,
                    'end_reason' => '', 'created_at' => $now, 'updated_at' => $now,
                ]);
                if (!self::unitCas($unitId, 'open', 'leased', $conId, 0, $now, 'free')) {
                    throw new ApiException(409, 'UNIT_TAKEN', $t['line'] . '번째 줄의 자리(' . $t['unit']['code'] . ')를 방금 다른 곳에서 썼어요. 아무것도 가져오지 않았어요. 다시 미리 보기를 해 주세요.');
                }
                $zones[$zid] = true;
                $made['contracts']++;
            }
            foreach (array_keys($zones) as $zid) self::bumpZone((int) $zid, $now);
            return $made;
        });
    }

    /** look at every payment row (nothing is written) */
    private static function planPayments(array $rows, array $cols, int $now): array
    {
        $report = [];
        $todo = [];
        $seen = [];
        $methods = ['계좌이체' => 'bank', '무통장' => 'bank', '무통장입금' => 'bank', '이체' => 'bank', 'bank' => 'bank', '현금' => 'cash', 'cash' => 'cash', '자동이체' => 'cms', 'cms' => 'cms', '기타' => 'etc', 'etc' => 'etc', '' => 'bank'];
        for ($i = 1, $n = count($rows); $i < $n; $i++) {
            $row = $rows[$i];
            $line = $i + 1;
            $p = [];
            $c = null;
            $no = self::contractNo(self::importCell($row, $cols, 'contract'));
            $code = self::unitCode(self::importCell($row, $cols, 'unit'));
            if ($no !== '') $c = Db::one('SELECT c.id, c.contract_no, c.status, u.code AS unit_code FROM allot_contracts c JOIN allot_units u ON u.id = c.unit_id WHERE c.contract_no = ?', [$no]);
            elseif ($code !== '') $c = Db::one('SELECT c.id, c.contract_no, c.status, u.code AS unit_code FROM allot_contracts c JOIN allot_units u ON u.id = c.unit_id WHERE c.live_unit_id = u.id AND u.code = ?', [$code]);
            if (!$c) $p[] = '계약을 찾을 수 없어요 (계약번호 또는 쓰고 있는 단위 번호)';
            elseif (!in_array((string) $c['status'], self::LIVE, true)) $p[] = '이미 끝난 계약이에요';
            $rawAmount = (string) preg_replace('/[\s,원₩]/u', '', self::importCell($row, $cols, 'amount'));
            $amount = preg_match('/^[1-9]\d{0,7}$/', $rawAmount) ? (int) $rawAmount : 0;
            if ($amount < 1 || $amount > self::MAX_AMOUNT) $p[] = '금액을 읽을 수 없어요';
            $rawDate = self::importCell($row, $cols, 'date');
            $at = $rawDate === '' ? $now : self::parseDate($rawDate);
            if ($at === 0) $p[] = '일자를 읽을 수 없어요 (예: 2026-03-25)';
            elseif ($at > $now + self::DAY) $p[] = '일자가 오늘보다 뒤예요';
            $mk = mb_strtolower((string) preg_replace('/\s+/u', '', self::importCell($row, $cols, 'method')));
            if (!isset($methods[$mk])) $p[] = '입금 방법을 알아볼 수 없어요 (계좌이체 · 현금 · 자동이체 · 기타)';
            $memo = Users::cleanText(self::importCell($row, $cols, 'memo'), 200);
            $action = 'payment';
            $idem = '';
            if (!$p) {
                $base = $c['id'] . '|' . date('Y-m-d', intdiv($at, 1000)) . '|' . $amount;
                $seen[$base] = isset($seen[$base]) ? $seen[$base] + 1 : 1; // the same amount twice on one day: the 2nd row is its own payment
                $idem = 'imp:' . substr(hash('sha256', $base . '|' . $seen[$base]), 0, 40);
                if (Db::value('SELECT id FROM allot_payments WHERE idem = ?', [$idem]) !== null) $action = 'duplicate';
            }
            $ok = !$p;
            $report[] = ['line' => $line, 'ok' => $ok, 'action' => $ok ? $action : 'problem', 'unit' => $c ? (string) $c['unit_code'] : $code, 'who' => $c ? (string) $c['contract_no'] : '', 'problems' => $p];
            if ($ok && $action !== 'duplicate') $todo[] = ['contract' => (int) $c['id'], 'amount' => $amount, 'method' => $methods[$mk], 'idem' => $idem, 'at' => min($at + 12 * 3600000, $now), 'memo' => $memo];
        }
        return ['report' => $report, 'todo' => $todo];
    }

    /** record the planned payments one by one (each with its own idempotency key, so a run that stops half-way can simply be repeated) */
    private static function commitPayments(array $todo, array $a, int $now): array
    {
        $made = ['customers' => 0, 'contracts' => 0, 'payments' => 0];
        foreach ($todo as $t) {
            $r = self::recordPayment($a, $t['contract'], $t['amount'], $t['method'], $t['idem'], ['paidAt' => $t['at'], 'memo' => $t['memo']], $now);
            if (!$r['duplicate']) $made['payments']++;
        }
        return $made;
    }

    // ------------------------------------------------------------------ automation
    /** @var callable|null replaces mail() for the daily report (tests): fn(string $to, string $subject, string $body): bool */
    private static $mailer = null;

    public static function setMailer(?callable $fn): void { self::$mailer = $fn; }

    /** remember when the automation last started (the lazy tick looks at this) */
    private static function tickMark(int $now): void
    {
        Db::upsert('settings', ['k' => 'allot.tick_at', 'v' => (string) $now, 'updated_at' => $now, 'updated_by' => null], ['k']);
        self::cacheSet('tick', $now, 3600);
    }

    /** the moment the automation last started (0 = never) */
    public static function lastTickAt(): int
    {
        $v = Db::value("SELECT v FROM settings WHERE k = 'allot.tick_at'");
        return $v === null ? 0 : (int) $v;
    }

    /**
     * The lazy tick (for a server without the scheduler line): call it from an allot endpoint or an admin page view. It
     * runs one bounded tick('lazy') when no automation started within lazy_tick_minutes — and only in the ONE request
     * that wins the compare-and-set on the stored start time (the row changes from the old time to the new one, so
     * exactly one UPDATE counts on both drivers; the very first run is an INSERT that only one request can make).
     * Never throws; false = nothing to do / another request took it / allotment is switched off.
     */
    public static function lazyTick(?int $now = null): bool
    {
        try {
            if (!self::enabled()) return false;
            $now = self::now($now);
            $every = (int) self::conf('lazy_tick_minutes') * 60000;
            $seen = self::cacheGet('tick');
            // [verify-allot] a stamp from the future (a clock that was wrong for a while) freezes nothing: up to one interval
            // ahead is clock skew between servers, more than that is stale and is taken over below
            if (is_int($seen) && $now - $seen < $every && $seen - $now <= $every) return false;
            $old = Db::value("SELECT v FROM settings WHERE k = 'allot.tick_at'");
            if ($old === null) {
                try {
                    Db::insert('settings', ['k' => 'allot.tick_at', 'v' => (string) $now, 'updated_at' => $now, 'updated_by' => null]);
                } catch (\PDOException $e) {
                    if ((string) $e->getCode() === '23000') return false;
                    throw $e;
                }
            } else {
                if ($now - (int) $old < $every && (int) $old - $now <= $every) { self::cacheSet('tick', (int) $old, 60); return false; }
                if (Db::exec("UPDATE settings SET v = ?, updated_at = ? WHERE k = 'allot.tick_at' AND v = ?", [(string) $now, $now, (string) $old]) !== 1) return false;
            }
            self::cacheSet('tick', $now, 3600);
            self::tick($now, 'lazy');
            return true;
        } catch (\Throwable $e) {
            Log::error('ALLOT', 'lazy tick failed: ' . get_class($e));
            return false;
        }
    }

    /**
     * The automation (`php cli/tfm.php allot:tick`, the admin button, the lazy tick). Idempotent: a second run at the same
     * moment changes nothing. Every step handles at most tick_batch rows (a lazy run at most 200), oldest first; `more`
     * says a step filled its batch, so run again. Steps, in this order:
     *   holds    waiting-list offers whose time is over go to the next in line · an unpaid application nobody approved
     *            within hold_hours is canceled and its unit freed (never one with a recorded payment: paidPending counts
     *            those) · an operator hold with an end time is released
     *   approved pending applications approved by rule (auto_approve = always, or on_payment when a period is covered / free)
     *   renewed  contracts with auto-renew whose term is over get one more term
     *   notices  "time to pay" (kind due) and "the term ends" (kind ending) at notice_days before the date — one per stage,
     *            only the most urgent stage, never an amount in the text (monthly dues skip stages of 28 days or more)
     *   overdue  active contracts unpaid for grace_days after the paid-until date become 'overdue' (+ one notice)
     *   ended    ONLY when overdue_end_days > 0: a contract overdue that long is ended and its unit freed. With the
     *            default 0 a real jar is never released by a timer — the operator ends contracts by hand
     *   offers   free units are offered to those who wait, first come first
     *   sent     queued notices that are due are delivered to the in-app inbox
     *   stats    today's row of allot_stats_daily per zone and for all zones
     *   healed   the integrity scan: safe mismatches between units and contracts are repaired, the rest is listed in issues
     *   purged   personal data of customers whose last contract ended more than retention_days ago is erased
     * Then one job_runs row is written and, with daily_report_mail, one mail a day with the numbers goes to
     * security.alert_email. → {ok, at, source, more, ms, steps: {…}, paidPending, issues: [{kind, ref, note}], errors, mail}
     */
    public static function tick(?int $now = null, string $source = 'cli'): array
    {
        if (!in_array($source, ['cli', 'lazy', 'admin'], true)) $source = 'cli';
        $now = self::now($now);
        $t0 = microtime(true);
        $batch = (int) self::conf('tick_batch');
        if ($source === 'lazy') $batch = min($batch, 200);
        $out = ['ok' => true, 'at' => $now, 'source' => $source, 'more' => false, 'ms' => 0,
            'steps' => ['holds' => 0, 'approved' => 0, 'renewed' => 0, 'notices' => 0, 'overdue' => 0, 'ended' => 0, 'offers' => 0, 'sent' => 0, 'stats' => 0, 'healed' => 0, 'purged' => 0],
            'paidPending' => 0, 'issues' => [], 'errors' => [], 'mail' => 'off'];
        if ($source !== 'lazy') self::tickMark($now);
        $started = Clock::ms();
        $runId = Db::insert('job_runs', ['job' => 'allot:tick', 'source' => $source, 'started_at' => $started, 'finished_at' => 0, 'ok' => 0, 'summary' => null]);
        $steps = ['holds' => 'tickHolds', 'approved' => 'tickApprove', 'renewed' => 'tickRenew', 'notices' => 'tickNotices', 'overdue' => 'tickOverdue', 'ended' => 'tickAutoEnd', 'offers' => 'tickOffers',
            'sent' => 'tickSend', 'stats' => 'tickStats', 'healed' => 'tickIntegrity', 'purged' => 'tickPurge'];
        foreach ($steps as $key => $fn) {
            try {
                $n = (int) self::$fn($now, $batch, $out);
                $out['steps'][$key] = $n;
                if ($n >= $batch && $key !== 'stats') $out['more'] = true;
            } catch (\Throwable $e) {
                $out['ok'] = false;
                $out['errors'][] = $key . ': ' . get_class($e);
                Log::error('ALLOT', 'tick step failed', ['step' => $key, 'error' => get_class($e), 'at' => basename($e->getFile()) . ':' . $e->getLine()]);
            }
        }
        try { $out['mail'] = self::dailyMail($now, $out); } catch (\Throwable $e) { $out['mail'] = 'failed'; }
        $out['ms'] = (int) round((microtime(true) - $t0) * 1000);
        $sum = $out;
        $sum['issues'] = array_slice($out['issues'], 0, 20);
        Db::exec('UPDATE job_runs SET finished_at = ?, ok = ?, summary = ? WHERE id = ?', [max($started, Clock::ms()), $out['ok'] ? 1 : 0,
            (string) json_encode($sum, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PARTIAL_OUTPUT_ON_ERROR), $runId]);
        self::$memo = [];
        return $out;
    }

    /** the automation history, newest first: [{id, job, source, startedAt, finishedAt, ok, summary}] */
    public static function jobRuns(int $limit = 20, string $job = 'allot:tick'): array
    {
        return array_map(function ($r) {
            $s = is_string($r['summary']) ? Json::tryDecode($r['summary'], true) : null;
            return ['id' => (int) $r['id'], 'job' => (string) $r['job'], 'source' => (string) $r['source'], 'startedAt' => (int) $r['started_at'], 'finishedAt' => (int) $r['finished_at'], 'ok' => (int) $r['ok'] === 1,
                'summary' => is_array($s) ? $s : []];
        }, Db::all('SELECT id, job, source, started_at, finished_at, ok, summary FROM job_runs WHERE job = ? ORDER BY id DESC LIMIT ?', [$job, max(1, min(200, $limit))]));
    }

    /** step 1 — holds that ran out */
    private static function tickHolds(int $now, int $batch, array &$out): int
    {
        $n = 0;
        // (a) waiting-list offers nobody confirmed in time
        foreach (Db::all("SELECT id FROM allot_waitlist WHERE status = 'offered' AND offer_until > 0 AND offer_until < ? ORDER BY offer_until ASC, id ASC LIMIT ?", [$now, $batch]) as $r) {
            $res = Db::txRetry(function () use ($r, $now) {
                $w = Db::one("SELECT * FROM allot_waitlist WHERE id = ? AND status = 'offered'" . Db::forUpdate(), [(int) $r['id']]);
                if (!$w || (int) $w['offer_until'] >= $now) return null;
                $unit = self::waitClose($w, 'expired', $now);
                self::note($now, null, (int) $w['customer_id'], $w['user_id'] === null ? null : (int) $w['user_id'], 'offer_expired', '자리 확정 기한이 지났어요',
                    '기한 안에 확정하지 않아 다음 분께 차례가 넘어갔어요. 다시 기다리려면 대기 신청을 해 주세요.', 'offerexp:' . $w['id']);
                return $unit;
            });
            if ($res === null) continue;
            $n++;
            self::offerQuietly((int) $res, $now);
        }
        // (b) applications without any payment that nobody approved within hold_hours
        if ($n < $batch) {
            foreach (Db::all("SELECT c.id FROM allot_contracts c JOIN allot_units u ON u.id = c.unit_id
                WHERE c.status = 'pending' AND c.paid_total = 0 AND u.contract_id = c.id AND u.hold_until > 0 AND u.hold_until < ? ORDER BY u.hold_until ASC, c.id ASC LIMIT ?", [$now, $batch - $n]) as $r) {
                $unit = Db::txRetry(function () use ($r, $now) {
                    $c = self::lockContract((int) $r['id']);
                    if ((string) $c['status'] !== 'pending' || (int) $c['paid_total'] > 0) return null;
                    $hold = (int) Db::value('SELECT hold_until FROM allot_units WHERE id = ? AND contract_id = ?', [(int) $c['unit_id'], (int) $c['id']]);
                    if ($hold <= 0 || $hold >= $now) return null;
                    return self::closeLocked($c, 'canceled', 'hold_expired', null, $now, 'hold_expired', '신청이 자동으로 취소되었어요',
                        '{unit} 자리 신청이 기한 안에 확정되지 않아 취소되었어요. 이미 입금하셨다면 운영자에게 알려 주세요.');
                });
                if ($unit === null) continue;
                $n++;
                self::offerQuietly((int) $unit, $now);
            }
        }
        $out['paidPending'] = (int) Db::value("SELECT COUNT(*) FROM allot_contracts c JOIN allot_units u ON u.id = c.unit_id WHERE c.status = 'pending' AND c.paid_total > 0 AND u.hold_until > 0 AND u.hold_until < ?", [$now]);
        // (c) operator holds with an end time (an offered unit belongs to (a))
        if ($n < $batch) {
            foreach (Db::all("SELECT id, zone_id FROM allot_units WHERE status = 'held' AND contract_id IS NULL AND hold_until > 0 AND hold_until < ?
                AND NOT EXISTS (SELECT 1 FROM allot_waitlist w WHERE w.unit_id = allot_units.id AND w.status = 'offered') ORDER BY hold_until ASC, id ASC LIMIT ?", [$now, $batch - $n]) as $u) {
                $freed = Db::txRetry(function () use ($u, $now) {
                    Db::one('SELECT id FROM allot_units WHERE id = ?' . Db::forUpdate(), [(int) $u['id']]);
                    if (!self::unitCas((int) $u['id'], 'held', 'open', null, 0, $now, 'free')) return false;
                    self::bumpZone((int) $u['zone_id'], $now);
                    return true;
                });
                if (!$freed) continue;
                $n++;
                self::offerQuietly((int) $u['id'], $now);
            }
        }
        return $n;
    }

    /** step 2 — approval by rule */
    private static function tickApprove(int $now, int $batch, array &$out): int
    {
        $mode = (string) self::conf('auto_approve');
        if ($mode === 'off') return 0;
        $rows = $mode === 'always'
            ? Db::all("SELECT id FROM allot_contracts WHERE status = 'pending' ORDER BY id ASC LIMIT ?", [$batch])
            : Db::all("SELECT id FROM allot_contracts WHERE status = 'pending' AND (paid_total > 0 OR price = 0) ORDER BY id ASC LIMIT ?", [$batch]);
        $n = 0;
        foreach ($rows as $r) {
            $done = Db::txRetry(function () use ($r, $mode, $now) {
                $c = self::lockContract((int) $r['id']);
                if ((string) $c['status'] !== 'pending') return false;
                if ($mode === 'always') { self::approveLocked($c, null, $now, ''); return true; }
                return self::approveIfPaid((int) $c['id'], null, $now);
            });
            if ($done) $n++;
        }
        return $n;
    }

    /** step 3 — contracts with auto-renew whose term is over */
    private static function tickRenew(int $now, int $batch, array &$out): int
    {
        $n = 0;
        foreach (Db::all("SELECT id FROM allot_contracts WHERE status IN ('active', 'overdue') AND auto_renew = 1 AND ends_at > 0 AND ends_at <= ? ORDER BY ends_at ASC, id ASC LIMIT ?", [$now, $batch]) as $r) {
            $done = Db::txRetry(function () use ($r, $now) {
                $c = self::lockContract((int) $r['id']);
                if (!in_array((string) $c['status'], ['active', 'overdue'], true) || (int) $c['auto_renew'] !== 1 || (int) $c['ends_at'] <= 0 || (int) $c['ends_at'] > $now || (int) $c['term_months'] < 1) return false;
                self::renewLocked($c, 1, null, $now, 'auto');
                return true;
            });
            if ($done) $n++;
        }
        return $n;
    }

    /** step 4 — reminders. A contract is at one stage at a time (the smallest notice day that covers what is left), so there is never a burst. */
    private static function tickNotices(int $now, int $batch, array &$out): int
    {
        $days = (array) self::conf('notice_days');
        sort($days);
        $n = 0;
        $prev = null;
        foreach ($days as $d) {
            $d = (int) $d;
            if ($n >= $batch) break;
            // [verify-allot] each stage has its own window: a date inside the window of a MORE urgent stage belongs to that
            // stage only (it may still be waiting there because its page was full, or another tick is on it right now) —
            // otherwise a past-due contract got "7 days" and then "today" again: two reminders for one due date
            $low = $prev === null ? 0 : $now + $prev * self::DAY;
            $prev = $d;
            // time to pay — not for a contract that is paid to the end of its term (that one gets "the term ends")
            $lim = $batch - $n;
            $rows = Db::all("SELECT * FROM allot_contracts WHERE status = 'active' AND price > 0 AND paid_until > ? AND paid_until <= ? AND paid_until < ? AND due_stage > ?
                AND (period <> 'month' OR ? < 28) AND (ends_at = 0 OR paid_until < ends_at OR auto_renew = 1) ORDER BY paid_until ASC, id ASC LIMIT ?", [$low, $now + $d * self::DAY, self::FOREVER, $d, $d, $lim]);
            if (count($rows) >= $lim) $out['more'] = true; // a full page: more is waiting even when other runs took some of these rows
            foreach ($rows as $c) {
                // [verify-allot] the stage and its notice in one transaction: a crash between them never loses the notice
                if (Db::tx(function () use ($c, $d, $now) {
                    if (Db::exec('UPDATE allot_contracts SET due_stage = ? WHERE id = ? AND due_stage > ?', [$d, (int) $c['id'], $d]) !== 1) return false;
                    $due = (int) $c['paid_until'];
                    $left = (int) ceil(($due - $now) / self::DAY);
                    $code = (string) Db::value('SELECT code FROM allot_units WHERE id = ?', [(int) $c['unit_id']]);
                    $body = $left > 0 ? $code . ' 자리 납부 기한이 ' . $left . '일 남았어요 (' . self::fmtDate($due) . ').' : $code . ' 자리 납부할 때가 되었어요 (' . self::fmtDate($due) . ').';
                    return self::noteContract($c, $now, 'due', $left > 0 ? '납부 기한이 다가와요' : '납부할 때가 되었어요', $body . ' 금액과 방법은 ‘안내’에서 어른과 함께 확인해 주세요.',
                        'due:' . $c['id'] . ':' . date('Ymd', intdiv($due, 1000)) . ':' . $d);
                })) $n++;
            }
            if ($n >= $batch) break;
            // the term ends (contracts that do not renew by themselves)
            $lim = $batch - $n;
            $rows = Db::all("SELECT * FROM allot_contracts WHERE status IN ('active', 'overdue') AND ends_at > ? AND ends_at <= ? AND end_stage > ? AND auto_renew = 0 ORDER BY ends_at ASC, id ASC LIMIT ?",
                [$low, $now + $d * self::DAY, $d, $lim]);
            if (count($rows) >= $lim) $out['more'] = true;
            foreach ($rows as $c) {
                if (Db::tx(function () use ($c, $d, $now) {
                    if (Db::exec('UPDATE allot_contracts SET end_stage = ? WHERE id = ? AND end_stage > ?', [$d, (int) $c['id'], $d]) !== 1) return false;
                    $end = (int) $c['ends_at'];
                    $left = (int) ceil(($end - $now) / self::DAY);
                    $code = (string) Db::value('SELECT code FROM allot_units WHERE id = ?', [(int) $c['unit_id']]);
                    $body = $left > 0 ? $code . ' 자리 분양 기간이 ' . $left . '일 뒤(' . self::fmtDate($end) . ') 끝나요. 이어서 하시려면 운영자에게 알려 주세요.'
                        : $code . ' 자리 분양 기간이 ' . self::fmtDate($end) . ' 로 끝났어요. 이어서 할지 운영자에게 알려 주세요.';
                    return self::noteContract($c, $now, 'ending', $left > 0 ? '분양 기간이 곧 끝나요' : '분양 기간이 끝났어요', $body, 'end:' . $c['id'] . ':' . date('Ymd', intdiv($end, 1000)) . ':' . $d);
                })) $n++;
            }
        }
        return $n;
    }

    /** step 5 — unpaid (or past its term) for grace_days */
    private static function tickOverdue(int $now, int $batch, array &$out): int
    {
        $limit = $now - (int) self::conf('grace_days') * self::DAY;
        $n = 0;
        $rows = Db::all("SELECT * FROM allot_contracts WHERE status = 'active' AND paid_until > 0 AND paid_until < ? ORDER BY paid_until ASC, id ASC LIMIT ?", [$limit, $batch]);
        if (count($rows) >= $batch) $out['more'] = true; // [verify-allot] a full page means more, even when another run took some rows
        foreach ($rows as $c) {
            // [verify-allot] the status and its notice in one transaction (a crash between them never loses the notice)
            $code = Db::tx(function () use ($c, $now) {
                if (Db::exec("UPDATE allot_contracts SET status = 'overdue', updated_at = ? WHERE id = ? AND status = 'active' AND paid_until = ?", [$now, (int) $c['id'], (int) $c['paid_until']]) !== 1) return null;
                $code = (string) Db::value('SELECT code FROM allot_units WHERE id = ?', [(int) $c['unit_id']]);
                $termOver = (int) $c['ends_at'] > 0 && (int) $c['paid_until'] >= (int) $c['ends_at'];
                self::noteContract($c, $now, 'overdue', $termOver ? '분양 기간이 지났어요' : '납부 기한이 지났어요',
                    $code . ($termOver ? ' 자리 분양 기간이 지났어요. 이어서 할지 운영자에게 알려 주세요.' : ' 자리 납부 기한이 지났어요. 운영자에게 연락해 주세요.'), 'overdue:' . $c['id'] . ':' . date('Ymd', intdiv((int) $c['paid_until'], 1000)));
                return $code;
            });
            if ($code === null) continue;
            $n++;
            Audit::log('allot_overdue', $c['user_id'] === null ? null : (int) $c['user_id'], ['contract' => (string) $c['contract_no'], 'unit' => $code]);
        }
        return $n;
    }

    /** step 6 — only when the operator set overdue_end_days above 0 */
    private static function tickAutoEnd(int $now, int $batch, array &$out): int
    {
        $end = (int) self::conf('overdue_end_days');
        if ($end <= 0) return 0;
        $limit = $now - ((int) self::conf('grace_days') + $end) * self::DAY;
        $n = 0;
        foreach (Db::all("SELECT id FROM allot_contracts WHERE status = 'overdue' AND paid_until > 0 AND paid_until < ? ORDER BY paid_until ASC, id ASC LIMIT ?", [$limit, $batch]) as $r) {
            $unit = Db::txRetry(function () use ($r, $limit, $now) {
                $c = self::lockContract((int) $r['id']);
                if ((string) $c['status'] !== 'overdue' || (int) $c['paid_until'] >= $limit) return null;
                return self::closeLocked($c, 'ended', 'overdue_auto', null, $now, 'ended', '분양이 끝났어요', '{unit} 자리 분양이 끝났어요. 납부 기한이 오래 지나 자리를 정리했어요.');
            });
            if ($unit === null) continue;
            $n++;
            self::offerQuietly((int) $unit, $now);
        }
        return $n;
    }

    /** step 7 — free units for those who wait (first come first) */
    private static function tickOffers(int $now, int $batch, array &$out): int
    {
        $n = 0;
        $none = [];   // "kind:zone" targets without a free unit in this run
        $zonesOf = [];
        foreach (Db::all("SELECT id, kind, zone_id FROM allot_waitlist WHERE status = 'waiting' ORDER BY id ASC LIMIT ?", [$batch]) as $w) {
            $key = $w['kind'] . ':' . $w['zone_id'];
            if (isset($none[$key])) continue;
            $unitId = 0;
            if ((int) $w['zone_id'] > 0) {
                $zids = (int) Db::value('SELECT is_open FROM allot_zones WHERE id = ?', [(int) $w['zone_id']]) === 1 ? [(int) $w['zone_id']] : [];
            } else {
                if (!isset($zonesOf[$w['kind']])) $zonesOf[$w['kind']] = array_map(function ($z) { return (int) $z['id']; }, Db::all('SELECT id FROM allot_zones WHERE kind = ? AND is_open = 1 ORDER BY sort ASC, id ASC', [(string) $w['kind']]));
                $zids = $zonesOf[$w['kind']];
            }
            foreach ($zids as $zid) {
                $u = Db::value("SELECT id FROM allot_units WHERE zone_id = ? AND status = 'open' ORDER BY seq ASC LIMIT 1", [$zid]);
                if ($u !== null) { $unitId = (int) $u; break; }
            }
            if ($unitId === 0) { $none[$key] = true; continue; }
            if (self::offerNext($unitId, $now) !== null) $n++;
        }
        return $n;
    }

    /** step 8 — the queue */
    private static function tickSend(int $now, int $batch, array &$out): int { return self::flushNotices($now, $batch); }

    /** step 9 — today's statistics rows → how many rows were written */
    private static function tickStats(int $now, int $batch, array &$out): int
    {
        $day = Clock::day($now);
        $from = (int) strtotime($day . ' 00:00:00') * 1000;
        $to = $from + self::DAY;
        $zero = ['n_open' => 0, 'n_held' => 0, 'n_leased' => 0, 'n_closed' => 0, 'n_pending' => 0, 'n_active' => 0, 'n_overdue' => 0, 'n_ended' => 0, 'revenue' => 0];
        $z = [0 => $zero];
        foreach (Db::all('SELECT id FROM allot_zones') as $r) $z[(int) $r['id']] = $zero;
        foreach (Db::all('SELECT zone_id, status, COUNT(*) AS n FROM allot_units GROUP BY zone_id, status') as $r) {
            if (isset($z[(int) $r['zone_id']]['n_' . $r['status']])) $z[(int) $r['zone_id']]['n_' . $r['status']] = (int) $r['n'];
        }
        foreach (Db::all("SELECT u.zone_id, c.status, COUNT(*) AS n FROM allot_contracts c JOIN allot_units u ON u.id = c.unit_id WHERE c.status IN ('pending', 'active', 'overdue') GROUP BY u.zone_id, c.status") as $r) {
            if (isset($z[(int) $r['zone_id']])) $z[(int) $r['zone_id']]['n_' . $r['status']] = (int) $r['n'];
        }
        foreach (Db::all("SELECT u.zone_id, COUNT(*) AS n FROM allot_contracts c JOIN allot_units u ON u.id = c.unit_id WHERE c.status IN ('ended', 'canceled') AND c.ended_at >= ? AND c.ended_at < ? GROUP BY u.zone_id", [$from, $to]) as $r) {
            if (isset($z[(int) $r['zone_id']])) $z[(int) $r['zone_id']]['n_ended'] = (int) $r['n'];
        }
        // money of the day: what came in (also payments that were given back later) minus what was given back today
        foreach (Db::all("SELECT u.zone_id, SUM(CASE WHEN p.kind = 'refund' THEN -p.amount ELSE p.amount END) AS amount FROM allot_payments p JOIN allot_contracts c ON c.id = p.contract_id JOIN allot_units u ON u.id = c.unit_id
            WHERE p.paid_at >= ? AND p.paid_at < ? AND p.status IN ('paid', 'refunded') GROUP BY u.zone_id", [$from, $to]) as $r) {
            if (isset($z[(int) $r['zone_id']])) $z[(int) $r['zone_id']]['revenue'] = (int) $r['amount'];
        }
        foreach ($z as $zid => $row) {
            if ($zid === 0) continue;
            foreach ($row as $k => $v) $z[0][$k] += $v;
        }
        Db::tx(function () use ($z, $day, $now) {
            foreach ($z as $zid => $row) Db::upsert('allot_stats_daily', ['day' => $day, 'zone_id' => $zid] + $row + ['updated_at' => $now], ['day', 'zone_id']);
        });
        return count($z);
    }

    /** step 10 — the integrity scan with repairs */
    private static function tickIntegrity(int $now, int $batch, array &$out): int
    {
        $r = self::integrity($batch, true, $now);
        $out['issues'] = $r['issues'];
        return $r['healed'];
    }

    /**
     * Compare units and contracts. $heal repairs what has only one right answer and writes the audit row
     * allot_integrity_healed for each repair:
     *   a unit that still points at a contract that ended (or no longer exists) → free
     *   a unit whose state does not match its own live contract (pending ↔ held, active / overdue ↔ leased) → the contract wins
     *   a live contract whose unit is free and points nowhere → the unit is attached again
     *   an ended contract that still claims its unit (live_unit_id) → the claim is dropped
     *   a waiting-list offer for a unit that is not held for it → the row waits again
     * Everything else is only reported (issues: [{kind, ref, note}], at most $limit): leased_without_contract ·
     * unit_conflict · refund_due (a canceled contract with money on it) · capacity_mismatch. → {healed, issues}
     */
    public static function integrity(int $limit = 500, bool $heal = false, ?int $now = null): array
    {
        $now = self::now($now);
        $limit = max(1, min(5000, $limit));
        $healed = 0;
        $issues = [];
        $fix = function (string $kind, string $ref) use (&$healed) {
            $healed++;
            Audit::log('allot_integrity_healed', null, ['kind' => $kind, 'ref' => $ref], 'warn');
        };
        // units that point at a dead or missing contract
        foreach (Db::all("SELECT u.id, u.zone_id, u.code, u.contract_id FROM allot_units u LEFT JOIN allot_contracts c ON c.id = u.contract_id
            WHERE u.contract_id IS NOT NULL AND (c.id IS NULL OR c.status NOT IN ('pending', 'active', 'overdue')) ORDER BY u.id ASC LIMIT ?", [$limit]) as $u) {
            if (!$heal) { $issues[] = ['kind' => 'unit_on_dead_contract', 'ref' => (string) $u['code'], 'note' => '끝난 계약이 자리에 남아 있어요']; continue; }
            Db::tx(function () use ($u, $now) {
                Db::exec("UPDATE allot_units SET status = 'open', contract_id = NULL, hold_until = 0, label = '', label_show = 0, updated_at = ? WHERE id = ? AND contract_id = ?", [$now, (int) $u['id'], (int) $u['contract_id']]);
                self::bumpZone((int) $u['zone_id'], $now);
            });
            $fix('unit_on_dead_contract', (string) $u['code']);
        }
        // ended contracts that still claim a unit
        foreach (Db::all("SELECT id, contract_no FROM allot_contracts WHERE status IN ('ended', 'canceled') AND live_unit_id IS NOT NULL ORDER BY id ASC LIMIT ?", [$limit]) as $c) {
            if (!$heal) { $issues[] = ['kind' => 'dead_contract_claims_unit', 'ref' => (string) $c['contract_no'], 'note' => '끝난 계약이 자리를 잡고 있어요']; continue; }
            Db::exec("UPDATE allot_contracts SET live_unit_id = NULL WHERE id = ? AND status IN ('ended', 'canceled')", [(int) $c['id']]);
            $fix('dead_contract_claims_unit', (string) $c['contract_no']);
        }
        // live contracts and their units
        foreach (Db::all("SELECT c.id, c.contract_no, c.status, c.unit_id, c.live_unit_id, u.id AS uid, u.zone_id, u.code, u.status AS ustatus, u.contract_id
            FROM allot_contracts c LEFT JOIN allot_units u ON u.id = c.unit_id
            WHERE c.status IN ('pending', 'active', 'overdue') AND (u.id IS NULL OR u.contract_id IS NULL OR u.contract_id <> c.id OR c.live_unit_id IS NULL OR c.live_unit_id <> c.unit_id
                OR (c.status = 'pending' AND u.status <> 'held') OR (c.status <> 'pending' AND u.status <> 'leased')) ORDER BY c.id ASC LIMIT ?", [$limit]) as $c) {
            $want = (string) $c['status'] === 'pending' ? 'held' : 'leased';
            $mine = $c['contract_id'] !== null && (int) $c['contract_id'] === (int) $c['id'];
            $free = $c['uid'] !== null && $c['contract_id'] === null && (string) $c['ustatus'] === 'open';
            if ($c['uid'] === null || (!$mine && !$free)) {
                $issues[] = ['kind' => 'unit_conflict', 'ref' => (string) $c['contract_no'], 'note' => '계약의 자리(' . (string) $c['code'] . ')가 다른 상태예요. 직접 확인해 주세요'];
                continue;
            }
            if (!$heal) { $issues[] = ['kind' => 'unit_state_mismatch', 'ref' => (string) $c['contract_no'], 'note' => '자리 상태가 계약과 달라요']; continue; }
            try {
                Db::tx(function () use ($c, $want, $now) {
                    Db::exec('UPDATE allot_units SET status = ?, contract_id = ?, updated_at = ? WHERE id = ?', [$want, (int) $c['id'], $now, (int) $c['uid']]);
                    Db::exec('UPDATE allot_contracts SET live_unit_id = unit_id WHERE id = ?', [(int) $c['id']]);
                    self::bumpZone((int) $c['zone_id'], $now);
                });
                $fix('unit_state_mismatch', (string) $c['contract_no']);
            } catch (\PDOException $e) {
                if ((string) $e->getCode() !== '23000') throw $e;
                $issues[] = ['kind' => 'unit_conflict', 'ref' => (string) $c['contract_no'], 'note' => '같은 자리에 진행 중인 계약이 둘이에요. 직접 확인해 주세요'];
            }
        }
        // offers for units that are not held for them
        foreach (Db::all("SELECT w.id FROM allot_waitlist w LEFT JOIN allot_units u ON u.id = w.unit_id WHERE w.status = 'offered' AND (u.id IS NULL OR u.status <> 'held' OR u.contract_id IS NOT NULL) ORDER BY w.id ASC LIMIT ?", [$limit]) as $w) {
            if (!$heal) { $issues[] = ['kind' => 'stale_offer', 'ref' => '#' . $w['id'], 'note' => '제안한 자리가 잡혀 있지 않아요']; continue; }
            Db::exec("UPDATE allot_waitlist SET status = 'waiting', unit_id = NULL, offer_until = 0, updated_at = ? WHERE id = ? AND status = 'offered'", [$now, (int) $w['id']]);
            $fix('stale_offer', '#' . $w['id']);
        }
        // only reported
        foreach (Db::all("SELECT code FROM allot_units WHERE status = 'leased' AND contract_id IS NULL ORDER BY id ASC LIMIT ?", [$limit]) as $u) {
            $issues[] = ['kind' => 'leased_without_contract', 'ref' => (string) $u['code'], 'note' => '분양 중으로 표시됐지만 계약이 없어요'];
        }
        foreach (Db::all("SELECT contract_no FROM allot_contracts WHERE status = 'canceled' AND paid_total > 0 ORDER BY id ASC LIMIT ?", [$limit]) as $c) {
            $issues[] = ['kind' => 'refund_due', 'ref' => (string) $c['contract_no'], 'note' => '취소된 신청에 받은 돈이 남아 있어요. 환불을 확인해 주세요'];
        }
        // [verify-allot] a 토스 payment that should have gone back automatically but the gateway refused
        foreach (Db::all("SELECT c.contract_no, p.id FROM allot_payments p JOIN allot_contracts c ON c.id = p.contract_id WHERE p.status = 'paid' AND p.toss_status = 'REFUND_FAILED' ORDER BY p.id ASC LIMIT ?", [$limit]) as $c) {
            $issues[] = ['kind' => 'refund_due', 'ref' => (string) $c['contract_no'], 'note' => '자동 환불이 되지 않은 결제가 있어요 (입금 #' . (int) $c['id'] . '). 토스 상점관리자에서 확인해 주세요'];
        }
        foreach (Db::all('SELECT z.code, z.capacity, (SELECT COUNT(*) FROM allot_units u WHERE u.zone_id = z.id) AS n FROM allot_zones z ORDER BY z.id ASC') as $z) {
            if ((int) $z['capacity'] !== (int) $z['n']) $issues[] = ['kind' => 'capacity_mismatch', 'ref' => (string) $z['code'], 'note' => '구역 정원(' . (int) $z['capacity'] . ')과 자리 수(' . (int) $z['n'] . ')가 달라요'];
        }
        return ['healed' => $healed, 'issues' => array_slice($issues, 0, $limit)];
    }

    /** step 11 — retention: erase the person, keep the anonymous ledger rows; plus old job history and long-read notices */
    private static function tickPurge(int $now, int $batch, array &$out): int
    {
        $cut = $now - (int) self::conf('retention_days') * self::DAY;
        $n = 0;
        foreach (Db::all("SELECT cu.id FROM allot_customers cu WHERE cu.purged_at = 0 AND cu.updated_at < ?
            AND NOT EXISTS (SELECT 1 FROM allot_contracts c WHERE c.customer_id = cu.id AND (c.status IN ('pending', 'active', 'overdue') OR c.ended_at >= ? OR c.updated_at >= ?))
            AND NOT EXISTS (SELECT 1 FROM allot_waitlist w WHERE w.customer_id = cu.id AND (w.status IN ('waiting', 'offered') OR w.updated_at >= ?))
            ORDER BY cu.id ASC LIMIT ?", [$cut, $cut, $cut, $cut, $batch]) as $r) {
            $id = (int) $r['id'];
            $done = Db::tx(function () use ($id, $now) {
                if (Db::exec("UPDATE allot_customers SET name_enc = '', phone_enc = '', phone_hash = '', phone_tail = '', name_hash = '', addr_enc = NULL, memo = NULL, user_id = NULL, purged_at = ?, updated_at = ?
                    WHERE id = ? AND purged_at = 0", [$now, $now, $id]) !== 1) return false;
                Db::exec("UPDATE allot_payments SET payment_key_enc = '', memo = '' WHERE customer_id = ?", [$id]);
                Db::exec('UPDATE allot_contracts SET memo = NULL, user_id = NULL WHERE customer_id = ?', [$id]);
                Db::exec('DELETE FROM allot_notices WHERE customer_id = ?', [$id]);
                Db::exec('UPDATE allot_waitlist SET user_id = NULL WHERE customer_id = ?', [$id]);
                return true;
            });
            if ($done) $n++;
        }
        if ($n > 0) Audit::log('allot_purged', null, ['customers' => $n, 'retentionDays' => (int) self::conf('retention_days')], 'warn');
        // housekeeping that holds no ledger data: job history after 180 days, read / canceled notices after 400 days
        Db::exec('DELETE FROM job_runs WHERE started_at < ?', [Clock::ms() - 180 * self::DAY]);
        Db::exec("DELETE FROM allot_notices WHERE status IN ('seen', 'canceled') AND created_at < ?", [$now - 400 * self::DAY]);
        return $n;
    }

    /** the optional daily summary for the operator: numbers only → 'off' | 'no address' | 'already' | 'sent' | 'failed' */
    private static function dailyMail(int $now, array $run): string
    {
        if (self::conf('daily_report_mail') !== true) return 'off';
        $to = class_exists('Tfm\SecEvent') ? SecEvent::alertTargets()['email'] : '';
        if ($to === '') return 'no address';
        $day = Clock::day($now);
        $old = Db::value("SELECT v FROM settings WHERE k = 'allot.mail_day'");
        if ($old !== null && (string) $old === $day) return 'already';
        // one mail a day even with several servers / runs: the stored day changes from the old value to today exactly once
        if ($old === null) {
            try { Db::insert('settings', ['k' => 'allot.mail_day', 'v' => $day, 'updated_at' => $now, 'updated_by' => null]); }
            catch (\PDOException $e) { if ((string) $e->getCode() === '23000') return 'already'; throw $e; }
        } elseif (Db::exec("UPDATE settings SET v = ?, updated_at = ? WHERE k = 'allot.mail_day' AND v = ?", [$day, $now, (string) $old]) !== 1) {
            return 'already';
        }
        $s = self::adminSummary($now);
        $u = $s['units'];
        $app = (string) Config::get('app.name', TFM_APP);
        $subject = '[' . $app . '] 분양 현황 ' . $day;
        $body = "분양 현황 요약이에요 ({$day}).\n\n"
            . "자리: 모두 {$u['total']} · 빈자리 {$u['open']} · 보류 {$u['held']} · 분양 {$u['leased']} · 닫힘 {$u['closed']}\n"
            . "승인 기다리는 신청: {$s['pending']} (입금 기록 있음 {$s['pendingPaid']})\n"
            . "진행 중 계약: {$s['active']} · 연체: {$s['overdue']} · 30일 안에 끝나는 계약: {$s['expiring30']}\n"
            . "해지 요청: {$s['cancelRequests']} · 대기자: {$s['waiting']} · 직접 연락할 알림: {$s['noticesOffline']} · 환불 확인: {$s['refundDue']}\n"
            . '이번 자동화: ' . json_encode($run['steps']) . "\n"
            . (count($run['issues']) > 0 ? '점검에서 확인이 필요한 항목: ' . count($run['issues']) . "건\n" : '')
            . "\n자세한 내용은 관리자 화면의 🏺 분양 관리에서 볼 수 있어요.\n";
        if (self::$mailer !== null) return call_user_func(self::$mailer, $to, $subject, $body) ? 'sent' : 'failed';
        if (!function_exists('mail')) return 'failed';
        $subj = function_exists('mb_encode_mimeheader') ? mb_encode_mimeheader($subject, 'UTF-8', 'B') : $subject;
        return @mail($to, $subj, $body, "MIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: 8bit") ? 'sent' : 'failed';
    }

    /**
     * The numbers of the admin 현황 page: {units (as summary()), zones (as zones()), pending, pendingOldest, pendingPaid,
     * holdsExpiring (unpaid applications that lapse within 24 h), active, overdue, expiring30, dueSoon (to pay within 7
     * days), cancelRequests, waiting, offered, noticesOffline, refundDue, lastRun, tickAgeMs (null = never ran),
     * mapVersion, toss, rules}
     */
    public static function adminSummary(?int $now = null): array
    {
        $now = self::now($now);
        $v = function (string $sql, array $p = []): int { return (int) Db::value($sql, $p); };
        $runs = self::jobRuns(1);
        $last = self::lastTickAt();
        self::$memo = [];
        return [
            'units' => self::summary(), 'zones' => self::zones(),
            'pending' => $v("SELECT COUNT(*) FROM allot_contracts WHERE status = 'pending'"),
            'pendingOldest' => $v("SELECT COALESCE(MIN(created_at), 0) FROM allot_contracts WHERE status = 'pending'"),
            'pendingPaid' => $v("SELECT COUNT(*) FROM allot_contracts WHERE status = 'pending' AND paid_total > 0"),
            'holdsExpiring' => $v("SELECT COUNT(*) FROM allot_contracts c JOIN allot_units u ON u.id = c.unit_id WHERE c.status = 'pending' AND c.paid_total = 0 AND u.hold_until > 0 AND u.hold_until < ?", [$now + self::DAY]),
            'active' => $v("SELECT COUNT(*) FROM allot_contracts WHERE status = 'active'"),
            'overdue' => $v("SELECT COUNT(*) FROM allot_contracts WHERE status = 'overdue'"),
            'expiring30' => $v("SELECT COUNT(*) FROM allot_contracts WHERE status IN ('active', 'overdue') AND auto_renew = 0 AND ends_at > 0 AND ends_at < ?", [$now + 30 * self::DAY]),
            'dueSoon' => $v("SELECT COUNT(*) FROM allot_contracts WHERE status = 'active' AND price > 0 AND paid_until > 0 AND paid_until < ?", [$now + 7 * self::DAY]),
            'cancelRequests' => $v("SELECT COUNT(*) FROM allot_contracts WHERE status IN ('active', 'overdue') AND cancel_req_at > 0"),
            'waiting' => $v("SELECT COUNT(*) FROM allot_waitlist WHERE status = 'waiting'"),
            'offered' => $v("SELECT COUNT(*) FROM allot_waitlist WHERE status = 'offered'"),
            'noticesOffline' => $v("SELECT COUNT(*) FROM allot_notices WHERE status = 'queued' AND user_id IS NULL"),
            'refundDue' => $v("SELECT COUNT(*) FROM allot_contracts WHERE status = 'canceled' AND paid_total > 0"),
            'lastRun' => $runs ? $runs[0] : null, 'tickAgeMs' => $last > 0 ? $now - $last : null, 'mapVersion' => self::mapVersion(), 'toss' => self::tossOn(), 'rules' => self::rules(),
        ];
    }

    /**
     * Statistics for the admin site: {days: [{day, open, held, leased, closed, pending, active, overdue, ended, revenue}]
     * (all zones, the last $days days that have a row, oldest first), zones (as zones()), revenueTotal (of those days)}
     */
    public static function stats(int $days = 30): array
    {
        $days = max(1, min(400, $days));
        $rows = array_reverse(Db::all('SELECT day, n_open, n_held, n_leased, n_closed, n_pending, n_active, n_overdue, n_ended, revenue FROM allot_stats_daily WHERE zone_id = 0 ORDER BY day DESC LIMIT ?', [$days]));
        $total = 0;
        $out = [];
        foreach ($rows as $r) {
            $total += (int) $r['revenue'];
            $out[] = ['day' => (string) $r['day'], 'open' => (int) $r['n_open'], 'held' => (int) $r['n_held'], 'leased' => (int) $r['n_leased'], 'closed' => (int) $r['n_closed'], 'pending' => (int) $r['n_pending'],
                'active' => (int) $r['n_active'], 'overdue' => (int) $r['n_overdue'], 'ended' => (int) $r['n_ended'], 'revenue' => (int) $r['revenue']];
        }
        return ['days' => $out, 'zones' => self::zones(), 'revenueTotal' => $total];
    }

    // ------------------------------------------------------------------ demo data (php cli/tfm.php allot:demo)
    /** what `allot:demo` made on this site, or null: {at, customers: [id], contracts: n, care: [id]} */
    public static function demoInfo(): ?array
    {
        $v = Db::value("SELECT v FROM settings WHERE k = 'allot.demo'");
        $d = is_string($v) ? json_decode($v, true) : null;
        return is_array($d) && isset($d['customers']) && is_array($d['customers']) ? $d : null;
    }

    /**
     * Synthetic customers ("예시고객01", phone 010-0000-00NN — nobody's number) and contracts in every state, for a TEST
     * site: about 60 % running and paid, 10 % unpaid (overdue after the next tick), 10 % applications waiting for
     * approval, 10 % ending within weeks, 10 % ended; plus three care-log lines. A site without zones gets the small
     * preset (open for applications). Everything is made through the same functions the operator uses, in one
     * transaction, and remembered (settings row allot.demo) so demoClear() can remove exactly these rows again.
     * 409 DEMO_EXISTS (already made) · 409 DEMO_REFUSED (a customer or contract exists: never mixed into a real ledger).
     * → {customers, contracts, active, unpaid, pending, ending, ended, care, zonesSeeded}
     */
    public static function demoSeed(array $a, int $count = 40, ?int $now = null): array
    {
        $actor = self::admin($a);
        $now = self::now($now);
        $count = max(10, min(200, $count));
        if (self::demoInfo() !== null) throw new ApiException(409, 'DEMO_EXISTS', '예시 자료가 이미 있어요. 지우려면 allot:demo --clear 를 실행해 주세요.');
        if ((int) Db::value('SELECT COUNT(*) FROM allot_contracts') > 0 || (int) Db::value('SELECT COUNT(*) FROM allot_customers') > 0) {
            throw new ApiException(409, 'DEMO_REFUSED', '이미 고객이나 계약이 있는 곳에는 예시 자료를 만들지 않아요. (진짜 장부와 섞이지 않게 하려는 거예요)');
        }
        $out = Db::txRetry(function () use ($a, $count, $now) {
            $n = ['customers' => 0, 'contracts' => 0, 'active' => 0, 'unpaid' => 0, 'pending' => 0, 'ending' => 0, 'ended' => 0, 'care' => 0, 'zonesSeeded' => 0];
            if ((int) Db::value('SELECT COUNT(*) FROM allot_zones') === 0) $n['zonesSeeded'] = (int) self::seedPreset($a, 'small', true)['zones'];
            $units = [];
            foreach (['jar' => (int) ceil($count * 0.6), 'plot' => (int) ceil($count * 0.3), 'store' => (int) ceil($count * 0.1)] as $kind => $want) {
                foreach (Db::all("SELECT u.code FROM allot_units u JOIN allot_zones z ON z.id = u.zone_id WHERE u.kind = ? AND u.status = 'open' AND u.contract_id IS NULL AND (u.seq % 2) = 1 ORDER BY z.sort ASC, z.id ASC, u.seq ASC LIMIT ?", [$kind, $want]) as $r) $units[] = (string) $r['code'];
            }
            $units = array_slice($units, 0, $count);
            if (!$units) throw new ApiException(409, 'SOLD_OUT', '빈 자리가 없어 예시 자료를 만들 수 없어요.');
            $ids = [];
            $care = [];
            foreach ($units as $i => $code) {
                $cu = self::saveCustomer($a, ['name' => sprintf('예시고객%02d', $i + 1), 'phone' => sprintf('010-0000-%04d', $i + 1), 'memo' => '예시 자료예요 (allot:demo).'], $now);
                $cid = (int) $cu['id'];
                $ids[] = $cid;
                $n['customers']++;
                $shape = $i % 10;
                if ($shape === 7) { // an application waiting for the operator
                    self::createContract($a, $code, $cid, ['status' => 'pending', 'notify' => false, 'memo' => '예시 자료'], $now);
                    $n['contracts']++;
                    $n['pending']++;
                    continue;
                }
                $months = $shape === 9 ? 14 : ($shape === 8 ? 11 : 1 + $i % 9);
                $starts = $shape === 6 ? $now - 50 * self::DAY : self::addMonths($now, -$months) + ($shape === 8 ? -15 * self::DAY : 0);
                $c = self::createContract($a, $code, $cid, ['status' => 'active', 'startsAt' => $starts, 'notify' => false, 'memo' => '예시 자료'], $now);
                $n['contracts']++;
                $conId = (int) $c['id'];
                if ($shape === 6) { $n['unpaid']++; continue; }
                if ((int) $c['price'] > 0) {
                    $periods = (string) $c['period'] === 'month' ? $months + 1 : 1;
                    self::recordPayment($a, $conId, min(self::MAX_AMOUNT, (int) $c['price'] * $periods), 'bank', 'demo-pay-' . $conId, ['periods' => $periods, 'paidAt' => $starts, 'memo' => '예시 납부'], $now);
                }
                if ($shape === 9) { self::endContract($a, $conId, '예시: 기간이 끝났어요', $now); $n['ended']++; }
                elseif ($shape === 8) $n['ending']++;
                else $n['active']++;
            }
            $zone = (string) Db::value("SELECT z.code FROM allot_zones z ORDER BY z.sort ASC, z.id ASC LIMIT 1");
            $care[] = (int) self::addCare($a, ['zone' => $zone], 'water', '예시 일지: 구역을 돌며 물을 뿌리고 뚜껑을 닦았어요.', true, $now - 2 * self::DAY)['id'];
            $care[] = (int) self::addCare($a, ['all' => true], 'weather', '예시 일지: 서리가 내려 볏짚 덮개를 덮어 두었어요.', true, $now - self::DAY)['id'];
            $care[] = (int) self::addCare($a, ['unit' => $units[0]], 'check', '예시 일지: 자리 상태를 살펴보았어요.', true, $now)['id'];
            $n['care'] = count($care);
            Db::upsert('settings', ['k' => 'allot.demo', 'v' => (string) json_encode(['at' => $now, 'customers' => $ids, 'contracts' => $n['contracts'], 'care' => $care]), 'updated_at' => $now, 'updated_by' => null], ['k']);
            return $n;
        });
        self::forget();
        Audit::log('allot_demo_seeded', null, ['customers' => $out['customers'], 'contracts' => $out['contracts']], 'warn', self::idOrNull($actor));
        return $out;
    }

    /**
     * Remove what demoSeed() made — and only that: the remembered synthetic customers with every contract, payment,
     * notice and waiting-list row of theirs (their units are free again), and the remembered care-log lines. A synthetic
     * customer that was linked to an app account since is kept (it is somebody's data now). Zones and units stay.
     * 409 NO_DEMO. → {customers, contracts, payments, notices, care, kept}
     */
    public static function demoClear(array $a, ?int $now = null): array
    {
        $actor = self::admin($a);
        $now = self::now($now);
        $d = self::demoInfo();
        if ($d === null) throw new ApiException(409, 'NO_DEMO', '지울 예시 자료가 없어요.');
        $cust = array_values(array_unique(array_filter(array_map('intval', $d['customers']))));
        $care = isset($d['care']) && is_array($d['care']) ? array_values(array_filter(array_map('intval', $d['care']))) : [];
        $freed = [];
        $out = Db::txRetry(function () use ($cust, $care, $now, &$freed) {
            $freed = [];
            $n = ['customers' => 0, 'contracts' => 0, 'payments' => 0, 'notices' => 0, 'care' => 0, 'kept' => 0];
            foreach ($cust as $cid) {
                $cu = Db::one('SELECT id, user_id FROM allot_customers WHERE id = ?' . Db::forUpdate(), [$cid]);
                if (!$cu) continue;
                if ($cu['user_id'] !== null) { $n['kept']++; continue; }
                foreach (Db::all('SELECT id, unit_id FROM allot_contracts WHERE customer_id = ?', [$cid]) as $c) {
                    $conId = (int) $c['id'];
                    $u = Db::one('SELECT id, zone_id FROM allot_units WHERE id = ? AND contract_id = ?' . Db::forUpdate(), [(int) $c['unit_id'], $conId]);
                    if ($u) {
                        Db::exec("UPDATE allot_units SET status = 'open', contract_id = NULL, hold_until = 0, label = '', label_show = 0, updated_at = ? WHERE id = ?", [$now, (int) $u['id']]);
                        self::bumpZone((int) $u['zone_id'], $now);
                        $freed[] = (int) $u['id'];
                    }
                    $n['payments'] += Db::exec('DELETE FROM allot_payments WHERE contract_id = ?', [$conId]);
                    $n['notices'] += Db::exec('DELETE FROM allot_notices WHERE contract_id = ?', [$conId]);
                    Db::exec('DELETE FROM allot_contracts WHERE id = ?', [$conId]);
                    $n['contracts']++;
                }
                $n['notices'] += Db::exec('DELETE FROM allot_notices WHERE customer_id = ?', [$cid]);
                Db::exec('DELETE FROM allot_waitlist WHERE customer_id = ?', [$cid]);
                Db::exec('DELETE FROM allot_customers WHERE id = ?', [$cid]);
                $n['customers']++;
            }
            foreach ($care as $id) $n['care'] += Db::exec('DELETE FROM allot_care_logs WHERE id = ?', [$id]);
            Db::exec("DELETE FROM settings WHERE k = 'allot.demo'");
            // a test site that is empty again starts its statistics from nothing
            if ((int) Db::value('SELECT COUNT(*) FROM allot_contracts') === 0) Db::exec('DELETE FROM allot_stats_daily WHERE zone_id >= 0');
            return $n;
        });
        self::forget();
        foreach ($freed as $unitId) self::offerQuietly($unitId, $now);
        Audit::log('allot_demo_cleared', null, $out, 'warn', self::idOrNull($actor));
        return $out;
    }

    // ------------------------------------------------------------------ keys (php cli/tfm.php secret:rotate)
    /**
     * --data-key: seal every sealed allot column again with the current data key (values still in plain text or sealed
     * with the previous key). Runs inside the caller's transaction (Installer::resealColumns). → [resealed, unreadable]
     */
    public static function resealAll(): array
    {
        $done = 0;
        $bad = 0;
        $one = function ($v, callable $store) use (&$done, &$bad) {
            if (!is_string($v) || $v === '') return;
            if (Crypto::open($v) === null) { $bad++; return; }
            if (!Crypto::needsReseal($v)) return;
            $done += (int) $store(Crypto::seal((string) Crypto::open($v)));
        };
        $after = 0;
        do {
            $rows = Db::all('SELECT id, name_enc, phone_enc, addr_enc, memo FROM allot_customers WHERE id > ? AND purged_at = 0 ORDER BY id ASC LIMIT 500', [$after]);
            foreach ($rows as $r) {
                $id = (int) $r['id'];
                $after = $id;
                $one($r['name_enc'], function ($s) use ($id) { return Db::exec('UPDATE allot_customers SET name_enc = ? WHERE id = ?', [$s, $id]); });
                $one($r['phone_enc'], function ($s) use ($id) { return Db::exec('UPDATE allot_customers SET phone_enc = ? WHERE id = ?', [$s, $id]); });
                $one($r['addr_enc'], function ($s) use ($id) { return Db::exec('UPDATE allot_customers SET addr_enc = ? WHERE id = ?', [$s, $id]); });
                $one($r['memo'], function ($s) use ($id) { return Db::exec('UPDATE allot_customers SET memo = ? WHERE id = ?', [$s, $id]); });
            }
        } while (count($rows) === 500);
        $after = 0;
        do {
            $rows = Db::all("SELECT id, payment_key_enc FROM allot_payments WHERE id > ? AND payment_key_enc <> '' ORDER BY id ASC LIMIT 500", [$after]);
            foreach ($rows as $r) {
                $id = (int) $r['id'];
                $after = $id;
                $one($r['payment_key_enc'], function ($s) use ($id) { return Db::exec('UPDATE allot_payments SET payment_key_enc = ? WHERE id = ?', [$s, $id]); });
            }
        } while (count($rows) === 500);
        return ['resealed' => $done, 'unreadable' => $bad];
    }

    /**
     * --app-key: the blind indexes are keyed with the app key, so they are computed again from the sealed values with
     * the new key. $hash = the keyed hash with the NEW key (this process still holds the old one). → rows changed
     */
    public static function rehashBlind(callable $hash): int
    {
        $n = 0;
        $after = 0;
        do {
            $rows = Db::all('SELECT id, name_enc, phone_enc FROM allot_customers WHERE id > ? AND purged_at = 0 ORDER BY id ASC LIMIT 500', [$after]);
            foreach ($rows as $r) {
                $after = (int) $r['id'];
                $phone = self::unseal($r['phone_enc']);
                $name = self::nameKey(self::unseal($r['name_enc']));
                $n += Db::exec('UPDATE allot_customers SET phone_hash = ?, name_hash = ? WHERE id = ?', [$phone === '' ? '' : (string) $hash('allot-phone:' . $phone), $name === '' ? '' : (string) $hash('allot-name:' . $name), (int) $r['id']]);
            }
        } while (count($rows) === 500);
        return $n;
    }

    // [allot-admin] ---------------------------------------------------- read-only extras for the admin tab (lib/AdminAllot.php)
    /**
     * Contracts with money to collect soon: active / overdue ones with a price whose paid-until date lies within $days
     * days or is already past, the most urgent first. Keyset on (paid_until, id): pass `next` ("<paidUntil>_<id>") back
     * as $after. @return array ['rows' => [contract …] (as listContracts), 'next' => cursor or '']
     */
    public static function listDue(int $days = 7, int $limit = 50, string $after = '', ?int $now = null): array
    {
        $now = self::now($now);
        $limit = max(1, min(500, $limit));
        $ap = 0;
        $ai = 0;
        if (preg_match('/^(\d{1,15})_(\d{1,15})$/', $after, $m)) { $ap = (int) $m[1]; $ai = (int) $m[2]; }
        $rows = Db::all(self::CON_SELECT . " WHERE c.status IN ('active', 'overdue') AND c.price > 0 AND c.paid_until > 0 AND c.paid_until < ?
              AND (c.paid_until > ? OR (c.paid_until = ? AND c.id > ?))
            ORDER BY c.paid_until ASC, c.id ASC LIMIT ?", [$now + max(0, min(366, $days)) * self::DAY, $ap, $ap, $ai, $limit + 1]);
        $more = count($rows) > $limit;
        if ($more) array_pop($rows);
        $out = array_map(function ($r) { return self::contractOut($r); }, $rows);
        $last = $out ? $out[count($out) - 1] : null;
        return ['rows' => $out, 'next' => $more && $last ? $last['paidUntil'] . '_' . $last['id'] : ''];
    }

    /**
     * The admin's care-log list: every line (hidden ones too) with the place it belongs to and who wrote it, newest
     * first. $filter: zone (id or code), unit (code). $beforeId pages back.
     * → {logs: [{id, kind, text, at, scope 'unit'|'zone'|'all', visible, zoneCode, unitCode, by}], more}
     */
    public static function careAdmin(array $filter = [], int $limit = 50, int $beforeId = 0): array
    {
        $limit = max(1, min(200, $limit));
        $b = max(0, $beforeId);
        $zid = 0;
        $uid = 0;
        if (isset($filter['unit']) && $filter['unit'] !== '') {
            $u = Db::one('SELECT id FROM allot_units WHERE code = ?', [self::unitCode($filter['unit'])]);
            if (!$u) return ['logs' => [], 'more' => false];
            $uid = (int) $u['id'];
        } elseif (isset($filter['zone']) && $filter['zone'] !== '' && $filter['zone'] !== 0) {
            $z = self::zoneRow($filter['zone']);
            if (!$z) return ['logs' => [], 'more' => false];
            $zid = (int) $z['id'];
        }
        $rows = Db::all('SELECT l.id, l.zone_id, l.unit_id, l.kind, l.text, l.visible, l.created_at, z.code AS zone_code, u.code AS unit_code, a.nickname
            FROM allot_care_logs l LEFT JOIN allot_zones z ON z.id = l.zone_id LEFT JOIN allot_units u ON u.id = l.unit_id LEFT JOIN users a ON a.id = l.created_by
            WHERE (? = 0 OR l.id < ?) AND (? = 0 OR l.zone_id = ?) AND (? = 0 OR l.unit_id = ?) ORDER BY l.id DESC LIMIT ?', [$b, $b, $zid, $zid, $uid, $uid, $limit + 1]);
        $more = count($rows) > $limit;
        if ($more) array_pop($rows);
        return ['logs' => array_map(function ($r) {
            return ['id' => (int) $r['id'], 'kind' => (string) $r['kind'], 'text' => (string) $r['text'], 'at' => (int) $r['created_at'],
                'scope' => (int) $r['unit_id'] > 0 ? 'unit' : ((int) $r['zone_id'] > 0 ? 'zone' : 'all'), 'visible' => (int) $r['visible'] === 1,
                'zoneCode' => $r['zone_code'] === null ? '' : (string) $r['zone_code'], 'unitCode' => $r['unit_code'] === null ? '' : (string) $r['unit_code'],
                'by' => $r['nickname'] === null ? '' : (string) $r['nickname']];
        }, $rows), 'more' => $more];
    }

    /** the consent versions customers agreed to so far, newest first: [{ver, at, customers}] */
    public static function termsVersions(int $limit = 20): array
    {
        return array_map(function ($r) { return ['ver' => (string) $r['ver'], 'at' => (int) $r['created_at'], 'customers' => (int) $r['n']]; },
            Db::all('SELECT t.ver, t.created_at, (SELECT COUNT(*) FROM allot_customers cu WHERE cu.consent_ver = t.ver) AS n FROM allot_terms t ORDER BY t.id DESC LIMIT ?', [max(1, min(100, $limit))]));
    }

    /** the texts of one consent version (what those customers read when they agreed), or null: {ver, at, privacy, terms, refund} */
    public static function termsOf(string $ver): ?array
    {
        if ($ver === '' || strlen($ver) > 40) return null;
        $r = Db::one('SELECT ver, privacy_text, terms_text, refund_text, created_at FROM allot_terms WHERE ver = ?', [$ver]);
        return $r ? ['ver' => (string) $r['ver'], 'at' => (int) $r['created_at'], 'privacy' => (string) $r['privacy_text'], 'terms' => (string) $r['terms_text'], 'refund' => (string) $r['refund_text']] : null;
    }
}
