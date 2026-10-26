import { createRoot } from "react-dom/client";
import { bootPresent } from "../../features/present/boot-present";
import { PresenterLayout } from "../../features/present/PresenterLayout";

const params = new URLSearchParams(location.search);
// As a top-level page this hosts the same URL in an iframe (the letterbox) next
// to the presenter panel. Inside that iframe — or in ?print=1 mode, which needs
// the plain document — it loads the deck.
const hosting = window.self === window.top && params.get("print") !== "1";
const deckId = params.get("deck") || location.pathname.match(/\/present\/([^/?]+)/)?.[1];

if (hosting) {
  const mount = document.getElementById("app");
  if (!mount) throw new Error("Missing #app mount point");
  createRoot(mount).render(<PresenterLayout src={location.href} deckId={deckId} />);
} else {
  void bootPresent();
}
