<?php
/**
 * POST api/support/delete.php {id} — the caller deletes their own report or question: the row, every message of its
 * thread and the picture file go → {deleted: true, unread}. Another account's id or a missing one → 404 NOT_FOUND.
 * Login + CSRF. Rate limit support_write.
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
    $id = V::id(isset($b['id']) ? $b['id'] : null, 'id');
    Session::close();
    Support::deleteOwn($c->user, $id);
    return ['deleted' => true, 'unread' => Support::unread($c->uid())];
});
