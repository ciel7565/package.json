<?php
/**
 * 전통발효체험관 메타버스 — server command line (run on the server machine only)
 *
 *   php cli/tfm.php help
 *   php cli/tfm.php status                         environment & security self-check
 *   php cli/tfm.php install [--driver=mysql|sqlite --host= --port= --db= --user=<DB 관리자> --admin-email= --admin-nick=
 *                           --toss-client= --mock --no-app-account --app-host= --ssl-ca= --allow-insecure-remote]
 *                                                  headless install.php (config.local.php, tables, first admin, data/install.lock);
 *                                                  MySQL: a dedicated DB account (SELECT/INSERT/UPDATE/DELETE only) is created
 *   php cli/tfm.php users [검색어]                  list accounts
 *   php cli/tfm.php promote <이메일|닉네임>         grant admin            (demote: remove admin)
 *   php cli/tfm.php ban <이메일|닉네임>             ban + sign out          (unban)
 *   php cli/tfm.php reset-password <이메일|닉네임> [--ask]   random strong password (shown once); --ask: type one (hidden)
 *   php cli/tfm.php sub:list                        subscriptions (tier, status, expiry, auto-renew)
 *   php cli/tfm.php sub:grant <이메일|닉네임> <2|3|4> <일수>   수동 부여 (schools / events; audit-logged)
 *   php cli/tfm.php sub:revoke <이메일|닉네임>      해지 (back to the base speed now)
 *   php cli/tfm.php sub:renew [--force] [이메일|닉네임]   charge the billing keys that are due (Windows 작업 스케줄러: once a day)
 *   php cli/tfm.php backup [폴더]                   SQLite: consistent copy via VACUUM INTO (MySQL: prints mysqldump)
 *   php cli/tfm.php cleanup                         retention cleanup (rate limits, presence, attempts, audit, chat, logs)
 *   php cli/tfm.php audit [개수]                    recent audit log
 *   php cli/tfm.php migrate [--admin-user <DB 관리자>]   create/upgrade the schema (a dedicated account: with the
 *                                                  administrator connection, used for this run only)
 *   php cli/tfm.php db:account --admin-user <DB 관리자>        move an installation that runs as root to a dedicated account
 *   php cli/tfm.php db:rotate-password --admin-user <DB 관리자> new random password for the runtime DB account
 *   php cli/tfm.php setup-code                      one-time setup code for install.php / the first admin (24 h)
 *   php cli/tfm.php secret:rotate [--app-key] [--data-key]   new app / data keys in data/secret.php (none given: both);
 *                                                  --data-key re-seals the sealed columns, --app-key signs everyone out
 *
 * Secrets are never typed on the command line (other users could read them in the process list or the shell
 * history): they are asked for without echo, or read from the environment — TFM_DB_ADMIN_PASS (database
 * administrator), TFM_ADMIN_PASS (first admin account), TFM_TOSS_SECRET_KEY (토스 secret key), TFM_NEW_PASSWORD
 * (reset-password --ask) — or, when the command is not run in a terminal, one line each from standard input.
 *
 * Windows/XAMPP:  C:\xampp\php\php.exe C:\xampp\htdocs\metaverse\cli\tfm.php status
 *
 * Plug-ins: any other command is looked up in cli/*.php (not tfm.php / index.php). Such a file starts with
 * `if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }` and returns ['command:name' => function (array $args): int]
 * — $args are the words after the command, exactly as typed; the return value is the exit code. Its first doc
 * comment is printed by `help`.
 * PHP 7.2 syntax only.
 */
declare(strict_types=1);

if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }

require __DIR__ . '/../lib/bootstrap.php';

use Tfm\AdminOps;
use Tfm\ApiException;
use Tfm\Audit;
use Tfm\Clock;
use Tfm\Config;
use Tfm\Db;
use Tfm\Health;
use Tfm\Installer;
use Tfm\SetupCode;
use Tfm\Subscription;
use Tfm\Users;

$argv = isset($_SERVER['argv']) ? $_SERVER['argv'] : [];
$cmd = strtolower((string) (isset($argv[1]) ? $argv[1] : 'help'));
$rest = array_slice($argv, 2);
/**
 * --key=value options (a value option may also be written --key value), --flag options (true) and the remaining
 * positional arguments
 */
$valueOpts = ['driver', 'host', 'port', 'db', 'user', 'socket', 'admin-email', 'admin-nick', 'toss-client', 'admin-user', 'app-host', 'ssl-ca'];
$opts = [];
$pos = [];
for ($i = 0, $n = count($rest); $i < $n; $i++) {
    $a = (string) $rest[$i];
    if (preg_match('/^--([a-z][a-z0-9\-]*)(?:=(.*))?$/s', $a, $m)) {
        if (isset($m[2])) $opts[$m[1]] = $m[2];
        elseif (in_array($m[1], $valueOpts, true) && $i + 1 < $n && strncmp((string) $rest[$i + 1], '--', 2) !== 0) $opts[$m[1]] = (string) $rest[++$i];
        else $opts[$m[1]] = true;
    } else {
        $pos[] = $a;
    }
}
unset($i, $n, $a, $m);
$arg = isset($pos[0]) ? $pos[0] : '';
$CLI = ['id' => 0, 'nickname' => 'CLI'];

function out(string $s = ''): void { fwrite(STDOUT, $s . PHP_EOL); }
function fail(string $s) { fwrite(STDERR, "✖ $s" . PHP_EOL); exit(1); }
function findUser(string $q): array
{
    if ($q === '') fail('이메일 또는 닉네임을 적어 주세요.');
    $u = Users::byLogin($q);
    if (!$u) fail("사용자를 찾을 수 없어요: $q");
    return $u;
}
/** the string value of an option ('' when absent or given as a bare flag) */
function opt(array $opts, string $k, string $d = ''): string { return isset($opts[$k]) && is_string($opts[$k]) ? $opts[$k] : $d; }
/**
 * finding F20: a secret given as an option value (--pass=…, --admin-pass=…, --toss-secret=…) is refused before
 * anything happens — it would sit in the process list and the shell history. An empty --pass= (XAMPP root without a
 * password) is no secret and stays allowed.
 */
function refuseArgvSecrets(array $opts): void
{
    $map = ['pass' => 'TFM_DB_ADMIN_PASS', 'admin-pass' => 'TFM_ADMIN_PASS', 'toss-secret' => 'TFM_TOSS_SECRET_KEY', 'password' => 'TFM_ADMIN_PASS',
        'admin-password' => 'TFM_ADMIN_PASS', 'db-pass' => 'TFM_DB_ADMIN_PASS', 'secret' => 'TFM_TOSS_SECRET_KEY', 'new-password' => 'TFM_NEW_PASSWORD'];
    foreach ($map as $k => $env) {
        if (isset($opts[$k]) && is_string($opts[$k]) && $opts[$k] !== '') {
            fail("--$k=… 처럼 비밀번호·키를 명령줄에 쓰지 마세요: 같은 컴퓨터의 다른 사용자가 프로세스 목록이나 명령 기록에서 볼 수 있어요. 값을 빼고 다시 실행하면 화면에 보이지 않게 물어봐요 (또는 환경 변수 $env).");
        }
    }
}
function stdinIsTty(): bool { return function_exists('stream_isatty') && @stream_isatty(STDIN); }
/** read one line without echo where the terminal allows it (stty on Linux / macOS, PowerShell on Windows) */
function askHidden(string $label): string
{
    fwrite(STDOUT, $label . ': ');
    if (DIRECTORY_SEPARATOR === '\\') {
        $ps = function_exists('shell_exec') ? @shell_exec('powershell -NoProfile -Command "$p = Read-Host -AsSecureString; [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($p))"') : null;
        fwrite(STDOUT, PHP_EOL);
        if (is_string($ps)) return rtrim($ps, "\r\n");
        fwrite(STDOUT, '(입력한 글자가 화면에 보여요) ' . $label . ': ');
        $line = fgets(STDIN);
        return $line === false ? '' : rtrim($line, "\r\n");
    }
    $state = function_exists('shell_exec') ? trim((string) @shell_exec('stty -g 2>/dev/null')) : '';
    if ($state !== '') @shell_exec('stty -echo 2>/dev/null');
    $line = fgets(STDIN);
    if ($state !== '') @shell_exec('stty ' . escapeshellarg($state) . ' 2>/dev/null');
    fwrite(STDOUT, PHP_EOL);
    return $line === false ? '' : rtrim($line, "\r\n");
}
/**
 * A secret: the environment variable $env when it is set (also to an empty value), else asked without echo in a
 * terminal ($confirm: twice), else one line from standard input (a script feeding the command).
 */
function secretInput(string $label, string $env, bool $confirm = false): string
{
    $v = getenv($env);
    if ($v !== false) return (string) $v;
    if (!stdinIsTty()) {
        $line = fgets(STDIN);
        return $line === false ? '' : rtrim($line, "\r\n");
    }
    for ($try = 0; $try < 3; $try++) {
        $a = askHidden($label);
        if (!$confirm || askHidden($label . ' (한 번 더)') === $a) return $a;
        fwrite(STDERR, '  두 번 입력한 값이 달라요. 다시 입력해 주세요.' . PHP_EOL);
    }
    fail('비밀번호를 확인하지 못했어요.');
    return '';
}
function pad(string $s, int $w): string { $l = mb_strwidth($s); return $s . str_repeat(' ', max(0, $w - $l)); }
function whenMs($ms): string { $ms = (int) $ms; return $ms > 0 ? date('Y-m-d H:i', intdiv($ms, 1000)) : '-'; }
/** the first doc comment of a PHP file, without the comment markers */
function docOf(string $file): string
{
    $src = (string) @file_get_contents($file);
    $parts = explode('/**', $src, 2);
    $doc = isset($parts[1]) ? explode('*/', $parts[1], 2)[0] : '';
    return trim((string) preg_replace('/^ *\* ?/m', '', $doc));
}
/**
 * Commands of the plug-in files cli/*.php (other owners: security events, admin path …): command (lower case) →
 * ['run' => callable(array $args): int, 'file' => basename]. A file that fails to load or returns no array is
 * skipped with a warning; the first file (by name) wins when two files name the same command.
 */
function cliPlugins(): array
{
    static $map = null;
    if ($map !== null) return $map;
    $map = [];
    $files = glob(__DIR__ . DIRECTORY_SEPARATOR . '*.php') ?: [];
    sort($files);
    foreach ($files as $f) {
        $base = basename($f);
        if ($base === 'tfm.php' || $base === 'index.php') continue;
        try {
            $r = (static function (string $tfmPluginFile) { return require $tfmPluginFile; })($f);
        } catch (\Throwable $e) {
            fwrite(STDERR, "⚠ 추가 명령 파일 cli/$base 을 읽지 못했어요 (" . get_class($e) . ')' . PHP_EOL);
            continue;
        }
        if (!is_array($r)) { fwrite(STDERR, "⚠ cli/$base 이 명령 목록(배열)을 돌려주지 않아 건너뛰었어요." . PHP_EOL); continue; }
        foreach ($r as $name => $fn) {
            if (!is_string($name) || !preg_match('/^[a-z0-9][a-z0-9:\-_]{0,60}$/i', $name) || !is_callable($fn)) continue;
            $k = strtolower($name);
            if (isset($map[$k])) { fwrite(STDERR, "⚠ 명령 $k 이 cli/{$map[$k]['file']} 과 cli/$base 에 함께 있어요: cli/{$map[$k]['file']} 것을 써요." . PHP_EOL); continue; }
            $map[$k] = ['run' => $fn, 'file' => $base];
        }
    }
    return $map;
}
function printHelp(): void
{
    out(docOf(__FILE__));
    $byFile = [];
    foreach (cliPlugins() as $name => $p) $byFile[$p['file']][] = $name;
    foreach ($byFile as $file => $names) {
        out('');
        out("추가 명령 (cli/$file): " . implode(', ', $names));
        $doc = docOf(__DIR__ . DIRECTORY_SEPARATOR . $file);
        if ($doc !== '') foreach (explode("\n", $doc) as $line) out('  ' . $line);
    }
}

try {
    switch ($cmd) {
        case 'status': {
            $h = Health::collect(false);
            $icon = ['ok' => '✅', 'warn' => '⚠️ ', 'fail' => '⛔'];
            out("전통발효체험관 서버 점검 — 종합: {$icon[$h['status']]} {$h['status']}  (정상 {$h['summary']['ok']} · 주의 {$h['summary']['warn']} · 위험 {$h['summary']['fail']})");
            foreach ($h['checks'] as $c) {
                out(sprintf('  %s %s %s%s', isset($icon[$c['status']]) ? $icon[$c['status']] : '·', pad($c['label'], 34), is_scalar($c['value']) ? (string) $c['value'] : json_encode($c['value'], JSON_UNESCAPED_UNICODE), $c['hint'] ? "  → {$c['hint']}" : ''));
            }
            exit($h['status'] === 'fail' ? 2 : 0);
        }
        case 'install': {
            refuseArgvSecrets($opts);
            if (Installer::locked() && empty($opts['force'])) fail('이미 설치되었어요 (data/install.lock). 다시 설치하려면 그 파일을 지우거나 --force 를 붙이세요.');
            if (Installer::locked()) @unlink(Installer::lockPath());
            $driver = opt($opts, 'driver', 'mysql') === 'sqlite' ? 'sqlite' : 'mysql';
            foreach (Installer::checks($driver) as $c) if ($c['status'] !== 'ok') out(sprintf('  %s %s: %s %s', $c['status'] === 'fail' ? '⛔' : '⚠️ ', $c['label'], $c['value'], $c['hint']));
            $dbUser = opt($opts, 'user', 'root');
            // the database administrator's password: an explicit empty --pass= (XAMPP root), else TFM_DB_ADMIN_PASS / the prompt
            $dbPass = $driver !== 'mysql' ? '' : (isset($opts['pass']) && $opts['pass'] === '' ? '' : secretInput("데이터베이스 관리자({$dbUser}) 비밀번호 (없으면 그냥 Enter)", 'TFM_DB_ADMIN_PASS'));
            $adminPass = secretInput('첫 관리자 계정의 비밀번호 (8자 이상, 영문+숫자)', 'TFM_ADMIN_PASS', true);
            $tossClient = opt($opts, 'toss-client');
            $tossSecret = $tossClient !== '' ? secretInput('토스 시크릿 키 (test_sk_… / live_sk_…)', 'TFM_TOSS_SECRET_KEY') : '';
            $r = Installer::run([
                'driver' => $driver, 'host' => opt($opts, 'host', '127.0.0.1'), 'port' => opt($opts, 'port', '3306'),
                'database' => opt($opts, 'db', 'fermentation_metaverse'), 'username' => $dbUser, 'password' => $dbPass,
                'socket' => opt($opts, 'socket'), 'create_db' => empty($opts['no-create-db']),
                'app_account' => empty($opts['no-app-account']), 'app_host' => opt($opts, 'app-host'),
                'ssl_ca' => opt($opts, 'ssl-ca'), 'allow_insecure_remote' => !empty($opts['allow-insecure-remote']),
                'admin_email' => opt($opts, 'admin-email'), 'admin_nickname' => opt($opts, 'admin-nick'), 'admin_password' => $adminPass,
                'toss_client' => $tossClient, 'toss_secret' => $tossSecret, 'toss_mock' => !empty($opts['mock']),
            ]);
            SetupCode::consume(); // a setup code waiting for the web installer is not needed any more
            $acct = $r['dbAccount'];
            out('✔ 설치 완료: ' . strtoupper($r['driver']) . ' · 스키마 v' . $r['schema'] . ' · 관리자 ' . $r['adminNickname'] . ($r['adminCreated'] ? ' 생성' : ' 권한 부여') . ($r['mock'] ? ' · 모의 결제' : ''));
            if ($r['driver'] === 'mysql') {
                if (!empty($acct['dedicated'])) {
                    out("  전용 DB 계정 {$acct['user']} (" . implode(', ', $acct['hosts']) . ") — SELECT·INSERT·UPDATE·DELETE 만 가능, 비밀번호 32자 무작위. 관리자 계정({$dbUser})은 저장하지 않았어요.");
                    if ($acct['warning'] === 'ddl') out('  ⚠ 다른 권한 설정 때문에 이 계정이 표를 만들 수 있어요: php cli/tfm.php status 를 확인하세요.');
                    out('  업데이트할 때: php cli/tfm.php migrate --admin-user ' . $dbUser);
                } elseif ($acct['reason'] === 'not_requested') {
                    out("  ⚠ 입력한 계정({$dbUser})을 그대로 써요 (--no-app-account). 나중에: php cli/tfm.php db:account --admin-user <DB 관리자>");
                } else {
                    out("  ⚠ {$dbUser} 계정에는 새 계정을 만드는 권한이 없어서 그대로 써요. 권한이 있는 관리자가 아래 SQL 을 실행한 뒤 config/config.local.php 의 db.mysql 에 그 계정을 적고 'auto_migrate' => false 를 넣으세요:");
                    foreach ($acct['manual'] as $line) out('    ' . $line);
                }
            }
            out('  config/config.local.php 와 data/install.lock 을 만들었어요.');
            break;
        }
        case 'users': {
            $rows = $arg !== ''
                ? Db::all("SELECT u.*, p.level FROM users u LEFT JOIN user_profiles p ON p.user_id = u.id WHERE u.nickname_key LIKE ? OR u.email LIKE ? ORDER BY u.id LIMIT 200", ['%' . mb_strtolower($arg) . '%', '%' . mb_strtolower($arg) . '%'])
                : Db::all('SELECT u.*, p.level FROM users u LEFT JOIN user_profiles p ON p.user_id = u.id ORDER BY u.id DESC LIMIT 200');
            out(sprintf('%-6s %s %s %-6s %-7s %s', '#', pad('닉네임', 14), pad('이메일', 32), '권한', '상태', '레벨'));
            foreach ($rows as $r) out(sprintf('%-6d %s %s %-6s %-7s Lv.%d', (int) $r['id'], pad((string) $r['nickname'], 14), pad((string) $r['email'], 32), $r['role'], $r['status'], (int) (isset($r['level']) ? $r['level'] : 1)));
            out(count($rows) . '명');
            break;
        }
        case 'promote':
        case 'demote': {
            $u = findUser($arg);
            out('✔ ' . AdminOps::setRole($CLI, (int) $u['id'], $cmd === 'promote' ? 'admin' : 'user'));
            break;
        }
        case 'ban':
        case 'unban': {
            $u = findUser($arg);
            out('✔ ' . AdminOps::setBanned($CLI, (int) $u['id'], $cmd === 'ban'));
            break;
        }
        case 'reset-password': {
            refuseArgvSecrets($opts);
            if (isset($pos[1])) fail('새 비밀번호를 명령줄에 쓰지 마세요: 같은 컴퓨터의 다른 사용자가 프로세스 목록이나 명령 기록에서 볼 수 있어요. 그냥 실행하면 무작위 비밀번호를 만들어 한 번 보여 주고, --ask 를 붙이면 화면에 보이지 않게 물어봐요 (또는 환경 변수 TFM_NEW_PASSWORD).');
            $u = findUser($arg);
            $generated = empty($opts['ask']) && getenv('TFM_NEW_PASSWORD') === false;
            $pw = $generated ? 'Tfm' . substr(strtr(base64_encode(random_bytes(12)), '+/=', 'xyz'), 0, 13) . random_int(10, 99) : secretInput('새 비밀번호', 'TFM_NEW_PASSWORD', true);
            if ($e = Users::validPassword($pw, (string) $u['email'], (string) $u['nickname'])) fail($e);
            Users::update((int) $u['id'], ['password_hash' => Users::hashPassword($pw), 'password_changed_at' => Clock::ms()], true);
            Audit::log('password_reset', (int) $u['id'], ['via' => 'cli'], 'warn');
            out("✔ {$u['nickname']} 님의 비밀번호를 바꿨고 모든 기기에서 로그아웃시켰어요.");
            if ($generated) out("  새 비밀번호: $pw   (한 번만 표시돼요 — 본인에게 안전하게 전달하세요)");
            break;
        }
        case 'sub:list': {
            $rows = Subscription::listAll(500);
            out(sprintf('%-6s %s %-4s %-9s %-17s %-5s %s', '#', pad('닉네임', 14), '단계', '상태', '만료', '자동', '마지막 주문'));
            foreach ($rows as $r) out(sprintf('%-6d %s %-4s %-9s %-17s %-5s %s', (int) $r['user_id'], pad((string) $r['nickname'], 14), (int) $r['tier'] . '배', $r['status'], whenMs($r['expires_at']), (int) $r['auto_renew'] ? '켬' : '꺼짐', (string) $r['last_order_id']));
            out(count($rows) . '건');
            break;
        }
        case 'sub:grant': {
            $u = findUser($arg);
            $tier = (int) (isset($pos[1]) ? $pos[1] : 0);
            $days = (int) (isset($pos[2]) ? $pos[2] : 30);
            $r = Subscription::grant($CLI, (int) $u['id'], $tier, $days);
            out('✔ ' . $r['message'] . ' (만료 ' . whenMs($r['sub']['expiresAt']) . ')');
            break;
        }
        case 'sub:revoke': {
            $u = findUser($arg);
            $r = Subscription::revoke($CLI, (int) $u['id']);
            out('✔ ' . $r['message']);
            break;
        }
        case 'sub:renew': {
            $uid = $arg !== '' ? (int) findUser($arg)['id'] : null;
            $results = Subscription::renewDue($uid, !empty($opts['force']));
            foreach ($results as $r) {
                out(sprintf('  user #%d %s %s', (int) $r['userId'], $r['ok'] ? '✔' : '✖', isset($r['skipped']) ? 'skip: ' . $r['skipped'] : (isset($r['status']) ? $r['status'] : '') . (isset($r['expiresAt']) ? ' → ' . whenMs($r['expiresAt']) : '') . (isset($r['code']) ? ' (' . $r['code'] . ')' : '') . (isset($r['error']) ? ' ' . $r['error'] : '')));
            }
            Audit::log('sub_renew_run', $uid, ['force' => !empty($opts['force']), 'count' => count($results), 'via' => 'cli']);
            out('✔ 갱신 검사 ' . count($results) . '건');
            break;
        }
        case 'backup': {
            if (Db::driver() !== 'sqlite') {
                $m = (array) Config::get('db.mysql', []);
                out('MySQL/MariaDB 백업 명령:');
                out(sprintf('  mysqldump -h %s -P %d -u %s -p --single-transaction %s > fermentation_metaverse-%s.sql', isset($m['host']) ? $m['host'] : '127.0.0.1', (int) (isset($m['port']) ? $m['port'] : 3306), isset($m['username']) ? $m['username'] : 'root', isset($m['database']) ? $m['database'] : 'fermentation_metaverse', date('Ymd-His')));
                break;
            }
            $dir = $arg !== '' ? rtrim($arg, '/\\') : Config::dataDir() . DIRECTORY_SEPARATOR . 'backups';
            if (!is_dir($dir)) Config::ensureDir($dir, true);
            // unguessable name: even if a misconfigured server exposed data/, a backup cannot be fetched by guessing the date
            $file = $dir . DIRECTORY_SEPARATOR . 'tfm-' . date('Ymd-His') . '-' . bin2hex(random_bytes(6)) . '.sqlite';
            Db::pdo()->exec('VACUUM INTO ' . Db::pdo()->quote($file));
            @chmod($file, 0640);
            Audit::log('backup', null, ['file' => basename($file)]);
            out("✔ 백업 완료: $file (" . number_format((int) filesize($file)) . ' bytes)');
            out('  data/secret.php 도 함께 보관하세요 (IP 해시 키·DB 파일 이름).');
            break;
        }
        case 'cleanup': {
            $r = AdminOps::cleanup(null);
            foreach ($r as $k => $v) out(sprintf('  %-16s %d', $k, $v));
            out('✔ 정리 완료');
            break;
        }
        case 'audit': {
            $n = max(1, min(500, (int) ($arg !== '' ? $arg : 30)));
            foreach (array_reverse(Db::all("SELECT * FROM audit_log ORDER BY id DESC LIMIT $n")) as $r) {
                out(sprintf('%s  %-6s %-24s user=%s actor=%s ip=%s %s', date('Y-m-d H:i:s', intdiv((int) $r['created_at'], 1000)), $r['severity'], $r['event'], isset($r['user_id']) ? $r['user_id'] : '-', isset($r['actor_id']) ? $r['actor_id'] : '-', $r['ip'], mb_substr((string) $r['detail'], 0, 160)));
            }
            break;
        }
        case 'migrate': {
            refuseArgvSecrets($opts);
            $adminUser = opt($opts, 'admin-user');
            if ($adminUser !== '') {
                $r = Installer::migrateAsAdmin($adminUser, secretInput("데이터베이스 관리자({$adminUser}) 비밀번호", 'TFM_DB_ADMIN_PASS'));
                out("✔ 스키마 버전 {$r['from']} → {$r['to']} ({$r['driver']}) — 관리자 연결은 이번 한 번만 쓰고 저장하지 않았어요.");
                break;
            }
            try {
                Db::pdo();
                Db::migrate();
            } catch (ApiException $e) {
                if ($e->errorCode === 'SCHEMA_OUTDATED') fail('체험관 전용 DB 계정은 표를 바꿀 수 없어요. 데이터베이스 관리자 연결로 실행하세요: php cli/tfm.php migrate --admin-user root');
                throw $e;
            }
            out('✔ 스키마 버전 ' . Db::schemaVersion() . ' (' . Db::driver() . ')');
            break;
        }
        case 'db:account':
        case 'db:rotate-password': {
            refuseArgvSecrets($opts);
            $adminUser = opt($opts, 'admin-user');
            if ($adminUser === '') fail('--admin-user <DB 관리자> 를 적어 주세요 (XAMPP: --admin-user root). 비밀번호는 화면에 보이지 않게 물어보거나 TFM_DB_ADMIN_PASS 환경 변수에서 읽어요.');
            $adminPass = secretInput("데이터베이스 관리자({$adminUser}) 비밀번호", 'TFM_DB_ADMIN_PASS');
            if ($cmd === 'db:account') {
                $r = Installer::switchToAppAccount($adminUser, $adminPass);
                out("✔ 체험관이 이제 전용 DB 계정 {$r['user']} (" . implode(', ', $r['hosts']) . ') 으로 접속해요 — SELECT·INSERT·UPDATE·DELETE 만 가능. config/config.local.php 를 새로 썼어요 (auto_migrate 꺼짐).');
                if ($r['warning'] === 'ddl') out('  ⚠ 다른 권한 설정 때문에 이 계정이 표를 만들 수 있어요: php cli/tfm.php status 를 확인하세요.');
            } else {
                $r = Installer::rotateDbPassword($adminUser, $adminPass);
                out("✔ {$r['user']} 계정 (" . implode(', ', $r['hosts']) . ') 의 비밀번호를 32자 무작위로 바꾸고 config/config.local.php 에 적었어요. 예전 비밀번호는 이제 쓸 수 없어요.');
            }
            break;
        }
        case 'secret:rotate': {
            $app = !empty($opts['app-key']);
            $data = !empty($opts['data-key']);
            if (!$app && !$data) { $app = true; $data = true; }
            $r = Installer::rotateSecrets($app, $data);
            if ($r['dataKey']) {
                out("✔ 데이터 키(data_key)를 새로 만들고 봉인된 값 {$r['resealed']}개를 새 키로 다시 봉인했어요. 예전 키는 지웠어요.");
                if ($r['unreadable'] > 0) out("  ⚠ 어떤 키로도 열 수 없는 값이 {$r['unreadable']}개 있어요 (예전 백업에서 가져온 값일 수 있어요). 그 사용자의 자동 갱신은 다시 등록해야 해요.");
                out('  예전 데이터베이스 백업 속 결제 수단 정보는 이제 열 수 없어요: 백업과 data/secret.php 는 함께 보관하고, 키를 바꾼 뒤에는 새로 백업하세요.');
            }
            if ($r['appKey']) {
                out("✔ 앱 키(app_key)를 새로 만들었어요: 모든 사용자가 로그아웃됐고 (세션 {$r['sessions']}개 정리), 요청 횟수·로그인 실패 기록을 비우고, 차단·보안 기록의 주소 표시를 새 키로 바꿨어요 ({$r['ipHashes']}건).");
            }
            out('');
            out('밖에서 발급받은 키는 이 명령으로 바뀌지 않아요. 새어 나갔을 수 있으면 직접 바꾸세요:');
            out('  · 토스페이먼츠: 개발자센터 (developers.tosspayments.com) → 내 개발 정보 → API 키 → 시크릿 키 재발급 → config/config.local.php 의 toss.client_key / toss.secret_key 를 새 값으로 (예전 키는 재발급하면 바로 못 써요)');
            out('  · Anthropic (Claude): console.anthropic.com → API Keys → 예전 키 Disable·Delete → 새 키 만들기 → ANTHROPIC_API_KEY 환경 변수 또는 config.local.php 의 anthropic.api_key');
            out('  · 데이터베이스 비밀번호: php cli/tfm.php db:rotate-password --admin-user root');
            out('  · 관리자 비밀번호: php cli/tfm.php reset-password <이메일> (무작위 비밀번호를 한 번 보여 줘요)');
            break;
        }
        case 'setup-code': {
            $code = SetupCode::ensure();
            out('설치 코드: ' . SetupCode::format($code) . '   (하이픈은 넣어도 되고 빼도 돼요)');
            out('  install.php 의 "설치 코드" 칸이나 관리자 센터의 첫 관리자 지정 화면에 넣으세요.');
            out('  24시간 동안 쓸 수 있고, 한 번 쓰면 사라져요. 이 코드는 서버 컴퓨터에서만 볼 수 있어요: ' . SetupCode::path());
            break;
        }
        case 'help':
        case '--help':
        case '-h': {
            printHelp();
            break;
        }
        default: {
            $plugins = cliPlugins();
            if (isset($plugins[$cmd])) exit((int) call_user_func($plugins[$cmd]['run'], $rest));
            fwrite(STDERR, "✖ 알 수 없는 명령이에요: $cmd" . PHP_EOL . PHP_EOL);
            printHelp();
            exit(1);
        }
    }
} catch (ApiException $e) {
    fail($e->getMessage());
} catch (Throwable $e) {
    fail(get_class($e) . ': ' . $e->getMessage());
}
