<?php
/**
 * GET api/lecture/list.php[?v=<version>]
 *   → {v, lectures: [{id, title, kind, yt?, url?, files?: [{n, type, w, h, bytes}], place, autoplay, sort, office?}], opt: {autoOpen}}
 *   or {v, same: true} when the caller already has this version.
 * The lectures of the 강의실 that THIS caller may see (CONTRACT §17.3): switched-on lectures whose audience fits —
 * all (everybody) · member (a logged-in account) · paid (a live plan) · allot (a live allotment contract); an
 * administrator sees every switched-on lecture. kind: youtube (yt = the 11-character video id) · slides / link (url =
 * a checked https address; `link` is never framed by the app) · pdf / images / pptx (files, fetched one by one through
 * api/lecture/file.php?id=&n=). place: '' | a place id | '*'. No login needed (a visitor gets the `all` lectures).
 * 400 INVALID_INPUT for a malformed parameter. Rate limit lecture_list.
 */
declare(strict_types=1);

require __DIR__ . '/../../lib/bootstrap.php';

use Tfm\Api;
use Tfm\Ctx;
use Tfm\Lecture;
use Tfm\Session;
use Tfm\V;

Api::run(['method' => 'GET', 'rate' => 'lecture_list'], function (Ctx $c): array {
    V::keys($_GET, ['v'], 'query');
    $have = V::query('v') === null ? null : V::int(V::query('v'), 'v', 0, V::INT_MAX);
    Session::close();
    $list = Lecture::publicList($c->user);
    return $have !== null && $have === $list['v'] ? ['v' => $list['v'], 'same' => true] : $list;
});
