<?php
/**
 * Admin helpers shared by api/admin/*.php, admin.php and cli/tfm.php:
 *   Stats::collect()  — numbers & recent activity for dashboards
 *   Health::collect() — environment / security self-check (PHP, extensions, DB, dirs, sessions, https, headers, 토스 keys)
 *   AdminOps          — audited moderation actions (role, ban, mute, reports, messages, save restore, cleanup)
 * PHP 7.2 syntax only.
 */
declare(strict_types=1);

namespace Tfm;

if (!defined('TFM_BOOT')) { http_response_code(404); exit; }

final class Stats
{
    public static function collect(): array
    {
        $now = Clock::ms();
        $day0 = Clock::startOfDayMs();
        $v = function (string $sql, array $p = []): int { $x = Db::value($sql, $p); return (int) ($x === null ? 0 : $x); };
        $levels = ['Lv.1–4' => 0, 'Lv.5–9' => 0, 'Lv.10–19' => 0, 'Lv.20+' => 0];
        foreach (Db::all('SELECT level, COUNT(*) AS n FROM user_profiles GROUP BY level') as $r) {
            $l = (int) $r['level'];
            $k = $l >= 20 ? 'Lv.20+' : ($l >= 10 ? 'Lv.10–19' : ($l >= 5 ? 'Lv.5–9' : 'Lv.1–4'));
            $levels[$k] += (int) $r['n'];
        }
        $zones = [];
        foreach (Db::all('SELECT zone_id, COUNT(*) AS n FROM presence WHERE updated_at >= ? AND zone_id IS NOT NULL GROUP BY zone_id', [$now - (int) Config::get('presence.ttl', 15) * 1000]) as $r) {
            $zones[(string) $r['zone_id']] = (int) $r['n'];
        }
        $fmt = function ($ms): string { return $ms ? date('Y-m-d H:i', intdiv((int) $ms, 1000)) : '-'; };
        $subs = [];
        try {
            $subs = [
                'subsActive' => $v("SELECT COUNT(*) FROM subscriptions WHERE status = 'active' AND expires_at > ?", [$now]),
                'subsPastDue' => $v("SELECT COUNT(*) FROM subscriptions WHERE status = 'past_due'"),
                'ordersToday' => $v("SELECT COUNT(*) FROM orders WHERE status = 'confirmed' AND approved_at >= ?", [$day0]),
                'revenueMonth' => $v("SELECT COALESCE(SUM(amount), 0) FROM orders WHERE status = 'confirmed' AND approved_at >= ?", [(int) strtotime(date('Y-m-01')) * 1000]),
            ];
        } catch (\Throwable $e) {
            $subs = ['subsActive' => 0, 'subsPastDue' => 0, 'ordersToday' => 0, 'revenueMonth' => 0];
        }
        return [
            'users' => $v('SELECT COUNT(*) FROM users'),
            'usersToday' => $v('SELECT COUNT(*) FROM users WHERE created_at >= ?', [$day0]),
            'online' => Presence::onlineCount($now),
            'activeToday' => $v('SELECT COUNT(*) FROM player_saves WHERE saved_at >= ?', [$day0]),
            'saves' => $v('SELECT COUNT(*) FROM player_saves'),
            'questCompletions' => $v('SELECT COALESCE(SUM(quests_claimed), 0) FROM user_profiles'),
            'harvests' => $v('SELECT COALESCE(SUM(harvests), 0) FROM user_profiles'),
            'ferments' => $v('SELECT COALESCE(SUM(ferments), 0) FROM user_profiles'),
            'journals' => $v('SELECT COALESCE(SUM(journals), 0) FROM user_profiles'),
            'chatMessages' => $v('SELECT COUNT(*) FROM chat_messages WHERE created_at >= ?', [$now - 86400000]),
            'chatReports' => $v("SELECT COUNT(*) FROM chat_reports WHERE status = 'open'"),
            'uploads' => $v('SELECT COUNT(*) FROM journal_uploads'),
            'bannedUsers' => $v("SELECT COUNT(*) FROM users WHERE status = 'banned'"),
            'rejectedSavesToday' => $v("SELECT COUNT(*) FROM audit_log WHERE event = 'save_rejected' AND created_at >= ?", [$day0]),
            'levels' => $levels,
            'zones' => $zones,
            'recentUsers' => array_map(function ($r) use ($fmt) {
                return [
                    'nickname' => $r['nickname'], 'role' => $r['role'] === 'admin' ? '관리자' : '사용자', 'level' => (int) (isset($r['level']) ? $r['level'] : 1),
                    'status' => $r['status'] === 'banned' ? '정지' : '정상', 'joined' => $fmt($r['created_at']), 'lastLogin' => $fmt($r['last_login_at']),
                ];
            }, Db::all('SELECT u.nickname, u.role, u.status, u.created_at, u.last_login_at, p.level FROM users u LEFT JOIN user_profiles p ON p.user_id = u.id ORDER BY u.created_at DESC LIMIT 10')),
            'recentReports' => array_map(function ($r) use ($fmt) {
                return [
                    'target' => $r['target_name'], 'reason' => $r['reason'], 'message' => mb_substr((string) $r['message_text'], 0, 80),
                    'reporter' => isset($r['reporter']) ? $r['reporter'] : '-', 'at' => $fmt($r['created_at']),
                ];
            }, Db::all("SELECT r.*, u.nickname AS reporter FROM chat_reports r LEFT JOIN users u ON u.id = r.reporter_id WHERE r.status = 'open' ORDER BY r.created_at DESC LIMIT 10")),
            'recentAudit' => array_map(function ($r) use ($fmt) {
                return [
                    'event' => $r['event'], 'severity' => $r['severity'], 'user' => isset($r['nickname']) ? $r['nickname'] : ($r['user_id'] ? '#' . $r['user_id'] : '-'), 'at' => $fmt($r['created_at']),
                ];
            }, Db::all('SELECT a.event, a.severity, a.user_id, a.created_at, u.nickname FROM audit_log a LEFT JOIN users u ON u.id = a.user_id ORDER BY a.id DESC LIMIT 15')),
        ] + $subs;
    }
}

final class Health
{
    /** @var array */
    private $checks = [];

    private function add(string $group, string $id, string $label, string $status, $value, string $hint = ''): void
    {
        $this->checks[] = ['group' => $group, 'id' => $id, 'label' => $label, 'status' => $status, 'value' => $value, 'hint' => $hint];
    }

    public static function iniBytes(string $v): int
    {
        $v = trim($v);
        if ($v === '' || $v === '-1') return PHP_INT_MAX;
        $n = (int) $v;
        switch (strtolower(Str::sub($v, -1))) {
            case 'g': return $n * 1073741824;
            case 'm': return $n * 1048576;
            case 'k': return $n * 1024;
            default: return $n;
        }
    }

    public static function collect(bool $deep = true): array
    {
        $h = new self();
        return $h->run($deep);
    }

    /** the requirement table the installer and the health check share: [ext, required, why] */
    public static function extensions(string $driver): array
    {
        return [
            ['pdo', true, 'DB 연결에 필요'],
            [$driver === 'mysql' ? 'pdo_mysql' : 'pdo_sqlite', true, 'DB 드라이버'],
            ['mbstring', true, '한글 처리'],
            ['json', true, 'API 응답'],
            ['session', true, '로그인 세션'],
            ['curl', false, '토스페이먼츠 결제 서버 연결 (구독 결제를 쓰려면 필요)'],
            ['openssl', false, 'HTTPS·암호 기능'],
            ['fileinfo', false, '업로드 파일 형식 검사 (없으면 사진 업로드 불가)'],
            ['gd', false, '업로드 사진 재인코딩·메타데이터 제거 (강력 권장)'],
            ['sodium', false, 'Argon2id 비밀번호 해시 (없어도 동작: Argon2i 또는 bcrypt 사용)'],
            ['intl', false, '유니코드 정규화 (없어도 동작: 내장 대체 변환 사용)'],
        ];
    }

    private function run(bool $deep): array
    {
        // ---------------------------------------------------------------- PHP
        $okVer = PHP_VERSION_ID >= 70400;
        $this->add('php', 'php_version', 'PHP 버전', PHP_VERSION_ID >= 70200 ? ($okVer ? 'ok' : 'warn') : 'fail', PHP_VERSION . ' (' . (PHP_INT_SIZE * 8) . '비트)',
            PHP_VERSION_ID < 70200 ? 'PHP 7.2 이상이 필요합니다.' : ($okVer ? '' : '동작하지만 보안 업데이트가 끝난 버전이에요. 가능하면 PHP 7.4 이상(8.x 권장)으로 올리세요.'));
        if (PHP_INT_SIZE < 8) $this->add('php', 'php_64bit', '64비트 PHP', 'fail', '32비트', '밀리초 시각과 저장 체크섬에 64비트 정수가 필요해요. 64비트 PHP 를 설치하세요.');
        $driver = strtolower((string) Config::get('db.driver', 'sqlite'));
        foreach (self::extensions($driver) as $row) {
            $e = $row[0]; $req = $row[1]; $why = $row[2];
            $ok = extension_loaded($e);
            $this->add('php', "ext_$e", "확장: $e", $ok ? 'ok' : ($req ? 'fail' : 'warn'), $ok ? '설치됨' : '없음', $ok ? '' : $why);
        }
        $algo = Users::algoName();
        $this->add('security', 'password_algo', '비밀번호 해시', $algo === 'argon2id' ? 'ok' : ($algo === 'argon2i' ? 'ok' : 'warn'), $algo === 'bcrypt' ? 'bcrypt (cost 12)' : $algo, $algo === 'bcrypt' ? 'Argon2 를 지원하는 PHP 빌드를 권장합니다 (bcrypt 도 안전해요).' : '');
        if (extension_loaded('gd')) {
            $gi = function_exists('gd_info') ? gd_info() : [];
            $fmt = [];
            foreach (['JPEG Support' => 'JPEG', 'PNG Support' => 'PNG', 'WebP Support' => 'WEBP'] as $k => $n) if (!empty($gi[$k])) $fmt[] = $n;
            $this->add('php', 'gd_formats', 'GD 지원 형식', count($fmt) >= 3 ? 'ok' : 'warn', implode(', ', $fmt) ?: '없음');
        }
        $ini = [
            'display_errors' => get_cfg_var('display_errors'),
            'expose_php' => ini_get('expose_php'),
            'allow_url_include' => ini_get('allow_url_include'),
            'file_uploads' => ini_get('file_uploads'),
            'upload_max_filesize' => ini_get('upload_max_filesize'),
            'post_max_size' => ini_get('post_max_size'),
            'memory_limit' => ini_get('memory_limit'),
            'max_execution_time' => ini_get('max_execution_time'),
            'open_basedir' => ini_get('open_basedir') ?: '(없음)',
        ];
        $on = function ($x): bool { return in_array(strtolower((string) $x), ['1', 'on', 'true', 'yes', 'stdout', 'stderr'], true); };
        $this->add('php', 'ini_display_errors', 'display_errors (php.ini)', $on($ini['display_errors']) ? 'warn' : 'ok', $on($ini['display_errors']) ? 'On' : 'Off', $on($ini['display_errors']) ? '앱은 실행 중 끄지만, php.ini 에서도 Off 로 두세요.' : '');
        $this->add('php', 'ini_expose_php', 'expose_php', $on($ini['expose_php']) ? 'warn' : 'ok', $on($ini['expose_php']) ? 'On' : 'Off', $on($ini['expose_php']) ? 'php.ini 에서 expose_php = Off 권장 (PHP 버전 노출 방지)' : '');
        $this->add('php', 'ini_allow_url_include', 'allow_url_include', $on($ini['allow_url_include']) ? 'fail' : 'ok', $on($ini['allow_url_include']) ? 'On' : 'Off', $on($ini['allow_url_include']) ? '반드시 Off 로 바꾸세요.' : '');
        $this->add('php', 'ini_file_uploads', 'file_uploads', $on($ini['file_uploads']) ? 'ok' : 'warn', $on($ini['file_uploads']) ? 'On' : 'Off', $on($ini['file_uploads']) ? '' : '작업일지 사진 업로드를 쓰려면 On');
        $up = self::iniBytes((string) $ini['upload_max_filesize']);
        $post = self::iniBytes((string) $ini['post_max_size']);
        $this->add('php', 'ini_upload_size', 'upload_max_filesize / post_max_size', $up >= 5242880 && $post >= 6291456 ? 'ok' : 'warn', $ini['upload_max_filesize'] . ' / ' . $ini['post_max_size'], $up >= 5242880 && $post >= 6291456 ? '' : '5M / 8M 이상 권장 (저장 데이터 최대 1.5 MB, 사진 5 MB)');
        $memOk = self::iniBytes((string) $ini['memory_limit']) >= 134217728;
        $this->add('php', 'ini_memory', 'memory_limit', $memOk ? 'ok' : 'warn', $ini['memory_limit'], $memOk ? '' : '128M 이상 권장 (사진 재인코딩)');
        $opc = function_exists('opcache_get_status') && @opcache_get_status(false);
        $this->add('php', 'opcache', 'OPcache', $opc ? 'ok' : 'warn', $opc ? '사용' : '꺼짐', $opc ? '' : '성능을 위해 켜 두세요.');
        $this->add('php', 'timezone', '시간대', 'ok', date_default_timezone_get() . ' · ' . date('Y-m-d H:i:s'));

        // ---------------------------------------------------------------- database
        $db = ['driver' => $driver, 'ok' => false];
        try {
            Db::pdo();
            $db['ok'] = true;
            $db['schemaVersion'] = Db::schemaVersion();
            $db['expectedSchema'] = Db::SCHEMA_VERSION;
            $db['serverVersion'] = (string) Db::pdo()->getAttribute(\PDO::ATTR_SERVER_VERSION);
            $this->add('db', 'db_connect', 'DB 연결', 'ok', strtoupper($driver) . ' ' . $db['serverVersion']);
            $this->add('db', 'db_schema', '스키마 버전', $db['schemaVersion'] >= Db::SCHEMA_VERSION ? 'ok' : 'fail', $db['schemaVersion'] . ' / ' . Db::SCHEMA_VERSION, $db['schemaVersion'] >= Db::SCHEMA_VERSION ? '' : 'database/schema 파일로 테이블을 만드세요.');
            if ($driver === 'sqlite') {
                $mode = (string) Db::value('PRAGMA journal_mode');
                $path = Db::dbFilePath();
                $db['journalMode'] = $mode;
                $db['sizeBytes'] = is_file($path) ? filesize($path) : 0;
                $this->add('db', 'db_wal', 'SQLite 저널 모드', strtolower($mode) === 'wal' ? 'ok' : 'warn', $mode);
                $this->add('db', 'db_size', 'DB 파일 크기', 'ok', number_format((int) $db['sizeBytes']) . ' bytes');
            }
            $db['users'] = (int) Db::value('SELECT COUNT(*) FROM users');
            $admins = (int) Db::value("SELECT COUNT(*) FROM users WHERE role = 'admin'");
            $this->add('security', 'admin_exists', '관리자 계정', $admins > 0 ? 'ok' : 'warn', $admins . '명', $admins > 0 ? '' : 'install.php, admin.php(이 서버 PC에서) 또는 cli/tfm.php promote 로 관리자를 지정하세요.');
        } catch (\Throwable $e) {
            Log::error('HEALTH', 'db check failed: ' . $e->getMessage());
            $this->add('db', 'db_connect', 'DB 연결', 'fail', '실패', $driver === 'mysql' ? 'config.local.php 의 MySQL 접속 정보와 데이터베이스(fermentation_metaverse) 생성 여부를 확인하세요.' : 'data/ 폴더 쓰기 권한과 pdo_sqlite 확장을 확인하세요.');
        }

        // ---------------------------------------------------------------- filesystem
        $dataDir = Config::dataDir();
        $root = (string) realpath(TFM_ROOT);
        $dirs = ['data' => $dataDir, 'logs' => $dataDir . DIRECTORY_SEPARATOR . 'logs', 'sessions' => $dataDir . DIRECTORY_SEPARATOR . 'sessions', 'uploads' => Config::uploadDir()];
        foreach ($dirs as $k => $d) {
            if (!is_dir($d)) @mkdir($d, 0750, true);
            $w = is_dir($d) && is_writable($d);
            $this->add('files', "dir_$k", "쓰기 권한: $k/", $w ? 'ok' : 'fail', $w ? '쓰기 가능' : '쓰기 불가', $w ? '' : '웹 서버 계정이 이 폴더에 쓸 수 있게 권한을 주세요.');
        }
        $realData = str_replace('\\', '/', (string) realpath($dataDir));
        $realRoot = str_replace('\\', '/', $root) . '/';
        $inside = PHP_OS_FAMILY === 'Windows' ? stripos($realData, $realRoot) === 0 : Str::startsWith($realData, $realRoot);
        $this->add('security', 'data_location', 'data/ 위치', $inside ? 'warn' : 'ok', $inside ? '웹 루트 안 (.htaccess 로 차단)' : '웹 루트 밖', $inside ? '운영 환경에서는 TFM_DATA_DIR 로 웹 루트 밖 경로를 지정하는 것이 가장 안전합니다.' : '');
        foreach (['config', 'lib', 'database', 'cli'] as $d) {
            $ok = is_file(TFM_ROOT . "/$d/.htaccess") && is_file(TFM_ROOT . "/$d/index.php");
            $this->add('security', "guard_$d", "접근 차단 파일: $d/", $ok ? 'ok' : 'warn', $ok ? '.htaccess + index.php' : '누락');
        }
        $okUp = is_file(Config::uploadDir() . DIRECTORY_SEPARATOR . '.htaccess');
        $this->add('security', 'guard_uploads', '업로드 폴더 실행 차단', $okUp ? 'ok' : 'warn', $okUp ? '.htaccess (스크립트 실행 금지·nosniff)' : '누락');
        $lock = is_file($dataDir . DIRECTORY_SEPARATOR . 'install.lock');
        $this->add('security', 'install_lock', '설치 마법사(install.php) 잠금', $lock ? 'ok' : 'warn', $lock ? '잠김 (data/install.lock)' : '열려 있음', $lock ? '' : 'install.php 를 아직 실행하지 않았거나 잠금 파일이 지워졌어요. 설치를 마치면 자동으로 잠겨요.');
        $free = @disk_free_space($dataDir);
        if ($free !== false) $this->add('files', 'disk_free', '남은 디스크', $free > 500 * 1048576 ? 'ok' : 'warn', round($free / 1073741824, 1) . ' GB');

        // ---------------------------------------------------------------- sessions & transport
        $web = PHP_SAPI !== 'cli';
        $https = Http::isHttps();
        $local = Http::isLocalhost();
        if ($web) $this->add('security', 'https', 'HTTPS', $https ? 'ok' : ($local ? 'warn' : 'fail'), $https ? '사용 중' : '사용 안 함', $https ? '' : '운영 서버는 반드시 HTTPS 로 서비스하세요 (세션 쿠키 Secure·HSTS 자동 적용). 토스 결제창도 HTTPS 를 요구해요.');
        else $this->add('security', 'https', 'HTTPS', 'warn', 'CLI 에서는 확인할 수 없음', '브라우저로 admin.php → 시스템 점검에서 확인하세요.');
        // values enforced by Session::start() on every request (ini defaults are irrelevant: they are overridden)
        $sess = [
            'name' => (string) Config::get('session.name', 'TFMSESSID'),
            'cookie_path' => Http::basePath(),
            'httponly' => true,
            'samesite' => 'Lax',
            'secure' => $https,
            'use_strict_mode' => true,
            'use_only_cookies' => true,
            'save_path' => 'data/sessions',
            'idle_timeout' => (int) Config::get('session.idle_timeout', 7200),
            'absolute_lifetime' => (int) Config::get('session.absolute_lifetime', 86400),
            'bind_user_agent' => (bool) Config::get('session.bind_user_agent', true),
        ];
        $sessDir = Config::dataDir() . DIRECTORY_SEPARATOR . 'sessions';
        $sessOk = (is_dir($sessDir) || @mkdir($sessDir, 0750, true)) && is_writable($sessDir);
        $this->add('security', 'session', '세션 설정', $sessOk ? 'ok' : 'fail',
            sprintf('%s · HttpOnly · SameSite=Lax · Secure=%s · strict mode · 경로 %s · 유휴 %d분 · 최대 %d시간%s', $sess['name'], $https ? 'on' : ($web ? 'off(http)' : '자동'), $sess['cookie_path'], intdiv($sess['idle_timeout'], 60), intdiv($sess['absolute_lifetime'], 3600), $sess['bind_user_agent'] ? ' · UA 지문' : ''),
            $sessOk ? '' : 'data/sessions 폴더에 쓸 수 없어요.');
        $server = (string) (isset($_SERVER['SERVER_SOFTWARE']) ? $_SERVER['SERVER_SOFTWARE'] : PHP_SAPI);
        $this->add('server', 'server_software', '웹 서버', 'ok', mb_substr($server, 0, 80));
        if (function_exists('apache_get_modules')) {
            $mods = apache_get_modules();
            $hdr = in_array('mod_headers', $mods, true);
            $this->add('server', 'mod_headers', 'Apache mod_headers', $hdr ? 'ok' : 'warn', $hdr ? '사용' : '없음', $hdr ? '' : 'httpd.conf 에서 mod_headers 를 켜면 정적 파일에도 보안 헤더가 붙습니다.');
            $rw = in_array('mod_rewrite', $mods, true);
            $this->add('server', 'mod_rewrite', 'Apache mod_rewrite', $rw ? 'ok' : 'warn', $rw ? '사용' : '없음', $rw ? '' : 'HTTPS 강제 이동(.htaccess 주석 블록)을 쓰려면 필요해요.');
        }
        $this->add('security', 'headers', 'API 보안 헤더', 'ok', 'CSP default-src none · frame-ancestors none · nosniff · no-referrer · COOP/CORP same-origin' . ($https ? ' · HSTS' : ''));
        $gd = GameData::all();
        $this->add('app', 'game_data', '체험 데이터(game-data.json)', GameData::loaded() ? 'ok' : 'fail',
            GameData::loaded() ? sprintf('퀘스트 %d · 작물 %d · 레시피 %d · 아이템 %d (%s)', count($gd['quests']), count($gd['crops']), count($gd['recipes']), count($gd['items']), GameData::exportedAt()) : '없음',
            GameData::loaded() ? '' : '"node tools/build.mjs" 로 다시 빌드하세요. 없으면 저장 검증이 약해집니다.');
        $this->add('app', 'save_validation', '저장 검증', Config::get('save.validate', true) ? 'ok' : 'fail', Config::get('save.validate', true) ? '사용 (경제·성장·발효 시간 검증, 구독 단계 반영)' : '꺼짐');
        // 토스페이먼츠 / subscriptions: never print a key — only whether real keys are set
        $mock = Toss::mock();
        $keys = Toss::keysConfigured();
        $live = Toss::liveKeys();
        $this->add('app', 'toss_mode', '구독 결제 모드', $mock ? 'warn' : ($keys ? 'ok' : 'warn'), $mock ? '모의 결제(mock)' : ($live ? '실결제(live 키)' : ($keys ? '가맹점 테스트 키' : '문서용 테스트 키')),
            $mock ? '테스트·시연용이에요. 실제 결제는 config 의 toss.mock 을 false 로 두고 토스 키를 넣으세요.' : ($keys ? '' : '토스페이먼츠 개발자센터에서 받은 키를 TFM_TOSS_CLIENT_KEY / TFM_TOSS_SECRET_KEY 로 넣어 주세요 (지금은 문서용 키).'));
        $this->add('app', 'toss_curl', '결제 서버 연결(curl)', function_exists('curl_init') ? 'ok' : ($mock ? 'warn' : 'fail'), function_exists('curl_init') ? '가능' : '없음', function_exists('curl_init') ? '' : 'php.ini 에서 extension=curl 을 켜 주세요.');
        // kid safety: the personal-information filter must load its whole rule list (lib/pii-rules.json, generated from
        // the client by tests/pii-sync.mjs), mask the canonical disguises and leave ordinary kid sentences alone
        $piiRules = ChatFilter::piiRuleNames();
        $piiFull = count($piiRules) >= 30 && !array_diff(['email', 'url', 'phone', 'wordDigits', 'handleKo', 'school', 'classWords'], $piiRules);
        $this->add('security', 'pii_rules', '개인정보 가림 규칙', $piiFull ? 'ok' : 'fail', count($piiRules) . '개' . ($piiFull ? '' : ' (기본 규칙만)'),
            $piiFull ? '' : 'lib/pii-rules.json 이 없거나 깨졌어요. "node tests/pii-sync.mjs" 로 다시 만들고 함께 올리세요.');
        $piiSamples = ['010-1234-5678', '01012345678', '+82 10 1234 5678', 'kid@example.com', 'https://example.com', '서울시 강남구 테헤란로 123',
            '０１０-１２３４-５６７８', '010/1234/5678', '공일공-일이삼사-오육칠팔', '010 일이삼사 5678', 'dinokid at gmail dot com', 'bad[.]com', '서울시 강남구 역삼동 123-4',
            "0\u{200B}1\u{200B}0 1\u{00AD}2\u{00AD}3\u{00AD}4 5\u{2060}6\u{2060}7\u{2060}8", '공1공 1234 5678', '해바라기초등학교', '3학년 2반', '101동 1203호'];
        $piiMissed = array_values(array_filter($piiSamples, function ($t) { return ChatFilter::maskPII(Users::cleanText($t, 200)) !== ChatFilter::PII_MARK; }));
        $piiKeep = ['오늘 콩 3개 심었어요! 레벨 12 😊', '2024.10.11 소풍', '콩 10개 심고 물 3번 줬어', '1000 2000 코인 모았어', '나 유치원 가기 싫어'];
        $piiFalse = array_values(array_filter($piiKeep, function ($t) { return ChatFilter::maskPII($t) !== $t; }));
        $nickBad = array_values(array_filter(['로블록스dino12', '해바라기초2학년', '공일공일이삼사'], function ($n) { return !ChatFilter::nicknameLooksPersonal($n); }));
        $piiOk = !$piiMissed && !$piiFalse && !$nickBad;
        $this->add('security', 'pii_filter', '어린이 개인정보 가림(채팅·닉네임)', $piiOk ? 'ok' : 'fail',
            $piiOk ? '전화번호·이메일·주소·학교·링크·숫자 말 → 🔒' : ($piiMissed ? '가리지 못함: ' . implode(', ', array_map(function ($t) { return mb_substr(Users::cleanText($t, 40), 0, 24); }, $piiMissed)) : ($piiFalse ? '보통 문장을 잘못 가림: ' . implode(', ', $piiFalse) : '닉네임 검사 실패: ' . implode(', ', $nickBad))),
            $piiOk ? '' : 'lib/pii-rules.json 과 lib/ChatFilter.php 를 확인하세요 (node tests/pii-client.mjs).');
        $titles = count(GameData::titles());
        $this->add('app', 'titles', '칭호 목록 (랭킹 표시 제한)', $titles ? 'ok' : 'warn', $titles ? "{$titles}개" : '없음', $titles ? '' : '"node tools/build.mjs" 로 game-data.json 을 다시 만들면 랭킹에 실제 칭호만 보여요.');

        // ---------------------------------------------------------------- exposure probe (is data/ reachable over HTTP?)
        if ($deep) $this->probe($inside);

        $sum = ['ok' => 0, 'warn' => 0, 'fail' => 0];
        foreach ($this->checks as $c) $sum[$c['status']] = (isset($sum[$c['status']]) ? $sum[$c['status']] : 0) + 1;
        return [
            'status' => $sum['fail'] ? 'fail' : ($sum['warn'] ? 'warn' : 'ok'),
            'ok' => $sum['fail'] === 0,
            'summary' => $sum,
            'app' => ['name' => TFM_APP, 'version' => TFM_VERSION, 'env' => (string) Config::get('app.env', 'production'), 'basePath' => Http::basePath()],
            'php' => ['version' => PHP_VERSION, 'sapi' => PHP_SAPI, 'os' => PHP_OS_FAMILY, 'bits' => PHP_INT_SIZE * 8, 'ini' => $ini],
            'db' => $db,
            'session' => $sess,
            'https' => $https,
            'toss' => ['mock' => $mock, 'keysConfigured' => $keys, 'live' => $live],
            'checks' => $this->checks,
            'generatedAt' => Clock::ms(),
        ];
    }

    /** request a private probe file through the web server itself (loopback only; skipped where impossible) */
    private function probe(bool $inside): void
    {
        if (!$inside) { $this->add('security', 'probe_data', 'data/ 외부 노출 검사', 'ok', '웹 루트 밖이라 노출 불가'); return; }
        if (PHP_SAPI === 'cli-server' || PHP_SAPI === 'cli' || Http::isHttps() || !ini_get('allow_url_fopen')) {
            $this->add('security', 'probe_data', 'data/ 외부 노출 검사', 'warn', '건너뜀', PHP_SAPI === 'cli-server' ? 'PHP 내장 서버(php -S)는 .htaccess 를 읽지 않습니다 — 개발용으로만 쓰세요.' : 'Apache 로 실행하면 자동 검사합니다.');
            return;
        }
        $name = 'probe-' . bin2hex(random_bytes(6)) . '.txt';
        $file = Config::dataDir() . DIRECTORY_SEPARATOR . $name;
        if (@file_put_contents($file, 'tfm-probe') === false) return;
        try {
            $port = (int) (isset($_SERVER['SERVER_PORT']) ? $_SERVER['SERVER_PORT'] : 80);
            $url = 'http://127.0.0.1:' . $port . Http::basePath() . 'data/' . $name;
            $ctx = stream_context_create(['http' => ['timeout' => 2, 'ignore_errors' => true, 'follow_location' => 0, 'header' => 'Host: ' . preg_replace('/[^A-Za-z0-9.:\-\[\]]/', '', (string) (isset($_SERVER['SERVER_NAME']) ? $_SERVER['SERVER_NAME'] : 'localhost'))]]);
            $body = @file_get_contents($url, false, $ctx);
            $exposed = $body === 'tfm-probe';
            $this->add('security', 'probe_data', 'data/ 외부 노출 검사', $exposed ? 'fail' : 'ok', $exposed ? '노출됨!' : '차단됨', $exposed ? 'AllowOverride 가 꺼져 .htaccess 가 무시되고 있어요. httpd.conf 에서 AllowOverride All 을 켜거나 data/ 를 웹 루트 밖으로 옮기세요.' : '');
        } finally {
            @unlink($file);
        }
    }
}

final class AdminOps
{
    private static function target(int $uid): array
    {
        $u = Users::byId($uid);
        if (!$u) throw new ApiException(404, 'NOT_FOUND', '사용자를 찾을 수 없어요.');
        return $u;
    }

    public static function setRole(array $actor, int $uid, string $role): string
    {
        if (!in_array($role, ['user', 'admin'], true)) throw new ApiException(400, 'INVALID_ROLE', '권한 값이 올바르지 않아요.');
        $u = self::target($uid);
        if ($u['role'] === $role) return '변경할 내용이 없어요.';
        if ($role === 'user' && (int) Db::value("SELECT COUNT(*) FROM users WHERE role = 'admin' AND status = 'active'") <= 1) {
            throw new ApiException(409, 'LAST_ADMIN', '마지막 관리자는 해제할 수 없어요. 다른 관리자를 먼저 지정하세요.');
        }
        Users::update($uid, ['role' => $role], true);
        Audit::log('role_changed', $uid, ['from' => $u['role'], 'to' => $role], 'warn', (int) $actor['id'] ?: null);
        return "{$u['nickname']} 님의 권한을 " . ($role === 'admin' ? '관리자' : '사용자') . '(으)로 바꿨어요.';
    }

    public static function setBanned(array $actor, int $uid, bool $ban): string
    {
        $u = self::target($uid);
        if ($uid === (int) $actor['id']) throw new ApiException(409, 'SELF', '자기 자신은 정지할 수 없어요.');
        if ($ban && $u['role'] === 'admin') throw new ApiException(409, 'ADMIN_TARGET', '관리자는 먼저 권한을 해제한 뒤 정지하세요.');
        Users::update($uid, ['status' => $ban ? 'banned' : 'active'], true);
        if ($ban) {
            Presence::remove($uid);
            Retractions::add(null, $uid); // sessions online take every line of that account back
        }
        Audit::log($ban ? 'user_banned' : 'user_unbanned', $uid, [], 'warn', (int) $actor['id'] ?: null);
        return $ban ? "{$u['nickname']} 님을 이용 정지했어요." : "{$u['nickname']} 님의 정지를 풀었어요.";
    }

    public static function mute(array $actor, int $uid, int $minutes): string
    {
        $u = self::target($uid);
        $minutes = max(0, min(60 * 24 * 30, $minutes));
        Users::update($uid, ['muted_until' => $minutes ? Clock::ms() + $minutes * 60000 : 0]);
        Audit::log($minutes ? 'user_muted' : 'user_unmuted', $uid, ['minutes' => $minutes], 'info', (int) $actor['id'] ?: null);
        return $minutes ? "{$u['nickname']} 님의 채팅을 {$minutes}분 동안 막았어요." : "{$u['nickname']} 님의 채팅 제한을 풀었어요.";
    }

    public static function report(array $actor, int $rid, string $status): string
    {
        if (!in_array($status, ['open', 'resolved', 'dismissed'], true)) throw new ApiException(400, 'INVALID_STATUS', '상태 값이 올바르지 않아요.');
        $n = Db::exec('UPDATE chat_reports SET status = ?, resolved_at = ?, resolved_by = ? WHERE id = ?', [$status, $status === 'open' ? 0 : Clock::ms(), $status === 'open' ? null : (int) $actor['id'], $rid]);
        if (!$n) throw new ApiException(404, 'NOT_FOUND', '신고를 찾을 수 없어요.');
        Audit::log('report_' . $status, null, ['report' => $rid], 'info', (int) $actor['id'] ?: null);
        return $status === 'resolved' ? '신고를 처리 완료했어요.' : ($status === 'dismissed' ? '신고를 기각했어요.' : '신고를 다시 열었어요.');
    }

    public static function hideMessage(array $actor, int $mid, bool $hide): string
    {
        $n = Db::exec('UPDATE chat_messages SET hidden = ? WHERE id = ?', [$hide ? 1 : 0, $mid]);
        if (!$n) throw new ApiException(404, 'NOT_FOUND', '메시지를 찾을 수 없어요.');
        if ($hide) Retractions::add($mid, null); // sessions that already show it take it back
        Audit::log($hide ? 'message_hidden' : 'message_unhidden', null, ['message' => $mid], 'info', (int) $actor['id'] ?: null);
        return $hide ? '메시지를 숨겼어요.' : '메시지를 다시 보이게 했어요.';
    }

    /** swap the stored save with its one-step backup (undo the last accepted save) */
    public static function restoreBackup(array $actor, int $uid): string
    {
        $u = self::target($uid);
        $r = Db::tx(function () use ($uid) {
            $r = Db::one('SELECT data, saved_at, backup_data, backup_saved_at, revision FROM player_saves WHERE user_id = ?' . Db::forUpdate(), [$uid]);
            if (!$r || !$r['backup_data']) throw new ApiException(404, 'NO_BACKUP', '되돌릴 백업 저장본이 없어요.');
            // the ledger starts over with the restored copy, stamped with the revision it is stored at: while the row is
            // still that copy, a save from a tab with the overwritten progress hears so (player/save.php 409 data.restored)
            $rev = (int) $r['revision'] + 1;
            $meta = Json::encode(['restoredRev' => $rev, 'restoredAt' => Clock::ms()]);
            // explicit values: MySQL evaluates SET assignments left to right, so a column swap must not reference columns
            Db::exec('UPDATE player_saves SET data = ?, backup_data = ?, saved_at = ?, backup_saved_at = ?, size_bytes = ?, revision = ?, meta = ? WHERE user_id = ?', [
                (string) $r['backup_data'], (string) $r['data'], Clock::ms(), (int) $r['saved_at'], strlen((string) $r['backup_data']), $rev, $meta, $uid,
            ]);
            return $r;
        });
        Users::update($uid, [], true); // sign the player out so the restored save is loaded fresh
        Audit::log('save_restored', $uid, ['backupFrom' => (int) $r['backup_saved_at']], 'warn', (int) $actor['id'] ?: null);
        return "{$u['nickname']} 님의 저장 데이터를 직전 백업으로 되돌렸어요.";
    }

    /** maintenance: expired buckets, stale presence, old attempts/audit/chat, old logs */
    public static function cleanup(?array $actor = null): array
    {
        $now = Clock::ms();
        $out = [
            'rate_limits' => Db::exec('DELETE FROM rate_limits WHERE expires_at < ?', [$now]),
            'presence' => Db::exec('DELETE FROM presence WHERE updated_at < ?', [$now - (int) Config::get('retention.presence_hours', 24) * 3600000]),
            'login_attempts' => Db::exec('DELETE FROM login_attempts WHERE created_at < ?', [$now - (int) Config::get('retention.login_attempts_days', 30) * 86400000]),
            'audit_log' => Db::exec('DELETE FROM audit_log WHERE created_at < ?', [$now - (int) Config::get('retention.audit_days', 180) * 86400000]),
            'chat_messages' => Db::exec('DELETE FROM chat_messages WHERE created_at < ?', [$now - (int) Config::get('chat.retention_days', 30) * 86400000]),
            'chat_retractions' => Db::exec('DELETE FROM chat_retractions WHERE created_at < ?', [$now - (int) Config::get('chat.retention_days', 30) * 86400000]),
            'stale_orders' => Db::exec("DELETE FROM orders WHERE status = 'created' AND requested_at < ?", [$now - 7 * 86400000]),
            'log_files' => Log::cleanup(),
            'sessions' => is_dir(Config::dataDir() . DIRECTORY_SEPARATOR . 'sessions') ? Session::gcAnonymous(Config::dataDir() . DIRECTORY_SEPARATOR . 'sessions', (int) Config::get('session.idle_timeout', 7200)) : 0,
        ];
        if (Db::driver() === 'sqlite') { try { Db::pdo()->exec('PRAGMA wal_checkpoint(TRUNCATE)'); } catch (\Throwable $e) { /* busy */ } }
        Audit::log('maintenance_cleanup', null, $out, 'info', $actor ? (int) $actor['id'] : null);
        return $out;
    }

    /** first admin: only when no admin exists, only from the server machine itself */
    public static function bootstrap(array $user): string
    {
        if (!Config::get('security.allow_localhost_bootstrap', true)) throw new ApiException(403, 'DISABLED', '이 기능은 꺼져 있어요.');
        if (!Http::isLocalhost()) throw new ApiException(403, 'NOT_LOCAL', '서버 PC(localhost)에서만 할 수 있어요.');
        return Db::tx(function () use ($user) {
            if (Users::adminExists()) throw new ApiException(409, 'ADMIN_EXISTS', '이미 관리자가 있어요.');
            Users::update((int) $user['id'], ['role' => 'admin'], true);
            Audit::log('admin_bootstrap', (int) $user['id'], ['via' => 'localhost'], 'alert', (int) $user['id']);
            return "{$user['nickname']} 님을 첫 관리자로 지정했어요.";
        });
    }
}
