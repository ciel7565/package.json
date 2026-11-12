<?php
/**
 * POST api/auth/register.php  {email, nickname, password, password_confirm, agree, remember?}
 * → {user:{id,email,nickname,role}, isNew:true, sub}  (logged in; new session id + CSRF token)
 * Errors: EMAIL_INVALID / EMAIL_TAKEN / NICKNAME_INVALID / NICKNAME_TAKEN / PASSWORD_WEAK / PASSWORD_MISMATCH / TERMS_REQUIRED
 *         429 RATE_LIMITED (this browser's tries) / 429 REGISTER_IP_LIMIT (sign-ups from this network address,
 *         rate_limits.register_ip) — both with data.retryAfter and a Retry-After header
 */
declare(strict_types=1);

require __DIR__ . '/../../lib/bootstrap.php';

use Tfm\Api;
use Tfm\ApiException;
use Tfm\Audit;
use Tfm\Ctx;
use Tfm\Db;
use Tfm\Http;
use Tfm\Log;
use Tfm\RateLimit;
use Tfm\Sec;
use Tfm\Session;
use Tfm\Str;
use Tfm\Subscription;
use Tfm\Users;
use Tfm\V;

// attempts (typos, weak passwords) count per browser session; complete forms — accounts created, or an e-mail /
// nickname already taken — count per IP (register_ip): a classroom behind one NAT address is not locked out by
// children's input mistakes, and "is this e-mail registered?" probes stay capped per IP as before
Api::run(['method' => 'POST', 'rate' => 'register', 'rateBy' => 'auto'], function (Ctx $c): array {
    if ($c->user) throw new ApiException(409, 'ALREADY_LOGGED_IN', '이미 로그인되어 있어요. 로그아웃한 뒤 가입해 주세요.');
    $b = $c->json(8192);
    // CONTRACT §15.7 #3: known keys only; `agree` and `remember` must be real booleans (not the word "true" or a 1).
    // The e-mail / nickname / password strings keep their own detailed rules below (coerced from a non-string to '' there,
    // which those rules then reject) so a child's typo still gets a kind, specific message.
    V::keys($b, ['email', 'nickname', 'password', 'password_confirm', 'confirm', 'agree', 'remember']);
    $str = function ($v): string { return is_string($v) ? $v : ''; };
    $email = mb_strtolower(trim($str(isset($b['email']) ? $b['email'] : '')));
    $nick = Users::cleanText($str(isset($b['nickname']) ? $b['nickname'] : ''), 40);
    $pw = $str(isset($b['password']) ? $b['password'] : '');
    $pw2 = array_key_exists('password_confirm', $b) ? $str($b['password_confirm']) : (array_key_exists('confirm', $b) ? $str($b['confirm']) : $pw);
    $agree = V::has($b, 'agree') ? V::bool($b['agree'], 'agree') : false;
    $remember = V::has($b, 'remember') ? V::bool($b['remember'], 'remember') : false;
    if ($e = Users::validEmail($email)) throw new ApiException(400, 'EMAIL_INVALID', $e);
    if ($e = Users::validNickname($nick)) throw new ApiException(400, 'NICKNAME_INVALID', $e);
    if ($e = Users::validPassword($pw, $email, $nick)) throw new ApiException(400, 'PASSWORD_WEAK', $e);
    if (!hash_equals($pw, $pw2)) throw new ApiException(400, 'PASSWORD_MISMATCH', '비밀번호가 일치하지 않아요.');
    if (!$agree) throw new ApiException(400, 'TERMS_REQUIRED', '이용약관 및 개인정보 처리 안내에 동의해 주세요.');
    try { RateLimit::hit('register_ip', 'ip:' . Sec::hashId(Http::clientIp())); }
    catch (ApiException $e) {
        // its own code: the client can say the limit is this network's (a school or home address), not this browser's
        if ($e->errorCode !== 'RATE_LIMITED') throw $e;
        throw new ApiException(429, 'REGISTER_IP_LIMIT', '이 인터넷 주소에서 가입이 너무 많았어요. 잠시 후 다시 시도해 주세요.', $e->data, $e->headers);
    }
    if (Users::byEmail($email)) throw new ApiException(409, 'EMAIL_TAKEN', '이미 가입된 이메일이에요. 로그인해 주세요.');
    if (Users::byNickname($nick)) throw new ApiException(409, 'NICKNAME_TAKEN', '이미 사용 중인 닉네임이에요.');
    try {
        $u = Db::tx(function () use ($email, $nick, $pw) { return Users::create($email, $nick, $pw); });
    } catch (\PDOException $e) {
        // unique index race between the checks above and the insert
        if (Str::startsWith((string) $e->getCode(), '23')) {
            if (Users::byEmail($email)) throw new ApiException(409, 'EMAIL_TAKEN', '이미 가입된 이메일이에요. 로그인해 주세요.');
            throw new ApiException(409, 'NICKNAME_TAKEN', '이미 사용 중인 닉네임이에요.');
        }
        throw $e;
    }
    // "이 기기에서 로그인 상태 유지" on the register form: the same long-lived session login.php gives
    Session::login($u, $remember);
    Audit::log('register', (int) $u['id'], ['role' => $u['role']], $u['role'] === 'admin' ? 'warn' : 'info');
    Log::info('AUTH', 'account created', ['uid' => (int) $u['id']]);
    return ['user' => Users::publicUser($u), 'isNew' => true, 'sub' => Subscription::none()];
});
