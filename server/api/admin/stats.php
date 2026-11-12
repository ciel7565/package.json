<?php
/**
 * GET api/admin/stats.php — totals, distributions and recent activity (see Tfm\Stats).
 * Access: an admin whose session is elevated in the admin site (CONTRACT §15.4 (d)); an app login alone gets
 * 403 ADMIN_REAUTH (data.adminUrl points to the admin site).
 */
declare(strict_types=1);

require __DIR__ . '/../../lib/bootstrap.php';

use Tfm\AdminGate;
use Tfm\Api;
use Tfm\Ctx;
use Tfm\Session;
use Tfm\Stats;

Api::run(['method' => 'GET', 'admin' => true, 'rate' => 'admin'], function (Ctx $c): array {
    AdminGate::requireApi($c);
    Session::close();
    return Stats::collect();
});
