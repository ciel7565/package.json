<?php
/**
 * GET api/allot/map.php?v=<version>&kind=<jar|plot|store>&zone=<zone code>
 *   → {v, zones: [{code, kind, name, cap, cols, open, s}]}      or      {v, same: true}
 * The whole allotment as a compact map: `s` has one character per unit in seq order — o free, h held, l leased, c closed —
 * `cols` units per row, `open` = the zone takes applications. `v` grows with every change; send the `v` you already have
 * and an unchanged map answers {v, same: true}. kind / zone narrow the list (v is always the version of the whole map).
 * No personal data and no prices: the answer is identical for every visitor (and cached per version).
 * No login needed. 400 INVALID_INPUT for a malformed parameter, 403 ALLOT_DISABLED. Rate limit allot_map.
 */
declare(strict_types=1);

require __DIR__ . '/../../lib/bootstrap.php';

use Tfm\Allot;
use Tfm\Api;
use Tfm\Ctx;
use Tfm\Session;
use Tfm\V;

Api::run(['method' => 'GET', 'rate' => 'allot_map'], function (Ctx $c): array {
    V::keys($_GET, ['v', 'kind', 'zone'], 'query');
    $have = V::query('v') === null ? null : V::int(V::query('v'), 'v', 0, V::INT_MAX);
    $kind = V::query('kind') === null ? null : V::enum(V::query('kind'), 'kind', Allot::KINDS);
    $zone = V::query('zone');
    if ($zone !== null && !preg_match('/^[A-Za-z0-9]{1,12}$/', $zone)) V::fail('zone', '구역 번호가 올바르지 않아요.');
    Session::close();
    Allot::guard();
    return Allot::map($kind, $zone, $have);
});
