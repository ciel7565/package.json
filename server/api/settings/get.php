<?php
/**
 * GET api/settings/get.php → { v, data: { acct: { <option id>: value }, dev: { <device id>: { t, s } } }, updatedAt }
 * The settings window (CONTRACT §18.2): what the caller chose, kept on the account (Tfm\UserSettings). The caller's own
 * row only — there is no way to name another account. v 0 and empty maps when nothing was saved yet.
 * Login required (guests of a server too: their row goes with their account). No query parameters. Rate limit
 * settings_get.
 */
declare(strict_types=1);

require __DIR__ . '/../../lib/bootstrap.php';

use Tfm\Api;
use Tfm\Ctx;
use Tfm\Session;
use Tfm\UserSettings;
use Tfm\V;

Api::run(['method' => 'GET', 'auth' => true, 'rate' => 'settings_get'], function (Ctx $c): array {
    V::keys($_GET, [], 'query');
    Session::close(); // read-only: release the session lock
    return UserSettings::get((int) $c->user['id']);
});
