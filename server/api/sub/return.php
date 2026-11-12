<?php
/**
 * GET api/sub/return.php — where the 토스 결제창 sends the browser back (successUrl / failUrl of prepare.php):
 *   ?kind=card&paymentKey=…&orderId=…&amount=…        → confirm
 *   ?kind=billing&authKey=…&customerKey=…&orderId=…   → issue the billing key + first charge
 *   ?code=…&message=…  (or &fail=1)                   → failure
 * A top-level GET navigation carries the SameSite=Lax session cookie, so the logged-in player's order is confirmed
 * server-to-server and the browser is redirected to the app: index.html?sub=ok&tier=N or index.html?sub=fail&msg=….
 * The order must belong to the logged-in session (confirm/billingIssue refuse foreign or replayed orders).
 * Finding F11: what the payment window sends back in ?code= / ?message= is never passed on — the code is mapped to a
 * known word (or OTHER) and the app shows a fixed Korean sentence for it; logs get the mapped code only.
 */
declare(strict_types=1);

require __DIR__ . '/../../lib/bootstrap.php';

use Tfm\ApiException;
use Tfm\Auth;
use Tfm\Ctx;
use Tfm\Http;
use Tfm\Log;
use Tfm\RateLimit;
use Tfm\Session;
use Tfm\Subscription;

ob_start();
set_error_handler(static function (int $no, string $msg, string $file = '', int $line = 0): bool {
    if (!(error_reporting() & $no)) return false;
    throw new \ErrorException($msg, 0, $no, $file, $line);
});

$nonce = base64_encode(random_bytes(16));
$q = function (string $k): string { return isset($_GET[$k]) && is_string($_GET[$k]) ? mb_substr($_GET[$k], 0, 300) : ''; };
$base = Http::basePath();
$redirect = function (string $query) use ($base): void {
    while (ob_get_level() > 0) ob_end_clean();
    header('Location: ' . $base . 'index.html?' . $query, true, 303);
    Session::close();
    exit;
};
$fail = function (string $msg) use ($redirect): void { $redirect('sub=fail&msg=' . rawurlencode(mb_substr($msg, 0, 120))); };
/** 토스 결제창 failure codes → the code the app gets and the sentence it shows (anything else: OTHER) */
$failText = function (string $code): array {
    $known = [
        'PAY_PROCESS_CANCELED' => '결제를 취소했어요.',
        'USER_CANCEL' => '결제를 취소했어요.',
        'PAY_PROCESS_ABORTED' => '결제가 중간에 멈췄어요. 잠시 후 다시 해 주세요.',
        'REJECT_CARD_COMPANY' => '카드사가 결제를 거절했어요. 다른 카드로 해 주세요.',
        'REJECT_CARD_PAYMENT' => '카드사가 결제를 거절했어요. 다른 카드로 해 주세요.',
        'EXCEED_MAX_DAILY_PAYMENT_COUNT' => '오늘 결제할 수 있는 횟수를 넘었어요.',
        'INVALID_CARD_EXPIRATION' => '카드 유효기간을 확인해 주세요.',
    ];
    $c = strtoupper($code);
    if (!preg_match('/^[A-Z_]{1,60}$/', $c) || !isset($known[$c])) return ['OTHER', '결제가 취소되었거나 완료되지 않았어요.'];
    return [$c, $known[$c]];
};

try {
    Http::securityHeaders('admin', $nonce);
    // the security layer's page guard (blocked addresses, plain HTTP where HTTPS is required, uploads) when it is there
    if (method_exists('Tfm\\Firewall', 'guardPage') && method_exists('Tfm\\Http', 'plainPage') && method_exists('Tfm\\Http', 'enforceHttps') && method_exists('Tfm\\Http', 'refuseUpload')) \Tfm\Firewall::guardPage();
    elseif (class_exists('Tfm\\Firewall')) \Tfm\Firewall::check();
    if (Http::method() !== 'GET') { http_response_code(405); header('Allow: GET'); exit; }
    Session::start(false);
    $ctx = new Ctx();
    $ctx->user = Auth::current();
    RateLimit::forRequest('sub_return', $ctx, 'ip');
    if ($q('code') !== '' || $q('fail') === '1') {
        list($code, $text) = $failText($q('code'));
        Log::info('SUB', 'payment window returned a failure', ['code' => $code, 'uid' => $ctx->uid()]);
        $redirect('sub=fail&code=' . rawurlencode($code) . '&msg=' . rawurlencode($text));
    }
    if (!$ctx->user) $fail('로그인이 풀렸어요. 다시 로그인한 뒤 구독 화면에서 상태를 확인해 주세요.');
    $kind = $q('kind');
    if ($kind === 'billing') {
        $sub = Subscription::billingIssue($ctx->user, $q('authKey'), $q('customerKey'), $q('orderId'));
    } else {
        $amount = $q('amount');
        if (!preg_match('/^\d{1,9}$/', $amount)) $fail('결제 금액을 확인할 수 없어요.');
        $sub = Subscription::confirm($ctx->user, $q('paymentKey'), $q('orderId'), (int) $amount);
    }
    $redirect('sub=ok&tier=' . (int) $sub['tier']);
} catch (ApiException $e) {
    $fail($e->getMessage());
} catch (\Throwable $e) {
    Log::error('SUB', 'return.php failed: ' . get_class($e) . ': ' . $e->getMessage(), ['at' => basename($e->getFile()) . ':' . $e->getLine()]);
    $fail('결제 처리 중 문제가 생겼어요. 잠시 후 구독 화면에서 상태를 확인해 주세요.');
}
