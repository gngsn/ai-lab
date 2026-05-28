# slides-editor

발표 슬라이드 + 스크립트(노트) 편집기. 두 개의 독립 모드(슬라이드 / 스크립트), 모바일에서는 스크립트만, 발표 시 라이브 sync.

자세한 사양: [SPEC.md](./SPEC.md) · 단계별 계획: [PLAN.md](./PLAN.md)

---

## Setup (M0)

### 1. Supabase 준비
1. https://supabase.com 에서 새 프로젝트 생성(또는 기존 재사용).
2. **Project Settings → API**에서 `Project URL`, `anon public` key 복사.
3. **SQL editor**에서 순서대로 실행:
   - `migrations/001_init.sql` — decks / slides / notes
   - `migrations/002_history.sql` — slide_history / notes_history
   - `migrations/003_dev_rls.sql` — **RLS 유지 + anon 허용 정책 부여** ← 빠뜨리면 0 rows 보임
   - `migrations/004_rpc.sql` — reorder_slides RPC (M3 이상)
   - `migrations/005_storage.sql` — `slides-images` 버킷 + dev RLS 정책 (이미지 호스팅)
   - `migrations/seed.sql` — 검증용 샘플 덱 1개
4. M6에서 `dev_anon_all` 정책을 owner + share_token 기반 정책으로 교체합니다. 그 전까지는 RLS 토글은 켜져 있지만 anon이 모든 row를 read/write할 수 있는 상태(단일 사용자 dev 가정).

### 2. 로컬 설정
```bash
cp js/config.local.js.example js/config.local.js
# 편집기로 열어 SUPABASE_URL / SUPABASE_ANON_KEY / OWNER_PASSPHRASE 입력
```

### 3. 실행
```bash
python3 -m http.server 8000
# 또는: npx serve .
```
브라우저에서 `http://localhost:8000` → **"✓ connected — 1 deck(s)"** + `seed-hello` 표시되면 M0 완료.

---

## Keyboard shortcuts

각 페이지에서 <kbd>?</kbd> 키로 모달 확인. 공통 요약:

| Page | Keys | Action |
|---|---|---|
| **Edit** | `E` | Toggle edit mode (canvas) |
| | `H` | History drawer |
| | `⌘S` / `Ctrl+S` | Save version |
| | Drag in list | Reorder |
| **Present** | `↓→PgDn Space` | Next / fragment |
| | `↑←PgUp` | Prev / hide fragment |
| | `Home / End` | First / last slide |
| **Script** (read) | `↓→ / j` | Next (manual mode) |
| | `↑← / k` | Prev (manual mode) |
| | Click sync badge | Auto ↔ manual toggle |
| **Notes** (script-edit) | `⌘S / Ctrl+S` | Save version |
| | `H` | History drawer |
| **Edit** | `I` | Image library |
| **All** | `?` | This help |

---

## Deployment (Vercel)

```bash
# one-time
vercel login
vercel link

# env vars (set once per project)
vercel env add SUPABASE_URL       production
vercel env add SUPABASE_ANON_KEY  production
vercel env add OWNER_PASSPHRASE   production

# deploy
vercel --prod
```

The `buildCommand` (`node scripts/build-config.mjs`) materializes
`js/config.local.js` from those env vars at build time. The committed
`js/config.local.js` (if any) is overwritten on Vercel.

> ⚠ Before public deployment, see the **Security posture** section below.
> The current `dev_anon_all` RLS policy lets anyone with the deployed
> page hit the database. Tier 2 hardening required.

---

## Image hosting

이미지는 Supabase Storage의 `slides-images` 버킷(public-read)에 저장됩니다.

- **활성화**: `migrations/005_storage.sql` 실행 (한 번)
- **사용**: edit.html → `🖼 Images` (또는 `I` 키) → 드래그-앤-드롭 또는 `+ Upload`
- **삽입**: 카드의 `↩` → iframe의 현재 selection 위치에 `<img>` 자동 insert + autosave
- **복사**: `📋` → public URL 클립보드, HTML에 직접 paste 가능
- **삭제**: `🗑` (영구). slides의 `<img src>` 참조는 깨지므로 주의
- **경로**: `{deck_id}/{ts36}-{safe-name}` — 같은 파일명도 timestamp 접두사로 충돌 없음

> Tier 1: anon이 업로드/삭제 가능. Tier 2 에서 owner 인증 후로 제한 필요.

---

## Importing existing material (M8)

Bring an HTML slide deck and (optionally) a Marp-style notes Markdown into
a deck row:

```bash
node scripts/import.mjs --deck=my-talk \
  --slides=path/to/slides.html \
  --notes=path/to/notes.md \
  --title="My Talk"
```

- **Slides format**: any HTML with one or more `<section …>` blocks. Common
  attrs are read: `data-title` → slides.title, `data-section-id` /
  `data-edit-id` → stable id, else slug(title) → `s-NNN`.
- **Notes format**: Markdown with `---` separators between sections. Top
  frontmatter (`--- … ---`) is dropped. Each chunk's first `## title` line
  is stripped. Chunks are matched to slides by index.
- **Idempotent**: re-running with the same input replaces all slides for that
  deck (notes are upserted by section_id).
- **`--dry-run`** prints the parse summary without touching the DB.
- **No npm install needed** — Node 18+ only.

---

## Security posture

**Tier 1 (current, M7):** Client-side passphrase gate (`OWNER_PASSPHRASE`)
on owner pages. Public share via `view.html?deck=X&token=Y` (DOMPurify
sanitized). Suitable for local use or trusted networks.

**Tier 2 (future):** Anon key is currently visible to anyone hitting the
deployed site, and the `dev_anon_all` RLS policy lets it read/write every
deck. Before public deployment, replace with:
  - Supabase Auth (magic link or email) for owner
  - RLS scoped by `auth.uid()` for owner ops
  - RPC `public_view(deck_id, token)` (security definer) for share-token reads
  - Drop `dev_anon_all`, grant only the RPC to `anon`

---

## Roadmap

- [x] **M0** — 셋업
- [x] **M1** — 슬라이드 read + present
- [x] **M2** — 스크립트 read + sync
- [x] **M3** — 슬라이드 inline edit
- [x] **M4** — 노트 편집
- [x] **M5** — 히스토리 / 롤백
- [x] **M6** — Export (HTML / PDF / Marp)
- [x] **M7** — 공유 + 권한 (Tier 1: client gate + share_token + sanitize)
- [x] **M8** — 데이터 import (HTML/Markdown → deck)
- [x] **M9** — 폴리시 (`?` 단축키 모달, build-config, 배포 가이드)
- [ ] **M9** — 폴리시 + 배포

---

## 구조 (현재)

```
slides-editor/
├─ index.html              # setup check + deck list
├─ present.html            # M1 — read + nav (?deck=<id>[&sync=<room>])
├─ script.html             # M2 — teleprompter + Realtime sync receiver
├─ edit.html               # M3 — inline editor (desktop only; mobile → script)
├─ edit-frame.html         # M3 — single-slide iframe used by edit.html
├─ script-edit.html        # M4 — fullscreen notes editor (markdown + preview)
├─ notes.html              # M6 — Marp(.md) read-only view (Copy/Download)
├─ view.html               # M7 — public viewer (?token=, slides only)
├─ migrations/
│  ├─ 001_init.sql
│  ├─ 002_history.sql
│  └─ seed.sql
├─ js/
│  ├─ supabase.js          # shared client
│  ├─ sync.js              # Realtime broadcast (used in M2)
│  ├─ slide-runtime.js     # v4 SlidePresentation port
│  ├─ script-view.js       # v5 teleprompter port (uses slides+notes join)
│  ├─ script-edit-view.js  # M4 notes editor mount (marked@11 preview)
│  ├─ inline-editor.js     # v4 InlineEditor port (runs inside edit-frame iframe)
│  ├─ history-ui.js        # M5 history drawer (timeline + view + restore)
│  ├─ export.js            # M6 buildHtml/exportHtml, exportPdf, buildNotesMd
│  ├─ view-bootstrap.js    # M7 share_token view loader (DOMPurify sanitize)
│  ├─ auth.js              # M3 passphrase gate (localStorage)
│  ├─ present-bootstrap.js # loads deck → rewrites document
│  ├─ edit-bootstrap.js    # M3 editor controller (slide list, IPC, mutations)
│  ├─ edit-frame-bootstrap.js  # M3 iframe loader (renders single slide)
│  ├─ repo/
│  │  ├─ deck-repo.js       # + updateTitle, updateFrameHtml
│  │  ├─ slide-repo.js      # + getOne/updateContent/updateMeta/insert/delete/reorder
│  │  ├─ notes-repo.js      # + upsert (M5: auto-history on every write)
│  │  └─ history-repo.js    # M5 appendAuto/appendManualBatch/listAllHistory
│  └─ config.local.js.example
├─ vercel.json
├─ SPEC.md
├─ PLAN.md
├─ IDEA.md
└─ README.md
```
