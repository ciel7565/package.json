<?php
/**
 * 전통발효체험관 메타버스 — PHP server bootstrap (included by every endpoint).
 * Requirements: PHP 7.2+ (64-bit; 7.2.10 XAMPP is the reference hosting, 8.x works too), pdo_sqlite or pdo_mysql,
 * mbstring, json, session, fileinfo; gd recommended; intl / sodium are optional (fallbacks exist).
 * PHP 7.2 syntax only in every file under server/ (CONTRACT §14.5).
 */
declare(strict_types=1);

if (defined('TFM_BOOT')) return;
// requested directly over the web (servers that ignore lib/.htaccess)? → behave like a missing file, no version banner
if (PHP_SAPI !== 'cli' && isset($_SERVER['SCRIPT_FILENAME']) && realpath((string) $_SERVER['SCRIPT_FILENAME']) === __FILE__) {
    if (function_exists('header_remove')) header_remove('X-Powered-By'); // CONTRACT §15.7 #11
    http_response_code(404);
    exit;
}
define('TFM_BOOT', true);
define('TFM_ROOT', dirname(__DIR__));
define('TFM_APP', 'tfm-metaverse');
define('TFM_VERSION', '2.1.0');

// never print errors to clients; everything goes to data/logs via Tfm\Log
ini_set('display_errors', '0');
ini_set('display_startup_errors', '0');
ini_set('html_errors', '0');
ini_set('log_errors', '1');
error_reporting(E_ALL);
if (function_exists('header_remove')) @header_remove('X-Powered-By');

// 64-bit PHP: every timestamp is milliseconds in a BIGINT and the save checksum needs 64-bit integers
if (PHP_VERSION_ID < 70200 || PHP_INT_SIZE < 8 || !extension_loaded('mbstring') || !extension_loaded('json') || !extension_loaded('pdo')) {
    http_response_code(500);
    header('Content-Type: application/json; charset=utf-8');
    header('X-Content-Type-Options: nosniff');
    echo '{"success":false,"error":{"code":"SERVER_REQUIREMENTS","message":"서버 환경이 맞지 않아요 (64비트 PHP 7.2 이상, mbstring·json·pdo 필요). install.php 를 열어 확인해 주세요."}}';
    exit;
}

mb_internal_encoding('UTF-8');

require __DIR__ . '/compat.php';
require __DIR__ . '/Core.php';
require __DIR__ . '/Db.php';
require __DIR__ . '/Session.php';
require __DIR__ . '/Security.php';
require __DIR__ . '/ChatFilter.php';
require __DIR__ . '/Users.php';
require __DIR__ . '/Api.php';
require __DIR__ . '/Presence.php';
require __DIR__ . '/GameData.php';
require __DIR__ . '/SaveValidator.php';
require __DIR__ . '/Upload.php';
require __DIR__ . '/Toss.php';
require __DIR__ . '/Subscription.php';
require __DIR__ . '/Admin.php';
require __DIR__ . '/Installer.php';
// phase 7 (CONTRACT §15): libraries added by the phase-7 owners. Loaded when present so the parallel builds can land
// one by one; the gate turns this into plain requires once every file exists.
foreach (['Settings', 'Crypto', 'Validator', 'SecurityEvents', 'ConfigAudit', 'Totp', 'Farm', 'Claude', 'Markdown', 'Inspect'] as $tfmLib) {
    $tfmLibFile = __DIR__ . '/' . $tfmLib . '.php';
    if (is_file($tfmLibFile)) require $tfmLibFile;
}
unset($tfmLib, $tfmLibFile);

try {
    if (!@date_default_timezone_set((string) Tfm\Config::get('app.timezone', 'Asia/Seoul'))) date_default_timezone_set('Asia/Seoul');
} catch (Throwable $e) {
    date_default_timezone_set('Asia/Seoul');
}
