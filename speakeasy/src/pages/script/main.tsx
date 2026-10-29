import { createRoot } from "react-dom/client";
import { getDeck } from "../../data/decks";
import { listByDeck as listNotes } from "../../data/notes";
import { listByDeck as listSlides } from "../../data/slides";
import { ScriptView } from "../../features/script/ScriptView";
import { ensureAuthed } from "../../lib/auth";
import { bindShortcutsHelp } from "../../lib/shortcuts-help";

function fatal(message: string): never {
  // The legacy banner lives in the page chrome, which is not rendered yet.
  const banner = document.createElement("div");
  banner.id = "error-banner";
  banner.textContent = message;
  banner.style.display = "block";
  document.body.appendChild(banner);
  throw new Error(message);
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

  if (!(await ensureAuthed())) {
    document.body.innerHTML =
      '<p style="padding:2rem;color:var(--se-bad, #b42318);font-family:monospace">Access denied — script (notes) view is owner-only.</p>';
    throw new Error("auth");
  }

  const params = new URLSearchParams(location.search);
  const deckId = params.get("deck") || location.pathname.match(/\/script\/([^/?]+)/)?.[1];
  const syncId = params.get("sync");
  if (!deckId) fatal("Missing ?deck=<deck_id> in URL.");

  let loaded: Awaited<ReturnType<typeof load>>;
  try {
    loaded = await load(deckId);
  } catch (error) {
    fatal(`Failed to load deck '${deckId}': ${(error as Error).message}`);
  }
  const mount = document.getElementById("app");
  if (!mount) throw new Error("Missing #app mount point");
  createRoot(mount).render(
    <ScriptView deck={loaded.deck} sections={loaded.sections} syncId={syncId} deckId={deckId} />,
  );
}

async function load(deckId: string) {
  const [deck, slides, notes] = await Promise.all([
    getDeck(deckId),
    listSlides(deckId),
    listNotes(deckId),
  ]);
  const notesByKey = new Map(notes.map((n) => [n.section_id, n.content]));
  const sections = slides.map((s) => ({
    section_id: s.section_id,
    order: s.order,
    title: s.title,
    body: notesByKey.get(s.section_id) || "",
  }));
  return { deck, sections };
}

void main().catch((error: unknown) => {
  const known = error instanceof Error && error.message === "auth";
  if (!known && !document.getElementById("error-banner")) console.error(error);
});
