import { type RefObject, useRef, useState } from "react";
import { getDeck } from "../../data/decks";
import { getOne as getNote } from "../../data/notes";
import { getOne as getSlide } from "../../data/slides";
import type { DeckRow } from "../../data/types";
import { type Restored, useHistory } from "../history/useHistory";
import type { EditChrome } from "./EditShell";
import type { EditorModel } from "./model";

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * The editor's history drawer: the open state, and what a restore changes in
 * the editor's caches (the timeline itself is features/history).
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
  const [open, setOpenState] = useState(false);
  const openRef = useRef(false);
  const latest = useRef({ model, chrome });
  latest.current = { model, chrome };

  const onRestored = async ({ section_id, source }: Restored) => {
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
      // The history drawer already wrote to the DB; the caches may be stale.
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
  };

  const history = useHistory({
    deckId,
    getSectionId: () => latest.current.model.currentRef.current,
    onRestored,
  });

  const setOpen = (next: boolean) => {
    openRef.current = next;
    setOpenState(next);
  };
  const toggle = () => {
    const next = !openRef.current;
    setOpen(next);
    if (next) void history.refresh();
  };

  return {
    open,
    history,
    toggle,
    close: () => setOpen(false),
    refresh: () => void history.refresh(),
    isOpen: () => openRef.current,
  };
}
