<?php
/**
 * 전통발효체험관 메타버스 — 설치 마법사 (server-rendered, no JavaScript, Korean, grown-up facing)
 *
 *   http://localhost/metaverse/install.php
 *   1) 서버 환경 점검 (PHP 7.2+ 64비트, 확장, 쓰기 권한)  2) 데이터베이스 (MySQL/MariaDB 또는 SQLite)
 *   3) 첫 관리자 계정  4) 토스페이먼츠 키(선택)  → config/config.local.php 작성, 테이블 생성, 관리자 생성,
 *   data/install.lock 으로 잠금 (다시 설치하려면 그 파일을 지우세요). Headless: php cli/tfm.php install …
 *
 * Security: strict nonce CSP (no scripts), POST + CSRF token + same-origin check, every value escaped,
 * refuses to run once data/install.lock exists, never prints a password or secret key.
 */
declare(strict_types=1);

require __DIR__ . '/lib/bootstrap.php';

use Tfm\ApiException;
use Tfm\Ctx;
use Tfm\Http;
use Tfm\Installer;
use Tfm\Log;
use Tfm\RateLimit;
use Tfm\Sec;
use Tfm\Session;

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
function ival(string $k, string $d = ''): string { return isset($_POST[$k]) && is_string($_POST[$k]) ? $_POST[$k] : $d; }

function installPage(string $body, string $nonce, string $title = '설치 마법사'): string
{
    return '<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow">'
        . '<title>' . ie($title) . ' · 전통발효체험관 메타버스</title><style nonce="' . ie($nonce) . '">' . installCss() . '</style></head><body>'
        . '<header class="top"><div class="brand"><span class="logo" aria-hidden="true">🏺</span><div><h1>전통발효체험관 <em>설치 마법사</em></h1><p>METAVERSE · SERVER SETUP · v' . ie(TFM_VERSION) . '</p></div></div></header>'
        . '<main>' . $body . '</main><footer>🔒 이 페이지는 스크립트 없이 동작하며 비밀번호·키는 화면에 다시 나오지 않아요. · <a href="./">🏺 체험관으로</a> · <a href="admin.php">관리자 센터</a></footer></body></html>';
}

function installCss(): string
{
    return <<<'CSS'
:root{--bg:#0b1410;--glass:rgba(16,26,21,.72);--line:rgba(255,255,255,.12);--text:#f4f6f1;--dim:#b9c4b5;--mute:#8e9a8b;--green:#34c36b;--green-d:#1f9e52;--gold:#f4c54a;--red:#ff6b5e;--r:16px;--font:'Pretendard','Apple SD Gothic Neo','Malgun Gothic','맑은 고딕',system-ui,-apple-system,sans-serif}
*{box-sizing:border-box}html{background:var(--bg)}body{margin:0;min-height:100vh;color:var(--text);font:15px/1.55 var(--font);background:radial-gradient(1200px 600px at 10% -10%,rgba(52,195,107,.22),transparent 60%),radial-gradient(900px 500px at 110% 10%,rgba(244,197,74,.14),transparent 60%),linear-gradient(180deg,#0f1c15,#0a120e 60%);background-attachment:fixed}
@media (prefers-reduced-motion:reduce){*,*::before{animation:none!important;transition:none!important}}
a{color:#86e3a8}code{background:rgba(0,0,0,.35);padding:1px 6px;border-radius:6px;font-size:.92em}
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
label.check{grid-template-columns:auto 1fr;align-items:center;gap:10px}label.check input{width:22px;height:22px;min-height:0}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:48px;padding:10px 20px;border-radius:12px;border:1px solid transparent;background:linear-gradient(135deg,#4fd683,var(--green-d));color:#06120a;font:inherit;font-weight:800;cursor:pointer;text-decoration:none}.btn.ghost{background:transparent;border-color:var(--line);color:var(--text)}
.btn:focus-visible,input:focus-visible,select:focus-visible,a:focus-visible{outline:2px solid var(--gold);outline-offset:2px}
.flash{padding:12px 16px;border-radius:12px;border:1px solid var(--line);font-weight:600}.flash.ok{background:rgba(52,195,107,.16);border-color:rgba(52,195,107,.4)}.flash.error{background:rgba(255,107,94,.16);border-color:rgba(255,107,94,.45)}
.dim{color:var(--dim)}.small{font-size:.85rem}.row{display:flex;gap:10px;flex-wrap:wrap;margin-top:14px}.notice{padding:12px;border-radius:12px;background:rgba(244,197,74,.12);border:1px dashed rgba(244,197,74,.45);color:#ffe6a3;font-size:.9rem}
ol.todo{margin:8px 0 0;padding-left:20px;display:grid;gap:6px}
CSS;
}

function viewLocked(): string
{
    return '<section class="card"><h2>🔒 이미 설치되었어요</h2><p>이 체험관은 설치가 끝났어요. 설정을 바꾸려면 <code>config/config.local.php</code> 를 고치거나 관리자 센터를 쓰세요.</p>'
        . '<p class="dim small">처음부터 다시 설치하려면 서버의 <code>data/install.lock</code> 파일을 지운 뒤 이 페이지를 다시 열어 주세요 (기존 데이터는 지워지지 않아요).</p>'
        . '<div class="row"><a class="btn" href="./">🏺 체험관 열기</a><a class="btn ghost" href="admin.php">👑 관리자 센터</a></div></section>';
}

function viewForm(array $checks, ?string $error): string
{
    $fails = Installer::checksFail($checks);
    $h = '';
    if ($error !== null) $h .= '<div class="flash error" role="alert">' . ie($error) . '</div>';
    $h .= '<section class="card"><h3><span class="step">1</span> 서버 환경 점검</h3><div class="tablewrap"><table><thead><tr><th>항목</th><th>상태</th><th>값</th><th>안내</th></tr></thead><tbody>';
    foreach ($checks as $c) $h .= '<tr><td><b>' . ie($c['label']) . '</b></td><td>' . ibadge($c['status']) . '</td><td>' . ie($c['value']) . '</td><td class="dim">' . ie($c['hint']) . '</td></tr>';
    $h .= '</tbody></table></div>';
    if ($fails) $h .= '<p class="notice">⛔ 위의 "안 돼요" 항목을 먼저 고친 뒤 이 페이지를 새로고침하세요. (XAMPP: php.ini 는 C:\\xampp\\php\\php.ini, 바꾼 뒤 Apache 재시작)</p>';
    $h .= '</section>';
    $driver = ival('driver', 'mysql') === 'sqlite' ? 'sqlite' : 'mysql';
    $h .= '<form method="post" action="install.php" autocomplete="off"><input type="hidden" name="_csrf" value="' . ie(Session::csrf()) . '">'
        . '<section class="card"><h3><span class="step">2</span> 데이터베이스</h3>'
        . '<p class="dim small">XAMPP 기본값은 <code>127.0.0.1 : 3306</code>, 사용자 <code>root</code>, 빈 비밀번호예요 (phpMyAdmin 화면의 정보와 같아요). 데이터베이스가 없으면 만들어 드려요. 운영 서버에서는 전용 계정을 권장해요.</p>'
        . '<div class="grid">'
        . '<label>종류<select name="driver"><option value="mysql"' . ($driver === 'mysql' ? ' selected' : '') . '>MySQL / MariaDB (권장)</option><option value="sqlite"' . ($driver === 'sqlite' ? ' selected' : '') . '>SQLite (설정 없음, 소규모)</option></select></label>'
        . '<label>호스트<input name="host" value="' . ie(ival('host', '127.0.0.1')) . '" maxlength="120"></label>'
        . '<label>포트<input name="port" value="' . ie(ival('port', '3306')) . '" inputmode="numeric" maxlength="5"></label>'
        . '<label>데이터베이스 이름<input name="database" value="' . ie(ival('database', 'fermentation_metaverse')) . '" maxlength="64"></label>'
        . '<label>사용자<input name="username" value="' . ie(ival('username', 'root')) . '" maxlength="80"></label>'
        . '<label>비밀번호<input type="password" name="password" value="" autocomplete="new-password" maxlength="200"></label>'
        . '</div><label class="check"><input type="checkbox" name="create_db" value="1"' . (ival('create_db', '1') !== '' ? ' checked' : '') . '> 데이터베이스가 없으면 새로 만들기 (utf8mb4_unicode_ci)</label></section>'
        . '<section class="card"><h3><span class="step">3</span> 첫 관리자 계정</h3><p class="dim small">관리자 센터(admin.php)에 들어갈 계정이에요. 체험관 안에서도 같은 계정으로 로그인해요. 비밀번호는 8자 이상, 영문+숫자.</p><div class="grid">'
        . '<label>이메일<input type="email" name="admin_email" value="' . ie(ival('admin_email')) . '" required maxlength="120"></label>'
        . '<label>닉네임 (2~12자)<input name="admin_nickname" value="' . ie(ival('admin_nickname')) . '" required maxlength="12"></label>'
        . '<label>비밀번호<input type="password" name="admin_password" value="" required autocomplete="new-password" maxlength="64"></label>'
        . '</div></section>'
        . '<section class="card"><h3><span class="step">4</span> 토스페이먼츠 (선택 · 진행 속도 구독 결제)</h3><p class="dim small">토스페이먼츠 개발자센터의 <b>API 개별 연동 키</b>를 넣으면 2배·3배·4배 구독을 팔 수 있어요. 비워 두면 문서용 테스트 키로 동작해요(실제 돈이 오가지 않음). "모의 결제" 를 켜면 결제 서버에 연결하지 않고 테스트 결제 창으로 흐름을 시험할 수 있어요.</p><div class="grid">'
        . '<label>클라이언트 키 (test_ck_… / live_ck_…)<input name="toss_client" value="' . ie(ival('toss_client')) . '" maxlength="120"></label>'
        . '<label>시크릿 키 (test_sk_… / live_sk_…)<input type="password" name="toss_secret" value="" autocomplete="new-password" maxlength="120"></label>'
        . '</div><label class="check"><input type="checkbox" name="toss_mock" value="1"' . (ival('toss_mock') === '1' ? ' checked' : '') . '> 모의 결제 모드 (시연·테스트용, 실제 결제 안 함)</label></section>'
        . '<section class="card"><p class="dim small">설치가 끝나면 <code>config/config.local.php</code> 와 <code>data/install.lock</code> 이 만들어지고 이 페이지는 잠겨요.</p>'
        . '<div class="row"><button class="btn" type="submit"' . ($fails ? ' disabled' : '') . '>🚀 설치하기</button><a class="btn ghost" href="install.php">새로고침</a></div></section></form>';
    return $h;
}

function viewDone(array $r): string
{
    $h = '<div class="flash ok" role="status">🎉 설치가 끝났어요!</div><section class="card"><h2>이제 이렇게 하세요</h2><ol class="todo">'
        . '<li>데이터베이스: <b>' . ie(strtoupper($r['driver'])) . '</b> (' . ie($r['server']) . ') · 스키마 v' . ie($r['schema']) . ' 준비됨</li>'
        . '<li>관리자 <b>' . ie($r['adminNickname']) . '</b> ' . ($r['adminCreated'] ? '계정을 만들었어요.' : '계정에 관리자 권한을 주었어요.') . ' <a href="admin.php">관리자 센터</a>에서 같은 이메일·비밀번호로 로그인하세요.</li>'
        . '<li>구독 결제: ' . ($r['mock'] ? '<b>모의 결제 모드</b> (테스트)' : ($r['tossKeys'] ? '<b>입력한 토스 키</b> 사용' : '<b>문서용 테스트 키</b> (실제 결제 전에는 토스 키를 넣어 주세요)')) . ' — 토스 개발자센터의 웹훅 주소는 <code>' . ie(Http::baseUrl()) . 'api/sub/webhook.php</code></li>'
        . '<li>자동 갱신: Windows 작업 스케줄러에 <code>php.exe cli\\tfm.php sub:renew</code> 를 하루 한 번 등록하세요 (docs/SERVER-INSTALL-KO.md).</li>'
        . '<li>운영 서버는 HTTPS 로 서비스하세요 (토스 결제창과 마이크 입력이 HTTPS 를 요구해요).</li></ol>'
        . '<div class="row"><a class="btn" href="./">🏺 체험관 열기</a><a class="btn ghost" href="admin.php">👑 관리자 센터</a></div></section>';
    return $h;
}

$status = 200;
try {
    Http::securityHeaders('admin', $NONCE);
    if (Installer::locked()) { $status = 403; $html = installPage(viewLocked(), $NONCE, '이미 설치됨'); }
    else {
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
            try {
                $r = Installer::run([
                    'driver' => ival('driver', 'mysql'), 'host' => ival('host'), 'port' => ival('port'), 'database' => ival('database'),
                    'username' => ival('username'), 'password' => ival('password'), 'create_db' => ival('create_db') === '1',
                    'admin_email' => ival('admin_email'), 'admin_nickname' => ival('admin_nickname'), 'admin_password' => ival('admin_password'),
                    'toss_client' => ival('toss_client'), 'toss_secret' => ival('toss_secret'), 'toss_mock' => ival('toss_mock') === '1',
                ]);
                $html = installPage(viewDone($r), $NONCE, '설치 완료');
            } catch (ApiException $e) {
                $status = $e->status >= 400 && $e->status < 600 ? $e->status : 400;
                $html = installPage(viewForm(Installer::checks(ival('driver', 'mysql') === 'sqlite' ? 'sqlite' : 'mysql'), $e->getMessage()), $NONCE);
            }
        } elseif ($method === 'GET' || $method === 'HEAD') {
            $html = installPage(viewForm(Installer::checks('mysql'), null), $NONCE);
        } else {
            throw new ApiException(405, 'METHOD_NOT_ALLOWED', '허용되지 않은 요청 방식이에요.', null, ['Allow: GET, POST']);
        }
    }
} catch (ApiException $e) {
    $status = $e->status;
    foreach ($e->headers as $hd) header($hd);
    $html = installPage('<section class="card"><h2>🙈 ' . ie($e->getMessage()) . '</h2><div class="row"><a class="btn ghost" href="install.php">다시 시도</a></div></section>', $NONCE, '오류');
} catch (Throwable $e) {
    $status = 500;
    $ref = Log::requestId();
    Log::error('INSTALL', get_class($e) . ': ' . $e->getMessage(), ['at' => basename($e->getFile()) . ':' . $e->getLine()]);
    $html = installPage('<section class="card"><h2>🛠️ 설치 마법사를 여는 중 문제가 생겼어요</h2><p>오류 번호: <code>' . ie($ref) . '</code> — data/logs 에서 확인하세요.</p></section>', $NONCE, '오류');
}
while (ob_get_level() > 0) ob_end_clean();
if (!headers_sent()) http_response_code($status);
Session::close();
echo $html;
