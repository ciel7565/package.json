<?php
/**
 * POST api/support/create.php — a new report or question (CONTRACT §18.1) → {ticket, unread}
 *   multipart/form-data: kind, category, body?, meta? (JSON text ≤ 4 KB), targetId? / targetName? / messageId? (a 🚨
 *   report only) + optional file field "shot" (the picture of the screen: jpeg / png / webp ≤ support.shot_kb, judged by
 *   its bytes, re-encoded as JPEG, stored under data/support/ with a random name — Tfm\Upload::supportShot)
 *   or application/json with the same fields and no picture.
 * Login + CSRF (header). The account's limits (support.per_hour / per_day / max_open) → 429 SUPPORT_LIMIT; switched
 * off → 403 SUPPORT_OFF; a picture while pictures are off → 400 SHOT_OFF; unknown fields / files → 400. Text ≤ 1,000
 * characters through the bad-word filter and the personal-data mask. Rate limit support_create.
 */
declare(strict_types=1);

require __DIR__ . '/../../lib/bootstrap.php';

use Tfm\Api;
use Tfm\ApiException;
use Tfm\Ctx;
use Tfm\Http;
use Tfm\Session;
use Tfm\Support;
use Tfm\V;

Api::run(['method' => 'POST', 'auth' => true, 'rate' => 'support_create', 'upload' => true], function (Ctx $c): array {
    $fields = ['kind', 'category', 'body', 'meta', 'targetId', 'targetName', 'messageId'];
    $shot = false;
    if (Http::hasUpload()) {
        $len = (int) (isset($_SERVER['CONTENT_LENGTH']) ? $_SERVER['CONTENT_LENGTH'] : 0);
        // PHP drops the whole body (no fields, no files) when it is larger than post_max_size
        if (empty($_FILES) && empty($_POST) && $len > 0) throw new ApiException(413, 'UPLOAD_TOO_LARGE', '화면 사진이 너무 커요. 1.5MB 이하로 보내 주세요.');
        V::keys($_POST, $fields, 'form');
        foreach (array_keys($_FILES) as $field) if ((string) $field !== 'shot') V::fail((string) $field, '항목은 여기에서 쓸 수 없어요.');
        $in = [];
        foreach ($_POST as $k => $v) {
            if (!is_string($v)) V::fail((string) $k, '글자여야 해요.');
            $in[(string) $k] = $v;
        }
        $shot = isset($_FILES['shot']) && is_array($_FILES['shot']) && (isset($_FILES['shot']['error']) ? $_FILES['shot']['error'] : UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_NO_FILE;
    } else {
        $in = $c->json(16384);
        V::keys($in, $fields);
        foreach ($in as $k => $v) if ($v !== null && !is_string($v) && !is_int($v) && !($k === 'meta' && is_array($v))) V::fail((string) $k, '값이 올바르지 않아요.');
    }
    Session::close();
    $t = Support::create($c->user, $in, $shot);
    return ['ticket' => $t, 'unread' => Support::unread($c->uid())];
});
