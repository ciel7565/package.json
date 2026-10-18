<?php
/**
 * GET api/admin/health.php — environment & security self-check (see Tfm\Health).
 * Access: admins; or, while no admin account exists yet, a logged-in player browsing on the server machine itself
 * (Http::isLocalhost: loopback, no proxy / tunnel / forwarding header, loopback Host).
 * ?quick=1 skips the loopback exposure probe.
 */
declare(strict_types=1);

require __DIR__ . '/../../lib/bootstrap.php';

use Tfm\{Api, ApiException, Audit, Config, Ctx, Health, Http, Session, Users};

Api::run(['method' => 'GET', 'rate' => 'admin'], function (Ctx $c): array {
    if (!$c->isAdmin()) {
        // never anonymous: the report lists PHP / ini / DB / path details
        if (!$c->user) throw new ApiException(401, 'AUTH_REQUIRED', '관리자 계정으로 로그인해야 볼 수 있어요.');
        $bootstrap = Http::isLocalhost() && !Users::adminExists() && Config::get('security.allow_localhost_bootstrap', true);
        if (!$bootstrap) {
            Audit::log('admin_denied', $c->uid(), ['path' => 'health'], 'warn');
            throw new ApiException(403, 'FORBIDDEN', '관리자 권한이 필요해요.');
        }
    }
    Session::close();
    $h = Health::collect(($_GET['quick'] ?? '') !== '1');
    $h['access'] = $c->isAdmin() ? 'admin' : 'localhost-bootstrap';
    return $h;
});
