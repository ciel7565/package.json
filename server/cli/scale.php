<?php
/**
 * capacity [--json]         수용 인원 · 부하 · 대기실 · 캐시의 지금 숫자 (CONTRACT §16.9, docs/SCALING-KO.md)
 * cache:purge               시간이 지난 캐시 항목 지우기 (cleanup 이 함께 해요)
 * cache:info                캐시가 어디에 있고 얼마나 큰지
 */
declare(strict_types=1);

if (PHP_SAPI !== 'cli') { if (function_exists('header_remove')) header_remove('X-Powered-By'); http_response_code(404); exit; }

use Tfm\Cache;
use Tfm\Config;
use Tfm\Gate;
use Tfm\Sync;

return [
    'capacity' => static function (array $args): int {
        $g = Gate::status();
        $s = Sync::status();
        $c = Cache::info(false);
        $after = ['n' => (int) Cache::get('st:after:n', 0), 'sql' => (int) Cache::get('st:after:sql', 0)];
        if (in_array('--json', $args, true)) {                                   // for tools/loadtest.mjs
            fwrite(STDOUT, json_encode(['gate' => $g, 'sync' => $s, 'cache' => $c, 'after' => $after], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) . PHP_EOL);
            return 0;
        }
        $line = static function (string $label, string $value): void { fwrite(STDOUT, '  ' . $label . str_repeat(' ', max(1, 24 - mb_strwidth($label, 'UTF-8'))) . $value . PHP_EOL); };
        fwrite(STDOUT, '수용 인원과 부하 (지금)' . PHP_EOL);
        $line('캐시 방식 (driver)', $c['driver'] . ($c['driver'] === 'file' ? ' — data/cache 폴더' : '') . ($c['driver'] === 'off' ? ' — 꺼짐: 동기화 · 대기실을 쓰지 않아요' : ''));
        $line('마을 안 (seats)', $g['seats'] . ' / ' . ($g['maxOnline'] > 0 ? $g['maxOnline'] . '명' : '제한 없음') . ($g['entering'] > 0 ? "  (들어오는 중 {$g['entering']}명)" : ''));
        $line('채널 (channels)', $s['channels'] . '개' . ($s['channels'] > 0 ? "  (가장 큰 채널 {$s['largest']}명 · 가장 작은 채널 {$s['smallest']}명 · 기준 {$s['size']}명, 최대 {$s['hard']}명)" : ''));
        $line('대기실 (waiting)', $g['waiting'] . '명' . ($g['admitPerMinute'] > 0 ? "  (1분에 약 {$g['admitPerMinute']}명씩 들어가요)" : '') . "  · 지금까지 나눠 준 대기표 {$g['ticketsIssued']}장");
        $line('초당 요청 (rps)', sprintf('%.0f', $g['rps']) . "  (평소 기준 {$g['targetRps']} · 줄이기 시작 " . ($g['shedRps'] > 0 ? (string) $g['shedRps'] : '꺼짐') . ')');
        $line('부하 배수 (load)', sprintf('%.2f', $g['load']) . '  (1.00 = 여유. 커질수록 다음 호출 간격을 늘려요)');
        $line('줄이기 (shedding)', $g['shedding'] === 0 ? '안 함' : ($g['shedding'] === 1 ? '1단계: 새 방문자 · 새 로그인은 잠시 뒤에' : '2단계: 읽기 요청도 잠시 뒤에'));
        $line('로그인 (지난 1초)', $g['loginsLastSecond'] . ' / ' . ($g['loginPerSec'] > 0 ? $g['loginPerSec'] . '번' : '제한 없음'));
        $line('자리 유지 (seat_ttl)', $g['seatTtl'] . '초');
        if ($after['n'] > 0) $line('응답 뒤 작업 (after)', $after['n'] . '번 · SQL ' . $after['sql'] . '개  (capacity.stats_header 가 켜져 있을 때만 세요)');
        if (PHP_SAPI === 'cli' && $c['apcuLoaded'] && (string) Config::get('cache.driver', 'auto') !== 'file') {
            fwrite(STDOUT, PHP_EOL . '  ※ 웹 서버가 메모리 캐시(APCu)를 쓰면 이 명령은 그 안을 볼 수 없어 숫자가 0 으로 보여요.' . PHP_EOL
                . '    그때는 관리자 페이지의 점검 화면을 보거나, config.local.php 에서 cache.driver 를 file 로 바꿔 주세요.' . PHP_EOL);
        }
        return 0;
    },
    'cache:purge' => static function (array $args): int {
        $r = Cache::purge();
        fwrite(STDOUT, "✔ 캐시 정리: {$r['removed']}개 지움, {$r['kept']}개 남김 ({$r['driver']})" . PHP_EOL);
        return 0;
    },
    'cache:info' => static function (array $args): int {
        foreach (Cache::info(true) as $k => $v) fwrite(STDOUT, sprintf('  %-12s %s', $k, is_bool($v) ? ($v ? 'yes' : 'no') : (string) $v) . PHP_EOL);
        return 0;
    },
];
