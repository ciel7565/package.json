<?php
/**
 * POST api/chat/send.php  {text, channel:'all'|'local'}  → {message:{id, userId, nickname, text, channel, createdAt}}
 * Accounts only. ≤ 120 chars, control/invisible characters removed, bad words masked (♡♡), 1 message/s,
 * 20/min, identical text within 30 s rejected (repeat spam), muted/banned accounts rejected.
 */
declare(strict_types=1);

require __DIR__ . '/../../lib/bootstrap.php';

use Tfm\{Api, ApiException, ChatFilter, Config, Ctx, Db, Log, Presence, Users};

Api::run(['method' => 'POST', 'auth' => true, 'rate' => 'chat_send'], function (Ctx $c): array {
    $b = $c->json(4096);
    $max = (int) Config::get('chat.max_length', 120);
    $text = Users::cleanText(is_string($b['text'] ?? null) ? $b['text'] : '', 1000);
    if ($text === '') throw new ApiException(400, 'EMPTY_MESSAGE', '메시지를 입력해 주세요.');
    if (mb_strlen($text) > $max) throw new ApiException(400, 'MESSAGE_TOO_LONG', "메시지는 {$max}자까지 보낼 수 있어요.");
    $channel = ($b['channel'] ?? 'all') === 'local' ? 'local' : 'all';
    $u = $c->user;
    $now = $c->now;
    if ((int) $u['muted_until'] > $now) {
        $min = (int) ceil(((int) $u['muted_until'] - $now) / 60000);
        throw new ApiException(403, 'MUTED', "채팅이 잠시 제한되었어요. ({$min}분 남음)");
    }
    $key = ChatFilter::key($text);
    $masked = ChatFilter::mask($text);
    $pos = $channel === 'local' ? Presence::position($c->uid(), $now) : null;
    $id = Db::tx(function () use ($c, $u, $now, $key, $masked, $channel, $pos) {
        $recent = Db::all('SELECT created_at, text_key FROM chat_messages WHERE user_id = ? ORDER BY id DESC LIMIT 3', [$c->uid()]);
        if ($recent && $now - (int) $recent[0]['created_at'] < (int) Config::get('chat.min_interval_ms', 1000)) {
            throw new ApiException(429, 'RATE_LIMITED', '메시지를 너무 빨리 보내고 있어요. 잠시 후 다시 보내 주세요.', null, ['Retry-After: 1']);
        }
        $win = (int) Config::get('chat.duplicate_window', 30) * 1000;
        foreach ($recent as $r) {
            if ($now - (int) $r['created_at'] <= $win && hash_equals((string) $r['text_key'], $key)) {
                throw new ApiException(409, 'DUPLICATE_MESSAGE', '같은 메시지를 연달아 보낼 수 없어요. 조금 뒤에 다시 보내 주세요.');
            }
        }
        return Db::insert('chat_messages', [
            'user_id' => $c->uid(), 'nickname' => (string) $u['nickname'], 'channel' => $channel, 'text' => $masked, 'text_key' => $key,
            'x' => $pos['x'] ?? null, 'z' => $pos['z'] ?? null, 'hidden' => 0, 'created_at' => $now,
        ]);
    });
    if ($masked !== $text) Log::info('CHAT', 'message masked', ['uid' => $c->uid(), 'id' => $id]);
    return ['message' => ['id' => $id, 'userId' => (string) $c->uid(), 'nickname' => (string) $u['nickname'], 'text' => $masked, 'channel' => $channel, 'createdAt' => $now]];
});
