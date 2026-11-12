<?php
/**
 * 전통발효체험관 메타버스 — server command line (run on the server machine only)
 *
 *   php cli/tfm.php help
 *   php cli/tfm.php status                         environment & security self-check
 *   php cli/tfm.php install [--driver=mysql|sqlite --host= --port= --db= --user= --pass= --admin-email= --admin-nick= --admin-pass= --toss-client= --toss-secret= --mock=1]
 *                                                  headless install.php (config.local.php, tables, first admin, data/install.lock)
 *   php cli/tfm.php users [검색어]                  list accounts
 *   php cli/tfm.php promote <이메일|닉네임>         grant admin            (demote: remove admin)
 *   php cli/tfm.php ban <이메일|닉네임>             ban + sign out          (unban)
 *   php cli/tfm.php reset-password <이메일|닉네임> [새 비밀번호]   (random strong password when omitted)
 *   php cli/tfm.php sub:list                        subscriptions (tier, status, expiry, auto-renew)
 *   php cli/tfm.php sub:grant <이메일|닉네임> <2|3|4> <일수>   수동 부여 (schools / events; audit-logged)
 *   php cli/tfm.php sub:revoke <이메일|닉네임>      해지 (back to the base speed now)
 *   php cli/tfm.php sub:renew [--force] [이메일|닉네임]   charge the billing keys that are due (Windows 작업 스케줄러: once a day)
 *   php cli/tfm.php backup [폴더]                   SQLite: consistent copy via VACUUM INTO (MySQL: prints mysqldump)
 *   php cli/tfm.php cleanup                         retention cleanup (rate limits, presence, attempts, audit, chat, logs)
 *   php cli/tfm.php audit [개수]                    recent audit log
 *   php cli/tfm.php migrate                         create/upgrade the schema
 *   php cli/tfm.php setup-code                      one-time setup code for install.php / the first admin (24 h)
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
/** --key=value options and the remaining positional arguments */
$opts = [];
$pos = [];
foreach ($rest as $a) {
    if (preg_match('/^--([a-z][a-z0-9\-]*)(?:=(.*))?$/s', (string) $a, $m)) $opts[$m[1]] = isset($m[2]) ? $m[2] : '1';
    else $pos[] = (string) $a;
}
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
            if (Installer::locked() && empty($opts['force'])) fail('이미 설치되었어요 (data/install.lock). 다시 설치하려면 그 파일을 지우세요.');
            if (Installer::locked()) @unlink(Installer::lockPath());
            $driver = (isset($opts['driver']) ? $opts['driver'] : 'mysql') === 'sqlite' ? 'sqlite' : 'mysql';
            foreach (Installer::checks($driver) as $c) if ($c['status'] !== 'ok') out(sprintf('  %s %s: %s %s', $c['status'] === 'fail' ? '⛔' : '⚠️ ', $c['label'], $c['value'], $c['hint']));
            $r = Installer::run([
                'driver' => $driver, 'host' => isset($opts['host']) ? $opts['host'] : '127.0.0.1', 'port' => isset($opts['port']) ? $opts['port'] : '3306',
                'database' => isset($opts['db']) ? $opts['db'] : 'fermentation_metaverse', 'username' => isset($opts['user']) ? $opts['user'] : 'root', 'password' => isset($opts['pass']) ? $opts['pass'] : '',
                'socket' => isset($opts['socket']) ? $opts['socket'] : '', 'create_db' => empty($opts['no-create-db']),
                'admin_email' => isset($opts['admin-email']) ? $opts['admin-email'] : '', 'admin_nickname' => isset($opts['admin-nick']) ? $opts['admin-nick'] : '', 'admin_password' => isset($opts['admin-pass']) ? $opts['admin-pass'] : '',
                'toss_client' => isset($opts['toss-client']) ? $opts['toss-client'] : '', 'toss_secret' => isset($opts['toss-secret']) ? $opts['toss-secret'] : '', 'toss_mock' => !empty($opts['mock']),
            ]);
            out('✔ 설치 완료: ' . strtoupper($r['driver']) . ' (' . $r['server'] . ') · 스키마 v' . $r['schema'] . ' · 관리자 ' . $r['adminNickname'] . ($r['adminCreated'] ? ' 생성' : ' 권한 부여') . ($r['mock'] ? ' · 모의 결제' : ''));
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
            $u = findUser($arg);
            $pw = (string) (isset($pos[1]) ? $pos[1] : '');
            $generated = $pw === '';
            if ($generated) $pw = 'Tfm' . substr(strtr(base64_encode(random_bytes(12)), '+/=', 'xyz'), 0, 13) . random_int(10, 99);
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
            Db::pdo();
            Db::migrate();
            out('✔ 스키마 버전 ' . Db::schemaVersion() . ' (' . Db::driver() . ')');
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
