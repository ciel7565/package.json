<?php
/**
 * GET api/chat/list.php?after=<lastId>&limit=<n>&rafter=<cursor>
 * → {messages:[{id, userId, nickname, text, channel, createdAt}], online, lastId, retracted:{messages, users, upTo}, retractId}
 * retracted.upTo = {userId: highest message id}: a banned account's lines are taken back only up to that id (the
 * lines it posts after an unban stay); a user listed in retracted.users without an upTo entry loses every line.
 * Readable by any session (guests can read, only accounts can write). Hidden messages and messages from
 * banned accounts are never returned. 'local' messages are only delivered to players near the sender.
 * Personal information is masked again on the way out (defense in depth: rows stored before the PII filter).
 *
 * Phase 8 (CONTRACT §16.9): new pages get their chat through api/sync.php; this endpoint stays for old pages and
 * tests. With a cache it answers from the chat ring, the moderation feed and the seat count (no statement) whenever
 * the ring holds everything after the client's cursor; otherwise it asks the database as before.
 */
declare(strict_types=1);

define('TFM_LIGHT', true);
require __DIR__ . '/../../lib/bootstrap.php';

use Tfm\Api;
use Tfm\ApiException;
use Tfm\ChatFilter;
use Tfm\Config;
use Tfm\Ctx;
use Tfm\Db;
use Tfm\Presence;
use Tfm\Retractions;
use Tfm\Session;
use Tfm\Sync;
use Tfm\V;

Api::run(['method' => 'GET', 'rate' => 'chat_list'], function (Ctx $c): array {
    Session::close();
    // CONTRACT §15.7 #3: the numeric cursors go through V::int — a non-numeric, negative, zero (limit), huge or array
    // value (?after[]=1) is a clean 400, never a silent default or a 500. `after` may be 0 (the first poll).
    $pageSize = (int) Config::get('chat.page_size', 60);
    $after = V::int(V::query('after', '0'), 'after', 0, V::INT_MAX);
    $page = V::int(V::query('limit', (string) $pageSize), 'limit', 1, $pageSize);
    $now = $c->now;
    $hist = max(1, (int) Config::get('chat.history', 40));
    $ring = class_exists('Tfm\\Sync') ? Sync::globalRows($after) : null;
    if ($ring !== null) {
        // the ring holds every visible line after the cursor: [id, userId, nickname, text, kind, createdAt, x, z, …]
        $rows = [];
        foreach ($ring as $r) {
            if ($after === 0 ? (int) $r[5] <= $now - 6 * 3600000 : (int) $r[0] <= $after) continue;
            $rows[] = ['id' => $r[0], 'user_id' => $r[1], 'nickname' => $r[2], 'channel' => (int) $r[4] === 1 ? 'local' : 'all', 'text' => $r[3], 'x' => $r[6], 'z' => $r[7], 'created_at' => $r[5]];
        }
        $rows = $after === 0 ? array_slice($rows, -$hist) : array_slice($rows, 0, $page);
    } else {
        $cols = 'm.id, m.user_id, m.nickname, m.channel, m.text, m.x, m.z, m.created_at';
        $join = "JOIN users u ON u.id = m.user_id AND u.status = 'active'";
        if ($after === 0) {
            $rows = array_reverse(Db::all("SELECT $cols FROM chat_messages m $join WHERE m.hidden = 0 AND m.created_at > ? ORDER BY m.id DESC LIMIT $hist", [$now - 6 * 3600000]));
            // the history becomes the ring: later polls are answered without the database
            if (class_exists('Tfm\\Sync') && Sync::enabled()) {
                Sync::seedGlobal($rows, $rows ? (int) $rows[0]['id'] : (int) Db::value('SELECT COALESCE(MAX(id), 0) FROM chat_messages') + 1);
            }
        } else {
            $rows = Db::all("SELECT $cols FROM chat_messages m $join WHERE m.id > ? AND m.hidden = 0 ORDER BY m.id ASC LIMIT $page", [$after]);
        }
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
            'text' => ChatFilter::maskPII((string) $r['text']),
            'channel' => (string) $r['channel'],
            'createdAt' => (int) $r['created_at'],
        ];
    }
    // moderation since the client's last poll (rafter = its retraction cursor): lines it may already show are taken back
    $rafterRaw = V::query('rafter');
    $rafter = $rafterRaw !== null ? V::int($rafterRaw, 'rafter', 0, V::INT_MAX) : null;
    $cursor = $after > 0 && $rafter !== null ? $rafter : null;
    $gone = class_exists('Tfm\\Sync') ? Sync::retractionsLegacy($cursor) : null;   // the moderation feed of the cache …
    if ($gone === null) $gone = Retractions::since($cursor);                         // … or the table, as before
    return ['messages' => $out, 'online' => max(1, Presence::onlineCount($now)), 'lastId' => $last,
        'retracted' => ['messages' => $gone['messages'], 'users' => $gone['users'], 'upTo' => $gone['upTo']], 'retractId' => $gone['retractId']];
});
