<?php
/**
 * tests/pii-server.php — runs the REAL server text filters for the PII tests (tests/server-e2e.mjs, tests/pii-client.mjs).
 *
 *   php tests/pii-server.php < {"texts":[...], "nicks":[...]}
 *   → {"intl":bool, "rules":[names], "mask":[ChatFilter::maskPII(t)], "pipe":[send.php pipeline: cleanText → maskPII → mask],
 *      "nick":[Users::validNickname(n) error or null]}
 *
 * Without the intl extension (php -n -d extension=mbstring) the no-intl fold fallback is exercised.
 * CLI only; never deployed as an endpoint (tests/ is not part of the web root).
 */
declare(strict_types=1);

if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
require __DIR__ . '/../server/lib/bootstrap.php';

use Tfm\{ChatFilter, Users};

$in = json_decode((string) stream_get_contents(STDIN), true);
if (!is_array($in)) { fwrite(STDERR, "expected a JSON object on stdin\n"); exit(2); }
$texts = array_values(array_filter((array) ($in['texts'] ?? []), 'is_string'));
$nicks = array_values(array_filter((array) ($in['nicks'] ?? []), 'is_string'));
$out = [
    'intl' => class_exists(\Normalizer::class),
    'rules' => ChatFilter::piiRuleNames(),
    'mask' => array_map(fn (string $t): string => ChatFilter::maskPII($t), $texts),
    'pipe' => array_map(fn (string $t): string => ChatFilter::mask(ChatFilter::maskPII(Users::cleanText($t, 1000))), $texts),
    'nick' => array_map(fn (string $n): ?string => Users::validNickname(Users::cleanText($n, 40)), $nicks),
];
echo json_encode($out, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE);
