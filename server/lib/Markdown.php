<?php
/**
 * Tfm\Markdown — a small, safe Markdown renderer for the admin site's 🧑‍💻 개발자 tab (CONTRACT §15.5, workflow
 * interface 6): the handover documents in lib/docs/ and the inspection report.
 *
 *   Markdown::render(string $md): string     HTML for the inside of a page (no <html>, no scripts, nothing else)
 *
 * The safety model is ESCAPE FIRST: every piece of text goes through htmlspecialchars before any formatting, and the
 * formatting only ever adds tags of a fixed whitelist with fixed attributes:
 *   blocks   h2 … h6 (# … ######; the page owns h1), p, ul / ol / li (nesting by indentation, code fences inside an item),
 *            pre > code (``` and ~~~ fences), table / thead / tbody / tr / th / td inside <div class="tablewrap">,
 *            blockquote (>), hr (--- *** ___)
 *   inline   code (`…`), strong (**…**), a (only http:// and https:// addresses with a host; the address is decoded once,
 *            checked, escaped again, and the link gets rel="noopener noreferrer"; any other target keeps only its
 *            text), br (two spaces at the end of a line)
 * Raw HTML is never passed through — it is shown as text — images are not supported and no attribute of the input is
 * ever copied, so no tag, attribute or entity of the input can survive (tests/inspect-unit.php: the XSS battery).
 * Bounded work: input ≤ 2 MB, quotes nest ≤ 8 deep, tables ≤ 64 columns, inline patterns have bounded lengths, and a
 * pattern that fails (PCRE limits) leaves the text escaped but unformatted.
 * PHP 7.2 syntax only.
 */
declare(strict_types=1);

namespace Tfm;

if (!defined('TFM_BOOT')) { if (function_exists('header_remove')) header_remove('X-Powered-By'); http_response_code(404); exit; }

final class Markdown
{
    public const MAX_BYTES = 2097152;
    private const MAX_DEPTH = 8;
    private const MAX_COLS = 64;
    /** private markers inside the escaped text: \x01 = a hard line break, \x02 = an escaped table pipe, \x03n\x03 = slot n */
    private const BR = "\x01";

    public static function render(string $md): string
    {
        if (strlen($md) > self::MAX_BYTES) $md = substr($md, 0, self::MAX_BYTES);
        if (!mb_check_encoding($md, 'UTF-8')) $md = (string) mb_convert_encoding($md, 'UTF-8', 'UTF-8');
        $md = str_replace(["\r\n", "\r", "\t"], ["\n", "\n", '    '], $md);
        // control characters (NUL and the private markers included) and bidi overrides never reach the output
        $clean = preg_replace('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]|\x{202A}|\x{202B}|\x{202C}|\x{202D}|\x{202E}|[\x{2066}-\x{2069}]/u', '', $md);
        $md = is_string($clean) ? $clean : (string) preg_replace('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/', '', $md);
        return self::blocks(explode("\n", $md), 0);
    }

    // ------------------------------------------------------------------ blocks
    /** @param string[] $lines */
    private static function blocks(array $lines, int $depth): string
    {
        $out = [];
        $n = count($lines);
        $quotes = $depth < self::MAX_DEPTH;
        $i = 0;
        while ($i < $n) {
            $line = $lines[$i];
            if (trim($line) === '') { $i++; continue; }
            if (self::fence($line) !== null) {
                list($html, $i) = self::code($lines, $i, 0);
                $out[] = $html;
                continue;
            }
            if (preg_match('/^ {0,3}(#{1,6})(?:[ ]+(.*?))?[ ]*$/', $line, $m)) {
                $text = isset($m[2]) ? (string) preg_replace('/(?:^|[ ]+)#+$/', '', $m[2]) : '';
                $h = min(6, strlen($m[1]) + 1);
                $out[] = '<h' . $h . '>' . self::inline(trim($text)) . '</h' . $h . '>';
                $i++;
                continue;
            }
            if (self::isRule($line)) { $out[] = '<hr>'; $i++; continue; }
            if ($quotes && preg_match('/^ {0,3}>/', $line)) {
                $inner = [];
                while ($i < $n && preg_match('/^ {0,3}> ?(.*)$/', $lines[$i], $m)) { $inner[] = $m[1]; $i++; }
                $out[] = '<blockquote>' . self::blocks($inner, $depth + 1) . '</blockquote>';
                continue;
            }
            if (self::tableStart($lines, $i)) {
                list($html, $i) = self::table($lines, $i);
                $out[] = $html;
                continue;
            }
            if (self::item($line) !== null) {
                list($html, $i) = self::lists($lines, $i, $quotes);
                $out[] = $html;
                continue;
            }
            $para = [];
            while ($i < $n && trim($lines[$i]) !== '' && ($para === [] || !self::startsBlock($lines, $i, $quotes))) {
                $para[] = trim($lines[$i]) . (preg_match('/ {2,}$/', $lines[$i]) ? self::BR : '');
                $i++;
            }
            $out[] = '<p>' . self::inline(rtrim(implode("\n", $para), self::BR)) . '</p>';
        }
        return implode("\n", $out);
    }

    /** the fence of a code block opening on this line ("```", "~~~~" …) after at most $max extra spaces, else null */
    private static function fence(string $line, int $indent = 0): ?string
    {
        return preg_match('/^ {0,' . (3 + $indent) . '}(`{3,}|~{3,})/', $line, $m) ? $m[1] : null;
    }

    /** a fenced block from line $i: [html, next line]; $strip = spaces taken off each line (a fence inside a list item) */
    private static function code(array $lines, int $i, int $strip): array
    {
        $f = (string) self::fence($lines[$i], $strip);
        $close = '/^ {0,' . (3 + $strip) . '}' . preg_quote($f[0], '/') . '{' . strlen($f) . ',}[ ]*$/';
        $code = [];
        $n = count($lines);
        for ($i++; $i < $n && !preg_match($close, $lines[$i]); $i++) {
            $code[] = $strip > 0 ? (string) preg_replace('/^ {1,' . $strip . '}/', '', $lines[$i]) : $lines[$i];
        }
        return ['<pre><code>' . self::esc(implode("\n", $code)) . '</code></pre>', $i + 1];
    }

    private static function isRule(string $line): bool
    {
        return preg_match('/^ {0,3}([-*_])(?:[ ]*\1){2,}[ ]*$/', $line) === 1;
    }

    /** a list item: [indent, 'ul' | 'ol', content], else null */
    private static function item(string $line): ?array
    {
        if (self::isRule($line) || !preg_match('/^( *)([-*+]|\d{1,9}[.)])(?:[ ]+(.*)|[ ]*$)/', $line, $m)) return null;
        return [strlen($m[1]), ctype_digit($m[2][0]) ? 'ol' : 'ul', isset($m[3]) ? $m[3] : ''];
    }

    private static function startsBlock(array $lines, int $i, bool $quotes): bool
    {
        $l = $lines[$i];
        return self::fence($l) !== null || preg_match('/^ {0,3}#{1,6}(?:[ ]|$)/', $l) === 1 || self::isRule($l)
            || ($quotes && preg_match('/^ {0,3}>/', $l) === 1) || self::item($l) !== null || self::tableStart($lines, $i);
    }

    /** lists from line $i: nesting by indentation, lazy continuation lines, code fences inside an item → [html, next line] */
    private static function lists(array $lines, int $i, bool $quotes): array
    {
        $n = count($lines);
        $html = '';
        $stack = [];   // open lists, innermost last: ['indent' => int, 'tag' => 'ul' | 'ol']
        $text = [];    // the text of the item that is open now (not yet written)
        $flush = function () use (&$html, &$text): void {
            if ($text) $html .= self::inline(implode("\n", $text));
            $text = [];
        };
        while ($i < $n) {
            $line = $lines[$i];
            $it = self::item($line);
            if ($it !== null) {
                list($indent, $tag, $content) = $it;
                $flush();
                while ($stack && $indent < $stack[count($stack) - 1]['indent']) {
                    $top = array_pop($stack);
                    $html .= '</li></' . $top['tag'] . '>';
                }
                $top = $stack ? $stack[count($stack) - 1] : null;
                if ($top === null || $indent > $top['indent']) {
                    $html .= '<' . $tag . '><li>';
                    $stack[] = ['indent' => $indent, 'tag' => $tag];
                } elseif ($top['tag'] !== $tag) {
                    array_pop($stack);
                    $html .= '</li></' . $top['tag'] . '><' . $tag . '><li>';
                    $stack[] = ['indent' => $indent, 'tag' => $tag];
                } else {
                    $html .= '</li><li>';
                }
                if (trim($content) !== '') $text[] = trim($content);
                $i++;
                continue;
            }
            if (trim($line) === '') {
                // a blank line keeps the list only when an indented line or an item of the same kind follows
                $j = $i + 1;
                while ($j < $n && trim($lines[$j]) === '') $j++;
                $next = $j < $n ? self::item($lines[$j]) : null;
                $lead = $j < $n ? strlen($lines[$j]) - strlen(ltrim($lines[$j], ' ')) : 0;
                $base = $stack[0];
                if ($j >= $n || !(($next !== null && ($next[0] > $base['indent'] || $next[1] === $base['tag'])) || ($next === null && $lead >= 2 && $lead > $base['indent']))) break;
                $i = $j;
                continue;
            }
            $lead = strlen($line) - strlen(ltrim($line, ' '));
            if ($lead >= 1 && self::fence($line, $lead) !== null) { $flush(); list($code, $i) = self::code($lines, $i, $lead); $html .= $code; continue; }
            if ($lead === 0 && self::startsBlock($lines, $i, $quotes)) break;
            if ($lead > 0 && (self::tableStart($lines, $i) || self::isRule($line))) break;
            $text[] = trim($line) . (preg_match('/ {2,}$/', $line) ? self::BR : '');
            $i++;
        }
        $flush();
        while ($stack) {
            $top = array_pop($stack);
            $html .= '</li></' . $top['tag'] . '>';
        }
        return [$html, $i];
    }

    // ------------------------------------------------------------------ tables
    private static function tableStart(array $lines, int $i): bool
    {
        return strpos($lines[$i], '|') !== false && isset($lines[$i + 1]) && self::isDelimiter($lines[$i + 1]);
    }

    private static function isDelimiter(string $line): bool
    {
        return strpos($line, '|') !== false && preg_match('/^ {0,3}\|?[ ]*:?-+:?[ ]*(?:\|[ ]*:?-+:?[ ]*)*\|?[ ]*$/', $line) === 1;
    }

    /** the cells of a table row ("\|" is a literal pipe), at most MAX_COLS */
    private static function cells(string $line): array
    {
        $t = trim(str_replace('\\|', "\x02", $line));
        if ($t !== '' && $t[0] === '|') $t = substr($t, 1);
        if ($t !== '' && substr($t, -1) === '|') $t = substr($t, 0, -1);
        $out = [];
        foreach (array_slice(explode('|', $t), 0, self::MAX_COLS) as $c) $out[] = trim(str_replace("\x02", '|', $c));
        return $out;
    }

    private static function table(array $lines, int $i): array
    {
        $head = self::cells($lines[$i]);
        $cols = max(1, count($head));
        $h = '<div class="tablewrap"><table><thead><tr>';
        foreach ($head as $c) $h .= '<th>' . self::inline($c) . '</th>';
        $h .= '</tr></thead><tbody>';
        $n = count($lines);
        for ($i += 2; $i < $n && trim($lines[$i]) !== '' && strpos($lines[$i], '|') !== false && preg_match('/^ {0,3}(?:#{1,6}(?:[ ]|$)|>|`{3,}|~{3,})/', $lines[$i]) !== 1; $i++) {
            $row = array_pad(array_slice(self::cells($lines[$i]), 0, $cols), $cols, '');
            $h .= '<tr>';
            foreach ($row as $c) $h .= '<td>' . self::inline($c) . '</td>';
            $h .= '</tr>';
        }
        return [$h . '</tbody></table></div>', $i];
    }

    // ------------------------------------------------------------------ inline
    public static function esc(string $s): string
    {
        return htmlspecialchars($s, ENT_QUOTES | ENT_SUBSTITUTE | ENT_HTML401, 'UTF-8');
    }

    /** preg_replace_callback that leaves the (already escaped) text alone when the pattern fails */
    private static function re(string $pattern, string $text, callable $fn): string
    {
        $r = preg_replace_callback($pattern, $fn, $text);
        return is_string($r) ? $r : $text;
    }

    /** a link target this renderer writes: http(s), a host, no quotes / angle brackets / backslashes / spaces / controls */
    public static function safeUrl(string $url): bool
    {
        return strlen($url) <= 2000
            && preg_match('#^https?://[A-Za-z0-9](?:[A-Za-z0-9.\-]*[A-Za-z0-9])?(?::\d{1,5})?(?:[/?\#][^\s"\'<>`\\\\\x00-\x1F\x7F]*)?$#i', $url) === 1;
    }

    /** escape, then the inline whitelist: `code`, [text](http(s) link), **bold**, hard breaks */
    private static function inline(string $text): string
    {
        $slots = [];
        $keep = function (string $html) use (&$slots): string {
            $slots[] = $html;
            return "\x03" . (count($slots) - 1) . "\x03";
        };
        $t = self::esc($text);
        $t = self::re('/`([^`\n]{1,2000})`/', $t, function ($m) use ($keep) { return $keep('<code>' . $m[1] . '</code>'); });
        $t = self::re('/\[([^\[\]\n]{1,500})\]\(([^()\s]{1,2000})\)/', $t, function ($m) use ($keep) {
            $label = self::bold($m[1]);
            $url = html_entity_decode($m[2], ENT_QUOTES | ENT_HTML401, 'UTF-8');
            if (!self::safeUrl($url)) return $label;
            return $keep('<a href="' . self::esc($url) . '" rel="noopener noreferrer">' . $label . '</a>');
        });
        $t = str_replace(self::BR, '<br>', self::bold($t));
        // put the kept pieces back (a link label may hold a code span: a few rounds at most)
        for ($round = 0; $round < 4 && strpos($t, "\x03") !== false; $round++) {
            $t = self::re('/\x03(\d+)\x03/', $t, function ($m) use (&$slots) { return isset($slots[(int) $m[1]]) ? $slots[(int) $m[1]] : ''; });
        }
        return str_replace(["\x03", "\x02"], ['', '|'], $t);
    }

    private static function bold(string $t): string
    {
        return self::re('/\*\*(?=[^\s*])([^*\n]{1,1000}?)(?<=[^\s*])\*\*/', $t, function ($m) { return '<strong>' . $m[1] . '</strong>'; });
    }
}
