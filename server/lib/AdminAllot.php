<?php
/**
 * Tfm\AdminAllot — the admin site's 🏺 분양 관리 tab (CONTRACT §16.7): the view, the actions, CSV export and import.
 *
 *   view(Ctx $c, array $get, string $token): string     the tab (ten sections: 현황 · 구역 · 단위 · 계약 · 고객 · 대기자 · 알림 ·
 *                                                        관리 일지 · 가져오기·내보내기 · 자동화) — no JavaScript anywhere
 *   back(array $post): array                             where a form came from (validated) → the 303 goes back there,
 *                                                        also when the action fails
 *   action(string $action, Ctx $c, array $post): array   one `allot_*` action → ['msg' => flash text, 'back' => query];
 *                                                        `allot_export` answers with the CSV file itself and ends the request
 *   card(): string                                       the summary card of the first tab (📊 대시보드)
 *
 * It lives in lib/ (never web-readable; the admin folder holds only index.php and .htaccess) and is loaded by the admin
 * entry on demand. The entry has already checked the lock for every POST that reaches action(): same origin, the CSRF
 * token, the admin role and the elevation (password + 2-step sign-in). The `case 'allot_…':` labels stay in the entry:
 * tests/admin-lock.mjs reads the list of actions from that file.
 *
 * Rules that hold everywhere in this file:
 *  - every value that reaches the page goes through e(); the page carries no script, no inline style, no event handler
 *    (the CSP of the admin site is `default-src 'none'; style-src 'self'`) — bars are width classes of lib/admin.css
 *  - lists are read by key (`after` / `before` = the cursor Tfm\Allot hands out), at most ROWS rows a page
 *  - personal data (name, phone, address, the customer memo) is shown masked. The full values are shown ONCE, after the
 *    administrator typed the password again (a step-up that stays open PII_WINDOW seconds) and chose a reason; every
 *    reveal is an audit row (customer id + reason code, never the data). Personal data never enters a flash message, an
 *    audit detail, a log line, a file name or an address: a search by phone number or name is POSTed, kept sealed in
 *    the session and named in the address by a random token only
 *  - a state change is always an `allot_*` POST; the work itself is Tfm\Allot (which writes the audit rows); what the
 *    library does not audit (a memo, a search, a masked export, a run of the automation) is audited here
 * PHP 7.2 syntax only.
 */
declare(strict_types=1);

namespace Tfm;

if (!defined('TFM_BOOT')) { if (function_exists('header_remove')) header_remove('X-Powered-By'); http_response_code(404); exit; }

final class AdminAllot
{
    /** rows per page of every list */
    public const ROWS = 50;
    /** how long the password step-up for personal data stays open (seconds) */
    public const PII_WINDOW = 600;
    /** how long a revealed record waits in the session for its one page view (seconds) */
    public const REVEAL_TTL = 300;
    /** the largest CSV text the paste box takes (bytes); bigger files go through `php cli/tfm.php allot:import` */
    public const PASTE_MAX = 2097152;
    /** how long a dry run waits for its confirmation (seconds) */
    public const IMPORT_TTL = 1800;

    public const SECTIONS = [
        'status' => ['📊', '현황'], 'zones' => ['🗺️', '구역'], 'units' => ['🏺', '단위'], 'contracts' => ['📄', '계약'], 'customers' => ['👤', '고객'],
        'wait' => ['⏳', '대기자'], 'notices' => ['🔔', '알림'], 'care' => ['📒', '관리 일지'], 'csv' => ['📦', '가져오기·내보내기'], 'auto' => ['⚙️', '자동화'],
    ];
    public const KIND_ICON = ['jar' => '🏺', 'plot' => '🥬', 'store' => '🏚️'];
    public const UNIT_STATUS = ['open' => ['빈자리', 'ok'], 'held' => ['보류', 'warn'], 'leased' => ['분양', 'gold'], 'closed' => ['닫힘', '']];
    public const CONTRACT_STATUS = ['pending' => ['⏳ 승인 대기', 'warn'], 'active' => ['✅ 진행 중', 'ok'], 'overdue' => ['⚠️ 연체', 'fail'], 'ended' => ['종료', ''], 'canceled' => ['취소', '']];
    public const PERIOD = ['once' => '한 번', 'month' => '매달', 'year' => '매년'];
    public const METHOD = ['bank' => '계좌 이체', 'cash' => '현금', 'cms' => '자동 이체(CMS)', 'etc' => '기타', 'toss' => '토스 결제'];
    public const PAY_STATUS = ['created' => ['결제 대기', ''], 'paid' => ['입금 확인', 'ok'], 'failed' => ['실패', 'fail'], 'canceled' => ['취소', ''], 'refunded' => ['환불함', 'warn']];
    public const PAY_KIND = ['first' => '첫 납부', 'renewal' => '이어서 납부', 'manual' => '기타 입금', 'refund' => '환불'];
    public const WAIT_STATUS = ['waiting' => ['기다리는 중', 'warn'], 'offered' => ['자리 제안함', 'gold'], 'converted' => ['신청으로 바뀜', 'ok'], 'expired' => ['기한 지남', ''], 'canceled' => ['취소', '']];
    public const NOTICE_STATUS = ['queued' => ['기다림', 'warn'], 'sent' => ['보냄', 'ok'], 'seen' => ['읽음', 'ok'], 'canceled' => ['취소', '']];
    public const NOTICE_KIND = [
        'applied' => '신청 접수', 'approved' => '확정', 'rejected' => '반려', 'canceled' => '취소', 'hold_expired' => '기한 지나 자동 취소', 'paid' => '납부 확인', 'due' => '납부 안내',
        'ending' => '만료 안내', 'overdue' => '연체 안내', 'ended' => '종료', 'renewed' => '연장', 'moved' => '자리 이동', 'offer' => '대기자 자리 제안', 'offer_expired' => '제안 기한 지남',
        'cancel_requested' => '해지 요청', 'info' => '운영자 알림',
    ];
    public const CARE_KIND = ['care' => '🧹 돌봄', 'water' => '💧 물 주기', 'clean' => '🧽 닦기', 'check' => '🔍 살펴보기', 'weather' => '🌦️ 날씨 대비', 'event' => '🎉 행사', 'photo' => '📷 사진', 'notice' => '📢 알림'];
    public const SOURCE = ['app' => '체험관에서 신청', 'admin' => '관리자가 입력', 'import' => '장부에서 가져옴'];
    public const END_REASON = ['rejected' => '반려', 'user' => '신청자가 취소', 'hold_expired' => '기한이 지나 자동 취소', 'overdue_auto' => '연체로 자동 종료', 'offer_declined' => '제안 거절', 'moved' => '자리 이동', 'admin' => '관리자가 끝냄'];
    public const EXPORT_NAMES = [
        'ledger' => '📒 장부 — 진행 중인 계약 (일자 · 성명 · 연락처 · 주소 · 비고 · 단위)', 'contracts' => '📄 계약 전체', 'customers' => '👤 고객', 'payments' => '💰 입금 내역',
        'units' => '🏺 단위(자리) 전체', 'waitlist' => '⏳ 대기자',
    ];
    public const TICK_STEPS = [
        'holds' => '기한 지난 보류 정리', 'approved' => '자동 확정', 'renewed' => '자동 연장', 'notices' => '납부 · 만료 안내', 'overdue' => '연체 표시', 'ended' => '연체 자동 종료',
        'offers' => '대기자에게 자리 제안', 'sent' => '예약 알림 보내기', 'stats' => '오늘 통계', 'healed' => '점검에서 고친 것', 'purged' => '보관 기간 지난 개인정보 지움',
    ];
    public const TICK_SOURCE = ['cli' => '작업 스케줄러 (서버 명령)', 'lazy' => '자동 (화면을 열 때)', 'admin' => '관리자가 누름'];
    /** the library's field names in the operator's words (an INVALID_INPUT message names its field) */
    private const FIELD_KO = [
        'code' => '구역 번호', 'kind' => '종류', 'name' => '이름', 'capacity' => '자리 수', 'cols' => '한 줄 칸 수', 'sort' => '순서', 'price' => '금액', 'period' => '납부 주기',
        'termMonths' => '기간(개월)', 'isOpen' => '신청 받기', 'note' => '메모', 'state' => '상태', 'holdHours' => '보류 시간', 'phone' => '전화번호', 'addr' => '주소', 'memo' => '메모',
        'amount' => '금액', 'method' => '입금 방법', 'idem' => '중복 방지 키', 'periods' => '납부 회차', 'paidAt' => '입금일', 'terms' => '연장 횟수', 'why' => '끝내는 까닭', 'title' => '제목',
        'body' => '내용', 'text' => '내용', 'sendAt' => '보내는 때', 'status' => '상태', 'target' => '받는 사람', 'csv' => '붙여 넣은 내용', 'what' => '종류', 'startsAt' => '시작일',
        'endsAt' => '끝나는 날', 'paidUntil' => '납부 기한', 'unit' => '자리 번호', 'zone' => '구역', 'reason' => '까닭', 'preset' => '구성', 'id' => '번호',
        'enabled' => '분양 받기', 'hold_hours' => '자리 잡아 두는 시간', 'apply_per_user' => '한 계정이 가질 수 있는 수', 'auto_approve' => '자동 확정', 'grace_days' => '연체 유예', 'notice_days' => '알림 날짜',
        'overdue_end_days' => '연체 자동 종료', 'waitlist_offer_hours' => '대기자 답 기다리는 시간', 'retention_days' => '개인정보 보관 기간', 'collect_address' => '주소 받기',
        'nameplate_default_show' => '이름표 처음부터 공개', 'toss_enabled' => '토스 결제', 'lazy_tick_minutes' => '자동화 간격', 'tick_batch' => '한 번에 처리하는 수', 'consent_version' => '동의 문구 판',
        'daily_report_mail' => '하루 요약 메일', 'terms_text' => '이용 안내', 'privacy_text' => '개인정보 안내', 'refund_text' => '환불 안내', 'pay_guide' => '입금 안내',
    ];

    /** @var string the CSRF token of the forms of this page view */
    private static $token = '';
    /** @var array|null Allot::adminSummary() of this request */
    private static $sum = null;

    // ================================================================== small helpers
    private static function e($v): string { return htmlspecialchars((string) $v, ENT_QUOTES | ENT_SUBSTITUTE | ENT_HTML401, 'UTF-8'); }
    private static function n($v): string { return number_format((float) $v); }
    /** "2026-11-14 10:30" (server time zone); '-' for 0 */
    private static function at($ms): string { $ms = (int) $ms; return $ms > 0 ? date('Y-m-d H:i', intdiv($ms, 1000)) : '-'; }
    /** "2026-11-14"; '-' for 0, "기한 없음" for an open end */
    private static function day($ms): string
    {
        $ms = (int) $ms;
        if ($ms <= 0) return '-';
        return $ms >= Allot::FOREVER ? '기한 없음' : date('Y-m-d', intdiv($ms, 1000));
    }
    /** a string field of a request array ('' when missing or not a string) */
    private static function s(array $a, string $k): string { return isset($a[$k]) && is_string($a[$k]) ? $a[$k] : ''; }
    /** a positive integer field (digits only, at most 15) or 0 */
    private static function id(array $a, string $k): int
    {
        $v = self::s($a, $k);
        return $v !== '' && strlen($v) <= 15 && ctype_digit($v) ? (int) $v : 0;
    }
    /** "12,000원" typed by an operator → "12000" (anything else stays as typed so the library can say what is wrong) */
    private static function digits(string $s): string
    {
        $t = (string) preg_replace('/[\s,원₩]+/u', '', $s);
        return $t !== '' && ctype_digit($t) ? (string) (int) $t : trim($s);
    }
    /** a link inside the tab: "./?tab=allot&…" (relative: the admin folder may have any name) */
    private static function href(array $q): string
    {
        return './?' . http_build_query(['tab' => 'allot'] + array_filter($q, function ($v) { return $v !== '' && $v !== null && $v !== 0; }));
    }
    private static function hidden(array $kv): string
    {
        $h = '';
        foreach ($kv as $k => $v) if ($v !== '' && $v !== null && $v !== 0) $h .= '<input type="hidden" name="' . self::e($k) . '" value="' . self::e($v) . '">';
        return $h;
    }
    /** the start of a POST form: token, action, tab and the place to come back to */
    private static function open(string $action, array $place = [], string $cls = 'stack', string $id = ''): string
    {
        return '<form method="post" action="./" class="' . self::e($cls) . '"' . ($id !== '' ? ' id="' . self::e($id) . '"' : '') . '><input type="hidden" name="_csrf" value="' . self::e(self::$token) . '">'
            . '<input type="hidden" name="action" value="' . self::e($action) . '"><input type="hidden" name="tab" value="allot">' . self::hidden($place);
    }
    /** a one-button POST form */
    private static function button(string $action, string $label, array $fields = [], string $cls = 'btn'): string
    {
        return self::open($action, $fields, 'inline') . '<button type="submit" class="' . self::e($cls) . '">' . self::e($label) . '</button></form>';
    }
    /**
     * One form for the buttons of every row of a list (a page then carries one token, not one per row): the form itself
     * is empty; a row's button names it with the `form` attribute and says what to do in `pick` = "<row id>:<what>".
     */
    private static function rowForm(string $id, string $action, array $place): string { return self::open($action, $place, 'inline', $id) . '</form>'; }
    private static function rowBtn(string $form, int $id, string $what, string $label, string $cls = 'btn'): string
    {
        return '<button type="submit" form="' . self::e($form) . '" name="pick" value="' . $id . ':' . self::e($what) . '" class="' . self::e($cls) . '">' . self::e($label) . '</button>';
    }
    /** `pick` of a row button → [row id, what] (400 when it is not one) */
    private static function pick(array $p): array
    {
        if (!preg_match('/^([1-9]\d{0,14}):([a-z0-9_]{1,16})$/', self::s($p, 'pick'), $m)) throw new ApiException(400, 'INVALID_INPUT', '목록에서 버튼을 다시 눌러 주세요.');
        return [(int) $m[1], $m[2]];
    }
    /**
     * A list as a table that turns into stacked cards on a phone (every cell carries its column name in data-th).
     * $head: column names; $rows: [['attr' => ' class="…"', 'cells' => [html, …]], …] — the cells are finished HTML.
     */
    private static function tbl(array $head, array $rows): string
    {
        $h = '<div class="tablewrap"><table class="rt"><thead><tr>';
        foreach ($head as $c) $h .= '<th>' . self::e($c) . '</th>';
        $h .= '</tr></thead><tbody>';
        foreach ($rows as $r) {
            $h .= '<tr' . (isset($r['attr']) ? $r['attr'] : '') . '>';
            foreach ($r['cells'] as $i => $cell) {
                $cls = is_array($cell) && $cell[1] !== '' ? ' class="' . self::e($cell[1]) . '"' : '';
                $h .= '<td' . $cls . ' data-th="' . self::e(isset($head[$i]) ? $head[$i] : '') . '">' . (is_array($cell) ? $cell[0] : $cell) . '</td>';
            }
            $h .= '</tr>';
        }
        return $h . '</tbody></table></div>';
    }
    private static function select(string $name, array $options, string $current, string $label = ''): string
    {
        $h = '<select name="' . self::e($name) . '"' . ($label !== '' ? ' aria-label="' . self::e($label) . '"' : '') . '>';
        foreach ($options as $v => $text) $h .= '<option value="' . self::e($v) . '"' . ((string) $v === $current ? ' selected' : '') . '>' . self::e($text) . '</option>';
        return $h . '</select>';
    }
    private static function badge(string $text, string $cls = ''): string { return '<span class="badge' . ($cls !== '' ? ' ' . self::e($cls) : '') . '">' . self::e($text) . '</span>'; }
    /** [label, class] of a status word from one of the maps above (an unknown word is shown as it is) */
    private static function st(array $map, string $k): string
    {
        return isset($map[$k]) ? self::badge($map[$k][0], $map[$k][1]) : self::badge($k);
    }
    /** ms → "3일 2시간" · "5시간 10분" · "12분" */
    public static function span(int $ms): string
    {
        $m = (int) floor(max(0, $ms) / 60000);
        if ($m >= 1440) return intdiv($m, 1440) . '일' . (intdiv($m % 1440, 60) > 0 ? ' ' . intdiv($m % 1440, 60) . '시간' : '');
        if ($m >= 60) return intdiv($m, 60) . '시간' . ($m % 60 > 0 ? ' ' . ($m % 60) . '분' : '');
        return max(1, $m) . '분';
    }
    private static function won(int $n): string { return self::n($n) . '원'; }
    /** "매년 120,000원 · 12개월" */
    private static function plan(string $period, int $price, int $term): string
    {
        $p = isset(self::PERIOD[$period]) ? self::PERIOD[$period] : $period;
        return ($price > 0 ? $p . ' ' . self::won($price) : '무료') . ' · ' . ($term > 0 ? $term . '개월' : '기간 정하지 않음');
    }
    private static function kind(string $k): string
    {
        return (isset(self::KIND_ICON[$k]) ? self::KIND_ICON[$k] . ' ' : '') . (isset(Allot::KIND_NAMES[$k]) ? Allot::KIND_NAMES[$k] : $k);
    }
    private static function sum(): array
    {
        if (self::$sum === null) self::$sum = Allot::adminSummary();
        return self::$sum;
    }
    /** "YYYY-MM-DD" of a date input → ms at noon of that day (0 = empty; -1 = not a date) */
    private static function dateIn(string $v): int
    {
        $v = trim($v);
        if ($v === '') return 0;
        $ms = Allot::parseDate($v);
        return $ms > 0 ? $ms + 12 * 3600000 : -1;
    }

    /**
     * Whole percents of a bar: $counts (name => how many) of $total → name => 0…100. A count above zero is at least 1 %
     * (a single taken jar of 1,000 must still be visible) and the sum never passes 100.
     */
    public static function percents(array $counts, int $total): array
    {
        $out = [];
        $sum = 0;
        foreach ($counts as $k => $n) {
            $n = max(0, (int) $n);
            $p = $total > 0 && $n > 0 ? max(1, (int) round($n * 100 / $total)) : 0;
            $out[$k] = min(100, $p);
            $sum += $out[$k];
        }
        while ($sum > 100) { // rounding up the small ones: the largest part gives it back
            $big = null;
            foreach ($out as $k => $p) if ($big === null || $p > $out[$big]) $big = $k;
            if ($big === null || $out[$big] <= 1) break;
            $out[$big]--;
            $sum--;
        }
        return $out;
    }

    /** the stacked bar of a zone / a kind / everything: 분양 · 보류 · 닫힘, the rest of the track is free */
    private static function bar(array $c): string
    {
        $total = max(0, (int) $c['total']);
        $p = self::percents(['l' => $c['leased'], 'h' => $c['held'], 'c' => $c['closed']], $total);
        $free = max(0, 100 - $p['l'] - $p['h'] - $p['c']);
        $label = '분양 ' . $p['l'] . '%, 보류 ' . $p['h'] . '%, 닫힘 ' . $p['c'] . '%, 빈자리 ' . $free . '%';
        return '<div class="occbar" role="img" aria-label="' . self::e($label) . '"><i class="l w' . $p['l'] . '"></i><i class="h w' . $p['h'] . '"></i><i class="c w' . $p['c'] . '"></i></div>';
    }

    // ================================================================== the place of a page (validated query) and the way back
    /**
     * The known query fields of the tab, validated — from a GET (the page) or a POST (the place a form came from).
     * Unknown fields and unusable values are dropped; nothing of it is ever echoed without e().
     */
    public static function place(array $in): array
    {
        $out = ['sec' => isset(self::SECTIONS[self::s($in, 'sec')]) ? self::s($in, 'sec') : 'status'];
        $word = function (string $k, array $allowed) use ($in, &$out): void { $v = self::s($in, $k); if ($v !== '' && in_array($v, $allowed, true)) $out[$k] = $v; };
        $word('st', ['open', 'held', 'leased', 'closed', 'live', 'pending', 'active', 'overdue', 'ended', 'canceled', 'waiting', 'offered', 'converted', 'expired', 'queued', 'sent', 'seen', 'all']);
        $word('kind', Allot::KINDS);
        $word('flag', ['cancelreq', 'expiring', 'due']);
        $word('off', ['1']);
        $word('edit', ['1']);
        $zone = strtolower(self::s($in, 'zone'));
        if (preg_match('/^[a-z0-9]{1,12}$/', $zone)) $out['zone'] = $zone;
        $s = self::s($in, 's');
        if (preg_match('/^[0-9a-f]{8}$/', $s)) $out['s'] = $s;
        $dc = self::s($in, 'dc');
        if (preg_match('/^\d{1,15}_\d{1,15}$/', $dc)) $out['dc'] = $dc;
        $tpl = self::s($in, 'tpl');
        if (preg_match('/^[a-z]{1,12}$/', $tpl)) $out['tpl'] = $tpl;
        $u = strtolower(self::s($in, 'u'));
        if (preg_match('/^[a-z0-9]{1,12}_\d{1,6}$/', $u)) $out['u'] = $u; // a unit code with "_" for "-" (j01_0007)
        foreach (['after', 'before', 'con', 'cust'] as $k) { $v = self::id($in, $k); if ($v > 0) $out[$k] = $v; }
        return $out;
    }

    /** where a form came from → the query of the 303 (values are lower-case words and integers only) */
    public static function back(array $post): array
    {
        $p = self::place($post);
        unset($p['tpl'], $p['edit']);
        return $p;
    }

    /** a unit code as an address word and back: "J01-0007" ↔ "j01_0007" */
    private static function unitWord(string $code): string { return strtolower(str_replace('-', '_', $code)); }
    private static function unitCode(string $word): string { return strtoupper(str_replace('_', '-', $word)); }

    // ================================================================== the view
    public static function view(Ctx $c, array $get, string $token): string
    {
        self::$token = $token;
        $q = self::place($get);
        $sec = $q['sec'];
        $sum = self::sum();
        $marks = ['contracts' => (int) $sum['pending'], 'wait' => (int) $sum['offered'], 'notices' => (int) $sum['noticesOffline']];
        $h = '<nav class="subtabs" aria-label="분양 관리 메뉴">';
        foreach (self::SECTIONS as $k => $t) {
            $h .= '<a href="' . self::e(self::href(['sec' => $k === 'status' ? '' : $k])) . '"' . ($k === $sec ? ' class="on" aria-current="page"' : '') . '><span aria-hidden="true">' . $t[0] . '</span> ' . self::e($t[1])
                . (!empty($marks[$k]) ? ' <span class="badge warn">' . self::e(self::n($marks[$k])) . '</span>' : '') . '</a>';
        }
        $h .= '</nav>';
        if (!Allot::enabled()) {
            $h .= '<p class="banner">⏸️ <b>지금은 분양을 쉬고 있어요.</b> 체험관의 분양 화면과 신청이 닫혀 있고 자동화도 멈춰 있어요. 다시 열려면 <a href="' . self::e(self::href(['sec' => 'auto'])) . '">⚙️ 자동화 → 분양 받기</a>를 켜 주세요.</p>';
        }
        $a = is_array($c->user) ? $c->user : [];
        // a revealed record is for the customer page that asked for it: any other page of the tab throws it away unseen
        if (!($sec === 'customers' && isset($q['cust'])) && Session::get('allot_reveal') !== null) Session::set('allot_reveal', null);
        switch ($sec) {
            case 'zones': return $h . self::viewZones($q);
            case 'units': return $h . self::viewUnits($q, $get);
            case 'contracts': return $h . (isset($q['con']) ? self::viewContract((int) $q['con'], $q) : self::viewContracts($q));
            case 'customers': return $h . (isset($q['cust']) ? self::viewCustomer((int) $q['cust'], $q, $a) : self::viewCustomers($q));
            case 'wait': return $h . self::viewWait($q);
            case 'notices': return $h . self::viewNotices($q);
            case 'care': return $h . self::viewCare($q);
            case 'csv': return $h . self::viewCsv($q, $a);
            case 'auto': return $h . self::viewAuto($q, $get);
        }
        return $h . self::viewStatus($q);
    }

    /** the card of the first tab: "분양: 임대 n / 10,000 · 승인 대기 n" */
    public static function card(): string
    {
        $s = self::sum();
        $u = $s['units'];
        $h = '<section class="card"><h3>🏺 분양 관리 ' . (Allot::enabled() ? '' : self::badge('쉬는 중', 'warn')) . '</h3>';
        if ((int) $u['total'] === 0) {
            return $h . '<p class="dim">아직 분양할 자리(항아리 · 밭 · 창고)를 만들지 않았어요.</p><p class="row"><a class="btn primary" href="' . self::e(self::href([])) . '">🏺 분양 관리 시작하기 →</a></p></section>';
        }
        $h .= '<p class="allotline">분양: 임대 <b>' . self::e(self::n($u['leased'])) . '</b> / ' . self::e(self::n($u['total'])) . ' · 승인 대기 <b>' . self::e(self::n($s['pending'])) . '</b></p>' . self::bar($u)
            . '<p class="dim small">빈자리 ' . self::e(self::n($u['open'])) . ' · 보류 ' . self::e(self::n($u['held'])) . ' · 닫힘 ' . self::e(self::n($u['closed'])) . ' · 연체 ' . self::e(self::n($s['overdue']))
            . ' · 대기자 ' . self::e(self::n($s['waiting'])) . ' — ' . self::e(self::tickLine($s)) . '</p>'
            . '<p class="row"><a class="btn' . ((int) $s['pending'] > 0 ? ' primary' : ' ghost') . '" href="' . self::e(self::href(['sec' => 'contracts', 'st' => 'pending'])) . '">⏳ 승인 대기 ' . self::e(self::n($s['pending'])) . '건 보기 →</a>'
            . '<a class="btn ghost" href="' . self::e(self::href([])) . '">🏺 분양 현황 보기 →</a></p></section>';
        return $h;
    }

    /** "마지막 자동화: 12분 전" */
    private static function tickLine(array $s): string
    {
        if ($s['tickAgeMs'] === null) return '자동화가 아직 한 번도 돌지 않았어요';
        return '마지막 자동화: ' . self::span((int) $s['tickAgeMs']) . ' 전';
    }

    /** is the automation late? (no run yet, or none for two hours — the scheduler line runs hourly, the lazy run every few minutes) */
    private static function tickLate(array $s): bool
    {
        return Allot::enabled() && (int) $s['units']['total'] > 0 && ($s['tickAgeMs'] === null || (int) $s['tickAgeMs'] > 2 * 3600000);
    }

    // ------------------------------------------------------------------ 📊 현황
    private static function viewStatus(array $q): string
    {
        $s = self::sum();
        $u = $s['units'];
        if ((int) $s['units']['zones'] === 0) return self::firstSteps();
        $rate = (int) $u['total'] > 0 ? round((int) $u['leased'] * 100 / (int) $u['total'], 1) : 0;
        $h = '<div class="tiles">';
        $tiles = [['🏺', '전체 자리', self::n($u['total'])], ['🤝', '분양 중', self::n($u['leased'])], ['⏳', '보류 (신청 · 제안)', self::n($u['held'])], ['🟢', '빈자리', self::n($u['open'])],
            ['🚫', '닫아 둔 자리', self::n($u['closed'])], ['📈', '분양률', rtrim(rtrim(number_format($rate, 1), '0'), '.') . '%']];
        foreach ($tiles as $i => $t) $h .= '<div class="tile d' . ($i % 7) . '"><span class="ico" aria-hidden="true">' . $t[0] . '</span><b>' . self::e($t[2]) . '</b><small>' . self::e($t[1]) . '</small></div>';
        $h .= '</div><div class="grid2">' . self::todoCard($s) . self::autoCard($s) . '</div>';

        // occupancy by zone, grouped by kind
        $h .= '<section class="card"><h3>🗺️ 구역별 분양 현황</h3><p class="legend small"><span><i class="sw l"></i> 분양</span><span><i class="sw h"></i> 보류</span><span><i class="sw c"></i> 닫힘</span><span><i class="sw o"></i> 빈자리</span></p>';
        foreach (Allot::KINDS as $kind) {
            $zones = array_values(array_filter($s['zones'], function ($z) use ($kind) { return $z['kind'] === $kind; }));
            if (!$zones) continue;
            $k = $u['byKind'][$kind];
            $h .= '<div class="occgroup"><h4>' . self::e(self::kind($kind)) . ' <span class="dim small">분양 ' . self::e(self::n($k['leased'])) . ' / ' . self::e(self::n($k['total'])) . ' · 빈자리 ' . self::e(self::n($k['open'])) . '</span></h4>';
            foreach ($zones as $z) {
                $c = ['total' => $z['units'], 'leased' => $z['leased'], 'held' => $z['held'], 'closed' => $z['closed']];
                $h .= '<div class="occ"><div class="occhead"><a href="' . self::e(self::href(['sec' => 'units', 'zone' => strtolower($z['code'])])) . '"><b>' . self::e($z['name']) . '</b></a> <code>' . self::e($z['code']) . '</code> '
                    . ($z['isOpen'] ? self::badge('신청 받는 중', 'ok') : self::badge('신청 닫힘'))
                    . ' <span class="dim small">분양 ' . self::e(self::n($z['leased'])) . ' · 보류 ' . self::e(self::n($z['held'])) . ' · 빈자리 ' . self::e(self::n($z['open'])) . ' / ' . self::e(self::n($z['units'])) . '</span></div>'
                    . self::bar($c) . '</div>';
            }
            $h .= '</div>';
        }
        $h .= '<p class="dim small">구역 이름을 누르면 그 구역의 자리 목록이 열려요. 가격 · 기간 · 신청 받기는 <a href="' . self::e(self::href(['sec' => 'zones'])) . '">🗺️ 구역</a>에서 바꿔요.</p></section>';

        // the last days
        $st = Allot::stats(7);
        $h .= '<section class="card"><h3>📈 최근 7일</h3>';
        if (!$st['days']) {
            $h .= '<p class="empty">🍃 아직 통계가 없어요. 자동화가 한 번 돌면 오늘 숫자부터 쌓여요.</p>';
        } else {
            $h .= '<div class="tablewrap"><table><thead><tr><th>날짜</th><th>분양</th><th>보류</th><th>빈자리</th><th>승인 대기</th><th>진행 중</th><th>연체</th><th>그날 끝남</th><th>그날 들어온 돈</th></tr></thead><tbody>';
            foreach (array_reverse($st['days']) as $d) {
                $h .= '<tr><td class="nowrap">' . self::e($d['day']) . '</td><td>' . self::e(self::n($d['leased'])) . '</td><td>' . self::e(self::n($d['held'])) . '</td><td>' . self::e(self::n($d['open'])) . '</td><td>'
                    . self::e(self::n($d['pending'])) . '</td><td>' . self::e(self::n($d['active'])) . '</td><td>' . self::e(self::n($d['overdue'])) . '</td><td>' . self::e(self::n($d['ended'])) . '</td><td class="nowrap">' . self::e(self::won((int) $d['revenue'])) . '</td></tr>';
            }
            $h .= '</tbody></table></div><p class="dim small">들어온 돈 = 그날 기록한 입금에서 그날 환불한 금액을 뺀 값이에요. 7일 합계 ' . self::e(self::won((int) $st['revenueTotal'])) . '.</p>';
        }
        return $h . '</section>';
    }

    /** an installation without zones: what allotment is and the two ways to begin */
    private static function firstSteps(): string
    {
        return '<section class="card hero"><div class="mascot" aria-hidden="true">🏺</div><h2>분양 관리를 시작해요</h2>'
            . '<p class="dim">항아리 · 밭 · 창고를 한 칸씩 <b>자리(단위)</b>로 만들어 두고, 누가 어느 자리를 언제까지 쓰는지 · 돈을 냈는지 · 알림을 보냈는지를 이곳에서 관리해요.</p>'
            . '<ol class="steps"><li><b>구역과 자리 만들기</b> — 아래 버튼 하나로 기본 구성이 만들어져요. 가격과 기간은 <b>예시</b>라서 꼭 고쳐야 해요.</li>'
            . '<li><b>가격 · 기간 · 안내 문구 확인</b> — 🗺️ 구역에서 가격을, ⚙️ 자동화에서 규칙과 안내 문구를 확인해요.</li>'
            . '<li><b>신청 받기 켜기</b> — 준비된 구역만 "신청 받기"를 켜요. 그때부터 체험관에 그 구역이 열려요.</li>'
            . '<li><b>지금 쓰는 장부 옮기기</b> — 이미 분양한 자리가 있으면 📦 가져오기로 엑셀 장부를 붙여 넣어요.</li></ol>'
            . '<div class="row">' . self::button('allot_seed', '🏺 기본 구성 만들기 — 1만 자리 (항아리 6,000 · 밭 3,000 · 창고 1,000)', ['preset' => 'default'], 'btn primary')
            . self::button('allot_seed', '🧪 작은 시험 구성 — 180자리', ['preset' => 'small'], 'btn ghost') . '</div>'
            . '<p class="dim small">만든 구역은 모두 <b>신청 닫힘</b>으로 시작해요 (아무도 신청할 수 없어요). 구역을 하나씩 직접 만들려면 <a href="' . self::e(self::href(['sec' => 'zones'])) . '">🗺️ 구역</a>으로 가세요. '
            . '서버 컴퓨터에서 <code>php cli/tfm.php allot:seed</code> 를 실행해도 같아요.</p></section>';
    }

    /** 📌 오늘 할 일 — what waits for the operator, most urgent first; every line links to its list */
    private static function todoCard(array $s): string
    {
        $now = Clock::ms();
        $rows = [];
        $add = function (string $icon, string $text, int $n, array $link, string $sub = '', string $cls = 'warn') use (&$rows): void {
            if ($n > 0) $rows[] = [$icon, $text, $n, $link, $sub, $cls];
        };
        $sub = (int) $s['pendingOldest'] > 0 ? '가장 오래 기다린 신청: ' . self::span($now - (int) $s['pendingOldest']) . ' 전' : '';
        if ((int) $s['pendingPaid'] > 0) $sub .= ($sub !== '' ? ' · ' : '') . '입금 기록이 있는 신청 ' . self::n($s['pendingPaid']) . '건';
        $add('⏳', '승인을 기다리는 신청', (int) $s['pending'], ['sec' => 'contracts', 'st' => 'pending'], $sub);
        $add('⌛', '24시간 안에 자동 취소되는 신청 (입금 기록 없음)', (int) $s['holdsExpiring'], ['sec' => 'contracts', 'st' => 'pending'], '입금을 확인했으면 승인하거나 입금을 기록해 주세요.', 'fail');
        $add('⚠️', '연체된 계약', (int) $s['overdue'], ['sec' => 'contracts', 'st' => 'overdue'], '납부 기한과 유예 기간이 지났어요. 연락해 보세요.', 'fail');
        $add('💰', '7일 안에 납부 기한이 오는 계약', (int) $s['dueSoon'], ['sec' => 'contracts', 'flag' => 'due'], '입금되면 그 계약에서 "입금 기록"을 눌러요.');
        $add('📅', '30일 안에 끝나는 계약 (자동 연장 아님)', (int) $s['expiring30'], ['sec' => 'contracts', 'flag' => 'expiring'], '이어서 쓸지 물어보고 연장하거나 끝내요.');
        $add('🙋', '해지를 요청한 계약', (int) $s['cancelRequests'], ['sec' => 'contracts', 'flag' => 'cancelreq'], '확인하고 연락한 뒤 계약을 끝내요.');
        $add('🪑', '자리를 제안받고 답을 기다리는 대기자', (int) $s['offered'], ['sec' => 'wait', 'st' => 'offered'], '기다리는 사람은 모두 ' . self::n($s['waiting']) . '명이에요.', 'gold');
        $add('📞', '직접 연락해야 하는 알림 (체험관 계정이 없는 고객)', (int) $s['noticesOffline'], ['sec' => 'notices', 'off' => '1'], '전화로 알린 뒤 "알렸어요"를 눌러요.');
        $add('↩️', '취소됐는데 받은 돈이 남은 신청', (int) $s['refundDue'], ['sec' => 'contracts', 'st' => 'canceled'], '환불했는지 확인해 주세요.', 'fail');
        $issues = isset($s['lastRun']['summary']['issues']) && is_array($s['lastRun']['summary']['issues']) ? count($s['lastRun']['summary']['issues']) : 0;
        $add('🔧', '점검에서 직접 확인이 필요한 항목', $issues, ['sec' => 'auto'], '자리와 계약이 서로 맞지 않는 곳이 있어요.', 'fail');
        $h = '<section class="card"><h3>📌 오늘 할 일</h3>';
        if (!$rows) return $h . '<p class="empty">🎉 지금 꼭 해야 할 일이 없어요.</p><p class="dim small">기다리는 사람 ' . self::e(self::n($s['waiting'])) . '명 · 진행 중인 계약 ' . self::e(self::n($s['active'])) . '건.</p></section>';
        $h .= '<ul class="todolist">';
        foreach ($rows as $r) {
            $h .= '<li><span class="ico" aria-hidden="true">' . $r[0] . '</span><div><a href="' . self::e(self::href($r[3])) . '"><b>' . self::e($r[1]) . '</b></a>' . ($r[4] !== '' ? '<br><span class="dim small">' . self::e($r[4]) . '</span>' : '')
                . '</div><span class="badge ' . self::e($r[5]) . '">' . self::e(self::n($r[2])) . '</span></li>';
        }
        return $h . '</ul><p class="dim small">진행 중인 계약 ' . self::e(self::n($s['active'])) . '건 · 기다리는 사람 ' . self::e(self::n($s['waiting'])) . '명.</p></section>';
    }

    /** 🤖 the last run of the automation and the button that runs it now */
    private static function autoCard(array $s): string
    {
        $run = $s['lastRun'];
        $late = self::tickLate($s);
        $h = '<section class="card"><h3>🤖 자동화 ' . ($late ? self::badge('오래 돌지 않았어요', 'fail') : ($run !== null && !$run['ok'] ? self::badge('지난 실행에 문제', 'warn') : self::badge('정상', 'ok'))) . '</h3>';
        if ($run === null) {
            $h .= '<p class="dim">아직 한 번도 돌지 않았어요. 아래 버튼을 눌러 한 번 돌려 보세요.</p>';
        } else {
            $h .= '<dl class="facts"><dt>마지막 실행</dt><dd>' . self::e(self::at($run['startedAt'])) . ' <span class="dim small">(' . self::e($s['tickAgeMs'] !== null ? self::span((int) $s['tickAgeMs']) . ' 전' : '-') . ')</span></dd>'
                . '<dt>누가 돌렸나</dt><dd>' . self::e(isset(self::TICK_SOURCE[$run['source']]) ? self::TICK_SOURCE[$run['source']] : $run['source']) . '</dd>'
                . '<dt>결과</dt><dd>' . ($run['ok'] ? '✅ 잘 끝났어요' : '⚠️ 일부 단계에 문제가 있었어요') . '</dd><dt>한 일</dt><dd>' . self::e(self::stepsText($run['summary'])) . '</dd></dl>';
        }
        if ($late) $h .= '<p class="notice">자동화가 2시간 넘게 돌지 않았어요. 서버 컴퓨터의 작업 스케줄러에 <code>php cli/tfm.php allot:tick</code> 이 등록되어 있는지 확인해 주세요 (⚙️ 자동화에 방법이 있어요).</p>';
        return $h . '<p class="dim small">자동화는 기한 지난 신청 정리 · 납부와 만료 안내 · 연체 표시 · 대기자에게 자리 제안 · 통계 · 점검을 알아서 해요.</p>'
            . '<div class="row">' . self::button('allot_tick', '▶️ 지금 실행', [], 'btn primary') . '<a class="btn ghost" href="' . self::e(self::href(['sec' => 'auto'])) . '">⚙️ 규칙 · 기록 보기</a></div></section>';
    }

    /** what a run did, in words: "납부 · 만료 안내 3 · 연체 표시 1" (steps that did nothing are left out) */
    private static function stepsText(array $summary): string
    {
        $steps = isset($summary['steps']) && is_array($summary['steps']) ? $summary['steps'] : [];
        $parts = [];
        foreach (self::TICK_STEPS as $k => $label) {
            if ($k === 'stats') continue;
            if (isset($steps[$k]) && (int) $steps[$k] > 0) $parts[] = $label . ' ' . self::n($steps[$k]);
        }
        return $parts ? implode(' · ', $parts) : '바꿀 것이 없었어요';
    }

    // ------------------------------------------------------------------ 🗺️ 구역
    private static function zoneForm(?array $z): string
    {
        $new = $z === null;
        $v = function (string $k, $d = '') use ($z) { return $z !== null && isset($z[$k]) ? $z[$k] : $d; };
        $h = self::open('allot_zone_save', ['sec' => 'zones'] + ($new ? [] : ['id' => (int) $z['id']]));
        if ($new) {
            $h .= '<label>구역 번호 (영문 대문자 · 숫자 1~12자, 예: J07 — 나중에 바꿀 수 없어요)<input name="code" required maxlength="12" pattern="[A-Za-z0-9]{1,12}" autocomplete="off" spellcheck="false"></label>'
                . '<label>종류 (나중에 바꿀 수 없어요)' . self::select('kind', ['jar' => '🏺 항아리', 'plot' => '🥬 밭', 'store' => '🏚️ 창고'], 'jar') . '</label>';
        }
        $h .= '<label>이름 (체험관에 보여요)<input name="name" value="' . self::e($v('name')) . '" maxlength="60"' . ($new ? ' placeholder="예: 장독대 7구역"' : ' required') . '></label>'
            . '<div class="fgrid"><label>자리 수 (0~5,000)<input name="capacity" value="' . self::e($v('units', $new ? '100' : '0')) . '" inputmode="numeric" maxlength="5" required></label>'
            . '<label>한 줄 칸 수 (지도 모양)<input name="cols" value="' . self::e($v('cols', '40')) . '" inputmode="numeric" maxlength="3"></label>'
            . '<label>보이는 순서<input name="sort" value="' . self::e($v('sort', '')) . '" inputmode="numeric" maxlength="5"' . ($new ? ' placeholder="비우면 맨 뒤"' : '') . '></label></div>'
            . '<div class="fgrid"><label>금액 (원 · 납부 한 번마다)<input name="price" value="' . self::e($v('price', '0')) . '" inputmode="numeric" maxlength="12"></label>'
            . '<label>납부 주기' . self::select('period', ['year' => '매년', 'month' => '매달', 'once' => '한 번만'], (string) $v('period', 'year')) . '</label>'
            . '<label>계약 기간 (개월 · 0 = 정하지 않음)<input name="termMonths" value="' . self::e($v('termMonths', '12')) . '" inputmode="numeric" maxlength="3"></label></div>'
            . '<label class="check"><input type="checkbox" name="isOpen" value="1"' . ($v('isOpen', false) ? ' checked' : '') . '> 신청 받기 (체험관에서 이 구역을 신청할 수 있어요)</label>'
            . '<label>운영자 메모 (체험관에는 보이지 않아요)<input name="note" value="' . self::e($v('note')) . '" maxlength="200"></label>'
            . '<button class="btn primary" type="submit">' . ($new ? '➕ 구역 만들기' : '💾 저장') . '</button></form>';
        return $h;
    }

    private static function viewZones(array $q): string
    {
        $zones = self::sum()['zones'];
        $h = '<section class="card"><h3>🗺️ 구역 <span class="dim small">' . self::e(count($zones)) . '곳 · 자리 ' . self::e(self::n(self::sum()['units']['total'])) . '개</span></h3>'
            . '<p class="dim small">구역은 자리를 묶는 단위예요 (예: 장독대 1구역 = 항아리 1,000개). <b>금액 · 납부 주기 · 기간</b>은 구역마다 정하고, 바꾸면 <b>그 뒤에 만드는 계약</b>부터 적용돼요 (이미 맺은 계약은 그대로예요). '
            . '자리 수를 늘리면 뒷번호가 생기고, 줄이면 뒷번호부터 지워요 — 쓰고 있거나 계약 기록이 있는 자리는 지울 수 없어요.</p>';
        if (!$zones) {
            $h .= '<p class="empty">🍃 아직 구역이 없어요.</p>';
        } else {
            $rows = [];
            foreach ($zones as $z) {
                $sample = $z['note'] === Allot::SAMPLE_NOTE;
                $zid = (int) $z['id'];
                $rows[] = ['attr' => ' class="zone" id="z-' . self::e(strtolower($z['code'])) . '"', 'cells' => [
                    '<code>' . self::e($z['code']) . '</code><br><span class="dim small">' . self::e(self::kind($z['kind'])) . '</span>',
                    '<a href="' . self::e(self::href(['sec' => 'units', 'zone' => strtolower($z['code'])])) . '"><b>' . self::e($z['name']) . '</b></a>' . ($z['note'] !== '' ? '<br><span class="dim small">' . self::e($z['note']) . '</span>' : ''),
                    [self::e(self::n($z['units'])), 'nowrap'],
                    [self::bar(['total' => $z['units'], 'leased' => $z['leased'], 'held' => $z['held'], 'closed' => $z['closed']])
                        . '<span class="dim small">분양 ' . self::e(self::n($z['leased'])) . ' · 보류 ' . self::e(self::n($z['held'])) . ' · 빈자리 ' . self::e(self::n($z['open'])) . ' · 닫힘 ' . self::e(self::n($z['closed'])) . '</span>', 'barcell'],
                    self::e(self::plan($z['period'], (int) $z['price'], (int) $z['termMonths'])) . ($sample ? '<br>' . self::badge('예시 — 확인해 주세요', 'warn') : ''),
                    $z['isOpen'] ? self::badge('받는 중', 'ok') . ' ' . self::rowBtn('zrow', $zid, 'close', '닫기', 'btn ghost sm') : self::badge('닫힘') . ' ' . self::rowBtn('zrow', $zid, 'open', '신청 받기', 'btn sm'),
                    ['<details class="acts"' . (isset($q['zone']) && $q['zone'] === strtolower($z['code']) && isset($q['edit']) ? ' open' : '') . '><summary>⚙️ 고치기</summary><div class="zoneedit">' . self::zoneForm($z) . '</div></details>', 'acts'],
                ]];
            }
            $h .= self::tbl(['번호', '이름', '자리', '분양 현황', '금액 · 주기 · 기간', '신청', '관리'], $rows) . self::rowForm('zrow', 'allot_zone_open', ['sec' => 'zones']);
        }
        $h .= '</section><div class="grid2"><section class="card"><h3>➕ 새 구역</h3>' . self::zoneForm(null) . '</section>'
            . '<section class="card"><h3>🧰 한 번에 만들기</h3><p class="dim small">정해 둔 구성의 구역 가운데 <b>아직 없는 것만</b> 만들고, 자리가 모자란 구역은 채워요. 이미 있는 구역의 이름 · 가격은 건드리지 않아요. 새로 만든 구역은 신청 닫힘 · 예시 가격으로 시작해요.</p>'
            . '<div class="row">' . self::button('allot_seed', '🏺 기본 구성 (1만 자리)', ['preset' => 'default', 'sec' => 'zones'], 'btn')
            . self::button('allot_seed', '🧪 작은 시험 구성 (180자리)', ['preset' => 'small', 'sec' => 'zones'], 'btn ghost') . '</div>'
            . '<p class="dim small">기본 구성 = 장독대 6구역 × 1,000 + 텃밭 3구역 × 1,000 + 창고 2동 × 500. 구역은 지울 수 없어요 (지난 계약 기록이 남아야 해서요) — 쓰지 않는 구역은 신청을 닫고 자리 수를 0으로 줄여요.</p></section></div>';
        return $h;
    }

    // ------------------------------------------------------------------ 🏺 단위 (자리)
    private static function zoneOptions(bool $lower = true): array
    {
        $o = ['' => '모든 구역'];
        foreach (self::sum()['zones'] as $z) $o[$lower ? strtolower($z['code']) : $z['code']] = $z['code'] . ' · ' . $z['name'];
        return $o;
    }

    private static function viewUnits(array $q, array $get): string
    {
        $st = isset($q['st']) && isset(self::UNIT_STATUS[$q['st']]) ? $q['st'] : '';
        $kind = isset($q['kind']) ? $q['kind'] : '';
        $zone = isset($q['zone']) ? $q['zone'] : '';
        $code = strtoupper(trim(mb_substr(self::s($get, 'q'), 0, 24)));
        if (!preg_match('/^[A-Z0-9\-]{1,24}$/', $code)) $code = '';
        $after = isset($q['after']) ? (int) $q['after'] : 0;
        $here = ['sec' => 'units', 'st' => $st, 'kind' => $kind, 'zone' => $zone, 'q' => $code];
        $h = '';
        if ($zone !== '') {
            foreach (self::sum()['zones'] as $z) {
                if (strtolower($z['code']) !== $zone) continue;
                $h .= '<section class="card"><h3>' . self::e(self::kind($z['kind'])) . ' · ' . self::e($z['name']) . ' <code>' . self::e($z['code']) . '</code> ' . ($z['isOpen'] ? self::badge('신청 받는 중', 'ok') : self::badge('신청 닫힘')) . '</h3>'
                    . self::bar(['total' => $z['units'], 'leased' => $z['leased'], 'held' => $z['held'], 'closed' => $z['closed']])
                    . '<p class="dim small">분양 ' . self::e(self::n($z['leased'])) . ' · 보류 ' . self::e(self::n($z['held'])) . ' · 빈자리 ' . self::e(self::n($z['open'])) . ' · 닫힘 ' . self::e(self::n($z['closed'])) . ' / ' . self::e(self::n($z['units']))
                    . ' — ' . self::e(self::plan($z['period'], (int) $z['price'], (int) $z['termMonths'])) . ' · <a href="' . self::e(self::href(['sec' => 'zones', 'zone' => $zone, 'edit' => '1'])) . '#z-' . self::e($zone) . '">구역 고치기</a></p>'
                    . self::zoneMap($z) . '</section>';
            }
        }
        $r = Allot::listUnits(['kind' => $kind, 'zone' => $zone, 'status' => $st, 'q' => $code], self::ROWS, $after);
        $h .= '<section class="card"><h3>🏺 단위 — 자리 하나하나</h3>'
            . '<p class="dim small">단위는 항아리 · 밭 · 창고의 한 칸(자리)이에요. 번호는 <code>구역-순번</code> 모양이에요 (예: J01-0007). <b>닫기</b> = 분양하지 않는 자리(깨진 항아리 등), <b>보류</b> = 잠시 잡아 두기. 계약이 걸린 자리는 📄 계약에서 다뤄요.</p>'
            . '<form method="get" action="./" class="search"><input type="hidden" name="tab" value="allot"><input type="hidden" name="sec" value="units">'
            . self::select('kind', ['' => '모든 종류', 'jar' => '🏺 항아리', 'plot' => '🥬 밭', 'store' => '🏚️ 창고'], $kind, '종류') . self::select('zone', self::zoneOptions(), $zone, '구역')
            . self::select('st', ['' => '모든 상태', 'open' => '빈자리', 'held' => '보류', 'leased' => '분양', 'closed' => '닫힘'], $st, '상태')
            . '<input name="q" value="' . self::e($code) . '" placeholder="자리 번호 앞부분 (예: J01-00)" maxlength="24" aria-label="자리 번호"><button class="btn" type="submit">🔎 보기</button>'
            . ($st !== '' || $kind !== '' || $zone !== '' || $code !== '' ? '<a class="btn ghost" href="' . self::e(self::href(['sec' => 'units'])) . '">모두 보기</a>' : '') . '</form>';
        if (!$r['rows']) return $h . '<p class="empty">🍃 ' . ($after > 0 ? '더 없어요.' : '조건에 맞는 자리가 없어요.') . '</p>' . self::pager($here, $after, 0) . '</section>';
        $now = Clock::ms();
        $ids = [];
        $rows = [];
        foreach ($r['rows'] as $u) {
            $id = (int) $u['id'];
            $ids[] = $id;
            $free = $u['contractId'] === 0;
            $acts = '';
            if ($free && $u['status'] === 'open') {
                $acts .= self::rowBtn('urow', $id, 'closed', '🚫 닫기', 'btn ghost') . self::rowBtn('urow', $id, 'held24', '✋ 보류 (하루)', 'btn ghost') . self::rowBtn('urow', $id, 'held', '✋ 보류 (풀 때까지)', 'btn ghost');
            } elseif ($free && $u['status'] !== 'leased') {
                $acts .= self::rowBtn('urow', $id, 'open', '🟢 다시 열기') . ($u['status'] === 'held' ? self::rowBtn('urow', $id, 'closed', '🚫 닫기', 'btn ghost') : '');
            }
            if (!$free) $acts .= '<a class="btn" href="' . self::e(self::href(['sec' => 'contracts', 'con' => $u['contractId']])) . '">📄 계약 열기</a>';
            $acts .= '<a class="btn ghost" href="' . self::e(self::href(['sec' => 'care', 'u' => self::unitWord($u['code'])])) . '">📒 일지 쓰기</a>';
            if (!$free || $u['label'] !== '') {
                $acts .= '<div class="stack lbl"><label>이름표 (12자까지 · 비우면 지워요)<input name="text_' . $id . '" form="urow" value="' . self::e($u['label']) . '" maxlength="40"></label>'
                    . '<label class="check"><input type="checkbox" name="show_' . $id . '" form="urow" value="1"' . ($u['labelShow'] ? ' checked' : '') . '> 체험관에 보이기</label>' . self::rowBtn('urow', $id, 'label', '🏷️ 이름표 저장', 'btn sm') . '</div>';
            }
            $hold = $u['status'] === 'held' ? ((int) $u['holdUntil'] > 0 ? self::at($u['holdUntil']) . ((int) $u['holdUntil'] < $now ? ' (지남)' : '') : '풀 때까지') : '';
            $rows[] = ['attr' => ' class="unit ' . self::e($u['status']) . '" id="u' . $id . '"', 'cells' => [
                '<input type="checkbox" name="ids[]" value="' . $id . '" form="ubulk" aria-label="' . self::e($u['code']) . ' 고르기">',
                ['<b>' . self::e($u['code']) . '</b> <span class="dim small">' . self::e(self::kind($u['kind'])) . '</span>', 'nowrap'],
                self::e($u['zoneName']), self::st(self::UNIT_STATUS, $u['status']),
                $free ? '' : '<a href="' . self::e(self::href(['sec' => 'contracts', 'con' => $u['contractId']])) . '">' . self::e($u['contractNo']) . '</a> ' . self::st(self::CONTRACT_STATUS, $u['contractStatus']),
                [$u['label'] !== '' ? self::e($u['label']) . ' ' . ($u['labelShow'] ? self::badge('공개', 'ok') : self::badge('숨김')) : '', 'msg'],
                [self::e($hold), 'nowrap small'], ['<details class="acts"><summary>⚙️ 관리</summary><div class="actgrid">' . $acts . '</div></details>', 'acts'],
            ]];
        }
        $h .= self::tbl(['고르기', '자리', '구역', '상태', '계약', '이름표', '보류 기한', '관리'], $rows) . self::rowForm('urow', 'allot_unit', $here + ['after' => $after])
            . self::open('allot_units_bulk', $here + ['after' => $after, 'page_ids' => implode(',', $ids)], 'bulk', 'ubulk')
            . '<b>고른 자리를 한 번에</b>' . self::select('op', ['closed' => '🚫 닫기 (분양하지 않음)', 'open' => '🟢 다시 열기', 'held' => '✋ 보류로 잡아 두기'], 'closed', '할 일')
            . '<label class="check"><input type="checkbox" name="all_page" value="1"> 이 쪽에 보이는 ' . count($ids) . '자리 모두</label><button class="btn" type="submit">적용</button>'
            . '<span class="dim small">계약이나 대기자 제안이 걸린 자리는 건너뛰어요.</span></form>'
            . self::pager($here, $after, (int) $r['next']);
        return $h . '</section>';
    }

    /** the picture of a zone: one small cell per unit in rows of `cols` (the same map the app draws; no personal data) */
    private static function zoneMap(array $z): string
    {
        if ((int) $z['units'] < 1 || (int) $z['units'] > Allot::MAX_ZONE_UNITS) return '';
        $m = Allot::map(null, (string) $z['code']);
        $s = isset($m['zones'][0]['s']) ? (string) $m['zones'][0]['s'] : '';
        if ($s === '') return '';
        $cols = max(1, min(100, (int) $z['cols']));
        $cls = ['o' => 'o', 'h' => 'h', 'l' => 'l', 'c' => 'c'];
        $h = '<details class="zmapbox"><summary>🗺️ 자리 지도 펼치기 (' . self::e(self::n(strlen($s))) . '칸 · 한 줄 ' . $cols . '칸)</summary><div class="zmapwrap"><div class="zmap" role="img" aria-label="' . self::e($z['name']) . ' 자리 지도">';
        for ($i = 0, $n = strlen($s); $i < $n; $i += $cols) {
            $h .= '<div class="zrow">';
            $row = substr($s, $i, $cols);
            for ($j = 0, $w = strlen($row); $j < $w; $j++) $h .= '<i class="' . (isset($cls[$row[$j]]) ? $cls[$row[$j]] : 'c') . '"></i>';
            $h .= '</div>';
        }
        return $h . '</div></div><p class="legend small"><span><i class="sw l"></i> 분양</span><span><i class="sw h"></i> 보류</span><span><i class="sw c"></i> 닫힘</span><span><i class="sw o"></i> 빈자리</span>'
            . '<span class="dim">왼쪽 위가 1번, 오른쪽으로 번호가 커져요.</span></p></details>';
    }

    /** "처음으로 · 다음 →" of a keyset list ($next = the cursor of the next page, 0 = this is the last one) */
    private static function pager(array $q, int $after, $next, string $key = 'after'): string
    {
        unset($q[$key]);
        $h = '<div class="row">';
        if ($after > 0) $h .= '<a class="btn ghost" href="' . self::e(self::href($q)) . '">⏮ 처음으로</a>';
        if ($next) $h .= '<a class="btn ghost" href="' . self::e(self::href($q + [$key => $next])) . '">다음 ' . self::ROWS . '개 →</a>';
        return $h . '</div>';
    }

    // ------------------------------------------------------------------ searches (personal data never travels in an address)
    /** the searches of this session: [[token, text, at], …] — sealed in the session, at most 6, each for an hour */
    private static function finds(): array
    {
        $raw = Session::get('allot_find');
        $plain = is_string($raw) ? Crypto::open($raw) : null;
        $list = is_string($plain) ? Json::tryDecode($plain, true) : null;
        $out = [];
        $now = Clock::ms();
        if (is_array($list)) foreach ($list as $f) if (is_array($f) && count($f) === 3 && is_string($f[0]) && is_string($f[1]) && $now - (int) $f[2] < 3600000) $out[] = [$f[0], $f[1], (int) $f[2]];
        return $out;
    }

    /** keep a search text for this session → the random token that names it in the address */
    private static function findPut(string $text): string
    {
        $list = array_slice(self::finds(), -5);
        $tok = bin2hex(random_bytes(4));
        $list[] = [$tok, $text, Clock::ms()];
        Session::set('allot_find', Crypto::seal((string) json_encode($list, JSON_UNESCAPED_UNICODE)));
        return $tok;
    }

    /** the text of a search token ('' when it is unknown or older than an hour) */
    private static function findText(string $token): string
    {
        foreach (self::finds() as $f) if (hash_equals($f[0], $token)) return $f[1];
        return '';
    }

    /**
     * What a search text is and how the page may name it: ['by' => contract | unit | id | tail | phone | name,
     * 'label' => words without the personal part ("전화번호 ***-****-5678", "이름 김**")].
     */
    public static function findInfo(string $text): array
    {
        $t = trim($text);
        $digits = (string) preg_replace('/[\s\-.()]+/u', '', $t);
        if (preg_match('/^A\d\d-[2-9A-Z]{5}-[2-9A-Z]{5}$/i', $t)) return ['by' => 'contract', 'label' => '계약번호 ' . strtoupper($t)];
        if (preg_match('/^[A-Za-z0-9]{1,12}-\d{1,6}$/', $t)) return ['by' => 'unit', 'label' => '자리 ' . strtoupper($t)];
        if (preg_match('/^#\d{1,15}$/', $t)) return ['by' => 'id', 'label' => '고객 번호 ' . $t];
        if (preg_match('/^\d{4}$/', $digits)) return ['by' => 'tail', 'label' => '전화번호 끝 4자리 ' . $digits];
        $phone = Allot::normPhone($t);
        if ($phone !== '') return ['by' => 'phone', 'label' => '전화번호 ***-****-' . substr($phone, -4)];
        $name = Users::cleanText($t, 40);
        return ['by' => 'name', 'label' => '이름 ' . ($name === '' ? '' : mb_substr($name, 0, 1) . str_repeat('*', max(1, min(4, mb_strlen($name) - 1))))];
    }

    /** the search box of a list (a POST: what is typed may be a phone number or a name) + what it found by */
    private static function findBox(string $sec, array $here, string $find): string
    {
        $h = self::open('allot_find', ['sec' => $sec] + $here, 'search')
            . '<input name="find" maxlength="60" autocomplete="off" placeholder="' . self::e($sec === 'customers' ? '전화번호 전체 · 끝 4자리 · 이름 전체 · #고객번호' : '계약번호 · 자리 번호 · 전화번호 전체 · 끝 4자리 · 이름 전체') . '" aria-label="찾을 말">'
            . '<button class="btn" type="submit">🔎 찾기</button></form>';
        if ($find !== '') {
            $rest = $here;
            unset($rest['s'], $rest['after']);
            $h .= '<p class="notice small">🔎 <b>' . self::e(self::findInfo($find)['label']) . '</b>(으)로 찾은 결과예요. <a href="' . self::e(self::href(['sec' => $sec] + $rest)) . '">찾기 지우기</a></p>';
        }
        return $h . '<p class="dim small">🔐 이름 · 전화번호 · 주소는 <b>암호화해서</b> 보관해요. 그래서 이름의 일부(예: “김”)나 번호의 가운데 자리로는 찾을 수 없어요 — <b>전체 이름</b>을 정확히 넣거나, <b>전화번호 전체</b> · <b>끝 4자리</b>'
            . ($sec === 'customers' ? ' · <b>#고객번호</b>' : ' · <b>계약번호</b> · <b>자리 번호</b>') . '로 찾아 주세요. 찾는 말은 주소창에 남지 않아요.</p>';
    }

    // ------------------------------------------------------------------ the step-up for personal data
    /** is the personal-data window of this session open? (opened by the password, for PII_WINDOW seconds, for this administrator only) */
    public static function piiOpen(array $a): bool
    {
        $w = Session::get('allot_pii');
        return is_array($w) && isset($w['uid'], $w['until']) && (int) $w['uid'] > 0 && (int) $w['uid'] === (int) (isset($a['id']) ? $a['id'] : 0) && (int) $w['until'] > Clock::ms();
    }

    /** the password field of a form that shows personal data (not asked again while the window is open) */
    private static function piiField(array $a): string
    {
        if (self::piiOpen($a)) {
            $w = Session::get('allot_pii');
            return '<p class="dim small">🔓 방금 비밀번호를 확인했어요 — ' . self::e(self::span((int) $w['until'] - Clock::ms())) . ' 동안은 다시 묻지 않아요.</p>';
        }
        return '<label>관리자 비밀번호 (한 번 더 확인해요)<input type="password" name="password" autocomplete="current-password" required maxlength="128"></label>';
    }

    private static function reasonSelect(): string
    {
        return '<label>보는 까닭 (기록에 남아요)' . self::select('why', Allot::REVEAL_REASONS, 'call') . '</label>';
    }

    /** the revealed record that waits for this page view — handed out once, then gone */
    private static function revealTake(int $cust): ?array
    {
        $r = Session::get('allot_reveal');
        if ($r === null) return null;
        Session::set('allot_reveal', null);
        if (!is_array($r) || !isset($r['cust'], $r['at'], $r['data']) || (int) $r['cust'] !== $cust || Clock::ms() - (int) $r['at'] > self::REVEAL_TTL * 1000 || !is_string($r['data'])) return null;
        $plain = Crypto::open($r['data']);
        $d = is_string($plain) ? Json::tryDecode($plain, true) : null;
        return is_array($d) ? $d : null;
    }

    // ------------------------------------------------------------------ 📄 계약
    private static function contractCells(array $c, int $now): array
    {
        $id = (int) $c['id'];
        $live = in_array($c['status'], ['pending', 'active', 'overdue'], true);
        $status = self::st(self::CONTRACT_STATUS, $c['status']) . ((int) $c['cancelReqAt'] > 0 && $live ? ' ' . self::badge('해지 요청', 'fail') : '')
            . ($c['status'] === 'pending' && (int) $c['holdUntil'] > 0 ? '<br><span class="dim small">' . self::e(self::at($c['holdUntil'])) . ' 까지 자리를 잡아 둬요</span>' : '');
        $term = (int) $c['startsAt'] > 0 ? self::e(self::day($c['startsAt'])) . ' ~ ' . ((int) $c['endsAt'] > 0 ? self::e(self::day($c['endsAt'])) : '기한 없음') : '<span class="dim">확정 전</span>';
        if ($c['autoRenew']) $term .= ' ' . self::badge('자동 연장', 'ok');
        $paid = '';
        if ($live && $c['status'] !== 'pending') {
            $pu = (int) $c['paidUntil'];
            $paid = $pu >= Allot::FOREVER || (int) $c['price'] === 0 ? '<span class="dim">낼 것 없음</span>' : self::e(self::day($pu)) . ($pu < $now ? ' ' . self::badge('지남', 'fail') : '');
        }
        return [
            '<a href="' . self::e(self::href(['sec' => 'contracts', 'con' => $id])) . '"><b>' . self::e($c['contractNo']) . '</b></a>',
            ['<b>' . self::e($c['unitCode']) . '</b> <span class="dim small">' . self::e($c['zoneName']) . '</span>', ''],
            '<a href="' . self::e(self::href(['sec' => 'customers', 'cust' => (int) $c['customerId']])) . '">' . self::e($c['customer'] !== '' ? $c['customer'] : '(지워진 고객)') . '</a>'
                . ($c['phoneTail'] !== '' ? ' <span class="dim small">끝번호 ' . self::e($c['phoneTail']) . '</span>' : ''),
            $status, [$term, 'nowrap'], [$paid, 'nowrap'],
            self::e(self::plan($c['period'], (int) $c['price'], (int) $c['termMonths'])) . ((int) $c['paidTotal'] > 0 ? '<br><span class="dim small">낸 돈 ' . self::e(self::won((int) $c['paidTotal'])) . '</span>' : ''),
            [self::e(self::day($c['createdAt'])), 'nowrap small'],
        ];
    }

    private static function viewContracts(array $q): string
    {
        $s = self::sum();
        $st = isset($q['st']) && in_array($q['st'], ['live', 'pending', 'active', 'overdue', 'ended', 'canceled'], true) ? $q['st'] : '';
        $kind = isset($q['kind']) ? $q['kind'] : '';
        $zone = isset($q['zone']) ? $q['zone'] : '';
        $flag = isset($q['flag']) ? $q['flag'] : '';
        $tok = isset($q['s']) ? $q['s'] : '';
        $find = $tok !== '' ? self::findText($tok) : '';
        if ($find === '') $tok = '';
        $after = isset($q['after']) ? (int) $q['after'] : 0;
        $here = ['st' => $st, 'kind' => $kind, 'zone' => $zone, 'flag' => $flag, 's' => $tok];
        $h = '<section class="card"><h3>📄 계약 <span class="dim small">승인 대기 ' . self::e(self::n($s['pending'])) . ' · 진행 중 ' . self::e(self::n($s['active'])) . ' · 연체 ' . self::e(self::n($s['overdue'])) . '</span></h3>'
            . '<p class="dim small">계약 = 한 고객이 한 자리를 쓰는 약속이에요. 체험관에서 온 <b>신청</b>은 여기에서 승인해야 확정돼요. 계약번호를 누르면 입금 기록 · 연장 · 자리 옮기기 · 끝내기를 할 수 있어요.</p>'
            . '<form method="get" action="./" class="search"><input type="hidden" name="tab" value="allot"><input type="hidden" name="sec" value="contracts">' . self::hidden(['s' => $tok])
            . self::select('st', ['' => '모든 상태', 'live' => '진행 중인 것 모두 (신청 · 진행 · 연체)', 'pending' => '⏳ 승인 대기', 'active' => '✅ 진행 중', 'overdue' => '⚠️ 연체', 'ended' => '종료', 'canceled' => '취소'], $st, '상태')
            . self::select('flag', ['' => '따로 보기 없음', 'due' => '💰 7일 안에 납부 기한', 'expiring' => '📅 30일 안에 끝남', 'cancelreq' => '🙋 해지 요청'], $flag, '따로 보기')
            . self::select('kind', ['' => '모든 종류', 'jar' => '🏺 항아리', 'plot' => '🥬 밭', 'store' => '🏚️ 창고'], $kind, '종류') . self::select('zone', self::zoneOptions(), $zone, '구역')
            . '<button class="btn" type="submit">보기</button>' . ($st !== '' || $kind !== '' || $zone !== '' || $flag !== '' || $tok !== '' ? '<a class="btn ghost" href="' . self::e(self::href(['sec' => 'contracts'])) . '">모두 보기</a>' : '') . '</form>'
            . self::findBox('contracts', $here, $find);
        $next = 0;
        $key = 'after';
        if ($flag === 'due') {
            // soonest first, read by (paid-until, id); the other filters do not apply to this list
            $r = Allot::listDue(7, self::ROWS, isset($q['dc']) ? $q['dc'] : '');
            $next = $r['next'];
            $key = 'dc';
            $after = isset($q['dc']) ? 1 : 0;
            $h .= '<p class="dim small">💰 납부 기한이 7일 안에 오거나 이미 지난 계약이에요 — 급한 것부터 보여요. (이 보기에서는 다른 조건이 적용되지 않아요.)</p>';
        } else {
            $r = Allot::listContracts(['status' => $st, 'kind' => $kind, 'zone' => $zone, 'flag' => $flag, 'q' => $find], self::ROWS, $after);
            $next = (int) $r['next'];
        }
        if (!$r['rows']) return $h . '<p class="empty">🍃 ' . ($after > 0 ? '더 없어요.' : ($st === 'pending' ? '🎉 승인을 기다리는 신청이 없어요.' : '조건에 맞는 계약이 없어요.')) . '</p>' . self::pager(['sec' => 'contracts'] + $here, $after, 0, $key) . '</section>';
        $now = Clock::ms();
        $rows = [];
        $ids = [];
        foreach ($r['rows'] as $c) {
            $id = (int) $c['id'];
            $ids[] = $id;
            $cells = self::contractCells($c, $now);
            array_unshift($cells, '<input type="checkbox" name="ids[]" value="' . $id . '" form="cbulk" aria-label="' . self::e($c['contractNo']) . ' 고르기">');
            $cells[] = [$c['status'] === 'pending' ? self::rowBtn('crow', $id, 'approve', '✅ 승인', 'btn primary sm') . ' ' . self::rowBtn('crow', $id, 'reject', '↩️ 반려', 'btn ghost sm')
                : '<a class="btn ghost sm" href="' . self::e(self::href(['sec' => 'contracts', 'con' => $id])) . '">열기</a>', 'acts'];
            $rows[] = ['attr' => ' class="con ' . self::e($c['status']) . '" id="c' . $id . '"', 'cells' => $cells];
        }
        $place = ['sec' => 'contracts'] + $here + ($flag === 'due' ? ['dc' => isset($q['dc']) ? $q['dc'] : ''] : ['after' => $after]);
        $h .= self::tbl(['고르기', '계약번호', '자리', '고객', '상태', '기간', '납부 기한', '금액', '신청일', '처리'], $rows) . self::rowForm('crow', 'allot_decide', $place)
            . self::open('allot_contracts_bulk', $place + ['page_ids' => implode(',', $ids)], 'bulk', 'cbulk')
            . '<b>고른 계약을 한 번에</b>' . self::select('op', ['approve' => '✅ 승인 (승인 대기인 것만)', 'renew' => '🔁 한 기간 연장 (진행 중인 것만)', 'notice' => '🔔 알림 보내기'], 'approve', '할 일')
            . '<input type="text" name="title" maxlength="80" placeholder="알림 제목 (알림 보내기일 때)" aria-label="알림 제목"><input type="text" name="body" maxlength="300" placeholder="알림 내용 (300자까지)" aria-label="알림 내용">'
            . '<label class="check"><input type="checkbox" name="all_page" value="1"> 이 쪽에 보이는 ' . count($ids) . '건 모두</label><button class="btn" type="submit">적용</button>'
            . '<span class="dim small">맞지 않는 계약(이미 승인됨 · 기간 없는 계약 등)은 건너뛰어요. 알림에는 금액을 적지 마세요 — 아이도 볼 수 있어요.</span></form>'
            . self::pager(['sec' => 'contracts'] + $here, $after, $next, $key);
        return $h . '</section>';
    }

    /** the nickname of an account id ("#12" when it is gone, '' for 0) */
    private static function nick(int $uid): string
    {
        if ($uid < 1) return '';
        $u = Users::byId($uid);
        return $u ? (string) $u['nickname'] : '#' . $uid;
    }

    private static function viewContract(int $id, array $q): string
    {
        $c = Allot::contract($id);
        $backLink = '<p class="row"><a class="btn ghost" href="' . self::e(self::href(['sec' => 'contracts'])) . '">← 계약 목록으로</a></p>';
        if ($c === null) return '<section class="card"><p class="empty">🍃 그런 계약은 없어요.</p>' . $backLink . '</section>';
        $now = Clock::ms();
        $live = in_array($c['status'], ['pending', 'active', 'overdue'], true);
        $place = ['sec' => 'contracts', 'con' => $id];
        $fact = function (string $k, string $html): string { return '<dt>' . self::e($k) . '</dt><dd>' . $html . '</dd>'; };
        $pu = (int) $c['paidUntil'];
        $h = '<section class="card"><h3>📄 계약 <code>' . self::e($c['contractNo']) . '</code> ' . self::st(self::CONTRACT_STATUS, $c['status'])
            . ((int) $c['cancelReqAt'] > 0 && $live ? ' ' . self::badge('고객이 해지를 요청했어요', 'fail') : '') . '</h3><dl class="facts">'
            . $fact('자리', '<b>' . self::e($c['unitCode']) . '</b> · ' . self::e(self::kind($c['kind'])) . ' · ' . self::e($c['zoneName'])
                . ' <a class="small" href="' . self::e(self::href(['sec' => 'units', 'zone' => strtolower($c['zoneCode'])])) . '">구역 보기</a>')
            . $fact('고객', '<a href="' . self::e(self::href(['sec' => 'customers', 'cust' => (int) $c['customerId']])) . '"><b>' . self::e($c['customer'] !== '' ? $c['customer'] : '(지워진 고객)') . '</b></a>'
                . ($c['phoneTail'] !== '' ? ' · 전화 끝번호 ' . self::e($c['phoneTail']) : '') . ' · ' . ((int) $c['userId'] > 0 ? '체험관 계정 ' . self::e(self::nick((int) $c['userId'])) : '<span class="dim">체험관 계정 없음 (알림은 직접 연락)</span>'))
            . $fact('맺은 방법', self::e(isset(self::SOURCE[$c['source']]) ? self::SOURCE[$c['source']] : $c['source']) . ' · ' . self::e(self::at($c['createdAt'])))
            . $fact('금액 · 주기', self::e(self::plan($c['period'], (int) $c['price'], (int) $c['termMonths'])) . ' <span class="dim small">(계약을 맺을 때의 값이에요. 구역 가격을 바꿔도 이 계약은 그대로예요)</span>')
            . $fact('기간', (int) $c['startsAt'] > 0 ? self::e(self::day($c['startsAt'])) . ' ~ ' . ((int) $c['endsAt'] > 0 ? self::e(self::day($c['endsAt'])) : '기한 없음') . ($c['autoRenew'] ? ' ' . self::badge('끝나면 자동 연장', 'ok') : '') : '<span class="dim">승인하면 그날부터 시작해요</span>')
            . ($live && $c['status'] !== 'pending' ? $fact('납부 기한', $pu >= Allot::FOREVER || (int) $c['price'] === 0 ? '낼 것 없음' : self::e(self::day($pu)) . ($pu < $now ? ' ' . self::badge(self::span($now - $pu) . ' 지남', 'fail') : ' <span class="dim small">(' . self::e(self::span($pu - $now)) . ' 남음)</span>')) : '')
            . $fact('낸 돈 합계', self::e(self::won((int) $c['paidTotal'])))
            . ($c['status'] === 'pending' && (int) $c['holdUntil'] > 0 ? $fact('자리 잡아 두는 기한', self::e(self::at($c['holdUntil'])) . ' <span class="dim small">(이때까지 승인도 입금 기록도 없으면 자동 취소돼요)</span>') : '')
            . ((int) $c['decidedAt'] > 0 ? $fact('확정', self::e(self::at($c['decidedAt'])) . ((int) $c['decidedBy'] > 0 ? ' · ' . self::e(self::nick((int) $c['decidedBy'])) : ' · 자동')) : '')
            . ((int) $c['cancelReqAt'] > 0 ? $fact('해지 요청', self::e(self::at($c['cancelReqAt']))) : '')
            . (!$live ? $fact('끝남', self::e(self::at($c['endedAt'])) . ' · ' . self::e(isset(self::END_REASON[$c['endReason']]) ? self::END_REASON[$c['endReason']] : ($c['endReason'] !== '' ? $c['endReason'] : '-'))) : '')
            . ($live ? $fact('이름표', $c['label'] !== '' ? self::e($c['label']) . ' ' . ($c['labelShow'] ? self::badge('공개', 'ok') : self::badge('숨김')) : '<span class="dim">없음</span>') : '')
            . $fact('운영자 메모', $c['memo'] !== '' ? self::e($c['memo']) : '<span class="dim">없음</span>')
            . '</dl>' . $backLink . '</section>';

        // what can be done now
        $h .= '<div class="grid2"><section class="card"><h3>🧭 지금 할 수 있는 일</h3>';
        if ($c['status'] === 'pending') {
            $h .= self::open('allot_decide', $place) . '<label>고객에게 전할 말 (선택 · 300자까지 · 알림에 함께 보여요 · 금액은 적지 마세요)<textarea name="memo" maxlength="300" rows="2"></textarea></label>'
                . '<div class="row"><button class="btn primary" type="submit" name="decision" value="approve">✅ 승인 (오늘부터 시작)</button><button class="btn" type="submit" name="decision" value="reject">↩️ 반려 (자리를 다시 비워요)</button></div></form>';
        }
        if ($live) {
            $h .= '<details class="acts" open><summary>💰 입금 기록</summary>' . self::open('allot_pay', $place + ['idem' => 'adm' . bin2hex(random_bytes(10))])
                . '<div class="fgrid"><label>금액 (원)<input name="amount" inputmode="numeric" maxlength="12" required value="' . ((int) $c['price'] > 0 ? (int) $c['price'] : '') . '"></label>'
                . '<label>방법' . self::select('method', ['bank' => '계좌 이체', 'cash' => '현금', 'cms' => '자동 이체(CMS)', 'etc' => '기타'], 'bank') . '</label>'
                . '<label>입금일 (비우면 오늘)<input type="date" name="paid" max="' . self::e(date('Y-m-d')) . '"></label></div>'
                . '<div class="fgrid"><label>몇 회차 치인지 (비우면 금액으로 계산)<input name="periods" inputmode="numeric" maxlength="3" placeholder="예: 1"></label>'
                . '<label>메모 (운영자만 봐요)<input name="memo" maxlength="200" placeholder="예: 농협 11/14 김○○ 이름으로 입금"></label></div>'
                . '<button class="btn primary" type="submit">💰 입금 기록하기</button><p class="dim small">계좌 이체 · 현금처럼 체험관 밖에서 받은 돈을 적어요. 기록하면 납부 기한이 그만큼 뒤로 가고, 고객에게 "납부를 확인했어요" 알림이 가요 (금액은 알리지 않아요).'
                . ($c['status'] === 'pending' ? ' 승인 대기 신청에 기록하면 자동 취소되지 않아요.' : '') . '</p></form></details>';
        }
        if ($c['status'] === 'active' || $c['status'] === 'overdue') {
            if ((int) $c['termMonths'] > 0 && (int) $c['endsAt'] > 0) {
                $h .= '<details class="acts"><summary>🔁 기간 연장</summary>' . self::open('allot_renew', $place) . '<label>몇 번 연장할까요? (한 번 = ' . (int) $c['termMonths'] . '개월)<input name="terms" value="1" inputmode="numeric" maxlength="2" required></label>'
                    . '<button class="btn" type="submit">🔁 연장하기</button><p class="dim small">지금 끝나는 날(' . self::e(self::day($c['endsAt'])) . ')에서 이어서 늘어나요. 돈을 받았으면 입금 기록도 따로 해 주세요.</p></form>'
                    . self::button('allot_autorenew', $c['autoRenew'] ? '⏹️ 자동 연장 끄기' : '♻️ 끝나면 자동으로 연장하기', $place + ['on' => $c['autoRenew'] ? '0' : '1'], 'btn ghost sm') . '</details>';
            }
        }
        if ($live) {
            $h .= '<details class="acts"><summary>🚚 다른 자리로 옮기기</summary>' . self::open('allot_move', $place) . '<label>옮겨 갈 자리 번호 (빈자리여야 해요)<input name="to" required maxlength="24" placeholder="예: ' . self::e($c['zoneCode']) . '-0123" autocomplete="off" spellcheck="false"></label>'
                . '<button class="btn" type="submit">🚚 옮기기</button><p class="dim small">이름표가 함께 옮겨 가고, 원래 자리는 비어서 기다리는 사람에게 제안돼요. 금액과 기간은 그대로예요.</p></form></details>'
                . '<details class="acts"><summary>🏁 계약 끝내기</summary>' . self::open('allot_end', $place) . '<label>끝내는 까닭 (운영자만 봐요 · 40자까지)<input name="why" maxlength="40" placeholder="예: 이사로 해지"></label>'
                . '<label class="check"><input type="checkbox" name="sure" value="1" required> 네, 이 계약을 끝낼게요 (되돌릴 수 없어요)</label><button class="btn danger" type="submit">🏁 ' . ($c['status'] === 'pending' ? '신청 취소하기' : '계약 끝내기') . '</button>'
                . '<p class="dim small">자리가 다시 비고 고객에게 알림이 가요. <b>받은 돈은 저절로 돌려주지 않아요</b> — 환불은 아래 입금 기록에서 따로 해요.</p></form></details>';
        }
        $h .= '<details class="acts"' . ($live ? '' : ' open') . '><summary>📝 운영자 메모</summary>' . self::open('allot_memo', $place) . '<label>메모 (고객에게는 보이지 않아요 · 500자까지)<textarea name="memo" maxlength="500" rows="3">' . self::e($c['memo']) . '</textarea></label>'
            . '<button class="btn" type="submit">📝 메모 저장</button></form></details></section>';

        // what happened so far
        $pays = Allot::listPayments(['contractId' => $id], 100);
        $notes = Allot::listNotices(['contractId' => $id], 30);
        $ev = [[(int) $c['createdAt'], '신청 · 등록 (' . (isset(self::SOURCE[$c['source']]) ? self::SOURCE[$c['source']] : $c['source']) . ')', '']];
        if ((int) $c['decidedAt'] > 0 && !in_array($c['status'], ['pending'], true)) $ev[] = [(int) $c['decidedAt'], $c['status'] === 'canceled' && $c['endReason'] === 'rejected' ? '반려' : '확정', ''];
        foreach ($pays['rows'] as $p) {
            $ev[] = [(int) $p['paidAt'] > 0 ? (int) $p['paidAt'] : (int) $p['createdAt'], ($p['kind'] === 'refund' ? '환불 ' : '입금 ') . self::won((int) $p['amount']) . ' · ' . (isset(self::METHOD[$p['method']]) ? self::METHOD[$p['method']] : $p['method']), $p['kind'] === 'refund' ? 'warn' : ''];
        }
        foreach ($notes['rows'] as $nt) $ev[] = [(int) ($nt['sentAt'] > 0 ? $nt['sentAt'] : $nt['sendAt']), '알림 — ' . $nt['title'], ''];
        if ((int) $c['cancelReqAt'] > 0) $ev[] = [(int) $c['cancelReqAt'], '고객이 해지를 요청', 'warn'];
        if (!$live && (int) $c['endedAt'] > 0) $ev[] = [(int) $c['endedAt'], ($c['status'] === 'canceled' ? '취소' : '종료') . ' — ' . (isset(self::END_REASON[$c['endReason']]) ? self::END_REASON[$c['endReason']] : $c['endReason']), 'end'];
        usort($ev, function ($x, $y) { return $x[0] === $y[0] ? 0 : ($x[0] < $y[0] ? -1 : 1); });
        $h .= '<section class="card"><h3>🕒 지나온 일</h3><ol class="timeline">';
        foreach ($ev as $x) $h .= '<li' . ($x[2] !== '' ? ' class="' . self::e($x[2]) . '"' : '') . '><span class="dim small">' . self::e(self::at($x[0])) . '</span><br>' . self::e($x[1]) . '</li>';
        $h .= '</ol></section></div>';

        // payments
        $h .= '<section class="card"><h3>💰 입금 기록 <span class="dim small">' . count($pays['rows']) . '건</span></h3>';
        if (!$pays['rows']) $h .= '<p class="empty">🍃 아직 입금 기록이 없어요.</p>';
        else {
            $rows = [];
            foreach ($pays['rows'] as $p) {
                $pid = (int) $p['id'];
                $can = $p['status'] === 'paid' && $p['kind'] !== 'refund';
                $rows[] = ['attr' => ' class="pay ' . self::e($p['kind']) . '"', 'cells' => [
                    '#' . $pid, [self::e(self::at((int) $p['paidAt'] > 0 ? $p['paidAt'] : $p['createdAt'])), 'nowrap'], self::e(isset(self::PAY_KIND[$p['kind']]) ? self::PAY_KIND[$p['kind']] : $p['kind']),
                    self::e(isset(self::METHOD[$p['method']]) ? self::METHOD[$p['method']] : $p['method']), [($p['kind'] === 'refund' ? '−' : '') . self::e(self::won((int) $p['amount'])), 'nowrap'],
                    self::st(self::PAY_STATUS, $p['status']), [(int) $p['periodTo'] > (int) $p['periodFrom'] ? self::e(self::day($p['periodFrom'])) . ' ~ ' . self::e(self::day($p['periodTo'])) : '', 'nowrap small'],
                    [self::e($p['memo']), 'msg'],
                    [$can ? '<details class="acts"><summary>↩️ 환불</summary>' . self::open('allot_refund', $place + ['pay' => $pid]) . '<label>까닭 (운영자만 봐요)<input name="reason" maxlength="200"></label>'
                        . '<label class="check"><input type="checkbox" name="sure" value="1" required> 네, 환불로 기록할게요</label><button class="btn danger sm" type="submit">↩️ 환불 기록</button></form></details>' : '', 'acts'],
                ]];
            }
            $h .= self::tbl(['번호', '입금 일시', '구분', '방법', '금액', '상태', '덮는 기간', '메모', '처리'], $rows)
                . '<p class="dim small">환불: 토스 결제는 결제 회사에서 먼저 취소한 뒤 기록하고, 계좌 이체 · 현금은 직접 돌려준 뒤 여기에 기록만 남겨요. 환불해도 계약의 날짜는 바뀌지 않아요 (끝내려면 "계약 끝내기").</p>';
        }
        $h .= '</section>';

        // notices of this contract
        $h .= '<section class="card"><h3>🔔 이 계약으로 보낸 알림</h3>';
        if (!$notes['rows']) $h .= '<p class="empty">🍃 아직 알림이 없어요.</p>';
        else {
            $rows = [];
            foreach ($notes['rows'] as $nt) {
                $rows[] = ['cells' => [[self::e(self::at($nt['sentAt'] > 0 ? $nt['sentAt'] : $nt['sendAt'])), 'nowrap'], self::e(isset(self::NOTICE_KIND[$nt['kind']]) ? self::NOTICE_KIND[$nt['kind']] : $nt['kind']),
                    ['<b>' . self::e($nt['title']) . '</b><br>' . self::e($nt['body']), 'msg'], self::st(self::NOTICE_STATUS, $nt['status']) . ($nt['hasAccount'] ? '' : ' ' . self::badge('직접 연락', 'warn'))]];
            }
            $h .= self::tbl(['때', '종류', '내용', '상태'], $rows);
        }
        $h .= '<p class="row"><a class="btn ghost" href="' . self::e(self::href(['sec' => 'notices', 'con' => $id])) . '">🔔 이 계약의 고객에게 알림 쓰기</a>'
            . '<a class="btn ghost" href="' . self::e(self::href(['sec' => 'care', 'u' => self::unitWord($c['unitCode'])])) . '">📒 이 자리의 관리 일지</a></p></section>';
        return $h;
    }

    // ------------------------------------------------------------------ 👤 고객
    private static function customerForm(?array $cu): string
    {
        $new = $cu === null;
        $h = self::open('allot_customer_save', ['sec' => 'customers'] + ($new ? [] : ['cust' => (int) $cu['id']]));
        $h .= '<div class="fgrid"><label>이름' . ($new ? '' : ' (바꿀 때만 적어요)') . '<input name="name" maxlength="40" autocomplete="off"' . ($new ? ' required' : '') . '></label>'
            . '<label>전화번호' . ($new ? ' (없으면 비워요)' : ' (바꿀 때만 적어요)') . '<input name="phone" maxlength="20" inputmode="tel" autocomplete="off" placeholder="010-1234-5678"></label></div>'
            . '<label>주소 (꼭 필요할 때만 · ' . ($new ? '선택' : '바꿀 때만 적어요') . ')<input name="addr" maxlength="200" autocomplete="off"></label>'
            . '<label>운영자 메모 (암호화해서 보관 · ' . ($new ? '선택' : '바꿀 때만 적어요') . ')<input name="memo" maxlength="500" autocomplete="off"></label>'
            . '<input type="hidden" name="guardian_set" value="1"><label class="check"><input type="checkbox" name="guardian" value="1"' . (!$new && $cu['guardian'] ? ' checked' : '') . '> 보호자가 어린이 대신 신청했어요</label>'
            . '<label class="check"><input type="checkbox" name="consent" value="1"> 개인정보 수집 · 이용 동의서를 종이로 받아 두었어요 (오늘 날짜로 기록돼요)</label>';
        if (!$new) {
            $h .= '<label class="check"><input type="checkbox" name="clear_addr" value="1"> 주소 지우기</label><label class="check"><input type="checkbox" name="clear_memo" value="1"> 메모 지우기</label>';
        }
        return $h . '<button class="btn primary" type="submit">' . ($new ? '➕ 고객 등록' : '💾 고객 정보 저장') . '</button></form>';
    }

    private static function viewCustomers(array $q): string
    {
        $tok = isset($q['s']) ? $q['s'] : '';
        $find = $tok !== '' ? self::findText($tok) : '';
        if ($find === '') $tok = '';
        $after = isset($q['after']) ? (int) $q['after'] : 0;
        $here = ['s' => $tok];
        $h = '<section class="card"><h3>👤 고객</h3><p class="dim small">분양을 신청했거나 운영자가 등록한 사람이에요. 목록에는 <b>가린 이름과 전화 끝번호</b>만 보여요. 전체 이름 · 전화번호 · 주소는 고객을 열어 "한 번 보기"를 눌러야 보이고, 볼 때마다 기록이 남아요.</p>'
            . self::findBox('customers', $here, $find);
        $r = Allot::listCustomers(['q' => $find], self::ROWS, $after);
        if (!$r['rows']) {
            $h .= '<p class="empty">🍃 ' . ($after > 0 ? '더 없어요.' : ($find !== '' ? '찾는 고객이 없어요. 이름은 전체를 정확히, 전화번호는 전체나 끝 4자리로 찾아 주세요.' : '아직 고객이 없어요.')) . '</p>';
        } else {
            $rows = [];
            foreach ($r['rows'] as $cu) {
                $id = (int) $cu['id'];
                $rows[] = ['attr' => ' class="cust" id="k' . $id . '"', 'cells' => [
                    '<a href="' . self::e(self::href(['sec' => 'customers', 'cust' => $id])) . '">#' . $id . '</a>',
                    $cu['purged'] ? '<span class="dim">(보관 기간이 지나 지움)</span>' : '<a href="' . self::e(self::href(['sec' => 'customers', 'cust' => $id])) . '"><b>' . self::e($cu['name']) . '</b></a>',
                    [self::e($cu['phone']), 'nowrap'], (int) $cu['userId'] > 0 ? self::badge('체험관 계정', 'ok') : self::badge('계정 없음'),
                    self::e(self::n(isset($cu['contracts']) ? $cu['contracts'] : 0)) . '건',
                    (int) $cu['consentAt'] > 0 ? self::e(self::day($cu['consentAt'])) : self::badge('동의 기록 없음', 'warn'), $cu['guardian'] ? '보호자' : '',
                    [self::e(self::day($cu['createdAt'])), 'nowrap small'],
                ]];
            }
            $h .= self::tbl(['번호', '이름 (가림)', '전화 (가림)', '계정', '계약', '동의한 날', '구분', '등록'], $rows);
        }
        $h .= self::pager(['sec' => 'customers'] + $here, $after, (int) $r['next']) . '</section>'
            . '<section class="card"><h3>➕ 고객 직접 등록</h3><p class="dim small">전화나 방문으로 신청한 분을 등록해요. 등록한 뒤 그 고객 화면에서 자리를 골라 계약을 만들어요. 같은 이름 + 전화번호의 고객이 있으면 새로 만들지 않고 그 고객을 열어요.</p>'
            . self::customerForm(null) . '</section>';
        return $h;
    }

    private static function viewCustomer(int $id, array $q, array $a): string
    {
        $backLink = '<p class="row"><a class="btn ghost" href="' . self::e(self::href(['sec' => 'customers'])) . '">← 고객 목록으로</a></p>';
        try { $cu = Allot::customer($id); } catch (ApiException $e) { return '<section class="card"><p class="empty">🍃 그런 고객은 없어요.</p>' . $backLink . '</section>'; }
        $place = ['sec' => 'customers', 'cust' => $id];
        $rev = self::revealTake($id);
        $h = '';
        if ($rev !== null) {
            $h .= '<section class="card pii"><h3>🔓 #' . $id . ' 고객의 개인정보 — 지금 한 번만 보여요</h3><dl class="facts">'
                . '<dt>이름</dt><dd>' . self::e(isset($rev['nameFull']) ? $rev['nameFull'] : '') . '</dd><dt>전화번호</dt><dd>' . self::e(isset($rev['phoneFull']) && $rev['phoneFull'] !== '' ? $rev['phoneFull'] : '(없음)') . '</dd>'
                . '<dt>주소</dt><dd>' . self::e(isset($rev['addr']) && $rev['addr'] !== '' ? $rev['addr'] : '(없음)') . '</dd><dt>운영자 메모</dt><dd>' . self::e(isset($rev['memo']) && $rev['memo'] !== '' ? $rev['memo'] : '(없음)') . '</dd></dl>'
                . '<p class="dim small">이 화면을 떠나거나 새로 고치면 다시 가려져요. 화면을 찍거나 다른 곳에 적어 두지 마세요. 본 기록(누가 · 언제 · 까닭)은 📜 감사 로그에 남았어요.</p></section>';
        }
        $h .= '<section class="card"><h3>👤 고객 #' . $id . ($cu['purged'] ? ' ' . self::badge('개인정보 지움', 'warn') : '') . '</h3><dl class="facts">'
            . '<dt>이름</dt><dd>' . ($cu['purged'] ? '<span class="dim">(지움)</span>' : '<b>' . self::e($cu['name']) . '</b> <span class="dim small">가린 이름이에요</span>') . '</dd>'
            . '<dt>전화번호</dt><dd>' . self::e($cu['phone'] !== '' ? $cu['phone'] : '(없음)') . '</dd>'
            . '<dt>주소 · 메모</dt><dd>' . ($cu['hasAddr'] ? '주소 있음' : '주소 없음') . ' · ' . ($cu['hasMemo'] ? '메모 있음' : '메모 없음') . '</dd>'
            . '<dt>체험관 계정</dt><dd>' . ((int) $cu['userId'] > 0 ? self::e(self::nick((int) $cu['userId'])) . ' <span class="dim small">#' . (int) $cu['userId'] . ' — 알림이 체험관 "내 분양"으로 가요</span>' : '<span class="dim">없음 — 알림은 운영자가 직접 연락해요</span>') . '</dd>'
            . '<dt>동의</dt><dd>' . ((int) $cu['consentAt'] > 0 ? self::e(self::at($cu['consentAt'])) . ' · 판 <code>' . self::e($cu['consentVer']) . '</code>' : self::badge('동의 기록 없음', 'warn') . ' <span class="dim small">종이 동의서를 받았으면 아래 "정보 고치기"에서 표시해 주세요</span>') . '</dd>'
            . '<dt>구분</dt><dd>' . ($cu['guardian'] ? '보호자가 대신 신청' : '본인') . '</dd>'
            . '<dt>등록 · 고침</dt><dd>' . self::e(self::at($cu['createdAt'])) . ' · ' . self::e(self::at($cu['updatedAt'])) . '</dd></dl>' . $backLink . '</section>';
        if ($cu['purged']) return $h . '<section class="card"><p class="notice">보관 기간(자동화 → 개인정보 보관 기간)이 지나 이름 · 전화번호 · 주소 · 메모를 지운 고객이에요. 계약과 입금 기록은 이름 없이 남아 있어요.</p></section>' . self::customerContracts($id);

        $h .= '<div class="grid2"><section class="card"><h3>🔓 이름 · 전화번호 · 주소 보기</h3>'
            . '<p class="dim small">전화를 걸거나 입금을 확인할 때처럼 꼭 필요할 때만 열어 보세요. <b>한 번만</b> 보여 주고, 볼 때마다 누가 · 언제 · 왜 봤는지 기록해요 (보여 준 내용은 기록하지 않아요).</p>'
            . self::open('allot_reveal', $place) . self::reasonSelect() . self::piiField($a) . '<button class="btn gold" type="submit">🔓 한 번 보기</button></form>'
            . (self::piiOpen($a) ? '<div class="row">' . self::button('allot_pii_lock', '🔒 지금 잠그기', $place, 'btn ghost sm') . '</div>' : '') . '</section>'
            . '<section class="card"><h3>📄 이 고객에게 계약 만들기</h3>' . self::open('allot_contract_new', $place)
            . '<label>자리 번호 (빈자리 — 🏺 단위에서 찾을 수 있어요)<input name="unit" required maxlength="24" placeholder="예: J01-0012" autocomplete="off" spellcheck="false"></label>'
            . '<div class="fgrid"><label>상태' . self::select('status', ['active' => '바로 확정 (오늘 또는 아래 날짜부터)', 'pending' => '신청으로만 (나중에 승인)'], 'active') . '</label>'
            . '<label>시작일 (비우면 오늘)<input type="date" name="starts" max="' . self::e(date('Y-m-d')) . '"></label></div>'
            . '<label>운영자 메모 (선택)<input name="memo" maxlength="500"></label><button class="btn primary" type="submit">📄 계약 만들기</button>'
            . '<p class="dim small">금액 · 주기 · 기간은 그 자리 구역의 값을 따라요. 받은 돈은 만든 계약 화면의 "입금 기록"에 적어요.</p></form></section></div>';
        $h .= self::customerContracts($id);
        $h .= '<div class="grid2"><section class="card"><h3>✏️ 정보 고치기</h3><p class="dim small">지금 값은 보여 주지 않아요. <b>바꿀 칸만</b> 새 값을 적으면 그 칸만 바뀌어요 (빈칸은 그대로 둬요).</p>' . self::customerForm($cu) . '</section>'
            . '<section class="card"><h3>🔗 체험관 계정과 잇기</h3>';
        if ((int) $cu['userId'] > 0) {
            $h .= '<p>이미 <b>' . self::e(self::nick((int) $cu['userId'])) . '</b> 계정과 이어져 있어요.</p>';
        } else {
            $h .= '<p class="dim small">운영자가 등록한 고객을 그 사람의 체험관 계정과 이으면, 계약과 알림이 그 계정의 "내 분양"에 보여요. 전화번호가 같다고 저절로 이어지지 않아요 — 본인인지 확인한 뒤에 직접 이어 주세요.</p>'
                . self::open('allot_customer_link', $place) . '<label>체험관 계정 (닉네임 · 이메일 · 계정 번호)<input name="who" required maxlength="120" autocomplete="off"></label><button class="btn" type="submit">🔗 잇기</button></form>';
        }
        $h .= '<p class="row"><a class="btn ghost" href="' . self::e(self::href(['sec' => 'notices', 'cust' => $id])) . '">🔔 이 고객에게 알림 쓰기</a></p></section></div>';
        return $h;
    }

    /** the contracts of one customer (newest first, at most ROWS) */
    private static function customerContracts(int $id): string
    {
        $r = Allot::listContracts(['customerId' => $id], self::ROWS);
        $h = '<section class="card"><h3>📄 이 고객의 계약 <span class="dim small">' . count($r['rows']) . ($r['next'] ? '건 이상' : '건') . '</span></h3>';
        if (!$r['rows']) return $h . '<p class="empty">🍃 아직 계약이 없어요.</p></section>';
        $now = Clock::ms();
        $rows = [];
        foreach ($r['rows'] as $c) $rows[] = ['attr' => ' class="con ' . self::e($c['status']) . '"', 'cells' => self::contractCells($c, $now)];
        return $h . self::tbl(['계약번호', '자리', '고객', '상태', '기간', '납부 기한', '금액', '신청일'], $rows) . '</section>';
    }

    // ------------------------------------------------------------------ ⏳ 대기자
    private static function viewWait(array $q): string
    {
        $st = isset($q['st']) && (isset(self::WAIT_STATUS[$q['st']]) || $q['st'] === 'all') ? $q['st'] : 'waiting';
        $kind = isset($q['kind']) ? $q['kind'] : '';
        $zone = isset($q['zone']) ? $q['zone'] : '';
        $after = isset($q['after']) ? (int) $q['after'] : 0;
        $here = ['sec' => 'wait', 'st' => $st, 'kind' => $kind, 'zone' => $zone];
        $s = self::sum();
        $hours = (int) $s['rules']['waitlist_offer_hours'];
        $h = '<section class="card"><h3>⏳ 대기자 <span class="dim small">기다리는 중 ' . self::e(self::n($s['waiting'])) . '명 · 자리 제안함 ' . self::e(self::n($s['offered'])) . '명</span></h3>'
            . '<p class="dim small">빈자리가 없을 때 체험관에서 "대기 신청"을 한 사람들이에요. 자리가 나면 <b>먼저 신청한 사람부터</b> 저절로 제안이 가고, ' . $hours . '시간 안에 확정하지 않으면 다음 사람에게 넘어가요 (시간은 ⚙️ 자동화에서 바꿔요).</p>'
            . '<form method="get" action="./" class="search"><input type="hidden" name="tab" value="allot"><input type="hidden" name="sec" value="wait">'
            . self::select('st', ['waiting' => '기다리는 중', 'offered' => '자리 제안함 (답 기다림)', 'converted' => '신청으로 바뀜', 'expired' => '기한 지남', 'canceled' => '취소', 'all' => '모두'], $st, '상태')
            . self::select('kind', ['' => '모든 종류', 'jar' => '🏺 항아리', 'plot' => '🥬 밭', 'store' => '🏚️ 창고'], $kind, '종류') . self::select('zone', self::zoneOptions(), $zone, '구역')
            . '<button class="btn" type="submit">보기</button></form>';
        $r = Allot::listWait(['kind' => $kind, 'zone' => $zone, 'status' => $st === 'all' ? '' : $st], self::ROWS, $after);
        if (!$r['rows']) {
            $h .= '<p class="empty">🍃 ' . ($after > 0 ? '더 없어요.' : ($st === 'waiting' ? '지금 기다리는 사람이 없어요.' : '조건에 맞는 대기 신청이 없어요.')) . '</p>';
        } else {
            $now = Clock::ms();
            $rows = [];
            foreach ($r['rows'] as $w) {
                $id = (int) $w['id'];
                $liveRow = $w['status'] === 'waiting' || $w['status'] === 'offered';
                $rows[] = ['attr' => ' class="wait ' . self::e($w['status']) . '"', 'cells' => [
                    '#' . $id, self::e(self::kind($w['kind'])), $w['zoneCode'] !== '' ? '<code>' . self::e($w['zoneCode']) . '</code>' : '<span class="dim">어느 구역이든</span>',
                    '<a href="' . self::e(self::href(['sec' => 'customers', 'cust' => (int) $w['customerId']])) . '">' . self::e($w['customer'] !== '' ? $w['customer'] : '(지워진 고객)') . '</a>'
                        . ($w['phoneTail'] !== '' ? ' <span class="dim small">끝번호 ' . self::e($w['phoneTail']) . '</span>' : '') . ((int) $w['userId'] > 0 ? '' : ' ' . self::badge('계정 없음')),
                    self::st(self::WAIT_STATUS, $w['status']),
                    $w['unitCode'] !== '' ? '<b>' . self::e($w['unitCode']) . '</b>' . ((int) $w['offerUntil'] > 0 ? '<br><span class="dim small">' . self::e(self::at($w['offerUntil'])) . ' 까지' . ((int) $w['offerUntil'] < $now && $w['status'] === 'offered' ? ' (지남)' : '') . '</span>' : '') : '',
                    [self::e(self::at($w['createdAt'])), 'nowrap small'], [$liveRow ? self::rowBtn('wrow', $id, 'cancel', '✖ 대기 취소', 'btn ghost sm') : '', 'acts'],
                ]];
            }
            $h .= self::tbl(['번호', '종류', '구역', '고객', '상태', '제안한 자리', '신청한 때', '처리'], $rows) . self::rowForm('wrow', 'allot_wait_cancel', $here + ['after' => $after]);
        }
        $h .= self::pager($here, $after, (int) $r['next']) . '</section>'
            . '<section class="card"><h3>🪑 빈자리를 다음 사람에게 지금 제안하기</h3><p class="dim small">보통은 저절로 돼요 (계약이 끝나거나 자동화가 돌 때). 방금 빈 자리를 바로 제안하고 싶을 때만 써요. 그 자리의 종류 · 구역을 기다리는 맨 앞 사람에게 제안이 가요.</p>'
            . self::open('allot_wait_offer', $here, 'search') . '<input name="unit" required maxlength="24" placeholder="빈자리 번호 (예: J01-0012)" autocomplete="off" spellcheck="false" aria-label="빈자리 번호"><button class="btn" type="submit">🪑 제안하기</button></form></section>';
        return $h;
    }

    // ------------------------------------------------------------------ 🔔 알림
    private static function viewNotices(array $q): string
    {
        $st = isset($q['st']) && (isset(self::NOTICE_STATUS[$q['st']]) || $q['st'] === 'all') ? $q['st'] : 'all';
        $off = isset($q['off']);
        $after = isset($q['after']) ? (int) $q['after'] : 0;
        $here = ['sec' => 'notices', 'st' => $st === 'all' ? '' : $st, 'off' => $off ? '1' : ''];
        // the compose form: who gets it
        $to = ['all' => '진행 중인 계약이 있는 모든 고객', 'kind_jar' => '🏺 항아리를 분양받은 고객 모두', 'kind_plot' => '🥬 밭을 분양받은 고객 모두', 'kind_store' => '🏚️ 창고를 분양받은 고객 모두'];
        foreach (self::sum()['zones'] as $z) $to['zone_' . strtolower($z['code'])] = '구역 ' . $z['code'] . ' · ' . $z['name'];
        $to += ['contract' => '계약 하나 — 아래 칸에 계약번호', 'customer' => '고객 한 명 — 아래 칸에 #고객번호'];
        $fixed = '';
        $pick = 'all';
        $hid = [];
        if (isset($q['con']) && ($c = Allot::contract((int) $q['con'])) !== null) {
            $fixed = '계약 ' . $c['contractNo'] . ' (' . $c['unitCode'] . ') 의 고객';
            $hid = ['to' => 'contract', 'con' => (int) $c['id']];
        } elseif (isset($q['cust'])) {
            $fixed = '고객 #' . (int) $q['cust'];
            $hid = ['to' => 'customer', 'cust' => (int) $q['cust']];
        }
        $tpl = null;
        $tpls = Allot::noticeTemplates();
        if (isset($q['tpl'])) foreach ($tpls as $t) if ($t['key'] === $q['tpl']) $tpl = $t;
        $h = '<section class="card"><h3>✍️ 알림 쓰기</h3><p class="dim small">체험관의 "내 분양 → 알림"에 보여요. 체험관 계정이 없는 고객의 알림은 아래 목록에 <b>직접 연락</b>으로 남으니 전화로 알려 주세요. '
            . '<b>금액은 적지 마세요</b> (아이도 볼 수 있어요) — 전화번호 같은 개인정보와 나쁜 말은 저절로 가려져요.</p>'
            . self::open('allot_notify', ['sec' => 'notices'] + $hid);
        if ($fixed !== '') $h .= '<p>받는 사람: <b>' . self::e($fixed) . '</b> <a class="small" href="' . self::e(self::href(['sec' => 'notices'])) . '">다른 사람에게 쓰기</a></p>';
        else $h .= '<div class="fgrid"><label>받는 사람' . self::select('to', $to, $pick) . '</label><label>계약번호 또는 #고객번호 (하나만 고를 때)<input name="ref" maxlength="24" autocomplete="off" spellcheck="false" placeholder="예: A26-ABCDE-FGHJK 또는 #12"></label></div>';
        $h .= '<label>제목 (80자까지)<input name="title" required maxlength="80" value="' . self::e($tpl !== null ? $tpl['title'] : '') . '"></label>'
            . '<label>내용 (300자까지)<textarea name="body" maxlength="300" rows="3">' . self::e($tpl !== null ? $tpl['body'] : '') . '</textarea></label>'
            . '<label>보내는 날 (비우면 지금 · 날짜를 고르면 그날 아침 9시)<input type="date" name="send" min="' . self::e(date('Y-m-d')) . '"></label>'
            . '<button class="btn primary" type="submit">🔔 알림 보내기</button></form><p class="dim small">예시 문구로 시작하기: ';
        foreach ($tpls as $t) $h .= '<a href="' . self::e(self::href(['sec' => 'notices', 'tpl' => $t['key']] + (isset($q['con']) ? ['con' => $q['con']] : []) + (isset($q['cust']) ? ['cust' => $q['cust']] : []))) . '">' . self::e($t['title']) . '</a> · ';
        $h .= '<span class="dim">(예시예요 — 날짜와 내용을 꼭 고쳐 주세요)</span></p></section>';

        // the outbox
        $filter = ['status' => $st === 'all' ? '' : $st, 'offline' => $off];
        if (isset($q['con'])) $filter['contractId'] = (int) $q['con'];
        if (isset($q['cust'])) $filter['customerId'] = (int) $q['cust'];
        $r = Allot::listNotices($filter, self::ROWS, $after);
        $keep = $here + (isset($q['con']) ? ['con' => $q['con']] : []) + (isset($q['cust']) ? ['cust' => $q['cust']] : []);
        $h .= '<section class="card"><h3>📮 보낸 알림 · 보낼 알림' . ($off ? ' ' . self::badge('직접 연락할 것만', 'warn') : '') . '</h3>'
            . '<form method="get" action="./" class="search"><input type="hidden" name="tab" value="allot"><input type="hidden" name="sec" value="notices">' . self::hidden(['con' => isset($q['con']) ? $q['con'] : '', 'cust' => isset($q['cust']) ? $q['cust'] : ''])
            . self::select('st', ['all' => '모든 상태', 'queued' => '기다림 (예약 · 직접 연락)', 'sent' => '보냄 (아직 안 읽음)', 'seen' => '읽음', 'canceled' => '취소'], $st, '상태')
            . '<label class="check"><input type="checkbox" name="off" value="1"' . ($off ? ' checked' : '') . '> 📞 직접 연락할 것만 (체험관 계정이 없는 고객)</label><button class="btn" type="submit">보기</button></form>';
        if (!$r['rows']) return $h . '<p class="empty">🍃 ' . ($after > 0 ? '더 없어요.' : ($off ? '🎉 직접 연락할 알림이 없어요.' : '조건에 맞는 알림이 없어요.')) . '</p>' . self::pager($keep, $after, 0) . '</section>';
        $rows = [];
        foreach ($r['rows'] as $nt) {
            $id = (int) $nt['id'];
            $acts = '';
            if ($nt['status'] === 'queued') $acts = (!$nt['hasAccount'] ? self::rowBtn('nrow', $id, 'sent', '📞 알렸어요', 'btn sm') . ' ' : '') . self::rowBtn('nrow', $id, 'cancel', '✖ 취소', 'btn ghost sm');
            $rows[] = ['attr' => ' class="note ' . self::e($nt['status']) . '"', 'cells' => [
                [self::e(self::at($nt['sentAt'] > 0 ? $nt['sentAt'] : $nt['sendAt'])), 'nowrap small'], self::e(isset(self::NOTICE_KIND[$nt['kind']]) ? self::NOTICE_KIND[$nt['kind']] : $nt['kind']),
                ((int) $nt['customerId'] > 0 ? '<a href="' . self::e(self::href(['sec' => 'customers', 'cust' => (int) $nt['customerId']])) . '">' . self::e($nt['customer'] !== '' ? $nt['customer'] : '#' . (int) $nt['customerId']) . '</a>' : '')
                    . ($nt['phoneTail'] !== '' ? ' <span class="dim small">끝번호 ' . self::e($nt['phoneTail']) . '</span>' : '') . ($nt['hasAccount'] ? '' : ' ' . self::badge('직접 연락', 'warn')),
                $nt['contractNo'] !== '' ? '<span class="small">' . self::e($nt['contractNo']) . '</span>' : '',
                ['<b>' . self::e($nt['title']) . '</b><br>' . self::e($nt['body']), 'msg'],
                self::st(self::NOTICE_STATUS, $nt['status']) . ($nt['status'] === 'queued' && $nt['hasAccount'] ? '<br><span class="dim small">' . self::e(self::at($nt['sendAt'])) . ' 예약</span>' : ''),
                [$acts, 'acts'],
            ]];
        }
        return $h . self::tbl(['때', '종류', '받는 사람', '계약', '내용', '상태', '처리'], $rows) . self::rowForm('nrow', 'allot_notice_done', $keep + ['after' => $after]) . self::pager($keep, $after, (int) $r['next']) . '</section>';
    }

    // ------------------------------------------------------------------ 📒 관리 일지
    private static function viewCare(array $q): string
    {
        $zone = isset($q['zone']) ? $q['zone'] : '';
        $unit = isset($q['u']) ? self::unitCode($q['u']) : '';
        $before = isset($q['before']) ? (int) $q['before'] : 0;
        $here = ['sec' => 'care', 'zone' => $unit !== '' ? '' : $zone, 'u' => $unit !== '' ? self::unitWord($unit) : ''];
        $to = ['all' => '모든 구역 (모두에게 보여요)'];
        foreach (self::sum()['zones'] as $z) $to['zone_' . strtolower($z['code'])] = '구역 ' . $z['code'] . ' · ' . $z['name'];
        $to['unit'] = '자리 하나 — 아래 칸에 자리 번호';
        $h = '<section class="card"><h3>✍️ 관리 일지 쓰기</h3><p class="dim small">"장독 뚜껑을 닦았어요"처럼 돌본 일을 적어요. <b>보이기</b>를 켜면 체험관에서 그 자리를 보는 사람 누구나 읽어요 (분양받은 사람에게는 "잘 돌보고 있어요"라는 소식이 돼요). '
            . '이름 · 전화번호 같은 개인정보와 나쁜 말은 저절로 가려져요.</p>' . self::open('allot_care_add', $here)
            . '<div class="fgrid"><label>어디에' . self::select('to', $to, $unit !== '' ? 'unit' : ($zone !== '' && isset($to['zone_' . $zone]) ? 'zone_' . $zone : 'all')) . '</label>'
            . '<label>자리 번호 (자리 하나일 때)<input name="ref" maxlength="24" value="' . self::e($unit) . '" placeholder="예: J01-0012" autocomplete="off" spellcheck="false"></label>'
            . '<label>무슨 일' . self::select('kind', self::CARE_KIND, 'care') . '</label></div>'
            . '<label>내용 (300자까지)<textarea name="text" required maxlength="300" rows="2" placeholder="예: 3구역 장독 뚜껑을 닦고 볕이 잘 들게 열어 두었어요."></textarea></label>'
            . '<label class="check"><input type="checkbox" name="visible" value="1" checked> 체험관에 보이기</label><button class="btn primary" type="submit">📒 일지 남기기</button></form></section>';
        $r = Allot::careAdmin(['zone' => $unit !== '' ? '' : $zone, 'unit' => $unit], self::ROWS, $before);
        $h .= '<section class="card"><h3>📒 관리 일지' . ($unit !== '' ? ' <span class="dim small">자리 ' . self::e($unit) . '</span>' : ($zone !== '' ? ' <span class="dim small">구역 ' . self::e(strtoupper($zone)) . '</span>' : '')) . '</h3>'
            . '<form method="get" action="./" class="search"><input type="hidden" name="tab" value="allot"><input type="hidden" name="sec" value="care">' . self::select('zone', self::zoneOptions(), $unit !== '' ? '' : $zone, '구역')
            . '<button class="btn" type="submit">보기</button>' . ($zone !== '' || $unit !== '' ? '<a class="btn ghost" href="' . self::e(self::href(['sec' => 'care'])) . '">모두 보기</a>' : '') . '</form>';
        if (!$r['logs']) return $h . '<p class="empty">🍃 ' . ($before > 0 ? '더 없어요.' : '아직 일지가 없어요.') . '</p>' . self::pager($here, $before, 0, 'before') . '</section>';
        $rows = [];
        $last = 0;
        foreach ($r['logs'] as $l) {
            $id = (int) $l['id'];
            $last = $id;
            $where = $l['scope'] === 'unit' ? '자리 <b>' . self::e($l['unitCode']) . '</b>' : ($l['scope'] === 'zone' ? '구역 <code>' . self::e($l['zoneCode']) . '</code>' : '모든 구역');
            $rows[] = ['attr' => ' class="care' . ($l['visible'] ? '' : ' muted') . '"', 'cells' => [
                [self::e(self::at($l['at'])), 'nowrap small'], $where, self::e(isset(self::CARE_KIND[$l['kind']]) ? self::CARE_KIND[$l['kind']] : $l['kind']), [self::e($l['text']), 'msg'],
                $l['visible'] ? self::badge('보임', 'ok') : self::badge('숨김'), self::e($l['by']),
                [$l['visible'] ? self::rowBtn('krow', $id, 'hide', '🙈 숨기기', 'btn ghost sm') : self::rowBtn('krow', $id, 'show', '👁️ 보이기', 'btn sm'), 'acts'],
            ]];
        }
        return $h . self::tbl(['때', '어디', '무슨 일', '내용', '체험관', '쓴 사람', '처리'], $rows) . self::rowForm('krow', 'allot_care_visible', $here + ['before' => $before])
            . self::pager($here, $before, $r['more'] ? $last : 0, 'before') . '</section>';
    }

    // ------------------------------------------------------------------ 📦 가져오기 · 내보내기
    /** the dry run that waits for its confirmation: ['what', 'at', 'ticket', 'csv', 'report'] or null (none, unreadable, older than IMPORT_TTL) */
    private static function importGet(): ?array
    {
        $raw = Session::get('allot_import');
        if ($raw === null) return null;
        $plain = is_string($raw) ? Crypto::open($raw) : null;
        $d = is_string($plain) ? Json::tryDecode($plain, true) : null;
        if (!is_array($d) || !isset($d['what'], $d['at'], $d['ticket'], $d['csv'], $d['report']) || !is_string($d['csv']) || !is_array($d['report']) || Clock::ms() - (int) $d['at'] > self::IMPORT_TTL * 1000) {
            Session::set('allot_import', null);
            return null;
        }
        return $d;
    }

    /** keep a dry run (the pasted text and its report) sealed in the session → its ticket */
    private static function importPut(string $what, string $csv, array $report): string
    {
        $report['rows'] = array_slice($report['rows'], 0, 300);
        $ticket = substr(hash('sha256', $what . "\n" . $csv), 0, 24);
        Session::set('allot_import', Crypto::seal((string) json_encode(['what' => $what, 'at' => Clock::ms(), 'ticket' => $ticket, 'csv' => $csv, 'report' => $report], JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE)));
        return $ticket;
    }

    /** the rows of a dry run as a table: the rows with a problem first */
    private static function importReport(array $d): string
    {
        $r = $d['report'];
        $ledger = $d['what'] === 'ledger';
        $act = ['new' => ['새 고객 + 새 계약', 'ok'], 'existing' => ['있는 고객 + 새 계약', 'ok'], 'duplicate' => ['이미 들어 있음 (건너뜀)', ''], 'payment' => ['입금 기록', 'ok'], 'problem' => ['문제 있음', 'fail']];
        $ok = (int) $r['invalid'] === 0;
        $h = '<section class="card' . ($ok ? '' : ' pii') . '"><h3>🔍 미리 보기 — ' . ($ledger ? '장부' : '입금 내역') . ' ' . ($ok ? self::badge('문제 없음', 'ok') : self::badge('문제 있는 줄 ' . self::n($r['invalid']) . '개', 'fail')) . '</h3>'
            . '<p><b>아직 아무것도 바꾸지 않았어요.</b> 모두 ' . self::e(self::n($r['total'])) . '줄 — 가져올 줄 ' . self::e(self::n($r['valid'])) . ' · 이미 들어 있어 건너뛸 줄 ' . self::e(self::n($r['skipped'])) . ' · 문제 있는 줄 ' . self::e(self::n($r['invalid'])) . '.</p>';
        if ($ok && (int) $r['valid'] > 0) {
            $h .= '<div class="row">' . self::button('allot_import_commit', '✅ 이대로 가져오기 (' . self::n($r['valid']) . '줄)', ['sec' => 'csv', 'ticket' => $d['ticket']], 'btn primary') . self::button('allot_import_cancel', '✖ 그만두기', ['sec' => 'csv'], 'btn ghost') . '</div>';
        } else {
            $h .= '<p class="notice">' . ($ok ? '새로 가져올 줄이 없어요 (모두 이미 들어 있어요).' : '한 줄이라도 문제가 있으면 <b>아무것도 가져오지 않아요</b>. 엑셀에서 아래 줄을 고친 뒤 다시 붙여 넣어 주세요.') . '</p>'
                . '<div class="row">' . self::button('allot_import_cancel', '↩️ 다시 붙여 넣기', ['sec' => 'csv'], 'btn') . '</div>';
        }
        $rows = [];
        foreach ($r['rows'] as $x) {
            $unit = is_string($x['unit']) && preg_match('/^[A-Za-z0-9\-]{1,24}$/', $x['unit']) ? $x['unit'] : ($x['unit'] === '' ? '' : '(알아볼 수 없는 값)');
            $a = isset($act[$x['action']]) ? $act[$x['action']] : [(string) $x['action'], ''];
            $rows[] = ['attr' => $x['ok'] ? '' : ' class="bad"', 'cells' => [(int) $x['line'] . '번째 줄', self::badge($a[0], $a[1]), self::e($unit), self::e(is_string($x['who']) ? $x['who'] : ''),
                [self::e(implode(' · ', is_array($x['problems']) ? array_map('strval', $x['problems']) : [])), 'msg']]];
        }
        $h .= self::tbl(['줄', '할 일', $ledger ? '자리' : '자리', $ledger ? '누구 (가림)' : '계약번호', '문제'], $rows);
        if ((int) $r['total'] > count($r['rows'])) $h .= '<p class="dim small">처음 ' . count($r['rows']) . '줄만 보여요 (문제 있는 줄이 먼저예요).</p>';
        return $h . '<p class="dim small">이 미리 보기는 ' . intdiv(self::IMPORT_TTL, 60) . '분 동안만 기다려요. 줄 번호는 붙여 넣은 내용의 줄(첫 줄 = 제목 줄)이에요.</p></section>';
    }

    private static function viewCsv(array $q, array $a): string
    {
        $h = '';
        $pending = self::importGet();
        if ($pending !== null) $h .= self::importReport($pending);
        $h .= '<div class="grid2"><section class="card"><h3>⬇️ 내보내기 (CSV)</h3>'
            . '<p class="dim small">엑셀에서 바로 열리는 파일(CSV)로 내려받아요. 이름과 전화번호는 <b>가려서</b>(김**, ***-****-1234) 내보내고 주소 · 고객 메모는 넣지 않아요. '
            . '세무 자료처럼 전체가 꼭 필요할 때만 아래 칸에 표시하고 까닭을 골라 주세요 — 누가 · 언제 · 왜 내려받았는지 기록이 남아요.</p>'
            . self::open('allot_export', ['sec' => 'csv']) . '<label>무엇을' . self::select('what', self::EXPORT_NAMES, 'ledger') . '</label>'
            . '<label class="check"><input type="checkbox" name="reveal" value="1"> 이름 · 전화번호 · 주소를 가리지 않고 내보내기</label>'
            . '<label>까닭 (가리지 않을 때 · 기록에 남아요)' . self::select('why', Allot::REVEAL_REASONS, 'report') . '</label>';
        if (self::piiOpen($a)) $h .= self::piiField($a);
        else $h .= '<label>관리자 비밀번호 (가리지 않을 때만 필요해요)<input type="password" name="password" autocomplete="current-password" maxlength="128"></label>';
        $h .= '<button class="btn primary" type="submit">⬇️ CSV 내려받기</button></form>'
            . '<p class="dim small">파일은 UTF-8(BOM) · 줄 끝 CRLF 이고, <code>=</code> <code>+</code> <code>-</code> <code>@</code> 로 시작하는 칸 앞에는 작은따옴표를 붙여요 (엑셀이 수식으로 실행하지 못하게). 내려받은 파일은 지우기 전까지 그 컴퓨터에 남으니 조심해서 다뤄 주세요. '
            . '서버 컴퓨터에서는 <code>php cli/tfm.php allot:export contracts 파일.csv</code>.</p></section>';
        $h .= '<section class="card"><h3>⬆️ 가져오기 (붙여 넣기)</h3>';
        if ($pending !== null) {
            $h .= '<p class="notice">위에 확인을 기다리는 미리 보기가 있어요. 가져오거나 그만둔 뒤에 새로 붙여 넣을 수 있어요.</p>';
        } else {
            $h .= '<p class="dim small">지금 쓰는 엑셀 장부를 옮겨요. 엑셀에서 <b>제목 줄을 포함해</b> 칸들을 골라 복사(Ctrl+C)한 다음 아래 칸에 붙여 넣으면 돼요 (CSV 파일의 내용을 붙여 넣어도 돼요). 먼저 <b>미리 보기</b>로 줄마다 무엇이 만들어지는지 · 어디가 잘못됐는지 보여 주고, 확인을 눌러야 가져와요.</p>'
                . self::open('allot_import_preview', ['sec' => 'csv']) . '<label>무엇을' . self::select('what', ['ledger' => '📒 장부 — 이미 분양한 자리 (고객 + 진행 중 계약이 만들어져요)', 'payments' => '💰 입금 내역 — 계약에 입금 기록'], 'ledger') . '</label>'
                . '<label>붙여 넣기 (첫 줄은 제목 줄)<textarea name="csv" required rows="8" spellcheck="false" autocomplete="off" placeholder="일자,성명,연락처,주소,비고,단위&#10;2024-03-15,홍길동,010-1234-5678,,3년차,J01-0012"></textarea></label>'
                . '<button class="btn primary" type="submit">🔍 미리 보기 (아무것도 바꾸지 않아요)</button></form>';
        }
        $h .= '<details class="acts"><summary>📋 어떤 칸이 필요한가요?</summary><div class="mdoc"><p><b>장부</b>: <code>성명</code> · <code>연락처</code> · <code>단위</code>(자리 번호 J01-0012, 또는 구역 번호 J01 = 그 구역의 다음 빈자리)가 꼭 있어야 하고, '
            . '<code>일자</code>(계약한 날) · <code>주소</code> · <code>비고</code> · <code>납부기한</code>은 있으면 써요. 한 줄이 고객 한 명 + 진행 중인 계약 하나가 돼요. 같은 파일을 두 번 넣어도 두 번 만들어지지 않아요.</p>'
            . '<pre class="csv">일자,성명,연락처,주소,비고,단위' . "\n" . '2024-03-15,홍길동,010-1234-5678,강원 정선군,3년차,J01-0012' . "\n" . '2025-04-02,김영희,010-9876-5432,,,J01</pre>'
            . '<p><b>입금 내역</b>: <code>계약번호</code>(또는 쓰고 있는 <code>단위</code>) · <code>금액</code>이 꼭 있어야 하고, <code>일자</code> · <code>방법</code>(계좌이체 · 현금 · 자동이체 · 기타) · <code>비고</code>는 있으면 써요.</p>'
            . '<pre class="csv">계약번호,금액,일자,방법,비고' . "\n" . 'A26-ABCDE-FGHJK,120000,2026-03-25,계좌이체,농협</pre>'
            . '<p>전화번호가 가려진(010-****-5678) 파일은 가져올 수 없어요. 한 번에 약 1만 줄(2 MB)까지 붙여 넣을 수 있고, 더 크면 서버 컴퓨터에서 <code>php cli/tfm.php allot:import ledger 파일.csv</code> (끝에 <code>--commit</code> 을 붙여야 진짜로 가져와요)를 써요. '
            . '붙여 넣고 누른 뒤 "보안 토큰이 맞지 않아요"가 나오면 내용이 서버가 받는 크기보다 큰 거예요 — 나눠서 넣어 주세요.</p></div></details></section></div>';
        return $h;
    }

    // ------------------------------------------------------------------ ⚙️ 자동화
    /** rule → [label, what it means in plain words, input: bool | int | text | [value => label]] — in the order the form shows them */
    private const RULES_META = [
        'enabled' => ['분양 받기', '끄면 체험관의 분양 화면과 신청이 모두 닫히고 자동화도 쉬어요. 이미 맺은 계약은 그대로 남아요.', 'bool'],
        'auto_approve' => ['신청을 누가 확정하나요', '운영자가 직접 승인하는 것을 권해요 — 어른(보호자)이 신청했는지, 입금이 됐는지 확인할 수 있으니까요.', ['off' => '운영자가 직접 승인 (권장)', 'on_payment' => '입금이 기록되면 저절로 확정', 'always' => '신청하자마자 확정']],
        'hold_hours' => ['신청한 자리를 잡아 두는 시간', '이 시간(단위: 시간) 안에 승인도 입금 기록도 없으면 신청이 저절로 취소되고 자리가 다시 비어요. 0 = 저절로 취소하지 않음.', 'int'],
        'apply_per_user' => ['한 계정이 가질 수 있는 수', '체험관 계정 하나가 동시에 가질 수 있는 신청 · 계약 · 대기를 모두 더한 수예요.', 'int'],
        'notice_days' => ['미리 알리는 날', '납부 기한과 계약이 끝나는 날의 며칠 전에 알림을 보낼지 쉼표로 적어요. 0 = 그날. 예: 30, 7, 0', 'text'],
        'grace_days' => ['연체로 표시하기까지 기다리는 날', '납부 기한이 지나고 이만큼(일) 더 기다린 뒤에 "연체"로 표시하고 알림을 보내요.', 'int'],
        'overdue_end_days' => ['연체가 이어지면 저절로 끝내기', '연체가 이만큼(일) 이어지면 계약을 끝내고 자리를 비워요. 0 = 저절로 끝내지 않음 (권장) — 진짜 항아리는 운영자가 확인하고 직접 정리해요.', 'int'],
        'waitlist_offer_hours' => ['대기자의 답을 기다리는 시간', '자리가 나면 맨 앞 대기자에게 제안하고 이 시간(단위: 시간) 동안 기다려요. 지나면 다음 사람에게 넘어가요.', 'int'],
        'retention_days' => ['개인정보 보관 기간', '마지막 계약이 끝나고 이만큼(일) 지나면 이름 · 전화번호 · 주소를 저절로 지워요 (계약 · 입금 기록은 이름 없이 남아요). 1825 = 5년. 법으로 정해진 보관 기간이 있는지 꼭 확인해 주세요.', 'int'],
        'collect_address' => ['신청할 때 주소도 받기', '꼭 필요할 때만 켜세요. 적게 모을수록 안전해요.', 'bool'],
        'nameplate_default_show' => ['이름표를 처음부터 공개', '끄면 신청자가 "공개"를 고른 이름표만 체험관에 보여요.', 'bool'],
        'toss_enabled' => ['토스 결제 버튼', '켜면 체험관 "내 분양"에 토스페이먼츠 결제 버튼이 생겨요 (토스 키가 설정되어 있어야 해요). 끄면 입금 안내 문구만 보여요.', 'bool'],
        'daily_report_mail' => ['하루 요약 메일', '켜면 하루 한 번 분양 현황 숫자를 운영자 메일(config.local.php 의 security.alert_email)로 보내요. 개인정보는 들어가지 않아요.', 'bool'],
        'consent_version' => ['동의 문구의 판(版) 이름', '바꾸면 모든 신청자가 새로 동의해요. 안내 문구를 고치면 판이 저절로 바뀌니 보통은 그대로 둬요. 영문 · 숫자 · 점 · 줄표 20자까지.', 'text'],
        'lazy_tick_minutes' => ['자동화 간격 (작업 스케줄러가 없을 때)', '관리자 화면이나 분양 화면을 열 때 이 간격(단위: 분)으로 자동화가 한 번씩 돌아요.', 'int'],
        'tick_batch' => ['한 번에 처리하는 수', '자동화의 한 단계가 한 번에 처리하는 가장 많은 건수예요. 보통은 그대로 둬요.', 'int'],
    ];
    private const TEXTS_META = [
        'terms_text' => ['terms', '📜 이용 안내 (약관)', '분양이 무엇이고 어떻게 진행되는지. 신청 화면에서 보여 줘요.'],
        'privacy_text' => ['privacy', '🔐 개인정보 수집 · 이용 안내', '무엇을 왜 모으고 언제까지 보관하는지. 신청자가 동의하는 글이에요.'],
        'refund_text' => ['refund', '↩️ 취소 · 환불 안내', '취소와 환불을 어떻게 하는지.'],
        'pay_guide' => ['payGuide', '💳 입금 안내', '신청한 사람에게 보여 주는 입금 방법 (계좌 등).'],
    ];

    private static function ruleText(string $k, $v): string
    {
        if (is_bool($v)) return $v ? '켬' : '끔';
        if (is_array($v)) return implode(', ', array_map('strval', $v));
        $m = self::RULES_META[$k][2];
        return is_array($m) && isset($m[(string) $v]) ? $m[(string) $v] : (string) $v;
    }

    private static function viewAuto(array $q, array $get): string
    {
        $s = self::sum();
        $rules = $s['rules'];
        $run = $s['lastRun'];
        $h = '<div class="grid2">' . self::autoCard($s) . '<section class="card"><h3>🗓️ 저절로 돌게 하기</h3>'
            . '<p class="dim small">자동화는 두 가지 방법으로 돌아요. <b>① 작업 스케줄러</b> (권장): 서버 컴퓨터가 한 시간에 한 번 아래 명령을 실행해요. <b>② 화면을 열 때</b>: 스케줄러가 없어도 누군가 관리자 화면이나 분양 화면을 열면 '
            . (int) $rules['lazy_tick_minutes'] . '분 간격으로 한 번씩 돌아요 — 아무도 안 들어오는 날에는 돌지 않으니 ①을 해 두는 것이 좋아요.</p>'
            . '<ol class="todo small"><li>Windows 시작 → "작업 스케줄러" → "기본 작업 만들기"</li><li>트리거: 매일, 그다음 "반복 간격 1시간"</li>'
            . '<li>동작: 프로그램 <code>C:\xampp\php\php.exe</code> · 인수 <code>cli\tfm.php allot:tick --quiet</code> · 시작 위치 = 체험관 서버 폴더</li></ol>'
            . '<p class="dim small">지금 상태만 보려면 서버 컴퓨터에서 <code>php cli/tfm.php allot:status</code>.</p></section></div>';

        // what the last run could not repair by itself
        $issues = $run !== null && isset($run['summary']['issues']) && is_array($run['summary']['issues']) ? $run['summary']['issues'] : [];
        if ($issues) {
            $rows = [];
            foreach (array_slice($issues, 0, 20) as $i) $rows[] = ['cells' => [self::e(isset($i['ref']) ? (string) $i['ref'] : ''), self::e(isset($i['kind']) ? (string) $i['kind'] : ''), [self::e(isset($i['note']) ? (string) $i['note'] : ''), 'msg']]];
            $h .= '<section class="card"><h3>🔧 직접 확인이 필요한 항목 ' . self::badge(count($issues) . '건', 'fail') . '</h3><p class="dim small">자동화의 점검이 자리와 계약을 맞춰 보다가, 저절로 고칠 수 없는 것을 찾았어요. 해당 계약 · 자리를 열어 확인해 주세요.</p>'
                . self::tbl(['어디', '종류', '무슨 일'], $rows) . '</section>';
        }

        // the rules
        $h .= '<section class="card"><h3>⚙️ 규칙</h3><p class="dim small">자동화가 따르는 약속이에요. 바꾸면 바로 적용되고, 바꾼 기록은 📜 감사 로그에 남아요. 값이 정해진 범위를 벗어나면 저장되지 않아요.</p>'
            . self::open('allot_settings', ['sec' => 'auto'], 'rules');
        foreach (self::RULES_META as $k => $m) {
            $v = isset($rules[$k]) ? $rules[$k] : '';
            if ($m[2] === 'bool') $in = self::select($k, ['1' => '켬', '0' => '끔'], $v ? '1' : '0', $m[0]);
            elseif (is_array($m[2])) $in = self::select($k, $m[2], (string) $v, $m[0]);
            else $in = '<input name="' . self::e($k) . '" value="' . self::e(is_array($v) ? implode(', ', $v) : (string) $v) . '" maxlength="40"' . ($m[2] === 'int' ? ' inputmode="numeric"' : '') . ' aria-label="' . self::e($m[0]) . '" required>';
            $h .= '<div class="rule"><div><b>' . self::e($m[0]) . '</b><p class="dim small">' . self::e($m[1]) . '</p></div><div>' . $in . '<p class="dim small">지금: ' . self::e(self::ruleText($k, $v)) . '</p></div></div>';
        }
        $h .= '<button class="btn primary" type="submit">💾 규칙 저장</button></form></section>';

        // the operator texts
        $texts = Allot::texts();
        $h .= '<section class="card"><h3>📝 안내 문구 ' . ($texts['sample'] ? self::badge('예시 문구가 남아 있어요', 'warn') : self::badge('모두 바꿨어요', 'ok')) . '</h3>'
            . '<p class="sample">⚠️ <b>예시</b>로 들어 있는 글은 그대로 쓰면 안 돼요. 실제 운영 내용(가격 · 기간 · 환불 · 보관 기간 · 연락처)에 맞게 바꿔 주세요. <b>법률 검토가 필요해요</b> — 약관 · 개인정보 수집 동의 · 환불 규정은 '
            . '공개하기 전에 변호사나 전문가에게 확인받는 것을 권해요. 이 화면은 법률 자문을 대신하지 않아요.</p>'
            . '<p class="dim small">지금 동의 판: <code>' . self::e(Allot::consentVersion()) . '</code> — 개인정보 안내나 이용 안내를 고치면 판이 바뀌고, 그 뒤에 신청하는 사람은 새 글에 동의해요. 이미 동의한 사람이 읽은 글은 아래 "동의 문구 기록"에 남아요.</p>'
            . self::open('allot_texts', ['sec' => 'auto']);
        foreach (self::TEXTS_META as $k => $m) {
            $own = class_exists('Tfm\Settings') && Settings::has('allot.' . $k) && is_string(Settings::get('allot.' . $k)) && trim((string) Settings::get('allot.' . $k)) !== '';
            $cur = (string) $texts[$m[0]];
            $h .= '<label><b>' . self::e($m[1]) . '</b> ' . ($own ? '' : self::badge('예시', 'warn')) . '<span class="dim small">' . self::e($m[2]) . ' 4,000자까지. ' . ($own ? '모두 지우고 저장하면 예시 문구로 돌아가요.' : '비워 두면 아래 예시 문구가 그대로 보여요.') . '</span>'
                . '<textarea name="' . self::e($k) . '" maxlength="4000" rows="' . ($own ? '8' : '4') . '"' . ($own ? '' : ' placeholder="여기에 실제 문구를 적어 주세요"') . '>' . ($own ? self::e($cur) : '') . '</textarea></label>';
            if (!$own) $h .= '<details class="acts"><summary>지금 보이는 예시 문구 보기</summary><blockquote class="note prewrap">' . self::e($cur) . '</blockquote></details>';
        }
        $h .= '<button class="btn primary" type="submit">💾 안내 문구 저장</button></form></section>';

        // history
        $runs = Allot::jobRuns(20);
        $h .= '<section class="card"><h3>🧾 자동화 기록 <span class="dim small">최근 ' . count($runs) . '번 (180일 동안 보관)</span></h3>';
        if (!$runs) $h .= '<p class="empty">🍃 아직 기록이 없어요.</p>';
        else {
            $rows = [];
            foreach ($runs as $r) {
                $sm = $r['summary'];
                $n = isset($sm['issues']) && is_array($sm['issues']) ? count($sm['issues']) : 0;
                $rows[] = ['cells' => ['#' . (int) $r['id'], [self::e(self::at($r['startedAt'])), 'nowrap'], self::e(isset(self::TICK_SOURCE[$r['source']]) ? self::TICK_SOURCE[$r['source']] : $r['source']),
                    $r['ok'] ? self::badge('잘 끝남', 'ok') : ((int) $r['finishedAt'] === 0 ? self::badge('끝나지 않음', 'warn') : self::badge('문제 있음', 'fail')),
                    [self::e(self::stepsText($sm)) . (isset($sm['errors']) && is_array($sm['errors']) && $sm['errors'] ? '<br><span class="dim small">문제: ' . self::e(implode(', ', array_map('strval', $sm['errors']))) . '</span>' : ''), 'msg'],
                    $n > 0 ? self::badge($n . '건', 'fail') : '', [isset($sm['ms']) ? self::e(self::n($sm['ms'])) . ' ms' : '', 'nowrap small']]];
            }
            $h .= self::tbl(['번호', '때', '누가', '결과', '한 일', '확인 필요', '걸린 시간'], $rows);
        }
        $h .= '</section>';

        // consent versions
        $vers = Allot::termsVersions(20);
        $h .= '<div class="grid2"><section class="card"><h3>📚 동의 문구 기록</h3><p class="dim small">신청자가 동의할 때 읽은 글을 판마다 그대로 보관해요 (나중에 "무엇에 동의했는지" 보여 줄 수 있어요).</p>';
        if (!$vers) $h .= '<p class="empty">🍃 아직 체험관에서 동의한 사람이 없어요.</p>';
        else {
            $rows = [];
            foreach ($vers as $v) $rows[] = ['cells' => ['<a href="' . self::e(self::href(['sec' => 'auto', 'tv' => $v['ver']])) . '"><code>' . self::e($v['ver']) . '</code></a>', [self::e(self::at($v['at'])), 'nowrap small'], self::e(self::n($v['customers'])) . '명']];
            $h .= self::tbl(['판', '처음 쓰인 때', '이 판에 동의한 고객'], $rows);
        }
        $tv = self::s($get, 'tv');
        if (preg_match('/^[A-Za-z0-9.\-]{1,40}$/', $tv) && ($t = Allot::termsOf($tv)) !== null) {
            $h .= '<h4>판 <code>' . self::e($t['ver']) . '</code> 의 글</h4><blockquote class="note prewrap"><b>개인정보 안내</b>' . "\n" . self::e($t['privacy']) . "\n\n" . '<b>이용 안내</b>' . "\n" . self::e($t['terms']) . "\n\n" . '<b>환불 안내</b>' . "\n" . self::e($t['refund']) . '</blockquote>';
        }
        $h .= '</section>';

        // demo data (a test site only)
        $demo = Allot::demoInfo();
        $empty = (int) $s['pending'] + (int) $s['active'] + (int) $s['overdue'] === 0;
        $h .= '<section class="card"><h3>🧪 예시 자료 (시험해 볼 때만)</h3>';
        if ($demo !== null) {
            $h .= '<p class="notice">지금 <b>예시 자료</b>가 들어 있어요: 가짜 고객 ' . count($demo['customers']) . '명 ("예시고객01" …, 전화 010-0000-00NN). 진짜 운영을 시작하기 전에 지워 주세요.</p>'
                . '<div class="row">' . self::button('allot_demo', '🧹 예시 자료 지우기', ['sec' => 'auto', 'op' => 'clear'], 'btn danger') . '</div><p class="dim small">예시 자료가 만든 고객 · 계약 · 입금 · 알림 · 일지만 지워요. 구역과 자리는 남아요.</p>';
        } elseif ($empty) {
            $h .= '<p class="dim small">분양 화면이 어떻게 보이는지 미리 보고 싶을 때, 가짜 고객 40명과 여러 상태의 계약(진행 중 · 미납 · 승인 대기 · 곧 끝남 · 끝남)을 만들어요. <b>진짜 고객이나 계약이 하나라도 있으면 만들어지지 않아요</b> (장부와 섞이지 않게요).</p>'
                . '<div class="row">' . self::button('allot_demo', '🧪 예시 자료 넣어 보기', ['sec' => 'auto', 'op' => 'seed'], 'btn') . '</div>';
        } else {
            $h .= '<p class="dim small">이미 계약이 있는 곳에는 예시 자료를 넣지 않아요 (진짜 장부와 섞이지 않게요).</p>';
        }
        return $h . '</section></div>';
    }

    // @@VIEW-METHODS@@

    // ================================================================== actions
    /**
     * One action of the tab. The admin entry has checked origin, token, role and elevation; this checks the fields.
     * @return array ['msg' => the flash text (never personal data), 'back' => extra query values of the 303]
     */
    public static function action(string $action, Ctx $c, array $p): array
    {
        $a = is_array($c->user) ? $c->user : [];
        try {
            switch ($action) {
                case 'allot_seed': return self::doSeed($a, $p);
                case 'allot_zone_save': return self::doZoneSave($a, $p);
                case 'allot_zone_open': return self::doZoneOpen($a, $p);
                case 'allot_unit': return self::doUnit($a, $p);
                case 'allot_units_bulk': return self::doUnitsBulk($a, $p);
                case 'allot_tick': return self::doTick($a, $p);
                case 'allot_find': return self::doFind($a, $p);
                case 'allot_decide': return self::doDecide($a, $p);
                case 'allot_contracts_bulk': return self::doContractsBulk($a, $p);
                case 'allot_pay': return self::doPay($a, $p);
                case 'allot_refund': return self::doRefund($a, $p);
                case 'allot_renew': return self::doRenew($a, $p);
                case 'allot_autorenew': return self::doAutoRenew($a, $p);
                case 'allot_move': return self::doMove($a, $p);
                case 'allot_end': return self::doEnd($a, $p);
                case 'allot_memo': return self::doMemo($a, $p);
                case 'allot_contract_new': return self::doContractNew($a, $p);
                case 'allot_customer_save': return self::doCustomerSave($a, $p);
                case 'allot_customer_link': return self::doCustomerLink($a, $p);
                case 'allot_reveal': return self::doReveal($a, $p);
                case 'allot_pii_lock': return self::doPiiLock($a, $p);
                case 'allot_wait_cancel': return self::doWaitCancel($a, $p);
                case 'allot_wait_offer': return self::doWaitOffer($a, $p);
                case 'allot_notify': return self::doNotify($a, $p);
                case 'allot_notice_done': return self::doNoticeDone($a, $p);
                case 'allot_care_add': return self::doCareAdd($a, $p);
                case 'allot_care_visible': return self::doCareVisible($a, $p);
                case 'allot_export': return self::doExport($a, $p);
                case 'allot_import_preview': return self::doImportPreview($a, $p);
                case 'allot_import_commit': return self::doImportCommit($a, $p);
                case 'allot_import_cancel': return self::doImportCancel($a, $p);
                case 'allot_settings': return self::doSettings($a, $p);
                case 'allot_texts': return self::doTexts($a, $p);
                case 'allot_demo': return self::doDemo($a, $p);
            }
        } catch (ApiException $e) {
            // the library names the field of a refused value in its own words: say it in the operator's
            $f = is_array($e->data) && isset($e->data['field']) && is_string($e->data['field']) ? $e->data['field'] : '';
            if ($e->errorCode === 'INVALID_INPUT' && $f !== '' && isset(self::FIELD_KO[$f])) {
                throw new ApiException($e->status, $e->errorCode, str_replace('‘' . $f . '’', '‘' . self::FIELD_KO[$f] . '’', $e->getMessage()), $e->data, $e->headers);
            }
            throw $e;
        }
        throw new ApiException(400, 'UNKNOWN_ACTION', '알 수 없는 작업이에요.');
    }

    private static function ok(string $msg, array $back = []): array { return ['msg' => $msg, 'back' => $back]; }
    private static function actor(array $a): ?int { return isset($a['id']) && (int) $a['id'] > 0 ? (int) $a['id'] : null; }

    /** ids[] of a bulk form (or every id of the page when "all of this page" is ticked): 1…ROWS distinct positive integers */
    public static function ids(array $p): array
    {
        $raw = [];
        if (self::s($p, 'all_page') === '1') $raw = explode(',', self::s($p, 'page_ids'));
        elseif (isset($p['ids']) && is_array($p['ids'])) $raw = $p['ids'];
        $ids = [];
        foreach ($raw as $v) {
            if (!is_string($v) || $v === '' || strlen($v) > 15 || !ctype_digit($v) || (int) $v < 1) continue;
            $ids[(int) $v] = true;
            if (count($ids) >= self::ROWS) break;
        }
        if (!$ids) throw new ApiException(400, 'INVALID_INPUT', '먼저 목록에서 하나 이상 골라 주세요 (왼쪽 네모 칸에 표시).');
        return array_keys($ids);
    }

    private static function doSeed(array $a, array $p): array
    {
        $preset = self::s($p, 'preset') === 'small' ? 'small' : 'default';
        $r = Allot::seedPreset($a, $preset, false);
        return self::ok('🏺 구역 ' . self::n($r['zones']) . '곳 · 자리 ' . self::n($r['units']) . '개가 준비됐어요 (새로 만든 구역 ' . self::n($r['created']) . '곳, 새 자리 ' . self::n($r['added']) . '개). '
            . '가격과 기간은 예시예요 — 🗺️ 구역에서 확인하고, 준비된 구역만 "신청 받기"를 켜 주세요.', ['sec' => 'zones']);
    }

    private static function doZoneSave(array $a, array $p): array
    {
        $in = [];
        $id = self::id($p, 'id');
        if ($id > 0) $in['id'] = $id;
        else { $in['code'] = strtoupper(trim(self::s($p, 'code'))); $in['kind'] = self::s($p, 'kind'); }
        foreach (['name', 'note'] as $k) if (isset($p[$k])) $in[$k] = self::s($p, $k);
        foreach (['capacity', 'cols', 'sort', 'price', 'termMonths'] as $k) { $v = self::digits(self::s($p, $k)); if ($v !== '') $in[$k] = $v; }
        if (self::s($p, 'period') !== '') $in['period'] = self::s($p, 'period');
        $in['isOpen'] = self::s($p, 'isOpen') === '1';
        $z = Allot::saveZone($a, $in);
        return self::ok(($id > 0 ? '💾 ' : '➕ ') . $z['code'] . ' 구역을 ' . ($id > 0 ? '저장했어요' : '만들었어요') . ' — 자리 ' . self::n($z['units']) . '개 · ' . self::plan($z['period'], (int) $z['price'], (int) $z['termMonths'])
            . ' · ' . ($z['isOpen'] ? '신청 받는 중' : '신청 닫힘') . '.', ['sec' => 'zones']);
    }

    /** a row button of the zone list: pick = "<zone id>:open" | "<zone id>:close" */
    private static function doZoneOpen(array $a, array $p): array
    {
        list($id, $what) = self::pick($p);
        if ($what !== 'open' && $what !== 'close') throw new ApiException(400, 'INVALID_INPUT', '목록에서 버튼을 다시 눌러 주세요.');
        $z = Allot::saveZone($a, ['id' => $id, 'isOpen' => $what === 'open']);
        return self::ok($what === 'open' ? '🟢 ' . $z['code'] . ' 구역의 신청을 열었어요. 체험관에서 바로 신청할 수 있어요.' : '🚫 ' . $z['code'] . ' 구역의 신청을 닫았어요. 이미 맺은 계약은 그대로예요.', ['sec' => 'zones']);
    }

    private static function stateWord(string $s): string { return $s === 'open' ? '다시 열었어요' : ($s === 'closed' ? '닫았어요' : '보류로 잡아 두었어요'); }

    /**
     * A row button of the unit list: pick = "<unit id>:<what>" — closed | open | held (until it is opened again) |
     * held24 (for a day) | label (the nameplate of that row: text_<id>, show_<id>).
     */
    private static function doUnit(array $a, array $p): array
    {
        list($id, $what) = self::pick($p);
        if ($what === 'label') {
            $r = Allot::setLabel($a, $id, self::s($p, 'text_' . $id), self::s($p, 'show_' . $id) === '1');
            return self::ok($r['text'] === '' ? '🏷️ ' . $r['unit'] . ' 자리의 이름표를 지웠어요.'
                : '🏷️ ' . $r['unit'] . ' 자리의 이름표를 저장했어요 (' . ($r['show'] ? '체험관에 보여요' : '숨김') . '). 개인정보와 나쁜 말은 저절로 가려져요.');
        }
        if (!in_array($what, ['open', 'closed', 'held', 'held24'], true)) throw new ApiException(400, 'INVALID_INPUT', '목록에서 버튼을 다시 눌러 주세요.');
        $state = $what === 'held24' ? 'held' : $what;
        $u = Allot::setUnitState($a, $id, $state, $what === 'held24' ? 24 : 0);
        return self::ok('🏺 ' . $u['code'] . ' 자리를 ' . self::stateWord($state) . ($what === 'held24' ? ' (하루 뒤에 저절로 풀려요)' : '') . '.');
    }

    private static function doUnitsBulk(array $a, array $p): array
    {
        $op = self::s($p, 'op');
        if (!in_array($op, ['open', 'closed', 'held'], true)) throw new ApiException(400, 'INVALID_INPUT', '할 일을 골라 주세요.');
        $done = 0;
        $skipped = 0;
        foreach (self::ids($p) as $id) {
            try { Allot::setUnitState($a, $id, $op, 0); $done++; }
            catch (ApiException $e) { if (!in_array($e->errorCode, ['UNIT_IN_USE', 'UNIT_TAKEN', 'NOT_FOUND'], true)) throw $e; $skipped++; }
        }
        return self::ok('🏺 ' . self::n($done) . '자리를 ' . self::stateWord($op) . ($skipped > 0 ? ' — 계약이나 제안이 걸려 있어 건너뛴 자리 ' . self::n($skipped) . '개.' : '.'));
    }

    private static function doTick(array $a, array $p): array
    {
        $r = Allot::tick(null, 'admin');
        self::$sum = null;
        Audit::log('allot_tick_run', null, ['ok' => $r['ok'], 'steps' => $r['steps'], 'issues' => count($r['issues']), 'ms' => $r['ms']], 'info', self::actor($a));
        $msg = ($r['ok'] ? '▶️ 자동화를 한 번 돌렸어요 — ' : '⚠️ 자동화를 돌렸지만 일부 단계에 문제가 있었어요 (data/logs 를 확인해 주세요) — ') . self::stepsText($r)
            . (count($r['issues']) > 0 ? ' · 직접 확인이 필요한 항목 ' . count($r['issues']) . '건 (⚙️ 자동화에서 볼 수 있어요)' : '') . ($r['more'] ? ' · 남은 일이 더 있어요: 한 번 더 눌러 주세요' : '') . '.';
        return self::ok($msg);
    }

    // ------------------------------------------------------------------ search, step-up, reveal
    /** the search box: the text is kept sealed in the session, the 303 carries a random token (never the text) */
    private static function doFind(array $a, array $p): array
    {
        $text = trim(mb_substr(self::s($p, 'find'), 0, 60));
        $sec = self::s($p, 'sec') === 'customers' ? 'customers' : 'contracts';
        if ($text === '' || !mb_check_encoding($text, 'UTF-8')) throw new ApiException(400, 'INVALID_INPUT', '찾을 말을 적어 주세요 (전화번호 전체 · 끝 4자리 · 이름 전체' . ($sec === 'customers' ? ' · #고객번호' : ' · 계약번호 · 자리 번호') . ').');
        $info = self::findInfo($text);
        // a contract number or a unit code is looked up in the contract list, a customer number in the customer list
        if ($sec === 'customers' && ($info['by'] === 'contract' || $info['by'] === 'unit')) $sec = 'contracts';
        if ($sec === 'contracts' && $info['by'] === 'id') $sec = 'customers';
        $tok = self::findPut($text);
        Audit::log('allot_search', null, ['list' => $sec, 'by' => $info['by']], 'info', self::actor($a));
        return ['msg' => '🔎 ' . $info['label'] . '(으)로 찾았어요.', 'back' => ['sec' => $sec, 's' => $tok, 'after' => null, 'dc' => null, 'st' => null, 'flag' => null]];
    }

    /** the step-up: the window is open, or the password typed into this form is right (then it opens) — 400 / 401 / 429 otherwise */
    private static function stepUp(array $a, array $p): void
    {
        if (self::piiOpen($a)) return;
        $pw = self::s($p, 'password');
        if ($pw === '') throw new ApiException(400, 'REAUTH_REQUIRED', '개인정보를 보려면 관리자 비밀번호를 한 번 더 넣어 주세요.');
        $key = mb_strtolower((string) (isset($a['email']) && $a['email'] !== '' ? $a['email'] : (isset($a['nickname']) ? $a['nickname'] : '')));
        $wait = LoginThrottle::check($key);
        if ($wait > 0) throw new ApiException(429, 'TOO_MANY_ATTEMPTS', "비밀번호를 여러 번 틀렸어요. {$wait}초 뒤에 다시 해 주세요.");
        if (strlen($pw) > 256 || !Users::verifyPassword($a, $pw)) {
            LoginThrottle::record($key, false);
            Audit::log('allot_pii_denied', null, ['why' => 'password'], 'warn', self::actor($a));
            throw new ApiException(401, 'INVALID_CREDENTIALS', '비밀번호가 맞지 않아요. 개인정보는 보여 드리지 않았어요.');
        }
        Session::set('allot_pii', ['uid' => (int) $a['id'], 'until' => Clock::ms() + self::PII_WINDOW * 1000]);
        Audit::log('allot_pii_unlocked', null, ['minutes' => intdiv(self::PII_WINDOW, 60)], 'warn', self::actor($a));
    }

    /** 🔓 한 번 보기: step-up → Allot::customer(reveal) (audit: customer id + reason code) → the record waits sealed for ONE page view */
    private static function doReveal(array $a, array $p): array
    {
        $id = self::id($p, 'cust');
        if ($id < 1) throw new ApiException(400, 'INVALID_INPUT', '고객을 다시 골라 주세요.');
        $why = self::s($p, 'why');
        if (!isset(Allot::REVEAL_REASONS[$why])) throw new ApiException(400, 'INVALID_INPUT', '보는 까닭을 골라 주세요.');
        self::stepUp($a, $p);
        $cu = Allot::customer($id, true, $a, $why);
        $data = ['nameFull' => (string) $cu['nameFull'], 'phoneFull' => (string) $cu['phoneFull'], 'addr' => (string) $cu['addr'], 'memo' => (string) $cu['memo']];
        Session::set('allot_reveal', ['cust' => $id, 'at' => Clock::ms(), 'data' => Crypto::seal((string) json_encode($data, JSON_UNESCAPED_UNICODE))]);
        return self::ok('🔓 #' . $id . ' 고객의 개인정보를 아래에 한 번만 보여 드려요. 화면을 떠나거나 새로 고치면 다시 가려져요. (본 기록이 남았어요)', ['sec' => 'customers', 'cust' => $id]);
    }

    private static function doPiiLock(array $a, array $p): array
    {
        Session::set('allot_pii', null);
        Session::set('allot_reveal', null);
        Audit::log('allot_pii_locked', null, [], 'info', self::actor($a));
        return self::ok('🔒 개인정보 보기를 잠갔어요. 다시 보려면 비밀번호를 넣어야 해요.');
    }

    // ------------------------------------------------------------------ contracts
    /** approve / reject a pending application: a row button (pick = "<id>:approve|reject") or the form of the contract page */
    private static function doDecide(array $a, array $p): array
    {
        if (self::s($p, 'pick') !== '') { list($id, $what) = self::pick($p); $memo = ''; }
        else { $id = self::id($p, 'con'); $what = self::s($p, 'decision'); $memo = self::s($p, 'memo'); }
        if ($what !== 'approve' && $what !== 'reject') throw new ApiException(400, 'INVALID_INPUT', '✅ 승인이나 ↩️ 반려 버튼을 눌러 주세요.');
        $c = Allot::decide($a, $id, $what === 'approve' ? 'active' : 'canceled', $memo);
        return self::ok($what === 'approve' ? '✅ ' . $c['contractNo'] . ' (' . $c['unitCode'] . ') 신청을 승인했어요. 오늘부터 시작이고, 고객에게 확정 알림이 갔어요.'
            : '↩️ ' . $c['contractNo'] . ' (' . $c['unitCode'] . ') 신청을 반려했어요. 자리는 다시 비었어요.');
    }

    private static function doContractsBulk(array $a, array $p): array
    {
        $op = self::s($p, 'op');
        if (!in_array($op, ['approve', 'renew', 'notice'], true)) throw new ApiException(400, 'INVALID_INPUT', '할 일을 골라 주세요.');
        $ids = self::ids($p);
        $title = trim(self::s($p, 'title'));
        $body = trim(self::s($p, 'body'));
        if ($op === 'notice' && $title === '') throw new ApiException(400, 'INVALID_INPUT', '알림 제목을 적어 주세요.');
        $done = 0;
        $skipped = 0;
        $sent = 0;
        foreach ($ids as $id) {
            try {
                if ($op === 'approve') Allot::decide($a, $id, 'active', '');
                elseif ($op === 'renew') Allot::renew($a, $id, 1);
                else { $r = Allot::notify($a, ['contract' => $id], $title, $body); if ((int) $r['count'] < 1) { $skipped++; continue; } $sent += (int) $r['count']; }
                $done++;
            } catch (ApiException $e) {
                if (!in_array($e->errorCode, ['NOT_PENDING', 'NOT_LIVE', 'NOT_RENEWABLE', 'NOT_FOUND', 'CONFLICT'], true)) throw $e;
                $skipped++;
            }
        }
        $what = $op === 'approve' ? '건을 승인했어요' : ($op === 'renew' ? '건을 한 기간 연장했어요' : '건의 고객에게 알림을 보냈어요');
        return self::ok(($op === 'approve' ? '✅ ' : ($op === 'renew' ? '🔁 ' : '🔔 ')) . self::n($done) . $what . ($skipped > 0 ? ' — 맞지 않아 건너뛴 계약 ' . self::n($skipped) . '건.' : '.'));
    }

    private static function doPay(array $a, array $p): array
    {
        $id = self::id($p, 'con');
        $amount = self::digits(self::s($p, 'amount'));
        if ($amount === '' || !ctype_digit($amount) || strlen($amount) > 9) throw new ApiException(400, 'INVALID_INPUT', '금액을 숫자로 적어 주세요 (예: 120000).');
        $opt = [];
        $periods = trim(self::s($p, 'periods'));
        if ($periods !== '') $opt['periods'] = $periods;
        if (trim(self::s($p, 'memo')) !== '') $opt['memo'] = self::s($p, 'memo');
        $paid = self::dateIn(self::s($p, 'paid'));
        if ($paid < 0) throw new ApiException(400, 'INVALID_INPUT', '입금일을 다시 확인해 주세요 (예: 2026-03-15).');
        if ($paid > 0) $opt['paidAt'] = min($paid, Clock::ms());
        $r = Allot::recordPayment($a, $id, (int) $amount, self::s($p, 'method'), self::s($p, 'idem'), $opt);
        $c = $r['contract'];
        if ($r['duplicate']) return self::ok('ℹ️ 이미 기록한 입금이에요 (같은 화면에서 두 번 눌렀어요). 새로 기록하지 않았어요.');
        $tail = $c['status'] === 'pending' ? ' 아직 승인 대기예요 — 확인했으면 승인해 주세요.' : ((int) $c['paidUntil'] > 0 && (int) $c['paidUntil'] < Allot::FOREVER ? ' 납부 기한은 ' . self::day($c['paidUntil']) . ' 이에요.' : '');
        return self::ok('💰 ' . $c['contractNo'] . ' 에 ' . self::won((int) $amount) . ' 입금을 기록했어요 (' . ((int) $r['payment']['periods'] > 0 ? (int) $r['payment']['periods'] . '회차 치' : '회차에는 들어가지 않는 입금') . ').' . $tail);
    }

    private static function sure(array $p, string $what): void
    {
        if (self::s($p, 'sure') !== '1') throw new ApiException(400, 'INVALID_INPUT', $what . ' "네" 칸에 표시한 뒤 다시 눌러 주세요.');
    }

    private static function doRefund(array $a, array $p): array
    {
        self::sure($p, '환불로 기록하려면');
        $r = Allot::refund($a, self::id($p, 'pay'), self::s($p, 'reason'));
        return self::ok('↩️ 입금 #' . $r['id'] . ' (' . self::won((int) $r['amount']) . ')을 환불로 기록했어요.' . ($r['method'] === 'toss' ? ' 토스 결제도 취소됐어요.' : ' 계좌 이체 · 현금은 직접 돌려줘야 해요.'));
    }

    private static function doRenew(array $a, array $p): array
    {
        $terms = self::digits(self::s($p, 'terms'));
        if ($terms === '' || !ctype_digit($terms) || strlen($terms) > 2) throw new ApiException(400, 'INVALID_INPUT', '연장 횟수를 1~20 사이의 숫자로 적어 주세요.');
        $c = Allot::renew($a, self::id($p, 'con'), (int) $terms);
        return self::ok('🔁 ' . $c['contractNo'] . ' 계약을 ' . self::day($c['endsAt']) . ' 까지 늘렸어요. 고객에게 알림이 갔어요.');
    }

    private static function doAutoRenew(array $a, array $p): array
    {
        $on = self::s($p, 'on') === '1';
        $c = Allot::setAutoRenew($a, self::id($p, 'con'), $on);
        return self::ok($on ? '♻️ ' . $c['contractNo'] . ' 계약은 기간이 끝나면 저절로 한 기간씩 늘어나요.' : '⏹️ ' . $c['contractNo'] . ' 계약의 자동 연장을 껐어요.');
    }

    private static function doMove(array $a, array $p): array
    {
        $c = Allot::transfer($a, self::id($p, 'con'), strtoupper(trim(self::s($p, 'to'))));
        return self::ok('🚚 ' . $c['contractNo'] . ' 계약을 ' . $c['unitCode'] . ' 자리로 옮겼어요. 원래 자리는 비었어요.');
    }

    private static function doEnd(array $a, array $p): array
    {
        self::sure($p, '계약을 끝내려면');
        $c = Allot::endContract($a, self::id($p, 'con'), self::s($p, 'why'));
        return self::ok('🏁 ' . $c['contractNo'] . ' (' . $c['unitCode'] . ') ' . ($c['status'] === 'canceled' ? '신청을 취소했어요.' : '계약을 끝냈어요.') . ' 자리는 다시 비었고, 기다리는 사람이 있으면 차례대로 제안돼요.'
            . ((int) $c['paidTotal'] > 0 ? ' 받은 돈 ' . self::won((int) $c['paidTotal']) . '은 저절로 돌려주지 않아요 — 환불할 것이 있으면 입금 기록에서 해 주세요.' : ''));
    }

    private static function doMemo(array $a, array $p): array
    {
        $c = Allot::setMemo($a, self::id($p, 'con'), self::s($p, 'memo'));
        Audit::log('allot_memo_set', (int) $c['userId'] > 0 ? (int) $c['userId'] : null, ['contract' => $c['contractNo'], 'chars' => mb_strlen($c['memo'])], 'info', self::actor($a));
        return self::ok('📝 ' . $c['contractNo'] . ' 계약의 메모를 ' . ($c['memo'] === '' ? '지웠어요.' : '저장했어요.'));
    }

    private static function doContractNew(array $a, array $p): array
    {
        $cust = self::id($p, 'cust');
        $opt = ['status' => self::s($p, 'status') === 'pending' ? 'pending' : 'active'];
        $starts = self::dateIn(self::s($p, 'starts'));
        if ($starts < 0) throw new ApiException(400, 'INVALID_INPUT', '시작일을 다시 확인해 주세요 (예: 2026-03-15).');
        if ($starts > 0) $opt['startsAt'] = min($starts, Clock::ms());
        if (trim(self::s($p, 'memo')) !== '') $opt['memo'] = self::s($p, 'memo');
        $c = Allot::createContract($a, strtoupper(trim(self::s($p, 'unit'))), $cust, $opt);
        return self::ok('📄 ' . $c['unitCode'] . ' 자리에 계약 ' . $c['contractNo'] . ' 을 만들었어요 (' . ($c['status'] === 'active' ? '확정' : '승인 대기') . '). 받은 돈이 있으면 "입금 기록"에 적어 주세요.', ['sec' => 'contracts', 'con' => (int) $c['id'], 'cust' => null]);
    }

    // ------------------------------------------------------------------ customers
    private static function doCustomerSave(array $a, array $p): array
    {
        $id = self::id($p, 'cust');
        $in = [];
        if ($id > 0) $in['id'] = $id;
        $name = trim(self::s($p, 'name'));
        $phone = trim(self::s($p, 'phone'));
        if ($id === 0 || $name !== '') $in['name'] = $name;
        if ($id === 0 || $phone !== '') $in['phone'] = $phone;
        foreach (['addr', 'memo'] as $k) {
            $v = trim(self::s($p, $k));
            if ($v !== '') $in[$k] = $v;
            elseif ($id > 0 && self::s($p, 'clear_' . $k) === '1') $in[$k] = '';
        }
        if (self::s($p, 'guardian_set') === '1') $in['guardian'] = self::s($p, 'guardian') === '1';
        if (self::s($p, 'consent') === '1') $in['consent'] = true;
        try {
            $cu = Allot::saveCustomer($a, $in);
        } catch (ApiException $e) {
            if ($e->errorCode !== 'CUSTOMER_EXISTS' || !is_array($e->data) || !isset($e->data['id'])) throw $e;
            $dup = (int) $e->data['id'];
            return self::ok('ℹ️ 같은 이름과 전화번호의 고객(#' . $dup . ')이 이미 있어서 그 고객을 열었어요. 새로 만들지 않았어요.', ['sec' => 'customers', 'cust' => $dup]);
        }
        return self::ok('👤 #' . (int) $cu['id'] . ' 고객을 ' . ($id > 0 ? '저장했어요.' : '등록했어요. 아래에서 자리를 골라 계약을 만들 수 있어요.'), ['sec' => 'customers', 'cust' => (int) $cu['id']]);
    }

    private static function doCustomerLink(array $a, array $p): array
    {
        $id = self::id($p, 'cust');
        $who = trim(mb_substr(self::s($p, 'who'), 0, 120));
        if ($who === '') throw new ApiException(400, 'INVALID_INPUT', '이을 체험관 계정(닉네임 · 이메일 · 계정 번호)을 적어 주세요.');
        $u = ctype_digit(ltrim($who, '#')) && strlen($who) <= 16 ? Users::byId((int) ltrim($who, '#')) : Users::byLogin($who);
        if (!$u) throw new ApiException(404, 'NOT_FOUND', '그런 체험관 계정을 찾을 수 없어요.');
        Allot::linkCustomer($a, $id, (int) $u['id']);
        return self::ok('🔗 #' . $id . ' 고객을 체험관 계정 #' . (int) $u['id'] . ' 과 이었어요. 이제 계약과 알림이 그 계정의 "내 분양"에 보여요.');
    }

    // ------------------------------------------------------------------ waiting list, notices, care logs
    private static function doWaitCancel(array $a, array $p): array
    {
        list($id, $what) = self::pick($p);
        if ($what !== 'cancel') throw new ApiException(400, 'INVALID_INPUT', '목록에서 버튼을 다시 눌러 주세요.');
        Allot::waitCancel($a, $id);
        return self::ok('✖ 대기 신청 #' . $id . ' 을 취소했어요. 제안했던 자리가 있으면 다음 사람에게 넘어가요.');
    }

    private static function doWaitOffer(array $a, array $p): array
    {
        $code = strtoupper(trim(self::s($p, 'unit')));
        if (!preg_match('/^[A-Z0-9]{1,12}-\d{1,6}$/', $code)) throw new ApiException(400, 'INVALID_INPUT', '자리 번호를 다시 확인해 주세요 (예: J01-0012).');
        $r = Allot::offerNext($code);
        Audit::log('allot_wait_offer_run', null, ['unit' => $code, 'offered' => $r !== null], 'info', self::actor($a));
        if ($r === null) return self::ok('ℹ️ 제안하지 않았어요 — ' . $code . ' 자리가 비어 있지 않거나, 그 구역이 신청을 받지 않거나, 기다리는 사람이 없어요.');
        return self::ok('🪑 ' . $r['unit'] . ' 자리를 대기 #' . (int) $r['id'] . ' 에게 제안했어요. ' . self::at($r['offerUntil']) . ' 까지 답을 기다려요.', ['st' => 'offered']);
    }

    private static function doNotify(array $a, array $p): array
    {
        $to = self::s($p, 'to');
        $ref = trim(self::s($p, 'ref'));
        $back = ['sec' => 'notices'];
        if ($to === 'all') $target = ['all' => true];
        elseif (preg_match('/^kind_(jar|plot|store)$/', $to, $m)) $target = ['kind' => $m[1]];
        elseif (preg_match('/^zone_([a-z0-9]{1,12})$/', $to, $m)) $target = ['zone' => strtoupper($m[1])];
        elseif ($to === 'contract') {
            $id = self::id($p, 'con');
            if ($id < 1) {
                if (!preg_match('/^A\d\d-[2-9A-Z]{5}-[2-9A-Z]{5}$/i', $ref)) throw new ApiException(400, 'INVALID_INPUT', '계약번호를 적어 주세요 (예: A26-ABCDE-FGHJK).');
                $found = Allot::listContracts(['q' => $ref], 1);
                if (!$found['rows']) throw new ApiException(404, 'NOT_FOUND', '그런 계약번호는 없어요.');
                $id = (int) $found['rows'][0]['id'];
            }
            $target = ['contract' => $id];
        } elseif ($to === 'customer') {
            $id = self::id($p, 'cust');
            if ($id < 1 && preg_match('/^#?(\d{1,15})$/', $ref, $m)) $id = (int) $m[1];
            if ($id < 1) throw new ApiException(400, 'INVALID_INPUT', '고객번호를 적어 주세요 (예: #12).');
            $target = ['customer' => $id];
        } else {
            throw new ApiException(400, 'INVALID_INPUT', '받는 사람을 골라 주세요.');
        }
        $sendAt = null;
        $send = trim(self::s($p, 'send'));
        if ($send !== '') {
            $day = Allot::parseDate($send);
            if ($day < 1) throw new ApiException(400, 'INVALID_INPUT', '보내는 날을 다시 확인해 주세요.');
            if ($day + 9 * 3600000 > Clock::ms()) $sendAt = $day + 9 * 3600000; // 09:00 of that day; today or earlier = now
        }
        $r = Allot::notify($a, $target, self::s($p, 'title'), self::s($p, 'body'), $sendAt);
        if ((int) $r['count'] < 1) return self::ok('ℹ️ 받을 사람이 없어서 보내지 않았어요 (진행 중인 계약이 있는 고객에게만 보내요).', $back);
        return self::ok('🔔 ' . self::n($r['count']) . '명에게 알림을 ' . ($sendAt !== null ? self::at($sendAt) . ' 에 보내도록 예약했어요.' : '보냈어요.') . ' 체험관 계정이 없는 고객은 아래 목록에 "직접 연락"으로 남아요.', $back);
    }

    private static function doNoticeDone(array $a, array $p): array
    {
        list($id, $what) = self::pick($p);
        if ($what !== 'sent' && $what !== 'cancel') throw new ApiException(400, 'INVALID_INPUT', '목록에서 버튼을 다시 눌러 주세요.');
        Allot::noticeDone($a, $id, $what === 'sent' ? 'sent' : 'canceled');
        return self::ok($what === 'sent' ? '📞 알림 #' . $id . ' 을 "알렸어요"로 표시했어요.' : '✖ 알림 #' . $id . ' 을 취소했어요.');
    }

    private static function doCareAdd(array $a, array $p): array
    {
        $to = self::s($p, 'to');
        $back = ['sec' => 'care'];
        if ($to === 'all') $target = ['all' => true];
        elseif (preg_match('/^zone_([a-z0-9]{1,12})$/', $to, $m)) { $target = ['zone' => strtoupper($m[1])]; $back['zone'] = $m[1]; $back['u'] = null; }
        elseif ($to === 'unit') {
            $code = strtoupper(trim(self::s($p, 'ref')));
            if (!preg_match('/^[A-Z0-9]{1,12}-\d{1,6}$/', $code)) throw new ApiException(400, 'INVALID_INPUT', '자리 번호를 다시 확인해 주세요 (예: J01-0012).');
            $target = ['unit' => $code];
            $back['u'] = self::unitWord($code);
            $back['zone'] = null;
        } else {
            throw new ApiException(400, 'INVALID_INPUT', '어디에 남길지 골라 주세요.');
        }
        $visible = self::s($p, 'visible') === '1';
        $r = Allot::addCare($a, $target, self::s($p, 'kind'), self::s($p, 'text'), $visible);
        return self::ok('📒 일지를 남겼어요 (' . ($visible ? '체험관에 보여요' : '숨김') . '). 개인정보와 나쁜 말은 저절로 가려져요.', $back + ['before' => null]);
    }

    private static function doCareVisible(array $a, array $p): array
    {
        list($id, $what) = self::pick($p);
        if ($what !== 'show' && $what !== 'hide') throw new ApiException(400, 'INVALID_INPUT', '목록에서 버튼을 다시 눌러 주세요.');
        Allot::setCareVisible($a, $id, $what === 'show');
        return self::ok($what === 'show' ? '👁️ 일지 #' . $id . ' 을 체험관에 보이게 했어요.' : '🙈 일지 #' . $id . ' 을 숨겼어요.');
    }

    // ------------------------------------------------------------------ CSV export (the answer is the file) and import
    /**
     * Write one export as CSV text through $write: the BOM, the header line and every row (Allot::csvLine: CRLF, quoted
     * cells, the formula guard). Masked unless $reveal — then Allot::exportRows writes an audit row per chunk (what, how
     * many rows, the reason code; never the data). @return int rows written
     */
    public static function exportCsv(string $what, bool $reveal, ?array $a, string $why, callable $write): int
    {
        $chunk = Allot::exportRows($what, 0, 500, $reveal, $reveal ? $a : null, $why); // before the first byte: a refusal is still a normal page
        $write(Allot::csvBom() . Allot::csvLine(Allot::exportHeader($what, $reveal)));
        $n = 0;
        for (;;) {
            $out = '';
            foreach ($chunk['rows'] as $row) { $out .= Allot::csvLine($row); $n++; }
            if ($out !== '') $write($out);
            if (!$chunk['next']) break;
            $chunk = Allot::exportRows($what, (int) $chunk['next'], 500, $reveal, $reveal ? $a : null, $why);
        }
        return $n;
    }

    /** the name of an export file: never a name or a number of a person — "tfm-allot-contracts-masked-20261114-103000.csv" */
    public static function exportName(string $what, bool $reveal, ?int $now = null): string
    {
        return 'tfm-allot-' . (in_array($what, Allot::EXPORTS, true) ? $what : 'export') . ($reveal ? '-full' : '-masked') . '-' . date('Ymd-His', $now === null ? time() : intdiv($now, 1000)) . '.csv';
    }

    /** ⬇️ the POST answers with the file itself (no 303): same origin, token and elevation were checked like for every action */
    private static function doExport(array $a, array $p): array
    {
        $what = self::s($p, 'what');
        if (!in_array($what, Allot::EXPORTS, true)) throw new ApiException(400, 'INVALID_INPUT', '무엇을 내보낼지 골라 주세요.');
        $reveal = self::s($p, 'reveal') === '1';
        $why = self::s($p, 'why');
        if ($reveal) {
            if (!isset(Allot::REVEAL_REASONS[$why])) throw new ApiException(400, 'INVALID_INPUT', '가리지 않고 내보내는 까닭을 골라 주세요.');
            self::stepUp($a, $p);
        } else {
            Audit::log('allot_export', null, ['what' => $what, 'reveal' => false, 'via' => 'admin'], 'info', self::actor($a));
        }
        $started = false;
        $name = self::exportName($what, $reveal);
        $write = function (string $s) use (&$started, $name): void {
            if (!$started) {
                // the first bytes exist: nothing can be refused any more — headers, then the stream
                while (ob_get_level() > 0) ob_end_clean();
                AdminGate::headers();
                header('Content-Type: text/csv; charset=utf-8');
                header("Content-Security-Policy: default-src 'none'; sandbox");
                header('Content-Disposition: attachment; filename="' . $name . '"');
                http_response_code(200);
                Session::close();
                $started = true;
            }
            echo $s;
            flush();
        };
        if (function_exists('set_time_limit')) @set_time_limit(300);
        self::exportCsv($what, $reveal, $a, $why, $write);
        exit;
    }

    private static function doImportPreview(array $a, array $p): array
    {
        $what = self::s($p, 'what') === 'payments' ? 'payments' : 'ledger';
        $csv = self::s($p, 'csv');
        if (trim($csv) === '') throw new ApiException(400, 'INVALID_INPUT', '붙여 넣은 내용이 없어요. 엑셀에서 제목 줄부터 복사해 붙여 넣어 주세요.');
        if (strlen($csv) > self::PASTE_MAX) throw new ApiException(413, 'PAYLOAD_TOO_LARGE', '한 번에 붙여 넣기에는 너무 커요 (2 MB까지). 나눠서 넣거나 서버 컴퓨터에서 php cli/tfm.php allot:import 를 써 주세요.');
        $r = Allot::importCsv($a, $what, $csv, true);
        self::importPut($what, $csv, $r);
        Audit::log('allot_import_preview', null, ['what' => $what, 'rows' => (int) $r['total'], 'invalid' => (int) $r['invalid']], 'info', self::actor($a));
        return self::ok('🔍 미리 보기를 만들었어요 — ' . self::n($r['total']) . '줄 가운데 문제 있는 줄 ' . self::n($r['invalid']) . '개. 아직 아무것도 바꾸지 않았어요.', ['sec' => 'csv']);
    }

    private static function doImportCommit(array $a, array $p): array
    {
        $d = self::importGet();
        if ($d === null) throw new ApiException(409, 'NO_PREVIEW', '확인할 미리 보기가 없어요 (30분이 지났을 수 있어요). 다시 붙여 넣어 주세요.');
        if (!hash_equals((string) $d['ticket'], self::s($p, 'ticket'))) throw new ApiException(409, 'NO_PREVIEW', '화면의 미리 보기가 바뀌었어요. 지금 보이는 미리 보기를 다시 확인해 주세요.');
        $r = Allot::importCsv($a, (string) $d['what'], (string) $d['csv'], false);
        if ($r['dryRun']) {
            // something changed since the dry run (a unit was taken, a customer was added): nothing was imported
            self::importPut((string) $d['what'], (string) $d['csv'], $r);
            throw new ApiException(409, 'IMPORT_INVALID', '그사이에 상황이 바뀌어 문제 있는 줄이 ' . self::n($r['invalid']) . '개 생겼어요. 아무것도 가져오지 않았어요 — 미리 보기를 다시 확인해 주세요.');
        }
        Session::set('allot_import', null);
        $c = $r['created'];
        return self::ok('📥 가져왔어요 — 새 고객 ' . self::n($c['customers']) . '명 · 새 계약 ' . self::n($c['contracts']) . '건 · 입금 ' . self::n($c['payments']) . '건'
            . ((int) $r['skipped'] > 0 ? ' (이미 들어 있어 건너뛴 줄 ' . self::n($r['skipped']) . '개)' : '') . '.', ['sec' => $d['what'] === 'ledger' ? 'contracts' : 'csv']);
    }

    private static function doImportCancel(array $a, array $p): array
    {
        Session::set('allot_import', null);
        Audit::log('allot_import_dropped', null, [], 'info', self::actor($a));
        return self::ok('↩️ 미리 보기를 지웠어요. 아무것도 바꾸지 않았어요.', ['sec' => 'csv']);
    }

    // ------------------------------------------------------------------ rules, texts, demo data
    private static function doSettings(array $a, array $p): array
    {
        $in = [];
        foreach (self::RULES_META as $k => $m) {
            $v = trim(self::s($p, $k));
            if ($m[2] === 'bool') $in[$k] = $v === '1';
            elseif ($m[2] === 'int') $in[$k] = self::digits($v);
            else $in[$k] = $v;
        }
        $r = Allot::saveSettings($a, $in);
        self::$sum = null;
        if (!$r['changed']) return self::ok('ℹ️ 바뀐 규칙이 없어요.', ['sec' => 'auto']);
        $names = [];
        foreach ($r['changed'] as $k) $names[] = isset(self::RULES_META[$k]) ? self::RULES_META[$k][0] : $k;
        return self::ok('💾 규칙 ' . count($names) . '개를 바꿨어요: ' . implode(' · ', $names) . '.', ['sec' => 'auto']);
    }

    private static function doTexts(array $a, array $p): array
    {
        $in = [];
        foreach (self::TEXTS_META as $k => $m) if (isset($p[$k]) && is_string($p[$k])) $in[$k] = $p[$k];
        if (!$in) throw new ApiException(400, 'INVALID_INPUT', '저장할 문구가 없어요.');
        $r = Allot::saveSettings($a, $in);
        if (!$r['changed']) return self::ok('ℹ️ 바뀐 문구가 없어요.', ['sec' => 'auto']);
        $names = [];
        foreach ($r['changed'] as $k) $names[] = isset(self::TEXTS_META[$k]) ? self::TEXTS_META[$k][1] : $k;
        return self::ok('💾 안내 문구를 바꿨어요: ' . implode(' · ', $names) . '. 지금 동의 판은 ' . Allot::consentVersion() . ' 이에요 — 공개하기 전에 법률 검토를 받아 주세요.', ['sec' => 'auto']);
    }

    private static function doDemo(array $a, array $p): array
    {
        $op = self::s($p, 'op');
        if ($op === 'clear') {
            $r = Allot::demoClear($a);
            self::$sum = null;
            return self::ok('🧹 예시 자료를 지웠어요 — 고객 ' . self::n($r['customers']) . '명 · 계약 ' . self::n($r['contracts']) . '건 · 입금 ' . self::n($r['payments']) . '건.', ['sec' => 'auto']);
        }
        if ($op !== 'seed') throw new ApiException(400, 'INVALID_INPUT', '버튼을 다시 눌러 주세요.');
        $r = Allot::demoSeed($a, 40);
        Allot::tick(null, 'admin'); // the unpaid examples become overdue and today's statistics appear
        self::$sum = null;
        return self::ok('🧪 예시 자료를 넣었어요 — 가짜 고객 ' . self::n($r['customers']) . '명 · 계약 ' . self::n($r['contracts']) . '건 (승인 대기 ' . self::n($r['pending']) . ' · 미납 ' . self::n($r['unpaid']) . ' · 곧 끝남 ' . self::n($r['ending'])
            . ' · 끝남 ' . self::n($r['ended']) . '). 진짜 운영 전에 ⚙️ 자동화에서 꼭 지워 주세요.', ['sec' => 'status']);
    }

    // @@ACTION-METHODS@@
}
