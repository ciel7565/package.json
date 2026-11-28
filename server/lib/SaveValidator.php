<?php
/**
 * Server-side save validation (anti-cheat) for player/save.php.
 *
 * The client owns the simulation, so the server cannot replay every action. Instead it checks that the
 * difference between the previously accepted save (P) and the new one (N) is something real play could
 * have produced in the elapsed *server* time:
 *
 *   1. shape & ranges           numbers finite, ids well-formed, quantities within limits
 *   2. identity                 profile.id must match the account (immutable); profile.role is set to the account's
 *   3. farming timing           growth/harvests cannot outpace crop growthTime × harvestSpeedTolerance (× speed tier)
 *   4. fermentation timing      progress/claims cannot outpace recipe baseDuration (max speed × speed tier, tolerance)
 *   4b. movement / play time    Δstats.distance ≤ move_max_speed × min(tier, 3) × elapsed (+ slack): the base run of
 *                               12 m/s (phase 6: 2× pace) passes with room to spare, a teleported 10,000 km does not;
 *                               Δstats.playTime ≤ elapsed server time (+ slack)
 *   5. economy                  Δ(net worth = coin + item replacement value + decor + extra jars), Δexp, Δedu
 *                               must be explained by rewards the server can account for (quests, achievements,
 *                               quizzes — each paid once, tracked in a server-side ledger — harvests, claims,
 *                               crafts, education). The unexplained remainder must fit a small per-save
 *                               allowance (grows with elapsed time) AND a daily budget; plus hard per-save caps
 *                               from game-data limits.
 *
 * Speed tier (CONTRACT §14.1): the user's subscription tier (1..4) scales the time-based thresholds. A tier change
 * mid-session is accepted either way for the next save: the previous save's tier (ledger meta.tier) and the current
 * one are both tried — the larger wins once.
 *
 * Phase 7 (CONTRACT §15.1 / §15.2): the real-time beds (data.rtfarm) and the 곳간 (data.storage) are shape-checked here
 * (RT_BAD_BED, RT_BAD_CROP, RT_BAD_SHAPE, STORAGE_BAD_ITEM, STORAGE_BAD_QTY, STORAGE_OVER_CAP; the client's storage cap is
 * stored as the server's, like the role); the 곳간 is part of the net worth, so moving items between the bag and the 곳간
 * never changes the economy check. The server's own judgement of the real-time beds (Tfm\Farm: planting times measured
 * by the server clock, early harvests, reused planting ids) arrives through the optional $rt hook of validate(): it runs
 * after the shape checks — only when the rt shape is clean — and returns its violations plus the explained reward of
 * every harvest it validated (item value × amount + rt coin, rt exp), which joins the economy check below.
 *
 * Any violation → HTTP 409 VALIDATION_FAILED with the stored save, so the client restores it.
 * All tolerances live in config 'save.tolerance' and are documented in README-SERVER.md.
 * State objects are stdClass trees (json_decode(..., false)) so {} and [] survive a round trip.
 * PHP 7.2 syntax only.
 */
declare(strict_types=1);

namespace Tfm;

if (!defined('TFM_BOOT')) { if (function_exists('header_remove')) header_remove('X-Powered-By'); http_response_code(404); exit; }

final class SaveValidator
{
    private const ID_RE = '/^[A-Za-z0-9_\-]{1,48}$/';
    private const JAR_STATES = ['EMPTY', 'PREPARING', 'FERMENTING', 'AGING', 'COMPLETE', 'CLAIMED'];
    private const JAR_ACTIVE = ['PREPARING', 'FERMENTING', 'AGING'];
    private const REGROW = 30.0; // herbs restart at 30 % after a harvest (crop category is not exported → applied to all)
    /** names of Object.prototype members (+ 'prototype'): as a save-map key ('inventory.constructor', 'visited.__proto__')
     *  they resolve to an inherited function on every client, so the server never stores them (03-state normalize
     *  drops them on the client side too) */
    private const PROTO_KEYS = ['__proto__', 'constructor', 'prototype', 'toString', 'toLocaleString', 'valueOf', 'hasOwnProperty',
        'isPrototypeOf', 'propertyIsEnumerable', '__defineGetter__', '__defineSetter__', '__lookupGetter__', '__lookupSetter__'];

    /** @var array */
    private $violations = [];
    /** @var array */
    private $notes = [];
    /** @var array */
    private $tol;
    /** @var int effective speed tier for this save (1..4) */
    private $tier = 1;
    /** @var int [entitle] the movement multiplier of the account's entitlement (0 = derived from the tier) */
    private $move = 0;
    /** @var int [entitle] limits.jars of the account's entitlement (0 = not judged) */
    private $jarLimit = 0;

    private function __construct() { $this->tol = (array) Config::get('save.tolerance', []); }

    // ------------------------------------------------------------------ tiny typed accessors (stdClass trees)
    private static function o($v): ?object { return $v instanceof \stdClass ? $v : null; }
    private static function p(?object $o, string $k) { return ($o !== null && property_exists($o, $k)) ? $o->$k : null; }
    private static function n($v, float $d = 0.0): float { return (is_int($v) || is_float($v)) && is_finite((float) $v) ? (float) $v : $d; }
    private static function i($v): int { return (is_int($v) || is_float($v)) && is_finite((float) $v) ? (int) floor((float) $v) : 0; }
    private static function s($v): string { return is_string($v) ? $v : ''; }
    /** properties of an object as [string key => value] */
    private static function kv($o): array
    {
        if (!$o instanceof \stdClass) return [];
        $out = [];
        foreach (get_object_vars($o) as $k => $v) $out[(string) $k] = $v;
        return $out;
    }
    private function t(string $k, float $d): float { return isset($this->tol[$k]) && is_numeric($this->tol[$k]) ? (float) $this->tol[$k] : $d; }
    /** movement multiplier of the speed tier: tier 4 still moves 3× (CONTRACT §14.1) */
    private function moveMul(): int { return $this->move > 0 ? min($this->move, 3) : min($this->tier, 3); }

    private function violate(string $code, array $detail = []): void
    {
        if (count($this->violations) < 20) $this->violations[] = ['code' => $code] + $detail;
    }

    /** malformed (not merely suspicious) input → 400 */
    private static function bad(string $why)
    {
        throw new ApiException(400, 'INVALID_SAVE', '저장 데이터 형식이 올바르지 않아요.', ['reason' => $why]);
    }

    /**
     * malformed → 400 when any map key down to three levels (state → inventory / visited / education → completed …,
     * the depth 03-state normalize cleans) is an Object.prototype member name. Runs on every save, validation on or off.
     */
    public static function assertNoProtoKeys(object $o, int $depth = 2, string $path = 'save'): void
    {
        foreach (get_object_vars($o) as $k => $v) {
            $k = (string) $k;
            if (in_array($k, self::PROTO_KEYS, true)) self::bad('reserved key in ' . mb_substr($path, 0, 40));
            if ($depth > 0 && $v instanceof \stdClass) self::assertNoProtoKeys($v, $depth - 1, $path === 'save' ? $k : "$path.$k");
        }
    }

    // ------------------------------------------------------------------ public entry
    /**
     * @param object      $n      new state
     * @param object|null $p      previous accepted state (null = first save)
     * @param array       $meta   server ledger from player_saves.meta
     * @param array       $user   users row
     * @param int         $prevAt server ms of the previous accepted save (or account creation)
     * @param int         $tier   the user's current speed tier (subscriptions table), 1..4
     * @param callable|null $rt   the real-time farm judge (player/save.php: Tfm\Farm::plan): function (object $n, ?object $p): array
     *                            ['violations' => [['code' => …] …], 'explain' => ['value' => int, 'exp' => int], 'harvests' => int];
     *                            called after the shape checks, only when data.rtfarm / data.storage have a clean shape
     * @param array|null  $ent    [entitle] CONTRACT §17.2: the account's entitlement (Tfm\Entitle::forUser). With it, $tier is
     *                            its growth multiplier, movement is judged with ent.speed.move and the jars with
     *                            ent.limits.jars (JAR_LIMIT / JAR_LOCKED). null (older callers): everything from $tier.
     * @return array{ok:bool, violations:array, notes:array, meta:array, summary:array}
     */
    public static function validate(object $n, ?object $p, array $meta, array $user, int $prevAt, int $now, int $tier = 1, ?callable $rt = null, ?array $ent = null): array
    {
        $v = new self();
        return $v->run($n, $p, $meta, $user, $prevAt, $now, $tier, $rt, $ent);
    }

    private function run(object $n, ?object $p, array $meta, array $user, int $prevAt, int $now, int $tier, ?callable $rtHook, ?array $ent = null): array
    {
        // the tier of the previous accepted save is tried too (a change mid-session): the larger wins once
        $tier = max(1, min(4, $tier));
        $prevTier = max(1, min(4, (int) (isset($meta['tier']) ? $meta['tier'] : 1)));
        $this->tier = max($tier, $prevTier);
        // [entitle] CONTRACT §17.2: the movement multiplier and the jar limit of the entitlement; like the tier, the
        // values of the previous accepted save are tried too (a plan that ended a moment ago): the larger wins once
        $entMove = 0;
        $entJars = 0;
        if ($ent !== null) {
            $entMove = max(1, min(3, (int) (isset($ent['speed']['move']) ? $ent['speed']['move'] : min($tier, 3))));
            $entJars = max(1, min(16, (int) (isset($ent['limits']['jars']) ? $ent['limits']['jars'] : 3)));
            $this->move = max($entMove, max(1, min(3, (int) (isset($meta['move']) ? $meta['move'] : min($prevTier, 3)))));
            $this->jarLimit = max($entJars, max(0, min(16, (int) (isset($meta['jars']) ? $meta['jars'] : 0))));
        }
        $this->shape($n);
        $rtClean = $this->rtShape($n);
        // ---------------------------------------------------------- identity (immutable fields)
        $prof = self::o(self::p($n, 'profile'));
        $pid = self::p($prof, 'id');
        if (!(is_string($pid) || is_int($pid)) || (string) $pid !== (string) $user['id']) $this->violate('PROFILE_ID');
        // the role is the account's (player/save.php stores it so): a tab that missed a role change (admin.php 관리자
        // 지정 / 해제) is not refused — refusing would bring its stored copy back with the same old role, save after save
        $role = self::s(self::p($prof, 'role'));
        $want = $user['role'] === 'admin' ? 'admin' : 'user';
        if ($role !== $want) { if ($prof !== null) $prof->role = $want; $this->notes[] = 'role'; }

        // ---------------------------------------------------------- progress reset (설정 → 진행 초기화)
        if ($p !== null && $this->looksLikeReset($n, $p)) {
            $this->notes[] = 'reset';
            // a fresh start begins at 0 m: allow what can be walked in the 10 minutes before its first save
            $resetD = self::n(self::p(self::o(self::p($n, 'stats')), 'distance'));
            $capD = max(1.0, $this->t('move_max_speed', 18)) * $this->moveMul() * 600 + max(0.0, $this->t('move_slack_m', 300));
            if ($resetD > $capD) $this->violate('DISTANCE_TOO_FAST', ['gain' => (int) round($resetD), 'allowed' => (int) round($capD), 'reset' => true]);
            $meta = ['v' => 1, 'resets' => (int) (isset($meta['resets']) ? $meta['resets'] : 0) + 1, 'budget' => isset($meta['budget']) ? $meta['budget'] : null];
            $p = null;
        }
        $first = $p === null;
        $meta['v'] = 1;
        $meta['tier'] = $tier;
        if ($ent !== null) { $meta['move'] = $entMove; $meta['jars'] = $entJars; } // [entitle] for the next save's "larger wins once"
        $paid = isset($meta['paid']) && is_array($meta['paid']) ? $meta['paid'] : [];
        foreach (['q', 'a', 'z', 'e', 'g'] as $k) if (!isset($paid[$k]) || !is_array($paid[$k])) $paid[$k] = [];
        // ids an older copy took back (see "regressed" below) and the losses that copy gave back: claiming such an
        // id again is explained only from that credit, so a child can finish the quest again but nothing pays twice
        $reg = isset($meta['regressed']) && is_array($meta['regressed']) ? $meta['regressed'] : [];
        foreach (['q', 'a', 'z', 'e'] as $k) if (!isset($reg[$k]) || !is_array($reg[$k])) $reg[$k] = [];
        $cr = isset($meta['credit']) && is_array($meta['credit']) ? $meta['credit'] : [];
        $credit = ['value' => max(0, (int) (isset($cr['value']) ? $cr['value'] : 0)), 'exp' => max(0, (int) (isset($cr['exp']) ? $cr['exp'] : 0)), 'edu' => max(0, (int) (isset($cr['edu']) ? $cr['edu'] : 0))];
        $fromCredit = ['value' => 0, 'exp' => 0, 'edu' => 0];

        $dt = max(0.0, ($now - $prevAt) / 1000);
        $statsNOf = function (?object $s): ?object { return $s ? self::o(self::p($s, 'stats')) : null; };
        $explain = ['value' => 0, 'exp' => 0, 'edu' => 0];
        $pay = function (string $kind, string $id, array $r) use (&$reg, &$explain, &$fromCredit): void {
            $again = isset($reg[$kind][$id]);
            unset($reg[$kind][$id]);
            foreach ($r as $k => $x) { if ($again) $fromCredit[$k] += $x; else $explain[$k] += $x; }
        };
        if ($first) $explain['value'] += (int) $this->t('new_player_value', 3000);

        if (!$first) $this->movement($statsNOf($n), $statsNOf($p), $dt);
        $farm = $this->farming($n, $p, $first, $dt);
        $ferm = $this->fermentation($n, $p, $first, $dt);
        $this->jarLimits($n, $p); // [entitle] CONTRACT §17.2
        $this->planMarks($n, $p); // [content] CONTRACT §17.8
        // [fishing] CONTRACT §18.3: the catches since the last save, bounded by time, explain their exp / edu
        $fishX = $this->fishing($n, $p, $dt);
        $this->healing($n, $p, $dt, $now); // [healing] CONTRACT §19.6
        $explain['value'] += $this->wardrobe($n, $p, $user, $first); // [wardrobe] CONTRACT §19.1: owned pieces, worn pieces, the migration
        $explain['exp'] += $fishX['exp'];
        $explain['edu'] += $fishX['edu'];
        $max = GameData::maxima();
        $rt = $rtClean && $rtHook !== null ? $this->rtJudge($rtHook, $n, $p) : ['explain' => ['value' => 0, 'exp' => 0], 'harvests' => 0];

        // harvests / claims / crafts (bounded by time above)
        $statsN = self::o(self::p($n, 'stats'));
        $statsP = $p ? self::o(self::p($p, 'stats')) : null;
        $d = function (string $k) use ($statsN, $statsP): int { return max(0, self::i(self::p($statsN, $k)) - self::i(self::p($statsP, $k))); };
        $dHarv = $d('harvests');
        // a client may count its validated real-time harvests in stats.harvests too (achievements): they are allowed here,
        // their reward is the rt hook's (stats.rtHarvests is checked by Tfm\Farm: RT_HARVEST_COUNT)
        if ($dHarv > $farm['harvests'] + 1 + $rt['harvests']) $this->violate('HARVEST_COUNT', ['stat' => $dHarv, 'plots' => $farm['harvests'], 'rt' => $rt['harvests']]);
        $harv = min($dHarv, $farm['harvests'] + 1);
        $dClaims = $d('fermentsClaimed');
        if ($dClaims > $ferm['slots'] + 1) $this->violate('FERMENT_CLAIMS', ['stat' => $dClaims, 'possible' => $ferm['slots']]);
        $claims = min($dClaims, $ferm['slots'] + 1);
        // crafting consumes ≥ 3 crop items per craft, and crops only come from harvests (the shop sells seeds)
        $dCrafts = $d('crafts');
        $cropItems = 0;
        if ($p) {
            // crops kept in the 곳간 are ingredients too (taken out and crafted within one save interval)
            foreach ([self::p($p, 'inventory'), self::p(self::o(self::p($p, 'storage')), 'items')] as $box) {
                foreach (self::kv($box) as $iid => $q) {
                    $it = GameData::item($iid);
                    if ($it && (isset($it['type']) ? $it['type'] : '') === 'crop') $cropItems += max(0, min(9999, self::i($q)));
                }
            }
        }
        $craftCap = min(3 + (int) floor(min($dt, 86400) / 2), intdiv($cropItems + $farm['harvests'] * 6, 3) + 1);
        if ($dCrafts > $craftCap) $this->violate('CRAFT_COUNT', ['stat' => $dCrafts, 'possible' => $craftCap]);
        $crafts = min($dCrafts, $craftCap);
        $explain['value'] += self::topSum($farm['values'], $harv, $max['harvestValue']) + self::topSum($ferm['values'], $claims, $max['claimValue']) + $crafts * $max['craftValue'];
        $explain['exp'] += self::topSum($farm['exps'], $harv, $max['harvestExp']) + self::topSum($ferm['exps'], $claims, $max['claimExp']) + $crafts * $max['craftExp'];
        // every real-time harvest the server validated (Tfm\Farm, measured by the server clock): item value × amount + rt coin / exp
        $explain['value'] += $rt['explain']['value'];
        $explain['exp'] += $rt['explain']['exp'];

        // ---------------------------------------------------------- one-time rewards (server ledger: each paid once)
        $gd = GameData::all();
        $newQuests = 0;
        $pQuests = $p ? self::o(self::p($p, 'quests')) : null;
        foreach (self::kv(self::p($n, 'quests')) as $qid => $q) {
            if (!preg_match(self::ID_RE, $qid)) self::bad('quest id');
            if (self::s(self::p(self::o($q), 'status')) !== 'claimed' || isset($paid['q'][$qid])) continue;
            $paid['q'][$qid] = $now;
            if (self::s(self::p(self::o(self::p($pQuests, $qid)), 'status')) === 'claimed') continue; // already claimed before the ledger knew
            $def = isset($gd['quests'][$qid]) ? $gd['quests'][$qid] : null;
            if (!is_array($def)) { $this->notes[] = "unknown quest $qid"; continue; }
            $this->checkQuestObjectives($qid, $def, $n);
            $pay('q', $qid, GameData::rewardOf(isset($def['reward']) && is_array($def['reward']) ? $def['reward'] : null));
            $newQuests++;
        }
        $pAch = $p ? self::o(self::p($p, 'achievements')) : null;
        foreach (self::kv(self::p($n, 'achievements')) as $aid => $at) {
            if (!preg_match(self::ID_RE, $aid)) self::bad('achievement id');
            if (!$at || isset($paid['a'][$aid])) continue;
            $paid['a'][$aid] = $now;
            if (self::p($pAch, $aid)) continue;
            $def = isset($gd['achievements'][$aid]) ? $gd['achievements'][$aid] : null;
            if (!is_array($def)) { $this->notes[] = "unknown achievement $aid"; continue; }
            if (isset($def['condition']['stat'], $def['condition']['gte']) && is_string($def['condition']['stat'])) {
                // a missing / null counter is 0 (the client never unlocks on one), never "cannot check"
                $have = self::n(self::p($statsN, $def['condition']['stat']), 0.0);
                if ($have < (float) $def['condition']['gte']) $this->violate('ACHIEVEMENT_CONDITION', ['id' => $aid]);
            }
            $pay('a', $aid, GameData::rewardOf(isset($def['reward']) && is_array($def['reward']) ? $def['reward'] : null));
        }
        $eduN = self::o(self::p($n, 'education'));
        $eduP = $p ? self::o(self::p($p, 'education')) : null;
        $quizP = self::o(self::p($eduP, 'quiz'));
        $solved = function ($rec): bool { return $rec === true || (self::o($rec) && self::p(self::o($rec), 'correct') === true); };
        $quizDefault = ['exp' => 100, 'edu' => 10];
        foreach (self::kv(self::p($eduN, 'quiz')) as $zid => $rec) {
            if (!preg_match(self::ID_RE, $zid)) self::bad('quiz id');
            if (!$solved($rec) || isset($paid['z'][$zid])) continue;
            $paid['z'][$zid] = $now;
            if ($solved(self::p($quizP, $zid))) continue;
            $def = isset($gd['quizzes'][$zid]) ? $gd['quizzes'][$zid] : null;
            $pay('z', $zid, GameData::rewardOf(is_array($def) ? (isset($def['reward']) && is_array($def['reward']) ? $def['reward'] : $quizDefault) : $quizDefault));
        }
        $compP = self::o(self::p($eduP, 'completed'));
        foreach (self::kv(self::p($eduN, 'completed')) as $eid => $at) {
            if (!preg_match(self::ID_RE, $eid)) self::bad('edu id');
            if (!$at || isset($paid['e'][$eid])) continue;
            $paid['e'][$eid] = $now;
            if (self::p($compP, $eid)) continue;
            $pay('e', $eid, ['value' => 0, 'exp' => 0, 'edu' => (int) $this->t('edu_complete', 5)]);
        }
        // daily engagement rewards (출석 체크 · 오늘의 미션, src/game/62-engagement.js): explained once per day key.
        // The client uses the player's local date, so only keys within ±1 day of the server date are accepted.
        $engN = self::o(self::p($n, 'engagement'));
        $engP = $p ? self::o(self::p($p, 'engagement')) : null;
        $nearDay = function (string $d) use ($now): bool {
            if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $d)) return false;
            foreach ([-1, 0, 1] as $off) if ($d === Clock::day($now + $off * 86400000)) return true;
            return false;
        };
        $maxVal = function (array $ids): int {
            $m = 0;
            foreach ($ids as $id) $m = max($m, GameData::itemValue($id));
            return $m;
        };
        $ckDay = self::s(self::p(self::o(self::p($engN, 'checkin')), 'lastDay'));
        $ckDayP = self::s(self::p(self::o(self::p($engP, 'checkin')), 'lastDay'));
        if ($ckDay !== '' && $ckDay !== $ckDayP && $nearDay($ckDay) && !isset($paid['g']['c' . $ckDay])) {
            $paid['g']['c' . $ckDay] = $now;
            $explain['value'] += 250 + $maxVal(['ITEM_SMALL_JAR', 'ITEM_FLOWERPOT', 'ITEM_LANTERN']) + 2 * $maxVal(['ITEM_SEED_BEAN', 'ITEM_SEED_LAVENDER', 'ITEM_SEED_CORN']);
            $explain['exp'] += 50;
        }
        $dailyN = self::o(self::p($engN, 'daily'));
        $dailyP = self::o(self::p($engP, 'daily'));
        $dDay = self::s(self::p($dailyN, 'day'));
        if ($nearDay($dDay)) {
            $countClaimed = function (?object $daily) use ($dDay): int {
                if ($daily === null || self::s(self::p($daily, 'day')) !== $dDay) return 0;
                $c = 0;
                $ms = self::p($daily, 'missions');
                if (is_array($ms)) foreach (array_slice($ms, 0, 3) as $m) if (self::p(self::o($m), 'claimed') === true) $c++;
                return $c;
            };
            $claimedN = $countClaimed($dailyN);
            $already = max($countClaimed($dailyP), (int) (isset($paid['g']['m' . $dDay]) ? $paid['g']['m' . $dDay] : 0));
            if ($claimedN > $already) {
                $k = $claimedN - $already;
                $paid['g']['m' . $dDay] = $claimedN;
                $explain['value'] += 180 * $k;
                $explain['exp'] += 40 * $k;
                $explain['edu'] += 5 * $k;
            }
            $bonusBefore = self::p($dailyP, 'bonus') === true && self::s(self::p($dailyP, 'day')) === $dDay;
            if (self::p($dailyN, 'bonus') === true && $claimedN >= 3 && !$bonusBefore && !isset($paid['g']['b' . $dDay])) {
                $paid['g']['b' . $dDay] = $now;
                $explain['value'] += 200 + $maxVal(['ITEM_SEED_PEPPER', 'ITEM_SEED_CABBAGE', 'ITEM_SEED_PERILLA', 'ITEM_SEED_RADISH', 'ITEM_SEED_MINT', 'ITEM_SEED_ROSEMARY', 'ITEM_SEED_LEMONBALM']);
                $explain['exp'] += 50;
            }
        }

        foreach ($fromCredit as $k => $x) { $use = min($x, $credit[$k]); $explain[$k] += $use; $credit[$k] -= $use; }

        // ---------------------------------------------------------- economy totals
        $wN = $this->netWorth($n);
        $wP = $p ? $this->netWorth($p) : 0;
        $xN = $this->expTotal($n);
        $xP = $p ? $this->expTotal($p) : 0;
        $eN = max(0, self::i(self::p($statsN, 'edu')));
        $eP = $p ? max(0, self::i(self::p($statsP, 'edu'))) : 0;
        $dW = $wN - $wP;
        $dX = $xN - $xP;
        $dE = $eN - $eP;
        $capW = (int) GameData::limit('maxCoinGainPerSave', 60000);
        $capX = (int) GameData::limit('maxExpGainPerSave', 20000);
        if ($dW > $capW) $this->violate('VALUE_CAP', ['gain' => $dW, 'cap' => $capW]);
        if ($dX > $capX) $this->violate('EXP_CAP', ['gain' => $dX, 'cap' => $capX]);

        $span = min($dt, 3600.0);
        $allowW = $this->t('base_value', 1500) + $this->t('value_per_second', 20) * $span;
        $allowX = $this->t('base_exp', 300) + $this->t('exp_per_second', 4) * $span;
        $allowE = $this->t('base_edu', 30) + $this->t('edu_per_second', 0.2) * $span;
        $day = Clock::day($now);
        $budget = isset($meta['budget']) && is_array($meta['budget']) && (isset($meta['budget']['day']) ? $meta['budget']['day'] : '') === $day ? $meta['budget'] : ['day' => $day, 'value' => 0, 'exp' => 0, 'edu' => 0];
        $uW = max(0, $dW - $explain['value']);
        $uX = max(0, $dX - $explain['exp']);
        $uE = max(0, $dE - $explain['edu']);
        $remW = $this->t('daily_value', 12000) - (float) (isset($budget['value']) ? $budget['value'] : 0);
        $remX = $this->t('daily_exp', 4000) - (float) (isset($budget['exp']) ? $budget['exp'] : 0);
        $remE = $this->t('daily_edu', 200) - (float) (isset($budget['edu']) ? $budget['edu'] : 0);
        if ($uW > min($allowW, $remW)) $this->violate('UNEXPLAINED_VALUE', ['gain' => $dW, 'explained' => $explain['value'], 'allowed' => (int) max(0, min($allowW, $remW))]);
        if ($uX > min($allowX, $remX)) $this->violate('UNEXPLAINED_EXP', ['gain' => $dX, 'explained' => $explain['exp'], 'allowed' => (int) max(0, min($allowX, $remX))]);
        if ($uE > min($allowE, $remE)) $this->violate('UNEXPLAINED_EDU', ['gain' => $dE, 'explained' => $explain['edu'], 'allowed' => (int) max(0, min($allowE, $remE))]);
        $budget['value'] = (int) (isset($budget['value']) ? $budget['value'] : 0) + $uW;
        $budget['exp'] = (int) (isset($budget['exp']) ? $budget['exp'] : 0) + $uX;
        $budget['edu'] = (int) (isset($budget['edu']) ? $budget['edu'] : 0) + $uE;
        $meta['budget'] = $budget;

        // ---------------------------------------------------------- regressed rewards (an older copy won)
        // A stale second tab / device or an imported file can be accepted (losses always are) with ledger-paid
        // quests, achievements, quizzes or lessons no longer claimed. Their ledger entries move to "regressed",
        // and what this save gave back (its loss, at most their rewards) becomes credit for claiming them again.
        // Unclaiming while keeping the reward gives no credit: the re-claim stays unexplained (no farming).
        if ($p !== null) {
            $quizN = self::o(self::p($eduN, 'quiz'));
            $compN = self::o(self::p($eduN, 'completed'));
            $nQuests = self::o(self::p($n, 'quests'));
            $nAch = self::o(self::p($n, 'achievements'));
            $back = ['value' => 0, 'exp' => 0, 'edu' => 0];
            $took = function (string $kind, string $id, array $r) use (&$paid, &$reg, &$back, $now): void {
                unset($paid[$kind][$id]);
                $reg[$kind][$id] = $now;
                foreach ($r as $k => $x) $back[$k] += $x;
            };
            foreach (array_keys($paid['q']) as $qid) {
                $qid = (string) $qid;
                if (self::s(self::p(self::o(self::p($pQuests, $qid)), 'status')) === 'claimed' && self::s(self::p(self::o(self::p($nQuests, $qid)), 'status')) !== 'claimed') {
                    $def = isset($gd['quests'][$qid]) ? $gd['quests'][$qid] : null;
                    $took('q', $qid, GameData::rewardOf(is_array($def) && isset($def['reward']) && is_array($def['reward']) ? $def['reward'] : null));
                }
            }
            foreach (array_keys($paid['a']) as $aid) {
                $aid = (string) $aid;
                if (self::p($pAch, $aid) && !self::p($nAch, $aid)) {
                    $def = isset($gd['achievements'][$aid]) ? $gd['achievements'][$aid] : null;
                    $took('a', $aid, GameData::rewardOf(is_array($def) && isset($def['reward']) && is_array($def['reward']) ? $def['reward'] : null));
                }
            }
            foreach (array_keys($paid['z']) as $zid) {
                $zid = (string) $zid;
                if ($solved(self::p($quizP, $zid)) && !$solved(self::p($quizN, $zid))) {
                    $def = isset($gd['quizzes'][$zid]) ? $gd['quizzes'][$zid] : null;
                    $took('z', $zid, GameData::rewardOf(is_array($def) ? (isset($def['reward']) && is_array($def['reward']) ? $def['reward'] : $quizDefault) : $quizDefault));
                }
            }
            foreach (array_keys($paid['e']) as $eid) {
                $eid = (string) $eid;
                if (self::p($compP, $eid) && !self::p($compN, $eid)) $took('e', $eid, ['value' => 0, 'exp' => 0, 'edu' => (int) $this->t('edu_complete', 5)]);
            }
            foreach (['value' => $dW, 'exp' => $dX, 'edu' => $dE] as $k => $delta) $credit[$k] += min($back[$k], max(0, -$delta));
        }
        $anyReg = false;
        foreach ($reg as $k => $list) { if (count($list) > 2000) $reg[$k] = array_slice($list, -2000, null, true); if ($reg[$k]) $anyReg = true; }
        if (!$anyReg) $credit = ['value' => 0, 'exp' => 0, 'edu' => 0];
        // ledger size guard
        foreach ($paid as $k => $list) if (count($list) > 2000) $paid[$k] = array_slice($list, -2000, null, true);
        $meta['paid'] = $paid;
        $meta['regressed'] = $reg;
        $meta['credit'] = $credit;

        $ok = !$this->violations;
        return [
            'ok' => $ok,
            'violations' => $this->violations,
            'notes' => $this->notes,
            'meta' => $meta,
            'summary' => [
                'dt' => round($dt, 1), 'first' => $first, 'tier' => $this->tier, 'dValue' => $dW, 'dExp' => $dX, 'dEdu' => $dE,
                'explained' => $explain, 'unexplained' => ['value' => $uW, 'exp' => $uX, 'edu' => $uE],
                'harvests' => $harv, 'claims' => $claims, 'crafts' => $crafts, 'quests' => $newQuests,
                'rt' => ['harvests' => $rt['harvests']] + $rt['explain'],
            ],
        ];
    }

    // ------------------------------------------------------------------ real-time beds / 곳간 (CONTRACT §15.1 / §15.2)
    /** a client-sent id for a violation detail / the audit log: plain ids only (free text never reaches the log) */
    private static function safeId(string $id): string { return preg_match(self::ID_RE, $id) ? mb_substr($id, 0, 24) : '?'; }

    /** a finite JSON number in $min..$max */
    private static function numIn($v, float $min, float $max): bool
    {
        return (is_int($v) || is_float($v)) && is_finite((float) $v) && $v >= $min && $v <= $max;
    }

    /**
     * Shape of data.rtfarm (beds RB1–RB4 → {cropId, pid, plantedAt, readyAt, dur, tier, care, lastCareAt}, last ≤ 8
     * harvests {pid, bedId, cropId, amount, stars, at}, reports — local mode only), data.storage ({items: {id: qty}, cap})
     * and stats.rtHarvests. Violations, not a 400: the client restores the stored copy (workflow interface 2).
     * Missing blocks are fine (an older client). The client's storage cap is replaced by the server's (stored like the
     * account role). @return bool true when the rt / storage shape is clean (the farm hook may trust it)
     */
    private function rtShape(object $n): bool
    {
        $before = count($this->violations);
        $beds = GameData::rtBeds();
        $rf = self::p($n, 'rtfarm');
        if ($rf !== null && $beds) {
            if (!self::o($rf)) {
                $this->violate('RT_BAD_SHAPE', ['field' => 'rtfarm']);
            } else {
                $b = self::p($rf, 'beds');
                if ($b !== null && !self::o($b) && $b !== []) {
                    $this->violate('RT_BAD_SHAPE', ['field' => 'beds']);
                } else {
                    $pids = [];
                    foreach (self::kv($b) as $bedId => $bed) {
                        if (!in_array($bedId, $beds, true)) { $this->violate('RT_BAD_BED', ['bed' => self::safeId($bedId)]); continue; }
                        $bed = self::o($bed);
                        if (!$bed || count(self::kv($bed)) > 24) { $this->violate('RT_BAD_SHAPE', ['bed' => $bedId, 'field' => 'bed']); continue; }
                        $crop = self::p($bed, 'cropId');
                        if (!is_string($crop)) $this->violate('RT_BAD_SHAPE', ['bed' => $bedId, 'field' => 'cropId']);
                        elseif (GameData::rtCrop($crop) === null) $this->violate('RT_BAD_CROP', ['bed' => $bedId, 'crop' => self::safeId($crop)]);
                        $pid = self::p($bed, 'pid');
                        if (!is_string($pid) || !preg_match('/^[0-9a-f]{16}$/', $pid)) $this->violate('RT_BAD_SHAPE', ['bed' => $bedId, 'field' => 'pid']);
                        elseif (isset($pids[$pid])) $this->violate('RT_PID_REUSE', ['bed' => $bedId, 'other' => $pids[$pid]]);
                        else $pids[$pid] = $bedId;
                        foreach (['plantedAt', 'readyAt', 'dur', 'lastCareAt'] as $k) {
                            $x = self::p($bed, $k);
                            if ($x !== null && !self::numIn($x, 0, 1e15)) $this->violate('RT_BAD_SHAPE', ['bed' => $bedId, 'field' => $k]);
                        }
                        $t = self::p($bed, 'tier');
                        if ($t !== null && (!is_int($t) || $t < 1 || $t > 4)) $this->violate('RT_BAD_SHAPE', ['bed' => $bedId, 'field' => 'tier']);
                        $care = self::p($bed, 'care');
                        if ($care !== null && !self::numIn($care, 0, 100)) $this->violate('RT_BAD_SHAPE', ['bed' => $bedId, 'field' => 'care']);
                    }
                }
                $last = self::p($rf, 'last');
                if ($last !== null && !is_array($last)) {
                    $this->violate('RT_BAD_SHAPE', ['field' => 'last']);
                } elseif (is_array($last)) {
                    if (count($last) > 8) $this->violate('RT_BAD_SHAPE', ['field' => 'last', 'count' => count($last)]);
                    foreach (array_slice($last, 0, 8) as $i => $e) {
                        $e = self::o($e);
                        $why = '';
                        if (!$e) $why = 'entry';
                        elseif (!is_string(self::p($e, 'pid')) || !preg_match('/^[0-9a-f]{16}$/', (string) self::p($e, 'pid'))) $why = 'pid';
                        elseif (!in_array(self::p($e, 'bedId'), $beds, true)) $why = 'bedId';
                        elseif (!is_string(self::p($e, 'cropId')) || GameData::rtCrop((string) self::p($e, 'cropId')) === null) $why = 'cropId';
                        elseif (!is_int(self::p($e, 'amount')) || self::p($e, 'amount') < 0 || self::p($e, 'amount') > 99) $why = 'amount';
                        elseif (self::p($e, 'stars') !== null && (!is_int(self::p($e, 'stars')) || self::p($e, 'stars') < 0 || self::p($e, 'stars') > 3)) $why = 'stars';
                        elseif (self::p($e, 'at') !== null && !self::numIn(self::p($e, 'at'), 0, 1e15)) $why = 'at';
                        if ($why !== '') $this->violate('RT_BAD_SHAPE', ['field' => 'last', 'index' => (int) $i, 'why' => $why]);
                    }
                }
                $rep = self::p($rf, 'reports');
                if ($rep !== null && (!is_array($rep) || count($rep) > 200)) $this->violate('RT_BAD_SHAPE', ['field' => 'reports']);
            }
        }
        $rh = self::p(self::o(self::p($n, 'stats')), 'rtHarvests');
        if ($rh !== null && !is_int($rh)) $this->violate('RT_BAD_SHAPE', ['field' => 'rtHarvests']);

        $st = self::p($n, 'storage');
        $ids = GameData::storage()['itemIds'];
        if ($st !== null && $ids) {
            $cap = GameData::storageCap();
            if (!self::o($st)) {
                $this->violate('STORAGE_BAD_ITEM', ['field' => 'storage']);
            } else {
                $items = self::p($st, 'items');
                if ($items !== null && !self::o($items) && $items !== []) {
                    $this->violate('STORAGE_BAD_ITEM', ['field' => 'items']);
                } else {
                    $kv = self::kv($items);
                    if (count($kv) > 100) $this->violate('STORAGE_BAD_ITEM', ['field' => 'items', 'count' => count($kv)]);
                    $total = 0;
                    foreach (array_slice($kv, 0, 100, true) as $id => $q) {
                        $id = (string) $id;
                        if (!preg_match(self::ID_RE, $id) || !GameData::storable($id)) $this->violate('STORAGE_BAD_ITEM', ['item' => self::safeId($id)]);
                        if (!is_int($q) || $q < 0 || $q > 9999) $this->violate('STORAGE_BAD_QTY', ['item' => self::safeId($id)]);
                        else $total += $q;
                    }
                    if ($total > $cap) $this->violate('STORAGE_OVER_CAP', ['total' => $total, 'cap' => $cap]);
                }
                // the capacity is the server's (game data), never the client's: stored as the server value, not refused
                if (self::p($st, 'cap') !== $cap) { $st->cap = $cap; $this->notes[] = 'storage cap'; }
            }
        }
        return count($this->violations) === $before;
    }

    /**
     * Ask the real-time farm judge (Tfm\Farm::plan through player/save.php) about this save: its violations join this
     * validation, its validated harvests explain their reward. A malformed answer explains nothing.
     * @return array{explain: array{value:int, exp:int}, harvests: int}
     */
    private function rtJudge(callable $hook, object $n, ?object $p): array
    {
        $r = $hook($n, $p);
        $r = is_array($r) ? $r : [];
        foreach ((isset($r['violations']) && is_array($r['violations']) ? $r['violations'] : []) as $v) {
            if (is_array($v) && isset($v['code']) && is_string($v['code']) && preg_match('/^[A-Z_]{2,40}$/', $v['code'])) $this->violate($v['code'], array_diff_key($v, ['code' => 1]));
        }
        $ex = isset($r['explain']) && is_array($r['explain']) ? $r['explain'] : [];
        return [
            'explain' => ['value' => max(0, (int) (isset($ex['value']) ? $ex['value'] : 0)), 'exp' => max(0, (int) (isset($ex['exp']) ? $ex['exp'] : 0))],
            'harvests' => max(0, (int) (isset($r['harvests']) ? $r['harvests'] : 0)),
        ];
    }

    // ------------------------------------------------------------------ shape & ranges
    private function shape(object $n): void
    {
        $ver = self::p($n, 'version');
        if (!is_int($ver) || $ver < 1 || $ver > 1000) self::bad('version');
        foreach (['profile', 'stats'] as $k) if (!self::o(self::p($n, $k))) self::bad($k);
        foreach (['inventory', 'quests', 'jars', 'achievements', 'education', 'farm', 'flags', 'collection', 'visited'] as $k) {
            $v = self::p($n, $k);
            if ($v !== null && !self::o($v) && $v !== []) self::bad($k);
        }
        foreach (['companion', 'engagement', 'sub'] as $k) {
            $v = self::p($n, $k);
            if ($v !== null && !self::o($v)) self::bad($k);
        }
        if (mb_strlen(self::s(self::p(self::o(self::p($n, 'companion')), 'name'))) > 16) self::bad('companion name');
        $decor = self::p(self::o(self::p($n, 'engagement')), 'decor');
        if ($decor !== null && (!is_array($decor) || count($decor) > 50)) self::bad('engagement decor');
        // [exhibits] 집 구경 (CONTRACT §16.4 / §16.6): data.places = {visits: {placeId: n}, seen: {exhibitId: 1}, motions:
        // {motionId: 1}} — a missing block is fine (an older client); a wrong container is malformed (400), an oversized
        // map, a key that is not a plain id or a value that is not a small count is a violation (the client restores)
        $places = self::p($n, 'places');
        $placeSizes = ['visits' => 0, 'seen' => 0, 'motions' => 0];
        if ($places !== null) {
            if (!self::o($places)) self::bad('places');
            foreach (['visits' => 64, 'seen' => 400, 'motions' => 64] as $k => $cap) {
                $map = self::p($places, $k);
                if ($map === null) continue;
                if (!self::o($map) && $map !== []) self::bad('places ' . $k);
                $rows = self::kv($map);
                if (count($rows) > $cap) { $this->violate('PLACES_BAD_SHAPE', ['field' => $k, 'count' => count($rows)]); continue; }
                $placeSizes[$k] = count($rows);
                foreach ($rows as $id => $val) {
                    $okVal = (is_int($val) || is_float($val)) && is_finite((float) $val) && $val >= 0 && $val <= 1000000 && floor((float) $val) == $val;
                    if (!preg_match(self::ID_RE, (string) $id) || !($okVal || $val === true)) { $this->violate('PLACES_BAD_SHAPE', ['field' => $k]); break; }
                }
            }
        }
        // [exhibits] the four 집 구경 counters are the sizes of those maps (the achievements read them): a counter that runs
        // ahead of its map would unlock them without the stamps (a room's 도감 needs at least one stamp)
        $placeStats = self::o(self::p($n, 'stats'));
        foreach (['exhibitsSeen' => 'seen', 'exhibitRooms' => 'seen', 'motionsSeen' => 'motions', 'placesSeen' => 'visits'] as $stat => $k) {
            if (self::n(self::p($placeStats, $stat)) > $placeSizes[$k]) { $this->violate('PLACES_BAD_SHAPE', ['field' => $stat]); break; }
        }
        // [myroom] 내 방 (CONTRACT §17.4): a save that began on a device without a server may carry a decorated room. The
        // server keeps rooms in user_rooms and never uses this block; it only has to be harmless — catalogue-shaped ids
        // and small numbers, at most 200 things, style values that are plain words. A wrong shape is malformed (400).
        $myroom = self::p($n, 'myroom');
        if ($myroom !== null && class_exists('Tfm\\Room')) {
            $roomWhy = Room::checkEmbedded($myroom);
            if ($roomWhy !== null) self::bad('myroom: ' . $roomWhy);
        }
        $this->fishShape($n); // [fishing] CONTRACT §18.3
        $this->cookShape($n); // [cooking] CONTRACT §18.4
        foreach (['journal', 'photos', 'activity'] as $k) {
            $v = self::p($n, $k);
            if ($v !== null && !is_array($v)) self::bad($k);
            if (is_array($v) && count($v) > 2000) self::bad("$k length");
        }
        $stats = self::o(self::p($n, 'stats'));
        // absolute ceilings: 100,000 km walked, 10 years of play, 10 million of any counter
        $ceil = ['distance' => 1e8, 'playTime' => 3.2e8];
        if (count(self::kv($stats)) > 200) self::bad('stats size');
        foreach (self::kv($stats) as $k => $v) {
            // review finding (log injection, §15.7 #5): a stat name is a plain id like every other key of the save — free
            // text (control characters, spaces, markup) would be echoed into a STAT_RANGE violation and the audit log
            if (!preg_match(self::ID_RE, (string) $k)) self::bad('stat id');
            // every counter is a number: a string / object / bool would slip past the movement and range checks
            if (!is_int($v) && !is_float($v)) {
                if ($v === null) continue;
                self::bad('stat type');
            }
            if (!is_finite((float) $v) || $v < 0 || $v > (isset($ceil[$k]) ? $ceil[$k] : 1e7)) $this->violate('STAT_RANGE', ['stat' => mb_substr($k, 0, 24)]);
        }
        $level = self::i(self::p($stats, 'level'));
        $lc = (array) Config::get('save.level_exp', []);
        $maxLevel = (int) (isset($lc['max']) ? $lc['max'] : 50);
        if ($level < 1 || $level > $maxLevel) $this->violate('LEVEL_RANGE', ['level' => $level]);
        $exp = self::i(self::p($stats, 'exp'));
        $need = (int) round(((float) (isset($lc['base']) ? $lc['base'] : 120)) * (max(1, min($maxLevel, $level)) ** (float) (isset($lc['pow']) ? $lc['pow'] : 1.35)));
        if ($exp > $need + 1) $this->violate('EXP_RANGE', ['exp' => $exp, 'need' => $need]);
        $inv = self::kv(self::p($n, 'inventory'));
        if (count($inv) > 300) self::bad('inventory size');
        foreach ($inv as $id => $q) {
            if (!preg_match(self::ID_RE, $id)) self::bad('item id');
            if (!is_int($q) && !is_float($q)) self::bad('item qty');
            if ($q < 0 || $q > 999 || floor((float) $q) != $q) $this->violate('ITEM_QTY', ['item' => $id, 'qty' => $q]);
        }
    }

    private function looksLikeReset(object $n, object $p): bool
    {
        $cn = self::n(self::p($n, 'createdAt'));
        $cp = self::n(self::p($p, 'createdAt'));
        if (!($cn > $cp + 1000)) return false;
        $st = self::o(self::p($n, 'stats'));
        return self::i(self::p($st, 'level')) <= 1 && $this->expTotal($n) <= 1000 && self::i(self::p($st, 'coin')) <= 5000;
    }

    // ------------------------------------------------------------------ movement / play time
    /**
     * The client counts walked metres (player:distance, teleports / fast travel excluded) and active play seconds.
     * Phase 6: the base run is 12 m/s (walk 6.4); move_max_speed (default 18 m/s = RUN × 1.5 for jumps, the easy-mode
     * rescue hop and frame jitter) × min(tier, 3) × the elapsed server time between accepted saves, plus a fixed slack.
     */
    private function movement(?object $sN, ?object $sP, float $dt): void
    {
        $slackT = $this->t('time_slack', 5);
        $dD = self::n(self::p($sN, 'distance')) - self::n(self::p($sP, 'distance'));
        $allowD = max(1.0, $this->t('move_max_speed', 18)) * $this->moveMul() * ($dt + $slackT) + max(0.0, $this->t('move_slack_m', 300));
        if ($dD > $allowD) $this->violate('DISTANCE_TOO_FAST', ['gain' => (int) round($dD), 'allowed' => (int) round($allowD), 'elapsed' => round($dt, 1), 'tier' => $this->tier]);
        $dT = self::n(self::p($sN, 'playTime')) - self::n(self::p($sP, 'playTime'));
        $allowT = $dt * 1.05 + $slackT + max(0.0, $this->t('playtime_slack', 120));
        if ($dT > $allowT) $this->violate('PLAYTIME_TOO_FAST', ['gain' => (int) round($dT), 'allowed' => (int) round($allowT)]);
    }

    // ------------------------------------------------------------------ farming
    /** @return array{harvests:int, values:int[], exps:int[]} — harvests the plots can account for, with per-harvest reward bounds */
    private function farming(object $n, ?object $p, bool $first, float $dt): array
    {
        $tolH = (float) GameData::limit('harvestSpeedTolerance', 0.5);
        $tolH = $tolH > 0 ? $tolH : 0.5;
        $gs = $this->t('growth_slack', 3);
        $slackT = $this->t('time_slack', 5);
        $minGrowth = GameData::maxima()['minGrowth'];
        $tierMul = (float) $this->tier; // crops grow tier× faster for a subscriber (CONTRACT §14.1 progression())
        // %/s at the fastest legal speed for a crop (null = fastest crop of all)
        $rate = function (?array $c) use ($tolH, $minGrowth, $tierMul): float {
            $gt = $c && (isset($c['growthTime']) ? $c['growthTime'] : 0) > 0 ? (float) $c['growthTime'] : (float) $minGrowth;
            return $tierMul * 100.0 / max(1.0, $gt * $tolH);
        };
        $plotsN = self::kv(self::p(self::o(self::p($n, 'farm')), 'plots'));
        $plotsP = $p ? self::kv(self::p(self::o(self::p($p, 'farm')), 'plots')) : [];
        if (count($plotsN) > 64) self::bad('plots');
        $total = 0;
        $values = [];
        $exps = [];
        foreach ($plotsN as $id => $s) {
            if (!preg_match(self::ID_RE, $id)) self::bad('plot id');
            $s = self::o($s);
            if (!$s) continue;
            $cropId = self::s(self::p($s, 'cropId'));
            $crop = $cropId !== '' ? GameData::crop($cropId) : null;
            if ($cropId !== '' && !$crop && GameData::loaded()) $this->violate('UNKNOWN_CROP', ['plot' => $id]);
            $g = self::n(self::p($s, 'growth'));
            foreach (['growth', 'water', 'health'] as $k) {
                $x = self::p($s, $k);
                if ($x !== null && (!is_int($x) && !is_float($x) || $x < 0 || $x > 100.0001)) $this->violate('PLOT_RANGE', ['plot' => $id, 'field' => $k]);
            }
            $ps = self::o(isset($plotsP[$id]) ? $plotsP[$id] : null);
            $hN = max(0, self::i(self::p($s, 'harvests')));
            $hP = $ps ? max(0, self::i(self::p($ps, 'harvests'))) : 0;
            $k = max(0, $hN - $hP);
            $total += $k;
            if ($k > 0) {
                // first harvest = the crop that stood here at the previous save (prefill on a first save: assume the
                // crop still/now on the plot); later ones in the same interval = the current crop (herb regrowth) or unknown
                $pc = $ps ? GameData::crop(self::s(self::p($ps, 'cropId'))) : null;
                $r1 = self::cropReward($first ? ($crop ? $crop : $pc) : $pc);
                $rn = self::cropReward($crop);
                $values[] = $r1[0]; $exps[] = $r1[1];
                for ($j = 1; $j < min($k, 200); $j++) { $values[] = $rn[0]; $exps[] = $rn[1]; }
            }
            if ($first) {
                // baseline = client prefill (not known to the server): the first harvest may be immediate
                $need = $k >= 1 ? ($k - 1) * (100 - self::REGROW) / $rate(null) + ($crop ? max(0, $g - self::REGROW - $gs) / $rate($crop) : 0) : 0;
            } else {
                $pCropId = $ps ? self::s(self::p($ps, 'cropId')) : '';
                $pCrop = $pCropId !== '' ? GameData::crop($pCropId) : null;
                $gP = $ps ? self::n(self::p($ps, 'growth')) : 0.0;
                $same = $ps && $cropId !== '' && $cropId === $pCropId && abs(self::n(self::p($s, 'plantedAt')) - self::n(self::p($ps, 'plantedAt'))) < 2000;
                if ($k === 0) {
                    if ($same) $need = max(0, $g - $gP - $gs) / $rate($crop);
                    elseif ($cropId !== '') $need = max(0, $g - $gs) / $rate($crop); // planted after the previous save
                    else $need = 0;
                } else {
                    $need = $pCrop ? max(0, 100 - $gP - $gs) / $rate($pCrop) : 100 / $rate(null);
                    $need += ($k - 1) * (100 - self::REGROW) / $rate(null);
                    if ($cropId !== '') $need += max(0, $g - self::REGROW - $gs) / $rate($crop);
                }
            }
            if ($need > $dt + $slackT) $this->violate('GROWTH_TOO_FAST', ['plot' => $id, 'need' => round($need, 1), 'elapsed' => round($dt, 1), 'tier' => $this->tier]);
        }
        return ['harvests' => $total, 'values' => $values, 'exps' => $exps];
    }

    // ------------------------------------------------------------------ fermentation
    /** @return array{slots:int, values:int[], exps:int[]} — claims the jars can account for, with per-claim reward bounds */
    private function fermentation(object $n, ?object $p, bool $first, float $dt): array
    {
        $tolF = $this->t('ferment_tolerance', 0.5);
        $speed = max(1.0, $this->t('ferment_max_speed', 1.2)) * $this->tier; // ferment_max_speed × tier (CONTRACT §14.1)
        $gs = $this->t('growth_slack', 3);
        $slackT = $this->t('time_slack', 5);
        $minF = GameData::maxima()['minFerment'];
        $rate = function (?array $r) use ($speed, $minF, $tolF): float {
            return 100.0 * $speed / max(1.0, (($r && (isset($r['baseDuration']) ? $r['baseDuration'] : 0) > 0) ? (float) $r['baseDuration'] : (float) $minF) * $tolF);
        };
        $fullMin = 100.0 / $rate(null);
        $jarsN = self::kv(self::p($n, 'jars'));
        $jarsP = $p ? self::kv(self::p($p, 'jars')) : [];
        if (count($jarsN) > 16) self::bad('jars');
        $slots = 0;
        $values = [];
        $exps = [];
        $maxR = self::recipeReward(null);
        foreach ($jarsN as $id => $s) {
            if (!preg_match(self::ID_RE, $id)) self::bad('jar id');
            $s = self::o($s);
            if (!$s) continue;
            $recId = self::s(self::p($s, 'recipeId'));
            $rec = $recId !== '' ? GameData::recipe($recId) : null;
            if ($recId !== '' && !$rec && GameData::loaded()) $this->violate('UNKNOWN_RECIPE', ['jar' => $id]);
            $status = self::s(self::p($s, 'status'));
            if ($status !== '' && !in_array($status, self::JAR_STATES, true)) $this->violate('JAR_STATE', ['jar' => $id]);
            $prog = self::p($s, 'progress');
            if ($prog !== null && (!is_int($prog) && !is_float($prog) || $prog < 0 || $prog > 100.0001)) $this->violate('JAR_RANGE', ['jar' => $id]);
            $prog = self::n($prog);
            $owned = self::p($s, 'owned') === true;
            if ($first) {
                $extra = (int) floor($dt / $fullMin);
                $slots += ($owned ? 1 : 0) + $extra;
                if ($owned) { $rr = self::recipeReward($rec); $values[] = $rr[0]; $exps[] = $rr[1]; }
                for ($j = 0; $j < min($extra, 50); $j++) { $values[] = $maxR[0]; $exps[] = $maxR[1]; }
                continue;
            }
            $ps = self::o(isset($jarsP[$id]) ? $jarsP[$id] : null);
            $pRecId = $ps ? self::s(self::p($ps, 'recipeId')) : '';
            $pRec = $pRecId !== '' ? GameData::recipe($pRecId) : null;
            $pStatus = $ps ? self::s(self::p($ps, 'status')) : 'EMPTY';
            $pProg = $ps ? self::n(self::p($ps, 'progress')) : 0.0;
            $same = $ps && $recId !== '' && $recId === $pRecId && abs(self::n(self::p($s, 'startedAt')) - self::n(self::p($ps, 'startedAt'))) < 2000;
            $pOpen = in_array($pStatus, self::JAR_ACTIVE, true) || $pStatus === 'COMPLETE';
            $nProg = $status === 'CLAIMED' || $status === 'COMPLETE' ? 100.0 : $prog;
            $need = 0.0;
            $claimsHere = 0;
            if ($same) {
                if ($status === 'CLAIMED' && $pStatus !== 'CLAIMED') { $claimsHere = 1; $need = max(0, 100 - $pProg - $gs) / $rate($rec); }
                elseif ($status !== 'CLAIMED') $need = max(0, $nProg - $pProg - $gs) / $rate($rec);
            } else {
                if ($pOpen && $pRec) { $claimsHere++; $need += max(0, 100 - $pProg - $gs) / $rate($pRec); } // previous batch must have finished & been claimed
                if ($recId !== '' && $status !== 'EMPTY') {
                    $need += max(0, $nProg - $gs) / $rate($rec);
                    if ($status === 'CLAIMED') $claimsHere++;
                }
            }
            if ($need > $dt + $slackT) $this->violate('FERMENT_TOO_FAST', ['jar' => $id, 'need' => round($need, 1), 'elapsed' => round($dt, 1), 'tier' => $this->tier]);
            if ($owned || ($ps && self::p($ps, 'owned') === true)) {
                $extra = (int) floor(max(0.0, $dt - $need) / $fullMin);
                $slots += $claimsHere + $extra;
                // the batch claimed first is the one that was in the jar at the previous save
                for ($j = 0; $j < $claimsHere; $j++) { $rr = self::recipeReward($j === 0 && $pOpen && $pRec ? $pRec : $rec); $values[] = $rr[0]; $exps[] = $rr[1]; }
                for ($j = 0; $j < min($extra, 50); $j++) { $values[] = $maxR[0]; $exps[] = $maxR[1]; }
            }
        }
        return ['slots' => $slots, 'values' => $values, 'exps' => $exps];
    }

    // [wardrobe] ------------------------------------------------------------ 옷장: clothes as items (CONTRACT §19.1)
    /** the exported wardrobe table (game-data.json `wardrobe`): items id → [slot key, value id, sell], slots, starter … */
    private static function wardrobeTable(): array
    {
        static $m = null;
        if ($m !== null) return $m;
        $a = GameData::all();
        $t = isset($a['wardrobe']) && is_array($a['wardrobe']) ? $a['wardrobe'] : [];
        $list = function ($k) use ($t): array { $out = []; foreach ((array) (isset($t[$k]) ? $t[$k] : []) as $v) if (is_string($v) && $v !== '') $out[$v] = true; return $out; };
        $items = [];
        foreach ((array) (isset($t['items']) ? $t['items'] : []) as $id => $row) {
            if (is_string($id) && preg_match('/^WEAR_[A-Z0-9_]{1,42}$/', $id) && is_array($row) && isset($row[0], $row[1]) && is_string($row[0]) && is_string($row[1])) $items[$id] = [$row[0], $row[1]];
        }
        $slots = [];
        foreach ((array) (isset($t['slots']) ? $t['slots'] : []) as $s) {
            if (is_array($s) && isset($s['key']) && is_string($s['key']) && preg_match('/^[A-Za-z]{1,24}$/', $s['key'])) $slots[$s['key']] = isset($s['empty']) && is_string($s['empty']) ? $s['empty'] : null;
        }
        $lim = isset($t['limits']) && is_array($t['limits']) ? $t['limits'] : [];
        return $m = [
            'items' => $items, 'slots' => $slots, 'starter' => $list('starter'), 'traits' => $list('traits'), 'homes' => $list('homes'),
            'expressions' => $list('expressions'), 'setKeys' => $list('setKeys'),
            'sets' => isset($lim['sets']) ? max(0, min(50, (int) $lim['sets'])) : 12, 'traitMax' => isset($lim['traits']) ? max(0, min(10, (int) $lim['traits'])) : 3,
            'setName' => isset($lim['setName']) ? max(1, min(40, (int) $lim['setName'])) : 12, 'own' => isset($lim['own']) ? max(1, min(5000, (int) $lim['own'])) : 2000,
        ];
    }
    /** the item id of a worn value, as 24-wardrobe.js names it: WEAR_<KEY>_<ID> (non-alphanumerics → _, upper case) */
    private static function wearId(string $key, string $id): string
    {
        $up = function (string $s): string { return strtoupper((string) preg_replace('/[^A-Za-z0-9]+/', '_', $s)); };
        return 'WEAR_' . $up($key) . '_' . $up($id);
    }
    /** the coin value of the pieces a save owns (starter pieces are worth nothing) */
    private function wardrobeWorth(object $s): int
    {
        $T = self::wardrobeTable();
        if (!$T['items']) return 0;
        $w = 0;
        foreach (array_slice(self::kv(self::p(self::o(self::p($s, 'wardrobe')), 'own')), 0, $T['own'], true) as $iid => $on) {
            $iid = (string) $iid;
            if (isset($T['items'][$iid]) && !isset($T['starter'][$iid]) && ($on === 1 || $on === true)) $w += GameData::itemValue($iid);
        }
        return $w;
    }
    /** the pieces of $own that $avatar wears (not the free kit) → their coin value */
    private function wornValue(?object $own, $avatar): int
    {
        $T = self::wardrobeTable();
        $av = self::o($avatar);
        if (!$own || !$av) return 0;
        $v = 0;
        foreach ($T['slots'] as $key => $empty) {
            $val = self::p($av, $key);
            if (!is_string($val) || $val === $empty) continue;
            $iid = self::wearId($key, $val);
            $on = self::p($own, $iid);
            if (isset($T['items'][$iid]) && !isset($T['starter'][$iid]) && ($on === 1 || $on === true)) $v += GameData::itemValue($iid);
        }
        return $v;
    }
    /**
     * The `wardrobe` block of a save: {v: 1, own: {WEAR_…: 1}, migrated?: true, sets: [{id, name, app}] (≤ 12),
     * sheet: {traits: [≤ 3 words of the list], home: id | null}, expr: id | null}. A missing block is fine (an older
     * client); a wrong container is malformed (400); an unknown piece, an outfit or a word out of the table, a name that
     * is not plain letters, or a look that wears a piece the save does not own (not the free kit, not an administrator)
     * is a violation (the client is handed the server's copy back). Explains the value of the pieces an existing profile
     * is given once by the migration (what its look already wore) and those a new profile's chosen look wears.
     */
    private function wardrobe(object $n, ?object $p, array $user, bool $first): int
    {
        $wd = self::p($n, 'wardrobe');
        if ($wd === null) return 0;
        if (!self::o($wd)) self::bad('wardrobe');
        $T = self::wardrobeTable();
        if (!$T['items']) return 0;
        $bad = function (string $f, array $more = []): void { $this->violate('WARDROBE_BAD_SHAPE', array_merge(['field' => $f], $more)); };
        if (self::p($wd, 'v') !== 1) { $bad('v'); return 0; }
        $own = self::p($wd, 'own');
        if ($own !== null && !self::o($own) && $own !== []) self::bad('wardrobe own');
        $ownO = self::o($own);
        $rows = self::kv($own);
        if (count($rows) > $T['own']) { $bad('own', ['count' => count($rows)]); return 0; }
        foreach ($rows as $iid => $on) {
            if (!isset($T['items'][(string) $iid]) || !($on === 1 || $on === true)) { $bad('own', ['item' => self::safeId((string) $iid)]); return 0; }
        }
        $mig = self::p($wd, 'migrated');
        if ($mig !== null && $mig !== true) { $bad('migrated'); return 0; }
        $sets = self::p($wd, 'sets');
        if ($sets !== null) {
            if (!is_array($sets) || count($sets) > $T['sets']) { $bad('sets'); return 0; }
            foreach ($sets as $s) {
                $so = self::o($s);
                $id = self::p($so, 'id');
                $name = self::p($so, 'name');
                $app = self::p($so, 'app');
                if (!$so || !is_string($id) || !preg_match('/^[A-Za-z0-9_]{1,24}$/', $id) || !is_string($name) || mb_strlen($name) > $T['setName']
                    || !preg_match('/^[\p{L}\p{N} ·\-]*$/u', $name) || (!self::o($app) && $app !== [])) { $bad('sets'); return 0; }
                $keys = self::kv($app);
                if (count($keys) > 60) { $bad('sets'); return 0; }
                foreach ($keys as $k => $v) if (!isset($T['setKeys'][(string) $k]) || !is_string($v) || !preg_match('/^[#A-Za-z0-9_]{1,32}$/', $v)) { $bad('sets'); return 0; }
            }
        }
        $sheet = self::p($wd, 'sheet');
        if ($sheet !== null) {
            if (!self::o($sheet)) self::bad('wardrobe sheet');
            $tr = self::p($sheet, 'traits');
            if ($tr !== null) {
                if (!is_array($tr) || count($tr) > $T['traitMax'] || count(array_unique(array_map('strval', array_filter($tr, 'is_string')))) !== count($tr)) { $bad('traits'); return 0; }
                foreach ($tr as $x) if (!is_string($x) || !isset($T['traits'][$x])) { $bad('traits'); return 0; }
            }
            $home = self::p($sheet, 'home');
            if ($home !== null && (!is_string($home) || !isset($T['homes'][$home]))) { $bad('home'); return 0; }
        }
        $expr = self::p($wd, 'expr');
        if ($expr !== null && (!is_string($expr) || !isset($T['expressions'][$expr]))) { $bad('expr'); return 0; }
        // the look wears owned pieces only (an administrator owns every piece, CONTRACT §17.2)
        $avatar = self::o(self::p(self::o(self::p($n, 'profile')), 'avatar'));
        if ($avatar && $user['role'] !== 'admin') {
            foreach ($T['slots'] as $key => $empty) {
                $val = self::p($avatar, $key);
                if (!is_string($val) || $val === $empty) continue;
                $iid = self::wearId($key, $val);
                if (!isset($T['items'][$iid]) || isset($T['starter'][$iid])) continue; // a legacy id is Presence's to judge
                $on = $ownO ? self::p($ownO, $iid) : null;
                if (!($on === 1 || $on === true)) { $this->violate('WARDROBE_NOT_OWNED', ['item' => self::safeId($iid)]); return 0; }
            }
        }
        // what the pieces given without coins are worth: a new profile's chosen look, or an existing look at the migration
        if ($first) return $this->wornValue($ownO, $avatar);
        $wp = $p ? self::o(self::p($p, 'wardrobe')) : null;
        if ($mig === true && (!$wp || self::p($wp, 'migrated') !== true)) return $this->wornValue($ownO, self::p(self::o(self::p($p, 'profile')), 'avatar'));
        return 0;
    }

    // [entitle] ------------------------------------------------------------- the jar limit (CONTRACT §17.2)
    /**
     * limits.jars of the account (free 3, a paid plan or an administrator 12 — operator settings):
     *   JAR_LIMIT   the number of OWNED jars grew beyond the limit in this save. A save that merely still owns more than
     *               the limit — a plan that ended, a refund — is accepted: a plan change never takes a jar or its
     *               contents away.
     *   JAR_LOCKED  owned jars beyond the first `limit` in place order (J1, J2 … J12) are locked: what is inside stays
     *               and may go on ripening, but a NEW batch may not be started in one until the plan returns.
     * Nothing here reads a value the client could raise: the limit comes from Tfm\Entitle (the account's role and plan).
     */
    private function jarLimits(object $n, ?object $p): void
    {
        $limit = $this->jarLimit;
        if ($limit <= 0) return;
        $jarsN = self::kv(self::p($n, 'jars'));
        $owned = [];
        foreach ($jarsN as $id => $s) if (self::p(self::o($s), 'owned') === true) $owned[] = (string) $id;
        if (count($owned) <= $limit) return;
        $jarsP = $p ? self::kv(self::p($p, 'jars')) : [];
        $ownedP = 0;
        foreach ($jarsP as $s) if (self::p(self::o($s), 'owned') === true) $ownedP++;
        if (count($owned) > max($ownedP, $limit)) {
            $this->violate('JAR_LIMIT', ['owned' => count($owned), 'limit' => $limit]);
            return;
        }
        // place order: J1 … J12 by their number, any other id after them by name
        $rank = function (string $id): int { return preg_match('/^J(\d{1,3})$/', $id, $m) ? (int) $m[1] : 100000; };
        usort($owned, function (string $a, string $b) use ($rank): int { $d = $rank($a) - $rank($b); return $d !== 0 ? $d : strcmp($a, $b); });
        foreach (array_slice($owned, $limit) as $id) {
            $s = self::o($jarsN[$id]);
            $ps = self::o(isset($jarsP[$id]) ? $jarsP[$id] : null);
            $recId = self::s(self::p($s, 'recipeId'));
            $status = self::s(self::p($s, 'status'));
            if ($recId === '' || $status === '' || $status === 'EMPTY') continue; // nothing (new) inside
            $same = $ps && $recId === self::s(self::p($ps, 'recipeId')) && abs(self::n(self::p($s, 'startedAt')) - self::n(self::p($ps, 'startedAt'))) < 2000;
            if (!$same) { $this->violate('JAR_LOCKED', ['jar' => mb_substr($id, 0, 40), 'limit' => $limit]); return; }
        }
    }

    // [content] ------------------------------------------------------------ the 'plan' mark of a jar (CONTRACT §17.8)
    /**
     * JAR_PLAN_MARK: a jar the previous save already owned without the mark (bought with coins, or J1) cannot gain the
     * mark `via: 'plan'` later — the client only marks jars a plan opens from nothing. Without this a coin-bought jar
     * could be re-labelled so that its 1,500-coin value would leave the net worth unnoticed.
     */
    private function planMarks(object $n, ?object $p): void
    {
        if (!$p) return;
        $jarsP = self::kv(self::p($p, 'jars'));
        foreach (self::kv(self::p($n, 'jars')) as $id => $s) {
            $s = self::o($s);
            if (!$s || self::p($s, 'via') !== 'plan') continue;
            $ps = self::o(isset($jarsP[$id]) ? $jarsP[$id] : null);
            if ($ps && self::p($ps, 'owned') === true && self::p($ps, 'via') !== 'plan') { $this->violate('JAR_PLAN_MARK', ['jar' => mb_substr((string) $id, 0, 40)]); return; }
        }
    }

    // ------------------------------------------------------------------ [cooking] 부엌 (CONTRACT §18.4)
    /**
     * The `cooking` block of a save: {v, book: {DISH_…: {n, best, first, last}}, pantry: {day, got: {ITEM_…: n}},
     * catches: {FISH_…: [ms…]}, table: [{d, s, t}], shared}. A missing block is fine (an older client); a wrong container
     * is malformed (400). A violation (the client restores the server's copy): an unknown dish or staple, a count, a star
     * or a list out of range, the dish counters (dishKinds, dishStars3) running ahead of the book. Cooking pays nothing by
     * itself (quests and achievements do, through their ledgers); the staples of the 찬장 have no value. Nothing is judged
     * while the export has no cooking table.
     */
    private function cookShape(object $n): void
    {
        $c = self::p($n, 'cooking');
        if ($c === null) return;
        if (!self::o($c)) self::bad('cooking');
        $tab = GameData::all();
        $t = isset($tab['cooking']) && is_array($tab['cooking']) ? $tab['cooking'] : [];
        if (empty($t['dishes']) || !is_array($t['dishes'])) return;
        $dishes = array_flip(array_map('strval', $t['dishes']));
        $pantry = array_flip(isset($t['pantry']) && is_array($t['pantry']) ? array_map('strval', $t['pantry']) : []);
        $lim = isset($t['limits']) && is_array($t['limits']) ? $t['limits'] : [];
        $bookMax = isset($lim['bookMax']) ? (int) $lim['bookMax'] : 64;
        $tableMax = isset($lim['tableMax']) ? (int) $lim['tableMax'] : 6;
        $perDay = isset($lim['pantryPerDay']) ? (int) $lim['pantryPerDay'] : 3;
        $int = function ($v, float $lo, float $hi): bool { return (is_int($v) || is_float($v)) && is_finite((float) $v) && floor((float) $v) == $v && $v >= $lo && $v <= $hi; };
        foreach (['book', 'pantry', 'catches'] as $k) { $v = self::p($c, $k); if ($v !== null && !self::o($v) && $v !== []) self::bad('cooking ' . $k); }
        $table = self::p($c, 'table');
        if ($table !== null && !is_array($table)) self::bad('cooking table');
        $book = self::kv(self::p($c, 'book'));
        if (count($book) > $bookMax) { $this->violate('COOK_BAD_SHAPE', ['field' => 'book']); return; }
        foreach ($book as $id => $b) {
            $b = self::o($b);
            if (!isset($dishes[(string) $id]) || $b === null || !$int(self::p($b, 'n'), 0, 1000000) || !$int(self::p($b, 'best'), 0, 3)) { $this->violate('COOK_BAD_SHAPE', ['field' => 'book', 'id' => self::safeId((string) $id)]); return; }
        }
        if (is_array($table)) {
            if (count($table) > $tableMax) { $this->violate('COOK_BAD_SHAPE', ['field' => 'table']); return; }
            foreach ($table as $e) {
                $e = self::o($e);
                if ($e === null || !isset($dishes[self::s(self::p($e, 'd'))]) || !$int(self::p($e, 's'), 1, 3)) { $this->violate('COOK_BAD_SHAPE', ['field' => 'table']); return; }
            }
        }
        $pan = self::o(self::p($c, 'pantry'));
        if ($pan !== null) {
            $day = self::p($pan, 'day');
            if ($day !== null && (!is_string($day) || strlen($day) > 10)) { $this->violate('COOK_BAD_SHAPE', ['field' => 'pantry']); return; }
            foreach (self::kv(self::p($pan, 'got')) as $id => $q) {
                if (!isset($pantry[(string) $id]) || !$int($q, 0, $perDay)) { $this->violate('COOK_BAD_SHAPE', ['field' => 'pantry']); return; }
            }
        }
        $catches = self::kv(self::p($c, 'catches'));
        if (count($catches) > 30) { $this->violate('COOK_BAD_SHAPE', ['field' => 'catches']); return; }
        foreach ($catches as $id => $arr) {
            if (!preg_match('/^FISH_[A-Z0-9_]{1,30}$/', (string) $id) || !is_array($arr) || count($arr) > 10) { $this->violate('COOK_BAD_SHAPE', ['field' => 'catches']); return; }
            foreach ($arr as $ts) if (!$int($ts, 0, 1e14)) { $this->violate('COOK_BAD_SHAPE', ['field' => 'catches']); return; }
        }
        $sh = self::p($c, 'shared');
        if ($sh !== null && !$int($sh, 0, 100000)) { $this->violate('COOK_BAD_SHAPE', ['field' => 'shared']); return; }
        // the counters the achievements read cannot run ahead of the book
        $stats = self::o(self::p($n, 'stats'));
        if (self::n(self::p($stats, 'dishKinds')) > count($book)) { $this->violate('COOK_BAD_SHAPE', ['field' => 'dishKinds']); return; }
        $cooked = 0;
        foreach ($book as $b) $cooked += (int) self::p(self::o($b), 'n');
        if (self::n(self::p($stats, 'dishesCooked')) > $cooked + 1) $this->violate('COOK_BAD_SHAPE', ['field' => 'dishesCooked']);
        if (self::n(self::p($stats, 'dishStars3')) > $cooked) $this->violate('COOK_BAD_SHAPE', ['field' => 'dishStars3']);
    }

    // ------------------------------------------------------------------ [healing] 힐링관 (CONTRACT §19.6)
    /**
     * The `healing` block of a save: {v, visit: null | {id, at, band, stow, changed, ask, base, rooms: {R1: {at, end, done,
     * small?, stop?, step?}}, r1?, r9?, r10?, wear?, rep, out}, visits, stamps, last?}. A missing block is fine; a wrong
     * container is malformed (400). A violation (the client restores the server's copy): an unknown room, a number or a
     * list out of range, a time in the future, or a course that is NEW in this save (not in the server's copy with the same
     * start) and runs faster than the operator's healing.time_scale allows — courses already in the server's copy are not
     * judged again, so lowering the scale never turns an old visit into a violation. The hall pays nothing; the letter and
     * the portrait are never part of a save. Nothing is judged while the export has no healing table.
     */
    private function healing(object $n, ?object $p, float $dt, int $now): void
    {
        $h = self::p($n, 'healing');
        if ($h === null) return;
        if (!self::o($h)) self::bad('healing');
        $tab = GameData::all();
        $t = isset($tab['healing']) && is_array($tab['healing']) ? $tab['healing'] : [];
        if (empty($t['rooms']) || !is_array($t['rooms'])) return;
        $lim = isset($t['limits']) && is_array($t['limits']) ? $t['limits'] : [];
        $L = function (string $k, int $d) use ($lim): int { return isset($lim[$k]) ? (int) $lim[$k] : $d; };
        $int = function ($v, float $lo, float $hi): bool { return (is_int($v) || is_float($v)) && is_finite((float) $v) && floor((float) $v) == $v && $v >= $lo && $v <= $hi; };
        $num = function ($v, float $lo, float $hi): bool { return (is_int($v) || is_float($v)) && is_finite((float) $v) && $v >= $lo && $v <= $hi; };
        $bad = function (string $f, array $more = []): void { $this->violate('HEAL_BAD_SHAPE', array_merge(['field' => $f], $more)); };
        $nowMs = (float) $now;
        $late = $nowMs + $L('skewMs', 300000);
        $tOk = function ($v) use ($int, $late): bool { return $int($v, 0, 1e14) && $v <= $late; };
        $scale = 1;
        if (class_exists('Tfm\\Settings')) { try { $scale = (int) Settings::get('healing.time_scale'); } catch (\Throwable $e) { $scale = 1; } }
        $scale = max(1, min(isset($t['scaleMax']) ? (int) $t['scaleMax'] : 120, $scale));
        foreach (['visits' => $L('visits', 100000), 'stamps' => $L('visits', 100000) * 10] as $k => $hi) {
            $v = self::p($h, $k);
            if ($v !== null && !$int($v, 0, $hi)) { $bad($k); return; }
        }
        $last = self::p($h, 'last');
        if ($last !== null && !self::o($last)) self::bad('healing last');
        $v = self::p($h, 'visit');
        if ($v === null) return;
        if (!self::o($v)) self::bad('healing visit');
        foreach (['at', 'band', 'changed', 'rep', 'out'] as $k) {
            $x = self::p($v, $k);
            if ($x !== null && !$tOk($x)) { $bad($k); return; }
        }
        $id = self::p($v, 'id');
        if ($id !== null && (!is_string($id) || !preg_match('/^H[0-9a-z]{1,14}\z/', $id))) { $bad('id'); return; }
        $stow = self::p($v, 'stow');
        if ($stow !== null && !$int($stow, 0, isset($t['bundle']) ? (int) $t['bundle'] : 3)) { $bad('stow'); return; }
        $ask = self::p($v, 'ask');
        if ($ask !== null) {
            if (!self::o($ask) && $ask !== []) self::bad('healing ask');
            foreach (self::kv($ask) as $k => $x) if (!in_array((string) $k, ['mood', 'ache', 'sleep', 'wish'], true) || !$int($x, 0, 3)) { $bad('ask'); return; }
        }
        $numIds = isset($t['nums']) && is_array($t['nums']) ? array_map('strval', $t['nums']) : [];
        $base = self::p($v, 'base');
        if ($base !== null) {
            if (!self::o($base) && $base !== []) self::bad('healing base');
            foreach (self::kv($base) as $k => $x) if (!in_array((string) $k, $numIds, true) || !$num($x, 0, 100)) { $bad('base'); return; }
        }
        $rooms = self::p($v, 'rooms');
        if ($rooms !== null && !self::o($rooms) && $rooms !== []) self::bad('healing rooms');
        $prevV = $p ? self::o(self::p(self::o(self::p($p, 'healing')), 'visit')) : null;
        $prevRooms = $prevV ? self::o(self::p($prevV, 'rooms')) : null;
        foreach (self::kv($rooms) as $rid => $c) {
            $rid = (string) $rid;
            $c = self::o($c);
            if (!isset($t['rooms'][$rid]) || $c === null) { $bad('rooms', ['room' => self::safeId($rid)]); return; }
            $at = self::p($c, 'at'); $end = self::p($c, 'end'); $done = self::p($c, 'done');
            if (!$tOk($at) || !$int($end, 0, 1e14) || $end < $at || ($done !== null && $done !== 0 && !$tOk($done))) { $bad('rooms', ['room' => self::safeId($rid)]); return; }
            foreach (['small' => $L('small', 60), 'step' => 20] as $k => $hi) { $x = self::p($c, $k); if ($x !== null && !$int($x, 0, $hi)) { $bad('rooms', ['room' => self::safeId($rid)]); return; } }
            $stop = self::p($c, 'stop');
            if ($stop !== null && !$num($stop, 0, 1)) { $bad('rooms', ['room' => self::safeId($rid)]); return; }
            // a course that is new in this save (or started again) must not run faster than the operator's scale allows
            $pc = $prevRooms ? self::o(self::p($prevRooms, $rid)) : null;
            $same = $pc !== null && self::p($pc, 'at') === $at && self::p($pc, 'end') === $end;
            $need = (float) $t['rooms'][$rid] * 60000.0 / $scale;
            if (!$same && ($end - $at) < $need * 0.98 - 1000) { $this->violate('HEAL_TOO_FAST', ['room' => self::safeId($rid), 'ms' => (int) ($end - $at), 'need' => (int) $need]); return; }
            if ($done && !$same && $done < $end - 1000) { $this->violate('HEAL_TOO_FAST', ['room' => self::safeId($rid), 'done' => 'early']); return; }
        }
        $r1 = self::p($v, 'r1');
        if ($r1 !== null) {
            if (!self::o($r1)) self::bad('healing r1');
            foreach (self::kv($r1) as $k => $x) {
                if ((string) $k === 'pat') { if (!is_string($x) || !preg_match('/^[ATGC]{0,12}\z/', $x)) { $bad('r1'); return; } continue; }
                if (!in_array((string) $k, ['balance', 'breath', 'posture', 'microbes', 'salt'], true) || !$num($x, 0, 100)) { $bad('r1'); return; }
            }
        }
        $r9 = self::p($v, 'r9');
        if ($r9 !== null) {
            if (!self::o($r9)) self::bad('healing r9');
            $sum = 0;
            foreach (self::kv($r9) as $k => $x) {
                if (!in_array((string) $k, ['plates', 'drums', 'cans', 'bottles'], true) || !$int($x, 0, $L('r9', 100000))) { $bad('r9'); return; }
                $sum += (int) $x;
            }
            // about three hits a second at most since the server's copy
            $prevSum = 0;
            $pr9 = $prevV ? self::o(self::p($prevV, 'r9')) : null;
            if ($pr9 && self::p($prevV, 'id') === $id) foreach (self::kv($pr9) as $x) $prevSum += self::i($x);
            if ($sum - $prevSum > 40 + 3 * min($dt, 86400.0)) { $this->violate('HEAL_TOO_FAST', ['field' => 'r9', 'hits' => $sum - $prevSum]); return; }
        }
        $r10 = self::p($v, 'r10');
        if ($r10 !== null && $r10 !== 'full' && $r10 !== 'gentle') { $bad('r10'); return; }
        $wear = self::p($v, 'wear');
        if ($wear !== null) {
            if (!self::o($wear) && $wear !== []) self::bad('healing wear');
            $w = self::kv($wear);
            if (count($w) > $L('wearKeys', 48)) { $bad('wear'); return; }
            foreach ($w as $k => $x) {
                if (!preg_match('/^[a-zA-Z]{1,20}\z/', (string) $k)) { $bad('wear'); return; }
                if (is_string($x) ? (strlen($x) > 16 || !preg_match('/^[#a-zA-Z0-9_-]*\z/', $x)) : !$num($x, 0, 10)) { $bad('wear'); return; }
            }
        }
    }

    // ------------------------------------------------------------------ [fishing] 낚시 (CONTRACT §18.3)
    /** FISH_<ID> → <ID>, or null for any other item id */
    private static function fishOfItem(string $itemId): ?string
    {
        return strncmp($itemId, 'FISH_', 5) === 0 ? substr($itemId, 5) : null;
    }

    /**
     * The `fishing` block of a save: {v, book: {<species>: {n, kept, rel, max (mm), first}}, seen: {<neighbour>: 1},
     * day: {key, kept}, traps: {<spot>: {at, bait}}, tut}. A missing block is fine (an older client); a wrong container
     * is malformed (400). A violation (the client restores the server's copy): an unknown species or spot, a count or a
     * length out of range, a protected fish marked as taken along or lying in the bag / the 곳간 (protected animals are
     * met, recorded and released — §18.0), a counter that runs ahead of the book, more fish in the bag than two days of
     * the largest daily limit. Nothing is judged while the export has no fish table.
     */
    private function fishShape(object $n): void
    {
        $T = GameData::fish();
        $species = $T['species'];
        if (!$species) return;
        $capDay = (int) $T['keepPerDayMax'];
        // the bag and the 곳간: only fish that may be taken along, and not a hoard
        $held = 0;
        foreach ([self::p($n, 'inventory'), self::p(self::o(self::p($n, 'storage')), 'items')] as $box) {
            foreach (self::kv($box) as $iid => $q) {
                $fid = self::fishOfItem((string) $iid);
                if ($fid === null) continue;
                if (!isset($species[$fid]) || $species[$fid]['p']) { $this->violate('FISH_PROTECTED', ['item' => self::safeId((string) $iid)]); return; }
                $held += max(0, min(999, self::i($q)));
            }
        }
        if ($held > 2 * $capDay) $this->violate('FISH_KEEP_LIMIT', ['held' => $held, 'limit' => 2 * $capDay]);
        $f = self::p($n, 'fishing');
        if ($f === null) return;
        if (!self::o($f)) self::bad('fishing');
        $count = function ($v, int $max): bool { return (is_int($v) || is_float($v)) && is_finite((float) $v) && $v >= 0 && $v <= $max && floor((float) $v) == $v; };
        $maps = [];
        foreach (['book', 'seen', 'traps', 'day'] as $k) {
            $v = self::p($f, $k);
            if ($v !== null && !self::o($v) && $v !== []) self::bad('fishing ' . $k);
            $maps[$k] = self::kv($v);
        }
        if (count($maps['book']) > count($species)) { $this->violate('FISH_BAD_SHAPE', ['field' => 'book']); return; }
        $sumN = 0; $sumRel = 0; $guarded = 0;
        foreach ($maps['book'] as $id => $b) {
            $id = (string) $id;
            $b = self::o($b);
            if (!isset($species[$id]) || !$b) { $this->violate('FISH_BAD_SHAPE', ['field' => 'book', 'fish' => self::safeId($id)]); return; }
            $cn = self::p($b, 'n'); $ck = self::p($b, 'kept'); $cr = self::p($b, 'rel'); $cm = self::p($b, 'max');
            if (!$count($cn, 1000000) || $cn < 1 || !$count($ck === null ? 0 : $ck, 1000000) || !$count($cr === null ? 0 : $cr, 1000000) || !$count($cm === null ? 0 : $cm, (int) $species[$id]['max'])
                || self::i($ck) + self::i($cr) > self::i($cn)) { $this->violate('FISH_BAD_SHAPE', ['field' => 'book', 'fish' => self::safeId($id)]); return; }
            if ($species[$id]['p'] && self::i($ck) > 0) { $this->violate('FISH_PROTECTED', ['fish' => self::safeId($id)]); return; }
            $sumN += self::i($cn); $sumRel += self::i($cr);
            if ($species[$id]['p']) $guarded++;
        }
        foreach ($maps['seen'] as $id => $v) if (!in_array((string) $id, $T['neighbours'], true)) { $this->violate('FISH_BAD_SHAPE', ['field' => 'seen']); return; }
        if (count($maps['traps']) > 8) { $this->violate('FISH_BAD_SHAPE', ['field' => 'traps']); return; }
        foreach ($maps['traps'] as $id => $t) {
            $t = self::o($t);
            if (!in_array((string) $id, $T['spots'], true) || !$t || !self::numIn(self::p($t, 'at'), 1, 4102444800000)) { $this->violate('FISH_BAD_SHAPE', ['field' => 'traps']); return; }
        }
        $day = self::o(self::p($f, 'day'));
        if ($day) {
            if (!$count(self::p($day, 'key') === null ? 0 : self::p($day, 'key'), 99991231)) { $this->violate('FISH_BAD_SHAPE', ['field' => 'day']); return; }
            if (self::n(self::p($day, 'kept')) > $capDay) { $this->violate('FISH_KEEP_LIMIT', ['kept' => self::i(self::p($day, 'kept')), 'limit' => $capDay]); return; }
        }
        // the counters the achievements read never run ahead of the book
        $st = self::o(self::p($n, 'stats'));
        $caps = ['fishSpecies' => count($maps['book']), 'fishGuarded' => $guarded, 'fishCaught' => $sumN, 'fishReleased' => $sumRel];
        foreach ($caps as $stat => $cap) if (self::n(self::p($st, $stat)) > $cap) { $this->violate('FISH_BAD_SHAPE', ['field' => $stat]); return; }
    }

    /**
     * What the catches since the previous save explain: exp per landed fish (at most the hardest fish's), the bonus of
     * a first meeting (exp + edu) and the small thank-you of a release. A catch takes time — more landed fish than
     * 3 + one per 6 seconds is a violation. @return array{exp: int, edu: int}
     */
    private function fishing(object $n, ?object $p, float $dt): array
    {
        $T = GameData::fish();
        if (!$T['species']) return ['exp' => 0, 'edu' => 0];
        $sN = self::o(self::p($n, 'stats'));
        $sP = $p ? self::o(self::p($p, 'stats')) : null;
        $d = function (string $k) use ($sN, $sP): int { return max(0, self::i(self::p($sN, $k)) - self::i(self::p($sP, $k))); };
        $caught = $d('fishCaught');
        $cap = 3 + (int) floor(min($dt, 86400.0) / 6);
        if ($caught > $cap) $this->violate('FISH_COUNT', ['stat' => $caught, 'possible' => $cap]);
        $caught = min($caught, $cap);
        $bookN = count(self::kv(self::p(self::o(self::p($n, 'fishing')), 'book')));
        $bookP = $p ? count(self::kv(self::p(self::o(self::p($p, 'fishing')), 'book'))) : 0;
        $new = max(0, min(count($T['species']), $bookN) - $bookP);
        $released = min($d('fishReleased'), $caught + 3);
        return [
            'exp' => $caught * $T['exp']['catchMax'] + $new * $T['exp']['first'] + $released * $T['exp']['release'],
            'edu' => $new * $T['exp']['firstEdu'],
        ];
    }

    // ------------------------------------------------------------------ reward valuation
    /** value / exp one harvest of this crop can produce (null = most valuable crop) */
    private static function cropReward(?array $c): array
    {
        if (!$c) { $m = GameData::maxima(); return [$m['harvestValue'], $m['harvestExp']]; }
        $amt = (array) (isset($c['harvestAmount']) ? $c['harvestAmount'] : [3]);
        $hi = (int) max($amt ?: [3]) + 1; // + basket bonus
        return [(int) (isset($c['coin']) ? $c['coin'] : 0) + $hi * GameData::itemValue((string) (isset($c['harvestItem']) ? $c['harvestItem'] : '')), (int) (isset($c['exp']) ? $c['exp'] : 0)];
    }

    /** value / exp one claim of this recipe can produce (resultQty is not exported: up to 3 incl. quality bonus) */
    private static function recipeReward(?array $r): array
    {
        if (!$r) { $m = GameData::maxima(); return [$m['claimValue'], $m['claimExp']]; }
        return [(int) (isset($r['coin']) ? $r['coin'] : 0) + 3 * GameData::itemValue((string) (isset($r['resultItem']) ? $r['resultItem'] : '')), (int) (isset($r['exp']) ? $r['exp'] : 0)];
    }

    /** sum of the $n largest candidates; any count beyond the candidates is valued at $fallback each */
    private static function topSum(array $candidates, int $n, int $fallback): int
    {
        rsort($candidates);
        $sum = (int) array_sum(array_slice($candidates, 0, max(0, $n)));
        return $sum + max(0, $n - count($candidates)) * $fallback;
    }

    // ------------------------------------------------------------------ economy helpers
    /** coin + Σ items × replacement value (bag and 곳간 alike: moving between them changes nothing) + decorations + unlocked extra jars */
    private function netWorth(object $s): int
    {
        $st = self::o(self::p($s, 'stats'));
        $w = max(0, self::i(self::p($st, 'coin')));
        foreach (self::kv(self::p($s, 'inventory')) as $id => $q) $w += GameData::itemValue($id) * max(0, min(999, self::i($q)));
        foreach (array_slice(self::kv(self::p(self::o(self::p($s, 'storage')), 'items')), 0, 100, true) as $id => $q) $w += GameData::itemValue((string) $id) * max(0, min(9999, self::i($q)));
        $eng = self::o(self::p($s, 'engagement'));
        $decor = self::p($eng, 'decor');
        if (is_array($decor)) {
            foreach (array_slice($decor, 0, 200) as $d) {
                $item = self::s(self::p(self::o($d), 'item'));
                if ($item !== '') $w += GameData::itemValue($item);
            }
        }
        // [wardrobe] the pieces of the 옷장 count at their price: buying turns coins into a piece, selling back gives half
        $w += $this->wardrobeWorth($s);
        $owned = 0;
        // [content] a jar a plan / an administrator opened (via 'plan', CONTRACT §17.8) was not bought with coins: it is no
        // part of the net worth (counting it would read as 1,500 coins appearing per jar when a plan starts). Clearing the
        // mark later (buying such a jar with coins) raises the worth by one jar while the coins go down — balanced.
        // The mark is believed only where coins can never open a jar (J4 … J12) or while the account has a plan (limit > 3):
        // a free account cannot turn a coin-bought J2 / J3 into coins by marking it.
        foreach (self::kv(self::p($s, 'jars')) as $jid => $j) {
            $jo = self::o($j);
            if (self::p($jo, 'owned') !== true) continue;
            $planJar = self::p($jo, 'via') === 'plan' && ((preg_match('/^J(\d{1,3})$/', (string) $jid, $jm) && (int) $jm[1] > 3) || $this->jarLimit > 3);
            if (!$planJar) $owned++;
        }
        $w += max(0, $owned - 1) * (int) $this->t('jar_value', 1500);
        return $w;
    }

    private function expTotal(object $s): int
    {
        $st = self::o(self::p($s, 'stats'));
        return GameData::expTotal(max(1, self::i(self::p($st, 'level'))), max(0, self::i(self::p($st, 'exp'))));
    }

    /** if the build ever exports quest objectives, stat-type objectives must be backed by the stats */
    private function checkQuestObjectives(string $qid, array $def, object $n): void
    {
        $objs = isset($def['objectives']) ? $def['objectives'] : null;
        if (!is_array($objs)) return;
        $map = ['water' => 'waters', 'harvest' => 'harvests', 'plant' => 'plants', 'journal' => 'journals', 'quiz' => 'quizCorrect',
            'photo' => 'photos', 'craft' => 'crafts', 'ferment_claim' => 'fermentsClaimed', 'ferment_start' => 'fermentsStarted',
            'ferment_check' => 'fermentChecks', 'emote' => 'emotes', 'interact' => 'interacts', 'talk' => 'talks'];
        $st = self::o(self::p($n, 'stats'));
        foreach ($objs as $o) {
            $type = is_array($o) ? (string) (isset($o['type']) ? $o['type'] : '') : '';
            if (!isset($map[$type])) continue;
            $count = (int) (is_array($o) && isset($o['count']) ? $o['count'] : 1);
            if (self::i(self::p($st, $map[$type])) < $count) { $this->violate('QUEST_OBJECTIVE', ['quest' => $qid, 'type' => $type]); return; }
        }
    }

    // ------------------------------------------------------------------ checksum (cyrb53, identical to G.util.hash)
    private static function imul(int $a, int $b): int
    {
        $a &= 0xFFFFFFFF;
        $lo = ($a & 0xFFFF) * $b;
        $hi = (($a >> 16) * $b) & 0xFFFF;
        return ($lo + ($hi << 16)) & 0xFFFFFFFF;
    }

    /** cyrb53 over the UTF-16 code units of a UTF-8 string (what JavaScript's charCodeAt sees) */
    public static function cyrb53(string $utf8): string
    {
        $h1 = 0xdeadbeef;
        $h2 = 0x41c6ce57;
        $len = strlen($utf8);
        $b = function (int $i) use ($utf8, $len): int { return $i < $len ? ord($utf8[$i]) : 0; };
        for ($i = 0; $i < $len;) {
            $c = ord($utf8[$i]);
            if ($c < 0x80) { $cp = $c; $i++; }
            elseif ($c < 0xE0) { $cp = (($c & 0x1F) << 6) | ($b($i + 1) & 0x3F); $i += 2; }
            elseif ($c < 0xF0) { $cp = (($c & 0x0F) << 12) | (($b($i + 1) & 0x3F) << 6) | ($b($i + 2) & 0x3F); $i += 3; }
            else { $cp = (($c & 0x07) << 18) | (($b($i + 1) & 0x3F) << 12) | (($b($i + 2) & 0x3F) << 6) | ($b($i + 3) & 0x3F); $i += 4; }
            if ($cp >= 0x10000) {
                $cp -= 0x10000;
                $u = 0xD800 | ($cp >> 10);
                $h1 = self::imul($h1 ^ $u, 2654435761); $h2 = self::imul($h2 ^ $u, 1597334677);
                $u = 0xDC00 | ($cp & 0x3FF);
                $h1 = self::imul($h1 ^ $u, 2654435761); $h2 = self::imul($h2 ^ $u, 1597334677);
            } else {
                $h1 = self::imul($h1 ^ $cp, 2654435761); $h2 = self::imul($h2 ^ $cp, 1597334677);
            }
        }
        $h1 = self::imul($h1 ^ ($h1 >> 16), 2246822507) ^ self::imul($h2 ^ ($h2 >> 13), 3266489909);
        $h2 = self::imul($h2 ^ ($h2 >> 16), 2246822507) ^ self::imul($h1 ^ ($h1 >> 13), 3266489909);
        return str_pad(dechex(4294967296 * (2097151 & $h2) + ($h1 & 0xFFFFFFFF)), 14, '0', STR_PAD_LEFT);
    }

    /**
     * Raw JSON text of "data" inside the request envelope
     * {"version":n,"checksum":"…"[,"base":n],"data":{…}[,"base":n][,"csrf":"…"]}
     * exactly as the browser serialized it (JSON.stringify is deterministic), or null if the shape differs.
     */
    public static function rawDataSlice(string $body): ?string
    {
        if (!preg_match('/^\{"version":\d{1,6},"checksum":"[0-9a-f]{1,32}",(?:"base":\d{1,12},)?"data":/', $body, $m)) return null;
        $rest = Str::sub($body, strlen($m[0]));
        if (preg_match('/(?:,"base":\d{1,12})?(?:,"csrf":"[A-Za-z0-9]{1,128}")?\}$/', $rest, $c)) $rest = Str::sub($rest, 0, -strlen($c[0]));
        else return null;
        return ($rest !== '' && $rest[0] === '{') ? $rest : null;
    }

    // ------------------------------------------------------------------ profile summary for ranking / admin
    public static function profileSummary(object $s): array
    {
        $st = self::o(self::p($s, 'stats'));
        $prof = self::o(self::p($s, 'profile'));
        $title = self::s(self::p($prof, 'title'));
        $title = mb_substr(trim((string) preg_replace('/[^\x{AC00}-\x{D7A3}a-zA-Z0-9 _·\-]/u', '', $title)), 0, 20);
        // the ranking shows this to everyone: only titles the app can award (exported list); older exports fall
        // back to the chat filters so the title can never smuggle bad words or personal information
        $known = GameData::titles();
        if ($known ? !in_array($title, $known, true) : (ChatFilter::containsBadWord($title) || ChatFilter::hasPII($title))) $title = '';
        $quests = 0;
        foreach (self::kv(self::p($s, 'quests')) as $q) if (self::s(self::p(self::o($q), 'status')) === 'claimed') $quests++;
        $level = max(1, self::i(self::p($st, 'level')));
        $zone = self::s(self::p(self::o(self::p($s, 'player')), 'zoneId'));
        return [
            'level' => $level,
            'exp_total' => GameData::expTotal($level, max(0, self::i(self::p($st, 'exp')))),
            'coin' => max(0, self::i(self::p($st, 'coin'))),
            'edu' => max(0, self::i(self::p($st, 'edu'))),
            'title' => $title,
            'avatar' => Presence::appearance(self::p($prof, 'avatar')),
            'quests_claimed' => $quests,
            'achievements' => count(self::kv(self::p($s, 'achievements'))),
            'harvests' => max(0, self::i(self::p($st, 'harvests'))),
            'ferments' => max(0, self::i(self::p($st, 'fermentsClaimed'))),
            'journals' => max(0, self::i(self::p($st, 'journals'))),
            'play_time' => max(0, self::i(self::p($st, 'playTime'))),
            'zone_id' => preg_match('/^[A-Z0-9_]{1,40}$/', $zone) ? $zone : '',
        ];
    }

    // ------------------------------------------------------------------ operator restore stamp (admin.php)
    /**
     * admin.php "직전 저장으로 되돌리기" (AdminOps::restoreBackup) stamps the row's meta with {restoredRev, restoredAt}.
     * While the row is still that restored copy (meta.restoredRev === revision; the next accepted save clears the
     * stamp) → ['restoredAt' => ms of the restore, 'restoredRev' => that revision], otherwise zeros. player/get, login,
     * me and the 409 answers of player/save carry it, so a copy a device kept from before the restore is never offered
     * over it (R3-c2-r2-seams-lost-1). $row: a player_saves row with at least revision + meta (null: no save).
     */
    public static function restoreStamp(?array $row): array
    {
        $none = ['restoredAt' => 0, 'restoredRev' => 0];
        if (!$row || !isset($row['revision']) || !isset($row['meta'])) return $none;
        $m = Json::tryDecode((string) $row['meta'], true);
        if (!is_array($m) || !isset($m['restoredRev']) || (int) $m['restoredRev'] !== (int) $row['revision'] || (int) $row['revision'] <= 0) return $none;
        return ['restoredAt' => isset($m['restoredAt']) ? max(0, (int) $m['restoredAt']) : 0, 'restoredRev' => (int) $row['revision']];
    }

    /** restoreStamp() of an account's stored save (one primary-key read) */
    public static function restoreStampFor(int $uid): array
    {
        if ($uid <= 0) return self::restoreStamp(null);
        return self::restoreStamp(Db::one('SELECT revision, meta FROM player_saves WHERE user_id = ?', [$uid]));
    }
}
