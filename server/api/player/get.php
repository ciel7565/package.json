<?php
/**
 * GET api/player/get.php → {save: {version, revision, savedAt, restoredAt, restoredRev, data:{…state…}} | null,
 *                           sub:{tier,status,expiresAt,autoRenew}, restoredAt, restoredRev}
 * (client: G.save.ServerAdapter.load; null = new player). `sub` is the server's current subscription state — the
 * stored copy's own `sub` is overwritten with it, so a save never carries a stale tier back into the app.
 * restoredAt / restoredRev (ms / revision, 0 = none): the stored copy is the one admin.php "직전 저장으로 되돌리기"
 * put back (until the next accepted save). 70-app offerPending drops a copy the device kept from before that time
 * (R3-c2-r2-seams-lost-1).
 * rt (CONTRACT §15.1): {scale, tier, beds: {RB1: {pid, cropId, firstSeenAt, readyAt, status}, …}} — the server's own times
 * of the real-time beds (lib/Farm.php), adopted by the client with G.sys.realfarm.applyServer(rt).
 */
declare(strict_types=1);

require __DIR__ . '/../../lib/bootstrap.php';

use Tfm\Api;
use Tfm\Ctx;
use Tfm\Db;
use Tfm\Farm;
use Tfm\Json;
use Tfm\Log;
use Tfm\SaveValidator;
use Tfm\Session;
use Tfm\Subscription;

Api::run(['method' => 'GET', 'auth' => true, 'rate' => 'player_get'], function (Ctx $c): array {
    $sub = Subscription::state($c->uid());
    Session::close(); // read-only: release the session lock
    $row = Db::one('SELECT version, revision, data, saved_at, meta FROM player_saves WHERE user_id = ?', [$c->uid()]);
    $stamp = SaveValidator::restoreStamp($row);
    $rt = class_exists('Tfm\Farm') ? ['rt' => Farm::view($c->uid(), (int) $sub['tier'])] : [];
    if (!$row) return ['save' => null, 'sub' => $sub] + $stamp + $rt;
    $data = Json::tryDecode((string) $row['data'], false, 512);
    if (!$data instanceof \stdClass) {
        Log::error('SAVE', 'stored save is not valid JSON', ['uid' => $c->uid()]);
        return ['save' => null, 'corrupted' => true, 'sub' => $sub] + $stamp + $rt;
    }
    $data->sub = (object) ($sub + ['source' => 'server']);
    return ['save' => ['version' => (int) $row['version'], 'revision' => (int) $row['revision'], 'savedAt' => (int) $row['saved_at']] + $stamp + ['data' => $data], 'sub' => $sub] + $stamp + $rt;
});
