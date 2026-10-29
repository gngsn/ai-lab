import { createRoot } from "react-dom/client";
import { getDeck } from "../../data/decks";
import { listByDeck as listNotes } from "../../data/notes";
import { listByDeck as listSlides } from "../../data/slides";
import { EditShell } from "../../features/edit/EditShell";
import { mountPoint, requireOwner, runPage, stop } from "../../lib/page";

async function main() {
  await requireOwner("Edit access denied.");
  const deckId = new URLSearchParams(location.search).get("deck");
  if (!deckId) stop("Missing ?deck=<deck_id>");
  const mount = mountPoint("root");
  const [deck, slides, allNotes] = await Promise.all([
    getDeck(deckId),
    listSlides(deckId),
    listNotes(deckId),
  ]);
  const notes = new Map(allNotes.map((n) => [n.section_id, n.content ?? ""]));
  const keyMessages = new Map(allNotes.map((n) => [n.section_id, n.key_message ?? ""]));
  createRoot(mount).render(
    <EditShell
      deck={deck}
      deckId={deckId}
      slides={slides}
      notes={notes}
      keyMessages={keyMessages}
    />,
  );
}

runPage(main);
