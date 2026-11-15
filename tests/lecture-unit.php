<?php
/**
 * tests/lecture-unit.php — unit checks for the 강의실 server (CONTRACT §17.3): schema v8 tables, Tfm\Lecture (address
 * parsing incl. hostile forms, the admin operations, audience filtering for the list and for every file), the
 * administrator file path of Tfm\Upload (acceptance and refusals with crafted files: wrong header, zip bomb, names that
 * leave the archive, script in a picture, oversize, too many …) and — over a private `php -S` — the two endpoints: the
 * list, the file with its fixed headers, byte ranges, 304, HEAD and the 404s.
 * A throw-away SQLite database in the temp dir — or MariaDB with the TFM_DB_* variables:
 *
 *   php tests/lecture-unit.php
 *   TFM_DB_DRIVER=mysql TFM_DB_HOST=127.0.0.1 TFM_DB_PORT=33106 TFM_DB_USER=root TFM_DB_NAME=tfm_p9le_unit php tests/lecture-unit.php
 *   (the MariaDB database must exist; the suite removes its own lectures at the end)
 *   TFM_LECTURE_PORT=<port> picks the port of the private web server (default 25210); TFM_UNIT_ONLY=<text> runs only
 *   the checks whose name contains <text>.
 *
 * CLI only; never deployed (tests/ is not part of the web root). Developer tooling: runs on the dev PHP (8.x).
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
$root = sys_get_temp_dir() . '/tfm-lecture-' . bin2hex(random_bytes(6));
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
use Tfm\Lecture;
use Tfm\Upload;

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
/** the error code a call ends with ('' when it does not throw an ApiException) */
function code(callable $fn): string
{
    try { $fn(); return ''; } catch (ApiException $e) { return $e->errorCode; }
}

// ---------------------------------------------------------------------------------------------- crafted files
function pdfBytes(string $text = 'Lecture', string $extra = ''): string
{
    $objs = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 200] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>'];
    $stream = "BT /F1 24 Tf 30 90 Td ($text) Tj ET";
    $objs[] = '<< /Length ' . strlen($stream) . " >>\nstream\n$stream\nendstream";
    $objs[] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
    if ($extra !== '') $objs[] = $extra;
    $out = "%PDF-1.4\n";
    $offs = [];
    foreach ($objs as $i => $o) { $offs[] = strlen($out); $out .= ($i + 1) . " 0 obj\n$o\nendobj\n"; }
    $x = strlen($out);
    $out .= "xref\n0 " . (count($objs) + 1) . "\n0000000000 65535 f \n";
    foreach ($offs as $o) $out .= sprintf("%010d 00000 n \n", $o);
    return $out . "trailer\n<< /Size " . (count($objs) + 1) . " /Root 1 0 R >>\nstartxref\n$x\n%%EOF\n";
}
/**
 * A zip made by hand, so every field can lie. $entries: [['name', 'data', 'method' => 8|0, 'flags' => 0, 'usize' => declared,
 * 'lname' => another name in the local header], …]; $o: prefix, suffix, comment, total (declared count), zip64 (bool).
 */
function zipBytes(array $entries, array $o = []): string
{
    $out = isset($o['prefix']) ? $o['prefix'] : '';
    $cd = '';
    foreach ($entries as $e) {
        $name = $e['name'];
        $data = isset($e['data']) ? $e['data'] : '';
        $method = isset($e['method']) ? $e['method'] : 8;
        $packed = $method === 8 ? gzdeflate($data, 9) : $data;
        $flags = isset($e['flags']) ? $e['flags'] : 0;
        $usize = isset($e['usize']) ? $e['usize'] : strlen($data);
        $crc = crc32($data);
        $off = strlen($out);
        $lname = isset($e['lname']) ? $e['lname'] : $name;
        $out .= "PK\x03\x04" . pack('vvvvvVVVvv', 20, $flags, $method, 0, 0x5821, $crc, strlen($packed), $usize, strlen($lname), 0) . $lname . $packed;
        $cd .= "PK\x01\x02" . pack('vvvvvvVVVvvvvvVV', 20, 20, $flags, $method, 0, 0x5821, $crc, isset($e['csize']) ? $e['csize'] : strlen($packed), $usize, strlen($name), 0, 0, 0, 0, 0, $off) . $name;
    }
    $cdOff = strlen($out);
    $n = isset($o['total']) ? $o['total'] : count($entries);
    $comment = isset($o['comment']) ? $o['comment'] : '';
    $out .= $cd . "PK\x05\x06" . pack('vvvvVVv', 0, 0, $n, $n, strlen($cd), !empty($o['zip64']) ? 0xFFFFFFFF : $cdOff, strlen($comment)) . $comment;
    return $out . (isset($o['suffix']) ? $o['suffix'] : '');
}
function pngBytes(int $w = 64, int $h = 36, array $rgb = [200, 120, 40]): string
{
    $im = imagecreatetruecolor($w, $h);
    imagefill($im, 0, 0, imagecolorallocate($im, $rgb[0], $rgb[1], $rgb[2]));
    ob_start();
    imagepng($im);
    return (string) ob_get_clean();
}
/** the parts of a small but real presentation: $slides slides, one picture */
function pptxEntries(int $slides = 2, array $more = [], string $types = ''): array
{
    $ct = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/>'
        . '<Override PartName="/ppt/presentation.xml" ContentType="' . ($types !== '' ? $types : 'application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml') . '"/>';
    $pres = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:sldIdLst>';
    $rels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">';
    $e = [];
    for ($i = 1; $i <= $slides; $i++) {
        $ct .= '<Override PartName="/ppt/slides/slide' . $i . '.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>';
        $pres .= '<p:sldId id="' . (255 + $i) . '" r:id="rId' . $i . '"/>';
        $rels .= '<Relationship Id="rId' . $i . '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide' . $i . '.xml"/>';
        $e[] = ['name' => "ppt/slides/slide$i.xml", 'data' => '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:cSld><p:spTree>'
            . '<p:sp><p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:txBody><a:bodyPr/><a:p><a:r><a:t>슬라이드 ' . $i . '</a:t></a:r></a:p></p:txBody></p:sp>'
            . '<p:sp><p:nvSpPr><p:cNvPr id="3" name="Body"/><p:cNvSpPr/><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:txBody><a:bodyPr/><a:p><a:r><a:t>첫째 줄</a:t></a:r></a:p><a:p><a:pPr lvl="1"/><a:r><a:t>둘째 줄</a:t></a:r></a:p></p:txBody></p:sp>'
            . '<p:pic><p:nvPicPr><p:cNvPr id="4" name="Pic"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rId1"/></p:blipFill></p:pic></p:spTree></p:cSld></p:sld>'];
        $e[] = ['name' => "ppt/slides/_rels/slide$i.xml.rels", 'data' => '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"/></Relationships>'];
    }
    $head = [
        ['name' => '[Content_Types].xml', 'data' => $ct . '</Types>'],
        ['name' => '_rels/.rels', 'data' => '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/></Relationships>'],
        ['name' => 'ppt/presentation.xml', 'data' => $pres . '</p:sldIdLst></p:presentation>'],
        ['name' => 'ppt/_rels/presentation.xml.rels', 'data' => $rels . '</Relationships>'],
    ];
    $e[] = ['name' => 'ppt/media/image1.png', 'data' => pngBytes(), 'method' => 0];
    return array_merge($head, $e, $more);
}
$nFile = 0;
/** write bytes to a work file and return what Upload::incoming() would hand over */
function fileOf(string $bytes): array
{
    global $work, $nFile;
    $p = $work . '/f' . (++$nFile) . '.bin';
    file_put_contents($p, $bytes);
    return ['tmp' => $p, 'size' => strlen($bytes), 'error' => UPLOAD_ERR_OK];
}
function inspectCode(string $bytes, string $kind, array $opt = []): string
{
    $f = fileOf($bytes);
    return code(function () use ($f, $kind, $opt) { Upload::inspect($f['tmp'], $kind, $opt); });
}

// ---------------------------------------------------------------------------------------------- set-up
$RUN = bin2hex(random_bytes(3));
Db::pdo();
$DRIVER = Db::driver();
echo "lecture-unit — driver $DRIVER, schema " . Db::schemaVersion() . PHP_EOL;
$nUser = 0;
function mkUser(string $role = ''): array
{
    global $RUN, $nUser;
    $nUser++;
    return Tfm\Users::create("lec{$RUN}{$nUser}@example.com", 'Le' . substr($RUN, 0, 4) . $nUser, 'Ferment2026ok', $role === 'admin' ? 'admin' : '');
}
$ADMIN = mkUser('admin');
$MEMBER = mkUser();
$PAID = mkUser();
$ALLOT = mkUser();
$made = [];   // lecture ids this run created (removed at the end)

// ---------------------------------------------------------------------------------------------- schema
check('schema v8: lectures and lecture_files exist with the columns of §17.3', function () {
    if (Db::schemaVersion() < 8) return 'schema ' . Db::schemaVersion();
    foreach (['id', 'title', 'kind', 'src', 'place', 'autoplay', 'audience', 'sort', 'enabled', 'created_at', 'updated_at'] as $c) if (!Db::hasColumn('lectures', $c)) return "lectures.$c is missing";
    foreach (['id', 'lecture_id', 'n', 'mime', 'bytes', 'w', 'h', 'path', 'sha256'] as $c) if (!Db::hasColumn('lecture_files', $c)) return "lecture_files.$c is missing";
    return true;
});
check('schema: the migration runs again without an error (idempotent statements)', function () use ($srv) {
    $sql = (string) file_get_contents($srv . '/database/' . (Db::driver() === 'mysql' ? 'schema.sql' : 'schema.sqlite.sql'));
    $n = 0;
    foreach (Db::splitSql($sql) as $s) if (preg_match('/lecture/i', $s)) { Db::pdo()->exec($s); $n++; }
    return $n >= 3 ? true : "only $n lecture statements";
});

// ---------------------------------------------------------------------------------------------- addresses
check('youtube: every usual address form gives the 11-character id', function () {
    $id = 'dQw4w9WgXcQ';
    $forms = [$id, "https://www.youtube.com/watch?v=$id", "https://youtu.be/$id", "https://youtu.be/$id?t=42", "youtube.com/watch?v=$id&list=PL1&t=3s", "https://m.youtube.com/watch?feature=share&v=$id",
        "https://www.youtube.com/embed/$id?rel=0", "https://www.youtube-nocookie.com/embed/$id", "https://www.youtube.com/shorts/$id", "https://www.youtube.com/live/$id?si=abc", "//www.youtube.com/watch?v=$id",
        "http://youtube.com/watch?v=$id#t=1", "  https://youtu.be/$id  ", "https://music.youtube.com/watch?v=$id", "HTTPS://WWW.YOUTUBE.COM/watch?v=$id", "https://www.youtube.com/watch?v=dQw4w9WgXc%51", "www.youtube.com/v/$id"];
    foreach ($forms as $f) if (Lecture::youtubeId($f) !== $id) return "not recognised: $f → " . var_export(Lecture::youtubeId($f), true);
    return true;
});
check('youtube: hostile and wrong forms are refused (look-alike hosts, userinfo, ports, other schemes, bad ids, markup)', function () {
    $id = 'dQw4w9WgXcQ';
    $bad = ['', ' ', 'dQw4w9WgXc', $id . 'Q', "https://evil.example/watch?v=$id", "https://youtube.com.evil.example/watch?v=$id", "https://youtube.com@evil.example/watch?v=$id", "https://evil.example/?u=https://youtube.com/watch?v=$id",
        "https://evil.example/youtube.com/watch?v=$id", "javascript:alert(1)//youtube.com/watch?v=$id", 'data:text/html,<script>alert(1)</script>', "https://www.youtube.com/watch?v=$id\"onload=\"x", 'https://www.youtube.com/watch?v=<script>',
        "https://www.youtube.com/watch?v=$id&v=AAAAAAAAAAA", "https://www.youtube.com/watch?v[]=$id", "https://www.youtube.com:8443/watch?v=$id", "https://www.youtube.com\\@evil.example/watch?v=$id", 'https://www.youtube.com/channel/UCabcdefghijk',
        'https://www.youtube.com/playlist?list=PLabcdefghijk', "ftp://youtube.com/watch?v=$id", "https://\u{443}outube.com/watch?v=$id", "https://youtu.be/$id/extra", "https://www.youtube.com/embed/../watch?v=$id", "https://[::1]/watch?v=$id",
        "https://127.0.0.1/watch?v=$id", str_repeat('a', 3000), "https://www.youtube.com/watch?v=$id%00", "https://www.youtube.com/watch?v=dQw4w9WgXc%00", "https://www.youtube.com/watch?v=dQw4w 9WgXcQ", "https://www.youtube.com/watch?v=$id\nX",
        "https://www.youtube.com/watch?v=dQw4w9WgXc\u{200B}Q", "vbscript:youtube.com/watch?v=$id", "https://youtube.com%2eevil.example/watch?v=$id", "https://www.youtube.com./watch?v=$id", "https://www.youtube.com/watch?x=$id"];
    foreach ($bad as $b) if (Lecture::youtubeId($b) !== null) return 'accepted: ' . substr($b, 0, 70) . ' → ' . Lecture::youtubeId($b);
    return true;
});
check('slides: allow-listed hosts only, https only, built again from checked pieces', function () {
    $pub = '2PACX-testtesttesttesttesttesttest';
    $a = Lecture::slidesUrl("https://docs.google.com/presentation/d/e/$pub/pub?start=true&loop=true&delayms=1&x=y");
    if ($a !== "https://docs.google.com/presentation/d/e/$pub/embed?start=false&loop=false&delayms=60000") return "published: $a";
    $b = Lecture::slidesUrl('https://docs.google.com/presentation/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789abcd/edit#slide=id.p');
    if ($b !== 'https://docs.google.com/presentation/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789abcd/preview') return "shared: $b";
    $c = Lecture::slidesUrl('https://view.officeapps.live.com/op/view.aspx?src=https%3A%2F%2Fexample.org%2Fa%20b.pptx');
    if ($c !== 'https://view.officeapps.live.com/op/embed.aspx?src=' . rawurlencode('https://example.org/a%20b.pptx')) return "office: $c";
    foreach (["http://docs.google.com/presentation/d/e/$pub/pub", 'https://docs.google.com/forms/d/e/abc/viewform', "https://docs.google.com.evil.example/presentation/d/e/$pub/pub", "https://docs.google.com@evil.example/presentation/d/e/$pub/pub",
        'https://view.officeapps.live.com/op/view.aspx?src=javascript:alert(1)', 'https://view.officeapps.live.com/op/view.aspx?src=http://example.org/a.pptx', 'https://docs.google.com/presentation/d/e/../../../evil/pub',
        "https://docs.google.com:444/presentation/d/e/$pub/pub", 'https://slides.example.org/deck', 'https://view.officeapps.live.com/op/other.aspx?src=https://example.org/a.pptx', "https://docs.google.com/presentation/d/e/$pub/pub/extra", "https://docs.google.com/presentation/d/e/$pub/pub?x=<script>alert(1)</script>",
        "https://docs.google.com/presentation/d/e/$pub/pub\"onload=\"alert(1)"] as $bad) {
        if (Lecture::slidesUrl($bad) !== null) return "accepted: $bad";
    }
    return true;
});
check('link: https only, no userinfo, percent-encoded; classify() tells video / slides / link apart and refuses the rest', function () {
    if (Lecture::linkUrl('https://ko.wikipedia.org/wiki/된장') !== 'https://ko.wikipedia.org/wiki/%EB%90%9C%EC%9E%A5') return 'hangul path';
    if (Lecture::linkUrl('https://example.org:8443/a?b=c#d') !== 'https://example.org:8443/a?b=c#d') return 'port';
    foreach (['http://example.org/', 'https://user:pw@example.org/', 'https://example.org/<script>', 'https://localhost/x', 'javascript:alert(1)', 'https://example.org/a"b', 'https://example.org/a b', 'file:///etc/passwd', '//example.org/x', 'https://[::1]/'] as $bad) {
        if (Lecture::linkUrl($bad) !== null) return "accepted: $bad";
    }
    $c = Lecture::classify('https://youtu.be/dQw4w9WgXcQ');
    if (!$c || $c['kind'] !== 'youtube' || $c['src'] !== 'dQw4w9WgXcQ') return 'classify video';
    $c = Lecture::classify('https://www.kma.go.kr/');
    if (!$c || $c['kind'] !== 'link') return 'classify link';
    foreach (['https://www.youtube.com/@channel', 'https://docs.google.com/document/d/abc', 'nonsense', '', 'https://www.youtube.com/playlist?list=PL1'] as $bad) if (Lecture::classify($bad) !== null) return "classified: $bad";
    return true;
});

// ---------------------------------------------------------------------------------------------- admin operations
check('create: only an administrator; the kind is what the address is; the title is cleaned text; place and audience are checked', function () use ($ADMIN, $MEMBER, &$made) {
    if (code(function () use ($MEMBER) { Lecture::create($MEMBER, ['title' => 'x', 'address' => 'https://youtu.be/dQw4w9WgXcQ']); }) !== 'FORBIDDEN') return 'a player created a lecture';
    $l = Lecture::create($ADMIN, ['title' => "  된장  이야기\u{200B}<b> ", 'address' => 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=5', 'place' => 'PL_DAECHEONG', 'audience' => 'all', 'autoplay' => '1']);
    $made[] = $l['id'];
    if ($l['kind'] !== 'youtube' || $l['src'] !== 'dQw4w9WgXcQ') return 'kind / src: ' . $l['kind'] . ' ' . $l['src'];
    if ($l['title'] !== '된장 이야기 <b>') return 'title: ' . json_encode($l['title'], JSON_UNESCAPED_UNICODE);
    if ($l['place'] !== 'PL_DAECHEONG' || !$l['autoplay'] || !$l['enabled'] || $l['audience'] !== 'all') return 'fields';
    foreach ([['title' => '', 'address' => 'https://youtu.be/dQw4w9WgXcQ'], ['title' => str_repeat('가', 81), 'address' => 'https://youtu.be/dQw4w9WgXcQ'], ['title' => 'x', 'address' => 'javascript:alert(1)'],
        ['title' => 'x', 'address' => 'https://youtu.be/dQw4w9WgXcQ', 'place' => '../etc'], ['title' => 'x', 'address' => 'https://youtu.be/dQw4w9WgXcQ', 'place' => 'PL_<script>'],
        ['title' => 'x', 'address' => 'https://youtu.be/dQw4w9WgXcQ', 'audience' => 'everyone'], ['title' => ['x'], 'address' => 'https://youtu.be/dQw4w9WgXcQ'], ['title' => 'x']] as $bad) {
        $c = code(function () use ($ADMIN, $bad) { Lecture::create($ADMIN, $bad); });
        if ($c !== 'INVALID_INPUT' && $c !== 'LECTURE_ADDRESS') return 'accepted: ' . json_encode($bad, JSON_UNESCAPED_UNICODE) . " ($c)";
    }
    return true;
});
check('update / switch / reorder / delete: values change, the order moves by one step, every change is an audit row', function () use ($ADMIN, &$made) {
    $a = Lecture::create($ADMIN, ['title' => '가', 'address' => 'https://youtu.be/aaaaaaaaaaa']);
    $b = Lecture::create($ADMIN, ['title' => '나', 'address' => 'https://example.org/b']);
    $c = Lecture::create($ADMIN, ['title' => '다', 'address' => 'https://docs.google.com/presentation/d/e/2PACX-testtesttesttesttesttesttest/pub']);
    $made[] = $a['id']; $made[] = $b['id']; $made[] = $c['id'];
    if ($b['kind'] !== 'link' || $c['kind'] !== 'slides') return 'kinds';
    $u = Lecture::update($ADMIN, $b['id'], ['title' => '나 (고침)', 'address' => 'https://youtu.be/bbbbbbbbbbb', 'place' => '*', 'audience' => 'member', 'autoplay' => '0', 'enabled' => '0']);
    if ($u['kind'] !== 'youtube' || $u['src'] !== 'bbbbbbbbbbb' || $u['place'] !== '*' || $u['audience'] !== 'member' || $u['enabled']) return 'update';
    if (!Lecture::setEnabled($ADMIN, $b['id'], true)['enabled']) return 'switch on';
    $order = function () use ($a, $b, $c) { $o = []; foreach (Lecture::all() as $l) if (in_array($l['id'], [$a['id'], $b['id'], $c['id']], true)) $o[] = $l['id']; return $o; };
    if ($order() !== [$a['id'], $b['id'], $c['id']]) return 'initial order';
    Lecture::move($ADMIN, $c['id'], -1);
    if ($order() !== [$a['id'], $c['id'], $b['id']]) return 'move up';
    Lecture::move($ADMIN, $a['id'], 1);
    if ($order() !== [$c['id'], $a['id'], $b['id']]) return 'move down';
    Lecture::delete($ADMIN, $a['id']);
    if (Lecture::get($a['id']) !== null) return 'delete';
    $events = array_column(Db::all("SELECT event FROM audit_log WHERE event LIKE 'lecture_%' ORDER BY id DESC LIMIT 40"), 'event');
    foreach (['lecture_created', 'lecture_updated', 'lecture_switched', 'lecture_moved', 'lecture_deleted'] as $ev) if (!in_array($ev, $events, true)) return "no audit row $ev";
    if (code(function () use ($ADMIN) { Lecture::update($ADMIN, 99999999, ['title' => 'x']); }) !== 'NOT_FOUND') return 'unknown id';
    return true;
});

// ---------------------------------------------------------------------------------------------- uploads: acceptance
$PDF = pdfBytes('Lecture one');
$PPTX = zipBytes(pptxEntries(3));
check('upload pdf: a real pdf is stored under data/lectures with a random .bin name, its type fixed by the content', function () use ($ADMIN, $PDF, $tmp) {
    $r = Upload::lectureFile($ADMIN, fileOf($PDF), 'pdf', ['trusted' => true]);
    if ($r['mime'] !== 'application/pdf' || $r['bytes'] !== strlen($PDF) || $r['sha256'] !== hash('sha256', $PDF)) return 'record: ' . json_encode($r);
    if (!preg_match('#^\d{4}/\d{2}/[a-f0-9]{32}\.bin$#', $r['path'])) return 'path ' . $r['path'];
    $abs = Lecture::absPath($r['path']);
    if ($abs === null || strpos($abs, $tmp . DIRECTORY_SEPARATOR . 'lectures') !== 0 || file_get_contents($abs) !== $PDF) return 'not stored where it should be';
    if (!is_file($tmp . '/lectures/.htaccess') || !is_file($tmp . '/lectures/index.php')) return 'the folder has no deny rules';
    @unlink($abs);
    return true;
});
check('upload pptx: a real presentation is accepted; its slide count is read from the directory (nothing is extracted)', function () use ($ADMIN, $PPTX) {
    $i = Upload::inspect(fileOf($PPTX)['tmp'], 'pptx');
    if ($i['mime'] !== Lecture::MIME_PPTX || $i['w'] !== 3) return json_encode($i);
    // a slide show (.ppsx) is a presentation too
    $ppsx = zipBytes(pptxEntries(1, [], 'application/vnd.openxmlformats-officedocument.presentationml.slideshow.main+xml'));
    return Upload::inspect(fileOf($ppsx)['tmp'], 'pptx')['w'] === 1;
});
check('upload image: png / jpeg / webp are decoded and encoded again (a large one is scaled down); the stored bytes are new', function () use ($ADMIN) {
    $png = pngBytes(3000, 1500);
    $i = Upload::inspect(fileOf($png)['tmp'], 'image', ['maxDimension' => 1920]);
    if ($i['mime'] !== 'image/png' || $i['w'] !== 1920 || $i['h'] !== 960 || !isset($i['data']) || $i['data'] === $png) return 'png: ' . $i['mime'] . ' ' . $i['w'] . 'x' . $i['h'];
    $im = imagecreatetruecolor(80, 60);
    ob_start(); imagejpeg($im, null, 80); $jpg = (string) ob_get_clean();
    if (Upload::inspect(fileOf($jpg)['tmp'], 'image')['mime'] !== 'image/jpeg') return 'jpeg';
    if (function_exists('imagewebp')) { ob_start(); imagewebp($im, null, 80); $webp = (string) ob_get_clean(); if (Upload::inspect(fileOf($webp)['tmp'], 'image')['mime'] !== 'image/webp') return 'webp'; }
    return true;
});

// ---------------------------------------------------------------------------------------------- uploads: refusals
check('refused pdf: wrong header, markup head, cut-off file, PHP inside, an auto-run script (also spelled with #xx), empty, too large', function () use ($PDF) {
    $cases = [
        'html named pdf' => ['<html><body>hello</body></html>', 'UPLOAD_TYPE'],
        'png named pdf' => [pngBytes(), 'UPLOAD_TYPE'],
        'junk before the header' => ["GIF89a\n" . $PDF, 'UPLOAD_TYPE'],
        'markup right after the header' => ["%PDF-1.4\n<script>alert(1)</script>\n" . substr($PDF, 9), 'UPLOAD_REJECTED'],
        'html polyglot head' => ["%PDF-1.4\n<html><body onload=x>" . substr($PDF, 9), 'UPLOAD_REJECTED'],
        'cut off (no trailer)' => [substr($PDF, 0, (int) (strlen($PDF) / 2)), 'UPLOAD_INVALID'],
        'php deep inside' => [str_replace('endstream', str_repeat('A', 9000) . "<?php system('id'); ?>\nendstream", $PDF), 'UPLOAD_REJECTED'],
        'auto-run javascript' => [pdfBytes('x', '<< /Type /Action /S /JavaScript /JS (app.alert(1)) >>'), 'UPLOAD_REJECTED'],
        'launch action' => [pdfBytes('x', '<< /Type /Action /S /Launch /F (cmd.exe) >>'), 'UPLOAD_REJECTED'],
        'auto-run javascript, the name spelled with #xx' => [pdfBytes('x', '<< /Type /Action /S /J#61v#61Script /JS (app.alert(1)) >>'), 'UPLOAD_REJECTED'],
        'launch action, the name spelled with #xx' => [pdfBytes('x', '<< /Type /Action /S /#4Caunch /F (cmd.exe) >>'), 'UPLOAD_REJECTED'],
        'empty' => ['', 'UPLOAD_EMPTY'],
    ];
    foreach ($cases as $name => $c) { $got = inspectCode($c[0], 'pdf'); if ($got !== $c[1]) return "$name → " . ($got === '' ? 'ACCEPTED' : $got) . " (want {$c[1]})"; }
    $got = inspectCode($PDF . str_repeat("%pad\n", 300), 'pdf', ['maxBytes' => 1024]);
    if ($got !== 'UPLOAD_TOO_LARGE') return "oversize → $got";
    // a marker split across two 1 MB pieces is still found
    $big = str_replace('endstream', str_repeat('B', 1048576 - 200) . str_repeat('C', 190) . '<?php ' . str_repeat('D', 4000) . "\nendstream", $PDF);
    return inspectCode($big, 'pdf') === 'UPLOAD_REJECTED' ? true : 'a marker across a piece boundary was missed';
});
check('refused pptx: not a zip, an old .ppt, a plain zip, a word document, macros, a DTD, an executable inside', function () {
    $docx = zipBytes([['name' => '[Content_Types].xml', 'data' => '<Types><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'], ['name' => 'word/document.xml', 'data' => '<w:document/>']]);
    $cases = [
        'text' => ['hello world, not a zip at all', 'UPLOAD_TYPE'],
        'old .ppt (OLE)' => ["\xD0\xCF\x11\xE0\xA1\xB1\x1A\xE1" . str_repeat("\0", 600), 'UPLOAD_TYPE'],
        'plain zip' => [zipBytes([['name' => 'readme.txt', 'data' => 'hi']]), 'UPLOAD_TYPE'],
        'word document' => [$docx, 'UPLOAD_TYPE'],
        'macro project' => [zipBytes(pptxEntries(1, [['name' => 'ppt/vbaProject.bin', 'data' => 'x']])), 'UPLOAD_REJECTED'],
        'macro content type' => [zipBytes(pptxEntries(1, [], 'application/vnd.ms-powerpoint.presentation.macroEnabled.main+xml')), 'UPLOAD_REJECTED'],
        'executable inside' => [zipBytes(pptxEntries(1, [['name' => 'ppt/media/setup.exe', 'data' => 'MZ']])), 'UPLOAD_REJECTED'],
        'php inside' => [zipBytes(pptxEntries(1, [['name' => 'ppt/media/shell.php', 'data' => '<?php echo 1;']])), 'UPLOAD_REJECTED'],
        'no slides' => [zipBytes(array_values(array_filter(pptxEntries(1), function ($e) { return strpos($e['name'], 'ppt/slides/slide') !== 0; }))), 'UPLOAD_INVALID'],
    ];
    $dtd = pptxEntries(1);
    $dtd[0]['data'] = '<?xml version="1.0"?><!DOCTYPE lolz [<!ENTITY lol "lol">]>' . substr($dtd[0]['data'], 55);
    $cases['dtd in the content types'] = [zipBytes($dtd), 'UPLOAD_REJECTED'];
    foreach ($cases as $name => $c) { $got = inspectCode($c[0], 'pptx'); if ($got !== $c[1]) return "$name → " . ($got === '' ? 'ACCEPTED' : $got) . " (want {$c[1]})"; }
    return true;
});
check('refused pptx: names that leave the archive (../, absolute, backslash, drive, NUL, control characters, trailing dots)', function () {
    foreach (['../evil.php', 'ppt/../../evil.txt', '/etc/passwd', '..\\..\\evil.txt', 'ppt\\slides\\x.xml', 'C:/Windows/x.txt', "ppt/a\0b.xml", "ppt/a\nb.xml", 'ppt//double.xml', 'ppt/./dot.xml', 'ppt/.../x.xml', 'ppt/slides/..', str_repeat('a', 300) . '.xml', "ppt/\xff\xfe.xml"] as $name) {
        $got = inspectCode(zipBytes(pptxEntries(1, [['name' => $name, 'data' => 'x']])), 'pptx');
        if ($got !== 'UPLOAD_REJECTED') return json_encode($name) . ' → ' . ($got === '' ? 'ACCEPTED' : $got);
    }
    foreach (['ppt/media/image 2.png', 'ppt/slides/슬라이드.xml', 'docProps/app.xml', 'ppt/embeddings/'] as $fine) if (!Upload::zipNameOk($fine)) return "a normal name was refused: $fine";
    return true;
});
check('refused pptx: zip bombs — a huge declared size, a 1000:1 entry, too many entries, a total over the limit', function () {
    $huge = zipBytes(pptxEntries(1, [['name' => 'ppt/media/big.bin', 'data' => 'x', 'usize' => 0x7FFFFFFF]]));
    if (($g = inspectCode($huge, 'pptx')) !== 'UPLOAD_REJECTED') return "declared 2 GB → $g";
    $ratio = zipBytes(pptxEntries(1, [['name' => 'ppt/media/zeros.bin', 'data' => str_repeat("\0", 20 * 1048576)]]));
    if (strlen($ratio) > 200000) return 'the bomb did not pack';
    if (($g = inspectCode($ratio, 'pptx')) !== 'UPLOAD_REJECTED') return "20 MB of zeros in " . strlen($ratio) . " bytes → $g";
    $many = [];
    for ($i = 0; $i < 3001; $i++) $many[] = ['name' => "ppt/media/f$i.txt", 'data' => '', 'method' => 0];
    if (($g = inspectCode(zipBytes(pptxEntries(1, $many)), 'pptx')) !== 'UPLOAD_REJECTED') return "3,008 entries → $g";
    $total = [];
    for ($i = 0; $i < 4; $i++) $total[] = ['name' => "ppt/media/t$i.bin", 'data' => 'x', 'usize' => 90 * 1048576, 'csize' => 80 * 1048576];
    if (($g = inspectCode(zipBytes(pptxEntries(1, $total)), 'pptx')) !== 'UPLOAD_REJECTED') return "360 MB declared in total → $g";
    return true;
});
check('refused pptx: a zip that lies — bytes before / after, duplicate names, encrypted, ZIP64, a local header that disagrees, a wrong count', function () {
    $ok = pptxEntries(1);
    $cases = [
        'bytes before the archive' => zipBytes($ok, ['prefix' => "GIF89a<script>alert(1)</script>"]),
        'bytes after the archive' => zipBytes($ok, ['suffix' => "<?php system('id');"]),
        'duplicate name' => zipBytes(array_merge($ok, [['name' => 'ppt/presentation.xml', 'data' => '<other/>']])),
        'duplicate name in another case' => zipBytes(array_merge($ok, [['name' => 'PPT/Presentation.XML', 'data' => '<other/>']])),
        'encrypted entry' => zipBytes(array_merge($ok, [['name' => 'ppt/media/secret.bin', 'data' => 'x', 'flags' => 1]])),
        'zip64 directory' => zipBytes($ok, ['zip64' => true]),
        'zip64 count' => zipBytes($ok, ['total' => 0xFFFF]),
        'local header with another name' => zipBytes(array_merge($ok, [['name' => 'ppt/media/a.png', 'lname' => 'ppt/media/b.exe', 'data' => 'x']])),
        'directory says more entries than there are' => zipBytes($ok, ['total' => count($ok) + 5]),
        'unknown compression method' => zipBytes(array_merge($ok, [['name' => 'ppt/media/x.bin', 'data' => 'x', 'method' => 0, 'flags' => 0x2000]])),
    ];
    foreach ($cases as $name => $bytes) { $g = inspectCode($bytes, 'pptx'); if ($g !== 'UPLOAD_REJECTED' && $g !== 'UPLOAD_TYPE' && $g !== 'UPLOAD_INVALID') return "$name → " . ($g === '' ? 'ACCEPTED' : $g); }
    // an archive inside the archive is allowed to be there and is never opened (its bomb stays packed)
    $inner = zipBytes([['name' => 'bomb.bin', 'data' => str_repeat("\0", 1048576)]]);
    $nested = zipBytes(pptxEntries(1, [['name' => 'ppt/embeddings/inner.zip', 'data' => $inner, 'method' => 0]]));
    $m0 = memory_get_peak_usage();
    if (($g = inspectCode($nested, 'pptx')) !== '') return "a nested archive was refused: $g";
    return memory_get_peak_usage() - $m0 < 8 * 1048576 ? true : 'the nested archive seems to have been unpacked';
});
check('refused image: gif, svg, script in the pixels file, a truncated file, a huge canvas, too large a file', function () {
    $png = pngBytes();
    // a PNG with a text chunk carrying markup (inserted before IEND)
    $chunk = function (string $type, string $data) { return pack('N', strlen($data)) . $type . $data . pack('N', crc32($type . $data)); };
    $evil = substr($png, 0, -12) . $chunk('tEXt', "Comment\0<script>alert(document.domain)</script>") . substr($png, -12);
    $php = substr($png, 0, -12) . $chunk('tEXt', "Comment\0<?php system(\$_GET['c']); ?>") . substr($png, -12);
    $cases = [
        'gif' => ["GIF89a\x01\x00\x01\x00\x80\x00\x00\xff\xff\xff\x00\x00\x00!\xf9\x04\x01\x00\x00\x00\x00,\x00\x00\x00\x00\x01\x00\x01\x00\x00\x02\x02D\x01\x00;", 'UPLOAD_TYPE'],
        'svg with a script' => ['<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>', 'UPLOAD_TYPE'],
        'html named png' => ['<html><script>alert(1)</script></html>', 'UPLOAD_TYPE'],
        'script in a text chunk' => [$evil, 'UPLOAD_REJECTED'],
        'php in a text chunk' => [$php, 'UPLOAD_REJECTED'],
        'png header only' => [substr($png, 0, 20), 'UPLOAD_INVALID'],
    ];
    foreach ($cases as $name => $c) { $got = inspectCode($c[0], 'image'); if ($got !== $c[1] && !($c[1] === 'UPLOAD_INVALID' && $got === 'UPLOAD_TYPE')) return "$name → " . ($got === '' ? 'ACCEPTED' : $got) . " (want {$c[1]})"; }
    if (inspectCode($png, 'image', ['maxBytes' => 50]) !== 'UPLOAD_TOO_LARGE') return 'oversize';
    // 13000 x 13000 declared in the header (no pixels behind it): refused before any decoding
    $ihdr = pack('NNCCCCC', 13000, 13000, 8, 2, 0, 0, 0);
    $bomb = "\x89PNG\r\n\x1a\n" . $chunk('IHDR', $ihdr) . $chunk('IDAT', gzcompress(str_repeat("\0", 100))) . $chunk('IEND', '');
    $got = inspectCode($bomb, 'image');
    return in_array($got, ['UPLOAD_DIMENSIONS', 'UPLOAD_INVALID'], true) ? true : "13000×13000 → $got";
});
check('refusals are recorded: an audit row and a security event (hostile = warn, a plain mistake = info), never the file name', function () {
    $ev = Db::all("SELECT kind, severity, detail FROM security_events WHERE kind = 'upload_rejected' ORDER BY id DESC LIMIT 200");
    $sev = array_count_values(array_column($ev, 'severity'));
    if (empty($sev['warn']) || empty($sev['info'])) return 'severities: ' . json_encode($sev);
    $audit = (int) Db::value("SELECT COUNT(*) FROM audit_log WHERE event = 'upload_rejected'");
    return $audit >= 20 ? true : "only $audit audit rows";
});
check('lectureFile: only an administrator; a path that is not an upload is refused unless the caller vouches for it; error codes of PHP are words', function () use ($ADMIN, $MEMBER, $PDF) {
    if (code(function () use ($MEMBER, $PDF) { Upload::lectureFile($MEMBER, fileOf($PDF), 'pdf', ['trusted' => true]); }) !== 'FORBIDDEN') return 'a player stored a file';
    if (code(function () use ($ADMIN, $PDF) { Upload::lectureFile($ADMIN, fileOf($PDF), 'pdf'); }) !== 'UPLOAD_FAILED') return 'a local path passed as an upload';
    if (code(function () use ($ADMIN) { Upload::lectureFile($ADMIN, ['tmp' => '/etc/passwd', 'size' => 10, 'error' => UPLOAD_ERR_OK], 'pdf'); }) !== 'UPLOAD_FAILED') return '/etc/passwd';
    if (code(function () use ($ADMIN) { Upload::lectureFile($ADMIN, ['tmp' => '', 'size' => 0, 'error' => UPLOAD_ERR_INI_SIZE], 'pdf'); }) !== 'UPLOAD_TOO_LARGE') return 'ini size';
    if (code(function () use ($ADMIN) { Upload::lectureFile($ADMIN, ['tmp' => '', 'size' => 0, 'error' => UPLOAD_ERR_NO_FILE], 'pdf'); }) !== 'UPLOAD_MISSING') return 'no file';
    if (code(function () use ($ADMIN, $PDF) { Upload::lectureFile($ADMIN, fileOf($PDF), 'exe', ['trusted' => true]); }) !== 'INVALID_INPUT') return 'kind';
    return true;
});

// ---------------------------------------------------------------------------------------------- files of a lecture
$IDS = [];
check('files: a pdf lecture gets its document, replacing removes the old file; an image deck keeps order, moves, removes and stops at the limit', function () use ($ADMIN, $PDF, $PPTX, &$made, &$IDS) {
    $p = Lecture::create($ADMIN, ['title' => 'PDF 강의', 'kind' => 'pdf', 'place' => 'PL_SARANG']);
    $made[] = $p['id'];
    $r1 = Upload::lectureFile($ADMIN, fileOf($PDF), 'pdf', ['trusted' => true]);
    $p = Lecture::setDocument($ADMIN, $p['id'], $r1);
    if (count($p['files']) !== 1 || $p['files'][0]['n'] !== 0) return 'document';
    $r2 = Upload::lectureFile($ADMIN, fileOf(pdfBytes('Lecture two')), 'pdf', ['trusted' => true]);
    $p = Lecture::setDocument($ADMIN, $p['id'], $r2);
    if (count($p['files']) !== 1 || $p['files'][0]['sha256'] !== $r2['sha256'] || Lecture::absPath($r1['path']) !== null) return 'replace';
    // the wrong kind of file for a lecture
    $rx = Upload::lectureFile($ADMIN, fileOf($PPTX), 'pptx', ['trusted' => true]);
    if (code(function () use ($ADMIN, $p, $rx) { Lecture::setDocument($ADMIN, $p['id'], $rx); }) !== 'INVALID_INPUT') return 'a pptx went into a pdf lecture';
    $x = Lecture::create($ADMIN, ['title' => 'PPTX 강의', 'kind' => 'pptx', 'audience' => 'member']);
    $made[] = $x['id'];
    $x = Lecture::setDocument($ADMIN, $x['id'], $rx);
    if ($x['files'][0]['w'] !== 3) return 'slide count';
    // a forged record (a path outside the store) is refused
    $forged = $r2; $forged['path'] = '../../config/config.php';
    try { Lecture::setDocument($ADMIN, $p['id'], $forged); return 'a forged path was stored'; } catch (RuntimeException $e) { /* expected */ }
    $d = Lecture::create($ADMIN, ['title' => '그림 강의', 'kind' => 'images', 'place' => '*']);
    $made[] = $d['id'];
    $shas = [];
    foreach ([[200, 30, 30], [30, 200, 30], [30, 30, 200]] as $rgb) { $r = Upload::lectureFile($ADMIN, fileOf(pngBytes(64, 36, $rgb)), 'image', ['trusted' => true]); $shas[] = $r['sha256']; $d = Lecture::addImage($ADMIN, $d['id'], $r); }
    $seq = function (array $l) { return array_map(function ($f) { return $f['sha256']; }, $l['files']); };
    if ($seq($d) !== $shas) return 'deck order';
    $d = Lecture::moveFile($ADMIN, $d['id'], 2, -1);
    if ($seq($d) !== [$shas[0], $shas[2], $shas[1]]) return 'move a picture';
    $gone = $d['files'][0]['path'];
    $d = Lecture::removeFile($ADMIN, $d['id'], 0);
    if ($seq($d) !== [$shas[2], $shas[1]] || array_map(function ($f) { return $f['n']; }, $d['files']) !== [0, 1] || Lecture::absPath($gone) !== null) return 'remove a picture';
    Lecture::setOption($ADMIN, 'images_max', '2');
    $r = Upload::lectureFile($ADMIN, fileOf(pngBytes(64, 36, [9, 9, 9])), 'image', ['trusted' => true]);
    $c = code(function () use ($ADMIN, $d, $r) { Lecture::addImage($ADMIN, $d['id'], $r); });
    Lecture::setOption($ADMIN, 'images_max', '80');
    if ($c !== 'LECTURE_LIMIT') return "a third picture over the limit → $c";
    $IDS = ['pdf' => $p['id'], 'pptx' => $x['id'], 'deck' => $d['id']];
    return Lecture::storageUsed() > 0;
});
check('settings: validated, stored in the settings table, audited; the allow-list can only shrink', function () use ($ADMIN) {
    Lecture::setOption($ADMIN, 'pdf_max_bytes', '12');
    if (Lecture::limits()['pdf'] !== 12 * 1048576) return 'pdf limit';
    Lecture::setOption($ADMIN, 'pdf_max_bytes', '30');
    foreach ([['pdf_max_bytes', '0'], ['pdf_max_bytes', '9999'], ['pdf_max_bytes', 'abc'], ['images_max', '-1'], ['nope', '1']] as $b) if (code(function () use ($ADMIN, $b) { Lecture::setOption($ADMIN, $b[0], $b[1]); }) !== 'INVALID_SETTING') return 'accepted ' . json_encode($b);
    Lecture::setOption($ADMIN, 'slide_hosts', ['docs.google.com', 'evil.example']);
    if (Lecture::slideHosts() !== ['docs.google.com']) return 'hosts: ' . json_encode(Lecture::slideHosts());
    if (Lecture::slidesUrl('https://view.officeapps.live.com/op/embed.aspx?src=https://example.org/a.pptx') !== null) return 'a switched-off host was accepted';
    Lecture::setOption($ADMIN, 'slide_hosts', Lecture::SLIDE_HOSTS);
    return (int) Db::value("SELECT COUNT(*) FROM audit_log WHERE event = 'setting_changed' AND detail LIKE '%lecture.%'") >= 4;
});
check('registry: the ⚙️ 설정 tab lists the lecture rows; a value saved there is the value the library reads, and the other way round', function () use ($ADMIN, &$made) {
    $rows = Tfm\Settings::rows('lecture');
    foreach (['lecture.auto_open' => 'bool', 'lecture.office_viewer' => 'bool', 'lecture.slide_hosts' => 'list', 'lecture.images_max' => 'int'] as $k => $t) {
        if (!isset($rows[$k]) || $rows[$k]['type'] !== $t || $rows[$k]['public'] !== false) return "row $k";
    }
    $aid = (int) $ADMIN['id'];
    $s = Lecture::create($ADMIN, ['title' => '구글 슬라이드', 'address' => 'https://docs.google.com/presentation/d/e/2PACX-testtesttesttesttesttesttest/pub', 'audience' => 'all']);
    $made[] = $s['id'];
    $offered = function () use ($s) { return in_array($s['id'], array_column(Lecture::publicList(null)['lectures'], 'id'), true); };
    $v0 = Lecture::publicList(null);
    if (!$offered() || $v0['opt']['autoOpen'] !== true) return 'before: ' . json_encode($v0['opt']);
    // ⚙️ 설정 → the library (and the version of the list moves, so a page that holds the list asks again)
    Tfm\Settings::set('lecture.auto_open', '0', $aid);
    $v1 = Lecture::publicList(null);
    if ($v1['opt']['autoOpen'] !== false || $v1['v'] === $v0['v']) return 'auto-open did not follow the registry, or the version stayed';
    // 🎓 강의 자료 → the registry
    Lecture::setOption($ADMIN, 'auto_open', '1');
    if (Tfm\Settings::get('lecture.auto_open') !== true || Lecture::publicList(null)['v'] !== $v0['v']) return 'the registry did not follow the lecture tab';
    Tfm\Settings::set('lecture.images_max', '7', $aid);
    if (Lecture::limits()['images'] !== 7) return 'images_max: ' . Lecture::limits()['images'];
    if (!Tfm\Settings::clear('lecture.images_max', $aid) || Lecture::limits()['images'] !== 80) return 'the default did not come back';
    // a host switched off in ⚙️ 설정: its lectures leave the list, new ones are refused, the Office viewer is never offered
    Tfm\Settings::set('lecture.slide_hosts', ['view.officeapps.live.com'], $aid);
    if ($offered()) return 'a slides lecture of a switched-off host is still offered';
    if (code(function () use ($ADMIN) { Lecture::create($ADMIN, ['title' => '또 하나', 'address' => 'https://docs.google.com/presentation/d/e/2PACX-testtesttesttesttesttesttest/pub']); }) === '') return 'a switched-off host was accepted';
    foreach ([['lecture.slide_hosts', ['evil.example']], ['lecture.images_max', '0'], ['lecture.images_max', '201'], ['lecture.auto_open', 'maybe'], ['lecture.pdf_max_bytes', '1']] as $b) {
        if (code(function () use ($b, $aid) { Tfm\Settings::set($b[0], $b[1], $aid); }) !== 'INVALID_SETTING') return 'the registry accepted ' . json_encode($b);
    }
    Tfm\Settings::set('lecture.slide_hosts', Lecture::SLIDE_HOSTS, $aid);
    return $offered() ? true : 'the lecture did not come back with its host';
});

// ---------------------------------------------------------------------------------------------- audience
check('audience: the list is filtered for a visitor, a member, a paid account, an allotment holder and an administrator', function () use ($ADMIN, $MEMBER, $PAID, $ALLOT, &$made, &$IDS) {
    $mk = function (string $aud) use ($ADMIN, &$made) { $l = Lecture::create($ADMIN, ['title' => "대상 $aud", 'address' => 'https://youtu.be/aaaaaaaaaa' . substr($aud, 0, 1), 'audience' => $aud]); $made[] = $l['id']; return $l['id']; };
    $A = ['all' => $mk('all'), 'member' => $mk('member'), 'paid' => $mk('paid'), 'allot' => $mk('allot')];
    $off = Lecture::create($ADMIN, ['title' => '꺼진 강의', 'address' => 'https://youtu.be/ccccccccccc', 'enabled' => '0']);
    $made[] = $off['id'];
    Tfm\Subscription::grant($ADMIN, (int) $PAID['id'], 2, 30);
    $now = Tfm\Clock::ms();
    Db::insert('allot_contracts', ['contract_no' => 'LEC-' . bin2hex(random_bytes(5)), 'unit_id' => 987654, 'customer_id' => 987654, 'user_id' => (int) $ALLOT['id'], 'status' => 'active', 'created_at' => $now, 'updated_at' => $now]);
    $see = function (?array $u) use ($A, $off) {
        $ids = array_column(Lecture::publicList($u)['lectures'], 'id');
        $s = '';
        foreach ($A as $k => $id) $s .= in_array($id, $ids, true) ? $k[0] : '-';
        return $s . (in_array($off['id'], $ids, true) ? '!' : '');
    };
    $got = ['visitor' => $see(null), 'member' => $see($MEMBER), 'paid' => $see(Tfm\Users::byId((int) $PAID['id'])), 'allot' => $see($ALLOT), 'admin' => $see($ADMIN)];
    $want = ['visitor' => 'a---', 'member' => 'am--', 'paid' => 'amp-', 'allot' => 'am-a', 'admin' => 'ampa'];
    if ($got !== $want) return json_encode($got);
    $IDS['aud'] = $A;
    $IDS['off'] = $off['id'];
    return true;
});
check('audience: the same rule guards every file — a visitor gets the same 404 for a member file, a switched-off lecture and an unknown id', function () use ($ADMIN, $MEMBER, &$IDS) {
    if (!isset($IDS['pptx'])) return 'no lectures';
    $f = Lecture::fileFor($IDS['pdf'], 0, null);
    if ($f['mime'] !== 'application/pdf') return 'the public pdf';
    if (code(function () use ($IDS) { Lecture::fileFor($IDS['pptx'], 0, null); }) !== 'NOT_FOUND') return 'a visitor got a member file';
    if (Lecture::fileFor($IDS['pptx'], 0, $MEMBER)['mime'] !== Lecture::MIME_PPTX) return 'a member did not get the member file';
    Lecture::setEnabled($ADMIN, $IDS['pptx'], false);
    $c1 = code(function () use ($IDS, $ADMIN) { Lecture::fileFor($IDS['pptx'], 0, $ADMIN); });
    Lecture::setEnabled($ADMIN, $IDS['pptx'], true);
    if ($c1 !== 'NOT_FOUND') return 'a switched-off file was served';
    foreach ([[$IDS['pdf'], 1], [$IDS['pdf'], 999], [99999999, 0], [$IDS['deck'], 2]] as $q) if (code(function () use ($q) { Lecture::fileFor($q[0], $q[1], null); }) !== 'NOT_FOUND') return 'found ' . json_encode($q);
    return true;
});
check('list shape: {v, lectures: [{id, title, kind, yt | url | files, place, autoplay, sort}], opt}; no path, no hash, no audience leaves the server', function () use ($ADMIN, &$IDS) {
    $l = Lecture::publicList($ADMIN);
    if (!is_int($l['v']) || !isset($l['opt']['autoOpen'])) return 'v / opt';
    $json = json_encode($l, JSON_UNESCAPED_UNICODE);
    foreach (['"path"', '"sha256"', '"audience"', '.bin', '"src"', '"enabled"'] as $leak) if (strpos($json, $leak) !== false) return "the answer carries $leak";
    $by = [];
    foreach ($l['lectures'] as $x) $by[$x['id']] = $x;
    $d = $by[$IDS['deck']];
    if ($d['kind'] !== 'images' || count($d['files']) !== 2 || $d['files'][0]['type'] !== 'image/png' || $d['files'][0]['w'] !== 64 || $d['place'] !== '*') return 'deck: ' . json_encode($d);
    $yt = $by[$IDS['aud']['all']];
    if ($yt['kind'] !== 'youtube' || !preg_match('/^[A-Za-z0-9_-]{11}$/', $yt['yt']) || isset($yt['url'])) return 'video: ' . json_encode($yt);
    $sorts = array_column($l['lectures'], 'sort');
    $sorted = $sorts; sort($sorted);
    return $sorts === $sorted ? true : 'not in list order';
});

// ---------------------------------------------------------------------------------------------- HTTP: headers, ranges
$PORT = (int) (getenv('TFM_LECTURE_PORT') ?: 25210);
$proc = proc_open(['php', '-S', "127.0.0.1:$PORT", '-t', $srv], [0 => ['file', '/dev/null', 'r'], 1 => ['file', '/dev/null', 'w'], 2 => ['file', "$root/php-server.log", 'w']], $pipes);
for ($i = 0; $i < 60; $i++) { $s = @fsockopen('127.0.0.1', $PORT, $en, $es, 0.2); if ($s) { fclose($s); break; } usleep(100000); }
/** one request → ['status', 'headers' (lower-case names), 'body'] */
function http(string $path, array $headers = [], string $method = 'GET'): array
{
    global $PORT;
    $ch = curl_init("http://127.0.0.1:$PORT/$path");
    curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_HEADER => true, CURLOPT_CUSTOMREQUEST => $method, CURLOPT_NOBODY => $method === 'HEAD', CURLOPT_HTTPHEADER => $headers, CURLOPT_TIMEOUT => 20]);
    $raw = (string) curl_exec($ch);
    $hs = (int) curl_getinfo($ch, CURLINFO_HEADER_SIZE);
    $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    $h = [];
    foreach (explode("\r\n", substr($raw, 0, $hs)) as $line) if (strpos($line, ':') !== false) { list($k, $v) = explode(':', $line, 2); $h[strtolower(trim($k))] = trim($v); }
    return ['status' => $status, 'headers' => $h, 'body' => substr($raw, $hs)];
}
check('HTTP list.php: a visitor gets the public lectures as JSON; ?v= of the same version answers {same: true}; an unknown parameter is a 400; POST is a 405', function () use (&$IDS) {
    $r = http('api/lecture/list.php');
    $j = json_decode($r['body'], true);
    if ($r['status'] !== 200 || empty($j['success']) || !is_array($j['data']['lectures'])) return 'status ' . $r['status'] . ' ' . substr($r['body'], 0, 120);
    $ids = array_column($j['data']['lectures'], 'id');
    if (!in_array($IDS['pdf'], $ids, true) || in_array($IDS['pptx'], $ids, true) || in_array($IDS['aud']['member'], $ids, true) || in_array($IDS['off'], $ids, true)) return 'a visitor sees ' . json_encode($ids);
    if (stripos($r['headers']['content-type'], 'application/json') !== 0 || ($r['headers']['x-content-type-options'] ?? '') !== 'nosniff') return 'headers';
    $same = json_decode(http('api/lecture/list.php?v=' . $j['data']['v'])['body'], true);
    if (empty($same['data']['same'])) return 'same';
    foreach (['x=1', 'v=abc', 'v[]=1', 'v=-1'] as $q) if (http("api/lecture/list.php?$q")['status'] !== 400) return "accepted ?$q";
    return http('api/lecture/list.php', [], 'POST')['status'] === 405;
});
check('HTTP file.php (pdf): the stored type, nosniff, inline, private cache, ETag, a sandbox policy that lets only this site frame it, the exact bytes', function () use (&$IDS, $ADMIN) {
    $f = Lecture::get($IDS['pdf'])['files'][0];
    $bytes = (string) file_get_contents((string) Lecture::absPath($f['path']));
    $r = http('api/lecture/file.php?id=' . $IDS['pdf'] . '&n=0');
    $h = $r['headers'];
    if ($r['status'] !== 200 || $r['body'] !== $bytes) return 'status ' . $r['status'] . ', ' . strlen($r['body']) . ' bytes';
    if (($h['content-type'] ?? '') !== 'application/pdf') return 'type ' . ($h['content-type'] ?? '');
    if (($h['x-content-type-options'] ?? '') !== 'nosniff') return 'nosniff';
    if (($h['content-disposition'] ?? '') !== 'inline; filename="lecture-' . $IDS['pdf'] . '.pdf"') return 'disposition ' . ($h['content-disposition'] ?? '');
    if (!preg_match('/^private\b/', $h['cache-control'] ?? '')) return 'cache ' . ($h['cache-control'] ?? '');
    $csp = $h['content-security-policy'] ?? '';
    if (strpos($csp, "default-src 'none'") === false || strpos($csp, 'sandbox') === false || strpos($csp, "frame-ancestors 'self'") === false) return "csp $csp";
    if (($h['x-frame-options'] ?? '') !== 'SAMEORIGIN' || ($h['accept-ranges'] ?? '') !== 'bytes' || (int) ($h['content-length'] ?? 0) !== strlen($bytes) || empty($h['etag'])) return 'frame / ranges / length / etag';
    if (isset($h['x-powered-by']) || isset($h['set-cookie'])) return 'x-powered-by / a cookie';
    $n = http('api/lecture/file.php?id=' . $IDS['pdf'], ['If-None-Match: ' . $h['etag']]);
    if ($n['status'] !== 304 || $n['body'] !== '') return '304: ' . $n['status'];
    $hd = http('api/lecture/file.php?id=' . $IDS['pdf'], [], 'HEAD');
    return $hd['status'] === 200 && $hd['body'] === '' && (int) $hd['headers']['content-length'] === strlen($bytes) ? true : 'HEAD';
});
check('HTTP file.php: byte ranges — first bytes, an open end, the last bytes, past the end (416), several ranges (the whole file), If-Range', function () use (&$IDS) {
    $f = Lecture::get($IDS['pdf'])['files'][0];
    $bytes = (string) file_get_contents((string) Lecture::absPath($f['path']));
    $size = strlen($bytes);
    $u = 'api/lecture/file.php?id=' . $IDS['pdf'];
    $a = http($u, ['Range: bytes=0-9']);
    if ($a['status'] !== 206 || $a['body'] !== substr($bytes, 0, 10) || ($a['headers']['content-range'] ?? '') !== "bytes 0-9/$size" || (int) $a['headers']['content-length'] !== 10) return 'first ten: ' . $a['status'] . ' ' . ($a['headers']['content-range'] ?? '');
    $b = http($u, ['Range: bytes=100-']);
    if ($b['status'] !== 206 || $b['body'] !== substr($bytes, 100) || ($b['headers']['content-range'] ?? '') !== 'bytes 100-' . ($size - 1) . "/$size") return 'open end';
    $c = http($u, ['Range: bytes=-7']);
    if ($c['status'] !== 206 || $c['body'] !== substr($bytes, -7)) return 'last seven';
    $d = http($u, ['Range: bytes=5-' . ($size + 5000)]);
    if ($d['status'] !== 206 || $d['body'] !== substr($bytes, 5)) return 'an end past the file is cut to the file';
    $e = http($u, ['Range: bytes=' . ($size + 10) . '-']);
    if ($e['status'] !== 416 || ($e['headers']['content-range'] ?? '') !== "bytes */$size" || $e['body'] !== '') return '416: ' . $e['status'];
    foreach (['bytes=0-1,5-6', 'items=0-5', 'bytes=abc', 'bytes=-', 'bytes=9-2x'] as $odd) { $r = http($u, ["Range: $odd"]); if ($r['status'] !== 200 || $r['body'] !== $bytes) return "Range: $odd → " . $r['status']; }
    if (http($u, ['Range: bytes=9-2'])['status'] !== 416) return 'a backwards range';
    $etag = $a['headers']['etag'];
    if (http($u, ['Range: bytes=0-9', "If-Range: $etag"])['status'] !== 206) return 'If-Range with the right tag';
    $g = http($u, ['Range: bytes=0-9', 'If-Range: "something-else"']);
    return $g['status'] === 200 && $g['body'] === $bytes ? true : 'If-Range with another tag must send the whole file';
});
check('HTTP file.php: a picture is inline with its image type and a sandbox; a pptx is always a download', function () use ($ADMIN, &$IDS) {
    $r = http('api/lecture/file.php?id=' . $IDS['deck'] . '&n=1');
    $h = $r['headers'];
    if ($r['status'] !== 200 || ($h['content-type'] ?? '') !== 'image/png' || strpos($h['content-disposition'] ?? '', 'inline; filename="lecture-' . $IDS['deck'] . '-2.png"') !== 0) return 'picture: ' . $r['status'] . ' ' . ($h['content-type'] ?? '') . ' ' . ($h['content-disposition'] ?? '');
    if (strpos($h['content-security-policy'] ?? '', 'sandbox') === false || ($h['x-frame-options'] ?? '') !== 'DENY' || @imagecreatefromstring($r['body']) === false) return 'picture headers / bytes';
    Lecture::update($ADMIN, $IDS['pptx'], ['audience' => 'all']);
    $p = http('api/lecture/file.php?id=' . $IDS['pptx']);
    Lecture::update($ADMIN, $IDS['pptx'], ['audience' => 'member']);
    $hp = $p['headers'];
    if ($p['status'] !== 200 || ($hp['content-type'] ?? '') !== Lecture::MIME_PPTX || strpos($hp['content-disposition'] ?? '', 'attachment; filename="lecture-' . $IDS['pptx'] . '.pptx"') !== 0) return 'pptx: ' . $p['status'] . ' ' . ($hp['content-disposition'] ?? '');
    return strpos($hp['content-security-policy'] ?? '', 'sandbox') !== false && ($hp['x-content-type-options'] ?? '') === 'nosniff' && substr($p['body'], 0, 4) === "PK\x03\x04";
});
check('HTTP file.php: a visitor cannot reach a member file, a switched-off lecture or an unknown id (the same JSON 404); malformed parameters are a 400', function () use (&$IDS) {
    $seen = [];
    foreach (['id=' . $IDS['pptx'], 'id=' . $IDS['off'], 'id=99999999', 'id=' . $IDS['pdf'] . '&n=5', 'id=' . $IDS['aud']['all']] as $q) {
        $r = http("api/lecture/file.php?$q");
        $j = json_decode($r['body'], true);
        if ($r['status'] !== 404 || ($j['error']['code'] ?? '') !== 'NOT_FOUND' || stripos($r['headers']['content-type'] ?? '', 'application/json') !== 0) return "?$q → " . $r['status'];
        $seen[$j['error']['message']] = true;
    }
    if (count($seen) !== 1) return 'the 404s differ: ' . json_encode(array_keys($seen), JSON_UNESCAPED_UNICODE);
    foreach (['', 'id=abc', 'id=0', 'id=-1', 'id[]=1', 'id=1&n=-1', 'id=1&n=1000', 'id=1&n=1.5', 'id=1&path=../../config/config.php', 'id=1%27%20OR%201=1', 'id=1&n[]=0', 'id=../../etc/passwd'] as $q) {
        $r = http("api/lecture/file.php?$q");
        if ($r['status'] !== 400) return "?$q → " . $r['status'];
    }
    return http('api/lecture/file.php?id=' . $IDS['pdf'], [], 'POST')['status'] === 405;
});
check('the stored files: a private folder with deny rules, neutral .bin names of 128 random bits that no answer reveals', function () use (&$IDS) {
    global $tmp;
    $f = Lecture::get($IDS['pdf'])['files'][0];
    // the folder's own guards (for an installation that keeps data/ inside the web root): deny rules + a PHP file that only answers 404
    if (strpos((string) file_get_contents($tmp . '/lectures/.htaccess'), 'Require all denied') === false) return 'no deny rule in data/lectures/.htaccess';
    if (strpos((string) file_get_contents($tmp . '/lectures/index.php'), 'http_response_code(404)') === false) return 'the guard file does not answer 404';
    if (preg_match('/\.(php\d?|phtml|phar|html?|svg|js)$/i', $f['path'])) return 'a stored name has an extension a server could run or render';
    // php -S ignores .htaccess (like a web server without the deny rules): the name is 128 random bits and is in no answer
    $list = http('api/lecture/list.php')['body'];
    return strpos($list, basename($f['path'], '.bin')) === false && strpos($list, substr($f['sha256'], 0, 16)) === false ? true : 'the list reveals a stored name';
});

// ---------------------------------------------------------------------------------------------- clean-up
proc_terminate($proc);
check('delete: a lecture goes with its rows and its files', function () use ($ADMIN, &$IDS, &$made) {
    $paths = [];
    foreach (['pdf', 'pptx', 'deck'] as $k) foreach (Lecture::get($IDS[$k])['files'] as $f) $paths[] = $f['path'];
    foreach (array_unique($made) as $id) if (Lecture::get($id) !== null) Lecture::delete($ADMIN, $id);
    foreach ($paths as $p) if (Lecture::absPath($p) !== null) return "a file stayed: $p";
    foreach (array_unique($made) as $id) if ((int) Db::value('SELECT COUNT(*) FROM lecture_files WHERE lecture_id = ?', [$id]) !== 0) return 'file rows stayed';
    Db::exec("DELETE FROM allot_contracts WHERE contract_no LIKE 'LEC-%'");
    return true;
});

echo PHP_EOL . "lecture-unit ($DRIVER): $passed passed, $failed failed" . PHP_EOL;
exit($failed ? 1 : 0);
