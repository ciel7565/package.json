<?php
/**
 * POST api/sub/confirm.php {paymentKey, orderId, amount} → {sub}
 * The order must be `created`, belong to the logged-in user and the amount must match exactly; then 토스 confirm
 * (mock: paymentKey "mock_…") → order confirmed, subscription active (expires = max(now, expires) + period).
 * Replays (confirmed orders) and foreign orders are refused and audit-logged.
 */
declare(strict_types=1);

require __DIR__ . '/../../lib/bootstrap.php';

use Tfm\Api;
use Tfm\ApiException;
use Tfm\Ctx;
use Tfm\SecEvent;
use Tfm\Subscription;
use Tfm\V;

// §15.7 #3 / #15 (S15): the amount is a JSON integer — a digit string, float (2900.0), exponent (29e2), array or
// boolean is refused (and logged as payment_tamper); 1 … 10,000,000 KRW; it must equal the order's server amount.
Api::run(['method' => 'POST', 'auth' => true, 'rate' => 'sub_write'], function (Ctx $c): array {
    $b = $c->json(4096);
    V::keys($b, ['paymentKey', 'orderId', 'amount']);
    $paymentKey = V::str(isset($b['paymentKey']) ? $b['paymentKey'] : null, 'paymentKey', 200, 1);
    $orderId = V::str(isset($b['orderId']) ? $b['orderId'] : null, 'orderId', 64, 8);
    $amount = isset($b['amount']) ? $b['amount'] : null;
    if (!is_int($amount) || $amount < 1 || $amount > Subscription::MAX_AMOUNT) {
        if (class_exists('Tfm\\SecEvent')) SecEvent::log('payment_tamper', 'warn', ['why' => 'amount_type', 'type' => gettype($amount)], $c->uid());
        throw new ApiException(400, 'INVALID_AMOUNT', '결제 금액이 올바르지 않아요.', ['field' => 'amount']);
    }
    return ['sub' => Subscription::confirm($c->user, $paymentKey, $orderId, $amount)];
});
