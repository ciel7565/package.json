<?php
/**
 * GET api/ranking/top.php → {ranking:[{rank, nickname, level, exp, title, me}], me:{rank, nickname, level, exp}|null, total, updatedAt}
 * Top 20 by level, then cumulative exp. Only nicknames are exposed (no ids, no emails).
 */
declare(strict_types=1);

require __DIR__ . '/../../lib/bootstrap.php';

use Tfm\{Api, Ctx, Db, Session};

Api::run(['method' => 'GET', 'rate' => 'ranking'], function (Ctx $c): array {
    Session::close();
    $rows = Db::all("SELECT p.user_id, u.nickname, p.level, p.exp_total, p.title, p.updated_at
        FROM user_profiles p JOIN users u ON u.id = p.user_id
        WHERE u.status = 'active' AND (p.exp_total > 0 OR p.level > 1)
        ORDER BY p.level DESC, p.exp_total DESC, p.updated_at ASC, p.user_id ASC LIMIT 20");
    $me = $c->uid();
    $list = [];
    foreach ($rows as $i => $r) {
        $list[] = ['rank' => $i + 1, 'nickname' => (string) $r['nickname'], 'level' => (int) $r['level'], 'exp' => (int) $r['exp_total'], 'title' => (string) $r['title'], 'me' => (int) $r['user_id'] === $me];
    }
    $mine = null;
    if ($me) {
        $p = Db::one('SELECT level, exp_total FROM user_profiles WHERE user_id = ?', [$me]);
        if ($p) {
            $above = (int) Db::value("SELECT COUNT(*) FROM user_profiles p JOIN users u ON u.id = p.user_id WHERE u.status = 'active' AND (p.level > ? OR (p.level = ? AND p.exp_total > ?))", [(int) $p['level'], (int) $p['level'], (int) $p['exp_total']]);
            $mine = ['rank' => $above + 1, 'nickname' => (string) $c->user['nickname'], 'level' => (int) $p['level'], 'exp' => (int) $p['exp_total']];
        }
    }
    $total = (int) Db::value("SELECT COUNT(*) FROM user_profiles p JOIN users u ON u.id = p.user_id WHERE u.status = 'active'");
    return ['ranking' => $list, 'me' => $mine, 'total' => $total, 'updatedAt' => $c->now];
});
