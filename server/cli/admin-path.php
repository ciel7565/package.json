<?php
/**
 * cli/admin-path.php — admin site lock commands (CONTRACT §15.4). Loaded as a plug-in by cli/tfm.php, which dispatches
 * these as `php cli/tfm.php <command>`; the file can also be run on its own: php cli/admin-path.php admin:path
 *
 *   admin:path                  지금 관리자 폴더 이름을 보여 줘요
 *   admin:path --random         관리자 폴더 이름을 아무도 모르는 이름(admin-무작위 10글자)으로 바꾸고 새 주소를 보여 줘요
 *   admin:path <이름>            관리자 폴더 이름을 직접 정해요 (영어 소문자·숫자·- 로 4~40자). 바꾼 이름은 config.local.php 에 기록돼요
 *   admin:2fa-reset <이메일>      그 관리자의 2단계 인증을 지워요 (휴대폰과 백업 코드를 모두 잃어버렸을 때, 서버 컴퓨터에서만)
 *
 * PHP 7.2 syntax only.
 */
declare(strict_types=1);

namespace Tfm;

if (PHP_SAPI !== 'cli') { if (function_exists('header_remove')) header_remove('X-Powered-By'); http_response_code(404); exit; }

$tfmAdminCommands = [
    // -------------------------------------------------------------- admin:path
    'admin:path' => function (array $args): int {
        $want = isset($args[0]) ? (string) $args[0] : '';
        $cur = AdminPath::dirName();
        if ($want === '') {
            if ($cur === '') { fwrite(STDERR, '✖ 관리자 폴더(맨 위에 ' . AdminPath::MARK . ' 표시가 있는 index.php 가 든 폴더)를 찾지 못했어요.' . PHP_EOL); return 1; }
            fwrite(STDOUT, '지금 관리자 폴더: ' . $cur . '/' . ($cur === AdminPath::DEFAULT_NAME ? '   (기본 이름 — php cli/tfm.php admin:path --random 으로 아무도 모르는 이름으로 바꾸세요)' : '') . PHP_EOL);
            $cfg = (string) Config::get('security.admin_dir', AdminPath::DEFAULT_NAME);
            if ($cfg !== $cur) fwrite(STDOUT, '  설정(security.admin_dir)에는 "' . $cfg . '" 로 적혀 있어요. php cli/tfm.php admin:path ' . $cur . ' 로 기록하세요.' . PHP_EOL);
            return 0;
        }
        $name = $want === '--random' ? AdminPath::random() : $want;
        try {
            $done = AdminPath::rename($name);
        } catch (ApiException $e) {
            fwrite(STDERR, '✖ ' . $e->getMessage() . PHP_EOL);
            return 1;
        }
        if ($done === $cur) {
            fwrite(STDOUT, '✔ 관리자 폴더는 이미 ' . $done . '/ 예요. 설정(config.local.php 의 security.admin_dir)에 기록했어요.' . PHP_EOL);
            return 0;
        }
        fwrite(STDOUT, '✔ 관리자 폴더 이름을 바꿨어요: ' . $cur . '/ → ' . $done . '/' . PHP_EOL
            . '  새 관리자 주소: <체험관 주소>/' . $done . '/   (예: http://localhost/metaverse/' . $done . '/)' . PHP_EOL
            . '  이 주소를 즐겨찾기에 넣어 두세요. 관리자 센터 화면에도 다시 보여 주지 않아요 (관리자 계정으로 로그인한 체험관의 "관리자 센터" 버튼은 알아서 새 주소로 가요).' . PHP_EOL
            . '  예전 주소 ' . $cur . '/ 는 이제 "없는 페이지"예요. 기록: config/config.local.php 의 security.admin_dir' . PHP_EOL);
        return 0;
    },

    // -------------------------------------------------------------- admin:2fa-reset
    'admin:2fa-reset' => function (array $args): int {
        $login = trim(isset($args[0]) ? (string) $args[0] : '');
        if ($login === '') { fwrite(STDERR, '✖ 이메일(또는 닉네임)을 적어 주세요: php cli/tfm.php admin:2fa-reset 이메일' . PHP_EOL); return 1; }
        $u = Users::byLogin($login);
        if (!$u) { fwrite(STDERR, '✖ 그런 계정이 없어요: ' . $login . PHP_EOL); return 1; }
        if (!AdminTotp::reset((int) $u['id'], null)) {
            fwrite(STDOUT, $u['nickname'] . ' 계정에는 등록된 2단계 인증이 없어요. 할 일이 없어요.' . PHP_EOL);
            return 0;
        }
        fwrite(STDOUT, '✔ ' . $u['nickname'] . ' 계정의 2단계 인증을 지웠어요. 이제 비밀번호만으로 관리자 센터에 들어갈 수 있어요.' . PHP_EOL
            . '  들어가자마자 🔐 2단계 인증 탭에서 새 휴대폰으로 다시 등록하세요' . (AdminTotp::mode() === 'required' ? ' (이 서버는 필수라서 로그인하면 등록 화면이 먼저 나와요).' : '.') . PHP_EOL);
        return 0;
    },
];

// Direct invocation (`php cli/admin-path.php <command>`): bootstrap, then dispatch. When cli/tfm.php loads this file
// as a plug-in, TFM_BOOT is already defined, so this block is skipped and the command map is returned instead.
if (!defined('TFM_BOOT')) {
    require __DIR__ . '/../lib/bootstrap.php';
    $argv = isset($_SERVER['argv']) ? $_SERVER['argv'] : [];
    $cmd = strtolower((string) (isset($argv[1]) ? $argv[1] : ''));
    if ($cmd === '' || !isset($tfmAdminCommands[$cmd])) {
        fwrite(STDERR, 'usage: php cli/admin-path.php <' . implode('|', array_keys($tfmAdminCommands)) . '> …' . PHP_EOL);
        exit(2);
    }
    exit((int) call_user_func($tfmAdminCommands[$cmd], array_slice($argv, 2)));
}

return $tfmAdminCommands;
