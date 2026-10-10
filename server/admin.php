<?php
/**
 * 전통발효체험관 메타버스 — 관리자 센터 (server-rendered, no JavaScript)
 *
 *   /admin.php                 login (shared throttled login path) → role check → dashboard tabs
 *   tabs: overview(대시보드) · health(시스템 점검) · users(사용자) · moderation(신고·채팅) · audit(감사 로그) · maintenance(유지보수)
 *
 * Security: own strict CSP (default-src 'none'; style only by nonce; no scripts at all), X-Frame-Options DENY,
 * every value printed through e() (htmlspecialchars), every action is POST + CSRF token + same-origin check,
 * audited, and followed by a 303 redirect (PRG). First admin: only from the server machine while no admin exists.
 */
declare(strict_types=1);

require __DIR__ . '/lib/bootstrap.php';

use Tfm\{AdminOps, ApiException, Audit, Auth, Clock, Config, Ctx, Db, Health, Http, Log, Presence, RateLimit, Sec, Session, Stats, Users};

ob_start();
set_error_handler(static function (int $no, string $msg, string $file = '', int $line = 0): bool {
    if (!(error_reporting() & $no)) return false;
    throw new ErrorException($msg, 0, $no, $file, $line);
});

$NONCE = base64_encode(random_bytes(16));
const TABS = [
    'overview' => ['📊', '대시보드'],
    'health' => ['🩺', '시스템 점검'],
    'users' => ['👥', '사용자'],
    'moderation' => ['🚨', '신고·채팅'],
    'audit' => ['📜', '감사 로그'],
    'maintenance' => ['🧰', '유지보수'],
];
const REASONS = ['abuse' => '욕설·비방', 'spam' => '도배·광고', 'harass' => '불쾌한 행동', 'privacy' => '개인정보 노출', 'etc' => '기타'];

function e(mixed $v): string { return htmlspecialchars((string) $v, ENT_QUOTES | ENT_SUBSTITUTE | ENT_HTML5, 'UTF-8'); }
function when(int|string|null $ms): string { $ms = (int) $ms; return $ms > 0 ? date('Y-m-d H:i', intdiv($ms, 1000)) : '-'; }
function num(int|float|string|null $n): string { return number_format((float) $n); }
function flash(string $type, string $msg): void { Session::set('flash', ['type' => $type, 'msg' => $msg]); }
function tabParam(mixed $t): string { return is_string($t) && isset(TABS[$t]) ? $t : 'overview'; }
function redirect(string $tab, array $q = []): never
{
    while (ob_get_level() > 0) ob_end_clean();
    $q = array_filter(['tab' => $tab] + $q, fn ($v) => $v !== '' && $v !== null);
    header('Location: admin.php?' . http_build_query($q), true, 303);
    Session::close();
    exit;
}
function csrfField(): string { return '<input type="hidden" name="_csrf" value="' . e(Session::csrf()) . '">'; }
/** a one-button POST form (action + hidden fields) */
function actionForm(string $action, string $label, array $fields = [], string $cls = 'btn', string $tab = 'overview'): string
{
    $h = '<form method="post" action="admin.php" class="inline">' . csrfField() . '<input type="hidden" name="action" value="' . e($action) . '"><input type="hidden" name="tab" value="' . e($tab) . '">';
    foreach ($fields as $k => $v) $h .= '<input type="hidden" name="' . e($k) . '" value="' . e($v) . '">';
    return $h . '<button type="submit" class="' . e($cls) . '">' . e($label) . '</button></form>';
}
function badge(string $status): string
{
    [$cls, $txt] = match ($status) { 'ok' => ['ok', '✅ 정상'], 'warn' => ['warn', '⚠️ 주의'], 'fail' => ['fail', '⛔ 위험'], default => ['', $status] };
    return '<span class="badge ' . $cls . '">' . e($txt) . '</span>';
}

// =============================================================================== actions (POST → 303)
function handlePost(Ctx $c): never
{
    $tab = tabParam($_POST['tab'] ?? 'overview');
    $back = ['q' => is_string($_POST['q'] ?? null) ? mb_substr($_POST['q'], 0, 60) : ''];
    try {
        Sec::checkOrigin();
        if (!Session::checkCsrf(is_string($_POST['_csrf'] ?? null) ? $_POST['_csrf'] : null)) {
            Log::security('CSRF', 'admin form token invalid');
            throw new ApiException(403, 'CSRF_INVALID', '보안 토큰이 만료되었어요. 다시 시도해 주세요.');
        }
        $action = is_string($_POST['action'] ?? null) ? $_POST['action'] : '';
        if ($action === 'login') {
            $u = Auth::attemptLogin(is_string($_POST['login'] ?? null) ? $_POST['login'] : '', is_string($_POST['password'] ?? null) ? $_POST['password'] : '', false);
            flash($u['role'] === 'admin' ? 'ok' : 'warn', $u['role'] === 'admin' ? "👋 {$u['nickname']} 님, 관리자 센터에 오신 것을 환영해요." : '로그인했지만 관리자 권한이 없는 계정이에요.');
            redirect('overview');
        }
        if ($action === 'logout') {
            if ($c->user) { Presence::remove($c->uid()); Audit::log('logout', $c->uid(), ['via' => 'admin.php']); }
            Session::logout();
            flash('ok', '로그아웃했어요.');
            redirect('overview');
        }
        if (!$c->user) throw new ApiException(401, 'AUTH_REQUIRED', '먼저 로그인해 주세요.');
        if ($action === 'bootstrap') {
            $msg = AdminOps::bootstrap($c->user);
            $fresh = Users::byId($c->uid());
            if ($fresh) Session::refresh($fresh);
            flash('ok', '🎉 ' . $msg);
            redirect('health');
        }
        if (!$c->isAdmin()) {
            Audit::log('admin_denied', $c->uid(), ['action' => mb_substr($action, 0, 24)], 'warn');
            throw new ApiException(403, 'FORBIDDEN', '관리자 권한이 필요해요.');
        }
        $admin = $c->user;
        $uid = (int) ($_POST['uid'] ?? 0);
        $msg = match ($action) {
            'role' => AdminOps::setRole($admin, $uid, is_string($_POST['role'] ?? null) ? $_POST['role'] : ''),
            'ban' => AdminOps::setBanned($admin, $uid, true),
            'unban' => AdminOps::setBanned($admin, $uid, false),
            'mute' => AdminOps::mute($admin, $uid, (int) ($_POST['minutes'] ?? 0)),
            'report' => AdminOps::report($admin, (int) ($_POST['rid'] ?? 0), is_string($_POST['status'] ?? null) ? $_POST['status'] : ''),
            'hide' => AdminOps::hideMessage($admin, (int) ($_POST['mid'] ?? 0), true),
            'unhide' => AdminOps::hideMessage($admin, (int) ($_POST['mid'] ?? 0), false),
            'restore' => AdminOps::restoreBackup($admin, $uid),
            'cleanup' => (function () use ($admin) {
                $r = AdminOps::cleanup($admin);
                return '🧹 정리 완료 — ' . implode(' · ', array_map(fn ($k, $v) => "$k $v", array_keys($r), $r));
            })(),
            default => throw new ApiException(400, 'UNKNOWN_ACTION', '알 수 없는 작업이에요.'),
        };
        flash('ok', $msg);
    } catch (ApiException $e) {
        flash('error', $e->getMessage());
    }
    redirect($tab, $back);
}

// =============================================================================== views
function viewLogin(Ctx $c): string
{
    $boot = Http::isLocalhost() && !Users::adminExists() && Config::get('security.allow_localhost_bootstrap', true);
    $h = '<section class="card narrow hero"><div class="mascot" aria-hidden="true">🏺</div><h2>관리자 로그인</h2><p class="dim">게임과 같은 계정으로 로그인해요. 5번 틀리면 잠시 잠겨요.</p>';
    $h .= '<form method="post" action="admin.php" class="stack">' . csrfField() . '<input type="hidden" name="action" value="login">'
        . '<label>아이디(닉네임) 또는 이메일<input name="login" autocomplete="username" required maxlength="120"></label>'
        . '<label>비밀번호<input type="password" name="password" autocomplete="current-password" required maxlength="128"></label>'
        . '<button class="btn primary" type="submit">🔐 로그인</button></form>';
    if ($boot) $h .= '<p class="notice">🌱 아직 관리자가 없어요. 이 서버 PC에서 게임 계정으로 로그인하면 <b>첫 관리자로 지정</b>할 수 있어요.</p>';
    return $h . '</section>';
}

function viewNoAccess(Ctx $c): string
{
    $boot = Http::isLocalhost() && !Users::adminExists() && Config::get('security.allow_localhost_bootstrap', true);
    $h = '<section class="card narrow hero"><div class="mascot" aria-hidden="true">' . ($boot ? '🌱' : '🔒') . '</div>';
    if ($boot) {
        $h .= '<h2>첫 관리자 지정</h2><p>아직 관리자 계정이 없어요. 지금 로그인한 <b>' . e($c->user['nickname']) . '</b> 계정을 관리자로 지정할까요?</p>'
            . '<p class="dim small">이 버튼은 서버 PC(localhost)에서, 관리자가 한 명도 없을 때만 보여요. 지정 기록은 감사 로그에 남아요.</p>'
            . actionForm('bootstrap', '👑 이 계정을 관리자로 지정', [], 'btn gold');
    } else {
        $h .= '<h2>관리자 권한이 필요해요</h2><p class="dim"><b>' . e($c->user['nickname']) . '</b> 계정에는 관리자 권한이 없어요. 기존 관리자에게 요청하거나 서버에서 <code>php cli/tfm.php promote 이메일</code> 을 실행하세요.</p>';
    }
    return $h . '<div class="row">' . actionForm('logout', '로그아웃', [], 'btn ghost') . '</div></section>';
}

function viewOverview(): string
{
    $s = Stats::collect();
    $tiles = [
        ['👥', '가입자', $s['users']], ['🟢', '접속 중', $s['online']], ['🆕', '오늘 가입', $s['usersToday']], ['🎮', '오늘 플레이', $s['activeToday']],
        ['💾', '저장 데이터', $s['saves']], ['🚨', '열린 신고', $s['chatReports']], ['🛡️', '오늘 거부된 저장', $s['rejectedSavesToday']], ['⛔', '정지 계정', $s['bannedUsers']],
        ['🏆', '퀘스트 완료', $s['questCompletions']], ['🌾', '수확', $s['harvests']], ['🏺', '발효 수령', $s['ferments']], ['📝', '작업일지', $s['journals']],
        ['📷', '업로드 사진', $s['uploads']], ['💬', '채팅(24시간)', $s['chatMessages']],
    ];
    $h = '<div class="tiles">';
    foreach ($tiles as $i => [$ico, $label, $v]) $h .= '<div class="tile d' . ($i % 7) . '"><span class="ico" aria-hidden="true">' . $ico . '</span><b>' . e(num($v)) . '</b><small>' . e($label) . '</small></div>';
    $h .= '</div><div class="grid2">';
    $max = max(1, ...array_values($s['levels']));
    $h .= '<section class="card"><h3>⭐ 레벨 분포</h3>';
    foreach ($s['levels'] as $k => $n) $h .= '<div class="barrow"><span>' . e($k) . '</span><meter min="0" max="' . e($max) . '" value="' . e($n) . '"></meter><b>' . e(num($n)) . '</b></div>';
    $h .= '</section><section class="card"><h3>🗺️ 지금 어느 구역에 있나요?</h3>';
    if (!$s['zones']) $h .= '<p class="empty">🍃 지금 접속 중인 체험객이 없어요.</p>';
    else { $zmax = max($s['zones']); foreach ($s['zones'] as $z => $n) $h .= '<div class="barrow"><span>' . e($z) . '</span><meter min="0" max="' . e($zmax) . '" value="' . e($n) . '"></meter><b>' . e($n) . '</b></div>'; }
    $h .= '</section></div>';
    $hc = Health::collect(false);
    $h .= '<section class="card"><h3>🩺 시스템 점검 요약 ' . badge($hc['status']) . '</h3><p class="dim">정상 ' . e($hc['summary']['ok']) . ' · 주의 ' . e($hc['summary']['warn']) . ' · 위험 ' . e($hc['summary']['fail']) . ' — <a href="admin.php?tab=health">자세히 보기 →</a></p>';
    $bad = array_filter($hc['checks'], fn ($x) => $x['status'] !== 'ok');
    if ($bad) { $h .= '<ul class="checklist">'; foreach (array_slice($bad, 0, 6) as $x) $h .= '<li>' . badge($x['status']) . ' <b>' . e($x['label']) . '</b> <span class="dim">' . e($x['hint'] ?: $x['value']) . '</span></li>'; $h .= '</ul>'; }
    $h .= '</section><div class="grid2"><section class="card"><h3>🆕 최근 가입</h3>' . table(['닉네임', '권한', '레벨', '상태', '가입', '마지막 접속'], array_map(fn ($r) => [$r['nickname'], $r['role'], 'Lv.' . $r['level'], $r['status'], $r['joined'], $r['lastLogin']], $s['recentUsers'])) . '</section>';
    $h .= '<section class="card"><h3>📜 최근 감사 로그</h3>' . table(['이벤트', '등급', '대상', '시각'], array_map(fn ($r) => [$r['event'], $r['severity'], $r['user'], $r['at']], $s['recentAudit'])) . '</section></div>';
    return $h;
}

function table(array $head, array $rows, string $empty = '기록이 없어요.'): string
{
    if (!$rows) return '<p class="empty">🍃 ' . e($empty) . '</p>';
    $h = '<div class="tablewrap"><table><thead><tr>';
    foreach ($head as $c) $h .= '<th>' . e($c) . '</th>';
    $h .= '</tr></thead><tbody>';
    foreach ($rows as $r) { $h .= '<tr>'; foreach ($r as $v) $h .= '<td>' . e($v) . '</td>'; $h .= '</tr>'; }
    return $h . '</tbody></table></div>';
}

function viewHealth(): string
{
    $hc = Health::collect(true);
    $groups = ['php' => '🐘 PHP', 'db' => '🗄️ 데이터베이스', 'files' => '📁 파일·폴더', 'security' => '🛡️ 보안', 'server' => '🖥️ 웹 서버', 'app' => '🎮 앱'];
    $h = '<section class="card"><h3>🩺 종합 상태 ' . badge($hc['status']) . '</h3><p class="dim">PHP ' . e($hc['php']['version']) . ' (' . e($hc['php']['sapi']) . ', ' . e($hc['php']['os']) . ') · 앱 v' . e($hc['app']['version']) . ' · 설치 경로 ' . e($hc['app']['basePath']) . ' · ' . e(when($hc['generatedAt'])) . '</p></section>';
    foreach ($groups as $g => $title) {
        $rows = array_filter($hc['checks'], fn ($x) => $x['group'] === $g);
        if (!$rows) continue;
        $h .= '<section class="card"><h3>' . e($title) . '</h3><div class="tablewrap"><table><thead><tr><th>항목</th><th>상태</th><th>값</th><th>안내</th></tr></thead><tbody>';
        foreach ($rows as $x) $h .= '<tr><td><b>' . e($x['label']) . '</b></td><td>' . badge($x['status']) . '</td><td>' . e(is_scalar($x['value']) ? $x['value'] : json_encode($x['value'], JSON_UNESCAPED_UNICODE)) . '</td><td class="dim">' . e($x['hint']) . '</td></tr>';
        $h .= '</tbody></table></div></section>';
    }
    return $h;
}

function viewUsers(): string
{
    $q = is_string($_GET['q'] ?? null) ? mb_substr(trim($_GET['q']), 0, 60) : '';
    $page = max(0, min(10000, (int) ($_GET['p'] ?? 0)));
    $where = '';
    $params = [];
    if ($q !== '') {
        // '!' as LIKE escape character: portable (a backslash literal means different things in SQLite and MySQL)
        $like = '%' . str_replace(['!', '%', '_'], ['!!', '!%', '!_'], mb_strtolower($q)) . '%';
        $where = "WHERE u.nickname_key LIKE ? ESCAPE '!' OR u.email LIKE ? ESCAPE '!'";
        $params = [$like, $like];
    }
    $rows = Db::all("SELECT u.id, u.email, u.nickname, u.role, u.status, u.muted_until, u.created_at, u.last_login_at, p.level, p.exp_total, p.coin,
        (SELECT s.backup_saved_at FROM player_saves s WHERE s.user_id = u.id) AS backup_at, (SELECT s.rejects FROM player_saves s WHERE s.user_id = u.id) AS rejects
        FROM users u LEFT JOIN user_profiles p ON p.user_id = u.id $where ORDER BY u.id DESC LIMIT 51 OFFSET " . ($page * 50), $params);
    $more = count($rows) > 50;
    $rows = array_slice($rows, 0, 50);
    $now = Clock::ms();
    $h = '<section class="card"><form method="get" action="admin.php" class="search"><input type="hidden" name="tab" value="users"><input name="q" value="' . e($q) . '" placeholder="닉네임 또는 이메일 검색" maxlength="60"><button class="btn" type="submit">🔎 검색</button></form>';
    if (!$rows) return $h . '<p class="empty">🍃 사용자가 없어요.</p></section>';
    $h .= '<div class="tablewrap"><table><thead><tr><th>#</th><th>닉네임</th><th>이메일</th><th>권한</th><th>상태</th><th>레벨</th><th>코인</th><th>저장 거부</th><th>가입</th><th>마지막 접속</th><th>관리</th></tr></thead><tbody>';
    foreach ($rows as $r) {
        $uid = (int) $r['id'];
        $muted = (int) $r['muted_until'] > $now;
        $acts = '<details class="acts"><summary>⚙️ 관리</summary><div class="actgrid">'
            . ($r['role'] === 'admin' ? actionForm('role', '관리자 해제', ['uid' => $uid, 'role' => 'user', 'q' => $q], 'btn ghost', 'users') : actionForm('role', '👑 관리자 지정', ['uid' => $uid, 'role' => 'admin', 'q' => $q], 'btn gold', 'users'))
            . ($r['status'] === 'banned' ? actionForm('unban', '정지 해제', ['uid' => $uid, 'q' => $q], 'btn', 'users') : actionForm('ban', '⛔ 이용 정지', ['uid' => $uid, 'q' => $q], 'btn danger', 'users'))
            . ($muted ? actionForm('mute', '채팅 제한 해제', ['uid' => $uid, 'minutes' => 0, 'q' => $q], 'btn', 'users') : actionForm('mute', '🔇 채팅 1시간 제한', ['uid' => $uid, 'minutes' => 60, 'q' => $q], 'btn ghost', 'users') . actionForm('mute', '🔇 채팅 하루 제한', ['uid' => $uid, 'minutes' => 1440, 'q' => $q], 'btn ghost', 'users'))
            . ((int) $r['backup_at'] > 0 ? actionForm('restore', '↩️ 직전 저장으로 되돌리기', ['uid' => $uid, 'q' => $q], 'btn ghost', 'users') : '')
            . '</div></details>';
        $h .= '<tr><td>' . $uid . '</td><td><b>' . e($r['nickname']) . '</b></td><td>' . e($r['email']) . '</td><td>' . ($r['role'] === 'admin' ? '<span class="badge gold">관리자</span>' : '사용자') . '</td><td>'
            . ($r['status'] === 'banned' ? '<span class="badge fail">정지</span>' : ($muted ? '<span class="badge warn">채팅 제한</span>' : '<span class="badge ok">정상</span>'))
            . '</td><td>Lv.' . e($r['level'] ?? 1) . '</td><td>' . e(num($r['coin'] ?? 0)) . '</td><td>' . e(num($r['rejects'] ?? 0)) . '</td><td>' . e(when($r['created_at'])) . '</td><td>' . e(when($r['last_login_at'])) . '</td><td>' . $acts . '</td></tr>';
    }
    $h .= '</tbody></table></div><div class="row">';
    if ($page > 0) $h .= '<a class="btn ghost" href="admin.php?' . e(http_build_query(['tab' => 'users', 'q' => $q, 'p' => $page - 1])) . '">← 이전</a>';
    if ($more) $h .= '<a class="btn ghost" href="admin.php?' . e(http_build_query(['tab' => 'users', 'q' => $q, 'p' => $page + 1])) . '">다음 →</a>';
    return $h . '</div></section>';
}

function viewModeration(): string
{
    $all = ($_GET['show'] ?? '') === 'all';
    $reports = Db::all('SELECT r.*, ru.nickname AS reporter, m.hidden AS msg_hidden FROM chat_reports r LEFT JOIN users ru ON ru.id = r.reporter_id LEFT JOIN chat_messages m ON m.id = r.message_id '
        . ($all ? '' : "WHERE r.status = 'open' ") . 'ORDER BY r.id DESC LIMIT 100');
    $h = '<section class="card"><h3>🚨 신고 ' . ($all ? '(전체)' : '(처리 대기)') . '</h3><p class="row"><a class="btn ghost" href="admin.php?tab=moderation' . ($all ? '' : '&amp;show=all') . '">' . ($all ? '처리 대기만 보기' : '전체 보기') . '</a></p>';
    if (!$reports) $h .= '<p class="empty">🎉 처리할 신고가 없어요.</p>';
    else {
        $h .= '<div class="tablewrap"><table><thead><tr><th>#</th><th>대상</th><th>사유</th><th>메시지</th><th>메모</th><th>신고자</th><th>시각</th><th>상태</th><th>처리</th></tr></thead><tbody>';
        foreach ($reports as $r) {
            $tid = (int) ($r['target_user_id'] ?? 0);
            $acts = '<details class="acts"><summary>⚙️ 처리</summary><div class="actgrid">'
                . ($r['status'] === 'open' ? actionForm('report', '✅ 처리 완료', ['rid' => $r['id'], 'status' => 'resolved'], 'btn', 'moderation') . actionForm('report', '기각', ['rid' => $r['id'], 'status' => 'dismissed'], 'btn ghost', 'moderation') : actionForm('report', '다시 열기', ['rid' => $r['id'], 'status' => 'open'], 'btn ghost', 'moderation'))
                . ($r['message_id'] ? ((int) $r['msg_hidden'] ? actionForm('unhide', '메시지 다시 보이기', ['mid' => $r['message_id']], 'btn ghost', 'moderation') : actionForm('hide', '🙈 메시지 숨기기', ['mid' => $r['message_id']], 'btn', 'moderation')) : '')
                . ($tid ? actionForm('mute', '🔇 대상 채팅 1시간 제한', ['uid' => $tid, 'minutes' => 60], 'btn ghost', 'moderation') . actionForm('ban', '⛔ 대상 이용 정지', ['uid' => $tid], 'btn danger', 'moderation') : '')
                . '</div></details>';
            $h .= '<tr><td>' . (int) $r['id'] . '</td><td><b>' . e($r['target_name']) . '</b></td><td>' . e(REASONS[$r['reason']] ?? $r['reason']) . '</td><td class="msg">' . e($r['message_text']) . ((int) ($r['msg_hidden'] ?? 0) ? ' <span class="badge warn">숨김</span>' : '') . '</td><td class="dim">' . e($r['memo']) . '</td><td>' . e($r['reporter'] ?? '-') . '</td><td>' . e(when($r['created_at'])) . '</td><td>' . e(['open' => '대기', 'resolved' => '완료', 'dismissed' => '기각'][$r['status']] ?? $r['status']) . '</td><td>' . $acts . '</td></tr>';
        }
        $h .= '</tbody></table></div>';
    }
    $h .= '</section>';
    $msgs = Db::all('SELECT id, user_id, nickname, channel, text, hidden, created_at FROM chat_messages ORDER BY id DESC LIMIT 60');
    $h .= '<section class="card"><h3>💬 최근 채팅 60개</h3>';
    if (!$msgs) return $h . '<p class="empty">🍃 채팅이 없어요.</p></section>';
    $h .= '<div class="tablewrap"><table><thead><tr><th>#</th><th>보낸 사람</th><th>채널</th><th>내용</th><th>시각</th><th></th></tr></thead><tbody>';
    foreach ($msgs as $m) {
        $h .= '<tr' . ((int) $m['hidden'] ? ' class="muted"' : '') . '><td>' . (int) $m['id'] . '</td><td>' . e($m['nickname']) . '</td><td>' . e($m['channel'] === 'local' ? '주변' : '전체') . '</td><td class="msg">' . e($m['text']) . '</td><td>' . e(when($m['created_at'])) . '</td><td>'
            . ((int) $m['hidden'] ? actionForm('unhide', '보이기', ['mid' => $m['id']], 'btn ghost', 'moderation') : actionForm('hide', '숨기기', ['mid' => $m['id']], 'btn ghost', 'moderation')) . '</td></tr>';
    }
    return $h . '</tbody></table></div></section>';
}

function viewAudit(): string
{
    $ev = is_string($_GET['ev'] ?? null) && preg_match('/^[a-z_]{1,40}$/', $_GET['ev']) ? $_GET['ev'] : '';
    $sev = is_string($_GET['sev'] ?? null) && in_array($_GET['sev'], ['info', 'warn', 'alert'], true) ? $_GET['sev'] : '';
    $w = [];
    $p = [];
    if ($ev !== '') { $w[] = 'a.event = ?'; $p[] = $ev; }
    if ($sev !== '') { $w[] = 'a.severity = ?'; $p[] = $sev; }
    $rows = Db::all('SELECT a.*, u.nickname AS subject, ac.nickname AS actor FROM audit_log a LEFT JOIN users u ON u.id = a.user_id LEFT JOIN users ac ON ac.id = a.actor_id '
        . ($w ? 'WHERE ' . implode(' AND ', $w) . ' ' : '') . 'ORDER BY a.id DESC LIMIT 200', $p);
    $events = array_column(Db::all('SELECT DISTINCT event FROM audit_log ORDER BY event'), 'event');
    $h = '<section class="card"><form method="get" action="admin.php" class="search"><input type="hidden" name="tab" value="audit"><select name="ev"><option value="">모든 이벤트</option>';
    foreach ($events as $x) $h .= '<option value="' . e($x) . '"' . ($x === $ev ? ' selected' : '') . '>' . e($x) . '</option>';
    $h .= '</select><select name="sev"><option value="">모든 등급</option>';
    foreach (['info' => '정보', 'warn' => '주의', 'alert' => '경고'] as $k => $v) $h .= '<option value="' . $k . '"' . ($k === $sev ? ' selected' : '') . '>' . $v . '</option>';
    $h .= '</select><button class="btn" type="submit">필터</button></form>';
    $h .= table(['#', '시각', '이벤트', '등급', '대상', '처리자', 'IP', '내용'], array_map(fn ($r) => [
        $r['id'], when($r['created_at']), $r['event'], $r['severity'], $r['subject'] ?? ($r['user_id'] ? '#' . $r['user_id'] : '-'), $r['actor'] ?? '-', $r['ip'], mb_substr((string) $r['detail'], 0, 180),
    ], $rows));
    return $h . '<p class="dim small">감사 로그는 ' . e(Config::get('retention.audit_days', 180)) . '일 동안 보관돼요.</p></section>';
}

function viewMaintenance(): string
{
    $driver = Db::driver();
    $h = '<div class="grid2"><section class="card"><h3>🧹 정리 작업</h3><p class="dim">만료된 요청 제한 기록, 오래된 접속 정보·로그인 시도·감사 로그·채팅·로그 파일을 보관 기간에 맞춰 지워요.</p>'
        . actionForm('cleanup', '🧹 지금 정리하기', [], 'btn primary', 'maintenance') . '</section>';
    $h .= '<section class="card"><h3>💾 백업</h3>';
    if ($driver === 'sqlite') {
        $path = Db::sqlitePath();
        $h .= '<p>SQLite 파일: <code>' . e(basename($path)) . '</code> (' . e(num(is_file($path) ? filesize($path) : 0)) . ' bytes)</p>'
            . '<p class="dim small">서버 PC에서 <code>php cli/tfm.php backup</code> 을 실행하면 data/backups/ 에 안전한 사본(VACUUM INTO)이 만들어져요. data/secret.php 도 함께 보관하세요.</p>';
    } else {
        $h .= '<p class="dim small">MySQL: <code>mysqldump -u root -p fermentation_metaverse &gt; backup.sql</code> 또는 phpMyAdmin → 내보내기.</p>';
    }
    $h .= '</section></div><section class="card"><h3>🗒️ 로그 파일</h3>';
    $files = glob(Log::dir() . '/app-*.log.php') ?: [];
    rsort($files);
    $h .= table(['파일', '크기', '수정'], array_map(fn ($f) => [basename($f), num(filesize($f)) . ' bytes', date('Y-m-d H:i', (int) filemtime($f))], array_slice($files, 0, 30)), '로그 파일이 없어요.');
    return $h . '<p class="dim small">로그는 data/logs 에 있으며 웹에서는 열리지 않아요 (각 파일 첫 줄의 PHP 종료 코드). 서버 PC에서 텍스트 편집기로 확인하세요.</p></section>';
}

// =============================================================================== page shell
function page(Ctx $c, string $tab, string $body, string $nonce, ?array $flash): string
{
    $nav = '';
    if ($c->isAdmin()) {
        $nav = '<nav class="tabs" aria-label="관리 메뉴">';
        foreach (TABS as $k => [$ico, $label]) $nav .= '<a href="admin.php?tab=' . $k . '"' . ($k === $tab ? ' class="on" aria-current="page"' : '') . '><span aria-hidden="true">' . $ico . '</span> ' . e($label) . '</a>';
        $nav .= '</nav>';
    }
    $who = $c->user ? '<div class="who"><span class="avatar" aria-hidden="true">' . e(mb_substr((string) $c->user['nickname'], 0, 1)) . '</span><span><b>' . e($c->user['nickname']) . '</b><small>' . ($c->isAdmin() ? '👑 관리자' : '체험객') . '</small></span>' . actionForm('logout', '로그아웃', [], 'btn ghost sm') . '</div>' : '';
    $fl = $flash ? '<div class="flash ' . e($flash['type'] ?? 'ok') . '" role="status">' . e($flash['msg'] ?? '') . '</div>' : '';
    return '<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow">'
        . '<title>관리자 센터 · 전통발효체험관 메타버스</title><style nonce="' . e($nonce) . '">' . css() . '</style></head><body>'
        . '<header class="top"><div class="brand"><span class="logo" aria-hidden="true">🏺</span><div><h1>전통발효체험관 <em>관리자 센터</em></h1><p>METAVERSE · ' . e(strtoupper(Db::driverSafe())) . ' · v' . e(TFM_VERSION) . '</p></div></div>' . $who . '</header>'
        . $nav . '<main>' . $fl . $body . '</main><footer>🔒 이 페이지는 스크립트 없이 동작하며 모든 작업은 감사 로그에 기록됩니다. · <a href="./">🎮 게임으로 돌아가기</a></footer></body></html>';
}

function css(): string
{
    return <<<'CSS'
:root{--bg:#0b1410;--glass:rgba(16,26,21,.72);--glass2:rgba(255,255,255,.06);--line:rgba(255,255,255,.12);--text:#f4f6f1;--dim:#b9c4b5;--mute:#8e9a8b;--green:#34c36b;--green-d:#1f9e52;--gold:#f4c54a;--red:#ff6b5e;--orange:#ff9f43;--blue:#4aa8ff;--r:16px;--font:'Pretendard','Apple SD Gothic Neo','Malgun Gothic','맑은 고딕',system-ui,-apple-system,sans-serif}
*{box-sizing:border-box}html{background:var(--bg)}body{margin:0;min-height:100vh;color:var(--text);font:15px/1.5 var(--font);background:radial-gradient(1200px 600px at 10% -10%,rgba(52,195,107,.22),transparent 60%),radial-gradient(900px 500px at 110% 10%,rgba(244,197,74,.14),transparent 60%),linear-gradient(180deg,#0f1c15,#0a120e 60%);background-attachment:fixed}
body::before{content:'';position:fixed;inset:-20%;pointer-events:none;background:conic-gradient(from 0deg at 50% 50%,rgba(52,195,107,.06),transparent 25%,rgba(244,197,74,.05),transparent 60%,rgba(74,168,255,.05),transparent);animation:spin 60s linear infinite;z-index:-1}
@keyframes spin{to{transform:rotate(1turn)}}@keyframes rise{from{transform:translateY(10px) scale(.995)}to{transform:none}}@keyframes bob{0%,100%{transform:translateY(0) rotate(-4deg)}50%{transform:translateY(-6px) rotate(4deg)}}
@media (prefers-reduced-motion:reduce){*,*::before{animation:none!important;transition:none!important}}
a{color:#86e3a8}code{background:rgba(0,0,0,.35);padding:1px 6px;border-radius:6px;font-size:.92em}
.top{display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;padding:18px max(16px,4vw);border-bottom:1px solid var(--line);background:rgba(10,18,14,.6);backdrop-filter:blur(12px);position:sticky;top:0;z-index:5}
.brand{display:flex;align-items:center;gap:12px}.logo{font-size:34px;filter:drop-shadow(0 0 12px rgba(244,197,74,.5));animation:bob 4s ease-in-out infinite}
h1{margin:0;font-size:1.15rem;letter-spacing:-.01em}h1 em{font-style:normal;color:var(--gold)}.brand p{margin:0;color:var(--mute);font-size:.75rem;letter-spacing:.12em}
.who{display:flex;align-items:center;gap:10px}.who small{display:block;color:var(--mute);font-size:.75rem}.avatar{width:36px;height:36px;border-radius:50%;display:grid;place-items:center;background:linear-gradient(135deg,var(--green),var(--green-d));font-weight:700;box-shadow:0 0 0 2px rgba(255,255,255,.15)}
.tabs{display:flex;gap:6px;overflow-x:auto;padding:12px max(16px,4vw);scrollbar-width:thin}.tabs a{flex:none;padding:9px 14px;border-radius:999px;text-decoration:none;color:var(--dim);background:var(--glass2);border:1px solid var(--line);transition:.2s}.tabs a:hover{color:var(--text);border-color:rgba(52,195,107,.5)}.tabs a.on{color:#08140d;background:linear-gradient(135deg,#86e3a8,var(--green));border-color:transparent;font-weight:700;box-shadow:0 6px 18px rgba(52,195,107,.35)}
main{padding:8px max(16px,4vw) 32px;display:grid;gap:16px;max-width:1500px;margin:0 auto}footer{text-align:center;color:var(--mute);font-size:.8rem;padding:24px 16px 32px}
.card{background:var(--glass);border:1px solid var(--line);border-radius:var(--r);padding:18px 20px;box-shadow:0 12px 32px rgba(0,0,0,.3);backdrop-filter:blur(14px);animation:rise .35s ease both;min-width:0}
.card h3{margin:0 0 12px;font-size:1.02rem;display:flex;align-items:center;gap:8px;flex-wrap:wrap}.narrow{max-width:460px;margin:6vh auto;width:100%}.hero{text-align:center}.mascot{font-size:64px;animation:bob 3.5s ease-in-out infinite;filter:drop-shadow(0 8px 18px rgba(0,0,0,.4))}
.grid2{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(420px,100%),1fr));gap:16px}
.tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px}.tile{background:linear-gradient(160deg,rgba(255,255,255,.09),rgba(255,255,255,.03));border:1px solid var(--line);border-radius:14px;padding:14px;display:grid;gap:2px;animation:rise .4s ease both;transition:transform .2s}.tile:hover{transform:translateY(-3px)}
.tile .ico{font-size:22px}.tile b{font-size:1.5rem;letter-spacing:-.02em}.tile small{color:var(--dim)}.d1{animation-delay:.04s}.d2{animation-delay:.08s}.d3{animation-delay:.12s}.d4{animation-delay:.16s}.d5{animation-delay:.2s}.d6{animation-delay:.24s}
.barrow{display:grid;grid-template-columns:110px 1fr 48px;gap:10px;align-items:center;margin:6px 0}.barrow span{color:var(--dim);font-size:.85rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.barrow b{text-align:right}
meter{width:100%;height:12px;border-radius:99px;background:rgba(255,255,255,.08);border:0}meter::-webkit-meter-bar{background:rgba(255,255,255,.08);border-radius:99px;border:0;height:12px}meter::-webkit-meter-optimum-value{background:linear-gradient(90deg,var(--green-d),#86e3a8);border-radius:99px}meter::-moz-meter-bar{background:linear-gradient(90deg,var(--green-d),#86e3a8);border-radius:99px}
.tablewrap{overflow-x:auto;border-radius:12px;border:1px solid var(--line)}table{width:100%;border-collapse:collapse;font-size:.88rem}th,td{padding:9px 10px;text-align:left;border-bottom:1px solid rgba(255,255,255,.07);vertical-align:top}th{background:rgba(0,0,0,.25);color:var(--dim);font-weight:600;white-space:nowrap;position:sticky;top:0}tr:hover td{background:rgba(255,255,255,.03)}tr.muted td{opacity:.5}td.msg{max-width:360px;word-break:break-word}
.badge{display:inline-block;padding:2px 9px;border-radius:99px;font-size:.78rem;font-weight:700;white-space:nowrap;background:rgba(255,255,255,.1)}.badge.ok{background:rgba(52,195,107,.18);color:#86e3a8}.badge.warn{background:rgba(255,159,67,.18);color:#ffc58f}.badge.fail{background:rgba(255,107,94,.2);color:#ffaaa2}.badge.gold{background:rgba(244,197,74,.2);color:var(--gold)}
.btn{display:inline-flex;align-items:center;gap:6px;padding:8px 14px;border-radius:10px;border:1px solid var(--line);background:rgba(255,255,255,.08);color:var(--text);font:inherit;font-weight:600;cursor:pointer;text-decoration:none;transition:.15s}.btn:hover{background:rgba(255,255,255,.14);transform:translateY(-1px)}.btn:focus-visible,input:focus-visible,select:focus-visible,summary:focus-visible,a:focus-visible{outline:2px solid var(--gold);outline-offset:2px}
.btn.primary{background:linear-gradient(135deg,#4fd683,var(--green-d));border-color:transparent;color:#06120a}.btn.gold{background:linear-gradient(135deg,#ffe08a,var(--gold));border-color:transparent;color:#2b1d00}.btn.danger{background:rgba(255,107,94,.18);border-color:rgba(255,107,94,.45);color:#ffd1cc}.btn.ghost{background:transparent}.btn.sm{padding:6px 10px;font-size:.85rem}
form.inline{display:inline}.stack{display:grid;gap:12px;text-align:left;margin-top:12px}label{display:grid;gap:6px;color:var(--dim);font-size:.9rem}input,select{width:100%;padding:11px 12px;border-radius:10px;border:1px solid var(--line);background:rgba(0,0,0,.3);color:var(--text);font:inherit}
.search{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px}.search input{flex:1 1 220px;width:auto}.search select{width:auto;flex:0 1 200px}.row{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px;justify-content:center}.search+.tablewrap{margin-top:4px}
details.acts summary{cursor:pointer;list-style:none;padding:6px 10px;border-radius:8px;background:rgba(255,255,255,.06);white-space:nowrap}details.acts summary::-webkit-details-marker{display:none}details.acts[open] summary{background:rgba(52,195,107,.2)}.actgrid{display:grid;gap:6px;margin-top:8px;min-width:190px}.actgrid .btn{width:100%;justify-content:center}
.flash{padding:12px 16px;border-radius:12px;border:1px solid var(--line);animation:rise .3s ease both;font-weight:600}.flash.ok{background:rgba(52,195,107,.16);border-color:rgba(52,195,107,.4)}.flash.warn{background:rgba(255,159,67,.14);border-color:rgba(255,159,67,.4)}.flash.error{background:rgba(255,107,94,.16);border-color:rgba(255,107,94,.45)}
.notice{margin-top:16px;padding:12px;border-radius:12px;background:rgba(244,197,74,.12);border:1px dashed rgba(244,197,74,.45);color:#ffe6a3;font-size:.9rem}.empty{color:var(--dim);text-align:center;padding:18px}.dim{color:var(--dim)}.small{font-size:.82rem}.checklist{list-style:none;padding:0;margin:8px 0 0;display:grid;gap:6px}
@media (max-width:640px){.top{position:static}.barrow{grid-template-columns:84px 1fr 40px}th,td{padding:8px}.tiles{grid-template-columns:repeat(2,1fr)}}
CSS;
}

// =============================================================================== request
$status = 200;
$ctx = null;
try {
    Http::securityHeaders('admin', $NONCE);
    Session::start(true);
    $ctx = new Ctx();
    $ctx->user = Auth::current();
    RateLimit::forRequest('admin_page', $ctx);
    $method = Http::method();
    if ($method === 'POST') handlePost($ctx);
    if (!in_array($method, ['GET', 'HEAD'], true)) throw new ApiException(405, 'METHOD_NOT_ALLOWED', '허용되지 않은 요청 방식이에요.', null, ['Allow: GET, POST']);
    $tab = tabParam($_GET['tab'] ?? 'overview');
    if (!$ctx->user) $body = viewLogin($ctx);
    elseif (!$ctx->isAdmin()) $body = viewNoAccess($ctx);
    else {
        $body = match ($tab) {
            'health' => viewHealth(),
            'users' => viewUsers(),
            'moderation' => viewModeration(),
            'audit' => viewAudit(),
            'maintenance' => viewMaintenance(),
            default => viewOverview(),
        };
    }
    $flash = Session::get('flash');
    if ($flash) Session::set('flash', null);
    $html = page($ctx, $tab, $body, $NONCE, is_array($flash) ? $flash : null);
} catch (ApiException $e) {
    $status = $e->status;
    foreach ($e->headers as $hd) header($hd);
    $html = page($ctx ?? new Ctx(), 'overview', '<section class="card narrow hero"><div class="mascot" aria-hidden="true">🙈</div><h2>' . e($e->getMessage()) . '</h2><p class="row"><a class="btn" href="admin.php">다시 시도</a></p></section>', $NONCE, null);
} catch (Throwable $e) {
    $status = 500;
    $ref = Log::requestId();
    Log::error('ADMIN', get_class($e) . ': ' . $e->getMessage(), ['at' => basename($e->getFile()) . ':' . $e->getLine()]);
    $html = '<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>오류</title><style nonce="' . e($NONCE) . '">body{background:#0b1410;color:#f4f6f1;font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;text-align:center}.big{font-size:48px;margin:0}</style></head><body><div><p class="big" aria-hidden="true">🛠️</p><h1>관리자 센터를 여는 중 문제가 생겼어요</h1><p>오류 번호: <code>' . e($ref) . '</code> — data/logs 에서 확인하세요.</p></div></body></html>';
}
while (ob_get_level() > 0) ob_end_clean();
if (!headers_sent()) http_response_code($status);
Session::close();
echo $html;
