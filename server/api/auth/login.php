<?php
/**
 * POST api/auth/login.php  {login | email (email or nickname), password, remember}
 * → {user:{id,email,nickname,role}, sub:{tier,status,expiresAt,autoRenew}, restoredAt, restoredRev}  (new session id + CSRF token)
 * restoredAt / restoredRev: the stored save is an operator restore (see player/get.php; 0 = none).
 * Throttling: exponential lockout per ip+account, per account, per ip (429 TOO_MANY_ATTEMPTS + Retry-After).
 * Logic lives in Tfm\Auth::attemptLogin (shared with admin.php). The subscription is settled lazily here (renewal check).
 */
declare(strict_types=1);

require __DIR__ . '/../../lib/bootstrap.php';

use Tfm\Api;
use Tfm\Auth;
use Tfm\Ctx;
use Tfm\SaveValidator;
use Tfm\Subscription;
use Tfm\Users;
use Tfm\V;

Api::run(['method' => 'POST', 'rate' => 'login', 'rateBy' => 'ip'], function (Ctx $c): array {
    // CONTRACT §15.7 #3: every field is typed through V — a number / array where a string belongs is a 400, not a
    // silent coercion (the detailed length / lock-out rules live in Auth::attemptLogin).
    $b = $c->json(4096);
    V::keys($b, ['login', 'email', 'password', 'remember']);
    $login = V::has($b, 'login') ? V::str($b['login'], 'login', 120) : (V::has($b, 'email') ? V::str($b['email'], 'email', 120) : '');
    $pw = V::has($b, 'password') ? V::str($b['password'], 'password', 512) : '';
    $remember = V::has($b, 'remember') ? V::bool($b['remember'], 'remember') : false;
    $u = Auth::attemptLogin($login, $pw, $remember);
    return ['user' => Users::publicUser($u), 'sub' => Subscription::state((int) $u['id'])] + SaveValidator::restoreStampFor((int) $u['id']);
});
