import { createRoot } from "react-dom/client";
import { buildNotesMd } from "../../features/notes/notes-md";
import { PronunciationView } from "../../features/pronunciation/PronunciationView";
import { ensureAuthed } from "../../lib/auth";

const ERR = "color:var(--se-bad, #b42318);padding:2rem;font-family:monospace";

async function main() {
  if (!(await ensureAuthed())) {
    document.body.innerHTML = `<p style="${ERR}">Access denied.</p>`;
    throw new Error("auth");
  }
  const deckId = new URLSearchParams(location.search).get("deck");
  if (!deckId) {
    document.body.innerHTML = `<p style="${ERR}">Missing ?deck=</p>`;
    throw new Error("no deck");
  }
  const mount = document.getElementById("root");
  if (!mount) throw new Error("Missing #root mount point");
  const built = await buildNotesMd(deckId).then(
    ({ deck, slides, notes }) => ({ deck, slides, notes }),
    (error: unknown) => ({ error: error instanceof Error ? error.message : String(error) }),
  );
  createRoot(mount).render(<PronunciationView deckId={deckId} loaded={built} />);
}

void main().catch((error: unknown) => {
  if (!(error instanceof Error && ["auth", "no deck"].includes(error.message)))
    console.error(error);
});
