<?php
/**
 * POST api/sub/renew.php {userId?, force?} — admin only (or cli/tfm.php sub:renew).
 * Charges the billing key of every active auto-renew subscription whose period ends within a day; on success the
 * period is extended, on failure the subscription becomes past_due (then none after grace_days). → {results:[…]}
 */
declare(strict_types=1);

require __DIR__ . '/../../lib/bootstrap.php';

use Tfm\Api;
use Tfm\Audit;
use Tfm\Ctx;
use Tfm\Subscription;
use Tfm\V;

Api::run(['method' => 'POST', 'admin' => true, 'rate' => 'admin'], function (Ctx $c): array {
    $b = $c->json(2048);
    V::keys($b, ['userId', 'force']);
    $uid = V::has($b, 'userId') ? Subscription::jsonInt($b['userId'], 'userId', 1, V::INT_MAX) : null;
    $force = V::has($b, 'force') ? V::bool($b['force'], 'force') : false;
    $results = Subscription::renewDue($uid, $force);
    Audit::log('sub_renew_run', $uid, ['force' => $force, 'count' => count($results), 'via' => 'api'], 'info', $c->uid());
    return ['results' => $results];
});
