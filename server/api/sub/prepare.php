<?php
/**
 * POST api/sub/prepare.php {tier:2|3|4, kind:'card'|'billing'}
 * → {orderId, amount, orderName, tier, kind, customerKey, clientKey, successUrl, failUrl, mock}
 * Creates a `created` order the browser then pays through the 토스 SDK (requestPayment / requestBillingAuth).
 */
declare(strict_types=1);

require __DIR__ . '/../../lib/bootstrap.php';

use Tfm\Api;
use Tfm\Ctx;
use Tfm\Subscription;

Api::run(['method' => 'POST', 'auth' => true, 'rate' => 'sub_write'], function (Ctx $c): array {
    $b = $c->json(2048);
    $tier = isset($b['tier']) && (is_int($b['tier']) || (is_string($b['tier']) && ctype_digit($b['tier']))) ? (int) $b['tier'] : 0;
    $kind = isset($b['kind']) && is_string($b['kind']) ? $b['kind'] : 'card';
    return Subscription::prepare($c->user, $tier, $kind);
});
