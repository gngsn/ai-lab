import { createRoot } from "react-dom/client";
import { NotesView } from "../../features/notes/NotesView";
import { buildNotesMd } from "../../features/notes/notes-md";
import { ensureAuthed } from "../../lib/auth";

function fail(html: string, error: string): never {
  document.body.innerHTML = `<p class="err">${html}</p>`;
  throw new Error(error);
}

async function main() {
  if (!(await ensureAuthed())) fail("Access denied — Marp view is owner-only.", "auth");
  const deckId = new URLSearchParams(location.search).get("deck");
  if (!deckId) fail("Missing ?deck=&lt;deck_id&gt;", "no deck");
  let built: Awaited<ReturnType<typeof buildNotesMd>>;
  try {
    built = await buildNotesMd(deckId);
  } catch (error) {
    document.body.innerHTML = `<p class="err">${(error as Error).message}</p>`;
    return;
  }
  const mount = document.getElementById("app");
  if (!mount) throw new Error("Missing #app mount point");
  createRoot(mount).render(<NotesView deck={built.deck} deckId={deckId} content={built.content} />);
}

void main().catch((error: unknown) => {
  if (!(error instanceof Error && ["auth", "no deck"].includes(error.message)))
    console.error(error);
});
