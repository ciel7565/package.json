<?php
/**
 * Sealed values, the secrets file and private files (CONTRACT §15.7 items 1 and 21).
 *
 *   Crypto       seal() / open(): AES-256-GCM through openssl, a new random 12-byte nonce for every value, output
 *                "enc:v1:" + base64(nonce | tag | ciphertext). For secrets that live in database rows
 *                (subscriptions.billing_key, admin_totp.secret_enc): a copied database or backup alone cannot use them.
 *   Secrets      data/secret.php as it is on disk now — read it, add a key, change keys, always under the lock
 *                Config::secret() takes when it creates the file.
 *   PrivateFile  replace a file in one step (temp file + rename) with mode 0600 where the OS has modes.
 *
 * The key is `data_key` (32 random bytes, written as 64 hex characters) in data/secret.php next to app_key. It is
 * created the first time it is needed, so an installation made before this file existed upgrades by itself.
 * While a key change is in progress the old key stays in the file as `data_key_prev` and open() falls back to it.
 * Back up data/secret.php together with the database: without data_key the sealed values cannot be read.
 * PHP 7.2 syntax only; no sodium requirement.
 */
declare(strict_types=1);

namespace Tfm;

if (!defined('TFM_BOOT')) { if (function_exists('header_remove')) header_remove('X-Powered-By'); http_response_code(404); exit; }

final class PrivateFile
{
    /**
     * Replace $file with $content in one step. The temp file ends in .php because everything written through here is
     * a guarded PHP file: a leftover after a crash still prints nothing on a server that ignores .htaccess.
     * Mode 0600. When another account rewrites the file (root on the command line while the web server owns it) the
     * owner is handed back; where that is not possible the previous mode is kept, so the site can still read it.
     */
    public static function write(string $file, string $content): void
    {
        $tmp = dirname($file) . DIRECTORY_SEPARATOR . '.tmp-' . bin2hex(random_bytes(8)) . '.php';
        $prev = is_file($file) ? @stat($file) : false;
        $fh = @fopen($tmp, 'xb');
        if (!$fh) throw new \RuntimeException('cannot write ' . basename($file) . ' (is the folder writable?)');
        @chmod($tmp, 0600); // before the first byte is in the file
        $ok = fwrite($fh, $content) === strlen($content) && fflush($fh);
        fclose($fh);
        if ($ok && is_array($prev)) self::keepOwner($tmp, $prev);
        if ($ok) $ok = self::replace($tmp, $file);
        if (!$ok) {
            @unlink($tmp);
            throw new \RuntimeException('cannot write ' . basename($file) . ' (is the folder writable?)');
        }
        self::forget($file);
    }

    /** mode 0600 for a file that already exists (SQLite database, backups); nothing happens on Windows */
    public static function tighten(string $file): void
    {
        clearstatcache(true, $file);
        $mode = @fileperms($file);
        if ($mode !== false && ($mode & 0077) !== 0) @chmod($file, 0600);
    }

    /** the next read of $file must come from the disk, not from the stat cache or the opcode cache */
    public static function forget(string $file): void
    {
        clearstatcache(true, $file);
        if (function_exists('opcache_invalidate')) @opcache_invalidate($file, true);
    }

    /**
     * What a PHP file that `return`s a value returns — exactly what is on the disk. An opcode cache can hand out the
     * previous version of a file that was rewritten a moment ago (or for good when it is told not to check
     * timestamps); a key read from a stale copy would be generated twice. So an array result is compared with the
     * file text, and when they differ the text is loaded once more through a private copy with a new name, which no
     * cache can know.
     */
    public static function load(string $file)
    {
        self::forget($file);
        $raw = @file_get_contents($file);
        $v = require $file;
        if (!is_string($raw) || (is_array($v) && strpos($raw, 'return ' . var_export($v, true) . ';') !== false)) return $v;
        $copy = dirname($file) . DIRECTORY_SEPARATOR . '.read-' . bin2hex(random_bytes(8)) . '.php';
        if (@file_put_contents($copy, $raw, LOCK_EX) === false) return $v;
        @chmod($copy, 0600);
        try {
            return require $copy;
        } finally {
            @unlink($copy);
        }
    }

    private static function keepOwner(string $tmp, array $prev): void
    {
        $mine = @fileowner($tmp);
        if ($mine === false || $mine === $prev['uid']) return;
        if (@chown($tmp, $prev['uid'])) { @chgrp($tmp, $prev['gid']); return; }
        @chmod($tmp, $prev['mode'] & 0777);
    }

    private static function replace(string $tmp, string $file): bool
    {
        for ($i = 0; $i < 5; $i++) {
            if (@rename($tmp, $file)) return true;
            usleep(40000); // Windows: another request can have the old file open for a moment
        }
        return false;
    }
}

final class Secrets
{
    /** @var array|null */
    private static $cache = null;

    public static function path(): string { return Config::dataDir() . DIRECTORY_SEPARATOR . 'secret.php'; }

    public static function reset(): void { self::$cache = null; }

    /**
     * The secrets as they are in the file. Config::secret() keeps the copy it read first for the whole request, so a
     * key that was added or changed after that is only visible here. $fresh = true reads the file again.
     */
    public static function read(bool $fresh = false): array
    {
        if (self::$cache !== null && !$fresh) return self::$cache;
        $file = self::path();
        if (!is_file($file)) Config::secret('app_key'); // creates the file (app_key, db_file) under the init lock
        return self::$cache = self::load($file);
    }

    private static function load(string $file): array
    {
        $s = PrivateFile::load($file);
        return is_array($s) ? $s : [];
    }

    /** the value of $key; when it is missing it is made with $make() and stored (once, even with parallel requests) */
    public static function ensure(string $key, callable $make): string
    {
        $s = self::read();
        if (isset($s[$key]) && is_string($s[$key]) && $s[$key] !== '') return $s[$key];
        $s = self::update(function (array $cur) use ($key, $make) {
            if (isset($cur[$key]) && is_string($cur[$key]) && $cur[$key] !== '') return $cur; // another request was faster
            $cur[$key] = (string) $make();
            return $cur;
        });
        return (string) $s[$key];
    }

    /** read → $fn(array $current): array → write, under the lock; the file is only rewritten when something changed */
    public static function update(callable $fn): array
    {
        $file = self::path();
        if (!is_file($file)) Config::secret('app_key');
        $lock = @fopen(Config::dataDir() . DIRECTORY_SEPARATOR . '.init.lock', 'c');
        if ($lock) flock($lock, LOCK_EX);
        try {
            $cur = self::load($file);
            $new = $fn($cur);
            if (!is_array($new)) throw new \RuntimeException('a secrets update must return the array');
            if ($new !== $cur) PrivateFile::write($file, self::render($new));
            return self::$cache = $new;
        } finally {
            if ($lock) { flock($lock, LOCK_UN); fclose($lock); }
        }
    }

    private static function render(array $s): string
    {
        return "<?php\n// generated secrets — keep private, do not commit, back up together with the database\n"
            . "if (!defined('TFM_BOOT')) { if (function_exists('header_remove')) header_remove('X-Powered-By'); http_response_code(404); exit; }\nreturn " . var_export($s, true) . ";\n";
    }
}

final class Crypto
{
    public const PREFIX = 'enc:v1:';
    private const CIPHER = 'aes-256-gcm';
    private const NONCE = 12;
    private const TAG = 16;

    /** @var array|null [current key, previous key or null] as raw bytes */
    private static $keys = null;
    /** @var bool|null */
    private static $available = null;

    /** can values be sealed on this server? (openssl with AES-256-GCM; install.php requires openssl) */
    public static function available(): bool
    {
        if (self::$available === null) {
            self::$available = extension_loaded('openssl') && function_exists('openssl_encrypt')
                && in_array(self::CIPHER, array_map('strtolower', openssl_get_cipher_methods()), true);
        }
        return self::$available;
    }

    public static function isSealed(string $v): bool { return strncmp($v, self::PREFIX, strlen(self::PREFIX)) === 0; }

    /** seal $plain with the data key; throws when sealing is not possible (never returns plaintext) */
    public static function seal(string $plain): string
    {
        if (!self::available()) throw new \RuntimeException('the openssl extension (aes-256-gcm) is needed to seal values');
        $keys = self::keys();
        return self::sealWith($plain, $keys[0]);
    }

    /**
     * The plaintext of a sealed value; null when it was changed, cut or sealed with another key.
     * A value without the prefix is legacy plaintext and comes back unchanged.
     */
    public static function open(string $sealed): ?string
    {
        if (!self::isSealed($sealed)) return $sealed;
        if (!self::available()) return null;
        $keys = self::keys();
        $plain = self::openWith($sealed, $keys[0]);
        if ($plain === null && $keys[1] !== null) $plain = self::openWith($sealed, $keys[1]);
        return $plain;
    }

    /** should a stored value be sealed again? (non-empty legacy plaintext, or sealed with the previous key) */
    public static function needsReseal(string $stored): bool
    {
        if ($stored === '' || !self::available()) return false;
        if (!self::isSealed($stored)) return true;
        $keys = self::keys();
        return self::openWith($stored, $keys[0]) === null && $keys[1] !== null && self::openWith($stored, $keys[1]) !== null;
    }

    /** does the sealed form of $plain fit a column of $columnLength characters? (ask before a payment is taken) */
    public static function fits(string $plain, int $columnLength): bool
    {
        return strlen(self::PREFIX) + 4 * (int) ceil((self::NONCE + self::TAG + strlen($plain)) / 3) <= $columnLength;
    }

    /** forget the loaded keys (the secrets file was changed in this process) */
    public static function reset(): void
    {
        self::$keys = null;
        Secrets::reset();
    }

    private static function keys(): array
    {
        if (self::$keys !== null) return self::$keys;
        $cur = Secrets::ensure('data_key', function () { return bin2hex(random_bytes(32)); });
        $s = Secrets::read();
        $prev = isset($s['data_key_prev']) && is_string($s['data_key_prev']) && $s['data_key_prev'] !== '' ? self::derive($s['data_key_prev']) : null;
        return self::$keys = [self::derive($cur), $prev];
    }

    /** 32 key bytes from the stored text: 64 hex characters (what this file writes), base64 of 32 bytes, or a hash of anything else */
    private static function derive(string $stored): string
    {
        if (preg_match('/^[0-9a-fA-F]{64}$/', $stored)) return (string) hex2bin($stored);
        $b = base64_decode($stored, true);
        if (is_string($b) && strlen($b) === 32) return $b;
        return hash('sha256', $stored, true);
    }

    private static function sealWith(string $plain, string $key): string
    {
        $nonce = random_bytes(self::NONCE);
        $tag = '';
        $ct = openssl_encrypt($plain, self::CIPHER, $key, OPENSSL_RAW_DATA, $nonce, $tag, '', self::TAG);
        if (!is_string($ct) || !is_string($tag) || strlen($tag) !== self::TAG) throw new \RuntimeException('sealing failed');
        return self::PREFIX . base64_encode($nonce . $tag . $ct);
    }

    private static function openWith(string $sealed, string $key): ?string
    {
        $bin = base64_decode((string) substr($sealed, strlen(self::PREFIX)), true);
        if (!is_string($bin) || strlen($bin) < self::NONCE + self::TAG) return null;
        $plain = @openssl_decrypt((string) substr($bin, self::NONCE + self::TAG), self::CIPHER, $key, OPENSSL_RAW_DATA, (string) substr($bin, 0, self::NONCE), (string) substr($bin, self::NONCE, self::TAG));
        return is_string($plain) ? $plain : null;
    }
}
