<?php
/**
 * GET api/player/get.php → {save: {version, revision, savedAt, data:{…state…}} | null, sub:{tier,status,expiresAt,autoRenew}}
 * (client: G.save.ServerAdapter.load; null = new player). `sub` is the server's current subscription state — the
 * stored copy's own `sub` is overwritten with it, so a save never carries a stale tier back into the app.
 */
declare(strict_types=1);

require __DIR__ . '/../../lib/bootstrap.php';

use Tfm\Api;
use Tfm\Ctx;
use Tfm\Db;
use Tfm\Json;
use Tfm\Log;
use Tfm\Session;
use Tfm\Subscription;

Api::run(['method' => 'GET', 'auth' => true, 'rate' => 'player_get'], function (Ctx $c): array {
    $sub = Subscription::state($c->uid());
    Session::close(); // read-only: release the session lock
    $row = Db::one('SELECT version, revision, data, saved_at FROM player_saves WHERE user_id = ?', [$c->uid()]);
    if (!$row) return ['save' => null, 'sub' => $sub];
    $data = Json::tryDecode((string) $row['data'], false, 512);
    if (!$data instanceof \stdClass) {
        Log::error('SAVE', 'stored save is not valid JSON', ['uid' => $c->uid()]);
        return ['save' => null, 'corrupted' => true, 'sub' => $sub];
    }
    $data->sub = (object) ($sub + ['source' => 'server']);
    return ['save' => ['version' => (int) $row['version'], 'revision' => (int) $row['revision'], 'savedAt' => (int) $row['saved_at'], 'data' => $data], 'sub' => $sub];
});
