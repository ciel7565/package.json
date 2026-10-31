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
 * Mock mode (config toss.mock, TFM_TOSS_MOCK=1): confirm accepts paymentKeys that start with "mock_", issue hands out
 * "mock_bk_…" billing keys, and a charge always succeeds unless the orderId ends with "_fail" (tests).
 * The secret key is never logged. PHP 7.2 syntax only.
 */
declare(strict_types=1);

namespace Tfm;

if (!defined('TFM_BOOT')) { http_response_code(404); exit; }

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
    /** the public documentation test keys (never real money) */
    public const DOC_CLIENT_KEY = 'test_ck_D5GePWvyJnrK0W0k6q8gLzN97Eoq';
    public const DOC_SECRET_KEY = 'test_sk_zXLkKEypNArWmo50nX3lmeaxYG5R';

    public static function cfg(): array { return (array) Config::get('toss', []); }
    public static function mock(): bool { $c = self::cfg(); return !empty($c['mock']); }
    public static function clientKey(): string { $c = self::cfg(); return (string) (isset($c['client_key']) && $c['client_key'] !== '' ? $c['client_key'] : self::DOC_CLIENT_KEY); }
    private static function secretKey(): string { $c = self::cfg(); return (string) (isset($c['secret_key']) && $c['secret_key'] !== '' ? $c['secret_key'] : self::DOC_SECRET_KEY); }
    private static function apiBase(): string { $c = self::cfg(); return rtrim((string) (isset($c['api_base']) && $c['api_base'] !== '' ? $c['api_base'] : 'https://api.tosspayments.com'), '/'); }
    public static function periodDays(): int { $c = self::cfg(); return max(1, (int) (isset($c['period_days']) ? $c['period_days'] : 30)); }
    public static function graceDays(): int { $c = self::cfg(); return max(0, (int) (isset($c['grace_days']) ? $c['grace_days'] : 3)); }

    /** are real (live or merchant test) keys configured, or still the public documentation keys? (admin health) */
    public static function liveKeys(): bool
    {
        $s = self::secretKey();
        return $s !== self::DOC_SECRET_KEY && self::clientKey() !== self::DOC_CLIENT_KEY && Str::startsWith($s, 'live_sk_');
    }
    public static function keysConfigured(): bool { return self::secretKey() !== self::DOC_SECRET_KEY && self::clientKey() !== self::DOC_CLIENT_KEY; }

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
        if (self::mock()) {
            if (!Str::startsWith($paymentKey, 'mock_')) throw new TossException('NOT_FOUND_PAYMENT', '모의 결제 키가 아니에요.', 404);
            return self::mockPayment($paymentKey, $orderId, $amount, 'DONE');
        }
        return self::call('POST', '/v1/payments/confirm', ['paymentKey' => $paymentKey, 'orderId' => $orderId, 'amount' => $amount], $orderId . ':confirm');
    }

    public static function payment(string $paymentKey): array
    {
        if (self::mock()) return ['paymentKey' => $paymentKey, 'status' => 'DONE', 'mock' => true];
        if (!preg_match('/^[A-Za-z0-9_\-]{1,200}$/', $paymentKey)) throw new TossException('INVALID_PAYMENT_KEY', '결제 키 형식이 올바르지 않아요.', 400);
        return self::call('GET', '/v1/payments/' . rawurlencode($paymentKey), null);
    }

    public static function issueBillingKey(string $authKey, string $customerKey): array
    {
        if (self::mock()) {
            $key = 'mock_bk_' . substr(hash('sha256', $authKey . '|' . $customerKey), 0, 24) . (Str::endsWith($authKey, '_fail') ? '_fail' : '');
            return ['billingKey' => $key, 'customerKey' => $customerKey, 'card' => ['company' => '모의카드', 'number' => '****-****-****-0000'], 'mock' => true];
        }
        return self::call('POST', '/v1/billing/authorizations/issue', ['authKey' => $authKey, 'customerKey' => $customerKey]);
    }

    public static function charge(string $billingKey, string $customerKey, int $amount, string $orderId, string $orderName, ?string $customerEmail = null, ?string $customerName = null): array
    {
        if (self::mock()) {
            if (Str::endsWith($orderId, '_fail')) throw new TossException('REJECT_CARD_PAYMENT', '모의 결제가 거절되었어요 (테스트).', 400);
            return self::mockPayment('mock_pay_' . substr(hash('sha256', $orderId), 0, 20), $orderId, $amount, 'DONE');
        }
        if (!preg_match('/^[A-Za-z0-9_\-=.+\/]{1,200}$/', $billingKey)) throw new TossException('INVALID_BILLING_KEY', '빌링키 형식이 올바르지 않아요.', 400);
        $body = ['customerKey' => $customerKey, 'amount' => $amount, 'orderId' => $orderId, 'orderName' => $orderName];
        if ($customerEmail !== null && $customerEmail !== '') $body['customerEmail'] = $customerEmail;
        if ($customerName !== null && $customerName !== '') $body['customerName'] = mb_substr($customerName, 0, 100);
        return self::call('POST', '/v1/billing/' . rawurlencode($billingKey), $body, $orderId . ':charge');
    }

    public static function cancel(string $paymentKey, string $reason): array
    {
        if (self::mock()) return ['paymentKey' => $paymentKey, 'status' => 'CANCELED', 'mock' => true];
        if (!preg_match('/^[A-Za-z0-9_\-]{1,200}$/', $paymentKey)) throw new TossException('INVALID_PAYMENT_KEY', '결제 키 형식이 올바르지 않아요.', 400);
        return self::call('POST', '/v1/payments/' . rawurlencode($paymentKey) . '/cancel', ['cancelReason' => mb_substr($reason, 0, 200)], $paymentKey . ':cancel');
    }

    private static function mockPayment(string $paymentKey, string $orderId, int $amount, string $status): array
    {
        return [
            'paymentKey' => $paymentKey, 'orderId' => $orderId, 'status' => $status, 'method' => '카드', 'totalAmount' => $amount,
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
        curl_close($ch);
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
