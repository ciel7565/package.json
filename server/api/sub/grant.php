<?php
/**
 * POST api/sub/grant.php — admin only (the same actions as admin.php 구독 탭).
 *   {userId, tier:2|3|4, days}  수동 부여 (schools, events) → {message, sub}
 *   {userId, revoke:true}       해지: back to tier 1 now        → {message, sub}
 */
declare(strict_types=1);

require __DIR__ . '/../../lib/bootstrap.php';

use Tfm\Api;
use Tfm\Ctx;
use Tfm\Subscription;
use Tfm\V;

// JSON integers only: userId ≥ 1, tier 2–4 (INVALID_TIER), days 1–3650; revoke a real boolean
Api::run(['method' => 'POST', 'admin' => true, 'rate' => 'admin'], function (Ctx $c): array {
    $b = $c->json(2048);
    V::keys($b, ['userId', 'tier', 'days', 'revoke']);
    $uid = Subscription::jsonInt(isset($b['userId']) ? $b['userId'] : null, 'userId', 1, V::INT_MAX);
    if (V::has($b, 'revoke') && V::bool($b['revoke'], 'revoke')) return Subscription::revoke($c->user, $uid);
    $tier = Subscription::jsonInt(isset($b['tier']) ? $b['tier'] : null, 'tier', PHP_INT_MIN, PHP_INT_MAX);
    $days = V::has($b, 'days') ? Subscription::jsonInt($b['days'], 'days', 1, 3650) : 30;
    return Subscription::grant($c->user, $uid, $tier, $days);
});
