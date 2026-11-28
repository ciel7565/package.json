<?php
/**
 * Tfm\Claude — the server's only door to the Claude API (CONTRACT §15.6 / §16.10, owner: claude).
 *
 * Transport: the official PHP SDK needs PHP 8.1, the hosting is PHP 7.2 → raw HTTPS through the curl extension:
 *   POST {api_base}/v1/messages
 *   headers  content-type: application/json · x-api-key: <key> · anthropic-version: 2026-10-21
 *            · anthropic-beta: server-side-fallback-2026-07-01 (only for the models that offer server-side fallbacks)
 *   body     {model, max_tokens, system, messages:[{role:'user', content}], output_config:{effort}, fallbacks:'default'?}
 *   Never sent: temperature / top_p / top_k (400 on 2026-10-21), a thinking field (thinking cannot be switched off on
 *   the default model; it is steered by effort only), an assistant prefill (400 on current models).
 *   TLS verification always on (an optional anthropic.ca_file names the CA bundle on Windows / XAMPP). Up to 2 retries
 *   on 408 / 409 / 429 / 5xx / 529 / connection errors, honouring retry-after and x-should-retry, inside one overall
 *   deadline of anthropic.timeout seconds.
 * Reading the answer: stop_reason first — refusal → no text is used (the kid layer answers a calm line), max_tokens →
 *   the partial text, or nothing when thinking used the budget (a calm line); the text is the concatenation of the
 *   content blocks of type "text" only (thinking / fallback blocks come first and are skipped); response.model is the
 *   model that served (a fallback model when the server re-ran a declined request).
 *
 * The key: Config anthropic.api_key (config.local.php or the environment ANTHROPIC_API_KEY), '' = the feature is off.
 * It never appears in a log line, an error text, an exception message, the audit trail, a response to the browser or the
 * database: every string that leaves this class goes through scrub().
 * Mock mode (anthropic.mock / TFM_AI_MOCK=1): answers are made here, nothing leaves the server (tests, demos).
 *
 * Public API (never throws):
 *   configured(): bool · enabled(): bool · kidEnabled(): bool · isMock(): bool · settings(): array (no key)
 *   ask(['system', 'messages' => [['role' => 'user'|'assistant', 'content' => string]], 'scope' => 'kid'|'admin'|'cli',
 *        'userId' => ?int, 'maxTokens' => ?int])
 *     → ['ok', 'text', 'stop', 'model', 'usage' => ['in', 'out'], 'error' => ?string, 'code' => ?string, 'ms', 'fallback']
 *   kidAsk(int $userId, ['question' => string] | ['presetId' => string]) → ['ok', 'answer', 'why', 'left', 'presetId']
 *   presets(): [['id', 'icon', 'label', 'say', 'topic'], …] — the questions a child taps (the text is resolved HERE)
 *   memoDraft(array $report, int $actorId) · daySummary(array $numbers, int $actorId) · adminAsk(string $prompt, int $actorId)
 *   selfTest(): one tiny request → ['ok', 'model', 'ms', 'usage', 'stop', 'error', 'request' (headers, key shown as ***)]
 *   usageToday(): ['total', 'tokensIn', 'tokensOut', 'byScope', 'failed', 'caps' => ['user', 'total']] · usedToday(int $uid) · left(int $uid)
 *   buildRequest(array $opt) → ['url', 'headers', 'body'] · describeRequest(array $opt) (the same, key → ***)
 * Usage rows (ai_usage): who, when, the scope, the model, the token counts, the stop reason, ok, ms — never a question
 * or an answer. A row is written before the call (so concurrent calls count against the caps) and completed after.
 * PHP 7.2 syntax only.
 */
declare(strict_types=1);

namespace Tfm;

if (!defined('TFM_BOOT')) { if (function_exists('header_remove')) header_remove('X-Powered-By'); http_response_code(404); exit; }

final class Claude
{
    public const API_VERSION = '2026-10-21';
    public const FALLBACK_BETA = 'server-side-fallback-2026-07-01';
    /** the models that accept the server-side fallbacks parameter (Claude API docs, Nov 2026); others never get it */
    public const FALLBACK_MODELS = ['claude-fable-5-2', 'claude-fable-5-1', 'claude-opus-5-5', 'claude-opus-5', 'claude-sonnet-5-5'];
    public const DEFAULT_MODEL = 'claude-opus-5-5';
    public const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
    public const SCOPES = ['kid', 'admin', 'cli'];
    private const MAX_RETRIES = 2;
    private const MAX_WAIT_S = 10;

    /** @var callable|null test hook: fn(string $url, array $headers, string $body, float $timeoutS): array {status, headers, body, error, timeout} */
    private static $transport = null;
    /** @var callable|null test hook: fn(float $seconds): void */
    private static $sleeper = null;
    /** @var array|null the last request as sent (key → ***), for the self-test and the tests */
    private static $lastRequest = null;

    // ================================================================== settings
    private static function truthy($v): bool
    {
        if ($v === true || $v === 1) return true;
        if (!is_string($v)) return false;
        return in_array(strtolower(trim($v)), ['1', 'true', 'on', 'yes'], true);
    }

    private static function key(): string
    {
        $k = Config::get('anthropic.api_key', '');
        return is_string($k) ? trim($k) : '';
    }

    public static function isMock(): bool { return self::truthy(Config::get('anthropic.mock', false)); }

    /** a key is set (or the mock mode is on) */
    public static function configured(): bool
    {
        try { return self::isMock() || self::key() !== ''; } catch (\Throwable $e) { return false; }
    }

    /** usable right now: configured, and the curl extension is there for a real call */
    public static function enabled(): bool
    {
        try { return self::configured() && (self::isMock() || self::$transport !== null || function_exists('curl_init')); } catch (\Throwable $e) { return false; }
    }

    /** the 옹이 선생님 helper for visitors: enabled AND switched on by the operator (Settings ai.kid_helper, else config) */
    public static function kidEnabled(): bool
    {
        try {
            if (!self::enabled()) return false;
            if (class_exists('Tfm\Settings') && Settings::has('ai.kid_helper')) return (bool) Settings::get('ai.kid_helper', false);
            return self::truthy(Config::get('anthropic.kid_helper', false));
        } catch (\Throwable $e) { return false; }
    }

    public static function model(): string
    {
        $m = Config::get('anthropic.model', self::DEFAULT_MODEL);
        $m = is_string($m) ? trim($m) : '';
        return preg_match('/^[a-z0-9][a-z0-9._:@\/-]{1,79}\z/i', $m) ? $m : self::DEFAULT_MODEL;
    }

    public static function effort(): string
    {
        $e = strtolower(trim((string) Config::get('anthropic.effort', 'low')));
        return in_array($e, self::EFFORTS, true) ? $e : 'low';
    }

    private static function maxTokens(): int { return max(256, min(64000, (int) Config::get('anthropic.max_tokens', 4096))); }
    private static function timeoutS(): float { return (float) max(5, min(300, (int) Config::get('anthropic.timeout', 60))); }

    /** the API base: https, or plain http to this machine only (the local stub of the tests) */
    public static function apiBase(): string
    {
        $b = rtrim(trim((string) Config::get('anthropic.api_base', 'https://api.anthropic.com')), '/');
        if (preg_match('#^https://[a-z0-9.-]+(:\d{1,5})?(/[A-Za-z0-9._/-]*)?\z#i', $b)) return $b;
        if (preg_match('#^http://(127\.0\.0\.1|localhost|\[::1\])(:\d{1,5})?(/[A-Za-z0-9._/-]*)?\z#i', $b)) return $b;
        return 'https://api.anthropic.com';
    }

    /** send the server-side fallbacks parameter? anthropic.fallbacks: 'auto' (the models that offer it) | 'off' */
    private static function useFallbacks(string $model): bool
    {
        $f = strtolower(trim((string) Config::get('anthropic.fallbacks', 'auto')));
        if (in_array($f, ['off', '0', 'false', 'no'], true)) return false;
        return in_array($model, self::FALLBACK_MODELS, true);
    }

    public static function capUser(): int
    {
        $d = (int) Config::get('anthropic.daily_user', 20);
        if (class_exists('Tfm\Settings') && Settings::isDefined('ai.daily_user')) $d = (int) Settings::get('ai.daily_user', $d);
        return max(0, $d);
    }

    public static function capTotal(): int
    {
        $d = (int) Config::get('anthropic.daily_total', 2000);
        if (class_exists('Tfm\Settings') && Settings::isDefined('ai.daily_total')) $d = (int) Settings::get('ai.daily_total', $d);
        return max(0, $d);
    }

    public static function questionMax(): int { return max(20, min(1000, (int) Config::get('anthropic.question_max', 200))); }
    public static function answerMax(): int { return max(100, min(4000, (int) Config::get('anthropic.answer_max', 600))); }

    /** what the admin tab and ai:test may show (never the key: only whether one is set) */
    public static function settings(): array
    {
        return ['configured' => self::configured(), 'enabled' => self::enabled(), 'mock' => self::isMock(), 'keySet' => self::key() !== '',
            'model' => self::model(), 'effort' => self::effort(), 'maxTokens' => self::maxTokens(), 'timeout' => (int) self::timeoutS(),
            'apiBase' => self::apiBase(), 'apiVersion' => self::API_VERSION, 'fallbacks' => self::useFallbacks(self::model()),
            'capUser' => self::capUser(), 'capTotal' => self::capTotal(), 'curl' => function_exists('curl_init')];
    }

    // ================================================================== test hooks
    /** tests only: replace the HTTP transport (null = curl) */
    public static function setTransport(?callable $fn): void { self::$transport = $fn; }
    /** tests only: replace sleeping between retries */
    public static function setSleeper(?callable $fn): void { self::$sleeper = $fn; }
    public static function lastRequest(): ?array { return self::$lastRequest; }

    // ================================================================== key hygiene
    /** remove the key (and anything that looks like an Anthropic key) from a string that leaves this class */
    public static function scrub(string $s): string
    {
        $k = '';
        try { $k = self::key(); } catch (\Throwable $e) { $k = ''; }
        if ($k !== '' && strlen($k) >= 6) $s = str_replace($k, '***', $s);
        $s = (string) preg_replace('/sk-ant-[A-Za-z0-9_\-]{4,}/', 'sk-ant-***', $s);
        return $s;
    }

    // ================================================================== the request
    /**
     * The exact request for $opt (system, messages, maxTokens). Messages are plain text turns; the first must be "user".
     * @return array{url: string, headers: string[], body: array}
     */
    public static function buildRequest(array $opt): array
    {
        $model = self::model();
        $msgs = [];
        foreach ((isset($opt['messages']) && is_array($opt['messages']) ? $opt['messages'] : []) as $m) {
            if (!is_array($m) || !isset($m['content']) || !is_string($m['content'])) continue;
            $role = isset($m['role']) && $m['role'] === 'assistant' ? 'assistant' : 'user';
            $msgs[] = ['role' => $role, 'content' => $m['content']];
        }
        // no assistant prefill: the conversation always ends with the user's turn
        while ($msgs && $msgs[count($msgs) - 1]['role'] === 'assistant') array_pop($msgs);
        $max = isset($opt['maxTokens']) && is_int($opt['maxTokens']) ? max(64, min(64000, $opt['maxTokens'])) : self::maxTokens();
        $body = ['model' => $model, 'max_tokens' => $max];
        $sys = isset($opt['system']) && is_string($opt['system']) ? trim($opt['system']) : '';
        if ($sys !== '') $body['system'] = $sys;
        $body['messages'] = $msgs;
        $body['output_config'] = ['effort' => self::effort()];
        $headers = ['content-type: application/json', 'x-api-key: ' . self::key(), 'anthropic-version: ' . self::API_VERSION];
        if (self::useFallbacks($model)) {
            $body['fallbacks'] = 'default';
            $headers[] = 'anthropic-beta: ' . self::FALLBACK_BETA;
        }
        return ['url' => self::apiBase() . '/v1/messages', 'headers' => $headers, 'body' => $body];
    }

    /** the request with the key replaced by *** (evidence, the self-test, the docs) */
    public static function describeRequest(array $opt): array
    {
        $r = self::buildRequest($opt);
        foreach ($r['headers'] as $i => $h) if (stripos($h, 'x-api-key:') === 0) $r['headers'][$i] = 'x-api-key: ***';
        return $r;
    }

    // ================================================================== transport
    /** one HTTP exchange through curl → ['status' => int, 'headers' => [lowercase name => value], 'body' => string, 'error' => string, 'timeout' => bool] */
    private static function curlSend(string $url, array $headers, string $body, float $timeoutS): array
    {
        if (!function_exists('curl_init')) return ['status' => 0, 'headers' => [], 'body' => '', 'error' => 'curl extension missing', 'timeout' => false];
        $ch = curl_init();
        $got = [];
        $opts = [
            CURLOPT_URL => $url,
            CURLOPT_POST => true,
            CURLOPT_POSTFIELDS => $body,
            CURLOPT_HTTPHEADER => array_merge($headers, ['accept: application/json', 'user-agent: tfm-server']),
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_FOLLOWLOCATION => false,
            CURLOPT_SSL_VERIFYPEER => true,
            CURLOPT_SSL_VERIFYHOST => 2,
            CURLOPT_CONNECTTIMEOUT_MS => (int) min(10000, max(1000, $timeoutS * 1000)),
            CURLOPT_TIMEOUT_MS => (int) max(1000, $timeoutS * 1000),
            CURLOPT_HEADERFUNCTION => function ($c, $line) use (&$got) {
                $p = strpos($line, ':');
                if ($p !== false) $got[strtolower(trim(substr($line, 0, $p)))] = trim(substr($line, $p + 1));
                return strlen($line);
            },
        ];
        if (defined('CURLOPT_PROTOCOLS')) $opts[CURLOPT_PROTOCOLS] = CURLPROTO_HTTPS | CURLPROTO_HTTP;
        $ca = trim((string) Config::get('anthropic.ca_file', ''));
        if ($ca !== '' && is_file($ca)) $opts[CURLOPT_CAINFO] = $ca;
        curl_setopt_array($ch, $opts);
        $out = curl_exec($ch);
        $errno = curl_errno($ch);
        $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $err = $errno ? ('curl ' . $errno . ': ' . curl_error($ch)) : '';
        curl_close($ch);
        return ['status' => $errno ? 0 : $status, 'headers' => $got, 'body' => is_string($out) ? $out : '', 'error' => $err,
            'timeout' => $errno === 28];
    }

    private static function exchange(string $url, array $headers, string $body, float $timeoutS): array
    {
        $fn = self::$transport;
        $r = $fn !== null ? call_user_func($fn, $url, $headers, $body, $timeoutS) : self::curlSend($url, $headers, $body, $timeoutS);
        if (!is_array($r)) $r = [];
        $h = [];
        foreach ((isset($r['headers']) && is_array($r['headers']) ? $r['headers'] : []) as $k => $v) $h[strtolower((string) $k)] = (string) $v;
        return ['status' => (int) (isset($r['status']) ? $r['status'] : 0), 'headers' => $h, 'body' => isset($r['body']) && is_string($r['body']) ? $r['body'] : '',
            'error' => isset($r['error']) && is_string($r['error']) ? $r['error'] : '', 'timeout' => !empty($r['timeout'])];
    }

    private static function pause(float $s): void
    {
        if ($s <= 0) return;
        $fn = self::$sleeper;
        if ($fn !== null) { call_user_func($fn, $s); return; }
        usleep((int) ($s * 1000000));
    }

    /** seconds the server asked us to wait (retry-after: seconds), or null */
    private static function retryAfter(array $h): ?float
    {
        if (!isset($h['retry-after'])) return null;
        $v = trim($h['retry-after']);
        if (preg_match('/^\d+(\.\d+)?\z/', $v)) return (float) $v;
        $t = strtotime($v);
        return $t !== false ? (float) max(0, $t - time()) : null;
    }

    /**
     * Send with retries inside one deadline → the parsed result (without usage bookkeeping).
     * Retries: connection errors (not a timeout: that used the deadline), 408 / 409 / 429 / 5xx / 529 — unless the
     * answer says x-should-retry: false; a wait longer than MAX_WAIT_S or past the deadline ends the attempts.
     */
    private static function send(array $req): array
    {
        $json = Json::encode($req['body'], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        $start = microtime(true);
        $deadline = $start + self::timeoutS();
        $attempt = 0;
        $last = null;
        while (true) {
            $left = $deadline - microtime(true);
            if ($left <= 0.2) break;
            $r = self::exchange($req['url'], $req['headers'], $json, $left);
            $last = $r;
            $st = $r['status'];
            if ($st >= 200 && $st < 300) return self::parse($r['body'], $st);
            $should = isset($r['headers']['x-should-retry']) ? strtolower($r['headers']['x-should-retry']) : '';
            $retryable = $st === 0 ? !$r['timeout'] : ($st === 408 || $st === 409 || $st === 429 || $st >= 500);
            if ($should === 'false') $retryable = false;
            if ($should === 'true') $retryable = true;
            if (!$retryable || $attempt >= self::MAX_RETRIES) break;
            $wait = self::retryAfter($r['headers']);
            if ($wait === null) $wait = 0.5 * pow(2, $attempt);
            if ($wait > self::MAX_WAIT_S || microtime(true) + $wait >= $deadline - 0.5) break;
            self::pause($wait);
            $attempt++;
        }
        return self::failure($last, $attempt);
    }

    /** a failed exchange → a result with a short code and a plain Korean reason (scrubbed, no key, no body text) */
    private static function failure(?array $r, int $attempts): array
    {
        $st = $r ? $r['status'] : 0;
        $apiType = '';
        if ($r && $r['body'] !== '') {
            $j = Json::tryDecode($r['body'], true);
            if (is_array($j) && isset($j['error']['type']) && is_string($j['error']['type'])) $apiType = preg_replace('/[^a-z_]/', '', $j['error']['type']);
        }
        if ($r === null) { $code = 'timeout'; $msg = '답이 늦어서 기다리다 멈췄어요'; }
        elseif ($st === 0 && $r['timeout']) { $code = 'timeout'; $msg = '답이 늦어서 기다리다 멈췄어요'; }
        elseif ($st === 0) { $code = 'network'; $msg = 'AI 서버에 연결하지 못했어요'; }
        elseif ($st === 401) { $code = 'auth'; $msg = 'API 키가 맞지 않아요 (401)'; }
        elseif ($st === 403) { $code = 'forbidden'; $msg = '이 키로는 쓸 수 없는 기능이에요 (403)'; }
        elseif ($st === 404) { $code = 'not_found'; $msg = '모델 이름이나 주소를 찾지 못했어요 (404)'; }
        elseif ($st === 413) { $code = 'too_large'; $msg = '보낸 글이 너무 길어요 (413)'; }
        elseif ($st === 429) { $code = 'rate'; $msg = 'AI 서비스에 요청이 너무 많아요 (429)'; }
        elseif ($st === 529) { $code = 'overloaded'; $msg = 'AI 서비스가 붐벼요 (529)'; }
        elseif ($st >= 500) { $code = 'server'; $msg = 'AI 서비스에 잠시 문제가 있어요 (' . $st . ')'; }
        elseif ($st === 400) { $code = 'bad_request'; $msg = '요청 모양이 맞지 않아요 (400)'; }
        else { $code = 'http'; $msg = 'AI 서비스가 받아 주지 않았어요 (' . $st . ')'; }
        if ($apiType !== '' && $code !== 'network' && $code !== 'timeout') $msg .= ' · ' . $apiType;
        $ctx = ['code' => $code, 'status' => $st, 'apiType' => $apiType, 'retries' => $attempts];
        if ($r && $r['error'] !== '') $ctx['transport'] = mb_substr(self::scrub($r['error']), 0, 160);
        Log::warn('AI', 'request failed', $ctx);
        return ['ok' => false, 'text' => '', 'stop' => '', 'model' => '', 'usage' => ['in' => 0, 'out' => 0], 'error' => self::scrub($msg), 'code' => $code, 'fallback' => false];
    }

    /** a 2xx body → result */
    private static function parse(string $body, int $status): array
    {
        $j = Json::tryDecode($body, true);
        if (!is_array($j) || !isset($j['content']) || !is_array($j['content'])) {
            Log::warn('AI', 'unreadable answer', ['status' => $status, 'bytes' => strlen($body)]);
            return ['ok' => false, 'text' => '', 'stop' => '', 'model' => '', 'usage' => ['in' => 0, 'out' => 0], 'error' => '알아볼 수 없는 답이 왔어요', 'code' => 'garbage', 'fallback' => false];
        }
        $stop = isset($j['stop_reason']) && is_string($j['stop_reason']) ? preg_replace('/[^a-z_]/', '', $j['stop_reason']) : '';
        $model = isset($j['model']) && is_string($j['model']) ? mb_substr(preg_replace('/[^A-Za-z0-9._:@\/-]/', '', $j['model']), 0, 60) : '';
        $u = isset($j['usage']) && is_array($j['usage']) ? $j['usage'] : [];
        $in = (int) (isset($u['input_tokens']) ? $u['input_tokens'] : 0) + (int) (isset($u['cache_creation_input_tokens']) ? $u['cache_creation_input_tokens'] : 0)
            + (int) (isset($u['cache_read_input_tokens']) ? $u['cache_read_input_tokens'] : 0);
        $out = (int) (isset($u['output_tokens']) ? $u['output_tokens'] : 0);
        $fallback = false;
        if (isset($u['iterations']) && is_array($u['iterations'])) foreach ($u['iterations'] as $it) if (is_array($it) && isset($it['type']) && $it['type'] === 'fallback_message') $fallback = true;
        $text = '';
        foreach ($j['content'] as $b) if (is_array($b) && isset($b['type'], $b['text']) && $b['type'] === 'text' && is_string($b['text'])) $text .= $b['text'];
        $res = ['ok' => true, 'text' => trim($text), 'stop' => $stop, 'model' => $model, 'usage' => ['in' => max(0, $in), 'out' => max(0, $out)], 'error' => null, 'code' => null, 'fallback' => $fallback];
        if ($stop === 'refusal') {
            // a declined request: partial text is discarded (it may stop mid-sentence)
            $res['ok'] = false; $res['text'] = ''; $res['code'] = 'refusal'; $res['error'] = '안전 규칙에 따라 답하지 않았어요';
        } elseif ($res['text'] === '') {
            $res['ok'] = false; $res['code'] = 'empty';
            $res['error'] = $stop === 'max_tokens' ? '생각하는 데 글자 수를 다 써서 답이 비었어요 (max_tokens)' : '빈 답이 왔어요';
        }
        return $res;
    }

    // ================================================================== mock answers (nothing leaves the server)
    private static function mockAnswer(array $opt): array
    {
        $scope = isset($opt['scope']) ? (string) $opt['scope'] : 'admin';
        $last = '';
        foreach ((isset($opt['messages']) && is_array($opt['messages']) ? $opt['messages'] : []) as $m) if (is_array($m) && isset($m['content']) && is_string($m['content'])) $last = $m['content'];
        $kind = isset($opt['kind']) ? (string) $opt['kind'] : '';
        if ($scope === 'kid') {
            $text = '';
            foreach (self::presetTable() as $p) if ($p['q'] === $last) $text = $p['mock'];
            if ($text === '') $text = '좋은 질문이에요! 발효는 작은 미생물이 천천히 맛을 바꾸는 일이에요. 체험관을 돌아보며 더 알아봐요. (연습용 답이에요)';
        } elseif ($kind === 'memo') {
            $text = '모의 초안: 정성껏 돌본 마음이 잘 보여요. 다음에는 어떤 작물을 키워 볼지 기대돼요!';
        } elseif ($kind === 'summary') {
            $text = "모의 요약: 오늘의 숫자를 받았어요.\n실제 키를 넣으면 AI가 눈에 띄는 점과 확인할 일을 정리해 줘요.";
        } elseif ($scope === 'cli') {
            $text = 'OK';
        } else {
            $text = '모의 답이에요. 실제 API 키를 넣으면 진짜 답이 와요. (받은 질문 ' . mb_strlen($last) . '자)';
        }
        return ['ok' => true, 'text' => $text, 'stop' => 'end_turn', 'model' => 'mock', 'usage' => ['in' => (int) ceil(mb_strlen($last) / 2) + 40, 'out' => (int) ceil(mb_strlen($text) / 2)],
            'error' => null, 'code' => null, 'fallback' => false];
    }

    // ================================================================== usage rows · caps
    private static function since(): int { return Clock::startOfDayMs(); }

    public static function usedToday(int $uid): int
    {
        if ($uid <= 0) return 0;
        try { return (int) Db::value("SELECT COUNT(*) FROM ai_usage WHERE user_id = ? AND scope = 'kid' AND created_at >= ?", [$uid, self::since()]); } catch (\Throwable $e) { return 0; }
    }

    private static function totalToday(): int
    {
        try { return (int) Db::value('SELECT COUNT(*) FROM ai_usage WHERE created_at >= ?', [self::since()]); } catch (\Throwable $e) { return 0; }
    }

    /** questions this account may still ask today (the kid helper) */
    public static function left(int $uid): int
    {
        return max(0, min(self::capUser() - self::usedToday($uid), self::capTotal() - self::totalToday()));
    }

    /** today's numbers for the admin tab: counts and tokens only */
    public static function usageToday(): array
    {
        $out = ['total' => 0, 'tokensIn' => 0, 'tokensOut' => 0, 'byScope' => [], 'failed' => 0, 'kidUsers' => 0, 'caps' => ['user' => self::capUser(), 'total' => self::capTotal()]];
        try {
            foreach (Db::all('SELECT scope, COUNT(*) AS n, SUM(input_tokens) AS tin, SUM(output_tokens) AS tout, SUM(CASE WHEN ok = 1 THEN 0 ELSE 1 END) AS bad FROM ai_usage WHERE created_at >= ? GROUP BY scope', [self::since()]) as $r) {
                $n = (int) $r['n'];
                $out['total'] += $n; $out['tokensIn'] += (int) $r['tin']; $out['tokensOut'] += (int) $r['tout']; $out['failed'] += (int) $r['bad'];
                $out['byScope'][(string) $r['scope']] = $n;
            }
            $out['kidUsers'] = (int) Db::value("SELECT COUNT(DISTINCT user_id) FROM ai_usage WHERE scope = 'kid' AND created_at >= ?", [self::since()]);
        } catch (\Throwable $e) { /* the table is missing: zeros */ }
        return $out;
    }

    private static function reserve(string $scope, ?int $uid): int
    {
        try {
            return Db::insert('ai_usage', ['created_at' => Clock::ms(), 'user_id' => $uid !== null && $uid > 0 ? $uid : null, 'scope' => $scope, 'model' => self::isMock() ? 'mock' : self::model(),
                'input_tokens' => 0, 'output_tokens' => 0, 'stop_reason' => 'pending', 'ok' => 0, 'ms' => 0]);
        } catch (\Throwable $e) {
            Log::warn('AI', 'usage row not written', ['scope' => $scope]);
            return 0;
        }
    }

    private static function complete(int $rowId, array $res, int $ms): void
    {
        if ($rowId <= 0) return;
        try {
            Db::exec('UPDATE ai_usage SET model = ?, input_tokens = ?, output_tokens = ?, stop_reason = ?, ok = ?, ms = ? WHERE id = ?', [
                mb_substr($res['model'] !== '' ? $res['model'] : (self::isMock() ? 'mock' : self::model()), 0, 60), (int) $res['usage']['in'], (int) $res['usage']['out'],
                mb_substr($res['stop'] !== '' ? $res['stop'] : (string) $res['code'], 0, 30), !empty($res['ok']) ? 1 : 0, max(0, $ms), $rowId]);
        } catch (\Throwable $e) { /* the row stays 'pending' and still counts */ }
    }

    // ================================================================== ask
    private static function result(bool $ok, string $code, string $error): array
    {
        return ['ok' => $ok, 'text' => '', 'stop' => '', 'model' => '', 'usage' => ['in' => 0, 'out' => 0], 'error' => $error, 'code' => $code, 'ms' => 0, 'fallback' => false];
    }

    /** one request (see the file header); never throws; writes one ai_usage row when the request is sent */
    public static function ask(array $opt): array
    {
        try {
            if (!self::enabled()) return self::result(false, 'off', 'AI 도우미가 꺼져 있어요 (키가 없어요)');
            $scope = isset($opt['scope']) && in_array($opt['scope'], self::SCOPES, true) ? (string) $opt['scope'] : 'admin';
            $uid = isset($opt['userId']) && is_int($opt['userId']) && $opt['userId'] > 0 ? $opt['userId'] : null;
            $hasUser = false;
            foreach ((isset($opt['messages']) && is_array($opt['messages']) ? $opt['messages'] : []) as $m) if (is_array($m) && (!isset($m['role']) || $m['role'] === 'user') && isset($m['content']) && is_string($m['content']) && trim($m['content']) !== '') $hasUser = true;
            if (!$hasUser) return self::result(false, 'empty_question', '보낼 질문이 없어요');
            if (self::totalToday() >= self::capTotal()) return self::result(false, 'capped', '오늘 서버 전체 질문 수(' . self::capTotal() . '번)를 다 썼어요');
            if ($scope === 'kid' && $uid !== null && self::usedToday($uid) >= self::capUser()) return self::result(false, 'capped_user', '오늘 이 계정의 질문 수(' . self::capUser() . '번)를 다 썼어요');
            $row = self::reserve($scope, $uid);
            $t0 = microtime(true);
            if (self::isMock()) {
                $res = self::mockAnswer($opt);
            } else {
                $req = self::buildRequest($opt);
                self::$lastRequest = self::describeRequest($opt);
                $res = self::send($req);
            }
            $ms = (int) round((microtime(true) - $t0) * 1000);
            $res['ms'] = $ms;
            self::complete($row, $res, $ms);
            $res['text'] = self::scrub((string) $res['text']);
            if ($res['error'] !== null) $res['error'] = self::scrub((string) $res['error']);
            return $res;
        } catch (\Throwable $e) {
            Log::error('AI', 'ask crashed', ['class' => get_class($e)]);
            return self::result(false, 'internal', 'AI 도우미 안에서 문제가 생겼어요');
        }
    }

    // ================================================================== 옹이 선생님 (the visitors' helper)
    /** the fixed system prompt of the kid helper (Korean; CONTRACT §15.6 + the content rule of this project) */
    public const KID_SYSTEM = "너는 '전통발효체험관'에 사는 옹기 항아리 요정 '옹이 선생님'이야. 다섯 살부터 열두 살 어린이가 묻는 말에 답해.\n"
        . "지킬 것:\n"
        . "1. 한국어로, 어린이가 알아듣는 쉬운 말로 두세 문장만 짧게 답해. 어려운 낱말을 쓰면 바로 뒤에 쉬운 말로 풀어 줘.\n"
        . "2. 체험관에서 다루는 것만 이야기해: 농사와 텃밭, 발효(김치, 된장, 간장, 고추장, 식초, 메주 같은 것), 장독대와 옹기, 한옥, 한복, 봄 여름 가을 겨울과 날씨.\n"
        . "3. 발효 음식은 맛, 냄새, 색, 만드는 방법, 기다리는 시간으로만 설명해. 몸에 좋다, 병이 낫는다, 건강해진다, 살이 빠진다 같은 말이나 약, 병, 병원 이야기는 절대 하지 마.\n"
        . "4. 이름, 나이, 학교, 사는 곳, 전화번호 같은 개인정보는 묻지도 말고 되풀이하지도 마. 질문에 그런 내용이 있어도 그 부분은 말하지 마.\n"
        . "5. 링크, 인터넷 주소, 다른 앱이나 가게 이름, 가격은 말하지 마.\n"
        . "6. 칼, 불, 뜨거운 물, 술처럼 위험한 것을 어린이 혼자 해 보라고 하지 마. 그런 일은 꼭 어른과 함께 한다고 말해. 무서운 이야기는 하지 마.\n"
        . "7. 체험관과 상관없는 질문이나 잘 모르는 것에는 \"잘 모르겠어요, 선생님께 여쭤봐요.\"라고만 답해.\n"
        . "8. 목록, 표, 굵은 글씨, 이모지 없이 다정하고 차분하게 말하듯이 써.";

    /** the preset questions: id → the text sent (resolved here, so a child's typing never leaves the app in easy mode) */
    private static function presetTable(): array
    {
        return [
            ['id' => 'kimchi', 'icon' => '🥬', 'label' => '김치는 어떻게 만들어요?', 'topic' => 'ferment', 'q' => '김치는 어떻게 만들어요?',
                'mock' => '배추를 소금에 절여 숨을 죽인 다음, 고춧가루와 마늘 같은 양념을 골고루 발라요. 항아리에 담아 두면 며칠 동안 천천히 익으면서 새콤한 맛이 나요.'],
            ['id' => 'doenjang', 'icon' => '🫘', 'label' => '된장은 왜 오래 기다려요?', 'topic' => 'ferment', 'q' => '된장은 왜 오래 기다려야 해요?',
                'mock' => '메주라는 콩 덩어리를 소금물에 담가 두면, 아주 작은 생물인 미생물이 천천히 콩을 바꿔요. 몇 달을 기다려야 구수한 냄새와 깊은 맛이 생겨요.'],
            ['id' => 'meju', 'icon' => '🧱', 'label' => '메주는 뭐예요?', 'topic' => 'ferment', 'q' => '메주는 뭐예요?',
                'mock' => '메주는 삶은 콩을 찧어서 네모나게 뭉친 덩어리예요. 따뜻한 곳에 매달아 말리면 하얀 곰팡이가 피고, 그걸로 된장과 간장을 만들어요.'],
            ['id' => 'gochujang', 'icon' => '🌶️', 'label' => '고추장은 무슨 맛이에요?', 'topic' => 'ferment', 'q' => '고추장은 무슨 맛이에요?',
                'mock' => '고추장은 매콤하면서도 살짝 달콤하고 구수한 맛이 나요. 고춧가루와 찹쌀, 메줏가루를 섞어 항아리에서 오래 익혀서 만들어요.'],
            ['id' => 'jangdok', 'icon' => '🏺', 'label' => '장독대는 왜 햇볕에 있어요?', 'topic' => 'onggi', 'q' => '장독대 항아리는 왜 햇볕 드는 곳에 두어요?',
                'mock' => '햇볕과 바람이 잘 드는 곳이라야 항아리 속 장이 알맞게 따뜻하고 뽀송하게 익어요. 옹기에는 아주 작은 숨구멍이 있어서 장이 숨을 쉴 수 있어요.'],
            ['id' => 'hanok', 'icon' => '🏠', 'label' => '한옥 지붕은 왜 휘었어요?', 'topic' => 'hanok', 'q' => '한옥 지붕 끝은 왜 위로 휘어 있어요?',
                'mock' => '지붕 끝이 살짝 올라가 있으면 빗물이 멀리 떨어지고, 겨울 햇볕은 방 안까지 들어와요. 그래서 보기에도 예쁘고 집도 오래가요.'],
            ['id' => 'hanbok', 'icon' => '👘', 'label' => '저고리는 뭐예요?', 'topic' => 'hanbok', 'q' => '한복 저고리는 뭐예요?',
                'mock' => '저고리는 한복의 윗옷이에요. 앞에서 고름이라는 긴 끈을 매어 여미고, 아래에는 치마나 바지를 입어요.'],
            ['id' => 'spring', 'icon' => '🌱', 'label' => '봄에는 무엇을 심어요?', 'topic' => 'season', 'q' => '봄에는 텃밭에 무엇을 심어요?',
                'mock' => '봄에는 땅이 따뜻해지면 상추, 감자, 고추 모종 같은 것을 심어요. 물을 주고 햇볕을 받으면 쑥쑥 자라요.'],
            ['id' => 'autumn', 'icon' => '🍂', 'label' => '가을에는 무엇을 거둬요?', 'topic' => 'season', 'q' => '가을에는 무엇을 거둬요?',
                'mock' => '가을에는 벼와 콩, 배추와 무를 거둬요. 거둔 배추와 무로는 겨울 동안 먹을 김치를 담가요.'],
            ['id' => 'winter', 'icon' => '❄️', 'label' => '겨울에 장은 어떻게 돼요?', 'topic' => 'season', 'q' => '추운 겨울에 장독 속 장은 어떻게 돼요?',
                'mock' => '추운 겨울에는 장 속 미생물이 천천히 쉬듯이 일해요. 그래서 장이 아주 느리게 익고, 봄이 오면 다시 바쁘게 맛을 만들어요.'],
        ];
    }

    /** what the page shows: id, icon, label, say — never the mock text */
    public static function presets(): array
    {
        $out = [];
        foreach (self::presetTable() as $p) $out[] = ['id' => $p['id'], 'icon' => $p['icon'], 'label' => $p['label'], 'say' => $p['label'], 'topic' => $p['topic']];
        return $out;
    }

    public static function presetIds(): array { return array_map(function ($p) { return $p['id']; }, self::presetTable()); }

    /** the calm line a child sees when there is no answer to show */
    public static function calmLine(string $why): string
    {
        switch ($why) {
            case 'off': return '지금은 옹이 선생님이 쉬고 있어요. 다음에 또 물어봐 줘요.';
            case 'capped_user': return '오늘 물어볼 수 있는 만큼 다 물어봤어요. 내일 또 만나요!';
            case 'capped': return '오늘은 옹이 선생님이 너무 바빴어요. 내일 다시 물어봐 줘요.';
            case 'words': return '고운 말로 다시 물어봐 줄래요?';
            case 'refusal': return '그건 옹이 선생님이 도와줄 수 없어요. 다른 걸 물어봐 줄래요?';
            case 'empty': case 'unsure': return '잘 모르겠어요, 선생님께 여쭤봐요.';
            default: return '지금은 옹이 선생님과 이야기가 잘 안 돼요. 조금 뒤에 다시 해 봐요.';
        }
    }

    /** an answer made safe for a child's screen: personal data and bad words masked, links and markup gone, ≤ answer_max */
    public static function cleanAnswer(string $t): string
    {
        $t = (string) preg_replace('/[\x{0}-\x{8}\x{B}-\x{1F}\x{7F}-\x{9F}\x{200B}-\x{200F}\x{202A}-\x{202E}\x{2066}-\x{2069}]/u', '', str_replace(["\r\n", "\r", "\n", "\t"], ' ', $t));
        $t = (string) preg_replace('~\b(?:https?://|www\.)\S+~iu', '', $t);
        $t = (string) preg_replace('~\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|net|org|kr|co|io|ai|app|me|info)\b\S*~iu', '', $t);
        $t = (string) preg_replace('/[*#`_>|\[\]]+/u', '', $t);
        $t = trim((string) preg_replace('/\s{2,}/u', ' ', $t));
        if (class_exists('Tfm\ChatFilter')) { $t = ChatFilter::maskPII($t); $t = ChatFilter::mask($t); }
        $max = self::answerMax();
        if (mb_strlen($t) > $max) {
            $cut = mb_substr($t, 0, $max);
            $p = max((int) mb_strrpos($cut, '. '), (int) mb_strrpos($cut, '요.'), (int) mb_strrpos($cut, '! '), (int) mb_strrpos($cut, '? '));
            $t = $p > (int) ($max * 0.5) ? mb_substr($cut, 0, $p + (mb_substr($cut, $p, 2) === '요.' ? 2 : 1)) : rtrim(mb_substr($cut, 0, $max - 1)) . '…';
        }
        return trim($t);
    }

    /**
     * One question of a child → ['ok', 'answer', 'why', 'left', 'presetId']. The question is either a preset id (the text
     * is resolved here) or typed text ≤ question_max (normal mode). Typed text: bad words → not sent ('words');
     * personal data masked before it leaves. The answer is cleaned (cleanAnswer). Never throws.
     */
    public static function kidAsk(int $userId, array $in): array
    {
        $pid = isset($in['presetId']) && is_string($in['presetId']) ? $in['presetId'] : '';
        $out = ['ok' => false, 'answer' => '', 'why' => '', 'left' => 0, 'presetId' => $pid !== '' ? $pid : null];
        try {
            if (!self::kidEnabled()) { $out['why'] = 'off'; $out['answer'] = self::calmLine('off'); return $out; }
            $q = '';
            if ($pid !== '') {
                foreach (self::presetTable() as $p) if ($p['id'] === $pid) $q = $p['q'];
                if ($q === '') { $out['why'] = 'unknown_preset'; $out['answer'] = self::calmLine('unsure'); $out['left'] = self::left($userId); return $out; }
            } else {
                $raw = isset($in['question']) && is_string($in['question']) ? $in['question'] : '';
                $q = trim((string) preg_replace('/\s+/u', ' ', (string) preg_replace('/[\x{0}-\x{1F}\x{7F}-\x{9F}\x{200B}-\x{200F}\x{202A}-\x{202E}\x{2066}-\x{2069}]/u', ' ', $raw)));
                if ($q === '' || mb_strlen($q) > self::questionMax()) { $out['why'] = 'length'; $out['answer'] = self::calmLine('unsure'); $out['left'] = self::left($userId); return $out; }
                if (class_exists('Tfm\ChatFilter') && ChatFilter::containsBadWord($q)) { $out['why'] = 'words'; $out['answer'] = self::calmLine('words'); $out['left'] = self::left($userId); return $out; }
                if (class_exists('Tfm\ChatFilter')) $q = ChatFilter::maskPII($q);
            }
            $res = self::ask(['system' => self::KID_SYSTEM, 'messages' => [['role' => 'user', 'content' => $q]], 'scope' => 'kid', 'userId' => $userId,
                'maxTokens' => min(self::maxTokens(), 2048)]);
            $out['left'] = self::left($userId);
            if (!empty($res['ok'])) {
                $a = self::cleanAnswer((string) $res['text']);
                if ($a !== '') { $out['ok'] = true; $out['answer'] = $a; $out['why'] = $res['stop'] === 'max_tokens' ? 'partial' : 'ok'; return $out; }
                $res['code'] = 'empty';
            }
            $why = (string) $res['code'];
            $out['why'] = $why;
            $out['answer'] = self::calmLine(in_array($why, ['off', 'capped', 'capped_user', 'refusal', 'empty'], true) ? $why : 'error');
            return $out;
        } catch (\Throwable $e) {
            Log::error('AI', 'kidAsk crashed', ['class' => get_class($e)]);
            $out['why'] = 'internal'; $out['answer'] = self::calmLine('error');
            return $out;
        }
    }

    // ================================================================== the admin 🤖 tab
    private const ADMIN_BASE = "너는 어린이 전통발효 체험관(웹 3D 체험관과 PHP 서버)을 운영하는 선생님과 관리자를 돕는 비서야. 한국어로 간결하고 정확하게 써. 모르는 것은 모른다고 하고, 받은 정보에 없는 숫자나 사실을 지어내지 마. 개인정보를 묻거나 쓰지 마. 발효 음식의 건강이나 의학 효과를 주장하지 마.";

    /** 🤖 메모 초안 for a completion request: only crop, stars, amount, the (masked) note and the status are sent */
    public static function memoDraft(array $report, int $actorId): array
    {
        $keep = [];
        foreach (['cropName', 'cropId', 'kind', 'stars', 'amount', 'note', 'status'] as $k) if (isset($report[$k])) $keep[$k] = is_string($report[$k]) && class_exists('Tfm\ChatFilter') ? ChatFilter::maskPII(mb_substr($report[$k], 0, 400)) : $report[$k];
        $sys = self::ADMIN_BASE . "\n지금 할 일: 아이가 보낸 '재배 완료 확인' 요청에 선생님이 남길 메모 초안을 써. 두 문장, 따뜻하고 구체적으로(작물 이름과 별 개수를 살려서). 아이 이름은 쓰지 말고, 메모 글만 써.";
        return self::ask(['system' => $sys, 'messages' => [['role' => 'user', 'content' => "요청 내용(JSON):\n" . Json::encode($keep, JSON_UNESCAPED_UNICODE)]], 'scope' => 'admin', 'userId' => $actorId, 'kind' => 'memo', 'maxTokens' => 2048]);
    }

    /** 📝 오늘 요약: today's numbers only */
    public static function daySummary(array $numbers, int $actorId): array
    {
        $sys = self::ADMIN_BASE . "\n지금 할 일: 오늘의 운영 숫자(JSON)를 보고 다섯 줄 이내로 요약해. 눈에 띄는 것과 오늘 확인할 일을 짧은 줄로 써.";
        return self::ask(['system' => $sys, 'messages' => [['role' => 'user', 'content' => "오늘의 숫자(JSON):\n" . Json::encode($numbers, JSON_UNESCAPED_UNICODE)]], 'scope' => 'admin', 'userId' => $actorId, 'kind' => 'summary']);
    }

    /** 💬 자유 질문 of an administrator (cleaned by the admin page before) */
    public static function adminAsk(string $prompt, int $actorId): array
    {
        $p = class_exists('Tfm\ChatFilter') ? ChatFilter::maskPII($prompt) : $prompt;
        return self::ask(['system' => self::ADMIN_BASE, 'messages' => [['role' => 'user', 'content' => $p]], 'scope' => 'admin', 'userId' => $actorId, 'kind' => 'ask']);
    }

    /** one tiny request: which model served, the tokens, the latency, the request as sent (key → ***) */
    public static function selfTest(?int $actorId = null): array
    {
        $opt = ['system' => '연결 확인이에요. "OK" 한 낱말만 답해.', 'messages' => [['role' => 'user', 'content' => 'OK 라고만 답해 줘.']], 'scope' => 'cli', 'userId' => $actorId, 'maxTokens' => 512];
        $r = self::ask($opt);
        return ['ok' => !empty($r['ok']), 'model' => (string) $r['model'], 'ms' => (int) $r['ms'], 'usage' => $r['usage'], 'stop' => (string) $r['stop'], 'error' => $r['error'],
            'code' => $r['code'], 'text' => mb_substr((string) $r['text'], 0, 80), 'mock' => self::isMock(), 'fallback' => !empty($r['fallback']),
            'request' => self::configured() ? self::describeRequest($opt) : null];
    }
}
