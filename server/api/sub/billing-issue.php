<?php
/**
 * POST api/sub/billing-issue.php {authKey, customerKey, orderId} → {sub}
 * Issues the billing key (토스 /v1/billing/authorizations/issue), charges the first period and turns auto-renew on.
 */
declare(strict_types=1);

require __DIR__ . '/../../lib/bootstrap.php';

use Tfm\Api;
use Tfm\Ctx;
use Tfm\Subscription;
use Tfm\V;

Api::run(['method' => 'POST', 'auth' => true, 'rate' => 'sub_write'], function (Ctx $c): array {
    $b = $c->json(4096);
    V::keys($b, ['authKey', 'customerKey', 'orderId']);
    $authKey = V::str(isset($b['authKey']) ? $b['authKey'] : null, 'authKey', 300, 1);
    $customerKey = V::str(isset($b['customerKey']) ? $b['customerKey'] : null, 'customerKey', 64, 1);
    $orderId = V::str(isset($b['orderId']) ? $b['orderId'] : null, 'orderId', 64, 8);
    return ['sub' => Subscription::billingIssue($c->user, $authKey, $customerKey, $orderId)];
});
