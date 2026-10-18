<?php
/**
 * Server-side save validation (anti-cheat) for player/save.php.
 *
 * The client owns the simulation, so the server cannot replay every action. Instead it checks that the
 * difference between the previously accepted save (P) and the new one (N) is something real play could
 * have produced in the elapsed *server* time:
 *
 *   1. shape & ranges           numbers finite, ids well-formed, quantities within limits
 *   2. identity                 profile.id / profile.role must match the account (immutable)
 *   3. farming timing           growth/harvests cannot outpace crop growthTime × harvestSpeedTolerance
 *   4. fermentation timing      progress/claims cannot outpace recipe baseDuration (max speed, tolerance)
 *   4b. movement / play time    Δstats.distance ≤ move_max_speed × elapsed (+ slack): legit running at RUN 18 m/s
 *                               (phase 4: 3× speed) passes with room to spare, a teleported 10,000 km does not;
 *                               Δstats.playTime ≤ elapsed server time (+ slack)
 *   5. economy                  Δ(net worth = coin + item replacement value + decor + extra jars), Δexp, Δedu
 *                               must be explained by rewards the server can account for (quests, achievements,
 *                               quizzes — each paid once, tracked in a server-side ledger — harvests, claims,
 *                               crafts, education). The unexplained remainder must fit a small per-save
 *                               allowance (grows with elapsed time) AND a daily budget; plus hard per-save caps
 *                               from game-data limits.
 *
 * Any violation → HTTP 409 VALIDATION_FAILED with the stored save, so the client restores it.
 * All tolerances live in config 'save.tolerance' and are documented in README-SERVER.md.
 * State objects are stdClass trees (json_decode(..., false)) so {} and [] survive a round trip.
 */
declare(strict_types=1);

namespace Tfm;

if (!defined('TFM_BOOT')) { http_response_code(404); exit; }

final class SaveValidator
{
    private const ID_RE = '/^[A-Za-z0-9_\-]{1,48}$/';
    private const JAR_STATES = ['EMPTY', 'PREPARING', 'FERMENTING', 'AGING', 'COMPLETE', 'CLAIMED'];
    private const JAR_ACTIVE = ['PREPARING', 'FERMENTING', 'AGING'];
    private const REGROW = 30.0; // herbs restart at 30 % after a harvest (crop category is not exported → applied to all)

    private array $violations = [];
    private array $notes = [];
    private array $tol;

    private function __construct() { $this->tol = (array) Config::get('save.tolerance', []); }

    // ------------------------------------------------------------------ tiny typed accessors (stdClass trees)
    private static function o(mixed $v): ?object { return $v instanceof \stdClass ? $v : null; }
    private static function p(?object $o, string $k): mixed { return ($o !== null && property_exists($o, $k)) ? $o->$k : null; }
    private static function n(mixed $v, float $d = 0.0): float { return (is_int($v) || is_float($v)) && is_finite((float) $v) ? (float) $v : $d; }
    private static function i(mixed $v): int { return (is_int($v) || is_float($v)) && is_finite((float) $v) ? (int) floor((float) $v) : 0; }
    private static function s(mixed $v): string { return is_string($v) ? $v : ''; }
    /** properties of an object as [string key => value] */
    private static function kv(mixed $o): array
    {
        if (!$o instanceof \stdClass) return [];
        $out = [];
        foreach (get_object_vars($o) as $k => $v) $out[(string) $k] = $v;
        return $out;
    }
    private function t(string $k, float $d): float { return isset($this->tol[$k]) && is_numeric($this->tol[$k]) ? (float) $this->tol[$k] : $d; }

    private function violate(string $code, array $detail = []): void
    {
        if (count($this->violations) < 20) $this->violations[] = ['code' => $code] + $detail;
    }

    /** malformed (not merely suspicious) input → 400 */
    private static function bad(string $why): never
    {
        throw new ApiException(400, 'INVALID_SAVE', '저장 데이터 형식이 올바르지 않아요.', ['reason' => $why]);
    }

    // ------------------------------------------------------------------ public entry
    /**
     * @param object      $n      new state
     * @param object|null $p      previous accepted state (null = first save)
     * @param array       $meta   server ledger from player_saves.meta
     * @param array       $user   users row
     * @param int         $prevAt server ms of the previous accepted save (or account creation)
     * @return array{ok:bool, violations:array, notes:array, meta:array, summary:array}
     */
    public static function validate(object $n, ?object $p, array $meta, array $user, int $prevAt, int $now): array
    {
        $v = new self();
        return $v->run($n, $p, $meta, $user, $prevAt, $now);
    }

    private function run(object $n, ?object $p, array $meta, array $user, int $prevAt, int $now): array
    {
        $this->shape($n);
        // ---------------------------------------------------------- identity (immutable fields)
        $prof = self::o(self::p($n, 'profile'));
        $pid = self::p($prof, 'id');
        if (!(is_string($pid) || is_int($pid)) || (string) $pid !== (string) $user['id']) $this->violate('PROFILE_ID');
        $role = self::s(self::p($prof, 'role'));
        if ($role !== ($user['role'] === 'admin' ? 'admin' : 'user')) $this->violate('PROFILE_ROLE', ['sent' => mb_substr($role, 0, 16)]);

        // ---------------------------------------------------------- progress reset (설정 → 진행 초기화)
        if ($p !== null && $this->looksLikeReset($n, $p)) {
            $this->notes[] = 'reset';
            // a fresh start begins at 0 m: allow what can be walked in the 10 minutes before its first save
            $resetD = self::n(self::p(self::o(self::p($n, 'stats')), 'distance'));
            $capD = max(1.0, $this->t('move_max_speed', 27)) * 600 + max(0.0, $this->t('move_slack_m', 300));
            if ($resetD > $capD) $this->violate('DISTANCE_TOO_FAST', ['gain' => (int) round($resetD), 'allowed' => (int) round($capD), 'reset' => true]);
            $meta = ['v' => 1, 'resets' => (int) ($meta['resets'] ?? 0) + 1, 'budget' => $meta['budget'] ?? null];
            $p = null;
        }
        $first = $p === null;
        $meta['v'] = 1;
        $paid = is_array($meta['paid'] ?? null) ? $meta['paid'] : [];
        foreach (['q', 'a', 'z', 'e', 'g'] as $k) if (!isset($paid[$k]) || !is_array($paid[$k])) $paid[$k] = [];
        // ids an older copy took back (see "regressed" below) and the losses that copy gave back: claiming such an
        // id again is explained only from that credit, so a child can finish the quest again but nothing pays twice
        $reg = is_array($meta['regressed'] ?? null) ? $meta['regressed'] : [];
        foreach (['q', 'a', 'z', 'e'] as $k) if (!isset($reg[$k]) || !is_array($reg[$k])) $reg[$k] = [];
        $cr = is_array($meta['credit'] ?? null) ? $meta['credit'] : [];
        $credit = ['value' => max(0, (int) ($cr['value'] ?? 0)), 'exp' => max(0, (int) ($cr['exp'] ?? 0)), 'edu' => max(0, (int) ($cr['edu'] ?? 0))];
        $fromCredit = ['value' => 0, 'exp' => 0, 'edu' => 0];

        $dt = max(0.0, ($now - $prevAt) / 1000);
        $statsNOf = fn (?object $s): ?object => $s ? self::o(self::p($s, 'stats')) : null;
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
        $max = GameData::maxima();

        // harvests / claims / crafts (bounded by time above)
        $statsN = self::o(self::p($n, 'stats'));
        $statsP = $p ? self::o(self::p($p, 'stats')) : null;
        $d = fn (string $k) => max(0, self::i(self::p($statsN, $k)) - self::i(self::p($statsP, $k)));
        $dHarv = $d('harvests');
        if ($dHarv > $farm['harvests'] + 1) $this->violate('HARVEST_COUNT', ['stat' => $dHarv, 'plots' => $farm['harvests']]);
        $harv = min($dHarv, $farm['harvests'] + 1);
        $dClaims = $d('fermentsClaimed');
        if ($dClaims > $ferm['slots'] + 1) $this->violate('FERMENT_CLAIMS', ['stat' => $dClaims, 'possible' => $ferm['slots']]);
        $claims = min($dClaims, $ferm['slots'] + 1);
        // crafting consumes ≥ 3 crop items per craft, and crops only come from harvests (the shop sells seeds)
        $dCrafts = $d('crafts');
        $cropItems = 0;
        if ($p) foreach (self::kv(self::p($p, 'inventory')) as $iid => $q) if ((GameData::item($iid)['type'] ?? '') === 'crop') $cropItems += max(0, self::i($q));
        $craftCap = min(3 + (int) floor(min($dt, 86400) / 2), intdiv($cropItems + $farm['harvests'] * 6, 3) + 1);
        if ($dCrafts > $craftCap) $this->violate('CRAFT_COUNT', ['stat' => $dCrafts, 'possible' => $craftCap]);
        $crafts = min($dCrafts, $craftCap);
        $explain['value'] += self::topSum($farm['values'], $harv, $max['harvestValue']) + self::topSum($ferm['values'], $claims, $max['claimValue']) + $crafts * $max['craftValue'];
        $explain['exp'] += self::topSum($farm['exps'], $harv, $max['harvestExp']) + self::topSum($ferm['exps'], $claims, $max['claimExp']) + $crafts * $max['craftExp'];

        // ---------------------------------------------------------- one-time rewards (server ledger: each paid once)
        $gd = GameData::all();
        $newQuests = 0;
        $pQuests = $p ? self::o(self::p($p, 'quests')) : null;
        foreach (self::kv(self::p($n, 'quests')) as $qid => $q) {
            if (!preg_match(self::ID_RE, $qid)) self::bad('quest id');
            if (self::s(self::p(self::o($q), 'status')) !== 'claimed' || isset($paid['q'][$qid])) continue;
            $paid['q'][$qid] = $now;
            if (self::s(self::p(self::o(self::p($pQuests, $qid)), 'status')) === 'claimed') continue; // already claimed before the ledger knew
            $def = $gd['quests'][$qid] ?? null;
            if (!is_array($def)) { $this->notes[] = "unknown quest $qid"; continue; }
            $this->checkQuestObjectives($qid, $def, $n);
            $pay('q', $qid, GameData::rewardOf($def['reward'] ?? null));
            $newQuests++;
        }
        $pAch = $p ? self::o(self::p($p, 'achievements')) : null;
        foreach (self::kv(self::p($n, 'achievements')) as $aid => $at) {
            if (!preg_match(self::ID_RE, $aid)) self::bad('achievement id');
            if (!$at || isset($paid['a'][$aid])) continue;
            $paid['a'][$aid] = $now;
            if (self::p($pAch, $aid)) continue;
            $def = $gd['achievements'][$aid] ?? null;
            if (!is_array($def)) { $this->notes[] = "unknown achievement $aid"; continue; }
            if (isset($def['condition']['stat'], $def['condition']['gte']) && is_string($def['condition']['stat'])) {
                // a missing / null counter is 0 (the client never unlocks on one), never "cannot check"
                $have = self::n(self::p($statsN, $def['condition']['stat']), 0.0);
                if ($have < (float) $def['condition']['gte']) $this->violate('ACHIEVEMENT_CONDITION', ['id' => $aid]);
            }
            $pay('a', $aid, GameData::rewardOf($def['reward'] ?? null));
        }
        $eduN = self::o(self::p($n, 'education'));
        $eduP = $p ? self::o(self::p($p, 'education')) : null;
        $quizP = self::o(self::p($eduP, 'quiz'));
        $solved = fn ($rec) => $rec === true || (self::o($rec) && self::p(self::o($rec), 'correct') === true);
        foreach (self::kv(self::p($eduN, 'quiz')) as $zid => $rec) {
            if (!preg_match(self::ID_RE, $zid)) self::bad('quiz id');
            if (!$solved($rec) || isset($paid['z'][$zid])) continue;
            $paid['z'][$zid] = $now;
            if ($solved(self::p($quizP, $zid))) continue;
            $def = $gd['quizzes'][$zid] ?? null;
            $pay('z', $zid, GameData::rewardOf(is_array($def) ? ($def['reward'] ?? ['exp' => 100, 'edu' => 10]) : ['exp' => 100, 'edu' => 10]));
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
        $maxVal = fn (array $ids): int => array_reduce($ids, fn ($m, $id) => max($m, GameData::itemValue($id)), 0);
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
            $already = max($countClaimed($dailyP), (int) ($paid['g']['m' . $dDay] ?? 0));
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
        $budget = is_array($meta['budget'] ?? null) && ($meta['budget']['day'] ?? '') === $day ? $meta['budget'] : ['day' => $day, 'value' => 0, 'exp' => 0, 'edu' => 0];
        $uW = max(0, $dW - $explain['value']);
        $uX = max(0, $dX - $explain['exp']);
        $uE = max(0, $dE - $explain['edu']);
        $remW = $this->t('daily_value', 12000) - (float) $budget['value'];
        $remX = $this->t('daily_exp', 4000) - (float) $budget['exp'];
        $remE = $this->t('daily_edu', 200) - (float) $budget['edu'];
        if ($uW > min($allowW, $remW)) $this->violate('UNEXPLAINED_VALUE', ['gain' => $dW, 'explained' => $explain['value'], 'allowed' => (int) max(0, min($allowW, $remW))]);
        if ($uX > min($allowX, $remX)) $this->violate('UNEXPLAINED_EXP', ['gain' => $dX, 'explained' => $explain['exp'], 'allowed' => (int) max(0, min($allowX, $remX))]);
        if ($uE > min($allowE, $remE)) $this->violate('UNEXPLAINED_EDU', ['gain' => $dE, 'explained' => $explain['edu'], 'allowed' => (int) max(0, min($allowE, $remE))]);
        $budget['value'] = (int) $budget['value'] + $uW;
        $budget['exp'] = (int) $budget['exp'] + $uX;
        $budget['edu'] = (int) $budget['edu'] + $uE;
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
                    $def = $gd['quests'][$qid] ?? null;
                    $took('q', $qid, GameData::rewardOf(is_array($def) ? ($def['reward'] ?? null) : null));
                }
            }
            foreach (array_keys($paid['a']) as $aid) {
                $aid = (string) $aid;
                if (self::p($pAch, $aid) && !self::p($nAch, $aid)) {
                    $def = $gd['achievements'][$aid] ?? null;
                    $took('a', $aid, GameData::rewardOf(is_array($def) ? ($def['reward'] ?? null) : null));
                }
            }
            foreach (array_keys($paid['z']) as $zid) {
                $zid = (string) $zid;
                if ($solved(self::p($quizP, $zid)) && !$solved(self::p($quizN, $zid))) {
                    $def = $gd['quizzes'][$zid] ?? null;
                    $took('z', $zid, GameData::rewardOf(is_array($def) ? ($def['reward'] ?? ['exp' => 100, 'edu' => 10]) : ['exp' => 100, 'edu' => 10]));
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
                'dt' => round($dt, 1), 'first' => $first, 'dValue' => $dW, 'dExp' => $dX, 'dEdu' => $dE,
                'explained' => $explain, 'unexplained' => ['value' => $uW, 'exp' => $uX, 'edu' => $uE],
                'harvests' => $harv, 'claims' => $claims, 'crafts' => $crafts, 'quests' => $newQuests,
            ],
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
        foreach (['companion', 'engagement'] as $k) {
            $v = self::p($n, $k);
            if ($v !== null && !self::o($v)) self::bad($k);
        }
        if (mb_strlen(self::s(self::p(self::o(self::p($n, 'companion')), 'name'))) > 16) self::bad('companion name');
        $decor = self::p(self::o(self::p($n, 'engagement')), 'decor');
        if ($decor !== null && (!is_array($decor) || count($decor) > 50)) self::bad('engagement decor');
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
            // every counter is a number: a string / object / bool would slip past the movement and range checks
            if (!is_int($v) && !is_float($v)) {
                if ($v === null) continue;
                self::bad('stat type');
            }
            if (!is_finite((float) $v) || $v < 0 || $v > ($ceil[$k] ?? 1e7)) $this->violate('STAT_RANGE', ['stat' => mb_substr($k, 0, 24)]);
        }
        $level = self::i(self::p($stats, 'level'));
        $lc = (array) Config::get('save.level_exp', []);
        $maxLevel = (int) ($lc['max'] ?? 50);
        if ($level < 1 || $level > $maxLevel) $this->violate('LEVEL_RANGE', ['level' => $level]);
        $exp = self::i(self::p($stats, 'exp'));
        $need = (int) round(((float) ($lc['base'] ?? 120)) * (max(1, min($maxLevel, $level)) ** (float) ($lc['pow'] ?? 1.35)));
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
     * Since phase 4 the player runs at 18 m/s (walk 9.6): move_max_speed (default 27 m/s = RUN × 1.5 for jumps, the
     * easy-mode rescue hop and frame jitter) × the elapsed server time between accepted saves, plus a fixed slack.
     */
    private function movement(?object $sN, ?object $sP, float $dt): void
    {
        $slackT = $this->t('time_slack', 5);
        $dD = self::n(self::p($sN, 'distance')) - self::n(self::p($sP, 'distance'));
        $allowD = max(1.0, $this->t('move_max_speed', 27)) * ($dt + $slackT) + max(0.0, $this->t('move_slack_m', 300));
        if ($dD > $allowD) $this->violate('DISTANCE_TOO_FAST', ['gain' => (int) round($dD), 'allowed' => (int) round($allowD), 'elapsed' => round($dt, 1)]);
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
        // %/s at the fastest legal speed for a crop (null = fastest crop of all)
        $rate = function (?array $c) use ($tolH, $minGrowth): float {
            $gt = $c && ($c['growthTime'] ?? 0) > 0 ? (float) $c['growthTime'] : (float) $minGrowth;
            return 100.0 / max(1.0, $gt * $tolH);
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
            $ps = self::o($plotsP[$id] ?? null);
            $hN = max(0, self::i(self::p($s, 'harvests')));
            $hP = $ps ? max(0, self::i(self::p($ps, 'harvests'))) : 0;
            $k = max(0, $hN - $hP);
            $total += $k;
            if ($k > 0) {
                // first harvest = the crop that stood here at the previous save (prefill on a first save: assume the
                // crop still/now on the plot); later ones in the same interval = the current crop (herb regrowth) or unknown
                $pc = $ps ? GameData::crop(self::s(self::p($ps, 'cropId'))) : null;
                [$v1, $x1] = self::cropReward($first ? ($crop ?? $pc) : $pc);
                [$vn, $xn] = self::cropReward($crop);
                $values[] = $v1; $exps[] = $x1;
                for ($j = 1; $j < min($k, 200); $j++) { $values[] = $vn; $exps[] = $xn; }
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
            if ($need > $dt + $slackT) $this->violate('GROWTH_TOO_FAST', ['plot' => $id, 'need' => round($need, 1), 'elapsed' => round($dt, 1)]);
        }
        return ['harvests' => $total, 'values' => $values, 'exps' => $exps];
    }

    // ------------------------------------------------------------------ fermentation
    /** @return array{slots:int, values:int[], exps:int[]} — claims the jars can account for, with per-claim reward bounds */
    private function fermentation(object $n, ?object $p, bool $first, float $dt): array
    {
        $tolF = $this->t('ferment_tolerance', 0.5);
        $speed = max(1.0, $this->t('ferment_max_speed', 1.2));
        $gs = $this->t('growth_slack', 3);
        $slackT = $this->t('time_slack', 5);
        $minF = GameData::maxima()['minFerment'];
        $rate = fn (?array $r): float => 100.0 * $speed / max(1.0, (($r && ($r['baseDuration'] ?? 0) > 0) ? (float) $r['baseDuration'] : (float) $minF) * $tolF);
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
                if ($owned) { [$v, $x] = self::recipeReward($rec); $values[] = $v; $exps[] = $x; }
                for ($j = 0; $j < min($extra, 50); $j++) { $values[] = $maxR[0]; $exps[] = $maxR[1]; }
                continue;
            }
            $ps = self::o($jarsP[$id] ?? null);
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
            if ($need > $dt + $slackT) $this->violate('FERMENT_TOO_FAST', ['jar' => $id, 'need' => round($need, 1), 'elapsed' => round($dt, 1)]);
            if ($owned || ($ps && self::p($ps, 'owned') === true)) {
                $extra = (int) floor(max(0.0, $dt - $need) / $fullMin);
                $slots += $claimsHere + $extra;
                // the batch claimed first is the one that was in the jar at the previous save
                for ($j = 0; $j < $claimsHere; $j++) { [$v, $x] = self::recipeReward($j === 0 && $pOpen && $pRec ? $pRec : $rec); $values[] = $v; $exps[] = $x; }
                for ($j = 0; $j < min($extra, 50); $j++) { $values[] = $maxR[0]; $exps[] = $maxR[1]; }
            }
        }
        return ['slots' => $slots, 'values' => $values, 'exps' => $exps];
    }

    // ------------------------------------------------------------------ reward valuation
    /** value / exp one harvest of this crop can produce (null = most valuable crop) */
    private static function cropReward(?array $c): array
    {
        if (!$c) { $m = GameData::maxima(); return [$m['harvestValue'], $m['harvestExp']]; }
        $hi = (int) max((array) ($c['harvestAmount'] ?? [3]) ?: [3]) + 1; // + basket bonus
        return [(int) ($c['coin'] ?? 0) + $hi * GameData::itemValue((string) ($c['harvestItem'] ?? '')), (int) ($c['exp'] ?? 0)];
    }

    /** value / exp one claim of this recipe can produce (resultQty is not exported: up to 3 incl. quality bonus) */
    private static function recipeReward(?array $r): array
    {
        if (!$r) { $m = GameData::maxima(); return [$m['claimValue'], $m['claimExp']]; }
        return [(int) ($r['coin'] ?? 0) + 3 * GameData::itemValue((string) ($r['resultItem'] ?? '')), (int) ($r['exp'] ?? 0)];
    }

    /** sum of the $n largest candidates; any count beyond the candidates is valued at $fallback each */
    private static function topSum(array $candidates, int $n, int $fallback): int
    {
        rsort($candidates);
        $sum = array_sum(array_slice($candidates, 0, max(0, $n)));
        return $sum + max(0, $n - count($candidates)) * $fallback;
    }

    // ------------------------------------------------------------------ economy helpers
    /** coin + Σ items × replacement value + decorations + unlocked extra jars */
    private function netWorth(object $s): int
    {
        $st = self::o(self::p($s, 'stats'));
        $w = max(0, self::i(self::p($st, 'coin')));
        foreach (self::kv(self::p($s, 'inventory')) as $id => $q) $w += GameData::itemValue($id) * max(0, min(999, self::i($q)));
        $eng = self::o(self::p($s, 'engagement'));
        $decor = self::p($eng, 'decor');
        if (is_array($decor)) {
            foreach (array_slice($decor, 0, 200) as $d) {
                $item = self::s(self::p(self::o($d), 'item'));
                if ($item !== '') $w += GameData::itemValue($item);
            }
        }
        $owned = 0;
        foreach (self::kv(self::p($s, 'jars')) as $j) if (self::p(self::o($j), 'owned') === true) $owned++;
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
        $objs = $def['objectives'] ?? null;
        if (!is_array($objs)) return;
        $map = ['water' => 'waters', 'harvest' => 'harvests', 'plant' => 'plants', 'journal' => 'journals', 'quiz' => 'quizCorrect',
            'photo' => 'photos', 'craft' => 'crafts', 'ferment_claim' => 'fermentsClaimed', 'ferment_start' => 'fermentsStarted',
            'ferment_check' => 'fermentChecks', 'emote' => 'emotes', 'interact' => 'interacts', 'talk' => 'talks'];
        $st = self::o(self::p($n, 'stats'));
        foreach ($objs as $o) {
            $type = is_array($o) ? (string) ($o['type'] ?? '') : '';
            if (!isset($map[$type])) continue;
            $count = (int) ($o['count'] ?? 1);
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
        for ($i = 0; $i < $len;) {
            $c = ord($utf8[$i]);
            if ($c < 0x80) { $cp = $c; $i++; }
            elseif ($c < 0xE0) { $cp = (($c & 0x1F) << 6) | (ord($utf8[$i + 1] ?? "\0") & 0x3F); $i += 2; }
            elseif ($c < 0xF0) { $cp = (($c & 0x0F) << 12) | ((ord($utf8[$i + 1] ?? "\0") & 0x3F) << 6) | (ord($utf8[$i + 2] ?? "\0") & 0x3F); $i += 3; }
            else { $cp = (($c & 0x07) << 18) | ((ord($utf8[$i + 1] ?? "\0") & 0x3F) << 12) | ((ord($utf8[$i + 2] ?? "\0") & 0x3F) << 6) | (ord($utf8[$i + 3] ?? "\0") & 0x3F); $i += 4; }
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
        $rest = substr($body, strlen($m[0]));
        if (preg_match('/(?:,"base":\d{1,12})?(?:,"csrf":"[A-Za-z0-9]{1,128}")?\}$/', $rest, $c)) $rest = substr($rest, 0, -strlen($c[0]));
        else return null;
        return ($rest !== '' && $rest[0] === '{') ? $rest : null;
    }

    // ------------------------------------------------------------------ profile summary for ranking / admin
    public static function profileSummary(object $s): array
    {
        $st = self::o(self::p($s, 'stats'));
        $prof = self::o(self::p($s, 'profile'));
        $title = self::s(self::p($prof, 'title'));
        $title = mb_substr(trim(preg_replace('/[^\x{AC00}-\x{D7A3}a-zA-Z0-9 _·\-]/u', '', $title) ?? ''), 0, 20);
        // the ranking shows this to everyone: only titles the game can award (exported list); older exports fall
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
}
