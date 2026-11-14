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
        FROM allot_units u JOIN allot_zones z ON z.id = u.zone_id LEFT JOIN allot_contracts c ON c.id = u.contract_id';

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
        $status = isset($filter['status']) && isset(self::STATUS_CHAR[$filter['status']]) ? (string) $filter['status'] : '';
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

    // @@NEXT@@
}
