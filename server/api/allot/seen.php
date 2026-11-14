<?php
/**
 * POST api/allot/seen.php  {ids: [noticeId, …]}  → {updated, unread}
 * Marks the caller's own allotment notices as read. Ids of other accounts, unknown ids and notices already read change
 * nothing (they are not an error). ids: a list of at most 50 JSON integers ≥ 1; nothing else is accepted in the body.
 * Login, CSRF. 400 INVALID_INPUT, 403 ALLOT_DISABLED. Rate limit allot_inbox (one budget with inbox.php).
 */
declare(strict_types=1);

require __DIR__ . '/../../lib/bootstrap.php';

use Tfm\Allot;
use Tfm\Api;
use Tfm\Arr;
use Tfm\Ctx;
use Tfm\Session;
use Tfm\V;

Api::run(['method' => 'POST', 'auth' => true, 'rate' => 'allot_inbox'], function (Ctx $c): array {
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
    Allot::guard();
    return ['updated' => Allot::markSeen($c->uid(), $clean), 'unread' => Allot::unread($c->uid())];
});
