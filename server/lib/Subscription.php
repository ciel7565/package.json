<?php
/**
 * Progression-speed subscription (CONTRACT §14.1 / §14.6): tiers 1..4 stored server-side (tables subscriptions,
 * orders, payment_events — schema v4). The client never decides its tier: me / login / player/get report it under
 * `sub`, player/save overwrites the client's `sub` with it, and SaveValidator scales its speed thresholds with it.
 *
 *   status  none | active | past_due | canceled
 *   kinds   first (one-month card payment or the first billing charge) · renewal (billing key) · manual (admin grant)
 *   renewal active && auto_renew && expires_at − 1 day < now → charge the billing key; failure → past_due, after
 *           grace_days → none. Runs from renew.php (admin), cli sub:renew, and lazily on login / me (once an hour per user).
 * All money is integer KRW. PHP 7.2 syntax only.
 */
declare(strict_types=1);

namespace Tfm;

if (!defined('TFM_BOOT')) { if (function_exists('header_remove')) header_remove('X-Powered-By'); http_response_code(404); exit; }

final class Subscription
{
    public const DAY_MS = 86400000;
    private const LAZY_INTERVAL_MS = 3600000;

    // ------------------------------------------------------------------ reading
    public static function row(int $uid): ?array
    {
        return $uid > 0 ? Db::one('SELECT * FROM subscriptions WHERE user_id = ?', [$uid]) : null;
    }

    /** what the client gets under `sub` (and what the save stores): the EFFECTIVE tier after expiry / lazy renewal */
    public static function state(int $uid, ?int $now = null): array
    {
        if ($now === null) $now = Clock::ms();
        $row = self::row($uid);
        if (!$row) return self::none();
        $row = self::settle($row, $now);
        return self::publicState($row, $now);
    }

    public static function none(): array { return ['tier' => 1, 'status' => 'none', 'expiresAt' => 0, 'autoRenew' => false]; }

    /** the effective tier for validation (1..4) */
    public static function tierFor(int $uid, ?int $now = null): int
    {
        $s = self::state($uid, $now);
        return (int) $s['tier'];
    }

    public static function publicState(array $row, int $now): array
    {
        $tier = max(1, min(4, (int) $row['tier']));
        $status = (string) $row['status'];
        $exp = (int) $row['expires_at'];
        $paid = ($status === 'active' && $exp > $now) || ($status === 'past_due' && $exp + Toss::graceDays() * self::DAY_MS > $now);
        return [
            'tier' => $paid ? $tier : 1,
            'status' => $paid ? $status : ($status === 'canceled' ? 'canceled' : 'none'),
            'expiresAt' => $exp,
            'autoRenew' => (int) $row['auto_renew'] === 1 && $paid,
        ];
    }

    /**
     * Apply what time did to a row: an expired auto-renew subscription is renewed lazily (bounded to once an hour per
     * user), an expired one without a billing key becomes none; past_due beyond the grace period becomes none.
     */
    private static function settle(array $row, int $now): array
    {
        $status = (string) $row['status'];
        $exp = (int) $row['expires_at'];
        if (!in_array($status, ['active', 'past_due'], true)) return $row;
        if ($status === 'active' && $exp > $now) return $row;
        $uid = (int) $row['user_id'];
        $auto = (int) $row['auto_renew'] === 1 && (string) $row['billing_key'] !== '';
        // finding F5: the page load fires me / get / status at once — exactly one of them may try the renewal. The claim is
        // one conditional UPDATE on the checked_at value this request read; the losers carry on with the stored state.
        if ($auto && (int) $row['checked_at'] + self::LAZY_INTERVAL_MS < $now
            && Db::exec('UPDATE subscriptions SET checked_at = ? WHERE user_id = ? AND checked_at = ?', [$now, $uid, (int) $row['checked_at']]) === 1) {
            try { self::renewOne($row, $now, false); } catch (\Throwable $e) { Log::error('SUB', 'lazy renewal failed: ' . get_class($e), ['uid' => $uid]); }
            $fresh = self::row($uid);
            if ($fresh) $row = $fresh;
            $status = (string) $row['status'];
            $exp = (int) $row['expires_at'];
        }
        $graceEnd = $exp + Toss::graceDays() * self::DAY_MS;
        if (($status === 'active' && $exp <= $now && !$auto) || ($status === 'past_due' && $graceEnd <= $now) || ($status === 'active' && $exp <= $now && $auto && $graceEnd <= $now)) {
            Db::exec("UPDATE subscriptions SET status = 'none', tier = 1, auto_renew = 0, updated_at = ? WHERE user_id = ? AND status = ?", [$now, $uid, $status]);
            Audit::log('sub_expired', $uid, ['from' => $status, 'tier' => (int) $row['tier']], 'info');
            $row['status'] = 'none';
            $row['tier'] = 1;
            $row['auto_renew'] = 0;
        } elseif ($status === 'active' && $exp <= $now && $auto) {
            // renewal did not go through yet (or failed): grace period
            Db::exec("UPDATE subscriptions SET status = 'past_due', updated_at = ? WHERE user_id = ? AND status = 'active'", [$now, $uid]);
            $row['status'] = 'past_due';
        }
        return $row;
    }

    public static function publicTiers(): array
    {
        $out = [];
        foreach (Toss::tiers() as $t => $v) $out[] = ['tier' => $t, 'name' => $v['name'], 'price' => $v['price']];
        return $out;
    }

    /** stable per-user customer key for 토스 billing (never the user id itself) */
    public static function customerKey(int $uid): string
    {
        return 'cus_' . substr(hash_hmac('sha256', 'cus:' . $uid, Config::secret('app_key')), 0, 32);
    }

    public static function orderId(): string
    {
        $alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
        $s = '';
        for ($i = 0; $i < 32; $i++) $s .= $alphabet[random_int(0, strlen($alphabet) - 1)];
        return $s;
    }

    public static function orderName(int $tier): string
    {
        return '전통발효체험관 진행 속도 ' . $tier . '배 (' . Toss::periodDays() . '일)';
    }

    private static function validTier(int $tier): int
    {
        if ($tier < 2 || $tier > 4) throw new ApiException(400, 'INVALID_TIER', '선택할 수 없는 단계예요.');
        return $tier;
    }

    // ------------------------------------------------------------------ orders
    public static function order(string $orderId): ?array
    {
        if (!preg_match('/^[A-Za-z0-9_\-]{8,64}$/', $orderId)) return null;
        return Db::one('SELECT * FROM orders WHERE order_id = ?', [$orderId]);
    }

    private static function createOrder(int $uid, int $tier, int $amount, string $kind, int $now, string $orderId = ''): array
    {
        if ($orderId === '') $orderId = self::orderId();
        Db::insert('orders', [
            'order_id' => $orderId, 'user_id' => $uid, 'tier' => $tier, 'amount' => $amount, 'currency' => 'KRW', 'kind' => $kind, 'status' => 'created',
            'payment_key' => '', 'method' => '', 'receipt_url' => '', 'toss_status' => '', 'raw' => '', 'requested_at' => $now, 'approved_at' => 0, 'created_at' => $now,
        ]);
        $o = self::order($orderId);
        if (!$o) throw new \RuntimeException('order insert failed');
        return $o;
    }

    /**
     * Store what 토스 answered for an order (never the secret key; the raw object is kept for the admin). Finding F6: only
     * a `created` order moves (and, with $claim, only the confirmation that claimed it), so a late or duplicate request
     * can never turn a paid order into a failed one. Returns whether this call moved the order.
     */
    private static function finishOrder(string $orderId, string $status, array $payment, int $now, ?string $claim = null): bool
    {
        $receipt = isset($payment['receipt']) && is_array($payment['receipt']) && isset($payment['receipt']['url']) && is_string($payment['receipt']['url']) ? $payment['receipt']['url'] : '';
        $raw = json_encode($payment, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PARTIAL_OUTPUT_ON_ERROR);
        $params = [
            $status,
            mb_substr((string) (isset($payment['paymentKey']) && is_string($payment['paymentKey']) ? $payment['paymentKey'] : ($claim !== null ? $claim : '')), 0, 200),
            mb_substr((string) (isset($payment['method']) && is_string($payment['method']) ? $payment['method'] : ''), 0, 40),
            mb_substr($receipt, 0, 500),
            mb_substr((string) (isset($payment['status']) && is_string($payment['status']) ? $payment['status'] : ''), 0, 40),
            is_string($raw) ? mb_substr($raw, 0, 60000) : '',
            $status === 'confirmed' ? $now : 0,
            $orderId,
        ];
        $sql = "UPDATE orders SET status = ?, payment_key = ?, method = CASE WHEN ? <> '' THEN ? ELSE method END, receipt_url = ?, toss_status = ?, raw = ?, approved_at = ? WHERE order_id = ? AND status = 'created'";
        array_splice($params, 2, 0, [$params[2]]); // the method appears twice (keep the prepared card / billing word when 토스 sends none)
        if ($claim !== null) { $sql .= ' AND payment_key = ?'; $params[] = $claim; }
        return Db::exec($sql, $params) === 1;
    }

    /**
     * §15.7 #15 / finding F10: what the gateway answered must be exactly this order — status DONE, totalAmount present and
     * equal to the server's amount (an integer), the same orderId, currency KRW, the same paymentKey. '' when it is, else
     * the reason (amount_missing | amount | order | currency | status | payment_key).
     */
    private static function paymentMismatch(array $p, string $orderId, int $amount, ?string $paymentKey = null): string
    {
        if ((string) (isset($p['status']) ? $p['status'] : '') !== 'DONE') return 'status';
        if (!array_key_exists('totalAmount', $p)) return 'amount_missing';
        if (!is_int($p['totalAmount']) || $p['totalAmount'] !== $amount) return 'amount';
        if (!isset($p['orderId']) || !is_string($p['orderId']) || !hash_equals($orderId, $p['orderId'])) return 'order';
        if (!isset($p['currency']) || $p['currency'] !== 'KRW') return 'currency';
        if ($paymentKey !== null && isset($p['paymentKey']) && (!is_string($p['paymentKey']) || !hash_equals($paymentKey, $p['paymentKey']))) return 'payment_key';
        return '';
    }

    /** payment_tamper (security event + audit): a request or a gateway answer that does not match the server's order */
    private static function tamper(int $uid, string $why, array $detail, string $severity = 'alert'): void
    {
        $detail = ['why' => $why] + $detail;
        if (class_exists('Tfm\\SecEvent')) SecEvent::log('payment_tamper', $severity, $detail, $uid > 0 ? $uid : null);
        Audit::log('sub_payment_tamper', $uid > 0 ? $uid : null, $detail, $severity === 'info' ? 'info' : 'alert');
    }

    /** a payment taken for an order that will not be honoured is given back (best effort; the admin sees the order) */
    private static function refundQuietly(array $payment, string $why): void
    {
        $key = isset($payment['paymentKey']) && is_string($payment['paymentKey']) ? $payment['paymentKey'] : '';
        if ($key === '' || (string) (isset($payment['status']) ? $payment['status'] : '') !== 'DONE') return;
        try { Toss::cancel($key, '주문 정보와 결제 정보가 달라 자동으로 취소했어요 (' . $why . ')'); }
        catch (\Throwable $e) { Log::error('SUB', 'automatic cancel failed', ['why' => $why, 'error' => get_class($e)]); }
    }

    // ------------------------------------------------------------------ billing keys (sealed, §15.7 #1)
    /** the billing key as stored: sealed with Tfm\\Crypto (enc:v1:…); a copied database alone cannot charge cards */
    private static function sealBillingKey(string $plain): string
    {
        if (!Crypto::fits($plain, 255)) throw new ApiException(500, 'BILLING_KEY_TOO_LONG', '결제 수단 정보가 너무 길어 저장하지 못했어요. 운영자에게 알려 주세요.');
        return Crypto::seal($plain);
    }

    /**
     * The billing key of a subscription row in plain text ('' when there is none or it cannot be opened — a lost
     * data_key). A key stored before sealing existed (or with the previous data key) is sealed again right away.
     */
    private static function billingKeyOf(array $row): string
    {
        $stored = (string) (isset($row['billing_key']) ? $row['billing_key'] : '');
        if ($stored === '') return '';
        $plain = Crypto::open($stored);
        if ($plain === null) {
            Log::error('SUB', 'a stored billing key cannot be opened (data_key changed or lost?)', ['uid' => (int) $row['user_id']]);
            return '';
        }
        if (Crypto::needsReseal($stored)) {
            try {
                Db::exec('UPDATE subscriptions SET billing_key = ? WHERE user_id = ? AND billing_key = ?', [self::sealBillingKey($plain), (int) $row['user_id'], $stored]);
            } catch (\Throwable $e) { Log::warn('SUB', 'billing key could not be sealed now', ['error' => get_class($e)]); }
        }
        return $plain;
    }

    /** seal every billing key that is still plain text or sealed with the previous key (secret:rotate --data-key, upgrades) */
    public static function resealBillingKeys(): int
    {
        $n = 0;
        foreach (Db::all("SELECT user_id, billing_key FROM subscriptions WHERE billing_key <> ''") as $r) {
            if (!Crypto::needsReseal((string) $r['billing_key'])) continue;
            $plain = Crypto::open((string) $r['billing_key']);
            if ($plain === null) continue;
            $n += Db::exec('UPDATE subscriptions SET billing_key = ? WHERE user_id = ? AND billing_key = ?', [self::sealBillingKey($plain), (int) $r['user_id'], (string) $r['billing_key']]);
        }
        return $n;
    }

    /** an integer from a JSON body: a JSON integer only (a digit string, float, exponent, boolean or array is refused) */
    public static function jsonInt($v, string $field, int $min, int $max): int
    {
        if (!is_int($v)) V::fail($field, '값은 정수로 보내 주세요.');
        return V::int($v, $field, $min, $max);
    }

    // ------------------------------------------------------------------ activation
    /**
     * extend / activate: expires_at = max(now, expires_at) + period; status active; tier set.
     * Always one transaction that holds the account's locks (review finding: two payments of one account at the same
     * moment on MySQL / MariaDB): the users row is locked first — it always exists, so two first subscriptions queue on
     * it instead of both taking the gap lock of the missing subscriptions row (an InnoDB deadlock) — then the
     * subscription is read with a locking read. A plain SELECT reads an old snapshot there: both payments would add
     * their period to the same old expiry and one paid period would be lost. SQLite: BEGIN IMMEDIATE already serialises.
     */
    private static function activate(int $uid, int $tier, int $periodMs, int $now, array $extra = []): array
    {
        return Db::tx(function () use ($uid, $tier, $periodMs, $now, $extra) {
            Db::one('SELECT id FROM users WHERE id = ?' . Db::forUpdate(), [$uid]);
            return self::activateLocked($uid, $tier, $periodMs, $now, $extra, Db::one('SELECT * FROM subscriptions WHERE user_id = ?' . Db::forUpdate(), [$uid]));
        });
    }

    /** activate() once the account is locked; $row = the subscription as it is now (null: none yet) */
    private static function activateLocked(int $uid, int $tier, int $periodMs, int $now, array $extra, ?array $row): array
    {
        $base = $row ? max($now, (int) $row['expires_at']) : $now;
        // a different tier starts a fresh period from now (no mixing of two prices in one period)
        if ($row && (int) $row['tier'] !== $tier) $base = $now;
        $fields = [
            'user_id' => $uid, 'tier' => $tier, 'status' => 'active', 'started_at' => $row && (int) $row['started_at'] > 0 && (int) $row['tier'] === $tier && (int) $row['expires_at'] > $now ? (int) $row['started_at'] : $now,
            'expires_at' => $base + $periodMs, 'auto_renew' => $row ? (int) $row['auto_renew'] : 0,
            // a billing key belongs to the customer key it was issued for: kept while it exists (secret:rotate --app-key
            // changes the derived key; re-deriving it here would make the next renewal charge fail)
            'billing_key' => $row ? (string) $row['billing_key'] : '',
            'customer_key' => $row && (string) $row['customer_key'] !== '' && (string) $row['billing_key'] !== '' ? (string) $row['customer_key'] : self::customerKey($uid),
            'last_order_id' => $row ? (string) $row['last_order_id'] : '', 'checked_at' => $now, 'updated_at' => $now,
        ];
        foreach ($extra as $k => $v) $fields[$k] = $v;
        Db::upsert('subscriptions', $fields, ['user_id']);
        $fresh = self::row($uid);
        return $fresh ? $fresh : $fields;
    }

    // ------------------------------------------------------------------ player flows (api/sub/*)
    /** prepare.php: a `created` order the browser pays with the 토스 SDK (kind card = one month, billing = auto-renew) */
    public static function prepare(array $user, int $tier, string $kind): array
    {
        $tier = self::validTier($tier);
        if (!in_array($kind, ['card', 'billing'], true)) throw new ApiException(400, 'INVALID_KIND', '결제 방식이 올바르지 않아요.');
        Toss::requireAvailable(); // no keys and no (allowed) mock mode: 503 PAYMENT_NOT_CONFIGURED, no order is made
        $uid = (int) $user['id'];
        $now = Clock::ms();
        $amount = Toss::price($tier);
        $o = self::createOrder($uid, $tier, $amount, 'first', $now);
        Db::exec('UPDATE orders SET method = ? WHERE id = ?', [$kind === 'billing' ? 'billing' : 'card', (int) $o['id']]);
        Audit::log('sub_prepare', $uid, ['order' => $o['order_id'], 'tier' => $tier, 'kind' => $kind, 'amount' => $amount]);
        $base = Http::baseUrl() . 'api/sub/return.php?kind=' . $kind;
        return [
            'orderId' => $o['order_id'], 'amount' => $amount, 'orderName' => self::orderName($tier), 'tier' => $tier, 'kind' => $kind,
            'customerKey' => self::customerKey($uid), 'clientKey' => Toss::clientKey(),
            'successUrl' => $base, 'failUrl' => $base . '&fail=1', 'mock' => Toss::mock(),
        ];
    }

    /** the largest amount a single payment may have (KRW) — anything above is a typing error or tampering */
    public const MAX_AMOUNT = 10000000;
    /** a confirmation that ended without an answer (network) may be looked up again after this many seconds */
    private const RETRY_AFTER_S = 30;

    /**
     * Claim a `created` order for one confirmation (finding F6): the order row is locked, its payment_key set to $marker
     * and toss_status to CONFIRMING in one transaction — a second confirmation (double click, replay, two tabs) finds it
     * taken. → 'claimed' | 'resume' (the same key, claimed more than RETRY_AFTER_S ago without an answer) | 'busy' | 'closed'
     */
    private static function claimOrder(string $orderId, string $marker, int $now): string
    {
        return Db::tx(function () use ($orderId, $marker, $now) {
            $r = Db::one('SELECT status, payment_key, toss_status, raw FROM orders WHERE order_id = ?' . Db::forUpdate(), [$orderId]);
            if (!$r || (string) $r['status'] !== 'created') return 'closed';
            if ((string) $r['payment_key'] === '') {
                $n = Db::exec("UPDATE orders SET payment_key = ?, toss_status = 'CONFIRMING', raw = ? WHERE order_id = ? AND status = 'created' AND payment_key = ''",
                    [$marker, json_encode(['claimedAt' => $now]), $orderId]);
                return $n === 1 ? 'claimed' : 'busy';
            }
            if (hash_equals((string) $r['payment_key'], $marker) && (string) $r['toss_status'] === 'CONFIRMING') {
                $j = Json::tryDecode((string) $r['raw'], true);
                $at = is_array($j) && isset($j['claimedAt']) && is_int($j['claimedAt']) ? $j['claimedAt'] : 0;
                $wait = (int) Config::get('toss.confirm_retry_after', self::RETRY_AFTER_S) * 1000;
                if ($now - $at >= $wait) return 'resume';
            }
            return 'busy';
        });
    }

    /** confirm.php / return.php (card): the order must be ours, `created`, and the amount must match exactly */
    public static function confirm(array $user, string $paymentKey, string $orderId, int $amount): array
    {
        $uid = (int) $user['id'];
        if (!preg_match('/^[A-Za-z0-9_\-]{1,200}$/', $paymentKey)) throw new ApiException(400, 'INVALID_PAYMENT_KEY', '결제 키가 올바르지 않아요.');
        $o = self::order($orderId);
        if (!$o || (int) $o['user_id'] !== $uid) {
            Audit::log('sub_confirm_refused', $uid, ['order' => mb_substr($orderId, 0, 64), 'why' => 'foreign or unknown'], 'warn');
            self::tamper($uid, 'foreign_order', ['order' => mb_substr($orderId, 0, 64)], 'warn');
            throw new ApiException(404, 'ORDER_NOT_FOUND', '주문을 찾을 수 없어요.');
        }
        if ($amount !== (int) $o['amount']) {
            Audit::log('sub_confirm_refused', $uid, ['order' => $orderId, 'why' => 'amount', 'sent' => $amount, 'stored' => (int) $o['amount']], 'alert');
            self::tamper($uid, 'amount', ['order' => $orderId, 'sent' => $amount, 'stored' => (int) $o['amount']]);
            throw new ApiException(400, 'AMOUNT_MISMATCH', '결제 금액이 주문과 달라요.');
        }
        if ($o['status'] !== 'created') {
            Audit::log('sub_confirm_refused', $uid, ['order' => $orderId, 'why' => 'status ' . $o['status']], 'warn');
            self::tamper($uid, 'replay', ['order' => $orderId, 'status' => (string) $o['status']], 'info');
            throw new ApiException(409, 'ORDER_NOT_OPEN', '이미 처리된 주문이에요.');
        }
        $now = Clock::ms();
        $claim = self::claimOrder($orderId, $paymentKey, $now);
        if ($claim === 'closed' || $claim === 'busy') {
            Audit::log('sub_confirm_refused', $uid, ['order' => $orderId, 'why' => $claim], 'warn');
            throw new ApiException(409, 'ORDER_NOT_OPEN', $claim === 'busy' ? '이 주문은 지금 확인하고 있어요. 잠시 뒤 구독 화면에서 상태를 확인해 주세요.' : '이미 처리된 주문이에요.');
        }
        try {
            $payment = $claim === 'resume' ? Toss::lookup($paymentKey, $orderId, (int) $o['amount']) : Toss::confirm($paymentKey, $orderId, (int) $o['amount']);
        } catch (TossException $e) {
            if (in_array($e->tossCode, ['NETWORK_ERROR', 'BAD_RESPONSE'], true)) {
                // no answer: the payment may have gone through — the order stays claimed and is looked up on the next try
                Audit::log('sub_confirm_pending', $uid, ['order' => $orderId, 'code' => $e->tossCode], 'warn');
                throw new ApiException(503, 'PAYMENT_PENDING', '결제 서버의 답이 늦어지고 있어요. 결제가 되었다면 잠시 뒤 다시 확인할 때 반영돼요.', null, ['Retry-After: ' . self::RETRY_AFTER_S]);
            }
            self::finishOrder($orderId, 'failed', ['paymentKey' => $paymentKey, 'status' => $e->tossCode], $now, $paymentKey);
            Audit::log('sub_payment_failed', $uid, ['order' => $orderId, 'code' => $e->tossCode], 'warn');
            throw new ApiException(402, 'PAYMENT_FAILED', '결제가 완료되지 않았어요: ' . $e->getMessage(), ['tossCode' => $e->tossCode]);
        }
        $why = self::paymentMismatch($payment, $orderId, (int) $o['amount'], $paymentKey);
        if ($why !== '') {
            self::finishOrder($orderId, 'failed', $payment, $now, $paymentKey);
            self::tamper($uid, 'gateway_' . $why, ['order' => $orderId, 'stored' => (int) $o['amount'], 'answered' => isset($payment['totalAmount']) && is_int($payment['totalAmount']) ? $payment['totalAmount'] : null]);
            self::refundQuietly($payment, $why);
            throw new ApiException(402, 'PAYMENT_FAILED', '결제 정보가 주문과 달라서 처리하지 않았어요. 결제가 되었다면 자동으로 취소를 요청했어요.');
        }
        return Db::tx(function () use ($uid, $o, $orderId, $payment, $now, $paymentKey) {
            if (!self::finishOrder($orderId, 'confirmed', $payment, $now, $paymentKey)) throw new ApiException(409, 'ORDER_NOT_OPEN', '이미 처리된 주문이에요.');
            $row = self::activate($uid, (int) $o['tier'], Toss::periodDays() * self::DAY_MS, $now, ['last_order_id' => $orderId]);
            Audit::log('sub_activated', $uid, ['order' => $orderId, 'tier' => (int) $o['tier'], 'kind' => 'card', 'expiresAt' => (int) $row['expires_at']], 'info');
            return self::publicState($row, $now);
        });
    }

    /** billing-issue.php / return.php (billing): issue a billing key, charge the first period, turn auto-renew on */
    public static function billingIssue(array $user, string $authKey, string $customerKey, string $orderId): array
    {
        $uid = (int) $user['id'];
        $o = self::order($orderId);
        if (!$o || (int) $o['user_id'] !== $uid) {
            self::tamper($uid, 'foreign_order', ['order' => mb_substr($orderId, 0, 64), 'kind' => 'billing'], 'warn');
            throw new ApiException(404, 'ORDER_NOT_FOUND', '주문을 찾을 수 없어요.');
        }
        if ($o['status'] !== 'created') throw new ApiException(409, 'ORDER_NOT_OPEN', '이미 처리된 주문이에요.');
        if (!hash_equals(self::customerKey($uid), $customerKey)) {
            Audit::log('sub_confirm_refused', $uid, ['order' => $orderId, 'why' => 'customerKey'], 'alert');
            self::tamper($uid, 'customer_key', ['order' => $orderId], 'warn');
            throw new ApiException(400, 'INVALID_CUSTOMER', '고객 키가 올바르지 않아요.');
        }
        if (!preg_match('/^[A-Za-z0-9_\-]{1,300}$/', $authKey)) throw new ApiException(400, 'INVALID_AUTH_KEY', '인증 키가 올바르지 않아요.');
        if (!Crypto::available()) throw new ApiException(503, 'PAYMENT_NOT_CONFIGURED', '이 서버는 결제 수단을 안전하게 보관할 수 없어 자동 갱신 구독을 열 수 없어요 (openssl 확장 필요).');
        $now = Clock::ms();
        $marker = 'billing:' . substr(hash('sha256', $authKey), 0, 40);
        $claim = self::claimOrder($orderId, $marker, $now);
        if ($claim !== 'claimed') throw new ApiException(409, 'ORDER_NOT_OPEN', $claim === 'busy' || $claim === 'resume' ? '이 주문은 지금 확인하고 있어요. 잠시 뒤 구독 화면에서 상태를 확인해 주세요.' : '이미 처리된 주문이에요.');
        $payment = [];
        try {
            $issued = Toss::issueBillingKey($authKey, $customerKey);
            $billingKey = (string) (isset($issued['billingKey']) && is_string($issued['billingKey']) ? $issued['billingKey'] : '');
            if ($billingKey === '') throw new TossException('NO_BILLING_KEY', '빌링키를 받지 못했어요.', 0);
            $sealed = self::sealBillingKey($billingKey); // before any money moves: a key that cannot be kept is never charged
            $payment = Toss::charge($billingKey, $customerKey, (int) $o['amount'], $orderId, self::orderName((int) $o['tier']), (string) $user['email'], (string) $user['nickname']);
        } catch (TossException $e) {
            self::finishOrder($orderId, 'failed', ['status' => $e->tossCode], $now, $marker);
            Audit::log('sub_payment_failed', $uid, ['order' => $orderId, 'code' => $e->tossCode, 'kind' => 'billing'], 'warn');
            throw new ApiException(402, 'PAYMENT_FAILED', '결제가 완료되지 않았어요: ' . $e->getMessage(), ['tossCode' => $e->tossCode]);
        } catch (ApiException $e) {
            self::finishOrder($orderId, 'failed', ['status' => $e->errorCode], $now, $marker);
            throw $e;
        }
        $why = self::paymentMismatch($payment, $orderId, (int) $o['amount']);
        if ($why !== '') {
            self::finishOrder($orderId, 'failed', $payment, $now, $marker);
            self::tamper($uid, 'gateway_' . $why, ['order' => $orderId, 'kind' => 'billing', 'stored' => (int) $o['amount'], 'answered' => isset($payment['totalAmount']) && is_int($payment['totalAmount']) ? $payment['totalAmount'] : null]);
            self::refundQuietly($payment, $why);
            throw new ApiException(402, 'PAYMENT_FAILED', '결제 정보가 주문과 달라서 처리하지 않았어요. 결제가 되었다면 자동으로 취소를 요청했어요.');
        }
        $card = isset($issued['card']) && is_array($issued['card']) ? $issued['card'] : [];
        return Db::tx(function () use ($uid, $o, $orderId, $payment, $sealed, $customerKey, $card, $now, $marker) {
            if (!self::finishOrder($orderId, 'confirmed', $payment, $now, $marker)) throw new ApiException(409, 'ORDER_NOT_OPEN', '이미 처리된 주문이에요.');
            $row = self::activate($uid, (int) $o['tier'], Toss::periodDays() * self::DAY_MS, $now, [
                'auto_renew' => 1, 'billing_key' => $sealed, 'customer_key' => $customerKey, 'last_order_id' => $orderId,
            ]);
            Audit::log('sub_activated', $uid, ['order' => $orderId, 'tier' => (int) $o['tier'], 'kind' => 'billing', 'card' => isset($card['company']) && is_string($card['company']) ? mb_substr($card['company'], 0, 40) : '', 'expiresAt' => (int) $row['expires_at']], 'info');
            return self::publicState($row, $now);
        });
    }

    /** cancel.php: stop auto-renew, keep access until expires_at */
    public static function cancelAutoRenew(array $user): array
    {
        $uid = (int) $user['id'];
        $now = Clock::ms();
        $row = self::row($uid);
        if (!$row) return self::none();
        Db::exec('UPDATE subscriptions SET auto_renew = 0, updated_at = ? WHERE user_id = ?', [$now, $uid]);
        Audit::log('sub_autorenew_off', $uid, ['tier' => (int) $row['tier'], 'expiresAt' => (int) $row['expires_at']]);
        return self::state($uid, $now);
    }

    // ------------------------------------------------------------------ renewal
    /**
     * Renew the subscriptions whose period ends within a day (or one user, optionally forced). Returns a summary per user.
     * Called by api/sub/renew.php (admin), cli/tfm.php sub:renew and lazily from settle().
     */
    public static function renewDue(?int $onlyUid = null, bool $force = false): array
    {
        $now = Clock::ms();
        $sql = "SELECT * FROM subscriptions WHERE status IN ('active', 'past_due') AND auto_renew = 1 AND billing_key <> ''";
        $params = [];
        if ($onlyUid !== null) { $sql .= ' AND user_id = ?'; $params[] = $onlyUid; }
        if (!$force) { $sql .= ' AND expires_at - ? < ?'; $params[] = self::DAY_MS; $params[] = $now; }
        $sql .= ' ORDER BY expires_at ASC LIMIT 500';
        $out = [];
        foreach (Db::all($sql, $params) as $row) {
            try { $out[] = self::renewOne($row, $now, $force); }
            catch (\Throwable $e) { $out[] = ['userId' => (int) $row['user_id'], 'ok' => false, 'error' => $e->getMessage()]; Log::error('SUB', 'renewal error: ' . $e->getMessage(), ['uid' => (int) $row['user_id']]); }
        }
        return $out;
    }

    /**
     * One renewal: order (kind renewal) → charge → extend, or past_due / none. Finding F5: the decision to charge is taken
     * inside one transaction that locks the subscription row — the expiry is read again there and an open renewal order
     * of the last 2 minutes means another process is on it — so parallel requests or a cron run never charge twice.
     */
    private static function renewOne(array $row, int $now, bool $force): array
    {
        $uid = (int) $row['user_id'];
        $start = Db::tx(function () use ($uid, $now, $force) {
            $cur = Db::one('SELECT * FROM subscriptions WHERE user_id = ?' . Db::forUpdate(), [$uid]);
            if (!$cur) return ['skip' => ['userId' => $uid, 'ok' => false, 'skipped' => 'no subscription']];
            $exp = (int) $cur['expires_at'];
            if (!$force && $exp - self::DAY_MS >= $now) return ['skip' => ['userId' => $uid, 'ok' => true, 'skipped' => 'not due', 'expiresAt' => $exp]];
            if ((int) $cur['auto_renew'] !== 1 || (string) $cur['billing_key'] === '' || !in_array((string) $cur['status'], ['active', 'past_due'], true)) {
                return ['skip' => ['userId' => $uid, 'ok' => false, 'skipped' => 'no billing key']];
            }
            $open = Db::one("SELECT id FROM orders WHERE user_id = ? AND kind = 'renewal' AND status = 'created' AND requested_at > ?", [$uid, $now - 120000]);
            if ($open) return ['skip' => ['userId' => $uid, 'ok' => false, 'skipped' => 'in progress']];
            $tier = max(2, min(4, (int) $cur['tier']));
            $orderId = self::orderId();
            $key = self::billingKeyOf($cur);
            // mock mode: a billing key issued with an authKey ending in _fail always fails (tests)
            if (Toss::mock() && Str::endsWith($key, '_fail')) $orderId .= '_fail';
            $o = self::createOrder($uid, $tier, Toss::price($tier), 'renewal', $now, $orderId);
            return ['row' => $cur, 'order' => $o, 'key' => $key];
        });
        if (isset($start['skip'])) return $start['skip'];
        $cur = $start['row'];
        $o = $start['order'];
        $orderId = (string) $o['order_id'];
        $tier = (int) $o['tier'];
        $amount = (int) $o['amount'];
        $exp = (int) $cur['expires_at'];
        $user = Users::byId($uid);
        try {
            if ($start['key'] === '') throw new TossException('NO_BILLING_KEY', '저장된 결제 수단을 열 수 없어요.', 0);
            $payment = Toss::charge($start['key'], (string) $cur['customer_key'], $amount, $orderId, self::orderName($tier), $user ? (string) $user['email'] : null, $user ? (string) $user['nickname'] : null);
            $why = self::paymentMismatch($payment, $orderId, $amount);
            if ($why !== '') {
                self::tamper($uid, 'gateway_' . $why, ['order' => $orderId, 'kind' => 'renewal', 'stored' => $amount, 'answered' => isset($payment['totalAmount']) && is_int($payment['totalAmount']) ? $payment['totalAmount'] : null]);
                self::refundQuietly($payment, $why);
                throw new TossException('MISMATCH', '결제 정보가 주문과 달라요.', 0);
            }
        } catch (TossException $e) {
            self::finishOrder($orderId, 'failed', ['status' => $e->tossCode], $now);
            $graceEnd = $exp + Toss::graceDays() * self::DAY_MS;
            if ($graceEnd <= $now) {
                Db::exec("UPDATE subscriptions SET status = 'none', tier = 1, auto_renew = 0, checked_at = ?, updated_at = ? WHERE user_id = ?", [$now, $now, $uid]);
                Audit::log('sub_renew_failed', $uid, ['order' => $orderId, 'code' => $e->tossCode, 'result' => 'none'], 'warn');
                return ['userId' => $uid, 'ok' => false, 'status' => 'none', 'code' => $e->tossCode];
            }
            Db::exec("UPDATE subscriptions SET status = 'past_due', checked_at = ?, updated_at = ? WHERE user_id = ?", [$now, $now, $uid]);
            Audit::log('sub_renew_failed', $uid, ['order' => $orderId, 'code' => $e->tossCode, 'result' => 'past_due'], 'warn');
            return ['userId' => $uid, 'ok' => false, 'status' => 'past_due', 'code' => $e->tossCode];
        }
        return Db::tx(function () use ($uid, $tier, $orderId, $payment, $now, $amount) {
            if (!self::finishOrder($orderId, 'confirmed', $payment, $now)) throw new \RuntimeException('renewal order changed while it was charged');
            $row = self::activate($uid, $tier, Toss::periodDays() * self::DAY_MS, $now, ['last_order_id' => $orderId, 'auto_renew' => 1]);
            Audit::log('sub_renewed', $uid, ['order' => $orderId, 'tier' => $tier, 'amount' => $amount, 'expiresAt' => (int) $row['expires_at']]);
            return ['userId' => $uid, 'ok' => true, 'status' => 'active', 'expiresAt' => (int) $row['expires_at'], 'order' => $orderId];
        });
    }

    // ------------------------------------------------------------------ admin
    /** 수동 부여 (schools, events): tier for N days, audit-logged, an order of kind manual with amount 0 */
    public static function grant(array $actor, int $uid, int $tier, int $days): array
    {
        $tier = self::validTier($tier);
        $days = max(1, min(3650, $days));
        $u = Users::byId($uid);
        if (!$u) throw new ApiException(404, 'NOT_FOUND', '사용자를 찾을 수 없어요.');
        $now = Clock::ms();
        return Db::tx(function () use ($actor, $uid, $tier, $days, $now, $u) {
            $o = self::createOrder($uid, $tier, 0, 'manual', $now);
            self::finishOrder($o['order_id'], 'confirmed', ['status' => 'MANUAL', 'method' => '수동 부여'], $now);
            $row = self::activate($uid, $tier, $days * self::DAY_MS, $now, ['last_order_id' => $o['order_id']]);
            Audit::log('sub_granted', $uid, ['tier' => $tier, 'days' => $days, 'order' => $o['order_id'], 'expiresAt' => (int) $row['expires_at']], 'warn', (int) $actor['id'] ?: null);
            return ['message' => "{$u['nickname']} 님에게 {$tier}배 속도를 {$days}일 동안 부여했어요.", 'sub' => self::publicState($row, $now)];
        });
    }

    /** 해지 (admin): back to tier 1 now, auto-renew off, audit-logged */
    public static function revoke(array $actor, int $uid): array
    {
        $u = Users::byId($uid);
        if (!$u) throw new ApiException(404, 'NOT_FOUND', '사용자를 찾을 수 없어요.');
        $now = Clock::ms();
        $row = self::row($uid);
        if ($row) {
            Db::exec("UPDATE subscriptions SET status = 'canceled', tier = 1, auto_renew = 0, expires_at = ?, updated_at = ? WHERE user_id = ?", [$now, $now, $uid]);
        }
        Audit::log('sub_revoked', $uid, ['from' => $row ? (int) $row['tier'] : 1], 'warn', (int) $actor['id'] ?: null);
        return ['message' => "{$u['nickname']} 님의 구독을 해지했어요 (기본 속도로 돌아가요).", 'sub' => self::state($uid, $now)];
    }

    // ------------------------------------------------------------------ webhook
    /**
     * 토스 webhook (PAYMENT_STATUS_CHANGED / CANCEL …): the body is never trusted — the payment is re-fetched by its key
     * (skipped in mock mode, where the key must still match the stored order). Idempotent per (order_id, event, status).
     * A canceled / refunded order that paid the current period downgrades the subscription; nothing here can raise a tier.
     */
    public static function webhook(array $payload): array
    {
        $event = isset($payload['eventType']) && is_string($payload['eventType']) ? mb_substr($payload['eventType'], 0, 60) : 'UNKNOWN';
        $data = isset($payload['data']) && is_array($payload['data']) ? $payload['data'] : $payload;
        $orderId = isset($data['orderId']) && is_string($data['orderId']) ? $data['orderId'] : '';
        $paymentKey = isset($data['paymentKey']) && is_string($data['paymentKey']) ? $data['paymentKey'] : '';
        $bodyStatus = isset($data['status']) && is_string($data['status']) ? mb_substr($data['status'], 0, 40) : '';
        $o = $orderId !== '' ? self::order($orderId) : null;
        if (!$o || $paymentKey === '') {
            Log::warn('SUB', 'webhook ignored (unknown order)', ['event' => $event]);
            return ['ignored' => true, 'why' => 'unknown order'];
        }
        $now = Clock::ms();
        if (Toss::mock()) {
            if (!hash_equals((string) $o['payment_key'], $paymentKey)) return ['ignored' => true, 'why' => 'payment key mismatch'];
            $status = $bodyStatus;
        } else {
            try { $p = Toss::payment($paymentKey); }
            catch (TossException $e) { Log::warn('SUB', 'webhook unverifiable', ['order' => $orderId, 'code' => $e->tossCode]); return ['ignored' => true, 'why' => 'unverifiable']; }
            if ((string) (isset($p['orderId']) ? $p['orderId'] : '') !== $orderId) return ['ignored' => true, 'why' => 'order mismatch'];
            $status = (string) (isset($p['status']) ? $p['status'] : '');
        }
        if ($status === '') return ['ignored' => true, 'why' => 'no status'];
        $dup = Db::one('SELECT id FROM payment_events WHERE order_id = ? AND event = ? AND status = ?', [$orderId, $event, $status]);
        if ($dup) return ['ignored' => true, 'why' => 'duplicate'];
        $raw = json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PARTIAL_OUTPUT_ON_ERROR);
        Db::insert('payment_events', ['order_id' => $orderId, 'event' => $event, 'status' => $status, 'payload' => is_string($raw) ? mb_substr($raw, 0, 60000) : '', 'created_at' => $now]);
        $downgraded = false;
        if (in_array($status, ['CANCELED', 'PARTIAL_CANCELED', 'EXPIRED', 'ABORTED'], true)) {
            $newStatus = $status === 'CANCELED' || $status === 'PARTIAL_CANCELED' ? 'refunded' : 'canceled';
            Db::exec('UPDATE orders SET status = ?, toss_status = ? WHERE order_id = ? AND status <> ?', [$newStatus, $status, $orderId, $newStatus]);
            $row = self::row((int) $o['user_id']);
            if ($row && (string) $row['last_order_id'] === $orderId && in_array((string) $row['status'], ['active', 'past_due'], true)) {
                Db::exec("UPDATE subscriptions SET status = 'canceled', tier = 1, auto_renew = 0, expires_at = ?, updated_at = ? WHERE user_id = ?", [$now, $now, (int) $o['user_id']]);
                $downgraded = true;
            }
            Audit::log('sub_order_canceled', (int) $o['user_id'], ['order' => $orderId, 'status' => $status, 'event' => $event, 'downgraded' => $downgraded], 'warn');
        } else {
            Db::exec('UPDATE orders SET toss_status = ? WHERE order_id = ?', [$status, $orderId]);
        }
        return ['ignored' => false, 'status' => $status, 'downgraded' => $downgraded];
    }

    // ------------------------------------------------------------------ admin lists
    public static function listAll(int $limit = 200): array
    {
        return Db::all('SELECT s.*, u.nickname, u.email FROM subscriptions s JOIN users u ON u.id = s.user_id ORDER BY s.updated_at DESC LIMIT ?', [max(1, min(1000, $limit))]);
    }

    public static function listOrders(int $limit = 100): array
    {
        return Db::all('SELECT o.*, u.nickname FROM orders o LEFT JOIN users u ON u.id = o.user_id ORDER BY o.id DESC LIMIT ?', [max(1, min(1000, $limit))]);
    }
}
