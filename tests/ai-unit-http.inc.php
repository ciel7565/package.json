<?php
/**
 * tests/ai-unit-http.inc.php — the HTTP part of tests/ai-unit.php (included by it; never run alone): a private `php -S`
 * on the suite's server copy talks to the stub (ANTHROPIC_API_KEY + TFM_AI_API_BASE in its environment) and the checks go
 * through api/ai/status.php and api/ai/ask.php like the page does (cookies, the CSRF header, JSON).
 * CLI only; never deployed.
 */
declare(strict_types=1);

if (PHP_SAPI !== 'cli' || !isset($srv, $root, $HTTP_PORT, $STUB_PORT)) { http_response_code(404); exit; }

use Tfm\Claude;
use Tfm\Settings;

$work = $root . '/work';
if (!is_dir($work)) mkdir($work, 0700, true);
putenv('ANTHROPIC_API_KEY=' . KEY);
putenv("TFM_AI_API_BASE=http://127.0.0.1:$STUB_PORT/s/echo");
putenv('TFM_AI_MOCK');
$server = proc_open(['php', '-S', "127.0.0.1:$HTTP_PORT", '-t', $srv], [0 => ['file', '/dev/null', 'r'], 1 => ['file', '/dev/null', 'w'], 2 => ['file', "$root/php-server.log", 'w']], $pp);
for ($i = 0; $i < 60; $i++) { $s = @fsockopen('127.0.0.1', $HTTP_PORT, $en, $es, 0.2); if ($s) { fclose($s); break; } usleep(100000); }

/** one request with a cookie jar → ['status', 'headers', 'body', 'json'] */
function web(string $jar, string $path, string $method = 'GET', ?string $body = null, array $headers = []): array
{
    global $HTTP_PORT, $work;
    $ch = curl_init("http://127.0.0.1:$HTTP_PORT/$path");
    $opt = [CURLOPT_RETURNTRANSFER => true, CURLOPT_HEADER => true, CURLOPT_CUSTOMREQUEST => $method, CURLOPT_TIMEOUT => 60,
        CURLOPT_COOKIEJAR => "$work/$jar.jar", CURLOPT_COOKIEFILE => "$work/$jar.jar", CURLOPT_HTTPHEADER => array_merge(['Origin: http://127.0.0.1:' . $HTTP_PORT], $headers)];
    if ($body !== null) { $opt[CURLOPT_POSTFIELDS] = $body; $opt[CURLOPT_HTTPHEADER][] = 'Content-Type: application/json'; }
    curl_setopt_array($ch, $opt);
    $raw = (string) curl_exec($ch);
    $hs = (int) curl_getinfo($ch, CURLINFO_HEADER_SIZE);
    $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    $h = [];
    foreach (explode("\r\n", substr($raw, 0, $hs)) as $line) if (strpos($line, ':') !== false) { list($k, $v) = explode(':', $line, 2); $h[strtolower(trim($k))] = trim($v); }
    $b = substr($raw, $hs);
    return ['status' => $status, 'headers' => $h, 'body' => $b, 'json' => json_decode($b, true)];
}
$TOK = [];
function signInWeb(string $jar, array $u): string
{
    global $TOK;
    $p = web($jar, 'api/ping.php');
    $tok = (string) $p['json']['data']['csrf'];
    $r = web($jar, 'api/auth/login.php', 'POST', json_encode(['login' => $u['email'], 'password' => 'Passw0rd!long']), ['X-CSRF-Token: ' . $tok]);
    $tok2 = isset($r['json']['csrf']) ? (string) $r['json']['csrf'] : (string) web($jar, 'api/ping.php')['json']['data']['csrf'];
    return $TOK[$jar] = $tok2 !== '' ? $tok2 : $tok;
}
function askWeb(string $jar, array $body, bool $csrf = true): array
{
    global $TOK;
    return web($jar, 'api/ai/ask.php', 'POST', json_encode($body, JSON_UNESCAPED_UNICODE), $csrf ? ['X-CSRF-Token: ' . $TOK[$jar]] : []);
}

check('HTTP: without a login status is 401 and ask is refused (401 / 403) — the stub sees nothing', function () {
    stubReset();
    web('guest', 'api/ping.php');
    $s = web('guest', 'api/ai/status.php');
    $a = web('guest', 'api/ai/ask.php', 'POST', '{"presetId":"kimchi"}');
    return $s['status'] === 401 && in_array($a['status'], [401, 403], true) && count(stubLog()['requests']) === 0 ? true : $s['status'] . ' / ' . $a['status'];
});
check('HTTP: switched off — status says kid false with no presets; ask answers 200 ok false, why off and the calm line', function () use ($A, $uidAdm) {
    Settings::set('ai.kid_helper', false, $uidAdm);
    signInWeb('a', $A);
    $s = web('a', 'api/ai/status.php');
    $a = askWeb('a', ['presetId' => 'kimchi']);
    if ($s['status'] !== 200 || $s['json']['data']['kid'] !== false || $s['json']['data']['presets'] !== []) return 'status ' . $s['body'];
    return $a['status'] === 200 && $a['json']['data']['ok'] === false && $a['json']['data']['why'] === 'off' && $a['json']['data']['answer'] === Claude::calmLine('off') ? true : $a['body'];
});
check('HTTP: switched on — status lists the preset tiles (id, icon, label, say, topic only), the questions left and the length limit; never the key, the model or a question text', function () use ($uidAdm) {
    Settings::set('ai.kid_helper', true, $uidAdm);
    $s = web('a', 'api/ai/status.php');
    $d = $s['json']['data'] ?? [];
    if ($s['status'] !== 200 || $d['kid'] !== true || count($d['presets']) < 8 || $d['max'] !== 200 || !is_int($d['left'])) return $s['body'];
    if (!noKey($s['body']) || strpos($s['body'], 'claude-') !== false || strpos($s['body'], '두어요?') !== false) return 'leaks: ' . $s['body'];
    return array_keys($d['presets'][0]) === ['id', 'icon', 'label', 'say', 'topic'] ? true : j($d['presets'][0]);
});
check('HTTP: a preset question goes out as the server\'s own text; the answer comes back as plain text with the questions left', function () {
    stubReset();
    $a = askWeb('a', ['presetId' => 'hanok']);
    $d = $a['json']['data'] ?? [];
    $sent = stubLog()['requests'][0]['body']['messages'][0]['content'] ?? '';
    if ($a['status'] !== 200 || $d['ok'] !== true || $sent !== '한옥 지붕 끝은 왜 위로 휘어 있어요?' || $d['answer'] !== $sent) return $a['body'] . ' / ' . $sent;
    return stripos((string) ($a['headers']['content-type'] ?? ''), 'application/json') === 0 && noKey($a['body']) && !stubLog()['violations'] ? true : 'headers / violations';
});
check('HTTP: a typed question is masked before it leaves (the stub never sees the phone number) and the answer is masked again', function () {
    stubReset();
    $a = askWeb('a', ['question' => '우리 집 전화 02-555-1234 인데 된장은 왜 짜요?']);
    $sent = stubLog()['requests'][0]['body']['messages'][0]['content'] ?? '';
    return $a['status'] === 200 && $a['json']['data']['ok'] === true && strpos($sent, '555-1234') === false && strpos($a['body'], '555-1234') === false && strpos($sent, '된장') !== false ? true : $a['body'] . ' / ' . $sent;
});
check('HTTP: no CSRF header → 403; unknown field, both fields, neither, an unknown preset, a 201-character question, a number → 400 — and nothing reaches the stub', function () use ($B) {
    stubReset();
    signInWeb('b', $B);
    $codes = [
        askWeb('b', ['presetId' => 'kimchi'], false)['status'],
        askWeb('b', ['presetId' => 'kimchi', 'model' => 'x'])['status'],
        askWeb('b', ['presetId' => 'kimchi', 'question' => '김치'])['status'],
        askWeb('b', [])['status'],
        askWeb('b', ['presetId' => 'secret'])['status'],
        askWeb('b', ['question' => str_repeat('나', 201)])['status'],
        askWeb('b', ['question' => 12])['status'],
    ];
    return $codes === [403, 400, 400, 400, 400, 400, 400] && count(stubLog()['requests']) === 0 ? true : j($codes);
});
check('HTTP: the per-account cap — at ai.daily_user the next question answers ok false, why capped_user, "내일 또 만나요" — and it is not sent', function () use ($setCaps, $uidA) {
    $used = Claude::usedToday($uidA);
    $setCaps($used, 10000);
    stubReset();
    $a = askWeb('a', ['presetId' => 'spring']);
    $setCaps(100, 10000);
    return $a['status'] === 200 && $a['json']['data']['why'] === 'capped_user' && $a['json']['data']['left'] === 0 && strpos($a['json']['data']['answer'], '내일') !== false && count(stubLog()['requests']) === 0 ? true : $a['body'];
});
check('HTTP: the page never gets the key — no endpoint answer, no response header holds it', function () {
    foreach ([web('a', 'api/ai/status.php'), askWeb('a', ['presetId' => 'winter']), web('a', 'api/ping.php')] as $r) {
        if (!noKey($r['body']) || !noKey(j($r['headers']))) return 'leak in ' . substr($r['body'], 0, 80);
    }
    return true;
});
