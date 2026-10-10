<?php
/**
 * GET api/ping.php — server-mode detection (client: G.net.detect).
 * data: {app:'tfm-metaverse', version, db, serverTime, csrf, loggedIn}; also starts the (anonymous) session
 * that carries the CSRF token used by login/register.
 */
declare(strict_types=1);

require __DIR__ . '/../lib/bootstrap.php';

use Tfm\{Api, Clock, Ctx, Db, Log, Session};

Api::run(['method' => ['GET', 'HEAD'], 'rate' => 'ping', 'rateBy' => 'ip', 'session' => 'create'], function (Ctx $c): array {
    $db = 'unavailable';
    try { Db::pdo(); $db = Db::driver(); } catch (\Throwable $e) { Log::error('DB', 'ping: database unavailable: ' . $e->getMessage()); }
    return [
        'app' => TFM_APP,
        'version' => TFM_VERSION,
        'db' => $db,
        'serverTime' => Clock::ms(),
        'csrf' => Session::csrf(),
        'loggedIn' => $c->user !== null,
    ];
});
