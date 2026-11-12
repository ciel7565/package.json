<?php
/**
 * POST api/chat/report.php  {target, targetId?, messageId?, text?, reason, memo?}  → {reportId, duplicate}
 * The reported text is taken from the server copy when the message id is known. A message reported by
 * 3 different accounts is hidden automatically until an admin reviews it (admin.php).
 */
declare(strict_types=1);

require __DIR__ . '/../../lib/bootstrap.php';

use Tfm\Api;
use Tfm\ApiException;
use Tfm\Audit;
use Tfm\ChatFilter;
use Tfm\Config;
use Tfm\Ctx;
use Tfm\Db;
use Tfm\Presence;
use Tfm\Retractions;
use Tfm\Users;
use Tfm\V;

Api::run(['method' => 'POST', 'auth' => true, 'rate' => 'chat_report'], function (Ctx $c): array {
    // CONTRACT §15.7 #3: every field is typed. 'at' is the client's timestamp (unused by the server, accepted so a real
    // report is not refused). ids are positive integers (or the digit strings the client sends), the reason is one of the
    // known words, and the free-text fields must be strings before they are cleaned and PII-masked.
    $b = $c->json(8192);
    V::keys($b, ['target', 'targetId', 'messageId', 'text', 'reason', 'memo', 'at']);
    // 'kid' is the one-tap report of a child in easy mode (60-social _kidReport); always accepted, even when an older
    // config.local.php lists its own reasons, so a child's report never turns into a plain '기타'
    $reasons = array_merge((array) Config::get('chat.reasons', ['abuse', 'spam', 'harass', 'privacy', 'etc']), ['kid']);
    $reason = V::has($b, 'reason') ? V::enum($b['reason'], 'reason', $reasons) : 'etc';
    $target = Users::cleanText(V::has($b, 'target') ? V::str($b['target'], 'target', 80) : '', 40);
    // reports may quote personal information (reason "privacy"): admins see that something was shared, not the data
    $memo = ChatFilter::maskPII(Users::cleanText(V::has($b, 'memo') ? V::str($b['memo'], 'memo', 300) : '', 200));
    $mid = V::has($b, 'messageId') ? V::id($b['messageId'], 'messageId') : 0;
    $tid = V::has($b, 'targetId') ? V::id($b['targetId'], 'targetId') : 0;
    $text = ChatFilter::maskPII(Users::cleanText(V::has($b, 'text') ? V::str($b['text'], 'text', 300) : '', 300));
    $msg = $mid > 0 ? Db::one('SELECT id, user_id, nickname, text, channel, x, z FROM chat_messages WHERE id = ?', [$mid]) : null;
    if ($msg) { $tid = (int) $msg['user_id']; $target = (string) $msg['nickname']; $text = (string) $msg['text']; }
    elseif ($tid > 0) { $tu = Users::byId($tid); $tid = $tu ? (int) $tu['id'] : 0; if ($tu) $target = (string) $tu['nickname']; }
    elseif ($target !== '') { $tu = Users::byNickname($target); $tid = $tu ? (int) $tu['id'] : 0; }
    if ($target === '') throw new ApiException(400, 'TARGET_REQUIRED', '신고할 대상을 확인할 수 없어요.');
    // an unknown target name is free text typed by the reporter: admins never see personal information in it either
    if ($tid === 0) $target = ChatFilter::maskPII($target);
    if ($tid === $c->uid()) throw new ApiException(400, 'SELF_REPORT', '자기 자신은 신고할 수 없어요.');
    // IDOR guard (another player's chat line): a 'local' line reaches only players within chat.local_radius of the
    // sender (chat/list.php never hands it to anyone else), so only someone who could actually have received it may
    // report it. Otherwise three accounts could take any id and auto-hide a line they were never shown — a line aimed
    // at one child included. The reporter's own recent presence must be in range; admins moderate freely.
    if ($msg && (string) $msg['channel'] === 'local' && !$c->isAdmin()) {
        $mx = $msg['x'];
        $mz = $msg['z'];
        $pos = Presence::position($c->uid(), $c->now);
        $radius = (float) Config::get('chat.local_radius', 30);
        $inRange = $pos !== null && $mx !== null && $mz !== null && hypot((float) $mx - $pos['x'], (float) $mz - $pos['z']) <= $radius;
        if (!$inRange) throw new ApiException(403, 'REPORT_NOT_VISIBLE', '주변에서 받은 메시지만 신고할 수 있어요.');
    }
    // without a message the server knows, the "quote" is what the REPORTER typed: it never becomes the target's message
    // (admins would read it as the target's words), it is kept in the memo, marked as unverified
    if (!$msg && $text !== '') {
        $memo = '신고자가 적은 내용(확인 안 됨): “' . $text . '”' . ($memo !== '' ? ' · ' . $memo : '');
        $text = '';
    }
    $dup = $msg ? Db::one('SELECT id FROM chat_reports WHERE reporter_id = ? AND message_id = ?', [$c->uid(), (int) $msg['id']]) : null;
    if ($dup) return ['reportId' => (int) $dup['id'], 'duplicate' => true];
    $id = Db::insert('chat_reports', [
        'reporter_id' => $c->uid(), 'target_user_id' => $tid ?: null, 'target_name' => $target, 'message_id' => $msg ? (int) $msg['id'] : null,
        'message_text' => $text, 'reason' => $reason, 'memo' => $memo, 'status' => 'open', 'created_at' => $c->now, 'resolved_at' => 0,
    ]);
    Audit::log('chat_report', $tid ?: null, ['report' => $id, 'reason' => $reason, 'message' => $msg ? (int) $msg['id'] : null], 'info', $c->uid());
    if ($msg) {
        $n = (int) Db::value("SELECT COUNT(DISTINCT reporter_id) FROM chat_reports WHERE message_id = ? AND status = 'open'", [(int) $msg['id']]);
        if ($n >= 3 && Db::exec('UPDATE chat_messages SET hidden = 1 WHERE id = ? AND hidden = 0', [(int) $msg['id']])) {
            Retractions::add((int) $msg['id'], null); // sessions online take it back
            Audit::log('message_auto_hidden', $tid ?: null, ['message' => (int) $msg['id'], 'reports' => $n], 'warn');
        }
    }
    return ['reportId' => $id, 'duplicate' => false];
});
