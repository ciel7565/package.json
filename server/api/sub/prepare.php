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
use Tfm\V;

// §15.7 #3 / #15: only {tier, kind}; tier a JSON integer (2–4 → INVALID_TIER otherwise), kind 'card' | 'billing'.
// The amount always comes from the server's tier table: an amount / price / customerKey sent along is an unknown key.
Api::run(['method' => 'POST', 'auth' => true, 'rate' => 'sub_write'], function (Ctx $c): array {
    $b = $c->json(2048);
    V::keys($b, ['tier', 'kind']);
    $tier = Subscription::jsonInt(isset($b['tier']) ? $b['tier'] : null, 'tier', PHP_INT_MIN, PHP_INT_MAX);
    $kind = V::has($b, 'kind') ? V::enum($b['kind'], 'kind', ['card', 'billing']) : 'card';
    return Subscription::prepare($c->user, $tier, $kind);
});
