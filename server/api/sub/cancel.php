<?php
/** POST api/sub/cancel.php → {sub}  — auto-renew off; access stays until expires_at. */
declare(strict_types=1);

require __DIR__ . '/../../lib/bootstrap.php';

use Tfm\Api;
use Tfm\Ctx;
use Tfm\Subscription;

Api::run(['method' => 'POST', 'auth' => true, 'rate' => 'sub_write'], function (Ctx $c): array {
    $c->json(1024); // a JSON body is required (same-origin JSON POST like every other write)
    return ['sub' => Subscription::cancelAutoRenew($c->user)];
});
