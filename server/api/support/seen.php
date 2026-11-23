<?php
/**
 * POST api/support/seen.php {id?} — the caller has read the answers of one own ticket (id) or of all of them → {unread}
 * Another account's id → 404 NOT_FOUND. Login + CSRF. Rate limit support_write.
 */
declare(strict_types=1);

require __DIR__ . '/../../lib/bootstrap.php';

use Tfm\Api;
use Tfm\Ctx;
use Tfm\Session;
use Tfm\Support;
use Tfm\V;

Api::run(['method' => 'POST', 'auth' => true, 'rate' => 'support_write'], function (Ctx $c): array {
    $b = $c->json(1024);
    V::keys($b, ['id']);
    $id = V::has($b, 'id') ? V::id($b['id'], 'id') : 0;
    Session::close();
    return ['unread' => Support::seen($c->uid(), $id)];
});
