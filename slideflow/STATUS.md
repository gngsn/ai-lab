# Slideflow — Current Feature Status

> Snapshot of what is built and verified today. Companion to `PLAN.md` (the build plan)
> and `../slides-editor/SPEC.md` (the feature contract).
>
> **Stack:** TypeScript + Vite (vanilla), Ports & Adapters (Hexagonal).
> **Backends:** `memory` (no infra), `local` (vendor-neutral Docker), `supabase` (cloud) — chosen by one env var.

---

## 1. Progress at a glance

| Phase | Scope | Status |
|---|---|---|
| 0 | Skeleton + hexagon seams | ✅ Done |
| 1 | Auth + DB + RLS | ✅ Done (verified on Docker) |
| 2 | Dashboard + Deck lifecycle + Import | ✅ Done (verified on Docker) |
| 3 | Edit core (slides + notes + iframe) | ✅ Done |
| — | Edit UI parity with original `slides-editor` | ✅ Done |
| 4 | Present + Sync + View + Share | ✅ Done (verified on Docker) |
| 5 | Frame editor + History + Images + SVG | ⏳ Pending (More-menu buttons present, not wired) |
| 6 | Teleprompter (note) view + Export | ⏳ Pending |
| 7 | Training (pronunciation) | ⏳ Pending |
| 8 | Hardening | ⏳ Pending |

**Gates:** `tsc --noEmit`, ESLint (incl. import boundaries), Prettier, Vitest (33 tests) all pass. `vite build` produces all 8 pages.

---

## 2. Architecture

Hexagonal layering with an enforced import boundary — the core never imports a backend SDK.

```
src/
  core/      pure domain (model, slide, render, markdown, text, import)
  ports/     interfaces only + Ports bundle
  adapters/  the ONLY place infra SDKs live (supabase, local, memory, browser)
  composition/ env, container (backend → Ports), getPorts(), not-implemented
  features/  use-cases (auth, editor, import, present) — depend on ports only
  pages/     thin entries: login, dashboard, edit, edit-frame, present, note, view, training
  ui/        theme, dom, constants, debounce, styles/*
```

**Enforced rule (ESLint):** `@supabase/*` only under `adapters/supabase/**`; `features/`+`pages/` may not import `@adapters/*` (tests excepted). `composition/container.ts` is the only adapter importer; `getPorts()` returns one `Ports` bundle by `VITE_BACKEND`. Unbuilt ports are `notImplemented` placeholders that throw on use.

---

## 3. Backends & how to run

```bash
cp .env.example .env.local        # default VITE_BACKEND=memory
npm install && npm run dev        # http://localhost:5173
```

| Backend | What it is | Auth | Realtime |
|---|---|---|---|
| `memory` | in-process fakes | any credentials (dev) | same-tab |
| `local` | Docker: Postgres + PostgREST + MinIO | dev-JWT signed with shared secret | BroadcastChannel (cross-tab) |
| `supabase` | Supabase cloud | real Supabase Auth | Supabase broadcast (cross-device) |

Local stack: `npm run stack:up` → `npm run db:migrate` → `npm run db:seed`, set `VITE_BACKEND=local`, `npm run dev`. The dev-only `dev_login` RPC lives in `supabase/dev-migrations/` and is never applied to Supabase.

---

## 4. Implemented features

### 4.1 Auth (Phase 1)
`AuthPort` with `supabase-auth`, `local-auth` (dev-JWT), `memory-auth`. Login page (email/password, magic link, Google OAuth, `next`). Owner-page guard + account menu. **RLS verified on Docker:** owner isolation, anon denial, owner-only RPC denial.

### 4.2 Dashboard + Import (Phase 2)
Owner-scoped deck list with links. Import modal → `import-html` (section extraction, id dedup, frame build, notes-by-index) → deck/slides/notes write → redirect to edit. Verified end-to-end under RLS.

### 4.3 Edit (Phase 3 + UI parity)
Layout matches the original `slides-editor/edit.html`. Toolbar (home, deck title, mode 16:9/html/stretch, Present, ⋮ More, status, account). Resizable slide list (count + title, items with hover actions, drag reorder, add). Canvas iframe with inline contenteditable (autosave 800ms) or raw HTML mode (tag-validated). Notes textarea (debounced 800ms) with font-size −/+. Panel widths + notes font + last section persisted to localStorage. `DeckSession` is the single editor model (unit-tested). Portrait mode, notes preview, and slide-info grid were removed per request.

### 4.4 Present + Sync + View + Share (Phase 4)
- **`SlidePresentation`** runtime: keyboard/wheel/touch nav, fragment reveal, IntersectionObserver visibility, `slidechange` events.
- **`cleanFrameHtml`**: strips scripts / inline handlers / `javascript:` from the frame.
- **`present-runtime`**: clean → tag → inject visible slides → `document.write` → mount runtime + presenter chrome (progress bar, counter, sync, nav dots) + scroll-snap fallback CSS. Print mode (`print=1`) reveals fragments, sets `@page 1280×720`, calls `window.print()`. Start section resolution.
- **`present.html`** (owner, guarded) broadcasts `{section_id, index}` on slide change via the realtime port.
- **`view.html`** (public): validates the share token via `ShareReadPort`, renders read-only with a Home + "read-only · shared view" label, no notes/sync. **Verified:** anon `public_get_*` returns only sanitized fields; wrong token → `[]`.
- **Realtime adapters:** `BroadcastChannelRealtime` (local, cross-tab) and `SupabaseRealtime` (cloud).
- **Share modal** (edit ⋮ More → Share): generate / copy / rotate / revoke token via `crypto.randomUUID()`.

---

## 5. Data layer

Migrations in `supabase/migrations/` (plain SQL, same files to Docker or Supabase): `0001_auth_compat` (idempotent shim), `0002_init`, `0003_history`, `0004_profiles`, `0005_rls`, `0006_rpc` (`reorder_slides`, `public_get_deck/slides`), `seed.sql`; `dev-migrations/0001_dev_login` (local only).

Ports in use: `AuthPort`, `DeckStorePort`, `SlideStorePort`, `NotesStorePort`, `RealtimePort`, `ShareReadPort`, `SanitizerPort`. Pending wiring (placeholders/memory): `HistoryStorePort`, `BlobStoragePort`, `AudioCachePort`.

---

## 6. Verification

- **Unit (Vitest, 33):** text/slug/section-id, slide ops, markdown-lite, import parsers, dev-JWT signer, RestClient (empty-body/JSON/error), `DeckSession`.
- **Integration (live Docker):** migrations; RLS owner isolation; PostgREST+JWT e2e; anon share RPC token scoping + sanitized fields; owner-RPC denial; full import write path.
- **Static:** `tsc`, ESLint import-boundary (negative probe), Prettier.

---

## 7. Known gaps

- ⋮ More: Save version / Export / History / Frame / Images / SVG render but toast "Available in a later phase" (Phases 5–6). **Share is wired.**
- `note.html`, `training.html` are themed placeholders (Phases 6, 7).
- `HistoryStorePort` / `BlobStoragePort` / `AudioCachePort` not implemented for local/supabase (placeholders throw on use).
- `boot` bundle statically imports the Supabase adapter; Phase 8 will lazy-load adapters per backend.
- Browser-level E2E (slide nav, cross-tab sync, panel resize) is manual in the dev server; automated browser tests are Phase 8.
