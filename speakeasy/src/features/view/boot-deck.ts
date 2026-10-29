// Runs inside the letterbox iframe (and in ?print=1 mode, which needs the plain
// document): loads the deck, checks the share token, and replaces this document
// with the deck's own. The old page's `document.write` is kept on purpose — the
// deck's scripts then run in a document whose URL, window and config globals
// are the page's own (see the relative-URL tests).
import { getDeck } from "../../data/decks";
import { listByDeck } from "../../data/slides";
import type { DeckRow } from "../../data/types";
import { showFailure, showLoading } from "../../lib/boot-screen";
import { errorMessage } from "../../lib/errors";
import {
  applyAssetMap,
  collectAssetUrls,
  formatBytes,
  preloadAssets,
} from "../../lib/preload-assets";
import { buildDeckDocument, visibleSlides } from "./document";

/** share: the audience page — the same read-only view, following the presenter over ?sync=<room>. */
export async function bootDeck({ shareMode }: { shareMode: boolean }) {
  const params = new URLSearchParams(location.search);
  const deckId = params.get("deck");
  const token = params.get("token");
  const followSync = shareMode ? params.get("sync") : null;

  showLoading("loading deck…");

  if (!deckId) fatal("Missing ?deck=<deck_id>");
  if (!token) fatal("Missing ?token=<share_token>");

  let deck: DeckRow;
  try {
    deck = await getDeck(deckId);
  } catch (err) {
    fatal(`Cannot open deck: ${errorMessage(err)}`);
  }
  if (!deck.share_token) fatal("This deck is not shared. Ask the owner to enable sharing.");
  if (deck.share_token !== token) fatal("Invalid or revoked share link.");
  if (shareMode && !followSync) {
    fatal(
      "Missing ?sync=<room>. Open the audience link from present mode " + '("copy audience link").',
    );
  }

  let all: Awaited<ReturnType<typeof listByDeck>>;
  try {
    all = await listByDeck(deckId);
  } catch (err) {
    fatal(`Cannot load slides: ${errorMessage(err)}`);
  }

  // The deck's own HTML, CSS and scripts as written (a deck with its own
  // controller looks exactly like its plain HTML), minus slides hidden in the
  // editor. Deck content comes from the deck owner, as in present.
  const slides = visibleSlides(all);
  if (slides.length === 0) fatal(`Deck '${deckId}' has no slides.`);

  let html = buildDeckDocument({
    deck,
    slides,
    shareMode,
    followSync,
    noFallback: params.get("nofallback") === "1",
    base: location.href,
  });

  // Download every image/video/audio the deck uses before showing it, and point
  // the deck at the local copies — no network needed between slides. Not on the
  // audience page: it's mostly opened on phones, where holding every file in
  // memory up front risks the tab being killed; media loads normally there.
  if (!shareMode) {
    const assetUrls = collectAssetUrls(html);
    if (assetUrls.length) {
      const label = document.querySelector("body > p");
      const map = await preloadAssets(assetUrls, {
        onProgress: ({ done, total, bytes }) => {
          if (label) label.textContent = `loading assets ${done}/${total} · ${formatBytes(bytes)}`;
        },
      });
      html = applyAssetMap(html, map);
    }
  }

  document.open();
  document.write(html);
  document.close();
}

function fatal(msg: string): never {
  showFailure(
    msg,
    "font:14px monospace;color:var(--se-bad, #b42318);padding:2rem;max-width:520px;margin:8vh auto;",
  );
  throw new Error(msg);
}
