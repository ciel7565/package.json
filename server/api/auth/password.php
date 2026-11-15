<?php
/**
 * POST api/auth/password.php {current, password, password_confirm?} → {changed: true, ent}      (CONTRACT §17.2)
 * Change the password of the logged-in account (the app's 설정 → 계정 → 비밀번호 바꾸기; the admin site has its own form
 * in 🔐 내 계정). A logged-in session and the CSRF token are required, like every other write.
 *
 *   current   the present password — checked with the shared login throttle: a wrong one is 401 INVALID_CREDENTIALS and
 *             counts like a failed sign-in (429 TOO_MANY_ATTEMPTS + Retry-After when locked)
 *   password  the new one: the normal policy (8–64 characters, a letter and a digit, not a common password, not the
 *             e-mail / nickname / login id) — so the default administrator password can never be chosen again;
 *             400 WEAK_PASSWORD · 400 SAME_PASSWORD · 400 PASSWORD_MISMATCH (password_confirm differs)
 *
 * On success EVERY other session of the account ends (users.session_epoch + 1), this one continues with a new session
 * id and CSRF token (the answer carries it), users.pw_default is cleared and the change is audited (password_changed,
 * never a password). ent = the account's entitlement afterwards (an administrator's pwDefault flag is gone).
 * Rate limit: auth_password (per account).
 */
declare(strict_types=1);

require __DIR__ . '/../../lib/bootstrap.php';

use Tfm\Api;
use Tfm\ApiException;
use Tfm\Auth;
use Tfm\Ctx;
use Tfm\Entitle;
use Tfm\Session;
use Tfm\Users;
use Tfm\V;

Api::run(['method' => 'POST', 'auth' => true, 'rate' => 'auth_password'], function (Ctx $c): array {
    $b = $c->json(4096);
    V::keys($b, ['current', 'password', 'password_confirm']);
    $cur = V::has($b, 'current') ? V::str($b['current'], 'current', 512) : '';
    $new = V::has($b, 'password') ? V::str($b['password'], 'password', 512) : '';
    $again = V::has($b, 'password_confirm') ? V::str($b['password_confirm'], 'password_confirm', 512) : $new;
    if ($cur === '') throw new ApiException(400, 'PASSWORD_REQUIRED', '지금 쓰는 비밀번호를 입력해 주세요.', ['field' => 'current']);
    if (!hash_equals($new, $again)) throw new ApiException(400, 'PASSWORD_MISMATCH', '새 비밀번호 두 칸이 서로 달라요.', ['field' => 'password_confirm']);
    Users::confirmPassword($c->user, $cur);
    $fresh = Users::changePassword($c->user, $new, 'app');
    // the epoch bump ended every session of the account; this one continues (new id, new CSRF token)
    Session::refresh($fresh);
    Auth::forget();
    return ['changed' => true, 'ent' => Entitle::forUser($fresh)];
});
