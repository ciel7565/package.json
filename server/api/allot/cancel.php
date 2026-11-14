<?php
/**
 * POST api/allot/cancel.php  {contractNo}  → {contractNo, status, requested}
 * The caller cancels an allotment of their own.
 *   · an application that is not approved yet ('pending') is canceled at once: status 'canceled', requested false, the
 *     unit is free again (and offered to the waiting list); an online payment already made for it is refunded.
 *   · a running contract ('active' / 'overdue') is NOT ended by this call: the request is recorded for the operator
 *     (status unchanged, requested true) — ending a real jar, and any refund, is the operator's decision.
 * Sending it twice is harmless. contractNo: the number from apply / mine (e.g. "A26-7K2QF-M9XWD").
 * Login + CSRF. 400 INVALID_INPUT · 403 ALLOT_DISABLED · 404 NOT_FOUND (unknown, malformed or another account's
 * number — never told apart) · 409 NOT_LIVE (already ended / canceled). Rate limit allot_write.
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
    return Allot::cancelByUser($c->user, $no);
});
