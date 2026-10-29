import { createRoot } from "react-dom/client";
import { loadSections } from "../../features/script/load-sections";
import { ScriptEditView } from "../../features/script-edit/ScriptEditView";
import { errorMessage } from "../../lib/errors";
import { mountPoint, requireOwner, runPage, showError, stop } from "../../lib/page";

async function main() {
  await requireOwner("Edit access denied.");
  const deckId = new URLSearchParams(location.search).get("deck");
  if (!deckId) stop("Missing ?deck=<deck_id>");
  let loaded: Awaited<ReturnType<typeof loadSections>>;
  try {
    loaded = await loadSections(deckId);
  } catch (error) {
    return showError(`Load failed: ${errorMessage(error)}`);
  }
  createRoot(mountPoint("root")).render(
    <ScriptEditView deck={loaded.deck} deckId={deckId} sections={loaded.sections} />,
  );
}

runPage(main);
