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
 *   - 관리자 계정: security.admin_emails 에 이메일을 넣거나, 관리자가 없을 때 이 PC(localhost)에서
 *     admin.php 로 접속해 "관리자로 지정"을 누르거나, CLI: php cli/tfm.php promote 이메일
 */
declare(strict_types=1);

if (!defined('TFM_BOOT')) { http_response_code(404); exit; }

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
        // 이 이메일로 가입/로그인한 계정은 관리자(admin) 권한을 받습니다.
        'admin_emails'              => $env('TFM_ADMIN_EMAILS', []),
        // 관리자가 한 명도 없을 때, 이 서버 PC(127.0.0.1/::1)에서만 admin.php 로 첫 관리자 지정 허용
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
