# 전통발효체험관 메타버스 — 서버 모드 안내 (PHP)

`index.html` 하나만 열어도 체험관은 **로컬 모드**(이 브라우저에 저장)로 동작합니다.
같은 폴더를 PHP 웹 서버에 올리면 **서버 모드**가 켜져서 다음 기능을 씁니다.
**처음 설치하는 운영자는 `docs/SERVER-INSTALL-KO.md` (XAMPP 단계별 안내 · install.php) 를 먼저 보세요.**
**보안 점검 결과(23개 항목)와 운영자가 할 일은 `docs/SECURITY-REPORT-KO.md` 에 있어요.**

| 기능 | 로컬 모드 (파일 더블클릭) | 서버 모드 (웹 서버) |
|---|---|---|
| 계정 | 이 브라우저 안 로컬 계정 | 서버 회원가입·로그인 (어느 PC에서나) |
| 저장 | localStorage | 서버 DB + **부정 저장 검증** |
| 채팅·접속자 | 시뮬레이션 체험객 | 실제 접속자 실시간 채팅·위치 |
| 작업일지 사진 | 브라우저 안 썸네일 | 서버 업로드 (검사·재인코딩) |
| 랭킹·관리 | 로컬 통계 | `api/ranking/top.php`, 관리자 센터(자기 폴더 `admin/` — 이름은 바꿀 수 있어요, §5) |
| 진행 속도 구독 (2·3·4배) | 항상 기본 속도 | `api/sub/*` — 토스페이먼츠 결제, 서버 DB 가 단계를 결정 (CONTRACT §14.6) |

체험관은 시작할 때 `api/ping.php` 를 불러 보고, 응답하면 서버 모드, 아니면 로컬 모드로 자동 전환합니다.
화면 위쪽 칩에 **서버** / **로컬** 이 표시됩니다.

---

## 1. 요구 사항

- PHP **7.2 이상, 64비트** (확인된 운영 환경: XAMPP Apache/2.4.34 Win32 · PHP 7.2.10 · MariaDB 10.3.8; PHP 8.x 에서도 동일하게 동작) —
  필수 확장: `pdo`, `pdo_mysql` 또는 `pdo_sqlite`, `mbstring`, `json`, `session`, `curl`(토스 결제), `openssl`; 권장: `fileinfo`·`gd`(사진 업로드)
- `intl`·`sodium` 은 **없어도 됩니다** (유니코드 정규화는 내장 대체 변환, 비밀번호는 Argon2id → Argon2i → bcrypt 순으로 자동 선택)
- 서버 코드는 **PHP 7.2 문법만** 씁니다 (`tools/php-compat.sh` 가 PHPCompatibility 로 검사, 0 오류). `lib/compat.php` 가 7.2 에 없는 문자열·배열 함수를 보충합니다
- 웹 서버: Apache 2.4 (XAMPP 포함, `AllowOverride All`, mod_rewrite/mod_headers) 또는 Nginx + PHP-FPM. Windows 경로(`C:\…`)·`DIRECTORY_SEPARATOR` 안전
- DB: MySQL 5.7+/**MariaDB 10.3+** (install.php 기본), 또는 설정 없이 **SQLite** (소규모)

## 2. 빠른 시작

### XAMPP (Windows / macOS) — 설치 마법사
1. `npm run build` → `dist/metaverse/` 폴더가 만들어집니다. (배포 zip 의 `metaverse/` 폴더와 같습니다)
2. 그 폴더를 `C:\xampp\htdocs\metaverse` 로 복사하고 XAMPP Control Panel 에서 **Apache** 와 **MySQL** 을 시작합니다.
3. `http://localhost/metaverse/install.php` 를 엽니다: 환경 점검 → **설치 코드**(서버 PC 에서 `php cli/tfm.php setup-code`, 또는 `data/setup-code.php` 를 메모장으로 —
   24시간·한 번만, 웹 화면에는 절대 나오지 않음) → DB(여기는 **DB 관리자** 계정: XAMPP 기본값 root/빈 비밀번호 — 한 번만 쓰고 저장하지 않음, 없으면 생성,
   "전용 DB 계정 만들기" 로 `tfm_<8자>` 계정을 만듦) → 첫 관리자(+ "관리자 센터 주소를 아무도 모르는 이름으로 바꾸기", 기본으로 켜짐) → 토스 키(선택)
   → **설치하기**. `config/config.local.php`(전용 계정 + `auto_migrate` 끔)와 테이블(스키마 v6), 관리자가 만들어지고 `data/install.lock` 으로 마법사가 닫혀요.
   완료 화면에 **새 관리자 센터 주소**(한 번만)와 "🛡️ 설치 후 보안 점검" 이 나와요. 그 뒤 `install.php` 는 404 예요.
   (명령줄: `php cli/tfm.php install --driver=mysql --user=root --admin-email=… --admin-nick=…` — 비밀번호와 키는 화면에 보이지 않게 물어요(§5 CLI), 단계별 그림 설명: `docs/SERVER-INSTALL-KO.md`)
4. `http://localhost/metaverse/` 접속 → 칩이 **서버** 인지 확인. 관리자 센터는 완료 화면의 주소(또는 `php cli/tfm.php admin:path`)에서 설치 때 만든 관리자로 로그인합니다.
5. 관리자 센터 → **🩺 시스템 점검** 탭에서 ⛔/⚠️ 항목을 확인하고 안내대로 고칩니다 (웹 노출 검사 = AllowOverride, 관리자 페이지 잠금, 보안 설정, DB 계정).
6. 자동 갱신 결제를 쓰려면 Windows 작업 스케줄러에 `php.exe cli\tfm.php sub:renew` 를 하루 한 번 등록합니다.

### 개발용 PHP 내장 서버
```bash
node tools/build.mjs                         # dist/metaverse 생성 (server/* 복사 + data/game-data.json 생성)
php -S 127.0.0.1:8080 -t dist/metaverse      # http://127.0.0.1:8080/
node tests/server-e2e.mjs http://127.0.0.1:8080/   # 보안·기능 E2E 테스트 (구독 단계는 서버가 TFM_TOSS_MOCK=1 일 때)
node tests/server-e2e.mjs                    # 위 과정을 임시 DB·모의 결제로 자동 실행 (php -S 를 스스로 띄우고 정리; --docroot <폴더> 로 다른 사본)
TFM_DB_DRIVER=mysql TFM_DB_HOST=127.0.0.1 TFM_DB_PORT=3306 TFM_DB_USER=root node tests/server-e2e.mjs   # MariaDB 로 같은 테스트
sh tools/php-compat.sh                       # PHP 7.2 호환 검사 (PHPCompatibility, 0 오류여야 함)
```
> ⚠️ `php -S` 는 `.htaccess` 를 읽지 않습니다. 개발·테스트용으로만 쓰세요. (각 비공개 폴더의 `index.php`·PHP 가드가
> 기본 차단은 해 주지만, 운영은 Apache/Nginx 로 하세요.)
> ⚠️ `server/` 폴더에서 직접 서버를 띄우지 마세요. 실행 중 생기는 DB·비밀키·세션이 소스 폴더에 생깁니다.
> 항상 빌드 결과(`dist/metaverse`)나 복사한 설치 폴더에서 실행하세요.

## 3. 폴더 구조 (설치 폴더 = index.html 이 있는 곳)

| 경로 | 내용 | 웹 접근 |
|---|---|---|
| `index.html` | 체험관 (자체 CSP 내장) | 허용 |
| `api/` | JSON API (`*.php` 만; `api/sub/` 구독·결제, `api/trap.php` 함정 — 스캐너가 찾는 주소를 `.htaccess` 가 여기로 보내 기록) | 허용 |
| `admin/` | 관리자 센터 (`index.php` = 화면 전부·스크립트 없음, `.htaccess` = 목록 끔·`index.php` 만 열림·주석으로 꺼 둔 `Require ip` 와 Basic 인증 블록). **폴더 이름은 바꿀 수 있어요**(§5) | 관리자만 (허용 주소 밖은 404) |
| `admin.php` | 6단계까지의 관리자 주소. 이제는 "없는 페이지(404)"만 답하고 방문을 함정으로 기록해요. 지우지 마세요(새 배포를 예전 설치 위에 덮어쓸 때 예전 화면을 바꿔 줘요) | 404 |
| `install.php` | 설치 마법사 — 설치 코드가 필요하고, 잠금 파일·`config.local.php`·계정이 있으면 404 | 허용 (설치 전에만) |
| `uploads/journal/YYYY/MM/` | 작업일지 사진 (무작위 이름, 재인코딩된 이미지만) | 이미지 파일만 허용, 스크립트 실행 금지 |
| `lib/` | 서버 코드 (`admin.css` = 관리자 센터 모양 — 관리자 센터가 주소 확인 뒤 `./?css=` 로 보냄, `Totp.php` = 2단계 인증, `ConfigAudit.php` = 설정 점검, `SecurityEvents.php` = 보안 기록·차단, `Validator.php` = 입력 검사, `Crypto.php` = 봉인·비밀 키 파일) | **차단** |
| `config/` | 설정 (`config.php` 기본값, `config.local.php` = install.php 가 쓴 전용 DB 계정·토스 키·관리자 폴더 이름) | **차단** |
| `database/` | `schema.sql`(MySQL/MariaDB 10.3+, phpMyAdmin 가져오기 가능), `schema.sqlite.sql` | **차단** |
| `data/` | DB(`db-<무작위>.sqlite`, 0600), `secret.php`(앱 키·데이터 키), `install.lock`, `setup-code.php`(설치 코드, 쓰면 사라짐), `sessions/`, `logs/`, `backups/`, `game-data.json` | **차단** |
| `cli/` | 서버 PC 전용 관리 명령: `tfm.php` + 플러그인 `security.php`(보안 기록·차단·설정 점검), `admin-path.php`(관리자 폴더·2단계 인증) | **차단** (CLI 에서만 실행) |
| `.htaccess` · `.user.ini` | https 이동, 비공개 폴더·남은 파일 차단, 함정 주소, 보안 머리글, 오류 페이지(`e403.html`·`e404.html`) · PHP 업로드 크기(6M/8M/2개) | — |

`data/game-data.json` 은 `node tools/build.mjs` 가 체험 데이터(보상·성장 시간 등)에서 **자동 생성**합니다. 직접 고치지 마세요.

## 4. 설정

`config/config.local.php` 를 만들고 바꿀 값만 적습니다 (업데이트 때 덮어써지지 않음):
```php
<?php
if (!defined('TFM_BOOT')) { http_response_code(404); exit; }
return [
    'db' => ['driver' => 'mysql', 'auto_migrate' => false, 'mysql' => ['username' => 'tfm_ab12cd34', 'password' => '긴-무작위-비밀번호']],
    'security' => ['admin_ip_allowlist' => ['203.0.113.7'], 'admin_2fa' => 'required'],
    'paths' => ['data' => 'C:/xampp/metaverse-data'],   // 웹 루트 밖 (가장 안전)
];
```
또는 환경 변수(Apache `SetEnv`, PHP-FPM `env[...]`)로 덮어쓸 수 있습니다. 목록 값(주소 여러 개)은 쉼표로 구분해요.

**보안 설정 (`security` 묶음, 7단계)**

| 키 | 환경 변수 | 기본값 | 뜻 |
|---|---|---|---|
| `force_https` | `TFM_FORCE_HTTPS` | `auto` | `auto`(서버 PC 자신이 아니면 https 강제) · `on` · `off`. 암호화 없는 GET → 308, 그 밖 → 403 `HTTPS_REQUIRED` |
| `trusted_proxies` | `TFM_TRUSTED_PROXIES` | 없음 | 리버스 프록시 주소(그때만 `X-Forwarded-*` 를 믿음) |
| `cors_allowed_origins` | `TFM_CORS_ORIGINS` | 없음 | 공개 GET 4개(ping·time·ranking/top·sub/status)를 읽어도 되는 정확한 `https://호스트[:포트]`. `*` 금지 |
| `block.threshold` · `window` · `duration` · `exempt` | `TFM_BLOCK_THRESHOLD` · – · – · `TFM_BLOCK_EXEMPT` | 25 · 600초 · 1800초 · 없음 | 자동 차단: 600초에 공격 같은 기록 25번 → 30분(다시 걸리면 2배, 최대 24시간). `exempt` = 자동 차단하지 않을 주소(학교 등) |
| `events_days` · `events_per_minute` | – | 90 · 120 | 보안 기록 보관 일수 · 한 주소의 1분 기록 상한 |
| `admin_dir` | – | `admin` | 관리자 폴더 이름의 기록 (`php cli/tfm.php admin:path` 가 적어요) |
| `admin_ip_allowlist` | `TFM_ADMIN_IPS` | 없음(어디서나) | 관리자 센터를 열 수 있는 주소(IPv4/IPv6, CIDR). 다른 주소는 404 + `admin_ip_denied`. localhost 도 예외 없음. `api/admin/*` 도 같은 목록 |
| `admin_2fa` | `TFM_ADMIN_2FA` | `optional` | `off` · `optional`(등록 안 한 관리자에게 "켜 주세요") · `required`(등록 안 한 관리자는 등록 화면만) |
| `admin_idle` | `TFM_ADMIN_IDLE` | 1800 | 관리자 화면을 이 초 동안 안 쓰면 비밀번호(+코드)를 다시 물어요 |
| `allow_localhost_bootstrap` | `TFM_LOCAL_BOOTSTRAP` | 켜짐 | 이름과 달리 이제는 "첫 관리자 지정(관리자가 없을 때, **설치 코드** 필요)" 기능 전체의 켜기/끄기예요. localhost 라서 믿는 일은 없어요 |
| `check_origin` | `TFM_CHECK_ORIGIN` | 켜짐 | POST 의 출처(`Origin`/`Sec-Fetch-Site`) 검사. 끄지 마세요(점검 ⚠) |
| `alerts` | – | 꺼짐 | 수상한 활동 알림 메일·https 웹훅 (설정 파일에서만) |

`rate_limits.admin_login`(관리자 로그인 폼, 주소별 5분 20회)과 엔드포인트별 한도 표는 §6 · `docs/SECURITY-REPORT-KO.md` 부록 A 에 있어요.

| 환경 변수 | 기본값 | 설명 |
|---|---|---|
| `TFM_DB_DRIVER` | `sqlite` | `sqlite` / `mysql` |
| `TFM_DB_HOST` `TFM_DB_PORT` `TFM_DB_NAME` `TFM_DB_USER` `TFM_DB_PASS` | 127.0.0.1 / 3306 / fermentation_metaverse / root / (빈 값) | MySQL 접속 정보 — 운영에서는 install 이 만든 전용 계정을 쓰세요 (root·빈 비밀번호는 점검 ⛔) |
| `TFM_ENV` | `production` | `production` / `development`. production + 공개 주소면 모의 결제·모의 AI·저장 검증 건너뛰기를 강제로 끄고 debug 로그를 info 로 |
| `TFM_SQLITE_PATH` | (자동) | SQLite 파일 위치 지정 |
| `TFM_DATA_DIR` | `<설치폴더>/data` | DB·로그·세션·비밀키 폴더 (**웹 루트 밖 권장**) |
| `TFM_UPLOAD_DIR` | `<설치폴더>/uploads` | 사진 폴더 (브라우저가 읽어야 하므로 웹 루트 안) |
| `TFM_ADMIN_EMAILS` | (없음) | 예전 설정이에요: 이제 **이메일만으로 관리자로 올리지 않아요**(먼저 가입한 사람이 관리자가 될 수 있었음, 보고서 F2). 적혀 있으면 점검 ⚠ — 지워도 돼요 |
| `TFM_TRUSTED_PROXIES` | (없음) | 리버스 프록시 IP (그때만 X-Forwarded-* 신뢰) |
| `TFM_SESSION_IDLE` / `TFM_SESSION_MAX` | 7200 / 86400 | 세션 유휴 만료·최대 수명(초) |
| `TFM_LOG_LEVEL` | `info` | `debug` `info` `warn` `error` |
| `TFM_LOCAL_BOOTSTRAP` | 1 | 관리자가 한 명도 없을 때 관리자 센터 로그인 화면의 "첫 관리자 지정"(체험관 계정 + 비밀번호 + **설치 코드**)을 허용. 0 이면 `install.php` 또는 `cli promote` 만 |
| `TFM_UPLOAD_REQUIRE_GD` | 0 | (예전 설정) 이제는 GD 가 없으면 언제나 업로드를 거부해요 — 다시 그리기 없이는 사진 속 위치 정보를 지울 수 없어서 |
| `TFM_TOSS_CLIENT_KEY` / `TFM_TOSS_SECRET_KEY` | (없음 — 결제 "설정 필요") | 토스페이먼츠 API 개별 연동 **내** 키. 기본 키는 없고, 문서의 공개 예시 키는 넣어도 거절해요. 시크릿 키·빌링키·결제 키는 로그에 절대 기록되지 않음 |
| `TFM_TOSS_MOCK` | 0 | 1 이면 결제 서버에 연결하지 않는 모의 결제 (E2E·시연) — 서버 PC(또는 `TFM_ENV=development`)에서만 동작 |

### MySQL / MariaDB (XAMPP) — 수동 설치 (install.php 를 쓰지 않을 때)
1. phpMyAdmin (`http://localhost/phpmyadmin`) → 새 데이터베이스 `fermentation_metaverse` (utf8mb4_unicode_ci) → 선택 → **가져오기** → `database/schema.sql` 실행
   (테이블 14개가 만들어집니다 — MariaDB 10.3 에서 쓸 수 있는 문법만, `ROW_FORMAT=DYNAMIC`, 인덱스 VARCHAR ≤ 191; 다시 실행해도 안전)
2. 전용 계정을 만드세요 (읽기·쓰기·고치기·지우기만, 이 DB 에만 — `\_` 는 이름의 밑줄을 "아무 글자" 가 아닌 진짜 밑줄로 읽게 해요):
   `CREATE USER 'tfm_app01'@'localhost' IDENTIFIED BY '32자-무작위'; GRANT SELECT, INSERT, UPDATE, DELETE ON `fermentation\_metaverse`.* TO 'tfm_app01'@'localhost';`
   (`127.0.0.1` 도 같은 두 줄). `db.auto_migrate` 는 `false` 로 두고, 업그레이드는 `php cli/tfm.php migrate --admin-user root` (그때만 관리자 연결).
3. `config.local.php` 에 `'db' => ['driver' => 'mysql', 'auto_migrate' => false, 'mysql' => [...]]` 지정 → 관리자 센터 → 🩺 시스템 점검의 "🗄️ DB 계정" 이 ✅ 인지 확인.
   이미 root 로 도는 설치는 `php cli/tfm.php db:account --admin-user root` 한 번이면 전용 계정으로 바뀌어요(자료 유지). 서버 쪽 잠그기 순서: `docs/SECURITY-REPORT-KO.md` §1.

### Nginx
```nginx
root /var/www/metaverse;   # dist/metaverse 내용
index index.html index.php;   # 관리자 센터 폴더의 주소(…/관리자폴더/)는 index.php
location ~ ^/(lib|config|database|data|cli)/ { deny all; return 404; }
location ~ /\.(?!well-known) { deny all; }
location ~* \.(sqlite3?|sql|log|md|ini|bak|zip|tar|gz|7z|save|orig|swp)$|~$ { deny all; }
location ^~ /uploads/ {
    location ~* \.php$ { deny all; }
    add_header X-Content-Type-Options nosniff always;
    add_header Content-Security-Policy "default-src 'none'; img-src 'self'; sandbox" always;
}
location ~ ^/(api/.+|install|admin)\.php$ {      # API · 설치 마법사 · 예전 admin.php(404 로 답함)
    include fastcgi_params;
    fastcgi_param SCRIPT_FILENAME $document_root$fastcgi_script_name;
    fastcgi_pass unix:/run/php/php8.3-fpm.sock;
}
location ~ ^/[a-z0-9][a-z0-9-]{2,38}[a-z0-9]/index\.php$ {   # 관리자 센터 (폴더 이름을 바꿔도). 허용 주소는 여기에 allow / deny 로 한 번 더
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
- 공개 서버: Let's Encrypt (`certbot --apache` / `--nginx`). **http→https 이동은 기본으로 켜져 있어요**: 루트 `.htaccess` 가 공개 주소를 308 로 보내고(localhost 제외),
  PHP 도 `security.force_https = auto` 로 한 번 더 지켜요(암호화 없는 POST 는 403 `HTTPS_REQUIRED` — 비밀번호를 읽기 전에). Nginx 는 `return 308 https://$host$request_uri;` 를 80 포트 server 에.
- 인증서 없는 내부망에서만 `force_https => 'off'` (점검 화면 ⚠, 공개 주소면 ⛔).
- 교육장 내부망 XAMPP: `xampp/apache/conf/extra/httpd-ssl.conf` 로 인증서를 연결할 수 있습니다 (내부 CA 사용).
- 음성 채팅 입력(마이크)은 브라우저 정책상 HTTPS(또는 localhost)에서만 동작합니다.

## 5. 관리자

- **주소**: `http(s)://<체험관 주소>/<관리자 폴더>/` — 처음 이름은 `admin`. 설치 마법사가 기본으로 `admin-무작위10글자` 로 바꾸고 완료 화면에 한 번 보여 줘요.
  관리자 계정으로 체험관에 로그인하면 메뉴의 관리자 화면(서버 탭)이 관리자 센터 링크를 보여 줘요(`api/auth/me.php` 가 **관리자에게만** `adminUrl` 을 줘요). 예전 `admin.php` 는 404.
- **이름 바꾸기**: 서버 PC 에서 `php cli/tfm.php admin:path --random` → `admin-` + 무작위 10글자로 바뀌고 새 주소가 한 번 보여요(`config.local.php` 의 `security.admin_dir` 에 기록).
  직접 정하려면 `php cli/tfm.php admin:path 이름` (영어 소문자·숫자·`-` 4~40자). 그냥 `php cli/tfm.php admin:path` 는 지금 이름을 보여 줘요. 관리 화면은 폴더 이름을 화면에 쓰지 않아요.
- **로그인**: 체험관 계정과 같은 아이디/비밀번호 → 관리자 권한 확인 → (2단계 인증을 켰으면) 휴대폰 인증 앱의 6자리 숫자 또는 백업 코드. 체험관에 이미 로그인되어 있어도
  관리자 센터는 비밀번호를 한 번 더 물어요(관리자 **승격** = 세션 표시 + 이 폴더에만 보내지는 쿠키 `TFMADM`, HttpOnly · SameSite=Strict · https 면 Secure, 승격할 때 세션 번호 교체).
  30분(`admin_idle`) 동안 쓰지 않으면 다시 물어요. 비밀번호 5번 실패 → 체험관 로그인과 같은 잠금. 코드를 틀리면 `admin_2fa_fail` 기록 + 코드 단계만의 잠금(처음 하루 약 15번, 그 뒤 하루 1번).
- **허용 주소**(`security.admin_ip_allowlist` / `TFM_ADMIN_IPS`): 목록 밖의 주소에는 화면·모양 파일·끝에 `/` 없는 폴더 주소까지 **없는 페이지와 똑같은 404** + `admin_ip_denied` 기록.
  `admin/.htaccess` 의 주석으로 꺼 둔 `Require ip` 와 Basic 인증 블록은 PHP 앞에서 한 겹 더 막고 싶을 때 풀어요.
- **2단계 인증**(`lib/Totp.php`): RFC 6238(SHA-1 · 30초 · 6자리, 앞뒤 한 칸 인정), 같은 숫자 재사용 불가, 일회용 백업 코드 10개(해시로 저장), 비밀 키는 `Crypto` 로 봉인.
  🔐 탭에서 등록(스크립트 없이: 비밀 키 글자 + `otpauth://` 주소), 백업 코드 새로 만들기·끄기는 비밀번호 + 지금 코드가 필요해요. `security.admin_2fa` = off · optional(기본) · required.
- **첫 관리자**: ① `install.php` 로 설치하면 함께 만들어져요. ② 관리자가 한 명도 없을 때만, 관리자 센터 로그인 화면의 "첫 관리자 지정" — 체험관 계정 + 비밀번호 + **설치 코드**
  (서버 PC 에서 `php cli/tfm.php setup-code`, 또는 `data/setup-code.php` 를 메모장으로; 24시간·한 번만). ③ `php cli/tfm.php promote 이메일`.
  (예전의 "서버 PC(localhost)에서 접속하면 지정" 은 없어졌어요 — 터널·포트 전달 뒤에서는 누구나 localhost 로 보이기 때문이에요. 이메일 목록 `admin_emails` 로도 관리자를 주지 않아요.)
- **탭**: 📊 대시보드 · 🩺 시스템 점검(🔐 관리자 페이지 잠금 · 🧾 보안 설정 · 🗄️ DB 계정 · PHP · DB · 파일 · 웹 서버 · 체험관) · 👥 사용자 · ⚡ 구독·결제 · 🚨 신고·채팅
  · 🛡️ 보안(오늘의 수상한 활동 개수, 종류·등급·기간 필터, 50개씩, 주소는 끝자리 가림 + 짧은 지문, "이 주소 1시간 차단", 막아 둔 주소 + 차단 해제, 주소 직접 막기,
  관리자 로그인 기록, 관리자별 2단계 인증 상태) · 🔐 2단계 인증 · 📜 감사 로그 · 🧰 유지보수. 모든 작업은 POST + CSRF + 같은 사이트 확인 + 감사 로그 + 303.
- 모든 응답: `X-Robots-Tag: noindex, nofollow, noarchive`, `Cache-Control: no-store`, `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY`, 스크립트 0개 CSP.
- 체험관 안 관리자 대시보드(`70-app`)의 "서버" 탭은 `api/admin/stats.php` 를, 개발자 센터는 `api/admin/health.php` 를 써요. 이 둘과 `api/sub/grant.php`·`renew.php` 는
  관리자 센터에 로그인한(승격된) 세션에만 답해요(아니면 403 `ADMIN_REAUTH` + `adminUrl`). 관리자 센터에 로그인하면 30분 동안 체험관 안에서도 보여요.
- **CLI** (서버 PC): `php cli/tfm.php help` 가 전부 보여 줘요.
  - 계정·운영: `status` · `users` · `promote` · `demote` · `ban` · `unban` · `reset-password <이메일|닉네임> [--ask]`(비밀번호를 인수로 받지 않아요: 무작위 비밀번호를 한 번 보여 주거나, 보이지 않게 입력) · `audit` · `cleanup`
  - 구독: `sub:list` · `sub:grant` · `sub:revoke` · `sub:renew [--force]`
  - 설치·DB: `install`(비밀번호·키는 물어보거나 `TFM_DB_ADMIN_PASS`·`TFM_ADMIN_PASS`·`TFM_TOSS_SECRET_KEY`) · `setup-code` · `migrate --admin-user <DB 관리자>` · `db:account --admin-user <DB 관리자>` · `db:rotate-password --admin-user <DB 관리자>` · `backup`
  - 비밀 값: `secret:rotate [--app-key] [--data-key]`
  - 보안 (`cli/security.php`): `config:check`(⛔ 가 있으면 종료 코드 1) · `security:events [개수]` · `ip:block <IP> [초] [사유]` · `ip:unblock <IP|해시>`
  - 관리자 센터 (`cli/admin-path.php`): `admin:path [--random|이름]` · `admin:2fa-reset <이메일>` · `admin:2fa-unlock <이메일>`
  - 모르는 명령은 종료 코드 1. 플러그인: `cli/*.php` 가 `['이름' => function (array $args): int]` 를 돌려주면 `tfm.php` 가 그 명령을 실행해요(개발자용).

## 6. API 목록 (`api/` 아래, 모두 JSON)

모든 응답: `{success:true, data, csrf, serverTime}` 또는 `{success:false, error:{code, message}, data?, csrf, serverTime}`.
상태 변경 요청(POST)은 헤더 `X-CSRF-Token`(sendBeacon 저장은 본문 `csrf`)이 필요합니다.
로그인이 필요한 요청에 세션이 없으면 401 `AUTH_REQUIRED` — 이번 요청에서 세션이 무효가 된 경우에는 `data.why` 로 이유를 알려 줘요
(`epoch` 모든 기기 로그아웃 — 비밀번호 재설정·권한 변경·저장 되돌리기 등, `banned` 이용 정지, `deleted` 계정 삭제, `other account` DB 복구 뒤 다른 계정).
모든 엔드포인트에 공통(7단계): 막힌 주소 403 `IP_BLOCKED`(+`Retry-After`) · 암호화 없는 공개 주소의 쓰기 403 `HTTPS_REQUIRED`(GET 은 308) · 모르는 키·잘못된 종류·범위 400 `INVALID_INPUT`(+`data.field`) ·
JSON 깊이 32 · 한도 초과 429 + `Retry-After` + `data.retryAfter` · 파일을 받지 않는 곳의 업로드 400 `UPLOAD_NOT_ALLOWED` · 다른 사이트 출처 403 `CROSS_SITE_REQUEST`.
엔드포인트 × 입력값 × 한도 전체 표: `docs/SECURITY-REPORT-KO.md` 부록 A.

| 경로 | 방식 | 권한 | 설명 · 응답 data |
|---|---|---|---|
| `ping.php` | GET | 누구나 | `{app:'tfm-metaverse', version, db, serverTime, csrf, loggedIn}` — 세션·CSRF 발급 |
| `time.php` | GET | 누구나 | `{serverTime, iso, timezone, day}` |
| `auth/register.php` | POST | 비로그인 | `{email, nickname, password, password_confirm, agree:true, remember?}` → `{user}` · 이 브라우저의 시도가 많으면 429 `RATE_LIMITED`, 같은 인터넷 주소(학교·집)의 가입이 `rate_limits.register_ip` 를 넘으면 429 `REGISTER_IP_LIMIT` (둘 다 `data.retryAfter` + `Retry-After`) |
| `auth/login.php` | POST | 누구나 | `{login 또는 email, password, remember}` → `{user, sub, restoredAt, restoredRev}` · 실패 401 `INVALID_CREDENTIALS`, 잠금 429 `TOO_MANY_ATTEMPTS` · `restoredAt`/`restoredRev` 는 아래 `player/get.php` 와 같아요 |
| `auth/logout.php` | POST | 누구나 | `{loggedOut:true}` (새 CSRF) |
| `auth/me.php` | GET | 누구나 | `{user:{id,email,nickname,role} 또는 null, mutedUntil, sub:{tier,status,expiresAt,autoRenew}, restoredAt, restoredRev}` — `sub` 는 서버가 정한 진행 속도 단계(만료·자동 갱신을 한 시간에 한 번 스스로 정리) |
| `player/get.php` | GET | 로그인 | `{save:{version, revision, savedAt, restoredAt, restoredRev, data} 또는 null, sub, restoredAt, restoredRev}` — 저장본 안의 `data.sub` 도 서버 값으로 바꿔서 줌 · `restoredAt`(ms)/`restoredRev`: 지금 저장본이 관리자 센터 "직전 저장으로 되돌리기" 로 돌려놓은 것이면 그 시각과 판(revision), 아니면 0 (다음 저장이 받아들여지면 0 으로 돌아감) — 체험관은 그 시각보다 오래된, 기기에 남은 임시 기록을 다시 쓰지 않아요 |
| `player/save.php` | POST | 로그인 | `{version, checksum, base?, data}` → `{savedAt, revision, size, sub, subChanged}` · **모든 응답**(오류 응답도 `data.sub`)이 서버의 구독 `sub` 를 담고, 올린 저장본의 단계가 서버와 다르면 `subChanged: true` (CSRF 확인 뒤부터) · 검증 실패 **409** `VALIDATION_FAILED` + `data.save`(서버 저장본) · `base` 보다 새 저장본이 있으면 **409** `STALE_SAVE` + `data.save` (관리자가 "직전 저장으로 되돌리기" 한 저장본 그대로면 `data.restored: true` 와 `data.save.restoredAt`/`restoredRev`) · `profile.role` 과 **`sub`** 는 계정·구독 테이블의 값으로 고쳐 저장(거절하지 않음) · 시간 기준 검증은 구독 단계(tier)에 비례 |
| `chat/list.php?after=ID&rafter=R` | GET | 누구나 읽기 | `{messages:[{id,userId,nickname,text,channel,createdAt}], online, lastId, retracted:{messages:[id], users:[uid], upTo:{uid: id}}, retractId}` — `retracted`: 관리자가 숨긴 줄·신고 3건으로 숨겨진 줄·이용 정지된 계정의 줄(체험관이 이미 받은 것도 지움), `rafter`에는 지난 응답의 `retractId`를 보냄 · `upTo[uid]`: 정지한 순간의 가장 큰 메시지 번호 — 그 번호까지만 지우면 정지를 풀어 준 뒤 새로 쓴 줄은 남아요 (`upTo` 에 없는 계정은 모든 줄을 지움, 스키마 v5 이전에 만든 정지) |
| `chat/send.php` | POST | 로그인 | `{text, channel:'all'\|'local'}` → `{message, piiMasked}` · 429 `RATE_LIMITED`, 409 `DUPLICATE_MESSAGE`, 403 `MUTED` |
| `chat/report.php` | POST | 로그인 | `{target, targetId?, messageId?, text?, reason, memo?}` → `{reportId, duplicate}` — 신고한 글은 서버에 있는 메시지(`messageId`)에서 가져와요. 번호 없이 보낸 `text`는 신고자가 적은 글이라 대상의 말로 저장하지 않고 메모에 ‘신고자가 적은 내용(확인 안 됨)’으로 남겨요 |
| `presence/update.php` | POST | 로그인 | `{x,y,z,rotY,anim,speed,zoneId,emote,emoteAt,appearance?}` → `{players:[…], online}` (최근 15초, 각 줄의 `age` = 그 위치를 받은 뒤 지난 ms) |
| `journal/upload.php` | POST(multipart `photo`) | 로그인 | `{url:'uploads/journal/…', width, height, size, mime, id}` |
| `ranking/top.php` | GET | 누구나 | `{ranking:[{rank,nickname,level,exp,title,me}], me, total, updatedAt}` (닉네임만 공개) |
| `admin/stats.php` | GET | 관리자(승격) | 숫자 합계·레벨 분포·구역별 접속·최근 가입/신고/감사 |
| `admin/health.php` | GET | 관리자(승격) | `{status, ok, summary, app, php, db, session, https, toss:{mock,keysConfigured,live}, checks:[{group,id,label,status,value,hint}], generatedAt, access}` — 승격 전이면 403 `ADMIN_REAUTH` + `adminUrl` |
| `sub/status.php` | GET | 누구나 | `{sub, tiers:[{tier,name,price}], mode:'live'\|'mock'\|'unconfigured', clientKey, periodDays, graceDays}` (비로그인은 `sub` 없음 상태) · `clientKey` 는 `live` 일 때만 · 키가 없으면 `unconfigured`(결제 "설정 필요") · CORS 허용 목록 대상 |
| `sub/prepare.php` | POST | 로그인 | `{tier:2\|3\|4, kind:'card'\|'billing'}` → `{orderId, amount, orderName, customerKey, clientKey, successUrl, failUrl, mock}` — `orders` 에 `created` 주문 |
| `sub/confirm.php` | POST | 로그인 | `{paymentKey, orderId, amount}` → `{sub}` · `amount` 는 **JSON 정수**(1~10,000,000) · 내 주문·`created`·금액 일치만 통과 (`AMOUNT_MISMATCH` 400, `ORDER_NOT_FOUND` 404, 재사용·동시 승인 `ORDER_NOT_OPEN` 409, 결제 실패 `PAYMENT_FAILED` 402, 응답 지연 503 `PAYMENT_PENDING` — 30초 뒤 다시 조회) · 토스 답은 DONE + `totalAmount`(정수, = 주문 금액) + 같은 주문 번호 + KRW + 같은 결제 키여야 하고, 아니면 `payment_tamper` 기록 + 자동 취소 · 성공 시 `expires_at = max(지금, 만료) + 30일` · 자동 갱신이 켜진 동안 다른 단계는 409 `SUB_AUTO_RENEW_ON` · 키가 없으면 준비 단계에서 503 `PAYMENT_NOT_CONFIGURED` |
| `sub/billing-issue.php` | POST | 로그인 | `{authKey, customerKey, orderId}` → `{sub}` — 빌링키 발급 + 첫 결제 + 자동 갱신 켬 |
| `sub/cancel.php` | POST | 로그인 | `{}` → `{sub}` — 자동 갱신 끔, 만료일까지 이용 |
| `sub/return.php` | GET | (토스 결제창에서 돌아옴) | `?kind=card&paymentKey&orderId&amount` / `?kind=billing&authKey&customerKey&orderId` / `?code&message` → 처리 후 `index.html?sub=ok&tier=N` 또는 `?sub=fail&code=<정해진 코드\|OTHER>` / `&why=<정해진 낱말>` 로 303 — 결제창의 문장(`message`)은 넘기지 않고 체험관이 고정 문장을 보여 줘요 · 주소별 `sub_return` 한도(넘으면 429 페이지) · 사전 요청(OPTIONS) 403 |
| `sub/webhook.php` | POST | 토스 서버 | 본문을 믿지 않고 결제를 다시 조회(모의 모드는 결제 키 대조) · `payment_events` 에 (주문, 이벤트, 상태) 중복 없이 기록 · 취소/환불이면 그 기간을 산 구독을 내림 · 단계를 **올릴 수는 없음** · IP 별 제한 · 항상 200 |
| `sub/renew.php` | POST | 관리자(승격) | `{userId?, force?}` → `{results}` — 만료 하루 전부터 빌링키 결제 (실패 → `past_due`, 유예 3일 뒤 `none`); 카드를 등록한 단계만 청구, 강제 갱신도 한 기간에 한 번만; `cli/tfm.php sub:renew` 와 같음 |
| `sub/grant.php` | POST | 관리자(승격) | `{userId, tier, days}` 수동 부여 / `{userId, revoke:true}` 해지 → `{message, sub}` (관리자 센터 ⚡ 구독 탭과 같은 작업, 감사 로그) |
| `trap.php` | GET·HEAD | (함정) | 스캐너가 찾는 주소(`/.env`, `/wp-login.php`, `/phpmyadmin`, `/.git/config`, `*.bak` …)를 루트 `.htaccess` 가 여기로 보내요 → `honeypot` 기록 + 빈 404 · 주소별 `trap` 한도 · 사전 요청(OPTIONS) 403 · 그 밖의 방식 405 |

## 7. 저장 검증 (부정 진행 방지)

체험 시뮬레이션은 브라우저에서 돌기 때문에, 서버는 **"직전에 받아들인 저장본 → 새 저장본" 사이의 변화가 실제 플레이로
그 시간 안에 가능했는지**를 서버 시계로 검사합니다. 하나라도 어긋나면 409 와 함께 서버 저장본을 돌려주고, 체험관은
그 저장본으로 되돌립니다 ("서버 검증에 실패해 서버에 저장된 진행 상황으로 복구했습니다").

| 검사 | 내용 |
|---|---|
| 형식 | JSON 객체, 최대 크기(`limits.saveMaxBytes` 1.5 MB), 아이디 형식, 숫자 범위(음수·무한대 금지), 아이템 수량 0~999, 레벨 1~50, 경험치 < 다음 레벨 필요치 |
| 체크섬 | 브라우저가 계산한 cyrb53 체크섬과 대조 (전송 중 잘림·손상 감지) |
| 신원 | `profile.id` · `profile.role` 은 바꿀 수 없음 (권한 상승 시도 → 409 + 감사 로그). 닉네임·이메일은 계정 값으로 덮어씀 |
| 농사 | 성장률 증가·수확 횟수가 작물 `growthTime × harvestSpeedTolerance(0.5)` 보다 빠를 수 없음 (밭별로 계산) |
| 발효 | 진행률·수령이 레시피 `baseDuration ÷ 최대 속도(1.2) × 0.5` 보다 빠를 수 없음 (장독별) |
| 횟수 | 수확·발효 수령·제작 통계 증가가 밭/장독/시간으로 설명돼야 함 |
| 이동·시간 | `stats.distance` 증가 ≤ `move_max_speed`(18 m/s = 달리기 12 m/s × 1.5) × **min(구독 단계, 3)** × 지난 저장 이후 시간 + 300 m, `stats.playTime` 증가 ≤ 경과 시간 + 2분. 기본 2배 속도(걷기 6.4 · 달리기 12 m/s)는 넉넉히 통과하고, 순간 이동한 수천 km 는 거부 (첫 저장·초기화는 검사 안 함). 절대 상한: 거리 10만 km, 플레이 10년, 그 밖의 통계 1,000만 |
| 구독 단계 | 농사 성장 속도 × tier, 발효 최대 속도 1.2 × tier, 이동 × min(tier, 3). 단계는 `subscriptions` 테이블(서버)이 정하고 클라이언트의 `sub` 는 무시. 저장 사이에 단계가 바뀌었으면 이전 저장의 단계와 지금 단계 중 **큰 쪽으로 한 번** 판정 |
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
| `move_max_speed` / `move_slack_m` / `playtime_slack` | 18 m/s (1배 기준, × min(tier,3)) / 300 m / 120초 | 이동 거리·플레이 시간 판정 (위 "이동·시간") |

- "설정 → 진행 초기화"는 새 상태로 인식해 장부를 비웁니다. "저장 파일 가져오기"로 다른 진행을 올리면 서버 모드에서는
  검증에 걸려 서버 저장본이 유지됩니다 (가져오기를 이용한 치트 방지).
- 디버그 치트(코인 추가 등)도 서버 모드에서는 거부됩니다. 꼭 필요하면 `save.admin_bypass = true` (관리자 계정만).
- `devTier(n)`(개발자 센터) 는 화면 속도만 바꿉니다. 서버는 `subscriptions` 의 단계로 판정하므로 구독 없이 빠르게 이동한 저장은 `DISTANCE_TOO_FAST` 로 거부됩니다.
- 거부 내역은 감사 로그 `save_rejected` 와 대시보드 "오늘 거부된 저장"에서 볼 수 있습니다.

## 8. 보안 설계 (SECURITY)

| 위협 | 대응 |
|---|---|
| SQL 인젝션 | PDO **prepared statements 만** 사용 (에뮬레이션 끔, MySQL 다중 쿼리 끔, LOAD DATA LOCAL 끔). 식별자는 코드 상수만(`Db::ident`), LIMIT 도 값으로. `node tools/sql-audit.mjs` 가 변수로 만든 SQL 을 찾아 실패(검토한 24곳은 `tools/sql-audit.allow.json`) |
| XSS | API 는 JSON 만 (`Content-Type: application/json`, `nosniff`, `<`·`>`·`&`·따옴표 `\uXXXX` 이스케이프). 체험관은 모든 원격 문자열을 textContent/escape 로 렌더링. 관리자 센터는 모든 출력 `htmlspecialchars`, **스크립트 0개**, CSP `default-src 'none'; style-src 'self'; img-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'`. 결제 복귀(`return.php`)는 정해진 낱말만 넘기고 체험관이 고정 문장을 보여 줌. 아바타 외형은 화이트리스트 값만 다른 사람에게 전달 |
| HTTPS 강제 (7단계) | `security.force_https = auto`: 공개 주소의 http GET → 308, 그 밖 → 403 `HTTPS_REQUIRED`(자격 증명을 읽기 전), 루트 `.htaccess` 이동 켜짐, `X-Forwarded-Proto` 는 `trusted_proxies` 만, HSTS · Secure 쿠키 |
| 입력 검사 (7단계) | `Tfm\V`: 모든 엔드포인트가 모르는 키 거절·종류·길이·범위·목록 검사, JSON 깊이 32, 본문 크기 상한, `$_GET` 숫자 → 400 `INVALID_INPUT` + `data.field` |
| 수상한 활동 (7단계) | `SecEvent` → `security_events`(+파일 로그, 90일, 한 주소 1분 120줄) · `Firewall::check()` 가 모든 입구에서 먼저 · 600초에 25번 → 30분 차단(2배씩, 최대 24시간), localhost·`block.exempt` 제외, 교차 사이트로 꾀어낸 요청은 정보로만 · 함정 주소 → `api/trap.php` · 🛡️ 보안 탭 · `cli security:events`·`ip:block`·`ip:unblock` |
| 관리자 주소 잠금 (7단계) | 폴더 이름 자유(`admin:path`, 설치 때 무작위) · 예전 `admin.php` 는 404 · 허용 주소 밖은 화면·모양 파일·폴더 주소 모두 "없는 페이지" 404(세션·쿠키 없음) · 공유 로그인 + 역할 + 2단계 인증(RFC 6238, 재사용 불가, 백업 코드 해시, 비밀 키 봉인, 코드 전용 잠금) · 승격(세션 + 폴더 쿠키, 30분 유휴, 세션 번호 교체) · 잠금 머리글 · `admin/.htaccess` 의 선택 잠금(Require ip, Basic 인증) |
| CORS (7단계) | 기본: CORS 머리글 없음(같은 사이트만). `cors_allowed_origins` 의 정확한 https 주소만, 공개 읽기 GET 4개에서만, 자격 증명 없이, 그 밖의 사전 요청 403 |
| 비밀 값 (7단계) | 기본 키 없음(토스 문서 예시 키 거절) · `data/secret.php`(앱 키·데이터 키, 만든·바꾼 날짜) · 빌링키·2단계 비밀 키는 AES-256-GCM 봉인(`enc:v1:`) · 로그에 키 없음 · `secret:rotate` · `db:rotate-password` · 명령줄에 비밀번호·키 금지 · `node tools/secret-scan.mjs [--history]` · 점검 "키 나이" |
| CSRF | 세션별 32바이트 토큰(`hash_equals`), 로그인·로그아웃 때 교체, POST 마다 검사 + `Origin`/`Sec-Fetch-Site` 교차 사이트 차단, SameSite=Lax 쿠키 |
| 세션 탈취·고정 | 쿠키 이름 `TFMSESSID`, HttpOnly, SameSite=Lax, HTTPS 면 Secure, 경로 = 설치 폴더, `use_strict_mode`, 로그인/권한 변경 시 `session_regenerate_id`, 유휴 2시간·최대 24시간(로그인 유지: 7일·30일), User-Agent 지문, 사용자별 세션 epoch(정지·권한 변경·비밀번호 재설정 시 모든 기기 로그아웃), 로그인 = 계정 번호 + 가입 시각(DB 복구 뒤 같은 번호의 새 계정으로 넘어가지 않음), 전용 세션 폴더 |
| 무차별 대입 | `login_attempts`: 같은 IP+계정 5회 실패 → 30초부터 2배씩(최대 1시간) 잠금, 계정 단위 15회, IP 단위 60회(15분) 잠금, 모르는 계정도 같은 시간(더미 해시) |
| 비밀번호 | `password_hash` Argon2id(없으면 bcrypt cost 12) + `password_needs_rehash`, 8~64자 영문+숫자, 흔한 비밀번호·이메일/닉네임 포함 거부 |
| 과다 요청 | 엔드포인트별 이름 붙은 제한(`rate_limits`, 미끄러지는 시간 창, 429 + `Retry-After`): 로그인 사용자=계정별, 비로그인=세션별 + IP 전체 상한(×25), 로그인=IP별, 가입=시도는 세션별·만들어진 계정 수와 '이미 가입된 이메일/닉네임' 응답은 IP별(`register_ip`, 시간당 60), 관리자 로그인 폼=IP별(`admin_login`, 5분 20회). 채팅 1초 1개·분당 20개·30초 내 같은 말 반복 금지. 쿠키 없는 요청과 처음 보는 쿠키는 세션 파일을 만들지 않음(관리자 로그인 폼의 토큰도 서버에 아무것도 남기지 않는 서명 값) |
| 업로드 악용 | 파일은 `journal/upload.php` 만 받음(다른 곳의 multipart → 400 `UPLOAD_NOT_ALLOWED` + `upload_rejected`), `is_uploaded_file`, 5 MB, **finfo MIME 화이트리스트**(PNG/JPEG/WEBP), `getimagesize` 형식 일치, 해상도·픽셀 상한(압축 폭탄), PHP/HTML/SVG 폴리글롯 패턴 거부, **GD 재인코딩 필수**(GD 가 없으면 거부 — EXIF·GPS·주석·덧붙인 데이터 제거), 무작위 128비트 이름 + 강제 확장자, 사용자별 일/총 개수 제한, `.user.ini`·`.htaccess` 의 PHP 업로드 상한(6M/8M/2개), `uploads/.htaccess` 스크립트 실행 금지·`[a-f0-9]{32}` 이미지 이름만·nosniff·sandbox CSP |
| 정보 노출 | 오류는 일반 메시지 + 참조 번호만 (`display_errors` 끔, 스택은 `data/logs` 에만), 모든 직접 열기 가드의 `X-Powered-By` 제거, 랭킹·접속자에 이메일/내부 ID 없음, 공개 응답·관리자 로그인 화면·설치 화면에 버전·DB 종류·경로 없음, SQLite 파일 이름은 어떤 화면에도 안 나옴. 공개 운영 서버에서는 모의 결제·모의 AI·저장 검증 건너뛰기를 강제로 끔(`app.env = production` 기본) |
| 비공개 파일 | `lib` `config` `database` `data` `cli` 는 `.htaccess` 차단 + `index.php` 가드 + 각 PHP 파일 직접 실행 가드. 숨은 폴더(`.git/`)·압축 파일·편집기 사본·`*.sqlite .sql .log .md .lock .ini .env .bak`·`error_log` 도 403, 폴더 목록 끔. DB 파일 이름 무작위(0600), 백업도 무작위 이름(0600), 로그·비밀키는 `.php`(직접 열면 실행되어 아무것도 안 보임). `node tools/exposure-audit.mjs --apache` 가 확인. **권장: `TFM_DATA_DIR` 로 웹 루트 밖** |
| 클릭재킹·기타 헤더 | API/관리자: `CSP default-src 'none'; frame-ancestors 'none'`, `X-Frame-Options DENY`; 체험관 html: `frame-ancestors 'self'`(+ 자체 meta CSP), `Referrer-Policy no-referrer`, `Permissions-Policy camera=(), microphone=(self), geolocation=()`, COOP/CORP same-origin, HTTPS 면 HSTS |
| 권한 | 관리자 API/페이지는 매 요청 DB 의 역할·상태 재확인 + 관리자 센터 승격 필요, 마지막 관리자 해제 금지, 첫 관리자 지정은 install.php, 또는 관리자가 없을 때 관리자 센터에서 **설치 코드**와 함께(서버 컴퓨터의 파일을 볼 수 있다는 증거), 또는 `cli promote`. 이메일 목록으로는 관리자를 주지 않음 |
| 세션이 사라진 탭 | 쿠키가 지워진 채 열려 있던 탭의 저장·접속자 POST 는 **401 `AUTH_REQUIRED`** (403 `CSRF_INVALID` 가 아님) — 세션 없이는 보호할 토큰도 없으므로 로그인이 필요하다고 바로 알려 체험관이 다시 로그인 카드를 띄우게 함 (R3-runtime-1). 세션은 있는데 토큰만 낡았으면 403 + 새 토큰 |
| 결제 | 주문은 서버가 만들고 금액은 서버 값과 **정확히 일치**(JSON 정수)해야 승인, 토스 답의 금액·주문 번호·통화·결제 키도 확인(다르면 `payment_tamper` + 자동 취소), 다른 계정의 주문·이미 처리된 주문 거부, 같은 주문의 동시 승인은 하나만(행 잠금·선점), 결제 승인은 서버↔토스 서버 간 통신(시크릿 키는 서버에만), 웹훅은 재조회로 검증하고 단계를 올리지 못함, 자동 갱신은 등록한 단계만·강제 갱신은 한 기간에 한 번, 모든 단계 변화는 감사 로그(`sub_*`) |
| 부정 진행 | 7장 저장 검증 + 보상 1회 장부 + 하루 허용량 |
| 감사 | `audit_log`: 가입·로그인·실패·잠금·로그아웃·권한/정지/채팅 제한·신고·자동 숨김·저장 거부·업로드 거부·백업·정리·첫 관리자 지정·설치·구독(준비·승인·갱신·실패·해지·수동 부여·웹훅 취소) (180일 보관) |
| 채팅 남용 | 로그인 사용자만 전송, 120자, 제어·보이지 않는 문자 제거(NFC), 욕설 마스킹(글자 사이 공백·기호도 탐지), 신고 3명 이상이면 자동 숨김, 관리자 숨김/채팅 제한/정지, '주변' 채널은 서버가 30 m 이내 사람에게만 전달 |
| 어린이 개인정보 (CONTRACT §12.4) | **저장하기 전에** `ChatFilter::maskPII` 가 전화번호(010-1234-5678 · 01012345678 · +82 10 … · 지역번호 · 9자리 이상 숫자 · "공일공"), 이메일("골뱅이"·"닷" 표기 포함), 링크·도메인, 메신저 아이디(카톡·인스타·디코 …), 도로명·지번·아파트 동호수, 학교·유치원·학년 반 을 🔒 로 바꿔요(응답의 `piiMasked:true` 로 체험관이 옹이 안내를 띄움). 목록을 내보낼 때도 한 번 더 가리고(예전 메시지), 신고 메모도 가려요. 닉네임은 개인정보처럼 보이면 가입 거부(`NICKNAME_INVALID`). 랭킹의 칭호는 체험관이 주는 칭호(`game-data.json` 의 `titles`)만 보여 저장 파일의 자유 문장이 다른 사람에게 가지 않아요. 관리자 센터의 🩺 시스템 점검에 "어린이 개인정보 가림" 자가 점검이 있어요. 숨긴 형태(전각 ０１０·＠, 키캡 0️⃣, 다른 문자 숫자, `/ _ ~ * ㅡ` 구분자, "공일공-일이삼사-오육칠팔", "010 일이삼사 5678", "at … dot", "bad[.]com", 주소 뒤 번지)는 NFKC 로 펼친 글자에서 한 번 더 찾아 가려요(intl 확장이 없으면 전각·수학 숫자를 직접 변환). 반복 스팸 키(`chat_messages.text_key`)도 **가린 글**로 만들고, 스키마 v2 가 예전 키를 비워요. 공통 테스트 벡터: `tests/pii-vectors.json` (체험관의 `G.sys.social.maskPII` 와 같은 규칙). 규칙 목록은 하나예요: 체험관 코드의 규칙을 `node tests/pii-sync.mjs` 가 `lib/pii-rules.json` 으로 옮기고(`--check` 로 어긋남 확인), 서버는 이 파일을 읽어요 — **`lib/ChatFilter.php` 와 `lib/pii-rules.json` 은 꼭 함께 올리세요**(빠지면 기본 규칙만 남고 시스템 점검의 "개인정보 가림 규칙" 이 ⛔ 로 떠요). 보이지 않는 글자(소프트 하이픈·결합 문자·한글 채움 문자·폭 없는 공백·방향 제어)는 `Users::cleanText` 가 체험관과 같은 범위로 지워요. 체험관·서버 결과가 같은지는 `node tests/pii-client.mjs`(intl 있음/없음 둘 다)로 확인해요 |

개인정보: 비밀번호는 해시만 저장. 로그인 시도·요청 제한 기록은 IP 를 비밀키 HMAC 으로만 저장. 감사 로그에는 보안 확인을 위해
IP 원문이 남습니다(관리자만 열람, 180일 후 정리). 채팅은 30일 후 정리됩니다.

## 9. 백업·복구

- SQLite: `php cli/tfm.php backup` → `data/backups/tfm-날짜-시각-무작위12자.sqlite` (실행 중에도 안전한 VACUUM INTO 사본, 0600).
  `data/secret.php` 를 **꼭 함께** 보관하세요 (DB 파일 이름·IP 해시 키, 그리고 빌링키·2단계 인증 비밀 키를 봉인한 **데이터 키** — 이 파일 없이 되살린 DB 의 결제 수단 정보는 열 수 없어요.
  `secret:rotate --data-key` 를 한 뒤에는 백업을 새로 받으세요: 예전 백업은 예전 키로만 열려요). 복구: Apache 를 멈추고 파일을 `data/` 의 DB 이름으로 되돌립니다
  (같은 이름의 `-wal`·`-shm` 파일이 남아 있으면 다른 곳으로 옮겨 두세요). 그다음 **`data/sessions/` 안의 `sess_*` 파일을 모두
  지워** 모든 기기를 로그아웃시키고 Apache 를 다시 시작하세요 — 백업 뒤에 한 이용 정지·비밀번호 재설정이 DB 와 함께 되돌아가도
  그 사이의 로그인이 다시 살아나지 않아요. (백업 뒤에 생긴 계정의 로그인은 서버가 스스로 거부해요: 로그인은 계정의 가입 시각과
  묶여 있어서, 복구 뒤 같은 번호를 받은 새 계정으로 들어가지 않습니다.)
- MySQL: `mysqldump --single-transaction fermentation_metaverse > backup.sql` 또는 phpMyAdmin 내보내기 (+ `data/secret.php`). 백업은 웹 루트 밖에, 한 달에 한 번 다른 PC 에서 되살려 보기.
- 사진: `uploads/journal/` 폴더를 함께 백업하세요.
- 한 사람의 저장을 직전 저장본으로 되돌리기: 관리자 센터 → 사용자 → ⚙️ 관리 → "직전 저장으로 되돌리기".

## 10. 유지보수·로그

- `data/logs/app-YYYY-MM-DD.log.php` (한 줄에 JSON 하나, 5 MB 마다 회전, 14일 보관). 오류 화면의 참조 번호(`rid`)로 검색하세요.
- 정리 작업은 요청 중 낮은 확률로 자동 실행되며, 관리자 센터 → 유지보수 또는 `php cli/tfm.php cleanup` 으로 바로 실행할 수 있습니다.
- 스키마 버전은 `schema_version` 테이블에 기록됩니다 (`Db::SCHEMA_VERSION`, 현재 **6** — v2: 예전 채팅의 원문 기반 `text_key` 비우기, v3: `chat_retractions`(접속 중인 체험관에 숨김·정지 알리기, 채팅 보관 기간만큼 보관) + 메시지 번호 없는 옛 신고의 글을 ‘신고자가 적은 내용(확인 안 됨)’ 메모로 옮기기, v4: `subscriptions`·`orders`·`payment_events`(진행 속도 구독·토스 결제), v5: `chat_retractions.upto_id`(정지할 때의 메시지 번호 — 정지를 풀어 준 뒤 쓴 줄은 지우지 않음), v6: `settings`·`security_events`·`ip_blocks`·`admin_totp`(7단계 보안) + 다음 단계 기능의 표 `farm_beds`·`farm_storage`·`crop_reports`·`ai_usage`·`handover_items`·`inspection_runs`). 열 추가는 MySQL/MariaDB 에서 `schema.sql` 이 information_schema 로 확인한 뒤에만 하고(phpMyAdmin 으로 다시 가져와도 안전), SQLite 는 `lib/Db.php` 가 같은 트랜잭션에서 더해요.
  `auto_migrate` 가 켜진 설치(SQLite, 예전 설치)는 첫 요청 때 스스로 올라가요. **전용 DB 계정 설치는 `auto_migrate` 가 꺼져 있어서**, 새 버전을 올린 뒤 체험관이 "서버를 업데이트하는 중이에요"(503 `SCHEMA_OUTDATED`)라고 하면 서버 PC 에서 `php cli/tfm.php migrate --admin-user root` 를 한 번 실행하세요.
- 자동 갱신 결제: `php cli/tfm.php sub:renew` 를 하루 한 번 (Windows 작업 스케줄러 / cron). 로그인·`me` 요청도 한 시간에 한 번 스스로 확인합니다.

## 11. 테스트

```bash
node tests/server-e2e.mjs http://127.0.0.1:8099/
```
핑·보안 헤더·메서드 제한·CSRF·교차 사이트 차단·가입 검증·세션 교체·저장/불러오기·**치트 저장 5종(코인 폭증, 아이템 주입,
권한 상승, 즉시 성장, 즉시 발효) → 409**·체크섬·sendBeacon·크기 제한·접속자·채팅(마스킹·속도·반복·길이)·신고·랭킹·
업로드(정상 PNG / PHP 폴리글롯 2종 / 가짜 이미지)·관리자 권한·비공개 파일·로그아웃→로그인 복원·**무차별 대입 잠금**,
그리고 6단계의 **세션 없는 탭의 401**, **구독(모의 결제)**: 상태 → 준비 → 금액 조작·타인 주문·재사용 거부 → 승인 → `me.sub.tier` →
단계에 비례한 저장 검증(같은 거리가 1배는 거부, 2배는 통과) → 해지 → 빌링키 발급·자동 갱신 → `sub:renew` 연장 → 실패 빌링키 → `past_due` →
웹훅(검증 불가 무시 · 취소 → 하향 · 중복 무시) → 관리자 부여/해지(비관리자 403) → 모든 구독 POST 의 CSRF, 그리고 **관리자 되돌리기 표시**(get·login·me 의
`restoredAt`/`restoredRev`, 옛 탭의 저장은 409 `restored`, 400·409·200 모든 저장 응답의 `sub`)와 **정지 회수의 기준 번호**(정지 → 해제 → 새 줄이 남음, `upTo`) —
70단계를 PASS/FAIL 로 보여 주고, 실패가 있으면 종료 코드 1 을 돌려줍니다. 스스로 띄운 서버는 모의 결제(`TFM_TOSS_MOCK=1`)로 돕니다.
스스로 띄운 서버에서는 DB 를 직접 살펴보는 단계(반복 스팸 키가 **가린 글**에서 만들어졌는지 — 서버의 `ChatFilter::key()` 로 다시 계산해 비교, 신고 메모의 개인정보)를
SQLite·MySQL 모두에서 돌려요. 같은 실행을 다시 재현하려면 `TFM_E2E_RUN_ID=<16진수 8자>` (SQLite 로 스스로 띄운 서버에서만).
한 IP 에서 15분 안에 여러 번(약 10회 이상) 돌리면 IP 단위 로그인 잠금(정상 동작)에 걸릴 수 있습니다.

**7단계 보안 시험** (결과와 명령 전체: `docs/SECURITY-REPORT-KO.md` §1 — 모두 서버 사본에서 돌려요, `server/` 에서 직접 돌리지 마세요):

```bash
node tests/security-e2e.mjs --docroot <사본> --apache [--only S02,S10] [--json out.json]   # 공격 흉내 S01~S19 (TFM_SEC_PORT_BASE·TFM_SEC_APACHE_PORT·TFM_SEC_DB_PREFIX 로 포트·DB 이름)
node tests/admin-lock.mjs --docroot <사본> [--no-apache] [--only path|signin|twofa|allowlist|…]   # 관리자 센터 잠금 (Apache .htaccess, Require ip, Basic 인증 포함)
node tests/server-moderation.mjs --root <사본>   # 관리자 센터의 숨기기·정지·자동 숨김이 접속 중인 체험관에 닿는지, 신고 표 화면 배치, 감사 로그 쪽 넘김
php tests/security-unit.php        # 입력 검사·보안 기록·차단·HTTPS·CORS·운영 잠금·설정 점검(키 나이 포함)
php tests/security-data-unit.php   # 설치(설치 코드·전용 DB 계정·무작위 관리자 폴더·설치 후 점검)·결제·봉인·키 교체·백업 (TFM_DB_DRIVER=mysql … 로 MariaDB 전용 검사까지; TFM_SECDATA_WEB_PORT 로 포트)
php tests/admin-unit.php           # 2단계 인증(RFC 시험 값·재사용 방지·백업 코드·잠금)·허용 주소·폴더 이름
node tools/sql-audit.mjs · node tools/secret-scan.mjs [--history] · node tools/exposure-audit.mjs --apache · npm audit
```

`tests/` 폴더는 개발용이라 배포 zip(`node tools/package.mjs`)에 들어가지 않아요. 특히 `tests/server-unit.php` 는 PHP 8 문법을 쓰는
개발 PC 용 단위 점검이라 **PHP 7.2 호환의 근거가 아니에요** — PHP 7.2 호환은 `tools/php-compat.sh`(PHPCompatibility **10**, testVersion 7.2- — 9.x 는
PHP 8 이전에 나와 `fn`·`match`·`?->`·이름 붙은 인수·`str_contains()` 같은 것을 못 잡아요)와
`php -l`, 그리고 위 E2E 로 확인합니다. 배포 묶음 확인만 하려면 `node tools/package.mjs --dry-run --dist <빌드 폴더>` (zip 을 만들지 않고 목록·검사만).

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

- 체험 규칙은 브라우저에서 계산되므로 서버 검증은 **시간·보상표 기반의 상한 검사**입니다. 허용 오차 안의 작은 부정(예: 하루 허용량 이내의
  코인 조작)까지 완전히 막지는 못하며, 대신 상한·하루 허용량·감사 로그로 피해를 제한합니다.
- 실시간 위치는 2초 간격 폴링(웹소켓 아님)입니다. 수십 명 규모를 기준으로 하며, 수백 명 이상은 MySQL + PHP-FPM 과 웹소켓 서버를 권장합니다.
- 한 계정을 여러 탭/기기에서 동시에 하면 늦게 저장한 쪽이 서버 검증에 걸려 서버 저장본으로 되돌아갈 수 있습니다 (서버 우선).
- 이메일 인증·비밀번호 찾기 메일은 없습니다 (관리자가 `cli/tfm.php reset-password` 로 재설정).
- 토스페이먼츠 서버는 개발 샌드박스에서 닿지 않아 결제 흐름은 공개된 API 계약과 모의 모드로 검증했습니다. 실제 키로 첫 결제를 할 때는 토스 개발자센터의 테스트 키로 한 번 결제해 보세요.
- 32비트 PHP 는 지원하지 않습니다 (밀리초 시각·체크섬에 64비트 정수 필요).
- 관리자 2단계 인증(휴대폰 인증 앱)은 있지만 기본값은 `optional` 이에요: 모든 관리자가 등록한 뒤 `security.admin_2fa = required` 로 바꾸세요. 관리자 계정은 긴 비밀번호를 쓰고 HTTPS 로만 접속하세요.
- 알고 남겨 둔 보안상의 한계(위조한 `Sec-Fetch-Site`, 머리글 없는 TCP 전달, 웹훅 JSON 깊이 등)와 그 이유는 `docs/SECURITY-REPORT-KO.md` 부록 B 에 있어요. 개발 환경에는 PHP 7.2·MariaDB 10.3 이 없어 그 위에서는 시험하지 못했어요 — 운영 서버에서 확인하는 순서는 같은 문서 부록 C.
- 로컬 모드 진행 상황을 서버 계정으로 옮기는 기능은 보안상 제공하지 않습니다.
