<?php
/**
 * GET api/allot/unit.php?code=<unit code, e.g. J01-0012>
 *   → {code, kind, zone: {code, name}, seq, status: 'open'|'held'|'leased'|'closed', canApply, nameplate, logs: [{id, kind,
 *      text, at, scope: 'unit'|'zone'|'all', visible}], mine}
 * What anyone may know about one unit: its state, the nameplate ONLY when its holder chose to show it (else null), the five
 * newest visible care-log lines, and `mine` = the caller (when logged in) holds it. No contract, no customer, no dates,
 * no price. No login needed. 400 INVALID_INPUT without a code, 404 NOT_FOUND for an unknown / malformed one,
 * 403 ALLOT_DISABLED. Rate limit allot_map.
 */
declare(strict_types=1);

require __DIR__ . '/../../lib/bootstrap.php';

use Tfm\Allot;
use Tfm\Api;
use Tfm\Ctx;
use Tfm\Session;
use Tfm\V;

Api::run(['method' => 'GET', 'rate' => 'allot_map'], function (Ctx $c): array {
    V::keys($_GET, ['code'], 'query');
    $code = V::str(V::query('code'), 'code', 24, 1);
    Session::close();
    Allot::guard();
    return Allot::unitView($code, $c->uid());
});
