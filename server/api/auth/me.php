<?php
/**
 * GET api/auth/me.php — who is logged in on this session:
 * {user:{id,email,nickname,role} | null, mutedUntil, sub:{tier,status,expiresAt,autoRenew}, restoredAt, restoredRev}
 * (restoredAt / restoredRev: the stored save is an operator restore, see player/get.php; 0 = none)
 * (200 with user:null when logged out, so a fresh visitor never sees an error.) The subscription is settled lazily
 * (expiry / renewal check, bounded to once an hour per user).
 */
declare(strict_types=1);

require __DIR__ . '/../../lib/bootstrap.php';

use Tfm\Api;
use Tfm\Ctx;
use Tfm\SaveValidator;
use Tfm\Subscription;
use Tfm\Users;

Api::run(['method' => 'GET', 'rate' => 'me'], function (Ctx $c): array {
    if (!$c->user) return ['user' => null, 'sub' => Subscription::none()] + SaveValidator::restoreStamp(null);
    return ['user' => Users::publicUser($c->user), 'mutedUntil' => (int) $c->user['muted_until'], 'sub' => Subscription::state($c->uid())] + SaveValidator::restoreStampFor($c->uid());
});
