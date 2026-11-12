<?php
/**
 * POST api/farm/report.php  {kind:'rt'|'plot', bedId, pid, note?}  → {report: {id, kind, bedId, pid, cropId, stars, amount,
 *                                                                     note, status:'pending', memo, requestedAt, decidedAt, seen, photoUrl}}
 * "재배 완료 확인" (CONTRACT §15.3): a child asks the admin to confirm a finished planting. The server checks its OWN records,
 * never the request: a real-time bed that is ready by the server clock (or harvested within farm.harvest_keep_days), a
 * quick plot whose mirrored row is ready / recently harvested or whose stored save shows 100 %. One request per planting.
 *   409 NOT_READY (also for a planting of another account — the same answer) · 409 ALREADY_REPORTED · 429 REPORT_LIMIT
 *   (farm.report_daily per account per 24 h, + Retry-After) · 400 INVALID_INPUT for any field of the wrong shape.
 * The note (≤ farm.report_note_max characters; easy mode sends one of rtfarm.reportNotes) is cleaned, PII-masked (🔒) and
 * bad-word-filtered (♡♡) like chat before it is stored. Login, CSRF, rate limit farm_report.
 */
declare(strict_types=1);

require __DIR__ . '/../../lib/bootstrap.php';

use Tfm\Api;
use Tfm\Config;
use Tfm\Ctx;
use Tfm\Farm;
use Tfm\Session;
use Tfm\V;

Api::run(['method' => 'POST', 'auth' => true, 'rate' => 'farm_report'], function (Ctx $c): array {
    $b = $c->json(4096);
    V::keys($b, ['kind', 'bedId', 'pid', 'note']);
    $kind = V::enum(V::has($b, 'kind') ? $b['kind'] : null, 'kind', ['rt', 'plot']);
    $bedId = V::str(V::has($b, 'bedId') ? $b['bedId'] : null, 'bedId', 16, 1);
    $pid = V::str(V::has($b, 'pid') ? $b['pid'] : null, 'pid', 16, 1);
    $note = V::has($b, 'note') ? V::str($b['note'], 'note', max(1, (int) Config::get('farm.report_note_max', 80))) : '';
    Session::close();
    return ['report' => Farm::report($c->user, $kind, $bedId, $pid, $note)];
});
