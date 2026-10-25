<?php
/**
 * POST api/presence/update.php  {x, y, z, rotY, anim, speed, zoneId, emote, emoteAt, appearance?}
 * → {players:[{id, nickname, x, y, z, rotY, anim, speed, zoneId, emote, emoteAt, age, appearance}], online, mutedUntil}   (age: ms since that report)
 * The nickname always comes from the account; positions are clamped; appearance is whitelisted. mutedUntil: when a
 * grown-up's chat pause on this account ends (0 = none), so the game keeps a child's taps quiet before they are sent.
 */
declare(strict_types=1);

require __DIR__ . '/../../lib/bootstrap.php';

use Tfm\{Api, Ctx, Presence, Session};

Api::run(['method' => 'POST', 'auth' => true, 'rate' => 'presence'], function (Ctx $c): array {
    $b = $c->json(8192);
    Session::close();
    Presence::update($c->user, $b, $c->now);
    $players = Presence::others($c->uid(), $c->now);
    $muted = (int) $c->user['muted_until'];
    return ['players' => $players, 'online' => count($players) + 1, 'mutedUntil' => $muted > $c->now ? $muted : 0];
});
