<?php
/**
 * cli/support.php — 신고·문의 commands (CONTRACT §18.1). Loaded as a plug-in by cli/tfm.php, which dispatches these as
 * `php cli/tfm.php <command>`; the file can also be run on its own: php cli/support.php support:status
 *
 *   support:status            받은 신고·문의 수 (새 글 · 확인 중 · 답변함 · 닫음) 와 지금의 한도·보관 기간
 *   support:cleanup [최대 수]  보관 기간(⚙️ 설정 → 📮 신고·문의 → 보관 기간)이 지난 문의를 지워요 — 닫은 것부터, 글·답·사진 모두.
 *                            한 번에 [최대 수](기본 2000, 최대 5000)개. 작업 스케줄러(cron)에서 하루 한 번 돌리면 돼요.
 *
 * PHP 7.2 syntax only.
 */
declare(strict_types=1);

namespace Tfm;

if (PHP_SAPI !== 'cli') { if (function_exists('header_remove')) header_remove('X-Powered-By'); http_response_code(404); exit; }

$tfmSupportCommands = [
    // -------------------------------------------------------------- support:status
    'support:status' => function (array $args): int {
        $c = Support::counts();
        $l = Support::limits();
        fwrite(STDOUT, sprintf("📮 신고·문의 — 새 글 %d · 확인 중 %d · 답변함 %d · 닫음 %d (전체 %d)\n", $c['new'], $c['open'], $c['answered'], $c['closed'], $c['all']));
        fwrite(STDOUT, sprintf("   받기 %s · 화면 사진 %s · 계정마다 한 시간 %d번 · 하루 %d번 · 답을 기다리는 문의 %d개 · 보관 %d일 · 사진 %dKB까지\n",
            Support::enabled() ? '켬' : '끔', Support::shotsOn() ? '켬' : '끔', $l['hour'], $l['day'], $l['open'], $l['keep_days'], intdiv($l['shot_bytes'], 1024)));
        return 0;
    },
    // -------------------------------------------------------------- support:cleanup [max]
    'support:cleanup' => function (array $args): int {
        $m = isset($args[0]) ? trim((string) $args[0]) : '2000';
        if (!ctype_digit($m) || (int) $m < 1 || (int) $m > 5000) { fwrite(STDERR, '✖ 최대 수는 1 ~ 5000 사이의 정수로 적어 주세요. (기본 2000)' . PHP_EOL); return 1; }
        $n = Support::cleanup(null, (int) $m);
        fwrite(STDOUT, '✔ 보관 기간(' . Support::limits()['keep_days'] . '일)이 지난 문의 ' . $n . '개를 지웠어요. (글·답·사진 모두)' . PHP_EOL);
        return 0;
    },
];

// Direct invocation (`php cli/support.php <command>`): bootstrap, then dispatch. When cli/tfm.php loads this file as a
// plug-in, TFM_BOOT is already defined, so this block is skipped and the command map is returned instead.
if (!defined('TFM_BOOT')) {
    require __DIR__ . '/../lib/bootstrap.php';
    $argv = isset($_SERVER['argv']) ? $_SERVER['argv'] : [];
    $cmd = strtolower((string) (isset($argv[1]) ? $argv[1] : ''));
    if ($cmd === '' || !isset($tfmSupportCommands[$cmd])) {
        fwrite(STDERR, 'usage: php cli/support.php <' . implode('|', array_keys($tfmSupportCommands)) . '> …' . PHP_EOL);
        exit(2);
    }
    exit((int) call_user_func($tfmSupportCommands[$cmd], array_slice($argv, 2)));
}

return $tfmSupportCommands;
