<?php
/**
 * GET api/ai/status.php → { enabled, kid, presets: [{id, icon, label, say, topic}], left, max }
 * The 옹이 선생님 helper of the app (CONTRACT §15.6 / §16.10, owner: claude): whether it is usable now (a key or the mock
 * mode is set AND the operator switched it on — Settings ai.kid_helper), the preset question tiles (their question text
 * stays on the server), how many questions this account may still ask today and the longest typed question.
 * Never the key, the model or any number of other accounts. Login required (guest accounts too); no query parameters.
 * Rate limit ai_status.
 */
declare(strict_types=1);

require __DIR__ . '/../../lib/bootstrap.php';

use Tfm\Api;
use Tfm\Claude;
use Tfm\Ctx;
use Tfm\Session;
use Tfm\V;

Api::run(['method' => 'GET', 'auth' => true, 'rate' => 'ai_status'], function (Ctx $c): array {
    V::keys($_GET, [], 'query');
    Session::close(); // read-only
    $kid = class_exists('Tfm\Claude') && Claude::kidEnabled();
    return ['enabled' => $kid, 'kid' => $kid, 'presets' => $kid ? Claude::presets() : [], 'left' => $kid ? Claude::left($c->uid()) : 0,
        'max' => class_exists('Tfm\Claude') ? Claude::questionMax() : 200];
});
