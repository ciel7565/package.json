<?php
/**
 * GET api/auth/me.php — who is logged in on this session: {user:{id,email,nickname,role} | null, mutedUntil}
 * (200 with user:null when logged out, so a fresh visitor never sees an error.)
 */
declare(strict_types=1);

require __DIR__ . '/../../lib/bootstrap.php';

use Tfm\{Api, Ctx, Users};

Api::run(['method' => 'GET', 'rate' => 'me'], function (Ctx $c): array {
    if (!$c->user) return ['user' => null];
    return ['user' => Users::publicUser($c->user), 'mutedUntil' => (int) $c->user['muted_until']];
});
