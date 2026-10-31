<?php
/** POST api/auth/logout.php — ends the session (new anonymous session + CSRF token in the response). */
declare(strict_types=1);

require __DIR__ . '/../../lib/bootstrap.php';

use Tfm\Api;
use Tfm\Audit;
use Tfm\Ctx;
use Tfm\Presence;
use Tfm\Session;

Api::run(['method' => 'POST', 'rate' => 'logout'], function (Ctx $c): array {
    if ($c->user) {
        Presence::remove($c->uid());
        Audit::log('logout', $c->uid());
    }
    Session::logout();
    return ['loggedOut' => true];
});
