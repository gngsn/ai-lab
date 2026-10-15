import { createRoot } from "react-dom/client";
import { getDeck } from "../../data/decks";
import { listByDeck } from "../../data/slides";
import { CaptionConsole } from "../../features/captions/CaptionConsole";
import { ensureAuthed } from "../../lib/auth";
import { syncRoomFor } from "../../lib/sync-room";

function fail(message: string): never {
  const app = document.getElementById("app");
  if (app)
    app.innerHTML = `<main><p style="color:var(--se-bad);font-family:monospace">${message}</p></main>`;
  throw new Error(message);
}

async function main() {
  if (!(await ensureAuthed())) fail("Access denied — the caption console is owner-only.");
  const params = new URLSearchParams(location.search);
  const deckId = params.get("deck");
  if (!deckId) fail("Missing ?deck=<deck_id>");
  let data: Awaited<ReturnType<typeof getDeck>>;
  let slides: Awaited<ReturnType<typeof listByDeck>>;
  try {
    [data, slides] = await Promise.all([getDeck(deckId), listByDeck(deckId)]);
  } catch (error) {
    fail(`Cannot load deck: ${(error as Error).message}`);
  }
  const room = params.get("sync") || syncRoomFor(deckId);
  const mount = document.getElementById("app");
  if (!mount) throw new Error("Missing #app mount point");
  createRoot(mount).render(<CaptionConsole deck={data} slides={slides} room={room} />);
}

void main().catch((error: unknown) => {
  if (!(error instanceof Error && document.querySelector("#app main"))) {
    console.error(error);
  }
});
