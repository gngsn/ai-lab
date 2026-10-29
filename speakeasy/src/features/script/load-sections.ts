// The deck and, for each of its slides, the speaker notes: what the script
// reader and the notes editor both start from.
import { getDeck } from "../../data/decks";
import { listByDeck as listNotes } from "../../data/notes";
import { listByDeck as listSlides } from "../../data/slides";

export type Section = { section_id: string; order: number; title: string; body: string };

export async function loadSections(deckId: string) {
  const [deck, slides, notes] = await Promise.all([
    getDeck(deckId),
    listSlides(deckId),
    listNotes(deckId),
  ]);
  const notesByKey = new Map(notes.map((n) => [n.section_id, n.content]));
  const sections: Section[] = slides.map((s) => ({
    section_id: s.section_id,
    order: s.order,
    title: s.title,
    body: notesByKey.get(s.section_id) || "",
  }));
  return { deck, sections };
}
