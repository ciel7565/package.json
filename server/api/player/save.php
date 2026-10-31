<?php
/**
 * POST api/player/save.php  {version, checksum, base?, data:{…state…}}     (fetch, header X-CSRF-Token)
 *                           {version, checksum, base?, data:{…}, csrf:"…"} (navigator.sendBeacon on page hide)
 * → {savedAt, revision, size, sub, subChanged}
 *   sub = the server's subscription {tier, status, expiresAt, autoRenew}: EVERY answer carries it (also the 4xx ones,
 *   under data.sub, once the request passed its CSRF check), with subChanged:true when the uploaded state showed
 *   another tier than the server's — the client applies it (G.sys.speed.setFromServer) so the HUD chip follows.
 *
 * base (optional int): the revision this state was loaded from / last saved as (get.php / save.php answers). When
 * the stored revision is newer — another tab or device saved since — the save is refused with HTTP 409
 * {error:{code:'STALE_SAVE'}, data:{save:{…stored copy…}[, restored:true]}} so an old copy never overwrites newer
 * progress. restored:true = the stored copy is the one admin.php "직전 저장으로 되돌리기" put back (meta.restoredRev is
 * still the row's revision; the stored copy then also carries save.restoredAt / save.restoredRev): the client loads it
 * and drops the progress it kept for later. Without base (older clients) the save is accepted as before.
 *
 * The save is validated against the previously accepted save (lib/SaveValidator.php) with the user's speed tier
 * (subscriptions table) scaling the time thresholds. On violation: HTTP 409 {error:{code:'VALIDATION_FAILED'},
 * data:{save:{version, revision, savedAt, data}, violations:[codes]}} and the client restores the stored copy.
 * profile.id is immutable; role / nickname / email and `sub` are forced to the account values (the client's `sub`
 * is ignored, like a stale role: stored as the server's, never refused).
 */
declare(strict_types=1);

require __DIR__ . '/../../lib/bootstrap.php';

use Tfm\Api;
use Tfm\ApiException;
use Tfm\Audit;
use Tfm\Clock;
use Tfm\Config;
use Tfm\Ctx;
use Tfm\Db;
use Tfm\GameData;
use Tfm\Http;
use Tfm\Json;
use Tfm\Log;
use Tfm\SaveValidator;
use Tfm\Subscription;

Api::run(['method' => 'POST', 'auth' => true, 'csrfBody' => true, 'rate' => 'player_save'], function (Ctx $c): array {
    // Every answer of this endpoint carries the server's subscription (data.sub, plus subChanged when the client's
    // copy showed another tier) once the request is known to be genuine: a fetch save's X-CSRF-Token was checked by
    // Api::run already; a page-hide beacon is checked from its body below (its answer is never read anyway). Nothing
    // runs before that check — Subscription::state() may settle a renewal (CONTRACT §14.1 / §14.6).
    $sub = $c->csrfPending ? null : Subscription::state($c->uid());
    $clientTier = null;
    try {
        $max = (int) Config::get('save.max_bytes', 0) ?: (int) GameData::limit('saveMaxBytes', 1500000);
        if (!Http::isJsonRequest()) throw new ApiException(415, 'UNSUPPORTED_MEDIA_TYPE', 'JSON 형식으로 보내 주세요.');
        try {
            $raw = Http::body($max + 8192);
        } catch (ApiException $e) {
            throw new ApiException(413, 'SAVE_TOO_LARGE', '저장 데이터가 너무 커요. 오래된 사진이나 작업일지 사진을 정리한 뒤 다시 저장해 주세요.');
        }
        try { $env = Json::decode($raw, false, 64); }
        catch (\UnexpectedValueException $e) { throw new ApiException(400, 'INVALID_JSON', '저장 데이터 형식이 올바르지 않아요.'); }
        if (!$env instanceof \stdClass) throw new ApiException(400, 'INVALID_JSON', '저장 데이터 형식이 올바르지 않아요.');
        $c->checkBodyCsrf(isset($env->csrf) ? $env->csrf : null); // only enforced when the X-CSRF-Token header was absent (beacon)
        if ($sub === null) $sub = Subscription::state($c->uid()); // a beacon: genuine only from here on
        $data = isset($env->data) ? $env->data : null;
        if (!$data instanceof \stdClass) throw new ApiException(400, 'INVALID_SAVE', '저장 데이터 형식이 올바르지 않아요.');
        // what the client believed (its G.state.sub): answers say subChanged when the server's tier is another one
        $clientTier = isset($data->sub) && $data->sub instanceof \stdClass && isset($data->sub->tier) && is_int($data->sub->tier) ? $data->sub->tier : null;
        SaveValidator::assertNoProtoKeys($data); // 'constructor' / '__proto__' map keys would be served on every login
        $checksum = isset($env->checksum) && is_string($env->checksum) ? substr($env->checksum, 0, 32) : '';
        $base = isset($env->base) && is_int($env->base) && $env->base >= 0 ? $env->base : null;

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
        // the subscription is the server's: the client's `sub` is ignored (stored as the server state, like a stale role)
        $tier = (int) $sub['tier'];

        $result = Db::tx(function () use ($data, $user, $uid, $now, $validate, $checksum, $raw, $base, $sub, $tier) {
            $row = Db::one('SELECT * FROM player_saves WHERE user_id = ?' . Db::forUpdate(), [$uid]);
            $prev = null;
            if ($row) {
                $prev = Json::tryDecode((string) $row['data'], false, 512);
                if (!$prev instanceof \stdClass) $prev = null;
            }
            if ($base !== null && $row && $base < (int) $row['revision']) return ['ok' => false, 'stale' => true, 'row' => $row, 'prev' => $prev];
            $meta = $row ? Json::tryDecode((string) $row['meta'], true) : [];
            if (!is_array($meta)) $meta = [];
            $prevAt = $row ? (int) $row['saved_at'] : (int) $user['created_at'];
            $res = ['ok' => true, 'meta' => $meta, 'violations' => [], 'summary' => [], 'notes' => []];
            if ($validate) $res = SaveValidator::validate($data, $prev, $meta, $user, $prevAt, $now, $tier);
            else $res['meta']['tier'] = $tier;
            if (!$res['ok']) {
                if ($row) Db::exec('UPDATE player_saves SET rejects = rejects + 1, last_reject_at = ? WHERE user_id = ?', [$now, $uid]);
                return ['ok' => false, 'row' => $row, 'prev' => $prev, 'res' => $res];
            }
            // immutable / account-owned fields
            if (!isset($data->profile) || !$data->profile instanceof \stdClass) $data->profile = new \stdClass();
            $data->profile->id = (string) $uid;
            $data->profile->role = $user['role'] === 'admin' ? 'admin' : 'user';
            $data->profile->nickname = (string) $user['nickname'];
            $data->profile->email = (string) $user['email'];
            $data->sub = (object) ($sub + ['source' => 'server']);
            $json = json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE);
            if (!is_string($json)) throw new ApiException(400, 'INVALID_SAVE', '저장 데이터 형식이 올바르지 않아요.');
            if (is_array($res['meta'])) unset($res['meta']['restoredRev'], $res['meta']['restoredAt']); // a new copy: not the restored one
            if (in_array('role', isset($res['notes']) ? $res['notes'] : [], true)) Log::info('SAVE', 'profile.role differed from the account role (stored as the account role)', ['uid' => $uid]);
            $metaJson = json_encode($res['meta'], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
            if (!is_string($metaJson)) $metaJson = '{}';
            $rev = $row ? (int) $row['revision'] + 1 : 1;
            Db::upsert('player_saves', [
                'user_id' => $uid,
                'version' => isset($data->version) && is_int($data->version) ? $data->version : 1,
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
            if (in_array('reset', isset($res['notes']) ? $res['notes'] : [], true)) Audit::log('save_reset', $uid);
            return ['ok' => true, 'rev' => $rev, 'size' => strlen($json), 'summary' => isset($res['summary']) ? $res['summary'] : []];
        });

        $stored = function (?array $row, ?object $prev) use ($sub): array {
            if ($prev instanceof \stdClass) $prev->sub = (object) ($sub + ['source' => 'server']);
            return [
                'version' => $row ? (int) $row['version'] : 1,
                'revision' => $row ? (int) $row['revision'] : 0,
                'savedAt' => $row ? (int) $row['saved_at'] : 0,
            ] + SaveValidator::restoreStamp($row) + ['data' => $prev];
        };
        if (!empty($result['stale'])) {
            $row = $result['row'];
            $restored = SaveValidator::restoreStamp($row)['restoredRev'] > 0;
            Log::info('SAVE', 'stale save refused', ['uid' => $uid, 'base' => $base, 'stored' => (int) $row['revision'], 'restored' => $restored]);
            throw new ApiException(409, 'STALE_SAVE', '다른 창이나 기기에서 더 새로 저장했어요. 이 창의 진행 상황은 저장하지 않았어요.', ['save' => $stored($row, $result['prev'])] + ($restored ? ['restored' => true] : []));
        }
        if (!$result['ok']) {
            $res = $result['res'];
            $codes = array_values(array_unique(array_map(function ($v) { return $v['code']; }, $res['violations'])));
            Audit::log('save_rejected', $uid, ['violations' => array_slice($res['violations'], 0, 8), 'summary' => isset($res['summary']) ? $res['summary'] : []], 'warn');
            $row = $result['row'];
            throw new ApiException(409, 'VALIDATION_FAILED', '서버 검증에 실패해 이번 진행 상황은 저장하지 않았어요. 서버에 저장된 진행 상황으로 되돌립니다.', [
                'save' => $stored($row, $result['prev']),
                'violations' => $codes,
            ]);
        }
        $un = isset($result['summary']['unexplained']) ? $result['summary']['unexplained'] : [];
        if ((isset($un['value']) ? $un['value'] : 0) > 0 || (isset($un['exp']) ? $un['exp'] : 0) > 0) {
            Log::debug('SAVE', 'accepted with tolerance', ['uid' => $uid] + $result['summary']);
        }
        return ['savedAt' => $now, 'revision' => $result['rev'], 'size' => $result['size'], 'sub' => $sub, 'subChanged' => $clientTier !== $tier];
    } catch (ApiException $e) {
        if ($sub !== null && ($e->data === null || is_array($e->data))) {
            $e->data = (is_array($e->data) ? $e->data : []) + ['sub' => $sub, 'subChanged' => $clientTier !== (int) $sub['tier']];
        }
        throw $e;
    }
});
