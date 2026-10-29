// Renders a slide iframe at one fixed design size and scales it to fit its
// box, so text, images and spacing all shrink/grow together: a slide looks
// identical on a phone, a laptop or a projector instead of reflowing.
// 1280x720 matches the print/PDF page size; features/view/Letterbox.tsx uses the same numbers.
export const SLIDE_W = 1280;
export const SLIDE_H = 720;

export type SlideFit = { setEnabled: (enabled: boolean) => void; disconnect: () => void };

const FIT_PROPS = [
  "position",
  "left",
  "top",
  "width",
  "height",
  "maxWidth",
  "maxHeight",
  "transformOrigin",
  "transform",
] as const;

/** The inline style that fits a 1280x720 frame into a w x h box, centred. */
export function fitStyle(w: number, h: number) {
  const scale = Math.min(w / SLIDE_W, h / SLIDE_H);
  return {
    position: "absolute",
    left: `${(w - SLIDE_W * scale) / 2}px`,
    top: `${(h - SLIDE_H * scale) / 2}px`,
    width: `${SLIDE_W}px`,
    height: `${SLIDE_H}px`,
    maxWidth: "none",
    maxHeight: "none",
    transformOrigin: "0 0",
    transform: `scale(${scale})`,
  };
}

/**
 * Keep `frame` (an iframe inside `box`) at SLIDE_W x SLIDE_H, scaled and
 * centred to fit `box`. `box` should be position:relative; overflow:hidden.
 * Disabling restores the frame's stylesheet sizing (the editor's "stretch").
 */
export function fitSlideFrame(frame: HTMLElement, box: HTMLElement): SlideFit {
  let enabled = true;

  const apply = () => {
    if (!enabled) return;
    const w = box.clientWidth;
    const h = box.clientHeight;
    if (!w || !h) return;
    Object.assign(frame.style, fitStyle(w, h));
  };

  const clear = () => {
    for (const prop of FIT_PROPS) frame.style[prop] = "";
  };

  const observer = new ResizeObserver(apply);
  observer.observe(box);
  apply();

  return {
    setEnabled(next) {
      enabled = next;
      if (enabled) apply();
      else clear();
    },
    disconnect() {
      observer.disconnect();
      clear();
    },
  };
}
