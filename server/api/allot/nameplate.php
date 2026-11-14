<?php
/**
 * POST api/allot/nameplate.php  {contractNo, text, show}  → {contractNo, nameplate: {text, show}}
 * The holder of a live contract names their unit (이름표). text: up to 40 characters typed; it is cleaned like every
 * public text (bad words and personal data such as phone numbers are masked) and cut to 12 characters — the answer has
 * what is stored; '' removes the nameplate. show (JSON true / false): whether everyone may read it on the unit
 * (api/allot/unit.php); false keeps it for the holder and the operator.
 * Login + CSRF. 400 INVALID_INPUT · 403 ALLOT_DISABLED · 404 NOT_FOUND (unknown, malformed or another account's
 * number) · 409 NOT_LIVE. Rate limit allot_write.
 */
declare(strict_types=1);

require __DIR__ . '/../../lib/bootstrap.php';

use Tfm\Allot;
use Tfm\Api;
use Tfm\Ctx;
use Tfm\Session;
use Tfm\V;

Api::run(['method' => 'POST', 'auth' => true, 'rate' => 'allot_write'], function (Ctx $c): array {
    $b = $c->json(4096);
    V::keys($b, ['contractNo', 'text', 'show']);
    $no = V::str(isset($b['contractNo']) ? $b['contractNo'] : null, 'contractNo', 24, 1);
    $text = V::str(isset($b['text']) ? $b['text'] : null, 'text', 40);
    $show = V::bool(isset($b['show']) ? $b['show'] : null, 'show');
    Session::close();
    Allot::guard();
    return Allot::setLabelByUser($c->user, $no, $text, $show);
});
