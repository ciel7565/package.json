<?php
/**
 * GET api/auth/me.php — who is logged in on this session:
 * {user:{id,email,nickname,role} | null, mutedUntil, sub:{tier,status,expiresAt,autoRenew}, restoredAt, restoredRev}
 * (restoredAt / restoredRev: the stored save is an operator restore, see player/get.php; 0 = none)
 * (200 with user:null when logged out, so a fresh visitor never sees an error.) The subscription is settled lazily
 * (expiry / renewal check, bounded to once an hour per user).
 * features (CONTRACT §16.9): {sync, queue, saveEvery} as in api/ping.php — the page decides with it whether it talks to
 * api/sync.php or keeps the old presence / chat polling.
 * ent (CONTRACT §17.2): what this session may do — Tfm\Entitle::forUser (a guest gets the free values); adminUrl and
 * pwDefault are inside it for administrators only. site: the public operator settings (G.site.get(key, fallback)).
 */
declare(strict_types=1);

define('TFM_LIGHT', true);
require __DIR__ . '/../../lib/bootstrap.php';

use Tfm\Api;
use Tfm\Ctx;
use Tfm\Entitle;
use Tfm\SaveValidator;
use Tfm\Subscription;
use Tfm\Sync;
use Tfm\Users;

Api::run(['method' => 'GET', 'rate' => 'me'], function (Ctx $c): array {
    $features = ['features' => class_exists('Tfm\Sync') ? Sync::features() : ['sync' => 0, 'queue' => 0]];
    $site = ['site' => Entitle::site()]; // [entitle]
    if (!$c->user) return ['user' => null, 'sub' => Subscription::none(), 'ent' => Entitle::guest()] + $site + SaveValidator::restoreStamp(null) + $features;
    $sub = Subscription::state($c->uid());
    $out = ['user' => Users::publicUser($c->user), 'mutedUntil' => (int) $c->user['muted_until'], 'sub' => $sub, 'ent' => Entitle::forUser($c->user, $sub)] + $site + SaveValidator::restoreStampFor($c->uid()) + $features;
    // CONTRACT §15.4 (a): the admin site's address (relative to the installation, e.g. "admin-1a2b3c4d5e/") — admins only
    if ($c->isAdmin() && class_exists('Tfm\AdminPath') && Tfm\AdminPath::relUrl() !== '') $out['adminUrl'] = Tfm\AdminPath::relUrl();
    return $out;
});
