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

    /** String(plantedAt) of a quick plot as JavaScript prints it; null when the mirror cannot reproduce it (not mirrored) */
    public static function plotPid($plantedAt): ?string
    {
        if (is_int($plantedAt)) return $plantedAt > 0 && $plantedAt < 1000000000000000 ? (string) $plantedAt : null;
        if (is_float($plantedAt) && is_finite($plantedAt) && $plantedAt > 0 && $plantedAt < 1e15 && floor($plantedAt) === $plantedAt) return sprintf('%.0f', $plantedAt);
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
}
