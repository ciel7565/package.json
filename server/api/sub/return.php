<?php
/**
 * GET api/sub/return.php — where the 토스 결제창 sends the browser back (successUrl / failUrl of prepare.php):
 *   ?kind=card&paymentKey=…&orderId=…&amount=…        → confirm
 *   ?kind=billing&authKey=…&customerKey=…&orderId=…   → issue the billing key + first charge
 *   ?code=…&message=…  (or &fail=1)                   → failure
 * A top-level GET navigation carries the SameSite=Lax session cookie, so the logged-in player's order is confirmed
 * server-to-server and the browser is redirected to the app: index.html?sub=ok&tier=N, index.html?sub=fail&code=…
 * (the payment window failed) or index.html?sub=fail&why=… (this script refused or could not finish).
 * The order must belong to the logged-in session (confirm/billingIssue refuse foreign or replayed orders).
 * Finding F11: what the payment window sends back in ?code= / ?message= is never passed on — the code is mapped to a
 * known code (or OTHER); logs get the mapped code only.
 * Finding C1 (CONTRACT §15.7 #4): the redirect carries words from closed lists only, never a sentence. Anyone can write
 * an index.html?sub=fail&… link, so the app (src/game/72-subscription.js, RETURN_*_KO) holds the Korean sentence for
 * each word, shows nothing from the address and ignores a ?msg=. why: LOGIN (no session), AMOUNT (not a number / not
 * the order's), ORDER (unknown, foreign or malformed), DONE (already handled or being checked), DECLINED (the gateway
 * refused), MISMATCH (the gateway's answer differs from the order — a refund was requested), PENDING (the gateway has
 * not answered yet), CONFIG (payments are not set up), SERVER (an error here), OTHER.
 */
declare(strict_types=1);

require __DIR__ . '/../../lib/bootstrap.php';

use Tfm\ApiException;
use Tfm\Auth;
use Tfm\Ctx;
use Tfm\Http;
use Tfm\Log;
use Tfm\RateLimit;
use Tfm\Session;
use Tfm\Subscription;

ob_start();
set_error_handler(static function (int $no, string $msg, string $file = '', int $line = 0): bool {
    if (!(error_reporting() & $no)) return false;
    throw new \ErrorException($msg, 0, $no, $file, $line);
});

$nonce = base64_encode(random_bytes(16));
$q = function (string $k): string { return isset($_GET[$k]) && is_string($_GET[$k]) ? mb_substr($_GET[$k], 0, 300) : ''; };
$base = Http::basePath();
$redirect = function (string $query) use ($base): void {
    while (ob_get_level() > 0) ob_end_clean();
    header('Location: ' . $base . 'index.html?' . $query, true, 303);
    Session::close();
    exit;
};
/** a refusal → index.html?sub=fail&why=<WORD> (finding C1: a word from the closed list above, never a sentence) */
$fail = function (string $why) use ($redirect): void { $redirect('sub=fail&why=' . rawurlencode($why)); };
/** 토스 결제창 failure codes the app has a sentence for (anything else: OTHER) */
$windowCode = function (string $code): string {
    $known = ['PAY_PROCESS_CANCELED', 'USER_CANCEL', 'PAY_PROCESS_ABORTED', 'REJECT_CARD_COMPANY', 'REJECT_CARD_PAYMENT', 'EXCEED_MAX_DAILY_PAYMENT_COUNT', 'INVALID_CARD_EXPIRATION'];
    $c = strtoupper($code);
    return preg_match('/^[A-Z_]{1,60}$/', $c) && in_array($c, $known, true) ? $c : 'OTHER';
};
/** why confirm / billingIssue refused → the app's word (the exact error code goes to the log, the audit has the rest) */
$whyOf = function (ApiException $e): string {
    $map = [
        'ORDER_NOT_FOUND' => 'ORDER', 'NOT_FOUND' => 'ORDER', 'INVALID_PAYMENT_KEY' => 'ORDER', 'INVALID_AUTH_KEY' => 'ORDER',
        'INVALID_CUSTOMER' => 'ORDER', 'INVALID_KIND' => 'ORDER', 'INVALID_TIER' => 'ORDER',
        'AMOUNT_MISMATCH' => 'AMOUNT', 'ORDER_NOT_OPEN' => 'DONE', 'PAYMENT_PENDING' => 'PENDING', 'PAYMENT_NOT_CONFIGURED' => 'CONFIG',
    ];
    // PAYMENT_FAILED: the gateway refused (it named a code) or its answer did not match the order (refund requested)
    if ($e->errorCode === 'PAYMENT_FAILED') return is_array($e->data) && isset($e->data['tossCode']) ? 'DECLINED' : 'MISMATCH';
    if (isset($map[$e->errorCode])) return $map[$e->errorCode];
    if ($e->status === 401) return 'LOGIN';
    return $e->status >= 500 ? 'SERVER' : 'OTHER';
};

try {
    Http::securityHeaders('admin', $nonce);
    // the security layer's page guard (blocked addresses, plain HTTP where HTTPS is required, uploads) when it is there
    if (method_exists('Tfm\\Firewall', 'guardPage') && method_exists('Tfm\\Http', 'plainPage') && method_exists('Tfm\\Http', 'enforceHttps') && method_exists('Tfm\\Http', 'refuseUpload')) \Tfm\Firewall::guardPage();
    elseif (class_exists('Tfm\\Firewall')) \Tfm\Firewall::check();
    // CONTRACT §15.7 #10: the payment window comes back by a top-level navigation, never by a cross-origin fetch — a
    // preflight (OPTIONS) is refused with 403 and no Access-Control-* header, like every private endpoint (Api::run)
    Http::cors(false);
    if (Http::method() !== 'GET') { http_response_code(405); header('Allow: GET'); exit; }
    Session::start(false);
    $ctx = new Ctx();
    $ctx->user = Auth::current();
    // CONTRACT §15.7 #9: over the budget is a plain 429 page with Retry-After. It is never folded into the redirect to
    // the app (a 303 would hide the limit from the caller, and a flood would look like failed payments)
    try {
        RateLimit::forRequest('sub_return', $ctx, 'ip');
    } catch (ApiException $e) {
        Session::close();
        Http::plainPage($e->status, $e->getMessage(), $e->headers);
    }
    if ($q('code') !== '' || $q('fail') === '1') {
        $code = $windowCode($q('code'));
        Log::info('SUB', 'payment window returned a failure', ['code' => $code, 'uid' => $ctx->uid()]);
        $redirect('sub=fail&code=' . rawurlencode($code));
    }
    if (!$ctx->user) $fail('LOGIN');
    $kind = $q('kind');
    if ($kind === 'billing') {
        $sub = Subscription::billingIssue($ctx->user, $q('authKey'), $q('customerKey'), $q('orderId'));
    } else {
        $amount = $q('amount');
        if (!preg_match('/^\d{1,9}$/', $amount)) $fail('AMOUNT');
        $sub = Subscription::confirm($ctx->user, $q('paymentKey'), $q('orderId'), (int) $amount);
    }
    $redirect('sub=ok&tier=' . (int) $sub['tier']);
} catch (ApiException $e) {
    $why = $whyOf($e);
    Log::info('SUB', 'payment return refused', ['code' => $e->errorCode, 'why' => $why]);
    $fail($why);
} catch (\Throwable $e) {
    Log::error('SUB', 'return.php failed: ' . get_class($e) . ': ' . $e->getMessage(), ['at' => basename($e->getFile()) . ':' . $e->getLine()]);
    $fail('SERVER');
}
