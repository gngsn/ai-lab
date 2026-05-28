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

## Roadmap

- [x] **M0** — 셋업
- [x] **M1** — 슬라이드 read + present
- [x] **M2** — 스크립트 read + sync
- [x] **M3** — 슬라이드 inline edit
- [ ] **M4** — 노트 편집
- [ ] **M5** — 히스토리 / 롤백
- [ ] **M6** — Export (HTML / PDF / Marp)
- [ ] **M7** — 공유 + 권한
- [ ] **M8** — 데이터 마이그레이션
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
├─ migrations/
│  ├─ 001_init.sql
│  ├─ 002_history.sql
│  └─ seed.sql
├─ js/
│  ├─ supabase.js          # shared client
│  ├─ sync.js              # Realtime broadcast (used in M2)
│  ├─ slide-runtime.js     # v4 SlidePresentation port
│  ├─ script-view.js       # v5 teleprompter port (uses slides+notes join)
│  ├─ inline-editor.js     # v4 InlineEditor port (runs inside edit-frame iframe)
│  ├─ auth.js              # M3 passphrase gate (localStorage)
│  ├─ present-bootstrap.js # loads deck → rewrites document
│  ├─ edit-bootstrap.js    # M3 editor controller (slide list, IPC, mutations)
│  ├─ edit-frame-bootstrap.js  # M3 iframe loader (renders single slide)
│  ├─ repo/
│  │  ├─ deck-repo.js       # + updateTitle, updateFrameHtml
│  │  ├─ slide-repo.js      # + getOne/updateContent/updateMeta/insert/delete/reorder
│  │  └─ notes-repo.js      # + upsert
│  └─ config.local.js.example
├─ vercel.json
├─ SPEC.md
├─ PLAN.md
├─ IDEA.md
└─ README.md
```
