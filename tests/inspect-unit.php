<?php
/**
 * tests/inspect-unit.php — unit checks for the developer tab of the admin site (CONTRACT §15.5) that need no web server:
 *   Tfm\Markdown   render(): escape first, then a small whitelist (headings, lists, tables, code, bold, quotes, rules, links
 *                  to http(s) only with rel="noopener noreferrer"). An XSS battery proves that no tag, no attribute, no
 *                  entity trick and no javascript: / data: / vbscript: link survives; the handover documents render to
 *                  whitelisted, balanced markup only.
 *   Tfm\Inspect    checklist() / items() / setItem() (handover_items, audited), run() = the health checks + the
 *                  configuration audit + the exposure self-probe + the DB account check + versions, stored in
 *                  inspection_runs; runs() / get(); markdown() export; redact() (keys, tokens, passwords, cookies, e-mail
 *                  addresses, phone numbers); logTail() (the last lines of data/logs, redacted); environment()
 *   cli/inspect.php  `php cli/tfm.php inspect` prints the report and exits 1 exactly when a check fails
 *
 *   php tests/inspect-unit.php                     PASS/FAIL per check, exit 1 when one fails
 *
 * A throw-away SQLite database in the temp dir. CLI only; never deployed. Runs on the dev PHP (8.x).
 */
declare(strict_types=1);

if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
$tmp = sys_get_temp_dir() . '/tfm-insp-' . bin2hex(random_bytes(6));
mkdir($tmp, 0700, true);
putenv("TFM_DATA_DIR=$tmp");
foreach (['TFM_TOSS_MOCK', 'TFM_AI_MOCK', 'TFM_APP_ENV', 'ANTHROPIC_API_KEY'] as $k) putenv($k);
require __DIR__ . '/../server/lib/bootstrap.php';

$failed = 0;
/** $test returns true (pass), false or a string (fail + detail); a thrown error is a fail with its message */
function check(string $name, callable $test): void
{
    global $failed;
    try {
        $r = $test();
        $ok = $r === true;
        $detail = is_string($r) ? $r : ($ok ? '' : 'assertion is false');
    } catch (Throwable $e) {
        $ok = false;
        $detail = get_class($e) . ': ' . $e->getMessage() . ' @' . basename($e->getFile()) . ':' . $e->getLine();
    }
    if (!$ok) $failed++;
    echo ($ok ? "PASS  " : "FAIL  ") . $name . ($ok || $detail === '' ? '' : "  — $detail") . PHP_EOL;
}
function throwsApi(callable $fn, string $code): bool
{
    try { $fn(); } catch (Tfm\ApiException $e) { return $e->errorCode === $code; }
    return false;
}

Tfm\Db::pdo(); // creates the schema (v6)
$admin = Tfm\Db::tx(function () { return Tfm\Users::create('insp_admin@example.com', '점검관리자', 'Ferment2026ok', 'admin'); });
$player = Tfm\Db::tx(function () { return Tfm\Users::create('insp_kid@example.com', '점검아이', 'Ferment2026ok'); });
// fixtures shaped like real keys are put together at run time, so this file itself never holds one (tools/secret-scan.mjs)
$K = [
    'toss' => 'live' . '_sk_' . 'AbCdEfGh12345678IjKl', 'tossck' => 'test' . '_ck_' . 'D5GePWvyJnrK0W0k6q8gLzN97Eoq', 'tossgsk' => 'test_gsk_docs_' . 'OaPz8L5KdmQXkzRz3y47BMw6',
    'ant1' => 'sk-' . 'ant-api03-abcdefghijklmnopqrstuvwxyz0123456789', 'ant2' => 'sk-' . 'ant-api03-ZZZZZZZZZZZZZZZZZZZZZZZZ',
    'jwt' => 'eyJ' . 'hbGciOiJIUzI1NiJ9.' . 'eyJ' . 'zdWIiOiIxIn0.c2lnbmF0dXJlMTIz', 'aws' => 'AKIA' . 'IOSFODNN7EXAMPLE', 'slack' => 'xox' . 'b-123456789012-abcdefghijkl',
    'pem' => '-----BEGIN ' . "PRIVATE KEY-----\nMIIEvQIBADANBg\n-----END PRIVATE KEY-----", 'tossCfg' => 'live' . '_sk_UnitTestSecret1234567890',
];

// ------------------------------------------------------------------ the whitelist the rendered Markdown must stay inside
const MD_TAGS = ['h2', 'h3', 'h4', 'h5', 'h6', 'p', 'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'pre', 'code', 'strong', 'a', 'blockquote', 'hr', 'br', 'div'];
const MD_VOID = ['hr', 'br'];
/** '' when every tag of $html is whitelisted, carries only the allowed attributes and nests properly; else the first problem */
function markupProblem(string $html): string
{
    $stack = [];
    if (preg_match_all('/<(\/?)([A-Za-z][A-Za-z0-9:-]*)([^>]*)>/', $html, $m, PREG_SET_ORDER)) {
        foreach ($m as $t) {
            $tag = strtolower($t[2]);
            $attrs = trim($t[3]);
            if (!in_array($tag, MD_TAGS, true)) return "tag <{$t[1]}{$t[2]}> is not whitelisted";
            if ($t[1] === '/') {
                if ($attrs !== '') return "a closing tag with attributes: {$t[0]}";
                $top = array_pop($stack);
                if ($top !== $tag) return "</$tag> closes <" . (string) $top . '>';
                continue;
            }
            if ($tag === 'a') {
                if (!preg_match('/^href="([^"]*)" rel="noopener noreferrer"$/', $attrs, $mm)) return "a link with other attributes: {$t[0]}";
                $url = html_entity_decode($mm[1], ENT_QUOTES | ENT_HTML5, 'UTF-8');
                if (!preg_match('#^https?://[^\s"\'<>`\\\\]+$#i', $url)) return "a link that is not plain http(s): $url";
            } elseif ($tag === 'div') {
                if ($attrs !== 'class="tablewrap"') return "a div with other attributes: {$t[0]}";
            } elseif ($attrs !== '') {
                return "<$tag> with attributes: {$t[0]}";
            }
            if (!in_array($tag, MD_VOID, true)) $stack[] = $tag;
        }
    }
    if ($stack) return 'unclosed: <' . implode('> <', $stack) . '>';
    // outside the whitelisted tags no raw < or > is left (escaped text only)
    $text = preg_replace('/<\/?(?:' . implode('|', MD_TAGS) . ')(?:\s[^>]*)?>/', '', $html);
    if (!is_string($text) || strpos($text, '<') !== false || strpos($text, '>') !== false) return 'a raw < or > in the text';
    // every & starts an entity (htmlspecialchars output), so the browser can never decode a tag out of the text
    if (preg_match('/&(?!(?:amp|lt|gt|quot|#0?39|apos|#\d+|#x[0-9a-fA-F]+);)/', $text)) return 'a bare & in the text';
    return '';
}

check('the whitelist check itself — it rejects scripts, handlers, other tags / attributes, javascript: links, raw < >, bare &, unbalanced tags', function () {
    $bad = ['<script>x</script>', '<p onclick="x">a</p>', '<img src=x>', '<a href="javascript:alert(1)" rel="noopener noreferrer">x</a>', '<a href="https://ok.example/">x</a>',
        '<a href="//evil.example/" rel="noopener noreferrer">x</a>', '<div class="x">a</div>', '<p>a', '<p>a</b>', '<p>1 < 2</p>', '<p>a > b</p>', '<p>&#x3C;x</p>' . '&', '<p>x &nbsp y</p>', '<h1>x</h1>'];
    foreach ($bad as $b) if (markupProblem($b) === '') return 'not rejected: ' . $b;
    return markupProblem('<p>a &amp; &lt;b&gt; &#039;</p>' . "\n" . '<div class="tablewrap"><table><thead><tr><th>a</th></tr></thead><tbody></tbody></table></div><hr><a href="https://ok.example/?a=1&amp;b=2" rel="noopener noreferrer">x</a>') === '';
});

// ------------------------------------------------------------------ Markdown: the whitelist
check('Markdown::render — headings: # … ###### become h2 … h6 (the page itself owns h1), text escaped', function () {
    $out = Tfm\Markdown::render("# 제목\n## 둘째 <i>x</i>\n### 셋\n#### 넷\n##### 다섯\n###### 여섯 ##");
    $want = "<h2>제목</h2>\n<h3>둘째 &lt;i&gt;x&lt;/i&gt;</h3>\n<h4>셋</h4>\n<h5>넷</h5>\n<h6>다섯</h6>\n<h6>여섯</h6>";
    return $out === $want ?: "got: $out";
});
check('Markdown::render — **bold** and `code` inline; code spans keep their content literal (no bold inside)', function () {
    $out = Tfm\Markdown::render('이건 **굵게**, 이건 `**코드** <b>`, 그리고 **두 번째 굵게**');
    $want = '<p>이건 <strong>굵게</strong>, 이건 <code>**코드** &lt;b&gt;</code>, 그리고 <strong>두 번째 굵게</strong></p>';
    return $out === $want ?: "got: $out";
});
check('Markdown::render — fenced code keeps its lines and escapes everything inside (``` and ~~~)', function () {
    $out = Tfm\Markdown::render("```php\n<?php echo \"<b>\"; ?>\n  들여쓰기\n```\n~~~\n<Directory \"C:/xampp\">\n~~~");
    $want = "<pre><code>&lt;?php echo &quot;&lt;b&gt;&quot;; ?&gt;\n  들여쓰기</code></pre>\n<pre><code>&lt;Directory &quot;C:/xampp&quot;&gt;</code></pre>";
    return $out === $want ?: "got: $out";
});
check('Markdown::render — an unclosed fence runs to the end and is still closed', function () {
    $out = Tfm\Markdown::render("앞\n```\ncode <x>");
    return $out === "<p>앞</p>\n<pre><code>code &lt;x&gt;</code></pre>" ?: "got: $out";
});
check('Markdown::render — lists: - * + bullets, 1. 1) numbers, nesting by indentation, lazy continuation lines', function () {
    $out = Tfm\Markdown::render("- 하나\n- 둘\n  - 둘-가\n  - 둘-나\n- 셋\n  이어지는 줄\n\n1. 첫째\n2) 둘째\n\n* 별\n+ 더하기");
    $want = "<ul><li>하나</li><li>둘<ul><li>둘-가</li><li>둘-나</li></ul></li><li>셋\n이어지는 줄</li></ul>\n<ol><li>첫째</li><li>둘째</li></ol>\n<ul><li>별</li><li>더하기</li></ul>";
    return $out === $want ?: "got: $out";
});
check('Markdown::render — tables: header, delimiter row (alignment colons ignored), body rows, \\| as a literal pipe, ragged rows padded', function () {
    $out = Tfm\Markdown::render("| 항목 | 값 |\n|:---|---:|\n| a \\| b | **굵게** |\n| 하나만 |\n");
    $want = '<div class="tablewrap"><table><thead><tr><th>항목</th><th>값</th></tr></thead><tbody><tr><td>a | b</td><td><strong>굵게</strong></td></tr><tr><td>하나만</td><td></td></tr></tbody></table></div>';
    return $out === $want ?: "got: $out";
});
check('Markdown::render — links: only http(s), href escaped, rel="noopener noreferrer"; other targets stay plain text', function () {
    $out = Tfm\Markdown::render('[문서](https://example.com/a?b=1&c=2) · [옛](http://example.org/) · [용어 풀이](#용어-풀이) · [메일](mailto:a@b.c)');
    $want = '<p><a href="https://example.com/a?b=1&amp;c=2" rel="noopener noreferrer">문서</a> · <a href="http://example.org/" rel="noopener noreferrer">옛</a> · 용어 풀이 · 메일</p>';
    return $out === $want ?: "got: $out";
});
check('Markdown::render — > quotes (nested content rendered inside), --- rules, paragraphs split by blank lines', function () {
    $out = Tfm\Markdown::render("> 인용 **굵게**\n> - 목록\n\n---\n\n첫 문단\n둘째 줄\n\n둘째 문단");
    $want = "<blockquote><p>인용 <strong>굵게</strong></p>\n<ul><li>목록</li></ul></blockquote>\n<hr>\n<p>첫 문단\n둘째 줄</p>\n<p>둘째 문단</p>";
    return $out === $want ?: "got: $out";
});
check('Markdown::render — empty input, only blank lines, Windows line ends and a missing final newline', function () {
    return Tfm\Markdown::render('') === '' && Tfm\Markdown::render("\n\n  \n") === '' && Tfm\Markdown::render("# a\r\n\r\nb\r\n") === "<h2>a</h2>\n<p>b</p>";
});

// ------------------------------------------------------------------ Markdown: XSS — nothing survives
$xss = [
    '<script>alert(1)</script>', '<img src=x onerror=alert(1)>', '<svg/onload=alert(1)>', '<a href="javascript:alert(1)">x</a>',
    '[x](javascript:alert(1))', '[x](JaVaScRiPt:alert(1))', '[x]( javascript:alert(1))', "[x](java\tscript:alert(1))", "[x](java\nscript:alert(1))",
    '[x](java&#115;cript:alert(1))', '[x](&#106;avascript:alert(1))', '[x](javascript&colon;alert(1))', '[x](&#x6A;avascript:alert(1))',
    '[x](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)', '[x](DATA:text/html,<script>alert(1)</script>)', '[x](vbscript:msgbox(1))',
    '[x](//evil.example/x)', '[x](https:evil.example)', '[x](http://ok.example/" onmouseover="alert(1))', '[x](https://ok.example/"onmouseover="alert(1)")',
    "[x](https://ok.example/'onmouseover='alert(1)')", '[x](https://ok.example/<script>)', '[x](https://ok.example/`x`)', '[x](https://ok.example/\\x)',
    '[<img src=x onerror=alert(1)>](https://ok.example/)', '[x](https://ok.example/a)b](javascript:alert(1))', '[[x](https://ok.example/)](javascript:alert(1))',
    '**<b onmouseover=alert(1)>bold</b>**', '# <script>alert(1)</script>', "| a | b |\n|---|---|\n| <script>alert(1)</script> | <img src=x onerror=1> |",
    "```\n</code></pre><script>alert(1)</script>\n```", '`</code><script>alert(1)</script>`', '&lt;script&gt;alert(1)&lt;/script&gt;',
    '&#60;script&#62;alert(1)&#60;/script&#62;', '<scr<script>ipt>alert(1)</script>', '<<script>script>alert(1)<</script>/script>', '> <script>alert(1)</script>',
    '- <iframe src=javascript:alert(1)>', '1. <object data=x>', '<style>body{display:none}</style>', '<!-- x --><b>x</b>', "\x00<script>alert(1)</script>",
    "<sc\x00ript>alert(1)</script>", '<math><mi xlink:href="javascript:alert(1)">x</mi></math>', '![img](https://ok.example/x.png)', '![x](javascript:alert(1))',
    "<a\nhref=javascript:alert(1)>x</a>", '<div style="background:url(javascript:alert(1))">', "\u{FF1C}script\u{FF1E}alert(1)\u{FF1C}/script\u{FF1E}",
    '[x](https://ok.example/%22%3E%3Cscript%3E)', '[x](https://ok.example/&quot;onmouseover=alert(1))', "[x](https://ok.example/\u{202E}gnp.exe)",
    '<form action="https://evil.example"><input name=x></form>', '<base href="https://evil.example/">', '<meta http-equiv="refresh" content="0;url=https://evil.example">',
    "| <th onclick=x> | b |\n|---|---|", "~~~\n<script>\n~~~", '**[x](javascript:alert(1))**', '`code` <script>`x`</script>',
];
check('Markdown::render — XSS battery (' . count($xss) . ' payloads): only whitelisted tags and attributes, balanced, no raw < >, links only plain http(s)', function () use ($xss) {
    foreach ($xss as $i => $p) {
        $out = Tfm\Markdown::render($p);
        $why = markupProblem($out);
        if ($why !== '') return "payload #$i " . json_encode($p, JSON_UNESCAPED_UNICODE) . ": $why — " . $out;
        if (stripos($out, '<script') !== false || preg_match('/<[^>]*\son[a-z]+\s*=/i', $out)) return "payload #$i: a script or an event handler survived — $out";
        if (preg_match_all('/href="([^"]*)"/', $out, $m)) foreach ($m[1] as $h) {
            $u = html_entity_decode($h, ENT_QUOTES | ENT_HTML5, 'UTF-8');
            if (preg_match('/^\s*(?:javascript|data|vbscript):/i', $u) || !preg_match('#^https?://#', $u)) return "payload #$i: link $u";
        }
    }
    return true;
});
check('Markdown::render — typed entities stay text: "&lt;script&gt;" is shown as those characters, never decoded into a tag', function () {
    $out = Tfm\Markdown::render('&lt;script&gt; &#60;b&#62; &amp;');
    return $out === '<p>&amp;lt;script&amp;gt; &amp;#60;b&amp;#62; &amp;amp;</p>' ?: "got: $out";
});
check('Markdown::render — a link whose address is not plain http(s) (here it carries < >) keeps only its text, escaped', function () {
    $out = Tfm\Markdown::render('[<b>굵게?</b>](https://ok.example/path?q=<x>)');
    return $out === '<p>&lt;b&gt;굵게?&lt;/b&gt;</p>' ?: "got: $out";
});
check('Markdown::render — pathological input (deep quotes, deep indentation, 10 000 brackets / stars, 200 000 characters) stays fast, bounded and balanced', function () {
    $cases = [str_repeat('> ', 3000) . '깊어요', str_repeat(' ', 6000) . '- 깊은 목록', str_repeat('[', 10000) . str_repeat('](', 10000), str_repeat('**', 10000),
        str_repeat("- a\n  ", 2000) . '- b', str_repeat('| x ', 500) . "|\n" . str_repeat('|---', 500) . "|\n" . str_repeat('| y ', 500) . '|', str_repeat('가나다 **라** `마` ', 12000)];
    foreach ($cases as $i => $c) {
        $t0 = microtime(true);
        $out = Tfm\Markdown::render($c);
        $ms = (microtime(true) - $t0) * 1000;
        if ($ms > 3000) return "case #$i took " . round($ms) . ' ms';
        $why = markupProblem($out);
        if ($why !== '') return "case #$i: $why";
    }
    return true;
});
check('Markdown::render — the handover documents (docs/*.md + server/README-SERVER.md) render to whitelisted, balanced markup with headings and tables; HANDOVER\'s "<script>" text stays text', function () {
    $root = dirname(__DIR__);
    $docs = ['docs/HANDOVER.md', 'docs/ARCHITECTURE.md', 'docs/SERVER-INSTALL-KO.md', 'docs/SECURITY-REPORT-KO.md', 'server/README-SERVER.md'];
    $sum = [];
    foreach ($docs as $d) {
        $md = (string) file_get_contents($root . '/' . $d);
        $t0 = microtime(true);
        $out = Tfm\Markdown::render($md);
        $ms = (int) round((microtime(true) - $t0) * 1000);
        $why = markupProblem($out);
        if ($why !== '') return "$d: $why";
        if (strpos($out, '<h2>') === false || strpos($out, '<table>') === false) return "$d: no headings / tables";
        if ($ms > 3000) return "$d took $ms ms";
        $sum[] = basename($d) . " {$ms}ms";
    }
    $h = Tfm\Markdown::render((string) file_get_contents($root . '/docs/HANDOVER.md'));
    if (strpos($h, '&lt;script&gt;') === false) return 'HANDOVER: the <script> text is not shown as text';
    echo '      (' . implode(' · ', $sum) . ')' . PHP_EOL;
    return true;
});

// ------------------------------------------------------------------ Inspect: the handover checklist
check('Inspect::checklist — the handover list is a PHP array of {key, label, hint} with the CONTRACT §15.5 items', function () {
    $list = Tfm\Inspect::checklist();
    $keys = array_keys($list);
    foreach (['admin_2fa', 'db_account', 'https_cert', 'toss_keys', 'claude_key', 'backup_schedule', 'renew_schedule', 'log_location', 'secret_storage'] as $k) {
        if (!isset($list[$k])) return "missing item $k (have " . implode(', ', $keys) . ')';
    }
    foreach ($list as $k => $it) {
        if (!preg_match('/^[a-z0-9_]{2,64}$/', (string) $k)) return "bad key $k";
        if (!is_array($it) || !isset($it['label'], $it['hint']) || trim((string) $it['label']) === '' || trim((string) $it['hint']) === '') return "item $k needs a label and a hint";
    }
    return count($list) >= 9;
});
check('Inspect::items — every item starts open (done false, empty note, nobody, never)', function () {
    foreach (Tfm\Inspect::items() as $it) {
        if ($it['done'] !== false || $it['note'] !== '' || $it['by'] !== null || $it['at'] !== 0) return 'item ' . $it['key'] . ': ' . json_encode($it, JSON_UNESCAPED_UNICODE);
        if (!isset($it['label'], $it['hint'], $it['key'])) return 'fields';
    }
    return count(Tfm\Inspect::items()) === count(Tfm\Inspect::checklist());
});
check('Inspect::setItem — done + note are stored (handover_items: k, done, note, updated_by, updated_at) and audited (handover_item_changed)', function () use ($admin) {
    $r = Tfm\Inspect::setItem($admin, 'admin_2fa', true, '관리자 2명 모두 휴대폰 앱에 등록했어요');
    $row = Tfm\Db::one('SELECT * FROM handover_items WHERE k = ?', ['admin_2fa']);
    if (!$row || (int) $row['done'] !== 1 || $row['note'] !== '관리자 2명 모두 휴대폰 앱에 등록했어요' || (int) $row['updated_by'] !== (int) $admin['id'] || (int) $row['updated_at'] <= 0) return 'row ' . json_encode($row, JSON_UNESCAPED_UNICODE);
    $it = null;
    foreach (Tfm\Inspect::items() as $x) if ($x['key'] === 'admin_2fa') $it = $x;
    if (!$it || $it['done'] !== true || $it['by'] !== (int) $admin['id'] || $it['byNick'] !== '점검관리자' || $it['at'] <= 0) return 'items() ' . json_encode($it, JSON_UNESCAPED_UNICODE);
    $au = Tfm\Db::one("SELECT * FROM audit_log WHERE event = 'handover_item_changed' ORDER BY id DESC LIMIT 1");
    if (!$au || (int) $au['actor_id'] !== (int) $admin['id'] || strpos((string) $au['detail'], 'admin_2fa') === false) return 'audit ' . json_encode($au, JSON_UNESCAPED_UNICODE);
    return $r['key'] === 'admin_2fa' && $r['done'] === true;
});
check('Inspect::setItem — unchecking keeps the note it is given; the note is cleaned (control characters, spaces) and ≤ 500 characters', function () use ($admin) {
    Tfm\Inspect::setItem($admin, 'admin_2fa', false, "  다시   확인\x07 필요  ");
    $row = Tfm\Db::one('SELECT * FROM handover_items WHERE k = ?', ['admin_2fa']);
    if ((int) $row['done'] !== 0 || $row['note'] !== '다시 확인 필요') return 'row ' . json_encode($row, JSON_UNESCAPED_UNICODE);
    return throwsApi(function () use ($admin) { Tfm\Inspect::setItem($admin, 'admin_2fa', true, str_repeat('가', 501)); }, 'INVALID_INPUT')
        && Tfm\Inspect::setItem($admin, 'admin_2fa', true, str_repeat('가', 500))['note'] === str_repeat('가', 500);
});
check('Inspect::setItem — a key that is not on the list, and an actor who is not an admin, are refused', function () use ($admin, $player) {
    return throwsApi(function () use ($admin) { Tfm\Inspect::setItem($admin, 'no_such_item', true, ''); }, 'INVALID_INPUT')
        && throwsApi(function () use ($admin) { Tfm\Inspect::setItem($admin, "admin_2fa' OR 1=1 --", true, ''); }, 'INVALID_INPUT')
        && throwsApi(function () use ($player) { Tfm\Inspect::setItem($player, 'db_account', true, ''); }, 'FORBIDDEN')
        && Tfm\Db::one('SELECT * FROM handover_items WHERE k = ?', ['db_account']) === null;
});
check('Inspect::setItem — a key or password pasted into a note is stored hidden (the note says where a secret is kept, never the secret)', function () use ($admin, $K) {
    $r = Tfm\Inspect::setItem($admin, 'toss_keys', true, '토스 키 ' . $K['toss'] . ' 는 금고에 · password=hunter2 · sk-ant-api03-' . str_repeat('x', 40));
    $note = (string) Tfm\Db::value('SELECT note FROM handover_items WHERE k = ?', ['toss_keys']);
    foreach ([$K['toss'], 'hunter2', str_repeat('x', 40)] as $s) if (strpos($note, $s) !== false) return "the note keeps $s: $note";
    return strpos($note, '금고에') !== false && strpos($note, '[가림') !== false && $r['note'] === $note;
});

// ------------------------------------------------------------------ Inspect: redaction
check('Inspect::redact — passwords, tokens, keys, cookies, sessions, CSRF tokens, private keys, sealed values are hidden', function () use ($K) {
    $cases = [
        'login password=hunter2 ok' => 'hunter2', 'pwd: "s3cr3t!"' => 's3cr3t!', '{"password":"hunter2","user":"a"}' => 'hunter2', "{'token': 'tok_ABCDEFGH'}" => 'tok_ABCDEFGH',
        'api_key=AAAABBBBCCCCDDDD' => 'AAAABBBBCCCCDDDD', 'x-api-key: ' . $K['ant1'] => 'abcdefghijklmnopqrstuvwxyz0123456789',
        'key ' . $K['ant2'] . ' in text' => 'ZZZZZZZZZZZZZZZZZZZZZZZZ', 'Authorization: Bearer abc.def.ghi-jkl' => 'abc.def.ghi-jkl', 'Bearer ' . $K['jwt'] => 'c2lnbmF0dXJlMTIz',
        'jwt ' . $K['jwt'] . ' end' => 'eyJzdWIiOiIxIn0', 'toss ' . $K['toss'] => 'AbCdEfGh12345678IjKl', $K['tossck'] => 'D5GePWvyJnrK0W0k6q8gLzN97Eoq',
        'secretKey=' . $K['tossgsk'] => 'OaPz8L5KdmQXkzRz3y47BMw6', 'aws ' . $K['aws'] => $K['aws'], 'gh ghp_' . str_repeat('a', 36) => str_repeat('a', 36),
        'slack ' . $K['slack'] => 'abcdefghijkl', 'g AIza' . str_repeat('B', 35) => str_repeat('B', 35), 'Cookie: TFMSESSID=abcdef123456; TFMADM=zzzz9999' => 'abcdef123456',
        'Set-Cookie: TFMSESSID=deadbeefcafe; path=/' => 'deadbeefcafe', 'sent TFMADM=qqqqrrrrsssstttt to /admin/' => 'qqqqrrrrsssstttt', 'PHPSESSID=0123456789abcdef' => '0123456789abcdef',
        '_csrf=0123456789abcdef0123456789abcdef' => '0123456789abcdef0123456789abcdef', 'billing_key: bk_9f8e7d6c5b4a' => 'bk_9f8e7d6c5b4a', 'paymentKey=tgen_20261112abcd' => 'tgen_20261112abcd',
        $K['pem'] => 'MIIEvQIBADANBg', 'enc:v1:AAAAbbbbCCCCdddd1234' => 'AAAAbbbbCCCCdddd1234',
        'hash ' . str_repeat('a1', 32) => str_repeat('a1', 32), 'client_secret=Q2xpZW50U2VjcmV0' => 'Q2xpZW50U2VjcmV0', 'setup_code=ABCD-EFGH-JKMN' => 'ABCD-EFGH-JKMN',
    ];
    foreach ($cases as $in => $secret) {
        $out = Tfm\Inspect::redact((string) $in);
        if (strpos($out, (string) $secret) !== false) return 'not hidden: ' . json_encode($in, JSON_UNESCAPED_UNICODE) . ' → ' . json_encode($out, JSON_UNESCAPED_UNICODE);
        if (strpos($out, '[가림') === false) return 'no marker: ' . json_encode($out, JSON_UNESCAPED_UNICODE);
    }
    return true;
});
check('Inspect::redact — e-mail addresses and phone numbers (010 · +82 · landlines · dots / spaces) are hidden', function () {
    $cases = ['문의 kid@example.com 로' => 'kid@example.com', 'a.b-c+d@sub.example.co.kr' => 'sub.example.co.kr', '010-1234-5678' => '1234-5678', '01012345678' => '12345678',
        '전화 010 1234 5678 번' => '1234 5678', '+82 10-1234-5678' => '1234-5678', '+821098765432' => '98765432', '02-123-4567' => '123-4567', '031.987.6543' => '987.6543', '070-1234-5678' => '1234-5678'];
    foreach ($cases as $in => $secret) {
        $out = Tfm\Inspect::redact((string) $in);
        if (strpos($out, (string) $secret) !== false || strpos($out, '[가림') === false) return 'not hidden: ' . $in . ' → ' . $out;
    }
    return true;
});
check('Inspect::redact — ordinary log text is left alone (counts, dates, times, request ids, paths, addresses, 13-digit ms times)', function () {
    $keep = ['콩 10개 심고 물 3번 줬어요', '2026-11-12T10:00:00+09:00', 'rid a1b2c3d4e5f6', 'GET /api/farm/report-photo.php 200 12ms', 'user #12 saved rev 7', '203.0.113.7',
        'pid a1a1a1a1a1a1a1a1 ready_at 1731400000000', 'first_seen 1731400000 s', 'uploads/reports/2026/11/' . str_repeat('ab', 16) . '.jpg', 'schema 6 / 6', 'tokens in 120 out 45', 'password 정책: 8자 이상'];
    foreach ($keep as $t) { $o = Tfm\Inspect::redact($t); if ($o !== $t) return "changed: $t → $o"; }
    return true;
});
check('Inspect::redactValue — nested arrays: values under secret-looking keys are hidden, other strings redacted, numbers kept', function () {
    $v = Tfm\Inspect::redactValue(['user' => 12, 'ctx' => ['password' => 'hunter2', 'apiKey' => 'zzz', 'note' => 'mail kid@example.com', 'n' => 3, 'list' => ['Bearer abcdefghij12']], 'Cookie' => 'x=1']);
    $j = json_encode($v, JSON_UNESCAPED_UNICODE);
    foreach (['hunter2', '"zzz"', 'kid@example.com', 'abcdefghij12', 'x=1'] as $s) if (strpos($j, $s) !== false) return "kept $s: $j";
    return $v['user'] === 12 && $v['ctx']['n'] === 3 ?: $j;
});

// ------------------------------------------------------------------ Inspect: the log tail
check('Inspect::logTail — the last lines of data/logs (newest last), the PHP guard line skipped, every line redacted, broken lines kept as text', function () {
    Tfm\Log::warn('TEST', 'login failed password=hunter2 for kid@example.com', ['token' => 'abc123secret', 'phone' => '010-1234-5678', 'n' => 1]);
    Tfm\Log::info('TEST', '<script>alert(1)</script> plain line', ['x' => 'sk-ant-api03-' . str_repeat('q', 30)]);
    $file = Tfm\Log::dir() . DIRECTORY_SEPARATOR . 'app-' . date('Y-m-d') . '.log.php';
    file_put_contents($file, "not json at all Cookie: TFMSESSID=zz99zz99zz99\n", FILE_APPEND);
    $tail = Tfm\Inspect::logTail(200);
    if (!$tail) return 'empty tail';
    $j = json_encode($tail, JSON_UNESCAPED_UNICODE);
    foreach (['hunter2', 'kid@example.com', 'abc123secret', '010-1234-5678', str_repeat('q', 30), 'zz99zz99zz99', 'header_remove'] as $s) if (strpos($j, $s) !== false) return "the tail shows $s";
    $last = $tail[count($tail) - 1];
    $prev = $tail[count($tail) - 2];
    if (strpos($last['msg'], 'not json at all') === false || $last['lvl'] !== '') return 'the broken line is the newest entry: ' . json_encode($last, JSON_UNESCAPED_UNICODE);
    if ($prev['lvl'] !== 'info' || $prev['cat'] !== 'TEST' || strpos($prev['msg'], '<script>alert(1)</script>') === false) return 'the markup line stays raw text for e(): ' . json_encode($prev, JSON_UNESCAPED_UNICODE);
    foreach ($tail as $t) foreach (['t', 'lvl', 'cat', 'msg', 'ctx', 'rid', 'ip', 'file'] as $k) if (!array_key_exists($k, $t)) return "entry without $k";
    return true;
});
check('Inspect::logTail — at most N lines, read across files (today\'s, its rotated parts and older days) newest last', function () {
    $dir = Tfm\Log::dir();
    $guard = "<?php if (function_exists('header_remove')) header_remove('X-Powered-By'); http_response_code(404); exit; ?>\n";
    $mk = function (string $name, string $tag, int $n) use ($dir, $guard) {
        $s = $guard;
        for ($i = 1; $i <= $n; $i++) $s .= json_encode(['t' => '2026-01-01T00:00:00+09:00', 'lvl' => 'info', 'cat' => 'T', 'msg' => "$tag $i", 'rid' => 'r', 'ip' => '127.0.0.1', 'ctx' => null]) . "\n";
        file_put_contents($dir . DIRECTORY_SEPARATOR . $name, $s);
    };
    $mk('app-2026-01-01.log.php', 'old', 200);
    $mk('app-2026-01-02.1.log.php', 'rot1', 30);
    $mk('app-2026-01-02.2.log.php', 'rot2', 30);
    $mk('app-2026-01-02.log.php', 'cur', 30);
    // today's file (newest) already has a few lines; ask for 250: today + cur 30 + rot2 30 + rot1 30 + the newest old ones
    $tail = Tfm\Inspect::logTail(250);
    $msgs = array_column($tail, 'msg');
    $iCur = array_search('cur 30', $msgs, true);
    $iRot2 = array_search('rot2 30', $msgs, true);
    $iRot1 = array_search('rot1 30', $msgs, true);
    $iOld = array_search('old 150', $msgs, true);
    if (count($tail) !== 250) return 'count ' . count($tail);
    if ($iOld === false || $iRot1 === false || $iRot2 === false || $iCur === false || !($iOld < $iRot1 && $iRot1 < $iRot2 && $iRot2 < $iCur)) return "order old $iOld rot1 $iRot1 rot2 $iRot2 cur $iCur";
    if (in_array('old 1', $msgs, true)) return 'more than 250 lines were read';
    return count(Tfm\Inspect::logTail(5)) === 5 && count(Tfm\Inspect::logTail(0)) === 1;
});

// ------------------------------------------------------------------ Inspect: run, store, read back, export
$run1 = null;
check('Inspect::run — health checks + configuration audit + exposure probe row + DB account + versions, as {id, status, summary, checks, versions}', function () use (&$run1) {
    $run1 = Tfm\Inspect::run('cli', null);
    if (!is_int($run1['id']) || $run1['id'] <= 0) return 'id';
    if (!in_array($run1['status'], ['ok', 'warn', 'fail'], true)) return 'status ' . $run1['status'];
    $groups = array_unique(array_column($run1['checks'], 'group'));
    foreach (['php', 'db', 'files', 'security', 'adminlock', 'config', 'dbacct', 'inspect'] as $g) if (!in_array($g, $groups, true)) return "group $g missing (" . implode(', ', $groups) . ')';
    $ids = array_column($run1['checks'], 'id');
    foreach (['php_version', 'db_schema', 'probe_data', 'db_account_live', 'app_version', 'handover', 'docs'] as $id) if (!in_array($id, $ids, true)) return "check $id missing";
    if (!array_filter($ids, function ($x) { return strpos((string) $x, 'cfg_') === 0; })) return 'no ConfigAudit rows';
    $sum = ['ok' => 0, 'warn' => 0, 'fail' => 0];
    foreach ($run1['checks'] as $c) {
        if (!isset($sum[$c['status']])) return 'bad status ' . $c['status'];
        $sum[$c['status']]++;
        if (!is_string($c['value']) || !is_string($c['hint']) || !is_string($c['label'])) return 'row fields must be strings: ' . json_encode($c, JSON_UNESCAPED_UNICODE);
    }
    if ($sum !== $run1['summary']) return 'summary ' . json_encode($run1['summary']) . ' vs ' . json_encode($sum);
    if ($run1['status'] !== ($sum['fail'] ? 'fail' : ($sum['warn'] ? 'warn' : 'ok'))) return 'status does not follow the rows';
    foreach (['app', 'php', 'db', 'schema', 'gameData', 'os'] as $k) if (!isset($run1['versions'][$k]) || $run1['versions'][$k] === '') return "version $k";
    return $run1['versions']['app'] === TFM_VERSION && strpos($run1['versions']['schema'], (string) Tfm\Db::SCHEMA_VERSION) !== false;
});
check('Inspect::run — stored in inspection_runs (source, actor, status, counts, summary, result JSON) and read back by get() / runs()', function () use (&$run1, $admin) {
    $row = Tfm\Db::one('SELECT * FROM inspection_runs WHERE id = ?', [$run1['id']]);
    if (!$row || $row['source'] !== 'cli' || $row['actor_id'] !== null || $row['status'] !== $run1['status']) return 'row ' . json_encode($row ? array_diff_key($row, ['result' => 1]) : null);
    if ((int) $row['ok_count'] !== $run1['summary']['ok'] || (int) $row['warn_count'] !== $run1['summary']['warn'] || (int) $row['fail_count'] !== $run1['summary']['fail']) return 'counts';
    if (!is_array(json_decode((string) $row['result'], true)) || trim((string) $row['summary']) === '') return 'result / summary';
    $run2 = Tfm\Inspect::run('admin', $admin);
    $back = Tfm\Inspect::get($run1['id']);
    if (!$back || $back['checks'] !== $run1['checks'] || $back['versions'] !== $run1['versions'] || $back['status'] !== $run1['status'] || $back['source'] !== 'cli') return 'get() differs';
    $list = Tfm\Inspect::runs(10, 0);
    if (count($list) !== 2 || $list[0]['id'] !== $run2['id'] || $list[1]['id'] !== $run1['id']) return 'runs() order ' . json_encode(array_column($list, 'id'));
    if ($list[0]['actorId'] !== (int) $admin['id'] || $list[0]['actorNick'] !== '점검관리자' || $list[0]['source'] !== 'admin') return 'runs() actor ' . json_encode($list[0], JSON_UNESCAPED_UNICODE);
    foreach (['id', 'createdAt', 'source', 'status', 'ok', 'warn', 'fail', 'summary', 'actorId', 'actorNick'] as $k) if (!array_key_exists($k, $list[0])) return "runs() field $k";
    return Tfm\Inspect::get(999999) === null && Tfm\Inspect::get(0) === null;
});
check('Inspect::run — never stores a secret: no app_key / data_key of data/secret.php and no configured key in the result', function () use (&$run1, $K) {
    Tfm\Config::override('anthropic.api_key', 'sk-ant-api03-UNITTESTKEY' . str_repeat('k', 30));
    Tfm\Config::override('toss.secret_key', $K['tossCfg']);
    $r = Tfm\Inspect::run('cli', null);
    $json = (string) Tfm\Db::value('SELECT result FROM inspection_runs WHERE id = ?', [$r['id']]) . (string) Tfm\Db::value('SELECT summary FROM inspection_runs WHERE id = ?', [$r['id']]) . Tfm\Inspect::markdown($r);
    foreach (['app_key', 'data_key'] as $k) {
        try { $v = Tfm\Config::secret($k); } catch (Throwable $e) { continue; } // data_key exists only once Crypto sealed something
        if ($v !== '' && strpos($json, $v) !== false) return "$k is in the stored run";
    }
    foreach (['UNITTESTKEY', 'UnitTestSecret'] as $s) if (strpos($json, $s) !== false) return "$s is in the stored run";
    Tfm\Config::override('anthropic.api_key', '');
    Tfm\Config::override('toss.secret_key', '');
    return true;
});
check('Inspect::run — keeps the newest 100 runs (older ones are removed)', function () {
    $now = Tfm\Clock::ms();
    for ($i = 0; $i < 120; $i++) Tfm\Db::insert('inspection_runs', ['created_at' => $now - 100000 + $i, 'actor_id' => null, 'source' => 'cli', 'status' => 'ok', 'ok_count' => 1, 'warn_count' => 0, 'fail_count' => 0, 'summary' => 'x', 'result' => '{}']);
    $r = Tfm\Inspect::run('cli', null);
    $n = (int) Tfm\Db::value('SELECT COUNT(*) FROM inspection_runs');
    $newest = (int) Tfm\Db::value('SELECT MAX(id) FROM inspection_runs');
    return $n === 100 && $newest === $r['id'] ?: "rows $n, newest $newest vs " . $r['id'];
});
check('Inspect::markdown — a Markdown report: title with the run number, time, source, result, versions table, one table per group; | and markup in values are escaped', function () use (&$run1) {
    $run = $run1;
    $run['checks'][] = ['group' => 'inspect', 'id' => 'evil', 'label' => '파이프 | 와 <b>표시</b>', 'status' => 'warn', 'value' => "a|b\nc <script>x</script>", 'hint' => '`코드` | 끝'];
    $md = Tfm\Inspect::markdown($run);
    if (strpos($md, '# 서버 점검 보고서 #' . $run['id']) !== 0) return 'title: ' . substr($md, 0, 80);
    foreach (['| 항목 | 상태 | 값 | 안내 |', '## 버전', 'PHP 버전', TFM_VERSION] as $x) if (strpos($md, $x) === false) return "missing $x";
    if (strpos($md, '<script>') !== false || strpos($md, '<b>') !== false) return 'raw markup in the export';
    if (strpos($md, '파이프 \\| 와 &lt;b&gt;표시&lt;/b&gt;') === false || strpos($md, 'a\\|b c &lt;script&gt;x&lt;/script&gt;') === false) return 'cells not escaped: ' . substr($md, strpos($md, '파이프') - 4, 160);
    // every table row has exactly 4 cells (the export is a valid table)
    foreach (preg_split('/\n/', $md) as $line) {
        if (strpos($line, '| ') !== 0 || strpos($line, '| 항목 | 값 |') === 0) continue;
        $cells = preg_split('/(?<!\\\\)\|/', trim($line));
        if (count($cells) - 2 !== 4 && count($cells) - 2 !== 2) return 'a broken row: ' . $line;
    }
    return true;
});
check('Inspect::markdown — the export renders back through Markdown::render to whitelisted markup (the tab can show it)', function () use (&$run1) {
    $why = markupProblem(Tfm\Markdown::render(Tfm\Inspect::markdown($run1)));
    return $why === '' ?: $why;
});

// ------------------------------------------------------------------ Inspect: environment
check('Inspect::environment — versions, extensions (required / optional), disk use, PHP settings', function () {
    $e = Tfm\Inspect::environment();
    foreach (['versions', 'extensions', 'disk', 'ini', 'loaded'] as $k) if (!isset($e[$k]) || !is_array($e[$k]) || !$e[$k]) return "section $k";
    $names = array_column($e['extensions'], 'name');
    foreach (['pdo', 'mbstring', 'json', 'session', 'curl', 'openssl', 'gd'] as $x) if (!in_array($x, $names, true)) return "extension $x";
    foreach ($e['extensions'] as $x) if (!is_bool($x['loaded']) || !is_bool($x['required'])) return 'extension fields';
    foreach ($e['disk'] as $d) if (!isset($d['label'], $d['bytes']) || !is_int($d['bytes'])) return 'disk fields';
    $v = json_encode($e, JSON_UNESCAPED_UNICODE);
    return strpos($v, PHP_VERSION) !== false && strpos($v, TFM_VERSION) !== false;
});

// ------------------------------------------------------------------ cli/inspect.php
check('cli inspect — `php cli/tfm.php inspect` prints the report and exits 1 exactly when a check fails (stored with source cli)', function () use ($tmp) {
    // the child sees the same database as this process (TFM_DB_* when the suite runs on MariaDB)
    $base = ['TFM_DATA_DIR' => $tmp, 'PATH' => (string) getenv('PATH')];
    foreach (['TFM_DB_DRIVER', 'TFM_DB_HOST', 'TFM_DB_PORT', 'TFM_DB_USER', 'TFM_DB_PASS', 'TFM_DB_NAME'] as $k) if (getenv($k) !== false) $base[$k] = (string) getenv($k);
    $run = function (array $env) use ($tmp, $base) {
        $cmd = escapeshellarg(PHP_BINARY) . ' ' . escapeshellarg(dirname(__DIR__) . '/server/cli/tfm.php') . ' inspect';
        $p = proc_open($cmd, [1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes, null, $env + $base);
        $out = stream_get_contents($pipes[1]) . stream_get_contents($pipes[2]);
        fclose($pipes[1]); fclose($pipes[2]);
        return [proc_close($p), $out];
    };
    list($code, $out) = $run([]);
    $row = Tfm\Db::one("SELECT * FROM inspection_runs WHERE source = 'cli' ORDER BY id DESC LIMIT 1");
    if (!$row || strpos($out, '#' . $row['id']) === false || strpos($out, '종합') === false) return 'output: ' . substr($out, -300);
    if (($code === 1) !== ($row['status'] === 'fail') || !in_array($code, [0, 1], true)) return "exit $code for status {$row['status']}";
    // a mock payment switch on a real host (the CLI counts as one) is a ⛔ row → exit 1
    list($code2, $out2) = $run(['TFM_TOSS_MOCK' => '1']);
    $row2 = Tfm\Db::one("SELECT * FROM inspection_runs WHERE source = 'cli' ORDER BY id DESC LIMIT 1");
    if ($row2['status'] !== 'fail' || $code2 !== 1) return "with TFM_TOSS_MOCK=1: status {$row2['status']}, exit $code2";
    // the Markdown form of the same report
    $cmd = escapeshellarg(PHP_BINARY) . ' ' . escapeshellarg(dirname(__DIR__) . '/server/cli/tfm.php') . ' inspect --markdown';
    $p = proc_open($cmd, [1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes, null, $base);
    $md = stream_get_contents($pipes[1]); fclose($pipes[1]); fclose($pipes[2]); proc_close($p);
    return strpos($md, '# 서버 점검 보고서 #') === 0 ?: 'markdown: ' . substr($md, 0, 120);
});

echo PHP_EOL . ($failed ? "✖ $failed inspect check(s) failed" : '✔ all inspect unit checks passed') . PHP_EOL;
exit($failed ? 1 : 0);
