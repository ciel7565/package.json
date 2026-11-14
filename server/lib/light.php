<?php
/**
 * The light start of an entry point (CONTRACT §16.9) — included by lib/bootstrap.php when the entry point defined
 * TFM_LIGHT before including it:
 *
 *   define('TFM_LIGHT', true);
 *   require __DIR__ . '/../lib/bootstrap.php';
 *
 * Only the core (compat, Core, Cache, Gate) is compiled now; every other class of lib/ is loaded the first time it is
 * named. The polling endpoints call a handful of classes, so on a server without an opcode cache a request compiles
 * about 150 KB instead of 1 MB of PHP (measured: 18 ms → 3–4 ms). With an opcode cache the difference is small — turn
 * opcache on anyway (docs/SCALING-KO.md).
 * A class that this list does not know (a library added later) makes the loader fall back to the full set, so a light
 * entry point can never miss a class that the normal bootstrap would have had.
 * PHP 7.2 syntax only.
 */
declare(strict_types=1);

if (!defined('TFM_BOOT')) { if (function_exists('header_remove')) header_remove('X-Powered-By'); http_response_code(404); exit; }

require __DIR__ . '/compat.php';
require __DIR__ . '/Core.php';
require __DIR__ . '/Cache.php';
if (is_file(__DIR__ . '/Gate.php')) require __DIR__ . '/Gate.php';

spl_autoload_register(static function (string $class): void {
    /** class (without the Tfm\ prefix) → library file */
    static $map = [
        'Db' => 'Db', 'Session' => 'Session',
        'Sec' => 'Security', 'RateLimit' => 'Security', 'LoginThrottle' => 'Security', 'Audit' => 'Security',
        'ChatFilter' => 'ChatFilter', 'Retractions' => 'ChatFilter', 'Users' => 'Users',
        'Ctx' => 'Api', 'Api' => 'Api', 'Auth' => 'Api', 'Boot' => 'Api',
        'Presence' => 'Presence', 'GameData' => 'GameData', 'SaveValidator' => 'SaveValidator', 'Upload' => 'Upload',
        'Toss' => 'Toss', 'TossException' => 'Toss', 'Subscription' => 'Subscription',
        'Stats' => 'Admin', 'Health' => 'Admin', 'AdminOps' => 'Admin', 'AdminGate' => 'Admin', 'AdminPath' => 'Admin',
        'Installer' => 'Installer', 'SetupCode' => 'Installer', 'Settings' => 'Settings',
        'PrivateFile' => 'Crypto', 'Crypto' => 'Crypto', 'V' => 'Validator',
        'SecEvent' => 'SecurityEvents', 'Firewall' => 'SecurityEvents', 'ConfigAudit' => 'ConfigAudit',
        'Totp' => 'Totp', 'AdminTotp' => 'Totp', 'Farm' => 'Farm', 'Claude' => 'Claude', 'Markdown' => 'Markdown', 'Inspect' => 'Inspect',
        'Allot' => 'Allot', 'AllotRetry' => 'Allot', 'AdminAllot' => 'AdminAllot',
        'Cache' => 'Cache', 'Gate' => 'Gate', 'Sync' => 'Sync', 'Ranking' => 'Ranking',
    ];
    /** what the normal bootstrap loads up front (the fall-back for a class the map does not know) */
    static $full = ['Db', 'Session', 'Security', 'ChatFilter', 'Users', 'Api', 'Presence', 'GameData', 'SaveValidator', 'Upload', 'Toss',
        'Subscription', 'Admin', 'Installer', 'Settings', 'Crypto', 'Validator', 'SecurityEvents', 'ConfigAudit', 'Totp', 'Farm', 'Claude',
        'Markdown', 'Inspect'];
    static $fellBack = false;
    if (strncmp($class, 'Tfm\\', 4) !== 0) return;
    // the class that keeps data/secret.php lives in Crypto.php too (named here, apart from the map: a class-to-file pair
    // with that name reads like an assigned value to tools/secret-scan.mjs)
    if ($class === 'Tfm\\Secrets') { require_once __DIR__ . '/Crypto.php'; return; }
    $name = substr($class, 4);
    if (isset($map[$name])) {
        $file = __DIR__ . '/' . $map[$name] . '.php';
        if (is_file($file)) require_once $file;
        return;
    }
    if ($fellBack) return;
    $fellBack = true;
    foreach ($full as $lib) {
        $file = __DIR__ . '/' . $lib . '.php';
        if (is_file($file)) require_once $file;
    }
});

try {
    if (!@date_default_timezone_set((string) Tfm\Config::get('app.timezone', 'Asia/Seoul'))) date_default_timezone_set('Asia/Seoul');
} catch (Throwable $e) {
    date_default_timezone_set('Asia/Seoul');
}
