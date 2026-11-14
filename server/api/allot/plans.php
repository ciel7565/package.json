<?php
/**
 * GET api/allot/plans.php
 *   → {enabled, consentVersion, collectAddress, nameplateDefaultShow, applyPerUser, holdHours, graceDays, autoApprove:
 *      'off'|'on_payment'|'always', toss, zones: [{code, kind, name, price, period: 'once'|'month'|'year', termMonths, open,
 *      free, cap}], texts: {terms, privacy, refund, payGuide}, sample}
 * Everything the application form needs — and the ONLY endpoint that tells prices (KRW per period). The app calls it
 * behind the grown-up gate; easy mode never does. `consentVersion` must be sent back with the application; `sample` is
 * true while a text is still the built-in example (예시). `toss` = the online payment button may be shown.
 * Login only; no query parameters. 403 ALLOT_DISABLED. Rate limit allot_mine.
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
    return Allot::plans();
});
