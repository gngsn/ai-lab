import { createRoot } from "react-dom/client";
import { getDeck } from "../../data/decks";
import { EditShell } from "../../features/edit/EditShell";
import { ensureAuthed } from "../../lib/auth";

async function main() {
  if (!(await ensureAuthed())) {
    document.body.innerHTML =
      '<p style="padding:2rem;color:var(--se-bad, #b42318);font-family:monospace">Edit access denied.</p>';
    throw new Error("auth failed");
  }
  const deckId = new URLSearchParams(location.search).get("deck");
  if (!deckId) {
    document.body.innerHTML =
      '<p style="padding:2rem;color:var(--se-bad, #b42318)">Missing ?deck=&lt;deck_id&gt;</p>';
    throw new Error("no deck");
  }
  const mount = document.getElementById("root");
  if (!mount) throw new Error("Missing #root mount point");
  const deck = await getDeck(deckId);
  createRoot(mount).render(<EditShell deck={deck} deckId={deckId} />);
}

void main().catch((error: unknown) => {
  if (!(error instanceof Error && ["auth failed", "no deck"].includes(error.message))) {
    console.error(error);
  }
});
