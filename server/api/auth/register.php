<?php
/**
 * POST api/auth/register.php  {email, nickname, password, password_confirm, agree}
 * → {user:{id,email,nickname,role}}  (logged in; new session id + CSRF token)
 * Errors: EMAIL_INVALID / EMAIL_TAKEN / NICKNAME_INVALID / NICKNAME_TAKEN / PASSWORD_WEAK / PASSWORD_MISMATCH / TERMS_REQUIRED
 */
declare(strict_types=1);

require __DIR__ . '/../../lib/bootstrap.php';

use Tfm\{Api, ApiException, Audit, Ctx, Db, Log, Session, Users};

Api::run(['method' => 'POST', 'rate' => 'register', 'rateBy' => 'ip'], function (Ctx $c): array {
    if ($c->user) throw new ApiException(409, 'ALREADY_LOGGED_IN', '이미 로그인되어 있어요. 로그아웃한 뒤 가입해 주세요.');
    $b = $c->json(8192);
    $str = fn ($v) => is_string($v) ? $v : '';
    $email = mb_strtolower(trim($str($b['email'] ?? '')));
    $nick = Users::cleanText($str($b['nickname'] ?? ''), 40);
    $pw = $str($b['password'] ?? '');
    $pw2 = array_key_exists('password_confirm', $b) ? $str($b['password_confirm']) : (array_key_exists('confirm', $b) ? $str($b['confirm']) : $pw);
    if ($e = Users::validEmail($email)) throw new ApiException(400, 'EMAIL_INVALID', $e);
    if ($e = Users::validNickname($nick)) throw new ApiException(400, 'NICKNAME_INVALID', $e);
    if ($e = Users::validPassword($pw, $email, $nick)) throw new ApiException(400, 'PASSWORD_WEAK', $e);
    if (!hash_equals($pw, $pw2)) throw new ApiException(400, 'PASSWORD_MISMATCH', '비밀번호가 일치하지 않아요.');
    if (($b['agree'] ?? false) !== true) throw new ApiException(400, 'TERMS_REQUIRED', '이용약관 및 개인정보 처리 안내에 동의해 주세요.');
    if (Users::byEmail($email)) throw new ApiException(409, 'EMAIL_TAKEN', '이미 가입된 이메일이에요. 로그인해 주세요.');
    if (Users::byNickname($nick)) throw new ApiException(409, 'NICKNAME_TAKEN', '이미 사용 중인 닉네임이에요.');
    try {
        $u = Db::tx(fn () => Users::create($email, $nick, $pw));
    } catch (\PDOException $e) {
        // unique index race between the checks above and the insert
        if (str_starts_with((string) $e->getCode(), '23')) {
            if (Users::byEmail($email)) throw new ApiException(409, 'EMAIL_TAKEN', '이미 가입된 이메일이에요. 로그인해 주세요.');
            throw new ApiException(409, 'NICKNAME_TAKEN', '이미 사용 중인 닉네임이에요.');
        }
        throw $e;
    }
    Session::login($u, false);
    Audit::log('register', (int) $u['id'], ['role' => $u['role']], $u['role'] === 'admin' ? 'warn' : 'info');
    Log::info('AUTH', 'account created', ['uid' => (int) $u['id']]);
    return ['user' => Users::publicUser($u), 'isNew' => true];
});
