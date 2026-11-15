<?php
/**
 * Tfm\Room — 내 방 (CONTRACT §17.4): one decorated room per account, for up to 10,000 allotment holders.
 *
 * WHO HAS A ROOM: an administrator, the holder of a live allotment contract (the operator names the person in
 *   🏺 분양 관리), or an account the operator gave a room directly (user_rooms.granted = 1). The answer is
 *   Tfm\Entitle's features.myroom — one truth for the app, the admin site and this library.
 * WHAT A ROOM IS: numbers and catalogue ids only — nothing anybody typed:
 *     { v, style: { floor, wall, wood, mood, win }, items: [{ i, x, y, z, r, s?, c? }], public }
 *   The catalogue (ids, placing kinds, sizes, palettes, the room's measures, limits) comes from data/game-data.json
 *   (`myroom`, exported from src/game/76-myroom-data.js). Every thing of a save is checked against it: a known id, numbers
 *   on the grid and inside the room, a wall thing on its wall, nothing in the keep-clear zone before the door, at most
 *   as many things as the account's entitlement allows. Things may overlap (the editor forbids it; the server does not
 *   need to: an overlap harms nobody).
 * STORAGE: table user_rooms (schema v8) — one row per account, `data` = the validated JSON (≤ 24 KB), `v` = a version
 *   counter. A save names the version it was made from; it is taken only when that is still the stored one
 *   (compare-and-set in ONE statement), and answers the next version. Otherwise 409 ROOM_STALE with the stored version.
 *
 *   Room::ready(): bool                              the catalogue is in this build's game-data.json
 *   Room::rights(array $user, bool $fresh): array    [can, limit] — cached for a minute unless $fresh
 *   Room::view(array $user, ?int $ownerId): array    api/room/get.php  → { room, mine, can, limit }
 *   Room::save(array $user, array $body): array      api/room/save.php → { v }
 *   Room::validate(array $body, int $limit): array   → ['style' => …, 'items' => …, 'public' => bool] | ApiException 400
 *   Room::grant(int $uid, bool $on, int $actorId): bool     the operator gives / takes back a room (audited)
 *   Room::status(int $uid): array                    for the admin site: { granted, grantedAt, contract, has, things, v, updatedAt, public }
 *   Room::counts(): array                            { rooms, granted, public }
 *   Room::checkEmbedded($v): ?string                 a `myroom` block inside a game save: null = fine, else what is wrong
 * PHP 7.2 syntax only.
 */
declare(strict_types=1);

namespace Tfm;

if (!defined('TFM_BOOT')) { if (function_exists('header_remove')) header_remove('X-Powered-By'); http_response_code(404); exit; }

final class Room
{
    /** things in one room at the very most (the catalogue's limits.hard; an entitlement above it is cut to it) */
    public const HARD = 200;
    /** bytes of one stored room */
    public const MAX_BYTES = 24576;
    private const ID_RE = '/^[A-Z][A-Z0-9_]{1,23}$/';
    private const EPS = 1e-6;
    /** the quarter turn of a wall thing → its wall */
    private const R_SIDE = [0 => 'N', 6 => 'W', 12 => 'S', 18 => 'E'];

    /** @var array|null the catalogue table of this request */
    private static $table = null;

    /** the catalogue as game-data.json has it ([] when this build has none) */
    public static function table(): array
    {
        if (self::$table !== null) return self::$table;
        $all = GameData::all();
        $t = isset($all['myroom']) && is_array($all['myroom']) ? $all['myroom'] : [];
        $ok = isset($t['items'], $t['room'], $t['styles']) && is_array($t['items']) && is_array($t['room']) && is_array($t['styles']) && count($t['items']) > 0
            && isset($t['room']['w'], $t['room']['d'], $t['room']['h'], $t['room']['ceil'], $t['room']['pad'], $t['room']['fine'], $t['room']['wallV'], $t['room']['keep']);
        self::$table = $ok ? $t : [];
        return self::$table;
    }

    public static function ready(): bool { return self::table() !== []; }

    /** tests: forget the catalogue read for this request */
    public static function reset(): void { self::$table = null; }

    // ------------------------------------------------------------------ who, and how much

    /**
     * [may this account have a room, how many things fit]. $fresh = false: the answer may be a minute old (shared
     * cache) — enough for reading; a save always asks afresh.
     */
    public static function rights(array $user, bool $fresh = false): array
    {
        $uid = (int) (isset($user['id']) ? $user['id'] : 0);
        if ($uid <= 0) return [false, 0];
        $admin = (isset($user['role']) ? $user['role'] : '') === 'admin';
        $key = 'room:r:' . $uid;
        if (!$fresh) {
            $hit = Cache::get($key);
            if (is_array($hit) && isset($hit['c'], $hit['l'], $hit['a']) && (bool) $hit['a'] === $admin) return [(bool) $hit['c'], (int) $hit['l']];
        }
        if (class_exists('Tfm\\Entitle')) {
            $ent = Entitle::forUser($user);
            $can = !empty($ent['features']['myroom']);
            $limit = (int) (isset($ent['limits']['roomItems']) ? $ent['limits']['roomItems'] : 0);
        } else {
            $can = $admin || self::holdsContract($uid) || self::isGranted($uid);
            $limit = (int) Settings::get('limits.room_items_free', 80);
        }
        $limit = max(0, min(self::HARD, $limit));
        Cache::set($key, ['c' => $can, 'l' => $limit, 'a' => $admin], 60);
        return [$can, $limit];
    }

    private static function holdsContract(int $uid): bool
    {
        try { return Db::value("SELECT id FROM allot_contracts WHERE user_id = ? AND status IN ('active', 'overdue') LIMIT 1", [$uid]) !== null; }
        catch (\Throwable $e) { return false; }
    }

    private static function isGranted(int $uid): bool
    {
        try { $g = Db::value('SELECT granted FROM user_rooms WHERE user_id = ?', [$uid]); return $g !== null && (int) $g === 1; }
        catch (\Throwable $e) { return false; }
    }

    // ------------------------------------------------------------------ reading

    /** a stored row → the room a client draws */
    private static function shape(?array $row): array
    {
        $style = new \stdClass();
        $items = [];
        if ($row && isset($row['data']) && is_string($row['data']) && $row['data'] !== '') {
            try {
                $d = Json::decode($row['data'], true, 8);
                if (is_array($d)) {
                    if (isset($d['style']) && is_array($d['style']) && $d['style'] !== []) $style = $d['style'];
                    if (isset($d['items']) && is_array($d['items'])) $items = array_values($d['items']);
                }
            } catch (\Throwable $e) { /* a damaged row reads as an empty room; the next save repairs it */ }
        }
        return ['v' => $row ? (int) $row['v'] : 0, 'style' => $style, 'items' => $items, 'public' => $row ? (int) $row['public'] === 1 : false];
    }

    /**
     * api/room/get.php. Own room: { room, mine: true, can, limit } (one primary-key read; an account without a room yet
     * gets an empty one). Another account's room ($ownerId): only when its holder made it public and still has a room
     * — everything else is the same 404 (no way to find out which accounts exist).
     */
    public static function view(array $user, ?int $ownerId = null): array
    {
        $uid = (int) (isset($user['id']) ? $user['id'] : 0);
        if ($ownerId !== null && $ownerId !== $uid) {
            $row = Db::one('SELECT v, data, public FROM user_rooms WHERE user_id = ? AND public = 1', [$ownerId]);
            $owner = $row ? Users::byId($ownerId) : null;
            if (!$row || !$owner || (isset($owner['status']) ? $owner['status'] : '') !== 'active' || !self::rights($owner)[0]) throw new ApiException(404, 'NOT_FOUND', '그런 방이 없어요.');
            return ['room' => self::shape($row), 'mine' => false, 'can' => false, 'limit' => 0];
        }
        $row = Db::one('SELECT v, data, public FROM user_rooms WHERE user_id = ?', [$uid]);
        $r = self::rights($user);
        return ['room' => self::shape($row), 'mine' => true, 'can' => $r[0], 'limit' => $r[1]];
    }

    // ------------------------------------------------------------------ writing

    private static function bad(string $field, string $why = '값이 올바르지 않아요.')
    {
        $f = (string) preg_replace('/[^A-Za-z0-9_.\-\[\]]/', '', $field);
        throw new ApiException(400, 'ROOM_INVALID', '방을 저장할 수 없어요. ' . $why, ['field' => substr($f === '' ? '?' : $f, 0, 40)]);
    }

    /** a finite JSON number (never a string, a bool, INF or NAN) */
    private static function numOf($v, string $field): float
    {
        if ((!is_int($v) && !is_float($v)) || !is_finite((float) $v)) self::bad($field);
        return (float) $v;
    }

    private static function onGrid(float $v, float $step): bool
    {
        $q = $v / $step;
        return abs($q - round($q)) < 1e-6;
    }

    /**
     * Check a room a client sent against the catalogue. Returns the clean room (values as they are stored); throws
     * ApiException 400 ROOM_INVALID (data: { field }) or ROOM_LIMIT (data: { limit }).
     */
    public static function validate(array $body, int $limit): array
    {
        $t = self::table();
        if ($t === []) throw new ApiException(503, 'ROOM_UNAVAILABLE', '지금은 방을 저장할 수 없어요.');
        $R = $t['room'];
        $hw = (float) $R['w'] / 2; $hd = (float) $R['d'] / 2; $fine = (float) $R['fine']; $pad = (float) $R['pad'];
        $wallV = [(float) $R['wallV'][0], (float) $R['wallV'][1]];
        $keep = $R['keep'];
        $sizes = isset($t['sizes']) && is_array($t['sizes']) && count($t['sizes']) === 3 ? $t['sizes'] : [0.8, 1, 1.2];

        // ---- style: five known keys, every value from its list; the windows are 18 digits 0…6 (the door's bay is 0)
        $st = isset($body['style']) ? $body['style'] : null;
        if (!is_array($st) || ($st !== [] && Arr::isList($st))) self::bad('style');
        foreach ($st as $k => $unused) { if (!in_array((string) $k, ['floor', 'wall', 'wood', 'mood', 'win'], true)) self::bad('style'); }
        $style = [];
        foreach (['floor', 'wall', 'wood', 'mood'] as $k) {
            $list = isset($t['styles'][$k]) && is_array($t['styles'][$k]) ? $t['styles'][$k] : [];
            if (!isset($st[$k]) || !is_string($st[$k]) || !in_array($st[$k], $list, true)) self::bad('style.' . $k);
            $style[$k] = $st[$k];
        }
        $winLen = (int) (isset($t['styles']['winLen']) ? $t['styles']['winLen'] : 18);
        $winDoor = (int) (isset($t['styles']['winDoor']) ? $t['styles']['winDoor'] : 11);
        if (!isset($st['win']) || !is_string($st['win']) || strlen($st['win']) !== $winLen || !preg_match('/^[0-6]+$/', $st['win']) || $st['win'][$winDoor] !== '0') self::bad('style.win');
        $style['win'] = $st['win'];

        // ---- public: a real boolean
        if (!array_key_exists('public', $body) || !is_bool($body['public'])) self::bad('public');

        // ---- things
        $src = isset($body['items']) ? $body['items'] : null;
        if (!is_array($src) || ($src !== [] && !Arr::isList($src))) self::bad('items');
        if (count($src) > self::HARD || count($src) > $limit) {
            throw new ApiException(400, 'ROOM_LIMIT', '방에 놓을 수 있는 것보다 많아요.', ['limit' => max(0, min(self::HARD, $limit))]);
        }
        $items = [];
        foreach ($src as $n => $it) {
            $f = 'items[' . $n . ']';
            if (!is_array($it) || $it === [] || Arr::isList($it)) self::bad($f);
            foreach ($it as $k => $unused) { if (!in_array((string) $k, ['i', 'x', 'y', 'z', 'r', 's', 'c'], true)) self::bad($f); }
            $id = isset($it['i']) ? $it['i'] : null;
            if (!is_string($id) || !preg_match(self::ID_RE, $id) || !isset($t['items'][$id]) || !is_array($t['items'][$id]) || count($t['items'][$id]) < 6) self::bad($f . '.i', '없는 물건이 들어 있어요.');
            $e = $t['items'][$id];
            $place = (string) $e[0];
            if (!isset($it['x'], $it['z'], $it['r'])) self::bad($f);
            $x = self::numOf($it['x'], $f . '.x'); $z = self::numOf($it['z'], $f . '.z');
            $y = array_key_exists('y', $it) ? self::numOf($it['y'], $f . '.y') : 0.0;
            if (!is_int($it['r']) || $it['r'] < 0 || $it['r'] > 23) self::bad($f . '.r');
            $r = $it['r'];
            if (abs($x) > $hw + self::EPS || abs($z) > $hd + self::EPS || !self::onGrid($x, $fine) || !self::onGrid($z, $fine)) self::bad($f . '.x');
            if ($y < 0 || $y > (float) $R['h'] || !self::onGrid($y, 0.001)) self::bad($f . '.y');
            $k = 1.0;
            $out = ['i' => $id, 'x' => $it['x'], 'y' => array_key_exists('y', $it) ? $it['y'] : 0, 'z' => $it['z'], 'r' => $r];
            if (array_key_exists('s', $it)) {
                if ((int) $e[5] !== 1 || !is_int($it['s']) || ($it['s'] !== 0 && $it['s'] !== 2)) self::bad($f . '.s');
                $k = (float) $sizes[$it['s']];
                $out['s'] = $it['s'];
            }
            if (array_key_exists('c', $it)) {
                if (!is_int($it['c']) || $it['c'] < 0 || $it['c'] >= (int) $e[4]) self::bad($f . '.c');
                $out['c'] = $it['c'];
            }
            $w = (float) $e[1] * $k; $d = (float) $e[2] * $k; $h = (float) $e[3] * $k;
            if ($place === 'W') {
                // on the line of its wall, inside the wall's length, between the lowest and the highest hanging height
                $side = isset(self::R_SIDE[$r]) ? self::R_SIDE[$r] : '';
                $u = 0.0; $len = 0.0;
                if ($side === 'N' && abs($z + $hd) < self::EPS) { $u = $x + $hw; $len = 2 * $hw; }
                elseif ($side === 'E' && abs($x - $hw) < self::EPS) { $u = $z + $hd; $len = 2 * $hd; }
                elseif ($side === 'S' && abs($z - $hd) < self::EPS) { $u = $hw - $x; $len = 2 * $hw; }
                elseif ($side === 'W' && abs($x + $hw) < self::EPS) { $u = $hd - $z; $len = 2 * $hd; }
                else { self::bad($f, '벽에 거는 것이 벽에 있지 않아요.'); }
                if ($u - $w / 2 < 0.05 - self::EPS || $u + $w / 2 > $len - 0.05 + self::EPS) self::bad($f . '.x', '방 밖으로 나가 있어요.');
                if ($y - $h / 2 < $wallV[0] - self::EPS || $y + $h / 2 > $wallV[1] + self::EPS) self::bad($f . '.y');
            } else {
                // the turned footprint stays inside the walls; floor things keep the way to the door free
                $a = $r * M_PI / 12; $c = abs(cos($a)); $s = abs(sin($a));
                $ex = $c * $w / 2 + $s * $d / 2; $ez = $s * $w / 2 + $c * $d / 2;
                $p = $place === 'R' ? 0.05 : ($place === 'H' ? 0.1 : $pad);
                if ($x - $ex < -$hw + $p - self::EPS || $x + $ex > $hw - $p + self::EPS || $z - $ez < -$hd + $p - self::EPS || $z + $ez > $hd - $p + self::EPS) self::bad($f . '.x', '방 밖으로 나가 있어요.');
                if ($place === 'F' || $place === 'T') {
                    if ($x - $ex < (float) $keep['x1'] && $x + $ex > (float) $keep['x0'] && $z - $ez < (float) $keep['z1'] && $z + $ez > (float) $keep['z0']) self::bad($f, '문 앞은 비워 두어야 해요.');
                }
                if ($place === 'T') { if ($y > 2.2 + self::EPS) self::bad($f . '.y'); }
                elseif ($y != 0) self::bad($f . '.y');
            }
            $items[] = $out;
        }
        return ['style' => $style, 'items' => $items, 'public' => $body['public']];
    }

    /**
     * api/room/save.php: { v, style, items, public } → { v: the next version }. 403 ROOM_FORBIDDEN (no room for this
     * account) · 400 ROOM_INVALID / ROOM_LIMIT · 409 ROOM_STALE (data: { v: the stored version }).
     */
    public static function save(array $user, array $body): array
    {
        $uid = (int) (isset($user['id']) ? $user['id'] : 0);
        $r = self::rights($user, true);
        if (!$r[0]) {
            SecEvent::log('room_forbidden', 'info', ['why' => 'save without a room'], $uid);
            throw new ApiException(403, 'ROOM_FORBIDDEN', '방은 분양을 받은 분만 꾸밀 수 있어요.');
        }
        if (!isset($body['v']) || !is_int($body['v'])) V::fail('v', '값은 0 이상의 정수여야 해요.');   // a JSON integer: no digit string
        $v = V::int($body['v'], 'v', 0, 2000000000);
        $clean = self::validate($body, $r[1]);
        $data = Json::encode(['style' => $clean['style'], 'items' => $clean['items']], JSON_UNESCAPED_SLASHES);
        if (strlen($data) > self::MAX_BYTES) self::bad('items', '방이 너무 커요.');
        $pub = $clean['public'] ? 1 : 0;
        $now = Clock::ms();
        // compare-and-set in one statement: taken only when the stored version is still the one this save was made from
        // (v always changes, so "rows changed" is 1 exactly when it was taken — on MariaDB and on SQLite)
        if (Db::exec('UPDATE user_rooms SET v = v + 1, data = ?, public = ?, updated_at = ? WHERE user_id = ? AND v = ?', [$data, $pub, $now, $uid, $v]) === 1) {
            return ['v' => $v + 1];
        }
        $cur = Db::value('SELECT v FROM user_rooms WHERE user_id = ?', [$uid]);
        if ($cur === null && $v === 0) {
            try {
                Db::exec('INSERT INTO user_rooms (user_id, v, data, public, granted, granted_at, updated_at) VALUES (?, 1, ?, ?, 0, 0, ?)', [$uid, $data, $pub, $now]);
                return ['v' => 1];
            } catch (\PDOException $e) {
                if ((string) $e->getCode() !== '23000') throw $e;
                $cur = Db::value('SELECT v FROM user_rooms WHERE user_id = ?', [$uid]); // another request made the row first
            }
        }
        throw new ApiException(409, 'ROOM_STALE', '방이 다른 곳에서 바뀌었어요. 새로 불러올게요.', ['v' => $cur === null ? 0 : (int) $cur]);
    }

    // ------------------------------------------------------------------ the operator

    /**
     * Give an account a room of its own (or take that back) — the operator's direct grant, independent of an allotment
     * contract. The room's contents are kept when the grant is taken back. Audited. false = no such account.
     */
    public static function grant(int $uid, bool $on, int $actorId): bool
    {
        if ($uid <= 0 || !Users::byId($uid)) return false;
        $now = Clock::ms();
        $g = $on ? 1 : 0;
        $n = Db::exec('UPDATE user_rooms SET granted = ?, granted_at = ?, granted_by = ? WHERE user_id = ?', [$g, $now, $actorId > 0 ? $actorId : null, $uid]);
        if ($n !== 1 && Db::value('SELECT user_id FROM user_rooms WHERE user_id = ?', [$uid]) === null) {
            try {
                Db::exec("INSERT INTO user_rooms (user_id, v, data, public, granted, granted_at, granted_by, updated_at) VALUES (?, 0, '', 0, ?, ?, ?, ?)", [$uid, $g, $now, $actorId > 0 ? $actorId : null, $now]);
            } catch (\PDOException $e) {
                if ((string) $e->getCode() !== '23000') throw $e;
                Db::exec('UPDATE user_rooms SET granted = ?, granted_at = ?, granted_by = ? WHERE user_id = ?', [$g, $now, $actorId > 0 ? $actorId : null, $uid]);
            }
        }
        Cache::del('room:r:' . $uid);
        Audit::log($on ? 'room_grant' : 'room_revoke', $uid, [], 'info', $actorId > 0 ? $actorId : null);
        return true;
    }

    /** what the admin site shows about one account's room */
    public static function status(int $uid): array
    {
        $row = $uid > 0 ? Db::one('SELECT v, data, public, granted, granted_at, updated_at FROM user_rooms WHERE user_id = ?', [$uid]) : null;
        $contract = $uid > 0 && self::holdsContract($uid);
        $granted = $row ? (int) $row['granted'] === 1 : false;
        $things = 0;
        if ($row && is_string($row['data']) && $row['data'] !== '') {
            try { $d = Json::decode($row['data'], true, 8); $things = is_array($d) && isset($d['items']) && is_array($d['items']) ? count($d['items']) : 0; } catch (\Throwable $e) { $things = 0; }
        }
        return [
            'granted' => $granted, 'grantedAt' => $row ? (int) $row['granted_at'] : 0, 'contract' => $contract, 'has' => $granted || $contract,
            'things' => $things, 'v' => $row ? (int) $row['v'] : 0, 'updatedAt' => $row ? (int) $row['updated_at'] : 0, 'public' => $row ? (int) $row['public'] === 1 : false,
        ];
    }

    /** how many rooms there are: { rooms (decorated at least once), granted (given directly), public } */
    public static function counts(): array
    {
        try {
            return [
                'rooms' => (int) Db::value('SELECT COUNT(*) FROM user_rooms WHERE v > 0'),
                'granted' => (int) Db::value('SELECT COUNT(*) FROM user_rooms WHERE granted = 1'),
                'public' => (int) Db::value('SELECT COUNT(*) FROM user_rooms WHERE public = 1'),
            ];
        } catch (\Throwable $e) { return ['rooms' => 0, 'granted' => 0, 'public' => 0]; }
    }

    // ------------------------------------------------------------------ a room inside a game save (local mode)

    /**
     * Tfm\SaveValidator: the `myroom` block of a game save. In server mode the room lives in user_rooms and the block is
     * the empty default; a save that began on a device without a server may carry a decorated one. It is never used by
     * the server — it only has to be harmless: an object, at most HARD things, each a small object of an id and numbers.
     * null = fine; otherwise a short reason.
     */
    public static function checkEmbedded($v): ?string
    {
        if ($v === null) return null;
        if (is_object($v)) $v = get_object_vars($v);
        if (!is_array($v)) return 'not an object';
        $items = isset($v['items']) ? $v['items'] : [];
        if (is_object($items)) return 'items is not a list';
        if (!is_array($items) || count($items) > self::HARD) return 'too many things';
        foreach ($items as $it) {
            if (is_object($it)) $it = get_object_vars($it);
            if (!is_array($it) || count($it) > 7) return 'a thing is not an object';
            foreach ($it as $k => $val) {
                if ($k === 'i') { if (!is_string($val) || !preg_match(self::ID_RE, $val)) return 'a thing has no catalogue id'; }
                elseif (in_array($k, ['x', 'y', 'z', 'r', 's', 'c'], true)) { if ((!is_int($val) && !is_float($val)) || !is_finite((float) $val) || abs((float) $val) > 1000) return 'a number is out of range'; }
                else return 'an unknown field';
            }
        }
        $style = isset($v['style']) ? $v['style'] : [];
        if (is_object($style)) $style = get_object_vars($style);
        if (!is_array($style) || count($style) > 8) return 'the style is not an object';
        foreach ($style as $val) { if (!is_string($val) || strlen($val) > 24 || !preg_match('/^[a-z0-9]*$/', $val)) return 'a style value is not a plain word'; }
        return null;
    }
}
