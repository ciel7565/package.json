<?php
/**
 * Reward / timing tables exported by tools/build.mjs into data/game-data.json (never hand-written).
 * Derived maxima are used by the save validator to bound what a legitimate save can gain.
 * Forward compatible: if the export ever gains quest objectives / achievement conditions / level params,
 * the validator uses them.
 * PHP 7.2 syntax only.
 */
declare(strict_types=1);

namespace Tfm;

if (!defined('TFM_BOOT')) { if (function_exists('header_remove')) header_remove('X-Powered-By'); http_response_code(404); exit; }

final class GameData
{
    /** @var array|null */
    private static $d = null;

    public static function all(): array
    {
        if (self::$d !== null) return self::$d;
        $file = TFM_ROOT . DIRECTORY_SEPARATOR . 'data' . DIRECTORY_SEPARATOR . 'game-data.json';
        $alt = Config::dataDir() . DIRECTORY_SEPARATOR . 'game-data.json';
        $raw = @file_get_contents(is_file($file) ? $file : $alt);
        $d = $raw !== false ? Json::tryDecode($raw, true) : null;
        if (!is_array($d)) {
            Log::warn('DATA', 'game-data.json missing or invalid — run "node tools/build.mjs" to regenerate it');
            $d = [];
        }
        foreach (['quests', 'achievements', 'quizzes', 'crops', 'recipes', 'items', 'limits', 'titles'] as $k) {
            if (!isset($d[$k]) || !is_array($d[$k])) $d[$k] = [];
        }
        return self::$d = $d;
    }

    public static function loaded(): bool { return !empty(self::all()['items']); }
    public static function exportedAt(): string { $a = self::all(); return (string) (isset($a['exportedAt']) ? $a['exportedAt'] : ''); }

    /** @param int|float $def @return int|float */
    public static function limit(string $k, $def)
    {
        $a = self::all();
        $v = isset($a['limits'][$k]) ? $a['limits'][$k] : null;
        return is_numeric($v) ? $v + 0 : $def;
    }

    /** titles a player can earn (level + reward titles); empty when the export predates the list */
    public static function titles(): array { return array_values(array_filter(self::all()['titles'], 'is_string')); }

    public static function item(string $id): ?array { $a = self::all(); $i = isset($a['items'][$id]) ? $a['items'][$id] : null; return is_array($i) ? $i : null; }
    public static function crop(string $id): ?array { $a = self::all(); $c = isset($a['crops'][$id]) ? $a['crops'][$id] : null; return is_array($c) ? $c : null; }
    public static function recipe(string $id): ?array { $a = self::all(); $r = isset($a['recipes'][$id]) ? $a['recipes'][$id] : null; return is_array($r) ? $r : null; }

    /** replacement value of an item: what it costs to buy, or what it sells for — whichever is higher */
    public static function itemValue(string $id): int
    {
        $i = self::item($id);
        if (!$i) return 0;
        return max(0, (int) (isset($i['price']) ? $i['price'] : 0), (int) (isset($i['sell']) ? $i['sell'] : 0));
    }

    /** value of a reward bundle {coin, items} in coin-equivalent, plus exp/edu */
    public static function rewardOf(?array $r): array
    {
        $r = is_array($r) ? $r : [];
        $value = max(0, (int) (isset($r['coin']) ? $r['coin'] : 0));
        foreach ((array) (isset($r['items']) ? $r['items'] : []) as $id => $q) $value += self::itemValue((string) $id) * max(0, (int) $q);
        return ['value' => $value, 'exp' => max(0, (int) (isset($r['exp']) ? $r['exp'] : 0)), 'edu' => max(0, (int) (isset($r['edu']) ? $r['edu'] : 0))];
    }

    /** cached maxima over the tables */
    public static function maxima(): array
    {
        static $m = null;
        if ($m !== null) return $m;
        $d = self::all();
        $tol = (array) Config::get('save.tolerance', []);
        $harvestValue = 0; $harvestExp = 0; $minGrowth = PHP_INT_MAX;
        foreach ($d['crops'] as $c) {
            $amt = (array) (isset($c['harvestAmount']) ? $c['harvestAmount'] : [1, 3]);
            $hi = (int) max($amt ?: [3]) + 1; // + basket bonus
            $harvestValue = max($harvestValue, (int) (isset($c['coin']) ? $c['coin'] : 0) + $hi * self::itemValue((string) (isset($c['harvestItem']) ? $c['harvestItem'] : '')));
            $harvestExp = max($harvestExp, (int) (isset($c['exp']) ? $c['exp'] : 0));
            if ((isset($c['growthTime']) ? $c['growthTime'] : 0) > 0) $minGrowth = min($minGrowth, (int) $c['growthTime']);
        }
        $claimValue = 0; $claimExp = 0; $minFerment = PHP_INT_MAX;
        foreach ($d['recipes'] as $r) {
            // result quantity is not exported: assume up to 3 (resultQty 2 + quality bonus 1)
            $claimValue = max($claimValue, (int) (isset($r['coin']) ? $r['coin'] : 0) + 3 * self::itemValue((string) (isset($r['resultItem']) ? $r['resultItem'] : '')));
            $claimExp = max($claimExp, (int) (isset($r['exp']) ? $r['exp'] : 0));
            if ((isset($r['baseDuration']) ? $r['baseDuration'] : 0) > 0) $minFerment = min($minFerment, (int) $r['baseDuration']);
        }
        return $m = [
            'harvestValue' => $harvestValue ?: 400,
            'harvestExp'   => $harvestExp ?: 50,
            'minGrowth'    => $minGrowth === PHP_INT_MAX ? 90 : $minGrowth,
            'claimValue'   => $claimValue ?: 2000,
            'claimExp'     => $claimExp ?: 300,
            'minFerment'   => $minFerment === PHP_INT_MAX ? 150 : $minFerment,
            'craftValue'   => (int) (isset($tol['craft_value_gain']) ? $tol['craft_value_gain'] : 260),
            'craftExp'     => (int) (isset($tol['craft_exp']) ? $tol['craft_exp'] : 40),
        ];
    }

    /** cumulative exp at (level, exp) — mirrors G.data.levels.expFor (config save.level_exp) */
    public static function expTotal(int $level, int $exp): int
    {
        $c = (array) Config::get('save.level_exp', []);
        $base = (float) (isset($c['base']) ? $c['base'] : 120);
        $pow = (float) (isset($c['pow']) ? $c['pow'] : 1.35);
        $max = (int) (isset($c['max']) ? $c['max'] : 50);
        $level = max(1, min($max, $level));
        $t = 0;
        for ($l = 1; $l < $level; $l++) $t += (int) round($base * ($l ** $pow));
        return $t + max(0, $exp);
    }
}
