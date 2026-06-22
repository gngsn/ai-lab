# slides-editor Rebuild SPEC

> Purpose: rebuild the current `slides-editor/` as closely as possible, including features, data, screens, URLs, save rules, runtime behavior, and known quirks.
>
> This is not a future roadmap. It is an **implementation reproduction contract** for the app that exists now.

---

## 1. Product Summary

`slides-editor` is a static browser app for one presenter to create HTML slide decks, edit speaker notes, present slides, sync a teleprompter view in realtime, export the deck, and practice pronunciation.

Core rules:

- Backend is Postgres, Storage, and Broadcasting
  - Local: Postgres Docker + File System + ??
  - Remote: Supabase + Supabase Storage + Supabase Realtime
- The app runs as static files. Local dev uses `python3 -m http.server 8000` or another static server.
- Owner pages require a logged-in user session.
- The app must provide first-class login and logout flows.
- Shared viewing is read-only and uses `decks.share_token`.
- Slide content is stored as raw HTML, one `<section>` per `slides` row.
- Deck shell HTML is stored in `decks.frame_html` and receives slides at `<!-- slides -->`.

Non-goals:

- Multi-user simultaneous editing, CRDT, or merge conflict handling.
- Full drag-and-drop slide layout builder.
- Anonymous write access.
- Client-side passphrase as a real security boundary.

Security goal:

- The service must treat authentication as a backend-backed session, not as a value stored in `config.local.js`.
- Remote mode should use Supabase Auth and Row Level Security.
- Local mode should provide an auth-compatible development adapter, or run the Supabase local stack, so the frontend uses the same login/logout contract.

---

## 2. Runtime And Setup

### 2.1 Stack

- Browser-only frontend with ES modules.
- `package.json` has `"type": "module"`.
- Node scripts are used for config, vendoring, and CLI import.
- Main third-party browser dependencies:
  - Supabase client from `vendor/modules/supabase-client.mjs`.
  - DOMPurify from `vendor/modules/dompurify.mjs`.
  - CodeMirror, if available, for raw HTML editing.
  - highlight.js, if available, for raw textarea highlighting.

### 2.2 Commands

```bash
npm install
npm run build:vendor
npm run dev
```

Required npm scripts:

- `build`: `node scripts/build-config.mjs`
- `build:vendor`: `node scripts/build-vendor-modules.mjs`
- `dev`: `python3 -m http.server 8000`
- `import`: `node scripts/import.mjs`

Recommended new scripts for login-enabled development:

- `dev:local-stack`: starts local Postgres/Auth/Storage/Broadcasting services, if local adapters are implemented.
- `db:migrate`: applies migrations in order.
- `db:seed`: creates a sample user and sample deck for development.

### 2.3 Configuration

`js/config.local.js` is gitignored and copied from `js/config.local.js.example`.

Required remote globals:

```js
window.SUPABASE_URL = "https://YOUR-PROJECT-REF.supabase.co";
window.SUPABASE_ANON_KEY = "YOUR-ANON-KEY";
window.AUTH_PROVIDER = "supabase";
```

Required local globals:

```js
window.AUTH_PROVIDER = "local";
window.LOCAL_API_URL = "http://localhost:8787";
window.LOCAL_STORAGE_URL = "http://localhost:8787/files";
window.LOCAL_BROADCAST_URL = "ws://localhost:8787/realtime";
```

Removed configuration:

- `window.OWNER_PASSPHRASE` must not be used for production auth.
- Existing passphrase behavior may remain only as a temporary migration fallback and must be marked deprecated.

Pronunciation globals:

- `window.PRONUNCIATION_TTS`: `kokoro`, `openai`; default `kokoro`.
- `window.KOKORO_TTS_URL`, `window.KOKORO_TTS_MODEL`, `window.KOKORO_VOICE`.
- `window.PRONUNCIATION_STT`: `vibevoice`, `webspeech`, or `whisper`; default `vibevoice`.
- `window.MLX_STT_URL`, `window.MLX_STT_MODEL`, `window.OPENAI_API_KEY`.

---

## 3. Required File Structure

The public filenames are part of the app contract.

```text
slides-editor/
  index.html
  login.html
  edit.html
  edit-frame.html
  present.html
  script.html
  script-edit.html
  notes.html
  view.html
  pronunciation.html
  js/
    auth.js
    auth-bootstrap.js
    auth-provider.js
    config.local.js.example
    dom-prompt.js
    edit-bootstrap.js
    edit-frame-bootstrap.js
    export.js
    history-ui.js
    import-html.js
    inline-editor.js
    markdown-lite.js
    present-bootstrap.js
    pronunciation.js
    script-edit-view.js
    script-view.js
    shortcuts-help.js
    slide-render.js
    slide-runtime.js
    slide-visibility.js
    storage-src.js
    supabase.js
    sync.js
    training-panel.js
    view-bootstrap.js
    repo/
      audio-repo.js
      deck-repo.js
      history-repo.js
      notes-repo.js
      slide-repo.js
      storage-repo.js
  css/
    auth.css
    history-ui.css
    shortcuts-help.css
    training-panel.css
  migrations/
    001_init.sql
    002_history.sql
    003_rls.sql
    004_rpc.sql
    005_storage.sql
    006_frame_history.sql
    007_auth_ownership.sql
    seed.sql
  scripts/
    build-config.mjs
    build-vendor-modules.mjs
    import.mjs
  vendor/
```

New files:

- `login.html`: the login page.
- `js/auth-bootstrap.js`: mounts the login page UI.
- `js/auth-provider.js`: provider abstraction for Supabase Auth and local auth.
- `css/auth.css`: shared login/account styles.

---

## 4. Auth Model

### 4.1 Session Contract

The frontend must use a provider-agnostic auth API.

```js
getSession(): Promise<{ user: AuthUser, accessToken?: string } | null>
getUser(): Promise<AuthUser | null>
loginWithEmailPassword(email, password): Promise<AuthSession>
loginWithMagicLink(email, redirectTo): Promise<void>
loginWithOAuth(provider, redirectTo): Promise<void>
logout(): Promise<void>
onAuthStateChange(callback): () => void
requireLogin({ redirectTo }): Promise<AuthSession>
```

`AuthUser` shape:

```ts
type AuthUser = {
  id: string;
  email: string | null;
  displayName?: string | null;
  avatarUrl?: string | null;
};
```

### 4.2 Supabase Auth Provider

Remote mode uses Supabase Auth.

Required behavior:

- Use `supabase.auth.getSession()` for existing sessions.
- Use `supabase.auth.signInWithPassword()` for email/password login when enabled.
- Use `supabase.auth.signInWithOtp()` for magic link login when enabled.
- Use `supabase.auth.signInWithOAuth()` for OAuth providers when enabled.
- Use `supabase.auth.signOut()` for logout.
- Subscribe with `supabase.auth.onAuthStateChange()`.
- Supabase Auth persistence may use the Supabase client default localStorage session.

### 4.3 Local Auth Provider

Local mode must expose the same API. Two acceptable implementations:

- Preferred: use Supabase local stack so Auth, Postgres, Storage, and Realtime behave like remote.
- Alternative: provide a local API server with `/auth/login`, `/auth/logout`, `/auth/session`, `/auth/magic-link/dev`, plus signed development JWTs.

Local mode must not require changing page code. Only the provider implementation changes.

### 4.4 Login Page

`login.html` is the only interactive unauthenticated owner page.

Query params:

- `next`: path to return to after login. Default `index.html`.
- `mode`: optional `password`, `magic`, or `oauth`.

Main DOM ids:

- `auth-form`
- `auth-email`
- `auth-password`
- `auth-login-btn`
- `auth-magic-btn`
- `auth-oauth-google`
- `auth-error`
- `auth-status`

Behavior:

- If already logged in, redirect to `next`.
- Email/password submit signs in and redirects to `next`.
- Magic link sends the email and shows a check-your-email state.
- OAuth opens the provider flow with `redirectTo` carrying `next`.
- Errors are displayed in `auth-error`.
- Login page must never expose service-role keys.

### 4.5 Logout

Every owner page must expose logout from the toolbar or account menu.

Required DOM ids/classes:

- `account-menu` or `.account-menu`
- `account-email`
- `logout-btn`

Logout behavior:

- Call `logout()` from `auth-provider.js`.
- Clear any provider session state.
- Redirect to `login.html` with no privileged data in the query string.
- If logout fails, show an error toast/status and keep the current page state read-only until the session is known.

### 4.6 Owner Page Guard

Owner-only pages:

- `index.html`
- `edit.html`
- `present.html`
- `script-edit.html`
- `notes.html`
- `pronunciation.html`

Guard behavior:

- On page boot, call `requireLogin({ redirectTo: location.href })`.
- If no session exists, redirect to `login.html?next=<encoded current path>`.
- While checking auth, show a neutral loading state.
- If the session expires while a page is open, disable writes, show session-expired UI, and redirect to login after unsaved buffers are flushed or abandoned by the user.

Public pages:

- `login.html`
- `view.html` with share token.
- Exported standalone HTML files.

---

## 5. Database Schema

### 5.1 Ownership Columns

All owner-managed records must be scoped by authenticated user.

`decks` must include:

```sql
owner_id uuid not null references auth.users(id) on delete cascade,
owner_email text,
```

`owner_email` is display/cache data only. Authorization uses `owner_id`.

### 5.2 `decks`

```sql
create table decks (
  deck_id varchar(200) primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  owner_email text,
  title text not null default 'Untitled',
  frame_html text not null,
  share_token text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

Rules:

- `deck_id` is the stable URL and storage namespace.
- `owner_id` is the security boundary.
- `frame_html` is a whole HTML shell.
- If it contains `<!-- slides -->`, joined slide HTML replaces that marker.
- If the marker is missing, slide HTML is inserted before `</body>`.
- `share_token` enables `view.html?deck=...&token=...`.

### 5.3 `slides`

```sql
create table slides (
  deck_id varchar(200) not null references decks(deck_id) on delete cascade,
  section_id varchar(100) not null,
  "order" smallint not null check ("order" between 0 and 200),
  title varchar(200) not null default 'Untitled',
  content text not null,
  updated_at timestamptz not null default now(),
  primary key (deck_id, section_id),
  constraint slides_deck_order_unique
    unique (deck_id, "order") deferrable initially immediate
);
```

Rules:

- `content` is exactly one `<section ...>...</section>` string.
- Slides render by `order` ascending.
- Runtime must call `tagSection(content, section_id)` before injection.
- Hidden slides use `data-hidden="true"` on the section.

### 5.4 `notes`

```sql
create table notes (
  deck_id varchar(200) not null references decks(deck_id) on delete cascade,
  section_id varchar(100) not null,
  content text not null default '',
  updated_at timestamptz not null default now(),
  primary key (deck_id, section_id)
);
```

Rules:

- Notes match slides by `section_id`.
- `content` is Markdown.
- Missing notes are treated as empty strings.

### 5.5 History Tables

```sql
create type history_kind as enum ('auto', 'manual');
```

`slide_history`, `notes_history`, and `frame_history` share this shape:

```sql
id bigserial primary key,
deck_id varchar(200) not null references decks(deck_id) on delete cascade,
section_id varchar(100) not null,
content text not null,
kind history_kind not null,
message text,
created_at timestamptz not null default now()
```

Rules:

- `frame_history.section_id` defaults to `frame`.
- History belongs to a deck and is authorized through `decks.owner_id`.
- Auto history compares with the latest row for the same deck/section and skips exact duplicate content.
- Slide, note, and frame saves append auto history best-effort.
- Manual snapshots insert one row per slide, note, and frame with the same `created_at` and `message`.

### 5.6 Optional Profiles

If the UI needs display names or avatars, add:

```sql
create table profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text,
  display_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

---

## 6. Row Level Security

Remote mode must enable RLS for all owner-managed tables.

### 6.1 Owner Read/Write Policy

For `decks`:

```sql
create policy "owner decks select"
  on decks for select
  using (auth.uid() = owner_id);

create policy "owner decks insert"
  on decks for insert
  with check (auth.uid() = owner_id);

create policy "owner decks update"
  on decks for update
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

create policy "owner decks delete"
  on decks for delete
  using (auth.uid() = owner_id);
```

For child tables, authorize through parent deck:

```sql
exists (
  select 1 from decks
  where decks.deck_id = slides.deck_id
    and decks.owner_id = auth.uid()
)
```

Apply equivalent policies to:

- `slides`
- `notes`
- `slide_history`
- `notes_history`
- `frame_history`

### 6.2 Shared Read Policy

Do not expose broad anonymous table reads for sharing.

Preferred approach:

- Create RPCs such as `public_get_deck(p_deck_id text, p_token text)` and `public_get_slides(p_deck_id text, p_token text)`.
- Grant execute to `anon`.
- RPC returns sanitized/minimal fields only when token matches.

Acceptable temporary approach:

- `view.html` fetches deck/slides with anon key and validates token client-side.
- This is allowed only for local/trusted deployment and must be labeled insecure.

### 6.3 Storage Policies

Remote storage bucket `slides-images`:

- Public read is allowed.
- Insert/update/delete require owner session and deck ownership.
- Object paths must begin with `{deck_id}/`.
- Policy must verify that authenticated user owns that `deck_id`.

---

## 7. RPC

`reorder_slides(p_deck_id text, p_section_ids text[]) returns void`

Rules:

- Function must verify that `auth.uid()` owns `p_deck_id`.
- Defers constraints with `set constraints all deferred`.
- Updates `slides.order = array index - 1`.
- Grants execute to `authenticated`.
- Do not grant owner mutation RPCs to `anon`.

---

## 8. Storage

- Bucket: `slides-images`.
- Public read.
- Path: `{deck_id}/{timestamp36}-{safe-filename}`.
- App scheme: `supabase://slides-images/{path}`.
- Resolved URL: `${SUPABASE_URL}/storage/v1/object/public/slides-images/{encodeURI(path)}`.
- Current image insert may use public URL, while storage helpers also return `storageSrc`; keep both compatible.
- Upload/delete must require a logged-in owner session.

---

## 9. Pages

### 9.1 `login.html`

Purpose: authenticate the owner.

Required query:

- `next`: return URL after login.

Main DOM ids:

- `auth-form`
- `auth-email`
- `auth-password`
- `auth-login-btn`
- `auth-magic-btn`
- `auth-oauth-google`
- `auth-error`
- `auth-status`

Behavior:

- Existing session redirects to `next` or `index.html`.
- Email/password login redirects on success.
- Magic link mode shows a sent state.
- OAuth mode redirects to provider.
- Errors stay on the page.
- Never show decks or private metadata before auth is confirmed.

### 9.2 `index.html`

Purpose: authenticated dashboard, connection check, deck list, HTML/notes import.

Auth:

- Must call `requireLogin()` before reading decks.
- Must show account email and logout button.

Main DOM ids:

- `status`
- `deck-list`
- `account-menu`
- `account-email`
- `logout-btn`
- `import-html-btn`
- `import-modal-bg`
- `import-file`
- `import-deck-id`
- `import-title`
- `import-notes-file`
- `import-run-btn`
- `import-cancel-btn`
- `import-error`

Deck list query:

- Return only decks owned by the current user.
- Sort by `updated_at desc`.

Deck list links:

- `edit.html?deck=<id>`
- `pronunciation.html?deck=<id>` with current label `Notes`
- `present.html?deck=<id>&sync=r<first6>`
- `script.html?deck=<id>&sync=r<first6>`
- If shared, `view.html?deck=<id>&token=<token>`

Import rules:

- Extract all `<section>` blocks with a regex.
- Section id priority: `data-section-id`, `data-edit-id`, slugified `data-title`, `s-001`.
- Duplicate ids get `-02`, `-03`, etc.
- Slide title is `data-title` or `Slide N`.
- `frame_html` is built from content before the first section, then `<!-- slides -->`, then content after the last section.
- Optional notes Markdown removes top frontmatter, splits on `---`, strips a first-line `## title`, and maps by slide index.
- Import sequence: deck upsert with `owner_id = current user id`, existing slides delete, slide insert, optional notes upsert.
- On success, redirect to `edit.html?deck=<deck_id>`.

### 9.3 `edit.html?deck=<deck_id>`

Purpose: slide editing, note editing, frame editing, history, sharing, images, SVGs, export, pronunciation panel.

Auth:

- Must require login before loading deck data.
- Must fail with not-found/access-denied if the authenticated user does not own the deck.
- Must show account email and logout button.
- If session expires, disable write controls and prompt re-login.

Required query:

- `deck`

Main DOM:

- `app`: 48px toolbar plus body.
- `toolbar`: home, deck title, mode select, Present, More, account menu, status.
- `body`: slide list, canvas/raw HTML editor, right notes panel.

Toolbar ids:

- `deck-title`
- `mode-select`: options `aspect-169`(default), `portrait`, `html`, `stretch`
- `present-link`
- `more-dropdown`
- `export-dropdown`
- export buttons via `data-export`: `html`, `pdf`, `pptx`
- `history-toggle`
- `frame-edit`
- `share-btn`
- `svg-btn`
- `images-btn`
- `account-menu`
- `account-email`
- `logout-btn`
- `status`

Slide list ids/classes:

- `slide-list`, `slide-list-resizer`, `slide-list-scroll`
- `slide-list-count`
- `slide-list-title`
- `slide-list-items`
- Each rendered slide item: `.slide-item`, `draggable="true"`, `data-section-id`, `data-hidden`.
- Each item has action dropdown buttons for show/hide, duplicate, delete.
- `add-slide` is rendered at the end.

Canvas and raw HTML ids:

- `canvas-wrap`
- `canvas-stage`
- `canvas`
- `html-highlight`
- `html-editor`

Right panel ids:

- `props`, `props-resizer`
- `notes-size-down`, `notes-size-up`
- `notes-textarea`
- `training-mount`

Required modal/drawer ids:

- Frame: `frame-modal-bg`, `frame-sidebar`, `frame-textarea`, `frame-save`, `frame-cancel`, and `data-frame-part="html|css|js"` buttons.
- History: `hist-drawer`, `history-panel`.
- Images: `images-modal-bg`, `images-upload-btn`, `images-upload-input`, `images-grid`, `images-close`.
- SVG: `svg-modal-bg`, `svg-fill`, `svg-stroke`, `svg-stroke-w`, `svg-size`, `svg-shape-grid`, `svg-custom-code`, `svg-custom-preview`, `svg-custom-status`, `svg-custom-insert`, `svg-close`.
- Share: `share-modal-bg`, `share-url`, `share-copy`, `share-rotate`, `share-revoke`, `share-close`.

Initial state:

- Fetch current session.
- Fetch deck, slides ordered by `order`, and all notes through owner-scoped policies.
- Cache notes in `Map<section_id, content>`.
- Current slide is `slidesEditor.lastSectionId:<deckId>` if still valid, else first slide.
- Apply stored panel sizes before render.

localStorage keys:

- `slidesEditor.lastSectionId:<deckId>`
- `slidesEditor.slideListWidth`
- `slidesEditor.propsPanelWidth`
- `slidesEditor.propsPanelHeight`
- `slidesEditor.notesFontSize`
- `slidesEditor.autoSave`

Slide operations:

- Add slide creates id `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`, title `Untitled`, order `max + 1`, and content `<section class="slide" data-title="Untitled"><div><h1 data-editable="true">새 슬라이드</h1><p data-editable="true">내용을 입력하세요.</p></div></section>`.
- Add also upserts an empty note, updates local cache, and switches to the new slide.
- Duplicate copies content and notes, appends ` (copy)` to title, inserts at tail order, splices after source locally, then persists ordering with `reorder_slides`.
- Delete confirms, deletes from `slides`, removes the local notes cache entry, and selects the next slide at the same index or previous. Current implementation does not explicitly delete the DB note row.
- Reorder is drag/drop, optimistic local update, RPC save, rollback on failure.
- Hide/show toggles `data-hidden="true"` on section HTML and saves slide content.

Title editing:

- `slide-list-title` edits `slides.title` only.
- Debounce is 600ms.
- Enter or blur flushes immediately.

Notes editing:

- `notes-textarea` writes `notesPending`.
- Debounce is 800ms when autosave is enabled.
- If autosave is disabled, status is unsaved and flush happens on slide switch or beforeunload.
- Notes font size is 11px to 20px, step 1px, stored in `slidesEditor.notesFontSize`.

Inline iframe editing:

- Parent loads `edit-frame.html?deck=<deck_id>&section=<section_id>&edit=1`.
- Iframe asks parent for cached deck/slide via `edit-frame:request-data`.
- `InlineEditor` marks `[data-editable="true"]` nodes as contenteditable.
- If no editables are marked, leaf-like text elements among headings, paragraphs, list items, blockquotes, spans, and divs are auto-marked.
- Stable `data-edit-id` values are generated from slide title or section id plus `-01`, `-02`, etc.
- Paste inserts plain text.
- Input posts `edit:dirty` and, when autosave is enabled, posts `edit:save` after 800ms.
- Parent saves via `slideRepo.updateContent` and patches the local slide cache.

Raw HTML mode:

- `mode-select = html` sets body `.html-mode` and `canvas-wrap.html-mode`.
- Use CodeMirror if `window.CodeMirror` exists; otherwise textarea plus highlight overlay.
- Load current `slides.content` from local cache.
- `Cmd/Ctrl+Shift+F` formats the source.
- Save validates that the content contains an opening and closing `<section>` tag.
- Debounce is 800ms when autosave is enabled.

Frame editor:

- Parses `deck.frame_html` with DOMParser.
- Extracts all `<style>` contents into CSS part.
- Extracts all inline non-src `<script>` contents into JS part.
- HTML part is the document without those style/script nodes.
- Save serializes HTML plus CSS appended to `<head>` and JS appended to `<body>`.
- If `<!-- slides -->` is missing, insert before `</main>`, else before `</body>`, else append.
- Save updates `decks.frame_html` and appends frame history best-effort.

Images:

- List up to 500 files from `slides-images/<deck_id>`, newest first.
- Upload accepts multiple `image/*` files.
- Safe filename is lowercased, NFKD-normalized, non `[a-z0-9._-]` replaced with `-`, max 80 chars.
- Upload path is `{deck_id}/{Date.now().toString(36)}-{safeName}`.
- Actions: copy public URL, insert image into iframe, delete object.

SVG picker:

- Built-in shapes include rectangle, rounded rectangle, circle, ellipse, triangle, diamond, star, arrows, line, checkmark, cross, plus, speech bubble, and heart.
- Controls: fill, stroke, stroke width, size.
- Insert wraps SVG in a non-contenteditable inline-block span.
- Custom SVG validates root `<svg>` with XML DOMParser.

Share:

- Generate token with `crypto.randomUUID()` when no token exists.
- Share URL is `view.html?deck=<deck_id>&token=<token>` in the same directory.
- Rotate replaces token.
- Revoke sets token to null.

Shortcuts:

- `H`: history drawer.
- `I`: images modal.
- `Cmd/Ctrl+S`: save manual version.
- `?`: shortcuts help.
- Inputs, textareas, and contenteditable targets suppress global shortcuts.

### 9.4 `edit-frame.html?deck=<deck_id>&section=<section_id>[&edit=1]`

Purpose: render one slide inside the deck frame for the edit iframe.

Auth:

- Must render only for an authenticated owner session.
- Can receive cached owner-authorized data from parent.
- If direct-fetch fallback is used, the request must still be authorized by RLS/session.

Rules:

- Load `config.local.js` then `edit-frame-bootstrap.js`.
- Request cached data from parent.
- Fall back to direct fetch if parent does not answer.
- Inject one tagged section into `frame_html`.
- If `edit=1`, mount `InlineEditor`.
- Send `edit-frame:error` to parent on frame errors.

### 9.5 `present.html?deck=<deck_id>[&sync=<room>][&section=<section_id>][&slide=<section_id>][&print=1][&nofallback=1]`

Purpose: owner presentation mode.

Auth:

- Must require login.
- Only deck owner can present from this page.
- Shared audience access must use `view.html`, not `present.html`.

Rules:

- Fetch deck and slides.
- Exclude hidden slides.
- Clean `frame_html` by stripping scripts, inline handlers, and `javascript:`.
- Inject tagged visible slides into `frame_html`.
- Replace the whole document with `document.open/write/close`.
- Start slide is `section` or `slide` query when visible; if hidden, choose nearest following visible slide or previous visible slide.

Screen overlay:

- `__se_progress`: top progress bar.
- `__se_chrome`: top-right counter/sync chrome.
- `__se_counter`: `N / total`.
- `__se_sync`: sync room, click copies room id.
- `__se_navdots`: right-side dot navigation, shown when pointer is on the right side of the viewport.

Fallback CSS:

- Injected unless `nofallback=1`.
- Makes `main` a 100vh vertical scroll-snap container and forces each `section[data-section-id]` to be a snap target.

Print mode:

- `print=1` suppresses chrome and sync.
- All slides are visible, fragments are shown, reveal classes are activated.
- `@page { size: 1280px 720px; margin: 0; }`.
- Calls `window.print()` after 800ms.

Runtime extras:

- `data-hl`/`data-hr` prepend a `.slide-header.reveal`.
- `data-pg` appends `.slide-footer`.
- `sync` query broadcasts `{ section_id, index }` on every slide change.

### 9.6 `script.html?deck=<deck_id>[&sync=<room>]`

Purpose: teleprompter/read view for speaker notes.

Auth:

- Must require login because notes are private.
- Only deck owner can open notes.

Main DOM ids:

- `progress`
- `header`
- `prevSlide`, `nextSlide`
- `slide-counter`
- `decreaseFont`, `increaseFont`
- `toggleHL`
- `editNotesLink`
- `marpLink`
- `account-menu`, `account-email`, `logout-btn`
- `sync-badge`, `sync-label`, `mode-label`
- `script`

Behavior:

- Render each note as `.sec` with `data-idx` and `data-section-id`.
- Current section is `.active`; adjacent sections are `.adj`; others are dimmed.
- Empty body shows `(빈 노트)`.
- Font key is `slides-editor:notes:fontsize`, default `1.15` rem, range 0.7 to 2.5 rem.
- `HL` toggles `#script.no-hl` and button `.btn-on`.
- Prev/next buttons and section clicks set manual mode.
- Keyboard next: Down, Right, PageDown, `j`.
- Keyboard prev: Up, Left, PageUp, `k`.
- If `sync` exists, subscribe to `slides-editor-sync-<room>`. `section_id` wins, `index` is fallback. Manual mode ignores incoming sync.
- Attempts screen wake lock best-effort.

### 9.7 `script-edit.html?deck=<deck_id>`

Purpose: fullscreen notes editor.

Auth:

- Must require login.
- Must show account email and logout.

Behavior:

- Three panes: section list, Markdown textarea, preview.
- Textarea input updates preview immediately and debounces `notes.upsert` by 800ms.
- Switching sections flushes pending save first.
- Preview uses `markdown-lite.js` with headings, paragraphs, ul/ol, blockquote, code fence, inline code, bold, italic, and http(s) links.
- Preview is hidden by default at `max-width: 900px`.
- `H` toggles history.
- `Cmd/Ctrl+S` saves manual version.

### 9.8 `notes.html?deck=<deck_id>`

Purpose: Marp notes view with copy/download and browser TTS.

Auth:

- Must require login.
- Notes are not exposed through share token.

Main DOM ids:

- `deck-title`
- `pronunciation-link`
- `script-link`
- `tts-btn`, `tts-stop-btn`
- `copy-btn`, `download-btn`
- `account-menu`, `account-email`, `logout-btn`
- `content`

Behavior:

- Calls `buildNotesMd(deckId)` and writes the result with `textContent` into `<pre id="content">`.
- Copy writes Markdown to clipboard.
- Download filename is `{slugify(deck.title)}-notes.md`.
- TTS uses browser `speechSynthesis`, `SpeechSynthesisUtterance`, `en-US`, rate 1.0, pitch 1.0.
- Current HTML contains duplicate `id="pronunciation-link"` anchors; compatible rebuilds must tolerate this until cleaned up.

### 9.9 `view.html?deck=<deck_id>&token=<share_token>`

Purpose: shared read-only slide view.

Auth:

- Public, no login required.
- Must not expose notes, history, owner email, or private deck metadata.

Behavior:

- Validate token, sanitize frame/slides, inject slides, and replace the document.
- Load `SlidePresentation` but no edit UI and no sync.
- Overlay a Home link and `read-only · shared view` label.
- Same fallback CSS as present mode; `nofallback=1` disables it.
- Shortcuts help title is `View (shared)`.

### 9.11 `pronunciation.html?deck=<deck_id>`

Purpose: English pronunciation training.

Auth:

- Must require login.
- Must show account email and logout.

Behavior:

- Three panes: section list, script/slide preview, training panel.
- CSS vars: `--sec-list-width` default 220px, `--training-width` default 340px.
- Both side panes have pointer resizers.
- Uses shared `training-panel.js`.
- Loads notes via `buildNotesMd`, then maps raw notes by `section_id`.
- Script text is cleaned of Markdown for speech display.
- Full-deck export synthesizes non-empty notes, inserts 1.5s silence, merges to WAV, and downloads `${deckId}-${speed}x.wav`.

---

## 10. Shared Module Contracts

### 10.1 `auth.js`

`auth.js` should become a thin compatibility wrapper over `auth-provider.js`.

Required exports:

- `getSession`
- `getUser`
- `requireLogin`
- `logout`
- `bindAccountMenu`
- `onAuthStateChange`

Deprecated exports:

- `ensureAuthed` may remain temporarily but must call `requireLogin` internally.
- `isAuthed` may remain temporarily but must check session, not passphrase.

### 10.2 `slide-render.js`

`tagSection(content, sectionId)`:

- Injects `data-section-id="<sectionId>"` into the first `<section>`.
- Ensures class list contains `slide`.
- Preserves existing attributes and classes.

### 10.3 `slide-visibility.js`

- `isSlideHiddenContent(content)` reads `data-hidden` on the first section.
- Empty `data-hidden` means hidden.
- `true`, `1`, and `yes` mean hidden.
- `setSlideHiddenContent(content, hidden)` uses DOMParser and returns `section.outerHTML`.

### 10.4 `slide-runtime.js`

`SlidePresentation`:

- Selects `section.slide`.
- Mobile query: `(max-width: 900px), (max-width: 1024px) and (orientation: landscape)`.
- Desktop uses `scrollIntoView`; mobile scrolls `main` to `idx * 720`.
- IntersectionObserver adds `.visible` when ratio > 0.5.
- Programmatic nav locks observer updates for 700ms.
- Keyboard next: Down, Right, PageDown, Space.
- Keyboard prev: Up, Left, PageUp.
- Home/End jump.
- Touch swipe threshold is 50px.
- Wheel threshold is abs(deltaY) >= 30 with a 250ms settle lock.
- `.fragment` advances before slides; `data-fragment-group` advances groups.
- `data-stepper` slides step through matching items, active class default `mint` or `data-stepper-active-class`.
- Emits `slidechange` with `{ index, section_id, total }` and calls optional `onSlideChange`.

### 10.5 `sync.js`

- Remote mode creates a Supabase client from global config.
- Local mode uses the local broadcast adapter.
- Channel: `slides-editor-sync-<syncId>`.
- Broadcast config: `{ self: false }` in Supabase mode.
- Event: `slide`.
- Payload: `{ section_id, index }`.
- API: `broadcast(payload)`, `close()`.

### 10.6 `export.js`

HTML export:

- Requires owner session when run inside the app.
- Fetch deck/slides through owner-scoped policies.
- Join slide content in order.
- Strip `contenteditable`, `data-editable`, `data-edit-id`, and `data-section-id`.
- Resolve `supabase://slides-images/...` sources.
- Inject into frame and prepend `<!DOCTYPE html>` if missing.
- Download `{slugify(deck.title)}.html`.

PDF exports:

- Browser print opens `present.html?deck=<deck_id>&print=1`.

Marp notes:

```md
---
marp: true
theme: default
---

## {slide title}

{trimmed note body}
```

- Sections are joined with `---`.
- Empty notes keep the heading and blank body.
- Download `{slugify(deck.title)}-notes.md`.

PPTX:

- Requires `window.PptxGenJS`.
- Uses `LAYOUT_16x9`.
- Converts headings/body text heuristically; complex CSS is not faithfully preserved.
- Download `{slugify(deck.title)}.pptx`.

### 10.7 `training-panel.js`

- IndexedDB database: `pronunciation-cache`, version 3.
- Object stores: `audio`, `history`, `recordings`.
- TTS engines: Kokoro, OpenAI, ElevenLabs.
- STT engines: VibeVoice/MLX, Web Speech, Whisper.
- Scoring tokenizes lowercase text, strips punctuation, uses LCS diff and Levenshtein near-match.
- Score classes: `great` for >= 80, `ok` for >= 55, otherwise `poor`.
- Public API includes `setSection`, `setSpeed`, `setEngine`, `getEngine`, `synthesize`, `destroy`.

---

## 11. History UI

- Requires owner session.
- Merges slide, notes, and frame history sorted by newest first.
- Source labels: `slide`, `notes`, `frame`.
- Manual rows show `★`; auto rows show `·`.
- Can filter to current section.
- `view` toggles a content preview truncated to 6000 chars.
- `restore` confirms and writes content back through the normal repo methods, creating a new auto history row.
- `saveVersionPrompt(deckId)` asks for an optional message and writes a manual batch for all slides, all notes, and current frame.

---

## 12. Visual Style

- The app must use a named theme token system instead of hardcoding one-off colors in page CSS.
- The SPEC defines token names and semantic usage only; it must not lock the implementation to a concrete palette name or color number.
- The default theme key should be configurable by the implementation.
- Theme tokens must be defined as CSS custom properties on `:root` and may be overridden by setting `data-theme` on `<html>`.

Required theme contract:

```css
:root {
  --color-main: <primary brand/action color>;
  --color-main-hover: <primary hover color>;
  --color-main-soft: <primary translucent background>;

  --color-secondary: <secondary action color>;
  --color-secondary-hover: <secondary hover color>;
  --color-secondary-soft: <secondary translucent background>;

  --color-bg: <page background>;
  --color-surface: <toolbar/sidebar/modal surface>;
  --color-surface-2: <nested control surface>;
  --color-surface-raised: <hover/raised overlay surface>;

  --color-border: <default border>;
  --color-border-strong: <emphasized border>;

  --color-text: <default text>;
  --color-text-bright: <high-emphasis text>;
  --color-text-muted: <metadata/helper text>;
  --color-text-dim: <de-emphasized text>;

  --color-success: <success status color>;
  --color-warning: <warning status color>;
  --color-danger: <danger/error status color>;
  --color-info: <informational status color>;

  --font-main: "IBM Plex Sans KR", "IBM Plex Sans", sans-serif;
  --font-mono: "JetBrains Mono", ui-monospace, "SF Mono", monospace;

  --radius-control: 5px;
  --radius-panel: 6px;
  --toolbar-height: 48px;
  --slide-export-width: 1280px;
  --slide-export-height: 720px;
}
```

Semantic usage rules:

- `--color-main` is the primary brand/action color. Use it for active states, live sync, primary buttons, focus rings, progress bars, selected slide outlines, and important positive affordances.
- `--color-secondary` is for secondary tools and neutral feature actions such as pronunciation/export controls. Do not use it as the default active state when `--color-main` is available.
- `--color-bg` is the page background.
- `--color-surface` is toolbar, sidebar, modal, and drawer background.
- `--color-surface-2` is nested controls, inputs, image cards, and subtle separated areas.
- `--color-surface-raised` is hover, active menu rows, and raised overlays.
- `--color-border` is the default hairline border.
- `--color-border-strong` is for focused panels, active dropdowns, and modal outlines.
- `--color-text` is default body text.
- `--color-text-bright` is headings, selected labels, and primary toolbar title text.
- `--color-text-muted` is helper text, counters, timestamps, inactive controls, and metadata.
- `--color-text-dim` is intentionally de-emphasized content such as non-active script sections.
- `--color-success`, `--color-warning`, `--color-danger`, and `--color-info` are status-only tokens and must not be used as general decoration.

Compatibility aliases:

```css
:root {
  --accent: var(--color-main);
  --bg: var(--color-bg);
  --surface: var(--color-surface);
  --surface-2: var(--color-surface-2);
  --border: var(--color-border);
  --border-2: var(--color-border-strong);
  --text: var(--color-text);
  --text-bright: var(--color-text-bright);
  --text-mid: var(--color-text-muted);
  --text-dim: var(--color-text-dim);
  --ok: var(--color-success);
  --danger: var(--color-danger);
  --warn: var(--color-warning);
  --blue: var(--color-info);
}
```

Theme switching:

- Store the selected theme in localStorage key `slidesEditor.theme`.
- On app boot, apply it with `document.documentElement.dataset.theme = value` before rendering page UI.
- If the stored theme is missing or unknown, fall back to the implementation's default theme key.
- Component CSS must depend on semantic tokens only, so future themes can change palette values without changing component CSS.
- Theme names and exact color values belong in the theme implementation file, not in this SPEC.

Base style:

- Dark app chrome by default.
- Main font: `IBM Plex Sans KR` when available.
- Monospace: `JetBrains Mono`, `ui-monospace`, `SF Mono`, monospace.
- Toolbar height in edit/pronunciation/script-edit pages: 48px.
- Login page should use the same dark theme and be compact, not a marketing landing page.
- Print/export slide size: 1280x720.

---

## 13. Known Quirks And Migration Notes

- Existing passphrase auth must be replaced by login/logout.
- If legacy `OWNER_PASSPHRASE` remains during migration, it must be explicitly deprecated and not documented as production security.
- Existing decks without `owner_id` need a migration path: assign to a chosen owner account before enabling strict RLS.
- `notes.html` has duplicate `id="pronunciation-link"` anchors.
- `edit.html` comments out `save-html-btn` and `autosave-toggle`, but JS still supports them if restored.
- `edit-bootstrap.js` tolerates missing optional ids such as `prop-title`, `prop-section-id`, `prop-order`, and `prop-hidden`.
- `images-drop-zone` is optional and referenced only if present.
- Slide deletion does not explicitly delete the DB note row.
- Image insertion currently inserts a public URL even though storage helpers support `supabase://slides-images/...`.
- Current permissive dev RLS must be replaced before this is treated as a hosted service.

---

## 14. Acceptance Checklist

- `login.html` supports email/password, magic link, or configured OAuth login.
- Logged-in users are redirected away from login to `next` or `index.html`.
- Owner-only pages redirect unauthenticated users to `login.html?next=...`.
- Every owner page exposes account email and logout.
- Logout clears the session and redirects to login.
- Expired sessions disable writes and prompt re-login.
- `npm run build:vendor` creates local browser vendor modules.
- Static server opens `index.html` after login and shows only the current user's decks.
- HTML import creates deck/frame/slides owned by the logged-in user and redirects to edit.
- Optional notes import maps notes by slide index.
- Edit loads deck, remembers last section, renders list, iframe, notes, and training panel.
- Add, duplicate, delete, reorder, and hide/show update DB and UI only for owned decks.
- Inline editing saves slide HTML after 800ms and appends deduplicated auto history.
- Raw HTML mode edits and saves section HTML.
- Notes editing saves after 800ms and appends deduplicated notes history.
- Frame editor edits HTML/CSS/JS separately and inserts `<!-- slides -->` if missing.
- History drawer previews, filters, restores slide/notes/frame, and can save manual versions.
- Share can generate, copy, rotate, and revoke tokens; shared view validates token without login.
- Shared view never exposes notes, history, owner email, or edit controls.
- Present excludes hidden slides, supports fragments, grouped fragments, steppers, keyboard, wheel, touch, progress, nav dots, start section, print mode, and sync broadcast.
- Script view requires login, follows sync unless in manual mode, and supports font size/highlight/navigation.
- Script edit supports Markdown preview, debounced save, history, and manual snapshot.
- Notes view outputs Marp Markdown and supports copy/download/TTS.
- HTML/PDF/screenshot PDF/PPTX/notes exports work for owned decks.
- Image upload/list/copy/insert/delete works with owner-scoped storage policies.
- SVG picker inserts generated and custom SVG.
- Pronunciation page loads sections, slide preview, script text, TTS/STT training, scoring, history, and full-deck WAV export.
- Remote deployment has RLS enabled for decks, slides, notes, history, and storage.
- No production path depends on a client-side passphrase.