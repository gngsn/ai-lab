# slides-editor PLAN

> SPEC.md의 사양을 구현하기 위한 단계별 작업 계획.
> 결정: **Vanilla JS + Supabase**, **단일 사용자(passphrase) + 공유 링크**.
> 호스팅 가정: Vercel static (v5와 동일). 확정 전이라면 M0에서 결정.

---

## 0. 결정 사항 요약

| 항목 | 결정 |
|---|---|
| 프론트 | Vanilla HTML + ESM JS, 빌드리스 (esm.sh 활용) |
| DB / Realtime | Supabase Postgres + Broadcast |
| 인증 | passphrase 1개 → localStorage 토큰 (M6에서 재검토) |
| 호스팅 | Vercel static (v5 패턴) — **확인 필요** |
| 폰트 | IBM Plex (v4/v5 그대로) |
| 상태관리 | 페이지별 모듈 단위, 글로벌 store 없음 |

---

## 1. 레포 구조 (제안)

```
slides-editor/
├─ index.html              # 덱 목록 + 새 덱 생성
├─ edit.html               # 슬라이드 편집 (data-page="edit")
├─ script.html             # 스크립트 편집/뷰
├─ present.html            # 발표 모드 (sync source) + ?print=1 print 레이아웃
├─ view.html               # share-token read-only
├─ notes.html              # 노트 Marp 조회 페이지 (§8.2)
├─ css/
│  ├─ base.css             # reset, tokens
│  ├─ editor.css           # edit.html 전용
│  ├─ script.css           # script.html 전용
│  └─ slide-runtime.css    # 슬라이드 공통 (v4 스타일 추출)
├─ js/
│  ├─ supabase.js          # client 단일 인스턴스
│  ├─ config.local.js      # SUPABASE_URL/KEY, OWNER_PASSPHRASE (gitignore)
│  ├─ router.js            # path 파싱, deck_id 추출, mobile redirect
│  ├─ repo/
│  │  ├─ deck-repo.js
│  │  ├─ slide-repo.js     # CRUD + reorder transaction
│  │  ├─ notes-repo.js
│  │  └─ history-repo.js   # auto/manual insert, list, rollback
│  ├─ slide-runtime.js     # nav/scroll/fragment/intersection
│  ├─ inline-editor.js     # contenteditable 토글, debounce 저장
│  ├─ notes-panel.js       # SpeakerNotes 포팅
│  ├─ script-view.js       # teleprompter
│  ├─ sync.js              # Supabase broadcast wrapper
│  ├─ auth.js              # passphrase gate
│  ├─ history-ui.js        # 타임라인/diff/rollback UI
│  ├─ export.js            # HTML/PDF/Marp export
│  └─ i18n.js              # ko 문자열 모음
├─ migrations/
│  ├─ 001_init.sql
│  └─ 002_history.sql
├─ scripts/
│  ├─ import-v4-slides.mjs # personal-log/v4/slides.html → slides rows
│  ├─ import-v5-script.mjs # personal-log/v5/script-data.js → notes rows
│  └─ export-pdf.mjs       # Playwright 기반 고품질 PDF (옵션)
├─ public/
│  └─ images/              # gdg_logo, 기타 자산 (외부 호스팅 권장)
├─ vercel.json
├─ SPEC.md
├─ PLAN.md
└─ README.md
```

---

## 2. 마일스톤

| ID | 목표 | 산출물 | 예상 |
|---|---|---|---|
| **M0** | 셋업 | Supabase 프로젝트, 마이그레이션 적용, 시드 덱 1개, `npm`/`vercel` 없이도 로컬에서 `python -m http.server`로 동작 | 0.5d |
| **M1** | 슬라이드 read + present | deck/slides 로드 → 렌더, `present.html` 동작 (키보드/휠/스냅/fragment) | 1d |
| **M2** | 스크립트 read + sync | `script.html` 포팅, Realtime broadcast 양방향 | 0.5d |
| **M3** | 슬라이드 inline edit | `edit.html`, 자동 저장, 추가/삭제/순서, frame_html 편집기 | 1.5d |
| **M4** | 노트 편집 | 사이드패널 + 모바일 풀스크린 + 자동 저장 | 0.5d |
| **M5** | 히스토리/롤백 | auto row 적재, manual 스냅샷, 타임라인 + diff, 롤백 | 1d |
| **M6** | Export | HTML/PDF export, Marp 노트 뷰, print CSS | 1d |
| **M7** | 공유 + 권한 | passphrase 게이트, share_token rotate, `/view` 뷰 | 0.5d |
| **M8** | 데이터 마이그레이션 | v4 슬라이드, v5 스크립트를 시드 덱으로 import | 0.5d |
| **M9** | 폴리시 | 단축키 도움말, sanitize, 다크모드 잠금, 배포, README | 0.5d |

총 ≈ **7 days** of focused work.

---

## 3. 마일스톤별 태스크

### M0 — 셋업
- [ ] Supabase 프로젝트 생성, project ref / anon key 발급
- [ ] `migrations/001_init.sql` 작성 → decks/slides/notes 테이블 + 인덱스 + deferrable unique
- [ ] `migrations/002_history.sql` 작성 → slide_history/notes_history + kind enum
- [ ] `js/supabase.js`: createClient 단일 인스턴스
- [ ] `js/config.local.js.example` + `.gitignore`
- [ ] `vercel.json`: static + `Cache-Control` 설정
- [ ] `index.html` 더미 + Hello world 렌더 확인
- [ ] **검증**: 로컬에서 `python -m http.server 8000` → `http://localhost:8000` 띄우고 콘솔에서 `supabase.from('decks').select()` 빈 배열 확인

### M1 — 슬라이드 read + present
- [ ] `repo/deck-repo.js`: `getDeck(id)`, `getDeckWithSlides(id)`
- [ ] `repo/slide-repo.js`: `listByDeck(id) order by order asc`
- [ ] `slide-runtime.js`: v4 `SlidePresentation` 포팅 (DOM 입력은 `<main>` placeholder를 frame_html에 주입 후 슬라이드 append)
- [ ] `present.html`: deck 로드 → frame_html을 `document.documentElement.innerHTML` 일부로 주입 → 슬라이드 append → runtime 시작
- [ ] `?sync=R` 있으면 `sync.broadcast(index)` 호출
- [ ] **검증**: 시드 덱 2~3장 직접 INSERT 후 키보드 nav, fragment, 모바일 swipe 동작

### M2 — 스크립트 read + sync
- [ ] `script-view.js`: v5 인라인 스크립트를 모듈로 분리, active/adj 하이라이트, 폰트 +/-, HL 토글
- [ ] `script.html`: deck 로드 → slides의 title을 헤딩으로, notes.content를 본문으로 렌더
- [ ] `sync.js`: 채널명 `slides-editor-sync-<R>`, payload `{ section_id, index }`
- [ ] **검증**: 두 탭 — `present.html?sync=R`에서 `→` 누르면 `script.html?sync=R` 자동 추적

### M3 — 슬라이드 inline edit (핵심)
- [ ] `auth.js`: passphrase 검사 + localStorage `slides-editor:token`
- [ ] `inline-editor.js`: `data-editable` 노드에 contenteditable 토글, `ensureEditIds` 알고리즘 포팅
- [ ] `input` 이벤트 → debounce(800ms) → 현재 슬라이드의 `<section>` 직렬화 → `slide-repo.upsert`
- [ ] 좌측 썸네일 리스트 (slides.title), 클릭 시 캔버스 전환
- [ ] "+ Slide" 버튼 → section_id=ULID, order=max+1, 기본 템플릿 insert
- [ ] 우클릭/⌘+⌫ → confirm 후 delete
- [ ] DnD 순서 변경 → 트랜잭션 reorder
- [ ] frame_html 편집 모달 (plain textarea, `<!-- slides -->` placeholder 강제)
- [ ] **검증**: 편집 → 새로고침 → 변경 유지, 다른 탭의 present.html도 새로고침 시 반영

### M4 — 노트 편집
- [ ] `notes-panel.js`: v4 `SpeakerNotes` 포팅, 저장처를 notes 테이블로
- [ ] script.html에 `?mode=edit` 추가 (데스크톱 기본)
- [ ] 좌 섹션 리스트 + 우 textarea + 미리보기 (`marked` esm)
- [ ] 자동 저장 + 모바일 풀스크린 진입 동작
- [ ] **검증**: edit/read 모드 토글

### M5 — 히스토리/롤백
- [ ] `history-repo.js`: `appendAuto(deck, section, kind, content)`, `appendManual(deck, message, snapshot[])`, `list(deck)`, `getDiff(rowId)`
- [ ] 자동 적재 hook: slide-repo/notes-repo upsert 직후 호출 (동일 content면 skip)
- [ ] "Save version" 모달 (message 입력)
- [ ] `history-ui.js`: 타임라인 사이드 패널, diff 미리보기 (단순 line diff)
- [ ] 롤백: 단일 섹션 / 전체 manual snapshot
- [ ] **검증**: 10번 편집 → 자동 row 10개, "Save version" 1회 → manual row 1개, 롤백 후 화면 일치

### M6 — Export (HTML / PDF / Marp)
- [ ] `js/export.js`:
  - `exportHtml(deckId)` → frame_html에 slides join, edit 속성 strip, Blob download
  - `exportPdf(deckId)` → 새 창 `present.html?deck=…&print=1` 열고 `window.print()` 호출
  - `exportNotesMd(deckId)` → slides+notes join, `## title\n\nbody\n\n---\n` 포맷, Blob/clipboard
- [ ] `css/slide-runtime.css`에 `@media print` 룰 추가: `@page { size: 1280px 720px; margin: 0; }`, header/footer 숨김, 슬라이드별 page-break
- [ ] `present.html`의 `?print=1` 모드: scroll-snap 해제, 모든 슬라이드를 vertical stack으로, 모든 `.fragment` `display: block`
- [ ] `edit.html` 툴바에 [Export ▼] 드롭다운 추가 (HTML / PDF)
- [ ] `notes.html` 신규 페이지: deck 로드 → slides+notes join → `<pre>` 안 plain text 렌더, [Copy] / [Download .md] 액션
- [ ] `script.html` 툴바에 [View as Marp] 링크
- [ ] (옵션) `scripts/export-pdf.mjs`: Playwright headless로 `?print=1` 페이지 캡처
- [ ] **검증**:
  - HTML export 결과를 personal-log/v4/slides.html과 시각 비교, 외부 의존 없이 단독 동작
  - PDF export → Chrome/Safari 인쇄 다이얼로그에서 슬라이드별 1페이지 확인
  - Marp export 결과를 `marp <file>` 로 변환해 v5/script.md와 형식 일치 확인

### M7 — 공유 + 권한
- [ ] passphrase 게이트: edit/present 진입 시 미인증이면 모달
- [ ] `share_token` 발급/rotate 버튼 (edit 툴바)
- [ ] `view.html`: `?token=` 검증, slides만 렌더, notes 숨김, edit UI 미주입
- [ ] DOMPurify로 view 측 sanitize
- [ ] **검증**: token 없이 view 접근 → 403, token rotate 시 이전 링크 무효

### M8 — 데이터 마이그레이션
- [ ] `scripts/import-v4-slides.mjs`: HTML → DOMParser → `<section.slide>` 단위 추출 → frame_html(=section을 placeholder로 치환한 잔여물) + slides rows
- [ ] `scripts/import-v5-script.mjs`: `script-data.js`의 `scripts[]` 배열 → 인덱스 매핑 → `notes` rows (slides의 order로 join)
- [ ] 둘 다 `--dry-run` 옵션, idempotent
- [ ] **검증**: v4 deck import 후 `/present/:id`로 띄워 원본 slides.html과 시각 비교

### M9 — 폴리시
- [ ] 단축키 도움말 모달 (`?` 키)
- [ ] view 모드 sanitize 검증
- [ ] README.md (셋업, 마이그레이션, 단축키)
- [ ] Vercel 배포, env vars 등록
- [ ] **검증**: 배포 URL에서 시드 덱 발표 모드 끝까지 시연

---

## 4. 데이터 마이그레이션 전략 (M8 상세)

### v4 슬라이드 → DB
```
v4/slides.html
  ├─ <html>…</html> 통째로 frame_html 후보
  │   - <body>의 <main> 안 모든 <section.slide>를 제거
  │   - 빈자리에 <!-- slides --> placeholder 삽입
  │   - 결과를 decks.frame_html 로 저장
  └─ 각 <section.slide>
      - data-title → slides.title
      - data-edit-id 첫 노드의 ID 또는 slug(title) → section_id
      - order = 등장 순서
      - outerHTML → slides.content
```

### v5 스크립트 → DB
```
v5/script-data.js
  ├─ scripts[] 배열
  └─ 각 i 번째 string
      - 첫 `## …` 라인을 제외한 본문 → notes.content
      - section_id = slides 테이블의 order=i 행의 section_id (조회 후 join)
      - 슬라이드 수와 스크립트 수가 다를 수 있음 — mismatch report 출력
```

import 스크립트는 Node 18+ + `@supabase/supabase-js`. 단발성이므로 deps는 `npx` 사용.

---

## 5. 리스크 / 오픈 결정

| # | 리스크 | 대응 |
|---|---|---|
| R1 | history 무한 증가 | M5에서 섹션당 자동 row 200개 cap. Supabase scheduled function으로 주기 정리 |
| R2 | frame_html 편집 실수로 placeholder 누락 → 렌더 깨짐 | 저장 시 `<!-- slides -->` 존재 검증, 없으면 자동 삽입 |
| R3 | passphrase 단일키의 한계 | M6 안정화 후 Supabase Auth(magic link) 도입 검토 |
| R4 | Supabase free tier Realtime 메시지 한도 | broadcast self:false 유지, throttle 200ms |
| R5 | inline contenteditable의 형식 누락 (붙여넣기로 inline style 깨짐) | paste 이벤트에서 plain text 강제 옵션 (속성패널에서 토글) |
| R6 | `getdesign/` 폴더 활용 방향 미정 | M9 이후 별도 "deck 템플릿" 기능으로 확장 검토 |
| R7 | 브라우저 인쇄 PDF의 폰트/레이아웃 깨짐 | `@page` 크기 고정 + Plex 웹폰트 preload, 안 풀리면 M6 후반에 Playwright CLI 경로 우선화 |

---

## 6. 마일스톤 외 / 후순위

- Supabase Auth(magic link) 전환
- PDF/PPTX export
- 슬라이드 컴포넌트 라이브러리 (drag&drop 빌더)
- 다국어 (en)
- 협업 편집 (CRDT) — 본 SPEC 비목표
- 이미지 호스팅 (Supabase Storage 또는 R2 연동)

