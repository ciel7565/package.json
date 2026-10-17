<?php
/**
 * 전통발효체험관 메타버스 — 서버 설정 (server mode)
 *
 * ▶ 이 파일은 "기본값"입니다. 직접 고치기보다 같은 폴더에 config.local.php 를 만들어
 *   바꾸고 싶은 값만 덮어쓰는 것을 권장합니다 (업데이트 시 덮어써지지 않음).
 *       <?php return ['db' => ['driver' => 'mysql', 'mysql' => ['password' => '비밀번호']]];
 * ▶ 환경 변수(TFM_*)로도 덮어쓸 수 있습니다 (Apache: SetEnv, Nginx/PHP-FPM: env[...] / fastcgi_param).
 *
 * XAMPP 빠른 시작
 *   1) dist/metaverse 폴더를 C:\xampp\htdocs\metaverse 로 복사
 *   2) XAMPP Control Panel 에서 Apache 시작 (SQLite 기본 사용 → MySQL 없어도 동작)
 *   3) http://localhost/metaverse/ 접속 → 상단 칩이 "서버"로 보이면 서버 모드
 *   MySQL/MariaDB 를 쓰려면: phpMyAdmin 에서 database/schema.sql 가져오기(Import) 후
 *   config.local.php 에 'db' => ['driver' => 'mysql', ...] 지정 (XAMPP 기본 계정: root / 빈 비밀번호)
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
        'driver'       => $env('TFM_DB_DRIVER', 'sqlite'),  // sqlite (기본, 설정 불필요) | mysql (MySQL 5.7+/MariaDB 10.3+)
        // 비워 두면 data/ 안에 추측하기 어려운 이름(db-<무작위>.sqlite)으로 자동 생성합니다.
        'sqlite_path'  => $env('TFM_SQLITE_PATH', ''),
        'mysql' => [
            'host'     => $env('TFM_DB_HOST', '127.0.0.1'),
            'port'     => $env('TFM_DB_PORT', 3306),
            'socket'   => $env('TFM_DB_SOCKET', ''),
            'database' => $env('TFM_DB_NAME', 'fermentation_metaverse'),
            'username' => $env('TFM_DB_USER', 'root'),       // XAMPP 기본값. 운영 서버에서는 전용 계정을 만드세요.
            'password' => $env('TFM_DB_PASS', ''),
        ],
        // 테이블이 없으면 database/schema*.sql 로 자동 생성 (MySQL 은 데이터베이스 자체는 미리 있어야 함)
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
    // login / register 는 IP 단위로만 셉니다.
    'rate_limit_ip_multiplier' => 25,
    'rate_limits' => [
        'ping'         => [60, 60],
        'time'         => [120, 60],
        'me'           => [120, 60],
        'register'     => [30, 3600],
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
        'reasons'          => ['abuse', 'spam', 'harass', 'privacy', 'etc'],
        // 게임(01-data.js badWords)과 같은 목록 + 추가 단어. 글자 사이 공백·기호도 걸러냅니다.
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
            'ferment_max_speed' => 1.2,    // 게임의 최대 발효 속도 배율 (0.8 + 0.25 + 0.1 = 1.15) + 여유
            'jar_value'         => 1500,   // 추가 장독 1개(열기 비용)를 자산으로 계산
            'craft_value_gain'  => 260,    // 작업대 제작 1회로 늘 수 있는 최대 자산 가치
            'craft_exp'         => 40,
            'move_max_speed'    => 27,     // 이동 거리 판정 최대 속도(m/s): 달리기 18 m/s(3배 속도) × 1.5 — 점프·도움 이동·프레임 오차 여유
            'move_slack_m'      => 300,    // 이동 거리 고정 여유(m)
            'playtime_slack'    => 120,    // 플레이 시간 고정 여유(초)
            'edu_complete'      => 5,      // 교육 콘텐츠 완료 시 교육 포인트
        ],
        // 레벨 경험치 공식 (01-data.js G.data.levels.expFor 와 같아야 함): round(base × level^pow)
        'level_exp' => ['base' => 120, 'pow' => 1.35, 'max' => 50],
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
