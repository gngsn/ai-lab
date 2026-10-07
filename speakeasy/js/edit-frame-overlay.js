import { InlineEditor } from "./inline-editor.js";

export function mountEditFrame({ deckId, sectionId }) {
  document.body.classList.add("edit-active");
  // The deck's own bootstrap scripts were stripped (they intercept keys);
  // but many deck designs use a "first slide gets .visible, animations
  // fire on .visible / .show" pattern. Without those classes, reveal-style
  // animations stay at opacity:0 and the text is invisible. Force-promote
  // them so editors see the final, fully-revealed state.
  document
    .querySelectorAll(".slide")
    .forEach((s) => s.classList.add("visible"));
  document
    .querySelectorAll(".fragment")
    .forEach((f) => f.classList.add("show"));

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
