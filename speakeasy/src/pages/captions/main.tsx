import { createRoot } from "react-dom/client";
import { getDeck } from "../../data/decks";
import { listByDeck } from "../../data/slides";
import { CaptionConsole } from "../../features/captions/CaptionConsole";
import { errorMessage } from "../../lib/errors";
import { mountPoint, requireOwner, runPage, stop } from "../../lib/page";
import { syncRoomFor } from "../../lib/sync-room";

async function main() {
  const mount = mountPoint("app");
  const options = { into: mount, inMain: true, style: "color:var(--se-bad);font-family:monospace" };
  await requireOwner("Access denied — the caption console is owner-only.", options);
  const params = new URLSearchParams(location.search);
  const deckId = params.get("deck");
  if (!deckId) stop("Missing ?deck=<deck_id>", options);
  let data: Awaited<ReturnType<typeof getDeck>>;
  let slides: Awaited<ReturnType<typeof listByDeck>>;
  try {
    [data, slides] = await Promise.all([getDeck(deckId), listByDeck(deckId)]);
  } catch (error) {
    stop(`Cannot load deck: ${errorMessage(error)}`, options);
  }
  const room = params.get("sync") || syncRoomFor(deckId);
  createRoot(mount).render(<CaptionConsole deck={data} slides={slides} room={room} />);
}

runPage(main);
