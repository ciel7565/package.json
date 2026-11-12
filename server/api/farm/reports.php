<?php
/**
 * GET api/farm/reports.php → {reports: [{id, kind, bedId, pid, cropId, stars, amount, note, status:'pending'|'approved'|'rejected',
 *                                        memo, requestedAt, decidedAt, seen, photoUrl}], unseen}
 * The caller's last 50 completion requests, newest first, with the admin's decision and memo (the "📬 확인 기록장" of
 * CONTRACT §15.3); unseen = decided requests not yet marked seen (api/farm/seen.php). photoUrl is null without a photo.
 * Only the caller's own rows. Login only; no query parameters. Rate limit farm_reports (shared with seen.php).
 */
declare(strict_types=1);

require __DIR__ . '/../../lib/bootstrap.php';

use Tfm\Api;
use Tfm\Ctx;
use Tfm\Farm;
use Tfm\Session;
use Tfm\V;

Api::run(['method' => 'GET', 'auth' => true, 'rate' => 'farm_reports'], function (Ctx $c): array {
    V::keys($_GET, [], 'query');
    Session::close();
    return Farm::reports($c->uid(), 50);
});
