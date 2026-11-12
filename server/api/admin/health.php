<?php
/**
 * GET api/admin/health.php — environment & security self-check (see Tfm\Health).
 * Access: an admin whose session is elevated in the admin site (password + 2-step sign-in there — CONTRACT §15.4 (d));
 * an app login alone gets 403 ADMIN_REAUTH (data.adminUrl points to the admin site). Finding F4: no exception for
 * "the server machine" any more — while no admin exists the first admin is made with the setup code on the admin site.
 * ?quick=1 skips the loopback exposure probe.
 */
declare(strict_types=1);

require __DIR__ . '/../../lib/bootstrap.php';

use Tfm\AdminGate;
use Tfm\Api;
use Tfm\Ctx;
use Tfm\Health;
use Tfm\Session;

Api::run(['method' => 'GET', 'admin' => true, 'rate' => 'admin'], function (Ctx $c): array {
    AdminGate::requireApi($c);
    Session::close();
    $h = Health::collect((isset($_GET['quick']) ? $_GET['quick'] : '') !== '1');
    $h['access'] = 'admin';
    return $h;
});
