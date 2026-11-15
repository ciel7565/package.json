<?php
/**
 * GET api/room/get.php[?user=<account id>]
 *   → {room: {v, style: {floor, wall, wood, mood, win}, items: [{i, x, y, z, r, s?, c?}], public}, mine, can, limit}
 * 내 방 (CONTRACT §17.4). Without `user`: the caller's own room — an account that has not decorated yet gets an empty
 * one (v 0, no things); `can` = may this account have a room (an administrator, a live allotment contract, or a room
 * the operator gave), `limit` = how many things fit. One primary-key read; who-may and the limit come from the shared
 * cache (a minute old at most).
 * With `user`: another account's room — only when its holder made it public and still has a room (mine false, can
 * false, limit 0). Every other case is the same 404 NOT_FOUND, so nobody can find out which accounts exist.
 * A room is catalogue ids and numbers: nothing anybody typed is in it.
 * Login. 400 INVALID_INPUT for a malformed parameter. Rate limit room_get.
 */
declare(strict_types=1);

require __DIR__ . '/../../lib/bootstrap.php';

use Tfm\Api;
use Tfm\Ctx;
use Tfm\Room;
use Tfm\Session;
use Tfm\V;

Api::run(['method' => 'GET', 'auth' => true, 'rate' => 'room_get'], function (Ctx $c): array {
    V::keys($_GET, ['user'], 'query');
    $owner = V::query('user') === null ? null : V::id(V::query('user'), 'user');
    Session::close();
    return Room::view($c->user, $owner);
});
