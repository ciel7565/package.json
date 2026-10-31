<?php
/**
 * POST api/sub/webhook.php — 토스페이먼츠 webhook target (PAYMENT_STATUS_CHANGED, CANCEL …). No session, no CSRF
 * (there is no browser): the body is never trusted — the payment is re-fetched by its key (skipped in mock mode,
 * where the key must match the stored order), events are recorded idempotently, canceled / refunded orders downgrade
 * the subscription they paid for. Nothing here can raise a tier. Rate-limited per IP. Always answers 200 so 토스
 * does not retry forever; what happened is in `data`.
 */
declare(strict_types=1);

require __DIR__ . '/../../lib/bootstrap.php';

use Tfm\Api;
use Tfm\Ctx;
use Tfm\Http;
use Tfm\Log;
use Tfm\Subscription;

Api::run(['method' => 'POST', 'csrf' => false, 'rate' => 'sub_webhook', 'rateBy' => 'ip'], function (Ctx $c): array {
    $raw = Http::body(65536);
    $payload = \Tfm\Json::tryDecode($raw, true);
    if (!is_array($payload)) { Log::warn('SUB', 'webhook with a non-JSON body'); return ['received' => true, 'ignored' => true, 'why' => 'not json']; }
    $r = Subscription::webhook($payload);
    return ['received' => true] + $r;
});
