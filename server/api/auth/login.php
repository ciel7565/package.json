<?php
/**
 * POST api/auth/login.php  {login | email (email or nickname), password, remember}
 * → {user:{id,email,nickname,role}, sub:{tier,status,expiresAt,autoRenew}}  (new session id + CSRF token)
 * Throttling: exponential lockout per ip+account, per account, per ip (429 TOO_MANY_ATTEMPTS + Retry-After).
 * Logic lives in Tfm\Auth::attemptLogin (shared with admin.php). The subscription is settled lazily here (renewal check).
 */
declare(strict_types=1);

require __DIR__ . '/../../lib/bootstrap.php';

use Tfm\Api;
use Tfm\Auth;
use Tfm\Ctx;
use Tfm\Subscription;
use Tfm\Users;

Api::run(['method' => 'POST', 'rate' => 'login', 'rateBy' => 'ip'], function (Ctx $c): array {
    $b = $c->json(4096);
    $login = isset($b['login']) && is_string($b['login']) ? $b['login'] : (isset($b['email']) && is_string($b['email']) ? $b['email'] : '');
    $pw = isset($b['password']) && is_string($b['password']) ? $b['password'] : '';
    $u = Auth::attemptLogin($login, $pw, (isset($b['remember']) ? $b['remember'] : false) === true);
    return ['user' => Users::publicUser($u), 'sub' => Subscription::state((int) $u['id'])];
});
