# 사용한 자료 — 출처와 라이선스 (ASSET CREDITS)

> 이 문서는 `assets/pack/src/make_pack.py --credits` 가 `assets/pack/MANIFEST.json` 에서 만든다. 표를 고치려면 스크립트나 매니페스트를 고치고 다시 만든다.

체험관 화면에 들어가는 사진 재질·옛 그림·하늘 사진은 모두 **96개 파일, 2.92 MB** 이고, 한 개의 HTML 파일 안에 함께 담긴다 (CONTRACT §16.1). 실행 중에 다른 사이트에서 불러오는 것은 하나도 없다.

쉬운 말 풀이

- **CC0 / 퍼블릭 도메인**: 만든 사람이 권리를 모두 내려놓았거나 보호 기간이 끝나서, 누구나 허락 없이 자유롭게 쓸 수 있다는 뜻이다. 출처를 적을 의무는 없지만 이 문서에 모두 적어 둔다.
- **재질 세트(PBR)**: 벽·나무·흙이 빛을 받았을 때 진짜처럼 보이게 하는 그림 세 장 — 색(c), 굴곡(n, 노멀), 거칠기(r).
- **매니페스트**: 들어 있는 파일의 목록표. 파일마다 이름·크기·지문(sha256)·출처·라이선스가 적혀 있다.

## 1. 새 자료를 넣을 때 지킬 규칙

1. **CC0 또는 퍼블릭 도메인만** 넣는다. "비상업적 이용만", "출처 표시 필수(CC BY)" 같은 조건이 붙은 자료, 라이선스를 확인할 수 없는 자료는 넣지 않는다.
2. 파일마다 **출처 주소, 라이선스, 근거(라이선스를 확인한 문장이나 공식 목록)** 를 `assets/pack/MANIFEST.json` 에 적는다. 이 문서의 표는 거기서 만들어진다.
3. **매니페스트에 없는 그림 파일이 `assets/pack/` 에 있으면 빌드가 멈춘다.** 지문(sha256)이 다르거나 전체가 3.0 MB 를 넘어도 멈춘다 (`tools/build.mjs`).
4. 실행 중에 바깥 주소를 불러오지 않는다 (핫링크 금지). 모든 자료는 HTML 안에 담는다.
5. 구하지 못한 이름 있는 작품을 **만들어 낸(생성) 그림으로 대신하지 않는다.** 없으면 없다고 적는다 (아래 6번).
6. 그림(문화재)은 사진 배경과 색상표만 잘라 내고, **작품 자체는 고치지 않는다.**

다시 만드는 방법 (원본은 저장소에 넣지 않는다 — 아래 표의 출처에서 받는다)

```
python3 -I assets/pack/src/make_pack.py --acg <ambientCG 1K JPG 폴더> --met <The Met 원본 폴더> --raw <하늘 PNG·블루 노이즈 폴더> --out assets/pack --credits docs/ASSET-CREDITS.md
```

- ambientCG 원본 이름: `<자료 ID>_1K_Color.jpg`, `_NormalGL.jpg`, `_Roughness.jpg` (나뭇잎 카드는 `_Opacity.jpg` 도) — https://ambientcg.com/a/<자료 ID> 의 1K-JPG 묶음.
- The Met 원본: `https://storage.googleapis.com/gcs-public-data--met/<objectID>/0.jpg` 를 `met_<objectID>_0_….jpg` 로 저장.

## 2. 재질 세트 — ambientCG (CC0 1.0)

근거: "All ambientCG assets are provided under the Creative Commons CC0 1.0 Universal License." (https://docs.ambientcg.com/license/)

| 이름 (`mat/<이름>/c·n·r`) | 쓰임 | 출처 | 라이선스 | 근거 | 크기 (색 / 굴곡 / 거칠기) |
|---|---|---|---|---|---|
| `giwa_roof_tile` — 기와 (골기와) | 기와지붕 | [RoofingTiles013A](https://ambientcg.com/a/RoofingTiles013A) | CC0 1.0 | ambientCG 라이선스 문서 (위) · 골기와의 둥근 골과 겹침은 사진이 아니라 `make_pack.py` 가 계산해 만든 무늬 | 512px 20 KB / 512px 6 KB / 256px 3 KB |
| `thatch_choga` — 초가지붕 짚 | 초가 지붕 | [ThatchedRoof001A](https://ambientcg.com/a/ThatchedRoof001A) | CC0 1.0 | ambientCG 라이선스 문서 (위) | 512px 38 KB / 256px 19 KB / 256px 2 KB |
| `lime_plaster_wall` — 회벽 (석회 미장) | 한옥 흰 벽 | [Plaster003](https://ambientcg.com/a/Plaster003) | CC0 1.0 | ambientCG 라이선스 문서 (위) | 512px 54 KB / 256px 16 KB / 256px 1 KB |
| `hwangto_clay_wall` — 황토벽 | 흙벽·부뚜막 | [Clay002](https://ambientcg.com/a/Clay002) | CC0 1.0 | ambientCG 라이선스 문서 (위) | 512px 7 KB / 256px 9 KB / 256px 3 KB |
| `timber_beam_dark` — 오래된 기둥·보 (짙은 나무) | 실내 기둥·대들보 | [Wood036](https://ambientcg.com/a/Wood036) | CC0 1.0 | ambientCG 라이선스 문서 (위) | 512px 35 KB / 256px 8 KB / 256px 5 KB |
| `wood_planks_dark` — 오래된 널빤지 | 곳간·헛간 널벽 | [Planks023A](https://ambientcg.com/a/Planks023A) | CC0 1.0 | ambientCG 라이선스 문서 (위) | 512px 28 KB / 384px 11 KB / 256px 1 KB |
| `maru_floor` — 우물마루 바닥 | 대청마루 | [WoodFloor041](https://ambientcg.com/a/WoodFloor041) | CC0 1.0 | ambientCG 라이선스 문서 (위) | 512px 39 KB / 384px 2 KB / 256px 1 KB |
| `hanji_paper` — 한지 | 창호지·벽지 | [Paper001](https://ambientcg.com/a/Paper001) | CC0 1.0 | ambientCG 라이선스 문서 (위) | 512px 11 KB / 256px 4 KB / 256px 3 KB |
| `jangpan_floor_paper` — 장판지 | 온돌방 바닥 | [Paper006](https://ambientcg.com/a/Paper006) | CC0 1.0 | ambientCG 라이선스 문서 (위) | 512px 20 KB / 256px 0 KB / 256px 1 KB |
| `straw_mat` — 돗자리·멍석 | 바닥 깔개 | [Tatami001](https://ambientcg.com/a/Tatami001) | CC0 1.0 | ambientCG 라이선스 문서 (위) | 512px 38 KB / 256px 17 KB / 256px 4 KB |
| `woven_basket` — 바구니 엮음 | 소쿠리·채반 | [Wicker008A](https://ambientcg.com/a/Wicker008A) | CC0 1.0 | ambientCG 라이선스 문서 (위) | 512px 27 KB / 256px 12 KB / 256px 6 KB |
| `hemp_linen` — 삼베 | 보자기·덮개 천 | [Fabric062](https://ambientcg.com/a/Fabric062) | CC0 1.0 | ambientCG 라이선스 문서 (위) | 384px 35 KB / 256px 7 KB / 256px 1 KB |
| `onggi_glaze` — 옹기 유약 | 항아리·장독 | [GlazedTerracotta001](https://ambientcg.com/a/GlazedTerracotta001) | CC0 1.0 | ambientCG 라이선스 문서 (위) | 512px 22 KB / 384px 2 KB / 256px 1 KB |
| `field_soil` — 밭 흙 | 텃밭·숲 바닥 | [Ground048](https://ambientcg.com/a/Ground048) | CC0 1.0 | ambientCG 라이선스 문서 (위) | 512px 62 KB / 256px 26 KB / 256px 4 KB |
| `yard_dirt_path` — 마당 흙길 | 마당·오솔길 | [Ground069](https://ambientcg.com/a/Ground069) | CC0 1.0 | ambientCG 라이선스 문서 (위) | 512px 59 KB / 256px 19 KB / 256px 5 KB |
| `gravel` — 자갈 | 자갈 마당·물가 | [Gravel022](https://ambientcg.com/a/Gravel022) | CC0 1.0 | ambientCG 라이선스 문서 (위) | 512px 61 KB / 256px 40 KB / 256px 6 KB |
| `grass` — 잔디 | 풀밭 | [Grass004](https://ambientcg.com/a/Grass004) | CC0 1.0 | ambientCG 라이선스 문서 (위) | 512px 62 KB / 192px 14 KB / 256px 7 KB |
| `granite_stone` — 화강암 | 바위·기단·석등 | [Rock043S](https://ambientcg.com/a/Rock043S) | CC0 1.0 | ambientCG 라이선스 문서 (위) | 512px 62 KB / 256px 30 KB / 256px 3 KB |
| `stone_wall_doldam` — 돌담 | 돌담·석축 | [Rocks001](https://ambientcg.com/a/Rocks001) | CC0 1.0 | ambientCG 라이선스 문서 (위) | 512px 60 KB / 384px 47 KB / 256px 4 KB |
| `pine_bark` — 소나무 껍질 | 나무 줄기 | [Bark014](https://ambientcg.com/a/Bark014) | CC0 1.0 | ambientCG 라이선스 문서 (위) | 512px 62 KB / 256px 15 KB / 256px 6 KB |
| `pine_timber` — 소나무 목재 (밝은 나뭇결) | 기둥·보·문틀 (바깥) | [Wood048](https://ambientcg.com/a/Wood048) | CC0 1.0 | ambientCG 라이선스 문서 (위) | 512px 40 KB / 384px 16 KB / 256px 3 KB |
| `pine_planks` — 소나무 널빤지 | 마루·데크·울타리 | [Planks021](https://ambientcg.com/a/Planks021) | CC0 1.0 | ambientCG 라이선스 문서 (위) | 512px 35 KB / 384px 11 KB / 256px 4 KB |
| `flagstone` — 박석 (납작돌 포장) | 광장·디딤돌 길 | [Rocks025](https://ambientcg.com/a/Rocks025) | CC0 1.0 | ambientCG 라이선스 문서 (위) | 512px 60 KB / 256px 18 KB / 256px 5 KB |
| `straw_rope` — 새끼줄 | 금줄·초가 고삿 | [Rope001](https://ambientcg.com/a/Rope001) | CC0 1.0 | ambientCG 라이선스 문서 (위) | 512px 18 KB / 256px 14 KB / 256px 4 KB |
| `bamboo` — 대나무 | 대울타리·발 | [Bamboo001C](https://ambientcg.com/a/Bamboo001C) | CC0 1.0 | ambientCG 라이선스 문서 (위) | 512px 22 KB / 256px 5 KB / 256px 3 KB |

가공: 1K 원본을 줄여 WebP 로 저장했다. 굴곡(노멀) 그림은 OpenGL 방식(Y+) 그대로이고 색 변환을 거치지 않는다. 손실 압축이 두 방향 값을 뭉개지 않도록 왼쪽 절반 = X, 오른쪽 절반 = Y 인 흑백 그림으로 저장하고(`enc: "xy"`), 실행할 때 `G.pack` 이 다시 합친다.

## 3. 옛 그림 — 메트로폴리탄 미술관 오픈 액세스 (CC0)

근거: 미술관의 공식 공개 목록(Open Access CSV)에서 `isPublicDomain = true` 인 작품만 골랐다. 미술관 정책: "images of artworks it believes to be in the public domain … unrestricted use … Creative Commons Zero (CC0)" (https://www.metmuseum.org/policies/image-resources).

| 이름 (`art/<이름>`) | 작품 (원제) | 작가 · 시대 | 쓰임 | 출처 | 라이선스 | 근거 | 크기 |
|---|---|---|---|---|---|---|---|
| `chaekgeori_screen` | 책거리 병풍 (책과 문방구) (Books and Scholars' Possessions) | Unidentified artist · Korea, early 20th century · Ten-panel folding screen; ink and color on silk | 한옥 안 병풍·족자·전시판 | [The Met 73134](https://www.metmuseum.org/art/collection/search/73134) | CC0 (The Met Open Access) | 공식 목록 isPublicDomain = true | 2048×790 167 KB |
| `birds_flowers_screen` | 화조도 병풍 (꽃과 새) (Birds and Flowers) | Unidentified artist · Korea, Joseon dynasty (1392–1910), late 19th–early 20th century · Ten-panel folding screen; ink and color on silk | 한옥 안 병풍·족자·전시판 | [The Met 44760](https://www.metmuseum.org/art/collection/search/44760) | CC0 (The Met Open Access) | 공식 목록 isPublicDomain = true | 1920×1060 212 KB |
| `still_life_screen` | 기명절지도 병풍 (그릇과 꽃) (Still life with bronze vessels and flowering plants) | Attributed to Jang Seung-eop (pen name: Owon), Korean, 1843–1897 · Korea, Joseon dynasty (1392–1910), 1894 · Ten-panel folding screen; ink on paper | 한옥 안 병풍·족자·전시판 | [The Met 646996](https://www.metmuseum.org/art/collection/search/646996) | CC0 (The Met Open Access) | 공식 목록 isPublicDomain = true | 2048×945 166 KB |
| `rooster_hen_minhwa` | 금계도 (황금 수탉과 암탉) (Golden Rooster and Hen) | Unidentified artist · Korea, Joseon dynasty (1392–1910), 19th century · Hanging scroll; ink and color on paper | 한옥 안 병풍·족자·전시판 | [The Met 40073](https://www.metmuseum.org/art/collection/search/40073) | CC0 (The Met Open Access) | 공식 목록 isPublicDomain = true | 472×1152 60 KB |
| `tiger_scroll` | 호랑이 (Tiger) | In the style of Muqi (Chinese, active ca. 1250–80) · Korea or possibly Japan, 16th or 17th century · Hanging scroll; ink on silk | 한옥 안 병풍·족자·전시판 | [The Met 40069](https://www.metmuseum.org/art/collection/search/40069) | CC0 (The Met Open Access) | 공식 목록 isPublicDomain = true | 509×1152 46 KB |
| `dragon_carp_minhwa` | 용과 잉어 (Dragon and carp) | Unidentified artist, Korean · Korea, Joseon dynasty (1392–1910), late 19th century · Framed painting; ink and color on paper | 한옥 안 병풍·족자·전시판 | [The Met 853892](https://www.metmuseum.org/art/collection/search/853892) | CC0 (The Met Open Access) | 공식 목록 isPublicDomain = true | 741×1152 87 KB |
| `deer_pines` | 소나무 아래 사슴 (송록도) (Deer amid Pine Trees) | Unidentified artist · Korea, Joseon dynasty (1392–1910), 19th century · Pair of hanging scrolls; ink and color on silk | 한옥 안 병풍·족자·전시판 | [The Met 78286](https://www.metmuseum.org/art/collection/search/78286) | CC0 (The Met Open Access) | 공식 목록 isPublicDomain = true | 492×1152 56 KB |
| `wild_geese_landscape` | 모래톱에 내려앉는 기러기 (평사낙안) (Wild geese descending to sandbar) | Unidentified artist · Korea, Joseon dynasty (1392–1910), late 15th–early 16th century · Hanging scroll; ink on silk | 한옥 안 병풍·족자·전시판 | [The Met 39888](https://www.metmuseum.org/art/collection/search/39888) | CC0 (The Met Open Access) | 공식 목록 isPublicDomain = true | 514×1152 39 KB |
| `plum_branch` | 매화 가지 (Plum Branch) | Yi Yu-won (Korean, 1814–1888) · Korea, Joseon dynasty (1392–1910), dated 1888 · Hanging scroll; ink on paper | 한옥 안 병풍·족자·전시판 | [The Met 40445](https://www.metmuseum.org/art/collection/search/40445) | CC0 (The Met Open Access) | 공식 목록 isPublicDomain = true | 747×1152 44 KB |
| `bamboo_wind` | 바람에 흔들리는 대나무 (풍죽도) (Bamboo in the Wind) | Yi Jeong (artist name: Taneun), Korean, 1541–1626 · Korea, Joseon dynasty (1392–1910), early 17th century · Hanging scroll; ink on silk with gold on colophon | 한옥 안 병풍·족자·전시판 | [The Met 50486](https://www.metmuseum.org/art/collection/search/50486) | CC0 (The Met Open Access) | 공식 목록 isPublicDomain = true | 491×1152 45 KB |
| `portrait_yun_dongseom` | 윤동섬 초상 (Portrait of Yun Dongseom (1710–1795)) | Unidentified artist (Korean, late 18th–early 19th century) · Korea, Joseon dynasty (1392–1910), ca. 1790–1805 · Hanging scroll; ink and color on silk | 한옥 안 병풍·족자·전시판 | [The Met 656430](https://www.metmuseum.org/art/collection/search/656430) | CC0 (The Met Open Access) | 공식 목록 isPublicDomain = true | 611×1152 60 KB |
| `officials_gathering` | 관리들의 모임 그림 (계회도) (Gathering of government officials) | Unidentified artist · Korea, Joseon dynasty (1392–1910), ca. 1551 · Hanging scroll; ink and color on silk | 한옥 안 병풍·족자·전시판 | [The Met 74448](https://www.metmuseum.org/art/collection/search/74448) | CC0 (The Met Open Access) | 공식 목록 isPublicDomain = true | 681×1152 51 KB |

- 작가 표기는 미술관 기록 그대로다: "Unidentified artist" = 작가 미상, "Attributed to" = ~의 작품으로 전함, "In the style of" = ~의 화풍. 호랑이 그림은 미술관이 "한국 또는 일본"으로 적고 있다.
- 한글 제목은 뜻을 풀어 쓴 것이고 공식 명칭이 아니다.
- 가공: 촬영 배경(검은 바탕)과 색상표를 잘라 내고 크기를 줄였다 (자른 범위는 매니페스트의 `crop`). 작품의 색과 모양은 손대지 않았다.

## 4. 하늘 사진(HDRI) — Poly Haven (CC0)

| 이름 | 쓰임 | 출처 | 라이선스 | 근거 | 크기 |
|---|---|---|---|---|---|
| `sky/clear_noon` — 맑은 낮 하늘 (구름 조금) | 하늘 빛과 구름 (주변 반사) | [kloofendal_48d_partly_cloudy_puresky](https://polyhaven.com/a/kloofendal_48d_partly_cloudy_puresky) | CC0 1.0 | "Our assets are all licensed as CC0" (https://polyhaven.com/license) | 512×256 127 KB |
| `sky/overcast` — 흐린 하늘 | 하늘 빛과 구름 (주변 반사) | [kloofendal_overcast_puresky](https://polyhaven.com/a/kloofendal_overcast_puresky) | CC0 1.0 | "Our assets are all licensed as CC0" (https://polyhaven.com/license) | 512×256 85 KB |

가공: 밝기 범위가 넓은 사진(HDR)을 512×256 으로 줄이고, 왼쪽 절반에 색 값·오른쪽 절반에 밝기 지수를 넣어 무손실 WebP 로 저장했다 (`enc: "rgbe-split"`). 해의 방향(`sunDir`)과 가장 밝은 값(`peak`)도 매니페스트에 있다.

## 5. 나뭇잎 카드 · 노이즈

| 이름 | 쓰임 | 출처 | 라이선스 | 근거 | 크기 |
|---|---|---|---|---|---|
| `alpha/pine_branch` — 침엽수 가지 카드 (색 + 투명도) | 나무·풀의 잎 | [LeafSet019](https://ambientcg.com/a/LeafSet019) | CC0 1.0 | ambientCG 라이선스 문서 (2번) | 512×512 87 KB |
| `alpha/pine_needle` — 솔잎 카드 (색 + 투명도) | 나무·풀의 잎 | [PineNeedles001](https://ambientcg.com/a/PineNeedles001) | CC0 1.0 | ambientCG 라이선스 문서 (2번) | 512×512 32 KB |
| `alpha/maple_leaf` — 단풍잎 카드 (색 + 투명도) | 나무·풀의 잎 | [LeafSet027](https://ambientcg.com/a/LeafSet027) | CC0 1.0 | ambientCG 라이선스 문서 (2번) | 512×512 41 KB |
| `alpha/oak_leaf` — 참나무 잎 카드 (색 + 투명도) | 나무·풀의 잎 | [LeafSet016](https://ambientcg.com/a/LeafSet016) | CC0 1.0 | ambientCG 라이선스 문서 (2번) | 512×512 26 KB |
| `alpha/zelkova_leaf` — 느티나무 잎 (톱니 잎과 잔가지) 카드 (색 + 투명도) | 나무·풀의 잎 | [LeafSet005](https://ambientcg.com/a/LeafSet005) | CC0 1.0 | ambientCG 라이선스 문서 (2번) | 512×256 22 KB |
| `alpha/grass_blade` — 풀잎 카드 (색 + 투명도) | 나무·풀의 잎 | [Foliage006](https://ambientcg.com/a/Foliage006) | CC0 1.0 | ambientCG 라이선스 문서 (2번) | 512×512 26 KB |
| `noise/blue64` — 블루 노이즈 64×64 | 그림자·안개를 부드럽게 흩뜨리는 무늬 | [free-blue-noise-textures](https://github.com/Calinou/free-blue-noise-textures) | CC0 1.0 | README: "Copyright 2016-2017 Christoph Peters. Licensed under CC0 1.0 Universal" | 64×64 17 KB |

가공(나뭇잎): 색 그림과 투명도 그림을 한 장(RGBA)으로 합치고, 잎 가장자리에 사진 바탕색(검정·크림색)이 묻어나지 않도록 잎 색을 투명한 곳까지 번지게 했다.

## 6. 구하지 못한 것 (대신 만든 그림은 없다)

- 김홍도·신윤복의 풍속화, 일월오봉도, 까치호랑이(작호도): 소장 기관 사이트(국립중앙박물관, 공유마당 등)에 이 작업 환경에서 접속할 수 없어 받지 못했다. **생성한 그림으로 대신하지 않았다.** 넣으려면 운영자가 공공누리 제1유형 또는 퍼블릭 도메인 파일을 직접 구해 위 규칙대로 등록한다.
- 한국 전통 기물의 CC0 3D 모형: 찾지 못했다. 건물·항아리·소품의 모양은 모두 코드로 만든다.
- 글꼴 Pretendard (SIL Open Font License 1.1) 와 three.js (MIT) 는 이 묶음이 아니라 빌드가 따로 담는다 (README 참고).
