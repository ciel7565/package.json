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
use Tfm\Subscription;

Api::run(['method' => 'POST', 'auth' => true, 'rate' => 'sub_write'], function (Ctx $c): array {
    $b = $c->json(4096);
    $paymentKey = isset($b['paymentKey']) && is_string($b['paymentKey']) ? $b['paymentKey'] : '';
    $orderId = isset($b['orderId']) && is_string($b['orderId']) ? $b['orderId'] : '';
    $amountRaw = isset($b['amount']) ? $b['amount'] : null;
    if (!(is_int($amountRaw) || (is_string($amountRaw) && $amountRaw !== '' && ctype_digit($amountRaw)))) throw new ApiException(400, 'INVALID_AMOUNT', '결제 금액이 올바르지 않아요.');
    if ($paymentKey === '' || $orderId === '') throw new ApiException(400, 'INVALID_PARAM', '결제 정보가 올바르지 않아요.');
    return ['sub' => Subscription::confirm($c->user, $paymentKey, $orderId, (int) $amountRaw)];
});
