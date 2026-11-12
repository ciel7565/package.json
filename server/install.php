<?php
/**
 * 전통발효체험관 메타버스 — 설치 마법사 (server-rendered, no JavaScript, Korean, grown-up facing)
 *
 *   http://localhost/metaverse/install.php
 *   1) 서버 환경 점검 (PHP 7.2+ 64비트, 확장, 쓰기 권한)  2) 데이터베이스 (MySQL/MariaDB 또는 SQLite)
 *   3) 첫 관리자 계정  4) 토스페이먼츠 키(선택)  → config/config.local.php 작성, 테이블 생성, 관리자 생성,
 *   data/install.lock 으로 잠금. Headless: php cli/tfm.php install …
 *
 * Security (CONTRACT §15.7 #1 #16, finding F1):
 *   - closed — a plain 404 like a missing page, nothing about the installer — once data/install.lock exists, once
 *     config/config.local.php exists, or while the configured database already holds an account (a server that is in
 *     use); reinstalling such a server happens on the server computer (php cli/tfm.php install)
 *   - open: every POST needs the one-time setup code from data/setup-code.php (php cli/tfm.php setup-code) — proof of
 *     access to the server's files, which a visitor from the internet does not have (localhost can be faked by
 *     forwarders); the code is never shown over HTTP and is used up by a successful installation
 *   - MySQL / MariaDB: the typed administrator account (root on XAMPP) is used once and never stored; a dedicated
 *     account with SELECT / INSERT / UPDATE / DELETE on the app database only goes into config.local.php
 *   - the admin folder (CONTRACT §15.4 a): the form offers a random name (ticked by default); the new name is made only
 *     after the setup code was accepted and is shown once, on the done page — never on the public form
 *   - the done page runs the configuration audit (ConfigAudit, §15.7 #8) and lists what to fix next
 *   - strict CSP (no scripts), POST + CSRF token + same-origin check, every value escaped, no PHP version, no paths
 */
declare(strict_types=1);

require __DIR__ . '/lib/bootstrap.php';

use Tfm\AdminPath;
use Tfm\ApiException;
use Tfm\ConfigAudit;
use Tfm\Ctx;
use Tfm\Firewall;
use Tfm\Http;
use Tfm\Installer;
use Tfm\Log;
use Tfm\RateLimit;
use Tfm\Sec;
use Tfm\SecEvent;
use Tfm\Session;
use Tfm\SetupCode;

ob_start();
set_error_handler(static function (int $no, string $msg, string $file = '', int $line = 0): bool {
    if (!(error_reporting() & $no)) return false;
    throw new ErrorException($msg, 0, $no, $file, $line);
});

$NONCE = base64_encode(random_bytes(16));

function ie($v): string { return htmlspecialchars((string) $v, ENT_QUOTES | ENT_SUBSTITUTE | ENT_HTML5, 'UTF-8'); }
function ibadge(string $s): string
{
    $map = ['ok' => ['ok', '✅ 좋아요'], 'warn' => ['warn', '⚠️ 주의'], 'fail' => ['fail', '⛔ 안 돼요']];
    $m = isset($map[$s]) ? $map[$s] : ['', $s];
    return '<span class="badge ' . $m[0] . '">' . ie($m[1]) . '</span>';
}
function ival(string $k, string $d = ''): string { return isset($_POST[$k]) && is_string($_POST[$k]) ? mb_substr($_POST[$k], 0, 300) : $d; }
/** a checkbox: its default on the first visit, what was sent after a POST (an unchecked box sends nothing) */
function ichecked(string $k, bool $defaultOnGet): bool { return Http::method() === 'POST' ? isset($_POST[$k]) : $defaultOnGet; }

/** what the page may show about a check: the PHP check without the exact version (the open installer is public) */
function publicChecks(array $checks): array
{
    foreach ($checks as $i => $c) {
        if ($c['id'] === 'php') $checks[$i]['value'] = $c['status'] === 'fail' ? '맞지 않음' : '7.2 이상 · 64비트';
    }
    return $checks;
}

function installPage(string $body, string $nonce, string $title = '설치 마법사'): string
{
    return '<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow">'
        . '<title>' . ie($title) . ' · 전통발효체험관 메타버스</title><style nonce="' . ie($nonce) . '">' . installCss() . '</style></head><body>'
        . '<header class="top"><div class="brand"><span class="logo" aria-hidden="true">🏺</span><div><h1>전통발효체험관 <em>설치 마법사</em></h1><p>METAVERSE · SERVER SETUP</p></div></div></header>'
        . '<main>' . $body . '</main><footer>🔒 이 페이지는 스크립트 없이 동작하며 비밀번호·키는 화면에 다시 나오지 않아요. · <a href="./">🏺 체험관으로</a></footer></body></html>';
}

/** the answer of a closed installer: the same as a page that does not exist */
function notFound(): void
{
    while (ob_get_level() > 0) ob_end_clean();
    if (!headers_sent()) {
        http_response_code(404);
        header('Content-Type: text/html; charset=utf-8');
    }
    Session::close();
    echo "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><title>404 Not Found</title></head><body><h1>Not Found</h1><p>The requested URL was not found on this server.</p></body></html>\n";
    exit;
}

function installCss(): string
{
    return <<<'CSS'
:root{--bg:#0b1410;--glass:rgba(16,26,21,.72);--line:rgba(255,255,255,.12);--text:#f4f6f1;--dim:#b9c4b5;--mute:#8e9a8b;--green:#34c36b;--green-d:#1f9e52;--gold:#f4c54a;--red:#ff6b5e;--r:16px;--font:'Pretendard','Apple SD Gothic Neo','Malgun Gothic','맑은 고딕',system-ui,-apple-system,sans-serif}
*{box-sizing:border-box}html{background:var(--bg)}body{margin:0;min-height:100vh;color:var(--text);font:15px/1.55 var(--font);background:radial-gradient(1200px 600px at 10% -10%,rgba(52,195,107,.22),transparent 60%),radial-gradient(900px 500px at 110% 10%,rgba(244,197,74,.14),transparent 60%),linear-gradient(180deg,#0f1c15,#0a120e 60%);background-attachment:fixed}
@media (prefers-reduced-motion:reduce){*,*::before{animation:none!important;transition:none!important}}
a{color:#86e3a8}code{background:rgba(0,0,0,.35);padding:1px 6px;border-radius:6px;font-size:.92em}pre{white-space:pre-wrap;word-break:break-all;background:rgba(0,0,0,.35);padding:10px 12px;border-radius:10px;font-size:.85rem}
.top{display:flex;align-items:center;gap:16px;padding:18px max(16px,4vw);border-bottom:1px solid var(--line);background:rgba(10,18,14,.6)}
.brand{display:flex;align-items:center;gap:12px}.logo{font-size:34px;filter:drop-shadow(0 0 12px rgba(244,197,74,.5))}
h1{margin:0;font-size:1.15rem}h1 em{font-style:normal;color:var(--gold)}.brand p{margin:0;color:var(--mute);font-size:.75rem;letter-spacing:.12em}
main{padding:16px max(16px,4vw) 32px;display:grid;gap:16px;max-width:980px;margin:0 auto}footer{text-align:center;color:var(--mute);font-size:.8rem;padding:24px 16px 32px}
.card{background:var(--glass);border:1px solid var(--line);border-radius:var(--r);padding:18px 20px;box-shadow:0 12px 32px rgba(0,0,0,.3);min-width:0}
.card h2{margin:0 0 10px;font-size:1.1rem}.card h3{margin:0 0 12px;font-size:1rem;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.step{display:inline-grid;place-items:center;width:28px;height:28px;border-radius:50%;background:linear-gradient(135deg,#86e3a8,var(--green));color:#08140d;font-weight:800;font-size:.9rem}
.tablewrap{overflow-x:auto;border-radius:12px;border:1px solid var(--line)}table{width:100%;border-collapse:collapse;font-size:.9rem}th,td{padding:9px 10px;text-align:left;border-bottom:1px solid rgba(255,255,255,.07);vertical-align:top;word-break:keep-all}th{background:rgba(0,0,0,.25);color:var(--dim);font-weight:600;white-space:nowrap}
.badge{display:inline-block;padding:2px 9px;border-radius:99px;font-size:.78rem;font-weight:700;white-space:nowrap;background:rgba(255,255,255,.1)}.badge.ok{background:rgba(52,195,107,.18);color:#86e3a8}.badge.warn{background:rgba(255,159,67,.18);color:#ffc58f}.badge.fail{background:rgba(255,107,94,.2);color:#ffaaa2}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(260px,100%),1fr));gap:12px}label{display:grid;gap:6px;color:var(--dim);font-size:.9rem}input,select{width:100%;min-height:44px;padding:10px 12px;border-radius:10px;border:1px solid var(--line);background:rgba(0,0,0,.3);color:var(--text);font:inherit}
input.code{font-family:ui-monospace,Consolas,monospace;letter-spacing:.12em;text-transform:uppercase;font-size:1.1rem}
label.check{grid-template-columns:auto 1fr;align-items:center;gap:10px}label.check input{width:22px;height:22px;min-height:0}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:48px;padding:10px 20px;border-radius:12px;border:1px solid transparent;background:linear-gradient(135deg,#4fd683,var(--green-d));color:#06120a;font:inherit;font-weight:800;cursor:pointer;text-decoration:none}.btn.ghost{background:transparent;border-color:var(--line);color:var(--text)}
.btn:focus-visible,input:focus-visible,select:focus-visible,a:focus-visible{outline:2px solid var(--gold);outline-offset:2px}
.flash{padding:12px 16px;border-radius:12px;border:1px solid var(--line);font-weight:600}.flash.ok{background:rgba(52,195,107,.16);border-color:rgba(52,195,107,.4)}.flash.error{background:rgba(255,107,94,.16);border-color:rgba(255,107,94,.45)}
.dim{color:var(--dim)}.small{font-size:.85rem}.row{display:flex;gap:10px;flex-wrap:wrap;margin-top:14px}.notice{padding:12px;border-radius:12px;background:rgba(244,197,74,.12);border:1px dashed rgba(244,197,74,.45);color:#ffe6a3;font-size:.9rem}
ol.todo{margin:8px 0 0;padding-left:20px;display:grid;gap:6px}
CSS;
}

function viewForm(array $checks, ?string $error): string
{
    $fails = Installer::checksFail($checks);
    $h = '';
    if ($error !== null) $h .= '<div class="flash error" role="alert">' . ie($error) . '</div>';
    $h .= '<section class="card"><h3><span class="step">1</span> 서버 환경 점검</h3><div class="tablewrap"><table><thead><tr><th>항목</th><th>상태</th><th>값</th><th>안내</th></tr></thead><tbody>';
    foreach (publicChecks($checks) as $c) $h .= '<tr><td><b>' . ie($c['label']) . '</b></td><td>' . ibadge($c['status']) . '</td><td>' . ie($c['value']) . '</td><td class="dim">' . ie($c['hint']) . '</td></tr>';
    $h .= '</tbody></table></div>';
    if ($fails) $h .= '<p class="notice">⛔ 위의 "안 돼요" 항목을 먼저 고친 뒤 이 페이지를 새로고침하세요. (XAMPP: php.ini 는 C:\\xampp\\php\\php.ini, 바꾼 뒤 Apache 재시작)</p>';
    $h .= '</section>';
    $driver = ival('driver', 'mysql') === 'sqlite' ? 'sqlite' : 'mysql';
    $h .= '<form method="post" action="install.php" autocomplete="off"><input type="hidden" name="_csrf" value="' . ie(Session::csrf()) . '">'
        . '<section class="card"><h3><span class="step">🔑</span> 설치 코드</h3>'
        . '<p class="dim small">이 서버의 주인인지 확인하는 한 번만 쓰는 코드예요. 인터넷의 다른 사람은 이 코드를 볼 수 없어요. 서버 컴퓨터에서 다음 중 하나로 확인하세요:</p>'
        . '<ol class="todo small"><li>명령 프롬프트에서 <code>php cli/tfm.php setup-code</code> 실행 (XAMPP: <code>C:\\xampp\\php\\php.exe cli\\tfm.php setup-code</code>)</li>'
        . '<li>또는 설치 폴더의 <code>data/setup-code.php</code> 파일을 메모장으로 열기 (맨 위 줄에 코드가 있어요)</li></ol>'
        . '<p class="dim small">코드는 24시간 동안 쓸 수 있고, 설치가 끝나면 저절로 사라져요.</p>'
        . '<div class="grid"><label>설치 코드 (12자리, 예: ABCD-EFGH-JKMN)<input class="code" name="setup_code" value="" required maxlength="40" autocomplete="off" spellcheck="false"></label></div></section>'
        . '<section class="card"><h3><span class="step">2</span> 데이터베이스</h3>'
        . '<p class="dim small">MySQL/MariaDB 를 쓰면 여기에는 <b>데이터베이스 관리자 계정</b>을 넣어요 (XAMPP 기본값: <code>127.0.0.1 : 3306</code>, 사용자 <code>root</code>, 빈 비밀번호 — phpMyAdmin 화면의 정보와 같아요). 이 관리자 계정은 설치하는 동안 한 번만 쓰고 어디에도 저장하지 않아요. 데이터베이스가 없으면 만들어 드려요.</p>'
        . '<div class="grid">'
        . '<label>종류<select name="driver"><option value="mysql"' . ($driver === 'mysql' ? ' selected' : '') . '>MySQL / MariaDB (권장)</option><option value="sqlite"' . ($driver === 'sqlite' ? ' selected' : '') . '>SQLite (설정 없음, 소규모)</option></select></label>'
        . '<label>호스트<input name="host" value="' . ie(ival('host', '127.0.0.1')) . '" maxlength="120"></label>'
        . '<label>포트<input name="port" value="' . ie(ival('port', '3306')) . '" inputmode="numeric" maxlength="5"></label>'
        . '<label>데이터베이스 이름<input name="database" value="' . ie(ival('database', 'fermentation_metaverse')) . '" maxlength="64"></label>'
        . '<label>관리자 사용자<input name="username" value="' . ie(ival('username', 'root')) . '" maxlength="80"></label>'
        . '<label>관리자 비밀번호<input type="password" name="password" value="" autocomplete="new-password" maxlength="200"></label>'
        . '</div><label class="check"><input type="checkbox" name="create_db" value="1"' . (ichecked('create_db', true) ? ' checked' : '') . '> 데이터베이스가 없으면 새로 만들기 (utf8mb4_unicode_ci)</label>'
        . '<label class="check"><input type="checkbox" name="app_account" value="1"' . (ichecked('app_account', true) ? ' checked' : '') . '> 전용 DB 계정 만들기 (권장) — 체험관이 쓸 계정을 새로 만들어요. 이 계정은 이 데이터베이스의 자료를 읽고 쓰기만 할 수 있고, 표를 지우거나 다른 데이터베이스를 볼 수 없어요. 비밀번호는 32자 무작위로 만들어 설정 파일에만 적어요.</label>'
        . '<div class="grid"><label>웹 서버가 데이터베이스에 접속하는 곳 (보통 비워 두세요 — 자동)<input name="app_host" value="' . ie(ival('app_host')) . '" maxlength="120" placeholder="자동 (localhost · 127.0.0.1)"></label></div></section>'
        . '<section class="card"><h3><span class="step">3</span> 첫 관리자 계정</h3><p class="dim small">관리자 센터에 들어갈 계정이에요. 체험관 안에서도 같은 계정으로 로그인해요. 비밀번호는 8자 이상, 영문+숫자.</p><div class="grid">'
        . '<label>이메일<input type="email" name="admin_email" value="' . ie(ival('admin_email')) . '" required maxlength="120"></label>'
        . '<label>닉네임 (2~12자)<input name="admin_nickname" value="' . ie(ival('admin_nickname')) . '" required maxlength="12"></label>'
        . '<label>비밀번호<input type="password" name="admin_password" value="" required autocomplete="new-password" maxlength="64"></label>'
        . '</div><label class="check"><input type="checkbox" name="admin_random" value="1"' . (ichecked('admin_random', true) ? ' checked' : '') . '> 관리자 센터 주소를 아무도 모르는 이름으로 바꾸기 (권장) — 기본 주소 <code>…/admin/</code> 는 누구나 짐작할 수 있어요. 새 주소는 설치가 끝난 화면에 한 번만 보여 드려요 (서버 컴퓨터에서 <code>php cli/tfm.php admin:path</code> 로 다시 확인할 수 있어요).</label></section>'
        . '<section class="card"><h3><span class="step">4</span> 토스페이먼츠 (선택 · 진행 속도 구독 결제)</h3><p class="dim small">토스페이먼츠 개발자센터에서 발급받은 <b>내 API 키</b>를 넣으면 2배·3배·4배 구독을 팔 수 있어요. 비워 두면 결제가 "설정 필요" 상태로 꺼져 있어요 (나중에 config/config.local.php 에 넣을 수 있어요). "모의 결제" 를 켜면 결제 서버에 연결하지 않고 이 서버 컴퓨터에서 흐름을 시험할 수 있어요 — 운영 서버에서는 켜지 마세요.</p><div class="grid">'
        . '<label>클라이언트 키 (test_ck_… / live_ck_…)<input name="toss_client" value="' . ie(ival('toss_client')) . '" maxlength="120"></label>'
        . '<label>시크릿 키 (test_sk_… / live_sk_…)<input type="password" name="toss_secret" value="" autocomplete="new-password" maxlength="120"></label>'
        . '</div><label class="check"><input type="checkbox" name="toss_mock" value="1"' . (ichecked('toss_mock', false) ? ' checked' : '') . '> 모의 결제 모드 (시연·테스트용, 실제 결제 안 함)</label></section>'
        . '<section class="card"><p class="dim small">설치가 끝나면 <code>config/config.local.php</code> 와 <code>data/install.lock</code> 이 만들어지고 이 페이지는 닫혀요 (주소를 열어도 "없는 페이지"로 보여요).</p>'
        . '<div class="row"><button class="btn" type="submit"' . ($fails ? ' disabled' : '') . '>🚀 설치하기</button><a class="btn ghost" href="install.php">새로고침</a></div></section></form>';
    return $h;
}

/**
 * After a successful installation: the admin folder gets a random name when the box was ticked (CONTRACT §15.4 a).
 * A folder the web server may not rename (Linux web roots, a program holding it open on Windows) is not an install
 * failure: the done page tells the operator to run `php cli/tfm.php admin:path --random` instead.
 * → ['name' => current folder name ('' when none), 'renamed' => bool, 'error' => Korean reason or '']
 */
function installAdminFolder(bool $random): array
{
    $out = ['name' => AdminPath::dirName(), 'renamed' => false, 'error' => ''];
    if (!$random || $out['name'] === '') return $out;
    try {
        $out['name'] = AdminPath::rename(AdminPath::random());
        $out['renamed'] = true;
    } catch (ApiException $e) {
        Log::warn('INSTALL', 'admin folder not renamed', ['code' => $e->errorCode]);
        $out['error'] = $e->getMessage();
    }
    return $out;
}

/** the configuration audit right after the installation (CONTRACT §15.7 #8) — [] when the audit is not available */
function installAudit(): array
{
    if (!class_exists('Tfm\ConfigAudit')) return [];
    try {
        return ConfigAudit::run();
    } catch (Throwable $e) {
        Log::error('INSTALL', 'config audit after the installation failed: ' . get_class($e));
        return [];
    }
}

/** the done page's admin-site lines: the address (shown only here), how to find it again, the next locks */
function viewAdminSteps(array $dir): string
{
    $name = $dir['name'] !== '' ? $dir['name'] : AdminPath::DEFAULT_NAME;
    $url = Http::baseUrl() . $name . '/';
    $link = '<a href="' . ie($name . '/') . '"><code>' . ie($url) . '</code></a>';
    if ($dir['renamed']) {
        $h = '<li>🔒 관리자 센터 주소: ' . $link . ' — 폴더 이름을 아무도 모르는 이름으로 바꿨어요. <b>이 주소는 지금 이 화면에만 보여요. 즐겨찾기에 넣어 두세요.</b>'
            . ' 잊어버리면 서버 컴퓨터에서 <code>php cli/tfm.php admin:path</code> 로 확인할 수 있어요 (관리자 계정으로 체험관에 로그인하면 메뉴의 관리자 센터 버튼도 새 주소로 가요).</li>';
    } elseif ($dir['error'] !== '') {
        $h = '<li>⚠️ 관리자 센터 주소: ' . $link . ' — 폴더 이름을 바꾸지 못했어요 (' . ie($dir['error']) . ').'
            . ' 서버 컴퓨터에서 <code>php cli/tfm.php admin:path --random</code> 을 실행하면 아무도 모르는 이름으로 바뀌고 새 주소가 한 번 보여요.</li>';
    } elseif ($name === AdminPath::DEFAULT_NAME) {
        $h = '<li>⚠️ 관리자 센터 주소: ' . $link . ' — 누구나 짐작할 수 있는 기본 이름이에요.'
            . ' 서버 컴퓨터에서 <code>php cli/tfm.php admin:path --random</code> 을 실행해 아무도 모르는 이름으로 바꾸세요 (새 주소는 그 화면에 한 번 보여요).</li>';
    } else {
        $h = '<li>🔒 관리자 센터 주소: ' . $link . ' (서버 컴퓨터에서 <code>php cli/tfm.php admin:path</code> 로 다시 확인할 수 있어요).</li>';
    }
    return $h . '<li>🔐 관리자 센터에 로그인한 뒤 <b>2단계 인증</b> 탭에서 휴대폰 인증 앱(예: Google Authenticator)을 등록하세요. 비밀번호가 새어 나가도 그 휴대폰이 없으면 아무도 들어올 수 없어요.'
        . ' 모든 관리자가 등록하면 <code>security.admin_2fa</code> 를 <code>required</code> 로 바꾸세요 (환경 변수 <code>TFM_ADMIN_2FA</code>).</li>'
        . '<li>🌐 관리자가 일하는 곳의 인터넷 주소에서만 관리자 센터가 열리게 하세요: <code>config/config.local.php</code> 의 <code>security.admin_ip_allowlist</code> (또는 환경 변수 <code>TFM_ADMIN_IPS</code>)에 주소를 적어요 (예: <code>203.0.113.7</code>, <code>192.168.0.0/24</code>). 다른 곳에서는 "없는 페이지"로 보여요.</li>';
}

/** the done page's audit card: the rows that need attention, never a key (ConfigAudit prints none) nor the server's version */
function viewInstallAudit(array $rows): string
{
    if (!$rows) return '';
    $sum = ConfigAudit::summary($rows);
    $h = '<section class="card"><h2>🛡️ 설치 후 보안 점검</h2><p class="dim small">설정 파일과 서버 환경을 한 번 살펴봤어요 (관리자 센터의 🩺 시스템 점검과 같은 내용이에요). 정상 '
        . ie($sum['ok']) . ' · 주의 ' . ie($sum['warn']) . ' · 위험 ' . ie($sum['fail']) . '</p>';
    $todo = array_values(array_filter($rows, function ($r) { return $r['status'] !== 'ok'; }));
    if (!$todo) return $h . '<p class="flash ok">✅ 지금 고칠 것이 없어요.</p></section>';
    $h .= '<div class="tablewrap"><table><thead><tr><th>항목</th><th>상태</th><th>값</th><th>이렇게 고쳐요</th></tr></thead><tbody>';
    foreach ($todo as $r) {
        // the web server's banner carries version numbers: say what is wrong without repeating it
        $value = $r['id'] === 'server_hardening' ? '버전이 보여요' : (string) $r['value'];
        $h .= '<tr><td><b>' . ie($r['label']) . '</b></td><td>' . ibadge((string) $r['status']) . '</td><td>' . ie($value) . '</td><td class="dim">' . ie($r['hint']) . '</td></tr>';
    }
    return $h . '</tbody></table></div><p class="dim small">나중에 다시 보려면 관리자 센터 → 🩺 시스템 점검, 또는 서버 컴퓨터에서 <code>php cli/tfm.php config:check</code>.</p></section>';
}

function viewDone(array $r, array $adminDir, array $audit): string
{
    $acct = isset($r['dbAccount']) && is_array($r['dbAccount']) ? $r['dbAccount'] : ['dedicated' => false, 'reason' => 'sqlite', 'manual' => []];
    if ($r['driver'] !== 'mysql') {
        $dbLine = '데이터베이스: <b>SQLite</b> (data 폴더 안, 추측하기 어려운 파일 이름) · 스키마 v' . ie($r['schema']) . ' 준비됨';
    } elseif (!empty($acct['dedicated'])) {
        $dbLine = '데이터베이스: <b>MySQL/MariaDB</b> · 스키마 v' . ie($r['schema']) . ' 준비됨 · 체험관 전용 계정 <code>' . ie($acct['user']) . '</code> 을 만들었어요 (읽기·쓰기만 가능, 비밀번호 32자 무작위). 입력한 관리자 계정은 저장하지 않았어요.'
            . (isset($acct['warning']) && $acct['warning'] === 'ddl' ? ' <b>⚠ 다른 권한 설정 때문에 이 계정이 표를 만들 수도 있어요 — 관리자 센터 점검 화면을 확인하세요.</b>' : '')
            . ' 나중에 업데이트할 때는 서버 컴퓨터에서 <code>php cli/tfm.php migrate --admin-user root</code> 를 실행하세요.';
    } elseif ($acct['reason'] === 'not_requested') {
        $dbLine = '데이터베이스: <b>MySQL/MariaDB</b> · 스키마 v' . ie($r['schema']) . ' · <b>⚠ 입력한 계정을 그대로 써요</b> (전용 계정 만들기를 껐어요). 관리자 센터 점검 화면에 주의 표시가 나와요. 나중에 <code>php cli/tfm.php db:account --admin-user root</code> 로 전용 계정으로 바꿀 수 있어요.';
    } else {
        $dbLine = '데이터베이스: <b>MySQL/MariaDB</b> · 스키마 v' . ie($r['schema']) . ' · <b>⚠ 이 계정에는 새 계정을 만드는 권한이 없어서 입력한 계정을 그대로 써요.</b> 권한이 있는 관리자(보통 root)에게 phpMyAdmin 의 SQL 탭에서 아래 문장을 실행해 달라고 하세요 (비밀번호 자리에는 32자 이상 무작위 글자를 넣어요). 그다음 <code>config/config.local.php</code> 의 <code>db.mysql</code> 에 그 계정과 비밀번호를 적고 <code>\'auto_migrate\' => false</code> 를 넣으면 돼요 — 또는 root 로 <code>php cli/tfm.php db:account --admin-user root</code> 를 실행하면 자동으로 해 줘요.'
            . '<pre>' . ie(implode("\n", isset($acct['manual']) ? $acct['manual'] : [])) . '</pre>';
    }
    $h = '<div class="flash ok" role="status">🎉 설치가 끝났어요!</div><section class="card"><h2>이제 이렇게 하세요</h2><ol class="todo">'
        . '<li>' . $dbLine . '</li>'
        . '<li>관리자 <b>' . ie($r['adminNickname']) . '</b> ' . ($r['adminCreated'] ? '계정을 만들었어요.' : '계정에 관리자 권한을 주었어요.') . ' 관리자 센터에서 같은 이메일·비밀번호로 로그인하세요.</li>'
        . viewAdminSteps($adminDir)
        . '<li>구독 결제: ' . ($r['mock'] ? '<b>모의 결제 모드</b> (이 서버 컴퓨터에서만 시험용)' : ($r['tossKeys'] ? '<b>입력한 토스 키</b> 사용' : '<b>설정 필요</b> — 결제를 열려면 토스페이먼츠 개발자센터에서 발급받은 내 키를 config/config.local.php 에 넣어 주세요')) . ' — 토스 개발자센터의 웹훅 주소는 <code>' . ie(Http::baseUrl()) . 'api/sub/webhook.php</code></li>'
        . '<li>자동 갱신: Windows 작업 스케줄러에 <code>php.exe cli\\tfm.php sub:renew</code> 를 하루 한 번 등록하세요 (docs/SERVER-INSTALL-KO.md).</li>'
        . '<li>운영 서버는 HTTPS 로 서비스하세요 (토스 결제창과 마이크 입력이 HTTPS 를 요구해요).</li></ol>'
        . '<div class="row"><a class="btn" href="./">🏺 체험관 열기</a></div></section>';
    return $h . viewInstallAudit($audit);
}

/** Firewall::guardPage() of the security layer (blocked addresses, plain HTTP where HTTPS is required, uploads) */
function guard(): void
{
    if (method_exists('Tfm\\Firewall', 'guardPage') && method_exists('Tfm\\Http', 'plainPage') && method_exists('Tfm\\Http', 'enforceHttps') && method_exists('Tfm\\Http', 'refuseUpload')) {
        Firewall::guardPage();
        return;
    }
    if (class_exists('Tfm\\Firewall')) Firewall::check(); // ApiException 403 IP_BLOCKED → the error page below
}

$status = 200;
try {
    Http::securityHeaders('admin', $NONCE);
    guard();
    if (Installer::webClosedReason() !== '') notFound();
    Session::start(true);
    $ctx = new Ctx();
    RateLimit::forRequest('install', $ctx, 'ip');
    $method = Http::method();
    if ($method === 'POST') {
        Sec::checkOrigin();
        if (!Session::checkCsrf(isset($_POST['_csrf']) && is_string($_POST['_csrf']) ? $_POST['_csrf'] : null)) {
            Log::security('CSRF', 'install form token invalid');
            throw new ApiException(403, 'CSRF_INVALID', '보안 토큰이 만료되었어요. 다시 시도해 주세요.');
        }
        $driverIn = ival('driver', 'mysql') === 'sqlite' ? 'sqlite' : 'mysql';
        if (!SetupCode::check(ival('setup_code'))) {
            if (class_exists('Tfm\\SecEvent')) SecEvent::log('admin_denied', 'warn', ['page' => 'install', 'why' => 'setup_code']);
            Log::security('INSTALL', 'wrong or missing setup code');
            SetupCode::ensure(); // an expired code is replaced, so the operator can read a fresh one
            $status = 403;
            $html = installPage(viewForm(Installer::checks($driverIn), '설치 코드가 맞지 않아요. 서버 컴퓨터에서 php cli/tfm.php setup-code 로 코드를 확인한 뒤 다시 넣어 주세요.'), $NONCE);
        } else {
            try {
                $r = Installer::run([
                    'driver' => $driverIn, 'host' => ival('host'), 'port' => ival('port'), 'database' => ival('database'),
                    'username' => ival('username'), 'password' => ival('password'), 'create_db' => isset($_POST['create_db']),
                    'app_account' => isset($_POST['app_account']), 'app_host' => ival('app_host'),
                    'admin_email' => ival('admin_email'), 'admin_nickname' => ival('admin_nickname'), 'admin_password' => ival('admin_password'),
                    'toss_client' => ival('toss_client'), 'toss_secret' => ival('toss_secret'), 'toss_mock' => isset($_POST['toss_mock']),
                ]);
                SetupCode::consume();
                $adminDir = installAdminFolder(isset($_POST['admin_random']));
                $html = installPage(viewDone($r, $adminDir, installAudit()), $NONCE, '설치 완료');
            } catch (ApiException $e) {
                $status = $e->status >= 400 && $e->status < 600 ? $e->status : 400;
                $html = installPage(viewForm(Installer::checks($driverIn), $e->getMessage()), $NONCE);
            }
        }
    } elseif ($method === 'GET' || $method === 'HEAD') {
        SetupCode::ensure(); // the operator reads it on the server computer; it is never part of this page
        $html = installPage(viewForm(Installer::checks('mysql'), null), $NONCE);
    } else {
        throw new ApiException(405, 'METHOD_NOT_ALLOWED', '허용되지 않은 요청 방식이에요.', null, ['Allow: GET, POST']);
    }
} catch (ApiException $e) {
    $status = $e->status;
    foreach ($e->headers as $hd) header($hd);
    $html = installPage('<section class="card"><h2>🙈 ' . ie($e->getMessage()) . '</h2><div class="row"><a class="btn ghost" href="install.php">다시 시도</a></div></section>', $NONCE, '오류');
} catch (Throwable $e) {
    $status = 500;
    $ref = Log::requestId();
    Log::error('INSTALL', get_class($e) . ': ' . $e->getMessage(), ['at' => basename($e->getFile()) . ':' . $e->getLine()]);
    $html = installPage('<section class="card"><h2>🛠️ 설치 마법사를 여는 중 문제가 생겼어요</h2><p>오류 번호: <code>' . ie($ref) . '</code> — 서버의 data/logs 에서 확인하세요.</p></section>', $NONCE, '오류');
}
while (ob_get_level() > 0) ob_end_clean();
if (!headers_sent()) http_response_code($status);
Session::close();
echo $html;
