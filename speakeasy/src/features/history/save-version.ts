import { getDeck } from "../../data/decks";
import { appendManualBatch } from "../../data/history";
import { listByDeck as listNotes } from "../../data/notes";
import { listByDeck as listSlides } from "../../data/slides";
import { askText } from "../../lib/dom-prompt";

/**
 * Ask for a snapshot message, then write one manual history row per slide,
 * note and the frame. Resolves to the snapshot's timestamp, or null when the
 * prompt was cancelled.
 */
export async function saveVersionPrompt(deckId: string): Promise<string | null> {
  const message = await askText({
    title: "Save Version",
    message: "Snapshot message (optional)",
    defaultValue: "",
  });
  if (message === null) return null;
  const slides = await listSlides(deckId);
  const notes = await listNotes(deckId);
  const deck = await getDeck(deckId);
  return appendManualBatch(deckId, message, slides, notes, deck.frame_html);
}
