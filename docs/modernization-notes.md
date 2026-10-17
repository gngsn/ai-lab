# Modernization notes

Things found while writing the Phase 0 tests. The tests pin today's behavior; nothing here was changed.

- **Captions CC toggle:** switching CC off and on again does not re-show the caption that was on screen; the box stays hidden until the next caption arrives (`js/captions/audience.js`). Possible small improvement later.
- **docs/function.md** still calls the follow button "Follow/Stop"; the app's label is "Pause" (hover shows "Pause · manual control") / "Follow" (hover: "Follow the presenter").
- **Playback state:** a slide saved with a fragment already `show`n starts hidden (by design, see `stripPlaybackState`), so that slide needs one extra key press to move on. Tests rely on this.
- **Share is inside "⋮ More"** in the editor toolbar, so tests open that menu first.
- **Local runs use the working tree.** Someone else's uncommitted edits to `edit.html` (export menu) are present locally; the tests don't touch those parts. CI runs the committed code.
- **Import redirects:** after a successful import the app navigates to `edit.html?deck=<id>` (it does not stay on the deck list). The plan's P0-17 said "the deck is created"; the test pins both.
- **PPTX removed:** the export menu no longer offers PPTX or screenshot-PDF, so `exportPptx`, `vendor/pptxgenjs/` and the pdf-export page are gone. `README.md` ("Export to HTML, PDF, Marp, PPTX"), `SPEC.md` and `docs/function.md` still mention PPTX; they are outside this task's scope and need a human edit.
- **Biome 2:** the config key is `files.includes` (the plan said `include`), and `biome migrate --write` rewrote `"recommended": true` to `"preset": "none"`, which silently turned linting off (checked with a probe file). The config now says `"preset": "recommended"`. `pnpm lint` is plain `biome check` because `src/` does not exist yet.
- **allowJs types:** with `allowJs`, TypeScript infers types for the legacy JS the tests import, so the `// @ts-expect-error` comments were removed.
- **vercel CLI:** moved to devDependencies (`^54.x`, kept in the same major).
- **Vite 8, not 6:** Vitest 5 already depends on Vite 8, so adding Vite 8 keeps one copy. `build.rollupOptions.input` still works in it.
- **Placeholder entry:** Vite needs an HTML entry, so `src/pages/_placeholder/index.html` ships as `/src/pages/_placeholder/index.html` in `dist/` until Phase 4 replaces it. It is never linked.
- **Local config moved with the folder:** `git mv js public/js` also moved the ignored `js/config.local.js` to `public/js/config.local.js`, so a developer who already had one needs to do nothing. Anyone else copies `public/js/config.local.js.example`. The old `js/config.local.js` ignore line stays for a while.
- **`supabase/.temp/`** (created by `supabase link`: project ref, pooler URL) is now gitignored and excluded from Vercel uploads.
- **`dev` is Vite's dev server** (port 5173); `pnpm e2e` builds first and serves `dist/` with `vite preview`.
- `scripts/import.mjs` and `scripts/build-*.mjs` were updated for the new paths; the rebuilt `supabase-client.mjs` is identical.
- **Before the first Vercel preview (human):** (1) Vercel must use pnpm 11 to match `packageManager`; if its default pnpm is older, set `ENABLE_EXPERIMENTAL_COREPACK=1` in the project env. (2) A Preview deployment needs `SUPABASE_URL`, `SUPABASE_ANON_KEY` and `OWNER_PASSPHRASE` in the Preview environment, otherwise `build-config` writes no config and the pages can't reach Supabase. (3) Check `/edit`, `/present`, `/share`, `/view` still resolve (cleanUrls) and that `/js/config.local.js` has no `GITHUB_TOKEN`.
- **DB types must be `type` aliases:** Supabase's generics need `Record<string, unknown>`, which a TS `interface` doesn't satisfy; with interfaces every write typed as `never`.
- **Data layer vs legacy repos:** `src/data/*.ts` are line-for-line ports. `listSlideHistory` / `listNotesHistory` / `listFrameHistory` stay private in the TS port (nothing outside the file used them). `tests/unit/data-equivalence.test.ts` runs both against a recording fake client and compares results, errors, the exact queries and console warnings (mutating the port makes it fail).
- **`setSlideHiddenContent` needs a DOM** (`DOMParser`), so `src/lib/slide-visibility.ts` is the one `lib/` file that isn't DOM-free. Its equivalence isn't unit-tested (no jsdom, and the plan forbids new libraries); the e2e hide / show test (P0-13) covers it.
- **Matcher port:** `forEach` with an outer `best` variable became a `for…of` loop so TypeScript can follow the assignment; the scoring logic is unchanged (checked by 200 random sessions).
- **P3-5 complete.** All §3.2 runtime files now have `// @ts-check`. In the remaining 13 files, TypeScript diagnostics are marked with comment-only `@ts-expect-error` directives to keep runtime code unchanged; this opts them into checking but suppresses those specific diagnostics until stronger JSDoc types can replace the suppressions. The already typed globals remain in `src/legacy-globals.d.ts`. Verified that no executable runtime lines changed. `pnpm check` and all 95 Playwright e2e tests pass.
- **P4-1 (captions console in React):** done in `src/pages/captions` + `src/features/captions`. The component keeps the legacy DOM ids so the Phase 0 tests run unchanged, and fills them imperatively from one `useEffect`; turning that into real React state is a later cleanup.
- **E2E hook in production code:** `src/data/client.ts` loads the in-browser fake backend when `window.__SE_E2E_FAKE__` is set (the Playwright init script sets it). Harmless in production (the flag is never set and the import is runtime-only: the specifier is a variable with `@vite-ignore`, because that file lives in `public/` and Vite can't bundle it), but a cleaner seam is worth finding before more pages depend on it.
- **Review fixes before committing this work:** `captions.css` was not Biome-formatted (so `pnpm lint` failed) and the literal `import("/vendor/…")` made `vite build` fail; both fixed.

### P4-2 notes.html (React + TypeScript)
- Ids kept: `#deck-title`, `#pronunciation-link` (twice), `#script-link`, `#tts-btn`, `#tts-stop-btn`, `#copy-btn`, `#download-btn`, `#content`.
- Legacy quirk kept on purpose: the header has two "Pronunciation" buttons with the same id; the second is a dead `href="#"`. Decide later whether to drop it (behavior change).
- `buildNotesMd`/`exportNotesMd` ported to `src/features/notes/notes-md.ts` on the typed data layer. `public/js/export.js` stays: `edit.html` still uses it.
- Legacy `localStorage`: none. Data calls: decks, slides, notes (read only).
- Fixed CSS: dropped an overridden duplicate `font-weight: 500` in `.title` (400 already won).

### P4-3 script.html (React + TypeScript)
- Ids kept: `#progress`, `#header`, `#prevSlide`, `#nextSlide`, `#slide-counter`, `#decreaseFont`, `#increaseFont`, `#toggleHL`, `#editNotesLink`, `#marpLink`, `#sync-badge`, `#sync-label`, `#mode-label`, `#error-banner`, `#script`, `.sec`/`.sec-label`/`.sec-body`.
- Shortcuts list copied as is (bindShortcutsHelp "Script"), still bound before the auth check.
- localStorage: `speakeasy:notes:fontsize` (legacy `slides-editor:notes:fontsize` migrated). Data: decks, slides, notes (read only). Realtime: `speakeasy-sync-<room>` via the runtime `public/js/sync.js`, loaded by URL through `src/lib/legacy-runtime.ts` (also used for shortcuts-help.js). Both stay in `public/` because present/view still use them.
- Removed `public/js/script-view.js` (only this page used it).
- Biome reports 8 CSS warnings (`!important`, specificity order) in `script.css`. The CSS is copied verbatim on purpose; clean up in the Phase 5 pass.

### P4-4 script-edit.html (React + TypeScript)
- Ids kept: `#toolbar`, `#deck-title`, `#slides-link`, `#read-link`, `#present-link`, `#preview-toggle`, `#save-version`, `#history-toggle`, `#status` (`data-kind`), `#edit-sections .edit-sec` (`data-section-id`, `.active`), `#edit-heading`, `#edit-textarea`, `#edit-preview`, `#hist-drawer`, `#history-panel`.
- Shortcuts: Cmd/Ctrl+S saves a version (also inside the textarea), H toggles History; list copied ("Notes (script-edit)").
- Data: notes upsert (800ms debounce, flush on section switch, on Save, on beforeunload), `notes.getOne` after a notes restore. The `sections` array is mutated after a save on purpose (legacy snapshot behaviour).
- The History drawer stays the legacy `public/js/history-ui.js` (imperative `HistoryUI`, shared with edit.html), loaded by URL via `src/lib/legacy-runtime.ts`. It is rewritten in React with P4-7f.
- `.hist-drawer.open`, `#history-toggle.active`, `#preview-toggle.active`, `body.hide-preview` are still toggled on the DOM (the legacy HistoryUI also edits those classes), so React does not own them.
- Removed `public/js/script-edit-view.js` (only this page used it). `markdown-lite.js` stays (edit-bootstrap uses it).
- Dropped an overridden duplicate `font-weight: 500` in `#toolbar .title`.

### P4-5 index.html (React + TypeScript)
- Markup converted mechanically to JSX (`DecksView.tsx`); every id/class/data attribute kept (`#status`, `#deck-list`, `#import-*`, `#reimport-*`, `.reimport-part[data-part]`, `data-reimport-deck`, `data-delete-deck`).
- The Import / Re-import / deck-list logic is a typed port in `src/features/decks/controller.ts` that drives the page by id (same first-pass approach as P4-1). Converting it to React state is later cleanup.
- Data: decks, slides, notes, history (`appendManualBatch` before a re-import), storage (`uploadImportedAsset`). `public/js/remote-source.js` stays in `public/` and is loaded by URL through `src/lib/legacy-runtime.ts` (edit.html's importers may still use it).
- localStorage: `speakeasy:github-token`. Token still comes from the typed field or `window.GITHUB_TOKEN`.

### P4-6 pronunciation.html (React + TypeScript)
- Ids kept: `#toolbar`, `#deck-title`, `#speed-slider`, `#speed-label`, `#tts-engine`, `#export-btn`, `#export-progress(-bar)`, `#export-status`, `#notes-link`, `#main-grid`, `#section-list .sec-item`, `#sec-score-N`, `#script-pane`, `#script-title`, `#script-num`, `#slide-iframe`, `#script-body`, `#training-panel`, `#trn-resizer`, `#training-mount`.
- The shared training panel (`training-panel.js`, TTS/record/score), `preload-assets.js` and `slide-fit.js` stay in `public/` (edit.html uses the panel too) and are loaded by URL via `src/lib/legacy-runtime.ts`. The panel mounts into the empty `#training-mount`, so React never owns its DOM; `destroy()` runs on unmount.
- Legacy quirk kept: `#sec-resizer` (left column resizer) is not rendered. The old page created it and then wiped it when it rebuilt the section list, so it never worked. Only `#trn-resizer` works. Decide later whether to make the left one work (behavior change).
- Markdown/notes loading uses `buildNotesMd` from `src/features/notes/notes-md.ts`. The `edit-frame:request-data` postMessage answer, per-section score badges, and the export (merge to WAV, `<deck>-<speed>x.wav`) are unchanged.
- Only auth and link tests existed for this page (P0). A throwaway smoke spec (sections, selection, speed label, engine, no page errors) passed and was deleted; add a permanent one in a later pass if wanted.
- Dropped an overridden duplicate `font-weight: 500` in `#toolbar .title`.

### P4-7a edit-next.html shell (React + TypeScript)
- New page `/edit-next.html` (Vite entry `edit-next.html`, `src/pages/edit/main.tsx`, `src/features/edit/EditShell.tsx`, `edit.css` copied verbatim from edit.html). The legacy `public/edit.html` stays until P4-7h.
- Done in 7a: auth gate, deck load, toolbar markup, 3-column layout markup, side-panel folding (`speakeasy:edit:collapsed:{slide-list,props,training}`, `[` `]` keys, arrows/titles), panel sizes (`slidesEditor.slideListWidth|propsPanelWidth|propsPanelHeight`, clamped and written back on load), both resizers, in-place deck rename, dropdown closing (outside press, Escape, blur, press inside the canvas iframe), toast and status, the "Edit" shortcuts help.
- `EditShell` exposes `useEditChrome()` (`setStatus`, `toast`) for the next steps. The body class is built from React state (`slide-list-collapsed`, `props-collapsed`); 7c must add `portrait-mode`/`html-mode` through the same `bodyClass`, and keep `gridTemplateRows` handling (see `applyPropsPanelHeight`).
- Not yet wired (their buttons exist and do nothing): slide list items, canvas, notes, key message, Save version, History, Frame, Share, SVG, Assets, Export items, mode select.
- Test strategy: `tests/e2e/p4-7a-edit-shell.spec.ts` runs the same 6 assertions against `/edit.html` (the oracle) and `/edit-next.html`; both pass. A mutation (renaming the collapse key) made the new page fail, so the test can fail. Notes for the test: each resizer handle sticks half outside its clipping panel, so grab the visible half.
- For the next steps, follow the same method: write assertions that pass on the legacy page first, then run them on `/edit-next.html`.
- CSS: dropped an overridden duplicate `font-weight: 500` in `#toolbar .title`.

### P4-7b slide list on /edit-next.html
- `src/features/edit/model.ts` (`useEditorModel`) holds the editor state shared by all panels: `slides`, `currentSectionId`, `notesRef`/`keyMessagesRef` (kept current like legacy), the slide mutations (select, rename, add, duplicate, hide/show, delete, reorder) and `registerFlusher(fn)`. Panels that buffer edits (notes in 7d, HTML mode in 7c, the training panel in 7h) must register a flusher so `switchSlide` saves them first, like the legacy `flushNotesSave/flushHtmlSave`. `showSlide` already sets the canvas iframe `src` (the full canvas protocol is 7c).
- `SlideList.tsx` renders `#slide-list-items` (`.slide-item[data-section-id][data-hidden]`, `.slide-action-*`, `#add-slide`), `#slide-list-title`, `#slide-list-count`; HTML5 drag and drop calls `reorder_slides`. The fold button is passed in from EditShell.
- Kept legacy quirks on purpose: the Present link's `section` only follows the slide on load and on a list click (not after add/duplicate/delete); Delete closes its menu after the action, the others before; slide title save is 600 ms; a duplicate inserts at a tail order, then reorders.
- Deliberate differences (both are legacy race bugs, the new page behaves better): (1) the old page redraws the whole list when a pending title save finishes, which can swallow the click that caused the blur (the first click on another slide does nothing); the new page keeps the DOM, so that click selects. (2) The old page can leave the saved title of the slide you just left in the title field when its blur save finishes late; the new page re-syncs the field.
- The fake backend does not cascade a slide delete to notes (the real DB does through the foreign key), so tests cannot assert note deletion.
- `tests/e2e/p4-7b-slide-list.spec.ts`: 9 assertions on both `/edit.html` and `/edit-next.html`, stable over 3 runs; a mutation (dropping the reorder RPC) made the new page fail.

### P4-7c canvas on /edit-next.html
- `useCanvas.ts`: fit/scale of `#canvas` (`slide-fit.js` via legacy-runtime, off in "stretch"), the whole `edit:*` / `edit-frame:*` message protocol with the iframe (§2.4: dirty, save, noop, ready + `edit:set-autosave` reply, error, `request-data` answered from the cache), and the `<` `>` preview buttons (same DOM-event dispatch, `edit:preview-fallback`, `edit:preview-back`).
- `useHtmlEditor.ts`: raw HTML mode. CodeMirror (vendor script) with a textarea + highlight.js fallback, 800 ms autosave (`slidesEditor.autoSave` in localStorage, no toolbar control any more), `<section>…</section>` validation that keeps the buffer, title sync from `data-title`, format on entering html mode and with Cmd/Ctrl+Shift+F, flush on slide switch / mode change / unload. `src/lib/format-html.ts` is the formatter.
- `EditShell` owns `mode` ("aspect-169" | "portrait" | "html" | "stretch"): body classes `portrait-mode` / `html-mode`, canvas-wrap classes `aspect-169` / `portrait-169` / `html-mode`, the portrait grid rows from `slidesEditor.propsPanelHeight`. The model has `htmlModeRef`/`htmlEditorRef` so slide switches reload the code editor in html mode.
- The vendor highlight.js / CodeMirror tags are copied into `edit-next.html`.
- Quirk kept: `edit:save` from the iframe updates the cached slide in place and does not redraw the list (so a changed hidden flag shows after the next redraw), like the legacy page.
- Test notes: `tests/e2e/p4-7c-canvas.spec.ts` (8 assertions on both pages, stable over 3 runs; a mutation that dropped the save made the new page fail). Entering html mode formats and may save, so wait for that before reading the DB; the inline editor's `ready` message races any message a test posts, so wait for it first.

### P4-7d notes panel on /edit-next.html
- `NotesPanel.tsx`: `#notes-textarea` and `#key-message-textarea` (read from the model's caches on slide change, `disabled` without a slide), 800 ms debounced saves (`slidesEditor.autoSave` in localStorage, no toolbar control), key message flushed together with notes, flush registered with the model (slide switch) and on `beforeunload`, "Import .md" for key messages (by slide order, confirm before replacing, same toasts and statuses), notes font size (`--notes-font-size` on `<html>`, `slidesEditor.notesFontSize`, 11–20 px, default 14).
- Not ported on purpose: the legacy "Listen" (ElevenLabs) code for the notes. Its buttons (`#notes-tts-listen`, `#notes-tts-stop`) are not in `edit.html`, so it never ran. The plan's "TTS" item for 7d therefore has nothing to port; the working TTS is the training panel (7h).
- Kept quirk: after a delete the legacy page reloads the textareas from the cache even when the current slide did not change; the new page only reloads on a slide change or an import.
- `tests/e2e/p4-7d-notes-panel.spec.ts`: 7 assertions on both pages, stable over 4 runs; a mutation that dropped the notes save made the new page fail. Test notes: wait for the iframe's `ready` status before asserting statuses, and do not select another slide right before a status assertion (the new slide's inline editor reports in later and overwrites the status).

### P4-7e asset library on /edit-next.html
- `AssetLibrary.tsx` is always mounted; `#images-modal-bg` gets `.show` from the shell (`#images-btn` in the More menu, the `I` key, Close, a click on the backdrop but not inside the modal). The list is re-read from Storage each time it opens ("loading…", then cards, an empty-library note, or the error text). Cards keep `.img-card[data-path|url|kind|name]` with `.act-copy`, `.act-insert`, `.act-rename`, `.act-del`; the filter (`#images-filter`) matches the name and the source label ("shared", "this deck", or the other deck id) and keeps its text between openings, like the legacy DOM.
- Upload (`#images-upload-input`, multiple): sequential, "uploading i/n: name…" status, then "uploaded n" or "uploaded n, failed m" with the same toasts. Insert posts `edit:insert-asset` `{url, name, kind}` to the canvas and closes the modal. Rename: native `prompt`, `copyAssetForRename`, then `rename_asset_references`, then delete the old file; on an RPC error the copy is removed again; the card shows the `uploading` overlay meanwhile. Delete: native `confirm`.
- New small modules: `src/lib/clipboard.ts` (`copyText`, port of `clipboard.js`) and `renameAssetReferences` in `src/data/storage.ts`. `public/js/clipboard.js` stays until the legacy editor goes (7h).
- Not ported: the legacy `#images-drop-zone` drop handler. That element does not exist in `edit.html`, so the code never ran (the empty-library text still says "drop files here", as before).
- Test notes: the leftmost card button ("Copy URL") is half-clipped by the 140 px card on both pages, so the test sends the click event instead of a pointer click; the Assets button is inside the closed More menu, so open it first; a `prompt` needs `page.removeAllListeners("dialog")` before a one-off handler (the shared fixture auto-accepts every dialog).
- `tests/e2e/p4-7e-assets.spec.ts`: 10 assertions on both pages, stable over 3 runs; a mutation that dropped the reference rewrite made the new page fail (the legacy page passed).
