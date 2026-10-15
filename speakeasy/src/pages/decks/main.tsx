import { useEffect } from "react";
import { createRoot } from "react-dom/client";
import { mountDeckList } from "../../features/decks/controller";
import { DecksView } from "../../features/decks/DecksView";
import { ensureAuthed } from "../../lib/auth";
import { loadRemoteSource } from "../../lib/legacy-runtime";

function Page() {
  useEffect(() => {
    let dispose: (() => void) | undefined;
    let cancelled = false;
    void loadRemoteSource()
      .then(mountDeckList)
      .then((fn) => {
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
  if (!(await ensureAuthed())) {
    document.body.innerHTML =
      '<p style="padding:2rem;color:#ef4444;font-family:monospace">Access denied — deck list is owner-only.</p>';
    throw new Error("auth");
  }
  const mount = document.getElementById("app");
  if (!mount) throw new Error("Missing #app mount point");
  createRoot(mount).render(<Page />);
}

void main().catch((error: unknown) => {
  if (!(error instanceof Error && error.message === "auth")) console.error(error);
});
