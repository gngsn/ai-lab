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
