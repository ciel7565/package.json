<?php
/**
 * tests/avatar-unit.php — the server side of the phase-9 avatar (CONTRACT §17.7): Tfm\Presence::appearance (the
 * whitelist behind SaveValidator::profileSummary and every look other players receive through presence / sync) keeps
 * every id of the new table — style `real`, 14 hair styles, headwear, hanbok pieces, patterns, footwear, trinkets, the
 * two new colours — drops unknown ids, bad colours and odd types, keeps older (phase 8) looks as they were, and widens
 * its lists from game-data.json (`avatar`, exported by tools/build.mjs from src/game/02-avatar-data.js).
 * The option table is read from 02-avatar-data.js with node (the same evaluation the build's export uses).
 *
 *   php tests/avatar-unit.php
 *
 * CLI only; never deployed. Developer tooling: runs on the dev PHP (8.x); the code under test is PHP 7.2.
 */
declare(strict_types=1);

if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
function copyTree(string $from, string $to): void
{
    if (!is_dir($to)) mkdir($to, 0700, true);
    foreach (scandir($from) ?: [] as $f) {
        if ($f === '.' || $f === '..') continue;
        if (is_dir("$from/$f")) copyTree("$from/$f", "$to/$f");
        elseif (!preg_match('/\.sqlite(-wal|-shm)?$|config\.local\.php$|secret\.php$|install\.lock$/', $f)) copy("$from/$f", "$to/$f");
    }
}
$root = sys_get_temp_dir() . '/tfm-avatar-' . bin2hex(random_bytes(6));
$srv = $root . '/srv';
$tmp = $root . '/data';
mkdir($tmp, 0700, true);
copyTree(__DIR__ . '/../server', $srv);
putenv("TFM_DATA_DIR=$tmp");
putenv("TFM_UPLOAD_DIR=$tmp/uploads");

// the option table exactly as the build exports it (node evaluates the data fragment)
$js = realpath(__DIR__ . '/../src/game/02-avatar-data.js');
$cmd = 'node -e ' . escapeshellarg("const vm=require('vm'),fs=require('fs');const G={data:{}};vm.runInNewContext(fs.readFileSync(process.argv[1],'utf8'),{G});const a=G.data.avatar;process.stdout.write(JSON.stringify({v:a.v,options:a.options,legacy:a.legacy,colorKeys:a.colorKeys,defaults:a.defaults,presets:a.presets}))") . ' ' . escapeshellarg((string) $js);
$table = json_decode((string) shell_exec($cmd), true);
if (!is_array($table) || !isset($table['options'])) { fwrite(STDERR, "could not read the avatar table with node\n"); exit(2); }
// a game-data.json with the exported block + one extra id (the widening check)
$gd = is_file($srv . '/data/game-data.json') ? (json_decode((string) file_get_contents($srv . '/data/game-data.json'), true) ?: []) : [];
$extra = $table['options'];
$extra['hair'][] = 'testplait';
$gd['avatar'] = ['v' => $table['v'], 'options' => $extra, 'legacy' => $table['legacy'], 'colorKeys' => $table['colorKeys']];
if (!is_dir($srv . '/data')) mkdir($srv . '/data', 0700, true);
file_put_contents($srv . '/data/game-data.json', json_encode($gd));
require $srv . '/lib/bootstrap.php';

$failed = 0;
$passed = 0;
function check(string $name, callable $test): void
{
    global $failed, $passed;
    try {
        $r = $test();
        $ok = $r === true;
        $detail = is_string($r) ? $r : ($ok ? '' : 'assertion is false');
    } catch (Throwable $e) {
        $ok = false;
        $detail = get_class($e) . ': ' . $e->getMessage() . ' @' . basename($e->getFile()) . ':' . $e->getLine();
    }
    if ($ok) $passed++; else $failed++;
    echo ($ok ? 'PASS  ' : 'FAIL  ') . $name . ($ok || $detail === '' ? '' : "  — $detail") . PHP_EOL;
}
function ap($a): array { $j = Tfm\Presence::appearance($a); return $j === null ? [] : (array) json_decode($j, true); }

$colorKeys = $table['colorKeys'];
$def = $table['defaults'];

check('a new-style look (all ' . count($def) . ' keys) passes unchanged', function () use ($def) {
    $out = ap($def);
    $missing = array_diff_key($def, $out);
    foreach ($def as $k => $v) if (isset($out[$k]) && $out[$k] !== $v && !(is_float($v) || is_int($v))) return "changed $k: " . json_encode($out[$k]);
    return $missing ? 'dropped: ' . implode(', ', array_keys($missing)) : true;
});
check('every option id of every key is accepted', function () use ($table, $def, $colorKeys) {
    $bad = [];
    foreach ($table['options'] as $k => $vals) {
        if (in_array($k, $colorKeys, true)) continue;
        foreach ($vals as $v) { $out = ap(array_merge($def, [$k => $v])); if (!isset($out[$k]) || $out[$k] !== $v) $bad[] = "$k=$v"; }
    }
    return $bad ? 'refused: ' . implode(', ', $bad) : true;
});
check('every colour of every colour key is accepted (lower case)', function () use ($table, $def, $colorKeys) {
    $bad = [];
    foreach ($colorKeys as $k) foreach ($table['options'][$k] as $c) { $out = ap(array_merge($def, [$k => strtoupper($c)])); if (($out[$k] ?? '') !== strtolower($c)) $bad[] = "$k=$c"; }
    return $bad ? implode(', ', $bad) : true;
});
check('every ready-made look (갖춤) passes whole', function () use ($table) {
    if (count($table['presets']) < 12) return 'fewer than 12 presets';
    foreach ($table['presets'] as $p) { $out = ap($p['app']); foreach ($p['app'] as $k => $v) if ($k !== 'height' && ($out[$k] ?? null) !== $v) return "{$p['id']}: $k"; }
    return true;
});
check('unknown ids, bad colours, odd types and extra keys are dropped', function () use ($def) {
    $out = ap(array_merge($def, ['hair' => 'mohawk', 'hat' => '<script>', 'topColor' => 'red', 'outerColor' => '#12345g', 'style' => ['real'], 'face' => 3, 'evil' => 'x', '__proto__' => ['a' => 1], 'height' => 'tall']));
    foreach (['hair', 'hat', 'topColor', 'outerColor', 'style', 'face', 'evil', '__proto__', 'height'] as $k) if (array_key_exists($k, $out)) return "kept $k";
    return true;
});
check('height is clamped to 0.9 … 1.1 and rounded', function () use ($def) {
    return ap(array_merge($def, ['height' => 7]))['height'] === 1.1 && ap(array_merge($def, ['height' => 0.123]))['height'] === 0.9 && ap(array_merge($def, ['height' => 1.0467]))['height'] === 1.05;
});
check('an older (phase 8) look keeps every value, its hat-as-accessory included', function () {
    $old = ['skin' => '#f6d0b1', 'hair' => 'bun', 'hairColor' => '#1f1a18', 'top' => 'hanbok', 'topColor' => '#f08bb0', 'bottom' => 'skirt', 'bottomColor' => '#b45a73', 'shoes' => '#ffffff', 'bag' => 'pouch', 'bagColor' => '#f4c54a', 'accessory' => 'gat', 'accessoryColor' => '#1f1f22', 'face' => 'smile', 'height' => 0.95];
    $out = ap($old);
    foreach ($old as $k => $v) if (($out[$k] ?? null) !== $v) return "changed $k";
    return !isset($out['style']) ? true : 'invented a style';
});
check('the lists widen from game-data.json (an exported id the constants do not know is accepted)', function () use ($def) {
    return (ap(array_merge($def, ['hair' => 'testplait']))['hair'] ?? '') === 'testplait';
});
check('SaveValidator::profileSummary carries the new look (style real, 갓, 두루마기, 고무신)', function () use ($def) {
    $s = json_decode((string) json_encode(['profile' => ['nickname' => 'tester', 'title' => '', 'avatar' => array_merge($def, ['hat' => 'gat', 'top' => 'durumagi', 'hair' => 'sangtu'])], 'stats' => ['level' => 3, 'exp' => 10, 'coin' => 5]]), false);
    $sum = Tfm\SaveValidator::profileSummary($s);
    $a = isset($sum['avatar']) && is_string($sum['avatar']) ? json_decode($sum['avatar'], true) : null;
    if (!is_array($a)) return 'no avatar in the summary: ' . json_encode($sum);
    return ($a['style'] ?? '') === 'real' && ($a['hat'] ?? '') === 'gat' && ($a['top'] ?? '') === 'durumagi' && ($a['footwear'] ?? '') === 'gomusin' ? true : json_encode($a);
});
// [hanbok] phase 11 (CONTRACT §19.0 / §19.1): modern ids left `options` for `legacy` — an old save keeps passing; the
// new colour rows (회장 · 노리개 · 주머니 · 댕기 · 띠) come from the exported colorKeys
check('phase 11: a look with the modern (legacy) ids of phase 10 still passes whole', function () use ($def) {
    $modern = ['style' => 'real', 'top' => 'hoodie', 'bottom' => 'shorts', 'footwear' => 'sneakers', 'hat' => 'cap', 'bag' => 'backpack', 'accessory' => 'glasses', 'topColor' => '#8b6fd6'];
    $out = ap($modern);
    foreach ($modern as $k => $v) if (($out[$k] ?? null) !== $v) return "dropped $k";
    return true;
});
check('phase 11: the new colour rows and slots are kept (trimColor, norigaeColor, outer, belt …)', function () use ($def) {
    $a = array_merge($def, ['outer' => 'dopo', 'belt' => 'sejodae', 'norigae' => 'samjak', 'trimColor' => '#8A3B4B', 'norigaeColor' => '#c23a4a', 'ribbonColor' => '#2e3f6e', 'beltColor' => '#2e3f6e', 'pouchColor' => '#d9534f']);
    $out = ap($a);
    foreach (['outer' => 'dopo', 'belt' => 'sejodae', 'norigae' => 'samjak', 'trimColor' => '#8a3b4b', 'norigaeColor' => '#c23a4a', 'ribbonColor' => '#2e3f6e', 'beltColor' => '#2e3f6e', 'pouchColor' => '#d9534f'] as $k => $v) if (($out[$k] ?? null) !== $v) return "$k: " . json_encode($out[$k] ?? null);
    return true;
});
check('a too-big or non-object appearance gives nothing', function () {
    return Tfm\Presence::appearance('x') === null && Tfm\Presence::appearance(null) === null && Tfm\Presence::appearance([]) === null;
});

echo PHP_EOL . "avatar-unit: $passed passed, $failed failed" . PHP_EOL;
exit($failed ? 1 : 0);
