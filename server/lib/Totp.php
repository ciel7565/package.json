<?php
/**
 * 2-step sign-in for the admin site (CONTRACT §15.4 (c), security item 6).
 *
 *   Totp       RFC 6238 time-based one-time codes: HMAC-SHA1, 30-second steps, 6 digits (what every phone
 *              authenticator app makes), base32 secrets (RFC 4648), ±1 step of clock drift, a replay floor
 *              (the last accepted step), constant-time comparison, the otpauth:// enrolment URI.
 *   AdminTotp  the enrolment of one admin account in admin_totp: the secret sealed with Crypto ("enc:v1:"), a
 *              confirmation with a current code, replay protection through last_step, 10 one-time backup codes
 *              stored as password_hash()es, the wrong-code lock (admin_2fa_fail rows of audit_log — a correct
 *              password never clears it, only a correct code does), reset / disable, the list for the 🛡️ tab.
 *
 * Mode security.admin_2fa (env TFM_ADMIN_2FA): off | optional (default) | required.
 * The wrong-code lock has its own numbers, security.admin_2fa_lock (not the password throttle's login.*: someone who
 * knows the password passes that one every time): 4 wrong codes are free, from the 5th the code step is locked for
 * 1 minute doubling with every further one up to 1 day, and the count is kept for 30 days unless a correct code comes
 * in — about 15 codes in the first day, then 1 a day (the password throttle's numbers let ~600 a day through).
 * PHP 7.2 syntax only.
 */
declare(strict_types=1);

namespace Tfm;

if (!defined('TFM_BOOT')) { if (function_exists('header_remove')) header_remove('X-Powered-By'); http_response_code(404); exit; }

final class Totp
{
    public const DIGITS = 6;
    public const PERIOD = 30;
    private const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

    /** a new secret: base32 of 20 random bytes (160 bits, the RFC 4226 recommendation) — 32 characters */
    public static function secret(): string
    {
        return self::base32Encode(random_bytes(20));
    }

    /** RFC 4648 base32 without padding */
    public static function base32Encode(string $raw): string
    {
        $out = '';
        $bits = 0;
        $val = 0;
        $n = strlen($raw);
        for ($i = 0; $i < $n; $i++) {
            $val = ($val << 8) | ord($raw[$i]);
            $bits += 8;
            while ($bits >= 5) {
                $bits -= 5;
                $out .= self::B32[($val >> $bits) & 31];
            }
            $val &= (1 << $bits) - 1;
        }
        if ($bits > 0) $out .= self::B32[($val << (5 - $bits)) & 31];
        return $out;
    }

    /**
     * base32 → bytes; lower case, spaces, dashes and '=' padding are accepted (people type secrets by hand).
     * null when another character is in it.
     */
    public static function base32Decode(string $b32): ?string
    {
        $s = strtoupper((string) preg_replace('/[\s\-=]+/', '', $b32));
        if ($s === '') return '';
        if (strspn($s, self::B32) !== strlen($s)) return null;
        $out = '';
        $bits = 0;
        $val = 0;
        $n = strlen($s);
        for ($i = 0; $i < $n; $i++) {
            $val = ($val << 5) | strpos(self::B32, $s[$i]);
            $bits += 5;
            if ($bits >= 8) {
                $bits -= 8;
                $out .= chr(($val >> $bits) & 255);
            }
            $val &= (1 << $bits) - 1;
        }
        return $out;
    }

    /** the code of one time step for a raw key (RFC 4226 dynamic truncation) */
    private static function at(string $key, int $step): string
    {
        $h = hash_hmac('sha1', pack('J', $step), $key, true);
        $o = ord($h[19]) & 15;
        $n = ((ord($h[$o]) & 127) << 24) | (ord($h[$o + 1]) << 16) | (ord($h[$o + 2]) << 8) | ord($h[$o + 3]);
        return str_pad((string) ($n % 1000000), self::DIGITS, '0', STR_PAD_LEFT);
    }

    /** the code for a base32 secret at $time (unix seconds, default now); '' for an unusable secret (never a constant) */
    public static function code(string $secret, ?int $time = null): string
    {
        $key = self::base32Decode($secret);
        if ($key === null || $key === '') return '';
        $t = $time === null ? time() : $time;
        if ($t < 0) return '';
        return self::at($key, intdiv($t, self::PERIOD));
    }

    /**
     * Is $code the code of a step within ±$window steps of $time? $step is the replay floor going in (the last step
     * that was accepted for this secret; 0 = none) and the step that matched coming out — only a step AFTER the floor
     * is accepted, so a code works once. Spaces between the digits are fine; anything but 6 digits is refused. Every
     * step of the window is compared (constant time). A refusal leaves $step as it was.
     */
    public static function verify(string $secret, string $code, int &$step, int $window = 1, ?int $time = null): bool
    {
        $c = (string) preg_replace('/[ \t]+/', '', $code);
        if (!preg_match('/^[0-9]{6}\z/', $c)) return false;
        $key = self::base32Decode($secret);
        if ($key === null || $key === '') return false;
        $t = $time === null ? time() : $time;
        $now = intdiv(max(0, $t), self::PERIOD);
        $window = max(0, min(10, $window));
        $floor = $step;
        $found = -1;
        for ($i = -$window; $i <= $window; $i++) {
            $s = $now + $i;
            if ($s < 0) continue;
            $same = hash_equals(self::at($key, $s), $c);
            if ($same && $s > $floor && $found < 0) $found = $s;
        }
        if ($found < 0) return false;
        $step = $found;
        return true;
    }

    /** otpauth://totp/Issuer:account?secret=…&issuer=…&algorithm=SHA1&digits=6&period=30 (the label percent-encoded) */
    public static function uri(string $secret, string $account, string $issuer): string
    {
        $label = rawurlencode($issuer) . ':' . rawurlencode($account);
        $q = http_build_query(['secret' => $secret, 'issuer' => $issuer, 'algorithm' => 'SHA1', 'digits' => self::DIGITS, 'period' => self::PERIOD], '', '&', PHP_QUERY_RFC3986);
        return 'otpauth://totp/' . $label . '?' . $q;
    }

    /** ABCD EFGH … — the secret in groups of four, for reading it off the screen into the phone */
    public static function grouped(string $secret): string
    {
        return implode(' ', str_split($secret, 4));
    }
}

final class AdminTotp
{
    public const BACKUP_COUNT = 10;
    /** backup code letters: no 0 o 1 l i (look-alikes) */
    public const BACKUP_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
    /** audit events after which the wrong-code count starts again (admin_2fa_unlocked: cli admin:2fa-unlock) */
    private const RESET_EVENTS = "'admin_2fa_ok', 'admin_2fa_enrolled', 'admin_2fa_reset', 'admin_2fa_disabled', 'admin_2fa_unlocked'";
    /** the wrong-code lock when security.admin_2fa_lock does not say otherwise (see lockPolicy()) */
    private const LOCK_DEFAULTS = ['free' => 5, 'base' => 60, 'max' => 86400, 'memory' => 2592000];

    /** security.admin_2fa: off | optional | required — anything else means optional */
    public static function mode(): string
    {
        $m = strtolower(trim((string) Config::get('security.admin_2fa', 'optional')));
        return in_array($m, ['off', 'optional', 'required'], true) ? $m : 'optional';
    }

    private static function row(int $uid): ?array
    {
        return $uid > 0 ? Db::one('SELECT user_id, secret_enc, enabled, confirmed_at, backup_codes, last_step, updated_at FROM admin_totp WHERE user_id = ?', [$uid]) : null;
    }

    /** the stored backup code hashes of a row */
    private static function hashes(array $row): array
    {
        $v = Json::tryDecode((string) (isset($row['backup_codes']) ? $row['backup_codes'] : ''), true);
        if (!is_array($v)) return [];
        $out = [];
        foreach ($v as $h) if (is_string($h) && $h !== '') $out[] = $h;
        return $out;
    }

    private static function sealOrFail(string $secret): string
    {
        if (!class_exists('Tfm\Crypto') || !Crypto::available()) {
            throw new ApiException(500, 'TWOFA_CRYPTO', '이 서버에서는 2단계 인증 비밀 키를 안전하게 보관할 수 없어요. PHP 의 openssl 확장을 켜 주세요.');
        }
        return Crypto::seal($secret);
    }

    private static function open(array $row): ?string
    {
        $v = (string) $row['secret_enc'];
        if ($v === '' || !class_exists('Tfm\Crypto')) return null;
        return Crypto::open($v);
    }

    /** 2-step sign-in is on for this account */
    public static function enabled(int $uid): bool
    {
        $r = self::row($uid);
        return $r !== null && (int) $r['enabled'] === 1;
    }

    /**
     * Start (or restart) an enrolment: a new secret, stored sealed and not yet enabled. Asking again before the
     * confirmation replaces the secret. 409 TWOFA_ALREADY while 2-step sign-in is on (turn it off first).
     */
    public static function begin(int $uid): string
    {
        if ($uid <= 0) throw new ApiException(400, 'TWOFA_USER', '계정을 찾을 수 없어요.');
        $secret = Totp::secret();
        $sealed = self::sealOrFail($secret);
        Db::tx(function () use ($uid, $sealed) {
            $cur = Db::one('SELECT enabled FROM admin_totp WHERE user_id = ?' . Db::forUpdate(), [$uid]);
            if ($cur && (int) $cur['enabled'] === 1) throw new ApiException(409, 'TWOFA_ALREADY', '2단계 인증이 이미 켜져 있어요.');
            Db::upsert('admin_totp', ['user_id' => $uid, 'secret_enc' => $sealed, 'enabled' => 0, 'confirmed_at' => 0, 'backup_codes' => '[]',
                'last_step' => 0, 'updated_at' => Clock::ms()], ['user_id']);
        });
        return $secret;
    }

    /** the secret of an enrolment that waits for its confirmation (null: none, or 2-step sign-in is already on) */
    public static function pendingSecret(int $uid): ?string
    {
        $r = self::row($uid);
        if ($r === null || (int) $r['enabled'] === 1) return null;
        return self::open($r);
    }

    /** 10 new backup codes: [plain codes "abcd-efgh" (shown once), password hashes (stored)] */
    private static function newBackupCodes(): array
    {
        $plain = [];
        $hashes = [];
        $n = strlen(self::BACKUP_ALPHABET);
        while (count($plain) < self::BACKUP_COUNT) {
            $c = '';
            for ($i = 0; $i < 8; $i++) $c .= self::BACKUP_ALPHABET[random_int(0, $n - 1)];
            $show = substr($c, 0, 4) . '-' . substr($c, 4);
            if (in_array($show, $plain, true)) continue;
            $plain[] = $show;
            $hashes[] = password_hash($c, PASSWORD_DEFAULT);
        }
        return [$plain, $hashes];
    }

    /**
     * Confirm the enrolment with a current code: 2-step sign-in is on from now, the code's step becomes the replay
     * floor, and the 10 backup codes come back — the only time they are ever readable. 400 TWOFA_CODE for a wrong code
     * (nothing changes), 409 TWOFA_NONE when there is no enrolment waiting.
     */
    public static function confirm(int $uid, string $code, ?int $time = null): array
    {
        $r = self::row($uid);
        if ($r === null || (int) $r['enabled'] === 1 || (string) $r['secret_enc'] === '') {
            throw new ApiException(409, 'TWOFA_NONE', '먼저 "2단계 인증 켜기"를 눌러 새 비밀 키를 받아 주세요.');
        }
        $secret = self::open($r);
        if ($secret === null) throw new ApiException(500, 'TWOFA_SEAL', '저장된 비밀 키를 열지 못했어요. "새 비밀 키 받기"로 다시 시작해 주세요.');
        $step = 0;
        if (!Totp::verify($secret, $code, $step, 1, $time)) {
            throw new ApiException(400, 'TWOFA_CODE', '코드가 맞지 않아요. 인증 앱에 지금 보이는 숫자 6자리를 넣어 주세요. (휴대폰 시계가 맞는지도 확인해 주세요.)');
        }
        $codes = self::newBackupCodes();
        $now = Clock::ms();
        $n = Db::exec('UPDATE admin_totp SET enabled = 1, confirmed_at = ?, last_step = ?, backup_codes = ?, updated_at = ? WHERE user_id = ? AND enabled = 0 AND secret_enc = ?',
            [$now, $step, Json::encode($codes[1]), $now, $uid, (string) $r['secret_enc']]);
        if ($n !== 1) throw new ApiException(409, 'TWOFA_CHANGED', '그 사이에 비밀 키가 바뀌었어요. 화면을 새로 고친 뒤 다시 해 주세요.');
        Audit::log('admin_2fa_enrolled', $uid, [], 'warn', $uid);
        return $codes[0];
    }

    /** unused backup codes left (0 when 2-step sign-in is off) */
    public static function backupLeft(int $uid): int
    {
        $r = self::row($uid);
        return $r !== null && (int) $r['enabled'] === 1 ? count(self::hashes($r)) : 0;
    }

    /**
     * The numbers of the wrong-code lock, security.admin_2fa_lock: free = the wrong code that starts the lock (5),
     * base = its first lock in seconds (60), max = the longest lock (86400 = 1 day), memory = how long a wrong code is
     * counted when no correct code follows (2592000 = 30 days). A value that is missing, not a number or out of range
     * (free 1–10, base 30 s–1 day, max 30 s–7 days and never below base, memory 1–365 days) is the default. The memory
     * never ends before the escalation does: it lasts at least (wrong codes needed to reach max + 1) × max, so wrong
     * codes cannot age out faster than the lock grows (with the password throttle's 900 s window they did, and the lock
     * kept falling back to 30 s).
     */
    public static function lockPolicy(): array
    {
        $c = Config::get('security.admin_2fa_lock', []);
        if (!is_array($c)) $c = [];
        $pick = function (string $k, int $min, int $max) use ($c): int {
            $v = isset($c[$k]) && (is_int($c[$k]) || (is_string($c[$k]) && ctype_digit($c[$k]))) ? (int) $c[$k] : -1;
            return $v >= $min && $v <= $max ? $v : self::LOCK_DEFAULTS[$k];
        };
        $p = ['free' => $pick('free', 1, 10), 'base' => $pick('base', 30, 86400), 'max' => $pick('max', 30, 604800), 'memory' => $pick('memory', 86400, 31536000)];
        if ($p['max'] < $p['base']) $p['max'] = $p['base'];
        $steps = 0;
        for ($lock = $p['base']; $lock < $p['max']; $lock *= 2) $steps++;
        $p['memory'] = min(31536000, max($p['memory'], ($p['free'] + $steps + 1) * $p['max']));
        return $p;
    }

    /** how long the code step stays locked after the n-th counted wrong code: 0 before `free`, then base × 2^(n − free), at most max */
    public static function lockSeconds(int $n, ?array $policy = null): int
    {
        $p = $policy !== null ? $policy : self::lockPolicy();
        if ($n < $p['free']) return 0;
        $lock = $p['base'];
        for ($i = $n - $p['free']; $i > 0 && $lock < $p['max']; $i--) $lock *= 2; // a loop, never 2 ** n: no int overflow on 32-bit PHP
        return min($p['max'], $lock);
    }

    /**
     * The wrong-code count of the code step: admin_2fa_fail rows of this account since its last correct code (or
     * enrolment / reset / unlock), at most `memory` old. From the `free`-th on the step stays locked for lockSeconds(n)
     * after the last wrong code. ['count' => n, 'wait' => seconds to wait].
     */
    public static function failures(int $uid): array
    {
        $p = self::lockPolicy();
        $now = Clock::ms();
        $since = (int) Db::value('SELECT MAX(id) FROM audit_log WHERE user_id = ? AND event IN (' . self::RESET_EVENTS . ')', [$uid]);
        $row = Db::one("SELECT COUNT(*) AS n, MAX(created_at) AS last_at FROM audit_log WHERE user_id = ? AND event = 'admin_2fa_fail' AND id > ? AND created_at > ?",
            [$uid, $since, $now - $p['memory'] * 1000]);
        $n = $row ? (int) $row['n'] : 0;
        $wait = 0;
        if ($n >= $p['free']) {
            $wait = max(0, (int) ceil(((int) $row['last_at'] + self::lockSeconds($n, $p) * 1000 - $now) / 1000));
        }
        return ['count' => $n, 'wait' => $wait];
    }

    /**
     * Lift the wrong-code lock on the server PC (cli admin:2fa-unlock): the count starts again, the enrolment and the
     * backup codes stay. true when wrong codes were counted, false when there was nothing to lift.
     */
    public static function unlock(int $uid, ?int $actorId = null): bool
    {
        $f = self::failures($uid);
        if ($f['count'] === 0) return false;
        Audit::log('admin_2fa_unlocked', $uid, ['count' => $f['count'], 'wait' => $f['wait'], 'via' => PHP_SAPI === 'cli' ? 'cli' : 'web'], 'warn', $actorId);
        return true;
    }

    /** a wait in plain words, never shorter than it is: "40초", "3분", "2시간 15분", "1일 3시간" */
    public static function waitText(int $seconds): string
    {
        $s = max(1, $seconds);
        if ($s < 60) return $s . '초';
        $m = intdiv($s + 59, 60);
        if ($m < 60) return $m . '분';
        $h = intdiv($m, 60);
        if ($h < 24) return $h . '시간' . ($m % 60 > 0 ? ' ' . ($m % 60) . '분' : '');
        return intdiv($h, 24) . '일' . ($h % 24 > 0 ? ' ' . ($h % 24) . '시간' : '');
    }

    /** a wrong code: the audit row the lock counts, the security event, the automatic-block counter */
    private static function failed(int $uid, string $via): void
    {
        Audit::log('admin_2fa_fail', $uid, ['via' => $via], 'warn');
        if (class_exists('Tfm\SecEvent')) SecEvent::log('admin_2fa_fail', 'warn', ['via' => $via], $uid);
        if (class_exists('Tfm\Firewall')) Firewall::noteAttack('admin_2fa_fail');
    }

    /**
     * The second step of a sign-in: 'totp' (a current code, never one at or before the last accepted step), 'backup'
     * (an unused backup code, typed with or without the dash, any case — used up now), 'fail' (counted), or 'locked'
     * (too many wrong codes: nothing is checked and nothing is used up until the wait is over).
     */
    public static function attempt(int $uid, string $code, ?int $time = null): string
    {
        if (self::failures($uid)['wait'] > 0) return 'locked';
        $r = self::row($uid);
        if ($r === null || (int) $r['enabled'] !== 1) { self::failed($uid, 'not_enrolled'); return 'fail'; }
        $raw = trim($code);
        $digits = (string) preg_replace('/[ \t]+/', '', $raw);
        if (preg_match('/^[0-9]{6}\z/', $digits)) {
            $secret = self::open($r);
            $step = (int) $r['last_step'];
            if ($secret !== null && Totp::verify($secret, $digits, $step, 1, $time)) {
                // the replay floor moves in one statement: of two requests with the same code only one gets the step
                if (Db::exec('UPDATE admin_totp SET last_step = ?, updated_at = ? WHERE user_id = ? AND enabled = 1 AND last_step < ?', [$step, Clock::ms(), $uid, $step]) === 1) {
                    Audit::log('admin_2fa_ok', $uid, ['via' => 'totp'], 'info');
                    return 'totp';
                }
            }
            self::failed($uid, 'totp');
            return 'fail';
        }
        $b = strtolower((string) preg_replace('/[\s\-]+/', '', $raw));
        if (preg_match('/^[a-z0-9]{8}\z/', $b)) {
            $hit = null;
            foreach (self::hashes($r) as $h) {           // every hash is checked: the time does not tell which one matched
                if (password_verify($b, $h) && $hit === null) $hit = $h;
            }
            if ($hit !== null) {
                $used = Db::tx(function () use ($uid, $hit) {
                    $cur = Db::one('SELECT backup_codes FROM admin_totp WHERE user_id = ? AND enabled = 1' . Db::forUpdate(), [$uid]);
                    if (!$cur) return false;
                    $list = self::hashes($cur);
                    $i = array_search($hit, $list, true);
                    if ($i === false) return false;  // a parallel request used it a moment ago
                    array_splice($list, (int) $i, 1);
                    Db::exec('UPDATE admin_totp SET backup_codes = ?, updated_at = ? WHERE user_id = ?', [Json::encode(array_values($list)), Clock::ms(), $uid]);
                    return true;
                });
                if ($used) {
                    Audit::log('admin_2fa_ok', $uid, ['via' => 'backup'], 'warn');
                    return 'backup';
                }
            }
            self::failed($uid, 'backup');
            return 'fail';
        }
        self::failed($uid, 'format');
        return 'fail';
    }

    /** 10 new backup codes; the old ones stop working (the caller checked the password + a current code) */
    public static function regenerateBackup(int $uid, ?int $actorId = null): array
    {
        if (!self::enabled($uid)) throw new ApiException(409, 'TWOFA_NONE', '2단계 인증이 꺼져 있어요.');
        $codes = self::newBackupCodes();
        Db::exec('UPDATE admin_totp SET backup_codes = ?, updated_at = ? WHERE user_id = ? AND enabled = 1', [Json::encode($codes[1]), Clock::ms(), $uid]);
        Audit::log('admin_2fa_backup', $uid, [], 'warn', $actorId !== null ? $actorId : $uid);
        return $codes[0];
    }

    /** turn 2-step sign-in off for the account (the caller checked the password + a current code) */
    public static function disable(int $uid, ?int $actorId = null): void
    {
        if (Db::exec('DELETE FROM admin_totp WHERE user_id = ?', [$uid]) > 0) {
            Audit::log('admin_2fa_disabled', $uid, [], 'warn', $actorId !== null ? $actorId : $uid);
        }
    }

    /** recovery on the server PC (cli admin:2fa-reset): true when an enrolment was removed, false when there was none */
    public static function reset(int $uid, ?int $actorId = null): bool
    {
        if (Db::exec('DELETE FROM admin_totp WHERE user_id = ?', [$uid]) === 0) return false;
        Audit::log('admin_2fa_reset', $uid, ['via' => PHP_SAPI === 'cli' ? 'cli' : 'web'], 'alert', $actorId);
        return true;
    }

    /** every admin account with its 2-step state: id, nickname, email, status, enabled, pending, backupLeft, confirmedAt */
    public static function admins(): array
    {
        $out = [];
        foreach (Db::all("SELECT u.id, u.nickname, u.email, u.status, t.enabled, t.backup_codes, t.confirmed_at, t.user_id AS t_uid
                            FROM users u LEFT JOIN admin_totp t ON t.user_id = u.id WHERE u.role = 'admin' ORDER BY u.id") as $r) {
            $on = $r['t_uid'] !== null && (int) $r['enabled'] === 1;
            $out[] = [
                'id' => (int) $r['id'], 'nickname' => (string) $r['nickname'], 'email' => (string) $r['email'], 'status' => (string) $r['status'],
                'enabled' => $on, 'pending' => $r['t_uid'] !== null && !$on, 'backupLeft' => $on ? count(self::hashes($r)) : 0,
                'confirmedAt' => $on ? (int) $r['confirmed_at'] : 0,
            ];
        }
        return $out;
    }

    /** ['enrolled' => active admins with 2-step sign-in on, 'admins' => active admins] */
    public static function enrolledCount(): array
    {
        $e = 0;
        $a = 0;
        foreach (self::admins() as $r) {
            if ($r['status'] !== 'active') continue;
            $a++;
            if ($r['enabled']) $e++;
        }
        return ['enrolled' => $e, 'admins' => $a];
    }
}
