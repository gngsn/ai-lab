import { type RefObject, useEffect, useRef } from "react";
import {
  loadPronunciationRuntime,
  type TrainingPanel,
  type TrainingSection,
} from "../../lib/legacy-runtime";
import type { useEditorModel } from "./model";

type Model = ReturnType<typeof useEditorModel>;

/**
 * Mount the shared pronunciation training panel (public/js/training-panel.js, also used by
 * pronunciation.html) into `mountRef` and hand it the current slide's notes.
 */
export function useTrainingPanel(
  deckId: string,
  model: Model,
  mountRef: RefObject<HTMLElement | null>,
) {
  const panel = useRef<TrainingPanel | null>(null);
  const modelRef = useRef(model);
  modelRef.current = model;

  // `live` reads the textarea so recording scores against the current (possibly unsaved) notes.
  // The slide-change sync reads the notes cache instead: the textarea is still showing the
  // previous slide until React re-renders.
  const sectionOf = (live: boolean): TrainingSection => {
    const m = modelRef.current;
    const sid = m.currentRef.current;
    const textarea = live
      ? (document.getElementById("notes-textarea") as HTMLTextAreaElement | null)
      : null;
    const text = textarea ? textarea.value : sid ? (m.notesRef.current.get(sid) ?? "") : "";
    const title = m.slidesRef.current.find((s) => s.section_id === sid)?.title ?? "";
    return { sectionId: sid, title, text };
  };
  const sectionOfRef = useRef(sectionOf);
  sectionOfRef.current = sectionOf;

  useEffect(() => {
    let cancelled = false;
    let created: TrainingPanel | null = null;
    loadPronunciationRuntime()
      .then((runtime) => {
        const mount = mountRef.current;
        if (cancelled || !mount) return;
        created = runtime.createTrainingPanel(mount, {
          deckId,
          getSection: () => sectionOfRef.current(true),
          onScore: () => {},
        });
        panel.current = created;
        created.setSection(sectionOfRef.current(false));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      created?.destroy();
      panel.current = null;
    };
  }, [deckId, mountRef]);

  // The panel follows the selected slide (and notes reloaded by a history restore).
  const { currentSectionId, notesRevision } = model;
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-sync whenever the slide or notes change
  useEffect(() => {
    panel.current?.setSection(sectionOfRef.current(false));
  }, [currentSectionId, notesRevision]);
}
