<?php
/**
 * GET api/chat/list.php?after=<lastId>&limit=<n>
 * → {messages:[{id, userId, nickname, text, channel, createdAt}], online, lastId}
 * Readable by any session (guests can read, only accounts can write). Hidden messages and messages from
 * banned accounts are never returned. 'local' messages are only delivered to players near the sender.
 */
declare(strict_types=1);

require __DIR__ . '/../../lib/bootstrap.php';

use Tfm\{Api, ApiException, Config, Ctx, Db, Presence, Session};

Api::run(['method' => 'GET', 'rate' => 'chat_list'], function (Ctx $c): array {
    Session::close();
    $afterRaw = (string) ($_GET['after'] ?? '0');
    if (!preg_match('/^\d{1,18}$/', $afterRaw)) throw new ApiException(400, 'INVALID_PARAM', '요청 값이 올바르지 않아요.');
    $after = (int) $afterRaw;
    $page = max(1, min((int) Config::get('chat.page_size', 60), (int) ($_GET['limit'] ?? 60)));
    $now = $c->now;
    $cols = 'm.id, m.user_id, m.nickname, m.channel, m.text, m.x, m.z, m.created_at';
    $join = "JOIN users u ON u.id = m.user_id AND u.status = 'active'";
    if ($after === 0) {
        $hist = max(1, (int) Config::get('chat.history', 40));
        $rows = array_reverse(Db::all("SELECT $cols FROM chat_messages m $join WHERE m.hidden = 0 AND m.created_at > ? ORDER BY m.id DESC LIMIT $hist", [$now - 6 * 3600000]));
    } else {
        $rows = Db::all("SELECT $cols FROM chat_messages m $join WHERE m.id > ? AND m.hidden = 0 ORDER BY m.id ASC LIMIT $page", [$after]);
    }
    $me = $c->uid();
    $pos = $me ? Presence::position($me, $now) : null;
    $radius = (float) Config::get('chat.local_radius', 30);
    $out = [];
    $last = $after;
    foreach ($rows as $r) {
        $last = max($last, (int) $r['id']);
        if ($r['channel'] === 'local' && (int) $r['user_id'] !== $me) {
            if (!$pos || $r['x'] === null || $r['z'] === null) continue;
            if (hypot((float) $r['x'] - $pos['x'], (float) $r['z'] - $pos['z']) > $radius) continue;
        }
        $out[] = [
            'id' => (int) $r['id'],
            'userId' => (string) $r['user_id'],
            'nickname' => (string) $r['nickname'],
            'text' => (string) $r['text'],
            'channel' => (string) $r['channel'],
            'createdAt' => (int) $r['created_at'],
        ];
    }
    return ['messages' => $out, 'online' => max(1, Presence::onlineCount($now)), 'lastId' => $last];
});
