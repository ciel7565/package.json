<?php
/**
 * cli/ai.php — 🤖 AI 도우미 commands (CONTRACT §15.6 / §16.10). Loaded as a plug-in by cli/tfm.php, which dispatches these
 * as `php cli/tfm.php <command>`; the file can also be run on its own: php cli/ai.php ai:test
 *
 *   ai:test     아주 짧은 요청 하나를 보내 연결을 시험해요: 답한 모델 · 토큰 · 걸린 시간 · 보낸 요청(키는 ***)을 보여 줘요.
 *               키를 넣은 뒤 처음 한 번 해 보세요. 한 번에 1원 안팎이 들어요. 잘 되면 0, 안 되면 1을 돌려줘요.
 *   ai:status   설정(모델 · 생각하는 정도 · 하루 한도 · 옹이 선생님 켬/끔)과 오늘 쓴 양을 보여 줘요. 아무것도 보내지 않아요.
 *
 * The key is never printed, never taken from the command line (it lives in config.local.php or the environment).
 * PHP 7.2 syntax only.
 */
declare(strict_types=1);

namespace Tfm;

if (PHP_SAPI !== 'cli') { if (function_exists('header_remove')) header_remove('X-Powered-By'); http_response_code(404); exit; }

$tfmAiCommands = [
    // -------------------------------------------------------------- ai:status
    'ai:status' => function (array $args): int {
        $s = Claude::settings();
        $u = Claude::usageToday();
        fwrite(STDOUT, '🤖 AI 도우미 — ' . ($s['enabled'] ? '켜짐' : '꺼짐') . ($s['mock'] ? ' (모의 모드: 밖으로 보내지 않아요)' : '') . ' · 키 ' . ($s['keySet'] ? '있음 (화면에 보이지 않아요)' : '없음') . PHP_EOL);
        fwrite(STDOUT, sprintf("   모델 %s · 생각하는 정도 %s · 최대 토큰 %d · 기다리는 시간 %d초 · API 판 %s · 대신 답하기(fallbacks) %s%s\n",
            $s['model'], $s['effort'], $s['maxTokens'], $s['timeout'], $s['apiVersion'], $s['fallbacks'] ? '켬' : '끔', $s['curl'] ? '' : ' · ⚠ curl 확장이 없어요'));
        fwrite(STDOUT, sprintf("   옹이 선생님 %s · 한 계정 하루 %d번 · 서버 전체 하루 %d번\n", Claude::kidEnabled() ? '켬' : '끔', $s['capUser'], $s['capTotal']));
        fwrite(STDOUT, sprintf("   오늘: 질문 %d번 (아이 %d · 관리자 %d · 서버 명령 %d) · 실패 %d · 토큰 보냄 %d / 받음 %d\n", $u['total'],
            isset($u['byScope']['kid']) ? $u['byScope']['kid'] : 0, isset($u['byScope']['admin']) ? $u['byScope']['admin'] : 0, isset($u['byScope']['cli']) ? $u['byScope']['cli'] : 0,
            $u['failed'], $u['tokensIn'], $u['tokensOut']));
        return 0;
    },
    // -------------------------------------------------------------- ai:test
    'ai:test' => function (array $args): int {
        if (!Claude::configured()) {
            fwrite(STDERR, '✖ 키가 없어요. config/config.local.php 에 \'anthropic\' => [\'api_key\' => \'…\'] 를 넣거나 환경 변수 ANTHROPIC_API_KEY 를 설정한 뒤 다시 해 보세요.' . PHP_EOL);
            fwrite(STDERR, '  (키 없이 시험만 해 보려면 TFM_AI_MOCK=1 php cli/tfm.php ai:test)' . PHP_EOL);
            return 1;
        }
        $r = Claude::selfTest();
        $req = $r['request'];
        if (is_array($req)) {
            fwrite(STDOUT, '보낸 요청 (키는 ***):' . PHP_EOL . '  POST ' . $req['url'] . PHP_EOL);
            foreach ($req['headers'] as $hd) fwrite(STDOUT, '  ' . $hd . PHP_EOL);
            fwrite(STDOUT, '  ' . json_encode($req['body'], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) . PHP_EOL);
        }
        if ($r['ok']) {
            fwrite(STDOUT, sprintf("✔ 잘 연결됐어요%s — 답한 모델 %s%s · 토큰 보냄 %d / 받음 %d · %dms · 멈춘 까닭 %s · 답 \"%s\"\n", $r['mock'] ? ' (모의 모드)' : '',
                $r['model'], $r['fallback'] ? ' (대신 답한 모델)' : '', $r['usage']['in'], $r['usage']['out'], $r['ms'], $r['stop'], $r['text']));
            return 0;
        }
        fwrite(STDERR, '✖ 답을 받지 못했어요 — ' . Claude::scrub((string) $r['error']) . ' (' . (string) $r['code'] . ', ' . $r['ms'] . 'ms)' . PHP_EOL);
        $hint = [
            'auth' => '키가 맞는지 확인해 주세요 (앞뒤 빈칸, 지운 키, 다른 조직의 키).',
            'network' => '서버 컴퓨터가 인터넷(api.anthropic.com, 443번)에 나갈 수 있는지 확인해 주세요. 윈도우에서 인증서 오류(curl 60)면 anthropic.ca_file 에 cacert.pem 경로를 적어요.',
            'timeout' => 'anthropic.timeout(초)을 늘리거나 잠시 뒤에 다시 해 보세요.',
            'not_found' => 'anthropic.model 이름이 맞는지 확인해 주세요.',
            'rate' => '잠시 뒤에 다시 해 보세요 (요청이 너무 많아요).',
            'overloaded' => '잠시 뒤에 다시 해 보세요 (서비스가 붐벼요).',
            'capped' => '오늘의 서버 전체 한도(⚙️ 설정 → 🧩 기타)를 다 썼어요.',
        ];
        $code = (string) $r['code'];
        if (isset($hint[$code])) fwrite(STDERR, '  → ' . $hint[$code] . PHP_EOL);
        return 1;
    },
];

// Direct invocation (`php cli/ai.php <command>`): bootstrap, then dispatch. When cli/tfm.php loads this file as a
// plug-in, TFM_BOOT is already defined, so this block is skipped and the command map is returned instead.
if (!defined('TFM_BOOT')) {
    require __DIR__ . '/../lib/bootstrap.php';
    $argv = isset($_SERVER['argv']) ? $_SERVER['argv'] : [];
    $cmd = strtolower((string) (isset($argv[1]) ? $argv[1] : ''));
    if ($cmd === '' || !isset($tfmAiCommands[$cmd])) {
        fwrite(STDERR, 'usage: php cli/ai.php <' . implode('|', array_keys($tfmAiCommands)) . '>' . PHP_EOL);
        exit(2);
    }
    exit((int) call_user_func($tfmAiCommands[$cmd], array_slice($argv, 2)));
}

return $tfmAiCommands;
