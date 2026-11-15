<?php
/**
 * tests/stubs/kma-stub.php — a stand-in for the 기상청 단기예보 조회서비스 (data.go.kr VilageFcstInfoService_2.0) used by
 * tests/env-unit.php (CONTRACT §17.5). Router script for the PHP built-in server:
 *
 *   KMA_STUB_LOG=<file> KMA_STUB_KEY=<the decoded test key> php -S 127.0.0.1:25346 tests/stubs/kma-stub.php
 *
 * The first path segment chooses the behaviour, the rest is the agency's path:
 *   /<mode>/getUltraSrtNcst?serviceKey=…&pageNo=1&numOfRows=60&dataType=JSON&base_date=yyyymmdd&base_time=HH00&nx=89&ny=123
 *   /<mode>/getUltraSrtFcst?…&base_time=HH30…
 * modes: ok · rain · snow · sleet · fog · cloudy · nodata (resultCode 03) · badparam (10) · xmlkey (gateway XML, reason 30)
 *        · limit (gateway XML, reason 22) · http500 · slow (5 s) · garbage (not JSON) · missing (T1H = -999)
 *        · fcstfail (observation fine, forecast answers a gateway error)
 * Like the real service it checks the request itself: a wrong key → the gateway's XML key error, a malformed base_date /
 * base_time / nx / ny or dataType → resultCode 10. Every request is appended to KMA_STUB_LOG as one JSON line (the key
 * only as "matched": true / false). CLI test tooling; never deployed.
 */
declare(strict_types=1);

$uri = (string) parse_url((string) ($_SERVER['REQUEST_URI'] ?? '/'), PHP_URL_PATH);
$parts = array_values(array_filter(explode('/', $uri), 'strlen'));
$mode = $parts[0] ?? 'ok';
$op = $parts[1] ?? '';
$q = $_GET;
$key = (string) getenv('KMA_STUB_KEY');
$matched = isset($q['serviceKey']) && is_string($q['serviceKey']) && $key !== '' && hash_equals($key, $q['serviceKey']);
$log = (string) getenv('KMA_STUB_LOG');
if ($log !== '') {
    $rec = $q; unset($rec['serviceKey']);
    @file_put_contents($log, json_encode(['mode' => $mode, 'op' => $op, 'q' => $rec, 'keyMatched' => $matched]) . "\n", FILE_APPEND | LOCK_EX);
}

function xmlError(string $msg, string $code): void
{
    header('Content-Type: text/xml;charset=UTF-8');
    echo "<OpenAPI_ServiceResponse>\n\t<cmmMsgHeader>\n\t\t<errMsg>SERVICE ERROR</errMsg>\n\t\t<returnAuthMsg>$msg</returnAuthMsg>\n\t\t<returnReasonCode>$code</returnReasonCode>\n\t</cmmMsgHeader>\n</OpenAPI_ServiceResponse>";
    exit;
}
function jsonHeader(string $code, string $msg): void
{
    header('Content-Type: application/json;charset=UTF-8');
    echo json_encode(['response' => ['header' => ['resultCode' => $code, 'resultMsg' => $msg]]]);
    exit;
}
function items(array $list, int $total): void
{
    header('Content-Type: application/json;charset=UTF-8');
    echo json_encode(['response' => ['header' => ['resultCode' => '00', 'resultMsg' => 'NORMAL_SERVICE'],
        'body' => ['dataType' => 'JSON', 'items' => ['item' => $list], 'pageNo' => 1, 'numOfRows' => 60, 'totalCount' => $total]]], JSON_UNESCAPED_UNICODE);
    exit;
}

if (!in_array($op, ['getUltraSrtNcst', 'getUltraSrtFcst'], true)) { http_response_code(404); echo 'Not Found'; exit; }
if ($mode === 'http500') { http_response_code(500); header('Content-Type: text/html'); echo '<html><body>Internal Server Error</body></html>'; exit; }
if ($mode === 'slow') { sleep(5); }
if (!$matched) xmlError('SERVICE_KEY_IS_NOT_REGISTERED_ERROR', '30');
if ($mode === 'xmlkey') xmlError('SERVICE_KEY_IS_NOT_REGISTERED_ERROR', '30');
if ($mode === 'limit') xmlError('LIMITED_NUMBER_OF_SERVICE_REQUESTS_EXCEEDS_ERROR', '22');
if ($mode === 'fcstfail' && $op === 'getUltraSrtFcst') xmlError('SERVICE_ACCESS_DENIED_ERROR', '20');
$bd = (string) ($q['base_date'] ?? ''); $bt = (string) ($q['base_time'] ?? '');
$okTime = $op === 'getUltraSrtNcst' ? preg_match('/^(?:[01]\d|2[0-3])00$/', $bt) : preg_match('/^(?:[01]\d|2[0-3])30$/', $bt);
if (!preg_match('/^20\d{6}$/', $bd) || !$okTime || ($q['nx'] ?? '') !== '89' || ($q['ny'] ?? '') !== '123' || ($q['dataType'] ?? '') !== 'JSON' || !ctype_digit((string) ($q['numOfRows'] ?? ''))) {
    jsonHeader('10', 'INVALID_REQUEST_PARAMETER_ERROR');
}
if ($mode === 'badparam') jsonHeader('10', 'INVALID_REQUEST_PARAMETER_ERROR');
if ($mode === 'nodata') jsonHeader('03', 'NO_DATA');
if ($mode === 'garbage') { header('Content-Type: application/json'); echo '{"response":{"header":{"resultCode":"00"'; exit; }

// the weather of each mode: [T1H, REH, WSD, RN1, PTY, SKY]
$W = [
    'ok' => ['8.2', '55', '2.1', '0', '0', '1'], 'cloudy' => ['6.0', '70', '1.5', '0', '0', '4'], 'rain' => ['11.4', '93', '3.4', '2.5', '1', '4'],
    'snow' => ['-2.6', '88', '1.9', '0.8', '3', '4'], 'sleet' => ['0.3', '95', '2.2', '1.0', '2', '4'], 'fog' => ['4.1', '98', '0.6', '0', '0', '3'],
    'missing' => ['-999', '-999', '-999', '-999', '0', '1'], 'fcstfail' => ['9.0', '60', '1.0', '0', '0', '3'], 'slow' => ['8.0', '50', '1.0', '0', '0', '1'],
];
$w = $W[$mode] ?? $W['ok'];
if ($op === 'getUltraSrtNcst') {
    $list = [];
    foreach (['PTY' => $w[4], 'REH' => $w[1], 'RN1' => $w[3], 'T1H' => $w[0], 'UUU' => '1.2', 'VEC' => '270', 'VVV' => '-0.5', 'WSD' => $w[2]] as $cat => $v) {
        $list[] = ['baseDate' => $bd, 'baseTime' => $bt, 'category' => $cat, 'nx' => 89, 'ny' => 123, 'obsrValue' => $v];
    }
    items($list, count($list));
}
// 초단기예보: six hours from base_time + 1 h (as the agency does), categories LGT PTY RN1 SKY T1H REH UUU VVV VEC WSD
$t0 = gmmktime((int) substr($bt, 0, 2), 0, 0, (int) substr($bd, 4, 2), (int) substr($bd, 6, 2), (int) substr($bd, 0, 4)) + 3600;
$list = [];
foreach (['LGT' => '0', 'PTY' => $w[4], 'RN1' => $w[3] === '0' ? '강수없음' : '1.0mm', 'SKY' => $w[5], 'T1H' => $w[0], 'REH' => $w[1], 'WSD' => $w[2]] as $cat => $v) {
    for ($i = 0; $i < 6; $i++) {
        $tt = $t0 + $i * 3600;
        // the forecast is one degree warmer each hour and turns cloudy after its first hour (so `next` is checked as the forecast's)
        $vv = $cat === 'SKY' && $i >= 1 ? '4' : ($cat === 'T1H' && is_numeric($v) && (float) $v > -900 ? (string) ((float) $v + 1 + $i) : $v);
        $list[] = ['baseDate' => $bd, 'baseTime' => $bt, 'category' => $cat, 'fcstDate' => gmdate('Ymd', $tt), 'fcstTime' => gmdate('H00', $tt), 'fcstValue' => $vv, 'nx' => 89, 'ny' => 123];
    }
}
items($list, count($list));
