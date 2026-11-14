<?php
/**
 * GET api/allot/mine.php
 *   → {contracts: [{contractNo, status: 'pending'|'active'|'overdue'|'ended'|'canceled', unit: {code, kind, zone, zoneName,
 *      seq}, period: 'once'|'month'|'year', termMonths, startsAt, endsAt, paidUntil, autoRenew, holdUntil, payDue,
 *      cancelRequested, nameplate: {text, show}, createdAt, decidedAt, endedAt, endReason, timeline: [{k, at, done}]}],
 *      waitlist: [{id, kind, zone, status: 'waiting'|'offered', position, unit, offerUntil, createdAt}],
 *      unread, limit: {max, used}}
 * The caller's own allotments ("내 분양"): the 20 newest contracts, live waiting-list rows, the number of unread notices
 * and how many of the per-account places are used. Times are server milliseconds (0 = not set). timeline.k is one of
 * applied · approved · paid · due · ends · ended · canceled. NO price or amount is in this answer (easy mode shows it):
 * prices come only from api/allot/plans.php. Only the caller's own rows.
 * Login only; no query parameters. 403 ALLOT_DISABLED. Rate limit allot_mine (shared with plans.php).
 */
declare(strict_types=1);

require __DIR__ . '/../../lib/bootstrap.php';

use Tfm\Allot;
use Tfm\Api;
use Tfm\Ctx;
use Tfm\Session;
use Tfm\V;

Api::run(['method' => 'GET', 'auth' => true, 'rate' => 'allot_mine'], function (Ctx $c): array {
    V::keys($_GET, [], 'query');
    Session::close();
    Allot::guard();
    Allot::lazyTick();
    return Allot::mine($c->uid());
});
