<?php
/**
 * POST api/farm/seen.php  {ids: [reportId, …]}  → {updated, unseen}
 * Marks the caller's DECIDED completion requests as seen (the book showed the stamp and the memo). Ids of other accounts,
 * unknown ids and pending requests change nothing. ids: a list of ≤ 50 JSON integers ≥ 1. Login, CSRF, rate limit
 * farm_reports (one budget with reports.php: the book polls both).
 */
declare(strict_types=1);

require __DIR__ . '/../../lib/bootstrap.php';

use Tfm\Api;
use Tfm\Arr;
use Tfm\Ctx;
use Tfm\Farm;
use Tfm\Session;
use Tfm\V;

Api::run(['method' => 'POST', 'auth' => true, 'rate' => 'farm_reports'], function (Ctx $c): array {
    $b = $c->json(4096);
    V::keys($b, ['ids']);
    $ids = V::arr(V::has($b, 'ids') ? $b['ids'] : null, 'ids', 50);
    if ($ids !== [] && !Arr::isList($ids)) V::fail('ids', '값은 목록으로 보내 주세요.');
    $clean = [];
    foreach ($ids as $id) {
        if (!is_int($id)) V::fail('ids', '값은 번호(1 이상의 정수) 목록이어야 해요.');
        $clean[] = V::id($id, 'ids');
    }
    Session::close();
    return ['updated' => Farm::markSeen($c->uid(), $clean), 'unseen' => Farm::unseen($c->uid())];
});
