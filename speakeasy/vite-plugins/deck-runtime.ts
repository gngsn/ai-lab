// The scripts that run INSIDE a deck document (the page a stored frame_html is
// written into) are bundled on their own and served at the fixed URLs decks and
// page bootstraps load them from. They are not part of the React app's module
// graph: they are plain ES modules (or classic scripts) that must keep their
// URL and not be renamed with a content hash.
import { build } from "esbuild";
import type { Plugin } from "vite";

type Entry = { entry: string; format: "esm" | "iife" };

/** Published path (no leading slash) → source entry. Bundles import each other
 *  by URL (`/js/deck-host.js`), never by inlining, so a deck document runs one
 *  copy of each. */
export const DECK_RUNTIME_ENTRIES: Record<string, Entry> = {
  "js/deck-host.js": { entry: "src/runtime/deck-host.ts", format: "esm" },
  "js/view-runtime.js": { entry: "src/runtime/view-runtime.ts", format: "esm" },
  "js/present-runtime.js": { entry: "src/runtime/present-runtime.ts", format: "esm" },
  "js/sync.js": { entry: "src/runtime/sync.ts", format: "esm" },
  "js/shortcuts-help.js": { entry: "src/lib/shortcuts-help.ts", format: "esm" },
  "js/captions/channel.js": { entry: "src/runtime/captions-channel.ts", format: "esm" },
  "js/captions/audience.js": { entry: "src/runtime/captions-audience.ts", format: "esm" },
  // what a stored deck gets for `import("./sync.js")`
  "sync.js": { entry: "src/runtime/sync-stub.ts", format: "esm" },
};

async function bundle({ entry, format }: Entry, minify: boolean): Promise<string> {
  const result = await build({
    entryPoints: [entry],
    bundle: true,
    format,
    platform: "browser",
    target: "es2022",
    // served as they are: the Supabase client, and the other bundles
    external: ["/vendor/*", "/js/*"],
    write: false,
    minify,
    legalComments: "none",
  });
  return result.outputFiles[0].text;
}

export function deckRuntime(): Plugin {
  let minify = false;
  return {
    name: "speakeasy-deck-runtime",
    configResolved(config) {
      minify = config.command === "build";
    },
    // dev: bundle on request, so edits show up on reload
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const path = (req.url || "").split("?")[0].replace(/^\//, "");
        const entry = DECK_RUNTIME_ENTRIES[path];
        if (!entry) return next();
        try {
          res.setHeader("Content-Type", "text/javascript; charset=utf-8");
          res.setHeader("Cache-Control", "no-store");
          res.end(await bundle(entry, false));
        } catch (err) {
          next(err);
        }
      });
    },
    // build: emit next to the page, at the same published path
    async generateBundle() {
      for (const [fileName, entry] of Object.entries(DECK_RUNTIME_ENTRIES)) {
        this.emitFile({ type: "asset", fileName, source: await bundle(entry, minify) });
      }
    },
  };
}
