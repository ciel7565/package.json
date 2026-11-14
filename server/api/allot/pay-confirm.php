<?php
/**
 * POST api/allot/pay-confirm.php  {paymentKey, orderId, amount}  → {contractNo, status, paidUntil}
 * Finishes a payment started with api/allot/pay-prepare.php, after the 토스 window came back. The order must be the
 * caller's own, still open, and `amount` must equal the server's amount for it exactly; only then 토스 is asked to
 * confirm, and only an answer for this order, in KRW, with exactly this amount counts. One payment key pays one order
 * once: replays, foreign orders and changed amounts are refused and recorded as a security event (payment_tamper).
 * A paid period moves paidUntil forward; a pending application may become 'active' at once when the operator chose
 * "approve on payment".
 * paymentKey: string ≤ 200; orderId: string 8–64; amount: a JSON integer 1 … 10,000,000 (a digit string, float,
 * exponent, array or boolean → 400 INVALID_AMOUNT).
 * Login + CSRF. 400 INVALID_INPUT · 400 INVALID_AMOUNT · 400 INVALID_PAYMENT_KEY · 400 AMOUNT_MISMATCH ·
 * 402 PAYMENT_FAILED · 403 ALLOT_DISABLED · 403 PAY_DISABLED · 404 ORDER_NOT_FOUND · 409 ORDER_NOT_OPEN ·
 * 409 CONTRACT_CLOSED (paid, but the contract had ended meanwhile: the payment is refunded) · 503 PAYMENT_PENDING (ask
 * again in a moment). Rate limit allot_write.
 */
declare(strict_types=1);

require __DIR__ . '/../../lib/bootstrap.php';

use Tfm\Allot;
use Tfm\Api;
use Tfm\ApiException;
use Tfm\Ctx;
use Tfm\SecEvent;
use Tfm\Session;
use Tfm\V;

Api::run(['method' => 'POST', 'auth' => true, 'rate' => 'allot_write'], function (Ctx $c): array {
    $b = $c->json(4096);
    V::keys($b, ['paymentKey', 'orderId', 'amount']);
    $paymentKey = V::str(isset($b['paymentKey']) ? $b['paymentKey'] : null, 'paymentKey', 200, 1);
    $orderId = V::str(isset($b['orderId']) ? $b['orderId'] : null, 'orderId', 64, 8);
    $amount = isset($b['amount']) ? $b['amount'] : null;
    if (!is_int($amount) || $amount < 1 || $amount > Allot::MAX_AMOUNT) {
        if (class_exists('Tfm\\SecEvent')) SecEvent::log('payment_tamper', 'warn', ['why' => 'amount_type', 'type' => gettype($amount), 'what' => 'allot'], $c->uid());
        throw new ApiException(400, 'INVALID_AMOUNT', '결제 금액이 올바르지 않아요.', ['field' => 'amount']);
    }
    Session::close();
    Allot::guard();
    return Allot::payConfirm($c->user, $paymentKey, $orderId, $amount);
});
