<?php
/**
 * GET api/sub/status.php → {sub:{tier,status,expiresAt,autoRenew}, tiers:[{tier,name,price}], mode, clientKey, periodDays, graceDays}
 *   mode  'live' (the operator's 토스 keys) | 'mock' (test payments; never for a public host in production) |
 *         'unconfigured' (no keys: buying answers 503 PAYMENT_NOT_CONFIGURED)
 *   clientKey  the public client key in live mode, '' otherwise (the secret key never leaves the server)
 * Readable by any session (a guest gets sub none); prices are never shown on kid screens by the client (CONTRACT §14.6).
 * A public read-only GET: other origins in security.cors_allowed_origins may read it (no credentials).
 */
declare(strict_types=1);

require __DIR__ . '/../../lib/bootstrap.php';

use Tfm\Api;
use Tfm\Ctx;
use Tfm\Session;
use Tfm\Subscription;
use Tfm\Toss;

Api::run(['method' => 'GET', 'rate' => 'sub_status', 'public' => true], function (Ctx $c): array {
    $sub = $c->user ? Subscription::state($c->uid()) : Subscription::none();
    Session::close();
    return [
        'sub' => $sub,
        'tiers' => Subscription::publicTiers(),
        'mode' => Toss::mode(),
        'clientKey' => Toss::clientKey(),
        'periodDays' => Toss::periodDays(),
        'graceDays' => Toss::graceDays(),
    ];
});
