<?php
/**
 * POST api/allot/waitlist.php — the waiting list (대기 신청) for a kind or zone that has no free unit.
 *   join:    {action: "join", kind: "jar"|"plot"|"store", zone?: "J01", name, phone, addr?, consent: true, consentVersion,
 *             adult: true, guardian?}                       → {id, status: 'waiting', position}
 *   leave:   {action: "leave", id}                          → {id, status: 'canceled'}
 *   accept:  {action: "accept", id}                         → {contractNo, status, unit, holdUntil, pay: {toss, guide, until}}
 * join waits for any unit of the kind, or of one zone; the applicant fields are those of api/allot/apply.php (the same
 * consent rules). A waiting row counts toward the per-account limit. When a unit becomes free the first in line is
 * OFFERED it (notice kind 'offer', api/allot/mine.php shows waitlist[].status 'offered' with the unit and offerUntil):
 * accept turns the offer into an application exactly like apply.php; leave declines it (or stops waiting) and the unit
 * goes to the next in line. An offer nobody answers lapses by itself.
 * Login + CSRF. Errors: 400 INVALID_INPUT · 400 CONSENT_REQUIRED · 403 ALLOT_DISABLED · 404 NOT_FOUND (no such zone;
 * unknown or another account's waiting row) · 409 HAS_FREE (there is a free unit — apply instead) · 409 ALREADY_WAITING ·
 * 409 NOT_OPEN · 409 OFFER_GONE (no offer, or its time is over) · 429 APPLY_LIMIT. Rate limit allot_write.
 */
declare(strict_types=1);

require __DIR__ . '/../../lib/bootstrap.php';

use Tfm\Allot;
use Tfm\Api;
use Tfm\Ctx;
use Tfm\Session;
use Tfm\V;

Api::run(['method' => 'POST', 'auth' => true, 'rate' => 'allot_write'], function (Ctx $c): array {
    $b = $c->json(8192);
    V::keys($b, ['action', 'id', 'kind', 'zone', 'name', 'phone', 'addr', 'consent', 'consentVersion', 'adult', 'guardian']);
    $action = V::enum(isset($b['action']) ? $b['action'] : null, 'action', ['join', 'leave', 'accept']);
    Session::close();
    Allot::guard();
    if ($action !== 'join') {
        V::keys($b, ['action', 'id']);
        $raw = isset($b['id']) ? $b['id'] : null;
        if (!is_int($raw)) V::fail('id', '값은 번호(1 이상의 정수)여야 해요.');
        $id = V::id($raw, 'id');
        return $action === 'leave' ? Allot::waitLeave($c->user, $id) : Allot::waitAccept($c->user, $id);
    }
    if (V::has($b, 'id')) V::fail('id', '항목은 대기 신청(join)에서 쓸 수 없어요.');
    $kind = V::enum(isset($b['kind']) ? $b['kind'] : null, 'kind', Allot::KINDS);
    $zone = V::has($b, 'zone') ? V::str($b['zone'], 'zone', 12, 1) : '';
    foreach (['name' => 40, 'phone' => 30, 'consentVersion' => 64, 'addr' => 200] as $k => $max) {
        if (V::has($b, $k)) V::str($b[$k], $k, $max);
    }
    if (V::has($b, 'guardian')) V::bool($b['guardian'], 'guardian');
    return Allot::waitJoin($c->user, $kind, $zone, $b);
});
