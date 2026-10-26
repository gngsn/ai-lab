// Makes the view, share and present pages look identical on any screen. The
// page hosts its own URL in an iframe rendered at the fixed slide size and
// scales that iframe to fit its area (the window, or the presenter stage),
// letterboxed — so fonts, images and spacing scale together instead of
// reflowing. Inside the iframe the same URL runs the deck (see bootDeck /
// bootPresent). Keys that land on the bars are forwarded to the slides.
import { type RefObject, useEffect, useRef } from "react";

// Same design size as SLIDE_W/SLIDE_H in lib/slide-fit.
const SLIDE_W = 1280;
const SLIDE_H = 720;

/** Step like the arrow keys: the deck (its own controller or Speakeasy's runtime) already handles them. */
function press(frame: HTMLIFrameElement, key: string) {
  frame.contentDocument?.dispatchEvent(
    new KeyboardEvent("keydown", { key, code: key, bubbles: true, cancelable: true }),
  );
  frame.contentWindow?.focus();
}

/** Scales the frame into `area` (the window when there is none). `refit` re-runs the fit
 *  when the area changes size by other means than a window resize. */
function useFit(
  frameRef: RefObject<HTMLIFrameElement | null>,
  areaRef: RefObject<HTMLElement | null> | undefined,
  refit: unknown,
) {
  // biome-ignore lint/correctness/useExhaustiveDependencies: `refit` only re-runs the fit
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const area = areaRef?.current ?? null;
    const fit = () => {
      const w = area ? area.clientWidth : document.documentElement.clientWidth;
      const h = area ? area.clientHeight : document.documentElement.clientHeight;
      const scale = Math.min(w / SLIDE_W, h / SLIDE_H);
      const x = (w - SLIDE_W * scale) / 2;
      const y = (h - SLIDE_H * scale) / 2;
      frame.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
    };
    fit();
    window.addEventListener("resize", fit);
    const observer = area ? new ResizeObserver(fit) : null;
    if (area) observer?.observe(area);
    return () => {
      window.removeEventListener("resize", fit);
      observer?.disconnect();
    };
  }, [frameRef, areaRef, refit]);
}

/** Scales the frame into `area` and wires focus, keys and the tab title. */
export function useLetterbox(
  frameRef: RefObject<HTMLIFrameElement | null>,
  areaRef?: RefObject<HTMLElement | null>,
  refit?: unknown,
) {
  useFit(frameRef, areaRef, refit);
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    let titleTimer = 0;
    const onLoad = () => {
      frame.contentWindow?.focus();
      // Mirror the deck's title (set by the bootstrap) onto the tab.
      const sync = () => {
        const t = frame.contentDocument?.title;
        if (t && t !== document.title) document.title = t;
      };
      sync();
      window.clearInterval(titleTimer);
      titleTimer = window.setInterval(sync, 1000);
    };
    frame.addEventListener("load", onLoad);

    // Clicks on the letterbox bars would steal focus from the slides; hand it
    // back, and forward any keys that still land here so navigation works.
    const onPointerDown = () => frame.contentWindow?.focus();
    const onKeyDown = (e: KeyboardEvent) => {
      const doc = frame.contentDocument;
      if (!doc || e.metaKey || e.ctrlKey || e.altKey) return; // browser shortcuts
      e.preventDefault();
      doc.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: e.key,
          code: e.code,
          shiftKey: e.shiftKey,
          altKey: e.altKey,
          ctrlKey: e.ctrlKey,
          metaKey: e.metaKey,
          bubbles: true,
          cancelable: true,
        }),
      );
      frame.contentWindow?.focus();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      frame.removeEventListener("load", onLoad);
      window.clearInterval(titleTimer);
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [frameRef]);
}

/** The < > buttons for touch screens (no arrow keys there). */
export function StepNav({ frameRef }: { frameRef: RefObject<HTMLIFrameElement | null> }) {
  const ko = /^ko(-|$)/i.test(navigator.languages?.[0] || navigator.language || "");
  const step = (key: string) => () => {
    if (frameRef.current) press(frameRef.current, key);
  };
  return (
    <div id="__se_stepnav">
      <button type="button" aria-label={ko ? "이전" : "Previous"} onClick={step("ArrowLeft")}>
        &lt;
      </button>
      <button type="button" aria-label={ko ? "다음" : "Next"} onClick={step("ArrowRight")}>
        &gt;
      </button>
    </div>
  );
}

export function Letterbox({ src }: { src: string }) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  useLetterbox(frameRef);
  return (
    <>
      <iframe id="__se_letterbox" ref={frameRef} title="Slides" src={src} />
      <StepNav frameRef={frameRef} />
    </>
  );
}
