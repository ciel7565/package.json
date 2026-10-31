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

if (!defined('TFM_BOOT')) { http_response_code(404); exit; }

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
        if ($auto && (int) $row['checked_at'] + self::LAZY_INTERVAL_MS < $now) {
            Db::exec('UPDATE subscriptions SET checked_at = ? WHERE user_id = ?', [$now, $uid]);
            try { self::renewOne($row, $now, false); } catch (\Throwable $e) { Log::error('SUB', 'lazy renewal failed: ' . $e->getMessage(), ['uid' => $uid]); }
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

    /** store what 토스 answered for an order (never the secret key; the raw object is kept for the admin) */
    private static function finishOrder(string $orderId, string $status, array $payment, int $now): void
    {
        $receipt = isset($payment['receipt']) && is_array($payment['receipt']) && isset($payment['receipt']['url']) && is_string($payment['receipt']['url']) ? $payment['receipt']['url'] : '';
        $raw = json_encode($payment, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PARTIAL_OUTPUT_ON_ERROR);
        Db::exec('UPDATE orders SET status = ?, payment_key = ?, method = ?, receipt_url = ?, toss_status = ?, raw = ?, approved_at = ? WHERE order_id = ?', [
            $status,
            mb_substr((string) (isset($payment['paymentKey']) && is_string($payment['paymentKey']) ? $payment['paymentKey'] : ''), 0, 200),
            mb_substr((string) (isset($payment['method']) && is_string($payment['method']) ? $payment['method'] : ''), 0, 40),
            mb_substr($receipt, 0, 500),
            mb_substr((string) (isset($payment['status']) && is_string($payment['status']) ? $payment['status'] : ''), 0, 40),
            is_string($raw) ? mb_substr($raw, 0, 60000) : '',
            $status === 'confirmed' ? $now : 0,
            $orderId,
        ]);
    }

    // ------------------------------------------------------------------ activation
    /** extend / activate: expires_at = max(now, expires_at) + period; status active; tier set */
    private static function activate(int $uid, int $tier, int $periodMs, int $now, array $extra = []): array
    {
        $row = self::row($uid);
        $base = $row ? max($now, (int) $row['expires_at']) : $now;
        // a different tier starts a fresh period from now (no mixing of two prices in one period)
        if ($row && (int) $row['tier'] !== $tier) $base = $now;
        $fields = [
            'user_id' => $uid, 'tier' => $tier, 'status' => 'active', 'started_at' => $row && (int) $row['started_at'] > 0 && (int) $row['tier'] === $tier && (int) $row['expires_at'] > $now ? (int) $row['started_at'] : $now,
            'expires_at' => $base + $periodMs, 'auto_renew' => $row ? (int) $row['auto_renew'] : 0,
            'billing_key' => $row ? (string) $row['billing_key'] : '', 'customer_key' => self::customerKey($uid),
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

    /** confirm.php / return.php (card): the order must be ours, `created`, and the amount must match exactly */
    public static function confirm(array $user, string $paymentKey, string $orderId, int $amount): array
    {
        $uid = (int) $user['id'];
        $o = self::order($orderId);
        if (!$o || (int) $o['user_id'] !== $uid) {
            Audit::log('sub_confirm_refused', $uid, ['order' => mb_substr($orderId, 0, 64), 'why' => 'foreign or unknown'], 'warn');
            throw new ApiException(404, 'ORDER_NOT_FOUND', '주문을 찾을 수 없어요.');
        }
        if ($o['status'] !== 'created') {
            Audit::log('sub_confirm_refused', $uid, ['order' => $orderId, 'why' => 'status ' . $o['status']], 'warn');
            throw new ApiException(409, 'ORDER_NOT_OPEN', '이미 처리된 주문이에요.');
        }
        if ($amount !== (int) $o['amount']) {
            Audit::log('sub_confirm_refused', $uid, ['order' => $orderId, 'why' => 'amount', 'sent' => $amount, 'stored' => (int) $o['amount']], 'alert');
            throw new ApiException(400, 'AMOUNT_MISMATCH', '결제 금액이 주문과 달라요.');
        }
        if (!preg_match('/^[A-Za-z0-9_\-]{1,200}$/', $paymentKey)) throw new ApiException(400, 'INVALID_PAYMENT_KEY', '결제 키가 올바르지 않아요.');
        $now = Clock::ms();
        try {
            $payment = Toss::confirm($paymentKey, $orderId, $amount);
        } catch (TossException $e) {
            self::finishOrder($orderId, 'failed', ['paymentKey' => $paymentKey, 'status' => $e->tossCode], $now);
            Audit::log('sub_payment_failed', $uid, ['order' => $orderId, 'code' => $e->tossCode], 'warn');
            throw new ApiException(402, 'PAYMENT_FAILED', '결제가 완료되지 않았어요: ' . $e->getMessage(), ['tossCode' => $e->tossCode]);
        }
        if ((string) (isset($payment['status']) ? $payment['status'] : '') !== 'DONE' || (int) (isset($payment['totalAmount']) ? $payment['totalAmount'] : $amount) !== $amount) {
            self::finishOrder($orderId, 'failed', $payment, $now);
            Audit::log('sub_payment_failed', $uid, ['order' => $orderId, 'code' => 'STATUS'], 'warn');
            throw new ApiException(402, 'PAYMENT_FAILED', '결제가 완료되지 않았어요.');
        }
        return Db::tx(function () use ($uid, $o, $orderId, $payment, $now) {
            $again = Db::one('SELECT status FROM orders WHERE order_id = ?' . Db::forUpdate(), [$orderId]);
            if (!$again || $again['status'] !== 'created') throw new ApiException(409, 'ORDER_NOT_OPEN', '이미 처리된 주문이에요.');
            self::finishOrder($orderId, 'confirmed', $payment, $now);
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
        if (!$o || (int) $o['user_id'] !== $uid) throw new ApiException(404, 'ORDER_NOT_FOUND', '주문을 찾을 수 없어요.');
        if ($o['status'] !== 'created') throw new ApiException(409, 'ORDER_NOT_OPEN', '이미 처리된 주문이에요.');
        if (!hash_equals(self::customerKey($uid), $customerKey)) {
            Audit::log('sub_confirm_refused', $uid, ['order' => $orderId, 'why' => 'customerKey'], 'alert');
            throw new ApiException(400, 'INVALID_CUSTOMER', '고객 키가 올바르지 않아요.');
        }
        if (!preg_match('/^[A-Za-z0-9_\-]{1,300}$/', $authKey)) throw new ApiException(400, 'INVALID_AUTH_KEY', '인증 키가 올바르지 않아요.');
        $now = Clock::ms();
        try {
            $issued = Toss::issueBillingKey($authKey, $customerKey);
            $billingKey = (string) (isset($issued['billingKey']) ? $issued['billingKey'] : '');
            if ($billingKey === '') throw new TossException('NO_BILLING_KEY', '빌링키를 받지 못했어요.', 0);
            $payment = Toss::charge($billingKey, $customerKey, (int) $o['amount'], $orderId, self::orderName((int) $o['tier']), (string) $user['email'], (string) $user['nickname']);
        } catch (TossException $e) {
            self::finishOrder($orderId, 'failed', ['status' => $e->tossCode], $now);
            Audit::log('sub_payment_failed', $uid, ['order' => $orderId, 'code' => $e->tossCode, 'kind' => 'billing'], 'warn');
            throw new ApiException(402, 'PAYMENT_FAILED', '결제가 완료되지 않았어요: ' . $e->getMessage(), ['tossCode' => $e->tossCode]);
        }
        if ((string) (isset($payment['status']) ? $payment['status'] : '') !== 'DONE') {
            self::finishOrder($orderId, 'failed', $payment, $now);
            throw new ApiException(402, 'PAYMENT_FAILED', '결제가 완료되지 않았어요.');
        }
        $card = isset($issued['card']) && is_array($issued['card']) ? $issued['card'] : [];
        return Db::tx(function () use ($uid, $o, $orderId, $payment, $billingKey, $customerKey, $card, $now) {
            $again = Db::one('SELECT status FROM orders WHERE order_id = ?' . Db::forUpdate(), [$orderId]);
            if (!$again || $again['status'] !== 'created') throw new ApiException(409, 'ORDER_NOT_OPEN', '이미 처리된 주문이에요.');
            self::finishOrder($orderId, 'confirmed', $payment, $now);
            $row = self::activate($uid, (int) $o['tier'], Toss::periodDays() * self::DAY_MS, $now, [
                'auto_renew' => 1, 'billing_key' => mb_substr($billingKey, 0, 255), 'customer_key' => $customerKey, 'last_order_id' => $orderId,
            ]);
            Audit::log('sub_activated', $uid, ['order' => $orderId, 'tier' => (int) $o['tier'], 'kind' => 'billing', 'card' => isset($card['company']) ? $card['company'] : '', 'expiresAt' => (int) $row['expires_at']], 'info');
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

    /** one renewal: order (kind renewal) → charge → extend, or past_due / none */
    private static function renewOne(array $row, int $now, bool $force): array
    {
        $uid = (int) $row['user_id'];
        $tier = max(2, min(4, (int) $row['tier']));
        $exp = (int) $row['expires_at'];
        if (!$force && $exp - self::DAY_MS >= $now) return ['userId' => $uid, 'ok' => true, 'skipped' => 'not due', 'expiresAt' => $exp];
        if ((int) $row['auto_renew'] !== 1 || (string) $row['billing_key'] === '') return ['userId' => $uid, 'ok' => false, 'skipped' => 'no billing key'];
        // one renewal at a time per user: a renewal order still open for the last 2 minutes means another process is on it
        $open = Db::one("SELECT id FROM orders WHERE user_id = ? AND kind = 'renewal' AND status = 'created' AND requested_at > ?", [$uid, $now - 120000]);
        if ($open) return ['userId' => $uid, 'ok' => false, 'skipped' => 'in progress'];
        $amount = Toss::price($tier);
        $orderId = self::orderId();
        // mock mode: a billing key issued with an authKey ending in _fail always fails (tests)
        if (Toss::mock() && Str::endsWith((string) $row['billing_key'], '_fail')) $orderId .= '_fail';
        $o = self::createOrder($uid, $tier, $amount, 'renewal', $now, $orderId);
        $user = Users::byId($uid);
        try {
            $payment = Toss::charge((string) $row['billing_key'], (string) $row['customer_key'], $amount, $orderId, self::orderName($tier), $user ? (string) $user['email'] : null, $user ? (string) $user['nickname'] : null);
            if ((string) (isset($payment['status']) ? $payment['status'] : '') !== 'DONE') throw new TossException('STATUS', '결제 상태가 완료가 아니에요.', 0);
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
        return Db::tx(function () use ($uid, $tier, $orderId, $payment, $now, $o) {
            self::finishOrder($orderId, 'confirmed', $payment, $now);
            $row = self::activate($uid, $tier, Toss::periodDays() * self::DAY_MS, $now, ['last_order_id' => $orderId, 'auto_renew' => 1]);
            Audit::log('sub_renewed', $uid, ['order' => $orderId, 'tier' => $tier, 'amount' => (int) $o['amount'], 'expiresAt' => (int) $row['expires_at']]);
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
        return Db::all('SELECT s.*, u.nickname, u.email FROM subscriptions s JOIN users u ON u.id = s.user_id ORDER BY s.updated_at DESC LIMIT ' . max(1, min(1000, $limit)));
    }

    public static function listOrders(int $limit = 100): array
    {
        return Db::all('SELECT o.*, u.nickname FROM orders o LEFT JOIN users u ON u.id = o.user_id ORDER BY o.id DESC LIMIT ' . max(1, min(1000, $limit)));
    }
}
