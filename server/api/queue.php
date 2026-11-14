<?php
/**
 * GET api/queue.php?t=<ticket> — the waiting room (CONTRACT §16.9). The only thing a waiting browser calls:
 *   → {go:true}                         the turn has come: call api/sync.php again with "qt": <ticket>
 *   → {go:false, pos, eta, next}        still waiting: pos = people in front (this ticket included), eta = seconds
 *                                       (0 = not known yet), next = ms until the next call here
 * 400 QUEUE_TICKET: not a ticket or its time ran out — ask api/sync.php for a new one. 429 + Retry-After: asked again
 * within a second. No session, no database: the ticket is signed, the line lives in the shared cache (lib/Gate.php).
 */
declare(strict_types=1);

define('TFM_LIGHT', true);
require __DIR__ . '/../lib/bootstrap.php';

use Tfm\Api;
use Tfm\Ctx;
use Tfm\Gate;
use Tfm\V;

Api::run(['method' => 'GET', 'rate' => 'queue', 'rateBy' => 'ip', 'session' => 'none', 'shed' => 0], function (Ctx $c): array {
    V::keys($_GET, ['t'], 'query');
    $t = V::query('t');
    if ($t === null || $t === '') V::fail('t', '값이 필요해요.');
    $r = Gate::poll(V::str($t, 't', 200));
    Api::releaseConnection(isset($r['next']) ? (int) $r['next'] : 0); // waiting: the next question is seconds away
    return $r;
});
