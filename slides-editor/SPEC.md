# slides-editor SPEC

> 한 명의 발표자가 슬라이드와 스크립트(노트)를 만들고, 발표 시 라이브 동기화로 노트북·핸드폰을 함께 띄워 진행하는 도구.
> 레퍼런스: `personal-log/speech/Kprintf2026/v4/slides.html` (슬라이드 편집), `…/v5/script.html` (스크립트 뷰/동기화).

---

## 1. 개요

- 두 개의 **독립 모드**
  - **슬라이드 편집 모드** — 데스크톱 전용. 슬라이드 1장의 HTML을 inline 편집.
  - **스크립트 편집 모드** — 데스크톱·모바일 모두. 슬라이드와 1:1로 묶인 발표 노트를 편집/낭독.
- 모바일 = 스크립트 편집 모드만 지원.
- 모든 변경은 **히스토리에 적재** (자동 row + 명시적 "Save version" 스냅샷).
- 발표 시 `?sync=<roomId>`로 Supabase Realtime 채널을 통해 슬라이드 인덱스가 스크립트 뷰로 broadcast.
- 단일 사용자(owner) + **share token**으로 read-only 공유.

비목표(Non-goals): 다중 사용자 동시 편집(CRDT), 이미지/asset 호스팅, PPTX export, 드래그-앤-드롭 GUI 빌더 (text/HTML 편집만).
(PDF/HTML/Marp export는 §8에서 in-scope로 다룸.)

---

## 2. 사용자 시나리오

| ID | 시나리오 |
|----|----------|
| S1 | 빈 덱 생성 → 데크 HTML 프레임(<head>/CSS) 설정 → 슬라이드 추가, inline 편집 |
| S2 | 데스크톱에서 스크립트 모드 열어 발표 노트 작성 |
| S3 | 노트북에서 발표 화면(`/present/:id?sync=R`) 켜고, 핸드폰에서 `/script/:id?sync=R` 열어 자동 추적 |
| S4 | 발표 직전 모바일에서 오타 한 줄 수정 → cloud 저장 |
| S5 | 이전 버전으로 슬라이드 1장 롤백 |
| S6 | 청중에게 read-only 공유 링크 전달 (`?token=…`) |
| S7 | 덱을 단일 HTML/PDF로 export, 또는 노트를 Marp `.md` 형식으로 조회·복사 |

---

## 3. 데이터 모델 (Supabase Postgres)

IDEA.md 스키마를 그대로 적용하고 운영용 컬럼만 보강.

### `decks`
| col | type | note |
|---|---|---|
| `deck_id` | `varchar(200)` PK | ULID 권장 |
| `title` | `text` | 표시용 |
| `frame_html` | `text` | `<html><head>…</head><body data-deck>…</body></html>` 프레임. `<body>` 안의 `<section>`은 slides에서 join됨 |
| `share_token` | `text` UNIQUE NULLABLE | read-only 공유 토큰 |
| `owner_email` | `text` | env `OWNER_EMAIL`과 일치해야 편집 가능 |
| `created_at` / `updated_at` | `timestamptz` | |

### `slides`
| col | type | note |
|---|---|---|
| `deck_id` | `varchar(200)` | FK → decks |
| `section_id` | `varchar(100)` | URL/링크 안정 ID (slug 또는 ULID) |
| `order` | `smallint` (0~200) | UI 정렬 키 |
| `title` | `varchar(200)` | `data-title` |
| `content` | `text` | `<section …>…</section>` **그대로** 저장 |
| `updated_at` | `timestamptz` | |
| PK | `(deck_id, section_id)` | |
| UNIQUE | `(deck_id, order)` deferrable | 재정렬 트랜잭션용 |

### `notes`
| col | type | note |
|---|---|---|
| `deck_id` | `varchar(200)` | FK |
| `section_id` | `varchar(100)` | slides와 동일 키 (FK) |
| `content` | `text` | Markdown |
| `updated_at` | `timestamptz` | |
| PK | `(deck_id, section_id)` | |

### `slide_history` / `notes_history`
| col | type | note |
|---|---|---|
| `id` | `bigserial` PK | |
| `deck_id`, `section_id` | | |
| `content` | `text` | 변경 후 스냅샷 |
| `kind` | `enum('auto','manual')` | manual = "Save version" |
| `message` | `text` NULLABLE | manual일 때만 |
| `created_at` | `timestamptz` | |

- 자동 row: 편집 디바운스(800ms) 종료 후 1건 적재. 직전 row와 동일하면 skip.
- 적재 방식: 클라이언트에서 trigger 또는 PG `BEFORE UPDATE` 트리거(추후 결정 — M5 결정 사항).

---

## 4. 라우팅 & 모드 분기

| Path | 설명 | 디바이스 |
|---|---|---|
| `/` | 덱 목록 (owner만), 새 덱 만들기 | 데스크톱 |
| `/edit/:deck_id` | 슬라이드 편집 모드 | 데스크톱 전용 — 모바일은 `/script/:deck_id`로 redirect |
| `/script/:deck_id` | 스크립트 편집/뷰 (`?mode=edit\|read`, `?sync=R`) | 모두 |
| `/present/:deck_id` | 발표 모드(=슬라이드 풀스크린 + sync source). 편집 비활성, fragment 활성 | 데스크톱 |
| `/view/:deck_id?token=…` | read-only 공유 뷰 (슬라이드 풀스크린, 노트 숨김) | 모두 |
| `/notes/:deck_id` | 노트 Marp(`.md`) 조회 전용 페이지 (§8.2) | 모두 |

모바일 감지: `window.matchMedia("(max-width: 900px), (max-width: 1024px) and (orientation: landscape)")` — v4 기준 그대로.

---

## 5. 슬라이드 편집 모드 (`/edit/:deck_id`)

### 5.1 레이아웃
```
┌────────────┬─────────────────────────────────┬────────────┐
│ 썸네일 리스트 │  현재 슬라이드 캔버스 (실제 렌더)  │  속성 패널  │
│ + 새 슬라이드 │  - inline contenteditable        │  - data-title │
│ + 순서 DnD   │  - fragment 토글 (편집 중엔 모두 │  - section_id │
│             │    visible)                      │  - frame_html 편집 │
└────────────┴─────────────────────────────────┴────────────┘
상단 툴바: [Edit on/off] [Save version] [Preview] [History] [Present ↗]
```

### 5.2 핵심 동작 (v4 패턴 차용 + DB 연동)
- **inline 편집**: `data-editable="true"`인 노드 → 편집 모드일 때만 `contenteditable=true`. 키 단축: `E`.
- **stable id**: `data-edit-id`. 마크업에 없으면 `controller.js:ensureEditIds` 알고리즘으로 결정적 자동 부여.
- **자동 저장**: `input` 이벤트 → debounce(800ms) → 해당 section의 `<section>…</section>` 직렬화 → `slides.content` upsert.
  - 직전 저장 content와 동일하면 skip.
  - upsert 직후 `slide_history(kind='auto')` 1건 적재.
- **"Save version"**: 현재 화면 모든 변경분을 1개의 manual history snapshot으로 묶고 commit message 입력 모달.
- **추가**: 우측 패널 "+ Slide". 새 `section_id = ulid()`, `order = max(order)+1`, content는 기본 템플릿(`<section class="slide" data-title="Untitled"><div class="slide-content"></div></section>`).
- **삭제**: 좌측 썸네일 우클릭 → confirm → slides + notes row delete (history는 유지).
- **순서 변경**: 좌측 썸네일 DnD → 트랜잭션으로 `order` 재배치 (deferrable unique 활용).
- **frame_html 편집기**: 속성 패널 하단의 모달. CodeMirror 같은 가벼운 editor (또는 plain textarea로 시작). 저장 시 `<body>` 안 `<section>`은 placeholder(`<!-- slides -->`)로 강제.
- **미리보기 / 발표 모드 진입**: 새 탭으로 `/present/:deck_id` open.
- **fragment**: 편집 모드에서는 모든 `.fragment`를 `display: block`으로 강제. 발표 모드에서만 v4 `next/prev` 로직 활성.

### 5.3 키보드 단축
| 키 | 동작 |
|---|---|
| `E` | edit on/off |
| `Ctrl/Cmd+S` | Save version |
| `↑/↓` 또는 `j/k` | 슬라이드 이동 |
| `N` | 노트 패널 토글 |
| `?` | 단축키 도움말 |

### 5.4 노트 사이드패널
- v4 `SpeakerNotes`와 동일한 UX: 우측 슬라이드 패널, 폰트 +/-, 읽기/편집 토글.
- 저장 대상은 DB `notes` 테이블 (현재 슬라이드의 `section_id` 기준).

---

## 6. 스크립트 편집/뷰 모드 (`/script/:deck_id`)

### 6.1 두 가지 서브모드
- `?mode=read` (기본, 모바일 강제) — v5/script.html과 동일한 텔레프롬프터:
  - 현재 섹션 `active`, 이웃 `adj`, 나머지 dim
  - 폰트 +/-, HL 토글, prev/next, 동기화 ON/OFF dot
- `?mode=edit` (데스크톱 기본) — 좌/우 분할:
  - 좌: 섹션 목록 (slide title 표시)
  - 우: 선택된 섹션의 Markdown textarea + 미리보기
  - debounce 800ms 후 `notes.content` upsert + `notes_history(auto)`

### 6.2 동기화 (`?sync=R`)
- v5 `sync.js` 패턴 재사용. 채널명만 `slides-editor-sync-<R>`로 변경.
- broadcast payload: `{ section_id: string, index: number }` — section_id 우선, index는 fallback.
- `read` 모드에서만 자동 추적. 사용자가 prev/next를 누르거나 섹션을 직접 클릭하면 **수동 모드 진입** (sync 무시).
- 수동 모드는 sync-badge 클릭으로 다시 auto로 복귀.

### 6.3 모바일 사양
- 폰트 크기는 localStorage 저장 (`slides-editor:notes:fontsize`).
- 화면 항상 깨어있게 `wakeLock` 시도 (실패 무시).

---

## 7. 발표 모드 (`/present/:deck_id`)

- v4의 SlidePresentation 로직(scroll-snap + 키보드/휠/터치 + fragment + IntersectionObserver) 그대로.
- inline 편집 UI 비활성. `data-editable` 속성 무시.
- `?sync=R` 옵션이 있으면 현재 인덱스를 **broadcast**.
- 우상단에 작은 sync dot + roomId 표시. 클릭 시 코드 복사.

---

## 8. Export 기능

### 8.1 슬라이드 → HTML / PDF
- 진입점: `/edit/:deck_id` 툴바의 **[Export ▼]** → `HTML` / `PDF`.
- **HTML export**
  - `decks.frame_html`의 `<!-- slides -->` placeholder를 `slides`의 모든 `content`를 `order` 오름차순으로 join한 결과로 치환.
  - 편집 전용 속성 제거: `contenteditable`, `data-editable`, `data-edit-id`, `body.edit-active`. (v4 `InlineEditor.getSerializedHtml()` 패턴 차용.)
  - `<!DOCTYPE html>` prepend → `Blob` download, 파일명 `{slugify(deck.title)}.html`.
  - 결과 HTML은 **단독 실행 가능** — 외부 JS/CSS 의존 없는 자기충족 파일. 다만 `images/*` 같은 상대경로 자산은 동일 폴더에 함께 두어야 함 (export 시 안내 toast).
- **PDF export — 기본 경로 (브라우저 print)**
  - "PDF" 선택 시 새 창에 `present.html?deck=…&print=1` 열고 `window.print()` 자동 호출.
  - `@media print` 규칙으로 페이지당 1슬라이드, header/footer 제거, `@page { size: 1280px 720px; margin: 0; }`.
  - 사용자가 시스템 다이얼로그에서 "PDF로 저장" 선택.
- **PDF export — 고품질 경로 (CLI, 선택)**
  - `scripts/export-pdf.mjs` (Node + Playwright). 실행: `npx playwright-cli pdf <url> out.pdf` 래핑.
  - 로컬에서 `node scripts/export-pdf.mjs <deck_id> [--out path.pdf]` 형태.
  - 동일한 `?print=1` 페이지를 headless로 캡처 → 폰트 임베드, 페이지 크기 일관.
- **공통**
  - export 시 fragment는 모두 `display: block` 강제(누락 방지).
  - `data-edit-id`처럼 빌드 메타는 모두 strip, share용 sanitize(`DOMPurify`)는 owner 본인이 export하므로 미적용 (속도 우선).

### 8.2 노트 → Marp 형식 조회
- 진입점: `/notes/:deck_id` (조회 전용, 신규 라우트) + `/script/:deck_id` 툴바의 **[View as Marp]** 링크.
- 출력 포맷 (v5 `script.md`와 동일):
  ```
  ---
  marp: true
  theme: default
  ---

  ## {slides[0].title}

  {notes[0].content}

  ---

  ## {slides[1].title}

  {notes[1].content}

  ---
  ...
  ```
- 렌더 방식: `<pre>` 안 plain text. **Markdown 파싱 없음** — 그대로 출력만. HTML 이스케이프 적용.
- 우상단 액션: **[Copy]** (클립보드), **[Download .md]** (`{slugify(deck.title)}-notes.md`).
- 빈 노트 섹션: 본문은 빈 줄 1개로 유지 (구분자만 출력되어 누락 방지).
- 편집 불가, 인증 불요 — 단 `deck.share_token`이 설정된 덱은 `?token=` 일치 시에만 조회 가능. token 미설정 덱은 passphrase 인증 필요.
- 산출물은 marp-cli 입력으로 바로 사용 가능 (`marp notes.md -o notes.pdf`).

---

## 9. 히스토리 / 롤백

- **자동 row**: 편집 디바운스 직후 1건. 동일 content면 skip.
- **manual 스냅샷**: 툴바 "Save version" → 현재 모든 슬라이드/노트를 한 `created_at`으로 묶음 (`kind='manual'`, `message=...`).
- **타임라인 UI**: 우측 패널에서 시간 역순 리스트. 행 클릭 시 diff 미리보기 (해당 섹션만).
- **롤백 동작**:
  - 단일 섹션 롤백: 해당 row의 content로 `slides.content` 또는 `notes.content` 덮어쓰기 → 새 `kind='manual'` history 적재(`message="rollback to #..."`).
  - 덱 전체 롤백: 가장 가까운 manual 스냅샷의 모든 row 일괄 복원.
- **보존 정책 (초기)**: 자동 row는 섹션당 최근 200개 유지, manual은 무제한. (M5에서 cron으로 정리)

---

## 10. 공유 / 권한

- 편집 권한: `owner_email`이 `OWNER_EMAIL` env와 일치할 때만. 초기 구현은 **passphrase** 환경변수 1개 (`OWNER_PASSPHRASE`)로 간이 인증 → 토큰을 localStorage 저장. Supabase Auth는 M6 이후 옵션.
- 공유 링크: `/view/:deck_id?token=<share_token>` — `share_token`이 deck 행과 일치하면 read-only 슬라이드만 노출. 노트 비공개.
- 토큰 재발급 가능 (`/edit` 툴바 → "Rotate share link").

---

## 11. 비기능 / 부가 사양

- **오프라인 fallback**: cloud truth, localStorage는 작업 중 버퍼. 네트워크 실패 시 toast + 큐잉 후 재시도.
- **다크모드**: 기본 dark (v5/v4 톤). 토글은 후순위.
- **에디터 안전성**: owner-only이므로 XSS 무시 가능. 단 share 뷰는 `<script>`/`on*` 속성 sanitize (DOMPurify).
- **i18n**: 초기 한국어. 문자열은 `js/i18n.js`에 모음.
- **접근성**: contenteditable 영역에 aria-label, 키보드 nav, prefers-reduced-motion 존중 (v4 그대로 차용).

---

## 12. 레퍼런스 → 본 프로젝트 매핑

| 본 프로젝트 모듈 | 참조 파일 | 차용 범위 |
|---|---|---|
| `js/slide-runtime.js` | `v4/controller.js :: SlidePresentation` | 거의 그대로 |
| `js/inline-editor.js` | `v4/controller.js :: InlineEditor` | localStorage → Supabase upsert로 교체, `ensureEditIds`는 유지 |
| `js/notes-panel.js` | `v4/controller.js :: SpeakerNotes` | UI 유지, 저장처를 `notes` 테이블로 교체 |
| `js/script-view.js` | `v5/script.html`의 인라인 스크립트 | 그대로 모듈화 |
| `js/sync.js` | `v5/sync.js` | 채널명 prefix 변경, payload에 `section_id` 추가 |
| `js/export.js` | v4 `InlineEditor.getSerializedHtml` + v5 `script.md` 포맷 | HTML/PDF/Marp export 통합 |
| `css/slide-runtime.css` | `v4/slides.html`의 `<style>` 일부 + 데크별 frame_html | runtime 공통 부분만 분리, `@media print` 룰 포함 |

---

## 13. 미해결 결정 (Open Questions)

각 항목은 PLAN.md의 해당 마일스톤에서 확정.

- (Q1) history 적재를 PG trigger로 할지 / 클라이언트에서 명시 insert할지 → 일단 **클라이언트**, 추후 trigger 옵션 검토.
- (Q2) frame_html 편집은 plain textarea로 시작, CodeMirror는 M8 폴리시에서 검토.
- (Q3) Supabase Auth 전면 도입 시점 → 단일 사용자 안정화 이후.
- (Q4) `getdesign/` 폴더의 디자인 레퍼런스(`clickhouse, cohere, figma, kraken, nike`)는 새 deck 템플릿으로 흡수할지 추후 결정.
- (Q5) PDF export 기본 경로를 브라우저 `window.print()`만으로 충분히 받아들일지 / 처음부터 Playwright CLI 경로를 같이 제공할지 → 일단 **브라우저 우선**, CLI는 옵션.
