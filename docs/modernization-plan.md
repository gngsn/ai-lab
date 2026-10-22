# Speakeasy 현대화 실행 계획

> 이 문서는 **실행용 지시서**다. 사람 또는 AI 모델이 위에서부터 순서대로 따라 하면 된다.
> 목표는 **동작을 하나도 바꾸지 않고** 코드를 유지보수하기 쉬운 구조로 옮기는 것이다.
> 기능 목록은 `docs/function.md`, 코드는 `speakeasy/`에 있다.
>
> 작성 기준: 브랜치 `feat/slides-editor`, 커밋 `adb20ee` 시점의 코드.

---

## 0. 실행자가 반드시 지킬 규칙 (먼저 읽을 것)

### 0.1 절대 하지 말 것

1. **동작을 바꾸지 마라.** 버그로 보이는 것도 고치지 마라. 발견하면 `docs/modernization-notes.md`에 적고 넘어가라.
2. **§2의 호환 목록에 있는 값(URL, 쿼리 파라미터, localStorage 키, 채널 이름, postMessage 타입, DB 테이블·컬럼, 버킷 이름)을 바꾸지 마라.** 이름이 마음에 안 들어도 그대로 둔다.
3. **덱 실행 엔진(§3.2의 "런타임 파일")의 동작 로직을 고치지 마라.** 이 파일들은 Phase 1~3 동안 위치만 옮기고 내용은 그대로다.
4. **`git add -A`, `git add .`, `git commit -a`를 쓰지 마라.** 이 저장소에는 다른 사람의 미커밋 변경이 있다. 항상 파일 경로를 하나씩 지정해서 `git add <path>` 한다.
5. **`speakeasy/` 밖의 파일을 고치거나 지우지 마라.** 예외: `docs/modernization-notes.md`, `docs/modernization-plan.md`(진행 표시만).
6. **비밀 값을 코드나 `VITE_*` 환경변수에 넣지 마라.** `VITE_*` 값은 빌드 결과물(공개 JS)에 그대로 들어간다. 공개되어도 되는 값은 `SUPABASE_URL`, `SUPABASE_ANON_KEY`뿐이다. `OWNER_PASSPHRASE`는 현재도 공개되는 값이라 예외적으로 허용한다(§2.8). `GITHUB_TOKEN`, `OPENAI_API_KEY`, `ELEVENLABS_API_KEY`는 **절대** 빌드에 넣지 않는다.
7. **`git push --force`, `git reset --hard`, `git stash`(이름 없는 것), `rm -rf`를 쓰지 마라.**
8. **운영 DB(Supabase)에 직접 SQL을 실행하거나 `supabase db push`를 실행하지 마라.** DB 작업은 사람이 한다(§0.3).
9. **`vercel deploy --prod`를 실행하지 마라.** 배포는 사람이 한다.
10. **패키지 도구는 pnpm만 쓴다.** `npm`, `npx`, `yarn`을 쓰지 마라. 설치는 `pnpm add` / `pnpm add -D`, 실행은 `pnpm <script>` / `pnpm exec <bin>`, 일회성 도구는 `pnpm dlx <pkg>`. 잠금 파일은 `pnpm-lock.yaml` 하나만 둔다.
11. 테스트가 실패하면 **테스트를 고쳐서 통과시키지 마라.** 앱 코드가 원래 동작과 같아지도록 고친다. 테스트 자체가 틀렸다고 확신할 때만 고치고, 그 이유를 커밋 메시지에 적는다.

### 0.2 작업 단위

- 이 문서의 **태스크 하나 = 커밋 하나**다. 태스크 번호(예: `P0-3`)를 커밋 제목에 넣는다.
  - 예: `test(speakeasy): P0-3 e2e for live follow`
- 태스크를 끝내기 전에 그 태스크의 **"완료 조건"을 전부** 실행하고 통과시킨다.
- 끝낸 태스크는 이 문서의 체크박스를 `[x]`로 바꾸고, 같은 커밋에 넣는다.
- 커밋 메시지 끝에는 이 저장소의 공동 작성자 줄 규칙을 따른다.

### 0.3 멈추고 사람에게 물어볼 때 (STOP)

다음 상황에서는 **진행을 멈추고**, 무엇을 하려 했는지와 왜 멈췄는지를 사람에게 보고한다.

- 비밀 값, 로그인, API 키, Supabase 대시보드나 Vercel 설정이 필요할 때
- 운영 DB에 접근해야 할 때(마이그레이션 적용, 타입 생성 등)
- 같은 테스트가 3번 고쳐도 계속 실패할 때
- 이 문서와 실제 코드가 달라서 지시를 그대로 따를 수 없을 때
- 호환 목록(§2)의 값을 바꿔야만 진행할 수 있을 것 같을 때
- 태스크 범위 밖의 파일을 고쳐야 할 것 같을 때

---

## 1. 목표와 범위

### 1.1 목표

- **동작 동일:** 사용자가 보는 화면, URL, 저장된 데이터, 공유 링크가 전부 그대로다.
- **유지보수:** 타입(TypeScript), 테스트(Vitest, Playwright), 빌드(Vite), 컴포넌트(React)로 관리한다.
- **점진 이전:** 한 번에 다시 만들지 않는다. 앱은 모든 단계에서 동작하고 배포 가능하다.

### 1.2 하지 않는 것

- 기능 추가, UI 디자인 변경, 문구 변경
- 인증 방식 변경(패스프레이즈 → 로그인). 이건 Phase 5(선택)이며 별도 승인이 필요하다.
- 덱 실행 엔진 재작성(§3.2)
- 헥사고날, 포트·어댑터 같은 다층 구조. 예전 시도(`slideflow`)가 이 구조로 기존 기능을 따라잡지 못하고 중단되었다. 단순한 기능별 폴더를 쓴다(§4.2).

---

## 2. 호환 목록 (바꾸면 안 되는 값)

모든 값은 코드에서 그대로 복사한 것이다. **글자 하나도 바꾸지 않는다.**

### 2.1 페이지 URL

`cleanUrls: true`라서 `/edit.html`은 `/edit`으로 308 리다이렉트된다. 두 형태가 모두 동작해야 한다.

| 페이지 | 용도 | 주요 쿼리 |
|---|---|---|
| `/index.html` | 덱 목록·가져오기 | — |
| `/edit.html` | 슬라이드 편집 | `deck` |
| `/edit-frame.html` | 편집 캔버스 iframe(내부용) | `deck`, `edit` |
| `/present.html` | 발표자 화면(대본 패널) | `deck`, `sync`, `section`, `slide`, `print`, `nofallback` |
| `/view.html` | 공개 읽기 전용 화면 | `deck`, `token`, `nofallback` |
| `/share.html` | 관객 화면(발표자 따라가기) | `deck`, `token`, `sync` |
| `/script.html` | 대본 리더 | `deck`, `sync` |
| `/script-edit.html` | 전체 노트 편집 | `deck` |
| `/notes.html` | 노트 Markdown 보기 | `deck` |
| `/pronunciation.html` | 발음 연습 | `deck` |
| `/captions.html` | 실시간 자막 콘솔 | `deck`, `sync` |

`/present/<deck_id>`, `/script/<deck_id>` 경로 형태도 코드가 지원한다(`location.pathname` 매칭). 유지한다.

### 2.2 localStorage 키

```
speakeasy:auth:token
speakeasy:github-token
speakeasy:notes:fontsize
speakeasy:present:fontsize
speakeasy:present:panel-width
speakeasy:present:panel-hidden
speakeasy:captions:on
speakeasy:captions:script:<deckId>
speakeasy:edit:collapsed:<id>          (예: speakeasy:edit:collapsed:training)
speakeasy:preview-click
slidesEditor.notesFontSize
slidesEditor.slideListWidth
slidesEditor.propsPanelWidth
slidesEditor.propsPanelHeight
slides-editor:auth:token               (옛 이름, 읽은 뒤 새 키로 옮김)
slides-editor:notes:fontsize           (옛 이름, 읽은 뒤 새 키로 옮김)
```

IndexedDB: 데이터베이스 이름 `pronunciation-cache`, 버전 `3`.

### 2.3 실시간 채널 (Supabase Realtime broadcast)

| 채널 이름 | 이벤트 | payload |
|---|---|---|
| `speakeasy-sync-<room>` | `slide` | `{ section_id, index, fragments, stepper }` |
| `speakeasy-sync-<room>` | `hello` | `{}` (늦게 들어온 쪽이 현재 상태 요청) |
| `speakeasy-captions-<room>` | `caption` | `{ en, ko, mt }` |

`<room>`은 `?sync=` 값이다. 기본값은 덱 ID다(`js/sync-room.js`의 `syncRoomFor(deckId)`).

### 2.4 postMessage 타입

```
se:slide                                    (present 슬라이드 iframe → 발표자 패널)
edit:ready  edit:dirty  edit:save  edit:flush  edit:noop
edit:set-autosave  edit:insert-asset  edit:insert-image  edit:insert-svg
edit:preview-fallback  edit:preview-back
edit-frame:data  edit-frame:request-data  edit-frame:error
```

### 2.5 DB (Supabase Postgres)

- 테이블: `decks`, `slides`, `notes`, `slide_history`, `notes_history`, `frame_history`
- RPC: `reorder_slides`, `delete_deck`, `rename_asset_references`
- Storage 버킷: `slides-images`, `slides-audio`
- 스키마 정의: `speakeasy/migrations/001_init.sql` ~ `010_key_message.sql`. **이 파일들의 내용은 바꾸지 않는다.**

### 2.6 window 전역 값

- **설정값(`config.local.js`가 설정):** `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `OWNER_PASSPHRASE`, `GITHUB_TOKEN`(로컬 전용), `OPENAI_API_KEY`, `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID`, `KOKORO_TTS_URL`, `KOKORO_TTS_MODEL`, `KOKORO_VOICE`, `MLX_STT_URL`, `MLX_STT_MODEL`, `PRONUNCIATION_TTS`, `PRONUNCIATION_STT`
- **런타임 값:** `__SE_SHARE`(share.html이 설정), `__seDeckController`(deck-host가 덱 컨트롤러를 잡아 둠), `__seCaptions`(테스트용 feed)

### 2.7 덱 HTML 규칙

- 덱은 `decks.frame_html` + `slides.content`(슬라이드 하나 = `<section>` 하나)로 저장된다.
- 발표 시 `frame_html`의 `<!-- slides -->` 자리에 슬라이드들을 끼워 넣고, `document.open()/write()/close()`로 페이지를 통째로 바꾼다.
- 표시 전에 `tagSection()`이 `data-section-id`와 `class="slide"`를 붙이고, 저장된 재생 상태(섹션의 `visible`, fragment의 `show`)를 지운다(`js/slide-render.js`).
- 덱에 자체 `SlidePresentation` 클래스가 있으면 deck-host가 그 인스턴스를 가로채 쓰고("deck 모드"), 없으면 Speakeasy 런타임을 쓴다("speakeasy 모드").

### 2.8 인증

- 현재 인증은 **클라이언트 패스프레이즈**다(`js/auth.js`). `window.OWNER_PASSPHRASE`와 입력값이 같으면 `speakeasy:auth:token`에 저장한다.
- 모든 소유자 페이지는 `if (!(await ensureAuthed()))`로 막는다. **`await`를 빠뜨리면 인증 우회 버그가 생긴다.** 실제로 있었던 버그다.
- Phase 0~4에서는 이 방식을 그대로 유지한다.

---

## 3. 현재 구조

### 3.1 파일과 규모 (`speakeasy/`)

| 영역 | 파일 | 줄 수(대략) |
|---|---|---|
| 편집 | `edit.html`, `js/edit-bootstrap.js` | 2,250 + 2,700 |
| 덱 목록 | `index.html` (인라인 모듈) | 1,380 |
| 발음 연습 | `pronunciation.html`, `js/pronunciation.js`, `js/training-panel.js` | 500 + 360 + 1,190 |
| 대본 | `script.html`, `js/script-view.js` | 360 + 180 |
| 노트 편집 | `script-edit.html`, `js/script-edit-view.js` | 430 + 200 |
| 노트 보기 | `notes.html` | 280 |
| 자막 | `captions.html`, `js/captions/*` | 140 + 600 |
| 발표·공유 런타임 | §3.2 참고 | 약 2,000 |
| 데이터 | `js/supabase.js`, `js/repo/*.js` | 약 700 |
| DB | `migrations/*.sql` | — |

설정: 빌드 시 `scripts/build-config.mjs`가 환경변수로 `js/config.local.js`(공개 파일)를 만든다. 로컬에서는 이 파일을 손으로 관리한다(gitignore).

외부 라이브러리는 `vendor/`에 복사되어 있다: `modules/supabase-client.mjs`(esbuild로 묶음, `scripts/build-vendor-modules.mjs`), `codemirror/`, `highlight.js/`, `pptxgenjs/`, `fonts/`.

### 3.2 런타임 파일 (내용을 바꾸지 말 것)

다음 파일들은 **문자열 URL로 실행 중에 불러온다.** 그래서 Vite가 번들링할 수 없다.

- `js/letterbox.js`: `data-boot`, `data-panel` 속성 값으로 모듈을 불러온다.
- `js/present-bootstrap.js`, `js/view-bootstrap.js`: `document.write`하는 HTML 안에 `./js/deck-host.js`, `./js/sync.js`, `./js/shortcuts-help.js`, `./js/captions/audience.js`의 URL을 문자열로 넣는다.

런타임 파일 목록:

```
present.html  view.html  share.html  edit-frame.html
js/letterbox.js  js/present-bootstrap.js  js/view-bootstrap.js
js/deck-host.js  js/slide-runtime.js  js/slide-render.js  js/slide-fit.js
js/sync.js  js/sync-room.js  js/preload-assets.js  js/storage-src.js
js/slide-visibility.js  js/shortcuts-help.js  css/shortcuts-help.css
js/edit-frame-bootstrap.js  js/edit-frame-overlay.js  js/inline-editor.js
js/presenter-panel.js  js/captions/audience.js  js/captions/channel.js
sync.js   (루트. 덱이 자체적으로 import("./sync.js") 하는 것을 받아 주는 빈 모듈)
```

**규칙:** 이 파일들은 Phase 4가 끝날 때까지 `public/` 아래에서 **같은 URL**로 제공한다. 타입 검사는 JSDoc 주석과 `// @ts-check`로만 추가한다. 그 경우에도 실행 코드는 한 줄도 바꾸지 않는다.

---

## 4. 목표 구조

### 4.1 기술 스택 (확정)

| 영역 | 선택 | 메모 |
|---|---|---|
| 빌드·개발 서버 | Vite 6 (multi-page) | `vite build` → `dist/` |
| 언어 | TypeScript 5 (`strict: true`) | 새 코드만 TS. 런타임 파일은 JS + JSDoc |
| UI | React 19 | 앱 화면만(§4.3). 런타임 페이지는 React 금지 |
| 서버 상태 | TanStack Query 5 | 로딩, 저장, 재시도 |
| DB 클라이언트 | `@supabase/supabase-js` 2 | `src/data/`에서만 import |
| DB 마이그레이션 | Supabase CLI | 적용은 사람이 한다(§0.1-8) |
| 단위 테스트 | Vitest | 순수 함수 |
| 화면 테스트 | Playwright | 가짜 백엔드(§5.2) |
| 린트·포맷 | Biome | `src/`, `tests/`만 대상. `public/`은 제외 |
| 배포 | Vercel (정적) | `outputDirectory: dist` |
| 패키지 관리 | **pnpm** (9 이상) | `package.json`의 `packageManager` 필드로 버전 고정. Vercel은 `pnpm-lock.yaml`을 보고 pnpm을 자동으로 쓴다 |

라이브러리를 추가로 넣지 않는다. 필요해 보이면 STOP(§0.3).

### 4.2 폴더 구조 (최종)

```
speakeasy/
  index.html  edit.html  ...         # Vite 진입 HTML (React로 옮긴 페이지만)
  public/                            # 그대로 복사되는 레거시 정적 파일 (URL 유지)
    present.html view.html share.html edit-frame.html
    js/  css/  vendor/  sync.js
  src/
    pages/<page>/main.tsx            # 페이지 진입점 (얇게)
    features/
      deck-list/ editor/ script/ script-edit/ notes/
      pronunciation/ captions/
    data/                            # supabase 클라이언트, DB 타입, 테이블별 함수
      client.ts  types.ts  decks.ts  slides.ts  notes.ts  history.ts  storage.ts
    lib/                             # 순수 함수 (DOM, 네트워크 없음)
      markdown-lite.ts  import-html.ts  slide-visibility.ts  ...
    config.ts                        # import.meta.env 읽기
  tests/
    e2e/                             # Playwright
    fixtures/                        # 테스트용 덱, 노트
    fake-backend/                    # 가짜 Supabase (§5.2)
  supabase/migrations/               # Supabase CLI 형식 (Phase 1)
  migrations/                        # 원본 SQL (지우지 않음. 참고용)
```

**import 규칙**
- `@supabase/supabase-js`는 `src/data/` 안에서만 import한다.
- `src/lib/`는 DOM이나 네트워크를 쓰지 않는다.
- React 코드는 `public/`의 파일을 import하지 않는다. 런타임과는 URL과 postMessage로만 소통한다.

### 4.3 페이지별 최종 형태

| 페이지 | 최종 형태 |
|---|---|
| index, edit, script, script-edit, notes, pronunciation, captions | React + TS (Vite 진입점) |
| present, view, share, edit-frame | 레거시 JS 그대로 (`public/`) |

edit은 캔버스로 `edit-frame.html`(레거시)을 iframe으로 띄우고 postMessage(§2.4)로 소통한다. 이 경계를 그대로 유지한다.

---

## 5. Phase 0: 동작을 테스트로 고정하기

**목적:** 이후 모든 단계에서 "동작이 같다"를 이 테스트로 증명한다. **Phase 0이 끝나기 전에는 앱 코드를 한 줄도 바꾸지 않는다.** (P0-0의 패키지 도구 교체는 앱 코드가 아니므로 예외)

- [x] **P0-0 pnpm으로 전환 (가장 먼저)**
  1. `corepack enable`로 pnpm을 켠다. 안 되면 STOP. 전역 설치는 사람이 한다.
  2. `speakeasy/`에서 `pnpm import`를 실행해 `package-lock.json`으로 `pnpm-lock.yaml`을 만든다. 버전이 그대로 유지된다.
  3. `git rm speakeasy/package-lock.json`
  4. `package.json`에 `"packageManager": "pnpm@<설치된 버전>"`를 추가한다. 버전은 `pnpm --version`의 출력을 그대로 쓴다.
  5. `package.json` scripts의 `npm`/`npx`를 pnpm으로 바꾼다. 예: `"dev"`는 그대로 두고, 앞으로 추가하는 스크립트는 `pnpm`을 쓴다.
  6. 테스트 도구를 설치한다: `pnpm add -D @playwright/test vitest http-server`, 그리고 `pnpm exec playwright install chromium`
  7. **주의:** 저장소 루트(`../package-lock.json`)는 speakeasy와 별개다. 건드리지 않는다.
  8. pnpm 10 이상은 의존성의 설치 스크립트를 기본으로 막는다. esbuild는 설치 스크립트로 바이너리를 받으므로 `speakeasy/pnpm-workspace.yaml`에 `allowBuilds: { esbuild: true }`가 있어야 한다(완료됨). 다른 패키지가 막혔다는 경고가 나오면 함부로 허용하지 말고 STOP.
  - 완료 조건: `pnpm install --frozen-lockfile` 성공, `pnpm run build:vendor`로 다시 만든 `vendor/modules/supabase-client.mjs`의 `git diff`가 비어 있음(의존성 버전이 바뀌지 않았다는 확인)

### 5.1 테스트 실행 방식

- 테스트 대상: 현재 `speakeasy/` 폴더를 **그대로** 정적 서버로 띄운 앱
  - 서버: `pnpm exec http-server speakeasy -p 4173 -c-1 --silent` (`-c-1`은 캐시 끄기)
  - 이유: 캐시가 켜져 있으면 예전 JS가 실행되어 테스트가 엉뚱하게 실패하거나 통과한다. 실제로 겪은 문제다.
- 설정 파일: `js/config.local.js`는 **실제 파일을 쓰지 않는다.** 테스트는 Playwright `page.route('**/js/config.local.js', ...)`로 다음 내용을 돌려준다.
  ```js
  window.SUPABASE_URL="https://fake.supabase.test";window.SUPABASE_ANON_KEY="fake";window.OWNER_PASSPHRASE="test";
  ```
- 소유자 페이지는 `localStorage.setItem("speakeasy:auth:token","test")`를 먼저 하고 연다. 인증 테스트만 예외다.
- 모든 Playwright 페이지는 **같은 browser context**에서 연다. 가짜 실시간 채널이 BroadcastChannel이라 같은 context여야 서로 통신한다.

### 5.2 가짜 백엔드 (`tests/fake-backend/`)

앱은 Supabase 클라이언트를 `vendor/modules/supabase-client.mjs`의 `createClient`로 만든다(`js/supabase.js`, `js/sync.js`, `js/captions/channel.js`). 테스트에서는 **이 URL을 `page.route`로 가로채** 가짜 모듈을 돌려준다. 앱 파일은 바꾸지 않는다.

가짜 모듈이 지원해야 하는 것(앱이 실제로 쓰는 것만):

- `createClient()` → `{ from, rpc, storage, channel, removeChannel }`
- `from(table)` 쿼리 빌더:
  - `select`, `eq`, `order`, `limit`, `single`, `maybeSingle`, `insert`, `update`, `upsert`(onConflict 병합), `delete`
  - `then`으로 `{ data, error }`를 돌려줌
- `rpc(name, args)`: `reorder_slides`, `delete_deck`, `rename_asset_references`
- `storage.from(bucket)`: `list`, `upload`, `remove`, `getPublicUrl`
- `channel(name, opts)` → `on("broadcast", {event}, cb)`, `subscribe(cb)`(50ms 뒤 `"SUBSCRIBED"`), `send({type, event, payload})`
  - 구현: `new BroadcastChannel(name)`
- 데이터 저장: 테스트가 주입한 fixture JSON을 메모리에 들고, 쓰기는 `localStorage.__fakedb`에 저장한다. 그래야 페이지를 이동해도 남는다.
  - **주의:** 편집 페이지는 페이지를 떠날 때 슬라이드를 다시 저장한다. fixture는 `index.html`에서 주입한 뒤 다른 페이지로 이동한다.

시작점으로 쓸 최소 구현(읽기와 채널만 있음. 쓰기는 직접 추가할 것):

```js
// tests/fake-backend/supabase-client.mjs
const db = JSON.parse(localStorage.getItem("__fakedb") || "null") || window.__FAKE_SEED__;
const save = () => localStorage.setItem("__fakedb", JSON.stringify(db));
function query(table) {
  const f = []; let single = false;
  const b = {
    select() { return b; }, eq(k, v) { f.push([k, v]); return b; },
    order() { return b; }, limit() { return b; },
    single() { single = true; return b; }, maybeSingle() { single = true; return b; },
    then(res, rej) {
      let d = (db[table] || []).filter((r) => f.every(([k, v]) => r[k] === v));
      if (table === "slides") d.sort((a, b) => a.order - b.order);
      if (single) d = d[0] ?? null;
      return Promise.resolve({ data: d, error: null }).then(res, rej);
    },
  };
  return b;
}
export function createClient() {
  return {
    from: query,
    storage: { from: () => ({ getPublicUrl: (p) => ({ data: { publicUrl: p } }) }) },
    channel(name) {
      const bc = new BroadcastChannel(name); const hs = [];
      bc.onmessage = (e) => hs.filter((h) => h.event === e.data.event).forEach((h) => h.cb({ payload: e.data.payload }));
      const ch = {
        on(_t, { event }, cb) { hs.push({ event, cb }); return ch; },
        subscribe(cb) { setTimeout(() => cb?.("SUBSCRIBED"), 50); return ch; },
        send({ event, payload }) { bc.postMessage({ event, payload }); return Promise.resolve("ok"); },
      };
      return ch;
    },
    removeChannel() {},
  };
}
```

### 5.3 테스트용 덱 (`tests/fixtures/`)

실제 발표 덱을 쓰지 말고, 작은 합성 덱 두 개를 만든다.

1. **`controller-deck`(deck 모드):** 슬라이드 6장
   - 자체 `class SlidePresentation`이 있다: `next()`, `prev()`, `goTo()`, `currentSlide`, `slides`, `slidechange` 이벤트, `main`에 `translateY` 이동, `.slide.visible .reveal` 전환.
   - 3번 슬라이드에 `.fragment` 2개, 4번 슬라이드에 `data-fragment-group`으로 묶인 fragment 2개.
   - 슬라이드 하나의 HTML에 `class="slide visible"`과 `class="fragment show"`를 **일부러 저장**해 둔다(재생 상태 제거 확인용).
   - 각 슬라이드에 `data-title`.
2. **`plain-deck`(speakeasy 모드):** 컨트롤러 없는 `<section>` 4장, fragment 1개
3. 노트: 각 슬라이드에 한국어 대본 2~3줄, `(클릭)` 표시, 한 슬라이드에는 `key_message`
4. `share_token: "tok"`
5. 2개 언어 자막 대본(`.md`): 한국어 줄 아래 `> English` 줄

### 5.4 테스트 시나리오 (전부 작성)

각 항목이 테스트 파일 하나다. "기대"를 그대로 단언(assert)한다.

- [x] **P0-1 인증 차단:** 소유자 페이지 8곳(index, edit, script, script-edit, notes, pronunciation, present, captions)에서 각각 확인한다.
  - 토큰 없이 열고 패스프레이즈 모달에서 취소 버튼, Esc, 바깥 클릭, 틀린 암호를 해 본다.
  - 기대: 페이지 내용이 열리지 않는다. 본문에 `denied`가 보이거나, edit은 `auth failed`가 보인다.
  - 맞는 암호(`test`)를 넣으면 열린다.
  - 모달 DOM: `#__se_prompt_input`, `#__se_prompt_ok`, `#__se_prompt_cancel`. `alert`는 자동 수락한다. present는 모달이 iframe(`#__se_letterbox`) 안에 뜬다.
- [x] **P0-2 덱 목록:** 목록에 fixture 덱이 보이고 편집, 발표, 대본 링크가 올바른 URL이다.
- [x] **P0-3 발표 기본(deck 모드):** `present.html?deck=controller-deck`에서 → 키를 누른다.
  - 기대: `__seDeckController.currentSlide`가 증가한다. fragment는 하나씩 `show`가 붙는다. 그룹 fragment는 한 번에 붙는다. ← 키로 되돌린다.
- [x] **P0-4 발표 기본(speakeasy 모드):** `plain-deck`에서 같은 동작. 오버레이 카운터 `#__se_counter`가 `n / total`이다.
- [x] **P0-5 재생 상태 제거:** 저장된 `visible`/`show`가 있어도 시작 시 `.slide.visible`은 첫 슬라이드 1개뿐이고 `.fragment.show`는 0개다.
  - 슬라이드를 넘기면 `.reveal` 요소의 opacity가 0에서 1로 **변하는 중간값**이 관찰된다(120ms 간격 샘플).
- [x] **P0-6 실시간 따라가기:** 발표자 `present.html?deck=controller-deck&sync=r1` + 관객 `share.html?deck=controller-deck&token=tok&sync=r1`.
  - 발표자가 넘기면 관객의 슬라이드와 fragment 수가 같아진다.
  - 관객이 나중에 들어와도(`hello`) 현재 위치로 맞춰진다.
- [x] **P0-7 Pause/Follow:** 관객 페이지 바깥 문서의 `#__se_follow_toggle`.
  - Pause를 누르면 발표자가 넘겨도 관객은 그대로이고, 관객은 혼자 넘길 수 있다.
  - Follow를 누르면 발표자의 현재 위치로 이동한다.
  - 상태 문구는 `● Live` / `Paused`, 버튼 라벨(`#__se_follow_toggle .lbl`)은 `Pause` / `Follow`. 라벨 뒤쪽(`.more`: " · manual control" / " the presenter")은 마우스를 올릴 때만 보인다.
  - 안내 문구(`#__se_follow_hint`)는 브라우저 언어가 `ko-KR`이면 한국어, `en-US`이면 영어다.
- [x] **P0-8 공유 토큰:** `view.html`에 틀린 token이면 `Invalid or revoked share link.`가 보인다. token이 없는 덱이면 `This deck is not shared.`가 보인다.
- [x] **P0-9 폰 레이아웃:** 390×844, `mobile: true`, 터치 켜기.
  - `#__se_stepnav`의 `<` `>` 버튼이 보이고, 누르면 한 단계씩 이동한다. 옆으로 스와이프해도 이동하지 않는다.
  - deck 모드에서 `#__se_phone` 스타일이 있고, `[data-se-near]`가 현재 ±1 슬라이드에만 있다.
  - 데스크톱에서는 `#__se_stepnav`가 `display: none`이고 `#__se_phone`이 없다.
- [x] **P0-10 share는 미리 다운로드 안 함:** share의 `<img>` src에 `blob:`이 없다. view는 `blob:`이 있다(미리 다운로드).
- [x] **P0-11 발표자 대본 패널:** present 바깥 문서의 `#__se_panel`.
  - 슬라이드를 넘기면 `.pp-count`, `.pp-title`, `.pp-script`, `.pp-next`가 바뀐다. key message가 있는 슬라이드에서 `.pp-key`가 보인다.
  - fragment를 진행하면 `.cue[data-cue]`가 `done` / `next`로 바뀐다.
  - `.pp-hide`를 누르면 슬라이드가 전체 폭이 된다.
- [x] **P0-12 실시간 자막:** 2개 언어 대본을 `localStorage["speakeasy:captions:script:<deck>"]`에 넣는다.
  - present에서 `window.__seCaptions.feed("<대본 줄 일부, 띄어쓰기 없이>", true)`를 호출한다.
  - 기대: 관객 share의 `#__se_cc_box`에 그 줄의 영어가 보인다. CC 버튼(`#__se_cc_toggle`)으로 끄면 숨겨진다.
  - `captions.html`에서도 같은 흐름을 확인하고, 줄을 클릭해 보내는 것도 확인한다.
- [x] **P0-13 편집 기본:** edit에서 슬라이드 선택, 노트 입력 후 자동 저장(가짜 DB에 반영), key message 입력, 슬라이드 순서 바꾸기, 숨기기.
- [x] **P0-14 Share 모달:** edit에서 Share를 연다.
  - `#share-url`이 `share.html?deck=…&token=…&sync=…` 형태다. `#share-open` href가 같은 URL이다. `#share-qr` src가 QR 주소다.
  - New link를 누르면 token이 바뀐다. Stop sharing을 누르면 token이 null이 된다.
- [x] **P0-15 대본 리더:** `script.html?deck=…&sync=r1`이 발표자를 따라간다.
- [x] **P0-16 노트 편집·보기:** script-edit에서 노트를 고치면 저장되고, notes.html에 반영된다.
- [x] **P0-17 가져오기:** index의 가져오기로 fixture HTML 파일을 올리면 덱이 만들어진다(슬라이드 수, 제목 확인). 노트 `.md`와 key message `.md`도 함께 가져온다.
- [x] **P0-18 자막 순수 로직(Vitest):** 대상은 `js/captions/matcher.js`, `bilingual.js`(`parseBilingualMd`, `alignToSlides`).
  - 일부만 들린 문장과 글자가 틀린 문장도 맞는 줄로 찾는다.
  - 관계없는 문장은 점수가 0.4 미만이다.
  - 제목이 조금 다른 섹션(`"2. Verify: Production validation"` ↔ `"Production validation"`)도 짝지어진다.
  - 원본 파일을 import해서 테스트한다(복사하지 않음).
  - 추가로 `tagSection`(재생 상태 제거 포함), `parseNotesMd`, `parseImportedHtmlDeck`, `isSlideHiddenContent`, `storage-src`도 같은 방식으로 테스트했다(`tests/unit/`). Phase 3에서 TS로 옮길 때 이 테스트가 그대로 통과해야 한다.

**완료 조건 (Phase 0 전체)**
- `pnpm exec playwright test` 전부 통과 (3회 연속 실행해도 통과, flaky 금지)
- `pnpm exec vitest run` 전부 통과
- 앱 코드(`speakeasy/*.html`, `speakeasy/js/**`, `speakeasy/css/**`) 변경 0건: `git diff --stat -- speakeasy/js speakeasy/css speakeasy/*.html`가 비어 있어야 한다.

### 5.5 사람이 직접 확인할 것 (자동 테스트 불가)

이 목록은 각 Phase 끝에 사람에게 보고만 한다.
- 실제 마이크 음성 인식(자막), Chrome Translator API
- 클립보드 복사(Copy 버튼)
- 실제 iPhone Safari에서 빠르게 넘겨도 크래시 없음
- 실제 Supabase Realtime으로 두 기기 사이 따라가기

---

## 6. Phase 1: 개발 도구 정비 (앱 동작 그대로)

- [x] **P1-1 package.json 정리**
  - devDependencies 추가: `pnpm add -D typescript @biomejs/biome` (vitest, playwright, http-server는 P0-0에서 설치됨)
  - `vercel`은 `dependencies`에서 빼고 devDependencies로 옮긴다: `pnpm remove vercel && pnpm add -D vercel`. 앱 실행에 필요 없다.
  - scripts:
    ```json
    "test": "vitest run",
    "e2e": "playwright test",
    "lint": "biome check",
    "typecheck": "tsc --noEmit",
    "check": "pnpm lint && pnpm typecheck && pnpm test"
    ```
  - 완료 조건: `pnpm install --frozen-lockfile && pnpm check && pnpm e2e` 통과
- [x] **P1-2 Biome 설정:** `biome.json`에서 `files.includes`(Biome 2는 `includes`)를 `["src/**", "tests/**", "!tests/fixtures/**", "playwright.config.ts", "vitest.config.ts"]`로 한다. `rules.preset`은 `"recommended"`여야 한다(`biome migrate`가 `"none"`으로 바꾸면 린트가 꺼진다. 직접 확인함). **레거시 파일은 포맷하지 않는다**(큰 diff 금지).
- [x] **P1-3 TypeScript 설정:** `tsconfig.json`
  - `strict: true`, `allowJs: true`, `checkJs: false`, `noEmit: true`
  - include: `src`, `tests`, `public/js`(Phase 2 이후)
  - 레거시 JS는 기본으로 검사하지 않는다. 파일 맨 위에 `// @ts-check`를 붙인 파일만 검사된다.
- [x] **P1-4 CI:** `.github/workflows/speakeasy.yml`
  - `speakeasy/` 변경 시 실행: `pnpm/action-setup`(버전은 `packageManager` 필드를 따름) → `actions/setup-node`(`cache: pnpm`) → `pnpm install --frozen-lockfile` → `pnpm check` → `pnpm exec playwright install --with-deps chromium` → `pnpm e2e`
  - 비밀 값을 쓰지 않는다(가짜 백엔드만 사용).
- [x] **P1-5 마이그레이션 형식 준비 (DB 적용 금지)**
  - `supabase/migrations/`에 `migrations/001~010`을 **내용 그대로** 복사한다. 파일 이름은 Supabase CLI 형식 `<14자리 타임스탬프>_<이름>.sql`로 바꾼다.
    - 타임스탬프 예: `20260101000001_init.sql` … `20260101000010_key_message.sql`. 순서를 유지한다.
  - `migrations/README.md`에 "운영 DB에는 이미 001~010이 적용되어 있음. CLI 연결과 `supabase migration repair`는 사람이 한다"고 적는다.
  - **STOP:** CLI 연결(`supabase link`), `migration repair`, `db push`는 사람에게 요청한다.

---

## 7. Phase 2: Vite 도입 (레거시는 public/으로, 동작 그대로)

- [x] **P2-1 레거시 파일을 `public/`으로 이동**
  - `git mv`로 옮긴다: 모든 `*.html`, `js/`, `css/`, `vendor/`, 루트 `sync.js` → `speakeasy/public/`
  - 옮기지 않는 것: `scripts/`, `migrations/`, `package.json`, `vercel.json`, `README.md`, `SPEC.md`, `IDEA.md`
  - 파일 내용은 바꾸지 않는다. 상대 경로(`./js/...`)는 `public/` 안에서도 그대로 동작한다.
- [x] **P2-2 Vite 설정:** `vite.config.ts`
  - 아직 React 진입점이 없으므로 `build.rollupOptions.input`에 빈 플레이스홀더 페이지 하나만 둔다. 예: `src/pages/_placeholder/index.html`, 배포 경로와 겹치지 않게.
  - `public/`은 Vite가 `dist/`로 그대로 복사한다.
  - **확인할 것:** `dist/present.html`, `dist/js/deck-host.js`가 원본과 바이트 단위로 같은지(`cmp`).
- [x] **P2-3 설정 파일 경로 변경**
  - `scripts/build-config.mjs`의 출력 위치를 `public/js/config.local.js`로 바꾼다. **생성 내용은 그대로**(Supabase URL, anon key, passphrase. GitHub 토큰은 넣지 않음).
  - `.gitignore`와 `.vercelignore`의 `js/config.local.js`를 `public/js/config.local.js`로 바꾼다.
  - 로컬 개발자의 기존 `js/config.local.js`는 사람이 직접 옮긴다(STOP 아님, 보고만).
- [x] **P2-4 vercel.json:** `"installCommand": "pnpm install --frozen-lockfile"`를 추가하고, `buildCommand`를 `node scripts/build-config.mjs && vite build`로, `outputDirectory`를 `dist`로 한다. `cleanUrls`와 `headers`는 그대로다.
- [x] **P2-5 개발 서버:** `"dev": "vite"`. e2e 서버를 `vite preview --port 4173`으로 바꾼다(빌드 결과물로 테스트).

**완료 조건 (Phase 2)**
- `pnpm build` 성공
- `pnpm e2e`(빌드 결과물 대상) 전부 통과
- `cmp`로 확인했을 때 `dist/`의 레거시 파일이 원본과 모두 같다.
- 사람에게 미리보기 배포를 요청한다(`vercel deploy`, prod 아님). 그리고 §5.5 수동 확인 목록을 전달한다.

---

## 8. Phase 3: 데이터와 순수 로직에 타입 붙이기

- [x] **P3-1 `src/config.ts`:** `import.meta.env.VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_OWNER_PASSPHRASE`를 읽는다.
  - 값이 없으면 `window.SUPABASE_URL` 등(레거시 config)을 대신 쓴다.
  - **이 세 개 외의 `VITE_*` 변수를 만들지 않는다**(§0.1-6).
- [x] **P3-2 DB 타입 `src/data/types.ts`**
  - `supabase gen types`는 운영 DB 접근이 필요하므로 STOP. 대신 `migrations/*.sql`을 읽고 **손으로** 작성한다.
  - 테이블 `decks`, `slides`, `notes`(`key_message` 포함), `slide_history`, `notes_history`, `frame_history`의 Row/Insert/Update 타입과 RPC 3개의 인자 타입을 쓴다.
- [x] **P3-3 `src/data/*.ts`:** `public/js/repo/*.js`의 함수를 **같은 이름, 같은 동작**으로 TS로 옮긴다(복사 후 타입 추가).
  - 레거시 파일은 그대로 둔다. 두 벌이 공존하는 건 의도된 것이다. 레거시 페이지가 사라질 때 함께 지운다.
- [x] **P3-4 `src/lib/*.ts`:** 순수 함수를 같은 방식으로 TS로 옮긴다.
  - 대상: `markdown-lite`, `import-html`(`parseNotesMd`, `parseImportedHtmlDeck`), `slide-visibility`, `slide-render`(`tagSection`과 재생 상태 제거), `sha1`, `captions/matcher`, `captions/bilingual`.
  - Vitest 테스트를 붙이고, **레거시 JS와 TS가 같은 입력에 같은 출력을 내는지** 비교하는 테스트를 하나씩 쓴다.
- [x] **P3-5 런타임 파일에 JSDoc 타입:** §3.2 파일에 `// @ts-check`와 JSDoc만 추가한다. 실행 코드가 바뀌면 안 된다.
  - 커밋 전에 `git diff`에서 `+` 줄이 주석(`//`, `/**`, ` *`)뿐인지 확인한다.

**완료 조건:** `pnpm check`, `pnpm e2e` 통과

---

## 9. Phase 4: 앱 화면을 React로 (한 페이지씩)

### 9.1 순서 (작은 것부터. 순서를 바꾸지 말 것)

1. [x] P4-1 `captions.html` (자막 콘솔)
2. [x] P4-2 `notes.html`
3. [x] P4-3 `script.html`
4. [x] P4-4 `script-edit.html`
5. [x] P4-5 `index.html`
6. [x] P4-6 `pronunciation.html`
7. [x] P4-7 `edit.html` (가장 큼. 아래 §9.3에 따라 여러 태스크로 나눔)

### 9.2 페이지 하나를 옮기는 절차 (매번 동일)

1. 레거시 페이지에서 다음을 표로 정리해 `docs/modernization-notes.md`에 적는다.
   - **화면 요소**와 그 **id/class**. 테스트가 쓰는 선택자는 반드시 유지한다.
   - **이벤트와 단축키**: `bindShortcutsHelp` 목록을 그대로 옮긴다.
   - **읽고 쓰는 localStorage 키와 데이터 호출**
2. `speakeasy/<page>.html`(루트, Vite 진입)과 `src/pages/<page>/main.tsx`를 만든다.
   - HTML의 `<head>`(제목, 메타, 폰트, `theme.css` 링크)는 레거시와 같게 둔다.
3. 화면을 React 컴포넌트로 다시 만든다.
   - **같은 DOM id와 class**, **같은 문구**(영어/한국어 그대로), **같은 CSS**를 쓴다. 레거시 `<style>`은 `src/features/<page>/<page>.css`로 그대로 옮긴다.
   - 인증 게이트는 렌더 전에 `await ensureAuthed()` 한다(`src/lib/auth.ts`로 옮긴 것). **`await` 필수.**
4. `vite.config.ts`의 input에 이 HTML을 추가한다.
5. `public/<page>.html`을 `git rm` 한다. 같은 URL은 이제 Vite 진입점이 제공한다.
6. 그 페이지만 쓰던 레거시 JS(예: `public/js/script-view.js`)를 지운다.
   - **런타임 파일(§3.2)과 다른 페이지가 쓰는 파일은 지우지 않는다.** 지우기 전에 `grep -rn "<파일명>" public src`로 다른 사용처가 없는지 확인한다.
7. Phase 0 e2e 중 그 페이지 테스트가 **수정 없이** 통과해야 한다.

**완료 조건 (페이지마다):** `pnpm check`, `pnpm e2e` 전부 통과, 그리고 그 페이지 테스트 파일의 diff가 0이어야 한다.

### 9.3 edit.html 분할 (P4-7a ~ P4-7h)

각각 별도 태스크·커밋으로 한다. 순서대로 진행한다.

- [x] P4-7a 페이지 골격(상단 바, 3단 레이아웃, 패널 접기, 너비·높이 조절과 해당 localStorage 키)
- [x] P4-7b 슬라이드 목록(선택, 드래그 정렬 → `reorder_slides`, 추가, 복제, 숨김)
- [x] P4-7c 캔버스: `edit-frame.html` iframe과 postMessage 연결(§2.4). `<` `>` 미리보기 버튼, 16:9 / 세로 / HTML 모드
- [x] P4-7d 노트 패널(노트, key message, 자동 저장 800ms, Import .md, 글자 크기, TTS)
- [x] P4-7e 에셋 라이브러리(업로드, 검색, URL 복사, 삽입, 이름 변경 → `rename_asset_references`, 삭제)
- [x] P4-7f 모달: Share(§P0-14), 프레임 편집기(CodeMirror), 히스토리, SVG
- [x] P4-7g 내보내기(HTML, PDF 인쇄, 노트 .md 다운로드·복사). PPTX와 screenshot-PDF는 제거됨
- [x] P4-7h 발음 연습 패널(`training-panel.js`, 1,190줄. 가장 마지막). 이 파일은 `pronunciation.html`도 쓰므로 `public/`에 두고 React에서 마운트만 한다. 이어서 `/edit-next.html`을 `/edit.html`로 교체함

edit을 옮기는 동안에는 레거시 `public/edit.html`을 **마지막 태스크(P4-7h)가 끝날 때까지 지우지 않는다.** 새 edit은 임시 경로 `/edit-next.html`로 만들어 테스트한다. P4-7h가 끝나면 그때 `/edit.html`로 교체한다. (교체 완료: 레거시 `public/edit.html`과 `public/js/edit-bootstrap.js`를 지우고 루트 `edit.html`이 그 자리를 잇는다.)

---

## 10. Phase 5 (선택, 별도 승인 필요): 진짜 인증

동작이 바뀌는 작업이라 Phase 0~4와 섞지 않는다. 사람이 승인한 뒤 별도 계획서를 만든다.
- 패스프레이즈를 Supabase Auth로 바꾸고, RLS로 소유자만 읽고 쓰게 한다.
- 공유 읽기는 token 검증 RPC로 바꾼다.

---

## 11. 필요 없는 코드 정리

### 11.1 이미 정리함 (이 문서 작성 시점, 다시 할 필요 없음)

- `dompurify` 의존성, `vendor/modules/dompurify.mjs`, `vendor/modules/entry/dompurify-entry.js`, 빌드 스크립트의 dompurify 항목. 앱 어디에서도 쓰지 않았다.
- 아무도 부르지 않던 export: `js/auth.js`의 `logout`, `js/repo/history-repo.js`의 `getRow`, `js/storage-src.js`의 `toStorageSrc`
- 빈 폴더 `speakeasy/docs/`

### 11.2 다른 사람의 변경이 커밋된 뒤 정리할 것 (P0 전에 확인)

작성 시점에 다른 작업자의 **미커밋 변경**이 있다. 내보내기 메뉴에서 PPTX와 screenshot-PDF를 빼고, `pdf-export.html`을 지우는 변경이다. 이 변경이 커밋되면 다음이 쓸모없어진다. **커밋되기 전에는 건드리지 마라.**

- [x] C-1 `git log`로 그 변경이 커밋됐는지 확인한다. 아직이면 이 항목은 건너뛰고 STOP 보고한다.
- [x] C-2 `edit.html`에 `data-export="pptx"` 버튼이 없으면 다음을 지운다.
  - `js/export.js`의 PPTX 코드(`exportPptx`와 그것만 쓰는 함수)
  - `edit.html`의 `<script src="./vendor/pptxgenjs/pptxgen.bundle.js">`
  - `vendor/pptxgenjs/`
- [x] C-3 `exportScreenshotPdf`가 어디서도 import되지 않으면 그 함수와, 그 함수만 쓰는 코드를 지운다.
- 각 삭제 전에 `grep -rn "<이름>" speakeasy --include=*.js --include=*.html`로 다른 사용처가 없는지 확인한다.

### 11.3 export를 뺄 수 있는 것 (선택, 낮은 우선순위)

다른 파일에서 쓰지 않고 자기 파일 안에서만 쓰는 함수다. `export` 키워드만 빼도 된다(동작 변화 없음).
`auth.isAuthed`, `captions/matcher.MIN_CHARS`, `export.buildHtml`, `remote-source.toRawUrl`, `history-repo.listSlideHistory / listNotesHistory / listFrameHistory`, `storage-repo.assetKind`, `shortcuts-help.showShortcutsHelp`, `storage-src.fromStorageSrc / resolveStorageSrc`

### 11.4 지우면 안 되는 것 (쓸모없어 보여도 유지)

- `slides-editor:*` localStorage 키를 새 키로 옮기는 코드(`js/auth.js`, `js/script-view.js`): 예전 사용자 데이터 호환용
- 루트 `sync.js`: 덱이 자체적으로 `import("./sync.js")` 하는 것을 받아 주는 빈 모듈. 지우면 404 오류가 난다.
- `migrations/` 원본 SQL: 운영 DB 이력
- `window.__seCaptions`: 테스트(P0-12)가 쓴다.

### 11.5 문서

`SPEC.md`(1,243줄), `IDEA.md`는 초기 설계 문서라 현재 동작과 다를 수 있다. 지우거나 고치지 말고, 사람에게 "최신 기능 목록은 `docs/function.md`"라고 보고만 한다.

### 11.6 정리 원칙 (모든 Phase 공통)

- "안 쓰는 것 같다"는 이유로 지우지 마라. **사용처 검색 결과가 0건**이고 **e2e가 통과할 때만** 지운다.
- 런타임 파일(§3.2)은 사용처가 문자열 URL이라 import 검색에 안 잡힌다. 파일 이름으로 검색한다(`grep -rn "deck-host.js"`).
- 정리는 기능 이전과 **다른 커밋**으로 한다. 커밋 제목에 `chore(speakeasy): remove unused ...`

---

## 11.7 Phase 6: HTML 없이 전부 React + TypeScript (2026-10-21 사람이 승인)

사람이 "html을 없애고 모두 React TS로" (범위 C: 덱 실행 페이지와 `public/js` 레거시 전부)를 승인했다. 이 승인으로 §1.2의 "덱 실행 엔진 재작성 금지"와 §3.2의 "런타임 파일 내용 변경 금지"는 **Phase 6에 한해 해제**한다. 단, 아래 호환 조건은 그대로 지킨다.

### 호환 조건 (바꾸면 안 되는 것)
- URL: `/edit.html`, `/present.html`, `/view.html`, `/share.html`, `/index.html` 등 `.html`이 붙은 주소와 cleanUrls 주소(`/edit`)가 모두 계속 열린다. 공유 링크(`share.html?deck=&token=&sync=`)는 이미 배포돼 있다. 쿼리 파라미터도 그대로다.
- **저장된 덱이 그대로 돈다.** `frame_html`이 부르는 `./js/deck-host.js`, `./sync.js`(빈 모듈), 전역 `SlidePresentation`, `DOMContentLoaded`, `slidechange` 이벤트 규약을 유지한다. 덱 데이터는 마이그레이션하지 않는다.
- 사용자가 보는 화면, 동기화 방 이름(`syncRoomFor`), localStorage 키는 그대로다.

### 목표 구조
- `index.html` **하나**(Vite 진입점은 최소 하나 필요)와 React Router. 페이지별 `.html` 진입점과 `public/*.html`은 없앤다. Vercel `rewrites`로 위 URL들을 `index.html`에 연결한다.
- 덱 문서는 iframe이다. 덱의 스크립트가 문서 생명주기를 직접 쓰므로 React 컴포넌트로 렌더링하지 않는다. 안쪽 문서는 TS가 만든 HTML 문자열(`frame_html` + 슬라이드 + 런타임 `<script>`)을 `srcdoc`으로 넣는다. 바깥쪽(레터박스, 발표자 패널, 스텝 버튼, 공유 화면)이 React다.
- 덱 안에서 실행되는 런타임(`deck-host`, `slide-runtime`, `sync`, 자막 audience 등)은 TS로 옮기되 **별도 번들 파일**로 빌드해 덱 문서가 `<script>`로 불러온다.
- `public/`에는 JS가 아닌 정적 자원(`vendor/`, `css/`, `favicon.svg`, `config.local.js`, 루트 `sync.js` 빈 모듈)만 남긴다.

### 단계 (각각 별도 커밋. 앞 단계가 끝나야 다음으로 간다)
- [x] P6-0 호환 오라클: 덱 실행 동작을 고정하는 e2e. (`tests/e2e/p6-0-deck-compat.spec.ts` 9개 + 기존 `p0-3`~`p0-11`) (a) 자체 컨트롤러가 있는 덱(`SlidePresentation`), (b) 평범한 `<section>` 덱, (c) 상대 URL을 부르는 `frame_html`. present/view/share/edit-frame에서 슬라이드 이동, 조각(fragment), 동기화, 인쇄(`?print=1`)를 검증. **이 테스트는 레거시 상태에서 먼저 통과해야 하고, 이후 모든 단계가 이 테스트로 검증한다.**
- [x] P6-1 SPA 골격: `index.html` + 주소 분기(`src/main.tsx`, `src/routes.ts`)로 지금 React인 7개 페이지를 합친다. 페이지 이동은 지금처럼 전체 로드라 라우터 라이브러리는 쓰지 않는다. `.html` URL과 cleanUrls 주소 모두 유지(rewrites), 페이지 단위 코드 분할. 기존 e2e 176개 통과.
- [x] P6-2 공용 모듈을 TS로: `auth`, `dom-prompt`, `shortcuts-help`, `sync`, `preload-assets`, `remote-source`, `slide-fit`, `history-ui`(React 컴포넌트). `public/js/repo/*`는 `src/data/*`와 같은 동작인 것을 확인한 뒤 지운다(오라클 단위 테스트는 고정 스냅샷으로 바꾼다).
- [x] P6-3 `training-panel.js`(1,187줄)를 React 컴포넌트 + 훅으로. TTS, STT, 점수, IndexedDB, 녹음을 모듈로 나눈다. `pronunciation`과 편집기가 같이 쓴다.
- [ ] P6-4 덱 런타임 TS화: `slide-runtime`, `deck-host`, `slide-render`, `slide-visibility`와 덱 문서 빌더(`srcdoc`), 레터박스 React 컴포넌트.
- [ ] P6-5 `view`와 `share`(`view-bootstrap`, 자막 `audience`).
- [ ] P6-6 `present`(`present-bootstrap`, `presenter-panel`, 자막 엔진 연결).
- [ ] P6-7 `edit-frame`(`inline-editor`, `edit-frame-overlay`, `edit-frame-bootstrap`). 편집기 캔버스와의 postMessage 규약(§2.4)은 유지.
- [ ] P6-8 정리: `public/*.html`, `public/js/*` 삭제(§11.6 규칙: 사용처 0건 + e2e 통과), 문서와 README 갱신.

### 위험과 대응
- 덱 문서 생명주기(전역 클래스 가로채기, `document.write`): 안쪽 문서를 그대로 두고 TS로 같은 순서를 재현한다. P6-0 테스트가 안전망이다.
- `srcdoc` 문서의 상대 URL 기준: 부모 URL을 따르므로 `./sync.js` → `/sync.js`. P6-0의 (c)로 확인한다.
- 휴대폰 렌더링(`lightenForPhones`, iOS 탭 종료 이슈): 자동 테스트로 못 잡는다. 실기기(iPhone) 확인을 사람이 한다.
- 각 단계에서 안 되면 그 단계 커밋만 되돌린다. 앱은 모든 단계에서 배포 가능해야 한다.

---

## 12. 진행 기록

| Phase | 상태 | 날짜 | 메모 |
|---|---|---|---|
| 0 | **완료** | 2026-10-14 | P0-0~18 완료. e2e 95개(3회 연속 통과) + 단위 50개. 앱 코드 변경 0건 |
| 11.2 정리 | **완료** | 2026-10-14 | 내보내기 메뉴 변경이 커밋된 뒤(`feat/slides-editor` 77e6459) PPTX 코드, `vendor/pptxgenjs`, screenshot-PDF 정리 |
| 1 | **완료** | 2026-10-14 | P1-1~5 완료. 깨끗한 clone에서 `pnpm install --frozen-lockfile && pnpm check && pnpm e2e` 통과(CI와 같은 조건). 마이그레이션 CLI 연결·`migration repair`는 사람이 할 일 |
| 2 | 진행 중 | 2026-10-14 | P2-1~5 완료: dist의 레거시 파일이 public과 바이트 단위로 같고(`diff -rq`), 빌드 결과물 대상 e2e 95개·단위 50개 통과. 깨끗한 clone에서 가짜 환경변수로 Vercel식 빌드(`build-config && vite build`)와 `pnpm check`·`pnpm e2e`도 통과(GitHub 토큰은 무시되어 dist에 없음). **남은 것: Vercel 미리보기 배포 확인(사람). 확인할 점은 아래 참고** |
| 3 | 진행 중 | | P3-1~4 완료(config, 손으로 쓴 DB 타입, `src/data/*.ts`, `src/lib/*.ts`). 레거시와 같은 결과를 내는지 비교하는 테스트: 데이터 계층 100개 + 순수 로직 997개(무작위 입력 포함, 코드를 바꾸면 실패하는 것 확인) |
| 4 | 진행 중 | | P4-1(자막 콘솔) 완료: `captions.html`이 React + TS 페이지로 바뀜(같은 DOM id, e2e 95개 그대로 통과) |

발견한 버그, 애매한 점, 사람에게 물어볼 것은 `docs/modernization-notes.md`에 적는다(파일이 없으면 만든다).
