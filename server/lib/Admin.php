<?php
/**
 * Admin helpers shared by api/admin/*.php, the admin site (admin/index.php — the folder name is free) and cli/tfm.php:
 *   Stats::collect()  — numbers & recent activity for dashboards
 *   Health::collect() — environment / security self-check (PHP, extensions, DB, dirs, sessions, https, headers, 토스 keys,
 *                       the admin lock, the configuration audit, the live DB account)
 *   AdminOps          — audited moderation actions (role, ban, mute, reports, messages, save restore, cleanup, first admin)
 *   AdminGate         — the admin path lock (CONTRACT §15.4, security item 6): IP allow-list, the plain 404, the lock
 *                       headers, the admin elevation (session flag + folder cookie, idle timeout), the stateless sign-in token
 *   AdminPath         — the admin folder: its name is free (found by its entry marker), renamed by `cli admin:path`
 * PHP 7.2 syntax only.
 */
declare(strict_types=1);

namespace Tfm;

if (!defined('TFM_BOOT')) { if (function_exists('header_remove')) header_remove('X-Powered-By'); http_response_code(404); exit; }

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
        // [scale-server] CONTRACT §16.9: who is where comes from the sync channels (the presence table is written behind)
        $zones = Presence::zones($now);
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

    /**
     * @param bool      $deep          include the loopback exposure probe (slow)
     * @param bool|null $adminHtaccess the admin page tells whether its own .htaccess was applied (null: not known here)
     * @param bool      $withConfig    include the configuration audit (ConfigAudit makes web requests of its own; the
     *                                 dashboard summary leaves it out and links to the full report)
     */
    public static function collect(bool $deep = true, ?bool $adminHtaccess = null, bool $withConfig = true): array
    {
        $h = new self();
        return $h->run($deep, $adminHtaccess, $withConfig);
    }

    /**
     * A real deployment host (CONTRACT §15.7 #16): app.env is production and the request is not from the server machine
     * itself. On the command line there is no request: treated as a real host, so the operator is warned (ConfigAudit
     * uses the same rule).
     */
    public static function productionHost(): bool
    {
        $env = strtolower((string) Config::rawGet('app.env', 'production'));
        if ($env !== 'production') return false;
        return PHP_SAPI === 'cli' ? true : !Http::isLocalhost();
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

    private function run(bool $deep, ?bool $adminHtaccess = null, bool $withConfig = true): array
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
            $this->add('security', 'admin_exists', '관리자 계정', $admins > 0 ? 'ok' : 'warn', $admins . '명', $admins > 0 ? '' : 'install.php 로 설치하거나, 관리자 센터 로그인 화면의 "첫 관리자 지정"(설치 코드 필요) 또는 서버 컴퓨터에서 php cli/tfm.php promote 이메일 로 관리자를 지정하세요.');
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
        $free = @disk_free_space($dataDir);
        if ($free !== false) $this->add('files', 'disk_free', '남은 디스크', $free > 500 * 1048576 ? 'ok' : 'warn', round($free / 1073741824, 1) . ' GB');

        // ---------------------------------------------------------------- sessions & transport
        $web = PHP_SAPI !== 'cli';
        $https = Http::isHttps();
        $local = Http::isLocalhost();
        if ($web) $this->add('security', 'https', 'HTTPS', $https ? 'ok' : ($local ? 'warn' : 'fail'), $https ? '사용 중' : '사용 안 함', $https ? '' : '운영 서버는 반드시 HTTPS 로 서비스하세요 (세션 쿠키 Secure·HSTS 자동 적용). 토스 결제창도 HTTPS 를 요구해요.');
        else $this->add('security', 'https', 'HTTPS', 'warn', 'CLI 에서는 확인할 수 없음', '브라우저로 관리자 센터 → 🩺 시스템 점검에서 확인하세요.');
        // F18: the cross-site request check (Origin / Sec-Fetch-Site) switched off is ⛔ on a real host
        $prod = self::productionHost();
        $origin = Config::get('security.check_origin', true);
        $originOn = !($origin === false || in_array(strtolower((string) $origin), ['0', 'off', 'false', 'no', ''], true));
        $this->add('security', 'check_origin', '다른 사이트 요청 막기(check_origin)', $originOn ? 'ok' : ($prod ? 'fail' : 'warn'), $originOn ? '켜짐' : '꺼짐',
            $originOn ? '' : '다른 사이트가 몰래 보낸 로그인·저장·관리 요청을 막는 검사가 꺼져 있어요. config.local.php 의 security.check_origin 을 true 로 두세요.');
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
        $this->add('app', 'toss_mode', '구독 결제 모드', $mock ? 'warn' : ($keys ? 'ok' : 'warn'), $mock ? '모의 결제(mock)' : ($live ? '실결제(live 키)' : ($keys ? '가맹점 테스트 키' : '결제 설정 필요 (키 없음)')),
            $mock ? '테스트·시연용이에요. 실제 결제는 config 의 toss.mock 을 false 로 두고 토스 키를 넣으세요.' : ($keys ? '' : '토스페이먼츠 개발자센터에서 받은 키를 TFM_TOSS_CLIENT_KEY / TFM_TOSS_SECRET_KEY 나 config.local.php 에 넣어 주세요. 지금은 키가 없어서 구독 결제를 받을 수 없어요.'));
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
        if ($adminHtaccess !== null) {
            $this->add('server', 'admin_htaccess', '관리자 폴더 .htaccess 적용', $adminHtaccess ? 'ok' : 'warn', $adminHtaccess ? '적용됨' : '적용 안 됨',
                $adminHtaccess ? '' : 'Apache 가 .htaccess 를 읽지 않는 것 같아요 (AllowOverride). httpd.conf 의 설치 폴더 <Directory> 에 AllowOverride All 을 두세요 — 그래야 data/ · config/ 차단 규칙도 동작해요.');
        }

        // ---------------------------------------------------------------- the admin path lock (CONTRACT §15.4, item 6)
        $this->adminLock($prod, $web);
        // ---------------------------------------------------------------- configuration audit (CONTRACT §15.7 #8 #16)
        if ($withConfig) $this->configAudit($prod);
        // ---------------------------------------------------------------- the database account this server runs as (#1)
        $this->dbAccount();

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

    /**
     * F19: the port of the loopback probe. SERVER_PORT is derived from the Host header on Apache (UseCanonicalName Off),
     * so it is used only when the Host header names no port (SERVER_PORT then comes from the server configuration) or
     * names one of the usual web ports; anything else is skipped (0) — the probe never connects where a visitor says.
     */
    public static function probePort(): int
    {
        $host = (string) (isset($_SERVER['HTTP_HOST']) ? $_SERVER['HTTP_HOST'] : '');
        $sp = (string) (isset($_SERVER['SERVER_PORT']) ? $_SERVER['SERVER_PORT'] : '');
        if (!preg_match('/^(?:\[[0-9A-Fa-f:.]+\]|[A-Za-z0-9.\-]*)(?::(\d{1,5}))?\z/', $host, $m)) return 0;
        $named = isset($m[1]) ? (int) $m[1] : 0;
        if ($named === 0) return ctype_digit($sp) && (int) $sp > 0 && (int) $sp < 65536 ? (int) $sp : 80;
        return in_array($named, [80, 81, 8000, 8008, 8080, 8081, 8888], true) ? $named : 0;
    }

    /** request a private probe file through the web server itself (loopback only; skipped where impossible) */
    private function probe(bool $inside): void
    {
        if (!$inside) { $this->add('security', 'probe_data', 'data/ 외부 노출 검사', 'ok', '웹 루트 밖이라 노출 불가'); return; }
        if (PHP_SAPI === 'cli-server' || PHP_SAPI === 'cli' || Http::isHttps() || !ini_get('allow_url_fopen')) {
            $this->add('security', 'probe_data', 'data/ 외부 노출 검사', 'warn', '건너뜀', PHP_SAPI === 'cli-server' ? 'PHP 내장 서버(php -S)는 .htaccess 를 읽지 않습니다 — 개발용으로만 쓰세요.' : 'Apache 로 실행하면 자동 검사합니다.');
            return;
        }
        $port = self::probePort();
        if ($port === 0) {
            $this->add('security', 'probe_data', 'data/ 외부 노출 검사', 'warn', '건너뜀', '이 요청이 알려 준 포트 번호를 믿을 수 없어 검사하지 않았어요. 서버 컴퓨터에서 http://localhost/ 주소로 이 화면을 열면 검사해요.');
            return;
        }
        $name = 'probe-' . bin2hex(random_bytes(6)) . '.txt';
        $file = Config::dataDir() . DIRECTORY_SEPARATOR . $name;
        if (@file_put_contents($file, 'tfm-probe') === false) return;
        try {
            $url = 'http://127.0.0.1:' . $port . Http::basePath() . 'data/' . $name;
            $ctx = stream_context_create(['http' => ['timeout' => 2, 'ignore_errors' => true, 'follow_location' => 0, 'header' => 'Host: ' . preg_replace('/[^A-Za-z0-9.:\-\[\]]/', '', (string) (isset($_SERVER['SERVER_NAME']) ? $_SERVER['SERVER_NAME'] : 'localhost'))]]);
            $body = @file_get_contents($url, false, $ctx);
            $exposed = $body === 'tfm-probe';
            $this->add('security', 'probe_data', 'data/ 외부 노출 검사', $exposed ? 'fail' : 'ok', $exposed ? '노출됨!' : '차단됨', $exposed ? 'AllowOverride 가 꺼져 .htaccess 가 무시되고 있어요. httpd.conf 에서 AllowOverride All 을 켜거나 data/ 를 웹 루트 밖으로 옮기세요.' : '');
        } finally {
            @unlink($file);
        }
    }

    /**
     * The admin path lock (CONTRACT §15.4): folder name, IP allow-list, 2-step sign-in, the old address, the installer.
     * The rows never spell the admin folder's name (this report is also an API answer).
     */
    private function adminLock(bool $prod, bool $web): void
    {
        $g = 'adminlock';
        $dir = AdminPath::dirName();
        $cfg = (string) Config::get('security.admin_dir', AdminPath::DEFAULT_NAME);
        if ($dir === '') {
            $this->add($g, 'admin_dir', '관리자 폴더 이름', 'fail', '찾을 수 없음', '관리자 센터 폴더(맨 위에 TFM-ADMIN-ENTRY 표시가 있는 index.php)가 설치 폴더에 없어요. 배포 zip 의 관리자 폴더를 다시 올려 주세요.');
        } elseif ($dir === AdminPath::DEFAULT_NAME) {
            $this->add($g, 'admin_dir', '관리자 폴더 이름', 'warn', '기본 이름 그대로', '누구나 짐작할 수 있는 기본 이름이에요. 서버 컴퓨터에서 php cli/tfm.php admin:path --random 을 실행하면 아무도 모르는 이름으로 바뀌고, 새 주소는 그 화면에만 한 번 보여요.');
        } elseif ($cfg !== $dir) {
            $this->add($g, 'admin_dir', '관리자 폴더 이름', 'warn', '바뀜 · 설정에 기록 안 됨', '폴더 이름을 손으로 바꾼 것 같아요. 서버 컴퓨터에서 php cli/tfm.php admin:path 지금폴더이름 을 한 번 실행해 config.local.php 에 기록해 주세요.');
        } else {
            $this->add($g, 'admin_dir', '관리자 폴더 이름', 'ok', '바뀜 · 기록됨', '');
        }
        $copies = count(AdminPath::scan());
        if ($copies > 1) $this->add($g, 'admin_dir_copies', '관리자 폴더 개수', 'warn', $copies . '개', '관리자 센터 폴더가 여러 개 있어요. 쓰지 않는 복사본을 지워 주세요 (그 주소로도 관리자 로그인 화면이 열려요).');
        if ($dir !== '') {
            $extra = AdminPath::extraFiles(TFM_ROOT . DIRECTORY_SEPARATOR . $dir);
            $this->add($g, 'admin_dir_files', '관리자 폴더 안의 파일', $extra ? 'warn' : 'ok', $extra ? count($extra) . '개 더 있음' : 'index.php · .htaccess 만',
                $extra ? '관리자 폴더에는 index.php 와 .htaccess 만 있으면 돼요. 이 파일은 지워 주세요: ' . mb_substr(implode(', ', $extra), 0, 160)
                    . (in_array('admin.css', $extra, true) ? ' (admin.css 는 예전 버전이 남긴 화면 모양 파일이에요. 지금은 lib/admin.css 를 써요.)' : '') : '');
        }

        $list = AdminGate::allowList();
        $bad = array_values(array_filter($list, function ($x) { return !AdminGate::validRule($x); }));
        if (!$list) {
            $this->add($g, 'admin_ip_allowlist', '접속 허용 주소', 'warn', '설정 안 됨 · 어디서나 열림',
                '관리자가 일하는 곳의 인터넷 주소만 열어 두면 더 안전해요. config.local.php 의 security.admin_ip_allowlist 나 환경 변수 TFM_ADMIN_IPS 에 주소(예: 203.0.113.7, 192.168.0.0/24)를 넣으세요. 다른 곳에서는 관리자 주소가 "없는 페이지"로 보여요.');
        } elseif ($bad) {
            $this->add($g, 'admin_ip_allowlist', '접속 허용 주소', 'fail', count($list) . '개 중 ' . count($bad) . '개가 주소 모양이 아님',
                '올바른 IPv4 / IPv6 주소나 범위(예: 192.168.0.0/24)만 적어 주세요. 고칠 항목: ' . mb_substr(implode(', ', $bad), 0, 120));
        } else {
            $this->add($g, 'admin_ip_allowlist', '접속 허용 주소', 'ok', count($list) . '개 주소·범위만 허용', '');
        }

        if (class_exists('Tfm\AdminTotp')) {
            $mode = AdminTotp::mode();
            $cnt = AdminTotp::enrolledCount();
            $names = ['off' => '꺼짐', 'optional' => '선택', 'required' => '필수'];
            $value = $names[$mode] . ' · 등록한 관리자 ' . $cnt['enrolled'] . '/' . $cnt['admins'] . '명';
            if ($mode === 'off') {
                $this->add($g, 'admin_2fa', '2단계 인증', 'warn', $value, '관리자 로그인에 휴대폰 인증 앱의 6자리 숫자를 더하지 않아요. security.admin_2fa (환경 변수 TFM_ADMIN_2FA) 를 optional 이나 required 로 두세요.');
            } elseif ($mode === 'optional') {
                $all = $cnt['admins'] > 0 && $cnt['enrolled'] === $cnt['admins'];
                $this->add($g, 'admin_2fa', '2단계 인증', $all ? 'ok' : 'warn', $value,
                    $all ? '모든 관리자가 등록했어요. security.admin_2fa 를 required 로 바꾸면 등록 안 한 새 관리자도 반드시 등록하게 돼요.' : '아직 등록하지 않은 관리자가 있어요. 관리자 센터 → 🔐 2단계 인증 탭에서 등록하세요.');
            } else {
                $this->add($g, 'admin_2fa', '2단계 인증', 'ok', $value, $cnt['enrolled'] < $cnt['admins'] ? '등록하지 않은 관리자는 다음 로그인 때 등록 화면만 볼 수 있어요.' : '');
            }
        } else {
            $this->add($g, 'admin_2fa', '2단계 인증', 'warn', '아직 준비 중', '2단계 인증 기능 파일(lib/Totp.php)이 없어요.');
        }

        $old = AdminGate::oldPathState(TFM_ROOT . DIRECTORY_SEPARATOR . 'admin.php');
        if ($old === 'page') {
            $this->add($g, 'admin_old_path', '예전 관리자 주소', 'fail', '예전 관리자 화면이 아직 있음',
                '설치 폴더 맨 위에 예전 관리자 화면 파일이 남아 있어 누구나 그 주소로 관리자 로그인 화면을 볼 수 있어요. 새 배포본의 같은 이름 파일로 덮어쓰거나 지워 주세요.');
        } else {
            $this->add($g, 'admin_old_path', '예전 관리자 주소', 'ok', $old === 'stub' ? '없는 페이지로 보임 (404)' : '파일 없음 (404)', '');
        }

        $locked = method_exists('Tfm\Installer', 'locked') && Installer::locked();
        $open = !$locked && method_exists('Tfm\Installer', 'webOpen') && Installer::webOpen();
        $public = $web ? !Http::isLocalhost() : true;
        if ($locked) $this->add($g, 'install_lock', '설치 마법사(install.php) 잠금', 'ok', '잠김 (data/install.lock)', '');
        elseif ($open) $this->add($g, 'install_lock', '설치 마법사(install.php) 잠금', $public ? 'fail' : 'warn', '열려 있음',
            '설치 화면이 아직 열려 있어요. 서버 컴퓨터에서 install.php 로 설치를 마치면 저절로 잠겨요 (설치에는 서버에서만 볼 수 있는 설치 코드가 필요해요).');
        else $this->add($g, 'install_lock', '설치 마법사(install.php) 잠금', 'warn', '닫힘 · 잠금 파일 없음',
            '설치 화면은 이미 쓰는 서버라서 닫혀 있지만 잠금 파일(data/install.lock)이 없어요. 서버 컴퓨터에서 php cli/tfm.php install 을 다시 하거나 빈 data/install.lock 파일을 만들어 두세요.');
    }

    /** the configuration audit of the core owner (Tfm\ConfigAudit, CONTRACT §15.7 #8) as group "config" — guarded */
    private function configAudit(bool $prod): void
    {
        if (class_exists('Tfm\ConfigAudit')) {
            try {
                foreach (ConfigAudit::run() as $r) {
                    if (!is_array($r) || !isset($r['id'], $r['label'], $r['status'])) continue;
                    $this->add('config', 'cfg_' . (string) $r['id'], (string) $r['label'], in_array($r['status'], ['ok', 'warn', 'fail'], true) ? (string) $r['status'] : 'warn',
                        is_scalar($r['value']) ? (string) $r['value'] : '', isset($r['hint']) && is_string($r['hint']) ? $r['hint'] : '');
                }
                return;
            } catch (\Throwable $e) {
                Log::error('HEALTH', 'config audit failed: ' . get_class($e));
                $this->add('config', 'config_audit', '보안 설정 점검', 'warn', '확인하지 못함', '설정 점검 중 문제가 생겼어요 (data/logs 확인).');
            }
        } else {
            $this->add('config', 'config_audit', '보안 설정 점검', 'warn', '아직 준비 중', '설정 점검 기능(lib/ConfigAudit.php)이 이 서버에 아직 없어요. 아래 몇 가지만 직접 확인했어요.');
        }
        // the switches that must never be on on a real host (#16) — only when the full audit is not available
        $on = function ($v): bool { return $v === true || in_array(strtolower((string) $v), ['1', 'on', 'true', 'yes'], true); };
        foreach ([['toss.mock', '모의 결제(toss.mock)'], ['anthropic.mock', '모의 AI(anthropic.mock)'], ['save.admin_bypass', '저장 검증 건너뛰기(save.admin_bypass)']] as $sw) {
            $v = $on(Config::rawGet($sw[0], false));
            $this->add('config', 'cfg_sw_' . str_replace('.', '_', $sw[0]), $sw[1], $v ? ($prod ? 'fail' : 'warn') : 'ok', $v ? '켜짐' : '꺼짐',
                $v ? '시험·시연용 설정이에요. 운영 서버에서는 꺼 주세요 (운영 호스트에서는 실행 중에 자동으로 꺼져요).' : '');
        }
    }

    /** the database account this server really runs as (Db::accountAudit — CONTRACT §15.7 #1) as group "dbacct" */
    private function dbAccount(): void
    {
        if (!method_exists('Tfm\Db', 'accountAudit')) return;
        $g = 'dbacct';
        $a = Db::accountAudit();
        if (isset($a['error'])) {
            $this->add($g, 'db_account_live', 'DB 실행 계정 (접속 확인)', 'warn', '확인하지 못함', '데이터베이스에 물어보지 못했어요 (data/logs 확인).');
            return;
        }
        if ((string) $a['driver'] === 'mysql') {
            $root = !empty($a['isRoot']);
            $empty = !empty($a['emptyPassword']);
            $global = !empty($a['globalPrivileges']);
            $ddl = !empty($a['ddlPrivileges']);
            $fail = $root || $empty || $global;
            $what = (string) $a['user'] . '@' . (string) $a['host'] . ($root ? ' · root' : '') . ($empty ? ' · 빈 비밀번호' : '') . ($global ? ' · 전체 권한' : '');
            $extra = isset($a['extraPrivileges']) && is_array($a['extraPrivileges']) ? implode(', ', array_slice(array_map('strval', $a['extraPrivileges']), 0, 8)) : '';
            $hint = $fail ? '운영에서는 체험관 전용 계정(SELECT · INSERT · UPDATE · DELETE 만)을 쓰세요. 서버 컴퓨터에서 php cli/tfm.php db:account --admin-user root 를 실행하면 전용 계정을 만들어 바꿔 줘요.'
                : ($ddl ? '이 계정에 표를 바꾸는 권한(' . $extra . ')이 있어요. 업그레이드는 관리자 계정으로만 하고, 실행 계정에는 읽기·쓰기 권한만 남기세요.' : '');
            $this->add($g, 'db_account_live', 'DB 실행 계정 (접속 확인)', $fail ? 'fail' : ($ddl ? 'warn' : 'ok'), $what, $hint);
            if (!empty($a['remote']) && empty($a['tls'])) $this->add($g, 'db_tls', 'DB 연결 암호화', 'warn', '암호화 안 됨 (다른 컴퓨터의 DB)', 'DB 가 다른 컴퓨터에 있으면 db.mysql.ssl_ca 로 TLS 를 켜 주세요.');
            if (!empty($a['otherDatabases'])) $this->add($g, 'db_other', 'DB 계정의 다른 데이터베이스 권한', 'warn', '있음', '실행 계정이 체험관 데이터베이스 말고 다른 데이터베이스도 다룰 수 있어요. 권한을 체험관 데이터베이스로만 줄이세요.');
            if (!empty($a['testDatabaseOpen'])) $this->add($g, 'db_testdb', 'MariaDB 기본 test 데이터베이스', 'warn', '누구나 쓸 수 있음', 'MariaDB 를 설치할 때 생기는 test 데이터베이스가 모든 계정에 열려 있어요. phpMyAdmin 이나 mysql_secure_installation 으로 지워 주세요.');
            return;
        }
        // SQLite: the file name is a secret (it is random so nobody can download it) — never printed, only its properties
        $world = !empty($a['worldReadable']);
        $random = !empty($a['randomName']);
        $what = 'SQLite (data 폴더)' . (isset($a['mode']) && $a['mode'] !== '' ? ' · 권한 ' . (string) $a['mode'] : '') . ($random ? ' · 추측하기 어려운 이름' : '');
        $this->add($g, 'db_account_live', 'DB 파일', $world ? 'fail' : ($random ? 'ok' : 'warn'), $what,
            $world ? '데이터베이스 파일을 이 컴퓨터의 다른 사용자도 읽을 수 있어요. 파일 권한을 0600 으로 줄이세요.' : ($random ? '' : 'DB 파일 이름이 짐작하기 쉬워요. db.sqlite_path 를 비우면 무작위 이름으로 만들어요.'));
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
            // abandoned payment windows only: a 'created' order that carries a payment_key is a claimed confirmation whose
            // gateway answer never came (Subscription::claimOrder) — the customer may have paid, so the row stays for the
            // operator (토스 상점관리자) and the next status check looks it up
            'stale_orders' => Db::exec("DELETE FROM orders WHERE status = 'created' AND payment_key = '' AND requested_at < ?", [$now - 7 * 86400000]),
            'log_files' => Log::cleanup(),
            // [scale-server] CONTRACT §16.9: old session files are removed here (no request does it at random any more)
            'sessions' => is_dir(Config::dataDir() . DIRECTORY_SEPARATOR . 'sessions') ? Session::gc() : 0,
        ];
        // [scale-server] expired cache entries, and the presence rows the sync channels still hold in memory
        if (class_exists('Tfm\\Cache')) { $p = Cache::purge(); $out['cache'] = (int) $p['removed']; }
        if (class_exists('Tfm\\Sync')) { try { $out['presence_flushed'] = Sync::flushAll(); } catch (\Throwable $e) { $out['presence_flushed'] = 0; } }
        // [scale-server] the precompressed copies of the page must belong to index.html (a stale copy is removed)
        try { $out['stale_page_copies'] = (int) Api::pageCopies()['removed']; } catch (\Throwable $e) { $out['stale_page_copies'] = 0; }
        if (Db::driver() === 'sqlite') { try { Db::pdo()->exec('PRAGMA wal_checkpoint(TRUNCATE)'); } catch (\Throwable $e) { /* busy */ } }
        Audit::log('maintenance_cleanup', null, $out, 'info', $actor ? (int) $actor['id'] : null);
        return $out;
    }

    /**
     * First admin (finding F4): only while no admin exists, and only with the one-time setup code — it proves that the
     * person can read a file on the server computer (`php cli/tfm.php setup-code` / data/setup-code.php). The network
     * position ("this request comes from localhost") is not trusted any more: a tunnel or a port forwarder makes every
     * visitor look local. security.allow_localhost_bootstrap = false switches the feature off.
     */
    public static function bootstrap(array $user, string $setupCode): string
    {
        if (!Config::get('security.allow_localhost_bootstrap', true)) {
            throw new ApiException(403, 'DISABLED', '첫 관리자 지정 기능이 꺼져 있어요. 서버 컴퓨터에서 php cli/tfm.php promote 이메일 로 지정하세요.');
        }
        if (!class_exists('Tfm\SetupCode')) {
            throw new ApiException(503, 'SETUP_CODE_UNAVAILABLE', '이 서버에는 설치 코드 기능이 없어요. 서버 컴퓨터에서 php cli/tfm.php promote 이메일 로 지정하세요.');
        }
        if (!SetupCode::check($setupCode)) {
            if (class_exists('Tfm\SecEvent')) SecEvent::log('admin_denied', 'warn', ['why' => 'setup_code', 'page' => 'first admin'], (int) $user['id']);
            if (class_exists('Tfm\Firewall')) Firewall::noteAttack('admin_denied');
            SetupCode::ensure(); // an expired code is replaced, so the operator can read a fresh one
            throw new ApiException(403, 'SETUP_CODE', '설치 코드가 맞지 않거나 시간이 지났어요. 서버 컴퓨터에서 php cli/tfm.php setup-code 로 지금 코드를 확인해 주세요.');
        }
        $msg = Db::tx(function () use ($user) {
            if (Users::adminExists()) throw new ApiException(409, 'ADMIN_EXISTS', '이미 관리자가 있어요. 그 관리자에게 권한을 받아 주세요.');
            Users::update((int) $user['id'], ['role' => 'admin'], true);
            Audit::log('admin_bootstrap', (int) $user['id'], ['via' => 'setup_code'], 'alert', (int) $user['id']);
            return "{$user['nickname']} 님을 첫 관리자로 지정했어요.";
        });
        SetupCode::consume();
        return $msg;
    }
}

/**
 * The admin path lock (CONTRACT §15.4, security item 6) — everything the admin entry and api/admin/*.php need:
 *
 *   IP allow-list   security.admin_ip_allowlist (env TFM_ADMIN_IPS): IPv4 / IPv6, single addresses or CIDR; empty = any.
 *                   Another address gets the same plain 404 as a missing page (no session, no cookie, no page header)
 *                   and an admin_ip_denied event. The client address is Http::clientIp() (trusted proxies only).
 *   404             notFoundBody() — under Apache / FPM the site's own missing-page file (e404.html, the ErrorDocument)
 *                   when it exists, else the generic "404 Not Found" page; the old admin.php answers the same.
 *   headers         a CSP without any script, X-Robots-Tag noindex, nofollow, noarchive, Cache-Control no-store,
 *                   Referrer-Policy no-referrer, X-Frame-Options DENY (+ the API set: nosniff, COOP / CORP, HSTS on https)
 *   elevation       the app login is not enough: after the admin form (password + code) the session gets data "adm"
 *                   {uid, born, at, last, tok = sha256(cookie)} and the browser a cookie TFMADM (Path = admin folder,
 *                   HttpOnly, SameSite=Strict, Secure on https). Admin pages need both and keep it alive; api/admin/*
 *                   (the cookie never reaches api/) need the session data and never extend it. security.admin_idle
 *                   (env TFM_ADMIN_IDLE, 1800 s) without an admin page ends it.
 *   sign-in token   a visitor without a session gets no session file (finding F9): the sign-in form carries
 *                   HMAC(app_key, a random value in the folder cookie TFMADMP); the session starts at the POST.
 */
final class AdminGate
{
    public const COOKIE = 'TFMADM';
    public const PRE_COOKIE = 'TFMADMP';
    public const STUB_MARK = 'TFM-ADMIN-STUB';
    /** how long the password step waits for the code / the enrolment (seconds) */
    public const PENDING_TTL = 600;

    /** single addresses and CIDR ranges, IPv4 + IPv6; broken rules and broken addresses match nothing (no warning) */
    public static function cidrMatch(string $ip, array $rules): bool
    {
        return Http::ipInList($ip, $rules);
    }

    /** is one allow-list entry an address or a CIDR range? (for the health check) */
    public static function validRule(string $rule): bool
    {
        $r = trim($rule);
        $p = strpos($r, '/');
        $addr = $p === false ? $r : substr($r, 0, $p);
        if (Http::normIp($addr) === '') return false;
        if ($p === false) return true;
        $bits = substr($r, $p + 1);
        $max = strpos($addr, ':') !== false ? 128 : 32;
        return preg_match('/^\d{1,3}\z/', $bits) === 1 && (int) $bits <= $max;
    }

    /** security.admin_ip_allowlist as a clean list (a comma-separated string is accepted too) */
    public static function allowList(): array
    {
        $v = Config::get('security.admin_ip_allowlist', []);
        if (is_string($v)) $v = explode(',', $v);
        if (!is_array($v)) return [];
        $out = [];
        foreach ($v as $x) if (is_string($x) && trim($x) !== '') $out[] = trim($x);
        return $out;
    }

    /** an empty allow-list lets every address in; a list only its members (no localhost exception) */
    public static function ipAllowed(string $ip): bool
    {
        $list = self::allowList();
        return !$list || self::cidrMatch($ip, $list);
    }

    /** the body of a missing page — the same for the old address, a refused address and path tricks */
    public static function notFoundBody(): string
    {
        if (!in_array(PHP_SAPI, ['cli', 'cli-server'], true)) {
            $f = TFM_ROOT . DIRECTORY_SEPARATOR . 'e404.html';
            if (is_file($f) && (int) @filesize($f) < 65536) {
                $b = @file_get_contents($f);
                if (is_string($b) && $b !== '') return $b;
            }
        }
        return "<!DOCTYPE HTML PUBLIC \"-//IETF//DTD HTML 2.0//EN\">\n<html><head>\n<title>404 Not Found</title>\n</head><body>\n<h1>Not Found</h1>\n"
            . "<p>The requested URL was not found on this server.</p>\n</body></html>\n";
    }

    /** answer like a missing file and stop: 404, the plain body, no cookie, no page header */
    public static function notFound(): void
    {
        while (ob_get_level() > 0) @ob_end_clean();
        if (!headers_sent()) {
            header_remove();
            http_response_code(404);
            header('Content-Type: text/html; charset=UTF-8');
        }
        try { Session::close(); } catch (\Throwable $e) { /* no session */ }
        if (Http::method() !== 'HEAD') echo self::notFoundBody();
        exit;
    }

    /**
     * The old address admin.php (a stub since phase 7): a missing page to everyone, logged as a honeypot visit — a
     * real visitor has no reason to ask for it any more. Like api/trap.php the log is throttled per address.
     */
    public static function oldAddress(): void
    {
        try {
            $blocked = false;
            try { if (class_exists('Tfm\Firewall')) Firewall::check(); } catch (ApiException $e) { $blocked = true; }
            $over = false;
            try { RateLimit::hit('trap', 'ip:' . Sec::hashId(Http::clientIp())); } catch (ApiException $e) { $over = true; }
            if (!$blocked && !$over && class_exists('Tfm\SecEvent')) {
                SecEvent::log('honeypot', 'warn', ['want' => 'old admin address', 'method' => substr(Http::method(), 0, 10)]);
                if (class_exists('Tfm\Firewall')) Firewall::noteAttack('honeypot');
            }
        } catch (\Throwable $e) { /* the answer never depends on the log */ }
        self::notFound();
    }

    /** what is at the old address: 'stub' (this release's 404 file), 'page' (a real page — e.g. an old copy), 'missing' */
    public static function oldPathState(string $file): string
    {
        clearstatcache(true, $file);
        if (!is_file($file)) return 'missing';
        $src = (string) @file_get_contents($file, false, null, 0, 65536);
        $stub = strpos($src, self::STUB_MARK) !== false && strlen($src) < 3000 && strpos($src, 'Session::') === false && stripos($src, 'Location') === false;
        return $stub ? 'stub' : 'page';
    }

    /** the lock headers of every admin page answer (not of the 404s) */
    public static function headers(): void
    {
        if (headers_sent()) return;
        Http::securityHeaders('api');
        header("Content-Security-Policy: default-src 'none'; style-src 'self'; img-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
        header('Content-Type: text/html; charset=utf-8');
        header('X-Robots-Tag: noindex, nofollow, noarchive');
        header('Cache-Control: no-store, max-age=0');
        header('X-Frame-Options: DENY');
    }

    /** security.admin_idle (seconds) */
    public static function idleSeconds(): int
    {
        return max(1, (int) Config::get('security.admin_idle', 1800));
    }

    /** the URL path of the admin folder this request runs in ("/metaverse/admin/") — the cookie Path */
    public static function folderPath(): string
    {
        $s = str_replace('\\', '/', (string) (isset($_SERVER['SCRIPT_NAME']) ? $_SERVER['SCRIPT_NAME'] : ''));
        $d = rtrim(dirname($s), '/') . '/';
        if ($s === '' || strpos($d, '..') !== false || !preg_match('#^/[A-Za-z0-9._~%/-]*\z#', $d)) $d = Http::basePath() . AdminPath::dirName() . '/';
        return $d;
    }

    // ------------------------------------------------------------------ the session (finding F9)

    /**
     * Resume the session only when the request names one that exists: a missing cookie, or a cookie for which the
     * files handler has no session file (made up, or long gone), starts nothing — no session file per request.
     */
    public static function resumeSession(): void
    {
        $name = (string) Config::get('session.name', 'TFMSESSID');
        $id = isset($_COOKIE[$name]) && is_string($_COOKIE[$name]) ? $_COOKIE[$name] : '';
        if ($id === '' || !preg_match('/^[A-Za-z0-9,\-]{22,256}\z/', $id)) return;
        if (strtolower((string) ini_get('session.save_handler')) === 'files') {
            $file = Config::dataDir() . DIRECTORY_SEPARATOR . 'sessions' . DIRECTORY_SEPARATOR . 'sess_' . $id;
            if (!is_file($file)) return;
        }
        Session::start(false);
    }

    private static function preValue(): string
    {
        $v = isset($_COOKIE[self::PRE_COOKIE]) && is_string($_COOKIE[self::PRE_COOKIE]) ? $_COOKIE[self::PRE_COOKIE] : '';
        return preg_match('/^[A-Za-z0-9_\-]{32,64}\z/', $v) ? $v : '';
    }

    private static function preToken(string $pre): string
    {
        return hash_hmac('sha256', 'tfm-admin-sign-in|' . $pre, Config::secret('app_key'));
    }

    /** the form token of the sign-in form for a visitor without a session (sets the folder cookie once) */
    public static function signInToken(): string
    {
        $pre = self::preValue();
        if ($pre === '') {
            $pre = rtrim(strtr(base64_encode(random_bytes(24)), '+/', '-_'), '=');
            Cookie::set(self::PRE_COOKIE, $pre, 0, self::folderPath(), Http::isHttps(), true, 'Lax');
            $_COOKIE[self::PRE_COOKIE] = $pre;
        }
        return self::preToken($pre);
    }

    /** is $token the sign-in token of this browser? */
    public static function checkSignInToken(string $token): bool
    {
        $pre = self::preValue();
        if ($pre === '' || $token === '' || strlen($token) > 128) return false;
        return hash_equals(self::preToken($pre), $token);
    }

    // ------------------------------------------------------------------ the elevation

    /** the elevation data of this session (null: none) */
    public static function state(): ?array
    {
        if (!Session::started()) return null;
        $a = Session::get('adm');
        return is_array($a) && isset($a['uid'], $a['born'], $a['last'], $a['tok']) ? $a : null;
    }

    /** the password step that waits for its code / enrolment (null: none, or for another account, or too old) */
    public static function pending(?array $user): ?array
    {
        if (!$user || !Session::started()) return null;
        $p = Session::get('adm_pending');
        if (!is_array($p) || !isset($p['uid'], $p['born'], $p['at'], $p['need'])) return null;
        if ((int) $p['uid'] !== (int) $user['id'] || (int) $p['born'] !== (int) $user['created_at']) return null;
        if (Clock::ms() - (int) $p['at'] > self::PENDING_TTL * 1000) return null;
        return $p;
    }

    /** remember the password step (need: 'code' | 'enrol'); $login = what was typed, for the shared login throttle */
    public static function setPending(array $user, string $need, string $login): void
    {
        Session::set('adm', null);
        Session::set('adm_pending', ['uid' => (int) $user['id'], 'born' => (int) $user['created_at'], 'at' => Clock::ms(), 'need' => $need,
            'login' => mb_substr(mb_strtolower(trim($login)), 0, 120)]);
    }

    /**
     * Is this account elevated now? $page = an admin page request: it also needs the folder cookie and keeps the
     * elevation alive. An API request needs the session data only and never extends it. $extend = false: a page
     * request that is not the administrator's own doing (the 20-second live refresh of a tab, a report photo) is
     * checked the same way but does not keep the elevation alive — an unattended live tab still ends after
     * security.admin_idle.
     */
    public static function check(?array $user, bool $page, bool $extend = true): bool
    {
        if (!$user || (isset($user['role']) ? $user['role'] : '') !== 'admin') return false;
        $a = self::state();
        if ($a === null || (int) $a['uid'] !== (int) $user['id'] || (int) $a['born'] !== (int) (isset($user['created_at']) ? $user['created_at'] : 0)) return false;
        $now = Clock::ms();
        if ($now - (int) $a['last'] > self::idleSeconds() * 1000) return false;
        if ($page) {
            $c = isset($_COOKIE[self::COOKIE]) && is_string($_COOKIE[self::COOKIE]) ? $_COOKIE[self::COOKIE] : '';
            if ($c === '' || strlen($c) > 128 || !hash_equals((string) $a['tok'], hash('sha256', $c))) return false;
            if ($extend) {
                $a['last'] = $now;
                Session::set('adm', $a);
            }
        }
        return true;
    }

    /** the elevation data exists but its idle time ran out (the page then clears it) */
    public static function expired(): bool
    {
        $a = self::state();
        return $a !== null && Clock::ms() - (int) $a['last'] > self::idleSeconds() * 1000;
    }

    /** grant the elevation after the password (+ code): new session id, new token, the folder cookie */
    public static function grant(array $user, string $via): void
    {
        if (method_exists('Tfm\Session', 'regenerate')) Session::regenerate();
        elseif (session_status() === PHP_SESSION_ACTIVE) session_regenerate_id(true);
        $tok = rtrim(strtr(base64_encode(random_bytes(32)), '+/', '-_'), '=');
        $now = Clock::ms();
        Session::set('adm_pending', null);
        Session::set('adm', ['uid' => (int) $user['id'], 'born' => (int) (isset($user['created_at']) ? $user['created_at'] : 0), 'at' => $now, 'last' => $now,
            'tok' => hash('sha256', $tok), 'via' => $via]);
        Cookie::set(self::COOKIE, $tok, 0, self::folderPath(), Http::isHttps(), true, 'Strict');
    }

    /** end the elevation: session data gone, the folder cookie deleted */
    public static function revoke(): void
    {
        if (Session::started()) {
            Session::set('adm', null);
            Session::set('adm_pending', null);
        }
        Cookie::set(self::COOKIE, '', -1, self::folderPath(), Http::isHttps(), true, 'Strict');
    }

    /**
     * For api/admin/*.php (after Api::run checked the admin role): the same elevation as the admin pages, else
     * 403 ADMIN_REAUTH. An address outside the allow-list is refused too (even with an elevated session).
     */
    public static function requireApi(Ctx $c): void
    {
        if (!self::ipAllowed(Http::clientIp())) {
            if (class_exists('Tfm\SecEvent')) SecEvent::log('admin_ip_denied', 'warn', ['path' => Http::scriptPath()], $c->uid() ?: null);
            if (class_exists('Tfm\Firewall')) Firewall::noteAttack('admin_ip_denied');
            throw new ApiException(403, 'ADMIN_REAUTH', '관리자 정보는 관리자 페이지에서 로그인한 뒤에 볼 수 있어요.');
        }
        if (!self::check($c->user, false)) {
            throw new ApiException(403, 'ADMIN_REAUTH', '관리자 정보는 관리자 페이지에서 로그인한 뒤에 볼 수 있어요.', ['adminUrl' => AdminPath::relUrl()]);
        }
    }

    /** under Apache: did the admin folder's .htaccess run? (it sets TFM_ADMIN_HTACCESS) — null where it cannot be known */
    public static function htaccessSeen(): ?bool
    {
        if (PHP_SAPI !== 'apache2handler') return null;
        foreach (['TFM_ADMIN_HTACCESS', 'REDIRECT_TFM_ADMIN_HTACCESS'] as $k) if (!empty($_SERVER[$k]) || getenv($k)) return true;
        return false;
    }
}

/**
 * The admin folder (CONTRACT §15.4 (a)): its name is free. The entry (index.php) carries MARK in its first lines;
 * dirName() is security.admin_dir when that folder holds the entry, else the folder that does (a rename by hand keeps
 * working). rename() moves the folder and records the name in config.local.php (`php cli/tfm.php admin:path`).
 */
final class AdminPath
{
    public const MARK = 'TFM-ADMIN-ENTRY';
    public const DEFAULT_NAME = 'admin';
    /** names that must stay free for the installation itself */
    private const RESERVED = ['api', 'lib', 'config', 'data', 'database', 'cli', 'uploads', 'docs', 'src', 'tools', 'vendor', 'tests', 'node_modules', 'dist'];
    /** @var string|null */
    private static $cache = null;

    /** 4 to 40 of a-z 0-9 -, starting and ending with a letter or digit */
    public static function valid(string $name): bool
    {
        return preg_match('/^[a-z0-9][a-z0-9\-]{2,38}[a-z0-9]\z/', $name) === 1;
    }

    /** "admin-" + 10 random hex characters */
    public static function random(): string
    {
        return 'admin-' . bin2hex(random_bytes(5));
    }

    /** does this folder hold the admin entry? (its index.php carries the marker) */
    public static function isEntry(string $dir): bool
    {
        $f = $dir . DIRECTORY_SEPARATOR . 'index.php';
        if (!is_file($f)) return false;
        $head = (string) @file_get_contents($f, false, null, 0, 4096);
        return strpos($head, self::MARK) !== false;
    }

    /**
     * What else lies in an admin folder besides index.php and .htaccess (sorted; folders end in "/"): a stylesheet an
     * older release left there (since 2026-11 it is lib/admin.css, sent by the entry after its address check), an editor
     * copy, a note. Apache denies them (an old admin.css answers 404), but they do not belong there.
     */
    public static function extraFiles(string $dir): array
    {
        $out = [];
        foreach ((is_dir($dir) ? (scandir($dir) ?: []) : []) as $f) {
            if ($f === '.' || $f === '..' || $f === 'index.php' || $f === '.htaccess') continue;
            $out[] = $f . (is_dir($dir . DIRECTORY_SEPARATOR . $f) ? '/' : '');
        }
        sort($out);
        return $out;
    }

    /** every folder of the installation that holds the admin entry (sorted) */
    public static function scan(): array
    {
        $out = [];
        foreach (glob(TFM_ROOT . DIRECTORY_SEPARATOR . '*', GLOB_ONLYDIR) ?: [] as $d) {
            $b = basename($d);
            if (preg_match('/^[A-Za-z0-9._~\-]{1,64}\z/', $b) && $b[0] !== '.' && self::isEntry($d)) $out[] = $b;
        }
        sort($out);
        return $out;
    }

    /** the name of the admin folder ('' when there is none) */
    public static function dirName(): string
    {
        if (self::$cache !== null) return self::$cache;
        $cfg = (string) Config::get('security.admin_dir', self::DEFAULT_NAME);
        if (self::valid($cfg) && self::isEntry(TFM_ROOT . DIRECTORY_SEPARATOR . $cfg)) return self::$cache = $cfg;
        $all = self::scan();
        return self::$cache = ($all ? $all[0] : '');
    }

    /** the admin address relative to the installation folder ("admin-1a2b3c4d5e/"); '' when there is no admin folder */
    public static function relUrl(): string
    {
        $d = self::dirName();
        return $d === '' ? '' : $d . '/';
    }

    /** forget what was found (the folder was renamed in this process) */
    public static function reset(): void { self::$cache = null; }

    /**
     * Rename the admin folder to $name and record it (security.admin_dir in config.local.php). Refused before anything
     * is touched: 400 ADMIN_PATH_INVALID (not 4–40 of a-z 0-9 -), 409 ADMIN_PATH_TAKEN (a file or folder of the
     * installation already has the name). The current name only records it. Returns the name.
     */
    public static function rename(string $name): string
    {
        if (!self::valid($name)) throw new ApiException(400, 'ADMIN_PATH_INVALID', '폴더 이름은 영어 소문자 · 숫자 · 빼기(-)로 4~40자예요 (처음과 끝은 글자나 숫자).');
        $cur = self::dirName();
        if ($cur === '') throw new ApiException(404, 'ADMIN_PATH_MISSING', '관리자 폴더(맨 위에 ' . self::MARK . ' 표시가 있는 index.php 가 든 폴더)를 찾지 못했어요.');
        if ($name !== $cur) {
            if (in_array($name, self::RESERVED, true) || file_exists(TFM_ROOT . DIRECTORY_SEPARATOR . $name)) {
                throw new ApiException(409, 'ADMIN_PATH_TAKEN', '그 이름은 이미 설치 폴더 안에 있어요. 다른 이름을 골라 주세요.');
            }
            if (!@rename(TFM_ROOT . DIRECTORY_SEPARATOR . $cur, TFM_ROOT . DIRECTORY_SEPARATOR . $name)) {
                throw new ApiException(500, 'ADMIN_PATH_RENAME', '폴더 이름을 바꾸지 못했어요. 그 폴더를 연 프로그램(탐색기 · 편집기)을 닫고 다시 해 주세요.');
            }
            self::$cache = null;
            Audit::log('admin_path_renamed', null, ['from' => $cur, 'to' => $name], 'warn');
        }
        if (!method_exists('Tfm\Installer', 'mergeLocalConfig')) {
            throw new ApiException(500, 'ADMIN_PATH_RECORD', '설정 파일에 새 이름을 기록하지 못했어요. config.local.php 의 security.admin_dir 에 직접 적어 주세요.');
        }
        Installer::mergeLocalConfig(['security' => ['admin_dir' => $name]]);
        self::$cache = null;
        return $name;
    }
}
