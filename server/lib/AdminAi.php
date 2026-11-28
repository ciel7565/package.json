<?php
/**
 * Tfm\AdminAi — the parts of the admin site's 🤖 AI 도우미 tab that this lane adds (CONTRACT §15.6 / §16.10, owner:
 * claude). The tab itself (status, the 옹이 선생님 switch, 오늘 요약, the free prompt box, 메모 초안 in ✅ 완료 확인)
 * stays in server/admin/index.php; this file draws one more card and does one more action. No JavaScript.
 *
 *   card(string $token): string          today's use against the caps (whole server · per child), the failures, an
 *                                         estimate of what today cost, the 🧪 연결 시험 button and its last result
 *                                         (the model that served, tokens, latency, the request as sent with the key
 *                                         shown as ***)
 *   selfTest(Ctx $c): string             the action `ai_selftest`: rate ai_admin, Claude::selfTest(), audit ai_selftest
 *                                         (ok, model, ms, tokens, stop — never a prompt, an answer or the key), the
 *                                         result kept in this session for 30 minutes → the flash text
 *
 * It lives in lib/ (never web-readable) and is loaded by the admin entry on demand. The entry has already checked the
 * lock for every POST that reaches selfTest(): same origin, the CSRF token, the admin role and the elevation. The
 * `case 'ai_selftest':` label stays in the entry (tests/admin-lock.mjs reads the list of actions from that file).
 * Every value that reaches the page goes through h(); no script, no inline style (the CSP of the admin site).
 * PHP 7.2 syntax only.
 */
declare(strict_types=1);

namespace Tfm;

if (!defined('TFM_BOOT')) { if (function_exists('header_remove')) header_remove('X-Powered-By'); http_response_code(404); exit; }

final class AdminAi
{
    /**
     * Price per million tokens in US dollars (input, output) of the models a 체험관 would choose, as published by
     * Anthropic in November 2026. Only for the estimate on the card; the bill of the account is what counts.
     */
    public const PRICES = [
        'claude-opus-5-5' => [4.0, 20.0],
        'claude-sonnet-5-5' => [2.0, 10.0],
        'claude-haiku-5-5' => [0.10, 0.50],
        'claude-fable-5-2' => [8.0, 40.0],
    ];

    private static function h($v): string { return htmlspecialchars((string) $v, ENT_QUOTES | ENT_SUBSTITUTE | ENT_HTML401, 'UTF-8'); }
    private static function n($v): string { return number_format((float) $v); }

    private static function capUser(): int
    {
        return method_exists('Tfm\Claude', 'capUser') ? Claude::capUser() : (int) Config::get('anthropic.daily_user', 20);
    }

    private static function capTotal(): int
    {
        return method_exists('Tfm\Claude', 'capTotal') ? Claude::capTotal() : (int) Config::get('anthropic.daily_total', 2000);
    }

    /** an estimate in dollars of $in / $out tokens on $model, or null for a model without a known price */
    public static function estimate(string $model, int $in, int $out): ?float
    {
        if (!isset(self::PRICES[$model])) return null;
        $p = self::PRICES[$model];
        return ($in * $p[0] + $out * $p[1]) / 1000000;
    }

    private static function money(?float $usd): string
    {
        if ($usd === null) return '알 수 없어요 (값표에 없는 모델)';
        $won = (int) round($usd * 1400);
        return '약 $' . number_format($usd, $usd < 0.1 ? 4 : 2) . ' (약 ' . number_format($won) . '원)';
    }

    /** the last self-test of this session (30 minutes) */
    private static function last(): ?array
    {
        if (!Session::started()) return null;
        $a = Session::get('ai_selftest');
        if (!is_array($a) || !isset($a['at'])) return null;
        if (Clock::ms() - (int) $a['at'] > 1800000) { Session::set('ai_selftest', null); return null; }
        return $a;
    }

    public static function card(string $token): string
    {
        try { $u = Claude::usageToday(); } catch (\Throwable $e) { $u = []; }
        $total = isset($u['total']) ? (int) $u['total'] : 0;
        $by = isset($u['byScope']) && is_array($u['byScope']) ? $u['byScope'] : [];
        $kid = isset($by['kid']) ? (int) $by['kid'] : 0;
        $kidUsers = isset($u['kidUsers']) ? (int) $u['kidUsers'] : 0;
        $failed = isset($u['failed']) ? (int) $u['failed'] : 0;
        $tin = isset($u['tokensIn']) ? (int) $u['tokensIn'] : 0;
        $tout = isset($u['tokensOut']) ? (int) $u['tokensOut'] : 0;
        $capT = self::capTotal();
        $capU = self::capUser();
        $model = method_exists('Tfm\Claude', 'model') ? Claude::model() : (string) Config::get('anthropic.model', '');
        $mock = method_exists('Tfm\Claude', 'isMock') && Claude::isMock();
        $perQ = self::estimate($model, 900, 250);
        $h = '<section class="card"><h3>📈 오늘 쓴 양과 하루 한도</h3>'
            . '<dl class="facts">'
            . '<dt>서버 전체</dt><dd>' . self::n($total) . ' / ' . self::n($capT) . '번 <meter min="0" max="' . self::h(max(1, $capT)) . '" value="' . self::h(min($total, max(1, $capT))) . '" low="' . self::h((int) ($capT * 0.7)) . '" high="' . self::h((int) ($capT * 0.9)) . '" optimum="0">' . self::h($total) . '</meter></dd>'
            . '<dt>옹이 선생님</dt><dd>질문 ' . self::n($kid) . '번 · 물어본 아이 ' . self::n($kidUsers) . '명 · 한 명당 하루 ' . self::n($capU) . '번까지</dd>'
            . '<dt>답을 못 받은 요청</dt><dd>' . self::n($failed) . '번' . ($failed > 0 ? ' <span class="dim small">(감사 로그와 data/logs 의 AI 줄에 까닭이 있어요)</span>' : '') . '</dd>'
            . '<dt>오늘 토큰</dt><dd>보냄 ' . self::n($tin) . ' · 받음 ' . self::n($tout) . '</dd>'
            . '<dt>오늘 비용 (추정)</dt><dd>' . ($mock ? '0원 (모의 모드 — 밖으로 보내지 않아요)' : self::h(self::money(self::estimate($model, $tin, $tout)))) . '</dd>'
            . '<dt>질문 한 번 (추정)</dt><dd>' . ($mock ? '0원' : self::h(self::money($perQ))) . ' <span class="dim small">(보내는 글 약 900토큰 · 받는 글 약 250토큰으로 어림)</span></dd>'
            . '</dl>'
            . '<p class="dim small">"토큰"은 AI가 글을 세는 작은 조각이에요 (한국어 한 글자가 대략 1토큰). 한도는 ⚙️ 설정 → 🧩 기타의 "옹이 선생님 — 한 계정의 하루 질문 수"와 "AI 도우미 — 서버 전체 하루 질문 수"에서 바꿔요. 한도에 닿으면 그날은 더 보내지 않고, 아이에게는 "내일 또 만나요" 한 줄이 보여요.</p></section>';
        // the self-test
        $h .= '<section class="card"><h3>🧪 연결 시험</h3><p class="dim small">아주 짧은 요청 하나("OK"라고만 답해 달라는 글)를 보내서, 어떤 모델이 답했는지 · 토큰 · 걸린 시간을 보여 줘요. 키는 이 화면에 나오지 않아요. 한 번에 1원 안팎이 들어요.</p>'
            . '<form method="post" action="./" class="inline"><input type="hidden" name="_csrf" value="' . self::h($token) . '"><input type="hidden" name="action" value="ai_selftest"><input type="hidden" name="tab" value="ai">'
            . '<button class="btn" type="submit">🧪 연결 시험 하기</button></form>';
        $a = self::last();
        if ($a) {
            $h .= '<dl class="facts">'
                . '<dt>결과</dt><dd>' . (!empty($a['ok']) ? '<span class="badge ok">✅ 잘 연결됐어요</span>' : '<span class="badge fail">⚠️ 답을 받지 못했어요</span>') . ' <span class="dim small">' . self::h(date('H:i:s', intdiv((int) $a['at'], 1000))) . '</span></dd>'
                . '<dt>답한 모델</dt><dd><code>' . self::h($a['model'] !== '' ? $a['model'] : '-') . '</code>' . (!empty($a['fallback']) ? ' <span class="dim small">(대신 답한 모델)</span>' : '') . '</dd>'
                . '<dt>토큰</dt><dd>보냄 ' . self::n($a['in']) . ' · 받음 ' . self::n($a['out']) . '</dd>'
                . '<dt>걸린 시간</dt><dd>' . self::n($a['ms']) . 'ms</dd>'
                . ($a['error'] !== '' ? '<dt>까닭</dt><dd>' . self::h($a['error']) . '</dd>' : '')
                . '</dl>';
            if (isset($a['request']) && is_array($a['request'])) {
                $h .= '<details><summary>보낸 요청 보기 (키는 ***)</summary><pre class="small">' . self::h('POST ' . $a['request']['url'] . "\n" . implode("\n", $a['request']['headers']) . "\n\n"
                    . json_encode($a['request']['body'], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT)) . '</pre></details>';
            }
        }
        return $h . '</section>';
    }

    /** the action ai_selftest → the flash text */
    public static function selfTest(Ctx $c): string
    {
        if (!Claude::configured()) throw new ApiException(503, 'AI_OFF', '🤖 키가 없어서 시험할 수 없어요. config.local.php 의 anthropic.api_key(또는 환경 변수 ANTHROPIC_API_KEY)에 키를 넣어 주세요.');
        RateLimit::forRequest('ai_admin', $c);
        $r = Claude::selfTest($c->uid());
        $u = isset($r['usage']) && is_array($r['usage']) ? $r['usage'] : [];
        $keep = ['ok' => !empty($r['ok']), 'model' => mb_substr(isset($r['model']) ? (string) $r['model'] : '', 0, 60), 'in' => (int) (isset($u['in']) ? $u['in'] : 0), 'out' => (int) (isset($u['out']) ? $u['out'] : 0),
            'ms' => (int) (isset($r['ms']) ? $r['ms'] : 0), 'stop' => mb_substr(isset($r['stop']) ? (string) $r['stop'] : '', 0, 20), 'fallback' => !empty($r['fallback']),
            'error' => mb_substr(Claude::scrub(isset($r['error']) && is_string($r['error']) ? $r['error'] : ''), 0, 160), 'at' => Clock::ms()];
        Audit::log('ai_selftest', null, ['ok' => $keep['ok'], 'model' => $keep['model'], 'ms' => $keep['ms'], 'in' => $keep['in'], 'out' => $keep['out'], 'stop' => $keep['stop']], $keep['ok'] ? 'info' : 'warn', $c->uid());
        if (isset($r['request']) && is_array($r['request'])) $keep['request'] = ['url' => (string) $r['request']['url'], 'headers' => array_map('strval', (array) $r['request']['headers']), 'body' => $r['request']['body']];
        Session::set('ai_selftest', $keep);
        return $keep['ok'] ? '🧪 연결 시험: ✅ ' . $keep['model'] . ' 모델이 ' . self::n($keep['ms']) . 'ms 만에 답했어요.' : '🧪 연결 시험: ⚠️ 답을 받지 못했어요 — ' . ($keep['error'] !== '' ? $keep['error'] : '까닭을 알 수 없어요');
    }
}
