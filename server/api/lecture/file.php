<?php
/**
 * GET | HEAD api/lecture/file.php?id=<lecture id>&n=<file number, default 0>
 *   → the stored file itself (not JSON): one picture of an image deck, the pdf or the pptx of a lecture.
 * The same audience rule as the list is applied to EVERY file: a lecture that is not there, is switched off or is not
 * for this caller answers 404 NOT_FOUND (JSON) — an id never tells whether a lecture exists.
 * The answer (Tfm\Lecture::stream): the stored type (never sniffed from the bytes or a name), X-Content-Type-Options:
 * nosniff, a sandbox Content-Security-Policy, Content-Disposition inline for pdf / pictures and attachment for pptx,
 * Cache-Control: private, an ETag (304), and one byte range (206; Range: bytes=a-b | a- | -n) for the pdf viewer.
 * Files are never served by the web server itself: they live in data/lectures/ under random names.
 * 400 INVALID_INPUT for a malformed parameter. Rate limit lecture_file.
 */
declare(strict_types=1);

require __DIR__ . '/../../lib/bootstrap.php';

use Tfm\Api;
use Tfm\Ctx;
use Tfm\Lecture;
use Tfm\V;

Api::run(['method' => ['GET', 'HEAD'], 'rate' => 'lecture_file'], function (Ctx $c): array {
    V::keys($_GET, ['id', 'n'], 'query');
    $id = V::id(V::query('id'), 'id');
    $n = V::query('n') === null ? 0 : V::int(V::query('n'), 'n', 0, 999);
    $file = Lecture::fileFor($id, $n, $c->user);
    Lecture::stream($file, $id); // sends the file and ends the request
    return [];
});
