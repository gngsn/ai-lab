// Export helpers — HTML / PDF (browser print) / Marp Markdown.
// All exports are pure read-side operations: they fetch from repos and
// either trigger a download, copy to clipboard, or open a print window.
import * as deckRepo from "./repo/deck-repo.js";
import * as slideRepo from "./repo/slide-repo.js";
import * as notesRepo from "./repo/notes-repo.js";

const slugify = (s) =>
  (s || "deck")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "deck";

function downloadBlob(filename, mime, content) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Strip editor-only attributes so the exported HTML is a clean self-contained
// presentation file. `data-edit-id` is removed for share cleanliness; the
// stable-id system only matters during editing.
function stripEditAttrs(html) {
  return html
    .replace(/\s+contenteditable=("true"|true|"")/gi, "")
    .replace(/\s+data-editable=("true"|true)/gi, "")
    .replace(/\s+data-edit-id="[^"]*"/gi, "")
    .replace(/\s+data-section-id="[^"]*"/gi, "");
}

// ── HTML ──────────────────────────────────────────────────────────

export async function buildHtml(deckId) {
  const [deck, slides] = await Promise.all([
    deckRepo.getDeck(deckId),
    slideRepo.listByDeck(deckId),
  ]);
  let slidesHtml = slides.map((s) => s.content).join("\n");
  slidesHtml = stripEditAttrs(slidesHtml);

  let html = deck.frame_html;
  if (html.includes("<!-- slides -->")) {
    html = html.replace("<!-- slides -->", slidesHtml);
  } else {
    html = html.replace(/<\/body>/i, `${slidesHtml}</body>`);
  }
  if (!/^\s*<!doctype/i.test(html)) {
    html = "<!DOCTYPE html>\n" + html;
  }
  return { deck, slides, content: html };
}

export async function exportHtml(deckId) {
  const { deck, content } = await buildHtml(deckId);
  const filename = `${slugify(deck.title)}.html`;
  downloadBlob(filename, "text/html;charset=utf-8", content);
  return { filename, bytes: content.length };
}

// ── PDF (browser print) ───────────────────────────────────────────

export function exportPdf(deckId) {
  const url = `./present.html?deck=${encodeURIComponent(deckId)}&print=1`;
  const w = window.open(url, "_blank");
  if (!w) throw new Error("Popup blocked — allow popups for this site.");
  return { url };
}

// ── Marp notes ────────────────────────────────────────────────────

export async function buildNotesMd(deckId) {
  const [deck, slides, notes] = await Promise.all([
    deckRepo.getDeck(deckId),
    slideRepo.listByDeck(deckId),
    notesRepo.listByDeck(deckId),
  ]);
  const notesByKey = new Map(notes.map((n) => [n.section_id, n.content]));
  const frontmatter = "---\nmarp: true\ntheme: default\n---\n\n";
  const body = slides
    .map((s, i) => {
      const title = s.title || `장표 ${i + 1}`;
      const noteBody = (notesByKey.get(s.section_id) || "").trim();
      // Always leave a blank line under the heading so marp parses cleanly,
      // even when the note body is empty.
      return `## ${title}\n\n${noteBody}\n`;
    })
    .join("\n---\n\n");
  return { deck, slides, notes, content: frontmatter + body + "\n" };
}

export async function exportNotesMd(deckId, { copy = false } = {}) {
  const { deck, content } = await buildNotesMd(deckId);
  if (copy) {
    if (!navigator.clipboard?.writeText) {
      throw new Error("Clipboard API unavailable in this browser.");
    }
    await navigator.clipboard.writeText(content);
    return { copied: true, length: content.length };
  }
  const filename = `${slugify(deck.title)}-notes.md`;
  downloadBlob(filename, "text/markdown;charset=utf-8", content);
  return { filename, bytes: content.length };
}
