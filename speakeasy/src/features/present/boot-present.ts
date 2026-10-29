// Runs inside the presenter page's iframe (and in ?print=1 mode, which needs
// the plain document): asks for the owner passphrase, loads the deck and
// replaces this document with the deck's own. `document.write` is kept on
// purpose (see features/view/boot-deck): the deck's scripts run in a document
// whose URL, window and config globals are the page's own.
import { getDeck } from "../../data/decks";
import { listByDeck } from "../../data/slides";
import type { DeckRow } from "../../data/types";
import { ensureAuthed } from "../../lib/auth";
import { showFailure, showLoading } from "../../lib/boot-screen";
import { errorMessage } from "../../lib/errors";
import { ERROR_STYLE, showError } from "../../lib/page";
import {
  applyAssetMap,
  collectAssetUrls,
  formatBytes,
  preloadAssets,
} from "../../lib/preload-assets";
import {
  audienceLink,
  buildPresentDocument,
  resolveStartIndex,
  visibleWithIndex,
} from "./document";

function fatal(msg: string): never {
  showFailure(msg, "font:14px monospace;color:var(--se-bad, #b42318);padding:2rem;");
  throw new Error(msg);
}

export async function bootPresent() {
  showLoading("loading deck…");

  if (!(await ensureAuthed())) {
    showError("Access denied — present is owner-only. Use view.html?token=… for sharing.", {
      style: ERROR_STYLE.denied,
    });
    throw new Error("auth");
  }

  const params = new URLSearchParams(location.search);
  const pathMatch = location.pathname.match(/\/present\/([^/?]+)/);
  const deckId = params.get("deck") || pathMatch?.[1];
  const isPrint = params.get("print") === "1";
  const startSectionId = params.get("section") || params.get("slide");
  const liveSyncId = params.get("sync");

  if (!deckId) fatal("Missing ?deck=<deck_id> in URL.");

  let deck: DeckRow;
  let slides: Awaited<ReturnType<typeof listByDeck>>;
  try {
    [deck, slides] = await Promise.all([getDeck(deckId), listByDeck(deckId)]);
  } catch (err) {
    fatal(`Failed to load deck '${deckId}': ${errorMessage(err)}`);
  }

  if (!deck.frame_html) fatal(`Deck '${deckId}' has no frame_html.`);

  const visible = visibleWithIndex(slides);
  if (visible.length === 0) fatal(`Deck '${deckId}' has no visible slides.`);

  let html = buildPresentDocument({
    deck,
    slides,
    isPrint,
    noFallback: params.get("nofallback") === "1",
    startIndex: resolveStartIndex(slides, visible, startSectionId),
    audienceUrl: audienceLink(location.href, deckId, deck.share_token, liveSyncId),
    base: location.href,
  });

  // Download every image/video/audio the deck uses before showing it, and
  // point the deck at the local copies — no network needed between slides.
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

  document.open();
  document.write(html);
  document.close();
}
