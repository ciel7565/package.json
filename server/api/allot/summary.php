<?php
/**
 * GET api/allot/summary.php → {enabled, total, open, held, leased, closed, byKind: {jar | plot | store: {total, open, held,
 *                              leased, closed}}, zones, waiting, v}
 * Public numbers of the allotment (분양) for the title screen, the counter board and the panel: how many units exist and
 * how many are free. No prices, no personal data; identical for every visitor. `v` is the map version (api/allot/map.php).
 * While the operator has switched allotment off the answer is just {enabled: false}.
 * No login needed; no query parameters. Rate limit allot_map (shared with map.php, unit.php, logs.php).
 * This is also one of the calls that keeps the automation alive on a server without the scheduler line (Allot::lazyTick).
 */
declare(strict_types=1);

require __DIR__ . '/../../lib/bootstrap.php';

use Tfm\Allot;
use Tfm\Api;
use Tfm\Ctx;
use Tfm\Session;
use Tfm\V;

Api::run(['method' => 'GET', 'rate' => 'allot_map'], function (Ctx $c): array {
    V::keys($_GET, [], 'query');
    Session::close(); // read-only: release the session lock
    if (!Allot::enabled()) return ['enabled' => false];
    Allot::lazyTick();
    return Allot::summary();
});
