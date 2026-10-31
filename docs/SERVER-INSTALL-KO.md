# 전통발효체험관 메타버스 — 서버 설치 안내 (XAMPP · Apache 2.4 · PHP 7.2+ · MariaDB 10.3+)

이 문서는 **윈도우 PC에 XAMPP 가 설치된 운영자**를 위한 단계별 안내예요. 화면에 보이는 그대로 따라가면
`http://localhost/metaverse/` 에서 서버 모드(회원가입·저장·채팅·구독 결제)가 켜져요.
개발자용 상세 설명(Nginx, 환경 변수, 저장 검증, API 목록)은 `server/README-SERVER.md` 에 있어요.

> 확인된 운영 환경: **Apache/2.4.34 (Win32) · PHP 7.2.10 · MariaDB 10.3.8 · phpMyAdmin 4.8.3**.
> 서버 코드는 PHP 7.2 문법만 쓰고(8.x 에서도 동작), `intl`·`sodium` 확장이 없어도 돌아가요. **64비트 PHP** 가 필요해요.

---

## 0. 준비물

| 항목 | 확인 방법 |
|---|---|
| XAMPP (Apache + MySQL/MariaDB + PHP 7.2 이상, 64비트) | XAMPP Control Panel 에서 **Apache**, **MySQL** 두 줄이 보여요 |
| 배포 zip (`fermentation-metaverse.zip`) | 안에 `metaverse/` 폴더와 `전통발효체험관.html` 이 있어요 |
| PHP 확장 `pdo_mysql`, `mbstring`, `curl`, `json`, `openssl`, `session` | XAMPP 기본값이 모두 켜져 있어요 (`C:\xampp\php\php.ini` 의 `extension=` 줄). `gd` 는 사진 업로드에 권장 |

## 1. 폴더 복사

1. zip 을 풀어 `metaverse` 폴더를 **`C:\xampp\htdocs\metaverse`** 로 복사해요.
2. 폴더 안에 `index.html`, `install.php`, `admin.php`, `api/`, `lib/`, `config/`, `database/`, `data/` 가 있는지 확인해요.
3. (설치 폴더 이름을 바꾸고 싶으면 `metaverse` 대신 다른 이름도 돼요. 주소도 그 이름으로 바뀌어요.)

## 2. Apache 설정 확인 (AllowOverride All)

`.htaccess` 파일이 `config/`, `lib/`, `data/` 폴더를 웹에서 막아 줘요. XAMPP 는 기본으로 켜져 있지만 한 번 확인하세요.

1. `C:\xampp\apache\conf\httpd.conf` 를 메모장으로 열어요.
2. `<Directory "C:/xampp/htdocs">` 블록 안에 **`AllowOverride All`** 이 있는지 봐요 (`None` 이면 `All` 로 바꿔요).
3. `LoadModule rewrite_module modules/mod_rewrite.so` 와 `LoadModule headers_module modules/mod_headers.so` 앞의 `#` 이 없어야 해요.
4. 바꿨다면 XAMPP Control Panel 에서 Apache 를 **Stop → Start**.

> 설치가 끝난 뒤 **관리자 센터 → 시스템 점검** 의 "data/ 외부 노출 검사" 가 ✅ 이면 .htaccess 가 제대로 동작하는 거예요.

## 3. 설치 마법사 (install.php)

1. XAMPP Control Panel 에서 **Apache** 와 **MySQL** 을 Start.
2. 브라우저에서 **`http://localhost/metaverse/install.php`** 를 열어요.
3. **1단계 서버 환경 점검** 표가 모두 ✅ 또는 ⚠️ 인지 봐요. ⛔ 가 있으면 안내대로 고치고 새로고침 (예: `php.ini` 에서 `extension=curl` 켜기 → Apache 재시작).
4. **2단계 데이터베이스**: XAMPP 기본값이 미리 들어 있어요 — 종류 `MySQL / MariaDB`, 호스트 `127.0.0.1`, 포트 `3306`, 데이터베이스 `fermentation_metaverse`, 사용자 `root`, 비밀번호 비움. "데이터베이스가 없으면 새로 만들기" 를 켜 두면 마법사가 만들어요.
   - phpMyAdmin 에서 다른 이름의 데이터베이스나 전용 사용자를 만들었다면 그 값을 적어요 (운영 서버는 전용 사용자 권장).
   - 소규모·테스트라면 `SQLite` 를 골라도 돼요 (설정 없음, `data/` 폴더에 파일로 저장).
5. **3단계 첫 관리자**: 이메일·닉네임(2~12자)·비밀번호(8자 이상, 영문+숫자). 이 계정으로 `admin.php` 와 체험관에 로그인해요. 첫 관리자는 `운영자`·`관리자` 같은 직원용 닉네임도 쓸 수 있어요 (일반 가입에서는 사칭을 막기 위해 거부돼요).
6. **4단계 토스페이먼츠(선택)**: 진행 속도 2배·3배·4배 구독을 팔 거라면 토스페이먼츠 개발자센터의 **API 개별 연동 키**(클라이언트 키 `live_ck_…`/`test_ck_…`, 시크릿 키 `live_sk_…`/`test_sk_…`)를 넣어요. 비워 두면 문서용 테스트 키(실제 돈이 오가지 않음)로 동작하고, "모의 결제 모드" 를 켜면 결제 서버에 연결하지 않는 테스트 결제 창이 나와요.
7. **🚀 설치하기** → "설치가 끝났어요!" 화면이 나오면 완료. 마법사는 `data/install.lock` 을 만들어 스스로 잠겨요.

설치 마법사가 한 일: `config/config.local.php` 작성(DB 접속 정보·토스 키), 데이터베이스와 테이블 15개 생성(버전 기록 `schema_version` 포함, `database/schema.sql`, 스키마 v5), 첫 관리자 생성, `data/install.lock`.

> 명령줄로 같은 일을 하려면 (서버 PC):
> `C:\xampp\php\php.exe C:\xampp\htdocs\metaverse\cli\tfm.php install --driver=mysql --host=127.0.0.1 --port=3306 --db=fermentation_metaverse --user=root --pass= --admin-email=you@example.com --admin-nick=운영자 --admin-pass=비밀번호1234 [--toss-client=… --toss-secret=… --mock=1]`

### 수동 설치 (마법사를 쓸 수 없을 때)

1. phpMyAdmin (`http://localhost/phpmyadmin`) → **새로 만들기** → 데이터베이스 이름 `fermentation_metaverse`, 데이터 정렬 방식 **utf8mb4_unicode_ci** → 만들기.
2. 그 데이터베이스를 선택한 채 **가져오기(Import)** → `metaverse/database/schema.sql` 선택 → 실행 (테이블 15개가 생겨요. 다시 실행해도 안전해요).
3. `metaverse/config/config.local.php` 를 만들어요:
   ```php
   <?php
   return [
       'db' => ['driver' => 'mysql', 'mysql' => ['host' => '127.0.0.1', 'port' => 3306, 'database' => 'fermentation_metaverse', 'username' => 'root', 'password' => '']],
       'toss' => ['client_key' => 'test_ck_…', 'secret_key' => 'test_sk_…', 'mock' => false],
   ];
   ```
4. `http://localhost/metaverse/` 에서 회원가입 → 같은 PC 에서 `admin.php` 로 로그인하면 **"이 계정을 관리자로 지정"** 버튼이 보여요 (관리자가 없을 때, 서버 PC 에서만).
5. 마법사를 막으려면 `metaverse/data/install.lock` 이라는 빈 파일을 만들어 두세요.

## 4. 열어 보기

- 체험관: `http://localhost/metaverse/` — 화면 위 칩이 **서버** 로 보이면 서버 모드예요.
- 관리자 센터: `http://localhost/metaverse/admin.php` — 📊 대시보드 · 🩺 시스템 점검 · 👥 사용자 · ⚡ 구독 · 🚨 신고·채팅 · 📜 감사 로그 · 🧰 유지보수.
- 다른 PC 에서 접속하려면 서버 PC 의 IP 주소(`http://192.168.x.x/metaverse/`)를 쓰고 Windows 방화벽에서 80(또는 443) 포트를 열어요.

## 5. 구독(진행 속도 2·3·4배) 결제 운영

- 가격·이용 기간은 `config/config.local.php` 의 `toss` 항목(`tiers`, `period_days` 30일, `grace_days` 3일)에서 바꿔요. 기본 가격은 자리표시자예요 (2배 2,900원 · 3배 4,900원 · 4배 6,900원).
- 토스 개발자센터 **웹훅 주소**: `https://<내 도메인>/metaverse/api/sub/webhook.php` (결제 취소·환불이 들어오면 구독이 자동으로 내려가요).
- **자동 갱신**: 하루 한 번 `php.exe cli\tfm.php sub:renew` 를 돌려야 빌링키 결제가 이어져요. 로그인할 때도 서버가 스스로 확인하지만(한 시간에 한 번), 예약 실행을 권장해요.
  - Windows **작업 스케줄러** → 기본 작업 만들기 → 이름 `발효체험관 구독 갱신` → 매일 새벽 4시 → 프로그램 `C:\xampp\php\php.exe`, 인수 `C:\xampp\htdocs\metaverse\cli\tfm.php sub:renew`, 시작 위치 `C:\xampp\htdocs\metaverse`.
- 학교·행사용 무료 부여: 관리자 센터 → ⚡ 구독 → **수동 부여**(사용자·단계·일수), 또는 `php cli\tfm.php sub:grant 이메일 2 30`. 해지는 같은 화면의 **해지** 또는 `sub:revoke`.
- 결제 화면은 어른 메뉴(쉬운 모드에서는 보호자 확인 뒤)에서만 열리고, 아이 화면에는 가격이 나오지 않아요.

## 6. HTTPS

- 공개 인터넷에 열 때는 **반드시 HTTPS** 로 서비스하세요. 토스 결제창과 마이크 입력은 HTTPS(또는 localhost)에서만 동작하고, HTTPS 이면 세션 쿠키에 `Secure` 가 붙어요.
- XAMPP: `C:\xampp\apache\conf\extra\httpd-ssl.conf` 에 인증서를 연결하거나, 도메인이 있으면 Let's Encrypt(win-acme) 를 쓰세요. 그다음 `metaverse/.htaccess` 의 "force HTTPS" 블록 주석을 풀면 http → https 로 넘어가요.

## 7. 백업·업데이트

- 백업: phpMyAdmin → 내보내기, 또는 `mysqldump -u root -p fermentation_metaverse > backup.sql`. `metaverse/uploads/journal/` (사진)과 `metaverse/config/config.local.php`, `metaverse/data/secret.php` 도 함께 보관.
- 업데이트: 새 zip 의 `metaverse` 폴더로 **`config/config.local.php`, `data/`, `uploads/` 를 빼고** 덮어써요. 테이블은 첫 요청 때 자동으로 업그레이드돼요(`schema_version`, 지금은 v5 — 이용 정지 기록에 `chat_retractions.upto_id` 열이 더해져요). phpMyAdmin 으로 새 `database/schema.sql` 을 기존 데이터베이스에 다시 가져와도 안전해요(없는 표·열만 더해요). `install.php` 는 `data/install.lock` 이 있으면 열리지 않아요.

## 8. 문제 해결

| 증상 | 확인할 것 |
|---|---|
| `install.php` 가 흰 화면 / 다운로드됨 | PHP 가 실행되지 않아요 — XAMPP Apache 가 켜져 있는지, `.php` 가 PHP 모듈로 처리되는지 |
| 1단계에 ⛔ "PHP 확장: curl" | `C:\xampp\php\php.ini` 에서 `;extension=curl` 의 `;` 를 지우고 Apache 재시작 |
| "MySQL/MariaDB 에 연결하지 못했어요" | XAMPP 의 MySQL 이 Start 상태인지, 포트 3306, 사용자 root/빈 비밀번호 (바꿨다면 그 값) |
| 칩이 계속 **로컬** | `http://localhost/metaverse/api/ping.php` 가 JSON 을 주는지 확인 |
| 시스템 점검 "data/ 외부 노출 검사" ⛔ | 2장의 `AllowOverride All` |
| "이미 설치되었어요" | 다시 설치하려면 `metaverse/data/install.lock` 삭제 (데이터는 지워지지 않음) |
| 구독 결제창이 안 열려요 | 어른 메뉴에서 열었는지, HTTPS 인지, 토스 키가 맞는지(관리자 센터 → 시스템 점검 "구독 결제 모드") |
| 32비트 PHP | 밀리초 시각·저장 체크섬에 64비트 정수가 필요해요 — 64비트 XAMPP 를 설치하세요 |

로그는 `metaverse/data/logs/app-날짜.log.php` (한 줄에 JSON 하나, 웹에서는 열리지 않음). 오류 화면의 번호(`rid`)로 찾을 수 있어요.
