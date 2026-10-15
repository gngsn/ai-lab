// The slide canvas (#canvas iframe): scaling, the postMessage protocol with
// edit-frame.html (§2.4 of the plan), and the preview "step" buttons.
import { type RefObject, useEffect, useRef } from "react";
import { updateContent } from "../../data/slides";
import type { DeckRow } from "../../data/types";
import { fitSlideFrame, type SlideFit } from "../../lib/legacy-runtime";
import type { EditorModel } from "./model";

type Chrome = {
  setStatus: (text: string, kind?: string) => void;
  toast: (message: string, kind?: string) => void;
};

const autoSave = () => localStorage.getItem("slidesEditor.autoSave") !== "false";

export function useCanvas({
  canvasRef,
  stageRef,
  deckRef,
  model,
  chrome,
}: {
  canvasRef: RefObject<HTMLIFrameElement | null>;
  stageRef: RefObject<HTMLDivElement | null>;
  deckRef: RefObject<DeckRow>;
  model: EditorModel;
  chrome: Chrome;
}) {
  const fit = useRef<SlideFit | null>(null);
  const fitEnabled = useRef(true);
  const latest = useRef({ model, chrome });
  latest.current = { model, chrome };

  // Slides render at a fixed 1280×720 and scale as a whole, except in
  // "stretch", which deliberately fills the canvas.
  useEffect(() => {
    let cancelled = false;
    let created: SlideFit | null = null;
    const frame = canvasRef.current;
    const stage = stageRef.current;
    if (!frame || !stage) return;
    void fitSlideFrame(frame, stage).then((f) => {
      if (cancelled) {
        f.disconnect();
        return;
      }
      created = f;
      fit.current = f;
      f.setEnabled(fitEnabled.current);
    });
    return () => {
      cancelled = true;
      created?.disconnect();
      fit.current = null;
    };
  }, [canvasRef, stageRef]);

  // IPC with the iframe.
  useEffect(() => {
    const onMessage = async (e: MessageEvent) => {
      const m = e.data;
      if (!m || typeof m.type !== "string") return;
      if (!m.type.startsWith("edit:") && !m.type.startsWith("edit-frame:")) return;
      const { model: mdl, chrome: c } = latest.current;
      switch (m.type) {
        case "edit:dirty":
          c.setStatus("saving…");
          break;
        case "edit:save":
          try {
            await updateContent(m.deck_id, m.section_id, m.content);
            // Update the local cache in place so later renders show the new content.
            const slide = mdl.slidesRef.current.find((s) => s.section_id === m.section_id);
            if (slide) slide.content = m.content;
            c.setStatus(`saved · ${new Date().toLocaleTimeString()}`, "ok");
          } catch (err) {
            c.setStatus("save failed", "err");
            c.toast(`Save failed: ${(err as Error).message}`, "err");
          }
          break;
        case "edit:noop":
          c.setStatus("no changes");
          break;
        case "edit:ready":
          c.setStatus(`ready · ${m.editable_count} editable${m.editable_count === 1 ? "" : "s"}`);
          // Hand the current auto-save state to the fresh inline editor so it
          // doesn't run its 800ms debounce when the user has turned it off.
          (e.source as Window | null)?.postMessage(
            { type: "edit:set-autosave", value: autoSave() },
            "*",
          );
          break;
        case "edit-frame:error":
          c.setStatus("frame error", "err");
          c.toast(`Frame: ${m.message}`, "err");
          break;
        case "edit-frame:request-data": {
          // Serve the cached deck + slide so the iframe doesn't refetch on every
          // navigation; if the cache has no such slide, stay silent (the iframe
          // times out and falls back to a direct fetch).
          const slide = mdl.slidesRef.current.find((s) => s.section_id === m.sectionId);
          if (!slide) break;
          (e.source as Window | null)?.postMessage(
            { type: "edit-frame:data", id: m.id, deck: deckRef.current, slide },
            "*",
          );
          break;
        }
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [deckRef]);

  // Trigger the iframe's DOM directly rather than relying on a message listener
  // inside the slide. This lets normal deck click handlers and global functions
  // run exactly as they do on the presentation page.
  const previewNext = () => {
    const frame = canvasRef.current;
    const win = frame?.contentWindow as (Window & Record<string, unknown>) | null | undefined;
    const doc = frame?.contentDocument;
    const slide = doc?.querySelector<HTMLElement>(".slide");
    if (!win || !doc || !slide) {
      latest.current.chrome.toast("Slide preview is still loading", "warn");
      return;
    }
    const beforeFragments = [...slide.querySelectorAll(".fragment")].map((f) =>
      f.classList.contains("show"),
    );
    const detail = { slide, sectionId: latest.current.model.currentRef.current };
    const clickOptions = { bubbles: true, cancelable: true, view: win };
    // Use the iframe's constructors so event listeners receive an event from
    // their own window realm.
    const Mouse = win.MouseEvent as typeof MouseEvent;
    slide.dispatchEvent(new Mouse("mousedown", clickOptions));
    slide.dispatchEvent(new Mouse("mouseup", clickOptions));
    slide.dispatchEvent(new Mouse("click", clickOptions));

    const functionName = slide.dataset.previewClick?.trim();
    const handler = functionName ? win[functionName] : undefined;
    if (functionName && typeof handler === "function") {
      (handler as (detail: unknown) => void).call(slide, detail);
    }
    const Custom = win.CustomEvent as typeof CustomEvent;
    slide.dispatchEvent(new Custom("speakeasy:preview-click", { bubbles: true, detail }));

    // Only ask the overlay for a generic fragment/step fallback when deck code
    // did not already change the slide's fragment state.
    const deckHandledClick = beforeFragments.some(
      (shown, index) =>
        shown !== slide.querySelectorAll(".fragment")[index]?.classList.contains("show"),
    );
    if (!deckHandledClick) win.postMessage({ type: "edit:preview-fallback" }, "*");
  };

  // Step back: undo the last revealed fragment (or stepper card) on the
  // canvas slide. Effects a deck runs itself on click can't be undone.
  const previewBack = () => {
    canvasRef.current?.contentWindow?.postMessage({ type: "edit:preview-back" }, "*");
  };

  return {
    previewNext,
    previewBack,
    setFitEnabled: (enabled: boolean) => {
      fitEnabled.current = enabled;
      fit.current?.setEnabled(enabled);
    },
  };
}
