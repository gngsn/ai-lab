// Builds the fake database the e2e tests start from, using the app's own
// importer (js/import-html.js) so fixture decks are stored exactly the way
// a real import would store them.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseImportedHtmlDeck, parseNotesMd } from "../../js/import-html.js";

const fixture = (name: string) =>
  readFileSync(fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url)), "utf8");

export const DECK = "controller-deck"; // deck mode, shared (token "tok")
export const PLAIN = "plain-deck"; // speakeasy mode, not shared
export const TOKEN = "tok";
export const KEY_MESSAGE = { title: "Two steps", text: "Two steps, one idea" };
export const BILINGUAL = fixture("controller-deck.bilingual.md");

type Row = Record<string, unknown>;
export type FakeDb = Record<string, Row[]>;

function deckRows(deckId: string, file: string, shareToken: string | null) {
  const parsed = parseImportedHtmlDeck(fixture(file), { deckId });
  const deck: Row = {
    deck_id: deckId,
    title: parsed.title,
    frame_html: parsed.frameHtml,
    share_token: shareToken,
    owner_email: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: deckId === DECK ? "2026-01-02T00:00:00.000Z" : "2026-01-01T00:00:00.000Z",
  };
  const slides: Row[] = parsed.slides.map(
    (s: { section_id: string; order: number; title: string; content: string }) => ({
      deck_id: deckId,
      section_id: s.section_id,
      order: s.order,
      title: s.title,
      content: s.content,
      updated_at: deck.updated_at,
    }),
  );
  return { deck, slides };
}

export function buildSeed(): FakeDb {
  const a = deckRows(DECK, "controller-deck.html", TOKEN);
  const b = deckRows(PLAIN, "plain-deck.html", null);
  const notesByTitle = new Map(
    parseNotesMd(fixture("controller-deck.notes.md")).map(
      (n: { title: string | null; body: string }) => [n.title, n.body],
    ),
  );
  const notes: Row[] = a.slides.map((s) => ({
    deck_id: DECK,
    section_id: s.section_id,
    content: notesByTitle.get(s.title as string) ?? "",
    key_message: s.title === KEY_MESSAGE.title ? KEY_MESSAGE.text : "",
    updated_at: a.deck.updated_at,
  }));
  return {
    decks: [a.deck, b.deck],
    slides: [...a.slides, ...b.slides],
    notes,
    slide_history: [],
    notes_history: [],
    frame_history: [],
  };
}
