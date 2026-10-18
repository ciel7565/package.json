<?php
/**
 * POST api/player/save.php  {version, checksum, base?, data:{…state…}}     (fetch, header X-CSRF-Token)
 *                           {version, checksum, base?, data:{…}, csrf:"…"} (navigator.sendBeacon on page hide)
 * → {savedAt, revision, size}
 *
 * base (optional int): the revision this state was loaded from / last saved as (get.php / save.php answers). When
 * the stored revision is newer — another tab or device saved since — the save is refused with HTTP 409
 * {error:{code:'STALE_SAVE'}, data:{save:{…stored copy…}}} so an old copy never overwrites newer progress.
 * Without base (older clients) the save is accepted as before.
 *
 * The save is validated against the previously accepted save (lib/SaveValidator.php). On violation:
 * HTTP 409 {error:{code:'VALIDATION_FAILED'}, data:{save:{version, revision, savedAt, data}, violations:[codes]}}
 * and the client restores the stored copy. profile.id / role are immutable; nickname / email are forced
 * to the account values.
 */
declare(strict_types=1);

require __DIR__ . '/../../lib/bootstrap.php';

use Tfm\{Api, ApiException, Audit, Clock, Config, Ctx, Db, GameData, Http, Log, SaveValidator, Users};

Api::run(['method' => 'POST', 'auth' => true, 'csrfBody' => true, 'rate' => 'player_save'], function (Ctx $c): array {
    $max = (int) Config::get('save.max_bytes', 0) ?: (int) GameData::limit('saveMaxBytes', 1500000);
    if (!Http::isJsonRequest()) throw new ApiException(415, 'UNSUPPORTED_MEDIA_TYPE', 'JSON 형식으로 보내 주세요.');
    try {
        $raw = Http::body($max + 8192);
    } catch (ApiException $e) {
        throw new ApiException(413, 'SAVE_TOO_LARGE', '저장 데이터가 너무 커요. 오래된 사진이나 작업일지 사진을 정리한 뒤 다시 저장해 주세요.');
    }
    try { $env = json_decode($raw, false, 64, JSON_THROW_ON_ERROR); }
    catch (\JsonException) { throw new ApiException(400, 'INVALID_JSON', '저장 데이터 형식이 올바르지 않아요.'); }
    if (!$env instanceof \stdClass) throw new ApiException(400, 'INVALID_JSON', '저장 데이터 형식이 올바르지 않아요.');
    $c->checkBodyCsrf($env->csrf ?? null); // only enforced when the X-CSRF-Token header was absent (beacon)
    $data = $env->data ?? null;
    if (!$data instanceof \stdClass) throw new ApiException(400, 'INVALID_SAVE', '저장 데이터 형식이 올바르지 않아요.');
    $checksum = is_string($env->checksum ?? null) ? substr($env->checksum, 0, 32) : '';
    $base = is_int($env->base ?? null) && $env->base >= 0 ? $env->base : null;

    // integrity: the client's cyrb53 checksum over JSON.stringify(state) (detects truncated/corrupted uploads)
    if ($checksum !== '' && Config::get('save.verify_checksum', true) && strlen($raw) <= (int) Config::get('save.checksum_max_bytes', 800000)) {
        $slice = SaveValidator::rawDataSlice($raw);
        if ($slice !== null && !hash_equals(SaveValidator::cyrb53($slice), $checksum)) {
            Log::warn('SAVE', 'checksum mismatch', ['uid' => $c->uid(), 'bytes' => strlen($raw)]);
            throw new ApiException(400, 'CHECKSUM_MISMATCH', '저장 데이터가 전송 중에 손상되었어요. 잠시 후 다시 저장할게요.');
        }
    }

    $user = $c->user;
    $uid = $c->uid();
    $now = Clock::ms();
    $validate = (bool) Config::get('save.validate', true) && !($c->isAdmin() && Config::get('save.admin_bypass', false));

    $result = Db::tx(function () use ($data, $user, $uid, $now, $validate, $checksum, $raw, $base) {
        $row = Db::one('SELECT * FROM player_saves WHERE user_id = ?' . Db::forUpdate(), [$uid]);
        $prev = null;
        if ($row) {
            $prev = json_decode((string) $row['data'], false, 512);
            if (!$prev instanceof \stdClass) $prev = null;
        }
        if ($base !== null && $row && $base < (int) $row['revision']) return ['ok' => false, 'stale' => true, 'row' => $row, 'prev' => $prev];
        $meta = $row ? (json_decode((string) $row['meta'], true) ?: []) : [];
        $prevAt = $row ? (int) $row['saved_at'] : (int) $user['created_at'];
        $res = ['ok' => true, 'meta' => $meta, 'violations' => [], 'summary' => [], 'notes' => []];
        if ($validate) $res = SaveValidator::validate($data, $prev, is_array($meta) ? $meta : [], $user, $prevAt, $now);
        if (!$res['ok']) {
            if ($row) Db::exec('UPDATE player_saves SET rejects = rejects + 1, last_reject_at = ? WHERE user_id = ?', [$now, $uid]);
            return ['ok' => false, 'row' => $row, 'prev' => $prev, 'res' => $res];
        }
        // immutable / account-owned profile fields
        if (!isset($data->profile) || !$data->profile instanceof \stdClass) $data->profile = new \stdClass();
        $data->profile->id = (string) $uid;
        $data->profile->role = $user['role'] === 'admin' ? 'admin' : 'user';
        $data->profile->nickname = (string) $user['nickname'];
        $data->profile->email = (string) $user['email'];
        $json = json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE);
        if ($json === false) throw new ApiException(400, 'INVALID_SAVE', '저장 데이터 형식이 올바르지 않아요.');
        $metaJson = json_encode($res['meta'], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) ?: '{}';
        $rev = $row ? (int) $row['revision'] + 1 : 1;
        Db::upsert('player_saves', [
            'user_id' => $uid,
            'version' => is_int($data->version ?? null) ? $data->version : 1,
            'revision' => $rev,
            'data' => $json,
            'checksum' => $checksum,
            'size_bytes' => strlen($json),
            'meta' => $metaJson,
            'backup_data' => $row ? (string) $row['data'] : null,
            'backup_saved_at' => $row ? (int) $row['saved_at'] : 0,
            'saved_at' => $now,
            'created_at' => $row ? (int) $row['created_at'] : $now,
            'rejects' => $row ? (int) $row['rejects'] : 0,
            'last_reject_at' => $row ? (int) $row['last_reject_at'] : 0,
        ], ['user_id']);
        $p = SaveValidator::profileSummary($data);
        Db::upsert('user_profiles', ['user_id' => $uid] + $p + ['updated_at' => $now], ['user_id']);
        if (in_array('reset', $res['notes'] ?? [], true)) Audit::log('save_reset', $uid);
        return ['ok' => true, 'rev' => $rev, 'size' => strlen($json), 'summary' => $res['summary'] ?? []];
    });

    $stored = fn (?array $row, ?object $prev): array => [
        'version' => $row ? (int) $row['version'] : 1,
        'revision' => $row ? (int) $row['revision'] : 0,
        'savedAt' => $row ? (int) $row['saved_at'] : 0,
        'data' => $prev,
    ];
    if (!empty($result['stale'])) {
        Log::info('SAVE', 'stale save refused', ['uid' => $uid, 'base' => $base, 'stored' => (int) $result['row']['revision']]);
        throw new ApiException(409, 'STALE_SAVE', '다른 창이나 기기에서 더 새로 저장했어요. 이 창의 진행 상황은 저장하지 않았어요.', ['save' => $stored($result['row'], $result['prev'])]);
    }
    if (!$result['ok']) {
        $res = $result['res'];
        $codes = array_values(array_unique(array_map(fn ($v) => $v['code'], $res['violations'])));
        Audit::log('save_rejected', $uid, ['violations' => array_slice($res['violations'], 0, 8), 'summary' => $res['summary'] ?? []], 'warn');
        $row = $result['row'];
        throw new ApiException(409, 'VALIDATION_FAILED', '서버 검증에 실패해 이번 진행 상황은 저장하지 않았어요. 서버에 저장된 진행 상황으로 되돌립니다.', [
            'save' => $stored($row, $result['prev']),
            'violations' => $codes,
        ]);
    }
    if (($result['summary']['unexplained']['value'] ?? 0) > 0 || ($result['summary']['unexplained']['exp'] ?? 0) > 0) {
        Log::debug('SAVE', 'accepted with tolerance', ['uid' => $uid] + $result['summary']);
    }
    return ['savedAt' => $now, 'revision' => $result['rev'], 'size' => $result['size']];
});
