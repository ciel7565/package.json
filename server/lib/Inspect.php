<?php
/**
 * Tfm\Inspect — developer handover & inspection for the admin site's 🧑‍💻 개발자 tab and `php cli/tfm.php inspect`
 * (CONTRACT §15.5, workflow interface 6).
 *
 *   checklist(): array                        the handover list itself (a PHP array: key => {label, hint, checks})
 *   items(): array                            the list with what handover_items says (done, note, by, at)
 *   setItem(array $actor, string $key, bool $done, string $note): array     one item (admins only, audited)
 *   run(string $source, ?array $actor): array  ONE inspection = Health::collect(deep) — the health checks, the
 *                                             configuration audit (ConfigAudit, group config), the exposure self-probe
 *                                             (probe_data, webread_*), the DB account check (Db::accountAudit, group
 *                                             dbacct) — + the versions and the handover rows; stored in inspection_runs
 *                                             (the newest KEEP_RUNS are kept), audited (inspection_run)
 *   runs(int $limit, int $offset) / get(int $id)   the stored runs, newest first / one run with its rows
 *   markdown(array $run): string             the run as a Markdown report (the download of the tab, `inspect --markdown`)
 *   docs() / doc(string $name)                the handover documents the build copies into lib/docs/ (never web-readable)
 *   environment(): array                      versions, extensions, disk use, PHP settings
 *   logTail(int $n): array                    the last $n lines of data/logs, every line redacted
 *   redact(string $s) / redactValue($v)       hide keys, tokens, passwords, cookies, e-mail addresses, phone numbers
 * The health code is reused as it is (no second copy of any check). No row ever holds a secret value: the checks only
 * say "설정됨 / 설정 안 됨", and every stored or shown string goes through redact() once more.
 * PHP 7.2 syntax only.
 */
declare(strict_types=1);

namespace Tfm;

if (!defined('TFM_BOOT')) { if (function_exists('header_remove')) header_remove('X-Powered-By'); http_response_code(404); exit; }

final class Inspect
{
    /** stored inspection runs that are kept (older ones are removed by run()) */
    public const KEEP_RUNS = 100;
    public const NOTE_MAX = 500;
    /** the group titles of the checks — the 🩺 tab, the 🧑‍💻 tab and the Markdown export use the same names */
    public const GROUPS = [
        'inspect' => '🧑‍💻 인수인계 · 버전', 'adminlock' => '🔐 관리자 페이지 잠금', 'config' => '🧾 보안 설정', 'dbacct' => '🗄️ DB 계정', 'security' => '🛡️ 보안',
        'php' => '🐘 PHP', 'db' => '🗃️ 데이터베이스', 'files' => '📁 파일·폴더', 'server' => '🖥️ 웹 서버', 'app' => '🏺 체험관',
    ];
    /** the documents the build copies into lib/docs/ (tools/build.mjs ADMIN_DOCS), in the order the tab lists them */
    public const DOCS = ['HANDOVER', 'SERVER-INSTALL-KO', 'SECURITY-REPORT-KO', 'README-SERVER', 'ARCHITECTURE'];
    private const MARK = '[가림]';

    // ------------------------------------------------------------------ the handover checklist
    /**
     * The handover list (CONTRACT §15.5 (2)): key => {label, hint (what to do, in plain words), checks (ids of related
     * inspection rows — the tab shows their state from the newest run)}.
     */
    public static function checklist(): array
    {
        $l = function (string $label, string $hint, array $checks = []): array { return ['label' => $label, 'hint' => $hint, 'checks' => $checks]; };
        return [
            'admin_2fa' => $l('관리자 계정 · 2단계 인증', '관리자를 맡을 계정을 정하고, 관리자마다 휴대폰 인증 앱(2단계 인증)을 켜요 — 관리자 센터 🔐 2단계 인증 탭. 백업 코드 10개는 종이에 적어 안전한 곳에 둬요. 모두 켰으면 config.local.php 의 security.admin_2fa 를 required 로 바꾸면 더 안전해요.', ['admin_2fa', 'admin_exists']),
            'admin_path' => $l('관리자 주소 · 접속 허용 주소', '관리자 폴더 이름을 아무도 모르는 이름으로 바꿔요 (서버 컴퓨터에서 php cli/tfm.php admin:path --random). 할 수 있으면 security.admin_ip_allowlist 에 관리자가 일하는 곳의 인터넷 주소만 넣어요.', ['admin_dir', 'admin_ip_allowlist']),
            'db_account' => $l('DB 전용 계정', 'MySQL / MariaDB 를 쓰면 체험관만 쓰는 전용 계정(읽기 · 쓰기 권한만)으로 접속해요. root 는 쓰지 않아요 — php cli/tfm.php db:account --admin-user root 가 만들어 바꿔 줘요. SQLite 를 쓰면 data 폴더가 웹에서 열리지 않는지만 봐요.', ['db_account_live', 'cfg_db_account']),
            'https_cert' => $l('HTTPS 인증서', '사이트가 https:// 로 열리고 인증서가 유효해요. 인증서가 끝나는 날을 달력에 적어 두세요 (무료 인증서는 보통 90일마다 새로 받아요).', ['https', 'cfg_force_https']),
            'toss_keys' => $l('토스 결제 키', '토스페이먼츠 개발자센터의 실제 키를 config.local.php(또는 환경 변수)에 넣었고 모의 결제(toss.mock)는 꺼져 있어요. 키를 누가 다시 발급할 수 있는지만 적고, 키 자체는 여기 적지 마세요.', ['toss_mode', 'cfg_toss_keys']),
            'claude_key' => $l('Claude API 키', 'AI 도우미를 쓰면 Anthropic 콘솔에서 만든 키를 config.local.php 의 anthropic.api_key(또는 환경 변수 ANTHROPIC_API_KEY)에만 넣어요. 쓰지 않으면 비워 두면 돼요. 콘솔에서 한 달 사용 한도도 정해 두세요.', []),
            'backup_schedule' => $l('백업 예약', '하루 한 번 백업이 저절로 만들어지게 해요: SQLite 는 Windows 작업 스케줄러에 php.exe cli\\tfm.php backup, MySQL 은 mysqldump 를 예약해요. 백업과 data/secret.php 는 다른 곳(외장 디스크 등)에도 두고, 한 번은 되살리기도 해 봐요.', ['last_backup']),
            'renew_schedule' => $l('자동 갱신 · 정리 예약', '구독 자동 갱신(php.exe cli\\tfm.php sub:renew)과 정리 작업(php.exe cli\\tfm.php cleanup)을 하루 한 번 작업 스케줄러에 예약해요.', []),
            'log_location' => $l('로그 위치', '문제가 생기면 data/logs 폴더의 app-날짜.log.php 파일을 봐요 (웹에서는 열리지 않아요). 관리자 센터 🧑‍💻 개발자 → 환경·로그 에서도 마지막 200줄을 볼 수 있어요 (비밀값은 가려져요).', ['log_dir']),
            'secret_storage' => $l('비밀키 보관', 'data/secret.php(앱 비밀키)와 config/config.local.php(DB 비밀번호 · 결제 키)는 웹에서 열리지 않는 곳에 있고, 사본은 암호를 건 USB 같은 안전한 곳에 따로 둬요. 여기에는 어디에 두었는지만 적어요. 키가 새어 나갔으면 php cli/tfm.php secret:rotate 로 바꿔요.', ['cfg_app_key', 'cfg_key_age']),
            'docs_read' => $l('인수인계 문서 읽기', '📚 문서의 인수인계 안내(HANDOVER) · 서버 설치 안내 · 보안 보고서를 읽어요. 모르는 말은 보안 보고서의 "용어 풀이"에 있어요.', ['docs']),
            'contacts' => $l('연락처 · 담당자', '서버 · 도메인 · 결제 · AI 서비스 계정의 주인과 물어볼 사람의 연락처를 정리해 둬요 (비밀번호는 적지 않아요).', []),
            // [allot-admin] CONTRACT §16.7: the 분양 automation and its customers' personal data
            'allot_schedule' => $l('분양 자동화 예약 · 개인정보', '분양(항아리 · 밭 · 창고)을 쓰면 Windows 작업 스케줄러에 한 시간마다 php.exe cli\\tfm.php allot:tick 을 예약해요 (예약이 없어도 관리자 페이지를 열 때 조금씩 돌지만, 밤에는 멈춰요). 관리자 센터 🏺 분양 관리 → 자동화 에서 약관 · 개인정보 안내 · 환불 규정의 "예시" 글을 실제 글로 바꾸고 법률 검토를 받아요. 고객 이름 · 전화번호를 보는 관리자는 꼭 필요한 사람만 정해요.', ['allot_schema', 'allot_units', 'allot_tick', 'allot_integrity']),
        ];
    }

    /** the checklist with handover_items: [{key, label, hint, checks, done, note, by, byNick, at}] in list order */
    public static function items(): array
    {
        $rows = [];
        try {
            foreach (Db::all('SELECT h.k, h.done, h.note, h.updated_by, h.updated_at, u.nickname FROM handover_items h LEFT JOIN users u ON u.id = h.updated_by') as $r) $rows[(string) $r['k']] = $r;
        } catch (\Throwable $e) {
            $rows = []; // a database without the v6 tables yet: every item open
        }
        $out = [];
        foreach (self::checklist() as $k => $it) {
            $r = isset($rows[$k]) ? $rows[$k] : null;
            $out[] = $it + [
                'key' => $k, 'done' => $r !== null && (int) $r['done'] === 1, 'note' => $r !== null && $r['note'] !== null ? (string) $r['note'] : '',
                'by' => $r !== null && $r['updated_by'] !== null ? (int) $r['updated_by'] : null, 'byNick' => $r !== null && $r['nickname'] !== null ? (string) $r['nickname'] : '',
                'at' => $r !== null ? (int) $r['updated_at'] : 0,
            ];
        }
        return $out;
    }

    /**
     * Tick / untick one item with a note (≤ NOTE_MAX characters; cleaned, and a key or password pasted into it is hidden
     * — the note says where a secret is kept, never the secret). 403 FORBIDDEN for a non-admin, 400 INVALID_INPUT for
     * a key that is not on the list or a long note. Audit handover_item_changed. Returns the item as items() shows it.
     */
    public static function setItem(array $actor, string $key, bool $done, string $note): array
    {
        if ((isset($actor['role']) ? $actor['role'] : '') !== 'admin') throw new ApiException(403, 'FORBIDDEN', '관리자 권한이 필요해요.');
        if (!isset(self::checklist()[$key])) V::fail('key', '인수인계 체크리스트에 없는 항목이에요.');
        V::str($note, 'note', self::NOTE_MAX);
        $clean = mb_substr(self::redact(Users::cleanText($note, self::NOTE_MAX)), 0, self::NOTE_MAX);
        $uid = (int) (isset($actor['id']) ? $actor['id'] : 0);
        Db::upsert('handover_items', ['k' => $key, 'done' => $done ? 1 : 0, 'note' => $clean, 'updated_by' => $uid > 0 ? $uid : null, 'updated_at' => Clock::ms()], ['k']);
        Audit::log('handover_item_changed', null, ['key' => $key, 'done' => $done, 'noteChars' => mb_strlen($clean)], 'info', $uid > 0 ? $uid : null);
        foreach (self::items() as $it) if ($it['key'] === $key) return $it;
        throw new \RuntimeException('handover item vanished');
    }

    // ------------------------------------------------------------------ one inspection
    /**
     * Run every check once and store it. $source: 'admin' (the 🧑‍💻 tab) | 'cli' (`php cli/tfm.php inspect`).
     * @return array {id, createdAt, source, actorId, status ok|warn|fail, summary {ok, warn, fail}, text, versions, checks}
     */
    public static function run(string $source, ?array $actor): array
    {
        $source = preg_match('/^[a-z]{1,10}$/', $source) ? $source : 'admin';
        $now = Clock::ms();
        $checks = [];
        try {
            $hc = Health::collect(true, AdminGate::htaccessSeen(), true);
            foreach ($hc['checks'] as $c) if (is_array($c)) $checks[] = self::row($c);
        } catch (\Throwable $e) {
            Log::error('INSPECT', 'health checks failed: ' . get_class($e));
            $checks[] = ['group' => 'inspect', 'id' => 'health', 'label' => '시스템 점검', 'status' => 'fail', 'value' => '실행하지 못함', 'hint' => '점검하는 중에 문제가 생겼어요. data/logs 의 오늘 로그를 확인하세요.'];
        }
        foreach (self::ownChecks() as $c) $checks[] = $c;
        foreach (self::allotChecks() as $c) $checks[] = $c; // [allot-admin]
        $result = self::redactValue(['versions' => self::versions(), 'checks' => $checks]);
        $sum = ['ok' => 0, 'warn' => 0, 'fail' => 0];
        foreach ($result['checks'] as $c) $sum[$c['status']]++;
        $status = $sum['fail'] > 0 ? 'fail' : ($sum['warn'] > 0 ? 'warn' : 'ok');
        $text = self::summaryText($sum, $result['checks']);
        $actorId = $actor !== null && isset($actor['id']) && (int) $actor['id'] > 0 ? (int) $actor['id'] : null;
        $json = json_encode($result, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PARTIAL_OUTPUT_ON_ERROR | JSON_INVALID_UTF8_SUBSTITUTE);
        $id = Db::insert('inspection_runs', ['created_at' => $now, 'actor_id' => $actorId, 'source' => $source, 'status' => $status, 'ok_count' => $sum['ok'],
            'warn_count' => $sum['warn'], 'fail_count' => $sum['fail'], 'summary' => $text, 'result' => is_string($json) ? $json : '{}']);
        $cut = Db::value('SELECT id FROM inspection_runs ORDER BY id DESC LIMIT 1 OFFSET ?', [self::KEEP_RUNS - 1]);
        if ($cut !== null) Db::exec('DELETE FROM inspection_runs WHERE id < ?', [(int) $cut]);
        Audit::log('inspection_run', null, ['id' => $id, 'source' => $source, 'status' => $status] + $sum, 'info', $actorId);
        return ['id' => $id, 'createdAt' => $now, 'source' => $source, 'actorId' => $actorId, 'actorNick' => $actor !== null && isset($actor['nickname']) ? (string) $actor['nickname'] : '',
            'status' => $status, 'summary' => $sum, 'text' => $text, 'versions' => $result['versions'], 'checks' => $result['checks']];
    }

    /** a Health row with every field a string and a known status */
    private static function row(array $c): array
    {
        $v = isset($c['value']) ? $c['value'] : '';
        return [
            'group' => (string) (isset($c['group']) ? $c['group'] : 'app'), 'id' => (string) (isset($c['id']) ? $c['id'] : ''), 'label' => (string) (isset($c['label']) ? $c['label'] : ''),
            'status' => isset($c['status']) && in_array($c['status'], ['ok', 'warn', 'fail'], true) ? (string) $c['status'] : 'warn',
            'value' => is_scalar($v) || $v === null ? (string) $v : (string) json_encode($v, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PARTIAL_OUTPUT_ON_ERROR),
            'hint' => (string) (isset($c['hint']) ? $c['hint'] : ''),
        ];
    }

    /** the rows only this inspection adds (group inspect): app version, the documents, the checklist, the backup, the log folder */
    private static function ownChecks(): array
    {
        $rows = [];
        $add = function (string $id, string $label, string $status, string $value, string $hint = '') use (&$rows): void {
            $rows[] = ['group' => 'inspect', 'id' => $id, 'label' => $label, 'status' => $status, 'value' => $value, 'hint' => $hint];
        };
        $add('app_version', '앱 버전', 'ok', TFM_VERSION . ' · 스키마 ' . Db::SCHEMA_VERSION);
        $n = count(self::docs());
        $add('docs', '인수인계 문서 (lib/docs)', $n >= count(self::DOCS) ? 'ok' : 'warn', $n . '개',
            $n >= count(self::DOCS) ? '' : ($n === 0 ? '문서 폴더가 없어요. 배포 zip 의 metaverse 폴더나 node tools/build.mjs 로 만든 서버 사본에는 들어 있어요 (원본은 저장소의 docs/ 폴더).' : '문서가 일부만 있어요. 배포본의 lib/docs 폴더를 다시 올려 주세요.'));
        $items = self::items();
        $done = count(array_filter($items, function ($i) { return $i['done']; }));
        $all = $done === count($items);
        $add('handover', '인수인계 체크리스트', $all ? 'ok' : 'warn', $done . ' / ' . count($items) . ' 완료', $all ? '' : '관리자 센터 🧑‍💻 개발자 → 인수인계 체크리스트에서 남은 항목을 하나씩 확인하고 표시하세요.');
        $backupDone = false;
        foreach ($items as $i) if ($i['key'] === 'backup_schedule') $backupDone = $i['done'];
        if (Db::driverSafe() === 'sqlite') {
            $newest = 0;
            foreach (glob(Config::dataDir() . DIRECTORY_SEPARATOR . 'backups' . DIRECTORY_SEPARATOR . '*.sqlite') ?: [] as $f) $newest = max($newest, (int) @filemtime($f));
            $age = $newest > 0 ? max(0, time() - $newest) : -1;
            $fresh = $newest > 0 && $age <= 7 * 86400;
            $add('last_backup', '마지막 백업 (SQLite)', $fresh ? 'ok' : 'warn', $newest > 0 ? date('Y-m-d H:i', $newest) . ' · ' . intdiv($age, 86400) . '일 전' : '없음',
                $fresh ? '' : '서버 컴퓨터에서 php cli/tfm.php backup 을 실행하면 data/backups 에 사본이 생겨요. Windows 작업 스케줄러에 하루 한 번 예약하세요.');
        } else {
            $add('last_backup', '백업 (MySQL / MariaDB)', $backupDone ? 'ok' : 'warn', $backupDone ? '체크리스트에 예약했다고 표시됨' : '서버에서는 알 수 없음',
                $backupDone ? '' : 'mysqldump 백업을 하루 한 번 예약하고, 인수인계 체크리스트의 "백업 예약"에 표시하세요.');
        }
        $logs = self::dirSize(Log::dir(), 5000);
        $add('log_dir', '로그 폴더 (data/logs)', $logs['bytes'] < 200 * 1048576 ? 'ok' : 'warn', self::bytesText($logs['bytes']) . ' · 파일 ' . $logs['files'] . '개',
            $logs['bytes'] < 200 * 1048576 ? '' : '로그가 많이 쌓였어요. 관리자 센터 🧰 유지보수 → 정리하기를 누르면 오래된 로그가 지워져요.');
        return $rows;
    }

    // [allot-admin] ---------------------------------------------------- the 분양 rows (CONTRACT §16.7: schema v7, seeded units, tick age, integrity)
    /** the allot rows (group app); a site without the allot tables or without Tfm\Allot gets one calm warning instead of an error */
    private static function allotChecks(): array
    {
        $rows = [];
        $add = function (string $id, string $label, string $status, string $value, string $hint = '') use (&$rows): void {
            $rows[] = ['group' => 'app', 'id' => $id, 'label' => $label, 'status' => $status, 'value' => $value, 'hint' => $hint];
        };
        try {
            $have = Db::schemaVersion();
        } catch (\Throwable $e) {
            $have = 0;
        }
        $schemaOk = $have >= 7 && class_exists('Tfm\\Allot');
        $add('allot_schema', '분양 데이터 (스키마 v7)', $schemaOk ? 'ok' : 'warn', '스키마 ' . $have . ' / 필요 7',
            $schemaOk ? '' : '분양 표가 아직 없어요. 서버 컴퓨터에서 php cli/tfm.php migrate 를 실행하거나 install.php 로 업데이트하세요.');
        if (!$schemaOk) return $rows;
        try {
            $on = Allot::enabled();
            $sum = Allot::summary();
            $total = (int) $sum['total'];
            $add('allot_units', '분양 단위 (항아리 · 밭 · 창고)', $total > 0 ? 'ok' : ($on ? 'warn' : 'ok'),
                number_format($total) . '개 · 임대 ' . number_format((int) $sum['leased']) . ' · 빈 자리 ' . number_format((int) $sum['open']) . ($on ? '' : ' · 분양 꺼짐'),
                $total > 0 ? '' : '아직 만든 자리가 없어요. php cli/tfm.php allot:seed 를 실행하거나 관리자 센터 🏺 분양 관리 → 구역 에서 기본 1만 개를 만드세요.');
            $last = Allot::lastTickAt();
            $age = $last > 0 ? max(0, intdiv(Clock::ms() - $last, 1000)) : -1;
            $fresh = $last > 0 && $age <= 3 * 3600;
            $add('allot_tick', '분양 자동화 마지막 실행', !$on || $fresh ? 'ok' : ($last > 0 && $age <= 3 * 86400 ? 'warn' : ($total > 0 ? 'fail' : 'warn')),
                $last > 0 ? date('Y-m-d H:i', intdiv($last, 1000)) . ' · ' . ($age < 3600 ? intdiv($age, 60) . '분 전' : ($age < 172800 ? intdiv($age, 3600) . '시간 전' : intdiv($age, 86400) . '일 전')) : '아직 없음',
                !$on || $fresh ? '' : '작업 스케줄러에 한 시간마다 php.exe cli\\tfm.php allot:tick 을 예약하세요. 지금 한 번 돌리려면 관리자 센터 🏺 분양 관리 → 자동화 → 지금 실행.');
            $int = Allot::integrity(200, false);
            $n = count($int['issues']);
            $kinds = [];
            foreach ($int['issues'] as $i) $kinds[(string) $i['kind']] = isset($kinds[(string) $i['kind']]) ? $kinds[(string) $i['kind']] + 1 : 1;
            $txt = [];
            foreach ($kinds as $k => $c) $txt[] = $k . ' ' . $c;
            $add('allot_integrity', '분양 자리 ↔ 계약 맞춤', $n === 0 ? 'ok' : 'warn', $n === 0 ? '어긋난 곳 없음' : $n . '곳 (' . implode(', ', array_slice($txt, 0, 6)) . ')',
                $n === 0 ? '' : '자동화가 돌 때 안전한 것은 저절로 고쳐요. 남은 것은 🏺 분양 관리 → 자동화 의 "직접 확인이 필요한 항목"에서 하나씩 확인하세요 (환불할 돈이 남은 취소 계약 등).');
            $texts = Allot::texts();
            if ($on && !empty($texts['sample'])) {
                $add('allot_texts', '분양 약관 · 안내 글', 'warn', '예시 글 사용 중', '🏺 분양 관리 → 자동화 에서 약관 · 개인정보 안내 · 환불 규정을 실제 글로 바꾸고 법률 검토를 받으세요.');
            }
        } catch (\Throwable $e) {
            Log::error('INSPECT', 'allot checks failed: ' . get_class($e));
            $add('allot_units', '분양 점검', 'warn', '확인하지 못함', '분양 표를 읽는 중에 문제가 생겼어요. data/logs 의 오늘 로그를 확인하세요.');
        }
        return $rows;
    }

    /** the versions of this server (app, PHP, OS, database, schema, game data, web server) */
    private static function versions(): array
    {
        $gd = GameData::exportedAt();
        $v = ['app' => TFM_VERSION, 'php' => PHP_VERSION . ' (' . PHP_SAPI . ')', 'os' => PHP_OS_FAMILY . ' · ' . (PHP_INT_SIZE * 8) . '비트', 'db' => '', 'schema' => '',
            'gameData' => $gd !== '' ? $gd : '없음', 'server' => PHP_SAPI === 'cli' ? '명령줄(CLI)' : mb_substr((string) (isset($_SERVER['SERVER_SOFTWARE']) ? $_SERVER['SERVER_SOFTWARE'] : PHP_SAPI), 0, 80)];
        try {
            $v['db'] = strtoupper(Db::driver()) . ' ' . (string) Db::pdo()->getAttribute(\PDO::ATTR_SERVER_VERSION);
            $v['schema'] = Db::schemaVersion() . ' / ' . Db::SCHEMA_VERSION;
        } catch (\Throwable $e) {
            $v['db'] = strtoupper(Db::driverSafe()) . ' (연결 실패)';
            $v['schema'] = '? / ' . Db::SCHEMA_VERSION;
        }
        return $v;
    }

    /** "정상 40 · 주의 3 · 위험 1 — 위험: …" */
    private static function summaryText(array $sum, array $checks): string
    {
        $t = '정상 ' . $sum['ok'] . ' · 주의 ' . $sum['warn'] . ' · 위험 ' . $sum['fail'];
        $bad = [];
        foreach ($checks as $c) if ($c['status'] === 'fail') $bad[] = $c['label'];
        return mb_substr($t . ($bad ? ' — 위험: ' . implode(', ', $bad) : ''), 0, 1000);
    }

    // ------------------------------------------------------------------ stored runs
    /** the stored runs, newest first: [{id, createdAt, source, status, ok, warn, fail, summary, actorId, actorNick}] */
    public static function runs(int $limit, int $offset): array
    {
        $rows = Db::all('SELECT r.id, r.created_at, r.actor_id, r.source, r.status, r.ok_count, r.warn_count, r.fail_count, r.summary, u.nickname
            FROM inspection_runs r LEFT JOIN users u ON u.id = r.actor_id ORDER BY r.id DESC LIMIT ? OFFSET ?', [max(1, min(200, $limit)), max(0, min(100000, $offset))]);
        return array_map(function ($r) {
            return ['id' => (int) $r['id'], 'createdAt' => (int) $r['created_at'], 'source' => (string) $r['source'], 'status' => (string) $r['status'],
                'ok' => (int) $r['ok_count'], 'warn' => (int) $r['warn_count'], 'fail' => (int) $r['fail_count'], 'summary' => (string) $r['summary'],
                'actorId' => $r['actor_id'] === null ? null : (int) $r['actor_id'], 'actorNick' => $r['nickname'] === null ? '' : (string) $r['nickname']];
        }, $rows);
    }

    /** one stored run with its versions and rows (the same shape run() returned), null when there is none */
    public static function get(int $id): ?array
    {
        if ($id <= 0) return null;
        $r = Db::one('SELECT r.id, r.created_at, r.actor_id, r.source, r.status, r.ok_count, r.warn_count, r.fail_count, r.summary, r.result, u.nickname
            FROM inspection_runs r LEFT JOIN users u ON u.id = r.actor_id WHERE r.id = ?', [$id]);
        if (!$r) return null;
        $res = Json::tryDecode((string) $r['result'], true);
        $res = is_array($res) ? $res : [];
        $checks = [];
        foreach (isset($res['checks']) && is_array($res['checks']) ? $res['checks'] : [] as $c) if (is_array($c)) $checks[] = self::row($c);
        return ['id' => (int) $r['id'], 'createdAt' => (int) $r['created_at'], 'source' => (string) $r['source'], 'actorId' => $r['actor_id'] === null ? null : (int) $r['actor_id'],
            'actorNick' => $r['nickname'] === null ? '' : (string) $r['nickname'], 'status' => (string) $r['status'],
            'summary' => ['ok' => (int) $r['ok_count'], 'warn' => (int) $r['warn_count'], 'fail' => (int) $r['fail_count']], 'text' => (string) $r['summary'],
            'versions' => isset($res['versions']) && is_array($res['versions']) ? array_map('strval', $res['versions']) : [], 'checks' => $checks];
    }

    // ------------------------------------------------------------------ the Markdown report
    private const STATUS_MD = ['ok' => '✅ 정상', 'warn' => '⚠️ 주의', 'fail' => '⛔ 위험'];
    private const VERSION_LABELS = ['app' => '앱', 'php' => 'PHP', 'os' => '운영체제', 'db' => '데이터베이스', 'schema' => '스키마 (지금 / 필요)', 'gameData' => '체험 데이터', 'server' => '웹 서버'];

    /** one table cell: one line, & < > as entities, | escaped (a Markdown viewer never sees markup or a broken row) */
    private static function cell($v): string
    {
        $s = is_scalar($v) || $v === null ? (string) $v : (string) json_encode($v, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PARTIAL_OUTPUT_ON_ERROR);
        $s = trim(preg_replace('/\s+/u', ' ', $s) ?: '');
        return str_replace(['&', '<', '>', '|'], ['&amp;', '&lt;', '&gt;', '\\|'], $s);
    }

    /** the run as a Markdown report: title, time, source, result, the versions table, one table per group */
    public static function markdown(array $run): string
    {
        $sum = isset($run['summary']) && is_array($run['summary']) ? $run['summary'] : ['ok' => 0, 'warn' => 0, 'fail' => 0];
        $st = isset(self::STATUS_MD[(string) $run['status']]) ? self::STATUS_MD[(string) $run['status']] : (string) $run['status'];
        $who = (string) $run['source'] === 'cli' ? '서버 명령 (php cli/tfm.php inspect)' : '관리자 센터' . (isset($run['actorNick']) && $run['actorNick'] !== '' ? ' — ' . self::cell($run['actorNick']) : '');
        $md = '# 서버 점검 보고서 #' . (int) $run['id'] . "\n\n"
            . '- 시각: ' . date('Y-m-d H:i:s', intdiv((int) $run['createdAt'], 1000)) . ' (' . date_default_timezone_get() . ")\n"
            . '- 실행: ' . $who . "\n"
            . '- 결과: ' . $st . ' · 정상 ' . (int) $sum['ok'] . ' · 주의 ' . (int) $sum['warn'] . ' · 위험 ' . (int) $sum['fail'] . "\n\n"
            . "## 버전\n\n| 항목 | 값 |\n|---|---|\n";
        foreach (isset($run['versions']) && is_array($run['versions']) ? $run['versions'] : [] as $k => $v) {
            $md .= '| ' . self::cell(isset(self::VERSION_LABELS[$k]) ? self::VERSION_LABELS[$k] : $k) . ' | ' . self::cell($v) . " |\n";
        }
        $byGroup = [];
        foreach (isset($run['checks']) && is_array($run['checks']) ? $run['checks'] : [] as $c) $byGroup[isset(self::GROUPS[$c['group']]) ? $c['group'] : '?'][] = $c;
        foreach (self::GROUPS + ['?' => '기타'] as $g => $title) {
            if (empty($byGroup[$g])) continue;
            $md .= "\n## " . $title . "\n\n| 항목 | 상태 | 값 | 안내 |\n|---|---|---|---|\n";
            foreach ($byGroup[$g] as $c) {
                $md .= '| ' . self::cell($c['label']) . ' | ' . (isset(self::STATUS_MD[$c['status']]) ? self::STATUS_MD[$c['status']] : self::cell($c['status'])) . ' | '
                    . self::cell($c['value']) . ' | ' . self::cell($c['hint']) . " |\n";
            }
        }
        return $md . "\n---\n\n⛔ 위험은 바로 고쳐야 하는 것, ⚠️ 주의는 고치면 더 안전해지는 것이에요. 이 보고서에는 비밀번호나 키 값이 들어 있지 않아요 (설정됨 / 설정 안 됨만 적혀요).\n";
    }

    // ------------------------------------------------------------------ the handover documents (lib/docs/)
    public static function docsDir(): string { return TFM_ROOT . DIRECTORY_SEPARATOR . 'lib' . DIRECTORY_SEPARATOR . 'docs'; }

    /** the Markdown files of lib/docs/: [{name, file, title, bytes, mtime}] — the DOCS order first, then by name */
    public static function docs(): array
    {
        $dir = self::docsDir();
        $real = realpath($dir);
        if ($real === false || !is_dir($real)) return [];
        $out = [];
        foreach (scandir($real) ?: [] as $f) {
            if (!preg_match('/^([A-Za-z0-9][A-Za-z0-9._\-]{0,80})\.md$/', $f, $m)) continue;
            $path = $real . DIRECTORY_SEPARATOR . $f;
            $rp = realpath($path);
            if ($rp === false || !is_file($rp) || dirname($rp) !== $real) continue; // no link out of the folder
            $head = (string) @file_get_contents($rp, false, null, 0, 4096);
            $title = preg_match('/^#{1,3}[ ]+(.+)$/mu', $head, $t) ? trim($t[1]) : $m[1];
            $out[] = ['name' => $m[1], 'file' => $f, 'title' => mb_substr($title, 0, 140), 'bytes' => (int) filesize($rp), 'mtime' => (int) filemtime($rp)];
        }
        $rank = array_flip(self::DOCS);
        usort($out, function ($a, $b) use ($rank) {
            $ra = isset($rank[$a['name']]) ? $rank[$a['name']] : 99;
            $rb = isset($rank[$b['name']]) ? $rank[$b['name']] : 99;
            return $ra === $rb ? strcmp($a['name'], $b['name']) : $ra - $rb;
        });
        return $out;
    }

    /** one document by its name (only a name docs() lists): {name, title, bytes, mtime, md} or null */
    public static function doc(string $name): ?array
    {
        foreach (self::docs() as $d) {
            if ($d['name'] !== $name) continue;
            $md = @file_get_contents(self::docsDir() . DIRECTORY_SEPARATOR . $d['file'], false, null, 0, Markdown::MAX_BYTES);
            return is_string($md) ? $d + ['md' => $md] : null;
        }
        return null;
    }

    // ------------------------------------------------------------------ environment
    /** {bytes, files, capped} of a folder (at most $max files are looked at; links are not followed) */
    public static function dirSize(string $dir, int $max = 20000): array
    {
        $bytes = 0;
        $files = 0;
        $capped = false;
        if (!is_dir($dir)) return ['bytes' => 0, 'files' => 0, 'capped' => false];
        try {
            $it = new \RecursiveIteratorIterator(new \RecursiveDirectoryIterator($dir, \FilesystemIterator::SKIP_DOTS), \RecursiveIteratorIterator::LEAVES_ONLY);
            foreach ($it as $f) {
                if ($files >= $max) { $capped = true; break; }
                if ($f->isLink() || !$f->isFile()) continue;
                $bytes += (int) $f->getSize();
                $files++;
            }
        } catch (\Throwable $e) {
            $capped = true;
        }
        return ['bytes' => $bytes, 'files' => $files, 'capped' => $capped];
    }

    public static function bytesText(int $n): string
    {
        if ($n >= 1073741824) return round($n / 1073741824, 2) . ' GB';
        if ($n >= 1048576) return round($n / 1048576, 1) . ' MB';
        if ($n >= 1024) return round($n / 1024) . ' KB';
        return $n . ' B';
    }

    /** {versions:[{label, value}], extensions:[{name, loaded, required, why, version}], loaded:[names], disk:[{label, bytes, files, capped}], ini:[{label, value}]} */
    public static function environment(): array
    {
        $v = self::versions();
        $versions = [];
        foreach ($v as $k => $x) $versions[] = ['label' => isset(self::VERSION_LABELS[$k]) ? self::VERSION_LABELS[$k] : $k, 'value' => (string) $x];
        $versions[] = ['label' => '시간대', 'value' => date_default_timezone_get() . ' · ' . date('Y-m-d H:i:s')];
        $ext = [];
        foreach (Health::extensions(Db::driverSafe()) as $row) {
            $ver = extension_loaded($row[0]) ? phpversion($row[0]) : false;
            $ext[] = ['name' => (string) $row[0], 'loaded' => extension_loaded($row[0]), 'required' => (bool) $row[1], 'why' => (string) $row[2], 'version' => is_string($ver) ? $ver : ''];
        }
        $loaded = get_loaded_extensions();
        sort($loaded, SORT_STRING | SORT_FLAG_CASE);
        $disk = [];
        $data = self::dirSize(Config::dataDir());
        $disk[] = ['label' => 'data 폴더 (DB · 세션 · 로그 · 백업)', 'bytes' => $data['bytes'], 'files' => $data['files'], 'capped' => $data['capped']];
        $logs = self::dirSize(Log::dir());
        $disk[] = ['label' => '로그 (data/logs)', 'bytes' => $logs['bytes'], 'files' => $logs['files'], 'capped' => $logs['capped']];
        $up = self::dirSize(Config::uploadDir());
        $disk[] = ['label' => '올린 사진 (uploads)', 'bytes' => $up['bytes'], 'files' => $up['files'], 'capped' => $up['capped']];
        if (Db::driverSafe() === 'sqlite') {
            try { $f = Db::dbFilePath(); $disk[] = ['label' => 'DB 파일 (SQLite)', 'bytes' => is_file($f) ? (int) filesize($f) : 0, 'files' => 1, 'capped' => false]; } catch (\Throwable $e) { /* no file */ }
        }
        $free = @disk_free_space(Config::dataDir());
        if ($free !== false) $disk[] = ['label' => '남은 디스크 (data 폴더가 있는 곳)', 'bytes' => (int) $free, 'files' => 0, 'capped' => false];
        $ini = [];
        foreach (['memory_limit', 'upload_max_filesize', 'post_max_size', 'max_execution_time', 'max_file_uploads', 'session.save_handler', 'date.timezone', 'opcache.enable', 'allow_url_fopen'] as $k) {
            $x = ini_get($k);
            $ini[] = ['label' => $k, 'value' => $x === false ? '(없음)' : (string) $x];
        }
        $de = get_cfg_var('display_errors');
        $ini[] = ['label' => 'display_errors (php.ini)', 'value' => $de === false ? '(기본)' : (string) $de];
        return ['versions' => $versions, 'extensions' => $ext, 'loaded' => $loaded, 'disk' => $disk, 'ini' => $ini];
    }

    // ------------------------------------------------------------------ the log tail
    /**
     * The last $n lines (1…1000) of data/logs/app-*.log.php, oldest first / newest last, across files (today's file,
     * its rotated parts, older days). The PHP guard line is skipped; a JSON line becomes {t, lvl, cat, msg, ctx, rid, ip
     * (last part hidden), file}, any other line keeps its text in msg; every value is redacted. The text is NOT
     * HTML-escaped here (the page escapes it with e()).
     */
    public static function logTail(int $n = 200): array
    {
        $n = max(1, min(1000, $n));
        $files = [];
        foreach (glob(Log::dir() . DIRECTORY_SEPARATOR . 'app-*.log.php') ?: [] as $f) {
            if (!preg_match('/app-(\d{4}-\d{2}-\d{2})(?:\.(\d{1,3}))?\.log\.php$/', $f, $m)) continue;
            $files[] = ['path' => $f, 'day' => $m[1], 'part' => isset($m[2]) && $m[2] !== '' ? (int) $m[2] : 1000];
        }
        // newest first: the day, then the current file (no number), then the higher rotation numbers
        usort($files, function ($a, $b) { return $a['day'] === $b['day'] ? $b['part'] - $a['part'] : strcmp($b['day'], $a['day']); });
        $lines = [];
        foreach ($files as $f) {
            $want = $n - count($lines);
            if ($want <= 0) break;
            $chunk = [];
            foreach (self::tailLines($f['path'], $want) as $l) $chunk[] = [$l, basename($f['path'])];
            $lines = array_merge($chunk, $lines);
        }
        $lines = array_slice($lines, -$n);
        $out = [];
        foreach ($lines as $l) $out[] = self::logEntry($l[0], $l[1]);
        return $out;
    }

    /** the last $want lines of one file (no guard line, no empty lines), oldest first — read backwards, at most 8 MB */
    private static function tailLines(string $path, int $want): array
    {
        $fh = @fopen($path, 'rb');
        if (!$fh) return [];
        $size = (int) @filesize($path);
        $pos = $size;
        $buf = '';
        $limit = min($size, 8388608);
        while ($pos > 0 && substr_count($buf, "\n") <= $want && $size - $pos < $limit) {
            $step = (int) min(65536, $pos);
            $pos -= $step;
            fseek($fh, $pos);
            $buf = (string) fread($fh, $step) . $buf;
        }
        fclose($fh);
        $all = explode("\n", $buf);
        if ($pos > 0) array_shift($all); // a cut first line
        $out = [];
        foreach ($all as $l) {
            if (trim($l) === '' || strpos($l, '<?php') === 0) continue;
            $out[] = $l;
        }
        return array_slice($out, -$want);
    }

    private static function logEntry(string $line, string $file): array
    {
        $j = strlen($line) <= 65536 ? Json::tryDecode($line, true) : null;
        if (!is_array($j) || !isset($j['msg'])) {
            return ['t' => '', 'lvl' => '', 'cat' => '', 'msg' => self::plain(self::redact(mb_substr($line, 0, 2000))), 'ctx' => '', 'rid' => '', 'ip' => '', 'file' => $file];
        }
        $ctx = isset($j['ctx']) && $j['ctx'] !== null ? self::redactValue($j['ctx']) : null;
        $ctxText = $ctx === null ? '' : (string) json_encode($ctx, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PARTIAL_OUTPUT_ON_ERROR | JSON_INVALID_UTF8_SUBSTITUTE);
        $s = function ($k) use ($j): string { return isset($j[$k]) && is_scalar($j[$k]) ? (string) $j[$k] : ''; };
        return ['t' => self::plain(mb_substr($s('t'), 0, 40)), 'lvl' => self::plain(mb_substr($s('lvl'), 0, 12)), 'cat' => self::plain(mb_substr($s('cat'), 0, 24)),
            'msg' => self::plain(self::redact(mb_substr($s('msg'), 0, 2000))), 'ctx' => self::plain(mb_substr($ctxText, 0, 2000)), 'rid' => self::plain(mb_substr($s('rid'), 0, 16)),
            'ip' => self::maskIp($s('ip')), 'file' => $file];
    }

    /** control and bidi characters become "?" (a line can never steer a terminal or flip the text around) */
    private static function plain(string $s): string
    {
        if (!mb_check_encoding($s, 'UTF-8')) $s = (string) mb_convert_encoding($s, 'UTF-8', 'UTF-8');
        $r = preg_replace('/[\x{0}-\x{8}\x{B}-\x{1F}\x{7F}-\x{9F}\x{200E}\x{200F}\x{2028}\x{2029}\x{202A}-\x{202E}\x{2066}-\x{2069}]/u', '?', $s);
        return is_string($r) ? $r : '';
    }

    /** 203.0.113.• / 2001:db8:1:• — the last part hidden */
    private static function maskIp(string $ip): string
    {
        $n = Http::normIp($ip);
        if ($n === '') return $ip === '' ? '' : '•';
        if (strpos($n, ':') === false) { $p = explode('.', $n); return $p[0] . '.' . $p[1] . '.' . $p[2] . '.•'; }
        return implode(':', array_slice(explode(':', $n), 0, 3)) . ':•';
    }

    // ------------------------------------------------------------------ redaction
    /** words whose value is never shown (a key may have a prefix: db_password, adminPassword; "tokens" is not "token") */
    private const SECRET_WORDS = 'pass(?:word|wd|phrase)?|pwd|secret(?:[_\-]?key)?|api[_\-]?key|apikey|access[_\-]?key|private[_\-]?key|(?:access|refresh|id|auth|csrf)?[_\-]?token|authorization|cookie|sess(?:ion)?(?:[_\-]?id)?|sessid|_?csrf|billing[_\-]?key|billingkey|payment[_\-]?key|paymentkey|app[_\-]?key|data[_\-]?key|otp|totp[_\-]?secret|backup[_\-]?codes?|setup[_\-]?code|signature';

    /** hide keys, tokens, passwords, cookies, sessions, private keys, sealed values, e-mail addresses and phone numbers */
    public static function redact(string $s): string
    {
        if ($s === '') return $s;
        if (!mb_check_encoding($s, 'UTF-8')) $s = (string) mb_convert_encoding($s, 'UTF-8', 'UTF-8');
        $m = self::MARK;
        $w = self::SECRET_WORDS;
        $rules = [
            // private key blocks, header lines, "Bearer …"
            ['/-----BEGIN [A-Z ]*PRIVATE KEY-----.*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/s', '[가림:비밀키]'],
            ['/\b((?:proxy-)?authorization|cookie|set-cookie|x-api-key|x-csrf-token|x-auth-token)([ \t]*:[ \t]*)[^\r\n]+/i', '$1$2' . $m],
            ['/\b(Bearer|Basic|Token)[ \t]+[A-Za-z0-9._~+\/=\-]{8,}/', '$1 ' . $m],
            // "key": "value" / 'key': 'value' / key=value / key: value
            ['/(["\'])([A-Za-z0-9_\-]*(?:' . $w . '))(?![A-Za-z])\1(\s*:\s*)("(?:[^"\\\\]|\\\\.)*"|\'(?:[^\'\\\\]|\\\\.)*\'|[^,}\]\s]+)/i', '$1$2$1$3"' . $m . '"'],
            // (a colon counts only with a space or a quote after it: "secret:rotate" is a command name, not a value)
            ['/(?<![A-Za-z0-9_\-])([A-Za-z0-9_\-]*(?:' . $w . '))(?![A-Za-z])(\s*=\s*|\s*:[ \t]+|\s*:(?=["\']))("[^"]*"|\'[^\']*\'|[^\s&;,"\'}\]]+)/i', '$1$2' . $m],
            // provider keys and token shapes
            ['/\bsk-ant-[A-Za-z0-9_\-]{6,}/', $m],
            ['/\bsk-[A-Za-z0-9_\-]{20,}/', $m],
            ['/\b(?:live|test)_(?:sk|ck|gsk|gck|ak|bk|hk)_[A-Za-z0-9_]{6,}/', $m],
            ['/\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{10,}/', $m],
            ['/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/', $m],
            ['/\bAIza[0-9A-Za-z_\-]{30,}/', $m],
            ['/\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})/', $m],
            ['/\bxox[abprs]-[A-Za-z0-9\-]{10,}/', $m],
            ['/\beyJ[A-Za-z0-9_\-]{6,}\.[A-Za-z0-9_\-]{6,}\.[A-Za-z0-9_\-]{6,}/', $m],
            ['/\benc:v1:[A-Za-z0-9+\/=_\-]{8,}/', $m],
            ['/\b(TFMSESSID|TFMADM|TFMADMP|PHPSESSID)=[^;\s"\',]+/i', '$1=' . $m],
            ['/\b[0-9a-fA-F]{40,}\b/', $m],
            ['/(?<![A-Za-z0-9+_=\-])(?=[A-Za-z0-9+_=\-]{40,})(?=[A-Za-z+_=\-]*[0-9])(?=[0-9+_=\-]*[A-Za-z])[A-Za-z0-9+_=\-]{40,}/', $m],
            // e-mail addresses and phone numbers (010 / +82 mobiles, landlines, other international numbers)
            ['/[A-Za-z0-9._%+\-]+@[A-Za-z0-9\-]+(?:\.[A-Za-z0-9\-]+)*\.[A-Za-z]{2,}/', '[가림:이메일]'],
            ['/(?<![\d+])(?:\+?82[ .\-]?0?|0)1[016789][ .\-]?\d{3,4}[ .\-]?\d{4}(?!\d)/', '[가림:전화]'],
            ['/(?<![\d+])0(?:2|[3-6][1-5]|70|50\d)[ .\-]?\d{3,4}[ .\-]?\d{4}(?!\d)/', '[가림:전화]'],
            ['/(?<![\d+])\+\d{1,3}[ .\-]?\(?\d{1,4}\)?[ .\-]?\d{3,4}[ .\-]?\d{3,4}(?!\d)/', '[가림:전화]'],
        ];
        foreach ($rules as $r) {
            $x = preg_replace($r[0], $r[1], $s);
            if (is_string($x)) $s = $x;
        }
        return $s;
    }

    /** redact() through arrays; the value under a secret-looking key is hidden whole (numbers and booleans elsewhere stay) */
    public static function redactValue($v, string $key = '')
    {
        if ($key !== '' && preg_match('/(?:' . self::SECRET_WORDS . ')(?![A-Za-z])/i', $key) && $v !== null && $v !== '') return self::MARK;
        if (is_array($v)) {
            $out = [];
            foreach ($v as $k => $x) $out[$k] = self::redactValue($x, is_string($k) ? $k : '');
            return $out;
        }
        return is_string($v) ? self::redact($v) : $v;
    }
}
