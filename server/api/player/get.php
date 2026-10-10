<?php
/**
 * GET api/player/get.php → {save: {version, revision, savedAt, data:{…state…}} | null}
 * (client: G.save.ServerAdapter.load; null = new player)
 */
declare(strict_types=1);

require __DIR__ . '/../../lib/bootstrap.php';

use Tfm\{Api, Ctx, Db, Log, Session};

Api::run(['method' => 'GET', 'auth' => true, 'rate' => 'player_get'], function (Ctx $c): array {
    Session::close(); // read-only: release the session lock
    $row = Db::one('SELECT version, revision, data, saved_at FROM player_saves WHERE user_id = ?', [$c->uid()]);
    if (!$row) return ['save' => null];
    $data = json_decode((string) $row['data'], false, 512);
    if (!$data instanceof \stdClass) {
        Log::error('SAVE', 'stored save is not valid JSON', ['uid' => $c->uid()]);
        return ['save' => null, 'corrupted' => true];
    }
    return ['save' => ['version' => (int) $row['version'], 'revision' => (int) $row['revision'], 'savedAt' => (int) $row['saved_at'], 'data' => $data]];
});
