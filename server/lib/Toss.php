<?php
/**
 * 토스페이먼츠 API client (CONTRACT §14.6) — by the documented contract, plus a mock mode for tests and demos.
 *
 *   auth      Authorization: Basic base64(secretKey + ':'), JSON bodies, cURL (CURLOPT_TIMEOUT 15, TLS verified)
 *   confirm   POST /v1/payments/confirm {paymentKey, orderId, amount} → payment object {status:'DONE', method, receipt:{url}, approvedAt, totalAmount}
 *   payment   GET  /v1/payments/{paymentKey}
 *   issue     POST /v1/billing/authorizations/issue {authKey, customerKey} → {billingKey, customerKey, card:{…}}
 *   charge    POST /v1/billing/{billingKey} {customerKey, amount, orderId, orderName, customerEmail?, customerName?} → payment object
 *   cancel    POST /v1/payments/{paymentKey}/cancel {cancelReason}
 *   errors    4xx {code, message} → TossException
 *
 * Keys (CONTRACT §15.7 #8): there is no default key in the repository. Without the operator's own client + secret key
 * (config.local.php or TFM_TOSS_CLIENT_KEY / TFM_TOSS_SECRET_KEY) payments are 'unconfigured': status says so and
 * prepare answers 503 PAYMENT_NOT_CONFIGURED. The public sample keys of the 토스 documentation are recognised by their
 * SHA-256 only and treated as "not configured".
 *
 * Mock mode (config toss.mock, TFM_TOSS_MOCK=1) is for tests and demos and works only on the server PC or outside
 * production: with app.env = production a request for a public host never gets mock payments. confirm accepts
 * paymentKeys that start with "mock_"; test prefixes after "mock_": amount<N>_ (the gateway answers totalAmount N),
 * noamount_ (no totalAmount), otherorder_ (another orderId), usd_ (currency USD), waiting_ (status not DONE),
 * slow<ms>_ (answers after a pause: races), timeout_ (a network error after the payment). issue hands out
 * "mock_bk_…" billing keys (an authKey "mock_amount<N>_…" gives a key whose charges answer N), and a charge always
 * succeeds unless the orderId ends with "_fail" (tests).
 * The secret key is never logged. PHP 7.2 syntax only.
 */
declare(strict_types=1);

namespace Tfm;

if (!defined('TFM_BOOT')) { if (function_exists('header_remove')) header_remove('X-Powered-By'); http_response_code(404); exit; }

final class TossException extends \RuntimeException
{
    /** @var string */
    public $tossCode;
    /** @var int */
    public $http;

    public function __construct(string $code, string $message, int $http = 0)
    {
        parent::__construct($message, $http);
        $this->tossCode = $code;
        $this->http = $http;
    }
}

final class Toss
{
    /**
     * SHA-256 of the two public sample keys printed in the 토스페이먼츠 documentation (client, secret). They used to be
     * the defaults; now they are only recognised (and refused) — the keys themselves are not in the repository.
     */
    private const DOC_KEY_SHA256 = ['ec1393ef0fce194e6bad234a8445cb7196048b6470bc36636eeba4148aa50030', '587dc23841794a4259bfbab17611c1a37a71e70a8ca2c82237539dc2e38d8bb3'];

    /** @var bool one log line per request about a refused mock mode */
    private static $mockWarned = false;

    public static function cfg(): array { return (array) Config::get('toss', []); }

    /** does $text contain one of the public documentation sample keys? */
    public static function isDocumentationKey(string $text): bool
    {
        if (!preg_match_all('/(?:test|live)_g?[cs]k_[A-Za-z0-9]{8,}/', $text, $m)) return false;
        foreach ($m[0] as $tok) if (in_array(hash('sha256', $tok), self::DOC_KEY_SHA256, true)) return true;
        return false;
    }

    /** a configured key, '' when it is empty or a documentation sample key */
    private static function key(string $name): string
    {
        $c = self::cfg();
        $v = isset($c[$name]) && is_string($c[$name]) ? trim($c[$name]) : '';
        return $v === '' || self::isDocumentationKey($v) ? '' : $v;
    }

    /** mock mode switched on in the configuration (whether this request may use it: mock()) */
    public static function mockConfigured(): bool { $c = self::cfg(); return !empty($c['mock']); }

    /**
     * Mock payments hand out tiers without money, so they are refused for a public host in production: allowed on the
     * command line, outside app.env = production, or for a request from this machine to a loopback host name.
     */
    public static function mockAllowed(): bool
    {
        if (PHP_SAPI === 'cli') return true;
        if (strtolower((string) Config::get('app.env', 'production')) !== 'production') return true;
        $remote = (string) (isset($_SERVER['REMOTE_ADDR']) ? $_SERVER['REMOTE_ADDR'] : '');
        $host = strtolower(trim((string) (isset($_SERVER['HTTP_HOST']) ? $_SERVER['HTTP_HOST'] : '')));
        $localHost = (bool) preg_match('/^(?:\[::1\]|(?:[a-z0-9-]+\.)*localhost|127(?:\.\d{1,3}){3})(?::\d{1,5})?$/', $host);
        return $localHost && Http::isLoopbackIp($remote);
    }

    public static function mock(): bool
    {
        if (!self::mockConfigured()) return false;
        if (self::mockAllowed()) return true;
        if (!self::$mockWarned) {
            self::$mockWarned = true;
            Log::warn('TOSS', 'mock payments are on (toss.mock) but refused for a public host in production');
        }
        return false;
    }

    /** the client key the browser may see ('' when payments are not configured or run in mock mode) */
    public static function clientKey(): string { return self::keysConfigured() ? self::key('client_key') : ''; }
    private static function secretKey(): string { return self::key('secret_key'); }
    private static function apiBase(): string { $c = self::cfg(); return rtrim((string) (isset($c['api_base']) && $c['api_base'] !== '' ? $c['api_base'] : 'https://api.tosspayments.com'), '/'); }
    public static function periodDays(): int { $c = self::cfg(); return max(1, (int) (isset($c['period_days']) ? $c['period_days'] : 30)); }
    public static function graceDays(): int { $c = self::cfg(); return max(0, (int) (isset($c['grace_days']) ? $c['grace_days'] : 3)); }

    /** the operator's own client + secret key of the same kind (both test_… or both live_…), never a documentation key */
    public static function keysConfigured(): bool
    {
        $ck = self::key('client_key');
        $sk = self::key('secret_key');
        if ($ck === '' || $sk === '') return false;
        if (!preg_match('/^(test|live)_g?ck_/', $ck, $a) || !preg_match('/^(test|live)_g?sk_/', $sk, $b)) return false;
        return $a[1] === $b[1];
    }

    /** real money: live keys configured (admin health) */
    public static function liveKeys(): bool { return self::keysConfigured() && (bool) preg_match('/^live_g?sk_/', self::secretKey()); }

    /** 'mock' (test payments, this request may use them) | 'live' (the operator's keys) | 'unconfigured' */
    public static function mode(): string { return self::mock() ? 'mock' : (self::keysConfigured() ? 'live' : 'unconfigured'); }

    public static function available(): bool { return self::mode() !== 'unconfigured'; }

    /** 503 PAYMENT_NOT_CONFIGURED unless payments can be taken (mock or the operator's keys) */
    public static function requireAvailable(): void
    {
        if (self::available()) return;
        throw new ApiException(503, 'PAYMENT_NOT_CONFIGURED', '결제가 아직 준비되지 않았어요. 운영자가 토스페이먼츠 키를 설정하면 구독할 수 있어요.');
    }

    /** [tier => ['price' => int KRW, 'name' => string]] for tiers 2..4, validated */
    public static function tiers(): array
    {
        $c = self::cfg();
        $raw = isset($c['tiers']) && is_array($c['tiers']) ? $c['tiers'] : [];
        $out = [];
        foreach ([2, 3, 4] as $t) {
            $row = isset($raw[$t]) && is_array($raw[$t]) ? $raw[$t] : [];
            $price = isset($row['price']) ? (int) $row['price'] : [2 => 2900, 3 => 4900, 4 => 6900][$t];
            $name = isset($row['name']) && is_string($row['name']) && $row['name'] !== '' ? $row['name'] : str_repeat('⚡', $t - 1) . ' ' . $t . '배';
            $out[$t] = ['price' => max(100, $price), 'name' => mb_substr($name, 0, 40)];
        }
        return $out;
    }

    public static function price(int $tier): int
    {
        $t = self::tiers();
        if (!isset($t[$tier])) throw new ApiException(400, 'INVALID_TIER', '선택할 수 없는 단계예요.');
        return $t[$tier]['price'];
    }

    public static function tierName(int $tier): string
    {
        $t = self::tiers();
        return isset($t[$tier]) ? $t[$tier]['name'] : '기본';
    }

    // ------------------------------------------------------------------ API calls
    public static function confirm(string $paymentKey, string $orderId, int $amount): array
    {
        if (self::mock()) return self::mockConfirm($paymentKey, $orderId, $amount, false);
        self::needKeys();
        return self::call('POST', '/v1/payments/confirm', ['paymentKey' => $paymentKey, 'orderId' => $orderId, 'amount' => $amount], $orderId . ':confirm');
    }

    /**
     * The payment as the gateway knows it now (a confirmation that ended in a network error is looked up instead of
     * being confirmed twice). Mock: the same answer confirm() would give, without the timeout.
     */
    public static function lookup(string $paymentKey, string $orderId, int $amount): array
    {
        if (self::mock()) return self::mockConfirm($paymentKey, $orderId, $amount, true);
        return self::payment($paymentKey);
    }

    public static function payment(string $paymentKey): array
    {
        if (self::mock()) return ['paymentKey' => $paymentKey, 'status' => 'DONE', 'mock' => true];
        self::needKeys();
        if (!preg_match('/^[A-Za-z0-9_\-]{1,200}$/', $paymentKey)) throw new TossException('INVALID_PAYMENT_KEY', '결제 키 형식이 올바르지 않아요.', 400);
        return self::call('GET', '/v1/payments/' . rawurlencode($paymentKey), null);
    }

    public static function issueBillingKey(string $authKey, string $customerKey): array
    {
        if (self::mock()) {
            $amt = preg_match('/^mock_amount(\d{1,9})_/', $authKey, $m) ? 'amount' . $m[1] . '_' : '';
            $key = 'mock_bk_' . $amt . substr(hash('sha256', $authKey . '|' . $customerKey), 0, 24) . (Str::endsWith($authKey, '_fail') ? '_fail' : '');
            return ['billingKey' => $key, 'customerKey' => $customerKey, 'card' => ['company' => '모의카드', 'number' => '****-****-****-0000'], 'mock' => true];
        }
        self::needKeys();
        return self::call('POST', '/v1/billing/authorizations/issue', ['authKey' => $authKey, 'customerKey' => $customerKey]);
    }

    public static function charge(string $billingKey, string $customerKey, int $amount, string $orderId, string $orderName, ?string $customerEmail = null, ?string $customerName = null): array
    {
        if (self::mock()) {
            if (!Str::startsWith($billingKey, 'mock_bk_')) throw new TossException('INVALID_BILLING_KEY', '모의 빌링키가 아니에요.', 400);
            if (Str::endsWith($orderId, '_fail')) throw new TossException('REJECT_CARD_PAYMENT', '모의 결제가 거절되었어요 (테스트).', 400);
            $p = self::mockPayment('mock_pay_' . substr(hash('sha256', $orderId), 0, 20), $orderId, $amount, 'DONE');
            if (preg_match('/^mock_bk_amount(\d{1,9})_/', $billingKey, $m)) $p['totalAmount'] = (int) $m[1];
            return $p;
        }
        self::needKeys();
        if (!preg_match('/^[A-Za-z0-9_\-=.+\/]{1,200}$/', $billingKey)) throw new TossException('INVALID_BILLING_KEY', '빌링키 형식이 올바르지 않아요.', 400);
        $body = ['customerKey' => $customerKey, 'amount' => $amount, 'orderId' => $orderId, 'orderName' => $orderName];
        if ($customerEmail !== null && $customerEmail !== '') $body['customerEmail'] = $customerEmail;
        if ($customerName !== null && $customerName !== '') $body['customerName'] = mb_substr($customerName, 0, 100);
        return self::call('POST', '/v1/billing/' . rawurlencode($billingKey), $body, $orderId . ':charge');
    }

    public static function cancel(string $paymentKey, string $reason): array
    {
        if (self::mock()) return ['paymentKey' => $paymentKey, 'status' => 'CANCELED', 'mock' => true];
        self::needKeys();
        if (!preg_match('/^[A-Za-z0-9_\-]{1,200}$/', $paymentKey)) throw new TossException('INVALID_PAYMENT_KEY', '결제 키 형식이 올바르지 않아요.', 400);
        return self::call('POST', '/v1/payments/' . rawurlencode($paymentKey) . '/cancel', ['cancelReason' => mb_substr($reason, 0, 200)], $paymentKey . ':cancel');
    }

    /** a real API call without the operator's keys is never made (no default key exists) */
    private static function needKeys(): void
    {
        if (!self::keysConfigured()) throw new TossException('NOT_CONFIGURED', '결제가 아직 준비되지 않았어요 (토스페이먼츠 키가 없어요).', 0);
    }

    /** mock confirm with the test prefixes of the class comment; $lookup = the later look-up (no timeout, no pause) */
    private static function mockConfirm(string $paymentKey, string $orderId, int $amount, bool $lookup): array
    {
        if (!Str::startsWith($paymentKey, 'mock_')) throw new TossException('NOT_FOUND_PAYMENT', '모의 결제 키가 아니에요.', 404);
        $flags = (string) substr($paymentKey, 5);
        if (!$lookup && preg_match('/^slow(\d{1,4})_/', $flags, $m)) usleep(min(5000, (int) $m[1]) * 1000);
        $flags = (string) preg_replace('/^slow\d{1,4}_/', '', $flags);
        if (!$lookup && Str::startsWith($flags, 'timeout_')) throw new TossException('NETWORK_ERROR', '결제 서버에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.', 0);
        $p = self::mockPayment($paymentKey, $orderId, $amount, 'DONE');
        if (preg_match('/^amount(\d{1,9})_/', $flags, $m)) $p['totalAmount'] = (int) $m[1];
        if (Str::startsWith($flags, 'noamount_')) unset($p['totalAmount']);
        if (Str::startsWith($flags, 'otherorder_')) $p['orderId'] = (substr($orderId, 0, 1) === 'X' ? 'Y' : 'X') . substr($orderId, 1);
        if (Str::startsWith($flags, 'usd_')) $p['currency'] = 'USD';
        if (Str::startsWith($flags, 'waiting_')) $p['status'] = 'WAITING_FOR_DEPOSIT';
        return $p;
    }

    private static function mockPayment(string $paymentKey, string $orderId, int $amount, string $status): array
    {
        return [
            'paymentKey' => $paymentKey, 'orderId' => $orderId, 'status' => $status, 'method' => '카드', 'totalAmount' => $amount, 'currency' => 'KRW',
            'approvedAt' => date('c'), 'receipt' => ['url' => 'about:blank#mock-receipt'], 'mock' => true,
        ];
    }

    /** one HTTPS call; throws TossException on transport errors, non-JSON answers and 4xx/5xx {code, message} */
    private static function call(string $method, string $path, ?array $body, string $idempotencyKey = ''): array
    {
        if (!function_exists('curl_init')) throw new TossException('CURL_MISSING', '서버에 curl 확장이 없어 결제 서버에 연결할 수 없어요.', 0);
        $ch = curl_init();
        if ($ch === false) throw new TossException('CURL_INIT', '결제 서버 연결을 시작하지 못했어요.', 0);
        $headers = [
            'Authorization: Basic ' . base64_encode(self::secretKey() . ':'),
            'Content-Type: application/json',
            'Accept: application/json',
        ];
        if ($idempotencyKey !== '') $headers[] = 'Idempotency-Key: ' . substr(hash('sha256', $idempotencyKey), 0, 48);
        $opts = [
            CURLOPT_URL => self::apiBase() . $path,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_HEADER => false,
            CURLOPT_FOLLOWLOCATION => false,
            CURLOPT_CONNECTTIMEOUT => 10,
            CURLOPT_TIMEOUT => 15,
            CURLOPT_SSL_VERIFYPEER => true,
            CURLOPT_SSL_VERIFYHOST => 2,
            CURLOPT_HTTPHEADER => $headers,
            CURLOPT_USERAGENT => 'tfm-metaverse/' . TFM_VERSION,
        ];
        if ($method === 'POST') {
            $opts[CURLOPT_POST] = true;
            $opts[CURLOPT_POSTFIELDS] = json_encode($body === null ? [] : $body, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        } else {
            $opts[CURLOPT_HTTPGET] = true;
        }
        curl_setopt_array($ch, $opts);
        $raw = curl_exec($ch);
        $errno = curl_errno($ch);
        $err = curl_error($ch);
        $http = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        // PHP 8 frees the CurlHandle object by itself; curl_close() is a no-op there and deprecated since 8.5 (a deprecation
        // notice would become an exception under the API error handler)
        if (PHP_VERSION_ID < 80000) curl_close($ch);
        if ($raw === false || $errno !== 0) {
            Log::error('TOSS', 'transport error', ['path' => $path, 'errno' => $errno, 'err' => mb_substr((string) $err, 0, 120)]);
            throw new TossException('NETWORK_ERROR', '결제 서버에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.', 0);
        }
        $j = Json::tryDecode((string) $raw, true);
        if (!is_array($j)) {
            Log::error('TOSS', 'non-JSON answer', ['path' => $path, 'http' => $http]);
            throw new TossException('BAD_RESPONSE', '결제 서버 응답을 읽지 못했어요.', $http);
        }
        if ($http >= 400 || isset($j['code'])) {
            $code = isset($j['code']) && is_string($j['code']) ? $j['code'] : 'HTTP_' . $http;
            $msg = isset($j['message']) && is_string($j['message']) ? $j['message'] : '결제가 처리되지 않았어요.';
            Log::warn('TOSS', 'api error', ['path' => $path, 'http' => $http, 'code' => $code]);
            throw new TossException(substr($code, 0, 60), mb_substr($msg, 0, 200), $http);
        }
        return $j;
    }
}
