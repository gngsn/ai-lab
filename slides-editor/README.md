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
   - `migrations/seed.sql` — 검증용 샘플 덱 1개
4. RLS는 M6에서 도입. 그 전까지 anon key로 직접 read/write.

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
- [ ] **M1** — 슬라이드 read + present
- [ ] **M2** — 스크립트 read + sync
- [ ] **M3** — 슬라이드 inline edit
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
├─ index.html              # M0 setup check
├─ migrations/
│  ├─ 001_init.sql
│  ├─ 002_history.sql
│  └─ seed.sql
├─ js/
│  ├─ supabase.js
│  └─ config.local.js.example
├─ vercel.json
├─ SPEC.md
├─ PLAN.md
├─ IDEA.md
└─ README.md
```
