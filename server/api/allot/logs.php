<?php
/**
 * GET api/allot/logs.php?code=<unit code>&before=<log id>      or      ?zone=<zone code>&before=<log id>
 *   → {logs: [{id, kind, text, at, scope: 'unit'|'zone'|'all', visible}], more}
 * The care log (관리 일지) the operator writes, newest first, 20 lines a page: for a unit its own lines, its zone's and the
 * ones for every zone; for a zone the zone's and the ones for every zone. `before` = the id of the last line of the page
 * before. Only visible lines; the text is cleaned and masked when it is written. No login needed.
 * 400 INVALID_INPUT (neither / both of code and zone, a malformed value), 404 NOT_FOUND, 403 ALLOT_DISABLED.
 * Rate limit allot_map.
 */
declare(strict_types=1);

require __DIR__ . '/../../lib/bootstrap.php';

use Tfm\Allot;
use Tfm\Api;
use Tfm\Ctx;
use Tfm\Session;
use Tfm\V;

Api::run(['method' => 'GET', 'rate' => 'allot_map'], function (Ctx $c): array {
    V::keys($_GET, ['code', 'zone', 'before'], 'query');
    $code = V::query('code');
    $zone = V::query('zone');
    if (($code === null) === ($zone === null)) V::fail($code === null ? 'code' : 'zone', '자리 번호(code)나 구역 번호(zone) 가운데 하나를 보내 주세요.');
    if ($code !== null) V::str($code, 'code', 24, 1);
    if ($zone !== null && !preg_match('/^[A-Za-z0-9]{1,12}$/', $zone)) V::fail('zone', '구역 번호가 올바르지 않아요.');
    $before = V::int(V::query('before', '0'), 'before', 0, V::INT_MAX);
    Session::close();
    Allot::guard();
    return Allot::careLogs($code !== null ? ['unit' => $code] : ['zone' => $zone], 20, $before);
});
