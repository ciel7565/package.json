<?php
/**
 * GET api/allot/inbox.php?after=<notice id>
 *   → {notices: [{id, kind, title, body, at, seen, contractNo}], unread, last}
 * The caller's allotment notices (신청 접수 · 확정 · 납부 안내 · 자리 제안 · 운영자 안내 …), newest first, at most 50; `after`
 * = only notices newer than that id (poll with the `last` of the answer before). kind is one of applied · approved ·
 * rejected · canceled · hold_expired · paid · due · ending · overdue · ended · renewed · moved · offer · offer_expired ·
 * cancel_requested · info. No amount is ever in a notice. Only the caller's own rows.
 * Login only. 400 INVALID_INPUT for a malformed `after`, 403 ALLOT_DISABLED. Rate limit allot_inbox (shared with seen.php).
 */
declare(strict_types=1);

require __DIR__ . '/../../lib/bootstrap.php';

use Tfm\Allot;
use Tfm\Api;
use Tfm\Ctx;
use Tfm\Session;
use Tfm\V;

Api::run(['method' => 'GET', 'auth' => true, 'rate' => 'allot_inbox'], function (Ctx $c): array {
    V::keys($_GET, ['after'], 'query');
    $after = V::int(V::query('after', '0'), 'after', 0, V::INT_MAX);
    Session::close();
    Allot::guard();
    Allot::lazyTick();
    return Allot::inbox($c->uid(), $after, 50);
});
