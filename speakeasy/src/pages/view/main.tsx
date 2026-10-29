import { createRoot } from "react-dom/client";
import { bootDeck } from "../../features/view/boot-deck";
import { Letterbox } from "../../features/view/Letterbox";
import { routeNameFor } from "../../lib/route-name";

const params = new URLSearchParams(location.search);
// As a top-level page this hosts the same URL in an iframe (the letterbox).
// Inside that iframe — or in ?print=1 mode, which needs the plain document — it
// loads the deck.
const hosting = window.self === window.top && params.get("print") !== "1";

if (hosting) {
  const mount = document.getElementById("app");
  if (!mount) throw new Error("Missing #app mount point");
  createRoot(mount).render(<Letterbox src={location.href} />);
} else {
  void bootDeck({ shareMode: routeNameFor(location.pathname) === "share" });
}
