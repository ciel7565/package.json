<?php
/**
 * POST api/presence/update.php  {x, y, z, rotY, anim, speed, zoneId, emote, emoteAt, appearance?}
 * → {players:[{id, nickname, x, y, z, rotY, anim, speed, zoneId, emote, emoteAt, age, appearance}], online, mutedUntil}   (age: ms since that report)
 * The nickname always comes from the account; positions are clamped; appearance is whitelisted. mutedUntil: when a
 * grown-up's chat pause on this account ends (0 = none), so the app keeps a child's taps quiet before they are sent.
 */
declare(strict_types=1);

require __DIR__ . '/../../lib/bootstrap.php';

use Tfm\Api;
use Tfm\Ctx;
use Tfm\Presence;
use Tfm\Session;
use Tfm\V;

Api::run(['method' => 'POST', 'auth' => true, 'rate' => 'presence'], function (Ctx $c): array {
    $b = $c->json(8192);
    // CONTRACT §15.7 #3: the shared presence fields are typed and range-checked here — a string where a number belongs,
    // an out-of-world coordinate, or an unknown animation / zone / emote id is a clean 400, not a silently clamped value.
    // (Presence::update still clamps and whitelists everything as a second line of defence.)
    V::keys($b, ['x', 'y', 'z', 'rotY', 'anim', 'speed', 'zoneId', 'emote', 'emoteAt', 'nickname', 'appearance']);
    foreach (['x' => [-1000, 1000], 'y' => [-1000, 1000], 'z' => [-1000, 1000]] as $f => $r) {
        V::num(V::has($b, $f) ? $b[$f] : null, $f, $r[0], $r[1]);
    }
    if (V::has($b, 'rotY')) V::num($b['rotY'], 'rotY', -1000000, 1000000);
    if (V::has($b, 'speed')) V::num($b['speed'], 'speed', 0, 40);
    if (V::has($b, 'emoteAt')) V::num($b['emoteAt'], 'emoteAt', 0, 9.9e15);
    if (V::has($b, 'anim')) V::enum($b['anim'], 'anim', Presence::ANIMS);
    if (V::has($b, 'zoneId') && !preg_match('/^ZONE_[A-Z0-9_]{1,30}$/', V::str($b['zoneId'], 'zoneId', 40))) V::fail('zoneId', '구역 값이 올바르지 않아요.');
    if (V::has($b, 'emote') && !preg_match('/^EMO_[A-Z0-9_]{1,30}$/', V::str($b['emote'], 'emote', 40))) V::fail('emote', '값이 올바르지 않아요.');
    if (V::has($b, 'nickname')) V::str($b['nickname'], 'nickname', 40); // the server uses the account nickname; a wrong type is still refused
    if (V::has($b, 'appearance') && !is_array($b['appearance'])) V::fail('appearance', '값은 { } 모양으로 보내 주세요.'); // Http::json decodes objects to arrays
    Session::close();
    Presence::update($c->user, $b, $c->now);
    $players = Presence::others($c->uid(), $c->now);
    $muted = (int) $c->user['muted_until'];
    return ['players' => $players, 'online' => count($players) + 1, 'mutedUntil' => $muted > $c->now ? $muted : 0];
});
