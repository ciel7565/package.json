<?php
/** GET api/admin/stats.php — admin only. Totals, distributions and recent activity (see Tfm\Stats). */
declare(strict_types=1);

require __DIR__ . '/../../lib/bootstrap.php';

use Tfm\{Api, Ctx, Session, Stats};

Api::run(['method' => 'GET', 'admin' => true, 'rate' => 'admin'], function (Ctx $c): array {
    Session::close();
    return Stats::collect();
});
