import { getDeck } from "../../data/decks";
import { listByDeck as listNotes } from "../../data/notes";
import { listByDeck as listSlides } from "../../data/slides";

const slugify = (s: string | null | undefined) =>
  (s || "deck")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "deck";

function downloadBlob(filename: string, mime: string, content: string) {
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

export async function buildNotesMd(deckId: string) {
  const [deck, slides, notes] = await Promise.all([
    getDeck(deckId),
    listSlides(deckId),
    listNotes(deckId),
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
  return { deck, slides, notes, content: `${frontmatter}${body}\n` };
}

export async function exportNotesMd(deckId: string, { copy = false } = {}) {
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
