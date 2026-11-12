<?php
/**
 * api/trap.php — the honeypot (CONTRACT §15.7 #5). The root .htaccess rewrites well-known scanner bait paths
 * (/.env, /.git/…, /wp-login.php, /wp-admin/…, /phpmyadmin/…, /config.php.bak, /backup.zip, /xmlrpc.php, …) to this
 * file. A real visitor never asks for those, so every hit is logged as a `honeypot` event, counts towards the
 * automatic block (Firewall::noteAttack), and is answered with a plain 404 — the scanner learns nothing.
 *
 * It is NOT an Api::run endpoint (it must answer any method, and the response is a bare 404, not the JSON envelope).
 * php -S fallback: the suite / a probe reaches it directly as api/trap.php?p=<bait path>.
 * PHP 7.2 syntax only.
 */
declare(strict_types=1);

require __DIR__ . '/../lib/bootstrap.php';

use Tfm\ApiException;
use Tfm\Boot;
use Tfm\Firewall;
use Tfm\Http;
use Tfm\RateLimit;
use Tfm\Sec;
use Tfm\SecEvent;
use Tfm\Session;

Boot::forApi();

$respond = function (int $status, array $headers = []): void {
    while (ob_get_level() > 0) { @ob_end_clean(); }
    if (!headers_sent()) {
        http_response_code($status);
        Http::securityHeaders('api');
        header('Content-Type: application/json; charset=utf-8');
        foreach ($headers as $h) header($h);
    }
    try { Session::close(); } catch (\Throwable $e) { /* ignore */ }
    // a bare 404 (no body) gives a scanner nothing to fingerprint; other statuses carry the generic error envelope
    echo $status === 404 ? '' : '{"success":false,"error":{"code":"NOT_FOUND","message":"찾을 수 없어요."}}';
    exit;
};

try {
    // A blocked address is logged but still gets the same bare 404: a honeypot must never reveal itself (an IP_BLOCKED
    // or a 429 would tell a scanner it found something real), so the firewall / rate limit here only gate the LOGGING.
    $blocked = false;
    try { Firewall::check(); } catch (ApiException $e) { $blocked = true; }
    // the path the scanner really asked for: the Apache rewrite keeps REQUEST_URI; ?p=<path> is the php -S fallback
    $want = isset($_GET['p']) && is_string($_GET['p']) ? $_GET['p'] : (string) (isset($_SERVER['REQUEST_URI']) ? $_SERVER['REQUEST_URI'] : '');
    $want = substr((string) preg_replace('/[\x00-\x1f]+/', '', $want), 0, 200);
    // the honeypot itself must not become a log-flood vector: a lenient per-address limit (config rate_limits.trap)
    // throttles the LOG only — when it is reached, the hit is simply not logged (still a plain 404 to the scanner).
    $overLimit = false;
    try { RateLimit::hit('trap', 'ip:' . Sec::hashId(Http::clientIp())); } catch (ApiException $e) { $overLimit = true; }
    if (!$blocked && !$overLimit) {
        SecEvent::log('honeypot', 'warn', ['want' => $want, 'ua' => substr((string) (isset($_SERVER['HTTP_USER_AGENT']) ? $_SERVER['HTTP_USER_AGENT'] : ''), 0, 80)]);
        Firewall::noteAttack('honeypot');
    }
    // CONTRACT §15.7 #10: a preflight (OPTIONS) gets exactly the answer of every private endpoint (Http::cors: 403, no
    // body, no Access-Control-* header) — after the hit is logged, and without telling the honeypot apart from the rest
    Http::cors(false);
    $method = Http::method();
    if ($method !== 'GET' && $method !== 'HEAD') $respond(405, ['Allow: GET, HEAD']);
    $respond(404);
} catch (\Throwable $e) {
    $respond(404);
}
