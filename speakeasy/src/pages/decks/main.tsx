import { createRoot } from "react-dom/client";
import { DecksView } from "../../features/decks/DecksView";
import { mountPoint, requireOwner, runPage } from "../../lib/page";

async function main() {
  await requireOwner("Access denied — deck list is owner-only.", {
    style: "padding:2rem;color:#ef4444;font-family:monospace",
  });
  createRoot(mountPoint("app")).render(<DecksView />);
}

runPage(main);
