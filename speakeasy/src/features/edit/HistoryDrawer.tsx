import { type RefObject, useEffect, useRef, useState } from "react";
import { getDeck } from "../../data/decks";
import { getOne as getNote } from "../../data/notes";
import { getOne as getSlide } from "../../data/slides";
import type { DeckRow } from "../../data/types";
import { type HistoryUIInstance, loadHistoryUi } from "../../lib/legacy-runtime";
import type { EditChrome } from "./EditShell";
import type { EditorModel } from "./model";

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * The history drawer (public/js/history-ui.js, shared with the script editor,
 * so the timeline UI itself stays there). This hook owns the open state and
 * the cache patching after a restore.
 */
export function useHistoryDrawer({
  deckId,
  deckRef,
  model,
  chrome,
}: {
  deckId: string;
  deckRef: RefObject<DeckRow>;
  model: EditorModel;
  chrome: EditChrome;
}) {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const drawerRef = useRef<HTMLElement>(null);
  const ui = useRef<Promise<HistoryUIInstance> | null>(null);
  const latest = useRef({ model, chrome });
  latest.current = { model, chrome };

  useEffect(() => {
    const panelEl = panelRef.current;
    if (!panelEl) return;
    ui.current = loadHistoryUi().then(
      ({ HistoryUI }) =>
        new HistoryUI({
          deckId,
          panelEl,
          currentSectionGetter: () => latest.current.model.currentRef.current,
          onRestored: async ({ section_id, source }) => {
            const { model: m, chrome: c } = latest.current;
            c.toast("Restored", "ok");
            const current = m.currentRef.current;
            if (source === "frame") {
              try {
                const fresh = await getDeck(deckId);
                deckRef.current = { ...deckRef.current, frame_html: fresh.frame_html };
                if (current) m.showSlide(current);
              } catch {
                /* best-effort */
              }
              return;
            }
            if (section_id === current) {
              // history-ui already wrote to the DB; the caches may be stale.
              if (source === "notes") {
                try {
                  const note = await getNote(deckId, section_id);
                  m.notesRef.current.set(section_id, note?.content ?? "");
                } catch {
                  /* best-effort */
                }
              } else {
                try {
                  const fresh = await getSlide(deckId, section_id);
                  m.patchSlide(section_id, { content: fresh.content, title: fresh.title });
                } catch {
                  /* best-effort */
                }
              }
              m.reloadNotes();
              m.showSlide(current);
            } else {
              // Another slide: fetch just that slide and its note, patch the caches.
              try {
                const [fresh, note] = await Promise.all([
                  getSlide(deckId, section_id),
                  getNote(deckId, section_id),
                ]);
                m.patchSlide(section_id, { content: fresh.content, title: fresh.title });
                m.notesRef.current.set(section_id, note?.content ?? "");
              } catch (err) {
                c.toast(`Restore patch failed: ${messageOf(err)}`, "err");
              }
            }
          },
        }),
    );
    return () => {
      ui.current = null;
    };
  }, [deckId, deckRef]);

  // history-ui.js closes the drawer itself (its × button removes the class), so
  // the drawer's own class is the source of truth; keep the state in step with it.
  useEffect(() => {
    const drawer = drawerRef.current;
    if (!drawer) return;
    const sync = () => setOpen(drawer.classList.contains("open"));
    const observer = new MutationObserver(sync);
    observer.observe(drawer, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  const refresh = () => {
    void ui.current?.then((instance) => instance.refresh());
  };
  const toggle = () => {
    const next = !drawerRef.current?.classList.contains("open");
    setOpen(next);
    if (next) refresh();
  };

  return {
    open,
    panelRef,
    drawerRef,
    toggle,
    refresh,
    isOpen: () => Boolean(drawerRef.current?.classList.contains("open")),
  };
}

export function HistoryDrawer({ history }: { history: ReturnType<typeof useHistoryDrawer> }) {
  return (
    <aside
      className={`hist-drawer${history.open ? " open" : ""}`}
      id="hist-drawer"
      ref={history.drawerRef}
    >
      <div id="history-panel" ref={history.panelRef} />
    </aside>
  );
}
