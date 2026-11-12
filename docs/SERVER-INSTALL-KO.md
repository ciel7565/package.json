# 전통발효체험관 메타버스 — 서버 설치 안내 (XAMPP · Apache 2.4 · PHP 7.2+ · MariaDB 10.3+)

이 문서는 **윈도우 PC에 XAMPP 가 설치된 운영자**를 위한 단계별 안내예요. 화면에 보이는 그대로 따라가면
`http://localhost/metaverse/` 에서 서버 모드(회원가입·저장·채팅·구독 결제)가 켜져요.
개발자용 상세 설명(Nginx, 환경 변수, 저장 검증, API 목록)은 `server/README-SERVER.md`,
**보안 점검 결과와 운영자가 할 일 전체는 `docs/SECURITY-REPORT-KO.md`** 에 있어요.

> 이 안내의 기준 환경(주인의 서버): **Apache/2.4.34 (Win32) · PHP 7.2.10 · MariaDB 10.3.8 · phpMyAdmin 4.8.3**.
> 서버 코드는 PHP 7.2 문법만 쓰고(8.x 에서도 동작), `intl`·`sodium` 확장이 없어도 돌아가요. **64비트 PHP** 가 필요해요.
> 자동 시험은 PHP 8.3.6 · MariaDB 10.11.14 · Apache 2.4.58 에서 돌렸고, PHP 7.2 는 문법 검사로 확인했어요. 설치한 뒤 이 서버에서 직접 확인하는 순서(15분)는 `docs/SECURITY-REPORT-KO.md` 5.3 에 있어요.
> ⚠️ PHP 7.2 · MariaDB 10.3 · Apache 2.4.34 · phpMyAdmin 4.8.3 은 보안 업데이트가 끝났거나 알려진 취약점이 있는 버전이에요. 가능하면 새 XAMPP(PHP 8.2+, MariaDB 10.11+)로 옮기세요 (보고서 §17).
>
> **공개 인터넷에 열기 전에 꼭**: 6장(HTTPS) · 4-1(관리자 센터 잠그기) · 7장(DB 잠그기) · 8장(백업 예약) · 2장(httpd.conf 세 줄).

---

## 0. 준비물

| 항목 | 확인 방법 |
|---|---|
| XAMPP (Apache + MySQL/MariaDB + PHP 7.2 이상, 64비트) | XAMPP Control Panel 에서 **Apache**, **MySQL** 두 줄이 보여요 |
| 배포 zip (`fermentation-metaverse.zip`) | 안에 `metaverse/` 폴더와 `전통발효체험관.html` 이 있어요 |
| PHP 확장 `pdo_mysql`, `mbstring`, `curl`, `json`, `openssl`, `session` | XAMPP 기본값이 모두 켜져 있어요 (`C:\xampp\php\php.ini` 의 `extension=` 줄) |
| PHP 확장 `gd` | **사진 업로드에 꼭 필요해요** (사진을 다시 그려서 위치 정보를 지워요. 없으면 업로드를 받지 않아요). `php.ini` 에서 `extension=gd`(XAMPP 7.2 는 `extension=gd2`) 앞의 `;` 를 지우세요 |

## 1. 폴더 복사

1. zip 을 풀어 `metaverse` 폴더를 **`C:\xampp\htdocs\metaverse`** 로 복사해요.
2. 폴더 안에 `index.html`, `install.php`, `admin/`(관리자 센터), `admin.php`, `api/`, `lib/`, `config/`, `database/`, `data/`, `cli/` 가 있는지 확인해요.
   - `admin.php` 는 예전 관리자 주소예요. 이제는 "없는 페이지"로만 답해요. **지우지 말고 그대로 두세요** — 새 버전을 예전 설치 위에 덮어쓸 때 예전 관리자 화면을 바꿔 줘요.
3. (설치 폴더 이름을 바꾸고 싶으면 `metaverse` 대신 다른 이름도 돼요. 주소도 그 이름으로 바뀌어요.)

## 2. Apache 설정 확인

`.htaccess` 파일이 `config/`, `lib/`, `data/` 폴더를 웹에서 막고, http 를 https 로 보내고, 보안 머리글을 붙여요. XAMPP 는 기본으로 켜져 있지만 한 번 확인하세요.

1. `C:\xampp\apache\conf\httpd.conf` 를 메모장으로 열어요.
2. `<Directory "C:/xampp/htdocs">` 블록 안에 **`AllowOverride All`** 이 있는지 봐요 (`None` 이면 `All` 로 바꿔요).
3. `LoadModule rewrite_module modules/mod_rewrite.so` 와 `LoadModule headers_module modules/mod_headers.so` 앞의 `#` 이 없어야 해요.
4. **파일 맨 아래에 세 줄을 넣어요** (서버 버전을 숨기고, 요청을 되돌려 주는 TRACE 방식을 끄는 설정 — `.htaccess` 로는 바꿀 수 없어요):
   ```apache
   ServerTokens Prod
   ServerSignature Off
   TraceEnable Off
   ```
   (XAMPP 는 `C:\xampp\apache\conf\extra\httpd-default.conf` 에 `ServerTokens Full` · `ServerSignature On` 이 있어요. 그 줄을 `Prod` · `Off` 로 바꿔도 되고, httpd.conf 맨 아래에 넣은 줄이 나중에 읽혀서 이겨요.)
5. `C:\xampp\php\php.ini` 에서 `display_errors = Off`, `log_errors = On`, `expose_php = Off` 인지 확인하고, 사진 업로드에 필요한 `extension=gd2`(또는 `extension=gd`) 앞의 `;` 를 지워요.
6. 바꿨다면 XAMPP Control Panel 에서 Apache 를 **Stop → Start**.

> 설치가 끝난 뒤 **관리자 센터 → 🩺 시스템 점검** 에 "웹 노출" ⛔ 가 없으면 .htaccess 가 제대로 동작하는 거예요.

## 3. 설치 마법사 (install.php)

1. XAMPP Control Panel 에서 **Apache** 와 **MySQL** 을 Start.
2. 브라우저에서 **`http://localhost/metaverse/install.php`** 를 열어요.
3. **1단계 서버 환경 점검** 표가 모두 ✅ 또는 ⚠️ 인지 봐요. ⛔ 가 있으면 안내대로 고치고 새로고침 (예: `php.ini` 에서 `extension=curl` 켜기 → Apache 재시작).
4. **🔑 설치 코드**: 이 서버의 주인인지 확인하는 한 번만 쓰는 코드예요(인터넷의 다른 사람은 볼 수 없어요). 서버 컴퓨터의 명령 프롬프트에서
   `C:\xampp\php\php.exe C:\xampp\htdocs\metaverse\cli\tfm.php setup-code` 를 실행하거나, `metaverse\data\setup-code.php` 를 메모장으로 열어 맨 위 줄의 코드를 넣어요. 24시간 동안 쓸 수 있고 설치가 끝나면 사라져요.
5. **2단계 데이터베이스**: XAMPP 기본값이 미리 들어 있어요 — 종류 `MySQL / MariaDB`, 호스트 `127.0.0.1`, 포트 `3306`, 데이터베이스 `fermentation_metaverse`, 사용자 `root`, 비밀번호 비움(root 에 비밀번호를 넣었다면 그 비밀번호).
   - 여기 넣는 것은 **DB 관리자 계정**이에요. 설치하는 동안 한 번만 쓰고 **어디에도 저장하지 않아요**.
   - **"전용 DB 계정 만들기 (권장)"** 를 켜 두면 마법사가 체험관만 쓰는 계정 `tfm_무작위8자` 를 만들어요 — 이 데이터베이스의 자료를 읽고 쓰기만 할 수 있고, 비밀번호는 32자 무작위로 만들어 설정 파일에만 적어요.
   - "데이터베이스가 없으면 새로 만들기" 를 켜 두면 마법사가 만들어요.
   - 소규모·테스트라면 `SQLite` 를 골라도 돼요 (설정 없음, `data/` 폴더에 추측하기 어려운 이름의 파일로 저장).
6. **3단계 첫 관리자**: 이메일·닉네임(2~12자)·비밀번호(8자 이상, 영문+숫자). 이 계정으로 관리자 센터와 체험관에 로그인해요. 첫 관리자는 `운영자`·`관리자` 같은 직원용 닉네임도 쓸 수 있어요.
   - **"관리자 센터 주소를 아무도 모르는 이름으로 바꾸기 (권장)"** 는 켜 둔 채로 두세요. 기본 주소 `…/admin/` 은 누구나 짐작할 수 있어요.
7. **4단계 토스페이먼츠(선택)**: 진행 속도 2배·3배·4배 구독을 팔 거라면 토스페이먼츠 개발자센터에서 발급받은 **내 API 키**(클라이언트 키 `live_ck_…`/`test_ck_…`, 시크릿 키 `live_sk_…`/`test_sk_…`)를 넣어요 — 받는 곳은 5장. **비워 두면 결제는 "설정 필요"로 꺼져 있어요** (문서에 실린 예시 키는 넣어도 쓰지 않아요). "모의 결제 모드" 는 결제 서버 없이 이 서버 컴퓨터에서만 흐름을 시험하는 기능이에요 — 운영 서버에서는 켜지 마세요.
8. **🚀 설치하기** → "설치가 끝났어요!" 화면에서
   - **새 관리자 센터 주소**를 즐겨찾기에 넣으세요. 이 화면에만 한 번 보여요 (잊으면 서버 컴퓨터에서 `… cli\tfm.php admin:path`).
   - **"🛡️ 설치 후 보안 점검"** 표에 나온 것을 차례로 고치세요 (나중에 관리자 센터 → 🩺 시스템 점검에서 다시 볼 수 있어요).

설치 마법사가 한 일: `config/config.local.php` 작성(전용 DB 계정·토스 키), 데이터베이스와 테이블 생성(`database/schema.sql`, 스키마 v6), 첫 관리자 생성, 관리자 폴더 이름 바꾸기, `data/install.lock`.
설치가 끝나면 `install.php` 는 **없는 페이지(404)** 처럼 답해요. 계정이 있는 서버, `config.local.php` 가 있는 서버에서도 마찬가지예요.

> 명령줄로 같은 일을 하려면 (서버 컴퓨터) — **비밀번호와 키는 명령줄에 쓰지 않아요**. 명령이 화면에 보이지 않게 물어봐요:
> `C:\xampp\php\php.exe C:\xampp\htdocs\metaverse\cli\tfm.php install --driver=mysql --host=127.0.0.1 --port=3306 --db=fermentation_metaverse --user=root --admin-email=you@example.com --admin-nick=운영자 [--toss-client=test_ck_… --mock]`
> → DB 관리자 비밀번호(XAMPP 기본은 그냥 Enter), 첫 관리자 비밀번호(두 번), `--toss-client` 를 줬다면 토스 시크릿 키를 물어요. 다른 프로그램에서 부를 때는 환경 변수 `TFM_DB_ADMIN_PASS`, `TFM_ADMIN_PASS`, `TFM_TOSS_SECRET_KEY` 를 써요.
> 명령줄 설치는 관리자 폴더 이름을 바꾸지 않아요: 이어서 `… cli\tfm.php admin:path --random`.

### 수동 설치 (마법사를 쓸 수 없을 때)

1. phpMyAdmin (`http://localhost/phpmyadmin`) → **새로 만들기** → 데이터베이스 이름 `fermentation_metaverse`, 데이터 정렬 방식 **utf8mb4_unicode_ci** → 만들기.
2. 그 데이터베이스를 선택한 채 **가져오기(Import)** → `metaverse/database/schema.sql` 선택 → 실행 (다시 실행해도 안전해요).
3. **SQL** 탭에서 체험관 전용 계정을 만들어요 (`비밀번호` 자리에는 32자 이상 무작위 글자):
   ```sql
   CREATE USER 'tfm_app01'@'localhost' IDENTIFIED BY '비밀번호';
   CREATE USER 'tfm_app01'@'127.0.0.1' IDENTIFIED BY '비밀번호';
   GRANT SELECT, INSERT, UPDATE, DELETE ON `fermentation\_metaverse`.* TO 'tfm_app01'@'localhost';
   GRANT SELECT, INSERT, UPDATE, DELETE ON `fermentation\_metaverse`.* TO 'tfm_app01'@'127.0.0.1';
   ```
4. `metaverse/config/config.local.php` 를 만들어요:
   ```php
   <?php
   if (!defined('TFM_BOOT')) { http_response_code(404); exit; }
   return [
       'db' => ['driver' => 'mysql', 'auto_migrate' => false,
                'mysql' => ['host' => '127.0.0.1', 'port' => 3306, 'database' => 'fermentation_metaverse', 'username' => 'tfm_app01', 'password' => '비밀번호']],
       'toss' => ['client_key' => '내 클라이언트 키', 'secret_key' => '내 시크릿 키', 'mock' => false],
   ];
   ```
5. `http://localhost/metaverse/` 에서 회원가입 → 서버 컴퓨터에서 `C:\xampp\php\php.exe C:\xampp\htdocs\metaverse\cli\tfm.php promote 이메일` 로 관리자 지정.
   (또는 관리자 센터 로그인 화면의 **"첫 관리자 지정"** — 관리자가 한 명도 없을 때만, 체험관 계정 + 비밀번호 + **설치 코드**(`… cli\tfm.php setup-code`)가 필요해요.)
6. `metaverse/data/install.lock` 이라는 빈 파일을 만들고, `… cli\tfm.php admin:path --random` 으로 관리자 폴더 이름을 바꿔요.

## 4. 열어 보기

- 체험관: `http://localhost/metaverse/` — 화면 위 칩이 **서버** 로 보이면 서버 모드예요.
- 관리자 센터: `http://localhost/metaverse/<관리자 폴더>/` — 설치 완료 화면의 주소, 또는 서버 컴퓨터에서 `… cli\tfm.php admin:path`. 관리자 계정으로 체험관에 로그인하면 메뉴에 관리자 센터 버튼이 생겨요.
  탭: 📊 대시보드 · 🩺 시스템 점검 · 👥 사용자 · ⚡ 구독·결제 · 🚨 신고·채팅 · 🛡️ 보안(수상한 활동·차단 주소·관리자 로그인 기록) · 🔐 2단계 인증 · 📜 감사 로그 · 🧰 유지보수.
  체험관에 로그인되어 있어도 관리자 센터는 비밀번호를 한 번 더 묻고, 30분 동안 쓰지 않으면 다시 물어요.
- 다른 PC 에서 접속하려면 서버 PC 의 IP 주소(`http://192.168.x.x/metaverse/`)를 쓰고 Windows 방화벽에서 80(또는 443) 포트를 열어요. 공개 주소로 열면 http 는 https 로 넘어가요(6장).

### 4-1. 관리자 센터 잠그기 (꼭 하세요)

1. **주소 바꾸기**: 설치 때 "아무도 모르는 이름으로 바꾸기" 를 껐거나 명령줄로 설치했다면 서버 컴퓨터에서
   `C:\xampp\php\php.exe C:\xampp\htdocs\metaverse\cli\tfm.php admin:path --random` → 새 주소가 한 번 보여요. 즐겨찾기에 넣으세요. (직접 정하려면 `admin:path 이름` — 영어 소문자·숫자·`-` 4~40자.)
2. **2단계 인증**: 관리자 센터 → 🔐 2단계 인증 탭 → "2단계 인증 켜기" → 휴대폰 인증 앱(Google Authenticator, Microsoft Authenticator 등)에서 **＋ → "설정 키 입력"** 을 고르고 화면에 보이는 비밀 키 글자를 넣어요 (스크립트 없는 화면이라 QR 그림은 없어요) → 앱의 6자리 숫자 넣기 → **백업 코드 10개를 종이에 적어 안전한 곳에**. 모든 관리자가 등록하면 `config/config.local.php` 에 `'security' => ['admin_2fa' => 'required']` 를 더해요.
3. **허용 주소**: 관리자가 일하는 곳의 인터넷 주소만 관리자 센터를 열게 해요. `config/config.local.php` 에 `'security' => ['admin_ip_allowlist' => ['203.0.113.7', '192.168.0.0/24']]` (또는 Apache 의 `SetEnv TFM_ADMIN_IPS "203.0.113.7,192.168.0.0/24"`). 다른 곳에서는 "없는 페이지"로 보여요. 서버 컴퓨터 자신도 목록에 없으면 막혀요.
4. (선택) 한 겹 더: 관리자 폴더의 `.htaccess` 안에 주석으로 들어 있는 `Require ip` 블록이나 Basic 인증(브라우저 비밀번호 창) 블록을 풀어요.
5. **휴대폰을 잃었을 때**: 서버 컴퓨터에서 `… cli\tfm.php admin:2fa-reset 이메일` → 비밀번호만으로 들어가서 바로 다시 등록. 코드를 여러 번 틀려 잠겼을 때는 `admin:2fa-unlock 이메일`.

> `config.local.php` 에 `security` 처럼 같은 이름의 묶음이 이미 있으면 그 안에 줄을 더해요 (두 번 쓰면 아래 것만 남아요).

## 5. 구독(진행 속도 2·3·4배) 결제 운영

- **토스 키가 있어야 결제가 열려요.** 키가 없으면 체험관의 구독 화면에 "결제 설정이 필요해요" 가 보이고 결제 버튼이 꺼져 있어요(이번 버전부터 기본 키가 없어요).
- **내 키 받기**: 토스페이먼츠 개발자센터(`developers.tosspayments.com`)에 사업자 계정으로 로그인 → **내 개발 정보** → **API 키** 에서 "API 개별 연동 키" 의 **클라이언트 키**(`test_ck_…`/`live_ck_…`)와 **시크릿 키**(`test_sk_…`/`live_sk_…`)를 확인해요. 처음에는 `test_` 키(돈이 오가지 않는 시험용), 실제 판매 전에 `live_` 키로 바꿔요.
- **키를 넣는 곳은 두 곳뿐**: `config/config.local.php` 의 `'toss' => ['client_key' => …, 'secret_key' => …, 'mock' => false]`, 또는 Apache 의 환경 변수 `SetEnv TFM_TOSS_CLIENT_KEY …` · `SetEnv TFM_TOSS_SECRET_KEY …`. `config.local.php` 와 `data/` 는 깃(저장소)에 올라가지 않게 막혀 있어요(`.gitignore`). **시크릿 키는 깃·문서·메일·메신저·zip 에 절대 넣지 마세요** — 새어 나갔다고 의심되면 같은 화면에서 **재발급**하면 예전 키는 바로 못 써요(보고서 §21).
- 실제 판매 전에 `test_` 키로 **한 번 결제해 보세요**. 그다음 `live_` 키로 바꿔요.
- 가격·이용 기간은 `config/config.local.php` 의 `toss` 항목(`tiers`, `period_days` 30일, `grace_days` 3일)에서 바꿔요. 기본 가격은 자리표시자예요 (2배 2,900원 · 3배 4,900원 · 4배 6,900원). 금액은 언제나 서버가 정하고, 결제 회사의 답까지 다시 확인해요.
- 토스 개발자센터 **웹훅 주소**: `https://<내 도메인>/metaverse/api/sub/webhook.php` (결제 취소·환불이 들어오면 구독이 자동으로 내려가요).
- **자동 갱신**: 하루 한 번 `php.exe cli\tfm.php sub:renew` 를 돌려야 빌링키 결제가 이어져요. 로그인할 때도 서버가 스스로 확인하지만(한 시간에 한 번), 예약 실행을 권장해요 — 작업 스케줄러 등록은 8-2. 자동 갱신은 카드를 등록한 그 단계만 청구하고, 같은 기간에 두 번 청구하지 않아요.
- 학교·행사용 무료 부여: 관리자 센터 → ⚡ 구독 → **수동 부여**(사용자·단계·일수), 또는 `php cli\tfm.php sub:grant 이메일 2 30`. 해지는 같은 화면의 **해지** 또는 `sub:revoke`.
- 결제 화면은 어른 메뉴(쉬운 모드에서는 보호자 확인 뒤)에서만 열리고, 아이 화면에는 가격이 나오지 않아요.
- 모의 결제(`TFM_TOSS_MOCK=1`)는 서버 컴퓨터에서만 동작해요. 공개 운영 서버에서는 저절로 꺼지고 점검 화면에 ⛔ 가 떠요.

## 6. HTTPS (인증서)

공개 인터넷에 열 때는 **반드시 HTTPS**(브라우저와 서버 사이를 암호화하는 길)로 서비스하세요. 로그인 비밀번호와 결제가 암호화되고, 토스 결제창과 마이크 입력은 HTTPS(또는 localhost)에서만 동작하고, 세션 쿠키에 `Secure`(https 로만 보냄)가 붙어요.

- **http → https 이동은 기본으로 켜져 있어요** (`security.force_https = auto`): 공개 주소로 `http://` 로 오면 `https://` 로 보내고, 암호화 없이 보낸 로그인·저장은 비밀번호를 읽기 전에 거절해요. 서버 컴퓨터 자신(`localhost`)은 예외예요. 그래서 **인증서를 달기 전에 공개 주소로 열면 방문자가 열리지 않는 https 주소로 가요** — 인증서를 먼저 다세요.

### 6-1. 인증서 달기 (XAMPP)

1. **도메인이 있으면 Let's Encrypt(무료 인증서)**: Windows 용 도구 **win-acme**(`wacs.exe`)를 관리자 권한으로 실행해 내 도메인의 인증서를 **PEM 파일**로 받아요. 도메인 확인은 "웹 폴더에 파일 두기(http-01)" 방식, 웹 폴더는 `C:\xampp\htdocs` 예요. 인증서는 90일짜리라 win-acme 가 작업 스케줄러에 갱신을 스스로 등록해요. 새 파일을 Apache 가 읽으려면 다시 시작해야 하니, 한 달에 한 번 Apache 를 Stop → Start 하세요(또는 win-acme 의 설치 스크립트 단계에 재시작을 넣어요).
2. **연결하기**: `C:\xampp\apache\conf\httpd.conf` 에서 `LoadModule ssl_module modules/mod_ssl.so` 와 `Include conf/extra/httpd-ssl.conf` 앞에 `#` 이 없는지 확인 → `C:\xampp\apache\conf\extra\httpd-ssl.conf` 의 `<VirtualHost _default_:443>` 안의 줄을 이렇게 바꿔요 (파일 이름은 win-acme 가 만든 그대로):
   ```apache
   ServerName 내도메인.kr:443
   SSLCertificateFile "C:/tfm-cert/내도메인.kr-chain.pem"
   SSLCertificateKeyFile "C:/tfm-cert/내도메인.kr-key.pem"
   ```
   개인 키 파일(`-key.pem`)은 htdocs 밖에 두고 누구에게도 보내지 마세요.
3. Windows 방화벽에서 **443** 포트를 열고(80 은 https 로 보내는 데 쓰여요), XAMPP Control Panel 에서 Apache **Stop → Start**.
4. 확인: `https://내도메인.kr/metaverse/` 가 자물쇠와 함께 열리고, `http://내도메인.kr/metaverse/` 는 `https://` 로 바뀌어야 해요. 관리자 센터 → 🩺 시스템 점검의 "HTTPS 강제" 가 ✅.

- **도메인이 없는 교실 내부망**: 내부 인증 기관(CA)으로 만든 인증서를 같은 방법으로 연결하거나, 인증서 없이 쓸 때만 `config.local.php` 에 `'security' => ['force_https' => 'off']` (점검 화면이 ⚠, 공개 주소면 ⛔ 로 알려요).
- 앞에 다른 서버(리버스 프록시)를 둔다면 그 주소를 `security.trusted_proxies` 에 적어요(그때만 `X-Forwarded-Proto` 를 믿어요).

## 7. 데이터베이스 잠그기 (한 번만)

데이터베이스(DB)는 회원 정보와 결제 기록이 들어 있는 "창고" 예요. 아래 순서대로 하면 창고 문을 잠그고, 열쇠를 꼭 필요한 사람에게만 줄 수 있어요. 명령은 **서버 컴퓨터**에서 해요. SQL 문장은 phpMyAdmin 의 **SQL** 탭이나 명령 창의 `C:\xampp\mysql\bin\mysql.exe -u root -p` 에 붙여 넣어요.
(용어: **root** = DB 의 최고 관리자 계정, **전용 계정** = 체험관만 쓰는 계정, **권한** = 그 계정이 할 수 있는 일)

**7-0. 지금 상태 보기** (먼저 한 번)
```sql
SELECT User, Host, plugin, IF(authentication_string = '' AND Password = '', '비밀번호 없음', '있음') AS pw FROM mysql.user;
SHOW DATABASES;
```
`User` 가 빈 줄(익명 계정)이 보이면 7-2, `root` 가 "비밀번호 없음" 이면 7-1, `test` 데이터베이스가 보이면 7-3, 관리자 센터 🩺 시스템 점검(또는 `… cli\tfm.php status`)의 "🗄️ DB 계정" 줄이 ⛔ 이면 7-6.

**7-1. root 에 비밀번호 넣기** — XAMPP 는 처음에 root 비밀번호가 비어 있어서, 이 PC 의 아무 프로그램이나 DB 전체를 지울 수 있어요.
```sql
ALTER USER 'root'@'localhost' IDENTIFIED BY '여기에-긴-비밀번호-20자-이상';
ALTER USER 'root'@'127.0.0.1' IDENTIFIED BY '여기에-긴-비밀번호-20자-이상';
ALTER USER 'root'@'::1'       IDENTIFIED BY '여기에-긴-비밀번호-20자-이상';
FLUSH PRIVILEGES;
```
(없는 계정이 있으면 그 줄은 오류가 나도 괜찮아요.) 그다음 phpMyAdmin 이 로그인 화면을 보여 주게 `C:\xampp\phpMyAdmin\config.inc.php` 에서 `$cfg['Servers'][$i]['auth_type'] = 'cookie';` 로 바꾸고 `$cfg['Servers'][$i]['password'] = '';` 는 비워 둬요(비밀번호를 파일에 적지 않아요). root 비밀번호는 종이나 비밀번호 관리 프로그램에 보관하고, 체험관 설정 파일에는 **적지 않아요**(체험관은 전용 계정을 써요).

**7-2. 익명 계정 지우기** — 이름이 빈 계정은 아무 이름으로나 들어올 수 있게 해 줘요.
```sql
DROP USER IF EXISTS ''@'localhost';
DROP USER IF EXISTS ''@'%';
DROP USER IF EXISTS ''@'127.0.0.1';
FLUSH PRIVILEGES;
```

**7-3. test 데이터베이스와 "누구나 test" 권한 지우기** — 기본 설치에는 모든 계정이 쓸 수 있는 `test` 데이터베이스가 있어요(점검 화면: "test 데이터베이스가 모든 계정에 열려 있어요").
```sql
DROP DATABASE IF EXISTS test;
DELETE FROM mysql.db WHERE Db = 'test' OR Db = 'test\\_%';
FLUSH PRIVILEGES;
```
(MariaDB 10.11 이상에서는 `PUBLIC` 권한으로 보여요: ``REVOKE ALL PRIVILEGES ON `test`.* FROM PUBLIC; REVOKE ALL PRIVILEGES ON `test\_%`.* FROM PUBLIC;``)

**7-4. 밖에서 DB 에 접속하지 못하게** — 체험관과 DB 가 같은 PC 에 있으면 DB 는 그 PC 안에서만 들으면 돼요.
- `C:\xampp\mysql\bin\my.ini` 의 `[mysqld]` 아래에 다음 두 줄을 넣고 XAMPP Control Panel 에서 MySQL **Stop → Start**:
  ```ini
  bind-address = 127.0.0.1
  local_infile = 0
  ```
  (`skip-networking` 은 Windows 의 XAMPP 에서 쓰지 마세요 — PHP 가 127.0.0.1 로 접속하기 때문에 체험관이 DB 에 못 들어가요.)
- Windows 방화벽의 "인바운드 규칙" 에서 **3306** 포트를 다른 컴퓨터에 열지 않아요(기본으로 닫혀 있는지 확인).
- `root@'%'`(어디서나 들어오는 root)가 있으면 지워요: `DROP USER IF EXISTS 'root'@'%'; FLUSH PRIVILEGES;`
- DB 가 **다른 컴퓨터**에 있어야 한다면 암호화(TLS)를 켜고 `config/config.local.php` 의 `db.mysql.ssl_ca` 에 CA 인증서 파일 경로를 적어요. 체험관은 암호화 없는 원격 DB 에는 연결하지 않아요.

**7-5. phpMyAdmin 은 서버 컴퓨터에서만** — phpMyAdmin 은 DB 를 통째로 볼 수 있는 화면이라 인터넷에 열리면 안 돼요. `C:\xampp\apache\conf\extra\httpd-xampp.conf` 의 phpMyAdmin 부분이 다음처럼 `Require local` 인지 확인해요(`Require all granted` 면 바꾸고 Apache 재시작). 쓰지 않을 때는 `Require all denied` 로 막아 둬도 돼요.
```apache
<Directory "C:/xampp/phpMyAdmin">
    AllowOverride AuthConfig
    Require local
    ErrorDocument 403 /error/XAMPP_FORBIDDEN.html.var
</Directory>
```
phpMyAdmin 4.8.3 에는 알려진 취약점이 있어요 — 지원되는 최신 버전으로 바꾸세요(보고서 §17).

**7-6. 체험관은 전용 계정으로 (가장 적은 권한)** — 체험관은 자료를 **읽고(SELECT) 쓰고(INSERT) 고치고(UPDATE) 지우기(DELETE)** 만 하면 돼요.
- 설치 마법사(3장)나 `… cli\tfm.php install` 이 **자동으로** 전용 계정 `tfm_무작위8자` 를 만들고, 32자 무작위 비밀번호를 `config/config.local.php` 에만 적어요. root 정보는 저장하지 않아요.
- 이미 root 로 돌아가는 설치라면: `… cli\tfm.php db:account --admin-user root` (root 비밀번호는 화면에 보이지 않게 물어봐요) — 자료는 그대로 두고 전용 계정으로 바꿔요.
- 확인: `SHOW GRANTS FOR 'tfm_xxxxxxxx'@'localhost';` 에 ``GRANT SELECT, INSERT, UPDATE, DELETE ON `fermentation\_metaverse`.* TO …`` 와 `GRANT USAGE ON *.* …` 두 줄만 있어야 해요. (`\_` 는 이름의 밑줄을 "아무 글자" 가 아닌 진짜 밑줄로 읽게 하는 표시예요.)
- 손으로 만들어야 할 때(관리자에게 계정 만드는 권한이 없을 때) 설치 화면이 보여 주는 SQL 은 3장 "수동 설치" 의 3번과 같아요.

**7-7. 업데이트와 비밀번호 바꾸기**
- 새 버전을 올린 뒤 화면에 "서버를 업데이트하는 중이에요" 가 나오면 `… cli\tfm.php migrate --admin-user root` (전용 계정은 표를 바꿀 수 없어서, 업데이트할 때만 root 로 잠깐 접속해요).
- 전용 계정 비밀번호 바꾸기(직원이 바뀌었을 때, 새어 나갔을 때): `… cli\tfm.php db:rotate-password --admin-user root`.
- 다른 프로그램에서 명령을 부를 때는 비밀번호를 명령줄에 쓰지 말고 환경 변수 `TFM_DB_ADMIN_PASS` 로 넘겨요.

**7-8. 그 밖에** — `general_log`(모든 질의 기록)는 꺼 둬요(`SHOW VARIABLES LIKE 'general_log';` → OFF). MariaDB 10.3 은 2023년에 보안 업데이트가 끝났어요 — 가능하면 10.6·10.11 LTS 로. 관리자 센터 🩺 시스템 점검의 DB 줄이 모두 ✅ 인지 한 달에 한 번 확인해요. 백업은 8장.

## 8. 백업·예약 작업·업데이트

### 8-1. 백업 (되살릴 수 있어야 진짜 백업)

- **함께 보관할 것**: DB(`mysqldump` 또는 phpMyAdmin → 내보내기) + **`metaverse\data\secret.php`**(결제 수단 정보를 잠근 열쇠 — 열쇠 없이 DB 만 되살리면 자동 갱신 결제를 못 해요) + `metaverse\config\config.local.php` + `metaverse\uploads\journal\`(사진).
- **어디에**: htdocs 밖의 폴더(예: `D:\tfm-backup`). DB 와 `secret.php` 가 함께 있으면 결제 수단 정보를 열 수 있으니, 그 폴더는 관리자만 열 수 있게(폴더 → 속성 → 보안) 하고, 한 벌은 USB·다른 PC 에.
- **되살려 보기**: 한 달에 한 번 다른 PC 에서 `C:\xampp\mysql\bin\mysql.exe -u root -p 새DB이름 < D:\tfm-backup\tfm-20261112.sql` 로 되살려 보세요.
- **SQLite** 라면 `… cli\tfm.php backup` → `data\backups\tfm-날짜-시각-무작위12자.sqlite` (실행 중에도 안전한 사본) + `data\secret.php`.

**날마다 저절로 백업하기 (MariaDB)** — 예약 작업은 비밀번호를 쳐 줄 사람이 없어서 `mysqldump -u root -p` 로는 멈춰 버려요. **읽기만 하는 백업 전용 계정**과, 그 비밀번호를 담은 설정 파일을 만들어요.
1. 백업 전용 계정 (비밀번호는 새 긴 무작위 글자):
   ```sql
   CREATE USER 'tfm_backup'@'localhost' IDENTIFIED BY '백업용-긴-무작위-비밀번호';
   CREATE USER 'tfm_backup'@'127.0.0.1' IDENTIFIED BY '백업용-긴-무작위-비밀번호';
   GRANT SELECT, SHOW VIEW, TRIGGER, LOCK TABLES ON `fermentation\_metaverse`.* TO 'tfm_backup'@'localhost';
   GRANT SELECT, SHOW VIEW, TRIGGER, LOCK TABLES ON `fermentation\_metaverse`.* TO 'tfm_backup'@'127.0.0.1';
   ```
   (이 계정은 자료를 읽기만 하고, 고치거나 지울 수 없어요.)
2. `D:\tfm-backup\backup.cnf` (메모장으로, 이 폴더는 관리자만 열 수 있게):
   ```ini
   [mysqldump]
   user=tfm_backup
   password=백업용-긴-무작위-비밀번호
   host=127.0.0.1
   ```
3. `D:\tfm-backup\backup.bat` — 날짜 이름으로 DB 와 `secret.php` 를 남기고, 30일 지난 사본은 지워요(데이터 폴더를 `TFM_DATA_DIR` 로 옮겼다면 `secret.php` 경로를 그곳으로):
   ```bat
   @echo off
   set BK=D:\tfm-backup
   for /f %%d in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMdd"') do set D=%%d
   "C:\xampp\mysql\bin\mysqldump.exe" --defaults-extra-file="%BK%\backup.cnf" --single-transaction fermentation_metaverse > "%BK%\tfm-%D%.sql"
   copy /Y "C:\xampp\htdocs\metaverse\data\secret.php" "%BK%\secret-%D%.php" > nul
   forfiles /p "%BK%" /m tfm-*.sql /d -30 /c "cmd /c del @path" 2> nul
   forfiles /p "%BK%" /m secret-*.php /d -30 /c "cmd /c del @path" 2> nul
   ```
   (`--defaults-extra-file` 은 꼭 맨 앞에 써요. 이 방식 — 읽기 전용 계정 + 설정 파일 + `--single-transaction` — 은 MariaDB 에서 시험해서 표 25개가 모두 백업되고 되살아나는 것을 확인했어요.)
4. 명령 프롬프트에서 `D:\tfm-backup\backup.bat` 를 한 번 실행해 `tfm-날짜.sql` 이 생기는지 보고, 아래 8-2 처럼 예약해요.

### 8-2. Windows 작업 스케줄러에 등록할 것

**시작 → "작업 스케줄러" → 오른쪽 "기본 작업 만들기"** 로 하나씩 만들고, 만든 뒤 작업의 **속성 → 일반** 에서 "사용자의 로그온 여부에 관계없이 실행" 을 골라요. 예약 시각에 XAMPP 의 Apache·MySQL 이 켜져 있어야 해요(XAMPP Control Panel 의 Service 칸을 체크해 Windows 서비스로 설치하면 PC 를 켤 때 저절로 켜져요).

| 이름 | 언제 | 프로그램 | 인수 | 시작 위치 |
|---|---|---|---|---|
| 발효체험관 백업 (꼭) | 매일 03:30 | `D:\tfm-backup\backup.bat` | (없음) | `D:\tfm-backup` |
| 발효체험관 구독 갱신 (구독을 판다면 꼭) | 매일 04:10 | `C:\xampp\php\php.exe` | `C:\xampp\htdocs\metaverse\cli\tfm.php sub:renew` | `C:\xampp\htdocs\metaverse` |
| 발효체험관 백업 — SQLite 일 때 (위 백업 대신) | 매일 03:30 | `C:\xampp\php\php.exe` | `C:\xampp\htdocs\metaverse\cli\tfm.php backup` | `C:\xampp\htdocs\metaverse` |
| 발효체험관 설정 점검 (선택) | 매주 월요일 09:10 | `C:\xampp\php\php.exe` | `C:\xampp\htdocs\metaverse\cli\tfm.php config:check` | `C:\xampp\htdocs\metaverse` |

- 다음 날 작업 스케줄러에서 각 작업의 **"마지막 실행 결과"** 가 `0x0`(성공)인지 보세요. 설정 점검이 `0x1` 이면 ⛔ 가 있다는 뜻이에요 → 관리자 센터 🩺 시스템 점검에서 확인.
- SQLite 백업 작업을 쓰면 `data\secret.php` 도 따로 복사해 두세요(백업 파일 `data\backups\` 와 함께 htdocs 밖으로).
- 정리 작업(오래된 기록 지우기)은 요청 중에 저절로 돌아서 따로 예약할 필요가 없어요(바로 하려면 `… cli\tfm.php cleanup`).

### 8-3. 업데이트

- 업데이트: 새 zip 의 `metaverse` 폴더로 **`config/config.local.php`, `data/`, `uploads/` 를 빼고** 덮어써요. 덮어쓰기 전에 8-1 의 백업을 한 번 더 받아 두세요. 관리자 폴더 이름을 바꿨다면 새 zip 의 `admin/` 폴더 내용을 **바꾼 이름의 폴더에** 덮어쓰고, 새 zip 의 `admin/` 폴더 자체는 복사하지 마세요(복사하면 기본 주소로도 관리자 로그인 화면이 열려요 — 점검 화면이 "관리자 폴더 개수" ⚠ 로 알려요).
- 전용 DB 계정은 표를 바꿀 수 없어서, 업데이트 뒤 체험관이 **"서버를 업데이트하는 중이에요"** 라고 하면 서버 컴퓨터에서 `… cli\tfm.php migrate --admin-user root` 를 한 번 실행해요(root 비밀번호는 화면에 보이지 않게 물어봐요). 지금 스키마는 v6 이에요.
- 이번 버전(7단계)으로 올렸다면 예전부터 있던 `data/logs/app-*.log.php` 는 지우세요 (예전 버전은 결제 실패 때 결제 수단 키를 로그에 남겼을 수 있어요).

### 8-4. 예전 설치를 7단계로 올릴 때 (한 번만)

1. 8-1 의 백업을 받고, 8-3 처럼 덮어써요. 예전 `admin.php` 는 이제 "없는 페이지" 예요.
2. 서버 컴퓨터에서 `… cli\tfm.php status` → "서버를 업데이트하는 중이에요" 가 나오면 `… cli\tfm.php migrate --admin-user root`.
3. 체험관이 아직 root 로 DB 를 쓰고 있다면(🩺 "🗄️ DB 계정" ⛔) `… cli\tfm.php db:account --admin-user root` — 자료는 그대로 두고 전용 계정으로 바꿔요. 그다음 7장.
4. 관리자 센터 주소 바꾸기 `… cli\tfm.php admin:path --random` → 새 주소로 로그인 → 🔐 2단계 인증 등록 (4-1).
5. **토스 키**: 예전 버전의 "문서용 예시 키" 기본값이 없어져서, 내 키를 넣기 전까지 결제는 "결제 설정이 필요해요" 로 보여요 (5장).
6. 예전 로그 `data\logs\app-*.log.php` 지우기 (8-3).
7. 자동 갱신이 켜진 채로 예전에 1개월 결제나 무료 부여를 받은 계정이 있는지 `… cli\tfm.php sub:list` 로 한 번 보고, 기간이 짧게 남은 사람은 `sub:grant` 로 채워 주세요.
8. `config.local.php` 에 예전 설정 `admin_emails` 가 있으면 지워도 돼요(이제 이메일만으로 관리자가 되지 않아요 — 점검 ⚠).
9. 마지막으로 관리자 센터 → 🩺 시스템 점검과 `docs/SECURITY-REPORT-KO.md` 5.3 의 확인 순서.

### 8-5. 키 바꾸기

- **서버가 스스로 만든 비밀 키**(로그인 서명용 앱 키 · 결제 수단 봉인용 데이터 키): `… cli\tfm.php secret:rotate` → 모두 한 번 로그아웃돼요. 데이터 키를 바꾼 뒤에는 **백업을 새로** 받으세요(예전 백업의 결제 수단 정보는 예전 키로만 열려요). 점검 화면의 "키 나이" 가 1년을 넘으면 한 번씩.
- **DB 전용 계정 비밀번호**: `… cli\tfm.php db:rotate-password --admin-user root`. 백업 전용 계정(`tfm_backup`)은 `ALTER USER 'tfm_backup'@'localhost' IDENTIFIED BY '새 비밀번호';`(127.0.0.1 도) 뒤 `backup.cnf` 를 고쳐요.
- **토스 시크릿 키**: 토스페이먼츠 개발자센터 → 내 개발 정보 → API 키 → 재발급 → `config.local.php` 에.
- **Claude(Anthropic) 키**(쓴다면): console.anthropic.com → API Keys → 예전 키 끄기 → 새 키를 `ANTHROPIC_API_KEY` 에.
- 언제: 키가 새어 나갔다고 의심될 때, 키를 아는 사람이 떠날 때. 자세한 순서는 보고서 §21.

## 9. 문제 해결

| 증상 | 확인할 것 |
|---|---|
| `install.php` 가 흰 화면 / 다운로드됨 | PHP 가 실행되지 않아요 — XAMPP Apache 가 켜져 있는지, `.php` 가 PHP 모듈로 처리되는지 |
| `install.php` 가 "Not Found" | 이미 설치됐거나(잠금 파일·설정 파일·계정이 있음) 쓰고 있는 서버예요. 다시 설치하려면 서버 컴퓨터에서 `… cli\tfm.php install --force …` |
| "설치 코드가 맞지 않아요" | 서버 컴퓨터에서 `… cli\tfm.php setup-code` 로 지금 코드를 다시 보고 넣어요 (24시간이 지나면 새 코드) |
| 1단계에 ⛔ "PHP 확장: curl" | `C:\xampp\php\php.ini` 에서 `;extension=curl` 의 `;` 를 지우고 Apache 재시작 |
| "MySQL/MariaDB 에 연결하지 못했어요" | XAMPP 의 MySQL 이 Start 상태인지, 포트 3306, 사용자 root 와 그 비밀번호 |
| 칩이 계속 **로컬** | `http://localhost/metaverse/api/ping.php` 가 JSON 을 주는지 확인 |
| 체험관이 "서버를 업데이트하는 중이에요" | 서버 컴퓨터에서 `… cli\tfm.php migrate --admin-user root` |
| 관리자 센터 주소를 잊었어요 | 서버 컴퓨터에서 `… cli\tfm.php admin:path` |
| 관리자 센터가 "Not Found" | 허용 주소(`security.admin_ip_allowlist`)에 지금 있는 곳의 주소가 있는지, 폴더 이름이 맞는지(`admin:path`) |
| 2단계 인증 휴대폰을 잃었어요 / 코드가 잠겼어요 | `… cli\tfm.php admin:2fa-reset 이메일` / `admin:2fa-unlock 이메일` |
| 시스템 점검 "웹 노출" ⛔ | 2장의 `AllowOverride All` |
| 구독 결제창이 안 열려요 / "결제 설정이 필요해요" | 토스 키를 넣었는지(5장), 어른 메뉴에서 열었는지, HTTPS 인지 |
| "요청이 너무 많아요" (교실 전체) | 한 인터넷 주소를 함께 쓰는 교실이면 그 주소를 `security.block.exempt` 에, 한도는 `rate_limits` 에서 |
| "이 인터넷 주소에서는 잠시 접속할 수 없어요" | 자동 차단(수상한 요청이 600초에 25번)에 걸렸어요 → 관리자 센터 🛡️ 보안 탭의 차단 해제, 또는 `… cli\tfm.php ip:unblock <주소>` |
| `http://` 가 `https://` 로 바뀌는데 열리지 않아요 | 인증서를 아직 달지 않았어요(6장). 인증서 없는 내부망이면 `security.force_https = off` |
| 백업 작업의 "마지막 실행 결과" 가 0x0 이 아니에요 | `D:\tfm-backup\backup.bat` 를 명령 프롬프트에서 직접 실행해 보고, `backup.cnf` 의 계정·비밀번호와 MySQL 이 켜져 있는지 확인 (8-1) |
| 32비트 PHP | 밀리초 시각·저장 체크섬에 64비트 정수가 필요해요 — 64비트 XAMPP 를 설치하세요 |

로그는 `metaverse/data/logs/app-날짜.log.php` (한 줄에 JSON 하나, 웹에서는 열리지 않음). 오류 화면의 번호(`rid`)로 찾을 수 있어요.
설치 뒤 운영 서버에서 확인하는 순서(15분)는 `docs/SECURITY-REPORT-KO.md` 5.3 에 있어요.
