<?php
/**
 * cli/inspect.php — 서버 점검 (CONTRACT §15.5). Loaded as a plug-in by cli/tfm.php, which dispatches these as
 * `php cli/tfm.php <command>`; the file can also be run on its own: php cli/inspect.php inspect
 *
 *   inspect                시스템 점검 · 보안 설정 점검 · 노출 검사 · DB 계정 · 버전 · 인수인계 상태를 한 번에 실행해서 보여 주고
 *                          기록해요 (관리자 센터 🧑‍💻 개발자 → 점검 실행 과 같은 내용). 위험(⛔)이 하나라도 있으면 종료 코드 1
 *   inspect --markdown     같은 점검을 Markdown 보고서로 출력해요 (파일로: php cli/tfm.php inspect --markdown > 점검.md)
 *   inspect:runs [개수]     지난 점검 기록 (기본 20개, 최근 것부터)
 *
 * PHP 7.2 syntax only.
 */
declare(strict_types=1);

namespace Tfm;

if (PHP_SAPI !== 'cli') { if (function_exists('header_remove')) header_remove('X-Powered-By'); http_response_code(404); exit; }

/** a value for the terminal: no control / bidi characters */
$tfmInspSafe = function (string $s): string {
    if (!mb_check_encoding($s, 'UTF-8')) $s = (string) mb_convert_encoding($s, 'UTF-8', 'UTF-8');
    $r = preg_replace('/[\x{0}-\x{1F}\x{7F}-\x{9F}\x{200E}\x{200F}\x{2028}\x{2029}\x{202A}-\x{202E}\x{2066}-\x{2069}]/u', '?', $s);
    return is_string($r) ? $r : (string) preg_replace('/[^\x20-\x7E]/', '?', $s);
};

$tfmInspCommands = [
    // -------------------------------------------------------------- inspect [--markdown]
    'inspect' => function (array $args) use ($tfmInspSafe): int {
        $md = in_array('--markdown', $args, true) || in_array('--md', $args, true);
        $run = Inspect::run('cli', null);
        if ($md) {
            fwrite(STDOUT, Inspect::markdown($run));
            return $run['status'] === 'fail' ? 1 : 0;
        }
        $icon = ['ok' => '✅', 'warn' => '⚠️ ', 'fail' => '⛔'];
        fwrite(STDOUT, '🔎 서버 점검 #' . $run['id'] . ' — ' . date('Y-m-d H:i:s', intdiv($run['createdAt'], 1000)) . PHP_EOL . PHP_EOL);
        foreach ($run['versions'] as $k => $v) fwrite(STDOUT, sprintf('  %-10s %s', $k, $tfmInspSafe((string) $v)) . PHP_EOL);
        $by = [];
        foreach ($run['checks'] as $c) $by[$c['group']][] = $c;
        foreach (Inspect::GROUPS + ['?' => '기타'] as $g => $title) {
            $rows = isset($by[$g]) ? $by[$g] : [];
            if ($g === '?') foreach ($by as $k => $list) if (!isset(Inspect::GROUPS[$k])) $rows = array_merge($rows, $list);
            if (!$rows) continue;
            fwrite(STDOUT, PHP_EOL . $title . PHP_EOL);
            foreach ($rows as $c) {
                $hint = $c['status'] !== 'ok' && $c['hint'] !== '' ? PHP_EOL . '       → ' . $tfmInspSafe($c['hint']) : '';
                fwrite(STDOUT, sprintf('  %s %s  %s%s', isset($icon[$c['status']]) ? $icon[$c['status']] : '·', $tfmInspSafe($c['label']), $tfmInspSafe($c['value']), $hint) . PHP_EOL);
            }
        }
        $s = $run['summary'];
        fwrite(STDOUT, PHP_EOL . sprintf('종합: %s  (정상 %d · 주의 %d · 위험 %d) — 기록 #%d (관리자 센터 🧑‍💻 개발자 → 점검 실행에서 다시 보고 Markdown 으로 내려받을 수 있어요)',
            $run['status'] === 'fail' ? '⛔ 위험' : ($run['status'] === 'warn' ? '⚠️  주의' : '✅ 정상'), $s['ok'], $s['warn'], $s['fail'], $run['id']) . PHP_EOL);
        return $run['status'] === 'fail' ? 1 : 0;
    },

    // -------------------------------------------------------------- inspect:runs [n]
    'inspect:runs' => function (array $args) use ($tfmInspSafe): int {
        $n = isset($args[0]) && ctype_digit((string) $args[0]) ? max(1, min(200, (int) $args[0])) : 20;
        $rows = Inspect::runs($n, 0);
        if (!$rows) { fwrite(STDOUT, '아직 점검 기록이 없어요. php cli/tfm.php inspect 로 첫 점검을 해 보세요.' . PHP_EOL); return 0; }
        $icon = ['ok' => '✅', 'warn' => '⚠️ ', 'fail' => '⛔'];
        foreach ($rows as $r) {
            fwrite(STDOUT, sprintf('#%-5d %s  %s %-5s %s  %s', $r['id'], date('Y-m-d H:i', intdiv($r['createdAt'], 1000)), isset($icon[$r['status']]) ? $icon[$r['status']] : '·',
                $r['source'], $r['actorNick'] !== '' ? $tfmInspSafe($r['actorNick']) : '-', $tfmInspSafe($r['summary'])) . PHP_EOL);
        }
        return 0;
    },
];

// Direct invocation (`php cli/inspect.php <command>`): bootstrap, then dispatch. When cli/tfm.php loads us as a plug-in,
// TFM_BOOT is already defined, so this block is skipped and the map is returned instead.
if (!defined('TFM_BOOT')) {
    require __DIR__ . '/../lib/bootstrap.php';
    $argv = isset($_SERVER['argv']) ? $_SERVER['argv'] : [];
    $cmd = strtolower((string) (isset($argv[1]) ? $argv[1] : ''));
    if ($cmd === '' || !isset($tfmInspCommands[$cmd])) {
        fwrite(STDERR, 'usage: php cli/inspect.php <' . implode('|', array_keys($tfmInspCommands)) . '> [--markdown]' . PHP_EOL);
        exit(2);
    }
    exit((int) call_user_func($tfmInspCommands[$cmd], array_slice($argv, 2)));
}

return $tfmInspCommands;
