import { defineConfig } from "vite";

// Legacy pages remain in public/ unchanged; migrated pages are Vite entries.
export default defineConfig({
  // Plain multi-page site: no single-page fallback to index.html.
  appType: "mpa",
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        placeholder: "src/pages/_placeholder/index.html",
        captions: "captions.html",
        notes: "notes.html",
      },
    },
  },
});
