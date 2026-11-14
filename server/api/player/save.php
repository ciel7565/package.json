<?php
/**
 * POST api/player/save.php  {version, checksum, base?, data:{…state…}}     (fetch, header X-CSRF-Token)
 *                           {version, checksum, base?, data:{…}, csrf:"…"} (navigator.sendBeacon on page hide)
 * → {savedAt, revision, size, sub, subChanged, saveEvery[, unchanged]}
 *   saveEvery (CONTRACT §16.9) = the pause the server asks for before the next save, in ms (sync.save_every, longer while
 *   the server is busy — the same number api/sync.php sends as `sv`). The page saves only when something changed, plus a
 *   heartbeat every 5 minutes.
 *   unchanged:true = the unchanged-checksum fast path: `checksum` equals the stored copy's checksum and `base` is the
 *   stored revision — the page holds exactly what is stored (an idle page's heartbeat). Nothing is judged or written;
 *   savedAt / revision / size are the stored copy's and `rt` is left out (nothing moved). The body still has to be a
 *   well-formed save (the type checks run first), but its checksum is not computed: claiming the stored checksum for
 *   another state stores nothing.
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
 *
 * Real-time beds (CONTRACT §15.1, lib/Farm.php): Tfm\Farm::plan judges data.rtfarm against the server's own records
 * inside the same transaction, as the validator's farm hook (planting times measured by the server clock, early
 * harvests → RT_HARVEST_TOO_EARLY, reused planting ids → RT_PID_REUSE, harvest counts → RT_HARVEST_COUNT); its records
 * (farm_beds, the quick-plot and 곳간 mirrors) are written only when the save is accepted. The accepted answer and both
 * 409 answers carry rt = {scale, tier, beds: {RB1: {pid, cropId, firstSeenAt, readyAt, status}, …}} — the server's times
 * (data.rt on a 409), which the client adopts with G.sys.realfarm.applyServer(rt).
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
use Tfm\Farm;
use Tfm\GameData;
use Tfm\Http;
use Tfm\Json;
use Tfm\Log;
use Tfm\SaveValidator;
use Tfm\Session;
use Tfm\Subscription;
use Tfm\Sync;

Api::run(['method' => 'POST', 'auth' => true, 'csrfBody' => true, 'rate' => 'player_save'], function (Ctx $c): array {
    // Every answer of this endpoint carries the server's subscription (data.sub, plus subChanged when the client's
    // copy showed another tier) once the request is known to be genuine: a fetch save's X-CSRF-Token was checked by
    // Api::run already; a page-hide beacon is checked from its body below (its answer is never read anyway). Nothing
    // runs before that check — Subscription::state() may settle a renewal (CONTRACT §14.1 / §14.6).
    // [scale-server] CONTRACT §16.9: nothing below writes the session, so its lock is released as soon as the request is
    // known to be genuine — the page's other calls (sync, chat) do not wait behind a save of several hundred kilobytes
    if (!$c->csrfPending) Session::close();
    Api::releaseConnection(60000); // the next save is a minute away: the web server need not keep this connection for it
    $sub = $c->csrfPending ? null : Subscription::state($c->uid());
    $clientTier = null;
    $saveEvery = function (): array {
        try { return class_exists('Tfm\Sync') ? ['saveEvery' => Sync::saveEvery()] : []; } catch (\Throwable $e) { return []; }
    };
    try {
        $max = (int) Config::get('save.max_bytes', 0) ?: (int) GameData::limit('saveMaxBytes', 1500000);
        if (!Http::isJsonRequest()) throw new ApiException(415, 'UNSUPPORTED_MEDIA_TYPE', 'JSON 형식으로 보내 주세요.');
        try {
            $raw = Http::body($max + 8192);
        } catch (ApiException $e) {
            throw new ApiException(413, 'SAVE_TOO_LARGE', '저장 데이터가 너무 커요. 오래된 사진이나 작업일지 사진을 정리한 뒤 다시 저장해 주세요.');
        }
        // CONTRACT §15.7 #3: the save is decoded with the same depth-32 cap as every other body (a 40-level deep value is
        // a 400, not a 500), and the envelope fields are typed: a wrong version / checksum / base is refused here instead
        // of being silently dropped, so the client's integrity check cannot be skipped by sending the wrong shape.
        try { $env = Json::decode($raw, false, 32); }
        catch (\UnexpectedValueException $e) { throw new ApiException(400, 'INVALID_JSON', '저장 데이터 형식이 올바르지 않아요.'); }
        if (!$env instanceof \stdClass) throw new ApiException(400, 'INVALID_JSON', '저장 데이터 형식이 올바르지 않아요.');
        $c->checkBodyCsrf(isset($env->csrf) ? $env->csrf : null); // only enforced when the X-CSRF-Token header was absent (beacon)
        Session::close(); // [scale-server] a beacon is genuine from here on: release the session lock (see above)
        if ($sub === null) $sub = Subscription::state($c->uid()); // a beacon: genuine only from here on
        if (isset($env->version) && (!is_int($env->version) || $env->version < 1 || $env->version > 1000)) throw new ApiException(400, 'INVALID_SAVE', '저장 데이터 형식이 올바르지 않아요.');
        if (isset($env->checksum) && !is_string($env->checksum)) throw new ApiException(400, 'INVALID_SAVE', '저장 데이터 형식이 올바르지 않아요.');
        if (isset($env->base) && (!is_int($env->base) || $env->base < 0)) throw new ApiException(400, 'INVALID_SAVE', '저장 데이터 형식이 올바르지 않아요.');
        $data = isset($env->data) ? $env->data : null;
        if (!$data instanceof \stdClass) throw new ApiException(400, 'INVALID_SAVE', '저장 데이터 형식이 올바르지 않아요.');
        // farm.plots must be an object (a map of bed id → state): a string / list would otherwise be read as "no plots"
        if (isset($data->farm) && $data->farm instanceof \stdClass && isset($data->farm->plots)
            && !($data->farm->plots instanceof \stdClass) && $data->farm->plots !== []) throw new ApiException(400, 'INVALID_SAVE', '저장 데이터 형식이 올바르지 않아요.');
        // what the client believed (its G.state.sub): answers say subChanged when the server's tier is another one
        $clientTier = isset($data->sub) && $data->sub instanceof \stdClass && isset($data->sub->tier) && is_int($data->sub->tier) ? $data->sub->tier : null;
        SaveValidator::assertNoProtoKeys($data); // 'constructor' / '__proto__' map keys would be served on every login
        $checksum = isset($env->checksum) && is_string($env->checksum) ? substr($env->checksum, 0, 32) : '';
        $base = isset($env->base) && is_int($env->base) && $env->base >= 0 ? $env->base : null;

        // integrity: the client's cyrb53 checksum over JSON.stringify(state) (detects truncated/corrupted uploads)
        // [scale-server] CONTRACT §16.9 — the unchanged-checksum fast path: the page says "my state has this checksum and
        // is revision N", and the stored copy has exactly that checksum at revision N (an idle page's heartbeat). There is
        // nothing to judge and nothing to write, so nothing is: the answer carries the stored copy's numbers. It needs no
        // comparison of the checksum with the body (the slow part of a save) — a page that claims the stored checksum for
        // another state changes nothing on the server. A page that names no base (older pages), another revision (a copy
        // an operator restored has a new one) or another checksum takes the ordinary path below.
        if ($checksum !== '' && $base !== null) {
            $small = Db::one('SELECT revision, checksum, size_bytes, saved_at FROM player_saves WHERE user_id = ?', [$c->uid()]);
            if ($small && $base === (int) $small['revision'] && (string) $small['checksum'] !== '' && hash_equals((string) $small['checksum'], $checksum)) {
                return ['savedAt' => (int) $small['saved_at'], 'revision' => (int) $small['revision'], 'size' => (int) $small['size_bytes'], 'sub' => $sub,
                    'subChanged' => $clientTier !== (int) $sub['tier'], 'unchanged' => true] + $saveEvery();
            }
        }

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
            // [scale-server] CONTRACT §16.9: explicit columns — the backup copy (as large as the save itself, up to 1.5 MB)
            // is never read: the row's own data becomes the new backup
            $row = Db::one('SELECT user_id, version, revision, data, checksum, size_bytes, meta, saved_at, created_at, rejects, last_reject_at FROM player_saves WHERE user_id = ?' . Db::forUpdate(), [$uid]);
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
            // the real-time farm judge (CONTRACT §15.1): runs inside this transaction after the validator's shape checks
            $farmPlan = null;
            $farmHook = class_exists('Tfm\Farm') ? function (object $n, ?object $p) use (&$farmPlan, $uid, $now, $tier): array {
                $farmPlan = Farm::plan($uid, $n, $p, $now, $tier);
                return $farmPlan;
            } : null;
            if ($validate) $res = SaveValidator::validate($data, $prev, $meta, $user, $prevAt, $now, $tier, $farmHook);
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
            // the farm records of an accepted save (validation off: recorded as far as possible, nothing refused)
            if ($farmPlan !== null) Farm::apply($farmPlan);
            elseif (class_exists('Tfm\Farm')) Farm::sync($uid, $data, $prev, $now, $tier, false);
            if (in_array('reset', isset($res['notes']) ? $res['notes'] : [], true)) Audit::log('save_reset', $uid);
            return ['ok' => true, 'rev' => $rev, 'size' => strlen($json), 'summary' => isset($res['summary']) ? $res['summary'] : [],
                'level' => isset($p['level']) ? (int) $p['level'] : 1, 'exp' => isset($p['exp_total']) ? (int) $p['exp_total'] : 0]; // [scale-server] for the cached ranking
        });

        $stored = function (?array $row, ?object $prev) use ($sub): array {
            if ($prev instanceof \stdClass) $prev->sub = (object) ($sub + ['source' => 'server']);
            return [
                'version' => $row ? (int) $row['version'] : 1,
                'revision' => $row ? (int) $row['revision'] : 0,
                'savedAt' => $row ? (int) $row['saved_at'] : 0,
            ] + SaveValidator::restoreStamp($row) + ['data' => $prev];
        };
        // the server's own times of the real-time beds (CONTRACT §15.1) — also on a 409, next to the stored copy
        $rt = function () use ($uid, $tier): array { return class_exists('Tfm\Farm') ? ['rt' => Farm::view($uid, $tier)] : []; };
        if (!empty($result['stale'])) {
            $row = $result['row'];
            $restored = SaveValidator::restoreStamp($row)['restoredRev'] > 0;
            Log::info('SAVE', 'stale save refused', ['uid' => $uid, 'base' => $base, 'stored' => (int) $row['revision'], 'restored' => $restored]);
            throw new ApiException(409, 'STALE_SAVE', '다른 창이나 기기에서 더 새로 저장했어요. 이 창의 진행 상황은 저장하지 않았어요.', ['save' => $stored($row, $result['prev'])] + ($restored ? ['restored' => true] : []) + $rt());
        }
        if (!$result['ok']) {
            $res = $result['res'];
            $codes = array_values(array_unique(array_map(function ($v) { return $v['code']; }, $res['violations'])));
            Audit::log('save_rejected', $uid, ['violations' => array_slice($res['violations'], 0, 8), 'summary' => isset($res['summary']) ? $res['summary'] : []], 'warn');
            // CONTRACT §15.7 #5: a save the server refuses is a security event (a cheat attempt or a corrupted client). Not
            // attack-like — it has its own validation and does not count toward the automatic block (a child's unusual run).
            if (class_exists('Tfm\SecEvent')) \Tfm\SecEvent::log('save_rejected', 'warn', ['violations' => array_slice($codes, 0, 8)], $uid);
            $row = $result['row'];
            throw new ApiException(409, 'VALIDATION_FAILED', '서버 검증에 실패해 이번 진행 상황은 저장하지 않았어요. 서버에 저장된 진행 상황으로 되돌립니다.', [
                'save' => $stored($row, $result['prev']),
                'violations' => $codes,
            ] + $rt());
        }
        // [scale-server] CONTRACT §16.9: the cached ranking — this player's own place is asked again, and the shared top
        // list when this save can change it (lib/Ranking.php)
        if (class_exists('Tfm\\Ranking') && isset($result['level'], $result['exp'])) \Tfm\Ranking::saved($uid, (int) $result['level'], (int) $result['exp']);
        $un = isset($result['summary']['unexplained']) ? $result['summary']['unexplained'] : [];
        if ((isset($un['value']) ? $un['value'] : 0) > 0 || (isset($un['exp']) ? $un['exp'] : 0) > 0) {
            Log::debug('SAVE', 'accepted with tolerance', ['uid' => $uid] + $result['summary']);
        }
        return ['savedAt' => $now, 'revision' => $result['rev'], 'size' => $result['size'], 'sub' => $sub, 'subChanged' => $clientTier !== $tier] + $saveEvery() + $rt();
    } catch (ApiException $e) {
        if ($sub !== null && ($e->data === null || is_array($e->data))) {
            $e->data = (is_array($e->data) ? $e->data : []) + ['sub' => $sub, 'subChanged' => $clientTier !== (int) $sub['tier']];
        }
        throw $e;
    }
});
