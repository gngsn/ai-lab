// Runs inside edit-frame.html (the iframe).
// - Marks data-editable nodes contenteditable, debounces input, emits
//   `edit:save` to the parent window with the full serialized <section>.
// - Falls back to auto-marking common text containers as editable when the
//   slide content has no data-editable annotations yet (typical for slides
//   freshly inserted via the "+ New slide" button).
// - Ports the stable `data-edit-id` algorithm from v4's InlineEditor so that
//   adding/removing editables in adjacent slides doesn't reshuffle ids.

const SAVE_DEBOUNCE_MS = 800;

const slug = (s) =>
  (s || "slide")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "slide";

export class InlineEditor {
  constructor({ deckId, sectionId } = {}) {
    this.deckId = deckId;
    this.sectionId = sectionId;
    this.section =
      document.querySelector(`section[data-section-id="${sectionId}"]`) ||
      document.querySelector("section.slide");
    if (!this.section) {
      console.warn("[inline-editor] no section found in iframe");
      return;
    }

    this.editables = Array.from(
      this.section.querySelectorAll('[data-editable="true"]'),
    );

    // No marked editables yet → auto-mark leaf text containers so the slide
    // is editable from the get-go (matches "+ New slide" template behavior).
    if (this.editables.length === 0) {
      const candidates = Array.from(
        this.section.querySelectorAll(
          "h1, h2, h3, h4, h5, p, li, blockquote, span, div",
        ),
      ).filter((el) => {
        const t = el.textContent.trim();
        if (!t) return false;
        // leaf-ish: no nested block element
        return !el.querySelector("h1, h2, h3, h4, h5, p, li, blockquote");
      });
      this.editables = candidates;
      this.editables.forEach((el) =>
        el.setAttribute("data-editable", "true"),
      );
    }

    this.ensureEditIds();
    this.savePending = null;
    this.lastSavedHtml = this.serializeSection();

    this.editables.forEach((el) => {
      el.setAttribute("contenteditable", "true");
      el.addEventListener("input", () => this.scheduleSave());
      // Paste as plain text — avoids HTML/style soup from the clipboard.
      el.addEventListener("paste", (e) => {
        e.preventDefault();
        const text = e.clipboardData?.getData("text/plain") || "";
        document.execCommand("insertText", false, text);
      });
    });

    // Cross-frame IPC from the parent (edit.html):
    //   edit:insert-image — insert <img src=...> at current caret
    //   edit:flush        — commit any pending debounced save immediately
    //                       (used when parent toggles HTML mode)
    window.addEventListener("message", (e) => {
      if (e.data?.type === "edit:insert-image" && this.section) {
        this.insertImage(e.data.url, e.data.alt || "");
      } else if (e.data?.type === "edit:flush") {
        this.commitSave();
      }
    });

    this.postReady();

    // Flush save before unload (covers iframe re-mount / nav).
    window.addEventListener("beforeunload", () => this.commitSave(/* sync */));
  }

  insertImage(url, alt = "") {
    if (!url) return;
    const img = document.createElement("img");
    img.src = url;
    if (alt) img.alt = alt;
    img.style.maxWidth = "100%";

    // Try to place at the current selection if it's inside our section.
    const sel = document.getSelection();
    let placed = false;
    if (sel?.rangeCount) {
      const range = sel.getRangeAt(0);
      if (this.section.contains(range.commonAncestorContainer)) {
        range.deleteContents();
        range.insertNode(img);
        // Move caret after the inserted image
        range.setStartAfter(img);
        range.setEndAfter(img);
        sel.removeAllRanges();
        sel.addRange(range);
        placed = true;
      }
    }
    if (!placed) {
      // Fall back: append into the largest editable container, then section root.
      const target =
        this.editables.find((el) => /^(DIV|P|UL|OL)$/.test(el.tagName)) ||
        this.section.querySelector("div") ||
        this.section;
      target.appendChild(img);
    }
    this.scheduleSave();
  }

  ensureEditIds() {
    const seen = new Set();
    const counters = new Map();
    // pre-seed with any existing ids in the section
    document
      .querySelectorAll("[data-edit-id]")
      .forEach((el) => seen.add(el.getAttribute("data-edit-id")));

    this.editables.forEach((el) => {
      const id = el.getAttribute("data-edit-id");
      if (id && document.querySelectorAll(`[data-edit-id="${id}"]`).length === 1) {
        return; // unique already
      }
      if (id) el.removeAttribute("data-edit-id");

      const base = slug(
        el.closest("section.slide")?.dataset?.title || this.sectionId,
      );
      let n = (counters.get(base) || 0) + 1;
      let candidate = `${base}-${String(n).padStart(2, "0")}`;
      while (seen.has(candidate)) {
        n++;
        candidate = `${base}-${String(n).padStart(2, "0")}`;
      }
      counters.set(base, n);
      el.setAttribute("data-edit-id", candidate);
      seen.add(candidate);
    });
  }

  serializeSection() {
    const clone = this.section.cloneNode(true);
    clone.removeAttribute("data-section-id");
    clone
      .querySelectorAll('[contenteditable="true"]')
      .forEach((el) => el.removeAttribute("contenteditable"));
    return clone.outerHTML;
  }

  scheduleSave() {
    parent.postMessage(
      { type: "edit:dirty", section_id: this.sectionId },
      "*",
    );
    clearTimeout(this.savePending);
    this.savePending = setTimeout(() => this.commitSave(), SAVE_DEBOUNCE_MS);
  }

  commitSave() {
    clearTimeout(this.savePending);
    this.savePending = null;
    const content = this.serializeSection();
    if (content === this.lastSavedHtml) {
      parent.postMessage(
        { type: "edit:noop", section_id: this.sectionId },
        "*",
      );
      return;
    }
    this.lastSavedHtml = content;
    parent.postMessage(
      {
        type: "edit:save",
        deck_id: this.deckId,
        section_id: this.sectionId,
        content,
      },
      "*",
    );
  }

  postReady() {
    parent.postMessage(
      {
        type: "edit:ready",
        section_id: this.sectionId,
        editable_count: this.editables.length,
      },
      "*",
    );
  }
}
