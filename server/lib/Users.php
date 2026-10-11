<?php
/**
 * Accounts: validation (email / nickname / password), password hashing (argon2id → bcrypt fallback,
 * transparent rehash), lookups, public projection.
 */
declare(strict_types=1);

namespace Tfm;

if (!defined('TFM_BOOT')) { http_response_code(404); exit; }

final class Users
{
    public const RESERVED = ['관리자', '운영자', '운영진', '시스템', 'admin', 'administrator', 'root', 'gm', 'system', 'moderator',
        '발효마스터', '산골농부', '전통사랑', '장독지기', '안내원', 'null', 'undefined', 'server', '서버'];
    private const WEAK = ['password1', 'password12', 'password123', 'qwerty123', 'qwer1234', 'asdf1234', 'abcd1234', 'abc12345',
        'a1234567', 'a12345678', 'test1234', 'admin123', 'admin1234', 'iloveyou1', 'q1w2e3r4', '1q2w3e4r', '1q2w3e4r5t', 'zxcv1234', 'aa123456'];

    // ------------------------------------------------------------------ text helpers
    /** NFC-normalize, strip control/invisible characters, collapse spaces */
    public static function cleanText(string $s, int $maxChars): string
    {
        if (!mb_check_encoding($s, 'UTF-8')) $s = mb_convert_encoding($s, 'UTF-8', 'UTF-8');
        if (class_exists(\Normalizer::class)) $s = \Normalizer::normalize($s, \Normalizer::FORM_C) ?: $s;
        // C0/C1 controls, zero-width & bidi overrides (spoofing), BOM
        $s = preg_replace('/[\x{0000}-\x{001F}\x{007F}-\x{009F}\x{200B}-\x{200F}\x{202A}-\x{202E}\x{2060}-\x{2064}\x{2066}-\x{2069}\x{FEFF}]/u', ' ', $s) ?? '';
        $s = trim(preg_replace('/\s+/u', ' ', $s) ?? '');
        return mb_substr($s, 0, $maxChars);
    }

    public static function validEmail(string $email): ?string
    {
        if ($email === '') return '이메일을 입력해 주세요.';
        if (strlen($email) > 120 || !filter_var($email, FILTER_VALIDATE_EMAIL) || !preg_match('/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/', $email)) {
            return '이메일 형식이 올바르지 않아요. (예: name@example.com)';
        }
        return null;
    }

    public static function validNickname(string $nick): ?string
    {
        if ($nick === '') return '닉네임을 입력해 주세요.';
        $n = mb_strlen($nick);
        if ($n < 2 || $n > 12) return '닉네임은 2~12자로 입력해 주세요.';
        if (!preg_match('/^[\x{AC00}-\x{D7A3}a-zA-Z0-9_]+$/u', $nick)) return '한글·영문·숫자·밑줄(_)만 사용할 수 있어요.';
        $low = mb_strtolower($nick);
        if (in_array($low, array_map('mb_strtolower', self::RESERVED), true)) return '사용할 수 없는 닉네임이에요.';
        if (preg_match('/^(게스트|guest)/iu', $nick)) return '‘게스트’로 시작하는 닉네임은 사용할 수 없어요.';
        if (ChatFilter::containsBadWord($nick)) return '바르고 고운 닉네임을 사용해 주세요.';
        // nicknames are shown to everyone: no phone numbers, addresses, school names or messenger ids (kid safety)
        if (ChatFilter::nicknameLooksPersonal($nick)) return '전화번호·주소·학교 같은 개인정보는 닉네임에 쓸 수 없어요. 🔒';
        return null;
    }

    public static function validPassword(string $pw, string $email = '', string $nick = ''): ?string
    {
        if ($pw === '') return '비밀번호를 입력해 주세요.';
        if (preg_match('/\s/u', $pw)) return '비밀번호에는 공백을 쓸 수 없어요.';
        $len = mb_strlen($pw);
        if ($len < 8) return '비밀번호는 8자 이상이어야 해요.';
        if ($len > 64) return '비밀번호는 64자 이하로 입력해 주세요.';
        if (!preg_match('/[A-Za-z]/', $pw) || !preg_match('/[0-9]/', $pw)) return '영문과 숫자를 모두 포함해 주세요.';
        if (!defined('PASSWORD_ARGON2ID') && strlen($pw) > 72) return '비밀번호가 너무 길어요. (72바이트 이하)';
        $low = mb_strtolower($pw);
        if (in_array($low, self::WEAK, true) || preg_match('/^(.)\1{7,}$/u', $pw)) return '너무 흔한 비밀번호예요. 다른 비밀번호를 사용해 주세요.';
        $local = mb_strtolower((string) strstr($email, '@', true));
        if (($local !== '' && mb_strlen($local) >= 4 && str_contains($low, $local)) || ($nick !== '' && mb_strlen($nick) >= 4 && str_contains($low, mb_strtolower($nick)))) {
            return '비밀번호에 이메일이나 닉네임을 넣지 말아 주세요.';
        }
        return null;
    }

    // ------------------------------------------------------------------ passwords
    public static function algo(): string|int|null { return defined('PASSWORD_ARGON2ID') ? PASSWORD_ARGON2ID : PASSWORD_DEFAULT; }
    private static function algoOpts(): array { return defined('PASSWORD_ARGON2ID') ? [] : ['cost' => 12]; }

    public static function hashPassword(string $pw): string
    {
        $h = password_hash($pw, self::algo(), self::algoOpts());
        if (!is_string($h) || $h === '') throw new \RuntimeException('password_hash failed');
        return $h;
    }

    /**
     * Verify a password. For unknown accounts a precomputed hash with the same algorithm/cost is verified so
     * the response time does not reveal whether an account exists (no extra hashing work on that path).
     */
    public static function verifyPassword(?array $user, string $pw): bool
    {
        if (!$user) {
            password_verify($pw, defined('PASSWORD_ARGON2ID')
                ? '$argon2id$v=19$m=65536,t=4,p=1$UW5EVVZ1M0pXRm1BUXcxeA$wKpLsv0tiagg61eOs0hZAEgJ8WIzdyHWCOoEHSK/rJE'
                : '$2y$12$bXrXGZfMsLQEjwBNoRg9oeQKTDRIWr6xqgeTL1pkAAQP/wB5tfDBy');
            return false;
        }
        return password_verify($pw, (string) $user['password_hash']);
    }

    public static function maybeRehash(array $user, string $pw): void
    {
        if (password_needs_rehash((string) $user['password_hash'], self::algo(), self::algoOpts())) {
            Db::exec('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?', [self::hashPassword($pw), Clock::ms(), (int) $user['id']]);
            Log::info('AUTH', 'password hash upgraded', ['uid' => (int) $user['id']]);
        }
    }

    // ------------------------------------------------------------------ lookups
    public static function byId(int $id): ?array { return $id > 0 ? Db::one('SELECT * FROM users WHERE id = ?', [$id]) : null; }
    public static function byEmail(string $email): ?array { return Db::one('SELECT * FROM users WHERE email = ?', [mb_strtolower(trim($email))]); }
    public static function byNickname(string $nick): ?array { return Db::one('SELECT * FROM users WHERE nickname_key = ?', [mb_strtolower(trim($nick))]); }
    public static function byLogin(string $login): ?array { return str_contains($login, '@') ? self::byEmail($login) : self::byNickname($login); }

    public static function adminExists(): bool { return (int) Db::value("SELECT COUNT(*) FROM users WHERE role = 'admin' AND status = 'active'") > 0; }

    public static function isConfiguredAdmin(string $email): bool
    {
        $list = array_map(fn ($e) => mb_strtolower(trim((string) $e)), (array) Config::get('security.admin_emails', []));
        return $email !== '' && in_array(mb_strtolower($email), $list, true);
    }

    /** public projection (what the client / other players may see about *this* user) */
    public static function publicUser(array $u): array
    {
        return [
            'id'       => (int) $u['id'],
            'email'    => (string) $u['email'],
            'nickname' => (string) $u['nickname'],
            'role'     => $u['role'] === 'admin' ? 'admin' : 'user',
        ];
    }

    public static function create(string $email, string $nick, string $pw): array
    {
        $now = Clock::ms();
        $role = self::isConfiguredAdmin($email) ? 'admin' : 'user';
        $id = Db::insert('users', [
            'email' => mb_strtolower($email), 'nickname' => $nick, 'nickname_key' => mb_strtolower($nick),
            'password_hash' => self::hashPassword($pw), 'role' => $role, 'status' => 'active', 'muted_until' => 0,
            'session_epoch' => 0, 'created_at' => $now, 'updated_at' => $now, 'last_login_at' => $now,
            'last_login_ip' => substr(Http::clientIp(), 0, 64), 'password_changed_at' => $now,
        ]);
        Db::insert('user_profiles', ['user_id' => $id, 'level' => 1, 'exp_total' => 0, 'coin' => 0, 'edu' => 0, 'title' => '', 'updated_at' => $now]);
        return self::byId($id) ?? throw new \RuntimeException('user insert failed');
    }

    /** change role/status and sign the user out of every session (epoch bump) */
    public static function update(int $id, array $fields, bool $bumpEpoch = false): void
    {
        $allowed = ['role', 'status', 'muted_until', 'nickname', 'nickname_key', 'password_hash', 'password_changed_at', 'last_login_at', 'last_login_ip'];
        $set = [];
        $vals = [];
        foreach ($fields as $k => $v) {
            if (!in_array($k, $allowed, true)) throw new \InvalidArgumentException('field not allowed');
            $set[] = "$k = ?";
            $vals[] = $v;
        }
        if ($bumpEpoch) $set[] = 'session_epoch = session_epoch + 1';
        $set[] = 'updated_at = ?';
        $vals[] = Clock::ms();
        $vals[] = $id;
        Db::exec('UPDATE users SET ' . implode(', ', $set) . ' WHERE id = ?', $vals);
    }
}
