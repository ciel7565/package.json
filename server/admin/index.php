<?php
/**
 * TFM-ADMIN-ENTRY — 전통발효체험관 메타버스 관리자 센터 (server-rendered, no JavaScript at all). CONTRACT §15.4.
 *
 *   <installation>/<admin folder>/      the folder name is free: `php cli/tfm.php admin:path --random` renames it; every
 *                                       include is __DIR__-relative and every link, form and redirect is relative ("./")
 *   tabs: overview(대시보드) · health(시스템 점검) · users(사용자) · sub(구독·결제) · moderation(신고·채팅) · security(보안)
 *         · twofa(2단계 인증) · audit(감사 로그) · maintenance(유지보수)
 *
 * The lock (security item 6), in the order it is applied:
 *   1. only "./" and "./index.php" are pages (index.php/anything is a missing page)
 *   2. security.admin_ip_allowlist: another address gets the plain 404 of a missing page (no session, no cookie)
 *   3. a blocked address, plain http where https is required, a file upload: refused before the session starts
 *   4. every answer: a CSP without scripts, X-Robots-Tag noindex, nofollow, noarchive, Cache-Control no-store,
 *      Referrer-Policy no-referrer, X-Frame-Options DENY
 *   5. a session is only resumed when it exists (finding F9): a visitor without one gets the sign-in form with a
 *      stateless token, and the session starts at the sign-in POST (rate limit admin_login, else login, by address)
 *   6. sign-in = the shared throttled login (Auth::attemptLogin) + the admin role + 2-step sign-in (security.admin_2fa
 *      off | optional | required) → the admin elevation (session flag + folder cookie, security.admin_idle)
 *   7. every action: POST + CSRF token + same-origin check + audit + 303 to the tab (a refused token is a plain 403)
 * First admin (finding F4): while no admin exists, the sign-in page offers "첫 관리자 지정" with the one-time setup code.
 * PHP 7.2 syntax only.
 */
declare(strict_types=1);

require __DIR__ . '/../lib/bootstrap.php';

use Tfm\AdminGate;
use Tfm\AdminOps;
use Tfm\AdminPath;
use Tfm\AdminTotp;
use Tfm\ApiException;
use Tfm\Audit;
use Tfm\Auth;
use Tfm\Clock;
use Tfm\Config;
use Tfm\Crypto;
use Tfm\Ctx;
use Tfm\Db;
use Tfm\Firewall;
use Tfm\Health;
use Tfm\Http;
use Tfm\Json;
use Tfm\Log;
use Tfm\LoginThrottle;
use Tfm\Presence;
use Tfm\RateLimit;
use Tfm\Sec;
use Tfm\SecEvent;
use Tfm\Session;
use Tfm\SetupCode;
use Tfm\Stats;
use Tfm\Subscription;
use Tfm\Toss;
use Tfm\Totp;
use Tfm\Users;
use Tfm\V;

ob_start();
set_error_handler(static function (int $no, string $msg, string $file = '', int $line = 0): bool {
    if (!(error_reporting() & $no)) return false;
    throw new ErrorException($msg, 0, $no, $file, $line);
});

const TABS = [
    'overview' => ['📊', '대시보드'],
    'health' => ['🩺', '시스템 점검'],
    'users' => ['👥', '사용자'],
    'sub' => ['⚡', '구독·결제'],
    'moderation' => ['🚨', '신고·채팅'],
    'security' => ['🛡️', '보안'],
    'twofa' => ['🔐', '2단계 인증'],
    'audit' => ['📜', '감사 로그'],
    'maintenance' => ['🧰', '유지보수'],
];
const REASONS = ['kid' => '🧒 어린이 신고', 'abuse' => '욕설·비방', 'spam' => '도배·광고', 'harass' => '불쾌한 행동', 'privacy' => '개인정보 노출', 'etc' => '기타'];
const SUB_STATUS = ['none' => '없음', 'active' => '이용 중', 'past_due' => '갱신 실패(유예)', 'canceled' => '해지됨'];
const ORDER_STATUS = ['created' => '대기', 'confirmed' => '완료', 'failed' => '실패', 'canceled' => '취소', 'refunded' => '환불'];
const ORDER_KIND = ['first' => '첫 결제', 'renewal' => '자동 갱신', 'manual' => '수동 부여'];
/** security event kinds in plain words (CONTRACT §15.7 #5) */
const KIND_KO = [
    'csrf_fail' => '보안 토큰이 맞지 않는 요청', 'origin_mismatch' => '다른 사이트에서 보낸 요청', 'admin_denied' => '관리자가 아닌 계정의 관리자 접근',
    'admin_ip_denied' => '허용 주소가 아닌 곳의 관리자 접근', 'admin_2fa_fail' => '2단계 인증 코드 틀림', 'login_locked' => '로그인 잠김(너무 많이 틀림)',
    'probe_sqli' => 'SQL 주입 시도', 'probe_xss' => '스크립트 심기(XSS) 시도', 'probe_traversal' => '폴더 거슬러 오르기 시도', 'honeypot' => '함정 주소 방문(스캐너)',
    'payment_tamper' => '결제 금액 조작 시도', 'upload_rejected' => '허용되지 않은 파일 올리기', 'save_rejected' => '거부된 저장', 'https_required' => '보안 연결(HTTPS) 아닌 요청',
    'ip_blocked' => '차단된 주소의 접속', 'ai_abuse' => 'AI 도우미 남용', 'auto_block' => '자동 차단',
];
const SINCE = ['1h' => [3600, '1시간'], '24h' => [86400, '24시간'], '7d' => [604800, '7일'], '30d' => [2592000, '30일'], '90d' => [7776000, '90일']];
/** audit events of the admin sign-in history (🛡️ tab) */
const SIGNIN_EVENTS = ['admin_signin' => '로그인 성공', 'admin_signout' => '로그아웃', 'admin_denied' => '권한 없는 계정의 시도', 'admin_2fa_fail' => '2단계 코드 틀림',
    'admin_2fa_ok' => '2단계 코드 확인', 'admin_2fa_enrolled' => '2단계 인증 켬', 'admin_2fa_disabled' => '2단계 인증 끔', 'admin_2fa_backup' => '백업 코드 새로 만듦',
    'admin_2fa_reset' => '2단계 인증 초기화(서버)', 'admin_2fa_unlocked' => '2단계 잠금 풀기(서버)', 'admin_bootstrap' => '첫 관리자 지정', 'admin_path_renamed' => '관리자 폴더 이름 바꿈'];

function e($v): string { return htmlspecialchars((string) $v, ENT_QUOTES | ENT_SUBSTITUTE | ENT_HTML401, 'UTF-8'); }
function when($ms): string { $ms = (int) $ms; return $ms > 0 ? date('Y-m-d H:i', intdiv($ms, 1000)) : '-'; }
function whenSec($ms): string { $ms = (int) $ms; return $ms > 0 ? date('m-d H:i:s', intdiv($ms, 1000)) : '-'; }
function num($n): string { return number_format((float) $n); }
function flash(string $type, string $msg): void { Session::set('flash', ['type' => $type, 'msg' => $msg]); }
/** backup codes for the next page only — sealed in the session, removed as soon as they were shown */
function flashCodes(array $codes, string $msg): void
{
    Session::set('flash', ['type' => 'ok', 'msg' => $msg]);
    Session::set('flash_codes', class_exists('Tfm\Crypto') && Crypto::available() ? Crypto::seal(Json::encode(array_values($codes))) : null);
}
function tabParam($t): string { return is_string($t) && isset(TABS[$t]) ? $t : 'overview'; }
function postStr(string $k): string { return isset($_POST[$k]) && is_string($_POST[$k]) ? $_POST[$k] : ''; }
function getStr(string $k): string { return isset($_GET[$k]) && is_string($_GET[$k]) ? $_GET[$k] : ''; }
/** a link inside the admin folder: "./?tab=…" (relative, so the folder can have any name) */
function href(array $q): string { return './?' . http_build_query(array_filter($q, function ($v) { return $v !== '' && $v !== null; })); }
/** F15: the stylesheet's cache-buster is a hash of admin.css (a public file anyway), never the app version */
function cssHref(): string
{
    $h = @sha1_file(__DIR__ . '/admin.css');
    return 'admin.css' . (is_string($h) ? '?v=' . substr($h, 0, 10) : '');
}
function redirectTo(string $tab, array $q = [])
{
    while (ob_get_level() > 0) ob_end_clean();
    header('Location: ' . href(['tab' => $tab] + $q), true, 303);
    Session::close();
    exit;
}
function tokenField(string $token): string { return '<input type="hidden" name="_csrf" value="' . e($token) . '">'; }
function csrfField(): string { return tokenField(Session::csrf()); }
/** a one-button POST form (action + hidden fields) */
function actionForm(string $action, string $label, array $fields = [], string $cls = 'btn', string $tab = 'overview'): string
{
    $h = '<form method="post" action="./" class="inline">' . csrfField() . '<input type="hidden" name="action" value="' . e($action) . '"><input type="hidden" name="tab" value="' . e($tab) . '">';
    foreach ($fields as $k => $v) $h .= '<input type="hidden" name="' . e($k) . '" value="' . e($v) . '">';
    return $h . '<button type="submit" class="' . e($cls) . '">' . e($label) . '</button></form>';
}
function badge(string $status): string
{
    $map = ['ok' => ['ok', '✅ 정상'], 'warn' => ['warn', '⚠️ 주의'], 'fail' => ['fail', '⛔ 위험'], 'info' => ['', 'ℹ️ 정보'], 'alert' => ['fail', '🚨 경고']];
    $m = isset($map[$status]) ? $map[$status] : ['', $status];
    return '<span class="badge ' . $m[0] . '">' . e($m[1]) . '</span>';
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
/** an address with its last part hidden: 203.0.113.• / 2001:db8:1:• (the full address stays in the database) */
function maskIp(string $ip): string
{
    $n = Http::normIp($ip);
    if ($n === '') return $ip === '' ? '-' : '•';
    if (strpos($n, ':') === false) { $p = explode('.', $n); return $p[0] . '.' . $p[1] . '.' . $p[2] . '.•'; }
    $p = explode(':', $n);
    return implode(':', array_slice($p, 0, 3)) . ':•';
}
function modeLabel(string $mode): string { $m = ['off' => '꺼짐', 'optional' => '선택(등록 권장)', 'required' => '필수']; return isset($m[$mode]) ? $m[$mode] : $mode; }

// =============================================================================== the gate (before any session)
function gateRequest(): void
{
    // 1. only the folder and its index.php are pages: index.php/anything is a missing page
    $pi = isset($_SERVER['PATH_INFO']) && is_string($_SERVER['PATH_INFO']) ? $_SERVER['PATH_INFO'] : '';
    if ($pi !== '' && $pi !== '/') AdminGate::notFound();
    // 2. the IP allow-list: the same 404 as a missing page, nothing else (CONTRACT §15.4 (b))
    if (!AdminGate::ipAllowed(Http::clientIp())) {
        if (class_exists('Tfm\SecEvent')) SecEvent::log('admin_ip_denied', 'warn', ['method' => substr(Http::method(), 0, 10)]);
        if (class_exists('Tfm\Firewall')) Firewall::noteAttack('admin_ip_denied');
        AdminGate::notFound();
    }
    // the folder without its trailing slash: relative links need the slash (Apache's mod_dir does this on its own)
    $uri = (string) (isset($_SERVER['REQUEST_URI']) ? $_SERVER['REQUEST_URI'] : '');
    $path = rawurldecode((string) strtok($uri, '?'));
    $folder = AdminGate::folderPath();
    if ($path !== '' && $path === rtrim($folder, '/') && in_array(Http::method(), ['GET', 'HEAD'], true)) {
        while (ob_get_level() > 0) ob_end_clean();
        header_remove('Set-Cookie');
        AdminGate::headers();
        $qs = (string) (isset($_SERVER['QUERY_STRING']) ? $_SERVER['QUERY_STRING'] : '');
        header('Location: ' . $folder . ($qs !== '' ? '?' . str_replace(["\r", "\n"], '', $qs) : ''), true, 301);
        exit;
    }
    // 3. a blocked address, plain http where https is required, a file: refused before the session starts
    if (class_exists('Tfm\Firewall')) Firewall::check();
    Http::enforceHttps();
    Http::refuseUpload(false);
    if (class_exists('Tfm\V')) V::watch($_GET, 'query');
}

/** the sign-in forms are limited by address: rate_limits.admin_login when configured, else rate_limits.login */
function signInLimit(): void
{
    $conf = Config::get('rate_limits.admin_login');
    RateLimit::hit(is_array($conf) ? 'admin_login' : 'login', 'ip:' . Sec::hashId(Http::clientIp()));
}

// =============================================================================== actions (POST → 303)
function handlePost(Ctx $c)
{
    Sec::checkOrigin(); // a cross-site form: 403 CROSS_SITE_REQUEST (+ origin_mismatch event)
    $action = postStr('action');
    $token = postStr('_csrf');
    $valid = Session::started() && Session::checkCsrf($token);
    // a visitor without a session signs in with the stateless token of the sign-in form (finding F9)
    if (!$valid && in_array($action, ['login', 'bootstrap'], true)) $valid = AdminGate::checkSignInToken($token);
    if (!$valid) {
        if (class_exists('Tfm\SecEvent')) SecEvent::log('csrf_fail', 'info', ['page' => 'admin', 'action' => mb_substr($action, 0, 24)]);
        throw new ApiException(403, 'CSRF_INVALID', '보안 토큰이 맞지 않아요. 화면을 새로 고친 뒤 다시 해 주세요.');
    }
    if ($action === 'login') doSignIn($c);
    if ($action === 'bootstrap') doBootstrap($c);
    if ($action === 'code') doCode($c);
    if ($action === 'logout') doSignOut($c);

    $elevated = AdminGate::check($c->user, true);
    $pending = AdminGate::pending($c->user);
    // the required mode: an admin without enrolment may only enrol (the password step is done, nothing else is open)
    if (!$elevated && $pending && $pending['need'] === 'enrol' && in_array($action, ['twofa_begin', 'twofa_confirm'], true)) doEnrol($c, $action, true);
    if (!$elevated) {
        if (!$c->user) throw new ApiException(401, 'AUTH_REQUIRED', '먼저 관리자 센터에 로그인해 주세요.');
        if (!$c->isAdmin()) {
            Audit::log('admin_denied', $c->uid(), ['action' => mb_substr($action, 0, 24)], 'warn');
            if (class_exists('Tfm\SecEvent')) SecEvent::log('admin_denied', 'warn', ['action' => mb_substr($action, 0, 24)], $c->uid());
            if (class_exists('Tfm\Firewall')) Firewall::noteAttack('admin_denied');
            throw new ApiException(403, 'FORBIDDEN', '관리자 권한이 필요해요.');
        }
        throw new ApiException(403, 'ADMIN_REAUTH', '관리자 센터에 다시 로그인해 주세요.');
    }
    if ($action === 'twofa_begin' || $action === 'twofa_confirm') doEnrol($c, $action, false);
    if ($action === 'twofa_backup') doBackup($c);

    $tab = tabParam(postStr('tab'));
    $back = ['q' => mb_substr(postStr('q'), 0, 60)];
    $admin = $c->user;
    $uid = (int) postStr('uid');
    try {
        switch ($action) {
            case 'role': $msg = AdminOps::setRole($admin, $uid, postStr('role')); break;
            case 'ban': $msg = AdminOps::setBanned($admin, $uid, true); break;
            case 'unban': $msg = AdminOps::setBanned($admin, $uid, false); break;
            case 'mute': $msg = AdminOps::mute($admin, $uid, (int) postStr('minutes')); break;
            case 'report': $msg = AdminOps::report($admin, (int) postStr('rid'), postStr('status')); break;
            case 'hide': $msg = AdminOps::hideMessage($admin, (int) postStr('mid'), true); break;
            case 'unhide': $msg = AdminOps::hideMessage($admin, (int) postStr('mid'), false); break;
            case 'restore': $msg = AdminOps::restoreBackup($admin, $uid); break;
            case 'cleanup': {
                $r = AdminOps::cleanup($admin);
                $parts = [];
                foreach ($r as $k => $v) $parts[] = "$k $v";
                $msg = '🧹 정리 완료 — ' . implode(' · ', $parts);
                break;
            }
            case 'sub_grant': {
                // the target may be typed as a user id, a nickname or an e-mail
                $who = trim(postStr('who'));
                if ($uid <= 0 && $who !== '') { $u = ctype_digit($who) ? Users::byId((int) $who) : Users::byLogin($who); if (!$u) throw new ApiException(404, 'NOT_FOUND', '그런 사용자를 찾을 수 없어요.'); $uid = (int) $u['id']; }
                $r = Subscription::grant($admin, $uid, (int) postStr('tier'), (int) postStr('days'));
                $msg = '⚡ ' . $r['message'];
                break;
            }
            case 'sub_revoke': { $r = Subscription::revoke($admin, $uid); $msg = $r['message']; break; }
            case 'sub_renew': {
                $results = Subscription::renewDue($uid > 0 ? $uid : null, postStr('force') === '1');
                Audit::log('sub_renew_run', $uid > 0 ? $uid : null, ['force' => postStr('force') === '1', 'count' => count($results), 'via' => 'admin'], 'info', (int) $admin['id']);
                $okN = 0;
                foreach ($results as $r) if (!empty($r['ok']) && empty($r['skipped'])) $okN++;
                $msg = '🔁 갱신 검사 ' . count($results) . '건 — 갱신 ' . $okN . '건';
                break;
            }
            case 'ip_block': $msg = doIpBlock($c); break;
            case 'ip_unblock': $msg = doIpUnblock($c); break;
            case 'twofa_disable': $msg = doDisable($c); break;
            default: throw new ApiException(400, 'UNKNOWN_ACTION', '알 수 없는 작업이에요.');
        }
        flash('ok', $msg);
    } catch (ApiException $e) {
        flash('error', $e->getMessage());
    }
    redirectTo($tab, $back);
}

/** the admin sign-in form: the shared throttled login, then the role, then the second step */
function doSignIn(Ctx $c)
{
    signInLimit();
    Session::start(true);
    // a new sign-in starts over: a waiting code step is forgotten (the cookie is left alone — a new one may follow)
    Session::set('adm', null);
    Session::set('adm_pending', null);
    $login = postStr('login');
    try {
        $u = Auth::attemptLogin($login, postStr('password'), false);
    } catch (ApiException $e) {
        flash('error', $e->getMessage());
        redirectTo('overview');
    }
    $c->user = $u;
    afterPassword($c, $u, $login, 'password', '');
}

/** the password is right: no admin → signed out again; an admin → elevated now, or the code / enrolment step */
function afterPassword(Ctx $c, array $u, string $login, string $via, string $prefix)
{
    $uid = (int) $u['id'];
    if ((isset($u['role']) ? $u['role'] : '') !== 'admin') {
        Audit::log('admin_denied', $uid, ['via' => 'admin sign-in'], 'warn');
        if (class_exists('Tfm\SecEvent')) SecEvent::log('admin_denied', 'warn', ['via' => 'admin sign-in'], $uid);
        if (class_exists('Tfm\Firewall')) Firewall::noteAttack('admin_denied');
        Session::logout();
        flash('error', '관리자 권한이 없는 계정이에요. 관리자 권한이 있는 계정으로 로그인해 주세요.');
        redirectTo('overview');
    }
    $mode = AdminTotp::mode();
    $on = AdminTotp::enabled($uid);
    if ($mode === 'off' || (!$on && $mode === 'optional')) {
        AdminGate::grant($u, $via);
        Audit::log('admin_signin', $uid, ['factor' => $via, 'mode' => $mode], 'info');
        flash('ok', $prefix . "👋 {$u['nickname']} 님, 관리자 센터에 오신 것을 환영해요.");
        redirectTo('overview');
    }
    if ($on) {
        AdminGate::setPending($u, 'code', $login);
        flash('ok', $prefix . '비밀번호를 확인했어요. 휴대폰 인증 앱에 보이는 6자리 숫자를 넣어 주세요.');
        redirectTo('overview');
    }
    // required, not enrolled yet: only the enrolment screen. The secret is made here — a GET never changes anything.
    if (AdminTotp::pendingSecret($uid) === null) AdminTotp::begin($uid);
    AdminGate::setPending($u, 'enrol', $login);
    flash('warn', $prefix . '이 서버는 관리자 2단계 인증이 꼭 필요해요. 아래 순서대로 휴대폰 인증 앱에 등록하면 관리자 센터가 열려요.');
    redirectTo('twofa');
}

/** the second step of the sign-in: a current code or an unused backup code */
function doCode(Ctx $c)
{
    $p = AdminGate::pending($c->user);
    if (!$p || $p['need'] !== 'code') {
        if (Session::started()) Session::set('adm_pending', null);
        flash('error', '로그인 단계가 끝났어요. 처음부터 다시 로그인해 주세요.');
        redirectTo('overview');
    }
    $code = trim(postStr('code'));
    if ($code === '') { flash('error', '인증 앱의 6자리 숫자나 백업 코드를 넣어 주세요.'); redirectTo('overview'); }
    $uid = $c->uid();
    $r = AdminTotp::attempt($uid, $code);
    if ($r === 'locked') {
        $w = max(1, (int) AdminTotp::failures($uid)['wait']);
        flash('error', '코드를 여러 번 틀려서 2단계 인증이 잠겼어요. ' . AdminTotp::waitText($w) . ' 기다린 뒤 다시 해 주세요. '
            . '직접 틀린 적이 없다면 누군가 비밀번호를 알고 있을 수 있어요: 체험관에서 비밀번호를 바꾸고, 서버 컴퓨터에서 '
            . 'php cli/tfm.php admin:2fa-unlock 이메일 을 실행하면 잠금이 바로 풀려요.');
        redirectTo('overview');
    }
    if ($r === 'fail') {
        LoginThrottle::record((string) $p['login'], false); // a wrong code counts for the password form too
        flash('error', '코드가 맞지 않아요. 인증 앱에 지금 보이는 숫자 6자리를 넣어 주세요 (이미 쓴 코드는 다시 쓸 수 없어요).');
        redirectTo('overview');
    }
    AdminGate::grant($c->user, $r);
    Audit::log('admin_signin', $uid, ['factor' => $r], 'info');
    flash($r === 'backup' ? 'warn' : 'ok', $r === 'backup' ? '백업 코드로 들어왔어요. 남은 백업 코드: ' . AdminTotp::backupLeft($uid) . '개 — 휴대폰을 찾으면 🔐 탭에서 새 코드를 만들어 두세요.' : "👋 {$c->user['nickname']} 님, 관리자 센터에 오신 것을 환영해요.");
    redirectTo('overview');
}

/** sign out of the admin site: the elevation ends and so does the login (a shared PC keeps nothing) */
function doSignOut(Ctx $c)
{
    if ($c->user) {
        Presence::remove($c->uid());
        Audit::log('admin_signout', $c->uid(), ['elevated' => AdminGate::check($c->user, false)], 'info');
    }
    AdminGate::revoke();
    Session::logout();
    flash('ok', '로그아웃했어요.');
    redirectTo('overview');
}

/** first admin (finding F4): only while no admin exists, with an account password and the one-time setup code */
function doBootstrap(Ctx $c)
{
    signInLimit();
    Session::start(true);
    Session::set('adm', null);
    Session::set('adm_pending', null);
    if (Users::adminExists()) { flash('error', '이미 관리자가 있어요. 그 관리자에게 권한을 받아 주세요.'); redirectTo('overview'); }
    $login = postStr('login');
    try {
        $u = Auth::attemptLogin($login, postStr('password'), false);
        $msg = AdminOps::bootstrap($u, postStr('setup_code'));
    } catch (ApiException $e) {
        flash('error', $e->getMessage());
        redirectTo('overview');
    }
    $fresh = Users::byId((int) $u['id']);
    if (!$fresh) throw new RuntimeException('user vanished');
    Session::refresh($fresh); // the role change bumped the account's session epoch: keep this login valid
    Auth::forget();
    $c->user = $fresh;
    afterPassword($c, $fresh, $login, 'setup', '🎉 ' . $msg . ' ');
}

/** 2-step enrolment: a new secret, or the confirmation with a current code (then the 10 backup codes, once) */
function doEnrol(Ctx $c, string $action, bool $enrolOnly)
{
    $uid = $c->uid();
    try {
        if ($action === 'twofa_begin') {
            AdminTotp::begin($uid);
            flash('ok', '새 비밀 키를 만들었어요. 아래 순서대로 인증 앱에 등록해 주세요.');
            redirectTo('twofa');
        }
        $codes = AdminTotp::confirm($uid, postStr('code'));
        if ($enrolOnly) {
            // the second factor is proven now: the required mode opens the admin site
            AdminGate::grant($c->user, 'enrol');
            Audit::log('admin_signin', $uid, ['factor' => 'enrol'], 'info');
        } elseif (method_exists('Tfm\Session', 'regenerate')) {
            Session::regenerate(); // a privilege step: new session id (CONTRACT §15.7 #12)
        }
        flashCodes($codes, '🔐 2단계 인증을 켰어요. 아래 백업 코드 10개를 지금 적어 두세요 — 이 화면을 떠나면 다시는 볼 수 없어요.');
    } catch (ApiException $e) {
        flash('error', $e->getMessage());
    }
    redirectTo('twofa');
}

/** the password + a current code (or backup code) again — for turning 2-step sign-in off and for new backup codes */
function reauth(Ctx $c): string
{
    $u = $c->user;
    $pw = postStr('password');
    $code = trim(postStr('code'));
    if ($pw === '' || $code === '') throw new ApiException(400, 'REAUTH_REQUIRED', '비밀번호와 인증 앱의 지금 숫자(또는 백업 코드)를 모두 넣어 주세요.');
    $key = mb_strtolower((string) ($u['email'] !== '' ? $u['email'] : $u['nickname']));
    $wait = LoginThrottle::check($key);
    if ($wait > 0) throw new ApiException(429, 'TOO_MANY_ATTEMPTS', "비밀번호를 여러 번 틀렸어요. {$wait}초 뒤에 다시 해 주세요.");
    if (!Users::verifyPassword($u, $pw)) {
        LoginThrottle::record($key, false);
        throw new ApiException(401, 'INVALID_CREDENTIALS', '비밀번호가 맞지 않아요.');
    }
    $r = AdminTotp::attempt($c->uid(), $code);
    if ($r === 'locked') throw new ApiException(429, 'TWOFA_LOCKED', '코드를 여러 번 틀려서 2단계 인증이 잠겼어요. ' . AdminTotp::waitText(max(1, (int) AdminTotp::failures($c->uid())['wait'])) . ' 기다린 뒤 다시 해 주세요.');
    if ($r === 'fail') throw new ApiException(400, 'TWOFA_CODE', '인증 코드가 맞지 않아요.');
    return $r;
}

function doBackup(Ctx $c)
{
    try {
        reauth($c);
        $codes = AdminTotp::regenerateBackup($c->uid(), $c->uid());
        flashCodes($codes, '🔑 새 백업 코드 10개를 만들었어요. 예전 백업 코드는 이제 쓸 수 없어요. 지금 적어 두세요.');
    } catch (ApiException $e) {
        flash('error', $e->getMessage());
    }
    redirectTo('twofa');
}

function doDisable(Ctx $c): string
{
    reauth($c);
    AdminTotp::disable($c->uid(), $c->uid());
    return AdminTotp::mode() === 'required' ? '2단계 인증을 껐어요. 이 서버는 2단계 인증이 필수라서 다음 로그인 때 다시 등록해야 해요.' : '2단계 인증을 껐어요. 다시 켜는 것을 권해요.';
}

/** block an address by hand (address or the hash of an event row) for some minutes */
function doIpBlock(Ctx $c): string
{
    if (!class_exists('Tfm\Firewall')) throw new ApiException(503, 'NOT_READY', '주소 차단 기능이 아직 준비 중이에요.');
    $ip = trim(postStr('ip'));
    $from = postStr('from_hash');
    if ($ip === '' && preg_match('/^[0-9a-f]{32}\z/', $from)) {
        $row = Db::one('SELECT ip FROM security_events WHERE ip_hash = ? ORDER BY id DESC LIMIT 1', [$from]);
        if (!$row) throw new ApiException(404, 'NOT_FOUND', '그 주소의 기록을 찾지 못했어요.');
        $ip = (string) $row['ip'];
    }
    $n = Http::normIp($ip);
    if ($n === '') throw new ApiException(400, 'INVALID_IP', '인터넷 주소(IP) 모양이 아니에요. 예: 203.0.113.7');
    if ($n === Http::normIp(Http::clientIp())) throw new ApiException(409, 'OWN_ADDRESS', '지금 관리자 센터를 쓰는 주소는 막을 수 없어요 (스스로 잠기게 돼요).');
    $minutes = (int) postStr('minutes');
    if ($minutes < 1 || $minutes > 525600) throw new ApiException(400, 'INVALID_MINUTES', '시간은 1분부터 1년(525600분) 사이로 적어 주세요.');
    $reason = mb_substr(trim(postStr('reason')), 0, 120);
    if ($reason === '') $reason = '관리자 수동 차단';
    Firewall::block($n, $minutes * 60, $reason, $c->uid());
    Audit::log('ip_block_manual', null, ['ip' => $n, 'minutes' => $minutes, 'reason' => $reason], 'warn', $c->uid());
    return '⛔ ' . maskIp($n) . ' 주소를 ' . $minutes . '분 동안 막았어요.';
}

function doIpUnblock(Ctx $c): string
{
    if (!class_exists('Tfm\Firewall')) throw new ApiException(503, 'NOT_READY', '주소 차단 기능이 아직 준비 중이에요.');
    $h = postStr('ip_hash');
    if (!preg_match('/^[0-9a-f]{32}\z/', $h)) throw new ApiException(400, 'INVALID_INPUT', '풀 주소를 고르지 못했어요. 목록에서 다시 눌러 주세요.');
    if (!Firewall::unblock($h, $c->uid())) throw new ApiException(404, 'NOT_BLOCKED', '지금 막혀 있는 주소가 아니에요.');
    Audit::log('ip_unblock_manual', null, ['ip_hash' => $h], 'warn', $c->uid());
    return '✅ 차단을 풀었어요.';
}

// =============================================================================== sign-in, code and enrolment screens
function viewSignIn(Ctx $c): string
{
    $token = Session::started() ? Session::csrf() : AdminGate::signInToken();
    $h = '<section class="card narrow hero"><div class="mascot" aria-hidden="true">🏺</div><h2>관리자 로그인</h2>'
        . '<p class="dim">체험관과 같은 계정으로 로그인해요. 비밀번호를 5번 틀리면 잠시 잠겨요.</p>';
    if ($c->user) $h .= '<p class="notice">체험관에는 이미 로그인되어 있어요. 관리자 센터는 안전을 위해 비밀번호를 한 번 더 확인해요.</p>';
    $h .= '<form method="post" action="./" class="stack">' . tokenField($token) . '<input type="hidden" name="action" value="login">'
        . '<label>아이디(닉네임) 또는 이메일<input name="login" autocomplete="username" required maxlength="120"></label>'
        . '<label>비밀번호<input type="password" name="password" autocomplete="current-password" required maxlength="128"></label>'
        . '<button class="btn primary" type="submit">🔐 로그인</button></form>';
    if (!Users::adminExists() && Config::get('security.allow_localhost_bootstrap', true) && class_exists('Tfm\SetupCode')) {
        try { SetupCode::ensure(); } catch (\Throwable $e) { Log::warn('ADMIN', 'setup code not created: ' . get_class($e)); }
        $h .= '<details class="boot"><summary>🌱 아직 관리자가 없어요 — 첫 관리자 지정</summary>'
            . '<p class="dim small">체험관 계정 하나를 첫 관리자로 정해요. 이 서버의 주인인지 확인하려고 <b>설치 코드</b>가 필요해요. 인터넷의 다른 사람은 이 코드를 볼 수 없어요. 서버 컴퓨터에서 다음 중 하나로 확인하세요:</p>'
            . '<ol class="todo small"><li>명령 프롬프트에서 <code>php cli/tfm.php setup-code</code> (XAMPP: <code>C:\\xampp\\php\\php.exe cli\\tfm.php setup-code</code>)</li>'
            . '<li>또는 데이터 폴더의 <code>setup-code.php</code> 파일을 메모장으로 열기 (맨 위 줄에 코드가 있어요)</li></ol>'
            . '<form method="post" action="./" class="stack">' . tokenField($token) . '<input type="hidden" name="action" value="bootstrap">'
            . '<label>체험관 계정 (닉네임 또는 이메일)<input name="login" autocomplete="username" required maxlength="120"></label>'
            . '<label>그 계정의 비밀번호<input type="password" name="password" autocomplete="current-password" required maxlength="128"></label>'
            . '<label>설치 코드 (12자리, 예: ABCD-EFGH-JKMN)<input name="setup_code" required maxlength="40" autocomplete="off" spellcheck="false"></label>'
            . '<button class="btn gold" type="submit">👑 이 계정을 첫 관리자로 지정</button></form></details>';
    }
    return $h . '</section>';
}

function viewCode(Ctx $c): string
{
    return '<section class="card narrow hero"><div class="mascot" aria-hidden="true">📱</div><h2>2단계 인증</h2>'
        . '<p class="dim">휴대폰 인증 앱(Google Authenticator · Microsoft Authenticator 같은 앱)에 보이는 <b>6자리 숫자</b>를 넣어 주세요. 숫자는 30초마다 바뀌어요.</p>'
        . '<form method="post" action="./" class="stack">' . csrfField() . '<input type="hidden" name="action" value="code">'
        . '<label>인증 코드<input name="code" inputmode="numeric" autocomplete="one-time-code" required maxlength="20" autofocus></label>'
        . '<button class="btn primary" type="submit">확인</button></form>'
        . '<p class="dim small">휴대폰을 잃어버렸으면 2단계 인증을 켤 때 적어 둔 <b>백업 코드</b>(예: abcd-efgh)를 넣으세요. 백업 코드도 없으면 서버 컴퓨터에서 <code>php cli/tfm.php admin:2fa-reset 이메일</code> 로 초기화할 수 있어요.</p>'
        . '<div class="row">' . actionForm('logout', '처음으로 돌아가기 (로그아웃)', [], 'btn ghost', 'overview') . '</div></section>';
}

/** the enrolment steps: the secret as grouped text + the otpauth:// URI as text, then the confirmation */
function enrolSteps(Ctx $c): string
{
    $uid = $c->uid();
    $secret = AdminTotp::pendingSecret($uid);
    if ($secret === null) {
        return '<p>휴대폰 인증 앱을 쓰면 비밀번호가 새어 나가도 그 휴대폰 없이는 관리자 센터에 들어올 수 없어요.</p>'
            . '<div class="row">' . actionForm('twofa_begin', '🔐 2단계 인증 켜기 (새 비밀 키 받기)', [], 'btn primary', 'twofa') . '</div>';
    }
    $issuer = (string) Config::get('app.name', '전통발효체험관 메타버스');
    $uri = Totp::uri($secret, (string) $c->user['nickname'], $issuer);
    return '<ol class="steps">'
        . '<li><b>휴대폰에 인증 앱을 설치</b>해요 (Google Authenticator, Microsoft Authenticator 등 아무거나).</li>'
        . '<li>앱에서 <b>＋ → "설정 키 입력"</b>을 고르고, 계정 이름은 <b>' . e($c->user['nickname']) . '</b>, 키는 아래 글자를 그대로 넣어요 (띄어쓰기는 넣어도 되고 빼도 돼요).'
        . '<p class="secretbox"><code class="secret">' . e(Totp::grouped($secret)) . '</code></p>'
        . '<p class="dim small">컴퓨터의 인증 프로그램을 쓰면 아래 주소 전체를 복사해 붙여 넣어도 돼요.</p><p class="uri"><code>' . e($uri) . '</code></p></li>'
        . '<li>앱에 생긴 <b>6자리 숫자</b>를 아래 칸에 넣고 확인을 눌러요.</li></ol>'
        . '<form method="post" action="./" class="stack">' . csrfField() . '<input type="hidden" name="action" value="twofa_confirm"><input type="hidden" name="tab" value="twofa">'
        . '<label>지금 보이는 6자리 숫자<input name="code" inputmode="numeric" autocomplete="one-time-code" required maxlength="20"></label>'
        . '<button class="btn primary" type="submit">✅ 확인하고 켜기</button></form>'
        . '<p class="dim small">키를 잘못 넣었거나 처음부터 다시 하고 싶으면:</p><div class="row">' . actionForm('twofa_begin', '새 비밀 키 받기', [], 'btn ghost', 'twofa') . '</div>';
}

/** required mode, not enrolled: the only screen this admin can reach (no tabs, no "?tab=" links) */
function viewEnrolOnly(Ctx $c): string
{
    return '<section class="card narrow"><h2>🔐 2단계 인증 등록</h2>'
        . '<p class="dim">이 서버는 관리자에게 <b>휴대폰 인증 앱</b>(2단계 인증)이 꼭 필요해요. 등록을 마치면 관리자 센터가 열려요.</p>'
        . enrolSteps($c)
        . '<div class="row">' . actionForm('logout', '처음으로 돌아가기 (로그아웃)', [], 'btn ghost', 'overview') . '</div></section>';
}

/** the backup codes of a confirmation / renewal — on this page only */
function viewCodes(array $codes): string
{
    $h = '<section class="card codes"><h3>🔑 백업 코드 10개 — 지금 한 번만 보여요</h3>'
        . '<p class="dim">휴대폰을 잃어버렸을 때 6자리 숫자 대신 쓰는 코드예요. 하나는 한 번만 쓸 수 있어요. 종이에 적어 안전한 곳에 두세요 (이 화면을 떠나면 다시 볼 수 없어요).</p><ol class="bklist">';
    foreach ($codes as $code) $h .= '<li><code class="bk">' . e($code) . '</code></li>';
    return $h . '</ol></section>';
}

// =============================================================================== tabs
function viewOverview(): string
{
    $s = Stats::collect();
    $tiles = [
        ['👥', '가입자', $s['users']], ['🟢', '접속 중', $s['online']], ['🆕', '오늘 가입', $s['usersToday']], ['🧒', '오늘 체험', $s['activeToday']],
        ['💾', '저장 데이터', $s['saves']], ['🚨', '열린 신고', $s['chatReports']], ['🛡️', '오늘 거부된 저장', $s['rejectedSavesToday']], ['⛔', '정지 계정', $s['bannedUsers']],
        ['⚡', '구독 이용 중', $s['subsActive']], ['💳', '오늘 결제', $s['ordersToday']], ['🏆', '퀘스트 완료', $s['questCompletions']], ['🌾', '수확', $s['harvests']],
        ['🏺', '발효 수령', $s['ferments']], ['📝', '작업일지', $s['journals']], ['📷', '업로드 사진', $s['uploads']], ['💬', '채팅(24시간)', $s['chatMessages']],
    ];
    if (class_exists('Tfm\SecEvent')) {
        $sec = 0;
        foreach (SecEvent::counts(Clock::startOfDayMs()) as $n) $sec += (int) $n;
        $tiles[] = ['🛡️', '오늘 보안 기록', $sec];
    }
    $h = '<div class="tiles">';
    foreach ($tiles as $i => $t) $h .= '<div class="tile d' . ($i % 7) . '"><span class="ico" aria-hidden="true">' . $t[0] . '</span><b>' . e(num($t[2])) . '</b><small>' . e($t[1]) . '</small></div>';
    $h .= '</div><div class="grid2">';
    $max = max(1, max(array_values($s['levels'])));
    $h .= '<section class="card"><h3>⭐ 레벨 분포</h3>';
    foreach ($s['levels'] as $k => $n) $h .= '<div class="barrow"><span>' . e($k) . '</span><meter min="0" max="' . e($max) . '" value="' . e($n) . '"></meter><b>' . e(num($n)) . '</b></div>';
    $h .= '</section><section class="card"><h3>🗺️ 지금 어느 구역에 있나요?</h3>';
    if (!$s['zones']) $h .= '<p class="empty">🍃 지금 접속 중인 체험객이 없어요.</p>';
    else { $zmax = max($s['zones']); foreach ($s['zones'] as $z => $n) $h .= '<div class="barrow"><span>' . e($z) . '</span><meter min="0" max="' . e($zmax) . '" value="' . e($n) . '"></meter><b>' . e($n) . '</b></div>'; }
    $h .= '</section></div>';
    $hc = Health::collect(false, null, false);
    $h .= '<section class="card"><h3>🩺 시스템 점검 요약 ' . badge($hc['status']) . '</h3><p class="dim">정상 ' . e($hc['summary']['ok']) . ' · 주의 ' . e($hc['summary']['warn']) . ' · 위험 ' . e($hc['summary']['fail']) . ' — <a href="./?tab=health">자세히 보기 (보안 설정 점검 포함) →</a></p>';
    $bad = array_filter($hc['checks'], function ($x) { return $x['status'] !== 'ok'; });
    if ($bad) { $h .= '<ul class="checklist">'; foreach (array_slice($bad, 0, 6) as $x) $h .= '<li>' . badge($x['status']) . ' <b>' . e($x['label']) . '</b> <span class="dim">' . e($x['hint'] !== '' ? $x['hint'] : $x['value']) . '</span></li>'; $h .= '</ul>'; }
    $h .= '</section><div class="grid2"><section class="card"><h3>🆕 최근 가입</h3>' . table(['닉네임', '권한', '레벨', '상태', '가입', '마지막 접속'], array_map(function ($r) { return [$r['nickname'], $r['role'], 'Lv.' . $r['level'], $r['status'], $r['joined'], $r['lastLogin']]; }, $s['recentUsers'])) . '</section>';
    $h .= '<section class="card"><h3>📜 최근 감사 로그</h3>' . table(['이벤트', '등급', '대상', '시각'], array_map(function ($r) { return [$r['event'], $r['severity'], $r['user'], $r['at']]; }, $s['recentAudit'])) . '</section></div>';
    return $h;
}

function viewHealth(): string
{
    $hc = Health::collect(true, AdminGate::htaccessSeen());
    $groups = ['adminlock' => '🔐 관리자 페이지 잠금', 'config' => '🧾 보안 설정', 'dbacct' => '🗄️ DB 계정', 'security' => '🛡️ 보안', 'php' => '🐘 PHP',
        'db' => '🗃️ 데이터베이스', 'files' => '📁 파일·폴더', 'server' => '🖥️ 웹 서버', 'app' => '🏺 체험관'];
    $h = '<section class="card"><h3>🩺 종합 상태 ' . badge($hc['status']) . '</h3><p class="dim">PHP ' . e($hc['php']['version']) . ' (' . e($hc['php']['sapi']) . ', ' . e($hc['php']['os']) . ', ' . e($hc['php']['bits']) . '비트) · 앱 v' . e($hc['app']['version']) . ' · ' . e(when($hc['generatedAt'])) . '</p>'
        . '<p class="dim small">⛔ 위험은 바로 고쳐야 하는 것, ⚠️ 주의는 고치면 더 안전해지는 것이에요. 바꾼 뒤 이 화면을 새로 고치면 다시 점검해요.</p></section>';
    foreach ($groups as $g => $title) {
        $rows = array_filter($hc['checks'], function ($x) use ($g) { return $x['group'] === $g; });
        if (!$rows) continue;
        $h .= '<section class="card"><h3>' . e($title) . '</h3><div class="tablewrap"><table><thead><tr><th>항목</th><th>상태</th><th>값</th><th>안내</th></tr></thead><tbody>';
        foreach ($rows as $x) $h .= '<tr><td><b>' . e($x['label']) . '</b></td><td>' . badge($x['status']) . '</td><td>' . e(is_scalar($x['value']) ? $x['value'] : json_encode($x['value'], JSON_UNESCAPED_UNICODE)) . '</td><td class="dim">' . e($x['hint']) . '</td></tr>';
        $h .= '</tbody></table></div></section>';
    }
    return $h;
}

function viewUsers(): string
{
    $q = mb_substr(trim(getStr('q')), 0, 60);
    $page = max(0, min(10000, (int) (ctype_digit(getStr('p')) ? getStr('p') : 0)));
    $where = '';
    $params = [];
    if ($q !== '') {
        // '!' as LIKE escape character: portable (a backslash literal means different things in SQLite and MySQL)
        $like = '%' . str_replace(['!', '%', '_'], ['!!', '!%', '!_'], mb_strtolower($q)) . '%';
        $where = "WHERE u.nickname_key LIKE ? ESCAPE '!' OR u.email LIKE ? ESCAPE '!'";
        $params = [$like, $like];
    }
    $rows = Db::all("SELECT u.id, u.email, u.nickname, u.role, u.status, u.muted_until, u.created_at, u.last_login_at, p.level, p.exp_total, p.coin,
        (SELECT s.backup_saved_at FROM player_saves s WHERE s.user_id = u.id) AS backup_at, (SELECT s.rejects FROM player_saves s WHERE s.user_id = u.id) AS rejects,
        (SELECT b.tier FROM subscriptions b WHERE b.user_id = u.id AND b.status IN ('active', 'past_due') AND b.expires_at > ?) AS sub_tier
        FROM users u LEFT JOIN user_profiles p ON p.user_id = u.id $where ORDER BY u.id DESC LIMIT 51 OFFSET " . ($page * 50), array_merge([Clock::ms()], $params));
    $more = count($rows) > 50;
    $rows = array_slice($rows, 0, 50);
    $now = Clock::ms();
    $h = '<section class="card"><form method="get" action="./" class="search"><input type="hidden" name="tab" value="users"><input name="q" value="' . e($q) . '" placeholder="닉네임 또는 이메일 검색" maxlength="60"><button class="btn" type="submit">🔎 검색</button></form>';
    if (!$rows) return $h . '<p class="empty">🍃 사용자가 없어요.</p></section>';
    $h .= '<div class="tablewrap"><table><thead><tr><th>#</th><th>닉네임</th><th>이메일</th><th>권한</th><th>상태</th><th>레벨</th><th>코인</th><th>속도</th><th>저장 거부</th><th>가입</th><th>마지막 접속</th><th>관리</th></tr></thead><tbody>';
    foreach ($rows as $r) {
        $uid = (int) $r['id'];
        $muted = (int) $r['muted_until'] > $now;
        $acts = '<details class="acts"><summary>⚙️ 관리</summary><div class="actgrid">'
            . ($r['role'] === 'admin' ? actionForm('role', '관리자 해제', ['uid' => $uid, 'role' => 'user', 'q' => $q], 'btn ghost', 'users') : actionForm('role', '👑 관리자 지정', ['uid' => $uid, 'role' => 'admin', 'q' => $q], 'btn gold', 'users'))
            . ($r['status'] === 'banned' ? actionForm('unban', '정지 해제', ['uid' => $uid, 'q' => $q], 'btn', 'users') : actionForm('ban', '⛔ 이용 정지', ['uid' => $uid, 'q' => $q], 'btn danger', 'users'))
            . ($muted ? actionForm('mute', '채팅 제한 해제', ['uid' => $uid, 'minutes' => 0, 'q' => $q], 'btn', 'users') : actionForm('mute', '🔇 채팅 1시간 제한', ['uid' => $uid, 'minutes' => 60, 'q' => $q], 'btn ghost', 'users') . actionForm('mute', '🔇 채팅 하루 제한', ['uid' => $uid, 'minutes' => 1440, 'q' => $q], 'btn ghost', 'users'))
            . ((int) $r['backup_at'] > 0 ? actionForm('restore', '↩️ 직전 저장으로 되돌리기', ['uid' => $uid, 'q' => $q], 'btn ghost', 'users') : '')
            . '<a class="btn ghost" href="' . e(href(['tab' => 'sub', 'uid' => $uid])) . '">⚡ 구독 관리</a>'
            . '</div></details>';
        $h .= '<tr><td>' . $uid . '</td><td><b>' . e($r['nickname']) . '</b></td><td>' . e($r['email']) . '</td><td>' . ($r['role'] === 'admin' ? '<span class="badge gold">관리자</span>' : '사용자') . '</td><td>'
            . ($r['status'] === 'banned' ? '<span class="badge fail">정지</span>' : ($muted ? '<span class="badge warn">채팅 제한</span>' : '<span class="badge ok">정상</span>'))
            . '</td><td>Lv.' . e(isset($r['level']) ? $r['level'] : 1) . '</td><td>' . e(num(isset($r['coin']) ? $r['coin'] : 0)) . '</td><td>' . ((int) $r['sub_tier'] > 1 ? '<span class="badge gold">⚡' . (int) $r['sub_tier'] . '배</span>' : '기본') . '</td><td>' . e(num(isset($r['rejects']) ? $r['rejects'] : 0)) . '</td><td>' . e(when($r['created_at'])) . '</td><td>' . e(when($r['last_login_at'])) . '</td><td>' . $acts . '</td></tr>';
    }
    $h .= '</tbody></table></div><div class="row">';
    if ($page > 0) $h .= '<a class="btn ghost" href="' . e(href(['tab' => 'users', 'q' => $q, 'p' => $page - 1])) . '">← 이전</a>';
    if ($more) $h .= '<a class="btn ghost" href="' . e(href(['tab' => 'users', 'q' => $q, 'p' => $page + 1])) . '">다음 →</a>';
    return $h . '</div></section>';
}

function viewSub(): string
{
    $now = Clock::ms();
    $pre = ctype_digit(getStr('uid')) ? (int) getStr('uid') : 0;
    $tiers = Toss::tiers();
    $h = '<div class="grid2"><section class="card"><h3>⚡ 수동 부여</h3><p class="dim small">학교·행사용으로 결제 없이 진행 속도 단계를 줄 수 있어요. 기존 기간이 남아 있으면 그 뒤에 이어 붙고, 단계가 다르면 지금부터 새로 시작해요. 감사 로그에 남아요.</p>'
        . '<form method="post" action="./" class="stack">' . csrfField() . '<input type="hidden" name="action" value="sub_grant"><input type="hidden" name="tab" value="sub">'
        . '<label>사용자 (번호 · 닉네임 · 이메일)<input name="who" value="' . ($pre ? e($pre) : '') . '" required maxlength="120"></label>'
        . '<label>단계<select name="tier">';
    foreach ($tiers as $t => $v) $h .= '<option value="' . e($t) . '">' . e($v['name']) . ' (' . e(num($v['price'])) . '원/월 상당)</option>';
    $h .= '</select></label><label>기간(일)<input name="days" value="30" inputmode="numeric" maxlength="4"></label><button class="btn primary" type="submit">⚡ 부여하기</button></form></section>';
    $h .= '<section class="card"><h3>💳 결제 설정</h3><p class="dim">모드: <b>' . (Toss::mock() ? '모의 결제(mock)' : (Toss::liveKeys() ? '실결제(live)' : (Toss::keysConfigured() ? '가맹점 테스트 키' : '설정 필요'))) . '</b> · 이용 기간 ' . e(Toss::periodDays()) . '일 · 유예 ' . e(Toss::graceDays()) . '일</p><ul class="checklist">';
    foreach ($tiers as $t => $v) $h .= '<li><b>' . e($v['name']) . '</b> <span class="dim">' . e(num($v['price'])) . '원 / ' . e(Toss::periodDays()) . '일</span></li>';
    $h .= '</ul><p class="dim small">가격·키는 config/config.local.php 의 <code>toss</code> 항목이나 환경 변수(TFM_TOSS_*)로 바꿔요. 웹훅 주소: <code>' . e(Http::baseUrl()) . 'api/sub/webhook.php</code></p>'
        . '<div class="row">' . actionForm('sub_renew', '🔁 지금 갱신 검사 실행', [], 'btn ghost', 'sub') . '</div><p class="dim small">하루 한 번 자동으로 돌리려면 Windows 작업 스케줄러에 <code>php.exe cli\\tfm.php sub:renew</code> 를 등록하세요.</p></section></div>';
    $subs = Subscription::listAll(200);
    $h .= '<section class="card"><h3>👥 구독 현황 (' . count($subs) . ')</h3>';
    if (!$subs) $h .= '<p class="empty">🍃 아직 구독이 없어요.</p>';
    else {
        $h .= '<div class="tablewrap"><table><thead><tr><th>#</th><th>닉네임</th><th>단계</th><th>상태</th><th>만료</th><th>자동 갱신</th><th>마지막 주문</th><th>처리</th></tr></thead><tbody>';
        foreach ($subs as $s) {
            $live = in_array((string) $s['status'], ['active', 'past_due'], true) && (int) $s['expires_at'] + Toss::graceDays() * 86400000 > $now;
            $acts = '<details class="acts"><summary>⚙️ 처리</summary><div class="actgrid">'
                . ($live ? actionForm('sub_revoke', '⛔ 해지 (기본 속도로)', ['uid' => (int) $s['user_id']], 'btn danger', 'sub') : '')
                . ((int) $s['auto_renew'] === 1 ? actionForm('sub_renew', '🔁 지금 갱신 시도', ['uid' => (int) $s['user_id'], 'force' => 1], 'btn ghost', 'sub') : '')
                . '<a class="btn ghost" href="' . e(href(['tab' => 'sub', 'uid' => (int) $s['user_id']])) . '">⚡ 부여/연장</a></div></details>';
            $h .= '<tr><td>' . (int) $s['user_id'] . '</td><td><b>' . e($s['nickname']) . '</b><br><span class="dim small">' . e($s['email']) . '</span></td><td>' . ($live ? '<span class="badge gold">⚡' . (int) $s['tier'] . '배</span>' : '기본') . '</td><td>' . e(isset(SUB_STATUS[$s['status']]) ? SUB_STATUS[$s['status']] : $s['status']) . '</td><td>' . e(when($s['expires_at'])) . '</td><td>' . ((int) $s['auto_renew'] === 1 ? '켬' : '꺼짐') . '</td><td class="small">' . e($s['last_order_id']) . '</td><td>' . $acts . '</td></tr>';
        }
        $h .= '</tbody></table></div>';
    }
    $h .= '</section>';
    $orders = Subscription::listOrders(100);
    $h .= '<section class="card"><h3>🧾 주문 (최근 100)</h3>';
    if (!$orders) return $h . '<p class="empty">🍃 주문이 없어요.</p></section>';
    $h .= '<div class="tablewrap"><table><thead><tr><th>주문 번호</th><th>사용자</th><th>단계</th><th>금액</th><th>종류</th><th>상태</th><th>수단</th><th>토스 상태</th><th>요청</th><th>승인</th><th>영수증</th></tr></thead><tbody>';
    foreach ($orders as $o) {
        $receipt = (string) $o['receipt_url'];
        $okUrl = preg_match('#^https://[a-z0-9.\-]+\.tosspayments\.com/#i', $receipt) === 1;
        $h .= '<tr><td class="small">' . e($o['order_id']) . '</td><td>' . e(isset($o['nickname']) ? $o['nickname'] : '#' . $o['user_id']) . '</td><td>' . (int) $o['tier'] . '배</td><td>' . e(num($o['amount'])) . '원</td><td>' . e(isset(ORDER_KIND[$o['kind']]) ? ORDER_KIND[$o['kind']] : $o['kind']) . '</td><td>' . e(isset(ORDER_STATUS[$o['status']]) ? ORDER_STATUS[$o['status']] : $o['status']) . '</td><td>' . e($o['method']) . '</td><td>' . e($o['toss_status']) . '</td><td>' . e(when($o['requested_at'])) . '</td><td>' . e(when($o['approved_at'])) . '</td><td>' . ($okUrl ? '<a href="' . e($receipt) . '" rel="noopener noreferrer">보기</a>' : '-') . '</td></tr>';
    }
    return $h . '</tbody></table></div></section>';
}

function viewModeration(): string
{
    $all = getStr('show') === 'all';
    $reports = Db::all('SELECT r.*, ru.nickname AS reporter, m.hidden AS msg_hidden FROM chat_reports r LEFT JOIN users ru ON ru.id = r.reporter_id LEFT JOIN chat_messages m ON m.id = r.message_id '
        . ($all ? '' : "WHERE r.status = 'open' ") . "ORDER BY CASE WHEN r.status = 'open' AND r.reason = 'kid' THEN 0 ELSE 1 END, r.id DESC LIMIT 100"); // open child reports first
    $h = '<section class="card"><h3>🚨 신고 ' . ($all ? '(전체)' : '(처리 대기)') . '</h3><p class="row"><a class="btn ghost" href="' . e(href(['tab' => 'moderation', 'show' => $all ? '' : 'all'])) . '">' . ($all ? '처리 대기만 보기' : '전체 보기') . '</a></p>';
    if (!$reports) $h .= '<p class="empty">🎉 처리할 신고가 없어요.</p>';
    else {
        $h .= '<div class="tablewrap"><table><thead><tr><th>#</th><th>대상</th><th>사유</th><th>메시지</th><th>메모</th><th>신고자</th><th>시각</th><th>상태</th><th>처리</th></tr></thead><tbody>';
        $statusKo = ['open' => '대기', 'resolved' => '완료', 'dismissed' => '기각'];
        foreach ($reports as $r) {
            $tid = (int) (isset($r['target_user_id']) ? $r['target_user_id'] : 0);
            $acts = '<details class="acts"><summary>⚙️ 처리</summary><div class="actgrid">'
                . ($r['status'] === 'open' ? actionForm('report', '✅ 처리 완료', ['rid' => $r['id'], 'status' => 'resolved'], 'btn', 'moderation') . actionForm('report', '기각', ['rid' => $r['id'], 'status' => 'dismissed'], 'btn ghost', 'moderation') : actionForm('report', '다시 열기', ['rid' => $r['id'], 'status' => 'open'], 'btn ghost', 'moderation'))
                . ($r['message_id'] ? ((int) $r['msg_hidden'] ? actionForm('unhide', '메시지 다시 보이기', ['mid' => $r['message_id']], 'btn ghost', 'moderation') : actionForm('hide', '🙈 메시지 숨기기', ['mid' => $r['message_id']], 'btn', 'moderation')) : '')
                . ($tid ? actionForm('mute', '🔇 대상 채팅 1시간 제한', ['uid' => $tid, 'minutes' => 60], 'btn ghost', 'moderation') . actionForm('ban', '⛔ 대상 이용 정지', ['uid' => $tid], 'btn danger', 'moderation') : '')
                . '</div></details>';
            $h .= '<tr><td>' . (int) $r['id'] . '</td><td><b>' . e($r['target_name']) . '</b></td><td>' . e(isset(REASONS[$r['reason']]) ? REASONS[$r['reason']] : $r['reason']) . '</td><td class="msg">' . e($r['message_text']) . ((int) (isset($r['msg_hidden']) ? $r['msg_hidden'] : 0) ? ' <span class="badge warn">숨김</span>' : '') . '</td><td class="dim memo">' . e($r['memo']) . '</td><td>' . e(isset($r['reporter']) ? $r['reporter'] : '-') . '</td><td>' . e(when($r['created_at'])) . '</td><td>' . e(isset($statusKo[$r['status']]) ? $statusKo[$r['status']] : $r['status']) . '</td><td>' . $acts . '</td></tr>';
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

/** 🛡️ — suspicious activity (CONTRACT §15.7 #5): today's counts, the events with filters, blocked addresses, admin sign-ins, 2-step state */
function viewSecurity(Ctx $c): string
{
    $h = '';
    if (!class_exists('Tfm\SecEvent') || !class_exists('Tfm\Firewall')) {
        $h .= '<section class="card"><h3>🛡️ 오늘의 수상한 활동</h3><p class="notice">수상한 활동 기록과 주소 차단 기능은 아직 준비 중이에요 (lib/SecurityEvents.php). 아래의 관리자 로그인 기록과 2단계 인증 상태는 지금도 볼 수 있어요.</p></section>';
    } else {
        $now = Clock::ms();
        $today = SecEvent::counts(Clock::startOfDayMs());
        $h .= '<section class="card"><h3>📈 오늘 기록된 수상한 활동</h3>';
        if (!$today) $h .= '<p class="empty">🎉 오늘은 기록된 수상한 활동이 없어요.</p>';
        else {
            $h .= '<div class="tiles">';
            foreach ($today as $k => $n) $h .= '<div class="tile"><b>' . e(num($n)) . '</b><small><code>' . e($k) . '</code> ' . e(isset(KIND_KO[$k]) ? KIND_KO[$k] : '') . '</small></div>';
            $h .= '</div>';
        }
        $h .= '<p class="dim small">한 주소에서 짧은 시간에 수상한 요청이 많이 오면 그 주소는 저절로 잠시 막혀요 (서버 컴퓨터 자신은 막지 않아요).</p></section>';

        // filters: only values the page knows are used — anything else is ignored, never echoed
        $known = array_keys(SecEvent::counts(0));
        $kind = in_array(getStr('kind'), $known, true) ? getStr('kind') : '';
        $sev = in_array(getStr('sev'), ['info', 'warn', 'alert'], true) ? getStr('sev') : '';
        $since = isset(SINCE[getStr('since')]) ? getStr('since') : '7d';
        $ip = preg_match('/^[0-9a-f]{32}\z/', getStr('ip')) ? getStr('ip') : '';
        $page = ctype_digit(getStr('p')) ? min(1000, (int) getStr('p')) : 0;
        $rows = SecEvent::recent(['kind' => $kind, 'severity' => $sev, 'ipHash' => $ip, 'sinceMs' => $now - SINCE[$since][0] * 1000], 51, $page * 50);
        $more = count($rows) > 50;
        $rows = array_slice($rows, 0, 50);
        $base = ['tab' => 'security', 'kind' => $kind, 'sev' => $sev, 'since' => $since, 'ip' => $ip];
        $h .= '<section class="card"><h3>🔎 최근 기록</h3><form method="get" action="./" class="search"><input type="hidden" name="tab" value="security"><select name="kind"><option value="">모든 종류</option>';
        foreach ($known as $k) $h .= '<option value="' . e($k) . '"' . ($k === $kind ? ' selected' : '') . '>' . e($k . (isset(KIND_KO[$k]) ? ' · ' . KIND_KO[$k] : '')) . '</option>';
        $h .= '</select><select name="sev"><option value="">모든 등급</option>';
        foreach (['info' => '정보', 'warn' => '주의', 'alert' => '경고'] as $k => $v) $h .= '<option value="' . $k . '"' . ($k === $sev ? ' selected' : '') . '>' . $v . '</option>';
        $h .= '</select><select name="since">';
        foreach (SINCE as $k => $v) $h .= '<option value="' . $k . '"' . ($k === $since ? ' selected' : '') . '>최근 ' . e($v[1]) . '</option>';
        $h .= '</select>' . ($ip !== '' ? '<input type="hidden" name="ip" value="' . e($ip) . '">' : '') . '<button class="btn" type="submit">필터</button>'
            . ($ip !== '' || $kind !== '' || $sev !== '' ? '<a class="btn ghost" href="./?tab=security">모두 보기</a>' : '') . '</form>';
        if ($ip !== '') $h .= '<p class="dim small">한 주소(<code>' . e(substr($ip, 0, 12)) . '…</code>)의 기록만 보고 있어요.</p>';
        if (!$rows) $h .= '<p class="empty">🍃 조건에 맞는 기록이 없어요.</p>';
        else {
            $h .= '<div class="tablewrap"><table><thead><tr><th>시각</th><th>종류</th><th>등급</th><th>주소</th><th>위치</th><th>내용</th><th></th></tr></thead><tbody>';
            foreach ($rows as $r) {
                $d = isset($r['detailData']) && is_array($r['detailData']) ? $r['detailData'] : [];
                $detail = $d ? (string) json_encode($d, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PARTIAL_OUTPUT_ON_ERROR) : '';
                $path = (string) $r['path'];
                if ($path === 'admin.php') $path = '(예전 관리자 주소)';
                $hash = (string) $r['ip_hash'];
                $h .= '<tr class="ev"><td class="nowrap">' . e(whenSec($r['created_at'])) . '</td><td>' . e($r['kind']) . (isset(KIND_KO[$r['kind']]) ? '<br><span class="dim small">' . e(KIND_KO[$r['kind']]) . '</span>' : '') . '</td>'
                    . '<td>' . badge((string) $r['severity']) . '</td><td class="nowrap">' . e(maskIp((string) $r['ip'])) . ' <a class="hash" href="' . e(href(['tab' => 'security', 'ip' => $hash, 'since' => '90d'])) . '"><code>' . e(substr($hash, 0, 8)) . '</code></a></td>'
                    . '<td class="small">' . e($path) . '</td><td class="msg small">' . e(mb_substr($detail, 0, 160)) . '</td><td>'
                    . (preg_match('/^[0-9a-f]{32}\z/', $hash) ? actionForm('ip_block', '이 주소 1시간 차단', ['from_hash' => $hash, 'minutes' => 60, 'reason' => '기록에서 차단: ' . (string) $r['kind']], 'btn ghost sm', 'security') : '') . '</td></tr>';
            }
            $h .= '</tbody></table></div>';
        }
        $h .= '<div class="row">';
        if ($page > 0) $h .= '<a class="btn ghost" href="' . e(href($base + ['p' => $page - 1])) . '">← 이전</a>';
        if ($more) $h .= '<a class="btn ghost" href="' . e(href($base + ['p' => $page + 1])) . '">다음 →</a>';
        $h .= '</div><p class="dim small">주소는 끝자리를 가려서 보여 줘요. 같은 주소인지는 옆의 짧은 해시(지문)로 알 수 있고, 누르면 그 주소의 기록만 보여요. 보안 기록은 ' . e((int) Config::get('security.events_days', 90)) . '일 동안 보관돼요.</p></section>';

        // blocked addresses + a manual block
        $blocks = Firewall::listBlocks();
        $h .= '<div class="grid2"><section class="card"><h3>⛔ 막아 둔 주소 (' . count($blocks) . ')</h3>';
        if (!$blocks) $h .= '<p class="empty">🍃 지금 막혀 있는 주소가 없어요.</p>';
        else {
            $h .= '<div class="tablewrap"><table><thead><tr><th>주소</th><th>이유</th><th>풀리는 시각</th><th>막힌 접속</th><th></th></tr></thead><tbody>';
            foreach ($blocks as $b) {
                $h .= '<tr><td class="nowrap">' . e($b['ip']) . '</td><td class="msg">' . e($b['reason']) . ((int) $b['strikes'] > 1 ? ' <span class="badge warn">' . (int) $b['strikes'] . '번째</span>' : '') . '</td><td class="nowrap">' . e(when($b['until_at'])) . '</td><td>' . e(num($b['hits'])) . '</td><td>'
                    . actionForm('ip_unblock', '차단 해제', ['ip_hash' => (string) $b['ip_hash']], 'btn sm', 'security') . '</td></tr>';
            }
            $h .= '</tbody></table></div>';
        }
        $h .= '</section><section class="card"><h3>✋ 주소 직접 막기</h3><p class="dim small">계속 이상한 요청을 보내는 주소를 정한 시간 동안 막아요. 지금 관리자가 쓰는 주소는 막을 수 없어요.</p>'
            . '<form method="post" action="./" class="stack">' . csrfField() . '<input type="hidden" name="action" value="ip_block"><input type="hidden" name="tab" value="security">'
            . '<label>인터넷 주소 (IPv4 / IPv6)<input name="ip" required maxlength="64" placeholder="예: 203.0.113.7" spellcheck="false"></label>'
            . '<label>막을 시간(분)<input name="minutes" value="60" inputmode="numeric" maxlength="6"></label>'
            . '<label>이유 (나중에 알아보기 쉽게)<input name="reason" maxlength="120" placeholder="예: 로그인 마구 시도"></label>'
            . '<button class="btn danger" type="submit">⛔ 이 주소 막기</button></form></section></div>';
    }

    // admin sign-in history (audit rows) and the 2-step state of every admin account
    // the event list is the key list of SIGNIN_EVENTS, written out so the statement stays one constant (tools/sql-audit.mjs)
    $hist = Db::all("SELECT a.id, a.created_at, a.event, a.user_id, a.ip, a.detail, u.nickname FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
        WHERE a.event IN ('admin_signin', 'admin_signout', 'admin_denied', 'admin_2fa_fail', 'admin_2fa_ok', 'admin_2fa_enrolled', 'admin_2fa_disabled',
                          'admin_2fa_backup', 'admin_2fa_reset', 'admin_bootstrap', 'admin_path_renamed') ORDER BY a.id DESC LIMIT 60");
    $h .= '<section class="card"><h3>🔑 관리자 로그인 기록</h3>' . table(['시각', '무슨 일', '계정', '주소', '방법'], array_map(function ($r) {
        $d = Json::tryDecode((string) $r['detail'], true);
        $how = is_array($d) ? (isset($d['factor']) ? (string) $d['factor'] : (isset($d['via']) ? (string) $d['via'] : '')) : '';
        return [when($r['created_at']), SIGNIN_EVENTS[$r['event']] . ' (' . $r['event'] . ')', isset($r['nickname']) ? $r['nickname'] : ($r['user_id'] ? '#' . $r['user_id'] : '-'), maskIp((string) $r['ip']), $how];
    }, $hist), '아직 관리자 로그인 기록이 없어요.') . '</section>';
    $h .= '<section class="card"><h3>📱 2단계 인증 상태</h3><p class="dim small">지금 설정: <b>' . e(modeLabel(AdminTotp::mode())) . '</b> · 관리자마다 휴대폰 인증 앱을 등록했는지 보여 줘요.</p>'
        . table(['관리자', '계정 상태', '2단계 인증', '남은 백업 코드', '등록한 날'], array_map(function ($a) {
            return [$a['nickname'], $a['status'] === 'active' ? '정상' : '정지', $a['enabled'] ? '🔐 켜짐' : ($a['pending'] ? '⏳ 등록 중 (꺼짐)' : '꺼짐'), $a['enabled'] ? $a['backupLeft'] . '개' : '-', $a['enabled'] ? when($a['confirmedAt']) : '-'];
        }, AdminTotp::admins()), '관리자 계정이 없어요.') . '</section>';
    return $h;
}

/** 🔐 — my 2-step sign-in: enrol, new backup codes, turn it off (the last two need the password + a current code) */
function viewTwofa(Ctx $c): string
{
    $uid = $c->uid();
    $mode = AdminTotp::mode();
    $h = '<section class="card"><h3>🔐 2단계 인증 (휴대폰 인증 앱)</h3><p class="dim">비밀번호 다음에 휴대폰 인증 앱의 6자리 숫자를 한 번 더 넣어요. 비밀번호가 새어 나가도 그 휴대폰이 없으면 관리자 센터에 들어올 수 없어요.</p>'
        . '<p>이 서버의 설정: <b>' . e(modeLabel($mode)) . '</b> <span class="dim small">(config.local.php 의 security.admin_2fa — off / optional / required)</span></p></section>';
    if (AdminTotp::enabled($uid)) {
        $left = AdminTotp::backupLeft($uid);
        $lp = AdminTotp::lockPolicy();
        $h .= '<section class="card"><h3>✅ 켜져 있어요</h3><p>남은 백업 코드: <b>' . e($left) . '개</b>' . ($left <= 3 ? ' <span class="badge warn">얼마 안 남았어요</span>' : '') . '</p>'
            . '<p class="dim small">코드를 ' . e($lp['free']) . '번 틀리면 ' . e(AdminTotp::waitText($lp['base'])) . ' 동안 잠기고, 그 뒤로 틀릴 때마다 잠기는 시간이 두 배로 늘어나요 (가장 길게 '
            . e(AdminTotp::waitText($lp['max'])) . '). 맞는 코드를 넣으면 처음부터 다시 세요. 잠겼을 때는 서버 컴퓨터에서 <code>php cli/tfm.php admin:2fa-unlock 이메일</code> 로 바로 풀 수 있어요.</p></section>';
        $re = '<label>비밀번호<input type="password" name="password" autocomplete="current-password" required maxlength="128"></label>'
            . '<label>인증 앱의 지금 숫자 (또는 백업 코드)<input name="code" inputmode="numeric" autocomplete="one-time-code" required maxlength="20"></label>';
        $h .= '<div class="grid2"><section class="card"><h3>🔑 백업 코드 새로 만들기</h3><p class="dim small">예전 백업 코드는 모두 쓸 수 없게 되고 새 코드 10개가 한 번만 보여요.</p>'
            . '<form method="post" action="./" class="stack">' . csrfField() . '<input type="hidden" name="action" value="twofa_backup"><input type="hidden" name="tab" value="twofa">' . $re
            . '<button class="btn" type="submit">새 백업 코드 만들기</button></form></section>'
            . '<section class="card"><h3>⏹️ 2단계 인증 끄기</h3><p class="dim small">휴대폰을 바꿀 때는 끈 다음 새 휴대폰으로 다시 켜요. 끄려면 비밀번호와 지금 코드가 필요해요.</p>'
            . '<form method="post" action="./" class="stack">' . csrfField() . '<input type="hidden" name="action" value="twofa_disable"><input type="hidden" name="tab" value="twofa">' . $re
            . '<button class="btn danger" type="submit">2단계 인증 끄기</button></form></section></div>';
        return $h;
    }
    return $h . '<section class="card"><h3>📲 등록하기</h3>' . enrolSteps($c) . '</section>';
}

function viewAudit(): string
{
    $ev = preg_match('/^[a-z_]{1,40}\z/', getStr('ev')) ? getStr('ev') : '';
    $sev = in_array(getStr('sev'), ['info', 'warn', 'alert'], true) ? getStr('sev') : '';
    $w = [];
    $p = [];
    if ($ev !== '') { $w[] = 'a.event = ?'; $p[] = $ev; }
    if ($sev !== '') { $w[] = 'a.severity = ?'; $p[] = $sev; }
    // pages go by id (entries older than ?before=): the log grows while it is read, so an offset would shift
    $before = ctype_digit(getStr('before')) ? (int) getStr('before') : 0;
    if ($before > 0) { $w[] = 'a.id < ?'; $p[] = $before; }
    $rows = Db::all('SELECT a.*, u.nickname AS subject, ac.nickname AS actor FROM audit_log a LEFT JOIN users u ON u.id = a.user_id LEFT JOIN users ac ON ac.id = a.actor_id '
        . ($w ? 'WHERE ' . implode(' AND ', $w) . ' ' : '') . 'ORDER BY a.id DESC LIMIT 201', $p);
    $more = count($rows) > 200;
    $rows = array_slice($rows, 0, 200);
    $events = array_column(Db::all('SELECT DISTINCT event FROM audit_log ORDER BY event'), 'event');
    $h = '<section class="card"><form method="get" action="./" class="search"><input type="hidden" name="tab" value="audit"><select name="ev"><option value="">모든 이벤트</option>';
    foreach ($events as $x) $h .= '<option value="' . e($x) . '"' . ($x === $ev ? ' selected' : '') . '>' . e($x) . '</option>';
    $h .= '</select><select name="sev"><option value="">모든 등급</option>';
    foreach (['info' => '정보', 'warn' => '주의', 'alert' => '경고'] as $k => $v) $h .= '<option value="' . $k . '"' . ($k === $sev ? ' selected' : '') . '>' . $v . '</option>';
    $h .= '</select><button class="btn" type="submit">필터</button></form>';
    $h .= table(['#', '시각', '이벤트', '등급', '대상', '처리자', 'IP', '내용'], array_map(function ($r) {
        // the admin folder's name is never printed on a page (it would undo the rename)
        $detail = $r['event'] === 'admin_path_renamed' ? '(관리자 폴더 이름은 화면에 보여 주지 않아요)' : mb_substr((string) $r['detail'], 0, 180);
        return [$r['id'], when($r['created_at']), $r['event'], $r['severity'], isset($r['subject']) ? $r['subject'] : ($r['user_id'] ? '#' . $r['user_id'] : '-'), isset($r['actor']) ? $r['actor'] : '-', $r['ip'], $detail];
    }, $rows));
    $h .= '<div class="row">';
    if ($before > 0) $h .= '<a class="btn ghost" href="' . e(href(['tab' => 'audit', 'ev' => $ev, 'sev' => $sev])) . '">← 처음</a>';
    if ($more) $h .= '<a class="btn ghost" href="' . e(href(['tab' => 'audit', 'ev' => $ev, 'sev' => $sev, 'before' => (int) $rows[count($rows) - 1]['id']])) . '">다음 →</a>';
    $h .= '</div>';
    return $h . '<p class="dim small">감사 로그는 ' . e(Config::get('retention.audit_days', 180)) . '일 동안 보관돼요.</p></section>';
}

function viewMaintenance(): string
{
    $driver = Db::driver();
    $h = '<div class="grid2"><section class="card"><h3>🧹 정리 작업</h3><p class="dim">만료된 요청 제한 기록, 오래된 접속 정보·로그인 시도·감사 로그·채팅·로그 파일, 7일 넘게 대기 중인 주문을 보관 기간에 맞춰 지워요.</p>'
        . actionForm('cleanup', '🧹 지금 정리하기', [], 'btn primary', 'maintenance') . '</section>';
    $h .= '<section class="card"><h3>💾 백업</h3>';
    if ($driver === 'sqlite') {
        // S08: the SQLite file name is a secret (it is random so nobody can download it) — never on a page
        $path = Db::dbFilePath();
        $h .= '<p>SQLite (data 폴더) · ' . e(num(is_file($path) ? filesize($path) : 0)) . ' bytes</p>'
            . '<p class="dim small">서버 컴퓨터에서 <code>php cli/tfm.php backup</code> 을 실행하면 data/backups/ 에 안전한 사본(VACUUM INTO)이 만들어져요. data/secret.php 도 함께 보관하세요.</p>';
    } else {
        $h .= '<p class="dim small">MySQL/MariaDB: <code>mysqldump -u 관리자계정 -p ' . e((string) Config::get('db.mysql.database', 'fermentation_metaverse')) . ' &gt; backup.sql</code> 또는 phpMyAdmin → 내보내기.</p>';
    }
    $h .= '</section></div><section class="card"><h3>🗒️ 로그 파일</h3>';
    $files = glob(Log::dir() . DIRECTORY_SEPARATOR . 'app-*.log.php') ?: [];
    rsort($files);
    $h .= table(['파일', '크기', '수정'], array_map(function ($f) { return [basename($f), num(filesize($f)) . ' bytes', date('Y-m-d H:i', (int) filemtime($f))]; }, array_slice($files, 0, 30)), '로그 파일이 없어요.');
    return $h . '<p class="dim small">로그는 data/logs 에 있으며 웹에서는 열리지 않아요 (각 파일 첫 줄의 PHP 종료 코드). 서버 컴퓨터에서 텍스트 편집기로 확인하세요.</p></section>';
}

// =============================================================================== page shell
function takeFlash(): array
{
    if (!Session::started()) return [null, []];
    $flash = Session::get('flash');
    $sealed = Session::get('flash_codes');
    if ($flash !== null) Session::set('flash', null);
    $codes = [];
    if ($sealed !== null) {
        Session::set('flash_codes', null);
        $plain = is_string($sealed) && class_exists('Tfm\Crypto') ? Crypto::open($sealed) : null;
        $v = is_string($plain) ? Json::tryDecode($plain, true) : null;
        if (is_array($v)) foreach ($v as $x) if (is_string($x)) $codes[] = $x;
    }
    return [is_array($flash) ? $flash : null, $codes];
}

function page(Ctx $c, string $tab, string $body, ?array $flash, bool $inside): string
{
    $nav = '';
    $who = '';
    $banner = '';
    if ($inside) {
        $nav = '<nav class="tabs" aria-label="관리 메뉴">';
        foreach (TABS as $k => $t) $nav .= '<a href="./?tab=' . $k . '"' . ($k === $tab ? ' class="on" aria-current="page"' : '') . '><span aria-hidden="true">' . $t[0] . '</span> ' . e($t[1]) . '</a>';
        $nav .= '</nav>';
        $who = '<div class="who"><span class="avatar" aria-hidden="true">' . e(mb_substr((string) $c->user['nickname'], 0, 1)) . '</span><span><b>' . e($c->user['nickname']) . '</b><small>👑 관리자</small></span>' . actionForm('logout', '로그아웃', [], 'btn ghost sm', 'overview') . '</div>';
        if (AdminTotp::mode() === 'optional' && !AdminTotp::enabled($c->uid())) {
            $banner = '<p class="banner">⚠️ <b>2단계 인증을 켜 주세요.</b> 비밀번호가 새어 나가도 휴대폰 인증 앱이 없으면 아무도 들어올 수 없게 돼요. <a href="./?tab=twofa">지금 켜기 →</a></p>';
        }
    }
    $fl = $flash ? '<div class="flash ' . e(isset($flash['type']) ? $flash['type'] : 'ok') . '" role="status">' . e(isset($flash['msg']) ? $flash['msg'] : '') . '</div>' : '';
    // F15: nothing about versions or the database for a visitor — only inside
    $meta = $inside ? 'METAVERSE · ' . e(strtoupper(Db::driverSafe())) . ' · v' . e(TFM_VERSION) : 'METAVERSE';
    return '<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow, noarchive"><meta name="referrer" content="no-referrer">'
        . '<title>관리자 센터 · 전통발효체험관 메타버스</title><link rel="stylesheet" href="' . e(cssHref()) . '"></head><body>'
        . '<header class="top"><div class="brand"><span class="logo" aria-hidden="true">🏺</span><div><h1>전통발효체험관 <em>관리자 센터</em></h1><p>' . $meta . '</p></div></div>' . $who . '</header>'
        . $nav . '<main>' . $banner . $fl . $body . '</main><footer>🔒 이 페이지는 스크립트 없이 동작하며 모든 작업은 감사 로그에 기록됩니다. · <a href="../">🏺 체험관으로 돌아가기</a></footer></body></html>';
}

function render(Ctx $c): string
{
    $tab = tabParam(getStr('tab'));
    if (AdminGate::expired()) AdminGate::revoke(); // the idle time ran out: the sign-in form again, the cookie is deleted
    $parts = takeFlash();
    $flash = $parts[0];
    $codes = $parts[1];
    if (AdminGate::check($c->user, true)) {
        switch ($tab) {
            case 'health': $body = viewHealth(); break;
            case 'users': $body = viewUsers(); break;
            case 'sub': $body = viewSub(); break;
            case 'moderation': $body = viewModeration(); break;
            case 'security': $body = viewSecurity($c); break;
            case 'twofa': $body = viewTwofa($c); break;
            case 'audit': $body = viewAudit(); break;
            case 'maintenance': $body = viewMaintenance(); break;
            default: $body = viewOverview();
        }
        return page($c, $tab, ($codes ? viewCodes($codes) : '') . $body, $flash, true);
    }
    $pending = AdminGate::pending($c->user);
    if ($pending && $pending['need'] === 'code') return page($c, '', viewCode($c), $flash, false);
    if ($pending && $pending['need'] === 'enrol') return page($c, '', viewEnrolOnly($c), $flash, false);
    return page($c, '', viewSignIn($c), $flash, false);
}

function errorPage(Ctx $c, ApiException $e): string
{
    return page($c, '', '<section class="card narrow hero"><div class="mascot" aria-hidden="true">🙈</div><h2>' . e($e->getMessage()) . '</h2><p class="row"><a class="btn" href="./">다시 시도</a></p></section>', null, false);
}

// =============================================================================== request
$status = 200;
$ctx = new Ctx();
try {
    gateRequest();
    AdminGate::headers();
    $method = Http::method();
    if (!in_array($method, ['GET', 'HEAD', 'POST'], true)) throw new ApiException(405, 'METHOD_NOT_ALLOWED', '허용되지 않은 요청 방식이에요.', null, ['Allow: GET, HEAD, POST']);
    AdminGate::resumeSession();
    $ctx->user = Auth::current();
    RateLimit::forRequest('admin_page', $ctx);
    if ($method === 'POST') handlePost($ctx);
    $html = render($ctx);
} catch (ApiException $e) {
    $status = $e->status;
    AdminGate::headers();
    foreach ($e->headers as $hd) header($hd);
    $html = errorPage($ctx, $e);
} catch (Throwable $e) {
    $status = 500;
    $ref = Log::requestId();
    Log::error('ADMIN', get_class($e) . ': ' . $e->getMessage(), ['at' => basename($e->getFile()) . ':' . $e->getLine()]);
    AdminGate::headers();
    $html = '<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow, noarchive"><title>오류</title><link rel="stylesheet" href="admin.css"></head>'
        . '<body><main><section class="card narrow hero"><div class="mascot" aria-hidden="true">🛠️</div><h2>관리자 센터를 여는 중 문제가 생겼어요</h2><p>오류 번호: <code>' . e($ref) . '</code> — 서버 컴퓨터의 data/logs 에서 확인하세요.</p><p class="row"><a class="btn" href="./">다시 시도</a></p></section></main></body></html>';
}
while (ob_get_level() > 0) ob_end_clean();
if (!headers_sent()) http_response_code($status);
Session::close();
if (Http::method() !== 'HEAD') echo $html;
