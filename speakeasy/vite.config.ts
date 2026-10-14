import { defineConfig } from "vite";

// Phase 2 (docs/modernization-plan.md §7): the app is still the legacy
// static pages in public/, which Vite copies to dist/ byte for byte. The only
// entry is a placeholder until the first page moves to React (Phase 4).
export default defineConfig({
  // Plain multi-page site: no single-page fallback to index.html.
  appType: "mpa",
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: "src/pages/_placeholder/index.html",
    },
  },
});
