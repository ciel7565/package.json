<?php
/**
 * cli/allot.php — 분양(만 개의 장독대: 항아리 · 밭 · 창고) 명령 (CONTRACT §16.7). cli/tfm.php 가 추가 명령으로 불러와서
 * `php cli/tfm.php <명령>` 으로 실행해요. 이 파일만 따로 실행해도 돼요: php cli/allot.php allot:status
 *
 *   allot:seed [--preset default|small] [--open]
 *                           분양 구역과 자리를 만들어요. default = 장독대 6구역 × 1,000 + 텃밭 3구역 × 1,000 + 창고 2동 × 500
 *                           = 10,000개 (small = 180개, 시험용). 여러 번 실행해도 같은 결과예요 — 이미 있는 구역과 자리,
 *                           운영자가 바꾼 이름 · 가격은 건드리지 않고 모자란 자리만 채워요. 새 구역은 ‘신청 받지 않음’
 *                           으로 만들어져요 (가격 · 기간은 예시). --open 을 붙이면 바로 신청을 받아요 (시험 사이트용).
 *   allot:tick [--quiet]    자동 처리를 한 번 돌려요: 기한이 지난 미납 신청 정리, 자동 확정 · 연장, 납부 · 만료 안내, 미납 표시,
 *                           대기자에게 자리 제안, 예약한 안내 보내기, 하루 통계, 장부 점검. 작업 스케줄러에 한 시간에 한 번
 *                           등록해 두세요. --quiet = 한 일이 없으면 아무것도 적지 않아요. 문제가 있으면 종료 코드 1.
 *   allot:status            분양 현황 한눈에: 자리 · 계약 · 대기 · 손으로 보낼 안내 · 마지막 자동 처리 · 장부 점검 결과
 *   allot:export <종류> [파일] [--reveal --reason <사유>] [--force]
 *                           표(CSV, 엑셀에서 바로 열려요)로 내보내요. 종류: units · contracts · customers · payments ·
 *                           waitlist · ledger(운영 장부 모양: 일자 · 성명 · 연락처 · 주소 · 비고 · 단위).
 *                           파일을 적지 않으면 data/exports/ 아래에 만들어요. 이름 · 전화번호는 가려서 나가요 ("김**").
 *                           --reveal 은 가리지 않고 내보내요: --reason 에 사유를 꼭 적어야 하고 (call · payment ·
 *                           delivery · correction · request · report · other) 감사 기록에 남아요.
 *   allot:import <종류> <파일> [--commit]
 *                           표(CSV)를 가져와요. 종류: ledger(운영 장부 — 줄마다 고객과 진행 중인 계약을 만들어요) ·
 *                           payments(입금 내역). --commit 없이 실행하면 아무것도 바꾸지 않고 무엇이 만들어질지, 어느 줄이
 *                           잘못됐는지만 알려 줘요. 한 줄이라도 잘못되면 --commit 도 아무것도 가져오지 않아요.
 *                           같은 파일을 두 번 가져와도 두 번 만들어지지 않아요.
 *   allot:demo [--count N]  시험 사이트용 예시 자료: 가짜 고객("예시고객01", 전화 010-0000-00NN)과 여러 상태의 계약 N건(기본 40).
 *                           이미 고객이나 계약이 있으면 만들지 않아요 (진짜 장부와 섞이지 않게).
 *   allot:demo --clear      allot:demo 가 만든 것만 다시 지워요 (구역과 자리는 남아요).
 *
 * PHP 7.2 syntax only.
 */
declare(strict_types=1);

namespace Tfm;

if (PHP_SAPI !== 'cli') { if (function_exists('header_remove')) header_remove('X-Powered-By'); http_response_code(404); exit; }

/** the operator at the server machine acts as an admin without an account (audit rows carry no actor id) */
$tfmAllotActor = ['id' => 0, 'role' => 'admin'];
/** arguments → [positional values, flags]; --preset / --reason / --count take the next word, every other --flag is a switch */
$tfmAllotArgs = function (array $args): array {
    $pos = [];
    $flags = [];
    for ($i = 0, $n = count($args); $i < $n; $i++) {
        $a = (string) $args[$i];
        if (strncmp($a, '--', 2) !== 0) { $pos[] = $a; continue; }
        $k = substr($a, 2);
        $v = true;
        if (strpos($k, '=') !== false) { list($k, $v) = explode('=', $k, 2); }
        elseif (in_array($k, ['preset', 'reason', 'count'], true) && $i + 1 < $n && strncmp((string) $args[$i + 1], '--', 2) !== 0) { $v = (string) $args[++$i]; }
        $flags[$k] = $v;
    }
    return [$pos, $flags];
};
/** 12345 → "12,345" */
$tfmAllotNum = function (int $n): string { return number_format($n); };
/** ms → "2026-11-14 15:20" (server time zone), 0 → "-" */
$tfmAllotTime = function (int $ms): string { return $ms > 0 ? date('Y-m-d H:i', intdiv($ms, 1000)) : '-'; };
/** a duration in ms → "3일" / "5시간" / "12분" */
$tfmAllotAge = function (int $ms): string {
    $m = intdiv(max(0, $ms), 60000);
    if ($m >= 2880) return intdiv($m, 1440) . '일';
    if ($m >= 120) return intdiv($m, 60) . '시간';
    return $m . '분';
};
/** text from a file or a row for the terminal: no control / bidi characters */
$tfmAllotSafe = function (string $s): string {
    if (!mb_check_encoding($s, 'UTF-8')) $s = (string) mb_convert_encoding($s, 'UTF-8', 'UTF-8');
    $r = preg_replace('/[\x{0}-\x{1F}\x{7F}-\x{9F}\x{200E}\x{200F}\x{2028}\x{2029}\x{202A}-\x{202E}\x{2066}-\x{2069}]/u', '?', $s);
    return is_string($r) ? $r : (string) preg_replace('/[^\x20-\x7E]/', '?', $s);
};
/** is $path inside $dir (both made absolute; the file itself need not exist yet) */
$tfmAllotInside = function (string $path, string $dir): bool {
    $d = realpath($dir);
    $p = realpath(dirname($path));
    if ($d === false || $p === false) return false;
    $d = rtrim(str_replace('\\', '/', $d), '/') . '/';
    $p = rtrim(str_replace('\\', '/', $p), '/') . '/';
    return strncasecmp($p, $d, strlen($d)) === 0;
};

$tfmAllotCommands = [
    // -------------------------------------------------------------- allot:seed [--preset default|small] [--open]
    'allot:seed' => function (array $args) use ($tfmAllotActor, $tfmAllotArgs, $tfmAllotNum): int {
        list($pos, $f) = $tfmAllotArgs($args);
        $preset = isset($f['preset']) && is_string($f['preset']) ? $f['preset'] : (isset($pos[0]) ? $pos[0] : 'default');
        $open = !empty($f['open']);
        $t0 = microtime(true);
        try {
            $r = Allot::seedPreset($tfmAllotActor, $preset, $open);
        } catch (ApiException $e) {
            fwrite(STDERR, '✖ ' . $e->getMessage() . PHP_EOL);
            return 1;
        }
        fwrite(STDOUT, sprintf('✔ 분양 자리 준비 (묶음 %s): 구역 %s곳 · 자리 %s개   — 이번에 만든 구역 %s곳 · 자리 %s개 (%.1f초)',
            $r['preset'], $tfmAllotNum((int) $r['zones']), $tfmAllotNum((int) $r['units']), $tfmAllotNum((int) $r['created']), $tfmAllotNum((int) $r['added']), microtime(true) - $t0) . PHP_EOL);
        if ((int) $r['created'] > 0 && !$open) {
            fwrite(STDOUT, '  새 구역은 ‘신청 받지 않음’ 상태이고 가격 · 기간은 예시예요. 관리자 페이지 › 분양 › 구역에서 확인한 뒤 신청을 열어 주세요.' . PHP_EOL);
        } elseif ((int) $r['created'] === 0 && (int) $r['added'] === 0) {
            fwrite(STDOUT, '  이미 다 만들어져 있어서 바꾼 것이 없어요.' . PHP_EOL);
        }
        return 0;
    },

    // -------------------------------------------------------------- allot:tick [--quiet]
    'allot:tick' => function (array $args) use ($tfmAllotArgs, $tfmAllotSafe): int {
        list(, $f) = $tfmAllotArgs($args);
        $label = ['holds' => '기한이 지난 신청 정리', 'approved' => '자동 확정', 'renewed' => '자동 연장', 'notices' => '납부 · 만료 안내 만들기', 'overdue' => '미납 표시', 'ended' => '계약 끝냄',
            'offers' => '대기 제안 정리', 'sent' => '안내 보냄', 'stats' => '통계 줄', 'healed' => '장부 바로잡음', 'purged' => '오래된 개인정보 지움'];
        $sum = array_fill_keys(array_keys($label), 0);
        $errors = [];
        $issues = [];
        $paidPending = 0;
        $mail = 'off';
        $runs = 0;
        $more = false;
        do {
            $r = Allot::tick(null, 'cli');
            $runs++;
            foreach ($r['steps'] as $k => $n) { if (isset($sum[$k])) $sum[$k] = $k === 'stats' ? max($sum[$k], (int) $n) : $sum[$k] + (int) $n; }
            foreach ($r['errors'] as $e) $errors[] = (string) $e;
            $issues = $r['issues'];
            $paidPending = (int) $r['paidPending'];
            if ($r['mail'] !== 'off') $mail = (string) $r['mail'];
            $more = !empty($r['more']);
        } while ($more && !$errors && $runs < 40);
        $did = [];
        foreach ($sum as $k => $n) { if ($n > 0 && $k !== 'stats') $did[] = $label[$k] . ' ' . number_format($n); }
        $quiet = !empty($f['quiet']) && !$did && !$errors && !$issues && $paidPending === 0;
        if (!$quiet) {
            fwrite(STDOUT, ($errors ? '⚠ ' : '✔ ') . '분양 자동 처리' . ($runs > 1 ? ' (' . $runs . '번 이어서)' : '') . ': ' . ($did ? implode(' · ', $did) : '할 일이 없었어요') . PHP_EOL);
            if ($more) fwrite(STDOUT, '  아직 남은 일이 있어요. 다음 실행에서 이어서 해요.' . PHP_EOL);
            if ($paidPending > 0) fwrite(STDOUT, '  ※ 입금은 확인됐는데 아직 확정하지 않은 신청이 ' . $paidPending . '건 있어요 (자동으로 취소하지 않아요). 관리자 페이지에서 확정해 주세요.' . PHP_EOL);
            if ($issues) {
                fwrite(STDOUT, '  ※ 장부 점검에서 확인이 필요한 항목 ' . count($issues) . '건:' . PHP_EOL);
                foreach (array_slice($issues, 0, 10) as $it) fwrite(STDOUT, '     - ' . $tfmAllotSafe((string) $it['kind'] . ' ' . (string) $it['ref'] . ' — ' . (string) $it['note']) . PHP_EOL);
            }
            if ($mail === 'sent') fwrite(STDOUT, '  오늘의 요약 메일을 보냈어요.' . PHP_EOL);
            elseif ($mail === 'failed') fwrite(STDOUT, '  ⚠ 오늘의 요약 메일을 보내지 못했어요 (서버의 메일 설정을 확인해 주세요).' . PHP_EOL);
        }
        foreach ($errors as $e) fwrite(STDERR, '✖ 단계에서 오류가 났어요: ' . $tfmAllotSafe($e) . ' (자세한 내용은 data/logs)' . PHP_EOL);
        return $errors ? 1 : 0;
    },

    // -------------------------------------------------------------- allot:status
    'allot:status' => function (array $args) use ($tfmAllotNum, $tfmAllotTime, $tfmAllotAge, $tfmAllotSafe): int {
        $s = Allot::adminSummary();
        $u = $s['units'];
        $n = $tfmAllotNum;
        $rules = $s['rules'];
        $names = Allot::KIND_NAMES;
        fwrite(STDOUT, '분양 현황 — ' . $tfmAllotTime(Clock::ms()) . PHP_EOL);
        fwrite(STDOUT, '  기능: ' . (Allot::enabled() ? '켜짐' : '꺼짐 (체험관에서 보이지 않아요)') . ' · 온라인 결제(토스): ' . ($s['toss'] ? '켜짐' : '꺼짐')
            . ' · 자동 확정: ' . ['off' => '안 함 (운영자가 확정)', 'on_payment' => '입금이 확인되면', 'always' => '신청 즉시'][(string) $rules['auto_approve']] . PHP_EOL);
        fwrite(STDOUT, sprintf('  자리: 전체 %s · 빈 자리 %s · 신청 중(잡아 둠) %s · 분양됨 %s · 닫음 %s', $n((int) $u['total']), $n((int) $u['open']), $n((int) $u['held']), $n((int) $u['leased']), $n((int) $u['closed'])) . PHP_EOL);
        foreach ($u['byKind'] as $kind => $k) {
            if ((int) $k['total'] < 1) continue;
            fwrite(STDOUT, sprintf('    %s %s (빈 자리 %s · 분양됨 %s)', isset($names[$kind]) ? $names[$kind] : $kind, $n((int) $k['total']), $n((int) $k['open']), $n((int) $k['leased'])) . PHP_EOL);
        }
        $closed = 0;
        foreach ($s['zones'] as $z) { if (empty($z['isOpen'])) $closed++; }
        fwrite(STDOUT, '  구역: ' . count($s['zones']) . '곳' . ($closed > 0 ? ' (신청을 받지 않는 구역 ' . $closed . '곳)' : '') . PHP_EOL);
        fwrite(STDOUT, sprintf('  계약: 확정 기다림 %s (입금 확인된 것 %s · 24시간 안에 기한이 끝나는 것 %s) · 진행 중 %s · 미납 %s · 30일 안에 끝남 %s · 해지 요청 %s',
            $n((int) $s['pending']), $n((int) $s['pendingPaid']), $n((int) $s['holdsExpiring']), $n((int) $s['active']), $n((int) $s['overdue']), $n((int) $s['expiring30']), $n((int) $s['cancelRequests'])) . PHP_EOL);
        fwrite(STDOUT, sprintf('  대기 신청: %s (자리 제안 중 %s) · 손으로 보낼 안내(앱 계정이 없는 고객): %s건 · 환불을 확인할 취소: %s건',
            $n((int) $s['waiting']), $n((int) $s['offered']), $n((int) $s['noticesOffline']), $n((int) $s['refundDue'])) . PHP_EOL);
        $run = $s['lastRun'];
        if ($run === null) {
            fwrite(STDOUT, '  자동 처리: 아직 한 번도 돌지 않았어요 → php cli/tfm.php allot:tick 을 작업 스케줄러에 한 시간에 한 번 등록해 주세요.' . PHP_EOL);
        } else {
            $age = $s['tickAgeMs'] === null ? 0 : (int) $s['tickAgeMs'];
            fwrite(STDOUT, '  자동 처리: 마지막 실행 ' . $tfmAllotTime((int) $run['startedAt']) . ' (' . $tfmAllotAge(Clock::ms() - (int) $run['startedAt']) . ' 전, '
                . ['cli' => '스케줄러 · 명령줄', 'lazy' => '방문이 있을 때 자동', 'admin' => '관리자 페이지'][(string) $run['source']] . ') — ' . (!empty($run['ok']) ? '정상' : '⚠ 오류가 있었어요 (data/logs)')
                . ($age > 3 * 3600000 ? '   ⚠ 3시간 넘게 돌지 않았어요: 작업 스케줄러 등록을 확인해 주세요.' : '') . PHP_EOL);
        }
        $chk = Allot::integrity(50, false);
        if (!$chk['issues']) {
            fwrite(STDOUT, '  장부 점검: 문제 없음 (한 자리에 계약 하나, 자리 상태와 계약 상태가 맞아요)' . PHP_EOL);
        } else {
            fwrite(STDOUT, '  장부 점검: ⚠ 확인이 필요한 항목 ' . count($chk['issues']) . '건' . PHP_EOL);
            foreach (array_slice($chk['issues'], 0, 10) as $it) fwrite(STDOUT, '     - ' . $tfmAllotSafe((string) $it['kind'] . ' ' . (string) $it['ref'] . ' — ' . (string) $it['note']) . PHP_EOL);
        }
        $demo = Allot::demoInfo();
        if ($demo !== null) fwrite(STDOUT, '  ※ 예시 자료(allot:demo)가 들어 있어요: 가짜 고객 ' . count($demo['customers']) . '명. 지우려면 php cli/tfm.php allot:demo --clear' . PHP_EOL);
        return 0;
    },

    // -------------------------------------------------------------- allot:export <what> [file] [--reveal --reason <code>] [--force]
    'allot:export' => function (array $args) use ($tfmAllotActor, $tfmAllotArgs, $tfmAllotInside): int {
        list($pos, $f) = $tfmAllotArgs($args);
        $what = isset($pos[0]) ? strtolower($pos[0]) : '';
        if (!in_array($what, Allot::EXPORTS, true)) {
            fwrite(STDERR, '✖ 내보낼 종류를 적어 주세요: ' . implode(' · ', Allot::EXPORTS) . PHP_EOL . '  예) php cli/tfm.php allot:export ledger' . PHP_EOL);
            return 1;
        }
        $reveal = !empty($f['reveal']);
        $why = isset($f['reason']) && is_string($f['reason']) ? $f['reason'] : '';
        if ($reveal && !isset(Allot::REVEAL_REASONS[$why])) {
            fwrite(STDERR, '✖ 이름 · 전화번호를 가리지 않고 내보내려면 사유를 적어야 해요: --reveal --reason <사유>' . PHP_EOL);
            foreach (Allot::REVEAL_REASONS as $code => $text) fwrite(STDERR, sprintf('    %-11s %s', $code, $text) . PHP_EOL);
            return 1;
        }
        $data = Config::dataDir();
        if (isset($pos[1]) && $pos[1] !== '') {
            $file = $pos[1];
        } else {
            $dir = $data . DIRECTORY_SEPARATOR . 'exports';
            if (!is_dir($dir) && !@mkdir($dir, 0700, true)) { fwrite(STDERR, '✖ 폴더를 만들 수 없어요: ' . $dir . PHP_EOL); return 1; }
            $file = $dir . DIRECTORY_SEPARATOR . 'allot-' . $what . '-' . date('Ymd-His') . '.csv';
        }
        if (!is_dir(dirname($file))) { fwrite(STDERR, '✖ 저장할 폴더가 없어요: ' . dirname($file) . PHP_EOL); return 1; }
        // a file below the web folder could be downloaded by anyone who guesses its name: only data/ (which the server
        // never serves) is allowed there
        if ($tfmAllotInside($file, TFM_ROOT) && !$tfmAllotInside($file, $data)) {
            fwrite(STDERR, '✖ 웹에서 보이는 폴더 안에는 저장하지 않아요 (주소를 아는 사람이 내려받을 수 있어요).' . PHP_EOL . '  파일 이름을 빼고 실행하면 data/exports/ 에 만들어요. 다른 곳에 두려면 웹 폴더 밖의 경로를 적어 주세요.' . PHP_EOL);
            return 1;
        }
        if (file_exists($file) && empty($f['force'])) { fwrite(STDERR, '✖ 같은 이름의 파일이 이미 있어요: ' . $file . '  (덮어쓰려면 --force)' . PHP_EOL); return 1; }
        $h = @fopen($file, 'wb');
        if ($h === false) { fwrite(STDERR, '✖ 파일을 쓸 수 없어요: ' . $file . PHP_EOL); return 1; }
        @chmod($file, 0600);
        $rows = 0;
        try {
            fwrite($h, Allot::csvBom() . Allot::csvLine(Allot::exportHeader($what, $reveal)));
            $after = 0;
            do {
                $r = Allot::exportRows($what, $after, 500, $reveal, $reveal ? $tfmAllotActor : null, $why);
                foreach ($r['rows'] as $cells) { fwrite($h, Allot::csvLine($cells)); $rows++; }
                $after = (int) $r['next'];
            } while ($after > 0);
        } catch (\Throwable $e) {
            fclose($h);
            @unlink($file);
            fwrite(STDERR, '✖ 내보내지 못했어요 (' . ($e instanceof ApiException ? $e->getMessage() : get_class($e)) . ').' . PHP_EOL);
            return 1;
        }
        fclose($h);
        fwrite(STDOUT, '✔ ' . number_format($rows) . '줄을 저장했어요: ' . $file . PHP_EOL);
        fwrite(STDOUT, $reveal
            ? '  ※ 이름 · 전화번호 · 주소가 그대로 들어 있는 파일이에요. 필요한 사람만 보고, 쓰고 나면 지워 주세요. (내보낸 사실은 감사 기록에 남았어요)' . PHP_EOL
            : '  이름 · 전화번호는 가려져 있어요 ("김**", "***-****-1234"). 전체가 필요하면 --reveal --reason <사유>' . PHP_EOL);
        return 0;
    },

    // -------------------------------------------------------------- allot:import <what> <file> [--commit]
    'allot:import' => function (array $args) use ($tfmAllotActor, $tfmAllotArgs, $tfmAllotSafe): int {
        list($pos, $f) = $tfmAllotArgs($args);
        $what = isset($pos[0]) ? strtolower($pos[0]) : '';
        $file = isset($pos[1]) ? $pos[1] : '';
        if (!in_array($what, ['ledger', 'payments'], true) || $file === '') {
            fwrite(STDERR, '✖ 이렇게 적어 주세요: php cli/tfm.php allot:import <ledger|payments> <파일.csv> [--commit]' . PHP_EOL
                . '  ledger   운영 장부: 첫 줄에 일자 · 성명 · 연락처 · 주소 · 비고 와 자리 번호 열(단위 — 예: J01-0012, 또는 구역 번호 J01)' . PHP_EOL
                . '  payments 입금 내역: 첫 줄에 계약번호(또는 단위) · 금액 · 일자 · 방법 · 비고' . PHP_EOL);
            return 1;
        }
        if (!is_file($file) || !is_readable($file)) { fwrite(STDERR, '✖ 파일을 읽을 수 없어요: ' . $file . PHP_EOL); return 1; }
        if (filesize($file) > 8 * 1024 * 1024) { fwrite(STDERR, '✖ 파일이 너무 커요 (최대 8 MB). 나눠서 가져와 주세요.' . PHP_EOL); return 1; }
        $csv = (string) file_get_contents($file);
        // files saved by older spreadsheet programs are often in the Korean Windows code page: read them as such
        if (!mb_check_encoding($csv, 'UTF-8')) {
            $conv = @mb_convert_encoding($csv, 'UTF-8', 'CP949');
            if (is_string($conv) && $conv !== '' && mb_check_encoding($conv, 'UTF-8')) { $csv = $conv; fwrite(STDOUT, '  (파일이 UTF-8 이 아니어서 한글 윈도우 글자표(CP949)로 읽었어요.)' . PHP_EOL); }
        }
        $commit = !empty($f['commit']);
        try {
            $r = Allot::importCsv($tfmAllotActor, $what, $csv, !$commit);
        } catch (ApiException $e) {
            fwrite(STDERR, '✖ ' . $e->getMessage() . PHP_EOL);
            return 1;
        }
        $act = ['new' => '새 고객 + 계약', 'existing' => '있던 고객 + 새 계약', 'duplicate' => '이미 가져온 줄 (건너뜀)', 'payment' => '입금 기록', 'problem' => '문제'];
        fwrite(STDOUT, sprintf('%s: 모두 %s줄 — 가져올 수 있는 줄 %s · 이미 있어서 건너뛰는 줄 %s · 문제가 있는 줄 %s', $what === 'ledger' ? '운영 장부' : '입금 내역',
            number_format((int) $r['total']), number_format((int) $r['valid']), number_format((int) $r['skipped']), number_format((int) $r['invalid'])) . PHP_EOL);
        $shown = 0;
        foreach ($r['rows'] as $row) {
            if (!empty($row['ok'])) continue;
            if (++$shown > 30) { fwrite(STDOUT, '  … (문제가 있는 줄이 더 있어요)' . PHP_EOL); break; }
            fwrite(STDOUT, sprintf('  ✖ %d번째 줄 %s: %s', (int) $row['line'], $tfmAllotSafe((string) $row['who']), $tfmAllotSafe(implode(' / ', (array) $row['problems']))) . PHP_EOL);
        }
        if ((int) $r['invalid'] > 0) {
            fwrite(STDOUT, '→ 문제가 있는 줄을 고친 뒤 다시 실행해 주세요. 지금은 아무것도 가져오지 않았어요.' . PHP_EOL);
            return 1;
        }
        if (!empty($r['dryRun'])) {
            $kinds = [];
            foreach ($r['rows'] as $row) { $k = (string) $row['action']; $kinds[$k] = (isset($kinds[$k]) ? $kinds[$k] : 0) + 1; }
            $parts = [];
            foreach ($kinds as $k => $c) $parts[] = (isset($act[$k]) ? $act[$k] : $k) . ' ' . number_format($c);
            fwrite(STDOUT, '  미리 보기' . (count($r['rows']) < (int) $r['total'] ? ' (앞의 ' . count($r['rows']) . '줄)' : '') . ': ' . implode(' · ', $parts) . PHP_EOL);
            fwrite(STDOUT, '→ 문제가 없어요. 아직 아무것도 바꾸지 않았어요. 진짜로 가져오려면 끝에 --commit 을 붙여 다시 실행해 주세요.' . PHP_EOL);
            return 0;
        }
        if ((int) $r['created']['customers'] + (int) $r['created']['contracts'] + (int) $r['created']['payments'] === 0) {
            fwrite(STDOUT, '✔ 새로 가져올 것이 없어요 (모두 이미 가져온 줄이에요).' . PHP_EOL);
            return 0;
        }
        fwrite(STDOUT, sprintf('✔ 가져왔어요: 고객 %s명 · 계약 %s건 · 입금 %s건', number_format((int) $r['created']['customers']), number_format((int) $r['created']['contracts']), number_format((int) $r['created']['payments'])) . PHP_EOL);
        if ($what === 'ledger') fwrite(STDOUT, '  가져온 고객은 동의 기록이 없는 상태예요 (종이 동의서가 있으면 관리자 페이지에서 표시해 주세요). 안내는 보내지 않았어요.' . PHP_EOL);
        return 0;
    },

    // -------------------------------------------------------------- allot:demo [--count N] | --clear
    'allot:demo' => function (array $args) use ($tfmAllotActor, $tfmAllotArgs): int {
        list(, $f) = $tfmAllotArgs($args);
        try {
            if (!empty($f['clear'])) {
                $r = Allot::demoClear($tfmAllotActor);
                fwrite(STDOUT, sprintf('✔ 예시 자료를 지웠어요: 가짜 고객 %d명 · 계약 %d건 · 입금 %d건 · 안내 %d건 · 관리 일지 %d줄', $r['customers'], $r['contracts'], $r['payments'], $r['notices'], $r['care']) . PHP_EOL);
                if ($r['kept'] > 0) fwrite(STDOUT, '  ※ 그 사이 앱 계정과 연결된 고객 ' . $r['kept'] . '명은 지우지 않았어요.' . PHP_EOL);
                fwrite(STDOUT, '  구역과 자리는 그대로 남아 있어요.' . PHP_EOL);
                return 0;
            }
            $count = 40;
            if (isset($f['count'])) {
                if (!is_string($f['count']) || !ctype_digit($f['count']) || (int) $f['count'] < 10 || (int) $f['count'] > 200) { fwrite(STDERR, '✖ --count 는 10~200 사이의 숫자로 적어 주세요.' . PHP_EOL); return 1; }
                $count = (int) $f['count'];
            }
            $r = Allot::demoSeed($tfmAllotActor, $count);
        } catch (ApiException $e) {
            fwrite(STDERR, '✖ ' . $e->getMessage() . PHP_EOL);
            return 1;
        }
        fwrite(STDOUT, sprintf('✔ 예시 자료를 만들었어요: 가짜 고객 %d명 · 계약 %d건 (진행 중 %d · 미납 %d · 확정 기다림 %d · 곧 끝남 %d · 끝남 %d) · 관리 일지 %d줄',
            $r['customers'], $r['contracts'], $r['active'], $r['unpaid'], $r['pending'], $r['ending'], $r['ended'], $r['care']) . PHP_EOL);
        if ($r['zonesSeeded'] > 0) fwrite(STDOUT, '  구역이 없어서 시험용 묶음(small, 180자리)을 만들고 신청을 열어 두었어요.' . PHP_EOL);
        fwrite(STDOUT, '  미납 표시와 통계는 php cli/tfm.php allot:tick 을 한 번 돌리면 보여요. 지우기: php cli/tfm.php allot:demo --clear' . PHP_EOL);
        return 0;
    },
];

// Direct invocation (`php cli/allot.php <command>`): bootstrap, then dispatch. When cli/tfm.php loads this file as a
// plug-in, TFM_BOOT is already defined, so this block is skipped and the command map is returned instead.
if (!defined('TFM_BOOT')) {
    require __DIR__ . '/../lib/bootstrap.php';
    $argv = isset($_SERVER['argv']) ? $_SERVER['argv'] : [];
    $cmd = strtolower((string) (isset($argv[1]) ? $argv[1] : ''));
    if ($cmd === '' || !isset($tfmAllotCommands[$cmd])) {
        fwrite(STDERR, 'usage: php cli/allot.php <' . implode('|', array_keys($tfmAllotCommands)) . '> …' . PHP_EOL);
        exit(2);
    }
    exit((int) call_user_func($tfmAllotCommands[$cmd], array_slice($argv, 2)));
}

return $tfmAllotCommands;
