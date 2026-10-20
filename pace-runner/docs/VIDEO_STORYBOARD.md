# Run at your pace — 소개 영상 스토리보드 v2

**근거:** 실제 코드 `github.com/gngsn/RunAtYourPace` (AI Studio 앱 `d291f3ea…`) 를 읽고 작성. 브라우저로 앱을 직접 실행해 본 것은 아님.
**길이:** 약 1:30 · 16:9 · 화면 녹화 중심 · 내레이션 언어는 미정(아래 "확인 필요" 참고)
**한 문장 메시지:** *"내가 뛴 코스가 그대로 3D 게임 코스가 된다."*

> ⚠️ v1 폐기 사유: v1은 `ARGON_BRIEF.md`(Level Director, Character Forge, Past You 라이브 음성, Lyria 음악, 스크린샷 가져오기 등) 기준이었으나, 실제 코드에는 Gemini 호출이 **없습니다**(`@google/genai`는 설치만 되어 있고 `src/`에서 사용처 0건). 영상에 넣으면 앱에 없는 기능을 보여주게 됩니다.

## 앱에서 실제로 확인된 것 (코드 근거)

| 기능 | 근거 |
|---|---|
| GPX 가져오기: 파일 선택 또는 화면에 드래그 앤 드롭, 즉시 파싱해 코스 생성, 현재 코스를 GPX로 내보내기 | `App.tsx` `handleGpxFileUpload`, 드롭 오버레이, `handleDownloadCurrentGpx` |
| 서울 프리셋 코스 5개: Banpo Hangang Moonlight, Hangang & Seoul Forest 10K, Namsan Moonlight Botanical, Olympic Park Mongchon Moat, Yeouido Blossom Waterfront | `gpxParser.ts` `PRESET_COURSES` |
| 3레인 코스(좌/중/우, 레인 폭 1.85), 코인 줄(직선·대각선)과 큰 별 코인, 허들 | `PastelWorldCanvas.tsx` |
| 조작: `←/→` 또는 `A/D` 레인 이동, `1/2/3` 레인 직접 선택, `Space` 점프·아이템 사용, `C` 카메라 전환, `H` HUD 접기, `Esc` 나가기 | `PastelWorldCanvas.tsx`, `App.tsx` |
| 카메라 5종: chase / front / side / aerial / first_person | `PLAY_CAMERA_SEQUENCE` |
| 테마 4종: Pink Fluffy Meadow, Cloud Stride Autumn, Luminous Night Garden, Riverside Felt Stroll (코스별 추천 테마) | `ARTWORK_THEMES` |
| 캐릭터 5종(Felt Hat Runner, Flower Crown Sprite, Cloud Twin-Bun, Mint Aero Sprinter, Starlight Fox), 메인 러너 저장 | `FIVE_CHARACTERS`, localStorage |
| 아이템: Magnet Fever, Coin Surge +3, Pace Boost / 콤보·피버 | `PastelWorldCanvas.tsx` |
| 화면 흐름: My Routes → Preview → Character → 카운트다운 → Play → 결과, My Stats(페이스 믹스, 코스별 기록) | `App.tsx` 상태 머신 |
| 플레이 HUD: 코인 카운터 + 우상단 경로 미니맵. Google Maps 키가 없으면 SVG 미니맵으로 대체 | `MinimapPanel.tsx` |
| 코스 리포트: 1km 스플릿, 주변 랜드마크, 구간 클릭 시 해당 지점으로 이동 | `CourseReportModal.tsx` |
| 효과음(코인, 부스트, 점프, 레인 이동 등), 음소거 토글 | `soundEffects.ts` |
| 페이스 → 속도: 현재 지점 페이스에 따라 속도 배율 0.75~1.45배(기준 5'24"/km), 달리기 동작도 연동 | `PastelWorldCanvas.tsx` `paceSpeedFactor` |
| 기록 저장: 코스별 최고 점수·코인·시간, `Past You` 대비 시간차 | `courseRecords` |

**영상에서 제외 / 주의:** Gemini 기반 기능 전부, 라이브 음성, 적응형 음악(음악 파일 없음, 효과음만). "Past You" 고스트는 시간차 숫자(`vsPastYouSeconds`)는 있으나 화면에 고스트 캐릭터를 그리는 코드는 찾지 못함. 녹화 때 실제로 보이는지 확인 필요. 고도 반영은 계획서엔 있으나 코드 주석에 "Flat" 코스로 되어 있음.

---

## 영상용 에셋 (사용자 제공)

| 에셋 | 파일 | 규격 | 영상에서 쓰는 곳 |
|---|---|---|---|
| 로고 "Run At Your Pace" (풍선 글자 + 후디 러너) | `~/Downloads/Glossy Pastel Run At Your Pace.png` | 1536×1024, RGBA | 샷 2 타이틀, 샷 8 엔딩 |
| 캐릭터 1 새싹 스마일 | `game_characters_individual/01_sprout_smile.png` | 400×864, 투명 배경 | 샷 4 캐릭터 소개 |
| 캐릭터 2 피치 X눈 | `…/02_peach_xeyes.png` | 400×843 | 샷 4 |
| 캐릭터 3 후디 (로고의 주인공) | `…/03_hoodie.png` | 400×852 | 샷 2, 4, 8 (메인 러너) |
| 캐릭터 4 플라워 | `…/04_flower.png` | 400×852 | 샷 4 |
| 캐릭터 5 비니 | `…/05_beanie.png` | 400×874 | 샷 4 |

**주의 (코드와 에셋 불일치):** 앱 안의 캐릭터 5종은 three.js로 코드에서 그린 모델이고(`FIVE_CHARACTERS`: Felt Hat Runner, Flower Crown Sprite, Cloud Twin-Bun, Mint Aero Sprinter, Starlight Fox), 위 이미지와 모양이 다릅니다. 앱 화면 녹화에는 코드의 모델이 나오므로, 이 이미지들은 인트로/캐릭터 소개/엔딩 같은 별도 그래픽 컷에만 쓰고 "게임 안에서 달리는 모습"처럼 보이게 하면 안 됩니다. 앱에 이 캐릭터를 넣을 예정이라면 코드 반영 후 녹화해야 합니다.

## 샷 리스트

| # | 시간 | 화면 | 자막 | 내레이션(안) | 녹화 메모 |
|---|---|---|---|---|---|
| 1 | 0:00–0:08 | 평평한 2D 지도 선과 숫자 표 → 디졸브로 3D 파스텔 세계. | "기록은 숫자로만 남는다" → "이제 코스가 된다" | "러닝이 끝나면 남는 건 지도 위의 선과 숫자뿐이죠." | 1컷은 일러스트/목업 가능. |
| 2 | 0:08–0:16 | My Routes 그리드를 오가며 5개 코스 카드 노출, 타이틀. | 로고 팝인(풍선 글자가 통통 튀며 등장) | "Run at your pace는 내가 뛴 코스를 3D 러닝 게임으로 바꿔 줍니다." | 로고 PNG 사용. 앱 첫 화면이 My Routes(`screen` 기본값 `select`). |
| 3 | 0:16–0:30 | `.gpx` 파일을 창에 드래그 → 점선 오버레이("Drop your .GPX file here…") → Preview 화면에 새 코스. | "GPX를 끌어다 놓기만 하면" | "GPX 파일을 끌어다 놓으면, 경로가 바로 3차원 코스로 만들어집니다." | 본인 GPX 1개 준비. 토스트(거리 표시) 같이 캡처. |
| 4 | 0:30–0:42 | (그래픽 컷) 캐릭터 5명이 차례로 통통 튀며 등장 → Preview: 거리/실제 시간/평균 페이스, 구간 페이스 칸, 조작 안내. 이어서 캐릭터 선택에서 5종을 넘겨 보고 Start running. | "5명의 러너" | "캐릭터를 고르고 달려 볼까요." | Preview 카메라는 코스를 높이서 내려다봄. |
| 5 | 0:42–1:08 | 카운트다운 → 플레이. 3레인에서 `←/→`로 코인을 먹고, `Space` 점프로 허들, 아이템(Magnet Fever 등) 사용, 콤보/피버. 중간에 `C`로 카메라 전환. | "코인을 모아 기록을 남기자" | "내 실제 경로가 코스가 되고, 세 레인을 오가며 코인을 모읍니다." | 조작 키 입력이 보이도록 키 오버레이 추가 권장. 우상단 미니맵과 코인 카운터 클로즈업 1컷. |
| 5b | (5 안에 삽입, 약 6초) | 미니맵/스플릿 그래프에서 느린 구간과 빠른 구간을 짚고, 같은 코스를 달리는 러너가 느린 구간에서 느려지고 빠른 구간에서 빨라지는 모습(분할 화면 가능). | "내 페이스가 곧 게임 속 속도" | "숨찼던 오르막은 천천히, 치고 나간 직선은 빠르게. 내 페이스가 곧 게임 속 속도입니다." | 녹화 전 차이가 눈에 보이는 코스(페이스 변동이 큰 GPX)를 골라 확인. 속도 배율은 0.75~1.45배로 제한되어 차이가 작을 수 있음. |
| 6 | 1:08–1:18 | 테마 4종과 서울 프리셋을 빠르게 전환(밤 초원, 구름 가을, 야간 정원, 강변). | "코스마다 다른 분위기" | "코스에 따라 달밤의 초원도, 구름 위 가을 길도 됩니다." | My Routes에서 테마 변경 + 다른 코스 실행. |
| 7 | 1:18–1:28 | 완주 → 저장 토스트(점수/코인) → My Routes에 최고 기록 배너. My Stats(페이스 믹스, 코스별 기록). | "완주할수록 쌓이는 내 기록" | "완주하면 기록이 저장되고, 내 러닝이 한눈에 정리됩니다." | 한 번은 실제로 완주해 둘 것. |
| 8 | 1:28–1:35 | 로고 + 후디 러너 + 한 줄 + URL `run-at-your-pace.ai.studio`. | "내 러닝, 게임이 되다" | "내가 뛴 길이, 오늘의 게임이 됩니다." | |

**구성 근거:** 내레이션 약 110~130 단어/자 분량(한국어 기준 약 25~30문장 이하). 30초 컷다운: 샷 3 → 5 → 6 → 8.

## 확인 필요 (녹화 전)
1. **영상의 정체성:** 이번 영상은 "GPX → 3D 코스 + 코인 러너"로 가는 것이 맞는지, 아니면 ARGON_BRIEF의 해커톤 데모(Gemini 기능 포함)를 앞으로 구현해서 찍을 계획인지. 후자라면 현재 코드는 해당 기능이 없어 영상화 불가.
2. **내레이션/자막 언어:** 앱 UI는 영어, 앱 설명은 한국어. 한국어 내레이션 + 영어 UI 원본 유지로 갈지.
3. **앱 실행 확인:** 로컬 `bun install && bun dev`(포트 3000) 또는 AI Studio에서 실제로 아래가 보이는지 — 고스트 표시, 아이템 슬롯 UI, 플레이 중 HUD(코드상 코인+미니맵만), 결과 화면(`result`/`over` 오버레이는 완주 시 `select`로 바로 돌아가 쓰이지 않을 수 있음).
4. **Google Maps 미니맵:** API 키가 필요. 키가 없으면 SVG 대체 미니맵이 나옴. 영상에 어느 쪽을 쓸지.
5. **녹화 데이터:** 본인 GPX 1개, 쓰지 않을 개인 위치(집 근처 시작점)는 가리기.
