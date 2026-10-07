// Download every media file a deck uses up front, so moving between slides
// never waits on the network.
//
// - "blob" mode (present / shared view): each file is downloaded once and its
//   URL in the deck HTML is swapped for a local blob: URL before the deck is
//   written, so nothing — not even video seeking — goes back to the network.
// - "warm" mode (editor / practice): files are fetched to fill the HTTP cache
//   but URLs stay untouched, because those pages save slide HTML back to the
//   database and must never persist a temporary blob: URL.
//
// Files that can't be fetched cross-origin are skipped and keep loading
// normally from their original URL.
import { resolveStorageSourcesInHtml } from "./storage-src.js";

const ATTR_RE = /\b(?:src|poster)\s*=\s*(["'])(https?:\/\/[^"']+)\1/gi;
const CSS_URL_RE = /url\(\s*(["']?)(https?:\/\/[^"')]+)\1\s*\)/gi;
// Font/CSS CDNs serve their own caching headers; skip them.
const SKIP_HOSTS = /(^|\.)(fonts\.googleapis\.com|fonts\.gstatic\.com)$/i;

/** Unique absolute media URLs referenced by src/poster or CSS url(). */
export function collectAssetUrls(html) {
  const urls = new Set();
  for (const re of [ATTR_RE, CSS_URL_RE]) {
    for (const m of String(html).matchAll(re)) {
      const url = m[2].replace(/&amp;/g, "&").split("#")[0];
      try {
        if (!SKIP_HOSTS.test(new URL(url).hostname)) urls.add(url);
      } catch {
        /* not a URL */
      }
    }
  }
  return [...urls];
}

/**
 * Fetch every URL (4 at a time). Returns Map<url, blobUrl> in "blob" mode,
 * an empty Map in "warm" mode. onProgress({ done, total, bytes }) after each.
 */
export async function preloadAssets(
  urls,
  { mode = "blob", onProgress = () => {}, concurrency = 4 } = {},
) {
  const map = new Map();
  let done = 0;
  let bytes = 0;
  const queue = [...urls];
  const worker = async () => {
    while (queue.length) {
      const url = queue.shift();
      try {
        const res = await fetch(url, { cache: "force-cache" });
        if (res.ok) {
          const blob = await res.blob();
          bytes += blob.size;
          if (mode === "blob") map.set(url, URL.createObjectURL(blob));
        }
      } catch {
        // Cross-origin without CORS, offline… leave the original URL.
      }
      done++;
      onProgress({ done, total: urls.length, bytes });
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(concurrency, urls.length) }, worker),
  );
  return map;
}

/** Replace each preloaded URL in the HTML with its blob: URL. A URL's
 *  #fragment (e.g. a video's #t=0.1) is kept. */
export function applyAssetMap(html, map) {
  let out = String(html);
  for (const [url, blobUrl] of map) {
    out = out.split(url).join(blobUrl);
    const encoded = url.replace(/&/g, "&amp;");
    if (encoded !== url) out = out.split(encoded).join(blobUrl);
  }
  return out;
}

/** "warm" every asset of a deck (frame + all slides) into the HTTP cache. */
export function warmDeckAssets(deck, slides, { onProgress } = {}) {
  const html = resolveStorageSourcesInHtml(
    [deck?.frame_html || "", ...slides.map((s) => s.content || "")].join("\n"),
  );
  return preloadAssets(collectAssetUrls(html), { mode: "warm", onProgress });
}

export const formatBytes = (n) =>
  n < 1024 * 1024
    ? `${Math.round(n / 1024)} KB`
    : `${(n / 1024 / 1024).toFixed(1)} MB`;
