<?php
/**
 * cli/farm.php — 실시간 텃밭 commands (CONTRACT §15.1–15.3). Loaded as a plug-in by cli/tfm.php, which dispatches these as
 * `php cli/tfm.php <command>`; the file can also be run on its own: php cli/farm.php farm:scale
 *
 *   farm:scale              실시간 텃밭의 시간 배율을 보여 줘요 (1 = 진짜 시간, 60 = 60배 빠르게 — 수업 시연용)
 *   farm:scale <배율>        시간 배율을 바꿔요 (0.1 ~ 3600). 이미 자라고 있는 작물은 원래 다 자라는 시각을 지켜요
 *   farm:beds [계정]          텃밭 목록 — 계정(닉네임·이메일 일부 또는 #번호)을 적으면 그 계정의 최근 텃밭, 비우면 지금 자라는 중이거나
 *                            다 자란 텃밭 전부 (서버 시계로 잰 심은 시각 · 다 자라는 시각 · 남은 시간)
 *   farm:cleanup [일수]       오래된 기록 정리 — 수확했거나 뽑은 지 [일수](기본 90)일이 지났고 완료 확인 요청이 없는 텃밭 기록을 지워요
 *                            (자라는 중 · 다 자란 텃밭과 완료 확인 기록은 그대로 남아요)
 *
 * PHP 7.2 syntax only.
 */
declare(strict_types=1);

namespace Tfm;

if (PHP_SAPI !== 'cli') { if (function_exists('header_remove')) header_remove('X-Powered-By'); http_response_code(404); exit; }

/** one value of a player (nickname, e-mail) for the terminal: no control / bidi characters (CONTRACT §15.7 #5 review) */
$tfmFarmSafe = function (string $s): string {
    if (!mb_check_encoding($s, 'UTF-8')) $s = (string) mb_convert_encoding($s, 'UTF-8', 'UTF-8');
    $r = preg_replace('/[\x{0}-\x{1F}\x{7F}-\x{9F}\x{200E}\x{200F}\x{2028}\x{2029}\x{202A}-\x{202E}\x{2066}-\x{2069}]/u', '?', $s);
    return is_string($r) ? $r : (string) preg_replace('/[^\x20-\x7E]/', '?', $s);
};
/** ms → "2026-11-12 15:20" (server time zone), 0 → "-" */
$tfmFarmTime = function (int $ms): string { return $ms > 0 ? date('Y-m-d H:i', intdiv($ms, 1000)) : '-'; };
/** ms left → "1시간 5분" / "12분 30초" / "40초" */
$tfmFarmLeft = function (int $ms): string {
    $s = (int) ceil(max(0, $ms) / 1000);
    if ($s >= 3600) return intdiv($s, 3600) . '시간 ' . intdiv($s % 3600, 60) . '분';
    if ($s >= 60) return intdiv($s, 60) . '분 ' . ($s % 60) . '초';
    return $s . '초';
};

$tfmFarmCommands = [
    // -------------------------------------------------------------- farm:scale [n]
    'farm:scale' => function (array $args): int {
        $want = isset($args[0]) ? trim((string) $args[0]) : '';
        if ($want === '') {
            $from = class_exists('Tfm\Settings') && Settings::has('farm.rt_scale') ? '관리자 설정(settings 표)' : '설정 파일 기본값(config farm.rt_scale)';
            fwrite(STDOUT, '실시간 텃밭 시간 배율: ' . rtrim(rtrim(number_format(Farm::scale(), 4, '.', ''), '0'), '.') . '배   (' . $from . ')' . PHP_EOL
                . '  예) 1 = 진짜 시간 (박하 10분) · 60 = 60배 빠르게 (박하 10초) · 바꾸기: php cli/tfm.php farm:scale 60' . PHP_EOL);
            return 0;
        }
        if (!is_numeric($want) || !is_finite((float) $want)) { fwrite(STDERR, '✖ 배율은 숫자로 적어 주세요. (0.1 ~ 3600)' . PHP_EOL); return 1; }
        $before = Farm::scale();
        try {
            // the operator at the server machine acts as an admin; Settings::set audits it (setting_changed, no actor)
            Farm::setScale(['id' => 0, 'role' => 'admin'], (float) $want);
        } catch (ApiException $e) {
            fwrite(STDERR, '✖ ' . $e->getMessage() . PHP_EOL);
            return 1;
        }
        $fmt = function (float $f): string { return rtrim(rtrim(number_format($f, 4, '.', ''), '0'), '.'); };
        fwrite(STDOUT, '✔ 실시간 텃밭 시간 배율: ' . $fmt($before) . '배 → ' . $fmt(Farm::scale()) . '배' . PHP_EOL
            . '  이제부터 심는 작물에 적용돼요. 이미 자라고 있는 작물은 원래 다 자라는 시각을 지켜요.' . PHP_EOL);
        return 0;
    },

    // -------------------------------------------------------------- farm:beds [account]
    'farm:beds' => function (array $args) use ($tfmFarmSafe, $tfmFarmTime, $tfmFarmLeft): int {
        $q = trim(implode(' ', $args));
        $rows = $q === '' ? Farm::listBeds(['status' => 'active'], 200, 0) : Farm::listBeds(['q' => $q], 200, 0);
        $label = ['growing' => '자라는 중', 'ready' => '다 자람', 'harvested' => '수확함', 'cleared' => '뽑음'];
        foreach ($rows as $r) {
            $left = $r['status'] === 'growing' && $r['kind'] === 'rt' ? $tfmFarmLeft((int) $r['leftMs']) . ' 남음' : '';
            fwrite(STDOUT, sprintf('#%-5d %-16s %-4s %-4s %-8s %-8s 심음 %s · 다 자람 %s%s%s' . PHP_EOL,
                (int) $r['userId'], $tfmFarmSafe(mb_substr((string) $r['nickname'], 0, 16)), $r['kind'] === 'rt' ? '실시간' : '연습', $tfmFarmSafe((string) $r['bedId']),
                $tfmFarmSafe((string) $r['cropName']), isset($label[$r['status']]) ? $label[$r['status']] : (string) $r['status'],
                $tfmFarmTime((int) $r['firstSeenAt']), $tfmFarmTime((int) $r['readyAt']), $left !== '' ? ' · ' . $left : '',
                $r['report'] !== '' ? ' · 완료 확인 ' . ['pending' => '기다리는 중', 'approved' => '완료', 'rejected' => '돌려보냄'][$r['report']] : ''));
        }
        fwrite(STDOUT, count($rows) . '개' . ($q === '' ? ' (자라는 중 · 다 자람)' : '') . '   시간 배율 ' . rtrim(rtrim(number_format(Farm::scale(), 4, '.', ''), '0'), '.') . '배' . PHP_EOL);
        return 0;
    },

    // -------------------------------------------------------------- farm:cleanup [days]
    'farm:cleanup' => function (array $args): int {
        $d = isset($args[0]) ? trim((string) $args[0]) : '90';
        if (!ctype_digit($d) || (int) $d < 1 || (int) $d > 36500) { fwrite(STDERR, '✖ 일수는 1 이상의 정수로 적어 주세요. (기본 90)' . PHP_EOL); return 1; }
        $n = Farm::cleanup((int) $d);
        fwrite(STDOUT, '✔ ' . (int) $d . '일이 지난 끝난 텃밭 기록 ' . $n . '개를 정리했어요. (자라는 중 · 다 자란 텃밭과 완료 확인이 있는 기록은 그대로예요)' . PHP_EOL);
        return 0;
    },
];

// Direct invocation (`php cli/farm.php <command>`): bootstrap, then dispatch. When cli/tfm.php loads this file as a
// plug-in, TFM_BOOT is already defined, so this block is skipped and the command map is returned instead.
if (!defined('TFM_BOOT')) {
    require __DIR__ . '/../lib/bootstrap.php';
    $argv = isset($_SERVER['argv']) ? $_SERVER['argv'] : [];
    $cmd = strtolower((string) (isset($argv[1]) ? $argv[1] : ''));
    if ($cmd === '' || !isset($tfmFarmCommands[$cmd])) {
        fwrite(STDERR, 'usage: php cli/farm.php <' . implode('|', array_keys($tfmFarmCommands)) . '> …' . PHP_EOL);
        exit(2);
    }
    exit((int) call_user_func($tfmFarmCommands[$cmd], array_slice($argv, 2)));
}

return $tfmFarmCommands;
