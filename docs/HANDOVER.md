# 전통발효체험관 메타버스 — 인수인계 문서 (HANDOVER)

> 새로 맡은 개발자·운영자가 **30분 안에** 실행·검증·수정·배포까지 할 수 있도록 정리한 문서입니다.
> 게임 안에서 `?dev=1` 또는 **F9 / Ctrl+Shift+D** 로 여는 **개발자 점검·인수인계 센터**와 함께 보세요.
> (이 문서는 빌드할 때 HTML 안에 묶여서 개발자 센터 › 📚 문서 탭에서도 읽을 수 있어요.)

---

## 1. 프로젝트 한눈에 보기

| 항목 | 내용 |
|---|---|
| 무엇 | 한국 전통발효문화·농업체험을 3D로 탐험하며 배우는 **브라우저 교육형 메타버스** |
| 형태 | **HTML 파일 하나** (Three.js r170·CSS·글꼴·문서 내장, 인터넷 불필요) + 선택형 **PHP 서버 모드** |
| 구조 | 3D = Three.js / UI = HTML·CSS / 콘텐츠 = `G.data` / 저장 = `G.state` → `G.save` |
| 핵심 체험 | NPC 대화 → 밭 물주기·수확 → 장독 발효(온도·습도·위생→품질) → 교육·퀴즈 → 작업일지 → 보상 |
| 모드 | **로컬**(파일 더블클릭, localStorage) / **서버**(XAMPP·PHP 8.2 + SQLite/MySQL, 계정·검증 저장·실시간 채팅) |

- 게임 속 발효·재배 수치는 **교육용 가상 시뮬레이션**입니다(`G.data.meta.disclaimer`). 칭호는 실제 자격과 무관합니다.
- 상세 설계는 `docs/ARCHITECTURE.md`, 모듈 간 약속(API·이벤트·저장 구조·보안 규칙)은 `docs/CONTRACT.md` 가 기준입니다.

## 2. 실행 방법

### A. 파일로 실행 (로컬 모드)
1. `npm run build` → `dist/metaverse/index.html` (배포 zip 에서는 `전통발효체험관.html`)
2. Chrome·Edge·Firefox·Safari 로 더블클릭 → 저장은 **이 브라우저**(localStorage)
3. 유용한 주소 옵션: `?autostart=1`(게스트 바로 입장) · `?notutorial=1` · `?quality=low|medium|high` · `?debug=1` · `?dev=1`(개발자 센터 자동 열기) · `?local=1`(서버가 있어도 로컬 모드)

### B. XAMPP 서버 모드
1. `npm run build` → `dist/metaverse/` 폴더 전체를 `C:\xampp\htdocs\metaverse` 로 복사
2. XAMPP 에서 **Apache** 시작 (DB 는 SQLite 기본이라 MySQL 없이 동작)
3. `http://localhost/metaverse/` 접속 → 화면 위 칩이 **서버** 인지 확인 → 회원가입
4. 서버 PC 에서 `http://localhost/metaverse/admin.php` → 로그인 → "이 계정을 관리자로 지정"
5. 개발자 센터 › 🌐 서버 점검 과 `admin.php` › 시스템 점검에서 ⛔/⚠️ 를 모두 해결
6. 자세한 설정(MySQL·Nginx·HTTPS·환경 변수)은 `server/README-SERVER.md`

### C. 개발용 PHP 내장 서버
```bash
node tools/build.mjs
php -S 127.0.0.1:8080 -t dist/metaverse        # http://127.0.0.1:8080/
node tests/server-e2e.mjs http://127.0.0.1:8080/ # 서버 보안·기능 E2E
```
> `server/` 폴더에서 직접 서버를 띄우지 마세요(DB·비밀키가 소스 폴더에 생김). 항상 빌드 결과에서 실행합니다.

## 3. 빌드·테스트 명령

| 명령 | 하는 일 |
|---|---|
| `npm install` | 개발 도구 설치 (three, esbuild, playwright, pretendard) |
| `node tools/build.mjs` | 릴리스 빌드 → `dist/metaverse/` (+ 서버 파일 복사, `server/data/game-data.json` 생성) |
| `node tools/build.mjs --strict` | 문법 오류 조각이 하나라도 있으면 실패 (**배포 전 필수**) |
| `node tools/build.mjs --out /tmp/a.html --no-font --only 40,41` | 코어 + 특정 모듈만 빠르게 빌드 (개발용) |
| `node tools/smoke.mjs --file dist/metaverse/index.html --params "autostart=1&quality=low"` | 헤드리스 실행 테스트 — 콘솔·조각·시스템 오류가 있거나 `--eval`·`--script` 가 실패(throw)하면 exit 1 |
| `node tools/smoke.mjs ... --eval "return G.sys.devcenter.runTests()"` | 브라우저 안 자가 테스트(50개+) 실행 결과 출력 |
| `node tools/smoke.mjs ... --shot a.png --viewport 1366x768` / `--mobile` | 스크린샷 (헤드리스 WebGL 은 소프트웨어라 FPS 가 낮은 게 정상) |
| `node tests/server-e2e.mjs` | 서버 E2E (php -S 를 임시 DB 로 띄우고 정리) — 개인정보 가림·닉네임·랭킹 칭호 단계 포함 |
| `node tools/kid-audit.mjs` | 👶 쉬운 모드 화면 자동 점검 (주요 화면 18개, ⛔ 치명이나 페이지 오류가 있으면 exit 1) — §12.4 |
| `node tests/pii-sync.mjs` / `--check` | 60-social 의 개인정보 가림 규칙을 `server/lib/pii-rules.json` 으로 내보내기 / 같은지 확인 (`--strict` 빌드가 확인도 함) |
| `node tests/pii-client.mjs --file dist/metaverse/index.html` | 빌드된 게임 안에서 `tests/pii-vectors.json` 의 모든 문장을 가려 보고, PHP(intl 있음·없음)와 결과가 똑같은지 비교 |
| `npm run package` | 엄격 빌드 + `release/fermentation-metaverse.zip` (`data/`·`uploads/` 는 보호 파일만 담아요 — 시험으로 올린 사진·DB·비밀 키·로그는 zip 에 안 들어가요) |

## 4. 폴더·모듈 지도

`src/game/NN-이름.js` 조각(fragment)이 **파일명 순서**대로 한 클로저에 합쳐집니다. 조각끼리는 `G` 로만 통신하고,
시스템은 `G.register({name, order, init, onStateLoaded, update, onLogout})` 로 등록합니다. 각 JS 와 같은 번호의 CSS 가 짝입니다.

| 번호 | 파일 | 담당 | 역할 |
|---|---|---|---|
| 00–06, 10 | core·data·layout·state·ui·input·world·engine | 코어(리드) | 버스·유틸·저장·UI 도구·입력·충돌·렌더러 |
| 08 | easy | 코어 | **쉬운 모드** `G.easy`: 읽어주기·보호자 확인·그림 고르기·다음 할 일 카드·놀이 시간 알림 (§12) |
| 11–13 | terrain·nature·water | 월드-지형 | 지형·숲·강·연못·폭포 |
| 15–16 | buildings·props | 월드-건물 | 체험관·한옥·장독대·밭·안내판 |
| 17 | manjangdae | 월드-시작 | **정선 만장대**(시작 장소): 전망대·팔각정·표지석·망원경 둘러보기·첫 입장 영상(인트로) (§16) |
| 20–23 | avatar·player·camera·interaction | 플레이어 | 아바타·이동·카메라·E 상호작용 |
| 25–26 | npc·dialogues | NPC | NPC 5명·대화 시스템·대화 데이터 |
| 30–32 | inventory·quest·progression | 성장 | 가방·상점·퀘스트·레벨·업적·도감 |
| 40–41 | farming·fermentation | 농사·발효 | 밭 시뮬레이션·장독 발효·재료 만들기 |
| 45–47 | education-data·education·journal | 교육·일지 | 교육 9종·퀴즈·작업일지 |
| 50–52 | minimap·weather·photo | 지도·날씨·사진 | 미니맵·월드맵·날씨/시간·사진 모드 |
| 60–61 | social·audio | 소셜·오디오 | 채팅·이모지·체험객·절차적 사운드 |
| 62 | engagement | 참여 | 출석·오늘의 미션·알림함·수료증·랭킹·꾸미기 |
| 65 | companion | 동반자 | 마스코트 옹이(2D·3D)·도움말 |
| 66 | fx | 연출 | 파티클·레벨업·코인·도장·달리기 선·순간이동 문·구역 배너·퀘스트 빛기둥 |
| 70 | app | 앱 셸 | 부팅·로그인(PBKDF2)·타이틀·메뉴·설정·튜토리얼 |
| 80 | devcenter | 개발자 센터 | 점검·데이터 검증·자가 테스트·디버그·문서·인수인계 |
| `server/` | PHP API·admin.php·lib | 서버 | 인증·검증 저장·채팅·접속자·업로드·관리 |
| `tools/` `tests/` | build·smoke·package·server-e2e | 코어·서버 | 빌드·테스트·배포 |

- 파일별 담당·역할·줄 수·sha 는 개발자 센터 › 🗂️ 소스 구조 에서 실시간으로 볼 수 있어요(빌드 매니페스트 기반).
- 시스템끼리는 **이벤트 버스**로 소통합니다(`G.bus.emit('farm:harvested', …)` → 퀘스트·통계·연출이 구독). 이벤트 목록은 CONTRACT §4, 실제 발행 횟수·구독 모듈은 소스 구조 탭의 "이벤트 흐름 지도".

## 5. 개발자 점검·인수인계 센터 사용법

| 여는 법 | `?dev=1`(부팅 후 자동) · **F9** / **`** · **Ctrl+Shift+D** · Esc 메뉴 › 🛠️ 개발자·관리자 센터 · `G.sys.devcenter.open('tests')` |
|---|---|
| 권한 | 로컬 모드는 항상, 서버 모드는 **서버 관리자 계정** 또는 **서버 PC(localhost)의 `?dev=1`** 만. **쉬운 모드에서는 먼저 보호자 확인**(곱셈 문제)이 나와요 — 자동화는 `G.sys.devcenter.open(tab, {gate:false})` |

| 탭 | 확인할 것 |
|---|---|
| 📊 개요 | 건강 점수(감점 이유 표시), 모듈·오류·데이터·테스트·FPS·저장 카드, 빌드 버전·시각·three 리비전 |
| 🖥️ 시스템 점검 | 브라우저·GPU·WebGL 한계값·draw calls·CSP 정책/위반·저장 공간·오디오/음성/crypto 지원 · **🖥️ GPU 안전**(노멀·NaN·후처리 순서·NaN 주입 테스트, §14) |
| 👶 쉬운 모드 점검 | 지금 화면의 누르기 크기·글자 입력칸·오류 글자·나가기 버튼·이름/그림·긴 글자·HUD 겹침·대비·글자 크기·깜빡임·읽어주기, **🎬 주요 화면 차례로 점검**, 쉬운/보통 모드 전환, 보호자 확인 시험, 읽어준 말·보호자 확인 기록 (§12.3) |
| 🧩 모듈 상태 | 시스템 초기화 순서·실패·업데이트 중지·공개 API·마지막 오류·콘솔 오류·빌드 매니페스트 |
| 🔍 데이터 검증 | `G.data` 교차 참조 검사(퀘스트·도감·상점·작물↔아이템·레시피·대화 노드·배치·교육↔퀴즈·중복 ID·한국어 이름) |
| 💾 저장 데이터 | `G.state` 트리, 내보내기/가져오기/초기화, localStorage 키별 크기, 로컬 계정(해시 비공개) |
| 🌐 서버 점검 | ping·세션·저장·랭킹·채팅(읽기 전용) 응답 시간, `api/admin/health.php` 결과 |
| 🧪 자가 테스트 | 실제 저장을 건드리지 않는 70개+ 단위 테스트 (유틸·XSS·저장 체크섬·충돌·구역·농사/발효 계산·암호·**GPU 안전·쉬운 모드(G.easy)·개인정보 가림**) |
| 🛠️ 디버그 도구 | 코인·아이템·목표 완료·작물 성장·발효 완료·날씨/시간·순간이동·충돌체·FPS·품질·연출 미리보기 (모두 기록됨) |
| 📚 문서 · 🤝 인수인계 | 내장 문서 검색, 인수인계 체크리스트(브라우저에 저장) |

- 헤더의 **📥 진단 보고서** 는 Markdown·JSON 을 내려받습니다(자가 테스트 자동 실행 포함). 버그 제보·배포 기록에 첨부하세요.
  보고서에는 비밀번호 해시·CSRF 토큰·이메일·닉네임·저장 내용을 넣지 않습니다(최근 콘솔 기록은 들어가니 외부 공유 전 한 번 훑어보세요).

## 6. 콘텐츠 추가하기 (코드 수정 없이 데이터만)

추가한 뒤에는 **항상 개발자 센터 › 데이터 검증 › 다시 검사** 로 오류 0건을 확인하세요.

### 6.1 작물 추가 (`src/game/01-data.js`)
```js
// G.data.items 안에 — 씨앗과 수확물
ITEM_SEED_GARLIC: { name: '마늘 종구', type: 'seed', icon: '🧄', crop: 'CROP_GARLIC', price: 90, sell: 30, desc: '가을에 심는 마늘 종구입니다.' },
ITEM_GARLIC: { name: '마늘', type: 'crop', icon: '🧄', price: 0, sell: 55, desc: '양념의 기본 재료입니다.' },
// G.data.crops 안에 — growthTime = 물이 충분할 때 다 자라는 초
CROP_GARLIC: { name: '마늘', seedItem: 'ITEM_SEED_GARLIC', harvestItem: 'ITEM_GARLIC', harvestAmount: [2, 4],
  growthTime: 140, waterUse: 0.15, exp: 40, coin: 35, model: 'radish', color: '#6aa443', fruit: '#f3efe2', category: 'crop', desc: '…' },
// G.data.collection 안에 — 도감 등록 조건
COL_GARLIC: { category: 'crop', name: '마늘', icon: '🧄', location: '전통작물 구역', desc: '…', unlock: [{ on: 'harvest', crop: 'CROP_GARLIC' }] },
```
- `model` 은 `40-farming.js` 의 `MODELS` 에 있는 것(bean pepper cabbage perilla corn radish mint lavender rosemary lemonbalm)을 쓰거나, 그 파일에 새 모델 빌더를 추가합니다.
- 상점에서 팔려면 `G.data.shops.SHOP_GENERAL.sells` 에 씨앗 ID 추가. 처음부터 심어 두려면 `02-layout.js` 의 `farmPlots[].crop/prefill`.

### 6.2 퀘스트 추가 (`01-data.js` › `G.data.quests`)
```js
Q_GARLIC: { title: '마늘 농사', icon: '🧄', category: 'farm', giver: 'NPC002', requires: ['QUEST001'],
  desc: '마늘을 2번 수확해 보세요.',
  objectives: [{ type: 'harvest', crop: 'CROP_GARLIC', count: 2, text: '마늘 수확하기' }],
  reward: { coin: 1200, exp: 150, items: { ITEM_SEED_GARLIC: 2 } } },
```
- 목표 종류: `talk visit water plant harvest ferment_check ferment_start ferment_claim edu quiz journal photo emote gesture interact collect craft chat visit_all level` (CONTRACT §6.5).
- `giver` 가 있으면 NPC 머리 위에 `!` 가 뜹니다. 수락 대사는 `26-dialogues.js` 에서 `{ type: 'acceptQuest', quest: 'Q_GARLIC' }` 액션으로 연결합니다. `autoAccept: true` 면 조건이 되는 즉시 자동 수락.
- 서버 모드 보상 검증은 빌드가 만드는 `server/data/game-data.json` 을 따르므로 **서버에도 새 빌드를 배포**해야 합니다.

### 6.3 발효 레시피 추가 (`01-data.js` › `G.data.recipes` + items + collection)
```js
FER006: { name: '청국장 체험', resultItem: 'ITEM_CHEONGGUKJANG', resultQty: 1, ingredients: { ITEM_BEAN: 3 },
  baseDuration: 200, idealTemp: [35, 45], idealHumidity: [60, 80], baseQuality: 58, exp: 220, coin: 320,
  edu: 'EDU_BEAN', color: '#7a5a32', icon: '🫘', desc: '…' },
```
결과 아이템(`type: 'fermented'`)과 도감 항목(`unlock: [{ on: 'item', item: 'ITEM_CHEONGGUKJANG' }]`)을 함께 추가합니다.

### 6.4 NPC 대사 추가 (`src/game/26-dialogues.js`)
- `G.data.dialogues.npc_farmer.nodes` 에 노드를 추가하고, 기존 노드의 `choices` 에서 `{ text: '마늘 이야기', next: 'garlic' }` 로 연결합니다.
- 노드: `{ text, emote?, actions?, choices?: [{ text, next?, end?, if?, actions? }], next? }`. 조건(`if`)·액션 목록은 파일 머리 주석에 있습니다.
- 데이터 검증 탭이 없는 노드·퀘스트·아이템·교육 참조와 어디서도 연결되지 않는 노드를 알려 줍니다.

### 6.5 교육 콘텐츠·퀴즈 (`src/game/45-education-data.js`)
- `G.data.education.EDU_*`: `{ title, category, icon, summary, pages: [{ title, text, visual }], quiz, quizzes, source }`
- `G.data.quizzes.QZ_*`: `{ edu, question, choices: [4개], answer: 0~3, explain, reward }` — 사실은 짧고 널리 알려진 일반 상식으로.
- 새 교육 ID 는 `01-data.js` 의 `G.data.educationIds` 와 도감(`unlock: [{ on: 'edu', edu }]`)에도 추가합니다.

### 6.6 배치(위치) 바꾸기 (`src/game/02-layout.js`)
좌표는 미터, 북쪽 = −Z, 동쪽 = +X, 플레이 영역 ±135. `rot` 0 이면 정면이 +Z(남쪽). 개발자 센터 › 디버그 도구 › **충돌체 보기**(빨강=충돌, 파랑=발판)로 확인하세요.

## 7. 저장 데이터 형식과 마이그레이션

- `G.state` 구조는 `03-state.js` 의 `createDefaultState()` 가 기준입니다(CONTRACT §5: 각 영역을 누가 쓰는지 표기).
- **로컬**: `localStorage['tfm.v1.save.<프로필ID>']` = `{version, savedAt, checksum, data}` (data 는 JSON 문자열, checksum = cyrb53).
  저장할 때마다 직전 값을 `.bak` 으로 보관 → 손상 시 백업으로 자동 복구. 1.5초 디바운스 저장 + 30초 자동 저장 + 탭 닫힘 시 저장.
- **서버**: `api/player/save.php` 가 직전 저장본과 비교해 보상표·시간을 넘는 증가를 거부(HTTP 409 `VALIDATION_FAILED`) → 클라이언트가 서버 저장본으로 되돌림.
- 시간 기반 진행(작물·발효)은 `G.time.now()` 타임스탬프로 계산 → 접속하지 않은 시간도 반영(밭은 최대 `farming.offlineCatchUpMax` = 30분).
- **구조를 바꿀 때**: `STATE_VERSION` 을 올리고 `MIGRATIONS[이전버전] = (s) => { …; s.version = 새버전; return s; }` 를 추가하세요.
  `normalize()` 가 빠진 키를 기본값으로 채우므로 **필드 추가만** 할 때는 마이그레이션이 필요 없습니다. 모든 모듈은 `onStateLoaded` 에서 이상한 값을 견뎌야 합니다.
- 기타 키: `tfm.v1.settings`(기기 설정) · `tfm.v1.accounts`(로컬 계정, PBKDF2 해시) · `tfm.v1.profiles`(최근 플레이, 이메일 없음) · `tfm.v1.dev.*`(개발자 센터).

## 8. 보안 설계

| 영역 | 방법 |
|---|---|
| CSP | `tools/build.mjs` 가 인라인 `<script>` 의 **SHA-256 해시**만 허용하는 정책을 HTML 에 넣음: `default-src 'none'`, eval 금지, 외부 연결·플러그인·base 태그 금지 |
| 코드 규칙 | `eval`·`new Function`·문자열 `setTimeout`·인라인 `onclick=`·`javascript:` URL·외부 URL 금지 → `addEventListener` 사용 |
| XSS | 사용자·서버·가져온 문자열은 `textContent` / `G.ui.h()` / `G.ui.esc()` 로만 출력. 이미지는 `data:image/(png|jpeg|webp)` 또는 같은 출처만 |
| 로컬 계정 | PBKDF2-HMAC-SHA256 60만 회 + 계정별 16바이트 솔트(WebCrypto, 없으면 같은 알고리즘의 JS 구현), 상수 시간 비교, 5회 실패 시 잠금 |
| 서버 | PDO prepared statement, `password_hash`(Argon2id 지원 시), 세션 쿠키 HttpOnly·SameSite=Lax·(HTTPS 시) Secure, CSRF(`X-CSRF-Token`), 빈도 제한, 업로드 MIME·크기 검사·재인코딩, 저장 검증 |
| 개발자 센터 | 서버 모드에서는 관리자/서버 PC 만, 쉬운 모드에서는 보호자 확인 먼저, 치트는 모두 기록, 보고서·화면에 해시·토큰·전체 이메일·화면 글자(닉네임) 미표시 |
| 어린이 안전 | 쉬운 모드 글자 입력 0개(kidChat·nameIdeas), 보호자 확인, 채팅 개인정보 🔒 가림(클라이언트 + 서버 저장 전), 개인정보 닉네임 거부, 랭킹 칭호 화이트리스트, 놀이 시간 알림, 3 Hz 이하 깜빡임 (§13) |

- 비밀번호·비밀값은 `G.state`·로그에 절대 넣지 않습니다. 운영은 반드시 **HTTPS**.
- 새 코드를 넣은 뒤 개발자 센터 › 시스템 점검 › 보안 에서 **CSP 위반 0건**을 확인하세요(위반은 `securitypolicyviolation` 으로 수집).

## 9. 성능 메모

- 목표: 보통 노트북 30 FPS 이상, 고품질 draw calls ~400 미만. 나무·풀·장독·작물은 `InstancedMesh`, 정적 지오메트리는 재질별로 병합, 재질은 `G.gfx.material()` 로 공유.
- 품질 프리셋(낮음/중간/높음)이 그림자·블룸·나무/풀 밀도·시야를 조절하고, `auto` 일 때 FPS 가 낮으면 자동으로 한 단계 낮춥니다.
- **거리 컷(4단계)**: 작은 소품·장식·장독 묶음은 카메라에서 낮음 72 m · 중간 125 m · 높음 210 m 보다 멀면 그리지 않아요(`10-engine` `CULL_DIST`, 0.25초마다, `G.sys.engine.cullStats`). 만장대 전망대처럼 골짜기 전체가 보이는 곳에서 draw call 이 크게 줄어요. 낮음 프리셋은 60만 화소가 넘는 캔버스 텍스처를 절반 크기로 만들고 비등방 필터를 꺼요.
- FPS 는 실제 시간(벽시계)으로 재고, 자동 품질은 3초 이하 구간만 판단해요(느린 기기에서 한 프레임이 길어도 잘못 내리지 않게).
- 큰 모달이 열리면 3D 렌더를 1/3 로 줄입니다. 매 프레임 메모리 할당·DOM 갱신을 피하고(라벨 거리 컷, 0.25~0.5초 간격 갱신), 체험객 NPC 는 멀면 업데이트 간격을 늘립니다.
- 측정: 개발자 센터 › 시스템 점검(실시간 draw calls·삼각형·텍스처·셰이더 수), 개요의 FPS 기록 그래프, 디버그 도구 › FPS 표시.

## 10. 알려진 이슈와 로드맵

**알려진 이슈**
- 헤드리스 브라우저·저사양 GPU(소프트웨어 WebGL)에서는 FPS 가 매우 낮습니다 — 테스트는 `quality=low` 로, 화면 판단은 스크린샷으로.
- 소프트웨어 WebGL(SwiftShader)에서는 4단계 이후 첫 화면까지 걸리는 시간이 예전보다 깁니다. `engine.postInit` 이 로딩 화면 뒤에서 장면의 모든 재질을 미리 컴파일해요(`KHR_parallel_shader_compile` 이 있으면 `compileAsync`, 없으면 `compile`) — 숨어 있는 비·눈·물웅덩이·밤 불빛, 테두리 빛(hover), 66-fx 의 순간이동 문·구역 현판·레벨업 빛기둥도 포함이라 처음 쓸 때 프레임이 멈추지 않아요(옹이 잔상만 플레이어 모델이 필요해서 처음 달릴 때 만들어요).
- 로컬 모드 저장은 브라우저마다 따로이고 사이트 데이터 삭제 시 사라집니다 → 설정/개발자 센터에서 **내보내기** 권장.
- 음성 입력(채팅)은 HTTPS(또는 localhost)와 Web Speech 지원 브라우저에서만 동작합니다.
- 실시간 채팅·접속자는 폴링(1~2초) 방식입니다. 3D 모델은 절차적 블록아웃(고품질 GLB 교체 훅 있음).

**로드맵**
1. GLB 고품질 모델 교체 — `G.data.modelOverrides = { B_HALL: 'assets/models/hall.glb' }` (웹 서버 실행 시)
2. WebSocket 실시간 동기화, WebRTC 음성 대화
3. 다국어(영어)와 교사용 학급 대시보드(서버 `admin/stats.php` 확장)
4. 자동 테스트(build --strict · smoke · server-e2e · 자가 테스트)를 CI 에서 매 커밋 실행

## 11. 문제 해결

| 증상 | 확인·해결 |
|---|---|
| "게임을 시작하지 못했습니다" | WebGL 미지원/차단 → 브라우저 하드웨어 가속 켜기, 최신 Chrome/Edge 사용 |
| 화면이 검거나 매우 느림 | 설정 › 그래픽 품질 '낮음', 개발자 센터 › 시스템 점검의 GPU 이름 확인(소프트웨어 렌더러인지) |
| 화면에 검은 사각형이 번쩍임 | §14 — 시스템 점검 › GPU 안전의 노멀·납작한 메시·후처리 순서와 NaN 주입 테스트 |
| 아이가 어른 화면(설정 등)에 들어감 | 👶 쉬운 모드 점검 › 🎬 화면 차례로 의 🔒 보호자 확인 항목, `parentGate` 설정 |
| 채팅에 전화번호가 보임 | 자가 테스트 › 🔒 개인정보 가림, 서버는 admin.php 시스템 점검 "어린이 개인정보 가림" |
| 특정 기능만 안 됨 | 개발자 센터 › 모듈 상태 — ⛔ 초기화 실패/⚠️ 업데이트 중지 시스템과 마지막 오류 메시지 |
| 빌드 경고 "skipping NN (syntax error)" | 해당 조각 문법 오류 — 메시지의 줄 번호 확인, `--strict` 로 배포 차단 |
| 퀘스트·도감이 진행 안 됨 | 데이터 검증 탭에서 잘못된 ID 참조 확인, 이벤트 흐름 지도에서 이벤트 발행 횟수 확인 |
| 저장이 사라짐 | 다른 브라우저/시크릿 창인지 확인, `.bak` 백업 자동 복구 여부(토스트), 서버 모드면 서버 점검 › 내 저장 읽기 |
| 서버 모드로 안 바뀜 | `api/ping.php` 직접 열어 JSON 확인, PHP 확장(pdo_sqlite) 설치, `data/` 쓰기 권한 |
| 저장이 409 로 거부됨 | 서버가 비정상 증가를 감지 — 정상 플레이인데 거부되면 `serverLimits`·보상표와 `game-data.json` 버전 일치 확인 |
| CSP 위반 기록 발생 | 새 코드의 인라인 핸들러/외부 URL/eval 사용 여부 확인 (시스템 점검 › 보안) |

## 12. 쉬운 모드(어린이) 설계

> 목표: **글을 거의 못 읽는 5살 아이도 모든 화면을 혼자 쓸 수 있게.** 쉬운 모드가 **기본값**이고, 어른은 보통 모드(같은 기능, 더 촘촘한 화면)로 바꿀 수 있어요. 기준 문서는 `docs/CONTRACT.md` §12 입니다.

### 12.1 원칙 (모든 화면에 적용)

| 원칙 | 구체적인 기준 |
|---|---|
| 그림 먼저 | 버튼 = 큰 이모지 + 2단어 이하(가능하면 6글자 이하) |
| 손가락 크기 | 누르는 곳은 **56 px 이상**(쉬운) / 40 px(보통) — CSS 변수 `var(--tap)` |
| 글자 | 16 px 이상, 해요체, 한 문장 12단어 이하, 한자·전문용어 없음, 숫자는 그림으로(💧💧💧) |
| 소리 | 안내 문장은 모두 읽어 줄 수 있어야 해요(🔊 / 길게 누르기) — `G.easy.say`, `G.easy.speakable` |
| 한 가지 행동 | 한 화면에 분명한 다음 행동 하나, 큰 버튼은 3개 이하 |
| 막다른 길 금지 | 모든 창에 큰 ⬅️ / ✖. 지우기 같은 위험한 일은 그림으로 한 번 더 묻기(`G.easy.confirm`) |
| 타자 없음 | 쉬운 모드에는 **글자 입력칸이 0개** — 닉네임은 `G.easy.nameIdeas`, 채팅은 문장·이모지 고르기, 일기는 스티커·기분 |
| 친절한 오류 | 오류는 옹이 + 다정한 한 문장 + 다시 해 보기 버튼 (코드·스택 금지) |

### 12.2 구조

- `src/game/08-easy.js` (코어, 3D 없이 먼저 로드) 가 `G.easy` 를 제공합니다: `on / set / say / stop / speakable / gate / gateStatus / pick / confirm / alert / celebrate / point / nextStep / goTo / travelMenu / t / nameIdeas / rest / remind`.
- `body.easy` / `body.easy-off` 클래스와 `--tap`(56/40 px)으로 CSS 가 바뀌고, 각 모듈은 `G.easy?.on` 으로 화면을 나눠 그립니다. 쉬운↔보통 전환은 실행 중에도 되고 `easy:changed {on}` 이벤트가 나와요.
- HUD(쉬운 모드): 위 "다음 할 일" 카드(👉 같이 가기·🔊), 왼쪽 큰 타일 🎒 가방 · 📖 스티커북 · 🔔 오늘 · ☰ 메뉴, 아래 😊 표현하기 · 📸 사진 · 📝 일기 · 🔊 소리, 💬 말하기, 🗺️ 어디 갈까.
- 설정 키(`03-state.js`): `easyMode`(기본 켜짐) · `voiceGuide` · `voiceRate` · `playReminderMin`(30분, 0=끔) · `kidChat` · `parentGate`. `easyMode/kidChat/parentGate` 는 **프로필(저장) 설정**이라 같은 기기의 어른 프로필이 아이 프로필에 새지 않아요.
- 새 화면을 만들 때: 쉬운 모드 분기 → `G.easy.pick/confirm` 재사용 → 텍스트는 `G.easy.t('보통 문장', '쉬운 문장')` → 버튼마다 이모지 + `aria-label` → 👶 탭 / `kid-audit` 로 확인.

### 12.3 점검 도구

- 개발자 센터 › **👶 쉬운 모드 점검**: "🔍 지금 화면 점검"은 센터 뒤의 실제 게임 화면을, "🎬 주요 화면 차례로"는 공개 API 로 가방·가게·스티커북·오늘·할 일·일기·배움터·배움 이야기·퀴즈·지도·표현하기·말하기·꾸미기·메뉴·**아이 설정**(소리·음악·읽어주기·쉬운 모드 — 일부러 확인 없음)·**어른 설정**(`G.app.openAdultSettings`, 보호자 확인 문제가 먼저 나와야 ✅)·도움말·사진을 하나씩 열어 점검해요(API 가 없는 화면은 ⏭️ 건너뜀). 누르기 크기는 0.5 px 까지 봐줘요(55.99 px 같은 소수점 배치). 항목마다 **👀 보기** 를 누르면 센터가 잠깐 숨고 그 요소에 금빛 테두리가 생겨요(Esc / ⬅️ 로 돌아오기).
- 점검 항목과 심각도:

| 종류 | ⛔ 치명 | ⚠️ 경고 | 💡 참고 |
|---|---|---|---|
| ⌨️ 글자 입력칸 | 쉬운 모드에서 보이는 입력칸 | — | — |
| 👆 누르기 크기 | 44 px 미만(쉬운) / 24 px 미만(보통) | `--tap` 미만 | 꺼진 버튼·글 속 링크 |
| 🐞 오류 글자 | 화면의 NaN · undefined · [object …] · null | — | — |
| 🚪 나가기 | 버튼이 하나도 없는 창 | ✖/⬅️ 없음 | — |
| 🔒 보호자 확인 | 쉬운 모드에서 설정이 확인 없이 열림 | — | — |
| 🏷️ 이름·그림 / 🔤 긴 글자 | — | 이름(aria-label) 없음, 그림 없이 6글자 초과 | 그림 없음, 12글자 초과 |
| 🧱 겹침 · 🌗 대비 · 🔠 글자 · ⚡ 깜빡임 | — | HUD 30% 이상 겹침, WCAG AA 미달(3D 배경은 추정), 13.5 px 미만, 3 Hz 초과 반복 | 작은 겹침, 16 px 미만 |
| 🔊 읽어주기 · 🎯 · 🈶 | — | — | 🔊 없는 안내, 큰 버튼 4개 이상, 한자 |

- 같은 규칙을 코드에서: `G.sys.devcenter.kidAudit({scope})`, `kidTour()`, `kidScreens()`, `easyStatus()`. 예외가 꼭 필요한 요소에는 `data-kid-exempt` 속성을 달고 이유를 주석으로 남겨 주세요.

### 12.4 kid-audit 실행 (QA)

```bash
node tools/build.mjs                                   # dist/metaverse/index.html
node tools/kid-audit.mjs                               # 데스크톱 1366×768, 쉬운 모드
node tools/kid-audit.mjs --mobile                      # 휴대폰 390×844 (터치)
node tools/kid-audit.mjs --both --out test-output/kid  # 둘 다 + test-output/kid.json · kid.md
node tools/kid-audit.mjs --screens bag,shop,journal    # 일부 화면만
node tools/kid-audit.mjs --normal                      # 보통 모드 점검 (치명 기준이 24 px 로 낮아짐)
```
- 출력: 화면별 표(상태 · ⛔ · ⚠️ · 💡 · 점수 · 먼저 볼 문제) + 치명 목록(선택자 포함) + JSON. **⛔ 치명이 1개라도 있으면 exit 1**, `--strict` 면 경고도 실패, 실행 불가(빌드 없음·G.ready 시간 초과·개발자 센터 없음)는 exit 2.
- 헤드리스 WebGL 은 소프트웨어라 한 번에 1~2분 걸려요(`quality=low` 로 자동 실행).

## 13. 어린이 안전 (보호자 확인 · 개인정보 가림 · 건강한 놀이)

### 13.1 보호자 확인 (`G.easy.gate`)
- 두 자리 × 한 자리 곱셈, 큰 보기 **6개**(정답 자리는 고르게 섞여요). **두 문제를 연달아** 맞혀야 통과해요(화면의 `●○ 1/2번째 문제`). 틀리면 처음부터, 3번 틀리면 30초(반복 시 2배, 최대 5분) 쉬기 — 새로고침해도 유지(`localStorage['tfm.v1.gate']`, 틀린 횟수는 10분 뒤 사라짐). 쉬운 모드가 꺼져 있거나 `parentGate:false` 면 바로 통과.
- **마구 누르기 방지**: 한 번 누르면 보기가 바로 잠기고(`.is-locked`), 새 문제는 잠깐 뒤에 눌러져요 → 문제 하나에 답 하나. 보지 않고 마구 누르면 한 판에 약 8% 만 통과(`G.easy._gateSim`) — 쉬는 시간이 2배씩 늘어서 뚫으려면 약 45분이 걸려요.
- **통과는 그 어른 화면에만**: 통과하면 방금 연 어른 화면(어른 메뉴·어른 설정·계정 삭제·관리자, 처음 화면의 어른 메뉴)에만 짧은 "어른 시간"이 생겨요. 그 화면을 닫으면(두 어른 화면 사이를 옮겨 갈 때만 0.65초 여유) 바로 다시 잠겨요. 아이가 혼자 여는 화면(가방·도움말·스티커북·아이 메뉴)은 절대 이어받지 않아요. 로그아웃·로그인·프로필 불러오기·쉬운 모드 전환·탭 숨김·3분 동안 아무것도 안 할 때도 잠겨요. 화면을 열지 않는 확인(내보내기 등)은 그 한 번만 써요.
- **언제나 다시 묻는 것**: 로그아웃 · 개발자 센터 · 관리자 · 계정 삭제. **90초 안에 푼 경우만 되는 것**: 아이 채팅 끄기 · 보호자 확인 끄기 · 쉬운 모드 끄기 · 초기화 · 가져오기 · 기억한 계정 지우기. 설정의 "🔐 보호자 확인 잠그기" 로 바로 잠글 수도 있어요.
- 자동화 스크립트는 문제마다 `.easy-gate-modal:not(.modal-closing) .easy-gate-choices:not(.is-locked)` 를 기다렸다가 답을 하나씩, 창이 닫힐 때까지 눌러요(2문제).
- 확인이 필요한 곳: 설정(소리·쉬운 모드 빠른 전환 제외), **쉬운 모드 끄기**, 로그아웃, 로그인/회원가입 화면, 진행 초기화, 내보내기/가져오기, **개발자 센터**, 관리자 화면.
- ⚠️ 이것은 어린아이를 위한 **사용 편의 장벽**이지 보안 경계가 아니에요. 진짜 권한은 서버(관리자 역할·세션)가 지킵니다.

### 13.2 개인정보 가림 (🔒)
- 채팅에서 전화번호(010-1234-5678 · 01012345678 · +82 10 1234 5678 · 지역번호 · 9자리 이상 숫자 · "공일공"), 이메일("골뱅이"·"닷" 포함), 링크·도메인, 메신저 아이디(카톡·인스타·디코…), 도로명·지번·아파트 동/호수, 학교·유치원·학년 반을 **🔒** 로 바꿔요. 보낸 아이에게는 옹이가 "이름·전화번호·주소는 비밀이에요! 🤫" 라고 알려 줘요.
- **클라이언트**: `G.sys.social.maskPII(text)` (60-social.js) — 로컬 모드·말풍선·체험객 대사에도 적용.
- **서버**: `server/lib/ChatFilter.php` 의 `maskPII()` 가 **DB 에 저장하기 전에** 가리고(응답 `piiMasked:true`), 목록을 내보낼 때 한 번 더 가리고(예전 메시지), 신고 메모도 가려요. 닉네임이 개인정보처럼 보이면 가입 거부(`NICKNAME_INVALID`). 랭킹 칭호는 `game-data.json` 의 `titles` 에 있는 것만 보여요(저장 파일의 자유 문장 차단).
- **숨긴 형태도 가려요**: 먼저 쓴 그대로 가리고, 한 번 더 "펼친" 글자(NFKC: 전각 `０１０`·`＠`·`．`, 수학 글꼴 `𝟎𝟏𝟎`, 키캡 `0️⃣`, 아랍·인도 숫자 `٠١٠` → `010`)로 검사해요. 숫자 사이 구분자 `/ _ ~ * · – — ㅡ ( ) [ ]`, 한글 숫자와 아라비아 숫자 섞기("010 일이삼사 5678", "공1공…"), "공일공-일이삼사-오육칠팔", 국번 없는 "1234-5678", 영어로 쓴 "abc at gmail dot com", "지메일 닷컴", "bad[.]com · bad(.)com · bad . com", 주소 뒤 번지("역삼동 123-4"), 띄어 쓴 "해바라기 초등학교" 까지 🔒.
- 두 구현은 **규칙 목록이 하나**예요(4단계). 규칙은 `60-social.js` 의 `// >>> PII ENGINE` 블록에만 쓰고, `node tests/pii-sync.mjs` 가 그것을 **`server/lib/pii-rules.json`** 으로 내보내요(배포 때 `ChatFilter.php` 옆에 같이 올라가요; 접기·숫자 단위·닉네임 판단은 `ChatFilter.php` 가 같은 방식으로 따라 해요). `--strict` 빌드는 `pii-sync --check` 로 둘이 다르면 실패해요. 공통 테스트 벡터는 **`tests/pii-vectors.json`**(전체 🔒 · 일부 🔒 · 그대로 · 새면 안 되는 것 · 닉네임 거부/허용, 지금 587문장 + 닉네임 40개) — `node tests/pii-client.mjs` 가 빌드된 게임과 PHP(intl 있음·없음) 결과가 **글자 하나까지 같은지** 보고, 서버 E2E 와 자가 테스트(`window.__BUILD__.piiVectors`)도 같은 벡터를 돌려요. 규칙을 바꾸면: PII ENGINE 블록 수정 → 벡터 추가 → `node tests/pii-sync.mjs` → `node tests/pii-client.mjs --file …` + `node tests/server-e2e.mjs` + admin.php 시스템 점검의 "어린이 개인정보 가림" 을 확인하세요. "새로 30개", "2층으로 3번", "서울 친구", "유치원 가기 싫어", "@닉네임", "1000 2000 코인", "I am at home. so tired" 같은 보통 문장은 그대로여야 해요.
- 서버 DB 의 반복 스팸 키(`chat_messages.text_key`)는 **가린 글**에서 만들어요(예전에는 원문 → 전화번호가 30일 동안 남았음). 스키마 v2 가 예전 키를 비웁니다(`Db::SCHEMA_VERSION = 2`, 자동 마이그레이션).
- 쉬운 모드 채팅(`kidChat`)은 글자 입력 없이 문장·이모지만 골라요 — 가림 이전에 애초에 쓸 수 없게.

### 13.4 기기 설정 vs 프로필 설정 (새지 않게)
- `easyMode · kidChat · parentGate` 는 **프로필 저장**에만 들어가요. 프로필이 열려 있는 동안 `G.setSetting` 은 이 세 키를 기기(`localStorage['tfm.v1.settings']`)에 **쓰지 않고**, 다른 키도 **바뀐 키 하나만** 기기에 써요(예전에는 G.settings 전체를 써서 어른 프로필의 "쉬운 모드 끔 / 보호자 확인 끔"이 로그아웃 뒤 다음 아이에게 새었어요).
- 처음 화면(프로필 없음)에서 바꾼 값만 기기 값이 돼요(예: 🧑 일반 모드 칩 → 보호자 확인 통과 후). 기기 저장소에는 형식 표시 `_v: 2` 가 붙고, 표시가 없는 예전 저장소는 한 번 세 키를 지워 **안전한 기본값(쉬운 모드·보호자 확인 켜짐)** 으로 돌아가요. 현재 기기 값: `G.deviceSetting(key)`.
- 회귀 테스트(QA `steps-leak.mjs`): 프로필에서 보호자 확인 끄기 → 로그아웃 → 어른 메뉴가 여전히 문제를 내는지, 보통 모드 프로필에서 음량을 바꾼 뒤 로그아웃 → 처음 화면이 쉬운 모드인지.

### 13.3 건강한 놀이 · 광과민
- `playReminderMin`(기본 30분)마다 옹이가 부드럽게 "조금 쉬어 갈까요?" (쉬기 / 계속) — 막지 않아요.
- 유료 아이템·남은 시간 압박·다크 패턴 없음. 깜빡임은 **초당 3번 이하**, 넓은 밝기 변화는 부드럽게, `reduceMotion` 존중(👶 탭의 ⚡ 깜빡임 점검).

### 13.5 처음 안내(온보딩)와 "다음 할 일" 이 아이를 막지 않게 (QA)
- 쉬운 모드 안내 카드(👉 같이 가기를 눌러요!)는 **손가락이 닿지 않는 그림**이에요(🔊·⏭️ 만 버튼). 다른 금빛 버튼(물 주기·장독·안내판…)이 보이면 카드와 손가락이 잠깐 비켜 서고, 그 버튼을 누르면 "준비 끝!" 축하로 안내가 끝나요. 아래에 붙일 때는 금빛 버튼·조이스틱·아래 막대 위로 올라가요.
- 👉 같이 가기를 누르면 카드가 "같이 가고 있어요!" 로 바뀌고, 걷기가 3초 넘게 멈추면 다시 안내해요.
- "다음 할 일" 과 금빛 버튼이 같은 말을 해요: 💧 물 주기 차례에는 다 자란 밭도 **한 번 누르면 먼저 물**을 줘요(거두기는 다음 차례), 목표 밭이 없으면 물을 더 받을 수 있는 밭 → 빈 밭(먼저 심기) 순서로 데려가요. 가까이에 여러 물건이 있으면 "다음 할 일" 의 대상(밭·장독·사람)을 금빛 버튼으로 먼저 골라요(`23-interaction` 의 goal 우선).
- 내 장독을 한 번 눌러 꺼내기/담그기를 해도 "내 장독을 살펴봐요" 가 끝나요(`ferment:checked`).
- 쉬운 모드 이벤트: `easy:celebrate {text, emoji, reduced}` (66-fx 축하 비), `easy:remind {open}` · `easy:rest {open}` (65-companion 옹이 졸기·낮잠·깨기) — 예전의 DOM 감시/1초 확인을 대신해요.
- 대화 조건 `easy: true|false` (25-npc `check`) — 쉬운 모드에서는 퀘스트를 주는 NPC(전통사랑·장독지기)가 받을 수 있는 퀘스트의 **제안 대사로 바로** 시작해요(`26-dialogues.js` 의 `KID(...)` · `CULTURE_KID_OFFER` · `KEEPER_KID_OFFER`). 산골농부는 원래 두 모드 모두 그렇게 해요. 새 NPC 퀘스트를 만들면 같은 줄을 `entries` 와 첫 만남 `first2.next` 에 넣어 주세요 — 안 그러면 아이가 "OO에게 가요" 다음에 메뉴를 헤매요.
- 만들기(craft) 목표에서 재료가 모자라면(예: 메주 = 콩 3개) 쉬운 모드 "다음 할 일"은 **"🫘 콩을 모아요 1/3"** 이 되고 금빛 표시도 작업대 대신 콩밭(익은 밭 → 자라는 밭 → 씨앗이 있으면 빈 밭) 또는 매점을 가리켜요. 다 모이면 "작업대에서 만들어요"로 바뀌어요 — `G.sys.quest.craftNeed(craftId)` · 31-quest `_ingredientTarget` · 08-easy `objectiveStep('craft')`. 보통 모드 표시는 그대로 작업대예요.

## 14. GPU NaN 방지 (검은 사각형 버그의 원인과 해결)

**증상**: 실제 Windows PC(Direct3D/ANGLE)에서 화면 곳곳에 **커다란 검은 사각형**이 번쩍임 (헤드리스·Mac 에서는 잘 안 보임).

**원인**
1. 길이가 0 인 정점 노멀(겹친 삼각형, 원뿔 꼭짓점, 0 으로 줄인 부품) → 셰이더의 `normalize(vec3(0))` = **NaN** (D3D 는 NaN, 다른 GPU 는 0 이라 안 보였음).
2. 블룸(UnrealBloomPass)은 화면을 여러 단계로 흐리게 섞는데, NaN 한 점이 섞이면 주변 전체가 NaN → 출력에서 **검은 사각형**.
3. 같은 원리의 다른 원인: 한 축만 0 으로 납작하게 만든 메시(노멀 행렬 역행렬이 0 → NaN), 인스턴스 행렬의 한 축이 0(셰이더가 0 으로 나눔), 셰이더의 0 나누기·`pow(음수)`·`sqrt(음수)`·`log(0)`.

**해결 (커밋 a954f38, `10-engine.js`)**
- `G.gfx.fixNormals(geo)` 가 길이 0/NaN 노멀을 (0,1,0) 으로 고치고, `computeVertexNormals` · `applyMatrix4` · `mergeGeometries` 를 감싸 자동 적용 + 장면에 새로 들어온 지오메트리를 한 번씩 검사. 고친 개수는 `G.gfx.normalsRepaired`.
- 블룸 **바로 앞**에 `NaNScrubShader` 패스: NaN/Inf 화소를 지우고 HDR 값을 48 로 제한 → 한 점이 번지지 않아요.

**확인하는 법** — 개발자 센터 › 🖥️ 시스템 점검 › **GPU 안전**:
- 길이 0·NaN 노멀 **0개**, NaN 정점 위치 0개, 납작한 조명 메시/인스턴스 0개, 후처리 순서 `RenderPass → NaNScrubShader → UnrealBloomPass → OutputPass` ✅.
- **🧪 NaN 주입 테스트**: 임시 `ShaderMaterial` 이 `z/z`(z=0)로 NaN 을 만드는 작은 사각형을 그리고, 엔진과 같은 체인(HalfFloat → [청소] → 블룸)을 64×64 로 돌려 비교해요. 청소 없이 → 100% 검정(버그 재현), 청소 후 → **1% 이하**여야 통과. 두 장면을 그림으로 보여 주고, 끝나면 모든 자원을 정리해요(게임 화면은 안 바뀜). 자가 테스트에도 같은 항목이 있어요.

**새 코드 규칙**
- 지오메트리를 직접 만들면 노멀 길이가 0 이 안 되게(또는 `G.gfx.fixNormals(geo)`), 숨길 때는 `visible = false` 나 세 축 모두 0 으로(한 축만 0 금지).
- 셰이더: 나누기·`normalize`·`pow`·`sqrt`·`log`·`inversesqrt` 는 입력을 `max(x, 1e-5)` 등으로 막기.
- 동기 `readRenderTargetPixels` 를 쓸 때 주의: three 의 `readRenderTargetPixelsAsync`(NPC·아바타 초상화)가 기다리는 동안 `PIXEL_PACK_BUFFER` 가 묶여 있어 동기 읽기가 0 만 돌려줘요 → 읽기 전에 `gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null)`, 읽은 뒤 원래대로(개발자 센터의 NaN 테스트가 이렇게 해요).

## 15. 인수인계 체크리스트

개발자 센터 › 🤝 인수인계 탭에서 체크하면 진행률이 저장됩니다. 최소 항목:

- [ ] `npm install` → `node tools/build.mjs --strict` 성공
- [ ] smoke 테스트 ✔ SMOKE OK, 자가 테스트 전부 통과, 데이터 검증 오류 0건
- [ ] (서버) XAMPP 설치·첫 관리자 지정·`config.local.php`·HTTPS·백업 일정
- [ ] 보안 점검: CSP 위반 0건, 관리자 비밀번호 교체
- [ ] 👶 `node tools/kid-audit.mjs --both` ⛔ 치명 0건 · 🖥️ GPU 안전 ✅ · 🔒 개인정보 가림 자가 테스트·서버 E2E 통과
- [ ] 🔒 프로필 설정이 기기에 새지 않는지(§13.4) · 보호자 확인 마구 누르기(§13.1) · 온보딩 카드가 금빛 버튼을 가리지 않는지(§13.5)
- [ ] 🔒 `node tests/pii-sync.mjs --check` · `node tests/pii-client.mjs --file dist/metaverse/index.html` 통과
- [ ] 🏔️ 새 게스트가 만장대 전망대에서 시작하고 인트로를 건너뛸 수 있는지, 다시 들어온 플레이어는 마지막 자리에서 시작하는지(§16)
- [ ] 콘텐츠 추가 절차(§6) 한 번 따라 해 보기 → 데이터 검증으로 확인
- [ ] 진단 보고서(.md) 를 받아 버전·빌드 시각·건강 점수 기록

**연락·기록 칸** (인수인계 때 채워 주세요)

| 항목 | 내용 |
|---|---|
| 이전 담당자 / 연락처 | |
| 새 담당자 / 연락처 | |
| 서버 주소 · 관리자 계정 보관 위치 | (비밀번호는 문서에 적지 말 것) |
| 마지막 배포 버전 · 날짜 | |
| 백업 위치 · 주기 | |

## 16. 4단계: 3배 빠른 이동 · 정선 만장대 시작 · 새 3D·모션 (기준: CONTRACT §13, 최종 동작은 §13.8)

### 16.1 이동 ×3
- `21-player.js` 의 `WALK = 9.6`, `RUN = 18` m/s(예전의 3배, `speedScale = 3`). 다른 숫자(가속·코너 속도·발소리 박자·카메라 앞보기)는 모두 이 두 값에서 계산해요 — 속도를 바꾸려면 이 두 상수만 고치세요.
- 빠르게 움직여도 울타리를 뚫지 않도록 한 번에 0.25 m 씩 나눠서 움직이고 충돌을 검사해요(`walkTo`·구조 이동도 같음).
- 옹이·체험객·다른 접속자도 `speedScale` 을 읽어 따라와요(접속자는 1.2초까지 예측 이동, 20 m 넘게 벌어지면 순간 맞춤).
- 서버 `SaveValidator`: 저장 사이 이동 거리 ≤ `move_max_speed`(기본 27 m/s) × 시간 + 여유. 초기화 저장도 같은 한도, `stats` 는 200개·숫자만.

### 16.2 정선 만장대에서 시작
- 새 플레이어는 `G.data.layout.spawn`(만장대 전망대)에서 골짜기를 보며 시작하고, 다시 들어온 플레이어는 **마지막 자리**에서 시작해요(인트로 없음).
- 첫 입장 인트로(`17-manjangdae.js` `intro()`): 골짜기 위를 날아 전망대로 내려오는 8.3초 영상 + 위아래 검은 띠 + "정선 만장대" 3D 제목. **아무 키나 화면을 누르면 건너뛰어요**(0.45초 뒤부터). 느린 기기에서도 실제 시간 8.3초 안에 끝나요. 움직임 줄이기를 켜면 짧은 페이드 + 2D 제목. 인트로 동안 HUD·안내 카드·이름표·토스트·읽어주기는 기다렸다가 끝나면 나와요.
- 망원경(`tour()`): 체험관 입구부터 구역마다 가장 큰 건물을 비추고 이름과 설명을 보여 줘요. 안내판·표지석은 "만장대 안내"(`openGuide()`) 를 열어요. 이 장소 이름은 **게임 속 연출**이고 실제 지리와 달라요(안내에 쓰여 있어요).
- 쉬운 모드 첫 안내의 "손가락이 가리키는 땅" 은 `walkSpot()` 이 고른 전망대 위 2~3 m 자리예요(화면 안, 막힘 없음, 망원경·안내판 버튼이 안 뜨는 곳). 👉 같이 가기를 누르면 굽은 산길을 **직접 걸어서** 발효마스터에게 가요(산에서 170 m 넘게 떨어진 곳만 빠른 이동).
- 팔각정 지붕에는 보이지 않는 카메라 막이(lathe hull)가 있어서 카메라가 지붕 모서리를 뚫지 않아요.

### 16.3 새 3D·모션 효과와 설정
- 3D(`10-engine`·`12-nature`·`13-water`·`15/16`·`51-weather`): 바람에 흔들리는 풀·나무, 꽃잎·낙엽, 골짜기 안개, 햇살(높음), 색 보정·비네트, 물결·물보라·반짝임, 비 물방울, 등불·깃발 흔들림, 굴뚝 연기, 밤 반딧불, 무지개. 모든 셰이더는 0 나누기·NaN 을 막고(§14), `NaNScrubShader` 는 블룸 앞에 있어요.
- 캐릭터·상호작용(`66-fx`·`23`·`25`·`65`): 달리기 선·잔상, 착지 먼지, 발자국, 순간이동 문(빠른 이동 0.22초 전에 나타남), 구역 배너, 퀘스트 완료 빛기둥, 코인·아이템 날아가기, NPC 눈 깜빡임·쳐다보기, 3D 퀘스트 표시, 가까운 물건 빛나기, 옹이 표정 동작.
- 2D(`04-ui`·`70-app`·각 CSS): 같은 움직임 규칙(120/200/320/500 ms, ease-out-quint, 커지는 효과는 4% 이하), 모달·탭·토스트 아이콘·숫자 올라가기·로딩 장독 그림·처음 화면의 만장대 배경과 깊이감.
- **효과 설정**: ⚙️ 설정 › 그래픽의 **✨ 효과 연출**(끔 / 은은하게 / 풍성하게 = `fxLevel`), **그래픽 품질**(자동/낮음/중간/높음 — 낮음은 가볍게: 작은 소품 72 m 거리 컷, 큰 텍스처 절반), 접근성의 **🧘 움직임 줄이기**(`reduceMotion`: 카메라 흔들림·앞보기·FOV 변화·인트로 비행·커지는 효과를 끔). 깜빡임은 언제나 초당 3번 이하.

### 16.4 4단계 회귀 테스트 (QA 가 돌린 것)
- `node tools/build.mjs --strict` → smoke(쉬운/보통 × 1366×768/390×844 모바일, 오류 0) → `G.sys.devcenter.runTests()` 전부 통과 → `node tools/kid-audit.mjs` exit 0 → 처음 화면 흐름(새 게스트 → 인트로 건너뛰기 → 전망대, 로그아웃 → 다시 들어와 마지막 자리) → 높은 품질 밭·만장대 스크린샷(검은 영역 없음) → `node tests/server-e2e.mjs` 전부 PASS → 모든 서버 PHP `php -l` → `node tests/pii-client.mjs`.

### 16.5 5단계 1차 버그 수정에서 바뀐 것 (기준: CONTRACT §13.9)
- **서버 저장 충돌:** 게임은 저장할 때 마지막으로 받은 리비전을 `base` 로 보내요. 다른 창·기기가 그 사이 더 새로 저장했으면 서버가 409 `STALE_SAVE` 로 거절하고, 이 창은 서버의 최신 기록을 불러와 "다른 창(기기)에서 더 새로 저장한 진행 상황을 불러왔어요." 라고 알려요. 서버에 있는 더 새 기록이 이 창이 보낸 것(창을 숨길 때 보낸 비콘, 답을 못 받은 저장)이면 자기 저장이라 그 리비전으로 한 번 더 저장해요.
- **서버 저장 형식:** 저장 데이터의 지도 키(가방·방문·도감·업적·배움 …)에 `constructor`·`__proto__`·`toString` 같은 Object.prototype 이름이 있으면 서버가 400 `INVALID_SAVE` 로 거절해요(게임의 normalize 도 지워요).
- **로그인 시간이 끝났을 때:** 채팅·접속자 폴링이 401 을 먼저 받아도 다시 로그인 창이 떠요(`save:auth-lost {source:'social'}`).
- **응답이 늦게 끝날 때:** 머리글은 왔는데 본문이 제한 시간 안에 다 오지 않으면 "HTTP_200" 실패가 아니라 네트워크 오류(`NETWORK_ERROR`)로 다뤄요 — 바쁜 서버에서 다시 시도해요.
- **아이 화면:** 3D 이름표(이름·칭호)는 쉬운 모드에서 14 px 이상, 아이 채팅 말풍선·오늘(출석)·배움 화면 글자는 16 px 이상이에요. 아이 배움 슬라이드에서는 그림 속 어른용 작은 설명 글(`ev-cap`)을 감추고(아래 큰 글이 읽어 줘요), 미생물 그림의 이름표는 더 커졌어요.
- **개발자 센터:** 자가 테스트가 94개예요(이번에 16개 추가: 저장 형식 고치기, 조사 '으로/로', 보호자 확인 쉬는 시간 상한, 상호작용 대상 등록, 퀴즈 보기 섞기, 낮은 충돌체 높이, 난간 옆 길 찾기, 접속 친구 달리기·이름표, 아이 신고 창, Tab 순환, 이모지 104 %, 키오스크 고르기, 하늘 빛 텍스처, 테두리 빛 셰이더, 화면 배율, GPU 잃었을 때 사진). 데이터 검사는 게임이 켜진 뒤 **실제로 등록된 상호작용 대상**으로 퀘스트·도감을 확인해요 — 끝낼 수 없는 목표는 오류예요. 아이 점검의 대비·크기 검사는 SVG 그림 글자(화면 크기로 재요)와 이모지(❤️ 의 보이지 않는 글자)를 잘못 세지 않아요.

