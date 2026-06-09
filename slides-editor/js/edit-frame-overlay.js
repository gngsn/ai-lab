import { InlineEditor } from "./inline-editor.js";

export function mountEditFrame({ deckId, sectionId }) {
  document.body.classList.add("edit-active");

  let home = document.getElementById("__se_home_link");
  if (!home) {
    home = document.createElement("a");
    home.id = "__se_home_link";
    home.href = "./index.html";
    home.title = "Home";
    home.textContent = "⌂ Home";
    home.style.cssText =
      "position:fixed;top:10px;left:10px;z-index:9999;display:inline-flex;align-items:center;gap:4px;padding:5px 10px;border:1px solid rgba(255,255,255,.14);border-radius:6px;background:rgba(20,20,20,.76);color:#f0f0f0;font:12px ui-monospace,monospace;text-decoration:none;pointer-events:auto;backdrop-filter:blur(8px);";
    document.body.appendChild(home);
  }

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
