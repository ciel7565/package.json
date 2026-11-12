<?php
/**
 * GET api/ping.php — server-mode detection (client: G.net.detect).
 * data: {app:'tfm-metaverse', version, db, serverTime, csrf, loggedIn, php}; also starts the (anonymous) session
 * that carries the CSRF token used by login/register.
 */
declare(strict_types=1);

require __DIR__ . '/../lib/bootstrap.php';

use Tfm\Api;
use Tfm\Clock;
use Tfm\Ctx;
use Tfm\Db;
use Tfm\Log;
use Tfm\Session;
use Tfm\Toss;

Api::run(['method' => ['GET', 'HEAD'], 'rate' => 'ping', 'rateBy' => 'ip', 'session' => 'create', 'public' => true], function (Ctx $c): array {
    // F15: an anonymous visitor is told only what the app needs to switch to server mode and keep its clock / CSRF token
    // in sync. The database engine and the payment mock flag are recon that the client never uses, so they go to admins
    // only (the dev center / 시스템 점검 show the full picture). The app version stays — it is cosmetic (a title tooltip).
    $dbOk = false;
    try { Db::pdo(); $dbOk = true; } catch (\Throwable $e) { Log::error('DB', 'ping: database unavailable: ' . $e->getMessage()); }
    $out = [
        'app' => TFM_APP,
        'version' => TFM_VERSION,
        'serverTime' => Clock::ms(),
        'csrf' => Session::csrf(),
        'loggedIn' => $c->user !== null,
        'subscriptions' => ['enabled' => true],
    ];
    if ($c->isAdmin()) {
        $out['db'] = $dbOk ? Db::driver() : 'unavailable';
        $out['subscriptions']['mock'] = Toss::mock();
    }
    return $out;
});
