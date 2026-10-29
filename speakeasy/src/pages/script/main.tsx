import { createRoot } from "react-dom/client";
import { loadSections } from "../../features/script/load-sections";
import { ScriptView } from "../../features/script/ScriptView";
import { errorMessage } from "../../lib/errors";
import { ERROR_STYLE, mountPoint, PageError, requireOwner, runPage } from "../../lib/page";
import { bindShortcutsHelp } from "../../lib/shortcuts-help";

/** The error banner of the page chrome, which is not rendered yet at this point. */
function stopWithBanner(message: string): never {
  const banner = document.createElement("div");
  banner.id = "error-banner";
  banner.textContent = message;
  banner.style.display = "block";
  document.body.appendChild(banner);
  throw new PageError(message);
}

async function main() {
  await bindShortcutsHelp("Script", [
    { keys: ["↓", "→", "PgDn", "j"], desc: "Next section (manual)" },
    { keys: ["↑", "←", "PgUp", "k"], desc: "Previous section (manual)" },
    { keys: ["Click section"], desc: "Jump to section (manual)" },
    { keys: ["Click sync"], desc: "Toggle auto / manual mode" },
    { keys: ["A−", "A+"], desc: "Font size" },
    { keys: ["HL"], desc: "Toggle highlight dimming" },
    { keys: ["?"], desc: "This help" },
  ]);

  await requireOwner("Access denied — script (notes) view is owner-only.", {
    style: ERROR_STYLE.denied,
  });

  const params = new URLSearchParams(location.search);
  const deckId = params.get("deck") || location.pathname.match(/\/script\/([^/?]+)/)?.[1];
  const syncId = params.get("sync");
  if (!deckId) stopWithBanner("Missing ?deck=<deck_id> in URL.");

  let loaded: Awaited<ReturnType<typeof loadSections>>;
  try {
    loaded = await loadSections(deckId);
  } catch (error) {
    stopWithBanner(`Failed to load deck '${deckId}': ${errorMessage(error)}`);
  }
  createRoot(mountPoint("app")).render(
    <ScriptView deck={loaded.deck} sections={loaded.sections} syncId={syncId} deckId={deckId} />,
  );
}

runPage(main);
