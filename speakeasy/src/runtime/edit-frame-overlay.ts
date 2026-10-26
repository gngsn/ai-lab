// Runs inside the edit frame in edit mode (loaded by the small module script
// the frame adds to the slide). Bundled to /js/edit-frame-overlay.js. Puts the
// slide into editing state, answers the editor's preview-step messages and
// starts the inline editor.
import { InlineEditor } from "./inline-editor";

/** The stepper convention of the built-in runtime: the card around an item gets the active class. */
const stepperTarget = (item: Element) => item.closest(".card") || item;

export function mountEditFrame({ deckId, sectionId }: { deckId: string; sectionId: string }) {
  document.body.classList.add("edit-active");
  const slides = [...document.querySelectorAll<HTMLElement>(".slide")];
  const currentSlide = () => slides[0] || null;

  // Start from presentation state instead of force-revealing every element.
  // Delaying `.visible` by one frame lets CSS reveal transitions play in the
  // canvas when a slide is first loaded.
  for (const slide of slides) slide.classList.remove("visible");
  for (const fragment of document.querySelectorAll(".fragment")) fragment.classList.remove("show");
  requestAnimationFrame(() => {
    for (const slide of slides) slide.classList.add("visible");
  });

  /** The items of the slide's data-stepper, or null when it has none (or an invalid selector). */
  function stepperOf(slide: HTMLElement) {
    const selector = slide.dataset.stepper?.trim();
    if (!selector) return null;
    let items: Element[];
    try {
      items = [...slide.querySelectorAll(selector)];
    } catch {
      return null;
    }
    const activeClass = slide.dataset.stepperActiveClass || "mint";
    const activeIndex = items.findIndex((item) =>
      stepperTarget(item).classList.contains(activeClass),
    );
    return { items, activeClass, activeIndex };
  }

  function nextPreviewStep({ dispatchClick = true } = {}) {
    const slide = currentSlide();
    if (!slide) return;

    const beforeFragments = [...slide.querySelectorAll(".fragment")].map((fragment) =>
      fragment.classList.contains("show"),
    );

    if (dispatchClick) {
      slide.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true, view: window }),
      );
    }

    const deckHandledClick = beforeFragments.some(
      (shown, index) =>
        shown !== slide.querySelectorAll(".fragment")[index]?.classList.contains("show"),
    );
    if (deckHandledClick) return;

    // Fallback for decks using Speakeasy's standard fragment convention.
    const pending = slide.querySelector<HTMLElement>(".fragment:not(.show)");
    if (pending) {
      const group = pending.dataset.fragmentGroup;
      if (group) {
        for (const fragment of slide.querySelectorAll<HTMLElement>(".fragment:not(.show)")) {
          if (fragment.dataset.fragmentGroup === group) fragment.classList.add("show");
        }
      } else {
        pending.classList.add("show");
      }
      return;
    }

    // Match the built-in runtime's data-stepper convention for decks that
    // advance highlighted cards instead of using `.fragment` elements.
    const stepper = stepperOf(slide);
    if (!stepper) return;
    const next = stepper.items[stepper.activeIndex + 1];
    if (!next) return;
    if (stepper.activeIndex >= 0) {
      stepperTarget(stepper.items[stepper.activeIndex]).classList.remove(stepper.activeClass);
    }
    stepperTarget(next).classList.add(stepper.activeClass);
  }

  // Reverse of nextPreviewStep: hide the last shown fragment (its whole
  // group), else move the data-stepper highlight back one card.
  function prevPreviewStep() {
    const slide = currentSlide();
    if (!slide) return;
    const shown = [...slide.querySelectorAll<HTMLElement>(".fragment.show")];
    const last = shown[shown.length - 1];
    if (last) {
      const group = last.dataset.fragmentGroup;
      if (group) {
        for (const fragment of shown) {
          if (fragment.dataset.fragmentGroup === group) fragment.classList.remove("show");
        }
      } else {
        last.classList.remove("show");
      }
      return;
    }
    const stepper = stepperOf(slide);
    if (!stepper || stepper.activeIndex < 0) return;
    stepperTarget(stepper.items[stepper.activeIndex]).classList.remove(stepper.activeClass);
    if (stepper.activeIndex > 0) {
      stepperTarget(stepper.items[stepper.activeIndex - 1]).classList.add(stepper.activeClass);
    }
  }

  window.addEventListener("message", (event) => {
    if (event.data?.type === "edit:preview-fallback") {
      nextPreviewStep({ dispatchClick: false });
    } else if (event.data?.type === "edit:preview-back") {
      prevPreviewStep();
    }
  });

  // Key-input shield: belt-and-suspenders in case any deck listener slipped
  // through. Stop key events that originate in an editable surface before
  // they bubble to deck-level handlers.
  for (const evt of ["keydown", "keypress", "keyup"]) {
    document.addEventListener(
      evt,
      (e) => {
        const t = e.target as HTMLElement | null;
        if (t && (t.isContentEditable || t.tagName === "INPUT" || t.tagName === "TEXTAREA")) {
          e.stopImmediatePropagation();
        }
      },
      { capture: true },
    );
  }

  new InlineEditor({ deckId, sectionId });
}
