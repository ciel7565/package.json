# 전통발효체험관 메타버스 — 서버 모드 안내 (PHP)

`index.html` 하나만 열어도 게임은 **로컬 모드**(이 브라우저에 저장)로 동작합니다.
같은 폴더를 PHP 웹 서버에 올리면 **서버 모드**가 켜져서 다음 기능을 씁니다.

| 기능 | 로컬 모드 (파일 더블클릭) | 서버 모드 (웹 서버) |
|---|---|---|
| 계정 | 이 브라우저 안 로컬 계정 | 서버 회원가입·로그인 (어느 PC에서나) |
| 저장 | localStorage | 서버 DB + **부정 저장 검증** |
| 채팅·접속자 | 시뮬레이션 체험객 | 실제 접속자 실시간 채팅·위치 |
| 작업일지 사진 | 브라우저 안 썸네일 | 서버 업로드 (검사·재인코딩) |
| 랭킹·관리 | 로컬 통계 | `api/ranking/top.php`, `admin.php` 관리자 센터 |

게임은 시작할 때 `api/ping.php` 를 불러 보고, 응답하면 서버 모드, 아니면 로컬 모드로 자동 전환합니다.
화면 위쪽 칩에 **서버** / **로컬** 이 표시됩니다.

---

## 1. 요구 사항

- PHP **8.2 이상 권장** (8.1 동작) — 확장: `pdo`, `pdo_sqlite`(기본) 또는 `pdo_mysql`, `mbstring`, `json`, `session`, `fileinfo`
- 강력 권장: `gd` (업로드 사진 재인코딩·메타데이터 제거), `intl` (유니코드 정규화), Argon2id 지원 PHP 빌드
- 웹 서버: Apache 2.4 (XAMPP 포함, `AllowOverride All`) 또는 Nginx + PHP-FPM
- DB: 설정 없이 **SQLite** (기본), 또는 MySQL 5.7+/MariaDB 10.3+

## 2. 빠른 시작

### XAMPP (Windows / macOS)
1. `npm run build` → `dist/metaverse/` 폴더가 만들어집니다. (배포 zip 의 `metaverse/` 폴더와 같습니다)
2. 그 폴더를 `C:\xampp\htdocs\metaverse` 로 복사합니다.
3. XAMPP Control Panel 에서 **Apache** 를 시작합니다. (SQLite 기본이므로 MySQL 은 없어도 됩니다)
4. 브라우저에서 `http://localhost/metaverse/` 접속 → 칩이 **서버** 인지 확인 → 회원가입.
5. 같은 PC에서 `http://localhost/metaverse/admin.php` 를 열고, 방금 만든 계정으로 로그인하면
   **"이 계정을 관리자로 지정"** 버튼이 보입니다 (관리자가 아직 없을 때, 서버 PC에서만).
6. 관리자 센터 → **시스템 점검** 탭에서 ⛔/⚠️ 항목을 확인하고 안내대로 고칩니다.

### 개발용 PHP 내장 서버
```bash
node tools/build.mjs                         # dist/metaverse 생성 (server/* 복사 + data/game-data.json 생성)
php -S 127.0.0.1:8080 -t dist/metaverse      # http://127.0.0.1:8080/
node tests/server-e2e.mjs http://127.0.0.1:8080/   # 보안·기능 E2E 테스트 (38단계)
node tests/server-e2e.mjs                    # 위 과정을 임시 DB 로 자동 실행 (php -S 를 스스로 띄우고 정리)
```
> ⚠️ `php -S` 는 `.htaccess` 를 읽지 않습니다. 개발·테스트용으로만 쓰세요. (각 비공개 폴더의 `index.php`·PHP 가드가
> 기본 차단은 해 주지만, 운영은 Apache/Nginx 로 하세요.)
> ⚠️ `server/` 폴더에서 직접 서버를 띄우지 마세요. 실행 중 생기는 DB·비밀키·세션이 소스 폴더에 생깁니다.
> 항상 빌드 결과(`dist/metaverse`)나 복사한 설치 폴더에서 실행하세요.

## 3. 폴더 구조 (설치 폴더 = index.html 이 있는 곳)

| 경로 | 내용 | 웹 접근 |
|---|---|---|
| `index.html` | 게임 (자체 CSP 내장) | 허용 |
| `api/` | JSON API (`*.php` 만) | 허용 |
| `admin.php` | 관리자 센터 (관리자만) | 허용 |
| `uploads/journal/YYYY/MM/` | 작업일지 사진 (무작위 이름, 재인코딩된 이미지만) | 이미지 파일만 허용, 스크립트 실행 금지 |
| `lib/` | 서버 코드 | **차단** |
| `config/` | 설정 (`config.php` 기본값, `config.local.php` 내 설정) | **차단** |
| `database/` | `schema.sql`(MySQL), `schema.sqlite.sql` | **차단** |
| `data/` | DB(`db-<무작위>.sqlite`), `secret.php`, `sessions/`, `logs/`, `backups/`, `game-data.json` | **차단** |
| `cli/tfm.php` | 서버 PC 전용 관리 명령 | **차단** (CLI 에서만 실행) |

`data/game-data.json` 은 `node tools/build.mjs` 가 게임 데이터(보상·성장 시간 등)에서 **자동 생성**합니다. 직접 고치지 마세요.

## 4. 설정

`config/config.local.php` 를 만들고 바꿀 값만 적습니다 (업데이트 때 덮어써지지 않음):
```php
<?php
return [
    'db' => ['driver' => 'mysql', 'mysql' => ['username' => 'metaverse', 'password' => '긴-무작위-비밀번호']],
    'security' => ['admin_emails' => ['teacher@school.kr']],
    'paths' => ['data' => 'C:/xampp/metaverse-data'],   // 웹 루트 밖 (가장 안전)
];
```
또는 환경 변수(Apache `SetEnv`, PHP-FPM `env[...]`)로 덮어쓸 수 있습니다.

| 환경 변수 | 기본값 | 설명 |
|---|---|---|
| `TFM_DB_DRIVER` | `sqlite` | `sqlite` / `mysql` |
| `TFM_DB_HOST` `TFM_DB_PORT` `TFM_DB_NAME` `TFM_DB_USER` `TFM_DB_PASS` | 127.0.0.1 / 3306 / fermentation_metaverse / root / (빈 값) | MySQL 접속 정보 |
| `TFM_SQLITE_PATH` | (자동) | SQLite 파일 위치 지정 |
| `TFM_DATA_DIR` | `<설치폴더>/data` | DB·로그·세션·비밀키 폴더 (**웹 루트 밖 권장**) |
| `TFM_UPLOAD_DIR` | `<설치폴더>/uploads` | 사진 폴더 (브라우저가 읽어야 하므로 웹 루트 안) |
| `TFM_ADMIN_EMAILS` | (없음) | 쉼표로 구분한 관리자 이메일 |
| `TFM_TRUSTED_PROXIES` | (없음) | 리버스 프록시 IP (그때만 X-Forwarded-* 신뢰) |
| `TFM_SESSION_IDLE` / `TFM_SESSION_MAX` | 7200 / 86400 | 세션 유휴 만료·최대 수명(초) |
| `TFM_LOG_LEVEL` | `info` | `debug` `info` `warn` `error` |
| `TFM_LOCAL_BOOTSTRAP` | 1 | 관리자가 없을 때 localhost 에서 첫 관리자 지정 허용 |
| `TFM_UPLOAD_REQUIRE_GD` | 0 | 1 이면 GD 없을 때 업로드 거부 |

### MySQL / MariaDB (XAMPP)
1. phpMyAdmin (`http://localhost/phpmyadmin`) → **가져오기** → `database/schema.sql` 실행
   (데이터베이스 `fermentation_metaverse` 와 테이블 11개가 만들어집니다)
2. 운영 서버라면 전용 계정을 만드세요:
   `CREATE USER 'metaverse'@'localhost' IDENTIFIED BY '…'; GRANT SELECT, INSERT, UPDATE, DELETE ON fermentation_metaverse.* TO 'metaverse'@'localhost';`
   (`db.auto_migrate` 를 켜 두려면 CREATE·INDEX·ALTER 권한도 필요합니다)
3. `config.local.php` 에 `'db' => ['driver' => 'mysql', ...]` 지정 → 관리자 센터 → 시스템 점검에서 "DB 연결" 확인

### Nginx
```nginx
root /var/www/metaverse;   # dist/metaverse 내용
index index.html;
location ~ ^/(lib|config|database|data|cli)/ { deny all; return 404; }
location ~ /\.(?!well-known) { deny all; }
location ~* \.(sqlite3?|sql|log|md|ini|bak)$ { deny all; }
location ^~ /uploads/ {
    location ~* \.php$ { deny all; }
    add_header X-Content-Type-Options nosniff always;
    add_header Content-Security-Policy "default-src 'none'; img-src 'self'; sandbox" always;
}
location ~ ^/(api/.+|admin)\.php$ {
    include fastcgi_params;
    fastcgi_param SCRIPT_FILENAME $document_root$fastcgi_script_name;
    fastcgi_pass unix:/run/php/php8.3-fpm.sock;
}
location ~ \.php$ { return 404; }
location ~* \.html?$ {
    add_header Content-Security-Policy "frame-ancestors 'self'" always;
    add_header X-Frame-Options SAMEORIGIN always;
    add_header X-Content-Type-Options nosniff always;
    add_header Referrer-Policy no-referrer always;
    add_header Permissions-Policy "camera=(), microphone=(self), geolocation=()" always;
}
client_max_body_size 8m;
```

### HTTPS
- 운영 서버는 **반드시 HTTPS** 로 서비스하세요. HTTPS 이면 세션 쿠키에 `Secure`, 응답에 HSTS 가 자동으로 붙습니다.
- 공개 서버: Let's Encrypt (`certbot --apache` / `--nginx`). 루트 `.htaccess` 의 "force HTTPS" 블록 주석을 풀면 http→https 이동.
- 교육장 내부망 XAMPP: `xampp/apache/conf/extra/httpd-ssl.conf` 로 인증서를 연결할 수 있습니다 (내부 CA 사용).
- 음성 채팅 입력(마이크)은 브라우저 정책상 HTTPS(또는 localhost)에서만 동작합니다.

## 5. 관리자

- **첫 관리자**: ① 서버 PC에서 `admin.php` 접속 → 로그인 → "이 계정을 관리자로 지정", ② `config` 의 `admin_emails`,
  ③ `php cli/tfm.php promote 이메일` 중 하나. (관리자가 생기면 ①은 사라집니다)
- `admin.php` 탭: 📊 대시보드(가입·접속·저장·신고·거부된 저장 등) · 🩺 시스템 점검(PHP·확장·DB·폴더 권한·세션·HTTPS·헤더·data 노출 검사)
  · 👥 사용자(검색, 관리자 지정/해제, 이용 정지, 채팅 제한, 직전 저장으로 되돌리기) · 🚨 신고·채팅(처리/기각, 메시지 숨기기)
  · 📜 감사 로그 · 🧰 유지보수(정리, 백업 안내, 로그 파일 목록)
- 게임 안 관리자 대시보드(`70-app`)의 "서버" 탭은 `api/admin/stats.php` 를, 개발자 센터는 `api/admin/health.php` 를 씁니다.
- CLI (서버 PC): `php cli/tfm.php status | users | promote | demote | ban | unban | reset-password | backup | cleanup | audit | migrate`

## 6. API 목록 (`api/` 아래, 모두 JSON)

모든 응답: `{success:true, data, csrf, serverTime}` 또는 `{success:false, error:{code, message}, data?, csrf, serverTime}`.
상태 변경 요청(POST)은 헤더 `X-CSRF-Token`(sendBeacon 저장은 본문 `csrf`)이 필요합니다.

| 경로 | 방식 | 권한 | 설명 · 응답 data |
|---|---|---|---|
| `ping.php` | GET | 누구나 | `{app:'tfm-metaverse', version, db, serverTime, csrf, loggedIn}` — 세션·CSRF 발급 |
| `time.php` | GET | 누구나 | `{serverTime, iso, timezone, day}` |
| `auth/register.php` | POST | 비로그인 | `{email, nickname, password, password_confirm, agree:true}` → `{user}` |
| `auth/login.php` | POST | 누구나 | `{login 또는 email, password, remember}` → `{user}` · 실패 401 `INVALID_CREDENTIALS`, 잠금 429 `TOO_MANY_ATTEMPTS` |
| `auth/logout.php` | POST | 누구나 | `{loggedOut:true}` (새 CSRF) |
| `auth/me.php` | GET | 누구나 | `{user:{id,email,nickname,role} 또는 null}` |
| `player/get.php` | GET | 로그인 | `{save:{version, revision, savedAt, data} 또는 null}` |
| `player/save.php` | POST | 로그인 | `{version, checksum, data}` → `{savedAt, revision, size}` · 검증 실패 **409** `VALIDATION_FAILED` + `data.save`(서버 저장본) |
| `chat/list.php?after=ID` | GET | 누구나 읽기 | `{messages:[{id,userId,nickname,text,channel,createdAt}], online, lastId}` |
| `chat/send.php` | POST | 로그인 | `{text, channel:'all'|'local'}` → `{message}` · 429 `RATE_LIMITED`, 409 `DUPLICATE_MESSAGE`, 403 `MUTED` |
| `chat/report.php` | POST | 로그인 | `{target, targetId?, messageId?, reason, memo?}` → `{reportId, duplicate}` |
| `presence/update.php` | POST | 로그인 | `{x,y,z,rotY,anim,speed,zoneId,emote,emoteAt,appearance?}` → `{players:[…], online}` (최근 15초) |
| `journal/upload.php` | POST(multipart `photo`) | 로그인 | `{url:'uploads/journal/…', width, height, size, mime, id}` |
| `ranking/top.php` | GET | 누구나 | `{ranking:[{rank,nickname,level,exp,title,me}], me, total, updatedAt}` (닉네임만 공개) |
| `admin/stats.php` | GET | 관리자 | 숫자 합계·레벨 분포·구역별 접속·최근 가입/신고/감사 |
| `admin/health.php` | GET | 관리자 (관리자 없을 땐 localhost) | `{status, ok, summary, app, php, db, session, https, checks:[{group,id,label,status,value,hint}], generatedAt, access}` |

## 7. 저장 검증 (부정 진행 방지)

게임 시뮬레이션은 브라우저에서 돌기 때문에, 서버는 **"직전에 받아들인 저장본 → 새 저장본" 사이의 변화가 실제 플레이로
그 시간 안에 가능했는지**를 서버 시계로 검사합니다. 하나라도 어긋나면 409 와 함께 서버 저장본을 돌려주고, 게임은
그 저장본으로 되돌립니다 ("서버 검증에 실패해 서버에 저장된 진행 상황으로 복구했습니다").

| 검사 | 내용 |
|---|---|
| 형식 | JSON 객체, 최대 크기(`limits.saveMaxBytes` 1.5 MB), 아이디 형식, 숫자 범위(음수·무한대 금지), 아이템 수량 0~999, 레벨 1~50, 경험치 < 다음 레벨 필요치 |
| 체크섬 | 브라우저가 계산한 cyrb53 체크섬과 대조 (전송 중 잘림·손상 감지) |
| 신원 | `profile.id` · `profile.role` 은 바꿀 수 없음 (권한 상승 시도 → 409 + 감사 로그). 닉네임·이메일은 계정 값으로 덮어씀 |
| 농사 | 성장률 증가·수확 횟수가 작물 `growthTime × harvestSpeedTolerance(0.5)` 보다 빠를 수 없음 (밭별로 계산) |
| 발효 | 진행률·수령이 레시피 `baseDuration ÷ 최대 속도(1.2) × 0.5` 보다 빠를 수 없음 (장독별) |
| 횟수 | 수확·발효 수령·제작 통계 증가가 밭/장독/시간으로 설명돼야 함 |
| 이동·시간 | `stats.distance` 증가 ≤ `move_max_speed`(27 m/s = 달리기 18 m/s × 1.5) × 지난 저장 이후 시간 + 300 m, `stats.playTime` 증가 ≤ 경과 시간 + 2분. 3배 빨라진 이동(걷기 9.6 · 달리기 18 m/s)은 넉넉히 통과하고, 순간 이동한 수천 km 는 거부 (첫 저장·초기화는 검사 안 함). 절대 상한: 거리 10만 km, 플레이 10년, 그 밖의 통계 1,000만 |
| 경제 | **자산(코인 + 아이템 대체가치 + 꾸미기 + 추가 장독)·누적 경험치·교육 포인트** 증가 = 설명 가능한 보상(퀘스트·업적·퀴즈는 서버 장부로 **각 1회만**, 수확·수령·제작·교육 완료) + 작은 허용치 |
| 상한 | 저장 1회 자산 증가 ≤ 60,000, 경험치 ≤ 20,000 (`limits.maxCoinGainPerSave` / `maxExpGainPerSave`) |

허용 오차 (`config.php` → `save.tolerance`, 문서화된 기본값):

| 항목 | 기본값 | 의미 |
|---|---|---|
| `base_value` + `value_per_second` | 1,500 + 20/초 | 설명되지 않는 자산 증가 허용치 (지난 저장 이후 시간에 비례, 최대 1시간분) |
| `base_exp` + `exp_per_second` | 300 + 4/초 | 설명되지 않는 경험치 허용치 |
| `base_edu` + `edu_per_second` | 30 + 0.2/초 | 교육 포인트 허용치 |
| `daily_value` / `daily_exp` / `daily_edu` | 12,000 / 4,000 / 200 | 하루 총 허용치 (출석·미션 같은 새 보상도 이 안에서 처리) |
| `new_player_value` | 3,000 | 첫 저장의 시작 아이템 가치 |
| `growth_slack` / `time_slack` | 3%p / 5초 | 성장·발효 진행 오차, 네트워크 지연 |
| `ferment_tolerance` / `ferment_max_speed` | 0.5 / 1.2 | 발효 최소 시간 계산 |
| `move_max_speed` / `move_slack_m` / `playtime_slack` | 27 m/s / 300 m / 120초 | 이동 거리·플레이 시간 판정 (위 "이동·시간") |

- "설정 → 진행 초기화"는 새 상태로 인식해 장부를 비웁니다. "저장 파일 가져오기"로 다른 진행을 올리면 서버 모드에서는
  검증에 걸려 서버 저장본이 유지됩니다 (가져오기를 이용한 치트 방지).
- 디버그 치트(코인 추가 등)도 서버 모드에서는 거부됩니다. 꼭 필요하면 `save.admin_bypass = true` (관리자 계정만).
- 거부 내역은 감사 로그 `save_rejected` 와 대시보드 "오늘 거부된 저장"에서 볼 수 있습니다.

## 8. 보안 설계 (SECURITY)

| 위협 | 대응 |
|---|---|
| SQL 인젝션 | PDO **prepared statements 만** 사용 (에뮬레이션 끔, MySQL 다중 쿼리 끔). 식별자는 코드 상수만 |
| XSS | API 는 JSON 만 (`Content-Type: application/json`, `nosniff`, `<`·`>`·`&`·따옴표 `\uXXXX` 이스케이프). 게임은 모든 원격 문자열을 textContent/escape 로 렌더링. `admin.php` 는 모든 출력 `htmlspecialchars`, **스크립트 0개**, nonce 기반 CSP. 아바타 외형은 화이트리스트 값만 다른 사람에게 전달 |
| CSRF | 세션별 32바이트 토큰(`hash_equals`), 로그인·로그아웃 때 교체, POST 마다 검사 + `Origin`/`Sec-Fetch-Site` 교차 사이트 차단, SameSite=Lax 쿠키 |
| 세션 탈취·고정 | 쿠키 이름 `TFMSESSID`, HttpOnly, SameSite=Lax, HTTPS 면 Secure, 경로 = 설치 폴더, `use_strict_mode`, 로그인/권한 변경 시 `session_regenerate_id`, 유휴 2시간·최대 24시간(로그인 유지: 7일·30일), User-Agent 지문, 사용자별 세션 epoch(정지·권한 변경·비밀번호 재설정 시 모든 기기 로그아웃), 전용 세션 폴더 |
| 무차별 대입 | `login_attempts`: 같은 IP+계정 5회 실패 → 30초부터 2배씩(최대 1시간) 잠금, 계정 단위 15회, IP 단위 60회(15분) 잠금, 모르는 계정도 같은 시간(더미 해시) |
| 비밀번호 | `password_hash` Argon2id(없으면 bcrypt cost 12) + `password_needs_rehash`, 8~64자 영문+숫자, 흔한 비밀번호·이메일/닉네임 포함 거부 |
| 과다 요청 | 엔드포인트별 제한(`rate_limits`): 로그인 사용자=계정별, 비로그인=세션별 + IP 전체 상한(×25), 로그인·가입=IP별. 채팅 1초 1개·분당 20개·30초 내 같은 말 반복 금지. 쿠키 없는 요청은 세션 파일을 만들지 않음 |
| 업로드 악용 | `is_uploaded_file`, 5 MB, **finfo MIME 화이트리스트**(PNG/JPEG/WEBP), `getimagesize` 형식 일치, 해상도·픽셀 상한(압축 폭탄), PHP/HTML/SVG 폴리글롯 패턴 거부, **GD 재인코딩**(EXIF·GPS·주석·덧붙인 데이터 제거), 무작위 128비트 이름 + 강제 확장자, 사용자별 일/총 개수 제한, `uploads/.htaccess` 스크립트 실행 금지·이미지 외 차단·nosniff·sandbox CSP |
| 정보 노출 | 오류는 일반 메시지 + 참조 번호만 (`display_errors` 끔, 스택은 `data/logs` 에만), `X-Powered-By` 제거, 랭킹·접속자에 이메일/내부 ID 없음 |
| 비공개 파일 | `lib` `config` `database` `data` `cli` 는 `.htaccess` 차단 + `index.php` 가드 + 각 PHP 파일 직접 실행 가드. DB 파일 이름 무작위, 로그·비밀키는 `.php`(직접 열면 실행되어 아무것도 안 보임). **권장: `TFM_DATA_DIR` 로 웹 루트 밖** |
| 클릭재킹·기타 헤더 | API/관리자: `CSP default-src 'none'; frame-ancestors 'none'`, `X-Frame-Options DENY`; 게임 html: `frame-ancestors 'self'`(+ 자체 meta CSP), `Referrer-Policy no-referrer`, `Permissions-Policy camera=(), microphone=(self), geolocation=()`, COOP/CORP same-origin, HTTPS 면 HSTS |
| 권한 | 관리자 API/페이지는 매 요청 DB 의 역할·상태 재확인, 마지막 관리자 해제 금지, 첫 관리자 지정은 관리자가 없을 때 localhost 에서만 |
| 부정 진행 | 7장 저장 검증 + 보상 1회 장부 + 하루 허용량 |
| 감사 | `audit_log`: 가입·로그인·실패·잠금·로그아웃·권한/정지/채팅 제한·신고·자동 숨김·저장 거부·업로드 거부·백업·정리·첫 관리자 지정 (180일 보관) |
| 채팅 남용 | 로그인 사용자만 전송, 120자, 제어·보이지 않는 문자 제거(NFC), 욕설 마스킹(글자 사이 공백·기호도 탐지), 신고 3명 이상이면 자동 숨김, 관리자 숨김/채팅 제한/정지, '주변' 채널은 서버가 30 m 이내 사람에게만 전달 |
| 어린이 개인정보 (CONTRACT §12.4) | **저장하기 전에** `ChatFilter::maskPII` 가 전화번호(010-1234-5678 · 01012345678 · +82 10 … · 지역번호 · 9자리 이상 숫자 · "공일공"), 이메일("골뱅이"·"닷" 표기 포함), 링크·도메인, 메신저 아이디(카톡·인스타·디코 …), 도로명·지번·아파트 동호수, 학교·유치원·학년 반 을 🔒 로 바꿔요(응답의 `piiMasked:true` 로 게임이 옹이 안내를 띄움). 목록을 내보낼 때도 한 번 더 가리고(예전 메시지), 신고 메모도 가려요. 닉네임은 개인정보처럼 보이면 가입 거부(`NICKNAME_INVALID`). 랭킹의 칭호는 게임이 주는 칭호(`game-data.json` 의 `titles`)만 보여 저장 파일의 자유 문장이 다른 사람에게 가지 않아요. admin.php 시스템 점검에 "어린이 개인정보 가림" 자가 점검이 있어요. 숨긴 형태(전각 ０１０·＠, 키캡 0️⃣, 다른 문자 숫자, `/ _ ~ * ㅡ` 구분자, "공일공-일이삼사-오육칠팔", "010 일이삼사 5678", "at … dot", "bad[.]com", 주소 뒤 번지)는 NFKC 로 펼친 글자에서 한 번 더 찾아 가려요(intl 확장이 없으면 전각·수학 숫자를 직접 변환). 반복 스팸 키(`chat_messages.text_key`)도 **가린 글**로 만들고, 스키마 v2 가 예전 키를 비워요. 공통 테스트 벡터: `tests/pii-vectors.json` (게임의 `G.sys.social.maskPII` 와 같은 규칙). 규칙 목록은 하나예요: 게임 코드의 규칙을 `node tests/pii-sync.mjs` 가 `lib/pii-rules.json` 으로 옮기고(`--check` 로 어긋남 확인), 서버는 이 파일을 읽어요 — **`lib/ChatFilter.php` 와 `lib/pii-rules.json` 은 꼭 함께 올리세요**(빠지면 기본 규칙만 남고 시스템 점검의 "개인정보 가림 규칙" 이 ⛔ 로 떠요). 보이지 않는 글자(소프트 하이픈·결합 문자·한글 채움 문자·폭 없는 공백·방향 제어)는 `Users::cleanText` 가 게임과 같은 범위로 지워요. 게임·서버 결과가 같은지는 `node tests/pii-client.mjs`(intl 있음/없음 둘 다)로 확인해요 |

개인정보: 비밀번호는 해시만 저장. 로그인 시도·요청 제한 기록은 IP 를 비밀키 HMAC 으로만 저장. 감사 로그에는 보안 확인을 위해
IP 원문이 남습니다(관리자만 열람, 180일 후 정리). 채팅은 30일 후 정리됩니다.

## 9. 백업·복구

- SQLite: `php cli/tfm.php backup` → `data/backups/tfm-날짜.sqlite` (실행 중에도 안전한 VACUUM INTO 사본).
  `data/secret.php` 도 함께 보관하세요 (DB 파일 이름·IP 해시 키). 복구: Apache 를 멈추고 파일을 `data/` 의 DB 이름으로 되돌립니다.
- MySQL: `mysqldump --single-transaction fermentation_metaverse > backup.sql` 또는 phpMyAdmin 내보내기.
- 사진: `uploads/journal/` 폴더를 함께 백업하세요.
- 한 사람의 저장을 직전 저장본으로 되돌리기: 관리자 센터 → 사용자 → ⚙️ 관리 → "직전 저장으로 되돌리기".

## 10. 유지보수·로그

- `data/logs/app-YYYY-MM-DD.log.php` (한 줄에 JSON 하나, 5 MB 마다 회전, 14일 보관). 오류 화면의 참조 번호(`rid`)로 검색하세요.
- 정리 작업은 요청 중 낮은 확률로 자동 실행되며, 관리자 센터 → 유지보수 또는 `php cli/tfm.php cleanup` 으로 바로 실행할 수 있습니다.
- 스키마 버전은 `schema_version` 테이블에 기록되고 시작 시 자동 설치·업그레이드됩니다 (`Db::SCHEMA_VERSION`, 현재 **2** — v2: 예전 채팅의 원문 기반 `text_key` 비우기).

## 11. 테스트

```bash
node tests/server-e2e.mjs http://127.0.0.1:8099/
```
핑·보안 헤더·메서드 제한·CSRF·교차 사이트 차단·가입 검증·세션 교체·저장/불러오기·**치트 저장 5종(코인 폭증, 아이템 주입,
권한 상승, 즉시 성장, 즉시 발효) → 409**·체크섬·sendBeacon·크기 제한·접속자·채팅(마스킹·속도·반복·길이)·신고·랭킹·
업로드(정상 PNG / PHP 폴리글롯 2종 / 가짜 이미지)·관리자 권한·비공개 파일·로그아웃→로그인 복원·**무차별 대입 잠금**까지 38단계를
PASS/FAIL 로 보여 주고, 실패가 있으면 종료 코드 1 을 돌려줍니다.
한 IP 에서 15분 안에 여러 번(약 10회 이상) 돌리면 IP 단위 로그인 잠금(정상 동작)에 걸릴 수 있습니다.

## 12. 문제 해결

| 증상 | 확인할 것 |
|---|---|
| 칩이 계속 **로컬** | `http://주소/설치폴더/api/ping.php` 가 JSON 을 주는지. PHP 가 실행되지 않으면 소스가 보이거나 다운로드됨 → Apache PHP 모듈 확인 |
| ping 이 500 | `data/` 쓰기 권한, `pdo_sqlite` 확장, `data/logs` 의 오류 (참조 번호로 검색) |
| 로그인 후 저장이 안 됨 | 관리자 센터 → 감사 로그 `save_rejected`, 로그의 `CHECKSUM`/`VALIDATION` |
| 사진 업로드 실패 | `fileinfo`·`gd` 확장, `upload_max_filesize`(5M 이상), `uploads/` 쓰기 권한 |
| data 노출 검사 ⛔ | httpd.conf 에서 `AllowOverride All` 이 꺼져 `.htaccess` 가 무시됨 → 켜거나 `TFM_DATA_DIR` 로 data 를 웹 루트 밖으로 |
| "요청이 너무 많아요" | 단체 이용 시 `config` 의 `rate_limits`·`login.ip_max_failures`·`rate_limit_ip_multiplier` 를 늘리세요 |

## 13. 한계

- 게임 규칙은 브라우저에서 계산되므로 서버 검증은 **시간·보상표 기반의 상한 검사**입니다. 허용 오차 안의 작은 부정(예: 하루 허용량 이내의
  코인 조작)까지 완전히 막지는 못하며, 대신 상한·하루 허용량·감사 로그로 피해를 제한합니다.
- 실시간 위치는 2초 간격 폴링(웹소켓 아님)입니다. 수십 명 규모를 기준으로 하며, 수백 명 이상은 MySQL + PHP-FPM 과 웹소켓 서버를 권장합니다.
- 한 계정을 여러 탭/기기에서 동시에 하면 늦게 저장한 쪽이 서버 검증에 걸려 서버 저장본으로 되돌아갈 수 있습니다 (서버 우선).
- 이메일 인증·비밀번호 찾기 메일은 없습니다 (관리자가 `cli/tfm.php reset-password` 로 재설정).
- 관리자 2단계 인증(2FA)은 없습니다. 관리자 계정은 긴 비밀번호를 쓰고 HTTPS 로만 접속하세요.
- 로컬 모드 진행 상황을 서버 계정으로 옮기는 기능은 보안상 제공하지 않습니다.
