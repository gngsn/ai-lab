import { createRoot } from "react-dom/client";
import { buildNotesMd } from "../../features/notes/notes-md";
import { PronunciationView } from "../../features/pronunciation/PronunciationView";
import { errorMessage } from "../../lib/errors";
import { mountPoint, requireOwner, runPage, stop } from "../../lib/page";

async function main() {
  await requireOwner("Access denied.");
  const deckId = new URLSearchParams(location.search).get("deck");
  if (!deckId) stop("Missing ?deck=");
  const mount = mountPoint("root");
  const built = await buildNotesMd(deckId).then(
    ({ deck, slides, notes }) => ({ deck, slides, notes }),
    (error: unknown) => ({ error: errorMessage(error) }),
  );
  createRoot(mount).render(<PronunciationView deckId={deckId} loaded={built} />);
}

runPage(main);
