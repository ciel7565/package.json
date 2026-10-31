<?php
/**
 * POST api/sub/grant.php — admin only (the same actions as admin.php 구독 탭).
 *   {userId, tier:2|3|4, days}  수동 부여 (schools, events) → {message, sub}
 *   {userId, revoke:true}       해지: back to tier 1 now        → {message, sub}
 */
declare(strict_types=1);

require __DIR__ . '/../../lib/bootstrap.php';

use Tfm\Api;
use Tfm\ApiException;
use Tfm\Ctx;
use Tfm\Subscription;

Api::run(['method' => 'POST', 'admin' => true, 'rate' => 'admin'], function (Ctx $c): array {
    $b = $c->json(2048);
    $uid = isset($b['userId']) && (is_int($b['userId']) || (is_string($b['userId']) && ctype_digit($b['userId']))) ? (int) $b['userId'] : 0;
    if ($uid <= 0) throw new ApiException(400, 'INVALID_PARAM', '사용자 번호가 필요해요.');
    if ((isset($b['revoke']) ? $b['revoke'] : false) === true) return Subscription::revoke($c->user, $uid);
    $tier = isset($b['tier']) && (is_int($b['tier']) || (is_string($b['tier']) && ctype_digit($b['tier']))) ? (int) $b['tier'] : 0;
    $days = isset($b['days']) && (is_int($b['days']) || (is_string($b['days']) && ctype_digit($b['days']))) ? (int) $b['days'] : 30;
    return Subscription::grant($c->user, $uid, $tier, $days);
});
