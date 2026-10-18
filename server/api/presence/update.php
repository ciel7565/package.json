<?php
/**
 * POST api/presence/update.php  {x, y, z, rotY, anim, speed, zoneId, emote, emoteAt, appearance?}
 * → {players:[{id, nickname, x, y, z, rotY, anim, speed, zoneId, emote, emoteAt, age, appearance}], online}   (age: ms since that report)
 * The nickname always comes from the account; positions are clamped; appearance is whitelisted.
 */
declare(strict_types=1);

require __DIR__ . '/../../lib/bootstrap.php';

use Tfm\{Api, Ctx, Presence, Session};

Api::run(['method' => 'POST', 'auth' => true, 'rate' => 'presence'], function (Ctx $c): array {
    $b = $c->json(8192);
    Session::close();
    Presence::update($c->user, $b, $c->now);
    $players = Presence::others($c->uid(), $c->now);
    return ['players' => $players, 'online' => count($players) + 1];
});
