<?php
/**
 * 전통발효체험관 메타버스 — PHP server bootstrap (included by every endpoint).
 * Requirements: PHP 8.1+ (8.2+ recommended), pdo_sqlite or pdo_mysql, mbstring, json, fileinfo; gd recommended.
 */
declare(strict_types=1);

if (defined('TFM_BOOT')) return;
// requested directly over the web (servers that ignore lib/.htaccess)? → behave like a missing file
if (PHP_SAPI !== 'cli' && isset($_SERVER['SCRIPT_FILENAME']) && realpath((string) $_SERVER['SCRIPT_FILENAME']) === __FILE__) {
    http_response_code(404);
    exit;
}
define('TFM_BOOT', true);
define('TFM_ROOT', dirname(__DIR__));
define('TFM_APP', 'tfm-metaverse');
define('TFM_VERSION', '2.0.0');

// never print errors to clients; everything goes to data/logs via Tfm\Log
ini_set('display_errors', '0');
ini_set('display_startup_errors', '0');
ini_set('html_errors', '0');
ini_set('log_errors', '1');
ini_set('zend.exception_ignore_args', '1');
error_reporting(E_ALL);
if (function_exists('header_remove')) @header_remove('X-Powered-By');

if (PHP_VERSION_ID < 80100 || !extension_loaded('mbstring') || !extension_loaded('json')) {
    http_response_code(500);
    header('Content-Type: application/json; charset=utf-8');
    header('X-Content-Type-Options: nosniff');
    echo '{"success":false,"error":{"code":"SERVER_REQUIREMENTS","message":"서버 환경이 맞지 않아요 (PHP 8.1 이상, mbstring 필요). 관리자에게 문의해 주세요."}}';
    exit;
}

mb_internal_encoding('UTF-8');

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
require __DIR__ . '/Admin.php';

try {
    if (!@date_default_timezone_set((string) Tfm\Config::get('app.timezone', 'Asia/Seoul'))) date_default_timezone_set('Asia/Seoul');
} catch (Throwable) {
    date_default_timezone_set('Asia/Seoul');
}
