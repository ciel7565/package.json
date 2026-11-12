<?php
/**
 * Tfm\ConfigAudit — environment / configuration safety audit (CONTRACT §15.7 #8, #16).
 *
 *   ConfigAudit::run(): array   rows ['id' => string, 'label' => Korean, 'status' => 'ok'|'warn'|'fail', 'value' => string, 'hint' => Korean]
 *
 * It reads the WRITTEN configuration (Config::rawGet — the values of config.php / config.local.php / the environment,
 * before the runtime production lock) so it can still flag a mock-payment or debug switch that the lock silences at
 * run time. A secret value is NEVER put in a row: only "설정됨 / 설정 안 됨 / 기본값". Used by the developer tab's
 * 점검 (Inspect), the health check, `php cli/tfm.php config:check` and install.php.
 *
 * "Production host" = app.env is production AND the request is not from the server machine itself (a non-local host).
 * On the command line there is no request, so it is treated as a real host (the operator wants to be warned).
 * PHP 7.2 syntax only.
 */
declare(strict_types=1);

namespace Tfm;

if (!defined('TFM_BOOT')) { if (function_exists('header_remove')) header_remove('X-Powered-By'); http_response_code(404); exit; }

final class ConfigAudit
{
    /** @return array<int, array{id:string,label:string,status:string,value:string,hint:string}> */
    public static function run(): array
    {
        $rows = [];
        $add = function (string $id, string $label, string $status, string $value, string $hint = '') use (&$rows): void {
            $rows[] = ['id' => $id, 'label' => $label, 'status' => in_array($status, ['ok', 'warn', 'fail'], true) ? $status : 'warn', 'value' => $value, 'hint' => $hint];
        };
        $env = strtolower((string) Config::rawGet('app.env', 'production'));
        $isProd = $env === 'production';
        // a real deployment host: not the server machine itself. On the CLI there is no request → treat as a real host.
        $local = PHP_SAPI === 'cli' ? false : Http::isLocalhost();
        $prodHost = $isProd && !$local;
        $on = function ($v): bool { return in_array(strtolower((string) $v), ['1', 'on', 'true', 'yes'], true); };

        // ---------------------------------------------------------------- app secret (data/secret.php)
        try {
            $key = Config::secret('app_key');
            $weak = strlen($key) < 32 || !ctype_xdigit($key);
            $add('app_key', '앱 비밀키(IP 해시·업로드 이름)', $weak ? 'warn' : 'ok', $weak ? '약함' : '설정됨 (' . strlen($key) . '자)',
                $weak ? 'data/secret.php 의 app_key 가 약해요. 파일을 지우면 다음 실행 때 새로 만들어져요(기존 로그인·해시는 무효).' : '');
        } catch (\Throwable $e) {
            $add('app_key', '앱 비밀키', 'fail', '만들 수 없음', 'data/ 폴더가 쓰기 가능한지 확인하세요 (secret.php 를 만들지 못했어요).');
        }

        // ---------------------------------------------------------------- private files: not world-writable, not web-readable
        foreach ([['config/config.local.php', '설정 파일(config.local.php)'], ['data/secret.php', '비밀키 파일(secret.php)']] as $pair) {
            $path = $pair[0] === 'data/secret.php' ? Config::dataDir() . DIRECTORY_SEPARATOR . 'secret.php' : TFM_ROOT . DIRECTORY_SEPARATOR . str_replace('/', DIRECTORY_SEPARATOR, $pair[0]);
            if (!is_file($path)) { $add('perm_' . md5($pair[0]), $pair[1] . ' 권한', 'ok', '없음'); continue; }
            $world = self::worldWritable($path);
            $add('perm_' . md5($pair[0]), $pair[1] . ' 권한', $world ? 'fail' : 'ok', $world ? '누구나 쓰기 가능' : '안전',
                $world ? '이 파일을 다른 사용자가 고칠 수 없게 권한을 좁히세요 (예: chmod 640).' : '');
        }
        // self-probe: config.local.php / secret.php must not be fetchable over the web (only when a base URL is known)
        self::webReadProbe($add);

        // ---------------------------------------------------------------- admin accounts
        $admins = (array) Config::rawGet('security.admin_emails', []);
        if ($admins) {
            $add('admin_emails', '관리자 이메일 목록(admin_emails)', 'warn', count($admins) . '개 설정됨',
                '이메일만으로는 관리자로 올리지 않아요(소유 증명이 없어 위험). 관리자는 설치 첫 계정이나 `php cli/tfm.php promote 이메일` 로만 지정하세요. 이 목록은 지워도 돼요.');
        } else {
            $add('admin_emails', '관리자 이메일 목록(admin_emails)', 'ok', '비어 있음');
        }
        try {
            $hasAdmin = Users::adminExists();
            $add('admin_exists', '관리자 계정', $hasAdmin ? 'ok' : 'warn', $hasAdmin ? '있음' : '없음',
                $hasAdmin ? '' : '아직 관리자가 없어요. 설치 마법사의 첫 계정이나 `php cli/tfm.php promote 이메일` 로 지정하세요.');
        } catch (\Throwable $e) { /* DB not ready */ }

        // ---------------------------------------------------------------- data directory location
        $dataDir = str_replace('\\', '/', Config::dataDir());
        $root = str_replace('\\', '/', (string) TFM_ROOT);
        $inside = Str::startsWith($dataDir . '/', $root . '/');
        $add('data_dir', '데이터 폴더 위치', $inside ? 'warn' : 'ok', $inside ? '웹 루트 안' : '웹 루트 밖',
            $inside ? 'DB·로그·비밀키가 웹 루트 안에 있어요. .htaccess 가 막지만, 가장 안전한 방법은 TFM_DATA_DIR 로 웹 루트 밖을 지정하는 거예요.' : '');

        // ---------------------------------------------------------------- HTTPS forced
        $fh = strtolower((string) Config::rawGet('security.force_https', 'auto'));
        $fhOff = $fh === 'off';
        $add('force_https', 'HTTPS 강제', $fhOff && $prodHost ? 'fail' : ($fhOff ? 'warn' : 'ok'), $fh,
            $fhOff ? ($prodHost ? '운영 서버에서 HTTPS 강제가 꺼져 있어요. 인증서를 설치하고 force_https 를 auto/on 으로 두세요.' : '인증서가 없는 내부망에서만 off 로 두세요.') : '');

        // ---------------------------------------------------------------- debug / mock switches (refused at runtime on a prod host)
        foreach ([
            ['toss.mock', '모의 결제(toss.mock)', '실제 결제 대신 모의 결제가 켜져 있어요. 운영에서는 끄고 토스 키를 넣으세요 (운영 호스트에서는 자동으로 무시돼요).'],
            ['anthropic.mock', '모의 AI(anthropic.mock)', '모의 AI 응답이 켜져 있어요. 운영에서는 끄세요 (운영 호스트에서는 자동으로 무시돼요).'],
            ['save.admin_bypass', '저장 검증 건너뛰기(save.admin_bypass)', '관리자 저장 검증 우회가 켜져 있어요. 치트·디버그용이에요. 운영에서는 끄세요 (운영 호스트에서는 자동으로 무시돼요).'],
        ] as $sw) {
            $val = $on(Config::rawGet($sw[0], false)) || Config::rawGet($sw[0], false) === true;
            $id = 'sw_' . str_replace('.', '_', $sw[0]);
            $add($id, $sw[1], $val && $prodHost ? 'fail' : ($val ? 'warn' : 'ok'), $val ? '켜짐' : '꺼짐', $val ? $sw[2] : '');
        }
        $lvl = strtolower((string) Config::rawGet('logs.level', 'info'));
        $add('log_level', '로그 상세도(logs.level)', $lvl === 'debug' && $prodHost ? 'fail' : ($lvl === 'debug' ? 'warn' : 'ok'), $lvl,
            $lvl === 'debug' ? '운영에서는 debug 로그가 너무 많고 민감할 수 있어요. info 이상으로 두세요 (운영 호스트에서는 자동으로 올려요).' : '');
        $add('app_env', '실행 모드(app.env)', $isProd ? 'ok' : 'warn', $env,
            $isProd ? '' : 'development 모드는 로그가 더 자세해요. 운영 서버에서는 production 으로 두세요.');

        // ---------------------------------------------------------------- display_errors / expose_php (effective)
        $add('display_errors', 'display_errors(효과값)', $on(ini_get('display_errors')) ? 'warn' : 'ok', $on(ini_get('display_errors')) ? 'On' : 'Off',
            $on(ini_get('display_errors')) ? '앱은 실행 중 끄지만 php.ini 에서도 Off 로 두세요 (오류가 브라우저에 보이지 않게).' : '');
        $add('expose_php', 'expose_php(효과값)', $on(ini_get('expose_php')) ? 'warn' : 'ok', $on(ini_get('expose_php')) ? 'On' : 'Off',
            $on(ini_get('expose_php')) ? 'php.ini 에서 expose_php = Off 로 두세요 (PHP 버전 노출 방지). 서버(Apache)도 ServerTokens Prod 로.' : '');

        // ---------------------------------------------------------------- trusted proxies
        $tp = (array) Config::rawGet('security.trusted_proxies', []);
        $tpBad = [];
        foreach ($tp as $p) { if (!is_string($p) || (Http::normIp(trim($p)) === '' && !preg_match('#^[0-9a-fA-F:.]+/\d{1,3}$#', trim($p)))) $tpBad[] = (string) $p; }
        $add('trusted_proxies', '신뢰 프록시(trusted_proxies)', $tpBad ? 'warn' : 'ok', $tp ? count($tp) . '개' : '없음',
            $tpBad ? '올바르지 않은 주소가 있어요: ' . mb_substr(implode(', ', $tpBad), 0, 60) . '. 리버스 프록시 뒤일 때만 그 IP 를 적으세요.' : '');

        // ---------------------------------------------------------------- CORS list
        $cors = (array) Config::rawGet('security.cors_allowed_origins', []);
        $corsBad = [];
        foreach ($cors as $o) {
            if (!is_string($o)) { $corsBad[] = '(문자열 아님)'; continue; }
            $o = trim($o);
            if ($o === '*') $corsBad[] = '*';
            elseif (!preg_match('#^https://[A-Za-z0-9.\-]{1,253}(?::\d{1,5})?$#', $o)) $corsBad[] = $o; // https only, exact host
        }
        $hasStar = in_array('*', array_map(function ($x) { return is_string($x) ? trim($x) : ''; }, $cors), true);
        $add('cors', 'CORS 허용 주소(cors_allowed_origins)', $hasStar ? 'fail' : ($corsBad ? 'warn' : 'ok'), $cors ? count($cors) . '개' : '없음',
            $corsBad ? ($hasStar ? "'*' 는 쓸 수 없어요. 정확한 https://호스트 만 적으세요." : '올바르지 않은 주소가 있어요: ' . mb_substr(implode(', ', $corsBad), 0, 60) . ' (https 만, 정확한 호스트).') : '');

        // ---------------------------------------------------------------- payment keys
        try {
            $keysConfigured = Toss::keysConfigured();
            $mock = $on(Config::rawGet('toss.mock', false)) || Config::rawGet('toss.mock', false) === true;
            $add('toss_keys', '결제 키(토스페이먼츠)', $keysConfigured ? 'ok' : ($mock ? 'warn' : 'warn'), $keysConfigured ? '설정됨' : '문서용 기본 키',
                $keysConfigured ? '' : ($mock ? '모의 결제 중이에요. 실제 결제는 토스 개발자센터의 키를 넣고 mock 을 끄세요.' : '실제 결제를 받으려면 토스 키를 TFM_TOSS_CLIENT_KEY / TFM_TOSS_SECRET_KEY 로 넣으세요 (지금은 문서용 키라 "설정 필요").'));
        } catch (\Throwable $e) { /* Toss not loaded */ }

        // ---------------------------------------------------------------- DB runtime account (read the config only; Db::accountAudit for the live side)
        self::dbRow($add, $on);

        // ---------------------------------------------------------------- web server hardening (httpd.conf-only directives)
        // ServerTokens (the Server: version banner) and TraceEnable (the TRACE method) cannot be changed from .htaccess —
        // Apache answers TRACE from its core before any .htaccess rule runs, and the Server banner is a server-config
        // decision. When this audit runs behind a web server that still shows a version, remind the operator.
        $sw = (string) (isset($_SERVER['SERVER_SOFTWARE']) ? $_SERVER['SERVER_SOFTWARE'] : '');
        if ($sw !== '') {
            $showsVersion = (bool) preg_match('#/\d#', $sw);
            $add('server_hardening', '웹 서버 설정(ServerTokens · TraceEnable)', $showsVersion ? 'warn' : 'ok',
                $showsVersion ? mb_substr($sw, 0, 40) : '숨김',
                $showsVersion ? 'httpd.conf 에 "ServerTokens Prod"(서버 버전 숨김)와 "TraceEnable Off"(TRACE 메서드 차단)를 넣으세요. 이 두 가지는 .htaccess 로는 바꿀 수 없어요.' : '');
        }

        // ---------------------------------------------------------------- session cookie flags (effective values)
        $sess = (array) Config::rawGet('session', []);
        $bindUa = $on(isset($sess['bind_user_agent']) ? $sess['bind_user_agent'] : true) || (isset($sess['bind_user_agent']) ? $sess['bind_user_agent'] === true : true);
        $add('session_cookie', '세션 쿠키 설정', 'ok', 'HttpOnly · SameSite=Lax · Secure(https) · 엄격 모드' . ($bindUa ? ' · UA 지문' : ''),
            $bindUa ? '' : 'UA 지문 묶기(bind_user_agent)가 꺼져 있어요. 켜면 쿠키 탈취에 조금 더 강해져요.');

        return $rows;
    }

    /** the worst status among the rows: 'fail' > 'warn' > 'ok' */
    public static function worst(array $rows): string
    {
        $worst = 'ok';
        foreach ($rows as $r) {
            $s = isset($r['status']) ? $r['status'] : 'ok';
            if ($s === 'fail') return 'fail';
            if ($s === 'warn') $worst = 'warn';
        }
        return $worst;
    }

    /** {ok, warn, fail} counts */
    public static function summary(array $rows): array
    {
        $out = ['ok' => 0, 'warn' => 0, 'fail' => 0];
        foreach ($rows as $r) { $s = isset($r['status']) ? $r['status'] : 'ok'; if (isset($out[$s])) $out[$s]++; }
        return $out;
    }

    // ------------------------------------------------------------------ helpers

    private static function worldWritable(string $path): bool
    {
        if (DIRECTORY_SEPARATOR === '\\') return false; // POSIX mode bits are meaningless on Windows
        $p = @fileperms($path);
        return $p !== false && ($p & 0x0002) !== 0; // other-write bit
    }

    /** read the DB config (never connect for this): a root / empty-password runtime account is a ⛔ */
    private static function dbRow(callable $add, callable $on): void
    {
        $driver = strtolower((string) Config::rawGet('db.driver', 'sqlite'));
        if ($driver !== 'mysql') {
            $add('db_account', 'DB 계정', 'ok', 'SQLite (계정 없음)');
            return;
        }
        $m = (array) Config::rawGet('db.mysql', []);
        $user = strtolower(trim((string) (isset($m['username']) ? $m['username'] : 'root')));
        $pass = (string) (isset($m['password']) ? $m['password'] : '');
        $isRoot = $user === 'root';
        $empty = $pass === '';
        $status = ($isRoot || $empty) ? 'fail' : 'ok';
        $what = $isRoot && $empty ? 'root · 비밀번호 없음' : ($isRoot ? 'root' : ($empty ? '비밀번호 없음' : $user));
        $add('db_account', 'DB 실행 계정(설정값)', $status, $what,
            $status === 'fail' ? '운영에서는 앱 전용 계정(DML 권한만)을 쓰세요. install.php 또는 cli install 이 tfm_<무작위> 계정을 만들어요. (지금 설정: ' . ($isRoot ? 'root' : $user) . ($empty ? ', 빈 비밀번호' : '') . ')' : '');
        $migrate = $on(Config::rawGet('db.auto_migrate', true)) || Config::rawGet('db.auto_migrate', true) === true;
        $add('db_auto_migrate', 'DB 자동 스키마 변경(auto_migrate)', $migrate ? 'warn' : 'ok', $migrate ? '켜짐' : '꺼짐',
            $migrate ? '운영에서는 꺼 두고 업그레이드는 `php cli/tfm.php migrate --admin-user …` 로 하세요 (실행 계정에 DDL 권한이 없게).' : '');
    }

    /**
     * Self-probe (only when a web server answers the request and curl is available): fetch config.local.php / secret.php
     * over the web from the server itself. A 200 with content means .htaccess is not protecting data/ — ⛔.
     * Skipped on the CLI (no web server) and under php -S: the built-in server never reads .htaccess and answers one
     * request at a time, so asking itself would only wait for the timeout (2 × 3 s on every health check) and prove nothing.
     */
    private static function webReadProbe(callable $add): void
    {
        if (!function_exists('curl_init') || PHP_SAPI === 'cli' || PHP_SAPI === 'cli-server') { return; }
        try {
            // finding F19: the probe never goes to the name in the Host header (a visitor chooses it). The server asks
            // itself on the loopback address, on a port the request may name only when it is a common web port
            // (Health::probePort); anything else skips the probe. The Host header only picks the virtual host.
            $port = Health::probePort();
            if ($port === 0) return;
            $scheme = Http::isHttps() ? 'https' : 'http';
            $base = $scheme . '://127.0.0.1:' . $port . Http::basePath();
            $vhost = preg_replace('/[^A-Za-z0-9.:\-\[\]]/', '', (string) (isset($_SERVER['SERVER_NAME']) ? $_SERVER['SERVER_NAME'] : 'localhost'));
            foreach (['config/config.local.php' => '설정 파일', 'data/secret.php' => '비밀키 파일'] as $rel => $label) {
                $url = $base . $rel;
                $ch = curl_init($url);
                if (!$ch) continue;
                curl_setopt_array($ch, [
                    CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 3, CURLOPT_CONNECTTIMEOUT => 2,
                    CURLOPT_FOLLOWLOCATION => false, CURLOPT_SSL_VERIFYPEER => false, CURLOPT_SSL_VERIFYHOST => 0,
                    CURLOPT_NOBODY => false, CURLOPT_HTTPHEADER => ['Host: ' . ($vhost !== '' ? $vhost : 'localhost')],
                ]);
                $body = (string) curl_exec($ch);
                $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
                $ch = null;
                $readable = $code === 200 && (Str::contains($body, '<?php') || Str::contains($body, 'return') || Str::contains($body, 'app_key'));
                if ($readable) {
                    $add('webread_' . md5($rel), $label . ' 웹 노출', 'fail', '웹에서 열림',
                        $rel . ' 가 브라우저에서 열려요. Apache 는 .htaccess(Require all denied)가 막아야 하고, Nginx 는 location 규칙을 추가하세요. 가장 안전한 방법은 TFM_DATA_DIR 로 웹 루트 밖입니다.');
                }
            }
        } catch (\Throwable $e) { /* probe is best effort */ }
    }
}
