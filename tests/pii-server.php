<?php
/**
 * tests/pii-server.php — runs the REAL server text filters for the PII tests (tests/server-e2e.mjs, tests/pii-client.mjs).
 *
 *   php tests/pii-server.php < {"texts":[...], "nicks":[...], "keys":[...]}
 *   → {"intl":bool, "rules":[names], "mask":[ChatFilter::maskPII(t)], "pipe":[send.php pipeline: cleanText → maskPII → mask],
 *      "nick":[Users::validNickname(n) error or null], "key":[ChatFilter::key(k)]}
 *   keys: stored chat texts — the e2e checks that every stored repeat-spam key is ChatFilter::key() of the stored
 *   (already PII-masked) text, i.e. the key can never hold more than the masked message does.
 *
 * Without the intl extension (php -n -d extension=mbstring) the no-intl fold fallback is exercised.
 * CLI only; never deployed as an endpoint (tests/ is not part of the web root). PHP 7.2 syntax (runs on the target PHP too).
 */
declare(strict_types=1);

if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
require __DIR__ . '/../server/lib/bootstrap.php';

use Tfm\ChatFilter;
use Tfm\Users;

$in = json_decode((string) stream_get_contents(STDIN), true);
if (!is_array($in)) { fwrite(STDERR, "expected a JSON object on stdin\n"); exit(2); }
$texts = array_values(array_filter((array) (isset($in['texts']) ? $in['texts'] : []), 'is_string'));
$nicks = array_values(array_filter((array) (isset($in['nicks']) ? $in['nicks'] : []), 'is_string'));
$keys = array_values(array_filter((array) (isset($in['keys']) ? $in['keys'] : []), 'is_string'));
$out = [
    'intl' => class_exists('Normalizer'),
    'rules' => ChatFilter::piiRuleNames(),
    'mask' => array_map(function (string $t): string { return ChatFilter::maskPII($t); }, $texts),
    'pipe' => array_map(function (string $t): string { return ChatFilter::mask(ChatFilter::maskPII(Users::cleanText($t, 1000))); }, $texts),
    'nick' => array_map(function (string $n): ?string { return Users::validNickname(Users::cleanText($n, 40)); }, $nicks),
    'key' => array_map(function (string $k): string { return ChatFilter::key($k); }, $keys),
];
echo json_encode($out, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE);
