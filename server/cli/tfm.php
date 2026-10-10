<?php
/**
 * 전통발효체험관 메타버스 — server command line (run on the server machine only)
 *
 *   php cli/tfm.php help
 *   php cli/tfm.php status                         environment & security self-check
 *   php cli/tfm.php users [검색어]                  list accounts
 *   php cli/tfm.php promote <이메일|닉네임>         grant admin            (demote: remove admin)
 *   php cli/tfm.php ban <이메일|닉네임>             ban + sign out          (unban)
 *   php cli/tfm.php reset-password <이메일|닉네임> [새 비밀번호]   (random strong password when omitted)
 *   php cli/tfm.php backup [폴더]                   SQLite: consistent copy via VACUUM INTO (MySQL: prints mysqldump)
 *   php cli/tfm.php cleanup                         retention cleanup (rate limits, presence, attempts, audit, chat, logs)
 *   php cli/tfm.php audit [개수]                    recent audit log
 *   php cli/tfm.php migrate                         create/upgrade the schema
 *
 * Windows/XAMPP:  C:\xampp\php\php.exe C:\xampp\htdocs\metaverse\cli\tfm.php status
 */
declare(strict_types=1);

if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }

require __DIR__ . '/../lib/bootstrap.php';

use Tfm\{AdminOps, ApiException, Audit, Clock, Config, Db, Health, Users};

$argv = $_SERVER['argv'] ?? [];
$cmd = strtolower((string) ($argv[1] ?? 'help'));
$arg = (string) ($argv[2] ?? '');
$CLI = ['id' => 0, 'nickname' => 'CLI'];

function out(string $s = ''): void { fwrite(STDOUT, $s . PHP_EOL); }
function fail(string $s): never { fwrite(STDERR, "✖ $s" . PHP_EOL); exit(1); }
function findUser(string $q): array
{
    if ($q === '') fail('이메일 또는 닉네임을 적어 주세요.');
    $u = Users::byLogin($q);
    if (!$u) fail("사용자를 찾을 수 없어요: $q");
    return $u;
}
function pad(string $s, int $w): string { $l = mb_strwidth($s); return $s . str_repeat(' ', max(0, $w - $l)); }

try {
    switch ($cmd) {
        case 'status': {
            $h = Health::collect(false);
            $icon = ['ok' => '✅', 'warn' => '⚠️ ', 'fail' => '⛔'];
            out("전통발효체험관 서버 점검 — 종합: {$icon[$h['status']]} {$h['status']}  (정상 {$h['summary']['ok']} · 주의 {$h['summary']['warn']} · 위험 {$h['summary']['fail']})");
            foreach ($h['checks'] as $c) {
                out(sprintf('  %s %s %s%s', $icon[$c['status']] ?? '·', pad($c['label'], 34), is_scalar($c['value']) ? (string) $c['value'] : json_encode($c['value'], JSON_UNESCAPED_UNICODE), $c['hint'] ? "  → {$c['hint']}" : ''));
            }
            exit($h['status'] === 'fail' ? 2 : 0);
        }
        case 'users': {
            $rows = $arg !== ''
                ? Db::all("SELECT u.*, p.level FROM users u LEFT JOIN user_profiles p ON p.user_id = u.id WHERE u.nickname_key LIKE ? OR u.email LIKE ? ORDER BY u.id LIMIT 200", ['%' . mb_strtolower($arg) . '%', '%' . mb_strtolower($arg) . '%'])
                : Db::all('SELECT u.*, p.level FROM users u LEFT JOIN user_profiles p ON p.user_id = u.id ORDER BY u.id DESC LIMIT 200');
            out(sprintf('%-6s %s %s %-6s %-7s %s', '#', pad('닉네임', 14), pad('이메일', 32), '권한', '상태', '레벨'));
            foreach ($rows as $r) out(sprintf('%-6d %s %s %-6s %-7s Lv.%d', $r['id'], pad((string) $r['nickname'], 14), pad((string) $r['email'], 32), $r['role'], $r['status'], (int) ($r['level'] ?? 1)));
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
            $pw = (string) ($argv[3] ?? '');
            $generated = $pw === '';
            if ($generated) $pw = 'Tfm' . substr(strtr(base64_encode(random_bytes(12)), '+/=', 'xyz'), 0, 13) . random_int(10, 99);
            if ($e = Users::validPassword($pw, (string) $u['email'], (string) $u['nickname'])) fail($e);
            Users::update((int) $u['id'], ['password_hash' => Users::hashPassword($pw), 'password_changed_at' => Clock::ms()], true);
            Audit::log('password_reset', (int) $u['id'], ['via' => 'cli'], 'warn');
            out("✔ {$u['nickname']} 님의 비밀번호를 바꿨고 모든 기기에서 로그아웃시켰어요.");
            if ($generated) out("  새 비밀번호: $pw   (한 번만 표시돼요 — 본인에게 안전하게 전달하세요)");
            break;
        }
        case 'backup': {
            if (Db::driver() !== 'sqlite') {
                $m = (array) Config::get('db.mysql', []);
                out('MySQL/MariaDB 백업 명령:');
                out(sprintf('  mysqldump -h %s -P %d -u %s -p --single-transaction %s > fermentation_metaverse-%s.sql', $m['host'] ?? '127.0.0.1', (int) ($m['port'] ?? 3306), $m['username'] ?? 'root', $m['database'] ?? 'fermentation_metaverse', date('Ymd-His')));
                break;
            }
            $dir = $arg !== '' ? rtrim($arg, '/\\') : Config::dataDir() . '/backups';
            if (!is_dir($dir)) Config::ensureDir($dir, true);
            // unguessable name: even if a misconfigured server exposed data/, a backup cannot be fetched by guessing the date
            $file = $dir . '/tfm-' . date('Ymd-His') . '-' . bin2hex(random_bytes(6)) . '.sqlite';
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
            $n = max(1, min(500, (int) ($arg ?: 30)));
            foreach (array_reverse(Db::all("SELECT * FROM audit_log ORDER BY id DESC LIMIT $n")) as $r) {
                out(sprintf('%s  %-6s %-24s user=%s actor=%s ip=%s %s', date('Y-m-d H:i:s', intdiv((int) $r['created_at'], 1000)), $r['severity'], $r['event'], $r['user_id'] ?? '-', $r['actor_id'] ?? '-', $r['ip'], mb_substr((string) $r['detail'], 0, 160)));
            }
            break;
        }
        case 'migrate': {
            Db::pdo();
            Db::migrate();
            out('✔ 스키마 버전 ' . Db::schemaVersion() . ' (' . Db::driver() . ')');
            break;
        }
        default:
            out(trim(preg_replace('/^ \* ?/m', '', explode('*/', explode('/**', (string) file_get_contents(__FILE__), 2)[1] ?? '', 2)[0] ?? '')));
    }
} catch (ApiException $e) {
    fail($e->getMessage());
} catch (Throwable $e) {
    fail(get_class($e) . ': ' . $e->getMessage());
}
