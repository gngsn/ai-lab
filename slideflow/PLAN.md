# Slideflow — Build Plan

> A clean-room rebuild of the `slides-editor` SPEC as a new service named **Slideflow**.
>
> Stack: **TypeScript + Vite (vanilla, no UI framework)**, structured as **Ports & Adapters (Hexagonal)**. Backend is a pluggable adapter — **Supabase** (cloud) or a **vendor-neutral Dockerized local stack** — selected by one env var, never by code.
>
> This document is the *build plan*, not the feature contract. The feature contract is `slides-editor/SPEC.md`; every acceptance item there must hold for Slideflow. All source, identifiers, comments, and default content are **English-only**.

---

## 1. Guiding Principles

These rules decide every structural choice below. When a tradeoff appears, resolve it in this order:

1. **Single Responsibility** — one module owns one reason to change. A store adapter talks to one table group; a renderer only renders; an auth adapter only authenticates.
2. **Separation of concerns (Ports & Adapters)** — dependencies point inward to the core only: `pages → features → ports ← adapters → infra`. The core depends on **port interfaces**, never on infrastructure. A page never imports an SDK; it receives ports from the composition root.
3. **Minimal external coupling** — every third-party SDK (Supabase, DOMPurify, IndexedDB) is confined to one adapter folder. Swapping a backend touches only `adapters/` + `composition/`, never domain or UI.
4. **Readability over cleverness** — explicit names, small functions, no hidden globals. The old app leaned on `window.*` config and implicit DOM ids; Slideflow replaces those with typed config and typed DOM accessors.
5. **Contracts as types** — every SPEC interface (`getSession()`, `tagSection()`, `reorder_slides()`, `AuthUser`, store methods) becomes a TypeScript port `interface`. The compiler enforces the boundaries.
6. **Runtime model unchanged** — keep the SPEC's proven mechanics: `frame_html` injection at `<!-- slides -->`, `document.open/write/close` for present/view, iframe-based inline editing. Vite + TS wrap this; they do not replace it.
7. **Security is backend-backed** — auth is a backend session (Supabase or local JWT), never a client passphrase. RLS is the boundary, not UI guards.

---

## 2. Target Architecture

### 2.1 Ports & Adapters (Hexagonal) Overview

Slideflow is structured as a **hexagon**: a framework-free core surrounded by **ports** (interfaces it owns) and **adapters** (implementations it does not). The single hard rule that makes Supabase a swappable detail:

> **No file under `core/`, `ports/`, `features/`, `pages/`, or `ui/` may import `@supabase/supabase-js`, a Supabase URL, a SQL string, or any infrastructure SDK. Those symbols exist only under `adapters/` (and are wired by `composition/`).**

So "minimize Supabase dependency" is not a guideline — it is a compile/lint boundary. Supabase, a Dockerized local Postgres, and in-memory test doubles are interchangeable implementations of the same ports. The app never knows which one is wired.

```
                 ┌──────────────── driving side (UI) ────────────────┐
   pages/ ──▶ ui/ ──▶ app/ (use-cases) ──▶ ports/ (interfaces) ◀── adapters/ ──▶ infra
                                              ▲                        (supabase | local | memory | browser)
                                              │
                                            core/ (pure domain — depends on nothing)
```

### 2.2 Module Map

```
core/        (the hexagon's center — pure domain, ZERO infra imports, unit-testable)
  slide/
    tag-section.ts        tagSection(content, sectionId)
    slide-visibility.ts   isSlideHiddenContent / setSlideHiddenContent
    frame-inject.ts       inject slides into frame_html (<!-- slides --> rules)
    frame-parse.ts        split frame into html/css/js parts (frame editor)
  render/
    slide-presentation.ts SlidePresentation runtime (keyboard/touch/wheel/fragments)
    sanitize.ts           sanitize cleaners for present/view (DOMPurify via a port-injected fn)
  markdown/markdown-lite.ts
  text/  slugify.ts  section-id.ts
  model/ deck.ts slide.ts notes.ts history.ts   (entities + value types, no behavior coupling)

ports/       (interfaces ONLY — the boundary the core owns; no implementations, no imports)
  auth-port.ts            AuthPort           (SPEC §4.1 — getSession/login*/logout/onAuthStateChange/requireLogin)
  deck-store-port.ts      DeckStorePort      (decks CRUD, share token, owner-scoped)
  slide-store-port.ts     SlideStorePort     (slides CRUD, updateContent, reorder)
  notes-store-port.ts     NotesStorePort     (notes upsert/get)
  history-store-port.ts   HistoryStorePort   (slide/notes/frame history, auto-dedup, manual batch)
  blob-storage-port.ts    BlobStoragePort    (images upload/list/delete, path + url resolution)
  realtime-port.ts        RealtimePort       (broadcast/subscribe {section_id, index})
  share-read-port.ts      ShareReadPort      (anon token-scoped deck/slide reads)
  audio-cache-port.ts     AudioCachePort     (pronunciation cache: audio/history/recordings)
  sanitizer-port.ts       SanitizerPort      (html sanitize fn — keeps DOMPurify out of core)

adapters/    (the ONLY place infra SDKs live — each implements one or more ports)
  supabase/   (cloud; also works against the Supabase local stack — same code, different URL)
    supabase-client.ts        the one and only `createClient(...)` call
    supabase-auth.ts          implements AuthPort via supabase.auth.*
    supabase-deck-store.ts    implements DeckStorePort
    supabase-slide-store.ts   implements SlideStorePort (reorder → reorder_slides RPC)
    supabase-notes-store.ts   supabase-history-store.ts
    supabase-blob-storage.ts  implements BlobStoragePort (slides-images bucket)
    supabase-realtime.ts      implements RealtimePort (broadcast channel)
    supabase-share-read.ts    implements ShareReadPort (public_get_* RPC)
  local/      (vendor-neutral; talks to the Dockerized local stack — see §3.4)
    rest-client.ts            tiny typed fetch wrapper for the local data API (PostgREST-compatible)
    local-auth.ts             implements AuthPort against the local auth service (dev JWT)
    local-deck-store.ts ...   one file per *-store-port, mirroring the supabase set
    local-blob-storage.ts     S3/MinIO or file-server backed
    local-realtime.ts         WebSocket broadcast
    local-share-read.ts
  browser/    (browser-native infra, host-agnostic — same for both backends)
    indexeddb-audio-cache.ts  implements AudioCachePort (pronunciation-cache v3)
    dompurify-sanitizer.ts    implements SanitizerPort
  memory/     (in-memory fakes for Vitest — implement every store port)
    memory-deck-store.ts ...  contract-tested against the real adapters

features/    (use-cases — orchestrate ports + core; depend on PORTS ONLY, never adapters)
  auth/        require-login.ts  account-menu.ts
  editor/      slide-list.ts inline-editor.ts raw-html-editor.ts frame-editor.ts
               notes-editor.ts history-ui.ts images-modal.ts svg-picker.ts share-modal.ts
  present/     present-runtime.ts  sync.ts
  pronunciation/ training-panel.ts
  export/      export-html.ts export-marp.ts export-pptx.ts export-pdf.ts
  import/      import-html.ts

ports/ports.ts (the Ports bundle type { auth, deckStore, slideStore, ... } — see §5)

composition/ (the composition root — the ONLY module that imports adapters)
  env.ts                   typed config loader (replaces window.* globals)
  container.ts             reads env.backend ('supabase' | 'local'), builds the Ports bundle
  index.ts                 export `getPorts(): Ports` for pages to call once at boot

pages/       (driving adapters — thin entry points, one per HTML file)
  login.ts dashboard.ts edit.ts edit-frame.ts present.ts note.ts view.ts training.ts
  each: `const ports = getPorts(); wirePage(ports, dom)`  — no infra knowledge

ui/          (cross-page presentation)
  theme.ts toast.ts dom-prompt.ts shortcuts-help.ts dom.ts(typed $/$$)  constants.ts  styles/*.css
```

**Dependency rule (enforced by review + ESLint `no-restricted-imports`):**

| Layer | May import | Must NOT import |
|---|---|---|
| `core/` | (nothing app/infra) | ports, adapters, supabase, app DOM |
| `ports/` | `core/model` types only | any adapter, any SDK |
| `adapters/` | `ports/`, `core/`, its own SDK | `features/`, `pages/`, other adapter families |
| `features/` | `ports/`, `core/`, `ui/` | `adapters/`, `@supabase/*` |
| `composition/` | everything (the wiring seam) | — |
| `pages/` | `features/`, `composition` (getPorts), `ui/` | `adapters/`, `@supabase/*` |

A single ESLint rule — `no-restricted-imports` banning `@supabase/*` everywhere except `adapters/supabase/**` — guarantees the dependency stays minimal and provable, not aspirational.

### 2.3 Why this serves the goals

- **Minimal Supabase coupling:** `@supabase/supabase-js` is imported in exactly one folder. Removing Supabase = deleting `adapters/supabase/` and pointing `container.ts` at another adapter set. The other ~95% of the codebase never changes.
- **SRP:** one port = one capability; one adapter file = one port for one backend. The old monolithic `edit-bootstrap.js` becomes discrete `features/editor/*` use-cases.
- **SoC:** infra (HTTP, SQL, SDK) lives only in `adapters/`; domain rules live only in `core/`; wiring lives only in `composition/`.
- **Testability:** `features/*` use-cases are tested against `adapters/memory/*`; a shared **port contract test** runs the same spec against memory, supabase-local, and local-docker adapters so they stay behaviorally identical.
- **Readability:** typed DOM accessors (`el('#slide-list-items')`) replace `getElementById(...): any`; config is `env.ts`, not `window.SUPABASE_URL`.

---

## 3. Project Setup

### 3.1 Tooling

| Concern | Choice | Reason |
|---|---|---|
| Language | TypeScript (strict) | contracts enforced at compile time |
| Bundler/dev server | Vite (multi-page) | one `input` per HTML page; static output |
| Lint | ESLint + `@typescript-eslint`, import-boundary rule | guards layering |
| Format | Prettier | uniform readability |
| Test | Vitest | unit-test `core/*` + repo logic with mocks |
| Backend | Supabase JS v2, DOMPurify | per SPEC §2.1 |

### 3.2 Vite multi-page config

Each SPEC page is a real HTML entry (preserves the public-filename contract from SPEC §3):

```ts
// vite.config.ts — rollupOptions.input maps every page
input: {
  main: 'index.html', login: 'login.html', edit: 'edit.html',
  editFrame: 'edit-frame.html', present: 'present.html',
  note: 'note.html', view: 'view.html', training: 'training.html',
}
```

Public URLs stay identical to SPEC (`edit.html?deck=...`, `view.html?deck=...&token=...`), so the page contract is preserved.

### 3.3 npm scripts

```jsonc
{
  "dev": "vite",                          // frontend only (HMR)
  "dev:full": "npm run stack:up && vite", // backend (Docker) + frontend together
  "build": "tsc --noEmit && vite build",  // type-check gate before bundle
  "preview": "vite preview",
  "lint": "eslint . && prettier --check .",
  "test": "vitest run",                   // includes the port contract suite
  "stack:up": "docker compose up -d --wait",   // bring up the local backend (see §3.5)
  "stack:down": "docker compose down",
  "stack:reset": "docker compose down -v && npm run stack:up && npm run db:migrate && npm run db:seed",
  "db:migrate": "node scripts/migrate.mjs", // applies supabase/migrations/* in order to the active DB
  "db:seed": "node scripts/seed.mjs",
  "import": "tsx scripts/import.ts"
}
```

The migrate/seed scripts target the **active backend** by env (`BACKEND=local` → Dockerized Postgres; `BACKEND=supabase` → remote). Same SQL, two destinations — the schema is backend-neutral.

### 3.4 Configuration (replaces `config.local.js`)

`.env.local` (gitignored) + one typed loader in the composition root. No `window.*` globals; nothing outside `composition/` reads config.

```ts
// composition/env.ts
export const env = {
  backend: import.meta.env.VITE_BACKEND ?? 'local',   // 'supabase' | 'local' — selects the adapter set
  // supabase adapter (cloud OR `supabase start` local stack — both just a URL)
  supabaseUrl: import.meta.env.VITE_SUPABASE_URL,
  supabaseAnonKey: import.meta.env.VITE_SUPABASE_ANON_KEY,
  // local (vendor-neutral Docker) adapter
  localApiUrl: import.meta.env.VITE_LOCAL_API_URL,        // PostgREST-compatible data API
  localAuthUrl: import.meta.env.VITE_LOCAL_AUTH_URL,
  localStorageUrl: import.meta.env.VITE_LOCAL_STORAGE_URL,
  localRealtimeUrl: import.meta.env.VITE_LOCAL_REALTIME_URL,
  // pronunciation (engine config, backend-agnostic)
  pronunciationTts: import.meta.env.VITE_PRONUNCIATION_TTS ?? 'kokoro',
  // ...kokoro / stt / openai keys
} as const;
```

`composition/container.ts` reads `env.backend` once and returns a fully-wired `Ports` bundle; pages call `getPorts()` and never see config again. The legacy `window.OWNER_PASSPHRASE` path is **not implemented** (SPEC §13).

### 3.5 Local Backend via Docker — runs with zero friction

Goal: `git clone && cp .env.example .env.local && npm i && npm run dev:full` brings up a working app with **no Supabase account and no cloud calls**. Two supported Docker paths share the same ports, so the app code is identical either way:

**Path A — Vendor-neutral stack (default, lowest lock-in).** A `docker-compose.yml` at the repo root brings up open-source pieces that satisfy each port:

| Port | Local container | Notes |
|---|---|---|
| data (deck/slide/notes/history stores) | **Postgres** + **PostgREST** | PostgREST exposes the same REST/RPC shape the supabase adapter pattern already speaks; `local/rest-client.ts` is a ~50-line typed fetch wrapper |
| `AuthPort` | **GoTrue** (OSS, the same engine Supabase Auth uses) or a tiny dev-auth issuing signed JWTs | email/password + magic-link-dev endpoint; JWT `sub` = `auth.uid()` for RLS |
| `BlobStoragePort` | **MinIO** (S3-compatible) or a small static file server | object paths `{deck_id}/...`; public-read bucket |
| `RealtimePort` | a ~30-line **WebSocket broadcaster** container | channel `slides-editor-sync-<room>`, event `slide` |

`docker compose up -d --wait` + `npm run db:migrate` and the backend is ready. RLS works because GoTrue-issued JWTs carry `sub`/`role` exactly like Supabase, so `0004_rls.sql` is unchanged.

**Path B — Supabase local stack (one command, when you want 1:1 cloud parity).** `npx supabase start` runs the official containers (Postgres + GoTrue + Storage + Realtime) in Docker. Set `VITE_BACKEND=supabase` with the printed localhost URL/anon-key and the **same `adapters/supabase/` code** runs locally and in the cloud.

Either way the dependency on Supabase stays inside `adapters/`. Path A is the default because it proves the abstraction (the app runs with no Supabase code in the loop at all); Path B exists for teams that want exact cloud behavior while developing. The choice is one env var, never a code change.

---

## 4. Data Layer (backend-neutral SQL)

Migrations are **plain Postgres SQL** in `supabase/migrations/` (folder name kept for `supabase start` compatibility) and mirror SPEC §5–8. The same files apply to the Dockerized local Postgres (Path A) and the Supabase project (Path B) via `scripts/migrate.mjs` — there is no Supabase-specific DDL beyond the `auth.users` reference and RLS `auth.uid()`, both of which GoTrue provides locally. Build them in dependency order:

| File | Contents | SPEC ref |
|---|---|---|
| `0001_init.sql` | `decks`, `slides`, `notes` tables + `owner_id` columns | §5.2–5.4 |
| `0002_history.sql` | `history_kind` enum, `slide_history`, `notes_history`, `frame_history` | §5.5 |
| `0003_profiles.sql` | optional `profiles` table | §5.6 |
| `0004_rls.sql` | enable RLS; owner select/insert/update/delete on `decks`; child-via-parent policies | §6.1 |
| `0005_rpc.sql` | `reorder_slides`, `public_get_deck`, `public_get_slides`; grants | §6.2, §7 |
| `0006_storage.sql` | `slides-images` bucket; public read; owner-scoped write by `{deck_id}/` prefix | §6.3, §8 |
| `seed.sql` | one dev user + one sample deck/slides/notes | §2.2 |

**Critical correctness rules to encode (from SPEC):**
- `slides` unique `(deck_id, "order")` is `deferrable initially immediate`; `reorder_slides` does `set constraints all deferred`.
- `reorder_slides` and all owner-mutation RPCs verify `auth.uid()` owns the deck; **never granted to `anon`**.
- Share reads go through `public_get_*` RPCs granted to `anon` returning sanitized fields only — not broad anon table reads.
- Storage object paths must begin with `{deck_id}/`; policy verifies ownership of that deck.

This is the **security boundary** — it ships in Phase 1, not bolted on later.

---

## 5. Core Contracts (typed interfaces)

The **ports** are these contracts. Define them first — they are the seams every adapter implements and every use-case depends on. A `Ports` bundle (`ports/ports.ts`) groups them so `getPorts()` (from `composition/`) returns one injectable object.

```ts
// ports/auth-port.ts
export interface AuthUser { id: string; email: string | null; displayName?: string | null; avatarUrl?: string | null; }
export interface AuthSession { user: AuthUser; accessToken?: string; }
export interface AuthPort {
  getSession(): Promise<AuthSession | null>;
  getUser(): Promise<AuthUser | null>;
  loginWithEmailPassword(email: string, password: string): Promise<AuthSession>;
  loginWithMagicLink(email: string, redirectTo: string): Promise<void>;
  loginWithOAuth(provider: string, redirectTo: string): Promise<void>;
  logout(): Promise<void>;
  onAuthStateChange(cb: (s: AuthSession | null) => void): () => void;
  requireLogin(opts: { redirectTo: string }): Promise<AuthSession>;
}

// ports/slide-store-port.ts
export interface SlideStorePort {
  listByDeck(deckId: string): Promise<Slide[]>;          // ordered by "order"
  updateContent(deckId: string, sectionId: string, content: string): Promise<void>;
  add(deckId: string, slide: NewSlide): Promise<void>;
  remove(deckId: string, sectionId: string): Promise<void>;
  reorder(deckId: string, sectionIds: string[]): Promise<void>; // backend maps to its own reorder
}

// ports/ports.ts — the injectable bundle pages receive
export interface Ports {
  auth: AuthPort; deckStore: DeckStorePort; slideStore: SlideStorePort;
  notesStore: NotesStorePort; historyStore: HistoryStorePort;
  blobStorage: BlobStoragePort; realtime: RealtimePort;
  shareRead: ShareReadPort; audioCache: AudioCachePort; sanitizer: SanitizerPort;
}

// core/slide/tag-section.ts — pure, no port needed
export function tagSection(content: string, sectionId: string): string; // SPEC §10.2
```

Each port has **N adapter implementations** (`adapters/supabase/*`, `adapters/local/*`, `adapters/memory/*`) satisfying the identical interface — pages depend only on the port, so page code never changes between Supabase, Docker-local, or test backends (SPEC §4.3 generalized to every capability, not just auth).

**English-only note:** the old `add slide` default content used Korean (`새 슬라이드` / `내용을 입력하세요`). Slideflow uses `New slide` / `Add your content here.` Same for `(빈 노트)` → `(empty note)` and `read-only · shared view` stays English.

---

## 6. Phased Build Order

Each phase is a **vertical slice**: it compiles, runs, and is verifiable on its own. Acceptance items (SPEC §14) are mapped per phase so "done" is testable.

### Phase 0 — Skeleton + hexagon seams (foundation)
- Vite multi-page scaffold, `tsconfig` strict, Prettier, Vitest.
- ESLint import-boundary rules: the layer table (§2.2) + `no-restricted-imports` banning `@supabase/*` outside `adapters/supabase/**`.
- Define all `ports/*` interfaces (empty contracts) + the `Ports` bundle.
- `composition/`: `env.ts`, `container.ts` (returns `Ports`), `getPorts()`.
- `adapters/memory/*` for every store port (so the app runs with no backend at all).
- `docker-compose.yml` (Path A stack) + `scripts/migrate.mjs` / `seed.mjs`; `npm run stack:up` boots cleanly.
- `ui/`: `theme.ts` + token CSS (SPEC §12), `dom.ts`, `constants.ts`.
- Empty typed page entries that boot, call `getPorts()`, and apply theme.
- **Exit:** `npm run build` type-checks clean; `npm run dev` runs on memory adapters; `npm run stack:up` is green; every page loads dark theme.

### Phase 1 — Auth + DB + RLS (the security spine)
- Migrations `0001`–`0006` + seed; `npm run db:migrate` applies to **both** the Docker Postgres (Path A) and a Supabase project (Path B) from the same SQL.
- `ports/auth-port.ts` + `adapters/supabase/supabase-auth.ts` + `adapters/local/local-auth.ts` (both satisfy `AuthPort`); add to the `Ports` bundle.
- `features/auth/require-login.ts` guard, `account-menu.ts`, `auth.css`.
- `login.html` + `pages/login.ts`: email/password, magic link, OAuth(google), `next` param, error in `auth-error`, redirect-if-already-authed.
- Wire the guard into every owner page stub; logout everywhere.
- **Acceptance:** §14 login/redirect/guard/logout/expired-session items; RLS enabled and proven on the local Docker stack (no cloud needed).

### Phase 2 — Dashboard + Deck lifecycle + Import
- `ports/deck-store-port.ts` + `adapters/{supabase,local,memory}/*-deck-store.ts` (owner-scoped list, sort `updated_at desc`).
- `pages/dashboard.ts` (`index.html`): deck list with correct links (edit/present/note/training/share), account menu.
- `features/import/import-html.ts`: section extraction, id priority + dedup, frame build, notes mapping; redirect to edit.
- **Acceptance:** §14 dashboard-only-owner-decks, import creates owned deck + redirects, notes-by-index.

### Phase 3 — Edit core (slides + notes + iframe)
- `ports/slide-store-port.ts` + `ports/notes-store-port.ts` (+ supabase/local/memory adapters); `core/slide/*` (tag-section, visibility, frame-inject).
- `pages/edit.ts` wiring: toolbar, mode-select, panels, localStorage panel sizes + `lastSectionId`.
- `features/editor/slide-list.ts`: add/duplicate/delete/reorder (RPC + rollback)/hide-show.
- `edit-frame.html` + `pages/edit-frame.ts` + `features/editor/inline-editor.ts`: postMessage data request, contenteditable marking, `edit:dirty`/`edit:save` debounce 800ms.
- `features/editor/raw-html-editor.ts` (CodeMirror-or-textarea, section-tag validation).
- `features/editor/notes-editor.ts` (debounce 800ms, autosave toggle, flush on switch/beforeunload; markdown preview + history + manual snapshot, absorbing the dropped `script-edit.html`).
- Title editing (debounce 600ms, flush on enter/blur).
- **Acceptance:** §14 edit-loads, add/dup/del/reorder/hide, inline save + auto-history dedup, raw HTML save, notes save + history.

### Phase 4 — Present + Sync + View (sharing)
- `core/render/slide-presentation.ts` + `sanitize.ts`.
- `features/present/present-runtime.ts`: sanitize frame, inject visible slides, `document.open/write/close`, overlay chrome (`__se_progress/chrome/counter/sync/navdots`), fallback CSS, print mode (`print=1`), start-section resolution, runtime extras (`data-hl/hr/pg`).
- `ports/realtime-port.ts` + `adapters/{supabase,local}/*-realtime.ts`; `features/present/sync.ts` (channel `slides-editor-sync-<room>`, event `slide`, `{section_id,index}`).
- `share-modal.ts` (generate/rotate/revoke via `crypto.randomUUID()`).
- `ports/share-read-port.ts` + adapters + `view.html` + `pages/view.ts`: token-validated read-only, no notes/history/owner leak, Home + `read-only · shared view` label.
- **Acceptance:** §14 share lifecycle, shared-view-no-private-data, present full behavior, sync.

### Phase 5 — Frame editor + History + Images + SVG
- `features/editor/frame-editor.ts` (`core/slide/frame-parse.ts`: split style/script/html; reassemble; `<!-- slides -->` insertion fallback).
- `ports/history-store-port.ts` + adapters + `features/editor/history-ui.ts`: merged sorted history, filter-to-section, view preview (6000 char), restore, `saveVersionPrompt` manual batch.
- `ports/blob-storage-port.ts` + adapters (supabase bucket / local MinIO) + `features/editor/images-modal.ts` (safe filename, path `{deck_id}/{ts36}-{name}`, copy/insert/delete).
- `features/editor/svg-picker.ts` (built-in shapes + custom SVG validation).
- Shortcuts (`H`/`I`/`Cmd+S`/`?`) + `shortcuts-help.ts`.
- **Acceptance:** §14 frame editor, history drawer, image CRUD, SVG picker.

### Phase 6 — Teleprompter (note) view + Export
- `pages/note.ts` (`note.html`, renamed from SPEC `script.html`): teleprompter/read view — font/HL/nav, sync-follow unless manual, wake lock.
- `features/export/*`: html (strip editing attrs, resolve `supabase://` srcs), marp notes (`buildNotesMd`), pptx (`PptxGenJS`), pdf (open `present.html?print=1`).
- Note: SPEC `script-edit.html` and `notes.html` are **dropped**. Markdown notes editing (preview, debounced save, history, manual snapshot) lives in `edit.html`'s notes panel (Phase 3). Marp copy/download/TTS becomes part of the export feature, not a standalone page.
- **Acceptance:** §14 script/teleprompter view, HTML/PDF/PPTX/notes export. (script-edit and notes-view acceptance items are satisfied inside edit + export.)

### Phase 7 — Training (pronunciation)
- `ports/audio-cache-port.ts` + `adapters/browser/indexeddb-audio-cache.ts` (IndexedDB `pronunciation-cache` v3, stores audio/history/recordings — backend-agnostic).
- `features/pronunciation/training-panel.ts`: TTS (Kokoro/OpenAI/ElevenLabs), STT (VibeVoice/MLX, Web Speech, Whisper), LCS+Levenshtein scoring (`great/ok/poor`), full-deck WAV export.
- `pages/training.ts` (`training.html`, renamed from SPEC `pronunciation.html`): 3-pane, resizers, `buildNotesMd` mapping.
- **Acceptance:** §14 pronunciation/training full behavior.

### Phase 8 — Hardening
- Vitest coverage on `core/*` (tag-section, visibility, frame-inject, slugify, section-id dedup, markdown-lite).
- **Port contract suite:** one shared spec per store port, run against `memory`, `local` (Docker), and `supabase` adapters — guarantees all three behave identically.
- RLS/storage policy verification on both the Docker stack and a real Supabase project (`get_advisors`).
- Accessibility/loading states for auth-checking, session-expired write-disable.
- README: setup, env, migrations, local stack.

---

## 7. Conventions (readability contract)

- **Files:** one primary export per file; filename = export in kebab-case. No `index.ts` barrels that hide origins except per top-level layer if needed.
- **Functions:** prefer < 40 lines; extract when a comment would describe a block — name the function instead.
- **DOM:** never raw `getElementById` in features; use typed `el(selector)` from `ui/dom.ts` which throws on missing required nodes and returns `null` for optional ones (SPEC §13 tolerated-missing-ids handled explicitly).
- **No magic strings:** localStorage keys, channel names, query params, storage paths live in named constants (`ui/constants.ts`, `core/*`).
- **Errors:** adapters throw typed errors; features translate to `ui/toast.ts`; pages never `alert()`.
- **Async:** all port methods return Promises; no fire-and-forget except explicitly best-effort history appends (named `appendAuto*` and `void`-marked with a comment).
- **English-only:** enforced by a lint check / review; all user-facing strings, defaults, comments in English.

---

## 8. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| `document.open/write/close` + Vite module loading interaction | Present/view pages write fully self-contained docs; the writing page's own bundle finishes before `document.write`. Validate early in Phase 4. |
| iframe inline editor needs same-origin + config | `edit-frame.html` is a Vite entry sharing the same origin; data passed via postMessage, with RLS-authorized direct-fetch fallback. |
| RLS mistakes leak data | Phase 1 ships RLS + an integration check that an unauthorized user cannot read another's deck, run against the Docker stack; re-verify in Phase 8 with `get_advisors`. |
| Local vs remote adapter drift | Every port has a shared **contract test** run against `memory`, `local` (Docker), and `supabase` adapters — they cannot diverge silently. |
| Local stack ≠ Supabase semantics (RLS/JWT) | Path A uses GoTrue (the same engine Supabase Auth uses) so JWT `sub`/`role` claims match; RLS SQL is identical. Path B (`supabase start`) is available for exact parity when needed. |
| Docker stack flakiness on fresh clone | `docker compose up --wait` + healthchecks; `npm run stack:reset` rebuilds from zero; migrate/seed are idempotent. |
| Hidden Supabase coupling creeping in | `no-restricted-imports` ESLint rule fails CI if `@supabase/*` is imported outside `adapters/supabase/**`. |

---

## 9. Definition of Done

Slideflow is complete when **all 14 SPEC §14 acceptance items pass**, the import-boundary lint (including the `@supabase/*` ban outside `adapters/supabase/**`) is green, `tsc --noEmit` is clean, the **port contract suite passes on memory + Docker-local + Supabase adapters**, a fresh clone runs end-to-end on the Docker stack with **no Supabase account** (`npm run dev:full`), and a remote Supabase deployment has RLS enabled for decks/slides/notes/history/storage with no client-passphrase path anywhere.
