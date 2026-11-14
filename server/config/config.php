<?php
/**
 * 전통발효체험관 메타버스 — 서버 설정 (server mode)
 *
 * ▶ 이 파일은 "기본값"입니다. 직접 고치기보다 같은 폴더에 config.local.php 를 만들어
 *   바꾸고 싶은 값만 덮어쓰는 것을 권장합니다 (업데이트 시 덮어써지지 않음).
 *       <?php return ['db' => ['driver' => 'mysql', 'mysql' => ['password' => '비밀번호']]];
 * ▶ 환경 변수(TFM_*)로도 덮어쓸 수 있습니다 (Apache: SetEnv, Nginx/PHP-FPM: env[...] / fastcgi_param).
 *
 * XAMPP 빠른 시작 (Apache 2.4 · PHP 7.2 이상(64비트) · MariaDB 10.3 이상 — docs/SERVER-INSTALL-KO.md 참고)
 *   1) 배포 zip 의 metaverse 폴더를 C:\xampp\htdocs\metaverse 로 복사
 *   2) XAMPP Control Panel 에서 Apache(+ MySQL) 시작
 *   3) http://localhost/metaverse/install.php 를 열어 설치 마법사를 따라가면 이 파일 옆에 config.local.php 가 만들어지고
 *      데이터베이스 테이블과 첫 관리자가 생겨요 (완료 후 data/install.lock 으로 잠김)
 *   4) http://localhost/metaverse/ 접속 → 상단 칩이 "서버"로 보이면 서버 모드
 *   phpMyAdmin 으로 직접 만들 때는 database/schema.sql 가져오기(Import) 후 아래 'db' 값을 config.local.php 에 적으세요.
 *
 * 보안 메모
 *   - data/ (DB·로그·세션·비밀키)는 웹에서 직접 열리면 안 됩니다. Apache 는 .htaccess 로 막혀 있고,
 *     Nginx 는 README-SERVER.md 의 location 규칙을 추가하세요. 가장 안전한 방법은 TFM_DATA_DIR 로
 *     웹 루트 밖(예: C:\xampp\metaverse-data)을 지정하는 것입니다.
 *   - 관리자 계정: 설치 마법사의 첫 계정, 또는 CLI: php cli/tfm.php promote 이메일. 관리자가 한 명도 없을 때는
 *     관리자 페이지(admin/ 폴더)에서 "관리자로 지정"을 할 수 있는데, 서버 PC 에서만 볼 수 있는 한 번용 설치 코드
 *     (php cli/tfm.php setup-code)가 꼭 있어야 해요. 이메일 목록만으로 관리자가 되지는 않아요. 예전 주소 admin.php 는 언제나 404.
 */
declare(strict_types=1);

if (!defined('TFM_BOOT')) { if (function_exists('header_remove')) header_remove('X-Powered-By'); http_response_code(404); exit; }

/** typed env reader: TFM_FOO=... (bool: 1/0/true/false/on/off, int, float, csv list) */
$env = static function (string $key, $default) {
    $v = getenv($key);
    if ($v === false || $v === '') return $default;
    if (is_bool($default)) return in_array(strtolower(trim($v)), ['1', 'true', 'on', 'yes'], true);
    if (is_int($default)) return (int) $v;
    if (is_float($default)) return (float) $v;
    if (is_array($default)) return array_values(array_filter(array_map('trim', explode(',', $v)), 'strlen'));
    return (string) $v;
};

return [
    'app' => [
        'name'     => '전통발효체험관 메타버스',
        'env'      => $env('TFM_ENV', 'production'),   // production | development (development: 로그를 더 자세히)
        'timezone' => $env('TFM_TIMEZONE', 'Asia/Seoul'),
    ],

    // ------------------------------------------------------------------ database
    'db' => [
        'driver'       => $env('TFM_DB_DRIVER', 'sqlite'),  // sqlite (기본, 설정 불필요) | mysql (MySQL 5.7+/MariaDB 10.3+; install.php 가 설정)
        // 비워 두면 data/ 안에 추측하기 어려운 이름(db-<무작위>.sqlite)으로 자동 생성합니다.
        'sqlite_path'  => $env('TFM_SQLITE_PATH', ''),
        'mysql' => [
            'host'     => $env('TFM_DB_HOST', '127.0.0.1'),
            'port'     => $env('TFM_DB_PORT', 3306),
            'socket'   => $env('TFM_DB_SOCKET', ''),
            'database' => $env('TFM_DB_NAME', 'fermentation_metaverse'),
            // 기본값 없음: install.php / php cli/tfm.php install 이 체험관 전용 계정(tfm_무작위, 읽기·쓰기만 가능)을 만들어
            // config.local.php 에 적어요. root 같은 데이터베이스 관리자 계정은 설치할 때 한 번만 쓰고 저장하지 않아요.
            'username' => $env('TFM_DB_USER', ''),
            'password' => $env('TFM_DB_PASS', ''),
            // 데이터베이스가 다른 컴퓨터에 있으면 암호화(TLS)가 필요해요: 'ssl_ca' => 'C:\\xampp\\mysql\\ca.pem'
            // (같은 내부망이라 암호화 없이 써도 된다면 'allow_insecure_remote' => true)
            // [scale-server] true: PHP 프로세스가 데이터베이스 연결을 요청 사이에 그대로 두고 다시 써요 (접속이 아주 많을 때만; docs/SCALING-KO.md)
            'persistent' => $env('TFM_DB_PERSISTENT', false),
        ],
        // 테이블이 없거나 오래되면 database/schema*.sql 로 자동으로 만들고 올려요. 전용 계정은 표를 바꿀 수 없으므로 설치 마법사가
        // false 로 적고, 업데이트는 php cli/tfm.php migrate --admin-user root 로 해요.
        'auto_migrate' => $env('TFM_DB_AUTO_MIGRATE', true),
    ],

    // ------------------------------------------------------------------ paths
    'paths' => [
        'data'    => $env('TFM_DATA_DIR', ''),     // 빈 값 = <설치폴더>/data  (권장: 웹 루트 밖 경로)
        'uploads' => $env('TFM_UPLOAD_DIR', ''),   // 빈 값 = <설치폴더>/uploads (브라우저가 이미지를 직접 읽으므로 웹 루트 안)
    ],

    // ------------------------------------------------------------------ security
    'security' => [
        // 리버스 프록시(로드밸런서) 뒤에 있을 때만 그 IP 를 적으세요. 그 외에는 X-Forwarded-* 헤더를 믿지 않습니다.
        'trusted_proxies'           => $env('TFM_TRUSTED_PROXIES', []),
        'hsts'                      => $env('TFM_HSTS', true),          // https 일 때만 전송
        // 예전 설정: 이 목록의 이메일로 가입/로그인하면 관리자로 올렸지만, 지금은 아무 권한도 주지 않아요 (이메일 주인이
        //   맞는지 확인할 방법이 없어, 먼저 가입한 사람이 관리자가 될 수 있었어요). 비워 두세요 — 점검 화면이 알려 줘요.
        //   관리자는 설치 마법사의 첫 계정이나 `php cli/tfm.php promote 이메일` 로만 지정해요.
        'admin_emails'              => $env('TFM_ADMIN_EMAILS', []),
        // 관리자가 한 명도 없을 때 관리자 페이지에서 첫 관리자를 지정할 수 있게 해요. 서버 PC 에서만 읽을 수 있는 한 번용
        //   설치 코드(php cli/tfm.php setup-code)가 꼭 필요해요 (접속 주소가 localhost 인지는 믿지 않아요). false = 이 기능 끄기.
        'allow_localhost_bootstrap' => $env('TFM_LOCAL_BOOTSTRAP', true),
        // 출처 검사: 브라우저가 보내는 Origin/Sec-Fetch-Site 가 다른 사이트이면 상태 변경 요청 거부
        'check_origin'              => $env('TFM_CHECK_ORIGIN', true),
        // ---- 요청 잠금 (CONTRACT §15.7 #2 #5 #10) ----
        // HTTPS 강제: auto(기본 — localhost / 127.0.0.1 / ::1 로 연 경우만 빼고 항상) | on | off
        //   http 로 온 GET 은 https 주소로 옮기고(308), 그 밖의 요청(로그인·저장 등)은 403 HTTPS_REQUIRED 로 거절해요.
        //   인증서가 없는 교육장 내부망에서만 off 로 두세요 (점검 화면에 ⛔ 로 보여요).
        'force_https'               => $env('TFM_FORCE_HTTPS', 'auto'),
        // 다른 사이트에서 읽어도 되는 주소 목록 (정확히 "https://호스트[:포트]"; '*' 는 쓸 수 없어요). 비어 있으면 같은 사이트만.
        //   허용된 주소도 공개 읽기 API(ping · time · ranking/top · sub/status)의 GET 만 읽을 수 있고, 로그인 정보는 따라가지 않아요.
        'cors_allowed_origins'      => $env('TFM_CORS_ORIGINS', []),
        // 수상한 요청이 한 주소에서 window(초) 안에 threshold 번 넘게 오면 duration(초) 동안 그 주소를 막아요
        //   (다시 걸릴 때마다 2배, 최대 24시간). 이 서버 PC(localhost)와 exempt 의 주소(IP·CIDR)는 자동으로 막지 않아요.
        'block' => [
            'threshold' => $env('TFM_BLOCK_THRESHOLD', 25),
            'window'    => 600,
            'duration'  => 1800,
            'exempt'    => $env('TFM_BLOCK_EXEMPT', []),      // 예: 학교·교육장의 인터넷 주소 ['203.0.113.7', '192.168.0.0/24']
        ],
        'events_days'               => 90,      // 보안 기록(security_events) 보관 기간(일)
        'events_per_minute'         => 120,     // 한 주소에서 1분에 남기는 보안 기록의 상한 (기록 넘침 방지)
        // 큰 일(자동 차단 등)이 생기면 알림을 보낼 곳 — 비워 두면 보내지 않아요. 요청에 담긴 값은 쓰지 않고 여기 적힌 곳으로만 보내요.
        'alert_email'               => $env('TFM_ALERT_EMAIL', ''),     // 예: 'ops@example.org' (PHP mail() 이 되는 서버)
        'alert_webhook'             => $env('TFM_ALERT_WEBHOOK', ''),   // 예: 'https://hooks.example.org/...' (https 만, 3초 안에 응답)
        'alert_interval'            => 600,     // 같은 종류의 알림은 이 시간(초)에 한 번만
        // ---- 관리자 페이지 잠금 (CONTRACT §15.4) — owner: admin agent ----
        // 관리자 폴더 이름. 폴더 이름을 바꾸면(php cli/tfm.php admin:path --random) 여기에 기록돼요. 예전 주소 admin.php 는 언제나 404.
        'admin_dir'                 => 'admin',
        // 이 주소(IPv4/IPv6, CIDR 가능)에서만 관리자 페이지가 열려요. 비어 있으면 어디서나(로그인 + 권한 필요). 예: ['203.0.113.7', '192.168.0.0/24']
        'admin_ip_allowlist'        => $env('TFM_ADMIN_IPS', []),
        // 관리자 2단계 인증(휴대폰 인증 앱의 6자리 숫자): off | optional(기본 — 등록 전까지 점검 화면이 경고) | required
        'admin_2fa'                 => $env('TFM_ADMIN_2FA', 'optional'),
        // 관리자 화면을 이 시간(초) 동안 쓰지 않으면 다시 확인(비밀번호 + 2단계)을 받아요
        'admin_idle'                => $env('TFM_ADMIN_IDLE', 1800),
    ],

    // ------------------------------------------------------------------ sessions
    'session' => [
        'name'              => 'TFMSESSID',
        'idle_timeout'      => $env('TFM_SESSION_IDLE', 7200),       // 2시간 동안 요청이 없으면 만료
        'absolute_lifetime' => $env('TFM_SESSION_MAX', 86400),       // 로그인 후 최대 24시간
        'remember_days'     => $env('TFM_REMEMBER_DAYS', 30),        // "로그인 유지" 선택 시 쿠키·세션 최대 수명(일)
        'remember_idle'     => $env('TFM_REMEMBER_IDLE', 604800),    // "로그인 유지" 세션의 유휴 만료(7일)
        'bind_user_agent'   => $env('TFM_SESSION_BIND_UA', true),    // User-Agent 지문이 바뀌면 세션 폐기
    ],

    // ------------------------------------------------------------------ login throttling (login_attempts)
    'login' => [
        'window'          => 900,   // 실패 횟수를 세는 기간(초)
        'max_failures'    => 5,     // 같은 IP+계정으로 이 횟수 실패하면 잠금
        'base_lock'       => 30,    // 첫 잠금 시간(초) — 이후 실패할 때마다 2배 (지수 증가)
        'max_lock'        => 3600,  // 최대 잠금 시간(초)
        'account_max'     => 15,    // 여러 IP 에서 한 계정을 노리는 경우: 이 횟수부터 계정 단위 잠금
        'ip_max_failures' => 60,    // 한 IP 에서 여러 계정을 대입하는 경우: IP 단위 잠금 (학교·단체는 한 IP 를 함께 씀)
        'ip_lock'         => 900,
    ],

    // ------------------------------------------------------------------ rate limits [requests, window seconds]
    // 로그인 사용자는 계정별, 비로그인 방문자는 브라우저 세션별로 셉니다. 비로그인 요청은 추가로 같은 IP 전체에
    // (한도 × rate_limit_ip_multiplier) 상한이 걸립니다 — 한 IP(학교·단체 NAT)에 여러 명이 있어도 동작하도록.
    // login 은 IP 단위로만 셉니다. register 는 시도(입력 오류 포함)를 브라우저 세션별로(+ IP 전체 상한), 실제로 만들어진
    // 계정 수(+ 이미 있는 이메일·닉네임 응답)를 IP 별로(register_ip) 셉니다 — 한 교실(같은 IP)의 아이들이 비밀번호를 몇 번
    // 틀려도 모두 가입할 수 있게, 그리고 '이 이메일이 가입돼 있나?' 확인 요청은 IP 별로 계속 제한되게.
    'rate_limit_ip_multiplier' => 25,
    'rate_limits' => [
        'ping'         => [60, 60],
        'time'         => [120, 60],
        'me'           => [120, 60],
        'register'     => [20, 3600],
        'register_ip'  => [60, 3600],
        'login'        => [60, 300],
        'logout'       => [30, 60],
        'player_get'   => [60, 60],
        'player_save'  => [45, 60],
        'chat_list'    => [90, 60],
        'chat_send'    => [20, 60],
        'chat_report'  => [10, 3600],
        'presence'     => [90, 60],
        'upload'       => [20, 3600],
        'ranking'      => [40, 60],
        'admin'        => [120, 60],
        'admin_page'   => [240, 60],
        'sub_status'   => [60, 60],
        'sub_write'    => [20, 600],     // prepare · confirm · billing-issue · cancel (per account)
        'sub_return'   => [30, 600],     // 토스 결제창에서 돌아오는 페이지 (IP 별)
        'sub_webhook'  => [120, 60],     // 토스 웹훅 (IP 별)
        'install'      => [30, 600],
        'trap'         => [30, 60],      // 함정(honeypot) 경로 — IP 별 (스캐너가 로그를 넘치게 만드는 것 방지)
        'admin_login'  => [20, 300],     // 관리자 로그인 시도 — IP 별 (CONTRACT §15.4, admin agent)
        // ↓ 7단계 기능(실시간 텃밭·AI)에서 쓰도록 미리 잡아 둔 한도 (owner: server-farm / claude). 엔드포인트가 생기면 그대로 사용.
        'farm_state'   => [60, 60],
        'farm_report'  => [10, 600],
        'farm_reports' => [60, 60],
        'farm_photo'   => [10, 3600],
        'ai_ask'       => [10, 60],
        'ai_status'    => [60, 60],
        'ai_admin'     => [20, 60],
        // ↓ 8단계 분양 관리 (CONTRACT §16.7) — [allot-server]
        'allot_map'    => [60, 60],      // summary · map · unit · logs (누구나, 읽기)
        'allot_mine'   => [60, 60],      // mine · plans (로그인)
        'allot_inbox'  => [60, 60],      // inbox · seen (로그인)
        'allot_apply'  => [10, 3600],    // 분양 신청 (계정별, 한 시간에 10번)
        'allot_write'  => [20, 600],     // cancel · waitlist · nameplate · pay-prepare · pay-confirm
        // ↓ 8단계 1만 명 대비 (CONTRACT §16.9) — [scale-server]
        'sync'         => [150, 60],     // api/sync.php — 토큰이 있는 보통 호출 (계정별; DB 없이 채널 기록에서 셈)
        'sync_issue'   => [30, 60],      // api/sync.php — 토큰을 새로 받는 호출 (세션 확인을 거침)
        'queue'        => [120, 60],     // api/queue.php 대기실 (IP 별)
    ],

    // ------------------------------------------------------------------ chat
    'chat' => [
        'max_length'       => 120,
        'min_interval_ms'  => 1000,   // 1초에 1개
        'duplicate_window' => 30,     // 같은 내용을 이 시간(초) 안에 다시 보내면 거부
        'history'          => 40,     // 처음 접속 시 보여줄 최근 메시지 수
        'page_size'        => 60,
        'local_radius'     => 30,     // '주변' 채널 메시지를 받을 거리(m)
        'retention_days'   => 30,     // 이보다 오래된 메시지는 정리
        'reasons'          => ['abuse', 'spam', 'harass', 'privacy', 'etc', 'kid'],   // kid = 쉬운 모드 아이의 한 번 누르기 신고
        // 체험관(01-data.js badWords)과 같은 목록 + 추가 단어. 글자 사이 공백·기호도 걸러냅니다.
        'bad_words'        => ['시발', '씨발', 'ㅅㅂ', '병신', 'ㅂㅅ', '개새끼', '좆', '지랄', 'fuck', 'shit', 'bitch', '썅', '느금', '니애미', 'ㅄ'],
    ],

    'presence' => [
        'ttl'         => 15,   // 최근 N초 안에 신호를 보낸 체험객만 "접속 중"
        'max_players' => 60,
    ],

    // ------------------------------------------------------------------ journal photo uploads
    'uploads' => [
        'max_bytes'      => 5 * 1024 * 1024,   // 5 MB
        'max_dimension'  => 1600,              // 이보다 크면 축소해서 다시 저장
        'max_pixels'     => 16000000,          // 압축 폭탄 방지 (가로×세로, 예: 4000×4000)
        'jpeg_quality'   => 85,
        'require_gd'     => $env('TFM_UPLOAD_REQUIRE_GD', false), // true: GD 가 없으면 업로드 거부 (재인코딩 강제)
        'per_user_daily' => 40,
        'per_user_total' => 400,
    ],

    // ------------------------------------------------------------------ save validation (player/save.php)
    'save' => [
        'max_bytes'          => 0,      // 0 = data/game-data.json 의 limits.saveMaxBytes (기본 1.5 MB)
        'validate'           => true,   // 경제·성장 검증 (끄지 마세요)
        'admin_bypass'       => false,  // true 면 관리자 계정은 검증을 건너뜀 (디버그 치트 사용 시)
        'verify_checksum'    => true,   // 클라이언트 체크섬(cyrb53) 대조 — 전송 중 잘림/손상 감지
        'checksum_max_bytes' => 800000, // 이보다 큰 저장은 체크섬 대조 생략 (CPU 절약)
        // ▼ 허용 오차 (README-SERVER.md "저장 검증" 참고)
        'tolerance' => [
            'base_value'        => 1500,   // 설명되지 않는 자산(코인+아이템 가치) 증가: 저장 1회 기본 허용치
            'value_per_second'  => 20,     //   + 지난 저장 이후 경과 1초당
            'base_exp'          => 300,
            'exp_per_second'    => 4,
            'base_edu'          => 30,
            'edu_per_second'    => 0.2,
            'daily_value'       => 12000,  // 하루(서버 시간대 기준) 동안 허용되는 설명 불가 자산 증가 총량
            'daily_exp'         => 4000,
            'daily_edu'         => 200,
            'new_player_value'  => 3000,   // 첫 저장: 시작 아이템(씨앗·도구·메주 등) 가치
            'growth_slack'      => 3,      // 성장률/발효 진행률 허용 오차(%p)
            'time_slack'        => 5,      // 시간 판정 여유(초): 네트워크 지연·시계 오차
            'ferment_tolerance' => 0.5,    // 발효 최소 시간 = 기본 시간 / 최대 속도 × 이 값
            'ferment_max_speed' => 1.2,    // 최대 발효 속도 배율 (0.8 + 0.25 + 0.1 = 1.15) + 여유 — 구독 단계(tier)를 곱해 판정
            'jar_value'         => 1500,   // 추가 장독 1개(열기 비용)를 자산으로 계산
            'craft_value_gain'  => 260,    // 작업대 제작 1회로 늘 수 있는 최대 자산 가치
            'craft_exp'         => 40,
            'move_max_speed'    => 18,     // 이동 거리 판정 최대 속도(m/s, 기본 1배): 달리기 12 m/s(2배 기본 속도) × 1.5 — 점프·도움 이동·프레임 오차 여유.
                                           //   구독 단계에 따라 × min(tier, 3) (2배 36 · 3배/4배 54)
            'move_slack_m'      => 300,    // 이동 거리 고정 여유(m)
            'playtime_slack'    => 120,    // 플레이 시간 고정 여유(초)
            'edu_complete'      => 5,      // 교육 콘텐츠 완료 시 교육 포인트
        ],
        // 레벨 경험치 공식 (01-data.js G.data.levels.expFor 와 같아야 함): round(base × level^pow)
        'level_exp' => ['base' => 120, 'pow' => 1.35, 'max' => 50],
    ],

    // ------------------------------------------------------------------ 구독(진행 속도 2·3·4배) · 토스페이먼츠 (CONTRACT §14.6, §15.7 #8)
    // 키의 기본값은 없어요: 토스페이먼츠 개발자센터에서 발급받은 내 키(클라이언트 키 + 시크릿 키)를 환경 변수나 config.local.php 에
    // 넣으면 결제가 열려요. 키가 없으면 구독 화면은 "결제 설정 필요" 로 보이고 주문(prepare)은 503 PAYMENT_NOT_CONFIGURED 로 거절돼요.
    // 문서에 실린 공개 예시 키는 넣어도 쓰지 않아요. secret_key 는 어디에도 기록(로그)되지 않고 저장소에 올리면 안 돼요.
    // 가격은 운영자가 정하는 자리표시자(원).
    'toss' => [
        'client_key'  => $env('TFM_TOSS_CLIENT_KEY', ''),
        'secret_key'  => $env('TFM_TOSS_SECRET_KEY', ''),
        'mock'        => $env('TFM_TOSS_MOCK', false),   // true: 결제 서버에 연결하지 않는 모의 결제 (테스트·시연·E2E) — 운영(app.env=production)에서는 이 서버 PC 에서 연 경우만
        'api_base'    => 'https://api.tosspayments.com',
        'period_days' => 30,                             // 한 번 결제 = 이용 기간(일)
        'grace_days'  => 3,                              // 자동 갱신 실패 후 유예 기간(일) — 지나면 기본 속도로
        'tiers' => [
            2 => ['price' => 2900, 'name' => '⚡ 2배'],
            3 => ['price' => 4900, 'name' => '⚡⚡ 3배'],
            4 => ['price' => 6900, 'name' => '⚡⚡⚡ 4배'],
        ],
    ],

    // ------------------------------------------------------------------ 실시간 텃밭 · 곳간 · 재배 완료 확인 (CONTRACT §15.1–15.3) — owner: server-farm
    'farm' => [
        'rt_scale'        => $env('TFM_RT_SCALE', 1.0),   // 실시간 재배 시간 배율의 기본값 (관리자 화면에서 바꾸면 settings 테이블 값이 우선). 1 = 진짜 시간, 60 = 60배 빠르게(시연)
        'report_daily'    => 30,                           // 한 계정이 하루에 보낼 수 있는 완료 확인 요청 수
        'report_note_max' => 80,                           // 요청에 붙이는 한마디 길이(글자)
        'memo_max'        => 500,                          // 관리자 메모 길이(글자)
        'photo_max_bytes' => 1024 * 1024,                  // 완료 확인 사진 최대 크기 (1 MB)
        'photo_max_dimension' => 1280,
        'harvest_keep_days'   => 7,                        // 수확 뒤 이 기간 안에는 완료 확인을 보낼 수 있어요
    ],

    // ------------------------------------------------------------------ Claude API (CONTRACT §15.6) — owner: claude
    // 키는 환경 변수 ANTHROPIC_API_KEY 또는 config.local.php 에만 두세요 (저장소·DB·로그·브라우저 어디에도 남기지 않아요).
    // 호스팅이 PHP 7.2 라서 공식 PHP SDK(PHP 8 이상) 대신 curl 확장으로 Messages API 를 직접 불러요.
    'anthropic' => [
        'api_key'     => $env('ANTHROPIC_API_KEY', ''),      // 비어 있으면 AI 기능이 꺼져요
        'model'       => $env('TFM_AI_MODEL', 'claude-opus-5-5'),
        'effort'      => $env('TFM_AI_EFFORT', 'low'),       // low | medium | high | xhigh | max (짧은 질문·답은 low 로 충분)
        'max_tokens'  => $env('TFM_AI_MAX_TOKENS', 4096),
        'timeout'     => $env('TFM_AI_TIMEOUT', 60),         // 초
        'api_base'    => $env('TFM_AI_API_BASE', 'https://api.anthropic.com'),
        'mock'        => $env('TFM_AI_MOCK', false),         // true: 외부로 보내지 않는 모의 응답 (테스트·시연)
        'kid_helper'  => false,                              // 아이용 "옹이 선생님" 기본값 (관리자 화면 AI 탭에서 켜면 settings 값이 우선)
        'daily_user'  => 20,                                 // 한 계정이 하루에 할 수 있는 질문 수
        'daily_total' => 2000,                               // 서버 전체 하루 질문 수 (비용 상한)
        'question_max' => 200,                               // 질문 길이(글자)
        'answer_max'   => 600,                               // 아이에게 보여 줄 답 길이(글자)
    ],

    // ------------------------------------------------------------------ 분양 관리 (항아리 · 밭 · 창고, CONTRACT §16.7) — owner: allot-server
    // 여기 값은 "기본값"이에요. 관리자 화면 🏺 분양 관리 → 자동화에서 바꾸면 settings 표의 값이 우선해요.
    // 가격 · 기간은 구역마다 따로 정해요(관리자 화면 → 구역). 안내 문구(약관 · 개인정보 · 환불 · 입금 안내)도 관리자 화면에서 고쳐요.
    'allot' => [
        'enabled'                => true,     // false: 분양 화면과 신청을 모두 닫아요 (403 ALLOT_DISABLED)
        'hold_hours'             => 48,       // 신청한 자리를 잡아 두는 시간. 이 안에 승인(입금 확인)이 없고 입금 기록도 없으면 신청이 자동 취소돼요. 0 = 자동 취소 안 함
        'apply_per_user'         => 3,        // 한 계정이 동시에 가질 수 있는 신청 · 분양 · 대기 수
        'auto_approve'           => 'off',    // off: 관리자가 직접 승인 · on_payment: 입금(결제)이 기록되면 자동 승인 · always: 신청 즉시 승인
        'grace_days'             => 14,       // 납부 기한이 지나고 이만큼(일) 더 기다린 뒤 '연체'로 표시
        'notice_days'            => [30, 7, 0], // 납부 기한 · 만료일 며칠 전에 알림을 보낼지 (0 = 당일)
        'overdue_end_days'       => 0,        // 연체가 이만큼(일) 이어지면 계약을 자동으로 끝내고 자리를 비워요. 0 = 자동으로 끝내지 않음 (실물 항아리는 운영자가 직접 정리)
        'waitlist_offer_hours'   => 48,       // 대기자에게 자리가 났을 때 확정을 기다리는 시간
        'retention_days'         => 1825,     // 계약이 끝난 뒤 개인정보를 지우기까지의 기간(일). 1825 = 5년
        'collect_address'        => false,    // true: 신청할 때 주소도 받아요 (받지 않는 것이 기본 — 최소 수집)
        'nameplate_default_show' => false,    // 이름표를 처음부터 보이게 할지 (false: 신청자가 '공개'를 고른 경우에만)
        'toss_enabled'           => false,    // true: 토스페이먼츠 일회 결제 버튼을 켜요 (toss 키가 있어야 해요). false: 입금 안내 문구만 보여 줘요
        'lazy_tick_minutes'      => 15,       // 작업 스케줄러가 없을 때, 분양 화면을 여는 요청이 이 간격으로 자동화(allot:tick)를 한 번씩 돌려요
        'tick_batch'             => 500,      // 자동화 한 번에 단계마다 처리하는 최대 건수
        'consent_version'        => '2026-11', // 개인정보 동의 문구의 판(版) 이름. 바꾸면 모든 신청자가 새로 동의해요 (문구를 고쳐도 자동으로 새 판이 돼요)
        'daily_report_mail'      => false,    // true: 하루 한 번 분양 현황 요약을 security.alert_email 주소로 보내요 (숫자만, 개인정보 없음)
    ],

    // ------------------------------------------------------------------ 1만 명 대비 (CONTRACT §16.9) — owner: scale-server
    // 자세한 설명과 "내 서버에 맞는 숫자 정하는 법"은 docs/SCALING-KO.md 에 있어요. 아래 기본값은 XAMPP 한 대(PC 1대)에 맞춘 값이에요.
    // 캐시(cache) = 자주 쓰는 값을 잠깐 기억해 두는 곳. 요청 횟수 세기 · 차단 확인 · 계정 확인 · 접속자 위치를 여기서 처리해 데이터베이스를 쉬게 해요.
    'cache' => [
        // auto(기본): APCu 확장이 켜져 있으면 메모리(APCu), 없으면 data/cache 폴더의 작은 파일들
        // apcu | file | db(웹 서버가 여러 대일 때: cache_kv 표) | off(끄기 — 7단계처럼 전부 데이터베이스로)
        'driver'          => $env('TFM_CACHE_DRIVER', 'auto'),
        'user_ttl'        => 15,     // 계정 정보(정지 · 권한)를 기억하는 시간(초). 계정이 바뀌면 그 즉시 지워져요
        'block_ttl'       => 15,     // "이 주소는 차단되지 않음"을 기억하는 시간(초). 새로 차단하면 그 즉시 지워져요
        'settings_ttl'    => 30,     // 관리자 설정(settings 표)을 기억하는 시간(초)
        'schema_ttl'      => 30,     // "데이터베이스 표가 최신임"을 기억하는 시간(초). 0 = 요청마다 확인
        'rate_max_window' => 120,    // 이 시간(초) 이하의 요청 한도는 캐시에서 세요. 더 긴 한도(가입 · 신고 · 업로드: 1시간)는 계속 데이터베이스에서 세요
    ],
    // 수용 인원 · 과부하 보호 (lib/Gate.php). 이 서버 PC 에서 직접 연 브라우저(localhost)는 줄이기 · 로그인 조절에 걸리지 않아요.
    'capacity' => [
        'max_online'    => $env('TFM_MAX_ONLINE', 300),   // 동시에 마을에 들어와 있을 수 있는 인원. 넘으면 대기실(503 QUEUE + 대기표). 0 = 제한 없음
        'target_rps'    => $env('TFM_TARGET_RPS', 150),   // 1초에 이만큼의 요청까지는 평소 속도. 넘으면 다음 호출 간격(next)을 그만큼 늘려요
        'shed_rps'      => $env('TFM_SHED_RPS', 400),     // 1초에 이만큼을 넘으면 새 방문자 · 새 로그인부터 "잠시 후 다시"(503 BUSY). 0 = 끄기
        'login_per_sec' => $env('TFM_LOGIN_PER_SEC', 5),  // 1초에 처리하는 로그인(비밀번호 확인) 수. 넘으면 503 LOGIN_BUSY. 0 = 제한 없음
        'seat_ttl'      => $env('TFM_SEAT_TTL', 180),     // 마지막 호출 뒤 자리를 지켜 주는 시간(초). 탭을 닫으면 이 시간 뒤에 자리가 비어요
        'ticket_ttl'    => 1800,    // 대기표가 유효한 시간(초)
        'sample'        => 4,       // 요청 4개 중 1개만 세서 초당 요청 수를 어림해요 (세는 비용 줄이기)
        'gzip_json'     => true,    // 1 KB 이상인 응답을 gzip 으로 줄여 보내요 (브라우저가 받을 수 있을 때)
        'stats_header'  => $env('TFM_STATS_HEADER', false),   // true: 응답에 X-Tfm-Stats(SQL 횟수 · 걸린 시간)를 붙여요 — 부하 시험용
    ],
    // 채널 = 서로 보이는 체험객 묶음. 한 채널이 size 명이 되면 새 채널을 열고, 돌아온 사람은 hard 명까지 원래 채널로 받아요.
    'channels' => ['size' => $env('TFM_CHANNEL_SIZE', 60), 'hard' => $env('TFM_CHANNEL_HARD', 90)],
    // api/sync.php (lib/Sync.php 맨 위에 주고받는 형식이 적혀 있어요). *_ms = 다음 호출까지의 시간(밀리초 = 1/1000초)
    'sync' => [
        'enabled'     => $env('TFM_SYNC', true),
        'min_ms'      => 1000,    // 여럿이 빠르게 움직일 때
        'walk_ms'     => 1500,    // 여럿이 천천히 움직일 때
        'alone_ms'    => 2500,    // 주변에 아무도 없이 움직일 때
        'idle_ms'     => 4000,    // 가만히 있을 때
        'hidden_ms'   => 20000,   // 탭이 가려져 있을 때
        'max_ms'      => 30000,   // 서버가 바빠 간격을 늘려도 이보다 길어지지 않아요
        'min_gap_ms'  => 350,     // 이보다 빨리 다시 부르면 429
        'token_ttl'   => 300,     // 동기화 토큰 수명(초, 최대 600). 지나면 세션을 다시 확인하고 새로 받아요
        'aoi_radius'  => 90,      // 이 거리(m) 안의 체험객만 보내요 (관심 영역)
        'max_near'    => 40,      // 한 번에 보내는 주변 체험객 수
        'flush_every' => 30,      // 접속 위치를 데이터베이스(presence 표)에 옮겨 적는 간격(초)
        'chat_ring'   => 50,      // 채널마다 기억하는 최근 채팅 줄 수
        'save_every'  => 60,      // 저장 권장 간격(초). 서버가 바쁘면 그만큼 늘려서 알려 줘요
    ],

    // ------------------------------------------------------------------ logs & maintenance
    'logs' => [
        'level'          => $env('TFM_LOG_LEVEL', 'info'),  // debug | info | warn | error
        'retention_days' => 14,
        'max_file_bytes' => 5 * 1024 * 1024,
    ],
    'retention' => [
        'login_attempts_days' => 30,
        'audit_days'          => 180,
        'presence_hours'      => 24,
    ],
];
