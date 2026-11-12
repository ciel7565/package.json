<?php
/**
 * cli/security.php — operator security commands (CONTRACT §15.7 #5 #8). Loaded as a plug-in by cli/tfm.php, which
 * dispatches these as `php cli/tfm.php <command>`; the file can also be run on its own:
 *   php cli/security.php config:check
 *
 *   config:check                     환경·설정 안전 점검 (ConfigAudit + DB 계정) — 위험(⛔)이 하나라도 있으면 종료 코드 1
 *   security:events [개수]            최근 보안 기록 (security_events) — 기본 50건
 *   ip:block <IP> [초] [사유…]        한 인터넷 주소를 차단 (기본 1800초)
 *   ip:unblock <IP|해시>              차단 해제
 *
 * PHP 7.2 syntax only.
 */
declare(strict_types=1);

namespace Tfm;

$icon = ['ok' => '✅', 'warn' => '⚠️ ', 'fail' => '⛔'];

$handlers = [
    // -------------------------------------------------------------- config:check
    'config:check' => function (array $args) use ($icon) {
        $rows = ConfigAudit::run();
        foreach ($rows as $r) {
            fwrite(STDOUT, sprintf("  %s %s  %s%s" . PHP_EOL,
                isset($icon[$r['status']]) ? $icon[$r['status']] : '·',
                str_pad($r['label'], 34),
                is_string($r['value']) ? $r['value'] : json_encode($r['value'], JSON_UNESCAPED_UNICODE),
                $r['hint'] !== '' ? PHP_EOL . '       → ' . $r['hint'] : ''));
        }
        // the live database account (this one connects; ConfigAudit above only read the config)
        $dbFail = false;
        try {
            $db = Db::accountAudit();
            if (($db['driver']) === 'mysql') {
                $dbFail = !empty($db['isRoot']) || !empty($db['emptyPassword']) || !empty($db['globalPrivileges']);
                $st = $dbFail ? 'fail' : (!empty($db['ddlPrivileges']) ? 'warn' : 'ok');
                $note = $dbFail ? '운영에서는 앱 전용 계정(DML 권한만)을 쓰세요.' : (!empty($db['ddlPrivileges']) ? '이 계정에 DDL(테이블 변경) 권한이 있어요. 업그레이드는 관리자 계정으로만.' : '');
                fwrite(STDOUT, sprintf("  %s %s  %s@%s%s%s" . PHP_EOL, $icon[$st], str_pad('DB 실행 계정(접속 확인)', 34),
                    (string) $db['user'], (string) $db['host'], !empty($db['isRoot']) ? ' · root' : (!empty($db['emptyPassword']) ? ' · 빈 비밀번호' : ''),
                    $note !== '' ? PHP_EOL . '       → ' . $note : ''));
            }
        } catch (\Throwable $e) { /* DB not reachable: the config-side row already covered it */ }
        $sum = ConfigAudit::summary($rows);
        $fail = $sum['fail'] > 0 || $dbFail;
        fwrite(STDOUT, PHP_EOL . sprintf("종합: %s  (정상 %d · 주의 %d · 위험 %d)" . PHP_EOL,
            $fail ? $icon['fail'] . ' 위험' : ($sum['warn'] > 0 ? $icon['warn'] . ' 주의' : $icon['ok'] . ' 정상'), $sum['ok'], $sum['warn'], $sum['fail'] + ($dbFail ? 1 : 0)));
        return $fail ? 1 : 0;
    },

    // -------------------------------------------------------------- security:events
    'security:events' => function (array $args) {
        $limit = isset($args[0]) && ctype_digit((string) $args[0]) ? max(1, min(500, (int) $args[0])) : 50;
        $rows = SecEvent::recent([], $limit);
        foreach (array_reverse($rows) as $r) {
            fwrite(STDOUT, sprintf("%s  %-16s %-6s %-39s %s" . PHP_EOL,
                date('Y-m-d H:i:s', intdiv((int) $r['created_at'], 1000)),
                (string) $r['kind'], (string) $r['severity'], (string) $r['ip'], (string) $r['path']));
        }
        fwrite(STDOUT, count($rows) . '건' . PHP_EOL);
        return 0;
    },

    // -------------------------------------------------------------- ip:block
    'ip:block' => function (array $args) {
        $ip = (string) (isset($args[0]) ? $args[0] : '');
        $secs = isset($args[1]) && ctype_digit((string) $args[1]) ? (int) $args[1] : 1800;
        $reason = count($args) > 2 ? implode(' ', array_slice($args, 2)) : '관리자 수동 차단 (CLI)';
        try {
            Firewall::block($ip, $secs, $reason, null);
        } catch (ApiException $e) {
            fwrite(STDERR, '✖ ' . $e->getMessage() . PHP_EOL);
            return 1;
        }
        fwrite(STDOUT, "✔ {$ip} 를 {$secs}초 동안 차단했어요." . PHP_EOL);
        return 0;
    },

    // -------------------------------------------------------------- ip:unblock
    'ip:unblock' => function (array $args) {
        $ip = (string) (isset($args[0]) ? $args[0] : '');
        if ($ip === '') { fwrite(STDERR, '✖ 인터넷 주소(IP) 또는 해시를 적어 주세요.' . PHP_EOL); return 1; }
        $ok = Firewall::unblock($ip, null);
        fwrite(STDOUT, $ok ? "✔ {$ip} 차단을 풀었어요." . PHP_EOL : "차단 중인 주소가 아니에요: {$ip}" . PHP_EOL);
        return $ok ? 0 : 1;
    },
];

// Direct invocation (`php cli/security.php <command>`): bootstrap, then dispatch. When cli/tfm.php loads us as a
// plug-in, TFM_BOOT is already defined, so this block is skipped and the map is returned instead.
if (!defined('TFM_BOOT')) {
    if (PHP_SAPI !== 'cli') { if (function_exists('header_remove')) header_remove('X-Powered-By'); http_response_code(404); exit; }
    require __DIR__ . '/../lib/bootstrap.php';
    $argv = isset($_SERVER['argv']) ? $_SERVER['argv'] : [];
    $cmd = strtolower((string) (isset($argv[1]) ? $argv[1] : ''));
    if ($cmd === '' || !isset($handlers[$cmd])) {
        fwrite(STDERR, 'usage: php cli/security.php <' . implode('|', array_keys($handlers)) . '>' . PHP_EOL);
        exit(2);
    }
    exit((int) call_user_func($handlers[$cmd], array_slice($argv, 2)));
}

return $handlers;
