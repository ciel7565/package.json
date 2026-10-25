<?php
/**
 * tests/server-unit.php — unit checks for server/lib that need no web server (a throw-away SQLite DB in the temp dir).
 *
 *   php tests/server-unit.php        prints PASS/FAIL per check, exits 1 when one fails
 *
 * CLI only; never deployed as an endpoint (tests/ is not part of the web root).
 */
declare(strict_types=1);

if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
$tmp = sys_get_temp_dir() . '/tfm-unit-' . bin2hex(random_bytes(6));
mkdir($tmp, 0700, true);
putenv("TFM_DATA_DIR=$tmp");
require __DIR__ . '/../server/lib/bootstrap.php';

use Tfm\{Retractions, Session};

$failed = 0;
function check(string $name, bool $ok, string $detail = ''): void
{
    global $failed;
    if (!$ok) $failed++;
    echo ($ok ? "PASS  " : "FAIL  ") . $name . ($detail !== '' ? "  — $detail" : '') . PHP_EOL;
}

// ------------------------------------------------------------------ Session::ownsAccount (DB restore vs. remembered sessions)
// a login remembers which account row it was made for: a newer account that got the same id (DB restore) is not it
$_SESSION = ['_tfm' => ['created' => 1700000000, 'uid' => 4, 'born' => 1699999999000, 'epoch' => 0]];
check('Session::ownsAccount — a session is not valid for another account row with the same id',
    method_exists(Session::class, 'ownsAccount') && Session::ownsAccount(['id' => 4, 'created_at' => 1700000500000]) === false);

// a login from before sessions carried 'born' (older server version): an account created after that login is not its own
$_SESSION = ['_tfm' => ['created' => 1700000000, 'uid' => 4, 'epoch' => 0]];
check('Session::ownsAccount — a session without the born key is not valid for an account created after its login',
    Session::ownsAccount(['id' => 4, 'created_at' => 1700000500000]) === false);
check('Session::ownsAccount — a session without the born key stays valid for its own (older) account',
    Session::ownsAccount(['id' => 4, 'created_at' => 1699990000000]) === true);

// ------------------------------------------------------------------ Retractions (moderation for players who are online)
for ($i = 1; $i <= 5; $i++) Retractions::add($i, null);
$page = Retractions::since(0, 3);
$rest = Retractions::since($page['retractId'], 3);
check('Retractions::since — a full page moves the cursor only past what it returned (the rest comes next poll)',
    $page['messages'] === [1, 2, 3] && $rest['messages'] === [4, 5],
    'pages ' . json_encode($page) . ' then ' . json_encode($rest));

// retractions are only needed while a game could still show the line: they go with the chat retention
Tfm\Db::insert('chat_retractions', ['message_id' => 99, 'user_id' => null, 'created_at' => Tfm\Clock::ms() - 40 * 86400000]);
$before = Retractions::since(0, 100)['messages'];
Tfm\AdminOps::cleanup();
$after = Retractions::since(0, 100)['messages'];
check('AdminOps::cleanup — retractions older than the chat retention are removed, newer ones kept',
    in_array(99, $before, true) && !in_array(99, $after, true) && in_array(5, $after, true), 'before ' . json_encode($before) . ' after ' . json_encode($after));

// ------------------------------------------------------------------ schema v3: reports from before the framing fix
// a v2 report without a message id kept the reporter's typed text as message_text (shown to admins as the target's
// words); the v3 upgrade moves it into the memo, marked as unverified
Tfm\Db::insert('chat_reports', ['reporter_id' => 1, 'target_user_id' => 2, 'target_name' => 'kidA', 'message_id' => null,
    'message_text' => '너네 집 불 지를거야', 'reason' => 'abuse', 'memo' => '무서워요', 'status' => 'open', 'created_at' => Tfm\Clock::ms(), 'resolved_at' => 0]);
Tfm\Db::exec('DELETE FROM schema_version WHERE version >= 3');
Tfm\Db::migrate();
$legacy = Tfm\Db::one("SELECT message_text, memo FROM chat_reports WHERE target_name = 'kidA'");
check('schema v3 — an old report\'s reporter-typed text leaves message_text and is kept in the memo as unverified',
    $legacy['message_text'] === '' && str_contains($legacy['memo'], '확인 안 됨') && str_contains($legacy['memo'], '너네 집 불 지를거야') && str_contains($legacy['memo'], '무서워요'),
    json_encode($legacy, JSON_UNESCAPED_UNICODE));

exit($failed ? 1 : 0);
