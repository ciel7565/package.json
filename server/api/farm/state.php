<?php
/**
 * GET api/farm/state.php → {scale, tier, beds: [{bedId, kind:'rt'|'plot', pid, cropId, firstSeenAt, readyAt, growth, status}],
 *                           storage: {items: {ITEM_X: qty}, total, cap}, reports: {pending, unseen}}
 * The caller's authoritative farm view (CONTRACT §15.1): real-time beds with the server's own times (status 'ready' as
 * soon as the server clock passed readyAt), the quick-plot mirror, the 곳간 mirror and the completion requests.
 * Login only; no query parameters (an unknown one is refused). Rate limit farm_state.
 */
declare(strict_types=1);

require __DIR__ . '/../../lib/bootstrap.php';

use Tfm\Api;
use Tfm\Ctx;
use Tfm\Farm;
use Tfm\Session;
use Tfm\Subscription;
use Tfm\V;

Api::run(['method' => 'GET', 'auth' => true, 'rate' => 'farm_state'], function (Ctx $c): array {
    V::keys($_GET, [], 'query');
    $tier = (int) Subscription::state($c->uid())['tier'];
    Session::close(); // read-only: release the session lock
    return Farm::state($c->uid(), $tier);
});
