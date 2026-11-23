<?php
/**
 * POST api/support/reply.php {id, body} — the caller adds words to their own open report or question → {ticket}
 * Another account's id or a missing one → 404 NOT_FOUND; a closed one → 409 SUPPORT_CLOSED; more than 20 follow-ups
 * → 429 SUPPORT_LIMIT. Text ≤ 1,000 characters through the bad-word filter and the personal-data mask.
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
    $b = $c->json(8192);
    V::keys($b, ['id', 'body']);
    $id = V::id(isset($b['id']) ? $b['id'] : null, 'id');
    $body = V::str(isset($b['body']) ? $b['body'] : null, 'body', 4000, 1);
    Session::close();
    return ['ticket' => Support::reply($c->user, $id, $body)];
});
