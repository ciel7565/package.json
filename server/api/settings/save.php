<?php
/**
 * POST api/settings/save.php { v, data: { acct: { <option id>: value }, dev: { <device id>: { t, s } } } } → { v, dropped }
 * The settings window (CONTRACT §18.2): the caller's own choices, kept for the next login and the next device. Every
 * value is checked against the option table of this build (game-data.json → settings): a value of the wrong type or
 * outside its range is dropped (counted in `dropped`), never stored; ≤ 8 KB, ≤ 5 devices. `v` must be higher than the
 * stored version (the last write wins), else 409 SETTINGS_STALE with data {v: the stored version}.
 * Login + CSRF. 400 INVALID_INPUT / INVALID_JSON / SETTINGS_INVALID (data {field}) · 409 SETTINGS_STALE ·
 * 413 PAYLOAD_TOO_LARGE. Unknown fields are refused. Rate limit settings_save.
 */
declare(strict_types=1);

require __DIR__ . '/../../lib/bootstrap.php';

use Tfm\Api;
use Tfm\Ctx;
use Tfm\Session;
use Tfm\UserSettings;
use Tfm\V;

Api::run(['method' => 'POST', 'auth' => true, 'csrf' => true, 'rate' => 'settings_save'], function (Ctx $c): array {
    $b = $c->json(UserSettings::MAX_BYTES + 4096);
    V::keys($b, ['v', 'data']);
    Session::close();
    return UserSettings::save($c->user, $b);
});
