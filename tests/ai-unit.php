<?php
/**
 * tests/ai-unit.php — unit checks for the Claude API proxy (CONTRACT §15.6 / §16.10): Tfm\Claude off without a key, the
 * exact request (headers, body, no forbidden fields, fallbacks only for the models that offer them), every answer shape
 * against the local stub tests/ai-stub.mjs (normal, refusal, a max_tokens stop without text, 429 with retry-after, 529,
 * x-should-retry: false, slow past the timeout, garbage, 401, a 401 that repeats the key, a fallback model), the key in
 * no result / log / database row, the 옹이 선생님 layer (presets resolved here, masking before the text leaves and after
 * it comes back, the bad-word filter, links and markup removed, the 600-character cut, the calm lines), the caps per
 * account and per day, the usage rows (no text), mock mode, the self-test — and over a private `php -S` the endpoints
 * api/ai/status.php and api/ai/ask.php (login, CSRF, unknown fields, lengths, the switch).
 *
 *   php tests/ai-unit.php
 *   TFM_DB_DRIVER=mysql TFM_DB_HOST=127.0.0.1 TFM_DB_PORT=33106 TFM_DB_USER=root TFM_DB_NAME=tfm_p11ai php tests/ai-unit.php
 *   TFM_AI_STUB_PORT=<port> (default 31346) · TFM_AI_HTTP_PORT=<port> (default 31301) · TFM_UNIT_ONLY=<text>
 *   TFM_AI_EVIDENCE=<file> writes the request the client sent (key shown as ***) as JSON.
 *
 * CLI only; never deployed. Developer tooling: runs on the dev PHP (8.x).
 */
declare(strict_types=1);

if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }

function copyTree(string $from, string $to): void
{
    if (!is_dir($to)) mkdir($to, 0700, true);
    foreach (scandir($from) ?: [] as $f) {
        if ($f === '.' || $f === '..') continue;
        if (is_dir("$from/$f")) copyTree("$from/$f", "$to/$f");
        elseif (!preg_match('/\.sqlite(-wal|-shm)?$|config\.local\.php$|secret\.php$|install\.lock$/', $f)) copy("$from/$f", "$to/$f");
    }
}
$root = sys_get_temp_dir() . '/tfm-ai-' . bin2hex(random_bytes(6));
$srv = $root . '/srv';
$tmp = $root . '/data';
mkdir($tmp, 0700, true);
copyTree(__DIR__ . '/../server', $srv);
putenv("TFM_DATA_DIR=$tmp");
putenv("TFM_UPLOAD_DIR=$tmp/uploads");
putenv('ANTHROPIC_API_KEY');
putenv('TFM_AI_MOCK');
require $srv . '/lib/bootstrap.php';

use Tfm\Claude;
use Tfm\Config;
use Tfm\Db;
use Tfm\Settings;
use Tfm\Users;

const KEY = 'unit-test-key-UNITTESTKEY-not-real'; // not shaped like a real key (tools/secret-scan.mjs)
$STUB_PORT = (int) (getenv('TFM_AI_STUB_PORT') ?: 31346);
$HTTP_PORT = (int) (getenv('TFM_AI_HTTP_PORT') ?: 31301);
$DRIVER = Db::driver();
$failed = 0;
$passed = 0;
function check(string $name, callable $test): void
{
    global $failed, $passed;
    $only = (string) getenv('TFM_UNIT_ONLY');
    if ($only !== '' && strpos($name, $only) === false) return;
    try {
        $r = $test();
        $ok = $r === true;
        $detail = is_string($r) ? $r : ($ok ? '' : 'assertion is false');
    } catch (Throwable $e) {
        $ok = false;
        $detail = get_class($e) . ': ' . $e->getMessage() . ' @' . basename($e->getFile()) . ':' . $e->getLine();
    }
    if ($ok) $passed++; else $failed++;
    echo ($ok ? 'PASS  ' : 'FAIL  ') . $name . ($ok || $detail === '' ? '' : "  — $detail") . PHP_EOL;
}
function j($v): string { return json_encode($v, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES); }

// ---------------------------------------------------------------------------------------------- the stub
$stubLog = $root . '/stub.log';
$stub = proc_open(['node', __DIR__ . '/ai-stub.mjs', '--port', (string) $STUB_PORT, '--key', KEY], [0 => ['pipe', 'r'], 1 => ['file', $stubLog, 'a'], 2 => ['file', $stubLog, 'a']], $pipes);
register_shutdown_function(function () use (&$stub, &$server, $root) {
    foreach ([$stub, isset($server) ? $server : null] as $p) if (is_resource($p)) { proc_terminate($p); proc_close($p); }
    if (getenv('TFM_AI_KEEP') !== '1') { exec('rm -r ' . escapeshellarg($root) . ' 2>/dev/null'); }
});
function http(string $method, string $url, ?string $body = null, array $headers = []): array
{
    $ch = curl_init($url);
    $got = [];
    curl_setopt_array($ch, [CURLOPT_CUSTOMREQUEST => $method, CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 30, CURLOPT_HTTPHEADER => $headers,
        CURLOPT_HEADERFUNCTION => function ($c, $l) use (&$got) { $p = strpos($l, ':'); if ($p !== false) $got[strtolower(trim(substr($l, 0, $p)))] = trim(substr($l, $p + 1)); return strlen($l); }]);
    if ($body !== null) curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
    $out = curl_exec($ch);
    $st = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    return ['status' => $st, 'body' => is_string($out) ? $out : '', 'headers' => $got];
}
$up = false;
for ($i = 0; $i < 100 && !$up; $i++) { usleep(100000); $up = http('GET', "http://127.0.0.1:$STUB_PORT/_log")['status'] === 200; }
if (!$up) { echo "FAIL  the stub did not start (node tests/ai-stub.mjs on port $STUB_PORT): " . @file_get_contents($stubLog) . PHP_EOL; exit(1); }
function stubLog(): array { global $STUB_PORT; return json_decode(http('GET', "http://127.0.0.1:$STUB_PORT/_log")['body'], true) ?: []; }
function stubReset(): void { global $STUB_PORT; http('GET', "http://127.0.0.1:$STUB_PORT/_reset"); }
/** use the stub with one scenario, the real curl transport, and record the waits instead of sleeping */
$WAITS = [];
function scenario(string $s): void
{
    global $STUB_PORT, $WAITS;
    Config::override('anthropic.api_key', KEY);
    Config::override('anthropic.mock', false);
    Config::override('anthropic.api_base', "http://127.0.0.1:$STUB_PORT/s/$s");
    Claude::setTransport(null);
    $WAITS = [];
    Claude::setSleeper(function (float $s) use (&$WAITS) { $GLOBALS['WAITS'][] = $s; });
}
function rows(): array { return Db::all('SELECT * FROM ai_usage ORDER BY id'); }
function noKey($v): bool { $s = is_string($v) ? $v : j($v); return strpos($s, KEY) === false && strpos($s, 'UNITTESTKEY') === false; }

echo "ai-unit — driver $DRIVER, schema " . Db::schemaVersion() . PHP_EOL;
$sfx = bin2hex(random_bytes(3));
$A = Users::create("aia$sfx@example.com", "질문어린이$sfx", 'Passw0rd!long');
$B = Users::create("aib$sfx@example.com", "다른친구$sfx", 'Passw0rd!long');
$ADMIN = Users::create("aiadm$sfx@example.com", "운영자$sfx", 'Passw0rd!long', 'admin');
$uidA = (int) $A['id'];
$uidB = (int) $B['id'];
$uidAdm = (int) $ADMIN['id'];
Db::exec('DELETE FROM ai_usage');
$setCaps = function (int $user, int $total) use ($uidAdm) {
    Settings::set('ai.daily_user', $user, $uidAdm);
    Settings::set('ai.daily_total', $total, $uidAdm);
    Settings::reset();
};
$setCaps(100, 10000);

// ---------------------------------------------------------------------------------------------- off without a key
check('off: no key and no mock → configured / enabled / kidEnabled false; ask answers code off; kidAsk gives the calm line; nothing is written', function () use ($uidA, $uidAdm) {
    Config::override('anthropic.api_key', '');
    Config::override('anthropic.mock', false);
    Settings::set('ai.kid_helper', true, $uidAdm);
    if (Claude::configured() || Claude::enabled() || Claude::kidEnabled()) return 'reports on';
    $r = Claude::ask(['messages' => [['role' => 'user', 'content' => '안녕']], 'scope' => 'admin', 'userId' => $uidAdm]);
    if ($r['ok'] || $r['code'] !== 'off') return 'ask: ' . j($r);
    $k = Claude::kidAsk($uidA, ['presetId' => 'kimchi']);
    if ($k['ok'] || $k['why'] !== 'off' || $k['answer'] !== Claude::calmLine('off')) return 'kidAsk: ' . j($k);
    $s = Claude::selfTest();
    if ($s['ok'] || $s['request'] !== null) return 'selfTest: ' . j($s);
    return count(rows()) === 0 ? true : 'usage rows written while off';
});
check('off: a key that is only spaces counts as no key', function () {
    Config::override('anthropic.api_key', "   \n");
    return !Claude::configured() ? true : 'configured';
});

// ---------------------------------------------------------------------------------------------- the exact request
check('request: POST {api_base}/v1/messages with content-type · x-api-key · anthropic-version 2026-10-21 · anthropic-beta for the default model', function () {
    Config::override('anthropic.api_key', KEY);
    Config::override('anthropic.api_base', 'https://api.anthropic.com');
    Config::override('anthropic.model', null);
    $r = Claude::buildRequest(['system' => 'S', 'messages' => [['role' => 'user', 'content' => '질문']]]);
    if ($r['url'] !== 'https://api.anthropic.com/v1/messages') return 'url ' . $r['url'];
    $want = ['content-type: application/json', 'x-api-key: ' . KEY, 'anthropic-version: 2026-10-21', 'anthropic-beta: server-side-fallback-2026-07-01'];
    return $r['headers'] === $want ? true : 'headers ' . j($r['headers']);
});
check('request: body = model claude-opus-5-5, max_tokens, system, messages, output_config {effort low}, fallbacks "default" — and nothing else (no temperature / top_p / top_k / thinking)', function () {
    $r = Claude::buildRequest(['system' => 'S', 'messages' => [['role' => 'user', 'content' => '질문']]]);
    $b = $r['body'];
    if (array_keys($b) !== ['model', 'max_tokens', 'system', 'messages', 'output_config', 'fallbacks']) return 'keys ' . j(array_keys($b));
    if ($b['model'] !== 'claude-opus-5-5' || $b['max_tokens'] !== 4096 || $b['output_config'] !== ['effort' => 'low'] || $b['fallbacks'] !== 'default') return j($b);
    return $b['messages'] === [['role' => 'user', 'content' => '질문']] ? true : 'messages ' . j($b['messages']);
});
check('request: a model without server-side fallbacks (claude-haiku-5-5) gets neither the beta header nor the fallbacks field; anthropic.fallbacks off removes both for the default model too', function () {
    Config::override('anthropic.model', 'claude-haiku-5-5');
    $r = Claude::buildRequest(['messages' => [['role' => 'user', 'content' => 'x']]]);
    if (isset($r['body']['fallbacks']) || preg_grep('/^anthropic-beta/', $r['headers'])) return 'haiku: ' . j($r);
    Config::override('anthropic.model', null);
    Config::override('anthropic.fallbacks', 'off');
    $r = Claude::buildRequest(['messages' => [['role' => 'user', 'content' => 'x']]]);
    Config::override('anthropic.fallbacks', null);
    return !isset($r['body']['fallbacks']) && !preg_grep('/^anthropic-beta/', $r['headers']) ? true : 'off: ' . j($r);
});
check('request: an assistant turn at the end (a prefill) is dropped, unknown roles become user, non-text contents are skipped; an empty system is not sent', function () {
    $r = Claude::buildRequest(['system' => '  ', 'messages' => [['role' => 'user', 'content' => 'a'], ['role' => 'robot', 'content' => 'b'], ['role' => 'user', 'content' => ['x']], ['role' => 'assistant', 'content' => '미리 쓴 답']]]);
    if (isset($r['body']['system'])) return 'system sent';
    return $r['body']['messages'] === [['role' => 'user', 'content' => 'a'], ['role' => 'user', 'content' => 'b']] ? true : j($r['body']['messages']);
});
check('request: settings are cleaned — a bad effort → low, a bad model → the default, an http api_base to another host → the real API, max_tokens clamped, maxTokens of the call wins', function () {
    Config::override('anthropic.effort', 'turbo');
    Config::override('anthropic.model', 'claude"; rm -rf /');
    Config::override('anthropic.api_base', 'http://evil.example.com');
    Config::override('anthropic.max_tokens', 999999);
    $r = Claude::buildRequest(['messages' => [['role' => 'user', 'content' => 'x']]]);
    $r2 = Claude::buildRequest(['messages' => [['role' => 'user', 'content' => 'x']], 'maxTokens' => 300]);
    foreach (['anthropic.effort', 'anthropic.model', 'anthropic.api_base', 'anthropic.max_tokens'] as $k) Config::override($k, null);
    if ($r['body']['output_config']['effort'] !== 'low' || $r['body']['model'] !== 'claude-opus-5-5' || strpos($r['url'], 'https://api.anthropic.com/') !== 0) return j($r);
    return $r['body']['max_tokens'] === 64000 && $r2['body']['max_tokens'] === 300 ? true : 'max ' . $r['body']['max_tokens'] . ' / ' . $r2['body']['max_tokens'];
});
check('request: describeRequest shows the key as *** and nothing else differs', function () {
    $a = Claude::buildRequest(['messages' => [['role' => 'user', 'content' => 'x']]]);
    $d = Claude::describeRequest(['messages' => [['role' => 'user', 'content' => 'x']]]);
    if (!noKey($d) || !in_array('x-api-key: ***', $d['headers'], true)) return j($d);
    return $a['body'] === $d['body'] && $a['url'] === $d['url'] ? true : 'differs';
});

// ---------------------------------------------------------------------------------------------- answers through the stub (the real curl transport)
check('stub ok: the answer is the text blocks joined (the thinking block skipped), model and tokens read, one usage row ok=1 end_turn — and the stub saw exactly the required request', function () use ($uidAdm) {
    stubReset(); scenario('ok'); Db::exec('DELETE FROM ai_usage');
    $r = Claude::adminAsk('김치는 어떻게 만들어요?', $uidAdm);
    if (!$r['ok'] || $r['text'] !== '배추를 소금에 절여 양념을 발라요. 항아리에서 천천히 익어요.' || $r['model'] !== 'claude-opus-5-5' || $r['usage'] !== ['in' => 120, 'out' => 48] || $r['stop'] !== 'end_turn') return j($r);
    $log = stubLog();
    if ($log['violations']) return 'stub: ' . j($log['violations']);
    if (count($log['requests']) !== 1) return 'requests ' . count($log['requests']);
    $rq = $log['requests'][0];
    if ($rq['headers']['x-api-key'] !== '***' || $rq['headers']['anthropic-version'] !== '2026-10-21' || $rq['headers']['anthropic-beta'] !== 'server-side-fallback-2026-07-01') return j($rq['headers']);
    if ($f = getenv('TFM_AI_EVIDENCE')) file_put_contents($f, j(['stub_saw' => $rq, 'client_built' => Claude::lastRequest()]));
    $rows = rows();
    return count($rows) === 1 && (int) $rows[0]['ok'] === 1 && $rows[0]['stop_reason'] === 'end_turn' && (int) $rows[0]['input_tokens'] === 120 && (int) $rows[0]['output_tokens'] === 48 && $rows[0]['scope'] === 'admin' ? true : j($rows);
});
check('stub fallback: a declined request re-run by the server — response.model (the model that served) is reported and fallback is true', function () use ($uidAdm) {
    scenario('fallback');
    $r = Claude::adminAsk('x', $uidAdm);
    return $r['ok'] && $r['model'] === 'claude-opus-5' && $r['fallback'] === true && $r['text'] === '다른 모델이 답했어요.' ? true : j($r);
});
check('stub refusal: stop_reason refusal → no text at all (the partial text is discarded), code refusal; the child sees the calm refusal line', function () use ($uidA, $uidAdm) {
    scenario('refusal');
    Settings::set('ai.kid_helper', true, $uidAdm);
    $r = Claude::adminAsk('x', $uidAdm);
    if ($r['ok'] || $r['text'] !== '' || $r['code'] !== 'refusal' || $r['stop'] !== 'refusal') return j($r);
    $k = Claude::kidAsk($uidA, ['presetId' => 'kimchi']);
    return !$k['ok'] && $k['why'] === 'refusal' && $k['answer'] === Claude::calmLine('refusal') ? true : j($k);
});
check('stub max_tokens without text (thinking used the budget) → code empty, the child sees "잘 모르겠어요, 선생님께 여쭤봐요."; with partial text → the partial text, why partial', function () use ($uidA) {
    scenario('maxempty');
    $k = Claude::kidAsk($uidA, ['presetId' => 'meju']);
    if ($k['ok'] || $k['why'] !== 'empty' || $k['answer'] !== '잘 모르겠어요, 선생님께 여쭤봐요.') return 'empty: ' . j($k);
    scenario('maxpartial');
    $k = Claude::kidAsk($uidA, ['presetId' => 'meju']);
    return $k['ok'] && $k['why'] === 'partial' && strpos($k['answer'], '된장은 콩으로') === 0 ? true : 'partial: ' . j($k);
});
check('stub 429 with retry-after: 1 → waits 1 s (recorded), retries once, gets the answer', function () use ($uidAdm) {
    stubReset(); scenario('r429');
    $r = Claude::adminAsk('x', $uidAdm);
    $hits = stubLog()['hits']['r429'] ?? 0;
    return $r['ok'] && $hits === 2 && $GLOBALS['WAITS'] === [1.0] ? true : j(['r' => $r, 'hits' => $hits, 'waits' => $GLOBALS['WAITS']]);
});
check('stub 429 with retry-after: 30 (longer than we wait) → no retry, code rate, the reason names 429', function () use ($uidAdm) {
    stubReset(); scenario('r429long');
    $r = Claude::adminAsk('x', $uidAdm);
    $hits = stubLog()['hits']['r429long'] ?? 0;
    return !$r['ok'] && $r['code'] === 'rate' && $hits === 1 && strpos((string) $r['error'], '429') !== false ? true : j(['r' => $r, 'hits' => $hits]);
});
check('stub 529 twice then ok → two retries with growing backoff (0.5 s, 1 s), the third answer is used; always 529 → three attempts, code overloaded', function () use ($uidAdm) {
    stubReset(); scenario('o529');
    $r = Claude::adminAsk('x', $uidAdm);
    $w = $GLOBALS['WAITS'];
    if (!$r['ok'] || $r['text'] !== '세 번째에 받은 답이에요.' || $w !== [0.5, 1.0]) return 'o529: ' . j(['r' => $r, 'waits' => $w]);
    stubReset(); scenario('o529x');
    $r = Claude::adminAsk('x', $uidAdm);
    $hits = stubLog()['hits']['o529x'] ?? 0;
    return !$r['ok'] && $r['code'] === 'overloaded' && $hits === 3 ? true : 'o529x: ' . j(['r' => $r, 'hits' => $hits]);
});
check('stub 500 with x-should-retry: false → no retry, code server', function () use ($uidAdm) {
    stubReset(); scenario('noretry');
    $r = Claude::adminAsk('x', $uidAdm);
    $hits = stubLog()['hits']['noretry'] ?? 0;
    return !$r['ok'] && $r['code'] === 'server' && $hits === 1 ? true : j(['r' => $r, 'hits' => $hits]);
});
check('stub slow (8 s) with anthropic.timeout 5 → stops at the deadline (< 7 s), code timeout, no retry after a timeout; the usage row is completed ok=0', function () use ($uidAdm) {
    stubReset(); scenario('slow'); Config::override('anthropic.timeout', 5); Db::exec('DELETE FROM ai_usage');
    $t = microtime(true);
    $r = Claude::adminAsk('x', $uidAdm);
    $dt = microtime(true) - $t;
    Config::override('anthropic.timeout', null);
    $hits = stubLog()['hits']['slow'] ?? 0;
    $rows = rows();
    if ($r['ok'] || $r['code'] !== 'timeout' || $dt > 7 || $hits !== 1) return j(['r' => $r, 'dt' => $dt, 'hits' => $hits]);
    return count($rows) === 1 && (int) $rows[0]['ok'] === 0 && $rows[0]['stop_reason'] === 'timeout' ? true : j($rows);
});
check('stub garbage (200, not JSON) → code garbage, a plain reason, no text', function () use ($uidAdm) {
    scenario('garbage');
    $r = Claude::adminAsk('x', $uidAdm);
    return !$r['ok'] && $r['code'] === 'garbage' && $r['text'] === '' ? true : j($r);
});
check('stub 401 → code auth, the reason "API 키가 맞지 않아요 (401) · authentication_error", no retry', function () use ($uidAdm) {
    stubReset(); scenario('auth');
    $r = Claude::adminAsk('x', $uidAdm);
    return !$r['ok'] && $r['code'] === 'auth' && $r['error'] === 'API 키가 맞지 않아요 (401) · authentication_error' && (stubLog()['hits']['auth'] ?? 0) === 1 ? true : j($r);
});
check('the key is never in a result, a log line or a database row — even when the far side repeats it in its error message', function () use ($uidAdm, $tmp) {
    scenario('leak');
    $r = Claude::adminAsk('x', $uidAdm);
    $s = Claude::selfTest($uidAdm);
    if (!noKey($r) || !noKey($s) || !noKey(Claude::settings()) || !noKey(Claude::lastRequest())) return 'in a result';
    foreach (glob("$tmp/logs/*") ?: [] as $f) if (!noKey((string) file_get_contents($f))) return 'in log ' . basename($f);
    foreach (['ai_usage', 'audit_log', 'settings'] as $t) if (Db::hasTable($t) && !noKey(Db::all("SELECT * FROM $t"))) return "in table $t";
    return Claude::scrub('x ' . KEY . ' y sk-ant-other-abcdef123') === 'x *** y sk-ant-***' ? true : 'scrub ' . Claude::scrub('x ' . KEY);
});
check('a real network failure (nothing listens) → code network, the reason says it plainly', function () use ($uidAdm) {
    Config::override('anthropic.api_key', KEY);
    Config::override('anthropic.api_base', 'http://127.0.0.1:9');
    Config::override('anthropic.timeout', 5);
    $r = Claude::adminAsk('x', $uidAdm);
    Config::override('anthropic.timeout', null);
    return !$r['ok'] && in_array($r['code'], ['network', 'timeout'], true) && $r['error'] !== '' ? true : j($r);
});

// ---------------------------------------------------------------------------------------------- 옹이 선생님
check('kid: the helper is off until the operator switches it on (Settings ai.kid_helper; a key alone is not enough); the row is public (site) now', function () use ($uidA, $uidAdm) {
    scenario('ok');
    Settings::set('ai.kid_helper', false, $uidAdm);
    if (Claude::kidEnabled()) return 'on while switched off';
    $k = Claude::kidAsk($uidA, ['presetId' => 'kimchi']);
    if ($k['why'] !== 'off') return j($k);
    Settings::set('ai.kid_helper', true, $uidAdm);
    $pub = Settings::publicValues();
    return Claude::kidEnabled() && array_key_exists('ai.kid_helper', $pub) && $pub['ai.kid_helper'] === true ? true : 'public ' . j($pub['ai.kid_helper'] ?? null);
});
check('kid: a preset id is resolved on the server — the stub receives the preset\'s own question and the fixed kid system prompt; an unknown preset is not sent', function () use ($uidA) {
    stubReset(); scenario('echo');
    $k = Claude::kidAsk($uidA, ['presetId' => 'jangdok']);
    $log = stubLog();
    $b = $log['requests'][0]['body'] ?? [];
    if (!$k['ok'] || ($b['messages'][0]['content'] ?? '') !== '장독대 항아리는 왜 햇볕 드는 곳에 두어요?' || ($b['system'] ?? '') !== Claude::KID_SYSTEM) return j(['k' => $k, 'b' => $b]);
    if ($b['max_tokens'] !== 2048 || $log['violations']) return 'max_tokens / violations ' . j($log['violations']);
    stubReset();
    $k = Claude::kidAsk($uidA, ['presetId' => 'nope']);
    return !$k['ok'] && $k['why'] === 'unknown_preset' && count(stubLog()['requests']) === 0 ? true : j($k);
});
check('kid: personal data is masked BEFORE the question leaves (phone, e-mail) and AFTER the answer comes back; links and markup are removed', function () use ($uidA) {
    stubReset(); scenario('echo');
    $k = Claude::kidAsk($uidA, ['question' => '제 번호는 010-1234-5678 이고 메일은 kid@example.com 이에요. **김치** 알려 줘요 https://evil.example/x']);
    $sent = stubLog()['requests'][0]['body']['messages'][0]['content'] ?? '';
    if (strpos($sent, '1234-5678') !== false || strpos($sent, 'kid@example.com') !== false) return 'sent unmasked: ' . $sent;
    $a = $k['answer'];
    if (!$k['ok'] || strpos($a, '5678') !== false || strpos($a, 'kid@example.com') !== false || strpos($a, 'http') !== false || strpos($a, '**') !== false) return 'answer: ' . $a;
    return true;
});
check('kid: a question with a bad word is not sent at all ("고운 말로 다시 물어봐 줄래요?"), and no usage row is written', function () use ($uidA) {
    stubReset(); scenario('echo'); Db::exec('DELETE FROM ai_usage');
    $k = Claude::kidAsk($uidA, ['question' => '시발 김치 몰라']);
    return !$k['ok'] && $k['why'] === 'words' && $k['answer'] === '고운 말로 다시 물어봐 줄래요?' && count(stubLog()['requests']) === 0 && count(rows()) === 0 ? true : j($k);
});
check('kid: an empty or too long question (> 200 characters) is not sent; control characters are removed', function () use ($uidA) {
    stubReset(); scenario('echo');
    $a = Claude::kidAsk($uidA, ['question' => "  \t "]);
    $b = Claude::kidAsk($uidA, ['question' => str_repeat('가', 201)]);
    $c = Claude::kidAsk($uidA, ['question' => "김치\x00는\x1b 뭐예요"]);
    $sent = stubLog()['requests'][0]['body']['messages'][0]['content'] ?? '';
    return $a['why'] === 'length' && $b['why'] === 'length' && $c['ok'] && count(stubLog()['requests']) === 1 && $sent === '김치 는 뭐예요' ? true : j([$a, $b, $c, $sent]);
});
check('kid: the answer is cut at 600 characters (at a sentence end when there is one), bad words in it are masked', function () {
    $long = str_repeat('김치는 배추로 만들어요. ', 80);
    $c = Claude::cleanAnswer($long);
    if (mb_strlen($c) > 600 || mb_substr($c, -1) !== '.') return mb_strlen($c) . ' ' . mb_substr($c, -5);
    $d = Claude::cleanAnswer(str_repeat('가', 900));
    if (mb_strlen($d) !== 600 || mb_substr($d, -1) !== '…') return 'no sentence: ' . mb_strlen($d);
    return strpos(Claude::cleanAnswer('이건 시발 맛이에요'), '시발') === false ? true : 'bad word kept';
});
check('kid: the calm lines — every reason has one, all calm Korean, no link, nothing alarming', function () {
    foreach (['off', 'capped_user', 'capped', 'words', 'refusal', 'empty', 'unsure', 'error', 'network'] as $w) {
        $l = Claude::calmLine($w);
        if ($l === '' || !preg_match('/[가-힣]/u', $l) || preg_match('/http|오류|에러|실패|error/i', $l)) return "$w: $l";
    }
    return Claude::calmLine('empty') === '잘 모르겠어요, 선생님께 여쭤봐요.' ? true : 'unsure line';
});
check('kid: the fixed system prompt holds the rules — Korean, two or three sentences, only the 체험관 topics, no personal data, no links, NO health claims, the "잘 모르겠어요" line', function () {
    $s = Claude::KID_SYSTEM;
    foreach (['두세 문장', '농사', '발효', '한옥', '한복', '봄 여름 가을 겨울', '개인정보', '링크', '몸에 좋다', '병원', '맛, 냄새', '잘 모르겠어요, 선생님께 여쭤봐요.'] as $w) if (mb_strpos($s, $w) === false) return "missing: $w";
    return preg_match('/\p{Han}/u', $s) ? 'Chinese characters' : true;
});
check('kid: presets — at least 8, unique ids, an icon, a label and a voice line each, no mock text and no question text leaks to the page list', function () {
    $p = Claude::presets();
    if (count($p) < 8) return 'only ' . count($p);
    $ids = [];
    foreach ($p as $x) {
        if (array_keys($x) !== ['id', 'icon', 'label', 'say', 'topic'] || $x['label'] === '' || $x['say'] === '' || $x['icon'] === '') return j($x);
        $ids[$x['id']] = 1;
    }
    return count($ids) === count($p) ? true : 'duplicate ids';
});
check('kid: the sample tiles of the app\'s preview() (src/game/73-ai.js) are the server\'s presets (same ids, icons and labels)', function () {
    $js = (string) @file_get_contents(__DIR__ . '/../src/game/73-ai.js');
    if (!preg_match('/const PREVIEW_TILES = \[(.*?)\];/s', $js, $m)) return 'PREVIEW_TILES not found';
    preg_match_all("/\{ id: '([a-z0-9_]+)', icon: '([^']+)', label: '([^']+)' \}/u", $m[1], $all, PREG_SET_ORDER);
    $app = array_map(function ($x) { return [$x[1], $x[2], $x[3]]; }, $all);
    $srv = array_map(function ($p) { return [$p['id'], $p['icon'], $p['label']]; }, Claude::presets());
    return $app === $srv ? true : j(['app' => $app, 'server' => $srv]);
});

// ---------------------------------------------------------------------------------------------- caps and usage rows
check('caps per account: with ai.daily_user 3 the fourth question of A is not sent (capped_user, "내일 또 만나요"); B may still ask; left counts down', function () use ($uidA, $uidB, $setCaps) {
    stubReset(); scenario('ok'); Db::exec('DELETE FROM ai_usage'); $setCaps(3, 1000);
    $lefts = [];
    for ($i = 0; $i < 3; $i++) { $k = Claude::kidAsk($uidA, ['presetId' => 'kimchi']); if (!$k['ok']) return "q$i " . j($k); $lefts[] = $k['left']; }
    $k = Claude::kidAsk($uidA, ['presetId' => 'kimchi']);
    $sent = count(stubLog()['requests']);
    if ($k['ok'] || $k['why'] !== 'capped_user' || strpos($k['answer'], '내일') === false || $sent !== 3 || $lefts !== [2, 1, 0]) return j(['k' => $k, 'sent' => $sent, 'lefts' => $lefts]);
    $b = Claude::kidAsk($uidB, ['presetId' => 'kimchi']);
    return $b['ok'] && Claude::left($uidA) === 0 && Claude::left($uidB) === 2 ? true : j($b);
});
check('caps per day for the whole server: ai.daily_total counts every scope (kid + admin + cli); at the cap nothing is sent (capped)', function () use ($uidA, $uidB, $uidAdm, $setCaps) {
    stubReset(); scenario('ok'); Db::exec('DELETE FROM ai_usage'); $setCaps(100, 3);
    Claude::adminAsk('x', $uidAdm); Claude::kidAsk($uidA, ['presetId' => 'kimchi']); Claude::selfTest();
    $k = Claude::kidAsk($uidB, ['presetId' => 'kimchi']);
    $r = Claude::adminAsk('y', $uidAdm);
    $sent = count(stubLog()['requests']);
    $setCaps(100, 10000);
    return !$k['ok'] && $k['why'] === 'capped' && !$r['ok'] && $r['code'] === 'capped' && $sent === 3 ? true : j(['k' => $k, 'r' => $r, 'sent' => $sent]);
});
check('caps: rows of yesterday do not count; a cap of 0 closes the helper', function () use ($uidA, $setCaps) {
    stubReset(); scenario('ok'); Db::exec('DELETE FROM ai_usage'); $setCaps(1, 1000);
    Db::insert('ai_usage', ['created_at' => Tfm\Clock::startOfDayMs() - 3600000, 'user_id' => $uidA, 'scope' => 'kid', 'model' => 'm', 'input_tokens' => 1, 'output_tokens' => 1, 'stop_reason' => 'end_turn', 'ok' => 1, 'ms' => 1]);
    $k = Claude::kidAsk($uidA, ['presetId' => 'kimchi']);
    if (!$k['ok']) return 'yesterday counted: ' . j($k);
    $setCaps(0, 1000);
    $k = Claude::kidAsk($uidA, ['presetId' => 'meju']);
    $setCaps(100, 10000);
    return $k['why'] === 'capped_user' ? true : j($k);
});
check('usage rows: who, when, scope, model, tokens, stop reason, ok, ms — and never the question or the answer text', function () use ($uidA) {
    stubReset(); scenario('echo'); Db::exec('DELETE FROM ai_usage');
    $q = '배추흰나비는 김치를 좋아해요?';
    $k = Claude::kidAsk($uidA, ['question' => $q]);
    $rows = rows();
    if (!$k['ok'] || count($rows) !== 1) return j([$k, $rows]);
    $r = $rows[0];
    if ((int) $r['user_id'] !== $uidA || $r['scope'] !== 'kid' || $r['model'] !== 'claude-opus-5-5' || (int) $r['ok'] !== 1 || $r['stop_reason'] !== 'end_turn' || (int) $r['created_at'] <= 0) return j($r);
    $cols = array_keys($r);
    sort($cols);
    if ($cols !== ['created_at', 'id', 'input_tokens', 'model', 'ms', 'ok', 'output_tokens', 'scope', 'stop_reason', 'user_id']) return 'columns ' . j($cols);
    return strpos(j($rows), '배추흰나비') === false ? true : 'text stored';
});
check('usageToday: totals, tokens, per scope, failures and the caps — counts only', function () use ($uidAdm) {
    scenario('auth'); Claude::adminAsk('x', $uidAdm);
    $u = Claude::usageToday();
    return $u['total'] === 2 && $u['byScope'] === ['admin' => 1, 'kid' => 1] && $u['failed'] === 1 && $u['tokensIn'] === 120 && $u['caps'] === ['user' => 100, 'total' => 10000] && $u['kidUsers'] === 1 ? true : j($u);
});

// ---------------------------------------------------------------------------------------------- mock mode · self-test · admin helpers
check('mock mode: answers locally (the transport is never called), presets get their written answers, the usage row says model mock', function () use ($uidA) {
    Config::override('anthropic.api_key', '');
    Config::override('anthropic.mock', true);
    $called = false;
    Claude::setTransport(function () use (&$called) { $called = true; return ['status' => 500]; });
    Db::exec('DELETE FROM ai_usage');
    $k = Claude::kidAsk($uidA, ['presetId' => 'kimchi']);
    $s = Claude::selfTest();
    $rows = rows();
    Claude::setTransport(null);
    Config::override('anthropic.mock', null);
    if ($called || !$k['ok'] || strpos($k['answer'], '배추') === false || !$s['ok'] || $s['model'] !== 'mock' || $s['mock'] !== true) return j([$called, $k, $s]);
    return count($rows) === 2 && $rows[0]['model'] === 'mock' ? true : j($rows);
});
check('the env word TFM_AI_MOCK=1 in config means mock (strings "1" / "true" / "on")', function () {
    foreach (['1', 'true', 'on', 'yes'] as $v) { Config::override('anthropic.mock', $v); if (!Claude::isMock()) return $v; }
    Config::override('anthropic.mock', '0');
    $off = !Claude::isMock();
    Config::override('anthropic.mock', null);
    return $off ? true : '"0" counted as on';
});
check('selfTest through the stub: ok, the model that served, tokens, latency, and the request as sent with x-api-key: ***', function () {
    scenario('ok');
    $s = Claude::selfTest();
    if (!$s['ok'] || $s['model'] !== 'claude-opus-5-5' || $s['usage']['in'] !== 120 || !is_int($s['ms'])) return j($s);
    return noKey($s) && in_array('x-api-key: ***', $s['request']['headers'], true) && $s['request']['body']['max_tokens'] === 512 ? true : j($s['request']);
});
check('memoDraft sends only crop / stars / amount / the masked note / status (never an account), daySummary only the numbers', function () use ($uidAdm) {
    stubReset(); scenario('echo');
    Claude::memoDraft(['cropName' => '상추', 'stars' => 3, 'amount' => 2, 'note' => '엄마 번호 010-9876-5432', 'status' => 'pending', 'userId' => 77, 'email' => 'x@y.kr'], $uidAdm);
    $sent = stubLog()['requests'][0]['body']['messages'][0]['content'] ?? '';
    if (strpos($sent, '상추') === false || strpos($sent, '9876-5432') !== false || strpos($sent, 'x@y.kr') !== false || strpos($sent, 'userId') !== false) return $sent;
    stubReset();
    Claude::daySummary(['accounts' => 5, 'onlineNow' => 1], $uidAdm);
    $sent = stubLog()['requests'][0]['body']['messages'][0]['content'] ?? '';
    return strpos($sent, '"accounts":5') !== false ? true : $sent;
});
check('every request the stub saw in this suite followed the rules (no violations)', function () {
    $v = stubLog()['violations'];
    return !$v ? true : j($v);
});

// ---------------------------------------------------------------------------------------------- the endpoints over php -S
$ENDPOINTS = is_file($srv . '/api/ai/ask.php') && is_file($srv . '/api/ai/status.php');
if ($ENDPOINTS) require __DIR__ . '/ai-unit-http.inc.php';

echo PHP_EOL . "ai-unit: $passed passed, $failed failed (driver $DRIVER)" . PHP_EOL;
exit($failed ? 1 : 0);
