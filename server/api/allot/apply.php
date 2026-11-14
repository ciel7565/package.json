<?php
/**
 * POST api/allot/apply.php
 *   a named unit:   {unit: "J01-0012", name, phone, addr?, consent: true, consentVersion, adult: true, nameplate?,
 *                    nameplateShow?, guardian?}
 *   any free unit:  {kind: "jar"|"plot"|"store", zone?: "J01", auto: true, name, phone, …}   (the same target may also be
 *                    sent as one object: {unit: {kind, zone?, auto: true}, name, phone, …})
 *   → 201 {contractNo, status: 'pending'|'active', unit, holdUntil, pay: {toss, guide, until}}
 * An application for one unit (항아리 · 밭 · 창고). The unit is held for the applicant until the operator approves it
 * (status 'pending'; `holdUntil` = when an unpaid application lapses, 0 = no timer) — or it is 'active' at once when the
 * operator switched automatic approval on. `pay.toss` = online payment may be offered, `pay.guide` = the operator's
 * payment guide text. No price is in this answer (api/allot/plans.php tells prices).
 *
 * Required exactly: consent === true, adult === true (a JSON true, not "true" / 1) and consentVersion equal to the one
 * plans.php gave — else 400 CONSENT_REQUIRED with data {field, version}. name: 1–40 characters with a letter;
 * phone: a Korean number ("010-1234-5678", "+82 10 …"); addr (≤ 200) is kept only when the operator collects addresses;
 * nameplate: ≤ 40 characters typed, shown as at most 12 after cleaning (bad words / personal data masked), public only
 * with nameplateShow true; guardian: true when a guardian applies for a child under 14. Unknown fields are refused.
 *
 * Login + CSRF. Errors: 400 CONSENT_REQUIRED · 400 INVALID_INPUT · 403 ALLOT_DISABLED · 404 NOT_FOUND (no such unit /
 * zone) · 409 UNIT_TAKEN (someone was first: pick another) · 409 NOT_OPEN · 409 SOLD_OUT (auto: nothing free — the
 * waiting list is api/allot/waitlist.php) · 429 APPLY_LIMIT (data {max, used}). Rate limit allot_apply (10 an hour).
 */
declare(strict_types=1);

require __DIR__ . '/../../lib/bootstrap.php';

use Tfm\Allot;
use Tfm\Api;
use Tfm\Ctx;
use Tfm\Session;
use Tfm\V;

Api::run(['method' => 'POST', 'auth' => true, 'rate' => 'allot_apply'], function (Ctx $c): array {
    $b = $c->json(8192);
    V::keys($b, ['unit', 'kind', 'zone', 'auto', 'name', 'phone', 'addr', 'consent', 'consentVersion', 'adult', 'nameplate', 'nameplateShow', 'guardian']);
    Session::close(); // the CSRF token is checked; an application never needs the session lock
    Allot::guard();

    // which unit: a code, or "any free one" of a kind (and zone)
    if (V::has($b, 'unit')) {
        foreach (['kind', 'zone', 'auto'] as $k) {
            if (V::has($b, $k)) V::fail($k, '자리 번호(unit)를 보낼 때에는 함께 보낼 수 없어요.');
        }
        if (is_array($b['unit'])) {
            V::keys($b['unit'], ['kind', 'zone', 'auto'], 'unit');
            $target = $b['unit'];
        } else {
            $target = V::str($b['unit'], 'unit', 24, 1);
        }
    } elseif (!V::has($b, 'kind') && !V::has($b, 'zone') && !V::has($b, 'auto')) {
        V::fail('unit', '자리 번호(unit)를 보내거나, 아무 자리나 받으려면 kind 와 auto: true 를 보내 주세요.');
    } else {
        $target = ['kind' => isset($b['kind']) ? $b['kind'] : null, 'zone' => isset($b['zone']) ? $b['zone'] : null, 'auto' => isset($b['auto']) ? $b['auto'] : null];
    }
    if (is_array($target)) {
        V::enum(isset($target['kind']) ? $target['kind'] : null, 'kind', Allot::KINDS);
        if (!isset($target['auto']) || $target['auto'] !== true) V::fail('auto', '아무 자리나 받으려면 auto 를 true 로 보내 주세요.');
        if (isset($target['zone'])) V::str($target['zone'], 'zone', 12, 1);
    }

    // the applicant: every field typed here; consent, adult, the consent version, name and phone are judged by Allot
    foreach (['name' => 40, 'phone' => 30, 'consentVersion' => 64, 'addr' => 200, 'nameplate' => 40] as $k => $max) {
        if (V::has($b, $k)) V::str($b[$k], $k, $max);
    }
    foreach (['nameplateShow', 'guardian'] as $k) {
        if (V::has($b, $k)) V::bool($b[$k], $k);
    }
    $data = Allot::apply($c->user, $target, $b);
    Api::send(201, ['success' => true, 'data' => $data]);
    return $data; // not reached: send() ends the request
});
