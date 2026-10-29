import { useMemo } from "react";
import type { TrainingSection } from "../training/useTraining";
import type { useEditorModel } from "./model";

type Model = ReturnType<typeof useEditorModel>;

/**
 * The section the Training panel works on: the selected slide's title and its notes as last
 * loaded. It changes with the slide and when notes are reloaded (a history restore) — not while
 * typing.
 */
export function useTrainingSection(model: Model): TrainingSection {
  const { currentSectionId, notesRevision } = model;
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-derive on slide or notes reload only
  return useMemo(() => {
    const sid = model.currentRef.current;
    return {
      sectionId: sid,
      title: model.slidesRef.current.find((s) => s.section_id === sid)?.title ?? "",
      text: sid ? (model.notesRef.current.get(sid) ?? "") : "",
    };
  }, [currentSectionId, notesRevision]);
}
