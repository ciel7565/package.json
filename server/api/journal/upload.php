<?php
/**
 * POST api/journal/upload.php  multipart/form-data, field "photo" (PNG/JPEG/WEBP ≤ 5 MB)
 * → {url:'uploads/journal/YYYY/MM/<random>.jpg', width, height, size, mime, id}
 * See lib/Upload.php for the validation pipeline (finfo + getimagesize + polyglot scan + GD re-encode).
 */
declare(strict_types=1);

require __DIR__ . '/../../lib/bootstrap.php';

use Tfm\{Api, ApiException, Ctx, Session, Upload};

Api::run(['method' => 'POST', 'auth' => true, 'rate' => 'upload'], function (Ctx $c): array {
    Session::close();
    $len = (int) ($_SERVER['CONTENT_LENGTH'] ?? 0);
    if (empty($_FILES) && $len > 0) throw new ApiException(413, 'UPLOAD_TOO_LARGE', '사진이 너무 커요. 5MB 이하로 올려 주세요.');
    return Upload::journalPhoto($c->user, 'photo');
});
