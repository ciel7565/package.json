<?php
/**
 * GET api/ping.php — server-mode detection (client: G.net.detect).
 * data: {app:'tfm-metaverse', version, db, serverTime, csrf, loggedIn, php, rtScale}; also starts the (anonymous) session
 * that carries the CSRF token used by login/register. rtScale = the real-time farm time scale (CONTRACT §15.1, farm.rt_scale).
 * features (CONTRACT §16.9): {sync: 1} when api/sync.php can be used (the wire format version; 0 = keep the old
 * presence / chat polling), {queue: 1} the waiting room exists, {saveEvery: ms} the suggested pause between saves.
 */
declare(strict_types=1);

define('TFM_LIGHT', true);
require __DIR__ . '/../lib/bootstrap.php';

use Tfm\Api;
use Tfm\Clock;
use Tfm\Ctx;
use Tfm\Db;
use Tfm\Farm;
use Tfm\Log;
use Tfm\Session;
use Tfm\Sync;
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
    if (class_exists('Tfm\Farm')) $out['rtScale'] = Farm::scale();
    $out['features'] = class_exists('Tfm\Sync') ? Sync::features() : ['sync' => 0, 'queue' => 0];
    if ($c->isAdmin()) {
        $out['db'] = $dbOk ? Db::driver() : 'unavailable';
        $out['subscriptions']['mock'] = Toss::mock();
    }
    return $out;
});
