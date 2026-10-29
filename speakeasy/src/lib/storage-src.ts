// supabase://slides-images/<path> links, as older slides stored them, to the
// public https URL.
import { getConfig } from "../config";

const SCHEME_PREFIX = "supabase://slides-images/";

const normalizePath = (path: unknown) => String(path || "").replace(/^\/+/, "");

/** The path inside the bucket, or null when it is not a supabase:// link. */
export function fromStorageSrc(src: unknown): string | null {
  const text = String(src || "");
  if (!text.startsWith(SCHEME_PREFIX)) return null;
  return normalizePath(text.slice(SCHEME_PREFIX.length));
}

export function resolveStorageSrc(src: string): string {
  const path = fromStorageSrc(src);
  if (!path) return src;
  const base = String(getConfig().supabaseUrl || "").replace(/\/+$/, "");
  if (!base) return src;
  return `${base}/storage/v1/object/public/slides-images/${encodeURI(path)}`;
}

export function resolveStorageSourcesInHtml(html: unknown): string {
  return String(html || "").replace(/supabase:\/\/slides-images\/([^\s"'<>]+)/g, (_, path) =>
    resolveStorageSrc(`${SCHEME_PREFIX}${path}`),
  );
}
