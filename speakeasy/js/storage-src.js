const SCHEME_PREFIX = "supabase://slides-images/";

function normalizePath(path) {
  return String(path || "").replace(/^\/+/, "");
}

export function toStorageSrc(path) {
  const normalized = normalizePath(path);
  return normalized ? `${SCHEME_PREFIX}${normalized}` : "";
}

export function fromStorageSrc(src) {
  const text = String(src || "");
  if (!text.startsWith(SCHEME_PREFIX)) return null;
  return normalizePath(text.slice(SCHEME_PREFIX.length));
}

export function resolveStorageSrc(src) {
  const path = fromStorageSrc(src);
  if (!path) return src;
  const base = String(window.SUPABASE_URL || "").replace(/\/+$/, "");
  if (!base) return src;
  return `${base}/storage/v1/object/public/slides-images/${encodeURI(path)}`;
}

export function resolveStorageSourcesInHtml(html) {
  return String(html || "").replace(
    /supabase:\/\/slides-images\/([^\s"'<>]+)/g,
    (_, path) => resolveStorageSrc(`${SCHEME_PREFIX}${path}`),
  );
}
