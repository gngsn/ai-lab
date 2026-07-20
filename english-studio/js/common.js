/**
 * common.js — shared helpers for english-studio pages.
 */

export const $ = (id) => document.getElementById(id);

export function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export async function sha1(text) {
  const buf = await crypto.subtle.digest(
    "SHA-1",
    new TextEncoder().encode(text),
  );
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Split an article into paragraphs of sentences.
 * Returns [[sentence, ...], ...] — one inner array per paragraph.
 * Handles common abbreviations so "Mr. Smith" doesn't split mid-name.
 */
export function splitParagraphs(text) {
  // Common abbreviations plus any single capital initial ("U.", "F.")
  const ABBR = /\b(Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|vs|etc|e\.g|i\.e|Fig|No|U\.S|U\.K|[A-Z])\.$/;
  return String(text)
    .split(/\n{2,}|\r\n{2,}/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .map((p) => {
      const parts = p.match(/[^.!?]+[.!?]+["')\]]*\s*|[^.!?]+$/g) || [p];
      const sentences = [];
      let cur = "";
      for (const part of parts) {
        cur += part;
        if (!ABBR.test(cur.trim())) {
          sentences.push(cur.trim());
          cur = "";
        }
      }
      if (cur.trim()) sentences.push(cur.trim());
      return sentences;
    });
}

export function fmtTime(ts) {
  return new Date(ts).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Mark the current page's nav link active. */
export function initNav() {
  const page = location.pathname.split("/").pop() || "index.html";
  document.querySelectorAll("#toolbar nav a").forEach((a) => {
    if (a.getAttribute("href") === "./" + page) a.classList.add("active");
  });
}
