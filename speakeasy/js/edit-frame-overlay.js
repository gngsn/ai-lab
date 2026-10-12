import { InlineEditor } from "./inline-editor.js";

export function mountEditFrame({ deckId, sectionId }) {
  document.body.classList.add("edit-active");
  const slides = [...document.querySelectorAll(".slide")];
  const currentSlide = () => slides[0] || null;

  // Start from presentation state instead of force-revealing every element.
  // Delaying `.visible` by one frame lets CSS reveal transitions play in the
  // canvas when a slide is first loaded.
  slides.forEach((slide) => slide.classList.remove("visible"));
  document.querySelectorAll(".fragment").forEach((fragment) => {
    fragment.classList.remove("show");
  });
  requestAnimationFrame(() => {
    slides.forEach((slide) => slide.classList.add("visible"));
  });

  function nextPreviewStep({ dispatchClick = true } = {}) {
    const slide = currentSlide();
    if (!slide) return;

    const beforeFragments = [...slide.querySelectorAll(".fragment")].map(
      (fragment) => fragment.classList.contains("show"),
    );

    if (dispatchClick) {
      slide.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true, view: window }),
      );
    }

    const deckHandledClick = beforeFragments.some(
      (shown, index) =>
        shown !==
        slide.querySelectorAll(".fragment")[index]?.classList.contains("show"),
    );
    if (deckHandledClick) return;

    // Fallback for decks using Speakeasy's standard fragment convention.
    const pending = slide.querySelector(".fragment:not(.show)");
    if (pending) {
      const group = pending.dataset.fragmentGroup;
      if (group) {
        slide
          .querySelectorAll(".fragment:not(.show)")
          .forEach((fragment) => {
            if (fragment.dataset.fragmentGroup === group) {
              fragment.classList.add("show");
            }
          });
      } else {
        pending.classList.add("show");
      }
      return;
    }

    // Match the built-in runtime's data-stepper convention for decks that
    // advance highlighted cards instead of using `.fragment` elements.
    const selector = slide.dataset.stepper?.trim();
    if (!selector) return;
    let items;
    try {
      items = [...slide.querySelectorAll(selector)];
    } catch {
      return;
    }
    const activeClass = slide.dataset.stepperActiveClass || "mint";
    const target = (item) => item.closest(".card") || item;
    const activeIndex = items.findIndex((item) =>
      target(item).classList.contains(activeClass),
    );
    const next = items[activeIndex + 1];
    if (!next) return;
    if (activeIndex >= 0) target(items[activeIndex]).classList.remove(activeClass);
    target(next).classList.add(activeClass);
  }

  // Reverse of nextPreviewStep: hide the last shown fragment (its whole
  // group), else move the data-stepper highlight back one card.
  function prevPreviewStep() {
    const slide = currentSlide();
    if (!slide) return;
    const shown = [...slide.querySelectorAll(".fragment.show")];
    const last = shown[shown.length - 1];
    if (last) {
      const group = last.dataset.fragmentGroup;
      if (group) {
        shown.forEach((fragment) => {
          if (fragment.dataset.fragmentGroup === group) {
            fragment.classList.remove("show");
          }
        });
      } else {
        last.classList.remove("show");
      }
      return;
    }
    const selector = slide.dataset.stepper?.trim();
    if (!selector) return;
    let items;
    try {
      items = [...slide.querySelectorAll(selector)];
    } catch {
      return;
    }
    const activeClass = slide.dataset.stepperActiveClass || "mint";
    const target = (item) => item.closest(".card") || item;
    const activeIndex = items.findIndex((item) =>
      target(item).classList.contains(activeClass),
    );
    if (activeIndex < 0) return;
    target(items[activeIndex]).classList.remove(activeClass);
    if (activeIndex > 0) target(items[activeIndex - 1]).classList.add(activeClass);
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
  ["keydown", "keypress", "keyup"].forEach((evt) => {
    document.addEventListener(
      evt,
      (e) => {
        const t = e.target;
        if (
          t &&
          (t.isContentEditable ||
            t.tagName === "INPUT" ||
            t.tagName === "TEXTAREA")
        ) {
          e.stopImmediatePropagation();
        }
      },
      { capture: true },
    );
  });

  new InlineEditor({
    deckId,
    sectionId,
  });
}
