<?php
/**
 * GET api/queue.php?t=<ticket> — the waiting room (CONTRACT §16.9). The only thing a waiting browser calls:
 *   → {go:true}                         the turn has come: call api/sync.php again with "qt": <ticket>
 *   → {go:false, pos, eta, next}        still waiting: pos = people in front (this ticket included), eta = seconds
 *                                       (0 = not known yet), next = ms until the next call here
 * 400 QUEUE_TICKET: not a ticket, its time ran out, or it is not the place the server remembers for its account (used,
 * given up, of an older line) — call api/sync.php again (with or without "qt": the answer carries the account's place).
 * 429 + Retry-After: asked again within a second, or more than the limit "queue" allows.
 * No session, no database: the ticket is signed, the line lives in the shared cache (lib/Gate.php).
 */
declare(strict_types=1);

define('TFM_LIGHT', true);
require __DIR__ . '/../lib/bootstrap.php';

use Tfm\Api;
use Tfm\Ctx;
use Tfm\Gate;
use Tfm\RateLimit;
use Tfm\V;

Api::run(['method' => 'GET', 'session' => 'none', 'shed' => 0], function (Ctx $c): array {
    V::keys($_GET, ['t'], 'query');
    $t = V::query('t');
    // limit "queue" (120 a minute): per waiting account when the ticket is genuine — a class behind one school address
    // waits together — and per address for anything that is not a ticket
    $owner = is_string($t) && $t !== '' ? Gate::ticketOwner($t) : null;
    RateLimit::forTicket('queue', $owner);
    if ($t === null || $t === '') V::fail('t', '값이 필요해요.');
    $r = Gate::poll(V::str($t, 't', 200));
    Api::releaseConnection(isset($r['next']) ? (int) $r['next'] : 0); // waiting: the next question is seconds away
    return $r;
});
