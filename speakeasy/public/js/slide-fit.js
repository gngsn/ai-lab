// Renders a slide iframe at one fixed design size and scales it to fit its
// box, so text, images and spacing all shrink/grow together — a slide looks
// identical on a phone, a laptop or a projector instead of reflowing.
//
// 1280×720 matches the print/PDF page size in present-bootstrap.js.
// js/letterbox.js (a classic script) inlines the same math for present/view.
export const SLIDE_W = 1280;
export const SLIDE_H = 720;

/**
 * Keep `frame` (an iframe inside `box`) at SLIDE_W×SLIDE_H, scaled and
 * centered to fit `box`. `box` should be position:relative; overflow:hidden.
 * Returns { setEnabled(bool), disconnect() } — disabling restores the
 * frame's stylesheet sizing (e.g. the editor's "stretch" mode).
 */
export function fitSlideFrame(frame, box) {
  let enabled = true;

  const apply = () => {
    if (!enabled) return;
    const w = box.clientWidth;
    const h = box.clientHeight;
    if (!w || !h) return;
    const scale = Math.min(w / SLIDE_W, h / SLIDE_H);
    Object.assign(frame.style, {
      position: "absolute",
      left: `${(w - SLIDE_W * scale) / 2}px`,
      top: `${(h - SLIDE_H * scale) / 2}px`,
      width: `${SLIDE_W}px`,
      height: `${SLIDE_H}px`,
      maxWidth: "none",
      maxHeight: "none",
      transformOrigin: "0 0",
      transform: `scale(${scale})`,
    });
  };

  const clear = () => {
    for (const prop of [
      "position", "left", "top", "width", "height",
      "maxWidth", "maxHeight", "transformOrigin", "transform",
    ]) {
      frame.style[prop] = "";
    }
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
