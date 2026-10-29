import { useEffect } from "react";
import { createRoot } from "react-dom/client";
import { mountDeckList } from "../../features/decks/controller";
import { DecksView } from "../../features/decks/DecksView";
import { mountPoint, requireOwner, runPage } from "../../lib/page";
import * as remoteSource from "../../lib/remote-source";

function Page() {
  useEffect(() => {
    let dispose: (() => void) | undefined;
    let cancelled = false;
    void mountDeckList(remoteSource).then((fn) => {
      if (cancelled) fn();
      else dispose = fn;
    });
    return () => {
      cancelled = true;
      dispose?.();
    };
  }, []);
  return <DecksView />;
}

async function main() {
  await requireOwner("Access denied — deck list is owner-only.", {
    style: "padding:2rem;color:#ef4444;font-family:monospace",
  });
  createRoot(mountPoint("app")).render(<Page />);
}

runPage(main);
