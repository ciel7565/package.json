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
    /**
     * [entitle] CONTRACT §17.2 — the default administrator a fresh install gets unless the installer is given other
     * values. The password is deliberately public and weak (the owner asked for exactly this pair): it is a STATE, not a
     * secret — users.pw_default = 1 marks it, every admin page then shows a red banner with the change form, the
     * health check has a failing row and the app reminds that administrator. It can never be chosen again (WEAK list).
     */
    public const DEFAULT_ADMIN_ID = 'admin';
    public const DEFAULT_ADMIN_PASSWORD = 'admin1234';
    public const DEFAULT_ADMIN_NICKNAME = '관리자';
    /** the placeholder mail host of an administrator made without an address (RFC 2606: ".invalid" never exists) */
    public const LOCAL_MAIL_HOST = 'local.invalid';
    /** the settings row that says whether this database may still get its default administrator (pending | done) */
    public const DEFAULT_ADMIN_MARK = 'site.default_admin';
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

    /**
     * @param bool $staff true for the installer's administrator: only it may carry the placeholder host ".invalid"
     *                    (an address that cannot exist — a visitor who registered admin@local.invalid first would
     *                    otherwise keep the default administrator from being created)
     */
    public static function validEmail(string $email, bool $staff = false): ?string
    {
        if ($email === '') return '이메일을 입력해 주세요.';
        if (strlen($email) > 120 || !filter_var($email, FILTER_VALIDATE_EMAIL) || !preg_match('/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/', $email)) {
            return '이메일 형식이 올바르지 않아요. (예: name@example.com)';
        }
        if (!$staff && preg_match('/\.invalid$/i', $email)) return '이메일 형식이 올바르지 않아요. (예: name@example.com)'; // [entitle]
        return null;
    }

    /** [entitle] CONTRACT §17.2: a login id is 3–20 of a-z 0-9 _ (lower case); null = fine */
    public static function validLoginId(string $id): ?string
    {
        if ($id === '') return '로그인 아이디를 입력해 주세요.';
        if (!preg_match('/^[a-z0-9_]{3,20}$/', $id)) return '로그인 아이디는 영어 소문자·숫자·밑줄(_)로 3~20자예요.';
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
    /** [entitle] the account with this login id (users.login_id, v8); anything that is not shaped like one finds nothing */
    public static function byLoginId(string $id): ?array
    {
        $id = mb_strtolower(trim($id));
        return preg_match('/^[a-z0-9_]{3,20}$/', $id) ? Db::one('SELECT * FROM users WHERE login_id = ?', [$id]) : null;
    }
    /**
     * What the login form accepts: an e-mail address, a login id (CONTRACT §17.2) or a nickname. The id is tried before
     * the nickname; registration refuses a nickname that is somebody's login id, so the two never name different people.
     */
    public static function byLogin(string $login): ?array
    {
        if (Str::contains($login, '@')) return self::byEmail($login);
        $u = self::byLoginId($login);
        return $u ? $u : self::byNickname($login);
    }

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

    /**
     * @param string|null $loginId   [entitle] users.login_id (the installer's administrator; null for everyone else)
     * @param bool        $pwDefault [entitle] users.pw_default = 1: $pw is the default administrator password
     */
    public static function create(string $email, string $nick, string $pw, string $role = '', ?string $loginId = null, bool $pwDefault = false): array
    {
        $now = Clock::ms();
        // F2 (CONTRACT §15.7 #6): a new account is always a plain user unless the caller is the installer's first-admin
        // path (which passes $role = 'admin'). No promotion by e-mail (security.admin_emails) — see Auth::attemptLogin.
        if ($role !== 'admin') $role = 'user';
        $row = [
            'email' => mb_strtolower($email), 'nickname' => $nick, 'nickname_key' => mb_strtolower($nick),
            'password_hash' => self::hashPassword($pw), 'role' => $role, 'status' => 'active', 'muted_until' => 0,
            'session_epoch' => 0, 'created_at' => $now, 'updated_at' => $now, 'last_login_at' => $now,
            'last_login_ip' => substr(Http::clientIp(), 0, 64), 'password_changed_at' => $now,
        ];
        if ($loginId !== null && $loginId !== '') $row['login_id'] = mb_strtolower($loginId); // [entitle]
        if ($pwDefault) $row['pw_default'] = 1;                                                // [entitle]
        $id = Db::insert('users', $row);
        Db::insert('user_profiles', ['user_id' => $id, 'level' => 1, 'exp_total' => 0, 'coin' => 0, 'edu' => 0, 'title' => '', 'updated_at' => $now]);
        $u = self::byId($id);
        if (!$u) throw new \RuntimeException('user insert failed');
        return $u;
    }

    /** change role/status and sign the user out of every session (epoch bump) */
    public static function update(int $id, array $fields, bool $bumpEpoch = false): void
    {
        $allowed = ['role', 'status', 'muted_until', 'nickname', 'nickname_key', 'password_hash', 'password_changed_at', 'last_login_at', 'last_login_ip',
            'login_id', 'pw_default', 'email']; // [entitle] the account form of the admin site, the installer
        // [entitle] CONTRACT §17.2: whoever stores a new password (the account form, the app, cli reset-password) ends the
        // "default password still in use" state — unless the caller sets the flag itself (the installer)
        if (array_key_exists('password_hash', $fields) && !array_key_exists('pw_default', $fields)) $fields['pw_default'] = 0;
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
        // [scale-server] CONTRACT §16.9: the cached account row goes at once, and with a change of status / role /
        // password / name / chat pause or a session-epoch bump the account's sync seat ends too — a ban, a role change,
        // a new password, a pause and "sign out everywhere" reach the very next request
        if (class_exists('Tfm\\Auth')) Auth::forgetUser($id, $bumpEpoch || isset($fields['status']) || isset($fields['role']) || isset($fields['password_hash']) || isset($fields['nickname']) || isset($fields['muted_until']));
    }

    // ================================================================== [entitle] CONTRACT §17.2
    /** is there an administrator account at all (any status)? */
    public static function adminAny(): bool { return (int) Db::value("SELECT COUNT(*) FROM users WHERE role = 'admin'") > 0; }

    /** how many administrators still use the default password (health check, banner) */
    public static function defaultPasswordCount(): int
    {
        try { return (int) Db::value("SELECT COUNT(*) FROM users WHERE role = 'admin' AND pw_default = 1"); }
        catch (\PDOException $e) { return 0; } // a database older than v8
    }

    /** pending | done | '' (a database that was not born with v8: it never gets a default administrator by itself) */
    public static function defaultAdminState(): string
    {
        $v = class_exists('Tfm\\Settings') ? Settings::get(self::DEFAULT_ADMIN_MARK, '') : '';
        return $v === 'pending' || $v === 'done' ? $v : '';
    }

    public static function markDefaultAdmin(string $state): void
    {
        Db::upsert('settings', ['k' => self::DEFAULT_ADMIN_MARK, 'v' => (string) json_encode($state === 'pending' ? 'pending' : 'done'), 'updated_at' => Clock::ms(), 'updated_by' => null], ['k']);
        if (class_exists('Tfm\\Settings')) Settings::reset();
    }

    /**
     * Create the default administrator (login id + the default password, pw_default = 1). $loginId: another id than
     * "admin" when the installer was given one. The address is a placeholder (<id>@local.invalid) and the nickname
     * 관리자 (a reserved name only staff may carry; a number is added when it is taken).
     */
    public static function createDefaultAdmin(?string $loginId = null, ?string $email = null, ?string $nick = null): array
    {
        $id = $loginId !== null && $loginId !== '' ? mb_strtolower($loginId) : self::DEFAULT_ADMIN_ID;
        if ($e = self::validLoginId($id)) throw new ApiException(400, 'ADMIN_LOGIN', '관리자 아이디: ' . $e);
        if (self::byLoginId($id)) throw new ApiException(409, 'LOGIN_ID_TAKEN', '그 로그인 아이디는 이미 다른 계정이 쓰고 있어요.');
        if ($email === null || $email === '') $email = $id . '@' . self::LOCAL_MAIL_HOST;
        if ($nick === null || $nick === '') {
            $nick = self::DEFAULT_ADMIN_NICKNAME;
            for ($i = 0; $i < 20 && self::byNickname($nick); $i++) $nick = self::DEFAULT_ADMIN_NICKNAME . random_int(10, 9999);
        }
        return self::create($email, $nick, self::DEFAULT_ADMIN_PASSWORD, 'admin', $id, true);
    }

    /**
     * The first-run seed (CONTRACT §17.2): a database that was BORN with schema v8 or later carries the marker
     * site.default_admin = "pending" (Db::migrate writes it once, into an empty database — an existing site that is
     * upgraded never gets it). While the marker is pending and no administrator exists, the default administrator is
     * created the moment somebody signs in with the default id — so `admin` / `admin1234` works on a fresh server
     * without the installer, and nothing exists before that. The installer, `cli promote` and the setup-code flow end
     * the pending state as soon as an administrator exists. security.default_admin = false switches the seed off.
     * Called by the sign-in entry points right before Auth::attemptLogin; never throws.
     */
    public static function ensureDefaultAdmin(string $login): void
    {
        if (mb_strtolower(trim($login)) !== self::DEFAULT_ADMIN_ID) return;
        try {
            if (!Config::get('security.default_admin', true) || self::defaultAdminState() !== 'pending') return;
            $made = Db::tx(function () {
                if (self::adminAny() || self::byLoginId(self::DEFAULT_ADMIN_ID)) { self::markDefaultAdmin('done'); return null; }
                $u = self::createDefaultAdmin();
                self::markDefaultAdmin('done');
                return $u;
            });
            if ($made) {
                Audit::log('default_admin_created', (int) $made['id'], ['via' => 'first sign-in'], 'alert');
                Log::security('AUTH', 'the default administrator was created at the first sign-in with the default id; its password must be changed', ['uid' => (int) $made['id']]);
            }
        } catch (\Throwable $e) {
            Log::warn('AUTH', 'default administrator not created: ' . get_class($e));
        }
    }

    /**
     * The current password of a logged-in account, checked with the shared login throttle (wrong tries lock like the
     * sign-in form: 429 TOO_MANY_ATTEMPTS; a wrong one: 401 INVALID_CREDENTIALS). Used before a password change.
     */
    public static function confirmPassword(array $user, string $pw): void
    {
        $key = mb_strtolower((string) ((string) $user['email'] !== '' ? $user['email'] : $user['nickname']));
        $wait = LoginThrottle::check($key);
        if ($wait > 0) throw new ApiException(429, 'TOO_MANY_ATTEMPTS', "비밀번호를 여러 번 틀렸어요. {$wait}초 뒤에 다시 해 주세요.", ['retryAfter' => $wait], ['Retry-After: ' . $wait]);
        $full = self::byId((int) $user['id']); // with the hash (an API request's cached row has none)
        if ($pw === '' || strlen($pw) > 512 || !$full || !self::verifyPassword($full, $pw)) {
            LoginThrottle::record($key, false);
            throw new ApiException(401, 'INVALID_CREDENTIALS', '지금 쓰는 비밀번호가 맞지 않아요.', ['field' => 'current']);
        }
    }

    /**
     * Change an account's password (CONTRACT §17.2): the normal policy applies to the new one (so the default password
     * can never come back), it must differ from the present one, EVERY session of the account ends (session_epoch + 1 —
     * the caller keeps its own alive with Session::refresh on the returned row), pw_default is cleared and the change is
     * audited (never a password in the detail). Returns the fresh users row.
     */
    public static function changePassword(array $user, string $new, string $via, ?int $actorId = null): array
    {
        $uid = (int) $user['id'];
        $full = self::byId($uid);
        if (!$full) throw new ApiException(404, 'NOT_FOUND', '계정을 찾을 수 없어요.');
        if ($e = self::validPassword($new, (string) $full['email'], (string) $full['nickname'])) throw new ApiException(400, 'WEAK_PASSWORD', $e, ['field' => 'password']);
        $lid = isset($full['login_id']) ? (string) $full['login_id'] : '';
        if ($lid !== '' && mb_strlen($lid) >= 4 && Str::contains(mb_strtolower($new), $lid)) throw new ApiException(400, 'WEAK_PASSWORD', '비밀번호에 로그인 아이디를 넣지 말아 주세요.', ['field' => 'password']);
        if (password_verify($new, (string) $full['password_hash'])) throw new ApiException(400, 'SAME_PASSWORD', '지금 쓰는 비밀번호와 다른 비밀번호로 바꿔 주세요.', ['field' => 'password']);
        $wasDefault = !empty($full['pw_default']);
        self::update($uid, ['password_hash' => self::hashPassword($new), 'password_changed_at' => Clock::ms(), 'pw_default' => 0], true);
        Audit::log('password_changed', $uid, ['via' => mb_substr($via, 0, 24), 'wasDefault' => $wasDefault], 'warn', $actorId ? $actorId : $uid);
        $fresh = self::byId($uid);
        if (!$fresh) throw new \RuntimeException('user vanished');
        return $fresh;
    }
}
