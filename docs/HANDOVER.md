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
| `node tools/smoke.mjs --file dist/metaverse/index.html --params "autostart=1&quality=low"` | 헤드리스 실행 테스트 — 콘솔·조각·시스템 오류가 있으면 exit 1 |
| `node tools/smoke.mjs ... --eval "return G.sys.devcenter.runTests()"` | 브라우저 안 자가 테스트(50개+) 실행 결과 출력 |
| `node tools/smoke.mjs ... --shot a.png --viewport 1366x768` / `--mobile` | 스크린샷 (헤드리스 WebGL 은 소프트웨어라 FPS 가 낮은 게 정상) |
| `node tests/server-e2e.mjs` | 서버 E2E (php -S 를 임시 DB 로 띄우고 정리) |
| `npm run package` | 엄격 빌드 + `release/fermentation-metaverse.zip` |

## 4. 폴더·모듈 지도

`src/game/NN-이름.js` 조각(fragment)이 **파일명 순서**대로 한 클로저에 합쳐집니다. 조각끼리는 `G` 로만 통신하고,
시스템은 `G.register({name, order, init, onStateLoaded, update, onLogout})` 로 등록합니다. 각 JS 와 같은 번호의 CSS 가 짝입니다.

| 번호 | 파일 | 담당 | 역할 |
|---|---|---|---|
| 00–06, 10 | core·data·layout·state·ui·input·world·engine | 코어(리드) | 버스·유틸·저장·UI 도구·입력·충돌·렌더러 |
| 11–13 | terrain·nature·water | 월드-지형 | 지형·숲·강·연못·폭포 |
| 15–16 | buildings·props | 월드-건물 | 체험관·한옥·장독대·밭·안내판 |
| 20–23 | avatar·player·camera·interaction | 플레이어 | 아바타·이동·카메라·E 상호작용 |
| 25–26 | npc·dialogues | NPC | NPC 5명·대화 시스템·대화 데이터 |
| 30–32 | inventory·quest·progression | 성장 | 가방·상점·퀘스트·레벨·업적·도감 |
| 40–41 | farming·fermentation | 농사·발효 | 밭 시뮬레이션·장독 발효·재료 만들기 |
| 45–47 | education-data·education·journal | 교육·일지 | 교육 9종·퀴즈·작업일지 |
| 50–52 | minimap·weather·photo | 지도·날씨·사진 | 미니맵·월드맵·날씨/시간·사진 모드 |
| 60–61 | social·audio | 소셜·오디오 | 채팅·이모지·체험객·절차적 사운드 |
| 62 | engagement | 참여 | 출석·오늘의 미션·알림함·수료증·랭킹·꾸미기 |
| 65 | companion | 동반자 | 마스코트 옹이(2D·3D)·도움말 |
| 66 | fx | 연출 | 파티클·레벨업·코인·도장 |
| 70 | app | 앱 셸 | 부팅·로그인(PBKDF2)·타이틀·메뉴·설정·튜토리얼 |
| 80 | devcenter | 개발자 센터 | 점검·데이터 검증·자가 테스트·디버그·문서·인수인계 |
| `server/` | PHP API·admin.php·lib | 서버 | 인증·검증 저장·채팅·접속자·업로드·관리 |
| `tools/` `tests/` | build·smoke·package·server-e2e | 코어·서버 | 빌드·테스트·배포 |

- 파일별 담당·역할·줄 수·sha 는 개발자 센터 › 🗂️ 소스 구조 에서 실시간으로 볼 수 있어요(빌드 매니페스트 기반).
- 시스템끼리는 **이벤트 버스**로 소통합니다(`G.bus.emit('farm:harvested', …)` → 퀘스트·통계·연출이 구독). 이벤트 목록은 CONTRACT §4, 실제 발행 횟수·구독 모듈은 소스 구조 탭의 "이벤트 흐름 지도".

## 5. 개발자 점검·인수인계 센터 사용법

| 여는 법 | `?dev=1`(부팅 후 자동) · **F9** / **`** · **Ctrl+Shift+D** · Esc 메뉴 › 🛠️ 개발자·관리자 센터 · `G.sys.devcenter.open('tests')` |
|---|---|
| 권한 | 로컬 모드는 항상, 서버 모드는 **서버 관리자 계정** 또는 **서버 PC(localhost)의 `?dev=1`** 만 |

| 탭 | 확인할 것 |
|---|---|
| 📊 개요 | 건강 점수(감점 이유 표시), 모듈·오류·데이터·테스트·FPS·저장 카드, 빌드 버전·시각·three 리비전 |
| 🖥️ 시스템 점검 | 브라우저·GPU·WebGL 한계값·draw calls·CSP 정책/위반·저장 공간·오디오/음성/crypto 지원 |
| 🧩 모듈 상태 | 시스템 초기화 순서·실패·업데이트 중지·공개 API·마지막 오류·콘솔 오류·빌드 매니페스트 |
| 🔍 데이터 검증 | `G.data` 교차 참조 검사(퀘스트·도감·상점·작물↔아이템·레시피·대화 노드·배치·교육↔퀴즈·중복 ID·한국어 이름) |
| 💾 저장 데이터 | `G.state` 트리, 내보내기/가져오기/초기화, localStorage 키별 크기, 로컬 계정(해시 비공개) |
| 🌐 서버 점검 | ping·세션·저장·랭킹·채팅(읽기 전용) 응답 시간, `api/admin/health.php` 결과 |
| 🧪 자가 테스트 | 실제 저장을 건드리지 않는 50개+ 단위 테스트 (유틸·XSS·저장 체크섬·충돌·구역·농사/발효 계산·암호) |
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
| 개발자 센터 | 서버 모드에서는 관리자/서버 PC 만, 치트는 모두 기록, 보고서·화면에 해시·토큰·전체 이메일 미표시 |

- 비밀번호·비밀값은 `G.state`·로그에 절대 넣지 않습니다. 운영은 반드시 **HTTPS**.
- 새 코드를 넣은 뒤 개발자 센터 › 시스템 점검 › 보안 에서 **CSP 위반 0건**을 확인하세요(위반은 `securitypolicyviolation` 으로 수집).

## 9. 성능 메모

- 목표: 보통 노트북 30 FPS 이상, 고품질 draw calls ~400 미만. 나무·풀·장독·작물은 `InstancedMesh`, 정적 지오메트리는 재질별로 병합, 재질은 `G.gfx.material()` 로 공유.
- 품질 프리셋(낮음/중간/높음)이 그림자·블룸·나무/풀 밀도·시야를 조절하고, `auto` 일 때 FPS 가 낮으면 자동으로 한 단계 낮춥니다.
- 큰 모달이 열리면 3D 렌더를 1/3 로 줄입니다. 매 프레임 메모리 할당·DOM 갱신을 피하고(라벨 거리 컷, 0.25~0.5초 간격 갱신), 체험객 NPC 는 멀면 업데이트 간격을 늘립니다.
- 측정: 개발자 센터 › 시스템 점검(실시간 draw calls·삼각형·텍스처·셰이더 수), 개요의 FPS 기록 그래프, 디버그 도구 › FPS 표시.

## 10. 알려진 이슈와 로드맵

**알려진 이슈**
- 헤드리스 브라우저·저사양 GPU(소프트웨어 WebGL)에서는 FPS 가 매우 낮습니다 — 테스트는 `quality=low` 로, 화면 판단은 스크린샷으로.
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
| 특정 기능만 안 됨 | 개발자 센터 › 모듈 상태 — ⛔ 초기화 실패/⚠️ 업데이트 중지 시스템과 마지막 오류 메시지 |
| 빌드 경고 "skipping NN (syntax error)" | 해당 조각 문법 오류 — 메시지의 줄 번호 확인, `--strict` 로 배포 차단 |
| 퀘스트·도감이 진행 안 됨 | 데이터 검증 탭에서 잘못된 ID 참조 확인, 이벤트 흐름 지도에서 이벤트 발행 횟수 확인 |
| 저장이 사라짐 | 다른 브라우저/시크릿 창인지 확인, `.bak` 백업 자동 복구 여부(토스트), 서버 모드면 서버 점검 › 내 저장 읽기 |
| 서버 모드로 안 바뀜 | `api/ping.php` 직접 열어 JSON 확인, PHP 확장(pdo_sqlite) 설치, `data/` 쓰기 권한 |
| 저장이 409 로 거부됨 | 서버가 비정상 증가를 감지 — 정상 플레이인데 거부되면 `serverLimits`·보상표와 `game-data.json` 버전 일치 확인 |
| CSP 위반 기록 발생 | 새 코드의 인라인 핸들러/외부 URL/eval 사용 여부 확인 (시스템 점검 › 보안) |

## 12. 인수인계 체크리스트

개발자 센터 › 🤝 인수인계 탭에서 체크하면 진행률이 저장됩니다. 최소 항목:

- [ ] `npm install` → `node tools/build.mjs --strict` 성공
- [ ] smoke 테스트 ✔ SMOKE OK, 자가 테스트 전부 통과, 데이터 검증 오류 0건
- [ ] (서버) XAMPP 설치·첫 관리자 지정·`config.local.php`·HTTPS·백업 일정
- [ ] 보안 점검: CSP 위반 0건, 관리자 비밀번호 교체
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
