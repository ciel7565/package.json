<?php
/**
 * GET api/support/mine.php[?before=<id>][&unread=1] — the caller's own reports and questions with their threads,
 * newest first (20 a page; keyset by id) → {tickets: [{id, no, kind, category, body, status, shot, shotW, shotH,
 * created, updated, answered, unread, thread: [{side: user|admin, body, at}]}], more, unread, limits}
 * ?unread=1 answers only {unread, limits} (the app asks this every few minutes to show a chip when an answer came).
 * There is no way to name another account. Login. Rate limit support_read.
 */
declare(strict_types=1);

require __DIR__ . '/../../lib/bootstrap.php';

use Tfm\Api;
use Tfm\Ctx;
use Tfm\Support;
use Tfm\V;

Api::run(['method' => 'GET', 'auth' => true, 'rate' => 'support_read'], function (Ctx $c): array {
    V::keys($_GET, ['before', 'unread'], 'query');
    if (V::query('unread') !== null) {
        V::enum(V::query('unread'), 'unread', ['1']);
        return ['unread' => Support::unread($c->uid()), 'limits' => Support::publicLimits()];
    }
    $before = V::query('before') === null ? 0 : V::id(V::query('before'), 'before');
    return Support::mine($c->uid(), $before, 20);
});
