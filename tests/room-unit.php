<?php
/**
 * tests/room-unit.php — unit checks for 내 방 on the server (CONTRACT §17.4): table user_rooms (schema v8), Tfm\Room —
 * who has a room (administrator · live allotment contract · the operator's grant), the limit, reading (own room, another
 * account's public room), saving with the version rule, the validation of every thing against the catalogue (a matrix
 * of hostile data), the operator's grant with its audit trail, a room inside a game save, and reading / saving with
 * 10,000 rooms in the table.
 * The catalogue is taken from src/game/76-myroom-data.js with Node (as tools/build.mjs exports it) and written into the
 * private copy's data/game-data.json; Node also makes rooms the CLIENT's rules accept (the three ready-made rooms and
 * 300 random ones through sanitize()) — the server must accept every one of them.
 * No web server: a throw-away SQLite database in the temp dir — or MariaDB with the TFM_DB_* variables:
 *
 *   php tests/room-unit.php
 *   TFM_DB_DRIVER=mysql TFM_DB_HOST=127.0.0.1 TFM_DB_PORT=33106 TFM_DB_USER=root TFM_DB_NAME=tfm_room_unit php tests/room-unit.php
 *   (the MariaDB database must exist and be empty)
 *
 * TFM_UNIT_ONLY=<text> runs only the checks whose name contains <text>. TFM_ROOM_ROWS=<n> rows for the timing (10000).
 * CLI only; never deployed. Exit 0 = all passed, 1 = a check failed, 2 = could not run (no Node).
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
$root = sys_get_temp_dir() . '/tfm-room-' . bin2hex(random_bytes(6));
$srv = $root . '/srv';
$tmp = $root . '/data';
mkdir($tmp, 0700, true);
copyTree(__DIR__ . '/../server', $srv);

// ---- the catalogue and the fixture rooms, from the data fragment (Node)
$js = <<<'JS'
const fs = require('fs'), vm = require('vm');
const [frag, out] = process.argv.slice(2);
const G = { data: {} };
vm.runInContext("(function(){'use strict';\n" + fs.readFileSync(frag, 'utf8') + "\n})()", vm.createContext({ G, Math, JSON, Object, Array, Number, String }));
const D = G.data.myroom;
let seed = 20261115;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const pick = (a) => a[Math.floor(rnd() * a.length)];
const rooms = [];
for (const p of D.presets) rooms.push({ name: 'preset ' + p.id, room: D.preset(p.id) });
for (let n = 0; n < 300; n++) {
  const raw = { v: 0, public: rnd() < 0.3, style: { floor: pick(D.styles.floor).id, wall: pick(D.styles.wall).id, wood: pick(D.styles.wood).id, mood: pick(D.styles.mood).id, win: Array.from({ length: 18 }, () => Math.floor(rnd() * 7)).join('') }, items: [] };
  const count = 1 + Math.floor(rnd() * 120);
  for (let k = 0; k < count; k++) {
    const id = pick(D.order), e = D.items[id];
    let it;
    if (e.place === 'W') { const side = pick(D.SIDES), at = D.wallSpot(side, Math.round(rnd() * D.SIDE_LEN[side] * 8) / 8); it = { i: id, x: at.x, z: at.z, r: at.r, y: Math.round((0.2 + rnd() * 2.4) * 20) / 20 }; }
    else it = { i: id, x: (rnd() - 0.5) * 15, z: (rnd() - 0.5) * 12, r: Math.floor(rnd() * 24), y: e.place === 'T' && rnd() < 0.3 ? pick([0.3, 0.36, 0.52, 0.81, 1.46]) : 0 };
    if (e.sz && rnd() < 0.5) it.s = pick([0, 2]);
    if (e.col && rnd() < 0.6) it.c = Math.floor(rnd() * D.palettes[e.col[0]].length);
    raw.items.push(it);
  }
  rooms.push({ name: 'random ' + n, room: D.sanitize(raw, 200) });
}
const strict = { ok: 0, bad: [] };
for (const p of D.presets) { const room = D.preset(p.id); room.items.forEach((it, k) => { const r = D.check(room, it, k); if (r.ok) strict.ok++; else strict.bad.push(p.id + ' #' + k + ' ' + it.i + ' ' + r.why); }); }
fs.writeFileSync(out, JSON.stringify({ table: D.serverTable(), rooms, strict, count: D.order.length, limits: D.LIMITS, sample: D.preset('janchi') }));
JS;
file_put_contents($root . '/fixtures.js', $js);
$node = getenv('TFM_NODE') ?: 'node';
exec(escapeshellarg($node) . ' ' . escapeshellarg($root . '/fixtures.js') . ' ' . escapeshellarg(__DIR__ . '/../src/game/76-myroom-data.js') . ' ' . escapeshellarg($root . '/fixtures.json') . ' 2>&1', $nodeOut, $nodeRc);
if ($nodeRc !== 0 || !is_file($root . '/fixtures.json')) { fwrite(STDERR, "could not run: Node is needed to read the catalogue (" . implode(' ', $nodeOut) . ")\n"); exit(2); }
$FX = json_decode((string) file_get_contents($root . '/fixtures.json'), true);
$gd = is_file($srv . '/data/game-data.json') ? json_decode((string) file_get_contents($srv . '/data/game-data.json'), true) : [];
if (!is_array($gd)) $gd = [];
$gd['myroom'] = $FX['table'];
if (!is_dir($srv . '/data')) mkdir($srv . '/data', 0700, true);
file_put_contents($srv . '/data/game-data.json', json_encode($gd));

putenv("TFM_DATA_DIR=$tmp");
putenv("TFM_UPLOAD_DIR=$tmp/uploads");
putenv('TFM_TOSS_MOCK=1');
require $srv . '/lib/bootstrap.php';

use Tfm\ApiException;
use Tfm\Db;
use Tfm\Room;

$failed = 0;
$passed = 0;
function check(string $name, callable $test): void
{
    global $failed, $passed;
    $only = (string) getenv('TFM_UNIT_ONLY');
    if ($only !== '' && strpos($name, $only) === false) return;
    try {
        $r = $test();
        $ok = $r === true;
        $detail = is_string($r) ? $r : ($ok ? '' : 'assertion is false');
    } catch (Throwable $e) {
        $ok = false;
        $detail = get_class($e) . ': ' . $e->getMessage() . ' @' . basename($e->getFile()) . ':' . $e->getLine();
    }
    if ($ok) $passed++; else $failed++;
    echo ($ok ? "PASS  " : "FAIL  ") . $name . ($ok || $detail === '' ? '' : "  — $detail") . PHP_EOL;
}
/** the ApiException a call throws as "status CODE" ('' = none) */
function apiCode(callable $fn): string
{
    try { $fn(); } catch (ApiException $e) { return $e->status . ' ' . $e->errorCode; }
    return '';
}
function apiData(callable $fn)
{
    try { $fn(); } catch (ApiException $e) { return $e->data; }
    return null;
}

$IS_MYSQL = strtolower((string) Tfm\Config::get('db.driver', 'sqlite')) === 'mysql';
$RUN = substr(bin2hex(random_bytes(4)), 0, 6);
$nUsers = 0;
function mkUser(string $role = ''): array
{
    global $RUN, $nUsers;
    $nUsers++;
    return Tfm\Users::create("room{$RUN}{$nUsers}@example.com", 'Rm' . substr($RUN, 0, 4) . $nUsers, 'Ferment2026ok', $role === 'admin' ? 'admin' : '');
}
/** a valid body made of a few known things */
function body(array $items = null, array $over = []): array
{
    $b = ['v' => 0, 'style' => ['floor' => 'jangpan', 'wall' => 'plaster', 'wood' => 'warm', 'mood' => 'day', 'win' => '000000660100010000'],
        'items' => $items === null ? [['i' => 'F_BANDAJI', 'x' => -3.5, 'y' => 0, 'z' => -2.0, 'r' => 0], ['i' => 'J_DANJI', 'x' => -3.5, 'y' => 0.81, 'z' => -2.0, 'r' => 0, 's' => 0, 'c' => 5]] : $items,
        'public' => false];
    foreach ($over as $k => $v) $b[$k] = $v;
    return $b;
}

// =============================================================================================== 1 · schema, catalogue
check('schema — a fresh database is at version 8 or newer and has user_rooms with its columns', function () {
    Db::pdo();
    if (Db::SCHEMA_VERSION < 8 || Db::schemaVersion() !== Db::SCHEMA_VERSION) return 'code ' . Db::SCHEMA_VERSION . ', database ' . Db::schemaVersion();
    foreach (['user_id', 'v', 'data', 'public', 'granted', 'granted_at', 'granted_by', 'updated_at'] as $c) if (!Db::hasColumn('user_rooms', $c)) return "column $c is missing";
    return true;
});
echo 'driver: ' . Db::driverSafe() . PHP_EOL;
check('catalogue — game-data.json carries the room table: at least 120 things, every row [kind, w, d, h, colours, sizes], the limits', function () use ($FX) {
    if (!Room::ready()) return 'Room::ready() is false';
    $t = Room::table();
    if (count($t['items']) < 120 || count($t['items']) !== $FX['count']) return count($t['items']) . ' things';
    foreach ($t['items'] as $id => $e) {
        if (!preg_match('/^[A-Z][A-Z0-9_]{1,23}$/', (string) $id) || !is_array($e) || count($e) !== 6 || !in_array($e[0], ['F', 'T', 'R', 'W', 'H'], true)) return "row $id";
        if (!($e[1] > 0 && $e[1] < 6 && $e[2] > 0 && $e[2] < 6 && $e[3] > 0 && $e[3] < 3.2)) return "sizes of $id";
    }
    return $t['limits']['free'] === 80 && $t['limits']['paid'] === 160 && $t['limits']['hard'] === Room::HARD && $t['limits']['bytes'] === Room::MAX_BYTES ? true : json_encode($t['limits']);
});
check('catalogue — the three ready-made rooms pass the CLIENT\'s strict rules thing by thing (nothing overlaps, hangs over a window or stands in the air)', function () use ($FX) {
    return $FX['strict']['bad'] === [] && $FX['strict']['ok'] >= 90 ? true : $FX['strict']['ok'] . ' fine; ' . implode(' · ', array_slice($FX['strict']['bad'], 0, 12));
});

// =============================================================================================== 2 · who has a room
$ADM = mkUser('admin');
$U1 = mkUser();   // gets a room by grant
$U2 = mkUser();   // gets a room by an allotment contract
$U3 = mkUser();   // never gets one
check('rights — a plain account has no room (limit: the free number); an administrator has one with the larger limit', function () use ($ADM, $U3) {
    $u = Room::rights($U3, true); $a = Room::rights($ADM, true);
    return $u === [false, 80] && $a === [true, 160] ? true : json_encode([$u, $a]);
});
check('rights — a guest / a broken account row has none', function () {
    return Room::rights([], true) === [false, 0] && Room::rights(['id' => 0, 'role' => 'admin'], true) === [false, 0];
});
check('grant — the operator gives a room: rights turn true at once (the cached answer is dropped), status() tells, the audit log has room_grant with the actor', function () use ($ADM, $U1) {
    $before = Room::rights($U1);                    // fills the cache with "no"
    if ($before[0]) return 'had a room before';
    if (!Room::grant((int) $U1['id'], true, (int) $ADM['id'])) return 'grant() answered false';
    $now = Room::rights($U1);
    $st = Room::status((int) $U1['id']);
    $log = Db::one("SELECT user_id, actor_id, detail FROM audit_log WHERE event = 'room_grant' ORDER BY id DESC LIMIT 1");
    return $now === [true, 80] && $st['granted'] && $st['has'] && !$st['contract'] && $st['grantedAt'] > 0 && $log && (int) $log['user_id'] === (int) $U1['id'] && (int) $log['actor_id'] === (int) $ADM['id'] && $log['detail'] === '[]'
        ? true : json_encode([$now, $st, $log]);
});
check('grant — taking it back: rights false again, the room\'s contents stay, audit room_revoke; an unknown account answers false and writes nothing', function () use ($ADM, $U1) {
    Room::save($U1, body());
    Room::grant((int) $U1['id'], false, (int) $ADM['id']);
    $off = Room::rights($U1);
    $kept = (int) Db::value('SELECT v FROM user_rooms WHERE user_id = ?', [(int) $U1['id']]);
    $n = (int) Db::value("SELECT COUNT(*) FROM audit_log WHERE event IN ('room_grant', 'room_revoke')");
    $ghost = Room::grant(987654321, true, (int) $ADM['id']);
    $n2 = (int) Db::value("SELECT COUNT(*) FROM audit_log WHERE event IN ('room_grant', 'room_revoke')");
    Room::grant((int) $U1['id'], true, (int) $ADM['id']);
    return !$off[0] && $kept === 1 && $ghost === false && $n2 === $n && (int) Db::value("SELECT COUNT(*) FROM audit_log WHERE event = 'room_revoke'") === 1
        && Db::value('SELECT user_id FROM user_rooms WHERE user_id = 987654321') === null ? true : json_encode([$off, $kept, $ghost, $n, $n2]);
});
check('rights — a live allotment contract gives a room; when the contract ends the room is closed again', function () use ($ADM, $U2) {
    Tfm\Allot::saveZone($ADM, ['code' => 'R1', 'kind' => 'jar', 'name' => '방 시험 장독대', 'capacity' => 5, 'cols' => 5, 'price' => 10000, 'period' => 'year', 'termMonths' => 12, 'isOpen' => true]);
    Tfm\Allot::seedUnits($ADM, 'R1', 5);
    $cu = Tfm\Allot::saveCustomer($ADM, ['name' => '방주인', 'phone' => '010-2468-1357', 'consent' => true]);
    Tfm\Allot::linkCustomer($ADM, (int) $cu['id'], (int) $U2['id']);
    if (Room::rights($U2, true)[0]) return 'a room before the contract';
    $c = Tfm\Allot::createContract($ADM, 'R1-0001', (int) $cu['id']);
    $on = Room::rights($U2, true);
    $st = Room::status((int) $U2['id']);
    Tfm\Allot::endContract($ADM, (int) $c['id'], '시험');
    $off = Room::rights($U2, true);
    $c2 = Tfm\Allot::createContract($ADM, 'R1-0002', (int) $cu['id']);
    return $on[0] && $st['contract'] && $st['has'] && !$st['granted'] && !$off[0] && Room::rights($U2, true)[0] && $c2['id'] > 0 ? true : json_encode([$on, $st, $off]);
});

// =============================================================================================== 3 · reading and saving
check('view — an account that never decorated gets an empty room (v 0, no things, not public) with can and limit', function () use ($U2, $U3) {
    $a = Room::view($U2); $b = Room::view($U3);
    return $a['mine'] === true && $a['can'] === true && $a['limit'] === 80 && $a['room']['v'] === 0 && $a['room']['items'] === [] && $a['room']['public'] === false
        && $b['can'] === false && $b['room']['items'] === [] ? true : json_encode([$a, $b]);
});
check('save — a first save (v 0) answers v 1; reading gives the same things back, value for value', function () use ($U2) {
    $b = body();
    $r = Room::save($U2, $b);
    $got = Room::view($U2);
    return $r === ['v' => 1] && $got['room']['v'] === 1 && $got['room']['items'] == $b['items'] && $got['room']['style'] == $b['style'] && $got['room']['public'] === false
        ? true : json_encode([$r, $got]);
});
check('save — the version rule: made from the stored version → next version; made from an older one → 409 ROOM_STALE with the stored version, nothing changed', function () use ($U2) {
    $b2 = body([['i' => 'F_SOBAN', 'x' => 2.0, 'y' => 0, 'z' => -1.0, 'r' => 6]], ['v' => 1, 'public' => true]);
    $r2 = Room::save($U2, $b2);
    $stale = apiCode(function () use ($U2) { Room::save($U2, body(null, ['v' => 1])); });
    $data = apiData(function () use ($U2) { Room::save($U2, body(null, ['v' => 0])); });
    $future = apiCode(function () use ($U2) { Room::save($U2, body(null, ['v' => 7])); });
    $got = Room::view($U2);
    return $r2 === ['v' => 2] && $stale === '409 ROOM_STALE' && $data === ['v' => 2] && $future === '409 ROOM_STALE' && $got['room']['v'] === 2 && count($got['room']['items']) === 1 && $got['room']['public'] === true
        ? true : json_encode([$r2, $stale, $data, $future, $got['room']['v']]);
});
check('save — a first save that does not say v 0 is stale too (data v 0); two saves from the same version: exactly one is taken', function () use ($ADM) {
    $first = apiCode(function () use ($ADM) { Room::save($ADM, body(null, ['v' => 3])); });
    $d = apiData(function () use ($ADM) { Room::save($ADM, body(null, ['v' => 3])); });
    $a = Room::save($ADM, body(null, ['v' => 0]));
    $b = apiCode(function () use ($ADM) { Room::save($ADM, body([], ['v' => 0])); });
    return $first === '409 ROOM_STALE' && $d === ['v' => 0] && $a === ['v' => 1] && $b === '409 ROOM_STALE' && count(Room::view($ADM)['room']['items']) === 2 ? true : json_encode([$first, $d, $a, $b]);
});
check('save — an account without a room is refused (403 ROOM_FORBIDDEN), nothing is stored, a security event is written', function () use ($U3) {
    $n0 = (int) Db::value("SELECT COUNT(*) FROM security_events WHERE kind = 'room_forbidden'");
    $c = apiCode(function () use ($U3) { Room::save($U3, body()); });
    $n1 = (int) Db::value("SELECT COUNT(*) FROM security_events WHERE kind = 'room_forbidden'");
    return $c === '403 ROOM_FORBIDDEN' && Db::value('SELECT user_id FROM user_rooms WHERE user_id = ?', [(int) $U3['id']]) === null && $n1 === $n0 + 1 ? true : "$c, events $n0 → $n1";
});
check('save — the limit of the account: 80 things are taken, 81 are 400 ROOM_LIMIT (data.limit 80); an administrator may place 160, never more than 200', function () use ($U1, $ADM) {
    $many = function (int $n): array { $o = []; for ($k = 0; $k < $n; $k++) $o[] = ['i' => 'G_GONGGI', 'x' => -6.5 + ($k % 50) * 0.25, 'y' => 0, 'z' => -5.0 + intdiv($k, 50) * 0.25, 'r' => 0]; return $o; };
    $v = Room::view($U1)['room']['v'];
    $ok = Room::save($U1, body($many(80), ['v' => $v]));
    $over = apiCode(function () use ($U1, $many, $ok) { Room::save($U1, body($many(81), ['v' => $ok['v']])); });
    $lim = apiData(function () use ($U1, $many, $ok) { Room::save($U1, body($many(81), ['v' => $ok['v']])); });
    $av = Room::view($ADM)['room']['v'];
    $a160 = Room::save($ADM, body($many(160), ['v' => $av]));
    $a161 = apiCode(function () use ($ADM, $many, $a160) { Room::save($ADM, body($many(161), ['v' => $a160['v']])); });
    $hard = apiCode(function () use ($many) { Room::validate(body($many(201)), 100000); });
    return $ok['v'] === $v + 1 && $over === '400 ROOM_LIMIT' && $lim === ['limit' => 80] && $a160['v'] === $av + 1 && $a161 === '400 ROOM_LIMIT' && $hard === '400 ROOM_LIMIT'
        ? true : json_encode([$ok, $over, $lim, $a160, $a161, $hard]);
});
check('save — the largest room the rules allow (200 of the longest rows) stays under 24 KB', function () {
    $o = [];
    for ($k = 0; $k < 100; $k++) $o[] = ['i' => 'A_SCROLL_OFFICIALS', 'x' => -5.875, 'y' => 1.55, 'z' => -5.5, 'r' => 0];
    for ($k = 0; $k < 100; $k++) $o[] = ['i' => 'J_JUNGDURI', 'x' => -5.875, 'y' => 0, 'z' => -4.625, 'r' => 23, 's' => 2, 'c' => 5];
    $c = Room::validate(body($o), 200);
    $len = strlen(json_encode(['style' => $c['style'], 'items' => $c['items']]));
    return $len < Room::MAX_BYTES ? true : "$len bytes";
});

// =============================================================================================== 4 · the validation matrix
$BAD = [];
$one = function (array $it) { return body([$it]); };
$ok0 = ['i' => 'F_SOBAN', 'x' => 2.0, 'y' => 0, 'z' => -1.0, 'r' => 0];
$with = function (array $over, array $drop = []) use ($ok0, $one) { $it = $ok0; foreach ($over as $k => $v) $it[$k] = $v; foreach ($drop as $k) unset($it[$k]); return $one($it); };
// ---- containers
$BAD['items is a text'] = body(null, ['items' => 'F_SOBAN']);
$BAD['items is an object'] = body(null, ['items' => ['a' => $ok0]]);
$BAD['items is null'] = body(null, ['items' => null]);
$BAD['a thing is a text'] = body(['<script>alert(1)</script>']);
$BAD['a thing is a list'] = body([['F_SOBAN', 2, 0, -1, 0]]);
$BAD['a thing is empty'] = body([[]]);
$BAD['a thing is a number'] = body([7]);
$BAD['a thing carries a field nobody knows'] = $with(['name' => '<img src=x onerror=alert(1)>']);
$BAD['a thing carries __proto__'] = $with(['__proto__' => ['x' => 1]]);
// ---- the id
$BAD['no id'] = $with([], ['i']);
$BAD['id is a number'] = $with(['i' => 12]);
$BAD['id is an array'] = $with(['i' => ['F_SOBAN']]);
$BAD['an unknown id'] = $with(['i' => 'F_SPACESHIP']);
$BAD['id in small letters'] = $with(['i' => 'f_soban']);
$BAD['id with a path'] = $with(['i' => '../../etc/passwd']);
$BAD['id with markup'] = $with(['i' => '<svg onload=alert(1)>']);
$BAD['id with SQL'] = $with(['i' => "F_SOBAN'; DROP TABLE user_rooms;--"]);
$BAD['id 300 letters long'] = $with(['i' => str_repeat('A', 300)]);
$BAD['id with a NUL'] = $with(['i' => "F_SOBAN\0"]);
// ---- numbers
$BAD['x as a text'] = $with(['x' => '2']);
$BAD['x is true'] = $with(['x' => true]);
$BAD['x is null'] = $with(['x' => null]);
$BAD['x is an array'] = $with(['x' => [2]]);
$BAD['x is infinite'] = $with(['x' => INF]);
$BAD['x is not a number (NAN)'] = $with(['x' => NAN]);
$BAD['x is huge'] = $with(['x' => 1.0e308]);
$BAD['x off the grid'] = $with(['x' => 2.1]);
$BAD['x outside the room'] = $with(['x' => 7.5]);
$BAD['x far outside'] = $with(['x' => -4000.0]);
$BAD['z missing'] = $with([], ['z']);
$BAD['z outside the room'] = $with(['z' => -6.0]);
$BAD['z off the grid'] = $with(['z' => -1.06]);
$BAD['y below the floor'] = $with(['y' => -0.5]);
$BAD['y above the roof'] = $with(['y' => 50]);
$BAD['a floor thing in the air'] = $with(['y' => 0.5]);
$BAD['y as a text'] = $with(['y' => '0']);
$BAD['a small thing higher than any top'] = body([['i' => 'J_DANJI', 'x' => 2.0, 'y' => 2.3, 'z' => -1.0, 'r' => 0]]);
$BAD['a small thing at a height off the grid'] = body([['i' => 'J_DANJI', 'x' => 2.0, 'y' => 0.81234, 'z' => -1.0, 'r' => 0]]);
$BAD['r is 24'] = $with(['r' => 24]);
$BAD['r is negative'] = $with(['r' => -1]);
$BAD['r is a fraction'] = $with(['r' => 1.5]);
$BAD['r as a text'] = $with(['r' => '6']);
$BAD['r missing'] = $with([], ['r']);
// ---- size and colour
$BAD['a size on a thing that has none'] = $with(['s' => 2]);
$BAD['size 1 written out'] = body([['i' => 'J_DANJI', 'x' => 2.0, 'y' => 0, 'z' => -1.0, 'r' => 0, 's' => 1]]);
$BAD['size 3'] = body([['i' => 'J_DANJI', 'x' => 2.0, 'y' => 0, 'z' => -1.0, 'r' => 0, 's' => 3]]);
$BAD['size as a text'] = body([['i' => 'J_DANJI', 'x' => 2.0, 'y' => 0, 'z' => -1.0, 'r' => 0, 's' => '2']]);
$BAD['a colour on a thing without colours'] = body([['i' => 'J_SIRU', 'x' => 2.0, 'y' => 0, 'z' => -1.0, 'r' => 0, 'c' => 0]]);
$BAD['a colour past the palette'] = body([['i' => 'J_DANJI', 'x' => 2.0, 'y' => 0, 'z' => -1.0, 'r' => 0, 'c' => 6]]);
$BAD['a negative colour'] = body([['i' => 'J_DANJI', 'x' => 2.0, 'y' => 0, 'z' => -1.0, 'r' => 0, 'c' => -1]]);
$BAD['a colour as a css text'] = body([['i' => 'J_DANJI', 'x' => 2.0, 'y' => 0, 'z' => -1.0, 'r' => 0, 'c' => 'red;background:url(//evil)']]);
// ---- where things may be
$BAD['a thing in the way of the door'] = $with(['x' => 0.0, 'z' => 4.0]);
$BAD['a thing reaching into the way of the door'] = $with(['x' => 1.75, 'z' => 3.0]);
$BAD['a thing through the wall'] = $with(['x' => 6.875]);
$BAD['a long thing turned out of the room'] = body([['i' => 'A_SCREEN_BOOKS', 'x' => 6.0, 'y' => 0, 'z' => 0.0, 'r' => 0]]);
$BAD['a turned thing whose corner leaves the room'] = body([['i' => 'F_SANG', 'x' => 6.125, 'y' => 0, 'z' => 0.0, 'r' => 3]]);
$BAD['a wall thing in the middle of the room'] = body([['i' => 'W_FAN', 'x' => 0.0, 'y' => 1.6, 'z' => 0.0, 'r' => 0]]);
$BAD['a wall thing on the north wall with the turn of the east wall'] = body([['i' => 'W_FAN', 'x' => 0.0, 'y' => 1.6, 'z' => -5.5, 'r' => 18]]);
$BAD['a wall thing with a turn that is no wall'] = body([['i' => 'W_FAN', 'x' => 0.0, 'y' => 1.6, 'z' => -5.5, 'r' => 3]]);
$BAD['a wall thing above the wall'] = body([['i' => 'W_FAN', 'x' => 0.0, 'y' => 2.45, 'z' => -5.5, 'r' => 0]]);
$BAD['a wall thing on the floor'] = body([['i' => 'W_FAN', 'x' => 0.0, 'y' => 0.0, 'z' => -5.5, 'r' => 0]]);
$BAD['a wall thing past the corner'] = body([['i' => 'W_JOGAKBO_L', 'x' => 6.75, 'y' => 1.6, 'z' => -5.5, 'r' => 0]]);
$BAD['a hanging thing with a height'] = body([['i' => 'L_CHORONG_H', 'x' => 0.0, 'y' => 1.0, 'z' => 0.0, 'r' => 0]]);
// ---- style, public, version
$BAD['no style'] = body(null, ['style' => null]);
$BAD['style is a list'] = body(null, ['style' => ['jangpan', 'plaster', 'warm', 'day', '000000000000000000']]);
$st = body()['style'];
$BAD['style without a floor'] = body(null, ['style' => array_diff_key($st, ['floor' => 1])]);
$BAD['a floor nobody knows'] = body(null, ['style' => ['floor' => 'lava'] + $st]);
$BAD['a floor that is markup'] = body(null, ['style' => ['floor' => '"><script>'] + $st]);
$BAD['a mood as a number'] = body(null, ['style' => ['mood' => 1] + $st]);
$BAD['a style field nobody knows'] = body(null, ['style' => $st + ['roof' => 'gold']]);
$BAD['17 windows'] = body(null, ['style' => ['win' => '00000066010001000'] + $st]);
$BAD['19 windows'] = body(null, ['style' => ['win' => '0000006601000100000'] + $st]);
$BAD['a window kind 7'] = body(null, ['style' => ['win' => '700000660100010000'] + $st]);
$BAD['windows in letters'] = body(null, ['style' => ['win' => 'aaaaaaaaaaaaaaaaaa'] + $st]);
$BAD['a window where the door is'] = body(null, ['style' => ['win' => '000000660103010000'] + $st]);
$BAD['windows as a number'] = body(null, ['style' => ['win' => 660100010000] + $st]);
$BAD['public as a text'] = body(null, ['public' => 'true']);
$BAD['public as 1'] = body(null, ['public' => 1]);
$BAD['public is null'] = body(null, ['public' => null]);
check('validate — hostile and broken rooms are refused, every one with 400 ROOM_INVALID (' . count($BAD) . ' cases)', function () use ($BAD) {
    $wrong = [];
    foreach ($BAD as $name => $b) { $c = apiCode(function () use ($b) { Room::validate($b, 80); }); if ($c !== '400 ROOM_INVALID') $wrong[] = "$name → " . ($c === '' ? 'accepted' : $c); }
    return $wrong === [] ? true : implode(' · ', $wrong);
});
check('validate — the answer names the field in harmless characters only (never a piece of what was sent)', function () use ($with) {
    $d = apiData(function () use ($with) { Room::validate($with(['i' => '<svg onload=alert(1)>']), 80); });
    $d2 = apiData(function () { Room::validate(body(null, ['style' => ['floor' => '"><script>'] + body()['style']]), 80); });
    return $d === ['field' => 'items[0].i'] && $d2 === ['field' => 'style.floor'] ? true : json_encode([$d, $d2]);
});
check('save — the version must be a whole number from 0 (INVALID_INPUT otherwise)', function () use ($U2) {
    $bad = [];
    foreach ([-1, 1.5, null, 'abc', '1', [1], true, 3000000000] as $v) { $c = apiCode(function () use ($U2, $v) { Room::save($U2, body(null, ['v' => $v])); }); if ($c !== '400 INVALID_INPUT') $bad[] = json_encode($v) . " → $c"; }
    return $bad === [] ? true : implode(' · ', $bad);
});
$GOOD = [];
$GOOD['an empty room'] = body([]);
$GOOD['a thing right at the wall (pad 0.12)'] = body([['i' => 'F_SOBAN', 'x' => 6.625, 'y' => 0, 'z' => -5.125, 'r' => 0]]);
$GOOD['a thing right beside the way to the door'] = body([['i' => 'F_SOBAN', 'x' => 1.875, 'y' => 0, 'z' => 4.0, 'r' => 0]]);
$GOOD['a rug across the way to the door'] = body([['i' => 'R_HWAMUN', 'x' => 0.0, 'y' => 0, 'z' => 4.0, 'r' => 0]]);
$GOOD['a hanging thing above the door way'] = body([['i' => 'L_CHORONG_H', 'x' => 0.0, 'y' => 0, 'z' => 4.0, 'r' => 9]]);
$GOOD['wall things on all four walls'] = body([['i' => 'W_FAN', 'x' => 0.0, 'y' => 1.6, 'z' => -5.5, 'r' => 0], ['i' => 'W_FAN', 'x' => 7, 'y' => 1.6, 'z' => 1.0, 'r' => 18], ['i' => 'W_FAN', 'x' => -4.0, 'y' => 1.6, 'z' => 5.5, 'r' => 12], ['i' => 'W_FAN', 'x' => -7, 'y' => 1.6, 'z' => -1.0, 'r' => 6]]);
$GOOD['a small thing on a top, in a colour and a size'] = body();
$GOOD['numbers as whole numbers or fractions'] = body([['i' => 'F_SOBAN', 'x' => 2, 'y' => 0.0, 'z' => -1, 'r' => 23], ['i' => 'F_SOBAN', 'x' => -2.125, 'z' => 1.875, 'r' => 7]]);
$GOOD['every window kind'] = body([], ['style' => ['win' => '123456123450123456'] + body()['style']]);
$GOOD['the last colour of the palette'] = body([['i' => 'S_BANGSEOK', 'x' => 2.0, 'y' => 0, 'z' => -1.0, 'r' => 0, 'c' => 15, 's' => 2]]);
check('validate — rooms that are right are taken as they are (' . count($GOOD) . ' cases)', function () use ($GOOD) {
    $wrong = [];
    foreach ($GOOD as $name => $b) { try { $c = Room::validate($b, 80); if (count($c['items']) !== count($b['items'])) $wrong[] = "$name: things lost"; } catch (ApiException $e) { $wrong[] = "$name → " . $e->errorCode . ' ' . json_encode($e->data); } }
    return $wrong === [] ? true : implode(' · ', $wrong);
});
check('validate — every room the client\'s own rules produce is accepted: the 3 ready-made rooms and 300 random rooms through sanitize()', function () use ($FX) {
    $wrong = []; $things = 0;
    foreach ($FX['rooms'] as $f) {
        $r = $f['room'];
        try { $c = Room::validate(['v' => 0, 'style' => $r['style'], 'items' => $r['items'], 'public' => $r['public']], 200); $things += count($c['items']); }
        catch (ApiException $e) { $wrong[] = $f['name'] . ' → ' . $e->errorCode . ' ' . json_encode($e->data); if (count($wrong) > 6) break; }
    }
    echo "      (" . count($FX['rooms']) . " rooms, $things things)" . PHP_EOL;
    return $wrong === [] && $things > 3000 ? true : implode(' · ', $wrong) . " ($things things)";
});
check('validate — without the catalogue (an old game-data.json) nothing is taken: 503 ROOM_UNAVAILABLE', function () use ($srv) {
    $file = $srv . '/data/game-data.json';
    $keep = (string) file_get_contents($file);
    $d = json_decode($keep, true); unset($d['myroom']);
    // GameData reads the file once per process: the room table is asked from a second process
    file_put_contents($file, json_encode($d));
    $code = 'putenv("TFM_DATA_DIR=' . addslashes((string) getenv('TFM_DATA_DIR')) . '"); require ' . var_export($srv . '/lib/bootstrap.php', true) . '; try { Tfm\\Room::validate(["style" => [], "items" => [], "public" => false], 80); echo "accepted"; } catch (Tfm\\ApiException $e) { echo $e->status . " " . $e->errorCode . " ready=" . (Tfm\\Room::ready() ? 1 : 0); }';
    $out = (string) shell_exec(escapeshellarg(PHP_BINARY) . ' -r ' . escapeshellarg($code) . ' 2>&1');
    file_put_contents($file, $keep);
    return trim($out) === '503 ROOM_UNAVAILABLE ready=0' ? true : $out;
});

// =============================================================================================== 5 · another account's room
check('view — another account\'s room: only a public room of an account that still has one; everything else is the same 404', function () use ($ADM, $U1, $U2, $U3) {
    $u2 = (int) $U2['id']; $u1 = (int) $U1['id'];
    $pub = Room::view($U3, $u2);                                                  // U2 saved public = true above
    $priv = apiCode(function () use ($U3, $u1) { Room::view($U3, $u1); });        // U1's room is not public
    $none = apiCode(function () use ($U3) { Room::view($U3, 987654321); });       // no such account
    $empty = apiCode(function () use ($ADM, $U3) { Room::view($ADM, (int) $U3['id']); });   // an account without a room (an administrator asks)
    // U1 opens the room, then loses the right: the room is closed for visitors too
    $v = Room::view($U1)['room']['v'];
    Room::save($U1, body([], ['v' => $v, 'public' => true]));
    $open = Room::view($U3, $u1)['mine'];
    Room::grant($u1, false, (int) $ADM['id']);
    $closed = apiCode(function () use ($U3, $u1) { Room::view($U3, $u1); });
    Room::grant($u1, true, (int) $ADM['id']);
    return $pub['mine'] === false && $pub['can'] === false && $pub['limit'] === 0 && count($pub['room']['items']) === 1 && $priv === '404 NOT_FOUND' && $none === '404 NOT_FOUND' && $empty === '404 NOT_FOUND'
        && $open === false && $closed === '404 NOT_FOUND' ? true : json_encode([$pub['mine'], $priv, $none, $empty, $open, $closed]);
});
check('view — asking for one\'s own id is one\'s own room (mine true), also when it is not public', function () use ($U1) {
    $r = Room::view($U1, (int) $U1['id']);
    return $r['mine'] === true && $r['can'] === true;
});
check('view — a damaged stored row reads as an empty room and the next save repairs it', function () use ($U1) {
    $uid = (int) $U1['id'];
    Db::exec("UPDATE user_rooms SET data = '{not json' WHERE user_id = ?", [$uid]);
    $r = Room::view($U1);
    $s = Room::save($U1, body(null, ['v' => $r['room']['v']]));
    return $r['room']['items'] === [] && count(Room::view($U1)['room']['items']) === 2 && $s['v'] === $r['room']['v'] + 1;
});
check('counts — rooms decorated at least once, rooms given directly, public rooms', function () {
    $c = Room::counts();
    return $c['rooms'] >= 3 && $c['granted'] === 1 && $c['public'] >= 1 ? true : json_encode($c);
});

// =============================================================================================== 6 · a room inside a game save
check('checkEmbedded — nothing, an empty room and a decorated local room are fine; text, wrong containers and unknown fields are named', function () use ($FX) {
    $fine = [null, ['v' => 0, 'style' => [], 'items' => [], 'public' => false], $FX['sample'], json_decode(json_encode($FX['sample']))];
    foreach ($fine as $k => $v) { $r = Room::checkEmbedded($v); if ($r !== null) return "fine #$k → $r"; }
    $bad = ['a text' => 'room', 'items as a text' => ['items' => 'x'], 'a thing as a text' => ['items' => ['F_SOBAN']], 'markup as an id' => ['items' => [['i' => '<script>', 'x' => 0]]],
        'an unknown field' => ['items' => [['i' => 'F_SOBAN', 'note' => 'hello']]], 'a number as a text' => ['items' => [['i' => 'F_SOBAN', 'x' => '1']]], 'a huge number' => ['items' => [['i' => 'F_SOBAN', 'x' => 1e12]]],
        'too many things' => ['items' => array_fill(0, 201, ['i' => 'F_SOBAN', 'x' => 0, 'z' => 0, 'r' => 0])], 'a style in words with markup' => ['style' => ['floor' => '<b>'], 'items' => []],
        'a long style word' => ['style' => ['floor' => str_repeat('a', 40)], 'items' => []]];
    foreach ($bad as $name => $v) { if (Room::checkEmbedded($v) === null) return "accepted: $name"; }
    return true;
});

// =============================================================================================== 7 · 10,000 rooms
check('scale — with ' . ((int) (getenv('TFM_ROOM_ROWS') ?: 10000)) . ' rooms in the table: reading one is a primary-key read, saving one is one statement; both stay fast', function () use ($FX, $IS_MYSQL, $U2) {
    $N = max(1000, (int) (getenv('TFM_ROOM_ROWS') ?: 10000));
    $sample = $FX['sample'];
    $data = json_encode(['style' => $sample['style'], 'items' => $sample['items']]);
    $now = Tfm\Clock::ms();
    $base = 5000000;
    $t0 = microtime(true);
    Db::tx(function () use ($N, $data, $now, $base) {
        for ($k = 0; $k < $N; $k += 200) {
            $rows = []; $args = [];
            for ($j = $k; $j < min($N, $k + 200); $j++) { $rows[] = '(?, 1, ?, ?, 0, 0, ?)'; array_push($args, $base + $j, $data, $j % 7 === 0 ? 1 : 0, $now); }
            Db::exec('INSERT INTO user_rooms (user_id, v, data, public, granted, granted_at, updated_at) VALUES ' . implode(', ', $rows), $args);
        }
    });
    $fill = microtime(true) - $t0;
    $total = (int) Db::value('SELECT COUNT(*) FROM user_rooms');
    // the plan of the read
    $plan = '';
    if ($IS_MYSQL) { $ex = Db::one('EXPLAIN SELECT v, data, public FROM user_rooms WHERE user_id = ?', [$base + 4242]); $plan = (string) $ex['type'] . '/' . (string) $ex['key'] . '/rows ' . (string) $ex['rows']; }
    else { $ex = Db::all('EXPLAIN QUERY PLAN SELECT v, data, public FROM user_rooms WHERE user_id = ?', [$base + 4242]); $plan = (string) $ex[0]['detail']; }
    $planOk = $IS_MYSQL ? (strpos($plan, 'const/PRIMARY') === 0) : (stripos($plan, 'PRIMARY KEY') !== false || stripos($plan, 'USING INDEX') !== false || stripos($plan, 'rowid') !== false);
    // 500 reads of random rooms (the statement get.php runs), then the whole view of a real account, then 300 saves
    mt_srand(7);
    $t0 = microtime(true);
    for ($k = 0; $k < 500; $k++) { $r = Db::one('SELECT v, data, public FROM user_rooms WHERE user_id = ?', [$base + mt_rand(0, $N - 1)]); if (!$r) return 'a row is missing'; }
    $read = (microtime(true) - $t0) / 500 * 1000;
    Room::view($U2);
    $before = Db::stats()['statements'];
    $t0 = microtime(true);
    for ($k = 0; $k < 300; $k++) Room::view($U2);
    $view = (microtime(true) - $t0) / 300 * 1000;
    $perView = (Db::stats()['statements'] - $before) / 300;
    $body = ['v' => 0, 'style' => $sample['style'], 'items' => $sample['items'], 'public' => false];
    $tv = microtime(true);
    for ($k = 0; $k < 300; $k++) Room::validate($body, 200);
    $val = (microtime(true) - $tv) / 300 * 1000;
    $t0 = microtime(true);
    for ($k = 0; $k < 300; $k++) { if (Db::exec('UPDATE user_rooms SET v = v + 1, data = ?, public = ?, updated_at = ? WHERE user_id = ? AND v = ?', [$data, 0, $now, $base + $k, 1]) !== 1) return 'a save was not taken'; }
    $write = (microtime(true) - $t0) / 300 * 1000;
    $bytes = strlen($data);
    echo sprintf("      (%d rows of %d bytes filled in %.1f s · plan: %s · read %.3f ms · Room::view %.3f ms with %.2f statements · validate %d things %.3f ms · save statement %.3f ms)", $total, $bytes, $fill, $plan, $read, $view, $perView, count($sample['items']), $val, $write) . PHP_EOL;
    Db::exec('DELETE FROM user_rooms WHERE user_id >= ?', [$base]);
    return $total >= $N && $planOk && $read < 5 && $view < 8 && $perView <= 1.01 && $val < 5 && $write < 25 ? true : sprintf('plan %s, read %.3f ms, view %.3f ms (%.2f statements), validate %.3f ms, write %.3f ms', $plan, $read, $view, $perView, $val, $write);
});

echo PHP_EOL . "passed $passed, failed $failed" . PHP_EOL;
// tidy up the private copy (the MariaDB database is left to its owner)
$rm = function (string $d) use (&$rm) { foreach (scandir($d) ?: [] as $f) { if ($f === '.' || $f === '..') continue; $p = "$d/$f"; if (is_dir($p) && !is_link($p)) $rm($p); else @unlink($p); } @rmdir($d); };
try { Db::reset(); } catch (Throwable $e) { /* closing */ }
$rm($root);
exit($failed ? 1 : 0);
