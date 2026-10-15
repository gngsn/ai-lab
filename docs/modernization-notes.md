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
