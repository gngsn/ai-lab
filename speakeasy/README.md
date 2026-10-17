
# Speakeasy

> Web-based editor for presentation slides and speaker notes, with real-time sync, history, and import/export features.

---

**Sections:**
- [Speakeasy](#speakeasy)
  - [Features](#features)
  - [Quick Start](#quick-start)
    - [1. Supabase Setup](#1-supabase-setup)
    - [2. Local Config](#2-local-config)
    - [3. Run Locally](#3-run-locally)
  - [Keyboard Shortcuts](#keyboard-shortcuts)
  - [Deployment](#deployment)
    - [Vercel](#vercel)
  - [Image Hosting](#image-hosting)
  - [Importing Existing Material](#importing-existing-material)
  - [Security Posture](#security-posture)
  - [Project Structure](#project-structure)

---

## Features

- Edit slides and speaker notes in two independent modes (slide/script)
- Mobile support (script mode only)
- Real-time sync during presentation
- Version history and rollback
- Import HTML/Markdown decks
- Export to HTML, PDF, Marp, PPTX
- Supabase backend (Postgres + Storage)
- Easy local and Vercel deployment

See [SPEC.md](./SPEC.md) for the current behavior and design notes.

---

## Quick Start

### 1. Supabase Setup
1. Create a new project at [supabase.com](https://supabase.com) (or reuse an existing one).
2. In **Project Settings → API**, copy your `Project URL` and `anon public` key.
3. In the **SQL editor**, run these migrations in order:
  - `migrations/001_init.sql` — decks / slides / notes
  - `migrations/002_history.sql` — slide_history / notes_history
  - `migrations/003_dev_rls.sql` — **RLS enabled + anon policy** (required, or you'll see 0 rows)
  - `migrations/004_rpc.sql` — reorder_slides RPC (M3+)
  - `migrations/005_storage.sql` — `slides-images` bucket + dev RLS (image hosting)
  - `migrations/seed.sql` — sample deck for testing
4. For production, replace `dev_anon_all` policy with owner/share_token-based policy.

### 2. Local Config
```bash
cp public/js/config.local.js.example public/js/config.local.js
# Edit public/js/config.local.js and fill in SUPABASE_URL, SUPABASE_ANON_KEY, OWNER_PASSPHRASE
```

### 3. Run Locally
```bash
pnpm install
pnpm dev          # Vite dev server
# pnpm build      # production build into dist/ (what Vercel serves)
# pnpm check      # lint + typecheck + unit tests;  pnpm e2e  # Playwright (builds first)
```
Open [http://localhost:5173](http://localhost:5173) — you should see **"✓ connected — 1 deck(s)"** and `seed-hello` if setup is correct.

`pnpm build:vendor` (only when the Supabase client version changes) regenerates
the browser bundle `public/vendor/modules/supabase-client.mjs`, so runtime
doesn't depend on `esm.sh`.

---

## Keyboard Shortcuts

Press <kbd>?</kbd> on any page for a modal with shortcuts. Common keys:

| Page         | Keys                | Action                        |
|--------------|---------------------|-------------------------------|
| **Edit**     | `E`                 | Toggle edit mode (canvas)     |
|              | `H`                 | History drawer                |
|              | `⌘S` / `Ctrl+S`     | Save version                  |
|              | Drag in list        | Reorder                       |
|              | `I`                 | Image library                 |
|              | `M`                 | Toggle raw HTML mode          |
| **Present**  | `↓→PgDn Space`      | Next / fragment               |
|              | `↑←PgUp`            | Prev / hide fragment          |
|              | `Home / End`        | First / last slide            |
| **Script**   | `↓→ / j`            | Next (manual mode)            |
|              | `↑← / k`            | Prev (manual mode)            |
|              | Click sync badge    | Auto/manual toggle            |
| **Notes**    | `⌘S / Ctrl+S`       | Save version                  |
|              | `H`                 | History drawer                |
| **All**      | `?`                 | Show help                     |

---


## Deployment

### Vercel
```bash
# One-time setup
vercel login
vercel link

# Set environment variables (once per project)
vercel env add SUPABASE_URL       production
vercel env add SUPABASE_ANON_KEY  production
vercel env add OWNER_PASSPHRASE   production

# Deploy
vercel --prod
```
The build (`node scripts/build-config.mjs && vite build`) generates `public/js/config.local.js` from env vars, then Vite copies `public/` to `dist/`, which Vercel serves. Any committed config file is overwritten on Vercel.

> ⚠ `public/js/config.local.js` is served publicly, so the build never writes a GitHub token into it (a `GITHUB_TOKEN` env var is ignored). To import from private repos, paste a fine-grained token with read-only **Contents** access into the import dialog — it is kept only in that browser.

> ⚠ **Before public deployment, review [Security Posture](#security-posture).**
> The default `dev_anon_all` RLS policy allows anyone to access the DB. Harden for production.

---


## Image Hosting

Images are stored in the Supabase Storage `slides-images` bucket (public-read).

- **Enable**: Run `migrations/005_storage.sql` (once)
- **Use**: In edit.html, open 🖼 Images (or press `I`) → drag-and-drop or `+ Upload`
- **Insert**: Click `↩` to insert `<img src="supabase://slides-images/...">` at the current selection and autosave
- **Copy**: Click `📋` to copy the local storage path (`supabase://slides-images/...`)
- **Delete**: Click `🗑` (permanent). Deleting breaks `<img src>` references in slides
- **Path**: `{deck_id}/{ts36}-{safe-name}` — timestamp prefix prevents filename collisions

The editor stores image references as storage paths (not absolute public URLs).
At runtime/export, those paths are resolved against `SUPABASE_URL`, so deck HTML
stays environment-agnostic and does not hardcode a remote host.

> **Tier 1:** anon can upload/delete. **Tier 2:** restrict to owner after authentication.

---


## Importing Existing Material

Import an HTML slide deck and (optionally) Marp-style notes Markdown:

- **Browser import:** Open the deck list at `index.html`, click **Import HTML**, and select an HTML presentation file with top-level `<section>` slides. You can also attach optional notes Markdown to import slide notes in the same pass.
- **CLI import:** Use the script below when you already have local files and want a repeatable import.

```bash
node scripts/import.mjs --deck=my-talk \
  --slides=path/to/slides.html \
  --notes=path/to/notes.md \
  --title="My Talk"
```

- **Slides:** Any HTML with `<section …>` blocks. Reads `data-title`, `data-section-id`, `data-edit-id`, or generates `s-NNN` from slug.
- **Notes:** Markdown with `---` between sections. Top frontmatter dropped. First `## title` per chunk stripped. Matched to slides by index.
- **Idempotent:** Re-running replaces all slides for that deck (notes upserted by section_id).
- **`--dry-run`:** Prints parse summary, no DB changes.
- **No npm install needed** — Node 18+ only.

---


## Security Posture

**Tier 1 (current):**
- Client-side passphrase (`OWNER_PASSPHRASE`) for owner pages
- Public share via `view.html?deck=X&token=Y` (DOMPurify sanitized)
- Live audience page `share.html?deck=X&token=Y&sync=ROOM`: the shared view, following the presenter's slide in real time (link via present mode's "copy audience link")
- Suitable for local/trusted use only

**Tier 2 (future):**
- Anon key is public and `dev_anon_all` RLS allows full access
- For production, replace with:
  - Supabase Auth (magic link/email) for owner
  - RLS using `auth.uid()` for owner ops
  - RPC `public_view(deck_id, token)` for share-token reads
  - Remove `dev_anon_all`, grant only RPC to `anon`

---

## Project Structure

The pages and scripts below live in `public/` (Vite copies it to `dist/`
unchanged; see `docs/modernization-plan.md`). Tests are in `tests/`, build
config in `vite.config.ts`, and new code goes in `src/`.

```
speakeasy/public/
├─ index.html              # Setup check + deck list
├─ present.html            # Slide read + navigation (?deck=<id>[&sync=<room>])
├─ script.html             # Teleprompter + realtime sync
├─ edit-frame.html         # Single-slide iframe for the editor (/edit, React: ../edit.html + src/features/edit)
├─ script-edit.html        # Fullscreen notes editor (markdown + preview)
├─ notes.html              # Marp(.md) read-only view (Copy/Download)
├─ view.html               # Public viewer (?token=, slides only)
├─ share.html              # Live audience view (?token=&sync=, follows present)
├─ migrations/             # Supabase SQL migrations
├─ js/                     # Frontend logic
│  ├─ supabase.js          # Shared client
│  ├─ sync.js              # Realtime broadcast
│  ├─ slide-runtime.js     # Slide presentation logic
│  ├─ script-view.js       # Teleprompter logic
│  ├─ script-edit-view.js  # Notes editor mount
│  ├─ inline-editor.js     # Inline editor (iframe)
│  ├─ history-ui.js        # History drawer
│  ├─ view-bootstrap.js    # Share_token view loader
│  ├─ auth.js              # Passphrase gate
│  ├─ present-bootstrap.js # Deck loader
│  ├─ edit-frame-bootstrap.js  # Iframe loader
│  ├─ repo/                # Data access layer
│  │  ├─ deck-repo.js
│  │  ├─ slide-repo.js
│  │  ├─ notes-repo.js
│  │  └─ history-repo.js
│  └─ config.local.js.example
├─ vendor/                 # Vendored editor/runtime assets
├─ data/                   # Local runtime state and fixtures
├─ vercel.json
├─ SPEC.md
├─ IDEA.md
└─ README.md
```
