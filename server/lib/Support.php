<?php
/**
 * Tfm\Support — reports and questions of the players with a picture of the screen (CONTRACT §18.1).
 *
 * Kinds: bug (🐞 버그 신고) · question (❓ 문의하기) · report (🚨 신고하기), each with fixed category words (CATEGORIES —
 * src/game/78-support.js keeps the same list; tests/support-unit.php compares them). A ticket = one row of
 * support_tickets (the first words in body) + its thread in support_messages (the player's follow-ups and the operator's
 * answers). The picture is stored by Tfm\Upload::supportShot in the private folder data/support/ and streamed only by
 * stream() — to the owner and to an administrator.
 *
 *   Player (api/support/*):  create(user, in, hasShot) · mine(uid, before, limit) · unread(uid) · reply(user, id, body) ·
 *                            seen(uid, id) · deleteOwn(user, id) · shotFor(viewer, id) + stream(row)
 *   Operator (lib/AdminSupport.php): page(filter, before, limit) · counts() · get(id) · answer(admin, id, body, status) ·
 *                            setStatus(admin, id, status) · remove(admin, ids) · cleanup(admin|null, max) · csvRows(filter)
 *
 * Rules: every text a person typed is cleaned (Users::cleanText), the bad words are masked (ChatFilter::mask) and so is
 * personal information (ChatFilter::maskPII) BEFORE it is stored — nothing typed reaches the admin site raw; an
 * answer of the operator is plain text too (the app shows it with textContent). Device facts (meta) are a fixed list of
 * small typed values: never the save, never a name, an address or a number of the person. Limits per account
 * (support.per_hour / per_day / max_open) are counted from the table itself; a refusal is a security event (counted,
 * never an automatic block). Another account's ticket or picture answers 404 like a missing one (and is counted).
 * Deleting removes the row, every message and the picture file, and forgets the cached counts.
 * PHP 7.2 syntax only; SQL runs on MariaDB 10.3 and SQLite.
 */
declare(strict_types=1);

namespace Tfm;

if (!defined('TFM_BOOT')) { if (function_exists('header_remove')) header_remove('X-Powered-By'); http_response_code(404); exit; }

final class Support
{
    public const KINDS = ['bug', 'question', 'report'];
    public const KIND_KO = ['bug' => ['🐞', '버그 신고'], 'question' => ['❓', '문의하기'], 'report' => ['🚨', '신고하기']];
    /** the category words of each kind (the app shows them as picture tiles; keep 78-support.js CATEGORIES in step) */
    public const CATEGORIES = [
        'bug' => ['stuck', 'invisible', 'sound', 'lost', 'slow', 'save', 'login', 'other'],
        'question' => ['howto', 'account', 'pay', 'allot', 'lecture', 'other'],
        'report' => ['bully', 'badword', 'privacy', 'cheat', 'other'],
    ];
    public const CAT_KO = [
        'stuck' => '멈췄어요', 'invisible' => '안 보여요', 'sound' => '소리가 이상해요', 'lost' => '길을 잃었어요', 'slow' => '느려요',
        'save' => '저장이 안 돼요', 'login' => '로그인이 안 돼요', 'howto' => '어떻게 해요?', 'account' => '계정', 'pay' => '결제·구독',
        'allot' => '분양', 'lecture' => '강의', 'bully' => '누가 괴롭혀요', 'badword' => '나쁜 말을 해요', 'privacy' => '개인정보가 보여요',
        'cheat' => '이상한 행동', 'other' => '그 밖에',
    ];
    public const STATUS = ['new', 'open', 'answered', 'closed'];
    public const STATUS_KO = ['new' => ['🆕', '새 글'], 'open' => ['💬', '확인 중'], 'answered' => ['✅', '답변함'], 'closed' => ['📁', '닫음']];
    /** statuses that count as "still open" for the per-account limit */
    public const OPEN = ['new', 'open', 'answered'];
    public const BODY_MAX = 1000;
    /** messages one player may add to one ticket */
    public const USER_MESSAGES_MAX = 20;
    /** messages kept per ticket (operator + player) */
    public const THREAD_MAX = 60;
    /** the device facts a ticket may carry: key => [type, limit] (str = max characters; int / num = [min, max]) */
    public const META = [
        'build'   => ['str', 40],  'browser' => ['str', 160], 'screen' => ['str', 24], 'view' => ['str', 24], 'dpr' => ['num', [0.25, 8]],
        'quality' => ['str', 12],  'mode' => ['str', 8],      'net' => ['str', 8],     'place' => ['str', 40], 'zone' => ['str', 40],
        'x' => ['num', [-100000, 100000]], 'y' => ['num', [-100000, 100000]], 'z' => ['num', [-100000, 100000]],
        'fps' => ['num', [0, 1000]], 'look' => ['str', 12], 'lang' => ['str', 16], 'touch' => ['int', [0, 1]], 'gl' => ['str', 80],
        'errors' => ['int', [0, 100000]], 'lastError' => ['str', 200], 'uptime' => ['int', [0, 100000000]], 'memMB' => ['int', [0, 100000]],
        'blur' => ['int', [0, 1]],
        // the code names of the windows and panels that were open on top of the 3D view (78-support.js uiFacts: letters,
        // digits, '-', '_' and ',' only — never a title, a name or a chat line)
        'ui' => ['ids', 200],
    ];
    public const NOT_FOUND = '문의를 찾을 수 없어요.';
    private const CACHE_COUNTS = 'support:counts';

    // ------------------------------------------------------------------ settings (⚙️ 설정 → 📮 신고·문의, and the tab's own card)
    public static function opt(string $key, $default)
    {
        try { return Settings::isDefined('support.' . $key) ? Settings::get('support.' . $key, $default) : Config::get('support.' . $key, $default); }
        catch (\Throwable $e) { return $default; }
    }
    private static function intOpt(string $key, int $default, int $min, int $max): int
    {
        $v = self::opt($key, $default);
        return max($min, min($max, is_numeric($v) ? (int) $v : $default));
    }
    public static function enabled(): bool { return self::opt('enabled', true) !== false; }
    public static function shotsOn(): bool { return self::opt('shots', true) !== false; }
    /** ['hour', 'day', 'open', 'keep_days', 'shot_bytes'] in effect */
    public static function limits(): array
    {
        return [
            'hour' => self::intOpt('per_hour', 5, 1, 100), 'day' => self::intOpt('per_day', 20, 1, 500), 'open' => self::intOpt('max_open', 30, 1, 200),
            'keep_days' => self::intOpt('keep_days', 180, 7, 3650), 'shot_bytes' => self::intOpt('shot_kb', 1536, 100, 1536) * 1024,
        ];
    }

    // ------------------------------------------------------------------ cleaning
    /** a text a person typed → stored form: cleaned, bad words masked, personal information masked */
    public static function cleanBody(string $s, int $max = self::BODY_MAX): string
    {
        // keep line breaks (a bug description has steps): clean each line, then join
        $s = str_replace(["\r\n", "\r"], "\n", $s);
        $lines = [];
        foreach (explode("\n", $s) as $line) {
            $l = Users::cleanText($line, $max);
            if ($l !== '' || ($lines && end($lines) !== '')) $lines[] = $l;
            if (count($lines) >= 40) break;
        }
        while ($lines && end($lines) === '') array_pop($lines);
        $out = mb_substr(implode("\n", $lines), 0, $max);
        return ChatFilter::maskPII(ChatFilter::mask($out));
    }

    /** the device facts: only the listed keys with their types; unknown keys are refused (400) */
    public static function cleanMeta($raw): array
    {
        if ($raw === null || $raw === '') return [];
        if (is_string($raw)) {
            if (strlen($raw) > 4096) V::fail('meta', '기기 정보가 너무 길어요.');
            $raw = Json::tryDecode($raw);
        }
        if (!is_array($raw)) V::fail('meta', '기기 정보 형식이 올바르지 않아요.');
        V::keys($raw, array_keys(self::META), 'meta');
        $out = [];
        foreach (self::META as $k => $def) {
            if (!array_key_exists($k, $raw) || $raw[$k] === null) continue;
            $v = $raw[$k];
            if ($def[0] === 'ids') {
                if (!is_string($v) || strlen($v) > (int) $def[1] || !preg_match('/^[a-z0-9_,-]*$/', $v)) V::fail('meta.' . $k, '창 이름 형식이 올바르지 않아요.');
                if ($v !== '') $out[$k] = $v;
            } elseif ($def[0] === 'str') {
                if (!is_string($v) && !is_int($v) && !is_float($v)) V::fail('meta.' . $k, '글자여야 해요.');
                $s = Users::cleanText((string) $v, (int) $def[1]);
                // a free text (an error message, a browser string) never carries personal information to the admin site
                $s = ChatFilter::maskPII($s);
                if ($s !== '') $out[$k] = $s;
            } elseif ($def[0] === 'int') {
                $out[$k] = V::int($v, 'meta.' . $k, (int) $def[1][0], (int) $def[1][1]);
            } else {
                $out[$k] = round(V::num($v, 'meta.' . $k, (float) $def[1][0], (float) $def[1][1]), 2);
            }
        }
        return $out;
    }

    // ------------------------------------------------------------------ the player
    /**
     * A new ticket of $user. $in: kind, category, body?, meta?, targetId?, targetName?, messageId? (already checked to be
     * strings / scalars by the endpoint). $shot: the form carries a picture in field "shot" (stored through Upload).
     * @return array the ticket as the owner sees it (row())
     */
    public static function create(array $user, array $in, bool $shot = false, array $shotOpt = []): array
    {
        $uid = (int) $user['id'];
        if (!self::enabled()) throw new ApiException(403, 'SUPPORT_OFF', '지금은 신고·문의를 받지 않아요. 잠시 후 다시 해 주세요.');
        $kind = V::enum(isset($in['kind']) ? $in['kind'] : null, 'kind', self::KINDS);
        $cat = V::enum(isset($in['category']) ? $in['category'] : 'other', 'category', self::CATEGORIES[$kind]);
        $raw = isset($in['body']) ? V::str($in['body'], 'body', 4000) : '';
        if (mb_strlen(trim($raw)) > self::BODY_MAX) throw new ApiException(400, 'INVALID_INPUT', '글은 ' . self::BODY_MAX . '자까지 쓸 수 있어요.');
        $body = self::cleanBody($raw);
        $meta = self::cleanMeta(isset($in['meta']) ? $in['meta'] : null);
        // whom / what a 🚨 report is about (only a report carries a target)
        $targetUser = null;
        $targetRef = '';
        if ($kind === 'report') {
            $mid = isset($in['messageId']) && $in['messageId'] !== '' ? V::id($in['messageId'], 'messageId') : 0;
            $tid = isset($in['targetId']) && $in['targetId'] !== '' ? V::id($in['targetId'], 'targetId') : 0;
            $tname = isset($in['targetName']) ? Users::cleanText(V::str($in['targetName'], 'targetName', 80), 40) : '';
            $msg = $mid > 0 ? Db::one('SELECT id, user_id FROM chat_messages WHERE id = ?', [$mid]) : null;
            if ($msg) { $targetUser = (int) $msg['user_id']; $targetRef = 'chat:' . (int) $msg['id']; }
            elseif ($tid > 0) { $tu = Users::byId($tid); if ($tu) $targetUser = (int) $tu['id']; }
            elseif ($tname !== '') { $tu = Users::byNickname($tname); if ($tu) $targetUser = (int) $tu['id']; else $targetRef = 'name:' . mb_substr(ChatFilter::maskPII($tname), 0, 40); }
            if ($targetUser === $uid) throw new ApiException(400, 'SELF_REPORT', '자기 자신은 신고할 수 없어요.');
        } elseif (isset($in['messageId']) || isset($in['targetId']) || isset($in['targetName'])) {
            V::fail('targetId', '신고하기에서만 쓸 수 있어요.');
        }
        self::checkLimits($uid);
        $stored = null;
        if ($shot) {
            if (!self::shotsOn()) throw new ApiException(400, 'SHOT_OFF', '지금은 화면 사진을 받지 않아요. 사진을 빼고 보내 주세요.');
            $stored = Upload::supportShot($user, 'shot', ['maxBytes' => self::limits()['shot_bytes']] + $shotOpt);
        }
        $now = Clock::ms();
        try {
            $id = Db::insert('support_tickets', [
                'no' => '', 'user_id' => $uid, 'kind' => $kind, 'category' => $cat, 'body' => $body, 'status' => 'new',
                'meta' => $meta ? Json::encode($meta) : '', 'shot_path' => $stored ? $stored['path'] : '', 'shot_bytes' => $stored ? $stored['bytes'] : 0,
                'shot_w' => $stored ? $stored['w'] : 0, 'shot_h' => $stored ? $stored['h'] : 0, 'target_user' => $targetUser, 'target_ref' => $targetRef,
                'created_at' => $now, 'updated_at' => $now, 'answered_at' => 0, 'user_seen_at' => $now,
            ]);
            $no = date('ymd', intdiv($now, 1000)) . '-' . $id;
            Db::exec('UPDATE support_tickets SET no = ? WHERE id = ?', [$no, $id]);
        } catch (\Throwable $e) {
            if ($stored) Upload::supportDiscard($stored['path']); // no orphan picture
            throw $e;
        }
        self::bump();
        Audit::log('support_create', $uid, ['id' => $id, 'kind' => $kind, 'category' => $cat, 'shot' => $stored ? 1 : 0, 'target' => $targetUser], 'info', $uid);
        // an old ticket goes now and then (the admin tab and the command line run the full clean-up)
        if (random_int(1, 100) === 1) { try { self::cleanup(null, 200); } catch (\Throwable $e) { /* next time */ } }
        return self::row((array) Db::one('SELECT * FROM support_tickets WHERE id = ?', [$id]), []);
    }

    /** per-account limits (an hour, a day, open tickets) — a refusal is counted as a security event */
    private static function checkLimits(int $uid): void
    {
        $lim = self::limits();
        $now = Clock::ms();
        $hour = (int) Db::value('SELECT COUNT(*) FROM support_tickets WHERE user_id = ? AND id > ? AND created_at >= ?', [$uid, 0, $now - 3600000]);
        $day = (int) Db::value('SELECT COUNT(*) FROM support_tickets WHERE user_id = ? AND id > ? AND created_at >= ?', [$uid, 0, $now - 86400000]);
        $open = (int) Db::value("SELECT COUNT(*) FROM support_tickets WHERE user_id = ? AND status IN ('new', 'open', 'answered')", [$uid]);
        $why = null;
        if ($open >= $lim['open']) $why = ['open', '답을 기다리는 문의가 많아요. 받은 답을 읽고 다 된 문의를 지운 뒤에 다시 보내 주세요.'];
        elseif ($hour >= $lim['hour']) $why = ['hour', '한 시간에 ' . $lim['hour'] . '번까지 보낼 수 있어요. 조금 뒤에 다시 보내 주세요.'];
        elseif ($day >= $lim['day']) $why = ['day', '오늘은 ' . $lim['day'] . '번까지 보낼 수 있어요. 내일 다시 보내 주세요.'];
        if ($why !== null) {
            SecEvent::log('support_abuse', 'info', ['why' => 'limit ' . $why[0]], $uid);
            throw new ApiException(429, 'SUPPORT_LIMIT', $why[1], ['limit' => $why[0]]);
        }
    }

    /** the caller's own ticket row, or 404 (another account's id is counted, never told apart from a missing one) */
    private static function own(int $uid, int $id): array
    {
        $t = $id > 0 ? Db::one('SELECT * FROM support_tickets WHERE id = ?', [$id]) : null;
        if (!$t || (int) $t['user_id'] !== $uid) {
            if ($t) SecEvent::log('support_idor', 'warn', ['id' => $id], $uid);
            throw new ApiException(404, 'NOT_FOUND', self::NOT_FOUND);
        }
        return $t;
    }

    /** the messages of tickets: ticket id => [{side, body, at}] (oldest first, ≤ THREAD_MAX each) */
    private static function threads(array $ids): array
    {
        $out = [];
        if (!$ids) return $out;
        $ids = array_values(array_unique(array_map('intval', $ids)));
        $marks = implode(', ', array_fill(0, count($ids), '?'));
        foreach (Db::all('SELECT ticket_id, side, body, created_at FROM support_messages WHERE ticket_id IN (' . $marks . ') ORDER BY ticket_id, id', $ids) as $m) {
            $t = (int) $m['ticket_id'];
            if (!isset($out[$t])) $out[$t] = [];
            if (count($out[$t]) < self::THREAD_MAX) $out[$t][] = ['side' => (string) $m['side'], 'body' => (string) $m['body'], 'at' => (int) $m['created_at']];
        }
        return $out;
    }

    /** a ticket as its owner sees it (no file path, no other account's id) */
    public static function row(array $t, array $msgs): array
    {
        return [
            'id' => (int) $t['id'], 'no' => (string) $t['no'], 'kind' => (string) $t['kind'], 'category' => (string) $t['category'],
            'body' => (string) $t['body'], 'status' => (string) $t['status'], 'shot' => (string) $t['shot_path'] !== '',
            'shotW' => (int) $t['shot_w'], 'shotH' => (int) $t['shot_h'], 'created' => (int) $t['created_at'], 'updated' => (int) $t['updated_at'],
            'answered' => (int) $t['answered_at'], 'unread' => (int) $t['answered_at'] > (int) $t['user_seen_at'], 'thread' => $msgs,
        ];
    }

    /** the caller's tickets, newest first (keyset: $before = the smallest id already shown) */
    public static function mine(int $uid, int $before = 0, int $limit = 20): array
    {
        $limit = max(1, min(50, $limit));
        $rows = Db::all('SELECT * FROM support_tickets WHERE user_id = ? AND id < ? ORDER BY id DESC LIMIT ' . ($limit + 1), [$uid, $before > 0 ? $before : PHP_INT_MAX]);
        $more = count($rows) > $limit;
        if ($more) array_pop($rows);
        $th = self::threads(array_map(function ($r) { return (int) $r['id']; }, $rows));
        $list = [];
        foreach ($rows as $r) $list[] = self::row($r, isset($th[(int) $r['id']]) ? $th[(int) $r['id']] : []);
        return ['tickets' => $list, 'more' => $more, 'unread' => self::unread($uid), 'limits' => self::publicLimits()];
    }

    /** what the app may know of the limits */
    public static function publicLimits(): array
    {
        $l = self::limits();
        return ['hour' => $l['hour'], 'day' => $l['day'], 'open' => $l['open'], 'bodyMax' => self::BODY_MAX, 'shots' => self::shotsOn(), 'shotBytes' => $l['shot_bytes'], 'on' => self::enabled()];
    }

    /** tickets with an answer the player has not read */
    public static function unread(int $uid): int
    {
        return (int) Db::value('SELECT COUNT(*) FROM support_tickets WHERE user_id = ? AND answered_at > user_seen_at', [$uid]);
    }

    /** the player adds words to their own open ticket */
    public static function reply(array $user, int $id, string $text): array
    {
        $uid = (int) $user['id'];
        $t = self::own($uid, $id);
        if ((string) $t['status'] === 'closed') throw new ApiException(409, 'SUPPORT_CLOSED', '닫힌 문의예요. 새로 보내 주세요.');
        if (mb_strlen(trim($text)) > self::BODY_MAX) throw new ApiException(400, 'INVALID_INPUT', '글은 ' . self::BODY_MAX . '자까지 쓸 수 있어요.');
        $body = self::cleanBody($text);
        if ($body === '') throw new ApiException(400, 'INVALID_INPUT', '보낼 글을 적어 주세요.');
        $n = (int) Db::value("SELECT COUNT(*) FROM support_messages WHERE ticket_id = ? AND side = 'user'", [$id]);
        if ($n >= self::USER_MESSAGES_MAX) {
            SecEvent::log('support_abuse', 'info', ['why' => 'thread full', 'id' => $id], $uid);
            throw new ApiException(429, 'SUPPORT_LIMIT', '이 문의에는 더 쓸 수 없어요. 새 문의로 보내 주세요.');
        }
        $now = Clock::ms();
        Db::tx(function () use ($id, $uid, $body, $now) {
            Db::insert('support_messages', ['ticket_id' => $id, 'side' => 'user', 'author_id' => $uid, 'body' => $body, 'created_at' => $now]);
            Db::exec("UPDATE support_tickets SET status = 'open', updated_at = ?, user_seen_at = ? WHERE id = ?", [$now, $now, $id]);
        });
        self::bump();
        Audit::log('support_reply', $uid, ['id' => $id], 'info', $uid);
        $t = (array) Db::one('SELECT * FROM support_tickets WHERE id = ?', [$id]);
        $th = self::threads([$id]);
        return self::row($t, isset($th[$id]) ? $th[$id] : []);
    }

    /** the player has read the answers (one ticket, or every ticket with $id = 0) → the unread count left */
    public static function seen(int $uid, int $id = 0): int
    {
        $now = Clock::ms();
        // a look is stamped with the later of the clock and the answer: answer() may stamp answered_at one millisecond
        // ahead of the clock (it has to be later than the player's last look), and a look inside that millisecond
        // left the badge at 1 until the next look
        if ($id > 0) {
            self::own($uid, $id);
            Db::exec('UPDATE support_tickets SET user_seen_at = CASE WHEN answered_at > ? THEN answered_at ELSE ? END WHERE id = ? AND (user_seen_at < ? OR user_seen_at < answered_at)', [$now, $now, $id, $now]);
        } else {
            Db::exec('UPDATE support_tickets SET user_seen_at = CASE WHEN answered_at > ? THEN answered_at ELSE ? END WHERE user_id = ? AND answered_at > user_seen_at', [$now, $now, $uid]);
        }
        return self::unread($uid);
    }

    /** the player deletes their own ticket: row, messages and picture */
    public static function deleteOwn(array $user, int $id): void
    {
        $uid = (int) $user['id'];
        $t = self::own($uid, $id);
        self::purge($t);
        Audit::log('support_delete_own', $uid, ['id' => $id], 'info', $uid);
    }

    /** remove one ticket completely (row + messages in one transaction, then the file, then the cached counts) */
    private static function purge(array $t): void
    {
        $id = (int) $t['id'];
        Db::tx(function () use ($id) {
            Db::exec('DELETE FROM support_messages WHERE ticket_id = ?', [$id]);
            Db::exec('DELETE FROM support_tickets WHERE id = ?', [$id]);
        });
        if ((string) $t['shot_path'] !== '') Upload::supportDiscard((string) $t['shot_path']);
        self::bump();
    }

    // ------------------------------------------------------------------ the picture
    /** the ticket row whose picture $viewer may see (the owner or an administrator), or 404 */
    public static function shotFor(?array $viewer, int $id): array
    {
        $uid = $viewer ? (int) $viewer['id'] : 0;
        $admin = $viewer && (isset($viewer['role']) ? $viewer['role'] : '') === 'admin';
        $t = $id > 0 ? Db::one('SELECT id, user_id, shot_path, shot_bytes FROM support_tickets WHERE id = ?', [$id]) : null;
        if (!$t || (!$admin && (int) $t['user_id'] !== $uid)) {
            if ($t && $uid > 0) SecEvent::log('support_idor', 'warn', ['id' => $id, 'what' => 'shot'], $uid);
            throw new ApiException(404, 'NOT_FOUND', self::NOT_FOUND);
        }
        if ((string) $t['shot_path'] === '' || Upload::supportAbs((string) $t['shot_path']) === null) throw new ApiException(404, 'NOT_FOUND', '화면 사진이 없어요.');
        return $t;
    }

    /** send the picture of a ticket row (shotFor) and end the request: fixed type, nosniff, private cache, sandbox */
    public static function stream(array $t, bool $noStore = false): void
    {
        $abs = Upload::supportAbs((string) $t['shot_path']);
        if ($abs === null) throw new ApiException(404, 'NOT_FOUND', '화면 사진이 없어요.');
        $size = (int) @filesize($abs);
        if ($size <= 0) throw new ApiException(404, 'NOT_FOUND', '화면 사진이 없어요.');
        $etag = '"s' . (int) $t['id'] . '-' . dechex($size) . '"';
        while (ob_get_level() > 0) @ob_end_clean();
        Http::securityHeaders('api');
        header_remove('Pragma');
        header('Content-Type: image/jpeg');
        header('X-Content-Type-Options: nosniff');
        header('Content-Disposition: inline; filename="support-' . (int) $t['id'] . '.jpg"');
        header($noStore ? 'Cache-Control: no-store, max-age=0' : 'Cache-Control: private, max-age=300');
        header('ETag: ' . $etag);
        header('X-Robots-Tag: noindex, nofollow, noarchive');
        header("Content-Security-Policy: default-src 'none'; frame-ancestors 'none'; sandbox");
        header('X-Frame-Options: DENY');
        header('Cross-Origin-Resource-Policy: same-origin');
        Session::close();
        $inm = isset($_SERVER['HTTP_IF_NONE_MATCH']) && is_string($_SERVER['HTTP_IF_NONE_MATCH']) ? trim($_SERVER['HTTP_IF_NONE_MATCH']) : '';
        if (!$noStore && $inm === $etag) { http_response_code(304); exit; }
        http_response_code(200);
        header('Content-Length: ' . $size);
        if (Http::method() === 'HEAD') exit;
        readfile($abs);
        exit;
    }

    // ------------------------------------------------------------------ the operator
    /** forget the cached counts (every change calls it) */
    public static function bump(): void
    {
        try { if (class_exists('Tfm\Cache')) Cache::del(self::CACHE_COUNTS); } catch (\Throwable $e) { /* expires in 30 s */ }
    }

    /** ['new' => n, 'open' => n, 'answered' => n, 'closed' => n, 'all' => n] — cached for 30 s (the overview badge) */
    public static function counts(): array
    {
        $make = function () {
            $c = ['new' => 0, 'open' => 0, 'answered' => 0, 'closed' => 0];
            foreach (Db::all('SELECT status, COUNT(*) AS n FROM support_tickets GROUP BY status') as $r) if (isset($c[(string) $r['status']])) $c[(string) $r['status']] = (int) $r['n'];
            $c['all'] = array_sum($c);
            return $c;
        };
        try { if (class_exists('Tfm\Cache') && Cache::available()) return (array) Cache::remember(self::CACHE_COUNTS, 30, $make); } catch (\Throwable $e) { /* the database */ }
        return $make();
    }

    /** normalise a list filter: status, kind, q (a ticket number "yymmdd-id" / "#id" / an account id / a nickname) */
    public static function filter(array $f): array
    {
        $status = isset($f['status']) && is_string($f['status']) && in_array($f['status'], self::STATUS, true) ? $f['status'] : '';
        if (isset($f['status']) && $f['status'] === 'active') $status = 'active';
        $kind = isset($f['kind']) && is_string($f['kind']) && in_array($f['kind'], self::KINDS, true) ? $f['kind'] : '';
        $q = isset($f['q']) && is_string($f['q']) ? mb_substr(trim($f['q']), 0, 40) : '';
        return ['status' => $status, 'kind' => $kind, 'q' => $q];
    }

    /** WHERE … and parameters of a filter (every value bound) */
    private static function where(array $f): array
    {
        $w = [];
        $p = [];
        if ($f['status'] === 'active') $w[] = "status IN ('new', 'open')";
        elseif ($f['status'] !== '') { $w[] = 'status = ?'; $p[] = $f['status']; }
        if ($f['kind'] !== '') { $w[] = 'kind = ?'; $p[] = $f['kind']; }
        $q = $f['q'];
        if ($q !== '') {
            if (preg_match('/^#?(\d{1,12})$/', $q, $m) || preg_match('/^\d{6}-(\d{1,12})$/', $q, $m)) { $w[] = '(id = ? OR user_id = ?)'; $p[] = (int) $m[1]; $p[] = (int) $m[1]; }
            else { $u = Users::byNickname($q); $w[] = 'user_id = ?'; $p[] = $u ? (int) $u['id'] : -1; }
        }
        return [$w ? ' WHERE ' . implode(' AND ', $w) : '', $p];
    }

    /** one page of the admin list, newest first (keyset by id) → ['rows' => [...], 'more' => bool, 'next' => smallest id] */
    public static function page(array $filter, int $before = 0, int $limit = 50): array
    {
        $f = self::filter($filter);
        $limit = max(1, min(200, $limit));
        list($where, $p) = self::where($f);
        $where .= ($where === '' ? ' WHERE ' : ' AND ') . 'id < ?';
        $p[] = $before > 0 ? $before : PHP_INT_MAX;
        $rows = Db::all('SELECT id, no, user_id, kind, category, body, status, shot_path, target_user, target_ref, created_at, updated_at, answered_at FROM support_tickets' . $where . ' ORDER BY id DESC LIMIT ' . ($limit + 1), $p);
        $more = count($rows) > $limit;
        if ($more) array_pop($rows);
        $names = self::nicknames(array_merge(array_map(function ($r) { return (int) $r['user_id']; }, $rows), array_map(function ($r) { return (int) $r['target_user']; }, $rows)));
        foreach ($rows as &$r) {
            $r['nick'] = isset($names[(int) $r['user_id']]) ? $names[(int) $r['user_id']] : '(지운 계정)';
            $r['target_nick'] = (int) $r['target_user'] > 0 && isset($names[(int) $r['target_user']]) ? $names[(int) $r['target_user']] : '';
        }
        unset($r);
        return ['rows' => $rows, 'more' => $more, 'next' => $rows ? (int) $rows[count($rows) - 1]['id'] : 0, 'filter' => $f];
    }

    /** id => nickname for a set of accounts (one query) */
    private static function nicknames(array $ids): array
    {
        $ids = array_values(array_filter(array_unique(array_map('intval', $ids)), function ($v) { return $v > 0; }));
        if (!$ids) return [];
        $out = [];
        foreach (array_chunk($ids, 200) as $chunk) {
            foreach (Db::all('SELECT id, nickname FROM users WHERE id IN (' . implode(', ', array_fill(0, count($chunk), '?')) . ')', $chunk) as $u) $out[(int) $u['id']] = (string) $u['nickname'];
        }
        return $out;
    }

    /** one ticket for the operator: the row, the decoded device facts, the thread, the names, a chat report of the same line */
    public static function get(int $id): ?array
    {
        $t = $id > 0 ? Db::one('SELECT * FROM support_tickets WHERE id = ?', [$id]) : null;
        if (!$t) return null;
        $meta = (string) $t['meta'] !== '' ? Json::tryDecode((string) $t['meta']) : [];
        $t['meta'] = is_array($meta) ? $meta : [];
        $th = self::threads([$id]);
        $t['thread'] = isset($th[$id]) ? $th[$id] : [];
        $names = self::nicknames([(int) $t['user_id'], (int) $t['target_user']]);
        $t['nick'] = isset($names[(int) $t['user_id']]) ? $names[(int) $t['user_id']] : '(지운 계정)';
        $t['target_nick'] = (int) $t['target_user'] > 0 && isset($names[(int) $t['target_user']]) ? $names[(int) $t['target_user']] : '';
        $t['chat'] = null;
        if (preg_match('/^chat:(\d{1,18})$/', (string) $t['target_ref'], $m)) {
            $msg = Db::one('SELECT id, nickname, text, hidden, created_at FROM chat_messages WHERE id = ?', [(int) $m[1]]);
            $rep = Db::one('SELECT id, status FROM chat_reports WHERE reporter_id = ? AND message_id = ?', [(int) $t['user_id'], (int) $m[1]]);
            $t['chat'] = ['message' => $msg, 'report' => $rep];
        }
        $t['open_of_user'] = (int) Db::value("SELECT COUNT(*) FROM support_tickets WHERE user_id = ? AND status IN ('new', 'open', 'answered')", [(int) $t['user_id']]);
        return $t;
    }

    private static function adminId(array $admin): int
    {
        if ((isset($admin['role']) ? $admin['role'] : '') !== 'admin') throw new ApiException(403, 'FORBIDDEN', '관리자 권한이 필요해요.');
        return (int) $admin['id'];
    }

    /** the operator answers: a message, status → answered (or the one chosen), the player sees it in the app */
    public static function answer(array $admin, int $id, string $text, string $status = 'answered'): void
    {
        $aid = self::adminId($admin);
        $t = Db::one('SELECT id, user_id, status, user_seen_at FROM support_tickets WHERE id = ?', [$id]);
        if (!$t) throw new ApiException(404, 'NOT_FOUND', self::NOT_FOUND);
        if (!in_array($status, ['answered', 'closed'], true)) $status = 'answered';
        // the operator's words are plain text like everyone's (the app prints them with textContent); personal data of
        // the player is not repeated back by accident
        $body = ChatFilter::maskPII(self::cleanLines($text, self::BODY_MAX));
        if ($body === '') throw new ApiException(400, 'INVALID_INPUT', '답변을 적어 주세요.');
        // later than the player's last look, even within the same millisecond (the answer must show as unread)
        $now = max(Clock::ms(), (int) $t['user_seen_at'] + 1);
        Db::tx(function () use ($id, $aid, $body, $now, $status) {
            Db::insert('support_messages', ['ticket_id' => $id, 'side' => 'admin', 'author_id' => $aid, 'body' => $body, 'created_at' => $now]);
            Db::exec('UPDATE support_tickets SET status = ?, answered_at = ?, updated_at = ? WHERE id = ?', [$status, $now, $now, $id]);
        });
        self::bump();
        Audit::log('support_answer', (int) $t['user_id'], ['id' => $id, 'status' => $status], 'info', $aid);
    }

    /** the operator's text: lines kept, controls stripped (no bad-word mask: an operator may quote what was reported) */
    private static function cleanLines(string $s, int $max): string
    {
        $s = str_replace(["\r\n", "\r"], "\n", $s);
        $lines = [];
        foreach (explode("\n", $s) as $line) { $lines[] = Users::cleanText($line, $max); if (count($lines) >= 40) break; }
        while ($lines && end($lines) === '') array_pop($lines);
        return mb_substr(trim(implode("\n", $lines)), 0, $max);
    }

    public static function setStatus(array $admin, int $id, string $status): void
    {
        $aid = self::adminId($admin);
        if (!in_array($status, self::STATUS, true)) throw new ApiException(400, 'INVALID_INPUT', '상태가 올바르지 않아요.');
        $t = Db::one('SELECT id, user_id, status FROM support_tickets WHERE id = ?', [$id]);
        if (!$t) throw new ApiException(404, 'NOT_FOUND', self::NOT_FOUND);
        if ((string) $t['status'] === $status) return;
        Db::exec('UPDATE support_tickets SET status = ?, updated_at = ? WHERE id = ?', [$status, Clock::ms(), $id]);
        self::bump();
        Audit::log('support_status', (int) $t['user_id'], ['id' => $id, 'from' => (string) $t['status'], 'to' => $status], 'info', $aid);
    }

    /** the operator deletes tickets (row + messages + picture) → how many went */
    public static function remove(array $admin, array $ids): int
    {
        $aid = self::adminId($admin);
        $ids = array_slice(array_values(array_unique(array_filter(array_map('intval', $ids), function ($v) { return $v > 0; }))), 0, 500);
        $n = 0;
        foreach ($ids as $id) {
            $t = Db::one('SELECT id, user_id, shot_path FROM support_tickets WHERE id = ?', [$id]);
            if (!$t) continue;
            self::purge($t);
            $n++;
            Audit::log('support_delete', (int) $t['user_id'], ['id' => $id], 'warn', $aid);
        }
        return $n;
    }

    /**
     * The automatic clean-up: tickets untouched for support.keep_days go — the closed ones first, then the others —
     * at most $max per run (row, messages, picture). Returns how many went.
     */
    public static function cleanup(?array $admin = null, int $max = 500): int
    {
        $cut = Clock::ms() - self::limits()['keep_days'] * 86400000;
        $max = max(1, min(5000, $max));
        $rows = Db::all("SELECT id, user_id, shot_path FROM support_tickets WHERE status = 'closed' AND updated_at < ? ORDER BY updated_at LIMIT " . $max, [$cut]);
        if (count($rows) < $max) {
            foreach (['new', 'open', 'answered'] as $st) {
                if (count($rows) >= $max) break;
                $rows = array_merge($rows, Db::all('SELECT id, user_id, shot_path FROM support_tickets WHERE status = ? AND updated_at < ? ORDER BY updated_at LIMIT ' . ($max - count($rows)), [$st, $cut]));
            }
        }
        foreach ($rows as $t) self::purge($t);
        if ($rows) Audit::log('support_cleanup', null, ['n' => count($rows), 'keep_days' => self::limits()['keep_days']], 'info', $admin ? (int) $admin['id'] : null);
        return count($rows);
    }

    /** a nickname shown in an export: first letter + stars (the export may leave the admin site) */
    public static function maskNick(string $n): string
    {
        $n = (string) $n;
        if ($n === '') return '';
        return mb_substr($n, 0, 1) . str_repeat('*', max(2, min(6, mb_strlen($n) - 1)));
    }

    /** the rows of the masked CSV export (header first); at most $max tickets of the filter, newest first */
    public static function csvRows(array $filter, int $max = 20000): array
    {
        $out = [['번호', '종류', '분류', '상태', '보낸 사람', '글', '사진', '보낸 때', '바뀐 때', '답한 때']];
        $before = 0;
        $left = max(1, min(100000, $max));
        while ($left > 0) {
            $page = self::page($filter, $before, min(200, $left));
            foreach ($page['rows'] as $r) {
                $out[] = [
                    (string) $r['no'], self::KIND_KO[(string) $r['kind']][1], isset(self::CAT_KO[(string) $r['category']]) ? self::CAT_KO[(string) $r['category']] : (string) $r['category'],
                    self::STATUS_KO[(string) $r['status']][1], self::maskNick((string) $r['nick']), ChatFilter::maskPII((string) $r['body']),
                    (string) $r['shot_path'] !== '' ? '있음' : '', self::time((int) $r['created_at']), self::time((int) $r['updated_at']), self::time((int) $r['answered_at']),
                ];
            }
            $left -= count($page['rows']);
            if (!$page['more']) break;
            $before = $page['next'];
        }
        return $out;
    }

    private static function time(int $ms): string { return $ms > 0 ? date('Y-m-d H:i', intdiv($ms, 1000)) : ''; }

    /** RFC 4180 text of rows (a cell that a spreadsheet would run as a formula starts with an apostrophe) */
    public static function csv(array $rows): string
    {
        $out = "\xEF\xBB\xBF";
        foreach ($rows as $row) {
            $cells = [];
            foreach ($row as $c) {
                $c = (string) $c;
                if ($c !== '' && strpos('=+-@', $c[0]) !== false) $c = "'" . $c;
                if (preg_match('/[",\r\n\t]/', $c)) $c = '"' . str_replace('"', '""', $c) . '"';
                $cells[] = $c;
            }
            $out .= implode(',', $cells) . "\r\n";
        }
        return $out;
    }
}
