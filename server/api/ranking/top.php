<?php
/**
 * GET api/ranking/top.php → {ranking:[{rank, nickname, level, exp, title, me}], me:{rank, nickname, level, exp}|null, total, updatedAt}
 * Top 20 by level, then cumulative exp (ties: who got there first). me.rank uses the same order as the list.
 * Only nicknames are exposed (no ids, no emails).
 * CONTRACT §16.9 (lib/Ranking.php): the list and the number of players come from the shared cache (cache.ranking_ttl,
 * 60 s; updatedAt = when the list was read from the database), a player's own place from a per-account entry. A
 * player's own accepted save and any change of the top 20 show at once; a change further down within a minute.
 */
declare(strict_types=1);

define('TFM_LIGHT', true);
require __DIR__ . '/../../lib/bootstrap.php';

use Tfm\Api;
use Tfm\Ctx;
use Tfm\Ranking;
use Tfm\Session;

Api::run(['method' => 'GET', 'rate' => 'ranking', 'public' => true], function (Ctx $c): array {
    Session::close();
    $top = Ranking::top($c->now);
    $me = $c->uid();
    $list = [];
    foreach ($top['rows'] as $i => $r) {
        $list[] = ['rank' => $i + 1, 'nickname' => (string) $r[1], 'level' => (int) $r[2], 'exp' => (int) $r[3], 'title' => (string) $r[4], 'me' => $me > 0 && (int) $r[0] === $me];
    }
    $mine = null;
    if ($me) {
        $m = Ranking::mine($me, $top);
        if ($m) $mine = ['rank' => $m['rank'], 'nickname' => (string) $c->user['nickname'], 'level' => $m['level'], 'exp' => $m['exp']];
    }
    return ['ranking' => $list, 'me' => $mine, 'total' => (int) $top['total'], 'updatedAt' => (int) $top['at'] ?: $c->now];
});
