import { defineConfig } from "vite";

// One entry (index.html) serves every React page; src/main.tsx picks the page
// from the URL. The deck runtime pages (present, view, share, edit-frame) are
// still plain files in public/ until Phase 6 moves them. `spa` makes the dev
// and preview servers answer /edit, /edit.html, ... with index.html.
export default defineConfig({
  appType: "spa",
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
