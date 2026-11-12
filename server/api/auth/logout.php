<?php
/** POST api/auth/logout.php — ends the session (new anonymous session + CSRF token in the response). */
declare(strict_types=1);

require __DIR__ . '/../../lib/bootstrap.php';

use Tfm\Api;
use Tfm\Audit;
use Tfm\Ctx;
use Tfm\Presence;
use Tfm\Session;
use Tfm\V;

Api::run(['method' => 'POST', 'rate' => 'logout'], function (Ctx $c): array {
    // CONTRACT §15.7 #3: even an endpoint that ignores its body still rejects a malformed one (array / scalar root,
    // over-deep, oversize) with a clean 4xx instead of reading past it — the body is decoded with the depth-32 / size cap.
    V::keys($c->json(1024), []);
    if ($c->user) {
        Presence::remove($c->uid());
        Audit::log('logout', $c->uid());
    }
    Session::logout();
    return ['loggedOut' => true];
});
