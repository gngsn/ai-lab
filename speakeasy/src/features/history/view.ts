// Pure helpers of the history drawer.

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};
export const escapeHtml = (s: unknown) =>
  String(s).replace(/[&<>"']/g, (c) => ESCAPES[c] as string);

/** Time of day for today's rows, the full date and time for older ones. */
export const fmtTime = (iso: string, now: Date = new Date()) => {
  const d = new Date(iso);
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  return sameDay ? d.toLocaleTimeString() : d.toLocaleString();
};

const PREVIEW_LIMIT = 6000;

/**
 * The HTML of a row's content viewer: escaped, cut at 6000 characters of the
 * escaped text (so the cut may end inside an entity), with a note when the
 * original was longer.
 */
export const previewHtml = (content: string) =>
  `${escapeHtml(content).slice(0, PREVIEW_LIMIT)}${content.length > PREVIEW_LIMIT ? "\n… (truncated)" : ""}`;
