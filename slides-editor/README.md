
# Slides Editor

> Web-based editor for presentation slides and speaker notes, with real-time sync, history, and import/export features.

---

**Sections:**
- [Slides Editor](#slides-editor)
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
- Export to HTML, PDF, Marp
- Supabase backend (Postgres + Storage)
- Easy local and Vercel deployment

See [SPEC.md](./SPEC.md) for full specs · [PLAN.md](./PLAN.md) for milestones

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
4. (M6+) Replace `dev_anon_all` policy with owner/share_token-based policy for production.

### 2. Local Config
```bash
cp js/config.local.js.example js/config.local.js
# Edit js/config.local.js and fill in SUPABASE_URL, SUPABASE_ANON_KEY, OWNER_PASSPHRASE
```

### 3. Run Locally
```bash
python3 -m http.server 8000
# or: npx serve .
```
Open [http://localhost:8000](http://localhost:8000) — you should see **"✓ connected — 1 deck(s)"** and `seed-hello` if setup is correct.

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
The build step (`node scripts/build-config.mjs`) generates `js/config.local.js` from env vars at build time. Any committed `js/config.local.js` is overwritten on Vercel.

> ⚠ **Before public deployment, review [Security Posture](#security-posture).**
> The default `dev_anon_all` RLS policy allows anyone to access the DB. Harden for production.

---


## Image Hosting

Images are stored in the Supabase Storage `slides-images` bucket (public-read).

- **Enable**: Run `migrations/005_storage.sql` (once)
- **Use**: In edit.html, open 🖼 Images (or press `I`) → drag-and-drop or `+ Upload`
- **Insert**: Click `↩` to insert `<img>` at the current selection and autosave
- **Copy**: Click `📋` to copy the public URL (paste directly in HTML)
- **Delete**: Click `🗑` (permanent). Deleting breaks `<img src>` references in slides
- **Path**: `{deck_id}/{ts36}-{safe-name}` — timestamp prefix prevents filename collisions

> **Tier 1:** anon can upload/delete. **Tier 2:** restrict to owner after authentication.

---


## Importing Existing Material

Import an HTML slide deck and (optionally) Marp-style notes Markdown:

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

**Tier 1 (current, M7):**
- Client-side passphrase (`OWNER_PASSPHRASE`) for owner pages
- Public share via `view.html?deck=X&token=Y` (DOMPurify sanitized)
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

```
slides-editor/
├─ index.html              # Setup check + deck list
├─ present.html            # Slide read + navigation (?deck=<id>[&sync=<room>])
├─ script.html             # Teleprompter + realtime sync
├─ edit.html               # Inline editor (desktop only)
├─ edit-frame.html         # Single-slide iframe for edit.html
├─ script-edit.html        # Fullscreen notes editor (markdown + preview)
├─ notes.html              # Marp(.md) read-only view (Copy/Download)
├─ view.html               # Public viewer (?token=, slides only)
├─ migrations/             # Supabase SQL migrations
├─ js/                     # Frontend logic
│  ├─ supabase.js          # Shared client
│  ├─ sync.js              # Realtime broadcast
│  ├─ slide-runtime.js     # Slide presentation logic
│  ├─ script-view.js       # Teleprompter logic
│  ├─ script-edit-view.js  # Notes editor mount
│  ├─ inline-editor.js     # Inline editor (iframe)
│  ├─ history-ui.js        # History drawer
│  ├─ export.js            # Export logic
│  ├─ view-bootstrap.js    # Share_token view loader
│  ├─ auth.js              # Passphrase gate
│  ├─ present-bootstrap.js # Deck loader
│  ├─ edit-bootstrap.js    # Editor controller
│  ├─ edit-frame-bootstrap.js  # Iframe loader
│  ├─ repo/                # Data access layer
│  │  ├─ deck-repo.js
│  │  ├─ slide-repo.js
│  │  ├─ notes-repo.js
│  │  └─ history-repo.js
│  └─ config.local.js.example
├─ vercel.json
├─ SPEC.md
├─ PLAN.md
├─ IDEA.md
└─ README.md
```
