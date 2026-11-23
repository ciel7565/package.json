<?php
/**
 * GET | HEAD api/support/shot.php?id=<ticket id> — the picture of the screen of a report or question (not JSON).
 * Only its owner (and an administrator) gets it; anybody else, a ticket without a picture and a missing id answer
 * 404 NOT_FOUND (JSON) — an id never tells whether a ticket exists. The answer: Content-Type image/jpeg (fixed, the
 * file was re-encoded on arrival), X-Content-Type-Options: nosniff, Cache-Control: private, a sandbox CSP,
 * Cross-Origin-Resource-Policy: same-origin, an ETag (304). The files live in data/support/ (never served directly).
 * Login. Rate limit support_shot.
 */
declare(strict_types=1);

require __DIR__ . '/../../lib/bootstrap.php';

use Tfm\Api;
use Tfm\Ctx;
use Tfm\Support;
use Tfm\V;

Api::run(['method' => ['GET', 'HEAD'], 'auth' => true, 'rate' => 'support_shot'], function (Ctx $c): array {
    V::keys($_GET, ['id'], 'query');
    $id = V::id(V::query('id'), 'id');
    Support::stream(Support::shotFor($c->user, $id)); // sends the file and ends the request
    return [];
});
