<?php
/**
 * Tfm\Farm — the server side of the real-time beds "실시간 텃밭", the 곳간 mirror and the completion confirmations
 * "재배 완료 확인" (CONTRACT §15.1–§15.3, workflow interfaces 2–4).
 *
 * Server authority. The beds live in the validated save blob (data.rtfarm), but the client's plantedAt / readyAt / dur are
 * never trusted: the first save that shows a planting (its pid) stores first_seen_at = now and
 * ready_at = now + minutes × 60000 ÷ (tier × scale) measured by the server clock (farm_beds). A harvest is accepted from
 * ready_at − 5 s on (RT_HARVEST_TOO_EARLY before), once per planting, with at most harvestAmount.max + 1 items.
 * player/save.php runs plan() as the SaveValidator hook inside its transaction (after the shape checks): the plan's
 * violations refuse the whole save (409 VALIDATION_FAILED, the stored copy returned as usual) and its validated harvests
 * explain their reward to the economy check; apply() writes the plan only once the save is accepted. sync() = both.
 *
 *   (1) a pid not yet in farm_beds → a row: first_seen_at = now, ready_at by the server, status growing. The crop must be
 *       a real-time crop, the bed one of rtfarm.beds, the pid 16 hex characters never seen on another bed / crop of this
 *       account (RT_PID_REUSE).
 *   (2) a growing / ready row whose bed is gone or holds another pid: listed in rtfarm.last while stats.rtHarvests grew →
 *       a harvest (now ≥ ready_at − 5 s, amount ≤ max + 1) → harvested (harvested_at, amount, stars); otherwise → cleared.
 *   (3) the growth of stats.rtHarvests must equal the number of such harvests (RT_HARVEST_COUNT).
 *   (4) every validated harvest explains item value × amount + rt coin, rt exp (SaveValidator economy check).
 *   (5) a tier change re-times growing rows: ready_at = now + (ready_at − now) × rowTier ÷ tier.
 *   (6) rows whose ready_at ≤ now become ready.
 *   (7) the quick practice plots are mirrored for the admin: one row per planting, kind 'plot', pid = String(plantedAt),
 *       growth, status (ready at 100 %, harvested / cleared when the planting is gone).
 *   (8) the 곳간 (data.storage.items) is mirrored into farm_storage.
 * A finished planting that reappears in a bed is RT_PID_REUSE — unless the stored copy already showed it there (an
 * operator's "직전 저장으로 되돌리기"): then it is tolerated and stays finished (it cannot be harvested twice).
 *
 * The time scale (farm.rt_scale, 0.1–3600, e.g. 60 for a classroom demo) is the operator setting of Tfm\Settings with
 * the config value as the fallback; it applies to plantings made after a change.
 * PHP 7.2 syntax only.
 */
declare(strict_types=1);

namespace Tfm;

if (!defined('TFM_BOOT')) { if (function_exists('header_remove')) header_remove('X-Powered-By'); http_response_code(404); exit; }

final class Farm
{
    /** a harvest is accepted from ready_at − this many ms (network delay, clock jitter between client and server) */
    public const EARLY_SLACK_MS = 5000;
    public const SCALE_MIN = 0.1;
    public const SCALE_MAX = 3600.0;
    public const STATUSES = ['growing', 'ready', 'harvested', 'cleared'];
    public const REPORT_STATUSES = ['pending', 'approved', 'rejected'];
    private const PID_RE = '/^[0-9a-f]{16}$/';
    /** quick-plot ids as the mirror stores them (farm_beds.bed_id is VARCHAR(16)) */
    private const PLOT_RE = '/^[A-Za-z0-9_\-]{1,16}$/';
    /** the farm_beds columns a plan reads and rewrites */
    private const ROW_COLS = 'id, bed_id, pid, crop_id, tier, ready_at, growth, care, status, harvested_at, amount, stars';

    // ------------------------------------------------------------------ tiny accessors (stdClass save trees)
    private static function o($v): ?object { return $v instanceof \stdClass ? $v : null; }
    private static function p(?object $o, string $k) { return ($o !== null && property_exists($o, $k)) ? $o->$k : null; }
    /** properties of an object as [string key => value] */
    private static function kv($o): array
    {
        if (!$o instanceof \stdClass) return [];
        $out = [];
        foreach (get_object_vars($o) as $k => $v) $out[(string) $k] = $v;
        return $out;
    }
    /** a finite JSON number floored to an int, else $d */
    private static function int($v, int $d = 0): int
    {
        return (is_int($v) || is_float($v)) && is_finite((float) $v) && abs((float) $v) < 1e15 ? (int) floor((float) $v) : $d;
    }

    // ------------------------------------------------------------------ time scale (operator setting)
    /** the real-time scale: Settings farm.rt_scale (admin site / cli farm:scale), else config farm.rt_scale, clamped to 0.1–3600 */
    public static function scale(): float
    {
        $v = class_exists('Tfm\Settings') ? Settings::get('farm.rt_scale', 1.0) : Config::get('farm.rt_scale', 1.0);
        $f = is_numeric($v) ? (float) $v : 1.0;
        if (!is_finite($f)) $f = 1.0;
        return round(max(self::SCALE_MIN, min(self::SCALE_MAX, $f)), 4);
    }

    /**
     * Change the scale (admins only; audited by Settings as setting_changed). Refused: not an admin → 403 FORBIDDEN;
     * NaN / ∞ / outside 0.1–3600 → 400 INVALID_SETTING. Plantings already growing keep their ready_at.
     */
    public static function setScale(array $actor, float $scale): void
    {
        if ((isset($actor['role']) ? $actor['role'] : '') !== 'admin') throw new ApiException(403, 'FORBIDDEN', '관리자 권한이 필요해요.');
        if (!is_finite($scale) || $scale < self::SCALE_MIN || $scale > self::SCALE_MAX) {
            throw new ApiException(400, 'INVALID_SETTING', '시간 배율은 0.1부터 3600까지 정할 수 있어요.');
        }
        $id = (int) (isset($actor['id']) ? $actor['id'] : 0);
        if (class_exists('Tfm\Settings')) Settings::set('farm.rt_scale', $scale, $id > 0 ? $id : null);
        else Config::override('farm.rt_scale', $scale);
    }

    /** ms a real-time crop needs: minutes × 60000 ÷ (tier × scale), at least 1 ms (0 for a crop that is not a real-time crop) */
    public static function durationMs(string $cropId, int $tier, ?float $scale = null): int
    {
        $c = GameData::rtCrop($cropId);
        if ($c === null) return 0;
        $s = $scale === null ? self::scale() : max(self::SCALE_MIN, min(self::SCALE_MAX, $scale));
        return max(1, (int) round($c['minutes'] * 60000 / (max(1, min(4, $tier)) * $s)));
    }

    /** the most items one harvest of this crop can give: max(harvestAmount) + 1 (the ★★★ bonus) */
    public static function maxAmount(string $cropId): int
    {
        $c = GameData::crop($cropId);
        $amt = (array) ($c && isset($c['harvestAmount']) ? $c['harvestAmount'] : [3]);
        $nums = array_filter($amt, 'is_numeric');
        return (int) ($nums ? max($nums) : 3) + 1;
    }

    /** value / exp one validated real-time harvest of $amount items explains */
    private static function harvestReward(string $cropId, int $amount): array
    {
        $rc = GameData::rtCrop($cropId);
        $c = GameData::crop($cropId);
        $item = (string) ($c && isset($c['harvestItem']) ? $c['harvestItem'] : '');
        return ['value' => (int) ($rc ? $rc['coin'] : 0) + $amount * GameData::itemValue($item), 'exp' => (int) ($rc ? $rc['exp'] : 0)];
    }

    /**
     * The planting id of a quick plot: String(Math.round(plantedAt)) — what 42-realfarm.js sends (a whole number of ms in
     * practice); null for anything that is not a positive time (not mirrored, not reportable).
     */
    public static function plotPid($plantedAt): ?string
    {
        if (is_int($plantedAt)) return $plantedAt > 0 && $plantedAt < 1000000000000000 ? (string) $plantedAt : null;
        if (is_float($plantedAt) && is_finite($plantedAt) && $plantedAt >= 0.5 && $plantedAt < 1e15) return sprintf('%.0f', floor($plantedAt + 0.5));
        return null;
    }

    // ------------------------------------------------------------------ save sync (player/save.php)
    /**
     * Judge one save against the server's records — reads only, writes nothing. Robust to any input (with validation off
     * the shape was not checked): beds / harvests that do not have the shape of interface 1 are skipped.
     * @return array{ok:bool, violations:array, explain:array{value:int, exp:int}, harvests:int, uid:int, now:int, tier:int,
     *               scale:float, ops:array, storage:array}
     */
    public static function plan(int $uid, object $n, ?object $p, int $now, int $tier): array
    {
        $tier = max(1, min(4, $tier));
        $scale = self::scale();
        $viol = [];
        $bad = function (string $code, array $detail = []) use (&$viol): void { if (count($viol) < 20) $viol[] = ['code' => $code] + $detail; };
        $ops = [];
        $explain = ['value' => 0, 'exp' => 0];
        $harvests = 0;

        // ---------------------------------------------------------- real-time beds
        $bedIds = GameData::rtBeds();
        if ($bedIds) {
            $rf = self::o(self::p($n, 'rtfarm'));
            $beds = [];
            foreach (self::kv(self::p($rf, 'beds')) as $bedId => $b) {
                $b = self::o($b);
                if (!$b || !in_array($bedId, $bedIds, true)) continue;
                $pid = self::p($b, 'pid');
                $crop = self::p($b, 'cropId');
                if (!is_string($pid) || !preg_match(self::PID_RE, $pid) || !is_string($crop) || GameData::rtCrop($crop) === null) continue;
                $beds[$bedId] = ['pid' => $pid, 'crop' => $crop, 'care' => max(0, min(100, self::int(self::p($b, 'care'))))];
            }
            $last = [];
            $l = self::p($rf, 'last');
            foreach (is_array($l) ? array_slice($l, 0, 8) : [] as $e) {
                $e = self::o($e);
                $pid = self::p($e, 'pid');
                if (!$e || !is_string($pid) || !preg_match(self::PID_RE, $pid) || isset($last[$pid])) continue;
                $last[$pid] = [
                    'bedId' => is_string(self::p($e, 'bedId')) ? (string) self::p($e, 'bedId') : '',
                    'cropId' => is_string(self::p($e, 'cropId')) ? (string) self::p($e, 'cropId') : '',
                    'amount' => max(0, self::int(self::p($e, 'amount'))),
                    'stars' => max(0, min(3, self::int(self::p($e, 'stars')))),
                ];
            }
            $pBeds = [];
            foreach (self::kv(self::p(self::o(self::p($p, 'rtfarm')), 'beds')) as $bedId => $b) {
                $pid = self::p(self::o($b), 'pid');
                if (is_string($pid)) $pBeds[$bedId] = $pid;
            }
            $dHarv = max(0, self::int(self::p(self::o(self::p($n, 'stats')), 'rtHarvests')) - self::int(self::p(self::o(self::p($p, 'stats')), 'rtHarvests')));

            $active = [];
            foreach (Db::all('SELECT ' . self::ROW_COLS . " FROM farm_beds WHERE user_id = ? AND kind = 'rt' AND status IN ('growing', 'ready') ORDER BY id ASC", [$uid]) as $r) {
                $active[(string) $r['pid']] = $r;
            }
            $keep = [];
            foreach ($beds as $bedId => $b) {
                $pid = $b['pid'];
                $row = isset($active[$pid]) ? $active[$pid]
                    : Db::one('SELECT ' . self::ROW_COLS . " FROM farm_beds WHERE user_id = ? AND kind = 'rt' AND pid = ? ORDER BY id DESC LIMIT 1", [$uid, $pid]);
                if (!$row) {
                    // (1) a planting the server has never seen: its times are the server's
                    if (isset($last[$pid])) { $bad('RT_PID_REUSE', ['bed' => $bedId, 'why' => 'harvest list']); continue; }
                    $ops[] = ['insert', [
                        'user_id' => $uid, 'bed_id' => $bedId, 'kind' => 'rt', 'pid' => $pid, 'crop_id' => $b['crop'], 'tier' => $tier,
                        'first_seen_at' => $now, 'ready_at' => $now + self::durationMs($b['crop'], $tier, $scale), 'growth' => 0, 'care' => $b['care'],
                        'status' => 'growing', 'harvested_at' => 0, 'amount' => 0, 'stars' => 0, 'updated_at' => $now,
                    ]];
                    continue;
                }
                if ((string) $row['bed_id'] !== $bedId || (string) $row['crop_id'] !== $b['crop']) { $bad('RT_PID_REUSE', ['bed' => $bedId]); continue; }
                $status = (string) $row['status'];
                if ($status !== 'growing' && $status !== 'ready') {
                    // a finished planting back in a bed: only a stored copy that showed it there already is tolerated
                    if (!isset($pBeds[$bedId]) || $pBeds[$bedId] !== $pid) $bad('RT_PID_REUSE', ['bed' => $bedId, 'status' => $status]);
                    continue;
                }
                $keep[$pid] = true;
                $new = $row;
                $new['care'] = $b['care'];
                if ($status === 'growing') {
                    $readyAt = (int) $row['ready_at'];
                    $rowTier = max(1, min(4, (int) $row['tier']));
                    if ($rowTier !== $tier && $readyAt > $now) {
                        // (5) the speed tier changed while it grows: the time left scales with rowTier ÷ tier
                        $new['ready_at'] = $now + (int) round(($readyAt - $now) * $rowTier / $tier);
                        $new['tier'] = $tier;
                    }
                    if ((int) $new['ready_at'] <= $now) $new['status'] = 'ready';   // (6)
                }
                if (self::changed($row, $new)) $ops[] = ['update', (int) $row['id'], $new];
            }
            $candidates = 0;
            foreach ($active as $pid => $row) {
                if (isset($keep[$pid])) continue;
                $pid = (string) $pid;
                $bedId = (string) $row['bed_id'];
                $e = isset($last[$pid]) ? $last[$pid] : null;
                if ($e === null || $dHarv <= 0) {
                    $ops[] = ['update', (int) $row['id'], ['status' => 'cleared'] + $row];   // (2) pulled out (뽑기) / gone without a harvest
                    continue;
                }
                // (2) a harvest of this planting
                $candidates++;
                $crop = (string) $row['crop_id'];
                if ($e['bedId'] !== $bedId || $e['cropId'] !== $crop) { $bad('RT_PID_REUSE', ['bed' => $bedId, 'why' => 'harvest list']); continue; }
                $readyAt = (int) $row['ready_at'];
                if ($now < $readyAt - self::EARLY_SLACK_MS) { $bad('RT_HARVEST_TOO_EARLY', ['bed' => $bedId, 'leftMs' => $readyAt - $now]); continue; }
                $max = self::maxAmount($crop);
                if ($e['amount'] > $max) { $bad('RT_HARVEST_COUNT', ['bed' => $bedId, 'amount' => $e['amount'], 'max' => $max]); continue; }
                $ops[] = ['update', (int) $row['id'], ['status' => 'harvested', 'harvested_at' => $now, 'amount' => $e['amount'], 'stars' => $e['stars']] + $row];
                $r = self::harvestReward($crop, $e['amount']);   // (4)
                $explain['value'] += $r['value'];
                $explain['exp'] += $r['exp'];
                $harvests++;
            }
            // (3) every counted harvest must be a planting the server saw grow
            if ($dHarv !== $candidates) $bad('RT_HARVEST_COUNT', ['stat' => $dHarv, 'harvests' => $candidates]);
        }

        // ---------------------------------------------------------- (7) quick practice plots → mirror
        $plotsN = self::kv(self::p(self::o(self::p($n, 'farm')), 'plots'));
        $plotsP = self::kv(self::p(self::o(self::p($p, 'farm')), 'plots'));
        $activeP = [];
        foreach (Db::all('SELECT ' . self::ROW_COLS . " FROM farm_beds WHERE user_id = ? AND kind = 'plot' AND status IN ('growing', 'ready') ORDER BY id ASC", [$uid]) as $r) {
            $activeP[(string) $r['bed_id']][] = $r;
        }
        $keepP = [];
        foreach (array_slice($plotsN, 0, 64, true) as $plotId => $s) {
            $plotId = (string) $plotId;
            $s = self::o($s);
            if (!$s || !preg_match(self::PLOT_RE, $plotId)) continue;
            $crop = self::p($s, 'cropId');
            $pid = self::plotPid(self::p($s, 'plantedAt'));
            if (!is_string($crop) || strlen($crop) > 40 || GameData::crop($crop) === null || $pid === null) continue;
            $growth = max(0, min(100, self::int(self::p($s, 'growth'))));
            $st = $growth >= 100 ? 'ready' : 'growing';
            $row = null;
            foreach (isset($activeP[$plotId]) ? $activeP[$plotId] : [] as $r) if ((string) $r['pid'] === $pid) $row = $r;
            if ($row) {
                $keepP[(int) $row['id']] = true;
                $new = ['growth' => $growth, 'status' => $st, 'tier' => $tier] + $row;
                if ($st === 'ready' && (int) $row['ready_at'] === 0) $new['ready_at'] = $now;
                if (self::changed($row, $new)) $ops[] = ['update', (int) $row['id'], $new];
                continue;
            }
            // not mirrored yet — unless a finished row of it exists (a restored copy): never a second row of one planting
            if (Db::value("SELECT id FROM farm_beds WHERE user_id = ? AND kind = 'plot' AND bed_id = ? AND pid = ?", [$uid, $plotId, $pid]) !== null) continue;
            $ops[] = ['insert', [
                'user_id' => $uid, 'bed_id' => $plotId, 'kind' => 'plot', 'pid' => $pid, 'crop_id' => $crop, 'tier' => $tier,
                'first_seen_at' => $now, 'ready_at' => $st === 'ready' ? $now : 0, 'growth' => $growth, 'care' => 0,
                'status' => $st, 'harvested_at' => 0, 'amount' => 0, 'stars' => 0, 'updated_at' => $now,
            ]];
        }
        foreach ($activeP as $plotId => $rows) {
            foreach ($rows as $r) {
                if (isset($keepP[(int) $r['id']])) continue;
                $hN = self::int(self::p(self::o(isset($plotsN[$plotId]) ? $plotsN[$plotId] : null), 'harvests'));
                $hP = self::int(self::p(self::o(isset($plotsP[$plotId]) ? $plotsP[$plotId] : null), 'harvests'));
                $ops[] = ['update', (int) $r['id'], ($hN > $hP ? ['status' => 'harvested', 'harvested_at' => $now] : ['status' => 'cleared']) + $r];
            }
        }

        return [
            'ok' => !$viol, 'violations' => $viol, 'explain' => $explain, 'harvests' => $harvests,
            'uid' => $uid, 'now' => $now, 'tier' => $tier, 'scale' => $scale, 'ops' => $ops, 'storage' => self::storageOf($n),
        ];
    }

    /** did a planned row change (the columns a plan rewrites) */
    private static function changed(array $old, array $new): bool
    {
        foreach (['tier', 'ready_at', 'growth', 'care', 'harvested_at', 'amount', 'stars'] as $k) if ((int) $old[$k] !== (int) $new[$k]) return true;
        return (string) $old['status'] !== (string) $new['status'];
    }

    /** (8) the 곳간 items of a save as the mirror keeps them: storable ids, integer quantities 1..9999 */
    private static function storageOf(object $n): array
    {
        $out = [];
        foreach (array_slice(self::kv(self::p(self::o(self::p($n, 'storage')), 'items')), 0, 100, true) as $id => $q) {
            $id = (string) $id;
            if (GameData::storable($id) && is_int($q) && $q > 0 && $q <= 9999) $out[$id] = $q;
        }
        ksort($out);
        return $out;
    }

    /** write a plan of plan() (player/save.php: inside its transaction, once the save is accepted) */
    public static function apply(array $plan): void
    {
        $uid = (int) $plan['uid'];
        $now = (int) $plan['now'];
        Db::tx(function () use ($plan, $uid, $now) {
            foreach ($plan['ops'] as $op) {
                if ($op[0] === 'insert') { Db::insert('farm_beds', $op[1]); continue; }
                $r = $op[2];
                Db::exec('UPDATE farm_beds SET tier = ?, ready_at = ?, growth = ?, care = ?, status = ?, harvested_at = ?, amount = ?, stars = ?, updated_at = ? WHERE id = ? AND user_id = ?', [
                    (int) $r['tier'], (int) $r['ready_at'], (int) $r['growth'], (int) $r['care'], in_array($r['status'], self::STATUSES, true) ? (string) $r['status'] : 'cleared',
                    (int) $r['harvested_at'], (int) $r['amount'], (int) $r['stars'], $now, (int) $op[1], $uid,
                ]);
            }
            $have = [];
            foreach (Db::all('SELECT item_id, qty FROM farm_storage WHERE user_id = ?', [$uid]) as $r) $have[(string) $r['item_id']] = (int) $r['qty'];
            foreach ($have as $id => $q) if (!isset($plan['storage'][$id])) Db::exec('DELETE FROM farm_storage WHERE user_id = ? AND item_id = ?', [$uid, (string) $id]);
            foreach ($plan['storage'] as $id => $q) {
                if (!isset($have[$id]) || $have[$id] !== $q) Db::upsert('farm_storage', ['user_id' => $uid, 'item_id' => (string) $id, 'qty' => (int) $q, 'updated_at' => $now], ['user_id', 'item_id']);
            }
        });
    }

    /**
     * plan() + apply() in one transaction. $enforce = false (save validation switched off): what can be recorded is
     * recorded anyway, the violations are only reported. @return array the plan (ok, violations, explain, harvests …)
     */
    public static function sync(int $uid, object $n, ?object $p, int $now, int $tier, bool $enforce = true): array
    {
        return Db::tx(function () use ($uid, $n, $p, $now, $tier, $enforce) {
            $plan = self::plan($uid, $n, $p, $now, $tier);
            if ($plan['ok'] || !$enforce) self::apply($plan);
            return $plan;
        });
    }

    // ------------------------------------------------------------------ what the client is told (data.rt / ping rtScale)
    /** the live status: a growing real-time row whose ready_at has passed is ready (the server clock judges) */
    private static function liveStatus(array $r, int $now): string
    {
        $st = (string) $r['status'];
        return $st === 'growing' && (string) (isset($r['kind']) ? $r['kind'] : 'rt') === 'rt' && (int) $r['ready_at'] <= $now ? 'ready' : $st;
    }

    /**
     * data.rt of player/save.php (accepted) and player/get.php: {scale, tier, beds: {RB1: {pid, cropId, firstSeenAt,
     * readyAt, status}, …}} — the server's own times of every growing / ready real-time bed (beds = {} when none).
     */
    public static function view(int $uid, int $tier, ?int $now = null): array
    {
        $now = $now === null ? Clock::ms() : $now;
        $beds = [];
        foreach (Db::all("SELECT bed_id, kind, pid, crop_id, first_seen_at, ready_at, status FROM farm_beds WHERE user_id = ? AND kind = 'rt' AND status IN ('growing', 'ready') ORDER BY id ASC", [$uid]) as $r) {
            $beds[(string) $r['bed_id']] = ['pid' => (string) $r['pid'], 'cropId' => (string) $r['crop_id'], 'firstSeenAt' => (int) $r['first_seen_at'], 'readyAt' => (int) $r['ready_at'], 'status' => self::liveStatus($r, $now)];
        }
        return ['scale' => self::scale(), 'tier' => max(1, min(4, $tier)), 'beds' => $beds ? $beds : new \stdClass()];
    }

    /**
     * api/farm/state.php: the caller's authoritative view — {scale, tier, beds: [{bedId, kind, pid, cropId, firstSeenAt,
     * readyAt, growth, status}] (growing / ready rows of both kinds, real-time first), storage: {items, total, cap},
     * reports: {pending, unseen}}.
     */
    public static function state(int $uid, int $tier, ?int $now = null): array
    {
        $now = $now === null ? Clock::ms() : $now;
        $beds = [];
        foreach (Db::all("SELECT bed_id, kind, pid, crop_id, first_seen_at, ready_at, growth, status FROM farm_beds WHERE user_id = ? AND status IN ('growing', 'ready') ORDER BY kind DESC, bed_id ASC, id ASC", [$uid]) as $r) {
            $beds[] = ['bedId' => (string) $r['bed_id'], 'kind' => (string) $r['kind'], 'pid' => (string) $r['pid'], 'cropId' => (string) $r['crop_id'],
                'firstSeenAt' => (int) $r['first_seen_at'], 'readyAt' => (int) $r['ready_at'], 'growth' => (int) $r['growth'], 'status' => self::liveStatus($r, $now)];
        }
        $items = [];
        $total = 0;
        foreach (Db::all('SELECT item_id, qty FROM farm_storage WHERE user_id = ? ORDER BY item_id ASC', [$uid]) as $r) {
            $items[(string) $r['item_id']] = (int) $r['qty'];
            $total += (int) $r['qty'];
        }
        return [
            'scale' => self::scale(), 'tier' => max(1, min(4, $tier)), 'beds' => $beds,
            'storage' => ['items' => $items ? $items : new \stdClass(), 'total' => $total, 'cap' => GameData::storageCap()],
            'reports' => ['pending' => (int) Db::value("SELECT COUNT(*) FROM crop_reports WHERE user_id = ? AND status = 'pending'", [$uid]), 'unseen' => self::unseen($uid)],
        ];
    }

    // ------------------------------------------------------------------ completion requests "재배 완료 확인" (CONTRACT §15.3)
    private const REPORT_COLS = 'id, user_id, kind, bed_id, pid, crop_id, stars, amount, note, photo, status, memo, requested_at, decided_at, decided_by, seen_at';
    /** the only photo paths a report may carry (what Upload::image stores under subdir 'reports') */
    private const PHOTO_RE = '#^uploads/reports/\d{4}/\d{2}/[a-f0-9]{32}\.(?:jpg|png)$#';

    /** ★ of a care value by rtfarm.starAt ([0, 40, 75]: care ≥ 0 → 1, ≥ 40 → 2, ≥ 75 → 3) */
    public static function starsOf(int $care): int
    {
        $s = 1;
        foreach (GameData::rtfarm()['starAt'] as $i => $at) if ($care >= (int) $at) $s = (int) $i + 1;
        return max(1, min(3, $s));
    }

    /** how long after a harvest it may still be reported (farm.harvest_keep_days, default 7) */
    private static function keepMs(): int { return max(1, (int) Config::get('farm.harvest_keep_days', 7)) * 86400000; }

    /** the shape of a report target (api/farm/report.php checks the same through V): 400 INVALID_INPUT */
    private static function checkTarget(string $kind, string $bedId, string $pid): void
    {
        if (!in_array($kind, ['rt', 'plot'], true)) V::fail('kind', '값이 올바르지 않아요.');
        if ($kind === 'rt') {
            if (!in_array($bedId, GameData::rtBeds(), true)) V::fail('bedId', '값이 올바르지 않아요.');
            if (!preg_match(self::PID_RE, $pid)) V::fail('pid', '값은 16자리 16진수여야 해요.');
            return;
        }
        if (!preg_match(self::PLOT_RE, $bedId)) V::fail('bedId', '값이 올바르지 않아요.');
        if (!preg_match('/^[1-9]\d{0,15}$/', $pid)) V::fail('pid', '값이 올바르지 않아요.');
    }

    /** a child's note: invisible characters removed, personal information 🔒-masked, bad words ♡♡-masked (like chat), ≤ $max */
    private static function cleanNote(string $note, int $max): string
    {
        $t = Users::cleanText($note, 1000);
        if ($t === '') return '';
        return mb_substr(trim(ChatFilter::mask(ChatFilter::maskPII($t))), 0, $max);
    }

    /**
     * What the server's OWN records say about a planting (never the request): ['crop', 'stars', 'amount'] when it may be
     * reported — a real-time row that is ready by the server clock, or harvested within farm.harvest_keep_days; a quick
     * plot whose mirrored row is ready / recently harvested, or whose stored save shows 100 % — else null.
     */
    private static function readyTarget(int $uid, string $kind, string $bedId, string $pid, int $now): ?array
    {
        $row = Db::one('SELECT crop_id, status, ready_at, harvested_at, amount, stars, care FROM farm_beds WHERE user_id = ? AND kind = ? AND bed_id = ? AND pid = ? ORDER BY id DESC LIMIT 1', [$uid, $kind, $bedId, $pid]);
        if ($row) {
            $st = (string) $row['status'];
            $ready = $st === 'ready' || ($kind === 'rt' && $st === 'growing' && (int) $row['ready_at'] <= $now);
            $harvested = $st === 'harvested' && (int) $row['harvested_at'] >= $now - self::keepMs();
            if ($ready || $harvested) {
                return [
                    'crop' => (string) $row['crop_id'],
                    'stars' => $kind !== 'rt' ? 0 : ($harvested ? max(0, min(3, (int) $row['stars'])) : self::starsOf((int) $row['care'])),
                    'amount' => $harvested ? max(0, (int) $row['amount']) : 0,
                ];
            }
        }
        if ($kind === 'rt') return null;
        // a quick plot at 100 % in the stored (accepted) save — the server's copy, not the request
        $data = Db::value('SELECT data FROM player_saves WHERE user_id = ?', [$uid]);
        $s = is_string($data) ? Json::tryDecode($data, false, 512) : null;
        $plot = self::o(self::p(self::o(self::p(self::o(self::p(self::o($s), 'farm')), 'plots')), $bedId));
        if (!$plot || self::plotPid(self::p($plot, 'plantedAt')) !== $pid) return null;
        $crop = self::p($plot, 'cropId');
        if (!is_string($crop) || GameData::crop($crop) === null || self::int(self::p($plot, 'growth')) < 100) return null;
        return ['crop' => $crop, 'stars' => 0, 'amount' => 0];
    }

    /**
     * api/farm/report.php — one completion request per planting: 409 ALREADY_REPORTED for a second one, 429 REPORT_LIMIT
     * after farm.report_daily requests in 24 h, 409 NOT_READY unless the server's records say the planting is ready (also
     * for a planting of another account — the same answer, so other accounts cannot be probed). @return array the report
     */
    public static function report(array $user, string $kind, string $bedId, string $pid, string $note = '', ?int $now = null): array
    {
        $uid = (int) $user['id'];
        $now = $now === null ? Clock::ms() : $now;
        self::checkTarget($kind, $bedId, $pid);
        $note = self::cleanNote($note, max(1, (int) Config::get('farm.report_note_max', 80)));
        $dup = function () { return new ApiException(409, 'ALREADY_REPORTED', '이 작물은 벌써 완료 확인을 보냈어요.'); };
        return Db::tx(function () use ($uid, $kind, $bedId, $pid, $note, $now, $dup) {
            // one account's requests one after another (MariaDB row lock; SQLite already holds the write lock)
            Db::one('SELECT id FROM users WHERE id = ?' . Db::forUpdate(), [$uid]);
            if (Db::value('SELECT id FROM crop_reports WHERE user_id = ? AND kind = ? AND bed_id = ? AND pid = ?', [$uid, $kind, $bedId, $pid]) !== null) throw $dup();
            $daily = max(1, (int) Config::get('farm.report_daily', 30));
            $since = $now - 86400000;
            if ((int) Db::value('SELECT COUNT(*) FROM crop_reports WHERE user_id = ? AND requested_at > ?', [$uid, $since]) >= $daily) {
                $oldest = (int) Db::value('SELECT MIN(requested_at) FROM crop_reports WHERE user_id = ? AND requested_at > ?', [$uid, $since]);
                $retry = max(1, (int) ceil(($oldest + 86400000 - $now) / 1000));
                throw new ApiException(429, 'REPORT_LIMIT', '오늘은 완료 확인을 충분히 보냈어요. 내일 다시 보내 주세요.', ['retryAfter' => $retry], ['Retry-After: ' . $retry]);
            }
            $t = self::readyTarget($uid, $kind, $bedId, $pid, $now);
            if ($t === null) throw new ApiException(409, 'NOT_READY', '아직 다 자라지 않았어요. 다 자라면 보내 주세요.');
            try {
                $id = Db::insert('crop_reports', [
                    'user_id' => $uid, 'kind' => $kind, 'bed_id' => $bedId, 'pid' => $pid, 'crop_id' => $t['crop'], 'stars' => $t['stars'], 'amount' => $t['amount'],
                    'note' => $note, 'photo' => '', 'status' => 'pending', 'memo' => null, 'requested_at' => $now, 'decided_at' => 0, 'decided_by' => null, 'seen_at' => 0,
                ]);
            } catch (\PDOException $e) {
                if ((string) $e->getCode() === '23000') throw $dup();   // the same planting at the same moment (UNIQUE)
                throw $e;
            }
            Audit::log('crop_report_requested', $uid, ['id' => $id, 'kind' => $kind, 'bed' => $bedId, 'crop' => $t['crop']]);
            return self::reportOut((array) Db::one('SELECT ' . self::REPORT_COLS . ' FROM crop_reports WHERE id = ?', [$id]));
        });
    }

    /** a stored photo path the app may hand out (defense in depth: only the report-photo pattern) */
    private static function validPhoto(string $p): bool { return preg_match(self::PHOTO_RE, $p) === 1; }

    /** the owner's view of a report (api/farm/report.php, reports.php) — photoUrl only here, never to other players */
    private static function reportOut(array $r): array
    {
        $photo = (string) $r['photo'];
        return [
            'id' => (int) $r['id'], 'kind' => (string) $r['kind'], 'bedId' => (string) $r['bed_id'], 'pid' => (string) $r['pid'], 'cropId' => (string) $r['crop_id'],
            'stars' => (int) $r['stars'], 'amount' => (int) $r['amount'], 'note' => (string) $r['note'], 'status' => (string) $r['status'],
            'memo' => $r['memo'] === null ? '' : (string) $r['memo'], 'requestedAt' => (int) $r['requested_at'], 'decidedAt' => (int) $r['decided_at'],
            'seen' => (int) $r['seen_at'] > 0, 'photoUrl' => self::validPhoto($photo) ? $photo : null,
        ];
    }

    /** decided reports the owner has not marked seen yet */
    public static function unseen(int $uid): int
    {
        return (int) Db::value("SELECT COUNT(*) FROM crop_reports WHERE user_id = ? AND status <> 'pending' AND seen_at = 0", [$uid]);
    }

    /** api/farm/reports.php: {reports: the caller's last $limit (≤ 50), newest first; unseen} */
    public static function reports(int $uid, int $limit = 50): array
    {
        $rows = Db::all('SELECT ' . self::REPORT_COLS . ' FROM crop_reports WHERE user_id = ? ORDER BY id DESC LIMIT ?', [$uid, max(1, min(50, $limit))]);
        return ['reports' => array_map(function ($r) { return self::reportOut($r); }, $rows), 'unseen' => self::unseen($uid)];
    }

    /** api/farm/seen.php: mark the caller's DECIDED reports seen (others' ids and pending ones are untouched) → rows changed */
    public static function markSeen(int $uid, array $ids, ?int $now = null): int
    {
        $now = $now === null ? Clock::ms() : $now;
        $n = 0;
        foreach (array_unique(array_map('intval', array_slice(array_values($ids), 0, 50))) as $id) {
            if ($id < 1) continue;
            $n += Db::exec("UPDATE crop_reports SET seen_at = ? WHERE id = ? AND user_id = ? AND status <> 'pending' AND seen_at = 0", [$now, $id, $uid]);
        }
        return $n;
    }

    /**
     * api/farm/report-photo.php, before the file is read: the caller's own PENDING report without a photo. Another account's
     * id, an unknown one and a decided one are the same 404 NOT_FOUND; a report with a photo → 409 PHOTO_EXISTS.
     */
    public static function photoTarget(int $uid, int $reportId): array
    {
        $r = Db::one('SELECT id, user_id, status, photo FROM crop_reports WHERE id = ? AND user_id = ?', [$reportId, $uid]);
        if (!$r || (string) $r['status'] !== 'pending') throw new ApiException(404, 'NOT_FOUND', '사진을 붙일 완료 확인 요청을 찾을 수 없어요.');
        if ((string) $r['photo'] !== '') throw new ApiException(409, 'PHOTO_EXISTS', '이 요청에는 벌써 사진이 있어요.');
        return $r;
    }

    /** attach the stored photo (once: two uploads at the same moment → the second gets 409 PHOTO_EXISTS) */
    public static function setPhoto(int $uid, int $reportId, string $url): void
    {
        if (!self::validPhoto($url)) throw new \InvalidArgumentException('not a report photo path');
        if (Db::exec("UPDATE crop_reports SET photo = ? WHERE id = ? AND user_id = ? AND status = 'pending' AND photo = ''", [$url, $reportId, $uid]) !== 1) {
            throw new ApiException(409, 'PHOTO_EXISTS', '이 요청에는 벌써 사진이 있어요.');
        }
    }

    // ------------------------------------------------------------------ the admin site (workflow interface 4, CONTRACT §15.4)
    // Static SQL only: every filter is a bound parameter ("? = '' OR column = ?"), searches use LIKE with '!' as the escape
    // character (portable between SQLite and MariaDB). The admin site checks the admin sign-in itself and escapes every
    // value with e(); these functions never trust their filter values either.
    /** Korean names for the admin lists (game-data.json does not export names; an export that adds `name` wins) */
    private const CROP_NAMES = ['CROP_BEAN' => '콩', 'CROP_PEPPER' => '고추', 'CROP_CABBAGE' => '배추', 'CROP_PERILLA' => '들깨', 'CROP_CORN' => '옥수수',
        'CROP_RADISH' => '무', 'CROP_MINT' => '박하', 'CROP_LAVENDER' => '라벤더', 'CROP_ROSEMARY' => '로즈마리', 'CROP_LEMONBALM' => '레몬밤'];
    private const ITEM_NAMES = ['ITEM_BEAN' => '콩', 'ITEM_PEPPER' => '고추', 'ITEM_CABBAGE' => '배추', 'ITEM_PERILLA' => '들깨', 'ITEM_CORN' => '옥수수',
        'ITEM_RADISH' => '무', 'ITEM_MINT' => '박하', 'ITEM_LAVENDER' => '라벤더', 'ITEM_ROSEMARY' => '로즈마리', 'ITEM_LEMONBALM' => '레몬밤',
        'ITEM_DOENJANG' => '된장', 'ITEM_GANJANG' => '간장', 'ITEM_GOCHUJANG' => '고추장', 'ITEM_KIMCHI' => '김치', 'ITEM_VINEGAR' => '전통 식초'];

    public static function cropName(string $id): string
    {
        $c = GameData::crop($id);
        if ($c && isset($c['name']) && is_string($c['name']) && $c['name'] !== '') return $c['name'];
        return isset(self::CROP_NAMES[$id]) ? self::CROP_NAMES[$id] : $id;
    }

    public static function itemName(string $id): string
    {
        $i = GameData::item($id);
        if ($i && isset($i['name']) && is_string($i['name']) && $i['name'] !== '') return $i['name'];
        return isset(self::ITEM_NAMES[$id]) ? self::ITEM_NAMES[$id] : $id;
    }

    /** an account search: '' (all), '#12' / '12' (account id) or a part of the nickname / e-mail → [userId, LIKE pattern] */
    private static function search(string $q): array
    {
        $q = trim(mb_substr($q, 0, 60));
        if ($q === '') return [0, ''];
        if (preg_match('/^#?(\d{1,12})$/', $q, $m)) return [(int) $m[1], ''];
        return [0, '%' . str_replace(['!', '%', '_'], ['!!', '!%', '!_'], mb_strtolower($q)) . '%'];
    }

    private static function page(int $limit, int $offset): array { return [max(1, min(500, $limit)), max(0, min(1000000, $offset))]; }

    /** one farm_beds row as the admin lists show it (times measured by the server; status / leftMs live) */
    private static function bedRow(array $r, int $now): array
    {
        $status = self::liveStatus($r, $now);
        $kind = (string) $r['kind'];
        $first = (int) $r['first_seen_at'];
        $readyAt = (int) $r['ready_at'];
        $growth = (int) $r['growth'];
        if ($kind === 'rt') $growth = $status === 'growing' && $readyAt > $first ? (int) max(0, min(99, floor(($now - $first) * 100 / ($readyAt - $first)))) : ($status === 'cleared' ? 0 : 100);
        return [
            'id' => (int) $r['id'], 'userId' => (int) $r['user_id'], 'nickname' => (string) $r['nickname'], 'email' => (string) $r['email'],
            'bedId' => (string) $r['bed_id'], 'kind' => $kind, 'pid' => (string) $r['pid'], 'cropId' => (string) $r['crop_id'], 'cropName' => self::cropName((string) $r['crop_id']),
            'tier' => (int) $r['tier'], 'firstSeenAt' => $first, 'readyAt' => $readyAt, 'leftMs' => $kind === 'rt' && $status === 'growing' ? max(0, $readyAt - $now) : 0,
            'growth' => $growth, 'care' => (int) $r['care'],
            'stars' => $kind !== 'rt' ? 0 : ($status === 'harvested' ? (int) $r['stars'] : self::starsOf((int) $r['care'])),
            'status' => $status, 'harvestedAt' => (int) $r['harvested_at'], 'amount' => (int) $r['amount'], 'updatedAt' => (int) $r['updated_at'],
            'report' => (string) (isset($r['report_status']) && $r['report_status'] !== null ? $r['report_status'] : ''),
        ];
    }

    /**
     * 🌱 재배 현황 — the beds of every account. $filter: status ('' all | 'active' growing + ready | 'growing' | 'ready' |
     * 'harvested' | 'cleared' — growing / ready of a real-time bed are judged by the server clock), kind ('' | 'rt' | 'plot'),
     * q (a part of the nickname / e-mail, or #id), userId. Growing / ready first (soonest ready first), then the newest.
     * Rows: {id, userId, nickname, email, bedId, kind, pid, cropId, cropName, tier, firstSeenAt, readyAt, leftMs, growth,
     * care, stars, status, harvestedAt, amount, updatedAt, report ('' | pending | approved | rejected)}.
     */
    public static function listBeds(array $filter, int $limit, int $offset): array
    {
        $now = Clock::ms();
        $status = isset($filter['status']) && in_array($filter['status'], ['active', 'growing', 'ready', 'harvested', 'cleared'], true) ? (string) $filter['status'] : '';
        $kind = isset($filter['kind']) && in_array($filter['kind'], ['rt', 'plot'], true) ? (string) $filter['kind'] : '';
        list($uid, $like) = self::search(isset($filter['q']) && is_string($filter['q']) ? $filter['q'] : '');
        if (isset($filter['userId']) && (is_int($filter['userId']) || (is_string($filter['userId']) && ctype_digit($filter['userId'])))) $uid = (int) $filter['userId'];
        list($limit, $offset) = self::page($limit, $offset);
        $rows = Db::all("SELECT b.id, b.user_id, u.nickname, u.email, b.bed_id, b.kind, b.pid, b.crop_id, b.tier, b.first_seen_at, b.ready_at, b.growth, b.care, b.status,
                b.harvested_at, b.amount, b.stars, b.updated_at,
                (SELECT r.status FROM crop_reports r WHERE r.user_id = b.user_id AND r.kind = b.kind AND r.bed_id = b.bed_id AND r.pid = b.pid) AS report_status
            FROM farm_beds b JOIN users u ON u.id = b.user_id
            WHERE (? = '' OR (? = 'active' AND b.status IN ('growing', 'ready'))
                    OR (? = 'growing' AND b.status = 'growing' AND (b.kind = 'plot' OR b.ready_at > ?))
                    OR (? = 'ready' AND (b.status = 'ready' OR (b.status = 'growing' AND b.kind = 'rt' AND b.ready_at <= ?)))
                    OR (? IN ('harvested', 'cleared') AND b.status = ?))
              AND (? = '' OR b.kind = ?)
              AND (? = 0 OR b.user_id = ?)
              AND (? = '' OR u.nickname_key LIKE ? ESCAPE '!' OR u.email LIKE ? ESCAPE '!')
            ORDER BY CASE WHEN b.status IN ('growing', 'ready') THEN 0 ELSE 1 END ASC, CASE WHEN b.status IN ('growing', 'ready') THEN b.ready_at ELSE 0 END ASC,
                b.updated_at DESC, b.id DESC
            LIMIT ? OFFSET ?", [$status, $status, $status, $now, $status, $now, $status, $status, $kind, $kind, $uid, $uid, $like, $like, $like, $limit, $offset]);
        return array_map(function ($r) use ($now) { return self::bedRow($r, $now); }, $rows);
    }

    /**
     * 🏚️ 곳간 — the storage of each account (largest first): {userId, nickname, email, items: {ITEM_X: qty}, itemList: [{itemId,
     * name, qty}], kinds, total, cap, updatedAt}. $q: a part of the nickname / e-mail, or #id.
     */
    public static function listStorage(int $limit, int $offset, string $q): array
    {
        list($uid, $like) = self::search($q);
        list($limit, $offset) = self::page($limit, $offset);
        $users = Db::all("SELECT s.user_id, u.nickname, u.email, SUM(s.qty) AS total, COUNT(*) AS kinds, MAX(s.updated_at) AS updated_at
            FROM farm_storage s JOIN users u ON u.id = s.user_id
            WHERE (? = 0 OR s.user_id = ?) AND (? = '' OR u.nickname_key LIKE ? ESCAPE '!' OR u.email LIKE ? ESCAPE '!')
            GROUP BY s.user_id, u.nickname, u.email
            ORDER BY total DESC, s.user_id ASC
            LIMIT ? OFFSET ?", [$uid, $uid, $like, $like, $like, $limit, $offset]);
        $cap = GameData::storageCap();
        $out = [];
        foreach ($users as $u) {
            $items = [];
            $list = [];
            foreach (Db::all('SELECT item_id, qty FROM farm_storage WHERE user_id = ? ORDER BY item_id ASC', [(int) $u['user_id']]) as $r) {
                $items[(string) $r['item_id']] = (int) $r['qty'];
                $list[] = ['itemId' => (string) $r['item_id'], 'name' => self::itemName((string) $r['item_id']), 'qty' => (int) $r['qty']];
            }
            $out[] = ['userId' => (int) $u['user_id'], 'nickname' => (string) $u['nickname'], 'email' => (string) $u['email'], 'items' => $items, 'itemList' => $list,
                'kinds' => (int) $u['kinds'], 'total' => (int) $u['total'], 'cap' => $cap, 'updatedAt' => (int) $u['updated_at']];
        }
        return $out;
    }

    /** 🏚️ 곳간 totals per item over every account: [{itemId, name, qty, accounts}] (largest first) */
    public static function storageTotals(): array
    {
        return array_map(function ($r) {
            return ['itemId' => (string) $r['item_id'], 'name' => self::itemName((string) $r['item_id']), 'qty' => (int) $r['qty'], 'accounts' => (int) $r['accounts']];
        }, Db::all('SELECT item_id, SUM(qty) AS qty, COUNT(*) AS accounts FROM farm_storage GROUP BY item_id ORDER BY qty DESC, item_id ASC'));
    }

    /** one crop_reports row (with the joined account / admin / bed columns) as the admin lists show it */
    private static function adminReport(array $r): array
    {
        return [
            'id' => (int) $r['id'], 'userId' => (int) $r['user_id'], 'nickname' => (string) $r['nickname'], 'email' => (string) $r['email'],
            'kind' => (string) $r['kind'], 'bedId' => (string) $r['bed_id'], 'pid' => (string) $r['pid'], 'cropId' => (string) $r['crop_id'], 'cropName' => self::cropName((string) $r['crop_id']),
            'stars' => (int) $r['stars'], 'amount' => (int) $r['amount'], 'note' => (string) $r['note'], 'status' => (string) $r['status'],
            'memo' => $r['memo'] === null ? '' : (string) $r['memo'], 'requestedAt' => (int) $r['requested_at'], 'decidedAt' => (int) $r['decided_at'],
            'decidedBy' => $r['decided_by'] === null ? 0 : (int) $r['decided_by'], 'decidedByNick' => (string) ($r['decided_nick'] === null ? '' : $r['decided_nick']),
            'seenAt' => (int) $r['seen_at'], 'hasPhoto' => self::validPhoto((string) $r['photo']),
            'firstSeenAt' => (int) ($r['first_seen_at'] === null ? 0 : $r['first_seen_at']), 'readyAt' => (int) ($r['ready_at'] === null ? 0 : $r['ready_at']),
            'harvestedAt' => (int) ($r['harvested_at'] === null ? 0 : $r['harvested_at']), 'bedStatus' => (string) ($r['bed_status'] === null ? '' : $r['bed_status']),
        ];
    }

    /** the admin report query; $id > 0 = that one report */
    private static function reportQuery(string $status, int $limit, int $offset, string $q, int $id): array
    {
        $status = in_array($status, self::REPORT_STATUSES, true) ? $status : '';
        list($uid, $like) = self::search($q);
        list($limit, $offset) = self::page($limit, $offset);
        return Db::all("SELECT r.id, r.user_id, r.kind, r.bed_id, r.pid, r.crop_id, r.stars, r.amount, r.note, r.photo, r.status, r.memo, r.requested_at,
                r.decided_at, r.decided_by, r.seen_at, u.nickname, u.email, d.nickname AS decided_nick,
                b.first_seen_at, b.ready_at, b.harvested_at, b.status AS bed_status
            FROM crop_reports r JOIN users u ON u.id = r.user_id
            LEFT JOIN users d ON d.id = r.decided_by
            LEFT JOIN farm_beds b ON b.user_id = r.user_id AND b.kind = r.kind AND b.bed_id = r.bed_id AND b.pid = r.pid
            WHERE (? = 0 OR r.id = ?) AND (? = '' OR r.status = ?) AND (? = 0 OR r.user_id = ?)
              AND (? = '' OR u.nickname_key LIKE ? ESCAPE '!' OR u.email LIKE ? ESCAPE '!')
            ORDER BY CASE WHEN r.status = 'pending' THEN 0 ELSE 1 END ASC, CASE WHEN r.status = 'pending' THEN r.requested_at ELSE 0 END ASC,
                r.decided_at DESC, r.id DESC
            LIMIT ? OFFSET ?", [$id, $id, $status, $status, $uid, $uid, $like, $like, $like, $limit, $offset]);
    }

    /**
     * ✅ 완료 확인 — completion requests of every account, pending first (oldest first), then the latest decisions.
     * $status: '' | pending | approved | rejected; $q: a part of the nickname / e-mail, or #id. Rows: {id, userId, nickname,
     * email, kind, bedId, pid, cropId, cropName, stars, amount, note, status, memo, requestedAt, decidedAt, decidedBy,
     * decidedByNick, seenAt, hasPhoto, firstSeenAt, readyAt, harvestedAt, bedStatus} — times measured by the server.
     * The note is already PII-masked; the admin site still escapes everything. The photo: photoPath($id).
     */
    public static function listReports(string $status, int $limit, int $offset, string $q): array
    {
        return array_map(function ($r) { return self::adminReport($r); }, self::reportQuery($status, $limit, $offset, $q, 0));
    }

    /** ['pending' => n, 'approved' => n, 'rejected' => n] */
    public static function countReports(): array
    {
        $out = ['pending' => 0, 'approved' => 0, 'rejected' => 0];
        foreach (Db::all('SELECT status, COUNT(*) AS n FROM crop_reports GROUP BY status') as $r) if (isset($out[(string) $r['status']])) $out[(string) $r['status']] = (int) $r['n'];
        return $out;
    }

    /**
     * ✅ 완료 처리 / ↩️ 돌려보내기 with a memo (≤ farm.memo_max characters; cleaned, PII-masked and bad-word-filtered — the
     * child reads it). A pending report (or a changed decision) gets decided_at = now and decided_by = the admin; the same
     * decision again only edits the memo (the stamp time stays). Either way the child is shown it again (seen_at = 0).
     * Audit crop_report_decided. 403 FORBIDDEN for a non-admin actor, 400 INVALID_INPUT for another status / an over-long
     * memo, 404 NOT_FOUND for an unknown report. @return array the report as listReports() shows it
     */
    public static function decide(array $actor, int $reportId, string $status, string $memo): array
    {
        if ((isset($actor['role']) ? $actor['role'] : '') !== 'admin') throw new ApiException(403, 'FORBIDDEN', '관리자 권한이 필요해요.');
        if (!in_array($status, ['approved', 'rejected'], true)) V::fail('status', '값은 approved 또는 rejected 여야 해요.');
        $max = max(1, (int) Config::get('farm.memo_max', 500));
        V::str($memo, 'memo', $max);
        $memo = self::cleanNote($memo, $max);
        $actorId = (int) (isset($actor['id']) ? $actor['id'] : 0);
        return Db::tx(function () use ($reportId, $status, $memo, $actorId) {
            $r = Db::one('SELECT id, user_id, status, memo FROM crop_reports WHERE id = ?' . Db::forUpdate(), [$reportId]);
            if (!$r) throw new ApiException(404, 'NOT_FOUND', '완료 확인 요청을 찾을 수 없어요.');
            $was = (string) $r['status'];
            $edit = $was === $status;
            if (!$edit) {
                Db::exec('UPDATE crop_reports SET status = ?, memo = ?, decided_at = ?, decided_by = ?, seen_at = 0 WHERE id = ?', [$status, $memo, Clock::ms(), $actorId > 0 ? $actorId : null, $reportId]);
            } elseif ((string) $r['memo'] !== $memo) {
                Db::exec('UPDATE crop_reports SET memo = ?, seen_at = 0 WHERE id = ?', [$memo, $reportId]);
            }
            Audit::log('crop_report_decided', (int) $r['user_id'], ['id' => $reportId, 'status' => $status, 'was' => $was, 'memoEdit' => $edit, 'memoChars' => mb_strlen($memo)], 'info', $actorId > 0 ? $actorId : null);
            $rows = self::reportQuery('', 1, 0, '', $reportId);
            return self::adminReport($rows[0]);
        });
    }

    /** 📊 대시보드: real-time beds growing / ready (server clock), harvested today, pending requests, 곳간 total (+ quick plots, scale) */
    public static function dashboard(): array
    {
        $now = Clock::ms();
        $today = Clock::startOfDayMs();
        $v = function (string $sql, array $p = []): int { return (int) Db::value($sql, $p); };
        return [
            'growing' => $v("SELECT COUNT(*) FROM farm_beds WHERE kind = 'rt' AND status = 'growing' AND ready_at > ?", [$now]),
            'ready' => $v("SELECT COUNT(*) FROM farm_beds WHERE kind = 'rt' AND (status = 'ready' OR (status = 'growing' AND ready_at <= ?))", [$now]),
            'harvestedToday' => $v("SELECT COUNT(*) FROM farm_beds WHERE kind = 'rt' AND status = 'harvested' AND harvested_at >= ?", [$today]),
            'reportsPending' => $v("SELECT COUNT(*) FROM crop_reports WHERE status = 'pending'"),
            'storageTotal' => $v('SELECT COALESCE(SUM(qty), 0) FROM farm_storage'),
            'plotsGrowing' => $v("SELECT COUNT(*) FROM farm_beds WHERE kind = 'plot' AND status = 'growing'"),
            'plotsReady' => $v("SELECT COUNT(*) FROM farm_beds WHERE kind = 'plot' AND status = 'ready'"),
            'accounts' => $v("SELECT COUNT(DISTINCT user_id) FROM farm_beds WHERE status IN ('growing', 'ready')"),
            'scale' => self::scale(),
        ];
    }

    /**
     * Retention (cli farm:cleanup): finished rows (harvested / cleared) not updated for $days days and not referred to by a
     * completion request are removed — mostly the quick-plot mirror, one row per planting. Growing / ready rows always stay;
     * a removed real-time pid is harmless (a planting id the server does not know gets the server's full growing time).
     * @return int rows removed
     */
    public static function cleanup(int $days = 90): int
    {
        $before = Clock::ms() - max(1, min(36500, $days)) * 86400000;
        return Db::exec("DELETE FROM farm_beds WHERE status IN ('harvested', 'cleared') AND updated_at < ?
            AND NOT EXISTS (SELECT 1 FROM crop_reports r WHERE r.user_id = farm_beds.user_id AND r.kind = farm_beds.kind AND r.bed_id = farm_beds.bed_id AND r.pid = farm_beds.pid)", [$before]);
    }

    /**
     * The absolute path of a report's photo for the admin site to stream after ITS OWN admin check (e.g. ?tab=reports&photo=id);
     * null without a photo, for a stored path that is not a report photo, or when the file is missing / outside uploads/.
     */
    public static function photoPath(int $reportId): ?string
    {
        $p = Db::value('SELECT photo FROM crop_reports WHERE id = ?', [$reportId]);
        if (!is_string($p) || !self::validPhoto($p)) return null;
        $base = realpath(Config::uploadDir());
        $real = realpath(Config::uploadDir() . DIRECTORY_SEPARATOR . str_replace('/', DIRECTORY_SEPARATOR, Str::sub($p, strlen('uploads/'))));
        if ($base === false || $real === false || strpos($real, rtrim($base, DIRECTORY_SEPARATOR) . DIRECTORY_SEPARATOR) !== 0 || !is_file($real)) return null;
        return $real;
    }
}
