<?php
/**
 * tests/support-unit.php — unit checks for 신고·문의 (CONTRACT §18.1): schema v9 tables and indexes, Tfm\Support (kinds,
 * categories, validation, the bad-word filter and the personal-data mask, device facts, per-account limits, ownership
 * of every id, the thread, read marks, deleting a ticket removes the row, its messages and its file, the clean-up with
 * the closed ones first, the masked CSV), the picture path of Tfm\Upload::supportShot (acceptance, re-encoding to JPEG,
 * refusals with crafted files: wrong type, a script inside, too large, too small, a fake extension), the admin tab
 * (lib/AdminSupport.php: the list, a ticket, the actions, everything escaped), the category lists of the app
 * (src/game/78-support.js) against the server's — and over a private `php -S` the endpoints (login, CSRF, multipart, the
 * picture with its fixed headers, 404 for another account).
 * A throw-away SQLite database in the temp dir — or MariaDB with the TFM_DB_* variables:
 *
 *   php tests/support-unit.php
 *   TFM_DB_DRIVER=mysql TFM_DB_HOST=127.0.0.1 TFM_DB_PORT=33106 TFM_DB_USER=root TFM_DB_NAME=tfm_p10su_unit php tests/support-unit.php
 *   TFM_SUPPORT_PORT=<port> (default 28001) · TFM_UNIT_ONLY=<text> · TFM_SUPPORT_SEED=100000 also fills the table with that
 *   many tickets and measures the admin list, the counts and a player's list (MariaDB: EXPLAIN must name the index).
 *
 * CLI only; never deployed. Developer tooling: runs on the dev PHP (8.x).
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
$root = sys_get_temp_dir() . '/tfm-support-' . bin2hex(random_bytes(6));
$srv = $root . '/srv';
$tmp = $root . '/data';
$work = $root . '/work';
mkdir($tmp, 0700, true);
mkdir($work, 0700, true);
copyTree(__DIR__ . '/../server', $srv);
putenv("TFM_DATA_DIR=$tmp");
putenv("TFM_UPLOAD_DIR=$tmp/uploads");
putenv('TFM_TOSS_MOCK=1');
require $srv . '/lib/bootstrap.php';

use Tfm\ApiException;
use Tfm\Db;
use Tfm\Support;
use Tfm\Upload;
use Tfm\Users;

$DRIVER = Db::driver();
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
    echo ($ok ? 'PASS  ' : 'FAIL  ') . $name . ($ok || $detail === '' ? '' : "  — $detail") . PHP_EOL;
}
function code(callable $fn): string
{
    try { $fn(); return ''; } catch (ApiException $e) { return $e->status . ' ' . $e->errorCode; }
}
function j($v): string { return json_encode($v, JSON_UNESCAPED_UNICODE); }

// ---------------------------------------------------------------------------------------------- crafted pictures
function png(int $w = 320, int $h = 180, string $append = ''): string
{
    $im = imagecreatetruecolor($w, $h);
    imagefilledrectangle($im, 0, 0, $w, $h, imagecolorallocate($im, 40, 120, 70));
    imagefilledrectangle($im, 10, 10, (int) ($w / 2), (int) ($h / 2), imagecolorallocate($im, 230, 200, 60));
    ob_start(); imagepng($im); $b = (string) ob_get_clean();
    return $b . $append;
}
function jpeg(int $w = 320, int $h = 180): string
{
    $im = imagecreatetruecolor($w, $h);
    imagefilledrectangle($im, 0, 0, $w, $h, imagecolorallocate($im, 200, 90, 40));
    ob_start(); imagejpeg($im, null, 90); return (string) ob_get_clean();
}
/** a file in $_FILES['shot'] (the trusted path of the test: copied, not moved) */
function fakeShot(string $bytes): void
{
    global $work;
    $p = $work . '/up-' . bin2hex(random_bytes(4));
    file_put_contents($p, $bytes);
    $_FILES = ['shot' => ['name' => 'x.png', 'type' => 'image/png', 'tmp_name' => $p, 'error' => UPLOAD_ERR_OK, 'size' => strlen($bytes)]];
}
function shotCount(): int
{
    global $tmp;
    $n = 0;
    if (!is_dir("$tmp/support")) return 0;
    $it = new RecursiveIteratorIterator(new RecursiveDirectoryIterator("$tmp/support", FilesystemIterator::SKIP_DOTS));
    foreach ($it as $f) if (preg_match('/^[a-f0-9]{32}\.jpg$/', $f->getFilename())) $n++;
    return $n;
}
/** a new ticket as $u (optionally with a picture) */
function mk(array $u, array $in = [], ?string $shot = null): array
{
    if ($shot !== null) fakeShot($shot); else $_FILES = [];
    return Support::create($u, $in + ['kind' => 'bug', 'category' => 'stuck'], $shot !== null, ['trusted' => true]);
}

echo "support-unit — driver $DRIVER, schema " . Db::schemaVersion() . PHP_EOL;
$sfx = bin2hex(random_bytes(3));
$A = Users::create("sa$sfx@example.com", "문의어린이$sfx", 'Passw0rd!long');
$B = Users::create("sb$sfx@example.com", "다른친구$sfx", 'Passw0rd!long');
$ADMIN = Users::create("sadm$sfx@example.com", "운영자$sfx", 'Passw0rd!long', 'admin');
/** the suite sends many tickets: generous limits, unless a check sets its own (and calls this again afterwards) */
$clearLimits = function () use ($ADMIN) {
    Db::exec('DELETE FROM settings WHERE k LIKE ?', ['support.%']);
    Tfm\Settings::reset();
    foreach (['support.per_hour' => 100, 'support.per_day' => 500, 'support.max_open' => 200] as $k => $v) Tfm\Settings::set($k, $v, (int) $ADMIN['id']);
};
$clearLimits();

// ---------------------------------------------------------------------------------------------- schema
check('schema — Db::SCHEMA_VERSION is 9 or newer, the database is at that version, support_tickets / support_messages exist with every column', function () {
    if (Db::SCHEMA_VERSION < 9 || Db::schemaVersion() !== Db::SCHEMA_VERSION) return 'code ' . Db::SCHEMA_VERSION . ', database ' . Db::schemaVersion();
    foreach (['id', 'no', 'user_id', 'kind', 'category', 'body', 'status', 'meta', 'shot_path', 'shot_bytes', 'shot_w', 'shot_h', 'target_user', 'target_ref', 'created_at', 'updated_at', 'answered_at', 'user_seen_at'] as $c) if (!Db::hasColumn('support_tickets', $c)) return "missing support_tickets.$c";
    foreach (['id', 'ticket_id', 'side', 'author_id', 'body', 'created_at'] as $c) if (!Db::hasColumn('support_messages', $c)) return "missing support_messages.$c";
    return true;
});
check('schema — the indexes the lists need: (status, id) · (kind, id) · (user_id, id) · (user_id, status) · (status, updated_at) · messages (ticket_id, id)', function () {
    $want = ['ix_sup_status', 'ix_sup_kind', 'ix_sup_user', 'ix_sup_user_status', 'ix_sup_clean'];
    if (Db::driver() === 'mysql') {
        $have = array_map(function ($r) { return (string) $r['INDEX_NAME']; }, Db::all('SELECT DISTINCT INDEX_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?', ['support_tickets']));
        $msg = array_map(function ($r) { return (string) $r['INDEX_NAME']; }, Db::all('SELECT DISTINCT INDEX_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?', ['support_messages']));
    } else {
        $have = array_map(function ($r) { return (string) $r['name']; }, Db::all("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'support_tickets'"));
        $msg = array_map(function ($r) { return (string) $r['name']; }, Db::all("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'support_messages'"));
    }
    $miss = array_values(array_diff($want, $have));
    if (!in_array('ix_supmsg_ticket', $msg, true)) $miss[] = 'ix_supmsg_ticket';
    return $miss === [] ? true : 'missing ' . j($miss);
});
check('schema — running the schema file again changes nothing (idempotent) and keeps one version row 9', function () use ($srv) {
    $file = $srv . '/database/' . (Db::driver() === 'mysql' ? 'schema.sql' : 'schema.sqlite.sql');
    foreach (Db::splitSql((string) file_get_contents($file)) as $s) Db::pdo()->exec($s);
    return (int) Db::value('SELECT COUNT(*) FROM schema_version WHERE version = 9') === 1 && Db::schemaVersion() === Db::SCHEMA_VERSION;
});

// ---------------------------------------------------------------------------------------------- the app's lists
check('the app (src/game/78-support.js) has the same kinds and category words as Tfm\Support', function () {
    $js = @file_get_contents(__DIR__ . '/../src/game/78-support.js');
    if ($js === false) return 'no 78-support.js';
    if (!preg_match('/const CATEGORIES = (\{[\s\S]*?\n  \});/', $js, $m)) return 'no CATEGORIES block';
    foreach (Support::CATEGORIES as $kind => $cats) {
        if (!preg_match('/\b' . $kind . ':\s*\[([^\]]*)\]/', $m[1], $k)) return "kind $kind missing in the app";
        preg_match_all("/id:\s*'([a-z]+)'/", $k[1], $ids);
        if ($ids[1] !== $cats) return "$kind: app " . j($ids[1]) . ' server ' . j($cats);
    }
    return true;
});

// ---------------------------------------------------------------------------------------------- creating
check('create: a bug with a category and no words (easy mode) is stored with a number yymmdd-id, status new, the owner sees no path', function () use ($A) {
    $t = mk($A);
    if ($t['status'] !== 'new' || $t['kind'] !== 'bug' || $t['category'] !== 'stuck' || $t['body'] !== '' || $t['shot'] !== false) return j($t);
    if (!preg_match('/^\d{6}-' . $t['id'] . '$/', $t['no'])) return 'no ' . $t['no'];
    return strpos(j($t), 'shot_path') === false && strpos(j($t), 'user_id') === false;
});
check('create: words are cleaned, a bad word is masked, a phone number / an e-mail are masked before they are stored; line breaks stay', function () use ($A) {
    $t = mk($A, ['kind' => 'question', 'category' => 'howto', 'body' => "  첫 줄에\u{200B}요 \n제 번호는 010-1234-5678 이고 메일은 kid@example.com 이에요\n시발 왜 안돼요  "]);
    $row = Db::one('SELECT body FROM support_tickets WHERE id = ?', [$t['id']]);
    $b = (string) $row['body'];
    if (strpos($b, '010-1234-5678') !== false || strpos($b, 'kid@example.com') !== false) return 'personal data kept: ' . $b;
    if (strpos($b, '시발') !== false) return 'bad word kept: ' . $b;
    if (strpos($b, "\u{200B}") !== false) return 'invisible kept';
    return substr_count($b, "\n") === 2 && strpos($b, '🔒') !== false ? true : j($b);
});
check('create: refusals — unknown kind, a category of another kind, more than 1,000 characters, a target on a bug, a report of oneself', function () use ($A) {
    $c = [
        code(function () use ($A) { mk($A, ['kind' => 'praise']); }),
        code(function () use ($A) { mk($A, ['kind' => 'bug', 'category' => 'bully']); }),
        code(function () use ($A) { mk($A, ['kind' => 'question', 'category' => 'howto', 'body' => str_repeat('가', 1001)]); }),
        code(function () use ($A) { mk($A, ['kind' => 'bug', 'targetId' => '5']); }),
        code(function () use ($A) { mk($A, ['kind' => 'report', 'category' => 'bully', 'targetId' => (string) $A['id']]); }),
    ];
    return $c === ['400 INVALID_INPUT', '400 INVALID_INPUT', '400 INVALID_INPUT', '400 INVALID_INPUT', '400 SELF_REPORT'] ? true : j($c);
});
check('create: device facts — the listed keys with their types are kept (numbers rounded), an unknown key or a wrong type is refused, personal data in a free text is masked', function () use ($A) {
    $meta = ['build' => 'p10-abc', 'browser' => 'Chrome 140', 'screen' => '1920x1080', 'quality' => 'high', 'place' => 'PL_BUEOK', 'x' => 12.3456, 'z' => -3.21, 'fps' => 58.71, 'look' => 'lock', 'lastError' => 'TypeError at 010-9876-5432'];
    $t = mk($A, ['meta' => json_encode($meta)]);
    $m = json_decode((string) Db::value('SELECT meta FROM support_tickets WHERE id = ?', [$t['id']]), true);
    if ($m['x'] !== 12.35 || $m['fps'] !== 58.71 || $m['place'] !== 'PL_BUEOK' || strpos($m['lastError'], '9876') !== false) return j($m);
    $c = [code(function () use ($A) { mk($A, ['meta' => json_encode(['save' => '{...}'])]); }), code(function () use ($A) { mk($A, ['meta' => json_encode(['fps' => 'fast'])]); }), code(function () use ($A) { mk($A, ['meta' => '[1,2']); })];
    return $c === ['400 INVALID_INPUT', '400 INVALID_INPUT', '400 INVALID_INPUT'] ? true : j($c);
});
check('create: a 🚨 report of a chat line keeps the line as target chat:<id> and its sender as the target account; a nickname finds the account', function () use ($A, $B) {
    $mid = Db::insert('chat_messages', ['user_id' => (int) $B['id'], 'nickname' => $B['nickname'], 'text' => '나쁜 말', 'channel' => 'all', 'created_at' => Tfm\Clock::ms()]);
    $t1 = mk($A, ['kind' => 'report', 'category' => 'badword', 'messageId' => (string) $mid]);
    $t2 = mk($A, ['kind' => 'report', 'category' => 'bully', 'targetName' => $B['nickname']]);
    $r1 = Db::one('SELECT target_user, target_ref FROM support_tickets WHERE id = ?', [$t1['id']]);
    $r2 = Db::one('SELECT target_user, target_ref FROM support_tickets WHERE id = ?', [$t2['id']]);
    return (int) $r1['target_user'] === (int) $B['id'] && $r1['target_ref'] === 'chat:' . $mid && (int) $r2['target_user'] === (int) $B['id'] && $r2['target_ref'] === '' ? true : j([$r1, $r2]);
});

// ---------------------------------------------------------------------------------------------- the picture
check('picture: a PNG screenshot is stored as a JPEG under data/support/YYYY/MM/<32 hex>.jpg (outside uploads/), sizes recorded, the bytes re-encoded', function () use ($A, $tmp) {
    $before = shotCount();
    $src = png(640, 360, '');
    $t = mk($A, [], $src);
    $row = Db::one('SELECT shot_path, shot_bytes, shot_w, shot_h FROM support_tickets WHERE id = ?', [$t['id']]);
    if (!preg_match('#^\d{4}/\d{2}/[a-f0-9]{32}\.jpg$#', (string) $row['shot_path'])) return 'path ' . $row['shot_path'];
    $abs = Upload::supportAbs((string) $row['shot_path']);
    if ($abs === null || strpos($abs, "$tmp/support") !== 0) return 'not in data/support';
    $info = getimagesize($abs);
    if ($info[2] !== IMAGETYPE_JPEG || (int) $row['shot_w'] !== 640 || (int) $row['shot_h'] !== 360 || (int) $row['shot_bytes'] !== filesize($abs)) return j([$info, $row]);
    if (file_get_contents($abs) === $src) return 'stored the original bytes';
    if (!is_file("$tmp/support/.htaccess") && !is_file("$tmp/.htaccess")) return 'no deny rules for the folder';
    return shotCount() === $before + 1 && $t['shot'] === true;
});
check('picture: a big screenshot is scaled to ≤ 1920 px', function () use ($A) {
    $t = mk($A, [], jpeg(2600, 1300));
    $row = Db::one('SELECT shot_w, shot_h FROM support_tickets WHERE id = ?', [$t['id']]);
    return (int) $row['shot_w'] === 1920 && (int) $row['shot_h'] === 960 ? true : j($row);
});
check('picture: refusals — not a picture, a script after the image data, a GIF, too large, too small, empty — and no file and no row is left behind', function () use ($A) {
    $rows = (int) Db::value('SELECT COUNT(*) FROM support_tickets');
    $files = shotCount();
    $gif = base64_decode('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7');
    $c = [];
    foreach (['<?php echo 1; ?>', png(64, 64, '<script>alert(1)</script>'), $gif, png(8, 8), ''] as $bytes) $c[] = code(function () use ($A, $bytes) { mk($A, [], $bytes); });
    $c[] = code(function () use ($A) { fakeShot(str_repeat("\xFF", 1600 * 1024)); Support::create($A, ['kind' => 'bug', 'category' => 'stuck'], true, ['trusted' => true]); });
    $want = ['400 UPLOAD_TYPE', '400 UPLOAD_REJECTED', '400 UPLOAD_TYPE', '400 UPLOAD_DIMENSIONS', '400 UPLOAD_EMPTY', '400 UPLOAD_TOO_LARGE'];
    if ($c !== $want) return j($c);
    return (int) Db::value('SELECT COUNT(*) FROM support_tickets') === $rows && shotCount() === $files ? true : 'something stayed';
});
check('picture: a hostile file is a counted security event (upload_rejected warn), a wrong type only info', function () use ($A) {
    $n0 = (int) Db::value("SELECT COUNT(*) FROM security_events WHERE kind = 'upload_rejected' AND severity = 'warn'");
    code(function () use ($A) { mk($A, [], png(64, 64, '<?php system($_GET[1]); ?>')); });
    $n1 = (int) Db::value("SELECT COUNT(*) FROM security_events WHERE kind = 'upload_rejected' AND severity = 'warn'");
    return $n1 === $n0 + 1;
});
check('picture: while pictures are switched off (support.shots) a picture is refused with SHOT_OFF; the setting on again → accepted', function () use ($A, $ADMIN, $clearLimits) {
    Tfm\Settings::set('support.shots', false, (int) $ADMIN['id']);
    $c = code(function () use ($A) { mk($A, [], png()); });
    Tfm\Settings::set('support.shots', true, (int) $ADMIN['id']);
    $ok = mk($A, [], png());
    $clearLimits();
    return $c === '400 SHOT_OFF' && $ok['shot'] === true ? true : $c;
});
check('picture: the owner and an administrator get it (shotFor), another account and a guest get the same 404 as a missing id; the other account is counted', function () use ($A, $B, $ADMIN) {
    $t = mk($A, [], png());
    $okOwner = (int) Support::shotFor($A, $t['id'])['id'] === $t['id'];
    $okAdmin = (int) Support::shotFor($ADMIN, $t['id'])['id'] === $t['id'];
    $n0 = (int) Db::value("SELECT COUNT(*) FROM security_events WHERE kind = 'support_idor'");
    $c = [code(function () use ($B, $t) { Support::shotFor($B, $t['id']); }), code(function () use ($t) { Support::shotFor(null, $t['id']); }), code(function () use ($A) { Support::shotFor($A, 99999999); })];
    $n1 = (int) Db::value("SELECT COUNT(*) FROM security_events WHERE kind = 'support_idor'");
    $none = mk($A);
    $c[] = code(function () use ($A, $none) { Support::shotFor($A, $none['id']); });
    return $okOwner && $okAdmin && $c === ['404 NOT_FOUND', '404 NOT_FOUND', '404 NOT_FOUND', '404 NOT_FOUND'] && $n1 === $n0 + 1 ? true : j([$c, $n1 - $n0]);
});

// ---------------------------------------------------------------------------------------------- limits
check('limits: per hour (support.per_hour) → 429 SUPPORT_LIMIT {limit: hour}, counted as support_abuse; another account is not affected', function () use ($A, $B, $ADMIN, $clearLimits) {
    Db::exec('DELETE FROM support_tickets WHERE user_id = ?', [(int) $B['id']]);
    Tfm\Settings::set('support.per_hour', 2, (int) $ADMIN['id']);
    mk($B); mk($B);
    $e = null;
    try { mk($B); } catch (ApiException $x) { $e = $x; }
    $okA = code(function () use ($A) { Db::exec('DELETE FROM support_tickets WHERE user_id = ?', [(int) $A['id']]); mk($A); });
    $clearLimits();
    $ev = (int) Db::value("SELECT COUNT(*) FROM security_events WHERE kind = 'support_abuse' AND user_id = ?", [(int) $B['id']]);
    return $e && $e->status === 429 && $e->errorCode === 'SUPPORT_LIMIT' && $e->data['limit'] === 'hour' && $okA === '' && $ev >= 1 ? true : j([$e ? $e->errorCode : null, $okA, $ev]);
});
check('limits: open tickets (support.max_open) count new / open / answered, not closed; a day limit (support.per_day) too', function () use ($B, $ADMIN, $clearLimits) {
    Db::exec('DELETE FROM support_tickets WHERE user_id = ?', [(int) $B['id']]);
    Tfm\Settings::set('support.max_open', 2, (int) $ADMIN['id']);
    $t1 = mk($B); mk($B);
    $c1 = code(function () use ($B) { mk($B); });
    Support::setStatus($ADMIN, $t1['id'], 'closed');
    $c2 = code(function () use ($B) { mk($B); });
    $clearLimits();
    Db::exec('DELETE FROM support_tickets WHERE user_id = ?', [(int) $B['id']]);
    Tfm\Settings::set('support.per_day', 1, (int) $ADMIN['id']);
    Db::insert('support_tickets', ['no' => 'old', 'user_id' => (int) $B['id'], 'kind' => 'bug', 'category' => 'other', 'body' => '', 'status' => 'closed', 'meta' => '', 'created_at' => Tfm\Clock::ms() - 7200000, 'updated_at' => Tfm\Clock::ms()]);
    $c3 = code(function () use ($B) { mk($B); });
    $clearLimits();
    return $c1 === '429 SUPPORT_LIMIT' && $c2 === '' && $c3 === '429 SUPPORT_LIMIT' ? true : j([$c1, $c2, $c3]);
});
check('switched off (support.enabled = off) → 403 SUPPORT_OFF; the old tickets can still be read', function () use ($A, $ADMIN, $clearLimits) {
    Tfm\Settings::set('support.enabled', false, (int) $ADMIN['id']);
    $c = code(function () use ($A) { mk($A); });
    $l = Support::mine((int) $A['id']);
    $clearLimits();
    return $c === '403 SUPPORT_OFF' && count($l['tickets']) > 0 && $l['limits']['on'] === false;
});

// ---------------------------------------------------------------------------------------------- thread, answers, read marks
check('the thread: the player adds words, the operator answers (status answered, answered_at) — the player sees the answer as unread until seen()', function () use ($A, $ADMIN) {
    Db::exec('DELETE FROM support_tickets WHERE user_id = ?', [(int) $A['id']]);
    $t = mk($A, ['kind' => 'question', 'category' => 'howto', 'body' => '장독은 어디 있어요?']);
    $r = Support::reply($A, $t['id'], '마당에서 찾았는데 안 열려요');
    if ($r['status'] !== 'open' || count($r['thread']) !== 1 || $r['thread'][0]['side'] !== 'user') return 'reply ' . j($r);
    if (Support::unread((int) $A['id']) !== 0) return 'unread before an answer';
    Support::answer($ADMIN, $t['id'], "장독대는 마당 동쪽에 있어요.\n가까이 가서 E 키를 눌러 보세요.");
    $mine = Support::mine((int) $A['id']);
    $x = $mine['tickets'][0];
    if ($x['status'] !== 'answered' || !$x['unread'] || $mine['unread'] !== 1 || count($x['thread']) !== 2 || $x['thread'][1]['side'] !== 'admin' || strpos($x['thread'][1]['body'], "\n") === false) return j($x);
    $left = Support::seen((int) $A['id'], $t['id']);
    return $left === 0 && Support::mine((int) $A['id'])['tickets'][0]['unread'] === false;
});
check('the thread: the operator answer keeps personal data out (masked) and is plain text; an answer to a missing ticket is a 404; a player is not an operator', function () use ($A, $ADMIN) {
    $t = mk($A);
    Support::answer($ADMIN, $t['id'], '<b>확인</b> 전화 010-2222-3333 으로 연락 주세요');
    $body = (string) Db::value("SELECT body FROM support_messages WHERE ticket_id = ? AND side = 'admin'", [$t['id']]);
    $c = [code(function () use ($ADMIN) { Support::answer($ADMIN, 99999999, '답'); }), code(function () use ($A, $t) { Support::answer($A, $t['id'], '답'); })];
    return strpos($body, '2222') === false && strpos($body, '<b>확인</b>') !== false && $c === ['404 NOT_FOUND', '403 FORBIDDEN'] ? true : j([$body, $c]);
});
check('ownership: reply / seen / delete of another account\'s ticket → 404 (counted), a closed ticket takes no reply (409), the 21st follow-up → 429', function () use ($A, $B, $ADMIN) {
    $t = mk($A);
    $c = [code(function () use ($B, $t) { Support::reply($B, $t['id'], '남의 것'); }), code(function () use ($B, $t) { Support::seen((int) $B['id'], $t['id']); }), code(function () use ($B, $t) { Support::deleteOwn($B, $t['id']); })];
    if ($c !== ['404 NOT_FOUND', '404 NOT_FOUND', '404 NOT_FOUND']) return j($c);
    if (!Db::one('SELECT id FROM support_tickets WHERE id = ?', [$t['id']])) return 'another account deleted it';
    for ($i = 0; $i < Support::USER_MESSAGES_MAX; $i++) Support::reply($A, $t['id'], '더 ' . $i);
    $full = code(function () use ($A, $t) { Support::reply($A, $t['id'], '하나 더'); });
    Support::setStatus($ADMIN, $t['id'], 'closed');
    $closed = code(function () use ($A, $t) { Support::reply($A, $t['id'], '닫힌 뒤'); });
    return $full === '429 SUPPORT_LIMIT' && $closed === '409 SUPPORT_CLOSED' ? true : j([$full, $closed]);
});

// ---------------------------------------------------------------------------------------------- deleting leaves nothing
check('delete (the player): the row, every message and the picture file go; the counts cache forgets it', function () use ($A, $ADMIN) {
    $t = mk($A, [], png());
    Support::reply($A, $t['id'], '덧붙임');
    Support::answer($ADMIN, $t['id'], '답');
    $path = (string) Db::value('SELECT shot_path FROM support_tickets WHERE id = ?', [$t['id']]);
    $abs = Upload::supportAbs($path);
    $before = Support::counts()['all'];
    Support::deleteOwn($A, $t['id']);
    $left = [(int) Db::value('SELECT COUNT(*) FROM support_tickets WHERE id = ?', [$t['id']]), (int) Db::value('SELECT COUNT(*) FROM support_messages WHERE ticket_id = ?', [$t['id']]), $abs !== null && is_file($abs) ? 1 : 0];
    return $left === [0, 0, 0] && Support::counts()['all'] === $before - 1 ? true : j($left);
});
check('delete (the operator, several at once): rows, messages, files go and every one is audited; unknown ids are skipped', function () use ($A, $B, $ADMIN) {
    $t1 = mk($A, [], png());
    $t2 = mk($B, [], png());
    Support::reply($B, $t2['id'], '말');
    $files = shotCount();
    $n = Support::remove($ADMIN, [$t1['id'], $t2['id'], 99999999, 'x']);
    $rows = (int) Db::value('SELECT COUNT(*) FROM support_tickets WHERE id IN (?, ?)', [$t1['id'], $t2['id']]);
    $msgs = (int) Db::value('SELECT COUNT(*) FROM support_messages WHERE ticket_id IN (?, ?)', [$t1['id'], $t2['id']]);
    $aud = (int) Db::value("SELECT COUNT(*) FROM audit_log WHERE event = 'support_delete' AND actor_id = ?", [(int) $ADMIN['id']]);
    return $n === 2 && $rows === 0 && $msgs === 0 && shotCount() === $files - 2 && $aud >= 2 ? true : j([$n, $rows, $msgs, shotCount(), $files, $aud]);
});
check('clean-up after support.keep_days: old closed tickets go first, then old others; recent ones stay; files go too', function () use ($A, $ADMIN, $clearLimits) {
    $old = Tfm\Clock::ms() - 400 * 86400000;
    $tc = mk($A, [], png());
    $to = mk($A);
    $tn = mk($A);
    Db::exec("UPDATE support_tickets SET status = 'closed', updated_at = ? WHERE id = ?", [$old, $tc['id']]);
    Db::exec('UPDATE support_tickets SET updated_at = ? WHERE id = ?', [$old + 1000, $to['id']]);
    $abs = Upload::supportAbs((string) Db::value('SELECT shot_path FROM support_tickets WHERE id = ?', [$tc['id']]));
    $first = Support::cleanup($ADMIN, 1);
    $closedGone = !Db::one('SELECT id FROM support_tickets WHERE id = ?', [$tc['id']]) && Db::one('SELECT id FROM support_tickets WHERE id = ?', [$to['id']]);
    $second = Support::cleanup($ADMIN, 100);
    $clearLimits();
    return $first === 1 && $closedGone && $second >= 1 && !Db::one('SELECT id FROM support_tickets WHERE id = ?', [$to['id']]) && Db::one('SELECT id FROM support_tickets WHERE id = ?', [$tn['id']]) && !is_file((string) $abs) ? true : j([$first, $second, $closedGone]);
});

// ---------------------------------------------------------------------------------------------- the operator's list
check('admin list: newest first, keyset pages never repeat or skip a row; filters by status, kind, ticket number, account id, nickname', function () use ($A, $B) {
    Db::exec('DELETE FROM support_tickets');
    $ids = [];
    for ($i = 0; $i < 7; $i++) $ids[] = mk($i % 2 ? $A : $B, ['kind' => $i % 3 === 0 ? 'question' : 'bug', 'category' => 'other'])['id'];
    $seen = [];
    $before = 0;
    do { $p = Support::page([], $before, 3); foreach ($p['rows'] as $r) $seen[] = (int) $r['id']; $before = $p['next']; } while ($p['more']);
    $want = $ids; rsort($want);
    if ($seen !== $want) return 'pages ' . j($seen) . ' want ' . j($want);
    $q = Support::page(['kind' => 'question'], 0, 50)['rows'];
    $byNo = Support::page(['q' => (string) Db::value('SELECT no FROM support_tickets WHERE id = ?', [$ids[2]])], 0, 50)['rows'];
    $byNick = Support::page(['q' => $A['nickname']], 0, 50)['rows'];
    $none = Support::page(['q' => '없는사람'], 0, 50)['rows'];
    return count($q) === 3 && (int) $byNo[0]['id'] === $ids[2] && count($byNick) === 3 && $none === [] && $q[0]['nick'] !== '' ? true : j([count($q), count($byNick)]);
});
check('counts: per status and all (the overview badge), right after a change', function () use ($A, $ADMIN) {
    $c0 = Support::counts();
    $t = mk($A);
    $c1 = Support::counts();
    Support::answer($ADMIN, $t['id'], '답');
    $c2 = Support::counts();
    return $c1['new'] === $c0['new'] + 1 && $c1['all'] === $c0['all'] + 1 && $c2['answered'] === $c0['answered'] + 1 && $c2['new'] === $c0['new'] ? true : j([$c0, $c1, $c2]);
});
check('CSV export: masked nicknames, no device facts, no path; a cell that starts like a formula gets an apostrophe; RFC 4180 quotes', function () use ($A) {
    $t = mk($A, ['kind' => 'question', 'category' => 'other', 'body' => '=HYPERLINK("x") "따옴표", 쉼표']);
    $csv = Support::csv(Support::csvRows([], 100));
    if (strpos($csv, $A['nickname']) !== false) return 'nickname in clear';
    if (strpos($csv, 'support/') !== false || strpos($csv, 'browser') !== false) return 'a path / device facts';
    if (strpos($csv, "\"'=HYPERLINK(\"\"x\"\") \"\"따옴표\"\", 쉼표\"") === false) return 'quoting: ' . substr($csv, 0, 300);
    return strpos($csv, mb_substr($A['nickname'], 0, 1) . '**') !== false;
});

// ---------------------------------------------------------------------------------------------- the admin tab
check('admin tab: the list, a ticket with its picture link, device facts and thread — every value escaped, no script, no inline style', function () use ($A, $ADMIN) {
    if (!class_exists('Tfm\AdminSupport')) return 'no AdminSupport';
    $t = mk($A, ['kind' => 'question', 'category' => 'howto', 'body' => '<script>alert(1)</script> "따옴표"', 'meta' => json_encode(['browser' => '<img src=x onerror=alert(1)>', 'place' => 'PL_BUEOK'])], png());
    Support::answer($ADMIN, $t['id'], '<i>답</i>');
    $c = new Tfm\Ctx();
    $c->user = $ADMIN;
    $list = Tfm\AdminSupport::view($c, [], 'tok<>"');
    $one = Tfm\AdminSupport::view($c, ['t' => (string) $t['id']], 'tok<>"');
    foreach ([$list, $one] as $h) {
        if (preg_match('/<script|<[^>]*onerror=|<img src=x|style="|<i>답/i', $h, $hit)) return 'unescaped: ' . $hit[0] . ' near ' . substr($h, max(0, strpos($h, $hit[0]) - 80), 160);
        if (strpos($h, 'tok&lt;&gt;&quot;') === false) return 'token not escaped';
    }
    if (strpos($list, '&lt;script&gt;') === false) return 'body not shown escaped in the list';
    if (strpos($one, './?supshot=' . $t['id']) === false) return 'no picture link';
    if (strpos($one, 'PL_BUEOK') === false || strpos($one, '&lt;i&gt;답') === false) return 'device facts / thread';
    return true;
});
check('admin tab: the actions answer, change the status, delete one and several, clean up, save the settings (all audited)', function () use ($A, $ADMIN, $clearLimits) {
    $c = new Tfm\Ctx();
    $c->user = $ADMIN;
    $t = mk($A);
    $r1 = Tfm\AdminSupport::action('support_answer', $c, ['id' => (string) $t['id'], 'body' => '확인했어요', 'status' => 'answered']);
    $r2 = Tfm\AdminSupport::action('support_status', $c, ['id' => (string) $t['id'], 'status' => 'closed']);
    $st = (string) Db::value('SELECT status FROM support_tickets WHERE id = ?', [$t['id']]);
    $bad = code(function () use ($c, $t) { Tfm\AdminSupport::action('support_delete', $c, ['id' => (string) $t['id']]); }); // no "정말 지울게요"
    $r3 = Tfm\AdminSupport::action('support_delete', $c, ['id' => (string) $t['id'], 'sure' => '1']);
    $t2 = mk($A); $t3 = mk($A);
    $r4 = Tfm\AdminSupport::action('support_delete_many', $c, ['pick' => [(string) $t2['id'], (string) $t3['id']], 'sure' => '1']);
    $r5 = Tfm\AdminSupport::action('support_settings', $c, ['per_hour' => '7', 'per_day' => '30', 'max_open' => '9', 'keep_days' => '90', 'enabled' => '1', 'shots' => '1', 'shot_kb' => '1024']);
    $lim = Support::limits();
    $r6 = Tfm\AdminSupport::action('support_cleanup', $c, []);
    $clearLimits();
    $left = (int) Db::value('SELECT COUNT(*) FROM support_tickets WHERE id IN (?, ?, ?)', [$t['id'], $t2['id'], $t3['id']]);
    return $st === 'closed' && $bad === '400 CONFIRM_REQUIRED' && $left === 0 && $lim['hour'] === 7 && $lim['open'] === 9 && $lim['keep_days'] === 90 && $lim['shot_bytes'] === 1048576
        && is_string($r1['msg']) && is_string($r2['msg']) && is_string($r3['msg']) && is_string($r4['msg']) && is_string($r5['msg']) && is_string($r6['msg']) ? true : j([$st, $bad, $left, $lim]);
});

// ---------------------------------------------------------------------------------------------- HTTP (php -S)
$PORT = (int) (getenv('TFM_SUPPORT_PORT') ?: 28001);
$proc = proc_open(['php', '-S', "127.0.0.1:$PORT", '-t', $srv], [0 => ['file', '/dev/null', 'r'], 1 => ['file', '/dev/null', 'w'], 2 => ['file', "$root/php-server.log", 'w']], $pipes);
for ($i = 0; $i < 60; $i++) { $s = @fsockopen('127.0.0.1', $PORT, $en, $es, 0.2); if ($s) { fclose($s); break; } usleep(100000); }
/** one request with a cookie jar → ['status', 'headers', 'body', 'json'] */
function http(string $jar, string $path, string $method = 'GET', $body = null, array $headers = []): array
{
    global $PORT, $work;
    $ch = curl_init("http://127.0.0.1:$PORT/$path");
    $opt = [CURLOPT_RETURNTRANSFER => true, CURLOPT_HEADER => true, CURLOPT_CUSTOMREQUEST => $method, CURLOPT_NOBODY => $method === 'HEAD', CURLOPT_TIMEOUT => 30,
        CURLOPT_COOKIEJAR => "$work/$jar.jar", CURLOPT_COOKIEFILE => "$work/$jar.jar", CURLOPT_HTTPHEADER => array_merge(['Origin: http://127.0.0.1:' . $PORT], $headers)];
    if (is_array($body)) $opt[CURLOPT_POSTFIELDS] = $body;
    elseif (is_string($body)) { $opt[CURLOPT_POSTFIELDS] = $body; $opt[CURLOPT_HTTPHEADER][] = 'Content-Type: application/json'; }
    curl_setopt_array($ch, $opt);
    $raw = (string) curl_exec($ch);
    $hs = (int) curl_getinfo($ch, CURLINFO_HEADER_SIZE);
    $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    $h = [];
    foreach (explode("\r\n", substr($raw, 0, $hs)) as $line) if (strpos($line, ':') !== false) { list($k, $v) = explode(':', $line, 2); $h[strtolower(trim($k))] = trim($v); }
    $b = substr($raw, $hs);
    return ['status' => $status, 'headers' => $h, 'body' => $b, 'json' => json_decode($b, true)];
}
$CSRF = [];
function signIn(string $jar, array $u): string
{
    global $CSRF;
    $p = http($jar, 'api/ping.php');
    $tok = (string) $p['json']['data']['csrf'];
    $r = http($jar, 'api/auth/login.php', 'POST', json_encode(['login' => $u['email'], 'password' => 'Passw0rd!long']), ['X-CSRF-Token: ' . $tok]);
    $tok2 = isset($r['json']['csrf']) ? (string) $r['json']['csrf'] : (string) http($jar, 'api/ping.php')['json']['data']['csrf'];
    return $CSRF[$jar] = $tok2 !== '' ? $tok2 : $tok;
}
check('HTTP: a guest cannot send (401); a signed-in player sends a multipart report with a picture; the answer has the number and no path', function () use ($A, $work) {
    http('guest', 'api/ping.php');
    $g = http('guest', 'api/support/create.php', 'POST', json_encode(['kind' => 'bug', 'category' => 'stuck']));
    if ($g['status'] !== 401 && $g['status'] !== 403) return 'guest ' . $g['status'];
    $tok = signIn('a', $A);
    $f = "$work/shot-http.png";
    file_put_contents($f, png(400, 240));
    $r = http('a', 'api/support/create.php', 'POST', ['kind' => 'bug', 'category' => 'invisible', 'body' => '장독이 안 보여요', 'meta' => json_encode(['quality' => 'low']), 'shot' => new CURLFile($f, 'image/png', 'a.png')], ['X-CSRF-Token: ' . $tok]);
    $t = $r['json']['data']['ticket'] ?? null;
    if ($r['status'] !== 200 || !$t || $t['shot'] !== true || $t['category'] !== 'invisible') return 'create ' . $r['status'] . ' ' . substr($r['body'], 0, 200);
    $GLOBALS['HTTP_TICKET'] = $t['id'];
    return strpos($r['body'], 'shot_path') === false && strpos($r['body'], '.jpg') === false;
});
check('HTTP: without the CSRF token a write is refused (403); an unknown field, a second file field and a file on reply.php are refused (400)', function () use ($work) {
    $tok = $GLOBALS['CSRF']['a'];
    $f = "$work/shot-http.png";
    $c = [
        http('a', 'api/support/create.php', 'POST', json_encode(['kind' => 'bug', 'category' => 'stuck']))['status'],
        http('a', 'api/support/create.php', 'POST', json_encode(['kind' => 'bug', 'category' => 'stuck', 'admin' => 1]), ['X-CSRF-Token: ' . $tok])['status'],
        http('a', 'api/support/create.php', 'POST', ['kind' => 'bug', 'category' => 'stuck', 'other' => new CURLFile($f, 'image/png', 'b.png')], ['X-CSRF-Token: ' . $tok])['status'],
        http('a', 'api/support/reply.php', 'POST', ['id' => '1', 'body' => 'x', 'shot' => new CURLFile($f, 'image/png', 'b.png')], ['X-CSRF-Token: ' . $tok])['status'],
    ];
    return $c === [403, 400, 400, 400] ? true : j($c);
});
check('HTTP shot.php: the owner gets image/jpeg with nosniff, a sandbox CSP, private cache, same-origin resource policy and an ETag (304); another account gets 404', function () use ($B) {
    $id = (int) $GLOBALS['HTTP_TICKET'];
    $r = http('a', 'api/support/shot.php?id=' . $id);
    $h = $r['headers'];
    if ($r['status'] !== 200 || ($h['content-type'] ?? '') !== 'image/jpeg' || substr($r['body'], 0, 3) !== "\xFF\xD8\xFF") return 'owner ' . $r['status'] . ' ' . ($h['content-type'] ?? '');
    if (($h['x-content-type-options'] ?? '') !== 'nosniff' || strpos($h['content-security-policy'] ?? '', 'sandbox') === false || strpos($h['cache-control'] ?? '', 'private') !== 0 || ($h['cross-origin-resource-policy'] ?? '') !== 'same-origin' || empty($h['etag'])) return 'headers ' . j($h);
    if (http('a', 'api/support/shot.php?id=' . $id, 'GET', null, ['If-None-Match: ' . $h['etag']])['status'] !== 304) return 'no 304';
    signIn('b', $B);
    $o = http('b', 'api/support/shot.php?id=' . $id);
    $m = http('b', 'api/support/shot.php?id=99999999');
    $q = http('a', 'api/support/shot.php?id=' . $id . '&x=1');
    return $o['status'] === 404 && $m['status'] === 404 && $o['json']['error'] === $m['json']['error'] && $q['status'] === 400 ? true : j([$o['status'], $m['status'], $q['status'], $o['json']['error'], $m['json']['error']]);
});
check('HTTP mine / reply / seen / delete: own list with the thread; another account\'s id → 404; delete leaves nothing (the picture answers 404 afterwards)', function () use ($ADMIN) {
    $id = (int) $GLOBALS['HTTP_TICKET'];
    $tokA = $GLOBALS['CSRF']['a'];
    $tokB = $GLOBALS['CSRF']['b'];
    $m = http('a', 'api/support/mine.php');
    if ($m['status'] !== 200 || (int) $m['json']['data']['tickets'][0]['id'] !== $id) return 'mine ' . substr($m['body'], 0, 200);
    $u = http('a', 'api/support/mine.php?unread=1');
    if ($u['status'] !== 200 || !isset($u['json']['data']['unread']) || isset($u['json']['data']['tickets'])) return 'unread';
    $rb = http('b', 'api/support/reply.php', 'POST', json_encode(['id' => $id, 'body' => '남의 것']), ['X-CSRF-Token: ' . $tokB]);
    $db = http('b', 'api/support/delete.php', 'POST', json_encode(['id' => $id]), ['X-CSRF-Token: ' . $tokB]);
    if ($rb['status'] !== 404 || $db['status'] !== 404) return 'other account ' . $rb['status'] . ' ' . $db['status'];
    $ra = http('a', 'api/support/reply.php', 'POST', json_encode(['id' => $id, 'body' => '더 알려 드려요']), ['X-CSRF-Token: ' . $tokA]);
    Support::answer($ADMIN, $id, '고쳤어요');
    $un = http('a', 'api/support/mine.php?unread=1')['json']['data']['unread'];
    $sa = http('a', 'api/support/seen.php', 'POST', '{}', ['X-CSRF-Token: ' . $tokA]);
    $da = http('a', 'api/support/delete.php', 'POST', json_encode(['id' => $id]), ['X-CSRF-Token: ' . $tokA]);
    $after = http('a', 'api/support/shot.php?id=' . $id);
    return $ra['status'] === 200 && $un >= 1 && $sa['json']['data']['unread'] === 0 && $da['status'] === 200 && $after['status'] === 404 && !Db::one('SELECT id FROM support_tickets WHERE id = ?', [$id]) ? true : j([$ra['status'], $un, $sa['status'], $da['status'], $after['status']]);
});

// ---------------------------------------------------------------------------------------------- 100,000 tickets (optional)
$seed = (int) getenv('TFM_SUPPORT_SEED');
if ($seed > 0) {
    check("scale: $seed tickets — the first page, a deep keyset page, a status page, the counts and a player's list stay fast; the plans use the indexes", function () use ($seed, $A, $DRIVER) {
        Db::exec('DELETE FROM support_tickets');
        $t0 = microtime(true);
        $now = Tfm\Clock::ms();
        $st = ['new', 'open', 'answered', 'closed'];
        $kinds = ['bug', 'question', 'report'];
        for ($i = 0; $i < $seed; $i += 1000) {
            $vals = [];
            $p = [];
            for ($k = 0; $k < 1000 && $i + $k < $seed; $k++) {
                $n = $i + $k;
                $vals[] = '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)';
                array_push($p, 's' . $n, 1000 + ($n % 5000), $kinds[$n % 3], 'other', '글 ' . $n, $st[$n % 4], '', $now - ($seed - $n) * 1000, $now - ($seed - $n) * 1000, 0);
            }
            Db::exec('INSERT INTO support_tickets (no, user_id, kind, category, body, status, meta, created_at, updated_at, answered_at) VALUES ' . implode(', ', $vals), $p);
        }
        $fill = round(microtime(true) - $t0, 1);
        $time = function (callable $fn) { $t = microtime(true); for ($r = 0; $r < 5; $r++) $fn(); return round((microtime(true) - $t) * 1000 / 5, 1); };
        Support::bump();
        $first = $time(function () { Support::page([], 0, 50); });
        $mid = (int) Db::value('SELECT MIN(id) FROM support_tickets') + (int) ($seed / 2);
        $deep = $time(function () use ($mid) { Support::page([], $mid, 50); });
        $status = $time(function () use ($mid) { Support::page(['status' => 'new'], $mid, 50); });
        $kind = $time(function () use ($mid) { Support::page(['kind' => 'report'], $mid, 50); });
        $counts = $time(function () { Support::bump(); Support::counts(); });
        $mine = $time(function () { Support::mine(1234, 0, 20); });
        $limit = $time(function () { Db::value('SELECT COUNT(*) FROM support_tickets WHERE user_id = ? AND id > ? AND created_at >= ?', [1234, 0, Tfm\Clock::ms() - 86400000]); });
        $plan = '';
        if ($DRIVER === 'mysql') {
            $e1 = Db::one('EXPLAIN SELECT id FROM support_tickets WHERE status = ? AND id < ? ORDER BY id DESC LIMIT 51', ['new', $mid]);
            $e2 = Db::one('EXPLAIN SELECT * FROM support_tickets WHERE user_id = ? AND id < ? ORDER BY id DESC LIMIT 21', [1234, PHP_INT_MAX]);
            $plan = 'status → ' . ($e1['key'] ?? '?') . ', mine → ' . ($e2['key'] ?? '?');
            if (($e1['key'] ?? '') !== 'ix_sup_status' || ($e2['key'] ?? '') !== 'ix_sup_user') return 'plan: ' . $plan;
        }
        echo "      $seed rows filled in {$fill}s · ms per call: first page $first · deep page $deep · status page $status · kind page $kind · counts $counts · a player's list $mine · limit count $limit · $plan" . PHP_EOL;
        $ok = max($first, $mine, $limit) < 20 && max($deep, $status, $kind) < 200 && $counts < 400;
        Db::exec('DELETE FROM support_tickets');
        return $ok ? true : 'too slow';
    });
}

// ---------------------------------------------------------------------------------------------- end
if (is_resource($proc)) { proc_terminate($proc); proc_close($proc); }
Db::exec('DELETE FROM support_messages WHERE ticket_id IN (SELECT id FROM support_tickets WHERE user_id IN (?, ?, ?))', [(int) $A['id'], (int) $B['id'], (int) $ADMIN['id']]);
Db::exec('DELETE FROM support_tickets WHERE user_id IN (?, ?, ?)', [(int) $A['id'], (int) $B['id'], (int) $ADMIN['id']]);
echo PHP_EOL . "support-unit: $passed passed, $failed failed" . PHP_EOL;
exit($failed > 0 ? 1 : 0);
