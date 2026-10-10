<?php
/**
 * GET api/admin/health.php — environment & security self-check (see Tfm\Health).
 * Access: admins; or, while no admin account exists yet, requests from the server machine itself (localhost).
 * ?quick=1 skips the loopback exposure probe.
 */
declare(strict_types=1);

require __DIR__ . '/../../lib/bootstrap.php';

use Tfm\{Api, ApiException, Audit, Ctx, Health, Http, Session, Users};

Api::run(['method' => 'GET', 'rate' => 'admin'], function (Ctx $c): array {
    if (!$c->isAdmin()) {
        $bootstrap = Http::isLocalhost() && !Users::adminExists();
        if (!$bootstrap) {
            if (!$c->user) throw new ApiException(401, 'AUTH_REQUIRED', '관리자 계정으로 로그인해야 볼 수 있어요.');
            Audit::log('admin_denied', $c->uid(), ['path' => 'health'], 'warn');
            throw new ApiException(403, 'FORBIDDEN', '관리자 권한이 필요해요.');
        }
    }
    Session::close();
    $h = Health::collect(($_GET['quick'] ?? '') !== '1');
    $h['access'] = $c->isAdmin() ? 'admin' : 'localhost-bootstrap';
    return $h;
});
