<?php
/**
 * Tfm\AdminSupport — the admin site's 📮 신고·문의 tab (CONTRACT §18.1). No JavaScript.
 *
 *   view(Ctx $c, array $get, string $token): string     the tab: counts, filters, the list (50 a page, newest first,
 *                                                        keyset ?before=<id>), ?t=<id> = one ticket on top (its picture,
 *                                                        device facts, the thread, answer · status · delete), clean-up,
 *                                                        settings, the masked CSV export
 *   back(array $post): array                             where a form came from → the 303 goes back there
 *   action(string $action, Ctx $c, array $post): array   one `support_*` action → ['msg' => flash text, 'back' => query]
 *   serve(array $admin, string $spec): void              GET ./?supshot=<id> — the picture, streamed (no-store)
 *   navBadge(): string                                   the number of new tickets beside the tab name
 *
 * It lives in lib/ (never web-readable) and is loaded by the admin entry on demand. The entry has already checked the
 * lock for every POST that reaches action(): same origin, the CSRF token, the admin role and the elevation. The
 * `case 'support_…':` labels stay in the entry (tests/admin-lock.mjs reads the list of actions from that file).
 * Rules of this file: every value that reaches the page goes through e(); no script, no inline style, no event handler
 * (the CSP of the admin site is `default-src 'none'; style-src 'self'; img-src 'self'`): the picture comes through this
 * entry (./?supshot=…). A delete needs the box "정말 지울게요" ticked (no JavaScript confirm). PHP 7.2 syntax only.
 */
declare(strict_types=1);

namespace Tfm;

if (!defined('TFM_BOOT')) { if (function_exists('header_remove')) header_remove('X-Powered-By'); http_response_code(404); exit; }

final class AdminSupport
{
    /** rows per page of the list */
    public const PAGE = 50;
    private const META_KO = [
        'build' => '빌드', 'browser' => '브라우저', 'screen' => '화면', 'view' => '창 크기', 'dpr' => '화면 배율', 'quality' => '그래픽 품질', 'mode' => '모드',
        'net' => '연결', 'place' => '장소', 'zone' => '구역', 'x' => 'x', 'y' => 'y', 'z' => 'z', 'fps' => '초당 화면 수', 'look' => '마우스 보기',
        'lang' => '언어', 'touch' => '터치 기기', 'gl' => '그래픽 장치', 'errors' => '오류 수', 'lastError' => '마지막 오류', 'uptime' => '켜 둔 시간(초)',
        'memMB' => '메모리(MB)', 'blur' => '채팅 가림', 'ui' => '열려 있던 창·패널',
    ];

    /** @var string the CSRF token of the page being drawn */
    private static $token = '';

    private static function e($v): string { return htmlspecialchars((string) $v, ENT_QUOTES | ENT_SUBSTITUTE | ENT_HTML401, 'UTF-8'); }
    private static function s(array $a, string $k): string { return isset($a[$k]) && is_string($a[$k]) ? $a[$k] : ''; }
    private static function id(array $a, string $k): int
    {
        $v = self::s($a, $k);
        return $v !== '' && strlen($v) <= 12 && ctype_digit($v) ? (int) $v : 0;
    }
    private static function when(int $ms): string { return $ms > 0 ? date('Y-m-d H:i', intdiv($ms, 1000)) : '-'; }
    private static function href(array $q = []): string
    {
        return './?' . http_build_query(['tab' => 'support'] + array_filter($q, function ($v) { return $v !== '' && $v !== null && $v !== 0; }));
    }
    private static function open(string $action, array $fields = [], string $cls = 'stack', string $id = ''): string
    {
        $h = '<form method="post" action="./" class="' . self::e($cls) . '"' . ($id !== '' ? ' id="' . self::e($id) . '"' : '') . '>'
            . '<input type="hidden" name="_csrf" value="' . self::e(self::$token) . '"><input type="hidden" name="action" value="' . self::e($action) . '"><input type="hidden" name="tab" value="support">';
        foreach ($fields as $k => $v) if ($v !== '' && $v !== null && $v !== 0) $h .= '<input type="hidden" name="' . self::e($k) . '" value="' . self::e($v) . '">';
        return $h;
    }
    private static function select(string $name, array $options, string $current): string
    {
        $h = '<select name="' . self::e($name) . '">';
        foreach ($options as $v => $text) $h .= '<option value="' . self::e($v) . '"' . ((string) $v === $current ? ' selected' : '') . '>' . self::e($text) . '</option>';
        return $h . '</select>';
    }
    private static function badge(string $text, string $cls = ''): string { return '<span class="badge' . ($cls !== '' ? ' ' . self::e($cls) : '') . '">' . self::e($text) . '</span>'; }
    private static function check(string $name, string $label, bool $on): string
    {
        return '<label class="check"><input type="checkbox" name="' . self::e($name) . '" value="1"' . ($on ? ' checked' : '') . '> ' . self::e($label) . '</label>';
    }
    private static function kindBadge(string $k): string
    {
        $m = isset(Support::KIND_KO[$k]) ? Support::KIND_KO[$k] : ['', $k];
        return self::badge(trim($m[0] . ' ' . $m[1]), $k === 'report' ? 'warn' : '');
    }
    private static function statusBadge(string $s): string
    {
        $m = isset(Support::STATUS_KO[$s]) ? Support::STATUS_KO[$s] : ['', $s];
        return self::badge(trim($m[0] . ' ' . $m[1]), $s === 'new' ? 'warn' : ($s === 'answered' ? 'ok' : ''));
    }
    private static function catText(string $c): string { return isset(Support::CAT_KO[$c]) ? Support::CAT_KO[$c] : $c; }
    /** a body for the list: one line, at most 80 characters */
    private static function short(string $b): string
    {
        $b = trim((string) preg_replace('/\s+/u', ' ', $b));
        if ($b === '') return '(글 없이 분류만 골랐어요)';
        return mb_strlen($b) > 80 ? mb_substr($b, 0, 80) . '…' : $b;
    }
    /** text with its line breaks kept (escaped first, then <br>) */
    private static function lines(string $b): string { return nl2br(self::e($b), false); }

    /** the number of new tickets for the tab name ('' when none) */
    public static function navBadge(): string
    {
        try { $n = (int) Support::counts()['new']; } catch (\Throwable $e) { return ''; }
        return $n > 0 ? ' <span class="badge warn">' . self::e($n > 999 ? '999+' : (string) $n) . '</span>' : '';
    }

    // ------------------------------------------------------------------ the tab
    public static function view(Ctx $c, array $get, string $token): string
    {
        self::$token = $token;
        // the automatic clean-up runs with the tab (bounded: 200 a visit)
        try { Support::cleanup(null, 200); } catch (\Throwable $e) { Log::warn('SUPPORT', 'clean-up failed', ['e' => get_class($e)]); }
        $f = Support::filter(['status' => self::s($get, 'status'), 'kind' => self::s($get, 'kind'), 'q' => self::s($get, 'q')]);
        $before = self::id($get, 'before');
        $open = self::id($get, 't');
        $h = self::intro($f);
        if ($open > 0) $h .= self::ticketCard($open, $f, $before);
        $h .= self::listCard($f, $before, $open);
        $h .= '<div class="grid2">' . self::settingsCard() . self::toolsCard($f) . '</div>';
        return $h;
    }

    private static function intro(array $f): string
    {
        $c = Support::counts();
        $tile = function (string $ico, string $n, string $label, string $status) use ($f) {
            $on = $f['status'] === $status ? ' on' : '';
            return '<a class="tile' . $on . '" href="' . self::e(self::href(['status' => $status, 'kind' => $f['kind']])) . '"><span class="ico" aria-hidden="true">' . $ico . '</span><b>' . self::e($n) . '</b><small>' . self::e($label) . '</small></a>';
        };
        $on = Support::enabled();
        return '<section class="card"><h3>📮 신고·문의</h3><p class="dim small">체험객이 체험관 안에서 보낸 🐞 버그 신고 · ❓ 문의 · 🚨 신고예요. 화면 사진과 기기 정보가 함께 와요. 답을 쓰면 체험객의 📮 내 문의와 🔔 알림함에 보여요. '
            . ($on ? '' : '<b>지금은 받지 않는 중이에요 (아래 설정에서 켜요).</b>') . '</p>'
            . '<div class="tiles">' . $tile('🆕', number_format($c['new']), '새 글', 'new') . $tile('💬', number_format($c['open']), '확인 중', 'open')
            . $tile('✅', number_format($c['answered']), '답변함', 'answered') . $tile('📁', number_format($c['closed']), '닫음', 'closed') . $tile('📋', number_format($c['all']), '전체', '') . '</div></section>';
    }

    private static function filterForm(array $f): string
    {
        $status = ['' => '모든 상태', 'active' => '처리할 것 (새 글 + 확인 중)'];
        foreach (Support::STATUS_KO as $k => $v) $status[$k] = $v[0] . ' ' . $v[1];
        $kinds = ['' => '모든 종류'];
        foreach (Support::KIND_KO as $k => $v) $kinds[$k] = $v[0] . ' ' . $v[1];
        return '<form method="get" action="./" class="search"><input type="hidden" name="tab" value="support">'
            . '<label>상태' . self::select('status', $status, $f['status']) . '</label><label>종류' . self::select('kind', $kinds, $f['kind']) . '</label>'
            . '<label>찾기<input type="search" name="q" maxlength="40" value="' . self::e($f['q']) . '" placeholder="문의 번호 · 계정 번호 · 닉네임"></label>'
            . '<button type="submit" class="btn">🔍 보기</button></form>';
    }

    private static function listCard(array $f, int $before, int $open): string
    {
        $page = Support::page($f, $before, self::PAGE);
        $h = '<section class="card"><h3>📋 목록 <span class="dim small">(새 글이 위)</span></h3>' . self::filterForm($f);
        if (!$page['rows']) return $h . '<p class="empty">' . ($before > 0 ? '🍃 더 없어요.' : '🎉 보낸 문의가 없어요.') . '</p>' . ($before > 0 ? '<p class="row"><a class="btn ghost" href="' . self::e(self::href(['status' => $f['status'], 'kind' => $f['kind'], 'q' => $f['q']])) . '">‹ 처음으로</a></p>' : '') . '</section>';
        // the delete-selected form: every row's box belongs to it (form="supsel")
        $h .= self::open('support_delete_many', ['list_status' => $f['status'], 'kind' => $f['kind'], 'before' => $before], 'inline', 'supsel') . '</form>';
        $h .= '<div class="tablewrap"><table><thead><tr><th><span class="dim">고르기</span></th><th>번호</th><th>종류</th><th>분류</th><th>상태</th><th>글</th><th>보낸 사람</th><th>📷</th><th>보낸 때</th><th>답한 때</th></tr></thead><tbody>';
        foreach ($page['rows'] as $r) {
            $id = (int) $r['id'];
            $link = self::href(['t' => $id, 'status' => $f['status'], 'kind' => $f['kind'], 'q' => $f['q'], 'before' => $before]);
            $h .= '<tr' . ($id === $open ? ' class="on"' : '') . '><td><input type="checkbox" name="pick[]" value="' . $id . '" form="supsel" aria-label="' . self::e($r['no']) . ' 고르기"></td>'
                . '<td><a href="' . self::e($link) . '"><b>' . self::e($r['no']) . '</b></a></td><td>' . self::kindBadge((string) $r['kind']) . '</td><td>' . self::e(self::catText((string) $r['category'])) . '</td>'
                . '<td>' . self::statusBadge((string) $r['status']) . '</td><td class="msg"><a href="' . self::e($link) . '">' . self::e(self::short((string) $r['body'])) . '</a>'
                . ($r['target_nick'] !== '' ? ' <span class="dim">→ ' . self::e($r['target_nick']) . '</span>' : '') . '</td>'
                . '<td>' . self::e($r['nick']) . ' <span class="dim">#' . (int) $r['user_id'] . '</span></td><td>' . ((string) $r['shot_path'] !== '' ? '📷' : '') . '</td>'
                . '<td class="nowrap">' . self::e(self::when((int) $r['created_at'])) . '</td><td class="nowrap">' . self::e(self::when((int) $r['answered_at'])) . '</td></tr>';
        }
        $h .= '</tbody></table></div>';
        $h .= '<div class="row">';
        if ($before > 0) $h .= '<a class="btn ghost" href="' . self::e(self::href(['status' => $f['status'], 'kind' => $f['kind'], 'q' => $f['q']])) . '">‹ 처음으로</a>';
        if ($page['more']) $h .= '<a class="btn ghost" href="' . self::e(self::href(['status' => $f['status'], 'kind' => $f['kind'], 'q' => $f['q'], 'before' => $page['next']])) . '">다음 ' . self::PAGE . '개 ›</a>';
        $h .= '</div>';
        $h .= '<div class="row bulk"><label class="check"><input type="checkbox" name="sure" value="1" form="supsel"> 정말 지울게요 (글·답·사진이 모두 지워지고 되돌릴 수 없어요)</label>'
            . '<button type="submit" class="btn danger" form="supsel">🗑️ 고른 것 지우기</button></div>';
        return $h . '</section>';
    }

    private static function ticketCard(int $id, array $f, int $before): string
    {
        $t = Support::get($id);
        if ($t === null) return '<section class="card"><p class="notice">그 문의는 없어요. 이미 지워졌을 수 있어요.</p></section>';
        $back = ['status' => $f['status'], 'kind' => $f['kind'], 'q' => $f['q'], 'before' => $before];
        $keep = ['list_status' => $f['status'], 'kind' => $f['kind'], 'before' => $before];
        $h = '<section class="card" id="ticket"><h3>' . self::kindBadge((string) $t['kind']) . ' ' . self::e($t['no']) . ' · ' . self::e(self::catText((string) $t['category'])) . ' ' . self::statusBadge((string) $t['status']) . '</h3>';
        $h .= '<p class="dim">보낸 사람 <b>' . self::e($t['nick']) . '</b> <span class="dim">#' . (int) $t['user_id'] . '</span> · 답을 기다리는 문의 ' . (int) $t['open_of_user'] . '개 · 보낸 때 ' . self::e(self::when((int) $t['created_at']))
            . ' · 바뀐 때 ' . self::e(self::when((int) $t['updated_at'])) . ((int) $t['answered_at'] > 0 ? ' · 답한 때 ' . self::e(self::when((int) $t['answered_at'])) . ((int) $t['user_seen_at'] >= (int) $t['answered_at'] ? ' (읽음)' : ' (아직 안 읽음)') : '') . '</p>';
        if ((string) $t['kind'] === 'report') {
            $who = $t['target_nick'] !== '' ? '<b>' . self::e($t['target_nick']) . '</b> <span class="dim">#' . (int) $t['target_user'] . '</span> — <a href="./?tab=users&amp;q=' . rawurlencode((string) $t['target_nick']) . '">👥 사용자 탭에서 보기</a>'
                : (strpos((string) $t['target_ref'], 'name:') === 0 ? self::e(substr((string) $t['target_ref'], 5)) . ' <span class="dim">(그런 계정은 없어요)</span>' : '<span class="dim">정하지 않았어요</span>');
            $h .= '<p>🚨 신고 대상: ' . $who . '</p>';
            if (is_array($t['chat'])) {
                $m = $t['chat']['message'];
                $h .= '<p>💬 신고한 채팅: ' . ($m ? '<span class="msg">“' . self::e($m['text']) . '”</span> <span class="dim">— ' . self::e($m['nickname']) . ', ' . self::e(self::when((int) $m['created_at'])) . ((int) $m['hidden'] ? ', 숨김' : '') . '</span>' : '<span class="dim">(지워진 채팅)</span>')
                    . ($t['chat']['report'] ? ' · <a href="./?tab=moderation">🚨 신고·채팅 탭의 신고 #' . (int) $t['chat']['report']['id'] . '</a>' : '') . '</p>';
            }
        }
        $h .= '<div class="grid2"><div>';
        if ((string) $t['shot_path'] !== '') {
            $src = './?supshot=' . (int) $t['id'];
            $h .= '<h4>📷 화면 사진 <span class="dim small">' . (int) $t['shot_w'] . '×' . (int) $t['shot_h'] . ' · ' . self::e(AdminLecture::size((int) $t['shot_bytes'])) . '</span></h4>'
                . '<a href="' . self::e($src) . '" target="_blank" rel="noopener"><img class="supshot" src="' . self::e($src) . '" width="' . (int) $t['shot_w'] . '" height="' . (int) $t['shot_h'] . '" alt="체험객이 보낸 화면 사진 (누르면 크게 보여요)"></a>'
                . '<p class="dim small">누르면 새 창에서 원래 크기로 보여요. 사진에 다른 사람의 이름이나 채팅이 보일 수 있으니 바깥으로 보내지 마세요.' . (!empty($t['meta']['blur']) ? ' 채팅 창 자리는 보낸 사람의 화면에서 흐리게 가렸어요.' : '') . '</p>';
        } else {
            $h .= '<p class="nophoto">📷 화면 사진 없이 보냈어요.</p>';
        }
        $h .= '</div><div><h4>🖥️ 기기 정보</h4>';
        if (!$t['meta']) $h .= '<p class="dim">기기 정보가 없어요.</p>';
        else {
            $h .= '<div class="tablewrap"><table><tbody>';
            foreach ($t['meta'] as $k => $v) $h .= '<tr><th>' . self::e(isset(self::META_KO[$k]) ? self::META_KO[$k] : $k) . '</th><td>' . self::e(is_scalar($v) ? (string) $v : '') . '</td></tr>';
            $h .= '</tbody></table></div>';
        }
        $h .= '</div></div>';
        // the thread: the first words, then the messages
        $h .= '<h4>💬 주고받은 글</h4><ol class="timeline">';
        $h .= '<li><b>' . self::e($t['nick']) . '</b> <span class="dim">' . self::e(self::when((int) $t['created_at'])) . '</span><br>' . ((string) $t['body'] !== '' ? self::lines((string) $t['body']) : '<span class="dim">(글 없이 분류 「' . self::e(self::catText((string) $t['category'])) . '」만 골랐어요)</span>') . '</li>';
        foreach ($t['thread'] as $m) {
            $h .= '<li' . ($m['side'] === 'admin' ? ' class="ok"' : '') . '><b>' . ($m['side'] === 'admin' ? '👑 운영자' : self::e($t['nick'])) . '</b> <span class="dim">' . self::e(self::when((int) $m['at'])) . '</span><br>' . self::lines((string) $m['body']) . '</li>';
        }
        $h .= '</ol>';
        $h .= '<div class="grid2">'
            . '<div>' . self::open('support_answer', ['id' => (int) $t['id']] + $keep)
            . '<label>답변 (체험객에게 그대로 보여요 · ' . Support::BODY_MAX . '자까지)<textarea name="body" rows="5" maxlength="' . Support::BODY_MAX . '" required placeholder="예: 알려 줘서 고마워요! 장독대 문이 안 열리던 문제를 고쳤어요."></textarea></label>'
            . '<label>보낸 뒤 상태' . self::select('status', ['answered' => '✅ 답변함 (체험객이 더 쓸 수 있어요)', 'closed' => '📁 닫음 (다 끝났어요)'], 'answered') . '</label>'
            . '<div class="row"><button type="submit" class="btn primary">📨 답 보내기</button></div></form></div>'
            . '<div>' . self::open('support_status', ['id' => (int) $t['id']] + $keep)
            . '<label>상태만 바꾸기' . self::select('status', array_map(function ($v) { return $v[0] . ' ' . $v[1]; }, Support::STATUS_KO), (string) $t['status']) . '</label>'
            . '<div class="row"><button type="submit" class="btn">💾 상태 저장</button></div></form>'
            . self::open('support_delete', ['id' => (int) $t['id']] + $keep)
            . self::check('sure', '정말 지울게요 (글·답·사진이 모두 지워지고 되돌릴 수 없어요)', false)
            . '<div class="row"><button type="submit" class="btn danger">🗑️ 이 문의 지우기</button></div></form></div></div>';
        $h .= '<p class="row"><a class="btn ghost" href="' . self::e(self::href($back)) . '">✖ 닫기</a></p>';
        return $h . '</section>';
    }

    private static function settingsCard(): string
    {
        $l = Support::limits();
        return '<section class="card"><h3>⚙️ 받는 방법</h3>' . self::open('support_settings')
            . self::check('enabled', '신고·문의 받기', Support::enabled()) . self::check('shots', '화면 사진 받기', Support::shotsOn())
            . '<div class="fgrid"><label>한 시간에 (계정마다)<input type="number" name="per_hour" min="1" max="100" value="' . (int) $l['hour'] . '"></label>'
            . '<label>하루에 (계정마다)<input type="number" name="per_day" min="1" max="500" value="' . (int) $l['day'] . '"></label>'
            . '<label>답을 기다리는 문의 (계정마다)<input type="number" name="max_open" min="1" max="200" value="' . (int) $l['open'] . '"></label>'
            . '<label>보관 기간 (일)<input type="number" name="keep_days" min="7" max="3650" value="' . (int) $l['keep_days'] . '"></label>'
            . '<label>화면 사진 최대 크기 (KB)<input type="number" name="shot_kb" min="100" max="1536" value="' . (int) ($l['shot_bytes'] / 1024) . '"></label></div>'
            . '<p class="dim small">보관 기간 동안 아무 변화가 없는 문의는 사진과 함께 저절로 지워져요 (닫은 문의부터). 같은 설정이 ⚙️ 설정 탭의 📮 신고·문의 에도 있어요.</p>'
            . '<div class="row"><button type="submit" class="btn">💾 설정 저장</button></div></form></section>';
    }

    private static function toolsCard(array $f): string
    {
        return '<section class="card"><h3>🧰 정리와 내보내기</h3>'
            . self::open('support_cleanup') . '<p class="dim small">보관 기간이 지난 문의를 지금 지워요 (한 번에 500개까지).</p><div class="row"><button type="submit" class="btn">🧹 지금 정리하기</button></div></form>'
            . self::open('support_export', ['status' => $f['status'], 'kind' => $f['kind'], 'q' => $f['q']])
            . '<p class="dim small">지금 보고 있는 목록을 CSV 파일로 내려받아요. 닉네임은 첫 글자만 보이고, 기기 정보와 사진은 들어가지 않아요. 글 속 전화번호·주소 같은 개인정보는 이미 가려져 있어요.</p>'
            . '<div class="row"><button type="submit" class="btn">⬇️ CSV 내려받기 (가린 것)</button></div></form></section>';
    }

    // ------------------------------------------------------------------ actions
    /** where the form came from: the list filter, the page and the open ticket (only known words and numbers pass) */
    public static function back(array $post): array
    {
        $b = [];
        $st = self::s($post, 'list_status');
        if ($st === 'active' || in_array($st, Support::STATUS, true)) $b['status'] = $st;
        $k = self::s($post, 'kind');
        if (in_array($k, Support::KINDS, true)) $b['kind'] = $k;
        if (self::id($post, 'before') > 0) $b['before'] = self::id($post, 'before');
        return $b;
    }

    private static function ok(string $msg, array $back = []): array { return ['msg' => $msg, 'back' => $back]; }

    private static function sure(array $p): void
    {
        if (self::s($p, 'sure') !== '1') throw new ApiException(400, 'CONFIRM_REQUIRED', '"정말 지울게요"에 표시한 뒤에 지울 수 있어요.');
    }

    public static function action(string $action, Ctx $c, array $p): array
    {
        $admin = (array) $c->user;
        if ((isset($admin['role']) ? $admin['role'] : '') !== 'admin') throw new ApiException(403, 'FORBIDDEN', '관리자 권한이 필요해요.');
        $id = self::id($p, 'id');
        switch ($action) {
            case 'support_answer':
                Support::answer($admin, $id, self::s($p, 'body'), self::s($p, 'status') === 'closed' ? 'closed' : 'answered');
                return self::ok('📨 답을 보냈어요. 체험객이 앱을 열면 🔔 알림함과 📮 내 문의에서 볼 수 있어요.', ['t' => $id]);
            case 'support_status':
                Support::setStatus($admin, $id, self::s($p, 'status'));
                return self::ok('💾 상태를 바꿨어요.', ['t' => $id]);
            case 'support_delete':
                self::sure($p);
                if (Support::remove($admin, [$id]) !== 1) throw new ApiException(404, 'NOT_FOUND', Support::NOT_FOUND);
                return self::ok('🗑️ 문의 하나를 지웠어요 (글·답·사진 모두).', ['t' => null]);
            case 'support_delete_many':
                self::sure($p);
                $pick = isset($p['pick']) && is_array($p['pick']) ? $p['pick'] : [];
                $ids = [];
                foreach ($pick as $v) if (is_string($v) && $v !== '' && strlen($v) <= 12 && ctype_digit($v)) $ids[] = (int) $v;
                if (!$ids) throw new ApiException(400, 'INVALID_INPUT', '지울 문의를 골라 주세요.');
                $n = Support::remove($admin, $ids);
                return self::ok('🗑️ 문의 ' . $n . '개를 지웠어요 (글·답·사진 모두).');
            case 'support_cleanup':
                $n = Support::cleanup($admin, 500);
                return self::ok($n > 0 ? '🧹 보관 기간이 지난 문의 ' . $n . '개를 지웠어요.' : '🧹 지울 만큼 오래된 문의가 없어요.');
            case 'support_settings':
                $aid = (int) $admin['id'];
                $num = function (string $k, int $min, int $max) use ($p) {
                    $v = self::s($p, $k);
                    if ($v === '' || !preg_match('/^\d{1,5}$/', $v)) throw new ApiException(400, 'INVALID_INPUT', '숫자를 적어 주세요.');
                    return max($min, min($max, (int) $v));
                };
                $vals = ['support.enabled' => self::s($p, 'enabled') === '1', 'support.shots' => self::s($p, 'shots') === '1', 'support.per_hour' => $num('per_hour', 1, 100),
                    'support.per_day' => $num('per_day', 1, 500), 'support.max_open' => $num('max_open', 1, 200), 'support.keep_days' => $num('keep_days', 7, 3650), 'support.shot_kb' => $num('shot_kb', 100, 1536)];
                foreach ($vals as $k => $v) Settings::set($k, $v, $aid);
                Audit::log('support_settings', null, ['keys' => count($vals)], 'info', $aid);
                return self::ok('💾 신고·문의 설정을 저장했어요.');
            case 'support_export':
                $f = Support::filter(['status' => self::s($p, 'status'), 'kind' => self::s($p, 'kind'), 'q' => self::s($p, 'q')]);
                $csv = Support::csv(Support::csvRows($f, 20000));
                Audit::log('support_export', null, ['status' => $f['status'], 'kind' => $f['kind'], 'bytes' => strlen($csv)], 'info', (int) $admin['id']);
                while (ob_get_level() > 0) ob_end_clean();
                AdminGate::headers();
                header('Content-Type: text/csv; charset=utf-8');
                header("Content-Security-Policy: default-src 'none'; sandbox");
                header('Content-Disposition: attachment; filename="support-' . date('Ymd-His') . '.csv"');
                http_response_code(200);
                Session::close();
                echo $csv;
                exit;
        }
        throw new ApiException(400, 'UNKNOWN_ACTION', '알 수 없는 작업이에요.');
    }

    /** GET ./?supshot=<id>: the picture of a ticket for the elevated administrator (no-store); anything else → 404 */
    public static function serve(array $admin, string $spec): void
    {
        if ((isset($admin['role']) ? $admin['role'] : '') !== 'admin' || !preg_match('/^[1-9]\d{0,11}$/', $spec)) throw new ApiException(404, 'NOT_FOUND', Support::NOT_FOUND);
        Support::stream(Support::shotFor($admin, (int) $spec), true);
    }
}
