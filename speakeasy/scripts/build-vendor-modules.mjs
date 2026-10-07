import { build } from "esbuild";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const entryDir = path.join(root, "vendor", "modules", "entry");
const outDir = path.join(root, "vendor", "modules");

await mkdir(outDir, { recursive: true });

const jobs = [
  {
    entryPoints: [path.join(entryDir, "supabase-client-entry.js")],
    outfile: path.join(outDir, "supabase-client.mjs"),
  },
  {
    entryPoints: [path.join(entryDir, "dompurify-entry.js")],
    outfile: path.join(outDir, "dompurify.mjs"),
  },
];

for (const job of jobs) {
  await build({
    ...job,
    bundle: true,
    format: "esm",
    platform: "browser",
    target: ["es2020"],
    sourcemap: false,
    minify: true,
    legalComments: "none",
  });
}

console.log("[vendor] built supabase-client.mjs and dompurify.mjs");
