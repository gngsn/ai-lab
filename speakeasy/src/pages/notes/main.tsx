import { createRoot } from "react-dom/client";
import { NotesView } from "../../features/notes/NotesView";
import { buildNotesMd } from "../../features/notes/notes-md";
import { errorMessage } from "../../lib/errors";
import { mountPoint, requireOwner, runPage, showError, stop } from "../../lib/page";

const ERROR = { className: "err" };

async function main() {
  await requireOwner("Access denied — Marp view is owner-only.", ERROR);
  const deckId = new URLSearchParams(location.search).get("deck");
  if (!deckId) stop("Missing ?deck=<deck_id>", ERROR);
  let built: Awaited<ReturnType<typeof buildNotesMd>>;
  try {
    built = await buildNotesMd(deckId);
  } catch (error) {
    return showError(errorMessage(error), ERROR);
  }
  createRoot(mountPoint("app")).render(
    <NotesView deck={built.deck} deckId={deckId} content={built.content} />,
  );
}

runPage(main);
