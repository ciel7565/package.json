<?php
/**
 * POST api/sub/billing-issue.php {authKey, customerKey, orderId} → {sub}
 * Issues the billing key (토스 /v1/billing/authorizations/issue), charges the first period and turns auto-renew on.
 */
declare(strict_types=1);

require __DIR__ . '/../../lib/bootstrap.php';

use Tfm\Api;
use Tfm\ApiException;
use Tfm\Ctx;
use Tfm\Subscription;

Api::run(['method' => 'POST', 'auth' => true, 'rate' => 'sub_write'], function (Ctx $c): array {
    $b = $c->json(4096);
    $authKey = isset($b['authKey']) && is_string($b['authKey']) ? $b['authKey'] : '';
    $customerKey = isset($b['customerKey']) && is_string($b['customerKey']) ? $b['customerKey'] : '';
    $orderId = isset($b['orderId']) && is_string($b['orderId']) ? $b['orderId'] : '';
    if ($authKey === '' || $customerKey === '' || $orderId === '') throw new ApiException(400, 'INVALID_PARAM', '결제 정보가 올바르지 않아요.');
    return ['sub' => Subscription::billingIssue($c->user, $authKey, $customerKey, $orderId)];
});
