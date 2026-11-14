<?php
/**
 * POST api/allot/pay-prepare.php  {contractNo}
 *   → {orderId, amount, orderName, contractNo, customerKey, clientKey, successUrl, failUrl, mock}
 * Starts the optional 토스 one-time payment of ONE period of the caller's own contract (only while the operator has
 * switched it on: plans.toss / pay.toss true). The amount is always the contract's own price on the server — nothing the
 * browser sends can change it. The answer is what the 토스 payment window needs (clientKey is the public client key);
 * `mock` true = the server runs the built-in test gateway. After the window, confirm with api/allot/pay-confirm.php.
 * Login + CSRF. 400 INVALID_INPUT · 403 ALLOT_DISABLED · 403 PAY_DISABLED (online payment is off: the operator's
 * payment guide applies) · 404 NOT_FOUND (unknown, malformed or another account's number) · 409 NOTHING_DUE (nothing
 * to pay now, or a free unit) · 503 PAYMENT_NOT_CONFIGURED. Rate limit allot_write.
 */
declare(strict_types=1);

require __DIR__ . '/../../lib/bootstrap.php';

use Tfm\Allot;
use Tfm\Api;
use Tfm\Ctx;
use Tfm\Session;
use Tfm\V;

Api::run(['method' => 'POST', 'auth' => true, 'rate' => 'allot_write'], function (Ctx $c): array {
    $b = $c->json(4096);
    V::keys($b, ['contractNo']);
    $no = V::str(isset($b['contractNo']) ? $b['contractNo'] : null, 'contractNo', 24, 1);
    Session::close();
    Allot::guard();
    return Allot::payPrepare($c->user, $no);
});
