// Runs inside the edit frame (the canvas iframe of the editor).
// - Marks data-editable nodes contenteditable, debounces input, emits
//   `edit:save` to the parent window with the full serialized <section>.
// - Falls back to auto-marking common text containers as editable when the
//   slide content has no data-editable annotations yet (typical for slides
//   freshly inserted via the "+ New slide" button).
// - Ports the stable `data-edit-id` algorithm from v4's InlineEditor so that
//   adding/removing editables in adjacent slides doesn't reshuffle ids.

const SAVE_DEBOUNCE_MS = 800;

const slug = (s: string | null | undefined) =>
  (s || "slide")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "slide";

type AssetMessage = { url?: string; name?: string; kind?: string; alt?: string };

export class InlineEditor {
  deckId: string;
  sectionId: string;
  section: HTMLElement | null;
  editables: HTMLElement[] = [];
  savePending: ReturnType<typeof setTimeout> | null = null;
  needsChromeCleanup = false;
  lastSavedHtml = "";
  // Auto-save: parent flips this via `edit:set-autosave` on `edit:ready`
  // and whenever the toolbar toggle changes. When OFF, scheduleSave still
  // notifies the parent that the section is dirty but never sets the
  // debounce timer — the user has to press the toolbar's Save now button.
  autoSave = true;

  constructor({ deckId, sectionId }: { deckId: string; sectionId: string }) {
    this.deckId = deckId;
    this.sectionId = sectionId;
    this.section =
      document.querySelector<HTMLElement>(`section[data-section-id="${sectionId}"]`) ||
      document.querySelector<HTMLElement>("section.slide");
    if (!this.section) {
      console.warn("[inline-editor] no section found in iframe");
      return;
    }

    this.editables = Array.from(
      this.section.querySelectorAll<HTMLElement>('[data-editable="true"]'),
    );

    // No marked editables yet → auto-mark leaf text containers so the slide is
    // editable from the get-go (matches "+ New slide" template behavior).
    if (this.editables.length === 0) {
      const candidates = Array.from(
        this.section.querySelectorAll<HTMLElement>(
          "h1, h2, h3, h4, h5, p, li, blockquote, span, div",
        ),
      ).filter((el) => {
        const t = (el.textContent ?? "").trim();
        if (!t) return false;
        // leaf-ish: no nested block element
        return !el.querySelector("h1, h2, h3, h4, h5, p, li, blockquote");
      });
      this.editables = candidates;
      for (const el of this.editables) el.setAttribute("data-editable", "true");
    }

    this.ensureEditIds();
    this.needsChromeCleanup = this.hasPersistedPresentationChrome();
    this.lastSavedHtml = this.needsChromeCleanup ? this.section.outerHTML : this.serializeSection();

    for (const el of this.editables) {
      el.setAttribute("contenteditable", "true");
      el.addEventListener("input", () => this.scheduleSave());
      // Paste as plain text — avoids HTML/style soup from the clipboard.
      el.addEventListener("paste", (e) => {
        e.preventDefault();
        const text = e.clipboardData?.getData("text/plain") || "";
        document.execCommand("insertText", false, text);
      });
    }

    // Cross-frame IPC from the parent (the editor):
    //   edit:insert-image  — insert <img src=...> at current caret
    //   edit:insert-asset  — insert an asset by kind: <img>, <video>,
    //                        <audio>, or a download link for other files
    //   edit:flush         — commit any pending debounced save immediately
    //                        (used when parent toggles HTML mode, on Save now,
    //                        and on switchSlide / beforeunload)
    //   edit:set-autosave  — toggle the 800ms debounce timer on/off; OFF lets
    //                        the user accumulate edits and save manually
    window.addEventListener("message", (e) => {
      const m = e.data;
      if (m?.type === "edit:insert-image" && this.section) {
        this.insertImage(m.url, m.alt || "");
      } else if (m?.type === "edit:insert-asset" && this.section) {
        this.insertAsset(m);
      } else if (m?.type === "edit:insert-svg" && this.section) {
        this.insertSvg(m.html);
      } else if (m?.type === "edit:flush") {
        this.commitSave();
      } else if (m?.type === "edit:set-autosave") {
        this.autoSave = !!m.value;
        // If turning OFF mid-debounce, cancel the pending timer so the
        // buffered content stays buffered until the user saves manually.
        if (!this.autoSave) {
          if (this.savePending) clearTimeout(this.savePending);
          this.savePending = null;
        }
      }
    });

    this.postReady();

    // Clean chrome written by earlier editor sessions. This is deliberately
    // queued until after `edit:ready`, so the parent has mounted its message
    // handler before the normalized slide is saved.
    if (this.needsChromeCleanup) queueMicrotask(() => this.commitSave());

    // Flush save before unload (covers iframe re-mount / nav).
    window.addEventListener("beforeunload", () => this.commitSave());
  }

  insertImage(url: string | undefined, alt = "") {
    if (!url) return;
    const img = document.createElement("img");
    img.src = url;
    if (alt) img.alt = alt;
    img.style.maxWidth = "100%";
    this.placeNode(img);
  }

  // Insert an uploaded asset in the form that fits its kind.
  insertAsset({ url, name = "", kind = "file" }: AssetMessage) {
    if (!url) return;
    if (kind === "image") {
      this.insertImage(url, name);
      return;
    }
    let node: HTMLElement;
    if (kind === "video" || kind === "audio") {
      const media = document.createElement(kind);
      media.src = url;
      media.controls = true;
      media.preload = "metadata";
      if (media instanceof HTMLVideoElement) {
        media.playsInline = true;
        media.style.maxWidth = "100%";
      }
      node = media;
    } else {
      const link = document.createElement("a");
      link.href = url;
      link.target = "_blank";
      link.rel = "noopener";
      link.textContent = name || (url.split("/").pop() as string);
      node = link;
    }
    this.placeNode(node);
  }

  // Place a node at the caret if it's inside our section, else append it to
  // the largest editable container; then schedule a save.
  placeNode(node: Node) {
    const sel = document.getSelection();
    let placed = false;
    if (sel?.rangeCount) {
      const range = sel.getRangeAt(0);
      if (this.section?.contains(range.commonAncestorContainer)) {
        range.deleteContents();
        range.insertNode(node);
        // Move caret after the inserted node
        range.setStartAfter(node);
        range.setEndAfter(node);
        sel.removeAllRanges();
        sel.addRange(range);
        placed = true;
      }
    }
    if (!placed) {
      // Fall back: append into the largest editable container, then section root.
      const target =
        this.editables.find((el) => /^(DIV|P|UL|OL)$/.test(el.tagName)) ||
        this.section?.querySelector("div") ||
        this.section;
      target?.appendChild(node);
    }
    this.scheduleSave();
  }

  insertSvg(html: string | undefined) {
    if (!html) return;
    const tmp = document.createElement("div");
    tmp.innerHTML = html;
    const node = tmp.firstChild;
    if (!node) return;
    this.placeNode(node);
  }

  ensureEditIds() {
    const seen = new Set<string | null>();
    const counters = new Map<string, number>();
    // pre-seed with any existing ids in the section
    for (const el of document.querySelectorAll("[data-edit-id]")) {
      seen.add(el.getAttribute("data-edit-id"));
    }

    for (const el of this.editables) {
      const id = el.getAttribute("data-edit-id");
      if (id && document.querySelectorAll(`[data-edit-id="${id}"]`).length === 1) {
        continue; // unique already
      }
      if (id) el.removeAttribute("data-edit-id");

      const base = slug(el.closest<HTMLElement>("section.slide")?.dataset?.title || this.sectionId);
      let n = (counters.get(base) || 0) + 1;
      let candidate = `${base}-${String(n).padStart(2, "0")}`;
      while (seen.has(candidate)) {
        n++;
        candidate = `${base}-${String(n).padStart(2, "0")}`;
      }
      counters.set(base, n);
      el.setAttribute("data-edit-id", candidate);
      seen.add(candidate);
    }
  }

  serializeSection(): string {
    const clone = (this.section as HTMLElement).cloneNode(true) as HTMLElement;
    clone.removeAttribute("data-section-id");
    for (const el of clone.querySelectorAll('[contenteditable="true"]')) {
      el.removeAttribute("contenteditable");
    }
    // Don't save the canvas's playback state (see stripPlaybackState in
    // lib/slide-render): the slide must start unrevealed when presented.
    clone.classList.remove("visible");
    for (const el of clone.querySelectorAll(".fragment.show")) el.classList.remove("show");
    // Presentation-only chrome is created from data-hl/data-hr/data-page by
    // deck-host. Never persist it in slide content. The data attribute covers
    // new chrome; the direct-child rules also repair older duplicated saves.
    for (const el of clone.querySelectorAll("[data-se-generated]")) el.remove();
    if (clone.dataset.hl || clone.dataset.hr) {
      for (const el of clone.querySelectorAll(":scope > .slide-header")) el.remove();
    }
    if (clone.dataset.page) {
      for (const el of clone.querySelectorAll(":scope > .slide-footer")) el.remove();
    }
    return clone.outerHTML;
  }

  hasPersistedPresentationChrome(): boolean {
    const section = this.section as HTMLElement;
    if (section.querySelector("[data-se-generated]")) return true;
    if (
      (section.dataset.hl || section.dataset.hr) &&
      section.querySelector(":scope > .slide-header")
    )
      return true;
    return Boolean(section.dataset.page && section.querySelector(":scope > .slide-footer"));
  }

  scheduleSave() {
    // Always tell the parent the section is dirty so it can show an unsaved
    // indicator even when auto-save is off.
    parent.postMessage({ type: "edit:dirty", section_id: this.sectionId }, "*");
    if (this.savePending) clearTimeout(this.savePending);
    if (!this.autoSave) return;
    this.savePending = setTimeout(() => this.commitSave(), SAVE_DEBOUNCE_MS);
  }

  commitSave() {
    if (this.savePending) clearTimeout(this.savePending);
    this.savePending = null;
    const content = this.serializeSection();
    if (content === this.lastSavedHtml) {
      parent.postMessage({ type: "edit:noop", section_id: this.sectionId }, "*");
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
