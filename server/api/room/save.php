<?php
/**
 * POST api/room/save.php  {v, style: {floor, wall, wood, mood, win}, items: [{i, x, y, z, r, s?, c?}], public}  → {v}
 * 내 방 (CONTRACT §17.4): the caller's own room — there is no way to name another account. `v` is the version this
 * save was made from (0 for a first save); it is taken only when that is still the stored one and answers the next
 * version, else 409 ROOM_STALE with data {v: the stored version} (the room was changed on another device).
 * Every thing is checked against the catalogue of this build (data/game-data.json → myroom): a known id, numbers on
 * the grid and inside the room, a wall thing on its wall, the way to the door free, no more things than the account's
 * entitlement allows (limits.roomItems), at most 24 KB. Unknown fields are refused.
 * Login + CSRF. 400 INVALID_INPUT / INVALID_JSON / ROOM_INVALID (data {field}) / ROOM_LIMIT (data {limit}) ·
 * 403 ROOM_FORBIDDEN (this account has no room) · 409 ROOM_STALE · 413 PAYLOAD_TOO_LARGE · 503 ROOM_UNAVAILABLE (the
 * build has no catalogue). Rate limit room_save.
 */
declare(strict_types=1);

require __DIR__ . '/../../lib/bootstrap.php';

use Tfm\Api;
use Tfm\Ctx;
use Tfm\Room;
use Tfm\Session;
use Tfm\V;

Api::run(['method' => 'POST', 'auth' => true, 'rate' => 'room_save'], function (Ctx $c): array {
    $b = $c->json(Room::MAX_BYTES + 4096);
    V::keys($b, ['v', 'style', 'items', 'public']);
    Session::close();
    return Room::save($c->user, $b);
});
