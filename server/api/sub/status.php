<?php
/**
 * GET api/sub/status.php → {sub:{tier,status,expiresAt,autoRenew}, tiers:[{tier,name,price}], mode:'live'|'mock', clientKey, periodDays}
 * Readable by any session (a guest gets sub none); prices are never shown on kid screens by the client (CONTRACT §14.6).
 */
declare(strict_types=1);

require __DIR__ . '/../../lib/bootstrap.php';

use Tfm\Api;
use Tfm\Ctx;
use Tfm\Session;
use Tfm\Subscription;
use Tfm\Toss;

Api::run(['method' => 'GET', 'rate' => 'sub_status'], function (Ctx $c): array {
    $sub = $c->user ? Subscription::state($c->uid()) : Subscription::none();
    Session::close();
    return [
        'sub' => $sub,
        'tiers' => Subscription::publicTiers(),
        'mode' => Toss::mock() ? 'mock' : 'live',
        'clientKey' => Toss::clientKey(),
        'periodDays' => Toss::periodDays(),
        'graceDays' => Toss::graceDays(),
    ];
});
