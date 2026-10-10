<?php
/**
 * POST api/chat/report.php  {target, targetId?, messageId?, text?, reason, memo?}  → {reportId, duplicate}
 * The reported text is taken from the server copy when the message id is known. A message reported by
 * 3 different accounts is hidden automatically until an admin reviews it (admin.php).
 */
declare(strict_types=1);

require __DIR__ . '/../../lib/bootstrap.php';

use Tfm\{Api, ApiException, Audit, Config, Ctx, Db, Users};

Api::run(['method' => 'POST', 'auth' => true, 'rate' => 'chat_report'], function (Ctx $c): array {
    $b = $c->json(8192);
    $reasons = (array) Config::get('chat.reasons', ['abuse', 'spam', 'harass', 'privacy', 'etc']);
    $reason = is_string($b['reason'] ?? null) && in_array($b['reason'], $reasons, true) ? $b['reason'] : 'etc';
    $target = Users::cleanText(is_string($b['target'] ?? null) ? $b['target'] : '', 40);
    $memo = Users::cleanText(is_string($b['memo'] ?? null) ? $b['memo'] : '', 200);
    $mid = (is_int($b['messageId'] ?? null) || (is_string($b['messageId'] ?? null) && ctype_digit($b['messageId']))) ? (int) $b['messageId'] : 0;
    $tid = (is_int($b['targetId'] ?? null) || (is_string($b['targetId'] ?? null) && ctype_digit($b['targetId']))) ? (int) $b['targetId'] : 0;
    $text = Users::cleanText(is_string($b['text'] ?? null) ? $b['text'] : '', 300);
    $msg = $mid > 0 ? Db::one('SELECT id, user_id, nickname, text FROM chat_messages WHERE id = ?', [$mid]) : null;
    if ($msg) { $tid = (int) $msg['user_id']; $target = (string) $msg['nickname']; $text = (string) $msg['text']; }
    elseif ($tid > 0) { $tu = Users::byId($tid); $tid = $tu ? (int) $tu['id'] : 0; if ($tu) $target = (string) $tu['nickname']; }
    elseif ($target !== '') { $tu = Users::byNickname($target); $tid = $tu ? (int) $tu['id'] : 0; }
    if ($target === '') throw new ApiException(400, 'TARGET_REQUIRED', '신고할 대상을 확인할 수 없어요.');
    if ($tid === $c->uid()) throw new ApiException(400, 'SELF_REPORT', '자기 자신은 신고할 수 없어요.');
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
            Audit::log('message_auto_hidden', $tid ?: null, ['message' => (int) $msg['id'], 'reports' => $n], 'warn');
        }
    }
    return ['reportId' => $id, 'duplicate' => false];
});
