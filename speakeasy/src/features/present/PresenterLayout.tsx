// The presenter page: the slide letterboxed into the left stage, the side panel
// on the right (under the slide on a narrow screen).
import { useCallback, useEffect, useRef, useState } from "react";
import { StepNav, useLetterbox } from "../view/Letterbox";
import { HIDDEN_KEY, PresenterPanel, store, WIDTH_KEY } from "./PresenterPanel";

export function PresenterLayout({ src, deckId }: { src: string; deckId: string | undefined }) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [hidden, setHidden] = useState(() => store.get(HIDDEN_KEY) === "1");
  const [width, setWidth] = useState<number | null>(() => {
    const w = Number(store.get(WIDTH_KEY));
    return w > 15 && w < 80 ? w : null;
  });
  // refit when the panel opens / closes or its width changes
  useLetterbox(frameRef, stageRef, `${hidden}|${width}`);
  useEffect(() => store.set(HIDDEN_KEY, hidden ? "1" : "0"), [hidden]);
  const hide = useCallback(() => setHidden(true), []);
  return (
    <>
      <div
        id="__se_presenter"
        className={hidden ? "panel-hidden" : undefined}
        style={
          width === null ? undefined : ({ "--se-panel-w": `${width}%` } as React.CSSProperties)
        }
      >
        <div id="__se_stage" ref={stageRef}>
          <iframe id="__se_letterbox" ref={frameRef} title="Slides" src={src} />
          <button type="button" className="pp-show" onClick={() => setHidden(false)}>
            ⟨ Script
          </button>
        </div>
        {deckId ? (
          <PresenterPanel deckId={deckId} frameRef={frameRef} onHide={hide} onWidth={setWidth} />
        ) : (
          // no deck id: the frame shows the error, and the panel stays empty
          <aside id="__se_panel" />
        )}
      </div>
      <StepNav frameRef={frameRef} />
    </>
  );
}
