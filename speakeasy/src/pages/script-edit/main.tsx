import { createRoot } from "react-dom/client";
import { getDeck } from "../../data/decks";
import { listByDeck as listNotes } from "../../data/notes";
import { listByDeck as listSlides } from "../../data/slides";
import { ScriptEditView } from "../../features/script-edit/ScriptEditView";
import { ensureAuthed } from "../../lib/auth";

const ERR_STYLE = "padding:2rem;color:var(--se-bad, #b42318)";

async function main() {
  if (!(await ensureAuthed())) {
    document.body.innerHTML = `<p style="${ERR_STYLE};font-family:monospace">Edit access denied.</p>`;
    throw new Error("auth");
  }
  const deckId = new URLSearchParams(location.search).get("deck");
  if (!deckId) {
    document.body.innerHTML = `<p style="${ERR_STYLE}">Missing ?deck=&lt;deck_id&gt;</p>`;
    throw new Error("no deck");
  }
  let loaded: Awaited<ReturnType<typeof load>>;
  try {
    loaded = await load(deckId);
  } catch (error) {
    document.body.innerHTML = `<p style="${ERR_STYLE}">Load failed: ${(error as Error).message}</p>`;
    return;
  }
  const mount = document.getElementById("root");
  if (!mount) throw new Error("Missing #root mount point");
  createRoot(mount).render(
    <ScriptEditView deck={loaded.deck} deckId={deckId} sections={loaded.sections} />,
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
  if (!(error instanceof Error && ["auth", "no deck"].includes(error.message)))
    console.error(error);
});
