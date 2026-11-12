<?php
/**
 * POST api/farm/report-photo.php  multipart/form-data: file field "photo" + field "reportId"  → {url, width, height, size, mime}
 * Attaches ONE photo (a canvas snapshot of the bed) to the caller's own pending completion request (CONTRACT §15.3,
 * §15.7 #14). Another account's report, an unknown or a decided one → 404 NOT_FOUND (checked before the file is read);
 * a report that has a photo already → 409 PHOTO_EXISTS. The photo goes through Tfm\Upload: JPEG / PNG only, judged by the
 * bytes (finfo + getimagesize — never the file name or the browser's Content-Type), ≤ farm.photo_max_bytes (1 MB), pixel /
 * memory caps, script / markup polyglots refused, then re-encoded with GD (no EXIF / GPS / comments / trailing data
 * survive) and scaled down to ≤ farm.photo_max_dimension (1280 px), stored under uploads/reports/YYYY/MM/<random>.jpg|png
 * like the journal photos (uploads/.htaccess: no script runs there, only image names are served, nosniff).
 * The url is handed to the owner only (api/farm/reports.php); admins see the photo through the admin site (Farm::photoPath).
 * Login, CSRF, rate limit farm_photo; one file, no other fields.
 */
declare(strict_types=1);

require __DIR__ . '/../../lib/bootstrap.php';

use Tfm\Api;
use Tfm\ApiException;
use Tfm\Audit;
use Tfm\Config;
use Tfm\Ctx;
use Tfm\Farm;
use Tfm\Http;
use Tfm\Session;
use Tfm\Upload;
use Tfm\V;

Api::run(['method' => 'POST', 'auth' => true, 'rate' => 'farm_photo', 'upload' => true], function (Ctx $c): array {
    Session::close();
    $max = max(1024, (int) Config::get('farm.photo_max_bytes', 1048576));
    if (!Http::hasUpload()) throw new ApiException(415, 'UNSUPPORTED_MEDIA_TYPE', '사진은 multipart/form-data 로 보내 주세요.');
    $len = (int) (isset($_SERVER['CONTENT_LENGTH']) ? $_SERVER['CONTENT_LENGTH'] : 0);
    // PHP drops the whole body (no fields, no files) when it is larger than post_max_size
    if (empty($_FILES) && empty($_POST) && $len > 0) throw new ApiException(413, 'UPLOAD_TOO_LARGE', '사진이 너무 커요. 1MB 이하로 올려 주세요.');
    V::keys($_POST, ['reportId'], 'form');
    foreach (array_keys($_FILES) as $field) if ((string) $field !== 'photo') V::fail((string) $field, '항목은 여기에서 쓸 수 없어요.');
    $reportId = V::id(isset($_POST['reportId']) ? $_POST['reportId'] : null, 'reportId');
    Farm::photoTarget($c->uid(), $reportId); // the caller's own pending report, before the file is touched
    $up = Upload::image($c->user, 'photo', [
        'maxBytes' => $max,
        'maxDimension' => max(64, (int) Config::get('farm.photo_max_dimension', 1280)),
        'subdir' => 'reports',
        'types' => ['image/jpeg', 'image/png'],
        'record' => false,   // one photo per report (crop_reports.photo) — not a journal photo
    ]);
    try {
        Farm::setPhoto($c->uid(), $reportId, $up['url']);
    } catch (\Throwable $e) {
        Upload::discard($up['url']); // lost the race to another upload of the same report: keep no orphan file
        throw $e;
    }
    Audit::log('crop_report_photo', $c->uid(), ['id' => $reportId, 'bytes' => $up['size'], 'mime' => $up['mime']]);
    return ['url' => $up['url'], 'width' => $up['width'], 'height' => $up['height'], 'size' => $up['size'], 'mime' => $up['mime']];
});
