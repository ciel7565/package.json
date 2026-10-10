<?php
/**
 * POST api/auth/login.php  {login | email (email or nickname), password, remember}
 * → {user:{id,email,nickname,role}}  (new session id + CSRF token)
 * Throttling: exponential lockout per ip+account, per account, per ip (429 TOO_MANY_ATTEMPTS + Retry-After).
 * Logic lives in Tfm\Auth::attemptLogin (shared with admin.php).
 */
declare(strict_types=1);

require __DIR__ . '/../../lib/bootstrap.php';

use Tfm\{Api, Auth, Ctx, Users};

Api::run(['method' => 'POST', 'rate' => 'login', 'rateBy' => 'ip'], function (Ctx $c): array {
    $b = $c->json(4096);
    $login = is_string($b['login'] ?? null) ? $b['login'] : (is_string($b['email'] ?? null) ? $b['email'] : '');
    $pw = is_string($b['password'] ?? null) ? $b['password'] : '';
    $u = Auth::attemptLogin($login, $pw, ($b['remember'] ?? false) === true);
    return ['user' => Users::publicUser($u)];
});
