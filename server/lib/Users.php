<?php
/**
 * Accounts: validation (email / nickname / password), password hashing (argon2id → argon2i → bcrypt, picked by
 * what this PHP build offers; transparent rehash), lookups, public projection.
 * PHP 7.2 syntax only.
 */
declare(strict_types=1);

namespace Tfm;

if (!defined('TFM_BOOT')) { if (function_exists('header_remove')) header_remove('X-Powered-By'); http_response_code(404); exit; }

final class Users
{
    public const RESERVED = ['관리자', '운영자', '운영진', '시스템', 'admin', 'administrator', 'root', 'gm', 'system', 'moderator',
        '발효마스터', '산골농부', '전통사랑', '장독지기', '안내원', 'null', 'undefined', 'server', '서버'];
    private const WEAK = ['password1', 'password12', 'password123', 'qwerty123', 'qwer1234', 'asdf1234', 'abcd1234', 'abc12345',
        'a1234567', 'a12345678', 'test1234', 'admin123', 'admin1234', 'iloveyou1', 'q1w2e3r4', '1q2w3e4r', '1q2w3e4r5t', 'zxcv1234', 'aa123456'];
    /** precomputed hashes of a dummy password (constant-time verification for unknown accounts) */
    private const DUMMY = [
        'argon2id' => '$argon2id$v=19$m=65536,t=4,p=1$ZkFFZmxxQWFlUjBKV3c3SQ$8AGOXtRYDwh9ZVfhrUzlRaggDKHJ2P5qPt34yA6ROoM',
        'argon2i'  => '$argon2i$v=19$m=65536,t=4,p=1$SUdlajJzcjM0bUVVajlveA$KkOjjWPPVgSMWDSpbJ1i9g/w48hvV4lGEm4zuG4kHY8',
        'bcrypt'   => '$2y$12$Ufu6EgE4.ftN0Se70kmzFe7lhoAC0J9Utpx0ZJT4tN5z/oIj18Fna',
    ];

    // ------------------------------------------------------------------ text helpers
    /** NFC-normalize, strip control/invisible characters, collapse spaces */
    public static function cleanText(string $s, int $maxChars): string
    {
        if (!mb_check_encoding($s, 'UTF-8')) $s = (string) mb_convert_encoding($s, 'UTF-8', 'UTF-8');
        if (class_exists('Normalizer')) { $n = \Normalizer::normalize($s, \Normalizer::FORM_C); if (is_string($n) && $n !== '') $s = $n; }
        // the same invisible set the client strips (60-social INVISIBLE_RANGES): C0/C1 controls, soft hyphen, CGJ, ALM,
        // Hangul fillers ("blank" names), zero-width & joiners, bidi overrides/isolates (spoofing), BOM, tag characters
        $s = (string) preg_replace('/[' . ChatFilter::INVISIBLE_CLASS . ']/u', ' ', $s);
        $z = preg_replace('/(\p{M}{2})\p{M}+/u', '$1', $s); // "zalgo" stacks: at most 2 marks per letter
        if (is_string($z)) $s = $z;
        $s = trim((string) preg_replace('/\s+/u', ' ', $s));
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

    /**
     * @param bool $staff true for the installer's first admin: staff may carry a reserved name such as 운영자
     *                    (the reserved list exists so ordinary visitors cannot pose as staff)
     */
    public static function validNickname(string $nick, bool $staff = false): ?string
    {
        if ($nick === '') return '닉네임을 입력해 주세요.';
        $n = mb_strlen($nick);
        if ($n < 2 || $n > 12) return '닉네임은 2~12자로 입력해 주세요.';
        if (!preg_match('/^[\x{AC00}-\x{D7A3}a-zA-Z0-9_]+$/u', $nick)) return '한글·영문·숫자·밑줄(_)만 사용할 수 있어요.';
        $low = mb_strtolower($nick);
        if (!$staff && in_array($low, array_map('mb_strtolower', self::RESERVED), true)) return '사용할 수 없는 닉네임이에요.';
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
        if (self::algoName() === 'bcrypt' && strlen($pw) > 72) return '비밀번호가 너무 길어요. (72바이트 이하)';
        $low = mb_strtolower($pw);
        if (in_array($low, self::WEAK, true) || preg_match('/^(.)\1{7,}$/u', $pw)) return '너무 흔한 비밀번호예요. 다른 비밀번호를 사용해 주세요.';
        $local = mb_strtolower((string) strstr($email, '@', true));
        if (($local !== '' && mb_strlen($local) >= 4 && Str::contains($low, $local)) || ($nick !== '' && mb_strlen($nick) >= 4 && Str::contains($low, mb_strtolower($nick)))) {
            return '비밀번호에 이메일이나 닉네임을 넣지 말아 주세요.';
        }
        return null;
    }

    // ------------------------------------------------------------------ passwords
    /** the strongest algorithm this PHP build offers: Argon2id (7.3+) → Argon2i (7.2 with libargon2) → bcrypt */
    public static function algo()
    {
        // constant() keeps the name out of the static 7.2 lint; defined() guards it at run time (7.3+ with argon2)
        if (defined('PASSWORD_ARGON2ID')) return constant('PASSWORD_ARGON2ID');
        if (defined('PASSWORD_ARGON2I')) return constant('PASSWORD_ARGON2I');
        return PASSWORD_BCRYPT;
    }

    public static function algoName(): string
    {
        if (defined('PASSWORD_ARGON2ID')) return 'argon2id';
        if (defined('PASSWORD_ARGON2I')) return 'argon2i';
        return 'bcrypt';
    }

    private static function algoOpts(): array { return self::algoName() === 'bcrypt' ? ['cost' => 12] : []; }

    public static function hashPassword(string $pw): string
    {
        $h = password_hash($pw, self::algo(), self::algoOpts());
        if (!is_string($h) || $h === '') throw new \RuntimeException('password_hash failed');
        return $h;
    }

    /**
     * Verify a password. For unknown accounts a precomputed hash with the same algorithm is verified so the
     * response time does not reveal whether an account exists (no extra hashing work on that path).
     */
    public static function verifyPassword(?array $user, string $pw): bool
    {
        if (!$user) {
            password_verify($pw, self::DUMMY[self::algoName()]);
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
    public static function byLogin(string $login): ?array { return Str::contains($login, '@') ? self::byEmail($login) : self::byNickname($login); }

    public static function adminExists(): bool { return (int) Db::value("SELECT COUNT(*) FROM users WHERE role = 'admin' AND status = 'active'") > 0; }

    public static function isConfiguredAdmin(string $email): bool
    {
        $list = array_map(function ($e) { return mb_strtolower(trim((string) $e)); }, (array) Config::get('security.admin_emails', []));
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

    public static function create(string $email, string $nick, string $pw, string $role = ''): array
    {
        $now = Clock::ms();
        // F2 (CONTRACT §15.7 #6): a new account is always a plain user unless the caller is the installer's first-admin
        // path (which passes $role = 'admin'). No promotion by e-mail (security.admin_emails) — see Auth::attemptLogin.
        if ($role !== 'admin') $role = 'user';
        $id = Db::insert('users', [
            'email' => mb_strtolower($email), 'nickname' => $nick, 'nickname_key' => mb_strtolower($nick),
            'password_hash' => self::hashPassword($pw), 'role' => $role, 'status' => 'active', 'muted_until' => 0,
            'session_epoch' => 0, 'created_at' => $now, 'updated_at' => $now, 'last_login_at' => $now,
            'last_login_ip' => substr(Http::clientIp(), 0, 64), 'password_changed_at' => $now,
        ]);
        Db::insert('user_profiles', ['user_id' => $id, 'level' => 1, 'exp_total' => 0, 'coin' => 0, 'edu' => 0, 'title' => '', 'updated_at' => $now]);
        $u = self::byId($id);
        if (!$u) throw new \RuntimeException('user insert failed');
        return $u;
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
